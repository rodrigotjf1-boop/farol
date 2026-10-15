// Os ingredientes da loja e as fotos de referência de cada um (A21, fatia T1; migration 047), de ponta a
// ponta na API:
//
//   - os ingredientes saem das fichas — os da ficha e o que um adicional acrescenta —, pelo nome, sem olhar
//     maiúscula nem espaço nas pontas;
//   - a foto é só JPEG, com o tamanho lido do arquivo; até 6 por ingrediente, mesmo com envios ao mesmo tempo;
//   - supervisão vê e manda foto; tirar, "não se vê de cima", juntar e apagar são de quem configura; outra
//     conta nem sabe que a foto existe;
//   - o ingrediente que sai das fichas e tem foto vira órfão: junta-se ao nome novo — nunca descartando
//     foto — ou apaga-se;
//   - a listagem nunca traz os bytes.

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { contarBase, impressaoDaBase, type Base } from '../src/fichas.js';
import { chaveDoIngrediente, ingredientesDaBase, MAX_FOTOS_POR_INGREDIENTE } from '../src/ingredientes.js';
import { MAX_BYTES_DA_FOTO } from '../src/rotas/inventario.js';

// O mesmo documento que o agente lê (contratos/fichas-da-loja.json): o X-Burger, com a ficha e os adicionais.
const BASE = (JSON.parse(readFileSync(new URL('../../contratos/fichas-da-loja.json', import.meta.url), 'utf8')) as {
  resposta: { base: Base };
}).resposta.base;
const XBURGER = BASE.produtos.find((p) => p.nome === 'X-Burger')!;
const DO_CONTRATO = ['Pão brioche', 'Blend da casa', 'Queijo prato', 'Cebola roxa', 'Sal', 'Bacon fatiado', 'Ovo frito'];
const copia = (b: Base): Base => JSON.parse(JSON.stringify(b)) as Base;

/** Um JPEG mínimo de verdade no que importa aqui: SOI, APP0, o segmento do tamanho, SOS e EOI. */
function jpeg(largura: number, altura: number, miolo = 1): Buffer {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, altura >> 8, altura & 0xff, largura >> 8, largura & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const sos = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, miolo & 0xff];
  return Buffer.from([0xff, 0xd8, ...app0, ...sof, ...sos, 0xff, 0xd9]);
}

