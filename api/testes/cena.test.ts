// A cena do canal, o papel do quadro e a chave do pedido com contexto.
//
// A19, onda 1, fatia 1.1. O dono perguntou (08/10/2026): "o que sobe à
// nuvem? Se enviar um corte sem contexto, a análise vai falhar e o custo vai
// ser em vão." O contexto passa a ter onde morar — e o que tem de ficar
// provado aqui:
//
//   - o que desce para o agente é exatamente o que `contratos/cena-do-canal.json`
//     diz (o teste do agente lê o MESMO arquivo);
//   - nada muda para quem já está no ar: tudo nasce vazio e a chave, desligada;
//   - o número do quadro é a posição dele entre os quadros do canal — a
//     imagem completa não tem número, e cada canal conta os seus;
//   - quem escreveu a cena, e quando, só mudam quando o TEXTO muda;
//   - a chave é da distribuição: o console da loja não a liga, nem o
//     presidente — e só `true` ou `false` a movem;
//   - só quem configura escreve; outra conta nem sabe que o canal existe.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { MAX_CENA, MAX_TIPO_DE_NEGOCIO, PAPEIS, lerCena, lerOrdem, lerPapel, lerTipoDeNegocio } from '../src/cena.js';

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-cena-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-cena';
const SENHA = 'uma senha longa o bastante';
const RET = (x1: number, y1: number, x2: number, y2: number) => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
const INTEIRO = [[0, 0], [1, 0], [1, 1], [0, 1]];

type Papel = (typeof PAPEIS)[number];
type ZonaDoContrato = { nome: string; poligono: number[][]; papel: Papel; numero: number | null };
const CONTRATO = JSON.parse(readFileSync(new URL('../../contratos/cena-do-canal.json', import.meta.url), 'utf8')) as {
  papeis: Record<string, string>;
  configuracao: {
    loja: { tipoNegocio: string; pedidoComContexto: boolean };
    ponto: { nome: string; setor: string; cena: string };
    zonas: ZonaDoContrato[];
  };
};

// ───────────────────── as leituras, sem banco ─────────────────────

describe('a cena e o papel — o que se aceita', () => {
  it('os papéis são os do contrato, na mesma ordem', () => {
    assert.deepEqual([...PAPEIS], Object.keys(CONTRATO.papeis));
    assert.equal(CONTRATO.papeis.livre, '', '"livre" é sem papel definido: não tem nome para pôr no mapa');
    for (const [papel, nome] of Object.entries(CONTRATO.papeis)) {
      if (papel !== 'livre') assert.ok(nome.trim(), `o papel ${papel} tem nome`);
    }
  });

  it('a cena fica como a pessoa escreveu, aparada', () => {
    assert.deepEqual(lerCena('  Bancada vista de cima.\r\nAs cubas ficam no alto.  '), { valor: 'Bancada vista de cima.\nAs cubas ficam no alto.' });
    assert.deepEqual(lerCena(''), { valor: '' }, 'vazia apaga');
    assert.deepEqual(lerCena('   '), { valor: '' });
    assert.equal(lerCena('x'.repeat(MAX_CENA)).valor?.length, MAX_CENA, 'no limite, entra');
    assert.match(lerCena('x'.repeat(MAX_CENA + 1)).problema ?? '', /no máximo 2000 caracteres \(veio com 2001\)/);
    for (const torto of [null, 12, true, ['a'], { texto: 'a' }]) {
      assert.equal(lerCena(torto).problema, 'cena: escreva um texto');
    }
  });

  it('o tipo de negócio é uma linha só', () => {
    assert.deepEqual(lerTipoDeNegocio('  hamburgueria \n artesanal  '), { valor: 'hamburgueria artesanal' });
    assert.deepEqual(lerTipoDeNegocio(''), { valor: '' });
    assert.equal(lerTipoDeNegocio('x'.repeat(MAX_TIPO_DE_NEGOCIO)).valor?.length, MAX_TIPO_DE_NEGOCIO);
    assert.match(lerTipoDeNegocio('x'.repeat(MAX_TIPO_DE_NEGOCIO + 1)).problema ?? '', /no máximo 80 caracteres/);
    assert.equal(lerTipoDeNegocio(7).problema, 'tipoNegocio: escreva um texto');
  });

  it('papel fora da lista e ordem fora da faixa são recusados', () => {
    for (const papel of PAPEIS) assert.deepEqual(lerPapel(papel), { valor: papel });
    for (const torto of ['Cuba', 'cubas', '', ' posto', null, 3, ['pia']]) {
      assert.match(lerPapel(torto).problema ?? '', /^papel: um de posto, cuba, montagem/);
    }
    for (const boa of [0, 1, 99]) assert.deepEqual(lerOrdem(boa), { valor: boa });
    for (const torta of [-1, 100, 1.5, '2', null, Number.NaN]) {
      assert.equal(lerOrdem(torta).problema, 'ordem: um número inteiro de 0 a 99');
    }
  });
});

