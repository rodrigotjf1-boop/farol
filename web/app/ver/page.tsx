// =====================================================================
// /ver#<código> — o link só do ao vivo (29/10/2026), página ABERTA
// =====================================================================
// Sem login e fora da moldura do console: quem tem o link vê só o movimento
// ao vivo de uma loja (`componentes/planta-viva/ao-vivo-por-link.tsx`). O
// código vem depois do "#", que o navegador não manda a servidor: esta parte
// (do servidor) não sabe de que loja é — só diz aos buscadores para não
// guardar a página.
// =====================================================================

import type { Metadata } from 'next';

import { AoVivoPorLink } from '@/componentes/planta-viva/ao-vivo-por-link';

export const metadata: Metadata = {
  title: 'Ao vivo — Farol',
  description: 'O movimento ao vivo de uma loja, pelo link que quem cuida dela mandou.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function Pagina() {
  return <AoVivoPorLink />;
}
