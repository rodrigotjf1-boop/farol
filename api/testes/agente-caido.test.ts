// O vigia do vigia.
//
// Agente sem bater não é "uma máquina parada": é uma loja que PAROU DE
// SER AUDITADA enquanto o console segue verde. É o alerta mais urgente
// que este produto tem, porque é o único que diz que todos os outros
// deixaram de existir.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import pg from 'pg';

import { despacharAgentesCaidos } from '../src/despacho.js';

const URL = process.env.DATABASE_URL;
const marca = `teste-caido-${randomUUID().slice(0, 8)}`;

describe('agente caído (Postgres real)', { skip: !URL && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let tenantId = '';
  let lojaId = '';
  let agenteId = '';
  let destinoId = '';

  before(async () => {
    pool = new pg.Pool({ connectionString: URL });

    tenantId = (await pool.query(
      'insert into tenant (nome) values ($1) returning id', [marca],
    )).rows[0].id;
    lojaId = (await pool.query(
      'insert into loja (tenant_id, nome) values ($1,$2) returning id',
      [tenantId, 'Matriz'],
    )).rows[0].id;
    destinoId = (await pool.query(
      `insert into destino (tenant_id, loja_id, tipo, nome, endereco)
       values ($1,$2,'whatsapp','Dono','+5521999990000') returning id`,
      [tenantId, lojaId],
    )).rows[0].id;
  });

  after(async () => {
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  async function criarAgente(minutosAtras: number | null, estado = 'ativo') {
    const { rows } = await pool.query(
      `insert into agente (loja_id, nome, fingerprint, estado, ultimo_heartbeat)
       values ($1,$2,$3,$4,
               case when $5::int is null then null
                    else now() - ($5 || ' minutes')::interval end)
       returning id`,
      [lojaId, `ag-${randomUUID().slice(0, 6)}`, `fp-${randomUUID()}`,
       estado, minutosAtras],
    );
    return rows[0].id as string;
  }

  const envios = async (motivo = 'agente_caiu') =>
    Number((await pool.query(
      'select count(*) from envio where loja_id = $1 and motivo = $2',
      [lojaId, motivo],
    )).rows[0].count);

  it('agente batendo agora NÃO gera aviso', async () => {
    await criarAgente(0);
    await despacharAgentesCaidos(pool, 5);
    assert.equal(await envios(), 0);
  });

  it('agente sem bater há mais que o limite GERA aviso', async () => {
    agenteId = await criarAgente(30);
    const r = await despacharAgentesCaidos(pool, 5);
    assert.ok(r.agentes >= 1);
    assert.equal(await envios(), 1);
  });

  it('rodar o vigia de novo não duplica o aviso', async () => {
    // O job roda a cada minuto, em toda réplica da API. Sem idempotência,
    // um agente fora do ar num fim de semana geraria milhares de linhas e
    // afogaria todo o resto da fila.
    await despacharAgentesCaidos(pool, 5);
    await despacharAgentesCaidos(pool, 5);
    assert.equal(await envios(), 1, 'a chave do envio tem que absorver');
  });

  it('seis horas depois, avisa DE NOVO: silêncio longo parece normalidade', async () => {
    // A faixa conta desde a queda. Avançar o heartbeat para trás simula a
    // passagem do tempo sem esperar seis horas no teste.
    await pool.query(
      `update agente set ultimo_heartbeat = now() - interval '7 hours' where id = $1`,
      [agenteId],
    );
    await despacharAgentesCaidos(pool, 5);
    assert.equal(await envios(), 2, 'a segunda faixa é um aviso novo');
  });

  it('agente que NUNCA bateu não é agente caído', async () => {
    // É agente que ninguém instalou ainda. Avisar disso como emergência
    // treinaria o dono a ignorar o aviso — e o aviso que se ignora é pior
    // que aviso nenhum.
    const antes = await envios();
    await criarAgente(null);
    await despacharAgentesCaidos(pool, 5);
    assert.equal(await envios(), antes);
  });

  it('agente inativo ou bloqueado não gera aviso', async () => {
    const antes = await envios();
    await criarAgente(60, 'inativo');
    await criarAgente(60, 'bloqueado');
    await despacharAgentesCaidos(pool, 5);
    assert.equal(await envios(), antes, 'desligado de propósito não é queda');
  });

  it('o aviso diz a CONSEQUÊNCIA, não só o fato técnico', async () => {
    // "Agente sem heartbeat" não significa nada para quem é dono de um
    // bar. "Esta loja não está sendo auditada" significa.
    const { rows } = await pool.query(
      `select payload from envio
        where loja_id = $1 and motivo = 'agente_caiu' limit 1`,
      [lojaId],
    );
    assert.match(rows[0].payload.consequencia, /não está sendo auditada/);
    assert.ok(rows[0].payload.agente, 'e diz QUAL agente');
    assert.ok(rows[0].payload.desde, 'e desde quando');
  });

  it('loja sem destino cadastrado não gera envio órfão', async () => {
    // Um envio sem destino ficaria pendente para sempre, e a fila do
    // transporte viraria um cemitério que esconde o envio que importa.
    await pool.query('update destino set ativo = false where id = $1', [destinoId]);
    const antes = await envios();
    await criarAgente(90);
    await despacharAgentesCaidos(pool, 5);
    assert.equal(await envios(), antes);
    await pool.query('update destino set ativo = true where id = $1', [destinoId]);
  });

  it('o veto explícito da loja silencia até a queda do agente', async () => {
    await pool.query(
      `insert into politica_alerta (tenant_id, loja_id, severidade, enviar)
       values ($1,$2,'emergencia',false)`,
      [tenantId, lojaId],
    );
    const antes = await envios();
    const novo = await criarAgente(120);
    await despacharAgentesCaidos(pool, 5);
    assert.equal(await envios(), antes, 'quem pediu para não ser avisado não é avisado');
    await pool.query('delete from politica_alerta where tenant_id = $1', [tenantId]);
    await pool.query('delete from agente where id = $1', [novo]);
  });
});

// ───────────── quando o vigia NÃO pode acusar: sem banco ─────────────

describe('o vigia não acusa um silêncio que a própria API impôs', () => {
  const MIN = 60_000;
  const T0 = Date.parse('2026-10-06T12:00:00Z');

  it('com a guarda de esquema recusando pedidos, não acusa ninguém', async () => {
    // A guarda responde 503 a tudo — inclusive ao sinal de vida. Se o dono
    // levar mais de cinco minutos entre o deploy e a migration, todo agente
    // parece caído, e o motivo é a própria API.
    const { vigiaPodeAcusar } = await import('../src/despacho.js');
    const porta = { recusando: true, aceitaDesde: T0 - 60 * MIN };
    assert.equal(vigiaPodeAcusar(porta, T0), false);
  });

  it('logo depois de voltar a aceitar, ainda espera os agentes aparecerem', async () => {
    const { vigiaPodeAcusar } = await import('../src/despacho.js');
    const porta = { recusando: false, aceitaDesde: T0 };
    assert.equal(vigiaPodeAcusar(porta, T0 + 1 * MIN), false, 'um minuto não dá tempo de ninguém bater');
    assert.equal(vigiaPodeAcusar(porta, T0 + 4 * MIN + 59_000), false);
  });

  it('passada a carência, volta a vigiar', async () => {
    // A carência não pode virar cegueira: agente que caiu de verdade antes
    // do deploy continua caído depois, e tem que ser acusado.
    const { vigiaPodeAcusar } = await import('../src/despacho.js');
    const porta = { recusando: false, aceitaDesde: T0 };
    assert.equal(vigiaPodeAcusar(porta, T0 + 5 * MIN), true);
    assert.equal(vigiaPodeAcusar(porta, T0 + 3 * 60 * MIN), true);
  });
});
