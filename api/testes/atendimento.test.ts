// O atendimento na planta (28/10/2026; protótipo aprovado em 29/10): a espera em cada área de medida e quem entra e sai
// por cada porta, contados dos caminhos que o agente manda a cada minuto (`api/src/atendimento.ts`), e a rota que a aba
// Atendimento lê (`GET /v1/lojas/:id/planta-viva/atendimento`).

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

// a conta da tela (como `planta-viva.test.ts`): importada pelo caminho, ela não importa nada
import * as tela from '../../web/lib/planta-viva.ts';
import { criarApp } from '../src/app.js';
import { ATENDIMENTO, atendimentoDoPeriodo, caminhosDosMinutos, esperasNoCaminho, type EsperaDaArea, type MinutoComCaminhos, type PortaDaArea } from '../src/atendimento.js';
import type { Area } from '../src/planta.js';

const FILA: Area = { id: 'fila', nome: 'Fila do balcão', tipo: 'espera', x: 0, y: 0, w: 2, h: 2 };
const PORTA: Area = { id: 'porta', nome: 'Porta dos entregadores', tipo: 'porta', x: 10, y: 0, w: 1, h: 1 };
const T0 = Date.parse('2026-10-28T22:00:00Z');

/** Um caminho a 1 ponto por segundo: cada trecho é [segundos, x, y] (parado ali por tantos segundos). */
function caminho(inicioS: number, trechos: [number, number, number][]): [number, number, number][] {
  const pts: [number, number, number][] = [];
  let t = inicioS;
  for (const [s, x, y] of trechos) for (let k = 0; k < s; k += 1) pts.push([T0 + (t++) * 1000, x, y]);
  return pts;
}
/** Os caminhos em minutos, como o agente manda (o número do caminho, o segundo do minuto, x, y). */
function minutos(caminhos: [number, [number, number, number][]][]): MinutoComCaminhos[] {
  const por = new Map<number, Map<number, [number, number, number][]>>();
  for (const [n, pts] of caminhos) {
    for (const [ms, x, y] of pts) {
      const m = Math.floor(ms / 60_000) * 60_000;
      const doMinuto = por.get(m) ?? new Map();
      doMinuto.set(n, [...(doMinuto.get(n) ?? []), [Math.round((ms - m) / 1000), x, y]]);
      por.set(m, doMinuto);
    }
  }
  return [...por.entries()].map(([m, cs]) => ({ minuto: new Date(m), caminhos: [...cs.entries()] }));
}
const DE = new Date(T0);
const ATE = new Date(T0 + 3_600_000);

