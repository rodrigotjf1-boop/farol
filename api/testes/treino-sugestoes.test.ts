// As sugestões para as fichas (A21, fatia T6; migration 051):
//
//   - os quatro tipos, tirados SÓ do que foi conferido: o nome escrito fora das fichas; o que veio a mais sem pedido
//     de novo e de novo; o ingrediente da ficha que faltou de novo e de novo (e quanto entrou); o mesmo nome em molhos
//     de cores diferentes. Um caso só não vira sugestão (pelo menos 3 lanches e metade dos conferidos do produto);
//   - quem configura responde (sim/não); a supervisão não; só se responde ao que o Farol sugere agora; a respondida
//     que as conferências deixaram de mostrar continua na tela, como foi respondida.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { contarBase, impressaoDaBase, type Base } from '../src/fichas.js';
import type { ConferenciaPorEtapa, ConferenciaPorFoto, EtapaLida } from '../src/treino.js';
import { chaveDaSugestao, chaveDeHoje, LIMITES, sugestoesDoTreino, type Conferido } from '../src/treino-sugestoes.js';

const BASE = (JSON.parse(readFileSync(new URL('../../contratos/fichas-da-loja.json', import.meta.url), 'utf8')) as { resposta: { base: Base } }).resposta.base;
const LANCHE = JSON.parse(readFileSync(new URL('../../contratos/lanche-de-treino.json', import.meta.url), 'utf8')) as {
  corpo: { gravacao: Record<string, unknown>; lanche: { etapas: EtapaLida[] } & Record<string, unknown>; quadros: unknown[] };
};

type Etapa = { leu: string | null; candidatos?: string[]; vezes?: number; resposta: ConferenciaPorEtapa['etapas'][number] };
/** Um lanche conferido: as etapas com a resposta de cada uma, o que faltou e o que veio a mais. */
function conferido(produto: string | null, etapas: Etapa[], faltas: ConferenciaPorEtapa['faltas'] = {}, aMais: ConferenciaPorEtapa['aMais'] = {}): Conferido {
  return {
    produto,
    etapas: etapas.map((e, i) => ({ hora: `2026-10-14T22:0${i}:00-03:00`, lado: 'base', inicio: false, leu: e.leu, candidatos: e.candidatos ?? [], vezes: e.vezes ?? 1, quadro: null })),
    conferencia: { produto, etapas: etapas.map((e) => e.resposta), faltas, aMais },
  };
}
const certo = (nome: string, vezes = 1, leu = nome.toLowerCase()): Etapa => ({ leu, candidatos: [nome], vezes, resposta: { v: 'certo', nome: null } });
const outro = (nome: string, leu: string | null = 'algo'): Etapa => ({ leu, candidatos: [], resposta: { v: 'outro', nome } });
/** O X-Burger montado pela ficha, com `queijo` fatias. */
const xBurger = (queijo = 2) => [certo('Pão brioche'), certo('Blend da casa'), certo('Queijo prato', queijo), certo('Cebola roxa')];

/** Uma foto da conferência NOVA: a leitura da etapa e o que a pessoa marcou nela. */
type Foto = { leu: string | null; candidatos?: string[]; vezes?: number; marcados: string[]; ruim?: boolean };
/** Um lanche conferido pela conferência nova: cada etapa com o seu quadro (uma foto por etapa). */
function porFoto(produto: string | null, fotos: Foto[], faltas: ConferenciaPorFoto['faltas'] = {}, aMais: ConferenciaPorFoto['aMais'] = {}): Conferido {
  return {
    produto,
    etapas: fotos.map((e, i) => ({ hora: `2026-10-15T22:0${i}:00-03:00`, lado: 'base', inicio: false, leu: e.leu, candidatos: e.candidatos ?? [], vezes: e.vezes ?? 1, quadro: i })),
    conferencia: {
      versao: 2,
      produto,
      fotos: fotos.map((e, i) => ({ etapas: [i], marcados: e.marcados, ruim: e.ruim ?? false, obs: null })),
      perguntas: {},
      obs: null,
      faltas,
      aMais,
    },
  };
}
const marcada = (nome: string, vezes = 1): Foto => ({ leu: nome.toLowerCase(), candidatos: [nome], vezes, marcados: [nome] });
const xBurgerPorFoto = (queijo = 2) => [marcada('Pão brioche'), marcada('Blend da casa'), marcada('Queijo prato', queijo), marcada('Cebola roxa')];

