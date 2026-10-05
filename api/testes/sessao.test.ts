// Sessão do console, pelo caminho HTTP inteiro, contra Postgres real.
//
// O que se protege aqui é a porta da frente do produto: quem entra, quem
// não entra, e o que acontece quando alguém troca a senha com uma sessão
// roubada aberta do outro lado.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';

const URL = process.env.DATABASE_URL;
const marca = `teste-ses-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-sessao';
const SENHA = 'uma senha longa o bastante';

describe('sessão do console (Postgres real)', { skip: !URL && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let tenantId: string;
  let email: string;
  let adminAntes: string | undefined;

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL });
    app = criarApp(pool, { logger: false });
    await app.ready();

    const t = await pool.query('insert into tenant (nome) values ($1) returning id', [marca]);
    tenantId = t.rows[0].id;

    email = `${marca}@exemplo.com`;
    const r = await app.inject({
      method: 'POST',
      url: '/v1/distribuicao/usuarios',
      headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId, nome: 'Dono', email, senha: SENHA, nivel: 'presidente' },
    });
    assert.equal(r.statusCode, 201, r.body);
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  function entrar(payload: Record<string, unknown>) {
    return app.inject({ method: 'POST', url: '/v1/sessao', payload });
  }

  function cookieDe(r: { headers: Record<string, unknown> }): string {
    const bruto = r.headers['set-cookie'];
    const linha = Array.isArray(bruto) ? bruto[0]! : String(bruto);
    return linha.split(';')[0]!;
  }

  // ─────────────────────────── entrar ───────────────────────────

  it('entra com a senha certa e recebe o cookie', async () => {
    const r = await entrar({ email, senha: SENHA });

    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().nivel, 'presidente');

    const cookie = String(r.headers['set-cookie']);
    assert.match(cookie, /HttpOnly/, 'sem HttpOnly um XSS leva a sessão');
    assert.match(cookie, /SameSite=Lax/, 'é o que impede CSRF nas escritas');
    assert.ok(!cookie.includes('Secure'), 'em teste não é produção');
  });

  it('o cookie não contém o token em claro no corpo da resposta', async () => {
    // O token vai pelo cookie; repeti-lo no corpo o entregaria ao
    // JavaScript da página, que é exatamente o que HttpOnly evita.
    const r = await entrar({ email, senha: SENHA });
    assert.ok(!JSON.stringify(r.json()).includes('token'));
  });

  it('e-mail não diferencia maiúsculas', async () => {
    const r = await entrar({ email: email.toUpperCase(), senha: SENHA });
    assert.equal(r.statusCode, 200);
  });

  // ─────────────────────── quem não entra ────────────────────────

  it('senha errada é 401', async () => {
    const r = await entrar({ email, senha: 'senha completamente errada' });
    assert.equal(r.statusCode, 401);
  });

  it('e-mail inexistente dá a MESMA resposta que senha errada', async () => {
    // Respostas diferentes entregam a quem tenta uma lista de e-mails
    // válidos — e aí o ataque vira só adivinhar a senha de alguém.
    const errada = await entrar({ email, senha: 'senha completamente errada' });
    const inexistente = await entrar({ email: 'ninguem@exemplo.com', senha: SENHA });

    assert.equal(inexistente.statusCode, errada.statusCode);
    assert.deepEqual(inexistente.json(), errada.json());
  });

  it('usuário desativado é 403, e a mensagem diz o motivo', async () => {
    const outro = `inativo-${marca}@exemplo.com`;
    await app.inject({
      method: 'POST',
      url: '/v1/distribuicao/usuarios',
      headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId, nome: 'Ex', email: outro, senha: SENHA },
    });
    await pool.query('update usuario set ativo = false where lower(email) = $1', [outro]);

    const r = await entrar({ email: outro, senha: SENHA });

    assert.equal(r.statusCode, 403);
    assert.equal(r.json().erro, 'usuario_inativo');
  });

  it('sem email ou senha é 422', async () => {
    assert.equal((await entrar({ email })).statusCode, 422);
    assert.equal((await entrar({ senha: SENHA })).statusCode, 422);
  });

  // ────────────────────────── quem sou ───────────────────────────

  it('com o cookie, /v1/eu diz quem é', async () => {
    const login = await entrar({ email, senha: SENHA });
    const r = await app.inject({
      method: 'GET',
      url: '/v1/eu',
      headers: { cookie: cookieDe(login) },
    });

    assert.equal(r.statusCode, 200);
    assert.equal(r.json().email, email);
    assert.equal(r.json().tenantId, tenantId);
  });

  it('sem cookie, /v1/eu é 401', async () => {
    assert.equal((await app.inject({ method: 'GET', url: '/v1/eu' })).statusCode, 401);
  });

  it('cookie inventado é 401', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/v1/eu',
      headers: { cookie: 'farol_sessao=inventado' },
    });
    assert.equal(r.statusCode, 401);
  });

  // ─────────────────────────── sair ─────────────────────────────

  it('sair revoga a sessão de verdade', async () => {
    const login = await entrar({ email, senha: SENHA });
    const cookie = cookieDe(login);

    await app.inject({ method: 'DELETE', url: '/v1/sessao', headers: { cookie } });

    const depois = await app.inject({ method: 'GET', url: '/v1/eu', headers: { cookie } });
    assert.equal(depois.statusCode, 401, 'o mesmo cookie não pode mais valer');
  });

  it('sair sem estar dentro não estoura', async () => {
    assert.equal((await app.inject({ method: 'DELETE', url: '/v1/sessao' })).statusCode, 200);
  });

  // ──────────────── o caso que motiva tudo isto ─────────────────

  it('trocar a senha derruba as sessões já abertas', async () => {
    // É exatamente no momento em que alguém troca a senha que se quer
    // expulsar quem a roubou. Com JWT isso não seria possível sem uma
    // lista de revogados — que é esta tabela.
    const login = await entrar({ email, senha: SENHA });
    const cookie = cookieDe(login);

    assert.equal(
      (await app.inject({ method: 'GET', url: '/v1/eu', headers: { cookie } })).statusCode,
      200,
    );

    await pool.query(
      'update usuario set senha_trocada_em = now() where lower(email) = $1',
      [email],
    );

    const depois = await app.inject({ method: 'GET', url: '/v1/eu', headers: { cookie } });
    assert.equal(depois.statusCode, 401);
  });

  it('desativar o usuário derruba a sessão aberta', async () => {
    const outro = `demitido-${marca}@exemplo.com`;
    await app.inject({
      method: 'POST',
      url: '/v1/distribuicao/usuarios',
      headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId, nome: 'Saiu', email: outro, senha: SENHA },
    });
    const cookie = cookieDe(await entrar({ email: outro, senha: SENHA }));

    await pool.query('update usuario set ativo = false where lower(email) = $1', [outro]);

    const r = await app.inject({ method: 'GET', url: '/v1/eu', headers: { cookie } });
    assert.equal(r.statusCode, 401, 'demitiu às 14h, o crachá para às 14h');
  });

  // ───────────────────── criação de usuário ──────────────────────

  it('e-mail repetido na mesma empresa é 409', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/v1/distribuicao/usuarios',
      headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId, nome: 'Outro', email, senha: SENHA },
    });
    assert.equal(r.statusCode, 409);
  });

  it('senha fraca é recusada no cadastro', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/v1/distribuicao/usuarios',
      headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId, nome: 'X', email: `fraca-${marca}@e.com`, senha: '1234' },
    });
    assert.equal(r.statusCode, 422);
    assert.equal(r.json().erro, 'senha_fraca');
  });

  it('nível fora do domínio é 422, não 500 do banco', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/v1/distribuicao/usuarios',
      headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId, nome: 'X', email: `nv-${marca}@e.com`, senha: SENHA, nivel: 'rei' },
    });
    assert.equal(r.statusCode, 422);
    assert.equal(r.json().erro, 'nivel_invalido');
  });

  it('sem credencial de distribuição não cria usuário', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/v1/distribuicao/usuarios',
      payload: { tenantId, nome: 'X', email: `x-${marca}@e.com`, senha: SENHA },
    });
    assert.equal(r.statusCode, 401);
  });

  it('a senha nunca volta numa resposta', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/v1/distribuicao/usuarios',
      headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId, nome: 'Y', email: `y-${marca}@e.com`, senha: SENHA },
    });
    const corpo = JSON.stringify(r.json());
    assert.ok(!corpo.includes(SENHA));
    assert.ok(!corpo.includes('senha_hash'));
    assert.ok(!corpo.includes('scrypt'));
  });
});
