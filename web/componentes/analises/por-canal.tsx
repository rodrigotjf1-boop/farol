'use client';

// Os canais da loja, cada um com a sua barra — no mesmo "jeito de olhar" do
// gráfico de horas (resultado, onde julgou ou custo).
//
// A lista também é filtro: tocar num canal mostra só ele; tocar de novo
// solta. Por isso ela mostra TODOS os canais mesmo com um escolhido — é por
// ela que se troca de canal.

import { numero } from '@/componentes/formatos';
import { CARTAO } from '@/componentes/ui/pecas';
import type { Analises } from '@/lib/api';

import { dinheiro, pedacos, tamanho, type Soma, type Vista } from './conta';

export function PorCanal({
  canais,
  somas,
  vista,
  escolhido,
  aoEscolher,
}: {
  canais: Analises['canais'];
  /** A soma de cada canal no recorte (sem o filtro de canal). */
  somas: Map<string, Soma>;
  vista: Vista;
  escolhido: string;
  aoEscolher: (id: string) => void;
}) {
  const maior = Math.max(1, ...canais.map((c) => tamanho(somas.get(c.id) ?? VAZIA, vista)));

  return (
    <section aria-labelledby="t-an-canais" className={`${CARTAO} flex flex-col gap-3 p-4`}>
      <h2 id="t-an-canais" className="text-base font-semibold">
        Por canal
      </h2>
      {canais.length === 0 ? (
        <p className="text-[13px] text-farol-suave">A loja ainda não tem canal.</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {canais.map((c) => {
            const s = somas.get(c.id) ?? VAZIA;
            const marcado = escolhido === c.id;
            const valor =
              s.analises === 0
                ? 'sem análise'
                : vista === 'custo'
                  ? dinheiro(s.custoCentavos)
                  : vista === 'onde'
                    ? `${numero(s.naLoja)} loja · ${numero(s.naNuvem)} nuvem`
                    : `${numero(s.analises)} · ${numero(s.fora)} fora`;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  data-canal={c.id}
                  aria-pressed={marcado}
                  onClick={() => aoEscolher(marcado ? '' : c.id)}
                  className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1.5 rounded-[10px] border px-2.5 py-2 text-left transition-colors hover:bg-farol-painel-2 ${
                    marcado ? 'border-farol-marca bg-farol-painel-2' : 'border-transparent'
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2 font-semibold">
                    <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-lg bg-farol-realce font-mono text-[11px] font-medium text-farol-suave">
                      {c.canal != null ? String(c.canal).padStart(2, '0') : 'IP'}
                    </span>
                    <span className="truncate">{c.nome}</span>
                  </span>
                  <span className="whitespace-nowrap font-mono text-[12.5px] font-medium text-farol-suave">{valor}</span>
                  <span className="col-span-2 block h-2 overflow-hidden rounded-full bg-farol-realce">
                    <span
                      className="flex h-full overflow-hidden rounded-full"
                      style={{ width: `${(tamanho(s, vista) / maior) * 100}%` }}
                    >
                      {pedacos(s, vista).map((p) => (
                        <i key={p.cor} className={`block h-full ${p.cor}`} style={{ flex: `${p.valor} 1 0` }} />
                      ))}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-[12.5px] text-farol-suave">Toque num canal para ver só ele.</p>
    </section>
  );
}

const VAZIA: Soma = {
  analises: 0, conformes: 0, fora: 0, naoAvaliou: 0, naLoja: 0, naNuvem: 0,
  avisos: 0, custoCentavos: 0, latenciaMs: 0, comLatencia: 0,
};
