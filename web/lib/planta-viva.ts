// =====================================================================
// A planta viva — a conta das telas (A26, P4)
// =====================================================================
// O servidor calcula a calibração (`api/src/calibracao.ts`: a homografia, os
// erros, o piso que a câmera vê) e soma os minutos (`api/src/planta-viva.ts`).
// Aqui fica o pouco que a tela precisa fazer sozinha, sem ir ao servidor:
// levar um ponto da imagem ao chão (para mostrar onde a conta acha que o
// próximo ponto fica), o quanto do piso as câmeras cobrem, a cor de cada
// quadrado do calor e o trecho do replay. Nada aqui busca nada: é testado
// pela API (`api/testes/planta-viva.test.ts`).
// =====================================================================

export type Pt = [number, number];
export type ParDaCalibracao = { img: Pt; piso: Pt };

/** Uma calibração como a API devolve (a lista traz `quantosPontos`; a de um canal, os `pares`). */
export type Calibracao = {
  pontoId: string;
  pares?: ParDaCalibracao[];
  quantosPontos?: number;
  homografia: number[];
  erroMedioM: number | null;
  erroMaximoM: number | null;
  /** A régua honesta: deixando um ponto de fora por vez. Nula com 4 pontos. */
  erroConferidoM: number | null;
  area: Pt[];
  versao: number;
  atualizadaEm: string;
};

export type ErrosDaCalibracao = {
  porPar: number[];
  medioM: number;
  maximoM: number;
  conferido: { porPar: Array<number | null>; medianaM: number; maximoM: number } | null;
};
export type ConferenciaDaCalibracao = { homografia: number[]; erros: ErrosDaCalibracao; area: Pt[] };

export type LeituraDaPlantaViva = {
  de: string;
  ate: string;
  minutos: number;
  celulaM: number;
  calor: Array<[number, number, number]>;
  totalPessoaSegundos: number;
  postos: Array<{ id: string; nome: string; segundos: number }>;
  porHora: Array<{ hora: string; mediaDePessoas: number; pico: number; minutos: number }>;
  pico: number;
  /** Nulo fora do replay (trecho de mais de 60 min, ou quem não configura a loja). */
  caminhos: Array<{ numero: number; pontos: Array<[string, number, number]> }> | null;
};

/** O mínimo de pontos para a conta começar, e o recomendado (o estudo da planta viva, seção 4). */
export const PONTOS_MINIMOS = 4;
export const PONTOS_RECOMENDADOS: readonly [number, number] = [8, 15];
/** Erro de um ponto (deixado de fora) acima disto costuma ser trena ou clique no lugar errado. */
export const ERRO_SUSPEITO_M = 0.15;

/** Onde o ponto da imagem (normalizada) cai no chão, pela homografia; nulo no horizonte ou atrás da câmera. */
export function projetar(h: readonly number[], p: Pt): Pt | null {
  if (h.length !== 9) return null;
  const w = h[6]! * p[0] + h[7]! * p[1] + h[8]!;
  if (!(w > 1e-9)) return null;
  return [(h[0]! * p[0] + h[1]! * p[1] + h[2]!) / w, (h[3]! * p[0] + h[4]! * p[1] + h[5]!) / w];
}

export function dentro(pt: Pt, pol: readonly Pt[]): boolean {
  let d = false;
  for (let i = 0, j = pol.length - 1; i < pol.length; j = i++) {
    const [xi, yi] = pol[i]!;
    const [xj, yj] = pol[j]!;
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) d = !d;
  }
  return d;
}

type Ret = { x: number; y: number; w: number; h: number };

/**
 * O quanto do chão dos ambientes as áreas cobrem, numa grade de `passo` metros: a fração coberta e os quadrados que
 * nenhuma área vê (para desenhar hachurado).
 */
export function coberturaDoPiso(ambientes: readonly Ret[], areas: ReadonlyArray<readonly Pt[]>, passo = 0.25): { parte: number; semVer: Pt[] } {
  let total = 0;
  let vistos = 0;
  const semVer: Pt[] = [];
  for (const a of ambientes) {
    for (let x = a.x + passo / 2; x < a.x + a.w; x += passo) {
      for (let y = a.y + passo / 2; y < a.y + a.h; y += passo) {
        total += 1;
        if (areas.some((pol) => pol.length >= 3 && dentro([x, y], pol))) vistos += 1;
        else semVer.push([x - passo / 2, y - passo / 2]);
      }
    }
  }
  return { parte: total ? vistos / total : 0, semVer };
}

/** A régua de uma calibração, para dizer: o erro conferido (ou, sem ele, o médio), em centímetros. */
export function reguaEmCm(c: Pick<Calibracao, 'erroConferidoM' | 'erroMedioM'>): number | null {
  const m = c.erroConferidoM ?? c.erroMedioM;
  return m == null ? null : Math.round(m * 100);
}

/** A cor de um quadrado do calor pela fração do maior: pouco = mostarda, médio = pão, muito = ketchup. */
export function corDoCalor(fracao: number): { cor: 'mostarda' | 'pao' | 'ketchup'; opacidade: number } {
  const f = Math.max(0, Math.min(1, fracao));
  return { cor: f > 0.6 ? 'ketchup' : f > 0.3 ? 'pao' : 'mostarda', opacidade: Math.round((0.25 + f * 0.7) * 100) / 100 };
}

