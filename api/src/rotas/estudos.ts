// =====================================================================
// O estudo de um critério e o funil dele
// =====================================================================
//   GET    /v1/regras/:id/estudo   a ficha (ou nada) e os quadros que ela pode citar
//   PUT    /v1/regras/:id/estudo   grava a ficha inteira
//   DELETE /v1/regras/:id/estudo   tira o estudo: volta o "quando vale a pena conferir" de sempre
//   GET    /v1/regras/:id/funil    olhadas → com contexto → com gatilho → julgadas, em números
//
// As regras do estudo (o que cabe, o que desce para o agente, a conta do
// funil) estão em `../estudo.ts`. Aqui fica o que depende do banco.
//
// ## Quem pode
//
// Ler a ficha: quem vê os critérios da loja. Gravar e tirar: quem
// configura (gerência para cima, e o suporte). O funil: supervisão para
// cima e o suporte — como as análises, de que ele é um recorte.
//
// ## O quadro citado é de um canal do critério
//
// Uma condição pode olhar outro quadro ("há gente no posto"), mas só de um
// canal em que o critério vale: quadro de outro canal não tem como ser
// conferido na mesma olhada.
// =====================================================================

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';

import { repartirPorOnde } from '../analises.js';
import { SQL_NUMERO_DO_QUADRO } from '../cena.js';
import {
  DIAS_DO_FUNIL,
  estudoNaoCabeNoTipo,
  lerEstudo,
  montarFunil,
  mediaDeGatilhosPorDia,
  quadrosCitados,
  quantoCustariaLigado,
  SOMA_ZERO,
  somarAoFunil,
  SQL_SOMAS_DO_FUNIL,
  TIPOS_QUE_USAM_ESTUDO,
  type SomaDoFunil,
} from '../estudo.js';
import { exigirConfigurar, peloMenos } from '../rbac.js';
import { sessaoDe, type Sessao } from './sessao.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Quantos dias o funil devolve de uma vez. (Sem pedir: `DIAS_DO_FUNIL`.) */
const MAX_DIAS_DO_FUNIL = 31;
/** De quantos dias sai o preço medido de uma análise na nuvem. */
const DIAS_DO_PRECO = 30;

type LinhaDoEstudo = {
  partes: Record<string, string>; contexto: unknown[]; gatilho: unknown[];
  confirmado_em: Date | null; atualizado_em: Date;
};

const paraATela = (e: LinhaDoEstudo | undefined) =>
  e
    ? {
        partes: e.partes,
        contexto: e.contexto,
        gatilho: e.gatilho,
        confirmado: e.confirmado_em !== null,
        confirmadoEm: e.confirmado_em,
        atualizadoEm: e.atualizado_em,
      }
    : null;

const funilDe = (tipo: string, s: SomaDoFunil) =>
  montarFunil(s, repartirPorOnde({
    tipo, julgadas: s.conformes + s.naoConformes + s.naoAvaliaveis,
    julgadasLoja: s.julgadasLoja, julgadasNuvem: s.julgadasNuvem,
  }));

