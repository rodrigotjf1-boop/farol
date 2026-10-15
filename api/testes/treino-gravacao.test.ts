// A gravação de treino (A21, fatia T3; migration 050), de ponta a ponta na API:
//
//   - as regras do protótipo: de 15 minutos a 1 hora; do gravador, o horário já terminou e começou há no máximo 18
//     horas; programada, ainda vai começar (até 7 dias); a data vem com o fuso;
//   - quem cria, cancela e apaga é quem configura a loja; o canal tem de ser uma câmera do gravador DESTA loja; duas
//     gravações do mesmo canal não se sobrepõem;
//   - a loja pergunta o que tem de ler (`contratos/gravacao-de-treino.json`) e conta o andamento; cancelada no
//     console, ela para (409) — e o lanche de gravação cancelada não entra;
//   - apagar as imagens só da gravação conferida: os quadros saem, o exemplo fica, e a loja recebe a ordem de apagar.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { contarBase, impressaoDaBase, type Base } from '../src/fichas.js';
import { aindaEDaLoja, GRAVACAO, lerAndamento, lerNovaGravacao } from '../src/treino-gravacao.js';

const CONTRATO = JSON.parse(readFileSync(new URL('../../contratos/gravacao-de-treino.json', import.meta.url), 'utf8')) as {
  lista: { chaves: string[] };
  andamento: { corpos: Record<'lendo' | 'pronta' | 'falhou', Record<string, unknown>> };
  recusas: Array<{ quando: string; status: number; erro?: string }>;
  lanche: { encerrada: { status: number; erro: string } };
  regras: Record<string, number>;
};
const LANCHE = JSON.parse(readFileSync(new URL('../../contratos/lanche-de-treino.json', import.meta.url), 'utf8')) as {
  corpo: { gravacao: Record<string, unknown>; lanche: Record<string, unknown>; quadros: unknown[] };
};
const BASE = (JSON.parse(readFileSync(new URL('../../contratos/fichas-da-loja.json', import.meta.url), 'utf8')) as { resposta: { base: Base } }).resposta.base;
const recusa = (erro: string) => CONTRATO.recusas.find((r) => r.erro === erro)!;

const AGORA = new Date('2026-10-15T15:00:00-03:00');
const em = (min: number) => new Date(AGORA.getTime() + min * 60_000).toISOString().replace('Z', '+00:00');
const PONTO = '7d1f6c4e-2b3a-4c5d-8e9f-a0b1c2d3e4f5';
const pedido = (de: string, ini: number, fim: number, extra: Record<string, unknown> = {}) => ({ pontoId: PONTO, de, inicio: em(ini), fim: em(fim), ...extra });

