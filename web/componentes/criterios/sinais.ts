// Os sinais do estudo do critério — o que a loja confere SOZINHA, de graça,
// antes de julgar — com as palavras da tela.
//
// As listas são as de `contratos/estudo-do-criterio.json` (e de
// `api/src/estudo.ts`, que recusa o que não cabe). Aqui só mora o texto.

import type { Condicao, OndeDaCondicao, ParteDoEstudo } from '@/lib/api';

/** De onde a loja tira cada sinal. */
export type Fonte = 'pessoa' | 'movimento' | 'padrao' | 'relogio';

export const NOME_DA_FONTE: Record<Fonte, string> = {
  pessoa: 'o detector de pessoas da loja',
  movimento: 'o que mudou desde a olhada anterior',
  padrao: 'a foto padrão do canal',
  relogio: 'o relógio',
};

type Sinal = { valor: string; rotulo: string; fonte: Fonte };

/** O que precisa estar acontecendo: TODAS as condições têm de valer. */
export const SINAIS_DE_CONTEXTO: ReadonlyArray<Sinal> = [
  { valor: 'pessoa', rotulo: 'há alguém', fonte: 'pessoa' },
  { valor: 'sem_pessoa', rotulo: 'não há ninguém', fonte: 'pessoa' },
  { valor: 'movimento', rotulo: 'algo se mexe', fonte: 'movimento' },
  { valor: 'parado', rotulo: 'está tudo parado', fonte: 'movimento' },
  { valor: 'fora_do_padrao', rotulo: 'está diferente da foto padrão', fonte: 'padrao' },
  { valor: 'no_padrao', rotulo: 'está como na foto padrão', fonte: 'padrao' },
];

/** O que abre a análise: basta UM. */
export const SINAIS_DE_GATILHO: ReadonlyArray<Sinal> = [
  { valor: 'toda_olhada', rotulo: 'em toda olhada', fonte: 'relogio' },
  { valor: 'a_cada', rotulo: 'de tempos em tempos', fonte: 'relogio' },
  { valor: 'entrou', rotulo: 'alguém chegou', fonte: 'pessoa' },
  { valor: 'saiu', rotulo: 'o lugar ficou sem ninguém', fonte: 'pessoa' },
  { valor: 'mexeu', rotulo: 'algo começou a se mexer', fonte: 'movimento' },
  { valor: 'parou', rotulo: 'parou de se mexer', fonte: 'movimento' },
  { valor: 'saiu_do_padrao', rotulo: 'deixou de estar como na foto padrão', fonte: 'padrao' },
  { valor: 'voltou_ao_padrao', rotulo: 'voltou a ficar como na foto padrão', fonte: 'padrao' },
];

/** Os gatilhos que são do relógio, e não de um lugar. */
export const GATILHOS_SEM_LUGAR: ReadonlyArray<string> = ['toda_olhada', 'a_cada'];

/** Pares que nunca valem juntos no mesmo lugar: o critério nunca seria conferido. */
export const CONTRARIOS: ReadonlyArray<readonly [string, string]> = [
  ['pessoa', 'sem_pessoa'],
  ['movimento', 'parado'],
  ['fora_do_padrao', 'no_padrao'],
];

export const MAX_POR_LISTA = 6;
export const MINUTOS = { minimo: 1, maximo: 720 } as const;
export const MAX_TEXTO_DA_PARTE = 600;

const TODOS = new Map<string, Sinal>([...SINAIS_DE_CONTEXTO, ...SINAIS_DE_GATILHO].map((s) => [s.valor, s]));

export const fonteDoSinal = (sinal: string): Fonte | null => TODOS.get(sinal)?.fonte ?? null;

/** As seis partes do estudo, com a pergunta de cada uma. */
export const PARTES: ReadonlyArray<{ valor: ParteDoEstudo; titulo: string; pergunta: string; exemplo: string }> = [
  { valor: 'contexto', titulo: 'Contexto', pergunta: 'O que precisa estar acontecendo?', exemplo: 'Há carne na chapa e há colaborador no posto.' },
  { valor: 'gatilho', titulo: 'Gatilho', pergunta: 'O que abre a análise?', exemplo: 'Uma carne acabou de ser posta.' },
  { valor: 'janela', titulo: 'Janela', pergunta: 'Até quando observar?', exemplo: 'Até a carne ser virada ou tirada.' },
  { valor: 'acao', titulo: 'Ação', pergunta: 'O que se procura na janela?', exemplo: 'O gesto de salgar sobre a carne.' },
  { valor: 'desfecho', titulo: 'Desfecho', pergunta: 'Como termina?', exemplo: 'Salgou: dentro. A janela fechou sem salgar: fora. A mão tapou: não deu para ver.' },
  { valor: 'fora', titulo: 'Fora de contexto', pergunta: 'E quando o contexto não vale?', exemplo: 'Sem carne na chapa, ou sem ninguém no posto, não se julga.' },
];

/** Um lugar que uma condição pode olhar, já com o nome que a tela mostra. */
export type Lugar = { onde: OndeDaCondicao; zonaId?: string; rotulo: string; pontoId?: string };

/** O lugar de uma condição, numa chave: "aqui", "canal" ou "quadro:<id>". */
export const chaveDoLugar = (c: Pick<Condicao, 'onde' | 'zonaId'>): string =>
  c.onde === 'quadro' ? `quadro:${c.zonaId ?? ''}` : (c.onde ?? 'aqui');

