'use client';

// `/painel` é para onde a entrada manda. Quem tem UMA loja vai direto
// para o painel dela — é o caso comum, e uma tela de escolha com uma
// opção só é um clique jogado fora. Quem tem várias escolhe.

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useConsole } from '@/componentes/console';
import { Ossos } from '@/componentes/ui/pecas';

export default function Painel() {
  const router = useRouter();
  const { lojas } = useConsole();

  useEffect(() => {
    if (!lojas) return;
    router.replace(lojas.length === 1 ? `/lojas/${lojas[0]!.id}` : '/lojas');
  }, [lojas, router]);

  return <Ossos alturas={[64, [96, 96, 96, 96], 220]} />;
}
