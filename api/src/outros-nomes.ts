// =====================================================================
// O outro nome de um ingrediente das fichas (migration 053)
// =====================================================================
// Do protótipo aprovado pelo dono em 19/10/2026: o "nome fora das fichas"
// — escrito à mão na conferência — ganha, na aba Sugestões, a resposta "É
// um ingrediente das fichas". O nome escrito vira um OUTRO NOME do
// ingrediente escolhido, e quem lê o conta como ele:
//
//   • as conferências (as sugestões, o aprendizado, os exemplos de uma
//     conferência nova) trocam o outro nome pelo ingrediente das fichas;
//   • os exemplos guardados com o outro nome antes da resposta são somados
//     aos do ingrediente pela lista e pela base que desce para a loja — a
//     mesma regra do nome parecido (#190), com a chave do ingrediente;
//   • a gaveta da conferência recebe os outros nomes e diz "é o 'Blend da
//     casa' das fichas" a quem escrever o outro nome de novo.
//
// A conferência guardada continua como a pessoa escreveu: a troca é de quem
// lê, e não apaga o que foi dito.
// =====================================================================

import type pg from 'pg';

import { chaveDoIngrediente } from './ingredientes.js';
import { porFoto, type Conferencia } from './treino.js';

/** A chave do outro nome → o ingrediente das fichas a que ele foi juntado. */
export type OutrosNomes = Map<string, string>;

export async function outrosNomesDaLoja(banco: pg.Pool | pg.PoolClient, lojaId: string): Promise<OutrosNomes> {
  const { rows } = await banco.query<{ chave: string; ingrediente: string }>(
    'select chave, ingrediente from ingrediente_outro_nome where loja_id = $1',
    [lojaId],
  );
  return new Map(rows.map((r) => [r.chave, r.ingrediente]));
}

/** O nome como ele conta: o outro nome vira o ingrediente das fichas; o resto fica como está. */
export function nomeQueConta(nome: string, outros: OutrosNomes): string {
  return outros.get(chaveDoIngrediente(nome)) ?? nome;
}

/** A chave como ela conta: a do ingrediente das fichas, quando o nome é um outro nome dele. */
export function chaveQueConta(nome: string, outros: OutrosNomes): string {
  return chaveDoIngrediente(nomeQueConta(nome, outros));
}

/**
 * A conferência com cada outro nome trocado pelo ingrediente das fichas — nas marcas das fotos (ou das etapas, na de
 * antes), no que faltou e no que veio a mais. Na mesma foto, o ingrediente que ficou duas vezes conta uma.
 */
export function conferenciaQueConta(c: Conferencia, outros: OutrosNomes): Conferencia {
  if (outros.size === 0) return c;
  const n = (nome: string) => nomeQueConta(nome, outros);
  const semRepetir = (nomes: string[]) => nomes.filter((x, i) => nomes.findIndex((y) => chaveDoIngrediente(y) === chaveDoIngrediente(x)) === i);
  const chaves = <T>(r: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(r).map(([k, v]) => [n(k), v]));
  if (porFoto(c)) return { ...c, fotos: c.fotos.map((f) => ({ ...f, marcados: semRepetir(f.marcados.map(n)) })), faltas: chaves(c.faltas), aMais: chaves(c.aMais) };
  return { ...c, etapas: c.etapas.map((e) => (e?.nome ? { ...e, nome: n(e.nome) } : e)), faltas: chaves(c.faltas), aMais: chaves(c.aMais) };
}
