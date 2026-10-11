// GET /v1/lojas/:id/resultados — a tela "o que o Farol viu", com banco.
//
// A conta dos sinais está provada em resultados.test.ts, sem banco. Aqui se
// prova o que só o caminho inteiro mostra: que o resumo que o agente manda
// chega à tela somado do jeito certo, que os baldes são cortados no relógio
// da LOJA, que canal e critério certos se encontram, e que quem não é da
// loja — ou não é da gestão — não vê.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-resultados-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-resultados';
const SENHA = 'uma senha longa o bastante';
const FUSO = 'America/Sao_Paulo';

/** A hora cheia de `atras` horas atrás, escrita com o fuso da loja. */
function horaCheia(atras = 0): string {
  const cheia = Math.floor(Date.now() / 3_600_000) * 3_600_000 - atras * 3_600_000;
  // -03:00 fixo: o Brasil não tem horário de verão, e a hora cheia em UTC
  // é hora cheia também em qualquer fuso de hora inteira.
  return `${new Date(cheia - 3 * 3_600_000).toISOString().slice(0, 19)}-03:00`;
}

/** "2026-10-07T12:00:00" no relógio da loja, para comparar com o balde. */
function inicioDaHoraNaLoja(): string {
  const partes = new Intl.DateTimeFormat('sv-SE', {
    timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const p = (t: string) => partes.find((x) => x.type === t)!.value;
  return `${p('year')}-${p('month')}-${p('day')}T${p('hour')}:00:00`;
}

const zeros = {
  capturas: 0, semJuiz: 0, semQuadro: 0, semCena: 0, emSilencio: 0, repetidas: 0, jaJulgadas: 0,
  enfileiradas: 0, conformes: 0, naoConformes: 0, naoAvaliaveis: 0, falhas: 0, alertas: 0,
  somaConfianca: 0, comConfianca: 0, somaLatenciaMs: 0, comLatencia: 0, custoCentavos: 0,
  ultimoResultado: null, ultimoMotivo: null, ultimoImpedimento: null, ultimaEm: null,
};

describe('resultados da loja (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  let lojaId = '';
  let lojaNovaId = '';
  let cookie = '';
  let cookieSupervisao = '';
  let cookieExecucao = '';
  let cookieOutraConta = '';
  let token = '';
  let bancada = '';
  let produto = '';
  let montagem = { pontoId: '', zonaId: '' };
  let chapa = { pontoId: '', zonaId: '' };

  async function entrar(tenantId: string, email: string, nivel: string) {
    await app.inject({
      method: 'POST', url: '/v1/distribuicao/usuarios', headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId, nome: 'X', email, senha: SENHA, nivel },
    });
    const r = await app.inject({ method: 'POST', url: '/v1/sessao', payload: { email, senha: SENHA } });
    const b = r.headers['set-cookie'];
    return (Array.isArray(b) ? b[0]! : String(b)).split(';')[0]!;
  }

  const resultados = (periodo = '24h', comCookie = cookie, id = lojaId) =>
    app.inject({ method: 'GET', url: `/v1/lojas/${id}/resultados?periodo=${periodo}`, headers: { cookie: comCookie } });

  const doAgente = (url: string, payload: unknown) =>
    app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token}` }, payload });

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    app = criarApp(pool, { logger: false });
    await app.ready();

    const loja = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome: marca }, loja: { nome: 'Matriz' }, setores: [{ nome: 'Cozinha' }] },
    })).json();
    lojaId = loja.loja.id;
    cookie = await entrar(loja.tenantId, `dono-${marca}@e.com`, 'presidente');
    cookieSupervisao = await entrar(loja.tenantId, `sup-${marca}@e.com`, 'supervisao');
    cookieExecucao = await entrar(loja.tenantId, `exec-${marca}@e.com`, 'execucao');

    // Uma segunda loja na MESMA conta, sem nada: é a "loja nova".
    const nova = await pool.query(
      `insert into loja (tenant_id, nome) values ($1, 'Loja nova') returning id`, [loja.tenantId],
    );
    lojaNovaId = nova.rows[0].id;

    const vizinha = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome: `${marca}-vizinha` }, loja: { nome: 'Vizinha' }, setores: [{ nome: 'Cozinha' }] },
    })).json();
    cookieOutraConta = await entrar(vizinha.tenantId, `dono-${marca}-viz@e.com`, 'presidente');

    const canal = async (nome: string, numero: number) => {
      const r = await app.inject({
        method: 'POST', url: `/v1/setores/${loja.setores[0].id}/pontos`, headers: { cookie },
        payload: { nome, origem: 'dvr', canal: numero, host: '192.168.1.108' },
      });
      assert.equal(r.statusCode, 201, r.body);
      return { pontoId: r.json().id as string, zonaId: r.json().zonas[0].id as string };
    };
    montagem = await canal('Montagem', 1);
    chapa = await canal('Chapa', 2);

    const criterio = async (nome: string, tipo: string, zonaIds: string[], extra: Record<string, unknown> = {}) => {
      const r = await app.inject({
        method: 'POST', url: `/v1/lojas/${lojaId}/regras`, headers: { cookie },
        payload: { nome, tipo, criterio: `Texto de ${nome}.`, zonaIds, ...extra },
      });
      assert.equal(r.statusCode, 201, r.body);
      return r.json().id as string;
    };
    // O MESMO critério em dois canais.
    bancada = await criterio('Bancada limpa', 'estado', [montagem.zonaId, chapa.zonaId]);
    // E um de contagem que ninguém disse o que procurar. Hoje a API recusa
    // criar assim, mas há critério de ANTES dessa regra — é o caso que está
    // na loja de verdade. Para tê-lo aqui, cria-se certo e apaga-se o
    // parâmetro direto no banco, que é como a linha antiga está gravada.
    produto = await criterio('Produto', 'contagem', [montagem.zonaId], {
      parametros: { objeto: 'pessoa', minimo: 1, maximo: null },
    });
    await pool.query(`update regra set parametros = '{}'::jsonb where id = $1`, [produto]);
    const ligar = await app.inject({
      method: 'PATCH', url: `/v1/regras/${bancada}`, headers: { cookie }, payload: { ativa: true },
    });
    assert.equal(ligar.statusCode, 200, ligar.body);

    const agente = await app.inject({
      method: 'POST', url: '/v1/distribuicao/agentes', headers: { 'x-farol-admin': ADMIN },
      payload: { lojaId, nome: 'PC da loja' },
    });
    token = agente.json().token;
    await doAgente('/v1/agentes/ativar', { fingerprint: `fp-${marca}` });
    const bate = await doAgente('/v1/agentes/heartbeat', { versao: '0.9.4' });
    assert.equal(bate.statusCode, 200, bate.body);

    // O que o agente "olhou":
    const sobe = await doAgente('/v1/resumos', {
      resumos: [
        // Montagem, agora: 30 julgamentos, 4 fora do critério.
        {
          ...zeros, regraId: bancada, zonaId: montagem.zonaId, hora: horaCheia(0),
          capturas: 60, repetidas: 30, enfileiradas: 30, conformes: 24, naoConformes: 4, naoAvaliaveis: 2,
          alertas: 1, somaConfianca: 25.5, comConfianca: 30, somaLatenciaMs: 60_000, comLatencia: 30,
          ultimoResultado: 'nao_conforme', ultimoMotivo: 'restos na bancada', ultimaEm: new Date().toISOString(),
        },
        // Chapa, agora: a câmera só entrega a tela de sem sinal.
        {
          ...zeros, regraId: bancada, zonaId: chapa.zonaId, hora: horaCheia(0),
          capturas: 60, semCena: 60, ultimoImpedimento: 'a câmera entregou a tela de sem sinal',
        },
        // Montagem, três horas atrás: tudo conforme.
        {
          ...zeros, regraId: bancada, zonaId: montagem.zonaId, hora: horaCheia(3),
          capturas: 20, enfileiradas: 20, conformes: 20, somaConfianca: 18, comConfianca: 20,
          somaLatenciaMs: 40_000, comLatencia: 20,
        },
        // Montagem, três dias atrás: só entra no período de 7 dias.
        {
          ...zeros, regraId: bancada, zonaId: montagem.zonaId, hora: horaCheia(72),
          capturas: 50, enfileiradas: 50, conformes: 45, naoConformes: 5, somaConfianca: 44, comConfianca: 50,
        },
      ],
    });
    assert.deepEqual(sobe.json(), { aceitos: 4, recusados: [] }, sobe.body);
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  it('os totais são a soma do que o agente mandou no período', async () => {
    const r = await resultados();
    assert.equal(r.statusCode, 200, r.body);
    const d = r.json();

    assert.equal(d.periodo, '24h');
    assert.equal(d.temHistorico, true);
    assert.deepEqual(d.totais, {
      capturas: 140, analises: 50, conformes: 44, naoConformes: 4, naoAvaliaveis: 2, falhas: 0, alertas: 1,
    });
  });

  it('uma linha por critério e CANAL, do que mais ficou fora para o que menos', async () => {
    const { linhas } = (await resultados()).json();

    assert.deepEqual(linhas.map((l: { pontoNome: string }) => l.pontoNome), ['Montagem', 'Chapa']);
    const [m, c] = linhas;
    assert.equal(m.regraNome, 'Bancada limpa');
    assert.equal(m.capturas, 80, 'as duas horas da Montagem somadas');
    assert.equal(m.analises, 50);
    assert.equal(m.naoConformes, 4);
    assert.equal(m.confiancaMedia, 0.87, '(25,5 + 18) / 50 — soma sobre quantidade, não média de médias');
    assert.equal(m.latenciaMediaMs, 2000);
    assert.equal(m.marca, null);
    assert.equal(m.historico, false);

    assert.equal(c.capturas, 60);
    assert.equal(c.analises, 0);
    assert.equal(c.semImagem, 60);
    assert.equal(c.marca, 'sem_imagem', 'o canal da Chapa não herdou os números da Montagem');
  });

  it('a série tem TODOS os baldes, no relógio da loja, e fecha com os totais', async () => {
    const d = (await resultados()).json();
    const pontos = d.serie.pontos as Array<{ inicio: string; conformes: number; naoConformes: number; naoAvaliaveis: number }>;

    assert.equal(d.serie.passo, 'hora');
    assert.equal(pontos.length, 24, 'balde vazio aparece com zero, não some');
    assert.equal(pontos[23]!.inicio, inicioDaHoraNaLoja(), 'o último balde é a hora corrente NA LOJA');
    assert.deepEqual(
      { c: pontos[23]!.conformes, n: pontos[23]!.naoConformes, a: pontos[23]!.naoAvaliaveis },
      { c: 24, n: 4, a: 2 },
    );
    assert.equal(pontos[20]!.conformes, 20, 'três horas atrás');
    assert.equal(pontos[22]!.conformes + pontos[21]!.conformes, 0);

    const soma = (k: 'conformes' | 'naoConformes' | 'naoAvaliaveis') => pontos.reduce((s, p) => s + p[k], 0);
    assert.equal(soma('conformes'), d.totais.conformes);
    assert.equal(soma('naoConformes'), d.totais.naoConformes);
    assert.equal(soma('naoAvaliaveis'), d.totais.naoAvaliaveis);
  });

  it('em 7 dias entra o que ficou fora das 24 horas', async () => {
    const d = (await resultados('7d')).json();

    assert.equal(d.serie.passo, 'dia');
    assert.equal(d.serie.pontos.length, 7);
    assert.equal(d.totais.conformes, 89);
    assert.equal(d.totais.naoConformes, 9);
    const soma = d.serie.pontos.reduce((s: number, p: { conformes: number }) => s + p.conformes, 0);
    assert.equal(soma, 89, 'o gráfico e os cartões têm que dizer o mesmo número');
  });

  it('acusa a câmera sem imagem e o critério sem o que procurar', async () => {
    const { sinais } = (await resultados()).json();
    const porTipo = Object.fromEntries(sinais.map((s: { tipo: string }) => [s.tipo, s]));

    assert.deepEqual(sinais.map((s: { tipo: string }) => s.tipo), ['canal_sem_imagem', 'falta_dizer_o_que_procurar']);
    assert.equal(porTipo.canal_sem_imagem.pontoNome, 'Chapa');
    assert.equal(porTipo.canal_sem_imagem.gravidade, 'critico');
    assert.equal(porTipo.canal_sem_imagem.quantos, 1);
    assert.equal(porTipo.canal_sem_imagem.impedimento, 'a câmera entregou a tela de sem sinal');
    assert.ok(porTipo.canal_sem_imagem.desde, 'diz desde quando');
    assert.equal(porTipo.falta_dizer_o_que_procurar.regraNome, 'Produto');
  });

  it('a saúde: agente de pé, canais com imagem e critérios ligados', async () => {
    const d = (await resultados()).json();

    assert.equal(d.agentes.length, 1);
    assert.equal(d.agentes[0].estado, 'ativo');
    assert.equal(d.agentes[0].versao, '0.9.4');
    assert.ok(d.agentes[0].segundos_sem_bater < 60);
    assert.deepEqual(d.canais, { verificados: 2, comImagem: 1 });
    assert.deepEqual(d.criterios, { total: 2, ligados: 1, observando: 0 });
  });

  it('dos critérios ligados, diz quantos só observam — o desligado e o que já julga não entram', async () => {
    const por = (id: string, estado: string) => pool.query('update regra set estado = $2 where id = $1', [id, estado]);
    const criterios = async () => (await resultados()).json().criterios;
    try {
      // "Bancada limpa" está ligada; "Produto", desligado.
      await por(bancada, 'observando');
      assert.deepEqual(await criterios(), { total: 2, ligados: 1, observando: 1 });

      // Em ensaio (e medido, e valendo) o critério já julga: não é "só observa".
      for (const estado of ['ensaio', 'medido', 'valendo']) {
        await por(bancada, estado);
        assert.deepEqual(await criterios(), { total: 2, ligados: 1, observando: 0 }, estado);
      }

      // O desligado que estava observando não é um ligado que só observa.
      await por(produto, 'observando');
      assert.deepEqual(await criterios(), { total: 2, ligados: 1, observando: 0 });

      // Os dois ligados e observando: os dois contam.
      await pool.query('update regra set ativa = true where id = $1', [produto]);
      await por(bancada, 'observando');
      assert.deepEqual(await criterios(), { total: 2, ligados: 2, observando: 2 });

      // Sem canal ativo, o critério não entra no total — nem aqui. ("Produto" só vale no canal da montagem.)
      await pool.query('update ponto set ativo = false where id = $1', [montagem.pontoId]);
      assert.deepEqual(await criterios(), { total: 1, ligados: 1, observando: 1 });
    } finally {
      await pool.query('update ponto set ativo = true where id = $1', [montagem.pontoId]);
      await por(bancada, 'valendo');
      await por(produto, 'valendo');
      await pool.query('update regra set ativa = false where id = $1', [produto]);
    }
  });

  it('agente que parou de bater vira o sinal, e a câmera deixa de levar a culpa', async () => {
    await pool.query(`update agente set ultimo_heartbeat = now() - interval '2 hours' where loja_id = $1`, [lojaId]);
    try {
      const { sinais } = (await resultados()).json();
      const tipos = sinais.map((s: { tipo: string }) => s.tipo);
      assert.equal(tipos[0], 'agente_fora');
      assert.ok(!tipos.includes('canal_sem_imagem'), 'sem agente, toda câmera "parou": a causa é uma só');
    } finally {
      await doAgente('/v1/agentes/heartbeat', {});
    }
  });

  it('as últimas vezes fora do critério, com o que houve com o aviso', async () => {
    const destino = await app.inject({
      method: 'POST', url: `/v1/lojas/${lojaId}/destinos`, headers: { cookie },
      payload: { tipo: 'email', nome: 'Gerência', endereco: `gerencia-${marca}@e.com` },
    });
    assert.equal(destino.statusCode, 201, destino.body);
    const politica = await app.inject({
      method: 'POST', url: `/v1/lojas/${lojaId}/politicas`, headers: { cookie },
      payload: { severidade: null, prioridade: null, enviar: true, destinoId: destino.json().destino.id },
    });
    assert.equal(politica.statusCode, 201, politica.body);

    const evento = (quando: Date, chave: string, veredito: string, zonaId: string, motivo: string) => ({
      idempotenciaKey: `${marca}-${chave}`, regraId: bancada, zonaId, ocorridoEm: quando.toISOString(),
      veredito, confianca: 0.91, motivo,
    });
    const agora = new Date();
    const sobe = await doAgente('/v1/eventos', {
      eventos: [
        evento(new Date(agora.getTime() - 60_000), 'a', 'nao_conforme', montagem.zonaId, 'restos na bancada'),
        evento(new Date(agora.getTime() - 30_000), 'b', 'nao_conforme', chapa.zonaId, 'utensílio sujo'),
        evento(agora, 'c', 'conforme', montagem.zonaId, 'tudo limpo'),
      ],
    });
    assert.equal(sobe.statusCode, 200, sobe.body);

    const { ocorrencias } = (await resultados()).json();

    assert.equal(ocorrencias.length, 2, 'o conforme não é ocorrência');
    assert.deepEqual(ocorrencias.map((o: { pontoNome: string }) => o.pontoNome), ['Chapa', 'Montagem'], 'a mais nova primeiro, cada uma no seu canal');
    assert.deepEqual(ocorrencias.map((o: { pontoId: string }) => o.pontoId), [chapa.pontoId, montagem.pontoId], 'e diz QUAL canal, não só o nome');
    assert.equal(ocorrencias[0].regraNome, 'Bancada limpa');
    assert.equal(ocorrencias[0].motivo, 'utensílio sujo');
    assert.equal(ocorrencias[0].confianca, 0.91);
    assert.equal(ocorrencias[0].aviso, 'pendente', 'o aviso foi criado e ainda não saiu');
  });

  it('loja nova: nada de histórico, série zerada e o aviso de que falta o agente', async () => {
    const d = (await resultados('24h', cookie, lojaNovaId)).json();

    assert.equal(d.temHistorico, false);
    assert.equal(d.totais.capturas, 0);
    assert.equal(d.serie.pontos.length, 24);
    assert.deepEqual(d.linhas, []);
    assert.deepEqual(d.sinais.map((s: { tipo: string }) => s.tipo), ['sem_agente']);
    assert.deepEqual(d.canais, { verificados: 0, comImagem: 0 });
  });

  it('critério excluído sai dos sinais e fica nos números como histórico', async () => {
    const apagar = await app.inject({ method: 'DELETE', url: `/v1/regras/${produto}`, headers: { cookie } });
    assert.equal(apagar.statusCode, 200, apagar.body);

    const d = (await resultados()).json();
    assert.ok(!d.sinais.some((s: { tipo: string }) => s.tipo === 'falta_dizer_o_que_procurar'));
    assert.deepEqual(d.criterios, { total: 1, ligados: 1, observando: 0 });
    assert.equal(d.totais.conformes, 44, 'excluir um critério não mexe no que os outros registraram');
  });

  it('supervisão vê; execução não', async () => {
    assert.equal((await resultados('24h', cookieSupervisao)).statusCode, 200);

    const r = await resultados('24h', cookieExecucao);
    assert.equal(r.statusCode, 403);
    assert.equal(r.json().erro, 'sem_permissao');
    assert.equal(r.json().totais, undefined, 'nem um número pode vazar junto com a recusa');
  });

  it('loja de outra conta é indistinguível de loja que não existe', async () => {
    const outra = await resultados('24h', cookieOutraConta);
    const inexistente = await resultados('24h', cookie, randomUUID());
    assert.equal(outra.statusCode, 404);
    assert.deepEqual(outra.json(), inexistente.json());
  });

  it('sem sessão, período desconhecido e identificador malformado', async () => {
    assert.equal((await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}/resultados` })).statusCode, 401);
    assert.equal((await resultados('30d')).statusCode, 400);
    assert.equal((await resultados('24h', cookie, 'abc')).statusCode, 404);
  });

  it('sem dizer o período, vale 24 horas', async () => {
    const r = await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}/resultados`, headers: { cookie } });
    assert.equal(r.json().periodo, '24h');
  });
});
