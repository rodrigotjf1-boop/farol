// =====================================================================
// O balcão — a chamada à plataforma
// =====================================================================
// O pedido montado (`pedido.ts`) vira uma chamada à plataforma de IA, com a
// conta DA LOJA, e a resposta vira um veredito. Este módulo é a chamada e a
// leitura da resposta — não sabe de banco, de loja nem de teto.
//
// Faz o que o agente faz hoje, igual (o agente ainda pergunta por conta
// própria, até a loja ser ligada ao balcão). A prova é a parte `respostas`
// de `contratos/pedido-com-contexto.json`: o que a plataforma devolve,
// chamada a chamada, e o veredito, o custo e as chamadas que saem disso —
// gerados pelo código do agente e exigidos daqui por
// `api/testes/balcao-plataforma.test.ts`.
//
// Quatro decisões, todas herdadas de lá:
//
//  1. **A resposta vem pela ferramenta.** Sem o bloco da ferramenta, ou com
//     um resultado que não existe, não há veredito: é erro, e vale tentar de
//     novo (a saída cortada no meio dá nisto).
//  2. **Reconsulta.** O modelo de rotina primeiro; só o que vem inseguro vai
//     ao forte — e nunca um "não deu para avaliar": se o de rotina não
//     conseguiu ver, o problema está na imagem. A reconsulta é reforço: se
//     ELA falha, fica a primeira resposta.
//  3. **O custo é a soma do que foi chamado**, em centavos de real, com a
//     conta de tokens que a plataforma devolve. Resposta sem a conta não tem
//     custo — zero seria dizer "de graça".
//  4. **Erro que vale tentar de novo × erro que não vale.** Chave recusada,
//     pedido recusado e modelo que não existe não passam na segunda vez.
//     Limite, sobrecarga, queda e resposta torta passam.
//
// Quem repete a pergunta não é este módulo: é a fila do agente, que guarda
// em disco e sobrevive ao processo. Aqui cada chamada vai UMA vez.
//
// A chave da conta entra, vai no cabeçalho da chamada e não fica em lugar
// nenhum: nem em erro, nem em registro.
// =====================================================================

import {
  CHAMADAS, MODELO_DE_ROTINA, MODELO_FORTE, RECONSULTAR_ABAIXO_DE, SEM_ESCOLHA_FORCADA, corpoDaChamada,
  type Bloco, type Escolha,
} from './pedido.js';
import { aparar } from './texto.js';

// ─────────────────────── o preço ───────────────────────
//
// ⚠️ VALOR DE REFERÊNCIA: serve para o teto do dia e para a estimativa que
// aparece no painel, não para fechar conta. A conta de verdade é a da
// plataforma, na conta da loja.

/** Dólar por milhão de tokens: a entrada, a saída, e quanto da entrada custa o que é lido do cache. */
export const PRECOS: Readonly<Record<string, { entrada: number; saida: number; leituraDoCache: number }>> = {
  [MODELO_DE_ROTINA]: { entrada: 0.1, saida: 0.5, leituraDoCache: 0.1 },
  [MODELO_FORTE]: { entrada: 2.0, saida: 10.0, leituraDoCache: 0.05 },
};
/** O que entra no cache custa isto vezes a entrada. */
export const ESCRITA_NO_CACHE = 1.25;
/** O câmbio de quem não diz outro (`FAROL_DOLAR`). */
export const DOLAR_DE_FABRICA = 5.4;

/** O câmbio que o ambiente do serviço diz (`FAROL_DOLAR`, reais por dólar) — ou o de fábrica, se não diz um número que sirva. */
export function dolarDoAmbiente(ambiente: { FAROL_DOLAR?: string | undefined }): number {
  const dito = Number((ambiente.FAROL_DOLAR ?? '').replace(',', '.'));
  return Number.isFinite(dito) && dito > 0 ? dito : DOLAR_DE_FABRICA;
}

// ─────────────────────── o que sai ───────────────────────

export type Resultado = 'conforme' | 'nao_conforme' | 'nao_avaliavel';
const RESULTADOS: readonly string[] = ['conforme', 'nao_conforme', 'nao_avaliavel'];