// ───────────────────────── com o banco ─────────────────────────

type Zona = { id: string; nome: string; principal: boolean; papel: string; ordem: number; numero: number | null };

describe('a cena do canal e o papel do quadro (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  let tenantId = '';
  let lojaId = '';
  let setorId = '';
  let cookie = '';
  let cookieOutroGerente = '';
  let cookiePresidente = '';
  let cookieSupervisao = '';
  let cookieVizinho = '';
  let token = '';

  async function entrar(tenant: string, email: string, nivel: string, nome = 'X') {
    await app.inject({
      method: 'POST', url: '/v1/distribuicao/usuarios', headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId: tenant, nome, email, senha: SENHA, nivel },
    });
    const r = await app.inject({ method: 'POST', url: '/v1/sessao', payload: { email, senha: SENHA } });
    const b = r.headers['set-cookie'];
    return (Array.isArray(b) ? b[0]! : String(b)).split(';')[0]!;
  }

  async function canalNovo(nome: string) {
    const r = await app.inject({
      method: 'POST', url: `/v1/setores/${setorId}/pontos`, headers: { cookie },
      payload: { nome, origem: 'dvr', canal: Math.floor(Math.random() * 60) + 1, host: '192.168.1.108' },
    });
    assert.equal(r.statusCode, 201, r.body);
    return { pontoId: r.json().id as string, inteira: r.json().zonas[0].id as string };
  }

  const mudarLoja = (corpo: unknown, comCookie = cookie, id = lojaId) =>
    app.inject({ method: 'PATCH', url: `/v1/lojas/${id}`, headers: { cookie: comCookie }, payload: corpo as object });
  const mudarPonto = (pontoId: string, corpo: unknown, comCookie = cookie) =>
    app.inject({ method: 'PATCH', url: `/v1/pontos/${pontoId}`, headers: { cookie: comCookie }, payload: corpo as object });
  const mudarZona = (zonaId: string, corpo: unknown, comCookie = cookie) =>
    app.inject({ method: 'PATCH', url: `/v1/zonas/${zonaId}`, headers: { cookie: comCookie }, payload: corpo as object });
  const criarZona = (pontoId: string, corpo: unknown, comCookie = cookie) =>
    app.inject({ method: 'POST', url: `/v1/pontos/${pontoId}/zonas`, headers: { cookie: comCookie }, payload: corpo as object });
  const chave = (corpo: unknown, cabecalhos: Record<string, string> = { 'x-farol-admin': ADMIN }, id = lojaId) =>
    app.inject({ method: 'PATCH', url: `/v1/distribuicao/lojas/${id}`, headers: cabecalhos, payload: corpo as object });
  const canal = async (pontoId: string, comCookie = cookie) =>
    (await app.inject({ method: 'GET', url: `/v1/pontos/${pontoId}`, headers: { cookie: comCookie } })).json() as {
      ponto: { cena: string; cena_escrita_em: string | null; cena_escrita_por_nome: string | null; loja_tipo_negocio: string };
      zonas: Zona[];
    };
  /** nome → número, como a tela recebe. */
  const numeros = async (pontoId: string) => Object.fromEntries((await canal(pontoId)).zonas.map((z) => [z.nome, z.numero]));

  const doAgente = (metodo: 'GET' | 'POST', url: string, payload?: unknown) =>
    app.inject({ method: metodo, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });
  const configuracao = async () => (await doAgente('GET', '/v1/agentes/configuracao')).json() as {
    versao: number;
    loja: Record<string, unknown>;
    pontos: { id: string; nome: string; setor: string; cena: string; zonas: { nome: string; poligono: number[][]; papel: string; numero: number | null }[] }[];
  };
  const versao = async () => (await pool.query(`select config_versao from loja where id = $1`, [lojaId])).rows[0].config_versao as number;
  const chaveNoBanco = async () =>
    (await pool.query(`select pedido_com_contexto from loja where id = $1`, [lojaId])).rows[0].pedido_com_contexto as boolean;

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    app = criarApp(pool, { logger: false });
    await app.ready();

    const conta = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome: marca }, loja: { nome: 'Matriz' }, setores: [{ nome: CONTRATO.configuracao.ponto.setor }] },
    })).json();
    tenantId = conta.tenantId;
    lojaId = conta.loja.id;
    setorId = conta.setores[0].id;
    cookie = await entrar(tenantId, `ger-${marca}@e.com`, 'gerente', 'Gerente Um');
    cookieOutroGerente = await entrar(tenantId, `ger2-${marca}@e.com`, 'gerente', 'Gerente Dois');
    cookiePresidente = await entrar(tenantId, `pre-${marca}@e.com`, 'presidente', 'Presidente');
    cookieSupervisao = await entrar(tenantId, `sup-${marca}@e.com`, 'supervisao', 'Supervisão');

    const vizinha = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome: `${marca}-vizinha` }, loja: { nome: 'Vizinha' }, setores: [] },
    })).json();
    cookieVizinho = await entrar(vizinha.tenantId, `ger-${marca}-viz@e.com`, 'gerente');

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

  // ─────────────────────── nasce desligado ───────────────────────

  it('canal novo desce sem cena, com o quadro inteiro sem número — e a chave desligada', async () => {
    const c = await canalNovo('Balcão');
    const cfg = await configuracao();
    assert.equal(cfg.loja.tipoNegocio, '');
    assert.equal(cfg.loja.pedidoComContexto, false, 'a chave nasce desligada');
    const ponto = cfg.pontos.find((p) => p.id === c.pontoId)!;
    assert.equal(ponto.cena, '');
    assert.deepEqual(ponto.zonas.map((z) => [z.nome, z.papel, z.numero]), [['Quadro inteiro', 'livre', null]]);

    const tela = await canal(c.pontoId);
    assert.equal(tela.ponto.cena, '');
    assert.equal(tela.ponto.cena_escrita_em, null);
    assert.equal(tela.ponto.cena_escrita_por_nome, null);
    assert.deepEqual(tela.zonas.map((z) => [z.nome, z.papel, z.ordem, z.numero]), [['Quadro inteiro', 'livre', 0, null]]);
  });

  // ─────────────────────── o contrato ───────────────────────

  it('o que desce para o agente é o que o contrato diz', async () => {
    const esperado = CONTRATO.configuracao;
    assert.equal((await mudarLoja({ tipoNegocio: esperado.loja.tipoNegocio })).statusCode, 200);
    const c = await canalNovo(esperado.ponto.nome);
    assert.equal((await mudarPonto(c.pontoId, { cena: esperado.ponto.cena })).statusCode, 200);
    for (const z of esperado.zonas.filter((x) => x.numero !== null)) {
      const r = await criarZona(c.pontoId, { nome: z.nome, poligono: z.poligono, papel: z.papel });
      assert.equal(r.statusCode, 201, r.body);
      assert.equal(r.json().papel, z.papel);
    }
    assert.equal((await chave({ pedidoComContexto: esperado.loja.pedidoComContexto })).statusCode, 200);

    try {
      const cfg = await configuracao();
      assert.equal(cfg.loja.tipoNegocio, esperado.loja.tipoNegocio);
      assert.equal(cfg.loja.pedidoComContexto, esperado.loja.pedidoComContexto);
      const ponto = cfg.pontos.find((p) => p.id === c.pontoId)!;
      assert.equal(ponto.nome, esperado.ponto.nome);
      assert.equal(ponto.setor, esperado.ponto.setor);
      assert.equal(ponto.cena, esperado.ponto.cena);
      const desceu = Object.fromEntries(ponto.zonas.map((z) => [z.nome, { nome: z.nome, poligono: z.poligono, papel: z.papel, numero: z.numero }]));
      assert.deepEqual(esperado.zonas.map((z) => desceu[z.nome]), esperado.zonas, 'cada quadro com o papel e o número do contrato');
    } finally {
      await chave({ pedidoComContexto: false });
    }
  });

  // ─────────────────────── o número do quadro ───────────────────────

  it('o número é a posição entre os quadros do canal, e cada canal conta os seus', async () => {
    const a = await canalNovo('Chapa');
    const b = await canalNovo('Fritadeira');
    const ids: Record<string, string> = {};
    for (const nome of ['Um', 'Dois', 'Três']) {
      ids[nome] = (await criarZona(a.pontoId, { nome, poligono: RET(0.1, 0.1, 0.4, 0.4) })).json().id;
    }
    ids.Outro = (await criarZona(b.pontoId, { nome: 'Outro', poligono: RET(0.5, 0.5, 0.9, 0.9) })).json().id;

    assert.deepEqual(await numeros(a.pontoId), { 'Quadro inteiro': null, Um: 1, Dois: 2, Três: 3 });
    assert.deepEqual(await numeros(b.pontoId), { 'Quadro inteiro': null, Outro: 1 }, 'o segundo canal começa do 1');

    // No que desce para o agente, o mesmo número — para os dois canais de uma vez.
    const cfg = await configuracao();
    const noAgente = (pontoId: string) => Object.fromEntries(cfg.pontos.find((p) => p.id === pontoId)!.zonas.map((z) => [z.nome, z.numero]));
    assert.deepEqual(noAgente(a.pontoId), { 'Quadro inteiro': null, Um: 1, Dois: 2, Três: 3 });
    assert.deepEqual(noAgente(b.pontoId), { 'Quadro inteiro': null, Outro: 1 });

    // Excluir um quadro renumera os que ficaram.
    assert.equal((await app.inject({ method: 'DELETE', url: `/v1/zonas/${ids.Dois}`, headers: { cookie } })).statusCode, 200);
    assert.deepEqual(await numeros(a.pontoId), { 'Quadro inteiro': null, Um: 1, Três: 2 });

    // A ordem manda; no empate, a data de criação.
    const r = await mudarZona(ids.Um!, { ordem: 5 });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().ordem, 5);
    assert.deepEqual(await numeros(a.pontoId), { 'Quadro inteiro': null, Três: 1, Um: 2 });

    // "Quadro inteiro" redesenhado deixa de ser a imagem completa: vira quadro, e ganha número.
    assert.equal((await mudarZona(a.inteira, { poligono: RET(0.2, 0.2, 0.8, 0.8) })).statusCode, 200);
    assert.deepEqual(await numeros(a.pontoId), { 'Quadro inteiro': 1, Três: 2, Um: 3 }, 'criado antes dos outros: é o primeiro');
    // E um quadro esticado até cobrir tudo passa a ser a imagem completa: sem número.
    assert.equal((await mudarZona(ids.Três!, { poligono: INTEIRO })).statusCode, 200);
    assert.deepEqual(await numeros(a.pontoId), { 'Quadro inteiro': 1, Três: null, Um: 2 });

    assert.deepEqual(await numeros(b.pontoId), { 'Quadro inteiro': null, Outro: 1 }, 'nada disso mexeu no outro canal');
  });

  // ─────────────────────── o papel ───────────────────────

  it('o papel do quadro: nasce "livre", muda só para o que existe, e campo ausente não o apaga', async () => {
    const c = await canalNovo('Pia');
    const livre = await criarZona(c.pontoId, { nome: 'Sem papel', poligono: RET(0.1, 0.1, 0.3, 0.3) });
    assert.equal(livre.json().papel, 'livre');
    assert.equal(livre.json().ordem, 0);

    const torto = await criarZona(c.pontoId, { nome: 'Torto', poligono: RET(0.1, 0.1, 0.3, 0.3), papel: 'lavatório' });
    assert.equal(torto.statusCode, 422);
    assert.match(torto.json().mensagem, /^papel: um de posto, cuba/);
    assert.equal((await canal(c.pontoId)).zonas.length, 2, 'a área recusada não nasceu');

    const id = livre.json().id as string;
    const versaoAntes = await versao();
    const r = await mudarZona(id, { papel: 'pia' });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().papel, 'pia');
    assert.ok((await versao()) > versaoAntes, 'mudar o papel faz o agente puxar a configuração');

    // Renomear não leva o papel embora, nem a ordem.
    assert.equal((await mudarZona(id, { ordem: 3 })).statusCode, 200);
    const renomeada = await mudarZona(id, { nome: 'Pia das mãos' });
    assert.deepEqual([renomeada.json().nome, renomeada.json().papel, renomeada.json().ordem], ['Pia das mãos', 'pia', 3]);

    for (const corpo of [{ papel: 'PIA' }, { papel: '' }, { papel: null }, { ordem: -1 }, { ordem: 100 }, { ordem: '2' }, { ordem: 1.5 }]) {
      const ruim = await mudarZona(id, corpo);
      assert.equal(ruim.statusCode, 422, JSON.stringify(corpo));
    }
    const depois = (await canal(c.pontoId)).zonas.find((z) => z.id === id)!;
    assert.deepEqual([depois.papel, depois.ordem], ['pia', 3], 'pedido recusado não mudou nada');

    // No banco, a lista é a mesma: valor de fora nem por SQL entra (23514 = check).
    await assert.rejects(pool.query(`update zona set papel = 'lavatorio' where id = $1`, [id]), { code: '23514' });
    await assert.rejects(pool.query(`update zona set ordem = 100 where id = $1`, [id]), { code: '23514' });
  });

  // ─────────────────────── a cena ───────────────────────

  it('a cena: quem escreveu e quando só mudam quando o texto muda', async () => {
    const c = await canalNovo('Estoque');
    const versaoAntes = await versao();
    const r = await mudarPonto(c.pontoId, { cena: '  Prateleiras do estoque seco, vistas de frente.\r\nA porta fica à esquerda.  ' });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().cena, 'Prateleiras do estoque seco, vistas de frente.\nA porta fica à esquerda.', 'aparada, com a quebra de linha de quem escreveu');
    assert.ok(r.json().cena_escrita_em);
    assert.ok((await versao()) > versaoAntes, 'a cena nova faz o agente puxar a configuração');

    const escrita = await canal(c.pontoId);
    assert.equal(escrita.ponto.cena_escrita_por_nome, 'Gerente Um');
    const quando = escrita.ponto.cena_escrita_em;

    // Outra pessoa salva a tela sem mexer no texto: o autor não troca.
    assert.equal((await mudarPonto(c.pontoId, { cena: escrita.ponto.cena }, cookieOutroGerente)).statusCode, 200);
    // E mexer em outro campo não toca na cena.
    assert.equal((await mudarPonto(c.pontoId, { nome: 'Estoque seco' }, cookieOutroGerente)).statusCode, 200);
    const igual = await canal(c.pontoId);
    assert.deepEqual(
      [igual.ponto.cena, igual.ponto.cena_escrita_por_nome, igual.ponto.cena_escrita_em],
      [escrita.ponto.cena, 'Gerente Um', quando],
    );

    // Mudou o texto: passa a ser de quem mudou.
    assert.equal((await mudarPonto(c.pontoId, { cena: 'Prateleiras do estoque seco.' }, cookieOutroGerente)).statusCode, 200);
    assert.equal((await canal(c.pontoId)).ponto.cena_escrita_por_nome, 'Gerente Dois');

    // Apagada: em branco, sem autor.
    assert.equal((await mudarPonto(c.pontoId, { cena: '   ' })).statusCode, 200);
    const apagada = await canal(c.pontoId);
    assert.deepEqual([apagada.ponto.cena, apagada.ponto.cena_escrita_por_nome, apagada.ponto.cena_escrita_em], ['', null, null]);
  });

  it('cena torta é recusada e não muda nada', async () => {
    const c = await canalNovo('Caixa');
    assert.equal((await mudarPonto(c.pontoId, { cena: 'Caixa visto de cima.' })).statusCode, 200);
    for (const cena of [null, 12, ['a'], 'x'.repeat(MAX_CENA + 1)]) {
      const r = await mudarPonto(c.pontoId, { cena });
      assert.equal(r.statusCode, 422, String(cena).slice(0, 20));
      assert.equal(r.json().erro, 'validacao');
    }
    assert.equal((await canal(c.pontoId)).ponto.cena, 'Caixa visto de cima.');
    // No limite, entra; e o banco tem o mesmo teto (23514 = check).
    assert.equal((await mudarPonto(c.pontoId, { cena: 'x'.repeat(MAX_CENA) })).statusCode, 200);
    await assert.rejects(pool.query(`update ponto set cena = $2 where id = $1`, [c.pontoId, 'x'.repeat(MAX_CENA + 1)]), { code: '23514' });
  });

  // ─────────────────────── o tipo de negócio ───────────────────────

  it('o tipo de negócio vale para a loja e só sobe a versão quando muda', async () => {
    const c = await canalNovo('Salão');
    const r = await mudarLoja({ tipoNegocio: '  pizzaria \n de bairro ' });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json(), { id: lojaId, tipo_negocio: 'pizzaria de bairro' });
    assert.equal((await canal(c.pontoId)).ponto.loja_tipo_negocio, 'pizzaria de bairro', 'a tela do canal recebe junto');
    const daLista = (await app.inject({ method: 'GET', url: '/v1/lojas', headers: { cookie } })).json().lojas.find((l: { id: string }) => l.id === lojaId);
    assert.equal(daLista.tipo_negocio, 'pizzaria de bairro');
    const daLoja = (await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}`, headers: { cookie } })).json().loja;
    assert.equal(daLoja.tipo_negocio, 'pizzaria de bairro');
    assert.equal(daLoja.pedido_com_contexto, undefined, 'a chave interna não aparece para o console');
    assert.equal(daLista.pedido_com_contexto, undefined);

    const antes = await versao();
    assert.equal((await mudarLoja({ tipoNegocio: 'pizzaria de bairro' })).statusCode, 200);
    assert.equal(await versao(), antes, 'salvar sem mudar não faz o agente puxar a configuração');
    assert.equal((await mudarLoja({ tipoNegocio: 'pizzaria' })).statusCode, 200);
    assert.equal(await versao(), antes + 1);
    assert.equal((await configuracao()).loja.tipoNegocio, 'pizzaria');

    for (const corpo of [{}, { tipoNegocio: 7 }, { tipoNegocio: 'x'.repeat(MAX_TIPO_DE_NEGOCIO + 1) }]) {
      assert.equal((await mudarLoja(corpo)).statusCode, 422, JSON.stringify(corpo).slice(0, 40));
    }
    assert.equal((await configuracao()).loja.tipoNegocio, 'pizzaria');
  });

  // ─────────────────────── a chave é da distribuição ───────────────────────

  it('o console da loja não liga a chave — nem o presidente', async () => {
    for (const comCookie of [cookie, cookiePresidente]) {
      for (const corpo of [{ pedidoComContexto: true }, { tipoNegocio: 'bar', pedidoComContexto: true }, { modoJulgamento: 'local' }, { resolucaoPadrao: 'r1080' }]) {
        const r = await mudarLoja(corpo, comCookie);
        assert.equal(r.statusCode, 422, JSON.stringify(corpo));
        assert.equal(r.json().erro, 'so_na_distribuicao');
      }
    }
    assert.equal(await chaveNoBanco(), false);
    assert.notEqual((await configuracao()).loja.tipoNegocio, 'bar', 'o pedido recusado não mudou o resto');

    // A rota da distribuição não aceita sessão de usuário no lugar da credencial dela.
    for (const cabecalhos of [{ cookie: cookiePresidente }, { 'x-farol-admin': 'errada' }, {}]) {
      const r = await chave({ pedidoComContexto: true }, cabecalhos as Record<string, string>);
      assert.equal(r.statusCode, 401, JSON.stringify(Object.keys(cabecalhos)));
    }
    assert.equal(await chaveNoBanco(), false);
  });

  it('só true e false movem a chave, e a versão sobe quando ela muda de lado', async () => {
    for (const valor of ['true', 'sim', 1, 0, null, undefined, [true], { ligado: true }]) {
      const r = await chave({ pedidoComContexto: valor });
      assert.equal(r.statusCode, 422, String(valor));
      assert.equal(r.json().mensagem, 'pedidoComContexto: true ou false');
    }
    assert.equal(await chaveNoBanco(), false, 'valor parecido com verdade não liga');

    const antes = await versao();
    const ligou = await chave({ pedidoComContexto: true });
    assert.equal(ligou.statusCode, 200, ligou.body);
    assert.deepEqual(ligou.json(), { id: lojaId, nome: 'Matriz', pedidoComContexto: true, configVersao: antes + 1 });
    assert.equal((await configuracao()).loja.pedidoComContexto, true);

    assert.equal((await chave({ pedidoComContexto: true })).json().configVersao, antes + 1, 'ligar o que já está ligado não sobe a versão');

    const desligou = await chave({ pedidoComContexto: false });
    assert.deepEqual([desligou.json().pedidoComContexto, desligou.json().configVersao], [false, antes + 2]);
    assert.equal((await configuracao()).loja.pedidoComContexto, false);

    assert.equal((await chave({ pedidoComContexto: true }, { 'x-farol-admin': ADMIN }, randomUUID())).statusCode, 404);
    assert.equal((await chave({ pedidoComContexto: true }, { 'x-farol-admin': ADMIN }, 'nao-e-uuid')).statusCode, 404);
  });

  // ─────────────────────── quem pode ───────────────────────

  it('só quem configura escreve; outra conta nem sabe que existe', async () => {
    const c = await canalNovo('Vitrine');
    const quadro = (await criarZona(c.pontoId, { nome: 'Vidro', poligono: RET(0.1, 0.1, 0.5, 0.5) })).json().id as string;

    // Supervisão acompanha a operação: vê, não escreve.
    assert.equal((await mudarLoja({ tipoNegocio: 'padaria' }, cookieSupervisao)).statusCode, 403);
    assert.equal((await mudarPonto(c.pontoId, { cena: 'Vitrine.' }, cookieSupervisao)).statusCode, 403);
    assert.equal((await mudarZona(quadro, { papel: 'equipamento' }, cookieSupervisao)).statusCode, 403);
    assert.equal((await canal(c.pontoId, cookieSupervisao)).ponto.cena, '', 'mas lê a tela do canal');

    // Outra conta: 404, como se não existisse.
    assert.equal((await mudarLoja({ tipoNegocio: 'padaria' }, cookieVizinho)).statusCode, 404);
    assert.equal((await mudarPonto(c.pontoId, { cena: 'Vitrine.' }, cookieVizinho)).statusCode, 404);
    assert.equal((await mudarZona(quadro, { papel: 'equipamento' }, cookieVizinho)).statusCode, 404);
    assert.equal((await app.inject({ method: 'GET', url: `/v1/pontos/${c.pontoId}`, headers: { cookie: cookieVizinho } })).statusCode, 404);

    const intacto = await canal(c.pontoId);
    assert.equal(intacto.ponto.cena, '');
    assert.equal(intacto.zonas.find((z) => z.id === quadro)!.papel, 'livre');
    assert.notEqual((await configuracao()).loja.tipoNegocio, 'padaria');
  });
});
