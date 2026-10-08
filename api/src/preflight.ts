// =====================================================================
// Conferência de partida: o esquema está em dia?
// =====================================================================
// O auto-deploy sobe **código**, não **esquema**. As migrations são
// aplicadas à mão, pelo console do serviço, e é fácil esquecer.
//
// Quando isso acontece, o serviço sobe saudável — responde, consome CPU,
// o painel mostra verde — e **cada requisição que toca a coluna nova
// morre com 500**. Aconteceu em 06/10/2026: o agente ficou em laço de
// `heartbeat falhou (500)` e o diagnóstico começou pela requisição, que
// é o lugar errado.
//
// Um 500 por requisição manda procurar no pedido. Uma recusa na partida
// aponta para a causa e diz o comando que resolve.
//
// ## Por que recusar, e não só avisar
//
// Aviso em log de contêiner não é lido por ninguém até alguém já estar
// procurando um problema. E um serviço meio funcional é pior que um
// serviço fora: o painel fica verde, o alerta não dispara, e a loja
// descobre que a auditoria parou quando precisa dela.
//
// ## O que NÃO é motivo para recusar
//
// Banco vazio, sem a tabela de controle, é o estado legítimo de uma
// instalação nova — ali o certo é deixar subir para alguém poder rodar
// a migration. Banco inalcançável também não: a rede pode voltar, e
// morrer na partida criaria um laço de reinício que esconde a causa.
// =====================================================================

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type pg from 'pg';

/** Sobe a árvore procurando `database/migrations`, como o migrador faz. */
export function acharMigrations(partida?: string): string | null {
  let dir = partida ?? dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const alvo = join(dir, 'database', 'migrations');
    try {
      if (readdirSync(alvo).length >= 0) return alvo;
    } catch {
      // não é aqui; sobe mais um nível
    }
    const acima = dirname(dir);
    if (acima === dir) break;
    dir = acima;
  }
  return null;
}

/** `noCodigo` é a última migration que ESTE código conhece: diz, de fora,
 *  qual código está no ar — pergunta diferente de "o que o banco tem". */
export type Conferencia =
  | { ok: true; aplicadas: number; motivo?: string; noCodigo: string | null }
  | { ok: false; pendentes: string[]; mensagem: string; noCodigo: string | null };

export async function conferirEsquema(
  pool: pg.Pool,
  // O teste aponta para uma pasta sua; em produção é a que veio na imagem.
  pasta: string | null = acharMigrations(),
): Promise<Conferencia> {
  if (!pasta) {
    // Sem a pasta não há com o que comparar. Não é motivo para derrubar:
    // acontece em empacotamento que não copia `database/`, e aí o
    // serviço funcionar é mais importante que a conferência.
    return { ok: true, aplicadas: 0, motivo: 'não achei database/migrations', noCodigo: null };
  }

  const arquivos = readdirSync(pasta)
    .filter((n) => n.endsWith('.sql'))
    .sort();
  const noCodigo = arquivos[arquivos.length - 1] ?? null;

  let aplicadas: Set<string>;
  try {
    const { rows } = await pool.query('select nome from farol_migracao');
    aplicadas = new Set(rows.map((r) => String(r.nome)));
  } catch (erro) {
    const e = erro as { code?: string };
    // 42P01 = tabela não existe: banco novo, ninguém migrou ainda.
    if (e.code === '42P01') {
      return { ok: true, aplicadas: 0, motivo: 'banco novo, sem tabela de controle', noCodigo };
    }
    // Qualquer outra coisa é o banco indisponível. A rede pode voltar;
    // morrer aqui criaria laço de reinício que esconde a causa.
    return { ok: true, aplicadas: 0, motivo: 'banco inalcançável na partida', noCodigo };
  }

  const pendentes = arquivos.filter((n) => !aplicadas.has(n));
  if (pendentes.length === 0) {
    return { ok: true, aplicadas: aplicadas.size, noCodigo };
  }

  return {
    ok: false,
    pendentes,
    noCodigo,
    mensagem:
      `o banco está ${pendentes.length} migration(s) atrás do código:\n` +
      pendentes.map((n) => `    ${n}`).join('\n') +
      '\n\n  O serviço NÃO vai subir assim: ele responderia 500 em toda\n' +
      '  requisição que tocasse as colunas novas, e o diagnóstico\n' +
      '  começaria pelo lugar errado.\n\n' +
      '  Resolva rodando, no console deste serviço:\n\n' +
      '      npm run migrar\n',
  };
}