describe('a gravação de treino (sem banco)', () => {
  it('do gravador: o horário já terminou, de 15 minutos a 1 hora, começou há no máximo 18 horas', () => {
    const ok = lerNovaGravacao(pedido('gravador', -90, -60), AGORA);
    assert.ok(!('problema' in ok), JSON.stringify(ok));
    assert.equal((ok as { de: string }).de, 'gravador');
    assert.ok(!('problema' in lerNovaGravacao(pedido('gravador', -75, -60), AGORA)), '15 minutos valem');
    assert.ok(!('problema' in lerNovaGravacao(pedido('gravador', -120, -60), AGORA)), '1 hora vale');
    assert.match((lerNovaGravacao(pedido('gravador', -74, -60), AGORA) as { problema: string }).problema, /15 minutos a 1 hora/);
    assert.match((lerNovaGravacao(pedido('gravador', -121, -60), AGORA) as { problema: string }).problema, /15 minutos a 1 hora/);
    assert.match((lerNovaGravacao(pedido('gravador', -20, 10), AGORA) as { problema: string }).problema, /ainda não terminou/);
    assert.ok(!('problema' in lerNovaGravacao(pedido('gravador', -18 * 60, -18 * 60 + 30), AGORA)), '18 horas atrás ainda vale');
    assert.match((lerNovaGravacao(pedido('gravador', -18 * 60 - 1, -18 * 60 + 29), AGORA) as { problema: string }).problema, /não guarda mais/);
    assert.match((lerNovaGravacao(pedido('gravador', -60, -90), AGORA) as { problema: string }).problema, /fim precisa ser depois/);
  });

  it('programada: ainda vai começar, com até 7 dias; e o pedido torto diz o que falta', () => {
    assert.ok(!('problema' in lerNovaGravacao(pedido('programada', 60, 90), AGORA)));
    assert.match((lerNovaGravacao(pedido('programada', -10, 20), AGORA) as { problema: string }).problema, /já começou/);
    assert.ok(!('problema' in lerNovaGravacao(pedido('programada', 7 * 1440, 7 * 1440 + 30), AGORA)), '7 dias valem');
    assert.match((lerNovaGravacao(pedido('programada', 7 * 1440 + 1, 7 * 1440 + 31), AGORA) as { problema: string }).problema, /7 dias/);
    assert.match((lerNovaGravacao({ ...pedido('gravador', -90, -60), pontoId: 'x' }, AGORA) as { problema: string }).problema, /bancada/);
    assert.match((lerNovaGravacao({ ...pedido('gravador', -90, -60), de: 'carga' }, AGORA) as { problema: string }).problema, /de onde vem/);
    // sem o fuso, "14:00" seria a hora do servidor
    assert.match((lerNovaGravacao({ ...pedido('gravador', -90, -60), inicio: '2026-10-15T13:30:00' }, AGORA) as { problema: string }).problema, /dia e os dois horários/);
    assert.ok(!('problema' in lerNovaGravacao({ ...pedido('gravador', -90, -60), inicio: '2026-10-15T13:30:00-03:00', fim: '2026-10-15T14:00:00-03:00' }, AGORA)));
  });

  it('o andamento: lendo com porcentagem, pronta é 100%, falhou com o motivo; o que já não é da loja', () => {
    assert.deepEqual(lerAndamento(CONTRATO.andamento.corpos.lendo), { situacao: 'lendo', progresso: 40, motivo: null });
    assert.deepEqual(lerAndamento(CONTRATO.andamento.corpos.pronta), { situacao: 'pronta', progresso: 100, motivo: null });
    assert.deepEqual(lerAndamento(CONTRATO.andamento.corpos.falhou), { situacao: 'falhou', progresso: null, motivo: 'o gravador não tinha mais esse horário' });
    assert.deepEqual(lerAndamento({ situacao: 'lendo' }), { situacao: 'lendo', progresso: null, motivo: null });
    assert.match((lerAndamento({ situacao: 'lendo', progresso: 101 }) as { problema: string }).problema, /0 a 100/);
    assert.match((lerAndamento({ situacao: 'lendo', progresso: 4.5 }) as { problema: string }).problema, /0 a 100/);
    assert.match((lerAndamento({ situacao: 'falhou' }) as { problema: string }).problema, /motivo/);
    assert.match((lerAndamento({ situacao: 'falhou', motivo: 'x'.repeat(201) }) as { problema: string }).problema, /motivo/);
    assert.match((lerAndamento({ situacao: 'cancelada' }) as { problema: string }).problema, /situacao/);
    assert.deepEqual(['programada', 'fila', 'lendo', 'pronta', 'falhou', 'cancelada', 'apagada'].map(aindaEDaLoja), [true, true, true, false, false, false, false]);
  });

  it('as regras do contrato são as da API', () => {
    assert.deepEqual(CONTRATO.regras, { ...GRAVACAO });
  });
});

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-gravacao-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-gravacao';
const SENHA = 'uma senha longa o bastante';

