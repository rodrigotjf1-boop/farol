// =====================================================================
// O contrato de erro, inteiro
// =====================================================================
// Toda resposta de erro desta API tem a mesma forma:
//
//     { erro: "codigo_estavel", mensagem: "frase em pt-BR" }
//
// `erro` é para a máquina: estável, em minúsculas com sublinhado, nunca
// traduzido. `mensagem` é para a pessoa: pt-BR, direta, e diz o que
// fazer quando há algo a fazer.
//
// ## Por que isto existe
//
// As rotas sempre seguiram esse formato. O que **não** seguia era tudo
// que o Fastify produz sozinho — 404 de rota inexistente, 400 de corpo
// malformado, 413 de corpo grande, 500 não tratado. Esses saíam em
// `{ statusCode, error, message }`, em inglês, sem o campo `mensagem`.
//
// O estrago não é estético. O cliente lê `mensagem`; sem ela, mostrava
// um texto genérico. Em 06/10/2026 um 400 de parser chegou ao usuário
// como "não deu certo", e o diagnóstico começou do zero (ERR-012).
//
// Contrato parcial é pior que contrato nenhum: quem integra confia nele
// e é traído exatamente nos casos de erro, que são os que importam.
//
// ## O 500 não conta o que houve
//
// Mensagem de erro interno vaza nome de tabela, caminho de arquivo e
// trecho de SQL. O que vai para o cliente é genérico **mais o
// `requestId`** — e o detalhe inteiro vai para o log. É o par que
// permite a alguém dizer "deu erro, o código é req-3m" e o operador
// achar a linha exata, sem que a mensagem na tela seja um mapa do
// servidor.
// =====================================================================

import type { FastifyInstance } from 'fastify';

export type RespostaDeErro = { erro: string; mensagem: string; requestId?: string };

/** Traduz o código do Fastify para o nosso contrato. */
function traduzir(codigo: string | undefined, status: number): RespostaDeErro | null {
  switch (codigo) {
    case 'FST_ERR_CTP_EMPTY_JSON_BODY':
      return {
        erro: 'corpo_invalido',
        mensagem:
          'o pedido anunciou JSON e veio sem corpo. Quando não há o que ' +
          'enviar, não mande o cabeçalho content-type',
      };
    case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
      return {
        erro: 'tipo_invalido',
        mensagem: 'esta rota aceita application/json',
      };
    case 'FST_ERR_CTP_BODY_TOO_LARGE':
      return {
        erro: 'corpo_grande',
        mensagem: 'o corpo do pedido passou do limite aceito',
      };
    case 'FST_ERR_VALIDATION':
      return { erro: 'validacao', mensagem: 'o pedido não passou na validação' };
    default:
      break;
  }

  // Sem código conhecido, decide pelo status. 4xx é erro de quem chamou e
  // pode ser dito; 5xx é nosso e não se descreve.
  if (status === 400) {
    return { erro: 'corpo_invalido', mensagem: 'o corpo do pedido é inválido' };
  }
  if (status === 401) {
    return { erro: 'sem_sessao', mensagem: 'faça login' };
  }
  if (status === 404) {
    return { erro: 'nao_encontrado', mensagem: 'não existe esse recurso' };
  }
  if (status === 429) {
    return {
      erro: 'devagar',
      mensagem: 'pedidos demais em pouco tempo; tente de novo em instantes',
    };
  }
  return null;
}

export function instalarTratamentoDeErros(app: FastifyInstance): void {
  app.setNotFoundHandler((req, resposta) => {
    // Diz o método junto da rota: `GET /v1/pontos` existindo e
    // `POST /v1/pontos` não existindo é o engano mais comum de quem
    // integra, e "não existe essa rota" sozinho não ajuda a notar.
    resposta.status(404).send({
      erro: 'rota_nao_encontrada',
      mensagem: `não existe ${req.method} ${req.url} nesta API`,
    });
  });

  app.setErrorHandler((bruto, req, resposta) => {
    // O Fastify tipa o erro como `unknown` nas versões novas; o que nos
    // interessa dele é só `statusCode`, `code` e `message`.
    const erro = bruto as { statusCode?: number; code?: string; message?: string };
    const status = erro.statusCode ?? 500;

    if (status >= 500) {
      // O detalhe INTEIRO vai para o log, com a stack. É o que permite
      // achar a causa depois — e foi a falta disso que custou caro.
      req.log.error({ err: bruto, reqId: req.id }, 'erro não tratado');
      return resposta.status(status).send({
        erro: 'erro_interno',
        mensagem:
          'algo quebrou do nosso lado. Informe o código abaixo a quem ' +
          'cuida do sistema para achar o registro exato',
        requestId: String(req.id),
      });
    }

    const traduzido = traduzir(erro.code, status);
    if (traduzido) {
      req.log.warn({ codigo: erro.code, status }, 'pedido recusado');
      return resposta.status(status).send(traduzido);
    }

    // 4xx que não reconhecemos: a mensagem do Fastify é melhor que nada,
    // mas o código fica genérico para ninguém passar a depender dele.
    req.log.warn({ codigo: erro.code, status }, 'pedido recusado sem tradução');
    return resposta.status(status).send({
      erro: 'pedido_invalido',
      mensagem: erro.message || 'o pedido não pôde ser atendido',
    });
  });
}
