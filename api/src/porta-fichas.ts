// =====================================================================
// A porta para outro sistema — o envio das fichas
// =====================================================================
// Pedido do dono em 11/10/2026: a operação que não usa o Regem manda as
// fichas dela por uma porta documentada. Este é o TERCEIRO adaptador da
// base de fichas (os outros: `regem-fichas.ts` e `planilha-fichas.ts`).
//
// O que o sistema envia é a lista de produtos, cada um com os ingredientes
// na ordem da montagem, as variações, os adicionais e, se for combo, o que
// vem nele. É O MESMO MODELO DA PLANILHA, com outra forma: aqui o produto é
// um objeto, e lá é um bloco de linhas.
//
// E é por isso que as REGRAS não estão aqui. Este módulo confere a FORMA do
// envio (o que é lista, o que é texto, o que é número) e o desmonta nas
// mesmas linhas que a planilha tem; quem diz o que entra e o que fica de
// fora é o leitor da planilha (`lerPlanilha`). Uma regra, dois caminhos: a
// unidade que vale na planilha é a que vale aqui, e o "tira" só tira o que
// está na ficha nos dois.
//
// Duas respostas diferentes, de propósito:
//
//   • a FORMA errada (não é uma lista, falta o nome, veio um objeto onde ia
//     um número) recusa o envio inteiro, com o caminho do campo: é erro de
//     quem programou o envio, e meia leitura esconderia o defeito;
//   • o CONTEÚDO errado (a unidade que não existe, o ingrediente sem
//     quantidade) deixa aquele produto de fora, e os outros entram — a mesma
//     regra da planilha (decisão do dono: "entra o que está certo e a tela
//     lista o que ficou de fora"). A resposta diz quais ficaram de fora e
//     por quê, com o caminho de cada problema.
//
// Sem preço, custo nem cliente: o campo que não é do modelo é ignorado, e
// não é guardado.
// =====================================================================

import { chaveDoProduto, COLUNAS, lerPlanilha, MAX_LINHAS, NOME_DA_ABA, type Contas, type Leitura, type Problema } from './planilha-fichas.js';
import type { Base } from './fichas.js';

/** Quantos produtos um envio pode ter. É o teto da planilha, dito antes, com as palavras daqui. */
export const MAX_PRODUTOS_DO_ENVIO = 5000;

/** Onde está o problema, no que foi enviado: `produtos[3].ingredientes[1]`. */
export type ProblemaDoEnvio = { onde: string; texto: string };

export type Envio = {
  /** A forma do envio não serve: nada entra, e este é o motivo (com o caminho do campo). Nulo = serve. */
  impede: string | null;
  /** A base só com os produtos que estão certos. */
  base: Base;
  contas: Contas;
  semFicha: string[];
  /** Os produtos que ficaram de fora, na ordem do envio, com o motivo de cada um. */
  deFora: Array<{ produto: string; problemas: ProblemaDoEnvio[] }>;
  /** Problemas que não são de um produto só. */
  soltos: ProblemaDoEnvio[];
  /** Quantos problemas o envio tem ao todo (a lista pode vir cortada). */
  problemas: number;
};

type QualAba = keyof typeof COLUNAS;
type Celula = string | number | boolean;

/** A forma do envio não serve. A mensagem diz o caminho do campo. */
class FormaErrada extends Error {}

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const falta = (v: unknown): boolean => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

function objeto(v: unknown, onde: string): Record<string, unknown> {
  if (!ehObjeto(v)) throw new FormaErrada(`${onde}: era para ser um objeto, com os campos entre chaves`);
  return v;
}
/** Uma lista. A que não veio é uma lista vazia. */
function lista(v: unknown, onde: string): unknown[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new FormaErrada(`${onde}: era para ser uma lista`);
  return v;
}
/** Um texto (número também serve: o código do produto costuma ser um). Em branco quando não veio. */
function texto(v: unknown, onde: string, obrigatorio = false): Celula {
  if (falta(v)) {
    if (obrigatorio) throw new FormaErrada(`${onde}: falta preencher`);
    return '';
  }
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  throw new FormaErrada(`${onde}: era para ser um texto`);
}
/** Uma quantidade: o número, ou o texto dele ("0,5"). Quem diz se o valor serve é a regra, não a forma. */
function quantidade(v: unknown, onde: string): Celula {
  if (falta(v)) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  throw new FormaErrada(`${onde}: era para ser um número`);
}
/** Verdadeiro ou falso — e só. "sim" em texto é a planilha; aqui o campo é de marcar. */
function simOuNao(v: unknown, onde: string): Celula {
  if (v === undefined || v === null) return '';
  if (typeof v === 'boolean') return v;
  throw new FormaErrada(`${onde}: era para ser verdadeiro ou falso (true ou false)`);
}

