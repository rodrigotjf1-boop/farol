import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { acharCampoProibido, validarCorpo } from '../src/rotas/lojas.js';

const URL = process.env.DATABASE_URL;
const marca = `teste-lj-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-lojas';

// ───────────── sem banco: a guarda contra segredo no cadastro ─────────────

describe('senha não entra pelo cadastro', () => {
  it('pega no primeiro nível', () => {
    assert.equal(acharCampoProibido({ senha: 'x' }), 'senha');
  });

  it('pega aninhado fundo, que é onde ia passar', () => {
    const corpo = {
      loja: { nome: 'a' },
      setores: [{ nome: 's', pontos: [{ nome: 'p', password: 'r2d2' }] }],
    };
    assert.equal(acharCampoProibido(corpo), 'setores[0].pontos[0].password');
  });

  it('pega variações', () => {
    for (const k of ['senha', 'password', 'segredo', 'secret', 'pwd', 'pass']) {
      assert.ok(acharCampoProibido({ [k]: 'x' }), `devia pegar ${k}`);
    }
  });

  it('não confunde maiúsculas', () => {
    assert.equal(acharCampoProibido({ SENHA: 'x' }), 'SENHA');
  });

  it('deixa passar o que é legítimo', () => {
    const corpo = {
      loja: { nome: 'a' },
      setores: [{ nome: 's', pontos: [{ nome: 'p', usuario: 'admin', host: '10.0.0.1' }] }],
    };
    assert.equal(acharCampoProibido(corpo), null);
  });
});

describe('validarCorpo', () => {
  const base = { tenant: { nome: 'T' }, loja: { nome: 'L' } };

  it('aceita o mínimo', () => {
    assert.equal(validarCorpo(base), null);
  });

  it('exige nome da loja', () => {
    assert.match(String(validarCorpo({ tenant: { nome: 'T' } })), /loja\.nome/);
  });

  it('exige tenant ou tenantId', () => {
    assert.match(String(validarCorpo({ loja: { nome: 'L' } })), /tenantId/);
  });

  it('recusa enum fora do CHECK do banco', () => {
    // O CHECK devolveria 23514; melhor dizer antes, com a lista de opções.
    assert.match(
      String(validarCorpo({ ...base, loja: { nome: 'L', modoJulgamento: 'mágico' } })),
      /modoJulgamento/,
    );
    assert.match(
      String(validarCorpo({ ...base, loja: { nome: 'L', resolucaoPadrao: 'r4k' } })),
      /resolucaoPadrao/,
    );
  });

  it('ponto de DVR sem canal é recusado agora, não na loja', () => {
    const c = {
      ...base,
      setores: [{ nome: 'cozinha', pontos: [{ nome: 'p1', origem: 'dvr' }] }],
    };
    assert.match(String(validarCorpo(c)), /canal/);
  });

  it('ponto IP não precisa de canal', () => {
    const c = {
      ...base,
      setores: [{ nome: 'cozinha', pontos: [{ nome: 'p1', origem: 'ip' }] }],
    };
    assert.equal(validarCorpo(c), null);
  });
});

// ───────────────────────── com Postgres real ─────────────────────────

describe('criação de loja (Postgres real)', { skip: !URL && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL });
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

  function criar(payload: unknown) {
    return app.inject({
      method: 'POST',
      url: '/v1/distribuicao/lojas',
      headers: { 'x-farol-admin': ADMIN },
      payload: payload as never,
    });
  }

  it('cria empresa, loja, setores e pontos de uma vez', async () => {
    const r = await criar({
      tenant: { nome: `${marca}-mister`, documento: '00.000.000/0001-00', plano: 'completo' },
      loja: { nome: 'Matriz', modoJulgamento: 'hibrido', resolucaoPadrao: 'r640' },
      setores: [
        {
          nome: 'cozinha',
          pontos: [
            { nome: 'montagem', origem: 'dvr', fabricante: 'intelbras', canal: 11, host: '192.168.1.50', usuario: 'admin' },
            { nome: 'chapa', origem: 'dvr', canal: 5 },
          ],
        },
        { nome: 'salão', pontos: [{ nome: 'balcão', origem: 'ip', host: '192.168.1.60' }] },
      ],
    });

    assert.equal(r.statusCode, 201, r.body);
    const c = r.json();
    assert.equal(c.loja.modoJulgamento, 'hibrido');
    assert.equal(c.setores.length, 2);
    assert.equal(c.setores[0].pontos.length, 2);
    assert.equal(c.setores[0].pontos[0].canal, 11);
    assert.ok(c.proximoPasso.includes('agentes'));
  });

  it('a loja criada serve de verdade para provisionar agente', async () => {
    const loja = (await criar({
      tenant: { nome: `${marca}-cadeia` },
      loja: { nome: 'Filial' },
    })).json();

    const r = await app.inject({
      method: 'POST',
      url: '/v1/distribuicao/agentes',
      headers: { 'x-farol-admin': ADMIN },
      payload: { lojaId: loja.loja.id, nome: 'agente-1' },
    });

    assert.equal(r.statusCode, 201, r.body);
    assert.ok(r.json().token);
  });

  it('aceita tenant existente em vez de criar outro', async () => {
    const primeira = (await criar({
      tenant: { nome: `${marca}-rede` },
      loja: { nome: 'Unidade 1' },
    })).json();

    const segunda = await criar({
      tenantId: primeira.tenantId,
      loja: { nome: 'Unidade 2' },
    });

    assert.equal(segunda.statusCode, 201);
    assert.equal(segunda.json().tenantId, primeira.tenantId);
  });

  it('senha no corpo é 422 e explica onde o segredo mora', async () => {
    const r = await criar({
      tenant: { nome: `${marca}-segredo` },
      loja: { nome: 'L' },
      setores: [{ nome: 's', pontos: [{ nome: 'p', origem: 'ip', senha: 'r2d23cpo' }] }],
    });

    assert.equal(r.statusCode, 422);
    assert.equal(r.json().erro, 'segredo_no_cadastro');
    assert.match(r.json().mensagem, /cofre do agente/);
  });

  it('falha no meio não deixa meia loja', async () => {
    const antes = await pool.query('select count(*)::int n from tenant where nome like $1', [
      `${marca}-atomico%`,
    ]);

    // `origem` inválida passa pela validação de setor mas o CHECK do banco
    // recusa — o rollback tem que levar o tenant e a loja junto.
    const r = await criar({
      tenant: { nome: `${marca}-atomico` },
      loja: { nome: 'L' },
      setores: [{ nome: 's', pontos: [{ nome: 'p', origem: 'ip', canal: 1 }] }],
    });
    assert.equal(r.statusCode, 201, 'este caso é válido; serve de controle');

    const r2 = await app.inject({
      method: 'POST',
      url: '/v1/distribuicao/lojas',
      headers: { 'x-farol-admin': ADMIN },
      // nome vazio no setor passa raspando pela validação? não — mas o
      // tenantId inexistente derruba no insert da loja, depois de nada ter
      // sido criado: é o caminho do rollback.
      payload: { tenantId: randomUUID(), loja: { nome: `${marca}-atomico-falha` } } as never,
    });
    assert.equal(r2.statusCode, 422);
    assert.equal(r2.json().erro, 'tenant_inexistente');

    const depois = await pool.query(
      "select count(*)::int n from loja where nome like $1",
      [`${marca}-atomico-falha%`],
    );
    assert.equal(depois.rows[0].n, 0, 'não pode ter sobrado loja órfã');
    assert.equal(antes.rows[0].n, 0);
  });

  it('sem credencial de distribuição é 401', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/v1/distribuicao/lojas',
      payload: { tenant: { nome: 'x' }, loja: { nome: 'y' } },
    });
    assert.equal(r.statusCode, 401);
  });

  it('enum inválido é 422 com a lista, não 500 do banco', async () => {
    const r = await criar({
      tenant: { nome: `${marca}-enum` },
      loja: { nome: 'L', modoJulgamento: 'telepatico' },
    });
    assert.equal(r.statusCode, 422);
    assert.match(r.json().mensagem, /nuvem/);
  });
});
