// Horário de funcionamento da loja — a conta (sem banco) e as rotas (com).
//
// O horário é DA LOJA; cada critério diz se é conferido com ela aberta,
// fechada ou sempre. O que tem de ficar provado:
//
//   - a madrugada pertence ao dia em que a loja ABRIU (sexta das 18h à 1h
//     cobre o sábado à 0h30, e não a sexta à 0h30);
//   - "aberta agora" sai no relógio da LOJA, não no do servidor;
//   - loja sem horário é "não se sabe", e é tratada como sempre aberta;
//   - só quem configura muda o horário, e mudar sobe a versão que o agente
//     acompanha;
//   - o agente recebe o horário e o `quando` de cada critério;
//   - critério "no horário" numa loja com horário não é acusado de "nunca
//     olhado".

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import {
  abertaEm, faixaContem, horaDeConferir, lerHorario, QUANDOS, relogioDaLoja, type Faixa, type Quando,
} from '../src/horario.js';

const SP = 'America/Sao_Paulo';
// Terça a quinta e domingo até 23h30; sexta e sábado até a 1h; segunda fechada.
const DA_LOJA: Faixa[] = [
  { dias: [2, 3, 4, 7], hora_ini: '18:00', hora_fim: '23:30' },
  { dias: [5, 6], hora_ini: '18:00', hora_fim: '01:00' },
];
/** Um instante dito no relógio de São Paulo (UTC-3, sem horário de verão). */
const emSP = (data: string, hora: string) => new Date(`${data}T${hora}:00-03:00`);

