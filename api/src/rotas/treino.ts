// =====================================================================
// O treinamento da bancada: os lanches lidos na loja e a conferência
// =====================================================================
// A21, fatia T4 (migration 049). O protótipo e as decisões foram aprovados
// pelo dono em 15/10/2026 (PR #147):
//
//   • a LOJA manda cada lanche que leu numa gravação de treino — as etapas
//     e os quadros reduzidos (`POST /v1/agentes/treino/lanches`, com o token
//     do agente; contrato em `contratos/lanche-de-treino.json`). Mandar de
//     novo o mesmo lanche troca a leitura — menos depois de conferido: o
//     que alguém conferiu não muda por baixo;
//   • a TELA lista os lanches (a dúvida primeiro), abre um, mostra os
//     quadros, e recebe a conferência ou o "pular". Conferem diretoria,
//     gerência e supervisão (decisão 3);
//   • cada etapa conferida — confirmada ou corrigida — com nome das fichas
//     vira um EXEMPLO na base de conhecimento (`base_frame`, origem
//     `bancada`), com a imagem copiada: o exemplo fica enquanto a base o
//     usar; o quadro do treino sai 30 dias depois da conferência (decisão
//     1; `apagarQuadrosVencidos`, chamada pela rotina da API);
//   • o acerto conta SÓ o que alguém conferiu: antes da conferência, o
//     Farol não sabe se acertou;
//   • a GRAVAÇÃO DE TREINO (fatia T3, migration 050): quem configura cria
//     no console (do que o gravador já guardou, ou programada), cancela o
//     que ainda não começou e apaga as imagens da gravação já conferida; a
//     loja pergunta o que tem de ler (`GET /v1/agentes/treino/gravacoes`,
//     com a lista do que ela já pode apagar do computador dela) e conta o
//     andamento (`POST …/andamento`: lendo, pronta, ou falhou com o
//     motivo). Contrato em `contratos/gravacao-de-treino.json`;
//   • as SUGESTÕES PARA AS FICHAS (fatia T6, migration 051): calculadas
//     das conferências (`api/src/treino-sugestoes.ts`), vão na lista da
//     loja com a resposta de quem configura; `POST …/treino/sugestoes`
//     guarda a resposta (sim/não) e um retrato do que a sugestão dizia.
// =====================================================================

import { createHash, randomUUID } from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';

import { autenticarAgente, ErroDeAuth } from '../auth.js';
import { lerBase, type Base } from '../fichas.js';
import { chaveDoIngrediente, ingredientesDaBase } from '../ingredientes.js';
import { conferenciaQueConta, outrosNomesDaLoja } from '../outros-nomes.js';
import { podeAcompanhar, podeConfigurar } from '../rbac.js';
import { estudarFichas } from '../estudo-das-fichas.js';
import {
  acertouOPalpite,
  aprendizado,
  contaComoEvidencia,
  DIAS_DOS_QUADROS,
  exemplosDaConferencia,
  exemplosDeNada,
  exemplosForaDasFichas,
  fotosDoLanche,
  lerConferencia,
  lerLancheDeTreino,
  META,
  motivoDoLanche,
  MOTIVOS,
  NOME_DO_NADA,
  palpiteQueVale,
  palpitesDoLanche,
  semLeitura,
  umPorFamilia,
  type Conferencia,
  type EtapaLida,
} from '../treino.js';
import { aindaEDaLoja, GRAVACAO, lerAndamento, lerNovaGravacao, SQL_DO_QUE_A_LOJA_APAGA } from '../treino-gravacao.js';
import { chaveDeHoje, DECISOES, sugestoesDoTreino, type DecisaoDaSugestao, type Sugestao } from '../treino-sugestoes.js';
import { sessaoDe, type Sessao } from './sessao.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 40 quadros de até 300 kB, em base64, com folga. */
const MAX_DO_CORPO = 18 * 1024 * 1024;
/** Os conferidos mais novos que a lista traz (os que esperam conferência vêm todos). */
const CONFERIDOS_NA_LISTA = 200;
/** De quantos conferidos (os mais novos) saem as sugestões para as fichas. */
const CONFERIDOS_DAS_SUGESTOES = 500;

/** Apaga os quadros dos lanches conferidos há mais de 30 dias (decisão do dono). Devolve quantos saíram. */
export async function apagarQuadrosVencidos(pool: pg.Pool, agora: Date = new Date()): Promise<number> {
  const r = await pool.query(
    `delete from treino_quadro q
      using treino_lanche l
      where l.id = q.lanche_id
        and l.conferido_em is not null
        and l.conferido_em < $1::timestamptz - make_interval(days => $2)`,
    [agora.toISOString(), DIAS_DOS_QUADROS],
  );
  return r.rowCount ?? 0;
}

type LinhaDoLanche = {
  id: string;
  gravacao_id: string;
  aberto_em: Date | null;
  fechou_em: Date | null;
  /** `pecas`: no lanche lido por passos (A23.3), quantas metades do pão a leitura achou. */
  leitura: { etapas: EtapaLida[]; pecas?: number };
  situacao: 'conferir' | 'conferido' | 'pulado';
  resposta: Conferencia | null;
  produto: string | null;
  palpite: string | null;
  acertou: boolean | null;
  conferido_em: Date | null;
  conferido_por_nome: string | null;
  quadros: Array<{ id: string; n: number; sha256: string | null }> | null;
};

const CAMPOS_DO_LANCHE = `
  l.id, l.gravacao_id, l.aberto_em, l.fechou_em, l.leitura, l.situacao, l.resposta, l.produto, l.palpite, l.acertou,
  l.conferido_em, u.nome as conferido_por_nome,
  (select jsonb_agg(jsonb_build_object('id', q.id, 'n', q.n, 'sha256', q.sha256) order by q.n) from treino_quadro q where q.lanche_id = l.id) as quadros`;

/** A imagem de cada quadro (n → sha256): as etapas com a MESMA imagem são uma foto só na conferência nova. */
const shaDosQuadros = (quadros: Array<{ n: number; sha256: string | null }> | null): Map<number, string | null> =>
  new Map((quadros ?? []).map((q) => [q.n, q.sha256]));

