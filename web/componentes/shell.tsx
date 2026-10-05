'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { api, ErroDaApi, type Eu } from '@/lib/api';

const MENU = [
  { href: '/painel', rotulo: 'Painel' },
  { href: '/lojas', rotulo: 'Lojas' },
];

/**
 * Moldura comum das telas do console.
 *
 * Ela também é quem descobre quem está logado — e esse `useEffect` é o
 * ponto onde a sessão é de fato verificada: o middleware só viu que
 * existe um cookie, a API é que diz se ele vale. Expirou ou foi
 * revogado, cai aqui num 401 e volta para o login.
 */
export function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const caminho = usePathname();
  const [eu, setEu] = useState<Eu | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api
      .eu()
      .then(setEu)
      .catch((e) => {
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

  return (
    <div className="min-h-dvh">
      <header className="border-b border-farol-borda">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <div
            aria-hidden
            className="h-6 w-6 shrink-0 rounded-full bg-farol-facho/15 ring-1 ring-farol-facho/40"
          />
          <span className="font-semibold">Farol</span>

          <nav className="order-last flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto">
            {MENU.map((m) => {
              const atual = caminho === m.href || caminho.startsWith(`${m.href}/`);
              return (
                <Link
                  key={m.href}
                  href={m.href}
                  aria-current={atual ? 'page' : undefined}
                  className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition ${
                    atual
                      ? 'bg-farol-facho/15 text-farol-facho'
                      : 'text-farol-suave hover:text-farol-tinta'
                  }`}
                >
                  {m.rotulo}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3 text-sm">
            {eu && (
              <span className="hidden text-farol-suave sm:inline">
                {eu.nome} · {eu.nivel}
              </span>
            )}
            <button
              onClick={sair}
              className="rounded-lg border border-farol-borda px-3 py-1.5 transition hover:border-farol-facho/50"
            >
              Sair
            </button>
          </div>
        </div>
      </header>

      <main className="px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}

/** Quem pode mexer na configuração. Espelha o `rbac.ts` da API.
 *
 * ⚠️ Isto é só para esconder botão. A decisão é da API — se o front
 * mentisse, a rota responderia 403 do mesmo jeito. */
export function podeConfigurar(eu: Eu | null): boolean {
  if (!eu) return false;
  return eu.nivel === 'suporte' || eu.nivel === 'gerente' || eu.nivel === 'presidente';
}