describe('horário: a conta', () => {
  it('lê e arruma o que veio do console', () => {
    const r = lerHorario([{ dias: [6, 5, 5], hora_ini: '18:00', hora_fim: '01:00' }]);
    assert.deepEqual(r.faixas, [{ dias: [5, 6], hora_ini: '18:00', hora_fim: '01:00' }]);
    assert.deepEqual(lerHorario([]).faixas, [], 'lista vazia é válida: é "sem horário"');
  });

  it('recusa o que não é horário, dizendo o porquê', () => {
    const ruins: [unknown, RegExp][] = [
      ['18:00', /lista/],
      [[{ dias: [], hora_ini: '18:00', hora_fim: '23:00' }], /ao menos um dia/],
      [[{ dias: [0], hora_ini: '18:00', hora_fim: '23:00' }], /dia inválido/],
      [[{ dias: [8], hora_ini: '18:00', hora_fim: '23:00' }], /dia inválido/],
      [[{ dias: [1.5], hora_ini: '18:00', hora_fim: '23:00' }], /dia inválido/],
      [[{ dias: ['2'], hora_ini: '18:00', hora_fim: '23:00' }], /dia inválido/],
      [[{ dias: [2], hora_ini: '24:00', hora_fim: '23:00' }], /hora_ini/],
      [[{ dias: [2], hora_ini: '18:00', hora_fim: '7:5' }], /hora_fim/],
      [[{ dias: [2], hora_ini: '18:00', hora_fim: '18:00' }], /mesma hora/],
      [[null], /objeto/],
      [Array.from({ length: 29 }, () => ({ dias: [1], hora_ini: '08:00', hora_fim: '09:00' })), /no máximo/],
    ];
    for (const [bruto, esperado] of ruins) {
      const r = lerHorario(bruto);
      assert.equal(r.faixas, undefined, JSON.stringify(bruto));
      assert.match(String(r.problema), esperado, JSON.stringify(bruto));
    }
  });

  it('o relógio é o da loja: o mesmo instante é quarta à noite aqui e quinta de madrugada lá', () => {
    const instante = emSP('2026-10-07', '21:40'); // quarta-feira
    assert.deepEqual(relogioDaLoja(instante, SP), { dia: 3, hora: '21:40' });
    assert.deepEqual(relogioDaLoja(instante, 'Europe/Lisbon'), { dia: 4, hora: '01:40' });
    // domingo é 7, não 0
    assert.equal(relogioDaLoja(emSP('2026-10-11', '12:00'), SP).dia, 7);
  });

  it('faixa no mesmo dia: abre e fecha nos minutos ditos', () => {
    const f = DA_LOJA[0]!;
    assert.equal(faixaContem(f, 3, '17:59'), false);
    assert.equal(faixaContem(f, 3, '18:00'), true);
    assert.equal(faixaContem(f, 3, '23:30'), true);
    assert.equal(faixaContem(f, 3, '23:31'), false);
    assert.equal(faixaContem(f, 1, '20:00'), false, 'segunda não abre');
  });

  it('a madrugada pertence ao dia em que a loja ABRIU', () => {
    // sexta (5) e sábado (6), das 18h à 1h
    assert.equal(abertaEm(DA_LOJA, emSP('2026-10-09', '23:59'), SP), true, 'sexta, 23h59');
    assert.equal(abertaEm(DA_LOJA, emSP('2026-10-10', '00:30'), SP), true, 'sábado 0h30 ainda é a sexta');
    assert.equal(abertaEm(DA_LOJA, emSP('2026-10-10', '01:30'), SP), false, 'sábado 1h30: fechou à 1h');
    assert.equal(abertaEm(DA_LOJA, emSP('2026-10-11', '00:30'), SP), true, 'domingo 0h30 ainda é o sábado');
    // Sexta à 0h30 é a madrugada da QUINTA, que fecha às 23h30.
    assert.equal(abertaEm(DA_LOJA, emSP('2026-10-09', '00:30'), SP), false, 'sexta 0h30 não é da sexta');
    // Segunda à 0h30 é a madrugada do domingo, que fecha às 23h30.
    assert.equal(abertaEm(DA_LOJA, emSP('2026-10-12', '00:30'), SP), false);
  });

  it('o "ontem" da segunda é o domingo', () => {
    const domingoAteDuas: Faixa[] = [{ dias: [7], hora_ini: '20:00', hora_fim: '02:00' }];
    assert.equal(abertaEm(domingoAteDuas, emSP('2026-10-12', '01:00'), SP), true, 'segunda 1h é o domingo');
    assert.equal(abertaEm(domingoAteDuas, emSP('2026-10-13', '01:00'), SP), false, 'terça 1h não é');
  });

  it('loja sem horário não está aberta nem fechada: não se sabe', () => {
    assert.equal(abertaEm([], new Date(), SP), null);
    assert.equal(abertaEm(null, new Date(), SP), null);
  });

  it('hora de conferir: no horário, fora dele e sempre', () => {
    const aberta = emSP('2026-10-07', '21:40');
    const fechada = emSP('2026-10-07', '10:00');
    assert.equal(horaDeConferir('no_horario', DA_LOJA, aberta, SP), true);
    assert.equal(horaDeConferir('no_horario', DA_LOJA, fechada, SP), false);
    assert.equal(horaDeConferir('fora_do_horario', DA_LOJA, aberta, SP), false);
    assert.equal(horaDeConferir('fora_do_horario', DA_LOJA, fechada, SP), true);
    assert.equal(horaDeConferir('sempre', DA_LOJA, aberta, SP), true);
    assert.equal(horaDeConferir('sempre', DA_LOJA, fechada, SP), true);
  });

  it('sem horário informado a loja vale como sempre aberta', () => {
    const qualquer = emSP('2026-10-07', '04:00');
    assert.equal(horaDeConferir('no_horario', [], qualquer, SP), true, 'é como funcionava antes');
    assert.equal(horaDeConferir('fora_do_horario', [], qualquer, SP), false, 'ela nunca está fechada');
    assert.equal(horaDeConferir('sempre', [], qualquer, SP), true);
  });
});

// ───────────────────── o contrato com o agente ─────────────────────
//
// O agente tem a MESMA conta em Python (é ele quem decide se confere). Os
// dois lados leem estes casos: se divergirem, a tela diz "aberta" e o
// agente não olha.

