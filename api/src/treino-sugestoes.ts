// =====================================================================
// As sugestões para as fichas, tiradas SÓ do que alguém conferiu
// =====================================================================
// A21, fatia T6 (migration 051). Do protótipo aprovado pelo dono em
// 15/10/2026 (tela Treinamento, aba "Sugestões para as fichas"). O Farol
// não muda a ficha: diz onde ela parece diferente do que a bancada faz, e
// quem configura responde. Quatro tipos:
//
//   • NOME FORA DAS FICHAS — alguém escreveu, na conferência, um nome que
//     não está em ficha nenhuma: cadastre, para os exemplos irem para o
//     ingrediente certo;
//   • FALTA NA FICHA — num produto, quem conferiu disse várias vezes que um
//     ingrediente veio "a mais, sem pedido";
//   • FICHA DIFERENTE DA BANCADA — num produto, quem conferiu disse várias
//     vezes que um ingrediente da ficha FALTOU (veio menos, ou não veio);
//   • UM NOME PARA DUAS COISAS — o mesmo nome confirmado em etapas que a
//     leitura viu como molhos de cores diferentes.
//
// "Várias vezes" é a regra para não sugerir por um caso só: pelo menos 3
// lanches e pelo menos metade dos conferidos daquele produto (o molho de
// duas cores: cada cor em pelo menos 2 etapas). Os limites são meus,
// escritos no registro de decisões, para o dono confirmar.
// =====================================================================

import type { Base } from './fichas.js';
import { chaveDoIngrediente, ingredientesDaBase } from './ingredientes.js';
import { nomeEnsinado, vezesNaFicha, type Conferencia, type EtapaLida } from './treino.js';

export const LIMITES = { minimo: 3, parte: 0.5, jeitos: 2 } as const;
export const TIPOS = ['nome-fora', 'falta-na-ficha', 'ficha-diferente', 'duas-coisas'] as const;
export type TipoDeSugestao = (typeof TIPOS)[number];
export const DECISOES = ['sim', 'nao'] as const;
export type DecisaoDaSugestao = (typeof DECISOES)[number];

const ROTULO: Record<TipoDeSugestao, string> = {
  'nome-fora': 'nome fora das fichas',
  'falta-na-ficha': 'falta na ficha',
  'ficha-diferente': 'ficha diferente da bancada',
  'duas-coisas': 'um nome para duas coisas',
};

export type Sugestao = {
  chave: string;
  tipo: TipoDeSugestao;
  /** O nome do tipo, na etiqueta do cartão. */
  rotulo: string;
  produto: string | null;
  ingrediente: string;
  titulo: string;
  /** O que a bancada mostrou. */
  viu: string;
  /** A sugestão. */
  propoe: string;
  /** Onde mudar, sem o sistema ("na ficha do X-Burger"): a tela completa com a origem das fichas. */
  onde: string;
  /** O que cada resposta quer dizer, nos botões. */
  sim: string;
  nao: string;
};

export type Conferido = { produto: string | null; etapas: EtapaLida[]; conferencia: Conferencia };

export const chaveDaSugestao = (tipo: TipoDeSugestao, produto: string | null, ingrediente: string): string =>
  [tipo, chaveDoIngrediente(produto ?? ''), chaveDoIngrediente(ingrediente)].join('|');

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const lista = (nomes: string[]): string => (nomes.length <= 1 ? (nomes[0] ?? '') : `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`);

/** "2 fatias", "1 fatia", "1 unidade" — o número com a unidade da ficha, quando ela se conta de cima. */
function comUnidade(n: number, unidade: string | null): string {
  const u = (unidade ?? '').trim().toLowerCase();
  if (/^fatias?$/.test(u)) return plural(n, 'fatia', 'fatias');
  if (/^unidades?$/.test(u)) return plural(n, 'unidade', 'unidades');
  return String(n);
}

