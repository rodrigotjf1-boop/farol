// =====================================================================
// A proposta do estudo — o sistema propõe, a pessoa confirma ou corrige
// =====================================================================
// A19, onda 1, fatia 1.3 (protótipo aprovado em 09/10/2026): "A partir do
// seu texto, deste canal e destes quadros, o sistema propõe as seis partes
// e liga cada condição a um sinal que a loja já dá. Você confirma ou
// corrige."
//
// É POR REGRAS, e mora aqui, no servidor: nada vai a modelo nenhum, não
// custa nada, e a mesma entrada dá sempre a mesma proposta. O que entra:
//
//   o texto     o nome e a explicação do critério — de onde sai o ASSUNTO;
//   o tipo      como ele é conferido, e a família: o que ele pergunta;
//   os lugares  os canais e os quadros em que ele vale: a cena escrita do
//               canal (de onde a câmera olha), o papel de cada quadro e se
//               o canal tem foto padrão.
//
// O que sai é um RASCUNHO, nunca confirmado: só o estudo que uma pessoa
// confirma desce para a loja (`estudo.ts`).
//
// ## O vocabulário é dado, não regra do motor
//
// As listas de palavras são vocabulário de cozinha e de loja em geral — não
// de um cliente. O que é de UMA loja (a rotina dela, as embalagens dela)
// mora no cadastro dela, não aqui (`docs/decisoes.md`, 10/10/2026).
//
// ## De onde vem cada escolha de sinal (`agent/farol_agent/sinais.py`)
//
//   - o que a loja não sabe ler NÃO segura: gatilho da foto padrão em canal
//     sem foto abriria a análise em toda olhada. Por isso ele só entra
//     quando TODOS os canais do critério têm foto;
//   - de cima o detector de pessoas vê mão e braço, não gente: ali o sinal
//     que serve é o movimento;
//   - no quadro de "posição de montagem" a loja já espera as mãos saírem
//     antes de qualquer conferência (`motor.py`, `PAPEL_DE_BANCADA`). Pôr
//     "está tudo parado" por cima compararia com a olhada de 30 s antes: no
//     pico o quadro muda a cada olhada, e o critério nunca seria conferido;
//   - condição que olha OUTRO quadro só entra quando o critério está num
//     canal só: o quadro de um canal não existe no outro.
//
// ## As notas ("a câmera não vê", "Sugestão")
//
// Não são guardadas: saem do texto, pela mesma função, na proposta e toda
// vez que a ficha é lida (`notasDoEstudo`). A nota vale enquanto a causa
// dela está no texto — quem seguiu a sugestão e reescreveu a ação deixa de
// vê-la.
// =====================================================================

import { TIPOS_DO_DETECTOR } from './detector.js';
import { MAX_TEXTO_DA_PARTE, TIPOS_QUE_USAM_ESTUDO, type Condicao } from './estudo.js';
import { familiaNaoCabe, familiaNatural } from './familia.js';

/**
 * Uma área do canal: a imagem completa ou um quadro. `alvo` = o critério
 * vale nela. A imagem completa nunca tem papel (regra do banco, migration
 * 034): toda área com papel — o posto, a pia, a montagem — é um quadro, e
 * tem número.
 */
export type AreaDoCanal = { id: string; nome: string; papel: string; numero: number | null; alvo: boolean };

/** Um canal em que o critério vale, com todas as áreas dele. */
export type CanalDaProposta = {
  pontoId: string; nome: string;
  /** O que a câmera vê e de onde olha, escrito por quem configura. Vazio = ainda não descrita. */
  cena: string;
  temFotoPadrao: boolean;
  areas: AreaDoCanal[];
};

export type EntradaDaProposta = {
  nome: string; criterio: string; tipo: string; familia: string; canais: CanalDaProposta[];
};

/** O que a câmera (ou o Farol) não alcança, dito ao lado da parte do estudo a que se refere. */
export type AvisoDaProposta = { parte: 'acao'; rotulo: string; motivo: string };

export type NotasDoEstudo = { avisos: AvisoDaProposta[]; sugestoes: string[] };

