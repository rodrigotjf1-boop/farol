// Quem entrega os alertas: a credencial PRÓPRIA do transporte (migration 046), contra Postgres real.
//
// Pedido da sessão do Hub DMS, aprovado pelo dono em 14/10/2026: as rotas de envio aceitavam a chave geral da
// distribuição — quem entregasse os alertas carregaria a chave que emite agente e cadastra loja. Aqui se prova a
// emissão, a lista, a revogação e as recusas. A reivindicação que DÁ certo mora em `rotas-alertas.test.ts`: ela pega
// envios de todas as lojas, e os arquivos de teste rodam ao mesmo tempo — um transporte válido aqui levaria os envios
// do outro arquivo (V93).

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { autenticarTransporte, ErroDeAuth, PREFIXO_TRANSPORTE } from '../src/auth.js';

// ───────── sem banco: o que não tem a cara do token do transporte nem chega a ser procurado ─────────

describe('autenticação do transporte, sem banco', () => {
  it('token sem o prefixo, ou cabeçalho torto, é recusado sem consulta', async () => {
    let consultas = 0;
    const pool = { query: async () => ((consultas += 1), { rows: [] }) } as unknown as pg.Pool;
    for (const cabecalho of [undefined, '', 'Bearer', 'Basic fart_x', 'Bearer token-do-agente', `Bearer ${'a'.repeat(43)}`]) {
      await assert.rejects(autenticarTransporte(pool, cabecalho), (e: unknown) => e instanceof ErroDeAuth && e.status === 401);
    }
    assert.equal(consultas, 0, 'o token do agente (ou qualquer outro) não vai à tabela dos transportes');
  });
});

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-transporte-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-transportes';
const PROVISIONAR = fileURLToPath(new URL('../scripts/provisionar.mjs', import.meta.url));

