// =====================================================================
// O especialista — a tela "Padrões"
// =====================================================================
//   GET  /v1/lojas/:id/especialista            o padrão de funcionamento da loja
//   POST /v1/lojas/:id/especialista/revisoes   o que o responsável respondeu a uma
//                                              saída do padrão
//
// A conta mora em `api/src/especialista.ts`, sem banco. Aqui só se busca
// o que ela precisa — os números por hora, os critérios e as áreas, as
// respostas já dadas e o disco da máquina — e se guarda a resposta nova.
//
// ## O relógio é o da loja, e o dia é o da operação
//
// "Dia" e "hora" são cortados no fuso da loja DENTRO do banco, com a
// virada às 6h: a madrugada pertence à noite anterior.
//
// ## Nada é guardado além da resposta
//
// O padrão é refeito a cada pedido: são 28 dias de `resumo_hora` de uma
// loja — alguns milhares de linhas, já somadas por hora. Guardar o
// padrão pronto pediria uma rotina para refazê-lo e um jeito de saber que
// envelheceu; refazer na hora não envelhece.
//
// ## Quem vê e quem responde
//
// Vê quem vê as análises: supervisão para cima, e o suporte. Responde
// ("era esperado", "é problema") quem configura a loja — a resposta muda
// o que o padrão passa a apontar.
// =====================================================================

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';

import {
  DIAS_DO_PADRAO, montarPadroes, textoDaRevisao, VIRADA_DO_DIA,
  type Celula, type DiscoDoDia, type Entrada, type Padroes, type Revisao, type Serie, type TipoDeIndicador,
} from '../especialista.js';
import { exigirConfigurar, peloMenos } from '../rbac.js';
import { sessaoDe, type Sessao } from './sessao.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXTO = 1000;

type Loja = { id: string; nome: string; timezone: string; hoje: string; hora_agora: number };

// O dia e a hora são cortados DENTRO do banco, no fuso da loja. As duas expressões servem a "hoje" e a
// cada linha de número: se uma virasse o dia à meia-noite e a outra às 6h, hoje entraria no padrão.
/** Em SQL: o dia da operação de um instante — a madrugada pertence à noite anterior. `fuso` é uma expressão SQL. */
export const sqlDoDiaDaOperacao = (instante: string, fuso: string): string =>
  `to_char((${instante} at time zone ${fuso}) - interval '${VIRADA_DO_DIA} hours', 'YYYY-MM-DD')`;
/** Em SQL: a hora do relógio da loja de um instante. */
export const sqlDaHora = (instante: string, fuso: string): string => `extract(hour from ${instante} at time zone ${fuso})::integer`;

/** A área é o quadro inteiro (ninguém a desenhou)? */
function quadroInteiro(poligono: unknown): boolean {
  if (!Array.isArray(poligono) || poligono.length !== 4) return false;
  return poligono.every((p) => Array.isArray(p) && p.length === 2 && (p[0] === 0 || p[0] === 1) && (p[1] === 0 || p[1] === 1));
}

