// =====================================================================
// Farol · o aplicador de migrations, como função
// =====================================================================
// É o MESMO código para os dois caminhos:
//
//   - `npm run migrar` (scripts/migrar.mjs), à mão, no console do serviço;
//   - a subida do serviço (src/guarda.ts), que aplica o que estiver
//     pendente antes de abrir a porta.
//
// Por isso aqui nada imprime e nada encerra o processo: quem chama recebe
// o resultado e decide o que fazer com ele. O que falhou volta dito —
// qual arquivo, por quê — em vez de virar exceção solta.
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
// tempo não podem aplicar a mesma migration em paralelo: a segunda espera
// a primeira terminar e, quando entra, não acha mais nada pendente.
export const TRAVA = 847_001;

// A pasta fica em lugares diferentes no contêiner (/app/database) e aqui
// (C:\Farol\database), então procura subindo em vez de assumir.
export function acharMigrations(partida = AQUI) {
  let dir = partida;
  for (let i = 0; i < 6; i += 1) {
    const tentativa = path.join(dir, 'database', 'migrations');
    if (existsSync(tentativa)) return tentativa;
    const pai = path.dirname(dir);
    if (pai === dir) break;
    dir = pai;
  }
  return null;
}

// O checksum ignora o fim de linha: o git pode entregar CRLF no Windows e
// LF no contêiner, e o mesmo arquivo não pode mudar de impressão digital
// por causa disso.
export function checksum(sql) {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

/**
 * Aplica as migrations pendentes da `pasta` no banco de `url`.
 *
 * Nunca rejeita. Devolve:
 *
 *   { ok: true,  total, jaAplicadas, aplicadas: [nomes], pendentes: [nomes], ultima }
 *   { ok: false, motivo, mensagem, arquivo?, codigo?, aplicadas: [nomes] }
 *
 * `motivo` é um de: sem_url · sem_pasta · fora_do_padrao · conexao ·
 * editada · falhou. `aplicadas` traz o que entrou NESTA rodada — numa
 * falha, o que foi aplicado antes do arquivo que falhou continua valendo.
 *
 * `dizer` recebe o andamento ({ tipo, ... }) para quem quiser mostrar.
 */
export async function migrar({ url, pasta, soConferir = false, dizer = () => {}, opcoesDoCliente = {} } = {}) {
  const aplicadas = [];
  const falha = (motivo, mensagem, mais = {}) => ({ ok: false, motivo, mensagem, aplicadas, ...mais });

  if (!url) {
    return falha(
      'sem_url',
      'DATABASE_URL ausente. No EasyPanel ela vem do ambiente do serviço;\n  aqui na máquina, exporte antes de rodar.',
    );
  }
  const onde = pasta ?? acharMigrations();
  if (!onde || !existsSync(onde)) return falha('sem_pasta', `não achei database/migrations subindo a partir de ${AQUI}`);

  const arquivos = [];
  for (const nome of readdirSync(onde).filter((n) => n.endsWith('.sql'))) {
    const m = /^(\d+)_/.exec(nome);
    if (!m) return falha('fora_do_padrao', `migration fora do padrão NNN_nome.sql: ${nome}`, { arquivo: nome });
    arquivos.push({ nome, numero: Number(m[1]) });
  }
  arquivos.sort((a, b) => a.numero - b.numero);

  // Client dedicado, nunca Pool: advisory lock de sessão só vale enquanto
  // for a MESMA conexão, e um pool pode devolver outra no meio do caminho.
  // O prazo de conexão existe para a subida do serviço não ficar pendurada
  // num banco que não responde.
  const cliente = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10_000, ...opcoesDoCliente });
  try {
    await cliente.connect();
  } catch (e) {
    // Sem isto, banco fora do ar vira stack trace crua do Node, que não diz
    // a quem está aplicando a migration o que fazer a respeito.
    await cliente.end().catch(() => {});
    return falha(
      'conexao',
      `não consegui conectar ao banco: ${e.message}\n  Confira o DATABASE_URL do serviço (aba Credenciais do farol-db).`,
      { codigo: e.code },
    );
  }

  let travado = false;
  try {
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
    const pendentes = [];

    for (const { nome } of arquivos) {
      const sql = readFileSync(path.join(onde, nome), 'utf8');
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
        return falha(
          'editada',
          `${nome} foi EDITADA depois de aplicada.\n  no banco: ${anterior}\n  no repo:  ${soma}\n` +
            '  Migration aplicada não se edita — crie a próxima na sequência.',
          { arquivo: nome },
        );
      }
    }

    dizer({ tipo: 'inicio', pasta: onde, total: arquivos.length, jaAplicadas: jaAplicadas.size });

    if (pendentes.length === 0) {
      dizer({ tipo: 'nada' });
    } else if (soConferir) {
      dizer({ tipo: 'pendentes', nomes: pendentes.map((p) => p.nome) });
    } else {
      for (const { nome, sql, soma } of pendentes) {
        dizer({ tipo: 'aplicando', nome });
        // Uma transação por arquivo: se a 003 falhar, a 002 continua valendo
        // e só a 003 volta atrás.
        await cliente.query('begin');
        try {
          await cliente.query(sql);
          await cliente.query('insert into farol_migracao (nome, checksum) values ($1, $2)', [nome, soma]);
          await cliente.query('commit');
          aplicadas.push(nome);
          dizer({ tipo: 'aplicada', nome });
        } catch (e) {
          await cliente.query('rollback').catch(() => {});
          dizer({ tipo: 'falhou', nome });
          return falha('falhou', `${nome}: ${e.message}\n  Nada dessa migration foi aplicado.`, { arquivo: nome, codigo: e.code });
        }
      }
      dizer({ tipo: 'fim', quantas: aplicadas.length });
    }

    const ultima = await cliente.query('select nome, aplicada_em from farol_migracao order by nome desc limit 1');
    const u = ultima.rows[0] ? { nome: ultima.rows[0].nome, aplicadaEm: new Date(ultima.rows[0].aplicada_em).toISOString() } : null;
    if (u) dizer({ tipo: 'ultima', ...u });

    return {
      ok: true,
      total: arquivos.length,
      jaAplicadas: jaAplicadas.size,
      aplicadas,
      pendentes: soConferir ? pendentes.map((p) => p.nome) : [],
      ultima: u,
    };
  } catch (e) {
    // O que sobrou: a conexão caiu no meio, a trava não veio, a tabela de
    // controle não pôde ser criada. Volta dito, como o resto.
    return falha('conexao', `o banco deixou de responder no meio da migration: ${e.message}`, { codigo: e.code });
  } finally {
    if (travado) await cliente.query('select pg_advisory_unlock($1)', [TRAVA]).catch(() => {});
    await cliente.end().catch(() => {});
  }
}
