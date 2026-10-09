'use client';

// =====================================================================
// A imagem do canal com os quadros marcados por cima
// =====================================================================
// É a vista de LEITURA do canal: a imagem completa (o contorno fino em
// volta) e cada quadro com o número dele. Clicar num quadro o seleciona —
// aqui e na árvore ao lado; clicar fora de todos seleciona a imagem
// completa. Onde dois quadros se sobrepõem, a faixa aparece riscada.
//
// O contorno se desenha em outra tela ("Redesenhar o contorno"): aqui nada
// se arrasta, e por isso um toque na imagem nunca muda um desenho sem querer.
// =====================================================================

import { Crop } from 'lucide-react';
import { useId, type ReactNode } from 'react';

import { areaDe, caixaDe, contem, sobreposicao, type Ponto } from '@/componentes/areas/poligono';

export type QuadroNaImagem = { id: string; numero: number; nome: string; pontos: Ponto[] };

/** A partir de quanto de um quadro dentro do outro a faixa aparece riscada. */
const SOBREPOSICAO_QUE_SE_VE = 0.02;

const pc = (v: number) => `${(v * 100).toFixed(2)}%`;
const noDesenho = (pontos: Ponto[]) => pontos.map(([x, y]) => `${(x * 100).toFixed(2)},${(y * 100).toFixed(2)}`).join(' ');

/** Os pares de quadros que se sobrepõem, pelo número: [[1, 2], [2, 4]]. */
export function sobrepostos(quadros: readonly QuadroNaImagem[]): Array<[QuadroNaImagem, QuadroNaImagem]> {
  const pares: Array<[QuadroNaImagem, QuadroNaImagem]> = [];
  for (let i = 0; i < quadros.length; i += 1) {
    for (let j = i + 1; j < quadros.length; j += 1) {
      const a = quadros[i]!;
      const b = quadros[j]!;
      if (a.pontos.length < 3 || b.pontos.length < 3) continue;
      // Qualquer dos dois dentro do outro conta: um quadro pequeno inteiro
      // dentro de um grande é 100% dele e pouco do grande.
      if (Math.max(sobreposicao(a.pontos, b.pontos), sobreposicao(b.pontos, a.pontos)) >= SOBREPOSICAO_QUE_SE_VE) pares.push([a, b]);
    }
  }
  return pares;
}

