// As pessoas na planta, por minuto e sem nome (A26, P3; migration 058): o que o agente manda, a guarda curta e a conta
// que a tela mostra — o calor, o tempo em cada posto (do calor com os móveis da planta), a média por hora e o replay.
// Lê `contratos/planta-viva-minuto.json`, o mesmo que `agent/testes/test_planta_pessoas.py` usa.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

// A conta das telas (P4), importada pelo caminho: ela não importa nada (como `web/lib/planta.ts` em `planta.test.ts`).
import * as tela from '../../web/lib/planta-viva.ts';
import { criarApp } from '../src/app.js';
import { homografia, projetar as projetarNaApi } from '../src/calibracao.js';
import { caminhosDoTrecho, calorDoPeriodo, lerMinutoDaPlanta, porHora, postosDoPeriodo, type MinutoGuardado } from '../src/planta-viva.js';

const C = JSON.parse(readFileSync(new URL('../../contratos/planta-viva-minuto.json', import.meta.url), 'utf8')) as {
  minuto: Record<string, unknown>;
  chavesDoMinuto: string[];
};
const copia = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const DEPOIS = new Date('2026-10-25T22:15:00Z');

describe('a planta viva (sem banco)', () => {
  it('o minuto do contrato passa; o torto é recusado com o campo', () => {
    const r = lerMinutoDaPlanta(C.minuto, 'minutos[0]', DEPOIS);
    assert.ok(r.minuto, r.problema);
    assert.deepEqual(Object.keys(C.minuto), C.chavesDoMinuto);
    assert.equal(r.minuto.minuto, '2026-10-25T22:10:00.000Z');
    const casos: Array<[Record<string, unknown>, RegExp, Date?]> = [
      [{ minuto: '2026-10-25T22:10:00' }, /fuso/],
      [{ minuto: '2026-10-25T22:10:30+00:00' }, /segundos zerados/],
      [{}, /no futuro/, new Date('2026-10-25T22:00:00Z')],
      [{}, /mais velho que 7 dias/, new Date('2026-11-02T00:00:00Z')],
      [{ celulaM: 0.3 }, /celulaM/],
      [{ calor: [[4, 5, 3601]] }, /calor\[0\]/],
      [{ calor: [[-1, 5, 3]] }, /calor\[0\]/],
      [{ pico: 61 }, /pico/],
      [{ caminhos: [[0, []]] }, /caminhos\[0\]/],
      [{ caminhos: [[1, [[2, 1, 1], [1, 1, 1]]]] }, /em ordem/],
      [{ caminhos: [[1, [[0, 201, 1]]]] }, /em metros/],
    ];
    for (const [troca, motivo, agora] of casos) {
      const r2 = lerMinutoDaPlanta({ ...copia(C.minuto), ...troca }, 'minutos[0]', agora ?? DEPOIS);
      assert.ok(r2.problema, `devia recusar: ${motivo}`);
      assert.match(r2.problema!, motivo);
    }
    assert.equal(lerMinutoDaPlanta({ ...copia(C.minuto), caminhos: null }, 'm', DEPOIS).minuto!.caminhos, null, 'sem caminho: vale');
  });

  it('o calor do período soma, divide a célula de 0,5 m em 4, e os postos saem do calor com a folga do móvel', () => {
    const m = (min: number, celulaM: number, calor: [number, number, number][], pico = 1): MinutoGuardado => ({
      minuto: new Date(Date.UTC(2026, 9, 25, 22, min)), celulaM, calor, pico, caminhos: null,
    });
    const c = calorDoPeriodo([m(0, 0.25, [[4, 5, 30]]), m(1, 0.25, [[4, 5, 10]]), m(2, 0.5, [[10, 10, 40]])]);
    assert.deepEqual(c.calor, [[4, 5, 40], [20, 20, 10], [20, 21, 10], [21, 20, 10], [21, 21, 10]]);
    assert.equal(c.totalPessoaSegundos, 80);
    const chapa = { id: 'chapa', nome: 'Chapa', itemId: null, x: 0.5, y: 0.3, w: 1.8, h: 0.8, alt: 0.9 };
    const longe = { id: 'caixa', nome: 'Caixa', itemId: null, x: 10, y: 10, w: 1, h: 1, alt: 1 };
    // a célula (4, 5) tem o centro em (1,125; 1,375): 0,27 m na frente da chapa (que vai até y = 1,1), dentro da folga
    assert.deepEqual(postosDoPeriodo(c.calor, c.celulaM, [chapa, longe]), [{ id: 'chapa', nome: 'Chapa', segundos: 40 }]);
    const horas = porHora([m(0, 0.25, [[1, 1, 1800]], 2), m(59, 0.25, [[1, 1, 1800]], 3)]);
    assert.deepEqual(horas, [{ hora: '2026-10-25T22:00:00.000Z', mediaDePessoas: 1, pico: 3, minutos: 2 }]);
  });

  it('o replay: os caminhos de vários minutos com a hora de cada ponto', () => {
    const base: MinutoGuardado = { minuto: new Date('2026-10-25T22:10:00Z'), celulaM: 0.25, calor: [], pico: 1, caminhos: [[1, [[0, 1, 1], [59, 2, 2]]]] };
    const seguinte: MinutoGuardado = { ...base, minuto: new Date('2026-10-25T22:11:00Z'), caminhos: [[1, [[0, 2.1, 2]]], [2, [[5, 4, 4]]]] };
    assert.deepEqual(caminhosDoTrecho([seguinte, base]), [
      { numero: 1, pontos: [['2026-10-25T22:10:00.000Z', 1, 1], ['2026-10-25T22:10:59.000Z', 2, 2], ['2026-10-25T22:11:00.000Z', 2.1, 2]] },
      { numero: 2, pontos: [['2026-10-25T22:11:05.000Z', 4, 4]] },
    ]);
  });
});