/** Tudo o que a conta do padrão precisa, de uma loja. */
export async function entradaDoEspecialista(pool: pg.Pool, loja: Loja): Promise<Entrada> {
  // o primeiro instante do período: as 6h do dia da operação de 28 dias atrás, no fuso da loja
  const DESDE = `(($2::date - ${DIAS_DO_PADRAO})::timestamp + interval '${VIRADA_DO_DIA} hours') at time zone $3`;
  const DIA_DA_OPERACAO = (coluna: string) => sqlDoDiaDaOperacao(coluna, '$3');

  const [setores, series, celulas, revisoes, disco] = await Promise.all([
    pool.query<{ id: string; nome: string }>('select id, nome from setor where loja_id = $1 order by ordem, nome', [loja.id]),

    // Um critério numa área, com o que se sabe dos dois. Só o que ainda
    // existe e ainda vale ali: o que saiu não tem o que ajustar.
    pool.query(
      `select r.id as regra_id, a.zona_id, r.nome as regra_nome, r.tipo, r.ativa, r.parametros, r.porteiro, r.com_padrao,
              p.id as ponto_id, p.nome as ponto_nome, p.canal, z.nome as zona_nome, z.poligono,
              (select count(*)::int from zona z2 where z2.ponto_id = p.id and z2.excluida_em is null) as areas,
              (select count(*)::int from foto_padrao fp where fp.ponto_id = p.id) as fotos_padrao,
              st.id as setor_id, st.nome as setor_nome
         from regra r
         join regra_alvo a on a.regra_id = r.id
         join zona  z on z.id = a.zona_id and z.excluida_em is null
         join ponto p on p.id = z.ponto_id and p.excluido_em is null
         join setor st on st.id = p.setor_id
        where r.loja_id = $1 and st.loja_id = $1 and r.excluida_em is null
        order by st.ordem, st.nome, p.canal nulls last, p.nome, r.nome, z.nome`,
      [loja.id],
    ),

    // Uma linha por dia da operação, hora, critério e área — somando os
    // agentes (uma reinstalação no meio da hora deixa duas linhas).
    pool.query(
      `select ${DIA_DA_OPERACAO('h.hora')} as dia,
              ${sqlDaHora('h.hora', '$3')} as hora,
              h.regra_id, h.zona_id,
              sum(h.conformes + h.nao_conformes + h.nao_avaliaveis)::integer as julgadas,
              sum(h.nao_conformes)::integer as fora,
              sum(h.nao_avaliaveis)::integer as na,
              sum(h.extras)::integer as extras,
              sum(h.extras_fora)::integer as extras_fora,
              sum(h.soma_medida)::float8 as soma_medida,
              sum(h.com_medida)::integer as com_medida,
              max(h.max_medida)::float8 as max_medida,
              sum(h.alertas)::integer as alertas,
              sum(h.em_silencio)::integer as em_silencio,
              sum(h.custo_centavos)::float8 as custo_centavos
         from resumo_hora h
        where h.loja_id = $1 and h.hora >= ${DESDE}
        group by 1, 2, h.regra_id, h.zona_id`,
      [loja.id, loja.hoje, loja.timezone],
    ),

    pool.query(
      `select v.regra_id, v.zona_id, v.indicador, to_char(v.dia, 'YYYY-MM-DD') as dia, v.hora, v.estado, v.so_desta_vez,
              v.nota, v.o_que_houve, v.o_que_foi_feito, v.virou, u.nome as quem,
              to_char(v.criado_em at time zone $2, 'YYYY-MM-DD') as em
         from padrao_revisao v
         left join usuario u on u.id = v.criado_por
        where v.loja_id = $1`,
      [loja.id, loja.timezone],
    ),

    // O disco da máquina de análise: a última leitura de cada dia.
    pool.query(
      `select distinct on (1) ${DIA_DA_OPERACAO('u.hora')} as dia, u.disco_livre_gb::float8 as livre, u.disco_total_gb::float8 as total
         from uso_hora u
        where u.loja_id = $1 and u.disco_livre_gb is not null and u.hora >= ${DESDE}
        order by 1, u.hora desc`,
      [loja.id, loja.hoje, loja.timezone],
    ),
  ]);

  return {
    hoje: loja.hoje,
    horaAgora: loja.hora_agora,
    setores: setores.rows,
    series: series.rows.map((s): Serie => {
      const p = (s.parametros ?? {}) as { objeto?: unknown; minimo?: unknown; maximo?: unknown };
      return {
        regraId: s.regra_id, zonaId: s.zona_id, regraNome: s.regra_nome, tipo: s.tipo, ativa: s.ativa,
        objeto: typeof p.objeto === 'string' && p.objeto.trim() ? p.objeto.trim().toLowerCase() : null,
        minimo: typeof p.minimo === 'number' ? p.minimo : null,
        maximo: typeof p.maximo === 'number' ? p.maximo : null,
        porteiro: s.porteiro, comPadrao: s.com_padrao,
        pontoId: s.ponto_id, pontoNome: s.ponto_nome, canal: s.canal, zonaNome: s.zona_nome,
        variasAreas: s.areas > 1, areaDesenhada: !quadroInteiro(s.poligono), fotosPadrao: s.fotos_padrao,
        setorId: s.setor_id, setorNome: s.setor_nome,
      };
    }),
    celulas: celulas.rows.map((c): Celula => ({
      dia: c.dia, hora: c.hora, regraId: c.regra_id, zonaId: c.zona_id, julgadas: c.julgadas, fora: c.fora, na: c.na,
      extras: c.extras, extrasFora: c.extras_fora, somaMedida: c.soma_medida, comMedida: c.com_medida, maxMedida: c.max_medida,
      alertas: c.alertas, emSilencio: c.em_silencio, custoCentavos: c.custo_centavos,
    })),
    revisoes: revisoes.rows.map((v): Revisao => ({
      regraId: v.regra_id, zonaId: v.zona_id, tipo: v.indicador as TipoDeIndicador, dia: v.dia, hora: v.hora, estado: v.estado, soDestaVez: v.so_desta_vez,
      texto: textoDaRevisao({ estado: v.estado, soDestaVez: v.so_desta_vez, nota: v.nota, oQueHouve: v.o_que_houve, oQueFoiFeito: v.o_que_foi_feito, dia: v.dia, hora: v.hora }),
      virou: v.virou, quem: v.quem, em: v.em,
    })),
    disco: disco.rows.map((d): DiscoDoDia => ({ dia: d.dia, livreGb: d.livre, totalGb: d.total })),
  };
}

