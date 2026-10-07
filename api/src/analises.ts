// =====================================================================
// Análises — a conta, sem banco
// =====================================================================
// A rota `GET /v1/lojas/:id/analises` busca; este arquivo decide o que
// não depende de consulta: o intervalo de dias pedido e ONDE cada análise
// foi julgada.
//
// ## Onde foi julgado
//
// "Na loja" é o que roda no computador dela: detector, modelo local e
// comparação. "Na nuvem" é o que manda a imagem para um modelo de fora —
// o único lado com custo por análise.
//
// O agente informa os dois números por hora (migration 020). O que ele
// NÃO informou — linha anterior à 020, agente antigo, a hora em que o
// agente foi atualizado — é repartido pelo TIPO do critério: presença,
// contagem e comparação são julgados na loja; estado e ação, na nuvem. É
// o que o serviço fazia até a 020, quando só existiam o detector e o juiz
// de nuvem. A regra mora aqui, num lugar só, para a soma das duas partes
// ser sempre igual ao que foi julgado.
// =====================================================================

/** Os tipos de critério que o serviço julga no computador da loja. */
export const TIPOS_JULGADOS_NA_LOJA: readonly string[] = ['presenca', 'contagem', 'comparacao'];

export type Onde = 'loja' | 'nuvem';

/**
 * Reparte o que foi julgado entre a loja e a nuvem. O que o agente contou
 * vale como veio; o resto vai para o lado do tipo do critério.
 */
export function repartirPorOnde(c: {
  tipo: string;
  julgadas: number;
  julgadasLoja: number;
  julgadasNuvem: number;
}): { naLoja: number; naNuvem: number } {
  const julgadas = Math.max(0, c.julgadas);
  // Nunca mais do que foi julgado: a nuvem recusa na entrada, mas duas
  // linhas de agentes diferentes somadas não podem estourar a conta.
  const loja = Math.min(Math.max(0, c.julgadasLoja), julgadas);
  const nuvem = Math.min(Math.max(0, c.julgadasNuvem), julgadas - loja);
  const resto = julgadas - loja - nuvem;
  return TIPOS_JULGADOS_NA_LOJA.includes(c.tipo)
    ? { naLoja: loja + resto, naNuvem: nuvem }
    : { naLoja: loja, naNuvem: nuvem + resto };
}

/** A via gravada no evento, do jeito que a tela fala. */
export function ondeDaVia(via: string | null | undefined): Onde | null {
  if (!via) return null;
  return via === 'nuvem' ? 'nuvem' : 'loja';
}

/** O maior intervalo que a rota devolve de uma vez. */
export const MAX_DIAS = 31;

const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** `2026-10-07` é um dia que existe? (`2026-02-30` não é.) */
function diaValido(texto: string): boolean {
  if (!DIA.test(texto)) return false;
  const [a, m, d] = texto.split('-').map(Number) as [number, number, number];
  const data = new Date(Date.UTC(a, m - 1, d));
  return data.getUTCFullYear() === a && data.getUTCMonth() === m - 1 && data.getUTCDate() === d;
}

const emDias = (texto: string): number => {
  const [a, m, d] = texto.split('-').map(Number) as [number, number, number];
  return Date.UTC(a, m - 1, d) / 86_400_000;
};

/**
 * O intervalo de dias pedido, no calendário DA LOJA. Sem nada, é hoje. Só
 * uma ponta vale para as duas: `?de=2026-10-05` é aquele dia.
 */
export function lerIntervalo(
  de: unknown,
  ate: unknown,
  hoje: string,
): { de?: string; ate?: string; problema?: string } {
  for (const [nome, v] of [['de', de], ['ate', ate]] as const) {
    if (v == null || v === '') continue;
    if (typeof v !== 'string' || !diaValido(v)) return { problema: `${nome}: dia no formato AAAA-MM-DD` };
  }
  const ini = (de as string | undefined) || (ate as string | undefined) || hoje;
  const fim = (ate as string | undefined) || (de as string | undefined) || hoje;
  if (emDias(ini) > emDias(fim)) return { problema: 'de: não pode ser depois de ate' };
  if (emDias(fim) - emDias(ini) + 1 > MAX_DIAS) {
    return { problema: `o intervalo vai até ${MAX_DIAS} dias` };
  }
  return { de: ini, ate: fim };
}
