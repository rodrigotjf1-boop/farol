// =====================================================================
// A chave do ingrediente: o mesmo ingrediente escrito de jeitos diferentes
// =====================================================================
// A MESMA regra da API (`api/src/ingredientes.ts` — mudou lá, muda aqui).
// Sem maiúscula e sem acento, sem as palavras que só ligam, no singular, o
// peso junto do número: "Pão de Brioche" = "Pão Brioche" (o dono,
// 19/10/2026). Num arquivo só dela, sem tela: quem compara nomes (as fichas,
// o treinamento, a conferência) usa a mesma, e ela se testa fora do Next.
// =====================================================================

/** As palavras que só ligam as partes do nome, e o plural que não é só tirar o "s" — os da API. */
const LIGACAO = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'com', 'c', 'a', 'o', 'as', 'os']);
const PLURAL_IRREGULAR: Record<string, string> = { paes: 'pao', aneis: 'anel', graos: 'grao', limoes: 'limao', mamoes: 'mamao' };

export function chaveDoIngrediente(nome: string): string {
  const simples = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const comPeso = simples.replace(/(\d+(?:[.,]\d+)?)\s*(gramas?|grs?|g)(?![a-z])/g, (_, n: string) => `${n.replace(',', '.')}g`);
  const palavras = comPeso
    .split(/[^a-z0-9.]+/)
    .map((p) => p.replace(/^\.+|\.+$/g, ''))
    .filter((p) => p && !LIGACAO.has(p))
    .map((p) => PLURAL_IRREGULAR[p] ?? (p.length > 3 && p.endsWith('s') && !/\d/.test(p) ? p.slice(0, -1) : p));
  return palavras.length ? palavras.join(' ') : nome.trim().toLowerCase();
}
