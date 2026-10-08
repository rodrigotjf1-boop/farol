// O uso da máquina de análise: o que o agente manda (`POST /v1/uso`) e o
// que a tela de Análises recebe de volta.
//
// Lê `contratos/uso-da-maquina.json`, o mesmo arquivo que
// `agent/testes/test_uso.py` exige que o agente gere. Se um lado mudar um
// nome de campo, um dos dois testes quebra.
//
// O que tem de ficar provado:
//
//   - "não medi" não vira zero: peça sem amostra não tem pico nem média;
//   - a mesma hora sobe de novo e a nuvem troca o valor, sem duplicar;
//   - o uso é DA MÁQUINA: cada agente tem a sua linha, e a loja vizinha
//     não vê nem grava a desta;
//   - a hora e o dia voltam no relógio da loja.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { lerMaquina, validarUso } from '../src/rotas/uso.js';

const CONTRATO = JSON.parse(
  readFileSync(new URL('../../contratos/uso-da-maquina.json', import.meta.url), 'utf8'),
) as { maquina: Record<string, unknown>; hora: Record<string, unknown> };
const HORA = CONTRATO.hora;

// ───────────────── sem banco ─────────────────

describe('contrato do uso da máquina (validação)', () => {
  it('aceita o exemplo do contrato', () => {
    assert.equal(validarUso(HORA, 0), null);
    assert.deepEqual(lerMaquina(CONTRATO.maquina).maquina, CONTRATO.maquina);
  });

  it('aceita a máquina que não mede a placa de vídeo: zero amostras, sem pico', () => {
    assert.equal(validarUso({ ...HORA, gpuSoma: 0, gpuAmostras: 0, gpuMax: null }, 0), null);
    // e a que não mediu o disco
    assert.equal(validarUso({ ...HORA, discoLivreGb: null, discoTotalGb: null, processoMemMaxMb: null }, 0), null);
  });

  it('recusa hora sem fuso e hora quebrada', () => {
    assert.match(String(validarUso({ ...HORA, hora: '2026-10-07T20:00:00' }, 0)), /fuso/);
    assert.match(String(validarUso({ ...HORA, hora: '2026-10-07T20:30:00-03:00' }, 0)), /hora cheia/);
    assert.match(String(validarUso({ ...HORA, hora: 'ontem' }, 0)), /hora/);
  });

  it('recusa quantidade impossível', () => {
    assert.match(String(validarUso({ ...HORA, amostras: 0 }, 0)), /amostras/);
    assert.match(String(validarUso({ ...HORA, amostras: 1.5 }, 0)), /amostras/);
    assert.match(String(validarUso({ ...HORA, amostras: 1_000_000 }, 0)), /amostras/);
    // peça com mais amostras que a hora inteira
    assert.match(String(validarUso({ ...HORA, cpuAmostras: 97 }, 0)), /cpuAmostras/);
    assert.match(String(validarUso({ ...HORA, memAmostras: -1 }, 0)), /memAmostras/);
  });

  it('recusa porcentagem impossível: acima de 100, média maior que o pico', () => {
    assert.match(String(validarUso({ ...HORA, cpuMax: 340 }, 0)), /cpuMax/);
    assert.match(String(validarUso({ ...HORA, memSoma: 96 * 100 + 50 }, 0)), /memSoma/);
    // 96 amostras somando 7.000 dão média 72,9; o pico informado é 64,25
    assert.match(String(validarUso({ ...HORA, cpuSoma: 7000 }, 0)), /média maior que o pico/);
    assert.match(String(validarUso({ ...HORA, gpuSoma: -1 }, 0)), /gpuSoma/);
  });

  it('recusa pico sem amostra e amostra sem pico', () => {
    assert.match(String(validarUso({ ...HORA, gpuSoma: 0, gpuAmostras: 0 }, 0)), /sem amostra não há pico/);
    assert.match(String(validarUso({ ...HORA, gpuMax: null }, 0)), /pico é obrigatório/);
  });

  it('recusa disco livre maior que o disco', () => {
    assert.match(String(validarUso({ ...HORA, discoLivreGb: 500 }, 0)), /maior que o disco inteiro/);
    assert.match(String(validarUso({ ...HORA, discoTotalGb: -3 }, 0)), /discoTotalGb/);
  });

  it('da máquina só entram os quatro campos conhecidos, cortados', () => {
    const lida = lerMaquina({ processador: `  ${'x'.repeat(500)}  `, nucleos: 16, memoriaGb: 15.9, placaDeVideo: '', senha: 'não entra', usuario: 'nem isto' });
    assert.equal(lida.problema, undefined);
    assert.deepEqual(Object.keys(lida.maquina!).sort(), ['memoriaGb', 'nucleos', 'placaDeVideo', 'processador']);
    assert.equal(lida.maquina!.processador!.length, 200);
    assert.equal(lida.maquina!.placaDeVideo, null);

    assert.equal(lerMaquina(undefined).maquina, null);
    assert.match(String(lerMaquina('i7').problema), /maquina/);
    assert.match(String(lerMaquina({ nucleos: 0 }).problema), /nucleos/);
    assert.match(String(lerMaquina({ memoriaGb: 'muita' }).problema), /memoriaGb/);
    assert.match(String(lerMaquina({ processador: 7 }).problema), /processador/);
  });
});

