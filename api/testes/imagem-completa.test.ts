// A imagem completa do canal — a migration 034 e as rotas que a guardam.
//
// A19, onda 1, fatia 1.5. As palavras são as do dono: o canal é a câmera; a
// IMAGEM COMPLETA é o canal inteiro, e os critérios dela são os gerais; o
// QUADRO é um recorte marcado dentro da imagem, com nome e papel.
//
// O que tem de ficar provado:
//
//   - a migration leva o que já existe para o modelo novo sem mudar o que é
//     analisado: nenhum desenho muda, nenhum critério muda de lugar, e todo
//     canal fica com UMA imagem completa — inclusive os casos tortos;
//   - rodar a migration de novo não muda nada;
//   - a imagem completa não se redesenha, não se renomeia, não ganha papel e
//     não se exclui — nem pela API, nem por mão no banco;
//   - quem diz o que é a imagem completa é `principal`, não o desenho: um
//     quadro esticado até cobrir tudo continua sendo quadro, com número;
//   - todo canal nasce com ela, venha do console ou da distribuição;
//   - a tela do canal recebe o que precisa para não afirmar o que não é
//     verdade: "falta descrever a cena" só onde a cena está fazendo falta.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { ehAImagemInteira, NOME_DA_IMAGEM_COMPLETA, POLIGONO_DA_IMAGEM_COMPLETA, TIPOS_QUE_DEPENDEM_DA_CENA } from '../src/cena.js';

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-inteira-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-inteira';
const SENHA = 'uma senha longa o bastante';
const RET = (x1: number, y1: number, x2: number, y2: number) => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
const INTEIRA = [[0, 0], [1, 0], [1, 1], [0, 1]];
const MIGRATION = readFileSync(new URL('../../database/migrations/034_a_imagem_completa_de_volta.sql', import.meta.url), 'utf8');

// ───────────────────────── sem banco ─────────────────────────

describe('a imagem completa — o que é', () => {
  it('é o canal inteiro, ponto a ponto, e mais nada', () => {
    assert.deepEqual(POLIGONO_DA_IMAGEM_COMPLETA, INTEIRA);
    assert.equal(NOME_DA_IMAGEM_COMPLETA, 'Imagem completa');
    assert.equal(ehAImagemInteira(INTEIRA), true);
    assert.equal(ehAImagemInteira([[0, 0], [1, 0], [1, 1], [0, 1.0]]), true, '1.0 e 1 são o mesmo número');
    // Cobre a imagem toda, mas começa por outro canto: é um desenho de quadro.
    assert.equal(ehAImagemInteira([[1, 0], [1, 1], [0, 1], [0, 0]]), false);
    // Uma faixa de lado a lado (só a altura difere) e uma de cima a baixo (só a largura difere): nenhuma é o canal inteiro.
    for (const outro of [RET(0, 0, 1, 0.99), RET(0.2, 0, 0.8, 1), RET(0.1, 0.1, 0.9, 0.9), [[0, 0], [1, 0], [1, 1]], [...INTEIRA, [0, 0.5]], [], null, 'inteira', [[0, 0], [1], [1, 1], [0, 1]]]) {
      assert.equal(ehAImagemInteira(outro), false, JSON.stringify(outro));
    }
  });

  it('os tipos que dependem da cena são os que podem ir a um modelo de fora', () => {
    assert.deepEqual([...TIPOS_QUE_DEPENDEM_DA_CENA].sort(), ['acao', 'comparacao', 'estado']);
  });
});

// ───────────────── a migration, sobre o que já existia ─────────────────
//
// Roda o ARQUIVO da migration num esquema só deste teste, com cópias vazias
// de `ponto` e `zona` (sem a regra nova, que é o que a migration cria) e os
// casos de antes montados à mão. As tabelas de verdade não são tocadas.

type Linha = { id: string; nome: string; principal: boolean; poligono: number[][]; papel: string; ordem: number; excluida: boolean };

