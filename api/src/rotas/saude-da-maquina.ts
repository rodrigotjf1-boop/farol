// =====================================================================
// GET /v1/lojas/:id/computador/saude — o relatório da máquina do agente
// =====================================================================
// O monitoramento pedido pelo dono em 25/10/2026 (migration 056): por hora,
// o processador, a memória e a placa (média e pico), os sensores
// (temperaturas, consumo e memória da placa, frequência real do
// processador, disco), o pico de cada minuto, as quedas do PC e o resumo
// "sobrecarregado?" e "esquentando?" — do último dia e do período pedido.
//
// Vê quem vê a loja (como a tela "Computador da loja"): o filtro do tenant
// vai na mesma consulta da loja.
// =====================================================================

import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

import { LIMITES, resumirSaude, type HoraDaSaude, type MinutoDaHora, type SensoresDaHora } from '../saude-da-maquina.js';
import { sessaoDe } from './sessao.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DIAS_PADRAO = 7;
export const DIAS_MAXIMO = 31;

type LinhaDaHora = {
  hora: Date;
  amostras: number;
  cpu_soma: string; cpu_amostras: number; cpu_max: string | null;
  mem_soma: string; mem_amostras: number; mem_max: string | null;
  gpu_soma: string; gpu_amostras: number; gpu_max: string | null;
  disco_livre_gb: string | null; disco_total_gb: string | null;
  sensores: SensoresDaHora | null;
  minutos: MinutoDaHora[] | null;
};

const media = (soma: string, n: number) => (n > 0 ? Math.round((Number(soma) / n) * 10) / 10 : null);
const num = (v: string | null) => (v == null ? null : Number(v));

export function horaDaSaude(l: LinhaDaHora): HoraDaSaude & { discoLivreGb: number | null; discoTotalGb: number | null } {
  return {
    hora: l.hora,
    amostras: l.amostras,
    cpu: { media: media(l.cpu_soma, l.cpu_amostras), max: num(l.cpu_max) },
    mem: { media: media(l.mem_soma, l.mem_amostras), max: num(l.mem_max) },
    gpu: { media: media(l.gpu_soma, l.gpu_amostras), max: num(l.gpu_max) },
    sensores: l.sensores,
    minutos: l.minutos,
    discoLivreGb: num(l.disco_livre_gb),
    discoTotalGb: num(l.disco_total_gb),
  };
}

export function rotasDaSaudeDaMaquina(app: FastifyInstance, pool: pg.Pool): void {
  app.get('/v1/lojas/:id/computador/saude', async (req, resposta) => {
    const s = await sessaoDe(pool, req);
    if (!s) return resposta.status(401).send({ erro: 'sem_sessao', mensagem: 'faça login' });
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return resposta.status(422).send({ erro: 'validacao', mensagem: 'id inválido' });
    const { dias: diasBruto } = (req.query ?? {}) as { dias?: string };
    const dias = diasBruto === undefined ? DIAS_PADRAO : Number(diasBruto);
    if (!Number.isInteger(dias) || dias < 1 || dias > DIAS_MAXIMO) {
      return resposta.status(422).send({ erro: 'validacao', mensagem: `dias: de 1 a ${DIAS_MAXIMO}` });
    }
    const loja = await pool.query<{ id: string; timezone: string }>(
      'select id, timezone from loja where id = $1 and tenant_id = $2',
      [id, s.tenantId],
    );
    if (loja.rowCount === 0) return resposta.status(404).send({ erro: 'nao_encontrada', mensagem: 'loja não encontrada' });

    const [horas, quedas, agente] = await Promise.all([
      pool.query<LinhaDaHora>(
        `select hora, amostras, cpu_soma, cpu_amostras, cpu_max, mem_soma, mem_amostras, mem_max,
                gpu_soma, gpu_amostras, gpu_max, disco_livre_gb, disco_total_gb, sensores, minutos
           from uso_hora
          where loja_id = $1 and hora >= now() - make_interval(days => $2)
          order by hora`,
        [id, dias],
      ),
      pool.query<{ desligou: Date | null; ligou: Date; causa: string; bugcheck: string | null }>(
        `select desligou, ligou, causa, bugcheck
           from computador_queda
          where loja_id = $1 and ligou >= now() - make_interval(days => $2)
          order by ligou desc
          limit 50`,
        [id, Math.max(dias, 30)],
      ),
      pool.query<{ maquina: unknown }>(
        `select maquina from agente where loja_id = $1 and estado = 'ativo' order by ultimo_heartbeat desc nulls last limit 1`,
        [id],
      ),
    ]);
    const lista = horas.rows.map(horaDaSaude);
    const limite24h = Date.now() - 24 * 3600_000;
    return {
      fuso: loja.rows[0]!.timezone,
      dias,
      maquina: agente.rows[0]?.maquina ?? null,
      limites: LIMITES,
      ultimas24h: resumirSaude(lista.filter((h) => h.hora.getTime() >= limite24h)),
      periodo: resumirSaude(lista),
      horas: lista,
      quedas: quedas.rows.map((q) => ({
        desligou: q.desligou,
        ligou: q.ligou,
        causa: q.causa,
        bugcheck: q.bugcheck,
        /** Quanto tempo ficou fora (nulo quando o Windows não registrou a hora em que apagou). */
        foraMin: q.desligou ? Math.round((q.ligou.getTime() - q.desligou.getTime()) / 60_000) : null,
      })),
    };
  });
}
