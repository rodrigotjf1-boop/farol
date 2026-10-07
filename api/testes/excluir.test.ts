// Excluir critério e excluir canal.
//
// Pedido do dono (07/10/2026): além de editar, poder excluir.
//
// O que se prova aqui é a promessa por trás do botão: o que foi excluído
// SOME — da tela, da árvore, do que desce para o agente — e o que ele já
// produziu FICA. Um produto de auditoria que apaga o passado junto com o
// cadastro não tem passado para mostrar.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-excluir-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-excluir';
const SENHA = 'uma senha longa o bastante';

const BASE = {
  tipo: 'estado',
  criterio: 'A superfície está livre de restos e utensílios sujos.',
  severidade: 'critico',
};

describe('excluir critério e canal (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  let lojaId = '';
  let setorId = '';
  let cookie = '';
  let cookieExecucao = '';
  let cookieOutraConta = '';
  let token = '';
  let usuarioId = '';

  type Canal = { pontoId: string; zonaId: string };

  async function criarCanal(nome: string, canal: number, setor = setorId, comCookie = cookie): Promise<Canal> {
    const r = await app.inject({
      method: 'POST', url: `/v1/setores/${setor}/pontos`,
      headers: { cookie: comCookie },
      payload: { nome, origem: 'dvr', canal, host: '192.168.1.118' },
    });
    assert.equal(r.statusCode, 201, r.body);
    return { pontoId: r.json().id, zonaId: r.json().zonas[0].id };
  }

  async function entrar(tenantId: string, email: string, nivel: string) {
    await app.inject({
      method: 'POST', url: '/v1/distribuicao/usuarios',
      headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId, nome: 'X', email, senha: SENHA, nivel },
    });
    const r = await app.inject({ method: 'POST', url: '/v1/sessao', payload: { email, senha: SENHA } });
    const b = r.headers['set-cookie'];
    return (Array.isArray(b) ? b[0]! : String(b)).split(';')[0]!;
  }

  async function criarCriterio(nome: string, zonaIds: string[], ligar = false, comCookie = cookie) {
    const r = await app.inject({
      method: 'POST', url: `/v1/lojas/${lojaId}/regras`,
      headers: { cookie: comCookie },
      payload: { ...BASE, nome, zonaIds },
    });
    assert.equal(r.statusCode, 201, r.body);
    const id = r.json().id as string;
    if (ligar) {
      const l = await app.inject({
        method: 'PATCH', url: `/v1/regras/${id}`, headers: { cookie: comCookie }, payload: { ativa: true },
      });
      assert.equal(l.statusCode, 200, l.body);
    }
    return id;
  }

  const excluirCriterio = (id: string, comCookie = cookie) =>
    app.inject({ method: 'DELETE', url: `/v1/regras/${id}`, headers: { cookie: comCookie } });

  const excluirCanal = (id: string, comCookie = cookie) =>
    app.inject({ method: 'DELETE', url: `/v1/pontos/${id}`, headers: { cookie: comCookie } });

  type NaLista = { id: string; nome: string; ativa: boolean; alvos: Array<{ zona_id: string }> };
  async function criterios(): Promise<NaLista[]> {
    const r = await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}/regras`, headers: { cookie } });
    assert.equal(r.statusCode, 200, r.body);
    return r.json().regras;
  }

  async function canaisNaTela(): Promise<string[]> {
    const r = await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}`, headers: { cookie } });
    assert.equal(r.statusCode, 200, r.body);
    return r.json().setores.flatMap((s: { pontos: Array<{ id: string }> }) => s.pontos.map((p) => p.id));
  }

  /** O que o agente recebe: os canais, e os critérios de cada um. */
  async function descida() {
    const r = await app.inject({
      method: 'GET', url: '/v1/agentes/configuracao',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(r.statusCode, 200, r.body);
    const pontos: string[] = [];
    const regras: string[] = [];
    for (const p of r.json().pontos) {
      pontos.push(p.id);
      for (const z of p.zonas) for (const regra of z.regras) regras.push(regra.id);
    }
    return { pontos, regras };
  }

  const enviarEvento = (regraId: string, zonaId: string, chave: string) =>
    app.inject({
      method: 'POST', url: '/v1/eventos',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        eventos: [{
          idempotenciaKey: chave, regraId, zonaId,
          ocorridoEm: new Date().toISOString(), veredito: 'nao_conforme', confianca: 0.9,
        }],
      },
    });

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    app = criarApp(pool, { logger: false });
    await app.ready();

    const loja = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas',
      headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome: marca }, loja: { nome: 'Matriz' }, setores: [{ nome: 'Cozinha' }] },
    })).json();
    lojaId = loja.loja.id;
    setorId = loja.setores[0].id;

    cookie = await entrar(loja.tenantId, `dono-${marca}@e.com`, 'presidente');
    cookieExecucao = await entrar(loja.tenantId, `exec-${marca}@e.com`, 'execucao');
    usuarioId = (await pool.query('select id from usuario where email = $1', [`dono-${marca}@e.com`])).rows[0].id;

    const vizinha = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas',
      headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome: `${marca}-vizinha` }, loja: { nome: 'Vizinha' }, setores: [{ nome: 'Cozinha' }] },
    })).json();
    cookieOutraConta = await entrar(vizinha.tenantId, `viz-${marca}@e.com`, 'presidente');

    const agente = await app.inject({
      method: 'POST', url: '/v1/distribuicao/agentes',
      headers: { 'x-farol-admin': ADMIN },
      payload: { lojaId, nome: 'Agente de teste' },
    });
    token = agente.json().token;
    await app.inject({
      method: 'POST', url: '/v1/agentes/ativar',
      headers: { authorization: `Bearer ${token}` },
      payload: { fingerprint: `fp-${marca}` },
    });
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  // ───────────────────────────── o critério ─────────────────────────────

  it('critério excluído some da tela e do que desce — em todos os canais', async () => {
    const a = await criarCanal('Montagem A', 1);
    const b = await criarCanal('Montagem B', 2);
    const id = await criarCriterio(`some-${marca}`, [a.zonaId, b.zonaId], true);
    assert.ok((await descida()).regras.includes(id), 'antes de excluir, o agente recebe');

    const r = await excluirCriterio(id);

    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json(), { excluido: true, canais: 2 });
    assert.equal((await criterios()).find((c) => c.id === id), undefined, 'não pode continuar na lista');
    assert.ok(!(await descida()).regras.includes(id), 'não pode continuar descendo para o agente');
  });

  it('a LINHA fica, desligada, com quando e quem', async () => {
    const a = await criarCanal('Chapa', 3);
    const id = await criarCriterio(`fica-${marca}`, [a.zonaId], true);

    await excluirCriterio(id);

    const { rows } = await pool.query(
      'select nome, ativa, excluida_em, excluida_por from regra where id = $1', [id],
    );
    assert.equal(rows.length, 1, 'a linha não pode sumir: os vereditos apontam para ela');
    assert.equal(rows[0].ativa, false);
    assert.ok(rows[0].excluida_em instanceof Date);
    assert.equal(rows[0].excluida_por, usuarioId, 'quem excluiu tem que ficar registrado');
  });

  it('o veredito que o critério JÁ produziu continua lá, com o nome dele', async () => {
    const a = await criarCanal('Fritadeira', 4);
    const id = await criarCriterio(`historico-${marca}`, [a.zonaId], true);
    const chave = randomUUID().replace(/-/g, '');
    const antes = await enviarEvento(id, a.zonaId, chave);
    assert.equal(antes.json().aceitos, 1, antes.body);

    await excluirCriterio(id);

    const { rows } = await pool.query(
      `select r.nome from evento e join regra r on r.id = e.regra_id where e.idempotencia_key = $1`,
      [chave],
    );
    assert.equal(rows.length, 1, 'o evento antigo tem que continuar no histórico');
    assert.equal(rows[0].nome, `historico-${marca}`);
  });

  it('evento de critério excluído é recusado — e devolvido, para a fila do agente andar', async () => {
    const a = await criarCanal('Bebidas', 5);
    const id = await criarCriterio(`tarde-${marca}`, [a.zonaId], true);
    await excluirCriterio(id);

    const chave = randomUUID().replace(/-/g, '');
    const r = await enviarEvento(id, a.zonaId, chave);

    assert.equal(r.json().aceitos, 0, r.body);
    assert.deepEqual(r.json().recusados, [chave]);
  });

  it('critério excluído não se edita, não se tira de canal, não se exclui de novo', async () => {
    const a = await criarCanal('Expedição', 6);
    const id = await criarCriterio(`morto-${marca}`, [a.zonaId]);
    await excluirCriterio(id);

    const editar = await app.inject({
      method: 'PATCH', url: `/v1/regras/${id}`, headers: { cookie }, payload: { nome: 'voltei' },
    });
    const tirar = await app.inject({
      method: 'DELETE', url: `/v1/regras/${id}/canais/${a.zonaId}`, headers: { cookie },
    });
    const deNovo = await excluirCriterio(id);

    assert.equal(editar.statusCode, 404);
    assert.equal(tirar.statusCode, 404);
    assert.equal(deNovo.statusCode, 404);
    const { rows } = await pool.query('select nome from regra where id = $1', [id]);
    assert.equal(rows[0].nome, `morto-${marca}`, 'o nome não pode ter mudado');
  });

  it('o mesmo nome pode ser cadastrado de novo depois', async () => {
    const a = await criarCanal('Caixa', 7);
    const primeiro = await criarCriterio(`repetido-${marca}`, [a.zonaId]);
    await excluirCriterio(primeiro);

    const segundo = await criarCriterio(`repetido-${marca}`, [a.zonaId]);

    assert.notEqual(segundo, primeiro);
    assert.equal((await criterios()).filter((c) => c.nome === `repetido-${marca}`).length, 1);
  });

  it('outra conta e perfil de execução NÃO excluem critério', async () => {
    const a = await criarCanal('Salão', 8);
    const id = await criarCriterio(`protegido-${marca}`, [a.zonaId], true);

    const vizinha = await excluirCriterio(id, cookieOutraConta);
    const execucao = await excluirCriterio(id, cookieExecucao);

    // 404 e não 403 para a outra conta: "existe, mas não é seu" já entrega
    // que existe.
    assert.equal(vizinha.statusCode, 404);
    assert.equal(execucao.statusCode, 403);
    const c = (await criterios()).find((x) => x.id === id);
    assert.ok(c, 'o critério tem que continuar na lista');
    assert.equal(c.ativa, true);
    assert.equal(c.alvos.length, 1);
  });

  it('id que não é uuid é 404, não 500', async () => {
    assert.equal((await excluirCriterio('qualquer-coisa')).statusCode, 404);
    assert.equal((await excluirCanal('qualquer-coisa')).statusCode, 404);
  });

  // ─────────────────────────────── o canal ───────────────────────────────

  it('canal excluído some da tela, da contagem da loja e do que desce', async () => {
    const a = await criarCanal('Estoque', 9);
    const id = await criarCriterio(`no-estoque-${marca}`, [a.zonaId], true);
    assert.ok((await descida()).pontos.includes(a.pontoId));
    const contar = async () =>
      (await app.inject({ method: 'GET', url: '/v1/lojas', headers: { cookie } }))
        .json().lojas.find((l: { id: string }) => l.id === lojaId).pontos as number;
    const antes = await contar();

    const r = await excluirCanal(a.pontoId);

    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().excluido, true);
    assert.ok(!(await canaisNaTela()).includes(a.pontoId), 'não pode continuar na tela da loja');
    assert.equal(await contar(), antes - 1);
    const d = await descida();
    assert.ok(!d.pontos.includes(a.pontoId), 'não pode continuar descendo para o agente');
    assert.ok(!d.regras.includes(id));
  });

  it('a linha do canal fica, com quando e quem — o histórico aponta para ela', async () => {
    const a = await criarCanal('Doca', 10);

    await excluirCanal(a.pontoId);

    const { rows } = await pool.query(
      'select nome, ativo, excluido_em, excluido_por from ponto where id = $1', [a.pontoId],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].ativo, false);
    assert.ok(rows[0].excluido_em instanceof Date);
    assert.equal(rows[0].excluido_por, usuarioId);
    const zona = await pool.query('select 1 from zona where id = $1', [a.zonaId]);
    assert.equal(zona.rowCount, 1, 'a área também fica: é para ela que o evento aponta');
  });

  it('os critérios do canal NÃO são excluídos: saem dele, e o que valia só ali é desligado', async () => {
    const some = await criarCanal('Canal que sai', 11);
    const fica = await criarCanal('Canal que fica', 12);
    const nosDois = await criarCriterio(`nos-dois-${marca}`, [some.zonaId, fica.zonaId], true);
    const soNele = await criarCriterio(`so-nele-${marca}`, [some.zonaId], true);

    const r = await excluirCanal(some.pontoId);

    assert.equal(r.json().criteriosTirados, 2, r.body);
    assert.deepEqual(r.json().criteriosDesligados, [`so-nele-${marca}`]);

    const lista = await criterios();
    const a = lista.find((c) => c.id === nosDois)!;
    const b = lista.find((c) => c.id === soNele)!;
    assert.deepEqual(a.alvos.map((x) => x.zona_id), [fica.zonaId], 'segue valendo no outro canal');
    assert.equal(a.ativa, true, 'e segue ligado');
    assert.deepEqual(b.alvos, [], 'vai para "Sem canal"');
    assert.equal(b.ativa, false, 'ligado sem canal seria "Ligado" na tela com nada sendo verificado');
  });

  it('canal excluído não é editado, não entra em critério e não se exclui de novo', async () => {
    const a = await criarCanal('Fantasma', 13);
    const vivo = await criarCanal('Vivo', 14);
    const id = await criarCriterio(`vivo-${marca}`, [vivo.zonaId]);
    await excluirCanal(a.pontoId);

    const editar = await app.inject({
      method: 'PATCH', url: `/v1/pontos/${a.pontoId}`, headers: { cookie }, payload: { nome: 'voltei' },
    });
    const ver = await app.inject({ method: 'GET', url: `/v1/pontos/${a.pontoId}`, headers: { cookie } });
    const marcar = await app.inject({
      method: 'PATCH', url: `/v1/regras/${id}`, headers: { cookie },
      payload: { zonaIds: [vivo.zonaId, a.zonaId] },
    });
    const criar = await app.inject({
      method: 'POST', url: `/v1/lojas/${lojaId}/regras`, headers: { cookie },
      payload: { ...BASE, nome: `no-fantasma-${marca}`, zonaIds: [a.zonaId] },
    });
    const deNovo = await excluirCanal(a.pontoId);

    assert.equal(editar.statusCode, 404);
    assert.equal(ver.statusCode, 404);
    assert.equal(marcar.statusCode, 422, marcar.body);
    assert.notEqual(criar.statusCode, 201, 'critério não pode nascer num canal que não existe mais');
    assert.equal(deNovo.statusCode, 404);
    const c = (await criterios()).find((x) => x.id === id)!;
    assert.deepEqual(c.alvos.map((x) => x.zona_id), [vivo.zonaId], 'nada mudou no critério');
    assert.equal((await criterios()).find((x) => x.nome === `no-fantasma-${marca}`), undefined);
  });

  it('outra conta e perfil de execução NÃO excluem canal', async () => {
    const a = await criarCanal('Protegido', 15);

    const vizinha = await excluirCanal(a.pontoId, cookieOutraConta);
    const execucao = await excluirCanal(a.pontoId, cookieExecucao);

    assert.equal(vizinha.statusCode, 404);
    assert.equal(execucao.statusCode, 403);
    assert.ok((await canaisNaTela()).includes(a.pontoId));
  });

  it('PAUSAR é outra coisa: o canal fica na tela, marcado, com os critérios guardados', async () => {
    const a = await criarCanal('Pausado', 16);
    const id = await criarCriterio(`no-pausado-${marca}`, [a.zonaId], true);

    const r = await app.inject({
      method: 'PATCH', url: `/v1/pontos/${a.pontoId}`, headers: { cookie }, payload: { ativo: false },
    });

    assert.equal(r.statusCode, 200, r.body);
    assert.ok((await canaisNaTela()).includes(a.pontoId), 'pausado continua na tela');
    const c = (await criterios()).find((x) => x.id === id)!;
    assert.deepEqual(c.alvos.map((x) => x.zona_id), [a.zonaId], 'e os critérios continuam nele');
    assert.ok(!(await descida()).pontos.includes(a.pontoId), 'mas o agente para de verificar');
  });

  it('os DOIS últimos canais excluídos ao mesmo tempo: o critério não fica ligado sem canal', async () => {
    // Este teste confere o RESULTADO. Ele não prova a trava (`for update`)
    // sozinha: o gatilho que sobe a versão da configuração também faz as
    // duas transações passarem uma depois da outra.
    const a = await criarCanal('Par A', 17);
    const b = await criarCanal('Par B', 18);
    const id = await criarCriterio(`par-${marca}`, [a.zonaId, b.zonaId], true);

    const [ra, rb] = await Promise.all([excluirCanal(a.pontoId), excluirCanal(b.pontoId)]);

    assert.equal(ra.statusCode, 200, ra.body);
    assert.equal(rb.statusCode, 200, rb.body);
    const c = (await criterios()).find((x) => x.id === id)!;
    assert.deepEqual(c.alvos, []);
    assert.equal(c.ativa, false, 'exatamente uma das duas tinha que ter desligado o critério');
    const desligou = [ra, rb].filter((r) => r.json().criteriosDesligados.length === 1).length;
    assert.equal(desligou, 1, 'e só uma delas pode dizer que desligou');
  });
});