/** De que o critério trata — é o que decide os sinais. Interno: não sai em rota nenhuma. */
export type Assunto =
  | 'pessoa' | 'limpeza' | 'equipamento' | 'abastecimento' | 'geral' | 'foto' | 'acontece' | 'detector';

export type Proposta = NotasDoEstudo & {
  assunto: Assunto;
  partes: { contexto: string; gatilho: string; janela: string; acao: string; desfecho: string; fora: string };
  contexto: Condicao[];
  gatilho: Condicao[];
  /** Por que a proposta é esta: o que o sistema leu e o que ele supôs. */
  porque: string[];
};

// ───────────────────────── o texto ─────────────────────────

const MARCAS = /[̀-ͯ]/g;

/**
 * O texto em minúsculas e sem acento, com o MESMO comprimento do que
 * entrou: a posição de um achado é a mesma nos dois, e a palavra citada na
 * explicação sai como a pessoa escreveu. (Quem chama passa o texto já em
 * NFC.)
 */
export function semAcento(texto: string): string {
  let saida = '';
  for (const letra of texto) {
    const simples = letra.normalize('NFD').replace(MARCAS, '').toLowerCase();
    saida += simples.length === letra.length ? simples : ' '.repeat(letra.length);
  }
  return saida;
}

/** O achado de um padrão: a palavra como foi escrita, ou `null`. */
function achar(padrao: RegExp, texto: string): string | null {
  const m = padrao.exec(semAcento(texto));
  return m ? texto.slice(m.index, m.index + m[0].length) : null;
}

/**
 * O vocabulário, na ordem de quem ganha quando o texto fala de mais de uma
 * coisa. "O que alguém usa" vem primeiro: "uniforme limpo" é sobre o
 * uniforme.
 */
const VOCABULARIO: ReadonlyArray<{ assunto: Assunto; padrao: RegExp }> = [
  {
    assunto: 'pessoa',
    padrao: /\b(?:toucas?|uniformes?|uniformizad[oa]s?|aventa(?:l|is)|luvas?|mascaras?|epis?|crachas?|jalecos?|bones?|cabelos?|barbas?|adornos?|brincos?|pulseiras?|maos|lav\w* a mao|us\w* (?:o |de |do )?celular|(?:no|ao) celular)\b/,
  },
  {
    assunto: 'limpeza',
    padrao: /\b(?:limp\w*|suj\w*|organiz\w*|desorganiz\w*|arrum\w*|bagunc\w*|restos?|respingos?|migalhas?|farelos?|residuos?|higienizad[oa]s?|higiene|gordur\w*|manchas?|poeira|lixo|derramad\w*|lavad[oa]s?|varrid[oa]s?|molhad[oa]s?|pocas?|escorregadi[oa]s?)\b/,
  },
  {
    assunto: 'equipamento',
    padrao: /\b(?:abert[oa]s?|fechad[oa]s?|tampad[oa]s?|destampad[oa]s?|trancad[oa]s?|destrancad[oa]s?|ligad[oa]s?|desligad[oa]s?|aces[oa]s?|apagad[oa]s?|portas?|tampas?|gavetas?|cadeados?)\b/,
  },
  {
    assunto: 'abastecimento',
    padrao: /\b(?:abastec\w*|reabastec\w*|repost[oa]s?|reposicao|repor|vazi[oa]s?|chei[oa]s?|nivel|niveis|falt\w*|estoque|pela metade|acabando|acabou)\b/,
  },
];

const FAMILIAS_QUE_ACONTECEM: readonly string[] = ['acontecimento', 'processo', 'medida'];

