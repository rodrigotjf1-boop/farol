// =====================================================================
// Da planilha para a base de fichas do Farol
// =====================================================================
// O segundo adaptador (o primeiro é `regem-fichas.ts`): recebe as LINHAS
// de uma planilha no modelo do Farol e devolve o documento no formato
// daqui (`fichas.ts`). É o que serve a loja que não usa o Regem — pedido do
// dono em 11/10/2026.
//
// Quem abre o arquivo (.xlsx ou .csv) é o navegador de quem importa; para
// cá vêm só as células, aba por aba. TODA regra mora aqui: os títulos das
// colunas, o que é obrigatório, a lista de unidades, o que é problema.
//
// O MODELO. A aba "Fichas" é a única obrigatória: uma linha por
// ingrediente, na ordem da montagem, com o nome do produto repetido nas
// linhas dele. Produto com uma linha só e sem ingrediente entra sem ficha.
// As abas "Variações", "Adicionais" e "Combos" são para quem usa.
//
// O QUE ENTRA. Decisão do dono (11/10/2026): "entra o que está certo e a
// tela lista o que ficou de fora". O grão é o PRODUTO: um produto com
// qualquer linha errada fica INTEIRO de fora, com o motivo de cada linha —
// meia ficha é pior que ficha nenhuma, porque o Farol conferiria a montagem
// contra ela. O combo que leva um produto que ficou de fora fica de fora
// junto.
//
// O que impede TUDO é só o que não deixa ler a planilha: sem a aba Fichas,
// sem uma coluna obrigatória, grande demais.
//
// Sem preço e sem custo: o modelo não pede, e coluna que não é do modelo é
// ignorada.
// =====================================================================

import { createHash } from 'node:crypto';

import { FORMATO_DA_BASE, type Base, type Efeito, type GrupoDeAdicionais, type Ingrediente, type Opcao, type Produto } from './fichas.js';

export type QualAba = 'fichas' | 'variacoes' | 'adicionais' | 'combos';
/** O nome de cada aba, como está na planilha e como a tela o diz. */
export const NOME_DA_ABA: Record<QualAba, string> = { fichas: 'Fichas', variacoes: 'Variações', adicionais: 'Adicionais', combos: 'Combos' };

/** Os títulos das colunas, na ordem do modelo. */
export const COLUNAS = {
  fichas: ['Produto', 'Código', 'Categoria', 'Vai para a cozinha', 'Ingrediente', 'Quantidade', 'Unidade'],
  variacoes: ['Produto', 'Variação', 'Quanto da ficha'],
  adicionais: ['Produto', 'Adicional', 'O que faz', 'Ingrediente', 'Quantidade', 'Unidade'],
  combos: ['Combo', 'Produto que vem nele', 'Quantidade'],
} as const satisfies Record<QualAba, readonly string[]>;

/** Sem estas a aba não dá para ler. As outras podem faltar. */
const OBRIGATORIAS: Record<QualAba, readonly string[]> = {
  fichas: ['Produto', 'Ingrediente', 'Quantidade', 'Unidade'],
  variacoes: ['Produto', 'Variação'],
  adicionais: ['Produto', 'Adicional', 'O que faz'],
  combos: ['Combo', 'Produto que vem nele'],
};

/** As unidades que a planilha aceita. É lista, não texto livre: "fls" e "pct" não viram unidade. */
export const UNIDADES = ['g', 'kg', 'ml', 'l', 'unidade', 'fatia', 'folha', 'rodela', 'colher', 'pitada'] as const;
export type Unidade = (typeof UNIDADES)[number];
/** O que a pessoa costuma escrever, e a unidade que é. */
const COMO_SE_ESCREVE: Record<string, Unidade> = {
  g: 'g', gr: 'g', grama: 'g', gramas: 'g',
  kg: 'kg', quilo: 'kg', quilos: 'kg', kilo: 'kg', kilos: 'kg',
  ml: 'ml',
  l: 'l', litro: 'l', litros: 'l',
  unidade: 'unidade', unidades: 'unidade', un: 'unidade', und: 'unidade', unid: 'unidade',
  fatia: 'fatia', fatias: 'fatia',
  folha: 'folha', folhas: 'folha',
  rodela: 'rodela', rodelas: 'rodela',
  colher: 'colher', colheres: 'colher',
  pitada: 'pitada', pitadas: 'pitada',
};
const LISTA_DE_UNIDADES = UNIDADES.join(', ');

