// O inventário em palavras: os tipos de equipamento e o lugar em que cada um aparece.

import type { Equipamento, LugarDoEquipamento, TipoDeEquipamento } from '@/lib/api';

// O banco guarda sem acento (`balcao`, `geladeira`); a tela escreve em português.
export const TIPOS_DE_EQUIPAMENTO: ReadonlyArray<{ valor: TipoDeEquipamento; rotulo: string }> = [
  { valor: 'chapa', rotulo: 'chapa' },
  { valor: 'fritadeira', rotulo: 'fritadeira' },
  { valor: 'bancada', rotulo: 'bancada' },
  { valor: 'geladeira', rotulo: 'geladeira ou freezer' },
  { valor: 'balcao', rotulo: 'balcão' },
  { valor: 'caixa', rotulo: 'caixa' },
  { valor: 'prateleira', rotulo: 'prateleira' },
  { valor: 'pia', rotulo: 'pia' },
  { valor: 'outro', rotulo: 'outro' },
];

/** Tipo desconhecido aparece como veio, em vez de sumir. */
export const nomeDoTipoDeEquipamento = (v: string): string => TIPOS_DE_EQUIPAMENTO.find((t) => t.valor === v)?.rotulo ?? v;

/** "04", "13" — como o canal é conhecido no gravador. Câmera IP direta não tem número. */
export const numeroDoCanal = (canal: number | null): string | null => (canal != null ? String(canal).padStart(2, '0') : null);

/** "Chapa (03)" — e a área só quando o canal tem mais de uma. */
export function lugarEmTexto(l: LugarDoEquipamento): string {
  const numero = numeroDoCanal(l.canal);
  return `${l.pontoNome}${numero ? ` (${numero})` : ''}${l.variasAreas ? ` · ${l.zonaNome}` : ''}`;
}

/** "3 fotos de 4" / "1 foto de 4" */
export const contaDeFotos = (e: Pick<Equipamento, 'fotos'>, maximo: number): string =>
  `${e.fotos.length} ${e.fotos.length === 1 ? 'foto' : 'fotos'} de ${maximo}`;

export const MOTIVO_DO_COMPARA_NA_LOJA =
  'O canal em que ele aparece tem foto padrão: critério de comparação nessa área é julgado na loja, sem custo';
