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
//
// DOIS JEITOS DE CONECTAR (F6 do Hub DMS, 15/11/2026):
//
//   • a página de 01/10 ("Autorizar o Farol"): o segredo do aplicativo
//     (`REGEM_CLIENT_SECRET`) e o `rgm_it_` de cada loja;
//   • o CLIQUE do Padrão DMS, com a chave `FAROL_REGEM_CLIQUE`: o pedido
//     empurrado (RFC 9126) e a troca vão com o token do DMS ID do aplicativo
//     do Farol, a volta traz o `iss` do Regem (RFC 9207) e cada loja ganha a
//     LIGAÇÃO `dms_lg_regem_…`, que vale junto com aquele token (cabeçalho
//     `DMS-Ligacao`). Vazar um só não abre nada.
//
// O acesso guardado diz sozinho por qual via vai: o que começa com
// `dms_lg_regem_` é ligação. Por isso quem lê, avisa e devolve não muda.
// =====================================================================

import { createHash, randomBytes } from 'node:crypto';

import { lerChave } from './cifra.js';
import { ClienteDmsId, ErroDmsId } from './dms/integracao-dms.js';

/** As três leituras que o Farol pede ao Regem (as mesmas da página de 01/10), na ordem do catálogo de lá. */
export const LEITURAS_DO_REGEM = ['catalogo.ler', 'fichas.ler', 'producao.ler'] as const;

/** O aplicativo do Farol no DMS ID, pronto para pedir o token que vai ao Regem. */
export type ViaDoDmsId = {
  cliente: ClienteDmsId;
  /** O `client_id` do Farol no DMS ID: vai na página do Regem, para ela saber quem pede. */
  aplicativo: string;
  /** O destino do token: a porta de integração do Regem (`<apiUrl>/integracao`). */
  recurso: string;
  /** O `iss` que a volta do Regem traz: a origem da API dele. */
  emissorDoRegem: string;
};

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
  /**
   * Onde ESTE servidor recebe o aviso do Regem, visto de fora — com a barra
   * no fim; o que vem depois é o id da conexão. Ausente: o endereço de
   * produção. O Regem só aceita registrar endereço dentro do que a
   * distribuição de lá listou para o Farol.
   */
  avisoUrl?: string;
  buscar: typeof fetch;
  prazoMs: number;
  agente: string;
  /**
   * O aplicativo do Farol no DMS ID (`DMS_ID_EMISSOR`, `DMS_ID_APLICATIVO`,
   * `DMS_ID_SEGREDO`). Com ele, a loja ligada pelo clique é lida, avisada e
   * devolvida. Ausente = sem as variáveis.
   */
  dmsId?: ViaDoDmsId | null;
  /** O botão pede pelo clique (`FAROL_REGEM_CLIQUE` e o DMS ID no lugar). Desligado: a página de 01/10. */
  clique?: boolean;
};

/** O segredo mais curto que isto é tratado como não configurado — a mesma régua do Regem. */
const SEGREDO_MINIMO = 32;

/** Onde o servidor do Farol recebe o aviso do Regem, em produção (o que o Regem tem listado para o Farol). */
export const AVISO_URL_DE_PRODUCAO = 'https://api.monitorfarol.com.br/v1/regem/avisos/';

/**
 * O contexto que entra na cifra do acesso de uma loja: o acesso da loja A,
 * colado na linha da loja B, não abre.
 */
export const contextoDoAcesso = (tenantId: string, regemLojaId: string): string => `acesso:${tenantId}:${regemLojaId}`;

export function configDoRegem(env: NodeJS.ProcessEnv = process.env, versao = '0.1.0'): ConfigDoRegem {
  const semBarra = (u: string) => u.replace(/\/+$/, '');
  const segredo = (env.REGEM_CLIENT_SECRET ?? '').trim();
  const consoleUrl = semBarra(env.FAROL_CONSOLE_URL || 'https://app.monitorfarol.com.br');
  const apiUrl = semBarra(env.REGEM_API_URL || 'https://api.dmsregem.com/api/v1');
  const dmsId = viaDoDmsId(env, apiUrl);
  return {
    apiUrl,
    appUrl: semBarra(env.REGEM_APP_URL || 'https://app.dmsregem.com'),
    retornoUrl: env.REGEM_RETORNO_URL || `${consoleUrl}/api/regem/retorno`,
    consoleUrl,
    segredo: segredo.length >= SEGREDO_MINIMO ? segredo : null,
    chave: lerChave(env.FAROL_CHAVE_DOS_ACESSOS),
    avisoUrl: `${semBarra(env.REGEM_AVISO_URL || AVISO_URL_DE_PRODUCAO)}/`,
    buscar: fetch,
    prazoMs: 10_000,
    agente: `farol-api/${versao} (+https://monitorfarol.com.br)`,
    dmsId,
    clique: cliqueLigado(env) && dmsId !== null,
  };
}