/** A condição em palavras: "há alguém · neste lugar", "a cada 10 min". */
export function fraseDaCondicao(c: Condicao, lugares: ReadonlyArray<Lugar>): string {
  const sinal = TODOS.get(c.sinal);
  if (!sinal) return c.sinal; // sinal que a tela ainda não conhece: aparece como veio, em vez de sumir
  if (c.sinal === 'a_cada') return `a cada ${c.minutos ?? '?'} min`;
  if (GATILHOS_SEM_LUGAR.includes(c.sinal)) return sinal.rotulo;
  const lugar = lugares.find((l) => chaveDoLugar(l) === chaveDoLugar(c));
  // Quadro que saiu do canal (ou do critério): dito, em vez de escondido — na loja, a condição que não acha o quadro não segura nada.
  return `${sinal.rotulo} · ${lugar?.rotulo ?? 'num quadro que não existe mais'}`;
}

/**
 * O que impede salvar as condições, em uma frase — ou `null`. As mesmas
 * recusas do servidor (`lerContexto` e `lerGatilho`), ditas antes de enviar.
 */
export function problemaDasCondicoes(contexto: ReadonlyArray<Condicao>, gatilho: ReadonlyArray<Condicao>): string | null {
  const repetida = (lista: ReadonlyArray<Condicao>) =>
    lista.some((c, i) => lista.findIndex((o) => o.sinal === c.sinal && chaveDoLugar(o) === chaveDoLugar(c)) !== i);
  if (repetida(contexto)) return 'Há uma condição de contexto repetida.';
  if (repetida(gatilho)) return 'Há um gatilho repetido.';
  for (const [a, b] of CONTRARIOS) {
    for (const c of contexto.filter((o) => o.sinal === a)) {
      if (contexto.some((o) => o.sinal === b && chaveDoLugar(o) === chaveDoLugar(c))) {
        return 'O contexto pede uma coisa e o contrário dela no mesmo lugar: o critério nunca seria conferido.';
      }
    }
  }
  if (gatilho.length > 1 && gatilho.some((g) => g.sinal === 'toda_olhada')) {
    return '“Em toda olhada” já abre a análise sempre: tire os outros gatilhos, ou tire ele.';
  }
  for (const g of gatilho) {
    if (g.sinal !== 'a_cada') continue;
    const m = g.minutos;
    if (typeof m !== 'number' || !Number.isInteger(m) || m < MINUTOS.minimo || m > MINUTOS.maximo) {
      return `“De tempos em tempos”: diga de quantos em quantos minutos, de ${MINUTOS.minimo} a ${MINUTOS.maximo}.`;
    }
  }
  if (contexto.some((c) => c.onde === 'quadro' && !c.zonaId) || gatilho.some((g) => g.onde === 'quadro' && !g.zonaId)) {
    return 'Há uma condição sem o quadro escolhido.';
  }
  return null;
}

/**
 * Pontos de partida para o estudo — os "quando vale a pena conferir" de
 * antes, na forma nova, e os dois que o relógio e o movimento dão. Cada um
 * só preenche o contexto, o gatilho e os textos dessas duas partes e da
 * "fora de contexto": o resto é de quem conhece o critério.
 */
export const MODELOS_DE_ESTUDO: ReadonlyArray<{
  valor: string;
  titulo: string;
  ajuda: string;
  contexto: Condicao[];
  gatilho: Condicao[];
  partes: Partial<Record<ParteDoEstudo, string>>;
}> = [
  {
    valor: 'pessoa',
    titulo: 'Com alguém no lugar',
    ajuda: 'uniforme, touca, uso de equipamento',
    contexto: [{ sinal: 'pessoa', onde: 'aqui' }],
    gatilho: [],
    partes: {
      contexto: 'Há alguém neste lugar.',
      gatilho: 'Toda olhada em que o contexto vale.',
      fora: 'Sem ninguém no lugar não se julga, não se paga e não conta como análise.',
    },
  },
  {
    valor: 'livre',
    titulo: 'Com o lugar livre',
    ajuda: 'limpeza e organização: gente na frente esconde',
    contexto: [{ sinal: 'sem_pessoa', onde: 'aqui' }],
    gatilho: [],
    partes: {
      contexto: 'Não há ninguém neste lugar.',
      gatilho: 'Toda olhada em que o contexto vale.',
      fora: 'Com alguém na frente não se julga, não se paga e não conta como análise.',
    },
  },
  {
    valor: 'parou',
    titulo: 'Quando o lugar para',
    ajuda: 'bancada vista de cima: confere quando as mãos saem',
    contexto: [],
    gatilho: [{ sinal: 'parou', onde: 'aqui' }],
    partes: {
      contexto: 'Sem condição: vale sempre que o critério está no horário.',
      gatilho: 'Algo se mexia neste lugar e parou.',
      fora: 'Enquanto nada parar, a olhada conta como “sem gatilho”: não se julga e não se paga.',
    },
  },
  {
    valor: 'tempo',
    titulo: 'De tempos em tempos',
    ajuda: 'o que muda devagar: abastecimento, organização',
    contexto: [],
    gatilho: [{ sinal: 'a_cada', minutos: 10 }],
    partes: {
      contexto: 'Sem condição: vale sempre que o critério está no horário.',
      gatilho: 'A cada 10 minutos.',
      fora: 'Entre uma conferência e outra a olhada conta como “sem gatilho”: não se julga e não se paga.',
    },
  },
];