export type Veredito = {
  resultado: Resultado;
  /** De 0 a 1. Nulo = o modelo não disse (ou disse algo que não é número). */
  confianca: number | null;
  motivo: string | null;
  /** O modelo que deu ESTA resposta (depois de uma reconsulta que valeu, o forte). */
  modelo: string;
  tokensEntrada: number | null;
  tokensSaida: number | null;
  /** Em centavos de real. Depois de uma reconsulta, o das duas chamadas. Nulo = a plataforma não mandou a conta. */
  custoCentavos: number | null;
};

/** De que lado está o erro — para quem chama dizer a coisa certa a quem perguntou. */
export type ClasseDoErro = 'conta' | 'pedido' | 'limite' | 'plataforma' | 'resposta';

export class ErroDaPlataforma extends Error {
  readonly recuperavel: boolean;
  readonly classe: ClasseDoErro;
  /** O status HTTP, quando a plataforma chegou a responder. */
  readonly status: number | null;

  constructor(mensagem: string, o: { recuperavel: boolean; classe: ClasseDoErro; status?: number | null }) {
    super(mensagem);
    this.name = 'ErroDaPlataforma';
    this.recuperavel = o.recuperavel;
    this.classe = o.classe;
    this.status = o.status ?? null;
  }
}

// ─────────────────────── o transporte ───────────────────────

/** O que a plataforma respondeu a UMA chamada: o status e o corpo já lido (nulo quando não era JSON). */
export type RespostaHttp = { status: number; corpo: unknown };

/** Quem leva uma chamada à plataforma. O de verdade é `transporteHttp`; o teste põe o dele. */
export type Transporte = (corpo: unknown, chave: string) => Promise<RespostaHttp>;

export const ENDERECO_DA_PLATAFORMA = 'https://api.anthropic.com';
export const VERSAO_DA_API = '2023-06-01';
/** Quanto uma chamada espera. É o mesmo teto que o agente usa. */
export const LIMITE_DA_CHAMADA_MS = 30_000;

/**
 * O transporte de verdade: uma chamada HTTP, uma vez, com limite de tempo.
 * Queda de rede e tempo esgotado viram erro que vale tentar de novo — sem o
 * endereço e sem a chave na mensagem.
 */
