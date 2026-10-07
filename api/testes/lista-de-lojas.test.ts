// GET /v1/lojas — o que a moldura do console e a lista de lojas mostram.
//
// A lista traz, de cada loja, a saúde do agente e o resultado das últimas
// 24 horas. Aqui se prova o que só o banco mostra:
//
//   - quantos critérios e canais a loja tem (o excluído não conta);
//   - há quanto tempo o agente não bate — o do que bateu por ÚLTIMO, e só
//     dos que estão ativos;
//   - o resultado de 24 horas, somado, sem o que é mais velho que isso;
//   - que execução NÃO recebe o resultado por esta porta lateral
//     (a tela de resultados já é fechada para ela);
//   - que nenhum número de outra conta entra.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-lista-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-lista';
const SENHA = 'uma senha longa o bastante';

/** A hora cheia de `atras` horas atrás, no fuso de Brasília. */
function horaCheia(atras = 0): string {
  const cheia = Math.floor(Date.now() / 3_600_000) * 3_600_000 - atras * 3_600_000;
  return `${new Date(cheia - 3 * 3_600_000).toISOString().slice(0, 19)}-03:00`;
}

const zeros = {
  capturas: 0, semJuiz: 0, semQuadro: 0, semCena: 0, emSilencio: 0, repetidas: 0, jaJulgadas: 0,
  enfileiradas: 0, conformes: 0, naoConformes: 0, naoAvaliaveis: 0, falhas: 0, alertas: 0,
  somaConfianca: 0, comConfianca: 0, somaLatenciaMs: 0, comLatencia: 0, custoCentavos: 0,
  ultimoResultado: null, ultimoMotivo: null, ultimoImpedimento: null, ultimaEm: null,
};

type LojaNaLista = {
  id: string;
  nome: string;
  setores: number;
  pontos: number;
  criterios: number;
  agentes: number;
  segundos_sem_bater: number | null;
  resultado_24h: { conformes: number; naoConformes: number; naoAvaliaveis: number } | null;
};