/** "4 h 18 min", "36 min", "40 s". */
export function duracao(segundos: number): string {
  const s = Math.round(segundos);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/** Onde cada caminho está no instante `t` (ms) do replay: o último ponto dele até ali (e o rastro dos últimos 30 s). */
export function noInstante(caminhos: NonNullable<LeituraDaPlantaViva['caminhos']>, t: number, rastroMs = 30_000): Array<{ numero: number; agora: Pt; rastro: Pt[] }> {
  const saida: Array<{ numero: number; agora: Pt; rastro: Pt[] }> = [];
  for (const c of caminhos) {
    let ultimo: Pt | null = null;
    let quando = -Infinity;
    const rastro: Pt[] = [];
    for (const [iso, x, y] of c.pontos) {
      const ms = Date.parse(iso);
      if (ms > t) break;
      ultimo = [x, y];
      quando = ms;
      if (ms >= t - rastroMs) rastro.push([x, y]);
    }
    // quem sumiu há mais de 3 s não está mais lá
    if (ultimo && t - quando <= 3000) saida.push({ numero: c.numero, agora: ultimo, rastro });
  }
  return saida;
}

// ───────────────────────── ao vivo (A26, P7) ─────────────────────────
// A tela lê a última posição de cada pessoa (`GET /v1/lojas/:id/planta-viva/agora`) a cada segundo; entre uma leitura e
// outra, a figura anda suave até lá. O rótulo de cada pessoa é o POSTO em que ela está — sem nome.

export type PessoaAoVivo = { n: number; x: number; y: number; vx: number; vy: number; canais: string[] };
export type AgoraDaPlanta = {
  situacao: 'ao_vivo' | 'parado' | 'sem_sinal';
  /** Há quantos segundos a nuvem recebeu a última posição (nulo = nunca, ou faz tempo). */
  idadeS: number | null;
  quando: string | null;
  pessoas: PessoaAoVivo[];
  /** Os canais que deram quadro no último instante. */
  canais: string[];
};

/** Na frente do móvel, onde a pessoa fica para trabalhar nele (m) — a mesma folga do "tempo em cada posto". */
export const FOLGA_DO_POSTO = 0.7;

/**
 * O posto em que a pessoa está: o móvel em cuja frente (com `FOLGA_DO_POSTO`) ela fica — o mais perto, se há mais de um;
 * nulo = passando. A mesma régua do "tempo em cada posto" do servidor.
 */
export function postoDe<M extends Ret & { id: string; nome: string }>(x: number, y: number, moveis: readonly M[], folga = FOLGA_DO_POSTO): M | null {
  let melhor: M | null = null;
  let menor = Infinity;
  for (const m of moveis) {
    const dx = Math.max(m.x - x, 0, x - (m.x + m.w));
    const dy = Math.max(m.y - y, 0, y - (m.y + m.h));
    const d = Math.hypot(dx, dy);
    if (dx <= folga && dy <= folga && d < menor) {
      menor = d;
      melhor = m;
    }
  }
  return melhor;
}

/**
 * Onde a figura fica agora, andando suave até o alvo: a cada `dtMs`, percorre a fração `1 − e^(−dt/τ)` do que falta
 * (τ = 250 ms) — sem pulo entre uma leitura e outra, sem passar do alvo.
 */
export function aproximar(atual: Pt, alvo: Pt, dtMs: number, tauMs = 250): Pt {
  const k = 1 - Math.exp(-Math.max(0, dtMs) / tauMs);
  return [atual[0] + (alvo[0] - atual[0]) * k, atual[1] + (alvo[1] - atual[1]) * k];
}

/**
 * O que a tela guarda de cada pessoa entre as leituras: o posto e desde quando ela está nele, e o rastro dos últimos
 * `rastroMs`. Quem não veio na leitura sai.
 */
export type MemoriaAoVivo = Map<number, { posto: string | null; desde: number; rastro: Array<[number, number, number]> }>;

export function lembrar<M extends Ret & { id: string; nome: string }>(
  antes: MemoriaAoVivo,
  pessoas: readonly PessoaAoVivo[],
  agoraMs: number,
  moveis: readonly M[],
  rastroMs = 8_000,
): MemoriaAoVivo {
  const depois: MemoriaAoVivo = new Map();
  for (const p of pessoas) {
    const posto = postoDe(p.x, p.y, moveis)?.id ?? null;
    const a = antes.get(p.n);
    const rastro = (a?.rastro ?? []).filter(([, , t]) => agoraMs - t <= rastroMs);
    const ultimo = rastro[rastro.length - 1];
    if (!ultimo || Math.hypot(ultimo[0] - p.x, ultimo[1] - p.y) > 0.05) rastro.push([p.x, p.y, agoraMs]);
    depois.set(p.n, { posto, desde: a && a.posto === posto ? a.desde : agoraMs, rastro });
  }
  return depois;
}

// ───────────────────────── o atendimento (28/10/2026) ─────────────────────────
// A aba Atendimento: a espera em cada área de medida e quem entra e sai por cada porta, como a API conta
// (`api/src/atendimento.ts`). Aqui: a forma da resposta e o que a tela faz com ela.

export type EsperaNaArea = {
  id: string;
  nome: string;
  tipo: 'espera';
  /** Cada espera: [quando começou (ISO), quantos segundos]. */
  visitas: Array<[string, number]>;
  pessoas: number;
  medianaS: number | null;
  maiorS: number | null;
  acimaDe5Min: number;
  porHora: Array<{ hora: string; pessoas: number; medianaS: number }>;
  agora: number | null;
};
export type PortaNaArea = {
  id: string;
  nome: string;
  tipo: 'porta';
  entradas: string[];
  saidas: string[];
  naLoja: { quantos: number; medianaS: number | null };
  porHora: Array<{ hora: string; entradas: number; saidas: number }>;
  agora: number | null;
};
export type AtendimentoDaPlanta = { de: string; ate: string; minutos: number; areas: Array<EsperaNaArea | PortaNaArea> };

/** A espera longa (a barra vermelha e o "acima de 5 min"), a mesma da API. */
export const ESPERA_LONGA_S = 300;

/** A duração como relógio de espera: "2:37" (minutos:segundos), ou "1:02:05" com horas. */
export function minSeg(segundos: number): string {
  const s = Math.max(0, Math.round(segundos));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Quanto o relógio do fuso está à frente do UTC no instante (ms). */
function deslocamentoDoFuso(fuso: string, ms: number): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms));
  const v = (t: string): number => Number(partes.find((p) => p.type === t)?.value ?? 0);
  return Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second')) - Math.floor(ms / 1000) * 1000;
}

