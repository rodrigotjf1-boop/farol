// A base de conhecimento descendo para a loja (A21, fatia T5 — a parte da nuvem):
//
//   - a lista (`contratos/base-de-conhecimento.json`): os ingredientes com o que ensinar — as fotos, os exemplos da
//     bancada e o "não se vê de cima" —, cada quadro com o id, a origem, o resumo e o tamanho; o ingrediente sem nada a
//     ensinar não desce; a loja sai do token;
//   - a impressão muda quando a base muda, e só então (a ordem não conta);
//   - o quadro desce com os mesmos bytes; o de outra loja, não.

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { contarBase, impressaoDaBase, type Base } from '../src/fichas.js';
import { impressaoDaBaseDaLoja, type ItemDaBase } from '../src/rotas/base-na-loja.js';

const CONTRATO = JSON.parse(readFileSync(new URL('../../contratos/base-de-conhecimento.json', import.meta.url), 'utf8')) as {
  lista: { chavesDoItem: string[]; chavesDoQuadro: string[]; origens: string[] };
  recusas: Array<{ status: number; erro?: string }>;
};
const BASE = (JSON.parse(readFileSync(new URL('../../contratos/fichas-da-loja.json', import.meta.url), 'utf8')) as { resposta: { base: Base } }).resposta.base;
const JPEG = (JSON.parse(readFileSync(new URL('../../contratos/lanche-de-treino.json', import.meta.url), 'utf8')) as { corpo: { quadros: { imagemBase64: string }[] } }).corpo.quadros[0]!.imagemBase64;

describe('a marca da base (sem banco)', () => {
  const q = (id: string, sha: string | null = id.repeat(4)) => ({ id, origem: 'foto' as const, sha256: sha, largura: 10, altura: 10 });
  const itens: ItemDaBase[] = [
    { nome: 'Queijo prato', visivel: true, quadros: [q('a'), q('b')] },
    { nome: 'Sal', visivel: false, quadros: [] },
  ];
  it('a ordem não muda a marca; o nome conta sem maiúscula nem espaço nas pontas', () => {
    const m = impressaoDaBaseDaLoja(itens);
    assert.match(m, /^[0-9a-f]{64}$/);
    assert.equal(impressaoDaBaseDaLoja([itens[1]!, { ...itens[0]!, quadros: [q('b'), q('a')] }]), m);
    assert.equal(impressaoDaBaseDaLoja([{ ...itens[0]!, nome: ' queijo PRATO ' }, itens[1]!]), m);
  });
  it('muda quando entra ou sai um quadro, quando o quadro muda de imagem e quando o "não se vê" muda', () => {
    const m = impressaoDaBaseDaLoja(itens);
    assert.notEqual(impressaoDaBaseDaLoja([{ ...itens[0]!, quadros: [q('a')] }, itens[1]!]), m, 'saiu um quadro');
    assert.notEqual(impressaoDaBaseDaLoja([{ ...itens[0]!, quadros: [q('a'), q('b'), q('c')] }, itens[1]!]), m, 'entrou um quadro');
    assert.notEqual(impressaoDaBaseDaLoja([{ ...itens[0]!, quadros: [q('a'), q('b', 'outra')] }, itens[1]!]), m, 'outra imagem');
    assert.notEqual(impressaoDaBaseDaLoja([itens[0]!, { ...itens[1]!, visivel: true }]), m, 'o sal passou a se ver');
  });
});

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-base-loja-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-base-loja';
const SENHA = 'uma senha longa o bastante';