describe('as sugestões para as fichas (sem banco)', () => {
  it('sem fichas, nenhuma; o lanche montado pela ficha não sugere nada', () => {
    assert.deepEqual(sugestoesDoTreino([conferido('X-Burger', [outro('Picles')])], null), []);
    assert.deepEqual(sugestoesDoTreino([1, 2, 3, 4].map(() => conferido('X-Burger', xBurger())), BASE), []);
  });

  it('nome fora das fichas: o que alguém escreveu e não está em ficha nenhuma (uma vez por lanche)', () => {
    const s = sugestoesDoTreino(
      [
        conferido('X-Burger', [...xBurger(), outro('Picles'), outro('picles ')]),
        conferido(null, [outro('Picles')]),
        conferido('X-Burger', [...xBurger(), outro('Bacon fatiado')]),
      ],
      BASE,
    );
    assert.equal(s.length, 1, JSON.stringify(s.map((x) => x.titulo)));
    assert.equal(s[0]!.tipo, 'nome-fora');
    assert.equal(s[0]!.ingrediente, 'Picles');
    assert.match(s[0]!.viu, /^Em 2 lanches conferidos \(X-Burger\), quem conferiu chamou um ingrediente de “Picles”/);
    assert.equal(s[0]!.chave, chaveDaSugestao('nome-fora', null, 'picles'));
    assert.deepEqual([s[0]!.sim, s[0]!.nao], ['Vou cadastrar', 'Foi engano']);
  });

  it('o mesmo ingrediente escrito de outro jeito NÃO é "nome fora das fichas" (o dono, 19/10/2026)', () => {
    // a ficha do X-Burger tem "Pão brioche": "Pão de Brioche", "PAO BRIOCHE" e "pães brioche" são ele
    const s = sugestoesDoTreino(
      [
        conferido('X-Burger', [outro('Pão de Brioche'), outro('PAO BRIOCHE'), outro('pães brioche'), certo('Blend da casa')]),
        porFoto('X-Burger', [{ leu: null, marcados: ['Pão de Brioche'] }]),
      ],
      BASE,
    );
    assert.deepEqual(s.map((x) => x.titulo), []);
  });

  it('a resposta guardada antes da regra do nome parecido continua presa à sua sugestão', () => {
    // a chave guardada em 19/10 de manhã: as partes só sem maiúscula
    assert.equal(chaveDeHoje('nome-fora||pão de brioche'), chaveDaSugestao('nome-fora', null, 'Pão Brioche'));
    const hoje = chaveDaSugestao('falta-na-ficha', 'X-Burger', 'Alface');
    assert.equal(chaveDeHoje(hoje), hoje, 'a de hoje relida não muda');
    assert.equal(chaveDeHoje('ficha-diferente|número 11|carne 56gr'), chaveDaSugestao('ficha-diferente', 'Numero 11', 'Carne 56 g'));
  });

  it('falta na ficha: a mais sem pedido em pelo menos 3 lanches e na metade dos conferidos do produto', () => {
    const com = (n: number, de: number, como: 'amais' | 'adicional' = 'amais') =>
      Array.from({ length: de }, (_, i) => conferido('X-Burger', xBurger(), {}, i < n ? { Alface: como } : {}));
    assert.equal(sugestoesDoTreino(com(2, 2), BASE).length, 0, 'dois lanches são pouco');
    assert.equal(sugestoesDoTreino(com(3, 7), BASE).length, 0, '3 de 7 não é a metade');
    assert.equal(sugestoesDoTreino(com(3, 4, 'adicional'), BASE).length, 0, 'pedido do cliente não é falta na ficha');
    const s = sugestoesDoTreino(com(3, 6), BASE);
    assert.equal(s.length, 1);
    assert.deepEqual([s[0]!.tipo, s[0]!.produto, s[0]!.ingrediente], ['falta-na-ficha', 'X-Burger', 'Alface']);
    assert.equal(s[0]!.titulo, 'X-Burger: entra Alface, que não está na ficha');
    assert.equal(s[0]!.viu, 'Em 3 dos 6 X-Burger conferidos, a bancada pôs Alface sem pedido do cliente.');
    assert.equal(s[0]!.onde, 'na ficha do X-Burger');
  });

  it('ficha diferente da bancada: faltou de novo e de novo — quanto entrou, e quando não entrou', () => {
    const uma = (falta: 'faltou' | 'cliente' | 'naoviu') => conferido('X-Burger', xBurger(1), { 'Queijo prato': falta });
    assert.equal(sugestoesDoTreino([uma('cliente'), uma('cliente'), uma('cliente')], BASE).length, 0, 'o cliente pediu assim');
    assert.equal(sugestoesDoTreino([uma('naoviu'), uma('naoviu'), uma('naoviu')], BASE).length, 0, 'a leitura não viu');
    const s = sugestoesDoTreino([uma('faltou'), uma('faltou'), uma('faltou'), conferido('X-Burger', xBurger())], BASE);
    assert.equal(s.length, 1);
    assert.equal(s[0]!.tipo, 'ficha-diferente');
    assert.equal(s[0]!.titulo, 'X-Burger: a ficha diz 2 fatias de Queijo prato; a bancada pôs 1');
    assert.equal(s[0]!.viu, 'Em 3 dos 4 X-Burger conferidos, entrou 1 fatia de Queijo prato, e quem conferiu disse que faltou.');
    assert.match(s[0]!.propoe, /Se o certo é 1 fatia, corrija a quantidade na ficha\. Se são 2 fatias, a ficha está certa/);

    // a cebola não entrou em nenhum: "a bancada não pôs"
    const semCebola = () => conferido('X-Burger', xBurger().slice(0, 3), { 'Cebola roxa': 'faltou' });
    const c = sugestoesDoTreino([semCebola(), semCebola(), semCebola()], BASE);
    assert.equal(c.length, 1);
    assert.equal(c[0]!.titulo, 'X-Burger: a ficha tem Cebola roxa; a bancada não pôs');
    // marcou "faltou" mas a etapa mostra o que a ficha pede: não conta
    const contraditorio = () => conferido('X-Burger', xBurger(), { 'Queijo prato': 'faltou' });
    assert.equal(sugestoesDoTreino([contraditorio(), contraditorio(), contraditorio()], BASE).length, 0);
    // o que mais aparece: 1 fatia em dois, nenhuma em um → "pôs 1"
    const semQueijo = conferido('X-Burger', [certo('Pão brioche'), certo('Blend da casa'), certo('Cebola roxa')], { 'Queijo prato': 'faltou' });
    const m = sugestoesDoTreino([uma('faltou'), semQueijo, uma('faltou')], BASE);
    assert.equal(m[0]!.titulo, 'X-Burger: a ficha diz 2 fatias de Queijo prato; a bancada pôs 1');
  });

  it('um nome para duas coisas: o mesmo nome em molhos de cores diferentes, cada cor em pelo menos 2 etapas', () => {
    const laranja = () => conferido('X-Burger', [...xBurger(), outro('Molho da casa', 'molho laranja')]);
    const branco = () => conferido('X-Salada', [outro('Molho da casa', 'molho branco')]);
    assert.equal(sugestoesDoTreino([laranja(), laranja(), branco()], BASE).filter((x) => x.tipo === 'duas-coisas').length, 0, 'uma etapa branca só');
    const s = sugestoesDoTreino([laranja(), laranja(), branco(), branco()], BASE).filter((x) => x.tipo === 'duas-coisas');
    assert.equal(s.length, 1);
    assert.equal(s[0]!.titulo, '“Molho da casa” parece ser mais de um ingrediente');
    assert.equal(s[0]!.viu, 'Nos lanches conferidos, Molho da casa apareceu de 2 jeitos: “molho branco” em 2 etapas (X-Salada) e “molho laranja” em 2 etapas (X-Burger).');
    assert.equal(s[0]!.onde, 'nas fichas de X-Salada e X-Burger');
    // o que não é molho (cor de cebola, de carne) não entra nesta conta
    const cebola = (leu: string) => conferido('X-Burger', [outro('Cebola roxa', leu)]);
    assert.equal(sugestoesDoTreino([cebola('cebola escura'), cebola('cebola escura'), cebola('roxa'), cebola('roxa')], BASE).filter((x) => x.tipo === 'duas-coisas').length, 0);
  });

  it('a conferência por foto também sugere: o nome marcado fora das fichas, o que faltou, o molho de duas cores', () => {
    // o nome escrito à mão e marcado, em dois lanches (o mesmo nome duas vezes no lanche conta uma); na foto ruim, não
    const fora = sugestoesDoTreino(
      [
        porFoto('X-Burger', [...xBurgerPorFoto(), { leu: null, marcados: ['Picles'] }]),
        porFoto('X-Burger', [...xBurgerPorFoto(), { leu: 'verde', marcados: ['picles', 'Picles'] }]),
        porFoto('X-Burger', [...xBurgerPorFoto(), { leu: 'verde', marcados: ['Jalapeño'], ruim: true }]),
      ],
      BASE,
    );
    assert.deepEqual(fora.map((x) => [x.tipo, x.ingrediente]), [['nome-fora', 'Picles']]);
    assert.match(fora[0]!.viu, /^Em 2 lanches conferidos \(X-Burger\)/);
    // o que faltou: o queijo marcado, com 1 fatia na leitura, e "faltou" em 3 de 4
    const umaFatia = () => porFoto('X-Burger', xBurgerPorFoto(1), { 'Queijo prato': 'faltou' });
    const f = sugestoesDoTreino([umaFatia(), umaFatia(), umaFatia(), porFoto('X-Burger', xBurgerPorFoto())], BASE);
    assert.deepEqual(f.map((x) => x.titulo), ['X-Burger: a ficha diz 2 fatias de Queijo prato; a bancada pôs 1']);
    // o molho de duas cores: a leitura ficou entre dois nomes, e a marca da foto que está entre eles diz qual era
    // (o pão marcado ANTES: a leitura da etapa é a marca que está entre os candidatos dela, não a primeira da foto)
    const molho = (leu: string) => porFoto('X-Burger', [{ leu, candidatos: ['Molho da casa', 'Cebola roxa'], marcados: ['Pão brioche', 'Molho da casa'] }]);
    const d = sugestoesDoTreino([molho('molho laranja'), molho('molho laranja'), molho('molho branco'), molho('molho branco')], BASE).filter((x) => x.tipo === 'duas-coisas');
    assert.deepEqual(d.map((x) => x.ingrediente), ['Molho da casa']);
  });

  it('a ordem: os tipos na ordem do protótipo; os limites são os escritos', () => {
    assert.deepEqual({ ...LIMITES }, { minimo: 3, parte: 0.5, jeitos: 2 });
    // o tipo manda na ordem, e não o nome: "Queijo prato" (ficha diferente) viria antes de "Tomate" (falta na ficha)
    const s = sugestoesDoTreino(
      [
        ...[1, 2, 3].map(() => conferido('X-Burger', [...xBurger(1), outro('Picles')], { 'Queijo prato': 'faltou' }, { Tomate: 'amais' })),
      ],
      BASE,
    );
    assert.deepEqual(s.map((x) => x.tipo), ['nome-fora', 'falta-na-ficha', 'ficha-diferente']);
  });
});

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-sugestoes-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-sugestoes';
const SENHA = 'uma senha longa o bastante';

