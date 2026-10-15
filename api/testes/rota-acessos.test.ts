// A porta para outro sistema: o acesso (criar, listar, revogar) e o envio das fichas.
//
// O que se protege:
//
//   • só a diretoria cria e revoga; quem configura vê; a supervisão e a
//     execução não veem; a loja do vizinho é 404;
//   • o CÓDIGO aparece uma vez (na resposta de quem criou) e não fica em
//     lugar nenhum: o banco guarda a impressão, a lista não o traz, o registro
//     do servidor não o escreve;
//   • na porta, a loja e a conta saem DO ACESSO — nada no corpo do envio
//     escreve na loja de outro;
//   • revogar vale na hora, e apaga as fichas que o sistema mandou (as de
//     planilha, que não são dele, ficam);
//   • uma loja recebe as fichas de um lugar só: a ligada ao Regem não ganha
//     acesso; a que tem acesso não é ligada ao Regem nem importa planilha;
//   • o envio segue a regra da planilha: a forma errada recusa tudo; o
//     conteúdo errado deixa aquele produto de fora, e os outros entram.

import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { gerarChave } from '../src/dms/integracao-dms.js';
import { LIMITE_DE_CONSULTAS_POR_MINUTO } from '../src/rotas/acessos.js';
import { rodarKit } from './dms/kit-conformidade.mts';
import { semLeituraEmCurso } from '../src/leitura.js';
import { COLUNAS } from '../src/planilha-fichas.js';
import type { ConfigDoRegem } from '../src/regem.js';
import { subirRegemFalso, type RegemFalso } from './regem-falso.js';

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-porta-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-porta';
const SENHA = 'uma senha longa o bastante';
const CONSOLE = 'https://console.exemplo';
const RETORNO = `${CONSOLE}/api/regem/retorno`;

type Obj = Record<string, unknown>;
/** A base dos nomes de problema do Padrão DMS (o `type` do `application/problem+json`). */
const BASE_ERROS = 'https://dev.dmstecnologias.com/erros/';
/** A resposta ao código que não vale: a mesma para o inexistente, o colado errado e o revogado. */
const CODIGO_QUE_NAO_VALE =
  'código de acesso inválido ou revogado. Confira se foi copiado inteiro; se foi revogado, peça outro a quem cuida da conta no Farol';
/** O corpo sem o código de rastreio, que muda a cada pedido. */
const semRastreio = (j: Obj): Obj => {
  const { request_id: _r, ...resto } = j;
  return resto;
};
const ing = (nome: string, quantidade: unknown = 1, unidade: unknown = 'g'): Obj => ({ nome, quantidade, unidade });
/** Um envio pequeno e certo: dois produtos, um com ficha. */
const PEQUENO = { produtos: [{ nome: 'Batata frita', ingredientes: [ing('Batata palito', 200), ing('Sal', 1, 'pitada')] }, { nome: 'Água sem gás', cozinha: false }] };
/** Com um produto errado no meio: o X-Burger fica de fora, os outros dois entram. */
const COM_PROBLEMA = { produtos: [PEQUENO.produtos[0], { nome: 'X-Burger', ingredientes: [ing('Pão', 1, 'unidade'), ing('Queijo', '', 'fatia')] }, PEQUENO.produtos[1]] };
/**
 * A chamada parou no limite: 429 no Padrão DMS, e o `Retry-After` é o fim da janela que acabou de começar (perto de
 * `janelaSeg`, nunca acima) — e a frase diz o mesmo tempo.
 */
function recusou(r: { statusCode: number; headers: Record<string, unknown>; json: () => Obj }, frase: RegExp, janelaSeg: number) {
  const segundos = Number(r.headers['retry-after']);
  const j = r.json();
  assert.deepEqual([r.statusCode, r.headers['content-type'], j.type, j.erro], [429, 'application/problem+json; charset=utf-8', `${BASE_ERROS}limite-de-chamadas`, 'limite_de_chamadas']);
  assert.ok(Number.isInteger(segundos) && segundos > janelaSeg - 30 && segundos <= janelaSeg, `Retry-After ${String(r.headers['retry-after'])} numa janela de ${janelaSeg} s`);
  assert.match(String(j.mensagem), frase);
  assert.match(String(j.mensagem), new RegExp(`em ${segundos} s$`), 'a frase diz o mesmo tempo do cabeçalho');
}
/** Uma planilha pequena e certa, para a loja que já tinha fichas de planilha. */
const PLANILHA = { fichas: [[...COLUNAS.fichas], ['Suco', '', '', '', 'Polpa', 100, 'g']] };

