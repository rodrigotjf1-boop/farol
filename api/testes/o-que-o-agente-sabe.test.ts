// =====================================================================
// O que o agente da loja sabe fazer — a declaração fica guardada
// =====================================================================
// Ao pedir a configuração o agente declara o que sabe (`?sabe=…`), e a
// nuvem só manda certas coisas para quem declara. A declaração agora fica
// em `agente.sabe`, com a hora (`sabe_em`): é como o console diz se o que
// foi configurado já vale na loja, e como se confere, depois de trocar o
// pacote, que o agente novo pediu a configuração de novo.
//
// A versão que o agente informa no sinal de vida não serve para isso: é um
// texto fixo de quem o instalou (na loja-piloto, "0.1.0-loja"), e não muda
// com o pacote.
//
// O vocabulário é o de `contratos/o-que-o-agente-sabe.json`, lido também
// pelos testes do agente.
// =====================================================================

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { SABE_ESTADOS } from '../src/estado.js';
import { SABE_ESTUDO } from '../src/estudo.js';

const CONTRATO = JSON.parse(readFileSync(new URL('../../contratos/o-que-o-agente-sabe.json', import.meta.url), 'utf8')) as {
  parametro: string;
  saberes: Record<string, string>;
  mudamOQueDesce: string[];
  pedido: string;
  guardado: string[];
};

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-sabe-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-sabe';
const SENHA = 'uma senha longa o bastante';

it('o contrato: o que muda o que desce é o que a rota confere, e tudo está na lista', () => {
  assert.equal(CONTRATO.parametro, 'sabe');
  assert.deepEqual([...CONTRATO.mudamOQueDesce].sort(), [SABE_ESTADOS, SABE_ESTUDO].sort());
  for (const saber of CONTRATO.mudamOQueDesce) assert.ok(saber in CONTRATO.saberes, saber);
  assert.deepEqual(CONTRATO.guardado, Object.keys(CONTRATO.saberes).sort(), 'guardado em ordem');
  assert.equal(CONTRATO.pedido, `/v1/agentes/configuracao?sabe=${Object.keys(CONTRATO.saberes).join(',')}`);
});

