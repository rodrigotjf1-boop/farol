// =====================================================================
// A base de fichas da loja, no formato do Farol
// =====================================================================
// O que a loja vende e do que cada produto é feito. Hoje a fonte é o
// Regem; amanhã pode ser uma planilha ou outro sistema — e por isso a base
// tem o formato DAQUI, e não o de lá. Cada fonte tem o seu adaptador
// (`regem-fichas.ts`), que entrega este documento.
//
// Três decisões do dono moram neste formato:
//
//   • o preparo da casa (uma ficha dentro da outra) entra como UM
//     ingrediente — a ficha do preparo não é desmontada dentro do lanche;
//   • a linha que só entra no pedido para viagem (a embalagem) fica de fora;
//   • não há preço, custo nem margem: a fonte nem manda.
//
// O documento é guardado inteiro, por loja, e trocado inteiro quando muda.
// A `impressao` dele é o que diz "mudou" — para a tela e, depois, para o
// agente, que só baixa a cópia quando ela é outra.
// =====================================================================

import { createHash } from 'node:crypto';

export const FORMATO_DA_BASE = 1;

/** O que acontece na montagem quando o cliente escolhe uma opção. */
export type Efeito =
  /** Só uma observação para a cozinha ("ponto da carne"): não põe nem tira nada. */
  | { tipo: 'observacao' }
  /** Acrescenta um insumo, na quantidade que sai do estoque a cada escolha. */
  | { tipo: 'insumo'; nome: string; quantidade: number | null; unidade: string | null; insumoId: string | null }
  /** Acrescenta um preparo da casa (uma porção por escolha). */
  | { tipo: 'preparo'; fichaId: string; nome: string | null }
  /** Acrescenta outro produto (a bebida do combo). */
  | { tipo: 'produto'; produtoId: string; nome: string | null }
  /** Tira um ingrediente da ficha ("sem cebola"). */
  | { tipo: 'retira'; nome: string; insumoId: string | null; fichaId: string | null }
  /** A fonte não sabe dizer o que a opção muda. */
  | { tipo: 'nada' };

export type Ingrediente = {
  nome: string;
  /** Como a pessoa informou na ficha: "2" + "fatia". */
  quantidade: number | null;
  unidade: string | null;
  /** É um preparo da casa (outra ficha): entra como um ingrediente só. */
  preparo: boolean;
  /** Para casar com o que uma opção retira, e com o dicionário de ingredientes, depois. */
  insumoId: string | null;
  fichaId: string | null;
};

export type Ficha = {
  id: string;
  nome: string;
  /** Na ordem em que foi cadastrada, sem a linha que só vale para viagem. */
  ingredientes: Ingrediente[];
};

export type Opcao = {
  /** O id FIXO da opção na fonte, quando ela tem um (é o que a fila da cozinha manda). */
  id: string | null;
  nome: string;
  codigo: string | null;
  efeito: Efeito;
};

export type GrupoDeAdicionais = {
  nome: string;
  tipo: 'adicionar' | 'remover';
  opcoes: Opcao[];
};

export type Produto = {
  id: string;
  nome: string;
  codigo: string | null;
  categoria: string | null;
  tipo: 'simples' | 'variavel' | 'combo';
  /** Passa pela cozinha. O que não passa (a lata de refrigerante) não tem o que conferir na montagem. */
  cozinha: boolean;
  setor: string | null;
  preparoMin: number | null;
  ficha: Ficha | null;
  /** `fator`: quanto da ficha a variação usa (o "Duplo" usa 2). Sem id: na fonte ele muda a cada salvamento. */
  variacoes: Array<{ nome: string; codigo: string | null; fator: number }>;
  combo: Array<{ produtoId: string; nome: string | null; quantidade: number }>;
  adicionais: GrupoDeAdicionais[];
};

export type Base = {
  formato: typeof FORMATO_DA_BASE;
  produtos: Produto[];
};

/**
 * A impressão do documento. A ordem das chaves é a da montagem (sempre a
 * mesma, pelo adaptador) e a dos produtos é a do documento: dois
 * documentos iguais têm a mesma impressão, em qualquer máquina.
 */
export function impressaoDaBase(base: Base): string {
  return createHash('sha256').update(JSON.stringify(base), 'utf8').digest('hex');
}

export function contarBase(base: Base): { produtos: number; comFicha: number } {
  return { produtos: base.produtos.length, comFicha: base.produtos.filter((p) => p.ficha !== null).length };
}

/** A linha da lista: o que o Farol sabe do produto, sem o detalhe. */
export function resumoDoProduto(p: Produto) {
  return {
    id: p.id,
    nome: p.nome,
    categoria: p.categoria,
    cozinha: p.cozinha,
    /** Quantos ingredientes a ficha tem. Nulo = sem ficha. */
    ingredientes: p.ficha ? p.ficha.ingredientes.length : null,
    /** Quantos produtos o combo junta. Nulo = não é combo. */
    combo: p.tipo === 'combo' ? p.combo.length : null,
    variacoes: p.variacoes.length,
    /** Quantas opções o cliente pode pedir a mais ou tirar, somando os grupos. */
    adicionais: p.adicionais.reduce((n, g) => n + g.opcoes.length, 0),
  };
}

/** Lê do banco um documento guardado. O que não tem a forma desta versão é tratado como ausente. */
export function lerBase(valor: unknown): Base | null {
  const b = valor as Base | null;
  if (!b || typeof b !== 'object' || b.formato !== FORMATO_DA_BASE || !Array.isArray(b.produtos)) return null;
  return b;
}