/** O valor que mais aparece (no empate, o menor). */
function moda(valores: number[]): number {
  const conta = new Map<number, number>();
  for (const v of valores) conta.set(v, (conta.get(v) ?? 0) + 1);
  return [...conta.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
}

/** As sugestões das conferências, com as fichas de hoje. Sem fichas, nenhuma. */
export function sugestoesDoTreino(conferidos: Conferido[], base: Base | null): Sugestao[] {
  if (!base) return [];
  const vocab = new Set(ingredientesDaBase(base).map((i) => chaveDoIngrediente(i.nome)));
  const produtos = new Map(base.produtos.filter((p) => p.ficha).map((p) => [chaveDoIngrediente(p.nome), p]));
  const saida: Sugestao[] = [];
  const nova = (s: Omit<Sugestao, 'chave' | 'rotulo'>) => saida.push({ ...s, chave: chaveDaSugestao(s.tipo, s.produto, s.ingrediente), rotulo: ROTULO[s.tipo] });

  // ───── 1. o nome escrito na conferência que não está em ficha nenhuma ─────
  const fora = new Map<string, { nome: string; lanches: number; produtos: Set<string> }>();
  for (const c of conferidos) {
    const noLanche = new Set<string>();
    c.etapas.forEach((_, i) => {
      const r = c.conferencia.etapas[i];
      if (r?.v !== 'outro' || !r.nome) return;
      const k = chaveDoIngrediente(r.nome);
      if (vocab.has(k) || noLanche.has(k)) return;
      noLanche.add(k);
      const f = fora.get(k) ?? { nome: r.nome, lanches: 0, produtos: new Set<string>() };
      f.lanches += 1;
      if (c.produto) f.produtos.add(c.produto);
      fora.set(k, f);
    });
  }
  for (const f of fora.values()) {
    nova({
      tipo: 'nome-fora',
      produto: null,
      ingrediente: f.nome,
      titulo: `“${f.nome}” não está em nenhuma ficha`,
      viu: `Em ${plural(f.lanches, 'lanche conferido', 'lanches conferidos')}${f.produtos.size ? ` (${lista([...f.produtos])})` : ''}, quem conferiu chamou um ingrediente de “${f.nome}”.`,
      propoe: 'Se ele entra em algum lanche, cadastre-o na ficha com este nome: assim o Farol junta os exemplos dele ao ingrediente certo.',
      onde: 'na ficha do lanche em que ele entra',
      sim: 'Vou cadastrar',
      nao: 'Foi engano',
    });
  }

  // os conferidos de cada produto (os que não eram lanche ficam de fora)
  const porProduto = new Map<string, Conferido[]>();
  for (const c of conferidos) {
    if (!c.produto) continue;
    const k = chaveDoIngrediente(c.produto);
    porProduto.set(k, [...(porProduto.get(k) ?? []), c]);
  }

  for (const [kp, lanches] of porProduto) {
    const p = produtos.get(kp);
    if (!p?.ficha) continue;
    const n = lanches.length;
    const repetido = (vezes: number) => vezes >= LIMITES.minimo && vezes / n >= LIMITES.parte;

    // ───── 2. veio a mais, sem pedido, de novo e de novo ─────
    const aMais = new Map<string, { nome: string; vezes: number }>();
    for (const c of lanches) {
      for (const [nome, v] of Object.entries(c.conferencia.aMais)) {
        if (v !== 'amais') continue;
        const k = chaveDoIngrediente(nome);
        const a = aMais.get(k) ?? { nome, vezes: 0 };
        a.vezes += 1;
        aMais.set(k, a);
      }
    }
    for (const a of aMais.values()) {
      if (!repetido(a.vezes)) continue;
      nova({
        tipo: 'falta-na-ficha',
        produto: p.nome,
        ingrediente: a.nome,
        titulo: `${p.nome}: entra ${a.nome}, que não está na ficha`,
        viu: `Em ${a.vezes} dos ${n} ${p.nome} conferidos, a bancada pôs ${a.nome} sem pedido do cliente.`,
        propoe: `Se ${a.nome} faz parte do ${p.nome}, inclua na ficha. Se foi pedido do cliente, deixe como está: com os pedidos do KDS, o Farol vai saber disso sozinho.`,
        onde: `na ficha do ${p.nome}`,
        sim: 'Vou incluir na ficha',
        nao: 'Foi pedido do cliente',
      });
    }

    // ───── 3. faltou, de novo e de novo: a ficha pode estar diferente da bancada ─────
    for (const ing of p.ficha.ingredientes) {
      const k = chaveDoIngrediente(ing.nome);
      const quer = vezesNaFicha(ing.quantidade, ing.unidade);
      const vistos: number[] = [];
      for (const c of lanches) {
        const falta = Object.entries(c.conferencia.faltas).find(([nome]) => chaveDoIngrediente(nome) === k)?.[1];
        if (falta !== 'faltou') continue;
        let viu = 0;
        c.etapas.forEach((e, i) => {
          const nome = nomeEnsinado(e, c.conferencia.etapas[i] ?? null);
          if (nome && chaveDoIngrediente(nome) === k) viu += e.vezes;
        });
        if (viu < quer) vistos.push(viu);
      }
      if (!repetido(vistos.length)) continue;
      const m = moda(vistos);
      nova({
        tipo: 'ficha-diferente',
        produto: p.nome,
        ingrediente: ing.nome,
        titulo:
          m === 0
            ? `${p.nome}: a ficha tem ${ing.nome}; a bancada não pôs`
            : `${p.nome}: a ficha diz ${comUnidade(quer, ing.unidade)} de ${ing.nome}; a bancada pôs ${m}`,
        viu:
          m === 0
            ? `Em ${vistos.length} dos ${n} ${p.nome} conferidos, quem conferiu disse que ${ing.nome} faltou.`
            : `Em ${vistos.length} dos ${n} ${p.nome} conferidos, entrou ${comUnidade(m, ing.unidade)} de ${ing.nome}, e quem conferiu disse que faltou.`,
        propoe:
          m === 0
            ? `Se ${ing.nome} não entra mais no ${p.nome}, tire da ficha. Se entra, a ficha está certa e o que muda é a montagem.`
            : `Se o certo é ${comUnidade(m, ing.unidade)}, corrija a quantidade na ficha. Se são ${comUnidade(quer, ing.unidade)}, a ficha está certa e o que muda é a montagem.`,
        onde: `na ficha do ${p.nome}`,
        sim: 'Vou corrigir a ficha',
        nao: 'A ficha está certa',
      });
    }
  }

  // ───── 4. o mesmo nome em molhos de cores diferentes ─────
  const jeitos = new Map<string, { nome: string; porLeitura: Map<string, { vezes: number; produtos: Set<string> }> }>();
  for (const c of conferidos) {
    c.etapas.forEach((e, i) => {
      const nome = nomeEnsinado(e, c.conferencia.etapas[i] ?? null);
      const leu = (e.leu ?? '').trim().toLowerCase();
      if (!nome || !/^molho \S/.test(leu)) return;
      const k = chaveDoIngrediente(nome);
      const j = jeitos.get(k) ?? { nome, porLeitura: new Map() };
      const x = j.porLeitura.get(leu) ?? { vezes: 0, produtos: new Set<string>() };
      x.vezes += 1;
      if (c.produto) x.produtos.add(c.produto);
      j.porLeitura.set(leu, x);
      jeitos.set(k, j);
    });
  }
  for (const j of jeitos.values()) {
    const fortes = [...j.porLeitura.entries()].filter(([, x]) => x.vezes >= LIMITES.jeitos).sort((a, b) => b[1].vezes - a[1].vezes || a[0].localeCompare(b[0]));
    if (fortes.length < 2) continue;
    const produtosDoNome = [...new Set(fortes.flatMap(([, x]) => [...x.produtos]))];
    nova({
      tipo: 'duas-coisas',
      produto: null,
      ingrediente: j.nome,
      titulo: `“${j.nome}” parece ser mais de um ingrediente`,
      viu: `Nos lanches conferidos, ${j.nome} apareceu de ${fortes.length} jeitos: ${lista(
        fortes.map(([leu, x]) => `“${leu}” em ${plural(x.vezes, 'etapa', 'etapas')}${x.produtos.size ? ` (${lista([...x.produtos])})` : ''}`),
      )}.`,
      propoe: 'Se são ingredientes diferentes, dê um nome a cada um nas fichas. Com um nome só, o Farol aprende os dois como se fossem um.',
      onde: produtosDoNome.length ? `nas fichas ${produtosDoNome.length === 1 ? 'do' : 'de'} ${lista(produtosDoNome)}` : 'nas fichas',
      sim: 'Vou dar nomes diferentes',
      nao: 'É o mesmo ingrediente',
    });
  }

  const ordem = (t: TipoDeSugestao) => TIPOS.indexOf(t);
  return saida.sort((a, b) => ordem(a.tipo) - ordem(b.tipo) || (a.produto ?? '').localeCompare(b.produto ?? '', 'pt-BR') || a.ingrediente.localeCompare(b.ingrediente, 'pt-BR'));
}
