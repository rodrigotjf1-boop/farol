'use client';

/**
 * O estado dos agentes da loja.
 *
 * Sem isto, a única forma de saber se a loja está sendo auditada é
 * tentar usar e esperar falhar — e numa loja de verdade ninguém tenta:
 * supõe que está funcionando até precisar de uma gravação que não
 * existe.
 *
 * O limiar é generoso de propósito. O agente bate a cada poucos
 * segundos, mas internet de loja oscila, Windows atualiza, o PC é
 * desligado para limpar o balcão. Avisar a cada soluço de rede treina
 * todo mundo a ignorar o aviso — e aí ele não serve quando importa.
 */

import type { AgenteResumo } from '@/lib/api';

/** Minutos sem bater a partir dos quais o agente é considerado caído. */
const LIMITE_MIN = 5;

function quando(segundos: number | null): string {
  if (segundos == null) return 'nunca';
  if (segundos < 60) return `há ${segundos}s`;
  const min = Math.floor(segundos / 60);
  if (min < 60) return `há ${min} min`;
  const horas = Math.floor(min / 60);
  if (horas < 24) return `há ${horas}h`;
  return `há ${Math.floor(horas / 24)} dia(s)`;
}

type Saude = { rotulo: string; cor: string; aviso: string | null };

function saude(a: AgenteResumo): Saude {
  if (a.estado === 'novo') {
    return {
      rotulo: 'aguardando instalação',
      cor: 'text-farol-suave',
      aviso: 'o token foi emitido e nenhuma máquina o usou ainda',
    };
  }
  if (a.estado !== 'ativo') {
    return { rotulo: a.estado, cor: 'text-farol-suave', aviso: null };
  }
  if (a.segundos_sem_bater == null) {
    return { rotulo: 'nunca bateu', cor: 'text-farol-critico', aviso: null };
  }
  if (a.segundos_sem_bater > LIMITE_MIN * 60) {
    return {
      rotulo: `sem sinal ${quando(a.segundos_sem_bater)}`,
      cor: 'text-farol-critico',
      // Diz a consequência, não só o estado: "offline" não comunica que
      // a loja parou de ser auditada.
      aviso: 'esta loja não está sendo auditada enquanto o agente estiver fora',
    };
  }
  return { rotulo: `ativo, ${quando(a.segundos_sem_bater)}`, cor: 'text-farol-ok', aviso: null };
}

export function Agentes({ agentes }: { agentes: AgenteResumo[] }) {
  if (agentes.length === 0) {
    return (
      <section className="rounded-xl border border-dashed border-farol-borda px-4 py-5">
        <h2 className="font-medium">Nenhum agente nesta loja</h2>
        <p className="mt-1 text-sm text-farol-suave">
          O agente é o programa instalado na loja. Sem ele não há captura, nem
          análise, nem preview — a loja aparece cadastrada e não é auditada.
        </p>
      </section>
    );
  }

  const caidos = agentes.filter((a) => saude(a).cor === 'text-farol-critico');

  return (
    <section className="rounded-xl border border-farol-borda bg-farol-painel">
      <header className="flex flex-wrap items-center gap-3 border-b border-farol-borda px-4 py-3">
        <h2 className="font-medium">Agente</h2>
        {caidos.length > 0 && (
          <span role="alert" className="text-sm text-farol-critico">
            {caidos.length === agentes.length
              ? 'a loja não está sendo auditada'
              : `${caidos.length} sem sinal`}
          </span>
        )}
      </header>

      <ul className="divide-y divide-farol-borda">
        {agentes.map((a) => {
          const s = saude(a);
          return (
            <li key={a.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
              <span>{a.nome}</span>
              <span className={`text-sm ${s.cor}`}>{s.rotulo}</span>
              {a.versao && (
                <span className="text-sm text-farol-suave font-mono">v{a.versao}</span>
              )}
              {s.aviso && (
                <span className="w-full text-sm text-farol-suave">{s.aviso}</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