describe('a gravação de treino (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  let lojaId = '';
  let pontoId = '';
  let pontoIp = '';
  let pontoVizinho = '';
  let token = '';
  let tokenVizinho = '';
  let cookie = '';
  let cookieSupervisao = '';
  let cookieVizinho = '';
  const ids: Record<'fila' | 'programada', string> = { fila: '', programada: '' };
  const chaves: Record<'fila' | 'programada', string> = { fila: '', programada: '' };

  async function entrar(tenant: string, email: string, nivel: string) {
    await app.inject({ method: 'POST', url: '/v1/distribuicao/usuarios', headers: { 'x-farol-admin': ADMIN }, payload: { tenantId: tenant, nome: `Pessoa ${nivel}`, email, senha: SENHA, nivel } });
    const r = await app.inject({ method: 'POST', url: '/v1/sessao', payload: { email, senha: SENHA } });
    const b = r.headers['set-cookie'];
    return (Array.isArray(b) ? b[0]! : String(b)).split(';')[0]!;
  }
  async function novoAgente(loja: string, quem: string) {
    const a = (await app.inject({ method: 'POST', url: '/v1/distribuicao/agentes', headers: { 'x-farol-admin': ADMIN }, payload: { lojaId: loja, nome: `PC ${quem}` } })).json();
    const ativar = await app.inject({ method: 'POST', url: '/v1/agentes/ativar', headers: { authorization: `Bearer ${a.token}` }, payload: { fingerprint: `fp-${quem}-${randomUUID().slice(0, 6)}` } });
    assert.equal(ativar.statusCode, 200, ativar.body);
    return a.token as string;
  }
  const agora = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
  const criar = (corpo: unknown, comCookie = cookie, loja = lojaId) =>
    app.inject({ method: 'POST', url: `/v1/lojas/${loja}/treino/gravacoes`, headers: { cookie: comCookie }, payload: corpo as object });
  const lista = (comCookie = cookie) => app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}/treino`, headers: { cookie: comCookie } });
  const daLoja = (comToken: string | null = token) =>
    app.inject({ method: 'GET', url: '/v1/agentes/treino/gravacoes', headers: comToken ? { authorization: `Bearer ${comToken}` } : {} });
  const andamento = (id: string, corpo: unknown, comToken: string | null = token) =>
    app.inject({ method: 'POST', url: `/v1/agentes/treino/gravacoes/${id}/andamento`, headers: comToken ? { authorization: `Bearer ${comToken}` } : {}, payload: corpo as object });
  const cancelar = (id: string, comCookie = cookie) => app.inject({ method: 'POST', url: `/v1/treino/gravacoes/${id}/cancelar`, headers: { cookie: comCookie } });
  const apagar = (id: string, comCookie = cookie) => app.inject({ method: 'POST', url: `/v1/treino/gravacoes/${id}/apagar-imagens`, headers: { cookie: comCookie } });
  const situacao = async (id: string) => (await pool.query('select situacao, progresso, motivo, lida_em, apagada_em from treino_gravacao where id = $1', [id])).rows[0];

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    app = criarApp(pool, { logger: false });
    await app.ready();

    const conta = (await app.inject({ method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN }, payload: { tenant: { nome: marca }, loja: { nome: 'Matriz' }, setores: [{ nome: 'Cozinha' }] } })).json();
    lojaId = conta.loja.id;
    cookie = await entrar(conta.tenantId, `ger-${marca}@e.com`, 'gerente');
    cookieSupervisao = await entrar(conta.tenantId, `sup-${marca}@e.com`, 'supervisao');
    token = await novoAgente(lojaId, marca);
    const ponto = await app.inject({ method: 'POST', url: `/v1/setores/${conta.setores[0].id}/pontos`, headers: { cookie }, payload: { nome: 'Bancada', origem: 'dvr', canal: 4, host: '192.168.1.108' } });
    assert.equal(ponto.statusCode, 201, ponto.body);
    pontoId = ponto.json().id;
    // uma câmera IP: não tem gravador, não entra entre as bancadas que se gravam
    const ip = await app.inject({ method: 'POST', url: `/v1/setores/${conta.setores[0].id}/pontos`, headers: { cookie }, payload: { nome: 'Salão', origem: 'ip', host: '192.168.1.60' } });
    assert.equal(ip.statusCode, 201, ip.body);
    pontoIp = ip.json().id;
    const { produtos, comFicha } = contarBase(BASE);
    await pool.query(
      `insert into fichas_da_loja (loja_id, tenant_id, fonte, conteudo, impressao, produtos, com_ficha) values ($1, $2, 'planilha', $3, $4, $5, $6)`,
      [lojaId, conta.tenantId, JSON.stringify(BASE), impressaoDaBase(BASE), produtos, comFicha],
    );

    const vizinha = (await app.inject({ method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN }, payload: { tenant: { nome: `${marca}-vizinha` }, loja: { nome: 'Vizinha' }, setores: [{ nome: 'Cozinha' }] } })).json();
    cookieVizinho = await entrar(vizinha.tenantId, `ger-${marca}-viz@e.com`, 'gerente');
    tokenVizinho = await novoAgente(vizinha.loja.id, `${marca}-viz`);
    const pv = await app.inject({ method: 'POST', url: `/v1/setores/${vizinha.setores[0].id}/pontos`, headers: { cookie: cookieVizinho }, payload: { nome: 'Bancada', origem: 'dvr', canal: 4, host: '192.168.1.108' } });
    pontoVizinho = pv.json().id;
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  it('o console cria: só quem configura, só com câmera do gravador desta loja, sem sobrepor; a tela vê os canais', async () => {
    const doGravador = { pontoId, de: 'gravador', inicio: agora(-90), fim: agora(-60) };
    assert.equal((await criar(doGravador, cookieSupervisao)).statusCode, 403, 'a supervisão confere, mas não cria');
    assert.equal((await criar({ ...doGravador, pontoId: pontoVizinho })).statusCode, 422, 'o canal de outra loja');
    assert.equal((await criar({ ...doGravador, pontoId: pontoIp })).statusCode, 422, 'a câmera IP não tem gravador');
    assert.equal((await criar(doGravador, cookieVizinho)).statusCode, 404, 'outra conta nem acha a loja');
    assert.equal((await criar({ ...doGravador, fim: agora(-80) })).statusCode, 422, '10 minutos não é gravação de treino');

    const r = await criar(doGravador);
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json().situacao, 'fila');
    assert.match(r.json().chave, /^console-/);
    ids.fila = r.json().id;
    chaves.fila = r.json().chave;
    const junto = await criar({ ...doGravador, inicio: agora(-70), fim: agora(-50) });
    assert.equal(junto.statusCode, 409, 'o mesmo canal, no mesmo horário');
    assert.equal(junto.json().erro, 'sobreposta');

    const p = await criar({ pontoId, de: 'programada', inicio: agora(60), fim: agora(90) });
    assert.equal(p.statusCode, 201, p.body);
    assert.equal(p.json().situacao, 'programada');
    ids.programada = p.json().id;
    chaves.programada = p.json().chave;

    const l = (await lista()).json();
    assert.deepEqual(l.canais, [{ id: pontoId, nome: 'Bancada', numero: 4 }]);
    assert.equal(l.lojaSabeGravar, false, 'o agente ainda não declarou `treino`');
    assert.deepEqual(l.regras, { ...GRAVACAO });
    assert.deepEqual(
      l.gravacoes.map((g: { id: string; situacao: string; origem: string; motivo: unknown }) => [g.id, g.situacao, g.origem, g.motivo]),
      [[ids.programada, 'programada', 'programada', null], [ids.fila, 'fila', 'gravador', null]],
    );
    // o agente que não está ativo não conta, mesmo declarando
    await pool.query(`update agente set sabe = '{estados,treino}', estado = 'inativo' where loja_id = $1`, [lojaId]);
    assert.equal((await lista()).json().lojaSabeGravar, false, 'agente inativo');
    await pool.query(`update agente set estado = 'ativo' where loja_id = $1`, [lojaId]);
    assert.equal((await lista()).json().lojaSabeGravar, true);
  });

  it('a loja pergunta o que ler (as chaves do contrato) e conta o andamento; o de outra loja não vê', async () => {
    const r = await daLoja();
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json().gravacoes.map((g: { id: string }) => g.id), [ids.fila, ids.programada], 'na ordem do horário');
    assert.deepEqual(Object.keys(r.json().gravacoes[0]).sort(), [...CONTRATO.lista.chaves].sort());
    assert.equal(r.json().gravacoes[0].canal, 4);
    assert.equal(r.json().gravacoes[0].pontoId, pontoId);
    assert.deepEqual(r.json().apagar, []);
    assert.deepEqual((await daLoja(tokenVizinho)).json().gravacoes, []);
    assert.equal((await daLoja(null)).statusCode, 401);

    const lendo = await andamento(ids.fila, CONTRATO.andamento.corpos.lendo);
    assert.equal(lendo.statusCode, 200, lendo.body);
    assert.deepEqual(lendo.json(), { situacao: 'lendo' });
    assert.deepEqual([(await situacao(ids.fila)).situacao, (await situacao(ids.fila)).progresso], ['lendo', 40]);
    const semMotivo = await andamento(ids.fila, { situacao: 'falhou' });
    assert.equal(semMotivo.statusCode, recusa('validacao').status);
    assert.equal((await andamento(ids.fila, { situacao: 'lendo' }, tokenVizinho)).statusCode, recusa('nao_encontrado').status, 'a gravação de outra loja');
    assert.equal((await andamento(ids.fila, CONTRATO.andamento.corpos.lendo, null)).statusCode, 401);
    // a porcentagem não volta a nulo quando a loja não manda
    await andamento(ids.fila, { situacao: 'lendo' });
    assert.equal((await situacao(ids.fila)).progresso, 40);

    const pronta = await andamento(ids.fila, CONTRATO.andamento.corpos.pronta);
    assert.equal(pronta.statusCode, 200, pronta.body);
    const s = await situacao(ids.fila);
    assert.deepEqual([s.situacao, s.progresso], ['pronta', 100]);
    assert.ok(s.lida_em, 'pronta anota quando foi lida');
    const depois = await andamento(ids.fila, { situacao: 'lendo' });
    assert.equal(depois.statusCode, 409, 'a pronta não volta a ser lida');
    assert.equal(depois.json().erro, 'encerrada');
  });

  it('falhou: o motivo aparece na tela', async () => {
    const f = await criar({ pontoId, de: 'gravador', inicio: agora(-300), fim: agora(-270) });
    assert.equal(f.statusCode, 201, f.body);
    assert.equal((await andamento(f.json().id, CONTRATO.andamento.corpos.falhou)).statusCode, 200);
    const g = (await lista()).json().gravacoes.find((x: { id: string }) => x.id === f.json().id);
    assert.deepEqual([g.situacao, g.motivo], ['falhou', 'o gravador não tinha mais esse horário']);
    assert.ok((await daLoja()).json().apagar.includes(f.json().chave), 'a loja apaga o que guardou da que falhou');
    // a que falhou não segura o horário: dá para pedir de novo
    assert.equal((await criar({ pontoId, de: 'gravador', inicio: agora(-300), fim: agora(-270) })).statusCode, 201);
  });

  it('cancelar: só o que não começou; a loja para; o lanche da cancelada não entra', async () => {
    assert.equal((await cancelar(ids.programada, cookieSupervisao)).statusCode, 403);
    assert.equal((await cancelar(ids.programada, cookieVizinho)).statusCode, 404);
    const c = await cancelar(ids.programada);
    assert.equal(c.statusCode, 200, c.body);
    assert.deepEqual(c.json(), { cancelada: true });
    assert.deepEqual((await cancelar(ids.programada)).json(), { cancelada: true }, 'cancelar de novo não é erro');
    assert.equal((await situacao(ids.programada)).situacao, 'cancelada');
    const lida = await cancelar(ids.fila);
    assert.equal(lida.statusCode, 409, 'a que já foi lida não se cancela');
    assert.equal(lida.json().erro, 'nao_cancela');

    const parou = await andamento(ids.programada, { situacao: 'lendo' });
    assert.equal(parou.statusCode, recusa('encerrada').status);
    assert.equal(parou.json().erro, 'encerrada');
    assert.ok((await daLoja()).json().apagar.includes(chaves.programada));
    assert.ok(!(await daLoja()).json().gravacoes.some((g: { id: string }) => g.id === ids.programada), 'a cancelada sai do que ler');

    const corpo = JSON.parse(JSON.stringify(LANCHE.corpo));
    corpo.gravacao = { chave: chaves.programada, pontoId, inicio: agora(60), fim: agora(90), origem: 'programada' };
    const lanche = await app.inject({ method: 'POST', url: '/v1/agentes/treino/lanches', headers: { authorization: `Bearer ${token}` }, payload: corpo });
    assert.equal(lanche.statusCode, CONTRATO.lanche.encerrada.status, lanche.body);
    assert.equal(lanche.json().erro, CONTRATO.lanche.encerrada.erro);
    const n = await pool.query('select count(*)::int as n from treino_lanche where gravacao_id = $1', [ids.programada]);
    assert.equal(n.rows[0].n, 0, 'nenhum lanche entrou');
    const g = await pool.query('select inicio, fim from treino_gravacao where id = $1', [ids.programada]);
    assert.ok(new Date(g.rows[0].inicio).getTime() > Date.now(), 'nem o horário mudou');
  });

  it('apagar as imagens: só da gravação conferida; os quadros saem, o exemplo fica, a loja apaga', async () => {
    // a gravação pronta recebe um lanche (pela rota de sempre, com a chave dela) e espera conferência
    const corpo = JSON.parse(JSON.stringify(LANCHE.corpo));
    const g0 = await pool.query('select inicio, fim from treino_gravacao where id = $1', [ids.fila]);
    corpo.gravacao = { chave: chaves.fila, pontoId, inicio: new Date(g0.rows[0].inicio).toISOString(), fim: new Date(g0.rows[0].fim).toISOString(), origem: 'gravador' };
    const lanche = await app.inject({ method: 'POST', url: '/v1/agentes/treino/lanches', headers: { authorization: `Bearer ${token}` }, payload: corpo });
    assert.equal(lanche.statusCode, 201, lanche.body);
    assert.equal((await situacao(ids.fila)).situacao, 'pronta', 'o lanche não muda a situação da gravação');

    const cedo = await apagar(ids.fila);
    assert.equal(cedo.statusCode, 409);
    assert.match(cedo.json().mensagem, /ainda há 1 lanche para conferir/);
    assert.equal((await apagar(ids.fila, cookieSupervisao)).statusCode, 403);

    const conferido = await app.inject({
      method: 'POST',
      url: `/v1/treino/lanches/${lanche.json().lancheId}/conferencia`,
      headers: { cookie },
      payload: { produto: 'X-Burger', etapas: [{ v: 'certo' }, { v: 'certo' }, { v: 'certo' }, { v: 'certo' }, { v: 'outro', nome: 'Bacon fatiado' }, null], faltas: {}, aMais: {} },
    });
    assert.equal(conferido.statusCode, 200, conferido.body);
    const exemplos = conferido.json().exemplos as number;
    assert.ok(exemplos > 0);

    const r = await apagar(ids.fila);
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json(), { apagada: true, quadros: 5 });
    const q = await pool.query('select count(*)::int as n from treino_quadro where lanche_id = $1', [lanche.json().lancheId]);
    assert.equal(q.rows[0].n, 0, 'os quadros saíram da nuvem');
    const ex = await pool.query(`select count(*)::int as n from base_frame where lanche_id = $1 and origem = 'bancada'`, [lanche.json().lancheId]);
    assert.equal(ex.rows[0].n, exemplos, 'o exemplo fica');
    const s = await situacao(ids.fila);
    assert.equal(s.situacao, 'apagada');
    assert.ok(s.apagada_em);
    assert.ok((await daLoja()).json().apagar.includes(chaves.fila), 'a loja apaga a gravação dela');
    assert.deepEqual((await apagar(ids.fila)).json(), { apagada: true, quadros: 0 }, 'de novo não é erro');

    // a que ainda não foi lida não tem imagens para apagar
    const nova = await criar({ pontoId, de: 'gravador', inicio: agora(-200), fim: agora(-180) });
    const naFila = await apagar(nova.json().id);
    assert.equal(naFila.statusCode, 409);
    assert.match(naFila.json().mensagem, /ainda não foi lida/);
  });

  it('a pronta com tudo conferido há mais de 30 dias: a loja apaga a dela; com menos, ou com lanche por conferir, não', async () => {
    const chave = `carga-${marca}`;
    const mandar = async (lanche: string) => {
      const corpo = JSON.parse(JSON.stringify(LANCHE.corpo));
      corpo.gravacao = { ...corpo.gravacao, chave };
      corpo.lanche = { ...corpo.lanche, chave: lanche };
      const r = await app.inject({ method: 'POST', url: '/v1/agentes/treino/lanches', headers: { authorization: `Bearer ${token}` }, payload: corpo });
      assert.equal(r.statusCode, 201, r.body);
      return r.json().lancheId as string;
    };
    const primeiro = await mandar('lanche-a');
    const apaga = async () => ((await daLoja()).json().apagar as string[]).includes(chave);
    await pool.query(`update treino_lanche set situacao = 'conferido', conferido_em = now() - interval '29 days' where id = $1`, [primeiro]);
    assert.equal(await apaga(), false, 'conferida há 29 dias: ainda não');
    await pool.query(`update treino_lanche set conferido_em = now() - interval '31 days' where id = $1`, [primeiro]);
    assert.equal(await apaga(), true, 'há 31 dias: a loja apaga');
    await mandar('lanche-b');
    assert.equal(await apaga(), false, 'um lanche ainda por conferir segura a gravação');
  });
});