describe('lista de lojas (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  let tenantId = '';
  let matriz = '';
  let filial = '';
  let agenteDaMatriz = '';
  let cookie = '';
  let cookieSupervisao = '';
  let cookieExecucao = '';
  let cookieVizinho = '';

  async function entrar(tenant: string, email: string, nivel: string) {
    await app.inject({
      method: 'POST', url: '/v1/distribuicao/usuarios', headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId: tenant, nome: 'X', email, senha: SENHA, nivel },
    });
    const r = await app.inject({ method: 'POST', url: '/v1/sessao', payload: { email, senha: SENHA } });
    const b = r.headers['set-cookie'];
    return (Array.isArray(b) ? b[0]! : String(b)).split(';')[0]!;
  }

  async function lista(comCookie = cookie): Promise<LojaNaLista[]> {
    const r = await app.inject({ method: 'GET', url: '/v1/lojas', headers: { cookie: comCookie } });
    assert.equal(r.statusCode, 200, r.body);
    return r.json().lojas;
  }

  const aLoja = async (id: string, comCookie = cookie) => (await lista(comCookie)).find((l) => l.id === id)!;

  /** Monta uma loja com um canal, um critério, um agente batendo e o que ele "olhou". */
  async function lojaComMovimento(nomeDoTenant: string, numeros: { conformes: number; naoConformes: number }) {
    const conta = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome: nomeDoTenant }, loja: { nome: 'Matriz' }, setores: [{ nome: 'Cozinha' }] },
    })).json();
    const dono = await entrar(conta.tenantId, `dono-${randomUUID().slice(0, 8)}@e.com`, 'presidente');

    const canal = async (nome: string, numero: number) => {
      const r = await app.inject({
        method: 'POST', url: `/v1/setores/${conta.setores[0].id}/pontos`, headers: { cookie: dono },
        payload: { nome, origem: 'dvr', canal: numero, host: '192.168.1.108' },
      });
      assert.equal(r.statusCode, 201, r.body);
      return { pontoId: r.json().id as string, zonaId: r.json().zonas[0].id as string };
    };
    const criterio = async (nome: string, zonaIds: string[]) => {
      const r = await app.inject({
        method: 'POST', url: `/v1/lojas/${conta.loja.id}/regras`, headers: { cookie: dono },
        payload: { nome, tipo: 'estado', criterio: `Texto de ${nome}.`, zonaIds },
      });
      assert.equal(r.statusCode, 201, r.body);
      return r.json().id as string;
    };

    const montagem = await canal('Montagem', 1);
    const sobra = await canal('Canal que sai', 2);
    const bancada = await criterio('Bancada limpa', [montagem.zonaId]);
    await criterio('Uso de touca', [montagem.zonaId]);
    const some = await criterio('Critério que sai', [montagem.zonaId]);

    // Um critério e um canal excluídos: ficam no banco (o histórico é deles),
    // mas não contam na lista.
    for (const url of [`/v1/regras/${some}`, `/v1/pontos/${sobra.pontoId}`]) {
      const r = await app.inject({ method: 'DELETE', url, headers: { cookie: dono } });
      assert.ok(r.statusCode < 300, `${url}: ${r.body}`);
    }

    const agente = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/agentes', headers: { 'x-farol-admin': ADMIN },
      payload: { lojaId: conta.loja.id, nome: 'PC da loja' },
    })).json();
    const doAgente = (url: string, payload: unknown) =>
      app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${agente.token}` }, payload });
    await doAgente('/v1/agentes/ativar', { fingerprint: `fp-${randomUUID()}` });
    const bate = await doAgente('/v1/agentes/heartbeat', { versao: '0.9.4' });
    assert.equal(bate.statusCode, 200, bate.body);

    const sobe = await doAgente('/v1/resumos', {
      resumos: [
        // agora
        {
          ...zeros, regraId: bancada, zonaId: montagem.zonaId, hora: horaCheia(0),
          capturas: 40, enfileiradas: 30, conformes: numeros.conformes, naoConformes: numeros.naoConformes,
          naoAvaliaveis: 2,
        },
        // cinco horas atrás: ainda dentro das 24 horas
        { ...zeros, regraId: bancada, zonaId: montagem.zonaId, hora: horaCheia(5), capturas: 20, enfileiradas: 20, conformes: 20 },
        // três dias atrás: fora das 24 horas — não pode entrar na conta
        {
          ...zeros, regraId: bancada, zonaId: montagem.zonaId, hora: horaCheia(72),
          capturas: 500, enfileiradas: 500, conformes: 400, naoConformes: 100,
        },
      ],
    });
    assert.deepEqual(sobe.json(), { aceitos: 3, recusados: [] }, sobe.body);

    return { tenantId: conta.tenantId as string, lojaId: conta.loja.id as string, agenteId: agente.id as string, dono };
  }

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    app = criarApp(pool, { logger: false });
    await app.ready();

    const minha = await lojaComMovimento(marca, { conformes: 24, naoConformes: 4 });
    tenantId = minha.tenantId;
    matriz = minha.lojaId;
    cookie = minha.dono;
    cookieSupervisao = await entrar(tenantId, `sup-${marca}@e.com`, 'supervisao');
    cookieExecucao = await entrar(tenantId, `exec-${marca}@e.com`, 'execucao');
    const a = await pool.query(`select id from agente where loja_id = $1`, [matriz]);
    assert.equal(a.rows.length, 1);
    agenteDaMatriz = a.rows[0].id;

    // Uma segunda loja na MESMA conta, sem nada.
    filial = (await pool.query(
      `insert into loja (tenant_id, nome) values ($1, 'Filial') returning id`, [tenantId],
    )).rows[0].id;

    // Outra conta, com números bem diferentes: se vazar, aparece.
    const vizinha = await lojaComMovimento(`${marca}-vizinha`, { conformes: 1, naoConformes: 29 });
    cookieVizinho = vizinha.dono;
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  it('conta canais e critérios da loja, sem o que foi excluído', async () => {
    const l = await aLoja(matriz);

    assert.equal(l.setores, 1);
    assert.equal(l.pontos, 1, 'o canal excluído não conta');
    assert.equal(l.criterios, 2, 'o critério excluído não conta');
  });

  it('diz há quanto tempo o agente não bate', async () => {
    const l = await aLoja(matriz);

    assert.equal(l.agentes, 1);
    assert.ok(l.segundos_sem_bater !== null && l.segundos_sem_bater >= 0 && l.segundos_sem_bater < 60, String(l.segundos_sem_bater));
  });

  it('o resultado de 24 horas é a soma do período — e só dele', async () => {
    const l = await aLoja(matriz);

    // 24 + 20 conformes; os 400 de três dias atrás ficam de fora.
    assert.deepEqual(l.resultado_24h, { conformes: 44, naoConformes: 4, naoAvaliaveis: 2 });
  });

  it('loja sem agente e sem movimento vem com nulo, não com zero inventado', async () => {
    const l = await aLoja(filial);

    assert.equal(l.agentes, 0);
    assert.equal(l.segundos_sem_bater, null);
    assert.equal(l.criterios, 0);
    assert.equal(l.resultado_24h, null);
  });

  it('agente cadastrado que nunca bateu: existe, mas não há "há quanto tempo"', async () => {
    await pool.query(
      `insert into agente (loja_id, nome, fingerprint, estado) values ($1, 'PC por instalar', $2, 'novo')`,
      [filial, `fp-novo-${marca}`],
    );
    const l = await aLoja(filial);

    assert.equal(l.agentes, 1);
    assert.equal(l.segundos_sem_bater, null);
  });

  it('com dois agentes, vale o que bateu por último', async () => {
    await pool.query(
      `insert into agente (loja_id, nome, fingerprint, estado, ultimo_heartbeat)
       values ($1, 'PC reserva', $2, 'ativo', now() - interval '2 hours')`,
      [matriz, `fp-reserva-${marca}`],
    );
    const comUmVivo = await aLoja(matriz);
    assert.equal(comUmVivo.agentes, 2);
    assert.ok(comUmVivo.segundos_sem_bater! < 60, 'o principal acabou de bater');

    // O principal para há três horas: sobra o reserva, de duas horas atrás.
    await pool.query(`update agente set ultimo_heartbeat = now() - interval '3 hours' where id = $1`, [agenteDaMatriz]);
    const semVivo = await aLoja(matriz);
    assert.ok(
      semVivo.segundos_sem_bater! >= 7200 && semVivo.segundos_sem_bater! < 7260,
      `esperava cerca de 7200, veio ${semVivo.segundos_sem_bater}`,
    );
  });

  it('agente bloqueado não segura a loja como viva', async () => {
    // Só o bloqueado bateu agora; os ativos estão a horas de distância.
    await pool.query(
      `insert into agente (loja_id, nome, fingerprint, estado, ultimo_heartbeat)
       values ($1, 'PC bloqueado', $2, 'bloqueado', now())`,
      [matriz, `fp-bloqueado-${marca}`],
    );
    const l = await aLoja(matriz);

    assert.equal(l.agentes, 3);
    assert.ok(l.segundos_sem_bater! >= 7200, `o bloqueado contou: ${l.segundos_sem_bater}`);
  });

  it('supervisão recebe o resultado; execução não — nem por esta porta', async () => {
    const paraSupervisao = await aLoja(matriz, cookieSupervisao);
    assert.deepEqual(paraSupervisao.resultado_24h, { conformes: 44, naoConformes: 4, naoAvaliaveis: 2 });

    const paraExecucao = await lista(cookieExecucao);
    assert.equal(paraExecucao.length, 2, 'execução continua vendo as lojas');
    for (const l of paraExecucao) {
      assert.equal(l.resultado_24h, null, `${l.nome}: execução recebeu resultado`);
    }
    // A saúde do agente não é resultado: quem opera precisa saber se a
    // loja está sendo verificada.
    assert.equal(paraExecucao.find((l) => l.id === matriz)!.agentes, 3);
  });

  it('cada conta vê só as próprias lojas, com os próprios números', async () => {
    const minhas = await lista();
    assert.deepEqual(minhas.map((l) => l.nome).sort(), ['Filial', 'Matriz']);

    const doVizinho = await lista(cookieVizinho);
    assert.equal(doVizinho.length, 1);
    assert.deepEqual(doVizinho[0]!.resultado_24h, { conformes: 21, naoConformes: 29, naoAvaliaveis: 2 });
    assert.notEqual(doVizinho[0]!.id, matriz);
  });

  it('sem sessão não há lista', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/lojas' });
    assert.equal(r.statusCode, 401);
  });
});
