// =====================================================================
// O Regem, visto do servidor do Farol
// =====================================================================
// O Regem é uma FONTE: de onde vêm as fichas e os produtos de uma loja.
// Este arquivo é o adaptador dela — tudo o que sabe falar com o Regem
// está aqui, e o resto do servidor não conhece endereço, formato nem
// regra de lá. Amanhã a mesma base recebe planilha ou outro sistema por
// outro adaptador, sem mexer em quem a usa.
//
// É também a primeira vez que o servidor do Farol chama outro sistema.
// Três cuidados que valem para toda chamada daqui:
//
//   • prazo curto (10 s): o Regem fora do ar não pode prender uma rota do
//     console;
//   • `user-agent` próprio: o Regem fica atrás da Cloudflare, que recusa
//     cliente sem identificação;
//   • o código da autorização, o segredo do aplicativo e o acesso de cada
//     loja NUNCA vão para registro, mensagem de erro nem resposta. O erro
//     que sai daqui diz só o motivo.
//
// O contrato é o do Regem (`docs/integracao-farol.md`, lá): a página de
// autorização com `state` e PKCE, a troca do código pelos acessos das
// lojas e a devolução de um acesso.
// =====================================================================

import { createHash, randomBytes } from 'node:crypto';

import { lerChave } from './cifra.js';

export type ConfigDoRegem = {
  /** A API do Regem, com o prefixo: `https://api.dmsregem.com/api/v1`. */
  apiUrl: string;
  /** O endereço do Regem para a pessoa: onde fica a página de autorização. */
  appUrl: string;
  /**
   * Para onde o Regem devolve a pessoa. É o endereço do CONSOLE do Farol
   * (que repassa a este servidor), e não o deste servidor: só assim a
   * volta chega com a sessão de quem começou.
   */
  retornoUrl: string;
  /** O console do Farol: para onde a pessoa vai depois da volta. */
  consoleUrl: string;
  /** O segredo do aplicativo, igual ao do Regem. `null` = não configurado. */
  segredo: string | null;
  /** A chave que cifra os acessos guardados. `null` = não configurada. */
  chave: Buffer | null;
  buscar: typeof fetch;
  prazoMs: number;
  agente: string;
};

/** O segredo mais curto que isto é tratado como não configurado — a mesma régua do Regem. */
const SEGREDO_MINIMO = 32;

export function configDoRegem(env: NodeJS.ProcessEnv = process.env, versao = '0.1.0'): ConfigDoRegem {
  const semBarra = (u: string) => u.replace(/\/+$/, '');
  const segredo = (env.REGEM_CLIENT_SECRET ?? '').trim();
  const consoleUrl = semBarra(env.FAROL_CONSOLE_URL || 'https://app.monitorfarol.com.br');
  return {
    apiUrl: semBarra(env.REGEM_API_URL || 'https://api.dmsregem.com/api/v1'),
    appUrl: semBarra(env.REGEM_APP_URL || 'https://app.dmsregem.com'),
    retornoUrl: env.REGEM_RETORNO_URL || `${consoleUrl}/api/regem/retorno`,
    consoleUrl,
    segredo: segredo.length >= SEGREDO_MINIMO ? segredo : null,
    chave: lerChave(env.FAROL_CHAVE_DOS_ACESSOS),
    buscar: fetch,
    prazoMs: 10_000,
    agente: `farol-api/${versao} (+https://monitorfarol.com.br)`,
  };
}

/** Só dá para conectar com as duas peças do ambiente no lugar. */
export function conexaoDisponivel(cfg: ConfigDoRegem): cfg is ConfigDoRegem & { segredo: string; chave: Buffer } {
  return cfg.segredo !== null && cfg.chave !== null;
}

/**
 * O que deu errado ao falar com o Regem — o MOTIVO, sem o conteúdo:
 *   sem_resposta      rede, prazo ou erro do servidor de lá (vale tentar de novo);
 *   recusado          o Regem recusou o pedido (código vencido ou já usado; acesso que não vale);
 *   cliente_invalido  o segredo do aplicativo daqui não é o que o Regem tem;
 *   resposta_torta    respondeu, mas não no formato do contrato;
 *   acesso_tirado     numa LEITURA, o Regem disse que o acesso da loja não vale mais
 *                     (alguém o tirou por lá, ou a loja foi autorizada de novo em outro lugar).
 */
export class ErroDoRegem extends Error {
  constructor(
    readonly motivo: 'sem_resposta' | 'recusado' | 'cliente_invalido' | 'resposta_torta' | 'acesso_tirado',
    readonly status: number | null = null,
  ) {
    super(`regem: ${motivo}${status ? ` (${status})` : ''}`);
  }
}

// ───────────────────────────── a ida ─────────────────────────────

export type Pedido = { state: string; verificador: string; desafio: string };

export function impressao(valor: string): string {
  return createHash('sha256').update(valor, 'utf8').digest('hex');
}

/** O `state` e o par do PKCE de um pedido novo — tudo aleatório, nada derivado da conta. */
export function novoPedido(): Pedido {
  const state = randomBytes(32).toString('base64url');
  const verificador = randomBytes(48).toString('base64url');
  const desafio = createHash('sha256').update(verificador, 'ascii').digest('base64url');
  return { state, verificador, desafio };
}

