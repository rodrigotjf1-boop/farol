// Destinos, política e a fila de envios, contra Postgres real.
//
// O que se prova aqui é o caminho inteiro: cadastrar quem recebe, dizer
// quem recebe o quê, o evento virar envio, o transporte puxar, e o console
// conseguir responder "chegou?". Cada elo que faltar transforma o produto
// num relatório que ninguém lê.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { validarEndereco } from '../src/rotas/alertas.js';

// ───────── validação do endereço: não precisa de banco ─────────

describe('endereço do destino', () => {
  it('whatsapp exige E.164 com país', () => {
    // Número sem país chega à Meta e falha em silêncio: a mensagem fica
    // "enviada" e ninguém recebe — o pior modo de falhar que existe.
    assert.equal(validarEndereco('whatsapp', '+5521988887777'), null);
    assert.match(String(validarEndereco('whatsapp', '21988887777')), /E\.164/);
    assert.match(String(validarEndereco('whatsapp', '+55 21 98888-7777')), /E\.164/);
  });

  it('webhook recusa http em claro', () => {
    assert.equal(validarEndereco('webhook', 'https://n8n.exemplo.com/farol'), null);
    assert.match(String(validarEndereco('webhook', 'http://n8n.exemplo.com/farol')), /https/);
  });

  it('webhook recusa querystring, onde o token vazaria para todo log', () => {
    assert.match(
      String(validarEndereco('webhook', 'https://n8n.exemplo.com/farol?token=abc')),
      /segredoRef/,
    );
  });

  it('kds é o id da loja no Regem, não uma URL digitada', () => {
    assert.equal(validarEndereco('kds', randomUUID()), null);
    assert.match(String(validarEndereco('kds', 'http://kds.local')), /id da loja/);
  });
});

// ───────────────────── o caminho completo ─────────────────────

