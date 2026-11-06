// A fila "para rever" (o protótipo aprovado pelo dono em 06/11/2026; `api/src/para-rever.ts`):
//
//   - entra o conferido "Não era um lanche" em que um ingrediente que quem conferiu CONFIRMOU só vai num lanche (a regra
//     da sugestão pelo ingrediente, a mesma do console) — e que não tem a marca `sugestaoVista`;
//   - "Não era um lanche" salvo com a sugestão de um lanche na tela guarda a marca: já decidiu, não entra nem volta;
//   - com o lanche escolhido, sai da fila e conta entre os que eram lanche;
//   - a fila é procurada entre TODOS os conferidos, não só os mais novos que a lista traz;
//   - as frases da tela depois de salvar (`web/componentes/treino/para-rever.ts`) dizem o que a API fez.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { estudarFichas } from '../src/estudo-das-fichas.js';
import { contarBase, FORMATO_DA_BASE, impressaoDaBase, type Base, type Efeito, type Produto } from '../src/fichas.js';
import { confirmadosDaResposta, familiasDoEstudo, marcaDaSugestao, motivoParaRever, ondeCadaIngredienteEntra, temAMarca } from '../src/para-rever.js';
import * as daApi from '../src/sugestao-pelo-ingrediente.js';
import type { Conferencia, EtapaLida } from '../src/treino.js';
import { mensagemDaRevisao, seloDoAdicional } from '../../web/componentes/treino/para-rever.ts';

const ing = (nome: string) => ({ nome, quantidade: 1, unidade: 'un', preparo: false, insumoId: null, fichaId: null });
function produto(id: string, nome: string, ingredientes: string[], adicionais: Array<[string, Efeito]> = [], cozinha = true): Produto {
  return {
    id, nome, codigo: null, categoria: null, tipo: 'simples', cozinha, setor: null, preparoMin: null,
    ficha: { id: `f-${id}`, nome, ingredientes: ingredientes.map(ing) }, variacoes: [], combo: [],
    adicionais: adicionais.length ? [{ nome: 'Adicionais', tipo: 'adicionar', opcoes: adicionais.map(([n, efeito]) => ({ id: null, nome: n, codigo: null, efeito })) }] : [],
  };
}
const NADA: Efeito = { tipo: 'nada' };
/** O cardápio da sugestão (o de `sugestao-pelo-ingrediente.test.ts`, na forma das fichas reais — ERR-166: o Trio ANTES do
 * Número na base, com a ficha "Numero 08"): o Nº 08 e o Trio 08 com o anel de cebola (que também é adicional do X-Bacon),
 * o Nº 16 com o cheddar cremoso (só dele), o X-Bacon com o bacon, e a porção sem cozinha. */
const BASE: Base = {
  formato: FORMATO_DA_BASE,
  produtos: [
    { ...produto('t08', 'TRIO 08', ['Pão brioche', 'Carne 120gr', 'Anel de cebola', 'Ovo']), ficha: { id: 'f-n08', nome: 'Numero 08', ingredientes: ['Pão brioche', 'Carne 120gr', 'Anel de cebola', 'Ovo'].map(ing) } },
    produto('n08', 'Numero 08', ['Pão brioche', 'Carne 120gr', 'Anel de cebola', 'Ovo']),
    produto('n16', 'Numero 16', ['Pão brioche', 'Carne 120gr', 'Cheddar cremoso', 'Cebola crispy']),
    produto('xb', 'X-Bacon', ['Pão brioche', 'Carne 120gr', 'Bacon'], [
      ['Ovo', NADA],
      ['Cebola crispy', NADA],
      ['Anel extra', { tipo: 'insumo', nome: 'Anel de cebola', quantidade: 1, unidade: 'un', insumoId: null }],
    ]),
    produto('px', 'Porção de bacon', ['Bacon'], [], false),
  ],
};
const ONDE = ondeCadaIngredienteEntra(BASE);
const FAMILIAS = familiasDoEstudo(estudarFichas(BASE), BASE);
const N08 = ['Numero 08', 'TRIO 08'];