describe('as sugestões para as fichas (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  let lojaId = '';
  let token = '';
  let cookie = '';
  let cookieSupervisao = '';
  let cookieVizinho = '';
  let lanches = 0;

  async function entrar(tenant: string, email: string, nivel: string, nome = `Pessoa ${nivel}`) {
    await app.inject({ method: 'POST', url: '/v1/distribuicao/usuarios', headers: { 'x-farol-admin': ADMIN }, payload: { tenantId: tenant, nome, email, senha: SENHA, nivel } });
    const r = await app.inject({ method: 'POST', url: '/v1/sessao', payload: { email, senha: SENHA } });
    const b = r.headers['set-cookie'];
    return (Array.isArray(b) ? b[0]! : String(b)).split(';')[0]!;
  }
  /** Um lanche lido (o do contrato) conferido como X-Burger, com o que veio a mais. */
  async function conferidoComAMais(aMais: Record<string, string>) {
    lanches += 1;
    const corpo = JSON.parse(JSON.stringify(LANCHE.corpo));
    corpo.lanche.chave = `lanche-${lanches}`;
    const r = await app.inject({ method: 'POST', url: '/v1/agentes/treino/lanches', headers: { authorization: `Bearer ${token}` }, payload: corpo });
    assert.equal(r.statusCode < 300, true, r.body);
    const c = await app.inject({
      method: 'POST',
      url: `/v1/treino/lanches/${r.json().lancheId}/conferencia`,
      headers: { cookie },
      payload: { produto: 'X-Burger', etapas: corpo.lanche.etapas.map(() => null), faltas: {}, aMais },
    });
    assert.equal(c.statusCode, 200, c.body);
  }
  const lista = async (comCookie = cookie) => (await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}/treino`, headers: { cookie: comCookie } })).json();
  const responder = (corpo: unknown, comCookie = cookie, loja = lojaId) =>
    app.inject({ method: 'POST', url: `/v1/lojas/${loja}/treino/sugestoes`, headers: { cookie: comCookie }, payload: corpo as object });

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    app = criarApp(pool, { logger: false });
    await app.ready();
    const conta = (await app.inject({ method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN }, payload: { tenant: { nome: marca }, loja: { nome: 'Matriz' }, setores: [{ nome: 'Cozinha' }] } })).json();
    lojaId = conta.loja.id;
    cookie = await entrar(conta.tenantId, `ger-${marca}@e.com`, 'gerente', 'Gil Prado');
    cookieSupervisao = await entrar(conta.tenantId, `sup-${marca}@e.com`, 'supervisao');
    const a = (await app.inject({ method: 'POST', url: '/v1/distribuicao/agentes', headers: { 'x-farol-admin': ADMIN }, payload: { lojaId, nome: 'PC' } })).json();
    await app.inject({ method: 'POST', url: '/v1/agentes/ativar', headers: { authorization: `Bearer ${a.token}` }, payload: { fingerprint: `fp-${marca}` } });
    token = a.token;
    const { produtos, comFicha } = contarBase(BASE);
    await pool.query(
      `insert into fichas_da_loja (loja_id, tenant_id, fonte, conteudo, impressao, produtos, com_ficha) values ($1, $2, 'planilha', $3, $4, $5, $6)`,
      [lojaId, conta.tenantId, JSON.stringify(BASE), impressaoDaBase(BASE), produtos, comFicha],
    );
    const vizinha = (await app.inject({ method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN }, payload: { tenant: { nome: `${marca}-viz` }, loja: { nome: 'Vizinha' }, setores: [{ nome: 'Cozinha' }] } })).json();
    cookieVizinho = await entrar(vizinha.tenantId, `ger-${marca}-viz@e.com`, 'gerente');
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  it('a lista traz a sugestão das conferências, e de onde as fichas vêm', async () => {
    for (let i = 0; i < 3; i += 1) await conferidoComAMais({ Alface: 'amais' });
    const l = await lista();
    assert.equal(l.fichasDe, 'planilha');
    assert.equal(l.sugestoes.length, 1, JSON.stringify(l.sugestoes));
    const s = l.sugestoes[0];
    assert.deepEqual([s.tipo, s.produto, s.ingrediente, s.decisao, s.decididoPor], ['falta-na-ficha', 'X-Burger', 'Alface', null, null]);
    assert.equal(s.viu, 'Em 3 dos 3 X-Burger conferidos, a bancada pôs Alface sem pedido do cliente.');
  });

  it('responder: quem configura; a supervisão não; só o que o Farol sugere agora; mudar a resposta', async () => {
    const chave = chaveDaSugestao('falta-na-ficha', 'X-Burger', 'Alface');
    assert.equal((await responder({ chave, decisao: 'sim' }, cookieSupervisao)).statusCode, 403);
    assert.equal((await responder({ chave, decisao: 'talvez' })).statusCode, 422);
    assert.equal((await responder({ decisao: 'sim' })).statusCode, 422);
    assert.equal((await responder({ chave: 'falta-na-ficha|x-burger|picles', decisao: 'sim' })).statusCode, 404, 'o Farol não sugeriu isso');
    assert.equal((await responder({ chave, decisao: 'sim' }, cookieVizinho)).statusCode, 404, 'outra conta');

    const r = await responder({ chave, decisao: 'sim' });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json(), { chave, decisao: 'sim' });
    let s = (await lista()).sugestoes[0];
    assert.deepEqual([s.decisao, s.decididoPor], ['sim', 'Gil Prado']);
    assert.ok(s.decididoEm);

    // mais um conferido com a alface: a resposta nova guarda o retrato de agora (4 de 4)
    await conferidoComAMais({ Alface: 'amais' });
    assert.equal((await responder({ chave, decisao: 'nao' })).statusCode, 200);
    s = (await lista()).sugestoes[0];
    assert.equal(s.decisao, 'nao');
    assert.equal((await pool.query('select count(*)::int as n from treino_sugestao where loja_id = $1', [lojaId])).rows[0].n, 1, 'uma resposta por sugestão');
  });

  it('a respondida que as conferências deixaram de mostrar continua na tela, como foi respondida', async () => {
    // mais 5 conferidos sem a alface: 4 de 9 não é mais a metade
    for (let i = 0; i < 5; i += 1) await conferidoComAMais({});
    const l = await lista();
    assert.equal(l.sugestoes.length, 1);
    assert.deepEqual([l.sugestoes[0].ingrediente, l.sugestoes[0].decisao], ['Alface', 'nao']);
    assert.equal(l.sugestoes[0].viu, 'Em 4 dos 4 X-Burger conferidos, a bancada pôs Alface sem pedido do cliente.', 'o retrato de quando foi respondida');
    const de = await responder({ chave: l.sugestoes[0].chave, decisao: 'sim' });
    assert.equal(de.statusCode, 404, 'a que não está mais nas conferências não se responde de novo');
  });
});