/** Tetos: acima disto não é a planilha de uma loja. */
export const MAX_LINHAS = 20_000;
const MAX_PRODUTOS = 5000;
const MAX_INGREDIENTES = 300;
const MAX_TEXTO = 200;
/** Quantos problemas são devolvidos e guardados. A conta diz o total. */
export const MAX_PROBLEMAS = 500;

export type Problema = {
  /** O nome da aba, como na planilha. */
  aba: string;
  /** A linha na planilha (o título é a linha 1). */
  linha: number;
  texto: string;
  /** O que fazer para acertar. */
  corrigir: string;
};

export type Contas = { produtos: number; comFicha: number; ingredientes: number; variacoes: number; adicionais: number; combos: number };

export type Leitura = {
  /** Não deu para ler a planilha: nada entra, e este é o motivo. Nulo = deu. */
  impede: string | null;
  /** A base só com os produtos que estão certos. */
  base: Base;
  contas: Contas;
  /** Os produtos que entram SEM ficha (não é problema: é como a planilha os traz). */
  semFicha: string[];
  /** Os produtos que ficam de fora, na ordem da planilha, com o motivo de cada linha. */
  deFora: Array<{ produto: string; problemas: Problema[] }>;
  /** Os problemas que não são de um produto (a linha sem nome, o produto que não está na aba Fichas). */
  soltos: Problema[];
  /** Quantos problemas a planilha tem ao todo (a lista pode vir cortada em `MAX_PROBLEMAS`). */
  problemas: number;
};

type Linha = { n: number; c: Record<string, string | number | boolean> };

// ───────────────────────── as células ─────────────────────────

/**
 * Sem acento e sem caixa: "Pão Brioche" e "pao brioche" são o mesmo. (Os
 * espaços a mais já saíram em `texto`, por onde toda célula passa antes.)
 */
export const chave = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** O texto de uma célula. Número vira o texto dele; o que não é texto, número nem sim/não vira vazio. */
function texto(v: unknown): string {
  if (typeof v === 'string') return v.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXTO);
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'boolean') return v ? 'sim' : 'não';
  return '';
}

/** O número de uma célula: o número, ou o texto "120" / "0,5" / "0.5". O resto não é número. */
function numero(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!/^[0-9]+([.,][0-9]+)?$/.test(t)) return null;
  return Number(t.replace(',', '.'));
}

const vazia = (v: unknown): boolean => texto(v) === '';

/** O id de um produto (ou da ficha dele) da planilha: sai do NOME, para ser o mesmo a cada importação. */
function idDe(tipo: 'produto' | 'ficha', chaveDoNome: string): string {
  const h = createHash('sha256').update(`farol:planilha:${tipo}:${chaveDoNome}`, 'utf8').digest('hex');
  const variante = ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variante}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

// ───────────────────────── uma aba ─────────────────────────

/**
 * As linhas de uma aba, pelos títulos das colunas (a ordem delas não
 * importa, nem acento ou caixa no título). `null` = a aba não veio. Texto =
 * não dá para ler, e por quê.
 */