describe('horário: o contrato com o agente', () => {
  const contrato = JSON.parse(
    readFileSync(new URL('../../contratos/horario-de-funcionamento.json', import.meta.url), 'utf8'),
  ) as {
    fuso: string;
    horario: Faixa[];
    casos: { quando: string; aberta: boolean; porque: string }[];
    conferir: {
      com_horario: Record<'aberta' | 'fechada', Record<Quando, boolean>>;
      sem_horario: Record<Quando, boolean>;
    };
  };
  // O contrato fala no relógio da loja; São Paulo é UTC-3 o ano todo.
  const instante = (local: string) => new Date(`${local}:00-03:00`);

  it('o horário do contrato é um horário válido para a API', () => {
    assert.equal(contrato.fuso, SP);
    assert.deepEqual(lerHorario(contrato.horario).faixas, contrato.horario);
  });

  it('aberta ou fechada, caso a caso', () => {
    assert.ok(contrato.casos.length >= 12);
    for (const c of contrato.casos) {
      assert.equal(abertaEm(contrato.horario, instante(c.quando), contrato.fuso), c.aberta, `${c.quando}: ${c.porque}`);
    }
  });

  it('é hora de conferir? — com horário e sem', () => {
    const aberta = instante('2026-10-07T21:40');
    const fechada = instante('2026-10-07T10:00');
    for (const q of QUANDOS) {
      assert.equal(horaDeConferir(q, contrato.horario, aberta, SP), contrato.conferir.com_horario.aberta[q], `aberta/${q}`);
      assert.equal(horaDeConferir(q, contrato.horario, fechada, SP), contrato.conferir.com_horario.fechada[q], `fechada/${q}`);
      assert.equal(horaDeConferir(q, [], fechada, SP), contrato.conferir.sem_horario[q], `sem horário/${q}`);
    }
  });
});

// ───────────────────────────── com banco ─────────────────────────────

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-horario-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-horario';
const SENHA = 'uma senha longa o bastante';

/** Um horário que está ABERTO agora, e outro que está FECHADO agora, seja que hora for. */
function horarioDeAgora(aberto: boolean): Faixa[] {
  const { dia } = relogioDaLoja(new Date(), SP);
  // Aberto: o dia inteiro de hoje.
  if (aberto) return [{ dias: [dia], hora_ini: '00:00', hora_fim: '23:59' }];
  // Fechado: uma hora só, daqui a dois dias, sem atravessar a meia-noite —
  // não alcança hoje a hora que for.
  const outroDia = ((dia + 1) % 7) + 1;
  return [{ dias: [outroDia], hora_ini: '10:00', hora_fim: '11:00' }];
}

