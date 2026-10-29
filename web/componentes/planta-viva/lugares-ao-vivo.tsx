'use client';

// =====================================================================
// O que a cena ao vivo mostra dos lugares — o MESMO no console e no link
// =====================================================================
// A planta com vida (29/10/2026): as chaves "Cores dos setores" e "Nomes"
// sobre a cena, a legenda dos lugares que a planta tem e o quadro "Por
// setor" (quantas pessoas em cada lugar agora; quem está fora de todo
// ambiente conta à parte). Usado por Canais › Planta › Ao vivo e pela página
// do link só do ao vivo (`/ver`).
// =====================================================================

import { useMemo } from 'react';

import type { FiguraAoVivo } from '@/componentes/planta-viva/ao-vivo-planta';
import { corDoLugar } from '@/componentes/planta-viva/cara-da-planta';
import { ambienteEm, NOME_DO_TIPO_DE_AMBIENTE, TIPOS_DE_AMBIENTE, tipoDoAmbiente, type Planta, type TipoDeAmbiente } from '@/lib/planta';

/** A chave sobre a cena (sempre escura): ligada, com a cor do rótulo. */
const CHAVE =
  'rounded-full border-[1.5px] px-[11px] py-1.5 font-mono text-[12px] font-semibold transition-colors focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-farol-mostarda';
export const classeDaChave = (ligada: boolean): string =>
  `${CHAVE} ${ligada ? 'border-farol-rotulo bg-farol-rotulo text-farol-sobre-rotulo' : 'border-farol-cena-suave/45 bg-farol-cena text-farol-cena-tinta'}`;

export type PorLugar = Map<TipoDeAmbiente | 'fora', number>;

/** Os lugares que a planta tem (na ordem da legenda) e quantas pessoas há em cada um agora. */
export function useLugares(planta: Planta | null, figuras: readonly FiguraAoVivo[]) {
  const lugares = useMemo(
    () => TIPOS_DE_AMBIENTE.filter((t) => (planta?.ambientes ?? []).some((a) => tipoDoAmbiente(a) === t)),
    [planta],
  );
  const porLugar = useMemo(() => {
    const c: PorLugar = new Map();
    if (!planta) return c;
    for (const f of figuras) {
      const a = ambienteEm(planta, f.x, f.y);
      const t = a ? tipoDoAmbiente(a) : 'fora';
      c.set(t, (c.get(t) ?? 0) + 1);
    }
    return c;
  }, [figuras, planta]);
  return { lugares, porLugar };
}

/** A legenda dos lugares, dentro da linha das chaves (`contents`: cada item é da linha que quebra). */
export function LegendaDosLugares({ lugares }: { lugares: readonly TipoDeAmbiente[] }) {
  return (
    <ul className="contents" aria-label="Os setores da planta" data-legenda>
      {lugares.map((t) => (
        <li key={t} className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11.5px] font-semibold text-farol-cena-tinta">
          <i className="inline-block h-[11px] w-[11px] rounded-[3px]" style={{ background: corDoLugar(t) }} aria-hidden />
          {NOME_DO_TIPO_DE_AMBIENTE[t]}
        </li>
      ))}
    </ul>
  );
}

/** Quantas pessoas em cada lugar agora. `semNumero`: sem sinal, o número não vale ("–"). */
export function ListaPorSetor({ lugares, porLugar, semNumero = false }: { lugares: readonly TipoDeAmbiente[]; porLugar: PorLugar; semNumero?: boolean }) {
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Pessoas em cada setor agora" data-por-setor>
      {lugares.map((t) => (
        <li key={t} className="grid grid-cols-[12px_minmax(0,1fr)_auto] items-center gap-2 text-[14px]" data-lugar={t}>
          <i className="h-3 w-3 rounded-[3px]" style={{ background: corDoLugar(t) }} aria-hidden />
          <span className="min-w-0 break-words">{NOME_DO_TIPO_DE_AMBIENTE[t]}</span>
          <b className="font-mono text-[13px] tabular-nums">{semNumero ? '–' : (porLugar.get(t) ?? 0)}</b>
        </li>
      ))}
      {!semNumero && porLugar.get('fora') ? (
        <li className="grid grid-cols-[12px_minmax(0,1fr)_auto] items-center gap-2 text-[14px] text-farol-suave" data-lugar="fora">
          <i className="h-3 w-3 rounded-[3px] border border-farol-borda-forte" aria-hidden />
          <span className="min-w-0 break-words">Fora dos ambientes</span>
          <b className="font-mono text-[13px] tabular-nums">{porLugar.get('fora')}</b>
        </li>
      ) : null}
    </ul>
  );
}
