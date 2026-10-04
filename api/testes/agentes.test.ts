// =====================================================================
// Provisionamento e ativação do agente, pelo caminho HTTP inteiro
// =====================================================================
// Usa `app.inject()`, então exercita validação, autenticação e código de
// status de verdade — não só a função por dentro. Já aconteceu de o teste
// de unidade passar com a borda HTTP quebrada.
// =====================================================================

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';

const URL = process.env.DATABASE_URL;
const marca = `teste-ag-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-xyz';

describe('agentes (Postgres real)', { skip: !URL && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let lojaId: string;
  let adminAntes: string | undefined;

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;

    pool = new pg.Pool({ connectionString: URL });
    const t = await pool.query('insert into tenant (nome) values ($1) returning id', [marca]);
    const l = await pool.query(
      'insert into loja (tenant_id, nome) values ($1,$2) returning id',
      [t.rows[0].id, 'loja de teste'],
    );
    lojaId = l.rows[0].id;

    app = criarApp(pool, { logger: false });
    await app.ready();
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  async function provisionar(nome = 'agente-x') {
    const r = await app.inject({
      method: 'POST',
      url: '/v1/distribuicao/agentes',
      headers: { 'x-farol-admin': ADMIN },
      payload: { lojaId, nome },
    });
    assert.equal(r.statusCode, 201, r.body);
    return r.json() as { id: string; token: string };
  }

  // ───────────────────────── provisionamento ─────────────────────────

  it('cria o agente e mostra o token uma vez', async () => {
    const criado = await provisionar();

    assert.ok(criado.token.length >= 40, 'token precisa ter entropia de sobra');
    assert.equal(criado.id.length, 36);

    const { rows } = await pool.query('select estado, token_hash from agente where id = $1', [
      criado.id,
    ]);
    assert.equal(rows[0].estado, 'novo', 'nasce desligado, esperando ativação');
    assert.ok(
      !String(rows[0].token_hash).includes(criado.token),
      'o banco não pode guardar o token em claro',
    );
  });

  it('cada agente recebe um token diferente', async () => {
    const a = await provisionar('a');
    const b = await provisionar('b');
    assert.notEqual(a.token, b.token);
  });

  it('sem credencial de distribuição é 401', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/v1/distribuicao/agentes',
      payload: { lojaId, nome: 'x' },
    });
    assert.equal(r.statusCode, 401);
  });

  it('credencial de distribuição errada é 401', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/v1/distribuicao/agentes',
      headers: { 'x-farol-admin': 'chute' },
      payload: { lojaId, nome: 'x' },
    });
    assert.equal(r.statusCode, 401);
  });

  it('loja inexistente é 422, não 500', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/v1/distribuicao/agentes',
      headers: { 'x-farol-admin': ADMIN },
      payload: { lojaId: randomUUID(), nome: 'x' },
    });
    assert.equal(r.statusCode, 422);
    assert.equal(r.json().erro, 'loja_inexistente');
  });

  // ─────────────────────────── ativação ───────────────────────────

  it('ativa e amarra a máquina', async () => {
    const { id, token } = await provisionar();
    const fp = `fp-${randomUUID()}`;

    const r = await app.inject({
      method: 'POST',
      url: '/v1/agentes/ativar',
      headers: { authorization: `Bearer ${token}` },
      payload: { fingerprint: fp, versao: '0.1.0' },
    });

    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().jaEstavaAtivo, false);

    const { rows } = await pool.query(
      'select estado, fingerprint, versao, ultimo_heartbeat from agente where id = $1',
      [id],
    );
    assert.equal(rows[0].estado, 'ativo');
    assert.equal(rows[0].fingerprint, fp);
    assert.equal(rows[0].versao, '0.1.0');
    assert.ok(rows[0].ultimo_heartbeat);
  });

  it('reativar na MESMA máquina é aceito — reinício não é ataque', async () => {
    const { token } = await provisionar();
    const fp = `fp-${randomUUID()}`;
    await app.inject({
      method: 'POST',
      url: '/v1/agentes/ativar',
      headers: { authorization: `Bearer ${token}` },
      payload: { fingerprint: fp },
    });

    const r = await app.inject({
      method: 'POST',
      url: '/v1/agentes/ativar',
      headers: { authorization: `Bearer ${token}` },
      payload: { fingerprint: fp, versao: '0.2.0' },
    });

    assert.equal(r.statusCode, 200);
    assert.equal(r.json().jaEstavaAtivo, true);
  });

  it('o mesmo token em OUTRA máquina é 409 — é a trava anti-clone', async () => {
    const { token } = await provisionar();
    await app.inject({
      method: 'POST',
      url: '/v1/agentes/ativar',
      headers: { authorization: `Bearer ${token}` },
      payload: { fingerprint: `fp-${randomUUID()}` },
    });

    const r = await app.inject({
      method: 'POST',
      url: '/v1/agentes/ativar',
      headers: { authorization: `Bearer ${token}` },
      payload: { fingerprint: `fp-OUTRA-${randomUUID()}` },
    });

    assert.equal(r.statusCode, 409);
    assert.equal(r.json().erro, 'token_vinculado');
  });

  it('máquina já registrada por outro agente é 409, não 500', async () => {
    const fp = `fp-compartilhado-${randomUUID()}`;
    const primeiro = await provisionar('primeiro');
    await app.inject({
      method: 'POST',
      url: '/v1/agentes/ativar',
      headers: { authorization: `Bearer ${primeiro.token}` },
      payload: { fingerprint: fp },
    });

    const segundo = await provisionar('segundo');
    const r = await app.inject({
      method: 'POST',
      url: '/v1/agentes/ativar',
      headers: { authorization: `Bearer ${segundo.token}` },
      payload: { fingerprint: fp },
    });

    assert.equal(r.statusCode, 409);
    assert.equal(r.json().erro, 'maquina_ja_registrada');
  });

  it('ativar sem fingerprint é 422', async () => {
    const { token } = await provisionar();
    const r = await app.inject({
      method: 'POST',
      url: '/v1/agentes/ativar',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    assert.equal(r.statusCode, 422);
  });

  // ────────────────── o portão: só ativo manda evento ──────────────────

  it('agente NÃO ativado não consegue mandar evento', async () => {
    const { token } = await provisionar();

    const r = await app.inject({
      method: 'POST',
      url: '/v1/eventos',
      headers: { authorization: `Bearer ${token}` },
      payload: { eventos: [] },
    });

    assert.equal(r.statusCode, 403);
    assert.equal(r.json().erro, 'agente_novo');
  });

  it('depois de ativar, o mesmo token manda evento', async () => {
    const { token } = await provisionar();
    await app.inject({
      method: 'POST',
      url: '/v1/agentes/ativar',
      headers: { authorization: `Bearer ${token}` },
      payload: { fingerprint: `fp-${randomUUID()}` },
    });

    const r = await app.inject({
      method: 'POST',
      url: '/v1/eventos',
      headers: { authorization: `Bearer ${token}` },
      payload: { eventos: [] },
    });

    assert.equal(r.statusCode, 200, r.body);
  });

  // ───────────────────────── sinal de vida ─────────────────────────

  it('heartbeat marca a hora e devolve o relógio do servidor', async () => {
    const { id, token } = await provisionar();
    await app.inject({
      method: 'POST',
      url: '/v1/agentes/ativar',
      headers: { authorization: `Bearer ${token}` },
      payload: { fingerprint: `fp-${randomUUID()}` },
    });

    const r = await app.inject({
      method: 'POST',
      url: '/v1/agentes/heartbeat',
      headers: { authorization: `Bearer ${token}` },
      payload: { versao: '0.3.0' },
    });

    assert.equal(r.statusCode, 200);
    // O relógio do servidor é como o agente descobre que o PC da loja está
    // com a hora errada — causa silenciosa de evento com horário impossível.
    assert.ok(!Number.isNaN(Date.parse(r.json().agora)));

    const { rows } = await pool.query('select versao from agente where id = $1', [id]);
    assert.equal(rows[0].versao, '0.3.0');
  });

  it('lote grande demais é 413', async () => {
    const { token } = await provisionar();
    await app.inject({
      method: 'POST',
      url: '/v1/agentes/ativar',
      headers: { authorization: `Bearer ${token}` },
      payload: { fingerprint: `fp-${randomUUID()}` },
    });

    const r = await app.inject({
      method: 'POST',
      url: '/v1/eventos',
      headers: { authorization: `Bearer ${token}` },
      payload: { eventos: Array(501).fill({}) },
    });

    assert.equal(r.statusCode, 413);
  });

  it('corpo sem a lista de eventos é 400', async () => {
    const { token } = await provisionar();
    await app.inject({
      method: 'POST',
      url: '/v1/agentes/ativar',
      headers: { authorization: `Bearer ${token}` },
      payload: { fingerprint: `fp-${randomUUID()}` },
    });

    const r = await app.inject({
      method: 'POST',
      url: '/v1/eventos',
      headers: { authorization: `Bearer ${token}` },
      payload: { nada: true },
    });

    assert.equal(r.statusCode, 400);
  });
});
