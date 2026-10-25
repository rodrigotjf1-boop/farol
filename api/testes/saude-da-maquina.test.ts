// O monitoramento da máquina (migration 056): o que o agente manda a mais em `POST /v1/uso` (os sensores, o pico de
// cada minuto, a queda do PC) e o relatório `GET /v1/lojas/:id/computador/saude`.
//
// Lê `contratos/uso-da-maquina.json`, o mesmo que `agent/testes/test_sensores.py` e `test_uso.py` usam. O que tem de
// ficar provado:
//
//   - só os campos conhecidos entram, nas faixas; o campo desconhecido fica de fora sem recusar a hora; o corpo antigo
//     (sem sensores) continua valendo;
//   - a queda entra uma vez por subida do Windows; mandar de novo não duplica;
//   - o relatório: as médias pesadas pelas amostras, os picos com a hora, os minutos acima do limite, "sobrecarregado"
//     e "esquentando" com o porquê; a loja de outra conta não aparece.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { validarUso } from '../src/rotas/uso.js';
import {
  CAMPOS_DOS_SENSORES,
  CAUSAS_DA_QUEDA,
  LIMITES,
  lerMinutos,
  lerQueda,
  lerSensores,
  resumirSaude,
  type HoraDaSaude,
} from '../src/saude-da-maquina.js';

type Contrato = {
  maquina: Record<string, unknown>;
  hora: Record<string, unknown>;
  sensoresDaHora: { sensores: Record<string, unknown>; minutos: unknown[] };
  queda: Record<string, unknown>;
  causasDaQueda: string[];
  camposDosSensores: Record<string, [number, number]>;
};
const CONTRATO = JSON.parse(readFileSync(new URL('../../contratos/uso-da-maquina.json', import.meta.url), 'utf8')) as Contrato;
const copia = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const HORA_COM_SENSORES = () => ({ ...copia(CONTRATO.hora), ...copia(CONTRATO.sensoresDaHora) });

