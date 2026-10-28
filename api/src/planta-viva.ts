// =====================================================================
// As pessoas na planta, por minuto e sem nome (A26, P3; migration 058)
// =====================================================================
// O agente manda, a cada minuto (`agent/farol_agent/planta_viva/pessoas.py`,
// `Minutos.fechados`): o calor (segundos-pessoa por célula do piso), o pico
// de pessoas ao mesmo tempo e o caminho de cada um a 1 ponto por segundo.
// Aqui: a conferência do que chega (texto de fora) e a conta que a tela
// mostra — o calor do período, o tempo em cada POSTO (contado do calor com
// os móveis da planta, que é a nuvem quem tem), a média de pessoas por hora
// e, num trecho curto, os caminhos para o replay.
//
// Sem nome e sem rosto: o número do caminho é do dia. Por posto e agregado
// é o chão seguro (estudo da planta viva, seção 7); o caminho de cada um
// só para quem configura a loja, e por 7 dias.
// =====================================================================

import type { Movel } from './planta.js';

export const LIMITES_DA_PLANTA_VIVA = {
  porLote: 120,
  celulas: [0.25, 0.5] as readonly number[],
  maximoDeCelulas: 5000,
  /** Segundos-pessoa numa célula num minuto: 60 s × até 60 pessoas. */
  maximoNaCelula: 3600,
  maximoDePessoas: 60,
  maximoDeCaminhos: 60,
  extensao: 200,
  /** O minuto pode chegar atrasado (o agente guarda quando a nuvem não aceita), até isto. */
  atrasoMaximoDias: 7,
  /** O replay só num trecho curto: o caminho de cada um, ponto a ponto. */
  replayMaximoMin: 60,
  /** Até onde se olha para trás de uma vez. */
  periodoMaximoDias: 31,
  /** Na frente do móvel, onde a pessoa fica para trabalhar nele (m). */
  folgaDoPosto: 0.7,
  guardaDosCaminhosDias: 7,
  guardaDosMinutosDias: 90,
} as const;

export type MinutoDaPlanta = {
  minuto: string;
  celulaM: number;
  calor: [number, number, number][];
  pico: number;
  caminhos: [number, [number, number, number][]][] | null;
};

const COM_FUSO = /(Z|[+-]\d{2}:?\d{2})$/i;
const inteiro = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max;
const numero = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;

/** Um minuto que o agente mandou, conferido. */
export function lerMinutoDaPlanta(bruto: unknown, onde: string, agora: Date = new Date()): { minuto?: MinutoDaPlanta; problema?: string } {
  const L = LIMITES_DA_PLANTA_VIVA;
  const o = typeof bruto === 'object' && bruto !== null && !Array.isArray(bruto) ? (bruto as Record<string, unknown>) : null;
  if (!o) return { problema: `${onde}: objeto {minuto, celulaM, calor, pico, caminhos}` };
  if (typeof o.minuto !== 'string' || o.minuto.length > 40 || !COM_FUSO.test(o.minuto) || Number.isNaN(Date.parse(o.minuto))) {
    return { problema: `${onde}.minuto: data e hora com fuso` };
  }
  const t = Date.parse(o.minuto);
  if (t % 60_000 !== 0) return { problema: `${onde}.minuto: o começo de um minuto (segundos zerados)` };
  if (t > agora.getTime() + 2 * 60_000) return { problema: `${onde}.minuto: no futuro` };
  if (t < agora.getTime() - L.atrasoMaximoDias * 86_400_000) return { problema: `${onde}.minuto: mais velho que ${L.atrasoMaximoDias} dias` };
  if (!L.celulas.includes(o.celulaM as number)) return { problema: `${onde}.celulaM: ${L.celulas.join(' ou ')}` };
  const celula = o.celulaM as number;
  const maxIndice = Math.ceil(L.extensao / celula);
  if (!Array.isArray(o.calor) || o.calor.length > L.maximoDeCelulas) return { problema: `${onde}.calor: lista de até ${L.maximoDeCelulas} [i, j, segundos]` };
  const calor: [number, number, number][] = [];
  for (const [k, c] of o.calor.entries()) {
    if (!Array.isArray(c) || c.length !== 3 || !inteiro(c[0], 0, maxIndice) || !inteiro(c[1], 0, maxIndice) || !numero(c[2], 0, L.maximoNaCelula)) {
      return { problema: `${onde}.calor[${k}]: [i, j, segundos] — a célula dentro da planta e os segundos de 0 a ${L.maximoNaCelula}` };
    }
    calor.push([c[0], c[1], c[2]]);
  }
  if (!inteiro(o.pico, 0, L.maximoDePessoas)) return { problema: `${onde}.pico: inteiro de 0 a ${L.maximoDePessoas}` };
  let caminhos: MinutoDaPlanta['caminhos'] = null;
  if (o.caminhos != null) {
    if (!Array.isArray(o.caminhos) || o.caminhos.length > L.maximoDeCaminhos) return { problema: `${onde}.caminhos: lista de até ${L.maximoDeCaminhos}` };
    caminhos = [];
    for (const [k, c] of o.caminhos.entries()) {
      if (!Array.isArray(c) || c.length !== 2 || !inteiro(c[0], 1, 1_000_000) || !Array.isArray(c[1]) || c[1].length > 60) {
        return { problema: `${onde}.caminhos[${k}]: [número do caminho, [[segundo, x, y], …] até 60]` };
      }
      const pontos: [number, number, number][] = [];
      let anterior = -1;
      for (const p of c[1] as unknown[]) {
        if (!Array.isArray(p) || p.length !== 3 || !inteiro(p[0], 0, 59) || p[0] <= anterior || !numero(p[1], 0, L.extensao) || !numero(p[2], 0, L.extensao)) {
          return { problema: `${onde}.caminhos[${k}]: cada ponto [segundo 0–59 em ordem, x, y em metros]` };
        }
        anterior = p[0];
        pontos.push([p[0], p[1], p[2]]);
      }
      caminhos.push([c[0], pontos]);
    }
  }
  return { minuto: { minuto: new Date(t).toISOString(), celulaM: celula, calor, pico: o.pico, caminhos } };
}