describe('a conta das telas da planta viva (web/lib/planta-viva.ts)', () => {
  const CAL = JSON.parse(readFileSync(new URL('../../contratos/calibracao-da-camera.json', import.meta.url), 'utf8')) as {
    pares: Array<{ img: [number, number]; piso: [number, number] }>;
    testes: Array<{ img: [number, number]; piso: [number, number] }>;
  };

  it('o ponto da imagem cai no mesmo lugar do chão que na conta do servidor', () => {
    const h = homografia(CAL.pares)!;
    for (const t of CAL.testes) {
      const naTela = tela.projetar(h, t.img)!;
      const naApi = projetarNaApi(h, t.img)!;
      assert.ok(Math.hypot(naTela[0] - naApi[0], naTela[1] - naApi[1]) < 1e-9);
    }
    assert.equal(tela.projetar(h, [0.5, -0.4]), null, 'acima do horizonte');
    assert.equal(tela.projetar([1, 2, 3], [0.5, 0.5]), null, 'homografia torta');
  });

  it('o piso coberto: a fração da grade dentro de alguma área, e os quadrados que nenhuma vê', () => {
    const amb = [{ x: 0, y: 0, w: 2, h: 1 }];
    const metadeEsquerda: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const r = tela.coberturaDoPiso(amb, [metadeEsquerda]);
    assert.equal(r.parte, 0.5);
    assert.equal(r.semVer.length, 16, '2 × 1 m em quadrados de 25 cm: 32, metade sem ver');
    assert.ok(r.semVer.every(([x]) => x >= 1), 'os que ninguém vê são os da direita');
    assert.equal(tela.coberturaDoPiso(amb, []).parte, 0);
    assert.equal(tela.coberturaDoPiso([], [metadeEsquerda]).parte, 0, 'sem chão desenhado');
  });

  it('a cor do calor, a duração, a régua', () => {
    assert.deepEqual(tela.corDoCalor(1), { cor: 'ketchup', opacidade: 0.95 });
    assert.deepEqual(tela.corDoCalor(0.5).cor, 'pao');
    assert.deepEqual(tela.corDoCalor(0.1).cor, 'mostarda');
    assert.deepEqual([tela.duracao(40), tela.duracao(2160), tela.duracao(15_480)], ['40 s', '36 min', '4 h 18 min']);
    assert.equal(tela.reguaEmCm({ erroConferidoM: 0.026, erroMedioM: 0.019 }), 3, 'o conferido vale mais que o médio');
    assert.equal(tela.reguaEmCm({ erroConferidoM: null, erroMedioM: 0.019 }), 2);
    assert.equal(tela.reguaEmCm({ erroConferidoM: null, erroMedioM: null }), null);
  });

  it('o replay: onde cada caminho está no instante, o rastro de 30 s, e quem sumiu há mais de 3 s some', () => {
    const t0 = Date.parse('2026-10-25T22:10:00Z');
    const iso = (s: number) => new Date(t0 + s * 1000).toISOString();
    const caminhos = [
      { numero: 1, pontos: [[iso(0), 1, 1], [iso(10), 2, 1], [iso(40), 3, 1]] as Array<[string, number, number]> },
      { numero: 2, pontos: [[iso(0), 5, 5]] as Array<[string, number, number]> },
    ];
    assert.deepEqual(tela.noInstante(caminhos, t0 + 2000), [
      { numero: 1, agora: [1, 1], rastro: [[1, 1]] },
      { numero: 2, agora: [5, 5], rastro: [[5, 5]] },
    ]);
    assert.deepEqual(tela.noInstante(caminhos, t0 + 12_000).map((f) => [f.numero, f.agora]), [[1, [2, 1]]], 'o 2 sumiu há 12 s; o 1 está no ponto de 10 s');
    assert.deepEqual(tela.noInstante(caminhos, t0 + 40_000)[0]!.rastro, [[2, 1], [3, 1]], 'o rastro são os últimos 30 s');
    assert.deepEqual(tela.noInstante(caminhos, t0 + 41_000)[0]!.rastro, [[3, 1]], 'o ponto de 31 s atrás já saiu do rastro');
  });
});

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-planta-viva-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-planta-viva';
const SENHA = 'uma senha longa o bastante';

