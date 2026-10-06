// =====================================================================
// A descida da configuração e o comando de volta
// =====================================================================
// Contra Postgres real, pelo caminho HTTP inteiro. A migration 007 cria
// gatilhos e um índice parcial — nada disso se verifica em dublê, e um
// gatilho que não dispara falha em SILÊNCIO: a loja segue analisando pela
// regra velha e ninguém percebe até conferir na mão.
// =====================================================================

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';

const URL = process.env.DATABASE_URL;
const marca = `teste-cfg-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-cfg';

describe('configuração desce para o agente', { skip: !URL && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let lojaId: string;
  let pontoId: string;
  let zonaId: string;
  let token: string;
  let agenteId: string;
  let adminAntes: string | undefined;

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;

    pool = new pg.Pool({ connectionString: URL });
    const t = await pool.query('insert into tenant (nome) values ($1) returning id', [marca]);
    const l = await pool.query(
      'insert into loja (tenant_id, nome) values ($1,$2) returning id',
      [t.rows[0].id, 'loja da configuração'],
    );
    lojaId = l.rows[0].id;

    const st = await pool.query(
      'insert into setor (loja_id, nome) values ($1,$2) returning id',
      [lojaId, 'cozinha'],
    );
    const p = await pool.query(
      `insert into ponto (setor_id, nome, origem, canal, host, usuario, segredo_ref,
                          sensor_pol, focal_mm, distancia_cm, resolucao_h)
       values ($1,'bancada','dvr',1,'192.168.1.108','admin','cofre://cam1',
               '1/2.7', 2.8, 60, 1920)
       returning id`,
      [st.rows[0].id],
    );
    pontoId = p.rows[0].id;

    const z = await pool.query(
      `insert into zona (ponto_id, nome, poligono, principal, largura_cena_cm)
       values ($1,'área da montagem','[[0.15,0.47],[0.85,0.47],[0.85,0.8],[0.15,0.8]]'::jsonb,
               true, 40)
       returning id`,
      [pontoId],
    );
    zonaId = z.rows[0].id;

    app = criarApp(pool, { logger: false });
    await app.ready();

    const criado = await app.inject({
      method: 'POST',
      url: '/v1/distribuicao/agentes',
      headers: { 'x-farol-admin': ADMIN },
      payload: { lojaId, nome: 'agente-cfg' },
    });
    const corpo = criado.json() as { id: string; token: string };
    token = corpo.token;
    agenteId = corpo.id;

    await app.inject({
      method: 'POST',
      url: '/v1/agentes/ativar',
      headers: { authorization: `Bearer ${token}` },
      payload: { fingerprint: 'maquina-de-teste', versao: '0.1.0' },
    });
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  async function configuracao() {
    const r = await app.inject({
      method: 'GET',
      url: '/v1/agentes/configuracao',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(r.statusCode, 200, r.body);
    return r.json();
  }

  async function heartbeat() {
    const r = await app.inject({
      method: 'POST',
      url: '/v1/agentes/heartbeat',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    assert.equal(r.statusCode, 200, r.body);
    return r.json();
  }

  // ─────────────────────────── a descida ───────────────────────────

  it('o agente recebe pontos, zonas e a óptica da própria loja', async () => {
    const c = await configuracao();

    assert.equal(c.loja.id, lojaId);
    assert.equal(c.pontos.length, 1);

    const p = c.pontos[0];
    assert.equal(p.nome, 'bancada');
    assert.equal(p.setor, 'cozinha');
    assert.equal(p.canal, 1);
    assert.equal(p.optica.sensorPol, '1/2.7');
    assert.equal(p.optica.focalMm, 2.8);
    assert.equal(p.zonas.length, 1);
  });

  it('o corte do canal desce marcado como principal', async () => {
    // É o que diz ao agente qual recorte usar quando a regra não mira uma
    // zona específica. Sem a marca ele teria que adivinhar entre as zonas.
    const c = await configuracao();
    const z = c.pontos[0].zonas[0];

    assert.equal(z.principal, true);
    assert.equal(z.larguraCenaCm, 40);
    assert.deepEqual(z.poligono[0], [0.15, 0.47]);
  });

  it('NENHUM campo de segredo desce', async () => {
    // A senha da câmera vive no cofre do agente, na loja, e nunca esteve
    // neste banco. Este teste é a guarda contra alguém, um dia, resolver
    // "facilitar" guardando-a numa coluna.
    const texto = JSON.stringify(await configuracao()).toLowerCase();

    for (const proibido of ['senha', 'password', 'segredo"', 'secret', 'pwd', 'passwd']) {
      assert.ok(!texto.includes(proibido), `vazou '${proibido}' na configuração`);
    }
    // a referência ao cofre PODE descer: é um ponteiro, não o segredo
    const c = await configuracao();
    assert.equal(c.pontos[0].segredoRef, 'cofre://cam1');
  });

  it('regra desligada não desce', async () => {
    // Regra que não deve ser avaliada não tem por que existir no agente.
    const r = await pool.query(
      `with nova as (
         insert into regra (loja_id, nome, tipo, criterio, ativa)
         select st.loja_id, 'desligada', 'estado', 'não deveria descer', false
           from zona z
           join ponto p on p.id = z.ponto_id
           join setor st on st.id = p.setor_id
          where z.id = $1
         returning id
       ), alvo as (
         insert into regra_alvo (regra_id, zona_id) select id, $1 from nova
       )
       select id from nova`,
      [zonaId],
    );

    const c = await configuracao();
    assert.equal(c.pontos[0].zonas[0].regras.length, 0);

    await pool.query('update regra set ativa = true where id = $1', [r.rows[0].id]);
    const depois = await configuracao();
    assert.equal(depois.pontos[0].zonas[0].regras.length, 1);
    assert.equal(depois.pontos[0].zonas[0].regras[0].criterioVersao, 1);

    await pool.query('delete from regra where id = $1', [r.rows[0].id]);
  });

  it('ponto desativado não desce', async () => {
    await pool.query('update ponto set ativo = false where id = $1', [pontoId]);
    const c = await configuracao();
    assert.equal(c.pontos.length, 0);
    await pool.query('update ponto set ativo = true where id = $1', [pontoId]);
  });

  it('um agente só enxerga a configuração da própria loja', async () => {
    const t2 = await pool.query('insert into tenant (nome) values ($1) returning id', [
      `${marca}-outro`,
    ]);
    const l2 = await pool.query(
      'insert into loja (tenant_id, nome) values ($1,$2) returning id',
      [t2.rows[0].id, 'loja alheia'],
    );
    const st2 = await pool.query(
      'insert into setor (loja_id, nome) values ($1,$2) returning id',
      [l2.rows[0].id, 'setor alheio'],
    );
    await pool.query(
      `insert into ponto (setor_id, nome) values ($1,'camera alheia')`,
      [st2.rows[0].id],
    );

    const c = await configuracao();
    const nomes = c.pontos.map((p: { nome: string }) => p.nome);
    assert.ok(!nomes.includes('camera alheia'), 'vazou ponto de outra loja');
  });

  it('sem token de agente é 401', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/agentes/configuracao' });
    assert.equal(r.statusCode, 401);
  });

  // ──────────────────── a versão e o gatilho ────────────────────

  it('mexer na regra sobe a versão da configuração', async () => {
    // O gatilho é o que garante isso de QUALQUER caminho de escrita.
    // Depender da rota lembrar de incrementar é depender de ninguém nunca
    // esquecer — e quando esquece, a loja segue na regra velha calada.
    const antes = (await heartbeat()).configVersao;

    const r = await pool.query(
      `with nova as (
         insert into regra (loja_id, nome, tipo, criterio, ativa)
         select st.loja_id, 'nova', 'estado', 'critério', true
           from zona z
           join ponto p on p.id = z.ponto_id
           join setor st on st.id = p.setor_id
          where z.id = $1
         returning id
       ), alvo as (
         insert into regra_alvo (regra_id, zona_id) select id, $1 from nova
       )
       select id from nova`,
      [zonaId],
    );
    const depoisDeCriar = (await heartbeat()).configVersao;
    assert.ok(depoisDeCriar > antes, `${antes} → ${depoisDeCriar}`);

    await pool.query(`update regra set criterio = 'outro' where id = $1`, [r.rows[0].id]);
    const depoisDeEditar = (await heartbeat()).configVersao;
    assert.ok(depoisDeEditar > depoisDeCriar);

    await pool.query('delete from regra where id = $1', [r.rows[0].id]);
    const depoisDeApagar = (await heartbeat()).configVersao;
    assert.ok(depoisDeApagar > depoisDeEditar, 'apagar também muda o que o agente deve rodar');
  });

  it('mexer na zona sobe a versão', async () => {
    const antes = (await heartbeat()).configVersao;
    await pool.query(
      `update zona set poligono = '[[0,0],[1,0],[1,1],[0,1]]'::jsonb where id = $1`,
      [zonaId],
    );
    assert.ok((await heartbeat()).configVersao > antes, 'redesenhar a área tem que descer');
  });

  it('um canal não pode ter dois cortes principais', async () => {
    await assert.rejects(
      pool.query(
        `insert into zona (ponto_id, nome, poligono, principal)
         values ($1,'segunda principal','[[0,0],[1,0],[1,1],[0,1]]'::jsonb, true)`,
        [pontoId],
      ),
      // Pelo CÓDIGO, não pela mensagem: o texto do Postgres é traduzido
      // conforme o locale do servidor. Esta linha passava só porque a
      // imagem do CI fala inglês — num Postgres em português a mensagem é
      // "duplicar valor da chave" e o teste acusaria falha onde a
      // restrição funcionou. `23505` é unique_violation no padrão SQL.
      (e: unknown) => (e as { code?: string }).code === '23505',
    );
  });

  it('zona não principal convive sem conflito', async () => {
    const z = await pool.query(
      `insert into zona (ponto_id, nome, poligono, principal)
       values ($1,'zona fina','[[0.4,0.4],[0.6,0.4],[0.6,0.6],[0.4,0.6]]'::jsonb, false)
       returning id`,
      [pontoId],
    );
    const c = await configuracao();
    assert.equal(c.pontos[0].zonas.length, 2);
    // a principal vem primeiro: é a que o agente usa por padrão
    assert.equal(c.pontos[0].zonas[0].principal, true);
    await pool.query('delete from zona where id = $1', [z.rows[0].id]);
  });

  // ─────────────────────── o comando de volta ───────────────────────

  it('o comando pendente sai no heartbeat e sai UMA vez só', async () => {
    // Entregar e marcar em dois tempos faria dois heartbeats simultâneos
    // levarem o mesmo comando e capturarem duas vezes.
    await pool.query(
      `insert into comando_agente (agente_id, tipo, ponto_id)
       values ($1,'capturar_quadro',$2)`,
      [agenteId, pontoId],
    );

    const primeiro = await heartbeat();
    assert.equal(primeiro.comandos.length, 1);
    assert.equal(primeiro.comandos[0].tipo, 'capturar_quadro');
    assert.equal(primeiro.comandos[0].pontoId, pontoId);

    const segundo = await heartbeat();
    assert.equal(segundo.comandos.length, 0, 'não pode sair de novo');

    await pool.query('delete from comando_agente where agente_id = $1', [agenteId]);
  });

  it('comando expirado nunca é entregue', async () => {
    // O agente ficou offline e acordou horas depois: a tela que pediu o
    // quadro já foi fechada, e capturar ali produziria imagem de cena real
    // que ninguém espera.
    await pool.query(
      `insert into comando_agente (agente_id, tipo, ponto_id, expira_em)
       values ($1,'capturar_quadro',$2, now() - interval '1 minute')`,
      [agenteId, pontoId],
    );

    const h = await heartbeat();
    assert.equal(h.comandos.length, 0);

    await pool.query('delete from comando_agente where agente_id = $1', [agenteId]);
  });

  it('o heartbeat devolve a versão sem mandar a configuração inteira', async () => {
    const h = await heartbeat();
    assert.equal(typeof h.configVersao, 'number');
    assert.ok(!('pontos' in h), 'a configuração não trafega a cada batida');
  });
});