/** De que o critério trata, e a palavra do texto que disse (quando foi uma palavra). */
export function assuntoDoCriterio(e: Pick<EntradaDaProposta, 'nome' | 'criterio' | 'tipo' | 'familia'>): { assunto: Assunto; palavra: string | null } {
  if (!TIPOS_QUE_USAM_ESTUDO.includes(e.tipo)) return { assunto: 'detector', palavra: null };
  if (FAMILIAS_QUE_ACONTECEM.includes(e.familia)) return { assunto: 'acontece', palavra: null };
  if (e.tipo === 'comparacao') return { assunto: 'foto', palavra: null };
  // A explicação antes do nome: é nela que a pessoa descreve o que se vê.
  const texto = `${e.criterio}\n${e.nome}`.normalize('NFC');
  for (const v of VOCABULARIO) {
    const palavra = achar(v.padrao, texto);
    if (palavra) return { assunto: v.assunto, palavra };
  }
  return { assunto: 'geral', palavra: null };
}

// ───────────────────────── os lugares ─────────────────────────

/** O papel do quadro em que a loja espera as mãos saírem (`agent/farol_agent/motor.py`, `PAPEL_DE_BANCADA`). */
const PAPEL_DE_BANCADA = 'montagem';

const DIZ_DE_CIMA = /\b(?:de cima|zenital|para baixo|no teto|do teto)\b/;
const DIZ_DE_LADO = /\b(?:de lado|de frente|lateral|de canto|inclinad[oa]|na diagonal|em diagonal)\b/;

/**
 * A cena escrita diz que a câmera olha de cima? "Vista de lado, da altura
 * do teto" não é de cima: quando o texto diz as duas coisas, não se supõe.
 */
export function cenaDizDeCima(cena: string): boolean {
  const texto = semAcento(cena.normalize('NFC'));
  return DIZ_DE_CIMA.test(texto) && !DIZ_DE_LADO.test(texto);
}

/** Com que sinal conferir "tem gente / está livre" nestes lugares. */
type Olhar = 'pessoa' | 'movimento' | 'bancada';

type Lugares = {
  olhar: Olhar;
  deCima: boolean;
  semCena: boolean;
  comFotoEmTodos: boolean;
  umCanalSo: boolean;
  /** O único quadro de posto do canal, quando o critério está num canal só e não está nele. */
  posto: AreaDoCanal | null;
};

const rotuloDoQuadro = (a: AreaDoCanal): string => (a.numero != null ? `Quadro ${a.numero} · ${a.nome}` : a.nome);

function lerLugares(canais: readonly CanalDaProposta[]): Lugares {
  const alvos = canais.flatMap((c) => c.areas.filter((a) => a.alvo));
  const todosBancada = alvos.length > 0 && alvos.every((a) => a.papel === PAPEL_DE_BANCADA);
  const algumaBancada = alvos.some((a) => a.papel === PAPEL_DE_BANCADA);
  const deCima = canais.some((c) => cenaDizDeCima(c.cena));
  const postos = canais.length === 1 ? canais[0]!.areas.filter((a) => a.papel === 'posto') : [];
  return {
    olhar: todosBancada ? 'bancada' : algumaBancada || deCima ? 'movimento' : 'pessoa',
    deCima,
    semCena: canais.some((c) => c.cena.trim() === ''),
    comFotoEmTodos: canais.length > 0 && canais.every((c) => c.temFotoPadrao),
    umCanalSo: canais.length === 1,
    posto: postos.length === 1 && !postos[0]!.alvo ? postos[0]! : null,
  };
}

// ───────────────────────── as condições ─────────────────────────

const aqui = (sinal: string): Condicao => ({ sinal, onde: 'aqui' });
const aCada = (minutos: number): Condicao => ({ sinal: 'a_cada', minutos });

/** De quantos em quantos minutos, por assunto: o que muda devagar espera mais. */
const MINUTOS_DO_RELOGIO = { pessoa: 5, lugar: 10, devagar: 15 } as const;

