'use client';

// Todas as telas do console moram dentro da mesma moldura. Por ser o
// `layout` do grupo, ela NÃO é desmontada ao trocar de tela: quem está
// logado e as lojas são buscados uma vez, e o realce da navegação desliza
// de um item ao outro em vez de piscar.

import { Shell } from '@/componentes/shell';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <Shell>{children}</Shell>;
}
