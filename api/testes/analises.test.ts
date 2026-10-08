// A tela "Análises": o miúdo do que foi julgado — por dia, hora, critério e
// área, com ONDE foi julgado (na loja ou na nuvem) e quanto custou.
//
// O que tem de ficar provado:
//
//   - cada análise cai na hora e no dia DA LOJA, não do servidor;
//   - loja + nuvem é sempre igual ao que foi julgado, inclusive para linha
//     de agente antigo, que não diz onde julgou;
//   - o custo que volta é o que o agente mandou, somado entre agentes;
//   - o nome da área só aparece em canal com mais de uma;
//   - o aviso diz onde aquele julgamento foi feito;
//   - quem não é desta conta não vê nada, e a execução não vê os números.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { lerIntervalo, MAX_DIAS, ondeDaVia, repartirPorOnde } from '../src/analises.js';
import { criarApp } from '../src/app.js';
import { validarResumo } from '../src/rotas/resumos.js';

const RESUMO = JSON.parse(
  readFileSync(new URL('../../contratos/resumo-do-agente.json', import.meta.url), 'utf8'),
);
const EVENTO = JSON.parse(
  readFileSync(new URL('../../contratos/evento-do-agente.json', import.meta.url), 'utf8'),
);

// ───────────────── sem banco ─────────────────

describe('onde foi julgado (a conta)', () => {
  it('o que o agente informou vale como veio', () => {
    assert.deepEqual(repartirPorOnde({ tipo: 'estado', julgadas: 10, julgadasLoja: 4, julgadasNuvem: 6 }), { naLoja: 4, naNuvem: 6 });
    // mesmo contra o tipo: um "estado" julgado por modelo LOCAL é da loja
    assert.deepEqual(repartirPorOnde({ tipo: 'estado', julgadas: 10, julgadasLoja: 10, julgadasNuvem: 0 }), { naLoja: 10, naNuvem: 0 });
  });

  it('linha de agente antigo (zero nos dois lados) é repartida pelo tipo do critério', () => {
    for (const tipo of ['presenca', 'contagem', 'comparacao']) {
      assert.deepEqual(repartirPorOnde({ tipo, julgadas: 7, julgadasLoja: 0, julgadasNuvem: 0 }), { naLoja: 7, naNuvem: 0 }, tipo);
    }
    for (const tipo of ['estado', 'acao']) {
      assert.deepEqual(repartirPorOnde({ tipo, julgadas: 7, julgadasLoja: 0, julgadasNuvem: 0 }), { naLoja: 0, naNuvem: 7 }, tipo);
    }
  });

  it('na hora em que o agente foi atualizado, só o resto vai pelo tipo', () => {
    assert.deepEqual(repartirPorOnde({ tipo: 'estado', julgadas: 10, julgadasLoja: 0, julgadasNuvem: 3 }), { naLoja: 0, naNuvem: 10 });
    assert.deepEqual(repartirPorOnde({ tipo: 'presenca', julgadas: 10, julgadasLoja: 4, julgadasNuvem: 0 }), { naLoja: 10, naNuvem: 0 });
  });

  it('as duas partes somam SEMPRE o que foi julgado', () => {
    for (const tipo of ['presenca', 'estado']) {
      for (const [julgadas, loja, nuvem] of [[10, 8, 8], [0, 3, 3], [5, -2, 9], [12, 12, 5], [3, 0, 0]] as const) {
        const r = repartirPorOnde({ tipo, julgadas, julgadasLoja: loja, julgadasNuvem: nuvem });
        assert.equal(r.naLoja + r.naNuvem, julgadas, `${tipo} ${julgadas}/${loja}/${nuvem}`);
        assert.ok(r.naLoja >= 0 && r.naNuvem >= 0);
      }
    }
  });

  it('a via do evento vira "loja" ou "nuvem"', () => {
    assert.equal(ondeDaVia('nuvem'), 'nuvem');
    for (const via of ['detector', 'local', 'comparacao']) assert.equal(ondeDaVia(via), 'loja', via);
    assert.equal(ondeDaVia(null), null);
  });
});