describe('a planta viva (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  let lojaId = '';
  let setorId = '';
  let cookie = '';
  let cookieSupervisao = '';
  let cookieExecucao = '';
  let cookieVizinho = '';
  let token = '';

  async function entrar(tenantId: string, email: string, nivel: string) {
    await app.inject({
      method: 'POST', url: '/v1/distribuicao/usuarios', headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId, nome: 'X', email, senha: SENHA, nivel },
    });
    const r = await app.inject({ method: 'POST', url: '/v1/sessao', payload: { email, senha: SENHA } });
    const b = r.headers['set-cookie'];
    return (Array.isArray(b) ? b[0]! : String(b)).split(';')[0]!;
  }
  /** O começo do minuto de N minutos atrás. */
  const minutoAtras = (n: number) => new Date(Math.floor((Date.now() - n * 60_000) / 60_000) * 60_000).toISOString();
  const mandar = (minutos: unknown[]) =>
    app.inject({ method: 'POST', url: '/v1/planta-viva/minutos', headers: { authorization: `Bearer ${token}` }, payload: { minutos } });
  const ler = (consulta = '', comCookie = cookie) =>
    app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}/planta-viva${consulta}`, headers: comCookie ? { cookie: comCookie } : {} });

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    app = criarApp(pool, { logger: false });
    await app.ready();
    const conta = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome: marca }, loja: { nome: 'Matriz' }, setores: [{ nome: 'Cozinha' }] },
    })).json();
    lojaId = conta.loja.id;
    setorId = conta.setores[0].id;
    cookie = await entrar(conta.tenantId, `dono-${marca}@e.com`, 'presidente');
    cookieSupervisao = await entrar(conta.tenantId, `sup-${marca}@e.com`, 'supervisao');
    cookieExecucao = await entrar(conta.tenantId, `exe-${marca}@e.com`, 'execucao');
    const vizinha = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome: `${marca}-vizinha` }, loja: { nome: 'Outra' }, setores: [{ nome: 'Salão' }] },
    })).json();
    cookieVizinho = await entrar(vizinha.tenantId, `dono-${marca}-v@e.com`, 'presidente');
    const a = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/agentes', headers: { 'x-farol-admin': ADMIN }, payload: { lojaId, nome: 'PC da loja' },
    })).json();
    const ativar = await app.inject({
      method: 'POST', url: '/v1/agentes/ativar', headers: { authorization: `Bearer ${a.token}` }, payload: { fingerprint: `fp-${marca}` },
    });
    assert.equal(ativar.statusCode, 200, ativar.body);
    token = a.token;
    const planta = await app.inject({
      method: 'PUT', url: `/v1/lojas/${lojaId}/planta`, headers: { cookie },
      payload: {
        versao: null,
        planta: {
          ambientes: [{ id: 'coz', nome: 'Cozinha', setorId, x: 0, y: 0, w: 8, h: 6 }],
          moveis: [{ id: 'chapa', nome: 'Chapa', itemId: null, x: 0.5, y: 0.3, w: 1.8, h: 0.8, alt: 0.9 }],
          cameras: [],
        },
      },
    });
    assert.equal(planta.statusCode, 200, planta.body);
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  it('o agente manda; o mesmo minuto de novo troca o de antes; o torto é recusado', async () => {
    const um = { ...copia(C.minuto), minuto: minutoAtras(10) };
    const dois = { ...copia(C.minuto), minuto: minutoAtras(9), pico: 1, calor: [[4, 5, 20]] };
    const r = await mandar([um, dois]);
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json(), { aceitos: 2 });
    assert.deepEqual((await mandar([{ ...dois, pico: 3 }])).json(), { aceitos: 1 });
    const linhas = (await pool.query('select pico from planta_minuto where loja_id = $1 order by minuto', [lojaId])).rows;
    assert.deepEqual(linhas.map((l) => l.pico), [2, 3]);
    const torta = await mandar([{ ...um, pico: 99 }]);
    assert.equal(torta.statusCode, 422);
    assert.match(torta.body, /pico/);
    assert.equal((await mandar(Array.from({ length: 121 }, () => um))).statusCode, 413);
    assert.equal((await app.inject({ method: 'POST', url: '/v1/planta-viva/minutos', payload: { minutos: [] } })).statusCode, 401);
  });

  it('a guarda curta: o caminho some em 7 dias, o minuto em 90', async () => {
    const agente = (await pool.query('select a.id, l.tenant_id from agente a join loja l on l.id = a.loja_id where a.loja_id = $1', [lojaId])).rows[0];
    for (const dias of [8, 91]) {
      await pool.query(
        `insert into planta_minuto (loja_id, minuto, tenant_id, agente_id, celula_m, calor, pico, caminhos)
         values ($1, date_trunc('minute', now()) - make_interval(days => $2), $3, $4, 0.25, '[]', 1, '[[1, [[0, 1, 1]]]]')`,
        [lojaId, dias, agente.tenant_id, agente.id],
      );
    }
    await mandar([{ ...copia(C.minuto), minuto: minutoAtras(8) }]);
    const velhos = (await pool.query(
      `select extract(day from now() - minuto)::int as dias, caminhos from planta_minuto where loja_id = $1 and minuto < now() - interval '1 day'`,
      [lojaId],
    )).rows;
    assert.deepEqual(velhos.map((l) => [l.dias, l.caminhos]), [[8, null]], 'o de 8 dias sem caminho; o de 91 apagado');
  });

  it('a leitura: o calor, os postos e a média por hora; o replay só no trecho curto e só para quem configura', async () => {
    const r = await ler(`?de=${encodeURIComponent(minutoAtras(30))}&ate=${encodeURIComponent(new Date().toISOString())}`);
    assert.equal(r.statusCode, 200, r.body);
    const d = r.json();
    assert.equal(d.minutos, 3);
    assert.deepEqual(d.postos.map((p: { id: string }) => p.id), ['chapa']);
    assert.ok(d.porHora.length >= 1 && d.pico === 3);
    assert.deepEqual(d.caminhos.map((c: { numero: number }) => c.numero), [1, 2], 'presidente, 30 min: com o replay');
    // a tela lê a resposta DE VERDADE: no instante do 1º ponto do caminho 1, ele está lá
    const primeiro = Date.parse(d.caminhos[0].pontos[0][0]);
    assert.deepEqual(tela.noInstante(d.caminhos, primeiro).find((f) => f.numero === 1)?.agora, [d.caminhos[0].pontos[0][1], d.caminhos[0].pontos[0][2]]);
    const sup = (await ler(`?de=${encodeURIComponent(minutoAtras(30))}`, cookieSupervisao)).json();
    assert.equal(sup.caminhos, null, 'supervisão vê o calor e os postos, não o caminho de cada um');
    assert.ok(sup.calor.length > 0);
    const longo = (await ler(`?de=${encodeURIComponent(minutoAtras(180))}`)).json();
    assert.equal(longo.caminhos, null, 'mais de 60 min: sem replay');
    assert.equal((await ler('', cookieExecucao)).statusCode, 403);
    assert.equal((await ler('', cookieVizinho)).statusCode, 404);
    assert.equal((await ler('', '')).statusCode, 401);
    assert.equal((await ler('?de=ontem')).statusCode, 422);
    assert.equal((await ler(`?de=${encodeURIComponent(new Date(Date.now() - 40 * 86_400_000).toISOString())}`)).statusCode, 422);
  });
});