describe('horário: as rotas (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  let lojaId = '';
  let zonaId = '';
  let cookie = '';
  let cookieSupervisao = '';
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

  const salvar = (horario: unknown, comCookie = cookie, id = lojaId) =>
    app.inject({ method: 'PUT', url: `/v1/lojas/${id}/horario`, headers: { cookie: comCookie }, payload: { horario } });
  const aLoja = async () =>
    (await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}`, headers: { cookie } })).json().loja;
  const versao = async () =>
    (await pool.query(`select config_versao from loja where id = $1`, [lojaId])).rows[0].config_versao as number;
  const doAgente = () =>
    app.inject({ method: 'GET', url: '/v1/agentes/configuracao', headers: { authorization: `Bearer ${token}` } });
  const sinais = async () =>
    ((await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}/resultados`, headers: { cookie } })).json().sinais as { tipo: string; regraNome?: string }[])
      .map((s) => `${s.tipo}:${s.regraNome ?? ''}`);

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    app = criarApp(pool, { logger: false });
    await app.ready();

    const conta = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome: marca }, loja: { nome: 'Matriz' }, setores: [{ nome: 'Atendimento' }] },
    })).json();
    lojaId = conta.loja.id;
    cookie = await entrar(conta.tenantId, `ger-${marca}@e.com`, 'gerente');
    cookieSupervisao = await entrar(conta.tenantId, `sup-${marca}@e.com`, 'supervisao');

    const vizinha = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome: `${marca}-vizinha` }, loja: { nome: 'Vizinha' }, setores: [] },
    })).json();
    cookieVizinho = await entrar(vizinha.tenantId, `ger-${marca}-viz@e.com`, 'gerente');

    const canal = await app.inject({
      method: 'POST', url: `/v1/setores/${conta.setores[0].id}/pontos`, headers: { cookie },
      payload: { nome: 'Balcão', origem: 'dvr', canal: 1, host: '192.168.1.108' },
    });
    assert.equal(canal.statusCode, 201, canal.body);
    zonaId = canal.json().zonas[0].id;

    const agente = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/agentes', headers: { 'x-farol-admin': ADMIN },
      payload: { lojaId, nome: 'PC da loja' },
    })).json();
    token = agente.token;
    const comToken = { authorization: `Bearer ${token}` };
    await app.inject({ method: 'POST', url: '/v1/agentes/ativar', headers: comToken, payload: { fingerprint: `fp-${marca}` } });
    const bate = await app.inject({ method: 'POST', url: '/v1/agentes/heartbeat', headers: comToken, payload: { versao: '0.9.4' } });
    assert.equal(bate.statusCode, 200, bate.body);
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  it('loja nova não tem horário: lista vazia e "aberta agora" desconhecido', async () => {
    const l = await aLoja();
    assert.deepEqual(l.horario_funcionamento, []);
    assert.equal(l.aberta_agora, null);
  });

  it('salvar grava, devolve se está aberta agora e sobe a versão que o agente acompanha', async () => {
    const antes = await versao();
    const r = await salvar(horarioDeAgora(true));
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().aberta_agora, true);

    assert.equal(await versao(), antes + 1, 'sem subir a versão o agente não puxa o horário novo');
    const l = await aLoja();
    assert.deepEqual(l.horario_funcionamento, horarioDeAgora(true));
    assert.equal(l.aberta_agora, true);

    const naLista = (await app.inject({ method: 'GET', url: '/v1/lojas', headers: { cookie } })).json().lojas[0];
    assert.equal(naLista.aberta_agora, true);
  });

  it('com a loja fechada agora, "aberta agora" é falso — não desconhecido', async () => {
    const r = await salvar(horarioDeAgora(false));
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().aberta_agora, false);
  });

  it('horário malformado é recusado com a frase, e nada muda', async () => {
    const antes = await versao();
    const r = await salvar([{ dias: [9], hora_ini: '18:00', hora_fim: '23:00' }]);
    assert.equal(r.statusCode, 422, r.body);
    assert.match(r.json().mensagem, /dia inválido/);
    const semCorpo = await app.inject({ method: 'PUT', url: `/v1/lojas/${lojaId}/horario`, headers: { cookie }, payload: {} });
    assert.equal(semCorpo.statusCode, 422, semCorpo.body);
    assert.equal(await versao(), antes);
  });

  it('supervisão vê e não muda; outra conta nem sabe que a loja existe; sem sessão, nada', async () => {
    assert.equal((await salvar([], cookieSupervisao)).statusCode, 403);
    assert.equal((await salvar([], cookieVizinho)).statusCode, 404);
    assert.equal((await app.inject({ method: 'PUT', url: `/v1/lojas/${lojaId}/horario`, payload: { horario: [] } })).statusCode, 401);
    // a tentativa da outra conta não apagou o horário desta
    assert.notDeepEqual((await aLoja()).horario_funcionamento, []);
  });

  it('o critério nasce "no horário", aceita os três valores e recusa o resto', async () => {
    const criar = (extra: Record<string, unknown>) =>
      app.inject({
        method: 'POST', url: `/v1/lojas/${lojaId}/regras`, headers: { cookie },
        payload: { nome: `Critério ${randomUUID().slice(0, 4)}`, tipo: 'estado', criterio: 'A bancada está limpa.', zonaIds: [zonaId], ...extra },
      });

    const padrao = await criar({});
    assert.equal(padrao.statusCode, 201, padrao.body);
    assert.equal(padrao.json().quando, 'no_horario');

    const fora = await criar({ quando: 'fora_do_horario' });
    assert.equal(fora.statusCode, 201, fora.body);
    assert.equal(fora.json().quando, 'fora_do_horario');

    const ruim = await criar({ quando: 'de madrugada' });
    assert.equal(ruim.statusCode, 422, ruim.body);
    assert.match(ruim.json().mensagem, /quando/);

    const muda = await app.inject({
      method: 'PATCH', url: `/v1/regras/${padrao.json().id}`, headers: { cookie }, payload: { quando: 'sempre' },
    });
    assert.equal(muda.statusCode, 200, muda.body);
    assert.equal(muda.json().quando, 'sempre');
    // editar outra coisa não mexe no horário do critério
    const soNome = await app.inject({
      method: 'PATCH', url: `/v1/regras/${padrao.json().id}`, headers: { cookie }, payload: { nome: 'Outro nome' },
    });
    assert.equal(soNome.json().quando, 'sempre');

    const naLista = (await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}/regras`, headers: { cookie } })).json().regras;
    assert.deepEqual(
      naLista.map((r: { quando: string }) => r.quando).sort(),
      ['fora_do_horario', 'sempre'],
    );
  });

  it('o agente recebe o horário da loja e o "quando" de cada critério', async () => {
    await pool.query(`update regra set ativa = true where loja_id = $1`, [lojaId]);
    await salvar(horarioDeAgora(true));

    const r = await doAgente();
    assert.equal(r.statusCode, 200, r.body);
    const c = r.json();
    assert.deepEqual(c.loja.horarioFuncionamento, horarioDeAgora(true));
    const regras = c.pontos.flatMap((p: { zonas: { regras: { quando: string }[] }[] }) => p.zonas.flatMap((z) => z.regras));
    assert.deepEqual(regras.map((x: { quando: string }) => x.quando).sort(), ['fora_do_horario', 'sempre']);
  });

  it('critério "no horário" em loja COM horário não é acusado de nunca olhado', async () => {
    // Um critério ligado, com canal, sem nenhuma olhada — e o agente de pé.
    await pool.query(`update regra set excluida_em = now() where loja_id = $1`, [lojaId]);
    const novo = await app.inject({
      method: 'POST', url: `/v1/lojas/${lojaId}/regras`, headers: { cookie },
      payload: { nome: 'Fila no balcão', tipo: 'estado', criterio: 'Não há fila.', zonaIds: [zonaId] },
    });
    assert.equal(novo.statusCode, 201, novo.body);
    const id = novo.json().id;
    await app.inject({ method: 'PATCH', url: `/v1/regras/${id}`, headers: { cookie }, payload: { ativa: true } });

    // Sem horário informado a loja é "sempre aberta": o critério já devia ter sido olhado.
    await salvar([]);
    assert.ok((await sinais()).includes('nunca_olhado:Fila no balcão'), 'sem horário, é o comportamento de antes');

    // Com horário, "no horário" pode estar certo em não ter sido olhado.
    await salvar(horarioDeAgora(false));
    assert.ok(!(await sinais()).includes('nunca_olhado:Fila no balcão'), 'acusou critério que só roda com a loja aberta');

    // "Sempre" não depende do horário: volta a ser cobrado.
    await app.inject({ method: 'PATCH', url: `/v1/regras/${id}`, headers: { cookie }, payload: { quando: 'sempre' } });
    assert.ok((await sinais()).includes('nunca_olhado:Fila no balcão'));
  });
});
