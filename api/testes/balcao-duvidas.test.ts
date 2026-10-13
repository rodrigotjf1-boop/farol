// O balcão — a porta: POST /v1/agentes/duvidas (A20, fatia 1d).
//
// "A dúvida passa pelo nosso servidor": o agente entrega as imagens e de que
// critério, canal e área a dúvida é; o servidor monta a pergunta, pergunta à
// plataforma com a conta da loja e devolve o veredito. O que tem de ficar
// provado aqui:
//
//   - só a loja LIGADA pergunta, e a loja sai do token do agente;
//   - o pedido que sai é o montado pelo servidor, com a configuração que a
//     loja tem em mãos — igual ao que ela montaria — e com a conta DELA;
//   - a mesma dúvida não é paga duas vezes;
//   - o teto do dia não é passado nem por uma pergunta, e o limite por
//     minuto segura o agente que disparou;
//   - o que a plataforma não respondeu vira erro com o lado dele, e a mesma
//     dúvida pode ser tentada de novo;
//   - nenhuma imagem é guardada, e nem a imagem nem a chave vão para o
//     registro.
//
// Nenhuma chamada sai da máquina: quem responde no lugar da plataforma é um
// roteiro (ou, num teste, um servidor local, para provar a chamada HTTP).

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { conteudoDoPedido, pedidoParaAPlataforma, MODELO_DE_ROTINA, MODELO_FORTE, type ConfiguracaoDaLoja } from '../src/balcao/pedido.js';
import { dolarDoAmbiente, esquecerRecusas, reservaDeUmaDuvida, transporteHttp, type RespostaHttp, type Transporte } from '../src/balcao/plataforma.js';
import { DUVIDA_PERDIDA_APOS_S, MAX_DA_IMAGEM, MAX_POR_MINUTO, lerDuvida } from '../src/rotas/duvidas.js';

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-duvida-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-duvida';
const SENHA = 'uma senha longa o bastante';
const DOLAR = 5.4;
const RESERVA = reservaDeUmaDuvida(DOLAR);
const PROVISIONAR = fileURLToPath(new URL('../scripts/provisionar.mjs', import.meta.url));

const CONTRATO = JSON.parse(readFileSync(fileURLToPath(new URL('../../contratos/duvida-do-agente.json', import.meta.url)), 'utf8')) as {
  pedido: Record<string, unknown>;
  camposDoPedido: Record<string, string>;
  resposta: Record<string, unknown>;
  camposDaResposta: Record<string, string>;
  recusas: Record<string, { status: number; traz?: string[]; motivos?: string[]; classes?: string[] }>;
};

// Chaves DE MENTIRA: têm a cara que o cadastro aceita e não abrem nada em lugar nenhum.
const chaveDeMentira = (rotulo: string) => ['sk', 'ant', `de-mentira-${rotulo}`, randomUUID().replace(/-/g, '')].join('-');
// Imagens de mentira: bytes inventados, em base64. Compridas o bastante para serem achadas se vazarem.
const b64 = (texto: string) => Buffer.from(texto.repeat(8)).toString('base64');
const IMAGEM = { tipo: 'image/jpeg', dados: b64('a-imagem-a-auditar-') };
const MAPA = { tipo: 'image/jpeg', dados: b64('o-mapa-do-canal-') };
const FOTO = { tipo: 'image/jpeg', dados: b64('a-foto-padrao-') };
const novaChave = () => randomUUID().replace(/-/g, '');
const RET = (x1: number, y1: number, x2: number, y2: number) => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];

type DaPlataforma = { status: number; corpo: unknown };
const boa = (resultado = 'conforme', confianca: unknown = 0.93, modelo = MODELO_DE_ROTINA, uso: unknown = { input_tokens: 1500, output_tokens: 60 }): DaPlataforma => ({
  status: 200,
  corpo: {
    content: [{ type: 'tool_use', name: 'responder', input: { resultado, confianca, motivo: 'a bancada está sem restos de alimento' } }],
    stop_reason: 'tool_use', model: modelo, ...(uso ? { usage: uso } : {}),
  },
});
const erroHttp = (status: number, mensagem = 'x', tipo = 'api_error'): DaPlataforma => ({ status, corpo: { type: 'error', error: { type: tipo, message: mensagem } } });
const CUSTO_DA_BOA = ((1500 * 0.1 + 60 * 0.5) / 1_000_000) * DOLAR * 100;

// ───────────────────── o corpo, sem banco ─────────────────────

