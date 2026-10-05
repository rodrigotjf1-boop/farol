'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { api, ErroDaApi, type Eu } from '@/lib/api';

export default function Painel() {
  const router = useRouter();
  const [eu, setEu] = useState<Eu | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api
      .eu()
      .then(setEu)
      .catch((e) => {
        // Sessão expirada ou revogada: o cookie existia, mas a API é quem
        // decide. É aqui que o "RBAC no servidor" aparece na prática.
        if (e instanceof ErroDaApi && e.status === 401) router.replace('/entrar');
        else setErro(e instanceof ErroDaApi ? e.message : 'não deu certo');
      });
  }, [router]);

  async function sair() {
    await api.sair().catch(() => {});
    router.replace('/entrar');
  }

  if (erro) {
    return (
      <main className="p-8">
        <p role="alert" className="text-farol-critico">
          {erro}
        </p>
      </main>
    );
  }

  if (!eu) {
    return (
      <main className="p-8">
        <p className="text-farol-suave">carregando…</p>
      </main>
    );
  }

  return (
    <div className="min-h-dvh">
      <header className="flex flex-wrap items-center gap-4 border-b border-farol-borda px-4 py-3 sm:px-6">
        <div
          aria-hidden
          className="h-6 w-6 shrink-0 rounded-full bg-farol-facho/15 ring-1 ring-farol-facho/40"
        />
        <span className="font-semibold">Farol</span>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="text-farol-suave">
            {eu.nome} · {eu.nivel}
          </span>
          <button
            onClick={sair}
            className="rounded-lg border border-farol-borda px-3 py-1.5 transition hover:border-farol-facho/50"
          >
            Sair
          </button>
        </div>
      </header>

      <main className="px-4 py-8 sm:px-6">
        <h1 className="text-xl font-semibold">Painel</h1>
        <p className="mt-2 max-w-prose text-sm text-farol-suave">
          A sessão está de pé e a API reconhece quem você é. As telas de lojas,
          pontos, regras, alertas e busca entram a seguir.
        </p>
      </main>
    </div>
  );
}
