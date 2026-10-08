// Monta a aplicação sem subir servidor. Separado do `servidor.ts` de
// propósito: assim o teste constrói o app, bate nas rotas por `inject()` e
// exercita o caminho HTTP inteiro — validação, autenticação, código de
// status — sem abrir porta nem depender de rede.

import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';

import { instalarTratamentoDeErros } from './erros.js';
import type { Subida } from './guarda.js';
import { acharMigrations, conferirEsquema } from './preflight.js';
import { rotasDeAgentes } from './rotas/agentes.js';
import { rotasDeAlertas } from './rotas/alertas.js';
import { rotasDoConsole } from './rotas/console.js';
import { rotasDeConfiguracao } from './rotas/configuracao.js';
import { rotasDeDiagnostico } from './rotas/diagnostico.js';
import { rotasDeInventario } from './rotas/inventario.js';
import { rotasDePlanta } from './rotas/planta.js';
import { rotasDePadroes } from './rotas/padroes.js';
import { rotasDePreview } from './rotas/preview.js';
import { rotasDeRegras } from './rotas/regras.js';
import { rotasDeEventos } from './rotas/eventos.js';
import { rotasDeLojas } from './rotas/lojas.js';
import { rotasDeOrcamento } from './rotas/orcamento.js';
import { rotasDeAnalises } from './rotas/analises.js';
import { rotasDeResultados } from './rotas/resultados.js';
import { rotasDeResumos } from './rotas/resumos.js';
import { rotasDeUso } from './rotas/uso.js';
import { rotasDeSessao } from './rotas/sessao.js';

export const VERSAO = process.env.APP_VERSION ?? '0.1.0';

export function criarApp(
  pool: pg.Pool,
  opcoes: { logger?: boolean; pastaDeMigrations?: string | null; subida?: Subida } = {},
): FastifyInstance {
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

  // Quantos modelos do catálogo de equipamentos estão no banco. É só o
  // NÚMERO — o catálogo é da distribuição e não sai por rota nenhuma. Serve
  // para conferir, de fora, que a cópia aconteceu depois do deploy.
  //
  // Tolerante: antes da migration 015 a coluna não existe, e a verificação
  // de saúde não pode cair por causa disso.
  async function modelosNoCatalogo(): Promise<number | null> {
    try {
      const c = await pool.query(
        'select count(*)::int as n from equipamento where slug is not null',
      );
      return c.rows[0].n;
    } catch {
      return null;
    }
  }

  app.get('/saude', async (_req, resposta) => {
    try {
      const { rows } = await pool.query(
        `select nome, aplicada_em
           from farol_migracao
          order by nome desc
          limit 1`,
      );
      const ultima = rows[0];

      // O banco responder não quer dizer que a API atende. Com o banco
      // atrás do código, a guarda de partida recusa TODO o resto com 503
      // — e esta rota, que fica de fora da guarda, dizia `ok: true`. Em
      // 07/10/2026 foram três minutos assim: quem olhava a saúde via
      // verde, e a loja levava 503 em cada batida.
      //
      // O status segue 200 de propósito: quem derruba contêiner por
      // verificação de saúde levaria junto o console de onde se roda a
      // migration. Quem diz que não está bem é o corpo.
      const esquema = await conferirEsquema(
        pool,
        opcoes.pastaDeMigrations === undefined ? acharMigrations() : opcoes.pastaDeMigrations,
      );
      const pendentes = esquema.ok ? [] : esquema.pendentes;
      return {
        ok: pendentes.length === 0,
        versao: VERSAO,
        banco: 'ok',
        ultimaMigracao: ultima?.nome ?? null,
        aplicadaEm: ultima?.aplicada_em ?? null,
        // A última migration que o código NO AR conhece. `versao` é fixa;
        // é por aqui que se sabe, de fora, qual deploy ficou.
        ultimaNoCodigo: esquema.noCodigo,
        pendentes,
        // O que a subida deste processo fez com as migrations: quais
        // aplicou, ou em qual parou. Só o nome do arquivo e o código do
        // banco — o texto do erro fica no log do contêiner.
        ...(opcoes.subida?.migracao
          ? {
              migracaoNaSubida: opcoes.subida.migracao.ok
                ? { aplicadas: opcoes.subida.migracao.aplicadas }
                : {
                    falhou: opcoes.subida.migracao.arquivo ?? null,
                    motivo: opcoes.subida.migracao.motivo,
                    codigo: opcoes.subida.migracao.codigo ?? null,
                  },
            }
          : {}),
        ...(pendentes.length > 0
          ? {
              aviso:
                'o banco está atrás do código: a API recusa os pedidos com 503 até as ' +
                'migrations pendentes serem aplicadas. `npm run migrar`, no console ' +
                'deste serviço, aplica e mostra o motivo se não conseguir',
            }
          : {}),
        catalogoModelos: await modelosNoCatalogo(),
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
          catalogoModelos: await modelosNoCatalogo(),
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
  rotasDeOrcamento(app, pool);
  rotasDeLojas(app, pool);
  rotasDeAgentes(app, pool);
  rotasDeConfiguracao(app, pool);
  rotasDePreview(app, pool);
  rotasDePadroes(app, pool);
  rotasDeInventario(app, pool);
  rotasDePlanta(app, pool);
  rotasDeEventos(app, pool);
  rotasDeResumos(app, pool);
  rotasDeUso(app, pool);
  rotasDeResultados(app, pool);
  rotasDeAnalises(app, pool);
  rotasDeAlertas(app, pool);

  return app;
}
