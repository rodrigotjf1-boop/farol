'use client';

import { Shell } from '@/componentes/shell';

export default function Painel() {
  return (
    <Shell>
      <h1 className="text-xl font-semibold">Painel</h1>
      <p className="mt-2 max-w-prose text-sm text-farol-suave">
        A sessão está de pé e a API reconhece quem você é. As telas de regras,
        alertas, métricas do dia e busca retroativa entram a seguir.
      </p>
      <p className="mt-4 text-sm text-farol-suave">
        Para cadastrar câmeras, vá em <strong className="text-farol-tinta">Lojas</strong>.
      </p>
    </Shell>
  );
}