function condicoesDe(assunto: Assunto, l: Lugares): { contexto: Condicao[]; gatilho: Condicao[] } {
  // O lugar livre: sem ninguém (detector), parado (movimento), ou nada — a bancada já espera as mãos saírem.
  const livre: Condicao[] = l.olhar === 'pessoa' ? [aqui('sem_pessoa')] : l.olhar === 'movimento' ? [aqui('parado')] : [];
  // O lugar acabou de ficar livre.
  const ficouLivre: Condicao[] = l.olhar === 'pessoa' ? [aqui('saiu')] : l.olhar === 'movimento' ? [aqui('parou')] : [];

  switch (assunto) {
    case 'detector':
      return { contexto: [], gatilho: [] };
    case 'pessoa':
      return l.olhar === 'pessoa'
        ? { contexto: [aqui('pessoa')], gatilho: [aqui('entrou'), aCada(MINUTOS_DO_RELOGIO.pessoa)] }
        : { contexto: [aqui('movimento')], gatilho: [aCada(MINUTOS_DO_RELOGIO.pessoa)] };
    case 'limpeza':
    case 'equipamento':
      return { contexto: livre, gatilho: [...ficouLivre, aCada(MINUTOS_DO_RELOGIO.lugar)] };
    case 'abastecimento':
      return { contexto: livre, gatilho: [aCada(MINUTOS_DO_RELOGIO.devagar)] };
    case 'foto':
      if (l.comFotoEmTodos) return { contexto: livre, gatilho: [aqui('saiu_do_padrao'), aCada(MINUTOS_DO_RELOGIO.devagar)] };
      return condicoesDe('geral', l);
    case 'acontece':
      if (l.olhar !== 'pessoa') return { contexto: [], gatilho: [aqui('mexeu')] };
      return {
        contexto: [l.posto ? { sinal: 'pessoa', onde: 'quadro', zonaId: l.posto.id } : aqui('pessoa')],
        gatilho: [aqui('mexeu')],
      };
    case 'geral':
      return {
        contexto: livre,
        gatilho: [...(l.olhar === 'bancada' ? [] : [aqui('parou')]), aCada(MINUTOS_DO_RELOGIO.lugar)],
      };
  }
}

// ───────────────────────── os textos das partes ─────────────────────────

const NO_CONTEXTO: Readonly<Record<string, string>> = {
  pessoa: 'Há alguém',
  sem_pessoa: 'Não há ninguém',
  movimento: 'Algo se mexe',
  parado: 'Está tudo parado',
};

const NO_GATILHO: Readonly<Record<string, string>> = {
  entrou: 'alguém chegou a este lugar',
  saiu: 'este lugar ficou sem ninguém',
  mexeu: 'algo se mexeu neste lugar desde a olhada anterior',
  parou: 'este lugar parou de se mexer',
  saiu_do_padrao: 'este lugar deixou de estar como na foto padrão',
};

const SEM_CONDICAO = 'Sem condição: vale sempre que o critério está no horário.';

/** O contexto em palavras. A proposta leva no máximo UMA condição de contexto (`condicoesDe`). */
function textoDoContexto(contexto: readonly Condicao[], l: Lugares): string {
  const c = contexto[0];
  if (!c) return SEM_CONDICAO;
  return `${NO_CONTEXTO[c.sinal]} ${c.onde === 'quadro' && l.posto ? `no ${rotuloDoQuadro(l.posto)}` : 'neste lugar'}.`;
}

/** O gatilho em palavras. Toda proposta que leva gatilho leva ao menos um — o teste confere. */
function textoDoGatilho(gatilho: readonly Condicao[]): string {
  const frase = gatilho
    .map((g) => (g.sinal === 'a_cada' ? `passaram ${g.minutos} minutos desde a última análise` : NO_GATILHO[g.sinal]))
    .join(', ou ');
  return `${frase.charAt(0).toUpperCase()}${frase.slice(1)}.`;
}

/** O texto cabe numa parte do estudo: o que passa do limite é cortado numa palavra, com reticências. */
export function caberNaParte(texto: string): string {
  const limpo = texto.trim().replace(/\s+/g, ' ');
  if (limpo.length <= MAX_TEXTO_DA_PARTE) return limpo;
  const corte = limpo.slice(0, MAX_TEXTO_DA_PARTE - 1);
  const ultimoEspaco = corte.lastIndexOf(' ');
  return `${ultimoEspaco > 0 ? corte.slice(0, ultimoEspaco) : corte}…`;
}

