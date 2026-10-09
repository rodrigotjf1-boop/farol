// O porteiro, o "avisar só se continuar" e a faixa de horas do critério
// (migration 023), de ponta a ponta na API:
//
//   - o console grava e lê os três campos, e o que não cabe é recusado com
//     a frase do motivo (presença e contagem não têm porteiro; "quando algo
//     se mexe" é de critério de ação);
//   - editar sem mandar o campo MANTÉM o que estava;
//   - o agente recebe os dois campos na configuração, e mexer neles sobe a
//     versão — senão a loja seguiria na regra velha, calada;
//   - o resumo da hora guarda as olhadas que o porteiro segurou, e a tela de
//     Análises as recebe.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { porteiroNaoCabe, PORTEIROS } from '../src/rotas/regras.js';
import { validarResumo } from '../src/rotas/resumos.js';

const CONTRATO = JSON.parse(
  readFileSync(new URL('../../contratos/resumo-do-agente.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

// ───────────────── sem banco ─────────────────

describe('o porteiro cabe no tipo? (a regra, sem banco)', () => {
  it('os modos são os do banco', () => {
    const sql = readFileSync(new URL('../../database/migrations/023_porteiro_e_confirmacao.sql', import.meta.url), 'utf8');
    const noBanco = /check \(porteiro in \(([^)]+)\)\)/.exec(sql)?.[1]?.split(',').map((s) => s.trim().replace(/'/g, ''));
    assert.deepEqual(noBanco, PORTEIROS, 'a lista da API e o check da migration têm de ser a mesma');
  });

  it('"sempre" cabe em qualquer tipo', () => {
    for (const tipo of ['estado', 'acao', 'presenca', 'contagem', 'comparacao']) {
      assert.equal(porteiroNaoCabe(tipo, 'sempre'), null, tipo);
    }
  });

  it('presença e contagem não têm porteiro: já são julgadas na loja em toda olhada', () => {
    for (const tipo of ['presenca', 'contagem']) {
      for (const porteiro of ['pessoa', 'livre', 'movimento']) {
        assert.match(String(porteiroNaoCabe(tipo, porteiro)), /presença e contagem/, `${tipo} + ${porteiro}`);
      }
    }
  });

  it('"com pessoa" e "com a área livre" cabem no que pode ir à nuvem', () => {
    for (const tipo of ['estado', 'acao', 'comparacao']) {
      assert.equal(porteiroNaoCabe(tipo, 'pessoa'), null, tipo);
      assert.equal(porteiroNaoCabe(tipo, 'livre'), null, tipo);
    }
  });

  it('"quando algo se mexe" é só de critério de ação', () => {
    assert.equal(porteiroNaoCabe('acao', 'movimento'), null);
    assert.match(String(porteiroNaoCabe('estado', 'movimento')), /só para critério de ação/);
    assert.match(String(porteiroNaoCabe('comparacao', 'movimento')), /só para critério de ação/);
  });
});

describe('o resumo aceita as olhadas que o porteiro segurou (validação)', () => {
  it('o contrato traz semCondicao, e a conta das olhadas fecha com ele', () => {
    assert.equal(typeof CONTRATO.semCondicao, 'number');
    const desfechos = ['semJuiz', 'semQuadro', 'semCena', 'semCondicao', 'observadas', 'emSilencio', 'repetidas', 'jaJulgadas', 'enfileiradas'];
    assert.equal(desfechos.reduce((a, d) => a + (CONTRATO[d] as number), 0), CONTRATO.capturas);
  });

  it('agente antigo, que não manda o campo, continua aceito', () => {
    const { semCondicao: _, ...antigo } = CONTRATO;
    assert.equal(validarResumo(antigo, 0), null);
  });

  it('valor torto é recusado dizendo o campo', () => {
    for (const ruim of [-1, 1.5, '6', 100_001]) {
      assert.match(String(validarResumo({ ...CONTRATO, semCondicao: ruim }, 0)), /semCondicao/, String(ruim));
    }
  });
});

// ───────────────── com banco ─────────────────

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-porteiro-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-porteiro';
const SENHA = 'uma senha longa o bastante';

describe('porteiro, confirmação e faixa de horas (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  let lojaId = '';
  let zonaId = '';
  let cookie = '';
  let token = '';

  const estado = { nome: 'Uniforme', tipo: 'estado', criterio: 'Quem está na área usa o uniforme completo.' };
  const presenca = { nome: 'Posto ocupado', tipo: 'presenca', criterio: 'Há alguém no posto.', parametros: { objeto: 'pessoa', minimo: 1, maximo: null } };

  const criar = (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: `/v1/lojas/${lojaId}/regras`, headers: { cookie }, payload: { zonaIds: [zonaId], ...payload } });
  const criarNoCanal = (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: `/v1/zonas/${zonaId}/regras`, headers: { cookie }, payload });
  const editar = (id: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'PATCH', url: `/v1/regras/${id}`, headers: { cookie }, payload });
  const noBanco = async (id: string) =>
    (await pool.query('select tipo, porteiro, confirmar_em, janelas from regra where id = $1', [id])).rows[0];
  const listar = async () =>
    (await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}/regras`, headers: { cookie } })).json().regras as Array<Record<string, unknown>>;
  const configuracao = async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/agentes/configuracao', headers: { authorization: `Bearer ${token}` } });
    assert.equal(r.statusCode, 200, r.body);
    return r.json();
  };
  const regraNaConfiguracao = async (id: string) => {
    const cfg = await configuracao();
    for (const p of cfg.pontos) for (const z of p.zonas) for (const r of z.regras) if (r.id === id) return r as Record<string, unknown>;
    return null;
  };
  const versao = async () => (await pool.query('select config_versao from loja where id = $1', [lojaId])).rows[0].config_versao as number;

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    app = criarApp(pool, { logger: false });
    await app.ready();

    const loja = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome: marca }, loja: { nome: 'Matriz' }, setores: [{ nome: 'Cozinha' }] },
    })).json();
    lojaId = loja.loja.id;
    const email = `dono-${marca}@e.com`;
    await app.inject({
      method: 'POST', url: '/v1/distribuicao/usuarios', headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId: loja.tenantId, nome: 'X', email, senha: SENHA, nivel: 'presidente' },
    });
    const sessao = await app.inject({ method: 'POST', url: '/v1/sessao', payload: { email, senha: SENHA } });
    const b = sessao.headers['set-cookie'];
    cookie = (Array.isArray(b) ? b[0]! : String(b)).split(';')[0]!;

    const ponto = await app.inject({
      method: 'POST', url: `/v1/setores/${loja.setores[0].id}/pontos`, headers: { cookie },
      payload: { nome: 'Chapa', origem: 'dvr', canal: 6, host: '192.168.1.108' },
    });
    assert.equal(ponto.statusCode, 201, ponto.body);
    zonaId = ponto.json().zonas[0].id;

    const agente = await app.inject({
      method: 'POST', url: '/v1/distribuicao/agentes', headers: { 'x-farol-admin': ADMIN },
      payload: { lojaId, nome: 'Agente do teste' },
    });
    token = agente.json().token as string;
    const ativar = await app.inject({
      method: 'POST', url: '/v1/agentes/ativar', headers: { authorization: `Bearer ${token}` },
      payload: { fingerprint: `fp-${marca}` },
    });
    assert.equal(ativar.statusCode, 200, ativar.body);
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  // ───────────────────────── criar ─────────────────────────

  it('critério sem os campos nasce perguntando sempre e avisando na primeira', async () => {
    const r = await criar(estado);
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json().porteiro, 'sempre');
    assert.equal(r.json().confirmar_em, 1);
    assert.deepEqual(await noBanco(r.json().id), { tipo: 'estado', porteiro: 'sempre', confirmar_em: 1, janelas: [] });
  });

  it('o que o console escolhe é gravado e devolvido', async () => {
    const janelas = [{ dias: [1, 2, 3, 4, 5, 6, 7], hora_ini: '20:00', hora_fim: '22:00' }];
    const r = await criar({ ...estado, nome: 'Uniforme à noite', porteiro: 'pessoa', confirmarEm: 3, janelas });
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json().porteiro, 'pessoa');
    assert.equal(r.json().confirmar_em, 3);
    assert.deepEqual(r.json().janelas, janelas);
    assert.deepEqual(await noBanco(r.json().id), { tipo: 'estado', porteiro: 'pessoa', confirmar_em: 3, janelas });

    const naLista = (await listar()).find((x) => x.id === r.json().id);
    assert.equal(naLista?.porteiro, 'pessoa', 'a lista de critérios traz o porteiro');
    assert.equal(naLista?.confirmar_em, 3, 'e a confirmação');
    assert.deepEqual(naLista?.janelas, janelas);
  });

  it('o atalho de um canal só grava do mesmo jeito', async () => {
    const r = await criarNoCanal({ ...estado, nome: 'Limpeza da chapa', porteiro: 'livre', confirmarEm: 2 });
    assert.equal(r.statusCode, 201, r.body);
    assert.deepEqual(
      { porteiro: r.json().porteiro, confirmar_em: r.json().confirmar_em },
      { porteiro: 'livre', confirmar_em: 2 },
    );
  });

  it('critério de ação aceita "quando algo se mexe"', async () => {
    const r = await criar({ ...estado, nome: 'Uso da chapa', tipo: 'acao', porteiro: 'movimento' });
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json().porteiro, 'movimento');
  });

  it('recusa o que não cabe no tipo, nas duas rotas de criação, e nada nasce', async () => {
    const antes = (await listar()).length;
    for (const rota of [criar, criarNoCanal]) {
      const p = await rota({ ...presenca, porteiro: 'pessoa' });
      assert.equal(p.statusCode, 422, p.body);
      assert.match(p.json().mensagem, /presença e contagem/);

      const m = await rota({ ...estado, nome: 'x', porteiro: 'movimento' });
      assert.equal(m.statusCode, 422, m.body);
      assert.match(m.json().mensagem, /só para critério de ação/);
    }
    assert.equal((await listar()).length, antes);
  });

  it('recusa porteiro desconhecido e confirmação fora de 1 a 10', async () => {
    const p = await criar({ ...estado, porteiro: 'silhueta' });
    assert.equal(p.statusCode, 422, p.body);
    assert.match(p.json().mensagem, /porteiro: um de sempre, pessoa, livre, movimento/);

    for (const ruim of [0, 11, 2.5, 'duas', -1]) {
      const r = await criar({ ...estado, confirmarEm: ruim });
      assert.equal(r.statusCode, 422, `${String(ruim)}: ${r.body}`);
      assert.match(r.json().mensagem, /confirmarEm: inteiro de 1 a 10/);
    }
  });

  it('a faixa de horas torta é recusada dizendo onde', async () => {
    const casos: Array<[unknown, RegExp]> = [
      ['20:00-22:00', /^janelas: lista/],
      [[{ dias: [9], hora_ini: '20:00', hora_fim: '22:00' }], /^janelas\[0\]: dia inválido/],
      [[{ dias: [], hora_ini: '20:00', hora_fim: '22:00' }], /^janelas\[0\]: dias/],
      [[{ dias: [1], hora_ini: '25:00', hora_fim: '22:00' }], /^janelas\[0\]: hora_ini/],
      [[{ dias: [1], hora_ini: '20:00', hora_fim: '8h' }], /^janelas\[0\]: hora_fim/],
      [[{ dias: [1], hora_ini: '20:00', hora_fim: '20:00' }], /^janelas\[0\]: .*mesma hora/],
    ];
    for (const [janelas, motivo] of casos) {
      const r = await criar({ ...estado, janelas });
      assert.equal(r.statusCode, 422, `${JSON.stringify(janelas)}: ${r.body}`);
      assert.match(r.json().mensagem, motivo);
    }
  });

  it('a faixa que passa da meia-noite é aceita', async () => {
    const janelas = [{ dias: [5, 6], hora_ini: '22:00', hora_fim: '02:00' }];
    const r = await criar({ ...estado, nome: 'Fechamento', janelas });
    assert.equal(r.statusCode, 201, r.body);
    assert.deepEqual(r.json().janelas, janelas);
  });

  // ───────────────────────── editar ─────────────────────────

  it('editar grava os três campos; editar SEM eles mantém', async () => {
    const id = (await criar({ ...estado, nome: 'Touca' })).json().id as string;
    const janelas = [{ dias: [1, 2, 3, 4, 5, 6, 7], hora_ini: '19:00', hora_fim: '23:00' }];

    const r = await editar(id, { porteiro: 'pessoa', confirmarEm: 5, janelas });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().porteiro, 'pessoa');
    assert.equal(r.json().confirmar_em, 5);
    assert.deepEqual(await noBanco(id), { tipo: 'estado', porteiro: 'pessoa', confirmar_em: 5, janelas });

    const so = await editar(id, { nome: 'Touca e luva' });
    assert.equal(so.statusCode, 200, so.body);
    assert.deepEqual(await noBanco(id), { tipo: 'estado', porteiro: 'pessoa', confirmar_em: 5, janelas }, 'quem só trocou o nome não mexeu no resto');
  });

  it('tirar a faixa de horas é mandar a lista vazia', async () => {
    const id = (await criar({ ...estado, nome: 'Piso', janelas: [{ dias: [1], hora_ini: '08:00', hora_fim: '09:00' }] })).json().id as string;
    const r = await editar(id, { janelas: [] });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual((await noBanco(id)).janelas, []);
  });

  it('editar recusa o que não cabe no tipo, e nada muda', async () => {
    const id = (await criar({ ...estado, nome: 'Bancada', porteiro: 'livre' })).json().id as string;

    const m = await editar(id, { porteiro: 'movimento', nome: 'Outro nome' });
    assert.equal(m.statusCode, 422, m.body);
    assert.match(m.json().mensagem, /só para critério de ação/);

    const x = await editar(id, { porteiro: 'talvez' });
    assert.equal(x.statusCode, 422, x.body);

    const c = await editar(id, { confirmarEm: 0 });
    assert.equal(c.statusCode, 422, c.body);

    assert.equal((await noBanco(id)).porteiro, 'livre');
    assert.equal((await listar()).find((r) => r.id === id)?.nome, 'Bancada', 'a edição recusada não gravou nem o nome');
  });

  it('mudar o tipo para presença exige largar o porteiro', async () => {
    const id = (await criar({ ...estado, nome: 'Avental', porteiro: 'pessoa' })).json().id as string;
    const paraPresenca = { tipo: 'presenca', parametros: { objeto: 'pessoa', minimo: 1, maximo: null } };

    const sem = await editar(id, paraPresenca);
    assert.equal(sem.statusCode, 422, sem.body);
    assert.match(sem.json().mensagem, /presença e contagem/);
    assert.deepEqual(await noBanco(id), { tipo: 'estado', porteiro: 'pessoa', confirmar_em: 1, janelas: [] }, 'recusado: nada mudou');

    const com = await editar(id, { ...paraPresenca, porteiro: 'sempre' });
    assert.equal(com.statusCode, 200, com.body);
    assert.deepEqual(await noBanco(id), { tipo: 'presenca', porteiro: 'sempre', confirmar_em: 1, janelas: [] });
  });

  it('mudar de ação para estado exige largar o "quando algo se mexe"', async () => {
    const id = (await criar({ ...estado, nome: 'Uso da fritadeira', tipo: 'acao', porteiro: 'movimento' })).json().id as string;
    const r = await editar(id, { tipo: 'estado' });
    assert.equal(r.statusCode, 422, r.body);
    const ok = await editar(id, { tipo: 'estado', porteiro: 'pessoa' });
    assert.equal(ok.statusCode, 200, ok.body);
  });

  it('presença pode esperar continuar: a confirmação vale para todo tipo', async () => {
    const r = await criar({ ...presenca, confirmarEm: 3 });
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json().confirmar_em, 3);
  });

  // ───────────────────────── o agente ─────────────────────────

  it('o agente recebe o porteiro e a confirmação, e mexer neles sobe a versão', async () => {
    const id = (await criar({ ...estado, nome: 'Uniforme do caixa', porteiro: 'pessoa', confirmarEm: 2 })).json().id as string;
    assert.equal((await editar(id, { ativa: true })).statusCode, 200);

    const r = await regraNaConfiguracao(id);
    assert.ok(r, 'o critério ligado tem de descer para o agente');
    assert.equal(r.porteiro, 'pessoa');
    assert.equal(r.confirmarEm, 2);

    const antes = await versao();
    assert.equal((await editar(id, { porteiro: 'livre', confirmarEm: 4 })).statusCode, 200);
    assert.ok((await versao()) > antes, 'sem subir a versão o agente não busca a configuração nova');

    const depois = await regraNaConfiguracao(id);
    assert.equal(depois?.porteiro, 'livre');
    assert.equal(depois?.confirmarEm, 4);
  });

  it('critério de antes da migration desce como "sempre" e 1', async () => {
    const id = (await criar({ ...estado, nome: 'Antigo' })).json().id as string;
    await editar(id, { ativa: true });
    const r = await regraNaConfiguracao(id);
    assert.equal(r?.porteiro, 'sempre');
    assert.equal(r?.confirmarEm, 1);
  });

  // ───────────────────── o resumo e as análises ─────────────────────

  it('o resumo guarda as olhadas seguradas, e as análises as devolvem', async () => {
    const id = (await criar({ ...estado, nome: 'Uniforme da chapa', porteiro: 'pessoa' })).json().id as string;
    // Hoje, na hora cheia que acabou de passar — para cair no "hoje" da tela.
    const hora = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000).toISOString();
    const linha = {
      ...CONTRATO, regraId: id, zonaId, hora, ultimaEm: null,
      capturas: 50, semCondicao: 31, emSilencio: 4, repetidas: 5, enfileiradas: 10,
      semJuiz: 0, semQuadro: 0, semCena: 0, jaJulgadas: 0,
    };
    const mandar = (l: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: '/v1/resumos', headers: { authorization: `Bearer ${token}` }, payload: { resumos: [l] } });

    const r = await mandar(linha);
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json(), { aceitos: 1, recusados: [] });
    const gravada = async () =>
      (await pool.query('select sem_condicao, em_silencio, capturas from resumo_hora where regra_id = $1', [id])).rows;
    assert.deepEqual(await gravada(), [{ sem_condicao: 31, em_silencio: 4, capturas: 50 }]);

    // O agente manda o acumulado; a nuvem substitui.
    assert.equal((await mandar({ ...linha, capturas: 60, semCondicao: 41 })).statusCode, 200);
    assert.deepEqual(await gravada(), [{ sem_condicao: 41, em_silencio: 4, capturas: 60 }]);

    const a = await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}/analises`, headers: { cookie } });
    assert.equal(a.statusCode, 200, a.body);
    const celulas = (a.json().celulas as Array<Record<string, unknown>>).filter((c) => c.regraId === id);
    assert.equal(celulas.length, 1);
    assert.equal(celulas[0]!.semCondicao, 41);
    assert.equal(celulas[0]!.emSilencio, 4);
    assert.equal(celulas[0]!.capturas, 60);
  });

  it('agente antigo, sem o campo, grava zero — e não é recusado', async () => {
    const id = (await criar({ ...estado, nome: 'Sem o campo' })).json().id as string;
    const { semCondicao: _, ...antigo } = CONTRATO;
    const r = await app.inject({
      method: 'POST', url: '/v1/resumos', headers: { authorization: `Bearer ${token}` },
      payload: { resumos: [{ ...antigo, regraId: id, zonaId }] },
    });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json(), { aceitos: 1, recusados: [] });
    const { rows } = await pool.query('select sem_condicao from resumo_hora where regra_id = $1', [id]);
    assert.deepEqual(rows, [{ sem_condicao: 0 }]);
  });

  it('o banco recusa o que a API deixasse passar', async () => {
    const id = (await criar({ ...estado, nome: 'Direto no banco' })).json().id as string;
    await assert.rejects(pool.query(`update regra set porteiro = 'silhueta' where id = $1`, [id]), /check/);
    await assert.rejects(pool.query('update regra set confirmar_em = 0 where id = $1', [id]), /check/);
    await assert.rejects(pool.query('update regra set confirmar_em = 11 where id = $1', [id]), /check/);
  });
});
