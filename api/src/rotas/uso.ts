// =====================================================================
// POST /v1/uso — o uso da máquina de análise, por hora
// =====================================================================
// O computador da loja (onde o agente roda) diz, por hora, quanto do
// processador, da memória e da placa de vídeo foi usado, e quanto disco
// sobra. É o que deixa o console responder "a máquina está dando conta?".
//
// Como o resumo por hora: **o agente manda o acumulado e a nuvem
// substitui**, numa instrução só para N horas. Aqui não há recusa por
// linha — a hora é da máquina de quem está autenticado, não de um critério
// ou canal que possa ter saído da loja.
//
// De cada peça vêm a soma e a quantidade de amostras, não a média: quem
// junta várias horas é a leitura. E cada peça tem a SUA quantidade —
// máquina sem contador de placa de vídeo manda zero amostras dela, e a
// tela diz "sem medida", não 0%.
//
// O corpo de exemplo, completo, está em `contratos/uso-da-maquina.json`.
// =====================================================================

import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

import { autenticarAgente, ErroDeAuth } from '../auth.js';
import type { Autor } from '../db.js';
import { lerMinutos, lerQueda, lerSensores, type Queda } from '../saude-da-maquina.js';

const COM_FUSO = /(Z|[+-]\d{2}:?\d{2})$/i;
const HORA_CHEIA = /T\d{2}:00:00(\.0+)?(Z|[+-]\d{2}:?\d{2})$/i;

/** Teto por requisição, o mesmo do resumo. */
const MAX_POR_LOTE = 500;
/** Uma amostra a cada meio minuto são 120 por hora; uma por segundo, 3.600. */
const TETO_DE_AMOSTRAS = 4_000;
const TETO_DO_TEXTO = 200;

/** As peças medidas em porcentagem, pelo prefixo dos campos. */
const PECAS = ['cpu', 'mem', 'gpu', 'processoCpu'] as const;
type Peca = (typeof PECAS)[number];

export type UsoEntrada = {
  hora: string;
  amostras: number;
  processoMemMaxMb: number | null;
  discoLivreGb: number | null;
  discoTotalGb: number | null;
  /** O monitoramento (migration 056): os sensores da hora e o pico de cada minuto. Opcionais (agente antigo não manda). */
  sensores?: unknown;
  minutos?: unknown;
} & Record<`${Peca}Soma`, number> &
  Record<`${Peca}Amostras`, number> &
  Record<`${Peca}Max`, number | null>;

const ehNumero = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export function validarUso(u: unknown, i: number): string | null {
  const onde = `horas[${i}]`;
  if (typeof u !== 'object' || u === null || Array.isArray(u)) return `${onde}: não é objeto`;
  const v = u as Record<string, unknown>;

  if (typeof v.hora !== 'string' || Number.isNaN(Date.parse(v.hora))) return `${onde}.hora: data ISO obrigatória`;
  // Sem fuso o banco leria como UTC e a hora cairia três casas fora.
  if (!COM_FUSO.test(v.hora.trim())) return `${onde}.hora: precisa do fuso (ex.: 2026-10-07T20:00:00-03:00)`;
  if (!HORA_CHEIA.test(v.hora.trim())) return `${onde}.hora: tem que ser hora cheia (minuto e segundo zerados)`;

  const amostras = v.amostras;
  if (typeof amostras !== 'number' || !Number.isInteger(amostras) || amostras < 1 || amostras > TETO_DE_AMOSTRAS) {
    return `${onde}.amostras: inteiro de 1 a ${TETO_DE_AMOSTRAS}`;
  }

  for (const peca of PECAS) {
    const n = v[`${peca}Amostras`];
    const soma = v[`${peca}Soma`];
    const max = v[`${peca}Max`];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > amostras) {
      return `${onde}.${peca}Amostras: inteiro de 0 a amostras (${amostras})`;
    }
    if (!ehNumero(soma) || soma < 0) return `${onde}.${peca}Soma: número a partir de 0`;
    // Cada amostra vai de 0 a 100: a soma não passa de 100 por amostra.
    // Pegar isto aqui evita um "processador em 340%" na tela.
    if (soma > n * 100 + 1e-6) return `${onde}.${peca}Soma: maior que 100 por amostra`;
    if (max != null && (!ehNumero(max) || max < 0 || max > 100)) return `${onde}.${peca}Max: de 0 a 100, ou nulo`;
    // Peça sem amostra não tem pico; peça com amostra tem.
    if (n === 0 && max != null) return `${onde}.${peca}Max: sem amostra não há pico`;
    if (n > 0 && max == null) return `${onde}.${peca}Max: com amostra, o pico é obrigatório`;
    if (n > 0 && max != null && soma / n > max + 0.01) return `${onde}.${peca}Soma: média maior que o pico`;
  }

  for (const campo of ['processoMemMaxMb', 'discoLivreGb', 'discoTotalGb'] as const) {
    const n = v[campo];
    if (n != null && (!ehNumero(n) || n < 0 || n > 1e9)) return `${onde}.${campo}: número a partir de 0, ou nulo`;
  }
  if (ehNumero(v.discoLivreGb) && ehNumero(v.discoTotalGb) && v.discoLivreGb > v.discoTotalGb + 0.01) {
    return `${onde}.discoLivreGb: maior que o disco inteiro`;
  }
  // o monitoramento (migration 056)
  const sensores = lerSensores(v.sensores, amostras, onde);
  if (sensores.problema) return sensores.problema;
  const minutos = lerMinutos(v.minutos, onde);
  if (minutos.problema) return minutos.problema;
  return null;
}

