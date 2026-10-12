// O estado do critério: observar → ensaiar → medir → avisar.
//
// A19, onda 1, fatia 1.2. Pedido do dono (08/10/2026): "nada de aplicar
// alterações antes de o projeto analisar de verdade os processos". O que tem
// de ficar provado aqui:
//
//   - os critérios de hoje ficam como estão: quem já existia está valendo, e
//     o cadastro de hoje (que não fala em estado) cria como sempre criou;
//   - uma pessoa leva o critério a "observando" e a "em ensaio", e de volta.
//     A "medido" e a "valendo" só se chega com o acerto medido: nenhuma rota
//     do console promove;
//   - critério que não está valendo só desce para o agente que DECLARA saber
//     o que é estado. O agente antigo avisaria do mesmo jeito — para ele,
//     esse critério não existe;
//   - a olhada do critério que só observa chega ao resumo por hora e às
//     análises com o número que o agente mandou;
//   - o aviso nasce no servidor, e ali também só avisa quem está valendo: o
//     evento de critério em outro estado é guardado e não vira aviso.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { ESTADO_DE_SEMPRE, ESTADOS, ESTADOS_QUE_SE_ESCOLHE, SABE_ESTADOS, estadoNaoCabe, lerSabe } from '../src/estado.js';
import { validarResumo } from '../src/rotas/resumos.js';

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-estado-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-estado';
const SENHA = 'uma senha longa o bastante';

const CONTRATO = JSON.parse(readFileSync(new URL('../../contratos/estado-do-criterio.json', import.meta.url), 'utf8')) as {
  estados: string[]; julga: string[]; avisa: string[]; seEscolhe: string[]; deSempre: string; sabe: string;
  configuracao: { regra: { estado: string } };
};
const RESUMO = JSON.parse(readFileSync(new URL('../../contratos/resumo-do-agente.json', import.meta.url), 'utf8')) as Record<string, unknown>;

// ───────────────────── as regras, sem banco ─────────────────────

