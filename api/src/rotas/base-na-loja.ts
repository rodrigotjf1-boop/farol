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
import { lerBase } from '../fichas.js';
import { chaveDoIngrediente, ingredientesDaBase } from '../ingredientes.js';
import { chaveQueConta, outrosNomesDaLoja } from '../outros-nomes.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type QuadroDaBase = { id: string; origem: 'foto' | 'bancada'; sha256: string | null; largura: number | null; altura: number | null };
export type ItemDaBase = { nome: string; visivel: boolean; quadros: QuadroDaBase[] };

/**
 * A marca da base: muda quando entra ou sai um quadro, quando um quadro muda de imagem ou quando um ingrediente passa
 * a "não se vê de cima" (ou volta). A ordem dos itens e dos quadros não muda a marca. Os quadros do "não era
 * ingrediente" (migration 054) entram na marca só quando há algum: a marca das lojas sem eles fica a mesma.
 */
export function impressaoDaBaseDaLoja(itens: ItemDaBase[], nada: QuadroDaBase[] = []): string {
  const ordenados = (qs: QuadroDaBase[]) => [...qs].map((q) => [q.id, q.sha256 ?? '']).sort((a, b) => a[0]!.localeCompare(b[0]!));
  const canonica: unknown[] = [...itens]
    .map((i) => [chaveDoIngrediente(i.nome), i.visivel, ordenados(i.quadros)] as const)
    .sort((a, b) => a[0].localeCompare(b[0]));
  if (nada.length) canonica.push(['__nada__', ordenados(nada)]);
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
    const r = await pool.query<{ nome: string; tipo: 'item' | 'fora'; visivel: boolean; quadros: QuadroDaBase[] | null }>(
      `select b.nome, b.tipo, b.visivel,
              (select jsonb_agg(jsonb_build_object('id', f.id, 'origem', f.origem, 'sha256', f.sha256, 'largura', f.largura, 'altura', f.altura)
                                order by f.criado_em, f.id)
                 from base_frame f
                where f.base_id = b.id and f.imagem is not null and f.origem in ('foto', 'bancada')) as quadros
         from base_conhecimento b
        where b.loja_id = $1 and b.tipo in ('item', 'fora')
        order by lower(btrim(b.nome)), b.tipo`,
      [agente.lojaId],
    );
    // O mesmo ingrediente escrito de dois jeitos ("Pão de Brioche" na conferência, "Pão Brioche" na ficha) desce como
    // UM, com o nome da ficha e os quadros dos dois: a loja aprende o ingrediente que a ficha conhece (o dono,
    // 19/10/2026). Um deles "não se vê de cima": o ingrediente não se vê. O OUTRO NOME (migration 053: "Hambúrguer",
    // juntado ao "Blend da casa") desce do mesmo jeito, dentro do ingrediente das fichas.
    const [fichas, outros] = await Promise.all([
      pool.query<{ conteudo: unknown }>(`select conteudo from fichas_da_loja where loja_id = $1`, [agente.lojaId]),
      outrosNomesDaLoja(pool, agente.lojaId),
    ]);
    const nomeDaFicha = new Map(ingredientesDaBase(lerBase(fichas.rows[0]?.conteudo ?? null)).map((i) => [chaveDoIngrediente(i.nome), i.nome]));
    const porChave = new Map<string, ItemDaBase>();
    for (const i of r.rows) {
      const k = chaveQueConta(i.nome, outros);
      // o exemplo do nome escrito à mão (tipo 'fora') só desce quando o nome vale: é outro nome de um ingrediente das
      // fichas, ou a ficha chegou com ele
      if (i.tipo === 'fora' && !nomeDaFicha.has(k)) continue;
      const ja = porChave.get(k);
      porChave.set(
        k,
        ja
          ? { ...ja, visivel: ja.visivel && i.visivel, quadros: [...ja.quadros, ...(i.quadros ?? [])] }
          : { nome: nomeDaFicha.get(k) ?? i.nome, visivel: i.visivel, quadros: i.quadros ?? [] },
      );
    }
    // o ingrediente sem nada a ensinar (sem quadro e visível) não desce: a loja não teria o que fazer com ele
    const itens: ItemDaBase[] = [...porChave.values()].filter((i) => i.quadros.length > 0 || !i.visivel);
    // o "não era ingrediente" (migration 054) desce À PARTE dos ingredientes: o juiz da loja aprende o que NÃO é
    // comida, e o agente que ainda não sabe dele lê só os itens
    const nada = await pool.query<{ quadros: QuadroDaBase[] | null }>(
      `select (select jsonb_agg(jsonb_build_object('id', f.id, 'origem', f.origem, 'sha256', f.sha256, 'largura', f.largura, 'altura', f.altura)
                                order by f.criado_em, f.id)
                 from base_frame f join base_conhecimento b on b.id = f.base_id
                where b.loja_id = $1 and b.tipo = 'nada' and f.imagem is not null) as quadros`,
      [agente.lojaId],
    );
    const quadrosDoNada = nada.rows[0]?.quadros ?? [];
    return resposta
      .header('cache-control', 'no-store')
      .send({ impressao: impressaoDaBaseDaLoja(itens, quadrosDoNada), itens, nada: { quadros: quadrosDoNada } });
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
