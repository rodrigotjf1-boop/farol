// O aviso do Regem: "algo mudou nesta loja".
//
// O que se protege:
//
//   • a assinatura: só o aviso assinado com o segredo DESTA conexão, sobre o
//     texto exato que chegou e com o relógio perto do nosso, vale;
//   • o registro: o Farol diz ao Regem para onde avisar depois de ler —
//     ao ligar a loja e uma vez por dia —, com um segredo que ele sorteia,
//     guarda cifrado e nunca mostra. O Regem que ainda não aceita (422) não
//     quebra nada;
//   • o recebimento: o aviso só MARCA a loja e dispara a leitura de sempre;
//     o que chega no meio de uma leitura não se perde; aviso repetido não
//     vira uma leitura por pedido;
//   • o fim: desconectada, ou com o acesso tirado, a conexão responde 404 —
//     é o que faz o Regem parar de avisar.
//
// Quem assina nos testes é o Regem de mentira, com a conta copiada do de
// verdade (`regem-falso.ts`); quem confere é o código do Farol.

import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { chaveDoSegredo, conferirAviso, contextoDoAviso, garantirAviso, novoSegredo, TOLERANCIA_S } from '../src/aviso.js';
import { decifrar } from '../src/cifra.js';
import { lerAsLojasDaVez, semLeituraEmCurso } from '../src/leitura.js';
import type { ConfigDoRegem } from '../src/regem.js';
import { assinarComoORegem, subirRegemFalso, type LojaDeLa, type RegemFalso } from './regem-falso.js';

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-avi-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-aviso';
const SENHA = 'uma senha longa o bastante';
const CONSOLE = 'https://console.exemplo';
const RETORNO = `${CONSOLE}/api/regem/retorno`;
const AVISOS = 'https://farol.exemplo/v1/regem/avisos/';

// ───────────────────────── a conta, sem banco ─────────────────────────

describe('aviso: a assinatura', () => {
  const segredo = novoSegredo();
  const chave = chaveDoSegredo(segredo)!;
  const agora = new Date('2026-10-11T22:00:00Z');
  const ts = Math.floor(agora.getTime() / 1000);
  const corpo = JSON.stringify({ tipo: 'fichas.alterado', loja_id: randomUUID() });
  const id = randomUUID();
  const certa = assinarComoORegem(segredo, id, ts, corpo);
  const conferir = (p: Partial<Parameters<typeof conferirAviso>[0]> = {}) =>
    conferirAviso({ id, timestamp: String(ts), assinatura: certa, corpo, chave, agora, ...p });

  it('o que o Regem assina, o Farol confere', () => {
    assert.equal(conferir(), 'ok');
  });

  it('um byte a mais no corpo, outro id, outro instante ou outro segredo: não confere', () => {
    assert.equal(conferir({ corpo: `${corpo} ` }), 'assinatura');
    assert.equal(conferir({ corpo: corpo.replace('fichas', 'Fichas') }), 'assinatura');
    assert.equal(conferir({ id: randomUUID() }), 'assinatura');
    assert.equal(conferir({ timestamp: String(ts + 1) }), 'assinatura');
    assert.equal(conferir({ chave: chaveDoSegredo(novoSegredo())! }), 'assinatura');
    assert.equal(conferir({ assinatura: assinarComoORegem(novoSegredo(), id, ts, corpo) }), 'assinatura');
  });

  it('o relógio: cinco minutos para cada lado, e nem um segundo a mais', () => {
    const em = (segundos: number) => new Date(agora.getTime() + segundos * 1000);
    assert.equal(TOLERANCIA_S, 300);
    assert.equal(conferir({ agora: em(300) }), 'ok');
    assert.equal(conferir({ agora: em(-300) }), 'ok');
    assert.equal(conferir({ agora: em(301) }), 'fora_do_prazo');
    assert.equal(conferir({ agora: em(-301) }), 'fora_do_prazo');
  });

  it('sem um dos três cabeçalhos, ou com um deles torto, nem se faz a conta', () => {
    for (const falta of ['id', 'timestamp', 'assinatura'] as const) {
      assert.equal(conferir({ [falta]: undefined }), 'sem_cabecalho', falta);
      assert.equal(conferir({ [falta]: '' }), 'sem_cabecalho', falta);
      assert.equal(conferir({ [falta]: ['a', 'b'] }), 'sem_cabecalho', falta);
    }
    assert.equal(conferir({ timestamp: 'agora' }), 'sem_cabecalho');
    assert.equal(conferir({ timestamp: `${ts}.5` }), 'sem_cabecalho');
    assert.equal(conferir({ timestamp: `-${ts}` }), 'sem_cabecalho');
    assert.equal(conferir({ id: 'x'.repeat(257) }), 'sem_cabecalho');
    assert.equal(conferir({ assinatura: 'v1,'.padEnd(1025, 'A') }), 'sem_cabecalho');
  });

  it('várias assinaturas no cabeçalho: basta uma conferir — e só as "v1" contam', () => {
    const outra = assinarComoORegem(novoSegredo(), id, ts, corpo);
    assert.equal(conferir({ assinatura: `${outra} ${certa}` }), 'ok');
    assert.equal(conferir({ assinatura: `${certa} ${outra}` }), 'ok');
    assert.equal(conferir({ assinatura: `${outra} ${outra}` }), 'assinatura');
    assert.equal(conferir({ assinatura: certa.replace(/^v1,/, 'v2,') }), 'assinatura');
    assert.equal(conferir({ assinatura: certa.replace(/^v1,/, '') }), 'assinatura');
    assert.equal(conferir({ assinatura: certa.slice(0, -6) }), 'assinatura', 'a assinatura pela metade não confere');
    assert.equal(conferir({ assinatura: 'v1,' }), 'assinatura');
  });

  it('o segredo novo tem o formato que o Regem aceita, e cada um é um', () => {
    const [a, b] = [novoSegredo(), novoSegredo()];
    assert.match(a, /^whsec_[A-Za-z0-9+/]{43}=$/);
    assert.notEqual(a, b);
    assert.equal(chaveDoSegredo(a)!.length, 32);
    const comBytes = (n: number) => `whsec_${randomBytes(n).toString('base64')}`;
    assert.deepEqual([23, 24, 64, 65].map((n) => chaveDoSegredo(comBytes(n)) !== null), [false, true, true, false]);
    assert.equal(chaveDoSegredo(a.slice('whsec_'.length)), null, 'sem o prefixo não é segredo');
    assert.equal(chaveDoSegredo(`${a.slice(0, -1)}!`), null, 'com caractere que não é do alfabeto, também não');
  });
});

