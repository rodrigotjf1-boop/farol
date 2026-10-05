'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api, ErroDaApi } from '@/lib/api';

export default function Entrar() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await api.entrar(email, senha);
      router.replace('/painel');
    } catch (e) {
      // A API devolve a mesma mensagem para e-mail inexistente e senha
      // errada, de propósito. Repetimos o que ela diz, sem inventar
      // detalhe que entregaria quais e-mails existem.
      setErro(e instanceof ErroDaApi ? e.message : 'não deu certo');
      setEnviando(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div
            aria-hidden
            className="mx-auto mb-4 h-10 w-10 rounded-full bg-farol-facho/15 ring-1 ring-farol-facho/40"
          />
          <h1 className="text-2xl font-semibold tracking-tight">Farol</h1>
          <p className="mt-1 text-sm text-farol-suave">monitor de operação</p>
        </div>

        <form
          onSubmit={enviar}
          className="rounded-xl border border-farol-borda bg-farol-painel p-6 shadow-lg"
        >
          <label className="block text-sm font-medium" htmlFor="email">
            E-mail
          </label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-farol-borda bg-farol-fundo px-3 py-2 text-sm placeholder:text-farol-suave/60"
            placeholder="voce@empresa.com.br"
          />

          <label className="mt-4 block text-sm font-medium" htmlFor="senha">
            Senha
          </label>
          <input
            id="senha"
            type="password"
            autoComplete="current-password"
            required
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-farol-borda bg-farol-fundo px-3 py-2 text-sm"
          />

          {erro && (
            // `role=alert` para o leitor de tela anunciar sem precisar de
            // foco — a pessoa que errou a senha não está olhando para cá.
            <p
              role="alert"
              className="mt-4 rounded-lg border border-farol-critico/40 bg-farol-critico/10 px-3 py-2 text-sm text-farol-critico"
            >
              {erro}
            </p>
          )}

          <button
            type="submit"
            disabled={enviando}
            className="mt-6 w-full rounded-lg bg-farol-facho px-4 py-2.5 text-sm font-semibold text-farol-fundo transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {enviando ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-farol-suave">
          Esqueceu a senha? Fale com quem administra a conta — por segurança,
          ninguém consegue recuperá-la, só definir uma nova.
        </p>
      </div>
    </main>
  );
}
