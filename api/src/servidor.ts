// =====================================================================
// Farol · API do console — ponto de entrada
// =====================================================================
// Só sobe o servidor. Quem monta as rotas é `app.ts`, para o teste poder
// construir a aplicação sem abrir porta.
// =====================================================================

import { criarApp } from './app.js';
import { pool } from './db.js';

const PORTA = Number(process.env.PORT ?? 3000);

const app = criarApp(pool);

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