describe('os ingredientes da loja, tirados das fichas (sem banco)', () => {
  it('os da ficha e o que um adicional acrescenta, na ordem das fichas', () => {
    assert.deepEqual(ingredientesDaBase(BASE).map((i) => i.nome), DO_CONTRATO);
  });

  it('não entram: o produto que o adicional põe junto, a observação e o que um adicional tira', () => {
    const nomes = ingredientesDaBase(BASE).map((i) => i.nome);
    assert.ok(!nomes.includes('Refrigerante lata'), 'a bebida do adicional é produto, não ingrediente');
    assert.ok(!nomes.includes('Ponto da carne'), 'observação não vai para a bancada');
    assert.equal(nomes.filter((n) => n === 'Cebola roxa').length, 1, 'o "sem cebola" não cria outro ingrediente');
  });

  it('diz onde entra: pela ficha ou por adicional — e na ficha E como adicional do mesmo produto, vale a ficha', () => {
    const porNome = new Map(ingredientesDaBase(BASE).map((i) => [i.nome, i.produtos]));
    assert.deepEqual(porNome.get('Queijo prato'), [{ produtoId: XBURGER.id, produto: 'X-Burger', adicional: false }]);
    assert.deepEqual(porNome.get('Bacon fatiado'), [{ produtoId: XBURGER.id, produto: 'X-Burger', adicional: true }]);

    const b = copia(BASE);
    const xb = b.produtos.find((p) => p.id === XBURGER.id)!;
    xb.ficha!.ingredientes.push({ ...xb.ficha!.ingredientes[0]!, nome: ' bacon FATIADO ' });
    const bacon = ingredientesDaBase(b).find((i) => chaveDoIngrediente(i.nome) === 'bacon fatiado')!;
    assert.deepEqual(bacon.produtos, [{ produtoId: XBURGER.id, produto: 'X-Burger', adicional: false }]);
    assert.equal(bacon.nome, 'bacon FATIADO', 'o nome que fica é o da primeira vez que aparece — aqui, a ficha');
  });

  it('o mesmo ingrediente em dois produtos aparece uma vez, com os dois; nome vazio não entra', () => {
    const b = copia(BASE);
    const outro = { ...copia(BASE).produtos.find((p) => p.id === XBURGER.id)!, id: randomUUID(), nome: 'X-Salada', adicionais: [] };
    outro.ficha!.ingredientes = [{ ...outro.ficha!.ingredientes[0]!, nome: 'PÃO BRIOCHE' }, { ...outro.ficha!.ingredientes[0]!, nome: '   ' }];
    b.produtos.push(outro);
    const pao = ingredientesDaBase(b).filter((i) => chaveDoIngrediente(i.nome) === 'pão brioche');
    assert.equal(pao.length, 1);
    assert.deepEqual(pao[0]!.produtos.map((o) => o.produto), ['X-Burger', 'X-Salada']);
    assert.equal(ingredientesDaBase(b).length, DO_CONTRATO.length, 'o nome em branco não virou ingrediente');
  });

  it('sem base, nenhum ingrediente', () => {
    assert.deepEqual(ingredientesDaBase(null), []);
  });

  it('o grupo de "tirar" não acrescenta ingrediente, nem com um efeito de insumo por engano da fonte', () => {
    const b = copia(BASE);
    const tirar = b.produtos.find((p) => p.id === XBURGER.id)!.adicionais.find((g) => g.tipo === 'remover')!;
    tirar.opcoes.push({ id: null, nome: 'Sem picles', codigo: null, efeito: { tipo: 'insumo', nome: 'Picles', quantidade: null, unidade: null, insumoId: null } });
    assert.deepEqual(ingredientesDaBase(b).map((i) => i.nome), DO_CONTRATO);
  });
});

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-ingred-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-ingredientes';
const SENHA = 'uma senha longa o bastante';

