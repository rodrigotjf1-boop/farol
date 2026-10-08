// "Analisar as fotos e descrever" (migration 026), de ponta a ponta na API:
//
//   - é um comando para o agente da loja; sem foto, sem agente ou em loja de
//     modo local, o pedido é recusado na hora, dizendo por quê;
//   - clicar de novo enquanto um pedido está a caminho devolve o mesmo;
//   - o agente recebe o que precisa e baixa as fotos — só as da loja dele;
//   - a resposta é uma SUGESTÃO: fica no comando e não mexe no cadastro até
//     alguém salvar;
//   - o pedido que passou do prazo aparece como expirado, não como esperando.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { lerDescricaoDoAgente, MAX_CONFERIR } from '../src/rotas/inventario.js';

// O mesmo arquivo que o agente lê (agent/testes/test_descrever.py).
const CONTRATO = JSON.parse(
  readFileSync(new URL('../../contratos/descrever-equipamento.json', import.meta.url), 'utf8'),
) as {
  comando: { tipo: string; parametros: Record<string, unknown> & { fotos: Record<string, unknown>[] } };
  resposta: { descricao: string; conferir: string[]; modelo: string; custoCentavos: number };
};

function jpeg(largura: number, altura: number, miolo = 1): Buffer {
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, altura >> 8, altura & 0xff, largura >> 8, largura & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const sos = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, miolo];
  return Buffer.from([0xff, 0xd8, ...sof, ...sos, 0xff, 0xd9]);
}
const QUADRO = jpeg(1280, 720, 1);
const DE_PERTO = jpeg(900, 1200, 2);

describe('o que o agente devolve da análise (sem banco)', () => {
  it('sem descrição não há o que guardar', () => {
    for (const ruim of [{}, { descricao: '' }, { descricao: '   ' }, { descricao: 7 }, { conferir: ['x'] }, null]) {
      assert.ok(lerDescricaoDoAgente(ruim).problema, JSON.stringify(ruim));
    }
  });

  it('o texto do modelo é limpo e CORTADO, não recusado', () => {
    const { sugestao } = lerDescricaoDoAgente({
      descricao: `  ${'d'.repeat(2500)}  `,
      conferir: [' Tampas abaixadas ', 'Tampas abaixadas', '', 7, null, 'x'.repeat(300), ...Array.from({ length: 12 }, (_, i) => `ponto ${i}`)],
      modelo: ' claude-sonnet-5-5 ',
      custoCentavos: 14.5804,
    });
    assert.equal(sugestao?.descricao.length, 2000);
    assert.equal(sugestao?.conferir.length, MAX_CONFERIR);
    assert.deepEqual(sugestao?.conferir.slice(0, 3), ['Tampas abaixadas', 'x'.repeat(160), 'ponto 0'], 'sem repetir, sem o que não é texto, com o comprido cortado');
    assert.equal(sugestao?.modelo, 'claude-sonnet-5-5');
    assert.equal(sugestao?.custoCentavos, 14.58);
  });

  it('o que falta ou vem torto fica nulo, não inventado', () => {
    const { sugestao } = lerDescricaoDoAgente({ descricao: 'Chapa de inox.', conferir: 'não é lista', modelo: 3, custoCentavos: -1 });
    assert.deepEqual(sugestao, { descricao: 'Chapa de inox.', conferir: [], modelo: null, custoCentavos: null });
    assert.equal(lerDescricaoDoAgente({ descricao: 'x', custoCentavos: Number.NaN }).sugestao?.custoCentavos, null);
    assert.equal(lerDescricaoDoAgente({ descricao: 'x', custoCentavos: 0 }).sugestao?.custoCentavos, 0, 'zero é custo: não é "sem medida"');
  });
});

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-descr-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-descricao';
const SENHA = 'uma senha longa o bastante';

