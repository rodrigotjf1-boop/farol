// O campo de formulário: rótulo em cima, sempre visível; ajuda embaixo.
// Texto de exemplo dentro do campo não é rótulo — some quando a pessoa
// começa a digitar, que é justamente quando ela precisa dele.

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export const ROTULO = 'text-[12.5px] font-semibold text-farol-tinta';
export const AJUDA = 'text-xs leading-snug text-farol-suave';

export function Campo({
  rotulo,
  htmlFor,
  ajuda,
  largo = false,
  children,
}: {
  rotulo: string;
  /** O `id` do campo. Sem ele, o rótulo é só um texto (grupo de opções). */
  htmlFor?: string;
  ajuda?: ReactNode;
  /** Ocupa a linha inteira numa grade de duas colunas. */
  largo?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-[5px] ${largo ? 'sm:col-span-2' : ''}`}>
      {htmlFor ? (
        <label htmlFor={htmlFor} className={ROTULO}>
          {rotulo}
        </label>
      ) : (
        <span className={ROTULO}>{rotulo}</span>
      )}
      {children}
      {ajuda && <p className={AJUDA}>{ajuda}</p>}
    </div>
  );
}

/** Duas colunas no computador, uma no celular. */
export const GRADE = 'grid grid-cols-1 gap-3.5 sm:grid-cols-2';

/**
 * Poucas opções, cada uma com explicação: cartões no lugar de uma lista
 * suspensa. Quem escolhe vê todas de uma vez, com o que cada uma quer
 * dizer.
 */
export function Escolhas<T extends string>({
  nome,
  rotulo,
  opcoes,
  valor,
  aoMudar,
  rotuloOculto = false,
}: {
  nome: string;
  rotulo: string;
  opcoes: ReadonlyArray<{ valor: T; titulo: string; ajuda?: string; icone?: LucideIcon }>;
  valor: T;
  aoMudar: (novo: T) => void;
  /** O rótulo já está escrito na legenda do grupo: fica só para o leitor de tela. */
  rotuloOculto?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-[5px]">
      <span id={`${nome}-rotulo`} className={rotuloOculto ? 'sr-only' : ROTULO}>
        {rotulo}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={`${nome}-rotulo`}
        className="grid grid-cols-[repeat(auto-fit,minmax(132px,1fr))] gap-2"
      >
        {opcoes.map((o) => {
          const marcada = o.valor === valor;
          const Icone = o.icone;
          return (
            <div key={o.valor} className="relative">
              <input
                type="radio"
                name={nome}
                id={`${nome}-${o.valor}`}
                value={o.valor}
                checked={marcada}
                onChange={() => aoMudar(o.valor)}
                className="peer absolute inset-0 cursor-pointer opacity-0"
              />
              <label
                htmlFor={`${nome}-${o.valor}`}
                className={`flex h-full cursor-pointer flex-col gap-1 rounded-[10px] border p-2.5 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-farol-facho ${
                  marcada
                    ? 'border-farol-marca bg-farol-painel-2 shadow-[inset_0_0_0_1px_rgb(var(--marca))]'
                    : 'border-farol-borda-forte bg-farol-painel hover:border-farol-suave'
                }`}
              >
                <b className="flex items-center gap-[7px] font-semibold">
                  {Icone && (
                    <Icone className={`h-[18px] w-[18px] shrink-0 ${marcada ? 'text-farol-facho-icone' : ''}`} aria-hidden />
                  )}
                  {o.titulo}
                </b>
                {o.ajuda && <small className="text-[11.5px] leading-snug text-farol-suave">{o.ajuda}</small>}
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Legenda de um grupo de campos dentro do formulário. */
export function Grupo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-3 rounded-xl border border-farol-borda px-3.5 pb-3.5 pt-3">
      <legend className="px-1.5 text-[12.5px] font-semibold">{titulo}</legend>
      {children}
    </fieldset>
  );
}