export type Maquina = {
  processador: string | null;
  nucleos: number | null;
  memoriaGb: number | null;
  placaDeVideo: string | null;
};

/**
 * As peças da máquina, como o sistema operacional as descreve. É texto de
 * fora: entra cortado, e só os quatro campos conhecidos — nada de guardar
 * um objeto qualquer que o agente mandar.
 */
export function lerMaquina(bruto: unknown): { maquina?: Maquina | null; problema?: string } {
  if (bruto == null) return { maquina: null };
  if (typeof bruto !== 'object' || Array.isArray(bruto)) return { problema: 'maquina: objeto {processador, nucleos, memoriaGb, placaDeVideo}' };
  const v = bruto as Record<string, unknown>;
  const texto = (campo: string): string | null | undefined => {
    const t = v[campo];
    if (t == null) return null;
    if (typeof t !== 'string') return undefined;
    return t.trim().slice(0, TETO_DO_TEXTO) || null;
  };
  const processador = texto('processador');
  const placaDeVideo = texto('placaDeVideo');
  if (processador === undefined) return { problema: 'maquina.processador: texto' };
  if (placaDeVideo === undefined) return { problema: 'maquina.placaDeVideo: texto' };
  const nucleos = v.nucleos ?? null;
  if (nucleos !== null && (typeof nucleos !== 'number' || !Number.isInteger(nucleos) || nucleos < 1 || nucleos > 4096)) {
    return { problema: 'maquina.nucleos: inteiro a partir de 1' };
  }
  const memoriaGb = v.memoriaGb ?? null;
  if (memoriaGb !== null && (!ehNumero(memoriaGb) || memoriaGb <= 0 || memoriaGb > 1e6)) {
    return { problema: 'maquina.memoriaGb: número maior que 0' };
  }
  return { maquina: { processador, nucleos: nucleos as number | null, memoriaGb: memoriaGb as number | null, placaDeVideo } };
}

