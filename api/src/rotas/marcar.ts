// =====================================================================
// Marcar ingredientes: a loja manda os recortes da noite, a tela marca
// =====================================================================
// A24, fase F3 (migration 055; a lógica em `api/src/marcar.ts`). Protótipo
// "Marcar ingredientes" aprovado pelo dono em 24/10/2026.
//
//   • `POST /v1/agentes/treino/recortes` (token do agente): os recortes que
//     a loja escolheu da noite ao vivo, uns 25 por envio, na gravação
//     `ao-vivo` daquela noite. Mandar de novo troca o que ninguém marcou; o
//     marcado e o pulado ficam como estão;
//   • `GET /v1/lojas/:id/treino/recortes` (diretoria, gerência e supervisão,
//     como a conferência): as noites com recortes e os de uma noite — a que
//     tem recorte para marcar há mais tempo, ou a pedida em `?gravacao=` —,
//     a dúvida primeiro; os ingredientes das fichas em grupos; e as contas;
//   • `GET /v1/treino/recortes/:id/imagem`, `POST …/marcacao` e `POST …/pular`.
//     A marcação troca o exemplo daquele recorte na base da loja, na mesma
//     transação.
// =====================================================================

import { createHash } from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';

import { autenticarAgente, ErroDeAuth } from '../auth.js';
import { lerBase, type Base } from '../fichas.js';
import { ingredientesDaBase } from '../ingredientes.js';
import {
  acertouORecorte,
  deCima,
  DIAS_DOS_RECORTES,
  lerMarcacao,
  lerRecortesParaMarcar,
  MAX_RECORTES_POR_NOITE,
  MOTIVOS_DO_RECORTE,
  nomesParaMarcar,
} from '../marcar.js';
import { outrosNomesDaLoja } from '../outros-nomes.js';
import { podeAcompanhar } from '../rbac.js';
import { NOME_DO_NADA } from '../treino.js';
import { sessaoDe, type Sessao } from './sessao.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 25 recortes de até 300 kB, em base64, com folga. */
const MAX_DO_CORPO = 12 * 1024 * 1024;
/** As noites que a tela lista (as mais novas). */
const NOITES_NA_LISTA = 30;

/**
 * A imagem do recorte marcado (ou pulado) sai 30 dias depois; a linha fica, para a conta do acerto. O recorte que
 * ninguém marcou em 30 dias sai inteiro. Devolve quantas imagens e quantos recortes saíram.
 */
export async function apagarRecortesVencidos(pool: pg.Pool, agora: Date = new Date()): Promise<{ imagens: number; recortes: number }> {
  const r = await pool.query<{ imagens: number; recortes: number }>(
    `with sem_imagem as (
        update treino_recorte set imagem = null
         where imagem is not null and situacao <> 'marcar'
           and coalesce(marcado_em, recebido_em) < $1::timestamptz - make_interval(days => $2)
        returning 1),
      sairam as (
        delete from treino_recorte
         where situacao = 'marcar' and recebido_em < $1::timestamptz - make_interval(days => $2)
        returning 1)
     select (select count(*) from sem_imagem)::int as imagens, (select count(*) from sairam)::int as recortes`,
    [agora.toISOString(), DIAS_DOS_RECORTES],
  );
  return r.rows[0]!;
}

type LinhaDoRecorte = {
  id: string;
  chave: string;
  lanche: string | null;
  hora: Date;
  peca: number | null;
  motivo: string;
  palpite: string | null;
  nota: number | null;
  contorno: number[][][] | null;
  largura: number | null;
  altura: number | null;
  situacao: 'marcar' | 'marcado' | 'pulado';
  resposta: unknown;
  acertou: boolean | null;
  marcado_em: Date | null;
  marcado_por_nome: string | null;
  tem_imagem: boolean;
};