describe('o intervalo de dias pedido', () => {
  const HOJE = '2026-10-07';

  it('sem nada, é hoje; com uma ponta só, é aquele dia', () => {
    assert.deepEqual(lerIntervalo(undefined, undefined, HOJE), { de: HOJE, ate: HOJE });
    assert.deepEqual(lerIntervalo('2026-10-05', undefined, HOJE), { de: '2026-10-05', ate: '2026-10-05' });
    assert.deepEqual(lerIntervalo(undefined, '2026-10-05', HOJE), { de: '2026-10-05', ate: '2026-10-05' });
    assert.deepEqual(lerIntervalo('2026-10-01', '2026-10-07', HOJE), { de: '2026-10-01', ate: '2026-10-07' });
  });

  it('recusa o que não é dia, o que não existe e o que está ao contrário', () => {
    assert.match(String(lerIntervalo('07/10/2026', undefined, HOJE).problema), /AAAA-MM-DD/);
    assert.match(String(lerIntervalo('2026-02-30', undefined, HOJE).problema), /AAAA-MM-DD/);
    assert.match(String(lerIntervalo(HOJE, 20261007, HOJE).problema), /ate/);
    assert.match(String(lerIntervalo('2026-10-07', '2026-10-01', HOJE).problema), /depois/);
  });

  it(`vai até ${MAX_DIAS} dias, e nem um a mais`, () => {
    assert.equal(lerIntervalo('2026-09-07', '2026-10-07', HOJE).problema, undefined); // 31 dias
    assert.match(String(lerIntervalo('2026-09-06', '2026-10-07', HOJE).problema), /31 dias/);
  });
});

describe('onde foi julgado, no que o agente manda', () => {
  it('o exemplo do contrato passa, e os dois números fecham com o que foi julgado', () => {
    assert.equal(validarResumo(RESUMO, 0), null);
    assert.equal(RESUMO.julgadasLoja + RESUMO.julgadasNuvem, RESUMO.conformes + RESUMO.naoConformes + RESUMO.naoAvaliaveis);
  });

  it('agente antigo não manda os dois campos e continua aceito', () => {
    const { julgadasLoja: _a, julgadasNuvem: _b, ...antigo } = RESUMO;
    assert.equal(validarResumo(antigo, 0), null);
    assert.equal(validarResumo({ ...antigo, julgadasNuvem: 5 }, 0), null, 'um só também vale');
  });

  it('recusa número que não é contagem e soma maior que o que foi julgado', () => {
    assert.match(String(validarResumo({ ...RESUMO, julgadasLoja: -1 }, 0)), /julgadasLoja/);
    assert.match(String(validarResumo({ ...RESUMO, julgadasNuvem: 1.5 }, 0)), /julgadasNuvem/);
    assert.match(String(validarResumo({ ...RESUMO, julgadasNuvem: '20' }, 0)), /julgadasNuvem/);
    // 23 julgadas no exemplo: 3 + 21 não cabe
    assert.match(String(validarResumo({ ...RESUMO, julgadasNuvem: 21 }, 0)), /maior que o que foi julgado/);
  });
});

// ───────────────── com banco ─────────────────

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-analises-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-analises';
const SENHA = 'uma senha longa o bastante';
const FUSO = 'America/Sao_Paulo';

/** O dia de hoje NA LOJA, menos `atras` dias. */
function diaDaLoja(atras = 0): string {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(new Date());
  const [a, m, d] = hoje.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d - atras)).toISOString().slice(0, 10);
}
const HOJE = diaDaLoja();
const ONTEM = diaDaLoja(1);
/** A hora cheia `h` do dia `dia`, no relógio da loja (São Paulo é −03:00 o ano todo). */
const hora = (dia: string, h: number) => `${dia}T${String(h).padStart(2, '0')}:00:00-03:00`;

type Celula = {
  dia: string; hora: number; regraId: string; pontoId: string; zonaId: string; areaNome: string | null;
  capturas: number; analises: number; conformes: number; naoConformes: number; naoAvaliaveis: number;
  naLoja: number; naNuvem: number; custoCentavos: number; somaLatenciaMs: number; alertas: number;
};

