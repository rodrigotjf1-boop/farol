// POST /v1/resumos — o corpo que o AGENTE manda, contra a API de verdade.
//
// Lê `contratos/resumo-do-agente.json`, o mesmo arquivo que
// `agent/testes/test_resumo.py` exige que o agente produza. É o que prende
// os dois lados um ao outro: o evento já divergiu uma vez sem ninguém ver
// (o agente mandava snake_case, a API lia camelCase, e os dois conjuntos de
// testes passavam).

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { validarResumo } from '../src/rotas/resumos.js';

const CONTRATO = JSON.parse(
  readFileSync(new URL('../../contratos/resumo-do-agente.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

// ───────────────── sem banco: a validação ─────────────────

describe('contrato do resumo (validação)', () => {
  it('o corpo do agente é aceito', () => {
    assert.equal(validarResumo(CONTRATO, 0), null);
  });

  it('o formato em snake_case é recusado dizendo o campo', () => {
    // A forma exata do defeito que o evento já teve.
    const { naoConformes: _, ...resto } = CONTRATO;
    const errado = { ...resto, nao_conformes: 2 };
    assert.match(String(validarResumo(errado, 0)), /naoConformes/);
  });

  it('hora SEM fuso é recusada, em vez de gravada três horas fora', () => {
    assert.match(String(validarResumo({ ...CONTRATO, hora: '2026-10-07T12:00:00' }, 0)), /fuso/);
  });

  it('hora quebrada é recusada: o resumo é por hora cheia', () => {
    assert.match(String(validarResumo({ ...CONTRATO, hora: '2026-10-07T12:30:00-03:00' }, 0)), /hora cheia/);
  });

  it('aceita os jeitos de escrever o fuso', () => {
    for (const hora of ['2026-10-07T15:00:00Z', '2026-10-07T12:00:00-03:00', '2026-10-07T12:00:00-0300']) {
      assert.equal(validarResumo({ ...CONTRATO, hora }, 0), null, hora);
    }
  });

  it('recusa contador negativo, quebrado ou absurdo', () => {
    assert.match(String(validarResumo({ ...CONTRATO, capturas: -1 }, 0)), /capturas/);
    assert.match(String(validarResumo({ ...CONTRATO, conformes: 1.5 }, 0)), /conformes/);
    assert.match(String(validarResumo({ ...CONTRATO, semCena: 10_000_000 }, 0)), /semCena/);
    assert.match(String(validarResumo({ ...CONTRATO, alertas: '3' }, 0)), /alertas/);
  });

  it('recusa soma de confiança maior que a quantidade', () => {
    // Cada confiança vai de 0 a 1. Soma maior que a quantidade daria média
    // acima de 1 na tela.
    assert.match(String(validarResumo({ ...CONTRATO, somaConfianca: 40 }, 0)), /somaConfianca/);
  });

  it('recusa resultado desconhecido e identificador que não é uuid', () => {
    assert.match(String(validarResumo({ ...CONTRATO, ultimoResultado: 'talvez' }, 0)), /ultimoResultado/);
    assert.match(String(validarResumo({ ...CONTRATO, regraId: 'r1' }, 0)), /regraId/);
    assert.match(String(validarResumo({ ...CONTRATO, zonaId: null }, 0)), /zonaId/);
  });

  it('aceita a hora em que nada foi julgado', () => {
    const vazia = {
      ...CONTRATO, ultimoResultado: null, ultimoMotivo: null, ultimoImpedimento: null, ultimaEm: null,
      conformes: 0, naoConformes: 0, naoAvaliaveis: 0, somaConfianca: 0, comConfianca: 0,
      // nada julgado: em lugar nenhum
      julgadasLoja: 0, julgadasNuvem: 0,
    };
    assert.equal(validarResumo(vazia, 0), null);
  });
});

// ───────────────── com banco ─────────────────

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-resumo-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-resumo';
const SENHA = 'uma senha longa o bastante';

describe('resumo por hora (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;

  type Loja = { lojaId: string; token: string; regraId: string; zonaId: string; zona2Id: string; cookie: string };
  let a: Loja;
  let vizinha: Loja;
  let segundoToken = '';

  async function montarLoja(nome: string): Promise<Loja> {
    const loja = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome }, loja: { nome: 'Matriz' }, setores: [{ nome: 'Cozinha' }] },
    })).json();
    const email = `dono-${nome}@e.com`;
    await app.inject({
      method: 'POST', url: '/v1/distribuicao/usuarios', headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId: loja.tenantId, nome: 'X', email, senha: SENHA, nivel: 'presidente' },
    });
    const sessao = await app.inject({ method: 'POST', url: '/v1/sessao', payload: { email, senha: SENHA } });
    const b = sessao.headers['set-cookie'];
    const cookie = (Array.isArray(b) ? b[0]! : String(b)).split(';')[0]!;

    const ponto = async (nomeDoPonto: string, canal: number) => {
      const r = await app.inject({
        method: 'POST', url: `/v1/setores/${loja.setores[0].id}/pontos`, headers: { cookie },
        payload: { nome: nomeDoPonto, origem: 'dvr', canal, host: '192.168.1.108' },
      });
      assert.equal(r.statusCode, 201, r.body);
      return r.json().zonas[0].id as string;
    };
    const zonaId = await ponto('Montagem', 1);
    const zona2Id = await ponto('Chapa', 2);

    const regra = await app.inject({
      method: 'POST', url: `/v1/lojas/${loja.loja.id}/regras`, headers: { cookie },
      payload: { nome: 'Bancada limpa', tipo: 'estado', criterio: 'A superfície está livre de restos.', zonaIds: [zonaId] },
    });
    assert.equal(regra.statusCode, 201, regra.body);

    return {
      lojaId: loja.loja.id, token: await novoAgente(loja.loja.id, nome),
      regraId: regra.json().id, zonaId, zona2Id, cookie,
    };
  }

  async function novoAgente(lojaId: string, quem: string): Promise<string> {
    const agente = await app.inject({
      method: 'POST', url: '/v1/distribuicao/agentes', headers: { 'x-farol-admin': ADMIN },
      payload: { lojaId, nome: `Agente ${quem}` },
    });
    const token = agente.json().token as string;
    const ativar = await app.inject({
      method: 'POST', url: '/v1/agentes/ativar', headers: { authorization: `Bearer ${token}` },
      payload: { fingerprint: `fp-${quem}-${randomUUID().slice(0, 6)}` },
    });
    assert.equal(ativar.statusCode, 200, ativar.body);
    return token;
  }

  /** O corpo do contrato, só com os ids trocados pelos deste banco. */
  const corpo = (mais: Record<string, unknown> = {}) => ({
    ...CONTRATO, regraId: a.regraId, zonaId: a.zonaId, ...mais,
  });

  const mandar = (resumos: unknown[], token = a.token) =>
    app.inject({
      method: 'POST', url: '/v1/resumos', headers: { authorization: `Bearer ${token}` },
      payload: { resumos },
    });

  const gravadas = async (hora: string) =>
    (await pool.query(
      'select * from resumo_hora where regra_id = $1 and zona_id = $2 and hora = $3 order by recebido_em',
      [a.regraId, a.zonaId, hora],
    )).rows;

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    app = criarApp(pool, { logger: false });
    await app.ready();
    a = await montarLoja(marca);
    vizinha = await montarLoja(`${marca}-vizinha`);
    segundoToken = await novoAgente(a.lojaId, `${marca}-2`);
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  it('o corpo do agente ENTRA, e cada campo chega à sua coluna', async () => {
    const r = await mandar([corpo()]);
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json(), { aceitos: 1, recusados: [] });

    const [l] = await gravadas(CONTRATO.hora as string);
    assert.ok(l, 'a linha tem que estar no banco');

    // Coluna por coluna, pelo VALOR: "entrou" não prova que entrou certo.
    assert.equal(l.loja_id, a.lojaId);
    assert.equal(new Date(l.hora).toISOString(), '2026-10-07T15:00:00.000Z', 'meio-dia em -03:00 são 15h UTC');
    assert.equal(l.capturas, 120);
    assert.equal(l.sem_juiz, 0);
    assert.equal(l.sem_quadro, 2);
    assert.equal(l.sem_cena, 3);
    assert.equal(l.em_silencio, 10);
    assert.equal(l.repetidas, 80);
    assert.equal(l.ja_julgadas, 1);
    assert.equal(l.enfileiradas, 24);
    assert.equal(l.conformes, 20);
    assert.equal(l.nao_conformes, 2);
    assert.equal(l.nao_avaliaveis, 1);
    assert.equal(l.falhas, 1);
    assert.equal(l.alertas, 1);
    assert.equal(Number(l.soma_confianca), 19.75);
    assert.equal(l.com_confianca, 23);
    assert.equal(Number(l.soma_latencia_ms), 20976);
    assert.equal(l.com_latencia, 23);
    assert.equal(Number(l.custo_centavos), 24.61);
    assert.equal(l.julgadas_loja, 3);
    assert.equal(l.julgadas_nuvem, 20);
    assert.equal(l.ultimo_resultado, 'nao_conforme');
    assert.equal(l.ultimo_motivo, 'há restos de alimento sobre a bancada');
    assert.equal(l.ultimo_impedimento, 'a câmera entregou a tela de sem sinal');
    assert.equal(new Date(l.ultima_em).toISOString(), '2026-10-07T15:58:31.000Z');
    assert.ok(l.agente_id, 'a linha sabe de qual agente veio');
  });

  it('a mesma hora de novo SUBSTITUI: o agente manda o acumulado', async () => {
    const hora = '2026-10-07T09:00:00-03:00';
    await mandar([corpo({ hora, capturas: 10, repetidas: 4, enfileiradas: 6, emSilencio: 0, semQuadro: 0, semCena: 0, jaJulgadas: 0 })]);
    await mandar([corpo({ hora, capturas: 25, repetidas: 12, enfileiradas: 13, emSilencio: 0, semQuadro: 0, semCena: 0, jaJulgadas: 0 })]);
    // E um pedido repetido depois de uma queda de rede dá no mesmo.
    await mandar([corpo({ hora, capturas: 25, repetidas: 12, enfileiradas: 13, emSilencio: 0, semQuadro: 0, semCena: 0, jaJulgadas: 0 })]);

    const linhas = await gravadas(hora);
    assert.equal(linhas.length, 1, 'três pedidos, uma linha');
    assert.equal(linhas[0].capturas, 25, 'somou em vez de substituir, ou ficou com o valor antigo');
    assert.equal(linhas[0].repetidas, 12);
    assert.ok(new Date(linhas[0].atualizado_em) >= new Date(linhas[0].recebido_em));
  });

  it('DOIS agentes na mesma hora não se apagam', async () => {
    // Agente reinstalado no meio da hora começa do zero. Se a chave não
    // tivesse o agente, ele apagaria o que o anterior contou.
    const hora = '2026-10-07T10:00:00-03:00';
    await mandar([corpo({ hora, capturas: 40 })]);
    await mandar([corpo({ hora, capturas: 7 })], segundoToken);

    const linhas = await gravadas(hora);
    assert.deepEqual(linhas.map((l) => l.capturas).sort((x, y) => x - y), [7, 40]);
    assert.notEqual(linhas[0].agente_id, linhas[1].agente_id);
  });

  it('critério de OUTRA loja é recusado pela posição, e o resto entra', async () => {
    const hora = '2026-10-07T11:00:00-03:00';
    const r = await mandar([
      corpo({ hora }),
      corpo({ hora, regraId: vizinha.regraId, zonaId: vizinha.zonaId }),
      corpo({ hora, zonaId: a.zona2Id }),
    ]);

    assert.deepEqual(r.json(), { aceitos: 2, recusados: [1] });
    const doVizinho = await pool.query(
      'select count(*)::int as n from resumo_hora where regra_id = $1', [vizinha.regraId],
    );
    assert.equal(doVizinho.rows[0].n, 0, 'gravou resumo no critério de outra conta');
  });

  it('critério daqui com CANAL de outra loja também é recusado', async () => {
    // Sem a segunda junção, o critério próprio serviria de passe para
    // escrever contra a zona de qualquer loja.
    const hora = '2026-10-07T13:00:00-03:00';
    const r = await mandar([corpo({ hora, zonaId: vizinha.zonaId })]);

    assert.deepEqual(r.json(), { aceitos: 0, recusados: [0] });
    const n = await pool.query('select count(*)::int as n from resumo_hora where zona_id = $1', [vizinha.zonaId]);
    assert.equal(n.rows[0].n, 0);
  });

  it('critério que saiu do canal ainda tem o que foi olhado antes', async () => {
    // Tirar o critério do canal às 15h não apaga o que foi visto às 14h.
    // O canal 2 nunca foi alvo deste critério, e a linha entra mesmo assim:
    // o que se exige é que critério e canal sejam DESTA loja.
    const hora = '2026-10-07T14:00:00-03:00';
    const r = await mandar([corpo({ hora, zonaId: a.zona2Id })]);
    assert.deepEqual(r.json(), { aceitos: 1, recusados: [] });
  });

  it('a mesma linha duas vezes no lote não derruba o pedido', async () => {
    // Sem cuidado, o Postgres recusa a instrução inteira ("cannot affect
    // row a second time") e uma repetição derrubaria quinhentas boas.
    const hora = '2026-10-07T16:00:00-03:00';
    const r = await mandar([corpo({ hora, capturas: 5 }), corpo({ hora, capturas: 9 })]);

    assert.equal(r.statusCode, 200, r.body);
    const linhas = await gravadas(hora);
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0].capturas, 9, 'vale a última do lote');
  });

  it('texto comprido é cortado, não recusado', async () => {
    const hora = '2026-10-07T17:00:00-03:00';
    const r = await mandar([corpo({ hora, ultimoImpedimento: 'x'.repeat(5000) })]);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal((await gravadas(hora))[0].ultimo_impedimento.length, 500);
  });

  it('sem credencial não entra', async () => {
    const r = await app.inject({ method: 'POST', url: '/v1/resumos', payload: { resumos: [corpo()] } });
    assert.equal(r.statusCode, 401);
  });

  it('sessão de pessoa não serve: quem manda resumo é o agente', async () => {
    const r = await app.inject({
      method: 'POST', url: '/v1/resumos', headers: { cookie: a.cookie }, payload: { resumos: [corpo()] },
    });
    assert.equal(r.statusCode, 401);
  });

  it('corpo errado diz o que esperava', async () => {
    const semLista = await app.inject({
      method: 'POST', url: '/v1/resumos', headers: { authorization: `Bearer ${a.token}` }, payload: { resumo: corpo() },
    });
    assert.equal(semLista.statusCode, 400);

    const semFuso = await mandar([corpo({ hora: '2026-10-07T12:00:00' })]);
    assert.equal(semFuso.statusCode, 422);
    assert.match(semFuso.json().problemas[0], /fuso/);
  });

  it('lote acima do teto é recusado inteiro', async () => {
    const r = await mandar(Array.from({ length: 501 }, () => corpo()));
    assert.equal(r.statusCode, 413);
  });

  it('lista vazia é pedido válido', async () => {
    const r = await mandar([]);
    assert.deepEqual(r.json(), { aceitos: 0, recusados: [] });
  });
});
