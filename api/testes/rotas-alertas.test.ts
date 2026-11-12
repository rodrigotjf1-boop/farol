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
import { enderecoDoDestino, validarEndereco } from '../src/rotas/alertas.js';
import { ERRO_DO_KDS_SEM_REGEM, ERRO_DO_PRAZO, PRAZO_DO_RESULTADO_S } from '../src/alerta-do-envio.js';
import { despacharEventos } from '../src/despacho.js';
import { readFileSync } from 'node:fs';

// `globalThis.URL`: este arquivo chama o endereço do banco de `URL`, mais abaixo.
const CONTRATO = JSON.parse(readFileSync(new globalThis.URL('../../contratos/transporte-dos-alertas.json', import.meta.url), 'utf8')) as {
  casos: { envio: Record<string, unknown> & { alerta: Record<string, unknown> } }[];
};

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

  it('o KDS não se digita: o endereço é sempre a loja do Regem ligada ("regem"), o que vier no corpo não conta', () => {
    // Digitado, o id de uma loja do Regem de OUTRA empresa poria o alerta na tela da cozinha dela (11/11/2026).
    for (const digitado of [randomUUID(), 'http://kds.local', '']) {
      assert.deepEqual(enderecoDoDestino('kds', digitado), { endereco: 'regem' });
    }
    assert.deepEqual(enderecoDoDestino('whatsapp', ' +5521988887777 '), { endereco: '+5521988887777' });
    assert.match(JSON.stringify(enderecoDoDestino('whatsapp', '21988887777')), /E\.164/);
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
  // Quem entrega (migration 046): um transporte que leva os quatro tipos e um que leva só o KDS.
  let transporte = '';
  let transporteId = '';
  let soKds = '';
  let soKdsId = '';
  const comTransporte = () => ({ authorization: `Bearer ${transporte}` });

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

    const emitir = async (nome: string, tipos: string[]) => {
      const r = await app.inject({
        method: 'POST', url: '/v1/distribuicao/transportes',
        headers: { 'x-farol-admin': ADMIN }, payload: { nome: `${marca}-${nome}`, tipos },
      });
      assert.equal(r.statusCode, 201, r.body);
      return r.json() as { id: string; token: string };
    };
    ({ token: transporte, id: transporteId } = await emitir('todos', ['whatsapp', 'email', 'kds', 'webhook']));
    ({ token: soKds, id: soKdsId } = await emitir('kds', ['kds']));

    // A loja ligada a uma loja do Regem (o que a tela Conexões faz): a tela da cozinha só existe assim (11/11/2026).
    await ligarAoRegem();
  });

  const regemLojaId = randomUUID();
  async function ligarAoRegem() {
    await pool.query(
      `insert into regem_loja (tenant_id, loja_id, regem_loja_id, regem_loja_nome, regem_empresa_nome, acesso_cifrado, ligado_em)
       select l.tenant_id, l.id, $2, 'Loja do Regem', 'Empresa do Regem', 'nao-e-um-acesso', now()
         from loja l where l.id = $1
       on conflict do nothing`,
      [lojaId, regemLojaId],
    );
  }
  const desligarDoRegem = () => pool.query('delete from regem_loja where loja_id = $1', [lojaId]);

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    // Depois da conta: os envios dela (que apontam para estes transportes) já foram junto.
    await pool?.query('delete from transporte where nome like $1', [`${marca}%`]);
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
        headers: comTransporte(),
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
      headers: comTransporte(),
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
      headers: comTransporte(),
      payload: {},
    });
    assert.equal(semCampo.statusCode, 422, 'o transporte tem que DIZER o resultado');

    const ok = await app.inject({
      method: 'POST', url: `/v1/envios/${id}/resultado`,
      headers: comTransporte(),
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
      headers: comTransporte(),
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
      headers: comTransporte(),
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
      headers: comTransporte(),
      payload: { limite: 1 },
    });
    assert.equal(r.json().envios[0]?.motivo, 'agente_caiu');
  });

  // ───────── quem entrega: a credencial própria do transporte (migration 046) ─────────

  async function envioNovo(destinoId: string, rotulo: string): Promise<string> {
    const { rows } = await pool.query(
      `insert into envio (tenant_id, loja_id, destino_id, motivo, chave)
       select l.tenant_id, l.id, $2, 'busca_concluida', $3 from loja l where l.id = $1
       returning id`,
      [lojaId, destinoId, `${marca}-${rotulo}-${randomUUID()}`],
    );
    return rows[0].id;
  }

  async function destinoDoTipo(tipo: string): Promise<string> {
    const lista = (await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}/destinos`, headers: { cookie } })).json();
    const achado = lista.destinos.find((d: { tipo: string }) => d.tipo === tipo);
    if (achado) return achado.id;
    const r = await criarDestino({ tipo, nome: `Destino ${tipo}`, endereco: tipo === 'kds' ? randomUUID() : '+5521977776666' });
    assert.equal(r.statusCode, 201, r.body);
    return r.json().destino.id;
  }

  it('a chave geral não vale mais nas rotas de envio', async () => {
    // Pedido da sessão do Hub DMS, aprovado pelo dono em 14/10/2026: quem entregasse os alertas carregaria a chave
    // que emite agente e cadastra loja, de todas as lojas.
    for (const url of ['/v1/envios/reivindicar', `/v1/envios/${randomUUID()}/resultado`]) {
      const r = await app.inject({ method: 'POST', url, headers: { 'x-farol-admin': ADMIN }, payload: { limite: 5, entregue: true } });
      assert.equal(r.statusCode, 401, `${url}: ${r.body}`);
    }
  });

  it('o envio anota quem o reivindicou, e o uso do transporte fica registrado', async () => {
    const id = await envioNovo(await destinoDoTipo('whatsapp'), 'quem');
    const r = await app.inject({ method: 'POST', url: '/v1/envios/reivindicar', headers: comTransporte(), payload: { limite: 100 } });
    assert.ok(r.json().envios.some((e: { id: string }) => e.id === id), 'o envio novo foi levado');
    const { rows } = await pool.query('select transporte_id from envio where id = $1', [id]);
    assert.equal(rows[0]?.transporte_id, transporteId);
    // O último uso é anotado sem segurar a resposta: espera-se um pouco por ele.
    let usado = null;
    for (let i = 0; i < 20 && !usado; i += 1) {
      usado = (await pool.query('select usado_em from transporte where id = $1', [transporteId])).rows[0].usado_em;
      if (!usado) await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(usado, 'o último uso do transporte');
  });

  it('cada transporte leva só os tipos dele', async () => {
    const kds = await envioNovo(await destinoDoTipo('kds'), 'kds');
    const zap = await envioNovo(await destinoDoTipo('whatsapp'), 'zap');

    const alheio = await app.inject({
      method: 'POST', url: '/v1/envios/reivindicar', headers: { authorization: `Bearer ${soKds}` }, payload: { tipos: ['whatsapp'] },
    });
    assert.deepEqual(alheio.json().envios, [], 'pedir tipo alheio é não levar nada');

    const doKds = await app.inject({
      method: 'POST', url: '/v1/envios/reivindicar', headers: { authorization: `Bearer ${soKds}` }, payload: { limite: 100 },
    });
    const levados = doKds.json().envios as { id: string; destino_tipo: string }[];
    assert.ok(levados.length >= 1 && levados.every((e) => e.destino_tipo === 'kds'), JSON.stringify(levados));
    assert.ok(levados.some((e) => e.id === kds) && !levados.some((e) => e.id === zap));

    const zapPeloTodos = await app.inject({
      method: 'POST', url: '/v1/envios/reivindicar', headers: comTransporte(), payload: { limite: 100, tipos: ['whatsapp'] },
    });
    assert.ok(zapPeloTodos.json().envios.some((e: { id: string }) => e.id === zap), 'o outro transporte levou o WhatsApp');
  });

  it('o resultado só vale de quem reivindicou', async () => {
    const id = await envioNovo(await destinoDoTipo('kds'), 'resultado');
    const levou = await app.inject({
      method: 'POST', url: '/v1/envios/reivindicar', headers: { authorization: `Bearer ${soKds}` }, payload: { limite: 100 },
    });
    assert.ok(levou.json().envios.some((e: { id: string }) => e.id === id));

    const deOutro = await app.inject({
      method: 'POST', url: `/v1/envios/${id}/resultado`, headers: comTransporte(), payload: { entregue: true },
    });
    assert.equal(deOutro.statusCode, 404, 'para o outro transporte, este envio não existe');
    const doDono = await app.inject({
      method: 'POST', url: `/v1/envios/${id}/resultado`, headers: { authorization: `Bearer ${soKds}` }, payload: { entregue: true },
    });
    assert.equal(doDono.json().envio.estado, 'entregue', doDono.body);
    const torto = await app.inject({
      method: 'POST', url: '/v1/envios/nao-e-uuid/resultado', headers: { authorization: `Bearer ${soKds}` }, payload: { entregue: true },
    });
    assert.equal(torto.statusCode, 404, 'id torto é envio que não existe, não erro do banco');
  });

  // ───────── os alertas no KDS do Regem (pedido da sessão do Regem, 11/11/2026) ─────────
  // Só este arquivo cria envio de KDS, e só o transporte `soKds` o reivindica aqui (V93).

  const puxarKds = (limite = 100) =>
    app.inject({ method: 'POST', url: '/v1/envios/reivindicar', headers: { authorization: `Bearer ${soKds}` }, payload: { limite } });

  it('a tela da cozinha não se digita: guarda "regem", a loja sem ligação é recusada, e é uma por escopo', async () => {
    const kds = await destinoDoTipo('kds'); // criada com um id digitado, que não conta
    const lista = (await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}/destinos`, headers: { cookie } })).json();
    assert.equal(lista.destinos.find((d: { id: string }) => d.id === kds)?.endereco, 'regem');

    const outra = await criarDestino({ tipo: 'kds', nome: 'Outra tela', endereco: randomUUID() });
    assert.equal(outra.statusCode, 409, outra.body);
    assert.match(outra.json().mensagem, /tela da cozinha já está cadastrada/);

    await desligarDoRegem();
    try {
      const semRegem = await criarDestino({ tipo: 'kds', nome: 'Tela' });
      assert.equal(semRegem.statusCode, 422, semRegem.body);
      assert.equal(semRegem.json().erro, 'loja_sem_regem');
      assert.match(semRegem.json().mensagem, /ligue em Conexões/);
      // A da rede vale para as lojas ligadas: não depende desta.
      const daRede = await criarDestino({ tipo: 'kds', nome: 'Telas da rede', daRede: true });
      assert.equal(daRede.statusCode, 201, daRede.body);
      assert.equal(daRede.json().destino.endereco, 'regem');
      assert.equal(daRede.json().destino.da_rede, true);
      await pool.query('delete from destino where id = $1', [daRede.json().destino.id]);
    } finally {
      await ligarAoRegem();
    }
    for (const loja of [randomUUID(), 'nao-e-uuid']) {
      const r = await app.inject({ method: 'POST', url: `/v1/lojas/${loja}/destinos`, headers: { cookie }, payload: { tipo: 'kds', nome: 'X' } });
      assert.equal(r.statusCode, 404, `${loja}: ${r.body}`);
    }
  });

  it('o envio do KDS leva o alerta: título, detalhe, gravidade, onde, quando e a loja do Regem', async () => {
    const kds = await destinoDoTipo('kds');
    const pol = await app.inject({
      method: 'POST', url: `/v1/lojas/${lojaId}/politicas`, headers: { cookie }, payload: { prioridade: 'urgente', destinoId: kds },
    });
    assert.equal(pol.statusCode, 201, pol.body);
    const regra = await app.inject({
      method: 'POST', url: `/v1/zonas/${zonaId}/regras`, headers: { cookie },
      payload: { nome: 'Gás fechado ao sair', tipo: 'estado', criterio: 'O registro do gás está fechado.', severidade: 'emergencia', prioridade: 'urgente' },
    });
    assert.equal(regra.statusCode, 201, regra.body);
    const ocorridoEm = new Date(Date.now() - 60_000).toISOString();
    // O evento gravado direto e o despacho de verdade: a gravação pela rota (`POST /v1/eventos`) não roda no banco
    // local sem pgvector, e o que se prova aqui é do despacho em diante.
    const ev = await pool.query<{ tenant_id: string }>(
      `insert into evento (tenant_id, loja_id, regra_id, zona_id, ocorrido_em, veredito, motivo, idempotencia_key)
       select l.tenant_id, l.id, $2, $3, $4, 'nao_conforme', $5, $6 from loja l where l.id = $1
       returning tenant_id`,
      [lojaId, regra.json().id, zonaId, ocorridoEm, '  o registro do gás ficou aberto  ', `${marca}-gas`],
    );
    const despacho = await despacharEventos(pool, ev.rows[0]!.tenant_id, lojaId, [`${marca}-gas`]);
    assert.ok(despacho.criados >= 1, JSON.stringify(despacho));
    const { rows } = await pool.query(
      `select e.id from envio e join evento v on v.id = e.evento_id where v.idempotencia_key = $1 and e.destino_id = $2`,
      [`${marca}-gas`, kds],
    );
    assert.equal(rows.length, 1, 'o evento virou um envio para a tela da cozinha');

    const r = await puxarKds();
    assert.equal(r.statusCode, 200, r.body);
    const envio = r.json().envios.find((x: { id: string }) => x.id === rows[0].id);
    assert.ok(envio, r.body);
    const doContrato = CONTRATO.casos[0]!.envio;
    assert.deepEqual(Object.keys(envio).sort(), Object.keys(doContrato).sort(), 'as chaves do contrato com o Regem');
    assert.deepEqual(Object.keys(envio.alerta).sort(), Object.keys(doContrato.alerta).sort());
    assert.equal(envio.destino_endereco, 'regem');
    assert.deepEqual(envio.alerta, {
      titulo: 'Gás fechado ao sair',
      detalhe: 'O registro do gás ficou aberto.',
      severidade: 'emergencia',
      prioridade: 'urgente',
      onde: 'Montagem',
      ocorrido_em: ocorridoEm,
      loja: { id: lojaId, nome: 'Matriz', regem_loja_id: regemLojaId },
      texto: 'Farol · Matriz: Gás fechado ao sair (Montagem). O registro do gás ficou aberto.',
    });
  });

  it('a fila sai pela gravidade, não pela chegada — e a resposta vem na mesma ordem', async () => {
    const kds = await destinoDoTipo('kds');
    const regraDe = async (severidade: string, prioridade: string) => {
      const r = await app.inject({
        method: 'POST', url: `/v1/zonas/${zonaId}/regras`, headers: { cookie },
        payload: { nome: `Ordem ${severidade} ${prioridade}`, tipo: 'estado', criterio: 'Está como combinado.', severidade, prioridade },
      });
      assert.equal(r.statusCode, 201, r.body);
      return r.json().id as string;
    };
    // O evento gravado direto (sem passar pelo despacho, que criaria outros envios).
    const eventoDe = async (regraId: string | null, prioridade: string | null) => (await pool.query(
      `insert into evento (tenant_id, loja_id, regra_id, ocorrido_em, veredito, prioridade, idempotencia_key)
       select l.tenant_id, l.id, $2, now(), 'nao_conforme', $3, $4 from loja l where l.id = $1
       returning id`,
      [lojaId, regraId, prioridade, `${marca}-ordem-${randomUUID()}`],
    )).rows[0].id as string;
    const envio = async (motivo: string, minutosAtras: number, extra: { eventoId?: string; payload?: unknown }) => (await pool.query(
      `insert into envio (tenant_id, loja_id, destino_id, motivo, chave, evento_id, payload, criado_em)
       select l.tenant_id, l.id, $2, $3, $4, $5, $6::jsonb, now() - make_interval(mins => $7)
         from loja l where l.id = $1
       returning id`,
      [lojaId, kds, motivo, `${marca}-ordem-${randomUUID()}`, extra.eventoId ?? null,
       extra.payload === undefined ? null : JSON.stringify(extra.payload), minutosAtras],
    )).rows[0].id as string;

    // Criados do mais leve para o mais grave: a ordem de chegada DISCORDA da pedida (V80).
    const leve = await envio('busca_concluida', 50, {}); // atenção · intermediária
    const semRegra = await envio('evento', 45, { eventoId: await eventoDe(null, null) }); // critério apagado: atenção · intermediária
    const sobrecarga = await envio('computador', 40, { payload: { tipo: 'sobrecarregado' } }); // atenção · urgente
    // crítico · leve: a prioridade do evento vence a da regra
    const criticoLeve = await envio('evento', 35, { eventoId: await eventoDe(await regraDe('critico', 'urgente'), 'leve') });
    const calor = await envio('computador', 30, { payload: { tipo: 'esquentando' } }); // crítico · urgente
    // emergência · urgente, mais velha que o agente caído: só a regra do agente caído o põe na frente dela
    const emergencia = await envio('evento', 20, { eventoId: await eventoDe(await regraDe('emergencia', 'urgente'), null) });
    const caiu = await envio('agente_caiu', 0, { payload: { agente: 'Agente de teste', desde: new Date().toISOString() } });
    const esperado = [caiu, emergencia, calor, criticoLeve, sobrecarga, leve, semRegra];

    const primeiros = (await puxarKds(2)).json().envios.map((e: { id: string }) => e.id);
    assert.deepEqual(primeiros, esperado.slice(0, 2), 'com limite 2: o agente caído e a emergência');
    const resto = (await puxarKds(100)).json().envios.map((e: { id: string }) => e.id).filter((id: string) => esperado.includes(id));
    assert.deepEqual(resto, esperado.slice(2), 'e o resto pela gravidade, na ordem da resposta');
  });

  it('o envio levado e sem resultado em 2 minutos volta à fila como "falhou", com o motivo', async () => {
    const kds = await destinoDoTipo('kds');
    const preso = await envioNovo(kds, 'preso');
    const ultimaVez = await envioNovo(kds, 'ultima-vez');
    const recente = await envioNovo(kds, 'recente');
    const levou = (await puxarKds()).json().envios.map((e: { id: string }) => e.id);
    assert.ok([preso, ultimaVez, recente].every((id) => levou.includes(id)), 'os três foram levados');

    // O transporte caiu no meio: os três ficaram "mandados". Dois passaram do prazo, um deles na última tentativa.
    await pool.query(
      `update envio set despachado_em = now() - make_interval(secs => $2) where id = any($1::uuid[])`,
      [[preso, ultimaVez], PRAZO_DO_RESULTADO_S + 30],
    );
    await pool.query('update envio set tentativas = 5 where id = $1', [ultimaVez]);
    await pool.query(`update envio set despachado_em = now() - interval '30 seconds' where id = $1`, [recente]);

    const deNovo = (await puxarKds()).json().envios as { id: string; tentativas: number }[];
    const outraVez = deNovo.find((e) => e.id === preso);
    assert.ok(outraVez, 'o preso voltou à fila e foi levado de novo, com o MESMO id');
    assert.equal(outraVez!.tentativas, 2);
    assert.ok(!deNovo.some((e) => e.id === ultimaVez || e.id === recente), JSON.stringify(deNovo.map((e) => e.id)));

    const { rows } = await pool.query('select id, estado, erro from envio where id = any($1::uuid[])', [[preso, ultimaVez, recente]]);
    const de = (id: string) => rows.find((x) => x.id === id);
    assert.deepEqual({ estado: de(ultimaVez).estado, erro: de(ultimaVez).erro }, { estado: 'falhou', erro: ERRO_DO_PRAZO },
      'sem tentativa, fica "falhou" — e o console mostra o motivo');
    assert.equal(de(recente).estado, 'enviado', 'dentro do prazo, segue esperando o resultado');
    assert.equal(de(preso).estado, 'enviado');

    const ok = await app.inject({
      method: 'POST', url: `/v1/envios/${preso}/resultado`, headers: { authorization: `Bearer ${soKds}` }, payload: { entregue: true },
    });
    assert.deepEqual({ estado: ok.json().envio.estado }, { estado: 'entregue' });
    assert.equal((await pool.query('select erro from envio where id = $1', [preso])).rows[0].erro, null, 'o motivo sai com a entrega');
  });

  it('a tela da cozinha de uma loja sem ligação com o Regem: o envio sai "descartado", com o motivo, e não é levado', async () => {
    const kds = await destinoDoTipo('kds');
    const semPara = await envioNovo(kds, 'sem-regem');
    await desligarDoRegem();
    try {
      // Quem não leva KDS não mexe nele.
      await app.inject({ method: 'POST', url: '/v1/envios/reivindicar', headers: comTransporte(), payload: { limite: 100, tipos: ['whatsapp'] } });
      assert.equal((await pool.query('select estado from envio where id = $1', [semPara])).rows[0].estado, 'pendente');

      const r = await puxarKds();
      assert.ok(!r.json().envios.some((e: { id: string }) => e.id === semPara), r.body);
      const { rows } = await pool.query('select estado, erro from envio where id = $1', [semPara]);
      assert.deepEqual(rows[0], { estado: 'descartado', erro: ERRO_DO_KDS_SEM_REGEM });
    } finally {
      await ligarAoRegem();
    }
  });

  it('revogar um transporte não derruba o outro', async () => {
    const rev = await app.inject({
      method: 'POST', url: `/v1/distribuicao/transportes/${soKdsId}/revogar`, headers: { 'x-farol-admin': ADMIN },
    });
    assert.equal(rev.statusCode, 200, rev.body);
    const revogado = await app.inject({
      method: 'POST', url: '/v1/envios/reivindicar', headers: { authorization: `Bearer ${soKds}` }, payload: { limite: 1 },
    });
    assert.equal(revogado.statusCode, 401);
    const outro = await app.inject({ method: 'POST', url: '/v1/envios/reivindicar', headers: comTransporte(), payload: { limite: 1 } });
    assert.equal(outro.statusCode, 200, outro.body);
  });
});
