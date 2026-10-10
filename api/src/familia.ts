// =====================================================================
// A família do critério — o que ele pergunta
// =====================================================================
// O plano A19 troca os cinco tipos de hoje por quatro famílias:
//
//   estado         como está?                 um quadro, o melhor
//   acontecimento  aconteceu? alguém fez?     uma sequência curta de quadros
//   processo       foi feito como manda?      etapas ao longo do tempo
//   medida         quanto? por quanto tempo?  conta ou cronometra
//
// Presença, contagem e comparação com a foto padrão continuam: são formas
// de conferir um Estado. O `tipo` segue dizendo COMO o critério é julgado
// — é por ele que o agente escolhe o juiz —, e a família diz o que o
// critério pergunta.
//
// **Hoje só a família Estado tem juiz.** As outras três chegam com a
// sequência (onda 2) e com a leitura da bancada. Até lá o critério delas só
// OBSERVA: conta as olhadas, o contexto e o gatilho, sem julgar — é o que
// mostra quantas vezes por dia a coisa acontece antes de existir quem
// julgue. No banco elas são carregadas pelo tipo `acao` (o de texto livre),
// que o agente já conhece: nada novo desce para a loja.
//
// O critério que não diz a sua família tem a NATURAL do tipo: `acao` é
// acontecimento, os outros quatro são estado (migration 035).
// =====================================================================

export const FAMILIAS = ['estado', 'acontecimento', 'processo', 'medida'] as const;
export type Familia = (typeof FAMILIAS)[number];

/** O tipo que carrega as famílias que ainda não têm juiz. */
export const TIPO_QUE_CARREGA = 'acao';

/** A família de um critério que não diz a sua. */
export const familiaNatural = (tipo: string): Familia => (tipo === TIPO_QUE_CARREGA ? 'acontecimento' : 'estado');

/** As famílias que têm juiz hoje. As outras só observam. */
export const FAMILIAS_QUE_JULGAM: readonly string[] = ['estado'];

/** Quando chega o julgamento de cada família que hoje só observa — a frase que a tela mostra. */
export const QUANDO_CHEGA_O_JULGAMENTO: Readonly<Record<string, string>> = {
  acontecimento: 'chega com a sequência',
  processo: 'chega depois da sequência',
  medida: 'chega depois da sequência',
};

/**
 * A família de uma linha de `regra`, em SQL: a guardada ou, na falta, a
 * natural do tipo. `alias` é o apelido da tabela na consulta ('' quando
 * não há — o `returning` de um `insert`).
 */
export function sqlFamilia(alias = 'r'): string {
  const p = alias ? `${alias}.` : '';
  return `coalesce(${p}familia, case when ${p}tipo = '${TIPO_QUE_CARREGA}' then 'acontecimento' else 'estado' end)`;
}

/**
 * A família pedida cabe naquele tipo? Devolve a frase do problema, ou
 * `null`. É a mesma regra do banco (`regra_familia_cabe_no_tipo`).
 */
export function familiaNaoCabe(familia: unknown, tipo: string): string | null {
  if (familia == null) return null;
  if (typeof familia !== 'string' || !(FAMILIAS as readonly string[]).includes(familia)) {
    return `familia: um de ${FAMILIAS.join(', ')}`;
  }
  if (familia === 'estado') {
    return tipo === TIPO_QUE_CARREGA
      ? 'familia: um critério de estado é conferido pelo texto, pela foto padrão, por presença ou por contagem'
      : null;
  }
  return tipo === TIPO_QUE_CARREGA
    ? null
    : `familia: "${familia}" ainda não tem juiz e é guardada com o tipo "${TIPO_QUE_CARREGA}"`;
}

/**
 * Um critério desta família pode ser julgado (ensaio em diante)? Devolve a
 * recusa, ou `null`.
 *
 * Só a transição é recusada: o critério de ação que JÁ estava em ensaio ou
 * valendo antes das famílias continua como está — quem não muda de estado
 * não passa por aqui.
 */
export function familiaSoObserva(familia: string): { erro: string; mensagem: string } | null {
  if (FAMILIAS_QUE_JULGAM.includes(familia)) return null;
  return {
    erro: 'familia_so_observa',
    mensagem:
      `o julgamento de um critério de ${familia} ${QUANDO_CHEGA_O_JULGAMENTO[familia] ?? 'ainda não existe'}. ` +
      'Até lá ele só observa: conta o contexto e o gatilho, sem julgar.',
  };
}
