'use client';

// Abas que são ENDEREÇOS: páginas irmãs (Lista e Inventário, em Canais). A
// aba é um link, e a atual leva `aria-current` — voltar e avançar do
// navegador funcionam, e dá para mandar o endereço de uma aba a alguém.

import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export type Aba = { href: string; rotulo: string; icone: LucideIcon };

export function Abas({ rotulo, abas }: { rotulo: string; abas: ReadonlyArray<Aba> }) {
  const caminho = usePathname();
  return (
    <nav aria-label={rotulo} className="-mb-1 flex gap-1 overflow-x-auto border-b border-farol-borda">
      {abas.map(({ href, rotulo: nome, icone: Icone }) => {
        const atual = caminho === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={atual ? 'page' : undefined}
            className={`group relative inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap px-3 font-semibold no-underline transition-colors ${
              atual ? 'text-farol-tinta' : 'text-farol-suave hover:text-farol-tinta'
            }`}
          >
            <Icone className={`h-[18px] w-[18px] ${atual ? 'text-farol-facho-icone' : ''}`} aria-hidden />
            {nome}
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
