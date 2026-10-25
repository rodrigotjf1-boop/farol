// =====================================================================
// A calibração de cada câmera pelos pontos do piso (A26, P1; migration 057)
// =====================================================================
//   GET    /v1/lojas/:id/calibracoes                     quem vê a loja: a de cada canal
//   GET    /v1/lojas/:id/calibracoes/:pontoId            uma, com os pares
//   POST   /v1/lojas/:id/calibracoes/:pontoId/conferir   quem configura: a conta SEM salvar (enquanto marca)
//   PUT    /v1/lojas/:id/calibracoes/:pontoId            quem configura: salva, com a versão que leu
//   DELETE /v1/lojas/:id/calibracoes/:pontoId            quem configura: tira (a câmera foi mexida)
//
// A conta é a de `../calibracao.ts`; o canal tem de ser desta loja. Como a
// planta: salva inteira, com a versão que a pessoa leu — se outra salvou no
// meio, 409 e nada é gravado.
// =====================================================================

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';

import { lerCalibracao, type Calibracao } from '../calibracao.js';
import { LIMITES_DA_PLANTA } from '../planta.js';
import { exigirConfigurar } from '../rbac.js';
import { sessaoDe, type Sessao } from './sessao.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Linha = {
  ponto_id: string;
  pares: Calibracao['pares'];
  homografia: number[];
  erro_medio_m: string;
  erro_maximo_m: string;
  erro_conferido_m: string | null;
  area: [number, number][];
  versao: number;
  atualizada_em: Date;
};

const num = (v: string | null) => (v == null ? null : Number(v));

export function calibracaoParaTela(l: Linha, comPares = true) {
  return {
    pontoId: l.ponto_id,
    ...(comPares ? { pares: l.pares } : { quantosPontos: l.pares.length }),
    homografia: l.homografia,
    erroMedioM: num(l.erro_medio_m),
    erroMaximoM: num(l.erro_maximo_m),
    /** A régua honesta (deixando um ponto de fora por vez); nula com 4 pontos. */
    erroConferidoM: num(l.erro_conferido_m),
    area: l.area,
    versao: l.versao,
    atualizadaEm: l.atualizada_em,
  };
}

/** As calibrações da loja, por canal — o que desce ao agente (`configuracao.ts`). */
export async function calibracoesDaLoja(pool: pg.Pool | pg.PoolClient, lojaId: string): Promise<Map<string, Linha>> {
  const r = await pool.query<Linha>(
    `select c.ponto_id, c.pares, c.homografia, c.erro_medio_m, c.erro_maximo_m, c.erro_conferido_m, c.area, c.versao, c.atualizada_em
       from camera_calibracao c
       join ponto p on p.id = c.ponto_id and p.excluido_em is null
      where c.loja_id = $1`,
    [lojaId],
  );
  return new Map(r.rows.map((l) => [l.ponto_id, l]));
}

