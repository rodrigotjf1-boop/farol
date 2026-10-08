// =====================================================================
// A planta da loja
// =====================================================================
// Os ambientes, os móveis e cada câmera no seu lugar (migration 028).
//
//   GET /v1/lojas/:id/planta   quem vê a loja vê a planta
//   PUT /v1/lojas/:id/planta   quem configura salva a planta INTEIRA
//
// **Salva inteira, com a versão que leu.** A tela edita tudo e salva de
// uma vez. Quem salva diz a versão que tinha na mão; se outra pessoa
// salvou no meio, a resposta é 409 e nada é gravado — ninguém apaga o
// desenho do outro sem ver.
//
// **O que a planta aponta tem de ser desta loja**: o setor de cada
// ambiente, o equipamento do inventário de cada móvel e o canal de cada
// câmera são conferidos aqui. Depois disso um canal ou um equipamento
// pode ser excluído; quem cuida é a LEITURA (`plantaDaLoja`), que devolve
// a planta sem a câmera cujo canal não existe mais e com o móvel solto do
// equipamento que saiu do inventário.
//
// **A frase do lugar** de cada câmera é escrita aqui, da planta, e é a
// mesma que a tela mostra e que desce ao agente (`configuracao.ts`).
// =====================================================================

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';

import { lerPlanta, lugaresDaPlanta, type Planta } from '../planta.js';
import { exigirConfigurar } from '../rbac.js';
import { sessaoDe, type Sessao } from './sessao.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type DaLoja = { setores: Set<string>; pontos: Set<string>; nomeDoItem: Map<string, string> };

/** O que existe na loja agora e a planta pode apontar: setores, canais e equipamentos. */
async function oQueALojaTem(cliente: pg.Pool | pg.PoolClient, lojaId: string): Promise<DaLoja> {
  const { rows } = await cliente.query<{ setores: string[]; pontos: string[]; itens: Record<string, string> }>(
    `select
       (select coalesce(jsonb_agg(s.id), '[]'::jsonb) from setor s where s.loja_id = $1) as setores,
       (select coalesce(jsonb_agg(p.id), '[]'::jsonb)
          from ponto p join setor st on st.id = p.setor_id
         where st.loja_id = $1 and p.excluido_em is null) as pontos,
       (select coalesce(jsonb_object_agg(i.id, i.nome), '{}'::jsonb)
          from inventario_item i where i.loja_id = $1) as itens`,
    [lojaId],
  );
  const l = rows[0]!;
  return { setores: new Set(l.setores), pontos: new Set(l.pontos), nomeDoItem: new Map(Object.entries(l.itens)) };
}

export type PlantaGuardada = { planta: Planta; versao: number; atualizadaEm: Date; nomeDoItem: Map<string, string> };

/**
 * A planta da loja como vale AGORA: o que foi salvo, menos o que deixou de
 * existir. Câmera de canal excluído sai; móvel de equipamento excluído e
 * ambiente de setor excluído ficam, soltos.
 */
export async function plantaDaLoja(cliente: pg.Pool | pg.PoolClient, lojaId: string): Promise<PlantaGuardada | null> {
  const l = await cliente.query<{ documento: unknown; versao: number; atualizado_em: Date }>(
    'select documento, versao, atualizado_em from planta where loja_id = $1',
    [lojaId],
  );
  const linha = l.rows[0];
  if (!linha) return null;
  // O documento foi conferido ao entrar. Se um dia deixar de passar (um
  // limite que mudou), a planta não derruba a tela nem a configuração do
  // agente: fica vazia para quem lê.
  const guardada = lerPlanta(linha.documento).planta ?? { ambientes: [], moveis: [], cameras: [] };
  const tem = await oQueALojaTem(cliente, lojaId);
  return {
    planta: {
      ambientes: guardada.ambientes.map((a) => (a.setorId && !tem.setores.has(a.setorId) ? { ...a, setorId: null } : a)),
      moveis: guardada.moveis.map((m) => (m.itemId && !tem.nomeDoItem.has(m.itemId) ? { ...m, itemId: null } : m)),
      cameras: guardada.cameras.filter((c) => tem.pontos.has(c.pontoId)),
    },
    versao: linha.versao,
    atualizadaEm: linha.atualizado_em,
    nomeDoItem: tem.nomeDoItem,
  };
}

