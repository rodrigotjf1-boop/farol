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
 * Os tipos de critério que dependem de ENTENDER a imagem — os que podem ir
 * a um modelo de fora. Com o pedido com contexto ligado, eles não são
 * analisados em canal sem a cena escrita (na comparação, só o que não deu
 * "igual à foto padrão" fica sem resposta). Presença e contagem são do
 * detector da loja: não dependem da cena.
 *
 * Uma lista só, para a distribuição (que se recusa a ligar a chave no
 * escuro) e para a tela do canal (que diz "falta descrever a cena").
 */
export const TIPOS_QUE_DEPENDEM_DA_CENA: readonly string[] = ['estado', 'acao', 'comparacao'];

/**
 * A imagem completa do canal: a área PRINCIPAL dele. É sempre o canal
 * inteiro, com este nome, sem papel — a regra está no banco
 * (`zona_principal_e_a_imagem_completa`, migration 034) e nas rotas de área,
 * que recusam redesenhá-la, renomeá-la ou excluí-la. Os critérios postos nela
 * são os critérios gerais do canal; as outras áreas são os quadros.
 */
export const NOME_DA_IMAGEM_COMPLETA = 'Imagem completa';
export const POLIGONO_DA_IMAGEM_COMPLETA: readonly (readonly [number, number])[] = [[0, 0], [1, 0], [1, 1], [0, 1]];

/** O desenho é exatamente o canal inteiro, ponto a ponto? */
export function ehAImagemInteira(poligono: unknown): boolean {
  return (
    Array.isArray(poligono) &&
    poligono.length === POLIGONO_DA_IMAGEM_COMPLETA.length &&
    poligono.every(
      (p, i) =>
        Array.isArray(p) &&
        p.length === 2 &&
        p[0] === POLIGONO_DA_IMAGEM_COMPLETA[i]![0] &&
        p[1] === POLIGONO_DA_IMAGEM_COMPLETA[i]![1],
    )
  );
}

/**
 * O número do quadro, para uma consulta em `zona z` já filtrada por
 * `z.excluida_em is null`.
 *
 * A imagem completa (a área principal) não é quadro e não tem número
 * (nulo). As outras contam de 1 em diante, pela `ordem` e, no empate, pela
 * data de criação. Quem decide é `principal`, não o desenho: um quadro
 * esticado até cobrir a imagem toda continua sendo quadro, com número.
 */
export const SQL_NUMERO_DO_QUADRO = `
  case when z.principal then null
       else (count(*) filter (where not z.principal)
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
