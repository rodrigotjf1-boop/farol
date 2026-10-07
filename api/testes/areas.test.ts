// Mais de uma área por canal — criar, excluir e o que cada uma carrega.
//
// A mesma câmera do caixa confere PRESENÇA dentro do balcão e FILA do lado
// do cliente: duas áreas, cada uma com os seus critérios. O que tem de
// ficar provado:
//
//   - o critério posto numa área só vale nela — no console e no que desce
//     para o agente;
//   - excluir a área tira os critérios dela DESTE canal, desliga o que
//     ficou sem lugar e deixa o histórico inteiro;
//   - o canal nunca fica sem área, e nunca com duas principais;
//   - só quem configura cria, edita e exclui; outra conta nem sabe que a
//     área existe.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-areas-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-areas';
const SENHA = 'uma senha longa o bastante';
const RET = (x1: number, y1: number, x2: number, y2: number) => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];

type Area = { id: string; nome: string; principal: boolean; poligono: number[][]; criterios: { id: string; nome: string }[] };

describe('áreas do canal (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  let lojaId = '';
  let setorId = '';
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

  /** Um canal novo, com a área "Quadro inteiro" que todo canal ganha. */
  async function canalNovo(nome: string) {
    const r = await app.inject({
      method: 'POST', url: `/v1/setores/${setorId}/pontos`, headers: { cookie },
      payload: { nome, origem: 'dvr', canal: Math.floor(Math.random() * 60) + 1, host: '192.168.1.108' },
    });
    assert.equal(r.statusCode, 201, r.body);
    return { pontoId: r.json().id as string, inteira: r.json().zonas[0].id as string };
  }

  const criarArea = (pontoId: string, corpo: Record<string, unknown>, comCookie = cookie) =>
    app.inject({ method: 'POST', url: `/v1/pontos/${pontoId}/zonas`, headers: { cookie: comCookie }, payload: corpo });
  const excluirArea = (id: string, comCookie = cookie) =>
    app.inject({ method: 'DELETE', url: `/v1/zonas/${id}`, headers: { cookie: comCookie } });
  const areasDe = async (pontoId: string): Promise<Area[]> =>
    (await app.inject({ method: 'GET', url: `/v1/pontos/${pontoId}`, headers: { cookie } })).json().zonas;

  async function criterio(nome: string, zonaIds: string[], ligar = true) {
    const r = await app.inject({
      method: 'POST', url: `/v1/lojas/${lojaId}/regras`, headers: { cookie },
      payload: { nome, tipo: 'estado', criterio: `Texto de ${nome}.`, zonaIds, quando: 'sempre' },
    });
    assert.equal(r.statusCode, 201, r.body);
    const id = r.json().id as string;
    if (ligar) {
      const l = await app.inject({ method: 'PATCH', url: `/v1/regras/${id}`, headers: { cookie }, payload: { ativa: true } });
      assert.equal(l.statusCode, 200, l.body);
    }
    return id;
  }

  const doAgente = (metodo: 'GET' | 'POST', url: string, payload?: unknown) =>
    app.inject({ method: metodo, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });

  /** zonaId → nomes dos critérios, como o AGENTE recebe. */
  async function noAgente(pontoId: string): Promise<Record<string, string[]>> {
    const c = (await doAgente('GET', '/v1/agentes/configuracao')).json();
    const ponto = c.pontos.find((p: { id: string }) => p.id === pontoId);
    return Object.fromEntries(
      (ponto?.zonas ?? []).map((z: { nome: string; regras: { nome: string }[] }) => [z.nome, z.regras.map((r) => r.nome).sort()]),
    );
  }

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
    setorId = conta.setores[0].id;
    cookie = await entrar(conta.tenantId, `ger-${marca}@e.com`, 'gerente');
    cookieSupervisao = await entrar(conta.tenantId, `sup-${marca}@e.com`, 'supervisao');

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
    await doAgente('POST', '/v1/agentes/ativar', { fingerprint: `fp-${marca}` });
    assert.equal((await doAgente('POST', '/v1/agentes/heartbeat', { versao: '0.9.4' })).statusCode, 200);
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  // ───────────────────────────── criar ─────────────────────────────

  it('a área nova entra no canal, sem tomar o lugar da principal', async () => {
    const c = await canalNovo('Balcão');
    const versaoAntes = (await pool.query(`select config_versao from loja where id = $1`, [lojaId])).rows[0].config_versao;

    const r = await criarArea(c.pontoId, { nome: '  Lado do cliente ', poligono: RET(0.55, 0.1, 0.95, 0.9) });
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json().nome, 'Lado do cliente', 'o nome vem aparado');
    assert.equal(r.json().principal, false);
    assert.deepEqual(r.json().criterios, []);

    const areas = await areasDe(c.pontoId);
    assert.deepEqual(areas.map((a) => [a.nome, a.principal]), [['Quadro inteiro', true], ['Lado do cliente', false]]);

    // A árvore de canais do console também passa a ver as duas.
    const arvore = (await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}`, headers: { cookie } })).json();
    const ponto = arvore.setores[0].pontos.find((p: { id: string }) => p.id === c.pontoId);
    assert.equal(ponto.zonas.length, 2);

    // E o agente é avisado: sem subir a versão ele não puxa a área nova.
    const versaoDepois = (await pool.query(`select config_versao from loja where id = $1`, [lojaId])).rows[0].config_versao;
    assert.ok(versaoDepois > versaoAntes, 'criar área não subiu a versão da configuração');
  });

  it('sem desenho, a área nasce no meio do quadro', async () => {
    const c = await canalNovo('Sem desenho');
    const r = await criarArea(c.pontoId, { nome: 'Nova' });
    assert.equal(r.statusCode, 201, r.body);
    assert.deepEqual(r.json().poligono, RET(0.3, 0.3, 0.7, 0.7));
  });

  it('recusa o que não é área: sem nome, nome repetido, polígono torto', async () => {
    const c = await canalNovo('Recusas');
    assert.equal((await criarArea(c.pontoId, {})).statusCode, 422);
    assert.equal((await criarArea(c.pontoId, { nome: '   ' })).statusCode, 422);
    assert.equal((await criarArea(c.pontoId, { nome: 'x'.repeat(61) })).statusCode, 422);
    assert.equal((await criarArea(c.pontoId, { nome: 'Torta', poligono: [[0, 0], [2, 2]] })).statusCode, 422);

    // "Quadro inteiro" já existe neste canal — e maiúscula não faz outro nome.
    const repetida = await criarArea(c.pontoId, { nome: 'QUADRO INTEIRO' });
    assert.equal(repetida.statusCode, 409, repetida.body);
    assert.equal(repetida.json().erro, 'nome_repetido');
    assert.equal((await areasDe(c.pontoId)).length, 1, 'nada foi criado');

    // O mesmo nome em OUTRO canal pode.
    const outro = await canalNovo('Outro canal');
    assert.equal((await criarArea(outro.pontoId, { nome: 'Lado do cliente' })).statusCode, 201);
    assert.equal((await criarArea(c.pontoId, { nome: 'Lado do cliente' })).statusCode, 201);
  });

  it('um canal tem no máximo oito áreas', async () => {
    const c = await canalNovo('Cheio');
    for (let i = 2; i <= 8; i += 1) {
      assert.equal((await criarArea(c.pontoId, { nome: `Área ${i}` })).statusCode, 201);
    }
    const nona = await criarArea(c.pontoId, { nome: 'Área 9' });
    assert.equal(nona.statusCode, 409, nona.body);
    assert.equal(nona.json().erro, 'areas_demais');
  });

  it('só quem configura cria, edita e exclui; outra conta nem sabe que existe', async () => {
    const c = await canalNovo('Permissões');
    const nova = (await criarArea(c.pontoId, { nome: 'Minha' })).json().id as string;

    assert.equal((await criarArea(c.pontoId, { nome: 'Da supervisão' }, cookieSupervisao)).statusCode, 403);
    assert.equal((await excluirArea(nova, cookieSupervisao)).statusCode, 403);
    const edita = await app.inject({
      method: 'PATCH', url: `/v1/zonas/${nova}`, headers: { cookie: cookieSupervisao }, payload: { nome: 'Mudei' },
    });
    assert.equal(edita.statusCode, 403, 'supervisão acompanha a operação, não redesenha a área');

    assert.equal((await criarArea(c.pontoId, { nome: 'Do vizinho' }, cookieVizinho)).statusCode, 404);
    assert.equal((await excluirArea(nova, cookieVizinho)).statusCode, 404);

    assert.equal((await app.inject({ method: 'POST', url: `/v1/pontos/${c.pontoId}/zonas`, payload: { nome: 'x' } })).statusCode, 401);
    assert.equal((await app.inject({ method: 'DELETE', url: `/v1/zonas/${nova}` })).statusCode, 401);

    assert.deepEqual((await areasDe(c.pontoId)).map((a) => a.nome), ['Quadro inteiro', 'Minha'], 'ninguém mexeu');
  });

  it('renomear para um nome que já existe no canal é recusado', async () => {
    const c = await canalNovo('Renomear');
    const nova = (await criarArea(c.pontoId, { nome: 'Lado do cliente' })).json().id as string;
    const r = await app.inject({
      method: 'PATCH', url: `/v1/zonas/${nova}`, headers: { cookie }, payload: { nome: 'quadro inteiro' },
    });
    assert.equal(r.statusCode, 409, r.body);
    assert.equal((await areasDe(c.pontoId))[1]!.nome, 'Lado do cliente');
  });

  // ─────────────────────── o critério é da área ───────────────────────

  it('critério posto numa área só vale nela — no console e no agente', async () => {
    const c = await canalNovo('Caixa principal');
    await app.inject({ method: 'PATCH', url: `/v1/zonas/${c.inteira}`, headers: { cookie }, payload: { nome: 'Dentro do balcão' } });
    const cliente = (await criarArea(c.pontoId, { nome: 'Lado do cliente' })).json().id as string;

    await criterio('Alguém no balcão', [c.inteira]);
    await criterio('Fila no balcão', [cliente]);

    const areas = await areasDe(c.pontoId);
    assert.deepEqual(
      areas.map((a) => [a.nome, a.criterios.map((k) => k.nome)]),
      [['Dentro do balcão', ['Alguém no balcão']], ['Lado do cliente', ['Fila no balcão']]],
    );
    assert.deepEqual(await noAgente(c.pontoId), {
      'Dentro do balcão': ['Alguém no balcão'],
      'Lado do cliente': ['Fila no balcão'],
    });
  });

  it('o painel diz a área junto do canal — só no canal que tem mais de uma', async () => {
    const duas = await canalNovo('Com duas áreas');
    const cliente = (await criarArea(duas.pontoId, { nome: 'Lado do cliente' })).json().id as string;
    const uma = await canalNovo('Com uma área');
    const fila = await criterio('Fila do painel', [cliente, uma.inteira]);

    const hora = `${new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000 - 3 * 3_600_000).toISOString().slice(0, 19)}-03:00`;
    const linha = (zonaId: string) => ({
      regraId: fila, zonaId, hora,
      capturas: 4, semJuiz: 0, semQuadro: 0, semCena: 0, emSilencio: 0, repetidas: 0, jaJulgadas: 0,
      enfileiradas: 4, conformes: 3, naoConformes: 1, naoAvaliaveis: 0, falhas: 0, alertas: 0,
      somaConfianca: 3.6, comConfianca: 4, somaLatenciaMs: 400, comLatencia: 4, custoCentavos: 0,
      ultimoResultado: 'conforme', ultimoMotivo: null, ultimoImpedimento: null, ultimaEm: null,
    });
    const sobe = await doAgente('POST', '/v1/resumos', { resumos: [linha(cliente), linha(uma.inteira)] });
    assert.deepEqual(sobe.json(), { aceitos: 2, recusados: [] }, sobe.body);

    const r = await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}/resultados`, headers: { cookie } });
    assert.equal(r.statusCode, 200, r.body);
    const doCriterio = (r.json().linhas as { regraId: string; pontoNome: string; areaNome: string | null }[])
      .filter((l) => l.regraId === fila)
      .map((l) => [l.pontoNome, l.areaNome]);
    assert.deepEqual(
      doCriterio.sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      [['Com duas áreas', 'Lado do cliente'], ['Com uma área', null]],
      'com uma área só, o nome dela não diz nada além do canal',
    );
  });

  // ───────────────────────────── excluir ─────────────────────────────

  it('excluir a área tira os critérios dela deste canal, desliga o órfão e guarda o histórico', async () => {
    const c = await canalNovo('Excluir');
    const cliente = (await criarArea(c.pontoId, { nome: 'Lado do cliente' })).json().id as string;
    const soAqui = await criterio('Fila só aqui', [cliente]);
    const nasDuas = await criterio('Vale nas duas', [c.inteira, cliente]);

    // O agente já contou coisa nesta área: é o histórico que não pode sumir.
    const hora = `${new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000 - 3 * 3_600_000).toISOString().slice(0, 19)}-03:00`;
    const sobe = await doAgente('POST', '/v1/resumos', {
      resumos: [{
        regraId: soAqui, zonaId: cliente, hora,
        capturas: 10, semJuiz: 0, semQuadro: 0, semCena: 0, emSilencio: 0, repetidas: 0, jaJulgadas: 0,
        enfileiradas: 10, conformes: 7, naoConformes: 3, naoAvaliaveis: 0, falhas: 0, alertas: 1,
        somaConfianca: 9, comConfianca: 10, somaLatenciaMs: 900, comLatencia: 10, custoCentavos: 0,
        ultimoResultado: 'conforme', ultimoMotivo: null, ultimoImpedimento: null, ultimaEm: null,
      }],
    });
    assert.deepEqual(sobe.json(), { aceitos: 1, recusados: [] }, sobe.body);

    const r = await excluirArea(cliente);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().criteriosTirados, 2);
    assert.deepEqual(r.json().criteriosDesligados, ['Fila só aqui'], 'só o que ficou sem lugar é desligado');

    // some da tela, do agente e da árvore
    assert.deepEqual((await areasDe(c.pontoId)).map((a) => a.nome), ['Quadro inteiro']);
    assert.deepEqual(await noAgente(c.pontoId), { 'Quadro inteiro': ['Vale nas duas'] });

    // o critério que valia nas duas continua ligado na que sobrou
    const regras = (await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}/regras`, headers: { cookie } })).json().regras as
      { id: string; ativa: boolean; alvos: unknown[] }[];
    const orfa = regras.find((x) => x.id === soAqui)!;
    const viva = regras.find((x) => x.id === nasDuas)!;
    assert.equal(orfa.ativa, false);
    assert.equal(orfa.alvos.length, 0, 'fica em "Sem canal", guardado');
    assert.equal(viva.ativa, true);
    assert.equal(viva.alvos.length, 1);

    // o histórico está inteiro: a linha da área ficou, marcada, e o resumo com ela
    const z = await pool.query(`select excluida_em, principal from zona where id = $1`, [cliente]);
    assert.ok(z.rows[0].excluida_em, 'a área tem que ficar marcada, não apagada');
    const h = await pool.query(`select conformes, nao_conformes from resumo_hora where zona_id = $1`, [cliente]);
    assert.deepEqual(h.rows, [{ conformes: 7, nao_conformes: 3 }], 'o que a área registrou sumiu');
  });

  it('o nome da área excluída fica livre, e ela não aceita mais nada', async () => {
    const c = await canalNovo('Depois de excluir');
    const cliente = (await criarArea(c.pontoId, { nome: 'Lado do cliente' })).json().id as string;
    assert.equal((await excluirArea(cliente)).statusCode, 200);

    assert.equal((await excluirArea(cliente)).statusCode, 404, 'excluir de novo');
    const edita = await app.inject({ method: 'PATCH', url: `/v1/zonas/${cliente}`, headers: { cookie }, payload: { nome: 'Volta' } });
    assert.equal(edita.statusCode, 404);
    const critNela = await app.inject({
      method: 'POST', url: `/v1/lojas/${lojaId}/regras`, headers: { cookie },
      payload: { nome: 'Em área que não existe', tipo: 'estado', criterio: 'x', zonaIds: [cliente] },
    });
    assert.ok(critNela.statusCode >= 400 && critNela.statusCode < 500, `aceitou critério em área excluída: ${critNela.body}`);

    assert.equal((await criarArea(c.pontoId, { nome: 'Lado do cliente' })).statusCode, 201);
  });

  it('o canal nunca fica sem área', async () => {
    const c = await canalNovo('Última');
    const r = await excluirArea(c.inteira);
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().erro, 'ultima_area');
    assert.equal((await areasDe(c.pontoId)).length, 1);
  });

  it('excluída a principal, a mais antiga que sobrou assume — e só ela', async () => {
    const c = await canalNovo('Principal');
    const b = (await criarArea(c.pontoId, { nome: 'B' })).json().id as string;
    await criarArea(c.pontoId, { nome: 'C' });

    assert.equal((await excluirArea(c.inteira)).statusCode, 200);

    const areas = await areasDe(c.pontoId);
    assert.deepEqual(areas.map((a) => [a.nome, a.principal]), [['B', true], ['C', false]]);
    assert.equal(areas[0]!.id, b);
    const principais = await pool.query(
      `select count(*)::int as n from zona where ponto_id = $1 and principal`, [c.pontoId],
    );
    assert.equal(principais.rows[0].n, 1, 'o canal tem um corte principal, nem zero nem dois');
  });
});
