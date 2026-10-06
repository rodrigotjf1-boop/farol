// =====================================================================
// Farol · API do console — ponto de entrada
// =====================================================================
// Só sobe o servidor. Quem monta as rotas é `app.ts`, para o teste poder
// construir a aplicação sem abrir porta.
// =====================================================================

import { criarApp } from './app.js';
import { pool } from './db.js';
import { conferirEsquema } from './preflight.js';
import { despacharAgentesCaidos, vigiaPodeAcusar } from './despacho.js';

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

// O que o vigia precisa saber sobre a porta: se ela está recusando pedidos
// (e portanto o sinal de vida dos agentes), e desde quando está aceitando.
const porta = { recusando: !esquema.ok, aceitaDesde: Date.now() };

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
        porta.recusando = false;
        porta.aceitaDesde = Date.now();
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

// ─────────────── o vigia do vigia ───────────────
// Agente sem bater não é só uma máquina parada: é uma loja que PAROU DE
// SER AUDITADA enquanto o console segue mostrando a última tela verde.
// Um produto de auditoria que fica cego sem avisar é pior que não ter
// produto, porque alguém confiou.
//
// Roda em TODA réplica da API sem medo de duplicar: `envio.chave` é única
// e o insert é `on conflict do nothing`. Coordenar réplicas por lock
// custaria mais do que a idempotência que já existe por outro motivo.
const INTERVALO_VIGIA_MS = 60_000;

// Enquanto a migration do alerta não rodou, as tabelas do vigia não
// existem. Dizer isso UMA vez e calar é obrigatório: um erro por minuto
// até alguém abrir o console é a mesma enxurrada que afogou o log do
// agente em 06/10 (ERR-014), e ela esconde a falha de verdade.
let avisouTabelaFaltando = false;

const vigia = setInterval(() => {
  // O vigia não acusa o agente de um silêncio que a própria API impôs:
  // com a guarda de esquema recusando tudo, o sinal de vida também é
  // recusado. Sem isto, demorar mais de cinco minutos entre o deploy e o
  // `npm run migrar` mandaria um falso "o agente caiu" a quem cuida da loja.
  if (!vigiaPodeAcusar(porta, Date.now())) return;

  // `void` com a promessa tratada DENTRO: uma rejeição aqui seria
  // unhandled e derrubaria o processo — e derrubar a API porque o aviso
  // falhou seria trocar um problema pequeno por um grande.
  void despacharAgentesCaidos(pool)
    .then((r) => {
      avisouTabelaFaltando = false;
      if (r.criados > 0) {
        app.log.warn(
          { agentes: r.agentes, avisos: r.criados },
          'agente(s) sem bater: loja não está sendo auditada',
        );
      }
    })
    .catch((e) => {
      // 42P01 = undefined_table. Pelo CÓDIGO, nunca pela mensagem: o
      // Postgres traduz o texto conforme o locale do servidor (ERR-017).
      if ((e as { code?: string }).code === '42P01') {
        if (!avisouTabelaFaltando) {
          avisouTabelaFaltando = true;
          app.log.warn(
            'o vigia de agentes caídos está parado: falta rodar `npm run migrar`. ' +
            'Enquanto isso, a queda de um agente NÃO é avisada.',
          );
        }
        return;
      }
      app.log.error(e, 'o vigia de agentes caídos falhou');
    });
}, INTERVALO_VIGIA_MS);
// Sem isto o contêiner não sai no SIGTERM e o orquestrador o mata à força.
vigia.unref();

try {
  // 0.0.0.0 é obrigatório no contêiner: ouvindo só em localhost, o
  // serviço sobe e o EasyPanel nunca consegue falar com ele.
  await app.listen({ port: PORTA, host: '0.0.0.0' });
} catch (erro) {
  app.log.error(erro, 'não consegui subir');
  process.exit(1);
}