describe('o monitoramento da máquina (sem banco)', () => {
  it('o contrato e a API dizem os mesmos campos, faixas e causas', () => {
    assert.deepEqual(
      Object.fromEntries(Object.entries(CAMPOS_DOS_SENSORES).map(([k, v]) => [k, [...v]])),
      CONTRATO.camposDosSensores,
    );
    assert.deepEqual([...CAUSAS_DA_QUEDA], CONTRATO.causasDaQueda);
    assert.equal(validarUso(HORA_COM_SENSORES(), 0), null, 'o exemplo do contrato passa');
    assert.equal(validarUso(copia(CONTRATO.hora), 0), null, 'a hora sem sensores (agente antigo) passa');
    assert.deepEqual(lerQueda(CONTRATO.queda, new Date('2026-10-26T00:00:00Z')).queda, CONTRATO.queda);
  });

  it('os sensores: o desconhecido fica de fora, o torto é recusado com o campo', () => {
    const s = lerSensores({ gpuTempC: { soma: 120, amostras: 2, max: 61 }, campoDoFuturo: 1, discoSaude: 'ok' }, 96, 'horas[0]');
    assert.deepEqual(s.sensores, { gpuTempC: { soma: 120, amostras: 2, max: 61 }, discoSaude: 'ok' });
    const casos: Array<[unknown, RegExp]> = [
      [{ gpuTempC: { soma: 120, amostras: 2, max: 200 } }, /gpuTempC\.max/],
      [{ gpuTempC: { soma: 130, amostras: 2, max: 61 } }, /gpuTempC\.soma/],
      [{ gpuTempC: { soma: 60, amostras: 97, max: 61 } }, /gpuTempC\.amostras/],
      [{ discoSaude: 'otima' }, /discoSaude/],
      [{ gpuLimitaTemperatura: 1.5 }, /gpuLimitaTemperatura/],
      [{ ligadoHaH: -1 }, /ligadoHaH/],
      ['texto', /sensores: objeto/],
    ];
    for (const [bruto, motivo] of casos) {
      const r = lerSensores(bruto, 96, 'horas[0]');
      assert.ok(r.problema, `devia recusar: ${motivo}`);
      assert.match(r.problema!, motivo);
    }
    assert.deepEqual(lerSensores(undefined, 96, 'x'), {});
  });

  it('os minutos: até 60, sem repetir, nas faixas; o campo desconhecido fica de fora', () => {
    const m = lerMinutos([[5, { cpu: 99, gpuTempC: 70, outro: 3 }], [1, { mem: 50 }]], 'horas[0]');
    assert.deepEqual(m.minutos, [[1, { mem: 50 }], [5, { cpu: 99, gpuTempC: 70 }]]);
    assert.match(lerMinutos([[1, {}], [1, {}]], 'h').problema!, /sem repetir/);
    assert.match(lerMinutos([[60, {}]], 'h').problema!, /de 0 a 59/);
    assert.match(lerMinutos([[1, { cpu: 101 }]], 'h').problema!, /cpu/);
    assert.match(lerMinutos(Array.from({ length: 61 }, (_, i) => [i % 60, {}]), 'h').problema!, /até 60/);
  });

  it('a queda: com fuso, apaga antes de ligar, causa conhecida, nada no futuro', () => {
    const agora = new Date('2026-10-26T00:00:00Z');
    const ok = { desligou: '2026-10-24T11:49:19+00:00', ligou: '2026-10-25T07:44:08+00:00', causa: 'energia', bugcheck: null };
    assert.deepEqual(lerQueda(ok, agora).queda, ok);
    assert.deepEqual(lerQueda(null, agora), { queda: null });
    assert.match(lerQueda({ ...ok, causa: 'raio' }, agora).problema!, /causa/);
    assert.match(lerQueda({ ...ok, desligou: '2026-10-26T00:00:00+00:00' }, agora).problema!, /depois de ligar/);
    assert.match(lerQueda({ ...ok, ligou: '2026-10-27T00:00:00+00:00', desligou: null }, agora).problema!, /futuro/);
    assert.match(lerQueda({ ...ok, ligou: '2026-10-25T07:44:08' }, agora).problema!, /fuso/);
  });

  it('o resumo: médias pesadas, picos com a hora, minutos acima, sobrecarregado e esquentando com o porquê', () => {
    const h = (iso: string, amostras: number, cpu: number, cpuMax: number, extra: Partial<HoraDaSaude> = {}): HoraDaSaude => ({
      hora: new Date(iso), amostras, cpu: { media: cpu, max: cpuMax }, mem: { media: 40, max: 50 }, gpu: { media: null, max: null },
      sensores: null, minutos: null, ...extra,
    });
    const tranquilo = resumirSaude([h('2026-10-24T20:00:00Z', 120, 10, 20), h('2026-10-24T21:00:00Z', 40, 50, 60)]);
    assert.deepEqual(tranquilo.cpu, { media: 20, pico: { valor: 60, quando: '2026-10-24T21:00:00.000Z' } });
    assert.equal(tranquilo.gpu.media, null);
    assert.deepEqual([tranquilo.sobrecarregado, tranquilo.esquentando, tranquilo.porque], [false, false, []]);

    const minutos = Array.from({ length: 40 }, (_, m) => [m, { cpu: 95, gpuTempC: 85 }] as [number, Record<string, number>]);
    const quente = resumirSaude([
      h('2026-10-24T22:00:00Z', 120, 92, 99, {
        minutos,
        sensores: { gpuTempC: { soma: 120 * 80, amostras: 120, max: 86 }, gpuLimitaTemperatura: 3, discoSaude: 'atencao', ligadoHaH: 12 },
      }),
    ]);
    assert.equal(quente.minutosAcima.cpu, 40);
    assert.equal(quente.minutosAcima.gpuTempC, 40);
    assert.equal(quente.sobrecarregado, true, `${LIMITES.minutosParaSobrecarga}+ minutos acima no dia`);
    assert.equal(quente.esquentando, true);
    assert.deepEqual(quente.sensores.gpuTempC, { media: 80, pico: { valor: 86, quando: '2026-10-24T22:00:00.000Z' } });
    assert.equal(quente.placaSegurou.temperatura, 3);
    assert.deepEqual([quente.discoSaude, quente.ligadoHaH], ['atencao', 12]);
    assert.ok(quente.porque.some((p) => /placa chegou a 86 °C/.test(p)), quente.porque.join(' | '));
    assert.ok(quente.porque.some((p) => /segurou a frequência por temperatura em 3/.test(p)));
    assert.ok(quente.porque.some((p) => /disco pede atenção/.test(p)));
  });
});

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-saude-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-saude';
const SENHA = 'uma senha longa o bastante';