describe('migration 034 — a imagem completa de volta (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let c: pg.Client;
  const esquema = `teste_mig034_${randomUUID().slice(0, 8)}`;
  let relogio = 0;

  const ponto = async (nome: string, excluido = false) =>
    (await c.query(
      `insert into ponto (setor_id, nome, excluido_em) values ($1, $2, case when $3 then now() end) returning id`,
      [randomUUID(), nome, excluido],
    )).rows[0].id as string;

  /** Uma área de antes. Cada uma nasce um segundo depois da anterior: "a mais antiga" tem de ser a certa. */
  const area = async (
    pontoId: string, nome: string, poligono: number[][],
    mais: { principal?: boolean; papel?: string; ordem?: number; excluida?: boolean } = {},
  ) => {
    relogio += 1;
    return (await c.query(
      `insert into zona (ponto_id, nome, poligono, principal, papel, ordem, excluida_em, criado_em)
       values ($1, $2, $3::jsonb, $4, $5, $6, case when $7 then now() end, timestamptz '2026-01-01' + make_interval(secs => $8))
       returning id`,
      [pontoId, nome, JSON.stringify(poligono), mais.principal ?? false, mais.papel ?? 'livre', mais.ordem ?? 0, mais.excluida ?? false, relogio],
    )).rows[0].id as string;
  };

  const areasDe = async (pontoId: string): Promise<Linha[]> =>
    (await c.query(
      `select id, nome, principal, poligono, papel, ordem, (excluida_em is not null) as excluida
         from zona where ponto_id = $1 order by criado_em, id`,
      [pontoId],
    )).rows;

  /** [nome, é a imagem completa?] das áreas que existem (as excluídas ficam de fora). */
  const resumo = async (pontoId: string) => (await areasDe(pontoId)).filter((a) => !a.excluida).map((a) => [a.nome, a.principal]);

  before(async () => {
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    await pool.query(`create schema ${esquema}`);
    // `including indexes` traz os dois índices únicos que podem recusar a migration: uma principal por canal,
    // e o nome único entre as áreas que existem. As regras (`check`) não vêm — a de 034 é a migration que cria.
    await pool.query(`create table ${esquema}.ponto (like public.ponto including defaults)`);
    await pool.query(`create table ${esquema}.zona (like public.zona including defaults including indexes)`);
    c = new pg.Client({ connectionString: URL_DO_BANCO, options: `-c search_path=${esquema}` });
    await c.connect();
  });

  after(async () => {
    await c?.end().catch(() => {});
    await pool?.query(`drop schema if exists ${esquema} cascade`);
    await pool?.end();
  });

  it('leva cada caso de antes para o modelo novo, sem mudar desenho nem lugar — e a segunda vez não muda nada', async () => {
    const recorte = RET(0.15, 0.2, 0.8, 0.75);

    // 1. O comum: a principal é o quadro inteiro, com o nome de fábrica.
    const comum = await ponto('Comum');
    const comumA = await area(comum, 'Quadro inteiro', INTEIRA, { principal: true });
    const velhaDoComum = await area(comum, 'QUADRO INTEIRO', recorte, { excluida: true });

    // 2. Como dois canais da loja de verdade: a principal foi REDESENHADA e ninguém trocou o nome.
    const redesenhada = await ponto('Redesenhada');
    const redesenhadaA = await area(redesenhada, 'Quadro inteiro', recorte, { principal: true });

    // 3. Redesenhada e com nome próprio, ao lado de outro quadro.
    const comNome = await ponto('Com nome');
    const balcao = await area(comNome, 'Atendimento 1 colaborador', recorte, { principal: true });
    const fila = await area(comNome, 'Fila', RET(0.1, 0.8, 0.9, 0.95));

    // 4. A principal é um recorte, e o canal JÁ tem outra área cobrindo tudo: é ela a imagem completa.
    const outraInteira = await ponto('Outra inteira');
    const recorteP = await area(outraInteira, 'Recorte', recorte, { principal: true });
    const tudo = await area(outraInteira, 'Tudo', INTEIRA);

    // 5. Duas áreas cobrindo tudo: fica a mais antiga; a outra continua, como quadro.
    const duas = await ponto('Duas inteiras');
    await area(duas, 'Corte', recorte, { principal: true });
    const antiga = await area(duas, 'Inteira antiga', INTEIRA);
    const nova = await area(duas, 'Inteira nova', INTEIRA);

    // 6. Canal criado pela distribuição: nunca teve área.
    const semArea = await ponto('Sem área');

    // 7. Só tem área excluída.
    const soExcluida = await ponto('Só excluída');
    const excluida = await area(soExcluida, 'Imagem completa', recorte, { excluida: true });

    // 8. Um quadro que já se chamava "Imagem completa" (em maiúsculas).
    const nomeTomado = await ponto('Nome tomado');
    const principalDoTomado = await area(nomeTomado, 'Quadro inteiro', INTEIRA, { principal: true });
    const impostor = await area(nomeTomado, 'IMAGEM COMPLETA', RET(0.2, 0.2, 0.5, 0.5));

    // 9. O canal já tem uma "Área marcada", e a principal redesenhada ainda se chama "Quadro inteiro".
    const jaTem = await ponto('Já tem área marcada');
    const redesenhadaB = await area(jaTem, 'QUADRO INTEIRO', recorte, { principal: true });
    await area(jaTem, 'Área marcada', RET(0.5, 0.5, 0.9, 0.9));

    // 10. A principal cobre tudo, mas ganhou papel e ordem pela API.
    const comPapel = await ponto('Com papel');
    const comPapelA = await area(comPapel, 'Salão', INTEIRA, { principal: true, papel: 'montagem', ordem: 7 });

    // 11. Torto: a principal está excluída.
    const principalExcluida = await ponto('Principal excluída');
    const fantasma = await area(principalExcluida, 'Sumiu', INTEIRA, { principal: true, excluida: true });

    // 12. Canal excluído, com a principal redesenhada: a regra do banco vale para ele também.
    const canalExcluido = await ponto('Canal excluído', true);
    const doExcluido = await area(canalExcluido, 'Quadro inteiro', recorte, { principal: true });

    // 13. Já tem a imagem completa, e um quadro que também cobre tudo: ele continua quadro.
    const comCopia = await ponto('Com cópia');
    const original = await area(comCopia, 'Quadro inteiro', INTEIRA, { principal: true });
    const copia = await area(comCopia, 'Tudo, como posto', INTEIRA, { papel: 'posto' });

    // 14. Já tem a imagem completa, e ela é MAIS NOVA que outra área que também cobre tudo (a principal já
    //     trocou de área um dia): a imagem completa continua sendo a que é — a mais antiga não toma o lugar.
    const maisNova = await ponto('Principal mais nova');
    const inteiraVelha = await area(maisNova, 'Tudo antigo', INTEIRA);
    const principalNova = await area(maisNova, 'Quadro inteiro', INTEIRA, { principal: true });

    const todos = [comum, redesenhada, comNome, outraInteira, duas, semArea, soExcluida, nomeTomado, jaTem, comPapel, principalExcluida, canalExcluido, comCopia, maisNova];
    const antes = new Map<string, Linha>();
    for (const p of todos) for (const a of await areasDe(p)) antes.set(a.id, a);

    await c.query(MIGRATION);

    const conferir = async (vez: string) => {
      // O que vale para TODO canal.
      for (const p of todos) {
        const areas = await areasDe(p);
        const principais = areas.filter((a) => a.principal);
        assert.equal(principais.length, 1, `${vez}: o canal tem uma imagem completa, nem zero nem duas`);
        const inteira = principais[0]!;
        assert.deepEqual(
          [inteira.nome, inteira.poligono, inteira.papel, inteira.ordem, inteira.excluida],
          ['Imagem completa', INTEIRA, 'livre', 0, false],
          vez,
        );
        // Nenhuma área que já existia mudou de desenho, sumiu ou trocou de papel (fora a principal do caso 10).
        for (const a of areas) {
          const era = antes.get(a.id);
          if (!era) continue;
          assert.deepEqual(a.poligono, era.poligono, `${vez}: o desenho de “${era.nome}” mudou`);
          assert.equal(a.excluida, era.excluida, `${vez}: “${era.nome}” mudou de excluída`);
          if (a.id !== comPapelA) assert.deepEqual([a.papel, a.ordem], [era.papel, era.ordem]);
        }
        assert.equal(areas.filter((a) => antes.has(a.id)).length, [...antes.values()].filter((a) => areas.some((x) => x.id === a.id)).length);
      }

      assert.deepEqual(await resumo(comum), [['Imagem completa', true]], 'o comum só troca de nome');
      assert.equal((await areasDe(comum))[0]!.id, comumA, 'é a MESMA área: os critérios dela continuam nela');
      assert.equal((await areasDe(comum)).find((a) => a.id === velhaDoComum)!.nome, 'QUADRO INTEIRO', 'a área excluída não muda de nome');

      assert.deepEqual(await resumo(redesenhada), [['Área marcada', false], ['Imagem completa', true]]);
      assert.equal((await areasDe(redesenhada))[0]!.id, redesenhadaA, 'a redesenhada é a mesma área, agora quadro');

      assert.deepEqual(await resumo(comNome), [['Atendimento 1 colaborador', false], ['Fila', false], ['Imagem completa', true]]);
      assert.deepEqual((await areasDe(comNome)).slice(0, 2).map((a) => a.id), [balcao, fila]);

      assert.deepEqual(await resumo(outraInteira), [['Recorte', false], ['Imagem completa', true]], 'a que já cobria tudo é a imagem completa: não nasce outra');
      assert.deepEqual((await areasDe(outraInteira)).map((a) => a.id), [recorteP, tudo]);

      assert.deepEqual(await resumo(duas), [['Corte', false], ['Imagem completa', true], ['Inteira nova', false]], 'fica a mais antiga; a outra segue como quadro');
      assert.deepEqual((await areasDe(duas)).slice(1).map((a) => a.id), [antiga, nova]);

      assert.deepEqual(await resumo(semArea), [['Imagem completa', true]], 'o canal sem área ganha a dele');

      assert.deepEqual(await resumo(soExcluida), [['Imagem completa', true]]);
      const daExcluida = (await areasDe(soExcluida)).find((a) => a.id === excluida)!;
      assert.deepEqual([daExcluida.nome, daExcluida.principal, daExcluida.excluida], ['Imagem completa', false, true], 'a excluída fica como estava, até no nome');

      const tomado = await areasDe(nomeTomado);
      assert.equal(tomado.find((a) => a.id === principalDoTomado)!.nome, 'Imagem completa');
      assert.equal(tomado.find((a) => a.id === impostor)!.nome, `IMAGEM COMPLETA · ${impostor.slice(0, 4)}`, 'o quadro saiu do caminho, sem perder o nome');

      const marcadas = await areasDe(jaTem);
      assert.equal(marcadas.find((a) => a.id === redesenhadaB)!.nome, `Área marcada · ${redesenhadaB.slice(0, 4)}`, 'o nome já estava em uso no canal');

      assert.equal((await areasDe(comPapel))[0]!.id, comPapelA);

      const daPrincipalExcluida = await areasDe(principalExcluida);
      const sumida = daPrincipalExcluida.find((a) => a.id === fantasma)!;
      assert.deepEqual([sumida.principal, sumida.excluida, sumida.nome], [false, true, 'Sumiu']);
      assert.equal(daPrincipalExcluida.length, 2, 'nasce uma imagem completa de verdade');

      assert.deepEqual(await resumo(canalExcluido), [['Área marcada', false], ['Imagem completa', true]]);
      assert.equal((await areasDe(canalExcluido))[0]!.id, doExcluido);

      assert.deepEqual(await resumo(comCopia), [['Imagem completa', true], ['Tudo, como posto', false]], 'a cópia continua quadro');
      assert.deepEqual((await areasDe(comCopia)).map((a) => [a.id, a.papel]), [[original, 'livre'], [copia, 'posto']]);

      assert.deepEqual(await resumo(maisNova), [['Tudo antigo', false], ['Imagem completa', true]], 'quem já tem a imagem completa não ganha outra');
      assert.deepEqual((await areasDe(maisNova)).map((a) => a.id), [inteiraVelha, principalNova]);
    };

    await conferir('primeira vez');
    const total = (await c.query('select count(*)::int as n from zona')).rows[0].n as number;
    const nomes = (await c.query('select id, nome, principal from zona order by id')).rows;

    await c.query(MIGRATION);
    await conferir('segunda vez');
    assert.equal((await c.query('select count(*)::int as n from zona')).rows[0].n, total, 'a segunda vez não cria área');
    assert.deepEqual((await c.query('select id, nome, principal from zona order by id')).rows, nomes, 'nem troca nome ou principal');
  });

  it('a regra fica no banco: a principal não se redesenha, não ganha papel e não se exclui', async () => {
    const p = await ponto('Regra');
    await c.query(MIGRATION);
    const inteira = (await areasDe(p))[0]!.id;
    // 23514 = violação de `check`.
    await assert.rejects(c.query(`update zona set poligono = $2::jsonb where id = $1`, [inteira, JSON.stringify(RET(0.1, 0.1, 0.9, 0.9))]), { code: '23514' });
    await assert.rejects(c.query(`update zona set papel = 'montagem' where id = $1`, [inteira]), { code: '23514' });
    await assert.rejects(c.query(`update zona set excluida_em = now() where id = $1`, [inteira]), { code: '23514' });
    await assert.rejects(
      c.query(`insert into zona (ponto_id, nome, poligono, principal) values ($1, 'Outra', $2::jsonb, true)`, [await ponto('Outro'), JSON.stringify(RET(0, 0, 0.5, 0.5))]),
      { code: '23514' },
    );
    // O que NÃO é a principal continua livre: é quadro.
    const quadro = await area(p, 'Quadro', RET(0.1, 0.1, 0.9, 0.9), { papel: 'montagem' });
    await c.query(`update zona set poligono = $2::jsonb, excluida_em = now() where id = $1`, [quadro, JSON.stringify(INTEIRA)]);
    // E deixar de ser a principal tira a área da regra (é o que a exclusão de um canal antigo faria).
    await c.query(`update zona set principal = false, excluida_em = now() where id = $1`, [inteira]);
  });
});