function lerAba(qual: QualAba, bruto: unknown): Linha[] | string | null {
  if (bruto === undefined || bruto === null) return null;
  const nome = NOME_DA_ABA[qual];
  if (!Array.isArray(bruto) || bruto.some((l) => !Array.isArray(l))) return `Não deu para ler a aba “${nome}”. Baixe o modelo e preencha nele.`;
  if (bruto.length > MAX_LINHAS + 1) return `A aba “${nome}” tem mais de ${MAX_LINHAS.toLocaleString('pt-BR')} linhas. Uma planilha é de uma loja só.`;
  const linhas = bruto as unknown[][];
  if (linhas.length === 0) return qual === 'fichas' ? `A aba “${nome}” está vazia.` : null;

  const titulos = new Map<string, number>();
  linhas[0]!.forEach((t, i) => {
    const k = chave(texto(t));
    if (k && !titulos.has(k)) titulos.set(k, i);
  });
  const onde = new Map<string, number>();
  for (const coluna of COLUNAS[qual]) {
    const i = titulos.get(chave(coluna));
    if (i !== undefined) onde.set(coluna, i);
    else if (OBRIGATORIAS[qual].includes(coluna)) return `A aba “${nome}” não tem a coluna “${coluna}”. Baixe o modelo e use os mesmos títulos.`;
  }

  const lidas: Linha[] = [];
  for (let i = 1; i < linhas.length; i += 1) {
    const c: Linha['c'] = {};
    let temAlgo = false;
    for (const [coluna, indice] of onde) {
      const v = linhas[i]![indice];
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        c[coluna] = v;
        if (!vazia(v)) temAlgo = true;
      }
    }
    // a linha em branco (ou só com coluna que não é do modelo) não é nada
    if (temAlgo) lidas.push({ n: i + 1, c });
  }
  return lidas;
}

// ───────────────────────── os pedaços de uma linha ─────────────────────────

type Recado = (texto: string, corrigir: string) => void;

/**
 * A quantidade e a unidade de uma linha. O que falta ou não serve vira
 * recado — e o recado é o que deixa o produto de fora; o valor que não deu
 * para ler volta nulo. `opcional`: as duas em branco, juntas, não é problema
 * (o adicional que acrescenta sem dizer quanto).
 */
function medida(c: Linha['c'], dizer: Recado, opcional = false): { quantidade: number | null; unidade: Unidade | null } {
  const temQuantidade = !vazia(c.Quantidade);
  const temUnidade = !vazia(c.Unidade);
  let quantidade: number | null = null;
  let unidade: Unidade | null = null;
  if (opcional && !temQuantidade && !temUnidade) return { quantidade, unidade };
  if (!temQuantidade) dizer('falta a quantidade.', 'Preencha a coluna Quantidade.');
  else {
    const q = numero(c.Quantidade);
    if (q === null) dizer(`a quantidade “${texto(c.Quantidade)}” não é um número.`, 'Use só o número, com vírgula para decimal: 120 ou 0,5.');
    else if (q <= 0) dizer('a quantidade tem de ser maior que zero.', 'Use só o número, com vírgula para decimal: 120 ou 0,5.');
    else quantidade = q;
  }
  if (!temUnidade) dizer('falta a unidade.', `Use uma destas: ${LISTA_DE_UNIDADES}.`);
  else {
    unidade = COMO_SE_ESCREVE[chave(texto(c.Unidade))] ?? null;
    if (!unidade) dizer(`a unidade “${texto(c.Unidade)}” não está na lista.`, `Use uma destas: ${LISTA_DE_UNIDADES}.`);
  }
  return { quantidade, unidade };
}

const SIM = new Set(['sim', 's', 'yes', 'true', 'x']);
const NAO = new Set(['nao', 'n', 'no', 'false']);
const O_QUE_FAZ: Record<string, 'acrescenta' | 'tira' | 'observacao'> = {
  acrescenta: 'acrescenta', acrescentar: 'acrescenta', adiciona: 'acrescenta', adicionar: 'acrescenta', mais: 'acrescenta',
  tira: 'tira', tirar: 'tira', retira: 'tira', retirar: 'tira', sem: 'tira',
  observacao: 'observacao', 'so observacao': 'observacao', obs: 'observacao',
};

// ───────────────────────── a planilha inteira ─────────────────────────

