// =====================================================================
// O que o detector local sabe procurar — visto da nuvem
// =====================================================================
// Critério de presença e de contagem é julgado dentro da loja, por um
// detector de objetos que não lê português. A regra carrega, em
// `parametros`, o que procurar e quantos são aceitáveis.
//
// A API valida esses campos ANTES de gravar, com as mesmas regras do
// agente (`agent/farol_agent/juizes/detector.py`). Sem isso o console
// aceitaria um critério que o agente recusa, e a pessoa só descobriria
// olhando o log do PC da loja — onde ninguém olha.
//
// ## Duas listas iguais em duas linguagens
//
// O vocabulário abaixo existe também no agente. Em 06/10/2026 o agente e a
// API já divergiram uma vez (o formato do evento) com os testes dos dois
// lados passando. Por isso `contratos/objetos-do-detector.json`: o teste
// daqui e o teste de lá leem o MESMO arquivo — a lista e os exemplos de
// aceito e de recusado. Mudar um lado quebra o teste do outro.
// =====================================================================

/** O vocabulário do Farol, em português. O agente traduz para o modelo. */
export const OBJETOS_DO_DETECTOR = [
  'bolsa', 'cadeira', 'celular', 'colher', 'copo', 'faca', 'forno', 'garfo',
  'garrafa', 'geladeira', 'mesa', 'micro-ondas', 'mochila', 'notebook',
  'pessoa', 'pia', 'tigela',
] as const;

/** Os tipos de critério que o detector julga, e que exigem os campos. */
export const TIPOS_DO_DETECTOR = ['presenca', 'contagem'];

export type ParametrosDoDetector = {
  objeto: string;
  minimo: number;
  maximo: number | null;
};

function inteiroNaoNegativo(v: unknown): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

/**
 * Confere e normaliza os campos. Devolve `{ ok }` com o objeto pronto para
 * gravar, ou `{ problema }` com a frase para quem está cadastrando.
 */
export function lerParametrosDoDetector(
  bruto: unknown,
): { ok: ParametrosDoDetector } | { problema: string } {
  if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) {
    return { problema: 'diga o que procurar: escolha o objeto' };
  }
  const p = bruto as Record<string, unknown>;

  const objeto = String(p.objeto ?? '').trim().toLowerCase();
  if (!objeto) return { problema: 'diga o que procurar: escolha o objeto' };
  if (!(OBJETOS_DO_DETECTOR as readonly string[]).includes(objeto)) {
    return {
      problema:
        `o detector local não conhece "${objeto}". Conhece: ` +
        `${OBJETOS_DO_DETECTOR.join(', ')}`,
    };
  }

  const temMinimo = p.minimo !== undefined && p.minimo !== null;
  const temMaximo = p.maximo !== undefined && p.maximo !== null;
  if (temMinimo && !inteiroNaoNegativo(p.minimo)) {
    return { problema: '"pelo menos" tem que ser um número inteiro, zero ou mais' };
  }
  if (temMaximo && !inteiroNaoNegativo(p.maximo)) {
    return { problema: '"no máximo" tem que ser um número inteiro, zero ou mais' };
  }
  const minimo = temMinimo ? (p.minimo as number) : 0;
  const maximo = temMaximo ? (p.maximo as number) : null;

  if (maximo !== null && maximo < minimo) {
    return { problema: `o máximo (${maximo}) é menor que o mínimo (${minimo})` };
  }
  if (minimo === 0 && maximo === null) {
    // "Zero ou mais" é verdade em qualquer imagem: o critério nunca
    // reprovaria nada, e pareceria estar auditando.
    return {
      problema: 'o critério não exige nada: diga pelo menos quantos, ou no máximo quantos',
    };
  }
  return { ok: { objeto, minimo, maximo } };
}
