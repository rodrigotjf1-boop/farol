// =====================================================================
// GET /v1/pontos/:id/diagnostico
// =====================================================================
// Para um ponto instalado, diz **o que ele sustenta** e **com que
// configuração** — por tipo de regra, com mínimo e máximo.
//
// É o que transforma o catálogo técnico em recomendação: em vez de
// "compre uma câmera melhor", a resposta vira "esta câmera sustenta
// estado e presença nesta posição; para montagem, aproxime para 78 cm
// ou use focal maior".
//
// Quando a óptica não foi informada, a rota **diz o que falta** em vez
// de calcular com suposição. Número inventado aqui vira recomendação de
// compra errada no bolso do cliente.
// =====================================================================

import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

import { dimensionar, larguraEnquadrada, pxPorCm } from '../dimensionamento.js';
import { sessaoDe } from './sessao.js';

export function rotasDeDiagnostico(app: FastifyInstance, pool: pg.Pool): void {
  app.get('/v1/pontos/:id/diagnostico', async (req, resposta) => {
    const s = await sessaoDe(pool, req);
    if (!s) {
      return resposta.status(401).send({ erro: 'sem_sessao', mensagem: 'faça login' });
    }

    const { id } = req.params as { id: string };

    const p = await pool.query(
      `select p.id, p.nome, p.sensor_pol, p.focal_mm, p.distancia_cm,
              p.resolucao_h, p.largura_cena_cm, p.optica_medida_em,
              f.largura_mm as sensor_mm
         from ponto p
         join setor st on st.id = p.setor_id
         join loja  l  on l.id  = st.loja_id
         left join formato_sensor f on f.nome = p.sensor_pol
        where p.id = $1 and l.tenant_id = $2`,
      [id, s.tenantId],
    );
    if (p.rowCount === 0) {
      return resposta.status(404).send({ erro: 'nao_encontrado', mensagem: 'ponto não encontrado' });
    }
    const ponto = p.rows[0];

    // ─────────── a largura da cena: medida vence cálculo ───────────
    // A conta assume lente perfeita. A lente real tem distorção, e numa
    // grande angular ela é grande. Se alguém mediu com fita métrica, essa
    // medida é melhor que qualquer fórmula.
    let larguraCena: number | null = ponto.largura_cena_cm
      ? Number(ponto.largura_cena_cm)
      : null;
    let origemLargura: 'medida' | 'calculada' | null = larguraCena ? 'medida' : null;

    const faltando: string[] = [];
    if (!larguraCena) {
      if (!ponto.sensor_mm) faltando.push('sensor_pol (formato do sensor)');
      if (!ponto.focal_mm) faltando.push('focal_mm (distância focal da lente)');
      if (!ponto.distancia_cm) faltando.push('distancia_cm (câmera até o objeto)');
      if (faltando.length === 0) {
        larguraCena = larguraEnquadrada(
          Number(ponto.distancia_cm),
          Number(ponto.sensor_mm),
          Number(ponto.focal_mm),
        );
        origemLargura = 'calculada';
      }
    }
    if (!ponto.resolucao_h) faltando.push('resolucao_h (pixels horizontais do canal)');

    if (!larguraCena || !ponto.resolucao_h) {
      return {
        ponto: { id: ponto.id, nome: ponto.nome },
        completo: false,
        faltando,
        mensagem:
          'sem esses dados não dá para dizer o que o ponto sustenta. ' +
          'Preferimos não responder a responder com suposição — número ' +
          'inventado aqui vira recomendação de compra errada.',
      };
    }

    const camera = pxPorCm(Number(ponto.resolucao_h), larguraCena);

    // ──────────────── as zonas e o que cada uma cobre ────────────────
    const z = await pool.query(
      `select id, nome, largura_cena_cm from zona where ponto_id = $1 order by nome`,
      [id],
    );
    const requisitos = await pool.query(
      `select tipo_regra, variante, descricao, px_por_cm_min, fps_min,
              exige_cor, exige_wdr_db, exige_local, quadros_por_analise, observacao
         from requisito_uso
        order by px_por_cm_min, tipo_regra`,
    );

    const zonas = z.rows.map((zona) => {
      // Zona sem largura declarada cobre o quadro inteiro — é o padrão
      // com que ela nasce, e vale até alguém recortar.
      const largura = zona.largura_cena_cm ? Number(zona.largura_cena_cm) : larguraCena!;

      return {
        id: zona.id,
        nome: zona.nome,
        larguraCm: Number(largura.toFixed(1)),
        larguraDeclarada: zona.largura_cena_cm != null,
        usos: requisitos.rows.map((r) => {
          const v = dimensionar(Number(r.px_por_cm_min), largura, camera);
          return {
            tipo: r.tipo_regra,
            variante: r.variante,
            descricao: r.descricao,
            exigePxPorCm: Number(r.px_por_cm_min),
            exigeCor: r.exige_cor,
            exigeLocal: r.exige_local,
            quadrosPorAnalise: r.quadros_por_analise,
            observacao: r.observacao,
            ...v,
          };
        }),
      };
    });

    return {
      ponto: {
        id: ponto.id,
        nome: ponto.nome,
        sensor: ponto.sensor_pol,
        focalMm: ponto.focal_mm ? Number(ponto.focal_mm) : null,
        distanciaCm: ponto.distancia_cm ? Number(ponto.distancia_cm) : null,
        resolucaoH: ponto.resolucao_h,
      },
      optica: {
        larguraCenaCm: Number(larguraCena.toFixed(1)),
        origem: origemLargura,
        pxPorCm: Number(camera.toFixed(2)),
        // Ressalva honesta: a fórmula ignora distorção, e grande angular
        // distorce muito. No centro bate; na borda, menos.
        ressalva:
          origemLargura === 'calculada'
            ? 'calculado pela óptica; a lente real distorce, então na borda do ' +
              'quadro o px/cm é menor que este. Medir com fita dá o número exato.'
            : null,
      },
      completo: true,
      zonas,
    };
  });
}
