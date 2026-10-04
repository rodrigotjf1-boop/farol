import pg from 'pg';

// Pool único do processo. Pequeno: a API ainda faz pouca coisa, e conexão
// ociosa contra o Postgres custa memória do lado do servidor.
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// Sem `on('connect')` rodando query: handler que falha em pool derruba a
// conexão num ponto onde ninguém está esperando erro, e o pool entra em
// laço de reconexão difícil de diagnosticar.

export type Autor = {
  agenteId: string;
  lojaId: string;
  tenantId: string;
};
