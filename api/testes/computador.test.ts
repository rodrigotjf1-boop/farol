// O computador da loja dorme e acorda sozinho (A22, fatia P2) — a conta (sem banco) e as rotas (com).
//
// O que tem de ficar provado:
//
//   - a semana é contada dando a volta: o estado de cada instante é o do último acontecimento antes dele;
//   - a sugestão é a do dono (16/10/2026): dorme 1 hora depois de fechar e acorda 1 hora antes de abrir;
//   - ele NÃO pode dormir com a loja aberta — nem no minuto de fechar —, e a recusa diz o dia e o trecho;
//   - o silêncio do agente só é sono quando ele SABE dormir, calou na hora de dormir e ainda não passou do "acorda"
//     (com a folga); fora disso o aviso de "agente sem sinal" sai como sempre;
//   - só quem configura muda o horário, salvar sobe a versão que o agente acompanha, e o horário desce para ele;
//   - os casos do contrato (`contratos/horario-do-computador.json`) são os mesmos que o agente vai conferir.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import {
  choques,
  computadorDaLoja,
  FOLGA_ANTES_DE_DORMIR_MIN,
  FOLGA_PARA_ACORDAR_MIN,
  lerHorarioDoComputador,
  minutoDaSemana,
  SABE_DORMIR,
  semanaDesenhada,
  silencioDoAgente,
  situacaoDoComputador,
  sugestao,
  trechosDormindo,
  type DiaDoComputador,
  type HorarioDoComputador,
} from '../src/computador.js';
import { despacharAgentesCaidos } from '../src/despacho.js';
import type { Faixa } from '../src/horario.js';
import { choquesPorDia } from '../src/rotas/computador.js';

const CONTRATO = JSON.parse(readFileSync(new URL('../../contratos/horario-do-computador.json', import.meta.url), 'utf8')) as {
  saber: string;
  fuso: string;
  horarioDaLoja: Faixa[];
  folgaDaSugestaoMin: number;
  sugestao: HorarioDoComputador;
  horario: HorarioDoComputador;
  casos: { quando: string; dormindo: boolean; porque: string }[];
  choques: { _: string; dias: DiaDoComputador[]; choques: { dia: number; de: string; ate: string }[] }[];
};
// O comentário (`_`) do contrato é para quem lê, não é dado: sai antes de comparar e de mandar.
for (const h of [CONTRATO.sugestao, CONTRATO.horario]) delete (h as { _?: string })._;
const SP = 'America/Sao_Paulo';
/** Um instante dito no relógio de São Paulo (UTC-3, sem horário de verão). */
const emSP = (local: string) => new Date(`${local}:00-03:00`);
/** Os sete dias, com os que vieram e o resto vazio. */
const semana = (dias: Partial<DiaDoComputador>[], ligado = true): HorarioDoComputador => ({
  ligado,
  dias: [1, 2, 3, 4, 5, 6, 7].map((dia) => ({ dia, dorme: null, acorda: null, ...dias.find((d) => d.dia === dia) })),
});