/** Uma etapa da leitura de sempre (sem passo): o nome que a leitura disse é o candidato. */
const etapa = (nome: string | null, quadro: number | null = 0): EtapaLida => ({
  hora: '2026-11-04T21:10:00-03:00', lado: 'base', inicio: false, leu: nome, candidatos: nome ? [nome] : [], vezes: 1, quadro,
});
/** Uma etapa do lanche lido por passos: o começo da peça (o pão) ou um passo. */
const passo = (tipo: 'comeco' | 'passo' | 'vazio', nome: string | null, metade = 1): EtapaLida => ({ ...etapa(nome), tipo, metade });
const porEtapa = (produto: string | null, etapas: Array<{ v: 'certo' | 'outro' | 'nada'; nome: string | null } | null>): Conferencia => ({ produto, etapas, faltas: {}, aMais: {} });

describe('a fila para rever (sem banco)', () => {
  it('as famílias como a tela as diz: sem nome repetido, e o produto com o nome da ficha na frente (as fichas reais)', () => {
    // como nas fichas da loja-piloto: o Trio antes na base, dois "TRIO 08" com a ficha "Numero 08", e o "NUmero 08"
    const daFicha = (p: Produto, nome: string): Produto => ({ ...p, ficha: { ...p.ficha!, nome } });
    const real: Base = {
      formato: FORMATO_DA_BASE,
      produtos: [
        daFicha(produto('t08', 'TRIO 08', ['Pão brioche', 'Anel de cebola']), 'Numero 08'),
        daFicha(produto('t08b', 'TRIO 08', ['Pão brioche', 'Anel de cebola']), 'Numero 08'),
        daFicha(produto('n08', 'NUmero 08', ['Pão brioche', 'Anel de cebola']), 'Numero 08'),
        daFicha(produto('bg', 'Batata Frita - Grande', ['Batata']), 'Batata Frita Grande'),
        daFicha(produto('bm', 'Batata Frita - Média', ['Batata']), 'Batata Frita Media'),
        daFicha(produto('xb', 'X bacon', ['Pão brioche', 'Bacon']), 'X Bacon'),
      ],
    };
    const estudo = estudarFichas(real);
    assert.deepEqual(estudo.familias.map((f) => f.produtos.map((x) => x.nome)), [['TRIO 08', 'TRIO 08', 'NUmero 08'], ['Batata Frita - Grande', 'Batata Frita - Média'], ['X bacon']], 'o estudo, na ordem da base');
    assert.deepEqual(familiasDoEstudo(estudo, real), [['NUmero 08', 'TRIO 08'], ['Batata Frita - Grande', 'Batata Frita - Média'], ['X bacon']], 'sem a ficha com o nome de um produto, a ordem da base');
    assert.deepEqual(familiasDoEstudo(estudo, null), [['TRIO 08', 'NUmero 08'], ['Batata Frita - Grande', 'Batata Frita - Média'], ['X bacon']], 'sem as fichas, só sem repetir');
    // a sugestão diz o primeiro: "só vai no NUmero 08"
    const s = daApi.sugestaoPeloIngrediente(['Anel de cebola'], ondeCadaIngredienteEntra(real), familiasDoEstudo(estudo, real));
    assert.ok(s.tipo === 'lanche' && s.familia[0] === 'NUmero 08' && s.familia.length === 2);
  });

  it('o que quem conferiu confirmou: as marcas das fotos que davam para analisar; na conferência por etapa, o nome de cada uma', () => {
    const fotos: Conferencia = {
      versao: 2, produto: null, perguntas: {}, obs: null, faltas: {}, aMais: {},
      fotos: [
        { etapas: [0], marcados: ['Pão brioche'], ruim: false, obs: null },
        { etapas: [1], marcados: ['Anel de cebola'], ruim: true, obs: 'borrada' },
        { etapas: [2], marcados: ['Carne 120gr', 'Cheddar cremoso'], ruim: false, obs: null },
      ],
    };
    assert.deepEqual(confirmadosDaResposta([etapa('Pão brioche'), etapa('Anel de cebola', 1), etapa('Carne 120gr', 2)], fotos), ['Pão brioche', 'Carne 120gr', 'Cheddar cremoso'], 'a foto ruim fica de fora');
    const etapas = [etapa('Pão brioche'), etapa('Cebola crispy', 1), etapa('Carne 120gr', 2), etapa(null, 3)];
    assert.deepEqual(
      confirmadosDaResposta(etapas, porEtapa(null, [{ v: 'certo', nome: null }, { v: 'outro', nome: 'Anel de cebola' }, { v: 'nada', nome: null }, null])),
      ['Pão brioche', 'Anel de cebola'],
      'o "certo" é o nome lido; o "era outro", o que a pessoa disse; o "nada" e o sem resposta não confirmam',
    );
  });

  it('no lanche por passos: o pão do começo primeiro, e o passo que é a tampa chegando não soma outro pão (como a gaveta)', () => {
    const etapas = [passo('comeco', 'Pão brioche'), passo('passo', 'Pão de dois cortes', 2), passo('passo', 'Anel de cebola'), passo('vazio', null)];
    const r = porEtapa(null, [{ v: 'certo', nome: null }, { v: 'certo', nome: null }, { v: 'outro', nome: ' Anel de cebola ' }, { v: 'nada', nome: null }]);
    assert.deepEqual(confirmadosDaResposta(etapas, r), ['Pão brioche', 'Anel de cebola']);
    // sem o pão do começo respondido, o passo que é pão conta (uma vez)
    const semComeco = porEtapa(null, [null, { v: 'certo', nome: null }, { v: 'certo', nome: null }, null]);
    assert.deepEqual(confirmadosDaResposta(etapas, semComeco), ['Pão de dois cortes', 'Anel de cebola']);
    // o "era outro" vazio não confirma nada
    assert.deepEqual(confirmadosDaResposta(etapas, porEtapa(null, [null, null, { v: 'outro', nome: '  ' }, null])), []);
  });

  it('quem entra: "não era um lanche", sem a marca, com um ingrediente confirmado de um lanche só', () => {
    const etapas = [etapa('Pão brioche'), etapa('Anel de cebola', 1), etapa('Carne 120gr', 2)];
    const certo3 = [{ v: 'certo' as const, nome: null }, { v: 'certo' as const, nome: null }, { v: 'certo' as const, nome: null }];
    const naoEra = { situacao: 'conferido', produto: null, leitura: { etapas }, resposta: porEtapa(null, certo3) };
    assert.deepEqual(motivoParaRever(naoEra, ONDE, FAMILIAS), { ingrediente: 'Anel de cebola', familia: N08, adicionalEm: ['X-Bacon'] }, 'o anel também é adicional do X-Bacon: a linha diz');
    assert.equal(motivoParaRever({ ...naoEra, produto: 'Numero 08', resposta: porEtapa('Numero 08', certo3) }, ONDE, FAMILIAS), null, 'com o lanche, não');
    assert.equal(motivoParaRever({ ...naoEra, situacao: 'conferir' }, ONDE, FAMILIAS), null, 'o que espera conferência, não');
    assert.equal(motivoParaRever({ ...naoEra, resposta: null }, ONDE, FAMILIAS), null);
    assert.equal(motivoParaRever({ ...naoEra, leitura: null }, ONDE, FAMILIAS), null, 'sem leitura, nada confirmado');
    const marcado = { ...naoEra, resposta: { ...porEtapa(null, certo3), sugestaoVista: { lanche: 'Numero 08', pelos: ['Anel de cebola'] } } as Conferencia };
    assert.equal(motivoParaRever(marcado, ONDE, FAMILIAS), null, 'quem decidiu vendo a sugestão não entra');
    // só o que três lanches têm: nada a sugerir
    assert.equal(motivoParaRever({ ...naoEra, resposta: porEtapa(null, [{ v: 'certo', nome: null }, null, { v: 'certo', nome: null }]) }, ONDE, FAMILIAS), null);
    // o cheddar cremoso, só do Nº 16 e adicional de ninguém: sem o selo do adicional
    const cheddar = { ...naoEra, leitura: { etapas: [etapa('Cheddar cremoso')] }, resposta: porEtapa(null, [{ v: 'certo', nome: null }]) };
    assert.deepEqual(motivoParaRever(cheddar, ONDE, FAMILIAS), { ingrediente: 'Cheddar cremoso', familia: ['Numero 16'], adicionalEm: [] });
    // dois únicos do mesmo lanche, um deles exclusivo (o cheddar): o aviso do adicional sai — o selo também
    const doisDoMesmo = { ...naoEra, leitura: { etapas: [etapa('Cebola crispy'), etapa('Cheddar cremoso', 1)] }, resposta: porEtapa(null, [{ v: 'certo', nome: null }, { v: 'certo', nome: null }]) };
    assert.deepEqual(motivoParaRever(doisDoMesmo, ONDE, FAMILIAS)?.adicionalEm, []);
    // dois lanches diferentes, os dois exclusivos (o cheddar e o bacon): a sugestão não escolhe, e não entra
    const varios = { ...naoEra, leitura: { etapas: [etapa('Cheddar cremoso'), etapa('Bacon', 1)] }, resposta: porEtapa(null, [{ v: 'certo', nome: null }, { v: 'certo', nome: null }]) };
    assert.equal(motivoParaRever(varios, ONDE, FAMILIAS), null);
  });

  it('a marca: só com "Não era um lanche" e a sugestão de um lanche; e quem a reconhece', () => {
    const etapas = [etapa('Anel de cebola'), etapa('Carne 120gr', 1)];
    const certo2 = [{ v: 'certo' as const, nome: null }, { v: 'certo' as const, nome: null }];
    assert.deepEqual(marcaDaSugestao(etapas, porEtapa(null, certo2), ONDE, FAMILIAS), { lanche: 'Numero 08', pelos: ['Anel de cebola'] });
    assert.equal(marcaDaSugestao(etapas, porEtapa('Numero 08', certo2), ONDE, FAMILIAS), null, 'com o lanche escolhido, não há o que marcar');
    assert.equal(marcaDaSugestao(etapas, porEtapa(null, [null, { v: 'certo', nome: null }]), ONDE, FAMILIAS), null, 'sem ingrediente de um lanche só');
    const varios = [etapa('Cheddar cremoso'), etapa('Bacon', 1)];
    assert.equal(marcaDaSugestao(varios, porEtapa(null, certo2), ONDE, FAMILIAS), null, 'a de dois lanches diferentes não escolhe');
    assert.equal(temAMarca({ sugestaoVista: { lanche: 'Numero 08', pelos: [] } }), true);
    for (const sem of [{ sugestaoVista: null }, { sugestaoVista: 'Numero 08' }, {}, null, 'texto']) assert.equal(temAMarca(sem), false, JSON.stringify(sem));
  });

  it('as frases da tela depois de salvar: pelo que a API fez e pela lista recarregada', () => {
    const fila = [{ id: 'b' }, { id: 'c' }];
    assert.equal(mensagemDaRevisao({ produto: 'Numero 08', sugestaoVista: null }, 'a', fila), 'Revisto: Numero 08. Saiu da fila e conta no placar entre os que eram lanche. Faltam 2 para rever.');
    assert.equal(mensagemDaRevisao({ produto: null, sugestaoVista: 'Numero 08' }, 'a', fila), 'Fica como “não era um lanche”. Saiu da fila e não volta. Faltam 2 para rever.');
    assert.equal(mensagemDaRevisao({ produto: null, sugestaoVista: null }, 'a', [{ id: 'b' }]), 'Fica como “não era um lanche”. Saiu da fila: a resposta já não tem um ingrediente de um lanche só. Faltam 1 para rever.');
    assert.equal(mensagemDaRevisao({ produto: 'TRIO 08', sugestaoVista: null }, 'a', []), 'Revisto: TRIO 08. Saiu da fila e conta no placar entre os que eram lanche. Não há mais lanche para rever.');
    // a lista recarregada ainda tem o lanche: a frase não diz que saiu
    assert.equal(mensagemDaRevisao({ produto: null, sugestaoVista: 'Numero 08' }, 'b', fila), 'Guardado, mas o lanche continua para rever. Faltam 2 para rever.');
    assert.equal(mensagemDaRevisao({ produto: 'Numero 08', sugestaoVista: null }, 'a', Array.from({ length: 1234 }, (_, i) => ({ id: `x${i}` }))).endsWith('Faltam 1.234 para rever.'), true);
    assert.equal(seloDoAdicional([]), null);
    assert.equal(seloDoAdicional(['X-Bacon']), 'também é adicional em 1 lanche');
    assert.equal(seloDoAdicional(Array.from({ length: 9 }, (_, i) => `P${i}`)), 'também é adicional em 9 lanches');
  });
});