export function rotasDeEstudos(app: FastifyInstance, pool: pg.Pool): void {
  async function quem(req: FastifyRequest, resposta: FastifyReply): Promise<Sessao | null> {
    const s = await sessaoDe(pool, req);
    if (!s) {
      resposta.status(401).send({ erro: 'sem_sessao', mensagem: 'faça login' });
      return null;
    }
    return s;
  }

  const naoAchei = (resposta: FastifyReply) =>
    resposta.status(404).send({ erro: 'nao_encontrada', mensagem: 'regra não encontrada' });

  // ─────────────────────── ler a ficha ───────────────────────

  app.get('/v1/regras/:id/estudo', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return naoAchei(resposta);

    // O critério de outra conta tem de ser indistinguível do que não existe.
    const r = await pool.query<{ id: string; tipo: string }>(
      `select r.id, r.tipo
         from regra r
         join loja l on l.id = r.loja_id
        where r.id = $1 and l.tenant_id = $2 and r.excluida_em is null`,
      [id, s.tenantId],
    );
    if (r.rowCount === 0) return naoAchei(resposta);

    const [estudo, quadros] = await Promise.all([
      pool.query<LinhaDoEstudo>(
        'select partes, contexto, gatilho, confirmado_em, atualizado_em from regra_estudo where regra_id = $1',
        [id],
      ),
      // Os quadros que uma condição pode citar: os dos canais em que o
      // critério vale.
      pool.query(
        `select p.id as ponto_id, p.nome as ponto_nome, p.canal, z.id, z.nome, z.papel,
                ${SQL_NUMERO_DO_QUADRO} as numero
           from zona z
           join ponto p on p.id = z.ponto_id
          where z.excluida_em is null and p.excluido_em is null
            and z.ponto_id in (
                  select za.ponto_id
                    from regra_alvo a
                    join zona za on za.id = a.zona_id
                   where a.regra_id = $1)
          order by p.nome, numero nulls first, z.nome`,
        [id],
      ),
    ]);

    const canais = new Map<string, { pontoId: string; nome: string; canal: number | null; quadros: unknown[] }>();
    for (const q of quadros.rows) {
      if (!canais.has(q.ponto_id)) {
        canais.set(q.ponto_id, { pontoId: q.ponto_id, nome: q.ponto_nome, canal: q.canal ?? null, quadros: [] });
      }
      canais.get(q.ponto_id)!.quadros.push({ id: q.id, nome: q.nome, papel: q.papel, numero: q.numero });
    }

    return {
      regraId: id,
      tipo: r.rows[0]!.tipo,
      // Presença e contagem são conferidas na loja em toda olhada: a ficha
      // delas tem os textos, e não leva contexto nem gatilho.
      usaContextoEGatilho: TIPOS_QUE_USAM_ESTUDO.includes(r.rows[0]!.tipo),
      estudo: paraATela(estudo.rows[0]),
      canais: [...canais.values()],
    };
  });

  // ─────────────────────── gravar a ficha ───────────────────────

  app.put('/v1/regras/:id/estudo', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirConfigurar(s, resposta)) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return naoAchei(resposta);

    const lido = lerEstudo(req.body);
    if ('problema' in lido) {
      return resposta.status(422).send({ erro: 'validacao', mensagem: lido.problema });
    }
    const estudo = lido.ok;

    const cliente = await pool.connect();
    try {
      await cliente.query('begin');
      // A linha do critério fica travada até o fim: duas pessoas gravando
      // o estudo do mesmo critério passam uma depois da outra.
      const r = await cliente.query<{ tipo: string }>(
        `select r.tipo
           from regra r
           join loja l on l.id = r.loja_id
          where r.id = $1 and l.tenant_id = $2 and r.excluida_em is null
            for update of r`,
        [id, s.tenantId],
      );
      if (r.rowCount === 0) {
        await cliente.query('rollback');
        return naoAchei(resposta);
      }

      const naoCabe = estudoNaoCabeNoTipo(r.rows[0]!.tipo, estudo);
      if (naoCabe) {
        await cliente.query('rollback');
        return resposta.status(422).send({ erro: 'validacao', mensagem: naoCabe });
      }

      const citados = quadrosCitados(estudo);
      if (citados.length > 0) {
        const validos = await cliente.query(
          `select z.id
             from zona z
             join ponto p on p.id = z.ponto_id
            where z.id = any($2::uuid[]) and z.excluida_em is null and p.excluido_em is null
              and z.ponto_id in (
                    select za.ponto_id
                      from regra_alvo a
                      join zona za on za.id = a.zona_id
                     where a.regra_id = $1)`,
          [id, citados],
        );
        if (validos.rowCount !== citados.length) {
          await cliente.query('rollback');
          return resposta.status(422).send({
            erro: 'validacao',
            mensagem: 'há quadro citado que não é de um canal deste critério. Nada foi alterado.',
          });
        }
      }

      // A confirmação guarda quem e quando — e só muda quando muda o que
      // foi confirmado: salvar de novo o mesmo estudo não troca o autor.
      const { rows } = await cliente.query<LinhaDoEstudo>(
        `insert into regra_estudo as e (regra_id, partes, contexto, gatilho, confirmado_em, confirmado_por)
         values ($1, $2::jsonb, $3::jsonb, $4::jsonb,
                 case when $5 then now() end, case when $5 then $6::uuid end)
         on conflict (regra_id) do update
            set partes   = excluded.partes,
                contexto = excluded.contexto,
                gatilho  = excluded.gatilho,
                confirmado_em = case
                  when not $5 then null
                  when e.confirmado_em is not null and e.contexto = excluded.contexto and e.gatilho = excluded.gatilho
                    then e.confirmado_em
                  else now() end,
                confirmado_por = case
                  when not $5 then null
                  when e.confirmado_em is not null and e.contexto = excluded.contexto and e.gatilho = excluded.gatilho
                    then e.confirmado_por
                  else $6::uuid end,
                atualizado_em = now()
         returning partes, contexto, gatilho, confirmado_em, atualizado_em`,
        [id, JSON.stringify(estudo.partes), JSON.stringify(estudo.contexto), JSON.stringify(estudo.gatilho), estudo.confirmado, s.usuarioId],
      );
      await cliente.query('commit');

      // O estudo confirmado muda quando a loja olha e quanto gasta: fica
      // no log com quem fez.
      req.log.info(
        { regra: id, por: s.usuarioId, confirmado: estudo.confirmado, contexto: estudo.contexto.length, gatilho: estudo.gatilho.length },
        'estudo do critério salvo',
      );
      return { regraId: id, estudo: paraATela(rows[0]) };
    } catch (e) {
      await cliente.query('rollback').catch(() => {});
      throw e;
    } finally {
      cliente.release();
    }
  });

  // ─────────────────────── tirar o estudo ───────────────────────

  app.delete('/v1/regras/:id/estudo', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (!exigirConfigurar(s, resposta)) return;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return naoAchei(resposta);

    const r = await pool.query(
      `select r.id
         from regra r
         join loja l on l.id = r.loja_id
        where r.id = $1 and l.tenant_id = $2 and r.excluida_em is null`,
      [id, s.tenantId],
    );
    if (r.rowCount === 0) return naoAchei(resposta);

    const tirado = await pool.query('delete from regra_estudo where regra_id = $1', [id]);
    if ((tirado.rowCount ?? 0) > 0) {
      req.log.info({ regra: id, por: s.usuarioId }, 'estudo do critério removido');
    }
    return { regraId: id, removido: (tirado.rowCount ?? 0) > 0 };
  });

  // ─────────────────────── o funil ───────────────────────

  app.get('/v1/regras/:id/funil', async (req, resposta) => {
    const s = await quem(req, resposta);
    if (!s) return;
    if (s.nivel !== 'suporte' && !peloMenos(s, 'supervisao')) {
      return resposta.status(403).send({
        erro: 'sem_permissao',
        mensagem: 'o funil é visto pela supervisão, pela gerência e pela diretoria',
      });
    }
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return naoAchei(resposta);

    const pedido = (req.query as { dias?: unknown }).dias;
    let dias = DIAS_DO_FUNIL;
    if (pedido !== undefined) {
      const n = Number(pedido);
      if (typeof pedido !== 'string' || !/^\d{1,2}$/.test(pedido) || n < 1 || n > MAX_DIAS_DO_FUNIL) {
        return resposta.status(400).send({ erro: 'intervalo_invalido', mensagem: `dias: de 1 a ${MAX_DIAS_DO_FUNIL}` });
      }
      dias = n;
    }

    // O critério, a loja e o "hoje" no relógio DELA.
    const r = await pool.query<{
      id: string; nome: string; tipo: string; estado: string; loja_id: string; timezone: string;
      modo_julgamento: string; hoje: string; tem_estudo: boolean;
    }>(
      `select r.id, r.nome, r.tipo, r.estado, l.id as loja_id, l.timezone, l.modo_julgamento,
              to_char(now() at time zone l.timezone, 'YYYY-MM-DD') as hoje,
              exists (select 1 from regra_estudo e where e.regra_id = r.id and e.confirmado_em is not null) as tem_estudo
         from regra r
         join loja l on l.id = r.loja_id
        where r.id = $1 and l.tenant_id = $2 and r.excluida_em is null`,
      [id, s.tenantId],
    );
    if (r.rowCount === 0) return naoAchei(resposta);
    const regra = r.rows[0]!;

    // Os limites são meia-noite NO FUSO DA LOJA: `timestamp at time zone`
    // lê o relógio de parede e devolve o instante. A loja entra no filtro
    // das consultas do critério para elas andarem pelo índice da tabela
    // (`resumo_hora_loja_idx`: loja e hora), como a da loja inteira.
    const [linhas, doCriterio, daLoja] = await Promise.all([
      pool.query(
        `select to_char(h.hora at time zone $2, 'YYYY-MM-DD') as dia, h.zona_id, z.ponto_id, ${SQL_SOMAS_DO_FUNIL}
           from resumo_hora h
           join zona z on z.id = h.zona_id
          where h.regra_id = $1
            and h.loja_id = $5
            and h.hora >= (($3::date - ($4::integer - 1))::timestamp at time zone $2)
            and h.hora <  (($3::date + 1)::timestamp at time zone $2)
          group by 1, h.zona_id, z.ponto_id
          order by 1, z.ponto_id, h.zona_id`,
        [id, regra.timezone, regra.hoje, dias, regra.loja_id],
      ),
      // O preço medido: o que este critério pagou por análise na nuvem...
      pool.query<{ custo: number; na_nuvem: number }>(
        `select coalesce(sum(h.custo_centavos), 0)::float8 as custo, coalesce(sum(h.julgadas_nuvem), 0)::integer as na_nuvem
           from resumo_hora h
          where h.regra_id = $1 and h.loja_id = $3 and h.hora >= now() - make_interval(days => $2)`,
        [id, DIAS_DO_PRECO, regra.loja_id],
      ),
      // ...e, na falta dele, o que a loja inteira pagou.
      pool.query<{ custo: number; na_nuvem: number }>(
        `select coalesce(sum(h.custo_centavos), 0)::float8 as custo, coalesce(sum(h.julgadas_nuvem), 0)::integer as na_nuvem
           from resumo_hora h
          where h.loja_id = $1 and h.hora >= now() - make_interval(days => $2)`,
        [regra.loja_id, DIAS_DO_PRECO],
      ),
    ]);

    let total = SOMA_ZERO;
    const porQuadro = new Map<string, { pontoId: string; soma: SomaDoFunil }>();
    const porDia = new Map<string, SomaDoFunil>();
    for (const l of linhas.rows) {
      total = somarAoFunil(total, l);
      const q = porQuadro.get(l.zona_id) ?? { pontoId: l.ponto_id as string, soma: SOMA_ZERO };
      porQuadro.set(l.zona_id, { pontoId: q.pontoId, soma: somarAoFunil(q.soma, l) });
      porDia.set(l.dia, somarAoFunil(porDia.get(l.dia) ?? SOMA_ZERO, l));
    }

    const funil = funilDe(regra.tipo, total);
    const dia = [...porDia.entries()].map(([d, soma]) => ({ dia: d, ...funilDe(regra.tipo, soma) }));
    const media = mediaDeGatilhosPorDia(dia, regra.hoje);

    return {
      regraId: id,
      nome: regra.nome,
      tipo: regra.tipo,
      estado: regra.estado,
      // Sem estudo confirmado, "com contexto" é o que o "quando vale a pena
      // conferir" deixou passar, e todo contexto é gatilho.
      temEstudo: regra.tem_estudo,
      dias,
      hoje: regra.hoje,
      total: funil,
      porQuadro: [...porQuadro.entries()].map(([zonaId, q]) => ({ zonaId, pontoId: q.pontoId, ...funilDe(regra.tipo, q.soma) })),
      porDia: dia,
      seLigado: {
        ...quantoCustariaLigado({
          gatilhosPorDia: media.gatilhosPorDia,
          // Presença e contagem nunca saem da loja; e em loja de modo
          // local nada sai, de tipo nenhum.
          soNaLoja: ['presenca', 'contagem'].includes(regra.tipo) || regra.modo_julgamento === 'local',
          doCriterio: { custoCentavos: doCriterio.rows[0]!.custo, naNuvem: doCriterio.rows[0]!.na_nuvem },
          daLoja: { custoCentavos: daLoja.rows[0]!.custo, naNuvem: daLoja.rows[0]!.na_nuvem },
        }),
        // De quantos dias saiu a média, e se ela é de um dia que ainda não
        // acabou: é a condição em que o número foi medido.
        diasNaMedia: media.diasNaMedia,
        parcial: media.parcial,
      },
    };
  });
}
