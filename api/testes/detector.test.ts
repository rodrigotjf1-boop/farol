// O que o detector local procura — visto da nuvem.
//
// Critério de presença e de contagem carrega campos (o que procurar,
// quantos), porque o detector não lê português. A API tem que aceitar e
// recusar exatamente o que o agente aceita e recusa: senão o console
// grava um critério que nunca é julgado, e só o log do PC da loja sabe.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { lerParametrosDoDetector, OBJETOS_DO_DETECTOR } from '../src/detector.js';

const CONTRATO = JSON.parse(
  readFileSync(new URL('../../contratos/objetos-do-detector.json', import.meta.url), 'utf8'),
) as { objetos: string[]; exemplos: unknown[]; recusados: unknown[] };

// ───────────────── o contrato com o agente: sem banco ─────────────────

describe('contrato do detector (o mesmo arquivo que o agente lê)', () => {
  it('o vocabulário da API é o do contrato', () => {
    assert.deepEqual([...OBJETOS_DO_DETECTOR].sort(), [...CONTRATO.objetos].sort());
  });

  it('todo exemplo do contrato é aceito', () => {
    for (const exemplo of CONTRATO.exemplos) {
      const r = lerParametrosDoDetector(exemplo);
      assert.ok('ok' in r, `recusou ${JSON.stringify(exemplo)}`);
    }
  });

  it('todo recusado do contrato é recusado, com uma frase', () => {
    for (const ruim of CONTRATO.recusados) {
      const r = lerParametrosDoDetector(ruim);
      assert.ok('problema' in r, `aceitou ${JSON.stringify(ruim)}`);
      assert.ok(r.problema.length > 10);
    }
  });

  it('normaliza: maiúscula vira minúscula, ausente vira o padrão', () => {
    assert.deepEqual(lerParametrosDoDetector({ objeto: ' Pessoa ', minimo: 1 }), {
      ok: { objeto: 'pessoa', minimo: 1, maximo: null },
    });
    assert.deepEqual(lerParametrosDoDetector({ objeto: 'copo', maximo: 0 }), {
      ok: { objeto: 'copo', minimo: 0, maximo: 0 },
    });
  });

  it('"zero ou mais" é recusado: nunca reprovaria nada', () => {
    const r = lerParametrosDoDetector({ objeto: 'pessoa', minimo: 0 });
    assert.ok('problema' in r);
    assert.match(r.problema, /não exige nada/);
  });
});

// ───────────────────────────── com banco ─────────────────────────────

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-detector-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-detector';
const SENHA = 'uma senha longa o bastante';