function desfechoDe(assunto: Assunto, e: Pick<EntradaDaProposta, 'tipo' | 'familia'>): string {
  if (assunto === 'detector') {
    return e.tipo === 'contagem'
      ? 'A contagem ficou dentro do pedido: dentro. Ficou fora dele: fora. Imagem escura ou tapada: não deu para ver.'
      : 'O detector achou o que o critério pede: dentro. Não achou: fora. Imagem escura ou tapada: não deu para ver.';
  }
  if (assunto === 'acontece') {
    if (e.familia === 'processo') {
      return 'Todas as etapas, como o texto descreve: dentro. Faltou ou sobrou etapa: fora. Tapado antes de ser visto: não deu para ver.';
    }
    if (e.familia === 'medida') {
      return 'Dentro do que o texto pede: dentro. Passou do limite: fora. Não deu para medir: não deu para ver.';
    }
    return 'Aconteceu como o texto descreve: dentro. A janela fechou sem acontecer: fora. Tapado ou escuro: não deu para ver.';
  }
  if (assunto === 'foto') return 'Igual à foto padrão: dentro. Diferente dela: fora. Tapado ou escuro: não deu para ver.';
  return 'Como o texto descreve: dentro. Diferente: fora. Tapado ou escuro: não deu para ver.';
}

function partesDe(
  assunto: Assunto,
  e: EntradaDaProposta,
  l: Lugares,
  c: { contexto: Condicao[]; gatilho: Condicao[] },
): Proposta['partes'] {
  const acao = caberNaParte(e.criterio);
  const desfecho = desfechoDe(assunto, e);
  if (assunto === 'detector') {
    return {
      contexto: 'Vale em toda olhada em que o critério está no horário: quem confere é o detector, no computador da loja.',
      gatilho: 'Toda olhada.',
      janela: 'A própria olhada.',
      acao,
      desfecho,
      fora: 'Não há fora de contexto: presença e contagem são conferidas em toda olhada.',
    };
  }
  return {
    contexto: textoDoContexto(c.contexto, l),
    gatilho: textoDoGatilho(c.gatilho),
    janela: assunto === 'acontece' ? 'Do gatilho até o lugar parar de novo.' : 'A própria olhada: um quadro, o melhor dela.',
    acao,
    desfecho,
    fora:
      c.contexto.length > 0
        ? 'Sem o contexto não se julga, não se paga e não conta como análise.'
        : 'Enquanto nada abrir a análise, a olhada conta como “sem gatilho”: não se julga e não se paga.',
  };
}

// ───────────────────────── o porquê ─────────────────────────

const O_QUE_LI: Readonly<Partial<Record<Assunto, string>>> = {
  pessoa: 'é sobre o que alguém usa ou faz, e por isso só vale a pena olhar com gente no lugar.',
  limpeza: 'é sobre limpeza e organização. Gente na frente esconde, e por isso vale olhar com o lugar livre.',
  equipamento: 'é sobre algo que fica aberto ou fechado, ligado ou desligado. Vale olhar quando quem mexeu sai da frente.',
  abastecimento: 'é sobre abastecimento, que muda devagar: basta olhar de tempos em tempos.',
};

const O_QUE_ACONTECE: Readonly<Record<string, string>> = {
  acontecimento: 'um acontecimento',
  processo: 'um processo',
  medida: 'uma medida',
};

