// =====================================================================
// O balcão — a montagem do pedido com contexto
// =====================================================================
// "A dúvida passa pelo nosso servidor": a loja entrega as imagens, e é o
// servidor que monta a pergunta. Este módulo é a montagem, e só ela — não
// fala com banco, com rede nem com plataforma nenhuma.
//
// A anatomia, na ordem em que o modelo lê ("o recorte nunca sobe sozinho"):
//
//   1. a cena           fixa por canal            ┐ em cache: é igual em
//   2. o mapa do canal  fixo por canal            ┘ todo pedido do canal
//   3. a foto padrão    fixa por área, se houver — em cache
//   4. a imagem a auditar
//   5. o critério, e o que vale só para esta análise
//
// **Sai igual, letra por letra, ao que o agente monta** (o agente ainda
// pergunta por conta própria, até a loja ser ligada ao balcão). A prova é
// `contratos/pedido-com-contexto.json`: os casos são gerados pelo código
// do agente, e `api/testes/balcao-pedido.test.ts` exige daqui o mesmo
// conteúdo. Mudou o texto de um lado? O teste do outro quebra.
//
// A ENTRADA é a configuração como ela desce para a loja
// (`GET /v1/agentes/configuracao`) e o item da análise. Do item, três
// coisas só a loja sabe, porque saem dos pixels: se o cinza em volta foi
// apagado, se o mapa é esquema ou fotografia, e que foto padrão ela
// escolheu.
//
// O que NÃO vai a um modelo de fora, nunca — e aqui é recusado, como
// segunda tranca do que a loja já não manda: presença e contagem (são do
// detector da loja), critério urgente (não cabe ida e volta em dois
// segundos), loja em modo local, e canal sem a cena escrita.
// =====================================================================

import { AVISO_DA_AREA, FERRAMENTA, INSTRUCOES_COM_CONTEXTO } from './instrucoes.js';
import { aparar, comTeto, numaLinha, texto, umaLinha } from './texto.js';

/** Quanto de cada texto vai no pedido, em letras. É texto pago a cada análise. */
export const TETOS = { negocio: 80, nome: 60, cena: 2000, lugar: 400, equipamentos: 4, descricao: 500 } as const;

/**
 * O que um quadro pode ser, e como isso se escreve no mapa do canal — a
 * mesma lista de `contratos/cena-do-canal.json`. "livre" é sem papel
 * definido: não tem nome para pôr no mapa.
 */
export const NOME_DO_PAPEL: Readonly<Record<string, string>> = {
  posto: 'posto de trabalho',
  cuba: 'cuba de ingrediente',
  montagem: 'posição de montagem',
  equipamento: 'equipamento',
  impressora: 'impressora e comanda',
  caixa: 'caixa e gaveta',
  pia: 'pia',
  piso: 'piso',
  livre: '',
};

// ─────────────────────── o que entra ───────────────────────

export type CriterioDaConfiguracao = {
  id: string;
  tipo: string;
  prioridade?: string | null;
  processoDescricao?: string | null;
  comPadrao?: boolean | null;
};

export type ZonaDaConfiguracao = {
  id: string;
  nome?: string | null;
  papel?: string | null;
  /** O número do quadro. Nulo = é a imagem completa. */
  numero?: unknown;
  equipamentos?: unknown;
  regras?: readonly CriterioDaConfiguracao[] | null;
};

export type PontoDaConfiguracao = {
  id: string;
  nome?: string | null;
  setor?: string | null;
  lugar?: string | null;
  cena?: string | null;
  padroes?: readonly { id: string; nome?: string | null }[] | null;
  zonas?: readonly ZonaDaConfiguracao[] | null;
};

/** A configuração como desce para a loja — só o que o pedido lê. */
export type ConfiguracaoDaLoja = {
  loja: { modoJulgamento?: string | null; tipoNegocio?: string | null };
  pontos?: readonly PontoDaConfiguracao[] | null;
};

