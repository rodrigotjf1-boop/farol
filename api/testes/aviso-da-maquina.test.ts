// O aviso da máquina (A26, M3; migration 059): o computador do agente esquentando ou sobrecarregado vira envio pelos
// destinos dos alertas. O que tem de ficar provado:
//
//   - a régua: 10 minutos quentes NA ÚLTIMA HORA (um pico solto não toca o celular); o disco pelo pico da hora; a
//     sobrecarga com 30 minutos nas últimas 12 horas E acontecendo agora; os limites são os da tela (>=);
//   - um de cada tipo a cada 12 horas por computador, contadas desde o último aviso; reenviar a hora não repete;
//   - para quem: pela política (o veto cala); sem destino, não marca — e sai quando houver destino;
//   - o console vê o tipo na lista "Chegou?"; a loja de outra conta não recebe o aviso desta.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import {
  GRAVIDADE,
  REGUA_DO_AVISO,
  avaliarAvisos,
  avisarDaMaquina,
  textoDoAviso,
  type HoraDoAviso,
} from '../src/aviso-da-maquina.js';
import { LIMITES, type MinutoDaHora } from '../src/saude-da-maquina.js';

const MIN = 60_000;
const FUSO = 'America/Sao_Paulo';
/** 20:37:20 no relógio da loja (UTC−3): o minuto em curso tem 20 segundos. */
const AGORA = new Date('2026-10-25T23:37:20Z');

type Picos = Record<string, number>;
/** As horas com o pico de cada minuto `atras` minutos antes de `agora` (o minuto em que aquele instante cai). */
function horasCom(agora: Date, lista: [number, Picos][], sensores: Map<number, HoraDoAviso['sensores']> = new Map()): HoraDoAviso[] {
  const porHora = new Map<number, MinutoDaHora[]>();
  for (const [atras, picos] of lista) {
    const t = agora.getTime() - atras * MIN;
    const h = Math.floor(t / 3600_000) * 3600_000;
    const m = Math.floor((t - h) / MIN);
    if (!porHora.has(h)) porHora.set(h, []);
    porHora.get(h)!.push([m, picos]);
  }
  for (const h of sensores.keys()) if (!porHora.has(h)) porHora.set(h, []);
  return [...porHora].map(([h, minutos]) => ({ hora: new Date(h), sensores: sensores.get(h) ?? null, minutos }));
}
const seguidos = (de: number, ate: number, picos: Picos): [number, Picos][] =>
  Array.from({ length: ate - de + 1 }, (_, i) => [de + i, { ...picos }] as [number, Picos]);
const horaDe = (agora: Date, horasAtras: number) => (Math.floor(agora.getTime() / 3600_000) - horasAtras) * 3600_000;