describe('o balcão: o corpo da dúvida', () => {
  const CORPO = () => structuredClone(CONTRATO.pedido);

  it('o exemplo do contrato é lido inteiro, e os campos documentados são os do exemplo', () => {
    const lida = lerDuvida(CORPO());
    assert.ok(!('problema' in lida), JSON.stringify(lida));
    assert.deepEqual(lida, CONTRATO.pedido);
    assert.deepEqual(Object.keys(CONTRATO.pedido).sort(), [...Object.keys(CONTRATO.camposDoPedido), 'pontoId', 'regraId', 'zonaId'].sort());
    assert.deepEqual(Object.keys(CONTRATO.resposta).sort(), [...Object.keys(CONTRATO.camposDaResposta), 'tokensEntrada', 'tokensSaida'].sort());
  });

  it('sem mapa e sem foto padrão: nulo e ausente valem o mesmo', () => {
    for (const vazio of [null, undefined]) {
      const corpo = { ...CORPO(), mapa: vazio, fotoPadrao: vazio };
      if (vazio === undefined) {
        delete (corpo as Record<string, unknown>).mapa;
        delete (corpo as Record<string, unknown>).fotoPadrao;
      }
      const lida = lerDuvida(corpo);
      assert.ok(!('problema' in lida));
      assert.deepEqual([lida.mapa, lida.fotoPadrao], [null, null]);
    }
    const comFoto = lerDuvida({ ...CORPO(), fotoPadrao: { id: randomUUID(), imagem: FOTO } });
    assert.ok(!('problema' in comFoto) && comFoto.fotoPadrao?.imagem.dados === FOTO.dados);
    // O mapa é lido como veio: o desenho dos quadros, ou a câmera inteira.
    for (const tipo of ['esquema', 'foto']) {
      const lida = lerDuvida({ ...CORPO(), mapa: { tipo, imagem: MAPA } });
      assert.ok(!('problema' in lida));
      assert.deepEqual(lida.mapa, { tipo, imagem: MAPA });
    }
  });

  it('o que não é dúvida é recusado, por um motivo só — e o motivo nunca repete o que veio', () => {
    const casos: [string, (c: Record<string, unknown>) => void, RegExp][] = [
      ['campo a mais', (c) => { c.lojaId = randomUUID(); }, /campo desconhecido: 'lojaId'/],
      ['a loja no corpo', (c) => { c.tenantId = randomUUID(); }, /campo desconhecido: 'tenantId'/],
      ['o critério no corpo', (c) => { c.criterio = 'O texto vem do servidor.'; }, /campo desconhecido: 'criterio'/],
      ['chave curta', (c) => { c.chave = 'abc'; }, /^chave: /],
      ['chave com maiúscula', (c) => { c.chave = 'A'.repeat(32); }, /^chave: /],
      ['chave com 33', (c) => { c.chave = 'a'.repeat(33); }, /^chave: /],
      ['chave que não é texto', (c) => { c.chave = 7; }, /^chave: /],
      ['chave dentro de uma lista', (c) => { c.chave = ['0123456789abcdef0123456789abcdef']; }, /^chave: /],
      ['versão zero', (c) => { c.configVersao = 0; }, /^configVersao: /],
      ['versão em texto', (c) => { c.configVersao = '7'; }, /^configVersao: /],
      ['versão quebrada', (c) => { c.configVersao = 7.5; }, /^configVersao: /],
      ['versão do critério zero', (c) => { c.criterioVersao = 0; }, /^criterioVersao: /],
      ['versão do critério ausente', (c) => { delete c.criterioVersao; }, /^criterioVersao: /],
      ['critério que não é id', (c) => { c.regraId = 'r1'; }, /^regraId: /],
      ['canal que não é id', (c) => { c.pontoId = null; }, /^pontoId: /],
      ['área que não é id', (c) => { c.zonaId = 12; }, /^zonaId: /],
      ['fora da área parecido com verdade', (c) => { c.foraDaArea = 'true'; }, /^foraDaArea: /],
      ['fora da área ausente', (c) => { delete c.foraDaArea; }, /^foraDaArea: /],
      ['sem imagem', (c) => { delete c.imagem; }, /^imagem: mande/],
      ['imagem em texto', (c) => { c.imagem = IMAGEM.dados; }, /^imagem: mande/],
      ['imagem com campo a mais', (c) => { c.imagem = { ...IMAGEM, nome: 'x.jpg' }; }, /^imagem: campo desconhecido 'nome'/],
      ['tipo de imagem fora da lista', (c) => { c.imagem = { ...IMAGEM, tipo: 'image/gif' }; }, /^imagem\.tipo: /],
      ['tipo de imagem em outra caixa', (c) => { c.imagem = { ...IMAGEM, tipo: 'IMAGE/JPEG' }; }, /^imagem\.tipo: /],
      ['imagem vazia', (c) => { c.imagem = { ...IMAGEM, dados: '' }; }, /^imagem\.dados: a imagem/],
      ['imagem que não é base64', (c) => { c.imagem = { ...IMAGEM, dados: 'isto não é!!' }; }, /^imagem\.dados: não é base64/],
      ['base64 com tamanho torto', (c) => { c.imagem = { ...IMAGEM, dados: 'QUJD=' }; }, /^imagem\.dados: não é base64/],
      ['base64 com o enchimento no meio', (c) => { c.imagem = { ...IMAGEM, dados: 'QU=D' }; }, /^imagem\.dados: não é base64/],
      ['imagem grande demais', (c) => { c.imagem = { ...IMAGEM, dados: 'A'.repeat(MAX_DA_IMAGEM + 4) }; }, /^imagem\.dados: no máximo/],
      ['mapa em texto', (c) => { c.mapa = 'esquema'; }, /^mapa: mande/],
      ['mapa sem dizer qual', (c) => { c.mapa = { imagem: MAPA }; }, /^mapa\.tipo: /],
      ['mapa de outro tipo', (c) => { c.mapa = { tipo: 'planta', imagem: MAPA }; }, /^mapa\.tipo: /],
      ['mapa sem imagem', (c) => { c.mapa = { tipo: 'foto' }; }, /^mapa\.imagem: mande/],
      ['mapa com campo a mais', (c) => { c.mapa = { tipo: 'foto', imagem: MAPA, quadros: 3 }; }, /^mapa: campo desconhecido 'quadros'/],
      ['mapa com imagem torta', (c) => { c.mapa = { tipo: 'foto', imagem: { ...MAPA, dados: '@@@@' } }; }, /^mapa\.imagem\.dados: não é base64/],
      ['foto padrão em texto', (c) => { c.fotoPadrao = randomUUID(); }, /^fotoPadrao: mande/],
      ['foto padrão sem id', (c) => { c.fotoPadrao = { imagem: FOTO }; }, /^fotoPadrao\.id: /],
      ['foto padrão com nome', (c) => { c.fotoPadrao = { id: randomUUID(), nome: 'Noite', imagem: FOTO }; }, /^fotoPadrao: campo desconhecido 'nome'/],
      ['foto padrão sem imagem', (c) => { c.fotoPadrao = { id: randomUUID() }; }, /^fotoPadrao\.imagem: mande/],
    ];
    for (const [nome, estragar, esperado] of casos) {
      const corpo = CORPO();
      estragar(corpo);
      const lida = lerDuvida(corpo);
      assert.ok('problema' in lida, nome);
      assert.match(lida.problema, esperado, nome);
      assert.ok(!lida.problema.includes(IMAGEM.dados) && !lida.problema.includes('isto não é'), `${nome}: o motivo não repete a imagem`);
    }
    for (const torto of [null, undefined, 'x', 7, [], [CORPO()]]) {
      assert.deepEqual(lerDuvida(torto), { problema: 'mande um objeto' });
    }
    // No tamanho máximo exato, a imagem entra.
    const noLimite = lerDuvida({ ...CORPO(), imagem: { ...IMAGEM, dados: 'A'.repeat(MAX_DA_IMAGEM) } });
    assert.ok(!('problema' in noLimite));
  });

  it('o câmbio do ambiente: o número que vier, ou o de fábrica', () => {
    assert.equal(dolarDoAmbiente({}), 5.4);
    assert.equal(dolarDoAmbiente({ FAROL_DOLAR: '6.1' }), 6.1);
    assert.equal(dolarDoAmbiente({ FAROL_DOLAR: '6,1' }), 6.1);
    for (const torto of ['', 'caro', '0', '-5', 'Infinity', 'NaN']) assert.equal(dolarDoAmbiente({ FAROL_DOLAR: torto }), 5.4, torto);
  });

  it('a reserva de uma dúvida é o pior caso dela: a de rotina e a reconsulta, com a saída no teto', () => {
    // 8.000 de entrada: (8000 x 0,10 + 300 x 0,50) + (8000 x 2,00 + 2000 x 10,00), por milhão, a R$ 5,40, em centavos.
    assert.ok(Math.abs(RESERVA - ((8000 * 0.1 + 300 * 0.5 + 8000 * 2 + 2000 * 10) / 1e6) * 5.4 * 100) < 1e-9);
    assert.ok(RESERVA > 19 && RESERVA < 21, 'perto de 20 centavos');
    assert.ok(Math.abs(reservaDeUmaDuvida(10.8) - 2 * RESERVA) < 1e-9, 'acompanha o câmbio');
    assert.equal(reservaDeUmaDuvida(), RESERVA, 'sem câmbio dito, o de fábrica');
  });
});

// ───────────────────────── com o banco ─────────────────────────

