// =====================================================================
// Os ingredientes da loja, tirados das fichas
// =====================================================================
// A21, fatia T1 (migration 047). A ficha não tem número de ingrediente —
// só o Regem manda o `insumoId`; a planilha e outro sistema, não —, e é
// trocada inteira a cada importação: o ingrediente é o NOME, sem olhar
// maiúscula nem espaço nas pontas (a mesma chave do índice único da 047).
//
// Entram os ingredientes das fichas e o que um adicional ACRESCENTA (um
// insumo, ou um preparo da casa): é o que a bancada pode mostrar. Não
// entram o produto que um adicional põe junto (a bebida), a observação
// para a cozinha, nem o que um adicional tira — esse já é ingrediente da
// ficha.
// =====================================================================

import type { Base } from './fichas.js';

/** Decisão do dono (15/10/2026): até 6 fotos por ingrediente. */
export const MAX_FOTOS_POR_INGREDIENTE = 6;
export const MAX_LEGENDA = 120;

/** A chave do ingrediente: o nome sem maiúscula e sem espaço nas pontas. */
export const chaveDoIngrediente = (nome: string): string => nome.trim().toLowerCase();

/** Onde o ingrediente entra: o produto, e se é pela ficha ou por um adicional. */
export type OndeEntra = { produtoId: string; produto: string; adicional: boolean };
export type IngredienteDaLoja = { nome: string; produtos: OndeEntra[] };

/**
 * Os ingredientes da base, na ordem em que aparecem (a das fichas). O nome
 * que fica é o da primeira vez em que ele aparece.
 */
export function ingredientesDaBase(base: Base | null): IngredienteDaLoja[] {
  if (!base) return [];
  const porChave = new Map<string, IngredienteDaLoja>();
  const anotar = (nome: string | null | undefined, produtoId: string, produto: string, adicional: boolean) => {
    const limpo = (nome ?? '').trim();
    if (!limpo) return;
    const chave = chaveDoIngrediente(limpo);
    let ingrediente = porChave.get(chave);
    if (!ingrediente) {
      ingrediente = { nome: limpo, produtos: [] };
      porChave.set(chave, ingrediente);
    }
    // Na ficha E como adicional do mesmo produto, vale a ficha: ela é lida antes dos adicionais (abaixo).
    if (!ingrediente.produtos.some((o) => o.produtoId === produtoId)) ingrediente.produtos.push({ produtoId, produto, adicional });
  };
  for (const p of base.produtos) {
    for (const i of p.ficha?.ingredientes ?? []) anotar(i.nome, p.id, p.nome, false);
    for (const grupo of p.adicionais ?? []) {
      if (grupo.tipo !== 'adicionar') continue;
      for (const opcao of grupo.opcoes ?? []) {
        const efeito = opcao.efeito;
        if (efeito?.tipo === 'insumo' || efeito?.tipo === 'preparo') anotar(efeito.nome, p.id, p.nome, true);
      }
    }
  }
  return [...porChave.values()];
}