/** A chave do clique (`FAROL_REGEM_CLIQUE`): `true`, `1` ou `sim`. Nasce desligada. */
export function cliqueLigado(env: NodeJS.ProcessEnv): boolean {
  return ['true', '1', 'sim'].includes((env.FAROL_REGEM_CLIQUE ?? '').trim().toLowerCase());
}

/**
 * O aplicativo do Farol no DMS ID, das três variáveis. Falta uma: nulo (e
 * o clique não liga). A origem da API do Regem é o `iss` da volta.
 */
export function viaDoDmsId(env: NodeJS.ProcessEnv, apiUrl: string, buscar?: typeof fetch): ViaDoDmsId | null {
  const emissor = (env.DMS_ID_EMISSOR ?? '').trim().replace(/\/+$/, '');
  const aplicativo = (env.DMS_ID_APLICATIVO ?? '').trim();
  const segredo = (env.DMS_ID_SEGREDO ?? '').trim();
  if (!emissor || !aplicativo || !segredo) return null;
  let emissorDoRegem: string;
  try {
    emissorDoRegem = new URL(apiUrl).origin;
  } catch {
    return null;
  }
  return {
    cliente: new ClienteDmsId({ emissor, aplicativo, segredo, ...(buscar ? { buscar } : {}) }),
    aplicativo,
    recurso: `${apiUrl}/integracao`,
    emissorDoRegem,
  };
}

/** Por que o clique ficou desligado com a chave ligada (vai ao registro, para quem cuida da instalação). Nulo = nada errado. */
export function motivoDoCliqueDesligado(env: NodeJS.ProcessEnv, cfg: ConfigDoRegem): string | null {
  if (!cliqueLigado(env) || cfg.clique) return null;
  return 'FAROL_REGEM_CLIQUE está ligada, mas falta DMS_ID_EMISSOR, DMS_ID_APLICATIVO ou DMS_ID_SEGREDO (o aplicativo do Farol no DMS ID): o botão segue na página de 01/10';
}

/** A via do clique, quando o botão pede por ela. */
export function viaDoClique(cfg: ConfigDoRegem): ViaDoDmsId | null {
  return cfg.clique && cfg.dmsId ? cfg.dmsId : null;
}

