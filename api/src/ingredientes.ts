// =====================================================================
// Os ingredientes da loja, tirados das fichas
// =====================================================================
// A21, fatia T1 (migration 047). A ficha não tem número de ingrediente —
// só o Regem manda o `insumoId`; a planilha e outro sistema, não —, e é
// trocada inteira a cada importação: o ingrediente é o NOME.
//
// O MESMO ingrediente escrito de outro jeito é um só (o dono, 19/10/2026:
// "o sistema tem que entender que 'Pão de Brioche' e 'Pão Brioche' são a
// mesma coisa"): a chave não olha maiúscula, acento, as palavras que só
// ligam ("de", "com"…), o plural, nem o espaço entre o número e o peso
// ("56gr" = "56 g"). O índice único da 047 continua o de antes (maiúscula
// e espaço nas pontas): dois registros que viram a mesma chave aqui são
// SOMADOS por quem os lê, nunca um esconde o outro.
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

/** As palavras que só ligam as partes do nome: "Pão DE Brioche", "Brioche COM gergelim", "c/ cheddar". */
const LIGACAO = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'com', 'c', 'a', 'o', 'as', 'os']);
/** O plural que não é só tirar o "s" (depois de tirar o acento). */
const PLURAL_IRREGULAR: Record<string, string> = { paes: 'pao', aneis: 'anel', graos: 'grao', limoes: 'limao', mamoes: 'mamao' };

/**
 * A chave do ingrediente: o mesmo ingrediente escrito de jeitos diferentes tem a mesma chave. Sem maiúscula e sem
 * acento; sem as palavras que só ligam (de, da, do, com…); no singular; o peso junto do número ("56 gr", "56gr",
 * "56 gramas" → "56g"); o resto dos sinais vira espaço. "Pão de Brioche" = "Pão Brioche" = "pao brioche"; "Pão
 * Brioche com gergelim mesclado" continua outro ingrediente (o gergelim muda o pão).
 */
export function chaveDoIngrediente(nome: string): string {
  const simples = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const comPeso = simples.replace(/(\d+(?:[.,]\d+)?)\s*(gramas?|grs?|g)(?![a-z])/g, (_, n: string) => `${n.replace(',', '.')}g`);
  const palavras = comPeso
    .split(/[^a-z0-9.]+/)
    .map((p) => p.replace(/^\.+|\.+$/g, ''))
    .filter((p) => p && !LIGACAO.has(p))
    .map((p) => PLURAL_IRREGULAR[p] ?? (p.length > 3 && p.endsWith('s') && !/\d/.test(p) ? p.slice(0, -1) : p));
  // um nome feito só de palavras de ligação ("Do") não some: fica como estava, sem maiúscula e sem espaço nas pontas
  return palavras.length ? palavras.join(' ') : nome.trim().toLowerCase();
}

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