// ───────────────────────── de ponta a ponta, com o Postgres ─────────────────────────

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-rever-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-rever';
const SENHA = 'uma senha longa o bastante';
const CONTRATO = JSON.parse(readFileSync(new URL('../../contratos/lanche-de-treino.json', import.meta.url), 'utf8')) as {
  corpo: { gravacao: Record<string, unknown>; lanche: { chave: string; abertoEm: string | null; fechouEm: string | null; etapas: EtapaLida[] } & Record<string, unknown>; quadros: unknown[] };
};
/** Os conferidos mais novos que a lista traz (`CONFERIDOS_NA_LISTA` em `rotas/treino.ts`). */
const NA_LISTA = 200;

describe('a fila para rever (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  let lojaId = '';
  let tenantId = '';
  let token = '';
  let cookie = '';
  let cookieVizinho = '';
  const ids: Record<string, string> = {};

  async function entrar(tenant: string, email: string, nivel: string) {
    await app.inject({ method: 'POST', url: '/v1/distribuicao/usuarios', headers: { 'x-farol-admin': ADMIN }, payload: { tenantId: tenant, nome: `Pessoa ${nivel}`, email, senha: SENHA, nivel } });
    const r = await app.inject({ method: 'POST', url: '/v1/sessao', payload: { email, senha: SENHA } });
    const b = r.headers['set-cookie'];
    return (Array.isArray(b) ? b[0]! : String(b)).split(';')[0]!;
  }
  /** O lanche da carga do contrato, com uma etapa por ingrediente desta loja (a 6ª, sem quadro, fica sem leitura). */
  async function mandar(chave: string, abertoEm: string) {
    const c = JSON.parse(JSON.stringify(CONTRATO.corpo)) as typeof CONTRATO.corpo;
    c.lanche.chave = chave;
    c.lanche.abertoEm = abertoEm;
    c.lanche.fechouEm = abertoEm;
    const nomes = ['Pão brioche', 'Anel de cebola', 'Carne 120gr', 'Cheddar cremoso', 'Bacon', null];
    c.lanche.etapas.forEach((e, i) => {
      e.leu = nomes[i] ?? null;
      e.candidatos = nomes[i] ? [nomes[i]!] : [];
    });
    const r = await app.inject({ method: 'POST', url: '/v1/agentes/treino/lanches', headers: { authorization: `Bearer ${token}` }, payload: c });
    assert.equal(r.statusCode, 201, r.body);
    return r.json().lancheId as string;
  }
  const C = { v: 'certo' as const };
  /** A conferência por etapa: as etapas confirmadas (0 pão, 1 anel, 2 carne, 3 cheddar, 4 bacon). */
  const respostaCom = (produto: string | null, confirmadas: number[]) => ({ produto, etapas: [0, 1, 2, 3, 4, 5].map((i) => (confirmadas.includes(i) ? C : null)), faltas: {}, aMais: {} });
  const conferir = (id: string, corpo: unknown, comCookie = cookie) =>
    app.inject({ method: 'POST', url: `/v1/treino/lanches/${id}/conferencia`, headers: { cookie: comCookie }, payload: corpo as object });
  const lista = async (comCookie = cookie) => {
    const r = await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}/treino`, headers: { cookie: comCookie } });
    assert.equal(r.statusCode, 200, r.body);
    return r.json() as { rever: Array<{ id: string; rever: unknown; produto: string | null }>; lanches: Array<{ id: string }>; contas: { conferidos: number; eramLanche: number } };
  };
  const resposta = async (id: string) => (await pool.query('select resposta from treino_lanche where id = $1', [id])).rows[0].resposta as Record<string, unknown>;
  /** A conferência de antes da fila (sem a marca): o único caminho que a cria hoje é tirar a marca no banco. */
  const comoAntes = (id: string) => pool.query(`update treino_lanche set resposta = resposta - 'sugestaoVista' where id = $1`, [id]);

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    app = criarApp(pool, { logger: false });
    await app.ready();
    const conta = (await app.inject({ method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN }, payload: { tenant: { nome: marca }, loja: { nome: 'Matriz' }, setores: [{ nome: 'Cozinha' }] } })).json();
    lojaId = conta.loja.id;
    tenantId = conta.tenantId;
    cookie = await entrar(tenantId, `ger-${marca}@e.com`, 'gerente');
    const a = (await app.inject({ method: 'POST', url: '/v1/distribuicao/agentes', headers: { 'x-farol-admin': ADMIN }, payload: { lojaId, nome: `PC ${marca}` } })).json();
    const ativar = await app.inject({ method: 'POST', url: '/v1/agentes/ativar', headers: { authorization: `Bearer ${a.token}` }, payload: { fingerprint: `fp-${marca}` } });
    assert.equal(ativar.statusCode, 200, ativar.body);
    token = a.token as string;
    const { produtos, comFicha } = contarBase(BASE);
    await pool.query(
      `insert into fichas_da_loja (loja_id, tenant_id, fonte, conteudo, impressao, produtos, com_ficha) values ($1, $2, 'planilha', $3, $4, $5, $6)`,
      [lojaId, tenantId, JSON.stringify(BASE), impressaoDaBase(BASE), produtos, comFicha],
    );
    const vizinha = (await app.inject({ method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN }, payload: { tenant: { nome: `${marca}-vizinha` }, loja: { nome: 'Vizinha' }, setores: [{ nome: 'Cozinha' }] } })).json();
    cookieVizinho = await entrar(vizinha.tenantId, `ger-${marca}-viz@e.com`, 'gerente');
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  it('"Não era um lanche" com a sugestão na tela já decide: a resposta guarda a marca e o lanche não entra', async () => {
    ids.antigo = await mandar('rever-antigo', '2026-11-01T20:00:00-03:00');
    ids.anel = await mandar('rever-anel', '2026-11-03T21:00:00-03:00');
    ids.carne = await mandar('rever-carne', '2026-11-03T21:10:00-03:00');
    ids.varios = await mandar('rever-varios', '2026-11-03T21:20:00-03:00');
    ids.comLanche = await mandar('rever-com-lanche', '2026-11-03T21:30:00-03:00');

    const r = await conferir(ids.anel, respostaCom(null, [0, 1, 2]));
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().sugestaoVista, 'Numero 08', 'a API diz qual sugestão estava na tela');
    assert.deepEqual((await resposta(ids.anel)).sugestaoVista, { lanche: 'Numero 08', pelos: ['Anel de cebola'] });
    assert.deepEqual((await lista()).rever, [], 'quem decidiu vendo a sugestão não entra');

    // sem ingrediente de um lanche só (o pão e a carne estão em três): nada a marcar
    const semUnico = await conferir(ids.carne, { ...respostaCom(null, [0, 2]), sugestaoVista: { lanche: 'X-Bacon', pelos: ['Bacon'] } });
    assert.equal(semUnico.statusCode, 200, semUnico.body);
    assert.equal(semUnico.json().sugestaoVista, null);
    assert.equal((await resposta(ids.carne)).sugestaoVista, undefined, 'a marca é da API: a que vem no corpo não entra');
    // dois lanches diferentes (o cheddar e o bacon, os dois só de um lanche): a sugestão não escolhe, nada a marcar
    assert.equal((await conferir(ids.varios, respostaCom(null, [3, 4]))).json().sugestaoVista, null);
    // com o lanche escolhido, também não
    const comLanche = await conferir(ids.comLanche, respostaCom('Numero 08', [0, 1, 2]));
    assert.deepEqual([comLanche.json().produto, comLanche.json().sugestaoVista], ['Numero 08', null]);
  });

  it('a fila: os conferidos de antes, entre TODOS os conferidos (não só os mais novos da lista), os mais antigos primeiro', async () => {
    // o antigo foi conferido "não era" com o anel; os de antes da fila não têm a marca
    assert.equal((await conferir(ids.antigo, respostaCom(null, [0, 1, 2]))).statusCode, 200);
    await comoAntes(ids.antigo);
    await comoAntes(ids.anel);
    // o antigo vira o conferido mais velho, e chegam 200 conferidos mais novos: ele sai da lista dos conferidos
    await pool.query(`update treino_lanche set conferido_em = '2026-11-02T03:00:00-03:00' where id = $1`, [ids.antigo]);
    const g = (await pool.query('select gravacao_id from treino_lanche where id = $1', [ids.anel])).rows[0].gravacao_id as string;
    await pool.query(
      `insert into treino_lanche (gravacao_id, loja_id, chave, aberto_em, leitura, situacao, resposta, produto, conferido_em)
       select $1, $2, 'enchimento-' || n, now(), '{"etapas": []}', 'conferido', '{"produto": "X-Bacon", "etapas": [], "faltas": {}, "aMais": {}}', 'X-Bacon',
              now() - make_interval(mins => n)
         from generate_series(1, $3::int) as n`,
      [g, lojaId, NA_LISTA],
    );
    const l = await lista();
    assert.ok(!l.lanches.some((x) => x.id === ids.antigo), 'o antigo ficou fora dos conferidos da lista (os 200 mais novos)');
    assert.deepEqual(l.rever.map((x) => x.id), [ids.antigo, ids.anel], 'os dois "não era" com o anel; o antigo primeiro');
    assert.deepEqual(l.rever[0]!.rever, { ingrediente: 'Anel de cebola', familia: N08, adicionalEm: ['X-Bacon'] });
    assert.equal(l.rever[0]!.produto, null);
    // a gaveta recebe o mesmo motivo; o lanche que não está na fila, nulo
    const um = (id: string) => app.inject({ method: 'GET', url: `/v1/treino/lanches/${id}`, headers: { cookie } });
    assert.deepEqual((await um(ids.anel)).json().rever, { ingrediente: 'Anel de cebola', familia: N08, adicionalEm: ['X-Bacon'] });
    for (const fora of [ids.carne, ids.varios, ids.comLanche]) assert.equal((await um(fora)).json().rever, null, fora);
    // outra conta nem vê a loja
    assert.equal((await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}/treino`, headers: { cookie: cookieVizinho } })).statusCode, 404);
  });

  it('sai salvando de novo: com o lanche, entra no placar; com "Continua não sendo um lanche", ganha a marca e não volta', async () => {
    const antes = await lista();
    const comOLanche = await conferir(ids.antigo, respostaCom('TRIO 08', [0, 1, 2]));
    assert.equal(comOLanche.statusCode, 200, comOLanche.body);
    assert.deepEqual([comOLanche.json().produto, comOLanche.json().sugestaoVista], ['TRIO 08', null]);
    const depois = await lista();
    assert.deepEqual(depois.rever.map((x) => x.id), [ids.anel]);
    assert.equal(depois.contas.eramLanche, antes.contas.eramLanche + 1, 'conta entre os que eram lanche');
    assert.equal(depois.contas.conferidos, antes.contas.conferidos, 'o total de conferidos não muda: foi conferido de novo');

    const continua = await conferir(ids.anel, respostaCom(null, [0, 1, 2]));
    assert.equal(continua.json().sugestaoVista, 'Numero 08');
    assert.deepEqual((await lista()).rever, [], 'fila vazia');
    assert.deepEqual((await resposta(ids.anel)).sugestaoVista, { lanche: 'Numero 08', pelos: ['Anel de cebola'] }, 'a marca fica na resposta');
  });
});