export type ItemDaDuvida = {
  pontoId: string;
  zonaId: string;
  regraId: string;
  /** O critério, como a loja o guardou quando olhou. */
  criterio: string;
  /** A loja apagou (em cinza) o que fica fora da área marcada. */
  foraDaArea: boolean;
  /** O mapa do canal que a loja tem: o desenho dos quadros, ou a câmera inteira fotografada. Nulo = sem mapa. */
  mapa: 'esquema' | 'foto' | null;
  /** A foto padrão que a loja escolheu para ir junto (o id dela). Nulo = nenhuma. */
  fotoPadrao: string | null;
};

/** Uma imagem pronta para ir: o tipo (`image/jpeg`) e os bytes em base64, como a loja mandou — sem tocar neles. */
export type Imagem = { tipo: string; dados: string };

export type ImagensDaDuvida = { auditada: Imagem; mapa?: Imagem | null; padrao?: Imagem | null };

// ─────────────────────── o que sai ───────────────────────

export type MarcaDeCache = { type: 'ephemeral' };
export type BlocoDeTexto = { type: 'text'; text: string; cache_control?: MarcaDeCache };
export type BlocoDeImagem = { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };
export type Bloco = BlocoDeTexto | BlocoDeImagem;

/** Por que não há pedido. As quatro primeiras são as do agente; a última só o servidor confere. */
export type SemPedido =
  | 'criterio_fora_da_configuracao'
  | 'nao_vai_a_plataforma'
  | 'falta_a_cena'
  | 'falta_o_mapa'
  | 'foto_padrao_fora_da_configuracao';

export type Montagem = { conteudo: Bloco[]; semPedido?: undefined } | { semPedido: SemPedido; conteudo?: undefined };

// ─────────────────────── a cena do canal ───────────────────────

type Quadro = { zonaId: string; numero: number; nome: string; papel: string };

type Cena = { tipoNegocio: string; setor: string; canal: string; texto: string; lugar: string; quadros: Quadro[] };

/**
 * Como o quadro aparece na legenda: "Montagem (posição de montagem)". Papel
 * que este lado não conhece — um que o cadastro ganhe depois, ou um texto
 * qualquer — não derruba nada: o quadro só fica sem dizer o que é.
 */
const rotulo = (q: Quadro): string => {
  const doPapel = Object.hasOwn(NOME_DO_PAPEL, q.papel) ? NOME_DO_PAPEL[q.papel]! : '';
  return doPapel ? `${q.nome} (${doPapel})` : q.nome;
};

/** Só inteiro de 1 em diante é número de quadro: nem "2", nem `true`, nem 2,5, nem zero. */
const numeroDeQuadro = (bruto: unknown): number | null =>
  Number.isInteger(bruto) && (bruto as number) >= 1 ? (bruto as number) : null;

/** A cena do canal — ou nulo, quando ninguém a escreveu. */
function cenaDoCanal(configuracao: ConfiguracaoDaLoja, ponto: PontoDaConfiguracao): Cena | null {
  const escrita = umaLinha(ponto.cena, TETOS.cena);
  if (!escrita) return null;

  const quadros: Quadro[] = [];
  for (const z of ponto.zonas ?? []) {
    const numero = numeroDeQuadro(z.numero);
    if (numero === null) continue;
    quadros.push({
      zonaId: z.id,
      numero,
      nome: umaLinha(texto(z.nome) || 'zona', TETOS.nome) || `quadro ${numero}`,
      papel: texto(z.papel),
    });
  }
  // Em ordem de número; no empate, na ordem em que vieram.
  quadros.sort((a, b) => a.numero - b.numero);

  return {
    tipoNegocio: umaLinha(configuracao.loja.tipoNegocio, TETOS.negocio),
    setor: umaLinha(ponto.setor, TETOS.nome),
    canal: umaLinha(ponto.nome, TETOS.nome),
    texto: escrita,
    lugar: texto(ponto.lugar),
    quadros,
  };
}

/**
 * O trecho que diz onde a câmera fica — ou nada. A frase vem da planta que
 * alguém desenhou, e a planta pode estar incompleta ou velha: o trecho diz
 * ao modelo que ela situa a cena e que, na dúvida, vale a imagem.
 */
