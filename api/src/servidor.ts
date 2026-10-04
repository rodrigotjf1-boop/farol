// =====================================================================
// Farol · API do console
// =====================================================================
// Primeira versão enxuta de propósito. O que ela precisa fazer HOJE é
// existir como serviço no EasyPanel, porque é o deploy dela que leva as
// migrations para dentro do contêiner — é isso que tira o SQL da área de
// transferência.
//
// O endpoint /saude segue o modelo do Liame: além de dizer que está de
// pé, informa a ÚLTIMA MIGRATION aplicada. Sem isso, "o deploy subiu" e
// "o banco está na versão certa" viram a mesma pergunta sem resposta.
// =====================================================================

import Fastify from 'fastify';
import pg from 'pg';

const VERSAO = process.env.APP_VERSION ?? '0.1.0';
const PORTA = Number(process.env.PORT ?? 3000);

// Pool pequeno: a API ainda faz pouca coisa, e conexão ociosa contra o
// Postgres custa memória do lado do servidor.
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
});

app.get('/', async () => ({
  servico: 'farol-api',
  versao: VERSAO,
}));

app.get('/saude', async (_req, resposta) => {
  try {
    const { rows } = await pool.query(
      `select nome, aplicada_em
         from farol_migracao
        order by nome desc
        limit 1`,
    );
    const ultima = rows[0];
    return {
      ok: true,
      versao: VERSAO,
      banco: 'ok',
      ultimaMigracao: ultima?.nome ?? null,
      aplicadaEm: ultima?.aplicada_em ?? null,
    };
  } catch (erro) {
    const e = erro as { code?: string; message: string };

    // Tabela ausente é o estado legítimo de banco novo: o serviço está de
    // pé, só ainda não rodou `npm run migrar`. Dizer isso é diferente de
    // "o banco caiu", e a distinção é o que evita caçar o problema errado.
    if (e.code === '42P01') {
      return {
        ok: true,
        versao: VERSAO,
        banco: 'ok',
        ultimaMigracao: null,
        aviso: 'farol_migracao ainda não existe — rode: npm run migrar',
      };
    }

    // Log com o MOTIVO, não só o status: 503 sem a causa não ajuda ninguém
    // às duas da manhã.
    app.log.error({ err: e, codigo: e.code }, 'falha ao consultar o banco em /saude');
    return resposta.status(503).send({
      ok: false,
      versao: VERSAO,
      banco: 'erro',
      motivo: e.code ?? 'desconhecido',
    });
  }
});

async function encerrar(sinal: string) {
  app.log.info(`${sinal} recebido, encerrando`);
  // Nada aqui pode rejeitar: `void promessa` num handler de sinal vira
  // unhandled rejection e o contêiner morre sujo em vez de sair limpo.
  await app.close().catch((e) => app.log.error(e, 'falha ao fechar o servidor'));
  await pool.end().catch((e) => app.log.error(e, 'falha ao fechar o pool'));
  process.exit(0);
}

for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sinal, () => void encerrar(sinal));
}

try {
  // 0.0.0.0 é obrigatório no contêiner: ouvindo só em localhost, o
  // serviço sobe e o EasyPanel nunca consegue falar com ele.
  await app.listen({ port: PORTA, host: '0.0.0.0' });
} catch (erro) {
  app.log.error(erro, 'não consegui subir');
  process.exit(1);
}
