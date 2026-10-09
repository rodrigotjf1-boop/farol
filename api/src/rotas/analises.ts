// =====================================================================
// GET /v1/lojas/:id/analises?de=AAAA-MM-DD&ate=AAAA-MM-DD
// =====================================================================
// A tela "Análises": o que foi julgado, hora a hora — em que canal, por
// qual critério, ONDE foi julgado (na loja ou na nuvem) e quanto custou.
//
// O Painel (`/resultados`) responde "está tudo bem?" com o acumulado do
// período e os sinais de defeito. Esta rota entrega o MIÚDO: uma célula
// por dia, hora, critério e área. A tela recorta e soma como quiser — por
// hora, por canal, por critério, por onde julgou — sem ir e voltar ao
// servidor a cada filtro. Um dia de uma loja são algumas centenas de
// células; o teto de 31 dias, alguns milhares.
//
// ## O relógio é o da loja
//
// "Dia" e "hora" são os da loja, cortados no fuso dela DENTRO do banco.
// `de` e `ate` são dias do calendário dela.
//
// ## O que é "análise"
//
// O que terminou em veredito: conforme, fora do critério ou "não deu para
// avaliar". É a mesma conta do Painel. Olhada que não chegou a ser
// julgada (cena repetida, câmera sem imagem) aparece em `capturas`.
//
// ## A máquina de análise
//
// Junto vai o USO do computador da loja nas mesmas horas (migration 021):
// processador, memória, placa de vídeo e disco, por máquina. Vêm a soma e
// a quantidade de amostras de cada peça, para a tela juntar várias horas
// sem errar a média, e o pico. É da máquina inteira: acompanha o período e
// as horas, não o canal nem o critério.
//
// ## Quem vê
//
// Supervisão para cima, e o suporte — como os resultados.
// =====================================================================

import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

import { lerIntervalo, ondeDaVia, repartirPorOnde } from '../analises.js';
import { peloMenos } from '../rbac.js';
import { sessaoDe } from './sessao.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Quantos avisos voltam com os detalhes; o total do intervalo vai à parte. */
const MAX_AVISOS = 200;