describe('transportes dos alertas (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    app = criarApp(pool, { logger: false });
    await app.ready();
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    // Os envios do outro arquivo não apontam para estes (nenhum aqui reivindicou nada).
    await pool?.query('delete from transporte where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  const emitir = (payload: unknown, headers: Record<string, string> = { 'x-farol-admin': ADMIN }) =>
    app.inject({ method: 'POST', url: '/v1/distribuicao/transportes', headers, payload: payload as object });

  it('emite um token com o prefixo do transporte, e o banco guarda só o resumo', async () => {
    const r = await emitir({ nome: `${marca}-n8n`, tipos: ['whatsapp', 'email', 'whatsapp'] });
    assert.equal(r.statusCode, 201, r.body);
    const t = r.json();
    assert.ok(t.token.startsWith(PREFIXO_TRANSPORTE) && t.token.length > 40);
    assert.deepEqual(t.tipos, ['whatsapp', 'email'], 'o tipo repetido entra uma vez');

    const { rows } = await pool.query('select * from transporte where id = $1', [t.id]);
    assert.equal(rows[0].token_hash, createHash('sha256').update(t.token, 'utf8').digest('hex'));
    assert.ok(!Object.values(rows[0]).some((v) => String(v).includes(t.token)), 'o token não fica no banco');
    assert.equal(rows[0].revogado_em, null);
  });

  it('recusa nome, tipos e segredo tortos, com o motivo', async () => {
    for (const nome of ['', '   ', 'x'.repeat(61), 7]) {
      assert.equal((await emitir({ nome, tipos: ['kds'] })).statusCode, 422, `nome ${String(nome)}`);
    }
    for (const tipos of [[], ['sms'], ['kds', 'telegrama'], 'kds', undefined]) {
      const r = await emitir({ nome: `${marca}-x`, tipos });
      assert.equal(r.statusCode, 422, `tipos ${JSON.stringify(tipos)}`);
      assert.match(r.json().mensagem, /whatsapp, email, kds, webhook/);
    }
    const comToken = await emitir({ nome: `${marca}-x`, tipos: ['kds'], token: 'eu-escolho' });
    assert.equal(comToken.statusCode, 400);
    assert.equal(comToken.json().erro, 'segredo_no_corpo');
  });

  it('o nome não repete entre os que valem; revogado, fica livre', async () => {
    const nome = `${marca}-regem`;
    const primeiro = await emitir({ nome, tipos: ['kds'] });
    assert.equal(primeiro.statusCode, 201);
    const repetido = await emitir({ nome: ` ${nome.toUpperCase()} `, tipos: ['webhook'] });
    assert.equal(repetido.statusCode, 409);
    assert.match(repetido.json().mensagem, /revogue o antigo/);

    const rev = await app.inject({
      method: 'POST', url: `/v1/distribuicao/transportes/${primeiro.json().id}/revogar`, headers: { 'x-farol-admin': ADMIN },
    });
    assert.equal(rev.statusCode, 200, rev.body);
    assert.ok(rev.json().transporte.revogado_em);
    assert.equal((await emitir({ nome, tipos: ['kds'] })).statusCode, 201, 'o nome do revogado fica livre');
  });

  it('revogar de novo não muda a hora, e o que não existe dá 404', async () => {
    const t = (await emitir({ nome: `${marca}-duas-vezes`, tipos: ['email'] })).json();
    const revogar = (id: string) =>
      app.inject({ method: 'POST', url: `/v1/distribuicao/transportes/${id}/revogar`, headers: { 'x-farol-admin': ADMIN } });
    const a = (await revogar(t.id)).json().transporte.revogado_em;
    const b = (await revogar(t.id)).json().transporte.revogado_em;
    assert.equal(a, b);
    assert.equal((await revogar(randomUUID())).statusCode, 404);
    assert.equal((await revogar('nao-e-uuid')).statusCode, 404);
  });

  it('a lista mostra os transportes sem o token nem o resumo', async () => {
    const t = (await emitir({ nome: `${marca}-lista`, tipos: ['webhook'] })).json();
    const r = await app.inject({ method: 'GET', url: '/v1/distribuicao/transportes', headers: { 'x-farol-admin': ADMIN } });
    assert.equal(r.statusCode, 200);
    const achado = r.json().transportes.find((x: { id: string }) => x.id === t.id);
    assert.deepEqual(Object.keys(achado).sort(), ['criado_em', 'id', 'nome', 'revogado_em', 'tipos', 'usado_em']);
    assert.ok(!r.body.includes(t.token) && !r.body.includes('token_hash'));
  });

  it('só a chave geral emite, lista e revoga — o token do transporte não abre nada da distribuição', async () => {
    const t = (await emitir({ nome: `${marca}-tenta`, tipos: ['kds'] })).json();
    const comTransporte = [{ authorization: `Bearer ${t.token}` }, { 'x-farol-admin': t.token }, {}];
    const rotas: { method: 'GET' | 'POST' | 'PATCH'; url: string; payload?: object }[] = [
      { method: 'POST', url: '/v1/distribuicao/transportes', payload: { nome: `${marca}-outro`, tipos: ['kds'] } },
      { method: 'GET', url: '/v1/distribuicao/transportes' },
      { method: 'POST', url: `/v1/distribuicao/transportes/${t.id}/revogar` },
      { method: 'POST', url: '/v1/distribuicao/agentes', payload: { lojaId: randomUUID(), nome: 'x' } },
      { method: 'POST', url: '/v1/distribuicao/lojas', payload: { tenant: { nome: `${marca}-t` }, loja: { nome: 'L' } } },
      { method: 'PATCH', url: `/v1/distribuicao/lojas/${randomUUID()}`, payload: {} },
      { method: 'GET', url: `/v1/distribuicao/lojas/${randomUUID()}/balcao` },
      { method: 'PATCH', url: `/v1/distribuicao/lojas/${randomUUID()}/balcao`, payload: {} },
      { method: 'POST', url: '/v1/distribuicao/usuarios', payload: {} },
    ];
    for (const rota of rotas) {
      for (const headers of comTransporte) {
        const r = await app.inject({ ...rota, headers });
        assert.equal(r.statusCode, 401, `${rota.method} ${rota.url} com ${JSON.stringify(Object.keys(headers))}: ${r.body}`);
      }
    }
    const { rows } = await pool.query('select revogado_em from transporte where id = $1', [t.id]);
    assert.equal(rows[0].revogado_em, null, 'o transporte não se revogou a si mesmo');
  });

  it('token revogado, sem o prefixo ou de outro tipo não puxa nada', async () => {
    const t = (await emitir({ nome: `${marca}-revogado`, tipos: ['kds'] })).json();
    await app.inject({ method: 'POST', url: `/v1/distribuicao/transportes/${t.id}/revogar`, headers: { 'x-farol-admin': ADMIN } });
    const tentativas = [
      { authorization: `Bearer ${t.token}` },
      { authorization: `Bearer ${t.token.slice(PREFIXO_TRANSPORTE.length)}` },
      { authorization: `Bearer ${PREFIXO_TRANSPORTE}${'a'.repeat(43)}` },
      { authorization: t.token },
      { 'x-farol-admin': ADMIN },
      {},
    ];
    for (const headers of tentativas) {
      for (const url of ['/v1/envios/reivindicar', `/v1/envios/${randomUUID()}/resultado`]) {
        const r = await app.inject({ method: 'POST', url, headers, payload: { limite: 5, entregue: true } });
        assert.equal(r.statusCode, 401, `${url} com ${JSON.stringify(headers).slice(0, 40)}: ${r.body}`);
      }
    }
  });

  it('os comandos da distribuição emitem, listam e revogam pela API de verdade', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const porta = String((app.server.address() as AddressInfo).port);
    const rodar = (args: string[]) =>
      new Promise<{ codigo: number | null; saida: string; erro: string }>((resolver, rejeitar) => {
        const filho = spawn(process.execPath, [PROVISIONAR, ...args], { env: { ...process.env, PORT: porta, FAROL_ADMIN_TOKEN: ADMIN } });
        let saida = '';
        let erro = '';
        filho.stdout.on('data', (p) => (saida += String(p)));
        filho.stderr.on('data', (p) => (erro += String(p)));
        filho.on('error', rejeitar);
        filho.on('close', (codigo) => resolver({ codigo, saida, erro }));
      });

    const nome = `${marca}-cli`;
    const criado = await rodar(['transporte', nome, 'whatsapp, email']);
    assert.equal(criado.codigo, 0, criado.erro);
    assert.match(criado.saida, /transporte criado: .*-cli {2}\(entrega: whatsapp, email\)/);
    const token = /(fart_[A-Za-z0-9_-]+)/.exec(criado.saida)?.[1];
    assert.ok(token, 'o token aparece uma vez');
    const id = /transporteId: ([0-9a-f-]{36})/.exec(criado.saida)?.[1];

    const lista = await rodar(['transportes']);
    assert.equal(lista.codigo, 0, lista.erro);
    assert.match(lista.saida, new RegExp(`${id}  ${nome}  \\(whatsapp, email\\)  · nunca usado`));
    assert.ok(!lista.saida.includes(token!), 'a lista não mostra o token');

    const revogado = await rodar(['transporte-revogar', id!]);
    assert.equal(revogado.codigo, 0, revogado.erro);
    assert.match(revogado.saida, /revogado: .*-cli/);
    assert.match((await rodar(['transportes'])).saida, new RegExp(`${id}  ${nome}  \\(whatsapp, email\\)  · revogado em`));

    // Argumento torto para no próprio comando, com o uso — nem chega à API.
    for (const torto of [['transporte'], ['transporte', 'so-nome'], ['transporte', 'a', 'kds', 'sobra'], ['transporte-revogar'], ['transporte-revogar', 'a', 'b']]) {
      const r = await rodar(torto);
      assert.notEqual(r.codigo, 0, torto.join(' '));
      assert.match(r.erro, /uso: npm run provisionar -- transporte/, torto.join(' '));
    }
    const tipoTorto = await rodar(['transporte', `${marca}-t2`, 'sms']);
    assert.notEqual(tipoTorto.codigo, 0);
    assert.match(tipoTorto.erro, /HTTP 422/, 'o tipo que não existe é a API quem recusa');
  });
});
