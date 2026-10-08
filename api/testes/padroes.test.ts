// A foto padrão do canal (migration 024), de ponta a ponta na API:
//
//   - guardar é COPIAR o quadro que o canal já tem — a imagem não passa pelo
//     console, e a cópia não muda quando o quadro é atualizado depois;
//   - no máximo quatro por canal, nome sem repetir, só quem configura guarda
//     e exclui, e outra conta nem sabe que a foto existe;
//   - a listagem não traz os bytes;
//   - o agente recebe a lista com o resumo de cada imagem e baixa a dele —
//     nunca a de outra loja; guardar e excluir sobem a versão da configuração;
//   - o quadro passa a dizer quantas pessoas o detector da loja viu.

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { lerNomeDaFoto, MAX_PADROES_POR_CANAL } from '../src/rotas/padroes.js';

// Dois "JPEG" diferentes: cabeçalho SOI + APP0, um miolo que os distingue, EOI.
const imagem = (miolo: number) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, miolo, 0xff, 0xd9]);
const NOITE = imagem(1);
const DIA = imagem(2);
const resumo = (b: Buffer) => createHash('sha256').update(b).digest('hex');

// O mesmo arquivo que o agente lê (agent/testes/test_foto_padrao.py): o que
// a configuração leva de cada foto, a escolha do critério e o que o agente
// manda com o quadro. Mudou o formato de um lado, o teste do outro quebra.
const CONTRATO = JSON.parse(
  readFileSync(new URL('../../contratos/foto-padrao.json', import.meta.url), 'utf8'),
) as {
  configuracao: { padroesDoPonto: Record<string, string>[]; regra: Record<string, unknown> };
  quadro: { pessoas: number };
};

describe('o nome da foto padrão (sem banco)', () => {
  it('aceita e apara', () => {
    assert.deepEqual(lerNomeDaFoto('  Noite, loja aberta '), { nome: 'Noite, loja aberta' });
    assert.deepEqual(lerNomeDaFoto('x'.repeat(60)), { nome: 'x'.repeat(60) });
  });
  it('recusa vazio, só espaço, o que não é texto e o comprido demais', () => {
    for (const ruim of ['', '   ', undefined, null, 7, 'x'.repeat(61)]) {
      assert.ok(lerNomeDaFoto(ruim).problema, JSON.stringify(ruim));
    }
  });
  it('o máximo por canal é quatro', () => assert.equal(MAX_PADROES_POR_CANAL, 4));
});

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-padrao-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-padrao';
const SENHA = 'uma senha longa o bastante';

