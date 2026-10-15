// =====================================================================
// A fila da cozinha desce para a loja
// =====================================================================
// A19, fatia 5. A nuvem lê a fila da cozinha no Regem (`GET
// /integracao/producao`) com o acesso guardado da loja e a entrega ao
// agente no formato do Farol (`GET /v1/agentes/fila-da-cozinha`).
//
// O que atravessa a fronteira está em `contratos/fila-da-cozinha.json`: a
// resposta de exemplo do Regem (`doRegem`) e exatamente o que desce dela.
// Do outro lado está o Regem de teste (um servidor de verdade), que
// responde a fila que o teste manda.
//
// Cada teste usa uma loja só dele: a memória da rota (uma leitura do Regem
// por loja a cada 15 s) é por loja.
// =====================================================================

import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { cifrar } from '../src/cifra.js';
import { ETAPAS_DO_PEDIDO, filaParaOAgente, ORIGENS_DO_PEDIDO, versaoDaFila, type PedidoDaFila } from '../src/fila-da-cozinha.js';
import { lerFichasDaLoja, semLeituraEmCurso } from '../src/leitura.js';
import { novoPedido, trocarCodigo, type ConfigDoRegem } from '../src/regem.js';
import { FILA } from '../src/rotas/fila-da-cozinha.js';
import { subirRegemFalso, type RegemFalso } from './regem-falso.js';

type Recusa = { quando: string; status: number; erro?: string; esperarS?: number };
const CONTRATO = JSON.parse(readFileSync(new URL('../../contratos/fila-da-cozinha.json', import.meta.url), 'utf8')) as {
  rota: string;
  ritmo: { frescorS: number; esperaDaFalhaS: number };
  doRegem: { loja_id: string; gerado_em: string; pedidos: any[] };
  resposta: { versao: string; atualizado: true; lidaEm: string; geradoEm: string; esperarS: number; pedidos: PedidoDaFila[] };
  naoMudou: { resposta: { versao: string; atualizado: false; lidaEm: string; esperarS: number } };
  chaves: {
    daResposta: string[];
    doNaoMudou: string[];
    doPedido: string[];
    doItem: string[];
    daEscolha: string[];
    etapas: string[];
    origens: string[];
    efeitos: string[];
  };
  recusas: Recusa[];
};
const recusa = (status: number) => CONTRATO.recusas.find((r) => r.status === status)!;

