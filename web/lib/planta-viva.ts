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
