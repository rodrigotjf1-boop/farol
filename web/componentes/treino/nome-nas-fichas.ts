// =====================================================================
// O nome escrito à mão na conferência: o que as fichas têm com ele
// =====================================================================
// Do protótipo aprovado pelo dono em 19/10/2026 (`mockups/farol-conexoes-e-
// fichas.html`: conferência → Outro ingrediente → "Um ingrediente que não
// está nas fichas…"). O pedido dele: "ter uma lista com os ingredientes
// puxados na ficha… caso não tenha, uma opção de cadastrar e colocar o nome,
// e depois verificar se associa a algo já nas fichas". Enquanto a pessoa
// escreve, a gaveta mostra:
//
//   • o MESMO — a mesma chave de um ingrediente das fichas ("Pão de Brioche"
//     = "Pão Brioche", #190), ou um OUTRO NOME que quem configura juntou a
//     ele: entra o nome da ficha;
//   • o nome que alguém JÁ ESCREVEU e ainda espera ficha (o "nome fora das
//     fichas" sem resposta, ou "vai entrar numa ficha nova"): entra esse
//     nome, e os exemplos ficam juntos;
//   • até 3 PARECIDOS — uma palavra de 4 letras ou mais igual, ou quase (1
//     letra de diferença nas de 5 a 7 letras, 2 nas de 8 ou mais: "shoyu" e
//     "shoyo"), ou o mesmo número ("1 corte"); ficam só os que têm MAIS
//     palavras batendo ("Cebola caramelizada no shoyu da casa" traz o
//     "Cebola ao shoyo", e não o "Blend da casa"), os das fichas antes;
//   • nada: "não está em nenhuma ficha" — entra o nome escrito, marcado
//     "fora das fichas", e vira sugestão ao salvar.
// Sem tela: testa-se fora do Next.
// =====================================================================

import { chaveDoIngrediente } from '../fichas/chave-do-ingrediente';

/** Um nome que pode ser o escrito: das fichas, ou escrito à mão e ainda fora delas (`fora`). */
export type Candidato = { nome: string; fora: boolean };

export type NasFichas = {
  /** O mesmo ingrediente — das fichas, ou o nome fora delas que alguém já escreveu. Nulo = não há. */
  mesmo: Candidato | null;
  /** O "mesmo" é um outro nome que quem configura juntou a um ingrediente das fichas. */
  outroNome: boolean;
  /** Até `MAX_PARECIDOS`, os de mais palavras batendo; vazio quando há o mesmo. */
  parecidos: Candidato[];
};

export type VocabularioDoNome = {
  /** Os ingredientes das fichas (os que se veem de cima). */
  fichas: string[];
  /** Os nomes escritos à mão que esperam uma ficha. */
  fora?: string[];
  /** A chave do outro nome → o ingrediente das fichas a que ele foi juntado. */
  outrosNomes?: Record<string, string>;
};

export const MAX_PARECIDOS = 3;

/** Quantas letras trocar, pôr ou tirar para ir de uma palavra à outra. */
export function distancia(a: string, b: string): number {
  let antes = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const agora = [i];
    for (let j = 1; j <= b.length; j += 1) agora[j] = Math.min(antes[j]! + 1, agora[j - 1]! + 1, antes[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    antes = agora;
  }
  return antes[b.length]!;
}

/**
 * Duas palavras batem: iguais, ou quase. As curtas ("pão") não bastam: senão todo pão pareceria com todo pão. Número
 * só igual, de qualquer tamanho: "1 corte" acha o "Pão gergelim de 1 corte", e não o "de dois cortes".
 */
export function palavrasBatem(a: string, b: string): boolean {
  if (/\d/.test(a) || /\d/.test(b)) return a === b;
  if (a.length < 4 || b.length < 4) return false;
  if (a === b) return true;
  const menor = Math.min(a.length, b.length);
  return menor >= 5 && distancia(a, b) <= (menor >= 8 ? 2 : 1);
}

/** O que o vocabulário tem com o nome escrito. */
export function nasFichas(nome: string, vocab: VocabularioDoNome): NasFichas {
  const k = chaveDoIngrediente(nome);
  const junto = vocab.outrosNomes?.[k];
  if (junto) return { mesmo: { nome: junto, fora: false }, outroNome: true, parecidos: [] };
  const todos: Candidato[] = [...vocab.fichas.map((n) => ({ nome: n, fora: false })), ...(vocab.fora ?? []).map((n) => ({ nome: n, fora: true }))];
  const minhas = k.split(' ');
  let mesmo: Candidato | null = null;
  const parecidos: Array<Candidato & { batem: number }> = [];
  const vistas = new Set<string>();
  for (const c of todos) {
    const kc = chaveDoIngrediente(c.nome);
    // o mesmo nome nas fichas e fora delas (a ficha chegou depois): vale o das fichas, que vem antes
    if (vistas.has(kc)) continue;
    vistas.add(kc);
    if (kc === k) {
      mesmo ??= c;
      continue;
    }
    const delas = kc.split(' ');
    const batem = minhas.filter((w) => delas.some((d) => palavrasBatem(w, d))).length;
    if (batem) parecidos.push({ ...c, batem });
  }
  if (mesmo) return { mesmo, outroNome: false, parecidos: [] };
  parecidos.sort((a, b) => b.batem - a.batem || Number(a.fora) - Number(b.fora) || a.nome.localeCompare(b.nome, 'pt-BR'));
  const mais = parecidos[0]?.batem ?? 0;
  return {
    mesmo: null,
    outroNome: false,
    parecidos: parecidos
      .filter((p) => p.batem === mais)
      .slice(0, MAX_PARECIDOS)
      .map((p) => ({ nome: p.nome, fora: p.fora })),
  };
}

/** "nas fichas de X-Burger e X-Salada", "… de X-Burger, X-Salada e mais 4", "adicional de Onion". */
export function ondeEntra(lugares: { fichas: string[]; adicional: string[] } | undefined): string {
  const lista = (nomes: string[]) => (nomes.length <= 2 ? nomes.join(' e ') : `${nomes.slice(0, 2).join(', ')} e mais ${nomes.length - 2}`);
  if (lugares?.fichas.length) return `nas fichas de ${lista(lugares.fichas)}`;
  if (lugares?.adicional.length) return `adicional de ${lista(lugares.adicional)}`;
  return 'nas fichas';
}