export function rotasDoTreino(app: FastifyInstance, pool: pg.Pool): void {
  async function quem(req: FastifyRequest, resposta: FastifyReply): Promise<Sessao | null> {
    const s = await sessaoDe(pool, req);
    if (!s) {
      resposta.status(401).send({ erro: 'sem_sessao', mensagem: 'faça login' });
      return null;
    }
    // decisão do dono (15/10/2026): conferem diretoria, gerência e supervisão
    if (!podeAcompanhar(s)) {
      resposta.status(403).send({ erro: 'sem_permissao', mensagem: 'seu perfil não vê o treinamento da loja' });
      return null;
    }
    return s;
  }
  const naoAchei = (resposta: FastifyReply, mensagem: string) => resposta.status(404).send({ erro: 'nao_encontrado', mensagem });
  const invalido = (resposta: FastifyReply, mensagem: string) => resposta.status(422).send({ erro: 'validacao', mensagem });

  /** As fichas da loja (nula = sem base) e o que "não se vê de cima" — ou `null` se a loja não é da conta. */
  async function daLoja(cliente: pg.Pool | pg.PoolClient, tenantId: string, lojaId: string) {
    const r = await cliente.query(
      `select f.conteudo, f.fonte,
              coalesce((select array_agg(lower(btrim(b.nome))) from base_conhecimento b
                         where b.loja_id = l.id and b.tipo = 'item' and not b.visivel), '{}') as invisiveis
         from loja l
         left join fichas_da_loja f on f.loja_id = l.id
        where l.id = $1 and l.tenant_id = $2`,
      [lojaId, tenantId],
    );
    if (r.rowCount === 0) return null;
    return {
      base: lerBase(r.rows[0].conteudo) as Base | null,
      invisiveis: new Set<string>(r.rows[0].invisiveis as string[]),
      /** De onde as fichas vêm (`regem`, `planilha`, `sistema`): a tela diz onde mudar. Nulo = sem fichas. */
      fonte: (r.rows[0].fonte as string | null) ?? null,
    };
  }

  /** As sugestões para as fichas (fatia T6): calculadas das conferências, com a resposta de quem configura. */
  async function sugestoesDaLoja(lojaId: string, base: Base | null) {
    const [conferidos, respostas, outros] = await Promise.all([
      pool.query<{ produto: string | null; leitura: { etapas: EtapaLida[] }; resposta: Conferencia }>(
        `select produto, leitura, resposta from treino_lanche
          where loja_id = $1 and situacao = 'conferido' and resposta is not null
          order by conferido_em desc
          limit $2`,
        [lojaId, CONFERIDOS_DAS_SUGESTOES],
      ),
      pool.query<{ chave: string; decisao: DecisaoDaSugestao; resumo: Sugestao; decidido_em: Date; decidido_por_nome: string | null }>(
        `select s.chave, s.decisao, s.resumo, s.decidido_em, u.nome as decidido_por_nome
           from treino_sugestao s left join usuario u on u.id = s.decidido_por
          where s.loja_id = $1`,
        [lojaId],
      ),
      outrosNomesDaLoja(pool, lojaId),
    ]);
    // o outro nome conta como o ingrediente das fichas (migration 053): ele não é mais "nome fora das fichas", e o que
    // a bancada mostrou com ele vale para o ingrediente
    const conferencias = conferidos.rows.map((c) => ({ produto: c.produto, etapas: c.leitura?.etapas ?? [], conferencia: conferenciaQueConta(c.resposta, outros) }));
    const agora = sugestoesDoTreino(conferencias, base);
    // A chave guardada pode ser de antes da regra do nome parecido (19/10/2026: "Pão de Brioche" = "Pão Brioche"):
    // relida pela regra de hoje, a resposta continua presa à sua sugestão, e a sugestão não aparece duas vezes.
    const respondidas = new Map(respostas.rows.map((r) => [chaveDeHoje(r.chave), r]));
    const comResposta = (s: Sugestao) => {
      const r = respondidas.get(chaveDeHoje(s.chave));
      return {
        ...s,
        decisao: r?.decisao ?? null,
        decididoEm: r?.decidido_em ?? null,
        decididoPor: r?.decidido_por_nome ?? null,
        /** O "nome fora das fichas" que quem configura juntou a um ingrediente delas: qual. Nulo = não foi juntado. */
        juntoA: s.tipo === 'nome-fora' ? (outros.get(chaveDoIngrediente(s.ingrediente)) ?? null) : null,
      };
    };
    // a respondida que as conferências de agora já não mostram continua na tela, como foi respondida — menos o "nome
    // fora das fichas" cujo nome hoje ESTÁ nas fichas (escrito de outro jeito): essa já não diz nada
    const nasFichas = new Set(ingredientesDaBase(base).map((i) => chaveDoIngrediente(i.nome)));
    const deAntes = respostas.rows
      .filter((r) => !agora.some((s) => s.chave === chaveDeHoje(r.chave)))
      .filter((r) => !(r.resumo?.tipo === 'nome-fora' && nasFichas.has(chaveDoIngrediente(r.resumo.ingrediente ?? ''))))
      .map((r) => comResposta({ ...r.resumo, chave: chaveDeHoje(r.chave) }));
    return { agora, lista: [...agora.map(comResposta), ...deAntes], conferencias, outros };
  }

  /** O lanche como a tela o vê: o palpite com as fichas de hoje, o motivo na fila e as miniaturas das duas metades. */
  function paraTela(l: LinhaDoLanche, base: Base | null, invisiveis: Set<string>) {
    const etapas = l.leitura?.etapas ?? [];
    const palpites = palpitesDoLanche(etapas, base, invisiveis);
    // sem nada visto da ficha, o Farol não tem palpite (o lanche sem leitura, antes da identificação)
    const vale = palpiteQueVale(palpites);
    const quadroDe = new Map((l.quadros ?? []).map((q) => [q.n, q.id]));
    const porPassos = etapas.some((e) => e.metade !== undefined);
    // a miniatura de cada metade: o último quadro dela (como ficou). No lanche por passos, o da peça 1 e o da peça 2 —
    // o último que conta (nunca o da peça saindo, que é o inox)
    const miniatura = (lado: string) => {
      const metade = lado === 'tampo' ? 1 : 2;
      for (let i = etapas.length - 1; i >= 0; i -= 1) {
        const e = etapas[i]!;
        const dela = porPassos ? e.metade === metade && contaComoEvidencia(e) : e.lado === lado;
        if (dela && e.quadro !== null && quadroDe.has(e.quadro)) return quadroDe.get(e.quadro)!;
      }
      return null;
    };
    return {
      id: l.id,
      gravacaoId: l.gravacao_id,
      abertoEm: l.aberto_em,
      fechouEm: l.fechou_em,
      situacao: l.situacao,
      motivo: motivoDoLanche(etapas, palpites[0]),
      /** Nenhuma etapa tem leitura (antes da identificação dos ingredientes): a tela diz isso, sem palpite. */
      semLeitura: semLeitura(etapas),
      palpite: vale ? { produtoId: vale.produtoId, produto: vale.produto, batem: vale.batem, total: vale.total, fora: vale.fora } : null,
      produto: l.produto,
      acertou: l.acertou,
      conferidoEm: l.conferido_em,
      conferidoPor: l.conferido_por_nome,
      miniaturas: { tampo: miniatura('tampo'), base: miniatura('base') },
      etapas: etapas.length,
      /** O lanche lido por passos (A23.3): a conferência é um cartão por passo, e não por foto. */
      porPassos,
      /** Quantas metades do pão a leitura achou (o pão pelas peças). Nulo = a leitura não disse. */
      pecas: l.leitura?.pecas ?? null,
    };
  }

  // ───────────────────── a loja manda o lanche lido ─────────────────────

  app.post('/v1/agentes/treino/lanches', { bodyLimit: MAX_DO_CORPO }, async (req, resposta) => {
    let agente;
    try {
      agente = await autenticarAgente(pool, req.headers.authorization);
    } catch (e) {
      if (e instanceof ErroDeAuth) {
        req.log.warn({ motivo: e.motivo }, 'credencial recusada no lanche de treino');
        return resposta.status(e.status).send({ erro: e.motivo, mensagem: e.message });
      }
      throw e;
    }
    const lido = lerLancheDeTreino(req.body);
    if ('problema' in lido) return invalido(resposta, lido.problema);

    if (lido.gravacao.pontoId) {
      // o canal tem de ser DESTA loja: o token do agente diz qual é a loja, nunca o corpo
      const canal = await pool.query(
        `select 1 from ponto p join setor st on st.id = p.setor_id where p.id = $1 and st.loja_id = $2`,
        [lido.gravacao.pontoId, agente.lojaId],
      );
      if (canal.rowCount === 0) return invalido(resposta, 'gravacao.pontoId: este canal não é desta loja');
    }

    const cliente = await pool.connect();
    try {
      await cliente.query('begin');
      const g = lido.gravacao;
      const gravacao = await cliente.query(
        `insert into treino_gravacao (loja_id, ponto_id, chave, inicio, fim, origem, situacao, lida_em)
         values ($1, $2, $3, $4, $5, $6, 'pronta', now())
         on conflict (loja_id, chave) do update
            set ponto_id = coalesce(excluded.ponto_id, treino_gravacao.ponto_id),
                inicio = least(treino_gravacao.inicio, excluded.inicio),
                fim = greatest(treino_gravacao.fim, excluded.fim),
                lida_em = now()
         returning id, situacao`,
        [agente.lojaId, g.pontoId, g.chave, g.inicio, g.fim, g.origem],
      );
      const gravacaoId = gravacao.rows[0].id as string;
      // alguém cancelou no console, ou apagou as imagens, enquanto a loja lia: o lanche não entra (fatia T3)
      const encerrada = gravacao.rows[0].situacao as string;
      if (encerrada === 'cancelada' || encerrada === 'apagada') {
        await cliente.query('rollback');
        return resposta.status(409).send({ erro: 'gravacao_encerrada', mensagem: `esta gravação foi ${encerrada}: a loja não manda mais lanches dela` });
      }
      // a linha do lanche fica travada: dois envios do mesmo lanche passam um depois do outro
      const antes = await cliente.query(
        'select id, situacao from treino_lanche where gravacao_id = $1 and chave = $2 for update',
        [gravacaoId, lido.lanche.chave],
      );
      if (antes.rows[0]?.situacao === 'conferido') {
        await cliente.query('commit');
        return { lancheId: antes.rows[0].id as string, gravacaoId, novo: false, conferido: true, quadros: 0 };
      }
      const leitura = { etapas: lido.lanche.etapas, ...(lido.lanche.pecas !== null ? { pecas: lido.lanche.pecas } : {}) };
      let lancheId: string;
      if (antes.rows[0]) {
        lancheId = antes.rows[0].id as string;
        await cliente.query(
          `update treino_lanche set leitura = $2, aberto_em = $3, fechou_em = $4, recebido_em = now() where id = $1`,
          [lancheId, JSON.stringify(leitura), lido.lanche.abertoEm, lido.lanche.fechouEm],
        );
        await cliente.query('delete from treino_quadro where lanche_id = $1', [lancheId]);
      } else {
        lancheId = (
          await cliente.query(
            `insert into treino_lanche (gravacao_id, loja_id, chave, aberto_em, fechou_em, leitura)
             values ($1, $2, $3, $4, $5, $6) returning id`,
            [gravacaoId, agente.lojaId, lido.lanche.chave, lido.lanche.abertoEm, lido.lanche.fechouEm, JSON.stringify(leitura)],
          )
        ).rows[0].id as string;
      }
      for (const [n, q] of lido.quadros.entries()) {
        await cliente.query(
          `insert into treino_quadro (lanche_id, n, imagem, largura, altura, sha256) values ($1, $2, $3, $4, $5, $6)`,
          [lancheId, n, q.bytes, q.largura, q.altura, createHash('sha256').update(q.bytes).digest('hex')],
        );
      }
      await cliente.query('commit');
      req.log.info({ loja: agente.lojaId, gravacao: gravacaoId, lanche: lancheId, quadros: lido.quadros.length }, 'lanche de treino RECEBIDO');
      return resposta.status(antes.rows[0] ? 200 : 201).send({ lancheId, gravacaoId, novo: !antes.rows[0], conferido: false, quadros: lido.quadros.length });
    } catch (e) {
      await cliente.query('rollback').catch(() => {});
      throw e;
    } finally {
      cliente.release();
    }
  });

  // ───────────────────── a tela: a lista ─────────────────────

  app.get('/v1/lojas/:id/treino', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return invalido(resposta, 'id inválido');
    const loja = await daLoja(pool, s.tenantId, id);
    if (!loja) return naoAchei(resposta, 'não existe essa loja');

    const [gravacoes, lanches, contas, conferidos, canais, sabe, sugestoes] = await Promise.all([
      pool.query(
        `select g.id, g.chave, g.inicio, g.fim, g.origem, g.situacao, g.progresso, g.apagada_em, g.motivo,
                p.nome as canal_nome, p.canal as canal_numero,
                count(l.*)::int as lanches,
                (count(l.*) filter (where l.situacao = 'conferido'))::int as conferidos,
                (count(l.*) filter (where l.situacao = 'pulado'))::int as pulados,
                (count(l.*) filter (where l.situacao = 'conferido' and l.acertou))::int as acertou
           from treino_gravacao g
           left join ponto p on p.id = g.ponto_id
           left join treino_lanche l on l.gravacao_id = g.id
          where g.loja_id = $1
          group by g.id, p.nome, p.canal
          order by g.inicio desc
          limit 100`,
        [id],
      ),
      pool.query<LinhaDoLanche>(
        `select ${CAMPOS_DO_LANCHE}
           from treino_lanche l
           left join usuario u on u.id = l.conferido_por
          where l.loja_id = $1
            and (l.situacao <> 'conferido'
                 or l.id in (select id from treino_lanche where loja_id = $1 and situacao = 'conferido' order by conferido_em desc limit $2))
          order by l.aberto_em desc nulls last`,
        [id, CONFERIDOS_NA_LISTA],
      ),
      // as contas, sobre TODOS os conferidos (a lista traz só os mais novos)
      pool.query(
        `select (count(*) filter (where situacao = 'conferido'))::int as conferidos,
                (count(*) filter (where situacao = 'conferido' and acertou))::int as acertou
           from treino_lanche where loja_id = $1`,
        [id],
      ),
      pool.query<{ leitura: { etapas: EtapaLida[] }; resposta: Conferencia }>(
        `select leitura, resposta from treino_lanche where loja_id = $1 and situacao = 'conferido' and resposta is not null`,
        [id],
      ),
      // as bancadas que se gravam: os canais do gravador desta loja (A21, fatia T3)
      pool.query<{ id: string; nome: string; canal: number | null }>(
        `select p.id, p.nome, p.canal
           from ponto p join setor st on st.id = p.setor_id
          where st.loja_id = $1 and p.origem = 'dvr'
          order by p.canal nulls last, p.nome`,
        [id],
      ),
      // o computador da loja já sabe gravar o treino? (o agente declara `treino` ao pedir a configuração)
      pool.query<{ sabe: boolean }>(
        `select exists (select 1 from agente a where a.loja_id = $1 and a.estado = 'ativo' and 'treino' = any(a.sabe)) as sabe`,
        [id],
      ),
      // as sugestões para as fichas (fatia T6)
      sugestoesDaLoja(id, loja.base),
    ]);
    const naTela = lanches.rows.map((l) => paraTela(l, loja.base, loja.invisiveis));
    // a fila: a dúvida primeiro, depois a hora
    const ordem = (m: string) => MOTIVOS.indexOf(m as (typeof MOTIVOS)[number]);
    naTela.sort((a, b) => {
      if (a.situacao !== b.situacao) return a.situacao === 'conferir' ? -1 : b.situacao === 'conferir' ? 1 : 0;
      if (a.situacao === 'conferir' && a.motivo !== b.motivo) return ordem(a.motivo) - ordem(b.motivo);
      return new Date(b.abertoEm ?? 0).getTime() - new Date(a.abertoEm ?? 0).getTime();
    });
    return {
      podeConfigurar: podeConfigurar(s),
      meta: META,
      diasDosQuadros: DIAS_DOS_QUADROS,
      /** As regras da gravação nova (as mesmas que a API confere): de 15 minutos a 1 hora; o gravador guarda ~18 horas. */
      regras: GRAVACAO,
      canais: canais.rows.map((p) => ({ id: p.id, nome: p.nome, numero: p.canal })),
      /** Falso: o computador da loja ainda não sabe gravar o treino (o pacote dele é anterior à fatia T3). */
      lojaSabeGravar: sabe.rows[0]?.sabe === true,
      /** As sugestões para as fichas, a responder primeiro; e de onde as fichas vêm (a tela diz onde mudar). */
      sugestoes: sugestoes.lista,
      fichasDe: loja.fonte,
      gravacoes: gravacoes.rows.map((g) => ({
        id: g.id,
        chave: g.chave,
        inicio: g.inicio,
        fim: g.fim,
        origem: g.origem,
        situacao: g.situacao,
        progresso: g.progresso,
        motivo: g.motivo,
        apagadaEm: g.apagada_em,
        canal: g.canal_nome ? { nome: g.canal_nome, numero: g.canal_numero } : null,
        lanches: g.lanches,
        conferidos: g.conferidos,
        pulados: g.pulados,
        acertou: g.acertou,
      })),
      lanches: naTela,
      contas: { conferidos: contas.rows[0].conferidos as number, acertou: contas.rows[0].acertou as number },
      // o outro nome conta como o ingrediente das fichas a que foi juntado (migration 053)
      aprendizado: aprendizado(conferidos.rows.map((c) => ({ etapas: c.leitura?.etapas ?? [], conferencia: conferenciaQueConta(c.resposta, sugestoes.outros) }))),
    };
  });

  // ───────────────────── a tela: um lanche ─────────────────────

  app.get('/v1/treino/lanches/:id', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return naoAchei(resposta, 'lanche não encontrado');
    const r = await pool.query<LinhaDoLanche & { loja_id: string; gravacao_inicio: Date; gravacao_fim: Date; gravacao_origem: string }>(
      `select ${CAMPOS_DO_LANCHE}, l.loja_id, g.inicio as gravacao_inicio, g.fim as gravacao_fim, g.origem as gravacao_origem
         from treino_lanche l
         join treino_gravacao g on g.id = l.gravacao_id
         join loja lo on lo.id = l.loja_id
         left join usuario u on u.id = l.conferido_por
        where l.id = $1 and lo.tenant_id = $2`,
      [id, s.tenantId],
    );
    const l = r.rows[0];
    if (!l) return naoAchei(resposta, 'lanche não encontrado');
    const loja = (await daLoja(pool, s.tenantId, l.loja_id))!;
    const quadroDe = new Map((l.quadros ?? []).map((q) => [q.n, q.id]));
    const etapas = l.leitura?.etapas ?? [];
    const palpites = palpitesDoLanche(etapas, loja.base, loja.invisiveis);
    const daBase = ingredientesDaBase(loja.base);
    return {
      ...paraTela(l, loja.base, loja.invisiveis),
      gravacao: { id: l.gravacao_id, inicio: l.gravacao_inicio, fim: l.gravacao_fim, origem: l.gravacao_origem },
      etapas: etapas.map((e) => ({ ...e, quadroId: e.quadro !== null ? (quadroDe.get(e.quadro) ?? null) : null })),
      /** A conferência nova: um cartão por foto (as etapas com a mesma imagem juntas), na ordem da primeira etapa. */
      fotos: fotosDoLanche(etapas, shaDosQuadros(l.quadros)).map((f) => ({
        etapas: f.etapas,
        quadroId: f.quadro !== null ? (quadroDe.get(f.quadro) ?? null) : null,
      })),
      // um por família: as opções de "Qual lanche era?" são lanches que a bancada separa (o "Trio 16" do "Número 16"
      // fica em "Outro produto"). Até 4: as plausíveis das perguntas que separam as fichas estão entre elas.
      palpites: umPorFamilia(palpites).slice(0, 4),
      /** Nada do que a leitura viu bate com uma ficha: o Farol não tem palpite (e o lanche conta como não acertado). */
      semPalpite: palpiteQueVale(palpites) === null,
      resposta: l.resposta,
      /** Para "Outro produto": os produtos da loja que têm ficha. */
      produtos: (loja.base?.produtos ?? []).filter((p) => p.ficha && p.cozinha).map((p) => ({ id: p.id, nome: p.nome })),
      /** Para "Era outro": os ingredientes das fichas. */
      ingredientes: daBase.map((i) => i.nome),
      /**
       * Para o nome escrito à mão (o protótipo aprovado em 19/10/2026): onde cada ingrediente entra — os lanches cuja
       * ficha o leva e os de que ele é adicional —, para quem confere escolher entre os parecidos.
       */
      lanchesDoIngrediente: Object.fromEntries(
        daBase.map((i) => [
          i.nome,
          {
            fichas: [...new Set(i.produtos.filter((p) => !p.adicional).map((p) => p.produto))],
            adicional: [...new Set(i.produtos.filter((p) => p.adicional).map((p) => p.produto))],
          },
        ]),
      ),
      /**
       * Os outros nomes (migration 053): a chave do nome que quem configura juntou a um ingrediente das fichas → o
       * ingrediente. Quem escrever o outro nome de novo na conferência ouve "é o 'Blend da casa' das fichas".
       */
      outrosNomes: Object.fromEntries(await outrosNomesDaLoja(pool, l.loja_id)),
      naoSeVe: [...loja.invisiveis],
    };
  });

  app.get('/v1/treino/quadros/:id/imagem', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return naoAchei(resposta, 'quadro não encontrado');
    const r = await pool.query(
      `select q.imagem, q.tipo
         from treino_quadro q
         join treino_lanche l on l.id = q.lanche_id
         join loja lo on lo.id = l.loja_id
        where q.id = $1 and lo.tenant_id = $2`,
      [id, s.tenantId],
    );
    if (r.rowCount === 0) return naoAchei(resposta, 'quadro não encontrado');
    return resposta
      .header('content-type', r.rows[0].tipo || 'image/jpeg')
      .header('x-content-type-options', 'nosniff')
      // o quadro de um id nunca muda; `private`: é imagem de dentro da loja
      .header('cache-control', 'private, max-age=86400, immutable')
      .send(r.rows[0].imagem);
  });

  // ───────────────────── a tela: conferir e pular ─────────────────────

  app.post('/v1/treino/lanches/:id/conferencia', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return naoAchei(resposta, 'lanche não encontrado');

    const cliente = await pool.connect();
    try {
      await cliente.query('begin');
      const r = await cliente.query(
        `select l.id, l.loja_id, l.leitura, g.ponto_id,
                (select jsonb_agg(jsonb_build_object('n', q.n, 'sha256', q.sha256)) from treino_quadro q where q.lanche_id = l.id) as quadros
           from treino_lanche l
           join treino_gravacao g on g.id = l.gravacao_id
           join loja lo on lo.id = l.loja_id
          where l.id = $1 and lo.tenant_id = $2
            for update of l`,
        [id, s.tenantId],
      );
      const l = r.rows[0] as
        | { id: string; loja_id: string; leitura: { etapas: EtapaLida[] }; ponto_id: string | null; quadros: Array<{ n: number; sha256: string | null }> | null }
        | undefined;
      if (!l) {
        await cliente.query('rollback');
        return naoAchei(resposta, 'lanche não encontrado');
      }
      const loja = (await daLoja(cliente, s.tenantId, l.loja_id))!;
      const etapas = l.leitura?.etapas ?? [];
      // a conferência nova responde por foto: o agrupamento é o da API (o mesmo que a gaveta recebeu)
      const conferencia = lerConferencia(req.body, etapas, loja.base, fotosDoLanche(etapas, shaDosQuadros(l.quadros)));
      if ('problema' in conferencia) {
        await cliente.query('rollback');
        return invalido(resposta, conferencia.problema);
      }
      const estudo = estudarFichas(loja.base, loja.invisiveis);
      // sem nada visto da ficha, não há palpite: o lanche conta como não acertado (decisão do dono, 15/10/2026)
      const palpite = palpiteQueVale(palpitesDoLanche(etapas, loja.base, loja.invisiveis, estudo))?.produto ?? null;
      // o produto escolhido, ou outro da mesma família: a bancada não separa o "Trio 16" do "Número 16"
      const acertou = acertouOPalpite(estudo, conferencia.produto, palpite);
      await cliente.query(
        `update treino_lanche
            set situacao = 'conferido', resposta = $2, produto = $3, palpite = $4, acertou = $5, conferido_por = $6, conferido_em = now()
          where id = $1`,
        [id, JSON.stringify(conferencia), conferencia.produto, palpite, acertou, s.usuarioId],
      );
      // os exemplos: conferir de novo troca os deste lanche. O outro nome ensina o ingrediente das fichas a que foi
      // juntado (migration 053); a conferência guardada fica como a pessoa escreveu
      await cliente.query(`delete from base_frame where lanche_id = $1 and origem = 'bancada'`, [id]);
      let exemplos = 0;
      const queConta = conferenciaQueConta(conferencia, await outrosNomesDaLoja(cliente, l.loja_id));
      const nasFichas = ingredientesDaBase(loja.base).map((i) => i.nome);
      // o nome escrito à mão que não está nas fichas guarda o exemplo à parte, com tipo 'fora' (migration 053): ele só
      // desce para a loja quando o nome vale (vira outro nome de um ingrediente das fichas, ou a ficha chega com ele)
      const paraGuardar = [
        ...exemplosDaConferencia(etapas, queConta, nasFichas).map((ex) => ({ ...ex, tipo: 'item' as const })),
        ...exemplosForaDasFichas(etapas, queConta, nasFichas).map((ex) => ({ ...ex, tipo: 'fora' as const })),
      ];
      for (const ex of paraGuardar) {
        const item = await cliente.query(
          `insert into base_conhecimento (loja_id, tipo, nome) values ($1, $3, $2)
           on conflict (loja_id, tipo, lower(btrim(nome))) do update set atualizado_em = now()
           returning id`,
          [l.loja_id, ex.nome, ex.tipo],
        );
        // a mesma imagem (outro quadro com os mesmos bytes) para o mesmo ingrediente, do mesmo lanche: uma vez só
        const novo = await cliente.query(
          `insert into base_frame (base_id, origem, imagem, tipo, largura, altura, sha256, lanche_id, etapa, ponto_id, criado_por)
           select $1, 'bancada', q.imagem, q.tipo, q.largura, q.altura, q.sha256, $2, $3, $4, $5
             from treino_quadro q
            where q.lanche_id = $2 and q.n = $6
              and not exists (select 1 from base_frame b where b.base_id = $1 and b.lanche_id = $2 and b.sha256 = q.sha256)`,
          [item.rows[0].id, id, ex.etapa, l.ponto_id, s.usuarioId, ex.quadro],
        );
        exemplos += novo.rowCount ?? 0;
      }
      // o "não era ingrediente" do lanche lido por passos vira exemplo do que NÃO é ingrediente (migration 054): o
      // juiz da loja aprende a separar o inox, o alumínio, a tampa da caixa e a mão
      let nada = 0;
      const deNada = exemplosDeNada(etapas, conferencia);
      if (deNada.length) {
        const item = await cliente.query(
          `insert into base_conhecimento (loja_id, tipo, nome) values ($1, 'nada', $2)
           on conflict (loja_id, tipo, lower(btrim(nome))) do update set atualizado_em = now()
           returning id`,
          [l.loja_id, NOME_DO_NADA],
        );
        for (const ex of deNada) {
          const novo = await cliente.query(
            `insert into base_frame (base_id, origem, imagem, tipo, largura, altura, sha256, lanche_id, etapa, ponto_id, criado_por)
             select $1, 'bancada', q.imagem, q.tipo, q.largura, q.altura, q.sha256, $2, $3, $4, $5
               from treino_quadro q
              where q.lanche_id = $2 and q.n = $6
                and not exists (select 1 from base_frame b where b.base_id = $1 and b.lanche_id = $2 and b.sha256 = q.sha256)`,
            [item.rows[0].id, id, ex.etapa, l.ponto_id, s.usuarioId, ex.quadro],
          );
          nada += novo.rowCount ?? 0;
        }
      }
      await cliente.query('commit');
      req.log.info({ lanche: id, produto: conferencia.produto, acertou, exemplos, nada, por: s.usuarioId }, 'lanche de treino CONFERIDO');
      return { conferido: true, produto: conferencia.produto, palpite, acertou, exemplos, nada };
    } catch (e) {
      await cliente.query('rollback').catch(() => {});
      throw e;
    } finally {
      cliente.release();
    }
  });

  app.post('/v1/treino/lanches/:id/pular', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return naoAchei(resposta, 'lanche não encontrado');
    const r = await pool.query(
      `update treino_lanche l set situacao = 'pulado'
         from loja lo
        where l.id = $1 and lo.id = l.loja_id and lo.tenant_id = $2 and l.situacao = 'conferir'
       returning l.id`,
      [id, s.tenantId],
    );
    if (r.rowCount === 1) return { pulado: true };
    // não pulou: ou não existe (para esta conta), ou já foi conferido, ou já estava pulado
    const ainda = await pool.query(
      `select l.situacao from treino_lanche l join loja lo on lo.id = l.loja_id where l.id = $1 and lo.tenant_id = $2`,
      [id, s.tenantId],
    );
    if (ainda.rowCount === 0) return naoAchei(resposta, 'lanche não encontrado');
    if (ainda.rows[0].situacao === 'pulado') return { pulado: true };
    return resposta.status(409).send({ erro: 'ja_conferido', mensagem: 'este lanche já foi conferido' });
  });

  // ───────────────────── a gravação de treino (fatia T3) ─────────────────────

  const soQuemConfigura = (s: Sessao, resposta: FastifyReply) => {
    // decisão 3 do dono (15/10/2026): criar, cancelar e apagar é de quem configura a loja
    if (podeConfigurar(s)) return true;
    resposta.status(403).send({ erro: 'sem_permissao', mensagem: 'quem cria, cancela e apaga a gravação de treino é quem configura a loja' });
    return false;
  };

  app.post('/v1/lojas/:id/treino/gravacoes', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s || !soQuemConfigura(s, resposta)) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return naoAchei(resposta, 'não existe essa loja');
    const lida = lerNovaGravacao(req.body, new Date());
    if ('problema' in lida) return invalido(resposta, lida.problema);

    const cliente = await pool.connect();
    try {
      await cliente.query('begin');
      // a loja travada: dois pedidos ao mesmo tempo não passam juntos pela conferência de horário
      const loja = await cliente.query('select id from loja where id = $1 and tenant_id = $2 for update', [id, s.tenantId]);
      if (loja.rowCount === 0) {
        await cliente.query('rollback');
        return naoAchei(resposta, 'não existe essa loja');
      }
      // e o quadro da bancada desenhado (uma área que não é a imagem inteira): é dele que a loja recorta a montagem.
      // 16/10/2026: a primeira gravação foi no canal 1, sem quadro, e a loja não tinha o que ler.
      const canal = await cliente.query<{ nome: string; tem_quadro: boolean }>(
        `select p.nome,
                exists (select 1 from zona z where z.ponto_id = p.id and not z.principal and z.excluida_em is null) as tem_quadro
           from ponto p join setor st on st.id = p.setor_id
          where p.id = $1 and st.loja_id = $2 and p.origem = 'dvr'`,
        [lida.pontoId, id],
      );
      if (canal.rowCount === 0) {
        await cliente.query('rollback');
        return invalido(resposta, 'este canal não é uma câmera do gravador desta loja');
      }
      if (!canal.rows[0]!.tem_quadro) {
        await cliente.query('rollback');
        return invalido(resposta, 'este canal não tem o quadro da bancada desenhado: desenhe a área da montagem em Canais, ou escolha o canal da bancada');
      }
      const junto = await cliente.query(
        `select 1 from treino_gravacao
          where loja_id = $1 and ponto_id = $2 and situacao not in ('cancelada', 'falhou') and inicio < $4 and fim > $3
          limit 1`,
        [id, lida.pontoId, lida.inicio.toISOString(), lida.fim.toISOString()],
      );
      if (junto.rowCount) {
        await cliente.query('rollback');
        return resposta.status(409).send({ erro: 'sobreposta', mensagem: 'já existe uma gravação de treino deste canal nesse horário' });
      }
      const nova = await cliente.query(
        `insert into treino_gravacao (loja_id, ponto_id, chave, inicio, fim, origem, situacao, criado_por)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         returning id, chave, situacao`,
        [id, lida.pontoId, `console-${randomUUID()}`, lida.inicio.toISOString(), lida.fim.toISOString(), lida.de, lida.de === 'gravador' ? 'fila' : 'programada', s.usuarioId],
      );
      await cliente.query('commit');
      req.log.info({ loja: id, gravacao: nova.rows[0].id, de: lida.de, por: s.usuarioId }, 'gravação de treino CRIADA');
      return resposta.status(201).send({ id: nova.rows[0].id, chave: nova.rows[0].chave, situacao: nova.rows[0].situacao });
    } catch (e) {
      await cliente.query('rollback').catch(() => {});
      throw e;
    } finally {
      cliente.release();
    }
  });

  app.post('/v1/treino/gravacoes/:id/cancelar', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s || !soQuemConfigura(s, resposta)) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return naoAchei(resposta, 'gravação não encontrada');
    // do protótipo: cancela-se o que ainda não começou a ser lido (programada ou na fila)
    const r = await pool.query(
      `update treino_gravacao g set situacao = 'cancelada'
         from loja l
        where g.id = $1 and l.id = g.loja_id and l.tenant_id = $2 and g.situacao in ('programada', 'fila')
       returning g.id`,
      [id, s.tenantId],
    );
    if (r.rowCount === 1) {
      req.log.info({ gravacao: id, por: s.usuarioId }, 'gravação de treino CANCELADA');
      return { cancelada: true };
    }
    const ainda = await pool.query(
      `select g.situacao from treino_gravacao g join loja l on l.id = g.loja_id where g.id = $1 and l.tenant_id = $2`,
      [id, s.tenantId],
    );
    if (ainda.rowCount === 0) return naoAchei(resposta, 'gravação não encontrada');
    if (ainda.rows[0].situacao === 'cancelada') return { cancelada: true };
    return resposta.status(409).send({ erro: 'nao_cancela', mensagem: 'esta gravação já começou a ser lida: não dá mais para cancelar' });
  });

  app.post('/v1/treino/gravacoes/:id/apagar-imagens', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s || !soQuemConfigura(s, resposta)) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return naoAchei(resposta, 'gravação não encontrada');
    const cliente = await pool.connect();
    try {
      await cliente.query('begin');
      const g = await cliente.query(
        `select g.situacao from treino_gravacao g join loja l on l.id = g.loja_id where g.id = $1 and l.tenant_id = $2 for update of g`,
        [id, s.tenantId],
      );
      if (g.rowCount === 0) {
        await cliente.query('rollback');
        return naoAchei(resposta, 'gravação não encontrada');
      }
      if (g.rows[0].situacao === 'apagada') {
        await cliente.query('rollback');
        return { apagada: true, quadros: 0 };
      }
      // do protótipo: apaga-se a gravação já conferida — pronta, sem lanche esperando conferência
      const faltam = await cliente.query(`select count(*)::int as n from treino_lanche where gravacao_id = $1 and situacao <> 'conferido'`, [id]);
      if (g.rows[0].situacao !== 'pronta' || faltam.rows[0].n > 0) {
        await cliente.query('rollback');
        return resposta.status(409).send({
          erro: 'falta_conferir',
          mensagem: g.rows[0].situacao !== 'pronta' ? 'esta gravação ainda não foi lida' : `ainda há ${faltam.rows[0].n === 1 ? '1 lanche' : `${faltam.rows[0].n} lanches`} para conferir nesta gravação`,
        });
      }
      // os quadros saem da nuvem; o que foi aprendido (os exemplos e os números) fica
      const saiu = await cliente.query(
        `delete from treino_quadro q using treino_lanche l where l.id = q.lanche_id and l.gravacao_id = $1`,
        [id],
      );
      await cliente.query(`update treino_gravacao set situacao = 'apagada', apagada_em = now() where id = $1`, [id]);
      await cliente.query('commit');
      req.log.info({ gravacao: id, quadros: saiu.rowCount, por: s.usuarioId }, 'gravação de treino: imagens APAGADAS');
      return { apagada: true, quadros: saiu.rowCount ?? 0 };
    } catch (e) {
      await cliente.query('rollback').catch(() => {});
      throw e;
    } finally {
      cliente.release();
    }
  });

  // ───────────────────── o computador da loja e a gravação ─────────────────────

  async function doAgente(req: FastifyRequest, resposta: FastifyReply) {
    try {
      return await autenticarAgente(pool, req.headers.authorization);
    } catch (e) {
      if (e instanceof ErroDeAuth) {
        req.log.warn({ motivo: e.motivo }, 'credencial recusada na gravação de treino');
        resposta.status(e.status).send({ erro: e.motivo, mensagem: e.message });
        return null;
      }
      throw e;
    }
  }

  // o que a loja tem de fazer: as gravações a ler, e as que ela já pode apagar do computador dela
  app.get('/v1/agentes/treino/gravacoes', async (req, resposta) => {
    const agente = await doAgente(req, resposta);
    if (!agente) return;
    const [fazer, apagar] = await Promise.all([
      pool.query(
        `select g.id, g.chave, g.ponto_id, p.canal, g.inicio, g.fim, g.origem, g.situacao
           from treino_gravacao g
           left join ponto p on p.id = g.ponto_id
          where g.loja_id = $1 and g.situacao in ('programada', 'fila', 'lendo')
          order by g.inicio
          limit 50`,
        [agente.lojaId],
      ),
      pool.query(
        `select g.chave from treino_gravacao g where g.loja_id = $1 and (${SQL_DO_QUE_A_LOJA_APAGA}) order by g.criado_em desc limit 200`,
        [agente.lojaId],
      ),
    ]);
    return {
      gravacoes: fazer.rows.map((g) => ({
        id: g.id,
        chave: g.chave,
        pontoId: g.ponto_id,
        canal: g.canal,
        inicio: g.inicio,
        fim: g.fim,
        origem: g.origem,
        situacao: g.situacao,
      })),
      apagar: apagar.rows.map((g) => g.chave as string),
    };
  });

  app.post('/v1/agentes/treino/gravacoes/:id/andamento', async (req, resposta) => {
    const agente = await doAgente(req, resposta);
    if (!agente) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return naoAchei(resposta, 'gravação não encontrada');
    const lido = lerAndamento(req.body);
    if ('problema' in lido) return invalido(resposta, lido.problema);
    const cliente = await pool.connect();
    try {
      await cliente.query('begin');
      const g = await cliente.query(`select situacao from treino_gravacao where id = $1 and loja_id = $2 for update`, [id, agente.lojaId]);
      if (g.rowCount === 0) {
        await cliente.query('rollback');
        return naoAchei(resposta, 'gravação não encontrada');
      }
      if (!aindaEDaLoja(g.rows[0].situacao)) {
        // cancelada no console (ou já encerrada): a loja para de ler
        await cliente.query('rollback');
        return resposta.status(409).send({ erro: 'encerrada', situacao: g.rows[0].situacao, mensagem: `esta gravação está ${g.rows[0].situacao}: pare de ler` });
      }
      await cliente.query(
        `update treino_gravacao
            set situacao = $2,
                progresso = coalesce($3, progresso),
                motivo = $4,
                lida_em = case when $2 = 'pronta' then now() else lida_em end
          where id = $1`,
        [id, lido.situacao, lido.progresso, lido.motivo],
      );
      await cliente.query('commit');
      if (lido.situacao !== 'lendo') req.log.info({ gravacao: id, situacao: lido.situacao, motivo: lido.motivo }, 'gravação de treino: a loja contou');
      return { situacao: lido.situacao };
    } catch (e) {
      await cliente.query('rollback').catch(() => {});
      throw e;
    } finally {
      cliente.release();
    }
  });

  // ───────────────────── as sugestões para as fichas (fatia T6) ─────────────────────

  // quem configura responde: "vou mudar a ficha" (sim) ou "fica como está" (não). O Farol não muda a ficha.
  app.post('/v1/lojas/:id/treino/sugestoes', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!podeConfigurar(s)) return resposta.status(403).send({ erro: 'sem_permissao', mensagem: 'quem responde às sugestões é quem configura a loja' });
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return naoAchei(resposta, 'não existe essa loja');
    const corpo = (req.body ?? {}) as { chave?: unknown; decisao?: unknown; junto?: unknown };
    if (typeof corpo.chave !== 'string' || !corpo.chave || corpo.chave.length > 300) return invalido(resposta, 'chave: a sugestão respondida');
    if (!DECISOES.includes(corpo.decisao as DecisaoDaSugestao)) return invalido(resposta, `decisao: ${DECISOES.join(' ou ')}`);
    if (corpo.junto !== undefined && corpo.junto !== null && (typeof corpo.junto !== 'string' || !corpo.junto.trim() || corpo.junto.length > 200)) {
      return invalido(resposta, 'junto: o ingrediente das fichas');
    }
    const loja = await daLoja(pool, s.tenantId, id);
    if (!loja) return naoAchei(resposta, 'não existe essa loja');
    // a sugestão tem de existir AGORA, das conferências desta loja: não se responde ao que o Farol não sugeriu
    const sugestao = (await sugestoesDaLoja(id, loja.base)).agora.find((x) => x.chave === corpo.chave);
    if (!sugestao) return naoAchei(resposta, 'esta sugestão não existe mais: as conferências mudaram');
    // "É um ingrediente das fichas" (o protótipo aprovado em 19/10/2026): só para o nome fora das fichas, com o "sim".
    // O nome escrito vira um OUTRO NOME do ingrediente escolhido — que tem de estar nas fichas de hoje.
    let junto: string | null = null;
    if (typeof corpo.junto === 'string') {
      if (sugestao.tipo !== 'nome-fora' || corpo.decisao !== 'sim') return invalido(resposta, 'junto: só no "nome fora das fichas", com a resposta sim');
      const daFicha = ingredientesDaBase(loja.base).find((i) => chaveDoIngrediente(i.nome) === chaveDoIngrediente(corpo.junto as string));
      if (!daFicha) return invalido(resposta, 'junto: esse ingrediente não está nas fichas da loja');
      junto = daFicha.nome;
    }
    const cliente = await pool.connect();
    try {
      await cliente.query('begin');
      await cliente.query(
        `insert into treino_sugestao (loja_id, chave, decisao, resumo, decidido_por)
         values ($1, $2, $3, $4, $5)
         on conflict (loja_id, chave) do update
            set decisao = excluded.decisao, resumo = excluded.resumo, decidido_por = excluded.decidido_por, decidido_em = now()`,
        [id, sugestao.chave, corpo.decisao, JSON.stringify(sugestao), s.usuarioId],
      );
      if (junto) {
        await cliente.query(
          `insert into ingrediente_outro_nome (loja_id, chave, nome, ingrediente, criado_por)
           values ($1, $2, $3, $4, $5)
           on conflict (loja_id, chave) do update
              set nome = excluded.nome, ingrediente = excluded.ingrediente, criado_por = excluded.criado_por, criado_em = now()`,
          [id, chaveDoIngrediente(sugestao.ingrediente), sugestao.ingrediente, junto, s.usuarioId],
        );
      }
      await cliente.query('commit');
    } catch (e) {
      await cliente.query('rollback').catch(() => {});
      throw e;
    } finally {
      cliente.release();
    }
    req.log.info({ loja: id, sugestao: sugestao.chave, decisao: corpo.decisao, junto, por: s.usuarioId }, 'sugestão para as fichas RESPONDIDA');
    return { chave: sugestao.chave, decisao: corpo.decisao, junto };
  });
}
