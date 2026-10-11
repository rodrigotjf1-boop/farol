// =====================================================================
// A base de fichas desce para o agente da loja
// =====================================================================
// "Regem no Farol", fatia 3. A nuvem guarda a base de fichas de cada loja;
// a cópia chega ao computador da loja como as fotos padrão chegam:
//
//   1. a base muda (ou é apagada) → `loja.config_versao` sobe — é o que faz
//      o agente pedir a configuração (migration 038);
//   2. a configuração leva a MARCA da base (`fichas.impressao`), ou nulo;
//   3. o agente compara com a cópia dele e baixa por `GET /v1/agentes/fichas`.
//
// O que atravessa a fronteira está em `contratos/fichas-da-loja.json`, lido
// também pelos testes do agente (`agent/testes/test_fichas.py`).
//
// Do outro lado da leitura está o Regem de teste (um servidor de verdade):
// a base é escrita e apagada pelos caminhos de produção — a leitura, o
// desconectar e o acesso tirado —, não por SQL do teste.
// =====================================================================

import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { cifrar } from '../src/cifra.js';
import { contarBase, impressaoDaBase, lerBase, type Base } from '../src/fichas.js';
import { lerFichasDaLoja, semLeituraEmCurso } from '../src/leitura.js';
import { novoPedido, trocarCodigo, type ConfigDoRegem } from '../src/regem.js';
import { baseDoRegem } from '../src/regem-fichas.js';
import { subirRegemFalso, type Cardapio, type RegemFalso } from './regem-falso.js';

const ler = (nome: string) => JSON.parse(readFileSync(new URL(`../../contratos/${nome}`, import.meta.url), 'utf8'));

const CONTRATO = ler('fichas-da-loja.json') as {
  sabe: string;
  configuracao: { comBase: { fichas: { impressao: string; produtos: number; comFicha: number } }; semBase: { fichas: null } };
  baixar: string;
  resposta: { impressao: string; base: Base };
  semBaseNaNuvem: { status: number; erro: string };
};
const SABERES = ler('o-que-o-agente-sabe.json') as { saberes: Record<string, string>; mudamOQueDesce: string[]; pedido: string };
const AMOSTRA = ler('regem-catalogo-e-fichas.json') as { catalogo: unknown; fichas: unknown };

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-fag-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-fichas-no-agente';
const SENHA = 'uma senha longa o bastante';
const mudo = { warn: () => {}, info: () => {}, error: () => {} };

describe('fichas no agente: o contrato', () => {
  it('a base do exemplo é a que o adaptador tira da resposta de verdade do Regem — com a impressão e a conta dela', () => {
    const doAdaptador = baseDoRegem(AMOSTRA.catalogo, AMOSTRA.fichas);
    assert.deepEqual(CONTRATO.resposta.base, doAdaptador, 'mudou o adaptador ou a amostra: gere o contrato de novo');
    assert.ok(lerBase(CONTRATO.resposta.base), 'é uma base que o Farol lê');
    // No arquivo, as chaves estão na ordem do adaptador: é ela que dá a impressão.
    assert.equal(impressaoDaBase(CONTRATO.resposta.base), CONTRATO.resposta.impressao);
    assert.match(CONTRATO.resposta.impressao, /^[0-9a-f]{64}$/);
    assert.deepEqual(CONTRATO.configuracao.comBase.fichas, { impressao: CONTRATO.resposta.impressao, ...contarBase(doAdaptador) });
    assert.deepEqual(CONTRATO.configuracao.semBase, { fichas: null });
  });

  it('o agente declara que sabe guardar as fichas — e isso não muda o que desce', () => {
    assert.ok(CONTRATO.sabe in SABERES.saberes, 'a palavra está na lista do que o agente declara');
    assert.ok(SABERES.pedido.split('sabe=')[1]!.split(',').includes(CONTRATO.sabe));
    assert.ok(!SABERES.mudamOQueDesce.includes(CONTRATO.sabe), 'a marca da base desce para todo agente');
  });
});