describe('o monitoramento da máquina (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  type Loja = { lojaId: string; cookie: string; token: string; agenteId: string };
  let a: Loja;
  let vizinha: Loja;

  async function montarLoja(nome: string): Promise<Loja> {
    const loja = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome }, loja: { nome: 'Matriz' }, setores: [{ nome: 'Cozinha' }] },
    })).json();
    const email = `sup-${nome}@e.com`;
    await app.inject({
      method: 'POST', url: '/v1/distribuicao/usuarios', headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId: loja.tenantId, nome: 'X', email, senha: SENHA, nivel: 'supervisao' },
    });
    const sessao = await app.inject({ method: 'POST', url: '/v1/sessao', payload: { email, senha: SENHA } });
    const b = sessao.headers['set-cookie'];
    const cookie = (Array.isArray(b) ? b[0]! : String(b)).split(';')[0]!;
    const agente = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/agentes', headers: { 'x-farol-admin': ADMIN }, payload: { lojaId: loja.loja.id, nome: 'PC' },
    })).json();
    const ativar = await app.inject({
      method: 'POST', url: '/v1/agentes/ativar', headers: { authorization: `Bearer ${agente.token}` },
      payload: { fingerprint: `fp-${randomUUID().slice(0, 10)}` },
    });
    assert.equal(ativar.statusCode, 200, ativar.body);
    const id = (await pool.query('select id from agente where loja_id = $1', [loja.loja.id])).rows[0].id as string;
    return { lojaId: loja.loja.id, cookie, token: agente.token as string, agenteId: id };
  }
  const mandar = (corpo: unknown, token = a.token) =>
    app.inject({ method: 'POST', url: '/v1/uso', headers: { authorization: `Bearer ${token}` }, payload: corpo as object });
  const saude = (loja: Loja, consulta = '', cookie = loja.cookie) =>
    app.inject({ method: 'GET', url: `/v1/lojas/${loja.lojaId}/computador/saude${consulta}`, headers: cookie ? { cookie } : {} });
  /** A queda do contrato (19 h 55 fora), mas de 3 horas atrás: o relatório mostra só as dos últimos 30 dias. */
  const quedaRecente = {
    ...CONTRATO.queda,
    desligou: new Date(Date.now() - 3 * 3600_000 - 1195 * 60_000).toISOString(),
    ligou: new Date(Date.now() - 3 * 3600_000).toISOString(),
  };
  /** Uma hora cheia de N horas atrás, em UTC. */
  const horaAtras = (n: number) => {
    const d = new Date(Date.now() - n * 3600_000);
    d.setUTCMinutes(0, 0, 0);
    return d.toISOString();
  };

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    app = criarApp(pool, { logger: false });
    await app.ready();
    a = await montarLoja(marca);
    vizinha = await montarLoja(`${marca}-vizinha`);
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  it('os sensores, os minutos e a queda entram; a queda uma vez só; o corpo antigo segue valendo', async () => {
    const comSensores = { ...HORA_COM_SENSORES(), hora: horaAtras(2) };
    (comSensores.sensores as Record<string, unknown>).campoDoFuturo = 7;
    const r = await mandar({ maquina: CONTRATO.maquina, horas: [comSensores, { ...copia(CONTRATO.hora), hora: horaAtras(1) }], queda: quedaRecente });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json(), { aceitos: 2, queda: 'nova' });
    const linhas = (await pool.query('select hora, sensores, minutos from uso_hora where agente_id = $1 order by hora', [a.agenteId])).rows;
    assert.equal(linhas.length, 2);
    assert.equal(linhas[0].sensores.gpuTempC.max, 61);
    assert.equal(linhas[0].sensores.campoDoFuturo, undefined, 'o campo desconhecido fica de fora');
    assert.equal(linhas[0].minutos.length, 2);
    assert.equal(linhas[1].sensores, null, 'a hora sem sensores (agente antigo)');
    // a mesma hora mandada de novo (o agente reenvia a hora com mais amostras): os sensores trocam
    const ontem = horaAtras(30);
    assert.equal((await mandar({ horas: [{ ...HORA_COM_SENSORES(), hora: ontem }] })).statusCode, 200);
    const maisQuente = HORA_COM_SENSORES();
    (maisQuente.sensores as Record<string, unknown>).gpuTempC = { soma: 96 * 70, amostras: 96, max: 75 };
    assert.equal((await mandar({ horas: [{ ...maisQuente, hora: ontem }] })).statusCode, 200);
    const reenviada = (await pool.query('select sensores from uso_hora where agente_id = $1 and hora = $2', [a.agenteId, ontem])).rows;
    assert.equal(reenviada[0].sensores.gpuTempC.max, 75, 'a hora reenviada leva os sensores novos');
    const deNovo = await mandar({ horas: [], queda: quedaRecente });
    assert.deepEqual(deNovo.json(), { aceitos: 0, queda: 'ja_tinha' });
    assert.equal((await pool.query('select count(*)::int as n from computador_queda where agente_id = $1', [a.agenteId])).rows[0].n, 1);
    const torta = await mandar({ horas: [{ ...comSensores, minutos: [[61, {}]] }] });
    assert.equal(torta.statusCode, 422);
    assert.match(torta.body, /minuto de 0 a 59/);
    const quedaTorta = await mandar({ horas: [], queda: { ...CONTRATO.queda, causa: 'raio' } });
    assert.equal(quedaTorta.statusCode, 422);
  });

  it('o relatório: as horas, o resumo das 24 h e do período, as quedas — só para a conta da loja', async () => {
    const r = await saude(a);
    assert.equal(r.statusCode, 200, r.body);
    const d = r.json();
    assert.equal(d.dias, 7);
    assert.equal(d.horas.length, 3);
    assert.deepEqual(d.horas.map((h: { sensores: { gpuTempC?: { max: number } } | null }) => h.sensores?.gpuTempC?.max ?? null), [75, 61, null]);
    // a hora de 30 h atrás entra no período e fica fora das últimas 24 h; o pico é o maior, com a hora dele
    assert.deepEqual(d.periodo.sensores.gpuTempC.pico, { valor: 75, quando: new Date(horaAtras(30)).toISOString() });
    assert.equal(d.ultimas24h.sensores.gpuTempC.pico.valor, 61);
    assert.equal(d.periodo.cpu.pico.valor, 64.25);
    assert.equal(d.ultimas24h.discoSaude, 'ok');
    assert.equal(d.ultimas24h.ligadoHaH, 15.2);
    assert.deepEqual(d.quedas.map((q: { causa: string; foraMin: number }) => [q.causa, q.foraMin]), [['energia', 1195]]);
    assert.equal(d.maquina.processador, CONTRATO.maquina.processador);
    assert.equal((await saude(a, '?dias=0')).statusCode, 422);
    assert.equal((await saude(a, '?dias=40')).statusCode, 422);
    assert.equal((await saude(a, '', '')).statusCode, 401);
    assert.equal((await app.inject({ method: 'GET', url: `/v1/lojas/${a.lojaId}/computador/saude`, headers: { cookie: vizinha.cookie } })).statusCode, 404);
    const vazia = (await saude(vizinha)).json();
    assert.deepEqual([vazia.horas.length, vazia.quedas.length, vazia.ultimas24h.sobrecarregado], [0, 0, false]);
  });
});