type EmObra = {
  chave: string;
  nome: string;
  codigo: string | null;
  categoria: string | null;
  cozinha: boolean;
  ingredientes: Ingrediente[];
  variacoes: Produto['variacoes'];
  mais: Opcao[];
  tira: Opcao[];
  combo: Array<{ chave: string; quantidade: number; linha: number }>;
  problemas: Problema[];
};

const NADA: Leitura = {
  impede: null,
  base: { formato: FORMATO_DA_BASE, produtos: [] },
  contas: { produtos: 0, comFicha: 0, ingredientes: 0, variacoes: 0, adicionais: 0, combos: 0 },
  semFicha: [],
  deFora: [],
  soltos: [],
  problemas: 0,
};
const impedida = (motivo: string): Leitura => ({ ...NADA, impede: motivo });

/** Lê a planilha inteira. Nunca rejeita: o que não serve vira `impede` ou problema. */
export function lerPlanilha(abas: unknown): Leitura {
  if (!abas || typeof abas !== 'object' || Array.isArray(abas)) return impedida('Não deu para ler a planilha. Baixe o modelo e preencha nele.');
  const a = abas as Record<QualAba, unknown>;

  const lidas = {} as Record<QualAba, Linha[]>;
  for (const qual of ['fichas', 'variacoes', 'adicionais', 'combos'] as const) {
    const r = lerAba(qual, a[qual]);
    if (typeof r === 'string') return impedida(r);
    if (r === null && qual === 'fichas') return impedida('A planilha não tem a aba “Fichas”. Baixe o modelo e preencha nele.');
    lidas[qual] = r ?? [];
  }
  if (lidas.fichas.length === 0) return impedida('A aba “Fichas” não tem nenhuma linha preenchida.');

  const soltos: Problema[] = [];
  const produtos = new Map<string, EmObra>();
  const ordem: EmObra[] = [];

  // ── a aba Fichas: os produtos, em blocos de linhas ──
  type Bloco = { p: EmObra; linhas: Linha[] };
  const blocos: Bloco[] = [];
  let atual: Bloco | null = null;
  for (const l of lidas.fichas) {
    const nome = texto(l.c.Produto);
    if (!nome) {
      const p: Problema = { aba: NOME_DA_ABA.fichas, linha: l.n, texto: 'a linha está preenchida, mas não tem o nome do produto.', corrigir: 'Repita o nome do produto em cada linha dele.' };
      // provavelmente é do produto de cima: ele fica de fora, para não entrar com um ingrediente a menos
      if (atual) atual.p.problemas.push(p);
      else soltos.push(p);
      continue;
    }
    const k = chave(nome);
    if (atual && atual.p.chave === k) {
      atual.linhas.push(l);
      continue;
    }
    const jaVisto = produtos.get(k);
    if (jaVisto) {
      jaVisto.problemas.push({
        aba: NOME_DA_ABA.fichas,
        linha: l.n,
        texto: 'o produto aparece em dois blocos de linhas, separados por outro produto.',
        corrigir: 'Junte as linhas do produto, uma embaixo da outra, na ordem da montagem.',
      });
      atual = blocos.find((b) => b.p === jaVisto)!;
      atual.linhas.push(l);
      continue;
    }
    if (ordem.length >= MAX_PRODUTOS) return impedida(`A planilha tem mais de ${MAX_PRODUTOS.toLocaleString('pt-BR')} produtos. Uma planilha é de uma loja só.`);
    const p: EmObra = { chave: k, nome, codigo: null, categoria: null, cozinha: true, ingredientes: [], variacoes: [], mais: [], tira: [], combo: [], problemas: [] };
    produtos.set(k, p);
    ordem.push(p);
    atual = { p, linhas: [l] };
    blocos.push(atual);
  }

  for (const { p, linhas } of blocos) {
    const naFicha = (linha: number): Recado => (t, corrigir) => p.problemas.push({ aba: NOME_DA_ABA.fichas, linha, texto: t, corrigir });
    p.codigo = linhas.map((l) => texto(l.c['Código'])).find(Boolean)?.slice(0, 60) ?? null;
    p.categoria = linhas.map((l) => texto(l.c.Categoria)).find(Boolean) ?? null;

    // "Vai para a cozinha": sim, não ou em branco (= sim) — e a mesma coisa em todas as linhas do produto
    const ditas = new Set<boolean>();
    for (const l of linhas) {
      if (vazia(l.c['Vai para a cozinha'])) continue;
      const v = chave(texto(l.c['Vai para a cozinha']));
      if (SIM.has(v)) ditas.add(true);
      else if (NAO.has(v)) ditas.add(false);
      else naFicha(l.n)(`“Vai para a cozinha” está como “${texto(l.c['Vai para a cozinha'])}”.`, 'Use sim ou não. Em branco vale sim.');
    }
    if (ditas.size > 1) naFicha(linhas[0]!.n)('“Vai para a cozinha” muda de uma linha para outra do mesmo produto.', 'Use o mesmo valor em todas as linhas do produto.');
    p.cozinha = ditas.size === 1 ? [...ditas][0]! : true;

    // uma linha só e sem ingrediente: o produto existe, e não tem ficha
    const soOProduto = linhas.length === 1 && vazia(linhas[0]!.c.Ingrediente) && vazia(linhas[0]!.c.Quantidade) && vazia(linhas[0]!.c.Unidade);
    if (soOProduto) continue;
    if (linhas.length > MAX_INGREDIENTES) {
      naFicha(linhas[0]!.n)(`o produto tem mais de ${MAX_INGREDIENTES} linhas.`, 'Uma ficha tem os ingredientes de um produto só.');
      continue;
    }
    for (const l of linhas) {
      const dizer = naFicha(l.n);
      const ingrediente = texto(l.c.Ingrediente);
      if (!ingrediente) {
        if (vazia(l.c.Quantidade) && vazia(l.c.Unidade)) dizer('falta o ingrediente.', 'Cada linha do produto tem um ingrediente: preencha, ou apague a linha.');
        else dizer('a linha tem quantidade ou unidade, mas não tem o ingrediente.', 'Preencha a coluna Ingrediente.');
        continue;
      }
      p.ingredientes.push({ nome: ingrediente, ...medida(l.c, dizer), preparo: false, insumoId: null, fichaId: null });
    }
  }

  /** O produto de uma linha das outras abas — ou o recado de que ele não está na aba Fichas. */
  const doProduto = (qual: QualAba, l: Linha, coluna: string): EmObra | null => {
    const nome = texto(l.c[coluna]);
    if (!nome) {
      soltos.push({ aba: NOME_DA_ABA[qual], linha: l.n, texto: `a linha está preenchida, mas a coluna “${coluna}” está em branco.`, corrigir: `Preencha a coluna “${coluna}” com o nome do produto, como na aba Fichas.` });
      return null;
    }
    const p = produtos.get(chave(nome));
    if (!p) soltos.push({ aba: NOME_DA_ABA[qual], linha: l.n, texto: `o produto “${nome}” não está na aba Fichas.`, corrigir: 'Escreva o nome igual ao da aba Fichas, ou ponha o produto lá.' });
    return p ?? null;
  };

  // ── a aba Variações ──
  for (const l of lidas.variacoes) {
    const p = doProduto('variacoes', l, 'Produto');
    if (!p) continue;
    const dizer: Recado = (t, corrigir) => p.problemas.push({ aba: NOME_DA_ABA.variacoes, linha: l.n, texto: t, corrigir });
    const nome = texto(l.c['Variação']);
    if (!nome) {
      dizer('falta o nome da variação.', 'Preencha a coluna Variação: Simples, Duplo, 300 ml…');
      continue;
    }
    if (p.variacoes.some((v) => chave(v.nome) === chave(nome))) {
      dizer(`a variação “${nome}” aparece duas vezes neste produto.`, 'Deixe uma linha só para cada variação.');
      continue;
    }
    let fator = 1;
    if (!vazia(l.c['Quanto da ficha'])) {
      const f = numero(l.c['Quanto da ficha']);
      if (f === null || f <= 0) {
        dizer(`“Quanto da ficha” está como “${texto(l.c['Quanto da ficha'])}”.`, 'Use um número maior que zero: 1 é a ficha inteira, 2 o dobro, 0,5 a metade. Em branco vale 1.');
        continue;
      }
      fator = f;
    }
    p.variacoes.push({ nome, codigo: null, fator });
  }

  // ── a aba Adicionais ──
  for (const l of lidas.adicionais) {
    const p = doProduto('adicionais', l, 'Produto');
    if (!p) continue;
    const dizer: Recado = (t, corrigir) => p.problemas.push({ aba: NOME_DA_ABA.adicionais, linha: l.n, texto: t, corrigir });
    const nome = texto(l.c.Adicional);
    if (!nome) {
      dizer('falta o nome do adicional.', 'Preencha a coluna Adicional: Bacon, Sem cebola, Ponto da carne…');
      continue;
    }
    const oQueFaz = O_QUE_FAZ[chave(texto(l.c['O que faz']))];
    if (!oQueFaz) {
      dizer(vazia(l.c['O que faz']) ? 'falta dizer o que o adicional faz.' : `“O que faz” está como “${texto(l.c['O que faz'])}”.`, 'Use acrescenta, tira ou observação.');
      continue;
    }
    if (oQueFaz === 'observacao') {
      p.mais.push({ id: null, nome, codigo: null, efeito: { tipo: 'observacao' } });
      continue;
    }
    const ingrediente = texto(l.c.Ingrediente);
    if (!ingrediente) {
      dizer(`falta o ingrediente que o adicional ${oQueFaz}.`, 'Preencha a coluna Ingrediente.');
      continue;
    }
    if (oQueFaz === 'tira') {
      const daFicha = p.ingredientes.find((i) => chave(i.nome) === chave(ingrediente));
      if (!daFicha) {
        dizer(`o produto não tem “${ingrediente}” na ficha, para tirar.`, 'Escreva o ingrediente igual ao da aba Fichas.');
        continue;
      }
      p.tira.push({ id: null, nome, codigo: null, efeito: { tipo: 'retira', nome: daFicha.nome, insumoId: null, fichaId: null } });
      continue;
    }
    const efeito: Efeito = { tipo: 'insumo', nome: ingrediente, ...medida(l.c, dizer, true), insumoId: null };
    p.mais.push({ id: null, nome, codigo: null, efeito });
  }

  // ── a aba Combos ──
  for (const l of lidas.combos) {
    const p = doProduto('combos', l, 'Combo');
    if (!p) continue;
    const dizer: Recado = (t, corrigir) => p.problemas.push({ aba: NOME_DA_ABA.combos, linha: l.n, texto: t, corrigir });
    const nome = texto(l.c['Produto que vem nele']);
    if (!nome) {
      dizer('falta o produto que vem no combo.', 'Preencha a coluna “Produto que vem nele” com o nome do produto, como na aba Fichas.');
      continue;
    }
    const dentro = produtos.get(chave(nome));
    if (!dentro) {
      dizer(`o produto “${nome}”, que vem no combo, não está na aba Fichas.`, 'Escreva o nome igual ao da aba Fichas, ou ponha o produto lá.');
      continue;
    }
    if (dentro === p) {
      dizer('o combo não pode vir dentro dele mesmo.', 'Em “Produto que vem nele” vai um dos produtos do combo.');
      continue;
    }
    if (p.combo.some((c) => c.chave === dentro.chave)) {
      dizer(`o produto “${dentro.nome}” aparece duas vezes neste combo.`, 'Deixe uma linha só e ponha a quantidade.');
      continue;
    }
    let quantidade = 1;
    if (!vazia(l.c.Quantidade)) {
      const q = numero(l.c.Quantidade);
      if (q === null || q <= 0) {
        dizer(`a quantidade está como “${texto(l.c.Quantidade)}”.`, 'Use um número maior que zero. Em branco vale 1.');
        continue;
      }
      quantidade = q;
    }
    p.combo.push({ chave: dentro.chave, quantidade, linha: l.n });
  }

  // ── o combo que leva um produto que ficou de fora fica de fora junto ──
  for (let mudou = true; mudou; ) {
    mudou = false;
    for (const p of ordem) {
      if (p.problemas.length > 0) continue;
      for (const c of p.combo) {
        const dentro = produtos.get(c.chave)!;
        if (dentro.problemas.length === 0) continue;
        p.problemas.push({ aba: NOME_DA_ABA.combos, linha: c.linha, texto: `o produto “${dentro.nome}”, que vem neste combo, ficou de fora.`, corrigir: `Corrija o produto “${dentro.nome}” e envie de novo.` });
        mudou = true;
        break;
      }
    }
  }

  // ── a base, com o que está certo ──
  const certos = ordem.filter((p) => p.problemas.length === 0);
  const base: Base = {
    formato: FORMATO_DA_BASE,
    produtos: certos.map((p): Produto => {
      const adicionais: GrupoDeAdicionais[] = [];
      if (p.mais.length > 0) adicionais.push({ nome: 'Adicionais', tipo: 'adicionar', opcoes: p.mais });
      if (p.tira.length > 0) adicionais.push({ nome: 'Retirar', tipo: 'remover', opcoes: p.tira });
      return {
        id: idDe('produto', p.chave),
        nome: p.nome,
        codigo: p.codigo,
        categoria: p.categoria,
        tipo: p.combo.length > 0 ? 'combo' : p.variacoes.length > 0 ? 'variavel' : 'simples',
        cozinha: p.cozinha,
        setor: null,
        preparoMin: null,
        ficha: p.ingredientes.length > 0 ? { id: idDe('ficha', p.chave), nome: p.nome, ingredientes: p.ingredientes } : null,
        variacoes: p.variacoes,
        combo: p.combo.map((c) => ({ produtoId: idDe('produto', c.chave), nome: produtos.get(c.chave)!.nome, quantidade: c.quantidade })),
        adicionais,
      };
    }),
  };

  // Na ordem em que a pessoa corrige: uma aba de cada vez (na ordem do modelo) e, dentro dela, de cima para baixo.
  const ABAS_EM_ORDEM = (['fichas', 'variacoes', 'adicionais', 'combos'] as const).map((q): string => NOME_DA_ABA[q]);
  const porLinha = (x: Problema, y: Problema) => ABAS_EM_ORDEM.indexOf(x.aba) - ABAS_EM_ORDEM.indexOf(y.aba) || x.linha - y.linha;
  const deForaTodos = ordem.filter((p) => p.problemas.length > 0).map((p) => ({ produto: p.nome, problemas: [...p.problemas].sort(porLinha) }));
  const total = soltos.length + deForaTodos.reduce((n, d) => n + d.problemas.length, 0);

  // a lista devolvida tem teto; a conta, não
  let cabem = MAX_PROBLEMAS;
  const deFora: Leitura['deFora'] = [];
  for (const d of deForaTodos) {
    const problemas = d.problemas.slice(0, Math.max(cabem, 0));
    cabem -= problemas.length;
    deFora.push({ produto: d.produto, problemas });
  }

  return {
    impede: null,
    base,
    contas: {
      produtos: base.produtos.length,
      comFicha: base.produtos.filter((p) => p.ficha !== null).length,
      ingredientes: base.produtos.reduce((n, p) => n + (p.ficha?.ingredientes.length ?? 0), 0),
      variacoes: base.produtos.reduce((n, p) => n + p.variacoes.length, 0),
      adicionais: base.produtos.reduce((n, p) => n + p.adicionais.reduce((m, g) => m + g.opcoes.length, 0), 0),
      combos: base.produtos.filter((p) => p.tipo === 'combo').length,
    },
    semFicha: base.produtos.filter((p) => p.ficha === null && p.tipo !== 'combo').map((p) => p.nome),
    deFora,
    // os soltos já estão na ordem de corrigir: cada aba é lida inteira, de cima para baixo, antes da seguinte
    soltos: soltos.slice(0, Math.max(cabem, 0)),
    problemas: total,
  };
}

