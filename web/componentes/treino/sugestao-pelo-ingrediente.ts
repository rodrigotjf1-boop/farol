// =====================================================================
// A sugestão pelo ingrediente que só um lanche tem
// =====================================================================
// O protótipo "Sugestão pelo ingrediente", aprovado pelo dono em 06/11/2026,
// com o detalhe dele do mesmo dia: "o anel de cebola só vai no Número 08,
// porém é um item que está como adicional em alguns produtos — casos raros
// podem ser adicionados em outras fichas; quando tiver KDS vai ter o aviso,
// porém é uma exceção à regra".
//
// A regra, sobre o que QUEM CONFERE confirmou (o "certo", o "era outro", a
// marca da foto):
//   • o ingrediente que está na ficha de UMA família só (o Número e o Trio da
//     mesma ficha são um lanche para a bancada) sugere esse lanche;
//   • se ele também é adicional de outros produtos, a sugestão vem com o aviso
//     "pode ser adicional" — o adicional é a exceção, não cala a regra;
//   • dois ingredientes únicos de lanches diferentes: vale o que NÃO é adicional
//     em lugar nenhum, quando só um não é (o outro foi pedido do cliente); senão,
//     a tela mostra os dois e não escolhe.
// Medido em 06/11/2026 nos 63 conferidos com produto, com o que a pessoa
// marcou: sugere em 38 e acerta os 38 (17 com o aviso de adicional).
//
// A sugestão só ESCOLHE o lanche (quem confere ainda salva). Os dados vêm da
// API (`GET /v1/treino/lanches/:id`): `lanchesDoIngrediente` (as fichas e os
// adicionais de cada ingrediente) e `familias` (os produtos de mesma ficha).
// =====================================================================

import { chaveDoIngrediente } from '../fichas/chave-do-ingrediente';

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
  /** Um lanche: `pelos` os únicos dele; `adicional` = todos eles são adicional em outro lugar (o aviso);
   * `deixados` = únicos de OUTROS lanches que ficaram de fora por serem adicional (o desempate). */
  | { tipo: 'lanche'; familia: string[]; pelos: IngredienteUnico[]; adicional: boolean; deixados: IngredienteUnico[] }
  /** Únicos de lanches diferentes, e mais de um deles não é adicional: a tela mostra, não escolhe. */
  | { tipo: 'varios'; opcoes: IngredienteUnico[] };

/** O ingrediente (pelo nome confirmado) está na ficha de uma família só? */
export function ingredienteUnico(nome: string, onde: OndeOIngredienteEntra, familias: string[][]): IngredienteUnico | null {
  const k = chaveDoIngrediente(nome);
  const nomeDasFichas = Object.keys(onde).find((n) => chaveDoIngrediente(n) === k);
  if (!nomeDasFichas) return null;
  const { fichas, adicional } = onde[nomeDasFichas]!;
  // a família de cada produto (o produto que não é de cozinha não tem família: não está na bancada)
  const familiaDe = (produto: string) => familias.findIndex((f) => f.some((x) => chaveDoIngrediente(x) === chaveDoIngrediente(produto)));
  const daFicha = [...new Set(fichas.map(familiaDe).filter((i) => i >= 0))];
  if (daFicha.length !== 1) return null;
  // o adicional é sempre de FORA da família: os produtos dela têm a mesma ficha, e o que está na ficha de um produto não
  // é listado como adicional dele (`ingredientesDaBase`: "vale a ficha")
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
    // o aviso só quando NENHUM dos únicos dele é exclusivo: um único que não é adicional em lugar nenhum já basta
    adicional: pelos.every((u) => u.adicionalEm.length > 0),
    deixados,
  });
  if (porFamilia.size === 1) return lanche(unicos, []);
  // o desempate: o lanche cujo único NÃO é adicional em lugar nenhum, quando só um tem um desses
  const exclusivos = [...porFamilia.values()].filter((us) => us.some((u) => u.adicionalEm.length === 0));
  if (exclusivos.length === 1) {
    const pelos = exclusivos[0]!;
    return lanche(pelos, unicos.filter((u) => !pelos.includes(u)));
  }
  return { tipo: 'varios', opcoes: unicos };
}

/** "Numero 08 (e no TRIO 08)": o lanche e os outros produtos da mesma ficha. */
export function nomeDaFamilia(familia: string[]): string {
  const [principal, ...outros] = familia;
  return outros.length ? `${principal} (e no ${outros.join(', no ')}, que ${outros.length > 1 ? 'têm' : 'tem'} a mesma ficha)` : principal!;
}
