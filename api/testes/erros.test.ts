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