// ───────────────────────── da base para a planilha ─────────────────────────

export type Abas = Record<QualAba, Array<Array<string | number>>>;

/**
 * A base de volta em linhas, no modelo: é o "Baixar a planilha", para
 * corrigir e importar de novo. Ler o que sai daqui devolve a mesma base.
 */
export function linhasDaBase(base: Base): Abas {
  const abas: Abas = {
    fichas: [[...COLUNAS.fichas]],
    variacoes: [[...COLUNAS.variacoes]],
    adicionais: [[...COLUNAS.adicionais]],
    combos: [[...COLUNAS.combos]],
  };
  for (const p of base.produtos) {
    const comeco = [p.nome, p.codigo ?? '', p.categoria ?? '', p.cozinha ? 'sim' : 'não'];
    if (p.ficha && p.ficha.ingredientes.length > 0) {
      for (const i of p.ficha.ingredientes) abas.fichas.push([...comeco, i.nome, i.quantidade ?? '', i.unidade ?? '']);
    } else abas.fichas.push([...comeco, '', '', '']);
    for (const v of p.variacoes) abas.variacoes.push([p.nome, v.nome, v.fator]);
    for (const g of p.adicionais) {
      for (const o of g.opcoes) {
        if (o.efeito.tipo === 'observacao') abas.adicionais.push([p.nome, o.nome, 'observação', '', '', '']);
        else if (o.efeito.tipo === 'retira') abas.adicionais.push([p.nome, o.nome, 'tira', o.efeito.nome, '', '']);
        else if (o.efeito.tipo === 'insumo') abas.adicionais.push([p.nome, o.nome, 'acrescenta', o.efeito.nome, o.efeito.quantidade ?? '', o.efeito.unidade ?? '']);
      }
    }
    for (const c of p.combo) abas.combos.push([p.nome, c.nome ?? '', c.quantidade]);
  }
  return abas;
}

