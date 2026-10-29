'use client';

// =====================================================================
// Ao vivo › Planta (A26, P7): a loja vista de cima, agora
// =====================================================================
// Do protótipo aprovado pelo dono em 27/10/2026, com a "planta com vida"
// aprovada em 29/10/2026: o palco escuro, a grade de 50 cm, o chão de cada
// ambiente com a cor do LUGAR (cozinha, salão, delivery…) e o nome dele, os
// móveis com a cor do equipamento (a chapa com a brasa, a fritadeira com as
// cubas, o totem com a tela) e o nome, e as câmeras com o número do canal;
// cada pessoa é um ponto com o POSTO em que está (sem nome) e o rastro dos
// últimos segundos. Tocar numa pessoa (ou Enter, no teclado) a destaca e
// apaga as outras.
// =====================================================================

import { useMemo } from 'react';

import { molduraDoQueExiste, tipoDoAmbiente, tipoDoMovel, type Planta, type Pt } from '@/lib/planta';

import { corDoLugar, DE_CIMA, emCss, FORCA_DO_CHAO, MATERIAL } from './cara-da-planta';

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
  /** O chão com a cor de cada lugar (senão, o piso de sempre). */
  comCores: boolean;
  /** O nome de cada equipamento. */
  comNomes: boolean;
};

/** A largura de um texto, em metros, pela letra (média de uma letra sem serifa ≈ 0,56 da altura). */
const larguraDo = (texto: string, letra: number): number => texto.length * letra * 0.56;
const curto = (nome: string): string => (nome.length > 18 ? `${nome.slice(0, 17)}…` : nome);

export function AoVivoPlanta({ planta, figuras, escolhida, aoEscolher, numeroDoCanal, comCores, comNomes }: Props) {
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
  const letra = u * 0.9;

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
      {planta.ambientes.map((a) => {
        const tipo = tipoDoAmbiente(a);
        return (
          <g key={a.id} data-ambiente={a.id} data-lugar={tipo}>
            <rect x={a.x} y={a.y} width={a.w} height={a.h} fill="rgb(var(--cena-piso))" />
            {comCores ? <rect x={a.x} y={a.y} width={a.w} height={a.h} fill={corDoLugar(tipo)} fillOpacity={FORCA_DO_CHAO} data-chao-do-lugar /> : null}
            <rect x={a.x} y={a.y} width={a.w} height={a.h} fill="none" stroke="rgb(var(--cena-parede))" strokeWidth={u * 0.25} />
          </g>
        );
      })}
      {planta.moveis.map((m) => {
        const tipo = tipoDoMovel(m);
        const cara = DE_CIMA[tipo];
        const nome = larguraDo(m.nome, letra) < m.w - u * 0.5 ? m.nome : larguraDo(curto(m.nome), letra) < m.w - u * 0.5 ? curto(m.nome) : null;
        return (
          <g key={m.id} data-movel={m.id} data-tipo={tipo}>
            <rect x={m.x} y={m.y} width={m.w} height={m.h} rx={u * 0.2} fill={cara.fundo} stroke="rgb(var(--cena))" strokeWidth={u * 0.15} />
            {tipo === 'chapa' ? <rect x={m.x + m.w * 0.08} y={m.y + m.h * 0.15} width={m.w * 0.84} height={m.h * 0.7} fill={emCss(MATERIAL.brasa)} opacity={0.4} /> : null}
            {tipo === 'fritadeira'
              ? [0, 1].map((k) => <rect key={k} x={m.x + m.w * (0.1 + k * 0.45)} y={m.y + m.h * 0.2} width={m.w * 0.35} height={m.h * 0.6} fill={emCss(MATERIAL.oleo)} opacity={0.85} />)
              : null}
            {tipo === 'totem' ? <rect x={m.x + m.w * 0.2} y={m.y + m.h * 0.2} width={m.w * 0.6} height={m.h * 0.6} fill={emCss(MATERIAL.tela)} /> : null}
            {comNomes && nome && m.h > letra * 1.3 ? (
              <text
                x={m.x + m.w / 2}
                y={m.y + m.h / 2 + letra * 0.35}
                textAnchor="middle"
                fontSize={letra}
                fontWeight={600}
                fill={cara.tinta === 'clara' ? 'rgb(var(--cena-tinta))' : 'rgb(var(--sobre-rotulo))'}
                pointerEvents="none"
                data-nome-do-movel
              >
                {nome}
              </text>
            ) : null}
          </g>
        );
      })}
      {planta.ambientes.map((a) => {
        const fs = u * 0.95;
        if (larguraDo(a.nome, fs) > a.w - u || a.h < fs * 2) return null;
        return (
          <text
            key={`n${a.id}`}
            x={a.x + u * 0.5}
            y={a.y + fs * 1.3}
            fontSize={fs}
            fill={comCores ? corDoLugar(tipoDoAmbiente(a)) : 'rgb(var(--cena-suave))'}
            // o contorno na cor da cena: o nome se lê contra ELA (≥ 5:1), e não contra o chão tingido
            stroke="rgb(var(--cena))"
            strokeWidth={fs * 0.4}
            paintOrder="stroke"
            strokeLinejoin="round"
            className="font-mono"
            pointerEvents="none"
            data-nome-do-ambiente
          >
            {a.nome}
          </text>
        );
      })}
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
