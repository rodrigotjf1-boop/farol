// O inventário de equipamentos da loja (migration 025), de ponta a ponta na API:
//
//   - o cadastro é da loja de quem pede: outra conta nem sabe que existe,
//     supervisão vê e não mexe;
//   - nome não se repete na loja; setor tem de ser da mesma loja;
//   - até quatro fotos por equipamento, de duas origens: o quadro do canal
//     (cópia, com o desenho da área daquele instante) e a foto enviada (só
//     JPEG, com tamanho lido do arquivo);
//   - "onde aparece" e "compara na loja" saem das fotos de canal e da foto
//     padrão do canal — a mesma regra do agente;
//   - a listagem não traz os bytes;
//   - o agente recebe, por área, os equipamentos DESCRITOS, e só o que ele
//     consome sobe a versão da configuração.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { lerItem, MAX_BYTES_DA_FOTO, MAX_CONFERIR, MAX_FOTOS_POR_ITEM, tamanhoDoJpeg, TIPOS_DE_ITEM } from '../src/rotas/inventario.js';

// O mesmo arquivo que o agente lê (agent/testes/test_inventario.py): o que a
// configuração leva de cada equipamento da área.
const CONTRATO = JSON.parse(
  readFileSync(new URL('../../contratos/equipamentos-da-area.json', import.meta.url), 'utf8'),
) as { equipamentosDaZona: { nome: string; tipo: string; descricao: string }[] };

/** Um JPEG mínimo de verdade no que importa aqui: SOI, APP0, o segmento do tamanho, SOS e EOI. */
function jpeg(largura: number, altura: number, { marca = 0xc0, miolo = 1, comApp = true, enchimento = 0 } = {}): Buffer {
  const app0 = comApp ? [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00] : [];
  const sof = [0xff, marca, 0x00, 0x11, 0x08, altura >> 8, altura & 0xff, largura >> 8, largura & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const sos = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, miolo];
  return Buffer.from([0xff, 0xd8, ...app0, ...Array(enchimento).fill(0xff), ...sof, ...sos, 0xff, 0xd9]);
}
const QUADRO_A = jpeg(1280, 720, { miolo: 1 });
const QUADRO_B = jpeg(1280, 720, { miolo: 2 });

describe('o que entra no cadastro do equipamento (sem banco)', () => {
  const setorId = randomUUID();

  it('criando: pede nome e setor, e apara o que veio', () => {
    assert.deepEqual(lerItem({ nome: '  Chapa ', setorId }, true), { campos: { nome: 'Chapa', setorId } });
    assert.ok(lerItem({ setorId }, true).problema?.includes('nome'));
    assert.ok(lerItem({ nome: '   ', setorId }, true).problema?.includes('nome'));
    assert.ok(lerItem({ nome: 'Chapa' }, true).problema?.includes('setor'));
    assert.ok(lerItem({ nome: 'Chapa', setorId: 'cozinha' }, true).problema?.includes('setor'));
    assert.ok(lerItem({ nome: 'x'.repeat(81), setorId }, true).problema?.includes('80'));
    assert.equal(lerItem({ nome: 'x'.repeat(80), setorId }, true).problema, undefined);
  });

  it('editando: o que não veio fica como está', () => {
    assert.deepEqual(lerItem({}, false), { campos: {} });
    assert.deepEqual(lerItem({ descricao: ' de inox ' }, false), { campos: { descricao: 'de inox' } });
    assert.ok(lerItem({ nome: '' }, false).problema, 'nome vazio não é "manter"');
  });

  it('tipo: só os da lista', () => {
    for (const t of TIPOS_DE_ITEM) assert.equal(lerItem({ tipo: t }, false).campos?.tipo, t);
    for (const ruim of ['Chapa', 'geladeira ou freezer', '', 3, null]) assert.ok(lerItem({ tipo: ruim }, false).problema, JSON.stringify(ruim));
  });

  it('o que vale conferir: frases limpas, sem repetir, com limite', () => {
    assert.deepEqual(lerItem({ conferir: [' Tampas abaixadas ', '', 'Tampas abaixadas', 'Nada em cima'] }, false).campos?.conferir, ['Tampas abaixadas', 'Nada em cima']);
    assert.ok(lerItem({ conferir: 'Tampas abaixadas' }, false).problema);
    assert.ok(lerItem({ conferir: [1] }, false).problema);
    assert.ok(lerItem({ conferir: ['x'.repeat(161)] }, false).problema?.includes('160'));
    const muitas = Array.from({ length: MAX_CONFERIR + 1 }, (_, i) => `ponto ${i}`);
    assert.ok(lerItem({ conferir: muitas }, false).problema?.includes(String(MAX_CONFERIR)));
    assert.equal(lerItem({ conferir: muitas.slice(1) }, false).campos?.conferir?.length, MAX_CONFERIR);
  });

  it('descrição: texto, até 2000 caracteres', () => {
    assert.equal(lerItem({ descricao: 'x'.repeat(2000) }, false).problema, undefined);
    assert.ok(lerItem({ descricao: 'x'.repeat(2001) }, false).problema?.includes('2000'));
    assert.ok(lerItem({ descricao: 7 }, false).problema);
  });
});