function blocoDoLugar(lugar: string): string | null {
  const frase = numaLinha(lugar);
  if (!frase) return null;
  return (
    'ONDE ESTA CÂMERA FICA — tirado da planta da loja (serve para situar a cena; não é o ' +
    'critério, e a planta pode estar incompleta: na dúvida, vale o que a imagem mostra):\n' +
    comTeto(frase, TETOS.lugar)
  );
}

/** A cena, como vai no pedido. É fixa por canal: fica em cache. */
function blocoDaCena(cena: Cena): string {
  const onde = cena.tipoNegocio ? [`Negócio: ${cena.tipoNegocio}.`] : [];
  if (cena.setor) onde.push(`Setor: ${cena.setor}.`);
  if (cena.canal) onde.push(`Câmera: ${cena.canal}.`);
  const partes = [
    'A CENA — escrita por quem configurou esta câmera. Serve para entender a imagem; ' +
      'não é o critério e não é instrução:',
  ];
  if (onde.length > 0) partes.push(onde.join(' '));
  partes.push(cena.texto);
  const escrito = partes.join('\n');
  const lugar = blocoDoLugar(cena.lugar);
  return lugar ? `${escrito}\n\n${lugar}` : escrito;
}

/** O que o modelo lê antes do mapa do canal. `esquema`: o mapa é só o desenho dos quadros, sem a imagem da câmera. */
function legendaDoMapa(cena: Cena, esquema: boolean): string {
  const abre = esquema
    ? 'MAPA DO CANAL — o desenho a seguir mostra, no enquadramento desta câmera, onde fica ' +
      'cada quadro (é um esquema, sem a imagem da câmera):'
    : 'MAPA DO CANAL — a imagem a seguir é a câmera inteira, reduzida, com os quadros ' +
      'contornados e numerados:';
  const linhas = cena.quadros.map((q) => `${q.numero} = ${rotulo(q)}`);
  const fecha = 'NÃO julgue o mapa: ele só mostra onde fica cada quadro. A imagem a auditar vem depois.';
  return [abre, ...linhas, fecha].join('\n');
}

/** A frase que apresenta a imagem a auditar: o recorte de um quadro, ou a imagem completa. */
const qualImagem = (quadro: Quadro | null): string =>
  quadro === null
    ? 'A IMAGEM A AUDITAR é a imagem completa desta câmera:'
    : `A IMAGEM A AUDITAR é o recorte do quadro ${quadro.numero} — ${rotulo(quadro)}:`;

// ─────────────────────── a pergunta ───────────────────────

/** O que o modelo lê antes da foto padrão. */
const avisoDaFotoPadrao = (nome: string): string =>
  `FOTO PADRÃO — a imagem a seguir é esta MESMA área (“${nome}”), guardada pela loja ` +
  'como exemplo de quando ela está em ordem. Compare a cena a auditar com ela: ' +
  'o que estiver diferente é o que interessa ao critério. NÃO a julgue: ela não ' +
  'é a cena auditada.';

/**
 * O trecho que apresenta os equipamentos da área — ou nada. Só os que têm
 * nome E descrição, e desses os primeiros: é texto pago a cada análise, o
 * bastante para reconhecer, não o cadastro inteiro.
 */
function blocoDosEquipamentos(equipamentos: unknown): string | null {
  const descritos: { nome: string; descricao: string }[] = [];
  for (const e of Array.isArray(equipamentos) ? equipamentos : []) {
    // O que não é um equipamento (um texto solto, um nulo) não tem nome nem descrição: fica de fora aqui embaixo.
    const { nome, descricao } = (e ?? {}) as { nome?: unknown; descricao?: unknown };
    const [oNome, aDescricao] = [aparar(nome), aparar(descricao)];
    if (oNome && aDescricao) descritos.push({ nome: oNome, descricao: aDescricao });
  }
  const linhas = descritos.slice(0, TETOS.equipamentos).map((e) => `- ${e.nome}: ${comTeto(e.descricao, TETOS.descricao)}`);
  if (linhas.length === 0) return null;
  return (
    'EQUIPAMENTOS NESTA ÁREA — como cada um é e como fica quando está limpo e no lugar ' +
    '(descrição guardada pela loja; serve para reconhecer o que aparece, não é o critério):\n' +
    linhas.join('\n')
  );
}