const SEM_NADA: Omit<Envio, 'impede'> = {
  base: { formato: 1, produtos: [] },
  contas: { produtos: 0, comFicha: 0, ingredientes: 0, variacoes: 0, adicionais: 0, combos: 0 },
  semFicha: [],
  deFora: [],
  soltos: [],
  problemas: 0,
};
const impedido = (motivo: string): Envio => ({ ...SEM_NADA, impede: motivo });

/**
 * As frases do leitor da planilha que falam em aba, linha e coluna, ditas
 * com as palavras do envio. O resto das frases serve aos dois sem mudar.
 * (Há teste de que nenhuma resposta da porta fala em planilha.)
 */
const COM_AS_PALAVRAS_DAQUI: Array<[RegExp, string]> = [
  [/^o produto aparece em dois blocos de linhas, separados por outro produto\.$/, 'há outro produto com o mesmo nome no envio.'],
  [/^o produto tem mais de (\d+) linhas\.$/, 'o produto tem mais de $1 ingredientes.'],
  [/, que vem no combo, não está na aba Fichas\.$/, ', que vem no combo, não está no envio.'],
  [/^“Quanto da ficha” está como /, '“fator” está como '],
  [/^“O que faz” está como /, '“faz” está como '],
];
/** A frase que fala do produto inteiro, e não de um ingrediente dele. */
const DO_PRODUTO = /^o produto tem mais de \d+ ingredientes\.$/;
function comAsPalavrasDaqui(frase: string): string {
  for (const [de, para] of COM_AS_PALAVRAS_DAQUI) if (de.test(frase)) return frase.replace(de, para);
  return frase;
}

