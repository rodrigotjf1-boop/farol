// As fichas por planilha: conferir, importar, o que ficou de fora.
//
// O que se protege:
//
//   • conferir não grava nada; importar troca a base INTEIRA pelo que está
//     certo, e guarda a lista do que ficou de fora (decisão do dono em
//     11/10/2026: "entra o que está certo e a tela lista o que ficou de fora");
//   • uma loja recebe as fichas de um lugar só: a que está ligada ao Regem
//     não importa planilha — nem se a ligação acontecer no meio da importação;
//   • quem importa é quem configura a loja; a supervisão vê as fichas e não
//     importa; a loja do vizinho é 404;
//   • a base importada é a MESMA base de sempre: a tela a mostra, o agente a
//     baixa (a versão da configuração da loja sobe), e ler o Regem depois a
//     substitui.

import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { semLeituraEmCurso } from '../src/leitura.js';
import { COLUNAS, MODELO } from '../src/planilha-fichas.js';
import type { ConfigDoRegem } from '../src/regem.js';
import { subirRegemFalso, type RegemFalso } from './regem-falso.js';

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-pla-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-planilha';
const SENHA = 'uma senha longa o bastante';
const CONSOLE = 'https://console.exemplo';
const RETORNO = `${CONSOLE}/api/regem/retorno`;

type Celula = string | number | boolean | null;
const F = [...COLUNAS.fichas];
const linha = (produto: Celula, ingrediente: Celula = '', quantidade: Celula = '', unidade: Celula = ''): Celula[] => [produto, '', '', '', ingrediente, quantidade, unidade];
/** Uma planilha pequena e certa: dois produtos, um com ficha. */
const PEQUENA = { fichas: [F, linha('Batata frita', 'Batata palito', 200, 'g'), linha('Batata frita', 'Sal', 1, 'pitada'), linha('Água sem gás')] };
/** Com um produto errado no meio: o X-Burger fica de fora, os outros dois entram. */
const COM_PROBLEMA = { fichas: [F, ...PEQUENA.fichas.slice(1, 3), linha('X-Burger', 'Pão', 1, 'unidade'), linha('X-Burger', 'Queijo', '', 'fatia'), linha('Água sem gás')] };

