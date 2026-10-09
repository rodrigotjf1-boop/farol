'use client';

// Abas que são ENDEREÇOS: páginas irmãs (Lista e Inventário, em Canais). A
// aba é um link, e a atual leva `aria-current` — voltar e avançar do
// navegador funcionam, e dá para mandar o endereço de uma aba a alguém.

import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** `conta`: um número ao lado do nome ("3 para rever"); `oQueConta` o diz a quem não vê a tela. */
export type Aba = { href: string; rotulo: string; icone: LucideIcon; conta?: number; oQueConta?: string };

export function Abas({ rotulo, abas }: { rotulo: string; abas: ReadonlyArray<Aba> }) {
  const caminho = usePathname();
  return (
    // Sem rolagem para o lado: em tela muito estreita as abas apertam e, se
    // ainda assim não couberem, quebram a linha (em 320 px sobravam 4 px).
    <nav aria-label={rotulo} className="-mb-1 flex flex-wrap gap-x-1 border-b border-farol-borda">
      {abas.map(({ href, rotulo: nome, icone: Icone, conta, oQueConta }) => {
        const atual = caminho === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={atual ? 'page' : undefined}
            className={`group relative inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap px-3 font-semibold no-underline transition-colors max-[359px]:gap-1.5 max-[359px]:px-2 ${
              atual ? 'text-farol-tinta' : 'text-farol-suave hover:text-farol-tinta'
            }`}
          >
            <Icone className={`h-[18px] w-[18px] ${atual ? 'text-farol-facho-icone' : ''}`} aria-hidden />
            {nome}
            {conta !== undefined && conta > 0 && (
              <span className="min-w-5 rounded-full bg-farol-facho-leve px-1.5 text-center text-xs font-semibold leading-5 text-farol-facho-tinta">
                {oQueConta && <span className="sr-only">{oQueConta}: </span>}
                {conta}
              </span>
            )}
            <span
              aria-hidden
              className={`absolute inset-x-3 -bottom-px h-0.5 rounded-sm bg-farol-facho transition-transform duration-200 ease-farol ${
                atual ? 'scale-x-100' : 'scale-x-0'
              }`}
            />
          </Link>
        );
      })}
    </nav>
  );
}
