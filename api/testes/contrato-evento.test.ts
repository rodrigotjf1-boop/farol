// O corpo que o AGENTE manda, contra a API de verdade.
//
// Este teste lê `contratos/evento-do-agente.json` — o mesmo arquivo que
// `agent/testes/test_contrato.py` exige que o agente produza. É a única
// coisa que prende os dois lados um ao outro.
//
// Em 06/10/2026 o agente mandava `idempotencia_key` e a API esperava
// `idempotenciaKey`. Toda subida era recusada com 422, e os dois conjuntos
// de testes passavam: cada lado conferia a si mesmo contra um dublê.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { validarEvento } from '../src/rotas/eventos.js';

const CONTRATO = JSON.parse(
  readFileSync(new URL('../../contratos/evento-do-agente.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

// ───────────────── sem banco: o corpo passa na validação ─────────────────

describe('contrato do evento (validação)', () => {
  it('o corpo do agente é aceito pela validação', () => {
    assert.equal(validarEvento(CONTRATO, 0), null);
  });

  it('o formato ANTIGO do agente é recusado dizendo o campo', () => {
    // A forma exata do defeito, para a mensagem continuar apontando a causa.
    const antigo = {
      idempotencia_key: 'abc', regra_id: CONTRATO.regraId,
      ocorrido_em: CONTRATO.ocorridoEm, veredito: 'nao_conforme',
    };
    assert.match(String(validarEvento(antigo, 0)), /idempotenciaKey/);
  });

  it('hora SEM fuso é recusada, em vez de gravada três horas fora', () => {
    // O banco leria como UTC. A loja está em outro fuso, e o evento ficaria
    // deslocado sem nenhum erro — o pior jeito de errar a hora.
    const semFuso = { ...CONTRATO, ocorridoEm: '2026-10-06T12:00:00' };
    assert.match(String(validarEvento(semFuso, 0)), /fuso/);
  });

  it('aceita os dois jeitos de escrever o fuso', () => {
    for (const quando of ['2026-10-06T15:00:00Z', '2026-10-06T12:00:00-03:00', '2026-10-06T12:00:00-0300']) {
      assert.equal(validarEvento({ ...CONTRATO, ocorridoEm: quando }, 0), null, quando);
    }
  });

  it('recusa versão e hash malformados', () => {
    assert.match(String(validarEvento({ ...CONTRATO, criterioVersao: 0 }, 0)), /criterioVersao/);
    assert.match(String(validarEvento({ ...CONTRATO, criterioVersao: 1.5 }, 0)), /criterioVersao/);
    assert.match(String(validarEvento({ ...CONTRATO, imagemHash: 'não é hex' }, 0)), /imagemHash/);
    assert.match(String(validarEvento({ ...CONTRATO, zonaId: 'z1' }, 0)), /zonaId/);
  });
});

// ───────────────── com banco: cada campo chega à sua coluna ─────────────────

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-contrato-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-contrato';
const SENHA = 'uma senha longa o bastante';

describe('contrato do evento (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  let token = '';
  let regraId = '';
  let zonaId = '';
  let cookie = '';

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    app = criarApp(pool, { logger: false });
    await app.ready();

    const loja = (
      await app.inject({
        method: 'POST', url: '/v1/distribuicao/lojas',
        headers: { 'x-farol-admin': ADMIN },
        payload: { tenant: { nome: marca }, loja: { nome: 'Matriz' }, setores: [{ nome: 'Cozinha' }] },
      })
    ).json();

    await app.inject({
      method: 'POST', url: '/v1/distribuicao/usuarios',
      headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId: loja.tenantId, nome: 'X', email: `dono-${marca}@e.com`, senha: SENHA, nivel: 'presidente' },
    });
    const sessao = await app.inject({
      method: 'POST', url: '/v1/sessao', payload: { email: `dono-${marca}@e.com`, senha: SENHA },
    });
    const biscoito = sessao.headers['set-cookie'];
    cookie = (Array.isArray(biscoito) ? biscoito[0]! : String(biscoito)).split(';')[0]!;

    const ponto = await app.inject({
      method: 'POST', url: `/v1/setores/${loja.setores[0].id}/pontos`,
      headers: { cookie },
      payload: { nome: 'Montagem', origem: 'dvr', canal: 1, host: '192.168.1.108' },
    });
    zonaId = ponto.json().zonas[0].id;

    const regra = await app.inject({
      method: 'POST', url: `/v1/zonas/${zonaId}/regras`,
      headers: { cookie },
      payload: { nome: 'Bancada limpa', tipo: 'estado', criterio: 'A superfície está livre de restos.' },
    });
    assert.equal(regra.statusCode, 201, regra.body);
    regraId = regra.json().id;

    const agente = await app.inject({
      method: 'POST', url: '/v1/distribuicao/agentes',
      headers: { 'x-farol-admin': ADMIN },
      payload: { lojaId: loja.loja.id, nome: 'Agente de teste' },
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

  /** O corpo do contrato, só com os ids trocados pelos deste banco. */
  function corpoDoAgente(chave: string) {
    return { ...CONTRATO, idempotenciaKey: chave, regraId, zonaId };
  }

  it('o corpo do agente ENTRA, e cada campo chega à sua coluna', async () => {
    const chave = `${marca}-contrato`;
    const r = await app.inject({
      method: 'POST', url: '/v1/eventos',
      headers: { authorization: `Bearer ${token}` },
      payload: { eventos: [corpoDoAgente(chave)] },
    });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().aceitos, 1);

    const { rows } = await pool.query(
      `select regra_id, zona_id, criterio_versao, imagem_hash, veredito,
              confianca::float8 as confianca, motivo, modelo, via,
              tokens_entrada, tokens_saida, custo_centavos::float8 as custo_centavos,
              latencia_ms, ocorrido_em
         from evento where idempotencia_key = $1`,
      [chave],
    );
    assert.equal(rows.length, 1);
    const g = rows[0];

    assert.equal(g.regra_id, regraId);
    assert.equal(g.zona_id, zonaId);
    // Os dois campos que a API declarava na consulta e não copiava do corpo.
    assert.equal(g.criterio_versao, CONTRATO.criterioVersao, 'a versão do agente foi ignorada');
    assert.equal(g.imagem_hash, CONTRATO.imagemHash, 'o hash da cena não foi gravado');

    assert.equal(g.veredito, CONTRATO.veredito);
    assert.equal(g.confianca, CONTRATO.confianca);
    assert.equal(g.motivo, CONTRATO.motivo);
    assert.equal(g.modelo, CONTRATO.modelo);
    assert.equal(g.via, CONTRATO.via);
    assert.equal(g.tokens_entrada, CONTRATO.tokensEntrada);
    assert.equal(g.tokens_saida, CONTRATO.tokensSaida);
    assert.equal(g.custo_centavos, CONTRATO.custoCentavos);
    assert.equal(g.latencia_ms, CONTRATO.latenciaMs);

    // O INSTANTE, não o texto: 12:00 em -03:00 são 15:00 UTC.
    assert.equal(
      new Date(g.ocorrido_em).toISOString(),
      new Date(String(CONTRATO.ocorridoEm)).toISOString(),
      'a hora do evento mudou no caminho',
    );
  });

  it('sem a versão no corpo, vale a da regra', async () => {
    // Agente antigo não manda o campo. O evento ainda precisa de uma versão.
    const chave = `${marca}-sem-versao`;
    const { criterioVersao: _fora, ...semVersao } = corpoDoAgente(chave) as Record<string, unknown>;
    const r = await app.inject({
      method: 'POST', url: '/v1/eventos',
      headers: { authorization: `Bearer ${token}` },
      payload: { eventos: [semVersao] },
    });
    assert.equal(r.statusCode, 200, r.body);

    const { rows } = await pool.query(
      'select criterio_versao from evento where idempotencia_key = $1', [chave],
    );
    assert.equal(rows[0].criterio_versao, 1);
  });
});
