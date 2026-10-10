// A família do critério, o jeito de nascer e os números do funil na tela do canal.
//
// A19, onda 1, fatia 1.5 — a gaveta nova do critério (migration 035). O que
// tem de ficar provado:
//
//   - a família cabe no tipo, na API e no banco; quem não diz a sua tem a
//     natural do tipo, e os critérios de antes não mudam;
//   - família que ainda não tem juiz SÓ OBSERVA: não nasce nem passa a "em
//     ensaio" pela mão de ninguém — e o critério de ação de antes das
//     famílias, que já julgava, continua como está;
//   - o critério que nasce "observando" nasce LIGADO (só conta), e desce
//     para o agente que sabe o que é estado; nos outros estados nasce
//     desligado, como sempre;
//   - a tela do canal recebe a família, se o estudo está confirmado e os
//     números do funil de cada critério EM CADA LUGAR — com a mesma
//     permissão do funil, e contando os dias no relógio DA LOJA;
//   - a migration 035 não muda critério nenhum, e a regra fica no banco.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { DIAS_DO_FUNIL } from '../src/estudo.js';
import { FAMILIAS, familiaNaoCabe, familiaNatural, FAMILIAS_QUE_JULGAM, familiaSoObserva, sqlFamilia } from '../src/familia.js';

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-familia-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-familia';
const SENHA = 'uma senha longa o bastante';
const TIPOS = ['estado', 'acao', 'presenca', 'contagem', 'comparacao'];
const MIGRATION = readFileSync(new URL('../../database/migrations/035_a_familia_do_criterio.sql', import.meta.url), 'utf8');
/** A regra, dita de novo aqui: estado vai com os quatro jeitos de hoje; as outras três, com o texto livre. */
const cabeNoTipo = (familia: string, tipo: string): boolean =>
  familia === 'estado' ? tipo !== 'acao' : ['acontecimento', 'processo', 'medida'].includes(familia) && tipo === 'acao';

// ───────────────────────── sem banco ─────────────────────────

describe('a família do critério — o que cabe', () => {
  it('são quatro, e só a de estado tem juiz hoje', () => {
    assert.deepEqual([...FAMILIAS], ['estado', 'acontecimento', 'processo', 'medida']);
    assert.deepEqual([...FAMILIAS_QUE_JULGAM], ['estado']);
  });

  it('quem não diz a família tem a natural do tipo', () => {
    assert.deepEqual(TIPOS.map(familiaNatural), ['estado', 'acontecimento', 'estado', 'estado', 'estado']);
    assert.equal(sqlFamilia(), `coalesce(r.familia, case when r.tipo = 'acao' then 'acontecimento' else 'estado' end)`);
    assert.equal(sqlFamilia(''), `coalesce(familia, case when tipo = 'acao' then 'acontecimento' else 'estado' end)`);
    assert.equal(sqlFamilia('x'), `coalesce(x.familia, case when x.tipo = 'acao' then 'acontecimento' else 'estado' end)`);
  });

  it('estado é conferido pelos quatro jeitos de hoje; as outras três vão com o tipo de texto livre', () => {
    for (const tipo of TIPOS) {
      // Sem família pedida, nada a recusar.
      assert.equal(familiaNaoCabe(undefined, tipo), null);
      assert.equal(familiaNaoCabe(null, tipo), null);
      // A natural do tipo sempre cabe.
      assert.equal(familiaNaoCabe(familiaNatural(tipo), tipo), null, tipo);
      for (const familia of FAMILIAS) {
        const cabe = cabeNoTipo(familia, tipo);
        const recusa = familiaNaoCabe(familia, tipo);
        assert.equal(recusa === null, cabe, `${familia} × ${tipo}`);
        if (!cabe) assert.match(String(recusa), /^familia: /);
      }
    }
    for (const torta of ['Estado', 'estados', '', 1, true, {}, ['estado']]) {
      assert.match(String(familiaNaoCabe(torta, 'estado')), /^familia: um de estado, acontecimento, processo, medida$/, JSON.stringify(torta));
    }
  });

  it('família sem juiz só observa, e a recusa diz quando o julgamento chega', () => {
    assert.equal(familiaSoObserva('estado'), null);
    assert.deepEqual(familiaSoObserva('acontecimento'), {
      erro: 'familia_so_observa',
      mensagem: 'o julgamento de um critério de acontecimento chega com a sequência. Até lá ele só observa: conta o contexto e o gatilho, sem julgar.',
    });
    for (const familia of ['processo', 'medida']) {
      const r = familiaSoObserva(familia)!;
      assert.equal(r.erro, 'familia_so_observa');
      assert.match(r.mensagem, new RegExp(`^o julgamento de um critério de ${familia} chega depois da sequência\\. `));
    }
  });
});

