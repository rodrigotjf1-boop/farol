'use client';

// =====================================================================
// O quadro do canal ao lado da foto padrão
// =====================================================================
// Duas vistas, e em nenhuma se desenha — as áreas se marcam no quadro de
// agora:
//
//   padrao     só a foto padrão: é com esta imagem que a loja compara
//   comparar   o quadro de agora à esquerda e a foto padrão à direita,
//              com um divisor que se arrasta (ou se move pelas setas)
//
// As duas imagens são o mesmo canal, na mesma moldura: a foto padrão é
// esticada sobre o quadro de agora, para o divisor cortar as duas no mesmo
// lugar da cena.
// =====================================================================

import { useRef, useState } from 'react';

/** Até onde o divisor vai, em % do quadro: nenhum dos lados some. */
const MINIMO = 4;
const MAXIMO = 96;
const PASSO = 4;

type Props = {
  modo: 'padrao' | 'comparar';
  /** O quadro de agora (só usado em `comparar`). */
  agora: string;
  /** A imagem da foto padrão. */
  padrao: string;
  nomeDaFoto: string;
  nomeDoCanal: string;
};

const ROTULO_DE_LADO =
  'pointer-events-none absolute top-2.5 rounded-md bg-black/65 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white';

export function QuadroComPadrao({ modo, agora, padrao, nomeDaFoto, nomeDoCanal }: Props) {
  const quadro = useRef<HTMLDivElement>(null);
  const puxando = useRef(false);
  const [corte, setCorte] = useState(50);

  const prender = (v: number) => Math.min(MAXIMO, Math.max(MINIMO, v));

  function mover(clientX: number) {
    const c = quadro.current?.getBoundingClientRect();
    if (!c || c.width === 0) return;
    setCorte(prender(((clientX - c.left) / c.width) * 100));
  }

  if (modo === 'padrao') {
    return (
      <div data-quadro-com-padrao="padrao" className="relative max-w-full overflow-hidden rounded-xl border border-farol-borda">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={padrao} alt={`Foto padrão “${nomeDaFoto}” do canal ${nomeDoCanal}`} className="block w-full" draggable={false} />
      </div>
    );
  }

  return (
    <div
      ref={quadro}
      data-quadro-com-padrao="comparar"
      className="relative max-w-full select-none overflow-hidden rounded-xl border border-farol-borda"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={agora} alt={`Quadro de agora do canal ${nomeDoCanal}`} className="block w-full" draggable={false} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={padrao}
        alt={`Foto padrão “${nomeDaFoto}”`}
        data-lado-da-foto
        className="absolute inset-0 h-full w-full"
        style={{ clipPath: `inset(0 0 0 ${corte}%)` }}
        draggable={false}
      />
      <span className={`${ROTULO_DE_LADO} left-2.5`}>agora</span>
      <span className={`${ROTULO_DE_LADO} right-2.5`}>foto padrão</span>

      <button
        type="button"
        role="slider"
        data-divisor
        aria-orientation="horizontal"
        aria-valuemin={MINIMO}
        aria-valuemax={MAXIMO}
        aria-valuenow={Math.round(corte)}
        aria-valuetext={`${Math.round(corte)}% do quadro mostra agora`}
        aria-label="Divisor entre o quadro de agora e a foto padrão. Use as setas para mover."
        onPointerDown={(ev) => {
          puxando.current = true;
          ev.currentTarget.setPointerCapture?.(ev.pointerId);
        }}
        onPointerMove={(ev) => {
          if (puxando.current) mover(ev.clientX);
        }}
        onPointerUp={() => (puxando.current = false)}
        onPointerCancel={() => (puxando.current = false)}
        onKeyDown={(ev) => {
          const para: Record<string, number> = {
            ArrowLeft: corte - PASSO,
            ArrowRight: corte + PASSO,
            Home: MINIMO,
            End: MAXIMO,
          };
          const novo = para[ev.key];
          if (novo === undefined) return;
          ev.preventDefault();
          setCorte(prender(novo));
        }}
        className="group absolute inset-y-0 w-11 -translate-x-1/2 cursor-ew-resize touch-none focus-visible:outline-none"
        style={{ left: `${corte}%` }}
      >
        <span aria-hidden className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-[#F2B03C]" />
        <span
          aria-hidden
          className="absolute left-1/2 top-1/2 h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#F2B03C] shadow-[0_0_0_1px_rgb(4_8_14/0.6)] transition-shadow group-focus-visible:shadow-[0_0_0_3px_#fff]"
        />
      </button>
    </div>
  );
}
