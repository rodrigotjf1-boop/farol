// O balcão — a chamada à plataforma e a leitura da resposta, do lado do servidor (A20, fatia 1c).
//
// O servidor vai perguntar à plataforma no lugar do agente. O que tem de
// ficar provado aqui é que ele faz COM A RESPOSTA o que o agente faz: lê a
// ferramenta, apara, faz a conta do custo, reconsulta o modelo forte quando
// a resposta vem insegura, e separa o erro que vale tentar de novo do que
// não vale.
//
// A prova é a parte `respostas` de `contratos/pedido-com-contexto.json`:
// cada caso traz o que a plataforma devolve, chamada a chamada, e o
// `esperado` — gerado pelo código do agente
// (`agent/testes/test_pedido_do_contrato.py`). Aqui nenhuma chamada sai da
// máquina: quem responde é o roteiro do caso, ou um servidor de mentira.
//
// Depois dos casos do contrato vêm os que só o servidor tem: o transporte
// HTTP de verdade (contra um servidor local), a classe de cada erro e o
// cuidado com a chave da conta.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { CHAMADAS, MODELO_DE_ROTINA, MODELO_FORTE, pedidoParaAPlataforma, type Bloco } from '../src/balcao/pedido.js';
import {
  DOLAR_DE_FABRICA, ESCRITA_NO_CACHE, ErroDaPlataforma, LIMITE_DA_CHAMADA_MS, PRECOS, VERSAO_DA_API,
  custoDaChamada, esquecerRecusas, lerConfianca, lerVeredito, perguntar, transporteHttp,
  type RespostaHttp, type Transporte,
} from '../src/balcao/plataforma.js';

type DaPlataforma = { status: number; corpo: unknown };
type CasoDeResposta = {
  nome: string;
  daPlataforma: DaPlataforma[];
  esperado: { chamadas: unknown[]; veredito?: unknown; erro?: { recuperavel: boolean } };
};

const contrato = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../contratos/pedido-com-contexto.json', import.meta.url)), 'utf8'),
) as {
  casos: { esperado: { conteudo: Bloco[] } }[];
  precos: { dolar: number; escritaNoCache: number; porMilhaoEmDolar: Record<string, unknown> };
  respostas: CasoDeResposta[];
};

// Uma chave DE MENTIRA: tem a cara certa e não abre nada em lugar nenhum.
const CHAVE = ['sk', 'ant', 'de-mentira-do-teste-da-plataforma', '0123456789abcdef'].join('-');
const CONTEUDO = contrato.casos[0]!.esperado.conteudo;

type Enviado = { corpo: Record<string, unknown>; chave: string };

/** Um transporte que responde o roteiro, chamada a chamada, e anota o que foi enviado. */
function roteiro(respostas: DaPlataforma[]) {
  const fila = structuredClone(respostas);
  const enviados: Enviado[] = [];
  const enviar: Transporte = async (corpo, chave) => {
    enviados.push({ corpo: corpo as Record<string, unknown>, chave });
    const r = fila.shift();
    assert.ok(r, 'o servidor chamou a plataforma mais vezes do que o caso previa');
    return { status: r.status, corpo: r.corpo };
  };
  return { enviar, enviados, sobraram: fila };
}
const daChamada = (e: Enviado) => ({ model: e.corpo.model, max_tokens: e.corpo.max_tokens, tool_choice: e.corpo.tool_choice });

const boa = (resultado = 'conforme', confianca: unknown = 0.9, modelo = MODELO_DE_ROTINA): DaPlataforma => ({
  status: 200,
  corpo: {
    content: [{ type: 'tool_use', name: 'responder', input: { resultado, confianca, motivo: 'visto' } }],
    stop_reason: 'tool_use',
    model: modelo,
    usage: { input_tokens: 1000, output_tokens: 100 },
  },
});
const erroHttp = (status: number, mensagem = 'x', tipo = 'api_error'): DaPlataforma => ({
  status,
  corpo: { type: 'error', error: { type: tipo, message: mensagem } },
});
const RECUSA = 'tool_choice: type "tool" and "any" are not supported for this model.';