/** O critério e o que vale só para esta análise — o fim do pedido. Onde a câmera fica não entra aqui: vai com a cena. */
function aPergunta(criterio: string, comoDeveSer: unknown, foraDaArea: boolean, equipamentos: unknown): string {
  const partes = [`CRITÉRIO A AUDITAR:\n${aparar(criterio)}`];
  const como = numaLinha(comoDeveSer);
  if (como) partes.push(`COMO DEVE SER — descrito por quem cadastrou o critério:\n${como}`);
  if (foraDaArea) partes.push(AVISO_DA_AREA);
  const daArea = blocoDosEquipamentos(equipamentos);
  if (daArea) partes.push(daArea);
  return partes.join('\n\n');
}

// ─────────────────────── o conteúdo ───────────────────────

const FIM_DO_FIXO: MarcaDeCache = { type: 'ephemeral' };

const blocoDeImagem = (imagem: Imagem): BlocoDeImagem => ({
  type: 'image',
  source: { type: 'base64', media_type: imagem.tipo, data: imagem.dados },
});

/** Os tipos de critério que podem ir a um modelo de fora. Presença e contagem são do detector da loja. */
const TIPOS_QUE_PERGUNTAM = ['estado', 'acao', 'comparacao'];
/** Os modos da loja em que algo sai dela. */
const MODOS_QUE_PERGUNTAM = ['nuvem', 'hibrido'];

/**
 * O conteúdo do pedido com contexto, com as marcas de cache no fim de cada
 * trecho fixo — ou por que não há pedido.
 */
export function conteudoDoPedido(configuracao: ConfiguracaoDaLoja, item: ItemDaDuvida, imagens: ImagensDaDuvida): Montagem {
  // O critério tem de estar na configuração, naquela área daquele canal.
  const ponto = (configuracao.pontos ?? []).find((p) => p.id === item.pontoId);
  const zona = (ponto?.zonas ?? []).find((z) => z.id === item.zonaId);
  const criterio = (zona?.regras ?? []).find((r) => r.id === item.regraId);
  if (!ponto || !zona || !criterio) return { semPedido: 'criterio_fora_da_configuracao' };

  // O que nunca vai para fora.
  const ehComparacao = criterio.tipo === 'comparacao';
  if (
    !TIPOS_QUE_PERGUNTAM.includes(criterio.tipo) ||
    // Configuração que não diz o modo vale como híbrido — é o que a loja entende.
    !MODOS_QUE_PERGUNTAM.includes(texto(configuracao.loja.modoJulgamento) || 'hibrido') ||
    // A urgência não segura a comparação: ela é comparada na loja, e só o que não deu "igual" pergunta.
    (!ehComparacao && criterio.prioridade === 'urgente')
  ) {
    return { semPedido: 'nao_vai_a_plataforma' };
  }

  const cena = cenaDoCanal(configuracao, ponto);
  if (cena === null) return { semPedido: 'falta_a_cena' };

  // Critério de quadro manda o mapa e o recorte; critério geral, a imagem completa — que já é o canal.
  const quadro = cena.quadros.find((q) => q.zonaId === zona.id) ?? null;
  const mapa = quadro !== null ? (imagens.mapa ?? null) : null;
  if (quadro !== null && (mapa === null || item.mapa === null)) return { semPedido: 'falta_o_mapa' };

  // A foto padrão vai quando o critério pede (estado e ação) e na comparação que não deu "igual" —
  // que sem a foto nem pergunta.
  const levaAFoto = ehComparacao || criterio.comPadrao === true;
  let foto: { nome: string; imagem: Imagem } | null = null;
  if (levaAFoto && item.fotoPadrao !== null) {
    const guardada = (ponto.padroes ?? []).find((f) => f.id === item.fotoPadrao);
    if (!guardada || !imagens.padrao) return { semPedido: 'foto_padrao_fora_da_configuracao' };
    foto = { nome: texto(guardada.nome) || 'foto padrão', imagem: imagens.padrao };
  }
  if (ehComparacao && foto === null) return { semPedido: 'nao_vai_a_plataforma' };

  const conteudo: Bloco[] = [{ type: 'text', text: blocoDaCena(cena) }];
  if (mapa !== null) {
    conteudo.push({ type: 'text', text: legendaDoMapa(cena, item.mapa === 'esquema') });
    conteudo.push(blocoDeImagem(mapa));
    conteudo.push({ type: 'text', text: 'FIM DO MAPA.', cache_control: FIM_DO_FIXO });
  } else {
    // Sem mapa, o trecho fixo do canal é só a cena.
    (conteudo[0] as BlocoDeTexto).cache_control = FIM_DO_FIXO;
  }
  if (foto !== null) {
    conteudo.push({ type: 'text', text: avisoDaFotoPadrao(foto.nome) });
    conteudo.push(blocoDeImagem(foto.imagem));
    conteudo.push({ type: 'text', text: 'FIM DA FOTO PADRÃO.', cache_control: FIM_DO_FIXO });
  }
  conteudo.push({ type: 'text', text: qualImagem(quadro) });
  conteudo.push(blocoDeImagem(imagens.auditada));
  conteudo.push({ type: 'text', text: aPergunta(item.criterio, criterio.processoDescricao, item.foraDaArea, zona.equipamentos) });
  return { conteudo };
}

