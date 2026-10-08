// =====================================================================
// A foto padrão do canal
// =====================================================================
// O quadro do canal com o ambiente como deve ficar: limpo, organizado e sem
// ninguém na frente. A loja compara o quadro de agora com ela antes de
// perguntar a alguém; e, quando pergunta à nuvem, a foto padrão vai junto.
//
// **Guardar é copiar o quadro que o canal já tem.** Não há envio de imagem
// pelo console: a foto padrão é o quadro de preview (o que o agente
// capturou, com rosto borrado) no instante em que alguém olhou e disse
// "é assim que deve ficar". Quem quer outra cena atualiza o quadro antes.
//
// **No máximo quatro por canal** (dia, noite, loja fechada…). São imagens
// no banco: o espaço fica preso ao número de câmeras, não ao tempo.
//
// **A listagem nunca traz os bytes.** Quatro nomes não podem custar quatro
// imagens.
//
// O agente recebe a lista (id e `sha256`) junto com a configuração e baixa
// cada imagem por `GET /v1/agentes/padroes/:id` — só as que ainda não tem.
// =====================================================================

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';

import { autenticarAgente, ErroDeAuth } from '../auth.js';
import { exigirConfigurar } from '../rbac.js';
import { sessaoDe, type Sessao } from './sessao.js';

/** Quantas fotos padrão um canal guarda. */
export const MAX_PADROES_POR_CANAL = 4;
const MAX_NOME = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// O que a tela mostra de uma foto. Sem a imagem.
const CAMPOS = `f.id, f.ponto_id, f.nome, f.largura, f.altura, f.pessoas,
                f.capturada_em, f.criada_em,
                (select u.nome from usuario u where u.id = f.criada_por) as criada_por`;

type Linha = {
  id: string;
  ponto_id: string;
  nome: string;
  largura: number | null;
  altura: number | null;
  pessoas: number | null;
  capturada_em: Date;
  criada_em: Date;
  criada_por: string | null;
};

const paraTela = (f: Linha) => ({
  id: f.id,
  pontoId: f.ponto_id,
  nome: f.nome,
  largura: f.largura,
  altura: f.altura,
  /** Pessoas que o detector da loja viu neste quadro. Nulo = não medido. */
  pessoas: f.pessoas,
  capturadaEm: f.capturada_em,
  criadaEm: f.criada_em,
  criadaPor: f.criada_por,
});

/** O nome da foto, limpo — ou a frase do problema. */
export function lerNomeDaFoto(valor: unknown): { nome?: string; problema?: string } {
  if (typeof valor !== 'string' || !valor.trim()) return { problema: 'dê um nome à foto padrão (ex.: "Noite, loja aberta")' };
  const nome = valor.trim();
  if (nome.length > MAX_NOME) return { problema: `o nome da foto tem no máximo ${MAX_NOME} caracteres` };
  return { nome };
}