async function oErro(promessa: Promise<unknown>): Promise<ErroDaPlataforma> {
  try {
    await promessa;
  } catch (e) {
    assert.ok(e instanceof ErroDaPlataforma, `erro que não é da plataforma: ${String(e)}`);
    return e;
  }
  return assert.fail('era para dar erro');
}

beforeEach(() => esquecerRecusas());

// ───────────────────── os casos do contrato ─────────────────────

describe('o balcão: o servidor lê a resposta da plataforma como o agente lê', () => {
  it('os preços e o câmbio são os do agente', () => {
    assert.deepEqual(PRECOS, contrato.precos.porMilhaoEmDolar);
    assert.equal(ESCRITA_NO_CACHE, contrato.precos.escritaNoCache);
    assert.equal(DOLAR_DE_FABRICA, contrato.precos.dolar);
    assert.deepEqual(Object.keys(PRECOS).sort(), [MODELO_DE_ROTINA, MODELO_FORTE].sort(), 'tem preço para cada modelo que o pedido chama');
  });

  it('o contrato tem respostas com veredito e com erro, e cada uma tem o esperado', () => {
    assert.ok(contrato.respostas.length >= 40);
    assert.ok(contrato.respostas.every((c) => c.esperado && Array.isArray(c.esperado.chamadas) && (c.esperado.veredito || c.esperado.erro)));
    assert.equal(new Set(contrato.respostas.map((c) => c.nome)).size, contrato.respostas.length);
  });

  for (const caso of contrato.respostas) {
    it(`resposta: ${caso.nome}`, async () => {
      const plataforma = roteiro(caso.daPlataforma);
      let saida: Record<string, unknown>;
      try {
        const r = await perguntar({ chave: CHAVE, conteudo: CONTEUDO, enviar: plataforma.enviar, dolar: contrato.precos.dolar });
        saida = { veredito: r.veredito };
        assert.deepEqual(r.chamadas, plataforma.enviados.map((e) => e.corpo.model), 'os modelos chamados, na ordem');
      } catch (e) {
        assert.ok(e instanceof ErroDaPlataforma, `erro que não é da plataforma: ${String(e)}`);
        saida = { erro: { recuperavel: e.recuperavel } };
        assert.ok(!e.message.includes(CHAVE), 'o erro não leva a chave');
      }
      saida.chamadas = plataforma.enviados.map(daChamada);
      assert.deepEqual(saida, caso.esperado);
      assert.equal(plataforma.sobraram.length, 0, 'sobrou resposta que o servidor não pediu');

      // Toda chamada do mesmo item leva a MESMA pergunta, e a chave vai só por fora do corpo.
      const { model: _m, max_tokens: _t, tool_choice: _e, ...aPergunta } = pedidoParaAPlataforma(CONTEUDO);
      for (const enviado of plataforma.enviados) {
        const { model: _m2, max_tokens: _t2, tool_choice: _e2, ...doEnviado } = enviado.corpo;
        assert.deepEqual(doEnviado, aPergunta);
        assert.equal(enviado.chave, CHAVE);
        assert.ok(!JSON.stringify(enviado.corpo).includes(CHAVE), 'a chave não vai dentro do corpo');
      }
    });
  }
});

// ───────────────────── o que só o servidor tem ─────────────────────

