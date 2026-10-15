// =====================================================================
// O contrato de erro tem que ser TOTAL
// =====================================================================
// As rotas sempre devolveram `{erro, mensagem}`. O que escapava era o
// que o Fastify produz sozinho — e é justamente nos casos de erro que
// quem integra precisa do contrato.
//
// Contrato parcial é pior que contrato nenhum: a pessoa confia nele e é
// traída exatamente onde dói.
// =====================================================================

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';

describe('contrato de erro', () => {
  let app: FastifyInstance;
  let pool: pg.Pool;

  before(async () => {
    // Pool que nunca conecta: as rotas que o tocam vão falhar, e é
    // exatamente o que alguns destes testes querem exercitar.
    pool = new pg.Pool({ connectionString: 'postgres://ninguem@127.0.0.1:1/nada' });
    app = criarApp(pool, { logger: false });
    await app.ready();
  });

  after(async () => {
    await app?.close();
    await pool?.end().catch(() => {});
  });

  it('rota inexistente diz o MÉTODO junto da rota', async () => {
    // `GET /v1/pontos` existir e `POST /v1/pontos` não existir é o engano
    // mais comum de quem integra, e "não existe essa rota" não ajuda a
    // notar.
    const r = await app.inject({ method: 'POST', url: '/v1/nao-existe' });

    assert.equal(r.statusCode, 404);
    const corpo = r.json() as { erro: string; mensagem: string };
    assert.equal(corpo.erro, 'rota_nao_encontrada');
    assert.match(corpo.mensagem, /POST/);
    assert.match(corpo.mensagem, /\/v1\/nao-existe/);
  });

  it('corpo vazio prometendo JSON vira o contrato da casa (ERR-012)', async () => {
    // Era isto que chegava ao usuário como "não deu certo".
    const r = await app.inject({
      method: 'POST',
      url: '/v1/sessao',
      headers: { 'content-type': 'application/json' },
      payload: '',
    });

    assert.equal(r.statusCode, 400);
    const corpo = r.json() as { erro: string; mensagem: string };
    assert.equal(corpo.erro, 'corpo_invalido');
    assert.match(corpo.mensagem, /content-type/);
    assert.ok(!('statusCode' in (r.json() as object)), 'não vaza o formato do Fastify');
  });

  it('JSON malformado também', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/v1/sessao',
      headers: { 'content-type': 'application/json' },
      payload: '{isto não é json',
    });

    assert.equal(r.statusCode, 400);
    assert.ok((r.json() as { mensagem?: string }).mensagem, 'tem que ter mensagem em pt-BR');
  });

  it('erro interno NÃO conta o que houve, mas entrega o requestId', async () => {
    // Mensagem de erro interno vaza nome de tabela, caminho e SQL. O que
    // vai para o cliente é genérico mais o código que permite achar a
    // linha exata no log — é o par que torna o diagnóstico possível sem
    // transformar a tela num mapa do servidor.
    // Rota que CHEGA ao banco: as de console conferem a sessão antes, e
    // devolvem 401 sem nunca tocar no Postgres — o que é a ordem certa.
    const r = await app.inject({
      method: 'POST',
      url: '/v1/agentes/heartbeat',
      headers: { authorization: 'Bearer token-qualquer' },
      payload: {},
    });

    assert.equal(r.statusCode, 500);
    const corpo = r.json() as { erro: string; mensagem: string; requestId?: string };
    assert.equal(corpo.erro, 'erro_interno');
    assert.ok(corpo.requestId, 'sem requestId ninguém acha o registro');

    const texto = JSON.stringify(corpo).toLowerCase();
    for (const vazamento of ['postgres', 'econnrefused', 'select ', 'pg.', 'at ']) {
      assert.ok(!texto.includes(vazamento), `vazou '${vazamento}' na resposta`);
    }
  });

  it('na porta para outro sistema, o erro do próprio Fastify também sai no Padrão DMS — e fora dela, no contrato de sempre', async () => {
    const PROBLEMA = 'application/problem+json; charset=utf-8';
    const BASE = 'https://dev.dmstecnologias.com/erros/';
    const noPadrao = (r: { statusCode: number; headers: Record<string, unknown>; json: () => Record<string, unknown> }, tipo: string, erro: string) => {
      const j = r.json();
      assert.equal(r.headers['content-type'], PROBLEMA);
      assert.deepEqual([j.type, j.status, j.erro, j.detail === j.mensagem, typeof j.title, typeof j.request_id], [`${BASE}${tipo}`, r.statusCode, erro, true, 'string', 'string']);
    };

    // rota que não existe, com e sem consulta na URL
    for (const url of ['/v1/integracao/nada', '/v1/integracao/nada?x=1']) {
      const r = await app.inject({ method: 'GET', url });
      assert.equal(r.statusCode, 404);
      noPadrao(r, 'nao-encontrado', 'rota_nao_encontrada');
    }
    // JSON torto e corpo vazio: o parser recusa antes da rota
    const torto = await app.inject({ method: 'PUT', url: '/v1/integracao/fichas', headers: { 'content-type': 'application/json' }, payload: '{"produtos": [' });
    assert.equal(torto.statusCode, 400);
    noPadrao(torto, 'parametro-invalido', 'corpo_invalido');
    const vazio = await app.inject({ method: 'PUT', url: '/v1/integracao/fichas', headers: { 'content-type': 'application/json' }, payload: '' });
    noPadrao(vazio, 'parametro-invalido', 'corpo_invalido');
    const tipo = await app.inject({ method: 'PUT', url: '/v1/integracao/fichas', headers: { 'content-type': 'application/xml' }, payload: '<produtos/>' });
    assert.equal(tipo.statusCode, 415);
    noPadrao(tipo, 'parametro-invalido', 'tipo_invalido');
    const grande = await app.inject({ method: 'PUT', url: '/v1/integracao/fichas', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ produtos: [{ nome: 'x'.repeat(9 * 1024 * 1024) }] }) });
    assert.equal(grande.statusCode, 413);
    noPadrao(grande, 'parametro-invalido', 'corpo_grande');
    // o erro interno (o banco não responde): genérico, com o código de rastreio, sem vazar nada
    const interno = await app.inject({ method: 'GET', url: '/v1/integracao/fichas', headers: { authorization: `Bearer farol_${'a'.repeat(43)}` } });
    assert.equal(interno.statusCode, 500);
    noPadrao(interno, 'erro-interno', 'erro_interno');
    for (const vazamento of ['postgres', 'econnrefused', 'select ', 'pg.', 'at ']) assert.ok(!interno.body.toLowerCase().includes(vazamento), `vazou '${vazamento}'`);

    // fora da porta — inclusive o que só COMEÇA parecido — segue no contrato de sempre
    for (const url of ['/v1/nada', '/v1/integracaox/nada', '/v1/integracao']) {
      const r = await app.inject({ method: 'GET', url });
      assert.equal(r.statusCode, 404, url);
      assert.match(String(r.headers['content-type']), /^application\/json/, url);
      assert.deepEqual(Object.keys(r.json()).sort(), ['erro', 'mensagem'], url);
    }
  });

  it('o 4xx que o contrato não traduz também sai no Padrão DMS na porta (e no contrato de sempre fora dela)', async () => {
    // Nenhuma rota da porta lança um 4xx assim hoje: é a rede de baixo do contrato, e um app de teste a exercita.
    const outro = criarApp(pool, { logger: false });
    const bule = () => {
      throw Object.assign(new Error('sou um bule'), { statusCode: 418 });
    };
    outro.get('/v1/integracao/teste-do-bule', bule);
    outro.get('/v1/teste-do-bule', bule);
    await outro.ready();
    try {
      const naPorta = await outro.inject({ method: 'GET', url: '/v1/integracao/teste-do-bule' });
      assert.deepEqual([naPorta.statusCode, naPorta.headers['content-type'], naPorta.json().type, naPorta.json().erro, naPorta.json().mensagem], [418, 'application/problem+json; charset=utf-8', 'https://dev.dmstecnologias.com/erros/parametro-invalido', 'pedido_invalido', 'sou um bule']);
      const fora = await outro.inject({ method: 'GET', url: '/v1/teste-do-bule' });
      assert.deepEqual([fora.statusCode, fora.json()], [418, { erro: 'pedido_invalido', mensagem: 'sou um bule' }]);
    } finally {
      await outro.close();
    }
  });

  it('toda resposta de erro tem os dois campos', async () => {
    // A garantia que quem integra precisa: qualquer erro, mesma forma.
    const casos = [
      { method: 'GET' as const, url: '/v1/nao-existe' },
      { method: 'GET' as const, url: '/v1/eu' },
      { method: 'POST' as const, url: '/v1/lojas/x/setores' },
    ];

    for (const caso of casos) {
      const r = await app.inject(caso);
      assert.ok(r.statusCode >= 400, `${caso.url} devia falhar`);
      const corpo = r.json() as Record<string, unknown>;
      assert.equal(typeof corpo.erro, 'string', `${caso.url}: sem 'erro'`);
      assert.equal(typeof corpo.mensagem, 'string', `${caso.url}: sem 'mensagem'`);
    }
  });
});

describe('conferência de partida', () => {
  it('acha a pasta de migrations a partir do código compilado', async () => {
    const { acharMigrations } = await import('../src/preflight.js');
    const pasta = acharMigrations();
    assert.ok(pasta, 'sem a pasta, a conferência não tem com o que comparar');
    // Sem regex: a barra do Windows e a do Linux divergem, e o teste
    // precisa valer nos dois (aqui e no CI).
    const normalizada = String(pasta).split('\\').join('/');
    assert.ok(normalizada.endsWith('database/migrations'), normalizada);
  });

  it('banco inalcançável NÃO derruba o serviço', async () => {
    // A rede pode voltar. Morrer aqui criaria laço de reinício, que
    // esconde a causa atrás de um contêiner que nunca fica de pé.
    const { conferirEsquema } = await import('../src/preflight.js');
    const morto = new pg.Pool({ connectionString: 'postgres://x@127.0.0.1:1/x' });

    const r = await conferirEsquema(morto);
    assert.equal(r.ok, true);
    assert.match(String((r as { motivo?: string }).motivo), /inalcançável|novo/);

    await morto.end().catch(() => {});
  });
});
