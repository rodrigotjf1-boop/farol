// =====================================================================
// O que o "Buscar agora" diz depois da busca
// =====================================================================
// Pelo que a tela de quem clicou mostrava, e não só pela última busca do
// servidor. ERR-136 (19/10/2026): o dono ligou o produto do Número 13 à
// ficha no Regem; o Regem avisou o Farol na hora, e o Farol buscou sozinho.
// O clique veio depois: a busca dele não trouxe nada, e a tela disse "nada
// mudou" com a ficha nova aparecendo logo abaixo. O "nada mudou" do servidor
// quer dizer "desde a última busca"; para quem olha, a tela mudou.
// =====================================================================

import type { ResultadoDaBusca } from '../../lib/api';
import { diaFaladoNaLoja } from '../formatos';

/** "hoje, às 20:26", "ontem, às 04:10" ou "em 16/10, às 18:37", no relógio da loja. */
function quandoFoi(iso: string, fuso: string, agora: Date): string {
  const [dia, hora] = diaFaladoNaLoja(iso, fuso, agora).split(', ');
  return dia === 'hoje' || dia === 'ontem' ? `${dia}, às ${hora}` : `em ${dia}, às ${hora}`;
}

/**
 * O aviso depois da busca. `antes`: a hora da última mudança que a tela mostrava antes do clique (nula = a loja
 * não tinha fichas; ausente = a tela veio de um servidor que ainda não a mandava). Se a do servidor é outra, a
 * mudança chegou sozinha enquanto a tela estava aberta — para quem clicou, as fichas mudaram.
 */
export function avisoDaBusca(r: ResultadoDaBusca, antes: string | null | undefined, fuso: string, agora: Date = new Date()): string {
  if (r.resultado === 'atualizada') return 'Fichas atualizadas agora.';
  if (r.comFicha === 0) return 'Busquei agora: o Regem desta loja continua sem fichas técnicas.';
  if (!r.mudouEm) return 'Busquei agora: nada mudou desde a última busca.';
  if (antes !== undefined && r.mudouEm !== antes) {
    return `Fichas atualizadas: a mudança já tinha chegado ${quandoFoi(r.mudouEm, fuso, agora)}, antes do clique.`;
  }
  return `Busquei agora: nada mudou. A última mudança foi ${quandoFoi(r.mudouEm, fuso, agora)}.`;
}