describe('o balcão: os erros da plataforma, e de que lado está cada um', () => {
  it('a classe e se vale tentar de novo, status a status', async () => {
    const tabela: [number, string, boolean][] = [
      [400, 'pedido', false], [401, 'conta', false], [403, 'conta', false], [404, 'pedido', false],
      [413, 'pedido', false], [422, 'pedido', false],
      [408, 'plataforma', true], [409, 'plataforma', true], [429, 'limite', true],
      [500, 'plataforma', true], [502, 'plataforma', true], [503, 'plataforma', true], [529, 'plataforma', true],
    ];
    for (const [status, classe, recuperavel] of tabela) {
      const e = await oErro(perguntar({ chave: CHAVE, conteudo: CONTEUDO, enviar: roteiro([erroHttp(status)]).enviar }));
      assert.deepEqual([e.status, e.classe, e.recuperavel], [status, classe, recuperavel], String(status));
    }
  });

  it('resposta 200 que não serve é erro "da resposta", e vale tentar de novo', async () => {
    for (const corpo of [null, 'texto', [], {}, { content: 'x' }, { content: [null, 7, 'a'] }, { content: [{ type: 'tool_use', name: 'responder', input: 'x' }] }]) {
      const e = await oErro(perguntar({ chave: CHAVE, conteudo: CONTEUDO, enviar: roteiro([{ status: 200, corpo }]).enviar }));
      assert.deepEqual([e.classe, e.recuperavel, e.status], ['resposta', true, null], JSON.stringify(corpo));
    }
  });

  it('a mensagem do erro traz o status e o que a plataforma disse — cortado, e sem a chave', async () => {
    const e = await oErro(perguntar({ chave: CHAVE, conteudo: CONTEUDO, enviar: roteiro([erroHttp(401, 'invalid x-api-key', 'authentication_error')]).enviar }));
    assert.equal(e.message, '401 authentication_error: invalid x-api-key');
    assert.equal(e.name, 'ErroDaPlataforma');

    const longa = await oErro(perguntar({ chave: CHAVE, conteudo: CONTEUDO, enviar: roteiro([erroHttp(500, 'm'.repeat(1000))]).enviar }));
    assert.equal(longa.message, `500 api_error: ${'m'.repeat(300)}`);

    // Erro sem o corpo de costume (uma barreira no caminho respondeu, e não a plataforma).
    const semCorpo = await oErro(perguntar({ chave: CHAVE, conteudo: CONTEUDO, enviar: roteiro([{ status: 502, corpo: null }]).enviar }));
    assert.equal(semCorpo.message, '502 erro: (sem mensagem)');
    const torto = await oErro(perguntar({ chave: CHAVE, conteudo: CONTEUDO, enviar: roteiro([{ status: 500, corpo: { error: { type: 7, message: ['x'] } } }]).enviar }));
    assert.equal(torto.message, '500 erro: (sem mensagem)');
  });

  it('erro que não é da plataforma (um defeito nosso) não é engolido — nem na reconsulta', async () => {
    const defeito = new TypeError('defeito de programa');
    await assert.rejects(perguntar({ chave: CHAVE, conteudo: CONTEUDO, enviar: async () => { throw defeito; } }), defeito);
    let vez = 0;
    const naSegunda: Transporte = async () => {
      vez += 1;
      if (vez === 2) throw defeito;
      return boa('nao_conforme', 0.5) as RespostaHttp;
    };
    await assert.rejects(perguntar({ chave: CHAVE, conteudo: CONTEUDO, enviar: naSegunda }), defeito);
  });
});

describe('o balcão: o que o processo aprende sobre a escolha da ferramenta', () => {
  it('modelo que recusou uma vez vai direto com a escolha livre nas seguintes — até esquecer', async () => {
    const primeira = roteiro([erroHttp(400, RECUSA, 'invalid_request_error'), boa()]);
    await perguntar({ chave: CHAVE, conteudo: CONTEUDO, enviar: primeira.enviar });
    assert.deepEqual(primeira.enviados.map((e) => (e.corpo.tool_choice as { type: string }).type), ['tool', 'auto']);

    const segunda = roteiro([boa()]);
    await perguntar({ chave: CHAVE, conteudo: CONTEUDO, enviar: segunda.enviar });
    assert.deepEqual(segunda.enviados.map(daChamada), [{ model: MODELO_DE_ROTINA, max_tokens: CHAMADAS.reconsulta.max_tokens, tool_choice: { type: 'auto' } }]);

    esquecerRecusas();
    const terceira = roteiro([boa()]);
    await perguntar({ chave: CHAVE, conteudo: CONTEUDO, enviar: terceira.enviar });
    assert.deepEqual(terceira.enviados.map(daChamada), [CHAMADAS.rotina]);
  });

  it('só o 400 que fala da escolha vira escolha livre: outro 400, ou a mesma frase em outro status, é erro', async () => {
    const outro400 = roteiro([erroHttp(400, 'max_tokens: must be greater than 0'), boa()]);
    await oErro(perguntar({ chave: CHAVE, conteudo: CONTEUDO, enviar: outro400.enviar }));
    assert.equal(outro400.enviados.length, 1);

    const outroStatus = roteiro([erroHttp(500, RECUSA), boa()]);
    await oErro(perguntar({ chave: CHAVE, conteudo: CONTEUDO, enviar: outroStatus.enviar }));
    assert.equal(outroStatus.enviados.length, 1);

    // E nenhum dos dois ensinou nada ao processo: a seguinte vai com a escolha forçada.
    const seguinte = roteiro([boa()]);
    await perguntar({ chave: CHAVE, conteudo: CONTEUDO, enviar: seguinte.enviar });
    assert.deepEqual(seguinte.enviados.map(daChamada), [CHAMADAS.rotina]);
  });

  it('o modelo forte nunca é chamado com a escolha forçada', async () => {
    const plataforma = roteiro([boa('nao_conforme', 0.5), boa('nao_conforme', 0.9, MODELO_FORTE)]);
    const r = await perguntar({ chave: CHAVE, conteudo: CONTEUDO, enviar: plataforma.enviar });
    assert.deepEqual(plataforma.enviados.map(daChamada), [CHAMADAS.rotina, { model: MODELO_FORTE, max_tokens: 2000, tool_choice: { type: 'auto' } }]);
    assert.deepEqual(r.chamadas, [MODELO_DE_ROTINA, MODELO_FORTE]);
    assert.equal(r.veredito.modelo, MODELO_FORTE);
  });
});

