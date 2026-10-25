'use client';

// =====================================================================
// A planta vista de cima, para LER (A26, P4)
// =====================================================================
// O chão de cada ambiente, os móveis com o nome e as câmeras no lugar — com
// as mesmas classes do desenho da planta (`pl-piso`, `pl-movel`), e o que
// cada tela põe por cima: os pontos da calibração, o piso de cada câmera, o
// calor, as pessoas do replay. O desenho é feito NO TAMANHO em que aparece
// (como o da planta): letras e marcas do mesmo tamanho no celular.
//
// `fundo` vai embaixo dos móveis (o calor); `children`, por cima de tudo.
// `aoTocarNoChao` recebe o ponto do chão em metros (a calibração).
// =====================================================================

import { useId, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';

import { molduraDoQueExiste, projetor, type Planta, type Pt } from '@/lib/planta';

/** `recorte`: o `clip-path` do chão dos ambientes — o piso de uma câmera não passa da parede no desenho. */
export type Projecao = { p: (x: number, y: number) => Pt; escala: number; recorte: string };

/** As cores das câmeras (tokens), na ordem dos canais. */
export const CORES_DAS_CAMERAS = ['ketchup', 'picles', 'marca', 'pao', 'critico', 'suave'] as const;
export const corDaCamera = (i: number): string => `rgb(var(--${CORES_DAS_CAMERAS[i % CORES_DAS_CAMERAS.length]}))`;

export function PlantaDeCima({
  planta,
  descricao,
  camerasVisiveis,
  nomeDaCamera,
  corDe,
  fundo,
  children,
  aoTocarNoChao,
  alvo = false,
}: {
  planta: Planta;
  /** O que o desenho mostra, para quem não vê a tela. */
  descricao: string;
  /** As câmeras a desenhar (o id do canal); ausente = todas. */
  camerasVisiveis?: ReadonlySet<string>;
  nomeDaCamera: (pontoId: string) => string;
  corDe: (pontoId: string) => string;
  fundo?: (pr: Projecao) => ReactNode;
  children?: (pr: Projecao) => ReactNode;
  aoTocarNoChao?: (pt: Pt) => void;
  /** O cursor de mira (a calibração: tocar marca). */
  alvo?: boolean;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  const [largura, setLargura] = useState(720);
  useLayoutEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const medir = () => setLargura(Math.max(240, Math.round(el.clientWidth)));
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const moldura = useMemo(() => molduraDoQueExiste(planta), [planta]);
  const margem = 26;
  const altura = useMemo(() => {
    const mx = Math.max(0.5, moldura[2] - moldura[0]);
    const my = Math.max(0.5, moldura[3] - moldura[1]);
    return Math.round(Math.min(largura * 1.2, (largura - 2 * margem) * (my / mx) + 2 * margem));
  }, [largura, moldura]);
  const pr = useMemo(() => projetor(planta, moldura, 0, largura, altura, margem), [planta, moldura, largura, altura]);
  const idDoChao = `chao-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const proj: Projecao = useMemo(
    () => ({ p: (x: number, y: number): Pt => { const [a, b] = pr.p(x, y); return [a, b]; }, escala: pr.escala, recorte: `url(#${idDoChao})` }),
    [pr, idDoChao],
  );
  const { p } = proj;

  const tocar = (e: MouseEvent<SVGSVGElement>) => {
    if (!aoTocarNoChao) return;
    const r = e.currentTarget.getBoundingClientRect();
    const [x, y] = pr.chao(((e.clientX - r.left) / r.width) * largura, ((e.clientY - r.top) / r.height) * altura);
    aoTocarNoChao([Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
  };

  const ret = (x: number, y: number, w: number, h: number) => {
    const [x1, y1] = p(x, y);
    const [x2, y2] = p(x + w, y + h);
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
  };

  // a grade de 1 m, dentro de cada ambiente
  const grade: ReactNode[] = [];
  for (const a of planta.ambientes) {
    for (let x = Math.ceil(a.x); x < a.x + a.w; x++) {
      if (x <= a.x) continue;
      const [x1, y1] = p(x, a.y);
      const [x2, y2] = p(x, a.y + a.h);
      grade.push(<line key={`${a.id}-x${x}`} x1={x1} y1={y1} x2={x2} y2={y2} className="stroke-farol-borda" strokeWidth={1} />);
    }
    for (let y = Math.ceil(a.y); y < a.y + a.h; y++) {
      if (y <= a.y) continue;
      const [x1, y1] = p(a.x, y);
      const [x2, y2] = p(a.x + a.w, y);
      grade.push(<line key={`${a.id}-y${y}`} x1={x1} y1={y1} x2={x2} y2={y2} className="stroke-farol-borda" strokeWidth={1} />);
    }
  }

  return (
    <div ref={caixa} className="min-w-0" data-planta-de-cima>
      <svg
        width={largura}
        height={altura}
        viewBox={`0 0 ${largura} ${altura}`}
        className={`block max-w-full rounded-xl border border-farol-borda bg-farol-painel-2 ${alvo ? 'cursor-crosshair' : ''}`}
        role="img"
        aria-label={descricao}
        onClick={tocar}
      >
        <defs>
          <clipPath id={idDoChao}>
            {planta.ambientes.map((a) => (
              <rect key={a.id} {...ret(a.x, a.y, a.w, a.h)} />
            ))}
          </clipPath>
        </defs>
        {planta.ambientes.map((a) => (
          <rect key={a.id} {...ret(a.x, a.y, a.w, a.h)} className="pl-piso" />
        ))}
        {grade}
        {fundo?.(proj)}
        {planta.moveis.map((m) => {
          const r = ret(m.x, m.y, m.w, m.h);
          return (
            <g key={m.id}>
              <rect {...r} rx={5} className="pl-movel tampo" />
              {r.width > 34 && (
                <text x={r.x + r.width / 2} y={r.y + r.height / 2 + 4} className="pl-nome pq" style={{ fill: 'rgb(var(--tinta))' }}>
                  {m.nome}
                </text>
              )}
            </g>
          );
        })}
        {children?.(proj)}
        {planta.cameras
          .filter((c) => !camerasVisiveis || camerasVisiveis.has(c.pontoId))
          .map((c) => {
            const [x, y] = p(c.x, c.y);
            const cor = corDe(c.pontoId);
            const perto = (lado: 'x' | 'y') => (lado === 'x' ? x < 60 : y < 34);
            return (
              <g key={c.pontoId} data-camera={c.pontoId} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}>
                <g transform={`rotate(${c.dir})`}>
                  <rect x={-10} y={-7} width={20} height={14} rx={4} fill={cor} />
                  <path d="M10 -4 L17 -8 L17 8 L10 4 Z" fill={cor} />
                </g>
                <text
                  x={perto('x') ? 14 : 0}
                  y={perto('y') ? 26 : -14}
                  textAnchor={perto('x') ? 'start' : 'middle'}
                  className="font-display text-[12px] font-extrabold uppercase"
                  style={{ fill: cor, paintOrder: 'stroke', stroke: 'rgb(var(--painel))', strokeWidth: 3 }}
                >
                  {nomeDaCamera(c.pontoId)}
                </text>
              </g>
            );
          })}
      </svg>
    </div>
  );
}

/** Um polígono do chão (metros) no desenho. */
export function PoligonoNoChao({ pts, p, cor, tracejado = false, opacidade = 0.16, recorte }: {
  pts: readonly Pt[];
  p: Projecao['p'];
  cor: string;
  tracejado?: boolean;
  opacidade?: number;
  /** O chão dos ambientes (`Projecao.recorte`): a área não passa da parede. */
  recorte?: string;
}) {
  if (pts.length < 3) return null;
  return (
    <polygon
      clipPath={recorte}
      points={pts.map(([x, y]) => p(x, y).map((v) => v.toFixed(1)).join(',')).join(' ')}
      fill={cor}
      fillOpacity={opacidade}
      stroke={cor}
      strokeWidth={2.5}
      strokeLinejoin="round"
      strokeDasharray={tracejado ? '6 5' : undefined}
      pointerEvents="none"
    />
  );
}
