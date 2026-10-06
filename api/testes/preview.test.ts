// =====================================================================
// O quadro de preview, pelo caminho inteiro
// =====================================================================
// Console pede → comando pendente → agente entrega → console desenha.
// Contra Postgres real: o fluxo atravessa três tabelas e uma transação,
// e nada disso se verifica em dublê.
// =====================================================================

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';

const URL = process.env.DATABASE_URL;
const marca = `teste-prev-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-prev';
const SENHA = 'senha-de-teste-9876';

// JPEG mínimo válido: cabeçalho SOI + APP0 + EOI. Não precisa ser imagem
// de verdade — o que se testa é o caminho dos bytes.
const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00,
  0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

describe('preview do canal (Postgres real)', { skip: !URL && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let lojaId: string;
  let pontoId: string;
  let tokenAgente: string;
  let cookie: string;
  let adminAntes: string | undefined;

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;

    pool = new pg.Pool({ connectionString: URL });
    const t = await pool.query('insert into tenant (nome) values ($1) returning id', [marca]);
    const l = await pool.query(
      'insert into loja (tenant_id, nome) values ($1,$2) returning id',
      [t.rows[0].id, 'loja do preview'],
    );
    lojaId = l.rows[0].id;

    const st = await pool.query(
      'insert into setor (loja_id, nome) values ($1,$2) returning id',
      [lojaId, 'cozinha'],
    );
    const p = await pool.query(
      `insert into ponto (setor_id, nome, canal) values ($1,'bancada',1) returning id`,
      [st.rows[0].id],
    );
    pontoId = p.rows[0].id;

    app = criarApp(pool, { logger: false });
    await app.ready();

    // usuário do console
    const email = `prev-${randomUUID().slice(0, 8)}@exemplo.com`;
    const u = await app.inject({
      method: 'POST',
      url: '/v1/distribuicao/usuarios',
      headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId: t.rows[0].id, nome: 'Dono', email, senha: SENHA, nivel: 'presidente' },
    });
    assert.equal(u.statusCode, 201, u.body);

    const login = await app.inject({
      method: 'POST',
      url: '/v1/sessao',
      payload: { email, senha: SENHA },
    });
    assert.equal(login.statusCode, 200, login.body);
    const bruto = login.headers['set-cookie'];
    cookie = (Array.isArray(bruto) ? bruto[0]! : String(bruto)).split(';')[0]!;

    // agente ativo da loja
    const criado = await app.inject({
      method: 'POST',
      url: '/v1/distribuicao/agentes',
      headers: { 'x-farol-admin': ADMIN },
      payload: { lojaId, nome: 'agente-prev' },
    });
    tokenAgente = (criado.json() as { token: string }).token;
    await app.inject({
      method: 'POST',
      url: '/v1/agentes/ativar',
      headers: { authorization: `Bearer ${tokenAgente}` },
      payload: { fingerprint: 'maquina-prev', versao: '0.1.0' },
    });
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  const comoConsole = () => ({ cookie });
  const comoAgente = () => ({ authorization: `Bearer ${tokenAgente}` });

  async function pedirPreview() {
    return app.inject({
      method: 'POST',
      url: `/v1/pontos/${pontoId}/preview`,
      headers: comoConsole(),
    });
  }

  async function entregar(comandoId: string, corpo: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: `/v1/agentes/comandos/${comandoId}/resultado`,
      headers: comoAgente(),
      payload: corpo,
    });
  }

  // ───────────────────────── o caminho feliz ─────────────────────────

  it('console pede, agente recebe pelo heartbeat, entrega e a imagem volta', async () => {
    const pedido = await pedirPreview();
    assert.equal(pedido.statusCode, 202, pedido.body);
    const { comandoId } = pedido.json() as { comandoId: string };

    const h = await app.inject({
      method: 'POST',
      url: '/v1/agentes/heartbeat',
      headers: comoAgente(),
      payload: {},
    });
    const comandos = (h.json() as { comandos: { id: string; pontoId: string }[] }).comandos;
    assert.equal(comandos.length, 1);
    assert.equal(comandos[0].id, comandoId);
    assert.equal(comandos[0].pontoId, pontoId);

    const r = await entregar(comandoId, {
      imagemBase64: JPEG.toString('base64'),
      tipo: 'image/jpeg',
      largura: 1280,
      altura: 720,
    });
    assert.equal(r.statusCode, 200, r.body);

    const img = await app.inject({
      method: 'GET',
      url: `/v1/pontos/${pontoId}/preview`,
      headers: comoConsole(),
    });
    assert.equal(img.statusCode, 200);
    assert.equal(img.headers['content-type'], 'image/jpeg');
    assert.equal(img.headers['cache-control'], 'no-store');
    assert.deepEqual(img.rawPayload, JPEG);
  });

  it('o quadro capturado preenche resolucao_h sozinho', async () => {
    // Medir vence perguntar: o diagnóstico deixa de exigir um número que
    // o sistema tinha como descobrir.
    const { rows } = await pool.query('select resolucao_h from ponto where id = $1', [pontoId]);
    assert.equal(rows[0].resolucao_h, 1280);
  });

  it('não sobrescreve a resolução que alguém informou à mão', async () => {
    // Quem mediu com fita sabe mais que o quadro: `coalesce` mantém.
    await pool.query('update ponto set resolucao_h = 1920 where id = $1', [pontoId]);

    const pedido = await pedirPreview();
    const { comandoId } = pedido.json() as { comandoId: string };
    await app.inject({ method: 'POST', url: '/v1/agentes/heartbeat', headers: comoAgente(), payload: {} });
    await entregar(comandoId, { imagemBase64: JPEG.toString('base64'), largura: 640, altura: 360 });

    const { rows } = await pool.query('select resolucao_h from ponto where id = $1', [pontoId]);
    assert.equal(rows[0].resolucao_h, 1920, 'o valor informado foi atropelado');
  });

  it('o estado conta em que pé está o pedido', async () => {
    const r = await app.inject({
      method: 'GET',
      url: `/v1/pontos/${pontoId}/preview/estado`,
      headers: comoConsole(),
    });
    const e = r.json() as { temPreview: boolean; largura: number; pedido: { estado: string } };

    assert.equal(e.temPreview, true);
    assert.equal(e.largura, 640);
    assert.equal(e.pedido.estado, 'concluido');
  });

  // ──────────────────── o que impede desperdício ────────────────────

  it('clicar duas vezes em atualizar não vira duas capturas', async () => {
    const um = await pedirPreview();
    const dois = await pedirPreview();

    assert.equal((um.json() as { jaPedido: boolean }).jaPedido, false);
    assert.equal((dois.json() as { jaPedido: boolean }).jaPedido, true);
    assert.equal(
      (um.json() as { comandoId: string }).comandoId,
      (dois.json() as { comandoId: string }).comandoId,
    );

    await pool.query(`delete from comando_agente where ponto_id = $1 and estado='pendente'`, [pontoId]);
  });

  it('reenvio do mesmo comando não é erro', async () => {
    // Retentativa do agente depois de a resposta se perder. Responder 409
    // faria ele tratar como falha e tentar de novo para sempre.
    const pedido = await pedirPreview();
    const { comandoId } = pedido.json() as { comandoId: string };
    await app.inject({ method: 'POST', url: '/v1/agentes/heartbeat', headers: comoAgente(), payload: {} });

    await entregar(comandoId, { imagemBase64: JPEG.toString('base64') });
    const segundo = await entregar(comandoId, { imagemBase64: JPEG.toString('base64') });

    assert.equal(segundo.statusCode, 200);
    assert.equal((segundo.json() as { jaConcluido: boolean }).jaConcluido, true);
  });

  // ──────────────────────── quando dá errado ────────────────────────

  it('falha do agente é registrada, não some', async () => {
    // Comando que fracassa em silêncio deixa a tela girando, e quem está
    // lá não sabe se a câmera caiu ou se o agente nem recebeu.
    const pedido = await pedirPreview();
    const { comandoId } = pedido.json() as { comandoId: string };
    await app.inject({ method: 'POST', url: '/v1/agentes/heartbeat', headers: comoAgente(), payload: {} });

    const r = await entregar(comandoId, { erro: 'canal 1 não abriu: timeout no RTSP' });
    assert.equal(r.statusCode, 200);

    const estado = await app.inject({
      method: 'GET',
      url: `/v1/pontos/${pontoId}/preview/estado`,
      headers: comoConsole(),
    });
    const e = estado.json() as { pedido: { estado: string; erro: string } };
    assert.equal(e.pedido.estado, 'falhou');
    assert.match(e.pedido.erro, /timeout no RTSP/);
  });

  it('loja sem agente ativo recusa na hora, com o motivo', async () => {
    // Melhor que uma tela girando para sempre esperando por uma loja
    // desligada.
    await pool.query(`update agente set estado = 'inativo' where loja_id = $1`, [lojaId]);

    const r = await pedirPreview();
    assert.equal(r.statusCode, 409);
    assert.equal((r.json() as { erro: string }).erro, 'sem_agente');
    assert.match((r.json() as { mensagem: string }).mensagem, /agente instalado na loja/);

    await pool.query(`update agente set estado = 'ativo' where loja_id = $1`, [lojaId]);
  });

  it('agente de OUTRA loja não grava imagem neste comando', async () => {
    // A ameaça real: um token copiado de uma loja mandando imagem para o
    // ponto de outra. O agente intruso nasce em loja própria de propósito
    // — dois agentes na mesma loja são legítimos, e criá-lo aqui mudaria
    // qual deles recebe os comandos seguintes.
    const t2 = await pool.query('insert into tenant (nome) values ($1) returning id', [
      `${marca}-intruso`,
    ]);
    const l2 = await pool.query(
      'insert into loja (tenant_id, nome) values ($1,$2) returning id',
      [t2.rows[0].id, 'loja do intruso'],
    );
    const outro = await app.inject({
      method: 'POST',
      url: '/v1/distribuicao/agentes',
      headers: { 'x-farol-admin': ADMIN },
      payload: { lojaId: l2.rows[0].id, nome: 'agente-intruso' },
    });
    const tokenOutro = (outro.json() as { token: string }).token;
    await app.inject({
      method: 'POST',
      url: '/v1/agentes/ativar',
      headers: { authorization: `Bearer ${tokenOutro}` },
      payload: { fingerprint: 'maquina-intrusa' },
    });

    // O comando é criado direto para o agente DESTA loja: assim o teste
    // não depende de qual agente a rota escolheria.
    const meu = await pool.query(
      `select id from agente where loja_id = $1 and nome = 'agente-prev'`,
      [lojaId],
    );
    const c = await pool.query(
      `insert into comando_agente (agente_id, tipo, ponto_id)
       values ($1,'capturar_quadro',$2) returning id`,
      [meu.rows[0].id, pontoId],
    );

    const r = await app.inject({
      method: 'POST',
      url: `/v1/agentes/comandos/${c.rows[0].id}/resultado`,
      headers: { authorization: `Bearer ${tokenOutro}` },
      payload: { imagemBase64: JPEG.toString('base64') },
    });
    assert.equal(r.statusCode, 404, 'token de outro agente não pode gravar aqui');

    await pool.query('delete from comando_agente where id = $1', [c.rows[0].id]);
  });

  it('tipo de arquivo fora da lista é recusado', async () => {
    const pedido = await pedirPreview();
    const { comandoId } = pedido.json() as { comandoId: string };

    const r = await entregar(comandoId, {
      imagemBase64: JPEG.toString('base64'),
      tipo: 'application/x-msdownload',
    });
    assert.equal(r.statusCode, 422);
    assert.equal((r.json() as { erro: string }).erro, 'tipo_invalido');

    await pool.query(`delete from comando_agente where ponto_id = $1 and estado='pendente'`, [pontoId]);
  });

  it('sem imagem e sem erro é pedido malformado', async () => {
    const pedido = await pedirPreview();
    const { comandoId } = pedido.json() as { comandoId: string };

    const r = await entregar(comandoId, {});
    assert.equal(r.statusCode, 422);

    await pool.query(`delete from comando_agente where ponto_id = $1 and estado='pendente'`, [pontoId]);
  });

  // ───────────────────────── isolamento ─────────────────────────

  it('ponto de outro tenant é 404, não 403', async () => {
    // 403 confirmaria que o id existe — a resposta viraria oráculo de
    // quais pontos há no sistema.
    const t2 = await pool.query('insert into tenant (nome) values ($1) returning id', [
      `${marca}-alheio`,
    ]);
    const l2 = await pool.query(
      'insert into loja (tenant_id, nome) values ($1,$2) returning id',
      [t2.rows[0].id, 'loja alheia'],
    );
    const st2 = await pool.query(
      'insert into setor (loja_id, nome) values ($1,$2) returning id',
      [l2.rows[0].id, 'setor'],
    );
    const p2 = await pool.query(
      `insert into ponto (setor_id, nome) values ($1,'camera alheia') returning id`,
      [st2.rows[0].id],
    );

    for (const caminho of ['', '/estado']) {
      const r = await app.inject({
        method: 'GET',
        url: `/v1/pontos/${p2.rows[0].id}/preview${caminho}`,
        headers: comoConsole(),
      });
      assert.equal(r.statusCode, 404, caminho);
    }

    const post = await app.inject({
      method: 'POST',
      url: `/v1/pontos/${p2.rows[0].id}/preview`,
      headers: comoConsole(),
    });
    assert.equal(post.statusCode, 404);
  });

  it('sem sessão nenhuma rota de console responde', async () => {
    for (const [metodo, caminho] of [
      ['GET', ''],
      ['GET', '/estado'],
      ['POST', ''],
    ] as const) {
      const r = await app.inject({
        method: metodo,
        url: `/v1/pontos/${pontoId}/preview${caminho}`,
      });
      assert.equal(r.statusCode, 401, `${metodo} ${caminho}`);
    }
  });
});

describe('a área desenhada no preview', { skip: !URL && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let pontoId: string;
  let zonaId: string;
  let cookie: string;
  let adminAntes: string | undefined;
  const m2 = `teste-area-${randomUUID().slice(0, 8)}`;

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL });

    const t = await pool.query('insert into tenant (nome) values ($1) returning id', [m2]);
    const l = await pool.query(
      'insert into loja (tenant_id, nome) values ($1,$2) returning id',
      [t.rows[0].id, 'loja da área'],
    );
    const st = await pool.query(
      'insert into setor (loja_id, nome) values ($1,$2) returning id',
      [l.rows[0].id, 'cozinha'],
    );
    const p = await pool.query(
      `insert into ponto (setor_id, nome, canal) values ($1,'bancada',1) returning id`,
      [st.rows[0].id],
    );
    pontoId = p.rows[0].id;
    const z = await pool.query(
      `insert into zona (ponto_id, nome, poligono, principal)
       values ($1,'Quadro inteiro','[[0,0],[1,0],[1,1],[0,1]]'::jsonb,true) returning id`,
      [pontoId],
    );
    zonaId = z.rows[0].id;

    app = criarApp(pool, { logger: false });
    await app.ready();

    const email = `area-${randomUUID().slice(0, 8)}@exemplo.com`;
    await app.inject({
      method: 'POST',
      url: '/v1/distribuicao/usuarios',
      headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId: t.rows[0].id, nome: 'D', email, senha: SENHA, nivel: 'presidente' },
    });
    const login = await app.inject({
      method: 'POST', url: '/v1/sessao', payload: { email, senha: SENHA },
    });
    const bruto = login.headers['set-cookie'];
    cookie = (Array.isArray(bruto) ? bruto[0]! : String(bruto)).split(';')[0]!;
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    await pool?.query('delete from tenant where nome like $1', [`${m2}%`]);
    await pool?.end();
  });

  const comoConsole = () => ({ cookie });

  async function salvar(corpo: Record<string, unknown>) {
    return app.inject({
      method: 'PATCH',
      url: `/v1/zonas/${zonaId}`,
      headers: comoConsole(),
      payload: corpo,
    });
  }

  it('o canal volta com as zonas e os polígonos', async () => {
    const r = await app.inject({
      method: 'GET', url: `/v1/pontos/${pontoId}`, headers: comoConsole(),
    });
    assert.equal(r.statusCode, 200, r.body);
    const d = r.json() as { ponto: { nome: string }; zonas: { principal: boolean }[] };
    assert.equal(d.ponto.nome, 'bancada');
    assert.equal(d.zonas[0].principal, true);
  });

  it('o GET do canal não traz os bytes do preview', async () => {
    // Algumas centenas de kB junto de um JSON de texto, em toda abertura
    // da tela, seria desperdício invisível até alguém medir.
    const r = await app.inject({
      method: 'GET', url: `/v1/pontos/${pontoId}`, headers: comoConsole(),
    });
    assert.ok(!('preview' in (r.json() as { ponto: object }).ponto));
  });

  it('salva o retângulo desenhado', async () => {
    const r = await salvar({
      poligono: [[0.15, 0.47], [0.85, 0.47], [0.85, 0.8], [0.15, 0.8]],
      larguraCenaCm: 40,
    });
    assert.equal(r.statusCode, 200, r.body);
    const z = r.json() as { poligono: number[][]; largura_cena_cm: string };
    assert.deepEqual(z.poligono[0], [0.15, 0.47]);
    assert.equal(Number(z.largura_cena_cm), 40);
  });

  it('apagar a largura é diferente de não mexer nela', async () => {
    // Com `coalesce` puro não haveria como gravar nulo de propósito: a
    // pessoa tiraria o número do campo e ele voltaria sozinho.
    await salvar({ larguraCenaCm: 40 });
    const r = await salvar({ larguraCenaCm: null });
    assert.equal((r.json() as { largura_cena_cm: null }).largura_cena_cm, null);

    await salvar({ larguraCenaCm: 55 });
    const semMexer = await salvar({ nome: 'outro nome' });
    assert.equal(Number((semMexer.json() as { largura_cena_cm: string }).largura_cena_cm), 55);
  });

  it('coordenada em pixel é recusada com a razão', async () => {
    // Polígono inválido não dá erro visível: dá recorte errado, e o modelo
    // responde com confiança sobre o lugar errado.
    const r = await salvar({ poligono: [[0, 0], [1920, 0], [1920, 1080], [0, 1080]] });
    assert.equal(r.statusCode, 422);
    assert.match((r.json() as { mensagem: string }).mensagem, /fração do quadro/);
  });

  it('polígono degenerado é recusado', async () => {
    for (const ruim of [
      [[0, 0], [1, 1]],
      'não é lista',
      [[0, 0], [1, 0], ['a', 1]],
      [[0, 0], [1, 0], [1, 1, 1]],
    ]) {
      const r = await salvar({ poligono: ruim });
      assert.equal(r.statusCode, 422, JSON.stringify(ruim));
    }
  });

  it('marcar outra zona como principal desmarca a anterior', async () => {
    // O índice único recusaria duas; sem desmarcar antes, o usuário veria
    // "erro ao salvar" sem entender por quê.
    const outra = await pool.query(
      `insert into zona (ponto_id, nome, poligono) 
       values ($1,'zona fina','[[0.4,0.4],[0.6,0.4],[0.6,0.6],[0.4,0.6]]'::jsonb)
       returning id`,
      [pontoId],
    );

    const r = await app.inject({
      method: 'PATCH',
      url: `/v1/zonas/${outra.rows[0].id}`,
      headers: comoConsole(),
      payload: { principal: true },
    });
    assert.equal(r.statusCode, 200, r.body);

    const { rows } = await pool.query(
      'select id, principal from zona where ponto_id = $1 order by principal desc',
      [pontoId],
    );
    assert.equal(rows.filter((z) => z.principal).length, 1);
    assert.equal(rows[0].id, outra.rows[0].id);

    await pool.query('delete from zona where id = $1', [outra.rows[0].id]);
    await pool.query('update zona set principal = true where id = $1', [zonaId]);
  });

  it('zona de outro tenant é 404', async () => {
    const t2 = await pool.query('insert into tenant (nome) values ($1) returning id', [
      `${m2}-alheio`,
    ]);
    const l2 = await pool.query(
      'insert into loja (tenant_id, nome) values ($1,$2) returning id',
      [t2.rows[0].id, 'alheia'],
    );
    const st2 = await pool.query(
      'insert into setor (loja_id, nome) values ($1,$2) returning id', [l2.rows[0].id, 's'],
    );
    const p2 = await pool.query(
      `insert into ponto (setor_id, nome) values ($1,'x') returning id`, [st2.rows[0].id],
    );
    const z2 = await pool.query(
      `insert into zona (ponto_id, nome, poligono)
       values ($1,'z','[[0,0],[1,0],[1,1]]'::jsonb) returning id`, [p2.rows[0].id],
    );

    const r = await app.inject({
      method: 'PATCH', url: `/v1/zonas/${z2.rows[0].id}`,
      headers: comoConsole(), payload: { nome: 'invadida' },
    });
    assert.equal(r.statusCode, 404);
  });

  it('sem sessão não salva', async () => {
    const r = await app.inject({
      method: 'PATCH', url: `/v1/zonas/${zonaId}`, payload: { nome: 'x' },
    });
    assert.equal(r.statusCode, 401);
  });
});

describe('pedido sem corpo (ERR-012)', { skip: !URL && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;

  before(async () => {
    pool = new pg.Pool({ connectionString: URL });
    app = criarApp(pool, { logger: false });
    await app.ready();
  });

  after(async () => {
    await app?.close();
    await pool?.end();
  });

  it('POST sem corpo e sem content-type chega na rota', async () => {
    // O cliente do console manda POST vazio em "pedir preview", "sair" e
    // "desativar ponto". Se a rota só funcionasse com corpo, as três
    // quebrariam — e quebraram, em 06/10/2026, porque o cliente mandava
    // `content-type: application/json` sem nada dentro.
    //
    // 401 aqui é o certo: significa que o pedido ATRAVESSOU o parser e
    // chegou na checagem de sessão. 400 significaria que morreu antes.
    const r = await app.inject({
      method: 'POST',
      url: '/v1/pontos/00000000-0000-0000-0000-000000000000/preview',
    });
    assert.equal(r.statusCode, 401, r.body);
  });

  it('POST com content-type json e corpo VAZIO é 400 — agora explicado', async () => {
    // Este teste nasceu afirmando o formato VAZADO do Fastify
    // (`FST_ERR_CTP_EMPTY_JSON_BODY`, sem `mensagem`), que era a causa de
    // a tela mostrar texto genérico. Com `instalarTratamentoDeErros` o
    // mesmo 400 passa a falar o contrato da casa — e o teste vira a
    // guarda disso.
    //
    // O cliente continua não podendo prometer JSON sem mandar; o que
    // mudou é que agora o servidor explica em pt-BR por quê.
    const r = await app.inject({
      method: 'POST',
      url: '/v1/pontos/00000000-0000-0000-0000-000000000000/preview',
      headers: { 'content-type': 'application/json' },
      payload: '',
    });
    assert.equal(r.statusCode, 400);

    const corpo = r.json() as { erro: string; mensagem: string };
    assert.equal(corpo.erro, 'corpo_invalido');
    assert.match(corpo.mensagem, /content-type/);
  });

  it('DELETE sem corpo também atravessa', async () => {
    const r = await app.inject({ method: 'DELETE', url: '/v1/sessao' });
    assert.notEqual(r.statusCode, 400, r.body);
  });
});