describe('o aviso da máquina: a régua (sem banco)', () => {
  it('a placa de vídeo quente em 10 minutos da última hora avisa, com o pico na hora da loja', () => {
    const lista = seguidos(0, 9, { gpuTempC: 85 });
    lista[3] = [3, { gpuTempC: 88 }];
    const avisos = avaliarAvisos(horasCom(AGORA, lista), AGORA, FUSO);
    assert.equal(avisos.length, 1);
    assert.equal(avisos[0]!.tipo, 'esquentando');
    assert.deepEqual(avisos[0]!.porque, ['a placa de vídeo passou de 83 °C em 10 minutos da última hora (chegou a 88 °C às 20:34)']);
    assert.equal(avisos[0]!.desde, '2026-10-25T23:28:00.000Z');
    assert.equal(avisos[0]!.ate, '2026-10-25T23:37:00.000Z');
  });

  it('9 minutos quentes não avisam; o pico solto também não', () => {
    assert.deepEqual(avaliarAvisos(horasCom(AGORA, seguidos(0, 8, { gpuTempC: 90 })), AGORA, FUSO), []);
    assert.deepEqual(avaliarAvisos(horasCom(AGORA, [[2, { gpuTempC: 99 }]]), AGORA, FUSO), []);
  });

  it('só a última hora conta: 10 minutos que terminam há 50 avisam; os que passam de 60 ficam de fora', () => {
    assert.equal(avaliarAvisos(horasCom(AGORA, seguidos(50, 59, { gpuTempC: 84 })), AGORA, FUSO).length, 1);
    assert.deepEqual(avaliarAvisos(horasCom(AGORA, seguidos(55, 64, { gpuTempC: 84 })), AGORA, FUSO), [], 'só 5 dentro da hora');
  });

  it('o limite é o da tela e conta a partir dele (>=)', () => {
    assert.equal(avaliarAvisos(horasCom(AGORA, seguidos(0, 9, { gpuTempC: LIMITES.gpuTempC })), AGORA, FUSO).length, 1);
    assert.deepEqual(avaliarAvisos(horasCom(AGORA, seguidos(0, 9, { gpuTempC: LIMITES.gpuTempC - 0.1 })), AGORA, FUSO), []);
    const mae = avaliarAvisos(horasCom(AGORA, seguidos(0, 9, { tempPlacaMaeC: LIMITES.tempPlacaMaeC })), AGORA, FUSO);
    assert.match(mae[0]!.porque[0]!, /^a placa-mãe passou de 70 °C em 10 minutos/);
    assert.deepEqual(avaliarAvisos(horasCom(AGORA, seguidos(0, 9, { tempPlacaMaeC: 69.9 })), AGORA, FUSO), []);
  });

  it('o disco pelo pico da hora em curso ou da anterior; o de 3 horas atrás não', () => {
    const quente = { discoTempC: { soma: 244, amostras: 4, max: 61.5 } };
    const agora = avaliarAvisos(horasCom(AGORA, [], new Map([[horaDe(AGORA, 0), quente]])), AGORA, FUSO);
    assert.deepEqual(agora[0]!.porque, ['o disco chegou a 61,5 °C (passa de 60 °C)']);
    assert.equal(avaliarAvisos(horasCom(AGORA, [], new Map([[horaDe(AGORA, 1), quente]])), AGORA, FUSO).length, 1);
    assert.deepEqual(avaliarAvisos(horasCom(AGORA, [], new Map([[horaDe(AGORA, 3), quente]])), AGORA, FUSO), []);
    const morno = { discoTempC: { soma: 236, amostras: 4, max: 59.9 } };
    assert.deepEqual(avaliarAvisos(horasCom(AGORA, [], new Map([[horaDe(AGORA, 0), morno]])), AGORA, FUSO), []);
    const noLimite = { discoTempC: { soma: 236, amostras: 4, max: LIMITES.discoTempC } };
    assert.equal(avaliarAvisos(horasCom(AGORA, [], new Map([[horaDe(AGORA, 0), noLimite]])), AGORA, FUSO).length, 1, '60 °C já avisa (>=)');
    // a hora que ainda não começou (relógio da loja adiantado) não conta
    assert.deepEqual(avaliarAvisos(horasCom(AGORA, [], new Map([[horaDe(AGORA, -1), quente]])), AGORA, FUSO), []);
  });

  it('a placa e o disco juntos: um aviso só, com os dois porquês, a placa primeiro', () => {
    const disco = new Map([[horaDe(AGORA, 0), { discoTempC: { soma: 248, amostras: 4, max: 62 } }]]);
    const avisos = avaliarAvisos(horasCom(AGORA, seguidos(0, 11, { gpuTempC: 86 }), disco), AGORA, FUSO);
    assert.equal(avisos.length, 1);
    assert.equal(avisos[0]!.porque.length, 2);
    assert.match(avisos[0]!.porque[0]!, /^a placa de vídeo passou de 83 °C em 12 minutos/);
    assert.match(avisos[0]!.porque[1]!, /^o disco chegou a 62 °C/);
  });

  it('a sobrecarga: 30 minutos nas últimas 12 horas, com um deles agora', () => {
    const avisos = avaliarAvisos(horasCom(AGORA, seguidos(0, 29, { cpu: 95 })), AGORA, FUSO);
    assert.equal(avisos.length, 1);
    assert.equal(avisos[0]!.tipo, 'sobrecarregado');
    assert.deepEqual(avisos[0]!.porque, ['o processador passou de 90% em 30 minutos das últimas 12 horas (o mais recente às 20:37)']);
    assert.deepEqual(avaliarAvisos(horasCom(AGORA, seguidos(0, 28, { cpu: 95 })), AGORA, FUSO), [], '29 minutos');
    // 30 minutos, mas o último há 20: já passou — o aviso é do que está acontecendo
    assert.deepEqual(avaliarAvisos(horasCom(AGORA, seguidos(20, 49, { cpu: 95 })), AGORA, FUSO), []);
    // o último há 14 ainda é agora
    assert.equal(avaliarAvisos(horasCom(AGORA, seguidos(14, 43, { cpu: 95 })), AGORA, FUSO).length, 1);
  });

  it('a sobrecarga conta só as últimas 12 horas, espalhada; memória e placa pelos limites delas', () => {
    const fora = seguidos(12 * 60, 12 * 60 + 9, { mem: 97 }); // 10 minutos há 12 horas: fora
    const dentro = [...seguidos(300, 319, { mem: 97 }), ...seguidos(0, 9, { mem: 97 })]; // 20 + 10
    assert.equal(avaliarAvisos(horasCom(AGORA, [...fora, ...dentro]), AGORA, FUSO)[0]!.porque[0], 'a memória passou de 90% em 30 minutos das últimas 12 horas (o mais recente às 20:37)');
    assert.deepEqual(avaliarAvisos(horasCom(AGORA, [...fora, ...seguidos(0, 19, { mem: 97 })]), AGORA, FUSO), []);
    assert.equal(avaliarAvisos(horasCom(AGORA, seguidos(0, 29, { gpu: LIMITES.gpuPct })), AGORA, FUSO).length, 1);
    assert.deepEqual(avaliarAvisos(horasCom(AGORA, seguidos(0, 29, { gpu: LIMITES.gpuPct - 0.1 })), AGORA, FUSO), []);
  });

  it('o minuto que ainda não chegou (relógio da loja adiantado) não conta', () => {
    const futuro = seguidos(-12, -1, { gpuTempC: 90 }); // 12 minutos à frente de agora
    assert.deepEqual(avaliarAvisos(horasCom(AGORA, futuro), AGORA, FUSO), []);
  });

  it('esquentando e sobrecarregado ao mesmo tempo: os dois', () => {
    const avisos = avaliarAvisos(horasCom(AGORA, seguidos(0, 29, { cpu: 99, gpuTempC: 87 })), AGORA, FUSO);
    assert.deepEqual(avisos.map((a) => a.tipo), ['esquentando', 'sobrecarregado']);
  });

  it('o texto pronto e a gravidade', () => {
    const [aviso] = avaliarAvisos(horasCom(AGORA, seguidos(0, 9, { gpuTempC: 85 })), AGORA, FUSO);
    assert.equal(
      textoDoAviso(aviso!, 'Matriz'),
      'Farol · Matriz: o computador do agente está esquentando. A placa de vídeo passou de 83 °C em 10 minutos da '
        + 'última hora (chegou a 85 °C às 20:28). Calor demais deixa a auditoria lenta e pode desligar o computador. '
        + 'No console: Computador da loja › Saúde.',
    );
    // os dois alcançam os destinos da loja sem política (prioridade urgente); a severidade separa no veto
    assert.deepEqual(GRAVIDADE, {
      esquentando: { severidade: 'critico', prioridade: 'urgente' },
      sobrecarregado: { severidade: 'atencao', prioridade: 'urgente' },
    });
    assert.equal(REGUA_DO_AVISO.repetirH, 12);
  });
});

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-aviso-maquina-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-aviso-maquina';
const SENHA = 'uma senha longa o bastante';