// ───────────────────────── a conta da tela ─────────────────────────

export type MinutoGuardado = { minuto: Date; celulaM: number; calor: [number, number, number][]; pico: number; caminhos: MinutoDaPlanta['caminhos'] };

/** O calor do período, somado, na célula de 0,25 m (a de 0,5 m é dividida em 4). */
export function calorDoPeriodo(minutos: readonly MinutoGuardado[]): { celulaM: number; calor: [number, number, number][]; totalPessoaSegundos: number } {
  const soma = new Map<string, number>();
  let total = 0;
  for (const m of minutos) {
    const fator = Math.round(m.celulaM / 0.25);
    for (const [i, j, s] of m.calor) {
      total += s;
      for (let a = 0; a < fator; a++) {
        for (let b = 0; b < fator; b++) {
          const k = `${i * fator + a},${j * fator + b}`;
          soma.set(k, (soma.get(k) ?? 0) + s / (fator * fator));
        }
      }
    }
  }
  const calor = [...soma.entries()]
    .map(([k, s]) => {
      const [i, j] = k.split(',').map(Number) as [number, number];
      return [i, j, Math.round(s * 10) / 10] as [number, number, number];
    })
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return { celulaM: 0.25, calor, totalPessoaSegundos: Math.round(total * 10) / 10 };
}

/** Os segundos-pessoa em cada posto: as células cujo centro cai no móvel com a folga na frente. */
export function postosDoPeriodo(calor: readonly [number, number, number][], celulaM: number, moveis: readonly Movel[]): { id: string; nome: string; segundos: number }[] {
  const f = LIMITES_DA_PLANTA_VIVA.folgaDoPosto;
  return moveis
    .map((m) => {
      let s = 0;
      for (const [i, j, seg] of calor) {
        const cx = (i + 0.5) * celulaM;
        const cy = (j + 0.5) * celulaM;
        if (cx >= m.x - f && cx <= m.x + m.w + f && cy >= m.y - f && cy <= m.y + m.h + f) s += seg;
      }
      return { id: m.id, nome: m.nome, segundos: Math.round(s * 10) / 10 };
    })
    .filter((p) => p.segundos > 0)
    .sort((a, b) => b.segundos - a.segundos);
}

/** Por hora: quantas pessoas em média (segundos-pessoa ÷ 3600) e o pico. */
export function porHora(minutos: readonly MinutoGuardado[]): { hora: string; mediaDePessoas: number; pico: number; minutos: number }[] {
  const horas = new Map<string, { s: number; pico: number; n: number }>();
  for (const m of minutos) {
    const h = new Date(Math.floor(m.minuto.getTime() / 3_600_000) * 3_600_000).toISOString();
    const a = horas.get(h) ?? { s: 0, pico: 0, n: 0 };
    a.s += m.calor.reduce((t, c) => t + c[2], 0);
    a.pico = Math.max(a.pico, m.pico);
    a.n += 1;
    horas.set(h, a);
  }
  return [...horas.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([hora, a]) => ({ hora, mediaDePessoas: Math.round((a.s / 3600) * 100) / 100, pico: a.pico, minutos: a.n }));
}

