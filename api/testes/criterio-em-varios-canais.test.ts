// Um critério, vários canais.
//
// O dono descreveu assim (06/10/2026): marcar os canais numa árvore, como
// num explorador de arquivos — o setor inteiro, ou abrir o setor e marcar
// um canal só. Um cadastro, e a edição é uma só.
//
// O que se prova aqui é o que mantém essa promessa de pé: o critério existe
// UMA vez, vale exatamente onde foi marcado, e o evento diz em qual canal
// foi — sem que o agente possa inventar o canal.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { lerZonaIds } from '../src/rotas/regras.js';

// ───────────────────── a leitura do corpo: sem banco ─────────────────────

describe('zonaIds no corpo', () => {
  it('ausente quer dizer "não mexa nos canais"', () => {
    // Quem só trocou o nome não quis mexer em onde o critério vale.
    assert.deepEqual(lerZonaIds({ nome: 'x' }), {});
  });

  it('lista vazia é lista vazia — não é o mesmo que ausente', () => {
    assert.deepEqual(lerZonaIds({ zonaIds: [] }), { ids: [] });
  });

  it('o mesmo canal duas vezes conta uma', () => {
    const z = randomUUID();
    assert.deepEqual(lerZonaIds({ zonaIds: [z, z.toUpperCase()] }), { ids: [z] });
  });

  it('recusa o que não é lista de uuid', () => {
    assert.match(String(lerZonaIds({ zonaIds: 'todos' }).problema), /lista/);
    assert.match(String(lerZonaIds({ zonaIds: ['canal-1'] }).problema), /uuid/);
    assert.match(String(lerZonaIds({ zonaIds: [42] }).problema), /uuid/);
  });
});

// ───────────────────────────── com banco ─────────────────────────────

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-canais-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-canais';
const SENHA = 'uma senha longa o bastante';

const BASE = {
  nome: 'Bancada limpa',
  tipo: 'estado',
  criterio: 'A superfície está livre de restos e utensílios sujos.',
  severidade: 'critico',
};

