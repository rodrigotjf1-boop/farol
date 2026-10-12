// =====================================================================
// GET /v1/lojas/:id/resultados?periodo=24h|7d
// =====================================================================
// A tela "o que o Farol viu": tudo o que foi analisado nas câmeras da
// loja, por critério e por canal, e os sinais de que o SISTEMA não está
// conseguindo olhar.
//
// Aqui só se busca. A conta — os limiares, os sinais, a ordem — está em
// `resultados.ts`, sem banco, para poder ser testada com números
// escolhidos à mão.
//
// ## O relógio é o da loja
//
// "Hora a hora" e "dia a dia" são da loja, não do servidor: a virada do
// dia de uma hamburgueria no Rio não é à meia-noite de Londres. Os baldes
// são cortados no fuso da loja DENTRO do banco, que sabe fazer essa conta.
//
// ## Quem vê
//
// Supervisão para cima, e o suporte. É informação de gestão: quem está na
// bancada não precisa — e não deve — abrir o placar dos colegas.
// =====================================================================

import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

import { peloMenos } from '../rbac.js';
import {
  canaisSemImagem,
  montarLinhas,
  montarSinais,
  somarTotais,
  type CanalDaLoja,
  type CriterioDaLoja,
  type HoraDoCanal,
  type Linha,
} from '../resultados.js';
import { sessaoDe } from './sessao.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERIODOS = {
  '24h': { passo: 'hora', balde: 'hour', salto: '1 hour', recuo: '23 hours' },
  '7d': { passo: 'dia', balde: 'day', salto: '1 day', recuo: '6 days' },
} as const;
type Periodo = keyof typeof PERIODOS;

const OCORRENCIAS = 10;

