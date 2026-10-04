#!/usr/bin/env node
// =====================================================================
// Farol · aplicador de migrations
// =====================================================================
// Roda DENTRO do contêiner do farol-api, onde as migrations chegaram
// pelo deploy e o DATABASE_URL já existe no ambiente. É o que tira o SQL
// da área de transferência: migration passa a viajar pelo git, não pelo
// Ctrl+V num terminal de navegador.
//
//   npm run migrar              aplica as pendentes
//   npm run migrar:conferir     só lista, não aplica
//
// Mora em api/scripts/ e não junto das migrations porque precisa do `pg`,
// e o `pg` é dependência da API — resolver módulo a partir de uma pasta
// sem node_modules acima não funciona.
//
// Sem build: é .mjs puro de propósito. Ferramenta de migration tem que
// funcionar mesmo quando o build da API está quebrado.
// =====================================================================

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

// Chave fixa do advisory lock. Duas réplicas da API subindo ao mesmo
// tempo não podem aplicar a mesma migration em paralelo.
const TRAVA = 847_001;

const SO_CONFERIR = process.argv.includes('--conferir');

function morrer(mensagem) {
  console.error(`\n  ERRO: ${mensagem}\n`);
  process.exit(1);
}

// A pasta fica em lugares diferentes no contêiner (/app/database) e aqui
// (C:\Farol\database), então procura subindo em vez de assumir.
function acharMigrations() {
  let dir = AQUI;
  for (let i = 0; i < 6; i += 1) {
    const tentativa = path.join(dir, 'database', 'migrations');
    if (existsSync(tentativa)) return tentativa;
    const pai = path.dirname(dir);
    if (pai === dir) break;
    dir = pai;
  }
  return morrer(`não achei database/migrations subindo a partir de ${AQUI}`);
}

// O checksum ignora o fim de linha: o git pode entregar CRLF no Windows e
// LF no contêiner, e o mesmo arquivo não pode mudar de impressão digital
// por causa disso.
function checksum(sql) {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

function listarArquivos(pasta) {
  return readdirSync(pasta)
    .filter((n) => n.endsWith('.sql'))
    .map((nome) => {
      const m = /^(\d+)_/.exec(nome);
      if (!m) morrer(`migration fora do padrão NNN_nome.sql: ${nome}`);
      return { nome, numero: Number(m[1]) };
    })
    .sort((a, b) => a.numero - b.numero);
}

const url = process.env.DATABASE_URL;
if (!url) {
  morrer(
    'DATABASE_URL ausente. No EasyPanel ela vem do ambiente do serviço;\n' +
      '  aqui na máquina, exporte antes de rodar.',
  );
}

const PASTA = acharMigrations();
const cliente = new pg.Client({ connectionString: url });

try {
  await cliente.connect();
} catch (e) {
  // Sem isto, banco fora do ar vira stack trace crua do Node, que não diz
  // a quem está aplicando a migration o que fazer a respeito.
  morrer(
    `não consegui conectar ao banco: ${e.message}\n` +
      '  Confira o DATABASE_URL do serviço (aba Credenciais do farol-db).',
  );
}

let travado = false;
try {
  // Client dedicado, nunca Pool: advisory lock de sessão só vale enquanto
  // for a MESMA conexão, e um pool pode devolver outra no meio do caminho.
  await cliente.query('select pg_advisory_lock($1)', [TRAVA]);
  travado = true;

  await cliente.query(`
    create table if not exists farol_migracao (
      nome        text primary key,
      checksum    text        not null,
      aplicada_em timestamptz not null default now()
    )
  `);

  const { rows } = await cliente.query('select nome, checksum from farol_migracao');
  const jaAplicadas = new Map(rows.map((r) => [r.nome, r.checksum]));

  const arquivos = listarArquivos(PASTA);
  const pendentes = [];

  for (const { nome } of arquivos) {
    const sql = readFileSync(path.join(PASTA, nome), 'utf8');
    const soma = checksum(sql);
    const anterior = jaAplicadas.get(nome);

    if (anterior === undefined) {
      pendentes.push({ nome, sql, soma });
      continue;
    }

    // Migration já aplicada que mudou de conteúdo é o erro silencioso
    // clássico: o banco tem a versão velha, o repo mostra a nova, e
    // ninguém percebe até algo quebrar em produção.
    if (anterior !== soma) {
      morrer(
        `${nome} foi EDITADA depois de aplicada.\n` +
          `  no banco: ${anterior}\n` +
          `  no repo:  ${soma}\n` +
          '  Migration aplicada não se edita — crie a próxima na sequência.',
      );
    }
  }

  console.log(`\n  ${PASTA}`);
  console.log(`  ${arquivos.length} migrations no repo · ${jaAplicadas.size} já aplicadas\n`);

  if (pendentes.length === 0) {
    console.log('  nada pendente, banco em dia\n');
  } else if (SO_CONFERIR) {
    console.log('  PENDENTES (modo --conferir, nada foi aplicado):');
    for (const p of pendentes) console.log(`    ${p.nome}`);
    console.log();
  } else {
    for (const { nome, sql, soma } of pendentes) {
      process.stdout.write(`  aplicando ${nome} ... `);
      // Uma transação por arquivo: se a 003 falhar, a 002 continua valendo
      // e só a 003 volta atrás.
      await cliente.query('begin');
      try {
        await cliente.query(sql);
        await cliente.query(
          'insert into farol_migracao (nome, checksum) values ($1, $2)',
          [nome, soma],
        );
        await cliente.query('commit');
        console.log('ok');
      } catch (e) {
        await cliente.query('rollback');
        console.log('FALHOU');
        morrer(`${nome}: ${e.message}\n  Nada dessa migration foi aplicado.`);
      }
    }
    console.log(`\n  ${pendentes.length} aplicada(s)\n`);
  }

  const ultima = await cliente.query(
    'select nome, aplicada_em from farol_migracao order by nome desc limit 1',
  );
  if (ultima.rows[0]) {
    const { nome, aplicada_em } = ultima.rows[0];
    console.log(`  última: ${nome} em ${new Date(aplicada_em).toISOString()}\n`);
  }
} finally {
  if (travado) {
    await cliente.query('select pg_advisory_unlock($1)', [TRAVA]).catch(() => {});
  }
  await cliente.end();
}
