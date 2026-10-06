'use client';

// =====================================================================
// A pergunta antes de tirar
// =====================================================================
// Usa o `<dialog>` do navegador de propósito: aberto com `showModal()`,
// ele prende o foco dentro da caixa, fecha no Esc e deixa o resto da
// página inerte — três coisas que uma caixa montada à mão costuma errar.
//
// O foco começa no CANCELAR. Quem apertar Enter por reflexo não tira o
// critério do canal sem ter lido.
// =====================================================================

import { useEffect, useRef } from 'react';

type Props = {
  titulo: string;
  children: React.ReactNode;
  rotuloConfirmar: string;
  ocupado?: boolean;
  erro?: string | null;
  aoConfirmar: () => void;
  aoCancelar: () => void;
};

export function Confirmar({
  titulo,
  children,
  rotuloConfirmar,
  ocupado = false,
  erro,
  aoConfirmar,
  aoCancelar,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => {
      if (d?.open) d.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby="confirmar-titulo"
      aria-describedby="confirmar-texto"
      onCancel={(e) => {
        // O Esc fecharia o <dialog> por conta própria e a tela continuaria
        // achando que a pergunta está aberta.
        e.preventDefault();
        if (!ocupado) aoCancelar();
      }}
      onClick={(e) => {
        // Clique no fundo escuro (o próprio <dialog>), fora da caixa.
        if (e.target === ref.current && !ocupado) aoCancelar();
      }}
      className="w-[calc(100%-2rem)] max-w-md rounded-xl border border-farol-borda bg-farol-painel p-0 text-farol-tinta backdrop:bg-black/60"
    >
      <div className="p-5">
        <h2 id="confirmar-titulo" className="text-base font-semibold">
          {titulo}
        </h2>
        <div id="confirmar-texto" className="mt-3 space-y-2 text-sm text-farol-suave">
          {children}
        </div>

        {erro && (
          <p role="alert" className="mt-3 text-sm text-farol-critico">
            {erro}
          </p>
        )}

        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            autoFocus
            onClick={aoCancelar}
            disabled={ocupado}
            className="rounded-lg border border-farol-borda px-4 py-2 text-sm transition hover:border-farol-facho/50 disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={aoConfirmar}
            disabled={ocupado}
            className="rounded-lg bg-farol-critico px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
          >
            {ocupado ? 'Tirando…' : rotuloConfirmar}
          </button>
        </div>
      </div>
    </dialog>
  );
}