function porqueDe(assunto: Assunto, palavra: string | null, e: EntradaDaProposta, l: Lugares): string[] {
  if (assunto === 'detector') {
    return ['Presença e contagem são conferidas na loja em toda olhada: propus só os textos. Contexto e gatilho não se aplicam.'];
  }
  const frases: string[] = [];
  const doCanal = l.umCanalSo ? 'deste canal' : 'de um dos canais';

  // 1. O que foi lido.
  if (assunto === 'acontece') {
    frases.push(
      `Este critério pergunta por ${O_QUE_ACONTECE[e.familia]}: o estudo conta quantas vezes por dia a coisa acontece — a olhada em que algo se mexe no lugar.`,
    );
  } else if (assunto === 'foto') {
    frases.push('Este critério compara com a foto padrão. Gente na frente esconde, e por isso vale olhar com o lugar livre.');
    frases.push(
      l.comFotoEmTodos
        ? `${l.umCanalSo ? 'O canal tem' : 'Todos os canais têm'} foto padrão: o gatilho é a imagem deixar de estar como nela.`
        : `${l.umCanalSo ? 'O canal ainda não tem' : 'Há canal sem'} foto padrão: não pus o gatilho da foto. Sem ela, ele abriria a análise em toda olhada.`,
    );
  } else if (assunto === 'geral') {
    frases.push(
      'Não achei no seu texto uma palavra que eu conheça. Propus o caminho geral: olhar com o lugar livre, quando ele para e de tempos em tempos.',
    );
  } else {
    frases.push(`Li “${palavra}” no seu texto: ${O_QUE_LI[assunto]}`);
  }

  // 2. Com que sinal — e o que foi suposto sobre a câmera.
  if (l.olhar === 'bancada') {
    frases.push(
      assunto === 'pessoa'
        ? 'O critério vale em posição de montagem, papel pensado para câmera que olha de cima: usei o movimento no lugar do detector de pessoas.'
        : assunto === 'acontece'
          ? 'O critério vale em posição de montagem: ali a loja espera as mãos saírem, e o gatilho é o lugar ter mudado desde a olhada anterior.'
          : 'O critério vale em posição de montagem: ali a loja já espera as mãos saírem antes de conferir, e por isso não pus condição de lugar livre.',
    );
  } else if (l.olhar === 'movimento') {
    frases.push(
      l.deCima
        ? `A cena ${doCanal} diz que a câmera olha de cima. De cima o detector de pessoas vê mão e braço, não gente: usei o movimento.`
        : 'Um dos lugares é posição de montagem, papel pensado para câmera que olha de cima: usei o movimento, que serve em todos os lugares.',
    );
  } else {
    if (assunto === 'acontece' && l.posto) {
      frases.push(`O canal tem um quadro de posto de trabalho (${rotuloDoQuadro(l.posto)}): a condição “há alguém” olha para ele.`);
    }
    frases.push('Usei o detector de pessoas. Se a câmera olha de cima, troque por movimento: de cima ele vê mão e braço, não gente.');
    if (l.semCena) frases.push(`A cena ${doCanal} ainda não foi descrita: é nela que eu leio de onde a câmera olha.`);
  }
  return frases;
}

// ───────────────────────── as notas ─────────────────────────

/**
 * O que a câmera — ou o Farol — não alcança. Cada item só afirma o que vale
 * em QUALQUER câmera de loja; o que depende da instalação fica de fora.
 * Os padrões pegam o GESTO ("salga", "tempera"), não a coisa: o saleiro e o
 * pote de tempero aparecem na imagem.
 */
