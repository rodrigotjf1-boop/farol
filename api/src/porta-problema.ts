// =====================================================================
// A resposta de erro da porta para outro sistema, no Padrão DMS
// =====================================================================
// A porta (`/v1/integracao/...`) é a primeira porta do Farol aberta a
// sistemas de fora, e segue o Padrão DMS de integração (Hub DMS, aprovado
// pelo dono em 14/10/2026): erro em `application/problem+json` (RFC 9457),
// com `type`, `title`, `status` e `detail`.
//
// O contrato de erro do Farol (`{ erro, mensagem }`, `erros.ts`) NÃO some:
// `erro` e `mensagem` vão no mesmo corpo, como membros de extensão (RFC 9457
// §3.2). Quem já lê `erro` continua lendo; quem integra com vários produtos
// da DMS lê `type` e `detail`.
//
// Só a porta responde assim. O console segue no contrato de sempre.
// =====================================================================

import type { FastifyReply, FastifyRequest } from 'fastify';

import { TIPO_CONTEUDO_PROBLEMA, corpoProblema, type TipoProblema } from './dms/integracao-dms.js';

/** O pedido é da porta para outro sistema? */
export function ehDaPorta(url: string | undefined): boolean {
  // A URL inteira serve: o caminho é o começo dela, e a consulta (`?…`) vem depois da barra que se procura.
  return (url ?? '').startsWith('/v1/integracao/');
}

/**
 * Responde um erro da porta: `application/problem+json` com os campos do Padrão, o código de rastreio e os campos do
 * Farol (`erro`, `mensagem`) como extensão. `detail` é a `mensagem`.
 */
export function responderNaPorta(
  req: FastifyRequest,
  resposta: FastifyReply,
  status: number,
  tipo: TipoProblema,
  erro: string,
  mensagem: string,
  extras: { wwwAuthenticate?: string; retryAfterSeg?: number; campos?: Record<string, unknown> } = {},
): FastifyReply {
  if (extras.wwwAuthenticate) resposta.header('www-authenticate', extras.wwwAuthenticate);
  if (extras.retryAfterSeg) resposta.header('retry-after', String(extras.retryAfterSeg));
  const corpo = { ...corpoProblema(tipo, mensagem, { status, requestId: String(req.id) }), erro, mensagem, ...(extras.campos ?? {}) };
  return resposta.status(status).header('content-type', `${TIPO_CONTEUDO_PROBLEMA}; charset=utf-8`).send(JSON.stringify(corpo));
}
