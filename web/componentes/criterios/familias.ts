// As quatro famílias de critério — o que cada um PERGUNTA — e as formas de
// conferir um Estado, que são os tipos de hoje.
//
// É a mesma regra do servidor (`api/src/familia.ts`): só a família Estado
// tem juiz; as outras três só observam — contam o contexto e o gatilho, sem
// julgar — e são guardadas com o tipo de texto livre (`acao`).

import { Hash, Layers, ScanSearch, UserRoundCheck, type LucideIcon } from 'lucide-react';

import type { Familia, Regra } from '@/lib/api';

type Tipo = Regra['tipo'];

export const FAMILIAS: ReadonlyArray<{
  valor: Familia;
  titulo: string;
  /** A pergunta que a família faz, e com o que ela responde. */
  pergunta: string;
  como: string;
  /** Quando chega o julgamento dela. Nulo = já tem juiz. */
  chega: string | null;
}> = [
  { valor: 'estado', titulo: 'Estado', pergunta: 'Como está?', como: 'Um quadro, o melhor.', chega: null },
  { valor: 'acontecimento', titulo: 'Acontecimento', pergunta: 'Aconteceu? Alguém fez?', como: 'Uma sequência curta de quadros.', chega: 'chega com a sequência' },
  { valor: 'processo', titulo: 'Processo', pergunta: 'Foi feito como manda?', como: 'Etapas ao longo do tempo.', chega: 'chega depois da sequência' },
  { valor: 'medida', titulo: 'Medida', pergunta: 'Quanto? Por quanto tempo?', como: 'Conta ou cronometra. Devolve número.', chega: 'chega depois da sequência' },
];

const DA_FAMILIA = new Map(FAMILIAS.map((f) => [f.valor, f]));

export const nomeDaFamilia = (f: string): string => DA_FAMILIA.get(f as Familia)?.titulo.toLowerCase() ?? f;

/** Quando chega o julgamento desta família — ou `null`, se ela já é julgada. */
export const quandoChegaOJulgamento = (f: string): string | null => DA_FAMILIA.get(f as Familia)?.chega ?? null;

/** A família ainda não tem juiz: o critério dela só observa. */
export const familiaSoObserva = (f: string): boolean => quandoChegaOJulgamento(f) !== null;

/** A família de um critério que não diz a sua (resposta de API antiga). */
export const familiaNatural = (tipo: string): Familia => (tipo === 'acao' ? 'acontecimento' : 'estado');

/** O tipo com que cada família é guardada. Num Estado, quem escolhe é a forma de conferir. */
export const TIPO_QUE_CARREGA: Tipo = 'acao';

/**
 * As formas de conferir um Estado — os tipos de hoje. Presença e contagem
 * são julgadas dentro da loja, pelo detector; comparação, contra a foto
 * padrão do canal; "pelo que se vê", pelo texto.
 */
export const FORMAS_DE_ESTADO: ReadonlyArray<{ valor: Tipo; titulo: string; ajuda: string; icone: LucideIcon }> = [
  { valor: 'estado', titulo: 'Pelo que se vê', ajuda: 'limpeza, organização, uso de touca e luva', icone: ScanSearch },
  { valor: 'comparacao', titulo: 'Contra a foto padrão', ajuda: 'compara com a foto padrão do canal', icone: Layers },
  { valor: 'presenca', titulo: 'Presença', ajuda: 'tem alguém, ou algo, no lugar', icone: UserRoundCheck },
  { valor: 'contagem', titulo: 'Contagem', ajuda: 'quantas pessoas, fila, ocupação', icone: Hash },
];

const E_FORMA_DE_ESTADO = new Set<string>(FORMAS_DE_ESTADO.map((f) => f.valor));

/**
 * O tipo que vai com a família escolhida. Num Estado, mantém a forma de
 * conferir que já estava; vindo de outra família, começa por "pelo que se vê".
 */
export function tipoDaFamilia(familia: Familia, tipoAtual: Tipo): Tipo {
  if (familia !== 'estado') return TIPO_QUE_CARREGA;
  return E_FORMA_DE_ESTADO.has(tipoAtual) ? tipoAtual : 'estado';
}

/** A forma de conferir, numa palavra, para a linha do critério: "pelo que se vê", "presença"… */
export const nomeDaForma = (tipo: string): string | null =>
  FORMAS_DE_ESTADO.find((f) => f.valor === tipo)?.titulo.toLowerCase() ?? null;

/**
 * O que o critério pergunta, numa palavra, para a linha dele nas listas: a
 * família — ou, num Estado, a forma de conferir ("presença", "contra a foto
 * padrão"). Resposta de API antiga não traz a família: vale a natural do tipo.
 */
export function oQuePergunta(k: { tipo: string; familia?: string }): string {
  const familia = k.familia ?? familiaNatural(k.tipo);
  if (familia !== 'estado') return nomeDaFamilia(familia);
  return k.tipo === 'estado' ? 'estado' : (nomeDaForma(k.tipo) ?? k.tipo);
}
