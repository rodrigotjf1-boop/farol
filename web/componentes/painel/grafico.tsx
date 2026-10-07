'use client';

// O que foi julgado, balde a balde (hora ou dia), em barras empilhadas.
//
// "Fora do critério" fica EMBAIXO, encostado na linha de base: assim as
// partes vermelhas de todas as barras partem da mesma altura e dá para
// comparar uma hora com a outra de relance. No topo de uma barra verde de
// altura variável, a mesma faixa vermelha ficaria ilegível.

import { useState } from 'react';

import { numero, rotuloDoBalde } from '@/componentes/formatos';
import { CARTAO } from '@/componentes/ui/pecas';
import type { Resultados } from '@/lib/api';

type Balde = Resultados['serie']['pontos'][number];

/** O teto do eixo: o primeiro valor "redondo" acima do maior balde. */
export function tetoRedondo(maior: number): number {
  if (maior <= 0) return 10;
  const grandeza = 10 ** Math.floor(Math.log10(maior));
  const passo = grandeza / 5;
  return Math.max(10, Math.ceil(maior / passo) * passo);
}

const total = (b: Balde) => b.conformes + b.naoConformes + b.naoAvaliaveis;

export function Grafico({ serie, periodo }: { serie: Resultados['serie']; periodo: string }) {
  const [sobre, setSobre] = useState<number | null>(null);
  const { pontos, passo } = serie;
  const maior = Math.max(0, ...pontos.map(total));
  const teto = tetoRedondo(maior);
  const poucos = pontos.length <= 12;
  // Com 24 barras, um rótulo a cada três; com 7, todos.
  const mostra = (i: number) => poucos || i % 3 === 0;
  const soma = pontos.reduce((s, b) => s + total(b), 0);
  const fora = pontos.reduce((s, b) => s + b.naoConformes, 0);
  const vao = poucos ? 'gap-[clamp(8px,3%,28px)]' : 'gap-[3px]';
  const atual = sobre !== null ? pontos[sobre] : undefined;

  return (
    <section aria-labelledby="t-grafico" className={`${CARTAO} flex flex-col gap-3.5 p-4`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id="t-grafico" className="text-base font-semibold">
          {passo === 'hora' ? 'Hora a hora' : 'Dia a dia'}
        </h2>
        <div aria-hidden className="ml-auto flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-farol-suave">
          <span className="inline-flex items-center gap-1.5">
            <i className="h-2.5 w-2.5 rounded-[3px] bg-farol-graf-ok" />
            conforme
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="h-2.5 w-2.5 rounded-[3px] bg-farol-critico" />
            fora do critério
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="h-2.5 w-2.5 rounded-[3px] bg-farol-graf-na" />
            não avaliou
          </span>
        </div>
      </div>

      {soma === 0 ? (
        <p className="py-10 text-center text-farol-suave">Nada foi julgado neste período.</p>
      ) : (
        <div className="relative grid grid-cols-[auto_minmax(0,1fr)] gap-2" onPointerLeave={() => setSobre(null)}>
          <div aria-hidden className="flex h-[132px] flex-col justify-between text-right font-mono text-[11px] text-farol-suave md:h-[168px]">
            <span>{numero(teto)}</span>
            <span>{numero(teto / 2)}</span>
            <span>0</span>
          </div>

          <div
            role="img"
            aria-label={
              `${passo === 'hora' ? 'Julgamentos por hora' : 'Julgamentos por dia'}: ${numero(soma)} no período, ` +
              `${numero(fora)} fora do critério. O detalhe por critério está na tabela abaixo.`
            }
            className={`relative flex h-[132px] items-end md:h-[168px] ${vao}`}
            style={{
              // Três linhas de referência: o teto, o meio e a base.
              background:
                'linear-gradient(rgb(var(--borda)), rgb(var(--borda))) 0 0 / 100% 1px no-repeat, ' +
                'linear-gradient(rgb(var(--borda)), rgb(var(--borda))) 0 50% / 100% 1px no-repeat, ' +
                'linear-gradient(rgb(var(--borda-forte)), rgb(var(--borda-forte))) 0 100% / 100% 1px no-repeat',
            }}
          >
            {pontos.map((b, i) => (
              <div
                // A chave leva o período: trocar de 24 h para 7 dias refaz as
                // barras, e elas crescem de novo a partir da base.
                key={`${periodo}-${b.inicio}`}
                onPointerEnter={() => setSobre(i)}
                className={`flex min-w-0 flex-1 origin-bottom animate-cresce flex-col-reverse overflow-hidden rounded-t transition-[filter] ${
                  sobre === i ? 'brightness-110 saturate-[1.15]' : ''
                }`}
                style={{ height: `${(total(b) / teto) * 100}%`, animationDelay: `${i * 14}ms` }}
              >
                <i className="block w-full bg-farol-critico" style={{ flex: `${b.naoConformes} 1 0` }} />
                <i className="block w-full bg-farol-graf-na" style={{ flex: `${b.naoAvaliaveis} 1 0` }} />
                <i className="block w-full bg-farol-graf-ok" style={{ flex: `${b.conformes} 1 0` }} />
              </div>
            ))}
            {atual && sobre !== null && (
              <div
                className="pointer-events-none absolute -top-1 z-[5] -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-[10px] bg-farol-tinta px-2.5 py-2 text-xs leading-relaxed text-farol-fundo shadow-farol-2"
                style={{
                  // No meio da barra, sem deixar a caixa sair pelos lados.
                  left: `clamp(70px, ${((sobre + 0.5) / pontos.length) * 100}%, calc(100% - 70px))`,
                }}
              >
                <b>{rotuloDoBalde(atual.inicio, passo)}</b> · {numero(total(atual))} julgamentos
                <br />
                {numero(atual.conformes)} conforme · {numero(atual.naoConformes)} fora · {numero(atual.naoAvaliaveis)} sem avaliar
              </div>
            )}
          </div>

          <div aria-hidden className={`col-start-2 flex font-mono text-[11px] text-farol-suave ${vao}`}>
            {pontos.map((b, i) => (
              <span key={b.inicio} className={`min-w-0 flex-1 whitespace-nowrap text-center ${!poucos && i % 6 !== 0 ? 'max-md:invisible' : ''}`}>
                {mostra(i) ? rotuloDoBalde(b.inicio, passo) : ''}
              </span>
            ))}
          </div>

        </div>
      )}
    </section>
  );
}