describe('a base desce para a loja (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  let lojaId = '';
  let token = '';
  let tokenVizinho = '';
  let cookie = '';
  let fotoId = '';

  async function entrar(tenant: string, email: string, nivel: string) {
    await app.inject({ method: 'POST', url: '/v1/distribuicao/usuarios', headers: { 'x-farol-admin': ADMIN }, payload: { tenantId: tenant, nome: `Pessoa ${nivel}`, email, senha: SENHA, nivel } });
    const r = await app.inject({ method: 'POST', url: '/v1/sessao', payload: { email, senha: SENHA } });
    const b = r.headers['set-cookie'];
    return (Array.isArray(b) ? b[0]! : String(b)).split(';')[0]!;
  }
  async function novoAgente(loja: string, quem: string) {
    const a = (await app.inject({ method: 'POST', url: '/v1/distribuicao/agentes', headers: { 'x-farol-admin': ADMIN }, payload: { lojaId: loja, nome: `PC ${quem}` } })).json();
    await app.inject({ method: 'POST', url: '/v1/agentes/ativar', headers: { authorization: `Bearer ${a.token}` }, payload: { fingerprint: `fp-${quem}-${randomUUID().slice(0, 6)}` } });
    return a.token as string;
  }
  const base = (comToken: string | null = token) => app.inject({ method: 'GET', url: '/v1/agentes/base', headers: comToken ? { authorization: `Bearer ${comToken}` } : {} });
  const quadro = (id: string, comToken: string | null = token) =>
    app.inject({ method: 'GET', url: `/v1/agentes/base/quadros/${id}`, headers: comToken ? { authorization: `Bearer ${comToken}` } : {} });
  const foto = async (nome: string) => {
    const r = await app.inject({ method: 'POST', url: `/v1/lojas/${lojaId}/ingredientes/fotos`, headers: { cookie }, payload: { nome, imagemBase64: JPEG } });
    assert.equal(r.statusCode, 201, r.body);
    return r.json().fotoId as string;
  };
  const visivel = async (nome: string, v: boolean) => {
    const r = await app.inject({ method: 'PUT', url: `/v1/lojas/${lojaId}/ingredientes/visivel`, headers: { cookie }, payload: { nome, visivel: v } });
    assert.equal(r.statusCode < 300, true, r.body);
  };

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    app = criarApp(pool, { logger: false });
    await app.ready();
    const conta = (await app.inject({ method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN }, payload: { tenant: { nome: marca }, loja: { nome: 'Matriz' }, setores: [{ nome: 'Cozinha' }] } })).json();
    lojaId = conta.loja.id;
    cookie = await entrar(conta.tenantId, `ger-${marca}@e.com`, 'gerente');
    token = await novoAgente(lojaId, marca);
    const { produtos, comFicha } = contarBase(BASE);
    await pool.query(
      `insert into fichas_da_loja (loja_id, tenant_id, fonte, conteudo, impressao, produtos, com_ficha) values ($1, $2, 'planilha', $3, $4, $5, $6)`,
      [lojaId, conta.tenantId, JSON.stringify(BASE), impressaoDaBase(BASE), produtos, comFicha],
    );
    const vizinha = (await app.inject({ method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN }, payload: { tenant: { nome: `${marca}-viz` }, loja: { nome: 'Vizinha' }, setores: [{ nome: 'Cozinha' }] } })).json();
    tokenVizinho = await novoAgente(vizinha.loja.id, `${marca}-viz`);
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  it('a lista: o que tem o que ensinar, com as chaves do contrato; o que não tem, não desce', async () => {
    assert.deepEqual((await base()).json().itens, [], 'a loja nova não tem base');
    fotoId = await foto('Blend da casa');
    await visivel('Sal', false);
    // a cebola marcada e desmarcada: o item existe, sem quadro e visível — não desce
    await visivel('Cebola roxa', false);
    await visivel('Cebola roxa', true);
    // um exemplo da bancada (o que a conferência guarda), direto no banco
    const item = await pool.query(`insert into base_conhecimento (loja_id, tipo, nome) values ($1, 'item', 'Queijo prato') returning id`, [lojaId]);
    const bytes = Buffer.from(JPEG, 'base64');
    await pool.query(
      `insert into base_frame (base_id, origem, imagem, tipo, largura, altura, sha256) values ($1, 'bancada', $2, 'image/jpeg', 320, 320, $3)`,
      [item.rows[0].id, bytes, createHash('sha256').update(bytes).digest('hex')],
    );

    const r = await base();
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.headers['cache-control'], 'no-store');
    const { impressao, itens } = r.json() as { impressao: string; itens: ItemDaBase[] };
    assert.match(impressao, /^[0-9a-f]{64}$/);
    assert.deepEqual(itens.map((i) => [i.nome, i.visivel, i.quadros.length]), [
      ['Blend da casa', true, 1],
      ['Queijo prato', true, 1],
      ['Sal', false, 0],
    ]);
    for (const i of itens) assert.deepEqual(Object.keys(i).sort(), [...CONTRATO.lista.chavesDoItem].sort());
    for (const q of itens.flatMap((i) => i.quadros)) {
      assert.deepEqual(Object.keys(q).sort(), [...CONTRATO.lista.chavesDoQuadro].sort());
      assert.ok(CONTRATO.lista.origens.includes(q.origem));
      assert.match(q.sha256 ?? '', /^[0-9a-f]{64}$/);
    }
    assert.deepEqual(itens.map((i) => i.quadros[0]?.origem ?? null), ['foto', 'bancada', null]);
    assert.equal(itens[0]!.quadros[0]!.id, fotoId);
  });

  it('o quadro desce com os mesmos bytes; o da loja de outra conta, não; sem token, nada', async () => {
    const r = await quadro(fotoId);
    assert.equal(r.statusCode, 200, r.body);
    assert.match(String(r.headers['content-type']), /^image\/jpeg/);
    const lista = (await base()).json() as { itens: ItemDaBase[] };
    assert.equal(createHash('sha256').update(r.rawPayload).digest('hex'), lista.itens[0]!.quadros[0]!.sha256, 'o resumo da lista é o dos bytes');
    assert.deepEqual(r.rawPayload, Buffer.from(JPEG, 'base64'));

    const vizinho = await quadro(fotoId, tokenVizinho);
    assert.equal(vizinho.statusCode, CONTRATO.recusas.find((x) => x.erro === 'nao_encontrado')!.status);
    assert.deepEqual((await base(tokenVizinho)).json().itens, [], 'a vizinha só vê a base dela');
    assert.equal((await base(null)).statusCode, 401);
    assert.equal((await quadro(fotoId, null)).statusCode, 401);
    assert.equal((await quadro('nao-e-id')).statusCode, 404);
  });

  it('a impressão muda quando a base muda, e só então', async () => {
    const m1 = (await base()).json().impressao;
    assert.equal((await base()).json().impressao, m1, 'nada mudou');
    await foto('Blend da casa');
    const m2 = (await base()).json().impressao;
    assert.notEqual(m2, m1, 'entrou uma foto');
    await visivel('Blend da casa', false);
    const m3 = (await base()).json().impressao;
    assert.notEqual(m3, m2, 'passou a "não se vê"');
    const tirada = await app.inject({ method: 'DELETE', url: `/v1/base/fotos/${fotoId}`, headers: { cookie } });
    assert.equal(tirada.statusCode < 300, true, tirada.body);
    const m4 = (await base()).json().impressao;
    assert.notEqual(m4, m3, 'saiu uma foto');
    assert.equal((await quadro(fotoId)).statusCode, 404, 'o quadro tirado não desce mais');
  });
});