/** Os caminhos do trecho, ponto a ponto, com a hora de cada ponto (o replay). */
export function caminhosDoTrecho(minutos: readonly MinutoGuardado[]): { numero: number; pontos: [string, number, number][] }[] {
  const por = new Map<number, [string, number, number][]>();
  for (const m of [...minutos].sort((a, b) => a.minuto.getTime() - b.minuto.getTime())) {
    for (const [n, pontos] of m.caminhos ?? []) {
      const lista = por.get(n) ?? [];
      for (const [seg, x, y] of pontos) lista.push([new Date(m.minuto.getTime() + seg * 1000).toISOString(), x, y]);
      por.set(n, lista);
    }
  }
  return [...por.entries()].sort(([a], [b]) => a - b).map(([numero, pontos]) => ({ numero, pontos }));
}

// ───────────────────────── ao vivo (A26, P6, 28/10/2026) ─────────────────────────
// O agente manda as pessoas do instante (`agent/farol_agent/planta_viva/ao_vivo.py`): rápido (a cada ~0,5 s) enquanto
// alguém olha a tela "Ao vivo", devagar quando ninguém olha — a resposta diz. A nuvem guarda só a ÚLTIMA de cada loja,
// na memória e por pouco tempo: é a tela de agora, não histórico (o histórico são os minutos). Nada de imagem nem nome.

export const AO_VIVO = {
  maximoDePessoas: 60,
  maximoDeCanais: 64,
  canaisPorPessoa: 16,
  velocidadeMaxima: 10,
  /** Sem posição nova há mais que isto, a tela diz "parado". */
  paradoDepoisMs: 3_000,
  /** … e há mais que isto, "sem sinal": a posição de antes não vale mais e some. */
  validadeMs: 30_000,
  /** Quem leu a tela "olha" por este tempo depois da última leitura: o agente manda rápido. */
  olhandoMs: 20_000,
} as const;

export type PessoaAoVivo = { n: number; x: number; y: number; vx: number; vy: number; canais: string[] };
export type AgoraDaPlanta = { quando: string; pessoas: PessoaAoVivo[]; canais: string[] };
export type SituacaoAoVivo = 'ao_vivo' | 'parado' | 'sem_sinal';

const UUID_DO_CANAL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const listaDeCanais = (v: unknown, max: number): v is string[] =>
  Array.isArray(v) && v.length <= max && v.every((c) => typeof c === 'string' && UUID_DO_CANAL.test(c));

/** As pessoas do instante, como o agente mandou, conferidas. */
export function lerAgoraDaPlanta(bruto: unknown): { agora?: AgoraDaPlanta; problema?: string } {
  const A = AO_VIVO;
  const ext = LIMITES_DA_PLANTA_VIVA.extensao;
  const o = typeof bruto === 'object' && bruto !== null && !Array.isArray(bruto) ? (bruto as Record<string, unknown>) : null;
  if (!o) return { problema: 'objeto {quando, pessoas, canais}' };
  if (typeof o.quando !== 'string' || o.quando.length > 40 || !COM_FUSO.test(o.quando) || Number.isNaN(Date.parse(o.quando))) {
    return { problema: 'quando: data e hora com fuso' };
  }
  if (!listaDeCanais(o.canais, A.maximoDeCanais)) return { problema: `canais: até ${A.maximoDeCanais} identificadores de canal` };
  if (!Array.isArray(o.pessoas) || o.pessoas.length > A.maximoDePessoas) return { problema: `pessoas: lista de até ${A.maximoDePessoas}` };
  const pessoas: PessoaAoVivo[] = [];
  for (const [i, p] of o.pessoas.entries()) {
    const q = typeof p === 'object' && p !== null && !Array.isArray(p) ? (p as Record<string, unknown>) : null;
    if (
      !q || !inteiro(q.n, 1, 1_000_000) || !numero(q.x, -ext, ext) || !numero(q.y, -ext, ext)
      || !numero(q.vx, -A.velocidadeMaxima, A.velocidadeMaxima) || !numero(q.vy, -A.velocidadeMaxima, A.velocidadeMaxima)
      || !listaDeCanais(q.canais, A.canaisPorPessoa)
    ) {
      return { problema: `pessoas[${i}]: {n (inteiro), x, y (m), vx, vy (m/s), canais}` };
    }
    pessoas.push({ n: q.n, x: q.x, y: q.y, vx: q.vx, vy: q.vy, canais: [...q.canais] });
  }
  return { agora: { quando: o.quando, pessoas, canais: [...(o.canais as string[])] } };
}

/** Ao vivo, parado ou sem sinal, pelo tempo desde que a nuvem recebeu a última posição. */
export function situacaoAoVivo(recebidoEmMs: number | null | undefined, agoraMs: number): SituacaoAoVivo {
  if (recebidoEmMs == null) return 'sem_sinal';
  const idade = agoraMs - recebidoEmMs;
  if (idade > AO_VIVO.validadeMs) return 'sem_sinal';
  return idade > AO_VIVO.paradoDepoisMs ? 'parado' : 'ao_vivo';
}
