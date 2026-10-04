// =====================================================================
// Testes contra Postgres de VERDADE
// =====================================================================
// SQL em string não se confere lendo. O join desta rota atravessa quatro
// tabelas (regra → zona → ponto → setor → loja) porque a regra não guarda
// a loja — escrevi `r.loja_id` de primeira, por suposição, e a coluna não
// existe. Só um banco real diz isso.
//
// Rodam apenas com DATABASE_URL apontando para um Postgres com pgvector e
// as migrations aplicadas. Sem ela, o arquivo se declara pulado em vez de
// falhar: ninguém precisa de um banco para mexer na validação.
//
//   docker run -d -p 5433:5432 -e POSTGRES_PASSWORD=x -e POSTGRES_DB=farol \
//     -e POSTGRES_USER=farol pgvector/pgvector:pg17
//   psql ... -f database/migrations/001_estrutura_inicial.sql   (e 002, 003)
//   DATABASE_URL=postgres://farol:x@localhost:5433/farol npm test
// =====================================================================

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import pg from 'pg';

import { autenticarAgente, ErroDeAuth, hashDoToken } from '../src/auth.js';
import { gravarEventos } from '../src/rotas/eventos.js';
import type { Autor } from '../src/db.js';

const URL = process.env.DATABASE_URL;
const marca = `teste-${randomUUID().slice(0, 8)}`;

