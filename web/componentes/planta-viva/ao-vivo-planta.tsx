'use client';

// =====================================================================
// Ao vivo › Planta (A26, P7): a cozinha vista de cima, agora
// =====================================================================
// Do protótipo aprovado pelo dono em 27/10/2026: o palco escuro (como o
// exemplo dele), a grade de 50 cm, os ambientes, os móveis com o nome e as
// câmeras com o número do canal; cada pessoa é um ponto com o POSTO em que
// está (sem nome) e o rastro dos últimos segundos. Tocar numa pessoa (ou
// Enter, no teclado) a destaca e apaga as outras.
// =====================================================================

import { useMemo } from 'react';

import { molduraDoQueExiste, type Planta, type Pt } from '@/lib/planta';

export type FiguraAoVivo = {
  n: number;
  x: number;
  y: number;
  /** O posto em que está (o nome do móvel) ou "Passando". */
  rotulo: string;
  rastro: Pt[];
};

type Props = {
  planta: Planta;
  figuras: readonly FiguraAoVivo[];
  escolhida: number | null;
  aoEscolher: (n: number) => void;
  numeroDoCanal: (pontoId: string) => string;
};

/** O nome curto do móvel na planta (cabe no retângulo). */
const curto = (nome: string): string => (nome.length > 18 ? `${nome.slice(0, 17)}…` : nome);

export function AoVivoPlanta({ planta, figuras, escolhida, aoEscolher, numeroDoCanal }: Props) {
  const [x0, y0, x1, y1] = useMemo(() => {
    const [a, b, c, d] = molduraDoQueExiste(planta);
    return [a - 0.4, b - 0.4, c + 0.4, d + 0.4];
  }, [planta]);
  const largura = x1 - x0;
  const altura = y1 - y0;
  /** O tamanho da letra e dos pontos acompanha o tamanho da planta (uma cozinha de 6 m ou um salão de 30 m). */
  const u = Math.max(largura, altura) / 60;
  const linhas = useMemo(() => {
    const v: number[] = [];
    const h: number[] = [];
    for (let x = Math.ceil(x0 * 2) / 2; x <= x1; x += 0.5) v.push(x);
    for (let y = Math.ceil(y0 * 2) / 2; y <= y1; y += 0.5) h.push(y);
    return { v, h };
  }, [x0, y0, x1, y1]);

  return (
    <svg
      viewBox={`${x0} ${y0} ${largura} ${altura}`}
      className="block h-auto max-h-[72vh] w-full"
      role="img"
      aria-label={`A planta vista de cima, agora: ${figuras.length} pessoa(s)`}
      data-planta-ao-vivo
    >
      <rect x={x0} y={y0} width={largura} height={altura} fill="rgb(var(--cena))" />
      <g stroke="rgb(var(--cena-tinta) / .07)" strokeWidth={u * 0.06}>
        {linhas.v.map((x) => <line key={`v${x}`} x1={x} y1={y0} x2={x} y2={y1} />)}
        {linhas.h.map((y) => <line key={`h${y}`} x1={x0} y1={y} x2={x1} y2={y} />)}
      </g>
      {planta.ambientes.map((a) => (
        <rect key={a.id} x={a.x} y={a.y} width={a.w} height={a.h} fill="rgb(var(--cena-piso))" stroke="rgb(var(--cena-parede))" strokeWidth={u * 0.25} />
      ))}
      {planta.moveis.map((m) => (
        <g key={m.id}>
          <rect x={m.x} y={m.y} width={m.w} height={m.h} rx={u * 0.2} fill="rgb(var(--cena-movel))" stroke="rgb(var(--cena-movel-2))" strokeWidth={u * 0.15} />
          {m.w > u * 6 && m.h > u * 3 ? (
            <text x={m.x + u * 0.4} y={m.y + u * 1.25} fontSize={u * 0.95} fill="rgb(var(--cena-suave))" className="font-mono">
              {curto(m.nome)}
            </text>
          ) : null}
        </g>
      ))}
      {planta.cameras.map((c) => (
        <g key={c.pontoId}>
          <circle cx={c.x} cy={c.y} r={u * 0.55} fill="rgb(var(--rotulo))" />
          <text x={c.x + u * 0.8} y={c.y + u * 0.35} fontSize={u * 1.05} fontWeight={700} fill="rgb(var(--rotulo))" className="font-mono">
            {numeroDoCanal(c.pontoId)}
          </text>
        </g>
      ))}
      <g>
        {figuras.map((f) => (
          <polyline
            key={`r${f.n}`}
            points={f.rastro.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')}
            fill="none"
            stroke="rgb(var(--pessoa-claro))"
            strokeWidth={u * 0.35}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={escolhida === null || escolhida === f.n ? 0.6 : 0.12}
          />
        ))}
      </g>
      <g>
        {figuras.map((f) => {
          const apagada = escolhida !== null && escolhida !== f.n;
          const largo = (f.rotulo.length * 0.62 + 0.9) * u;
          return (
            <g
              key={f.n}
              transform={`translate(${f.x.toFixed(3)} ${f.y.toFixed(3)})`}
              opacity={apagada ? 0.35 : 1}
              role="button"
              tabIndex={0}
              aria-label={`Pessoa ${f.n}: ${f.rotulo}`}
              aria-pressed={escolhida === f.n}
              className="cursor-pointer outline-none focus-visible:[&>circle:first-child]:stroke-[rgb(var(--rotulo))]"
              onClick={() => aoEscolher(f.n)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  aoEscolher(f.n);
                }
              }}
              data-pessoa={f.n}
            >
              <circle r={u * 1.7} fill="rgb(var(--pessoa) / .25)" stroke="transparent" strokeWidth={u * 0.3} />
              <circle r={u * 1.0} fill="rgb(var(--pessoa))" stroke="#fff" strokeWidth={u * 0.2} />
              <rect x={u * 1.3} y={-u * 2.7} width={largo} height={u * 1.45} rx={u * 0.35} fill="rgb(var(--rotulo))" />
              <text x={u * 1.75} y={-u * 1.65} fontSize={u * 1.0} fontWeight={700} fill="rgb(var(--sobre-rotulo))" className="font-mono">
                {f.rotulo}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