type Contrato = { hora: Record<string, unknown>; sensoresDaHora: { sensores: Record<string, unknown> } };
const CONTRATO = JSON.parse(readFileSync(new URL('../../contratos/uso-da-maquina.json', import.meta.url), 'utf8')) as Contrato;
const copia = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe('o aviso da máquina (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  type Loja = { tenantId: string; lojaId: string; cookie: string; token: string; agenteId: string };
  let a: Loja;

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
    return { tenantId: loja.tenantId, lojaId: loja.loja.id, cookie, token: agente.token as string, agenteId: id };
  }
  const destino = async (l: Loja, nome = 'Dono') => (await pool.query(
    `insert into destino (tenant_id, loja_id, tipo, nome, endereco)
     values ($1, $2, 'whatsapp', $3, $4) returning id`,
    [l.tenantId, l.lojaId, nome, `+55219${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`],
  )).rows[0].id as string;

  /** O corpo de `POST /v1/uso` com os minutos dados (`atras` minutos antes de agora), na hora em que cada um cai. */
  function corpoCom(lista: [number, Picos][]) {
    const agora = new Date();
    const horas = horasCom(agora, lista);
    return {
      horas: horas.map((h) => ({
        ...copia(CONTRATO.hora),
        ...copia(CONTRATO.sensoresDaHora),
        hora: h.hora.toISOString().replace('.000Z', 'Z'),
        minutos: h.minutos,
      })),
    };
  }
  const mandar = (corpo: unknown, l: Loja = a) =>
    app.inject({ method: 'POST', url: '/v1/uso', headers: { authorization: `Bearer ${l.token}` }, payload: corpo as object });
  const envios = async (l: Loja = a) => (await pool.query(
    `select destino_id, chave, payload from envio where loja_id = $1 and motivo = 'computador' order by criado_em, chave`, [l.lojaId],
  )).rows as { destino_id: string; chave: string; payload: Record<string, unknown> }[];
  const marcas = async (l: Loja = a) =>
    (await pool.query('select tipo, ultimo_em from computador_aviso where agente_id = $1 order by tipo', [l.agenteId])).rows;
  const QUENTE = seguidos(0, 11, { cpu: 40, mem: 50, gpu: 60, gpuTempC: 87 });

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    app = criarApp(pool, { logger: false });
    await app.ready();
    a = await montarLoja(marca);
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  it('sem destino na loja: o uso entra, nenhum envio, e a marca NÃO fica (o aviso sai quando houver para quem)', async () => {
    const r = await mandar(corpoCom(QUENTE));
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(await envios().then((e) => e.length), 0);
    assert.deepEqual(await marcas(), []);
  });

  it('com destino: o computador quente vira UM envio por destino, com o texto pronto; a marca fica', async () => {
    const d1 = await destino(a, 'Dono');
    const d2 = await destino(a, 'Gerente');
    assert.equal((await mandar(corpoCom(QUENTE))).statusCode, 200);
    const e = await envios();
    assert.deepEqual(e.map((x) => x.destino_id).sort(), [d1, d2].sort());
    const p = e[0]!.payload;
    assert.equal(p.tipo, 'esquentando');
    assert.equal(p.loja, 'Matriz');
    assert.equal(p.agente, 'PC');
    assert.match(String(p.texto), /^Farol · Matriz: o computador do agente está esquentando\. A placa de vídeo passou de 83 °C em 12 minutos da última hora \(chegou a 87 °C às \d{2}:\d{2}\)\./);
    assert.match(String(p.desde), /Z$/, 'o instante com o fuso (V29)');
    assert.match(e[0]!.chave, new RegExp(`^computador:${a.agenteId}:esquentando:`));
    assert.deepEqual((await marcas()).map((m) => m.tipo), ['esquentando']);
  });

  it('o agente reenvia a hora (5 em 5 minutos) e o calor continua: não repete', async () => {
    assert.equal((await mandar(corpoCom(seguidos(0, 20, { gpuTempC: 89 })))).statusCode, 200);
    assert.equal((await mandar(corpoCom(seguidos(0, 20, { gpuTempC: 90 })))).statusCode, 200);
    assert.equal((await envios()).length, 2, 'os dois do primeiro aviso, só');
  });

  it('12 horas depois do último aviso, o calor de agora avisa de novo (contadas desde o aviso, V22)', async () => {
    await pool.query(`update computador_aviso set ultimo_em = now() - interval '11 hours 59 minutes' where agente_id = $1`, [a.agenteId]);
    await mandar(corpoCom(QUENTE));
    assert.equal((await envios()).length, 2, '11 h 59 min: ainda não');
    await pool.query(`update computador_aviso set ultimo_em = now() - interval '12 hours 1 minute' where agente_id = $1`, [a.agenteId]);
    await mandar(corpoCom(QUENTE));
    const e = await envios();
    assert.equal(e.length, 4, 'o aviso novo, para os dois destinos');
    assert.equal(new Set(e.map((x) => x.chave)).size, 4, 'chaves diferentes: é outro aviso');
  });

  it('a sobrecarga junto do calor: o outro tipo tem a marca dele', async () => {
    assert.equal((await mandar(corpoCom(seguidos(0, 34, { cpu: 97, gpuTempC: 50 })))).statusCode, 200);
    const e = await envios();
    assert.equal(e.filter((x) => x.payload.tipo === 'sobrecarregado').length, 2);
    assert.match(String(e.find((x) => x.payload.tipo === 'sobrecarregado')!.payload.texto), /o computador do agente está sobrecarregado\. O processador passou de 90% em 35 minutos/);
    assert.deepEqual((await marcas()).map((m) => m.tipo), ['esquentando', 'sobrecarregado']);
  });

  it('o veto da política cala a combinação (e não marca: o veto tirado, o aviso sai)', async () => {
    const b = await montarLoja(`${marca}-veto`);
    const dono = await destino(b);
    await pool.query(
      `insert into politica_alerta (tenant_id, loja_id, severidade, prioridade, enviar) values ($1, $2, 'critico', 'urgente', false)`,
      [b.tenantId, b.lojaId],
    );
    assert.equal((await mandar(corpoCom(QUENTE), b)).statusCode, 200);
    assert.equal((await envios(b)).length, 0);
    assert.deepEqual(await marcas(b), []);
    // a política que manda a atenção para um destino só leva a sobrecarga para ele
    await pool.query('delete from politica_alerta where loja_id = $1', [b.lojaId]);
    const so = await destino(b, 'Técnico');
    await pool.query(
      `insert into politica_alerta (tenant_id, loja_id, severidade, prioridade, enviar, destino_id) values ($1, $2, 'atencao', null, true, $3)`,
      [b.tenantId, b.lojaId, so],
    );
    assert.equal((await mandar(corpoCom(seguidos(0, 31, { cpu: 96, gpuTempC: 87 })), b)).statusCode, 200);
    const e = await envios(b);
    const de = (tipo: string) => e.filter((x) => x.payload.tipo === tipo).map((x) => x.destino_id).sort();
    assert.deepEqual(de('sobrecarregado'), [so], 'a atenção vai só para a linha que casa');
    // o calor (crítico/urgente) sem linha que case: o urgente alcança todos os destinos (`resolverDestinos`)
    assert.deepEqual(de('esquentando'), [dono, so].sort());
  });

  it('o aviso de uma loja não vai para os destinos de outra', async () => {
    const c = await montarLoja(`${marca}-outra`);
    const delaC = await destino(c, 'Dono da C');
    // a loja A sem a marca do calor: o aviso novo sai — só para os destinos de A
    await pool.query(`delete from computador_aviso where agente_id = $1 and tipo = 'esquentando'`, [a.agenteId]);
    assert.equal((await mandar(corpoCom(QUENTE))).statusCode, 200);
    assert.equal((await envios()).filter((x) => x.payload.tipo === 'esquentando').length, 6);
    assert.equal((await pool.query('select count(*) from envio where destino_id = $1', [delaC])).rows[0].count, '0');
  });

  it('duas subidas juntas do mesmo agente não avisam duas vezes (a marca troca na instrução que cria os envios)', async () => {
    const d = await montarLoja(`${marca}-corrida`);
    await destino(d);
    const corpo = corpoCom(QUENTE);
    const rs = await Promise.all([mandar(corpo, d), mandar(corpo, d), mandar(corpo, d)]);
    for (const r of rs) assert.equal(r.statusCode, 200, r.body);
    assert.equal((await envios(d)).length, 1);
    const direto = await Promise.all([1, 2, 3].map(() => avisarDaMaquina(pool, d)));
    assert.equal(direto.reduce((s, x) => s + x.criados, 0), 0, 'com a marca recente, ninguém cria');
  });

  it('o console vê o tipo do aviso em "Chegou?"', async () => {
    const r = await app.inject({ method: 'GET', url: `/v1/lojas/${a.lojaId}/envios`, headers: { cookie: a.cookie } });
    assert.equal(r.statusCode, 200, r.body);
    const lista = r.json().envios as { motivo: string; computador: string | null }[];
    const daMaquina = lista.filter((x) => x.motivo === 'computador');
    assert.equal(daMaquina.length, 8);
    assert.deepEqual([...new Set(daMaquina.map((x) => x.computador))].sort(), ['esquentando', 'sobrecarregado']);
  });
});