describe('computador: a conta', () => {
  it('lê e arruma o que veio do console: os sete dias em ordem, vazio vira nulo', () => {
    const embaralhado = [...CONTRATO.horario.dias].reverse().map((d, i) => (i === 0 ? { ...d, acorda: '' } : d));
    const r = lerHorarioDoComputador({ ligado: true, dias: embaralhado });
    assert.equal(r.problema, undefined);
    assert.deepEqual(r.horario!.dias.map((d) => d.dia), [1, 2, 3, 4, 5, 6, 7]);
    assert.equal(r.horario!.dias[6]!.acorda, null, 'o domingo veio com "acorda" vazio');
    assert.deepEqual(lerHorarioDoComputador(CONTRATO.horario).horario, CONTRATO.horario);
  });

  it('recusa o que não é horário, dizendo o porquê', () => {
    const sete = CONTRATO.horario.dias;
    const ruins: [unknown, RegExp][] = [
      ['04:00', /ligado, dias/],
      [{ ligado: 'sim', dias: sete }, /ligado/],
      [{ ligado: true, dias: sete.slice(0, 6) }, /sete dias/],
      [{ ligado: true, dias: [...sete.slice(0, 6), { dia: 8, dorme: null, acorda: null }] }, /dia de 1/],
      [{ ligado: true, dias: [...sete.slice(0, 6), { dia: 1, dorme: null, acorda: null }] }, /duas vezes/],
      [{ ligado: true, dias: [...sete.slice(0, 6), { dia: 7, dorme: '24:00', acorda: null }] }, /dorme no formato/],
      [{ ligado: true, dias: [...sete.slice(0, 6), { dia: 7, dorme: null, acorda: '6:45' }] }, /acorda no formato/],
      [{ ligado: true, dias: [...sete.slice(0, 6), { dia: 7, dorme: '06:45', acorda: '06:45' }] }, /mesma hora/],
      [{ ligado: true, dias: [...sete.slice(0, 6), null] }, /\{dia, dorme, acorda\}/],
    ];
    for (const [bruto, esperado] of ruins) {
      const r = lerHorarioDoComputador(bruto);
      assert.equal(r.horario, undefined, JSON.stringify(bruto));
      assert.match(String(r.problema), esperado, JSON.stringify(bruto));
    }
  });

  it('a semana dá a volta: sem "acorda" no dia, ele dorme até o "acorda" seguinte; sem "dorme", nunca dorme', () => {
    assert.deepEqual(trechosDormindo(semana([{ dia: 1, dorme: '04:00' }, { dia: 2, acorda: '18:00' }])), [[240, 1440 + 1080]]);
    // dorme no domingo e acorda na segunda: o trecho passa da semana e é partido em dois
    assert.deepEqual(trechosDormindo(semana([{ dia: 7, dorme: '23:00' }, { dia: 1, acorda: '06:00' }])), [[0, 360], [8640 + 1380, 10080]]);
    assert.deepEqual(trechosDormindo(semana([{ dia: 2, acorda: '18:00' }])), [], 'sem "dorme", nunca dorme');
    assert.deepEqual(trechosDormindo(semana([{ dia: 2, dorme: '04:00' }])), [[0, 10080]], 'sem "acorda", dorme a semana toda');
    assert.deepEqual(trechosDormindo(semana([{ dia: 1, dorme: '04:00', acorda: '18:00' }], false)), [], 'desligado não dorme');
    assert.deepEqual(trechosDormindo(null), []);
  });

  it('a semana desenhada: a segunda do dono dorme das 04:00 às 18:00, e a loja (domingo à noite) vai até 03:15', () => {
    const seg = semanaDesenhada(CONTRATO.horario, CONTRATO.horarioDaLoja)[0]!;
    assert.deepEqual(seg, { dia: 1, dormindo: [[240, 1080]], aberta: [[0, 196], [1140, 1440]], choques: [] });
    const sab = semanaDesenhada(CONTRATO.horario, CONTRATO.horarioDaLoja)[5]!;
    assert.deepEqual(sab.aberta, [[0, 346], [1140, 1440]], 'sábado: a sexta até 05:45 e o próprio sábado das 19:00');
    assert.deepEqual(sab.dormindo, [[405, 1080]]);
    // sem horário da loja: nada desenhado como aberto (não se sabe), e o sono aparece
    assert.deepEqual(semanaDesenhada(CONTRATO.horario, [])[0]!.aberta, []);
  });

  it('faixas da loja que se encostam viram uma só (a semana desenhada não parte a barra)', () => {
    const encostadas: Faixa[] = [{ dias: [3], hora_ini: '08:00', hora_fim: '11:59' }, { dias: [3], hora_ini: '12:00', hora_fim: '18:00' }];
    assert.deepEqual(semanaDesenhada(null, encostadas)[2]!.aberta, [[480, 1081]]);
  });

  it('a sugestão é a do contrato: 1 hora depois de fechar e 1 hora antes de abrir', () => {
    assert.equal(CONTRATO.folgaDaSugestaoMin, 60);
    assert.deepEqual(sugestao(CONTRATO.horarioDaLoja), CONTRATO.sugestao);
    assert.deepEqual(choques(sugestao(CONTRATO.horarioDaLoja), CONTRATO.horarioDaLoja), [], 'a sugestão nunca choca');
    assert.equal(sugestao([]), null, 'sem horário da loja não há o que sugerir');
    // a loja que fecha à tarde e reabre à noite não dorme no meio (menos de 1 hora de sono)
    const comAlmoco: Faixa[] = [{ dias: [1], hora_ini: '11:00', hora_fim: '15:00' }, { dias: [1], hora_ini: '17:30', hora_fim: '23:00' }];
    const s = sugestao(comAlmoco)!;
    assert.deepEqual(s.dias[0], { dia: 1, dorme: null, acorda: '10:00' }, 'segunda: só acorda antes do almoço');
    assert.deepEqual(s.dias[1], { dia: 2, dorme: '00:00', acorda: null }, 'dorme 1 hora depois de fechar às 23:00, já na terça');
  });

  it('dois trechos fechados no mesmo dia: a sugestão fica com o sono mais longo', () => {
    // Domingo até a 1h da segunda; segunda das 12h às 14h e das 17h às 23h. Na segunda cabem dois sonos: o da manhã
    // (02:00 às 11:00) e o da tarde (15:00 às 16:00). Fica o da manhã.
    const loja: Faixa[] = [
      { dias: [7], hora_ini: '19:00', hora_fim: '01:00' },
      { dias: [1], hora_ini: '12:00', hora_fim: '14:00' },
      { dias: [1], hora_ini: '17:00', hora_fim: '23:00' },
    ];
    const s = sugestao(loja)!;
    assert.deepEqual(s.dias[0], { dia: 1, dorme: '02:00', acorda: '11:00' });
    assert.deepEqual(s.dias[1], { dia: 2, dorme: '00:00', acorda: null }, 'depois das 23:00 de segunda, dorme à meia-noite');
    assert.deepEqual(s.dias[6], { dia: 7, dorme: null, acorda: '18:00' });
    assert.deepEqual(choques(s, loja), []);
  });

  it('o sono que atravessa a semana (domingo → segunda) é um só', () => {
    const h = semana([{ dia: 7, dorme: '23:00' }, { dia: 1, acorda: '06:00' }]);
    const batida = emSP('2026-10-25T22:55');
    const r = silencioDoAgente({ horario: h, fuso: SP, sabe: [SABE_DORMIR], ultimaBatida: batida, agora: emSP('2026-10-26T01:00') });
    assert.deepEqual(r, { dormindo: true, nao_acordou: false, acorda_as: '06:00' }, 'dormiu domingo 23:00, não segunda 00:00');
    assert.deepEqual(situacaoDoComputador(h, emSP('2026-10-26T01:00'), SP), { dormindo_agora: true, dormiu_as: '23:00', acorda_as: '06:00' });
  });

  it('o contrato com o agente: dormindo ou acordado, caso a caso', () => {
    assert.equal(CONTRATO.saber, SABE_DORMIR);
    assert.equal(CONTRATO.fuso, SP);
    assert.ok(CONTRATO.casos.length >= 12);
    for (const c of CONTRATO.casos) {
      assert.equal(situacaoDoComputador(CONTRATO.horario, emSP(c.quando), SP).dormindo_agora, c.dormindo, `${c.quando}: ${c.porque}`);
    }
    assert.deepEqual(choquesPorDia(CONTRATO.horario, CONTRATO.horarioDaLoja), [], 'o horário do dono não choca');
  });

  it('o contrato com o agente: os choques com a loja aberta, com o dia e o trecho', () => {
    for (const c of CONTRATO.choques) {
      assert.deepEqual(choquesPorDia(semana(c.dias), CONTRATO.horarioDaLoja), c.choques, c._);
    }
    // sem horário da loja, a loja vale como sempre aberta: todo sono choca
    assert.ok(choquesPorDia(CONTRATO.horario, []).length > 0);
    // desligado não choca (o preenchido fica guardado)
    assert.deepEqual(choquesPorDia({ ...semana(CONTRATO.choques[0]!.dias), ligado: false }, CONTRATO.horarioDaLoja), []);
  });

  it('como ele está agora: dormindo, com a hora em que dormiu e a de acordar', () => {
    assert.deepEqual(situacaoDoComputador(CONTRATO.horario, emSP('2026-10-19T10:00'), SP),
      { dormindo_agora: true, dormiu_as: '04:00', acorda_as: '18:00' });
    // acordado: o trecho que passou por último
    assert.deepEqual(situacaoDoComputador(CONTRATO.horario, emSP('2026-10-19T20:00'), SP),
      { dormindo_agora: false, dormiu_as: '04:00', acorda_as: '18:00' });
    // segunda 01:00: o último sono foi o de domingo (06:45 às 18:00), na semana que passou
    assert.deepEqual(situacaoDoComputador(CONTRATO.horario, emSP('2026-10-19T01:00'), SP),
      { dormindo_agora: false, dormiu_as: '06:45', acorda_as: '18:00' });
    assert.deepEqual(situacaoDoComputador(null, emSP('2026-10-19T10:00'), SP), { dormindo_agora: false, dormiu_as: null, acorda_as: null });
  });

  it('o minuto da semana é o do relógio da loja (segunda 00:00 = 0, domingo 23:59 = 10.079)', () => {
    assert.equal(minutoDaSemana(emSP('2026-10-19T00:00'), SP), 0);
    assert.equal(minutoDaSemana(emSP('2026-10-25T23:59'), SP), 10079);
    assert.equal(minutoDaSemana(emSP('2026-10-19T00:00'), 'UTC'), 180, 'em UTC já são 03:00');
  });

  describe('o silêncio do agente: sono ou queda?', () => {
    const dormindoAs4 = emSP('2026-10-19T04:00');
    const caso = (agora: string, batida: Date | null, sabe: string[] = [SABE_DORMIR], horario: HorarioDoComputador = CONTRATO.horario) =>
      silencioDoAgente({ horario, fuso: SP, sabe, ultimaBatida: batida, agora: emSP(agora) });

    it('calou na hora de dormir e sabe dormir: é sono, e diz a hora de acordar', () => {
      assert.deepEqual(caso('2026-10-19T10:00', dormindoAs4), { dormindo: true, nao_acordou: false, acorda_as: '18:00' });
      // a batida pode ter sido um pouco antes do "dorme" (até a folga)
      const antes = new Date(dormindoAs4.getTime() - FOLGA_ANTES_DE_DORMIR_MIN * 60_000);
      assert.equal(caso('2026-10-19T10:00', antes).dormindo, true);
    });

    it('o pacote antigo não dorme: o silêncio dele é queda', () => {
      assert.equal(caso('2026-10-19T10:00', dormindoAs4, []).dormindo, false);
      assert.equal(caso('2026-10-19T10:00', dormindoAs4, ['treino', 'fichas']).dormindo, false);
    });

    it('calado desde antes da hora de dormir: caiu antes, e é queda', () => {
      const cedo = new Date(dormindoAs4.getTime() - (FOLGA_ANTES_DE_DORMIR_MIN + 1) * 60_000);
      assert.deepEqual(caso('2026-10-19T10:00', cedo), { dormindo: false, nao_acordou: false, acorda_as: null });
    });

    it('acordando: até a folga depois do "acorda" ainda é sono; depois, "não acordou"', () => {
      assert.equal(caso('2026-10-19T18:05', dormindoAs4).dormindo, true);
      const passou = new Date(emSP('2026-10-19T18:00').getTime() + FOLGA_PARA_ACORDAR_MIN * 60_000);
      const r = silencioDoAgente({ horario: CONTRATO.horario, fuso: SP, sabe: [SABE_DORMIR], ultimaBatida: dormindoAs4, agora: passou });
      assert.deepEqual(r, { dormindo: false, nao_acordou: true, acorda_as: '18:00' });
    });

    it('não acordou na segunda e calou de vez: no sono de terça já é queda, não "dormindo"', () => {
      assert.deepEqual(caso('2026-10-20T10:00', dormindoAs4), { dormindo: false, nao_acordou: false, acorda_as: null });
    });

    it('desligado, sem horário ou sem batida: nada', () => {
      assert.equal(caso('2026-10-19T10:00', dormindoAs4, [SABE_DORMIR], { ...CONTRATO.horario, ligado: false }).dormindo, false);
      assert.equal(silencioDoAgente({ horario: null, fuso: SP, sabe: [SABE_DORMIR], ultimaBatida: dormindoAs4, agora: emSP('2026-10-19T10:00') }).dormindo, false);
      assert.equal(caso('2026-10-19T10:00', null).dormindo, false);
    });

    it('o que a moldura recebe: nulo sem horário; a batida pode vir como texto', () => {
      assert.equal(computadorDaLoja(null, SP, null, emSP('2026-10-19T10:00')), null);
      assert.deepEqual(
        computadorDaLoja(CONTRATO.horario, SP, { batida: dormindoAs4.toISOString(), sabe: [SABE_DORMIR] }, emSP('2026-10-19T10:00')),
        { ligado: true, dormindo: true, nao_acordou: false, acorda_as: '18:00' },
      );
      assert.deepEqual(
        computadorDaLoja(CONTRATO.horario, SP, null, emSP('2026-10-19T10:00')),
        { ligado: true, dormindo: false, nao_acordou: false, acorda_as: null },
      );
    });
  });
});