export function rotasDeResultados(app: FastifyInstance, pool: pg.Pool): void {
  app.get('/v1/lojas/:id/resultados', async (req, resposta) => {
    const s = await sessaoDe(pool, req);
    if (!s) {
      return resposta.status(401).send({ erro: 'sem_sessao', mensagem: 'faça login' });
    }
    if (s.nivel !== 'suporte' && !peloMenos(s, 'supervisao')) {
      return resposta.status(403).send({
        erro: 'sem_permissao',
        mensagem: 'os resultados são vistos pela supervisão, pela gerência e pela diretoria',
      });
    }

    const { id } = req.params as { id: string };
    const naoAchei = () =>
      resposta.status(404).send({ erro: 'nao_encontrada', mensagem: 'loja não encontrada' });
    if (!UUID.test(id)) return naoAchei();

    const pedido = (req.query as { periodo?: string }).periodo ?? '24h';
    if (!(pedido in PERIODOS)) {
      return resposta.status(400).send({
        erro: 'periodo_invalido',
        mensagem: `periodo: um de ${Object.keys(PERIODOS).join(', ')}`,
      });
    }
    const periodo = pedido as Periodo;
    const p = PERIODOS[periodo];

    // A loja e os limites do período, no fuso dela, numa consulta só. O
    // tenant vai junto: loja de outra conta tem que ser indistinguível de
    // loja que não existe.
    //
    // Os limites voltam como TEXTO. `timestamp` sem fuso vira `Date` no
    // fuso do processo, e a conta sairia certa na minha máquina e três
    // horas errada no servidor.
    const l = await pool.query<{
      id: string; nome: string; timezone: string; ini: string; fim: string; agora: Date;
    }>(
      `select id, nome, timezone, now() as agora,
              to_char(date_trunc($3, now() at time zone timezone) - $4::interval,
                      'YYYY-MM-DD"T"HH24:MI:SS') as ini,
              to_char(date_trunc($3, now() at time zone timezone),
                      'YYYY-MM-DD"T"HH24:MI:SS') as fim
         from loja
        where id = $1 and tenant_id = $2`,
      [id, s.tenantId, p.balde, p.recuo],
    );
    if (l.rowCount === 0) return naoAchei();
    const loja = l.rows[0]!;

    const [agentes, criterios, canais, linhas, serie, horas, ocorrencias, historico] =
      await Promise.all([
        // `segundos_sem_bater` no BANCO, como no console: o relógio do
        // navegador erra, e agente saudável apareceria caído.
        pool.query(
          `select id, nome, estado, versao, ultimo_heartbeat,
                  extract(epoch from (now() - ultimo_heartbeat))::integer as segundos_sem_bater
             from agente
            where loja_id = $1
            order by ultimo_heartbeat desc nulls last`,
          [id],
        ),

        // Todo critério da loja, com o número de canais ATIVOS em que vale.
        pool.query(
          `select r.id, r.nome, r.tipo, r.ativa, r.estado,
                  coalesce(nullif(r.parametros->>'objeto', ''), '') <> '' as tem_objeto,
                  -- "Vale sempre" é o critério que deveria estar sendo olhado a
                  -- qualquer hora: sem horário próprio, e sem depender do
                  -- horário da loja. Só desses dá para dizer "nunca foi
                  -- olhado" sem saber que horas são — critério "no horário"
                  -- com a loja fechada está certo em não ter sido.
                  (jsonb_array_length(coalesce(r.janelas, '[]'::jsonb)) = 0
                   and (r.quando = 'sempre'
                        or (r.quando = 'no_horario'
                            and jsonb_array_length(lj.horario_funcionamento) = 0))) as vale_sempre,
                  (select count(distinct z.ponto_id)::integer
                     from regra_alvo ra
                     join zona  z on z.id = ra.zona_id
                     join ponto pt on pt.id = z.ponto_id
                    where ra.regra_id = r.id and pt.excluido_em is null and pt.ativo) as canais
             from regra r
             join loja lj on lj.id = r.loja_id
            where r.loja_id = $1 and r.excluida_em is null`,
          [id],
        ),

        // Os canais ativos, com quantos critérios LIGADOS cada um tem.
        pool.query(
          `select pt.id, pt.nome, pt.canal,
                  (select count(distinct r.id)::integer
                     from zona z
                     join regra_alvo ra on ra.zona_id = z.id
                     join regra r on r.id = ra.regra_id
                    where z.ponto_id = pt.id and r.ativa and r.excluida_em is null) as criterios_ligados
             from ponto pt
             join setor st on st.id = pt.setor_id
            where st.loja_id = $1 and pt.excluido_em is null and pt.ativo
            order by st.ordem, st.nome, pt.canal nulls last, pt.nome`,
          [id],
        ),

        // O acumulado do período, por critério e canal. Um critério em
        // duas áreas do mesmo canal vira UMA linha: a tela fala de canal.
        pool.query(
          `select h.regra_id, r.nome as regra_nome, r.tipo, r.ativa as regra_ligada,
                  (r.excluida_em is not null) as regra_excluida,
                  pt.id as ponto_id, pt.nome as ponto_nome, pt.canal, st.nome as setor,
                  pt.ativo as ponto_ativo, (pt.excluido_em is not null) as ponto_excluido,
                  -- Em que área(s) deste canal o critério foi olhado, e
                  -- quantas áreas o canal tem: com uma só o nome dela não
                  -- diz nada além do canal.
                  array_agg(distinct z.nome) as areas,
                  (select count(*)::integer from zona zz
                    where zz.ponto_id = pt.id and zz.excluida_em is null) as areas_do_canal,
                  sum(h.capturas)::integer as capturas,
                  sum(h.sem_juiz)::integer as sem_juiz,
                  sum(h.sem_quadro)::integer as sem_quadro,
                  sum(h.sem_cena)::integer as sem_cena,
                  sum(h.em_silencio)::integer as em_silencio,
                  sum(h.repetidas)::integer as repetidas,
                  sum(h.ja_julgadas)::integer as ja_julgadas,
                  sum(h.vazias_guardadas)::integer as vazias_guardadas,
                  sum(h.enfileiradas)::integer as enfileiradas,
                  sum(h.conformes)::integer as conformes,
                  sum(h.nao_conformes)::integer as nao_conformes,
                  sum(h.nao_avaliaveis)::integer as nao_avaliaveis,
                  sum(h.falhas)::integer as falhas,
                  sum(h.alertas)::integer as alertas,
                  sum(h.soma_confianca)::float8 as soma_confianca,
                  sum(h.com_confianca)::integer as com_confianca,
                  sum(h.soma_latencia_ms)::float8 as soma_latencia_ms,
                  sum(h.com_latencia)::integer as com_latencia,
                  max(h.ultima_em) as ultima_em,
                  (array_agg(h.ultimo_impedimento order by h.hora desc)
                     filter (where h.ultimo_impedimento is not null))[1] as ultimo_impedimento
             from resumo_hora h
             join regra r  on r.id = h.regra_id
             join zona  z  on z.id = h.zona_id
             join ponto pt on pt.id = z.ponto_id
             join setor st on st.id = pt.setor_id
            where h.loja_id = $1
              and h.hora >= ($2::timestamp at time zone $3)
            group by h.regra_id, r.nome, r.tipo, r.ativa, r.excluida_em,
                     pt.id, pt.nome, pt.canal, st.nome, pt.ativo, pt.excluido_em`,
          [id, loja.ini, loja.timezone],
        ),

        // A série, com TODOS os baldes — inclusive os vazios. Balde que
        // falta no gráfico parece "sem dado"; balde com zero diz "olhou e
        // não havia nada", que é outra informação.
        pool.query(
          `with baldes as (
             select generate_series($2::timestamp, $3::timestamp, $4::interval) as inicio
           ), somas as (
             select date_trunc($5, h.hora at time zone $6) as inicio,
                    sum(h.conformes)::integer as conformes,
                    sum(h.nao_conformes)::integer as nao_conformes,
                    sum(h.nao_avaliaveis)::integer as nao_avaliaveis
               from resumo_hora h
              where h.loja_id = $1
                and h.hora >= ($2::timestamp at time zone $6)
              group by 1
           )
           select to_char(b.inicio, 'YYYY-MM-DD"T"HH24:MI:SS') as inicio,
                  coalesce(s.conformes, 0) as conformes,
                  coalesce(s.nao_conformes, 0) as nao_conformes,
                  coalesce(s.nao_avaliaveis, 0) as nao_avaliaveis
             from baldes b
             left join somas s on s.inicio = b.inicio
            order by b.inicio`,
          [id, loja.ini, loja.fim, p.salto, p.balde, loja.timezone],
        ),

        // As últimas 24 horas por canal, hora a hora — é o que diz se uma
        // câmera está sem imagem AGORA, qualquer que seja o período pedido.
        pool.query(
          `select z.ponto_id, h.hora,
                  sum(h.capturas)::integer as capturas,
                  sum(h.sem_quadro + h.sem_cena)::integer as sem_imagem
             from resumo_hora h
             join zona z on z.id = h.zona_id
            where h.loja_id = $1 and h.hora >= now() - interval '24 hours'
            group by z.ponto_id, h.hora`,
          [id],
        ),

        // As últimas vezes fora do critério, com o que aconteceu com o
        // aviso. "Chegou" ganha de "mandado", que ganha de "na fila".
        pool.query(
          `select e.id, e.ocorrido_em, e.motivo, e.confianca,
                  r.nome as regra_nome, pt.id as ponto_id, pt.nome as ponto_nome, pt.canal,
                  z.nome as zona_nome,
                  (select count(*)::integer from zona zz
                    where zz.ponto_id = pt.id and zz.excluida_em is null) as areas_do_canal,
                  (select case
                            when bool_or(v.estado = 'entregue') then 'entregue'
                            when bool_or(v.estado = 'enviado')  then 'enviado'
                            when bool_or(v.estado = 'pendente') then 'pendente'
                            when bool_or(v.estado = 'falhou')   then 'falhou'
                          end
                     from envio v
                    where v.evento_id = e.id) as aviso
             from evento e
             left join regra r  on r.id = e.regra_id
             left join zona  z  on z.id = e.zona_id
             left join ponto pt on pt.id = z.ponto_id
            where e.loja_id = $1
              and e.veredito = 'nao_conforme'
              and e.ocorrido_em >= ($2::timestamp at time zone $3)
            order by e.ocorrido_em desc
            limit ${OCORRENCIAS}`,
          [id, loja.ini, loja.timezone],
        ),

        // Já chegou resumo desta loja alguma vez? Separa "loja nova, ainda
        // sem nada" de "nada neste período".
        pool.query('select exists(select 1 from resumo_hora where loja_id = $1) as tem', [id]),
      ]);

    const asLinhas: Linha[] = linhas.rows.map((r) => ({
      regraId: r.regra_id,
      regraNome: r.regra_nome,
      tipo: r.tipo,
      regraLigada: r.regra_ligada,
      regraExcluida: r.regra_excluida,
      pontoId: r.ponto_id,
      pontoNome: r.ponto_nome,
      canal: r.canal,
      setor: r.setor,
      pontoAtivo: r.ponto_ativo,
      pontoExcluido: r.ponto_excluido,
      capturas: r.capturas,
      semJuiz: r.sem_juiz,
      semQuadro: r.sem_quadro,
      semCena: r.sem_cena,
      emSilencio: r.em_silencio,
      repetidas: r.repetidas,
      jaJulgadas: r.ja_julgadas,
      vaziasGuardadas: r.vazias_guardadas,
      enfileiradas: r.enfileiradas,
      conformes: r.conformes,
      naoConformes: r.nao_conformes,
      naoAvaliaveis: r.nao_avaliaveis,
      falhas: r.falhas,
      alertas: r.alertas,
      somaConfianca: Number(r.soma_confianca),
      comConfianca: r.com_confianca,
      somaLatenciaMs: Number(r.soma_latencia_ms),
      comLatencia: r.com_latencia,
      ultimaEm: r.ultima_em ? new Date(r.ultima_em).toISOString() : null,
      ultimoImpedimento: r.ultimo_impedimento,
      areaNome:
        r.areas_do_canal > 1
          ? [...(r.areas as string[])].sort((a, b) => a.localeCompare(b, 'pt-BR')).join(' e ')
          : null,
    }));

    const asHoras: HoraDoCanal[] = horas.rows.map((h) => ({
      pontoId: h.ponto_id,
      hora: new Date(h.hora).toISOString(),
      capturas: h.capturas,
      semImagem: h.sem_imagem,
    }));

    const osCriterios: CriterioDaLoja[] = criterios.rows.map((c) => ({
      id: c.id,
      nome: c.nome,
      tipo: c.tipo,
      ligado: c.ativa,
      canais: c.canais,
      temObjeto: c.tem_objeto,
      valeSempre: c.vale_sempre,
    }));

    const osCanais: CanalDaLoja[] = canais.rows.map((c) => ({
      id: c.id,
      nome: c.nome,
      canal: c.canal,
      criteriosLigados: c.criterios_ligados,
    }));

    const agora = new Date(loja.agora);
    const sinais = montarSinais({
      agentes: agentes.rows,
      linhas: asLinhas,
      horas: asHoras,
      criterios: osCriterios,
      canais: osCanais,
      agora,
    });
    const parados = new Set(canaisSemImagem(asHoras, agora).keys());

    // "Verificado" é o canal ativo com pelo menos um critério ligado: só
    // desses faz sentido perguntar se têm imagem.
    const verificados = osCanais.filter((c) => c.criteriosLigados > 0);
    const comCanal = osCriterios.filter((c) => c.canais > 0);

    return {
      loja: { id: loja.id, nome: loja.nome, timezone: loja.timezone },
      periodo,
      desde: loja.ini,
      agora: agora.toISOString(),
      temHistorico: historico.rows[0]!.tem as boolean,
      agentes: agentes.rows,
      canais: {
        verificados: verificados.length,
        comImagem: verificados.filter((c) => !parados.has(c.id)).length,
      },
      criterios: {
        total: comCanal.length,
        ligados: comCanal.filter((c) => c.ligado).length,
        // Dos ligados, os que só observam: contam o que veem, sem julgar nem
        // avisar. Sem este número, "4 de 4 ligados" parece "4 conferindo".
        observando: criterios.rows.filter((c) => c.ativa && c.canais > 0 && c.estado === 'observando').length,
      },
      totais: somarTotais(asLinhas),
      serie: {
        passo: p.passo,
        pontos: serie.rows.map((b) => ({
          inicio: b.inicio as string,
          conformes: b.conformes as number,
          naoConformes: b.nao_conformes as number,
          naoAvaliaveis: b.nao_avaliaveis as number,
        })),
      },
      linhas: montarLinhas(asLinhas, parados),
      sinais,
      ocorrencias: ocorrencias.rows.map((o) => ({
        id: o.id as string,
        ocorridoEm: new Date(o.ocorrido_em).toISOString(),
        regraNome: (o.regra_nome as string | null) ?? null,
        // Em que canal foi: é o que a planta usa para acender a câmera.
        pontoId: (o.ponto_id as string | null) ?? null,
        pontoNome: (o.ponto_nome as string | null) ?? null,
        canal: (o.canal as number | null) ?? null,
        areaNome: (o.areas_do_canal as number | null) && (o.areas_do_canal as number) > 1
          ? ((o.zona_nome as string | null) ?? null)
          : null,
        motivo: (o.motivo as string | null) ?? null,
        confianca: o.confianca === null ? null : Number(o.confianca),
        aviso: (o.aviso as string | null) ?? null,
      })),
    };
  });
}
