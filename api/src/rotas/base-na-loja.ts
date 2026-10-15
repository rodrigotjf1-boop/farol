// =====================================================================
// A base de conhecimento desce para a loja: a lista e cada quadro
// =====================================================================
// A21, fatia T5 (a parte da nuvem). A leitura da bancada roda NO
// COMPUTADOR DA LOJA, sem nuvem (o dono, 14/10/2026: "prioridade local —
// falha ou tirar dúvida, nuvem, último caso"). Para ela comparar com o que
// já foi ensinado, a base da loja desce para lá:
//
//   • `GET /v1/agentes/base` — os ingredientes da loja que têm o que
//     ensinar: as fotos de referência (fatia T1), os exemplos da bancada
//     (a conferência, fatia T4) e o "não se vê de cima". De cada quadro vão
//     só o id, a origem, o resumo (sha256) e o tamanho; a `impressao` muda
//     quando qualquer um deles muda. A loja pede antes de ler uma gravação
//     de treino (e uma vez por dia), compara com a cópia dela e baixa só o
//     que falta — como a foto padrão (`padroes.ts`);
//   • `GET /v1/agentes/base/quadros/:id` — a imagem de um quadro DESTA
//     loja. Outra loja não acha nada (404).
//
// Com o token do agente: a loja sai do token, nunca de um parâmetro. O
// contrato é `contratos/base-de-conhecimento.json`.
// =====================================================================

import { createHash } from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';

import { autenticarAgente, ErroDeAuth } from '../auth.js';
import { chaveDoIngrediente } from '../ingredientes.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type QuadroDaBase = { id: string; origem: 'foto' | 'bancada'; sha256: string | null; largura: number | null; altura: number | null };
export type ItemDaBase = { nome: string; visivel: boolean; quadros: QuadroDaBase[] };

/**
 * A marca da base: muda quando entra ou sai um quadro, quando um quadro muda de imagem ou quando um ingrediente passa
 * a "não se vê de cima" (ou volta). A ordem dos itens e dos quadros não muda a marca.
 */
export function impressaoDaBaseDaLoja(itens: ItemDaBase[]): string {
  const canonica = [...itens]
    .map((i) => [chaveDoIngrediente(i.nome), i.visivel, [...i.quadros].map((q) => [q.id, q.sha256 ?? '']).sort((a, b) => a[0]!.localeCompare(b[0]!))] as const)
    .sort((a, b) => a[0].localeCompare(b[0]));
  return createHash('sha256').update(JSON.stringify(canonica), 'utf8').digest('hex');
}

export function rotasDaBaseNaLoja(app: FastifyInstance, pool: pg.Pool): void {
  async function doAgente(req: FastifyRequest, resposta: FastifyReply) {
    try {
      return await autenticarAgente(pool, req.headers.authorization);
    } catch (e) {
      if (e instanceof ErroDeAuth) {
        req.log.warn({ motivo: e.motivo }, 'credencial recusada na base da loja');
        resposta.status(e.status).send({ erro: e.motivo, mensagem: e.message });
        return null;
      }
      throw e;
    }
  }

  app.get('/v1/agentes/base', async (req, resposta) => {
    const agente = await doAgente(req, resposta);
    if (!agente) return;
    const r = await pool.query<{ nome: string; visivel: boolean; quadros: QuadroDaBase[] | null }>(
      `select b.nome, b.visivel,
              (select jsonb_agg(jsonb_build_object('id', f.id, 'origem', f.origem, 'sha256', f.sha256, 'largura', f.largura, 'altura', f.altura)
                                order by f.criado_em, f.id)
                 from base_frame f
                where f.base_id = b.id and f.imagem is not null and f.origem in ('foto', 'bancada')) as quadros
         from base_conhecimento b
        where b.loja_id = $1 and b.tipo = 'item'
        order by lower(btrim(b.nome))`,
      [agente.lojaId],
    );
    // o ingrediente sem nada a ensinar (sem quadro e visível) não desce: a loja não teria o que fazer com ele
    const itens: ItemDaBase[] = r.rows
      .map((i) => ({ nome: i.nome, visivel: i.visivel, quadros: i.quadros ?? [] }))
      .filter((i) => i.quadros.length > 0 || !i.visivel);
    return resposta.header('cache-control', 'no-store').send({ impressao: impressaoDaBaseDaLoja(itens), itens });
  });

  app.get('/v1/agentes/base/quadros/:id', async (req, resposta) => {
    const agente = await doAgente(req, resposta);
    if (!agente) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'quadro não encontrado' });
    const r = await pool.query(
      `select f.imagem, f.tipo
         from base_frame f
         join base_conhecimento b on b.id = f.base_id
        where f.id = $1 and b.loja_id = $2 and f.imagem is not null`,
      [id, agente.lojaId],
    );
    if (r.rowCount === 0) return resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'quadro não encontrado' });
    return resposta
      .header('content-type', r.rows[0].tipo || 'image/jpeg')
      .header('x-content-type-options', 'nosniff')
      // o quadro de um id nunca muda de imagem
      .header('cache-control', 'private, max-age=86400, immutable')
      .send(r.rows[0].imagem);
  });
}