describe('o atendimento: a conta (sem banco)', () => {
  it('espera: de quando entra até quando sai; sair por até 4 s não termina; quem fica menos de 5 s só passou', () => {
    const c = caminho(0, [[3, 5, 5], [40, 1, 1], [3, 5, 5], [20, 1, 1], [10, 5, 5]]);
    assert.deepEqual(esperasNoCaminho(c, FILA).map(([a, b]) => [(a - T0) / 1000, (b - T0) / 1000]), [[3, 65]], 'saiu 3 s e voltou: a mesma espera');
    const longe = caminho(0, [[10, 1, 1], [6, 5, 5], [10, 1, 1]]);
    assert.equal(esperasNoCaminho(longe, FILA).length, 2, 'saiu 6 s: duas esperas');
    const [fila] = atendimentoDoPeriodo(
      minutos([[1, c], [2, caminho(100, [[4, 1, 1], [5, 5, 5]])], [3, caminho(200, [[400, 1.5, 1.5]])]]),
      [FILA], DE, ATE,
    ) as [EsperaDaArea];
    assert.deepEqual(fila.visitas.map(([, s]) => s), [63, 400], 'quem passou 4 s não conta');
    assert.equal(fila.pessoas, 2);
    assert.equal(fila.medianaS, 400);
    assert.equal(fila.maiorS, 400);
    assert.equal(fila.acimaDe5Min, 1);
    assert.deepEqual(fila.porHora, [{ hora: '2026-10-28T22:00:00.000Z', pessoas: 2, medianaS: 400 }]);
    assert.equal(fila.agora, null, 'sem ao vivo: nulo');
  });

  it('porta: o caminho que começa nela entrou, o que termina nela saiu; o tempo na loja é o caminho inteiro', () => {
    const entregador = caminho(0, [[3, 10.5, 0.5], [200, 3, 3], [4, 10.5, 0.5]]);
    const soEntrou = caminho(300, [[2, 10.5, 0.5], [30, 5, 5]]);
    const soSaiu = caminho(400, [[30, 5, 5], [2, 10.5, 0.5]]);
    const [porta] = atendimentoDoPeriodo(minutos([[1, entregador], [2, soEntrou], [3, soSaiu]]), [PORTA], DE, ATE, {
      fimDosDados: ATE,
    }) as [PortaDaArea];
    assert.deepEqual(porta.entradas.map((t) => (Date.parse(t) - T0) / 1000), [0, 300]);
    assert.deepEqual(porta.saidas.map((t) => (Date.parse(t) - T0) / 1000), [206, 431]);
    assert.deepEqual(porta.naLoja, { quantos: 1, medianaS: 206 });
    assert.deepEqual(porta.porHora, [{ hora: '2026-10-28T22:00:00.000Z', entradas: 2, saidas: 2 }]);
  });

  it('a saída que termina perto do fim do que se leu ainda não conta (a pessoa pode estar só piscando)', () => {
    const c = caminho(0, [[30, 5, 5], [3, 10.5, 0.5]]); // o último ponto no segundo 32
    assert.equal(ATENDIMENTO.fimRecenteS, 15);
    const fim = new Date(T0 + 40_000); // 8 s depois do último ponto: pode ser só um piscar
    const [p] = atendimentoDoPeriodo(minutos([[1, c]]), [PORTA], DE, ATE, { fimDosDados: fim }) as [PortaDaArea];
    assert.deepEqual(p.saidas, []);
    const [depois] = atendimentoDoPeriodo(minutos([[1, c]]), [PORTA], DE, ATE, { fimDosDados: new Date(fim.getTime() + 20_000) }) as [PortaDaArea];
    assert.equal(depois.saidas.length, 1);
  });

  it('só conta o que aconteceu no período; o mesmo número horas depois é outro caminho (o número é do dia)', () => {
    const antes = caminho(-120, [[60, 1, 1]]);
    const dentro = caminho(60, [[20, 1, 1]]);
    const [fila] = atendimentoDoPeriodo(minutos([[7, antes], [8, dentro]]), [FILA], DE, ATE) as [EsperaDaArea];
    assert.deepEqual(fila.visitas.map(([, s]) => s), [20], 'a espera que começou antes do período fica de fora');
    const mesmoNumero = [...caminho(0, [[10, 1, 1]]), ...caminho(3 * 3600, [[10, 1, 1]])];
    assert.equal(caminhosDosMinutos(minutos([[5, mesmoNumero]])).length, 2);
  });

  it('agora: quantos estão dentro de cada área, pelo ao vivo', () => {
    const r = atendimentoDoPeriodo([], [FILA, PORTA], DE, ATE, { agoraPessoas: [{ x: 1, y: 1 }, { x: 1.5, y: 0.2 }, { x: 10.2, y: 0.4 }, { x: 6, y: 6 }] });
    assert.deepEqual(r.map((a) => a.agora), [2, 1]);
  });
});

describe('o atendimento: a conta da tela (web/lib/planta-viva.ts)', () => {
  const FUSO = 'America/Sao_Paulo'; // −03:00, sem horário de verão
  const hora = (iso: string) => Date.parse(iso);
  const noite = [{ dias: [1, 2, 3, 4, 7], hora_ini: '19:00', hora_fim: '03:00' }, { dias: [5, 6], hora_ini: '19:00', hora_fim: '05:45' }];

  it('o expediente de agora e o anterior, pelo horário da loja que passa da meia-noite', () => {
    // quinta, 29/10/2026, 01:30 na loja (04:30 UTC): o expediente de quarta 19h ainda vale
    const aberta = tela.expedientes(noite, FUSO, hora('2026-10-29T04:30:00Z'));
    assert.deepEqual(aberta.este, [hora('2026-10-28T22:00:00Z'), hora('2026-10-29T04:30:00Z')], 'de quarta 19h até agora');
    assert.deepEqual(aberta.anterior, [hora('2026-10-27T22:00:00Z'), hora('2026-10-28T06:00:00Z')], 'a terça inteira, 19h às 3h');
    // quinta 15h (fechada): "este" é o último que terminou
    const fechada = tela.expedientes(noite, FUSO, hora('2026-10-29T18:00:00Z'));
    assert.deepEqual(fechada.este, [hora('2026-10-28T22:00:00Z'), hora('2026-10-29T06:00:00Z')]);
    // sábado 03h: a sexta vai até 05:45
    const sexta = tela.expedientes(noite, FUSO, hora('2026-10-31T06:00:00Z'));
    assert.deepEqual(sexta.este, [hora('2026-10-30T22:00:00Z'), hora('2026-10-31T06:00:00Z')]);
    // sem horário cadastrado: hoje desde a meia-noite da loja, e ontem
    const sem = tela.expedientes([], FUSO, hora('2026-10-29T04:30:00Z'));
    assert.deepEqual(sem.este, [hora('2026-10-29T03:00:00Z'), hora('2026-10-29T04:30:00Z')]);
    assert.deepEqual(sem.anterior, [hora('2026-10-28T03:00:00Z'), hora('2026-10-29T03:00:00Z')]);
  });

  it('o relógio da espera e as câmeras que veem a área', () => {
    assert.deepEqual([tela.minSeg(5), tela.minSeg(157), tela.minSeg(3725), tela.minSeg(-3)], ['0:05', '2:37', '1:02:05', '0:00']);
    const chao: [number, number][] = [[0, 0], [3, 0], [3, 3], [0, 3]];
    assert.equal(tela.camerasQueVeem({ x: 1, y: 1, w: 1, h: 1 }, [chao, chao.map(([x, y]) => [x + 10, y] as [number, number])]), 1, 'o centro dentro do chão de uma');
    assert.equal(tela.camerasQueVeem({ x: 5, y: 5, w: 1, h: 1 }, [chao]), 0);
    assert.equal(tela.ESPERA_LONGA_S, ATENDIMENTO.esperaLongaS, 'a espera longa é a mesma dos dois lados');
  });
});

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-atendimento-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-atendimento';
const SENHA = 'uma senha longa o bastante';