/**
 * O modelo que a pessoa baixa: as quatro abas, com os títulos e um exemplo
 * pequeno para apagar. Ler o modelo não dá problema nenhum (há teste).
 */
export const MODELO: Abas = {
  fichas: [
    [...COLUNAS.fichas],
    ['X-Burger', '1042', 'Burgers', 'sim', 'Pão brioche', 1, 'unidade'],
    ['X-Burger', '1042', 'Burgers', 'sim', 'Blend da casa', 120, 'g'],
    ['X-Burger', '1042', 'Burgers', 'sim', 'Queijo prato', 2, 'fatia'],
    ['X-Burger', '1042', 'Burgers', 'sim', 'Cebola roxa', 10, 'g'],
    ['X-Burger', '1042', 'Burgers', 'sim', 'Molho da casa', 15, 'g'],
    ['Batata frita', '2010', 'Porções', 'sim', 'Batata palito', 200, 'g'],
    ['Batata frita', '2010', 'Porções', 'sim', 'Sal', 1, 'pitada'],
    ['Refrigerante lata', '3001', 'Bebidas', 'não', '', '', ''],
    ['Combo da casa', '4001', 'Combos', 'sim', '', '', ''],
  ],
  variacoes: [[...COLUNAS.variacoes], ['X-Burger', 'Simples', 1], ['X-Burger', 'Duplo', 2]],
  adicionais: [
    [...COLUNAS.adicionais],
    ['X-Burger', 'Bacon', 'acrescenta', 'Bacon fatiado', 20, 'g'],
    ['X-Burger', 'Ponto da carne', 'observação', '', '', ''],
    ['X-Burger', 'Sem cebola', 'tira', 'Cebola roxa', '', ''],
  ],
  combos: [[...COLUNAS.combos], ['Combo da casa', 'X-Burger', 1], ['Combo da casa', 'Batata frita', 1], ['Combo da casa', 'Refrigerante lata', 1]],
};