// ───────────────── com banco ─────────────────

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-uso-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-uso';
const SENHA = 'uma senha longa o bastante';
const FUSO = 'America/Sao_Paulo';

function diaDaLoja(atras = 0): string {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(new Date());
  const [a, m, d] = hoje.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d - atras)).toISOString().slice(0, 10);
}
const HOJE = diaDaLoja();
const ONTEM = diaDaLoja(1);
const hora = (dia: string, h: number) => `${dia}T${String(h).padStart(2, '0')}:00:00-03:00`;

type HoraDeUso = {
  agenteId: string; dia: string; hora: number; amostras: number;
  cpuSoma: number; cpuAmostras: number; cpuMax: number | null;
  memSoma: number; memAmostras: number; memMax: number | null;
  gpuSoma: number; gpuAmostras: number; gpuMax: number | null;
  farolCpuSoma: number; farolCpuAmostras: number; farolCpuMax: number | null; farolMemMaxMb: number | null;
  discoLivreGb: number | null; discoTotalGb: number | null;
};

describe('uso da máquina (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;

  type Loja = { lojaId: string; cookie: string; token: string; agenteId: string };
  let a: Loja;
  let vizinha: Loja;
  let segundo = { token: '', agenteId: '' };

  async function novoAgente(lojaId: string, nome: string) {
    const agente = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/agentes', headers: { 'x-farol-admin': ADMIN }, payload: { lojaId, nome },
    })).json();
    const ativar = await app.inject({
      method: 'POST', url: '/v1/agentes/ativar', headers: { authorization: `Bearer ${agente.token}` },
      payload: { fingerprint: `fp-${randomUUID().slice(0, 10)}` },
    });
    assert.equal(ativar.statusCode, 200, ativar.body);
    const id = (await pool.query('select id from agente where loja_id = $1 and nome = $2', [lojaId, nome])).rows[0].id as string;
    return { token: agente.token as string, agenteId: id };
  }

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
    return { lojaId: loja.loja.id, cookie, ...(await novoAgente(loja.loja.id, 'PC da loja')) };
  }

  const mandar = (corpo: unknown, token = a.token) =>
    app.inject({ method: 'POST', url: '/v1/uso', headers: token ? { authorization: `Bearer ${token}` } : {}, payload: corpo as object });

  const gravadas = async (agenteId: string) =>
    (await pool.query('select * from uso_hora where agente_id = $1 order by hora', [agenteId])).rows;

  const analises = async (loja: Loja, consulta = '') =>
    (await app.inject({ method: 'GET', url: `/v1/lojas/${loja.lojaId}/analises${consulta}`, headers: { cookie: loja.cookie } })).json();

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    app = criarApp(pool, { logger: false });
    await app.ready();
    a = await montarLoja(marca);
    vizinha = await montarLoja(`${marca}-vizinha`);
    segundo = await novoAgente(a.lojaId, 'PC do caixa');
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  it('o corpo do contrato é gravado, coluna por coluna, e a máquina fica no agente', async () => {
    const r = await mandar({ maquina: CONTRATO.maquina, horas: [{ ...HORA, hora: hora(HOJE, 20) }] });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json(), { aceitos: 1 });

    const linhas = await gravadas(a.agenteId);
    assert.equal(linhas.length, 1);
    const l = linhas[0];
    assert.equal(l.loja_id, a.lojaId);
    assert.equal(new Date(l.hora).toISOString(), new Date(hora(HOJE, 20)).toISOString());
    assert.equal(l.amostras, 96);
    assert.deepEqual([Number(l.cpu_soma), l.cpu_amostras, Number(l.cpu_max)], [1728.5, 96, 64.25]);
    assert.deepEqual([Number(l.mem_soma), l.mem_amostras, Number(l.mem_max)], [4896, 96, 55.1]);
    assert.deepEqual([Number(l.gpu_soma), l.gpu_amostras, Number(l.gpu_max)], [768, 95, 57.3]);
    assert.deepEqual([Number(l.proc_cpu_soma), l.proc_cpu_amostras, Number(l.proc_cpu_max)], [220.8, 95, 6.4]);
    assert.equal(Number(l.proc_mem_max_mb), 355.2);
    assert.deepEqual([Number(l.disco_livre_gb), Number(l.disco_total_gb)], [64.12, 223]);

    const agente = (await pool.query('select maquina from agente where id = $1', [a.agenteId])).rows[0];
    assert.deepEqual(agente.maquina, CONTRATO.maquina);
  });

  it('a mesma hora sobe de novo, maior: a nuvem troca, não duplica nem soma', async () => {
    const maior = { ...HORA, hora: hora(HOJE, 20), amostras: 120, cpuSoma: 2400, cpuAmostras: 120, cpuMax: 71.5, memAmostras: 120, memSoma: 6000, gpuAmostras: 119, processoCpuAmostras: 119, discoLivreGb: 63.9 };
    assert.equal((await mandar({ horas: [maior] })).statusCode, 200);

    const linhas = await gravadas(a.agenteId);
    assert.equal(linhas.length, 1, 'a hora foi duplicada');
    assert.deepEqual([linhas[0].amostras, Number(linhas[0].cpu_soma), Number(linhas[0].cpu_max), Number(linhas[0].disco_livre_gb)], [120, 2400, 71.5, 63.9]);
    // sem `maquina` no corpo, o que o agente já disse continua lá
    const agente = (await pool.query('select maquina from agente where id = $1', [a.agenteId])).rows[0];
    assert.deepEqual(agente.maquina, CONTRATO.maquina);
  });

  it('a mesma hora duas vezes no lote não derruba o lote: vale a última', async () => {
    const r = await mandar({
      horas: [
        { ...HORA, hora: hora(HOJE, 21), amostras: 10, cpuSoma: 100, cpuAmostras: 10, cpuMax: 20, memAmostras: 10, memSoma: 500, gpuAmostras: 10, gpuSoma: 50, processoCpuAmostras: 10, processoCpuSoma: 20 },
        { ...HORA, hora: hora(HOJE, 21), amostras: 30, cpuSoma: 600, cpuAmostras: 30, cpuMax: 40, memAmostras: 30, memSoma: 1500, gpuAmostras: 30, gpuSoma: 150, processoCpuAmostras: 30, processoCpuSoma: 60 },
      ],
    });
    assert.equal(r.statusCode, 200, r.body);
    const das21 = (await gravadas(a.agenteId)).filter((l) => new Date(l.hora).toISOString() === new Date(hora(HOJE, 21)).toISOString());
    assert.equal(das21.length, 1);
    assert.deepEqual([das21[0].amostras, Number(das21[0].cpu_max)], [30, 40]);
  });

  it('máquina que não mede a placa: zero amostras e pico nulo, do banco à tela', async () => {
    const semPlaca = { ...HORA, hora: hora(HOJE, 19), gpuSoma: 0, gpuAmostras: 0, gpuMax: null };
    assert.equal((await mandar({ horas: [semPlaca] })).statusCode, 200);

    const horas = (await analises(a)).maquina.horas as HoraDeUso[];
    const das19 = horas.find((h) => h.agenteId === a.agenteId && h.hora === 19)!;
    assert.deepEqual([das19.gpuAmostras, das19.gpuSoma, das19.gpuMax], [0, 0, null]);
    assert.deepEqual([das19.cpuAmostras, das19.cpuMax], [96, 64.25]);
  });

  it('cada máquina tem a sua linha, e a loja vizinha não vê nem escreve a desta', async () => {
    // o segundo computador da MESMA loja, na mesma hora
    assert.equal((await mandar({ maquina: { ...CONTRATO.maquina, processador: 'Outro processador' }, horas: [{ ...HORA, hora: hora(HOJE, 20), cpuMax: 99 }] }, segundo.token)).statusCode, 200);
    // a loja vizinha, na mesma hora
    assert.equal((await mandar({ maquina: CONTRATO.maquina, horas: [{ ...HORA, hora: hora(HOJE, 20), cpuMax: 77 }] }, vizinha.token)).statusCode, 200);

    const daLoja = await analises(a);
    const das20 = (daLoja.maquina.horas as HoraDeUso[]).filter((h) => h.hora === 20);
    assert.deepEqual(das20.map((h) => [h.agenteId, h.cpuMax]).sort(), [[a.agenteId, 71.5], [segundo.agenteId, 99]].sort());
    assert.ok(!das20.some((h) => h.cpuMax === 77), 'a tela mostrou a máquina da loja vizinha');
    assert.deepEqual(
      (daLoja.maquina.agentes as { id: string; nome: string; processador: string }[]).map((m) => [m.id, m.nome, m.processador]).sort(),
      [[a.agenteId, 'PC da loja', CONTRATO.maquina.processador], [segundo.agenteId, 'PC do caixa', 'Outro processador']].sort(),
    );

    const daVizinha = await analises(vizinha);
    assert.deepEqual((daVizinha.maquina.horas as HoraDeUso[]).map((h) => [h.agenteId, h.cpuMax]), [[vizinha.agenteId, 77]]);
    // o que a vizinha gravou está NA loja dela
    assert.equal((await gravadas(vizinha.agenteId))[0].loja_id, vizinha.lojaId);
  });

  it('a tela recebe a hora e o dia no relógio da loja, só do intervalo pedido', async () => {
    // 0h e 23h de ontem na loja: em UTC caem em dois dias diferentes
    assert.equal((await mandar({ horas: [{ ...HORA, hora: hora(ONTEM, 0), cpuMax: 91 }, { ...HORA, hora: hora(ONTEM, 23), cpuMax: 92 }] })).statusCode, 200);

    const ontem = (await analises(a, `?de=${ONTEM}`)).maquina.horas as HoraDeUso[];
    assert.deepEqual(ontem.filter((h) => h.agenteId === a.agenteId).map((h) => [h.dia, h.hora, h.cpuMax]), [[ONTEM, 0, 91], [ONTEM, 23, 92]]);

    const hoje = (await analises(a)).maquina.horas as HoraDeUso[];
    assert.ok(hoje.length > 0 && hoje.every((h) => h.dia === HOJE), 'veio hora de outro dia');

    const dois = (await analises(a, `?de=${ONTEM}&ate=${HOJE}`)).maquina.horas as HoraDeUso[];
    assert.deepEqual([...new Set(dois.map((h) => h.dia))].sort(), [ONTEM, HOJE].sort());
  });

  it('a parte do Farol e o disco chegam à tela', async () => {
    const horas = (await analises(a)).maquina.horas as HoraDeUso[];
    const das19 = horas.find((h) => h.agenteId === a.agenteId && h.hora === 19)!;
    assert.deepEqual([das19.farolCpuSoma, das19.farolCpuAmostras, das19.farolCpuMax, das19.farolMemMaxMb], [220.8, 95, 6.4, 355.2]);
    assert.deepEqual([das19.discoLivreGb, das19.discoTotalGb], [64.12, 223]);
    assert.equal(das19.amostras, 96);
  });

  it('agente cadastrado que nunca mediu nem disse de que é feito não aparece como máquina', async () => {
    const mudo = await novoAgente(a.lojaId, 'PC que nunca ligou');
    const agentes = (await analises(a)).maquina.agentes as { id: string }[];
    assert.ok(!agentes.some((m) => m.id === mudo.agenteId));
  });

  it('corpo torto: 400 sem a lista, 422 com a frase do problema, nada gravado', async () => {
    assert.equal((await mandar({ maquina: CONTRATO.maquina })).statusCode, 400);
    const antes = (await gravadas(a.agenteId)).length;
    const r = await mandar({ maquina: { nucleos: 'dezesseis' }, horas: [{ ...HORA, hora: hora(HOJE, 5) }, { ...HORA, hora: hora(HOJE, 6), cpuMax: 340 }] });
    assert.equal(r.statusCode, 422, r.body);
    assert.equal(r.json().erro, 'validacao');
    assert.equal(r.json().problemas.length, 2);
    assert.match(r.json().problemas.join(' | '), /maquina\.nucleos/);
    assert.match(r.json().problemas.join(' | '), /horas\[1\]\.cpuMax/);
    assert.equal((await gravadas(a.agenteId)).length, antes, 'gravou a hora boa de um lote recusado');
  });

  it('sem token, ou com token que não existe, 401', async () => {
    assert.equal((await mandar({ horas: [] }, '')).statusCode, 401);
    assert.equal((await mandar({ horas: [] }, 'fa_token_que_nao_existe')).statusCode, 401);
  });
});
