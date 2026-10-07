'use client';

import { CircleAlert, Eye, EyeOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Palavra, Selo } from '@/componentes/marca';
import { Botao } from '@/componentes/ui/botao';
import { Campo } from '@/componentes/ui/campo';
import { Alerta } from '@/componentes/ui/pecas';
import { api, ErroDaApi } from '@/lib/api';

export default function Entrar() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [mostrar, setMostrar] = useState(false);
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
    <main className="grid h-dvh grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] md:grid-rows-1">
      {/* O lado da marca. O facho que varre é o único momento de espetáculo
          do console — e ele some para quem pediu menos movimento. */}
      <section
        aria-hidden
        className="relative flex flex-col justify-between gap-3.5 overflow-hidden bg-farol-palco px-5 py-[22px] text-farol-palco-tinta md:gap-8 md:p-[clamp(24px,5vw,56px)]"
      >
        <Palavra className="relative h-8 w-auto self-start md:h-11" vivo />

        <div className="relative hidden place-items-center self-center md:grid">
          <span
            className="pointer-events-none absolute left-1/2 top-1/2 h-[220vmax] w-[220vmax] -translate-x-1/2 -translate-y-1/2 motion-reduce:hidden"
          >
            <span
              className="block h-full w-full animate-gira-lento"
              style={{
                background:
                  'conic-gradient(from 0deg, rgb(242 176 60 / 0) 0deg, rgb(242 176 60 / .22) 14deg, rgb(242 176 60 / 0) 34deg, rgb(242 176 60 / 0) 360deg)',
              }}
            />
          </span>
          <Selo className="relative h-auto w-[min(46vmin,300px)]" vivo varre />
        </div>

        <div className="relative">
          <h2 className="font-display text-[22px] font-semibold leading-[1.12] tracking-tight md:max-w-[16ch] md:text-[clamp(24px,3.4vw,38px)]">
            Monitoramento inteligente da sua operação
          </h2>
          <p className="mt-2.5 max-w-[44ch] text-farol-palco-suave">
            As câmeras que a loja já tem conferem, o dia inteiro, se o combinado está sendo feito.
          </p>
        </div>
      </section>

      <section className="grid place-items-start justify-items-center overflow-y-auto px-4 pb-8 pt-7 md:place-items-center md:px-[clamp(16px,5vw,56px)] md:py-8">
        <form onSubmit={enviar} className="flex w-[min(380px,100%)] flex-col gap-4">
          <div>
            <h1 className="font-display text-[30px] font-semibold leading-tight tracking-tight">Entrar</h1>
            <p className="mt-1 text-farol-suave">Use o e-mail e a senha da sua conta.</p>
          </div>

          <Campo rotulo="E-mail" htmlFor="email">
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="entrada"
              placeholder="voce@empresa.com.br"
            />
          </Campo>

          <Campo rotulo="Senha" htmlFor="senha">
            <div className="relative">
              <input
                id="senha"
                type={mostrar ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                className="entrada pr-11"
              />
              <button
                type="button"
                onClick={() => setMostrar((m) => !m)}
                aria-pressed={mostrar}
                aria-label={mostrar ? 'Esconder a senha' : 'Mostrar a senha'}
                className="absolute right-1 top-1 grid h-8 w-8 place-items-center rounded-lg text-farol-suave hover:bg-farol-realce hover:text-farol-tinta"
              >
                {mostrar ? <EyeOff className="h-[18px] w-[18px]" aria-hidden /> : <Eye className="h-[18px] w-[18px]" aria-hidden />}
              </button>
            </div>
          </Campo>

          {erro && (
            // `role=alert` para o leitor de tela anunciar sem precisar de
            // foco — a pessoa que errou a senha não está olhando para cá.
            <Alerta tom="critico" icone={CircleAlert} papel="alert">
              {erro}
            </Alerta>
          )}

          <Botao type="submit" variante="primario" ocupado={enviando} className="!min-h-[46px] text-[15px]">
            {enviando ? 'Entrando…' : 'Entrar'}
          </Botao>

          <p className="text-[12.5px] text-farol-suave">
            Esqueceu a senha? Fale com quem administra a conta. Por segurança, ninguém consegue recuperá-la, só
            definir uma nova.
          </p>
        </form>
      </section>
    </main>
  );
}
