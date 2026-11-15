// A conexão com o Regem pelo CLIQUE do Padrão DMS (F6 do Hub DMS, plano
// "Clique Farol → Regem", 15/11/2026; migration 063).
//
// Do outro lado está o Regem de mentira (`regem-falso.ts`), com o DMS ID de
// mentira no mesmo servidor. O que se protege aqui:
//
//   • a ida empurra o pedido ao Regem com o token do DMS ID e manda o
//     navegador à página de lá; sem a chave do clique, segue a página de 01/10;
//   • a volta do clique só vale com o `iss` do Regem (RFC 9207), uma vez;
//   • a troca guarda a LIGAÇÃO de cada loja, cifrada, e a leitura vai por ela;
//   • a loja que já era pela chave antiga mantém a loja do Farol e troca de via;
//   • pela ligação, o token do DMS ID recusado é do aplicativo (a loja não
//     perde as fichas); só a ligação que não vale é da loja.

import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { decifrar } from '../src/cifra.js';
import { lerFichasDaLoja, semLeituraEmCurso } from '../src/leitura.js';
import { configDoRegem, contextoDoAcesso, motivoDoCliqueDesligado, viaDoDmsId, type ConfigDoRegem } from '../src/regem.js';
import { subirRegemFalso, type LojaDeLa, type RegemFalso } from './regem-falso.js';

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-rgmclq-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-regem-clique';
const SENHA = 'uma senha longa o bastante';
const CONSOLE = 'https://console.exemplo';
const RETORNO = `${CONSOLE}/api/regem/retorno`;
const mudo = { warn: () => {}, info: () => {}, error: () => {} };
/** O aplicativo do Farol no DMS ID, para a configuração (nome neutro: não é segredo de verdade). */
const VALOR_DE_TESTE = 'valor-de-teste-do-aplicativo-farol';

describe('regem: a configuração do clique', () => {
  it('nasce desligado; liga só com a chave E as três variáveis do DMS ID; a chave ligada sem elas diz o motivo', () => {
    assert.equal(configDoRegem({}).clique, false);
    assert.equal(configDoRegem({}).dmsId, null);
    const dms = { DMS_ID_EMISSOR: 'https://id.exemplo/oidc/', DMS_ID_APLICATIVO: 'app-farol', DMS_ID_SEGREDO: VALOR_DE_TESTE };
    // Sem a chave, o botão segue na página de 01/10, mas a loja que já é pela ligação continua sendo lida.
    assert.equal(configDoRegem(dms).clique, false);
    assert.ok(configDoRegem(dms).dmsId);
    for (const v of ['true', '1', 'sim', ' TRUE ']) assert.equal(configDoRegem({ ...dms, FAROL_REGEM_CLIQUE: v }).clique, true, v);
    assert.equal(configDoRegem({ ...dms, FAROL_REGEM_CLIQUE: 'talvez' }).clique, false);
    const ligado = configDoRegem({ ...dms, FAROL_REGEM_CLIQUE: 'true' });
    assert.equal(ligado.dmsId!.recurso, 'https://api.dmsregem.com/api/v1/integracao');
    assert.equal(ligado.dmsId!.emissorDoRegem, 'https://api.dmsregem.com');
    assert.equal(ligado.dmsId!.aplicativo, 'app-farol');
    assert.equal(motivoDoCliqueDesligado({ ...dms, FAROL_REGEM_CLIQUE: 'true' }, ligado), null);
    const torto = { FAROL_REGEM_CLIQUE: 'sim', DMS_ID_EMISSOR: 'https://id.exemplo/oidc' };
    assert.equal(configDoRegem(torto).clique, false);
    assert.match(motivoDoCliqueDesligado(torto, configDoRegem(torto)) ?? '', /DMS_ID_SEGREDO/);
    assert.equal(motivoDoCliqueDesligado({}, configDoRegem({})), null);
  });
});