// ───────────────────────── com o banco e o Regem de mentira ─────────────────────────

describe('aviso: registrar e receber', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let falso: RegemFalso;
  let cfg: ConfigDoRegem & { segredo: string; chave: Buffer; avisoUrl: string };
  let app: FastifyInstance;
  let appSemAmbiente: FastifyInstance;
  let adminAntes: string | undefined;
  /** Tudo o que o servidor escreveu no registro: para procurar o que NÃO pode estar lá. */
  const registro: string[] = [];
  const quieto = { info: () => {}, warn: () => {}, error: () => {} };

  const minha = { tenantId: '', centro: '', barra: '', dono: '', gerente: '' };
  const contas = () => [minha.tenantId];

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
    const bruto = login.headers['set-cookie'];
    return (Array.isArray(bruto) ? bruto[0]! : String(bruto)).split(';')[0]!;
  }
  async function criarLoja(nome: string, conta: object) {
    const r = await app.inject({
      method: 'POST',
      url: '/v1/distribuicao/lojas',
      headers: { 'x-farol-admin': ADMIN },
      payload: { ...conta, loja: { nome }, setores: [{ nome: 'Cozinha' }] },
    });
    assert.equal(r.statusCode, 201, r.body);
    return { tenantId: r.json().tenantId as string, lojaId: r.json().loja.id as string };
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
      avisoUrl: AVISOS,
      buscar: fetch,
      prazoMs: 400,
      agente: 'farol-api/teste (+https://monitorfarol.com.br)',
    };
    app = criarApp(pool, { logger: { level: 'info', stream: { write: (linha) => void registro.push(linha) } }, regem: cfg });
    appSemAmbiente = criarApp(pool, { logger: false, regem: { ...cfg, chave: null } });
    await Promise.all([app.ready(), appSemAmbiente.ready()]);

    const centro = await criarLoja('Loja Centro', { tenant: { nome: `${marca}-minha` } });
    minha.tenantId = centro.tenantId;
    minha.centro = centro.lojaId;
    minha.barra = (await criarLoja('Loja Barra', { tenantId: minha.tenantId })).lojaId;
    minha.dono = await criarUsuario(minha.tenantId, 'dono', 'presidente');
    minha.gerente = await criarUsuario(minha.tenantId, 'gerente', 'gerente');
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    falso?.soltar();
    await semLeituraEmCurso();
    await Promise.all([app?.close(), appSemAmbiente?.close()]);
    await falso?.fechar();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  beforeEach(async () => {
    falso.modo = 'normal';
    falso.leituraTorta = null;
    falso.soltar();
    await semLeituraEmCurso();
    falso.chamadas.length = 0;
    falso.avisos.pedidos.length = 0;
    // Todo teste começa com o Regem ACEITANDO aviso do Farol; o que quer o contrário, diz.
    falso.avisos.base = AVISOS;
    registro.length = 0;
    await pool.query('delete from fichas_da_loja where tenant_id = any($1::uuid[])', [contas()]);
    await pool.query('delete from regem_loja where tenant_id = any($1::uuid[])', [contas()]);
    await pool.query('delete from regem_pedido where tenant_id = any($1::uuid[])', [contas()]);
  });

  // ───────────────────────── os atalhos ─────────────────────────

  async function autorizar(lojas: LojaDeLa[]) {
    const ida = await app.inject({ method: 'POST', url: '/v1/regem/conectar', headers: { cookie: minha.dono } });
    const url = new URL(ida.json().url);
    const code = falso.autorizar({ lojas, desafio: url.searchParams.get('code_challenge')!, redirectUri: RETORNO });
    const volta = await app.inject({ method: 'GET', url: `/v1/regem/retorno?${new URLSearchParams({ code, state: url.searchParams.get('state')! })}`, headers: { cookie: minha.dono } });
    assert.equal(new URL(String(volta.headers.location)).searchParams.get('regem'), 'autorizado');
  }
  /** Autoriza UMA loja de lá e a liga à loja do Farol; espera a primeira busca — e o registro do aviso — terminarem. */
  async function ligada(lojaId: string, nome: string) {
    const deLa = { id: randomUUID(), nome };
    await autorizar([deLa]);
    const c = (await app.inject({ method: 'GET', url: '/v1/regem', headers: { cookie: minha.dono } })).json();
    const esperando = c.esperando.find((e: { regemLojaNome: string }) => e.regemLojaNome === nome);
    const r = await app.inject({ method: 'PUT', url: '/v1/regem/lojas', headers: { cookie: minha.dono }, payload: { pares: [{ id: esperando.id, lojaId }] } });
    assert.equal(r.statusCode, 200, r.body);
    await semLeituraEmCurso();
    falso.chamadas.length = 0;
    return { ...deLa, conexaoId: esperando.id as string };
  }
  type DoAviso = {
    tenant_id: string;
    regem_loja_id: string;
    aviso_segredo_cifrado: string | null;
    aviso_registrado_em: Date | null;
    aviso_tentado_em: Date | null;
    aviso_recebido_em: Date | null;
    aviso_pendente_desde: Date | null;
  };
  const linhaDe = async (conexaoId: string) =>
    (
      await pool.query<DoAviso>(
        `select tenant_id, regem_loja_id, aviso_segredo_cifrado, aviso_registrado_em, aviso_tentado_em, aviso_recebido_em, aviso_pendente_desde
           from regem_loja where id = $1`,
        [conexaoId],
      )
    ).rows[0];
  const segredoGuardado = async (conexaoId: string) => {
    const l = (await linhaDe(conexaoId))!;
    return l.aviso_segredo_cifrado ? decifrar(l.aviso_segredo_cifrado, cfg.chave, contextoDoAviso(l.tenant_id, l.regem_loja_id)) : null;
  };
  /** Como se o tempo tivesse passado: a última tentativa, o último registro e a última leitura ficam para trás. */
  const envelhecer = (conexaoId: string, p: { tentadoMin?: number; registradoH?: number; leituraS?: number }) =>
    pool.query(
      `update regem_loja
          set aviso_tentado_em = case when $2::int is null then aviso_tentado_em else now() - make_interval(mins => $2) end,
              aviso_registrado_em = case when $3::int is null or aviso_registrado_em is null then aviso_registrado_em else now() - make_interval(hours => $3) end,
              tentada_em = case when $4::int is null then tentada_em else now() - make_interval(secs => $4) end
        where id = $1`,
      [conexaoId, p.tentadoMin ?? null, p.registradoH ?? null, p.leituraS ?? null],
    );
  const buscar = (lojaId: string) => app.inject({ method: 'POST', url: `/v1/lojas/${lojaId}/fichas/buscar`, headers: { cookie: minha.gerente } });
  const fichas = async (lojaId: string) => (await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}/fichas`, headers: { cookie: minha.gerente } })).json();
  type Montado = NonNullable<ReturnType<RegemFalso['avisos']['montar']>>;
  /** Entrega o aviso ao Farol, como o Regem faria: pelo caminho do endereço registrado. */
  const entregar = (aviso: Montado, mexer: { corpo?: string; cabecalhos?: Record<string, string | undefined>; caminho?: string; a?: FastifyInstance } = {}) => {
    const cabecalhos: Record<string, string> = {};
    for (const [k, v] of Object.entries({ ...aviso.cabecalhos, ...mexer.cabecalhos })) if (v !== undefined) cabecalhos[k] = v;
    return (mexer.a ?? app).inject({ method: 'POST', url: mexer.caminho ?? new URL(aviso.url).pathname, headers: cabecalhos, payload: mexer.corpo ?? aviso.corpo });
  };
  const leituras = () => falso.chamadas.filter((c) => /^\/integracao\/(catalogo|fichas)/.test(c.caminho)).length;
  const semFichas = () => {
    const c = structuredClone(falso.amostra);
    c.fichas = [];
    return c;
  };

  // ───────────────────────── registrar ─────────────────────────

  it('ligar a loja registra o aviso: o endereço desta conexão e um segredo sorteado, que fica cifrado e fora do registro', async () => {
    const c = await ligada(minha.centro, 'Centro de lá');

    assert.equal(falso.avisos.pedidos.length, 1, 'um pedido de registro, e só um');
    const p = falso.avisos.pedidos[0]!;
    assert.deepEqual([p.metodo, p.comAcesso, p.status], ['PUT', true, 200]);
    assert.deepEqual(Object.keys(p.corpo!).sort(), ['segredo', 'url'], 'o Regem recusa campo a mais');
    assert.equal(p.corpo!.url, `${AVISOS}${c.conexaoId}`);
    const segredo = String(p.corpo!.segredo);
    assert.match(segredo, /^whsec_[A-Za-z0-9+/]{43}=$/);

    const l = (await linhaDe(c.conexaoId))!;
    assert.ok(l.aviso_registrado_em && Date.now() - l.aviso_registrado_em.getTime() < 15_000);
    assert.ok(l.aviso_segredo_cifrado && !l.aviso_segredo_cifrado.includes(segredo) && !l.aviso_segredo_cifrado.includes(segredo.slice(6, 30)));
    assert.equal(await segredoGuardado(c.conexaoId), segredo, 'o que está guardado é o que foi entregue ao Regem');
    assert.equal(decifrar(l.aviso_segredo_cifrado!, cfg.chave, contextoDoAviso(l.tenant_id, randomUUID())), null, 'colado na linha de outra loja, não abre');
    assert.deepEqual(falso.avisos.registroDe(c.id), { url: `${AVISOS}${c.conexaoId}`, segredo });

    // Ler de novo no mesmo dia não registra de novo.
    assert.equal((await buscar(minha.centro)).statusCode, 200);
    await semLeituraEmCurso();
    assert.equal(falso.avisos.pedidos.length, 1);

    // Nem o segredo do aviso nem o acesso da loja aparecem no registro do servidor — e nenhuma rota os devolve.
    const escrito = registro.join('');
    assert.ok(escrito.length > 0, 'o registro foi capturado');
    for (const proibido of [segredo, segredo.slice(6), ...falso.emitidos]) assert.ok(!escrito.includes(proibido), 'segredo no registro');
    const telas = JSON.stringify([await fichas(minha.centro), (await app.inject({ method: 'GET', url: '/v1/regem', headers: { cookie: minha.dono } })).json()]);
    assert.ok(!telas.includes('whsec_') && !telas.includes('aviso'), 'a tela não recebe nada do aviso');
  });

  it('o Regem ainda não aceita aviso para o Farol (422): nada quebra, e o Farol tenta de novo sem insistir', async () => {
    falso.avisos.base = null;
    const c = await ligada(minha.centro, 'Centro de lá');
    assert.deepEqual(falso.avisos.pedidos.map((p) => p.status), [422]);
    const primeiro = String(falso.avisos.pedidos[0]!.corpo!.segredo);
    let l = (await linhaDe(c.conexaoId))!;
    assert.equal(l.aviso_registrado_em, null);
    assert.ok(l.aviso_tentado_em);
    assert.equal(await segredoGuardado(c.conexaoId), primeiro, 'o segredo fica guardado para a tentativa seguinte');
    // A leitura não depende do aviso.
    assert.equal((await fichas(minha.centro)).totais.produtos, 4);

    // Buscar de novo logo em seguida: não bate no Regem de novo por causa do aviso.
    assert.equal((await buscar(minha.centro)).json().resultado, 'nada_mudou');
    await semLeituraEmCurso();
    assert.equal(falso.avisos.pedidos.length, 1);

    // Meia hora depois, com o Regem já aceitando: a leitura seguinte registra — com o MESMO segredo.
    falso.avisos.base = AVISOS;
    await envelhecer(c.conexaoId, { tentadoMin: 29 });
    await buscar(minha.centro);
    await semLeituraEmCurso();
    assert.equal(falso.avisos.pedidos.length, 1, 'antes da meia hora, não');
    await envelhecer(c.conexaoId, { tentadoMin: 31 });
    await buscar(minha.centro);
    await semLeituraEmCurso();
    assert.deepEqual(falso.avisos.pedidos.map((p) => p.status), [422, 200]);
    assert.equal(falso.avisos.pedidos[1]!.corpo!.segredo, primeiro);
    l = (await linhaDe(c.conexaoId))!;
    assert.ok(l.aviso_registrado_em);
  });

  it('o registro é refeito uma vez por dia, com o mesmo endereço e o mesmo segredo — é o que religa um aviso pausado lá', async () => {
    const c = await ligada(minha.centro, 'Centro de lá');
    const [primeiro] = falso.avisos.pedidos;

    await envelhecer(c.conexaoId, { tentadoMin: 19 * 60, registradoH: 19 });
    await buscar(minha.centro);
    await semLeituraEmCurso();
    assert.equal(falso.avisos.pedidos.length, 1, 'com 19 horas, ainda não');

    await envelhecer(c.conexaoId, { tentadoMin: 21 * 60, registradoH: 21 });
    await buscar(minha.centro);
    await semLeituraEmCurso();
    assert.equal(falso.avisos.pedidos.length, 2, 'com 21 horas, sim');
    assert.deepEqual(falso.avisos.pedidos[1]!.corpo, primeiro!.corpo);
    assert.ok(Date.now() - (await linhaDe(c.conexaoId))!.aviso_registrado_em!.getTime() < 15_000);

    // No dia seguinte o Regem deixou de aceitar: o Farol deixa de se dizer registrado — e não erra por isso.
    falso.avisos.base = null;
    await envelhecer(c.conexaoId, { tentadoMin: 21 * 60, registradoH: 21 });
    assert.equal(await garantirAviso(pool, cfg, c.conexaoId, quieto), 'nao_habilitado');
    assert.equal(falso.avisos.pedidos[2]!.status, 422);
    assert.equal((await linhaDe(c.conexaoId))!.aviso_registrado_em, null);
    assert.equal((await buscar(minha.centro)).statusCode, 200, 'a leitura segue');
  });

  it('o endereço do aviso: o de produção quando nada é dito; e o segredo guardado que não abre mais é trocado por um novo', async () => {
    const { AVISO_URL_DE_PRODUCAO, configDoRegem } = await import('../src/regem.js');
    assert.equal(AVISO_URL_DE_PRODUCAO, 'https://api.monitorfarol.com.br/v1/regem/avisos/');
    assert.equal(configDoRegem({}).avisoUrl, AVISO_URL_DE_PRODUCAO);
    assert.equal(configDoRegem({ REGEM_AVISO_URL: 'http://127.0.0.1:3999/v1/regem/avisos' }).avisoUrl, 'http://127.0.0.1:3999/v1/regem/avisos/');
    assert.equal(configDoRegem({ REGEM_AVISO_URL: 'http://127.0.0.1:3999/v1/regem/avisos//' }).avisoUrl, 'http://127.0.0.1:3999/v1/regem/avisos/');

    const c = await ligada(minha.centro, 'Centro de lá');
    const primeiro = (await segredoGuardado(c.conexaoId))!;

    // Sem o endereço na configuração, o Farol pede o de produção (que este Regem de mentira não tem na lista).
    await envelhecer(c.conexaoId, { tentadoMin: 21 * 60, registradoH: 21 });
    assert.equal(await garantirAviso(pool, { ...cfg, avisoUrl: undefined }, c.conexaoId, quieto), 'nao_habilitado');
    assert.equal(falso.avisos.pedidos.at(-1)!.corpo!.url, `${AVISO_URL_DE_PRODUCAO}${c.conexaoId}`);

    // O segredo guardado foi mexido (ou a chave do ambiente mudou): não abre. O registro seguinte sorteia outro.
    await pool.query("update regem_loja set aviso_segredo_cifrado = 'v1.AAAA.BBBB.CCCC' where id = $1", [c.conexaoId]);
    assert.equal((await entregar({ url: `${AVISOS}${c.conexaoId}`, cabecalhos: {}, corpo: '{}' })).statusCode, 404, 'com o segredo ilegível, a conexão não tem como conferir');
    await envelhecer(c.conexaoId, { tentadoMin: 31 });
    assert.equal(await garantirAviso(pool, cfg, c.conexaoId, quieto), 'registrado');
    const segundo = (await segredoGuardado(c.conexaoId))!;
    assert.ok(segundo && segundo !== primeiro);
    assert.equal(falso.avisos.pedidos.at(-1)!.corpo!.segredo, segundo);
    await envelhecer(c.conexaoId, { leituraS: 60 });
    assert.equal((await entregar(falso.avisos.montar(c.id)!)).statusCode, 204, 'e o aviso assinado com o novo vale');
    await semLeituraEmCurso();
  });

  it('o registro que não dá certo: o motivo vai para o registro, nada é apagado, e duas tentativas ao mesmo tempo viram uma', async () => {
    falso.avisos.base = null;
    const c = await ligada(minha.centro, 'Centro de lá');
    falso.avisos.base = AVISOS;
    falso.avisos.pedidos.length = 0;
    const tentar = async () => {
      await envelhecer(c.conexaoId, { tentadoMin: 31 });
      return garantirAviso(pool, cfg, c.conexaoId, quieto);
    };

    for (const modo of ['fora', 'mudo', 'devagar', 'proibido', 'pagina'] as const) {
      falso.modo = modo;
      assert.equal(await tentar(), 'falhou', modo);
      assert.equal((await linhaDe(c.conexaoId))!.aviso_registrado_em, null, modo);
      assert.ok(await segredoGuardado(c.conexaoId), modo);
    }
    falso.modo = 'normal';
    assert.equal((await fichas(minha.centro)).totais.produtos, 4, 'as fichas continuam lá');

    // Sem esperar a meia hora, nem tenta.
    assert.equal(await garantirAviso(pool, cfg, c.conexaoId, quieto), 'nada_a_fazer');

    // Duas ao mesmo tempo: uma pega a vez, a outra não faz nada.
    await envelhecer(c.conexaoId, { tentadoMin: 31 });
    falso.avisos.pedidos.length = 0;
    const juntas = await Promise.all([garantirAviso(pool, cfg, c.conexaoId, quieto), garantirAviso(pool, cfg, c.conexaoId, quieto)]);
    assert.deepEqual(juntas.sort(), ['nada_a_fazer', 'registrado']);
    assert.equal(falso.avisos.pedidos.length, 1);

    // O que não tem o que registrar: instalação sem a chave (nem pega a vez), conexão que não existe, loja ainda sem par.
    await envelhecer(c.conexaoId, { tentadoMin: 21 * 60, registradoH: 21 });
    const antesDaTentativa = (await linhaDe(c.conexaoId))!.aviso_tentado_em!.getTime();
    assert.equal(await garantirAviso(pool, { ...cfg, chave: null }, c.conexaoId, quieto), 'nada_a_fazer');
    assert.equal((await linhaDe(c.conexaoId))!.aviso_tentado_em!.getTime(), antesDaTentativa, 'sem a chave, a tentativa nem é anotada');
    await pool.query('update regem_loja set aviso_registrado_em = now(), aviso_tentado_em = now() where id = $1', [c.conexaoId]);
    assert.equal(await garantirAviso(pool, cfg, randomUUID(), quieto), 'nada_a_fazer');
    await autorizar([{ id: randomUUID(), nome: 'Sem par' }]);
    const semPar = (await pool.query<{ id: string }>('select id from regem_loja where tenant_id = $1 and loja_id is null', [minha.tenantId])).rows[0]!;
    assert.equal(await garantirAviso(pool, cfg, semPar.id, quieto), 'nada_a_fazer');
    assert.equal(falso.avisos.pedidos.length, 1);

    // O acesso guardado que não abre: nem chega a bater no Regem (quem cuida disso é a leitura).
    await pool.query("update regem_loja set acesso_cifrado = 'v1.AAAA.BBBB.CCCC' where id = $1", [c.conexaoId]);
    await envelhecer(c.conexaoId, { tentadoMin: 21 * 60, registradoH: 21 });
    assert.equal(await garantirAviso(pool, cfg, c.conexaoId, quieto), 'falhou');
    assert.equal(falso.avisos.pedidos.length, 1, 'sem acesso legível, nenhum pedido sai');
  });

  // ───────────────────────── receber ─────────────────────────

  it('o aviso chega e o Farol lê na hora: a mudança aparece sem ninguém apertar "Buscar agora"', async () => {
    const c = await ligada(minha.centro, 'Centro de lá');
    assert.equal((await fichas(minha.centro)).totais.comFicha, 1);
    falso.cardapio(c.id, semFichas());
    await envelhecer(c.conexaoId, { leituraS: 60 });

    const r = await entregar(falso.avisos.montar(c.id)!);
    assert.deepEqual([r.statusCode, r.body], [204, '']);
    await semLeituraEmCurso();

    // Perguntou pelos dois com a versão que tinha; só as fichas mudaram, então buscou o cardápio inteiro também.
    assert.equal(leituras(), 3, 'leu o cardápio e as fichas');
    assert.equal(falso.chamadas.filter((x) => x.caminho.includes('?versao=')).length, 2, 'perguntando com a versão que tinha');
    assert.deepEqual((await fichas(minha.centro)).totais, { produtos: 4, comFicha: 0 });
    const l = (await linhaDe(c.conexaoId))!;
    assert.ok(l.aviso_recebido_em && Date.now() - l.aviso_recebido_em.getTime() < 15_000);
    assert.equal(l.aviso_pendente_desde, null, 'a leitura que atendeu o aviso limpou a marca');

    // O tipo do aviso não importa: é só o gatilho. E aviso sem mudança não troca nada.
    await envelhecer(c.conexaoId, { leituraS: 60 });
    falso.chamadas.length = 0;
    assert.equal((await entregar(falso.avisos.montar(c.id, { tipo: 'catalogo.alterado' })!)).statusCode, 204);
    await semLeituraEmCurso();
    assert.equal(leituras(), 2);
    assert.deepEqual((await fichas(minha.centro)).totais, { produtos: 4, comFicha: 0 });
  });

  it('aviso com a leitura recém-feita só marca a loja: quem lê é a rotina, e uma vez só', async () => {
    const c = await ligada(minha.centro, 'Centro de lá');
    falso.cardapio(c.id, semFichas());

    // Três avisos seguidos, logo depois de uma leitura: nenhum vira leitura na hora.
    for (let i = 0; i < 3; i += 1) assert.equal((await entregar(falso.avisos.montar(c.id)!)).statusCode, 204);
    await semLeituraEmCurso();
    assert.equal(leituras(), 0);
    assert.ok((await linhaDe(c.conexaoId))!.aviso_pendente_desde, 'a loja ficou marcada');
    assert.equal((await fichas(minha.centro)).totais.comFicha, 1, 'ainda com a base de antes');

    // A agenda dela é para amanhã — e mesmo assim a rotina a lê, por causa da marca.
    const volta = await lerAsLojasDaVez(pool, cfg, quieto, { contas: contas() });
    assert.deepEqual([volta.lidas, volta.desfechos], [1, { atualizada: 1 }]);
    assert.deepEqual((await fichas(minha.centro)).totais, { produtos: 4, comFicha: 0 });
    assert.equal((await linhaDe(c.conexaoId))!.aviso_pendente_desde, null);
    assert.equal((await lerAsLojasDaVez(pool, cfg, quieto, { contas: contas() })).lidas, 0, 'atendida, não volta à fila');
  });

  it('o aviso que chega no MEIO de uma leitura não se perde: a loja é lida de novo', async () => {
    const c = await ligada(minha.centro, 'Centro de lá');
    await envelhecer(c.conexaoId, { leituraS: 60 });

    falso.segurar();
    const emCurso = buscar(minha.centro);
    while (falso.seguradas() < 2) await new Promise((ok) => setTimeout(ok, 10));
    // A leitura já pegou o retrato de antes; a mudança e o aviso vêm agora.
    falso.cardapio(c.id, semFichas());
    assert.equal((await entregar(falso.avisos.montar(c.id)!)).statusCode, 204);
    falso.soltar();
    assert.equal((await emCurso).statusCode, 200);
    await semLeituraEmCurso();

    assert.ok((await linhaDe(c.conexaoId))!.aviso_pendente_desde, 'o aviso chegou depois de a leitura começar: continua marcado');
    const volta = await lerAsLojasDaVez(pool, cfg, quieto, { contas: contas() });
    assert.equal(volta.lidas, 1);
    assert.deepEqual((await fichas(minha.centro)).totais, { produtos: 4, comFicha: 0 });
    assert.equal((await linhaDe(c.conexaoId))!.aviso_pendente_desde, null);
  });

  it('o que não é aviso do Regem para ESTA conexão é recusado, sem leitura e sem marca', async () => {
    const centro = await ligada(minha.centro, 'Centro de lá');
    const barra = await ligada(minha.barra, 'Barra de lá');
    await envelhecer(centro.conexaoId, { leituraS: 60 });
    await envelhecer(barra.conexaoId, { leituraS: 60 });
    const bom = () => falso.avisos.montar(centro.id)!;
    const invalido = async (r: Awaited<ReturnType<typeof entregar>>, oQue: string) => {
      assert.equal(r.statusCode, 401, oQue);
      assert.deepEqual(Object.keys(r.json()).sort(), ['erro', 'mensagem'], oQue);
      assert.equal(r.json().erro, 'aviso_invalido', oQue);
    };

    await invalido(await entregar(falso.avisos.montar(centro.id, { segredo: novoSegredo() })!), 'assinado com outro segredo');
    await invalido(await entregar(bom(), { corpo: `${bom().corpo} ` }), 'o corpo mexido');
    await invalido(await entregar(falso.avisos.montar(centro.id, { agora: new Date(Date.now() - 6 * 60_000) })!), 'de seis minutos atrás');
    await invalido(await entregar(falso.avisos.montar(centro.id, { agora: new Date(Date.now() + 6 * 60_000) })!), 'de daqui a seis minutos');
    for (const falta of ['webhook-id', 'webhook-timestamp', 'webhook-signature']) await invalido(await entregar(bom(), { cabecalhos: { [falta]: undefined } }), `sem ${falta}`);
    // O aviso da Barra, entregue no endereço do Centro (e o contrário): o segredo é de cada conexão.
    await invalido(await entregar(falso.avisos.montar(barra.id)!, { caminho: new URL(bom().url).pathname }), 'o aviso de outra loja');
    await invalido(await entregar(bom(), { caminho: new URL(falso.avisos.montar(barra.id)!.url).pathname }), 'no endereço de outra loja');
    // Sessão do console não substitui a assinatura.
    await invalido(await entregar(bom(), { cabecalhos: { 'webhook-signature': 'v1,AAAA', cookie: minha.dono } }), 'com sessão de diretoria e assinatura errada');

    const naoExiste = async (r: Awaited<ReturnType<typeof entregar>>, oQue: string) => assert.deepEqual([r.statusCode, r.json().erro], [404, 'nao_encontrado'], oQue);
    await naoExiste(await entregar(bom(), { caminho: `/v1/regem/avisos/${randomUUID()}` }), 'conexão que não existe');
    await naoExiste(await entregar(bom(), { caminho: '/v1/regem/avisos/nao-e-um-id' }), 'id malformado');
    assert.equal((await entregar(bom(), { a: appSemAmbiente })).statusCode, 503, 'instalação sem a chave não tem como conferir');
    assert.equal((await app.inject({ method: 'GET', url: new URL(bom().url).pathname })).statusCode, 404, 'só POST');
    assert.equal((await entregar(bom(), { corpo: 'x'.repeat(5000) })).statusCode, 413, 'corpo grande demais nem é lido');

    await semLeituraEmCurso();
    assert.equal(leituras(), 0, 'nenhuma recusa fez o Farol ler o Regem');
    for (const c of [centro, barra]) {
      const l = (await linhaDe(c.conexaoId))!;
      assert.deepEqual([l.aviso_recebido_em, l.aviso_pendente_desde], [null, null]);
    }
    const escrito = registro.join('');
    assert.ok(escrito.includes('aviso recusado'), 'a recusa fica no registro, com o motivo');
    for (const motivo of ['assinatura', 'fora_do_prazo', 'sem_cabecalho']) assert.ok(escrito.includes(`"motivo":"${motivo}"`), motivo);
    assert.ok(!escrito.includes('whsec_') && !escrito.includes('v1,'), 'sem segredo e sem assinatura no registro');

    // E o aviso certo continua valendo depois de tudo isso.
    assert.equal((await entregar(bom())).statusCode, 204);
    await semLeituraEmCurso();
    assert.equal(leituras(), 2);
  });

  // ───────────────────────── o fim da conexão ─────────────────────────

  it('desconectada: a conexão responde 404 ao aviso — é o que faz o Regem parar de avisar', async () => {
    const c = await ligada(minha.centro, 'Centro de lá');
    const aviso = falso.avisos.montar(c.id)!;
    const r = await app.inject({ method: 'POST', url: `/v1/regem/lojas/${c.conexaoId}/desconectar`, headers: { cookie: minha.dono } });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(falso.avisos.registroDe(c.id), null, 'no Regem, o registro saiu com o acesso');

    assert.equal((await entregar(aviso)).statusCode, 404);
    await semLeituraEmCurso();
    assert.equal(leituras(), 0);
  });

  it('acesso tirado no Regem: o segredo do aviso sai junto; conectar de novo registra com o acesso novo', async () => {
    const c = await ligada(minha.centro, 'Centro de lá');
    const aviso = falso.avisos.montar(c.id)!;
    const antigo = (await segredoGuardado(c.conexaoId))!;
    const { rows } = await pool.query('select tenant_id, regem_loja_id, acesso_cifrado from regem_loja where id = $1', [c.conexaoId]);
    falso.tirar(decifrar(rows[0].acesso_cifrado, cfg.chave, `acesso:${rows[0].tenant_id}:${rows[0].regem_loja_id}`)!);

    assert.equal((await buscar(minha.centro)).json().erro, 'acesso_tirado');
    await semLeituraEmCurso();
    const l = (await linhaDe(c.conexaoId))!;
    assert.deepEqual([l.aviso_segredo_cifrado, l.aviso_registrado_em], [null, null]);
    assert.equal((await entregar(aviso)).statusCode, 404, 'o aviso de antes não acha mais a conexão');
    // Sem acesso não há o que registrar, por mais tempo que passe.
    falso.avisos.pedidos.length = 0;
    await envelhecer(c.conexaoId, { tentadoMin: 21 * 60 });
    assert.equal(await garantirAviso(pool, cfg, c.conexaoId, quieto), 'nada_a_fazer');
    assert.equal(falso.avisos.pedidos.length, 0);

    // Conectar de novo: a mesma loja de lá, um acesso novo — e um registro novo.
    falso.avisos.pedidos.length = 0;
    await autorizar([{ id: c.id, nome: c.nome }]);
    await semLeituraEmCurso();
    assert.deepEqual(falso.avisos.pedidos.map((p) => [p.metodo, p.status]), [['PUT', 200]]);
    const novo = (await segredoGuardado(c.conexaoId))!;
    assert.ok(novo && novo !== antigo, 'segredo novo');
    assert.ok((await linhaDe(c.conexaoId))!.aviso_registrado_em);
    assert.equal((await entregar(aviso)).statusCode, 401, 'o aviso assinado com o segredo de antes não vale mais');
    await envelhecer(c.conexaoId, { leituraS: 60 });
    assert.equal((await entregar(falso.avisos.montar(c.id)!)).statusCode, 204);
    await semLeituraEmCurso();
  });

  it('autorizar de novo com a loja ainda ligada: o acesso troca, e o aviso é registrado de novo com o MESMO segredo', async () => {
    const c = await ligada(minha.centro, 'Centro de lá');
    const segredo = (await segredoGuardado(c.conexaoId))!;
    falso.avisos.pedidos.length = 0;

    await autorizar([{ id: c.id, nome: c.nome }]);
    await semLeituraEmCurso();
    assert.deepEqual(falso.avisos.pedidos.map((p) => [p.metodo, p.status, p.corpo!.segredo]), [['PUT', 200, segredo]]);
    assert.deepEqual(falso.avisos.registroDe(c.id), { url: `${AVISOS}${c.conexaoId}`, segredo }, 'o registro é do acesso novo');
    await envelhecer(c.conexaoId, { leituraS: 60 });
    assert.equal((await entregar(falso.avisos.montar(c.id)!)).statusCode, 204);
    await semLeituraEmCurso();
  });
});