describe('o balcão: a confiança, o custo e o veredito, peça por peça', () => {
  it('a confiança: número de 0 a 1; o que vier parecido é lido; o resto é nulo', () => {
    const casos: [unknown, number | null][] = [
      [0, 0], [1, 1], [0.5, 0.5], [1.0001, 1], [-0.0001, 0], [37, 1], [-3, 0],
      ['0.8', 0.8], [' 0.25 ', 0.25], ['1e-1', 0.1], ['+0.5', 0.5], ['.5', 0.5], ['5.', 1], ['-1', 0], ['1E0', 1],
      [true, 1], [false, 0],
      ['', null], ['  ', null], ['alta', null], ['0,8', null], ['0.8a', null], ['0x10', null], ['1_0', null], ['inf', null], ['nan', null],
      ['.', null], ['e5', null], ['--1', null],
      [null, null], [undefined, null], [[0.9], null], [{ valor: 0.9 }, null],
    ];
    for (const [bruto, esperado] of casos) assert.equal(lerConfianca(bruto), esperado, JSON.stringify(bruto));
  });

  it('o custo: sem a conta dos tokens, ou sem preço para o modelo, não há custo', () => {
    assert.equal(custoDaChamada(MODELO_DE_ROTINA, null, 5.4), null);
    assert.equal(custoDaChamada(MODELO_DE_ROTINA, undefined, 5.4), null);
    assert.equal(custoDaChamada(MODELO_DE_ROTINA, 'x', 5.4), null);
    assert.equal(custoDaChamada('modelo-sem-preco', { input_tokens: 1000, output_tokens: 100 }, 5.4), null);
    assert.equal(custoDaChamada('constructor', { input_tokens: 1000, output_tokens: 100 }, 5.4), null, 'nome de coisa do JavaScript não é modelo');
    // Conta vazia é conta: custa zero (a plataforma respondeu, e não cobrou token nenhum).
    assert.equal(custoDaChamada(MODELO_DE_ROTINA, {}, 5.4), 0);
    // 1.000 de entrada a US$ 0,10 e 100 de saída a US$ 0,50, por milhão, a R$ 5,40: 0,081 centavo.
    assert.ok(Math.abs(custoDaChamada(MODELO_DE_ROTINA, { input_tokens: 1000, output_tokens: 100 }, 5.4)! - 0.081) < 1e-12);
    // O câmbio entra na conta.
    assert.ok(Math.abs(custoDaChamada(MODELO_DE_ROTINA, { input_tokens: 1000, output_tokens: 100 }, 6)! - 0.09) < 1e-12);
    // A leitura de cache do modelo forte custa 0,05 da entrada, e não 0,1.
    assert.ok(Math.abs(custoDaChamada(MODELO_FORTE, { cache_read_input_tokens: 1_000_000 }, 1)! - 2.0 * 0.05 * 100) < 1e-9);
    assert.ok(Math.abs(custoDaChamada(MODELO_DE_ROTINA, { cache_read_input_tokens: 1_000_000 }, 1)! - 0.1 * 0.1 * 100) < 1e-9);
    // Conta que não é número vale zero, e não vira texto colado.
    assert.equal(custoDaChamada(MODELO_DE_ROTINA, { input_tokens: '1000', output_tokens: null }, 5.4), 0);
  });

  it('o câmbio de fábrica vale quando quem pergunta não diz outro', async () => {
    const comODeFabrica = await perguntar({ chave: CHAVE, conteudo: CONTEUDO, enviar: roteiro([boa()]).enviar });
    const dito = await perguntar({ chave: CHAVE, conteudo: CONTEUDO, enviar: roteiro([boa()]).enviar, dolar: DOLAR_DE_FABRICA });
    const outro = await perguntar({ chave: CHAVE, conteudo: CONTEUDO, enviar: roteiro([boa()]).enviar, dolar: DOLAR_DE_FABRICA * 2 });
    assert.equal(comODeFabrica.veredito.custoCentavos, dito.veredito.custoCentavos);
    assert.ok(Math.abs(outro.veredito.custoCentavos! - 2 * dito.veredito.custoCentavos!) < 1e-12);
  });

  it('o veredito leva o modelo de quem respondeu, e os tokens só quando são número', () => {
    const v = lerVeredito({ content: [{ type: 'tool_use', name: 'responder', input: { resultado: 'conforme' } }], usage: { input_tokens: '10', output_tokens: 7 } }, 'um-modelo', 5.4);
    assert.deepEqual(v, { resultado: 'conforme', confianca: null, motivo: null, modelo: 'um-modelo', tokensEntrada: null, tokensSaida: 7, custoCentavos: null });
  });
});