export function ImagemDoCanal({
  src,
  alt,
  quadros,
  idDaInteira,
  selecionada,
  aoSelecionar,
  semImagem,
}: {
  /** A imagem que o canal tem guardada; `null` = ainda não tem. */
  src: string | null;
  alt: string;
  quadros: readonly QuadroNaImagem[];
  /** O id da imagem completa: é o que se seleciona ao clicar fora dos quadros. */
  idDaInteira: string;
  selecionada: string;
  aoSelecionar: (id: string) => void;
  /** O que mostrar no lugar da imagem enquanto o canal não tem uma. */
  semImagem: ReactNode;
}) {
  const p = useId();
  const pares = sobrepostos(quadros);
  // Um recorte por quadro que corta algum outro (ele pode cortar mais de um).
  const cortadores = [...new Map(pares.map(([a]) => [a.id, a])).values()];
  // O maior primeiro: o menor fica por cima no desenho.
  const doMaiorAoMenor = [...quadros].sort((a, b) => areaDe(b.pontos) - areaDe(a.pontos));

  function aoClicar(ev: React.MouseEvent<HTMLDivElement>) {
    const c = ev.currentTarget.getBoundingClientRect();
    if (c.width === 0 || c.height === 0) return;
    const x = (ev.clientX - c.left) / c.width;
    const y = (ev.clientY - c.top) / c.height;
    // Vale o MENOR quadro que contém o ponto: é o que a pessoa está vendo
    // ali, mesmo com um maior por baixo. Fora de todos, a imagem completa.
    let alvo: QuadroNaImagem | null = null;
    for (const q of quadros) {
      if (q.pontos.length < 3 || !contem(q.pontos, x, y)) continue;
      if (!alvo || areaDe(q.pontos) < areaDe(alvo.pontos)) alvo = q;
    }
    aoSelecionar(alvo?.id ?? idDaInteira);
  }

  const naInteira = selecionada === idDaInteira;

  return (
    <div
      data-imagem-do-canal
      onClick={aoClicar}
      className={`relative max-w-full cursor-pointer select-none overflow-hidden rounded-xl border border-farol-borda bg-farol-palco ${
        src ? '' : 'aspect-video'
      }`}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} className="block w-full" draggable={false} />
      ) : (
        <div className="absolute inset-0 grid place-items-center p-5 text-center text-[13px] text-farol-palco-suave">
          <div className="flex max-w-[44ch] flex-col items-center gap-2">
            <Crop className="h-6 w-6" aria-hidden />
            {semImagem}
          </div>
        </div>
      )}

      {/* Os contornos. O desenho vai de 0 a 100 nos dois eixos e estica com a
          imagem; `non-scaling-stroke` mantém o traço com a mesma espessura. */}
      <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
        <defs>
          <pattern id={`${p}-riscado`} width="2.4" height="2.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="2.4" height="2.4" fill="rgb(255 255 255 / 0.2)" />
            <rect width="1" height="2.4" fill="rgb(16 22 31 / 0.6)" />
          </pattern>
          {cortadores.map((a) => (
            <clipPath key={a.id} id={`${p}-corte-${a.id}`}>
              <polygon points={noDesenho(a.pontos)} />
            </clipPath>
          ))}
        </defs>

        {/* A imagem completa: o contorno em volta de tudo. Selecionada, acende. */}
        <rect
          data-contorno-da-inteira
          x="0.5"
          y="0.5"
          width="99"
          height="99"
          fill="none"
          stroke={naInteira ? '#F2B03C' : '#FFFFFF'}
          strokeWidth={naInteira ? 4 : 2}
          opacity={naInteira ? 1 : 0.55}
          vectorEffect="non-scaling-stroke"
        />

        {/* Onde dois quadros se sobrepõem: o segundo, cortado pelo primeiro. */}
        {pares.map(([a, b]) => (
          <polygon
            key={`${a.id}-${b.id}`}
            data-sobreposicao={`${a.numero}-${b.numero}`}
            points={noDesenho(b.pontos)}
            clipPath={`url(#${p}-corte-${a.id})`}
            fill={`url(#${p}-riscado)`}
          />
        ))}

        {doMaiorAoMenor.map((q) => {
          const aqui = q.id === selecionada;
          return (
            <polygon
              key={q.id}
              data-quadro={q.id}
              points={noDesenho(q.pontos)}
              fill={aqui ? 'rgb(242 176 60 / 0.22)' : 'rgb(255 255 255 / 0)'}
              stroke={aqui ? '#F2B03C' : '#FFFFFF'}
              strokeWidth={aqui ? 3 : 2}
              strokeDasharray={aqui ? undefined : '6 5'}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>

      {/* O número de cada quadro, no canto de cima do contorno dele. É botão:
          é por ele que o teclado seleciona o quadro. */}
      {quadros.map((q) => {
        const c = caixaDe(q.pontos);
        const aqui = q.id === selecionada;
        return (
          <button
            key={q.id}
            type="button"
            data-numero-do-quadro={q.numero}
            aria-pressed={aqui}
            aria-label={`Quadro ${q.numero}, ${q.nome}`}
            onClick={(ev) => {
              ev.stopPropagation();
              aoSelecionar(q.id);
            }}
            className={`absolute grid h-7 w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full font-mono text-[13px] font-semibold text-[#10161F] shadow-[0_0_0_1px_rgb(4_8_14/0.45)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white ${
              aqui ? 'bg-[#F2B03C]' : 'bg-white'
            }`}
            // Um pouco para dentro do canto, para não sair da imagem quando o quadro encosta na borda.
            style={{ left: `clamp(16px, calc(${pc(c.x1)} + 16px), calc(100% - 16px))`, top: `clamp(16px, calc(${pc(c.y1)} + 16px), calc(100% - 16px))` }}
          >
            {q.numero}
          </button>
        );
      })}
    </div>
  );
}