describe('os ingredientes e as fotos de referência (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  let lojaId = '';
  let tenantId = '';
  let lojaVizinha = '';
  let cookie = '';
  let cookieSupervisao = '';
  let cookieExecucao = '';
  let cookieVizinho = '';

  type Foto = { id: string; largura: number | null; altura: number | null; legenda: string | null; criadoEm: string };
  type Ingrediente = { nome: string; produtos: unknown[]; itemId: string | null; visivel: boolean; fotos: Foto[]; exemplos: number };
  type Lista = { limiteDeFotos: number; podeConfigurar: boolean; ingredientes: Ingrediente[]; orfaos: { itemId: string; nome: string; fotos: Foto[] }[] };

  async function entrar(tenant: string, email: string, nivel: string) {
    await app.inject({
      method: 'POST', url: '/v1/distribuicao/usuarios', headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId: tenant, nome: 'X', email, senha: SENHA, nivel },
    });
    const r = await app.inject({ method: 'POST', url: '/v1/sessao', payload: { email, senha: SENHA } });
    const b = r.headers['set-cookie'];
    return (Array.isArray(b) ? b[0]! : String(b)).split(';')[0]!;
  }
  /** A base de fichas da loja, como a planilha a deixaria. */
  async function porFichas(base: Base) {
    const { produtos, comFicha } = contarBase(base);
    await pool.query(
      `insert into fichas_da_loja (loja_id, tenant_id, fonte, conteudo, impressao, produtos, com_ficha)
       values ($1, $2, 'planilha', $3, $4, $5, $6)
       on conflict (loja_id) do update set conteudo = excluded.conteudo, impressao = excluded.impressao,
              produtos = excluded.produtos, com_ficha = excluded.com_ficha, atualizada_em = now()`,
      [lojaId, tenantId, JSON.stringify(base), impressaoDaBase(base), produtos, comFicha],
    );
  }
  const listar = (comCookie: string | null = cookie, loja = lojaId) =>
    app.inject({ method: 'GET', url: `/v1/lojas/${loja}/ingredientes`, headers: comCookie ? { cookie: comCookie } : {} });
  const lista = async () => {
    const r = await listar();
    assert.equal(r.statusCode, 200, r.body);
    return r.json() as Lista;
  };
  const doIngrediente = async (nome: string) => (await lista()).ingredientes.find((i) => i.nome === nome)!;
  const mandar = (nome: unknown, bytes: Buffer | null, mais: Record<string, unknown> = {}, comCookie = cookie, loja = lojaId) =>
    app.inject({
      method: 'POST', url: `/v1/lojas/${loja}/ingredientes/fotos`, headers: { cookie: comCookie },
      payload: { nome, ...(bytes ? { imagemBase64: bytes.toString('base64') } : {}), ...mais },
    });
  const verFoto = (id: string, comCookie = cookie) =>
    app.inject({ method: 'GET', url: `/v1/base/fotos/${id}/imagem`, headers: { cookie: comCookie } });
  const tirar = (id: string, comCookie = cookie) => app.inject({ method: 'DELETE', url: `/v1/base/fotos/${id}`, headers: { cookie: comCookie } });
  const visivel = (corpo: Record<string, unknown>, comCookie = cookie) =>
    app.inject({ method: 'PUT', url: `/v1/lojas/${lojaId}/ingredientes/visivel`, headers: { cookie: comCookie }, payload: corpo });
  const juntar = (itemId: string, para: unknown, comCookie = cookie) =>
    app.inject({ method: 'POST', url: `/v1/base/itens/${itemId}/juntar`, headers: { cookie: comCookie }, payload: { para } });
  const apagar = (itemId: string, comCookie = cookie) =>
    app.inject({ method: 'DELETE', url: `/v1/base/itens/${itemId}`, headers: { cookie: comCookie } });

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
    tenantId = conta.tenantId;
    cookie = await entrar(tenantId, `ger-${marca}@e.com`, 'gerente');
    cookieSupervisao = await entrar(tenantId, `sup-${marca}@e.com`, 'supervisao');
    cookieExecucao = await entrar(tenantId, `exe-${marca}@e.com`, 'execucao');
    await porFichas(BASE);

    const vizinha = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome: `${marca}-vizinha` }, loja: { nome: 'Vizinha' }, setores: [{ nome: 'Cozinha' }] },
    })).json();
    lojaVizinha = vizinha.loja.id;
    cookieVizinho = await entrar(vizinha.tenantId, `ger-${marca}-viz@e.com`, 'gerente');
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    // Apagar a conta leva junto os ingredientes e as fotos: as ligações da 001 não deixam a exclusão presa.
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    const sobrou = await pool?.query('select count(*)::int as n from base_conhecimento where loja_id = $1', [lojaId]);
    assert.equal(sobrou?.rows[0].n, 0);
    await pool?.end();
  });

  it('lista os ingredientes das fichas, ainda sem foto; quem acompanha vê, e os outros não', async () => {
    const l = await lista();
    assert.equal(l.limiteDeFotos, MAX_FOTOS_POR_INGREDIENTE);
    assert.equal(l.podeConfigurar, true);
    assert.deepEqual(l.ingredientes.map((i) => i.nome), DO_CONTRATO);
    for (const i of l.ingredientes) assert.deepEqual([i.itemId, i.visivel, i.fotos, i.exemplos], [null, true, [], 0], i.nome);
    assert.deepEqual(l.orfaos, []);

    const sup = await listar(cookieSupervisao);
    assert.equal(sup.statusCode, 200, sup.body);
    assert.equal(sup.json().podeConfigurar, false, 'a supervisão vê, mas a tela não mostra o que é de quem configura');
    assert.equal((await listar(cookieExecucao)).statusCode, 403);
    assert.equal((await listar(null)).statusCode, 401);
    assert.equal((await listar(cookieVizinho)).statusCode, 404, 'a loja de outra conta não existe para quem pede');
    assert.equal((await listar(cookie, 'nao-e-id')).statusCode, 422);
    const semFichas = await listar(cookieVizinho, lojaVizinha);
    assert.equal(semFichas.statusCode, 200, semFichas.body);
    assert.deepEqual(semFichas.json().ingredientes, [], 'loja sem fichas, nenhum ingrediente');
  });

  it('manda foto: só JPEG, até 1,5 MB, de um ingrediente das fichas; a lista não traz os bytes', async () => {
    const bytes = jpeg(640, 480, 7);
    const r = await mandar('  queijo PRATO ', bytes, { legenda: ' a fatia inteira, de cima ' });
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json().nome, 'Queijo prato', 'o nome que fica é o da ficha, não o que veio');
    // é o nome guardado que aparece quando o ingrediente vira órfão
    assert.equal((await pool.query('select nome from base_conhecimento where id = $1', [r.json().itemId])).rows[0].nome, 'Queijo prato');

    const queijo = await doIngrediente('Queijo prato');
    assert.equal(queijo.itemId, r.json().itemId);
    assert.equal(queijo.fotos.length, 1);
    assert.deepEqual(Object.keys(queijo.fotos[0]!).sort(), ['altura', 'criadoEm', 'id', 'largura', 'legenda'], 'sem os bytes');
    assert.deepEqual([queijo.fotos[0]!.largura, queijo.fotos[0]!.altura, queijo.fotos[0]!.legenda], [640, 480, 'a fatia inteira, de cima']);

    const ver = await verFoto(r.json().fotoId);
    assert.equal(ver.statusCode, 200);
    assert.equal(ver.headers['content-type'], 'image/jpeg');
    assert.equal(ver.headers['x-content-type-options'], 'nosniff');
    assert.ok(ver.rawPayload.equals(bytes), 'a foto volta como foi');
    const linha = (await pool.query('select sha256, criado_por, origem from base_frame where id = $1', [r.json().fotoId])).rows[0];
    assert.equal(linha.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.ok(linha.criado_por, 'fica quem mandou');
    assert.equal(linha.origem, 'foto');
    assert.equal((await verFoto(r.json().fotoId, cookieVizinho)).statusCode, 404, 'outra conta não vê a foto');

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    assert.equal((await mandar('Queijo prato', png)).statusCode, 422, 'não é JPEG');
    const grande = await mandar('Queijo prato', Buffer.concat([jpeg(10, 10), Buffer.alloc(MAX_BYTES_DA_FOTO)]));
    assert.equal(grande.statusCode, 413, grande.body);
    const fora = await mandar('Picles', bytes);
    assert.equal(fora.statusCode, 404);
    assert.equal(fora.json().erro, 'ingrediente_nao_encontrado');
    assert.equal((await mandar('Queijo prato', bytes, { legenda: 'x'.repeat(121) })).statusCode, 422);
    assert.equal((await mandar('Queijo prato', bytes, { legenda: 3 })).statusCode, 422);
    assert.equal((await mandar('Queijo prato', null)).statusCode, 422, 'sem a imagem');
    assert.equal((await mandar('   ', bytes)).statusCode, 422, 'sem o nome');
    assert.equal((await mandar(['Queijo prato'], bytes)).statusCode, 422, 'nome que não é texto');
    assert.equal((await doIngrediente('Queijo prato')).fotos.length, 1, 'nada do que foi recusado entrou');

    assert.equal((await mandar('Queijo prato', jpeg(320, 240, 8), {}, cookieSupervisao)).statusCode, 201, 'a supervisão manda foto');
    assert.equal((await mandar('Queijo prato', bytes, {}, cookieExecucao)).statusCode, 403);
    assert.equal((await mandar('Queijo prato', bytes, {}, cookieVizinho)).statusCode, 404, 'na loja de outra conta, não');
  });

  it(`até ${MAX_FOTOS_POR_INGREDIENTE} fotos por ingrediente — também com envios ao mesmo tempo`, async () => {
    for (let n = 0; n < 4; n += 1) assert.equal((await mandar('Blend da casa', jpeg(100, 100, n))).statusCode, 201);
    const juntos = await Promise.all([10, 11, 12, 13, 14].map((n) => mandar('Blend da casa', jpeg(100, 100, n))));
    assert.deepEqual(juntos.map((r) => r.statusCode).sort(), [201, 201, 409, 409, 409], 'das cinco ao mesmo tempo, só cabem duas');
    for (const r of juntos.filter((x) => x.statusCode === 409)) assert.equal(r.json().erro, 'limite');
    assert.equal((await doIngrediente('Blend da casa')).fotos.length, MAX_FOTOS_POR_INGREDIENTE);
    const setima = await mandar('Blend da casa', jpeg(100, 100, 99));
    assert.equal(setima.statusCode, 409);
    assert.match(setima.json().mensagem, /Blend da casa já tem 6 fotos/);
    const n = await pool.query(
      `select count(*)::int as n from base_frame f join base_conhecimento b on b.id = f.base_id where b.loja_id = $1 and lower(b.nome) = 'blend da casa'`,
      [lojaId],
    );
    assert.equal(n.rows[0].n, MAX_FOTOS_POR_INGREDIENTE, 'e no banco também');
  });

  it('tirar foto é de quem configura; a de outra conta não é achada', async () => {
    const foto = (await doIngrediente('Queijo prato')).fotos[0]!;
    const sup = await tirar(foto.id, cookieSupervisao);
    assert.equal(sup.statusCode, 403);
    assert.match(sup.json().mensagem, /quem configura a loja/);
    assert.equal((await tirar(foto.id, cookieVizinho)).statusCode, 404);
    const r = await tirar(foto.id);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().excluida, true);
    assert.equal((await tirar(foto.id)).statusCode, 404, 'a segunda vez não acha');
    assert.equal((await verFoto(foto.id)).statusCode, 404);
    assert.equal((await doIngrediente('Queijo prato')).fotos.length, 1);

    // o exemplo da bancada (o recorte que a conferência guarda, fatia T5) não se tira por aqui
    const exemplo = await pool.query(
      `insert into base_frame (base_id, origem, imagem, sha256) values ($1, 'bancada', $2, $3) returning id`,
      [(await doIngrediente('Queijo prato')).itemId, jpeg(50, 50), createHash('sha256').update(jpeg(50, 50)).digest('hex')],
    );
    assert.equal((await tirar(exemplo.rows[0].id)).statusCode, 404);
    const queijo = await doIngrediente('Queijo prato');
    assert.deepEqual([queijo.fotos.length, queijo.exemplos], [1, 1], 'o exemplo conta à parte e continua lá');
  });

  it('"não se vê de cima": só true ou false, de quem configura, e de ingrediente das fichas', async () => {
    for (const torto of ['false', 0, null]) assert.equal((await visivel({ nome: 'Sal', visivel: torto })).statusCode, 422, String(torto));
    assert.equal((await visivel({ nome: 'Sal' })).statusCode, 422, 'sem o valor não vira decisão');
    assert.equal((await visivel({ nome: 'Sal', visivel: false }, cookieSupervisao)).statusCode, 403);
    assert.equal((await visivel({ nome: 'Picles', visivel: false })).statusCode, 404);

    const r = await visivel({ nome: ' sal ', visivel: false });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual([r.json().nome, r.json().visivel], ['Sal', false]);
    const sal = await doIngrediente('Sal');
    assert.deepEqual([sal.visivel, sal.fotos], [false, []], 'o item nasce sem foto');
    assert.equal((await visivel({ nome: 'Sal', visivel: true })).json().visivel, true);
    assert.equal((await doIngrediente('Sal')).visivel, true);
    assert.equal((await doIngrediente('Queijo prato')).visivel, true, 'um não mexe no outro');
  });

  it('o ingrediente que sai das fichas vira órfão: junta-se ao nome novo, nunca descartando foto — ou apaga-se', async () => {
    // a cebola ganha duas fotos e, depois, muda de nome nas fichas
    assert.equal((await mandar('Cebola roxa', jpeg(200, 200, 1))).statusCode, 201);
    assert.equal((await mandar('Cebola roxa', jpeg(200, 200, 2))).statusCode, 201);
    const queijoId = (await doIngrediente('Queijo prato')).itemId!;
    const nova = copia(BASE);
    for (const i of nova.produtos.find((p) => p.id === XBURGER.id)!.ficha!.ingredientes) if (i.nome === 'Cebola roxa') i.nome = 'Cebola roxa fatiada';
    await porFichas(nova);

    const l = await lista();
    assert.ok(!l.ingredientes.some((i) => i.nome === 'Cebola roxa'));
    assert.deepEqual((await doIngrediente('Cebola roxa fatiada')).fotos, [], 'o nome novo começa sem foto');
    assert.deepEqual(l.orfaos.map((o) => [o.nome, o.fotos.length]), [['Cebola roxa', 2]]);
    const orfao = l.orfaos[0]!.itemId;

    assert.equal((await juntar(queijoId, 'Cebola roxa fatiada')).json().erro, 'nao_e_orfao', 'o que está nas fichas não se junta');
    assert.equal((await juntar(orfao, 'Picles')).statusCode, 404);
    assert.equal((await juntar(orfao, 'Cebola roxa fatiada', cookieSupervisao)).statusCode, 403);
    assert.equal((await juntar(orfao, 'Cebola roxa fatiada', cookieVizinho)).statusCode, 404);
    const cheio = await juntar(orfao, 'Blend da casa');
    assert.equal(cheio.statusCode, 409, cheio.body);
    assert.match(cheio.json().mensagem, /ficariam 8 fotos no Blend da casa.*Tire 2/);
    assert.equal((await lista()).orfaos.length, 1, 'a recusa não mexeu em nada');

    const r = await juntar(orfao, ' cebola roxa FATIADA ');
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual([r.json().nome, r.json().de, r.json().movidas], ['Cebola roxa fatiada', 'Cebola roxa', 2]);
    assert.equal((await doIngrediente('Cebola roxa fatiada')).fotos.length, 2);
    assert.deepEqual((await lista()).orfaos, []);
    assert.equal((await pool.query('select 1 from base_conhecimento where id = $1', [orfao])).rowCount, 0, 'o órfão saiu');

    // o ovo ganha uma foto e sai das fichas (o adicional some): apagar. O bacon sai junto, mas só tinha o "não se
    // vê de cima", sem foto: não vira órfão (não há o que juntar nem apagar).
    const ovo = await mandar('Ovo frito', jpeg(150, 150, 3));
    assert.equal(ovo.statusCode, 201, ovo.body);
    assert.equal((await visivel({ nome: 'Bacon fatiado', visivel: false })).statusCode, 200);
    const semOvo = copia(nova);
    const grupo = semOvo.produtos.find((p) => p.id === XBURGER.id)!.adicionais.find((g) => g.tipo === 'adicionar')!;
    grupo.opcoes = grupo.opcoes.filter((o) => o.nome !== 'Ovo' && o.nome !== 'Bacon');
    await porFichas(semOvo);
    assert.deepEqual((await lista()).orfaos.map((o) => o.nome), ['Ovo frito'], 'o bacon sem foto não é órfão');
    const orfaoDoOvo = (await lista()).orfaos.find((o) => o.nome === 'Ovo frito')!.itemId;
    assert.equal((await apagar(orfaoDoOvo, cookieSupervisao)).statusCode, 403);
    assert.equal((await apagar(orfaoDoOvo, cookieVizinho)).statusCode, 404);
    assert.equal((await apagar(queijoId)).json().erro, 'nao_e_orfao', 'o que está nas fichas não se apaga inteiro');
    const a = await apagar(orfaoDoOvo);
    assert.equal(a.statusCode, 200, a.body);
    assert.deepEqual([a.json().excluido, a.json().quadros], [true, 1]);
    assert.deepEqual((await lista()).orfaos, []);
    assert.equal((await verFoto(ovo.json().fotoId)).statusCode, 404, 'a foto foi junto');
  });
});