/** Lê o que o sistema enviou. Nunca rejeita: o que não serve vira `impede` ou produto de fora. */
export function lerEnvio(corpo: unknown): Envio {
  // As mesmas linhas que a planilha teria, e de onde cada uma saiu.
  const abas: Record<QualAba, Celula[][]> = {
    fichas: [[...COLUNAS.fichas]],
    variacoes: [[...COLUNAS.variacoes]],
    adicionais: [[...COLUNAS.adicionais]],
    combos: [[...COLUNAS.combos]],
  };
  const caminhos: Record<QualAba, string[]> = { fichas: [''], variacoes: [''], adicionais: [''], combos: [''] };
  const por = (qual: QualAba, linha: Celula[], caminho: string): void => {
    abas[qual].push(linha);
    caminhos[qual].push(caminho);
  };
  // Cada produto do envio é um objeto: dois seguidos com o mesmo nome são DOIS produtos, e não um com as linhas
  // somadas. O leitor fica sabendo em que linha cada um começa.
  const comecos = new Set<number>();
  const vistos = new Set<string>();

  try {
    if (!ehObjeto(corpo)) throw new FormaErrada('o envio era para ser um objeto com a lista “produtos”');
    if (corpo.produtos === undefined || corpo.produtos === null) throw new FormaErrada('produtos: falta a lista de produtos');
    const produtos = lista(corpo.produtos, 'produtos');
    if (produtos.length === 0) throw new FormaErrada('produtos: a lista está vazia');
    if (produtos.length > MAX_PRODUTOS_DO_ENVIO) {
      throw new FormaErrada(`produtos: a lista tem mais de ${MAX_PRODUTOS_DO_ENVIO.toLocaleString('pt-BR')} produtos. Um envio é de uma loja só`);
    }

    produtos.forEach((bruto, i) => {
      const onde = `produtos[${i}]`;
      const p = objeto(bruto, onde);
      const nome = texto(p.nome, `${onde}.nome`, true);
      const comeco: Celula[] = [nome, texto(p.codigo, `${onde}.codigo`), texto(p.categoria, `${onde}.categoria`), simOuNao(p.cozinha, `${onde}.cozinha`)];

      // a linha 1 é a dos títulos: a próxima linha da aba é a de número (linhas já postas + 1)
      comecos.add(abas.fichas.length + 1);
      // O nome repetido: os dois ficam de fora (quem diz é o leitor). Do segundo vai só o nome — o que ele traz
      // não se soma ao primeiro, e não há o que conferir num produto que não entra.
      const k = chaveDoProduto(nome);
      if (vistos.has(k)) return por('fichas', [nome, '', '', '', '', '', ''], onde);
      vistos.add(k);
      const ingredientes = lista(p.ingredientes, `${onde}.ingredientes`);
      // sem ingrediente: o produto existe, e não tem ficha
      if (ingredientes.length === 0) por('fichas', [...comeco, '', '', ''], onde);
      ingredientes.forEach((b, j) => {
        const aqui = `${onde}.ingredientes[${j}]`;
        const g = objeto(b, aqui);
        por('fichas', [...comeco, texto(g.nome, `${aqui}.nome`, true), quantidade(g.quantidade, `${aqui}.quantidade`), texto(g.unidade, `${aqui}.unidade`)], aqui);
      });

      lista(p.variacoes, `${onde}.variacoes`).forEach((b, j) => {
        const aqui = `${onde}.variacoes[${j}]`;
        const v = objeto(b, aqui);
        por('variacoes', [nome, texto(v.nome, `${aqui}.nome`, true), quantidade(v.fator, `${aqui}.fator`)], aqui);
      });

      lista(p.adicionais, `${onde}.adicionais`).forEach((b, j) => {
        const aqui = `${onde}.adicionais[${j}]`;
        const a = objeto(b, aqui);
        por(
          'adicionais',
          [nome, texto(a.nome, `${aqui}.nome`, true), texto(a.faz, `${aqui}.faz`), texto(a.ingrediente, `${aqui}.ingrediente`), quantidade(a.quantidade, `${aqui}.quantidade`), texto(a.unidade, `${aqui}.unidade`)],
          aqui,
        );
      });

      lista(p.combo, `${onde}.combo`).forEach((b, j) => {
        const aqui = `${onde}.combo[${j}]`;
        const c = objeto(b, aqui);
        por('combos', [nome, texto(c.produto, `${aqui}.produto`, true), quantidade(c.quantidade, `${aqui}.quantidade`)], aqui);
      });
    });

    for (const qual of Object.keys(abas) as QualAba[]) {
      if (abas[qual].length - 1 > MAX_LINHAS) throw new FormaErrada(`produtos: o envio é grande demais (mais de ${MAX_LINHAS.toLocaleString('pt-BR')} itens numa lista). Um envio é de uma loja só`);
    }
  } catch (e) {
    if (e instanceof FormaErrada) return impedido(e.message);
    throw e;
  }

  const lida: Leitura = lerPlanilha(abas, comecos);
  // O que impede a planilha é a forma dela — e a forma, aqui, já foi conferida. Se ainda assim impedir, não se inventa motivo.
  if (lida.impede !== null) return impedido('não deu para ler o envio. Confira o formato na documentação');

  const qualDe = new Map<string, QualAba>((Object.keys(NOME_DA_ABA) as QualAba[]).map((q) => [NOME_DA_ABA[q], q]));
  const daqui = (p: Problema): ProblemaDoEnvio => {
    const qual = qualDe.get(p.aba);
    // a linha 1 é a dos títulos: o item 0 da lista é a linha 2
    const onde = (qual && caminhos[qual][p.linha - 1]) || 'produtos';
    const texto = comAsPalavrasDaqui(p.texto);
    // o que é do PRODUTO (ingredientes demais) aponta para ele, e não para o primeiro ingrediente
    return { onde: DO_PRODUTO.test(texto) ? onde.replace(/\.ingredientes\[\d+\]$/, '') : onde, texto };
  };

  return {
    impede: null,
    base: lida.base,
    contas: lida.contas,
    semFicha: lida.semFicha,
    deFora: lida.deFora.map((d) => ({ produto: d.produto, problemas: d.problemas.map(daqui) })),
    soltos: lida.soltos.map(daqui),
    problemas: lida.problemas,
  };
}
