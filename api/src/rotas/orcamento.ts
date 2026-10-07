// =====================================================================
// GET /v1/lojas/:id/orcamento
// =====================================================================
// Para a loja inteira: quanto cada canal é usado, o que cada um precisa
// enxergar, as opções de equipamento que servem — por nível — e três
// pacotes somados.
//
// A conta mora em `orcamento.ts`. Aqui só se busca o que ela precisa:
// os canais com os critérios de cada um, o requisito de cada uso e o
// catálogo.
//
// ## O catálogo não sai por aqui
//
// O catálogo é da distribuição. Esta rota devolve SOLUÇÕES: marca, modelo,
// nível, a razão do nível e a faixa de preço dos equipamentos que servem.
// O que foi descartado nem é lido do banco, e observação, fonte e medição
// de campo não entram na consulta.
//
// ## Quem vê
//
// Quem configura a loja (gerente, presidente, suporte). Orçamento é
// decisão de compra, não informação de operação.
// =====================================================================

import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

import { larguraEnquadrada, pxPorCm } from '../dimensionamento.js';
import {
  CAPTURAS_POR_HORA,
  montarOrcamento,
  type CanalDeEntrada,
  type EquipamentoDoCatalogo,
  type RequisitoDeUso,
} from '../orcamento.js';
import { podeConfigurar } from '../rbac.js';
import { sessaoDe } from './sessao.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function rotasDeOrcamento(app: FastifyInstance, pool: pg.Pool): void {
  app.get('/v1/lojas/:id/orcamento', async (req, resposta) => {
    const s = await sessaoDe(pool, req);
    if (!s) {
      return resposta.status(401).send({ erro: 'sem_sessao', mensagem: 'faça login' });
    }
    if (!podeConfigurar(s)) {
      return resposta.status(403).send({
        erro: 'sem_permissao',
        mensagem: 'o orçamento é visto por quem configura a loja: gerente, presidente ou suporte',
      });
    }

    const { id } = req.params as { id: string };
    const naoAchei = () =>
      resposta.status(404).send({ erro: 'nao_encontrada', mensagem: 'loja não encontrada' });
    if (!UUID.test(id)) return naoAchei();

    // O tenant vai na MESMA consulta: loja de outra conta tem que ser
    // indistinguível de loja que não existe.
    const l = await pool.query(
      'select id, nome, modo_julgamento from loja where id = $1 and tenant_id = $2',
      [id, s.tenantId],
    );
    if (l.rowCount === 0) return naoAchei();
    const loja = l.rows[0];

    // Os canais, cada um com os critérios que valem nele — numa consulta
    // só. Critério que vale em duas áreas do mesmo canal conta UMA vez.
    const c = await pool.query(
      `select p.id, p.nome, p.canal, p.ativo, p.importancia, st.nome as setor,
              p.resolucao_h, p.largura_cena_cm, p.focal_mm, p.distancia_cm,
              f.largura_mm as sensor_mm,
              coalesce((
                select jsonb_agg(jsonb_build_object('tipo', x.tipo, 'ativa', x.ativa) order by x.tipo)
                  from (select distinct r.id, r.tipo, r.ativa
                          from regra_alvo ra
                          join zona  z on z.id = ra.zona_id
                          join regra r on r.id = ra.regra_id
                         where z.ponto_id = p.id and r.excluida_em is null) x
              ), '[]'::jsonb) as criterios
         from ponto p
         join setor st on st.id = p.setor_id
         left join formato_sensor f on f.nome = p.sensor_pol
        where st.loja_id = $1 and p.excluido_em is null
        order by st.ordem, st.nome, p.canal nulls last, p.nome`,
      [id],
    );

    const canais: CanalDeEntrada[] = c.rows.map((p) => {
      // Medida com fita vence cálculo pela óptica — o mesmo critério do
      // diagnóstico por canal. Sem nenhuma das duas, não se inventa.
      let largura: number | null = p.largura_cena_cm ? Number(p.largura_cena_cm) : null;
      if (!largura && p.sensor_mm && p.focal_mm && p.distancia_cm) {
        largura = larguraEnquadrada(Number(p.distancia_cm), Number(p.sensor_mm), Number(p.focal_mm));
      }
      return {
        id: p.id,
        nome: p.nome,
        canal: p.canal,
        setor: p.setor,
        ativo: p.ativo,
        importancia: p.importancia,
        pxPorCm: largura && p.resolucao_h ? pxPorCm(Number(p.resolucao_h), largura) : null,
        criterios: p.criterios,
      };
    });

    const u = await pool.query(
      `select tipo_regra, variante, descricao, px_por_cm_min, fps_min, exige_cor,
              exige_wdr_db, exige_local, quadros_por_analise
         from requisito_uso`,
    );
    const requisitos: RequisitoDeUso[] = u.rows.map((r) => ({
      id: r.variante ? `${r.tipo_regra}:${r.variante}` : r.tipo_regra,
      descricao: r.descricao,
      pxPorCmMin: r.px_por_cm_min === null ? null : Number(r.px_por_cm_min),
      fpsMin: r.fps_min === null ? null : Number(r.fps_min),
      exigeCor: r.exige_cor,
      exigeWdrDb: r.exige_wdr_db,
      exigeLocal: r.exige_local,
      quadrosPorAnalise: r.quadros_por_analise,
    }));

    // Só o que pode ser proposto, e só as colunas que viram opção.
    const e = await pool.query(
      `select categoria, fabricante, modelo, nivel, nivel_motivo, status, serve_para, precos
         from equipamento
        where status <> 'descartado' and nivel is not null and slug is not null`,
    );
    const catalogo: EquipamentoDoCatalogo[] = e.rows.map((r) => ({
      categoria: r.categoria,
      fabricante: r.fabricante,
      modelo: r.modelo,
      nivel: r.nivel,
      nivelMotivo: r.nivel_motivo,
      status: r.status,
      servePara: r.serve_para ?? [],
      precos: r.precos ?? [],
    }));

    const orcamento = montarOrcamento({
      modoJulgamento: loja.modo_julgamento,
      canais,
      requisitos,
      catalogo,
    });

    if (catalogo.length === 0) {
      // Banco sem catálogo (a cópia ainda não rodou): dizer isso é melhor
      // que devolver "nenhuma opção" como se nada servisse.
      orcamento.avisos.unshift(
        'O catálogo de equipamentos ainda não foi carregado neste servidor: não há opções para mostrar.',
      );
    }

    return {
      loja: { id: loja.id, nome: loja.nome, modoJulgamento: loja.modo_julgamento },
      capturasPorHora: CAPTURAS_POR_HORA,
      ...orcamento,
    };
  });
}