export function rotasDeCalibracao(app: FastifyInstance, pool: pg.Pool): void {
  async function quem(req: FastifyRequest, resposta: FastifyReply): Promise<Sessao | null> {
    const s = await sessaoDe(pool, req);
    if (!s) {
      resposta.status(401).send({ erro: 'sem_sessao', mensagem: 'faça login' });
      return null;
    }
    return s;
  }
  const naoAchei = (resposta: FastifyReply, mensagem = 'loja não encontrada') => resposta.status(404).send({ erro: 'nao_encontrado', mensagem });
  const invalido = (resposta: FastifyReply, mensagem: string) => resposta.status(422).send({ erro: 'validacao', mensagem });
  const daConta = async (lojaId: string, tenantId: string): Promise<boolean> =>
    UUID.test(lojaId) && (await pool.query('select 1 from loja where id = $1 and tenant_id = $2', [lojaId, tenantId])).rowCount === 1;
  /** O canal é desta loja (e não foi excluído)? */
  const canalDaLoja = async (lojaId: string, pontoId: string): Promise<boolean> =>
    UUID.test(pontoId) &&
    (await pool.query(
      `select 1 from ponto p join setor st on st.id = p.setor_id where p.id = $1 and st.loja_id = $2 and p.excluido_em is null`,
      [pontoId, lojaId],
    )).rowCount === 1;
  const lerCorpo = (req: FastifyRequest) => lerCalibracao(req.body, LIMITES_DA_PLANTA.extensao);

  app.get('/v1/lojas/:id/calibracoes', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    const { id } = req.params as { id: string };
    if (!(await daConta(id, s.tenantId))) return naoAchei(resposta);
    const todas = await calibracoesDaLoja(pool, id);
    return { calibracoes: [...todas.values()].map((l) => calibracaoParaTela(l, false)) };
  });

  app.get('/v1/lojas/:id/calibracoes/:pontoId', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    const { id, pontoId } = req.params as { id: string; pontoId: string };
    if (!(await daConta(id, s.tenantId))) return naoAchei(resposta);
    if (!(await canalDaLoja(id, pontoId))) return naoAchei(resposta, 'canal não encontrado nesta loja');
    const l = (await calibracoesDaLoja(pool, id)).get(pontoId.toLowerCase());
    if (!l) return naoAchei(resposta, 'este canal ainda não foi calibrado');
    return calibracaoParaTela(l);
  });

  app.post('/v1/lojas/:id/calibracoes/:pontoId/conferir', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirConfigurar(s, resposta)) return;
    const { id, pontoId } = req.params as { id: string; pontoId: string };
    if (!(await daConta(id, s.tenantId))) return naoAchei(resposta);
    if (!(await canalDaLoja(id, pontoId))) return naoAchei(resposta, 'canal não encontrado nesta loja');
    const lido = lerCorpo(req);
    if (lido.problema) return invalido(resposta, lido.problema);
    const c = lido.calibracao!;
    return { homografia: c.homografia, erros: c.erros, area: c.area };
  });

  app.put('/v1/lojas/:id/calibracoes/:pontoId', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirConfigurar(s, resposta)) return;
    const { id, pontoId } = req.params as { id: string; pontoId: string };
    if (!(await daConta(id, s.tenantId))) return naoAchei(resposta);
    if (!(await canalDaLoja(id, pontoId))) return naoAchei(resposta, 'canal não encontrado nesta loja');
    const corpo = (req.body ?? {}) as Record<string, unknown>;
    const versao = corpo.versao ?? null;
    if (versao !== null && (typeof versao !== 'number' || !Number.isInteger(versao) || versao < 1)) {
      return invalido(resposta, 'versao: a versão da calibração que você leu — ou nada, se o canal ainda não foi calibrado');
    }
    const lido = lerCorpo(req);
    if (lido.problema) return invalido(resposta, lido.problema);
    const c = lido.calibracao!;
    const valores = [
      pontoId.toLowerCase(), s.tenantId, id, JSON.stringify(c.pares), JSON.stringify(c.homografia),
      c.erros.medioM, c.erros.maximoM, c.erros.conferido?.medianaM ?? null, JSON.stringify(c.area), s.usuarioId,
    ];
    // Uma instrução: dois salvamentos ao mesmo tempo não passam os dois.
    const gravada =
      versao === null
        ? await pool.query(
            `insert into camera_calibracao (ponto_id, tenant_id, loja_id, pares, homografia, erro_medio_m, erro_maximo_m,
                                            erro_conferido_m, area, atualizada_por)
             values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9::jsonb, $10)
             on conflict (ponto_id) do nothing returning versao`,
            valores,
          )
        : await pool.query(
            `update camera_calibracao set pares = $4::jsonb, homografia = $5::jsonb, erro_medio_m = $6, erro_maximo_m = $7,
                    erro_conferido_m = $8, area = $9::jsonb, atualizada_por = $10, atualizada_em = now(), versao = versao + 1
              where ponto_id = $1 and tenant_id = $2 and loja_id = $3 and versao = $11 returning versao`,
            [...valores, versao],
          );
    if (gravada.rowCount === 0) {
      return resposta.status(409).send({
        erro: 'conflito',
        mensagem: 'A calibração deste canal foi salva em outro lugar enquanto você marcava. O que você marcou aqui não foi '
          + 'salvo: recarregue para ver como ela ficou.',
      });
    }
    const l = (await calibracoesDaLoja(pool, id)).get(pontoId.toLowerCase())!;
    return { ...calibracaoParaTela(l), erros: c.erros };
  });

  app.delete('/v1/lojas/:id/calibracoes/:pontoId', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirConfigurar(s, resposta)) return;
    const { id, pontoId } = req.params as { id: string; pontoId: string };
    if (!(await daConta(id, s.tenantId))) return naoAchei(resposta);
    if (!UUID.test(pontoId)) return naoAchei(resposta, 'canal não encontrado nesta loja');
    const r = await pool.query('delete from camera_calibracao where ponto_id = $1 and loja_id = $2 and tenant_id = $3', [
      pontoId.toLowerCase(), id, s.tenantId,
    ]);
    if (r.rowCount === 0) return naoAchei(resposta, 'este canal ainda não foi calibrado');
    return resposta.status(204).send();
  });
}