export function rotasDePadroes(app: FastifyInstance, pool: pg.Pool): void {
  async function quem(req: FastifyRequest, resposta: FastifyReply): Promise<Sessao | null> {
    const s = await sessaoDe(pool, req);
    if (!s) {
      resposta.status(401).send({ erro: 'sem_sessao', mensagem: 'faça login' });
      return null;
    }
    return s;
  }

  // ───────────────────── as fotos padrão do canal ─────────────────────

  app.get('/v1/pontos/:id/padroes', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'canal não encontrado' });

    const dono = await pool.query(
      `select 1
         from ponto p
         join setor st on st.id = p.setor_id
         join loja  l  on l.id  = st.loja_id
        where p.id = $1 and l.tenant_id = $2 and p.excluido_em is null`,
      [id, s.tenantId],
    );
    if (dono.rowCount === 0) return resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'canal não encontrado' });

    const { rows } = await pool.query<Linha>(
      `select ${CAMPOS} from foto_padrao f where f.ponto_id = $1 order by f.criada_em desc`,
      [id],
    );
    return { padroes: rows.map(paraTela), maximo: MAX_PADROES_POR_CANAL };
  });

  // ─────────────── guardar o quadro de agora como foto padrão ───────────────

  app.post('/v1/pontos/:id/padroes', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirConfigurar(s, resposta)) return;

    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'canal não encontrado' });
    const lido = lerNomeDaFoto(((req.body ?? {}) as { nome?: unknown }).nome);
    if (lido.problema) return resposta.status(422).send({ erro: 'validacao', mensagem: lido.problema });

    const cliente = await pool.connect();
    try {
      await cliente.query('begin');

      // A linha do canal fica travada até o fim: duas pessoas guardando ao
      // mesmo tempo passam uma depois da outra, e a conta do máximo vale.
      const ponto = await cliente.query(
        `select p.id, (p.preview is not null) as tem_quadro
           from ponto p
           join setor st on st.id = p.setor_id
           join loja  l  on l.id  = st.loja_id
          where p.id = $1 and l.tenant_id = $2 and p.excluido_em is null
            for update of p`,
        [id, s.tenantId],
      );
      if (ponto.rowCount === 0) {
        await cliente.query('rollback');
        return resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'canal não encontrado' });
      }
      if (!ponto.rows[0].tem_quadro) {
        await cliente.query('rollback');
        return resposta.status(409).send({
          erro: 'sem_quadro',
          mensagem: 'este canal ainda não tem quadro. Atualize o quadro e guarde a foto padrão em seguida.',
        });
      }

      const ja = await cliente.query('select count(*)::int as n from foto_padrao where ponto_id = $1', [id]);
      if (ja.rows[0].n >= MAX_PADROES_POR_CANAL) {
        await cliente.query('rollback');
        return resposta.status(409).send({
          erro: 'limite',
          mensagem: `este canal já tem ${MAX_PADROES_POR_CANAL} fotos padrão, que é o máximo. Exclua uma para guardar outra.`,
        });
      }

      // A imagem é copiada DENTRO do banco, com o resumo dela calculado
      // lá: os bytes não passam por este processo.
      let nova;
      try {
        nova = await cliente.query<Linha>(
          `with f as (
             insert into foto_padrao (ponto_id, nome, imagem, tipo, largura, altura, sha256,
                                      pessoas, capturada_em, criada_por)
             select p.id, $2, p.preview, coalesce(p.preview_tipo, 'image/jpeg'),
                    p.preview_largura, p.preview_altura, encode(sha256(p.preview), 'hex'),
                    p.preview_pessoas, coalesce(p.preview_em, now()), $3
               from ponto p
              where p.id = $1
             returning *
           )
           select ${CAMPOS} from f`,
          [id, lido.nome, s.usuarioId],
        );
      } catch (e) {
        if ((e as { code?: string }).code === '23505') {
          await cliente.query('rollback');
          return resposta.status(409).send({
            erro: 'nome_repetido',
            mensagem: `este canal já tem uma foto padrão chamada “${lido.nome}”. Dê outro nome.`,
          });
        }
        throw e;
      }

      await cliente.query('commit');
      req.log.info({ ponto: id, foto: nova.rows[0]!.id, por: s.usuarioId }, 'foto padrão GUARDADA');
      return resposta.status(201).send(paraTela(nova.rows[0]!));
    } catch (e) {
      await cliente.query('rollback').catch(() => {});
      throw e;
    } finally {
      cliente.release();
    }
  });

  // ───────────────────────── a imagem ─────────────────────────

  app.get('/v1/padroes/:id/imagem', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return resposta.status(404).send({ erro: 'nao_encontrada', mensagem: 'foto padrão não encontrada' });

    const r = await pool.query(
      `select f.imagem, f.tipo
         from foto_padrao f
         join ponto p  on p.id  = f.ponto_id
         join setor st on st.id = p.setor_id
         join loja  l  on l.id  = st.loja_id
        where f.id = $1 and l.tenant_id = $2 and p.excluido_em is null`,
      [id, s.tenantId],
    );
    if (r.rowCount === 0) return resposta.status(404).send({ erro: 'nao_encontrada', mensagem: 'foto padrão não encontrada' });

    return resposta
      .header('content-type', r.rows[0].tipo || 'image/jpeg')
      // A foto de um id nunca muda (mudar é guardar outra): o navegador
      // pode ficar com ela. `private`: é imagem de dentro da loja.
      .header('cache-control', 'private, max-age=86400, immutable')
      .send(r.rows[0].imagem);
  });

  // ───────────────────────── excluir ─────────────────────────

  app.delete('/v1/padroes/:id', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirConfigurar(s, resposta)) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return resposta.status(404).send({ erro: 'nao_encontrada', mensagem: 'foto padrão não encontrada' });

    // A foto some de verdade: nada do histórico aponta para ela, e é
    // imagem de dentro da loja — não há por que guardar o que foi excluído.
    const r = await pool.query(
      `delete from foto_padrao f
        using ponto p, setor st, loja l
        where f.id = $1 and p.id = f.ponto_id and st.id = p.setor_id and l.id = st.loja_id
          and l.tenant_id = $2
       returning f.ponto_id, f.nome`,
      [id, s.tenantId],
    );
    if (r.rowCount === 0) return resposta.status(404).send({ erro: 'nao_encontrada', mensagem: 'foto padrão não encontrada' });

    const n = await pool.query('select count(*)::int as n from foto_padrao where ponto_id = $1', [r.rows[0].ponto_id]);
    req.log.info({ ponto: r.rows[0].ponto_id, foto: id, por: s.usuarioId }, 'foto padrão EXCLUÍDA');
    return { excluida: true, nome: r.rows[0].nome as string, restantes: n.rows[0].n as number };
  });

  // ───────────────── agente: baixa a foto para comparar na loja ─────────────────

  app.get('/v1/agentes/padroes/:id', async (req, resposta) => {
    let agente;
    try {
      agente = await autenticarAgente(pool, req.headers.authorization);
    } catch (e) {
      if (e instanceof ErroDeAuth) {
        return resposta.status(e.status).send({ erro: e.motivo, mensagem: e.message });
      }
      throw e;
    }
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return resposta.status(404).send({ erro: 'nao_encontrada', mensagem: 'foto padrão não encontrada' });

    // A foto tem de ser de um canal DESTA loja: o token de uma loja não
    // baixa a imagem de outra.
    const r = await pool.query(
      `select f.imagem, f.tipo, f.sha256
         from foto_padrao f
         join ponto p  on p.id  = f.ponto_id
         join setor st on st.id = p.setor_id
        where f.id = $1 and st.loja_id = $2 and p.excluido_em is null`,
      [id, agente.lojaId],
    );
    if (r.rowCount === 0) return resposta.status(404).send({ erro: 'nao_encontrada', mensagem: 'foto padrão não encontrada' });

    return resposta
      .header('content-type', r.rows[0].tipo || 'image/jpeg')
      .header('x-farol-sha256', r.rows[0].sha256)
      .header('cache-control', 'no-store')
      .send(r.rows[0].imagem);
  });
}