export async function gravarUso(
  pool: pg.Pool,
  autor: Autor,
  horas: UsoEntrada[],
  maquina: Maquina | null,
): Promise<{ aceitos: number }> {
  // As peças da máquina moram no agente: mudou a placa, muda aqui.
  if (maquina) {
    await pool.query(
      `update agente set maquina = $2::jsonb
        where id = $1 and maquina is distinct from $2::jsonb`,
      [autor.agenteId, JSON.stringify(maquina)],
    );
  }
  if (horas.length === 0) return { aceitos: 0 };

  const carga = horas.map((h, i) => ({
    i,
    hora: h.hora,
    amostras: h.amostras,
    cpu_soma: h.cpuSoma, cpu_amostras: h.cpuAmostras, cpu_max: h.cpuMax ?? null,
    mem_soma: h.memSoma, mem_amostras: h.memAmostras, mem_max: h.memMax ?? null,
    gpu_soma: h.gpuSoma, gpu_amostras: h.gpuAmostras, gpu_max: h.gpuMax ?? null,
    proc_cpu_soma: h.processoCpuSoma, proc_cpu_amostras: h.processoCpuAmostras, proc_cpu_max: h.processoCpuMax ?? null,
    proc_mem_max_mb: h.processoMemMaxMb ?? null,
    disco_livre_gb: h.discoLivreGb ?? null,
    disco_total_gb: h.discoTotalGb ?? null,
    // só o que a conferência deixou passar (os campos conhecidos)
    sensores: lerSensores(h.sensores, h.amostras, '').sensores ?? null,
    minutos: lerMinutos(h.minutos, '').minutos ?? null,
  }));

  // UMA instrução para N horas. `distinct on` protege contra a mesma hora
  // duas vezes no lote (o Postgres recusaria a instrução inteira): vale a
  // última.
  const gravadas = await pool.query(
    `insert into uso_hora (
        tenant_id, loja_id, agente_id, hora, amostras,
        cpu_soma, cpu_amostras, cpu_max, mem_soma, mem_amostras, mem_max,
        gpu_soma, gpu_amostras, gpu_max, proc_cpu_soma, proc_cpu_amostras, proc_cpu_max,
        proc_mem_max_mb, disco_livre_gb, disco_total_gb, sensores, minutos)
     select distinct on (e.hora)
            $1, $2, $3, e.hora, e.amostras,
            e.cpu_soma, e.cpu_amostras, e.cpu_max, e.mem_soma, e.mem_amostras, e.mem_max,
            e.gpu_soma, e.gpu_amostras, e.gpu_max, e.proc_cpu_soma, e.proc_cpu_amostras, e.proc_cpu_max,
            e.proc_mem_max_mb, e.disco_livre_gb, e.disco_total_gb, e.sensores, e.minutos
       from jsonb_to_recordset($4::jsonb) as e(
            i integer, hora timestamptz, amostras integer,
            cpu_soma numeric, cpu_amostras integer, cpu_max numeric,
            mem_soma numeric, mem_amostras integer, mem_max numeric,
            gpu_soma numeric, gpu_amostras integer, gpu_max numeric,
            proc_cpu_soma numeric, proc_cpu_amostras integer, proc_cpu_max numeric,
            proc_mem_max_mb numeric, disco_livre_gb numeric, disco_total_gb numeric,
            sensores jsonb, minutos jsonb)
      order by e.hora, e.i desc
     on conflict (agente_id, hora) do update set
        amostras = excluded.amostras,
        cpu_soma = excluded.cpu_soma, cpu_amostras = excluded.cpu_amostras, cpu_max = excluded.cpu_max,
        mem_soma = excluded.mem_soma, mem_amostras = excluded.mem_amostras, mem_max = excluded.mem_max,
        gpu_soma = excluded.gpu_soma, gpu_amostras = excluded.gpu_amostras, gpu_max = excluded.gpu_max,
        proc_cpu_soma = excluded.proc_cpu_soma, proc_cpu_amostras = excluded.proc_cpu_amostras,
        proc_cpu_max = excluded.proc_cpu_max, proc_mem_max_mb = excluded.proc_mem_max_mb,
        disco_livre_gb = excluded.disco_livre_gb, disco_total_gb = excluded.disco_total_gb,
        sensores = excluded.sensores, minutos = excluded.minutos,
        atualizado_em = now()
     returning hora`,
    [autor.tenantId, autor.lojaId, autor.agenteId, JSON.stringify(carga)],
  );
  return { aceitos: gravadas.rowCount ?? 0 };
}

export function rotasDeUso(app: FastifyInstance, pool: pg.Pool): void {
  app.post('/v1/uso', async (req, resposta) => {
    let autor: Autor;
    try {
      autor = await autenticarAgente(pool, req.headers.authorization);
    } catch (e) {
      if (e instanceof ErroDeAuth) {
        req.log.warn({ motivo: e.motivo }, 'agente recusado');
        return resposta.status(e.status).send({ erro: e.motivo, mensagem: e.message });
      }
      throw e;
    }

    const corpo = req.body as { horas?: unknown; maquina?: unknown; queda?: unknown };
    if (!Array.isArray(corpo?.horas)) {
      return resposta.status(400).send({ erro: 'corpo_invalido', mensagem: 'esperado { maquina, horas: [...] }' });
    }
    if (corpo.horas.length > MAX_POR_LOTE) {
      return resposta.status(413).send({ erro: 'lote_grande', mensagem: `máximo ${MAX_POR_LOTE} horas por requisição` });
    }

    const lida = lerMaquina(corpo.maquina);
    const queda = lerQueda(corpo.queda);
    const problemas = [
      ...(lida.problema ? [lida.problema] : []),
      ...(queda.problema ? [queda.problema] : []),
      ...corpo.horas.map((h, i) => validarUso(h, i)).filter((p): p is string => p !== null),
    ];
    if (problemas.length > 0) {
      return resposta.status(422).send({ erro: 'validacao', problemas });
    }

    const gravado = await gravarUso(pool, autor, corpo.horas as UsoEntrada[], lida.maquina ?? null);
    const quedaNova = queda.queda ? await gravarQueda(pool, autor, queda.queda) : false;
    if (quedaNova) req.log.warn({ loja: autor.lojaId, agente: autor.agenteId, queda: queda.queda }, 'o PC do agente DESLIGOU DE REPENTE');
    return queda.queda ? { ...gravado, queda: quedaNova ? 'nova' : 'ja_tinha' } : gravado;
  });
}

/** A queda do PC, uma vez por subida do Windows (o agente manda a mesma a cada envio). Verdadeiro: era nova. */
export async function gravarQueda(pool: pg.Pool, autor: Autor, q: Queda): Promise<boolean> {
  const r = await pool.query(
    `insert into computador_queda (tenant_id, loja_id, agente_id, desligou, ligou, causa, bugcheck)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (agente_id, ligou) do nothing`,
    [autor.tenantId, autor.lojaId, autor.agenteId, q.desligou, q.ligou, q.causa, q.bugcheck],
  );
  return (r.rowCount ?? 0) > 0;
}