export function rotasDeAnalises(app: FastifyInstance, pool: pg.Pool): void {
  app.get('/v1/lojas/:id/analises', async (req, resposta) => {
    const s = await sessaoDe(pool, req);
    if (!s) {
      return resposta.status(401).send({ erro: 'sem_sessao', mensagem: 'faça login' });
    }
    if (s.nivel !== 'suporte' && !peloMenos(s, 'supervisao')) {
      return resposta.status(403).send({
        erro: 'sem_permissao',
        mensagem: 'as análises são vistas pela supervisão, pela gerência e pela diretoria',
      });
    }

    const { id } = req.params as { id: string };
    const naoAchei = () =>
      resposta.status(404).send({ erro: 'nao_encontrada', mensagem: 'loja não encontrada' });
    if (!UUID.test(id)) return naoAchei();

    // A loja, com "hoje" e "agora" no relógio DELA. O tenant vai junto:
    // loja de outra conta tem que ser indistinguível de loja que não existe.
    const l = await pool.query<{
      id: string; nome: string; timezone: string; horario_funcionamento: unknown;
      agora: Date; hoje: string; hora_agora: number;
    }>(
      `select id, nome, timezone, horario_funcionamento, now() as agora,
              to_char(now() at time zone timezone, 'YYYY-MM-DD') as hoje,
              extract(hour from now() at time zone timezone)::integer as hora_agora
         from loja
        where id = $1 and tenant_id = $2`,
      [id, s.tenantId],
    );
    if (l.rowCount === 0) return naoAchei();
    const loja = l.rows[0]!;

    const q = req.query as { de?: unknown; ate?: unknown };
    const intervalo = lerIntervalo(q.de, q.ate, loja.hoje);
    if (intervalo.problema) {
      return resposta.status(400).send({ erro: 'intervalo_invalido', mensagem: intervalo.problema });
    }
    const de = intervalo.de!;
    const ate = intervalo.ate!;

    // Os limites do intervalo são meia-noite NO FUSO DA LOJA: `timestamp
    // at time zone` lê o relógio de parede e devolve o instante.
    // (`coluna` é sempre um nome escrito aqui, nunca texto que vem de fora.)
    const naJanela = (coluna: string) =>
      `${coluna} >= ($2::date::timestamp at time zone $4) and ${coluna} < (($3::date + 1)::timestamp at time zone $4)`;

    const [celulas, canais, criterios, avisos, totalDeAvisos, zonas, uso, maquinas] = await Promise.all([
      // Uma linha por dia, hora, critério e área — somando os agentes: uma
      // reinstalação no meio da hora deixa duas linhas para a mesma hora.
      pool.query(
        `select to_char(h.hora at time zone $4, 'YYYY-MM-DD') as dia,
                extract(hour from h.hora at time zone $4)::integer as hora,
                h.regra_id, r.tipo, z.ponto_id, h.zona_id,
                sum(h.capturas)::integer as capturas,
                sum(h.sem_condicao)::integer as sem_condicao,
                sum(h.observadas)::integer as observadas,
                sum(h.sem_gatilho)::integer as sem_gatilho,
                sum(h.em_silencio)::integer as em_silencio,
                sum(h.conformes)::integer as conformes,
                sum(h.nao_conformes)::integer as nao_conformes,
                sum(h.nao_avaliaveis)::integer as nao_avaliaveis,
                sum(h.falhas)::integer as falhas,
                sum(h.alertas)::integer as alertas,
                sum(h.julgadas_loja)::integer as julgadas_loja,
                sum(h.julgadas_nuvem)::integer as julgadas_nuvem,
                sum(h.custo_centavos)::float8 as custo_centavos,
                sum(h.soma_medida)::float8 as soma_medida,
                sum(h.com_medida)::integer as com_medida,
                max(h.max_medida)::float8 as max_medida,
                sum(h.soma_latencia_ms)::float8 as soma_latencia_ms,
                sum(h.com_latencia)::integer as com_latencia,
                sum(h.soma_confianca)::float8 as soma_confianca,
                sum(h.com_confianca)::integer as com_confianca
           from resumo_hora h
           join regra r on r.id = h.regra_id
           join zona  z on z.id = h.zona_id
          where h.loja_id = $1
            and ${naJanela('h.hora')}
          group by 1, 2, h.regra_id, r.tipo, z.ponto_id, h.zona_id
          order by 1, 2`,
        [id, de, ate, loja.timezone],
      ),

      // Todo canal da loja, inclusive o excluído: o histórico de um canal
      // que saiu continua aparecendo nos dias em que ele existia.
      pool.query(
        `select pt.id, pt.nome, pt.canal, st.nome as setor, pt.ativo,
                (pt.excluido_em is not null) as excluido
           from ponto pt
           join setor st on st.id = pt.setor_id
          where st.loja_id = $1
          order by st.ordem, st.nome, pt.canal nulls last, pt.nome`,
        [id],
      ),

      pool.query(
        `select r.id, r.nome, r.tipo, r.ativa, (r.excluida_em is not null) as excluido
           from regra r
          where r.loja_id = $1
          order by r.nome`,
        [id],
      ),

      // Os avisos do intervalo, do mais novo para trás. "Fora do critério"
      // é contado a cada olhada; vira AVISO — com hora, motivo e imagem —
      // o que passou pela confiança mínima e pelo silêncio do critério. É
      // só desses que existe o detalhe.
      pool.query(
        `select e.id, e.ocorrido_em,
                to_char(e.ocorrido_em at time zone $4, 'YYYY-MM-DD') as dia,
                extract(hour from e.ocorrido_em at time zone $4)::integer as hora,
                to_char(e.ocorrido_em at time zone $4, 'HH24:MI') as hora_minuto,
                e.regra_id, z.ponto_id, e.zona_id, e.motivo, e.confianca, e.via,
                (select case
                          when bool_or(v.estado = 'entregue') then 'entregue'
                          when bool_or(v.estado = 'enviado')  then 'enviado'
                          when bool_or(v.estado = 'pendente') then 'pendente'
                          when bool_or(v.estado = 'falhou')   then 'falhou'
                        end
                   from envio v
                  where v.evento_id = e.id) as aviso
           from evento e
           left join zona z on z.id = e.zona_id
          where e.loja_id = $1
            and e.veredito = 'nao_conforme'
            and ${naJanela('e.ocorrido_em')}
          order by e.ocorrido_em desc
          limit ${MAX_AVISOS}`,
        [id, de, ate, loja.timezone],
      ),

      pool.query<{ n: number }>(
        `select count(*)::integer as n
           from evento e
          where e.loja_id = $1
            and e.veredito = 'nao_conforme'
            and ${naJanela('e.ocorrido_em')}`,
        [id, de, ate, loja.timezone],
      ),

      // As áreas dos canais da loja, inclusive as excluídas: o nome delas
      // continua valendo para o que registraram.
      pool.query<{ id: string; ponto_id: string; nome: string; excluida: boolean }>(
        `select z.id, z.ponto_id, z.nome, (z.excluida_em is not null) as excluida
           from zona z
           join ponto pt on pt.id = z.ponto_id
           join setor st on st.id = pt.setor_id
          where st.loja_id = $1`,
        [id],
      ),

      // O uso da máquina, hora a hora e por máquina, no relógio da loja.
      pool.query(
        `select u.agente_id,
                to_char(u.hora at time zone $4, 'YYYY-MM-DD') as dia,
                extract(hour from u.hora at time zone $4)::integer as hora,
                u.amostras,
                u.cpu_soma::float8 as cpu_soma, u.cpu_amostras, u.cpu_max::float8 as cpu_max,
                u.mem_soma::float8 as mem_soma, u.mem_amostras, u.mem_max::float8 as mem_max,
                u.gpu_soma::float8 as gpu_soma, u.gpu_amostras, u.gpu_max::float8 as gpu_max,
                u.proc_cpu_soma::float8 as proc_cpu_soma, u.proc_cpu_amostras,
                u.proc_cpu_max::float8 as proc_cpu_max, u.proc_mem_max_mb::float8 as proc_mem_max_mb,
                u.disco_livre_gb::float8 as disco_livre_gb, u.disco_total_gb::float8 as disco_total_gb
           from uso_hora u
          where u.loja_id = $1
            and ${naJanela('u.hora')}
          order by u.agente_id, u.hora`,
        [id, de, ate, loja.timezone],
      ),

      // As máquinas da loja e de que são feitas.
      pool.query(
        `select id, nome, maquina from agente where loja_id = $1 order by criado_em`,
        [id],
      ),
    ]);

    // As áreas de cada canal: as que existem hoje e as que aparecem no
    // intervalo. O nome da área só é dito quando o canal tem (ou tinha)
    // mais de uma — com uma só, repetiria o canal.
    const nomeDaZona = new Map(zonas.rows.map((z) => [z.id, z.nome]));
    const areasDoCanal = new Map<string, Set<string>>();
    const somarArea = (pontoId: string | null, zonaId: string | null) => {
      if (!pontoId || !zonaId) return;
      if (!areasDoCanal.has(pontoId)) areasDoCanal.set(pontoId, new Set());
      areasDoCanal.get(pontoId)!.add(zonaId);
    };
    for (const z of zonas.rows) if (!z.excluida) somarArea(z.ponto_id, z.id);
    for (const c of celulas.rows) somarArea(c.ponto_id, c.zona_id);
    for (const a of avisos.rows) somarArea(a.ponto_id, a.zona_id);
    const areaNome = (pontoId: string | null, zonaId: string | null): string | null =>
      pontoId && zonaId && (areasDoCanal.get(pontoId)?.size ?? 0) > 1 ? (nomeDaZona.get(zonaId) ?? null) : null;

    const canaisVistos = new Set<string>(celulas.rows.map((c) => c.ponto_id as string));
    const criteriosVistos = new Set<string>(celulas.rows.map((c) => c.regra_id as string));
    for (const a of avisos.rows) {
      if (a.ponto_id) canaisVistos.add(a.ponto_id as string);
      if (a.regra_id) criteriosVistos.add(a.regra_id as string);
    }

    return {
      loja: {
        id: loja.id,
        nome: loja.nome,
        timezone: loja.timezone,
        horario_funcionamento: loja.horario_funcionamento,
      },
      de,
      ate,
      hoje: loja.hoje,
      horaAgora: loja.hora_agora,
      agora: new Date(loja.agora).toISOString(),

      // Excluído só aparece se tem o que mostrar no intervalo.
      canais: canais.rows
        .filter((c) => !c.excluido || canaisVistos.has(c.id))
        .map((c) => ({
          id: c.id as string,
          nome: c.nome as string,
          canal: (c.canal as number | null) ?? null,
          setor: c.setor as string,
          ativo: c.ativo as boolean,
          excluido: c.excluido as boolean,
        })),
      criterios: criterios.rows
        .filter((c) => !c.excluido || criteriosVistos.has(c.id))
        .map((c) => ({
          id: c.id as string,
          nome: c.nome as string,
          tipo: c.tipo as string,
          ligado: c.ativa as boolean,
          excluido: c.excluido as boolean,
        })),

      celulas: celulas.rows.map((c) => {
        const analises = (c.conformes as number) + (c.nao_conformes as number) + (c.nao_avaliaveis as number);
        const onde = repartirPorOnde({
          tipo: c.tipo as string,
          julgadas: analises,
          julgadasLoja: c.julgadas_loja as number,
          julgadasNuvem: c.julgadas_nuvem as number,
        });
        return {
          dia: c.dia as string,
          hora: c.hora as number,
          regraId: c.regra_id as string,
          pontoId: c.ponto_id as string,
          zonaId: c.zona_id as string,
          areaNome: areaNome(c.ponto_id as string, c.zona_id as string),
          capturas: c.capturas as number,
          // Olhadas que NÃO viraram análise por decisão da loja: o
          // porteiro segurou (a condição do critério não valia) ou o
          // critério estava no silêncio depois de um aviso.
          semCondicao: c.sem_condicao as number,
          // Olhadas de critério em "observando": passaram pelo contexto e
          // não foram julgadas — de propósito, sem custo.
          observadas: c.observadas as number,
          // Olhadas de critério com estudo em que o contexto valia e nenhum
          // gatilho abriu a análise.
          semGatilho: c.sem_gatilho as number,
          emSilencio: c.em_silencio as number,
          analises,
          conformes: c.conformes as number,
          naoConformes: c.nao_conformes as number,
          naoAvaliaveis: c.nao_avaliaveis as number,
          falhas: c.falhas as number,
          alertas: c.alertas as number,
          naLoja: onde.naLoja,
          naNuvem: onde.naNuvem,
          custoCentavos: Number(c.custo_centavos),
          // O que o juiz MEDIU nas cenas (o detector: quantos objetos viu).
          // Soma e quantidade para a média; o maior valor é nulo quando
          // nada foi medido — "não medi" não é zero.
          somaMedida: Number(c.soma_medida),
          comMedida: c.com_medida as number,
          maxMedida: c.max_medida === null ? null : Number(c.max_medida),
          somaLatenciaMs: Number(c.soma_latencia_ms),
          comLatencia: c.com_latencia as number,
          somaConfianca: Number(c.soma_confianca),
          comConfianca: c.com_confianca as number,
        };
      }),

      maquina: {
        // Só a máquina que mediu algo no intervalo, ou que já disse de
        // que é feita: agente cadastrado e nunca instalado não é máquina.
        agentes: maquinas.rows
          .filter((m) => m.maquina != null || uso.rows.some((u) => u.agente_id === m.id))
          .map((m) => {
            const p = (m.maquina ?? {}) as Record<string, unknown>;
            return {
              id: m.id as string,
              nome: m.nome as string,
              processador: (p.processador as string | null) ?? null,
              nucleos: (p.nucleos as number | null) ?? null,
              memoriaGb: (p.memoriaGb as number | null) ?? null,
              placaDeVideo: (p.placaDeVideo as string | null) ?? null,
            };
          }),
        horas: uso.rows.map((u) => ({
          agenteId: u.agente_id as string,
          dia: u.dia as string,
          hora: u.hora as number,
          amostras: u.amostras as number,
          cpuSoma: u.cpu_soma as number, cpuAmostras: u.cpu_amostras as number, cpuMax: (u.cpu_max as number | null) ?? null,
          memSoma: u.mem_soma as number, memAmostras: u.mem_amostras as number, memMax: (u.mem_max as number | null) ?? null,
          gpuSoma: u.gpu_soma as number, gpuAmostras: u.gpu_amostras as number, gpuMax: (u.gpu_max as number | null) ?? null,
          // A parte do Farol (o processo do agente) no processador da máquina.
          farolCpuSoma: u.proc_cpu_soma as number,
          farolCpuAmostras: u.proc_cpu_amostras as number,
          farolCpuMax: (u.proc_cpu_max as number | null) ?? null,
          farolMemMaxMb: (u.proc_mem_max_mb as number | null) ?? null,
          discoLivreGb: (u.disco_livre_gb as number | null) ?? null,
          discoTotalGb: (u.disco_total_gb as number | null) ?? null,
        })),
      },

      totalDeAvisos: totalDeAvisos.rows[0]!.n,
      avisos: avisos.rows.map((a) => ({
        id: a.id as string,
        ocorridoEm: new Date(a.ocorrido_em).toISOString(),
        dia: a.dia as string,
        hora: a.hora as number,
        horaMinuto: a.hora_minuto as string,
        regraId: (a.regra_id as string | null) ?? null,
        pontoId: (a.ponto_id as string | null) ?? null,
        zonaId: (a.zona_id as string | null) ?? null,
        areaNome: areaNome(a.ponto_id as string | null, a.zona_id as string | null),
        motivo: (a.motivo as string | null) ?? null,
        confianca: a.confianca === null ? null : Number(a.confianca),
        onde: ondeDaVia(a.via as string | null),
        aviso: (a.aviso as string | null) ?? null,
      })),
    };
  });
}
