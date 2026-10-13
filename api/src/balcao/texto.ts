// =====================================================================
// O balcão — o texto, contado e aparado do jeito do agente
// =====================================================================
// O pedido que o servidor monta tem de sair igual, letra por letra, ao que
// o agente monta. O agente é Python, e o Python não concorda com o
// JavaScript em duas coisas que este texto usa o tempo todo:
//
//   • o que é ESPAÇO EM BRANCO. `str.split()` e `strip()` contam U+0085 e
//     U+001C a U+001F, e não contam U+FEFF; o `\s` e o `trim()` daqui fazem
//     o contrário nos dois;
//   • o TAMANHO de um texto. O Python conta letras (pontos de código); o
//     `length` daqui conta unidades de 16 bits, e uma letra fora do plano
//     básico (um emoji) vale duas — o corte cairia em outro lugar, ou no
//     meio dela.
//
// Por isso nada do pedido usa `\s`, `trim()`, `length` ou `slice()` direto
// num texto: usa o que está aqui. A lista dos brancos é a que o Python
// calcula — `contratos/pedido-com-contexto.json` a guarda, e os testes dos
// dois lados conferem contra o mesmo arquivo.
// =====================================================================

/** Os espaços em branco do Python (`str.isspace()`), como pontos de código. */
export const BRANCOS: readonly number[] = [
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
  0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
];

const CLASSE = `[${BRANCOS.map((c) => `\\u{${c.toString(16)}}`).join('')}]`;
const UM_OU_MAIS = new RegExp(`${CLASSE}+`, 'u');
const NO_COMECO = new RegExp(`^${CLASSE}+`, 'u');
const NO_FIM = new RegExp(`${CLASSE}+$`, 'u');

/** O que chega como texto. Nulo e ausente valem vazio; qualquer outra coisa não é texto, e também vale vazio. */
export const texto = (bruto: unknown): string => (typeof bruto === 'string' ? bruto : '');

/** `" ".join(texto.split())` — numa linha só, com um espaço entre as palavras. */
export const numaLinha = (bruto: unknown): string => texto(bruto).split(UM_OU_MAIS).filter(Boolean).join(' ');

/** `texto.strip()` */
export const aparar = (bruto: unknown): string => texto(bruto).replace(NO_COMECO, '').replace(NO_FIM, '');

/** `texto.rstrip()` */
export const apararOFim = (bruto: string): string => bruto.replace(NO_FIM, '');

/**
 * O texto com teto de tamanho, em LETRAS. Passou: corta uma antes do teto,
 * tira o espaço que sobrar no fim e diz que cortou ("…").
 */
export function comTeto(bruto: string, teto: number): string {
  const letras = Array.from(bruto);
  return letras.length > teto ? `${apararOFim(letras.slice(0, teto - 1).join(''))}…` : bruto;
}

/** O texto numa linha só, com teto. O corte, quando há, é dito ("…"). */
export const umaLinha = (bruto: unknown, teto: number): string => comTeto(numaLinha(bruto), teto);
