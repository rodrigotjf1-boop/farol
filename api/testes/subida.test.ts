// A subida de verdade: o processo do serviço, num banco VAZIO.
//
// Os outros testes conferem as peças (a guarda com funções de mentira, o
// aplicador num esquema à parte). Este sobe o `servidor.ts` como ele sobe
// em produção e olha de fora, por HTTP, o que aconteceu:
//
//   - com um banco que aceita todas as migrations, o serviço aplica TODAS
//     antes de atender, e o primeiro pedido já é atendido — ninguém precisa
//     rodar nada;
//   - com um banco em que a primeira migration falha (Postgres sem a
//     extensão `vector`, como o desta máquina), o serviço NÃO morre: fica de
//     pé, recusa os pedidos com 503 e a saúde diz em qual arquivo parou.
//
// Os dois desfechos são conferidos — qual deles acontece depende só de o
// Postgres do teste ter ou não a extensão. No CI tem; aqui, não.

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

import { acharMigrations } from '../src/preflight.js';

const URL_DO_BANCO = process.env.DATABASE_URL;
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

function portaLivre(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

describe('a subida do serviço num banco vazio (processo de verdade)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  const banco = `farol_subida_${randomUUID().slice(0, 8)}`;
  const migrations = readdirSync(acharMigrations() as string).filter((n) => n.endsWith('.sql')).sort();
  let admin: pg.Pool;
  let servico: ChildProcess | null = null;
  let base = '';
  let temVector = false;
  let saida = '';

  const pedir = async (caminho: string) => {
    const r = await fetch(`${base}${caminho}`);
    return { status: r.status, corpo: (await r.json()) as Record<string, unknown> };
  };

  before(async () => {
    admin = new pg.Pool({ connectionString: URL_DO_BANCO });
    temVector = (await admin.query(`select 1 from pg_available_extensions where name = 'vector'`)).rowCount === 1;
    await admin.query(`create database ${banco}`);

    const url = new URL(URL_DO_BANCO as string);
    url.pathname = `/${banco}`;
    const porta = await portaLivre();
    base = `http://127.0.0.1:${porta}`;

    servico = spawn(process.execPath, ['--import', 'tsx', 'src/servidor.ts'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, DATABASE_URL: url.toString(), PORT: String(porta), LOG_LEVEL: 'warn', MIGRAR_NA_SUBIDA: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    servico.stdout?.on('data', (d) => { saida += String(d); });
    servico.stderr?.on('data', (d) => { saida += String(d); });

    // espera a porta abrir: com 22 migrations num banco vazio, leva alguns segundos
    const limite = Date.now() + 60_000;
    for (;;) {
      if (servico.exitCode !== null) throw new Error(`o serviço morreu na subida:\n${saida.slice(-1500)}`);
      try {
        const r = await fetch(`${base}/`);
        if (r.ok) break;
      } catch {
        // ainda não abriu
      }
      if (Date.now() > limite) throw new Error(`o serviço não abriu a porta em 60 s:\n${saida.slice(-1500)}`);
      await espera(250);
    }
  });

  after(async () => {
    if (servico && servico.exitCode === null) {
      servico.kill();
      await new Promise((r) => servico?.once('exit', r));
    }
    await admin?.query(`drop database if exists ${banco} with (force)`).catch(() => {});
    await admin?.end().catch(() => {});
  });

  it('o serviço fica de pé, aplique ou não', () => {
    assert.equal(servico?.exitCode, null, 'o processo não pode sair: é do console dele que se conserta');
  });

  it('a saúde conta o que a subida fez com as migrations', async () => {
    const { status, corpo } = await pedir('/saude');
    assert.equal(status, 200);
    assert.equal(corpo.ultimaNoCodigo, migrations[migrations.length - 1]);
    const m = corpo.migracaoNaSubida as { aplicadas?: string[]; falhou?: string | null; motivo?: string };
    assert.ok(m, 'a saúde tem de dizer o que a subida fez');

    if (temVector) {
      assert.deepEqual(m.aplicadas, migrations, 'num banco vazio, a subida aplica TODAS, em ordem');
      assert.equal(corpo.ok, true);
      assert.deepEqual(corpo.pendentes, []);
      assert.equal(corpo.ultimaMigracao, migrations[migrations.length - 1]);
    } else {
      // este Postgres não tem a extensão `vector`: a primeira migration falha
      assert.equal(m.falhou, migrations[0]);
      assert.equal(m.motivo, 'falhou');
      assert.equal(corpo.ok, false);
      assert.deepEqual(corpo.pendentes, migrations, 'nada entrou: tudo continua pendente');
    }
  });

  it('o primeiro pedido já encontra o banco como a subida o deixou', async () => {
    // Sem sessão, a resposta de uma rota de verdade é 401 — desde que a
    // guarda tenha deixado o pedido passar.
    const { status, corpo } = await pedir('/v1/lojas');
    if (temVector) {
      assert.equal(status, 401, `banco em dia: o pedido chega à rota (veio ${status}: ${JSON.stringify(corpo)})`);
    } else {
      assert.equal(status, 503);
      assert.equal(corpo.erro, 'esquema_desatualizado');
      assert.match(String(corpo.mensagem), new RegExp(`${migrations[0]} não pôde ser aplicada na subida`));
    }
  });

  it('o banco ficou como a saúde diz', async () => {
    const url = new URL(URL_DO_BANCO as string);
    url.pathname = `/${banco}`;
    const c = new pg.Client({ connectionString: url.toString() });
    await c.connect();
    try {
      const { rows } = await c.query(`select nome from farol_migracao order by nome`);
      assert.deepEqual(rows.map((r) => r.nome), temVector ? migrations : []);
    } finally {
      await c.end();
    }
  });
});