describe('o estado do critério — o que cabe', () => {
  it('os estados são os do contrato, e o agente lê o mesmo arquivo', () => {
    assert.deepEqual([...ESTADOS], CONTRATO.estados);
    assert.deepEqual([...ESTADOS_QUE_SE_ESCOLHE], CONTRATO.seEscolhe);
    assert.equal(ESTADO_DE_SEMPRE, CONTRATO.deSempre);
    assert.equal(SABE_ESTADOS, CONTRATO.sabe);
    assert.deepEqual(CONTRATO.avisa, ['valendo'], 'só um estado avisa');
    assert.deepEqual(CONTRATO.julga, ['ensaio', 'medido', 'valendo']);
  });

  it('uma pessoa leva a observando e a ensaio, de qualquer estado; e de volta', () => {
    for (const de of [null, ...ESTADOS]) {
      for (const para of ['observando', 'ensaio']) assert.equal(estadoNaoCabe(para, de), null, `${de} → ${para}`);
    }
    // Sem estado no pedido, não há o que conferir.
    for (const de of [null, 'valendo']) {
      assert.equal(estadoNaoCabe(undefined, de), null);
      assert.equal(estadoNaoCabe(null, de), null);
    }
  });

  it('a medido e a valendo só se chega com o acerto medido', () => {
    for (const para of ['medido', 'valendo']) {
      for (const de of [null, 'observando', 'ensaio']) {
        const r = estadoNaoCabe(para, de);
        assert.equal(r?.erro, 'so_com_medida', `${de} → ${para}`);
        assert.match(r!.mensagem, new RegExp(`só chega a "${para}" com o acerto medido, pelo banco de provas`));
      }
    }
    // Entre os dois também não: quem está medido não vira valendo à mão, nem o contrário.
    assert.equal(estadoNaoCabe('valendo', 'medido')?.erro, 'so_com_medida');
    assert.equal(estadoNaoCabe('medido', 'valendo')?.erro, 'so_com_medida');
    // Pedir o estado em que ele JÁ está não muda nada: é o que a tela manda ao salvar sem mexer.
    for (const e of ESTADOS) assert.equal(estadoNaoCabe(e, e), null, e);
  });

  it('o que não é estado é recusado dizendo a lista', () => {
    for (const torto of ['Valendo', 'ligado', '', 1, true, ['ensaio'], {}]) {
      const r = estadoNaoCabe(torto, 'valendo');
      assert.deepEqual(r, { erro: 'validacao', mensagem: 'estado: um de observando, ensaio, medido, valendo' }, String(torto));
    }
  });

  it('o que o agente diz que sabe é lido sem confiar no formato', () => {
    assert.deepEqual([...lerSabe('estados')], ['estados']);
    assert.deepEqual([...lerSabe(' estados , contexto ')], ['estados', 'contexto']);
    assert.deepEqual([...lerSabe('Estados,es tados,estados;drop,,a'.repeat(1))], ['a'], 'só palavra simples, em minúsculas');
    for (const nada of [undefined, null, 7, ['estados'], { sabe: 'estados' }, '']) assert.equal(lerSabe(nada).size, 0);
    assert.equal(lerSabe(Array.from({ length: 40 }, (_, i) => `x${i}`).join(',')).size, 12, 'e com teto');
  });

  it('o resumo aceita as olhadas observadas, e agente antigo continua aceito', () => {
    assert.equal(RESUMO.observadas, 5, 'o contrato traz o desfecho novo');
    assert.equal(validarResumo(RESUMO, 0), null);
    const { observadas: _, ...antigo } = RESUMO;
    assert.equal(validarResumo(antigo, 0), null);
    for (const ruim of [-1, 1.5, '5', 100_001]) {
      assert.match(String(validarResumo({ ...RESUMO, observadas: ruim }, 0)), /resumos\[0\]\.observadas: inteiro de 0 a 100000/, String(ruim));
    }
    // O pior caso: a hora em que o critério SÓ observou. Nada julgado, nada gasto, nenhum último veredito.
    const soObservou = {
      regraId: RESUMO.regraId, zonaId: RESUMO.zonaId, hora: RESUMO.hora,
      capturas: 120, semJuiz: 0, semQuadro: 0, semCena: 0, semCondicao: 30, observadas: 90, emSilencio: 0, repetidas: 0,
      jaJulgadas: 0, enfileiradas: 0, conformes: 0, naoConformes: 0, naoAvaliaveis: 0, falhas: 0, alertas: 0,
      somaConfianca: 0, comConfianca: 0, somaLatenciaMs: 0, comLatencia: 0, custoCentavos: 0,
      julgadasLoja: 0, julgadasNuvem: 0, somaMedida: 0, comMedida: 0, maxMedida: null, extras: 0, extrasFora: 0,
      ultimoResultado: null, ultimoMotivo: null, ultimoImpedimento: null, ultimaEm: null,
    };
    assert.equal(validarResumo(soObservou, 0), null);
  });
});

// ───────────────────────── com o banco ─────────────────────────

type Regra = { id: string; nome: string; estado: string; ativa: boolean };

