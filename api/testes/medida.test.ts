// A medida de cada olhada — quantos objetos o detector viu — guardada por
// hora. É a matéria-prima do padrão de funcionamento da loja: veredito diz
// "conforme"; a medida diz "havia duas pessoas".
//
// O que tem de ficar provado:
//
//   - "não medi" não é zero: hora sem medida volta com o maior valor NULO,
//     e hora em que só se viu zero volta com o maior valor ZERO;
//   - dois agentes na mesma hora: as somas se somam, o maior valor é o
//     maior dos dois;
//   - a hora que sobe de novo troca os três números;
//   - agente antigo, que não manda os campos, continua aceito.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { validarResumo } from '../src/rotas/resumos.js';

const RESUMO = JSON.parse(
  readFileSync(new URL('../../contratos/resumo-do-agente.json', import.meta.url), 'utf8'),
);

describe('a medida, no que o agente manda', () => {
  it('o exemplo do contrato passa, e a medida dele é possível', () => {
    assert.equal(validarResumo(RESUMO, 0), null);
    assert.ok(RESUMO.comMedida <= RESUMO.conformes + RESUMO.naoConformes + RESUMO.naoAvaliaveis);
    assert.ok(RESUMO.somaMedida / RESUMO.comMedida <= RESUMO.maxMedida);
  });

  it('agente antigo não manda os três campos e continua aceito', () => {
    const { somaMedida: _a, comMedida: _b, maxMedida: _c, ...antigo } = RESUMO;
    assert.equal(validarResumo(antigo, 0), null);
  });

  it('hora em que só se viu zero é medida: maior valor zero, não nulo', () => {
    assert.equal(validarResumo({ ...RESUMO, somaMedida: 0, comMedida: 3, maxMedida: 0 }, 0), null);
  });

  it('recusa mais medidas do que julgamentos, e número que não é contagem', () => {
    // 23 julgadas no exemplo
    assert.match(String(validarResumo({ ...RESUMO, comMedida: 24, somaMedida: 24, maxMedida: 2 }, 0)), /comMedida/);
    assert.match(String(validarResumo({ ...RESUMO, comMedida: 1.5 }, 0)), /comMedida/);
    assert.match(String(validarResumo({ ...RESUMO, comMedida: -1 }, 0)), /comMedida/);
    assert.match(String(validarResumo({ ...RESUMO, somaMedida: -4 }, 0)), /somaMedida/);
    assert.match(String(validarResumo({ ...RESUMO, maxMedida: 'duas' }, 0)), /maxMedida/);
  });

  it('recusa a conta que não fecha: maior valor sem medida, medida sem maior valor, média acima dele', () => {
    assert.match(String(validarResumo({ ...RESUMO, comMedida: 0, somaMedida: 0, maxMedida: 2 }, 0)), /sem medida/);
    assert.match(String(validarResumo({ ...RESUMO, comMedida: 0, somaMedida: 5, maxMedida: null }, 0)), /sem medida/);
    assert.match(String(validarResumo({ ...RESUMO, maxMedida: null }, 0)), /maior valor é obrigatório/);
    // 3 medidas somando 12 dão média 4; o maior informado é 2
    assert.match(String(validarResumo({ ...RESUMO, somaMedida: 12 }, 0)), /média maior que o maior valor/);
  });
});

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-medida-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-medida';
const SENHA = 'uma senha longa o bastante';

function diaDaLoja(atras = 0): string {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const [a, m, d] = hoje.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d - atras)).toISOString().slice(0, 10);
}
const HOJE = diaDaLoja();
const hora = (dia: string, h: number) => `${dia}T${String(h).padStart(2, '0')}:00:00-03:00`;

type Celula = { dia: string; hora: number; regraId: string; analises: number; somaMedida: number; comMedida: number; maxMedida: number | null };

