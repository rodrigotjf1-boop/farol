// =====================================================================
// Farol · API do console — ponto de entrada
// =====================================================================
// Só sobe o servidor. Quem monta as rotas é `app.ts`, para o teste poder
// construir a aplicação sem abrir porta.
// =====================================================================

import { criarApp, VERSAO } from './app.js';
import { carregarCatalogo } from './catalogo.js';
import { pool } from './db.js';
import { conferirEsquema } from './preflight.js';
import { despacharAgentesCaidos, vigiaPodeAcusar } from './despacho.js';
import { instalarGuarda, type Subida } from './guarda.js';
import { voltaDaLeitura, type MemoriaDaRotina } from './leitura.js';
import { migrarNaSubida } from './migracao.js';
import { configDoRegem } from './regem.js';

const PORTA = Number(process.env.PORT ?? 3000);

// O que a subida fez com as migrations. A rota de saúde lê daqui.
const subida: Subida = { migracao: null };

// Como falar com o Regem, lido do ambiente UMA vez: as rotas e a rotina de
// leitura usam o mesmo.
const regem = configDoRegem(process.env, VERSAO);

const app = criarApp(pool, { subida, regem });

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

// ─────────────── o catálogo de equipamentos ───────────────
// A fonte é `catalogo/`, que veio na imagem; o banco guarda a cópia. Copia
// a cada subida, e de novo quando a guarda de esquema se cura — é assim que
// um modelo novo chega ao banco sem ninguém rodar nada.
//
// Nunca rejeita e nunca segura a subida: catálogo desatualizado é orçamento
// desatualizado; API fora do ar é loja sem auditoria.
function copiarCatalogo(): void {
  void carregarCatalogo(pool)
    .then((r) => {
      if (r.ok) {
        app.log.info(
          { equipamentos: r.equipamentos, usos: r.usos, foraDoCatalogo: r.foraDoCatalogo },
          'catálogo de equipamentos copiado para o banco',
        );
      } else {
        app.log.warn({ motivo: r.motivo }, 'catálogo de equipamentos NÃO foi copiado para o banco');
      }
    })
    .catch((e) => app.log.error(e, 'a carga do catálogo falhou'));
}

// Antes de abrir a porta: pôr o banco em dia. A guarda aplica as
// migrations pendentes e confere; se o banco ainda ficar atrás do código,
// recusa os pedidos com 503 dizendo o que falta (ver guarda.ts).
//
// `MIGRAR_NA_SUBIDA=nao` volta ao jeito antigo: o serviço só confere, e
// quem aplica é o `npm run migrar` no console.
const MIGRAR_NA_SUBIDA = process.env.MIGRAR_NA_SUBIDA !== 'nao';

// O que o vigia precisa saber sobre a porta: se ela está recusando pedidos
// (e portanto o sinal de vida dos agentes), e desde quando está aceitando.
const { porta } = await instalarGuarda(app, {
  conferir: () => conferirEsquema(pool),
  migrar: MIGRAR_NA_SUBIDA ? () => migrarNaSubida(process.env.DATABASE_URL, app.log) : null,
  subida,
  aoFicarEmDia: copiarCatalogo,
});

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

// ─────────────── a leitura das fichas ───────────────
// As fichas de cada loja ligada ao Regem são lidas ao ligar, uma vez por dia
// (de madrugada, no relógio da loja) e a pedido. Este relógio só olha, a
// cada minuto, se chegou a hora de alguma — a consulta usa um índice e, na
// imensa maioria das voltas, não acha nada.
//
// É um relógio À PARTE do vigia, de propósito: cada um guarda o seu passo, e
// mexer num não muda o ritmo do outro.
//
// Em toda réplica, sem coordenar: cada leitura pega a vez da loja numa
// instrução só, e de duas réplicas uma leva.
const INTERVALO_DA_LEITURA_MS = 60_000;
const memoriaDaLeitura: MemoriaDaRotina = { avisouQueFaltaMigrar: false };

const leitura = setInterval(() => {
  // `voltaDaLeitura` nunca rejeita: trata por dentro o que der errado.
  void voltaDaLeitura(pool, regem, app.log, () => !porta.recusando, memoriaDaLeitura);
}, INTERVALO_DA_LEITURA_MS);
leitura.unref();

try {
  // 0.0.0.0 é obrigatório no contêiner: ouvindo só em localhost, o
  // serviço sobe e o EasyPanel nunca consegue falar com ele.
  await app.listen({ port: PORTA, host: '0.0.0.0' });
} catch (erro) {
  app.log.error(erro, 'não consegui subir');
  process.exit(1);
}