describe('o estado do critério (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  let lojaId = '';
  let zonaId = '';
  let pontoId = '';
  let cookie = '';
  let cookiePresidente = '';
  let cookieSupervisao = '';
  let cookieVizinho = '';
  let token = '';

  async function entrar(tenant: string, email: string, nivel: string) {
    await app.inject({
      method: 'POST', url: '/v1/distribuicao/usuarios', headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId: tenant, nome: 'X', email, senha: SENHA, nivel },
    });
    const r = await app.inject({ method: 'POST', url: '/v1/sessao', payload: { email, senha: SENHA } });
    const b = r.headers['set-cookie'];
    return (Array.isArray(b) ? b[0]! : String(b)).split(';')[0]!;
  }

  const criar = (corpo: Record<string, unknown>, comCookie = cookie) =>
    app.inject({
      method: 'POST', url: `/v1/lojas/${lojaId}/regras`, headers: { cookie: comCookie },
      payload: { tipo: 'estado', criterio: 'A bancada fica limpa.', zonaIds: [zonaId], quando: 'sempre', ...corpo },
    });
  const criarNaZona = (corpo: Record<string, unknown>) =>
    app.inject({
      method: 'POST', url: `/v1/zonas/${zonaId}/regras`, headers: { cookie },
      payload: { tipo: 'estado', criterio: 'A bancada fica limpa.', quando: 'sempre', ...corpo },
    });
  const editar = (id: string, corpo: Record<string, unknown>, comCookie = cookie) =>
    app.inject({ method: 'PATCH', url: `/v1/regras/${id}`, headers: { cookie: comCookie }, payload: corpo });
  const daLista = async (id: string): Promise<Regra> =>
    (await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}/regras`, headers: { cookie } })).json().regras.find((r: Regra) => r.id === id);
  const noBanco = async (id: string) => (await pool.query(`select estado from regra where id = $1`, [id])).rows[0].estado as string;
  const versao = async () => (await pool.query(`select config_versao from loja where id = $1`, [lojaId])).rows[0].config_versao as number;

  const doAgente = (metodo: 'GET' | 'POST', url: string, payload?: unknown) =>
    app.inject({ method: metodo, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });
  /** nome → estado, como o agente recebe. `sabe` é o que ele declara. */
  async function noAgente(sabe?: string): Promise<Record<string, string>> {
    const r = await doAgente('GET', `/v1/agentes/configuracao${sabe === undefined ? '' : `?sabe=${sabe}`}`);
    assert.equal(r.statusCode, 200, r.body);
    const zona = r.json().pontos.find((p: { id: string }) => p.id === pontoId).zonas.find((z: { id: string }) => z.id === zonaId);
    return Object.fromEntries(zona.regras.map((x: { nome: string; estado: string }) => [x.nome, x.estado]));
  }

  /** Um critério LIGADO, no estado pedido (`null` = como o cadastro de hoje cria). */
  async function ligado(nome: string, estado: string | null): Promise<string> {
    const r = await criar({ nome, ...(estado ? { estado } : {}) });
    assert.equal(r.statusCode, 201, r.body);
    const id = r.json().id as string;
    assert.equal((await editar(id, { ativa: true })).statusCode, 200);
    return id;
  }

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    app = criarApp(pool, { logger: false });
    await app.ready();

    const conta = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome: marca }, loja: { nome: 'Matriz' }, setores: [{ nome: 'Cozinha' }] },
    })).json();
    lojaId = conta.loja.id;
    cookie = await entrar(conta.tenantId, `ger-${marca}@e.com`, 'gerente');
    cookiePresidente = await entrar(conta.tenantId, `pre-${marca}@e.com`, 'presidente');
    cookieSupervisao = await entrar(conta.tenantId, `sup-${marca}@e.com`, 'supervisao');
    const ponto = (await app.inject({
      method: 'POST', url: `/v1/setores/${conta.setores[0].id}/pontos`, headers: { cookie },
      payload: { nome: 'Bancada', origem: 'dvr', canal: 4, host: '192.168.1.108' },
    })).json();
    pontoId = ponto.id;
    zonaId = ponto.zonas[0].id;

    const vizinha = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome: `${marca}-vizinha` }, loja: { nome: 'Vizinha' }, setores: [] },
    })).json();
    cookieVizinho = await entrar(vizinha.tenantId, `ger-${marca}-viz@e.com`, 'gerente');

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

  // ─────────────────────── os de hoje ficam como estão ───────────────────────

  it('o cadastro de hoje, que não fala em estado, cria o critério valendo', async () => {
    const r = await criar({ nome: `Sem estado ${marca}` });
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json().estado, 'valendo');
    assert.equal(r.json().ativa, false, 'e desligado, como sempre nasceu');
    assert.equal((await daLista(r.json().id)).estado, 'valendo', 'a lista de critérios traz o estado');

    const pelaZona = await criarNaZona({ nome: `Pela zona ${marca}` });
    assert.equal(pelaZona.json().estado, 'valendo');

    // A tela do canal também recebe: é ali que o estado aparece ao lado do critério.
    const canal = (await app.inject({ method: 'GET', url: `/v1/pontos/${pontoId}`, headers: { cookie } })).json();
    const doCanal = canal.zonas[0].criterios.find((c: { id: string }) => c.id === r.json().id);
    assert.equal(doCanal.estado, 'valendo');

    // No banco, valor de fora da lista não entra nem por SQL (23514 = check).
    await assert.rejects(pool.query(`update regra set estado = 'ligado' where id = $1`, [r.json().id]), { code: '23514' });
  });

  // ─────────────────────── quem escolhe o quê ───────────────────────

  it('o critério nasce em observando ou em ensaio quando se pede; valendo e medido não se pedem', async () => {
    for (const estado of ['observando', 'ensaio']) {
      const r = await criar({ nome: `Nasce ${estado} ${marca}`, estado });
      assert.equal(r.statusCode, 201, r.body);
      assert.equal(r.json().estado, estado);
      assert.equal(await noBanco(r.json().id), estado);
      const z = await criarNaZona({ nome: `Zona ${estado} ${marca}`, estado });
      assert.deepEqual([z.statusCode, z.json().estado], [201, estado]);
    }
    const antes = (await pool.query(`select count(*)::int as n from regra where loja_id = $1`, [lojaId])).rows[0].n;
    for (const estado of ['valendo', 'medido']) {
      for (const rota of [criar, criarNaZona]) {
        const r = await rota({ nome: `Não nasce ${estado} ${marca}`, estado });
        assert.equal(r.statusCode, 422, `${estado}: ${r.body}`);
        assert.equal(r.json().erro, 'so_com_medida');
      }
    }
    const torto = await criar({ nome: `Torto ${marca}`, estado: 'ligado' });
    assert.deepEqual([torto.statusCode, torto.json().erro], [422, 'validacao']);
    const depois = (await pool.query(`select count(*)::int as n from regra where loja_id = $1`, [lojaId])).rows[0].n;
    assert.equal(depois, antes, 'pedido recusado não cria nada');
  });

  it('descer é sempre aceito; subir a medido ou a valendo, nunca — nem para o presidente', async () => {
    const id = await ligado(`Desce e não sobe ${marca}`, null);
    assert.equal(await noBanco(id), 'valendo');

    // Salvar sem mexer no estado (a tela manda o que ele já é) não é recusado.
    const igual = await editar(id, { estado: 'valendo', nome: `Desce e não sobe ${marca} ` });
    assert.equal(igual.statusCode, 200, igual.body);

    const antes = await versao();
    const desceu = await editar(id, { estado: 'ensaio' });
    assert.deepEqual([desceu.statusCode, desceu.json().estado, desceu.json().ativa], [200, 'ensaio', true]);
    assert.ok((await versao()) > antes, 'mudar o estado faz o agente puxar a configuração');

    for (const [quem, comCookie] of [['gerente', cookie], ['presidente', cookiePresidente]] as const) {
      for (const estado of ['valendo', 'medido']) {
        const r = await editar(id, { estado }, comCookie);
        assert.equal(r.statusCode, 422, `${quem} → ${estado}: ${r.body}`);
        assert.equal(r.json().erro, 'so_com_medida');
      }
    }
    assert.equal(await noBanco(id), 'ensaio', 'a recusa não mudou nada');

    assert.equal((await editar(id, { estado: 'observando' })).json().estado, 'observando');
    assert.equal((await editar(id, { estado: 'ensaio' })).json().estado, 'ensaio');

    // Mexer em outro campo não toca no estado; e pedido recusado por causa do estado não muda o resto.
    assert.equal((await editar(id, { cooldownMin: 7 })).json().estado, 'ensaio');
    const misto = await editar(id, { nome: 'Outro nome', estado: 'valendo' });
    assert.equal(misto.statusCode, 422);
    assert.notEqual((await daLista(id)).nome, 'Outro nome');
  });

  it('só quem configura muda o estado; outra conta nem sabe que o critério existe', async () => {
    const id = await ligado(`Quem pode ${marca}`, 'observando');
    assert.equal((await editar(id, { estado: 'ensaio' }, cookieSupervisao)).statusCode, 403);
    assert.equal((await editar(id, { estado: 'ensaio' }, cookieVizinho)).statusCode, 404);
    assert.equal(await noBanco(id), 'observando');
  });

  // ─────────────────────── o que desce para o agente ───────────────────────

  it('o agente que não declara nada só recebe o que está valendo', async () => {
    const nomes = { obs: `D obs ${marca}`, ens: `D ens ${marca}`, val: `D val ${marca}`, med: `D med ${marca}`, desl: `D desligado ${marca}` };
    await ligado(nomes.obs, 'observando');
    await ligado(nomes.ens, 'ensaio');
    await ligado(nomes.val, null);
    // "medido" não se escolhe: aqui ele é posto pelo banco, como o banco de provas vai fazer.
    const medido = await ligado(nomes.med, 'ensaio');
    await pool.query(`update regra set estado = 'medido' where id = $1`, [medido]);
    // Desligado não desce para ninguém, em estado nenhum.
    const desligado = (await criar({ nome: nomes.desl, estado: 'ensaio' })).json().id as string;
    assert.equal((await daLista(desligado)).ativa, false);

    const meus = (todos: Record<string, string>) => Object.fromEntries(Object.entries(todos).filter(([nome]) => Object.values(nomes).includes(nome)));

    // O agente de antes dos estados: para ele, critério que desce AVISA.
    assert.deepEqual(meus(await noAgente()), { [nomes.val]: 'valendo' });
    assert.deepEqual(meus(await noAgente('')), { [nomes.val]: 'valendo' });
    assert.deepEqual(meus(await noAgente('contexto,outra')), { [nomes.val]: 'valendo' }, 'saber outra coisa não é saber estado');
    assert.deepEqual(meus(await noAgente('ESTADOS')), { [nomes.val]: 'valendo' }, 'a palavra é exata');

    // O agente que sabe recebe todos os ligados, cada um com o seu estado.
    const esperado = { [nomes.obs]: 'observando', [nomes.ens]: 'ensaio', [nomes.med]: 'medido', [nomes.val]: 'valendo' };
    assert.deepEqual(meus(await noAgente(CONTRATO.sabe)), esperado);
    assert.deepEqual(meus(await noAgente(`outra,${CONTRATO.sabe}`)), esperado);
    assert.ok(Object.values(esperado).includes(CONTRATO.configuracao.regra.estado), 'o estado do contrato é um dos que descem');
  });

  // ─────────────────────── o resumo por hora ───────────────────────

  it('as olhadas observadas chegam ao resumo e às análises com o número do agente', async () => {
    const id = await ligado(`Resumo ${marca}`, 'observando');
    const hora = `${new Date().toISOString().slice(0, 13)}:00:00+00:00`;
    const linha = {
      ...RESUMO, regraId: id, zonaId, hora,
      capturas: 120, semJuiz: 0, semQuadro: 0, semCena: 0, semCondicao: 30, observadas: 90, emSilencio: 0, repetidas: 0,
      jaJulgadas: 0, vaziasGuardadas: 0,
      enfileiradas: 0, conformes: 0, naoConformes: 0, naoAvaliaveis: 0, falhas: 0, alertas: 0,
      somaConfianca: 0, comConfianca: 0, somaLatenciaMs: 0, comLatencia: 0, custoCentavos: 0,
      julgadasLoja: 0, julgadasNuvem: 0, somaMedida: 0, comMedida: 0, maxMedida: null, extras: 0, extrasFora: 0,
      ultimoResultado: null, ultimoMotivo: null, ultimoImpedimento: null, ultimaEm: null,
    };
    const r = await doAgente('POST', '/v1/resumos', { resumos: [linha] });
    assert.deepEqual([r.statusCode, r.json()], [200, { aceitos: 1, recusados: [] }], r.body);
    const gravada = (await pool.query(`select capturas, sem_condicao, observadas from resumo_hora where regra_id = $1`, [id])).rows[0];
    assert.deepEqual(gravada, { capturas: 120, sem_condicao: 30, observadas: 90 });

    // A mesma linha de novo, com o acumulado maior: substitui, não soma.
    await doAgente('POST', '/v1/resumos', { resumos: [{ ...linha, capturas: 124, observadas: 94 }] });
    assert.equal((await pool.query(`select observadas from resumo_hora where regra_id = $1`, [id])).rows[0].observadas, 94);

    // Agente antigo não manda o campo: entra como zero.
    const outro = await ligado(`Resumo antigo ${marca}`, null);
    const { observadas: _, ...semOCampo } = { ...linha, regraId: outro, enfileiradas: 90, conformes: 90, julgadasNuvem: 90, comConfianca: 0 };
    assert.equal((await doAgente('POST', '/v1/resumos', { resumos: [semOCampo] })).statusCode, 200);
    assert.equal((await pool.query(`select observadas from resumo_hora where regra_id = $1`, [outro])).rows[0].observadas, 0);

    const analises = (await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}/analises`, headers: { cookie: cookiePresidente } })).json();
    const celula = analises.celulas.find((c: { regraId: string }) => c.regraId === id);
    assert.ok(celula, 'a hora do critério que só observa aparece nas análises');
    assert.deepEqual([celula.capturas, celula.semCondicao, celula.observadas, celula.analises], [124, 30, 94, 0]);
  });

  // ─────────────────────── o aviso nasce no servidor ───────────────────────

  it('evento de critério que não está valendo fica guardado, e não vira aviso', async () => {
    // O agente que sabe de estados não manda evento do que está em ensaio. Isto é para o que chegar
    // mesmo assim: o evento que estava a caminho quando o critério desceu, o agente com a configuração velha.
    const destino = await app.inject({
      method: 'POST', url: `/v1/lojas/${lojaId}/destinos`, headers: { cookie: cookiePresidente },
      payload: { tipo: 'whatsapp', nome: 'Plantão', endereco: '+5521933334444' },
    });
    assert.equal(destino.statusCode, 201, destino.body);
    const politica = await app.inject({
      method: 'POST', url: `/v1/lojas/${lojaId}/politicas`, headers: { cookie: cookiePresidente },
      payload: { severidade: 'critico', destinoId: destino.json().destino.id },
    });
    assert.ok(politica.statusCode < 300, politica.body);

    const criada = await criar({ nome: `Aviso ${marca}`, severidade: 'critico' });
    assert.equal(criada.statusCode, 201, criada.body);
    const id = criada.json().id as string;
    assert.equal((await editar(id, { ativa: true })).statusCode, 200);

    let n = 0;
    async function foraDoCriterio(): Promise<{ avisos: number; guardado: boolean; envios: number }> {
      const chave = `${marca}-aviso-${++n}`;
      const r = await doAgente('POST', '/v1/eventos', {
        eventos: [{ idempotenciaKey: chave, regraId: id, zonaId, ocorridoEm: new Date().toISOString(), veredito: 'nao_conforme' }],
      });
      assert.equal(r.statusCode, 200, r.body);
      assert.deepEqual([r.json().aceitos, r.json().recusados], [1, []], 'o evento é aceito em qualquer estado: é o fato');
      const { rows } = await pool.query(
        `select e.id, (select count(*)::int from envio v where v.evento_id = e.id) as envios
           from evento e where e.idempotencia_key = $1`,
        [chave],
      );
      return { avisos: r.json().avisos as number, guardado: rows.length === 1, envios: rows[0]?.envios ?? -1 };
    }

    // Valendo: avisa. É também o que prova que o destino e a política deste teste funcionam.
    assert.deepEqual(await foraDoCriterio(), { avisos: 1, guardado: true, envios: 1 });

    for (const estado of ['ensaio', 'observando']) {
      assert.equal((await editar(id, { estado })).statusCode, 200);
      assert.deepEqual(await foraDoCriterio(), { avisos: 0, guardado: true, envios: 0 }, estado);
    }
    // "medido" também não avisa: o acerto foi medido, mas ninguém mandou valer.
    await pool.query(`update regra set estado = 'medido' where id = $1`, [id]);
    assert.deepEqual(await foraDoCriterio(), { avisos: 0, guardado: true, envios: 0 }, 'medido');

    // De volta a valendo (como o banco de provas vai fazer): volta a avisar.
    await pool.query(`update regra set estado = 'valendo' where id = $1`, [id]);
    assert.deepEqual(await foraDoCriterio(), { avisos: 1, guardado: true, envios: 1 });
  });
});
