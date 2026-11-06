// =====================================================================
// A fila "para rever" (o protótipo aprovado pelo dono em 06/11/2026)
// =====================================================================
// Os lanches conferidos como "Não era um lanche" (ou "não dá para saber") em
// que um ingrediente que quem conferiu CONFIRMOU só vai num lanche — a regra
// da sugestão pelo ingrediente (`sugestao-pelo-ingrediente.ts`, a mesma do
// console): o Número e o Trio da mesma ficha contam como um. Do dono, no
// mesmo dia: "não era um lanche" = o juiz acertava alguns ingredientes, mas
// pelos ingredientes não dava para definir a ficha — e 1 ou 2 ingredientes
// definem o lanche.
//
//   • NADA MUDA SOZINHO: a nuvem só diz, na lista, quais conferidos estão
//     para rever e por qual ingrediente; a resposta é de quem confere;
//   • SAI salvando de novo. Com o lanche escolhido, a conferência vale pela
//     resposta nova (o placar, o palpite refeito com as fichas de agora, os
//     exemplos refeitos — o "conferir de novo" de sempre). Com "Não era um
//     lanche" de novo, a resposta guarda `sugestaoVista` — o lanche que a
//     sugestão dizia e por quais ingredientes — e ele não volta;
//   • quem salva "Não era um lanche" já vendo a sugestão (a gaveta a mostra
//     desde 06/11/2026) ganha a mesma marca: já decidiu, não entra.
//
// Sem migration: a marca mora na resposta (jsonb). Quem decide a marca é a
// API, pela conferência que ela mesma leu — o corpo que a tela manda não a
// traz (`lerConferencia` monta a resposta só com os campos dela).
// =====================================================================

import type { Base } from './fichas.js';
import type { Estudo } from './estudo-das-fichas.js';
import { chaveDoIngrediente, ingredientesDaBase } from './ingredientes.js';
import { sugestaoPeloIngrediente, type OndeOIngredienteEntra, type SugestaoPeloIngrediente } from './sugestao-pelo-ingrediente.js';
import { porFoto, vistosDaConferencia, type Conferencia, type EtapaLida } from './treino.js';

/** A marca na resposta: a sugestão que estava na tela quando quem conferiu salvou "Não era um lanche". */
export type SugestaoVista = { lanche: string; pelos: string[] };
/** Por que o lanche está para rever: o ingrediente confirmado, o lanche (a família) e onde ele também é adicional. */
export type MotivoDoRever = { ingrediente: string; familia: string[]; adicionalEm: string[] };

/** Onde cada ingrediente das fichas entra: os produtos cuja ficha o leva e os de que é adicional (o mesmo da gaveta). */
export function ondeCadaIngredienteEntra(base: Base | null): OndeOIngredienteEntra {
  return Object.fromEntries(
    ingredientesDaBase(base).map((i) => [
      i.nome,
      {
        fichas: [...new Set(i.produtos.filter((p) => !p.adicional).map((p) => p.produto))],
        adicional: [...new Set(i.produtos.filter((p) => p.adicional).map((p) => p.produto))],
      },
    ]),
  );
}

/**
 * Os produtos que a bancada não separa (o Número e o Trio da mesma ficha), um grupo por família — como a TELA os diz:
 * sem nome repetido (nas fichas da loja-piloto, 3 de 24 famílias têm dois produtos "TRIO 08") e com o produto que tem o
 * nome da própria ficha na frente (o "Numero 08" da ficha "Numero 08"; na ordem da base, o Trio vinha antes em 19). A
 * sugestão diz o primeiro: "só vai no Numero 08 (e no TRIO 08…)". Sem produto com o nome da ficha, fica a ordem da base.
 */
export function familiasDoEstudo(estudo: Estudo, base: Base | null): string[][] {
  const fichaDe = new Map((base?.produtos ?? []).map((p) => [p.id, p.ficha?.nome ?? null]));
  const temONomeDaFicha = (x: { id: string; nome: string }) => {
    const ficha = fichaDe.get(x.id);
    return !!ficha && chaveDoIngrediente(ficha) === chaveDoIngrediente(x.nome);
  };
  return estudo.familias.map((f) => {
    const vistos = new Set<string>();
    const unicos = f.produtos.filter((x) => !vistos.has(chaveDoIngrediente(x.nome)) && vistos.add(chaveDoIngrediente(x.nome)));
    return [...unicos.filter(temONomeDaFicha), ...unicos.filter((x) => !temONomeDaFicha(x))].map((x) => x.nome);
  });
}