describe('o balcão: a porta da dúvida (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  const cofre = randomBytes(32);
  const registro: string[] = [];
  const D = { 'x-farol-admin': ADMIN };

  // Quem responde no lugar da plataforma: o roteiro (uma resposta por chamada), ou "tudo certo" quando ele acaba.
  const plataforma = {
    fila: [] as (DaPlataforma | (() => Promise<DaPlataforma>))[],
    enviados: [] as { corpo: Record<string, unknown>; chave: string }[],
  };
  const enviar: Transporte = async (corpo, chave) => {
    plataforma.enviados.push({ corpo: corpo as Record<string, unknown>, chave });
    const proxima = plataforma.fila.shift() ?? boa();
    return (typeof proxima === 'function' ? await proxima() : proxima) as RespostaHttp;
  };
  /** Uma resposta que só sai quando o teste soltar: a dúvida fica "em voo". */
  function emVoo(resposta: DaPlataforma = boa()) {
    let soltar: () => void = () => undefined;
    const espera = new Promise<void>((ok) => (soltar = ok));
    plataforma.fila.push(async () => {
      await espera;
      return resposta;
    });
    return { soltar };
  }
  const chegou = async (quantas: number) => {
    for (let i = 0; i < 200 && plataforma.enviados.length < quantas; i += 1) await new Promise((ok) => setTimeout(ok, 10));
    assert.equal(plataforma.enviados.length, quantas, 'a chamada chegou à plataforma');
  };

  type Loja = Awaited<ReturnType<typeof montarLoja>>;

  /** Uma loja inteira: canal com cena, um quadro, um critério no quadro e um na imagem completa, agente, conta de IA. */
  async function montarLoja(nome: string, o: { ligar?: boolean } = {}) {
    const conta = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: D,
      payload: { tenant: { nome: `${marca}-${nome}` }, loja: { nome }, setores: [{ nome: 'Cozinha' }] },
    })).json();
    const lojaId = conta.loja.id as string;
    const tenantId = conta.tenantId as string;
    const email = `ger-${randomUUID().slice(0, 8)}@e.com`;
    await app.inject({ method: 'POST', url: '/v1/distribuicao/usuarios', headers: D, payload: { tenantId, nome: 'Gerente', email, senha: SENHA, nivel: 'gerente' } });
    const sessao = await app.inject({ method: 'POST', url: '/v1/sessao', payload: { email, senha: SENHA } });
    const biscoito = sessao.headers['set-cookie'];
    const cookie = (Array.isArray(biscoito) ? biscoito[0]! : String(biscoito)).split(';')[0]!;
    const doConsole = async (metodo: 'POST' | 'PATCH', url: string, payload: unknown, esperado: number) => {
      const r = await app.inject({ method: metodo, url, headers: { cookie }, payload: payload as object });
      assert.equal(r.statusCode, esperado, `${metodo} ${url}: ${r.body}`);
      return r.json();
    };

    await doConsole('PATCH', `/v1/lojas/${lojaId}`, { tipoNegocio: 'hamburgueria' }, 200);
    const canal = await doConsole('POST', `/v1/setores/${conta.setores[0].id}/pontos`, { nome: 'Montagem 1', origem: 'dvr', canal: Math.floor(Math.random() * 60) + 1, host: '192.168.1.108' }, 201);
    const pontoId = canal.id as string;
    const inteiraId = canal.zonas[0].id as string;
    await doConsole('PATCH', `/v1/pontos/${pontoId}`, { cena: 'Bancada de montagem vista de cima. As cubas ficam no alto.' }, 200);
    const quadroId = (await doConsole('POST', `/v1/pontos/${pontoId}/zonas`, { nome: 'Montagem', poligono: RET(0.1, 0.3, 0.7, 0.8), papel: 'montagem' }, 201)).id as string;

    const criterio = async (nomeDele: string, zonaId: string, extra: Record<string, unknown> = {}) => {
      const id = (await doConsole('POST', `/v1/lojas/${lojaId}/regras`, { nome: nomeDele, tipo: 'estado', criterio: `A bancada fica limpa (${nomeDele}).`, zonaIds: [zonaId], quando: 'sempre', ...extra }, 201)).id as string;
      await doConsole('PATCH', `/v1/regras/${id}`, { ativa: true }, 200);
      return id;
    };
    const regraDoQuadro = await criterio('no quadro', quadroId);
    const regraGeral = await criterio('geral', inteiraId);

    const agente = (await app.inject({ method: 'POST', url: '/v1/distribuicao/agentes', headers: D, payload: { lojaId, nome: 'PC da loja' } })).json();
    const token = agente.token as string;
    const doAgente = { authorization: `Bearer ${token}` };
    await app.inject({ method: 'POST', url: '/v1/agentes/ativar', headers: doAgente, payload: { fingerprint: `fp-${randomUUID()}` } });

    const chaveDaConta = chaveDeMentira(nome.replace(/[^a-z0-9]/gi, ''));
    const distribuicao = async (metodo: 'PUT' | 'PATCH', url: string, payload: unknown) => {
      const r = await app.inject({ method: metodo, url, headers: D, payload: payload as object });
      assert.equal(r.statusCode, 200, `${metodo} ${url}: ${r.body}`);
    };
    await distribuicao('PUT', `/v1/distribuicao/lojas/${lojaId}/conta-ia`, { provedor: 'anthropic', chave: chaveDaConta });
    await distribuicao('PATCH', `/v1/distribuicao/lojas/${lojaId}`, { pedidoComContexto: true, mesmoAssim: true });
    if (o.ligar !== false) await distribuicao('PATCH', `/v1/distribuicao/lojas/${lojaId}/balcao`, { ligado: true });

    /** A configuração como o agente a recebe AGORA (e o que ele declara saber fica anotado). */
    const configuracao = async () => {
      const r = await app.inject({ method: 'GET', url: '/v1/agentes/configuracao?sabe=estados,estudo', headers: doAgente });
      assert.equal(r.statusCode, 200, r.body);
      return r.json() as ConfiguracaoDaLoja & { versao: number; pontos: { id: string; zonas: { id: string; regras: { id: string; criterioVersao: number }[] }[] }[] };
    };
    /** A dúvida de um critério de QUADRO, com o mapa — pronta para mandar. */
    const duvida = async (extra: Record<string, unknown> = {}) => ({
      chave: novaChave(), configVersao: (await configuracao()).versao, regraId: regraDoQuadro, criterioVersao: 1, pontoId, zonaId: quadroId,
      foraDaArea: false, imagem: IMAGEM, mapa: { tipo: 'esquema', imagem: MAPA }, fotoPadrao: null, ...extra,
    });
    const perguntar = (corpo: unknown, cabecalhos: Record<string, string> = doAgente) =>
      app.inject({ method: 'POST', url: '/v1/agentes/duvidas', headers: cabecalhos, payload: corpo as object });
    const linhas = async () =>
      (await pool.query('select * from duvida where loja_id = $1 order by criada_em, id', [lojaId])).rows as Record<string, unknown>[];
    const balcao = (corpo: unknown) => distribuicao('PATCH', `/v1/distribuicao/lojas/${lojaId}/balcao`, corpo);

    return { lojaId, tenantId, token, cookie, pontoId, inteiraId, quadroId, regraDoQuadro, regraGeral, chaveDaConta, configuracao, duvida, perguntar, linhas, balcao, doConsole, criterio };
  }

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    app = criarApp(pool, { logger: { level: 'info', stream: { write: (l) => void registro.push(l) } }, balcao: { cofre, enviar, dolar: DOLAR } });
    await app.ready();
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  beforeEach(() => {
    plataforma.fila.length = 0;
    plataforma.enviados.length = 0;
    registro.length = 0;
    esquecerRecusas();
  });

  // ─────────────────────── quem pergunta ───────────────────────

  it('loja desligada não pergunta: a rota recusa, e nada sai nem é guardado', async () => {
    const loja = await montarLoja('Desligada', { ligar: false });
    const corpo = await loja.duvida();
    const r = await loja.perguntar(corpo);
    assert.equal(r.statusCode, CONTRATO.recusas.balcao_desligado!.status, r.body);
    assert.equal(r.json().erro, 'balcao_desligado');
    // É a PRIMEIRA coisa que a loja desligada ouve — antes de qualquer outra recusa da dúvida.
    for (const torta of [{ configVersao: corpo.configVersao + 5 }, { regraId: randomUUID() }, { mapa: null }]) {
      assert.equal((await loja.perguntar({ ...corpo, ...torta })).json().erro, 'balcao_desligado', JSON.stringify(torta));
    }
    assert.equal(plataforma.enviados.length, 0);
    assert.deepEqual(await loja.linhas(), []);
    assert.deepEqual([MAX_POR_MINUTO, DUVIDA_PERDIDA_APOS_S], [30, 120], 'os dois números da porta');
  });

  it('só o agente pergunta, e a loja sai do token dele — nunca do corpo', async () => {
    const loja = await montarLoja('Do token');
    const vizinha = await montarLoja('Vizinha do token');
    const corpo = await loja.duvida();

    for (const cabecalhos of [{}, { authorization: 'Bearer token-que-nao-existe' }, { cookie: loja.cookie }, D]) {
      const r = await loja.perguntar(corpo, cabecalhos as Record<string, string>);
      assert.equal(r.statusCode, 401, JSON.stringify(cabecalhos));
    }
    // O agente da vizinha, com os ids DESTA loja: para ele, este critério não existe.
    const daVizinha = await loja.perguntar({ ...corpo, configVersao: (await vizinha.configuracao()).versao }, { authorization: `Bearer ${vizinha.token}` });
    assert.equal(daVizinha.statusCode, 422, daVizinha.body);
    assert.deepEqual([daVizinha.json().erro, daVizinha.json().motivo], ['sem_pedido', 'criterio_fora_da_configuracao']);
    assert.equal(plataforma.enviados.length, 0);
    assert.deepEqual([(await loja.linhas()).length, (await vizinha.linhas()).length], [0, 0]);
  });

  it('corpo torto: 422, sem perguntar nada', async () => {
    const loja = await montarLoja('Corpo torto');
    const r = await loja.perguntar({ ...(await loja.duvida()), lojaId: randomUUID() });
    assert.equal(r.statusCode, CONTRATO.recusas.validacao!.status, r.body);
    assert.deepEqual(r.json(), { erro: 'validacao', mensagem: "campo desconhecido: 'lojaId'" });
    assert.equal((await loja.perguntar(undefined)).statusCode, 422, 'sem corpo');
    assert.equal(plataforma.enviados.length, 0);
    assert.deepEqual(await loja.linhas(), []);
  });

  // ─────────────────────── a dúvida respondida ───────────────────────

  it('a dúvida é perguntada com o pedido que o SERVIDOR monta e a conta DA LOJA, e o veredito volta', async () => {
    const loja = await montarLoja('Respondida');
    const outra = await montarLoja('Outra conta');
    const corpo = await loja.duvida();
    const r = await loja.perguntar(corpo);
    assert.equal(r.statusCode, 200, r.body);

    // O que volta é o que o contrato diz — os mesmos campos, com os mesmos nomes.
    const resposta = r.json();
    assert.deepEqual(Object.keys(resposta).sort(), Object.keys(CONTRATO.resposta).sort());
    assert.ok(Number.isInteger(resposta.latenciaMs) && resposta.latenciaMs >= 0);
    assert.deepEqual({ ...resposta, latenciaMs: CONTRATO.resposta.latenciaMs }, CONTRATO.resposta);
    assert.equal(resposta.custoCentavos, CUSTO_DA_BOA, 'o custo, com todas as casas');

    // Uma chamada, com a chave da conta DESTA loja (e não a da outra), e o corpo que o servidor montou.
    assert.equal(plataforma.enviados.length, 1);
    const enviado = plataforma.enviados[0]!;
    assert.equal(enviado.chave, loja.chaveDaConta);
    assert.notEqual(enviado.chave, outra.chaveDaConta);

    // O pedido é o que a LOJA montaria com a configuração que tem em mãos: igual, letra por letra.
    const configuracao = await loja.configuracao();
    const daLoja = conteudoDoPedido(
      configuracao,
      { pontoId: loja.pontoId, zonaId: loja.quadroId, regraId: loja.regraDoQuadro, criterio: 'A bancada fica limpa (no quadro).', foraDaArea: false, mapa: 'esquema', fotoPadrao: null },
      { auditada: IMAGEM, mapa: MAPA },
    );
    assert.ok(daLoja.conteudo, 'a configuração que desce monta o pedido');
    assert.equal(JSON.stringify(enviado.corpo), JSON.stringify(pedidoParaAPlataforma(daLoja.conteudo)));
    const textos = (enviado.corpo.messages as { content: { type: string; text?: string }[] }[])[0]!.content.map((b) => b.text ?? '<imagem>');
    assert.match(textos[0]!, /^A CENA — .*\nNegócio: hamburgueria\. Setor: Cozinha\. Câmera: Montagem 1\.\nBancada de montagem vista de cima\. As cubas ficam no alto\.$/s);
    assert.match(textos[1]!, /é um esquema, sem a imagem da câmera\):\n1 = Montagem \(posição de montagem\)\n/);
    assert.equal(textos.at(-1), 'CRITÉRIO A AUDITAR:\nA bancada fica limpa (no quadro).', 'o texto do critério é o do servidor');

    // E o registro: de quem, de que critério, o veredito e o custo.
    const [linha, ...resto] = await loja.linhas();
    assert.equal(resto.length, 0);
    assert.deepEqual(
      {
        tenant: linha!.tenant_id, chave: linha!.chave, regra: linha!.regra_id, ponto: linha!.ponto_id, zona: linha!.zona_id,
        criterioVersao: linha!.criterio_versao, configVersao: linha!.config_versao, estado: linha!.estado, tentativas: linha!.tentativas,
        provedor: linha!.provedor, modelo: linha!.modelo, reconsultou: linha!.reconsultou, resultado: linha!.resultado, confianca: linha!.confianca,
        motivo: linha!.motivo, entrada: linha!.tokens_entrada, saida: linha!.tokens_saida, custo: linha!.custo_centavos, falha: linha!.falha,
        reservado: linha!.reservado_centavos,
      },
      {
        tenant: loja.tenantId, chave: corpo.chave, regra: loja.regraDoQuadro, ponto: loja.pontoId, zona: loja.quadroId,
        criterioVersao: 1, configVersao: corpo.configVersao, estado: 'respondida', tentativas: 1,
        provedor: 'anthropic', modelo: MODELO_DE_ROTINA, reconsultou: false, resultado: 'conforme', confianca: 0.93,
        motivo: 'a bancada está sem restos de alimento', entrada: 1500, saida: 60, custo: CUSTO_DA_BOA, falha: null,
        reservado: RESERVA,
      },
    );
    assert.ok(linha!.agente_id && linha!.respondida_em && linha!.dia, 'quem perguntou, quando respondeu e em que dia');
    assert.equal(linha!.latencia_ms, resposta.latenciaMs);
  });

  it('critério da imagem completa: sem mapa; e com o cinza em volta apagado, o aviso vai na pergunta', async () => {
    const loja = await montarLoja('Geral');
    const r = await loja.perguntar(await loja.duvida({ regraId: loja.regraGeral, zonaId: loja.inteiraId, mapa: null, foraDaArea: true }));
    assert.equal(r.statusCode, 200, r.body);
    const blocos = (plataforma.enviados[0]!.corpo.messages as { content: { type: string; text?: string }[] }[])[0]!.content;
    assert.deepEqual(blocos.map((b) => b.type), ['text', 'text', 'image', 'text']);
    assert.equal(blocos[1]!.text, 'A IMAGEM A AUDITAR é a imagem completa desta câmera:');
    assert.match(blocos[3]!.text!, /^CRITÉRIO A AUDITAR:\nA bancada fica limpa \(geral\)\.\n\nÁREA DE ANÁLISE:\n/);

    // E o mapa que é fotografia é anunciado como fotografia (o tipo vem da loja, com a dúvida).
    assert.equal((await loja.perguntar(await loja.duvida({ mapa: { tipo: 'foto', imagem: MAPA } }))).statusCode, 200);
    const comFoto = (plataforma.enviados[1]!.corpo.messages as { content: { text?: string }[] }[])[0]!.content;
    assert.match(comFoto[1]!.text!, /^MAPA DO CANAL — a imagem a seguir é a câmera inteira, reduzida/);
  });

  it('critério que ainda não está valendo também pergunta: a configuração é montada como o agente a recebeu', async () => {
    const loja = await montarLoja('Em ensaio');
    const emEnsaio = await loja.criterio('em ensaio', loja.quadroId, { estado: 'ensaio' });
    // O agente que declara saber de estados recebe o critério em ensaio — e o balcão o vê do mesmo jeito.
    const configuracao = await loja.configuracao();
    assert.ok(configuracao.pontos[0]!.zonas.some((z) => z.regras.some((r) => r.id === emEnsaio)), 'desce para o agente');
    const r = await loja.perguntar(await loja.duvida({ regraId: emEnsaio }));
    assert.equal(r.statusCode, 200, r.body);
    const blocos = (plataforma.enviados[0]!.corpo.messages as { content: { text?: string }[] }[])[0]!.content;
    assert.equal(blocos.at(-1)!.text, 'CRITÉRIO A AUDITAR:\nA bancada fica limpa (em ensaio).');
  });

  it('a reconsulta: duas chamadas, vale a do modelo forte, e o custo é o das duas', async () => {
    const loja = await montarLoja('Reconsulta');
    plataforma.fila.push(boa('nao_conforme', 0.5), boa('nao_conforme', 0.95, MODELO_FORTE, { input_tokens: 1600, output_tokens: 700 }));
    const r = await loja.perguntar(await loja.duvida());
    assert.equal(r.statusCode, 200, r.body);
    const doForte = ((1600 * 2 + 700 * 10) / 1_000_000) * DOLAR * 100;
    assert.deepEqual(
      [r.json().resultado, r.json().confianca, r.json().modelo, r.json().reconsultou, r.json().custoCentavos],
      ['nao_conforme', 0.95, MODELO_FORTE, true, CUSTO_DA_BOA + doForte],
    );
    assert.deepEqual(plataforma.enviados.map((e) => e.corpo.model), [MODELO_DE_ROTINA, MODELO_FORTE]);
    const [linha] = await loja.linhas();
    assert.deepEqual([linha!.modelo, linha!.reconsultou, linha!.custo_centavos, linha!.tokens_saida], [MODELO_FORTE, true, CUSTO_DA_BOA + doForte, 700]);

    // A reconsulta que falha não derruba a resposta — e não conta como reconsulta.
    plataforma.fila.push(boa('nao_conforme', 0.5), erroHttp(529, 'Overloaded', 'overloaded_error'));
    const semForte = await loja.perguntar(await loja.duvida());
    assert.deepEqual([semForte.statusCode, semForte.json().modelo, semForte.json().reconsultou, semForte.json().confianca], [200, MODELO_DE_ROTINA, false, 0.5]);
  });

  // ─────────────────────── a mesma dúvida ───────────────────────

  it('a mesma dúvida de novo recebe a resposta guardada: não é perguntada nem paga outra vez', async () => {
    const loja = await montarLoja('Repetida');
    const corpo = await loja.duvida();
    const primeira = (await loja.perguntar(corpo)).json();
    assert.equal(primeira.repetida, false);

    const segunda = await loja.perguntar(corpo);
    assert.equal(segunda.statusCode, 200, segunda.body);
    assert.deepEqual(segunda.json(), { ...primeira, repetida: true });
    assert.equal(plataforma.enviados.length, 1, 'uma chamada só');
    assert.equal((await loja.linhas()).length, 1);

    // Mesmo que a configuração tenha mudado depois: a pergunta foi feita, e paga, com a de então.
    await loja.doConsole('PATCH', `/v1/pontos/${loja.pontoId}`, { cena: 'A cena mudou.' }, 200);
    assert.notEqual((await loja.configuracao()).versao, corpo.configVersao);
    const depois = await loja.perguntar(corpo);
    assert.deepEqual([depois.statusCode, depois.json().repetida, plataforma.enviados.length], [200, true, 1]);

    // E mesmo com a loja no teto: a resposta guardada não gasta nada.
    await loja.balcao({ tetoCentavosDia: 0 });
    assert.deepEqual([(await loja.perguntar(corpo)).statusCode, plataforma.enviados.length], [200, 1]);
    // A mesma chave em OUTRA loja é outra dúvida.
    const outra = await montarLoja('Repetida em outra');
    const naOutra = await outra.perguntar({ ...(await outra.duvida()), chave: corpo.chave });
    assert.deepEqual([naOutra.statusCode, naOutra.json().repetida, plataforma.enviados.length], [200, false, 2]);
  });

  it('a mesma dúvida ao mesmo tempo: a segunda espera a vez e não é paga duas vezes', async () => {
    const loja = await montarLoja('Em andamento');
    const corpo = await loja.duvida();
    const voo = emVoo();
    const primeira = loja.perguntar(corpo);
    await chegou(1);

    const segunda = await loja.perguntar(corpo);
    assert.equal(segunda.statusCode, CONTRATO.recusas.em_andamento!.status, segunda.body);
    assert.equal(segunda.json().erro, 'em_andamento');
    assert.equal(plataforma.enviados.length, 1);
    const [emVooAgora] = await loja.linhas();
    assert.deepEqual([emVooAgora!.estado, emVooAgora!.custo_centavos, emVooAgora!.reservado_centavos], ['perguntando', null, RESERVA]);

    voo.soltar();
    assert.equal((await primeira).statusCode, 200);
    const terceira = await loja.perguntar(corpo);
    assert.deepEqual([terceira.statusCode, terceira.json().repetida, plataforma.enviados.length], [200, true, 1]);
  });

  it('a dúvida que ficou perdida (o servidor caiu no meio) pode ser tentada de novo, na mesma linha', async () => {
    const loja = await montarLoja('Perdida');
    const corpo = await loja.duvida();
    const voo = emVoo();
    const primeira = loja.perguntar(corpo);
    await chegou(1);
    const [linha] = await loja.linhas();

    // Ainda dentro do prazo: está em andamento.
    await pool.query(`update duvida set tentada_em = now() - make_interval(secs => $2) where id = $1`, [linha!.id, DUVIDA_PERDIDA_APOS_S - 5]);
    assert.equal((await loja.perguntar(corpo)).statusCode, 409);
    // Passou do prazo: a mesma linha é tentada de novo — e a reserva velha DELA não a segura (o teto só dá para uma).
    await pool.query(`update duvida set tentada_em = now() - make_interval(secs => $2) where id = $1`, [linha!.id, DUVIDA_PERDIDA_APOS_S + 5]);
    await loja.balcao({ tetoCentavosDia: Math.ceil(RESERVA) });
    const deNovo = await loja.perguntar(corpo);
    assert.deepEqual([deNovo.statusCode, deNovo.json().repetida, plataforma.enviados.length], [200, false, 2]);
    const linhas = await loja.linhas();
    assert.deepEqual([linhas.length, linhas[0]!.id, linhas[0]!.tentativas, linhas[0]!.estado], [1, linha!.id, 2, 'respondida']);
    voo.soltar();
    await primeira;
  });

  it('a dúvida que foi respondida enquanto esta esperava a vez recebe a resposta guardada, sem perguntar', async () => {
    const loja = await montarLoja('Respondida na espera');
    const corpo = await loja.duvida();
    const outra = await pool.connect();
    let resposta;
    try {
      await outra.query('begin');
      await outra.query('select id from loja where id = $1 for no key update', [loja.lojaId]);
      const promessa = loja.perguntar(corpo);
      await new Promise((ok) => setTimeout(ok, 300));
      // Esta chamada já viu que a dúvida não estava respondida, e espera a trava. Enquanto isso, a OUTRA chamada
      // da mesma dúvida termina: a linha passa a existir, respondida.
      await outra.query(
        `insert into duvida (tenant_id, loja_id, chave, regra_id, criterio_versao, ponto_id, zona_id, config_versao, dia, estado, reservado_centavos, provedor,
                             modelo, resultado, confianca, motivo, custo_centavos, latencia_ms, respondida_em)
         values ($1, $2, $3, $4, 1, $5, $6, $7, current_date, 'respondida', 20, 'anthropic', 'modelo-da-outra', 'nao_conforme', 0.81, 'da outra chamada', 0.5, 900, now())`,
        [loja.tenantId, loja.lojaId, corpo.chave, loja.regraDoQuadro, loja.pontoId, loja.quadroId, corpo.configVersao],
      );
      await outra.query('commit');
      resposta = await promessa;
    } finally {
      outra.release();
    }
    assert.equal(resposta.statusCode, 200, resposta.body);
    assert.deepEqual(
      [resposta.json().repetida, resposta.json().resultado, resposta.json().modelo, resposta.json().custoCentavos, resposta.json().latenciaMs],
      [true, 'nao_conforme', 'modelo-da-outra', 0.5, 900],
    );
    assert.equal(plataforma.enviados.length, 0, 'não foi paga de novo');
    assert.equal((await loja.linhas()).length, 1);
  });

  it('um defeito nosso no meio da pergunta é erro do servidor: não vira "a plataforma falhou"', async () => {
    const loja = await montarLoja('Defeito nosso');
    const corpo = await loja.duvida();
    plataforma.fila.push(async () => {
      throw new TypeError('defeito de programa');
    });
    const r = await loja.perguntar(corpo);
    assert.equal(r.statusCode, 500, r.body);
    const [linha] = await loja.linhas();
    assert.deepEqual([linha!.estado, linha!.falha], ['perguntando', null], 'a linha não diz que a plataforma falhou');
  });

  // ─────────────────────── a configuração e o critério ───────────────────────

  it('configuração de outra versão: a dúvida volta para ser feita de novo, sem perguntar', async () => {
    const loja = await montarLoja('Outra versão');
    const corpo = await loja.duvida();
    for (const versao of [corpo.configVersao - 1, corpo.configVersao + 1]) {
      const r = await loja.perguntar({ ...corpo, configVersao: versao });
      assert.equal(r.statusCode, CONTRATO.recusas.configuracao_mudou!.status, r.body);
      assert.deepEqual([r.json().erro, r.json().configVersao], ['configuracao_mudou', corpo.configVersao]);
    }
    assert.equal(plataforma.enviados.length, 0);
    assert.deepEqual(await loja.linhas(), []);
  });

  it('critério que mudou depois da olhada: a dúvida não vale mais', async () => {
    const loja = await montarLoja('Critério mudou');
    await loja.doConsole('PATCH', `/v1/regras/${loja.regraDoQuadro}`, { criterio: 'A bancada fica limpa e seca.' }, 200);
    const corpo = await loja.duvida();
    const velha = await loja.perguntar(corpo);
    assert.equal(velha.statusCode, CONTRATO.recusas.criterio_mudou!.status, velha.body);
    assert.deepEqual([velha.json().erro, velha.json().criterioVersao], ['criterio_mudou', 2]);
    assert.equal(plataforma.enviados.length, 0);

    // Com a versão de agora, pergunta — e o texto é o novo, o do servidor.
    const nova = await loja.perguntar({ ...corpo, criterioVersao: 2 });
    assert.equal(nova.statusCode, 200, nova.body);
    const blocos = (plataforma.enviados[0]!.corpo.messages as { content: { text?: string }[] }[])[0]!.content;
    assert.equal(blocos.at(-1)!.text, 'CRITÉRIO A AUDITAR:\nA bancada fica limpa e seca.');
    assert.equal((await loja.linhas())[0]!.criterio_versao, 2);
  });

  it('o que não vira pedido é recusado com o motivo, sem perguntar e sem guardar', async () => {
    const loja = await montarLoja('Sem pedido');
    const presenca = await loja.criterio('presença', loja.quadroId, { tipo: 'presenca', parametros: { objeto: 'pessoa', minimo: 1 } });
    const semPedido = async (extra: Record<string, unknown>, motivo: string) => {
      const r = await loja.perguntar(await loja.duvida(extra));
      assert.equal(r.statusCode, CONTRATO.recusas.sem_pedido!.status, `${motivo}: ${r.body}`);
      assert.deepEqual(r.json(), { erro: 'sem_pedido', motivo });
      assert.ok(CONTRATO.recusas.sem_pedido!.motivos!.includes(motivo));
    };
    await semPedido({ mapa: null }, 'falta_o_mapa');
    await semPedido({ regraId: presenca }, 'nao_vai_a_plataforma');
    await semPedido({ regraId: loja.regraGeral }, 'criterio_fora_da_configuracao');   // o critério geral não é do quadro
    await semPedido({ zonaId: randomUUID() }, 'criterio_fora_da_configuracao');
    await semPedido({ regraId: randomUUID() }, 'criterio_fora_da_configuracao');
    await loja.doConsole('PATCH', `/v1/pontos/${loja.pontoId}`, { cena: '' }, 200);
    await semPedido({}, 'falta_a_cena');
    assert.equal(plataforma.enviados.length, 0);
    assert.deepEqual(await loja.linhas(), []);
  });

  it('foto padrão que o critério não pediu não é repassada à plataforma', async () => {
    const loja = await montarLoja('Foto que não vai');
    const r = await loja.perguntar(await loja.duvida({ fotoPadrao: { id: randomUUID(), imagem: FOTO } }));
    assert.equal(r.statusCode, 200, r.body);
    // Só o conteúdo da mensagem: as instruções, que são fixas, falam em "FOTO PADRÃO" por conta própria.
    const enviado = JSON.stringify(plataforma.enviados[0]!.corpo.messages);
    assert.ok(!enviado.includes(FOTO.dados) && !enviado.includes('FOTO PADRÃO'), 'a foto ficou no servidor');
    assert.ok(enviado.includes(IMAGEM.dados) && enviado.includes(MAPA.dados), 'a imagem e o mapa foram');
  });

  // ─────────────────────── o teto do dia e o limite por minuto ───────────────────────

  it('o teto do dia é conferido ANTES de perguntar, com o custo de verdade e a reserva de quem está em voo', async () => {
    const loja = await montarLoja('Teto');
    const naoPerguntou = async () => {
      const antes = plataforma.enviados.length;
      const r = await loja.perguntar(await loja.duvida());
      assert.equal(r.statusCode, CONTRATO.recusas.teto_do_dia!.status, r.body);
      assert.equal(r.json().erro, 'teto_do_dia');
      assert.equal(plataforma.enviados.length, antes, 'não perguntou');
    };
    const perguntou = async () => assert.equal((await loja.perguntar(await loja.duvida())).statusCode, 200);

    // Teto menor do que uma reserva: nada passa. Zero também.
    for (const teto of [0, Math.floor(RESERVA) - 1]) {
      await loja.balcao({ tetoCentavosDia: teto });
      await naoPerguntou();
    }
    assert.deepEqual(await loja.linhas(), [], 'a recusa do teto não deixa linha');

    // Cabe UMA reserva: a primeira passa. A segunda não — o que a primeira custou mais uma reserva já passa do teto.
    const umaReserva = Math.ceil(RESERVA);
    await loja.balcao({ tetoCentavosDia: umaReserva });
    await perguntou();
    assert.ok(CUSTO_DA_BOA + RESERVA > umaReserva, 'o caso é este: o custo da primeira já não deixa caber outra reserva');
    await naoPerguntou();

    // Um centavo a mais, e cabe: da dúvida RESPONDIDA conta o custo de verdade (um décimo de centavo), não a reserva dela.
    await loja.balcao({ tetoCentavosDia: umaReserva + 1 });
    await perguntou();

    // Com uma em voo, a reserva dela segura o teto: a seguinte não passa enquanto a primeira não responde.
    await loja.balcao({ tetoCentavosDia: Math.ceil(RESERVA * 1.5) });
    const voo = emVoo();
    const emVooAgora = loja.perguntar(await loja.duvida());
    await chegou(3);
    await naoPerguntou();
    voo.soltar();
    assert.equal((await emVooAgora).statusCode, 200);
    await perguntou();

    // A que falhou solta a reserva dela.
    plataforma.fila.push(erroHttp(500));
    assert.equal((await loja.perguntar(await loja.duvida())).statusCode, 502);
    await perguntou();

    // O teto é do DIA: com o gasto de hoje no teto, não pergunta — mesmo o de duas horas atrás; o mesmo gasto,
    // ontem, não segura nada — nem o de ontem tentado agora há pouco: o dia vira no meio de um minuto, e a conta
    // do minuto olha as dúvidas dos dois dias. (Com este teto, as respondidas de agora há pouco ainda deixariam
    // caber mais uma.)
    await loja.balcao({ tetoCentavosDia: umaReserva + 1 });
    await perguntou();
    await pool.query(
      `update duvida set custo_centavos = $2, tentada_em = now() - interval '2 hours'
        where id = (select id from duvida where loja_id = $1 and estado = 'respondida' limit 1)`,
      [loja.lojaId, RESERVA],
    );
    await naoPerguntou();
    await pool.query(`update duvida set dia = dia - 1, tentada_em = now() where loja_id = $1`, [loja.lojaId]);
    await perguntou();
  });

  it('o teto de uma loja não segura a outra', async () => {
    const cheia = await montarLoja('Cheia');
    const vazia = await montarLoja('Vazia');
    await cheia.balcao({ tetoCentavosDia: 0 });
    assert.equal((await cheia.perguntar(await cheia.duvida())).statusCode, 429);
    assert.equal((await vazia.perguntar(await vazia.duvida())).statusCode, 200);
  });

  it('duas dúvidas ao mesmo tempo não passam do teto: só uma reserva cabe, e só uma pergunta', async () => {
    for (let vez = 0; vez < 3; vez += 1) {
      const loja = await montarLoja(`Corrida do teto ${vez}`);
      await loja.balcao({ tetoCentavosDia: Math.ceil(RESERVA * 1.5) });
      const [a, b] = [await loja.duvida(), await loja.duvida()];
      const antes = plataforma.enviados.length;

      // Outra conexão segura a loja; as duas dúvidas param na trava; soltas juntas, só uma reserva cabe.
      // A plataforma demora a responder: a que reservou primeiro ainda está em voo quando a outra chega.
      const voos = [emVoo(), emVoo()];
      const segura = await pool.connect();
      let respostas;
      try {
        await segura.query('begin');
        await segura.query('select id from loja where id = $1 for no key update', [loja.lojaId]);
        const promessas = [loja.perguntar(a), loja.perguntar(b)];
        await new Promise((ok) => setTimeout(ok, 300));
        assert.equal(plataforma.enviados.length, antes, 'ninguém perguntou antes de reservar');
        await segura.query('commit');
        await chegou(antes + 1);
        await new Promise((ok) => setTimeout(ok, 200));
        assert.equal(plataforma.enviados.length, antes + 1, 'com uma em voo, a outra não chegou à plataforma');
        voos.forEach((v) => v.soltar());
        respostas = await Promise.all(promessas);
      } finally {
        voos.forEach((v) => v.soltar());
        segura.release();
        plataforma.fila.length = 0;
      }
      assert.deepEqual(respostas.map((r) => r.statusCode).sort(), [200, 429], `vez ${vez}`);
      assert.equal(plataforma.enviados.length, antes + 1, 'uma pergunta só');
      assert.equal((await loja.linhas()).length, 1);
    }
  });

  it('desligaram o balcão enquanto a dúvida vinha: ela não é perguntada', async () => {
    const loja = await montarLoja('Desligada no meio');
    const corpo = await loja.duvida();
    const outra = await pool.connect();
    let resposta;
    try {
      await outra.query('begin');
      await outra.query('select id from loja where id = $1 for no key update', [loja.lojaId]);
      const promessa = loja.perguntar(corpo);
      await new Promise((ok) => setTimeout(ok, 300));
      // A dúvida já passou pela primeira conferência (a loja estava ligada) e espera a trava.
      await outra.query('update loja set duvida_pelo_servidor = false where id = $1', [loja.lojaId]);
      await outra.query('commit');
      resposta = await promessa;
    } finally {
      outra.release();
    }
    assert.equal(resposta.statusCode, 409, resposta.body);
    assert.equal(resposta.json().erro, 'balcao_desligado');
    assert.equal(plataforma.enviados.length, 0);
    assert.deepEqual(await loja.linhas(), []);
  });

  it('o limite por minuto segura o agente que disparou — e só o último minuto conta', async () => {
    const loja = await montarLoja('Por minuto');
    const semear = (quantas: number, haQuantosSegundos: number) =>
      pool.query(
        `insert into duvida (tenant_id, loja_id, chave, regra_id, criterio_versao, ponto_id, zona_id, config_versao, dia, estado, falha, reservado_centavos, provedor, tentada_em)
         select $1, $2, md5(random()::text || g), $3, 1, $4, $5, 1, current_date - 3, 'falhou', 'plataforma', 0, 'anthropic', now() - make_interval(secs => $7)
           from generate_series(1, $6) g`,
        [loja.tenantId, loja.lojaId, loja.regraDoQuadro, loja.pontoId, loja.quadroId, quantas, haQuantosSegundos],
      );
    // 29 no último minuto: a trigésima passa.
    await semear(MAX_POR_MINUTO - 1, 5);
    assert.equal((await loja.perguntar(await loja.duvida())).statusCode, 200);
    // Agora são 30: a seguinte é recusada, sem perguntar.
    const antes = plataforma.enviados.length;
    const recusada = await loja.perguntar(await loja.duvida());
    assert.equal(recusada.statusCode, CONTRATO.recusas.limite_por_minuto!.status, recusada.body);
    assert.equal(recusada.json().erro, 'limite_por_minuto');
    assert.equal(recusada.headers['retry-after'], '60');
    assert.equal(plataforma.enviados.length, antes);

    // O que foi tentado há mais de um minuto não conta — nem sendo de HOJE: outra loja, com 100 dúvidas de hoje,
    // de 61 segundos atrás, pergunta.
    const velha = await montarLoja('Por minuto, velhas');
    const hoje = (await app.inject({ method: 'GET', url: `/v1/distribuicao/lojas/${velha.lojaId}/balcao`, headers: D })).json().hoje.dia as string;
    await pool.query(
      `insert into duvida (tenant_id, loja_id, chave, regra_id, criterio_versao, ponto_id, zona_id, config_versao, dia, estado, falha, reservado_centavos, provedor, tentada_em)
       select $1, $2, md5(random()::text || g), $3, 1, $4, $5, 1, $6::date, 'falhou', 'plataforma', 0, 'anthropic', now() - interval '61 seconds'
         from generate_series(1, 100) g`,
      [velha.tenantId, velha.lojaId, velha.regraDoQuadro, velha.pontoId, velha.quadroId, hoje],
    );
    assert.equal((await velha.perguntar(await velha.duvida())).statusCode, 200);
  });

  // ─────────────────────── quando a plataforma não responde ───────────────────────

  it('sem veredito: o erro diz de que lado foi e se vale tentar de novo — e a mesma dúvida pode ser tentada', async () => {
    const loja = await montarLoja('Sem veredito');
    const tabela: [DaPlataforma, string, boolean][] = [
      [erroHttp(401, 'invalid x-api-key', 'authentication_error'), 'conta', false],
      [erroHttp(403, 'Your credit balance is too low', 'permission_error'), 'conta', false],
      [erroHttp(400, 'invalid base64 data', 'invalid_request_error'), 'pedido', false],
      [erroHttp(429, 'rate limit', 'rate_limit_error'), 'limite', true],
      [erroHttp(529, 'Overloaded', 'overloaded_error'), 'plataforma', true],
      [{ status: 200, corpo: { content: [{ type: 'text', text: 'sem a ferramenta' }], stop_reason: 'end_turn' } }, 'resposta', true],
    ];
    for (const [daPlataforma, classe, recuperavel] of tabela) {
      const corpo = await loja.duvida();
      plataforma.fila.push(daPlataforma);
      const r = await loja.perguntar(corpo);
      assert.equal(r.statusCode, CONTRATO.recusas.sem_veredito!.status, r.body);
      assert.deepEqual(Object.keys(r.json()).sort(), ['classe', 'erro', 'mensagem', 'recuperavel']);
      assert.deepEqual([r.json().erro, r.json().classe, r.json().recuperavel], ['sem_veredito', classe, recuperavel]);
      assert.ok(CONTRATO.recusas.sem_veredito!.classes!.includes(classe));
      // O que a plataforma escreveu não vai para a loja.
      assert.ok(!/api-key|credit|base64|rate limit|Overloaded/i.test(r.body), r.body);
      const linha = (await loja.linhas()).find((l) => l.chave === corpo.chave)!;
      assert.deepEqual([linha.estado, linha.falha, linha.custo_centavos, linha.resultado], ['falhou', classe, null, null]);
    }

    // A que falhou pode ser tentada de novo, na mesma linha.
    const corpo = await loja.duvida();
    plataforma.fila.push(erroHttp(500));
    assert.equal((await loja.perguntar(corpo)).statusCode, 502);
    const deNovo = await loja.perguntar(corpo);
    assert.deepEqual([deNovo.statusCode, deNovo.json().repetida], [200, false]);
    const linha = (await loja.linhas()).find((l) => l.chave === corpo.chave)!;
    assert.deepEqual([linha.estado, linha.falha, linha.tentativas, linha.custo_centavos], ['respondida', null, 2, CUSTO_DA_BOA]);
  });

  it('balcão ligado e sem conta de IA que abra (o cofre do servidor mudou): 503, sem perguntar', async () => {
    const loja = await montarLoja('Sem conta');
    await pool.query(`update conta_ia set chave_cifrada = 'v1.AAAA.BBBB.CCCC' where loja_id = $1`, [loja.lojaId]);
    const r = await loja.perguntar(await loja.duvida());
    assert.equal(r.statusCode, CONTRATO.recusas.sem_conta_de_ia!.status, r.body);
    assert.equal(r.json().erro, 'sem_conta_de_ia');
    assert.equal(plataforma.enviados.length, 0);
    assert.deepEqual(await loja.linhas(), []);
  });

  // ─────────────────────── o que não fica em lugar nenhum ───────────────────────

  it('nenhuma imagem é guardada, e nem a imagem, nem o pedido, nem a chave vão para o registro', async () => {
    const loja = await montarLoja('Sem rastro');
    plataforma.fila.push(boa(), erroHttp(401, 'invalid x-api-key', 'authentication_error'));
    assert.equal((await loja.perguntar(await loja.duvida())).statusCode, 200);
    assert.equal((await loja.perguntar(await loja.duvida())).statusCode, 502);
    assert.equal((await loja.perguntar({ ...(await loja.duvida()), imagem: { ...IMAGEM, dados: 'não é base64!!' } })).statusCode, 422);

    const guardado = JSON.stringify(await loja.linhas());
    const noRegistro = registro.join('\n');
    for (const [oQue, texto] of [['a imagem', IMAGEM.dados], ['o mapa', MAPA.dados], ['a chave da conta', loja.chaveDaConta], ['a cena', 'Bancada de montagem vista de cima']] as const) {
      assert.ok(!guardado.includes(texto), `${oQue} não fica na tabela`);
      assert.ok(!noRegistro.includes(texto), `${oQue} não vai para o registro`);
    }
    assert.ok(!noRegistro.includes('não é base64!!'));
    // O que vai para o registro: quem, o resultado e o custo; e, do erro, o lado e o que a plataforma disse.
    assert.match(noRegistro, /"msg":"dúvida respondida"/);
    assert.match(noRegistro, /"resultado":"conforme"/);
    assert.match(noRegistro, /"msg":"dúvida sem veredito"/);
    assert.match(noRegistro, /"classe":"conta","status":401/);
  });

  // ─────────────────────── a conta do dia, para a distribuição ───────────────────────

  it('a distribuição vê o dia da loja: quantas dúvidas, quantas reconsultas e quanto custou', async () => {
    const loja = await montarLoja('Do dia');
    const ver = async () => (await app.inject({ method: 'GET', url: `/v1/distribuicao/lojas/${loja.lojaId}/balcao`, headers: D })).json();
    const vazio = await ver();
    assert.match(vazio.hoje.dia, /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(vazio.hoje, { dia: vazio.hoje.dia, duvidas: 0, respondidas: 0, falharam: 0, reconsultas: 0, custoCentavos: 0 });

    const doForte = ((1600 * 2 + 700 * 10) / 1_000_000) * DOLAR * 100;
    plataforma.fila.push(boa(), boa('nao_conforme', 0.5), boa('nao_conforme', 0.95, MODELO_FORTE, { input_tokens: 1600, output_tokens: 700 }), erroHttp(500));
    for (let i = 0; i < 3; i += 1) await loja.perguntar(await loja.duvida());
    const cheio = await ver();
    assert.deepEqual({ ...cheio.hoje, custoCentavos: 0 }, { dia: vazio.hoje.dia, duvidas: 3, respondidas: 2, falharam: 1, reconsultas: 1, custoCentavos: 0 });
    assert.ok(Math.abs(cheio.hoje.custoCentavos - (2 * CUSTO_DA_BOA + doForte)) < 1e-9);

    // O que é de ontem não entra na conta de hoje.
    await pool.query('update duvida set dia = dia - 1 where loja_id = $1', [loja.lojaId]);
    assert.deepEqual((await ver()).hoje, vazio.hoje);

    // E o comando da distribuição mostra a conta do dia.
    await pool.query('update duvida set dia = dia + 1 where loja_id = $1', [loja.lojaId]);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const porta = String((app.server.address() as AddressInfo).port);
    const saida = await new Promise<string>((resolver, rejeitar) => {
      const filho = spawn(process.execPath, [PROVISIONAR, 'balcao', loja.lojaId], { env: { ...process.env, PORT: porta, FAROL_ADMIN_TOKEN: ADMIN } });
      let escrito = '';
      filho.stdout.on('data', (p) => (escrito += String(p)));
      filho.on('error', rejeitar);
      filho.on('close', () => resolver(escrito));
      filho.stdin.end();
    });
    assert.match(saida, /hoje \(\d{4}-\d{2}-\d{2}\): 3 dúvida\(s\) — 2 respondida\(s\), 1 sem resposta/);
    assert.match(saida, /reconsultas ao modelo forte: 1/);
    assert.match(saida, /gasto de hoje: R\$ 0,06 de R\$ 40,00/);
  });

  // ─────────────────────── a chamada de verdade ───────────────────────

  it('com o transporte de verdade, a pergunta chega à plataforma com a conta da loja no cabeçalho', async () => {
    const recebidos: { chave: string | undefined; corpo: string }[] = [];
    const deMentira = createServer((req, res) => {
      let corpo = '';
      req.setEncoding('utf8');
      req.on('data', (p) => (corpo += p));
      req.on('end', () => {
        recebidos.push({ chave: req.headers['x-api-key'] as string | undefined, corpo });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(boa('nao_avaliavel', 0.3).corpo));
      });
    });
    await new Promise<void>((ok) => deMentira.listen(0, '127.0.0.1', ok));
    const outroApp = criarApp(pool, {
      logger: false,
      balcao: { cofre, enviar: transporteHttp({ endereco: `http://127.0.0.1:${(deMentira.address() as AddressInfo).port}` }), dolar: DOLAR },
    });
    try {
      await outroApp.ready();
      const loja = await montarLoja('De verdade');
      const r = await outroApp.inject({ method: 'POST', url: '/v1/agentes/duvidas', headers: { authorization: `Bearer ${loja.token}` }, payload: await loja.duvida() });
      assert.equal(r.statusCode, 200, r.body);
      assert.deepEqual([r.json().resultado, r.json().confianca, r.json().reconsultou], ['nao_avaliavel', 0.3, false]);
      assert.equal(recebidos.length, 1);
      assert.equal(recebidos[0]!.chave, loja.chaveDaConta);
      assert.equal(JSON.parse(recebidos[0]!.corpo).model, MODELO_DE_ROTINA);
      assert.ok(!recebidos[0]!.corpo.includes(loja.chaveDaConta));
    } finally {
      await outroApp.close();
      deMentira.closeAllConnections();
      await new Promise((ok) => deMentira.close(ok));
    }
  });
});
