// =====================================================================
// A sugestão pelo ingrediente que só um lanche tem — a cópia da API
// =====================================================================
// A MESMA regra do console (`web/componentes/treino/sugestao-pelo-ingrediente.ts`,
// o protótipo aprovado pelo dono em 06/11/2026), aqui para a fila "para rever"
// (`para-rever.ts`): a nuvem diz quais conferidos "não era um lanche" têm um
// ingrediente confirmado que só vai num lanche, e a gaveta mostra a sugestão
// pela cópia dela. As duas cópias passam pelos mesmos casos em
// `api/testes/sugestao-pelo-ingrediente.test.ts` (como a regra da planta) —
// mudou aqui, muda lá.
//
// A regra, sobre o que QUEM CONFERE confirmou:
//   • o ingrediente que está na ficha de UMA família só (o Número e o Trio da
//     mesma ficha são um lanche para a bancada) sugere esse lanche;
//   • se ele também é adicional de outros produtos, a sugestão vem com o aviso
//     "pode ser adicional" — o adicional é a exceção, não cala a regra;
//   • dois ingredientes únicos de lanches diferentes: vale o que NÃO é adicional
//     em lugar nenhum, quando só um não é; senão, não escolhe.
// =====================================================================

import { chaveDoIngrediente } from './ingredientes.js';

export type OndeOIngredienteEntra = Record<string, { fichas: string[]; adicional: string[] }>;

/** Um ingrediente confirmado que só uma família tem. */
export type IngredienteUnico = {
  /** O nome como está nas fichas. */
  ingrediente: string;
  /** Os produtos da família (o primeiro é o que a sugestão diz). */
  familia: string[];
  /** Os produtos FORA da família de que ele é adicional (o cliente pode pedir). Vazio = só na ficha dela. */
  adicionalEm: string[];
};

export type SugestaoPeloIngrediente =
  | { tipo: 'nenhuma' }
  | { tipo: 'lanche'; familia: string[]; pelos: IngredienteUnico[]; adicional: boolean; deixados: IngredienteUnico[] }
  | { tipo: 'varios'; opcoes: IngredienteUnico[] };

/** O ingrediente (pelo nome confirmado) está na ficha de uma família só? */
export function ingredienteUnico(nome: string, onde: OndeOIngredienteEntra, familias: string[][]): IngredienteUnico | null {
  const k = chaveDoIngrediente(nome);
  const nomeDasFichas = Object.keys(onde).find((n) => chaveDoIngrediente(n) === k);
  if (!nomeDasFichas) return null;
  const { fichas, adicional } = onde[nomeDasFichas]!;
  const familiaDe = (produto: string) => familias.findIndex((f) => f.some((x) => chaveDoIngrediente(x) === chaveDoIngrediente(produto)));
  const daFicha = [...new Set(fichas.map(familiaDe).filter((i) => i >= 0))];
  if (daFicha.length !== 1) return null;
  return { ingrediente: nomeDasFichas, familia: familias[daFicha[0]!]!, adicionalEm: [...new Set(adicional)] };
}

/** A sugestão para os ingredientes que quem confere confirmou. */
export function sugestaoPeloIngrediente(confirmados: string[], onde: OndeOIngredienteEntra, familias: string[][]): SugestaoPeloIngrediente {
  const vistos = new Set<string>();
  const unicos: IngredienteUnico[] = [];
  for (const nome of confirmados) {
    const u = ingredienteUnico(nome, onde, familias);
    if (!u || vistos.has(chaveDoIngrediente(u.ingrediente))) continue;
    vistos.add(chaveDoIngrediente(u.ingrediente));
    unicos.push(u);
  }
  if (unicos.length === 0) return { tipo: 'nenhuma' };
  const chaveDaFamilia = (u: IngredienteUnico) => u.familia.map(chaveDoIngrediente).join('|');
  const porFamilia = new Map<string, IngredienteUnico[]>();
  for (const u of unicos) porFamilia.set(chaveDaFamilia(u), [...(porFamilia.get(chaveDaFamilia(u)) ?? []), u]);
  const lanche = (pelos: IngredienteUnico[], deixados: IngredienteUnico[]): SugestaoPeloIngrediente => ({
    tipo: 'lanche',
    familia: pelos[0]!.familia,
    pelos,
    adicional: pelos.every((u) => u.adicionalEm.length > 0),
    deixados,
  });
  if (porFamilia.size === 1) return lanche(unicos, []);
  const exclusivos = [...porFamilia.values()].filter((us) => us.some((u) => u.adicionalEm.length === 0));
  if (exclusivos.length === 1) {
    const pelos = exclusivos[0]!;
    return lanche(pelos, unicos.filter((u) => !pelos.includes(u)));
  }
  return { tipo: 'varios', opcoes: unicos };
}
