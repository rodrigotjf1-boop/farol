// A calibração da câmera pelos pontos do piso, na nuvem (A26, P1): a mesma conta do agente, pelo mesmo contrato.
//
// `contratos/calibracao-da-camera.json` vem de uma câmera SIMULADA (`agent/ferramentas/contrato_calibracao.py`): os
// pares e os testes são a geometria de verdade; os erros com ruído e a área vista são os da conta do agente — esta
// tem de dar os mesmos números.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import {
  LIMITES_DA_CALIBRACAO,
  areaVista,
  errosDaCalibracao,
  homografia,
  lerCalibracao,
  projetar,
  type Par,
  type Pt,
} from '../src/calibracao.js';

type Contrato = {
  pares: Par[];
  testes: Par[];
  toleranciaM: number;
  bordaDeCimaAindaNoChao: Pt[];
  comRuido: {
    pares: Par[];
    erros: {
      porPar: number[];
      medioM: number;
      maximoM: number;
      conferido: { porPar: (number | null)[]; medianaM: number; maximoM: number };
    };
  };
  area: Pt[];
  degenerados: Record<'numaReta' | 'tresDeQuatroNumaReta', Par[]>;
};
const C = JSON.parse(readFileSync(new URL('../../contratos/calibracao-da-camera.json', import.meta.url), 'utf8')) as Contrato;
const TOL = C.toleranciaM;
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe('a calibração da câmera pelos pontos do piso', () => {
  it('com os pares exatos, cada ponto da imagem cai onde a geometria diz', () => {
    const h = homografia(C.pares);
    assert.ok(h);
    assert.ok(Math.abs(Math.hypot(...h) - 1) < 1e-9, 'norma 1');
    for (const t of C.testes) {
      const q = projetar(h, t.img);
      assert.ok(q && dist(q, t.piso) < TOL, `${JSON.stringify(t)} → ${JSON.stringify(q)}`);
    }
    for (const p of C.bordaDeCimaAindaNoChao) assert.ok(projetar(h, p));
    const e = errosDaCalibracao(C.pares, h);
    assert.ok(e.maximoM <= TOL && e.conferido !== null && e.conferido.maximoM <= TOL);
  });

  it('4 pares bastam; com 4 não há erro conferido', () => {
    const quatro = [0, 2, 6, 8].map((i) => C.pares[i]!);
    const h = homografia(quatro);
    assert.ok(h);
    for (const t of C.testes) assert.ok(dist(projetar(h, t.img)!, t.piso) < 5 * TOL);
    assert.equal(errosDaCalibracao(quatro, h).conferido, null);
  });

  it('com ruído, os erros são os mesmos do agente', () => {
    const h = homografia(C.comRuido.pares)!;
    const e = errosDaCalibracao(C.comRuido.pares, h);
    const esperado = C.comRuido.erros;
    assert.deepEqual(e.porPar, esperado.porPar);
    assert.deepEqual([e.medioM, e.maximoM], [esperado.medioM, esperado.maximoM]);
    assert.deepEqual(e.conferido, esperado.conferido);
  });

  it('a área vista é a mesma do agente, fecha em volta do chão marcado e para no alcance', () => {
    const h = homografia(C.pares)!;
    const area = areaVista(h, C.pares);
    assert.equal(area.length, C.area.length);
    area.forEach((p, i) => assert.ok(dist(p, C.area[i]!) <= 0.0011, `vértice ${i}: ${JSON.stringify(p)} × ${JSON.stringify(C.area[i])}`));
    const centro: Pt = [C.pares.reduce((s, p) => s + p.piso[0], 0) / C.pares.length, C.pares.reduce((s, p) => s + p.piso[1], 0) / C.pares.length];
    const longe = Math.max(...area.map((p) => dist(p, centro)));
    assert.ok(longe > LIMITES_DA_CALIBRACAO.alcanceDaArea - 0.05 && longe <= LIMITES_DA_CALIBRACAO.alcanceDaArea + 0.01);
  });

  it('pontos numa reta, ou três de quatro numa reta, ou menos de 4, não dão calibração', () => {
    assert.equal(homografia(C.degenerados.numaReta), null);
    assert.equal(homografia(C.degenerados.tresDeQuatroNumaReta), null);
    assert.equal(homografia(C.pares.slice(0, 3)), null);
    assert.equal(projetar(homografia(C.pares)!, [0.5, -0.4]), null, 'acima do horizonte não cai no piso');
  });

  it('o que chega da tela: conferido com o motivo, e a conta pronta', () => {
    const ok = lerCalibracao({ pares: C.comRuido.pares }, 60);
    assert.ok(ok.calibracao, ok.problema);
    assert.equal(ok.calibracao.pares.length, 12);
    assert.deepEqual(ok.calibracao.erros.conferido, C.comRuido.erros.conferido);
    assert.ok(ok.calibracao.area.length > 10);
    const casos: Array<[unknown, RegExp]> = [
      [null, /pares: a lista/],
      [{ pares: C.pares.slice(0, 3) }, /pelo menos 4/],
      [{ pares: Array.from({ length: 41 }, () => C.pares[0]) }, /no máximo 40/],
      [{ pares: [{ img: [1.2, 0.5], piso: [1, 1] }, ...C.pares.slice(1)] }, /pares\[0\]\.img/],
      [{ pares: [{ img: [0.5, 0.5], piso: [-1, 1] }, ...C.pares.slice(1)] }, /pares\[0\]\.piso/],
      [{ pares: [{ img: [0.5, 0.5], piso: [61, 1] }, ...C.pares.slice(1)] }, /de 0 a 60/],
      [{ pares: [...C.pares.slice(0, 5), { img: [C.pares[0]!.img[0] + 0.001, C.pares[0]!.img[1]], piso: [9, 9] }] }, /mesmo ponto que pares\[0\]/],
      [{ pares: C.degenerados.numaReta }, /quase numa reta/],
    ];
    for (const [corpo, motivo] of casos) {
      const r = lerCalibracao(corpo, 60);
      assert.ok(r.problema, `devia recusar: ${motivo}`);
      assert.match(r.problema, motivo);
    }
  });
});