describe('critério em vários canais (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  let lojaId = '';
  let cookie = '';
  let cookieExecucao = '';
  let token = '';
  /** Áreas principais dos canais 1, 2 e 3 da cozinha, e do canal do salão. */
  let z1 = '', z2 = '', z3 = '', zSalao = '';
  /** Área de outra LOJA da mesma conta, e de outra CONTA. */
  let zOutraLoja = '', zOutraConta = '';
  let cookieOutraConta = '';

  async function criarPonto(setorId: string, nome: string, canal: number, comCookie = cookie) {
    const r = await app.inject({
      method: 'POST', url: `/v1/setores/${setorId}/pontos`,
      headers: { cookie: comCookie },
      payload: { nome, origem: 'dvr', canal, host: '192.168.1.108' },
    });
    assert.equal(r.statusCode, 201, r.body);
    return r.json().zonas[0].id as string;
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

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    app = criarApp(pool, { logger: false });
    await app.ready();

    const loja = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas',
      headers: { 'x-farol-admin': ADMIN },
      payload: {
        tenant: { nome: marca }, loja: { nome: 'Matriz' },
        setores: [{ nome: 'Cozinha' }, { nome: 'Salão' }],
      },
    })).json();
    lojaId = loja.loja.id;
    const cozinha = loja.setores.find((s: { nome: string }) => s.nome === 'Cozinha').id;
    const salao = loja.setores.find((s: { nome: string }) => s.nome === 'Salão').id;

    cookie = await entrar(loja.tenantId, `dono-${marca}@e.com`, 'presidente');
    cookieExecucao = await entrar(loja.tenantId, `exec-${marca}@e.com`, 'execucao');

    z1 = await criarPonto(cozinha, 'Montagem', 1);
    z2 = await criarPonto(cozinha, 'Fritadeira', 2);
    z3 = await criarPonto(cozinha, 'Chapa', 3);
    zSalao = await criarPonto(salao, 'Balcão', 4);

    // Outra loja da MESMA conta.
    const filial = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas',
      headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId: loja.tenantId, loja: { nome: 'Filial' }, setores: [{ nome: 'Cozinha' }] },
    })).json();
    zOutraLoja = await criarPonto(filial.setores[0].id, 'Montagem da filial', 1);

    // Outra CONTA.
    const vizinha = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas',
      headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome: `${marca}-vizinha` }, loja: { nome: 'Vizinha' }, setores: [{ nome: 'Cozinha' }] },
    })).json();
    cookieOutraConta = await entrar(vizinha.tenantId, `viz-${marca}@e.com`, 'presidente');
    zOutraConta = await criarPonto(vizinha.setores[0].id, 'Montagem da vizinha', 1, cookieOutraConta);

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

  // ───────────── utilitários ─────────────

  const criar = (zonaIds: unknown, extra: Record<string, unknown> = {}, comCookie = cookie) =>
    app.inject({
      method: 'POST', url: `/v1/lojas/${lojaId}/regras`,
      headers: { cookie: comCookie },
      payload: { ...BASE, ...extra, zonaIds },
    });

  const editar = (id: string, payload: Record<string, unknown>, comCookie = cookie) =>
    app.inject({ method: 'PATCH', url: `/v1/regras/${id}`, headers: { cookie: comCookie }, payload });

  const tirar = (id: string, zonaId: string, comCookie = cookie) =>
    app.inject({ method: 'DELETE', url: `/v1/regras/${id}/canais/${zonaId}`, headers: { cookie: comCookie } });

  async function listar() {
    const r = await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}/regras`, headers: { cookie } });
    return r.json().regras as Array<{ id: string; nome: string; ativa: boolean; alvos: Array<{ zona_id: string }> }>;
  }

  async function ondeVale(id: string) {
    const regra = (await listar()).find((r) => r.id === id);
    return (regra?.alvos ?? []).map((a) => a.zona_id).sort();
  }

  /** O que o agente recebe: em quais áreas este critério desceu. */
  async function ondeDesce(id: string) {
    const r = await app.inject({
      method: 'GET', url: '/v1/agentes/configuracao',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(r.statusCode, 200, r.body);
    const c = r.json();
    const achadas: Array<{ zona: string; versao: number }> = [];
    for (const p of c.pontos) {
      for (const z of p.zonas) {
        for (const regra of z.regras) {
          if (regra.id === id) achadas.push({ zona: z.id, versao: regra.criterioVersao });
        }
      }
    }
    return { versao: c.versao as number, achadas };
  }

  const enviar = (evento: Record<string, unknown>) =>
    app.inject({
      method: 'POST', url: '/v1/eventos',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        eventos: [{ ocorridoEm: new Date().toISOString(), veredito: 'nao_conforme', ...evento }],
      },
    });

  const zonaDoEvento = async (chave: string) =>
    (await pool.query('select zona_id from evento where idempotencia_key = $1', [chave])).rows[0]?.zona_id;

  // ─────────────────── criar: um cadastro, vários canais ───────────────────

  it('UM cadastro passa a valer nos três canais', async () => {
    const r = await criar([z1, z2, z3], { nome: `tres-${marca}` });
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json().canais, 3);
    assert.equal(r.json().ativa, false, 'nasce desligado, como todo critério');

    const iguais = (await listar()).filter((x) => x.nome === `tres-${marca}`);
    assert.equal(iguais.length, 1, 'o critério tem que existir UMA vez, não uma por canal');
    assert.deepEqual(await ondeVale(r.json().id), [z1, z2, z3].sort());
  });

  it('critério sem canal nenhum não é criado', async () => {
    const r = await criar([]);
    assert.equal(r.statusCode, 422);
    assert.match(r.json().mensagem, /ao menos um canal/);
  });

  it('canal de OUTRA CONTA no meio da lista: nada é criado', async () => {
    // Criar "em 2 dos 3 canais marcados" seria pior que recusar: a tela
    // diria que deu certo e um canal ficaria de fora sem ninguém saber.
    const antes = (await listar()).length;
    const r = await criar([z1, zOutraConta, z2], { nome: `vazou-${marca}` });
    assert.equal(r.statusCode, 404);
    assert.equal((await listar()).length, antes, 'criou pela metade');

    const naVizinha = await pool.query(
      'select count(*)::int as n from regra_alvo where zona_id = $1', [zOutraConta],
    );
    assert.equal(naVizinha.rows[0].n, 0, 'gravou critério no canal de outra conta');
  });

  it('canal de outra LOJA da mesma conta também não entra', async () => {
    // O critério é de uma loja. Misturar lojas deixaria um agente recebendo
    // critério que outro gerente editou.
    const r = await criar([z1, zOutraLoja]);
    assert.equal(r.statusCode, 404);
  });

  it('o atalho de um canal só continua funcionando', async () => {
    const r = await app.inject({
      method: 'POST', url: `/v1/zonas/${zSalao}/regras`,
      headers: { cookie }, payload: { ...BASE, nome: `um-so-${marca}` },
    });
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json().canais, 1);
    assert.deepEqual(await ondeVale(r.json().id), [zSalao]);
  });

  it('quem não configura não cria critério', async () => {
    const r = await criar([z1], {}, cookieExecucao);
    assert.equal(r.statusCode, 403);
  });

  // ─────────────────── o agente recebe o que está marcado ───────────────────

  it('o critério desce debaixo de CADA canal marcado, e só deles', async () => {
    const id = (await criar([z1, z3], { nome: `desce-${marca}` })).json().id;
    await editar(id, { ativa: true });

    const { achadas } = await ondeDesce(id);

    assert.deepEqual(achadas.map((a) => a.zona).sort(), [z1, z3].sort());
  });

  it('editar a redação UMA vez muda nos canais todos', async () => {
    // É o motivo de o recurso existir: três cadastros iguais são três
    // edições, e esquecer uma deixa a loja auditando por duas redações.
    const id = (await criar([z1, z2, z3], { nome: `redacao-${marca}` })).json().id;
    await editar(id, { ativa: true });

    await editar(id, { criterio: 'A bancada não tem restos, embalagens nem panos.' });

    const { achadas } = await ondeDesce(id);
    assert.equal(achadas.length, 3);
    assert.deepEqual(achadas.map((a) => a.versao), [2, 2, 2], 'algum canal ficou na redação antiga');
  });

  it('marcar e desmarcar canal sobe a versão que o agente observa', async () => {
    // Sem isso a tela mostra o critério no canal e o agente segue sem
    // auditá-lo: ele só puxa a configuração quando esse número muda.
    const id = (await criar([z1], { nome: `versao-${marca}` })).json().id;
    await editar(id, { ativa: true });
    const v0 = (await ondeDesce(id)).versao;

    await editar(id, { zonaIds: [z1, z2] });
    const v1 = (await ondeDesce(id)).versao;
    assert.ok(v1 > v0, `marcar não subiu: ${v0} → ${v1}`);

    await tirar(id, z2);
    const v2 = (await ondeDesce(id)).versao;
    assert.ok(v2 > v1, `desmarcar não subiu: ${v1} → ${v2}`);
  });

  // ─────────────────── editar onde vale ───────────────────

  it('a marcação nova SUBSTITUI a anterior', async () => {
    const id = (await criar([z1, z2], { nome: `troca-${marca}` })).json().id;

    const r = await editar(id, { zonaIds: [z2, z3] });

    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().canais, 2);
    assert.deepEqual(await ondeVale(id), [z2, z3].sort());
  });

  it('editar só o nome NÃO mexe nos canais', async () => {
    const id = (await criar([z1, z2], { nome: `nome-${marca}` })).json().id;

    await editar(id, { nome: `nome-novo-${marca}` });

    assert.deepEqual(await ondeVale(id), [z1, z2].sort());
  });

  it('canal de fora na edição: NADA muda — nem o nome', async () => {
    // Os campos e os canais mudam juntos ou não mudam. Trocar a redação e
    // falhar nos canais deixaria o critério novo valendo nos canais antigos.
    const id = (await criar([z1], { nome: `intacto-${marca}` })).json().id;

    const r = await editar(id, { nome: `mudou-${marca}`, zonaIds: [z1, zOutraConta] });

    assert.equal(r.statusCode, 422);
    const regra = (await listar()).find((x) => x.id === id)!;
    assert.equal(regra.nome, `intacto-${marca}`, 'o nome mudou mesmo com a edição recusada');
    assert.deepEqual(await ondeVale(id), [z1]);
  });

  it('critério de outra conta não é editável nem visível', async () => {
    const id = (await criar([z1], { nome: `alheio-${marca}` })).json().id;

    assert.equal((await editar(id, { zonaIds: [] }, cookieOutraConta)).statusCode, 404);
    assert.equal((await tirar(id, z1, cookieOutraConta)).statusCode, 404);
    assert.deepEqual(await ondeVale(id), [z1], 'outra conta tirou o critério do canal');
  });

  // ─────────────────── tirar de um canal ───────────────────

  it('tirar de um canal deixa o critério nos outros', async () => {
    const id = (await criar([z1, z2, z3], { nome: `tira-${marca}` })).json().id;
    await editar(id, { ativa: true });

    const r = await tirar(id, z2);

    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json(), { removido: true, restantes: 2, desligada: false });
    assert.deepEqual(await ondeVale(id), [z1, z3].sort());
    const { achadas } = await ondeDesce(id);
    assert.deepEqual(achadas.map((a) => a.zona).sort(), [z1, z3].sort(), 'o agente ainda audita no canal removido');
  });

  it('tirar do ÚLTIMO canal desliga o critério, e ele continua existindo', async () => {
    const id = (await criar([z1], { nome: `ultimo-${marca}` })).json().id;
    await editar(id, { ativa: true });

    const r = await tirar(id, z1);

    assert.deepEqual(r.json(), { removido: true, restantes: 0, desligada: true });
    const regra = (await listar()).find((x) => x.id === id);
    // Continua na listagem: senão ficaria guardado e invisível, sem jeito
    // de devolvê-lo a um canal.
    assert.ok(regra, 'o critério sumiu da listagem');
    assert.deepEqual(regra!.alvos, []);
    assert.equal(regra!.ativa, false, '"Ligado" sem canal nenhum é mentira na tela');
  });

  it('LIGAR um critério sem canal é recusado', async () => {
    const id = (await criar([z1], { nome: `sem-canal-${marca}` })).json().id;
    await tirar(id, z1);

    const r = await editar(id, { ativa: true });

    assert.equal(r.statusCode, 422);
    assert.equal(r.json().erro, 'sem_canal');
  });

  it('devolver a um canal e ligar de novo funciona', async () => {
    const id = (await criar([z1], { nome: `volta-${marca}` })).json().id;
    await tirar(id, z1);

    const r = await editar(id, { zonaIds: [z3], ativa: true });

    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().ativa, true);
    assert.deepEqual(await ondeVale(id), [z3]);
  });

  it('tirar duas vezes do mesmo canal diz que já não estava', async () => {
    const id = (await criar([z1, z2], { nome: `duas-${marca}` })).json().id;
    await tirar(id, z1);

    const r = await tirar(id, z1);

    assert.equal(r.statusCode, 404);
    assert.equal(r.json().erro, 'nao_esta_no_canal');
  });

  it('quem não configura não tira critério de canal', async () => {
    const id = (await criar([z1], { nome: `exec-${marca}` })).json().id;
    assert.equal((await tirar(id, z1, cookieExecucao)).statusCode, 403);
  });

  // ─────────────────── o evento diz em qual canal foi ───────────────────

  it('o evento é gravado no canal que o agente informou', async () => {
    const id = (await criar([z1, z2, z3], { nome: `evento-${marca}` })).json().id;

    for (const [n, zona] of [[1, z1], [2, z2], [3, z3]] as const) {
      const chave = `${marca}-ev-${n}`;
      const r = await enviar({ idempotenciaKey: chave, regraId: id, zonaId: zona });
      assert.equal(r.json().aceitos, 1, r.body);
      assert.equal(await zonaDoEvento(chave), zona);
    }
  });

  it('o agente NÃO consegue gravar em canal onde o critério não vale', async () => {
    // Sem esta checagem, um critério geral viraria passe para gravar
    // evento em qualquer área da loja.
    const id = (await criar([z1], { nome: `passe-${marca}` })).json().id;
    const chave = `${marca}-passe`;

    const r = await enviar({ idempotenciaKey: chave, regraId: id, zonaId: zSalao });

    assert.equal(r.statusCode, 200);
    assert.equal(r.json().aceitos, 0);
    assert.deepEqual(r.json().recusados, [chave], 'tem que voltar como recusado, para a fila do agente andar');
    assert.equal(await zonaDoEvento(chave), undefined);
  });

  it('evento de canal de onde o critério SAIU é recusado', async () => {
    // O dono tirou o critério do canal: a análise deixou de ser verificada
    // ali. Um alerta atrasado daquele canal não deve chegar.
    const id = (await criar([z1, z2], { nome: `saiu-${marca}` })).json().id;
    await tirar(id, z2);
    const chave = `${marca}-saiu`;

    const r = await enviar({ idempotenciaKey: chave, regraId: id, zonaId: z2 });

    assert.deepEqual(r.json().recusados, [chave]);
  });

  it('sem informar o canal, critério de UM canal vai para ele', async () => {
    const id = (await criar([z2], { nome: `um-${marca}` })).json().id;
    const chave = `${marca}-um`;

    await enviar({ idempotenciaKey: chave, regraId: id });

    assert.equal(await zonaDoEvento(chave), z2);
  });

  it('sem informar o canal, critério de VÁRIOS canais entra sem canal — não se perde', async () => {
    // É agente de versão anterior. O veredito é verdadeiro e não se
    // recupera; só falta dizer onde. Recusar jogaria fora o que dá para
    // guardar.
    const id = (await criar([z1, z2], { nome: `antigo-${marca}` })).json().id;
    const chave = `${marca}-antigo`;

    const r = await enviar({ idempotenciaKey: chave, regraId: id });

    assert.equal(r.json().aceitos, 1);
    assert.equal(await zonaDoEvento(chave), null);
  });

  it('critério de outra loja continua recusado', async () => {
    const naVizinha = await app.inject({
      method: 'POST', url: `/v1/zonas/${zOutraConta}/regras`,
      headers: { cookie: cookieOutraConta }, payload: BASE,
    });
    const chave = `${marca}-vizinha`;

    const r = await enviar({ idempotenciaKey: chave, regraId: naVizinha.json().id, zonaId: zOutraConta });

    assert.deepEqual(r.json().recusados, [chave]);
  });

  // ─────────────────── concorrência ───────────────────

  it('duas remoções simultâneas dos dois últimos canais desligam o critério', async () => {
    // O resultado que não pode acontecer: cada remoção ver "ainda sobra
    // um canal" e o critério ficar LIGADO sem valer em canal nenhum.
    //
    // Este teste confere o RESULTADO, não a trava em si: tirei o `for
    // update` da rota e ele continuou passando, porque o gatilho da versão
    // da configuração já serializa as duas transações. Fica como guarda do
    // comportamento, qualquer que seja o mecanismo que o garanta.
    const id = (await criar([z1, z2], { nome: `corrida-${marca}` })).json().id;
    await editar(id, { ativa: true });

    const [a, b] = await Promise.all([tirar(id, z1), tirar(id, z2)]);

    assert.equal(a.statusCode, 200, a.body);
    assert.equal(b.statusCode, 200, b.body);
    const regra = (await listar()).find((x) => x.id === id)!;
    assert.deepEqual(regra.alvos, []);
    assert.equal(regra.ativa, false, 'ficou ligado sem canal');
  });
});
