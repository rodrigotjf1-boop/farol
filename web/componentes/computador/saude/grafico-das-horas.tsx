// O gráfico da Saúde do computador (A26, M2): uma barra por hora (num dia) ou por dia (7 e 31 dias), no relógio da
// loja. A barra é a média; o traço em cima, o pico (vermelho quando passa do limite); a linha tracejada, o limite. A
// barra escura é a loja aberta. Cada barra é um botão: abre a gaveta com o pico de cada minuto (ou as horas do dia).

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';

import type { Barra } from '@/lib/saude';
import { num } from '@/lib/saude';

// O desenho é feito NA LARGURA em que aparece (como a planta): as letras ficam do mesmo tamanho no computador e no
// celular; quem encolhe é o espaço entre as barras.
const A = 230;
const BASE = A - 24;
const ESQ = 36;
const ESCALA = [0, 25, 50, 75, 100];

export function GraficoDasHoras({ barras, limite, unidade, nome, aoEscolher }: {
  barras: readonly Barra[];
  limite: number;
  unidade: string;
  nome: string;
  aoEscolher: (b: Barra) => void;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(720);
  useLayoutEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const medir = () => setW(Math.max(260, Math.round(el.clientWidth)));
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const y = (v: number) => BASE - (Math.min(100, Math.max(0, v)) / 100) * (BASE - 14);
  const larg = (W - ESQ) / Math.max(1, barras.length);
  // um rótulo a cada ~44 px, no mínimo
  const passoDoRotulo = Math.max(1, Math.ceil(barras.length / Math.max(1, Math.floor((W - ESQ) / 44))));
  const tecla = (e: KeyboardEvent, b: Barra) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      aoEscolher(b);
    }
  };
  return (
    <div className="min-w-0" data-grafico ref={caixa}>
      <svg viewBox={`0 0 ${W} ${A}`} width={W} height={A} className="block max-w-full overflow-visible" role="group" aria-label={`${nome}: média e pico de cada barra`}>
        {ESCALA.map((v) => (
          <g key={v}>
            <line x1={ESQ} x2={W} y1={y(v)} y2={y(v)} className="stroke-farol-borda" strokeWidth={1} />
            <text x={ESQ - 6} y={y(v) + 3} textAnchor="end" className="fill-farol-suave font-mono text-[10px]">
              {v}
              {unidade === '%' ? '%' : '°'}
            </text>
          </g>
        ))}
        <line x1={ESQ} x2={W} y1={y(limite)} y2={y(limite)} className="stroke-farol-critico" strokeWidth={2} strokeDasharray="6 5" />
        <text x={ESQ + 4} y={y(limite) - 6} className="fill-farol-critico font-mono text-[10px] font-semibold">
          limite {limite}
          {unidade}
        </text>
        {barras.map((b, i) => {
          const x = ESQ + i * larg + Math.min(3, larg * 0.12);
          const w = Math.max(2, larg - 2 * Math.min(3, larg * 0.12));
          const passou = b.pico != null && b.pico >= limite;
          const rotulo = `${b.rotulo}: média ${num(b.media)}${unidade}, pico ${num(b.pico)}${unidade}${passou ? ', acima do limite' : ''}${b.aberta === true ? ', loja aberta' : b.aberta === false ? ', loja fechada' : ''}`;
          return (
            <g
              key={b.chave}
              role="button"
              tabIndex={0}
              aria-label={rotulo}
              onClick={() => aoEscolher(b)}
              onKeyDown={(e) => tecla(e, b)}
              className="cursor-pointer outline-none transition-opacity hover:opacity-75 focus-visible:opacity-75 [&:focus-visible>rect:first-child]:stroke-farol-mostarda [&:focus-visible>rect:first-child]:[stroke-width:3]"
              data-barra={b.chave}
            >
              <rect x={x - 1} y={14} width={w + 2} height={BASE - 14} fill="transparent" />
              {b.media != null && (
                <rect x={x} y={y(b.media)} width={w} height={BASE - y(b.media)} rx={Math.min(4, w / 3)} className={b.aberta === false ? 'fill-farol-borda-forte' : 'fill-farol-tinta'} />
              )}
              {b.pico != null && <rect x={x} y={y(b.pico) - 2} width={w} height={4} rx={2} className={passou ? 'fill-farol-critico' : 'fill-farol-mostarda'} />}
              {i % passoDoRotulo === 0 && (
                <text x={x + w / 2} y={A - 6} textAnchor="middle" className="fill-farol-suave font-mono text-[10px]">
                  {b.rotulo}
                </text>
              )}
            </g>
          );
        })}
        <line x1={ESQ} x2={W} y1={BASE} y2={BASE} className="stroke-farol-borda-forte" />
      </svg>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] font-semibold" aria-label="Legenda">
        <li className="flex items-center gap-1.5"><i className="h-3 w-3 rounded bg-farol-tinta" aria-hidden />loja aberta</li>
        <li className="flex items-center gap-1.5"><i className="h-3 w-3 rounded bg-farol-borda-forte" aria-hidden />loja fechada</li>
        <li className="flex items-center gap-1.5"><i className="h-3 w-3 rounded bg-farol-mostarda" aria-hidden />pico</li>
        <li className="flex items-center gap-1.5"><i className="h-3 w-3 rounded bg-farol-critico" aria-hidden />pico acima do limite</li>
      </ul>
    </div>
  );
}
