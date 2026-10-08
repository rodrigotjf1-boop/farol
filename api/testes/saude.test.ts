// A saúde tem de dizer a verdade sobre a porta.
//
// Em 07/10/2026 três PRs entraram na `main` em 44 segundos, e um deles
// levava a migration 022. O deploy subiu com o código novo, a guarda de
// partida passou a recusar TODO pedido com 503 — e `/saude`, que fica de
// fora da guarda, respondeu `ok: true` durante os três minutos que isso
// durou. Quem olhava a saúde via verde; a loja levava 503 em cada batida.
//
// O que tem de ficar provado:
//
//   - com o banco atrás do código, a saúde diz `ok: false`, lista o que
//     falta e diz o comando — sem mudar o status, que segue 200 para o
//     contêiner (e o console de onde se roda a migration) continuar de pé;
//   - com o banco em dia, nada de aviso;
//   - `ultimaNoCodigo` diz qual código está no ar, que é pergunta diferente
//     de "o que o banco tem";
//   - sem a pasta de migrations, a saúde não acusa o que não tem como saber.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { acharMigrations, conferirEsquema } from '../src/preflight.js';

const URL_DO_BANCO = process.env.DATABASE_URL;
const A_MAIS = '999_que_o_banco_nao_tem.sql';
// O teste monta a SUA tabela de controle, num esquema só dele: não depende
// de como o banco de teste foi migrado, nem mexe no controle de verdade.
const ESQUEMA = `teste_saude_${randomUUID().slice(0, 8)}`;
const NO_BANCO = ['001_primeira.sql', '002_segunda.sql', '003_terceira.sql'];

describe('a saúde e o banco atrás do código (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  const aplicadas = NO_BANCO;
  let emDia = '';
  let adiantada = '';
  const apps: FastifyInstance[] = [];

  /** Uma pasta só com os NOMES: a conferência compara nomes, não lê o SQL. */
  function pastaCom(nomes: string[]): string {
    const pasta = mkdtempSync(join(tmpdir(), 'farol-saude-'));
    for (const n of nomes) writeFileSync(join(pasta, n), '-- só o nome importa\n');
    return pasta;
  }

  async function saude(pastaDeMigrations: string | null) {
    const app = criarApp(pool, { logger: false, pastaDeMigrations });
    apps.push(app);
    await app.ready();
    const r = await app.inject({ method: 'GET', url: '/saude' });
    return { status: r.statusCode, corpo: r.json() as Record<string, unknown> };
  }

  before(async () => {
    // Toda conexão do pool procura primeiro no esquema do teste: é a
    // `farol_migracao` DELE que a rota e a conferência enxergam.
    pool = new pg.Pool({ connectionString: URL_DO_BANCO, options: `-c search_path=${ESQUEMA},public` });
    await pool.query(`create schema ${ESQUEMA}`);
    await pool.query(
      `create table ${ESQUEMA}.farol_migracao (
         nome        text primary key,
         checksum    text        not null,
         aplicada_em timestamptz not null default now()
       )`,
    );
    for (const nome of aplicadas) {
      await pool.query(`insert into ${ESQUEMA}.farol_migracao (nome, checksum) values ($1, 'teste')`, [nome]);
    }
    // O que o banco tem, nem mais nem menos — e a mesma coisa com uma a mais.
    emDia = pastaCom(aplicadas);
    adiantada = pastaCom([...aplicadas, A_MAIS]);
  });

  after(async () => {
    for (const app of apps) await app.close();
    await pool?.query(`drop schema if exists ${ESQUEMA} cascade`).catch(() => {});
    await pool?.end().catch(() => {});
    for (const pasta of [emDia, adiantada]) if (pasta) rmSync(pasta, { recursive: true, force: true });
  });

  it('banco em dia: ok, nada pendente e nenhum aviso', async () => {
    const { status, corpo } = await saude(emDia);
    const ultima = aplicadas[aplicadas.length - 1];

    assert.equal(status, 200);
    assert.equal(corpo.ok, true);
    assert.deepEqual(corpo.pendentes, []);
    assert.equal('aviso' in corpo, false, 'banco em dia não leva aviso');
    assert.equal(corpo.ultimaMigracao, ultima);
    assert.equal(corpo.ultimaNoCodigo, ultima);
  });

  it('banco atrás do código: a saúde DIZ, lista o que falta e o comando', async () => {
    const { corpo } = await saude(adiantada);

    assert.equal(corpo.ok, false, 'a API está recusando tudo: a saúde não pode dizer ok');
    assert.deepEqual(corpo.pendentes, [A_MAIS]);
    assert.match(String(corpo.aviso), /npm run migrar/);
    assert.match(String(corpo.aviso), /503/);
    // o banco responde: o problema não é ele
    assert.equal(corpo.banco, 'ok');
  });

  it('banco atrás do código: o status segue 200', async () => {
    // Verificação de saúde que derruba contêiner levaria junto o console de
    // onde se roda a migration. Quem diz que não está bem é o corpo.
    const { status } = await saude(adiantada);
    assert.equal(status, 200);
  });

  it('diz qual código está no ar, que é diferente do que o banco tem', async () => {
    const { corpo } = await saude(adiantada);

    assert.equal(corpo.ultimaNoCodigo, A_MAIS);
    assert.equal(corpo.ultimaMigracao, aplicadas[aplicadas.length - 1]);
    assert.notEqual(corpo.ultimaNoCodigo, corpo.ultimaMigracao);
  });

  it('sem a pasta de migrations, não acusa o que não tem como saber', async () => {
    const { status, corpo } = await saude(null);

    assert.equal(status, 200);
    assert.equal(corpo.ok, true);
    assert.deepEqual(corpo.pendentes, []);
    assert.equal(corpo.ultimaNoCodigo, null);
  });

  it('a conferência devolve a última migration do código nos dois casos', async () => {
    const bem = await conferirEsquema(pool, emDia);
    assert.equal(bem.ok, true);
    assert.equal(bem.noCodigo, aplicadas[aplicadas.length - 1]);

    const mal = await conferirEsquema(pool, adiantada);
    assert.equal(mal.ok, false);
    assert.equal(mal.noCodigo, A_MAIS);
  });

  it('sem dizer a pasta, usa a que veio com o código', async () => {
    // É o caminho de produção: a guarda de partida chama sem o segundo
    // argumento, e a rota também quando ninguém passa a opção.
    const pasta = acharMigrations();
    assert.ok(pasta);
    const reais = readdirSync(pasta).filter((n) => n.endsWith('.sql')).sort();

    const r = await conferirEsquema(pool);
    assert.equal(r.noCodigo, reais[reais.length - 1]);

    const app = criarApp(pool, { logger: false });
    apps.push(app);
    await app.ready();
    const corpo = (await app.inject({ method: 'GET', url: '/saude' })).json() as Record<string, unknown>;
    assert.equal(corpo.ultimaNoCodigo, reais[reais.length - 1]);
  });
});

describe('a saúde com o banco fora do ar', () => {
  it('503, sem inventar o que está pendente', async () => {
    const morto = new pg.Pool({ connectionString: 'postgres://ninguem@127.0.0.1:1/nada' });
    const app = criarApp(morto, { logger: false });
    await app.ready();

    const r = await app.inject({ method: 'GET', url: '/saude' });
    const corpo = r.json() as Record<string, unknown>;
    assert.equal(r.statusCode, 503);
    assert.equal(corpo.ok, false);
    assert.equal(corpo.banco, 'erro');
    assert.equal('pendentes' in corpo, false);

    await app.close();
    await morto.end().catch(() => {});
  });
});