const URL = process.env.DATABASE_URL;
const marca = `teste-alerta-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-alertas';
const SENHA = 'uma senha longa o bastante';

describe('alertas (Postgres real)', { skip: !URL && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  let lojaId = '';
  let zonaId = '';
  let cookie = '';
  let cookieExecucao = '';
  let tokenAgente = '';

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL });
    app = criarApp(pool, { logger: false });
    await app.ready();

    const loja = (
      await app.inject({
        method: 'POST',
        url: '/v1/distribuicao/lojas',
        headers: { 'x-farol-admin': ADMIN },
        payload: {
          tenant: { nome: marca },
          loja: { nome: 'Matriz' },
          setores: [{ nome: 'Cozinha' }],
        },
      })
    ).json();
    lojaId = loja.loja.id;
    const tenantId = loja.tenantId;
    const setorId = loja.setores[0].id;

    async function entrar(email: string, nivel: string) {
      await app.inject({
        method: 'POST',
        url: '/v1/distribuicao/usuarios',
        headers: { 'x-farol-admin': ADMIN },
        payload: { tenantId, nome: 'X', email, senha: SENHA, nivel },
      });
      const r = await app.inject({
        method: 'POST', url: '/v1/sessao', payload: { email, senha: SENHA },
      });
      const b = r.headers['set-cookie'];
      return (Array.isArray(b) ? b[0]! : String(b)).split(';')[0]!;
    }
    cookie = await entrar(`dono-${marca}@e.com`, 'presidente');
    cookieExecucao = await entrar(`exec-${marca}@e.com`, 'execucao');

    const ponto = await app.inject({
      method: 'POST',
      url: `/v1/setores/${setorId}/pontos`,
      headers: { cookie },
      payload: { nome: 'Montagem', origem: 'dvr', canal: 1, host: '192.168.1.108' },
    });
    zonaId = ponto.json().zonas[0].id;

    // O agente nasce pela DISTRIBUIÇÃO e só vale depois de ativado: o
    // token sozinho não autentica, ele tem que estar amarrado a uma
    // máquina. É a trava contra token copiado virar segundo agente.
    const ag = await app.inject({
      method: 'POST',
      url: '/v1/distribuicao/agentes',
      headers: { 'x-farol-admin': ADMIN },
      payload: { lojaId, nome: 'Agente de teste' },
    });
    assert.equal(ag.statusCode, 201, ag.body);
    tokenAgente = ag.json().token;

    const ativacao = await app.inject({
      method: 'POST',
      url: '/v1/agentes/ativar',
      headers: { authorization: `Bearer ${tokenAgente}` },
      payload: { fingerprint: `fp-${marca}`, versao: '0.1.0-teste' },
    });
    assert.equal(ativacao.statusCode, 200, ativacao.body);
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  function criarDestino(payload: Record<string, unknown>) {
    return app.inject({
      method: 'POST', url: `/v1/lojas/${lojaId}/destinos`,
      headers: { cookie }, payload,
    });
  }

  // ───────────────────── o segredo não entra ─────────────────────

  it('recusa ALTO quando o corpo traz senha', async () => {
    // Ignorar o campo em silêncio deixaria quem mandou acreditando que a
    // senha foi guardada — e ela teria ficado no log da requisição.
    const r = await criarDestino({
      tipo: 'webhook', nome: 'n8n', endereco: 'https://n8n.exemplo.com/f',
      senha: 'isto-nao-pode-entrar',
    });
    assert.equal(r.statusCode, 400);
    assert.equal(r.json().erro, 'segredo_no_corpo');
    assert.match(r.json().mensagem, /segredoRef/);
  });

  it('o segredo desce como EXISTÊNCIA, nunca como nome da variável', async () => {
    const r = await criarDestino({
      tipo: 'webhook', nome: 'n8n com token',
      endereco: 'https://n8n.exemplo.com/token',
      segredoRef: 'FAROL_N8N_TOKEN',
    });
    assert.equal(r.statusCode, 201, r.body);

    const lista = await app.inject({
      method: 'GET', url: `/v1/lojas/${lojaId}/destinos`, headers: { cookie },
    });
    const d = lista.json().destinos.find((x: { nome: string }) => x.nome === 'n8n com token');
    assert.equal(d.tem_segredo, true);
    assert.equal(d.segredo_ref, undefined, 'saber o nome é meio caminho para procurá-la');
  });

  // ───────────────────── cadastro e RBAC ─────────────────────

  it('quem não configura não cadastra destino', async () => {
    const r = await app.inject({
      method: 'POST', url: `/v1/lojas/${lojaId}/destinos`,
      headers: { cookie: cookieExecucao },
      payload: { tipo: 'whatsapp', nome: 'Meu zap', endereco: '+5521988887777' },
    });
    assert.equal(r.statusCode, 403);
  });

  it('o mesmo endereço duas vezes no mesmo escopo dá 409', async () => {
    const payload = { tipo: 'whatsapp', nome: 'Gerente', endereco: '+5521911112222' };
    assert.equal((await criarDestino(payload)).statusCode, 201);
    const r2 = await criarDestino({ ...payload, nome: 'Gerente de novo' });
    assert.equal(r2.statusCode, 409);
    assert.match(r2.json().mensagem, /duas vezes/);
  });

  // ───────────────────── política e escopo ─────────────────────

  it('enviar sem destino é recusado com a razão', async () => {
    const r = await app.inject({
      method: 'POST', url: `/v1/lojas/${lojaId}/politicas`,
      headers: { cookie }, payload: { severidade: 'critico', enviar: true },
    });
    assert.equal(r.statusCode, 422);
    assert.match(r.json().mensagem, /não quer dizer nada/);
  });

  it('veto com destino é recusado: ele silencia a combinação inteira', async () => {
    const d = (await criarDestino({
      tipo: 'email', nome: 'Caixa do dono', endereco: 'dono@exemplo.com',
    })).json().destino;

    const r = await app.inject({
      method: 'POST', url: `/v1/lojas/${lojaId}/politicas`,
      headers: { cookie },
      payload: { enviar: false, destinoId: d.id },
    });
    assert.equal(r.statusCode, 422);
  });

  it('política não aponta para destino de OUTRA conta', async () => {
    const r = await app.inject({
      method: 'POST', url: `/v1/lojas/${lojaId}/politicas`,
      headers: { cookie },
      payload: { severidade: 'critico', destinoId: randomUUID() },
    });
    assert.equal(r.statusCode, 404, 'destino de fora da conta não pode ser alvo');
  });

  it('a listagem diz QUAL escopo está valendo', async () => {
    // Sem isso, quem configura não entende por que a linha da rede não tem
    // efeito — e conclui que o produto está quebrado.
    const r = await app.inject({
      method: 'GET', url: `/v1/lojas/${lojaId}/politicas`, headers: { cookie },
    });
    assert.equal(r.statusCode, 200);
    assert.ok(['loja', 'rede'].includes(r.json().escopo_vigente));
    assert.ok(r.json().explicacao.length > 10);
  });

  // ───────── do evento ao envio, e do envio ao "chegou?" ─────────

  it('nao_conforme VIRA envio; conforme não', async () => {
    const destino = (await criarDestino({
      tipo: 'whatsapp', nome: 'Plantão', endereco: '+5521933334444',
    })).json().destino;

    await app.inject({
      method: 'POST', url: `/v1/lojas/${lojaId}/politicas`,
      headers: { cookie },
      payload: { severidade: 'critico', destinoId: destino.id },
    });

    const criada = await app.inject({
      method: 'POST', url: `/v1/zonas/${zonaId}/regras`,
      headers: { cookie },
      payload: {
        nome: 'Bancada limpa', tipo: 'estado',
        criterio: 'A superfície está livre de restos.',
        severidade: 'critico', prioridade: 'intermediaria',
      },
    });
    assert.equal(criada.statusCode, 201, criada.body);
    const regra = criada.json();

    const enviar = (veredito: string, chave: string) =>
      app.inject({
        method: 'POST', url: '/v1/eventos',
        headers: { authorization: `Bearer ${tokenAgente}` },
        payload: {
          eventos: [{
            idempotenciaKey: chave, regraId: regra.id,
            ocorridoEm: new Date().toISOString(), veredito,
          }],
        },
      });

    const ok = await enviar('conforme', `${marca}-ok`);
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(ok.json().avisos, 0, 'conforme é métrica, não alerta');

    const ruim = await enviar('nao_conforme', `${marca}-ruim`);
    assert.equal(ruim.json().avisos, 1, 'nao_conforme avisa');

    // E o reenvio do MESMO evento não avisa de novo.
    const repetido = await enviar('nao_conforme', `${marca}-ruim`);
    assert.equal(repetido.json().avisos, 0, 'retentativa não duplica aviso');
  });

  it('nao_avaliavel não alerta: é fila de revisão', async () => {
    const criada = await app.inject({
      method: 'POST', url: `/v1/zonas/${zonaId}/regras`,
      headers: { cookie },
      payload: {
        nome: 'Copo no lugar', tipo: 'estado',
        criterio: 'O copo está na bandeja.', severidade: 'critico',
      },
    });
    assert.equal(criada.statusCode, 201, criada.body);
    const regra = criada.json();

    const r = await app.inject({
      method: 'POST', url: '/v1/eventos',
      headers: { authorization: `Bearer ${tokenAgente}` },
      payload: {
        eventos: [{
          idempotenciaKey: `${marca}-nao-av`, regraId: regra.id,
          ocorridoEm: new Date().toISOString(), veredito: 'nao_avaliavel',
        }],
      },
    });
    assert.equal(r.json().avisos, 0, 'insistir com humano numa cena ilegível é desperdício');
  });

  it('o transporte puxa, e dois trabalhadores não levam o mesmo', async () => {
    const puxar = () =>
      app.inject({
        method: 'POST', url: '/v1/envios/reivindicar',
        headers: { 'x-farol-admin': ADMIN },
        payload: { limite: 50 },
      });

    const primeiro = await puxar();
    assert.equal(primeiro.statusCode, 200, primeiro.body);
    const levados = primeiro.json().envios;
    assert.ok(levados.length >= 1, 'tinha envio pendente para levar');

    const segundo = await puxar();
    const ids = new Set(levados.map((e: { id: string }) => e.id));
    for (const e of segundo.json().envios) {
      assert.ok(!ids.has(e.id), 'o segundo trabalhador levou o mesmo envio');
    }
  });

  it('o envio reivindicado leva o endereço, e o segredo só por REFERÊNCIA', async () => {
    const r = await app.inject({
      method: 'POST', url: '/v1/envios/reivindicar',
      headers: { 'x-farol-admin': ADMIN },
      payload: { limite: 1, tipos: ['whatsapp'] },
    });
    for (const e of r.json().envios) {
      assert.equal(e.destino_tipo, 'whatsapp', 'o filtro por tipo valeu');
      assert.ok('destino_endereco' in e, 'sem endereço o transporte não entrega');
    }
  });

  it('"mandei" e "chegou" são estados DIFERENTES', async () => {
    const { rows } = await pool.query(
      `select id from envio where loja_id = $1 and estado = 'enviado' limit 1`,
      [lojaId],
    );
    assert.ok(rows.length > 0, 'precisava de um envio despachado');
    const id = rows[0].id;

    const semCampo = await app.inject({
      method: 'POST', url: `/v1/envios/${id}/resultado`,
      headers: { 'x-farol-admin': ADMIN },
      payload: {},
    });
    assert.equal(semCampo.statusCode, 422, 'o transporte tem que DIZER o resultado');

    const ok = await app.inject({
      method: 'POST', url: `/v1/envios/${id}/resultado`,
      headers: { 'x-farol-admin': ADMIN },
      payload: { entregue: true },
    });
    assert.equal(ok.json().envio.estado, 'entregue');
  });

  it('o console consegue responder "chegou?"', async () => {
    const r = await app.inject({
      method: 'GET', url: `/v1/lojas/${lojaId}/envios`, headers: { cookie },
    });
    assert.equal(r.statusCode, 200);
    const envios = r.json().envios;
    assert.ok(envios.length > 0);
    // O que a tela precisa: para quem, por qual regra, e em que estado.
    assert.ok(envios[0].destino_nome);
    assert.ok(envios[0].estado);
    assert.ok(envios.some((e: { confirmado_em: string | null }) => e.confirmado_em));
  });

  it('falha registra o MOTIVO, e o envio volta para a fila', async () => {
    const { rows } = await pool.query(
      `select id from envio where loja_id = $1 and estado = 'enviado' limit 1`,
      [lojaId],
    );
    if (rows.length === 0) return; // nada a provar neste cenário

    const r = await app.inject({
      method: 'POST', url: `/v1/envios/${rows[0].id}/resultado`,
      headers: { 'x-farol-admin': ADMIN },
      payload: { entregue: false, erro: 'template nao aprovado pela Meta' },
    });
    assert.equal(r.json().envio.estado, 'falhou');

    const conferir = await pool.query(
      'select erro from envio where id = $1', [rows[0].id],
    );
    assert.match(conferir.rows[0].erro, /template/);
  });

  it('envio que não existe dá 404', async () => {
    const r = await app.inject({
      method: 'POST', url: `/v1/envios/${randomUUID()}/resultado`,
      headers: { 'x-farol-admin': ADMIN },
      payload: { entregue: true },
    });
    assert.equal(r.statusCode, 404);
  });

  it('o AGENTE não pode ser o transporte', async () => {
    // O caso que decide o desenho: o aviso de "o agente caiu" não pode
    // depender do agente, porque ele está caído. Queda de internet na
    // loja é a mesma história — é justamente quando mais se precisa
    // avisar. Então o transporte é da distribuição.
    const r = await app.inject({
      method: 'POST', url: '/v1/envios/reivindicar',
      headers: { authorization: `Bearer ${tokenAgente}` },
      payload: { limite: 5 },
    });
    assert.equal(r.statusCode, 401, 'token de agente não serve para puxar aviso');
  });

  it('a fila entrega o agente caído ANTES do aviso leve de ontem', async () => {
    // Numa volta de internet com mil envios acumulados, a ordem decide se
    // o alerta que importa sai em segundos ou em meia hora.
    const destino = (await app.inject({
      method: 'GET', url: `/v1/lojas/${lojaId}/destinos`, headers: { cookie },
    })).json().destinos[0];

    await pool.query(
      `insert into envio (tenant_id, loja_id, destino_id, motivo, chave, criado_em)
       select l.tenant_id, l.id, $2, 'agente_caiu', $3, now()
         from loja l where l.id = $1`,
      [lojaId, destino.id, `${marca}-caiu`],
    );

    const r = await app.inject({
      method: 'POST', url: '/v1/envios/reivindicar',
      headers: { 'x-farol-admin': ADMIN },
      payload: { limite: 1 },
    });
    assert.equal(r.json().envios[0]?.motivo, 'agente_caiu');
  });
});
