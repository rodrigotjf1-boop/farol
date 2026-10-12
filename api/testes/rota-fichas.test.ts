// As rotas da tela Fichas, e o que a conexão passa a contar da leitura.
//
// O que se protege:
//
//   • quem acompanha a loja (supervisão para cima e o suporte) vê as
//     fichas; pedir a busca é só de quem configura; a loja do vizinho é 404;
//   • a tela recebe a base DO FAROL, sem dinheiro e sem nada do acesso;
//   • ligar a loja dispara a primeira busca; desconectar apaga as fichas;
//     acesso tirado no Regem apaga também, e conectar de novo as traz;
//   • "Buscar agora" diz o que aconteceu — e, quando falha, a base fica.

import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { decifrar } from '../src/cifra.js';
import { semLeituraEmCurso } from '../src/leitura.js';
import type { ConfigDoRegem } from '../src/regem.js';
import { subirRegemFalso, type LojaDeLa, type RegemFalso } from './regem-falso.js';

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-fic-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-fichas';
const SENHA = 'uma senha longa o bastante';
const CONSOLE = 'https://console.exemplo';
const RETORNO = `${CONSOLE}/api/regem/retorno`;

describe('fichas: as rotas da tela', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let falso: RegemFalso;
  let cfg: ConfigDoRegem & { segredo: string; chave: Buffer };
  let app: FastifyInstance;
  let appSemAmbiente: FastifyInstance;
  let adminAntes: string | undefined;

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
    app = criarApp(pool, { logger: false, regem: cfg });
    // Uma instalação sem a chave dos acessos: não há como abrir o que está guardado.
    appSemAmbiente = criarApp(pool, { logger: false, regem: { ...cfg, chave: null } });
    await Promise.all([app.ready(), appSemAmbiente.ready()]);

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
    falso?.soltar();
    await semLeituraEmCurso();
    await Promise.all([app?.close(), appSemAmbiente?.close()]);
    await falso?.fechar();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  beforeEach(async () => {
    falso.modo = 'normal';
    falso.leituraTorta = null;
    falso.soltar();
    await semLeituraEmCurso();
    falso.chamadas.length = 0;
    await pool.query('delete from fichas_da_loja where tenant_id = any($1::uuid[])', [contas()]);
    await pool.query('delete from regem_loja where tenant_id = any($1::uuid[])', [contas()]);
    await pool.query('delete from regem_pedido where tenant_id = any($1::uuid[])', [contas()]);
  });

  // ───────────────────────── os atalhos ─────────────────────────

  /** Pede, o presidente autoriza lá, volta: as lojas ficam esperando par. */
  async function autorizar(cookie: string, lojas: LojaDeLa[]) {
    const ida = await app.inject({ method: 'POST', url: '/v1/regem/conectar', headers: { cookie } });
    const url = new URL(ida.json().url);
    const code = falso.autorizar({ lojas, desafio: url.searchParams.get('code_challenge')!, redirectUri: RETORNO, empresa: 'Casa do Lanche Ltda' });
    const volta = await app.inject({ method: 'GET', url: `/v1/regem/retorno?${new URLSearchParams({ code, state: url.searchParams.get('state')! })}`, headers: { cookie } });
    assert.equal(new URL(String(volta.headers.location)).searchParams.get('regem'), 'autorizado');
  }
  const conexao = async (cookie: string) => (await app.inject({ method: 'GET', url: '/v1/regem', headers: { cookie } })).json();
  /** Autoriza UMA loja de lá e a liga à loja do Farol; espera a primeira busca terminar. */
  async function ligada(lojaId: string, nome: string, cookie = minha.dono) {
    const deLa = { id: randomUUID(), nome };
    await autorizar(cookie, [deLa]);
    const c = await conexao(cookie);
    const esperando = c.esperando.find((e: { regemLojaNome: string }) => e.regemLojaNome === nome);
    const r = await app.inject({ method: 'PUT', url: '/v1/regem/lojas', headers: { cookie }, payload: { pares: [{ id: esperando.id, lojaId }] } });
    assert.equal(r.statusCode, 200, r.body);
    await semLeituraEmCurso();
    falso.chamadas.length = 0;
    return { ...deLa, conexaoId: esperando.id as string };
  }
  const fichas = (cookie: string, lojaId: string, a: FastifyInstance = app) => a.inject({ method: 'GET', url: `/v1/lojas/${lojaId}/fichas`, headers: { cookie } });
  const umProduto = (cookie: string, lojaId: string, produtoId: string) =>
    app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}/fichas/produtos/${produtoId}`, headers: { cookie } });
  const buscar = (cookie: string, lojaId: string, a: FastifyInstance = app) => a.inject({ method: 'POST', url: `/v1/lojas/${lojaId}/fichas/buscar`, headers: { cookie } });
  const acessoDe = async (conexaoId: string) => {
    const { rows } = await pool.query('select tenant_id, regem_loja_id, acesso_cifrado from regem_loja where id = $1', [conexaoId]);
    return decifrar(rows[0].acesso_cifrado, cfg.chave, `acesso:${rows[0].tenant_id}:${rows[0].regem_loja_id}`)!;
  };
  const baseDe = async (lojaId: string) => (await pool.query('select produtos, com_ficha from fichas_da_loja where loja_id = $1', [lojaId])).rows[0] ?? null;
  const chaves = (v: unknown, achadas = new Set<string>()): Set<string> => {
    if (Array.isArray(v)) v.forEach((x) => chaves(x, achadas));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (achadas.add(k), chaves(x, achadas));
    return achadas;
  };

  // ───────────────────────── quem pode ─────────────────────────

  it('sem sessão, 401; execução, 403 sem dado nenhum; a supervisão VÊ e não pede a busca; gerente e suporte veem e buscam', async () => {
    await ligada(minha.centro, 'Centro de lá');
    const produto = (await fichas(minha.dono, minha.centro)).json().produtos[0].id as string;
    const rotas: Array<[string, string]> = [
      ['GET', `/v1/lojas/${minha.centro}/fichas`],
      ['GET', `/v1/lojas/${minha.centro}/fichas/produtos/${produto}`],
      ['POST', `/v1/lojas/${minha.centro}/fichas/buscar`],
    ];
    const recusada = (r: { statusCode: number; json: () => { erro: string } }, url: string) => {
      assert.equal(r.statusCode, 403, url);
      assert.deepEqual(Object.keys(r.json()).sort(), ['erro', 'mensagem']);
      assert.equal(r.json().erro, 'sem_permissao');
    };
    for (const [method, url] of rotas) {
      const sem = await app.inject({ method: method as 'GET', url });
      assert.equal(sem.statusCode, 401, url);
      recusada(await app.inject({ method: method as 'GET', url, headers: { cookie: minha.execucao } }), url);
    }

    // A supervisão vê o mesmo que a gerência — a lista e o produto — e não faz o Farol ler a fonte.
    const [daSupervisao, daGerencia] = [await fichas(minha.supervisao, minha.centro), await fichas(minha.gerente, minha.centro)];
    assert.equal(daSupervisao.statusCode, 200);
    assert.ok(daSupervisao.json().produtos.length > 0);
    assert.deepEqual(daSupervisao.json().produtos, daGerencia.json().produtos);
    assert.deepEqual(daSupervisao.json().totais, daGerencia.json().totais);
    const [oDaSupervisao, oDaGerencia] = [await umProduto(minha.supervisao, minha.centro, produto), await umProduto(minha.gerente, minha.centro, produto)];
    assert.equal(oDaSupervisao.statusCode, 200);
    assert.deepEqual(oDaSupervisao.json(), oDaGerencia.json());
    const busca = await buscar(minha.supervisao, minha.centro);
    recusada(busca, 'a busca, pela supervisão');
    assert.match(busca.json().mensagem, /quem configura a loja/);
    assert.equal(falso.chamadas.length, 0, 'ninguém sem permissão fez o Farol chamar o Regem');

    const [d, s] = [await fichas(minha.dono, minha.centro), await fichas(minha.suporte, minha.centro)];
    assert.deepEqual([d.statusCode, s.statusCode], [200, 200]);
    const telas = [d.json(), daGerencia.json(), s.json(), daSupervisao.json()];
    assert.deepEqual(telas.map((t) => t.podeConectar), [true, false, false, false]);
    // O botão "Buscar agora" segue quem a rota aceita: a tela não oferece o que o servidor recusa.
    assert.deepEqual(telas.map((t) => t.podeBuscar), [true, true, true, false]);
    assert.deepEqual([(await buscar(minha.gerente, minha.centro)).statusCode, (await buscar(minha.suporte, minha.centro)).statusCode], [200, 200]);
  });

  it('a loja do vizinho é 404 nas três rotas — e a busca dela não acontece; id malformado é 422', async () => {
    const dele = await ligada(vizinha.loja, 'Loja do vizinho', vizinha.dono);
    const produtoDele = (await fichas(vizinha.dono, vizinha.loja)).json().produtos[0].id;
    assert.equal((await fichas(minha.dono, vizinha.loja)).statusCode, 404);
    assert.equal((await umProduto(minha.dono, vizinha.loja, produtoDele)).statusCode, 404);
    assert.equal((await buscar(minha.dono, vizinha.loja)).statusCode, 404);
    assert.equal(falso.chamadas.length, 0);
    assert.equal((await fichas(minha.dono, randomUUID())).statusCode, 404);
    // O produto do vizinho, pedido numa loja MINHA, não existe.
    await ligada(minha.centro, 'Centro de lá');
    falso.cardapio(dele.id, { categorias: [], setores: [], produtos: [{ id: randomUUID(), nome: 'Só do vizinho' }], fichas: [] });
    assert.equal((await buscar(vizinha.dono, vizinha.loja)).json().resultado, 'atualizada');
    const soDele = (await fichas(vizinha.dono, vizinha.loja)).json().produtos[0];
    assert.equal(soDele.nome, 'Só do vizinho');
    assert.equal((await umProduto(minha.dono, minha.centro, soDele.id)).statusCode, 404);
    assert.ok(!(await fichas(minha.dono, minha.centro)).body.includes('Só do vizinho'));

    for (const r of [await fichas(minha.dono, 'x'), await umProduto(minha.dono, minha.centro, 'x'), await umProduto(minha.dono, 'x', randomUUID()), await buscar(minha.dono, 'x')]) {
      assert.equal(r.statusCode, 422);
    }
  });

  // ───────────────────────── em que pé está a loja ─────────────────────────

  it('sem conexão; depois, autorizada lá mas sem par aqui: a tela sabe a diferença', async () => {
    const sem = (await fichas(minha.gerente, minha.centro)).json();
    assert.deepEqual(sem, {
      situacao: 'sem_conexao',
      podeConectar: false,
      podeBuscar: true,
      podeImportar: true,
      fonte: null,
      sistema: null,
      importacao: null,
      regemLojaNome: null,
      leitura: null,
      totais: null,
      produtos: [],
    });
    // A supervisão vê o mesmo estado, sem nenhum dos botões.
    assert.deepEqual((await fichas(minha.supervisao, minha.centro)).json(), { ...sem, podeBuscar: false, podeImportar: false });

    await autorizar(minha.dono, [{ id: randomUUID(), nome: 'Centro de lá' }]);
    const falta = (await fichas(minha.dono, minha.centro)).json();
    assert.deepEqual([falta.situacao, falta.podeConectar, falta.leitura, falta.produtos], ['falta_ligar', true, null, []]);
    // A loja do vizinho não "falta ligar" por causa das minhas lojas esperando.
    assert.equal((await fichas(vizinha.dono, vizinha.loja)).json().situacao, 'sem_conexao');
  });

  it('ligar a loja dispara a busca: enquanto lê, a tela sabe; quando termina, as fichas estão lá', async () => {
    const deLa = { id: randomUUID(), nome: 'Centro de lá' };
    await autorizar(minha.dono, [deLa]);
    const esperando = (await conexao(minha.dono)).esperando[0];
    falso.segurar();
    const r = await app.inject({ method: 'PUT', url: '/v1/regem/lojas', headers: { cookie: minha.dono }, payload: { pares: [{ id: esperando.id, lojaId: minha.centro }] } });
    assert.equal(r.statusCode, 200, 'quem ligou não espera a busca');
    const limite = Date.now() + 5000;
    while (falso.seguradas() < 2) {
      assert.ok(Date.now() < limite, 'a busca não começou');
      await new Promise((ok) => setTimeout(ok, 15));
    }
    const lendo = (await fichas(minha.gerente, minha.centro)).json();
    assert.deepEqual([lendo.situacao, lendo.fonte, lendo.totais, lendo.produtos], ['ligada', null, null, []]);
    assert.deepEqual(lendo.leitura, { lidaEm: null, falhou: false, lendo: true, acessoTiradoEm: null });
    assert.equal(lendo.regemLojaNome, 'Centro de lá');

    falso.soltar();
    await semLeituraEmCurso();
    const pronta = (await fichas(minha.gerente, minha.centro)).json();
    assert.deepEqual([pronta.situacao, pronta.fonte, pronta.totais], ['ligada', 'regem', { produtos: 4, comFicha: 1 }]);
    assert.deepEqual([pronta.leitura.falhou, pronta.leitura.lendo, pronta.leitura.acessoTiradoEm], [false, false, null]);
    assert.ok(Date.now() - Date.parse(pronta.leitura.lidaEm) < 15_000);
    assert.deepEqual(pronta.produtos.map((p: { nome: string }) => p.nome), ['X-Burger', 'Refrigerante lata', 'Combo da casa', 'Só da matriz']);
    assert.deepEqual(pronta.produtos[0], { ...pronta.produtos[0], categoria: 'Burgers', cozinha: true, ingredientes: 5, combo: null, variacoes: 2, adicionais: 5 });
    assert.deepEqual(Object.keys(pronta.produtos[0]).sort(), ['adicionais', 'categoria', 'combo', 'cozinha', 'id', 'ingredientes', 'nome', 'variacoes']);
    // A outra loja da conta segue sem conexão: a busca foi só da que foi ligada.
    assert.equal((await fichas(minha.gerente, minha.barra)).json().situacao, 'sem_conexao');
  });

  it('o produto, inteiro — e nada de dinheiro, de acesso ou de id que muda', async () => {
    const c = await ligada(minha.centro, 'Centro de lá');
    const lista = (await fichas(minha.gerente, minha.centro)).json();
    const xb = lista.produtos.find((p: { nome: string }) => p.nome === 'X-Burger');
    const r = await umProduto(minha.gerente, minha.centro, xb.id.toUpperCase());
    assert.equal(r.statusCode, 200, r.body);
    const p = r.json();
    assert.deepEqual([p.nome, p.setor, p.preparoMin, p.tipo], ['X-Burger', 'Montagem', 12, 'variavel']);
    assert.deepEqual(p.ficha.ingredientes.map((i: { nome: string }) => i.nome), ['Pão brioche', 'Blend da casa', 'Queijo prato', 'Cebola roxa', 'Sal']);
    assert.deepEqual(p.variacoes.map((v: { nome: string; fator: number }) => [v.nome, v.fator]), [['Simples', 1], ['Duplo', 2]]);
    assert.deepEqual(p.adicionais.map((g: { opcoes: Array<{ efeito: { tipo: string } }> }) => g.opcoes.map((o) => o.efeito.tipo)), [['insumo', 'preparo', 'produto', 'observacao'], ['retira']]);

    const tudo = [lista, p, await conexao(minha.dono)];
    const nomes = chaves(tudo);
    assert.ok(nomes.size > 30);
    for (const k of nomes) assert.doesNotMatch(k, /pre[cç]o|custo|valor|margem|cmv|cliente|acesso_cifrado|token|versao/i, k);
    const texto = JSON.stringify(tudo);
    assert.ok(!texto.includes(await acessoDe(c.conexaoId)) && !texto.includes('rgm_it_') && !texto.includes('v1.'));

    assert.equal((await umProduto(minha.gerente, minha.centro, randomUUID())).json().erro, 'produto_nao_encontrado');
    assert.equal((await umProduto(minha.gerente, minha.barra, xb.id)).statusCode, 404, 'a outra loja da conta não tem esse produto: não tem fichas');
  });

  // ───────────────────────── buscar agora ─────────────────────────

  it('"Buscar agora" diz o que aconteceu: nada mudou, mudou, e a loja que continua sem fichas', async () => {
    const c = await ligada(minha.centro, 'Centro de lá');
    const nada = await buscar(minha.gerente, minha.centro);
    assert.deepEqual([nada.statusCode, nada.json()], [200, { resultado: 'nada_mudou', produtos: 4, comFicha: 1 }]);
    assert.equal(falso.chamadas.filter((x) => x.caminho.includes('?versao=')).length, 2, 'perguntou com a versão que tinha');

    const semFichas = structuredClone(falso.amostra);
    semFichas.fichas = [];
    falso.cardapio(c.id, semFichas);
    assert.deepEqual((await buscar(minha.gerente, minha.centro)).json(), { resultado: 'atualizada', produtos: 4, comFicha: 0 });
    assert.deepEqual((await fichas(minha.gerente, minha.centro)).json().totais, { produtos: 4, comFicha: 0 });
    assert.deepEqual((await buscar(minha.gerente, minha.centro)).json(), { resultado: 'nada_mudou', produtos: 4, comFicha: 0 });
  });

  it('com o Regem fora do ar: 502, as fichas de antes ficam e a tela mostra que a busca falhou — até a busca seguinte dar certo', async () => {
    await ligada(minha.centro, 'Centro de lá');
    const antes = (await fichas(minha.gerente, minha.centro)).json();
    for (const modo of ['fora', 'mudo', 'pagina'] as const) {
      falso.modo = modo;
      const r = await buscar(minha.gerente, minha.centro);
      assert.deepEqual([r.statusCode, r.json().erro], [502, 'regem_sem_resposta'], modo);
    }
    const depois = (await fichas(minha.gerente, minha.centro)).json();
    assert.deepEqual(depois.produtos, antes.produtos, 'as fichas de antes continuam valendo');
    assert.deepEqual([depois.leitura.falhou, depois.leitura.lidaEm], [true, antes.leitura.lidaEm]);
    // O motivo da falha é assunto do registro, não da tela.
    assert.ok(!JSON.stringify(depois).includes('sem_resposta') && !JSON.stringify(depois).includes('resposta_torta'));
    assert.equal((await conexao(minha.dono)).ligadas[0].leitura.falhou, true, 'a tela Conexões diz o mesmo');

    falso.modo = 'normal';
    assert.equal((await buscar(minha.gerente, minha.centro)).json().resultado, 'nada_mudou');
    assert.equal((await fichas(minha.gerente, minha.centro)).json().leitura.falhou, false);
  });

  it('acesso tirado no Regem: a busca responde 409, as fichas somem, e a tela passa a dizer por quê', async () => {
    const centro = await ligada(minha.centro, 'Centro de lá');
    await ligada(minha.barra, 'Barra de lá');
    falso.tirar(await acessoDe(centro.conexaoId));

    const r = await buscar(minha.gerente, minha.centro);
    assert.deepEqual([r.statusCode, r.json().erro], [409, 'acesso_tirado']);
    const t = (await fichas(minha.gerente, minha.centro)).json();
    assert.deepEqual([t.situacao, t.fonte, t.totais, t.produtos], ['acesso_tirado', null, null, []]);
    assert.ok(Date.now() - Date.parse(t.leitura.acessoTiradoEm) < 15_000);
    assert.equal(await baseDe(minha.centro), null);
    assert.equal((await fichas(minha.gerente, minha.barra)).json().totais.produtos, 4, 'a outra loja segue com as fichas dela');

    // Buscar de novo nem chama o Regem: não há acesso.
    falso.chamadas.length = 0;
    assert.equal((await buscar(minha.gerente, minha.centro)).json().erro, 'acesso_tirado');
    assert.equal(falso.chamadas.length, 0);

    const naConexao = (await conexao(minha.dono)).ligadas.find((l: { lojaId: string }) => l.lojaId === minha.centro);
    assert.ok(naConexao.leitura.acessoTiradoEm);
    assert.deepEqual([naConexao.produtos, naConexao.comFicha], [null, null]);
  });

  it('conectar de novo depois do acesso tirado: o estado recomeça e as fichas voltam', async () => {
    const centro = await ligada(minha.centro, 'Centro de lá');
    falso.tirar(await acessoDe(centro.conexaoId));
    await buscar(minha.gerente, minha.centro);
    assert.equal((await fichas(minha.gerente, minha.centro)).json().situacao, 'acesso_tirado');

    // O presidente autoriza a MESMA loja de lá outra vez: o par fica, o acesso é novo.
    await autorizar(minha.dono, [{ id: centro.id, nome: 'Centro de lá' }]);
    await semLeituraEmCurso();
    const t = (await fichas(minha.gerente, minha.centro)).json();
    assert.deepEqual([t.situacao, t.totais, t.leitura.acessoTiradoEm, t.leitura.falhou], ['ligada', { produtos: 4, comFicha: 1 }, null, false]);
    assert.equal(falso.vale(await acessoDe(centro.conexaoId)), true);
  });

  it('o que não é para buscar: loja sem conexão, busca já em andamento, instalação sem a chave dos acessos', async () => {
    const sem = await buscar(minha.gerente, minha.barra);
    assert.deepEqual([sem.statusCode, sem.json().erro], [409, 'sem_conexao']);

    const c = await ligada(minha.centro, 'Centro de lá');
    const indisponivel = await buscar(minha.gerente, minha.centro, appSemAmbiente);
    assert.deepEqual([indisponivel.statusCode, indisponivel.json().erro], [503, 'conexao_indisponivel']);
    assert.equal(falso.chamadas.length, 0);

    await pool.query('update regem_loja set lendo_desde = now() where id = $1', [c.conexaoId]);
    const ocupada = await buscar(minha.gerente, minha.centro);
    assert.deepEqual([ocupada.statusCode, ocupada.json().erro], [409, 'buscando']);
    assert.equal((await fichas(minha.gerente, minha.centro)).json().leitura.lendo, true);
    assert.equal(falso.chamadas.length, 0);
    await pool.query('update regem_loja set lendo_desde = null where id = $1', [c.conexaoId]);
  });

  // ───────────────────────── a conexão, e o desconectar ─────────────────────────

  it('a tela Conexões recebe, de cada loja ligada, o relógio dela, a leitura e o que a base tem', async () => {
    await ligada(minha.centro, 'Centro de lá');
    await pool.query("update loja set timezone = 'America/Manaus' where id = $1", [minha.barra]);
    await autorizar(minha.dono, [{ id: randomUUID(), nome: 'Barra de lá' }]);
    const c = await conexao(minha.gerente);
    assert.equal(c.esperando.length, 1);
    const l = c.ligadas[0];
    assert.deepEqual([l.lojaNome, l.fuso, l.produtos, l.comFicha], ['Loja Centro', 'America/Sao_Paulo', 4, 1]);
    assert.deepEqual([l.leitura.falhou, l.leitura.lendo, l.leitura.acessoTiradoEm], [false, false, null]);
    assert.ok(Date.now() - Date.parse(l.leitura.lidaEm) < 15_000);
    await pool.query("update loja set timezone = 'America/Sao_Paulo' where id = $1", [minha.barra]);
  });

  it('desconectar apaga as fichas da loja na hora — e só as dela', async () => {
    const centro = await ligada(minha.centro, 'Centro de lá');
    await ligada(minha.barra, 'Barra de lá');
    const r = await app.inject({ method: 'POST', url: `/v1/regem/lojas/${centro.conexaoId}/desconectar`, headers: { cookie: minha.dono } });
    assert.deepEqual([r.statusCode, r.json().fichasApagadas, r.json().devolvido], [200, true, true]);

    assert.equal(await baseDe(minha.centro), null);
    assert.deepEqual((await fichas(minha.gerente, minha.centro)).json(), {
      situacao: 'sem_conexao',
      podeConectar: false,
      podeBuscar: true,
      podeImportar: true,
      fonte: null,
      sistema: null,
      importacao: null,
      regemLojaNome: null,
      leitura: null,
      totais: null,
      produtos: [],
    });
    assert.deepEqual(await baseDe(minha.barra), { produtos: 4, com_ficha: 1 });
  });

  it('desconectar com o Regem fora do ar NÃO apaga as fichas: a loja continua conectada', async () => {
    const centro = await ligada(minha.centro, 'Centro de lá');
    falso.modo = 'fora';
    const r = await app.inject({ method: 'POST', url: `/v1/regem/lojas/${centro.conexaoId}/desconectar`, headers: { cookie: minha.dono } });
    assert.equal(r.statusCode, 502);
    assert.deepEqual(await baseDe(minha.centro), { produtos: 4, com_ficha: 1 });
  });

  it('desconectar no meio de uma busca: as fichas não reaparecem', async () => {
    const centro = await ligada(minha.centro, 'Centro de lá');
    const outro = structuredClone(falso.amostra);
    (outro.produtos as Array<{ nome: string }>)[0]!.nome = 'Nome novo';
    falso.cardapio(centro.id, outro);
    falso.segurar();
    const buscando = buscar(minha.gerente, minha.centro);
    const limite = Date.now() + 5000;
    while (falso.seguradas() < 2) {
      assert.ok(Date.now() < limite, 'a busca não chegou ao Regem');
      await new Promise((ok) => setTimeout(ok, 15));
    }
    // A devolução do acesso é outra chamada, que o Regem de teste não segura.
    const d = await app.inject({ method: 'POST', url: `/v1/regem/lojas/${centro.conexaoId}/desconectar`, headers: { cookie: minha.dono } });
    assert.deepEqual([d.statusCode, d.json().fichasApagadas], [200, true]);
    falso.soltar();
    const r = await buscando;
    // As leituras seguradas respondem com o acesso já devolvido (401) — ou a gravação já não acha a ligação.
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(await baseDe(minha.centro), null);
    assert.equal((await fichas(minha.gerente, minha.centro)).json().situacao, 'sem_conexao');
  });
});