export function rotasDoEspecialista(app: FastifyInstance, pool: pg.Pool): void {
  async function quem(req: FastifyRequest, resposta: FastifyReply): Promise<Sessao | null> {
    const s = await sessaoDe(pool, req);
    if (!s) {
      resposta.status(401).send({ erro: 'sem_sessao', mensagem: 'faça login' });
      return null;
    }
    if (s.nivel !== 'suporte' && !peloMenos(s, 'supervisao')) {
      resposta.status(403).send({ erro: 'sem_permissao', mensagem: 'os padrões são vistos pela supervisão, pela gerência e pela diretoria' });
      return null;
    }
    return s;
  }
  /** A loja, com "hoje" (o dia da operação) e a hora de agora no relógio DELA. Outra conta não a encontra. */
  async function lojaDe(id: string, tenantId: string): Promise<Loja | null> {
    if (!UUID.test(id)) return null;
    const l = await pool.query<Loja>(
      `select id, nome, timezone,
              ${sqlDoDiaDaOperacao('now()', 'timezone')} as hoje,
              ${sqlDaHora('now()', 'timezone')} as hora_agora
         from loja
        where id = $1 and tenant_id = $2`,
      [id, tenantId],
    );
    return l.rows[0] ?? null;
  }
  const naoAchei = (resposta: FastifyReply) => resposta.status(404).send({ erro: 'nao_encontrada', mensagem: 'loja não encontrada' });
  const paraTela = (loja: Loja, p: Padroes) => ({ loja: { id: loja.id, nome: loja.nome, timezone: loja.timezone }, ...p });

  app.get('/v1/lojas/:id/especialista', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    const loja = await lojaDe((req.params as { id: string }).id, s.tenantId);
    if (!loja) return naoAchei(resposta);
    return paraTela(loja, montarPadroes(await entradaDoEspecialista(pool, loja)));
  });

  app.post('/v1/lojas/:id/especialista/revisoes', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirConfigurar(s, resposta)) return;
    const loja = await lojaDe((req.params as { id: string }).id, s.tenantId);
    if (!loja) return naoAchei(resposta);

    const invalido = (mensagem: string) => resposta.status(422).send({ erro: 'validacao', mensagem });
    const c = (req.body ?? {}) as Record<string, unknown>;
    if (typeof c.anomaliaId !== 'string' || !c.anomaliaId) return invalido('diga qual saída do padrão está sendo revista');
    if (c.estado !== 'esperado' && c.estado !== 'problema') return invalido('estado: esperado ou problema');
    const texto = (v: unknown): string | null => (v === undefined || v === null ? '' : typeof v === 'string' && v.trim().length <= MAX_TEXTO ? v.trim() : null);
    const [nota, oQueHouve, oQueFoiFeito] = [texto(c.nota), texto(c.oQueHouve), texto(c.oQueFoiFeito)];
    if (nota === null || oQueHouve === null || oQueFoiFeito === null) return invalido(`os textos têm no máximo ${MAX_TEXTO} caracteres`);
    // "Foi só desta vez" é sim ou não: `"false"`, 0 ou "" não são um não.
    if (c.soDestaVez !== undefined && typeof c.soDestaVez !== 'boolean') return invalido('soDestaVez: verdadeiro ou falso');
    const soDestaVez = c.estado === 'esperado' && c.soDestaVez === true;
    if (c.estado === 'problema' && (!oQueHouve || !oQueFoiFeito)) return invalido('conte o que aconteceu e o que foi feito');
    const depois = c.depois ?? 'nada';
    if (depois !== 'criar' && depois !== 'ajustar' && depois !== 'nada') return invalido('depois: criar, ajustar ou nada');
    if (c.estado === 'esperado' && depois !== 'nada') return invalido('só a correção de um problema propõe ou ajusta critério');

    // A saída do padrão é a que a conta aponta AGORA: é dela que saem o
    // critério, a área, o dia e a hora — nunca do que veio no pedido.
    const padroes = montarPadroes(await entradaDoEspecialista(pool, loja));
    const a = padroes.anomalias.find((x) => x.id === c.anomaliaId);
    if (!a) {
      return resposta.status(404).send({ erro: 'nao_encontrada', mensagem: 'esta hora não está mais entre as saídas do padrão — recarregue a tela' });
    }
    const jaRevista = () => resposta.status(409).send({ erro: 'ja_revista', mensagem: 'esta saída do padrão já foi revista por outra pessoa — recarregue a tela' });
    if (a.estado !== 'rever') return jaRevista();
    if (depois === 'criar' && !a.criterio) return invalido('esta saída do padrão não tem critério a propor');
    if (depois === 'ajustar' && !a.ajustar) return invalido('esta saída do padrão não tem critério a ajustar');
    const virou =
      depois === 'criar' ? `Propôs o critério “${a.criterio!.nome}”, que nasce desligado.` : depois === 'ajustar' ? `Abriu “${a.ajustar!.nome}” para ajuste.` : null;

    try {
      await pool.query(
        `insert into padrao_revisao (loja_id, regra_id, zona_id, indicador, dia, hora, estado, so_desta_vez, nota, o_que_houve, o_que_foi_feito, virou, criado_por)
         values ($1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [loja.id, a.regraId, a.zonaId, a.tipo, a.dia, a.hora, c.estado, soDestaVez, c.estado === 'esperado' ? nota : '', oQueHouve, oQueFoiFeito, virou, s.usuarioId],
      );
    } catch (e) {
      // Duas pessoas respondendo à mesma hora: a segunda fica sabendo.
      if ((e as { code?: string }).code === '23505') return jaRevista();
      throw e;
    }
    return resposta.status(201).send(paraTela(loja, montarPadroes(await entradaDoEspecialista(pool, loja))));
  });
}
