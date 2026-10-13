// O balcão — o cadastro: a conta de IA de cada loja, a chave interna e o teto.
//
// A20, "a dúvida passa pelo nosso servidor", fase 1a. O dono aprovou o plano
// em 13/10/2026: o teto do piloto é de R$ 40,00 por loja e por dia, e na
// distribuição vale "só a conta do lojista, com a chave dele guardada
// cifrada no nosso servidor". O que tem de ficar provado aqui:
//
//   - nada muda para quem já está no ar: a chave nasce desligada, o teto em
//     R$ 40,00, e loja nenhuma tem conta;
//   - a chave da conta ENTRA e não sai: é cifrada na hora, presa à loja (o
//     texto cifrado de uma loja não abre na linha de outra), e nenhuma
//     resposta, mensagem de erro ou linha de registro a traz;
//   - ligar pede o pedido com contexto e a conta de IA, e diz qual falta —
//     e, ligado, nenhuma das duas sai: a conta não é tirada e o pedido com
//     contexto não desliga (nem pela rota dele, nem por fora das rotas);
//   - só `true` e `false` movem a chave, e o teto é um inteiro de centavos;
//   - tirar a conta, só com o balcão desligado;
//   - tudo isto é da distribuição: o console da loja não mexe, nem o
//     presidente.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { CHAVE_MAX, CHAVE_MIN, PLATAFORMAS, lerChaveDaConta, provedores } from '../src/balcao/plataformas.js';
import { decifrar } from '../src/cifra.js';
import { TETO_MAXIMO_CENTAVOS, contaDeIaDaLoja, contextoDaContaDeIa } from '../src/rotas/balcao.js';

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-balcao-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-balcao';
const SENHA = 'uma senha longa o bastante';
const PROVISIONAR = fileURLToPath(new URL('../scripts/provisionar.mjs', import.meta.url));

// Chaves DE MENTIRA, montadas aqui: têm a cara que o cadastro aceita e não abrem nada em lugar nenhum.
const chaveDeMentira = (rotulo: string) => ['sk', 'ant', `de-mentira-${rotulo}`, randomUUID().replace(/-/g, '')].join('-');
const CHAVE = chaveDeMentira('um');
const OUTRA_CHAVE = chaveDeMentira('dois');

// ───────────────────── a chave da conta, sem banco ─────────────────────

describe('o balcão: o que tem a cara de uma chave', () => {
  it('as plataformas do código são as que a migration aceita', () => {
    const sql = readFileSync(new URL('../../database/migrations/044_balcao_cadastro.sql', import.meta.url), 'utf8');
    const lista = /provedor\s+text not null check \(provedor in \(([^)]*)\)\)/.exec(sql);
    assert.ok(lista, 'achei a lista da migration');
    const daMigration = lista[1]!.split(',').map((p) => p.trim().replace(/^'|'$/g, ''));
    assert.deepEqual(provedores(), daMigration);
    assert.deepEqual(provedores(), Object.keys(PLATAFORMAS));
    for (const p of provedores()) assert.ok(PLATAFORMAS[p]!.nome.trim(), `a plataforma ${p} tem nome`);
  });

  it('a chave boa passa como veio', () => {
    assert.deepEqual(lerChaveDaConta('anthropic', CHAVE), { provedor: 'anthropic', chave: CHAVE });
  });

  it('plataforma fora da lista é recusada — inclusive os nomes que todo objeto tem', () => {
    for (const p of ['openai', 'ANTHROPIC', ' anthropic', '', 'constructor', 'toString', '__proto__', 'hasOwnProperty', null, undefined, 1, {}, ['anthropic']]) {
      const r = lerChaveDaConta(p, CHAVE);
      assert.ok('problema' in r, `provedor ${String(p)} tinha de ser recusado`);
      assert.equal(r.problema, 'provedor: um de anthropic');
    }
  });

  it('o que não é chave é recusado, e o motivo nunca repete o que veio', () => {
    const base = 'sk-ant-';
    const casos: Array<[unknown, string]> = [
      [undefined, 'chave: texto'],
      [null, 'chave: texto'],
      [123456789012345678901234567890, 'chave: texto'],
      [{ chave: CHAVE }, 'chave: texto'],
      [` ${CHAVE}`, 'chave: sem espaço nem quebra de linha'],
      [`${CHAVE} `, 'chave: sem espaço nem quebra de linha'],
      [`${CHAVE}\n`, 'chave: sem espaço nem quebra de linha'],
      [`${CHAVE.slice(0, 20)} ${CHAVE.slice(20)}`, 'chave: sem espaço nem quebra de linha'],
      [`${CHAVE.slice(0, 20)}\t${CHAVE.slice(20)}`, 'chave: sem espaço nem quebra de linha'],
      ['', `chave: de ${CHAVE_MIN} a ${CHAVE_MAX} caracteres`],
      [base + 'a'.repeat(CHAVE_MIN - base.length - 1), `chave: de ${CHAVE_MIN} a ${CHAVE_MAX} caracteres`],
      // Com o tamanho mínimo exato o problema já não é o tamanho: é a cara.
      [base + 'a'.repeat(CHAVE_MIN - base.length), 'chave: não tem a cara de uma chave da Anthropic'],
      [base + 'a'.repeat(CHAVE_MAX - base.length + 1), `chave: de ${CHAVE_MIN} a ${CHAVE_MAX} caracteres`],
      ['sk-proj-' + 'a'.repeat(40), 'chave: não tem a cara de uma chave da Anthropic'],
      ['sk-ant-...' + 'a'.repeat(30), 'chave: não tem a cara de uma chave da Anthropic'],
      ['sk-ant-' + 'a'.repeat(19), 'chave: não tem a cara de uma chave da Anthropic'],
      ['SK-ANT-' + 'a'.repeat(40), 'chave: não tem a cara de uma chave da Anthropic'],
      ['x' + CHAVE, 'chave: não tem a cara de uma chave da Anthropic'],
      [CHAVE + '!', 'chave: não tem a cara de uma chave da Anthropic'],
    ];
    for (const [chave, esperado] of casos) {
      const r = lerChaveDaConta('anthropic', chave);
      assert.ok('problema' in r, `${String(chave).slice(0, 12)}… tinha de ser recusada`);
      assert.equal(r.problema, esperado);
      if (typeof chave === 'string' && chave.length >= 8) assert.ok(!r.problema.includes(chave.slice(0, 12)), 'o motivo não repete a chave');
    }
    // As pontas da faixa de tamanho: a menor e a maior que valem.
    assert.ok(!('problema' in lerChaveDaConta('anthropic', base + 'a'.repeat(20))));
    assert.ok(!('problema' in lerChaveDaConta('anthropic', base + 'a'.repeat(CHAVE_MAX - base.length))));
  });
});

