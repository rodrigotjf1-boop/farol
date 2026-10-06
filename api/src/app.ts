// Monta a aplicação sem subir servidor. Separado do `servidor.ts` de
// propósito: assim o teste constrói o app, bate nas rotas por `inject()` e
// exercita o caminho HTTP inteiro — validação, autenticação, código de
// status — sem abrir porta nem depender de rede.

import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';

import { instalarTratamentoDeErros } from './erros.js';
import { rotasDeAgentes } from './rotas/agentes.js';
import { rotasDoConsole } from './rotas/console.js';
import { rotasDeConfiguracao } from './rotas/configuracao.js';
import { rotasDeDiagnostico } from './rotas/diagnostico.js';
import { rotasDePreview } from './rotas/preview.js';
import { rotasDeRegras } from './rotas/regras.js';
import { rotasDeEventos } from './rotas/eventos.js';
import { rotasDeLojas } from './rotas/lojas.js';
import { rotasDeSessao } from './rotas/sessao.js';

export const VERSAO = process.env.APP_VERSION ?? '0.1.0';

export function criarApp(pool: pg.Pool, opcoes: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({
    logger: opcoes.logger === false ? false : { level: process.env.LOG_LEVEL ?? 'info' },
    // O agente manda lote; 500 eventos com embedding de 768 passam folgado
    // do padrão de 1 MB do Fastify.
    bodyLimit: 32 * 1024 * 1024,
  });

  // Antes das rotas: o que o Fastify produz sozinho tambem passa a
  // falar o contrato da casa.
  instalarTratamentoDeErros(app);

  app.get('/', async () => ({ servico: 'farol-api', versao: VERSAO }));

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

      // Tabela ausente é o estado legítimo de banco novo: o serviço está
      // de pé, só ainda não rodou `npm run migrar`. Dizer isso é diferente
      // de "o banco caiu", e a distinção evita caçar o problema errado.
      if (e.code === '42P01') {
        return {
          ok: true,
          versao: VERSAO,
          banco: 'ok',
          ultimaMigracao: null,
          aviso: 'farol_migracao ainda não existe — rode: npm run migrar',
        };
      }

      // Log com o MOTIVO, não só o status: 503 sem a causa não ajuda
      // ninguém às duas da manhã.
      app.log.error({ err: e, codigo: e.code }, 'falha ao consultar o banco em /saude');
      return resposta.status(503).send({
        ok: false,
        versao: VERSAO,
        banco: 'erro',
        motivo: e.code ?? 'desconhecido',
      });
    }
  });

  rotasDeSessao(app, pool);
  rotasDoConsole(app, pool);
  rotasDeRegras(app, pool);
  rotasDeDiagnostico(app, pool);
  rotasDeLojas(app, pool);
  rotasDeAgentes(app, pool);
  rotasDeConfiguracao(app, pool);
  rotasDePreview(app, pool);
  rotasDeEventos(app, pool);

  return app;
}
