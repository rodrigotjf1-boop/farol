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

  // ───────────────────── desativar, não apagar ─────────────────────

  it('excluir DESATIVA e preserva o histórico', async () => {
    const r = await app.inject({
      method: 'DELETE',
      url: `/v1/pontos/${minha.pontoId}`,
      headers: comoDono(),
    });

    assert.equal(r.statusCode, 200);
    assert.equal(r.json().ativo, false);

    const ainda = await pool.query('select ativo from ponto where id = $1', [minha.pontoId]);
    assert.equal(ainda.rowCount, 1, 'a linha não pode sumir: evento aponta para ela');
    assert.equal(ainda.rows[0].ativo, false);
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