// ───────────────────────────── com banco ─────────────────────────────

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-computador-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-computador';
const SENHA = 'uma senha longa o bastante';

/** Um horário que tem o computador dormindo AGORA, desde `desdeMin` minutos atrás, seja que hora for. */
function dormindoAgora(desdeMin = 30): HorarioDoComputador {
  const m = minutoDaSemana(new Date(), SP);
  const dorme = (((m - desdeMin) % 10080) + 10080) % 10080;
  const acorda = (m + 120) % 10080;
  const h = (x: number) => `${String(Math.floor((x % 1440) / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
  const dias: Partial<DiaDoComputador>[] = [];
  const diaDorme = Math.floor(dorme / 1440) + 1;
  const diaAcorda = Math.floor(acorda / 1440) + 1;
  if (diaDorme === diaAcorda) dias.push({ dia: diaDorme, dorme: h(dorme), acorda: h(acorda) });
  else dias.push({ dia: diaDorme, dorme: h(dorme) }, { dia: diaAcorda, acorda: h(acorda) });
  return semana(dias);
}

describe('computador: as rotas e o vigia (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  let lojaId = '';
  let outraLojaId = '';
  let agenteId = '';
  let token = '';
  let cookie = '';
  let cookieSupervisao = '';
  let cookieVizinho = '';

  async function entrar(tenantId: string, email: string, nivel: string) {
    await app.inject({
      method: 'POST', url: '/v1/distribuicao/usuarios', headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId, nome: 'X', email, senha: SENHA, nivel },
    });
    const r = await app.inject({ method: 'POST', url: '/v1/sessao', payload: { email, senha: SENHA } });
    const b = r.headers['set-cookie'];
    return (Array.isArray(b) ? b[0]! : String(b)).split(';')[0]!;
  }

  const ver = (comCookie = cookie, id = lojaId) =>
    app.inject({ method: 'GET', url: `/v1/lojas/${id}/computador`, headers: { cookie: comCookie } });
  const salvar = (corpo: unknown, comCookie = cookie, id = lojaId) =>
    app.inject({ method: 'PUT', url: `/v1/lojas/${id}/computador`, headers: { cookie: comCookie }, payload: corpo as object });
  const conferir = (corpo: unknown, comCookie = cookie) =>
    app.inject({ method: 'POST', url: `/v1/lojas/${lojaId}/computador/conferir`, headers: { cookie: comCookie }, payload: corpo as object });
  const versao = async (id = lojaId) =>
    (await pool.query('select config_versao from loja where id = $1', [id])).rows[0].config_versao as number;

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    app = criarApp(pool, { logger: false });
    await app.ready();

    const conta = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome: marca }, loja: { nome: 'Matriz' }, setores: [{ nome: 'Bancada' }] },
    })).json();
    lojaId = conta.loja.id;
    cookie = await entrar(conta.tenantId, `ger-${marca}@e.com`, 'gerente');
    cookieSupervisao = await entrar(conta.tenantId, `sup-${marca}@e.com`, 'supervisao');
    // A segunda loja da MESMA conta: o horário de uma não pode vazar para a outra.
    const outra = await pool.query(
      `insert into loja (tenant_id, nome, timezone) values ($1, 'Filial', $2) returning id`,
      [conta.tenantId, SP],
    );
    outraLojaId = outra.rows[0].id;
    await pool.query('update loja set timezone = $2 where id = $1', [lojaId, SP]);

    const vizinha = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome: `${marca}-vizinha` }, loja: { nome: 'Vizinha' }, setores: [] },
    })).json();
    cookieVizinho = await entrar(vizinha.tenantId, `ger-${marca}-viz@e.com`, 'gerente');

    const agente = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/agentes', headers: { 'x-farol-admin': ADMIN },
      payload: { lojaId, nome: 'PC da loja' },
    })).json();
    token = agente.token;
    agenteId = agente.id;
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

  it('loja nova: nunca programado, sem horário da loja, nada a sugerir; o agente ainda não sabe dormir', async () => {
    const r = await ver();
    assert.equal(r.statusCode, 200, r.body);
    const b = r.json();
    assert.equal(b.horario, null);
    assert.equal(b.temHorarioDaLoja, false);
    assert.equal(b.sugestao, null);
    assert.deepEqual(b.choques, []);
    assert.equal(b.situacao.dormindo_agora, false);
    assert.equal(b.agente.sabeDormir, false);
    assert.equal(b.configura, true);
    assert.equal((await ver(cookieSupervisao)).json().configura, false, 'supervisão vê, mas não configura');
  });

  it('ligado sem o horário da loja é recusado: sem ele a loja vale como sempre aberta', async () => {
    const antes = await versao();
    const r = await salvar(CONTRATO.horario);
    assert.equal(r.statusCode, 422, r.body);
    assert.equal(r.json().erro, 'sem_horario_da_loja');
    assert.equal(await versao(), antes);
  });

  it('com o horário da loja, a sugestão é a do contrato', async () => {
    const h = await app.inject({ method: 'PUT', url: `/v1/lojas/${lojaId}/horario`, headers: { cookie }, payload: { horario: CONTRATO.horarioDaLoja } });
    assert.equal(h.statusCode, 200, h.body);
    const b = (await ver()).json();
    assert.equal(b.temHorarioDaLoja, true);
    assert.deepEqual(b.sugestao, CONTRATO.sugestao);
    assert.equal(b.semana.length, 7);
    assert.deepEqual(b.semana[0].aberta, [[0, 196], [1140, 1440]]);
  });

  it('conferir um rascunho desenha a semana e diz os choques, sem salvar nada', async () => {
    const antes = await versao();
    const ruim = semana(CONTRATO.choques[1]!.dias);
    const r = await conferir(ruim);
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json().choques, CONTRATO.choques[1]!.choques);
    assert.equal(r.json().semana.length, 7);
    assert.deepEqual((await conferir(CONTRATO.horario)).json().choques, []);
    assert.equal((await conferir({ ligado: true, dias: [] })).statusCode, 422);
    assert.equal((await conferir(CONTRATO.horario, cookieSupervisao)).statusCode, 403, 'só quem configura edita');
    assert.equal(await versao(), antes);
    assert.equal((await ver()).json().horario, null);
  });

  it('dormir com a loja aberta é recusado com o dia e o trecho, e nada muda', async () => {
    const antes = await versao();
    const r = await salvar(semana(CONTRATO.choques[3]!.dias));
    assert.equal(r.statusCode, 422, r.body);
    assert.equal(r.json().erro, 'dorme_com_a_loja_aberta');
    assert.deepEqual(r.json().choques, CONTRATO.choques[3]!.choques);
    assert.match(r.json().mensagem, /na segunda, das 19:00 às 24:00; na terça, das 00:00 às 03:01/);
    assert.equal(await versao(), antes);
  });

  it('salvar grava, sobe a versão, e o horário desce para o agente; a outra loja não muda', async () => {
    const antes = await versao();
    const daOutra = await versao(outraLojaId);
    const r = await salvar(CONTRATO.horario);
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json().horario, CONTRATO.horario);
    assert.deepEqual(r.json().choques, []);
    assert.equal(await versao(), antes + 1, 'sem subir a versão o agente não puxa o horário novo');
    assert.equal(await versao(outraLojaId), daOutra);
    assert.equal((await pool.query('select horario_computador from loja where id = $1', [outraLojaId])).rows[0].horario_computador, null);

    const cfg = await app.inject({ method: 'GET', url: '/v1/agentes/configuracao', headers: { authorization: `Bearer ${token}` } });
    assert.equal(cfg.statusCode, 200, cfg.body);
    assert.deepEqual(cfg.json().loja.horarioComputador, CONTRATO.horario);
    assert.deepEqual((await ver()).json().horario, CONTRATO.horario);
  });

  it('desligar é aceito mesmo com dias que chocariam: o preenchido fica guardado, e ele fica ligado o tempo todo', async () => {
    const desligado = { ...semana(CONTRATO.choques[3]!.dias), ligado: false };
    const r = await salvar(desligado);
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json().horario, desligado);
    assert.deepEqual(r.json().choques, []);
    assert.equal(r.json().situacao.dormindo_agora, false);
  });

  it('supervisão vê e não muda; outra conta nem sabe que a loja existe; sem sessão, nada', async () => {
    assert.equal((await salvar(CONTRATO.horario, cookieSupervisao)).statusCode, 403);
    assert.equal((await salvar(CONTRATO.horario, cookieVizinho)).statusCode, 404);
    assert.equal((await ver(cookieVizinho)).statusCode, 404);
    assert.equal((await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}/computador` })).statusCode, 401);
    assert.equal((await app.inject({ method: 'GET', url: '/v1/lojas/nao-e-id/computador', headers: { cookie } })).statusCode, 422);
    assert.equal((await ver()).json().horario.ligado, false, 'as tentativas recusadas não mudaram nada');
  });

  it('a moldura: dormindo só quando o agente SABE dormir e calou na hora de dormir', async () => {
    // O horário da loja fica fora do caminho (a loja aberta só pesa ao salvar): grava direto o sono de agora.
    await pool.query('update loja set horario_computador = $2::jsonb where id = $1', [lojaId, JSON.stringify(dormindoAgora(30))]);
    await pool.query(`update agente set ultimo_heartbeat = now() - interval '29 minutes', sabe = '{}' where id = $1`, [agenteId]);
    const naLista = async () => ((await app.inject({ method: 'GET', url: '/v1/lojas', headers: { cookie } })).json().lojas as {
      id: string; computador: { ligado: boolean; dormindo: boolean } | null;
    }[]).find((l) => l.id === lojaId)!;
    assert.deepEqual((await naLista()).computador, { ligado: true, dormindo: false, nao_acordou: false, acorda_as: null }, 'o pacote antigo não dorme');

    await pool.query(`update agente set sabe = $2 where id = $1`, [agenteId, [SABE_DORMIR]]);
    const c = (await naLista()).computador as unknown as { dormindo: boolean; acorda_as: string };
    assert.equal(c.dormindo, true);
    assert.match(c.acorda_as, /^\d\d:\d\d$/);
    const daLoja = (await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}`, headers: { cookie } })).json().loja;
    assert.equal(daLoja.computador.dormindo, true, 'a página da loja diz o mesmo');
    assert.equal(daLoja.horario_computador, undefined, 'o horário em si fica na tela do computador');
    const dele = (await ver()).json();
    assert.equal(dele.agente.sabeDormir, true);
    assert.equal(dele.agente.dormindo, true);
    assert.equal(dele.situacao.dormindo_agora, true);
    // a outra loja da conta, sem horário: nulo
    const outra = ((await app.inject({ method: 'GET', url: '/v1/lojas', headers: { cookie } })).json().lojas as { id: string; computador: unknown }[])
      .find((l) => l.id === outraLojaId)!;
    assert.equal(outra.computador, null);
  });

  describe('o vigia do "agente sem sinal"', () => {
    let destinoId = '';
    const envios = async () =>
      Number((await pool.query("select count(*) from envio where loja_id = $1 and motivo = 'agente_caiu'", [lojaId])).rows[0].count);

    before(async () => {
      const t = await pool.query('select tenant_id from loja where id = $1', [lojaId]);
      destinoId = (await pool.query(
        `insert into destino (tenant_id, loja_id, tipo, nome, endereco)
         values ($1,$2,'whatsapp','Dono','+5521999990000') returning id`,
        [t.rows[0].tenant_id, lojaId],
      )).rows[0].id;
      assert.ok(destinoId);
    });

    it('dormindo no horário, sabendo dormir: o aviso NÃO sai', async () => {
      await pool.query('update loja set horario_computador = $2::jsonb where id = $1', [lojaId, JSON.stringify(dormindoAgora(30))]);
      await pool.query(`update agente set ultimo_heartbeat = now() - interval '29 minutes', sabe = $2 where id = $1`, [agenteId, [SABE_DORMIR]]);
      await despacharAgentesCaidos(pool, 5);
      assert.equal(await envios(), 0);
    });

    it('o mesmo silêncio no pacote antigo (não sabe dormir): o aviso sai', async () => {
      await pool.query(`update agente set sabe = '{}' where id = $1`, [agenteId]);
      await despacharAgentesCaidos(pool, 5);
      assert.equal(await envios(), 1);
    });

    it('calado desde ANTES da hora de dormir: caiu antes, e o aviso sai', async () => {
      await pool.query('delete from envio where loja_id = $1', [lojaId]);
      await pool.query(`update agente set ultimo_heartbeat = now() - interval '45 minutes', sabe = $2 where id = $1`, [agenteId, [SABE_DORMIR]]);
      await despacharAgentesCaidos(pool, 5);
      assert.equal(await envios(), 1, 'calou 15 minutos antes de dormir: queda');
    });

    it('com o horário desligado, o silêncio é queda', async () => {
      await pool.query('delete from envio where loja_id = $1', [lojaId]);
      await pool.query('update loja set horario_computador = $2::jsonb where id = $1', [lojaId, JSON.stringify({ ...dormindoAgora(30), ligado: false })]);
      await pool.query(`update agente set ultimo_heartbeat = now() - interval '29 minutes' where id = $1`, [agenteId]);
      await despacharAgentesCaidos(pool, 5);
      assert.equal(await envios(), 1);
    });
  });
});
