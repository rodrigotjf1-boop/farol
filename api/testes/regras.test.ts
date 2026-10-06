// Regras: os critérios de análise.
//
// Duas invariantes do projeto são testadas aqui, e as duas custariam
// caro se falhassem em produção: regra não pode nascer ligada, e mudar
// o critério tem que subir a versão.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';

const URL = process.env.DATABASE_URL;
const marca = `teste-reg-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-regras';
const SENHA = 'uma senha longa o bastante';

describe('regras (Postgres real)', { skip: !URL && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  let lojaId = '';
  let zonaId = '';
  let cookie = '';
  let cookieExecucao = '';

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL });
    app = criarApp(pool, { logger: false });
    await app.ready();

    const loja = (
      await app.inject({
        method: 'POST',
        url: '/v1/distribuicao/lojas',
        headers: { 'x-farol-admin': ADMIN },
        payload: {
          tenant: { nome: marca },
          loja: { nome: 'Matriz' },
          setores: [{ nome: 'Cozinha' }],
        },
      })
    ).json();
    lojaId = loja.loja.id;
    const tenantId = loja.tenantId;
    const setorId = loja.setores[0].id;

    async function entrar(email: string, nivel: string) {
      await app.inject({
        method: 'POST',
        url: '/v1/distribuicao/usuarios',
        headers: { 'x-farol-admin': ADMIN },
        payload: { tenantId, nome: 'X', email, senha: SENHA, nivel },
      });
      const r = await app.inject({
        method: 'POST',
        url: '/v1/sessao',
        payload: { email, senha: SENHA },
      });
      const b = r.headers['set-cookie'];
      return (Array.isArray(b) ? b[0]! : String(b)).split(';')[0]!;
    }
    cookie = await entrar(`dono-${marca}@e.com`, 'presidente');
    cookieExecucao = await entrar(`exec-${marca}@e.com`, 'execucao');

    const ponto = await app.inject({
      method: 'POST',
      url: `/v1/setores/${setorId}/pontos`,
      headers: { cookie },
      payload: { nome: 'Montagem', origem: 'dvr', canal: 1, host: '192.168.1.108' },
    });
    assert.equal(ponto.statusCode, 201, ponto.body);
    zonaId = ponto.json().zonas[0].id;
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  function criar(payload: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: `/v1/zonas/${zonaId}/regras`,
      headers: { cookie },
      payload,
    });
  }

  const base = {
    nome: 'Bancada limpa',
    tipo: 'estado',
    criterio: 'A superfície está livre de restos e utensílios sujos.',
  };

  // ───────────── o ponto nasce com zona, senão nada funciona ─────────

  it('o ponto nasce com a zona "Quadro inteiro"', async () => {
    // Obrigar a desenhar polígono antes do primeiro critério travaria a
    // instalação por nada.
    assert.ok(zonaId, 'a zona tinha que vir junto com o ponto');
  });

  // ──────────────────── regra NASCE desligada ───────────────────────

  it('regra nasce DESLIGADA, mesmo se o cliente pedir ligada', async () => {
    // Criar já ligada seria alertar a cozinha com critério que ninguém
    // conferiu — e a loja aprende rápido a ignorar quem erra.
    const r = await criar({ ...base, ativa: true });

    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json().ativa, false);
    assert.match(r.json().aviso, /desligada/);
  });

  it('ligar é uma ação separada e consciente', async () => {
    const criada = (await criar(base)).json();

    const r = await app.inject({
      method: 'PATCH',
      url: `/v1/regras/${criada.id}`,
      headers: { cookie },
      payload: { ativa: true },
    });

    assert.equal(r.statusCode, 200);
    assert.equal(r.json().ativa, true);
  });

  // ─────────── mudar o critério SOBE a versão (idempotência) ─────────

  it('mudar o critério SOBE a versão', async () => {
    // A chave de idempotência do agente inclui `criterio_versao`. Sem
    // subir, o critério reescrito reaproveitaria o veredito do antigo —
    // a pergunta mudou e a resposta seria a de antes.
    const criada = (await criar(base)).json();
    assert.equal(criada.criterio_versao, 1);

    const r = await app.inject({
      method: 'PATCH',
      url: `/v1/regras/${criada.id}`,
      headers: { cookie },
      payload: { criterio: 'Outro critério completamente diferente.' },
    });

    assert.equal(r.json().criterio_versao, 2);
  });

  it('mudar OUTRA coisa não sobe a versão', async () => {
    const criada = (await criar(base)).json();

    const r = await app.inject({
      method: 'PATCH',
      url: `/v1/regras/${criada.id}`,
      headers: { cookie },
      payload: { nome: 'Outro nome', severidade: 'critico' },
    });

    assert.equal(r.json().criterio_versao, 1, 'só o critério move a versão');
    assert.equal(r.json().severidade, 'critico');
  });

  it('mandar o MESMO critério não sobe a versão', async () => {
    // Salvar o formulário sem mexer no texto é o caso mais comum de
    // todos; subir a versão aí jogaria fora o cache à toa.
    const criada = (await criar(base)).json();

    const r = await app.inject({
      method: 'PATCH',
      url: `/v1/regras/${criada.id}`,
      headers: { cookie },
      payload: { criterio: base.criterio },
    });

    assert.equal(r.json().criterio_versao, 1);
  });

  // ──────────────────────── validação ───────────────────────────────

  it('tipo fora do domínio é 422, não 500 do banco', async () => {
    const r = await criar({ ...base, tipo: 'adivinhacao' });
    assert.equal(r.statusCode, 422);
    assert.match(r.json().mensagem, /comparacao/);
  });

  it('ação desconhecida é recusada com a lista', async () => {
    const r = await criar({ ...base, acoes: ['registro', 'pombo-correio'] });
    assert.equal(r.statusCode, 422);
    assert.match(r.json().mensagem, /pombo-correio/);
  });

  it('confiança fora de 0..1 é recusada', async () => {
    assert.equal((await criar({ ...base, confiancaMinima: 1.5 })).statusCode, 422);
    assert.equal((await criar({ ...base, confiancaMinima: -1 })).statusCode, 422);
  });

  it('sem critério não cria', async () => {
    const r = await criar({ nome: 'x', tipo: 'estado' });
    assert.equal(r.statusCode, 422);
    assert.match(r.json().mensagem, /criterio/);
  });

  // ──────────────────────── listagem e RBAC ─────────────────────────

  it('a listagem traz a regra com ponto, canal e setor', async () => {
    await criar({ ...base, nome: `listagem-${marca}` });

    const r = await app.inject({
      method: 'GET',
      url: `/v1/lojas/${lojaId}/regras`,
      headers: { cookie },
    });

    assert.equal(r.statusCode, 200);
    const achada = r.json().regras.find((x: { nome: string }) => x.nome === `listagem-${marca}`);
    assert.ok(achada);
    // O critério vem UMA vez, com a lista de onde vale — é o que a árvore
    // de canais desenha.
    assert.equal(achada.alvos.length, 1);
    assert.equal(achada.alvos[0].ponto_nome, 'Montagem');
    assert.equal(achada.alvos[0].canal, 1);
    assert.equal(achada.alvos[0].setor_nome, 'Cozinha');
    assert.equal(achada.alvos[0].zona_id, zonaId);
  });

  it('execução LÊ as regras mas não cria nem liga', async () => {
    const lendo = await app.inject({
      method: 'GET',
      url: `/v1/lojas/${lojaId}/regras`,
      headers: { cookie: cookieExecucao },
    });
    assert.equal(lendo.statusCode, 200);

    const criando = await app.inject({
      method: 'POST',
      url: `/v1/zonas/${zonaId}/regras`,
      headers: { cookie: cookieExecucao },
      payload: base,
    });
    assert.equal(criando.statusCode, 403);
  });

  it('sem sessão não lista nem cria', async () => {
    assert.equal(
      (await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}/regras` })).statusCode,
      401,
    );
    assert.equal(
      (await app.inject({ method: 'POST', url: `/v1/zonas/${zonaId}/regras`, payload: base }))
        .statusCode,
      401,
    );
  });

  it('zona de outro tenant é 404', async () => {
    const outra = (
      await app.inject({
        method: 'POST',
        url: '/v1/distribuicao/lojas',
        headers: { 'x-farol-admin': ADMIN },
        payload: {
          tenant: { nome: `${marca}-vizinha` },
          loja: { nome: 'V' },
          setores: [{ nome: 'C' }],
        },
      })
    ).json();

    // Cria ponto na vizinha pela distribuição, para ter uma zona dela.
    const pv = await pool.query(
      `insert into ponto (setor_id, nome, origem, canal) values ($1,'p','dvr',1) returning id`,
      [outra.setores[0].id],
    );
    const zv = await pool.query(
      `insert into zona (ponto_id, nome, poligono)
       values ($1,'z','[[0,0],[1,0],[1,1],[0,1]]'::jsonb) returning id`,
      [pv.rows[0].id],
    );

    const r = await app.inject({
      method: 'POST',
      url: `/v1/zonas/${zv.rows[0].id}/regras`,
      headers: { cookie },
      payload: base,
    });
    assert.equal(r.statusCode, 404);
  });
});
