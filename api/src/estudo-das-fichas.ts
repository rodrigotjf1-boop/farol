// =====================================================================
// O estudo das fichas: o que cada ingrediente diz sobre qual lanche é
// =====================================================================
// A21, ideia do dono (15/10/2026): "todos os cardápios vão ter os
// ingredientes raros, que vão em 1 ou poucos itens (2 no máximo), os
// intermediários e os que são muito usados" — e o raro visto já diz o
// lanche ("o cheddar cremoso só vai no Número 16"; "o anel de cebola, só no
// 08"). Medido nas fichas da loja-piloto no mesmo dia: 21 dos 31
// ingredientes eram raros, e 15 dos 20 lanches tinham um.
//
// Tudo sai das fichas da loja — nada é escrito para uma loja:
//
//   • FAMÍLIA: os produtos de cozinha com a mesma ficha VISTA DE CIMA (os
//     mesmos ingredientes, nas mesmas quantidades de contar; o que "não se
//     vê de cima" não conta) são um lanche só para a bancada — o "Número 16"
//     e o "Trio 16". O palpite que diz um e a conferência que escolhe o
//     outro não erraram.
//   • PESO: quanto menos famílias usam o ingrediente, mais ele diz:
//     log((famílias + 1) / famílias que o usam). O raro quase decide; o pão
//     e o queijo de quase todos quase não contam. As FAIXAS (raro: 1 ou 2
//     famílias; comum: 40% delas ou mais; intermediário: o resto) servem
//     para explicar, não para contar.
//   • NOTA de cada família, somando as evidências da leitura (`notaDaFamilia`).
// =====================================================================

import type { Base } from './fichas.js';
import { chaveDoIngrediente } from './ingredientes.js';

/** A unidade que se conta de cima: a fatia, a unidade. O resto (kg, ml) é só presença. */
const CONTAVEL = /^(fatias?|unidades?|un|und)$/;

/** Quantas vezes o ingrediente entra: o número, quando a unidade se conta de cima (fatia, unidade); o resto é presença. */
export function vezesNaFicha(quantidade: number | null, unidade: string | null): number {
  const u = (unidade ?? '').trim().toLowerCase();
  if (quantidade !== null && Number.isInteger(quantidade) && quantidade >= 1 && CONTAVEL.test(u)) return quantidade;
  return 1;
}

export type IngredienteDaFamilia = { nome: string; vezes: number; contavel: boolean };

export type Familia = {
  chave: string;
  produtos: Array<{ id: string; nome: string }>;
  /** Por chave: só o que se vê de cima. */
  ingredientes: Map<string, IngredienteDaFamilia>;
  /** O que algum produto da família acrescenta como adicional (o cliente pode ter pedido): chave → nome. */
  adicionais: Map<string, string>;
  /** O que algum produto da família deixa o cliente mandar tirar ("Sem cebola"): chave → nome. */
  retira: Map<string, string>;
};

export type Estudo = {
  familias: Familia[];
  /** Em quantas famílias cada ingrediente (chave) está na ficha. */
  usos: Map<string, number>;
  /** A família de cada produto, pela chave do nome (o palpite e a conferência guardam o nome). */
  familiaDoProduto: Map<string, Familia>;
};

export type Faixa = 'raro' | 'intermediario' | 'comum';

/** Até quantas famílias o ingrediente é raro (o dono: "1 ou poucos itens, 2 no máximo"). */
export const RARO_ATE = 2;
/** A partir de que parte das famílias o ingrediente é comum. */
export const COMUM_DESDE = 0.4;

/** As famílias da loja e em quantas delas cada ingrediente entra. `invisiveis`: as chaves do que "não se vê de cima". */
export function estudarFichas(base: Base | null, invisiveis: Set<string> = new Set()): Estudo {
  const porChave = new Map<string, Familia>();
  const familiaDoProduto = new Map<string, Familia>();
  for (const p of base?.produtos ?? []) {
    if (!p.ficha || !p.cozinha) continue;
    const ingredientes = new Map<string, IngredienteDaFamilia>();
    for (const i of p.ficha.ingredientes) {
      const k = chaveDoIngrediente(i.nome);
      if (!k || invisiveis.has(k)) continue;
      const contavel = CONTAVEL.test((i.unidade ?? '').trim().toLowerCase());
      const ja = ingredientes.get(k);
      // o mesmo ingrediente em duas linhas da ficha: as vezes somam
      ingredientes.set(k, { nome: ja?.nome ?? i.nome, vezes: (ja?.vezes ?? 0) + vezesNaFicha(i.quantidade, i.unidade), contavel: (ja?.contavel ?? false) || contavel });
    }
    if (ingredientes.size === 0) continue;
    const chave = [...ingredientes.entries()]
      .map(([k, i]) => `${k}×${i.contavel ? i.vezes : 1}`)
      .sort()
      .join('|');
    let f = porChave.get(chave);
    if (!f) {
      f = { chave, produtos: [], ingredientes, adicionais: new Map(), retira: new Map() };
      porChave.set(chave, f);
    }
    f.produtos.push({ id: p.id, nome: p.nome });
    for (const g of p.adicionais ?? []) {
      for (const o of g.opcoes ?? []) {
        const ef = o.efeito;
        if (g.tipo === 'adicionar' && (ef?.tipo === 'insumo' || ef?.tipo === 'preparo') && ef.nome) {
          if (!f.adicionais.has(chaveDoIngrediente(ef.nome))) f.adicionais.set(chaveDoIngrediente(ef.nome), ef.nome);
        }
        // o "Sem cebola": a opção que tira um ingrediente da ficha, em qualquer grupo
        if (ef?.tipo === 'retira' && ef.nome && !f.retira.has(chaveDoIngrediente(ef.nome))) f.retira.set(chaveDoIngrediente(ef.nome), ef.nome);
      }
    }
    familiaDoProduto.set(chaveDoIngrediente(p.nome), f);
  }
  const familias = [...porChave.values()];
  const usos = new Map<string, number>();
  for (const f of familias) for (const k of f.ingredientes.keys()) usos.set(k, (usos.get(k) ?? 0) + 1);
  return { familias, usos, familiaDoProduto };
}