export function rotasDeMarcar(app: FastifyInstance, pool: pg.Pool): void {
  async function quem(req: FastifyRequest, resposta: FastifyReply): Promise<Sessao | null> {
    const s = await sessaoDe(pool, req);
    if (!s) {
      resposta.status(401).send({ erro: 'sem_sessao', mensagem: 'faça login' });
      return null;
    }
    // como a conferência (decisão do dono, 15/10/2026): marcam diretoria, gerência e supervisão
    if (!podeAcompanhar(s)) {
      resposta.status(403).send({ erro: 'sem_permissao', mensagem: 'seu perfil não vê o treinamento da loja' });
      return null;
    }
    return s;
  }
  const naoAchei = (resposta: FastifyReply, mensagem: string) => resposta.status(404).send({ erro: 'nao_encontrado', mensagem });
  const invalido = (resposta: FastifyReply, mensagem: string) => resposta.status(422).send({ erro: 'validacao', mensagem });

  /** As fichas da loja (`base` nula = sem fichas) — ou `null` se a loja não é da conta. */
  async function fichasDaLoja(cliente: pg.Pool | pg.PoolClient, tenantId: string, lojaId: string): Promise<{ base: Base | null } | null> {
    const r = await cliente.query(
      `select f.conteudo from loja l left join fichas_da_loja f on f.loja_id = l.id where l.id = $1 and l.tenant_id = $2`,
      [lojaId, tenantId],
    );
    if (r.rowCount === 0) return null;
    return { base: lerBase(r.rows[0].conteudo) as Base | null };
  }

  // ───────────────────── a loja manda os recortes ─────────────────────

  app.post('/v1/agentes/treino/recortes', { bodyLimit: MAX_DO_CORPO }, async (req, resposta) => {
    let agente;
    try {
      agente = await autenticarAgente(pool, req.headers.authorization);
    } catch (e) {
      if (e instanceof ErroDeAuth) {
        req.log.warn({ motivo: e.motivo }, 'credencial recusada nos recortes para marcar');
        return resposta.status(e.status).send({ erro: e.motivo, mensagem: e.message });
      }
      throw e;
    }
    const lido = lerRecortesParaMarcar(req.body);
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
      // a mesma gravação dos lanches da noite; a linha dela fica travada até o fim: dois envios da mesma noite passam
      // um depois do outro (e a conta do máximo da noite não se perde no meio)
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
      const encerrada = gravacao.rows[0].situacao as string;
      if (encerrada === 'cancelada' || encerrada === 'apagada') {
        await cliente.query('rollback');
        return resposta.status(409).send({ erro: 'gravacao_encerrada', mensagem: `esta gravação foi ${encerrada}: a loja não manda mais recortes dela` });
      }
      const chaves = lido.recortes.map((r) => r.chave);
      const outros = await cliente.query<{ n: number }>(
        `select count(*)::int as n from treino_recorte where gravacao_id = $1 and not (chave = any($2::text[]))`,
        [gravacaoId, chaves],
      );
      if (outros.rows[0]!.n + chaves.length > MAX_RECORTES_POR_NOITE) {
        await cliente.query('rollback');
        return invalido(resposta, `a noite passaria de ${MAX_RECORTES_POR_NOITE} recortes (já tem ${outros.rows[0]!.n})`);
      }
      const saida: Array<{ chave: string; id: string; situacao: string; novo: boolean }> = [];
      for (const r of lido.recortes) {
        const sha = createHash('sha256').update(r.bytes).digest('hex');
        // o que alguém marcou (ou pulou) não muda por baixo: a troca só vale enquanto ele espera a marcação
        const gravado = await cliente.query<{ id: string; situacao: string; novo: boolean }>(
          `insert into treino_recorte
             (gravacao_id, loja_id, chave, lanche, hora, peca, motivo, palpite, nota, contorno, imagem, largura, altura, sha256)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
           on conflict (gravacao_id, chave) do update
              set lanche = excluded.lanche, hora = excluded.hora, peca = excluded.peca, motivo = excluded.motivo,
                  palpite = excluded.palpite, nota = excluded.nota, contorno = excluded.contorno, imagem = excluded.imagem,
                  largura = excluded.largura, altura = excluded.altura, sha256 = excluded.sha256, recebido_em = now()
            where treino_recorte.situacao = 'marcar'
           returning id, situacao, (xmax = 0) as novo`,
          [
            gravacaoId, agente.lojaId, r.chave, r.lanche, r.hora, r.peca, r.motivo, r.palpite, r.nota,
            r.contorno ? JSON.stringify(r.contorno) : null, r.bytes, r.largura, r.altura, sha,
          ],
        );
        if (gravado.rows[0]) {
          saida.push({ chave: r.chave, ...gravado.rows[0] });
          continue;
        }
        const ja = await cliente.query<{ id: string; situacao: string }>(
          'select id, situacao from treino_recorte where gravacao_id = $1 and chave = $2',
          [gravacaoId, r.chave],
        );
        saida.push({ chave: r.chave, id: ja.rows[0]!.id, situacao: ja.rows[0]!.situacao, novo: false });
      }
      await cliente.query('commit');
      req.log.info({ loja: agente.lojaId, gravacao: gravacaoId, recortes: saida.length, novos: saida.filter((s) => s.novo).length }, 'recortes para marcar RECEBIDOS');
      return { gravacaoId, recortes: saida };
    } catch (e) {
      await cliente.query('rollback').catch(() => {});
      throw e;
    } finally {
      cliente.release();
    }
  });

  // ───────────────────── a tela: as noites e os recortes de uma ─────────────────────

  app.get('/v1/lojas/:id/treino/recortes', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return invalido(resposta, 'id inválido');
    const { gravacao: pedida } = (req.query ?? {}) as { gravacao?: string };
    if (pedida !== undefined && !UUID.test(pedida)) return invalido(resposta, 'gravacao: o id de uma noite');
    const loja = await fichasDaLoja(pool, s.tenantId, id);
    if (!loja) return naoAchei(resposta, 'não existe essa loja');

    const [noites, contas] = await Promise.all([
      pool.query(
        `select g.id, g.inicio, g.fim, p.nome as canal_nome, p.canal as canal_numero,
                count(r.*)::int as total,
                (count(r.*) filter (where r.situacao = 'marcar'))::int as marcar,
                (count(r.*) filter (where r.situacao = 'marcado'))::int as marcados,
                (count(r.*) filter (where r.situacao = 'pulado'))::int as pulados
           from treino_recorte r
           join treino_gravacao g on g.id = r.gravacao_id
           left join ponto p on p.id = g.ponto_id
          where r.loja_id = $1
          group by g.id, p.nome, p.canal
          order by g.inicio desc
          limit $2`,
        [id, NOITES_NA_LISTA],
      ),
      // as contas, sobre TODOS os recortes da loja
      pool.query(
        `select (count(*) filter (where situacao = 'marcado'))::int as marcados,
                (count(*) filter (where acertou is not null))::int as com_nome,
                (count(*) filter (where acertou))::int as acertou
           from treino_recorte where loja_id = $1`,
        [id],
      ),
    ]);
    // a noite: a pedida; senão a que espera marcação há mais tempo; senão a mais nova
    const lista = noites.rows as Array<{ id: string; inicio: Date; marcar: number }>;
    const escolhida =
      (pedida && lista.find((n) => n.id === pedida)?.id) ||
      [...lista].reverse().find((n) => n.marcar > 0)?.id ||
      lista[0]?.id ||
      null;
    const recortes = escolhida
      ? (
          await pool.query<LinhaDoRecorte>(
            `select r.id, r.chave, r.lanche, r.hora, r.peca, r.motivo, r.palpite, r.nota, r.contorno, r.largura, r.altura,
                    r.situacao, r.resposta, r.acertou, r.marcado_em, u.nome as marcado_por_nome, (r.imagem is not null) as tem_imagem
               from treino_recorte r
               left join usuario u on u.id = r.marcado_por
              where r.gravacao_id = $1 and r.loja_id = $2
              order by array_position($3::text[], r.motivo), r.hora, r.chave`,
            [escolhida, id, [...MOTIVOS_DO_RECORTE]],
          )
        ).rows
      : [];
    const c = contas.rows[0] as { marcados: number; com_nome: number; acertou: number };
    return {
      noites: (noites.rows as Array<Record<string, unknown>>).map((n) => ({
        gravacaoId: n.id,
        inicio: n.inicio,
        fim: n.fim,
        canal: n.canal_nome ? { nome: n.canal_nome, numero: n.canal_numero } : null,
        total: n.total,
        marcar: n.marcar,
        marcados: n.marcados,
        pulados: n.pulados,
      })),
      noite: escolhida,
      /** A dúvida primeiro; depois o começo das peças e o resto, pela hora. A ordem não muda enquanto a pessoa marca. */
      recortes: recortes.map((r) => ({
        id: r.id,
        lanche: r.lanche,
        hora: r.hora,
        peca: r.peca,
        motivo: r.motivo,
        palpite: r.palpite,
        nota: r.nota,
        contorno: r.contorno,
        largura: r.largura,
        altura: r.altura,
        situacao: r.situacao,
        resposta: r.resposta,
        acertou: r.acertou,
        marcadoEm: r.marcado_em,
        marcadoPor: r.marcado_por_nome,
        /** Falso: a imagem já saiu (30 dias depois da marcação). */
        temImagem: r.tem_imagem,
      })),
      /** Os ingredientes das fichas para a pilha, em grupos; `conta`: marca com quantidade (− e +). */
      nomes: nomesParaMarcar(loja.base),
      /** "O Farol acertou antes": dos marcados com um ingrediente em cima, em quantos o juiz tinha dito esse nome. */
      contas: { marcados: c.marcados, comNome: c.com_nome, acertou: c.acertou },
      diasDasImagens: DIAS_DOS_RECORTES,
    };
  });

  app.get('/v1/treino/recortes/:id/imagem', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return naoAchei(resposta, 'recorte não encontrado');
    const r = await pool.query(
      `select r.imagem, r.tipo
         from treino_recorte r
         join loja lo on lo.id = r.loja_id
        where r.id = $1 and lo.tenant_id = $2`,
      [id, s.tenantId],
    );
    if (r.rowCount === 0) return naoAchei(resposta, 'recorte não encontrado');
    if (!r.rows[0].imagem) return naoAchei(resposta, `a imagem deste recorte já saiu (${DIAS_DOS_RECORTES} dias depois da marcação)`);
    return resposta
      .header('content-type', r.rows[0].tipo || 'image/jpeg')
      .header('x-content-type-options', 'nosniff')
      // `private`: é imagem de dentro da loja. Sem `immutable`: a loja pode trocar o recorte que ninguém marcou
      .header('cache-control', 'private, max-age=3600')
      .send(r.rows[0].imagem);
  });

  // ───────────────────── a tela: marcar e pular ─────────────────────

  app.post('/v1/treino/recortes/:id/marcacao', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return naoAchei(resposta, 'recorte não encontrado');

    const cliente = await pool.connect();
    try {
      await cliente.query('begin');
      const r = await cliente.query<{ id: string; loja_id: string; palpite: string | null; tem_imagem: boolean; ponto_id: string | null }>(
        `select r.id, r.loja_id, r.palpite, (r.imagem is not null) as tem_imagem, g.ponto_id
           from treino_recorte r
           join treino_gravacao g on g.id = r.gravacao_id
           join loja lo on lo.id = r.loja_id
          where r.id = $1 and lo.tenant_id = $2
            for update of r`,
        [id, s.tenantId],
      );
      const recorte = r.rows[0];
      if (!recorte) {
        await cliente.query('rollback');
        return naoAchei(resposta, 'recorte não encontrado');
      }
      if (!recorte.tem_imagem) {
        await cliente.query('rollback');
        return resposta.status(409).send({ erro: 'imagem_vencida', mensagem: `a imagem deste recorte já saiu (${DIAS_DOS_RECORTES} dias depois da marcação)` });
      }
      const loja = (await fichasDaLoja(cliente, s.tenantId, recorte.loja_id))!;
      const outros = await outrosNomesDaLoja(cliente, recorte.loja_id);
      const marcacao = lerMarcacao(req.body, ingredientesDaBase(loja.base).map((i) => i.nome), outros);
      if ('problema' in marcacao) {
        await cliente.query('rollback');
        return invalido(resposta, marcacao.problema);
      }
      const cima = deCima(marcacao);
      const acertou = acertouORecorte(recorte.palpite, marcacao, outros);
      await cliente.query(
        `update treino_recorte
            set situacao = 'marcado', resposta = $2, cima = $3, acertou = $4, marcado_por = $5, marcado_em = now()
          where id = $1`,
        [id, JSON.stringify(marcacao), cima, acertou, s.usuarioId],
      );
      // marcar de novo troca o exemplo deste recorte
      await cliente.query('delete from base_frame where recorte_id = $1', [id]);
      let exemplos = 0;
      // o de cima ensina o ingrediente; "não é ingrediente" ensina o que não é comida (o mesmo da conferência,
      // migration 054); "não dá para ver" não ensina nada
      const item = cima
        ? { tipo: 'item', nome: cima }
        : marcacao.estado === 'nada'
          ? { tipo: 'nada', nome: NOME_DO_NADA }
          : null;
      if (item) {
        const base = await cliente.query<{ id: string }>(
          `insert into base_conhecimento (loja_id, tipo, nome) values ($1, $2, $3)
           on conflict (loja_id, tipo, lower(btrim(nome))) do update set atualizado_em = now()
           returning id`,
          [recorte.loja_id, item.tipo, item.nome],
        );
        // a mesma imagem que a base já tem para o mesmo item (a conferência do mesmo passo, por exemplo) entra uma vez só
        const novo = await cliente.query(
          `insert into base_frame (base_id, origem, imagem, tipo, largura, altura, sha256, ponto_id, criado_por, recorte_id)
           select $1, 'bancada', r.imagem, r.tipo, r.largura, r.altura, r.sha256, $2, $3, r.id
             from treino_recorte r
            where r.id = $4
              and not exists (select 1 from base_frame b where b.base_id = $1 and b.sha256 = r.sha256)`,
          [base.rows[0]!.id, recorte.ponto_id, s.usuarioId, id],
        );
        exemplos = novo.rowCount ?? 0;
      }
      await cliente.query('commit');
      req.log.info({ recorte: id, estado: marcacao.estado, cima, acertou, exemplos, por: s.usuarioId }, 'recorte MARCADO');
      return { marcado: true, estado: marcacao.estado, cima, acertou, exemplos };
    } catch (e) {
      await cliente.query('rollback').catch(() => {});
      throw e;
    } finally {
      cliente.release();
    }
  });

  app.post('/v1/treino/recortes/:id/pular', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return naoAchei(resposta, 'recorte não encontrado');
    const r = await pool.query(
      `update treino_recorte r set situacao = 'pulado'
         from loja lo
        where r.id = $1 and lo.id = r.loja_id and lo.tenant_id = $2 and r.situacao = 'marcar'
       returning r.id`,
      [id, s.tenantId],
    );
    if (r.rowCount === 1) return { pulado: true };
    const ainda = await pool.query(
      `select r.situacao from treino_recorte r join loja lo on lo.id = r.loja_id where r.id = $1 and lo.tenant_id = $2`,
      [id, s.tenantId],
    );
    if (ainda.rowCount === 0) return naoAchei(resposta, 'recorte não encontrado');
    if (ainda.rows[0].situacao === 'pulado') return { pulado: true };
    return resposta.status(409).send({ erro: 'ja_marcado', mensagem: 'este recorte já foi marcado' });
  });
}
