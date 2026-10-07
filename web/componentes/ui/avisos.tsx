'use client';

// =====================================================================
// O aviso que confirma uma ação
// =====================================================================
// Toda ação responde. A que deu certo responde aqui: um recado curto no
// pé da tela, que some sozinho.
//
// O que deu ERRADO não vem para cá. Erro que pede providência fica na
// página (`Alerta`), junto de onde aconteceu, até a pessoa resolver —
// recado que some em quatro segundos não serve para isso.
// =====================================================================

import { CircleCheck } from 'lucide-react';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

type Aviso = { id: number; texto: string; saindo: boolean };

const Contexto = createContext<(texto: string) => void>(() => {});

const NA_TELA_MS = 4200;
const SAIDA_MS = 220;

export function ProvedorDeAvisos({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const proximo = useRef(1);

  const avisar = useCallback((texto: string) => {
    const id = proximo.current++;
    // No máximo três de uma vez: mais que isso ninguém lê.
    setAvisos((a) => [...a.slice(-2), { id, texto, saindo: false }]);
    setTimeout(() => {
      setAvisos((a) => a.map((x) => (x.id === id ? { ...x, saindo: true } : x)));
      setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), SAIDA_MS);
    }, NA_TELA_MS);
  }, []);

  return (
    <Contexto.Provider value={avisar}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed bottom-[calc(22px+env(safe-area-inset-bottom,0px))] left-1/2 z-[80] flex w-max max-w-[calc(100%-2rem)] -translate-x-1/2 flex-col items-center gap-2 max-md:bottom-[calc(84px+env(safe-area-inset-bottom,0px))]"
      >
        {avisos.map((a) => (
          <div
            key={a.id}
            className={`flex max-w-full items-center gap-2.5 rounded-xl bg-farol-tinta px-3.5 py-[11px] font-medium text-farol-fundo shadow-farol-2 transition-all duration-200 ${
              a.saindo ? 'translate-y-2 opacity-0' : 'animate-sobe'
            }`}
          >
            <CircleCheck className="h-[18px] w-[18px] shrink-0 text-farol-facho" aria-hidden />
            <span className="min-w-0">{a.texto}</span>
          </div>
        ))}
      </div>
    </Contexto.Provider>
  );
}

/** `const avisar = useAvisar(); avisar('Canal salvo.')` */
export function useAvisar(): (texto: string) => void {
  return useContext(Contexto);
}