describe('a porta para outro sistema: as rotas', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
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
    const r = await app.inject({ method: 'POST', url: '/v1/distribuicao/usuarios', headers: { 'x-farol-admin': ADMIN }, payload: { tenantId, nome: `Pessoa ${apelido}`, email, senha: SENHA, nivel } });
    assert.equal(r.statusCode, 201, r.body);
    const login = await app.inject({ method: 'POST', url: '/v1/sessao', payload: { email, senha: SENHA } });
    const bruto = login.headers['set-cookie'];
    return (Array.isArray(bruto) ? bruto[0]! : String(bruto)).split(';')[0]!;
  }
  async function criarLoja(nome: string, conta: object) {
    const r = await app.inject({ method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN }, payload: { ...conta, loja: { nome }, setores: [{ nome: 'Cozinha' }] } });
    assert.equal(r.statusCode, 201, r.body);
    return { tenantId: r.json().tenantId as string, lojaId: r.json().loja.id as string };
  }

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    falso = await subirRegemFalso();
    cfg = { apiUrl: falso.url, appUrl: 'https://regem.exemplo', retornoUrl: RETORNO, consoleUrl: CONSOLE, segredo: falso.segredo, chave: randomBytes(32), buscar: fetch, prazoMs: 400, agente: 'farol-api/teste (+https://monitorfarol.com.br)' };
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
    await pool.query('delete from acesso_externo where tenant_id = any($1::uuid[])', [contas()]);
    await pool.query('delete from regem_loja where tenant_id = any($1::uuid[])', [contas()]);
    await pool.query('delete from regem_pedido where tenant_id = any($1::uuid[])', [contas()]);
  });

  // ───────────────────────── os atalhos ─────────────────────────

  const listar = (cookie: string) => app.inject({ method: 'GET', url: '/v1/acessos', headers: { cookie } });
  const criar = (cookie: string, corpo: unknown) => app.inject({ method: 'POST', url: '/v1/acessos', headers: { cookie }, payload: corpo as object });
  const revogar = (cookie: string, id: string) => app.inject({ method: 'DELETE', url: `/v1/acessos/${id}`, headers: { cookie } });
  const enviar = (codigo: string | null, corpo: unknown, a: FastifyInstance = app) =>
    a.inject({ method: 'PUT', url: '/v1/integracao/fichas', headers: codigo === null ? {} : { authorization: `Bearer ${codigo}` }, payload: corpo as object });
  const oQueTem = (codigo: string) => app.inject({ method: 'GET', url: '/v1/integracao/fichas', headers: { authorization: `Bearer ${codigo}` } });
  const fichas = (cookie: string, lojaId: string) => app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}/fichas`, headers: { cookie } });
  const importar = (cookie: string, lojaId: string, corpo: object) => app.inject({ method: 'POST', url: `/v1/lojas/${lojaId}/fichas/importar`, headers: { cookie }, payload: corpo });
  type Guardada = { fonte: string; produtos: number; com_ficha: number; impressao: string; atualizada_em: Date; importacao: Record<string, unknown> | null };
  const baseDe = async (lojaId: string) =>
    (await pool.query<Guardada>('select fonte, produtos, com_ficha, impressao, atualizada_em, importacao from fichas_da_loja where loja_id = $1', [lojaId])).rows[0] ?? null;
  const versaoDe = async (lojaId: string) => (await pool.query<{ v: number }>('select config_versao as v from loja where id = $1', [lojaId])).rows[0]!.v;
  /** Cria o acesso de uma loja e devolve o id e o código. */
  async function acessoDe(lojaId: string, nome = 'PDV da Casa', cookie = minha.dono) {
    const r = await criar(cookie, { nome, lojaId });
    assert.equal(r.statusCode, 201, r.body);
    return r.json() as { id: string; codigo: string; temPlanilha: boolean };
  }
  /** Pede a conexão ao Regem (de mentira) e devolve a linha que espera ser ligada. */
  async function autorizarNoRegem(nome: string) {
    const ida = await app.inject({ method: 'POST', url: '/v1/regem/conectar', headers: { cookie: minha.dono } });
    const url = new URL(ida.json().url);
    const code = falso.autorizar({ lojas: [{ id: randomUUID(), nome }], desafio: url.searchParams.get('code_challenge')!, redirectUri: RETORNO });
    await app.inject({ method: 'GET', url: `/v1/regem/retorno?${new URLSearchParams({ code, state: url.searchParams.get('state')! })}`, headers: { cookie: minha.dono } });
    const c = (await app.inject({ method: 'GET', url: '/v1/regem', headers: { cookie: minha.dono } })).json();
    return { conexoes: c, esperando: c.esperando.find((e: { regemLojaNome: string }) => e.regemLojaNome === nome) as { id: string } };
  }
  const ligar = (id: string, lojaId: string) => app.inject({ method: 'PUT', url: '/v1/regem/lojas', headers: { cookie: minha.dono }, payload: { pares: [{ id, lojaId }] } });

  // ───────────────────────── quem pode ─────────────────────────

  it('sem sessão, 401; só a diretoria cria e revoga; quem configura vê a lista; a supervisão e a execução não veem', async () => {
    const { id } = await acessoDe(minha.centro);
    const rotas: Array<['GET' | 'POST' | 'DELETE', string, object | undefined]> = [['GET', '/v1/acessos', undefined], ['POST', '/v1/acessos', { nome: 'Outro', lojaId: minha.barra }], ['DELETE', `/v1/acessos/${id}`, undefined]];
    for (const [method, url, payload] of rotas) {
      const semSessao = await app.inject({ method, url, payload });
      assert.deepEqual([semSessao.statusCode, semSessao.json().erro], [401, 'sem_sessao'], url);
    }
    // ver: quem configura
    for (const cookie of [minha.supervisao, minha.execucao]) {
      const r = await listar(cookie);
      assert.deepEqual([r.statusCode, r.json()], [403, { erro: 'sem_permissao', mensagem: 'seu perfil não vê as conexões da conta' }]);
    }
    assert.deepEqual((await Promise.all([minha.dono, minha.gerente, minha.suporte].map(async (c) => (await listar(c)).json()))).map((t) => [t.podeCriar, t.acessos.length]), [[true, 1], [false, 1], [false, 1]]);
    // criar e revogar: só a diretoria — nem o suporte
    for (const cookie of [minha.gerente, minha.suporte, minha.supervisao, minha.execucao]) {
      for (const r of [await criar(cookie, { nome: 'Outro', lojaId: minha.barra }), await revogar(cookie, id)]) {
        assert.deepEqual([r.statusCode, r.json().erro], [403, 'so_diretoria']);
      }
    }
    const depois = (await listar(minha.dono)).json();
    assert.deepEqual(depois.acessos.map((a: { id: string }) => a.id), [id], 'ninguém sem permissão criou nem revogou');
  });

  it('a loja e o acesso do vizinho não existem para mim: 404, e nada dele muda', async () => {
    const dele = await acessoDe(vizinha.loja, 'PDV do Vizinho', vizinha.dono);
    assert.deepEqual([(await criar(minha.dono, { nome: 'Meu', lojaId: vizinha.loja })).statusCode, (await criar(minha.dono, { nome: 'Meu', lojaId: vizinha.loja })).json().erro], [404, 'loja_nao_encontrada']);
    assert.equal((await criar(minha.dono, { nome: 'Meu', lojaId: randomUUID() })).statusCode, 404);
    assert.deepEqual([(await revogar(minha.dono, dele.id)).statusCode, (await revogar(minha.dono, dele.id)).json().erro], [404, 'nao_encontrado']);
    assert.equal((await revogar(minha.dono, randomUUID())).statusCode, 404);
    assert.equal((await revogar(minha.dono, 'x')).statusCode, 422);
    const minhaLista = (await listar(minha.dono)).json();
    assert.deepEqual([minhaLista.acessos, minhaLista.lojas.map((l: { nome: string }) => l.nome)], [[], ['Loja Barra', 'Loja Centro']], 'a minha lista não traz acesso nem loja dele');
    assert.equal((await oQueTem(dele.codigo)).statusCode, 200, 'o acesso dele continua valendo');
  });

  // ───────────────────────── criar: o código aparece uma vez ─────────────────────────

  it('criar devolve o código UMA vez — e ele não fica no banco, na lista nem no registro do servidor', async () => {
    const r = await criar(minha.dono, { nome: '  PDV   da  Casa ', lojaId: minha.centro.toUpperCase() });
    assert.equal(r.statusCode, 201, r.body);
    const c = r.json();
    assert.deepEqual(Object.keys(c).sort(), ['codigo', 'criadoEm', 'id', 'lojaId', 'lojaNome', 'nome', 'temPlanilha']);
    assert.deepEqual([c.nome, c.lojaId, c.lojaNome, c.temPlanilha], ['PDV da Casa', minha.centro, 'Loja Centro', false], 'o nome sem espaço sobrando');
    assert.match(c.codigo, /^dms_ap_farol_[A-Za-z0-9_-]{43}_[A-Za-z0-9_-]{6}$/, 'o código novo segue o Padrão DMS, com dígitos de conferência');
    assert.equal(r.headers['cache-control'], 'no-store');

    // no banco: só a impressão
    const linha = (await pool.query('select * from acesso_externo where id = $1', [c.id])).rows[0];
    assert.equal(linha.token_hash, createHash('sha256').update(c.codigo, 'utf8').digest('hex'));
    assert.ok(!JSON.stringify(linha).includes(c.codigo) && !JSON.stringify(linha).includes(c.codigo.slice(6)), 'o código não está em coluna nenhuma');
    assert.deepEqual([linha.tenant_id, linha.loja_id, linha.revogado_em, linha.recebido_em], [minha.tenantId, minha.centro, null, null]);
    assert.ok(linha.criado_por, 'quem criou fica registrado');

    // na lista: sem código e sem impressão
    const lista = (await listar(minha.gerente)).json();
    assert.deepEqual(Object.keys(lista).sort(), ['acessos', 'lojas', 'podeCriar']);
    assert.deepEqual(Object.keys(lista.acessos[0]).sort(), ['comFicha', 'criadoEm', 'fuso', 'id', 'lojaId', 'lojaNome', 'nome', 'produtos', 'recebidoEm']);
    assert.deepEqual([lista.acessos[0].nome, lista.acessos[0].lojaNome, lista.acessos[0].recebidoEm, lista.acessos[0].produtos], ['PDV da Casa', 'Loja Centro', null, null]);
    assert.ok(!JSON.stringify(lista).includes(c.codigo.slice(6)) && !JSON.stringify(lista).includes(linha.token_hash));
    assert.deepEqual(lista.lojas, [{ id: minha.barra, nome: 'Loja Barra', origem: 'livre' }, { id: minha.centro, nome: 'Loja Centro', origem: 'sistema' }]);

    // no registro do servidor: o acesso foi criado, e o código não aparece
    assert.ok(registro.some((l) => l.includes('porta: acesso criado')));
    assert.ok(!registro.join('\n').includes(c.codigo.slice(6)), 'o código foi para o registro');
  });

  it('o nome do sistema é obrigatório, cabe em 40 letras e não leva caractere de controle; a loja tem de ser escolhida', async () => {
    const semControle = await criar(minha.dono, { nome: `PDV${String.fromCharCode(7)} da${String.fromCharCode(10)}Casa${String.fromCharCode(127)}`, lojaId: minha.centro });
    assert.deepEqual([semControle.statusCode, semControle.json().nome], [201, 'PDV daCasa']);
    assert.equal((await criar(minha.dono, { nome: 'x'.repeat(40), lojaId: minha.barra })).statusCode, 201, 'quarenta letras cabem');
    await pool.query('delete from acesso_externo where tenant_id = $1', [minha.tenantId]);
    for (const nome of ['', '   ', 'x'.repeat(41), 7, null, undefined, ['PDV'], String.fromCharCode(9, 10)]) {
      const r = await criar(minha.dono, { nome, lojaId: minha.centro });
      assert.deepEqual([r.statusCode, r.json()], [422, { erro: 'validacao', mensagem: 'diga o nome do sistema, com até 40 letras' }], JSON.stringify(nome));
    }
    for (const lojaId of ['', 'x', 7, null, undefined]) {
      const r = await criar(minha.dono, { nome: 'PDV', lojaId });
      assert.deepEqual([r.statusCode, r.json()], [422, { erro: 'validacao', mensagem: 'escolha a loja que vai receber' }], JSON.stringify(lojaId));
    }
    assert.equal((await criar(minha.dono, null)).statusCode, 422);
    assert.equal((await listar(minha.dono)).json().acessos.length, 0, 'nenhum pedido torto criou acesso');
  });

  it('uma loja tem um acesso valendo: o segundo é recusado, com o nome do que existe; depois de revogar, cria outro — com outro código', async () => {
    const primeiro = await acessoDe(minha.centro, 'PDV da Casa');
    const segundo = await criar(minha.dono, { nome: 'Outro PDV', lojaId: minha.centro });
    assert.deepEqual([segundo.statusCode, segundo.json().erro], [409, 'ja_tem_acesso']);
    assert.match(segundo.json().mensagem, /já tem um acesso \(PDV da Casa\)/);
    assert.ok(!('codigo' in segundo.json()));
    assert.equal((await criar(minha.dono, { nome: 'Outro PDV', lojaId: minha.barra })).statusCode, 201, 'a outra loja é outra conversa');

    assert.equal((await revogar(minha.dono, primeiro.id)).statusCode, 200);
    const novo = await acessoDe(minha.centro, 'Outro PDV');
    assert.notEqual(novo.codigo, primeiro.codigo);
    assert.deepEqual([(await oQueTem(novo.codigo)).statusCode, (await oQueTem(primeiro.codigo)).statusCode], [200, 401]);
  });

  // ───────────────────────── a porta: a credencial ─────────────────────────

  it('na porta só entra o código de acesso: sem ele, com outro esquema, com um código que não existe ou com a sessão do console, é 401', async () => {
    const { codigo } = await acessoDe(minha.centro);
    const tentar = async (headers: Record<string, string>) => {
      const r = [await app.inject({ method: 'PUT', url: '/v1/integracao/fichas', headers, payload: PEQUENO }), await app.inject({ method: 'GET', url: '/v1/integracao/fichas', headers })];
      assert.deepEqual(semRastreio(r[0]!.json()), semRastreio(r[1]!.json()), 'as duas rotas da porta respondem igual');
      return [r[0]!.statusCode, r[1]!.statusCode, r[0]!.json().erro];
    };
    assert.deepEqual(await tentar({}), [401, 401, 'sem_credencial']);
    assert.deepEqual(await tentar({ cookie: minha.dono }), [401, 401, 'sem_credencial'], 'a sessão do console não é credencial da porta');
    assert.deepEqual(await tentar({ authorization: `Basic ${codigo}` }), [401, 401, 'sem_credencial']);
    assert.deepEqual(await tentar({ authorization: 'Bearer ' }), [401, 401, 'sem_credencial']);
    assert.deepEqual(await tentar({ authorization: `Bearer ${codigo}x` }), [401, 401, 'credencial_invalida']);
    assert.deepEqual(await tentar({ authorization: `Bearer ${codigo.slice(0, -1)}` }), [401, 401, 'credencial_invalida']);
    assert.deepEqual(await tentar({ authorization: `Bearer farol_${randomBytes(32).toString('base64url')}` }), [401, 401, 'credencial_invalida']);
    assert.equal(await baseDe(minha.centro), null, 'nenhuma tentativa gravou nada');
    assert.deepEqual([(await enviar(codigo, PEQUENO)).statusCode, (await app.inject({ method: 'PUT', url: '/v1/integracao/fichas', headers: { authorization: `bearer ${codigo}` }, payload: PEQUENO })).statusCode], [200, 200], 'com o código, entra (o nome do esquema em qualquer caixa)');
  });

  // ───────────────────────── a porta: o Padrão DMS ─────────────────────────

  it('o erro da porta sai no Padrão DMS (problem+json) com o erro do Farol junto — e o código revogado responde IGUAL ao que nunca existiu', async () => {
    const sem = await enviar(null, PEQUENO);
    const j = sem.json();
    assert.equal(sem.statusCode, 401);
    assert.equal(sem.headers['content-type'], 'application/problem+json; charset=utf-8');
    assert.equal(sem.headers['www-authenticate'], 'Bearer');
    assert.deepEqual(Object.keys(j).sort(), ['detail', 'erro', 'mensagem', 'request_id', 'status', 'title', 'type']);
    assert.deepEqual([j.type, j.title, j.status, j.erro, j.detail], [`${BASE_ERROS}token-invalido`, 'Token inválido', 401, 'sem_credencial', j.mensagem]);
    assert.ok(typeof j.request_id === 'string' && j.request_id.length > 0, 'o código de rastreio vai junto');

    const nunca = await oQueTem(gerarChave('ap', 'farol').chave);
    assert.equal(nunca.headers['www-authenticate'], 'Bearer error="invalid_token"');
    assert.deepEqual([nunca.statusCode, nunca.json().type, nunca.json().erro, nunca.json().mensagem], [401, `${BASE_ERROS}token-invalido`, 'credencial_invalida', CODIGO_QUE_NAO_VALE]);
    const antigoQueNunca = await oQueTem(`farol_${randomBytes(32).toString('base64url')}`);

    const { id, codigo } = await acessoDe(minha.centro);
    assert.equal((await revogar(minha.dono, id)).statusCode, 200);
    for (const r of [await oQueTem(codigo), await enviar(codigo, PEQUENO), antigoQueNunca]) {
      assert.deepEqual([r.statusCode, r.headers['content-type'], r.headers['www-authenticate'], semRastreio(r.json())], [401, nunca.headers['content-type'], nunca.headers['www-authenticate'], semRastreio(nunca.json())], 'o revogado não conta que existiu');
    }
  });

  it('o código de antes do Padrão (farol_…) continua valendo; o de outro produto, de outro tipo ou torto não entra — nem se estivesse no banco', async () => {
    const { id } = await acessoDe(minha.centro);
    const trocar = (codigo: string) => pool.query('update acesso_externo set token_hash = $2 where id = $1', [id, createHash('sha256').update(codigo, 'utf8').digest('hex')]);

    const antigo = `farol_${randomBytes(32).toString('base64url')}`;
    await trocar(antigo);
    assert.deepEqual([(await oQueTem(antigo)).statusCode, (await enviar(antigo, PEQUENO)).statusCode], [200, 200], 'o código antigo segue entrando');

    // A conferência do formato vem antes do banco: o que não é código do Farol não entra nem com a linha certa lá.
    const naoServem = [gerarChave('ap', 'liame').chave, gerarChave('lg', 'farol').chave, `farol_${'a'.repeat(42)}`, `farol_${'a'.repeat(44)}`, `xfarol_${'a'.repeat(43)}`, 'abc'];
    for (const codigo of naoServem) {
      await trocar(codigo);
      const r = await oQueTem(codigo);
      assert.deepEqual([r.statusCode, r.json().erro], [401, 'credencial_invalida'], codigo.slice(0, 14));
    }
    const novo = gerarChave('ap', 'farol').chave;
    await trocar(novo);
    assert.equal((await oQueTem(novo)).statusCode, 200, 'e o código no formato novo entra');
  });

  it('só validar confere tudo e responde o que entraria — sem gravar a base, a data do último envio nem a versão que faz o agente baixar', async () => {
    const { id, codigo } = await acessoDe(minha.centro);
    const validar = (corpo: unknown, valor = 'true') => app.inject({ method: 'PUT', url: `/v1/integracao/fichas?somente_validar=${valor}`, headers: { authorization: `Bearer ${codigo}` }, payload: corpo as object });
    const recebido = async () => (await pool.query<{ r: Date | null }>('select recebido_em as r from acesso_externo where id = $1', [id])).rows[0]!.r;

    // na loja sem base: não cria
    const primeiro = await validar(PEQUENO);
    assert.deepEqual([primeiro.statusCode, primeiro.json()], [200, { resultado: 'so_validado', gravado: false, produtos: 2, comFicha: 1, semFicha: ['Água sem gás'], deFora: [], soltos: [], problemas: 0 }]);
    assert.deepEqual([await baseDe(minha.centro), await recebido()], [null, null]);

    // na loja com base: não troca
    await enviar(codigo, PEQUENO);
    await pool.query(`update acesso_externo set recebido_em = now() - interval '1 hour' where id = $1`, [id]);
    const antes = (await baseDe(minha.centro))!;
    const [versao, quando] = [await versaoDe(minha.centro), await recebido()];
    const r = await validar(COM_PROBLEMA);
    const fora = [{ produto: 'X-Burger', problemas: [{ onde: 'produtos[1].ingredientes[1]', texto: 'falta a quantidade.' }] }];
    assert.deepEqual([r.statusCode, r.json()], [200, { resultado: 'so_validado', gravado: false, produtos: 2, comFicha: 1, semFicha: ['Água sem gás'], deFora: fora, soltos: [], problemas: 1 }]);
    const depois = (await baseDe(minha.centro))!;
    assert.deepEqual([depois.impressao, depois.atualizada_em.getTime(), depois.importacao, await versaoDe(minha.centro), (await recebido())!.getTime()], [antes.impressao, antes.atualizada_em.getTime(), antes.importacao, versao, quando!.getTime()]);

    // o que o envio recusa, a conferência recusa igual
    assert.deepEqual([(await validar({ produtos: [] })).statusCode, (await validar({ produtos: [] })).json().erro], [422, 'envio_invalido']);
    assert.deepEqual([(await validar({ produtos: [{ nome: 'A', ingredientes: [ing('x', '', 'g')] }] })).statusCode, (await validar({ produtos: [{ nome: 'A', ingredientes: [ing('x', '', 'g')] }] })).json().erro], [422, 'nada_a_receber']);

    // valor que não é true nem false: recusa, e NÃO grava (quem escreveu "1" queria conferir)
    for (const valor of ['1', 'TRUE', 'sim', '', 'true&somente_validar=true']) {
      const torto = await validar(COM_PROBLEMA, valor);
      assert.deepEqual([torto.statusCode, torto.json().type, torto.json().erro], [400, `${BASE_ERROS}parametro-invalido`, 'parametro_invalido'], valor);
    }
    assert.equal((await baseDe(minha.centro))!.impressao, antes.impressao, 'nenhum valor torto gravou');

    // false = o envio de sempre
    // (o COM_PROBLEMA sem o X-Burger é o PEQUENO: aqui vai um envio que muda de fato)
    const grava = await validar({ produtos: [{ nome: 'Batata frita', ingredientes: [ing('Batata palito', 250)] }] }, 'false');
    assert.deepEqual([grava.statusCode, grava.json().resultado, (await baseDe(minha.centro))!.impressao !== antes.impressao], [200, 'atualizada', true]);
  });

  it('o limite por acesso: a 61ª consulta e o 13º envio param em 429 com Retry-After; a conferência tem cota própria; a outra loja segue', async () => {
    const { codigo } = await acessoDe(minha.centro);
    const daBarra = await acessoDe(minha.barra, 'PDV da Barra');
    // Uma API nova: as cotas são do processo, e começam do zero.
    const outro = criarApp(pool, { logger: false, regem: cfg });
    await outro.ready();
    const ler = (c: string) => outro.inject({ method: 'GET', url: '/v1/integracao/fichas', headers: { authorization: `Bearer ${c}` } });
    const mandar = (corpo: unknown, consulta = '') => outro.inject({ method: 'PUT', url: `/v1/integracao/fichas${consulta}`, headers: { authorization: `Bearer ${codigo}` }, payload: corpo as object });
    try {
      for (let n = 1; n <= 60; n += 1) assert.equal((await ler(codigo)).statusCode, 200, `consulta ${n}`);
      recusou(await ler(codigo), /até 60 consultas por minuto por acesso/, 60);

      // os envios têm outra cota: um corpo torto conta, e é recusado sem gravar
      for (let n = 1; n <= 12; n += 1) assert.equal((await mandar({})).statusCode, 422, `envio ${n}`);
      recusou(await mandar(PEQUENO), /até 12 envios por hora por acesso/, 3600);
      assert.equal(await baseDe(minha.centro), null, 'o envio recusado pelo limite não gravou');

      // a conferência tem a dela: segue depois de acabarem os envios
      for (let n = 1; n <= 60; n += 1) assert.equal((await mandar({}, '?somente_validar=true')).statusCode, 422, `conferência ${n}`);
      recusou(await mandar(PEQUENO, '?somente_validar=true'), /até 60 conferências por hora por acesso/, 3600);

      // e a outra loja da conta não sentiu nada
      assert.equal((await ler(daBarra.codigo)).statusCode, 200);
    } finally {
      await outro.close();
    }
  });

  it('o limite da conta soma os acessos de todas as lojas — e o acesso preso no 429 não gasta a cota das outras lojas', async () => {
    const conta = await criarLoja('Loja L1', { tenant: { nome: `${marca}-limite` } });
    const lojas = [conta.lojaId];
    for (let n = 2; n <= 6; n += 1) lojas.push((await criarLoja(`Loja L${n}`, { tenantId: conta.tenantId })).lojaId);
    const dono = await criarUsuario(conta.tenantId, 'dono-limite', 'presidente');
    const [a, b, c, d, e, f] = await Promise.all(lojas.map(async (l, i) => (await acessoDe(l, `PDV ${i + 1}`, dono)).codigo));
    const outro = criarApp(pool, { logger: false, regem: cfg });
    await outro.ready();
    const ler = (c: string) => outro.inject({ method: 'GET', url: '/v1/integracao/fichas', headers: { authorization: `Bearer ${c}` } });
    const mandar = (c: string, consulta = '') => outro.inject({ method: 'PUT', url: `/v1/integracao/fichas${consulta}`, headers: { authorization: `Bearer ${c}` }, payload: {} });
    const vezes = async (quantas: number, chamar: () => Promise<{ statusCode: number }>) => {
      const vistos: number[] = [];
      for (let n = 0; n < quantas; n += 1) vistos.push((await chamar()).statusCode);
      return [...new Set(vistos)];
    };
    try {
      // consultas: o A esgota a dele e insiste; B, C e D usam a cota inteira; o E já encontra a conta cheia
      assert.deepEqual(await vezes(60, () => ler(a!)), [200]);
      assert.deepEqual(await vezes(30, () => ler(a!)), [429]);
      for (const codigo of [b!, c!, d!]) assert.deepEqual(await vezes(60, () => ler(codigo)), [200], 'a insistência do A não gastou a cota da conta');
      recusou(await ler(e!), /até 240 consultas por minuto somando os acessos da conta/, 60);

      // envios: o mesmo, com 12 por acesso e 60 na conta
      assert.deepEqual(await vezes(12, () => mandar(a!)), [422]);
      assert.deepEqual(await vezes(5, () => mandar(a!)), [429]);
      for (const codigo of [b!, c!, d!, e!]) assert.deepEqual(await vezes(12, () => mandar(codigo)), [422], 'a insistência do A não gastou a cota da conta');
      recusou(await mandar(f!), /até 60 envios por hora somando os acessos da conta/, 3600);

      // a conferência não tem cota da conta
      assert.equal((await mandar(f!, '?somente_validar=true')).statusCode, 422);
      // e a outra conta não sentiu nada
      assert.equal((await ler((await acessoDe(minha.centro)).codigo)).statusCode, 200);
    } finally {
      await outro.close();
      await pool.query('delete from acesso_externo where tenant_id = $1', [conta.tenantId]);
    }
  });

  it('o kit de testes do Padrão DMS passa na porta — menos a validade e a suspensão do código, que são a parte 2', async () => {
    const valida = await acessoDe(minha.centro);
    const revogada = await acessoDe(minha.barra, 'PDV antigo');
    assert.equal((await revogar(minha.dono, revogada.id)).statusCode, 200);
    const doVizinho = await acessoDe(vizinha.loja, 'PDV do Vizinho', vizinha.dono);
    const outro = criarApp(pool, { logger: false, regem: cfg });
    const base = await outro.listen({ port: 0, host: '127.0.0.1' });
    try {
      const resultados = await rodarKit(
        {
          produto: 'farol',
          base,
          leitura: { caminho: '/v1/integracao/fichas', lista: false },
          escrita: { caminho: '/v1/integracao/fichas', metodo: 'PUT', modo: 'substituicao', corpo: PEQUENO, corpoDiferente: COM_PROBLEMA },
          limite: { chamadas: LIMITE_DE_CONSULTAS_POR_MINUTO + 1 },
          copiaDoPacote: fileURLToPath(new URL('../src/dms/integracao-dms.ts', import.meta.url)),
          credenciais: { valida: 'X', outraEmpresa: 'X', revogada: 'X' },
        },
        { valida: valida.codigo, outraEmpresa: doVizinho.codigo, revogada: revogada.codigo },
      );
      const falhas = resultados.filter((r) => !r.ok).map((r) => r.nome);
      assert.deepEqual(falhas, ['vencida', 'suspensa'], resultados.map((r) => `${r.ok ? (r.pulado ? '·' : '✓') : '✗'} ${r.nome}: ${r.detalhe}`).join('\n'));
      assert.deepEqual(resultados.filter((r) => r.pulado).map((r) => r.nome).sort(), ['cursor-de-outra-empresa', 'cursor-invalido', 'escrita-sem-idempotencia', 'idempotencia-outro-corpo', 'mesma-empresa-ve', 'outra-empresa-nao-ve', 'sem-permissao'], 'só pula o que a porta não tem');
    } finally {
      await outro.close();
    }
  });

  // ───────────────────────── a porta: o envio ─────────────────────────

  it('o envio certo troca a base da loja DO ACESSO, a tela Fichas mostra a origem, e o agente da loja fica sabendo', async () => {
    const { id, codigo } = await acessoDe(minha.centro);
    const versao = await versaoDe(minha.centro);
    const antes = (await oQueTem(codigo)).json();
    assert.deepEqual(antes, { sistema: 'PDV da Casa', loja: 'Loja Centro', recebidoEm: null, produtos: null, comFicha: null });

    // o corpo tenta escolher outra loja e outra conta: não escolhe
    const r = await enviar(codigo, { ...PEQUENO, lojaId: vizinha.loja, loja_id: vizinha.loja, tenantId: vizinha.tenantId, loja: vizinha.loja });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json(), { resultado: 'atualizada', produtos: 2, comFicha: 1, semFicha: ['Água sem gás'], deFora: [], soltos: [], problemas: 0 });
    assert.equal(await baseDe(vizinha.loja), null, 'nada foi para a loja do vizinho');
    assert.equal(await baseDe(minha.barra), null, 'nem para a outra loja da conta');

    const g = (await baseDe(minha.centro))!;
    assert.deepEqual([g.fonte, g.produtos, g.com_ficha], ['sistema', 2, 1]);
    assert.deepEqual([g.importacao!.arquivo, g.importacao!.por, g.importacao!.problemas], ['', { id, nome: 'PDV da Casa' }, 0]);
    assert.ok(await versaoDe(minha.centro) > versao, 'a base nova sobe a versão da configuração: é o que faz o agente da loja baixar');

    const t = (await fichas(minha.supervisao, minha.centro)).json();
    assert.deepEqual([t.situacao, t.fonte, t.totais, t.podeImportar, t.leitura], ['sem_conexao', 'sistema', { produtos: 2, comFicha: 1 }, false, null]);
    assert.deepEqual(Object.keys(t.sistema).sort(), ['criadoEm', 'nome', 'recebidoEm']);
    assert.equal(t.sistema.nome, 'PDV da Casa');
    assert.ok(Date.now() - Date.parse(t.sistema.recebidoEm) < 15_000);
    assert.deepEqual(t.produtos.map((p: { nome: string; ingredientes: number | null }) => [p.nome, p.ingredientes]), [['Batata frita', 2], ['Água sem gás', null]]);
    assert.equal((await fichas(minha.gerente, minha.centro)).json().podeImportar, false, 'quem configura também não importa planilha nesta loja');

    const depois = (await oQueTem(codigo)).json();
    assert.deepEqual([depois.produtos, depois.comFicha], [2, 1]);
    assert.ok(Date.now() - Date.parse(depois.recebidoEm) < 15_000);
    const naLista = (await listar(minha.dono)).json().acessos[0];
    assert.deepEqual([naLista.produtos, naLista.comFicha, naLista.recebidoEm !== null], [2, 1, true]);
    assert.ok(registro.some((l) => l.includes('porta: fichas recebidas')));
    assert.ok(!registro.join('\n').includes(codigo.slice(6)), 'o código foi para o registro');
  });

  it('o mesmo envio de novo não muda nada: a data da base não anda e o agente não baixa de novo — mas o Farol anota que recebeu', async () => {
    const { id, codigo } = await acessoDe(minha.centro);
    await enviar(codigo, PEQUENO);
    const antes = (await baseDe(minha.centro))!;
    const versao = await versaoDe(minha.centro);
    await pool.query(`update acesso_externo set recebido_em = now() - interval '1 hour' where id = $1`, [id]);

    const r = await enviar(codigo, PEQUENO);
    assert.deepEqual([r.statusCode, r.json().resultado], [200, 'nada_mudou']);
    const depois = (await baseDe(minha.centro))!;
    assert.deepEqual([depois.impressao, depois.atualizada_em.getTime()], [antes.impressao, antes.atualizada_em.getTime()]);
    assert.equal(await versaoDe(minha.centro), versao);
    assert.ok(Date.now() - Date.parse((await oQueTem(codigo)).json().recebidoEm) < 15_000, 'o último envio aceito é o de agora');

    // mudou um ingrediente: aí muda
    const outro = await enviar(codigo, { produtos: [{ nome: 'Batata frita', ingredientes: [ing('Batata palito', 250), ing('Sal', 1, 'pitada')] }, PEQUENO.produtos[1]] });
    assert.equal(outro.json().resultado, 'atualizada');
    assert.ok(await versaoDe(minha.centro) > versao);
    const guardado = (await pool.query('select conteudo from fichas_da_loja where loja_id = $1', [minha.centro])).rows[0].conteudo;
    assert.equal(guardado.produtos[0].ficha.ingredientes[0].quantidade, 250, 'o documento guardado é o do envio novo');
  });

  it('o conteúdo errado deixa aquele produto de fora, os outros entram, e a lista fica guardada — para a resposta e para a tela', async () => {
    const { codigo } = await acessoDe(minha.centro);
    const r = await enviar(codigo, COM_PROBLEMA);
    assert.equal(r.statusCode, 200, r.body);
    const fora = [{ produto: 'X-Burger', problemas: [{ onde: 'produtos[1].ingredientes[1]', texto: 'falta a quantidade.' }] }];
    assert.deepEqual(r.json(), { resultado: 'atualizada', produtos: 2, comFicha: 1, semFicha: ['Água sem gás'], deFora: fora, soltos: [], problemas: 1 });

    const t = (await fichas(minha.supervisao, minha.centro)).json();
    assert.deepEqual(t.produtos.map((p: { nome: string }) => p.nome), ['Batata frita', 'Água sem gás']);
    assert.deepEqual([t.importacao.arquivo, t.importacao.por, t.importacao.deFora, t.importacao.quais, t.importacao.problemas], ['', 'PDV da Casa', 1, ['X-Burger'], 1]);

    const i = await app.inject({ method: 'GET', url: `/v1/lojas/${minha.centro}/fichas/importacao`, headers: { cookie: minha.gerente } });
    assert.equal(i.statusCode, 200);
    assert.deepEqual([i.json().origem, i.json().por, i.json().deFora, i.json().problemas], ['sistema', 'PDV da Casa', fora, 1]);
    // a base de outro sistema não se baixa em planilha
    assert.equal((await app.inject({ method: 'GET', url: `/v1/lojas/${minha.centro}/fichas/planilha`, headers: { cookie: minha.gerente } })).statusCode, 404);
  });

  it('nenhum produto certo, ou a forma errada: nada é recebido, e as fichas de antes ficam', async () => {
    const { codigo } = await acessoDe(minha.centro);
    await enviar(codigo, PEQUENO);
    const antes = (await baseDe(minha.centro))!;
    const versao = await versaoDe(minha.centro);

    const nada = await enviar(codigo, { produtos: [{ nome: 'A', ingredientes: [ing('x', '', 'g')] }, { nome: 'B', ingredientes: [ing('y', 1, 'pct')] }] });
    assert.deepEqual([nada.statusCode, nada.json().erro, nada.json().produtos, nada.json().problemas, nada.json().deFora.map((d: { produto: string }) => d.produto)], [422, 'nada_a_receber', 0, 2, ['A', 'B']]);
    assert.match(nada.json().mensagem, /nenhum produto do envio está certo, e nada foi recebido/);

    const formas: Array<[unknown, string]> = [
      [{}, 'produtos: falta a lista de produtos'],
      [{ produtos: [] }, 'produtos: a lista está vazia'],
      [[PEQUENO], 'o envio era para ser um objeto com a lista “produtos”'],
      [{ produtos: [PEQUENO.produtos[0], { nome: 'Suco', cozinha: 'sim' }] }, 'produtos[1].cozinha: era para ser verdadeiro ou falso (true ou false)'],
    ];
    for (const [corpo, motivo] of formas) {
      const r = await enviar(codigo, corpo);
      const j = r.json();
      assert.deepEqual([r.statusCode, j.erro, j.mensagem, j.detail, j.type], [422, 'envio_invalido', motivo, motivo, `${BASE_ERROS}regra-invalida`]);
    }
    // o que não é JSON nem chega a ser lido
    const texto = await app.inject({ method: 'PUT', url: '/v1/integracao/fichas', headers: { authorization: `Bearer ${codigo}`, 'content-type': 'application/json' }, payload: '{"produtos": [' });
    assert.ok(texto.statusCode >= 400 && texto.statusCode < 500, String(texto.statusCode));
    assert.equal(typeof texto.json().erro, 'string');

    const depois = (await baseDe(minha.centro))!;
    assert.deepEqual([depois.impressao, depois.atualizada_em.getTime(), depois.importacao], [antes.impressao, antes.atualizada_em.getTime(), antes.importacao]);
    assert.equal(await versaoDe(minha.centro), versao);
  });

  it('o envio tem tamanho máximo: acima de 8 MB é recusado sem ser lido', async () => {
    const { codigo } = await acessoDe(minha.centro);
    const grande = { produtos: [{ nome: 'A', observacao: 'x'.repeat(8 * 1024 * 1024) }] };
    const r = await enviar(codigo, grande);
    assert.equal(r.statusCode, 413);
    assert.equal(await baseDe(minha.centro), null);
    // um pouco abaixo passa pela porta (e o campo que não é do modelo é ignorado)
    const cabe = await enviar(codigo, { produtos: [{ nome: 'A', observacao: 'x'.repeat(7 * 1024 * 1024) }] });
    assert.equal(cabe.statusCode, 200, cabe.body.slice(0, 200));
    assert.ok(!JSON.stringify((await pool.query('select conteudo from fichas_da_loja where loja_id = $1', [minha.centro])).rows[0]).includes('xxxx'));
  });

  // ───────────────────────── revogar ─────────────────────────

  it('revogar vale na hora: o código para de entrar, as fichas que o sistema mandou são apagadas, e a linha fica como registro', async () => {
    const { id, codigo } = await acessoDe(minha.centro);
    await enviar(codigo, PEQUENO);
    const versao = await versaoDe(minha.centro);

    const r = await revogar(minha.dono, id);
    assert.deepEqual([r.statusCode, r.json()], [200, { revogado: true, fichasApagadas: true }]);
    assert.equal(await baseDe(minha.centro), null);
    assert.ok(await versaoDe(minha.centro) > versao, 'a base saiu: o agente da loja fica sabendo');

    for (const tentativa of [await enviar(codigo, PEQUENO), await oQueTem(codigo)]) {
      assert.deepEqual([tentativa.statusCode, tentativa.json().erro, tentativa.json().mensagem], [401, 'credencial_invalida', CODIGO_QUE_NAO_VALE]);
    }
    assert.equal(await baseDe(minha.centro), null, 'o envio com o código revogado não gravou');

    const linha = (await pool.query('select revogado_em, revogado_por, token_hash from acesso_externo where id = $1', [id])).rows[0];
    assert.ok(linha.revogado_em && linha.revogado_por && linha.token_hash, 'quem revogou e quando ficam registrados');
    assert.deepEqual([(await revogar(minha.dono, id)).statusCode, (await listar(minha.dono)).json().acessos], [404, []], 'revogado não se revoga de novo, e sai da lista');
    const t = (await fichas(minha.gerente, minha.centro)).json();
    assert.deepEqual([t.fonte, t.sistema, t.podeImportar], [null, null, true], 'a loja volta a poder importar planilha');
    assert.deepEqual((await listar(minha.dono)).json().lojas.map((l: { nome: string; origem: string }) => [l.nome, l.origem]), [['Loja Barra', 'livre'], ['Loja Centro', 'livre']], 'e volta a ser uma loja livre, que pode ganhar outro acesso');
    assert.ok(registro.some((l) => l.includes('porta: acesso revogado')));
  });

  it('revogar o acesso que ainda não enviou nada NÃO apaga as fichas de planilha: não foi ele que as mandou', async () => {
    assert.equal((await importar(minha.gerente, minha.centro, { arquivo: 'f.xlsx', abas: PLANILHA, gravar: true })).statusCode, 200);
    const { id, codigo, temPlanilha } = await acessoDe(minha.centro);
    assert.equal(temPlanilha, true, 'quem cria fica sabendo que a loja tem fichas de planilha');
    assert.equal((await listar(minha.dono)).json().acessos[0].produtos, null, 'os números do acesso são só do que ELE mandou');
    assert.deepEqual([(await oQueTem(codigo)).json().produtos, (await oQueTem(codigo)).json().comFicha], [null, null], 'e é o que a porta responde a ele');

    const r = await revogar(minha.dono, id);
    assert.deepEqual(r.json(), { revogado: true, fichasApagadas: false });
    assert.deepEqual([(await baseDe(minha.centro))!.fonte, (await baseDe(minha.centro))!.produtos], ['planilha', 1]);
  });

  it('o acesso revogado NO MEIO do envio não grava: quem decide é a mesma instrução que grava', async () => {
    const { id, codigo } = await acessoDe(minha.centro);
    // a revogação acontece depois de o código ser conferido e antes de a base ser gravada
    const naHora = new Proxy(pool, {
      get(alvo, nome, receptor) {
        if (nome !== 'query') return Reflect.get(alvo, nome, receptor);
        return async (texto: unknown, valores: unknown[]) => {
          if (typeof texto === 'string' && texto.includes("'sistema', $2::jsonb")) await alvo.query('update acesso_externo set revogado_em = now() where id = $1', [id]);
          return alvo.query(texto as string, valores);
        };
      },
    });
    const outro = criarApp(naHora as pg.Pool, { logger: false, regem: cfg });
    await outro.ready();
    try {
      const r = await enviar(codigo, PEQUENO, outro);
      assert.deepEqual([r.statusCode, r.json().erro], [401, 'credencial_invalida']);
      assert.equal(await baseDe(minha.centro), null);
      assert.equal((await pool.query('select recebido_em from acesso_externo where id = $1', [id])).rows[0].recebido_em, null, 'e não fica anotado como recebido');
    } finally {
      await outro.close();
    }
  });

  // ───────────────────────── uma loja, uma origem ─────────────────────────

  it('a loja ligada ao Regem não ganha acesso; a que tem acesso não é ligada ao Regem — e depois de revogar, é', async () => {
    // a Centro tem acesso; a Barra é ligada ao Regem
    const { id, codigo } = await acessoDe(minha.centro);
    const { conexoes, esperando } = await autorizarNoRegem('Barra de lá');
    assert.deepEqual(conexoes.lojasLivres.map((l: { nome: string }) => l.nome), ['Loja Barra'], 'a loja com acesso de outro sistema não é opção para ligar');

    const naCentro = await ligar(esperando.id, minha.centro);
    assert.deepEqual([naCentro.statusCode, naCentro.json().erro], [409, 'origem_ocupada']);
    assert.match(naCentro.json().mensagem, /^a Loja Centro recebe as fichas de outro sistema \(PDV da Casa\)\./);
    assert.equal((await pool.query('select count(*)::int as n from regem_loja where loja_id = $1', [minha.centro])).rows[0].n, 0, 'a loja não foi ligada');
    assert.equal((await enviar(codigo, PEQUENO)).statusCode, 200, 'e o sistema segue enviando');

    assert.equal((await ligar(esperando.id, minha.barra)).statusCode, 200);
    await semLeituraEmCurso();
    const naBarra = await criar(minha.dono, { nome: 'PDV', lojaId: minha.barra });
    assert.deepEqual([naBarra.statusCode, naBarra.json().erro], [409, 'origem_ocupada']);
    assert.match(naBarra.json().mensagem, /recebe as fichas do Regem/);
    assert.deepEqual((await listar(minha.dono)).json().lojas.map((l: { nome: string; origem: string }) => [l.nome, l.origem]), [['Loja Barra', 'regem'], ['Loja Centro', 'sistema']]);

    // revogado o acesso, a Centro volta a ser opção — e é ligada
    assert.equal((await revogar(minha.dono, id)).statusCode, 200);
    const outra = await autorizarNoRegem('Centro de lá');
    assert.deepEqual(outra.conexoes.lojasLivres.map((l: { nome: string }) => l.nome), ['Loja Centro']);
    assert.equal((await ligar(outra.esperando.id, minha.centro)).statusCode, 200);
    await semLeituraEmCurso();
  });

  it('criar o acesso e ligar ao Regem travam a linha da loja: duas pessoas ao mesmo tempo não deixam a loja com as duas origens', async () => {
    const { esperando } = await autorizarNoRegem('Centro de lá');
    // Outra conexão segura a linha da loja, como faria quem está no meio de uma das duas ações.
    const outra = await pool.connect();
    const parado = async (comeco: string) => {
      const limite = Date.now() + 10_000;
      for (;;) {
        const { rows } = await pool.query("select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and query like $1", [`${comeco}%`]);
        if (rows[0].n > 0) return;
        assert.ok(Date.now() < limite, `a rota não parou na trava da loja (${comeco})`);
        await new Promise((ok) => setTimeout(ok, 25));
      }
    };
    try {
      await outra.query('begin');
      await outra.query('select 1 from loja where id = $1 for no key update', [minha.centro]);
      const criando = criar(minha.dono, { nome: 'PDV da Casa', lojaId: minha.centro });
      await parado('select nome from loja where id = $1');
      const ligando = ligar(esperando.id, minha.centro);
      await parado('select id from loja where tenant_id = $1 and id = any');
      await outra.query('commit');
      const [c, l] = await Promise.all([criando, ligando]);
      assert.deepEqual([c.statusCode, l.statusCode].sort(), [201, 409].sort(), c.body + l.body);
      assert.equal([c, l].find((r) => r.statusCode === 409)!.json().erro, 'origem_ocupada');
    } finally {
      await outra.query('rollback').catch(() => {});
      outra.release();
    }
    await semLeituraEmCurso();
    const acessos = (await pool.query('select count(*)::int as n from acesso_externo where loja_id = $1 and revogado_em is null', [minha.centro])).rows[0].n;
    const ligacoes = (await pool.query('select count(*)::int as n from regem_loja where loja_id = $1', [minha.centro])).rows[0].n;
    assert.equal(acessos + ligacoes, 1, 'a loja ficou com UMA origem');
  });

  it('a loja com acesso não importa planilha — nem confere; e a planilha que ela tinha fica até o sistema enviar', async () => {
    assert.equal((await importar(minha.gerente, minha.centro, { arquivo: 'f.xlsx', abas: PLANILHA, gravar: true })).statusCode, 200);
    assert.deepEqual((await listar(minha.dono)).json().lojas.find((l: { id: string }) => l.id === minha.centro).origem, 'planilha');
    const { codigo } = await acessoDe(minha.centro);

    for (const corpo of [{ abas: PLANILHA }, { abas: PLANILHA, gravar: true }]) {
      const r = await importar(minha.gerente, minha.centro, corpo);
      assert.deepEqual([r.statusCode, r.json().erro], [409, 'origem_ocupada']);
      assert.match(r.json().mensagem, /recebe as fichas de outro sistema/);
    }
    // enquanto o sistema não envia, valem as da planilha — e a tela diz quem vai enviar
    let t = (await fichas(minha.gerente, minha.centro)).json();
    assert.deepEqual([t.fonte, t.podeImportar, t.sistema.nome, t.sistema.recebidoEm, t.produtos.map((p: { nome: string }) => p.nome)], ['planilha', false, 'PDV da Casa', null, ['Suco']]);

    assert.equal((await enviar(codigo, PEQUENO)).statusCode, 200);
    t = (await fichas(minha.gerente, minha.centro)).json();
    assert.deepEqual([t.fonte, t.produtos.map((p: { nome: string }) => p.nome), t.importacao.arquivo, t.importacao.por], ['sistema', ['Batata frita', 'Água sem gás'], '', 'PDV da Casa'], 'as do sistema entraram no lugar, e o registro é o do envio');
  });

  it('a importação de planilha que chega junto com a criação do acesso não deixa a loja com as duas origens', async () => {
    // o acesso nasce depois de a rota conferir a loja e antes de ela gravar a planilha
    let codigo = '';
    const naHora = new Proxy(pool, {
      get(alvo, nome, receptor) {
        if (nome !== 'query') return Reflect.get(alvo, nome, receptor);
        return async (texto: unknown, valores: unknown[]) => {
          if (typeof texto === 'string' && texto.includes("'planilha', $3::jsonb")) codigo = (await acessoDe(minha.centro)).codigo;
          return alvo.query(texto as string, valores);
        };
      },
    });
    const outro = criarApp(naHora as pg.Pool, { logger: false, regem: cfg });
    await outro.ready();
    try {
      const r = await outro.inject({ method: 'POST', url: `/v1/lojas/${minha.centro}/fichas/importar`, headers: { cookie: minha.gerente }, payload: { arquivo: 'f.xlsx', abas: PLANILHA, gravar: true } });
      assert.equal(r.statusCode, 409, r.body);
      assert.equal(await baseDe(minha.centro), null, 'a planilha não foi gravada');
      assert.equal((await oQueTem(codigo)).statusCode, 200, 'e o acesso está valendo');
    } finally {
      await outro.close();
    }
  });

  it('na tela Conexões, os números da loja ligada ao Regem são só os da base que veio DO REGEM', async () => {
    assert.equal((await importar(minha.gerente, minha.centro, { arquivo: 'f.xlsx', abas: PLANILHA, gravar: true })).statusCode, 200);
    const { esperando } = await autorizarNoRegem('Centro de lá');
    falso.modo = 'fora';
    assert.equal((await ligar(esperando.id, minha.centro)).statusCode, 200);
    await semLeituraEmCurso();
    // a leitura falhou: a base da loja ainda é a da planilha
    assert.equal((await baseDe(minha.centro))!.fonte, 'planilha');
    const c = (await app.inject({ method: 'GET', url: '/v1/regem', headers: { cookie: minha.dono } })).json();
    assert.deepEqual([c.ligadas[0].lojaNome, c.ligadas[0].produtos, c.ligadas[0].comFicha, c.ligadas[0].leitura.falhou], ['Loja Centro', null, null, true]);

    falso.modo = 'normal';
    assert.equal((await app.inject({ method: 'POST', url: `/v1/lojas/${minha.centro}/fichas/buscar`, headers: { cookie: minha.gerente } })).statusCode, 200);
    const d = (await app.inject({ method: 'GET', url: '/v1/regem', headers: { cookie: minha.dono } })).json();
    assert.ok(d.ligadas[0].produtos > 0, 'depois da leitura boa, os números são os do Regem');
  });
});