const NAO_ALCANCA: ReadonlyArray<{ padrao: RegExp; rotulo: string; motivo: string; sugestao: string }> = [
  {
    padrao: /\b(?:salga|salgar|salgam|salgou|salgando|salgadas?|tempera|temperam|temperar|temperou|temperando|temperad[oa]s?|(?:poe|por|coloca\w*|joga\w*|passa\w*) (?:o )?sal)\b/,
    rotulo: 'a câmera não vê',
    motivo: 'O sal e o tempero em pó não aparecem na imagem.',
    sugestao:
      'Dê à ação um rastro que a câmera veja: um lugar marcado para o saleiro, num quadro. O saleiro saiu do lugar e voltou = temperou.',
  },
  {
    padrao: /\b(?:temperaturas?|graus)\b|\d ?°/,
    rotulo: 'a câmera não vê',
    motivo: 'A temperatura não aparece na imagem.',
    sugestao: 'Confira o que a câmera vê e que guarda a temperatura: a porta fechada, a tampa no lugar.',
  },
  {
    padrao: /\b(?:validades?|vencid[oa]s?|vencimentos?|data de fabricacao)\b/,
    rotulo: 'a câmera não lê',
    motivo: 'Na distância de uma câmera de loja, a data de uma etiqueta não dá para ler.',
    sugestao: 'O que a câmera pode ver é se a etiqueta está lá. A data fica para a conferência de validade, com a etiqueta na mão.',
  },
  {
    padrao: /\b(?:cheiros?|odor(?:es)?|fedor)\b/,
    rotulo: 'a câmera não vê',
    motivo: 'Cheiro não aparece na imagem.',
    sugestao: 'Escreva o que se vê quando isso acontece: a cor, o aspecto, a fumaça.',
  },
  {
    padrao: /\b(?:pesos?|pesar|pesa|pesam|pesad[oa]s?|pesagem|gramas?|gramatura|quilos?|kg)\b|\d ?g\b/,
    rotulo: 'a câmera não vê',
    motivo: 'O peso não aparece na imagem.',
    sugestao: 'O que a câmera pode ver é o instrumento em uso: a balança, a concha, o dosador.',
  },
  {
    padrao: /\b(?:cumpriment\w*|fala|falar|falam|falando|agradec\w*|bom dia|boa tarde|boa noite|barulhos?|apit\w*|grit\w*)\b/,
    rotulo: 'o Farol não ouve',
    motivo: 'O Farol analisa a imagem, não o som: o que foi dito ou ouvido não aparece.',
    sugestao: 'Escreva o gesto que acompanha a fala e que a câmera vê: entregar o cardápio, estender a sacola.',
  },
  {
    padrao: /\b(?:identific\w*|reconhec\w*) (?:(?:o|a|os|as|cada|qual|quem) )?(?:funcionari\w*|colaborador\w*|pessoas?|clientes?|atendentes?)\b|\b(?:qual|que) (?:funcionari\w*|colaborador\w*|atendente)\b|\bnome d[oa] (?:funcionari\w*|colaborador\w*|cliente|atendente)\b|\bquem (?:foi|fez|estava|deixou|esqueceu)\b/,
    rotulo: 'o Farol não diz quem',
    motivo: 'O Farol não identifica pessoas: ele diz o que aconteceu e onde, não quem.',
    sugestao: 'Quem estava no posto se descobre pelo horário do aviso e pela escala.',
  },
];

const LAVAR_AS_MAOS = /\blav\w* (?:as |a )?maos?\b|\bhigieniz\w* (?:as |a |das |de )?maos\b|\blavagem d(?:as|e) maos\b|\bmaos (?:lavadas|higienizadas)\b/;

/**
 * As notas de um estudo: o que a câmera não alcança e o que se sugere.
 *
 * `acao` é o texto da parte "ação" (na proposta, a explicação do critério).
 * Os avisos saem SÓ dele: a pessoa que reescreve a ação para o que a câmera
 * vê deixa de ser avisada. As sugestões de lugar olham também o nome.
 */
export function notasDoEstudo(e: { nome: string; acao: string; tipo: string; familia: string; canais: readonly CanalDaProposta[] }): NotasDoEstudo {
  const acao = e.acao.normalize('NFC');
  const avisos: AvisoDaProposta[] = [];
  const sugestoes: string[] = [];
  for (const n of NAO_ALCANCA) {
    if (!achar(n.padrao, acao)) continue;
    avisos.push({ parte: 'acao', rotulo: n.rotulo, motivo: n.motivo });
    sugestoes.push(n.sugestao);
  }

  // Daqui para baixo, o lugar. Presença e contagem não passam por estas regras: são conferidas em toda olhada.
  if (!TIPOS_QUE_USAM_ESTUDO.includes(e.tipo)) return { avisos, sugestoes };
  const alvos = e.canais.flatMap((c) => c.areas.filter((a) => a.alvo));
  const { assunto } = assuntoDoCriterio({ nome: e.nome, criterio: acao, tipo: e.tipo, familia: e.familia });

  if (assunto === 'pessoa' && alvos.some((a) => a.papel === PAPEL_DE_BANCADA)) {
    sugestoes.push(
      'Em posição de montagem o critério só é conferido com as mãos fora, e o que alguém usa ou faz não aparece nesse momento. ' +
        'Marque este critério na imagem completa do canal ou num quadro de posto de trabalho.',
    );
  }

  if (achar(LAVAR_AS_MAOS, acao) && !alvos.some((a) => a.papel === 'pia')) {
    const pia = e.canais.flatMap((c) => c.areas).find((a) => a.papel === 'pia');
    sugestoes.push(
      pia
        ? `Lavar as mãos aparece onde a pia aparece, e o canal tem um quadro de pia (${rotuloDoQuadro(pia)}): marque este critério nele.`
        : 'Lavar as mãos só aparece onde a pia aparece, e nenhum quadro daqui está marcado como pia. ' +
            'Se ela aparece na imagem, desenhe o quadro dela, com o papel “pia”, e marque este critério nele.',
    );
  }
  return { avisos, sugestoes };
}