describe('a medida por hora (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  let lojaId = '';
  let cookie = '';
  let token = '';
  let segundoToken = '';
  let zona = '';
  let presenca = '';
  let uniforme = '';

  async function novoAgente(quem: string): Promise<string> {
    const agente = await app.inject({
      method: 'POST', url: '/v1/distribuicao/agentes', headers: { 'x-farol-admin': ADMIN }, payload: { lojaId, nome: `Agente ${quem}` },
    });
    const t = agente.json().token as string;
    const ativar = await app.inject({
      method: 'POST', url: '/v1/agentes/ativar', headers: { authorization: `Bearer ${t}` }, payload: { fingerprint: `fp-${randomUUID().slice(0, 10)}` },
    });
    assert.equal(ativar.statusCode, 200, ativar.body);
    return t;
  }

  const linha = (regraId: string, quando: string, mais: Record<string, unknown>) => {
    const { julgadasLoja: _a, julgadasNuvem: _b, somaMedida: _c, comMedida: _d, maxMedida: _e, ...base } = RESUMO;
    const zeros = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, typeof v === 'number' ? 0 : v]));
    return { ...zeros, regraId, zonaId: zona, hora: quando, ultimoResultado: null, ultimoMotivo: null, ultimoImpedimento: null, ultimaEm: null, ...mais };
  };

  const mandar = async (resumos: unknown[], comToken = token) => {
    const r = await app.inject({ method: 'POST', url: '/v1/resumos', headers: { authorization: `Bearer ${comToken}` }, payload: { resumos } });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json().recusados, [], r.body);
  };

  const celula = async (h: number, regraId: string): Promise<Celula> => {
    const r = await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}/analises`, headers: { cookie } });
    assert.equal(r.statusCode, 200, r.body);
    const achadas = (r.json().celulas as Celula[]).filter((c) => c.dia === HOJE && c.hora === h && c.regraId === regraId);
    assert.equal(achadas.length, 1, `esperava UMA célula às ${h}h, achei ${achadas.length}`);
    return achadas[0]!;
  };

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
    const email = `ger-${marca}@e.com`;
    await app.inject({
      method: 'POST', url: '/v1/distribuicao/usuarios', headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId: conta.tenantId, nome: 'X', email, senha: SENHA, nivel: 'gerente' },
    });
    const sessao = await app.inject({ method: 'POST', url: '/v1/sessao', payload: { email, senha: SENHA } });
    const b = sessao.headers['set-cookie'];
    cookie = (Array.isArray(b) ? b[0]! : String(b)).split(';')[0]!;

    const canal = await app.inject({
      method: 'POST', url: `/v1/setores/${conta.setores[0].id}/pontos`, headers: { cookie },
      payload: { nome: 'Balcão', origem: 'dvr', canal: 13, host: '192.168.1.108' },
    });
    assert.equal(canal.statusCode, 201, canal.body);
    zona = canal.json().zonas[0].id;

    const criterio = async (nome: string, tipo: string, parametros?: Record<string, unknown>) => {
      const r = await app.inject({
        method: 'POST', url: `/v1/lojas/${lojaId}/regras`, headers: { cookie },
        payload: { nome, tipo, criterio: `Texto de ${nome}.`, zonaIds: [zona], ...(parametros ? { parametros } : {}) },
      });
      assert.equal(r.statusCode, 201, r.body);
      return r.json().id as string;
    };
    presenca = await criterio('Alguém no balcão', 'presenca', { objeto: 'pessoa', minimo: 1 });
    uniforme = await criterio('Uniforme', 'estado');

    token = await novoAgente(marca);
    segundoToken = await novoAgente(`${marca}-2`);
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  it('a medida da hora chega à tela: soma, quantidade e maior valor', async () => {
    await mandar([linha(presenca, hora(HOJE, 19), { capturas: 100, enfileiradas: 100, conformes: 90, naoConformes: 10, julgadasLoja: 100, somaMedida: 170, comMedida: 100, maxMedida: 4 })]);

    const c = await celula(19, presenca);
    assert.deepEqual([c.analises, c.somaMedida, c.comMedida, c.maxMedida], [100, 170, 100, 4]);
  });

  it('dois agentes na mesma hora: as somas se somam e vale o MAIOR dos maiores', async () => {
    await mandar([linha(presenca, hora(HOJE, 19), { capturas: 20, enfileiradas: 20, conformes: 20, julgadasLoja: 20, somaMedida: 30, comMedida: 20, maxMedida: 6 })], segundoToken);

    const c = await celula(19, presenca);
    assert.deepEqual([c.analises, c.somaMedida, c.comMedida, c.maxMedida], [120, 200, 120, 6]);
  });

  it('a hora que sobe de novo troca os três números', async () => {
    await mandar([linha(presenca, hora(HOJE, 20), { capturas: 10, enfileiradas: 10, conformes: 10, julgadasLoja: 10, somaMedida: 12, comMedida: 10, maxMedida: 2 })]);
    await mandar([linha(presenca, hora(HOJE, 20), { capturas: 30, enfileiradas: 30, conformes: 30, julgadasLoja: 30, somaMedida: 45, comMedida: 30, maxMedida: 5 })]);

    const c = await celula(20, presenca);
    assert.deepEqual([c.analises, c.somaMedida, c.comMedida, c.maxMedida], [30, 45, 30, 5]);
  });

  it('"não medi" volta nulo; "medi e só vi zero" volta zero', async () => {
    await mandar([
      // a nuvem julgando uniforme: não mede nada
      linha(uniforme, hora(HOJE, 21), { capturas: 8, enfileiradas: 8, conformes: 8, julgadasNuvem: 8 }),
      // o detector com o balcão vazio a hora inteira
      linha(presenca, hora(HOJE, 21), { capturas: 50, enfileiradas: 50, naoConformes: 50, julgadasLoja: 50, somaMedida: 0, comMedida: 50, maxMedida: 0 }),
    ]);

    const semMedida = await celula(21, uniforme);
    assert.deepEqual([semMedida.somaMedida, semMedida.comMedida, semMedida.maxMedida], [0, 0, null]);
    const vazio = await celula(21, presenca);
    assert.deepEqual([vazio.somaMedida, vazio.comMedida, vazio.maxMedida], [0, 50, 0]);
  });

  it('agente antigo (sem os campos) entra e fica sem medida', async () => {
    await mandar([linha(presenca, hora(HOJE, 22), { capturas: 5, enfileiradas: 5, conformes: 5 })]);

    const c = await celula(22, presenca);
    assert.deepEqual([c.analises, c.comMedida, c.maxMedida], [5, 0, null]);
  });
});