// ───────────────────────── as rotas ─────────────────────────

type Zona = { id: string; nome: string; principal: boolean; papel: string; ordem: number; numero: number | null; poligono: number[][]; criterios: Criterio[] };
type Criterio = { id: string; nome: string; tipo: string; ativa: boolean; estado: string; canais: number; quadros: number; falta_a_cena: boolean };

describe('a imagem completa e os quadros, pela API (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  let lojaId = '';
  let setorId = '';
  let cookie = '';
  let cookieSupervisao = '';
  let token = '';

  async function entrar(tenantId: string, email: string, nivel: string) {
    await app.inject({
      method: 'POST', url: '/v1/distribuicao/usuarios', headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId, nome: 'X', email, senha: SENHA, nivel },
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
    return { pontoId: r.json().id as string, inteira: r.json().zonas[0].id as string, resposta: r.json() };
  }

  const mudar = (zonaId: string, corpo: unknown, comCookie = cookie) =>
    app.inject({ method: 'PATCH', url: `/v1/zonas/${zonaId}`, headers: { cookie: comCookie }, payload: corpo as object });
  const criarQuadro = (pontoId: string, corpo: unknown) =>
    app.inject({ method: 'POST', url: `/v1/pontos/${pontoId}/zonas`, headers: { cookie }, payload: corpo as object });
  const excluir = (zonaId: string) => app.inject({ method: 'DELETE', url: `/v1/zonas/${zonaId}`, headers: { cookie } });
  const canal = async (pontoId: string, comCookie = cookie) =>
    (await app.inject({ method: 'GET', url: `/v1/pontos/${pontoId}`, headers: { cookie: comCookie } })).json() as {
      ponto: Record<string, unknown>; zonas: Zona[];
    };
  const noBanco = async (zonaId: string) =>
    (await pool.query(`select nome, poligono, principal, papel, ordem, largura_cena_cm, excluida_em from zona where id = $1`, [zonaId])).rows[0];
  const chave = (ligada: boolean, mesmoAssim = false) =>
    app.inject({
      method: 'PATCH', url: `/v1/distribuicao/lojas/${lojaId}`, headers: { 'x-farol-admin': ADMIN },
      payload: { pedidoComContexto: ligada, ...(mesmoAssim ? { mesmoAssim: true } : {}) },
    });

  async function criterio(nome: string, zonaIds: string[], extra: Record<string, unknown> = {}) {
    const r = await app.inject({
      method: 'POST', url: `/v1/lojas/${lojaId}/regras`, headers: { cookie },
      payload: { nome, tipo: 'estado', criterio: `Texto de ${nome}.`, zonaIds, quando: 'sempre', ...extra },
    });
    assert.equal(r.statusCode, 201, r.body);
    return r.json().id as string;
  }
  const ligar = async (id: string) =>
    assert.equal((await app.inject({ method: 'PATCH', url: `/v1/regras/${id}`, headers: { cookie }, payload: { ativa: true } })).statusCode, 200);

  const doAgente = (metodo: 'GET' | 'POST', url: string, payload?: unknown) =>
    app.inject({ method: metodo, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    app = criarApp(pool, { logger: false });
    await app.ready();

    const conta = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN },
      payload: {
        tenant: { nome: marca }, loja: { nome: 'Matriz' },
        // Dois canais já nascem com a loja: é o caminho que antes criava canal sem área.
        setores: [{ nome: 'Cozinha', pontos: [{ nome: 'Da distribuição A', canal: 1, host: '192.168.1.108' }, { nome: 'Da distribuição B', canal: 2, host: '192.168.1.108' }] }],
      },
    })).json();
    lojaId = conta.loja.id;
    setorId = conta.setores[0].id;
    cookie = await entrar(conta.tenantId, `ger-${marca}@e.com`, 'gerente');
    cookieSupervisao = await entrar(conta.tenantId, `sup-${marca}@e.com`, 'supervisao');

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

  // ─────────────────────── todo canal nasce com ela ───────────────────────

  it('o canal nasce com a imagem completa — pelo console e pela distribuição', async () => {
    const c = await canalNovo('Balcão');
    assert.deepEqual(
      c.resposta.zonas.map((z: Zona) => [z.nome, z.principal, z.papel, z.numero, z.poligono]),
      [['Imagem completa', true, 'livre', null, INTEIRA]],
    );
    assert.equal(c.resposta.tem_cena, false);

    const arvore = (await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}`, headers: { cookie } })).json();
    const pontos = arvore.setores[0].pontos as { nome: string; tem_cena: boolean; zonas: { nome: string; principal: boolean; numero: number | null; papel: string }[] }[];
    for (const nome of ['Da distribuição A', 'Da distribuição B', 'Balcão']) {
      const p = pontos.find((x) => x.nome === nome)!;
      assert.deepEqual(p.zonas.map((z) => [z.nome, z.principal, z.numero, z.papel]), [['Imagem completa', true, null, 'livre']], nome);
      assert.equal(p.tem_cena, false);
    }
    // E é o que o agente recebe: o canal da distribuição deixou de descer sem área.
    const cfg = (await doAgente('GET', '/v1/agentes/configuracao')).json() as { pontos: { nome: string; zonas: { nome: string; principal: boolean; numero: number | null }[] }[] };
    const daDistribuicao = cfg.pontos.find((p) => p.nome === 'Da distribuição A')!;
    assert.deepEqual(daDistribuicao.zonas.map((z) => [z.nome, z.principal, z.numero]), [['Imagem completa', true, null]]);
  });

  // ─────────────────────── ela é fixa ───────────────────────

  it('a imagem completa não se redesenha, não se renomeia e não ganha papel nem ordem', async () => {
    const c = await canalNovo('Fixa');
    const versaoAntes = (await pool.query(`select config_versao from loja where id = $1`, [lojaId])).rows[0].config_versao as number;
    for (const corpo of [
      { poligono: RET(0.1, 0.1, 0.9, 0.9) },
      { poligono: [[1, 0], [1, 1], [0, 1], [0, 0]] },
      { poligono: 'torto' },
      { nome: 'Balcão inteiro' },
      { papel: 'montagem' },
      { ordem: 3 },
      { principal: false },
      // Um campo proibido no meio de um pedido que, no resto, não mudaria nada.
      { nome: 'Imagem completa', papel: 'livre', poligono: RET(0, 0, 1, 0.5) },
    ]) {
      const r = await mudar(c.inteira, corpo);
      assert.equal(r.statusCode, 409, `${JSON.stringify(corpo)} → ${r.body}`);
      assert.equal(r.json().erro, 'imagem_completa_fixa');
      assert.match(r.json().mensagem, /^a imagem completa é sempre o canal inteiro/);
    }
    assert.deepEqual(
      await noBanco(c.inteira),
      { nome: 'Imagem completa', poligono: INTEIRA, principal: true, papel: 'livre', ordem: 0, largura_cena_cm: null, excluida_em: null },
      'pedido recusado não mudou nada',
    );
    assert.equal((await pool.query(`select config_versao from loja where id = $1`, [lojaId])).rows[0].config_versao, versaoAntes, 'nem fez o agente puxar a configuração');

    // Mandar de volta o que ela já é passa, e não muda nada: é o que uma tela manda ao salvar sem mexer.
    const igual = await mudar(c.inteira, { nome: 'Imagem completa', poligono: INTEIRA, papel: 'livre', ordem: 0, principal: true });
    assert.equal(igual.statusCode, 200, igual.body);
    assert.deepEqual([igual.json().nome, igual.json().poligono, igual.json().principal, igual.json().papel], ['Imagem completa', INTEIRA, true, 'livre']);

    // O que se muda nela: a largura real da cena, que é medida da câmera.
    const largura = await mudar(c.inteira, { larguraCenaCm: 240 });
    assert.equal(largura.statusCode, 200, largura.body);
    assert.equal(Number(largura.json().largura_cena_cm), 240);
    assert.equal((await mudar(c.inteira, { larguraCenaCm: null })).json().largura_cena_cm, null);
    assert.equal((await mudar(c.inteira, { larguraCenaCm: 0 })).statusCode, 422);

    // Quem não configura continua não mexendo nem nisso.
    assert.equal((await mudar(c.inteira, { larguraCenaCm: 100 }, cookieSupervisao)).statusCode, 403);
  });

  it('a imagem completa não se exclui: o canal nunca fica sem ela', async () => {
    const c = await canalNovo('Não exclui');
    const quadro = (await criarQuadro(c.pontoId, { nome: 'Lado do cliente' })).json().id as string;
    const geral = await criterio('Critério geral', [c.inteira]);

    const r = await excluir(c.inteira);
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().erro, 'imagem_completa_fixa');
    assert.match(r.json().mensagem, /pause ou exclua o canal/);
    const depois = await canal(c.pontoId);
    assert.deepEqual(depois.zonas.map((z) => [z.nome, z.principal]), [['Imagem completa', true], ['Lado do cliente', false]]);
    assert.deepEqual(depois.zonas[0]!.criterios.map((k) => k.id), [geral], 'o critério geral não saiu do lugar');

    // O quadro, sim: e a imagem completa continua sendo a mesma.
    assert.equal((await excluir(quadro)).statusCode, 200);
    const sobrou = await canal(c.pontoId);
    assert.deepEqual(sobrou.zonas.map((z) => [z.id, z.principal]), [[c.inteira, true]]);
    assert.equal((await noBanco(quadro)).principal, false);
    assert.ok((await noBanco(quadro)).excluida_em, 'o quadro fica marcado, não apagado');
    const principais = await pool.query(`select count(*)::int as n from zona where ponto_id = $1 and principal`, [c.pontoId]);
    assert.equal(principais.rows[0].n, 1);
  });

  it('no banco a regra é a mesma: nem por SQL a imagem completa muda', async () => {
    const c = await canalNovo('No banco');
    // 23514 = violação de `check`.
    await assert.rejects(pool.query(`update zona set poligono = $2::jsonb where id = $1`, [c.inteira, JSON.stringify(RET(0.1, 0.1, 0.9, 0.9))]), { code: '23514' });
    await assert.rejects(pool.query(`update zona set papel = 'cuba' where id = $1`, [c.inteira]), { code: '23514' });
    await assert.rejects(pool.query(`update zona set excluida_em = now() where id = $1`, [c.inteira]), { code: '23514' });
    // E um canal não tem duas (23505 = índice único).
    await assert.rejects(
      pool.query(`insert into zona (ponto_id, nome, poligono, principal) values ($1, 'Segunda', $2::jsonb, true)`, [c.pontoId, JSON.stringify(INTEIRA)]),
      { code: '23505' },
    );
  });

  // ─────────────────────── os quadros ───────────────────────

  it('um quadro não toma o lugar da imagem completa, nem o nome dela', async () => {
    const c = await canalNovo('Quadros');
    for (const nome of ['Imagem completa', '  imagem COMPLETA ']) {
      const r = await criarQuadro(c.pontoId, { nome });
      assert.equal(r.statusCode, 422, r.body);
      assert.equal(r.json().mensagem, '“Imagem completa” é o nome do canal inteiro: dê outro nome ao quadro');
    }
    const quadro = (await criarQuadro(c.pontoId, { nome: 'Cubas', papel: 'cuba' })).json().id as string;
    const renomear = await mudar(quadro, { nome: 'imagem completa' });
    assert.equal(renomear.statusCode, 422, renomear.body);
    assert.match(renomear.json().mensagem, /é o nome do canal inteiro/);

    const promover = await mudar(quadro, { principal: true });
    assert.equal(promover.statusCode, 409, promover.body);
    assert.equal(promover.json().erro, 'imagem_completa_fixa');
    assert.match(promover.json().mensagem, /um quadro não toma o lugar dela/);
    // `principal: false` num quadro é o que ele já é: passa.
    assert.equal((await mudar(quadro, { principal: false, nome: 'Cubas da frente' })).statusCode, 200);

    const tela = await canal(c.pontoId);
    assert.deepEqual(tela.zonas.map((z) => [z.nome, z.principal, z.papel, z.numero]), [['Imagem completa', true, 'livre', null], ['Cubas da frente', false, 'cuba', 1]]);
  });

  it('quem diz o que é a imagem completa é ela ser a principal, não o desenho', async () => {
    const c = await canalNovo('Número');
    const a = (await criarQuadro(c.pontoId, { nome: 'A', poligono: RET(0.1, 0.1, 0.4, 0.4) })).json().id as string;
    const b = (await criarQuadro(c.pontoId, { nome: 'B', poligono: RET(0.5, 0.5, 0.9, 0.9) })).json().id as string;
    const numeros = async () => Object.fromEntries((await canal(c.pontoId)).zonas.map((z) => [z.nome, z.numero]));
    assert.deepEqual(await numeros(), { 'Imagem completa': null, A: 1, B: 2 });

    // O quadro esticado até cobrir a imagem toda continua sendo quadro, com o número dele.
    const esticado = await mudar(a, { poligono: INTEIRA, papel: 'montagem' });
    assert.equal(esticado.statusCode, 200, esticado.body);
    assert.deepEqual(await numeros(), { 'Imagem completa': null, A: 1, B: 2 });
    // E um quadro pode nascer assim.
    assert.equal((await criarQuadro(c.pontoId, { nome: 'Tudo, como posto', poligono: INTEIRA, papel: 'posto' })).statusCode, 201);
    assert.deepEqual(await numeros(), { 'Imagem completa': null, A: 1, B: 2, 'Tudo, como posto': 3 });

    // A ordem manda entre os quadros, e a imagem completa vem sempre primeiro na tela.
    assert.equal((await mudar(a, { ordem: 9 })).statusCode, 200);
    const tela = await canal(c.pontoId);
    assert.deepEqual(tela.zonas.map((z) => [z.nome, z.numero]), [['Imagem completa', null], ['B', 1], ['Tudo, como posto', 2], ['A', 3]]);

    // A árvore de critérios do console recebe na mesma ordem, com o número e o papel de cada um.
    const arvore = (await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}`, headers: { cookie } })).json();
    const naArvore = arvore.setores[0].pontos.find((p: { id: string }) => p.id === c.pontoId).zonas as { nome: string; numero: number | null; papel: string; principal: boolean }[];
    assert.deepEqual(
      naArvore.map((z) => [z.nome, z.numero, z.papel, z.principal]),
      [['Imagem completa', null, 'livre', true], ['B', 1, 'livre', false], ['Tudo, como posto', 2, 'posto', false], ['A', 3, 'montagem', false]],
    );

    // No que desce para o agente, os mesmos números.
    const cfg = (await doAgente('GET', '/v1/agentes/configuracao')).json() as { pontos: { id: string; zonas: { nome: string; numero: number | null; principal: boolean }[] }[] };
    const desceu = Object.fromEntries(cfg.pontos.find((p) => p.id === c.pontoId)!.zonas.map((z) => [z.nome, [z.numero, z.principal]]));
    assert.deepEqual(desceu, { 'Imagem completa': [null, true], B: [1, false], 'Tudo, como posto': [2, false], A: [3, false] });

    // Como nos canais que a migration 034 arrumou: a imagem completa nasceu DEPOIS dos quadros. Ela vem
    // primeiro mesmo assim, e os números não mudam.
    await pool.query(`update zona set criado_em = now() + interval '1 hour' where id = $1`, [c.inteira]);
    assert.deepEqual(
      (await canal(c.pontoId)).zonas.map((z) => [z.nome, z.numero]),
      [['Imagem completa', null], ['B', 1], ['Tudo, como posto', 2], ['A', 3]],
    );
    void b;
  });

  it('um canal tem a imagem completa e até oito quadros', async () => {
    const c = await canalNovo('Cheio');
    for (let i = 1; i <= 8; i += 1) {
      assert.equal((await criarQuadro(c.pontoId, { nome: `Quadro ${i}` })).statusCode, 201, String(i));
    }
    const nono = await criarQuadro(c.pontoId, { nome: 'Quadro 9' });
    assert.equal(nono.statusCode, 409, nono.body);
    assert.deepEqual([nono.json().erro, nono.json().mensagem], ['areas_demais', 'um canal tem no máximo 8 quadros']);
    const cheio = await canal(c.pontoId);
    assert.equal(cheio.zonas.length, 9, 'a imagem completa e os oito');

    // Quadro excluído não ocupa lugar: sai um, cabe outro.
    assert.equal((await excluir(cheio.zonas[3]!.id)).statusCode, 200);
    assert.equal((await criarQuadro(c.pontoId, { nome: 'Quadro 9' })).statusCode, 201);
    assert.equal((await criarQuadro(c.pontoId, { nome: 'Quadro 10' })).statusCode, 409);
  });

  // ─────────────────────── o que a tela do canal recebe ───────────────────────

  it('cada critério diz em quantos canais e quadros vale', async () => {
    const a = await canalNovo('Canal A');
    const b = await canalNovo('Canal B');
    const quadroA = (await criarQuadro(a.pontoId, { nome: 'Chapa' })).json().id as string;
    const quadroB1 = (await criarQuadro(b.pontoId, { nome: 'Chapa' })).json().id as string;
    const quadroB2 = (await criarQuadro(b.pontoId, { nome: 'Posto' })).json().id as string;

    const geral = await criterio('Só no canal A, geral', [a.inteira]);
    const misto = await criterio('Em dois canais', [a.inteira, quadroB1, quadroB2]);
    const doQuadro = await criterio('Num quadro só', [quadroA]);

    const telaA = await canal(a.pontoId);
    const porId = (zonas: Zona[]) => Object.fromEntries(zonas.flatMap((z) => z.criterios.map((k) => [`${z.nome}/${k.id}`, [k.canais, k.quadros]])));
    assert.deepEqual(porId(telaA.zonas), {
      [`Imagem completa/${geral}`]: [1, 0],
      [`Imagem completa/${misto}`]: [2, 2],
      [`Chapa/${doQuadro}`]: [1, 1],
    });
    const telaB = await canal(b.pontoId);
    assert.deepEqual(porId(telaB.zonas), { [`Chapa/${misto}`]: [2, 2], [`Posto/${misto}`]: [2, 2] });
  });

  it('"falta descrever a cena" só aparece onde a cena está fazendo falta', async () => {
    const c = await canalNovo('Cena');
    const quadro = (await criarQuadro(c.pontoId, { nome: 'Bancada' })).json().id as string;
    const estado = await criterio('Limpeza', [quadro]);
    const acao = await criterio('Salga', [quadro], { tipo: 'acao' });
    const comparacao = await criterio('Igual ao padrão', [c.inteira], { tipo: 'comparacao' });
    const presenca = await criterio('Gente', [c.inteira], { tipo: 'presenca', criterio: 'Há alguém.', parametros: { objeto: 'pessoa', minimo: 1, maximo: null } });
    const desligado = await criterio('Desligado', [quadro]);
    const observando = await criterio('Observando', [quadro], { estado: 'observando' });
    for (const id of [estado, acao, comparacao, presenca, observando]) await ligar(id);

    const faltas = async () => {
      const tela = await canal(c.pontoId);
      return {
        doCanal: tela.ponto.cena_em_falta,
        deles: Object.fromEntries(tela.zonas.flatMap((z) => z.criterios.map((k) => [k.nome, k.falta_a_cena]))),
        chaves: Object.keys(tela.ponto),
      };
    };
    const nenhuma = { Limpeza: false, Salga: false, 'Igual ao padrão': false, Gente: false, Desligado: false, Observando: false };

    // A loja ainda não pergunta com contexto: a cena em branco não tira análise de ninguém.
    let f = await faltas();
    assert.equal(f.doCanal, false);
    assert.deepEqual(f.deles, nenhuma);
    // A chave interna não aparece — nem com o nome de dentro, nem com o de fora.
    for (const proibido of ['com_contexto', 'pedido_com_contexto', 'pedidoComContexto']) assert.ok(!f.chaves.includes(proibido), proibido);

    assert.equal((await chave(true, true)).statusCode, 200);
    try {
      // Agora falta: o que depende de entender a imagem, está ligado e julga.
      f = await faltas();
      assert.equal(f.doCanal, true);
      assert.deepEqual(f.deles, { ...nenhuma, Limpeza: true, Salga: true, 'Igual ao padrão': true });
      for (const proibido of ['com_contexto', 'pedido_com_contexto', 'pedidoComContexto']) assert.ok(!f.chaves.includes(proibido), proibido);

      // Escrita a cena, não falta mais nada.
      assert.equal((await app.inject({ method: 'PATCH', url: `/v1/pontos/${c.pontoId}`, headers: { cookie }, payload: { cena: 'Bancada vista de cima.' } })).statusCode, 200);
      f = await faltas();
      assert.equal(f.doCanal, false);
      assert.deepEqual(f.deles, nenhuma);
      const arvore = (await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}`, headers: { cookie } })).json();
      assert.equal(arvore.setores[0].pontos.find((p: { id: string }) => p.id === c.pontoId).tem_cena, true);

      // Só espaço não é cena.
      assert.equal((await app.inject({ method: 'PATCH', url: `/v1/pontos/${c.pontoId}`, headers: { cookie }, payload: { cena: '   ' } })).statusCode, 200);
      assert.equal((await faltas()).doCanal, true);
      // Nem quando o espaço chega ao banco por outro caminho — é a mesma conta do "ligar com canal sem cena".
      await pool.query(`update ponto set cena = '   ' where id = $1`, [c.pontoId]);
      assert.equal((await faltas()).doCanal, true);
    } finally {
      await chave(false);
    }
    void desligado;
  });
});