describe('regem: a conexão pelo clique do Padrão DMS', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let falso: RegemFalso;
  let cfg: ConfigDoRegem & { chave: Buffer };
  let app: FastifyInstance;
  /** A mesma API, sem a chave do clique: a página de 01/10. */
  let appSemClique: FastifyInstance;
  let adminAntes: string | undefined;
  const minha = { tenantId: '', nome: `${marca}-minha`, centro: '', barra: '', dono: '', donoEmail: `dono-${marca}@e.com` };

  async function criarLoja(nome: string, conta: { tenantId: string } | { tenant: { nome: string } }) {
    const r = await app.inject({
      method: 'POST',
      url: '/v1/distribuicao/lojas',
      headers: { 'x-farol-admin': ADMIN },
      payload: { ...conta, loja: { nome }, setores: [{ nome: 'Cozinha' }] },
    });
    assert.equal(r.statusCode, 201, r.body);
    const c = r.json();
    return { tenantId: c.tenantId as string, lojaId: c.loja.id as string };
  }

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    falso = await subirRegemFalso();
    cfg = {
      apiUrl: falso.url,
      appUrl: 'https://regem.exemplo',
      retornoUrl: RETORNO,
      consoleUrl: CONSOLE,
      segredo: falso.segredo,
      chave: randomBytes(32),
      buscar: fetch,
      prazoMs: 2000,
      agente: 'farol-api/teste (+https://monitorfarol.com.br)',
      dmsId: viaDoDmsId({ DMS_ID_EMISSOR: falso.dmsId.emissor, DMS_ID_APLICATIVO: falso.dmsId.aplicativo, DMS_ID_SEGREDO: falso.dmsId.segredo }, falso.url),
      clique: true,
    };
    assert.ok(cfg.dmsId, 'a via do DMS ID montou');
    app = criarApp(pool, { logger: false, regem: cfg });
    appSemClique = criarApp(pool, { logger: false, regem: { ...cfg, clique: false } });
    await Promise.all([app.ready(), appSemClique.ready()]);

    const centro = await criarLoja('Loja Centro', { tenant: { nome: minha.nome } });
    minha.tenantId = centro.tenantId;
    minha.centro = centro.lojaId;
    minha.barra = (await criarLoja('Loja Barra', { tenantId: minha.tenantId })).lojaId;
    const u = await app.inject({
      method: 'POST',
      url: '/v1/distribuicao/usuarios',
      headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId: minha.tenantId, nome: 'Pessoa dono', email: minha.donoEmail, senha: SENHA, nivel: 'presidente' },
    });
    assert.equal(u.statusCode, 201, u.body);
    const login = await app.inject({ method: 'POST', url: '/v1/sessao', payload: { email: minha.donoEmail, senha: SENHA } });
    assert.equal(login.statusCode, 200, login.body);
    const bruto = login.headers['set-cookie'];
    minha.dono = (Array.isArray(bruto) ? bruto[0]! : String(bruto)).split(';')[0]!;
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await semLeituraEmCurso();
    await Promise.all([app?.close(), appSemClique?.close()]);
    await falso?.fechar();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  beforeEach(async () => {
    falso.modo = 'normal';
    falso.dmsId.recusarTokens = false;
    await semLeituraEmCurso();
    falso.chamadas.length = 0;
    falso.pedidosDoClique.length = 0;
    falso.pelaLigacao.length = 0;
    await pool.query('delete from fichas_da_loja where tenant_id = $1', [minha.tenantId]);
    await pool.query('delete from regem_loja where tenant_id = $1', [minha.tenantId]);
    await pool.query('delete from regem_pedido where tenant_id = $1', [minha.tenantId]);
  });

  // ───────────────────────── os atalhos ─────────────────────────

  const lojasDeLa = (): [LojaDeLa, LojaDeLa] => [
    { id: randomUUID(), nome: 'Casa do Lanche · Centro' },
    { id: randomUUID(), nome: 'Casa do Lanche · Barra' },
  ];
  const issDoRegem = () => new URL(falso.url).origin;

  async function ida(a: FastifyInstance = app) {
    const r = await a.inject({ method: 'POST', url: '/v1/regem/conectar', headers: { cookie: minha.dono } });
    assert.equal(r.statusCode, 200, r.body);
    return new URL(r.json().url);
  }

  async function volta(params: Record<string, string>, a: FastifyInstance = app) {
    const r = await a.inject({ method: 'GET', url: `/v1/regem/retorno?${new URLSearchParams(params)}`, headers: { cookie: minha.dono } });
    assert.equal(r.statusCode, 303, r.body);
    const destino = new URL(String(r.headers.location));
    assert.equal(destino.origin + destino.pathname, `${CONSOLE}/conexoes`);
    return destino.searchParams.get('regem');
  }

  /** Pelo clique, de ponta a ponta: a ida, o presidente autoriza lá, a volta com o `iss` do Regem. */
  async function autorizarPeloClique(lojas: LojaDeLa[]) {
    const u = await ida();
    const code = falso.autorizarPeloClique({ numero: u.searchParams.get('request_uri')!, lojas });
    const state = falso.pedidosDoClique.at(-1)!.corpo.state as string;
    assert.equal(await volta({ code, state, iss: issDoRegem() }), 'autorizado');
  }

  type Guardada = { id: string; loja_id: string | null; regem_loja_id: string; regem_loja_nome: string; acesso_cifrado: string };
  const guardadas = async (): Promise<Guardada[]> =>
    (
      await pool.query<Guardada>('select id, loja_id, regem_loja_id, regem_loja_nome, acesso_cifrado from regem_loja where tenant_id = $1 order by regem_loja_nome', [
        minha.tenantId,
      ])
    ).rows;
  const acessoDe = (g: Guardada) => decifrar(g.acesso_cifrado, cfg.chave, contextoDoAcesso(minha.tenantId, g.regem_loja_id));
  const esperando = async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/regem', headers: { cookie: minha.dono } });
    assert.equal(r.statusCode, 200, r.body);
    return r.json().esperando as Array<{ id: string; regemLojaNome: string }>;
  };
  const ligar = (pares: unknown) => app.inject({ method: 'PUT', url: '/v1/regem/lojas', headers: { cookie: minha.dono }, payload: { pares } });
  const fichasDoRegem = async (lojaId: string) =>
    (await pool.query<{ n: number }>("select count(*)::int as n from fichas_da_loja where loja_id = $1 and fonte = 'regem'", [lojaId])).rows[0]!.n;

  // ───────────────────────── a ida ─────────────────────────

  it('a ida empurra o pedido ao Regem com o token do DMS ID e manda à página de lá; sem a chave do clique, a página de 01/10', async () => {
    const u = await ida();
    assert.equal(u.origin + u.pathname, 'https://regem.exemplo/integracoes/autorizar');
    // Na barra de endereço, só quem pede e o número: nem `state`, nem desafio, nem permissão.
    assert.deepEqual([...u.searchParams.keys()].sort(), ['client_id', 'request_uri']);
    assert.equal(u.searchParams.get('client_id'), falso.dmsId.aplicativo);
    assert.equal(falso.pedidosDoClique.length, 1);
    const p = falso.pedidosDoClique[0]!;
    assert.equal(u.searchParams.get('request_uri'), p.numero);
    const { state, code_challenge, ...resto } = p.corpo;
    assert.match(String(state), /^[A-Za-z0-9_-]{43}$/);
    assert.match(String(code_challenge), /^[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(resto, {
      response_type: 'code',
      redirect_uri: RETORNO,
      scope: 'catalogo.ler fichas.ler producao.ler',
      code_challenge_method: 'S256',
      conta_nome: minha.nome,
      conta_email: minha.donoEmail,
    });
    // O pedido foi pelo token do DMS ID (o Regem de mentira recusa sem ele) e fica guardado como do clique.
    assert.deepEqual((await pool.query('select via from regem_pedido where tenant_id = $1', [minha.tenantId])).rows, [{ via: 'clique' }]);

    const antiga = await ida(appSemClique);
    assert.equal(antiga.origin + antiga.pathname, 'https://regem.exemplo/integracoes/autorizar');
    assert.equal(antiga.searchParams.get('cliente'), 'farol');
    assert.deepEqual((await pool.query('select via from regem_pedido where tenant_id = $1', [minha.tenantId])).rows, [{ via: 'chave' }]);
  });

  it('o Regem que não reconhece o aplicativo do Farol: a ida responde 502, sem página', async () => {
    falso.dmsId.recusarTokens = true;
    const r = await app.inject({ method: 'POST', url: '/v1/regem/conectar', headers: { cookie: minha.dono } });
    assert.equal(r.statusCode, 502, r.body);
    assert.equal(r.json().erro, 'regem_indisponivel');
  });

  // ───────────────────────── a volta ─────────────────────────

  it('a volta do clique sem o iss do Regem, ou com outro, não vale e gasta o pedido: nada é trocado nem guardado', async () => {
    for (const iss of [null, 'https://outro.exemplo', `${issDoRegem()}/`]) {
      const u = await ida();
      const code = falso.autorizarPeloClique({ numero: u.searchParams.get('request_uri')!, lojas: lojasDeLa() });
      const state = falso.pedidosDoClique.at(-1)!.corpo.state as string;
      assert.equal(await volta({ code, state, ...(iss === null ? {} : { iss }) }), 'invalido', String(iss));
      // O pedido foi gasto: a mesma volta, agora com o `iss` certo, também não serve.
      assert.equal(await volta({ code, state, iss: issDoRegem() }), 'invalido');
    }
    assert.deepEqual(await guardadas(), []);
    assert.equal(falso.chamadas.filter((c) => c.caminho === '/integracao/autorizacao/token').length, 0);
  });

  it('de ponta a ponta: a troca pelo token do DMS ID guarda a ligação de cada loja, cifrada; ligar lê as fichas pela ligação', async () => {
    const [c, b] = lojasDeLa();
    await autorizarPeloClique([c, b]);
    const gs = await guardadas();
    assert.equal(gs.length, 2);
    for (const g of gs) {
      const acesso = acessoDe(g);
      assert.ok(acesso && /^dms_lg_regem_/.test(acesso), 'a ligação');
      assert.ok(falso.vale(acesso), 'que vale lá');
      assert.ok(!g.acesso_cifrado.includes(acesso), 'e fica cifrada');
    }
    // A troca foi pelo token do DMS ID, sem o segredo da página de 01/10 no corpo.
    const troca = falso.chamadas.find((x) => x.caminho === '/integracao/autorizacao/token')!;
    assert.equal(troca.comAcesso, true);
    assert.equal(troca.corpo?.client_secret, undefined);
    assert.equal(troca.corpo?.grant_type, 'authorization_code');

    const centro = (await esperando()).find((e) => e.regemLojaNome === c.nome)!;
    const r = await ligar([{ id: centro.id, lojaId: minha.centro }]);
    assert.equal(r.statusCode, 200, r.body);
    await semLeituraEmCurso();
    assert.ok(falso.pelaLigacao.includes('/integracao/fichas'), falso.pelaLigacao.join(','));
    assert.ok(falso.pelaLigacao.includes('/integracao/catalogo'), falso.pelaLigacao.join(','));
    assert.equal(await fichasDoRegem(minha.centro), 1);
  });

  it('a loja ligada pela página de 01/10: conectar pelo clique mantém a loja do Farol e troca para a ligação; a chave antiga para', async () => {
    const [c] = lojasDeLa();
    const u = await ida(appSemClique);
    const code = falso.autorizar({ lojas: [c], desafio: u.searchParams.get('code_challenge')!, redirectUri: RETORNO });
    assert.equal(await volta({ code, state: u.searchParams.get('state')! }, appSemClique), 'autorizado');
    const [espera] = await esperando();
    assert.equal((await ligar([{ id: espera!.id, lojaId: minha.centro }])).statusCode, 200);
    await semLeituraEmCurso();
    const [antes] = await guardadas();
    const chaveAntiga = acessoDe(antes!)!;
    assert.match(chaveAntiga, /^rgm_it_/);

    await autorizarPeloClique([c]);
    const [depois] = await guardadas();
    assert.equal(depois!.id, antes!.id);
    assert.equal(depois!.loja_id, minha.centro, 'a loja do Farol continua ligada');
    assert.match(acessoDe(depois!)!, /^dms_lg_regem_/);
    assert.equal(falso.vale(chaveAntiga), false, 'a chave antiga parou de valer lá');
    await semLeituraEmCurso();
    assert.ok(falso.pelaLigacao.includes('/integracao/fichas'), 'a loja já ligada voltou a ser lida, pela ligação');
  });

  // ───────────────────────── de quem é a recusa ─────────────────────────

  it('pela ligação, o token do DMS ID recusado é do aplicativo: a loja não perde as fichas; a ligação tirada lá é da loja', async () => {
    const [c] = lojasDeLa();
    await autorizarPeloClique([c]);
    const [espera] = await esperando();
    assert.equal((await ligar([{ id: espera!.id, lojaId: minha.centro }])).statusCode, 200);
    await semLeituraEmCurso();
    assert.equal(await fichasDoRegem(minha.centro), 1);

    falso.dmsId.recusarTokens = true;
    assert.deepEqual(await lerFichasDaLoja(pool, cfg, espera!.id, mudo), { desfecho: 'falhou', falha: 'sem_resposta' });
    const linha = (await pool.query('select acesso_tirado_em from regem_loja where id = $1', [espera!.id])).rows[0];
    assert.equal(linha.acesso_tirado_em, null, 'não é "acesso tirado"');
    assert.equal(await fichasDoRegem(minha.centro), 1, 'as fichas ficam');

    falso.dmsId.recusarTokens = false;
    falso.tirarDaLoja(c.id);
    assert.deepEqual(await lerFichasDaLoja(pool, cfg, espera!.id, mudo), { desfecho: 'acesso_tirado' });
    assert.equal(await fichasDoRegem(minha.centro), 0);
  });
});
