// A conexão da conta com o Regem: conectar, voltar, ligar as lojas e
// desconectar.
//
// Do outro lado está um servidor de verdade (`regem-falso.ts`), que recusa
// o que o Regem recusa. O que se protege aqui:
//
//   • só a diretoria conecta, liga e desconecta — nem o suporte;
//   • a volta só vale para quem começou, uma vez, dentro do prazo;
//   • o acesso de cada loja fica guardado de um jeito que dá para usar, e
//     não aparece em resposta nem em registro;
//   • uma conta não enxerga nem mexe na conexão da outra.

import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { decifrar } from '../src/cifra.js';
import { semLeituraEmCurso } from '../src/leitura.js';
import type { ConfigDoRegem } from '../src/regem.js';
import { VALIDADE_DO_PEDIDO_MIN } from '../src/rotas/regem.js';
import { subirRegemFalso, type LojaDeLa, type RegemFalso } from './regem-falso.js';

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-rgm-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-regem';
const SENHA = 'uma senha longa o bastante';
const CONSOLE = 'https://console.exemplo';
const RETORNO = `${CONSOLE}/api/regem/retorno`;

describe('regem: a conexão da conta', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let falso: RegemFalso;
  let cfg: ConfigDoRegem & { segredo: string; chave: Buffer };
  let app: FastifyInstance;
  /** A mesma API, numa instalação em que o ambiente não tem o segredo. */
  let appSemAmbiente: FastifyInstance;
  /** A mesma API, com OUTRA chave: o que está guardado não dá para ler. */
  let appOutraChave: FastifyInstance;
  /** A mesma API, com um segredo que não é o do Regem. */
  let appOutroSegredo: FastifyInstance;
  let adminAntes: string | undefined;

  const minha = { tenantId: '', centro: '', barra: '', dono: '', socio: '', gerente: '', suporte: '', supervisao: '', execucao: '' };
  const vizinha = { tenantId: '', loja: '', dono: '' };

  async function criarUsuario(tenantId: string, apelido: string, nivel: string) {
    const email = `${apelido}-${marca}@e.com`;
    const r = await app.inject({
      method: 'POST',
      url: '/v1/distribuicao/usuarios',
      headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId, nome: `Pessoa ${apelido}`, email, senha: SENHA, nivel },
    });
    assert.equal(r.statusCode, 201, r.body);
    const login = await app.inject({ method: 'POST', url: '/v1/sessao', payload: { email, senha: SENHA } });
    assert.equal(login.statusCode, 200, login.body);
    const bruto = login.headers['set-cookie'];
    return (Array.isArray(bruto) ? bruto[0]! : String(bruto)).split(';')[0]!;
  }

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
      prazoMs: 400,
      agente: 'farol-api/teste (+https://monitorfarol.com.br)',
    };
    app = criarApp(pool, { logger: false, regem: cfg });
    appSemAmbiente = criarApp(pool, { logger: false, regem: { ...cfg, segredo: null } });
    appOutraChave = criarApp(pool, { logger: false, regem: { ...cfg, chave: randomBytes(32) } });
    appOutroSegredo = criarApp(pool, { logger: false, regem: { ...cfg, segredo: 'um-segredo-que-nao-e-o-do-regem-000000' } });
    await Promise.all([app.ready(), appSemAmbiente.ready(), appOutraChave.ready(), appOutroSegredo.ready()]);

    // Duas lojas na minha conta (V27: com uma só, nada se mistura) e uma na vizinha.
    const centro = await criarLoja('Loja Centro', { tenant: { nome: `${marca}-minha` } });
    minha.tenantId = centro.tenantId;
    minha.centro = centro.lojaId;
    minha.barra = (await criarLoja('Loja Barra', { tenantId: minha.tenantId })).lojaId;
    const outra = await criarLoja('Loja Centro', { tenant: { nome: `${marca}-vizinha` } });
    vizinha.tenantId = outra.tenantId;
    vizinha.loja = outra.lojaId;

    minha.dono = await criarUsuario(minha.tenantId, 'dono', 'presidente');
    minha.socio = await criarUsuario(minha.tenantId, 'socio', 'presidente');
    minha.gerente = await criarUsuario(minha.tenantId, 'gerente', 'gerente');
    minha.suporte = await criarUsuario(minha.tenantId, 'suporte', 'suporte');
    minha.supervisao = await criarUsuario(minha.tenantId, 'supervisao', 'supervisao');
    minha.execucao = await criarUsuario(minha.tenantId, 'execucao', 'execucao');
    vizinha.dono = await criarUsuario(vizinha.tenantId, 'vizinho', 'presidente');
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await semLeituraEmCurso();
    await Promise.all([app?.close(), appSemAmbiente?.close(), appOutraChave?.close(), appOutroSegredo?.close()]);
    await falso?.fechar();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  // Cada teste começa sem conexão nenhuma — só nas DUAS contas deste
  // arquivo (V93: os outros arquivos rodam ao mesmo tempo, no mesmo banco).
  beforeEach(async () => {
    // Ligar uma loja dispara a leitura das fichas em segundo plano: a do
    // teste anterior termina antes de este começar a contar chamadas.
    falso.modo = 'normal';
    await semLeituraEmCurso();
    falso.chamadas.length = 0;
    await pool.query('delete from fichas_da_loja where tenant_id = any($1::uuid[])', [[minha.tenantId, vizinha.tenantId]]);
    await pool.query('delete from regem_loja where tenant_id = any($1::uuid[])', [[minha.tenantId, vizinha.tenantId]]);
    await pool.query('delete from regem_pedido where tenant_id = any($1::uuid[])', [[minha.tenantId, vizinha.tenantId]]);
  });

  // ───────────────────────── os atalhos ─────────────────────────

  const lojasDeLa = (): [LojaDeLa, LojaDeLa] => [
    { id: randomUUID(), nome: 'Casa do Lanche · Centro' },
    { id: randomUUID(), nome: 'Casa do Lanche · Barra' },
  ];

  async function ida(cookie: string, a: FastifyInstance = app) {
    const r = await a.inject({ method: 'POST', url: '/v1/regem/conectar', headers: { cookie } });
    assert.equal(r.statusCode, 200, r.body);
    const url = new URL(r.json().url);
    return { url, state: url.searchParams.get('state')!, desafio: url.searchParams.get('code_challenge')! };
  }

  async function volta(cookie: string | null, params: Record<string, string>, a: FastifyInstance = app) {
    const r = await a.inject({
      method: 'GET',
      url: `/v1/regem/retorno?${new URLSearchParams(params)}`,
      headers: cookie ? { cookie } : {},
    });
    assert.equal(r.statusCode, 303, r.body);
    const destino = new URL(String(r.headers.location));
    assert.equal(destino.origin + destino.pathname, `${CONSOLE}/conexoes`, 'a volta sempre termina no console');
    assert.deepEqual([...destino.searchParams.keys()], ['regem'], 'e leva só o desfecho — nem código, nem state');
    return { r, desfecho: destino.searchParams.get('regem') };
  }

  /** O caminho inteiro: pede, o presidente autoriza lá, volta. */
  async function autorizar(cookie: string, lojas: LojaDeLa[], empresa = 'Casa do Lanche Alimentação Ltda') {
    const p = await ida(cookie);
    const code = falso.autorizar({ lojas, desafio: p.desafio, redirectUri: RETORNO, empresa });
    const v = await volta(cookie, { code, state: p.state });
    assert.equal(v.desfecho, 'autorizado');
    return { ...p, code };
  }

  type Tela = {
    disponivel: boolean;
    podeConectar: boolean;
    lojasLivres: Array<{ id: string; nome: string }>;
    esperando: Array<{ id: string; regemLojaNome: string; regemEmpresaNome: string; autorizadaEm: string; sugestaoLojaId: string | null }>;
    ligadas: Array<{ id: string; lojaId: string; lojaNome: string; regemLojaNome: string; regemEmpresaNome: string; ligadaEm: string }>;
  };
  async function tela(cookie: string, a: FastifyInstance = app): Promise<Tela> {
    const r = await a.inject({ method: 'GET', url: '/v1/regem', headers: { cookie } });
    assert.equal(r.statusCode, 200, r.body);
    return r.json();
  }

  const ligar = (cookie: string, pares: unknown, a: FastifyInstance = app) =>
    a.inject({ method: 'PUT', url: '/v1/regem/lojas', headers: { cookie }, payload: { pares } });

  const desconectar = (cookie: string, id: string, a: FastifyInstance = app) =>
    a.inject({ method: 'POST', url: `/v1/regem/lojas/${id}/desconectar`, headers: { cookie } });

  type Guardada = { id: string; loja_id: string | null; regem_loja_id: string; regem_loja_nome: string; acesso_cifrado: string; conectado_por: string | null };
  async function guardadas(tenantId = minha.tenantId): Promise<Guardada[]> {
    const { rows } = await pool.query(
      'select id, loja_id, regem_loja_id, regem_loja_nome, acesso_cifrado, conectado_por from regem_loja where tenant_id = $1 order by regem_loja_nome',
      [tenantId],
    );
    return rows;
  }
  /** O acesso que está guardado, lido de volta com a chave do ambiente. */
  const acessoDe = (g: Guardada, tenantId = minha.tenantId) => decifrar(g.acesso_cifrado, cfg.chave, `acesso:${tenantId}:${g.regem_loja_id}`);
  const pedidosDe = async (tenantId = minha.tenantId) => (await pool.query('select * from regem_pedido where tenant_id = $1', [tenantId])).rows;
  const idDe = (t: Tela, nome: string) => t.esperando.find((e) => e.regemLojaNome === nome)!.id;

  /** Duas lojas autorizadas e ligadas: Centro com Centro, Barra com Barra. */
  async function conectado() {
    const [c, b] = lojasDeLa();
    await autorizar(minha.dono, [c, b]);
    const t = await tela(minha.dono);
    const r = await ligar(minha.dono, [
      { id: idDe(t, c.nome), lojaId: minha.centro },
      { id: idDe(t, b.nome), lojaId: minha.barra },
    ]);
    assert.equal(r.statusCode, 200, r.body);
    // A leitura das fichas que o ligar disparou termina antes: daqui para a
    // frente, as chamadas ao Regem são só as do teste.
    await semLeituraEmCurso();
    falso.chamadas.length = 0;
    return { c, b, t: await tela(minha.dono) };
  }

  // ───────────────────────── quem pode ─────────────────────────

  it('sem sessão, nada: as rotas respondem 401 e a volta manda entrar', async () => {
    const rotas: Array<[string, string]> = [
      ['GET', '/v1/regem'],
      ['POST', '/v1/regem/conectar'],
      ['PUT', '/v1/regem/lojas'],
      ['POST', `/v1/regem/lojas/${randomUUID()}/desconectar`],
    ];
    for (const [method, url] of rotas) {
      const r = await app.inject({ method: method as 'GET', url, ...(method === 'PUT' ? { payload: { pares: [] } } : {}) });
      assert.equal(r.statusCode, 401, `${method} ${url}`);
      assert.equal(r.json().erro, 'sem_sessao');
    }
    assert.equal((await volta(null, { code: 'x'.repeat(20), state: 'y'.repeat(30) })).desfecho, 'sem_sessao');
  });

  it('ver a conexão: gerente para cima e o suporte; supervisão e execução, não', async () => {
    for (const cookie of [minha.supervisao, minha.execucao]) {
      const r = await app.inject({ method: 'GET', url: '/v1/regem', headers: { cookie } });
      assert.equal(r.statusCode, 403);
      assert.equal(r.json().erro, 'sem_permissao');
      assert.deepEqual(Object.keys(r.json()).sort(), ['erro', 'mensagem'], 'a recusa não leva dado nenhum');
    }
    assert.equal((await tela(minha.dono)).podeConectar, true);
    assert.equal((await tela(minha.gerente)).podeConectar, false);
    assert.equal((await tela(minha.suporte)).podeConectar, false);
  });

  it('conectar, ligar e desconectar: só a diretoria — nem o gerente, nem o suporte', async () => {
    const { t } = await conectado();
    const alvo = t.ligadas[0]!.id;
    for (const cookie of [minha.gerente, minha.suporte, minha.supervisao, minha.execucao]) {
      const tentativas = [
        await app.inject({ method: 'POST', url: '/v1/regem/conectar', headers: { cookie } }),
        await ligar(cookie, [{ id: alvo, lojaId: minha.centro }]),
        await desconectar(cookie, alvo),
      ];
      for (const r of tentativas) {
        assert.equal(r.statusCode, 403, r.body);
        assert.equal(r.json().erro, 'so_diretoria');
      }
    }
    assert.equal((await pedidosDe()).filter((p) => p.usado_em === null).length, 0, 'nenhum pedido nasceu das recusas');
    assert.equal((await guardadas()).length, 2, 'e nada foi desconectado');
    assert.equal(falso.chamadas.length, 0, 'o Regem nem foi chamado');
  });

  it('instalação sem o segredo no ambiente: a tela sabe, e conectar responde 503 sem criar pedido', async () => {
    const t = await tela(minha.dono, appSemAmbiente);
    assert.equal(t.disponivel, false);
    assert.equal((await tela(minha.dono)).disponivel, true);

    const r = await appSemAmbiente.inject({ method: 'POST', url: '/v1/regem/conectar', headers: { cookie: minha.dono } });
    assert.equal(r.statusCode, 503);
    assert.equal(r.json().erro, 'conexao_indisponivel');
    assert.equal((await pedidosDe()).length, 0);
  });

  // ───────────────────────── a ida ─────────────────────────

  it('conectar devolve o endereço da autorização do Regem, e guarda só a impressão do state', async () => {
    const p = await ida(minha.dono);
    assert.equal(p.url.origin + p.url.pathname, 'https://regem.exemplo/integracoes/autorizar');
    assert.equal(p.url.searchParams.get('cliente'), 'farol');
    assert.equal(p.url.searchParams.get('redirect_uri'), RETORNO);
    assert.equal(p.url.searchParams.get('code_challenge_method'), 'S256');

    const pedidos = await pedidosDe();
    assert.equal(pedidos.length, 1);
    const g = pedidos[0];
    assert.equal(g.estado_hash, createHash('sha256').update(p.state).digest('hex'));
    assert.ok(!JSON.stringify(g).includes(p.state), 'o state em si não fica no banco');
    assert.match(g.verificador_cifrado, /^v1\./, 'o verificador fica cifrado');
    assert.equal(g.usado_em, null);
    const minutos = (new Date(g.expira_em).getTime() - new Date(g.criado_em).getTime()) / 60_000;
    // Dez, escrito aqui e não lido da constante: é o tempo que o código do
    // Regem vale. Pedido que durasse mais esperaria uma volta que já não troca.
    assert.equal(VALIDADE_DO_PEDIDO_MIN, 10);
    assert.ok(Math.abs(minutos - 10) < 0.1, `vale 10 minutos (${minutos})`);
  });

  it('um pedido em curso por pessoa: pedir de novo derruba o anterior, e não o do sócio', async () => {
    const [c] = lojasDeLa();
    const doSocio = await ida(minha.socio);
    const primeiro = await ida(minha.dono);
    const segundo = await ida(minha.dono);
    assert.equal((await pedidosDe()).length, 2, 'o do sócio e o segundo do dono');

    const code1 = falso.autorizar({ lojas: [c], desafio: primeiro.desafio, redirectUri: RETORNO });
    assert.equal((await volta(minha.dono, { code: code1, state: primeiro.state })).desfecho, 'invalido');
    const code2 = falso.autorizar({ lojas: [c], desafio: segundo.desafio, redirectUri: RETORNO });
    assert.equal((await volta(minha.dono, { code: code2, state: segundo.state })).desfecho, 'autorizado');
    const code3 = falso.autorizar({ lojas: [c], desafio: doSocio.desafio, redirectUri: RETORNO });
    assert.equal((await volta(minha.socio, { code: code3, state: doSocio.state })).desfecho, 'autorizado');
  });

  it('pedir de novo limpa os pedidos vencidos — e só os vencidos', async () => {
    await ida(minha.socio);
    const doVizinho = await ida(vizinha.dono);
    await pool.query("update regem_pedido set expira_em = now() - interval '1 minute' where tenant_id = $1", [minha.tenantId]);

    await ida(minha.dono);
    const meus = await pedidosDe();
    assert.equal(meus.length, 1, 'o vencido do sócio saiu; ficou o novo do dono');
    assert.ok(new Date(meus[0].expira_em) > new Date());
    assert.equal((await pedidosDe(vizinha.tenantId)).length, 1, 'o do vizinho, de pé, não foi tocado');
    assert.equal((await volta(vizinha.dono, { error: 'access_denied', state: doVizinho.state })).desfecho, 'cancelado');
  });

  // ───────────────────────── a volta ─────────────────────────

  it('a volta guarda um acesso por loja — cifrado, utilizável, e fora de toda resposta', async () => {
    const [c, b] = lojasDeLa();
    const p = await ida(minha.dono);
    const code = falso.autorizar({ lojas: [c, b], desafio: p.desafio, redirectUri: RETORNO });
    const { r, desfecho } = await volta(minha.dono, { code, state: p.state });

    assert.equal(desfecho, 'autorizado');
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal(r.headers['referrer-policy'], 'no-referrer');

    const g = await guardadas();
    assert.deepEqual(g.map((x) => x.regem_loja_nome), ['Casa do Lanche · Barra', 'Casa do Lanche · Centro']);
    assert.deepEqual(g.map((x) => x.regem_loja_id).sort(), [c.id, b.id].sort());
    assert.ok(g.every((x) => x.loja_id === null), 'ainda sem loja do Farol');
    assert.ok(g.every((x) => x.conectado_por !== null));
    for (const x of g) {
      assert.match(x.acesso_cifrado, /^v1\./);
      const acesso = acessoDe(x);
      assert.ok(acesso && falso.vale(acesso), 'o que está guardado, lido de volta, é o acesso que vale no Regem');
      assert.ok(!x.acesso_cifrado.includes(acesso), 'e não está em claro');
    }
    assert.notEqual(acessoDe(g[0]!), acessoDe(g[1]!));

    // Nenhuma resposta que a tela recebe traz o acesso, nem o texto cifrado.
    const respostas = [
      (await app.inject({ method: 'GET', url: '/v1/regem', headers: { cookie: minha.dono } })).body,
      (await app.inject({ method: 'GET', url: '/v1/regem', headers: { cookie: minha.gerente } })).body,
      (await app.inject({ method: 'GET', url: '/v1/lojas', headers: { cookie: minha.dono } })).body,
      r.body + JSON.stringify(r.headers),
    ].join('\n');
    assert.ok(falso.emitidos.length >= 2);
    for (const acesso of falso.emitidos) assert.ok(!respostas.includes(acesso));
    for (const x of g) assert.ok(!respostas.includes(x.acesso_cifrado) && !respostas.includes(x.regem_loja_id));
    assert.ok(!respostas.includes('rgm_it_') && !respostas.includes('acesso_cifrado'));
  });

  it('a tela depois da volta: as lojas esperando, com o par sugerido pelo nome', async () => {
    const [c, b] = lojasDeLa();
    await autorizar(minha.dono, [c, b], 'Casa do Lanche Ltda');
    const t = await tela(minha.gerente);

    assert.deepEqual(t.ligadas, []);
    assert.deepEqual(t.lojasLivres, [
      { id: minha.barra, nome: 'Loja Barra' },
      { id: minha.centro, nome: 'Loja Centro' },
    ]);
    assert.deepEqual(
      t.esperando.map((e) => [e.regemLojaNome, e.regemEmpresaNome, e.sugestaoLojaId]),
      [
        ['Casa do Lanche · Barra', 'Casa do Lanche Ltda', minha.barra],
        ['Casa do Lanche · Centro', 'Casa do Lanche Ltda', minha.centro],
      ],
    );
    assert.ok(t.esperando.every((e) => !Number.isNaN(Date.parse(e.autorizadaEm))));
  });

  it('o mesmo state não passa duas vezes, e a segunda nem chama o Regem', async () => {
    const [c] = lojasDeLa();
    const p = await autorizar(minha.dono, [c]);
    const chamadasAntes = falso.chamadas.length;
    const outro = falso.autorizar({ lojas: [c], desafio: p.desafio, redirectUri: RETORNO });

    assert.equal((await volta(minha.dono, { code: outro, state: p.state })).desfecho, 'invalido');
    assert.equal(falso.chamadas.length, chamadasAntes);
    assert.equal((await guardadas()).length, 1);
  });

  it('state ausente, malformado ou que ninguém pediu: inválido, sem chamar o Regem', async () => {
    const casos: Array<Record<string, string>> = [
      { code: 'c'.repeat(30) },
      { code: 'c'.repeat(30), state: 'curto' },
      { code: 'c'.repeat(30), state: 'com espaço no meio do state' },
      { code: 'c'.repeat(30), state: 's'.repeat(201) },
      { code: 'c'.repeat(30), state: randomBytes(32).toString('base64url') },
    ];
    for (const caso of casos) assert.equal((await volta(minha.dono, caso)).desfecho, 'invalido', JSON.stringify(caso));
    assert.equal(falso.chamadas.length, 0);
    assert.equal((await guardadas()).length, 0);
  });

  it('código ausente ou sem cara de código: inválido — e o pedido foi gasto', async () => {
    for (const code of [undefined, '', 'curto', 'com espaço no meio', 'c'.repeat(301)]) {
      const p = await ida(minha.dono);
      assert.equal((await volta(minha.dono, { ...(code === undefined ? {} : { code }), state: p.state })).desfecho, 'invalido', String(code));
      assert.notEqual((await pedidosDe())[0].usado_em, null);
    }
    assert.equal(falso.chamadas.length, 0);
  });

  it('a volta só vale para quem começou: outra pessoa, mesmo da diretoria, não termina', async () => {
    const [c] = lojasDeLa();
    for (const intruso of [minha.socio, vizinha.dono, minha.gerente]) {
      const p = await ida(minha.dono);
      const code = falso.autorizar({ lojas: [c], desafio: p.desafio, redirectUri: RETORNO });
      assert.equal((await volta(intruso, { code, state: p.state })).desfecho, 'outra_conta');
      // …e o pedido foi gasto: nem o dono termina mais com ele.
      assert.equal((await volta(minha.dono, { code, state: p.state })).desfecho, 'invalido');
    }
    assert.equal(falso.chamadas.length, 0);
    assert.equal((await guardadas()).length, 0);
    assert.equal((await guardadas(vizinha.tenantId)).length, 0);
  });

  it('sem sessão a volta não gasta o pedido: quem começou ainda termina', async () => {
    const [c] = lojasDeLa();
    const p = await ida(minha.dono);
    const code = falso.autorizar({ lojas: [c], desafio: p.desafio, redirectUri: RETORNO });

    assert.equal((await volta(null, { code, state: p.state })).desfecho, 'sem_sessao');
    assert.equal((await volta('farol_sessao=nao-existe', { code, state: p.state })).desfecho, 'sem_sessao');
    assert.equal((await volta(minha.dono, { code, state: p.state })).desfecho, 'autorizado');
  });

  it('pedido vencido: não troca nada', async () => {
    const [c] = lojasDeLa();
    const p = await ida(minha.dono);
    const code = falso.autorizar({ lojas: [c], desafio: p.desafio, redirectUri: RETORNO });
    await pool.query("update regem_pedido set expira_em = now() - interval '1 second' where tenant_id = $1", [minha.tenantId]);

    assert.equal((await volta(minha.dono, { code, state: p.state })).desfecho, 'vencido');
    assert.equal(falso.chamadas.length, 0);
    assert.equal((await guardadas()).length, 0);
  });

  it('quem começou deixou de ser da diretoria no caminho: não termina', async () => {
    const [c] = lojasDeLa();
    const cookie = await criarUsuario(minha.tenantId, `rebaixado-${randomUUID().slice(0, 6)}`, 'presidente');
    const p = await ida(cookie);
    const code = falso.autorizar({ lojas: [c], desafio: p.desafio, redirectUri: RETORNO });
    await pool.query(
      `update usuario set nivel = 'gerente'
        where id = (select usuario_id from regem_pedido where estado_hash = $1)`,
      [createHash('sha256').update(p.state).digest('hex')],
    );

    assert.equal((await volta(cookie, { code, state: p.state })).desfecho, 'sem_permissao');
    assert.equal(falso.chamadas.length, 0);
    assert.equal((await guardadas()).length, 0);
  });

  it('a pessoa desistiu no Regem: cancelado, sem chamada e com o pedido gasto', async () => {
    const p = await ida(minha.dono);
    assert.equal((await volta(minha.dono, { error: 'access_denied', state: p.state })).desfecho, 'cancelado');
    assert.equal(falso.chamadas.length, 0);
    assert.equal((await volta(minha.dono, { error: 'access_denied', state: p.state })).desfecho, 'invalido');
  });

  it('o Regem recusa, cai, emudece ou responde torto: falhou, e nada é guardado', async () => {
    const [c] = lojasDeLa();
    const casos: Array<[string, () => void, FastifyInstance?]> = [
      ['código que o Regem não conhece', () => {}],
      ['fora do ar', () => void (falso.modo = 'fora')],
      ['mudo', () => void (falso.modo = 'mudo')],
      ['uma página no lugar do JSON', () => void (falso.modo = 'pagina')],
      ['sem lojas', () => void (falso.modo = () => ({ lojas: [] }))],
      ['segredo que não é o de lá', () => {}, appOutroSegredo],
    ];
    for (const [nome, preparar, a] of casos) {
      falso.modo = 'normal';
      const p = await ida(minha.dono, a ?? app);
      const code = nome.startsWith('código') ? `rgm_ac_${'z'.repeat(43)}` : falso.autorizar({ lojas: [c], desafio: p.desafio, redirectUri: RETORNO });
      preparar();
      const comeco = Date.now();
      assert.equal((await volta(minha.dono, { code, state: p.state }, a ?? app)).desfecho, 'falhou', nome);
      assert.ok(Date.now() - comeco < 3000, `${nome}: não prendeu a rota`);
      assert.equal((await guardadas()).length, 0, nome);
    }
  });

  it('a chave do ambiente mudou entre a ida e a volta: falhou, sem mandar lixo ao Regem', async () => {
    const [c] = lojasDeLa();
    const p = await ida(minha.dono);
    const code = falso.autorizar({ lojas: [c], desafio: p.desafio, redirectUri: RETORNO });
    assert.equal((await volta(minha.dono, { code, state: p.state }, appOutraChave)).desfecho, 'falhou');
    assert.equal(falso.chamadas.length, 0);
  });

  it('autorizar de novo uma loja já ligada troca o acesso e mantém o par', async () => {
    const { c, b, t } = await conectado();
    const antes = await guardadas();
    const acessoAntigo = acessoDe(antes.find((g) => g.regem_loja_id === c.id)!)!;

    // O sócio autoriza de novo só a do Centro, que agora tem outro nome lá.
    await autorizar(minha.socio, [{ id: c.id, nome: 'Casa do Lanche · Centro Novo' }], 'Casa do Lanche S.A.');

    const depois = await guardadas();
    assert.equal(depois.length, 2, 'nenhuma linha a mais');
    const centro = depois.find((g) => g.regem_loja_id === c.id)!;
    assert.equal(centro.id, antes.find((g) => g.regem_loja_id === c.id)!.id, 'a mesma linha');
    assert.equal(centro.loja_id, minha.centro, 'o par ficou');
    assert.equal(centro.regem_loja_nome, 'Casa do Lanche · Centro Novo');
    const acessoNovo = acessoDe(centro)!;
    assert.notEqual(acessoNovo, acessoAntigo);
    assert.equal(falso.vale(acessoNovo), true);
    assert.equal(falso.vale(acessoAntigo), false, 'o antigo deixou de valer no Regem');
    // A da Barra não foi tocada.
    const barra = depois.find((g) => g.regem_loja_id === b.id)!;
    assert.equal(barra.acesso_cifrado, antes.find((g) => g.regem_loja_id === b.id)!.acesso_cifrado);

    const agora = await tela(minha.dono);
    assert.equal(agora.esperando.length, 0);
    assert.deepEqual(
      agora.ligadas.map((l) => [l.lojaNome, l.regemLojaNome, l.regemEmpresaNome]).sort(),
      [
        ['Loja Barra', 'Casa do Lanche · Barra', 'Casa do Lanche Alimentação Ltda'],
        ['Loja Centro', 'Casa do Lanche · Centro Novo', 'Casa do Lanche S.A.'],
      ],
    );
    assert.equal(t.ligadas.length, 2);
  });

  it('nada do que é segredo aparece no registro do servidor — nem o endereço da volta', async () => {
    const linhas: string[] = [];
    const comRegistro = criarApp(pool, { logger: { level: 'info', stream: { write: (l) => void linhas.push(l) } }, regem: cfg });
    await comRegistro.ready();
    try {
      const [c, b] = lojasDeLa();
      const p = await ida(minha.dono, comRegistro);
      const code = falso.autorizar({ lojas: [c, b], desafio: p.desafio, redirectUri: RETORNO });
      assert.equal((await volta(minha.dono, { code, state: p.state }, comRegistro)).desfecho, 'autorizado');
      // Uma volta que falha também passa pelo registro (o aviso do motivo).
      const q = await ida(minha.dono, comRegistro);
      const ruim = `rgm_ac_${'q'.repeat(43)}`;
      assert.equal((await volta(minha.dono, { code: ruim, state: q.state }, comRegistro)).desfecho, 'falhou');

      const t = await tela(minha.dono, comRegistro);
      assert.equal((await ligar(minha.dono, [{ id: idDe(t, c.nome), lojaId: minha.centro }, { id: idDe(t, b.nome), lojaId: null }], comRegistro)).statusCode, 200);
      const ligada = (await tela(minha.dono, comRegistro)).ligadas[0]!;
      assert.equal((await desconectar(minha.dono, ligada.id, comRegistro)).statusCode, 200);

      const registro = linhas.join('');
      // O registro está de fato sendo lido: as outras rotas aparecem nele.
      assert.ok(registro.includes('/v1/regem/conectar'), 'o registro de pedidos funciona');
      assert.ok(registro.includes('regem: lojas autorizadas'));
      assert.ok(registro.includes('regem: a troca do código falhou'));
      assert.ok(registro.includes('regem: loja desconectada'));
      // …e o endereço da volta, que carrega o código e o state, não.
      assert.ok(!registro.includes('/v1/regem/retorno'));
      const verificadores = falso.chamadas.map((x) => String(x.corpo?.code_verifier ?? '')).filter(Boolean);
      assert.ok(verificadores.length >= 2);
      for (const segredo of [p.state, q.state, code, ruim, cfg.segredo, ...verificadores, ...falso.emitidos]) {
        assert.ok(!registro.includes(segredo), 'um segredo foi parar no registro');
      }
      assert.ok(!registro.includes('rgm_it_') && !registro.includes('rgm_ac_'));
    } finally {
      await comRegistro.close();
    }
  });

  // ───────────────────────── ligar ─────────────────────────

  it('ligar: cada loja do Regem ganha a loja do Farol, e a tela passa a mostrá-las ligadas', async () => {
    const [c, b] = lojasDeLa();
    await autorizar(minha.dono, [c, b]);
    const t = await tela(minha.dono);
    // De propósito ao contrário da sugestão: quem decide é a pessoa.
    const r = await ligar(minha.dono, [
      { id: idDe(t, c.nome), lojaId: minha.barra },
      { id: idDe(t, b.nome), lojaId: minha.centro },
    ]);

    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json(), { ligadas: 2, descartadas: 0, naoDescartadas: [] });
    const depois = await tela(minha.gerente);
    assert.deepEqual(depois.esperando, []);
    assert.deepEqual(depois.lojasLivres, []);
    assert.deepEqual(
      depois.ligadas.map((l) => [l.regemLojaNome, l.lojaId, l.lojaNome]),
      [
        ['Casa do Lanche · Barra', minha.centro, 'Loja Centro'],
        ['Casa do Lanche · Centro', minha.barra, 'Loja Barra'],
      ],
    );
    assert.ok(depois.ligadas.every((l) => !Number.isNaN(Date.parse(l.ligadaEm))));
    assert.equal(falso.chamadas.filter((x) => x.caminho.endsWith('/revogar')).length, 0, 'nenhum acesso foi devolvido');
  });

  it('não usar uma loja: o acesso dela é devolvido ao Regem e a linha sai', async () => {
    const [c, b] = lojasDeLa();
    await autorizar(minha.dono, [c, b]);
    const t = await tela(minha.dono);
    const daBarra = acessoDe((await guardadas()).find((g) => g.regem_loja_id === b.id)!)!;
    const doCentro = acessoDe((await guardadas()).find((g) => g.regem_loja_id === c.id)!)!;

    const r = await ligar(minha.dono, [
      { id: idDe(t, c.nome), lojaId: minha.centro },
      { id: idDe(t, b.nome), lojaId: null },
    ]);
    assert.deepEqual(r.json(), { ligadas: 1, descartadas: 1, naoDescartadas: [] });
    assert.equal(falso.vale(daBarra), false, 'o da Barra foi devolvido');
    assert.equal(falso.vale(doCentro), true, 'o do Centro continua valendo');
    const g = await guardadas();
    assert.deepEqual(g.map((x) => [x.regem_loja_id, x.loja_id]), [[c.id, minha.centro]]);
    const depois = await tela(minha.dono);
    assert.deepEqual(depois.lojasLivres, [{ id: minha.barra, nome: 'Loja Barra' }]);
  });

  it('não usar nenhuma: tudo devolvido, e a conta volta a não ter conexão', async () => {
    const [c, b] = lojasDeLa();
    await autorizar(minha.dono, [c, b]);
    const t = await tela(minha.dono);
    const r = await ligar(minha.dono, t.esperando.map((e) => ({ id: e.id, lojaId: null })));

    assert.deepEqual(r.json(), { ligadas: 0, descartadas: 2, naoDescartadas: [] });
    assert.equal((await guardadas()).length, 0);
    assert.ok(falso.emitidos.slice(-2).every((a) => !falso.vale(a)));
  });

  it('não usar com o Regem fora do ar: a que era para ligar liga, a outra fica esperando — e sai quando ele volta', async () => {
    const [c, b] = lojasDeLa();
    await autorizar(minha.dono, [c, b]);
    const t = await tela(minha.dono);
    const daBarra = acessoDe((await guardadas()).find((g) => g.regem_loja_id === b.id)!)!;
    falso.modo = 'fora';

    const r = await ligar(minha.dono, [
      { id: idDe(t, c.nome), lojaId: minha.centro },
      { id: idDe(t, b.nome), lojaId: null },
    ]);
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json(), {
      ligadas: 1,
      descartadas: 0,
      naoDescartadas: [{ id: idDe(t, b.nome), regemLojaNome: 'Casa do Lanche · Barra' }],
    });
    const meio = await tela(minha.dono);
    assert.deepEqual(meio.esperando.map((e) => e.regemLojaNome), ['Casa do Lanche · Barra']);
    assert.equal(meio.ligadas.length, 1);
    assert.equal(falso.vale(daBarra), true);

    // A recuperação: com o Regem de volta, a mesma escolha conclui.
    falso.modo = 'normal';
    const de_novo = await ligar(minha.dono, [{ id: idDe(t, b.nome), lojaId: null }]);
    assert.deepEqual(de_novo.json(), { ligadas: 0, descartadas: 1, naoDescartadas: [] });
    assert.equal(falso.vale(daBarra), false);
    assert.equal((await tela(minha.dono)).esperando.length, 0);
  });

  it('não usar uma loja cujo acesso já foi tirado no Regem: sai do mesmo jeito', async () => {
    const [c] = lojasDeLa();
    await autorizar(minha.dono, [c]);
    const t = await tela(minha.dono);
    falso.tirar(acessoDe((await guardadas())[0]!)!);

    assert.deepEqual((await ligar(minha.dono, [{ id: t.esperando[0]!.id, lojaId: null }])).json(), { ligadas: 0, descartadas: 1, naoDescartadas: [] });
    assert.equal((await guardadas()).length, 0);
  });

  it('o corpo é conferido antes de qualquer coisa: nada muda e o Regem não é chamado', async () => {
    const [c, b] = lojasDeLa();
    await autorizar(minha.dono, [c, b]);
    const t = await tela(minha.dono);
    const [e1, e2] = [idDe(t, c.nome), idDe(t, b.nome)];
    falso.chamadas.length = 0;

    const casos: Array<[string, unknown, number, string]> = [
      ['sem pares', undefined, 422, 'validacao'],
      ['pares que não é lista', { [e1]: minha.centro }, 422, 'validacao'],
      ['lista vazia', [], 422, 'validacao'],
      ['par sem id', [{ lojaId: minha.centro }], 422, 'validacao'],
      ['id que não é uuid', [{ id: 'loja-1', lojaId: minha.centro }], 422, 'validacao'],
      ['par sem dizer a loja (nem nulo)', [{ id: e1 }], 422, 'validacao'],
      ['loja que não é uuid', [{ id: e1, lojaId: 'centro' }], 422, 'validacao'],
      ['loja vazia não é "não usar"', [{ id: e1, lojaId: '' }], 422, 'validacao'],
      ['par que não é objeto', ['um'], 422, 'validacao'],
      ['a mesma loja do Regem duas vezes', [{ id: e1, lojaId: minha.centro }, { id: e1, lojaId: null }], 422, 'validacao'],
      ['duas lojas do Regem na mesma loja do Farol', [{ id: e1, lojaId: minha.centro }, { id: e2, lojaId: minha.centro }], 422, 'loja_repetida'],
      ['lojas demais', Array.from({ length: 201 }, () => ({ id: randomUUID(), lojaId: null })), 422, 'validacao'],
      ['loja do Regem que não existe', [{ id: e1, lojaId: minha.centro }, { id: randomUUID(), lojaId: null }], 404, 'nao_encontrado'],
      ['loja do Farol que não existe', [{ id: e1, lojaId: randomUUID() }, { id: e2, lojaId: null }], 404, 'loja_nao_encontrada'],
      ['loja do Farol do vizinho', [{ id: e1, lojaId: vizinha.loja }, { id: e2, lojaId: null }], 404, 'loja_nao_encontrada'],
    ];
    for (const [nome, pares, status, erro] of casos) {
      const r = await ligar(minha.dono, pares);
      assert.equal(r.statusCode, status, `${nome}: ${r.body}`);
      assert.equal(r.json().erro, erro, nome);
    }
    assert.equal(falso.chamadas.length, 0, 'nenhum acesso foi devolvido por um pedido recusado');
    const g = await guardadas();
    assert.equal(g.length, 2);
    assert.ok(g.every((x) => x.loja_id === null));
  });

  it('duzentos pares ainda passam da conferência do tamanho', async () => {
    const r = await ligar(minha.dono, Array.from({ length: 200 }, () => ({ id: randomUUID(), lojaId: null })));
    assert.equal(r.statusCode, 404, 'recusado porque as lojas não existem — não pelo tamanho');
  });

  it('o id aceita maiúsculas: é o mesmo uuid', async () => {
    const [c] = lojasDeLa();
    await autorizar(minha.dono, [c]);
    const t = await tela(minha.dono);
    const r = await ligar(minha.dono, [{ id: t.esperando[0]!.id.toUpperCase(), lojaId: minha.centro.toUpperCase() }]);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal((await guardadas())[0]!.loja_id, minha.centro);
  });

  it('a conexão do vizinho não se liga daqui, nem se vê', async () => {
    const [c] = lojasDeLa();
    const p = await ida(vizinha.dono);
    const code = falso.autorizar({ lojas: [c], desafio: p.desafio, redirectUri: RETORNO });
    assert.equal((await volta(vizinha.dono, { code, state: p.state })).desfecho, 'autorizado');
    const doVizinho = (await tela(vizinha.dono)).esperando[0]!;

    const meu = await tela(minha.dono);
    assert.deepEqual([meu.esperando, meu.ligadas], [[], []]);
    assert.ok(!JSON.stringify(meu).includes(doVizinho.id));

    assert.equal((await ligar(minha.dono, [{ id: doVizinho.id, lojaId: minha.centro }])).statusCode, 404);
    assert.equal((await ligar(minha.dono, [{ id: doVizinho.id, lojaId: null }])).statusCode, 404);
    assert.equal((await desconectar(minha.dono, doVizinho.id)).statusCode, 404);
    assert.equal(falso.chamadas.filter((x) => x.caminho.endsWith('/revogar')).length, 0);
    const g = await guardadas(vizinha.tenantId);
    assert.equal(g.length, 1);
    assert.equal(g[0]!.loja_id, null);
    assert.equal(falso.vale(acessoDe(g[0]!, vizinha.tenantId)!), true);
  });

  it('a mesma loja do Regem pode estar em duas contas: uma linha em cada, cada uma com o seu acesso', async () => {
    const [c] = lojasDeLa();
    await autorizar(minha.dono, [c]);
    const p = await ida(vizinha.dono);
    const code = falso.autorizar({ lojas: [c], desafio: p.desafio, redirectUri: RETORNO });
    assert.equal((await volta(vizinha.dono, { code, state: p.state })).desfecho, 'autorizado');

    const [meu] = await guardadas();
    const [dele] = await guardadas(vizinha.tenantId);
    assert.equal(meu!.regem_loja_id, dele!.regem_loja_id);
    assert.notEqual(meu!.id, dele!.id);
    // O texto guardado de uma conta não se lê como se fosse da outra.
    assert.equal(decifrar(dele!.acesso_cifrado, cfg.chave, `acesso:${minha.tenantId}:${c.id}`), null);
    assert.ok(acessoDe(dele!, vizinha.tenantId));
  });

  it('loja do Farol que já tem par: 409, e o pedido inteiro não acontece', async () => {
    const { t } = await conectado();
    const [n1, n2] = lojasDeLa();
    await autorizar(minha.dono, [n1, n2]);
    const agora = await tela(minha.dono);
    assert.deepEqual(agora.lojasLivres, [], 'as duas lojas do Farol já têm par');
    assert.ok(agora.esperando.every((e) => e.sugestaoLojaId === null), 'e por isso nada é sugerido');
    const extra = (await criarLoja(`Loja Extra ${randomUUID().slice(0, 6)}`, { tenantId: minha.tenantId })).lojaId;

    const r = await ligar(minha.dono, [
      { id: idDe(agora, n1.nome), lojaId: extra },
      { id: idDe(agora, n2.nome), lojaId: minha.centro },
    ]);
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().erro, 'loja_ja_ligada');
    const g = await guardadas();
    assert.equal(g.filter((x) => x.loja_id === extra).length, 0, 'a que podia ligar não ligou: todas ou nenhuma');
    assert.equal(g.filter((x) => x.loja_id === null).length, 2);
    assert.equal(t.ligadas.length, 2);
    await pool.query('delete from loja where id = $1', [extra]);
  });

  it('duas pessoas ligando ao mesmo tempo lojas diferentes do Regem à MESMA loja do Farol: só uma leva', async () => {
    // Quem segura é o índice único do banco (uma loja do Farol, um par),
    // com as duas chamadas juntas ou uma depois da outra: a conferência de
    // antes da gravação não olha se a loja já tem par.
    const [c, b] = lojasDeLa();
    await autorizar(minha.dono, [c, b]);
    const t = await tela(minha.dono);
    const [r1, r2] = await Promise.all([
      ligar(minha.dono, [{ id: idDe(t, c.nome), lojaId: minha.centro }]),
      ligar(minha.socio, [{ id: idDe(t, b.nome), lojaId: minha.centro }]),
    ]);
    assert.deepEqual([r1.statusCode, r2.statusCode].sort(), [200, 409], r1.body + r2.body);
    assert.equal([r1, r2].find((r) => r.statusCode === 409)!.json().erro, 'loja_ja_ligada');
    assert.equal((await guardadas()).filter((g) => g.loja_id === minha.centro).length, 1);
  });

  it('a loja mudou de estado entre a conferência e a gravação: 409 e nada pela metade', async () => {
    const [c, b] = lojasDeLa();
    await autorizar(minha.dono, [c, b]);
    const t = await tela(minha.dono);
    const [e1, e2] = [idDe(t, c.nome), idDe(t, b.nome)];

    // Outra conexão liga a primeira e NÃO confirma ainda: a conferência da
    // rota ainda a vê esperando, e a gravação fica parada na trava da linha.
    const outra = await pool.connect();
    try {
      await outra.query('begin');
      await outra.query('update regem_loja set loja_id = $1, ligado_em = now() where id = $2', [minha.barra, e1]);
      // Os MESMOS pares que a outra conexão quer: assim o que barra a rota é
      // a linha ter mudado, e não o índice de "uma loja do Farol, um par".
      const pendente = ligar(minha.socio, [
        { id: e1, lojaId: minha.barra },
        { id: e2, lojaId: minha.centro },
      ]);
      // Espera a gravação da rota chegar à trava (laço curto, com limite).
      const limite = Date.now() + 10_000;
      for (;;) {
        const { rows } = await pool.query(
          "select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and query like 'update regem_loja r%'",
        );
        if (rows[0].n > 0) break;
        assert.ok(Date.now() < limite, 'a gravação da rota não chegou à trava');
        await new Promise((ok) => setTimeout(ok, 25));
      }
      await outra.query('commit');
      const r = await pendente;
      assert.equal(r.statusCode, 409, r.body);
      assert.equal(r.json().erro, 'mudou');
    } finally {
      await outra.query('rollback').catch(() => {});
      outra.release();
    }
    const g = await guardadas();
    assert.equal(g.find((x) => x.id === e1)!.loja_id, minha.barra, 'ficou como a outra conexão gravou');
    assert.equal(g.find((x) => x.id === e2)!.loja_id, null, 'e a segunda, que podia ligar, não ligou: todas ou nenhuma');
  });

  it('loja já ligada não muda de par por aqui: não está esperando', async () => {
    const { t } = await conectado();
    const r = await ligar(minha.dono, [{ id: t.ligadas[0]!.id, lojaId: null }]);
    assert.equal(r.statusCode, 404);
    assert.equal((await guardadas()).length, 2);
    assert.equal(falso.chamadas.length, 0);
  });

  it('a sugestão olha só as lojas livres: com uma ligada, a que sobra vai para a que chega', async () => {
    const [c] = lojasDeLa();
    await autorizar(minha.dono, [c]);
    const t = await tela(minha.dono);
    assert.equal(t.esperando[0]!.sugestaoLojaId, minha.centro, 'pelo nome');
    assert.equal((await ligar(minha.dono, [{ id: t.esperando[0]!.id, lojaId: minha.centro }])).statusCode, 200);

    await autorizar(minha.dono, [{ id: randomUUID(), nome: 'Outro Nome Qualquer' }]);
    const depois = await tela(minha.dono);
    assert.deepEqual(depois.lojasLivres, [{ id: minha.barra, nome: 'Loja Barra' }]);
    assert.equal(depois.esperando[0]!.sugestaoLojaId, minha.barra, 'uma de cada lado: é ela');
  });

  // ───────────────────────── desconectar ─────────────────────────

  it('desconectar devolve o acesso ao Regem, apaga a ligação e libera a loja do Farol', async () => {
    const { c, b, t } = await conectado();
    const alvo = t.ligadas.find((l) => l.lojaId === minha.centro)!;
    const g = await guardadas();
    const doCentro = acessoDe(g.find((x) => x.regem_loja_id === c.id)!)!;
    const daBarra = acessoDe(g.find((x) => x.regem_loja_id === b.id)!)!;

    const r = await desconectar(minha.dono, alvo.id);
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json(), {
      desconectada: true,
      devolvido: true,
      fichasApagadas: true,
      lojaNome: 'Loja Centro',
      regemLojaNome: 'Casa do Lanche · Centro',
    });
    assert.equal(falso.vale(doCentro), false);
    assert.equal(falso.vale(daBarra), true, 'a outra loja segue conectada');
    const depois = await tela(minha.dono);
    assert.deepEqual(depois.ligadas.map((l) => l.lojaNome), ['Loja Barra']);
    assert.deepEqual(depois.lojasLivres, [{ id: minha.centro, nome: 'Loja Centro' }]);

    // De novo: já não existe.
    assert.equal((await desconectar(minha.dono, alvo.id)).statusCode, 404);
  });

  it('desconectar uma loja que ainda esperava par também vale', async () => {
    const [c] = lojasDeLa();
    await autorizar(minha.dono, [c]);
    const t = await tela(minha.dono);
    const acesso = acessoDe((await guardadas())[0]!)!;

    const r = await desconectar(minha.dono, t.esperando[0]!.id);
    assert.deepEqual(r.json(), { desconectada: true, devolvido: true, fichasApagadas: false, lojaNome: null, regemLojaNome: c.nome });
    assert.equal(falso.vale(acesso), false);
    assert.equal((await guardadas()).length, 0);
  });

  it('id malformado: 422; id que não existe: 404', async () => {
    assert.equal((await desconectar(minha.dono, 'nao-e-uuid')).statusCode, 422);
    assert.equal((await desconectar(minha.dono, randomUUID())).statusCode, 404);
  });

  it('Regem fora do ar: 502, a loja continua conectada — e desconecta quando ele volta', async () => {
    const { t } = await conectado();
    const alvo = t.ligadas[0]!;
    for (const modo of ['fora', 'mudo', 'devagar', 'pagina'] as const) {
      falso.modo = modo;
      const r = await desconectar(minha.dono, alvo.id);
      assert.equal(r.statusCode, 502, `${modo}: ${r.body}`);
      assert.equal(r.json().erro, 'regem_sem_resposta');
    }
    assert.equal((await guardadas()).length, 2, 'nada foi apagado');

    falso.modo = 'normal';
    const r = await desconectar(minha.dono, alvo.id);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().devolvido, true);
    assert.equal((await guardadas()).length, 1);
  });

  it('acesso já tirado no Regem: desconecta, e conta como devolvido', async () => {
    const { c, t } = await conectado();
    falso.tirar(acessoDe((await guardadas()).find((x) => x.regem_loja_id === c.id)!)!);
    const r = await desconectar(minha.dono, t.ligadas.find((l) => l.lojaId === minha.centro)!.id);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().devolvido, true);
    assert.equal((await guardadas()).length, 1);
  });

  it('o Regem recusa a devolução (403): a ligação sai daqui, e a resposta diz que o acesso ficou lá', async () => {
    const { c, t } = await conectado();
    const acesso = acessoDe((await guardadas()).find((x) => x.regem_loja_id === c.id)!)!;
    falso.modo = 'proibido';
    const r = await desconectar(minha.dono, t.ligadas.find((l) => l.lojaId === minha.centro)!.id);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().devolvido, false);
    assert.equal((await guardadas()).length, 1);
    assert.equal(falso.vale(acesso), true, 'no Regem ele ainda vale: é lá que se tira');
  });

  it('o acesso guardado não dá para ler (a chave mudou): sai daqui sem mandar lixo ao Regem', async () => {
    const { t } = await conectado();
    const r = await desconectar(minha.dono, t.ligadas[0]!.id, appOutraChave);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().devolvido, false);
    assert.equal(falso.chamadas.length, 0);
    assert.equal((await guardadas()).length, 1);

    // O mesmo ao não usar uma loja que esperava.
    await autorizar(minha.dono, [{ id: randomUUID(), nome: 'Sem Par' }]);
    falso.chamadas.length = 0;
    const esperando = (await tela(minha.dono)).esperando[0]!;
    const n = await ligar(minha.dono, [{ id: esperando.id, lojaId: null }], appOutraChave);
    assert.deepEqual(n.json(), { ligadas: 0, descartadas: 1, naoDescartadas: [] });
    assert.equal(falso.chamadas.length, 0);
  });

  // ───────────────────────── o que o banco segura ─────────────────────────

  it('apagar a loja do Farol leva a ligação junto; apagar a pessoa, não', async () => {
    const extra = (await criarLoja(`Loja Que Sai ${randomUUID().slice(0, 6)}`, { tenantId: minha.tenantId })).lojaId;
    const cookie = await criarUsuario(minha.tenantId, `de-passagem-${randomUUID().slice(0, 6)}`, 'presidente');
    const [c, b] = lojasDeLa();
    const p = await ida(cookie);
    const code = falso.autorizar({ lojas: [c, b], desafio: p.desafio, redirectUri: RETORNO });
    assert.equal((await volta(cookie, { code, state: p.state })).desfecho, 'autorizado');
    const t = await tela(cookie);
    assert.equal(
      (await ligar(cookie, [{ id: idDe(t, c.nome), lojaId: extra }, { id: idDe(t, b.nome), lojaId: minha.barra }])).statusCode,
      200,
    );

    await pool.query('delete from usuario where id = (select conectado_por from regem_loja where loja_id = $1)', [extra]);
    const semPessoa = await guardadas();
    assert.equal(semPessoa.length, 2, 'a pessoa saiu e as ligações ficaram');
    assert.ok(semPessoa.every((g) => g.conectado_por === null));

    await pool.query('delete from loja where id = $1', [extra]);
    const g = await guardadas();
    assert.deepEqual(g.map((x) => x.loja_id), [minha.barra]);
  });

  it('o banco recusa o que as rotas não deixam chegar lá', async () => {
    const [c] = lojasDeLa();
    await autorizar(minha.dono, [c]);
    const [g] = await guardadas();
    const codigoDe = async (sql: string, params: unknown[]) => {
      try {
        await pool.query(sql, params);
        return null;
      } catch (e) {
        return (e as { code?: string }).code ?? 'sem codigo';
      }
    };
    // A mesma loja do Regem duas vezes na conta.
    assert.equal(
      await codigoDe(
        `insert into regem_loja (tenant_id, regem_loja_id, regem_loja_nome, regem_empresa_nome, acesso_cifrado) values ($1,$2,'x','y','z')`,
        [minha.tenantId, g!.regem_loja_id],
      ),
      '23505',
    );
    // Duas lojas do Regem na mesma loja do Farol.
    await pool.query('update regem_loja set loja_id = $1 where id = $2', [minha.centro, g!.id]);
    assert.equal(
      await codigoDe(
        `insert into regem_loja (tenant_id, loja_id, regem_loja_id, regem_loja_nome, regem_empresa_nome, acesso_cifrado) values ($1,$2,$3,'x','y','z')`,
        [minha.tenantId, minha.centro, randomUUID()],
      ),
      '23505',
    );
    // O mesmo state em dois pedidos.
    const p = await ida(minha.dono);
    const dono = (await pedidosDe())[0];
    assert.equal(
      await codigoDe(
        `insert into regem_pedido (tenant_id, usuario_id, estado_hash, verificador_cifrado, expira_em) values ($1,$2,$3,'v', now())`,
        [minha.tenantId, dono.usuario_id, createHash('sha256').update(p.state).digest('hex')],
      ),
      '23505',
    );
  });
});
