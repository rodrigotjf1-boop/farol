// =====================================================================
// A fila "para rever" no console — as frases
// =====================================================================
// O protótipo "Fila para rever", aprovado pelo dono em 06/11/2026. A API diz
// quais conferidos "não era um lanche" estão para rever e por qual
// ingrediente (`api/src/para-rever.ts`); aqui, o que a tela escreve depois de
// salvar a revisão — sempre pelo que a API fez (a resposta da conferência e
// a lista recarregada), nunca pelo que a tela supõe.
// Testado em `api/testes/para-rever.test.ts`.
// =====================================================================

import { numero } from '../formatos';

/**
 * Depois de salvar um lanche da fila: o que aconteceu e quantos faltam. `salvo`: o produto respondido e, com "Não era
 * um lanche", o lanche que a sugestão dizia (a API guardou a decisão); `fila`: a lista recarregada.
 */
export function mensagemDaRevisao(salvo: { produto: string | null; sugestaoVista: string | null }, saiu: string, fila: ReadonlyArray<{ id: string }>): string {
  const faltam = fila.length === 0 ? ' Não há mais lanche para rever.' : ` Faltam ${numero(fila.length)} para rever.`;
  if (fila.some((l) => l.id === saiu)) return `Guardado, mas o lanche continua para rever.${faltam}`;
  if (salvo.produto) return `Revisto: ${salvo.produto}. Saiu da fila e conta no placar entre os que eram lanche.${faltam}`;
  if (salvo.sugestaoVista) return `Fica como “não era um lanche”. Saiu da fila e não volta.${faltam}`;
  // sem a marca: a resposta nova já não tem o ingrediente de um lanche só (quem conferiu tirou a confirmação dele)
  return `Fica como “não era um lanche”. Saiu da fila: a resposta já não tem um ingrediente de um lanche só.${faltam}`;
}

/** "também é adicional em 9 lanches" — o selo da linha, quando todos os ingredientes que decidem são adicional. */
export function seloDoAdicional(adicionalEm: ReadonlyArray<string>): string | null {
  const n = adicionalEm.length;
  return n ? `também é adicional em ${numero(n)} ${n === 1 ? 'lanche' : 'lanches'}` : null;
}