export function transporteHttp(
  o: { endereco?: string; limiteMs?: number; buscar?: typeof fetch } = {},
): Transporte {
  const endereco = (o.endereco ?? ENDERECO_DA_PLATAFORMA).replace(/\/+$/, '');
  const limiteMs = o.limiteMs ?? LIMITE_DA_CHAMADA_MS;
  const buscar = o.buscar ?? fetch;
  return async (corpo, chave) => {
    const corte = new AbortController();
    const relogio = setTimeout(() => corte.abort(), limiteMs);
    try {
      const r = await buscar(`${endereco}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': chave,
          'anthropic-version': VERSAO_DA_API,
          // Cliente sem nome próprio é assinatura de robô para qualquer barreira no caminho.
          'user-agent': 'farol-balcao/1',
        },
        body: JSON.stringify(corpo),
        signal: corte.signal,
      });
      const escrito = await r.text();
      let lido: unknown = null;
      try {
        lido = JSON.parse(escrito);
      } catch {
        // Resposta que não é JSON: quem lê decide o que isso quer dizer, pelo status.
      }
      return { status: r.status, corpo: lido };
    } catch {
      throw new ErroDaPlataforma(
        corte.signal.aborted ? `a plataforma não respondeu em ${Math.round(limiteMs / 1000)} s` : 'não alcancei a plataforma',
        { recuperavel: true, classe: 'plataforma' },
      );
    } finally {
      clearTimeout(relogio);
    }
  };
}

// ─────────────────────── ler a resposta ───────────────────────

type Objeto = Record<string, unknown>;
const objeto = (v: unknown): Objeto => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Objeto) : {});

/** Um número escrito por extenso, sem mais nada: "0.8", "1e-3". */
const NUMERO = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * A confiança, de 0 a 1 — ou nulo. O modelo manda um número; o que vier
 * parecido (o número em texto, sim e não) é lido como o agente lê, e o que
 * não é número fica sem confiança.
 */
export function lerConfianca(bruto: unknown): number | null {
  let numero: number;
  if (typeof bruto === 'number') numero = bruto;
  else if (typeof bruto === 'boolean') numero = bruto ? 1 : 0;
  else if (typeof bruto === 'string' && NUMERO.test(aparar(bruto))) numero = Number(aparar(bruto));
  else return null;
  return Math.max(0, Math.min(1, numero));
}

const contagem = (v: unknown): number | null => (typeof v === 'number' ? v : null);

/** O custo de UMA chamada, em centavos de real — ou nulo, sem a conta de tokens ou sem preço para o modelo. */
export function custoDaChamada(modelo: string, uso: unknown, dolar: number): number | null {
  if (typeof uso !== 'object' || uso === null) return null;
  const preco = Object.hasOwn(PRECOS, modelo) ? PRECOS[modelo]! : null;
  // Modelo sem preço: devolver zero seria dizer "de graça", e custo falso é pior do que custo ausente.
  if (preco === null) return null;
  const u = uso as Objeto;
  const normais = contagem(u.input_tokens) ?? 0;
  const escrita = contagem(u.cache_creation_input_tokens) ?? 0;
  const leitura = contagem(u.cache_read_input_tokens) ?? 0;
  const saida = contagem(u.output_tokens) ?? 0;
  // A ordem das contas é a do agente: o número sai igual até a última casa.
  const emDolar =
    (normais * preco.entrada +
      escrita * preco.entrada * ESCRITA_NO_CACHE +
      leitura * preco.entrada * preco.leituraDoCache +
      saida * preco.saida) /
    1_000_000;
  return emDolar * dolar * 100;
}

/**
 * Quantos tokens de entrada um pedido pode ter, por cima: três imagens e
 * todo o texto no teto. É ESTIMATIVA — serve para reservar do teto do dia o
 * pior caso de uma dúvida, não para cobrar ninguém.
 */
export const ENTRADA_ESTIMADA = 8_000;

/**
 * Quanto uma dúvida segura do teto do dia enquanto não se sabe o custo
 * dela, em centavos: o pior caso — a chamada de rotina E a reconsulta, as
 * duas com a saída no teto. Quando a resposta chega, a reserva vira o custo
 * de verdade.
 */
export function reservaDeUmaDuvida(dolar: number = DOLAR_DE_FABRICA): number {
  const pior = (modelo: string, saida: number): number =>
    custoDaChamada(modelo, { input_tokens: ENTRADA_ESTIMADA, output_tokens: saida }, dolar) ?? 0;
  return pior(MODELO_DE_ROTINA, CHAMADAS.rotina.max_tokens) + pior(MODELO_FORTE, CHAMADAS.reconsulta.max_tokens);
}

const torta = (mensagem: string): ErroDaPlataforma => new ErroDaPlataforma(mensagem, { recuperavel: true, classe: 'resposta' });

/** O corpo de uma resposta 200, virado em veredito. Sem a ferramenta, ou sem um resultado que sirva: erro. */
export function lerVeredito(corpo: unknown, modelo: string, dolar: number): Veredito {
  const resposta = objeto(corpo);
  const blocos = Array.isArray(resposta.content) ? resposta.content : [];
  const daFerramenta = blocos.map(objeto).find((b) => b.type === 'tool_use' && b.name === 'responder');
  const parou = typeof resposta.stop_reason === 'string' ? resposta.stop_reason : '?';
  if (!daFerramenta) throw torta(`resposta sem o bloco da ferramenta (parou por: ${parou})`);

  const dados = objeto(daFerramenta.input);
  if (typeof dados.resultado !== 'string' || !RESULTADOS.includes(dados.resultado)) {
    throw torta(`resposta sem um resultado válido (parou por: ${parou})`);
  }
  const uso = resposta.usage ?? null;
  return {
    resultado: dados.resultado as Resultado,
    confianca: lerConfianca(dados.confianca),
    motivo: aparar(dados.motivo) || null,
    modelo,
    tokensEntrada: contagem(objeto(uso).input_tokens),
    tokensSaida: contagem(objeto(uso).output_tokens),
    custoCentavos: custoDaChamada(modelo, uso, dolar),
  };
}

/** Os status que não passam na segunda tentativa. Os quatro primeiros são os que o agente separa. */
const DEFINITIVOS: Readonly<Record<number, ClasseDoErro>> = {
  400: 'pedido', 401: 'conta', 403: 'conta', 404: 'pedido', 413: 'pedido', 422: 'pedido',
};

/** A resposta que não é 200, virada em erro: o status, a classe e o que a plataforma disse — sem o pedido e sem a chave. */
function erroDoStatus(r: RespostaHttp): ErroDaPlataforma {
  const dito = objeto(objeto(r.corpo).error);
  const tipo = typeof dito.type === 'string' ? dito.type : 'erro';
  const mensagem = typeof dito.message === 'string' ? dito.message.slice(0, 300) : '(sem mensagem)';
  const definitivo = Object.hasOwn(DEFINITIVOS, r.status);
  return new ErroDaPlataforma(`${r.status} ${tipo}: ${mensagem}`, {
    recuperavel: !definitivo,
    classe: definitivo ? DEFINITIVOS[r.status]! : r.status === 429 ? 'limite' : 'plataforma',
    status: r.status,
  });
}

/** O 400 que diz que ESTE modelo não aceita a ferramenta forçada. Não é pedido torto. */
const recusaDaEscolha = (e: unknown): boolean =>
  e instanceof ErroDaPlataforma && e.status === 400 && e.message.includes('tool_choice');

// Modelo fora da lista que recusar entra aqui na primeira recusa, para o erro
// não se repetir a cada dúvida. É o que este processo aprendeu sobre a
// plataforma — não é estado de pedido nenhum, nem de loja nenhuma.
const recusaramAEscolha = new Set<string>();

/** Só para teste: esquece o que o processo aprendeu sobre a escolha da ferramenta. */
export const esquecerRecusas = (): void => recusaramAEscolha.clear();

// ─────────────────────── perguntar ───────────────────────

export type Pergunta = {
  /** A chave da conta de IA da loja. Vai no cabeçalho da chamada, e em mais lugar nenhum. */
  chave: string;
  conteudo: Bloco[];
  enviar: Transporte;
  /** Reais por dólar, para a conta do custo. */
  dolar?: number;
};

export type Respondido = {
  veredito: Veredito;
  /** Os modelos chamados, na ordem — inclusive a chamada que falhou. */
  chamadas: string[];
};

/**
 * Pergunta à plataforma e devolve o veredito. Levanta `ErroDaPlataforma`
 * quando não há veredito — com `recuperavel` dizendo se vale tentar de novo.
 */
export async function perguntar(p: Pergunta): Promise<Respondido> {
  const dolar = p.dolar ?? DOLAR_DE_FABRICA;
  const chamadas: string[] = [];

  /** Uma chamada, uma vez: manda, e lê o veredito. */
  const chamar = async (modelo: string, escolha: Escolha): Promise<Veredito> => {
    chamadas.push(modelo);
    const r = await p.enviar(corpoDaChamada(p.conteudo, modelo, escolha), p.chave);
    if (r.status !== 200) throw erroDoStatus(r);
    return lerVeredito(r.corpo, modelo, dolar);
  };

  /** Força a escolha da ferramenta onde o modelo aceita; onde ele recusa, vai com a escolha livre. */
  const pedir = async (modelo: string): Promise<Veredito> => {
    if (!SEM_ESCOLHA_FORCADA.includes(modelo) && !recusaramAEscolha.has(modelo)) {
      try {
        return await chamar(modelo, 'forcada');
      } catch (e) {
        if (!recusaDaEscolha(e)) throw e;
        recusaramAEscolha.add(modelo);
      }
    }
    return chamar(modelo, 'livre');
  };

  let veredito = await pedir(MODELO_DE_ROTINA);

  if (veredito.resultado !== 'nao_avaliavel' && (veredito.confianca ?? 0) < RECONSULTAR_ABAIXO_DE) {
    try {
      const forte = await pedir(MODELO_FORTE);
      forte.custoCentavos = (veredito.custoCentavos ?? 0) + (forte.custoCentavos ?? 0);
      veredito = forte;
    } catch (e) {
      // A reconsulta é reforço: se ELA falha, a resposta que já existia não se perde.
      if (!(e instanceof ErroDaPlataforma)) throw e;
    }
  }
  return { veredito, chamadas };
}