// ───────────────────────── o pedido ─────────────────────────

/** Os tipos de critério (a mesma lista do banco e de `rotas/regras.ts`). */
const TIPOS: readonly string[] = [...TIPOS_QUE_USAM_ESTUDO, ...TIPOS_DO_DETECTOR];

export const MAX_NOME_NA_PROPOSTA = 200;
export const MAX_CRITERIO_NA_PROPOSTA = 4000;

export type PedidoDeProposta = Pick<EntradaDaProposta, 'nome' | 'criterio' | 'tipo' | 'familia'>;

/**
 * Lê o corpo do pedido de proposta — o critério como está na gaveta, salvo
 * ou não. Devolve o que a proposta usa, ou o problema. (Os canais são lidos
 * pela rota: dependem do banco.)
 */
export function lerPedidoDeProposta(bruto: unknown): { ok: PedidoDeProposta } | { problema: string } {
  if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) {
    return { problema: 'esperado { nome, criterio, tipo, familia, zonaIds }' };
  }
  const c = bruto as Record<string, unknown>;

  if (typeof c.criterio !== 'string' || !c.criterio.trim()) {
    return { problema: 'criterio: escreva antes como você explicaria este critério a um funcionário novo' };
  }
  if (c.criterio.length > MAX_CRITERIO_NA_PROPOSTA) {
    return { problema: `criterio: no máximo ${MAX_CRITERIO_NA_PROPOSTA} caracteres para propor o estudo` };
  }
  if (c.nome != null && typeof c.nome !== 'string') return { problema: 'nome: texto' };
  const nome = typeof c.nome === 'string' ? c.nome.trim() : '';
  if (nome.length > MAX_NOME_NA_PROPOSTA) return { problema: `nome: no máximo ${MAX_NOME_NA_PROPOSTA} caracteres` };

  if (typeof c.tipo !== 'string' || !TIPOS.includes(c.tipo)) return { problema: `tipo: um de ${TIPOS.join(', ')}` };
  const naoCabe = familiaNaoCabe(c.familia, c.tipo);
  if (naoCabe) return { problema: naoCabe };

  return {
    ok: {
      nome,
      criterio: c.criterio.trim(),
      tipo: c.tipo,
      familia: typeof c.familia === 'string' ? c.familia : familiaNatural(c.tipo),
    },
  };
}

// ───────────────────────── a proposta ─────────────────────────

/**
 * Propõe o estudo de um critério. Função pura: a mesma entrada, a mesma
 * proposta. O que sai passa por `lerEstudo` e por `estudoNaoCabeNoTipo` —
 * é a forma que a rota de gravar aceita.
 */
export function proporEstudo(e: EntradaDaProposta): Proposta {
  const { assunto, palavra } = assuntoDoCriterio(e);
  const l = lerLugares(e.canais);
  const c = condicoesDe(assunto, l);
  const partes = partesDe(assunto, e, l, c);
  return {
    assunto,
    partes,
    contexto: c.contexto,
    gatilho: c.gatilho,
    porque: porqueDe(assunto, palavra, e, l),
    ...notasDoEstudo({ nome: e.nome, acao: partes.acao, tipo: e.tipo, familia: e.familia, canais: e.canais }),
  };
}