// ───────────────────────── com o banco ─────────────────────────

type Criterio = {
  id: string; nome: string; tipo: string; ativa: boolean; estado: string; familia: string; tem_estudo: boolean;
  funil: { olhadas: number; comGatilho: number; julgadas: number; foraDoCriterio: number } | null;
};
type Zona = { id: string; nome: string; principal: boolean; criterios: Criterio[] };

describe('a família, o nascimento e o funil do canal (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  let lojaId = '';
  let pontoId = '';
  let inteira = '';
  let chapa = '';
  let posto = '';
  let outroPonto = '';
  let caixa = '';
  let cookie = '';
  let cookieSupervisao = '';
  let cookieExecucao = '';
  let cookieSuporte = '';
  let token = '';
  let fuso = '';

  async function entrar(tenant: string, email: string, nivel: string) {
    await app.inject({
      method: 'POST', url: '/v1/distribuicao/usuarios', headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId: tenant, nome: 'X', email, senha: SENHA, nivel },
    });
    const r = await app.inject({ method: 'POST', url: '/v1/sessao', payload: { email, senha: SENHA } });
    const b = r.headers['set-cookie'];
    return (Array.isArray(b) ? b[0]! : String(b)).split(';')[0]!;
  }

  const criar = (corpo: Record<string, unknown>, zonas: string[] = [chapa]) =>
    app.inject({
      method: 'POST', url: `/v1/lojas/${lojaId}/regras`, headers: { cookie },
      payload: { nome: `Critério ${randomUUID().slice(0, 6)} ${marca}`, tipo: 'estado', criterio: 'A chapa está limpa.', zonaIds: zonas, quando: 'sempre', ...corpo },
    });
  const criarNoQuadro = (zonaId: string, corpo: Record<string, unknown>) =>
    app.inject({
      method: 'POST', url: `/v1/zonas/${zonaId}/regras`, headers: { cookie },
      payload: { nome: `Critério ${randomUUID().slice(0, 6)} ${marca}`, tipo: 'estado', criterio: 'A chapa está limpa.', quando: 'sempre', ...corpo },
    });
  const mudar = (id: string, corpo: Record<string, unknown>) =>
    app.inject({ method: 'PATCH', url: `/v1/regras/${id}`, headers: { cookie }, payload: corpo });
  const noBanco = async (id: string) =>
    (await pool.query(`select tipo, estado, ativa, familia from regra where id = $1`, [id])).rows[0] as { tipo: string; estado: string; ativa: boolean; familia: string | null };
  const naLista = async (id: string) =>
    ((await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}/regras`, headers: { cookie } })).json().regras as { id: string; familia: string; ativa: boolean; estado: string }[])
      .find((r) => r.id === id);
  const canal = async (qual = pontoId, comCookie = cookie) =>
    (await app.inject({ method: 'GET', url: `/v1/pontos/${qual}`, headers: { cookie: comCookie } })).json() as { ponto: Record<string, unknown>; zonas: Zona[] };
  const noCanal = async (id: string, zonaId: string, comCookie = cookie, qual = pontoId) =>
    (await canal(qual, comCookie)).zonas.find((z) => z.id === zonaId)?.criterios.find((k) => k.id === id);

  const doAgente = (metodo: 'GET' | 'POST', url: string, payload?: unknown) =>
    app.inject({ method: metodo, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });
  /** O critério como o agente recebe, debaixo de um quadro — ou `undefined`, se não desce. */
  async function noAgente(id: string, sabe: string | undefined, zona = chapa): Promise<Record<string, unknown> | undefined> {
    const r = await doAgente('GET', `/v1/agentes/configuracao${sabe === undefined ? '' : `?sabe=${sabe}`}`);
    assert.equal(r.statusCode, 200, r.body);
    for (const p of r.json().pontos) {
      const z = p.zonas.find((x: { id: string }) => x.id === zona);
      if (z) return z.regras.find((x: { id: string }) => x.id === id);
    }
    return undefined;
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
    cookie = await entrar(conta.tenantId, `ger-${marca}@e.com`, 'gerente');
    cookieSupervisao = await entrar(conta.tenantId, `sup-${marca}@e.com`, 'supervisao');
    cookieExecucao = await entrar(conta.tenantId, `exe-${marca}@e.com`, 'execucao');
    cookieSuporte = await entrar(conta.tenantId, `tec-${marca}@e.com`, 'suporte');

    // O funil conta os dias no relógio DA LOJA. Para isso ficar provado a qualquer hora em que o teste rode, a
    // loja vai para um fuso em que a data de AGORA é outra que a da sessão do banco: das duas pontas do mapa
    // (25 horas uma da outra), uma sempre serve.
    const pontas = await pool.query(
      `select f as fuso from unnest($1::text[]) f where (now() at time zone f)::date <> current_date limit 1`,
      [['Pacific/Kiritimati', 'Pacific/Pago_Pago']],
    );
    assert.equal(pontas.rowCount, 1, 'uma das duas pontas do mapa está sempre em outra data');
    fuso = pontas.rows[0].fuso;
    await pool.query(`update loja set timezone = $2 where id = $1`, [lojaId, fuso]);

    const novoPonto = async (nome: string, numero: number) =>
      (await app.inject({
        method: 'POST', url: `/v1/setores/${conta.setores[0].id}/pontos`, headers: { cookie },
        payload: { nome, origem: 'dvr', canal: numero, host: '192.168.1.108' },
      })).json();
    const novaArea = async (ponto: string, nome: string, poligono: number[][], papel: string) => {
      const r = await app.inject({ method: 'POST', url: `/v1/pontos/${ponto}/zonas`, headers: { cookie }, payload: { nome, poligono, papel } });
      assert.equal(r.statusCode, 201, r.body);
      return r.json().id as string;
    };
    const daChapa = await novoPonto('Chapa', 6);
    pontoId = daChapa.id;
    inteira = daChapa.zonas[0].id;
    chapa = await novaArea(pontoId, 'Chapa', [[0.05, 0.1], [0.6, 0.1], [0.6, 0.65], [0.05, 0.65]], 'equipamento');
    posto = await novaArea(pontoId, 'Posto do chapeiro', [[0.05, 0.7], [0.6, 0.7], [0.6, 0.95], [0.05, 0.95]], 'posto');
    const doCaixa = await novoPonto('Caixa', 2);
    outroPonto = doCaixa.id;
    caixa = await novaArea(outroPonto, 'Gaveta', [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]], 'caixa');

    const agente = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/agentes', headers: { 'x-farol-admin': ADMIN },
      payload: { lojaId, nome: 'PC da loja' },
    })).json();
    token = agente.token;
    await doAgente('POST', '/v1/agentes/ativar', { fingerprint: `fp-${marca}` });
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  // ─────────────────────── o jeito de nascer ───────────────────────

  it('quem nasce observando nasce LIGADO — e só conta; nos outros estados nasce desligado, como sempre', async () => {
    const observando = await criar({ estado: 'observando' });
    assert.equal(observando.statusCode, 201, observando.body);
    assert.deepEqual(
      [observando.json().estado, observando.json().ativa, observando.json().familia, observando.json().aviso],
      ['observando', true, 'estado', 'o critério nasce observando e ligado: conta as olhadas, o contexto e o gatilho, sem julgar e sem avisar'],
    );
    const idObs = observando.json().id as string;
    assert.deepEqual(await noBanco(idObs), { tipo: 'estado', estado: 'observando', ativa: true, familia: 'estado' });

    // Desce para o agente que sabe o que é estado; para o de antes, esse critério não existe.
    assert.equal((await noAgente(idObs, 'estados'))!.estado, 'observando');
    assert.equal(await noAgente(idObs, undefined), undefined);

    // O cadastro de antes (não fala em estado) e o que nasce em ensaio: desligados.
    for (const [corpo, estado] of [[{}, 'valendo'], [{ estado: 'ensaio' }, 'ensaio']] as const) {
      const r = await criar(corpo);
      assert.equal(r.statusCode, 201, r.body);
      assert.deepEqual([r.json().estado, r.json().ativa, r.json().aviso], [estado, false, 'a regra nasce desligada; ligue só depois de conferir a acurácia'], estado);
      assert.equal((await noBanco(r.json().id)).ativa, false);
      assert.equal(await noAgente(r.json().id, 'estados'), undefined, 'desligado não desce');
    }

    // Pelo atalho de um quadro só, a mesma regra.
    const peloQuadro = await criarNoQuadro(posto, { estado: 'observando' });
    assert.deepEqual([peloQuadro.statusCode, peloQuadro.json().ativa, peloQuadro.json().estado], [201, true, 'observando']);
    assert.equal((await criarNoQuadro(posto, {})).json().ativa, false);

    // `ativa` no corpo de quem cria não manda: quem decide é o estado.
    const tentou = await criar({ ativa: true });
    assert.deepEqual([tentou.json().ativa, tentou.json().estado], [false, 'valendo']);
    const tentouDesligar = await criar({ estado: 'observando', ativa: false });
    assert.equal(tentouDesligar.json().ativa, true);

    // Presença nasce observando com os campos do detector, como sempre exigiu.
    const presenca = await criar({ tipo: 'presenca', estado: 'observando', criterio: 'Há alguém.', parametros: { objeto: 'pessoa', minimo: 1, maximo: null } });
    assert.deepEqual([presenca.statusCode, presenca.json().ativa, presenca.json().familia], [201, true, 'estado']);
    assert.equal((await criar({ tipo: 'presenca', estado: 'observando', criterio: 'Há alguém.' })).statusCode, 422, 'sem dizer o que procurar, não nasce');
  });

  // ─────────────────────── a família ───────────────────────

  it('a família cabe no tipo: na criação, na edição e no banco', async () => {
    // As três que ainda não têm juiz vão com o tipo de texto livre, e nascem observando.
    for (const familia of ['acontecimento', 'processo', 'medida']) {
      const r = await criar({ tipo: 'acao', familia, estado: 'observando', criterio: 'Cada lanche leva todos os itens da ficha.' });
      assert.equal(r.statusCode, 201, r.body);
      assert.deepEqual([r.json().familia, r.json().tipo, r.json().estado, r.json().ativa], [familia, 'acao', 'observando', true]);
      assert.equal((await noBanco(r.json().id)).familia, familia);
      assert.equal((await naLista(r.json().id))!.familia, familia);
      assert.equal((await noCanal(r.json().id, chapa))!.familia, familia);
      // O agente recebe o tipo que já conhece, e nada de família.
      const desceu = (await noAgente(r.json().id, 'estados'))!;
      assert.equal(desceu.tipo, 'acao');
      assert.equal('familia' in desceu, false);
    }
    // Estado, pelos quatro jeitos de hoje.
    for (const tipo of ['estado', 'comparacao']) {
      const r = await criar({ tipo, familia: 'estado', estado: 'observando' });
      assert.deepEqual([r.statusCode, r.json().familia], [201, 'estado'], tipo);
    }

    // O que não cabe é recusado, e nada nasce.
    const antes = (await pool.query(`select count(*)::int as n from regra where loja_id = $1`, [lojaId])).rows[0].n;
    for (const [tipo, familia] of [['estado', 'processo'], ['presenca', 'medida'], ['comparacao', 'acontecimento'], ['acao', 'estado'], ['estado', 'Estado'], ['estado', 7]] as const) {
      const r = await criar({ tipo, familia, estado: 'observando', parametros: { objeto: 'pessoa', minimo: 1, maximo: null } });
      assert.equal(r.statusCode, 422, `${tipo} × ${familia}: ${r.body}`);
      assert.match(r.json().mensagem, /^familia: /);
    }
    assert.equal((await pool.query(`select count(*)::int as n from regra where loja_id = $1`, [lojaId])).rows[0].n, antes);

    // No banco a regra é a mesma (23514 = violação de `check`), e vazio continua valendo.
    const id = (await criar({ estado: 'observando' })).json().id as string;
    await assert.rejects(pool.query(`update regra set familia = 'processo' where id = $1`, [id]), { code: '23514' });
    await assert.rejects(pool.query(`update regra set familia = 'nada' where id = $1`, [id]), { code: '23514' });
    await assert.rejects(pool.query(`update regra set tipo = 'acao' where id = $1`, [id]), { code: '23514' }, 'o tipo não muda por baixo da família');
    await pool.query(`update regra set familia = null where id = $1`, [id]);
    assert.equal((await naLista(id))!.familia, 'estado', 'vazio = a natural do tipo');
    await pool.query(`update regra set familia = null, tipo = 'acao' where id = $1`, [id]);
    assert.equal((await naLista(id))!.familia, 'acontecimento');
    assert.equal((await noCanal(id, chapa))!.familia, 'acontecimento');
  });

  it('família sem juiz só observa: não nasce nem passa a "em ensaio" pela mão de ninguém', async () => {
    // Quem DIZ a família só cria o que não tem juiz em "observando".
    for (const estado of [undefined, 'ensaio']) {
      const r = await criar({ tipo: 'acao', familia: 'processo', ...(estado ? { estado } : {}) });
      assert.equal(r.statusCode, 422, `${estado}: ${r.body}`);
      assert.equal(r.json().erro, 'familia_so_observa');
      assert.match(r.json().mensagem, /chega depois da sequência\. Até lá ele só observa/);
    }
    // E o critério de ação não nasce em ensaio nem sem dizer a família.
    const acaoEmEnsaio = await criar({ tipo: 'acao', estado: 'ensaio' });
    assert.deepEqual([acaoEmEnsaio.statusCode, acaoEmEnsaio.json().erro], [422, 'familia_so_observa']);
    assert.match(acaoEmEnsaio.json().mensagem, /de acontecimento chega com a sequência/);

    const processo = (await criar({ tipo: 'acao', familia: 'processo', estado: 'observando' })).json().id as string;
    const recusado = await mudar(processo, { estado: 'ensaio' });
    assert.deepEqual([recusado.statusCode, recusado.json().erro], [422, 'familia_so_observa'], recusado.body);
    assert.equal((await noBanco(processo)).estado, 'observando', 'pedido recusado não mudou nada');
    // Pedir o estado em que já está passa, e mudar o resto também.
    assert.equal((await mudar(processo, { estado: 'observando', nome: `Outro nome ${marca}` })).statusCode, 200);
    // De processo para medida, observando: são as duas sem juiz.
    const paraMedida = await mudar(processo, { familia: 'medida' });
    assert.deepEqual([paraMedida.statusCode, paraMedida.json().familia], [200, 'medida'], paraMedida.body);
    // A gaveta manda o tipo em todo salvar, e a família só quando ela muda: o tipo de volta, igual, não troca
    // a família guardada pela natural dele.
    const comOTipo = await mudar(processo, { tipo: 'acao', nome: `Mais um nome ${marca}` });
    assert.deepEqual([comOTipo.statusCode, comOTipo.json().familia], [200, 'medida'], comOTipo.body);
    assert.equal((await noBanco(processo)).familia, 'medida');

    // Um critério de estado passa a ensaio e volta, quantas vezes quiser.
    const estado = (await criar({ estado: 'observando' })).json().id as string;
    assert.deepEqual([(await mudar(estado, { estado: 'ensaio' })).json().estado, (await mudar(estado, { estado: 'observando' })).json().estado], ['ensaio', 'observando']);

    // Levar a uma família sem juiz um critério que está sendo julgado: só descendo a "observando" no mesmo pedido.
    await mudar(estado, { estado: 'ensaio' });
    for (const corpo of [{ tipo: 'acao' }, { tipo: 'acao', familia: 'processo' }, { tipo: 'acao', familia: 'acontecimento', estado: 'ensaio' }]) {
      const r = await mudar(estado, corpo);
      assert.deepEqual([r.statusCode, r.json().erro], [422, 'familia_so_observa'], JSON.stringify(corpo));
    }
    assert.deepEqual(await noBanco(estado), { tipo: 'estado', estado: 'ensaio', ativa: true, familia: 'estado' });
    const desceu = await mudar(estado, { tipo: 'acao', familia: 'processo', estado: 'observando' });
    assert.deepEqual([desceu.statusCode, desceu.json().tipo, desceu.json().familia, desceu.json().estado], [200, 'acao', 'processo', 'observando'], desceu.body);

    // E de volta a estado: trocar o tipo sem dizer a família leva à natural do tipo novo.
    const voltou = await mudar(estado, { tipo: 'estado' });
    assert.deepEqual([voltou.statusCode, voltou.json().tipo, voltou.json().familia], [200, 'estado', 'estado'], voltou.body);
    assert.equal((await noBanco(estado)).familia, 'estado');
    // Família que não cabe no tipo final é recusada na edição também.
    const naoCabe = await mudar(estado, { familia: 'processo' });
    assert.equal(naoCabe.statusCode, 422, naoCabe.body);
    assert.match(naoCabe.json().mensagem, /^familia: /);
    assert.equal((await mudar(estado, { familia: 'nada' })).statusCode, 422);
  });

  it('o critério de ação de antes das famílias, que já julgava, continua como está', async () => {
    // O cadastro de antes: ação, sem dizer estado nem família. Nasce valendo e desligado, como sempre.
    const r = await criar({ tipo: 'acao', criterio: 'O chapeiro salga as carnes.' });
    assert.equal(r.statusCode, 201, r.body);
    const id = r.json().id as string;
    assert.deepEqual([r.json().estado, r.json().ativa, r.json().familia], ['valendo', false, 'acontecimento']);
    assert.equal((await mudar(id, { ativa: true })).statusCode, 200, 'liga como sempre ligou');

    // Editar sem mexer em estado nem em família não é recusado — nem mandando de volta o que ele já é.
    for (const corpo of [{ nome: `Salga ${marca}` }, { estado: 'valendo' }, { familia: 'acontecimento', tipo: 'acao' }, { cooldownMin: 20, estado: 'valendo', familia: 'acontecimento' }]) {
      const m = await mudar(id, corpo);
      assert.equal(m.statusCode, 200, `${JSON.stringify(corpo)} → ${m.body}`);
      assert.deepEqual([m.json().estado, m.json().familia, m.json().ativa], ['valendo', 'acontecimento', true]);
    }
    assert.equal((await noAgente(id, undefined))!.tipo, 'acao', 'e continua descendo, até para o agente de antes');

    // O que estava em ensaio por outro caminho fica em ensaio ao salvar sem mexer.
    await pool.query(`update regra set estado = 'ensaio' where id = $1`, [id]);
    assert.equal((await mudar(id, { estado: 'ensaio', nome: `Salga 2 ${marca}` })).statusCode, 200);
    // Trocar de família julgando, não; descer a observando, sim — e daí não volta a ensaio.
    assert.equal((await mudar(id, { familia: 'processo' })).statusCode, 422);
    assert.equal((await mudar(id, { estado: 'observando' })).statusCode, 200);
    assert.deepEqual([(await mudar(id, { estado: 'ensaio' })).statusCode, (await noBanco(id)).estado], [422, 'observando']);
  });

  // ─────────────────────── o que a tela do canal recebe ───────────────────────

  it('a tela do canal recebe, de cada critério em cada lugar, se o estudo está confirmado e os números do funil', async () => {
    const zeros = {
      capturas: 0, semJuiz: 0, semQuadro: 0, semCena: 0, semCondicao: 0, semGatilho: 0, observadas: 0, emSilencio: 0, repetidas: 0,
      jaJulgadas: 0, enfileiradas: 0, conformes: 0, naoConformes: 0, naoAvaliaveis: 0, falhas: 0, alertas: 0,
      somaConfianca: 0, comConfianca: 0, somaLatenciaMs: 0, comLatencia: 0, custoCentavos: 0,
      julgadasLoja: 0, julgadasNuvem: 0, somaMedida: 0, comMedida: 0, maxMedida: null, extras: 0, extrasFora: 0,
      ultimoResultado: null, ultimoMotivo: null, ultimoImpedimento: null, ultimaEm: null,
    };
    /** Uma hora cheia, no relógio da loja: `dia` conta de hoje para trás. */
    const hora = async (dia: number, h: number) =>
      (await pool.query(
        `select to_char(((d + make_interval(hours => $3)) at time zone l.timezone) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"') as hora
           from loja l, lateral (select (now() at time zone l.timezone)::date - $2::integer as d) x
          where l.id = $1`,
        [lojaId, dia, h],
      )).rows[0].hora as string;

    // Um critério nos DOIS quadros do canal e na imagem completa; outro só na chapa; outro no outro canal.
    const emTres = (await criar({ estado: 'observando' }, [inteira, chapa, posto])).json().id as string;
    const soNaChapa = (await criar({ estado: 'ensaio' })).json().id as string;
    await mudar(soNaChapa, { ativa: true });
    const doCaixa = (await criar({ estado: 'observando' }, [caixa])).json().id as string;

    // Sem nada contado ainda: zeros (para quem pode ver), e o estudo não confirmado.
    const vazio = (await noCanal(emTres, chapa))!;
    assert.deepEqual(vazio.funil, { olhadas: 0, comGatilho: 0, julgadas: 0, foraDoCriterio: 0 });
    assert.equal(vazio.tem_estudo, false);
    assert.equal((await canal()).ponto.funil_dias, DIAS_DO_FUNIL);
    assert.equal(DIAS_DO_FUNIL, 7);

    // O estudo proposto não conta; o confirmado, sim.
    const estudo = { contexto: [{ sinal: 'pessoa', onde: 'aqui' }], gatilho: [{ sinal: 'a_cada', minutos: 10 }] };
    const gravar = (confirmado: boolean) =>
      app.inject({ method: 'PUT', url: `/v1/regras/${emTres}/estudo`, headers: { cookie }, payload: { ...estudo, confirmado } });
    assert.equal((await gravar(false)).statusCode, 200);
    assert.equal((await noCanal(emTres, chapa))!.tem_estudo, false);
    assert.equal((await gravar(true)).statusCode, 200);
    assert.equal((await noCanal(emTres, chapa))!.tem_estudo, true);
    assert.equal((await noCanal(soNaChapa, chapa))!.tem_estudo, false, 'o estudo é de cada critério');

    const linha = (regraId: string, zonaId: string, quando: string, n: Partial<typeof zeros>) => ({ ...zeros, regraId, zonaId, hora: quando, ...n });
    // Os dias são os do relógio DA LOJA, que neste teste está em outra data que a da sessão do banco: quem
    // contasse o "hoje" ou a meia-noite pelo relógio do servidor erraria as bordas abaixo.
    const datas = (await pool.query(`select current_date::text as da_sessao, (now() at time zone $1)::date::text as da_loja`, [fuso])).rows[0];
    assert.notEqual(datas.da_loja, datas.da_sessao, `a loja (${fuso}) tem de estar em outra data`);
    const [hoje, hojeAoFim, amanha, ontem, haSeis, haSete] = [
      await hora(0, 0), await hora(0, 23), await hora(-1, 0), await hora(1, 22), await hora(6, 0), await hora(7, 23),
    ];
    const r = await doAgente('POST', '/v1/resumos', {
      resumos: [
        // O critério dos três lugares: cada lugar com os seus números.
        linha(emTres, chapa, ontem, { capturas: 120, semCondicao: 40, semGatilho: 60, observadas: 20 }),
        linha(emTres, chapa, hoje, { capturas: 30, semCondicao: 10, semGatilho: 17, observadas: 3 }),
        linha(emTres, posto, ontem, { capturas: 120, semCondicao: 90, semGatilho: 24, observadas: 6 }),
        // As bordas da janela, no relógio da loja. O primeiro dia entra desde a meia-noite; o dia anterior, não.
        linha(emTres, inteira, haSeis, { capturas: 50, semGatilho: 45, observadas: 5 }),
        linha(emTres, inteira, haSete, { capturas: 999, observadas: 999 }),
        // Hoje entra até a última hora; a primeira hora de amanhã, não.
        linha(emTres, posto, hojeAoFim, { capturas: 10, semGatilho: 8, observadas: 2 }),
        linha(emTres, posto, amanha, { capturas: 500, observadas: 500 }),
        // O que julga: enfileiradas, com os três vereditos, cena repetida e o que já tinha veredito.
        linha(soNaChapa, chapa, ontem, { capturas: 200, semCondicao: 100, enfileiradas: 60, repetidas: 30, jaJulgadas: 10, conformes: 40, naoConformes: 15, naoAvaliaveis: 5, julgadasNuvem: 60, comConfianca: 60, somaConfianca: 50, custoCentavos: 6 }),
        // O do outro canal não se mistura.
        linha(doCaixa, caixa, ontem, { capturas: 77, observadas: 7, semGatilho: 70 }),
      ],
    });
    assert.deepEqual(r.json(), { aceitos: 9, recusados: [] }, r.body);

    const tela = await canal();
    const numeros = Object.fromEntries(tela.zonas.flatMap((z) => z.criterios.filter((k) => [emTres, soNaChapa].includes(k.id)).map((k) => [`${z.nome}/${k.id === emTres ? 'em três' : 'só na chapa'}`, k.funil])));
    assert.deepEqual(numeros, {
      'Imagem completa/em três': { olhadas: 50, comGatilho: 5, julgadas: 0, foraDoCriterio: 0 },
      'Chapa/em três': { olhadas: 150, comGatilho: 23, julgadas: 0, foraDoCriterio: 0 },
      'Chapa/só na chapa': { olhadas: 200, comGatilho: 100, julgadas: 60, foraDoCriterio: 15 },
      'Posto do chapeiro/em três': { olhadas: 130, comGatilho: 8, julgadas: 0, foraDoCriterio: 0 },
    });
    assert.deepEqual((await noCanal(doCaixa, caixa, cookie, outroPonto))!.funil, { olhadas: 77, comGatilho: 7, julgadas: 0, foraDoCriterio: 0 });

    // É a mesma conta do funil do critério: a soma dos lugares bate com o total dele.
    const doCriterio = (await app.inject({ method: 'GET', url: `/v1/regras/${emTres}/funil`, headers: { cookie: cookieSupervisao } })).json();
    assert.deepEqual([doCriterio.dias, doCriterio.total.olhadas, doCriterio.total.comGatilho], [DIAS_DO_FUNIL, 330, 36]);

    // A mesma permissão do funil: supervisão e suporte veem; a execução recebe o canal sem número nenhum.
    assert.deepEqual((await noCanal(emTres, chapa, cookieSupervisao))!.funil, { olhadas: 150, comGatilho: 23, julgadas: 0, foraDoCriterio: 0 });
    assert.deepEqual((await noCanal(emTres, chapa, cookieSuporte))!.funil, { olhadas: 150, comGatilho: 23, julgadas: 0, foraDoCriterio: 0 });
    assert.equal((await canal(pontoId, cookieSuporte)).ponto.funil_dias, DIAS_DO_FUNIL);
    const paraAExecucao = await canal(pontoId, cookieExecucao);
    assert.equal(paraAExecucao.ponto.funil_dias, null);
    for (const z of paraAExecucao.zonas) for (const k of z.criterios) assert.equal(k.funil, null, `${z.nome}/${k.nome}`);
    assert.ok(paraAExecucao.zonas.some((z) => z.criterios.length > 0), 'o canal chega com os critérios, só sem os números');

    // O relógio da loja não vaza junto com o canal.
    for (const chave of ['fuso_da_loja', 'hoje_na_loja']) assert.ok(!(chave in tela.ponto), chave);
  });
});

// ───────────────── a migration 035, sobre o que já existia ─────────────────
//
// Roda o ARQUIVO da migration num esquema só deste teste, com uma cópia vazia
// de `regra` SEM a coluna (como era antes) e critérios de antes montados à
// mão. A tabela de verdade não é tocada.

describe('migration 035 — a família do critério (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let c: pg.Client;
  const esquema = `teste_mig035_${randomUUID().slice(0, 8)}`;

  before(async () => {
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    await pool.query(`create schema ${esquema}`);
    // Só as colunas e os valores de fábrica: as regras (`check`) não vêm — a de 035 é a migration que cria.
    await pool.query(`create table ${esquema}.regra (like public.regra including defaults)`);
    await pool.query(`alter table ${esquema}.regra drop column familia`);
    c = new pg.Client({ connectionString: URL_DO_BANCO, options: `-c search_path=${esquema}` });
    await c.connect();
  });

  after(async () => {
    await c?.end().catch(() => {});
    await pool?.query(`drop schema if exists ${esquema} cascade`);
    await pool?.end();
  });

  it('não muda critério nenhum e deixa a regra no banco — e rodar de novo não muda nada', async () => {
    // Os critérios de antes: um de cada tipo, em estados diferentes, ligados e desligados.
    const ids: Record<string, string> = {};
    for (const [i, tipo] of TIPOS.entries()) {
      ids[tipo] = (await c.query(
        `insert into regra (loja_id, nome, tipo, criterio, estado, ativa, atualizado_em)
         values ($1, $2, $3, 'O texto de antes.', $4, $5, timestamptz '2026-01-01')
         returning id`,
        [randomUUID(), `De antes, ${tipo}`, tipo, ['valendo', 'ensaio', 'observando'][i % 3], i % 2 === 0],
      )).rows[0].id as string;
    }
    const linhas = async () => (await c.query(`select to_jsonb(r) - 'familia' as linha from regra r order by id`)).rows.map((l) => l.linha);
    const antes = await linhas();
    assert.equal(antes.length, TIPOS.length);
    /** Tenta gravar; devolve `null` se entrou, ou o código do erro do banco. */
    const tentar = (sql: string, valores: unknown[]) =>
      c.query(sql, valores).then(() => null, (e: { code?: string }) => e.code ?? 'sem código');

    const conferir = async (vez: string) => {
      // Nenhuma linha mudou — nem a data de alteração —, e a família de todas ficou vazia.
      assert.deepEqual(await linhas(), antes, vez);
      assert.deepEqual((await c.query(`select count(*)::int as n, count(familia)::int as com from regra`)).rows[0], { n: TIPOS.length, com: 0 }, vez);
      // A coluna: texto, opcional e sem valor de fábrica.
      assert.deepEqual(
        (await c.query(
          `select data_type, is_nullable, column_default from information_schema.columns
            where table_schema = $1 and table_name = 'regra' and column_name = 'familia'`,
          [esquema],
        )).rows,
        [{ data_type: 'text', is_nullable: 'YES', column_default: null }],
        vez,
      );
      // A regra (23514 = violação de `check`): cada família em cada tipo, e o que não é família em tipo nenhum.
      for (const tipo of TIPOS) {
        for (const familia of [...FAMILIAS, 'nada', '', 'Estado']) {
          const recusa = await tentar(`update regra set familia = $2 where id = $1`, [ids[tipo], familia]);
          assert.equal(recusa, cabeNoTipo(familia, tipo) ? null : '23514', `${vez}: ${familia} × ${tipo}`);
          await c.query(`update regra set familia = null where id = $1`, [ids[tipo]]);
        }
      }
      // O tipo não muda por baixo da família: os dois têm de continuar cabendo.
      await c.query(`update regra set familia = 'estado' where id = $1`, [ids.estado]);
      assert.equal(await tentar(`update regra set tipo = 'acao' where id = $1`, [ids.estado]), '23514', vez);
      assert.equal(await tentar(`update regra set tipo = 'presenca' where id = $1`, [ids.estado]), null, vez);
      await c.query(`update regra set familia = null, tipo = 'estado' where id = $1`, [ids.estado]);
    };

    await c.query(MIGRATION);
    await conferir('a primeira vez');
    await c.query(MIGRATION);
    await conferir('de novo');

    // Com famílias já escolhidas, rodar outra vez não apaga nem troca nenhuma.
    await c.query(`update regra set familia = 'processo' where id = $1`, [ids.acao]);
    await c.query(`update regra set familia = 'estado' where id = $1`, [ids.contagem]);
    await c.query(MIGRATION);
    assert.deepEqual(
      (await c.query(`select tipo, familia from regra order by tipo`)).rows,
      [
        { tipo: 'acao', familia: 'processo' },
        { tipo: 'comparacao', familia: null },
        { tipo: 'contagem', familia: 'estado' },
        { tipo: 'estado', familia: null },
        { tipo: 'presenca', familia: null },
      ],
    );
  });
});
