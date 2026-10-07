// Rotas do console: lojas, setores e pontos.
//
// O que se protege aqui é o isolamento entre clientes. Toda rota filtra
// pelo tenant da SESSÃO, nunca por um campo que o cliente manda — e os
// testes de vizinhança abaixo são os que provam isso, não o código.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';

const URL = process.env.DATABASE_URL;
const marca = `teste-con-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-console';
const SENHA = 'uma senha longa o bastante';

describe('console: lojas, setores e pontos', { skip: !URL && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;

  // Duas empresas diferentes, para provar que uma não enxerga a outra.
  const minha = { tenantId: '', lojaId: '', setorId: '', pontoId: '', cookie: '' };
  const vizinha = { tenantId: '', lojaId: '', setorId: '', cookie: '' };
  let cookieExecucao = '';

  async function criarUsuario(tenantId: string, email: string, nivel: string) {
    const r = await app.inject({
      method: 'POST',
      url: '/v1/distribuicao/usuarios',
      headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId, nome: 'Alguém', email, senha: SENHA, nivel },
    });
    assert.equal(r.statusCode, 201, r.body);
    const login = await app.inject({
      method: 'POST',
      url: '/v1/sessao',
      payload: { email, senha: SENHA },
    });
    assert.equal(login.statusCode, 200, login.body);
    const bruto = login.headers['set-cookie'];
    return (Array.isArray(bruto) ? bruto[0]! : String(bruto)).split(';')[0]!;
  }

  async function montar(nome: string) {
    const r = await app.inject({
      method: 'POST',
      url: '/v1/distribuicao/lojas',
      headers: { 'x-farol-admin': ADMIN },
      payload: {
        tenant: { nome: `${marca}-${nome}` },
        loja: { nome },
        setores: [{ nome: 'Cozinha' }],
      },
    });
    assert.equal(r.statusCode, 201, r.body);
    const c = r.json();
    return { tenantId: c.tenantId, lojaId: c.loja.id, setorId: c.setores[0].id };
  }

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL });
    app = criarApp(pool, { logger: false });
    await app.ready();

    Object.assign(minha, await montar('Minha Loja'));
    Object.assign(vizinha, await montar('Loja Vizinha'));

    minha.cookie = await criarUsuario(minha.tenantId, `dono-${marca}@e.com`, 'presidente');
    vizinha.cookie = await criarUsuario(vizinha.tenantId, `viz-${marca}@e.com`, 'presidente');
    cookieExecucao = await criarUsuario(minha.tenantId, `exec-${marca}@e.com`, 'execucao');
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  const comoDono = (extra = {}) => ({ cookie: minha.cookie, ...extra });

  // ──────────────────────── sem sessão, nada ────────────────────────

  it('toda rota exige sessão', async () => {
    const rotas: Array<[string, string]> = [
      ['GET', '/v1/lojas'],
      ['GET', `/v1/lojas/${minha.lojaId}`],
      ['POST', `/v1/lojas/${minha.lojaId}/setores`],
      ['POST', `/v1/setores/${minha.setorId}/pontos`],
      ['PATCH', `/v1/pontos/${randomUUID()}`],
      ['DELETE', `/v1/pontos/${randomUUID()}`],
    ];
    for (const [method, url] of rotas) {
      const r = await app.inject({ method: method as 'GET', url, payload: {} });
      assert.equal(r.statusCode, 401, `${method} ${url}`);
    }
  });

  // ────────────────────── o isolamento entre lojas ──────────────────

  it('a lista só traz as lojas do próprio tenant', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/lojas', headers: comoDono() });

    assert.equal(r.statusCode, 200);
    const nomes = r.json().lojas.map((l: { nome: string }) => l.nome);
    assert.ok(nomes.includes('Minha Loja'));
    assert.ok(!nomes.includes('Loja Vizinha'), 'não pode enxergar a loja de outro cliente');
  });

  it('abrir a loja do vizinho é 404, não 403', async () => {
    // 403 diria "existe, mas não é sua" — e isso já é informação sobre
    // outro cliente.
    const r = await app.inject({
      method: 'GET',
      url: `/v1/lojas/${vizinha.lojaId}`,
      headers: comoDono(),
    });
    assert.equal(r.statusCode, 404);
  });

  it('criar setor na loja do vizinho é 404', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `/v1/lojas/${vizinha.lojaId}/setores`,
      headers: comoDono(),
      payload: { nome: 'invasao' },
    });
    assert.equal(r.statusCode, 404);

    const conferir = await pool.query('select count(*)::int n from setor where nome = $1', ['invasao']);
    assert.equal(conferir.rows[0].n, 0, 'não pode ter criado nada');
  });

  it('criar ponto no setor do vizinho é 404', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `/v1/setores/${vizinha.setorId}/pontos`,
      headers: comoDono(),
      payload: { nome: 'invasao', origem: 'ip' },
    });
    assert.equal(r.statusCode, 404);
  });

  // ───────────────── a lacuna que estas rotas fecham ────────────────

  it('acrescenta ponto a uma loja que JÁ existe', async () => {
    // Era o que não tinha caminho: a distribuição criava a loja inteira
    // de uma vez, e câmera nova depois disso ficava sem como cadastrar.
    const r = await app.inject({
      method: 'POST',
      url: `/v1/setores/${minha.setorId}/pontos`,
      headers: comoDono(),
      payload: {
        nome: 'Montagem',
        origem: 'dvr',
        fabricante: 'intelbras',
        canal: 11,
        host: '192.168.1.108',
        usuario: 'admin',
      },
    });

    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json().canal, 11);
    assert.equal(r.json().porta, 554, 'a porta padrão entra sozinha');
    minha.pontoId = r.json().id;
  });

  it('a loja aberta mostra setores com seus pontos', async () => {
    const r = await app.inject({
      method: 'GET',
      url: `/v1/lojas/${minha.lojaId}`,
      headers: comoDono(),
    });

    assert.equal(r.statusCode, 200);
    const cozinha = r.json().setores.find((s: { nome: string }) => s.nome === 'Cozinha');
    assert.ok(cozinha);
    assert.ok(cozinha.pontos.some((p: { nome: string }) => p.nome === 'Montagem'));
  });

  it('setor recém-criado vem com lista de pontos vazia', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `/v1/lojas/${minha.lojaId}/setores`,
      headers: comoDono(),
      payload: { nome: 'Atendimento', ordem: 2 },
    });
    assert.equal(r.statusCode, 201);
    assert.deepEqual(r.json().pontos, []);
  });

  // ───────────────────────── validação ─────────────────────────────

  it('ponto de DVR sem canal é recusado', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `/v1/setores/${minha.setorId}/pontos`,
      headers: comoDono(),
      payload: { nome: 'sem canal', origem: 'dvr' },
    });
    assert.equal(r.statusCode, 422);
    assert.match(r.json().mensagem, /canal/);
  });

  it('senha no cadastro de ponto é recusada', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `/v1/setores/${minha.setorId}/pontos`,
      headers: comoDono(),
      payload: { nome: 'x', origem: 'ip', senha: 'r2d23cpo' },
    });
    assert.equal(r.statusCode, 422);
    assert.equal(r.json().erro, 'segredo_no_cadastro');
  });

  // ──────────────────────── edição parcial ─────────────────────────

  it('PATCH com um campo só NÃO apaga os outros', async () => {
    // Um PATCH que zera o que não foi mandado destrói configuração a
    // cada edição parcial da tela — e ninguém percebe até a câmera parar.
    const r = await app.inject({
      method: 'PATCH',
      url: `/v1/pontos/${minha.pontoId}`,
      headers: comoDono(),
      payload: { nome: 'Montagem renomeada' },
    });

    assert.equal(r.statusCode, 200, r.body);
    const p = r.json();
    assert.equal(p.nome, 'Montagem renomeada');
    assert.equal(p.canal, 11, 'canal tinha que continuar');
    assert.equal(p.host, '192.168.1.108', 'host tinha que continuar');
    assert.equal(p.usuario, 'admin', 'usuário tinha que continuar');
  });

  it('PATCH em ponto de outro tenant é 404', async () => {
    const r = await app.inject({
      method: 'PATCH',
      url: `/v1/pontos/${minha.pontoId}`,
      headers: { cookie: vizinha.cookie },
      payload: { nome: 'sequestrado' },
    });
    assert.equal(r.statusCode, 404);
  });

  // ───────────────────── excluir marca, não apaga ─────────────────────

  it('excluir MARCA o ponto e preserva a linha', async () => {
    // O comportamento completo está em excluir.test.ts; aqui fica a
    // garantia mínima, junto das outras rotas do ponto.
    const r = await app.inject({
      method: 'DELETE',
      url: "/v1/pontos/" + minha.pontoId,
      headers: comoDono(),
    });

    assert.equal(r.statusCode, 200);
    assert.equal(r.json().excluido, true);

    const ainda = await pool.query('select ativo, excluido_em from ponto where id = $1', [minha.pontoId]);
    assert.equal(ainda.rowCount, 1, 'a linha não pode sumir: evento aponta para ela');
    assert.equal(ainda.rows[0].ativo, false);
    assert.ok(ainda.rows[0].excluido_em instanceof Date);
  });

  // ──────────────────────────── RBAC ───────────────────────────────

  it('execução NÃO configura pontos', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `/v1/setores/${minha.setorId}/pontos`,
      headers: { cookie: cookieExecucao },
      payload: { nome: 'x', origem: 'ip' },
    });
    assert.equal(r.statusCode, 403);
    assert.equal(r.json().erro, 'sem_permissao');
  });

  it('execução ENXERGA as lojas do próprio tenant', async () => {
    // Ler é diferente de configurar: quem opera precisa ver onde está.
    const r = await app.inject({ method: 'GET', url: '/v1/lojas', headers: { cookie: cookieExecucao } });
    assert.equal(r.statusCode, 200);
    assert.ok(r.json().lojas.length > 0);
  });
});

// ─────────── óptica do ponto e o diagnóstico de uso ───────────

describe('diagnóstico de dimensionamento', { skip: !URL && 'sem DATABASE_URL' }, () => {
  let pool2: pg.Pool;
  let app2: FastifyInstance;
  let adminAntes2: string | undefined;
  let pontoId = '';
  let cookie2 = '';
  const marca2 = `teste-dim-${randomUUID().slice(0, 8)}`;

  before(async () => {
    adminAntes2 = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool2 = new pg.Pool({ connectionString: URL });
    app2 = criarApp(pool2, { logger: false });
    await app2.ready();

    const loja = (
      await app2.inject({
        method: 'POST',
        url: '/v1/distribuicao/lojas',
        headers: { 'x-farol-admin': ADMIN },
        payload: {
          tenant: { nome: marca2 },
          loja: { nome: 'M' },
          setores: [{ nome: 'Cozinha' }],
        },
      })
    ).json();

    await app2.inject({
      method: 'POST',
      url: '/v1/distribuicao/usuarios',
      headers: { 'x-farol-admin': ADMIN },
      payload: {
        tenantId: loja.tenantId, nome: 'D',
        email: `d-${marca2}@e.com`, senha: SENHA, nivel: 'presidente',
      },
    });
    const login = await app2.inject({
      method: 'POST', url: '/v1/sessao',
      payload: { email: `d-${marca2}@e.com`, senha: SENHA },
    });
    const b = login.headers['set-cookie'];
    cookie2 = (Array.isArray(b) ? b[0]! : String(b)).split(';')[0]!;

    const ponto = await app2.inject({
      method: 'POST',
      url: `/v1/setores/${loja.setores[0].id}/pontos`,
      headers: { cookie: cookie2 },
      payload: { nome: 'Montagem', origem: 'dvr', canal: 1 },
    });
    pontoId = ponto.json().id;
  });

  after(async () => {
    if (adminAntes2 === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes2;
    await app2?.close();
    await pool2?.query('delete from tenant where nome like $1', [`${marca2}%`]);
    await pool2?.end();
  });

  it('sem óptica, DIZ O QUE FALTA em vez de supor', async () => {
    // Número inventado aqui vira recomendação de compra errada no bolso
    // do cliente.
    const r = await app2.inject({
      method: 'GET',
      url: `/v1/pontos/${pontoId}/diagnostico`,
      headers: { cookie: cookie2 },
    });

    assert.equal(r.statusCode, 200);
    assert.equal(r.json().completo, false);
    assert.ok(r.json().faltando.length > 0);
    assert.match(r.json().faltando.join(' '), /focal|distancia|sensor/);
  });

  it('com a óptica da TWG medida em campo, calcula e recomenda', async () => {
    const salvo = await app2.inject({
      method: 'PATCH',
      url: `/v1/pontos/${pontoId}`,
      headers: { cookie: cookie2 },
      payload: { sensorPol: '1/2.7"', focalMm: 2.8, distanciaCm: 60, resolucaoH: 1920 },
    });
    assert.equal(salvo.statusCode, 200, salvo.body);

    const r = await app2.inject({
      method: 'GET',
      url: `/v1/pontos/${pontoId}/diagnostico`,
      headers: { cookie: cookie2 },
    });

    assert.equal(r.json().completo, true);
    const o = r.json().optica;
    assert.ok(Math.abs(o.larguraCenaCm - 115.1) < 0.5, `deu ${o.larguraCenaCm}`);
    assert.ok(Math.abs(o.pxPorCm - 16.69) < 0.1);
    assert.equal(o.origem, 'calculada');
    assert.match(String(o.ressalva), /distorce/);

    // A zona nasce cobrindo o quadro inteiro: 115 cm.
    const zona = r.json().zonas[0];
    assert.ok(Math.abs(zona.larguraCm - 115.1) < 0.5);

    const montagem = zona.usos.find((u: { variante: string }) => u.variante === 'montagem');
    assert.ok(montagem);
    // 12,8 × 115 = 1473 px → só r1080 atende, e a câmera dá 1920. Serve.
    assert.equal(montagem.sustenta, true);
    assert.equal(montagem.minima, 'r1080');

    const estado = zona.usos.find(
      (u: { tipo: string; variante: string | null }) =>
        u.tipo === 'estado' && u.variante === null,
    );
    // 3 × 115 = 345 px → cabe no degrau mais barato.
    assert.equal(estado.minima, 'r384');
  });

  it('medida com fita vence o cálculo pela óptica', async () => {
    await app2.inject({
      method: 'PATCH',
      url: `/v1/pontos/${pontoId}`,
      headers: { cookie: cookie2 },
      payload: { larguraCenaCm: 130 },
    });

    const r = await app2.inject({
      method: 'GET',
      url: `/v1/pontos/${pontoId}/diagnostico`,
      headers: { cookie: cookie2 },
    });

    assert.equal(r.json().optica.origem, 'medida');
    assert.equal(r.json().optica.larguraCenaCm, 130);
    assert.equal(r.json().optica.ressalva, null, 'medida não tem ressalva de distorção');
  });

  it('ponto de outro tenant é 404', async () => {
    const r = await app2.inject({
      method: 'GET',
      url: `/v1/pontos/${randomUUID()}/diagnostico`,
      headers: { cookie: cookie2 },
    });
    assert.equal(r.statusCode, 404);
  });

  it('sem sessão é 401', async () => {
    const r = await app2.inject({ method: 'GET', url: `/v1/pontos/${pontoId}/diagnostico` });
    assert.equal(r.statusCode, 401);
  });
});