describe('a nuvem guarda o que o agente declara saber', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  let lojaId = '';
  let cookie = '';
  const agente = { id: '', token: '' };
  const outro = { id: '', token: '' };

  async function criarAgente(nome: string, maquina: string) {
    const criado = await app.inject({
      method: 'POST',
      url: '/v1/distribuicao/agentes',
      headers: { 'x-farol-admin': ADMIN },
      payload: { lojaId, nome },
    });
    assert.equal(criado.statusCode, 201, criado.body);
    const corpo = criado.json() as { id: string; token: string };
    const ativado = await app.inject({
      method: 'POST',
      url: '/v1/agentes/ativar',
      headers: { authorization: `Bearer ${corpo.token}` },
      payload: { fingerprint: maquina, versao: '0.1.0-loja' },
    });
    assert.equal(ativado.statusCode, 200, ativado.body);
    return corpo;
  }

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    app = criarApp(pool, { logger: false });
    await app.ready();

    const montada = await app.inject({
      method: 'POST',
      url: '/v1/distribuicao/lojas',
      headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome: `${marca}-empresa` }, loja: { nome: 'Loja do saber' }, setores: [{ nome: 'Cozinha' }] },
    });
    assert.equal(montada.statusCode, 201, montada.body);
    const c = montada.json() as { tenantId: string; loja: { id: string } };
    lojaId = c.loja.id;

    const usuario = await app.inject({
      method: 'POST',
      url: '/v1/distribuicao/usuarios',
      headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId: c.tenantId, nome: 'Dono', email: `dono-${marca}@e.com`, senha: SENHA, nivel: 'presidente' },
    });
    assert.equal(usuario.statusCode, 201, usuario.body);
    const login = await app.inject({ method: 'POST', url: '/v1/sessao', payload: { email: `dono-${marca}@e.com`, senha: SENHA } });
    assert.equal(login.statusCode, 200, login.body);
    const bruto = login.headers['set-cookie'];
    cookie = (Array.isArray(bruto) ? bruto[0]! : String(bruto)).split(';')[0]!;

    Object.assign(agente, await criarAgente('agente-da-loja', `maquina-${marca}-1`));
    Object.assign(outro, await criarAgente('agente-reserva', `maquina-${marca}-2`));
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  async function pedir(caminho: string, token = agente.token, onde: FastifyInstance = app) {
    return onde.inject({ method: 'GET', url: caminho, headers: { authorization: `Bearer ${token}` } });
  }

  async function guardado(id = agente.id) {
    const { rows } = await pool.query(
      `select sabe, sabe_em, extract(epoch from (now() - sabe_em))::float as ha_segundos from agente where id = $1`,
      [id],
    );
    return rows[0] as { sabe: string[]; sabe_em: Date | null; ha_segundos: number | null };
  }

  async function noConsole(id = agente.id) {
    const r = await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}`, headers: { cookie } });
    assert.equal(r.statusCode, 200, r.body);
    const agentes = (r.json() as { agentes: Array<{ id: string; sabe: string[]; sabe_em: string | null; versao: string }> }).agentes;
    return agentes.find((a) => a.id === id)!;
  }

  it('antes de pedir a configuração, nada está guardado — e o console diz isso', async () => {
    const g = await guardado();
    assert.deepEqual(g.sabe, []);
    assert.equal(g.sabe_em, null, 'nulo = ainda não pediu a configuração');

    const a = await noConsole();
    assert.deepEqual(a.sabe, []);
    assert.equal(a.sabe_em, null);
    assert.equal(a.versao, '0.1.0-loja', 'a versão é o texto de quem instalou: não diz qual é o pacote');
  });

  it('a declaração fica guardada, em ordem, com a hora — e chega ao console', async () => {
    const r = await pedir(CONTRATO.pedido);
    assert.equal(r.statusCode, 200, r.body);

    const g = await guardado();
    assert.deepEqual(g.sabe, CONTRATO.guardado);
    assert.ok(g.ha_segundos !== null && g.ha_segundos >= 0 && g.ha_segundos < 30, `guardada agora (${g.ha_segundos} s)`);

    const a = await noConsole();
    assert.deepEqual(a.sabe, CONTRATO.guardado);
    assert.ok(a.sabe_em && !Number.isNaN(Date.parse(a.sabe_em)));

    // Só a de quem pediu: o outro agente da loja continua sem nada.
    const o = await guardado(outro.id);
    assert.deepEqual(o.sabe, []);
    assert.equal(o.sabe_em, null);
  });

  it('o sinal de vida não mexe no que foi declarado', async () => {
    const antes = await guardado();
    const h = await app.inject({
      method: 'POST',
      url: '/v1/agentes/heartbeat',
      headers: { authorization: `Bearer ${agente.token}` },
      payload: { versao: '0.1.0-loja' },
    });
    assert.equal(h.statusCode, 200, h.body);
    const depois = await guardado();
    assert.deepEqual(depois.sabe, antes.sabe);
    assert.deepEqual(depois.sabe_em, antes.sabe_em);
  });

  it('o que vem torto não é guardado, e o repetido entra uma vez', async () => {
    const r = await pedir('/v1/agentes/configuracao?sabe=estudo,%20estados%20,Coisa-Torta,ESTUDO,estudo,,9nove');
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual((await guardado()).sabe, ['estados', 'estudo']);
  });

  it('vale a ÚLTIMA declaração: quem pede sem declarar nada fica com a lista vazia e a hora nova', async () => {
    await pool.query(`update agente set sabe_em = now() - interval '1 hour' where id = $1`, [agente.id]);
    const r = await pedir('/v1/agentes/configuracao');
    assert.equal(r.statusCode, 200, r.body);

    const g = await guardado();
    assert.deepEqual(g.sabe, [], 'o agente de antes dos estados: pediu, e não declarou nada');
    assert.ok(g.sabe_em !== null && g.ha_segundos !== null && g.ha_segundos < 30, 'a hora é a do último pedido');
  });

  it('credencial recusada não anota nada', async () => {
    const antes = await guardado(outro.id);
    const r = await pedir(CONTRATO.pedido, 'token-que-nao-existe');
    assert.equal(r.statusCode, 401);
    assert.deepEqual(await guardado(outro.id), antes);
  });

  it('anotar não pode impedir a configuração de descer', async () => {
    await pedir(CONTRATO.pedido);
    const antes = await guardado();

    // O mesmo banco, com a anotação falhando — e só ela.
    const recusadas: string[] = [];
    const comDefeito = new Proxy(pool, {
      get(alvo, prop, receptor) {
        if (prop !== 'query') return Reflect.get(alvo, prop, receptor);
        return (texto: unknown, ...resto: unknown[]) => {
          if (typeof texto === 'string' && /^\s*update agente set sabe\b/.test(texto)) {
            recusadas.push(texto);
            return Promise.reject(new Error('disco cheio'));
          }
          return (alvo.query as (...a: unknown[]) => unknown)(texto, ...resto);
        };
      },
    });
    const outroApp = criarApp(comDefeito as pg.Pool, { logger: false });
    await outroApp.ready();
    try {
      const r = await pedir('/v1/agentes/configuracao?sabe=estados', agente.token, outroApp);
      assert.equal(r.statusCode, 200, r.body);
      assert.equal((r.json() as { loja: { id: string } }).loja.id, lojaId, 'a configuração desceu');
      assert.equal(recusadas.length, 1, 'a anotação foi tentada, e falhou');
    } finally {
      await outroApp.close();
    }
    assert.deepEqual((await guardado()).sabe, antes.sabe, 'ficou o que estava');
  });
});