describe('fila da cozinha: o contrato', () => {
  it('a resposta do exemplo é exatamente o que a conversão tira do exemplo do Regem — com a versão dela', () => {
    const fila = filaParaOAgente(CONTRATO.doRegem);
    assert.ok(fila, 'o exemplo do Regem não é torto');
    assert.equal(fila.foraDoFormato, 0);
    assert.deepEqual(fila.pedidos, CONTRATO.resposta.pedidos, 'mudou a conversão: gere a resposta do contrato de novo');
    assert.equal(versaoDaFila(fila), CONTRATO.resposta.versao);
    assert.match(CONTRATO.resposta.versao, /^[0-9a-f]{64}$/);
    assert.equal(fila.geradoEm, CONTRATO.resposta.geradoEm);
    assert.equal(CONTRATO.naoMudou.resposta.versao, CONTRATO.resposta.versao, 'o "nada mudou" do exemplo é o da mesma fila');
  });

  it('as chaves e as listas do contrato são as da conversão e as da rota', () => {
    assert.deepEqual(Object.keys(CONTRATO.resposta), CONTRATO.chaves.daResposta);
    assert.deepEqual(Object.keys(CONTRATO.naoMudou.resposta), CONTRATO.chaves.doNaoMudou);
    let escolhas = 0;
    for (const p of CONTRATO.resposta.pedidos) {
      assert.deepEqual(Object.keys(p), CONTRATO.chaves.doPedido);
      for (const i of p.itens) {
        assert.deepEqual(Object.keys(i), CONTRATO.chaves.doItem);
        for (const e of i.escolhas) {
          escolhas += 1;
          assert.deepEqual(Object.keys(e), CONTRATO.chaves.daEscolha);
          assert.ok(CONTRATO.chaves.efeitos.includes(e.efeito.tipo), e.efeito.tipo);
        }
      }
    }
    assert.ok(escolhas >= 3, 'o exemplo tem escolha de acrescentar insumo, de tirar e de preparo');
    assert.deepEqual(CONTRATO.chaves.etapas, [...ETAPAS_DO_PEDIDO]);
    assert.deepEqual(CONTRATO.chaves.origens, [...ORIGENS_DO_PEDIDO]);
    assert.equal(CONTRATO.ritmo.frescorS * 1000, FILA.frescorMs);
    assert.equal(CONTRATO.ritmo.esperaDaFalhaS * 1000, FILA.esperaDaFalhaMs);
    assert.equal(CONTRATO.resposta.esperarS, CONTRATO.ritmo.frescorS);
    assert.equal(recusa(502).esperarS, CONTRATO.ritmo.esperaDaFalhaS);
  });

  it('não desce o que muda à toa nem o que é do Regem: o id da variação e a loja de lá', () => {
    const texto = JSON.stringify(CONTRATO.resposta);
    const variacao = CONTRATO.doRegem.pedidos[1].itens[0].variacao.id as string;
    assert.ok(!texto.includes(variacao), 'o id da variação muda a cada salvamento no Regem');
    assert.ok(!texto.includes(CONTRATO.doRegem.loja_id), 'a loja sai do token');
    assert.ok(!/"[a-z]+_[a-z_]+":/.test(texto), 'nenhuma chave do formato de lá');
  });

  it('tolerante: o que está fora do contrato fica de fora e é contado; sem a lista de pedidos é torta', () => {
    for (const torta of [null, [], 'fila', { versao: 'x' }, { pedidos: {} }]) assert.equal(filaParaOAgente(torta), null, JSON.stringify(torta));
    const bom = CONTRATO.doRegem.pedidos[1];
    const fila = filaParaOAgente({
      gerado_em: 'ontem',
      pedidos: [
        null,
        { ...bom, id: '' },
        { ...bom, status: 'perdido' },
        { ...bom, criado_em: 'agora' },
        {
          ...bom,
          numero: 4.5,
          origem: 'drone',
          consumo: 'lá',
          tempo_preparo_min: -1,
          alterado: 'sim',
          iniciado_em: 'logo',
          itens: [
            'um item',
            { descricao: '   ' },
            {
              ...bom.itens[0],
              quantidade: 0,
              removido: 'sim',
              variacao: { nome: 'Duplo' },
              adicionais: [
                { tipo: 'trocar', nome: 'Bacon' },
                { tipo: 'remover', nome: '' },
                7,
                { tipo: 'remover', nome: 'Sem cebola', vezes: 1.5, retira: 'cebola' },
                { tipo: 'adicionar', nome: 'Bacon', vezes: 0, acrescenta: { tipo: 'insumo', nome: 'Bacon fatiado' } },
              ],
            },
          ],
        },
      ],
    });
    assert.ok(fila);
    assert.equal(fila.geradoEm, null);
    assert.equal(fila.pedidos.length, 1);
    assert.equal(fila.foraDoFormato, 4 + 2 + 3, '4 pedidos, 2 itens e 3 escolhas');
    const [p] = fila.pedidos;
    assert.deepEqual(
      [p!.numero, p!.origem, p!.consumo, p!.tempoPreparoMin, p!.alterado, p!.iniciadoEm],
      [null, null, null, null, false, null],
    );
    const [i] = p!.itens;
    assert.deepEqual([i!.quantidade, i!.removido, i!.variacao], [1, false, { nome: 'Duplo', codigo: null, fator: 1 }]);
    assert.deepEqual(i!.escolhas, [
      { tipo: 'remover', opcaoId: null, nome: 'Sem cebola', vezes: 1, efeito: { tipo: 'nada' } },
      {
        tipo: 'adicionar',
        opcaoId: null,
        nome: 'Bacon',
        vezes: 1,
        efeito: { tipo: 'insumo', nome: 'Bacon fatiado', quantidade: null, unidade: null, insumoId: null },
      },
    ]);
  });

  it('a versão muda com o que desce, e só com isso: a hora do Regem e o id da variação não a mudam', () => {
    const v = (corpo: unknown) => versaoDaFila(filaParaOAgente(corpo)!);
    const base = () => structuredClone(CONTRATO.doRegem);
    const v0 = v(base());
    assert.equal(v({ ...base(), gerado_em: '2026-10-15T23:59:00.000Z' }), v0);
    const outraVariacao = base();
    outraVariacao.pedidos[1].itens[0].variacao.id = randomUUID();
    assert.equal(v(outraVariacao), v0);
    const outraEtapa = base();
    outraEtapa.pedidos[1].status = 'pronto';
    assert.notEqual(v(outraEtapa), v0);
    const outraObservacao = base();
    outraObservacao.pedidos[1].itens[0].observacao = 'sem sal';
    assert.notEqual(v(outraObservacao), v0);
    const semUmPedido = base();
    semUmPedido.pedidos.splice(0, 1);
    assert.notEqual(v(semUmPedido), v0);
  });
});

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-fila-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-fila-da-cozinha';
const mudo = { warn: () => {}, info: () => {}, error: () => {} };
const TEMPOS = { ...FILA };

