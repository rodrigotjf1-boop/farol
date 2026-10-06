// =====================================================================
// Farol · API do console — ponto de entrada
// =====================================================================
// Só sobe o servidor. Quem monta as rotas é `app.ts`, para o teste poder
// construir a aplicação sem abrir porta.
// =====================================================================

import { criarApp } from './app.js';
import { pool } from './db.js';
import { conferirEsquema } from './preflight.js';

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

// Antes de abrir a porta: o esquema está em dia? Subir com o banco atrás
// do código faz o serviço parecer saudável e quebrar em toda requisição
// que tocar a coluna nova.
const esquema = await conferirEsquema(pool);
if (!esquema.ok) {
  app.log.fatal({ pendentes: esquema.pendentes }, 'esquema desatualizado');
  console.error(`
  ESQUEMA DESATUALIZADO

  ${esquema.mensagem}`);

  // NÃO sair. Sair derrubaria o contêiner, o orquestrador reiniciaria em
  // laço, e **o console do serviço deixaria de existir** — que é
  // justamente de onde se roda `npm run migrar`. A guarda trancaria a
  // porta por dentro, com a chave do lado de fora.
  //
  // Em vez disso o serviço sobe e RECUSA todo pedido com 503, dizendo o
  // que falta. O contêiner fica de pé para o console funcionar, a
  // verificação de saúde responde com clareza, e nenhuma requisição
  // chega a tocar uma coluna que não existe.
  // A guarda SE CURA. Sem isto, migrar resolveria o banco e o processo
  // continuaria recusando — com uma mensagem mandando rodar a migration
  // que a pessoa acabou de rodar. O pior tipo de mensagem: a que está
  // errada e parece certa.
  //
  // Reconfere no máximo a cada 10 s: o suficiente para o serviço voltar
  // sozinho logo depois do `npm run migrar`, e raro o bastante para não
  // consultar o banco a cada requisição.
  let bloqueado = true;
  let proximaConferencia = 0;

  app.addHook('onRequest', async (req, resposta) => {
    if (req.url === '/saude' || req.url === '/') return;

    const agora = Date.now();
    if (bloqueado && agora >= proximaConferencia) {
      proximaConferencia = agora + 10_000;
      const nova = await conferirEsquema(pool);
      if (nova.ok) {
        bloqueado = false;
        app.log.info('esquema em dia; voltando a atender');
      }
    }
    if (!bloqueado) return;

    await resposta.status(503).send({
      erro: 'esquema_desatualizado',
      mensagem:
        'o banco está atrás do código. Rode `npm run migrar` no console ' +
        'deste serviço. O serviço volta a atender sozinho em seguida.',
      pendentes: esquema.pendentes,
    });
  });
} else if (esquema.motivo) {
  app.log.warn({ motivo: esquema.motivo }, 'conferência de esquema pulada');
} else {
  app.log.info({ aplicadas: esquema.aplicadas }, 'esquema em dia');
}

try {
  // 0.0.0.0 é obrigatório no contêiner: ouvindo só em localhost, o
  // serviço sobe e o EasyPanel nunca consegue falar com ele.
  await app.listen({ port: PORTA, host: '0.0.0.0' });
} catch (erro) {
  app.log.error(erro, 'não consegui subir');
  process.exit(1);
}