// ───────────────────── o transporte de verdade ─────────────────────

describe('o balcão: a chamada HTTP de verdade (contra um servidor local)', () => {
  let servidor: Server;
  let endereco = '';
  const recebidos: { metodo: string; caminho: string; cabecalhos: IncomingMessage['headers']; corpo: string }[] = [];
  let responder: (caminho: string) => { status: number; corpo: string; demora?: number } = () => ({ status: 200, corpo: '{}' });

  before(async () => {
    servidor = createServer((req, res) => {
      let corpo = '';
      req.setEncoding('utf8');
      req.on('data', (p) => (corpo += p));
      req.on('end', () => {
        recebidos.push({ metodo: req.method ?? '', caminho: req.url ?? '', cabecalhos: req.headers, corpo });
        const r = responder(req.url ?? '');
        const mandar = () => {
          res.writeHead(r.status, { 'content-type': 'application/json' });
          res.end(r.corpo);
        };
        if (r.demora) setTimeout(mandar, r.demora).unref();
        else mandar();
      });
    });
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
    endereco = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });
  after(async () => {
    servidor.closeAllConnections();
    await new Promise((ok) => servidor.close(ok));
  });
  beforeEach(() => {
    recebidos.length = 0;
    responder = () => ({ status: 200, corpo: '{}' });
  });

  it('manda o corpo e os cabeçalhos que a plataforma pede, uma vez só', async () => {
    responder = () => ({ status: 200, corpo: JSON.stringify(boa('conforme', 0.93).corpo) });
    const r = await perguntar({ chave: CHAVE, conteudo: CONTEUDO, enviar: transporteHttp({ endereco: `${endereco}//` }) });
    assert.equal(r.veredito.resultado, 'conforme');

    assert.equal(recebidos.length, 1);
    const pedido = recebidos[0]!;
    assert.deepEqual([pedido.metodo, pedido.caminho], ['POST', '/v1/messages']);
    assert.equal(pedido.cabecalhos['x-api-key'], CHAVE);
    assert.equal(pedido.cabecalhos['anthropic-version'], VERSAO_DA_API);
    assert.equal(pedido.cabecalhos['anthropic-version'], '2023-06-01');
    assert.equal(pedido.cabecalhos['content-type'], 'application/json');
    assert.equal(pedido.cabecalhos['user-agent'], 'farol-balcao/1', 'cliente com nome próprio');
    assert.deepEqual(JSON.parse(pedido.corpo), JSON.parse(JSON.stringify(pedidoParaAPlataforma(CONTEUDO))));
    assert.ok(!pedido.corpo.includes(CHAVE), 'a chave vai no cabeçalho, nunca no corpo');
  });

  it('o status e o corpo passam como vieram; resposta que não é JSON chega sem corpo', async () => {
    const enviar = transporteHttp({ endereco });
    responder = () => ({ status: 429, corpo: JSON.stringify(erroHttp(429, 'devagar', 'rate_limit_error').corpo) });
    assert.deepEqual(await enviar({ a: 1 }, CHAVE), { status: 429, corpo: erroHttp(429, 'devagar', 'rate_limit_error').corpo });
    responder = () => ({ status: 502, corpo: '<html>Bad Gateway</html>' });
    assert.deepEqual(await enviar({ a: 1 }, CHAVE), { status: 502, corpo: null });
    responder = () => ({ status: 200, corpo: '' });
    assert.deepEqual(await enviar({ a: 1 }, CHAVE), { status: 200, corpo: null });
  });

  it('a plataforma que não responde no tempo é erro que vale tentar de novo — e a chamada não fica pendurada', async () => {
    responder = () => ({ status: 200, corpo: '{}', demora: 2000 });
    const inicio = Date.now();
    const e = await oErro(perguntar({ chave: CHAVE, conteudo: CONTEUDO, enviar: transporteHttp({ endereco, limiteMs: 150 }) }));
    assert.ok(Date.now() - inicio < 1500, 'desistiu no limite, e não quando o servidor resolveu responder');
    assert.deepEqual([e.classe, e.recuperavel, e.status], ['plataforma', true, null]);
    assert.equal(e.message, 'a plataforma não respondeu em 0 s');
    assert.equal(LIMITE_DA_CHAMADA_MS, 30_000, 'o limite de fábrica é o do agente');
  });

  it('a plataforma fora do ar é erro que vale tentar de novo, sem o endereço e sem a chave na mensagem', async () => {
    const fechado = createServer();
    await new Promise<void>((ok) => fechado.listen(0, '127.0.0.1', ok));
    const porta = (fechado.address() as AddressInfo).port;
    await new Promise((ok) => fechado.close(ok));

    const e = await oErro(perguntar({ chave: CHAVE, conteudo: CONTEUDO, enviar: transporteHttp({ endereco: `http://127.0.0.1:${porta}` }) }));
    assert.deepEqual([e.classe, e.recuperavel, e.status], ['plataforma', true, null]);
    assert.equal(e.message, 'não alcancei a plataforma');
    assert.ok(!e.message.includes(String(porta)) && !e.message.includes(CHAVE));
  });

  it('a chamada que terminou desarma o relógio do limite: nada fica pendurado para cortar depois', async () => {
    let sinal: AbortSignal | null = null;
    const buscar: typeof fetch = async (_endereco, opcoes) => {
      sinal = opcoes?.signal ?? null;
      return new Response('{}', { status: 200 });
    };
    assert.deepEqual(await transporteHttp({ buscar, limiteMs: 80 })({ a: 1 }, CHAVE), { status: 200, corpo: {} });
    await new Promise((ok) => setTimeout(ok, 220));
    assert.equal((sinal as AbortSignal | null)?.aborted, false, 'o limite já tinha passado, e o corte não disparou');
  });

  it('a reconsulta de verdade: duas chamadas, e a segunda é a do modelo forte', async () => {
    responder = () =>
      recebidos.length === 1
        ? { status: 200, corpo: JSON.stringify(boa('nao_conforme', 0.5).corpo) }
        : { status: 200, corpo: JSON.stringify(boa('nao_conforme', 0.95, MODELO_FORTE).corpo) };
    const r = await perguntar({ chave: CHAVE, conteudo: CONTEUDO, enviar: transporteHttp({ endereco }) });
    assert.deepEqual(recebidos.map((p) => JSON.parse(p.corpo).model), [MODELO_DE_ROTINA, MODELO_FORTE]);
    assert.deepEqual([r.veredito.modelo, r.veredito.confianca], [MODELO_FORTE, 0.95]);
  });
});
