// =====================================================================
// O desenho da área — a conta, sem tela
// =====================================================================
// A área de análise é um polígono em fração do quadro (0 a 1), ponto a
// ponto, na ordem do contorno. O agente recorta esse desenho e apaga o que
// fica fora dele antes de analisar.
//
// As duas conferências daqui (`areaDe` contra `AREA_MINIMA`, e `seCruza`)
// são as MESMAS do servidor (`api/src/poligono.ts`): a tela avisa enquanto
// se desenha, o servidor recusa se chegar torto.
// =====================================================================

export type Ponto = [number, number];
export type Caixa = { x1: number; y1: number; x2: number; y2: number };

/** Quantos pontos a tela deixa pôr num desenho. O servidor aceita mais (64). */
export const MAX_PONTOS = 24;
/** O menor desenho aceito: um quadradinho de 1% de lado. */
export const AREA_MINIMA = 0.0001;

export const prender = (v: number): number => Math.min(1, Math.max(0, v));
/** Quatro casas: mais fino que um ponto de imagem em qualquer câmera. */
const arredondar = (v: number): number => Math.round(prender(v) * 10000) / 10000;
export const limpar = (pontos: Ponto[]): Ponto[] => pontos.map(([x, y]) => [arredondar(x), arredondar(y)]);

export const retangulo = (c: Caixa): Ponto[] => [
  [c.x1, c.y1],
  [c.x2, c.y1],
  [c.x2, c.y2],
  [c.x1, c.y2],
];

export const QUADRO_INTEIRO: Ponto[] = retangulo({ x1: 0, y1: 0, x2: 1, y2: 1 });

/** O retângulo que envolve o desenho. É o que o agente recorta. */
export function caixaDe(pontos: Ponto[]): Caixa {
  if (pontos.length === 0) return { x1: 0, y1: 0, x2: 1, y2: 1 };
  const xs = pontos.map((p) => p[0]);
  const ys = pontos.map((p) => p[1]);
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
}

/** A área do desenho (fórmula do cadarço), em fração do quadro. */
export function areaDe(pontos: Ponto[]): number {
  let soma = 0;
  for (let i = 0; i < pontos.length; i += 1) {
    const [x1, y1] = pontos[i]!;
    const [x2, y2] = pontos[(i + 1) % pontos.length]!;
    soma += x1 * y2 - x2 * y1;
  }
  return Math.abs(soma) / 2;
}

/** O ponto está dentro do desenho? */
export function contem(pontos: Ponto[], x: number, y: number): boolean {
  let dentro = false;
  for (let i = 0, j = pontos.length - 1; i < pontos.length; j = i, i += 1) {
    const [xi, yi] = pontos[i]!;
    const [xj, yj] = pontos[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

const lado = (a: Ponto, b: Ponto, c: Ponto): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

function atravessam(a: Ponto, b: Ponto, c: Ponto, d: Ponto): boolean {
  const d1 = lado(a, b, c);
  const d2 = lado(a, b, d);
  const d3 = lado(c, d, a);
  const d4 = lado(c, d, b);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** O contorno passa por cima dele mesmo? Encostar na ponta não é cruzar. */
export function seCruza(pontos: Ponto[]): boolean {
  const n = pontos.length;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (atravessam(pontos[i]!, pontos[(i + 1) % n]!, pontos[j]!, pontos[(j + 1) % n]!)) return true;
    }
  }
  return false;
}

/** O que impede de salvar o desenho, ou `null`. As mesmas duas recusas do servidor. */
export function problemaDoDesenho(pontos: Ponto[]): string | null {
  if (pontos.length < 3) return 'O desenho precisa de pelo menos três pontos.';
  if (seCruza(pontos)) {
    return 'O contorno passa por cima dele mesmo. Arraste os pontos até as linhas não se cruzarem.';
  }
  if (areaDe(pontos) < AREA_MINIMA) return 'A área ficou sem tamanho: os pontos estão em linha, ou em cima uns dos outros.';
  return null;
}

/** O meio do lado que sai do ponto `i`. */
export function meioDoLado(pontos: Ponto[], i: number): Ponto {
  const [x1, y1] = pontos[i]!;
  const [x2, y2] = pontos[(i + 1) % pontos.length]!;
  return [(x1 + x2) / 2, (y1 + y2) / 2];
}

/** Um ponto novo DEPOIS do ponto `i` (no lado que sai dele). */
export function comPontoNovo(pontos: Ponto[], i: number, novo: Ponto): Ponto[] {
  return [...pontos.slice(0, i + 1), novo, ...pontos.slice(i + 1)];
}

export const semPonto = (pontos: Ponto[], i: number): Ponto[] => pontos.filter((_, k) => k !== i);

export const comPontoEm = (pontos: Ponto[], i: number, p: Ponto): Ponto[] =>
  pontos.map((antigo, k) => (k === i ? [prender(p[0]), prender(p[1])] : antigo));

/** O lado mais comprido: é onde um ponto novo, pedido pelo botão, faz mais falta. */
export function ladoMaisComprido(pontos: Ponto[]): number {
  let melhor = 0;
  let maior = -1;
  for (let i = 0; i < pontos.length; i += 1) {
    const [x1, y1] = pontos[i]!;
    const [x2, y2] = pontos[(i + 1) % pontos.length]!;
    const d = Math.hypot(x2 - x1, y2 - y1);
    if (d > maior) {
      maior = d;
      melhor = i;
    }
  }
  return melhor;
}

/** O desenho é um retângulo alinhado ao quadro? */
export function ehRetangulo(pontos: Ponto[]): boolean {
  if (pontos.length !== 4) return false;
  const c = caixaDe(pontos);
  const perto = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  return pontos.every(([x, y]) => (perto(x, c.x1) || perto(x, c.x2)) && (perto(y, c.y1) || perto(y, c.y2))) && perto(areaDe(pontos), (c.x2 - c.x1) * (c.y2 - c.y1));
}

/**
 * Quanto de `a` também está dentro de `b`, de 0 a 1. Por amostragem, numa
 * grade sobre o retângulo de `a`: é para um aviso na tela, não para conta.
 */
export function sobreposicao(a: Ponto[], b: Ponto[], grade = 40): number {
  const c = caixaDe(a);
  let dentroDeA = 0;
  let nosDois = 0;
  for (let i = 0; i < grade; i += 1) {
    for (let j = 0; j < grade; j += 1) {
      const x = c.x1 + ((i + 0.5) / grade) * (c.x2 - c.x1);
      const y = c.y1 + ((j + 0.5) / grade) * (c.y2 - c.y1);
      if (!contem(a, x, y)) continue;
      dentroDeA += 1;
      if (contem(b, x, y)) nosDois += 1;
    }
  }
  return dentroDeA === 0 ? 0 : nosDois / dentroDeA;
}