async function esperar<T>(f: () => Promise<T | null | undefined | false>, ms = 3000): Promise<T> {
  const fim = Date.now() + ms;
  for (;;) {
    const v = await f();
    if (v) return v;
    if (Date.now() > fim) throw new Error('esperei e não veio');
    await new Promise((ok) => setTimeout(ok, 20));
  }
}

describe('fila da cozinha: a rota do agente', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let falso: RegemFalso;
  let cfg: ConfigDoRegem & { segredo: string; chave: Buffer };
  let adminAntes: string | undefined;
  let n = 0;

  async function daDistribuicao(url: string, payload: object) {
    const r = await app.inject({ method: 'POST', url, headers: { 'x-farol-admin': ADMIN }, payload });
    assert.equal(r.statusCode, 201, r.body);
    return r.json();
  }
  /** Uma loja nova, numa conta nova, com o agente dela ativo. */
  async function lojaComAgente() {
    n += 1;
    const c = await daDistribuicao('/v1/distribuicao/lojas', { tenant: { nome: `${marca}-${n}` }, loja: { nome: `Loja ${n}` }, setores: [{ nome: 'Cozinha' }] });
    const criado = await daDistribuicao('/v1/distribuicao/agentes', { lojaId: c.loja.id, nome: `agente-${n}` });
    const ativado = await app.inject({
      method: 'POST',
      url: '/v1/agentes/ativar',
      headers: { authorization: `Bearer ${criado.token}` },
      payload: { fingerprint: `maquina-${marca}-${n}`, versao: '0.1.0-loja' },
    });
    assert.equal(ativado.statusCode, 200, ativado.body);
    return { tenantId: c.tenantId as string, lojaId: c.loja.id as string, token: criado.token as string };
  }
  /** A loja ligada a uma loja do Regem de teste, com um acesso que vale lá. */
  async function ligada(l: { tenantId: string; lojaId: string }) {
    const regemLojaId = randomUUID();
    const p = novoPedido();
    const codigo = falso.autorizar({ lojas: [{ id: regemLojaId, nome: 'Loja de lá' }], desafio: p.desafio, redirectUri: cfg.retornoUrl });
    const [d] = await trocarCodigo(cfg, { codigo, verificador: p.verificador });
    const { rows } = await pool.query(
      `insert into regem_loja (tenant_id, loja_id, regem_loja_id, regem_loja_nome, regem_empresa_nome, acesso_cifrado, ligado_em)
       values ($1, $2, $3, 'Loja de lá', 'Empresa de lá', $4, now()) returning id`,
      [l.tenantId, l.lojaId, regemLojaId, cifrar(d!.acesso, cfg.chave, `acesso:${l.tenantId}:${regemLojaId}`)],
    );
    return { id: rows[0].id as string, regemLojaId, acesso: d!.acesso };
  }
  const fila = (token: string, versao?: string, noApp: FastifyInstance = app) =>
    noApp.inject({
      method: 'GET',
      url: `/v1/agentes/fila-da-cozinha${versao === undefined ? '' : `?versao=${versao}`}`,
      headers: { authorization: `Bearer ${token}` },
    });
  const lidasDaFila = () => falso.chamadas.filter((c) => c.caminho.startsWith('/integracao/producao'));

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    falso = await subirRegemFalso();
    cfg = {
      apiUrl: falso.url,
      appUrl: 'https://regem.exemplo',
      retornoUrl: 'https://console.exemplo/api/regem/retorno',
      consoleUrl: 'https://console.exemplo',
      segredo: falso.segredo,
      chave: randomBytes(32),
      buscar: fetch,
      prazoMs: 400,
      agente: 'farol-api/teste (+https://monitorfarol.com.br)',
    };
    app = criarApp(pool, { logger: false, regem: cfg });
    await app.ready();
  });

  after(async () => {
    Object.assign(FILA, TEMPOS);
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    falso?.soltar();
    await semLeituraEmCurso();
    await app?.close();
    await falso?.fechar();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  beforeEach(() => {
    Object.assign(FILA, TEMPOS);
    falso.modo = 'normal';
    falso.filaSemEscopo = false;
    falso.leituraTorta = null;
    falso.chamadas.length = 0;
  });
  afterEach(async () => {
    falso.soltar();
    await semLeituraEmCurso();
  });

  it('sem token, ou com token que não vale: 401, e o Regem nem é chamado', async () => {
    const sem = await app.inject({ method: 'GET', url: CONTRATO.rota.replace('GET ', '') });
    assert.equal(sem.statusCode, recusa(401).status);
    assert.equal((await fila('token-que-nao-existe')).statusCode, 401);
    assert.equal(lidasDaFila().length, 0);
  });

  it('loja sem Regem: 404 sem_regem, com o tempo de espera do contrato — e o Regem nem é chamado', async () => {
    const l = await lojaComAgente();
    const r = await fila(l.token);
    assert.equal(r.statusCode, 404, r.body);
    assert.equal(r.json().erro, recusa(404).erro);
    assert.equal(r.json().esperarS, recusa(404).esperarS);
    assert.equal(lidasDaFila().length, 0);
  });

  it('a fila do Regem desce exatamente como no contrato — pela loja do token, sem cache no caminho', async () => {
    const l = await lojaComAgente();
    const c = await ligada(l);
    falso.fila(c.regemLojaId, CONTRATO.doRegem.pedidos);

    const r = await fila(l.token);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.headers['cache-control'], 'no-store');
    const corpo = r.json();
    assert.deepEqual(Object.keys(corpo), CONTRATO.chaves.daResposta);
    assert.deepEqual(corpo.pedidos, CONTRATO.resposta.pedidos);
    assert.equal(corpo.versao, CONTRATO.resposta.versao);
    assert.equal(corpo.atualizado, true);
    assert.equal(corpo.esperarS, CONTRATO.resposta.esperarS);
    for (const hora of [corpo.lidaEm, corpo.geradoEm]) assert.ok(!Number.isNaN(Date.parse(hora)), hora);

    const lidas = lidasDaFila();
    assert.equal(lidas.length, 1);
    assert.equal(lidas[0]!.caminho, '/integracao/producao', 'a primeira leitura vai sem versão');
    assert.ok(lidas[0]!.comAcesso);
    assert.equal(lidas[0]!.agente, cfg.agente);
  });

  it('com a versão que a loja já tem: só "nada mudou"; com outra (ou torta), a fila inteira', async () => {
    const l = await lojaComAgente();
    const c = await ligada(l);
    falso.fila(c.regemLojaId, CONTRATO.doRegem.pedidos);
    assert.equal((await fila(l.token)).statusCode, 200);

    const igual = await fila(l.token, CONTRATO.resposta.versao);
    assert.equal(igual.statusCode, 200, igual.body);
    assert.deepEqual(Object.keys(igual.json()), CONTRATO.chaves.doNaoMudou);
    assert.deepEqual({ ...igual.json(), lidaEm: null }, { ...CONTRATO.naoMudou.resposta, lidaEm: null });

    for (const outra of ['0'.repeat(64), 'abc', CONTRATO.resposta.versao.toUpperCase(), '']) {
      const r = await fila(l.token, outra);
      assert.equal(r.json().atualizado, true, outra);
      assert.equal(r.json().pedidos.length, CONTRATO.resposta.pedidos.length);
    }
    assert.equal(lidasDaFila().length, 1, 'tudo isso dentro dos 15 s: uma leitura do Regem só');
  });

  it('perguntas ao mesmo tempo esperam a MESMA leitura do Regem, e as seguintes, dentro do frescor, não o chamam', async () => {
    const l = await lojaComAgente();
    const c = await ligada(l);
    falso.fila(c.regemLojaId, CONTRATO.doRegem.pedidos);
    falso.segurar();
    const pedidos = Array.from({ length: 5 }, () => fila(l.token));
    await esperar(async () => falso.seguradas() >= 1);
    await new Promise((ok) => setTimeout(ok, 50));
    assert.equal(falso.seguradas(), 1, 'uma leitura parada no Regem, e não cinco');
    falso.soltar();
    const respostas = await Promise.all(pedidos);
    for (const r of respostas) {
      assert.equal(r.statusCode, 200, r.body);
      assert.equal(r.json().versao, CONTRATO.resposta.versao);
    }
    assert.equal((await fila(l.token)).statusCode, 200);
    assert.equal(lidasDaFila().length, 1);
  });

  it('passado o frescor, pergunta ao Regem com a versão DE LÁ: "nada mudou" lá mantém a fila e anda a hora; a mudança chega', async () => {
    FILA.frescorMs = 0;
    const l = await lojaComAgente();
    const c = await ligada(l);
    falso.fila(c.regemLojaId, CONTRATO.doRegem.pedidos);
    const primeira = (await fila(l.token)).json();
    const segunda = await fila(l.token, primeira.versao);
    assert.equal(segunda.json().atualizado, false);
    assert.ok(Date.parse(segunda.json().lidaEm) >= Date.parse(primeira.lidaEm));
    const lidas = lidasDaFila();
    assert.equal(lidas.length, 2);
    assert.match(lidas[1]!.caminho, /^\/integracao\/producao\?versao=[0-9a-f]{32}$/, 'a segunda pergunta "mudou?" ao Regem');

    // o pedido 41 fica pronto
    const pronto = structuredClone(CONTRATO.doRegem.pedidos);
    pronto[1].status = 'pronto';
    pronto[1].pronto_em = '2026-10-15T22:44:00.000Z';
    falso.fila(c.regemLojaId, pronto);
    const terceira = await fila(l.token, primeira.versao);
    assert.equal(terceira.json().atualizado, true);
    assert.notEqual(terceira.json().versao, primeira.versao);
    assert.deepEqual(
      terceira.json().pedidos.map((p: PedidoDaFila) => [p.numero, p.etapa]),
      [
        [39, 'pronto'],
        [41, 'pronto'],
        [42, 'recebido'],
      ],
    );
  });

  it('a mudança que não desce (o id da variação, trocado a cada salvamento lá) não muda a versão da loja', async () => {
    FILA.frescorMs = 0;
    const l = await lojaComAgente();
    const c = await ligada(l);
    falso.fila(c.regemLojaId, CONTRATO.doRegem.pedidos);
    const antes = (await fila(l.token)).json();
    const salvoDeNovo = structuredClone(CONTRATO.doRegem.pedidos);
    salvoDeNovo[1].itens[0].variacao.id = randomUUID();
    falso.fila(c.regemLojaId, salvoDeNovo);
    const depois = await fila(l.token, antes.versao);
    assert.deepEqual([depois.json().atualizado, depois.json().versao], [false, antes.versao]);
    assert.equal(lidasDaFila().length, 2, 'o Regem foi lido — e respondeu a fila inteira, com outra versão de lá');
  });

  it('o Regem fora (erro, limite, mudo, página, resposta torta): 502 regem_fora com o tempo de espera do contrato', async () => {
    FILA.esperaDaFalhaMs = 0;
    const l = await lojaComAgente();
    await ligada(l);
    const casos: Array<[string, () => void]> = [
      ['fora', () => void (falso.modo = 'fora')],
      ['devagar', () => void (falso.modo = 'devagar')],
      ['mudo', () => void (falso.modo = 'mudo')],
      ['pagina', () => void (falso.modo = 'pagina')],
      ['sem pedidos', () => void (falso.leituraTorta = (qual, corpo) => (qual === 'producao' ? { ...corpo, pedidos: null } : corpo))],
      ['sem versão', () => void (falso.leituraTorta = (qual, corpo) => (qual === 'producao' ? { ...corpo, versao: 'nova' } : corpo))],
    ];
    for (const [nome, estragar] of casos) {
      falso.modo = 'normal';
      falso.leituraTorta = null;
      estragar();
      const r = await fila(l.token);
      assert.equal(r.statusCode, 502, `${nome}: ${r.body}`);
      assert.deepEqual(r.json(), { erro: recusa(502).erro, mensagem: r.json().mensagem, esperarS: recusa(502).esperarS }, nome);
    }
    falso.modo = 'normal';
    falso.leituraTorta = null;
    const volta = await fila(l.token);
    assert.equal(volta.statusCode, 200, 'o Regem voltou: a fila volta');
  });

  it('a falha fica guardada: o Regem fora do ar não recebe uma chamada a cada pergunta', async () => {
    const l = await lojaComAgente();
    await ligada(l);
    falso.modo = 'fora';
    for (let i = 0; i < 4; i += 1) assert.equal((await fila(l.token)).statusCode, 502);
    assert.equal(lidasDaFila().length, 1);
    falso.modo = 'normal';
    assert.equal((await fila(l.token)).statusCode, 502, 'ainda dentro da espera da falha');
    FILA.esperaDaFalhaMs = 0;
    assert.equal((await fila(l.token)).statusCode, 200);
    assert.equal(lidasDaFila().length, 2);
  });

  it('a falha de passagem não apaga a leitura boa: a pergunta seguinte ao Regem ainda leva a versão de lá', async () => {
    FILA.frescorMs = 0;
    FILA.esperaDaFalhaMs = 0;
    const l = await lojaComAgente();
    const c = await ligada(l);
    falso.fila(c.regemLojaId, CONTRATO.doRegem.pedidos);
    assert.equal((await fila(l.token)).statusCode, 200);
    falso.modo = 'fora';
    assert.equal((await fila(l.token)).statusCode, 502);
    falso.modo = 'normal';
    const r = await fila(l.token, CONTRATO.resposta.versao);
    assert.equal(r.json().atualizado, false);
    const lidas = lidasDaFila();
    assert.equal(lidas.length, 3);
    assert.match(lidas[2]!.caminho, /\?versao=[0-9a-f]{32}$/);
  });

  it('a loja sem leitura há tempo sai da memória', async () => {
    const l = await lojaComAgente();
    const c = await ligada(l);
    falso.fila(c.regemLojaId, CONTRATO.doRegem.pedidos);
    assert.equal((await fila(l.token)).statusCode, 200);
    assert.equal((await fila(l.token)).statusCode, 200);
    assert.equal(lidasDaFila().length, 1, 'dentro do frescor, da memória');
    FILA.faxinaMs = 0;
    FILA.esqueceMs = 0;
    await new Promise((ok) => setTimeout(ok, 5));
    assert.equal((await fila(l.token)).statusCode, 200);
    const lidas = lidasDaFila();
    assert.equal(lidas.length, 2, 'esquecida: lida de novo');
    assert.equal(lidas[1]!.caminho, '/integracao/producao', 'e sem a versão de antes, que saiu junto');
  });

  it('a autorização sem o escopo da fila: 409 sem_escopo — e a conexão continua de pé (as fichas seguem)', async () => {
    const l = await lojaComAgente();
    const c = await ligada(l);
    falso.filaSemEscopo = true;
    const r = await fila(l.token);
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().erro, recusa(409).erro);
    assert.equal(r.json().esperarS, recusa(409).esperarS);
    await semLeituraEmCurso();
    const { rows } = await pool.query('select acesso_tirado_em from regem_loja where id = $1', [c.id]);
    assert.equal(rows[0].acesso_tirado_em, null);
    assert.deepEqual(await lerFichasDaLoja(pool, cfg, c.id, mudo), { desfecho: 'atualizada' });
  });

  it('o acesso tirado no Regem: 404 sem_regem, e a leitura das fichas confirma e aplica a regra (o acesso cai, a base sai)', async () => {
    const l = await lojaComAgente();
    const c = await ligada(l);
    assert.deepEqual(await lerFichasDaLoja(pool, cfg, c.id, mudo), { desfecho: 'atualizada' });
    falso.tirar(c.acesso);

    const r = await fila(l.token);
    assert.equal(r.statusCode, 404, r.body);
    assert.equal(r.json().erro, recusa(404).erro);
    await semLeituraEmCurso();
    const conexao = await pool.query('select acesso_tirado_em from regem_loja where id = $1', [c.id]);
    assert.ok(conexao.rows[0].acesso_tirado_em, 'o acesso caiu');
    const base = await pool.query('select 1 from fichas_da_loja where loja_id = $1', [l.lojaId]);
    assert.equal(base.rowCount, 0, 'a base saiu, como no desconectar');

    FILA.esperaDaFalhaMs = 0;
    falso.chamadas.length = 0;
    assert.equal((await fila(l.token)).statusCode, 404);
    assert.equal(lidasDaFila().length, 0, 'com o acesso marcado como tirado, o Regem nem é chamado');
  });

  it('cada loja vê só a sua fila', async () => {
    const a = await lojaComAgente();
    const b = await lojaComAgente();
    const ca = await ligada(a);
    const cb = await ligada(b);
    const [p39, p41] = CONTRATO.doRegem.pedidos;
    falso.fila(ca.regemLojaId, [p39]);
    falso.fila(cb.regemLojaId, [p41]);
    const ra = (await fila(a.token)).json();
    const rb = (await fila(b.token)).json();
    assert.deepEqual(ra.pedidos.map((p: PedidoDaFila) => p.numero), [39]);
    assert.deepEqual(rb.pedidos.map((p: PedidoDaFila) => p.numero), [41]);
    assert.equal(lidasDaFila().length, 2, 'a memória é por loja');
  });

  it('conectada de novo: a versão do Regem de antes não é usada na pergunta "mudou?"', async () => {
    FILA.frescorMs = 0;
    const l = await lojaComAgente();
    const antes = await ligada(l);
    falso.fila(antes.regemLojaId, CONTRATO.doRegem.pedidos);
    await fila(l.token);
    await pool.query('delete from regem_loja where id = $1', [antes.id]);
    const depois = await ligada(l);
    falso.fila(depois.regemLojaId, CONTRATO.doRegem.pedidos);
    const r = await fila(l.token);
    assert.equal(r.statusCode, 200, r.body);
    const lidas = lidasDaFila();
    assert.equal(lidas.length, 2);
    assert.equal(lidas[1]!.caminho, '/integracao/producao', 'outra conexão: a fila inteira, sem a versão da anterior');
  });

  it('sem a chave dos acessos nesta instalação: 503 sem_chave — e o Regem nem é chamado', async () => {
    const semChave = criarApp(pool, { logger: false, regem: { ...cfg, chave: null } });
    await semChave.ready();
    try {
      const l = await lojaComAgente();
      await ligada(l);
      const r = await fila(l.token, undefined, semChave);
      assert.equal(r.statusCode, 503, r.body);
      assert.equal(r.json().erro, recusa(503).erro);
      assert.equal(r.json().esperarS, recusa(503).esperarS);
      assert.equal(lidasDaFila().length, 0);
    } finally {
      await semChave.close();
    }
  });

  it('perguntar a cada 15 s não reescreve a linha do agente a cada vez: o uso do token é anotado no máximo uma vez por minuto', async () => {
    const l = await lojaComAgente();
    const usado = async () =>
      (await pool.query('select token_usado_em from agente where loja_id = $1', [l.lojaId])).rows[0].token_usado_em as Date | null;
    await new Promise((ok) => setTimeout(ok, 100));
    await pool.query('update agente set token_usado_em = null where loja_id = $1', [l.lojaId]);
    await fila(l.token);
    const primeiro = await esperar(usado);
    await fila(l.token);
    await fila(l.token);
    await new Promise((ok) => setTimeout(ok, 150));
    assert.equal((await usado())!.getTime(), primeiro.getTime(), 'dentro do minuto, a linha fica como está');
    await pool.query("update agente set token_usado_em = now() - interval '2 minutes' where loja_id = $1", [l.lojaId]);
    const velho = (await usado())!.getTime();
    await fila(l.token);
    await esperar(async () => ((await usado())!.getTime() > velho ? true : null));
  });
});