describe('foto padrão do canal (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  let lojaId = '';
  let setorId = '';
  let cookie = '';
  let cookieSupervisao = '';
  let cookieVizinho = '';
  let token = '';
  let tokenVizinho = '';
  let canais = 0;

  async function entrar(tenantId: string, email: string, nivel: string, nome = 'X') {
    await app.inject({
      method: 'POST', url: '/v1/distribuicao/usuarios', headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId, nome, email, senha: SENHA, nivel },
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

  /** Um canal novo, ainda sem quadro. */
  async function canalNovo(nome: string) {
    canais += 1;
    const r = await app.inject({
      method: 'POST', url: `/v1/setores/${setorId}/pontos`, headers: { cookie },
      payload: { nome, origem: 'dvr', canal: canais, host: '192.168.1.108' },
    });
    assert.equal(r.statusCode, 201, r.body);
    return { id: r.json().id as string, zona: r.json().zonas[0].id as string };
  }
  /** O console pede o quadro, o agente o entrega. */
  async function darQuadro(pontoId: string, bytes: Buffer, mais: Record<string, unknown> = {}) {
    const pedido = await app.inject({ method: 'POST', url: `/v1/pontos/${pontoId}/preview`, headers: { cookie } });
    assert.equal(pedido.statusCode, 202, pedido.body);
    await app.inject({ method: 'POST', url: '/v1/agentes/heartbeat', headers: { authorization: `Bearer ${token}` }, payload: {} });
    const r = await app.inject({
      method: 'POST', url: `/v1/agentes/comandos/${pedido.json().comandoId}/resultado`, headers: { authorization: `Bearer ${token}` },
      payload: { imagemBase64: bytes.toString('base64'), largura: 1920, altura: 1080, ...mais },
    });
    assert.equal(r.statusCode, 200, r.body);
  }
  const estado = async (pontoId: string) =>
    (await app.inject({ method: 'GET', url: `/v1/pontos/${pontoId}/preview/estado`, headers: { cookie } })).json();
  const guardar = (pontoId: string, nome: unknown, comCookie = cookie) =>
    app.inject({ method: 'POST', url: `/v1/pontos/${pontoId}/padroes`, headers: { cookie: comCookie }, payload: { nome } });
  const listar = (pontoId: string, comCookie = cookie) =>
    app.inject({ method: 'GET', url: `/v1/pontos/${pontoId}/padroes`, headers: { cookie: comCookie } });
  const ver = (id: string, comCookie: string | null = cookie) =>
    app.inject({ method: 'GET', url: `/v1/padroes/${id}/imagem`, headers: comCookie ? { cookie: comCookie } : {} });
  const excluir = (id: string, comCookie = cookie) =>
    app.inject({ method: 'DELETE', url: `/v1/padroes/${id}`, headers: { cookie: comCookie } });
  const doAgente = (url: string, comToken: string | null = token) =>
    app.inject({ method: 'GET', url, headers: comToken ? { authorization: `Bearer ${comToken}` } : {} });
  const versao = async () => (await pool.query('select config_versao from loja where id = $1', [lojaId])).rows[0].config_versao as number;
  const naConfiguracao = async (pontoId: string) => {
    const c = (await doAgente('/v1/agentes/configuracao')).json();
    return c.pontos.find((p: { id: string }) => p.id === pontoId) as { padroes: { id: string; nome: string; sha256: string }[]; zonas: { regras: Record<string, unknown>[] }[] } | undefined;
  };

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
    cookie = await entrar(conta.tenantId, `ger-${marca}@e.com`, 'gerente', 'Ana Souza');
    cookieSupervisao = await entrar(conta.tenantId, `sup-${marca}@e.com`, 'supervisao');
    token = await novoAgente(lojaId, marca);

    const vizinha = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome: `${marca}-vizinha` }, loja: { nome: 'Vizinha' }, setores: [] },
    })).json();
    cookieVizinho = await entrar(vizinha.tenantId, `ger-${marca}-viz@e.com`, 'gerente');
    tokenVizinho = await novoAgente(vizinha.loja.id, `${marca}-viz`);
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  // ───────────────────── o quadro e as pessoas ─────────────────────

  it('o quadro diz quantas pessoas o detector da loja viu', async () => {
    const c = await canalNovo('Chapa');
    await darQuadro(c.id, NOITE, { pessoas: 3 });
    assert.equal((await estado(c.id)).pessoas, 3);
    await darQuadro(c.id, NOITE, { pessoas: 0 });
    assert.equal((await estado(c.id)).pessoas, 0, 'zero é medida: não há ninguém');
  });

  it('sem a medida, o quadro entra do mesmo jeito — e "não medi" não é zero', async () => {
    const c = await canalNovo('Sem detector');
    await darQuadro(c.id, NOITE, { pessoas: 2 });
    // agente sem detector: o quadro novo não herda a contagem do anterior
    await darQuadro(c.id, DIA);
    const e = await estado(c.id);
    assert.equal(e.temPreview, true);
    assert.equal(e.pessoas, null);

    for (const torto of [-1, 2.5, '3', 5000]) {
      await darQuadro(c.id, DIA, { pessoas: torto });
      assert.equal((await estado(c.id)).pessoas, null, String(torto));
    }
  });

  // ───────────────────────── guardar ─────────────────────────

  it('canal sem quadro não tem o que guardar', async () => {
    const c = await canalNovo('Sem quadro');
    const r = await guardar(c.id, 'Noite');
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().erro, 'sem_quadro');
    assert.match(r.json().mensagem, /Atualize o quadro/);
  });

  it('guardar copia o quadro de agora, com quem guardou e o que o detector viu', async () => {
    const c = await canalNovo('Montagem');
    await darQuadro(c.id, NOITE, { pessoas: 4 });

    const r = await guardar(c.id, '  Noite, loja aberta ');
    assert.equal(r.statusCode, 201, r.body);
    const f = r.json();
    assert.equal(f.nome, 'Noite, loja aberta');
    assert.equal(f.pessoas, 4);
    assert.equal(f.criadaPor, 'Ana Souza');
    assert.equal(f.pontoId, c.id);
    assert.equal(f.largura, 1920);
    assert.ok(f.capturadaEm && f.criadaEm);
    assert.equal('imagem' in f, false, 'a resposta não carrega a imagem');

    const { rows } = await pool.query('select imagem, sha256, tipo from foto_padrao where id = $1', [f.id]);
    assert.deepEqual(rows[0].imagem, NOITE);
    assert.equal(rows[0].sha256, resumo(NOITE));
    assert.equal(rows[0].tipo, 'image/jpeg');

    const img = await ver(f.id);
    assert.equal(img.statusCode, 200);
    assert.deepEqual(img.rawPayload, NOITE);
    assert.equal(img.headers['content-type'], 'image/jpeg');
    assert.match(String(img.headers['cache-control']), /private/);
  });

  it('a foto guardada é uma CÓPIA: atualizar o quadro depois não mexe nela', async () => {
    const c = await canalNovo('Cópia');
    await darQuadro(c.id, NOITE);
    const f = (await guardar(c.id, 'Noite')).json();

    await darQuadro(c.id, DIA);

    assert.deepEqual((await ver(f.id)).rawPayload, NOITE);
    const outra = (await guardar(c.id, 'Dia')).json();
    assert.deepEqual((await ver(outra.id)).rawPayload, DIA);
  });

  it('a lista vem da mais nova para a mais antiga, sem os bytes', async () => {
    const c = await canalNovo('Lista');
    await darQuadro(c.id, NOITE);
    await guardar(c.id, 'Primeira');
    await guardar(c.id, 'Segunda');

    const r = await listar(c.id);
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json().padroes.map((p: { nome: string }) => p.nome), ['Segunda', 'Primeira']);
    assert.equal(r.json().maximo, 4);
    assert.ok(!r.body.includes('imagem'), 'a listagem não pode trazer imagem');
    assert.ok(r.body.length < 1200, `listagem de duas fotos com ${r.body.length} bytes`);
  });

  it('recusa nome vazio, comprido e repetido no canal — o mesmo nome em outro canal pode', async () => {
    const c = await canalNovo('Nomes');
    await darQuadro(c.id, NOITE);
    for (const ruim of ['', '   ', 'x'.repeat(61)]) {
      const r = await guardar(c.id, ruim);
      assert.equal(r.statusCode, 422, `${JSON.stringify(ruim)}: ${r.body}`);
    }
    assert.equal((await guardar(c.id, 'Noite')).statusCode, 201);

    const repetida = await guardar(c.id, '  NOITE ');
    assert.equal(repetida.statusCode, 409, repetida.body);
    assert.equal(repetida.json().erro, 'nome_repetido');
    assert.equal((await listar(c.id)).json().padroes.length, 1, 'nada a mais foi guardado');

    const outro = await canalNovo('Outro canal');
    await darQuadro(outro.id, NOITE);
    assert.equal((await guardar(outro.id, 'Noite')).statusCode, 201);
  });

  it('um canal guarda no máximo quatro; excluir uma abre a vaga', async () => {
    const c = await canalNovo('Limite');
    await darQuadro(c.id, NOITE);
    for (const nome of ['Dia', 'Tarde', 'Noite', 'Fechada']) assert.equal((await guardar(c.id, nome)).statusCode, 201, nome);

    const quinta = await guardar(c.id, 'Madrugada');
    assert.equal(quinta.statusCode, 409, quinta.body);
    assert.equal(quinta.json().erro, 'limite');
    assert.match(quinta.json().mensagem, /já tem 4 fotos padrão/);

    const fotos = (await listar(c.id)).json().padroes as { id: string; nome: string }[];
    const fora = await excluir(fotos.find((f) => f.nome === 'Tarde')!.id);
    assert.deepEqual(fora.json(), { excluida: true, nome: 'Tarde', restantes: 3 });
    assert.equal((await guardar(c.id, 'Madrugada')).statusCode, 201);
  });

  it('seis pedidos ao mesmo tempo não furam o máximo', async () => {
    // Cinco rodadas: sem a trava do canal a corrida fura o máximo em mais ou
    // menos metade das vezes (medido) — uma rodada só deixaria passar.
    for (let rodada = 1; rodada <= 5; rodada += 1) {
      const c = await canalNovo(`Corrida ${rodada}`);
      await darQuadro(c.id, NOITE);
      const respostas = await Promise.all(['a', 'b', 'c', 'd', 'e', 'f'].map((n) => guardar(c.id, `Foto ${n}`)));
      const codigos = respostas.map((r) => r.statusCode).sort();
      assert.deepEqual(codigos, [201, 201, 201, 201, 409, 409], `rodada ${rodada}`);
      assert.equal((await listar(c.id)).json().padroes.length, 4, `rodada ${rodada}`);
    }
  });

  // ───────────────────────── quem pode ─────────────────────────

  it('supervisão vê e não mexe; outra conta nem sabe que existe; sem sessão é 401', async () => {
    const c = await canalNovo('Acesso');
    await darQuadro(c.id, NOITE);
    const f = (await guardar(c.id, 'Noite')).json();

    assert.equal((await listar(c.id, cookieSupervisao)).statusCode, 200);
    assert.equal((await ver(f.id, cookieSupervisao)).statusCode, 200);
    assert.equal((await guardar(c.id, 'Outra', cookieSupervisao)).statusCode, 403);
    assert.equal((await excluir(f.id, cookieSupervisao)).statusCode, 403);

    assert.equal((await listar(c.id, cookieVizinho)).statusCode, 404);
    assert.equal((await ver(f.id, cookieVizinho)).statusCode, 404);
    assert.equal((await guardar(c.id, 'Outra', cookieVizinho)).statusCode, 404);
    assert.equal((await excluir(f.id, cookieVizinho)).statusCode, 404);

    assert.equal((await ver(f.id, null)).statusCode, 401);
    assert.equal((await ver(f.id)).statusCode, 200, 'depois de tudo, a foto continua lá');
    assert.equal((await listar(c.id)).json().padroes.length, 1);
  });

  it('excluída, a foto some de verdade', async () => {
    const c = await canalNovo('Excluir');
    await darQuadro(c.id, NOITE);
    const f = (await guardar(c.id, 'Noite')).json();

    assert.deepEqual((await excluir(f.id)).json(), { excluida: true, nome: 'Noite', restantes: 0 });
    assert.equal((await ver(f.id)).statusCode, 404);
    assert.equal((await excluir(f.id)).statusCode, 404, 'excluir de novo não acha');
    assert.equal((await pool.query('select 1 from foto_padrao where id = $1', [f.id])).rowCount, 0);
    assert.equal((await excluir('não-é-uuid')).statusCode, 404);
  });

  // ───────────────────────── o agente ─────────────────────────

  it('o agente recebe a lista do canal e baixa a imagem; guardar e excluir sobem a versão', async () => {
    const c = await canalNovo('Agente');
    await darQuadro(c.id, NOITE);
    assert.deepEqual((await naConfiguracao(c.id))?.padroes, [], 'canal sem foto desce com a lista vazia');

    let antes = await versao();
    const noite = (await guardar(c.id, 'Noite')).json();
    assert.ok((await versao()) > antes, 'guardar tem de subir a versão: o agente precisa baixar a foto');
    await darQuadro(c.id, DIA);
    const dia = (await guardar(c.id, 'Dia')).json();

    assert.deepEqual((await naConfiguracao(c.id))?.padroes, [
      { id: dia.id, nome: 'Dia', sha256: resumo(DIA) },
      { id: noite.id, nome: 'Noite', sha256: resumo(NOITE) },
    ]);

    const img = await doAgente(`/v1/agentes/padroes/${noite.id}`);
    assert.equal(img.statusCode, 200);
    assert.deepEqual(img.rawPayload, NOITE);
    assert.equal(img.headers['x-farol-sha256'], resumo(NOITE));

    antes = await versao();
    await excluir(dia.id);
    assert.ok((await versao()) > antes, 'excluir também sobe a versão');
    assert.deepEqual((await naConfiguracao(c.id))?.padroes.map((p) => p.nome), ['Noite']);
    assert.equal((await doAgente(`/v1/agentes/padroes/${dia.id}`)).statusCode, 404);
  });

  it('o que o agente recebe e manda tem a forma do contrato', async () => {
    const c = await canalNovo('Contrato');
    const exemplo = CONTRATO.configuracao.padroesDoPonto[0]!;

    // o agente manda a contagem com o nome e o tipo do contrato
    await darQuadro(c.id, NOITE, CONTRATO.quadro);
    assert.equal((await estado(c.id)).pessoas, CONTRATO.quadro.pessoas);
    assert.equal((await guardar(c.id, exemplo.nome)).statusCode, 201);

    // e recebe cada foto com as chaves do contrato — nem a mais, nem a menos
    const [foto] = (await naConfiguracao(c.id))!.padroes as unknown as Record<string, unknown>[];
    assert.deepEqual(Object.keys(foto!).sort(), Object.keys(exemplo).sort());
    for (const k of Object.keys(exemplo)) assert.equal(typeof foto![k], typeof exemplo[k], k);
    assert.equal(foto!.nome, exemplo.nome);
    assert.match(String(foto!.sha256), /^[0-9a-f]{64}$/);
    assert.match(exemplo.sha256!, /^[0-9a-f]{64}$/, 'o exemplo do contrato também tem de ser um resumo de verdade');

    // o critério desce com a chave do contrato
    const r = await app.inject({
      method: 'POST', url: `/v1/lojas/${lojaId}/regras`, headers: { cookie },
      payload: { nome: `Contrato ${randomUUID().slice(0, 4)}`, tipo: 'estado', criterio: 'A bancada está limpa.', zonaIds: [c.zona], ...CONTRATO.configuracao.regra },
    });
    assert.equal(r.statusCode, 201, r.body);
    const id = r.json().id as string;
    assert.equal((await app.inject({ method: 'PATCH', url: `/v1/regras/${id}`, headers: { cookie }, payload: { ativa: true } })).statusCode, 200);
    const regra = (await naConfiguracao(c.id))?.zonas.flatMap((z) => z.regras).find((x) => x.id === id);
    assert.ok(regra, 'o critério ligado desce na configuração');
    for (const [k, v] of Object.entries(CONTRATO.configuracao.regra)) assert.equal(regra[k], v, k);
  });

  it('o agente de outra loja não baixa a foto; sem token é 401', async () => {
    const c = await canalNovo('Alheio');
    await darQuadro(c.id, NOITE);
    const f = (await guardar(c.id, 'Noite')).json();

    assert.equal((await doAgente(`/v1/agentes/padroes/${f.id}`, tokenVizinho)).statusCode, 404);
    assert.equal((await doAgente(`/v1/agentes/padroes/${f.id}`, null)).statusCode, 401);
    assert.equal((await doAgente(`/v1/agentes/padroes/${f.id}`)).statusCode, 200);
  });

  // ───────────────────── o critério e a foto padrão ─────────────────────

  it('o critério guarda "mandar a foto padrão junto", e o agente recebe', async () => {
    const c = await canalNovo('Critério');
    const base = { nome: `Bancada ${randomUUID().slice(0, 4)}`, tipo: 'estado', criterio: 'A bancada está limpa.', zonaIds: [c.zona] };
    const criar = (mais: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: `/v1/lojas/${lojaId}/regras`, headers: { cookie }, payload: { ...base, ...mais } });
    const editar = (id: string, corpo: Record<string, unknown>) =>
      app.inject({ method: 'PATCH', url: `/v1/regras/${id}`, headers: { cookie }, payload: corpo });
    const noBanco = async (id: string) => (await pool.query('select com_padrao from regra where id = $1', [id])).rows[0].com_padrao as boolean;

    const semNada = await criar({});
    assert.equal(semNada.statusCode, 201, semNada.body);
    assert.equal(semNada.json().com_padrao, false, 'nasce sem mandar a foto');

    const com = await criar({ nome: `${base.nome} com foto`, comPadrao: true });
    assert.equal(com.statusCode, 201, com.body);
    const id = com.json().id as string;
    assert.equal(com.json().com_padrao, true);

    for (const torto of ['sim', 1, 'false']) {
      assert.equal((await criar({ nome: `Torto ${String(torto)}`, comPadrao: torto })).statusCode, 422, String(torto));
      assert.equal((await editar(id, { comPadrao: torto })).statusCode, 422, String(torto));
    }

    assert.equal((await editar(id, { nome: `${base.nome} renomeado` })).statusCode, 200);
    assert.equal(await noBanco(id), true, 'quem só trocou o nome não desligou a foto');

    assert.equal((await editar(id, { ativa: true })).statusCode, 200);
    const regra = (await naConfiguracao(c.id))?.zonas.flatMap((z) => z.regras).find((r) => r.id === id);
    assert.equal(regra?.comPadrao, true, 'o agente recebe a escolha');

    const desligado = await editar(id, { comPadrao: false });
    assert.equal(desligado.statusCode, 200, desligado.body);
    assert.equal(desligado.json().com_padrao, false);
    assert.equal(await noBanco(id), false);
  });

  it('a lista de critérios diz quantas fotos padrão cada canal tem', async () => {
    const c = await canalNovo('Com foto');
    const nome = `Comparar ${randomUUID().slice(0, 4)}`;
    const r = await app.inject({
      method: 'POST', url: `/v1/lojas/${lojaId}/regras`, headers: { cookie },
      payload: { nome, tipo: 'comparacao', criterio: 'A bancada está como na foto padrão.', zonaIds: [c.zona] },
    });
    assert.equal(r.statusCode, 201, r.body);
    const alvo = async () => {
      const l = (await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}/regras`, headers: { cookie } })).json();
      return l.regras.find((x: { nome: string }) => x.nome === nome).alvos[0] as { ponto_padroes: number; com_padrao?: unknown };
    };
    assert.equal((await alvo()).ponto_padroes, 0);

    await darQuadro(c.id, NOITE);
    await guardar(c.id, 'Noite');
    await guardar(c.id, 'Dia');
    assert.equal((await alvo()).ponto_padroes, 2);
  });
});
