'use client';

// =====================================================================
// A leitura do ao vivo e o movimento suave entre as leituras
// =====================================================================
// O MESMO para as duas telas que mostram o movimento ao vivo: Canais ›
// Planta › Ao vivo (no console, com login) e a página do link só do ao vivo
// (`/ver`, sem login, 29/10/2026). Cada uma diz como ler; o resto é igual:
//
//   • lê a última posição de cada pessoa a cada segundo, só com a aba à
//     vista (ler também diz ao computador da loja que alguém olha: só então
//     ele manda a cada meio segundo);
//   • entre uma leitura e outra, cada figura anda suave até lá;
//   • o rótulo de cada pessoa é o POSTO em que ela está — sem nome.
// =====================================================================

import { useEffect, useMemo, useRef, useState } from 'react';

import type { PosicaoNaCena } from '@/componentes/planta-viva/ao-vivo-3d';
import type { FiguraAoVivo } from '@/componentes/planta-viva/ao-vivo-planta';
import { ErroDaApi } from '@/lib/api';
import type { Planta, Pt } from '@/lib/planta';
import { aproximar, lembrar, type AgoraDaPlanta, type MemoriaAoVivo } from '@/lib/planta-viva';

export const LER_A_CADA_MS = 1000;
export const PASSANDO = 'Passando';

export function useAoVivo({
  planta,
  ler,
  parar,
}: {
  planta: Planta | null;
  /** Uma leitura (precisa ser a mesma função entre um desenho e outro: `useCallback`). */
  ler: () => Promise<AgoraDaPlanta>;
  /** O erro que ENCERRA a leitura (sem acesso, link desligado): devolve verdadeiro e a tela mostra o motivo. */
  parar?: (e: unknown) => boolean;
}) {
  const [agora, setAgora] = useState<AgoraDaPlanta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [figuras, setFiguras] = useState<FiguraAoVivo[]>([]);
  const [relogio, setRelogio] = useState(0);
  const memoria = useRef<MemoriaAoVivo>(new Map());
  const alvos = useRef(new Map<number, Pt>());
  const mostradas = useRef(new Map<number, PosicaoNaCena>());
  const pararRef = useRef(parar);
  pararRef.current = parar;

  const nomeDoPosto = useMemo(() => new Map((planta?.moveis ?? []).map((m) => [m.id, m.nome])), [planta]);

  // ───────────── a leitura, a cada segundo, com a aba à vista ─────────────
  useEffect(() => {
    if (!planta) return;
    let parado = false;
    let espera: ReturnType<typeof setTimeout> | undefined;
    const umaVez = async () => {
      if (document.visibilityState === 'visible') {
        try {
          const a = await ler();
          if (parado) return;
          const t = Date.now();
          memoria.current = lembrar(memoria.current, a.pessoas, t, planta.moveis);
          alvos.current = new Map(a.pessoas.map((p) => [p.n, [p.x, p.y] as Pt]));
          setAgora(a);
          setErro(null);
        } catch (e) {
          if (parado) return;
          if (pararRef.current?.(e)) return;
          setErro(e instanceof ErroDaApi ? e.message : 'não consegui ler o movimento agora');
        }
      }
      if (!parado) espera = setTimeout(umaVez, LER_A_CADA_MS);
    };
    void umaVez();
    return () => {
      parado = true;
      if (espera) clearTimeout(espera);
    };
  }, [ler, planta]);

  // ───────────── o movimento suave entre as leituras ─────────────
  useEffect(() => {
    let quadro = 0;
    let antes = performance.now();
    let desenhadoEm = 0;
    const passo = (t: number) => {
      const dt = t - antes;
      antes = t;
      const novas = new Map<number, PosicaoNaCena>();
      for (const [n, alvo] of alvos.current) {
        const era = mostradas.current.get(n);
        const [x, y] = era ? aproximar([era.x, era.y], alvo, dt) : alvo;
        const posto = memoria.current.get(n)?.posto;
        novas.set(n, { x, y, rotulo: (posto && nomeDoPosto.get(posto)) || PASSANDO });
      }
      mostradas.current = novas;
      // a vista de cima e a lista pelo React, ~20 vezes por segundo; o 3D lê o ref a cada quadro
      if (t - desenhadoEm > 50) {
        desenhadoEm = t;
        setFiguras(
          [...novas].map(([n, p]) => ({
            n,
            x: p.x,
            y: p.y,
            rotulo: p.rotulo,
            rastro: [...(memoria.current.get(n)?.rastro ?? []).map(([rx, ry]) => [rx, ry] as Pt), [p.x, p.y] as Pt],
          })),
        );
        setRelogio(Date.now());
      }
      quadro = requestAnimationFrame(passo);
    };
    quadro = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(quadro);
  }, [nomeDoPosto]);

  return { agora, erro, figuras, relogio, mostradas, memoria };
}
