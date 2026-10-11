// =====================================================================
// Qual loja daqui é qual loja de lá — a sugestão
// =====================================================================
// Quando a diretoria volta do outro sistema com as lojas autorizadas, a
// tela pergunta qual loja do Farol é cada uma. Isto adianta a resposta
// pelo NOME — e só adianta: quem decide é a pessoa, que confere antes de
// salvar.
//
// A regra é a mais conservadora que serve: sugerir só quando não há
// dúvida. Sugestão errada que passa despercebida liga as fichas de uma
// loja à cozinha de outra; nenhuma sugestão custa um clique.
// =====================================================================

export type Nomeada = { id: string; nome: string };

// Palavras que toda loja tem no nome e que não distinguem nenhuma.
const NAO_DISTINGUEM = new Set(['loja', 'lojas', 'unidade', 'filial', 'de', 'do', 'da', 'dos', 'das', 'e']);

/** As palavras que distinguem um nome: sem acento, sem caixa, sem pontuação, sem repetir. */
export function palavras(nome: string): string[] {
  const limpo = String(nome ?? '')
    .normalize('NFD')
    // Decomposto, o acento vira uma marca à parte (categoria M): sai a marca, fica a letra.
    .replace(/\p{M}/gu, '')
    .toLowerCase();
  return [...new Set(limpo.split(/[^a-z0-9]+/).filter((p) => p.length >= 2 && !NAO_DISTINGUEM.has(p)))];
}

function emComum(a: string[], b: string[]): number {
  const deB = new Set(b);
  return a.filter((p) => deB.has(p)).length;
}

/**
 * Para cada loja de lá, a loja daqui sugerida — ou `null`.
 *
 *   • uma de cada lado: é ela (o caso da conta de uma loja só);
 *   • senão, a loja daqui com mais palavras do nome em comum, desde que
 *     seja a ÚNICA no topo e que nenhuma outra loja de lá a dispute com a
 *     mesma força. Empate, de qualquer lado, é dúvida: não sugere.
 *
 * `daqui` são só as lojas LIVRES — a que já tem par não entra.
 */
export function sugerirPares(deLa: Nomeada[], daqui: Nomeada[]): Map<string, string | null> {
  const sugestao = new Map<string, string | null>(deLa.map((l) => [l.id, null]));
  if (deLa.length === 0 || daqui.length === 0) return sugestao;
  if (deLa.length === 1 && daqui.length === 1) {
    sugestao.set(deLa[0]!.id, daqui[0]!.id);
    return sugestao;
  }

  const palavrasDaqui = daqui.map((l) => ({ id: l.id, p: palavras(l.nome) }));
  // A melhor loja daqui para cada loja de lá, com a força da escolha.
  const escolha = new Map<string, { daqui: string; forca: number }>();
  for (const l of deLa) {
    const p = palavras(l.nome);
    let melhor: { daqui: string; forca: number } | null = null;
    let empate = false;
    for (const d of palavrasDaqui) {
      const forca = emComum(p, d.p);
      if (forca === 0) continue;
      if (!melhor || forca > melhor.forca) {
        melhor = { daqui: d.id, forca };
        empate = false;
      } else if (forca === melhor.forca) {
        empate = true;
      }
    }
    if (melhor && !empate) escolha.set(l.id, melhor);
  }

  // Duas lojas de lá querendo a mesma loja daqui: leva a de escolha mais
  // forte; com a mesma força, nenhuma.
  for (const [deLaId, e] of escolha) {
    const rivais = [...escolha].filter(([outra, o]) => outra !== deLaId && o.daqui === e.daqui);
    if (rivais.every(([, o]) => o.forca < e.forca)) sugestao.set(deLaId, e.daqui);
  }
  return sugestao;
}