// ─────────────────────── a chamada ───────────────────────

/** O modelo de rotina do pedido com contexto, e o forte, da reconsulta. */
export const MODELO_DE_ROTINA = 'claude-haiku-5-5';
export const MODELO_FORTE = 'claude-sonnet-5-5';

/** A reconsulta é a MESMA pergunta ao modelo forte, quando a primeira resposta vem com confiança abaixo disto. */
export const RECONSULTAR_ABAIXO_DE = 0.75;

/**
 * Como o modelo chega à ferramenta. Forçada, a resposta é só a ferramenta.
 * Livre, o modelo escreve antes de chamá-la, e isso conta na saída: o teto
 * é maior, senão a resposta sairia cortada antes da ferramenta.
 */
const ESCOLHAS = {
  forcada: { max_tokens: 300, tool_choice: { type: 'tool', name: 'responder' } },
  livre: { max_tokens: 2000, tool_choice: { type: 'auto' } },
} as const;
export type Escolha = keyof typeof ESCOLHAS;

/** Os modelos que RECUSAM a escolha forçada da ferramenta: vão sempre com a livre. */
export const SEM_ESCOLHA_FORCADA: readonly string[] = [MODELO_FORTE];

/** As duas chamadas que um pedido pode virar: a de rotina e a reconsulta. */
export const CHAMADAS = {
  rotina: { model: MODELO_DE_ROTINA, ...ESCOLHAS.forcada },
  reconsulta: { model: MODELO_FORTE, ...ESCOLHAS.livre, abaixoDe: RECONSULTAR_ABAIXO_DE },
} as const;

/** O corpo de UMA chamada à plataforma: o modelo, a escolha, as instruções (em cache), a ferramenta e o conteúdo. */
export function corpoDaChamada(conteudo: Bloco[], modelo: string, escolha: Escolha) {
  return {
    model: modelo,
    ...ESCOLHAS[escolha],
    system: [{ type: 'text' as const, text: INSTRUCOES_COM_CONTEXTO, cache_control: FIM_DO_FIXO }],
    tools: [FERRAMENTA],
    messages: [{ role: 'user' as const, content: conteudo }],
  };
}

/** O corpo da chamada de rotina, ou o da reconsulta. */
export const pedidoParaAPlataforma = (conteudo: Bloco[], qual: keyof typeof CHAMADAS = 'rotina') =>
  qual === 'rotina' ? corpoDaChamada(conteudo, MODELO_DE_ROTINA, 'forcada') : corpoDaChamada(conteudo, MODELO_FORTE, 'livre');