describe('campos do detector no critério (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  let lojaId = '';
  let zonaId = '';
  let cookie = '';
  let token = '';

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    app = criarApp(pool, { logger: false });
    await app.ready();

    const loja = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas',
      headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome: marca }, loja: { nome: 'Matriz' }, setores: [{ nome: 'Cozinha' }] },
    })).json();
    lojaId = loja.loja.id;

    await app.inject({
      method: 'POST', url: '/v1/distribuicao/usuarios',
      headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId: loja.tenantId, nome: 'X', email: `dono-${marca}@e.com`, senha: SENHA, nivel: 'presidente' },
    });
    const sessao = await app.inject({
      method: 'POST', url: '/v1/sessao', payload: { email: `dono-${marca}@e.com`, senha: SENHA },
    });
    const b = sessao.headers['set-cookie'];
    cookie = (Array.isArray(b) ? b[0]! : String(b)).split(';')[0]!;

    const ponto = await app.inject({
      method: 'POST', url: `/v1/setores/${loja.setores[0].id}/pontos`,
      headers: { cookie },
      payload: { nome: 'Montagem', origem: 'dvr', canal: 1, host: '192.168.1.118' },
    });
    zonaId = ponto.json().zonas[0].id;

    const agente = await app.inject({
      method: 'POST', url: '/v1/distribuicao/agentes',
      headers: { 'x-farol-admin': ADMIN },
      payload: { lojaId, nome: 'Agente de teste' },
    });
    token = agente.json().token;
    await app.inject({
      method: 'POST', url: '/v1/agentes/ativar',
      headers: { authorization: `Bearer ${token}` },
      payload: { fingerprint: `fp-${marca}` },
    });
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  const criar = (payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST', url: `/v1/lojas/${lojaId}/regras`,
      headers: { cookie },
      payload: { nome: 'Posto ocupado', criterio: 'Tem que ter alguém no posto.', zonaIds: [zonaId], ...payload },
    });

  const editar = (id: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'PATCH', url: `/v1/regras/${id}`, headers: { cookie }, payload });

  async function descida() {
    const r = await app.inject({
      method: 'GET', url: '/v1/agentes/configuracao',
      headers: { authorization: `Bearer ${token}` },
    });
    return r.json();
  }

  /** Critério de presença do jeito que existia antes dos campos: `{}`. */
  async function presencaAntiga(nome: string) {
    const { rows } = await pool.query(
      `with nova as (
         insert into regra (loja_id, nome, tipo, criterio)
         values ($1, $2, 'presenca', 'Tem copo na bancada.')
         returning id
       ), alvo as (
         insert into regra_alvo (regra_id, zona_id) select id, $3 from nova
       )
       select id from nova`,
      [lojaId, nome, zonaId],
    );
    return rows[0].id as string;
  }

  // ─────────────────────────── criar ───────────────────────────

  it('presença SEM dizer o que procurar não é criada', async () => {
    // Nasceria um critério cadastrado que nunca verifica nada.
    const r = await criar({ tipo: 'presenca' });
    assert.equal(r.statusCode, 422);
    assert.match(r.json().mensagem, /o que procurar/);
  });

  it('presença com os campos é criada, e os campos voltam normalizados', async () => {
    const r = await criar({ tipo: 'presenca', parametros: { objeto: 'Pessoa', minimo: 1 } });
    assert.equal(r.statusCode, 201, r.body);
    assert.deepEqual(r.json().parametros, { objeto: 'pessoa', minimo: 1, maximo: null });
    assert.equal(r.json().ativa, false, 'nasce desligado, como todo critério');
  });

  it('contagem com teto', async () => {
    const r = await criar({ tipo: 'contagem', nome: `fila-${marca}`, parametros: { objeto: 'pessoa', maximo: 3 } });
    assert.equal(r.statusCode, 201, r.body);
    assert.deepEqual(r.json().parametros, { objeto: 'pessoa', minimo: 0, maximo: 3 });
  });

  it('objeto que o detector não conhece é recusado dizendo o que ele conhece', async () => {
    const r = await criar({ tipo: 'presenca', parametros: { objeto: 'espátula', minimo: 1 } });
    assert.equal(r.statusCode, 422);
    assert.match(r.json().mensagem, /não conhece "espátula"/);
    assert.match(r.json().mensagem, /pessoa/);
  });

  it('critério de ESTADO não guarda campo de detector, mesmo que o corpo traga', async () => {
    const r = await criar({ tipo: 'estado', nome: `estado-${marca}`, parametros: { objeto: 'pessoa', minimo: 1 } });
    assert.equal(r.statusCode, 201, r.body);
    assert.deepEqual(r.json().parametros, {});
  });

  // ─────────────────────────── listar ───────────────────────────

  it('a listagem traz os campos e o vocabulário do detector', async () => {
    await criar({ tipo: 'presenca', nome: `lista-${marca}`, parametros: { objeto: 'copo', minimo: 1 } });

    const r = await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}/regras`, headers: { cookie } });

    const achada = r.json().regras.find((x: { nome: string }) => x.nome === `lista-${marca}`);
    assert.deepEqual(achada.parametros, { objeto: 'copo', minimo: 1, maximo: null });
    // A tela monta "o que procurar" a partir daqui, sem uma terceira cópia.
    assert.deepEqual([...r.json().detector.objetos].sort(), [...CONTRATO.objetos].sort());
  });

  // ─────────────────────────── editar ───────────────────────────

  it('corrigir o que procurar grava e SOBE a versão que o agente observa', async () => {
    const id = (await criar({ tipo: 'presenca', nome: `corrige-${marca}`, parametros: { objeto: 'pessoa', minimo: 1 } })).json().id;
    const v0 = (await descida()).versao;

    const r = await editar(id, { parametros: { objeto: 'copo', minimo: 2, maximo: 2 } });

    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json().parametros, { objeto: 'copo', minimo: 2, maximo: 2 });
    assert.ok((await descida()).versao > v0, 'mudou o que o detector procura e o agente não foi avisado');
  });

  it('campos ruins na edição: nada muda', async () => {
    const id = (await criar({ tipo: 'presenca', nome: `ruim-${marca}`, parametros: { objeto: 'pessoa', minimo: 1 } })).json().id;

    const r = await editar(id, { nome: `mudou-${marca}`, parametros: { objeto: 'pessoa', minimo: 5, maximo: 2 } });

    assert.equal(r.statusCode, 422);
    assert.match(r.json().mensagem, /menor que o mínimo/);
    const lista = await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}/regras`, headers: { cookie } });
    const regra = lista.json().regras.find((x: { id: string }) => x.id === id);
    assert.equal(regra.nome, `ruim-${marca}`, 'o nome mudou mesmo com a edição recusada');
    assert.deepEqual(regra.parametros, { objeto: 'pessoa', minimo: 1, maximo: null });
  });

  it('mudar um critério de estado para presença exige os campos', async () => {
    const id = (await criar({ tipo: 'estado', nome: `vira-${marca}` })).json().id;

    assert.equal((await editar(id, { tipo: 'presenca' })).statusCode, 422);

    const r = await editar(id, { tipo: 'presenca', parametros: { objeto: 'pessoa', minimo: 1 } });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().tipo, 'presenca');
  });

  it('voltar de presença para estado limpa os campos', async () => {
    const id = (await criar({ tipo: 'presenca', nome: `volta-${marca}`, parametros: { objeto: 'pessoa', minimo: 1 } })).json().id;

    const r = await editar(id, { tipo: 'estado' });

    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json().parametros, {});
  });

  // ─────────── o critério de presença que já existia, sem campos ───────────

  it('critério antigo sem campos pode ter o NOME corrigido', async () => {
    const id = await presencaAntiga(`antigo-${marca}`);
    const r = await editar(id, { nome: `antigo-renomeado-${marca}` });
    assert.equal(r.statusCode, 200, r.body);
  });

  it('mas LIGAR um critério de presença sem campos é recusado', async () => {
    // "Ligado" na tela com nada sendo verificado: o agente o deixaria de
    // fora por não saber o que procurar.
    const id = await presencaAntiga(`antigo-liga-${marca}`);

    const r = await editar(id, { ativa: true });

    assert.equal(r.statusCode, 422);
    assert.equal(r.json().erro, 'sem_campos');
    assert.match(r.json().mensagem, /escolha o objeto antes de ligar/);
  });

  it('depois de dizer o que procurar, liga', async () => {
    const id = await presencaAntiga(`antigo-conserta-${marca}`);
    const r = await editar(id, { parametros: { objeto: 'copo', minimo: 1 }, ativa: true });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().ativa, true);
  });

  // ─────────────────────── o agente recebe ───────────────────────

  it('os campos DESCEM para o agente com o critério', async () => {
    const id = (await criar({ tipo: 'contagem', nome: `desce-${marca}`, parametros: { objeto: 'pessoa', maximo: 2 } })).json().id;
    await editar(id, { ativa: true });

    const c = await descida();
    const regras = c.pontos.flatMap((p: { zonas: Array<{ regras: unknown[] }> }) => p.zonas.flatMap((z) => z.regras));
    const desceu = regras.find((x: { id: string }) => x.id === id);

    assert.ok(desceu, 'o critério ligado não desceu');
    assert.deepEqual(desceu.parametros, { objeto: 'pessoa', minimo: 0, maximo: 2 });
  });
});