describe('o tamanho lido do JPEG (sem banco)', () => {
  it('lê a largura e a altura do segmento certo', () => {
    assert.deepEqual(tamanhoDoJpeg(jpeg(1280, 720)), { largura: 1280, altura: 720 });
    assert.deepEqual(tamanhoDoJpeg(jpeg(640, 1136, { marca: 0xc2 })), { largura: 640, altura: 1136 }, 'JPEG progressivo');
    assert.deepEqual(tamanhoDoJpeg(jpeg(33, 7, { comApp: false })), { largura: 33, altura: 7 });
    assert.deepEqual(tamanhoDoJpeg(jpeg(800, 600, { enchimento: 3 })), { largura: 800, altura: 600 }, 'com enchimento entre segmentos');
  });

  it('o que não é um JPEG inteiro não tem tamanho', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
    assert.equal(tamanhoDoJpeg(png), null);
    assert.equal(tamanhoDoJpeg(Buffer.alloc(0)), null);
    assert.equal(tamanhoDoJpeg(Buffer.from('<svg onload="alert(1)"/>')), null);
    assert.equal(tamanhoDoJpeg(jpeg(1280, 720).subarray(0, 24)), null, 'cortado antes do tamanho');
    assert.equal(tamanhoDoJpeg(jpeg(0, 720)), null, 'largura zero');
    // tem o segmento do tamanho, mas não começa como JPEG
    assert.equal(tamanhoDoJpeg(Buffer.concat([Buffer.from([0x00, 0x00]), jpeg(1280, 720, { comApp: false }).subarray(2)])), null);
    // os dados começam sem o tamanho ter aparecido
    assert.equal(tamanhoDoJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0, 0xff, 0xd9])), null);
    // a tabela de Huffman (C4) não é o segmento do tamanho
    assert.equal(tamanhoDoJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xc4, 0x00, 0x09, 0x08, 0x02, 0xd0, 0x05, 0x00, 0x03, 0x01, 0xff, 0xd9])), null);
  });
});

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-invent-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-inventario';
const SENHA = 'uma senha longa o bastante';

