// GET /v1/lojas/:id/orcamento — a conta ligada ao banco.
//
// A conta em si está provada em orcamento.test.ts, sem banco. Aqui se prova
// o que só o caminho inteiro mostra: que os critérios certos chegam ao canal
// certo, que o que foi excluído não entra, que a importância ordena, e que
// quem não é da loja — ou não decide compra — não vê.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { carregarCatalogo } from '../src/catalogo.js';

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-orcamento-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-orcamento';
const SENHA = 'uma senha longa o bastante';

describe('orçamento da loja (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  let lojaId = '';
  let cozinha = '';
  let salao = '';
  let cookie = '';
  let cookieExecucao = '';
  let cookieOutraConta = '';

  type Canal = { pontoId: string; zonaId: string };

  async function criarCanal(setorId: string, nome: string, canal: number): Promise<Canal> {
    const r = await app.inject({
      method: 'POST', url: `/v1/setores/${setorId}/pontos`, headers: { cookie },
      payload: { nome, origem: 'dvr', canal, host: '192.168.1.118' },
    });
    assert.equal(r.statusCode, 201, r.body);
    return { pontoId: r.json().id, zonaId: r.json().zonas[0].id };
  }

  async function criarCriterio(nome: string, tipo: string, zonaIds: string[], extra: Record<string, unknown> = {}) {
    const r = await app.inject({
      method: 'POST', url: `/v1/lojas/${lojaId}/regras`, headers: { cookie },
      payload: { nome, tipo, criterio: `Texto de ${nome}.`, zonaIds, ...extra },
    });
    assert.equal(r.statusCode, 201, r.body);
    return r.json().id as string;
  }

  const pessoa = { parametros: { objeto: 'pessoa', minimo: 1, maximo: null } };

  async function entrar(tenantId: string, email: string, nivel: string) {
    await app.inject({
      method: 'POST', url: '/v1/distribuicao/usuarios', headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId, nome: 'X', email, senha: SENHA, nivel },
    });
    const r = await app.inject({ method: 'POST', url: '/v1/sessao', payload: { email, senha: SENHA } });
    const b = r.headers['set-cookie'];
    return (Array.isArray(b) ? b[0]! : String(b)).split(';')[0]!;
  }

  const orcamento = async (comCookie = cookie, id = lojaId) =>
    app.inject({ method: 'GET', url: `/v1/lojas/${id}/orcamento`, headers: { cookie: comCookie } });

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    app = criarApp(pool, { logger: false });
    await app.ready();
    const carga = await carregarCatalogo(pool);
    assert.ok(carga.ok, `o catálogo tem que estar no banco: ${!carga.ok && carga.motivo}`);

    const loja = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome: marca }, loja: { nome: 'Matriz' }, setores: [{ nome: 'Cozinha' }, { nome: 'Salão' }] },
    })).json();
    lojaId = loja.loja.id;
    cozinha = loja.setores.find((s: { nome: string }) => s.nome === 'Cozinha').id;
    salao = loja.setores.find((s: { nome: string }) => s.nome === 'Salão').id;
    cookie = await entrar(loja.tenantId, `dono-${marca}@e.com`, 'presidente');
    cookieExecucao = await entrar(loja.tenantId, `exec-${marca}@e.com`, 'execucao');

    const vizinha = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome: `${marca}-vizinha` }, loja: { nome: 'Vizinha' }, setores: [{ nome: 'Cozinha' }] },
    })).json();
    cookieOutraConta = await entrar(vizinha.tenantId, `viz-${marca}@e.com`, 'presidente');
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  it('loja sem canal devolve orçamento vazio, não erro', async () => {
    const r = await orcamento();

    assert.equal(r.statusCode, 200, r.body);
    const o = r.json();
    assert.equal(o.loja.nome, 'Matriz');
    assert.equal(o.resumo.canais, 0);
    assert.equal(o.pacotes.length, 3);
    assert.deepEqual(o.pacotes[0].itens, []);
  });

  it('cada canal sai com os critérios DELE, a carga e opções que servem', async () => {
    const chapa = await criarCanal(cozinha, 'Chapa', 1);
    const balcao = await criarCanal(salao, 'Balcão', 2);
    await criarCanal(salao, 'Corredor', 3);
    await criarCriterio(`posto-${marca}`, 'presenca', [chapa.zonaId, balcao.zonaId], pessoa);
    await criarCriterio(`limpa-${marca}`, 'estado', [chapa.zonaId]);

    const o = (await orcamento()).json();

    const c = (nome: string) => o.canais.find((x: { nome: string }) => x.nome === nome);
    assert.deepEqual(c('Chapa').uso.tipos, ['estado', 'presenca']);
    assert.equal(c('Chapa').uso.carga, 'moderada');
    assert.equal(c('Chapa').exige.usoMaisExigente, 'estado');
    assert.deepEqual(c('Balcão').uso.tipos, ['presenca']);
    assert.equal(c('Balcão').uso.carga, 'leve');
    assert.equal(c('Corredor').uso.carga, 'sem_uso');
    assert.deepEqual(c('Corredor').opcoes, []);

    assert.ok(c('Balcão').opcoes.length === 3, 'presença tem opção nos três níveis');
    assert.ok(!c('Chapa').opcoes.some((x: { nivel: string }) => x.nivel === 'basico'), 'estado não serve com câmera básica');
    assert.equal(o.resumo.emUso, 2);
    assert.deepEqual(o.setores.map((s: { nome: string }) => s.nome), ['Cozinha', 'Salão']);
  });

  it('os pacotes somam câmera por canal em uso, mais gravador e computador', async () => {
    const o = (await orcamento()).json();
    const basico = o.pacotes[0];

    assert.deepEqual(
      basico.itens.map((i: { papel: string }) => i.papel).sort(),
      ['camera', 'camera', 'computador', 'gravador'],
    );
    assert.ok(basico.total.geral.min > 0);
    assert.ok(o.pacotes[2].total.geral.min >= basico.total.geral.min);
    assert.ok(o.avisos.some((a: string) => /óptica/.test(a)));
  });

  it('informada a óptica, a câmera que atende sai do pacote', async () => {
    const lista = (await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}`, headers: { cookie } })).json();
    const balcao = lista.setores.flatMap((s: { pontos: Array<{ id: string; nome: string }> }) => s.pontos)
      .find((p: { nome: string }) => p.nome === 'Balcão');
    // 1920 px numa cena de 200 cm = 9,6 px por cm; presença pede 1,5.
    const editar = await app.inject({
      method: 'PATCH', url: `/v1/pontos/${balcao.id}`, headers: { cookie },
      payload: { resolucaoH: 1920, larguraCenaCm: 200 },
    });
    assert.equal(editar.statusCode, 200, editar.body);

    const o = (await orcamento()).json();

    const c = o.canais.find((x: { nome: string }) => x.nome === 'Balcão');
    assert.equal(c.camera.situacao, 'atende');
    assert.equal(c.camera.pxPorCm, 9.6);
    const cameras = o.pacotes[0].itens.filter((i: { papel: string }) => i.papel === 'camera');
    assert.equal(cameras.length, 1, 'só a Chapa precisa de câmera agora');
    assert.match(cameras[0].para, /Chapa/);
  });

  it('a importância é do canal, grava-se pelo console e ordena a lista', async () => {
    const lista = (await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}`, headers: { cookie } })).json();
    const pontos = lista.setores.flatMap((s: { pontos: Array<{ id: string; nome: string; importancia: string }> }) => s.pontos);
    assert.ok(pontos.every((p: { importancia: string }) => p.importancia === 'normal'), 'nasce normal');
    const balcao = pontos.find((p: { nome: string }) => p.nome === 'Balcão');

    const r = await app.inject({
      method: 'PATCH', url: `/v1/pontos/${balcao.id}`, headers: { cookie }, payload: { importancia: 'critico' },
    });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().importancia, 'critico');

    const o = (await orcamento()).json();
    assert.equal(o.canais[0].nome, 'Balcão', 'o crítico vem primeiro, mesmo sendo o menos usado');
    assert.equal(o.canais[0].importancia, 'critico');
  });

  it('importância que não existe é recusada, e nada muda', async () => {
    const lista = (await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}`, headers: { cookie } })).json();
    const balcao = lista.setores.flatMap((s: { pontos: Array<{ id: string; nome: string }> }) => s.pontos)
      .find((p: { nome: string }) => p.nome === 'Balcão');

    const r = await app.inject({
      method: 'PATCH', url: `/v1/pontos/${balcao.id}`, headers: { cookie }, payload: { importancia: 'urgentíssimo' },
    });

    assert.equal(r.statusCode, 422);
    const depois = await pool.query('select importancia from ponto where id = $1', [balcao.id]);
    assert.equal(depois.rows[0].importancia, 'critico');
  });

  it('critério excluído e canal excluído não entram na conta', async () => {
    const fantasma = await criarCanal(cozinha, 'Fantasma', 9);
    const id = await criarCriterio(`some-${marca}`, 'acao', [fantasma.zonaId]);
    let o = (await orcamento()).json();
    assert.equal(o.canais.find((x: { nome: string }) => x.nome === 'Fantasma').uso.carga, 'intensa');

    await app.inject({ method: 'DELETE', url: `/v1/regras/${id}`, headers: { cookie } });
    o = (await orcamento()).json();
    assert.equal(o.canais.find((x: { nome: string }) => x.nome === 'Fantasma').uso.carga, 'sem_uso');

    await app.inject({ method: 'DELETE', url: `/v1/pontos/${fantasma.pontoId}`, headers: { cookie } });
    o = (await orcamento()).json();
    assert.equal(o.canais.find((x: { nome: string }) => x.nome === 'Fantasma'), undefined);
  });

  it('a resposta traz soluções, não o catálogo', async () => {
    const texto = (await orcamento()).body;

    for (const interno of ['MHDX 1308', 'Coral USB', 'ARMADILHA', 'migration 002', 'medição em campo']) {
      assert.ok(!texto.includes(interno), `saiu dado interno do catálogo: ${interno}`);
    }
  });

  it('outra conta recebe 404; execução, 403; sem sessão, 401', async () => {
    assert.equal((await orcamento(cookieOutraConta)).statusCode, 404);
    assert.equal((await orcamento(cookieExecucao)).statusCode, 403);
    assert.equal((await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}/orcamento` })).statusCode, 401);
    assert.equal((await orcamento(cookie, 'qualquer-coisa')).statusCode, 404);
  });
});