describe('analisar as fotos e descrever (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  let lojaId = '';
  let setorId = '';
  let lojaSemAgente = '';
  let setorSemAgente = '';
  let cookie = '';
  let cookieSupervisao = '';
  let cookieSemAgente = '';
  let token = '';
  let tokenDeOutra = '';
  let canais = 0;

  async function entrar(tenantId: string, email: string, nivel: string) {
    await app.inject({
      method: 'POST', url: '/v1/distribuicao/usuarios', headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId, nome: 'Ana Souza', email, senha: SENHA, nivel },
    });
    const r = await app.inject({ method: 'POST', url: '/v1/sessao', payload: { email, senha: SENHA } });
    const b = r.headers['set-cookie'];
    return (Array.isArray(b) ? b[0]! : String(b)).split(';')[0]!;
  }
  async function novoAgente(loja: string, quem: string) {
    const a = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/agentes', headers: { 'x-farol-admin': ADMIN }, payload: { lojaId: loja, nome: `PC ${quem}` },
    })).json();
    const ativar = await app.inject({
      method: 'POST', url: '/v1/agentes/ativar', headers: { authorization: `Bearer ${a.token}` },
      payload: { fingerprint: `fp-${quem}-${randomUUID().slice(0, 6)}` },
    });
    assert.equal(ativar.statusCode, 200, ativar.body);
    return a.token as string;
  }
  const bater = async (comToken = token) =>
    (await app.inject({ method: 'POST', url: '/v1/agentes/heartbeat', headers: { authorization: `Bearer ${comToken}` }, payload: {} })).json();
  /** Um canal com quadro, e a área dele com um desenho. */
  async function canalComQuadro(nome: string) {
    canais += 1;
    const r = await app.inject({
      method: 'POST', url: `/v1/setores/${setorId}/pontos`, headers: { cookie },
      payload: { nome, origem: 'dvr', canal: canais, host: '192.168.1.108' },
    });
    assert.equal(r.statusCode, 201, r.body);
    const id = r.json().id as string;
    const zona = r.json().zonas[0].id as string;
    const pedido = await app.inject({ method: 'POST', url: `/v1/pontos/${id}/preview`, headers: { cookie } });
    await bater();
    await app.inject({
      method: 'POST', url: `/v1/agentes/comandos/${pedido.json().comandoId}/resultado`, headers: { authorization: `Bearer ${token}` },
      payload: { imagemBase64: QUADRO.toString('base64'), largura: 1280, altura: 720 },
    });
    return { id, zona };
  }
  /** Um equipamento com uma foto enviada. */
  async function equipamento(nome: string, comCookie = cookie, loja = lojaId, setor = setorId) {
    const r = await app.inject({ method: 'POST', url: `/v1/lojas/${loja}/inventario`, headers: { cookie: comCookie }, payload: { nome, setorId: setor, tipo: 'chapa' } });
    assert.equal(r.statusCode, 201, r.body);
    const id = r.json().id as string;
    const f = await app.inject({ method: 'POST', url: `/v1/inventario/${id}/fotos`, headers: { cookie: comCookie }, payload: { origem: 'envio', imagemBase64: DE_PERTO.toString('base64') } });
    assert.equal(f.statusCode, 201, f.body);
    return { id, foto: f.json().fotoId as string };
  }
  const pedir = (id: string, comCookie = cookie) =>
    app.inject({ method: 'POST', url: `/v1/inventario/${id}/descricao`, headers: comCookie ? { cookie: comCookie } : {} });
  const estado = async (id: string, comCookie = cookie) =>
    app.inject({ method: 'GET', url: `/v1/inventario/${id}/descricao`, headers: comCookie ? { cookie: comCookie } : {} });
  const responder = (comandoId: string, corpo: Record<string, unknown>, comToken = token) =>
    app.inject({ method: 'POST', url: `/v1/agentes/comandos/${comandoId}/resultado`, headers: { authorization: `Bearer ${comToken}` }, payload: corpo });
  const item = async (id: string) =>
    ((await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}/inventario`, headers: { cookie } })).json().itens as Record<string, unknown>[]).find((x) => x.id === id)!;
  const salvar = (id: string, corpo: Record<string, unknown>) =>
    app.inject({ method: 'PATCH', url: `/v1/inventario/${id}`, headers: { cookie }, payload: corpo });
  const versao = async () => (await pool.query('select config_versao from loja where id = $1', [lojaId])).rows[0].config_versao as number;
  /** Pede, entrega ao agente e devolve o id do comando. */
  async function pedirEEntregar(id: string) {
    const p = await pedir(id);
    assert.equal(p.statusCode, 202, p.body);
    const comandos = (await bater()).comandos as { id: string; tipo: string }[];
    assert.ok(comandos.some((c) => c.id === p.json().comandoId), 'o agente recebeu o comando');
    return p.json().comandoId as string;
  }

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    app = criarApp(pool, { logger: false });
    await app.ready();

    const conta = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome: marca }, loja: { nome: 'Matriz' }, setores: [{ nome: 'Cozinha' }] },
    })).json();
    lojaId = conta.loja.id;
    setorId = conta.setores[0].id;
    cookie = await entrar(conta.tenantId, `ger-${marca}@e.com`, 'gerente');
    cookieSupervisao = await entrar(conta.tenantId, `sup-${marca}@e.com`, 'supervisao');
    token = await novoAgente(lojaId, marca);

    // outra conta: uma loja SEM agente, e (depois) um agente de outra loja
    const outra = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome: `${marca}-outra` }, loja: { nome: 'Sem agente' }, setores: [{ nome: 'Cozinha' }] },
    })).json();
    lojaSemAgente = outra.loja.id;
    setorSemAgente = outra.setores[0].id;
    cookieSemAgente = await entrar(outra.tenantId, `ger-${marca}-o@e.com`, 'gerente');
    const terceira = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome: `${marca}-terceira` }, loja: { nome: 'Terceira' }, setores: [] },
    })).json();
    tokenDeOutra = await novoAgente(terceira.loja.id, `${marca}-t`);
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  // ───────────────────────── pedir ─────────────────────────

  it('recusa na hora, dizendo por quê: sem foto, loja de modo local, loja sem agente', async () => {
    const semFoto = (await app.inject({ method: 'POST', url: `/v1/lojas/${lojaId}/inventario`, headers: { cookie }, payload: { nome: 'Sem foto', setorId } })).json();
    let r = await pedir(semFoto.id);
    assert.deepEqual([r.statusCode, r.json().erro], [409, 'sem_foto'], r.body);

    const e = await equipamento('Em loja local');
    await pool.query(`update loja set modo_julgamento = 'local' where id = $1`, [lojaId]);
    try {
      r = await pedir(e.id);
      assert.deepEqual([r.statusCode, r.json().erro], [409, 'modo_local'], r.body);
    } finally {
      await pool.query(`update loja set modo_julgamento = 'hibrido' where id = $1`, [lojaId]);
    }

    const la = await equipamento('Sem agente', cookieSemAgente, lojaSemAgente, setorSemAgente);
    r = await pedir(la.id, cookieSemAgente);
    assert.deepEqual([r.statusCode, r.json().erro], [409, 'sem_agente'], r.body);

    assert.equal((await pool.query(`select count(*)::int as n from comando_agente where item_id = any($1)`, [[semFoto.id, e.id, la.id]])).rows[0].n, 0, 'pedido recusado não deixa comando');
  });

  it('quem só vê não pede; outra conta nem sabe que existe; sem sessão é 401', async () => {
    const e = await equipamento('Permissões');
    assert.equal((await pedir(e.id, cookieSupervisao)).statusCode, 403);
    assert.equal((await estado(e.id, cookieSupervisao)).statusCode, 200, 'mas acompanha');
    assert.equal((await pedir(e.id, cookieSemAgente)).statusCode, 404);
    assert.equal((await estado(e.id, cookieSemAgente)).statusCode, 404);
    assert.equal((await pedir(e.id, '')).statusCode, 401);
    assert.equal((await estado(e.id, '')).statusCode, 401);
    assert.equal((await pedir(randomUUID())).statusCode, 404);
  });

  it('o agente recebe o comando com a forma do contrato, e baixa as fotos dele', async () => {
    const c = await canalComQuadro('Chapa');
    const desenho = [[0.1, 0.2], [0.6, 0.2], [0.6, 0.8], [0.1, 0.8]];
    await app.inject({ method: 'PATCH', url: `/v1/zonas/${c.zona}`, headers: { cookie }, payload: { poligono: desenho } });
    const e = await equipamento('Chapa do contrato');
    const doCanal = await app.inject({ method: 'POST', url: `/v1/inventario/${e.id}/fotos`, headers: { cookie }, payload: { origem: 'canal', zonaId: c.zona } });
    assert.equal(doCanal.statusCode, 201, doCanal.body);

    assert.deepEqual((await estado(e.id)).json(), { pedido: null, sugestao: null }, 'antes de pedir não há nada');
    const p = await pedir(e.id);
    assert.equal(p.statusCode, 202, p.body);
    assert.equal(p.json().jaPedido, false);
    assert.equal((await estado(e.id)).json().pedido.estado, 'pendente');

    const [cmd] = ((await bater()).comandos as Record<string, unknown>[]).filter((x) => x.id === p.json().comandoId);
    assert.ok(cmd, 'o comando desce na batida');
    assert.equal(cmd.tipo, CONTRATO.comando.tipo);
    assert.equal(cmd.pontoId, null, 'não é de um canal');
    const parametros = cmd.parametros as typeof CONTRATO.comando.parametros;
    assert.deepEqual(Object.keys(parametros).sort(), Object.keys(CONTRATO.comando.parametros).sort());
    assert.deepEqual(
      { itemId: parametros.itemId, nome: parametros.nome, tipo: parametros.tipo, setor: parametros.setor },
      { itemId: e.id, nome: 'Chapa do contrato', tipo: 'chapa', setor: 'Cozinha' },
    );
    assert.equal(parametros.fotos.length, 2);
    for (const f of parametros.fotos) assert.deepEqual(Object.keys(f).sort(), Object.keys(CONTRATO.comando.parametros.fotos[0]!).sort());
    assert.deepEqual(parametros.fotos.map((f) => [f.origem, f.recorte]), [['envio', null], ['canal', desenho]], 'na ordem em que foram postas, a do canal com o desenho');
    assert.equal((await estado(e.id)).json().pedido.estado, 'entregue');

    // o agente baixa cada foto, e o resumo confere com o que o comando disse
    for (const f of parametros.fotos) {
      const img = await app.inject({ method: 'GET', url: `/v1/agentes/inventario/fotos/${f.id as string}`, headers: { authorization: `Bearer ${token}` } });
      assert.equal(img.statusCode, 200);
      assert.deepEqual(img.rawPayload, f.origem === 'envio' ? DE_PERTO : QUADRO);
      assert.equal(img.headers['x-farol-sha256'], f.sha256);
    }
    const alheia = `/v1/agentes/inventario/fotos/${parametros.fotos[0]!.id as string}`;
    assert.equal((await app.inject({ method: 'GET', url: alheia, headers: { authorization: `Bearer ${tokenDeOutra}` } })).statusCode, 404, 'o agente de outra loja não baixa');
    assert.equal((await app.inject({ method: 'GET', url: alheia })).statusCode, 401);
  });

  it('clicar de novo, ou cinco vezes ao mesmo tempo, é UM pedido', async () => {
    // Quem garante é a trava na linha do equipamento. Sem ela a corrida
    // passa uma vez em quatro (conferido tirando-a) — por isso as rodadas.
    let e = { id: '', foto: '' };
    let todos: Awaited<ReturnType<typeof pedir>>[] = [];
    for (let rodada = 0; rodada < 6; rodada += 1) {
      e = await equipamento(`Cliques ${rodada}`);
      todos = await Promise.all(Array.from({ length: 5 }, () => pedir(e.id)));
      assert.deepEqual(todos.map((r) => r.statusCode), [202, 202, 202, 202, 202], `rodada ${rodada}`);
      assert.equal(new Set(todos.map((r) => r.json().comandoId)).size, 1, `rodada ${rodada}: o mesmo comando para todos`);
      assert.equal(todos.filter((r) => r.json().jaPedido === false).length, 1, `rodada ${rodada}`);
      assert.equal((await pool.query('select count(*)::int as n from comando_agente where item_id = $1', [e.id])).rows[0].n, 1, `rodada ${rodada}`);
    }

    await bater();
    const depois = await pedir(e.id);
    assert.deepEqual([depois.json().comandoId, depois.json().jaPedido], [todos[0]!.json().comandoId, true], 'já entregue ao agente, continua sendo o mesmo');
  });

  // ───────────────────────── a resposta é uma sugestão ─────────────────────────

  it('a resposta do agente fica como sugestão: o cadastro só muda quando alguém salva', async () => {
    const c = await canalComQuadro('Para a versão');
    const e = await equipamento('Chapa sugerida');
    await app.inject({ method: 'POST', url: `/v1/inventario/${e.id}/fotos`, headers: { cookie }, payload: { origem: 'canal', zonaId: c.zona } });
    const comandoId = await pedirEEntregar(e.id);
    const antes = await versao();

    const r = await responder(comandoId, CONTRATO.resposta);
    assert.equal(r.statusCode, 200, r.body);

    const s = (await estado(e.id)).json();
    assert.equal(s.pedido.estado, 'concluido');
    assert.deepEqual(
      { comandoId: s.sugestao.comandoId, descricao: s.sugestao.descricao, conferir: s.sugestao.conferir, modelo: s.sugestao.modelo, custo: s.sugestao.custoCentavos },
      { comandoId, descricao: CONTRATO.resposta.descricao, conferir: CONTRATO.resposta.conferir, modelo: CONTRATO.resposta.modelo, custo: CONTRATO.resposta.custoCentavos },
    );
    assert.ok(s.sugestao.feitaEm);

    let i = await item(e.id);
    assert.deepEqual([i.descricao, i.conferir, i.descritoEm, i.descritoPor], ['', [], null, null], 'o cadastro não mudou');
    assert.equal(await versao(), antes, 'e nada desceu ao agente');

    // a pessoa leu, corrigiu e salvou
    const salvo = await salvar(e.id, { descricao: `${CONTRATO.resposta.descricao} Corrigida.`, conferir: CONTRATO.resposta.conferir, daAnalise: comandoId });
    assert.equal(salvo.statusCode, 200, salvo.body);
    i = await item(e.id);
    assert.equal(i.descricao, `${CONTRATO.resposta.descricao} Corrigida.`);
    assert.deepEqual(i.conferir, CONTRATO.resposta.conferir);
    assert.ok(i.descritoEm, 'guarda quando veio da análise');
    assert.equal(i.descritoPor, CONTRATO.resposta.modelo, 'e por qual modelo');
    assert.ok((await versao()) > antes, 'agora sim a descrição desce');
    assert.equal((await estado(e.id)).json().sugestao, null, 'a sugestão foi resolvida');
    assert.equal((await estado(e.id)).json().pedido.estado, 'concluido');
  });

  it('salvar outra descrição deixa a sugestão de lado — e não diz que veio da análise', async () => {
    const e = await equipamento('Escrita à mão');
    const comandoId = await pedirEEntregar(e.id);
    await responder(comandoId, CONTRATO.resposta);
    assert.ok((await estado(e.id)).json().sugestao);

    // salvar só o nome não resolve nada: a sugestão continua esperando
    await salvar(e.id, { nome: 'Escrita à mão 2' });
    assert.ok((await estado(e.id)).json().sugestao, 'mexer no nome não é decidir a descrição');

    await salvar(e.id, { descricao: 'Chapa pequena, escrita por quem conhece.' });
    assert.equal((await estado(e.id)).json().sugestao, null);
    const i = await item(e.id);
    assert.deepEqual([i.descricao, i.descritoEm, i.descritoPor], ['Chapa pequena, escrita por quem conhece.', null, null]);

    // `daAnalise` de um comando que não é desta sugestão não marca nada
    const outro = await equipamento('Outro');
    const doOutro = await pedirEEntregar(outro.id);
    await responder(doOutro, CONTRATO.resposta);
    await salvar(e.id, { descricao: 'De novo, à mão.', daAnalise: doOutro });
    assert.equal((await item(e.id)).descritoPor, null);
    assert.ok((await estado(outro.id)).json().sugestao, 'e a sugestão do outro equipamento continua lá');
  });

  it('a falha do agente aparece com o motivo; resposta sem descrição é recusada', async () => {
    const e = await equipamento('Falha');
    const comandoId = await pedirEEntregar(e.id);

    const vazia = await responder(comandoId, { descricao: '   ', conferir: [] });
    assert.equal(vazia.statusCode, 422, vazia.body);
    assert.equal((await estado(e.id)).json().pedido.estado, 'entregue', 'continua esperando uma resposta de verdade');

    const falha = await responder(comandoId, { erro: 'as fotos não mostram o equipamento com clareza bastante para descrever' });
    assert.equal(falha.statusCode, 200);
    const s = (await estado(e.id)).json();
    assert.deepEqual([s.pedido.estado, s.pedido.erro, s.sugestao], ['falhou', 'as fotos não mostram o equipamento com clareza bastante para descrever', null]);

    // depois da falha, pedir de novo é um pedido NOVO
    const novo = await pedir(e.id);
    assert.equal(novo.json().jaPedido, false);
    assert.notEqual(novo.json().comandoId, comandoId);
  });

  it('só o agente dono do comando responde; resposta repetida não troca o que foi guardado', async () => {
    const e = await equipamento('Dono do comando');
    const comandoId = await pedirEEntregar(e.id);
    assert.equal((await responder(comandoId, CONTRATO.resposta, tokenDeOutra)).statusCode, 404);
    assert.equal((await estado(e.id)).json().sugestao, null);

    assert.equal((await responder(comandoId, CONTRATO.resposta)).statusCode, 200);
    const repetida = await responder(comandoId, { ...CONTRATO.resposta, descricao: 'outra coisa' });
    assert.deepEqual(repetida.json(), { ok: true, jaConcluido: true });
    assert.equal((await estado(e.id)).json().sugestao.descricao, CONTRATO.resposta.descricao);
  });

  it('pedido que passou do prazo é expirado — e dá para pedir outro', async () => {
    const e = await equipamento('Prazo');
    const primeiro = await pedir(e.id);
    await pool.query(`update comando_agente set expira_em = now() - interval '1 minute' where id = $1`, [primeiro.json().comandoId]);
    assert.equal((await estado(e.id)).json().pedido.estado, 'expirado', 'a loja não buscou');
    assert.equal(((await bater()).comandos as { id: string }[]).some((c) => c.id === primeiro.json().comandoId), false, 'comando vencido não desce');

    const segundo = await pedir(e.id);
    assert.deepEqual([segundo.statusCode, segundo.json().jaPedido], [202, false]);
    assert.notEqual(segundo.json().comandoId, primeiro.json().comandoId);

    // entregue e sem resposta: o agente caiu no meio
    await bater();
    await pool.query(`update comando_agente set expira_em = now() - interval '1 minute' where id = $1`, [segundo.json().comandoId]);
    assert.equal((await estado(e.id)).json().pedido.estado, 'expirado');
  });

  it('excluir o equipamento leva os pedidos dele', async () => {
    const e = await equipamento('Vai embora');
    const comandoId = await pedirEEntregar(e.id);
    await responder(comandoId, CONTRATO.resposta);
    assert.equal((await app.inject({ method: 'DELETE', url: `/v1/inventario/${e.id}`, headers: { cookie } })).statusCode, 200);
    assert.equal((await pool.query('select count(*)::int as n from comando_agente where id = $1', [comandoId])).rows[0].n, 0);
    assert.equal((await estado(e.id)).statusCode, 404);
  });
});