describe('fichas no agente: a base desce', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let falso: RegemFalso;
  let cfg: ConfigDoRegem & { segredo: string; chave: Buffer };
  let adminAntes: string | undefined;
  const minha = { tenantId: '', loja: '', irma: '', dono: '', agente: '' };
  const vizinha = { tenantId: '', loja: '', agente: '' };
  const contas = () => [minha.tenantId, vizinha.tenantId];

  const versaoDe = async (lojaId: string) =>
    (await pool.query('select config_versao from loja where id = $1', [lojaId])).rows[0].config_versao as number;
  const pedir = (caminho: string, token: string) =>
    app.inject({ method: 'GET', url: caminho, headers: { authorization: `Bearer ${token}` } });
  async function configuracao(token: string, caminho = SABERES.pedido) {
    const r = await pedir(caminho, token);
    assert.equal(r.statusCode, 200, r.body);
    return r.json() as { versao: number; fichas: unknown; loja: { id: string } };
  }
  const baixar = (token: string) => pedir(CONTRATO.baixar, token);

  /** Uma loja ligada, com um acesso que vale no Regem de teste. */
  async function ligada(tenantId: string, lojaId: string) {
    const regemLojaId = randomUUID();
    const p = novoPedido();
    const codigo = falso.autorizar({ lojas: [{ id: regemLojaId, nome: 'Loja de lá' }], desafio: p.desafio, redirectUri: cfg.retornoUrl });
    const [l] = await trocarCodigo(cfg, { codigo, verificador: p.verificador });
    const { rows } = await pool.query(
      `insert into regem_loja (tenant_id, loja_id, regem_loja_id, regem_loja_nome, regem_empresa_nome, acesso_cifrado, ligado_em)
       values ($1, $2, $3, 'Loja de lá', 'Empresa de lá', $4, now()) returning id`,
      [tenantId, lojaId, regemLojaId, cifrar(l!.acesso, cfg.chave, `acesso:${tenantId}:${regemLojaId}`)],
    );
    return { id: rows[0].id as string, regemLojaId, acesso: l!.acesso };
  }
  const lerDoRegem = (conexaoId: string) => lerFichasDaLoja(pool, cfg, conexaoId, mudo);
  /** A amostra com uma mudança: o que o Regem passa a responder para uma loja. */
  function mudado(mudar: (c: Cardapio & { produtos: any[] }) => void): Cardapio {
    const c = structuredClone(falso.amostra) as Cardapio & { produtos: any[] };
    mudar(c);
    return c;
  }

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    falso = await subirRegemFalso();
    cfg = {
      apiUrl: falso.url,
      appUrl: 'https://regem.exemplo',
      retornoUrl: 'https://console.exemplo/api/regem/retorno',
      consoleUrl: 'https://console.exemplo',
      segredo: falso.segredo,
      chave: randomBytes(32),
      buscar: fetch,
      prazoMs: 400,
      agente: 'farol-api/teste (+https://monitorfarol.com.br)',
    };
    app = criarApp(pool, { logger: false, regem: cfg });
    await app.ready();

    const daDistribuicao = async (url: string, payload: object) => {
      const r = await app.inject({ method: 'POST', url, headers: { 'x-farol-admin': ADMIN }, payload });
      assert.equal(r.statusCode, 201, r.body);
      return r.json();
    };
    async function loja(nome: string, conta: { tenant: { nome: string } } | { tenantId: string }) {
      const c = await daDistribuicao('/v1/distribuicao/lojas', { ...conta, loja: { nome }, setores: [{ nome: 'Cozinha' }] });
      return { tenantId: c.tenantId as string, lojaId: c.loja.id as string };
    }
    async function agente(lojaId: string, maquina: string) {
      const criado = await daDistribuicao('/v1/distribuicao/agentes', { lojaId, nome: `agente-${maquina}` });
      const ativado = await app.inject({
        method: 'POST',
        url: '/v1/agentes/ativar',
        headers: { authorization: `Bearer ${criado.token}` },
        payload: { fingerprint: `maquina-${marca}-${maquina}`, versao: '0.1.0-loja' },
      });
      assert.equal(ativado.statusCode, 200, ativado.body);
      return criado.token as string;
    }

    const a = await loja('Loja Centro', { tenant: { nome: `${marca}-minha` } });
    Object.assign(minha, { tenantId: a.tenantId, loja: a.lojaId, agente: await agente(a.lojaId, 'a') });
    // Outra loja da MESMA conta: a base de uma não mexe na configuração da outra.
    minha.irma = (await loja('Loja Barra', { tenantId: a.tenantId })).lojaId;
    const b = await loja('Loja Vizinha', { tenant: { nome: `${marca}-vizinha` } });
    Object.assign(vizinha, { tenantId: b.tenantId, loja: b.lojaId, agente: await agente(b.lojaId, 'b') });

    await daDistribuicao('/v1/distribuicao/usuarios', {
      tenantId: minha.tenantId, nome: 'Dono', email: `dono-${marca}@e.com`, senha: SENHA, nivel: 'presidente',
    });
    const login = await app.inject({ method: 'POST', url: '/v1/sessao', payload: { email: `dono-${marca}@e.com`, senha: SENHA } });
    assert.equal(login.statusCode, 200, login.body);
    const bruto = login.headers['set-cookie'];
    minha.dono = (Array.isArray(bruto) ? bruto[0]! : String(bruto)).split(';')[0]!;
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await semLeituraEmCurso();
    await app?.close();
    await falso?.fechar();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  beforeEach(async () => {
    falso.modo = 'normal';
    await semLeituraEmCurso();
    await pool.query('delete from fichas_da_loja where tenant_id = any($1::uuid[])', [contas()]);
    await pool.query('delete from regem_loja where tenant_id = any($1::uuid[])', [contas()]);
  });

  // ───────────────────────── sem base ─────────────────────────

  it('loja sem base: a configuração diz que não tem (nulo, e não a entrada faltando) e não há o que baixar', async () => {
    const c = await configuracao(minha.agente);
    assert.ok('fichas' in c, 'a entrada desce sempre: é o nulo que manda a loja apagar a cópia');
    assert.deepEqual({ fichas: c.fichas }, CONTRATO.configuracao.semBase);

    const r = await baixar(minha.agente);
    assert.equal(r.statusCode, CONTRATO.semBaseNaNuvem.status, r.body);
    assert.equal(r.json().erro, CONTRATO.semBaseNaNuvem.erro);
  });

  // ───────────────────────── a base chega ─────────────────────────

  it('a primeira leitura sobe a versão da configuração UMA vez, a configuração anuncia a base e o agente a baixa — como no contrato', async () => {
    const conexao = await ligada(minha.tenantId, minha.loja);
    const antes = await versaoDe(minha.loja);
    const outrasAntes = [await versaoDe(minha.irma), await versaoDe(vizinha.loja)];

    assert.deepEqual(await lerDoRegem(conexao.id), { desfecho: 'atualizada' });
    assert.equal(await versaoDe(minha.loja), antes + 1, 'o agente fica sabendo pela versão');
    assert.deepEqual([await versaoDe(minha.irma), await versaoDe(vizinha.loja)], outrasAntes, 'só a loja da base — nem a outra loja da mesma conta');

    const c = await configuracao(minha.agente);
    assert.equal(c.versao, antes + 1, 'a versão e a marca da base saem juntas');
    assert.deepEqual({ fichas: c.fichas }, CONTRATO.configuracao.comBase);

    const r = await baixar(minha.agente);
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json(), CONTRATO.resposta, 'o documento inteiro, com a impressão dele');
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.match(String(r.headers['content-type']), /^application\/json/);
  });

  it('a marca da base desce para todo agente — o que não declara nada também a recebe', async () => {
    const conexao = await ligada(minha.tenantId, minha.loja);
    await lerDoRegem(conexao.id);
    for (const caminho of ['/v1/agentes/configuracao', '/v1/agentes/configuracao?sabe=estados', SABERES.pedido]) {
      assert.deepEqual({ fichas: (await configuracao(minha.agente, caminho)).fichas }, CONTRATO.configuracao.comBase, caminho);
    }
  });

  // ───────────────────────── o que sobe a versão, e o que não ─────────────────────────

  it('leitura que não mudou nada não sobe a versão: a loja não puxa configuração à toa', async () => {
    const conexao = await ligada(minha.tenantId, minha.loja);
    await lerDoRegem(conexao.id);
    const antes = await versaoDe(minha.loja);

    assert.deepEqual(await lerDoRegem(conexao.id), { desfecho: 'nada_mudou' });
    assert.equal(await versaoDe(minha.loja), antes);

    // Nem uma escrita na base que não mexe no documento (a mesma impressão).
    const mexidas = await pool.query('update fichas_da_loja set atualizada_em = now(), produtos = produtos where loja_id = $1', [minha.loja]);
    assert.equal(mexidas.rowCount, 1);
    assert.equal(await versaoDe(minha.loja), antes);
  });

  it('o cardápio mudou: a versão sobe de novo, a configuração anuncia a base nova e é ela que desce', async () => {
    const conexao = await ligada(minha.tenantId, minha.loja);
    await lerDoRegem(conexao.id);
    const antes = await versaoDe(minha.loja);
    const anunciadaAntes = (await configuracao(minha.agente)).fichas as { impressao: string };

    falso.cardapio(conexao.regemLojaId, mudado((m) => void (m.produtos.find((p) => p.nome === 'Só da matriz').nome = 'Prato do dia')));
    assert.deepEqual(await lerDoRegem(conexao.id), { desfecho: 'atualizada' });
    assert.equal(await versaoDe(minha.loja), antes + 1);

    // O agente que ainda tem a configuração de antes e pede a base recebe a de AGORA,
    // com a impressão dela: o par sai da mesma linha.
    const r = await baixar(minha.agente);
    const corpo = r.json() as { impressao: string; base: Base };
    assert.notEqual(corpo.impressao, anunciadaAntes.impressao);
    assert.deepEqual(corpo.base.produtos.map((p) => p.nome).sort(), ['Combo da casa', 'Prato do dia', 'Refrigerante lata', 'X-Burger'].sort());

    const c = await configuracao(minha.agente);
    assert.deepEqual(c.fichas, { impressao: corpo.impressao, produtos: 4, comFicha: 1 }, 'e a configuração seguinte confirma');
    assert.equal(c.versao, antes + 1);
  });

  // ───────────────────────── a base sai ─────────────────────────

  it('desconectar apaga a base, sobe a versão e a configuração passa a dizer que a loja não tem', async () => {
    const conexao = await ligada(minha.tenantId, minha.loja);
    await lerDoRegem(conexao.id);
    const antes = await versaoDe(minha.loja);

    const r = await app.inject({ method: 'POST', url: `/v1/regem/lojas/${conexao.id}/desconectar`, headers: { cookie: minha.dono } });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().fichasApagadas, true);

    assert.equal(await versaoDe(minha.loja), antes + 1, 'é por aí que a cópia some do computador da loja');
    const c = await configuracao(minha.agente);
    assert.deepEqual([c.versao, c.fichas], [antes + 1, null]);
    assert.equal((await baixar(minha.agente)).statusCode, 404);
  });

  it('acesso tirado no Regem: a base some, a versão sobe e a loja fica sabendo', async () => {
    const conexao = await ligada(minha.tenantId, minha.loja);
    await lerDoRegem(conexao.id);
    const antes = await versaoDe(minha.loja);

    falso.tirar(conexao.acesso);
    assert.deepEqual(await lerDoRegem(conexao.id), { desfecho: 'acesso_tirado' });

    assert.equal(await versaoDe(minha.loja), antes + 1);
    assert.equal((await configuracao(minha.agente)).fichas, null);
    assert.equal((await baixar(minha.agente)).statusCode, 404);
  });

  it('leitura que falha não mexe na base nem na versão: a loja fica com a cópia que tem', async () => {
    const conexao = await ligada(minha.tenantId, minha.loja);
    await lerDoRegem(conexao.id);
    const antes = await versaoDe(minha.loja);

    falso.modo = 'fora';
    assert.equal((await lerDoRegem(conexao.id)).desfecho, 'falhou');
    assert.equal(await versaoDe(minha.loja), antes);
    assert.deepEqual({ fichas: (await configuracao(minha.agente)).fichas }, CONTRATO.configuracao.comBase);
    assert.deepEqual((await baixar(minha.agente)).json(), CONTRATO.resposta);
  });

  it('apagar a conta leva a base junto, sem erro — a loja já não existe para subir a versão', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/v1/distribuicao/lojas',
      headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome: `${marca}-some` }, loja: { nome: 'Loja que some' }, setores: [{ nome: 'Cozinha' }] },
    });
    assert.equal(r.statusCode, 201, r.body);
    const some = { tenantId: r.json().tenantId as string, loja: r.json().loja.id as string };
    const conexao = await ligada(some.tenantId, some.loja);
    assert.deepEqual(await lerDoRegem(conexao.id), { desfecho: 'atualizada' });

    await pool.query('delete from tenant where id = $1', [some.tenantId]);
    const sobrou = await pool.query('select 1 from fichas_da_loja where loja_id = $1', [some.loja]);
    assert.equal(sobrou.rowCount, 0);
  });

  // ───────────────────────── de quem é a base ─────────────────────────

  it('o token de uma loja só baixa a base DELA', async () => {
    const daMinha = await ligada(minha.tenantId, minha.loja);
    await lerDoRegem(daMinha.id);

    // A vizinha não tem base: o agente dela não vê a da minha.
    assert.equal((await configuracao(vizinha.agente)).fichas, null);
    assert.equal((await baixar(vizinha.agente)).statusCode, 404);

    // E quando tem, é a dela — outro documento, outra impressão.
    const daVizinha = await ligada(vizinha.tenantId, vizinha.loja);
    falso.cardapio(daVizinha.regemLojaId, mudado((m) => void (m.produtos = m.produtos.filter((p) => p.nome === 'Refrigerante lata'))));
    await lerDoRegem(daVizinha.id);

    const dela = (await baixar(vizinha.agente)).json() as { impressao: string; base: Base };
    assert.deepEqual(dela.base.produtos.map((p) => p.nome), ['Refrigerante lata']);
    assert.deepEqual((await configuracao(vizinha.agente)).fichas, { impressao: dela.impressao, produtos: 1, comFicha: 0 });
    assert.deepEqual((await baixar(minha.agente)).json(), CONTRATO.resposta, 'a minha continua a minha');
  });

  it('sem credencial de agente não há base — nem com a sessão de quem é dono da conta', async () => {
    const conexao = await ligada(minha.tenantId, minha.loja);
    await lerDoRegem(conexao.id);

    const semNada = await app.inject({ method: 'GET', url: CONTRATO.baixar });
    assert.equal(semNada.statusCode, 401, semNada.body);
    const tokenErrado = await baixar('token-que-nao-existe');
    assert.equal(tokenErrado.statusCode, 401, tokenErrado.body);
    const comSessao = await app.inject({ method: 'GET', url: CONTRATO.baixar, headers: { cookie: minha.dono } });
    assert.equal(comSessao.statusCode, 401, comSessao.body);
    for (const r of [semNada, tokenErrado, comSessao]) assert.ok(!r.body.includes('produtos'), 'e nada da base vaza na recusa');
  });
});