/** Dá para conectar: a chave que cifra os acessos e um dos dois jeitos (o segredo da página de 01/10 ou o clique). */
export function conexaoDisponivel(cfg: ConfigDoRegem): cfg is ConfigDoRegem & { chave: Buffer } {
  return cfg.chave !== null && (cfg.segredo !== null || viaDoClique(cfg) !== null);
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

/** A ligação de uma loja pelo clique: é por este começo que o acesso guardado diz a via. */
const PREFIXO_DA_LIGACAO = 'dms_lg_regem_';
export const ehLigacao = (acesso: string): boolean => acesso.startsWith(PREFIXO_DA_LIGACAO);

/** O nome do problema (o último trecho do `type` do problem+json do Regem), ou vazio. */
const problemaDe = (json: unknown): string => {
  const tipo = (json as { type?: unknown } | null)?.type;
  return typeof tipo === 'string' ? (tipo.split('/').pop() ?? '') : '';
};

/** O token do DMS ID do Farol para o Regem. O DMS ID que não responde é passageiro; o que recusa, defeito da instalação. */
async function tokenDoDmsId(via: ViaDoDmsId): Promise<string> {
  try {
    return await via.cliente.token(via.recurso, LEITURAS_DO_REGEM);
  } catch (e) {
    if (e instanceof ErroDmsId) throw new ErroDoRegem(e.status === 0 || e.status >= 500 ? 'sem_resposta' : 'cliente_invalido', e.status || null);
    throw e;
  }
}

async function chamar(
  cfg: ConfigDoRegem,
  caminho: string,
  opcoes: { corpo?: unknown; acesso?: string; metodo?: 'GET' | 'POST' | 'PUT'; peloAplicativo?: boolean },
): Promise<{ status: number; json: unknown }> {
  // Pela ligação (o acesso da loja) ou só pelo aplicativo (o pedido e a troca do clique): o token do DMS ID vai junto.
  const pelaLigacao = !!opcoes.acesso && ehLigacao(opcoes.acesso);
  const via = pelaLigacao || opcoes.peloAplicativo ? (cfg.dmsId ?? null) : null;
  // Loja ligada pelo clique numa instalação sem o DMS ID: defeito da instalação, nunca "o acesso não vale".
  if ((pelaLigacao || opcoes.peloAplicativo) && !via) throw new ErroDoRegem('cliente_invalido');

  for (let vez = 0; ; vez++) {
    const credencial = via ? await tokenDoDmsId(via) : opcoes.acesso;
    let r: Response;
    try {
      r = await cfg.buscar(`${cfg.apiUrl}${caminho}`, {
        method: opcoes.metodo ?? 'POST',
        headers: {
          accept: 'application/json',
          'user-agent': cfg.agente,
          ...(opcoes.corpo !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(credencial ? { authorization: `Bearer ${credencial}` } : {}),
          ...(pelaLigacao ? { 'dms-ligacao': opcoes.acesso! } : {}),
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
    if (via && r.status === 401 && problemaDe(json) !== 'ligacao-invalida') {
      // O token do DMS ID recusado (vencido, trocado lá): pede outro e tenta uma vez mais.
      if (vez === 0) {
        via.cliente.esquecer(via.recurso, LEITURAS_DO_REGEM);
        continue;
      }
      // Recusado de novo: é do APLICATIVO, não da loja. Nunca vira "acesso tirado" (que apagaria as fichas dela):
      // pela ligação, só `ligacao-invalida` é da loja (a regra do Liame, ERR-149 de lá).
      if (pelaLigacao) throw new ErroDoRegem('sem_resposta', 401);
    }
    return { status: r.status, json };
  }
}

export type LojaAutorizada = { regemLojaId: string; nome: string; empresa: string; acesso: string };

const FORMATO_DA_LIGACAO = /^dms_lg_regem_[A-Za-z0-9_-]{43}_[A-Za-z0-9_-]{6}$/;
const FORMATO_DO_NUMERO = /^urn:ietf:params:oauth:request_uri:rgm_[A-Za-z0-9_-]{43}$/;

/**
 * As lojas da resposta da troca, conferidas. Pela página de 01/10 o acesso
 * vem em `token`; pelo clique, em `ligacao` (com a cara da ligação do Regem e
 * as fichas entre as permissões). Resposta torta: nada é guardado.
 */
function lojasDaTroca(json: unknown, status: number, via: 'chave' | 'clique'): LojaAutorizada[] {
  const lista = (json as { lojas?: unknown } | null)?.lojas;
  if (!Array.isArray(lista) || lista.length === 0 || lista.length > 200) throw new ErroDoRegem('resposta_torta', status);
  const lojas: LojaAutorizada[] = [];
  for (const l of lista as Record<string, unknown>[]) {
    const id = texto(l?.loja_id, 64);
    const nome = texto(l?.loja_nome, 200);
    const empresa = texto(l?.empresa_nome, 200);
    const acesso = texto(via === 'clique' ? l?.ligacao : l?.token, 400);
    if (!id || !UUID.test(id) || !nome || !empresa || !acesso) throw new ErroDoRegem('resposta_torta', status);
    if (via === 'clique') {
      const permissoes = Array.isArray(l?.permissoes) ? (l.permissoes as unknown[]) : [];
      if (!FORMATO_DA_LIGACAO.test(acesso) || !permissoes.includes('fichas.ler')) throw new ErroDoRegem('resposta_torta', status);
    }
    lojas.push({ regemLojaId: id.toLowerCase(), nome, empresa, acesso });
  }
  if (new Set(lojas.map((l) => l.regemLojaId)).size !== lojas.length) throw new ErroDoRegem('resposta_torta', status);
  return lojas;
}

/**
 * Troca o código da autorização pelos acessos das lojas (página de 01/10).
 * O código vale uma tentativa: recusado aqui, a pessoa começa de novo.
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
  return lojasDaTroca(json, status, 'chave');
}

// ───────────────────────────── o clique (Padrão DMS §3) ─────────────────────────────

/**
 * Empurra o pedido ao Regem (RFC 9126), com o token do DMS ID, e devolve a
 * página de lá para onde o navegador vai. A conta do Farol não tem CNPJ:
 * não vai (o presidente confirma "outra empresa").
 */
export async function pedirPeloClique(
  cfg: ConfigDoRegem,
  via: ViaDoDmsId,
  p: Pick<Pedido, 'state' | 'desafio'> & { contaNome: string; contaEmail: string },
): Promise<string> {
  const { status, json } = await chamar(cfg, '/integracao/autorizacao/pedido', {
    peloAplicativo: true,
    corpo: {
      response_type: 'code',
      redirect_uri: cfg.retornoUrl,
      scope: LEITURAS_DO_REGEM.join(' '),
      state: p.state,
      code_challenge: p.desafio,
      code_challenge_method: 'S256',
      conta_nome: p.contaNome.slice(0, 120) || 'Conta do Farol',
      conta_email: p.contaEmail,
    },
  });
  if (status === 401) throw new ErroDoRegem('cliente_invalido', status);
  if (status !== 201) throw new ErroDoRegem('recusado', status);
  const numero = (json as { request_uri?: unknown } | null)?.request_uri;
  if (typeof numero !== 'string' || !FORMATO_DO_NUMERO.test(numero)) throw new ErroDoRegem('resposta_torta', status);
  const url = new URL(`${cfg.appUrl}/integracoes/autorizar`);
  url.searchParams.set('client_id', via.aplicativo);
  url.searchParams.set('request_uri', numero);
  return url.toString();
}

/** Troca o código do clique pela ligação de cada loja, com o token do DMS ID. Vale uma tentativa, como a de 01/10. */
export async function trocarCodigoPeloClique(cfg: ConfigDoRegem, p: { codigo: string; verificador: string }): Promise<LojaAutorizada[]> {
  const { status, json } = await chamar(cfg, '/integracao/autorizacao/token', {
    peloAplicativo: true,
    corpo: { grant_type: 'authorization_code', code: p.codigo, code_verifier: p.verificador, redirect_uri: cfg.retornoUrl },
  });
  if (status === 401) throw new ErroDoRegem('cliente_invalido', status);
  if (status !== 200) throw new ErroDoRegem('recusado', status);
  return lojasDaTroca(json, status, 'clique');
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

// ───────────────────────────── o aviso ─────────────────────────────

/**
 * Diz ao Regem para onde avisar "algo mudou nesta loja", e com que segredo
 * assinar. Registrar de novo com o mesmo endereço e o mesmo segredo é o
 * dia a dia: religa o que o Regem tiver pausado e não muda mais nada.
 *
 *   registrado      o Regem aceitou;
 *   nao_habilitado  o Regem (ainda) não aceita aviso para o Farol, ou não
 *                   para este endereço. Não é erro: vale a leitura diária.
 *
 * O segredo vai no corpo e não aparece em erro nem em registro.
 */
export async function registrarAviso(
  cfg: ConfigDoRegem,
  acesso: string,
  p: { url: string; segredo: string },
): Promise<'registrado' | 'nao_habilitado'> {
  const { status } = await chamar(cfg, '/integracao/webhook', { acesso, metodo: 'PUT', corpo: { url: p.url, segredo: p.segredo } });
  if (status === 200) return 'registrado';
  if (status === 422) return 'nao_habilitado';
  if (status === 401) throw new ErroDoRegem('acesso_tirado', status);
  throw new ErroDoRegem('recusado', status);
}

// ───────────────────────────── as leituras ─────────────────────────────

/** O que uma leitura devolve: o retrato inteiro, ou só "nada mudou desde a versão que você tem". */
export type Retrato = { mudou: true; versao: string; corpo: unknown } | { mudou: false; versao: string };

const VERSAO = /^[0-9a-f]{8,64}$/i;

/**
 * Lê um retrato da loja do acesso (o cardápio, as fichas ou a fila da
 * cozinha — `producao`, a janela do que está em produção). Com a versão que
 * se tem guardada, o Regem responde só "nada mudou" quando é o caso.
 *
 * 401 aqui quer dizer UMA coisa: o acesso desta loja não vale mais.
 */
export async function lerRetrato(
  cfg: ConfigDoRegem,
  acesso: string,
  qual: 'catalogo' | 'fichas' | 'producao',
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