describe('gravação de eventos (Postgres real)', { skip: !URL && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let autor: Autor;
  let regraId: string;
  let regraDeOutraLoja: string;
  const token = `tok-${randomUUID()}`;

  async function montarLoja(nome: string) {
    const t = await pool.query('insert into tenant (nome) values ($1) returning id', [
      `${marca}-${nome}`,
    ]);
    const tenantId = t.rows[0].id as string;
    const l = await pool.query(
      'insert into loja (tenant_id, nome) values ($1,$2) returning id',
      [tenantId, nome],
    );
    const lojaId = l.rows[0].id as string;
    const s = await pool.query(
      'insert into setor (loja_id, nome) values ($1,$2) returning id',
      [lojaId, 'cozinha'],
    );
    const p = await pool.query(
      'insert into ponto (setor_id, nome) values ($1,$2) returning id',
      [s.rows[0].id, 'canal11'],
    );
    const z = await pool.query(
      `insert into zona (ponto_id, nome, poligono)
       values ($1,$2,'[[0,0],[1,0],[1,1],[0,1]]'::jsonb) returning id`,
      [p.rows[0].id, 'bancada'],
    );
    const r = await pool.query(
      `insert into regra (zona_id, nome, tipo, criterio)
       values ($1,'limpa','estado','a bancada está limpa') returning id`,
      [z.rows[0].id],
    );
    return { tenantId, lojaId, regraId: r.rows[0].id as string };
  }

  before(async () => {
    pool = new pg.Pool({ connectionString: URL });

    const minha = await montarLoja('minha-loja');
    const vizinha = await montarLoja('loja-vizinha');
    regraId = minha.regraId;
    regraDeOutraLoja = vizinha.regraId;

    const a = await pool.query(
      `insert into agente (loja_id, nome, fingerprint, estado, token_hash, token_emitido_em)
       values ($1,'agente-teste',$2,'ativo',$3, now()) returning id`,
      [minha.lojaId, `${marca}-fp`, hashDoToken(token)],
    );
    autor = {
      agenteId: a.rows[0].id,
      lojaId: minha.lojaId,
      tenantId: minha.tenantId,
    };
  });

  after(async () => {
    if (!pool) return;
    // Cascata derruba loja, setor, ponto, zona, regra, agente e evento.
    await pool.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool.end();
  });

  function evento(extra: Record<string, unknown> = {}) {
    return {
      idempotenciaKey: `${marca}-${randomUUID()}`,
      regraId,
      ocorridoEm: new Date().toISOString(),
      veredito: 'nao_conforme',
      confianca: 0.93,
      motivo: 'restos no canto direito',
      via: 'nuvem',
      modelo: 'claude-haiku-4-5-20251001',
      custoCentavos: 0.42,
      latenciaMs: 1310,
      prioridade: 'intermediaria',
      ...extra,
    } as never;
  }

  it('grava um lote e devolve os aceitos', async () => {
    const lote = [evento(), evento(), evento()];
    const r = await gravarEventos(pool, autor, lote);

    assert.equal(r.aceitos.length, 3);
    assert.deepEqual(r.repetidos, []);
    assert.deepEqual(r.recusados, []);
  });

  it('o mesmo lote de novo vira repetido, não duplicata', async () => {
    // É o caso real: a internet caiu depois do insert e antes da resposta.
    const lote = [evento(), evento()];
    await gravarEventos(pool, autor, lote);
    const segunda = await gravarEventos(pool, autor, lote);

    assert.deepEqual(segunda.aceitos, []);
    assert.equal(segunda.repetidos.length, 2);

    const { rows } = await pool.query(
      'select count(*)::int n from evento where idempotencia_key = any($1::text[])',
      [lote.map((e: never) => (e as { idempotenciaKey: string }).idempotenciaKey)],
    );
    assert.equal(rows[0].n, 2, 'não pode ter gravado quatro');
  });

  it('regra de outra loja é RECUSADA, não gravada', async () => {
    const r = await gravarEventos(pool, autor, [evento({ regraId: regraDeOutraLoja })]);

    assert.deepEqual(r.aceitos, []);
    assert.equal(r.recusados.length, 1);
  });

  it('recusado é diferente de repetido — a fila precisa saber drenar', async () => {
    const bom = evento();
    const ruim = evento({ regraId: regraDeOutraLoja });
    await gravarEventos(pool, autor, [bom]);

    const r = await gravarEventos(pool, autor, [bom, ruim, evento()]);

    assert.equal(r.aceitos.length, 1, 'o terceiro é novo');
    assert.equal(r.repetidos.length, 1, 'o primeiro já existia');
    assert.equal(r.recusados.length, 1, 'o segundo nunca vai entrar');
  });

  it('regra inexistente é recusada, não estoura', async () => {
    const r = await gravarEventos(pool, autor, [evento({ regraId: randomUUID() })]);
    assert.equal(r.recusados.length, 1);
  });

  it('tenant e loja vêm do agente, não do corpo', async () => {
    const e = evento();
    await gravarEventos(pool, autor, [e]);

    const { rows } = await pool.query(
      'select tenant_id, loja_id, agente_id, zona_id from evento where idempotencia_key = $1',
      [(e as { idempotenciaKey: string }).idempotenciaKey],
    );
    assert.equal(rows[0].tenant_id, autor.tenantId);
    assert.equal(rows[0].loja_id, autor.lojaId);
    assert.equal(rows[0].agente_id, autor.agenteId);
    assert.ok(rows[0].zona_id, 'zona sai da regra, não do cliente');
  });

  it('grava embedding de 768 e ele volta inteiro', async () => {
    const vetor = Array.from({ length: 768 }, (_, i) => (i % 10) / 10);
    const e = evento({ embedding: vetor });
    const r = await gravarEventos(pool, autor, [e]);
    assert.equal(r.aceitos.length, 1);

    const { rows } = await pool.query(
      'select embedding from evento where idempotencia_key = $1',
      [(e as { idempotenciaKey: string }).idempotenciaKey],
    );
    const voltou = JSON.parse(rows[0].embedding) as number[];
    assert.equal(voltou.length, 768);
    assert.ok(Math.abs(voltou[7]! - 0.7) < 1e-6);
  });

  it('embedding de dimensão errada é recusado pelo BANCO', async () => {
    // A coluna é vector(768). Mesmo que a validação da rota falhasse, o
    // banco ainda barra — duas redes, porque trocar o modelo de embedding
    // sem perceber estragaria a busca inteira em silêncio.
    await assert.rejects(
      gravarEventos(pool, autor, [evento({ embedding: Array(512).fill(0.1) })]),
      /dimension|768/i,
    );
  });

  it('lote vazio não vai ao banco', async () => {
    const r = await gravarEventos(pool, autor, []);
    assert.deepEqual(r, { aceitos: [], repetidos: [], recusados: [] });
  });

  // ───────────────────────── autenticação ─────────────────────────

  it('token válido identifica loja e tenant', async () => {
    const quem = await autenticarAgente(pool, `Bearer ${token}`);
    assert.equal(quem.lojaId, autor.lojaId);
    assert.equal(quem.tenantId, autor.tenantId);
  });

  it('token errado é 401', async () => {
    await assert.rejects(
      autenticarAgente(pool, 'Bearer nao-existe'),
      (e: unknown) => e instanceof ErroDeAuth && e.status === 401,
    );
  });

  it('sem cabeçalho é 401', async () => {
    await assert.rejects(
      autenticarAgente(pool, undefined),
      (e: unknown) => e instanceof ErroDeAuth && e.status === 401,
    );
  });

  it('esquema que não é Bearer é 401', async () => {
    await assert.rejects(
      autenticarAgente(pool, `Basic ${token}`),
      (e: unknown) => e instanceof ErroDeAuth && e.status === 401,
    );
  });

  it('agente ainda não aprovado é 403, e diz o estado', async () => {
    const outro = `tok-${randomUUID()}`;
    await pool.query(
      `insert into agente (loja_id, nome, fingerprint, estado, token_hash)
       values ($1,'aguardando',$2,'novo',$3)`,
      [autor.lojaId, `${marca}-fp2`, hashDoToken(outro)],
    );

    await assert.rejects(
      autenticarAgente(pool, `Bearer ${outro}`),
      (e: unknown) =>
        e instanceof ErroDeAuth && e.status === 403 && e.motivo === 'agente_novo',
    );
  });

  it('agente bloqueado não entra', async () => {
    const outro = `tok-${randomUUID()}`;
    await pool.query(
      `insert into agente (loja_id, nome, fingerprint, estado, token_hash)
       values ($1,'banido',$2,'bloqueado',$3)`,
      [autor.lojaId, `${marca}-fp3`, hashDoToken(outro)],
    );

    await assert.rejects(
      autenticarAgente(pool, `Bearer ${outro}`),
      (e: unknown) => e instanceof ErroDeAuth && e.status === 403,
    );
  });
});