// ───────────────── com banco ─────────────────

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-calibracao-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-calibracao';
const SENHA = 'uma senha longa o bastante';

describe('as rotas da calibração (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  let lojaId = '';
  let setorId = '';
  let cookie = '';
  let cookieSupervisao = '';
  let cookieVizinho = '';
  let token = '';
  let canal = '';
  let canais = 0;

  async function entrar(tenantId: string, email: string, nivel: string) {
    await app.inject({
      method: 'POST', url: '/v1/distribuicao/usuarios', headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId, nome: 'X', email, senha: SENHA, nivel },
    });
    const r = await app.inject({ method: 'POST', url: '/v1/sessao', payload: { email, senha: SENHA } });
    const b = r.headers['set-cookie'];
    return (Array.isArray(b) ? b[0]! : String(b)).split(';')[0]!;
  }
  async function canalNovo(nome: string) {
    canais += 1;
    const r = await app.inject({
      method: 'POST', url: `/v1/setores/${setorId}/pontos`, headers: { cookie },
      payload: { nome, origem: 'dvr', canal: canais, host: '192.168.1.108' },
    });
    assert.equal(r.statusCode, 201, r.body);
    return r.json().id as string;
  }
  const url = (ponto = canal, loja = lojaId) => `/v1/lojas/${loja}/calibracoes/${ponto}`;
  const pedir = (method: 'GET' | 'PUT' | 'POST' | 'DELETE', caminho: string, payload?: object, comCookie = cookie) =>
    app.inject({ method, url: caminho, headers: comCookie ? { cookie: comCookie } : {}, ...(payload ? { payload } : {}) });
  const versaoDaConfig = async () => (await pool.query('select config_versao from loja where id = $1', [lojaId])).rows[0].config_versao as number;
  const configuracao = async () =>
    (await app.inject({ method: 'GET', url: '/v1/agentes/configuracao', headers: { authorization: `Bearer ${token}` } })).json() as {
      pontos: { id: string; calibracao: { homografia: number[]; erroM: number; versao: number } | null }[];
    };

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
    canal = await canalNovo('Canto da cozinha');
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  it('conferir não salva; salvar guarda a conta, com versão, e o agente recebe', async () => {
    assert.equal((await pedir('GET', url())).statusCode, 404, 'ainda não calibrado');
    const conferida = await pedir('POST', `${url()}/conferir`, { pares: C.comRuido.pares });
    assert.equal(conferida.statusCode, 200, conferida.body);
    assert.deepEqual(conferida.json().erros.conferido, C.comRuido.erros.conferido);
    assert.equal((await pool.query('select count(*)::int n from camera_calibracao where ponto_id = $1', [canal])).rows[0].n, 0);

    const antes = await versaoDaConfig();
    const salva = await pedir('PUT', url(), { versao: null, pares: C.comRuido.pares });
    assert.equal(salva.statusCode, 200, salva.body);
    const s = salva.json();
    assert.deepEqual([s.versao, s.pares.length, s.erroConferidoM, s.erroMedioM], [1, 12, C.comRuido.erros.conferido.medianaM, C.comRuido.erros.medioM]);
    assert.ok(await versaoDaConfig() > antes, 'a configuração do agente sobe de versão');
    const noAgente = (await configuracao()).pontos.find((p) => p.id === canal)!.calibracao!;
    assert.deepEqual(noAgente, { homografia: s.homografia, erroM: C.comRuido.erros.conferido.medianaM, versao: 1 });

    const lista = (await pedir('GET', `/v1/lojas/${lojaId}/calibracoes`)).json().calibracoes;
    assert.deepEqual(lista.map((c: { pontoId: string; quantosPontos: number }) => [c.pontoId, c.quantosPontos]), [[canal, 12]]);
  });

  it('salvar por cima pede a versão que leu; a outra pessoa no meio leva 409', async () => {
    const atual = (await pedir('GET', url())).json();
    assert.equal((await pedir('PUT', url(), { versao: null, pares: C.pares })).statusCode, 409, 'já tem: sem a versão, não grava');
    const r = await pedir('PUT', url(), { versao: atual.versao, pares: C.pares });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().versao, atual.versao + 1);
    assert.equal((await pedir('PUT', url(), { versao: atual.versao, pares: C.comRuido.pares })).statusCode, 409, 'a versão velha');
    assert.equal((await configuracao()).pontos.find((p) => p.id === canal)!.calibracao!.versao, atual.versao + 1);
  });

  it('quem pode o quê: supervisão vê e não mexe; outra conta não acha; sem sessão, 401', async () => {
    assert.equal((await pedir('GET', url(), undefined, cookieSupervisao)).statusCode, 200);
    for (const [metodo, caminho] of [['PUT', url()], ['POST', `${url()}/conferir`], ['DELETE', url()]] as const) {
      assert.equal((await pedir(metodo, caminho, { pares: C.pares, versao: 1 }, cookieSupervisao)).statusCode, 403, `${metodo} da supervisão`);
    }
    assert.equal((await pedir('GET', url(), undefined, cookieVizinho)).statusCode, 404);
    assert.equal((await pedir('GET', `/v1/lojas/${lojaId}/calibracoes`, undefined, cookieVizinho)).statusCode, 404);
    assert.equal((await pedir('GET', url(), undefined, '')).statusCode, 401);
    assert.equal((await pedir('PUT', url(randomUUID()), { versao: null, pares: C.pares })).statusCode, 404, 'canal de fora da loja');
    assert.equal((await pedir('PUT', url(), { versao: 'um', pares: C.pares })).statusCode, 422);
    const torta = await pedir('PUT', url(), { versao: 2, pares: C.degenerados.numaReta });
    assert.equal(torta.statusCode, 422);
    assert.match(torta.body, /quase numa reta/);
  });

  it('tirar a calibração (a câmera foi mexida) e o canal excluído que leva a dele', async () => {
    const antes = await versaoDaConfig();
    assert.equal((await pedir('DELETE', url())).statusCode, 204);
    assert.ok(await versaoDaConfig() > antes);
    assert.equal((await configuracao()).pontos.find((p) => p.id === canal)!.calibracao, null);
    assert.equal((await pedir('DELETE', url())).statusCode, 404);

    const outro = await canalNovo('Balcão');
    assert.equal((await pedir('PUT', url(outro), { versao: null, pares: C.pares })).statusCode, 200);
    assert.equal((await app.inject({ method: 'DELETE', url: `/v1/pontos/${outro}`, headers: { cookie } })).statusCode, 200);
    assert.equal((await pedir('GET', `/v1/lojas/${lojaId}/calibracoes`)).json().calibracoes.length, 0, 'o canal excluído não aparece');
  });
});