/** Quanto o ingrediente diz: log((famílias + 1) / famílias que o usam). O que nenhuma ficha usa pesa como o mais raro. */
export function pesoDoIngrediente(e: Estudo, chave: string): number {
  return Math.log((e.familias.length + 1) / Math.max(1, e.usos.get(chave) ?? 0));
}

export function faixaDoIngrediente(e: Estudo, chave: string): Faixa {
  const n = e.usos.get(chave) ?? 0;
  if (n <= RARO_ATE) return 'raro';
  if (n >= Math.max(RARO_ATE + 1, Math.ceil(COMUM_DESDE * e.familias.length))) return 'comum';
  return 'intermediario';
}

/** Os dois produtos são o mesmo lanche para a bancada (a mesma ficha vista de cima)? Sem ficha: só pelo nome. */
export function mesmaFamilia(e: Estudo, produtoA: string, produtoB: string): boolean {
  const a = chaveDoIngrediente(produtoA);
  const b = chaveDoIngrediente(produtoB);
  if (a === b) return true;
  const fa = e.familiaDoProduto.get(a);
  return fa !== undefined && fa === e.familiaDoProduto.get(b);
}

/** O que a leitura viu de cada ingrediente: a maior parte que uma etapa deu a ele, quantas vezes entrou e, quando ele
 * só veio em grupo, o que a leitura disse ("molho laranja"). */
export type Visto = Map<string, { parte: number; vezes: number; de: string | null }>;

/**
 * A leitura do lanche, por ingrediente. `parte`: 1 quando uma etapa disse só ele; 1/m quando ele estava num grupo de m
 * nomes possíveis ("pode ser A ou B"). `vezes`: quantas vezes entrou, somado só nas etapas que disseram um nome. `de`:
 * o que a primeira etapa de grupo leu (o porquê do palpite diz "o que leu como 'molho laranja' pode ser…").
 */
export function oQueFoiVisto(etapas: Array<{ candidatos: string[]; vezes: number; leu?: string | null }>): Visto {
  const visto: Visto = new Map();
  for (const e of etapas) {
    const ks = [...new Set(e.candidatos.map(chaveDoIngrediente))];
    if (ks.length === 0) continue;
    for (const k of ks) {
      const v = visto.get(k) ?? { parte: 0, vezes: 0, de: null };
      v.parte = Math.max(v.parte, 1 / ks.length);
      if (ks.length === 1) v.vezes += e.vezes;
      else if (v.de === null) v.de = e.leu ?? null;
      visto.set(k, v);
    }
  }
  return visto;
}

/** O que não foi visto tira esta parte do peso: o cliente pode ter mandado tirar, ou ficou por baixo. */
export const FALTOU = 1 / 3;
/** A quantidade de contar (2 carnes, 2 fatias) que bate soma esta parte do peso; a que não bate tira. */
export const QUANTIDADE = 1 / 4;
/** O que a leitura viu sem achar nome nas fichas tira isto de todas as famílias (não muda a ordem). */
export const ESTRANHO = 0.5;

/**
 * A nota da família para a leitura, somando as evidências:
 *   + o ingrediente da ficha que a leitura viu soma o peso dele (dividido, se veio num grupo);
 *   − o que a leitura viu e a ficha não tem tira o peso do que foi visto (a média, se veio num grupo) — o adicional do
 *     produto não tira nada (o cliente pode ter pedido);
 *   − o da ficha que não foi visto tira um terço do peso;
 *   ± a quantidade de contar que bate soma um quarto do peso; a que não bate tira um quarto;
 *   − cada leitura sem nome nas fichas tira um pouco.
 */
export function notaDaFamilia(
  e: Estudo,
  f: Familia,
  etapas: Array<{ candidatos: string[]; vezes: number; leu: string | null }>,
  visto: Visto = oQueFoiVisto(etapas),
): number {
  let nota = 0;
  for (const [k, ing] of f.ingredientes) {
    const w = pesoDoIngrediente(e, k);
    const v = visto.get(k);
    if (!v) {
      nota -= FALTOU * w;
      continue;
    }
    nota += v.parte * w;
    if (ing.contavel && v.vezes > 0) nota += (v.vezes === ing.vezes ? QUANTIDADE : -QUANTIDADE) * w;
  }
  for (const etapa of etapas) {
    if (etapa.candidatos.length === 0) {
      if (etapa.leu !== null) nota -= ESTRANHO;
      continue;
    }
    const ks = [...new Set(etapa.candidatos.map(chaveDoIngrediente))];
    if (ks.some((k) => f.ingredientes.has(k))) continue;
    if (ks.some((k) => f.adicionais.has(k))) continue;
    nota -= ks.reduce((s, k) => s + pesoDoIngrediente(e, k), 0) / ks.length;
  }
  return nota;
}