// ─────────────────────────── com o banco ───────────────────────────

describe('o balcão: o cadastro (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  let tenantId = '';
  let lojaId = '';
  let vizinhaId = '';
  let tenantVizinho = '';
  let cookiePresidente = '';
  let token = '';
  const cofre = randomBytes(32);
  const registro: string[] = [];

  const D = { 'x-farol-admin': ADMIN };
  const ver = (id = lojaId, cabecalhos: Record<string, string> = D) =>
    app.inject({ method: 'GET', url: `/v1/distribuicao/lojas/${id}/balcao`, headers: cabecalhos });
  const mudar = (corpo: unknown, id = lojaId, cabecalhos: Record<string, string> = D) =>
    app.inject({ method: 'PATCH', url: `/v1/distribuicao/lojas/${id}/balcao`, headers: cabecalhos, payload: corpo as object });
  const gravarConta = (corpo: unknown, id = lojaId, cabecalhos: Record<string, string> = D, em = app) =>
    em.inject({ method: 'PUT', url: `/v1/distribuicao/lojas/${id}/conta-ia`, headers: cabecalhos, payload: corpo as object });
  const tirarConta = (id = lojaId, cabecalhos: Record<string, string> = D) =>
    app.inject({ method: 'DELETE', url: `/v1/distribuicao/lojas/${id}/conta-ia`, headers: cabecalhos });
  const contexto = (ligado: boolean, id = lojaId) =>
    app.inject({ method: 'PATCH', url: `/v1/distribuicao/lojas/${id}`, headers: D, payload: { pedidoComContexto: ligado, mesmoAssim: true } });
  const noBanco = async (id = lojaId) =>
    (await pool.query('select duvida_pelo_servidor, teto_duvida_centavos_dia, config_versao from loja where id = $1', [id])).rows[0] as {
      duvida_pelo_servidor: boolean; teto_duvida_centavos_dia: number; config_versao: number;
    };
  const contaNoBanco = async (id = lojaId) =>
    (await pool.query('select tenant_id, provedor, chave_cifrada, criada_em, atualizada_em from conta_ia where loja_id = $1', [id])).rows[0] as
      | { tenant_id: string; provedor: string; chave_cifrada: string; criada_em: Date; atualizada_em: Date }
      | undefined;
  /** Uma loja nova, só para o teste que precisa começar do zero. */
  async function lojaNova(nome: string) {
    const r = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: D,
      payload: { tenantId, loja: { nome }, setores: [] },
    })).json();
    return r.loja.id as string;
  }

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    app = criarApp(pool, { logger: { level: 'info', stream: { write: (l) => void registro.push(l) } }, balcao: { cofre } });
    await app.ready();

    const conta = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: D,
      payload: { tenant: { nome: marca }, loja: { nome: 'Matriz' }, setores: [{ nome: 'Cozinha' }] },
    })).json();
    tenantId = conta.tenantId;
    lojaId = conta.loja.id;
    const vizinha = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: D,
      payload: { tenant: { nome: `${marca}-vizinha` }, loja: { nome: 'Vizinha' }, setores: [] },
    })).json();
    vizinhaId = vizinha.loja.id;
    tenantVizinho = vizinha.tenantId;

    await app.inject({
      method: 'POST', url: '/v1/distribuicao/usuarios', headers: D,
      payload: { tenantId, nome: 'Presidente', email: `pre-${marca}@e.com`, senha: SENHA, nivel: 'presidente' },
    });
    const sessao = await app.inject({ method: 'POST', url: '/v1/sessao', payload: { email: `pre-${marca}@e.com`, senha: SENHA } });
    const biscoito = sessao.headers['set-cookie'];
    cookiePresidente = (Array.isArray(biscoito) ? biscoito[0]! : String(biscoito)).split(';')[0]!;

    const agente = (await app.inject({ method: 'POST', url: '/v1/distribuicao/agentes', headers: D, payload: { lojaId, nome: 'PC da loja' } })).json();
    token = agente.token;
    await app.inject({ method: 'POST', url: '/v1/agentes/ativar', headers: { authorization: `Bearer ${token}` }, payload: { fingerprint: `fp-${marca}` } });
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  // ─────────────────────── nasce desligado ───────────────────────

  it('nasce desligado, com o teto de R$ 40,00 e sem conta de IA', async () => {
    const r = await ver();
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json(), {
      id: lojaId, nome: 'Matriz', ligado: false, tetoCentavosDia: 4000, pedidoComContexto: false,
      configVersao: (await noBanco()).config_versao, contaDeIa: null,
    });
    assert.equal(await contaNoBanco(), undefined);
  });

  // ─────────────────────── quem entra ───────────────────────

  it('só a distribuição entra, e loja que não existe é 404 nas quatro portas', async () => {
    const portas = [
      (id: string, c: Record<string, string>) => ver(id, c),
      (id: string, c: Record<string, string>) => mudar({ ligado: false }, id, c),
      (id: string, c: Record<string, string>) => gravarConta({ provedor: 'anthropic', chave: CHAVE }, id, c),
      (id: string, c: Record<string, string>) => tirarConta(id, c),
    ];
    for (const porta of portas) {
      assert.equal((await porta(lojaId, {})).statusCode, 401, 'sem credencial');
      assert.equal((await porta(lojaId, { 'x-farol-admin': 'outra' })).statusCode, 401, 'credencial errada');
      assert.equal((await porta(lojaId, { cookie: cookiePresidente })).statusCode, 401, 'sessão do console não é credencial de distribuição');
      assert.equal((await porta(randomUUID(), D)).statusCode, 404, 'loja que não existe');
      assert.equal((await porta('nao-e-uuid', D)).statusCode, 404, 'id torto');
    }
    process.env.FAROL_ADMIN_TOKEN = '';
    try {
      for (const porta of portas) assert.equal((await porta(lojaId, D)).statusCode, 503, 'sem a credencial configurada a porta fica FECHADA');
    } finally {
      process.env.FAROL_ADMIN_TOKEN = ADMIN;
    }
    assert.equal(await contaNoBanco(), undefined, 'nenhuma dessas tentativas gravou conta');
  });

  // ─────────────────────── a conta de IA ───────────────────────

  it('a conta de IA entra cifrada, presa à loja, e não sai mais', async () => {
    registro.length = 0;
    const r = await gravarConta({ provedor: 'anthropic', chave: CHAVE });
    assert.equal(r.statusCode, 200, r.body);
    const corpo = r.json();
    assert.deepEqual(Object.keys(corpo).sort(), ['atualizadaEm', 'lojaId', 'provedor']);
    assert.deepEqual([corpo.lojaId, corpo.provedor], [lojaId, 'anthropic']);
    assert.ok(!r.body.includes(CHAVE), 'a resposta não traz a chave');

    const linha = (await contaNoBanco())!;
    assert.equal(linha.provedor, 'anthropic');
    assert.equal(linha.tenant_id, tenantId);
    assert.ok(linha.chave_cifrada.startsWith('v1.'), 'guardada no formato da cifra');
    assert.ok(!linha.chave_cifrada.includes(CHAVE) && !JSON.stringify(linha).includes(CHAVE), 'o banco não tem o texto claro');
    assert.equal(decifrar(linha.chave_cifrada, cofre, contextoDaContaDeIa(tenantId, lojaId)), CHAVE, 'abre com o cofre e o contexto da loja');
    assert.equal(decifrar(linha.chave_cifrada, cofre, contextoDaContaDeIa(tenantVizinho, vizinhaId)), null, 'não abre com o contexto de outra loja');
    assert.equal(decifrar(linha.chave_cifrada, cofre, contextoDaContaDeIa(tenantId, vizinhaId)), null, 'nem com a loja trocada');
    assert.equal(decifrar(linha.chave_cifrada, cofre, contextoDaContaDeIa(tenantVizinho, lojaId)), null, 'nem com a empresa trocada');
    assert.equal(decifrar(linha.chave_cifrada, randomBytes(32), contextoDaContaDeIa(tenantId, lojaId)), null, 'nem com outro cofre');

    const estado = await ver();
    assert.deepEqual(Object.keys(estado.json().contaDeIa).sort(), ['atualizadaEm', 'provedor']);
    assert.equal(estado.json().contaDeIa.provedor, 'anthropic');
    assert.ok(!estado.body.includes(CHAVE) && !estado.body.includes(linha.chave_cifrada), 'o estado não traz a chave, nem cifrada');

    assert.ok(registro.some((l) => l.includes('conta de IA gravada')), 'ficou no registro que a conta foi gravada');
    assert.ok(!registro.join('\n').includes(CHAVE), 'o registro não traz a chave');
    assert.ok(!registro.join('\n').includes(linha.chave_cifrada), 'nem a cifrada');
  });

  it('quem vai perguntar lê a chave de volta — só da própria loja', async () => {
    assert.deepEqual(await contaDeIaDaLoja(pool, cofre, lojaId), { provedor: 'anthropic', chave: CHAVE });
    assert.equal(await contaDeIaDaLoja(pool, null, lojaId), null, 'sem o cofre não há leitura');
    assert.equal(await contaDeIaDaLoja(pool, randomBytes(32), lojaId), null, 'com outro cofre não abre');
    assert.equal(await contaDeIaDaLoja(pool, cofre, vizinhaId), null, 'loja sem conta');

    // A linha de uma loja, colada na outra, não abre: é o contexto na cifra.
    const daMatriz = (await contaNoBanco())!;
    await pool.query(
      `insert into conta_ia (loja_id, tenant_id, provedor, chave_cifrada) values ($1, $2, 'anthropic', $3)`,
      [vizinhaId, tenantVizinho, daMatriz.chave_cifrada],
    );
    try {
      assert.equal(await contaDeIaDaLoja(pool, cofre, vizinhaId), null, 'a chave da Matriz não abre na Vizinha');
    } finally {
      await pool.query('delete from conta_ia where loja_id = $1', [vizinhaId]);
    }
  });

  it('gravar de novo troca a chave na mesma linha', async () => {
    const antes = (await contaNoBanco())!;
    const r = await gravarConta({ provedor: 'anthropic', chave: OUTRA_CHAVE });
    assert.equal(r.statusCode, 200, r.body);
    const depois = (await contaNoBanco())!;
    assert.equal((await pool.query('select count(*)::int as n from conta_ia where loja_id = $1', [lojaId])).rows[0].n, 1);
    assert.notEqual(depois.chave_cifrada, antes.chave_cifrada);
    assert.equal(depois.criada_em.getTime(), antes.criada_em.getTime(), 'a conta é a mesma');
    assert.ok(depois.atualizada_em.getTime() > antes.atualizada_em.getTime(), 'a troca fica com a hora dela');
    assert.deepEqual(await contaDeIaDaLoja(pool, cofre, lojaId), { provedor: 'anthropic', chave: OUTRA_CHAVE });

    // A mesma chave cifrada duas vezes dá dois textos: não dá para saber, pelo banco, que duas lojas usam a mesma conta.
    await gravarConta({ provedor: 'anthropic', chave: OUTRA_CHAVE });
    assert.notEqual((await contaNoBanco())!.chave_cifrada, depois.chave_cifrada);
    assert.deepEqual(await contaDeIaDaLoja(pool, cofre, lojaId), { provedor: 'anthropic', chave: OUTRA_CHAVE });
  });

  it('o que não é conta é recusado sem repetir o que veio, e nada é gravado', async () => {
    const id = await lojaNova(`Sem conta ${marca}`);
    const ruim = chaveDeMentira('ruim');
    const corpos: Array<[unknown, number, string]> = [
      [{ provedor: 'openai', chave: ruim }, 422, 'validacao'],
      [{ chave: ruim }, 422, 'validacao'],
      [{ provedor: 'anthropic' }, 422, 'validacao'],
      [{ provedor: 'anthropic', chave: `${ruim} ` }, 422, 'validacao'],
      [{ provedor: 'anthropic', chave: ruim.replace('sk-ant-', 'sk-outra-') }, 422, 'validacao'],
      [{ provedor: 'anthropic', chave: ruim, modelo: 'qualquer' }, 422, 'validacao'],
      [{ provedor: 'anthropic', chave: ruim, senha: 'x' }, 422, 'segredo_no_cadastro'],
      [{ provedor: 'anthropic', chave: ruim, conta: { password: 'x' } }, 422, 'segredo_no_cadastro'],
      [[{ provedor: 'anthropic', chave: ruim }], 422, 'validacao'],
    ];
    for (const [corpo, status, erro] of corpos) {
      const r = await gravarConta(corpo, id);
      assert.equal(r.statusCode, status, JSON.stringify(corpo).slice(0, 60));
      assert.equal(r.json().erro, erro);
      assert.ok(!r.body.includes(ruim) && !r.body.includes(ruim.replace('sk-ant-', 'sk-outra-')), 'a recusa não repete a chave');
    }
    assert.equal((await app.inject({ method: 'PUT', url: `/v1/distribuicao/lojas/${id}/conta-ia`, headers: D })).statusCode, 422, 'sem corpo');
    assert.equal(await contaNoBanco(id), undefined, 'nada foi gravado');
  });

  it('sem o cofre do servidor a conta não é guardada', async () => {
    const id = await lojaNova(`Sem cofre ${marca}`);
    const semCofre = criarApp(pool, { logger: false, balcao: { cofre: null } });
    await semCofre.ready();
    try {
      const r = await gravarConta({ provedor: 'anthropic', chave: CHAVE }, id, D, semCofre);
      assert.equal(r.statusCode, 503, r.body);
      assert.equal(r.json().erro, 'cofre_indisponivel');
      assert.ok(!r.body.includes(CHAVE));
      // A conferência do que veio vem antes: chave torta é 422 mesmo sem cofre (o erro é de quem mandou).
      assert.equal((await gravarConta({ provedor: 'anthropic', chave: 'torta' }, id, D, semCofre)).statusCode, 422);
    } finally {
      await semCofre.close();
    }
    assert.equal(await contaNoBanco(id), undefined);
  });

  // ─────────────────────── a chave interna ───────────────────────

  it('ligar pede o pedido com contexto e a conta de IA, e diz qual falta', async () => {
    const id = await lojaNova(`Liga ${marca}`);
    const v0 = (await noBanco(id)).config_versao;

    const semContexto = await mudar({ ligado: true }, id);
    assert.equal(semContexto.statusCode, 409, semContexto.body);
    assert.equal(semContexto.json().erro, 'sem_pedido_com_contexto');
    assert.deepEqual([(await noBanco(id)).duvida_pelo_servidor, (await noBanco(id)).config_versao], [false, v0], 'não ligou e a versão não subiu');

    // Com a conta mas sem o contexto: continua faltando o contexto.
    assert.equal((await gravarConta({ provedor: 'anthropic', chave: CHAVE }, id)).statusCode, 200);
    assert.equal((await mudar({ ligado: true }, id)).json().erro, 'sem_pedido_com_contexto');

    // Com o contexto mas sem a conta: falta a conta.
    assert.equal((await tirarConta(id)).statusCode, 200);
    assert.equal((await contexto(true, id)).statusCode, 200);
    const v1 = (await noBanco(id)).config_versao;
    const semConta = await mudar({ ligado: true }, id);
    assert.equal(semConta.statusCode, 409, semConta.body);
    assert.equal(semConta.json().erro, 'sem_conta_de_ia');
    assert.deepEqual([(await noBanco(id)).duvida_pelo_servidor, (await noBanco(id)).config_versao], [false, v1]);

    // Desligar o que está desligado não pede nada, e não sobe a versão.
    const desligado = await mudar({ ligado: false }, id);
    assert.equal(desligado.statusCode, 200, desligado.body);
    assert.deepEqual([desligado.json().ligado, desligado.json().configVersao], [false, v1]);

    // Com os dois: liga, e a versão sobe — é por ela que o agente puxa a configuração.
    assert.equal((await gravarConta({ provedor: 'anthropic', chave: CHAVE }, id)).statusCode, 200);
    const ligou = await mudar({ ligado: true }, id);
    assert.equal(ligou.statusCode, 200, ligou.body);
    assert.deepEqual(
      { ...ligou.json(), contaDeIa: ligou.json().contaDeIa.provedor },
      { id, nome: `Liga ${marca}`, ligado: true, tetoCentavosDia: 4000, pedidoComContexto: true, configVersao: v1 + 1, contaDeIa: 'anthropic' },
    );
    assert.equal((await mudar({ ligado: true }, id)).json().configVersao, v1 + 1, 'ligar o que já está ligado não sobe a versão');

    // Mudar SÓ o teto não mexe na chave: a loja continua ligada, e a versão não sobe.
    const soOTeto = await mudar({ tetoCentavosDia: 700 }, id);
    assert.deepEqual([soOTeto.json().ligado, soOTeto.json().tetoCentavosDia, soOTeto.json().configVersao], [true, 700, v1 + 1]);
    assert.deepEqual(await noBanco(id), { duvida_pelo_servidor: true, teto_duvida_centavos_dia: 700, config_versao: v1 + 1 });

    // E mudar SÓ a chave não mexe no teto.
    const desligou = await mudar({ ligado: false }, id);
    assert.equal(desligou.json().tetoCentavosDia, 700, 'desligar não volta o teto ao de fábrica');
    assert.deepEqual([desligou.json().ligado, desligou.json().configVersao], [false, v1 + 2]);
    assert.equal((await noBanco(id)).duvida_pelo_servidor, false);
  });

  it('só true e false movem a chave; o teto é um inteiro de centavos; campo estranho é recusado', async () => {
    const id = await lojaNova(`Teto ${marca}`);
    const v0 = (await noBanco(id)).config_versao;
    for (const valor of ['true', 'false', 1, 0, null, 'sim', [], {}]) {
      const r = await mudar({ ligado: valor }, id);
      assert.equal(r.statusCode, 422, String(valor));
      assert.equal(r.json().mensagem, 'ligado: true ou false');
    }
    for (const valor of [-1, 0.5, 4000.5, '4000', null, true, TETO_MAXIMO_CENTAVOS + 1, 1e9, [4000]]) {
      const r = await mudar({ tetoCentavosDia: valor }, id);
      assert.equal(r.statusCode, 422, String(valor));
      assert.equal(r.json().mensagem, `tetoCentavosDia: inteiro de 0 a ${TETO_MAXIMO_CENTAVOS} (centavos por dia)`);
    }
    for (const corpo of [{}, { teto: 100 }, { ligar: true }, { ligado: false, outro: 1 }, [{ ligado: false }]]) {
      assert.equal((await mudar(corpo, id)).statusCode, 422, JSON.stringify(corpo));
    }
    assert.equal((await mudar({}, id)).json().mensagem, 'nada para mudar: mande ligado ou tetoCentavosDia');
    assert.match((await mudar({ teto: 100 }, id)).json().mensagem, /campo desconhecido: 'teto'/);
    assert.equal((await app.inject({ method: 'PATCH', url: `/v1/distribuicao/lojas/${id}/balcao`, headers: D })).statusCode, 422, 'sem corpo');
    assert.deepEqual(await noBanco(id), { duvida_pelo_servidor: false, teto_duvida_centavos_dia: 4000, config_versao: v0 }, 'nada disso mexeu na loja');

    // As duas pontas do teto valem, e o teto NÃO sobe a versão: é só do servidor.
    for (const teto of [0, TETO_MAXIMO_CENTAVOS, 1250]) {
      const r = await mudar({ tetoCentavosDia: teto }, id);
      assert.equal(r.statusCode, 200, r.body);
      assert.deepEqual([r.json().tetoCentavosDia, r.json().configVersao, r.json().ligado], [teto, v0, false]);
    }
    assert.equal((await noBanco(id)).teto_duvida_centavos_dia, 1250);

    // Os dois de uma vez: a recusa de um não grava o outro.
    const recusa = await mudar({ ligado: true, tetoCentavosDia: 900 }, id);
    assert.equal(recusa.statusCode, 409);
    assert.equal((await noBanco(id)).teto_duvida_centavos_dia, 1250, 'o teto não mudou junto com a recusa');
    const juntos = await mudar({ ligado: false, tetoCentavosDia: 900 }, id);
    assert.deepEqual([juntos.json().ligado, juntos.json().tetoCentavosDia, juntos.json().configVersao], [false, 900, v0]);
  });

  it('tirar a conta de IA, só com o balcão desligado', async () => {
    const id = await lojaNova(`Tira ${marca}`);
    assert.equal((await tirarConta(id)).statusCode, 404, 'não há o que tirar');
    assert.equal((await tirarConta(id)).json().erro, 'sem_conta_de_ia');

    await contexto(true, id);
    await gravarConta({ provedor: 'anthropic', chave: CHAVE }, id);
    assert.equal((await mudar({ ligado: true }, id)).statusCode, 200);

    const recusa = await tirarConta(id);
    assert.equal(recusa.statusCode, 409, recusa.body);
    assert.equal(recusa.json().erro, 'balcao_ligado');
    assert.ok(await contaNoBanco(id), 'a conta continua lá');

    assert.equal((await mudar({ ligado: false }, id)).statusCode, 200);
    const tirou = await tirarConta(id);
    assert.equal(tirou.statusCode, 200, tirou.body);
    assert.deepEqual(tirou.json(), { lojaId: id, contaDeIa: null });
    assert.equal(await contaNoBanco(id), undefined);
    assert.equal((await ver(id)).json().contaDeIa, null);
    assert.equal((await mudar({ ligado: true }, id)).json().erro, 'sem_conta_de_ia', 'sem a conta, não liga de novo');
  });

  it('ligar e tirar a conta ao mesmo tempo: a loja nunca fica ligada sem ter com que perguntar', async () => {
    // As duas chamadas param na trava da loja, que outra conexão segura; soltas juntas, só uma passa.
    for (let vez = 0; vez < 4; vez += 1) {
      const id = await lojaNova(`Corrida ${vez} ${marca}`);
      await contexto(true, id);
      await gravarConta({ provedor: 'anthropic', chave: CHAVE }, id);

      const segura = await pool.connect();
      let ligar: Awaited<ReturnType<typeof mudar>>;
      let tirar: Awaited<ReturnType<typeof tirarConta>>;
      try {
        await segura.query('begin');
        await segura.query('select id from loja where id = $1 for no key update', [id]);
        const promessas = vez % 2 === 0 ? [mudar({ ligado: true }, id), tirarConta(id)] : [tirarConta(id), mudar({ ligado: true }, id)];
        // Tempo para as duas chegarem à trava (ou, sem trava, para a que não espera passar na frente).
        await new Promise((ok) => setTimeout(ok, 250));
        await segura.query('commit');
        const [a, b] = await Promise.all(promessas);
        [ligar, tirar] = vez % 2 === 0 ? [a!, b!] : [b!, a!];
      } finally {
        segura.release();
      }

      const loja = await noBanco(id);
      const conta = await contaNoBanco(id);
      assert.ok(!(loja.duvida_pelo_servidor && !conta), `vez ${vez}: ligada e sem conta`);
      assert.deepEqual([ligar.statusCode, tirar.statusCode].sort(), [200, 409], `vez ${vez}: uma passa, a outra é recusada`);
      if (ligar.statusCode === 200) {
        assert.equal(tirar.json().erro, 'balcao_ligado');
        assert.ok(loja.duvida_pelo_servidor && conta);
      } else {
        assert.equal(ligar.json().erro, 'sem_conta_de_ia');
        assert.ok(!loja.duvida_pelo_servidor && !conta);
      }
    }
  });

  // ─────────────────── o balcão só fala o pedido com contexto ───────────────────

  it('com o balcão ligado, o pedido com contexto não desliga — nem pela rota dele, nem por fora', async () => {
    const id = await lojaNova(`Contexto ${marca}`);
    await contexto(true, id);
    await gravarConta({ provedor: 'anthropic', chave: CHAVE }, id);
    assert.equal((await mudar({ ligado: true }, id)).statusCode, 200);
    const antes = await noBanco(id);

    const recusa = await contexto(false, id);
    assert.equal(recusa.statusCode, 409, recusa.body);
    assert.equal(recusa.json().erro, 'balcao_ligado');
    assert.deepEqual(await noBanco(id), antes, 'nada mudou: nem a chave, nem a versão');
    assert.equal((await ver(id)).json().pedidoComContexto, true);

    // Ligar o que já está ligado continua valendo, com o balcão ligado — e não sobe a versão.
    const deNovo = await contexto(true, id);
    assert.equal(deNovo.statusCode, 200, deNovo.body);
    assert.equal(deNovo.json().configVersao, antes.config_versao);

    // A ordem da volta: primeiro o balcão, depois o contexto.
    assert.equal((await mudar({ ligado: false }, id)).statusCode, 200);
    const desligou = await contexto(false, id);
    assert.equal(desligou.statusCode, 200, desligou.body);
    assert.deepEqual([desligou.json().pedidoComContexto, desligou.json().configVersao], [false, antes.config_versao + 2]);
    assert.equal((await ver(id)).json().pedidoComContexto, false);

    // A segunda tranca é do banco: por fora das rotas também não entra (23514 = regra de `check`).
    await assert.rejects(
      pool.query('update loja set duvida_pelo_servidor = true where id = $1', [id]),
      (e: { code?: string; constraint?: string }) => e.code === '23514' && e.constraint === 'loja_balcao_pede_contexto',
    );
    assert.equal((await noBanco(id)).duvida_pelo_servidor, false);
  });

  it('ligar o balcão e desligar o contexto ao mesmo tempo: a loja nunca fica com o balcão ligado e sem contexto', async () => {
    // As duas chamadas param na trava da loja, que outra conexão segura; soltas juntas, só uma passa — e a que
    // não passa é RECUSADA com o motivo (409), não derrubada pela regra do banco (que daria 500).
    for (let vez = 0; vez < 4; vez += 1) {
      const id = await lojaNova(`Corrida do contexto ${vez} ${marca}`);
      await contexto(true, id);
      await gravarConta({ provedor: 'anthropic', chave: CHAVE }, id);

      const segura = await pool.connect();
      let ligar: Awaited<ReturnType<typeof mudar>>;
      let desligar: Awaited<ReturnType<typeof contexto>>;
      try {
        await segura.query('begin');
        await segura.query('select id from loja where id = $1 for no key update', [id]);
        const promessas = vez % 2 === 0 ? [mudar({ ligado: true }, id), contexto(false, id)] : [contexto(false, id), mudar({ ligado: true }, id)];
        // Tempo para as duas chegarem à trava (ou, sem trava, para a que não espera passar na frente).
        await new Promise((ok) => setTimeout(ok, 250));
        await segura.query('commit');
        const [a, b] = await Promise.all(promessas);
        [ligar, desligar] = vez % 2 === 0 ? [a!, b!] : [b!, a!];
      } finally {
        segura.release();
      }

      const estado = (await ver(id)).json();
      assert.ok(!(estado.ligado && !estado.pedidoComContexto), `vez ${vez}: ligado e sem contexto`);
      assert.deepEqual([ligar.statusCode, desligar.statusCode].sort(), [200, 409], `vez ${vez}: uma passa, a outra é recusada`);
      if (ligar.statusCode === 200) {
        assert.equal(desligar.json().erro, 'balcao_ligado');
        assert.deepEqual([estado.ligado, estado.pedidoComContexto], [true, true]);
      } else {
        assert.equal(ligar.json().erro, 'sem_pedido_com_contexto');
        assert.deepEqual([estado.ligado, estado.pedidoComContexto], [false, false]);
      }
    }
  });

  // ─────────────────── as três rotas param na mesma trava ───────────────────
  //
  // As corridas acima soltam as duas chamadas juntas, e qualquer ordem serve. Aqui a ordem é
  // fixa: outra conexão faz, passo a passo, o que uma das rotas faz sob a trava da loja, e PARA
  // no meio. A rota chamada nesse instante tem de esperar — e decidir com o que ficou gravado.

  type Resposta = Awaited<ReturnType<typeof mudar>>;
  async function noMeioDe(id: string, oQueOutraFaz: string, chamada: () => Promise<Resposta>) {
    const outra = await pool.connect();
    try {
      await outra.query('begin');
      await outra.query('select id from loja where id = $1 for no key update', [id]);
      let respondeu = false;
      const promessa = chamada().then((r) => {
        respondeu = true;
        return r;
      });
      await new Promise((ok) => setTimeout(ok, 300));
      const esperou = !respondeu;
      await outra.query(oQueOutraFaz, [id]);
      await outra.query('commit');
      return { esperou, resposta: await promessa };
    } catch (e) {
      await outra.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      outra.release();
    }
  }
  const LIGA_O_BALCAO = 'update loja set duvida_pelo_servidor = true where id = $1';
  async function lojaPronta(nome: string) {
    const id = await lojaNova(`${nome} ${marca}`);
    await contexto(true, id);
    await gravarConta({ provedor: 'anthropic', chave: CHAVE }, id);
    return id;
  }

  it('quem tira a conta espera quem está ligando o balcão, e é recusado quando ele liga', async () => {
    const id = await lojaPronta('Espera a conta');
    const { esperou, resposta } = await noMeioDe(id, LIGA_O_BALCAO, () => tirarConta(id));
    assert.ok(esperou, 'tirar a conta parou na trava');
    assert.equal(resposta.statusCode, 409, resposta.body);
    assert.equal(resposta.json().erro, 'balcao_ligado');
    assert.ok(await contaNoBanco(id), 'a conta continua lá');
    assert.equal((await noBanco(id)).duvida_pelo_servidor, true);
  });

  it('quem desliga o contexto espera quem está ligando o balcão, e é recusado quando ele liga', async () => {
    const id = await lojaPronta('Espera o contexto');
    const { esperou, resposta } = await noMeioDe(id, LIGA_O_BALCAO, () => contexto(false, id));
    assert.ok(esperou, 'desligar o contexto parou na trava');
    assert.equal(resposta.statusCode, 409, resposta.body);
    assert.equal(resposta.json().erro, 'balcao_ligado');
    const estado = (await ver(id)).json();
    assert.deepEqual([estado.ligado, estado.pedidoComContexto], [true, true]);
  });

  it('quem liga o balcão espera quem está tirando a conta ou desligando o contexto, e é recusado', async () => {
    const semConta = await lojaPronta('Liga sem a conta');
    const a = await noMeioDe(semConta, 'delete from conta_ia where loja_id = $1', () => mudar({ ligado: true }, semConta));
    assert.ok(a.esperou, 'ligar parou na trava');
    assert.equal(a.resposta.statusCode, 409, a.resposta.body);
    assert.equal(a.resposta.json().erro, 'sem_conta_de_ia');
    assert.equal((await noBanco(semConta)).duvida_pelo_servidor, false);

    const semContexto = await lojaPronta('Liga sem o contexto');
    const b = await noMeioDe(semContexto, 'update loja set pedido_com_contexto = false where id = $1', () => mudar({ ligado: true }, semContexto));
    assert.ok(b.esperou, 'ligar parou na trava');
    assert.equal(b.resposta.statusCode, 409, b.resposta.body);
    assert.equal(b.resposta.json().erro, 'sem_pedido_com_contexto');
    assert.equal((await noBanco(semContexto)).duvida_pelo_servidor, false);
  });

  // ─────────────────────── quem NÃO mexe ───────────────────────

  it('o console da loja não mexe em nada disto — nem o presidente', async () => {
    for (const corpo of [{ duvidaPeloServidor: true }, { tetoDuvidaCentavosDia: 1 }, { contaDeIa: { provedor: 'anthropic', chave: CHAVE } }, { tipoNegocio: 'bar', duvidaPeloServidor: true }]) {
      const r = await app.inject({ method: 'PATCH', url: `/v1/lojas/${lojaId}`, headers: { cookie: cookiePresidente }, payload: corpo });
      assert.equal(r.statusCode, 422, JSON.stringify(corpo).slice(0, 50));
      assert.equal(r.json().erro, 'so_na_distribuicao');
      assert.ok(!r.body.includes(CHAVE));
    }
    assert.equal((await noBanco()).duvida_pelo_servidor, false);
  });

  it('o que desce para o agente não leva a conta', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/agentes/configuracao', headers: { authorization: `Bearer ${token}` } });
    assert.equal(r.statusCode, 200, r.body);
    const linha = (await contaNoBanco())!;
    assert.ok(linha, 'a loja tem conta');
    assert.ok(!r.body.includes(OUTRA_CHAVE) && !r.body.includes(linha.chave_cifrada) && !/chave_?cifrada|contaDeIa|conta_ia/i.test(r.body), 'nem a chave, nem a cifrada, nem o nome do cadastro');
  });

  // ─────────────────────── os comandos da distribuição ───────────────────────

  it('os comandos da distribuição falam com a API de verdade, e a chave entra sem aparecer', async () => {
    const id = await lojaNova(`Comando ${marca}`);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const porta = String((app.server.address() as AddressInfo).port);
    const rodar = (args: string[], entrada = '') =>
      new Promise<{ codigo: number | null; saida: string; erro: string }>((resolver, rejeitar) => {
        const filho = spawn(process.execPath, [PROVISIONAR, ...args], { env: { ...process.env, PORT: porta, FAROL_ADMIN_TOKEN: ADMIN } });
        let saida = '';
        let erro = '';
        filho.stdout.on('data', (p) => (saida += String(p)));
        filho.stderr.on('data', (p) => (erro += String(p)));
        filho.on('error', rejeitar);
        filho.on('close', (codigo) => resolver({ codigo, saida, erro }));
        filho.stdin.end(entrada);
      });

    const como = await rodar(['balcao', id]);
    assert.equal(como.codigo, 0, como.erro);
    assert.match(como.saida, /balcão \(a dúvida pelo servidor\): desligado/);
    assert.match(como.saida, /teto de gasto por dia: R\$ 40,00/);
    assert.match(como.saida, /conta de IA: não cadastrada/);

    const teto = await rodar(['teto', id, '12,50']);
    assert.equal(teto.codigo, 0, teto.erro);
    assert.match(teto.saida, /teto de gasto por dia: R\$ 12,50/);
    assert.equal((await noBanco(id)).teto_duvida_centavos_dia, 1250);
    for (const torto of ['doze', '-1', '12,505', '', '1e3']) {
      assert.notEqual((await rodar(['teto', id, torto])).codigo, 0, `teto ${torto}`);
    }
    assert.equal((await noBanco(id)).teto_duvida_centavos_dia, 1250, 'valor torto não mexe no teto');

    // Ligar antes de ter o que precisa: o comando diz o que falta e sai com erro.
    const cedo = await rodar(['balcao', id, 'ligar']);
    assert.equal(cedo.codigo, 2);
    assert.match(cedo.erro, /NÃO LIGUEI/);
    assert.match(cedo.erro, /provisionar -- contexto/);
    assert.equal((await contexto(true, id)).statusCode, 200);
    const semConta = await rodar(['balcao', id, 'ligar']);
    assert.equal(semConta.codigo, 2);
    assert.match(semConta.erro, /provisionar -- conta-ia/);

    // A chave vai pela entrada, nunca como argumento — e não volta na saída.
    const conta = await rodar(['conta-ia', id, 'anthropic'], `${CHAVE}\n`);
    assert.equal(conta.codigo, 0, conta.erro);
    assert.match(conta.saida, /conta de IA gravada: anthropic/);
    assert.ok(!conta.saida.includes(CHAVE) && !conta.erro.includes(CHAVE), 'o comando não mostra a chave');
    assert.deepEqual(await contaDeIaDaLoja(pool, cofre, id), { provedor: 'anthropic', chave: CHAVE });
    assert.notEqual((await rodar(['conta-ia', id, 'anthropic'], '\n')).codigo, 0, 'chave vazia');
    assert.notEqual((await rodar(['conta-ia', id, 'anthropic'], 'nao-e-chave\n')).codigo, 0, 'chave torta');
    assert.deepEqual(await contaDeIaDaLoja(pool, cofre, id), { provedor: 'anthropic', chave: CHAVE }, 'a recusa não troca a chave guardada');

    const ligou = await rodar(['balcao', id, 'ligar']);
    assert.equal(ligou.codigo, 0, ligou.erro);
    assert.match(ligou.saida, /balcão \(a dúvida pelo servidor\): LIGADO/);
    assert.equal((await noBanco(id)).duvida_pelo_servidor, true);

    const naoTirou = await rodar(['conta-ia', id, 'tirar']);
    assert.equal(naoTirou.codigo, 2);
    assert.match(naoTirou.erro, /NÃO TIREI/);
    assert.ok(await contaNoBanco(id));

    // Com o balcão ligado, o comando do contexto diz por que não desligou — e a ordem da volta.
    const naoDesligou = await rodar(['contexto', id, 'desligar']);
    assert.equal(naoDesligou.codigo, 2);
    assert.match(naoDesligou.erro, /NÃO DESLIGUEI/);
    assert.match(naoDesligou.erro, new RegExp(`provisionar -- balcao ${id} desligar`));
    assert.ok(!/NÃO LIGUEI|canais/.test(naoDesligou.erro), 'não é a recusa dos canais sem cena');
    assert.equal((await ver(id)).json().pedidoComContexto, true);

    assert.equal((await rodar(['balcao', id, 'desligar'])).codigo, 0);
    const tirou = await rodar(['conta-ia', id, 'tirar']);
    assert.equal(tirou.codigo, 0, tirou.erro);
    assert.equal(await contaNoBanco(id), undefined);

    for (const args of [['balcao'], ['balcao', id, 'talvez'], ['balcao', id, 'ligar', 'sobra'], ['conta-ia', id], ['teto', id]]) {
      assert.notEqual((await rodar(args)).codigo, 0, args.join(' '));
    }
  });
});