describe('fichas por planilha: as rotas', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let falso: RegemFalso;
  let cfg: ConfigDoRegem & { segredo: string; chave: Buffer };
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  const registro: string[] = [];

  const minha = { tenantId: '', centro: '', barra: '', dono: '', gerente: '', suporte: '', supervisao: '', execucao: '' };
  const vizinha = { tenantId: '', loja: '', dono: '' };
  const contas = () => [minha.tenantId, vizinha.tenantId];

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
      buscar: fetch,
      prazoMs: 400,
      agente: 'farol-api/teste (+https://monitorfarol.com.br)',
    };
    app = criarApp(pool, { logger: { level: 'info', stream: { write: (l) => void registro.push(l) } }, regem: cfg });
    await app.ready();

    const centro = await criarLoja('Loja Centro', { tenant: { nome: `${marca}-minha` } });
    minha.tenantId = centro.tenantId;
    minha.centro = centro.lojaId;
    minha.barra = (await criarLoja('Loja Barra', { tenantId: minha.tenantId })).lojaId;
    const outra = await criarLoja('Loja Vizinha', { tenant: { nome: `${marca}-vizinha` } });
    vizinha.tenantId = outra.tenantId;
    vizinha.loja = outra.lojaId;
    minha.dono = await criarUsuario(minha.tenantId, 'dono', 'presidente');
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
    await app?.close();
    await falso?.fechar();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  beforeEach(async () => {
    falso.modo = 'normal';
    await semLeituraEmCurso();
    registro.length = 0;
    await pool.query('delete from fichas_da_loja where tenant_id = any($1::uuid[])', [contas()]);
    await pool.query('delete from regem_loja where tenant_id = any($1::uuid[])', [contas()]);
    await pool.query('delete from regem_pedido where tenant_id = any($1::uuid[])', [contas()]);
  });

  // ───────────────────────── os atalhos ─────────────────────────

  const importar = (cookie: string, lojaId: string, corpo: unknown, a: FastifyInstance = app) =>
    a.inject({ method: 'POST', url: `/v1/lojas/${lojaId}/fichas/importar`, headers: { cookie }, payload: corpo as object });
  const conferir = (cookie: string, lojaId: string, abas: unknown) => importar(cookie, lojaId, { arquivo: 'fichas.xlsx', abas });
  const gravar = (cookie: string, lojaId: string, abas: unknown, arquivo = 'fichas.xlsx') => importar(cookie, lojaId, { arquivo, abas, gravar: true });
  const fichas = (cookie: string, lojaId: string) => app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}/fichas`, headers: { cookie } });
  const importacao = (cookie: string, lojaId: string) => app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}/fichas/importacao`, headers: { cookie } });
  const planilha = (cookie: string, lojaId: string) => app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}/fichas/planilha`, headers: { cookie } });
  const modelo = (cookie: string) => app.inject({ method: 'GET', url: '/v1/fichas/modelo', headers: { cookie } });
  type Guardada = { fonte: string; produtos: number; com_ficha: number; impressao: string; atualizada_em: Date; importacao: Record<string, unknown> | null };
  const baseDe = async (lojaId: string) =>
    (await pool.query<Guardada>('select fonte, produtos, com_ficha, impressao, atualizada_em, importacao from fichas_da_loja where loja_id = $1', [lojaId])).rows[0] ?? null;
  const versaoDe = async (lojaId: string) => (await pool.query<{ v: number }>('select config_versao as v from loja where id = $1', [lojaId])).rows[0]!.v;
  /** Liga a loja ao Regem (de mentira) e espera a primeira leitura. */
  async function ligarAoRegem(lojaId: string, nome: string) {
    const ida = await app.inject({ method: 'POST', url: '/v1/regem/conectar', headers: { cookie: minha.dono } });
    const url = new URL(ida.json().url);
    const code = falso.autorizar({ lojas: [{ id: randomUUID(), nome }], desafio: url.searchParams.get('code_challenge')!, redirectUri: RETORNO });
    await app.inject({ method: 'GET', url: `/v1/regem/retorno?${new URLSearchParams({ code, state: url.searchParams.get('state')! })}`, headers: { cookie: minha.dono } });
    const c = (await app.inject({ method: 'GET', url: '/v1/regem', headers: { cookie: minha.dono } })).json();
    const esperando = c.esperando.find((e: { regemLojaNome: string }) => e.regemLojaNome === nome);
    const r = await app.inject({ method: 'PUT', url: '/v1/regem/lojas', headers: { cookie: minha.dono }, payload: { pares: [{ id: esperando.id, lojaId }] } });
    assert.equal(r.statusCode, 200, r.body);
    await semLeituraEmCurso();
  }

  // ───────────────────────── quem pode ─────────────────────────

  it('sem sessão, 401; execução, 403; a supervisão vê as fichas e NÃO importa; quem configura importa', async () => {
    const rotas: Array<[string, string, object | undefined]> = [
      ['POST', `/v1/lojas/${minha.centro}/fichas/importar`, { abas: PEQUENA, gravar: true }],
      ['GET', `/v1/lojas/${minha.centro}/fichas/importacao`, undefined],
      ['GET', `/v1/lojas/${minha.centro}/fichas/planilha`, undefined],
      ['GET', '/v1/fichas/modelo', undefined],
    ];
    for (const [method, url, payload] of rotas) {
      assert.equal((await app.inject({ method: method as 'GET', url, payload })).statusCode, 401, url);
      for (const [cookie, frase] of [[minha.execucao, /não vê as fichas/], [minha.supervisao, /quem importa a planilha é quem configura a loja/]] as const) {
        const r = await app.inject({ method: method as 'GET', url, headers: { cookie }, payload });
        assert.equal(r.statusCode, 403, url);
        assert.deepEqual(Object.keys(r.json()).sort(), ['erro', 'mensagem'], url);
        assert.equal(r.json().erro, 'sem_permissao', url);
        assert.match(r.json().mensagem, frase, url);
      }
    }
    assert.equal(await baseDe(minha.centro), null, 'ninguém sem permissão gravou nada');

    for (const cookie of [minha.gerente, minha.suporte, minha.dono]) {
      assert.equal((await gravar(cookie, minha.centro, PEQUENA)).statusCode, 200);
      assert.equal((await modelo(cookie)).statusCode, 200);
    }
    // quem só vê: a lista aparece, com a origem — e sem o botão de importar
    const telas = await Promise.all([minha.dono, minha.gerente, minha.suporte, minha.supervisao].map(async (c) => (await fichas(c, minha.centro)).json()));
    assert.deepEqual(telas.map((t) => [t.fonte, t.podeImportar, t.produtos.length]), [['planilha', true, 2], ['planilha', true, 2], ['planilha', true, 2], ['planilha', false, 2]]);
  });

  it('a loja do vizinho é 404 nas rotas da planilha, e a importação dele não aparece para mim; id malformado é 422', async () => {
    assert.equal((await gravar(vizinha.dono, vizinha.loja, PEQUENA)).statusCode, 200);
    assert.equal((await gravar(minha.dono, vizinha.loja, COM_PROBLEMA)).statusCode, 404);
    assert.equal((await conferir(minha.dono, vizinha.loja, PEQUENA)).statusCode, 404);
    assert.equal((await importacao(minha.dono, vizinha.loja)).statusCode, 404);
    assert.equal((await planilha(minha.dono, vizinha.loja)).statusCode, 404);
    assert.equal((await baseDe(vizinha.loja))!.produtos, 2, 'a base dele continua a dele');
    assert.equal(await baseDe(minha.centro), null);
    for (const r of [await gravar(minha.dono, 'x', PEQUENA), await importacao(minha.dono, 'x'), await planilha(minha.dono, 'x')]) assert.equal(r.statusCode, 422);
  });

  // ───────────────────────── conferir e importar ─────────────────────────

  it('conferir não grava nada: diz o que entraria, o que ficaria de fora e o que seria trocado', async () => {
    const versao = await versaoDe(minha.centro);
    for (const corpo of [{ abas: COM_PROBLEMA }, { abas: COM_PROBLEMA, gravar: false }]) {
      const r = await importar(minha.gerente, minha.centro, corpo);
      assert.equal(r.statusCode, 200, r.body);
      assert.deepEqual(r.json(), {
        gravado: false,
        contas: { produtos: 2, comFicha: 1, ingredientes: 2, variacoes: 0, adicionais: 0, combos: 0 },
        semFicha: ['Água sem gás'],
        deFora: [{ produto: 'X-Burger', problemas: [{ aba: 'Fichas', linha: 5, texto: 'falta a quantidade.', corrigir: 'Preencha a coluna Quantidade.' }] }],
        soltos: [],
        problemas: 1,
        troca: null,
      });
    }
    assert.equal(await baseDe(minha.centro), null);
    assert.equal(await versaoDe(minha.centro), versao, 'a configuração da loja não mexeu');
    assert.equal((await fichas(minha.gerente, minha.centro)).json().fonte, null);
  });

  it('o pedido torto é recusado antes de ler a planilha, e a planilha que não dá para ler é 422 com o motivo', async () => {
    for (const corpo of ['texto', [PEQUENA], null]) assert.equal((await importar(minha.gerente, minha.centro, corpo)).statusCode >= 400, true);
    assert.deepEqual([(await importar(minha.gerente, minha.centro, [PEQUENA])).statusCode, (await importar(minha.gerente, minha.centro, [PEQUENA])).json().erro], [422, 'validacao']);
    // liga-desliga é exato: "true" em texto não grava
    for (const torto of ['true', 1, 'sim', null]) {
      const r = await importar(minha.gerente, minha.centro, { abas: PEQUENA, gravar: torto });
      assert.deepEqual([r.statusCode, r.json().erro], [422, 'validacao'], String(torto));
    }
    const casos: Array<[unknown, RegExp]> = [
      [undefined, /Não deu para ler a planilha/],
      [{}, /não tem a aba “Fichas”/],
      [{ fichas: [['Produto', 'Ingrediente', 'Quantidade'], ['A', 'x', 1]] }, /não tem a coluna “Unidade”/],
      [{ fichas: [F] }, /não tem nenhuma linha preenchida/],
    ];
    for (const [abas, frase] of casos) {
      for (const g of [false, true]) {
        const r = await importar(minha.gerente, minha.centro, { abas, gravar: g });
        assert.deepEqual([r.statusCode, r.json().erro], [422, 'planilha_invalida']);
        assert.match(r.json().mensagem, frase);
      }
    }
    assert.equal(await baseDe(minha.centro), null, 'nada disso gravou');
    const grande = await importar(minha.gerente, minha.centro, { abas: { fichas: [F, linha('A', 'x'.repeat(9 * 1024 * 1024), 1, 'g')] }, gravar: true });
    assert.equal(grande.statusCode, 413, 'corpo grande demais nem é lido');
  });

  it('importar: entra o que está certo, a tela mostra as fichas da planilha, e a lista do que ficou de fora fica guardada', async () => {
    const versao = await versaoDe(minha.centro);
    const r = await gravar(minha.gerente, minha.centro, COM_PROBLEMA, 'C:\\Users\\Loja\\Documentos\\fichas da loja.xlsx');
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual([r.json().gravado, r.json().resultado, r.json().contas.produtos, r.json().problemas, r.json().troca], [true, 'atualizada', 2, 1, null]);
    assert.deepEqual(r.json().deFora.map((d: { produto: string }) => d.produto), ['X-Burger']);

    const g = (await baseDe(minha.centro))!;
    assert.deepEqual([g.fonte, g.produtos, g.com_ficha], ['planilha', 2, 1]);
    assert.ok(await versaoDe(minha.centro) > versao, 'a base nova sobe a versão da configuração: é o que faz o agente da loja baixar');

    // a tela
    const t = (await fichas(minha.gerente, minha.centro)).json();
    assert.deepEqual([t.situacao, t.fonte, t.totais, t.leitura, t.podeImportar], ['sem_conexao', 'planilha', { produtos: 2, comFicha: 1 }, null, true]);
    assert.deepEqual(t.produtos.map((p: { nome: string; ingredientes: number | null }) => [p.nome, p.ingredientes]), [['Batata frita', 2], ['Água sem gás', null]]);
    assert.deepEqual(Object.keys(t.importacao).sort(), ['arquivo', 'deFora', 'em', 'por', 'problemas']);
    assert.deepEqual([t.importacao.arquivo, t.importacao.por, t.importacao.deFora, t.importacao.problemas], ['fichas da loja.xlsx', 'Pessoa gerente', 1, 1], 'o nome do arquivo, sem a pasta');
    assert.ok(Date.now() - Date.parse(t.importacao.em) < 15_000);
    const umProduto = await app.inject({ method: 'GET', url: `/v1/lojas/${minha.centro}/fichas/produtos/${t.produtos[0].id}`, headers: { cookie: minha.supervisao } });
    assert.deepEqual([umProduto.statusCode, umProduto.json().ficha.ingredientes.map((i: { nome: string }) => i.nome)], [200, ['Batata palito', 'Sal']]);

    // o registro da importação, para quem vai corrigir
    const i = await importacao(minha.gerente, minha.centro);
    assert.equal(i.statusCode, 200);
    assert.deepEqual(Object.keys(i.json()).sort(), ['arquivo', 'contas', 'deFora', 'em', 'por', 'problemas', 'semFicha', 'soltos']);
    assert.deepEqual(i.json().deFora, [{ produto: 'X-Burger', problemas: [{ aba: 'Fichas', linha: 5, texto: 'falta a quantidade.', corrigir: 'Preencha a coluna Quantidade.' }] }]);
    assert.deepEqual([i.json().por, i.json().semFicha, i.json().contas.produtos], ['Pessoa gerente', ['Água sem gás'], 2]);

    // o registro do servidor diz que houve a importação — sem nome de produto
    const escrito = registro.join('');
    assert.ok(escrito.includes('fichas: planilha importada') && !escrito.includes('Batata') && !escrito.includes('X-Burger'));
  });

  it('importar de novo: a mesma planilha não muda nada; outra troca a base INTEIRA', async () => {
    assert.equal((await gravar(minha.gerente, minha.centro, PEQUENA)).json().resultado, 'atualizada');
    const [antes, versao] = [(await baseDe(minha.centro))!, await versaoDe(minha.centro)];

    // conferir, agora, diz o que seria trocado
    assert.deepEqual((await conferir(minha.gerente, minha.centro, PEQUENA)).json().troca, { produtos: 2, comFicha: 1 });

    const igual = await gravar(minha.dono, minha.centro, PEQUENA, 'outra-copia.xlsx');
    assert.deepEqual([igual.json().gravado, igual.json().resultado, igual.json().troca], [true, 'nada_mudou', { produtos: 2, comFicha: 1 }]);
    const depois = (await baseDe(minha.centro))!;
    assert.deepEqual([depois.impressao, depois.atualizada_em.getTime()], [antes.impressao, antes.atualizada_em.getTime()], 'o documento é o mesmo: a data dele não anda');
    assert.equal(await versaoDe(minha.centro), versao, 'e o agente não baixa de novo');
    assert.deepEqual([depois.importacao!.arquivo, (depois.importacao!.por as { nome: string }).nome], ['outra-copia.xlsx', 'Pessoa dono'], 'mas o registro é o da última importação');

    const outra = await gravar(minha.gerente, minha.centro, { fichas: [F, linha('Suco', 'Polpa', 100, 'g')] });
    assert.equal(outra.json().resultado, 'atualizada');
    const t = (await fichas(minha.gerente, minha.centro)).json();
    assert.deepEqual(t.produtos.map((p: { nome: string }) => p.nome), ['Suco'], 'a batata e a água saíram: a base é trocada inteira');
    assert.ok(await versaoDe(minha.centro) > versao);
    assert.ok((await baseDe(minha.centro))!.atualizada_em.getTime() >= antes.atualizada_em.getTime());
  });

  it('nenhum produto certo: nada é importado, e as fichas de antes ficam', async () => {
    await gravar(minha.gerente, minha.centro, PEQUENA);
    const antes = (await baseDe(minha.centro))!;
    const ruim = { fichas: [F, linha('A', 'x', '', 'g'), linha('B', 'y', 1, 'pct')] };

    const c = await conferir(minha.gerente, minha.centro, ruim);
    assert.deepEqual([c.statusCode, c.json().contas.produtos, c.json().problemas], [200, 0, 2], 'conferir mostra os problemas');
    const r = await gravar(minha.gerente, minha.centro, ruim);
    assert.deepEqual([r.statusCode, r.json().erro, r.json().problemas, r.json().deFora.length], [422, 'nada_a_importar', 2, 2]);
    assert.match(r.json().mensagem, /nenhum produto da planilha está certo/);
    const depois = (await baseDe(minha.centro))!;
    assert.deepEqual([depois.impressao, depois.produtos, depois.importacao!.arquivo], [antes.impressao, 2, 'fichas.xlsx']);
  });

  // ───────────────────────── uma origem por loja ─────────────────────────

  it('a loja ligada ao Regem não importa planilha — nem confere; e a outra loja da conta importa', async () => {
    await ligarAoRegem(minha.centro, 'Centro de lá');
    const antes = (await baseDe(minha.centro))!;
    assert.equal(antes.fonte, 'regem');
    for (const r of [await conferir(minha.dono, minha.centro, PEQUENA), await gravar(minha.dono, minha.centro, PEQUENA)]) {
      assert.deepEqual([r.statusCode, r.json().erro], [409, 'origem_ocupada']);
      assert.match(r.json().mensagem, /desconecte a loja do Regem antes/);
    }
    const depois = (await baseDe(minha.centro))!;
    assert.deepEqual([depois.fonte, depois.impressao, depois.importacao], ['regem', antes.impressao, null]);
    const t = (await fichas(minha.dono, minha.centro)).json();
    assert.deepEqual([t.fonte, t.podeImportar, t.importacao], ['regem', false, null]);
    for (const r of [await importacao(minha.dono, minha.centro), await planilha(minha.dono, minha.centro)]) assert.deepEqual([r.statusCode, r.json().erro], [404, 'sem_importacao']);

    assert.equal((await gravar(minha.dono, minha.barra, PEQUENA)).statusCode, 200, 'a Barra não está ligada: importa');
    assert.equal((await baseDe(minha.barra))!.fonte, 'planilha');
  });

  it('a loja que é ligada ao Regem NO MEIO da importação não fica com as duas origens', async () => {
    // Um banco que, na hora exata de gravar a planilha, encontra a loja recém-ligada ao Regem.
    const naHora = new Proxy(pool, {
      get(alvo, nome, receptor) {
        if (nome !== 'query') return Reflect.get(alvo, nome, receptor);
        return async (texto: unknown, valores: unknown[]) => {
          if (typeof texto === 'string' && texto.includes("'planilha'")) {
            await alvo.query(
              `insert into regem_loja (tenant_id, loja_id, regem_loja_id, regem_loja_nome, regem_empresa_nome, acesso_cifrado)
               values ($1, $2, $3, 'Centro de lá', 'Casa do Lanche', 'v1.a.b.c')`,
              [minha.tenantId, minha.centro, randomUUID()],
            );
          }
          return alvo.query(texto as string, valores);
        };
      },
    });
    const outro = criarApp(naHora as pg.Pool, { logger: false, regem: cfg });
    await outro.ready();
    try {
      // conferir não grava: a ligação nem chega a acontecer
      assert.equal((await importar(minha.gerente, minha.centro, { abas: PEQUENA }, outro)).statusCode, 200);
      const noMeio = await importar(minha.gerente, minha.centro, { abas: PEQUENA, gravar: true }, outro);
      assert.deepEqual([noMeio.statusCode, noMeio.json().erro], [409, 'origem_ocupada']);
      assert.equal(await baseDe(minha.centro), null, 'a planilha não entrou');
    } finally {
      await outro.close();
    }
  });

  it('planilha e, depois, o Regem: a leitura do Regem substitui a base, e o registro da planilha sai', async () => {
    await gravar(minha.gerente, minha.centro, COM_PROBLEMA);
    assert.ok((await baseDe(minha.centro))!.importacao);
    await ligarAoRegem(minha.centro, 'Centro de lá');
    const g = (await baseDe(minha.centro))!;
    assert.deepEqual([g.fonte, g.produtos, g.importacao], ['regem', 4, null]);
    const t = (await fichas(minha.gerente, minha.centro)).json();
    assert.deepEqual([t.situacao, t.fonte, t.importacao, t.podeImportar], ['ligada', 'regem', null, false]);
    assert.equal((await importacao(minha.gerente, minha.centro)).statusCode, 404);
  });

  // ───────────────────────── o modelo e a volta ─────────────────────────

  it('o modelo sai do servidor, e importar o próprio modelo não dá problema nenhum', async () => {
    const m = await modelo(minha.gerente);
    assert.deepEqual(Object.keys(m.json()).sort(), ['abas', 'colunas', 'nomes', 'unidades']);
    assert.deepEqual(m.json().abas, MODELO);
    assert.deepEqual(m.json().nomes, { fichas: 'Fichas', variacoes: 'Variações', adicionais: 'Adicionais', combos: 'Combos' });
    assert.deepEqual(m.json().colunas.fichas, ['Produto', 'Código', 'Categoria', 'Vai para a cozinha', 'Ingrediente', 'Quantidade', 'Unidade']);
    assert.deepEqual(m.json().unidades, ['g', 'kg', 'ml', 'l', 'unidade', 'fatia', 'folha', 'rodela', 'colher', 'pitada']);

    const r = await gravar(minha.gerente, minha.centro, m.json().abas, 'modelo-de-fichas.xlsx');
    assert.deepEqual([r.statusCode, r.json().problemas, r.json().contas], [200, 0, { produtos: 4, comFicha: 2, ingredientes: 7, variacoes: 2, adicionais: 3, combos: 1 }]);
  });

  it('baixar a planilha da loja e importar de volta não muda nada', async () => {
    assert.equal((await planilha(minha.gerente, minha.centro)).statusCode, 404, 'sem fichas não há o que baixar');
    await gravar(minha.gerente, minha.centro, MODELO);
    const p = await planilha(minha.gerente, minha.centro);
    assert.equal(p.statusCode, 200);
    assert.deepEqual(Object.keys(p.json()).sort(), ['abas', 'nomes']);
    assert.deepEqual(p.json().abas, MODELO);
    const volta = await gravar(minha.gerente, minha.centro, p.json().abas);
    assert.deepEqual([volta.json().resultado, volta.json().problemas], ['nada_mudou', 0]);
  });

  it('o nome do arquivo é só para a tela dizer qual foi: sem pasta, sem caractere de controle e com teto', async () => {
    const casos: Array<[unknown, string]> = [
      ['/home/loja/fichas.csv', 'fichas.csv'],
      [`..\\..\\fichas${String.fromCharCode(0)} da${String.fromCharCode(7)} loja${String.fromCharCode(127)}.xlsx`, 'fichas da loja.xlsx'],
      [`${'n'.repeat(300)}.xlsx`, 'n'.repeat(120)],
      [42, ''],
      [undefined, ''],
    ];
    for (const [arquivo, esperado] of casos) {
      assert.equal((await importar(minha.gerente, minha.centro, { arquivo, abas: PEQUENA, gravar: true })).statusCode, 200);
      assert.equal((await baseDe(minha.centro))!.importacao!.arquivo, esperado);
    }
  });
});
