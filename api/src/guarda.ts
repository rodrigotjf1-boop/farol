// =====================================================================
// A guarda de esquema: põe o banco em dia ao subir e, se não conseguir,
// recusa os pedidos dizendo o que falta
// =====================================================================
// O deploy sobe CÓDIGO. O esquema do banco vinha depois, à mão, pelo
// `npm run migrar` no console do serviço — e entre uma coisa e outra o
// serviço recusava tudo. Em 07/10/2026 foram três minutos assim, com a
// loja levando 503 em cada batida.
//
// Desde 08/10/2026, por decisão do dono ("as migrations não precisam de
// autorização: aplicar assim que fizer"), a ordem é:
//
//   1. ao subir, ANTES de abrir a porta, aplicar as migrations pendentes
//      (o mesmo aplicador do `npm run migrar`: trava, checksum, uma
//      transação por arquivo);
//   2. conferir se o banco ficou em dia;
//   3. se ficou, atender. Se não, recusar com 503 dizendo o que falta —
//      como sempre foi.
//
// ## Por que recusar, e não só avisar
//
// Aviso em log de contêiner não é lido por ninguém até alguém já estar
// procurando um problema. E um serviço meio funcional é pior que um
// serviço fora: cada requisição que toca a coluna nova morre com 500, e o
// diagnóstico começa pelo pedido, que é o lugar errado.
//
// ## Por que NÃO sair do processo
//
// Sair derrubaria o contêiner, o orquestrador reiniciaria em laço, e o
// console do serviço deixaria de existir — que é de onde se roda o
// `npm run migrar` para ver o erro. A guarda trancaria a porta por
// dentro, com a chave do lado de fora.
//
// ## A guarda se cura
//
// Com a porta fechada, ela reconfere no máximo a cada 10 s. O que vale
// tentar de novo sozinha, ela tenta (o banco não respondeu na subida). O
// que não muda sem alguém mexer (o SQL de uma migration falhou, um arquivo
// aplicado foi editado), ela só reconfere: quando alguém resolver, a porta
// abre sem reiniciar nada.
// =====================================================================

import type { FastifyInstance } from 'fastify';

import type { Conferencia } from './preflight.js';

/** O que a aplicação automática fez na subida. É o que a saúde mostra. */
export type MigracaoNaSubida =
  | { ok: true; aplicadas: string[] }
  | { ok: false; motivo: string; arquivo?: string; codigo?: string };

/** Lido pela rota de saúde: fica fora da guarda, mas conta o que ela fez. */
export interface Subida {
  migracao: MigracaoNaSubida | null;
}

/** O que o vigia de agentes precisa saber: se a porta recusa, e desde quando aceita. */
export interface Porta {
  recusando: boolean;
  aceitaDesde: number;
}

export interface OpcoesDaGuarda {
  conferir: () => Promise<Conferencia>;
  /** Ausente ou nulo: a aplicação automática está desligada (`MIGRAR_NA_SUBIDA=nao`). */
  migrar?: (() => Promise<MigracaoNaSubida>) | null;
  subida?: Subida;
  /** Chamado cada vez que o banco fica em dia: é quando o catálogo é copiado. */
  aoFicarEmDia?: () => void;
  agora?: () => number;
  intervaloMs?: number;
}

const INALCANCAVEL = 'banco inalcançável na partida';
const FORA_DA_GUARDA = new Set(['/saude', '/']);

export async function instalarGuarda(app: FastifyInstance, o: OpcoesDaGuarda): Promise<{ porta: Porta }> {
  const agora = o.agora ?? Date.now;
  const intervalo = o.intervaloMs ?? 10_000;
  const subida = o.subida ?? { migracao: null };
  const porta: Porta = { recusando: false, aceitaDesde: agora() };

  let pendentes: string[] = [];
  let bloqueado = false;
  // O banco não respondeu: o serviço atende, mas ainda não sabe se o
  // esquema está em dia. Antes, isso ficava assim para sempre.
  let incerto = false;
  let proxima = 0;
  let emAndamento: Promise<void> | null = null;

  /** Só vale aplicar de novo, sozinha, o que pode ter mudado sem ninguém mexer. */
  const valeMigrarDeNovo = () => !subida.migracao || subida.migracao.ok || subida.migracao.motivo === 'conexao';

  async function porEmDia(primeira: boolean): Promise<void> {
    if (o.migrar && (primeira || valeMigrarDeNovo())) {
      try {
        subida.migracao = await o.migrar();
      } catch (e) {
        // O aplicador não rejeita; se rejeitar, é defeito dele — e a subida
        // não pode morrer por isso.
        subida.migracao = { ok: false, motivo: 'falhou', codigo: (e as { code?: string }).code };
        app.log.error(e, 'o aplicador de migrations falhou de um jeito que não devia');
      }
      const m = subida.migracao;
      if (m.ok && m.aplicadas.length > 0) app.log.info({ aplicadas: m.aplicadas }, 'migrations aplicadas na subida');
      if (!m.ok) app.log.error({ motivo: m.motivo, arquivo: m.arquivo, codigo: m.codigo }, 'a migration não pôde ser aplicada na subida');
    }

    const esquema = await o.conferir();
    const antes = { bloqueado, incerto };
    pendentes = esquema.ok ? [] : esquema.pendentes;
    bloqueado = !esquema.ok;
    incerto = esquema.ok && esquema.motivo === INALCANCAVEL;
    porta.recusando = bloqueado;

    if (bloqueado) {
      // dito uma vez, não a cada conferência
      if (!antes.bloqueado) app.log.fatal({ pendentes }, 'esquema desatualizado: recusando os pedidos');
      return;
    }
    if (antes.bloqueado) porta.aceitaDesde = agora();
    if (incerto) {
      if (primeira || !antes.incerto) {
        app.log.warn({ motivo: INALCANCAVEL }, 'não deu para conferir o esquema: atendendo, e conferindo de novo em seguida');
      }
      return;
    }
    // Daqui para baixo o banco está em dia, e esta é a primeira vez que se
    // sabe disso (na subida, ou depois de a porta ter ficado fechada ou em
    // dúvida): é a hora de copiar o catálogo.
    if (esquema.ok && esquema.motivo) app.log.warn({ motivo: esquema.motivo }, 'conferência de esquema pulada');
    else app.log.info(antes.bloqueado ? 'esquema em dia; voltando a atender' : 'esquema em dia');
    o.aoFicarEmDia?.();
  }

  await porEmDia(true);

  app.addHook('onRequest', async (req, resposta) => {
    if (FORA_DA_GUARDA.has(req.url)) return;
    if (!bloqueado && !incerto) return;

    if (agora() >= proxima) {
      proxima = agora() + intervalo;
      // um pedido confere; os que chegarem enquanto isso esperam o mesmo resultado
      emAndamento ??= porEmDia(false).finally(() => {
        emAndamento = null;
      });
    }
    if (emAndamento) await emAndamento;
    if (!bloqueado) return;

    const m = subida.migracao;
    await resposta.status(503).send({
      erro: 'esquema_desatualizado',
      mensagem:
        'o banco está atrás do código' +
        (m && !m.ok
          ? m.arquivo
            ? `: a migration ${m.arquivo} não pôde ser aplicada na subida.`
            : ': as migrations não puderam ser aplicadas na subida.'
          : '.') +
        ' Rode `npm run migrar` no console deste serviço para ver o motivo. O serviço volta a atender sozinho em seguida.',
      pendentes,
    });
  });

  return { porta };
}