const ehPao = (nome: string) => chaveDoIngrediente(nome).startsWith('pao');

/**
 * O que quem conferiu confirmou — os mesmos nomes que a gaveta usa para a sugestão (`confirmados` em
 * `gaveta-do-lanche.tsx`): na conferência por foto, as marcas das fotos que davam para analisar; no lanche lido por
 * passos, o pão (o do começo das peças) e o nome de cada passo, com o pão contado uma vez só (o passo que é a tampa
 * chegando não soma outro pão — `vistosPorPasso`); na conferência por etapa de antes, o nome de cada etapa.
 */
export function confirmadosDaResposta(etapas: EtapaLida[], resposta: Conferencia): string[] {
  if (porFoto(resposta) || !etapas.some((e) => e.metade !== undefined)) return [...vistosDaConferencia(etapas, resposta).values()].map((v) => v.nome);
  const nomeDa = (i: number): string | null => {
    const r = resposta.etapas[i];
    if (!r) return null;
    if (r.v === 'certo') return etapas[i]!.candidatos[0] ?? null;
    return r.v === 'outro' ? r.nome?.trim() || null : null;
  };
  const nomes: string[] = [];
  const pao = etapas.map((e, i) => (e.tipo === 'comeco' ? nomeDa(i) : null)).find((n): n is string => !!n);
  if (pao) nomes.push(pao);
  etapas.forEach((e, i) => {
    if (e.tipo === 'comeco') return;
    const nome = nomeDa(i);
    if (!nome) return;
    if (ehPao(nome) && nomes.some(ehPao)) return;
    nomes.push(nome);
  });
  return nomes;
}

/** A sugestão que a gaveta mostraria para esta conferência, com as fichas de agora. */
export const sugestaoDaConferencia = (etapas: EtapaLida[], conferencia: Conferencia, onde: OndeOIngredienteEntra, familias: string[][]): SugestaoPeloIngrediente =>
  sugestaoPeloIngrediente(confirmadosDaResposta(etapas, conferencia), onde, familias);

/** A marca que a conferência leva: só com a resposta "Não era um lanche" e a sugestão de um lanche na tela. */
export function marcaDaSugestao(etapas: EtapaLida[], conferencia: Conferencia, onde: OndeOIngredienteEntra, familias: string[][]): SugestaoVista | null {
  if (conferencia.produto !== null) return null;
  const s = sugestaoDaConferencia(etapas, conferencia, onde, familias);
  return s.tipo === 'lanche' ? { lanche: s.familia[0]!, pelos: s.pelos.map((u) => u.ingrediente) } : null;
}

/** A resposta já tem a marca (quem conferiu decidiu vendo a sugestão)? */
export function temAMarca(resposta: unknown): boolean {
  const m = (resposta as { sugestaoVista?: unknown } | null)?.sugestaoVista;
  return typeof m === 'object' && m !== null;
}

/**
 * O lanche está para rever? Nulo = não. Entra o conferido sem produto ("Não era um lanche"), sem a marca, em que um
 * ingrediente confirmado só vai num lanche (a sugestão de um lanche só: a de "dois lanches diferentes" não escolhe, e
 * não entra). `adicionalEm` só quando todos os ingredientes que decidem são adicional em outro lugar (o aviso da gaveta).
 */
export function motivoParaRever(
  l: { situacao: string; produto: string | null; leitura: { etapas?: EtapaLida[] } | null; resposta: Conferencia | null },
  onde: OndeOIngredienteEntra,
  familias: string[][],
): MotivoDoRever | null {
  if (l.situacao !== 'conferido' || l.produto !== null || !l.resposta || temAMarca(l.resposta)) return null;
  const s = sugestaoDaConferencia(l.leitura?.etapas ?? [], l.resposta, onde, familias);
  if (s.tipo !== 'lanche') return null;
  return {
    ingrediente: s.pelos[0]!.ingrediente,
    familia: s.familia,
    adicionalEm: s.adicional ? [...new Set(s.pelos.flatMap((u) => u.adicionalEm))] : [],
  };
}