describe('análises por hora (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  let lojaId = '';
  let cookie = '';
  let cookieExecucao = '';
  let cookieVizinho = '';
  let token = '';
  let segundoToken = '';
  // Balcão tem duas áreas; a Chapa, uma.
  let balcao = { pontoId: '', dentro: '', cliente: '' };
  let chapa = { pontoId: '', zona: '' };
  let presenca = '';
  let fila = '';
  let uniforme = '';

  async function entrar(tenantId: string, email: string, nivel: string) {
    await app.inject({
      method: 'POST', url: '/v1/distribuicao/usuarios', headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId, nome: 'X', email, senha: SENHA, nivel },
    });
    const r = await app.inject({ method: 'POST', url: '/v1/sessao', payload: { email, senha: SENHA } });
    const b = r.headers['set-cookie'];
    return (Array.isArray(b) ? b[0]! : String(b)).split(';')[0]!;
  }

  async function novoAgente(quem: string): Promise<string> {
    const agente = await app.inject({
      method: 'POST', url: '/v1/distribuicao/agentes', headers: { 'x-farol-admin': ADMIN },
      payload: { lojaId, nome: `Agente ${quem}` },
    });
    const t = agente.json().token as string;
    const ativar = await app.inject({
      method: 'POST', url: '/v1/agentes/ativar', headers: { authorization: `Bearer ${t}` },
      payload: { fingerprint: `fp-${quem}-${randomUUID().slice(0, 6)}` },
    });
    assert.equal(ativar.statusCode, 200, ativar.body);
    return t;
  }

  /** Uma linha de resumo: zerada, com o que o teste disser por cima. */
  const linha = (regraId: string, zonaId: string, quando: string, mais: Record<string, unknown>) => {
    const { julgadasLoja: _a, julgadasNuvem: _b, ...base } = RESUMO;
    const zeros = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, typeof v === 'number' ? 0 : v]));
    // `maxMedida` zerado seria "mediu e viu zero"; linha sem medida tem o maior valor NULO.
    return { ...zeros, maxMedida: null, regraId, zonaId, hora: quando, ultimoResultado: null, ultimoMotivo: null, ultimoImpedimento: null, ultimaEm: null, ...mais };
  };

  const mandar = async (resumos: unknown[], comToken = token) => {
    const r = await app.inject({
      method: 'POST', url: '/v1/resumos', headers: { authorization: `Bearer ${comToken}` }, payload: { resumos },
    });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json().recusados, [], r.body);
  };

  const pedir = (consulta = '', comCookie: string | null = cookie, loja = lojaId) =>
    app.inject({ method: 'GET', url: `/v1/lojas/${loja}/analises${consulta}`, headers: comCookie ? { cookie: comCookie } : {} });

  const celula = (celulas: Celula[], dia: string, h: number, regraId: string, zonaId: string): Celula => {
    const achadas = celulas.filter((c) => c.dia === dia && c.hora === h && c.regraId === regraId && c.zonaId === zonaId);
    assert.equal(achadas.length, 1, `esperava UMA célula para ${dia} ${h}h, achei ${achadas.length}`);
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
    const setorId = conta.setores[0].id as string;
    cookie = await entrar(conta.tenantId, `sup-${marca}@e.com`, 'supervisao');
    const gerente = await entrar(conta.tenantId, `ger-${marca}@e.com`, 'gerente');
    cookieExecucao = await entrar(conta.tenantId, `exe-${marca}@e.com`, 'execucao');

    const vizinha = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome: `${marca}-vizinha` }, loja: { nome: 'Vizinha' }, setores: [] },
    })).json();
    cookieVizinho = await entrar(vizinha.tenantId, `ger-${marca}-viz@e.com`, 'gerente');

    const canal = async (nome: string, numero: number) => {
      const r = await app.inject({
        method: 'POST', url: `/v1/setores/${setorId}/pontos`, headers: { cookie: gerente },
        payload: { nome, origem: 'dvr', canal: numero, host: '192.168.1.108' },
      });
      assert.equal(r.statusCode, 201, r.body);
      return { pontoId: r.json().id as string, zona: r.json().zonas[0].id as string };
    };
    const b = await canal('Balcão', 13);
    const area = await app.inject({
      method: 'POST', url: `/v1/pontos/${b.pontoId}/zonas`, headers: { cookie: gerente }, payload: { nome: 'Lado do cliente' },
    });
    assert.equal(area.statusCode, 201, area.body);
    balcao = { pontoId: b.pontoId, dentro: b.zona, cliente: area.json().id };
    chapa = await canal('Chapa', 6);

    const criterio = async (nome: string, tipo: string, zonaIds: string[], parametros?: Record<string, unknown>) => {
      const r = await app.inject({
        method: 'POST', url: `/v1/lojas/${lojaId}/regras`, headers: { cookie: gerente },
        payload: { nome, tipo, criterio: `Texto de ${nome}.`, zonaIds, ...(parametros ? { parametros } : {}) },
      });
      assert.equal(r.statusCode, 201, r.body);
      return r.json().id as string;
    };
    presenca = await criterio('Alguém no balcão', 'presenca', [balcao.dentro], { objeto: 'pessoa', minimo: 1 });
    fila = await criterio('Fila no balcão', 'contagem', [balcao.cliente], { objeto: 'pessoa', minimo: 0, maximo: 3 });
    uniforme = await criterio('Uniforme', 'estado', [chapa.zona]);

    token = await novoAgente(marca);
    segundoToken = await novoAgente(`${marca}-2`);

    await mandar([
      // hoje, 19h — agente novo: diz onde julgou
      linha(presenca, balcao.dentro, hora(HOJE, 19), { capturas: 110, enfileiradas: 110, conformes: 100, naoConformes: 10, alertas: 2, julgadasLoja: 110, somaLatenciaMs: 10230, comLatencia: 110 }),
      linha(fila, balcao.cliente, hora(HOJE, 19), { capturas: 110, enfileiradas: 110, conformes: 107, naoConformes: 3, julgadasLoja: 110 }),
      linha(uniforme, chapa.zona, hora(HOJE, 19), { capturas: 60, repetidas: 20, enfileiradas: 40, conformes: 30, naoConformes: 2, naoAvaliaveis: 8, julgadasNuvem: 40, custoCentavos: 52.4, somaLatenciaMs: 84000, comLatencia: 40 }),
      // hoje, 18h — agente ANTIGO: não diz onde julgou
      linha(presenca, balcao.dentro, hora(HOJE, 18), { capturas: 50, enfileiradas: 50, conformes: 50 }),
      linha(uniforme, chapa.zona, hora(HOJE, 18), { capturas: 25, enfileiradas: 25, conformes: 20, naoAvaliaveis: 5, custoCentavos: 32.75 }),
      // hoje, 0h e 23h — as pontas do dia DA LOJA
      linha(presenca, balcao.dentro, hora(HOJE, 0), { capturas: 4, enfileiradas: 4, conformes: 4, julgadasLoja: 4 }),
      linha(presenca, balcao.dentro, hora(HOJE, 23), { capturas: 6, enfileiradas: 6, conformes: 6, julgadasLoja: 6 }),
      // ontem, 20h
      linha(uniforme, chapa.zona, hora(ONTEM, 20), { capturas: 30, enfileiradas: 30, conformes: 28, naoConformes: 2, julgadasNuvem: 30, custoCentavos: 39.3 }),
      // hoje, 20h — um "estado" julgado por modelo LOCAL: contra o tipo, e o agente é quem sabe
      linha(uniforme, chapa.zona, hora(HOJE, 20), { capturas: 5, enfileiradas: 5, conformes: 5, julgadasLoja: 5 }),
      // só olhadas, nada julgado: câmera sem cena
      linha(fila, balcao.cliente, hora(HOJE, 17), { capturas: 12, semCena: 12 }),
    ]);
    // O mesmo critério, área e hora por OUTRO agente (reinstalação no meio da hora).
    await mandar([
      linha(uniforme, chapa.zona, hora(HOJE, 19), { capturas: 10, enfileiradas: 10, conformes: 10, julgadasNuvem: 10, custoCentavos: 13.1 }),
    ], segundoToken);

    // Dois avisos de hoje, às 19h20 e 19h45, e um "conforme" que não é aviso.
    const evento = (mais: Record<string, unknown>) => ({ ...EVENTO, idempotenciaKey: randomUUID().replace(/-/g, ''), ...mais });
    const eventos = await app.inject({
      method: 'POST', url: '/v1/eventos', headers: { authorization: `Bearer ${token}` },
      payload: {
        eventos: [
          evento({ regraId: uniforme, zonaId: chapa.zona, ocorridoEm: `${HOJE}T19:20:00-03:00`, via: 'nuvem', motivo: 'sem touca' }),
          evento({ regraId: presenca, zonaId: balcao.dentro, ocorridoEm: `${HOJE}T19:45:00-03:00`, via: 'detector', modelo: 'rfdetr-nano', motivo: 'ninguém no balcão', custoCentavos: 0 }),
          evento({ regraId: uniforme, zonaId: chapa.zona, ocorridoEm: `${HOJE}T19:50:00-03:00`, veredito: 'conforme' }),
          evento({ regraId: uniforme, zonaId: chapa.zona, ocorridoEm: `${ONTEM}T20:10:00-03:00`, via: 'nuvem', motivo: 'sem touca, ontem' }),
        ],
      },
    });
    assert.equal(eventos.statusCode, 200, eventos.body);
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  it('sem pedir nada, vem o dia de hoje DA LOJA, hora a hora', async () => {
    const r = await pedir();
    assert.equal(r.statusCode, 200, r.body);
    const c = r.json();
    assert.equal(c.de, HOJE);
    assert.equal(c.ate, HOJE);
    assert.equal(c.hoje, HOJE);
    assert.equal(c.loja.timezone, FUSO);
    assert.ok(Number.isInteger(c.horaAgora) && c.horaAgora >= 0 && c.horaAgora <= 23);

    const celulas = c.celulas as Celula[];
    assert.ok(celulas.every((x) => x.dia === HOJE), 'veio célula de outro dia');
    // 0h e 23h do relógio da loja são de HOJE — no servidor (UTC) seriam de dois dias diferentes
    assert.deepEqual([...new Set(celulas.map((x) => x.hora))].sort((a, b) => a - b), [0, 17, 18, 19, 20, 23]);
  });

  it('loja + nuvem fecha com o que foi julgado, em toda célula', async () => {
    const celulas = (await pedir(`?de=${ONTEM}&ate=${HOJE}`)).json().celulas as Celula[];
    assert.ok(celulas.length >= 10);
    for (const c of celulas) {
      assert.equal(c.analises, c.conformes + c.naoConformes + c.naoAvaliaveis, 'análise = o que terminou em veredito');
      assert.equal(c.naLoja + c.naNuvem, c.analises, `${c.dia} ${c.hora}h não fecha`);
    }
  });

  it('o que o agente informou vale como veio: presença na loja, uniforme na nuvem', async () => {
    const celulas = (await pedir()).json().celulas as Celula[];
    const p = celula(celulas, HOJE, 19, presenca, balcao.dentro);
    assert.deepEqual([p.analises, p.naLoja, p.naNuvem, p.custoCentavos, p.alertas], [110, 110, 0, 0, 2]);
    assert.equal(p.somaLatenciaMs, 10230);
    // Um critério de "estado" julgado na loja fica na loja: o tipo só decide o que NÃO foi informado.
    const local = celula(celulas, HOJE, 20, uniforme, chapa.zona);
    assert.deepEqual([local.analises, local.naLoja, local.naNuvem], [5, 5, 0]);
  });

  it('dois agentes na mesma hora viram UMA célula, com as análises e o custo somados', async () => {
    const celulas = (await pedir()).json().celulas as Celula[];
    const u = celula(celulas, HOJE, 19, uniforme, chapa.zona);
    assert.deepEqual([u.analises, u.conformes, u.naoConformes, u.naoAvaliaveis], [50, 40, 2, 8]);
    assert.deepEqual([u.naLoja, u.naNuvem], [0, 50]);
    assert.ok(Math.abs(u.custoCentavos - 65.5) < 1e-6, `custo ${u.custoCentavos}`);
    assert.equal(u.capturas, 70);
  });

  it('linha de agente antigo é repartida pelo tipo do critério', async () => {
    const celulas = (await pedir()).json().celulas as Celula[];
    const p = celula(celulas, HOJE, 18, presenca, balcao.dentro);
    assert.deepEqual([p.analises, p.naLoja, p.naNuvem], [50, 50, 0]);
    const u = celula(celulas, HOJE, 18, uniforme, chapa.zona);
    assert.deepEqual([u.analises, u.naLoja, u.naNuvem], [25, 0, 25]);
    assert.ok(Math.abs(u.custoCentavos - 32.75) < 1e-6);
  });

  it('olhada que não chegou a ser julgada volta com capturas e zero análises', async () => {
    const celulas = (await pedir()).json().celulas as Celula[];
    const f = celula(celulas, HOJE, 17, fila, balcao.cliente);
    assert.deepEqual([f.capturas, f.analises, f.naLoja, f.naNuvem], [12, 0, 0, 0]);
  });

  it('o custo do dia é a soma do que os agentes mandaram, e só a nuvem custa', async () => {
    const celulas = (await pedir()).json().celulas as Celula[];
    const custo = celulas.reduce((a, c) => a + c.custoCentavos, 0);
    assert.ok(Math.abs(custo - (52.4 + 13.1 + 32.75)) < 1e-6, `custo do dia ${custo}`);
    assert.ok(celulas.filter((c) => c.naNuvem === 0).every((c) => c.custoCentavos === 0), 'análise na loja com custo');
    const nuvem = celulas.reduce((a, c) => a + c.naNuvem, 0);
    const loja = celulas.reduce((a, c) => a + c.naLoja, 0);
    assert.deepEqual([loja, nuvem], [110 + 110 + 50 + 4 + 6 + 5, 50 + 25]);
  });

  it('o nome da área só aparece em canal com mais de uma', async () => {
    const celulas = (await pedir()).json().celulas as Celula[];
    assert.equal(celula(celulas, HOJE, 19, presenca, balcao.dentro).areaNome, 'Quadro inteiro');
    assert.equal(celula(celulas, HOJE, 19, fila, balcao.cliente).areaNome, 'Lado do cliente');
    assert.equal(celula(celulas, HOJE, 19, uniforme, chapa.zona).areaNome, null);
  });

  it('um dia só, e o intervalo: cada célula no seu dia', async () => {
    const ontem = (await pedir(`?de=${ONTEM}`)).json();
    assert.deepEqual([ontem.de, ontem.ate], [ONTEM, ONTEM]);
    assert.equal(ontem.celulas.length, 1);
    const o = ontem.celulas[0] as Celula;
    assert.deepEqual([o.dia, o.hora, o.analises, o.naNuvem], [ONTEM, 20, 30, 30]);

    const dois = (await pedir(`?de=${ONTEM}&ate=${HOJE}`)).json();
    assert.deepEqual([...new Set((dois.celulas as Celula[]).map((c) => c.dia))].sort(), [ONTEM, HOJE].sort());
  });

  it('os canais e os critérios vêm com nome, para a tela montar os filtros', async () => {
    const c = (await pedir()).json();
    assert.deepEqual(
      c.canais.map((x: { nome: string; canal: number; setor: string }) => [x.nome, x.canal, x.setor]).sort(),
      [['Balcão', 13, 'Atendimento'], ['Chapa', 6, 'Atendimento']],
    );
    assert.deepEqual(
      c.criterios.map((x: { nome: string; tipo: string }) => [x.nome, x.tipo]).sort(),
      [['Alguém no balcão', 'presenca'], ['Fila no balcão', 'contagem'], ['Uniforme', 'estado']],
    );
  });

  it('os avisos do intervalo dizem a hora da loja e ONDE foram julgados', async () => {
    const c = (await pedir()).json();
    assert.equal(c.totalDeAvisos, 2, 'o "conforme" e o de ontem não entram');
    const avisos = c.avisos as { horaMinuto: string; hora: number; dia: string; onde: string; regraId: string; pontoId: string; areaNome: string | null; motivo: string }[];
    assert.deepEqual(avisos.map((a) => a.horaMinuto), ['19:45', '19:20'], 'do mais novo para trás');
    assert.deepEqual(avisos.map((a) => a.onde), ['loja', 'nuvem']);
    assert.deepEqual(avisos.map((a) => [a.dia, a.hora]), [[HOJE, 19], [HOJE, 19]]);
    assert.deepEqual([avisos[0]!.regraId, avisos[0]!.pontoId, avisos[0]!.areaNome], [presenca, balcao.pontoId, 'Quadro inteiro']);
    assert.deepEqual([avisos[1]!.regraId, avisos[1]!.pontoId, avisos[1]!.areaNome, avisos[1]!.motivo], [uniforme, chapa.pontoId, null, 'sem touca']);

    const ontem = (await pedir(`?de=${ONTEM}`)).json();
    assert.equal(ontem.totalDeAvisos, 1);
    assert.equal(ontem.avisos[0].motivo, 'sem touca, ontem');
  });

  it('a mesma hora sobe de novo, maior: vale a última — também em onde foi julgado', async () => {
    // É o caminho de todo dia: o agente manda o ACUMULADO da hora várias
    // vezes enquanto ela corre, e a nuvem troca o valor antigo pelo novo.
    //
    // Os números são escolhidos para o lado que CRESCE ser o contrário do
    // tipo do critério: se a regravação deixasse o valor antigo, a
    // repartição pelo tipo taparia o buraco e o teste não veria.
    const dia = diaDaLoja(3);
    await mandar([
      linha(uniforme, chapa.zona, hora(dia, 12), { capturas: 10, enfileiradas: 10, conformes: 4, julgadasLoja: 1, julgadasNuvem: 3, custoCentavos: 3.9 }),
      linha(presenca, balcao.dentro, hora(dia, 12), { capturas: 3, enfileiradas: 3, conformes: 3, julgadasLoja: 3 }),
    ]);
    await mandar([
      linha(uniforme, chapa.zona, hora(dia, 12), { capturas: 20, enfileiradas: 20, conformes: 9, julgadasLoja: 6, julgadasNuvem: 3, custoCentavos: 9.1 }),
      linha(presenca, balcao.dentro, hora(dia, 12), { capturas: 9, enfileiradas: 9, conformes: 9, julgadasLoja: 3, julgadasNuvem: 6 }),
    ]);

    const celulas = (await pedir(`?de=${dia}`)).json().celulas as Celula[];
    const c = celula(celulas, dia, 12, uniforme, chapa.zona);
    assert.deepEqual([c.analises, c.naLoja, c.naNuvem], [9, 6, 3]);
    assert.ok(Math.abs(c.custoCentavos - 9.1) < 1e-6, `custo ${c.custoCentavos}`);
    const p = celula(celulas, dia, 12, presenca, balcao.dentro);
    assert.deepEqual([p.analises, p.naLoja, p.naNuvem], [9, 3, 6]);
  });

  it('canal excluído só aparece no dia em que tem o que mostrar', async () => {
    await pool.query('update ponto set excluido_em = now(), ativo = false where id = $1', [chapa.pontoId]);
    try {
      const hoje = (await pedir()).json();
      assert.ok(hoje.canais.some((x: { id: string; excluido: boolean }) => x.id === chapa.pontoId && x.excluido), 'o histórico do canal excluído sumiu');
      const antes = (await pedir('?de=2026-01-01')).json();
      assert.equal(antes.celulas.length, 0);
      assert.ok(!antes.canais.some((x: { id: string }) => x.id === chapa.pontoId), 'canal excluído num dia em que não tem nada');
    } finally {
      await pool.query('update ponto set excluido_em = null, ativo = true where id = $1', [chapa.pontoId]);
    }
  });

  it('intervalo torto volta 400 com a frase do problema', async () => {
    for (const [consulta, frase] of [
      ['?de=ontem', /AAAA-MM-DD/],
      ['?de=2026-02-30', /AAAA-MM-DD/],
      [`?de=${HOJE}&ate=${ONTEM}`, /depois/],
      ['?de=2026-01-01&ate=2026-03-01', /31 dias/],
    ] as const) {
      const r = await pedir(consulta);
      assert.equal(r.statusCode, 400, `${consulta}: ${r.body}`);
      assert.equal(r.json().erro, 'intervalo_invalido');
      assert.match(r.json().mensagem, frase);
    }
  });

  it('sem sessão, 401; execução, 403; outra conta e loja que não existe, 404', async () => {
    assert.equal((await pedir('', null)).statusCode, 401);
    assert.equal((await pedir('', cookieExecucao)).statusCode, 403);
    assert.equal((await pedir('', cookieVizinho)).statusCode, 404);
    assert.equal((await pedir('', cookie, randomUUID())).statusCode, 404);
    assert.equal((await pedir('', cookie, 'nao-e-uuid')).statusCode, 404);
  });
});