/** A frase do lugar de cada canal que está na planta — o que desce ao agente. */
export async function lugaresDaLoja(cliente: pg.Pool | pg.PoolClient, lojaId: string): Promise<Map<string, string>> {
  const g = await plantaDaLoja(cliente, lojaId);
  return g ? lugaresDaPlanta(g.planta, g.nomeDoItem) : new Map();
}

const paraTela = (g: PlantaGuardada | null) => ({
  planta: g?.planta ?? null,
  versao: g?.versao ?? null,
  atualizadaEm: g?.atualizadaEm ?? null,
  // A frase de cada câmera: a tela mostra a mesma que o agente recebe.
  lugares: g ? Object.fromEntries(lugaresDaPlanta(g.planta, g.nomeDoItem)) : {},
});

export function rotasDePlanta(app: FastifyInstance, pool: pg.Pool): void {
  async function quem(req: FastifyRequest, resposta: FastifyReply): Promise<Sessao | null> {
    const s = await sessaoDe(pool, req);
    if (!s) {
      resposta.status(401).send({ erro: 'sem_sessao', mensagem: 'faça login' });
      return null;
    }
    return s;
  }
  const naoAchei = (resposta: FastifyReply) => resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'loja não encontrada' });
  const daConta = async (lojaId: string, tenantId: string): Promise<boolean> =>
    UUID.test(lojaId) && (await pool.query('select 1 from loja where id = $1 and tenant_id = $2', [lojaId, tenantId])).rowCount === 1;

  app.get('/v1/lojas/:id/planta', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    const { id } = req.params as { id: string };
    if (!(await daConta(id, s.tenantId))) return naoAchei(resposta);
    return paraTela(await plantaDaLoja(pool, id));
  });

  app.put('/v1/lojas/:id/planta', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirConfigurar(s, resposta)) return;
    const { id } = req.params as { id: string };
    if (!(await daConta(id, s.tenantId))) return naoAchei(resposta);

    const invalido = (mensagem: string) => resposta.status(422).send({ erro: 'validacao', mensagem });
    const c = (req.body ?? {}) as Record<string, unknown>;
    const versao = c.versao ?? null;
    if (versao !== null && (typeof versao !== 'number' || !Number.isInteger(versao) || versao < 1)) {
      return invalido('versao: a versão da planta que você leu — ou nada, se a loja ainda não tem planta');
    }
    const lido = lerPlanta(c.planta);
    if (lido.problema) return invalido(lido.problema);
    const planta = lido.planta!;

    // O que a planta aponta tem de existir NESTA loja.
    const tem = await oQueALojaTem(pool, id);
    for (const [i, a] of planta.ambientes.entries()) {
      if (a.setorId && !tem.setores.has(a.setorId)) return invalido(`ambientes[${i}].setorId: este setor não é desta loja`);
    }
    for (const [i, m] of planta.moveis.entries()) {
      if (m.itemId && !tem.nomeDoItem.has(m.itemId)) return invalido(`moveis[${i}].itemId: este equipamento não está no inventário desta loja`);
    }
    for (const [i, k] of planta.cameras.entries()) {
      if (!tem.pontos.has(k.pontoId)) return invalido(`cameras[${i}].pontoId: este canal não é desta loja (ou foi excluído)`);
    }

    // Grava só se a versão ainda for a que a pessoa leu. Uma instrução:
    // dois salvamentos ao mesmo tempo não passam os dois.
    const documento = JSON.stringify(planta);
    const gravada =
      versao === null
        ? await pool.query(
            `insert into planta (loja_id, documento, atualizado_por) values ($1, $2::jsonb, $3)
             on conflict (loja_id) do nothing returning versao`,
            [id, documento, s.usuarioId],
          )
        : await pool.query(
            `update planta set documento = $2::jsonb, versao = versao + 1, atualizado_por = $3, atualizado_em = now()
              where loja_id = $1 and versao = $4 returning versao`,
            [id, documento, s.usuarioId, versao],
          );
    if (gravada.rowCount === 0) {
      return resposta.status(409).send({
        erro: 'conflito',
        mensagem:
          'A planta foi alterada em outro lugar enquanto você editava. O que você mudou aqui não foi salvo: ' +
          'recarregue para ver como ela ficou.',
      });
    }
    return paraTela(await plantaDaLoja(pool, id));
  });
}