describe('inventário de equipamentos (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  let lojaId = '';
  let setorId = '';
  let outroSetorId = '';
  let setorVizinho = '';
  let lojaVizinha = '';
  let cookie = '';
  let cookieSupervisao = '';
  let cookieVizinho = '';
  let token = '';
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
  /** Um canal novo, ainda sem quadro, com a área "Quadro inteiro". */
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
  async function darQuadro(pontoId: string, bytes: Buffer) {
    const pedido = await app.inject({ method: 'POST', url: `/v1/pontos/${pontoId}/preview`, headers: { cookie } });
    assert.equal(pedido.statusCode, 202, pedido.body);
    await app.inject({ method: 'POST', url: '/v1/agentes/heartbeat', headers: { authorization: `Bearer ${token}` }, payload: {} });
    const r = await app.inject({
      method: 'POST', url: `/v1/agentes/comandos/${pedido.json().comandoId}/resultado`, headers: { authorization: `Bearer ${token}` },
      payload: { imagemBase64: bytes.toString('base64'), largura: 1920, altura: 1080 },
    });
    assert.equal(r.statusCode, 200, r.body);
  }

  const criar = (corpo: Record<string, unknown>, comCookie = cookie, loja = lojaId) =>
    app.inject({ method: 'POST', url: `/v1/lojas/${loja}/inventario`, headers: { cookie: comCookie }, payload: corpo });
  const novo = async (nome: string, mais: Record<string, unknown> = {}) => {
    const r = await criar({ nome, setorId, ...mais });
    assert.equal(r.statusCode, 201, r.body);
    return r.json() as Item;
  };
  const listar = (comCookie = cookie, loja = lojaId) =>
    app.inject({ method: 'GET', url: `/v1/lojas/${loja}/inventario`, headers: comCookie ? { cookie: comCookie } : {} });
  const naLista = async (id: string) => ((await listar()).json().itens as Item[]).find((i) => i.id === id);
  const editar = (id: string, corpo: Record<string, unknown>, comCookie = cookie) =>
    app.inject({ method: 'PATCH', url: `/v1/inventario/${id}`, headers: { cookie: comCookie }, payload: corpo });
  const excluir = (id: string, comCookie = cookie) =>
    app.inject({ method: 'DELETE', url: `/v1/inventario/${id}`, headers: { cookie: comCookie } });
  const porFoto = (id: string, corpo: Record<string, unknown>, comCookie = cookie) =>
    app.inject({ method: 'POST', url: `/v1/inventario/${id}/fotos`, headers: { cookie: comCookie }, payload: corpo });
  const doCanal = (id: string, zonaId: string) => porFoto(id, { origem: 'canal', zonaId });
  const enviada = (id: string, bytes: Buffer) => porFoto(id, { origem: 'envio', imagemBase64: bytes.toString('base64') });
  const verFoto = (fotoId: string, comCookie: string | null = cookie) =>
    app.inject({ method: 'GET', url: `/v1/inventario/fotos/${fotoId}/imagem`, headers: comCookie ? { cookie: comCookie } : {} });
  const tirarFoto = (fotoId: string, comCookie = cookie) =>
    app.inject({ method: 'DELETE', url: `/v1/inventario/fotos/${fotoId}`, headers: { cookie: comCookie } });
  const versao = async () => (await pool.query('select config_versao from loja where id = $1', [lojaId])).rows[0].config_versao as number;
  const equipamentosDaZona = async (pontoId: string, zonaId: string) => {
    const c = (await app.inject({ method: 'GET', url: '/v1/agentes/configuracao', headers: { authorization: `Bearer ${token}` } })).json();
    const ponto = c.pontos.find((p: { id: string }) => p.id === pontoId);
    return ponto?.zonas.find((z: { id: string }) => z.id === zonaId)?.equipamentos as { nome: string; tipo: string; descricao: string }[] | undefined;
  };

  type Foto = { id: string; origem: string; pontoId: string | null; zonaId: string | null; recorte: number[][] | null; largura: number; altura: number };
  type Item = {
    id: string; nome: string; tipo: string; setorId: string; setorNome: string; descricao: string; conferir: string[];
    fotos: Foto[]; aparece: { pontoId: string; pontoNome: string; canal: number; zonaId: string; zonaNome: string; variasAreas: boolean; fotosPadrao: number }[];
    comparaNaLoja: boolean;
  };

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    app = criarApp(pool, { logger: false });
    await app.ready();

    const conta = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome: marca }, loja: { nome: 'Matriz' }, setores: [{ nome: 'Cozinha' }, { nome: 'Atendimento' }] },
    })).json();
    lojaId = conta.loja.id;
    setorId = conta.setores[0].id;
    outroSetorId = conta.setores[1].id;
    cookie = await entrar(conta.tenantId, `ger-${marca}@e.com`, 'gerente', 'Ana Souza');
    cookieSupervisao = await entrar(conta.tenantId, `sup-${marca}@e.com`, 'supervisao');
    token = await novoAgente(lojaId, marca);

    const vizinha = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome: `${marca}-vizinha` }, loja: { nome: 'Vizinha' }, setores: [{ nome: 'Cozinha' }] },
    })).json();
    lojaVizinha = vizinha.loja.id;
    setorVizinho = vizinha.setores[0].id;
    cookieVizinho = await entrar(vizinha.tenantId, `ger-${marca}-viz@e.com`, 'gerente');
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    // Apagar a conta leva junto o inventário e as fotos: é a prova de que as
    // ligações da 025 não deixam a exclusão de uma conta presa.
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    const sobrou = await pool?.query('select count(*)::int as n from inventario_item where loja_id = $1', [lojaId]);
    assert.equal(sobrou?.rows[0].n, 0);
    await pool?.end();
  });

  // ───────────────────────── o cadastro ─────────────────────────

  it('cadastra, lista por setor e por nome, e nasce sem foto e sem descrição', async () => {
    const chapa = await novo('Chapa', { tipo: 'chapa' });
    const balcao = (await criar({ nome: 'Balcão', setorId: outroSetorId, tipo: 'balcao' })).json() as Item;
    const bancada = await novo('bancada 1');

    assert.deepEqual(
      { tipo: chapa.tipo, setor: chapa.setorNome, descricao: chapa.descricao, conferir: chapa.conferir, fotos: chapa.fotos, aparece: chapa.aparece, compara: chapa.comparaNaLoja },
      { tipo: 'chapa', setor: 'Cozinha', descricao: '', conferir: [], fotos: [], aparece: [], compara: false },
    );
    assert.equal(bancada.tipo, 'outro', 'sem tipo, nasce como "outro"');

    const l = (await listar()).json();
    assert.equal(l.maximoDeFotos, MAX_FOTOS_POR_ITEM);
    assert.deepEqual(l.tipos, [...TIPOS_DE_ITEM]);
    const meus = (l.itens as Item[]).filter((i) => [chapa.id, balcao.id, bancada.id].includes(i.id)).map((i) => `${i.setorNome}/${i.nome}`);
    assert.deepEqual(meus, ['Cozinha/bancada 1', 'Cozinha/Chapa', 'Atendimento/Balcão'], 'setor pela ordem do cadastro; dentro dele, por nome sem olhar maiúscula');
  });

  it('nome não se repete na loja — nem com outra caixa ou espaço; em outra loja pode', async () => {
    await novo('Fritadeira');
    for (const repetido of ['Fritadeira', ' fritadeira ', 'FRITADEIRA']) {
      const r = await criar({ nome: repetido, setorId: outroSetorId });
      assert.equal(r.statusCode, 409, repetido);
      assert.equal(r.json().erro, 'nome_repetido');
    }
    assert.equal((await criar({ nome: 'Fritadeira', setorId: setorVizinho }, cookieVizinho, lojaVizinha)).statusCode, 201);

    const outra = await novo('Fritadeira 2');
    const r = await editar(outra.id, { nome: 'fritadeira' });
    assert.equal(r.statusCode, 409, 'renomear para um nome que já existe também é recusado');
    assert.equal((await editar(outra.id, { nome: 'Fritadeira 2' })).statusCode, 200, 'o próprio nome não conflita com ele mesmo');
  });

  it('o setor tem de ser da loja', async () => {
    const r = await criar({ nome: 'Em setor alheio', setorId: setorVizinho });
    assert.equal(r.statusCode, 404, r.body);
    const meu = await novo('Pia');
    const e = await editar(meu.id, { setorId: setorVizinho });
    assert.equal(e.statusCode, 422, e.body);
    assert.equal((await naLista(meu.id))?.setorId, setorId, 'e nada mudou');
    assert.equal((await editar(meu.id, { setorId: outroSetorId })).json().setorNome, 'Atendimento');
  });

  it('editar muda só o que veio', async () => {
    const i = await novo('Geladeira', { tipo: 'geladeira', descricao: 'Geladeira de quatro portas.', conferir: ['Portas fechadas'] });
    assert.deepEqual([i.descricao, i.conferir], ['Geladeira de quatro portas.', ['Portas fechadas']]);

    const so = (await editar(i.id, { nome: 'Geladeira grande' })).json() as Item;
    assert.deepEqual([so.nome, so.tipo, so.descricao, so.conferir], ['Geladeira grande', 'geladeira', 'Geladeira de quatro portas.', ['Portas fechadas']]);

    const d = (await editar(i.id, { descricao: '', conferir: [] })).json() as Item;
    assert.deepEqual([d.nome, d.descricao, d.conferir], ['Geladeira grande', '', []], 'vazio é um valor: apaga');

    assert.equal((await editar(i.id, { tipo: 'freezer' })).statusCode, 422);
    assert.equal((await criar({ nome: '', setorId })).statusCode, 422);
  });

  it('supervisão vê e não mexe; outra conta nem sabe que existe; sem sessão é 401', async () => {
    const c = await canalNovo('Permissões');
    await darQuadro(c.id, QUADRO_A);
    const i = await novo('Caixa', { tipo: 'caixa' });
    const foto = (await doCanal(i.id, c.zona)).json().fotoId as string;

    assert.equal((await listar(cookieSupervisao)).statusCode, 200);
    assert.equal((await verFoto(foto, cookieSupervisao)).statusCode, 200);
    assert.equal((await criar({ nome: 'Da supervisão', setorId }, cookieSupervisao)).statusCode, 403);
    assert.equal((await editar(i.id, { nome: 'x' }, cookieSupervisao)).statusCode, 403);
    assert.equal((await excluir(i.id, cookieSupervisao)).statusCode, 403);
    assert.equal((await porFoto(i.id, { origem: 'canal', zonaId: c.zona }, cookieSupervisao)).statusCode, 403);
    assert.equal((await tirarFoto(foto, cookieSupervisao)).statusCode, 403);

    assert.equal((await listar(cookieVizinho)).statusCode, 404, 'a loja de outra conta não existe para ela');
    assert.equal((await editar(i.id, { nome: 'x' }, cookieVizinho)).statusCode, 404);
    assert.equal((await excluir(i.id, cookieVizinho)).statusCode, 404);
    assert.equal((await porFoto(i.id, { origem: 'canal', zonaId: c.zona }, cookieVizinho)).statusCode, 404);
    assert.equal((await verFoto(foto, cookieVizinho)).statusCode, 404);
    assert.equal((await tirarFoto(foto, cookieVizinho)).statusCode, 404);

    // com os ids CERTOS da minha loja na mão, a outra conta continua sem entrar
    const invasor = await criar({ nome: 'Invasor', setorId }, cookieVizinho, lojaId);
    assert.equal(invasor.statusCode, 404, invasor.body);
    assert.equal(((await listar()).json().itens as Item[]).some((x) => x.nome === 'Invasor'), false);
    // e o equipamento DELA não ganha foto do quadro de um canal MEU
    const dela = (await criar({ nome: 'Da vizinha', setorId: setorVizinho }, cookieVizinho, lojaVizinha)).json() as Item;
    const roubo = await porFoto(dela.id, { origem: 'canal', zonaId: c.zona }, cookieVizinho);
    assert.equal(roubo.statusCode, 404, roubo.body);
    assert.equal((await pool.query('select count(*)::int as n from inventario_foto where item_id = $1', [dela.id])).rows[0].n, 0);

    assert.equal((await listar('')).statusCode, 401);
    assert.equal((await verFoto(foto, null)).statusCode, 401);
    assert.equal((await naLista(i.id))?.nome, 'Caixa', 'e nada do que foi tentado mudou o cadastro');
  });

  // ───────────────────────── as fotos ─────────────────────────

  it('a foto do canal é uma CÓPIA do quadro, com o desenho da área daquele instante', async () => {
    const c = await canalNovo('Chapa 1');
    const i = await novo('Chapa da esquerda', { tipo: 'chapa' });

    const semQuadro = await doCanal(i.id, c.zona);
    assert.equal(semQuadro.statusCode, 409, semQuadro.body);
    assert.equal(semQuadro.json().erro, 'sem_quadro');

    await darQuadro(c.id, QUADRO_A);
    const desenho = [[0.1, 0.2], [0.6, 0.2], [0.6, 0.8], [0.1, 0.8]];
    assert.equal((await app.inject({ method: 'PATCH', url: `/v1/zonas/${c.zona}`, headers: { cookie }, payload: { poligono: desenho } })).statusCode, 200);

    const r = await doCanal(i.id, c.zona);
    assert.equal(r.statusCode, 201, r.body);
    const [foto] = (r.json().item as Item).fotos;
    assert.deepEqual(
      { origem: foto!.origem, pontoId: foto!.pontoId, zonaId: foto!.zonaId, recorte: foto!.recorte },
      { origem: 'canal', pontoId: c.id, zonaId: c.zona, recorte: desenho },
    );
    assert.equal(r.json().fotoId, foto!.id);

    // o quadro muda e a área é redesenhada depois: a foto guardada não acompanha
    await darQuadro(c.id, QUADRO_B);
    await app.inject({ method: 'PATCH', url: `/v1/zonas/${c.zona}`, headers: { cookie }, payload: { poligono: [[0, 0], [1, 0], [1, 1], [0, 1]] } });
    const img = await verFoto(foto!.id);
    assert.equal(img.statusCode, 200);
    assert.deepEqual(img.rawPayload, QUADRO_A);
    assert.equal(img.headers['content-type'], 'image/jpeg');
    assert.equal(img.headers['x-content-type-options'], 'nosniff');
    assert.match(String(img.headers['cache-control']), /private/);
    assert.deepEqual((await naLista(i.id))?.fotos[0]?.recorte, desenho);
  });

  it('a área tem de ser de um canal desta loja', async () => {
    const i = await novo('Prateleira', { tipo: 'prateleira' });
    assert.equal((await doCanal(i.id, randomUUID())).statusCode, 404);
    assert.equal((await porFoto(i.id, { origem: 'canal' })).statusCode, 422);
    assert.equal((await porFoto(i.id, { origem: 'celular', zonaId: randomUUID() })).statusCode, 422);
    assert.equal((await naLista(i.id))?.fotos.length, 0);
  });

  it('a foto enviada: só JPEG, com limite de tamanho, e a medida lida do arquivo', async () => {
    const i = await novo('Bancada de corte', { tipo: 'bancada' });

    const boa = await enviada(i.id, jpeg(900, 1600));
    assert.equal(boa.statusCode, 201, boa.body);
    const [foto] = (boa.json().item as Item).fotos;
    assert.deepEqual(
      { origem: foto!.origem, pontoId: foto!.pontoId, zonaId: foto!.zonaId, recorte: foto!.recorte, largura: foto!.largura, altura: foto!.altura },
      { origem: 'envio', pontoId: null, zonaId: null, recorte: null, largura: 900, altura: 1600 },
    );
    assert.deepEqual((await verFoto(foto!.id)).rawPayload, jpeg(900, 1600));

    for (const [nome, bytes] of [['png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], ['texto', Buffer.from('<svg/>')]] as const) {
      const r = await enviada(i.id, bytes);
      assert.equal(r.statusCode, 422, nome);
    }
    assert.equal((await porFoto(i.id, { origem: 'envio' })).statusCode, 422);
    assert.equal((await porFoto(i.id, { origem: 'envio', imagemBase64: 7 })).statusCode, 422);

    const grande = Buffer.concat([jpeg(1280, 720), Buffer.alloc(MAX_BYTES_DA_FOTO)]);
    const g = await enviada(i.id, grande);
    assert.equal(g.statusCode, 413, g.body);

    const item = await naLista(i.id);
    assert.equal(item?.fotos.length, 1, 'o que foi recusado não entrou');
    assert.deepEqual([item?.aparece, item?.comparaNaLoja], [[], false], 'foto enviada não diz onde o equipamento aparece');
  });

  it('a lista não traz os bytes de nenhuma foto', async () => {
    const corpo = (await listar()).body;
    assert.ok(!corpo.includes('"imagem"') && !corpo.includes('"sha256"'), 'a lista não tem campo de imagem');
    assert.ok(corpo.length < 60_000, `a lista ficou com ${corpo.length} caracteres: tem imagem dentro?`);
  });

  it('um equipamento guarda no máximo quatro fotos; tirar uma abre a vaga', async () => {
    const c = await canalNovo('Limite');
    await darQuadro(c.id, QUADRO_A);
    const i = await novo('Forno');
    const ids: string[] = [];
    for (let n = 0; n < MAX_FOTOS_POR_ITEM; n += 1) {
      const r = n % 2 ? await enviada(i.id, jpeg(100 + n, 100)) : await doCanal(i.id, c.zona);
      assert.equal(r.statusCode, 201, r.body);
      ids.push(r.json().fotoId);
    }
    const quinta = await enviada(i.id, jpeg(50, 50));
    assert.equal(quinta.statusCode, 409, quinta.body);
    assert.equal(quinta.json().erro, 'limite');

    const t = await tirarFoto(ids[1]!);
    assert.equal(t.statusCode, 200, t.body);
    assert.deepEqual((t.json().item as Item).fotos.map((f) => f.id), [ids[0], ids[2], ids[3]], 'na ordem em que foram postas');
    assert.equal((await verFoto(ids[1]!)).statusCode, 404, 'a foto tirada some de verdade');
    assert.equal((await enviada(i.id, jpeg(50, 50))).statusCode, 201);
    assert.equal((await tirarFoto(ids[1]!)).statusCode, 404, 'tirar de novo não acha');
  });

  it('seis envios ao mesmo tempo não furam o máximo', async () => {
    // Quem garante é a trava na linha do equipamento (conferido tirando-a:
    // sem ela entram mais de quatro).
    for (let rodada = 0; rodada < 5; rodada += 1) {
      const i = await novo(`Corrida ${rodada}`);
      const r = await Promise.all(Array.from({ length: 6 }, (_, n) => enviada(i.id, jpeg(200 + n, 100))));
      assert.deepEqual(r.map((x) => x.statusCode).sort(), [201, 201, 201, 201, 409, 409], `rodada ${rodada}`);
      assert.equal((await pool.query('select count(*)::int as n from inventario_foto where item_id = $1', [i.id])).rows[0].n, 4);
    }
  });

  // ───────────────────── onde aparece, e "compara na loja" ─────────────────────

  it('aparece onde tem foto do canal; compara na loja quando o canal tem foto padrão', async () => {
    const c = await canalNovo('Montagem');
    await darQuadro(c.id, QUADRO_A);
    const i = await novo('Bancada de montagem', { tipo: 'bancada' });
    await enviada(i.id, jpeg(300, 300));
    assert.deepEqual((await naLista(i.id))?.aparece, []);

    await doCanal(i.id, c.zona);
    await doCanal(i.id, c.zona);
    let item = await naLista(i.id);
    assert.equal(item?.aparece.length, 1, 'duas fotos do mesmo lugar são UM lugar');
    assert.deepEqual(
      { ponto: item?.aparece[0]?.pontoId, nome: item?.aparece[0]?.pontoNome, zona: item?.aparece[0]?.zonaId, zonaNome: item?.aparece[0]?.zonaNome, varias: item?.aparece[0]?.variasAreas, padrao: item?.aparece[0]?.fotosPadrao },
      { ponto: c.id, nome: 'Montagem', zona: c.zona, zonaNome: 'Quadro inteiro', varias: false, padrao: 0 },
    );
    assert.equal(item?.comparaNaLoja, false, 'sem foto padrão no canal, comparação não é julgada na loja');

    assert.equal((await app.inject({ method: 'POST', url: `/v1/pontos/${c.id}/padroes`, headers: { cookie }, payload: { nome: 'Noite' } })).statusCode, 201);
    item = await naLista(i.id);
    assert.deepEqual([item?.aparece[0]?.fotosPadrao, item?.comparaNaLoja], [1, true]);

    // mais uma área no canal: o lugar passa a dizer que o canal tem várias
    const segunda = await app.inject({ method: 'POST', url: `/v1/pontos/${c.id}/zonas`, headers: { cookie }, payload: { nome: 'Pia ao lado' } });
    assert.equal(segunda.statusCode, 201, segunda.body);
    await doCanal(i.id, segunda.json().id);
    item = await naLista(i.id);
    assert.deepEqual(item?.aparece.map((l) => [l.zonaNome, l.variasAreas]), [['Pia ao lado', true], ['Quadro inteiro', true]]);

    // área excluída: o equipamento deixa de aparecer nela, e as fotos ficam
    assert.equal((await app.inject({ method: 'DELETE', url: `/v1/zonas/${segunda.json().id}`, headers: { cookie } })).statusCode, 200);
    item = await naLista(i.id);
    assert.deepEqual(item?.aparece.map((l) => l.zonaNome), ['Quadro inteiro']);
    assert.equal(item?.fotos.length, 4);
  });

  it('excluir o equipamento leva as fotos junto', async () => {
    const c = await canalNovo('Excluir');
    await darQuadro(c.id, QUADRO_A);
    const i = await novo('Freezer horizontal', { tipo: 'geladeira' });
    const f1 = (await doCanal(i.id, c.zona)).json().fotoId as string;
    const f2 = (await enviada(i.id, jpeg(64, 64))).json().fotoId as string;

    const r = await excluir(i.id);
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json(), { excluido: true, nome: 'Freezer horizontal' });
    assert.equal(await naLista(i.id), undefined);
    assert.equal((await verFoto(f1)).statusCode, 404);
    assert.equal((await verFoto(f2)).statusCode, 404);
    assert.equal((await pool.query('select count(*)::int as n from inventario_foto where item_id = $1', [i.id])).rows[0].n, 0);
    assert.equal((await excluir(i.id)).statusCode, 404);
    assert.equal((await novo('Freezer horizontal')).nome, 'Freezer horizontal', 'o nome fica livre de novo');
  });

  // ───────────────────────── o agente ─────────────────────────

  it('o que desce ao agente tem a forma do contrato', async () => {
    const c = await canalNovo('Contrato');
    await darQuadro(c.id, QUADRO_A);
    const exemplo = CONTRATO.equipamentosDaZona[0]!;
    assert.ok((TIPOS_DE_ITEM as readonly string[]).includes(exemplo.tipo), 'o tipo do exemplo tem de ser um dos que a API aceita');

    const i = await novo(`${exemplo.nome} do contrato`, { tipo: exemplo.tipo, descricao: exemplo.descricao });
    await doCanal(i.id, c.zona);

    const [desce] = (await equipamentosDaZona(c.id, c.zona))!;
    // as mesmas chaves, nem a mais nem a menos, e os mesmos tipos de valor
    assert.deepEqual(Object.keys(desce!).sort(), Object.keys(exemplo).sort());
    assert.deepEqual({ tipo: desce!.tipo, descricao: desce!.descricao }, { tipo: exemplo.tipo, descricao: exemplo.descricao });
    assert.equal(typeof desce!.nome, 'string');
  });

  it('o agente recebe, por área, os equipamentos descritos — e só o que ele consome sobe a versão', async () => {
    const c = await canalNovo('Agente');
    const outro = await canalNovo('Agente 2');
    await darQuadro(c.id, QUADRO_A);
    await darQuadro(outro.id, QUADRO_A);

    // cadastrar sem descrição, pôr foto, mexer no que o agente não lê: a versão não sobe
    let antes = await versao();
    const i = await novo('Chapa do fundo', { tipo: 'chapa' });
    await doCanal(i.id, c.zona);
    await doCanal(i.id, c.zona);
    await editar(i.id, { conferir: ['Tampas abaixadas'] });
    assert.equal(await versao(), antes, 'equipamento sem descrição não desce ao agente: nada disso sobe a versão');
    assert.deepEqual(await equipamentosDaZona(c.id, c.zona), [], 'sem descrição, não desce');

    // descrever: sobe, e desce na área em que ele aparece
    await editar(i.id, { descricao: 'Chapa de inox com duas tampas. Limpa: sem resíduo escuro.' });
    assert.ok((await versao()) > antes, 'a descrição é o que o agente manda à nuvem: sobe');
    assert.deepEqual(
      await equipamentosDaZona(c.id, c.zona),
      [{ nome: 'Chapa do fundo', tipo: 'chapa', descricao: 'Chapa de inox com duas tampas. Limpa: sem resíduo escuro.' }],
      'uma vez só, mesmo com duas fotos na mesma área',
    );
    assert.deepEqual(await equipamentosDaZona(outro.id, outro.zona), [], 'só na área em que ele aparece');

    // o que o agente não lê continua não subindo
    antes = await versao();
    await editar(i.id, { conferir: ['Tampas abaixadas', 'Nada em cima'] });
    await editar(i.id, { setorId: outroSetorId });
    await editar(i.id, { descricao: 'Chapa de inox com duas tampas. Limpa: sem resíduo escuro.' });
    await enviada(i.id, jpeg(71, 71));
    assert.equal(await versao(), antes, 'pontos a conferir, setor, a mesma descrição e foto enviada não sobem a versão');

    // o nome sobe; aparecer em mais um canal sobe
    await editar(i.id, { nome: 'Chapa grande' });
    assert.ok((await versao()) > antes);
    antes = await versao();
    await doCanal(i.id, outro.zona);
    assert.ok((await versao()) > antes, 'foto de outro canal muda onde ele aparece');
    assert.equal((await equipamentosDaZona(outro.id, outro.zona))?.[0]?.nome, 'Chapa grande');
    assert.equal((await equipamentosDaZona(c.id, c.zona))?.length, 1);

    // dois equipamentos na mesma área, em ordem de nome
    const b = await novo('Bancada ao lado', { tipo: 'bancada', descricao: 'Bancada de inox.' });
    await doCanal(b.id, c.zona);
    assert.deepEqual((await equipamentosDaZona(c.id, c.zona))?.map((e) => e.nome), ['Bancada ao lado', 'Chapa grande']);

    // tirar a foto do canal tira o equipamento daquela área; excluir tira de todas
    const dele = (await naLista(i.id))!.fotos.find((f) => f.zonaId === outro.zona)!;
    antes = await versao();
    await tirarFoto(dele.id);
    assert.ok((await versao()) > antes);
    assert.deepEqual(await equipamentosDaZona(outro.id, outro.zona), []);
    antes = await versao();
    await excluir(i.id);
    assert.ok((await versao()) > antes, 'excluir equipamento descrito sobe a versão');
    assert.deepEqual((await equipamentosDaZona(c.id, c.zona))?.map((e) => e.nome), ['Bancada ao lado']);
  });
});