/** O instante (ms) de uma hora de relógio no fuso da loja. */
export function instanteNoFuso(fuso: string, ano: number, mes: number, dia: number, hora: number, minuto: number): number {
  const chute = Date.UTC(ano, mes - 1, dia, hora, minuto);
  const primeiro = chute - deslocamentoDoFuso(fuso, chute);
  return chute - deslocamentoDoFuso(fuso, primeiro); // de novo: perto de uma troca de horário, o deslocamento muda
}

type FaixaDaLoja = { dias: number[]; hora_ini: string; hora_fim: string };

/**
 * O expediente de agora (ou o último, com a loja fechada) e o anterior, pelo horário cadastrado da loja e no fuso
 * dela: [de, ate] em ms. `dias`: 1 = segunda … 7 = domingo; `hora_fim` menor ou igual a `hora_ini` fecha no dia
 * seguinte. Sem horário cadastrado: hoje (desde a meia-noite da loja) e ontem.
 */
export function expedientes(horario: readonly FaixaDaLoja[], fuso: string, agoraMs: number): { este: [number, number]; anterior: [number, number] } {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(agoraMs));
  const [ano, mes, dia] = hoje.split('-').map(Number) as [number, number, number];
  const meiaNoite = (k: number) => instanteNoFuso(fuso, ano, mes, dia + k, 0, 0);
  if (!horario.length) return { este: [meiaNoite(0), agoraMs], anterior: [meiaNoite(-1), meiaNoite(0)] };
  const hm = (t: string): [number, number] => t.split(':').map(Number) as [number, number];
  const janelas: Array<[number, number]> = [];
  for (let k = -8; k <= 0; k += 1) {
    // o dia da semana da loja nesse dia (1 = segunda … 7 = domingo)
    const ds = new Date(Date.UTC(ano, mes - 1, dia + k)).getUTCDay();
    const diaDaSemana = ds === 0 ? 7 : ds;
    for (const f of horario) {
      if (!f.dias.includes(diaDaSemana)) continue;
      const [hi, mi] = hm(f.hora_ini);
      const [hf, mf] = hm(f.hora_fim);
      const ini = instanteNoFuso(fuso, ano, mes, dia + k, hi, mi);
      const viraODia = hf * 60 + mf <= hi * 60 + mi;
      const fim = instanteNoFuso(fuso, ano, mes, dia + k + (viraODia ? 1 : 0), hf, mf);
      if (ini <= agoraMs) janelas.push([ini, Math.min(fim, agoraMs)]);
    }
  }
  janelas.sort((a, b) => a[0] - b[0]);
  const ultima = janelas[janelas.length - 1];
  const penultima = janelas[janelas.length - 2];
  if (!ultima) return { este: [meiaNoite(0), agoraMs], anterior: [meiaNoite(-1), meiaNoite(0)] };
  return { este: ultima, anterior: penultima ?? [ultima[0] - 86_400_000, ultima[0]] };
}

/** Quantas câmeras calibradas veem a área: o centro dela dentro do chão que a calibração cobre. */
export function camerasQueVeem(area: Ret, chaoDasCalibracoes: ReadonlyArray<readonly Pt[]>): number {
  const centro: Pt = [area.x + area.w / 2, area.y + area.h / 2];
  return chaoDasCalibracoes.filter((pol) => pol.length >= 3 && dentro(centro, pol)).length;
}