describe('o atendimento: a rota (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
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
  const ler = (consulta = '', comCookie = cookie) =>
    app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}/planta-viva/atendimento${consulta}`, headers: comCookie ? { cookie: comCookie } : {} });
  const salvarPlanta = async (areas: unknown) => {
    const v = (await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}/planta`, headers: { cookie } })).json().versao ?? null;
    return app.inject({
      method: 'PUT', url: `/v1/lojas/${lojaId}/planta`, headers: { cookie },
      payload: { versao: v, planta: { ambientes: [{ id: 'loja', nome: 'Loja', setorId, x: 0, y: 0, w: 12, h: 8 }], moveis: [], cameras: [], areas } },
    });
  };

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    app = criarApp(pool, { logger: false });
    await app.ready();
    const conta = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome: marca }, loja: { nome: 'Matriz' }, setores: [{ nome: 'Salão' }] },
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
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  it('sem áreas na planta: lista vazia; quem pode e quem não pode', async () => {
    const vazia = await ler();
    assert.equal(vazia.statusCode, 200, vazia.body);
    assert.deepEqual(vazia.json().areas, []);
    assert.equal((await ler('', cookieSupervisao)).statusCode, 200, 'supervisão acompanha: é agregado, sem o caminho de cada um');
    assert.equal((await ler('', cookieExecucao)).statusCode, 403);
    assert.equal((await ler('', cookieVizinho)).statusCode, 404);
    assert.equal((await ler('', '')).statusCode, 401);
    assert.equal((await ler('?de=ontem')).statusCode, 422);
    assert.equal((await ler(`?de=${encodeURIComponent(new Date(Date.now() - 8 * 86_400_000).toISOString())}`)).statusCode, 422, 'mais de 7 dias');
  });

  it('com as áreas: a espera e a porta saem dos caminhos que o agente mandou', async () => {
    const r = await salvarPlanta([FILA, PORTA]);
    assert.equal(r.statusCode, 200, r.body);
    // 20 minutos atrás: um cliente espera 90 s na fila; um entregador entra pela porta, anda e sai 3 min depois
    const inicio = Math.floor((Date.now() - 20 * 60_000) / 60_000) * 60_000;
    const pts = (s0: number, trechos: [number, number, number][]) => {
      const out: [number, number, number][] = [];
      let t = s0;
      for (const [s, x, y] of trechos) for (let k = 0; k < s; k += 1) out.push([inicio + (t++) * 1000, x, y]);
      return out;
    };
    const ms = minutos([[1, pts(5, [[90, 1, 1], [5, 5, 5]])], [2, pts(10, [[3, 10.5, 0.5], [180, 6, 4], [3, 10.5, 0.5]])]]);
    const corpo = ms.map((m) => ({ minuto: m.minuto.toISOString(), celulaM: 0.25, calor: [], pico: 2, caminhos: m.caminhos }));
    const enviado = await app.inject({ method: 'POST', url: '/v1/planta-viva/minutos', headers: { authorization: `Bearer ${token}` }, payload: { minutos: corpo } });
    assert.equal(enviado.statusCode, 200, enviado.body);
    const d = (await ler(`?de=${encodeURIComponent(new Date(inicio - 60_000).toISOString())}`)).json();
    const fila = d.areas.find((a: { id: string }) => a.id === 'fila') as EsperaDaArea;
    const porta = d.areas.find((a: { id: string }) => a.id === 'porta') as PortaDaArea;
    assert.deepEqual(fila.visitas.map(([, s]) => s), [90]);
    assert.equal(porta.entradas.length, 1);
    assert.equal(porta.saidas.length, 1);
    assert.deepEqual(porta.naLoja, { quantos: 1, medianaS: 185 }, 'do segundo 10 ao 195');
    assert.ok(d.minutos >= 4);
    // tirar as áreas: a resposta volta vazia
    assert.equal((await salvarPlanta([])).statusCode, 200);
    assert.deepEqual((await ler()).json().areas, []);
  });
});
