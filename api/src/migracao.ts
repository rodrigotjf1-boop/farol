// A ponte entre o serviço e o aplicador de migrations (scripts/migrador.mjs).
//
// O aplicador é .mjs puro de propósito — tem de funcionar mesmo com o build
// da API quebrado — e mora fora de `src/`. Por isso entra aqui por
// importação em tempo de execução, e o tipo do que ele devolve é declarado
// à mão.

import type { FastifyBaseLogger } from 'fastify';

import type { MigracaoNaSubida } from './guarda.js';

type Resultado =
  | { ok: true; aplicadas: string[] }
  | { ok: false; motivo: string; mensagem: string; arquivo?: string; codigo?: string; aplicadas: string[] };

/** O mesmo caminho no contêiner (dist/ → scripts/) e na máquina (src/ → scripts/). */
const APLICADOR = new URL('../scripts/migrador.mjs', import.meta.url).href;

/**
 * Aplica as migrations pendentes. Nunca rejeita: uma falha aqui não pode
 * impedir o serviço de subir e dizer o que houve.
 *
 * A mensagem completa do erro vai para o log do contêiner. O que sai daqui
 * para a rota de saúde é só o nome do arquivo e o código do banco.
 */
export async function migrarNaSubida(url: string | undefined, log: FastifyBaseLogger): Promise<MigracaoNaSubida> {
  try {
    const { migrar } = (await import(APLICADOR)) as { migrar: (o: { url?: string }) => Promise<Resultado> };
    const r = await migrar({ url });
    if (r.ok) return { ok: true, aplicadas: r.aplicadas };
    log.error({ motivo: r.motivo, arquivo: r.arquivo, aplicadasAntes: r.aplicadas }, r.mensagem);
    return { ok: false, motivo: r.motivo, arquivo: r.arquivo, codigo: r.codigo };
  } catch (e) {
    log.error(e, 'não consegui carregar o aplicador de migrations');
    return { ok: false, motivo: 'sem_aplicador' };
  }
}