export function urlDeAutorizacao(cfg: ConfigDoRegem, p: Pick<Pedido, 'state' | 'desafio'>): string {
  const url = new URL(`${cfg.appUrl}/integracoes/autorizar`);
  url.searchParams.set('cliente', 'farol');
  url.searchParams.set('redirect_uri', cfg.retornoUrl);
  url.searchParams.set('state', p.state);
  url.searchParams.set('code_challenge', p.desafio);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

// ───────────────────────────── as chamadas ─────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const texto = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null);

async function chamar(
  cfg: ConfigDoRegem,
  caminho: string,
  opcoes: { corpo?: unknown; acesso?: string; metodo?: 'GET' | 'POST' },
): Promise<{ status: number; json: unknown }> {
  let r: Response;
  try {
    r = await cfg.buscar(`${cfg.apiUrl}${caminho}`, {
      method: opcoes.metodo ?? 'POST',
      headers: {
        accept: 'application/json',
        'user-agent': cfg.agente,
        ...(opcoes.corpo !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(opcoes.acesso ? { authorization: `Bearer ${opcoes.acesso}` } : {}),
      },
      body: opcoes.corpo !== undefined ? JSON.stringify(opcoes.corpo) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(cfg.prazoMs),
    });
  } catch {
    // Rede, prazo, redirecionamento: o motivo técnico não muda o que a
    // rota faz, e o texto do erro pode trazer o endereço com o código.
    throw new ErroDoRegem('sem_resposta');
  }
  if (r.status >= 500 || r.status === 429) throw new ErroDoRegem('sem_resposta', r.status);
  let json: unknown = null;
  try {
    json = await r.json();
  } catch {
    if (r.ok) throw new ErroDoRegem('resposta_torta', r.status);
  }
  return { status: r.status, json };
}

export type LojaAutorizada = { regemLojaId: string; nome: string; empresa: string; acesso: string };

/**
 * Troca o código da autorização pelos acessos das lojas. O código vale
 * uma tentativa: recusado aqui, a pessoa começa de novo.
 */
export async function trocarCodigo(
  cfg: ConfigDoRegem & { segredo: string },
  p: { codigo: string; verificador: string },
): Promise<LojaAutorizada[]> {
  const { status, json } = await chamar(cfg, '/integracao/autorizacao/token', {
    corpo: {
      code: p.codigo,
      code_verifier: p.verificador,
      redirect_uri: cfg.retornoUrl,
      client_id: 'farol',
      client_secret: cfg.segredo,
    },
  });
  if (status === 401) throw new ErroDoRegem('cliente_invalido', status);
  if (status !== 200) throw new ErroDoRegem('recusado', status);
  const lista = (json as { lojas?: unknown } | null)?.lojas;
  if (!Array.isArray(lista) || lista.length === 0 || lista.length > 200) throw new ErroDoRegem('resposta_torta', status);
  const lojas: LojaAutorizada[] = [];
  for (const l of lista as Record<string, unknown>[]) {
    const id = texto(l?.loja_id, 64);
    const nome = texto(l?.loja_nome, 200);
    const empresa = texto(l?.empresa_nome, 200);
    const acesso = texto(l?.token, 400);
    if (!id || !UUID.test(id) || !nome || !empresa || !acesso) throw new ErroDoRegem('resposta_torta', status);
    lojas.push({ regemLojaId: id.toLowerCase(), nome, empresa, acesso });
  }
  if (new Set(lojas.map((l) => l.regemLojaId)).size !== lojas.length) throw new ErroDoRegem('resposta_torta', status);
  return lojas;
}

/**
 * Devolve ao Regem o acesso de uma loja. "Já não valia" (401) conta como
 * devolvido: é o estado que se queria. `sem_resposta` e `resposta_torta`
 * deixam em dúvida (vale tentar de novo); `recusado` é a palavra final dele.
 */
export async function devolverAcesso(cfg: ConfigDoRegem, acesso: string): Promise<void> {
  const { status } = await chamar(cfg, '/integracao/autorizacao/revogar', { acesso });
  if (status === 200 || status === 401) return;
  throw new ErroDoRegem('recusado', status);
}

// ───────────────────────────── as leituras ─────────────────────────────

/** O que uma leitura devolve: o retrato inteiro, ou só "nada mudou desde a versão que você tem". */
export type Retrato = { mudou: true; versao: string; corpo: unknown } | { mudou: false; versao: string };

const VERSAO = /^[0-9a-f]{8,64}$/i;

/**
 * Lê um retrato da loja do acesso (o cardápio ou as fichas). Com a versão
 * que se tem guardada, o Regem responde só "nada mudou" quando é o caso.
 *
 * 401 aqui quer dizer UMA coisa: o acesso desta loja não vale mais.
 */
export async function lerRetrato(
  cfg: ConfigDoRegem,
  acesso: string,
  qual: 'catalogo' | 'fichas',
  versaoQueTenho: string | null,
): Promise<Retrato> {
  const pergunta = versaoQueTenho && VERSAO.test(versaoQueTenho) ? `?versao=${versaoQueTenho}` : '';
  const { status, json } = await chamar(cfg, `/integracao/${qual}${pergunta}`, { acesso, metodo: 'GET' });
  if (status === 401) throw new ErroDoRegem('acesso_tirado', status);
  if (status !== 200) throw new ErroDoRegem('recusado', status);
  const corpo = json as { versao?: unknown; atualizado?: unknown } | null;
  const versao = corpo && typeof corpo.versao === 'string' && VERSAO.test(corpo.versao) ? corpo.versao : null;
  if (!versao || typeof corpo!.atualizado !== 'boolean') throw new ErroDoRegem('resposta_torta', status);
  if (corpo!.atualizado === false) {
    // "Nada mudou" só vale como resposta a quem perguntou com versão.
    if (!pergunta) throw new ErroDoRegem('resposta_torta', status);
    return { mudou: false, versao };
  }
  return { mudou: true, versao, corpo: json };
}
