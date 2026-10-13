// =====================================================================
// As plataformas de IA que o balcão conhece
// =====================================================================
// O balcão pergunta com a conta DA LOJA (decisão do dono, 13/10/2026: "só
// a conta do lojista, com a chave dele guardada cifrada no nosso
// servidor"). Cada loja diz de que plataforma é a conta dela.
//
// **Nada fora desta pasta presume uma plataforma** — nem o nome, nem o
// jeito da chave, nem preço, nem formato de erro. Plataforma nova entra
// aqui (e na lista da migration que guarda a conta), e o resto do servidor
// não muda.
//
// Aqui fica só o que o CADASTRO precisa: quais existem e como é a cara de
// uma chave de cada uma — para recusar, na hora de guardar, o que
// claramente não é chave (o exemplo da documentação, a chave de outra
// plataforma, um texto colado pela metade). Se a chave VALE, só a
// plataforma sabe dizer.
// =====================================================================

export type Plataforma = {
  /** Como a plataforma aparece para quem cadastra. */
  nome: string;
  /** O texto tem a cara de uma chave desta plataforma? Não diz se ela vale. */
  pareceChave(texto: string): boolean;
};

export const PLATAFORMAS: Record<string, Plataforma> = {
  anthropic: {
    nome: 'Anthropic',
    pareceChave: (texto) => /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(texto),
  },
};

export const provedores = (): string[] => Object.keys(PLATAFORMAS);

/** O tamanho que uma chave pode ter, de qualquer plataforma. */
export const CHAVE_MIN = 20;
export const CHAVE_MAX = 512;

/**
 * Lê a chave que veio no cadastro. `problema` nunca repete o que foi
 * mandado: mensagem de erro vai para registro e para a tela de quem chamou.
 */
export function lerChaveDaConta(provedor: unknown, chave: unknown): { provedor: string; chave: string } | { problema: string } {
  if (typeof provedor !== 'string' || !Object.hasOwn(PLATAFORMAS, provedor)) {
    return { problema: `provedor: um de ${provedores().join(', ')}` };
  }
  if (typeof chave !== 'string') return { problema: 'chave: texto' };
  if (/\s/.test(chave)) return { problema: 'chave: sem espaço nem quebra de linha' };
  if (chave.length < CHAVE_MIN || chave.length > CHAVE_MAX) {
    return { problema: `chave: de ${CHAVE_MIN} a ${CHAVE_MAX} caracteres` };
  }
  if (!PLATAFORMAS[provedor]!.pareceChave(chave)) {
    return { problema: `chave: não tem a cara de uma chave da ${PLATAFORMAS[provedor]!.nome}` };
  }
  return { provedor, chave };
}
