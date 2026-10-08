// =====================================================================
// O desenho da área de análise
// =====================================================================
// A área é um polígono em fração do quadro (0 a 1), ponto a ponto, na ordem
// em que o contorno é percorrido. É o que o agente recorta — e, quando o
// desenho não é um retângulo, o que fica fora dele é apagado antes de
// qualquer análise. Por isso o desenho torto não dá erro visível: dá recorte
// errado, e o juiz responde com confiança sobre o lugar errado. O que não
// faz sentido é recusado aqui, com a frase do motivo.
//
// Tudo aqui é conta, sem banco.
// =====================================================================

export type Ponto = [number, number];

/** Quantos pontos um desenho pode ter. Contorno de bancada não precisa de mais. */
export const MAX_PONTOS = 64;

/**
 * A menor área aceita, em fração do quadro: 0,01% dele — um quadradinho de
 * 1% de lado. Abaixo disso é risco ou ponto, não área.
 */
export const AREA_MINIMA = 0.0001;

/** A área do polígono (fórmula do cadarço), em fração do quadro. */
export function areaDoPoligono(pontos: Ponto[]): number {
  let soma = 0;
  for (let i = 0; i < pontos.length; i += 1) {
    const [x1, y1] = pontos[i]!;
    const [x2, y2] = pontos[(i + 1) % pontos.length]!;
    soma += x1 * y2 - x2 * y1;
  }
  return Math.abs(soma) / 2;
}

/** De que lado de A→B fica C: positivo, negativo, ou zero (em linha). */
const lado = (a: Ponto, b: Ponto, c: Ponto): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

/** Os segmentos AB e CD se atravessam? Encostar na ponta não é atravessar. */
function atravessam(a: Ponto, b: Ponto, c: Ponto, d: Ponto): boolean {
  const d1 = lado(a, b, c);
  const d2 = lado(a, b, d);
  const d3 = lado(c, d, a);
  const d4 = lado(c, d, b);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/**
 * O contorno passa por cima dele mesmo? Um desenho em forma de laço não diz
 * o que é dentro e o que é fora.
 */
export function contornoSeCruza(pontos: Ponto[]): boolean {
  const n = pontos.length;
  // Lados vizinhos se encostam na ponta, por construção — e encostar não é
  // atravessar, então não precisam ser pulados.
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (atravessam(pontos[i]!, pontos[(i + 1) % n]!, pontos[j]!, pontos[(j + 1) % n]!)) return true;
    }
  }
  return false;
}

/** Confere o desenho que veio do console. Devolve a frase do problema, ou `null`. */
export function validarPoligono(valor: unknown): string | null {
  if (!Array.isArray(valor)) return 'o polígono tem que ser uma lista de pontos';
  if (valor.length < 3) return 'o polígono precisa de ao menos 3 pontos';
  if (valor.length > MAX_PONTOS) return `o polígono tem pontos demais (máximo ${MAX_PONTOS})`;

  for (const ponto of valor) {
    if (!Array.isArray(ponto) || ponto.length !== 2) {
      return 'cada ponto é um par [x, y]';
    }
    for (const c of ponto) {
      if (typeof c !== 'number' || !Number.isFinite(c)) {
        return 'as coordenadas têm que ser números';
      }
      // Fração do quadro, não pixel: assim o mesmo desenho vale se a
      // resolução do canal mudar.
      if (c < 0 || c > 1) {
        return 'as coordenadas vão de 0 a 1 (fração do quadro), não em pixels';
      }
    }
  }

  const pontos = valor as Ponto[];
  // O cruzamento vem ANTES do tamanho: num contorno em laço as duas metades
  // se descontam na conta da área, e a mensagem certa é a do laço.
  if (contornoSeCruza(pontos)) {
    return 'o contorno da área passa por cima dele mesmo: arraste os pontos até as linhas não se cruzarem';
  }
  if (areaDoPoligono(pontos) < AREA_MINIMA) {
    return 'a área ficou sem tamanho: os pontos estão em linha, ou em cima uns dos outros';
  }
  return null;
}
