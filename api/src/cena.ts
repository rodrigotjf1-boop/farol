// =====================================================================
// A cena do canal e o papel do quadro
// =====================================================================
// O contexto que vai junto com a pergunta feita a um modelo sobre um
// canal (A19, onda 1):
//
//   loja.tipo_negocio  que negócio é                       ("hamburgueria")
//   ponto.cena         o que a câmera vê e de onde olha    (quem configura escreve)
//   zona.papel         o que o quadro é                    (posto, cuba, montagem…)
//
// E o NÚMERO do quadro — "Quadro 2" —, que aparece na tela e no mapa do
// canal que o agente desenha. Ele não é guardado: é a posição do quadro
// entre os quadros do canal. A conta mora aqui, em SQL, num lugar só: o
// console e o agente recebem o número pronto e não o refazem (duas contas
// em duas linguagens divergem na primeira correção).
// =====================================================================

/** O que um quadro pode ser. A mesma lista do CHECK da migration 030 e de `contratos/cena-do-canal.json`. */
export const PAPEIS = [
  'posto', 'cuba', 'montagem', 'equipamento', 'impressora', 'caixa', 'pia', 'piso', 'livre',
] as const;

export const MAX_CENA = 2000;
export const MAX_TIPO_DE_NEGOCIO = 80;
export const MAX_ORDEM = 99;

/**
 * O número do quadro, para uma consulta em `zona z` já filtrada por
 * `z.excluida_em is null`.
 *
 * A área que cobre o quadro inteiro é a IMAGEM COMPLETA do canal: não é
 * quadro e não tem número (nulo). As outras contam de 1 em diante, pela
 * `ordem` e, no empate, pela data de criação.
 */
export const SQL_NUMERO_DO_QUADRO = `
  case when z.poligono = '[[0,0],[1,0],[1,1],[0,1]]'::jsonb then null
       else (count(*) filter (where z.poligono <> '[[0,0],[1,0],[1,1],[0,1]]'::jsonb)
               over (partition by z.ponto_id
                     order by z.ordem, z.criado_em, z.id
                     rows between unbounded preceding and current row))::int
  end`;

type Lido<T> = { valor: T; problema?: undefined } | { valor?: undefined; problema: string };

/** A cena, como a pessoa escreveu: aparada, com as quebras de linha dela. Vazia apaga. */
export function lerCena(bruto: unknown): Lido<string> {
  if (typeof bruto !== 'string') return { problema: 'cena: escreva um texto' };
  const texto = bruto.replace(/\r\n?/g, '\n').trim();
  if (texto.length > MAX_CENA) {
    return { problema: `a cena tem no máximo ${MAX_CENA} caracteres (veio com ${texto.length})` };
  }
  return { valor: texto };
}

/** O tipo de negócio: uma linha só. Vazio apaga. */
export function lerTipoDeNegocio(bruto: unknown): Lido<string> {
  if (typeof bruto !== 'string') return { problema: 'tipoNegocio: escreva um texto' };
  const texto = bruto.split(/\s+/).filter(Boolean).join(' ');
  if (texto.length > MAX_TIPO_DE_NEGOCIO) {
    return { problema: `o tipo de negócio tem no máximo ${MAX_TIPO_DE_NEGOCIO} caracteres` };
  }
  return { valor: texto };
}

export function lerPapel(bruto: unknown): Lido<string> {
  if (typeof bruto !== 'string' || !(PAPEIS as readonly string[]).includes(bruto)) {
    return { problema: `papel: um de ${PAPEIS.join(', ')}` };
  }
  return { valor: bruto };
}

export function lerOrdem(bruto: unknown): Lido<number> {
  if (typeof bruto !== 'number' || !Number.isInteger(bruto) || bruto < 0 || bruto > MAX_ORDEM) {
    return { problema: `ordem: um número inteiro de 0 a ${MAX_ORDEM}` };
  }
  return { valor: bruto };
}
