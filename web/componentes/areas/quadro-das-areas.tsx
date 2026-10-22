'use client';

// =====================================================================
// O quadro do canal com as áreas desenhadas por cima
// =====================================================================
// A área é um contorno de pontos. Três gestos, e os três têm teclado:
//
//   arrastar um PONTO            ajusta o contorno
//   arrastar o ponto do MEIO     cria um ponto novo naquele lado
//   arrastar sobre a IMAGEM      redesenha a área na forma escolhida: retângulo,
//                                ou o círculo inscrito no retângulo arrastado
//
// CLIQUE (sem arrastar) seleciona a área que está ali. Toda loja nova tem a
// área "Quadro inteiro" cobrindo a imagem toda: se apertar sobre ela já
// trocasse a seleção, não sobrava onde começar a desenhar a segunda.
//
// O que está FORA do contorno selecionado escurece — é o que o agente apaga
// antes de analisar.
// =====================================================================

import { useRef, useState } from 'react';

import {
  areaDe,
  caixaDe,
  comPontoEm,
  comPontoNovo,
  contem,
  elipse,
  MAX_PONTOS,
  meioDoLado,
  prender,
  retangulo,
  semPonto,
  type Forma,
  type Ponto,
} from './poligono';

export type AreaNoQuadro = { id: string; nome: string; pontos: Ponto[]; cor: string };

type Props = {
  src: string;
  alt: string;
  /** Todas as áreas do canal, com o desenho GUARDADO de cada uma. */
  areas: AreaNoQuadro[];
  selecionada: string;
  /** O desenho em edição da área selecionada (pode ainda não estar salvo). */
  pontos: Ponto[];
  /** O ponto em que se está mexendo, ou `null`. */
  ativo: number | null;
  aoAtivar: (i: number | null) => void;
  /** Contorno cruzado ou sem tamanho: o traço fica vermelho. */
  comProblema: boolean;
  /** O nome que vai na etiqueta da área selecionada; `null` = sem etiqueta. */
  etiqueta: string | null;
  editavel: boolean;
  /** O que o arrasto sobre a imagem desenha. Sem ela, o retângulo de sempre. */
  forma?: Forma;
  /** Antes da PRIMEIRA mudança de um gesto: é o que o "desfazer" devolve. */
  aoComecar: () => void;
  aoMudar: (pontos: Ponto[]) => void;
  /** O gesto não deu em nada: volta ao que era e esquece o "desfazer" dele. */
  aoDesistir: () => void;
  aoSelecionar: (id: string) => void;
};

type Gesto =
  | { tipo: 'desenho'; x: number; y: number; telaX: number; telaY: number; mexeu: boolean }
  | { tipo: 'ponto'; i: number; telaX: number; telaY: number; mexeu: boolean };

/** Quantos pontos de tela o ponteiro anda antes de o aperto virar arrasto. */
const FOLGA_DO_CLIQUE = 6;
/** Lado mais curto que isto (em fração do quadro) não ganha o ponto do meio: não cabe. */
const LADO_MINIMO_PARA_O_MEIO = 0.07;
const PASSO = 0.005;
const PASSO_LARGO = 0.02;

const pc = (v: number) => `${(v * 100).toFixed(2)}%`;
const noDesenho = (pontos: Ponto[]) => pontos.map(([x, y]) => `${(x * 100).toFixed(2)},${(y * 100).toFixed(2)}`).join(' ');
const caminho = (pontos: Ponto[]) => `M${pontos.map(([x, y]) => `${(x * 100).toFixed(2)} ${(y * 100).toFixed(2)}`).join('L')}Z`;

export function QuadroDasAreas({
  src,
  alt,
  areas,
  selecionada,
  pontos,
  ativo,
  aoAtivar,
  comProblema,
  etiqueta,
  editavel,
  forma = 'retangulo',
  aoComecar,
  aoMudar,
  aoDesistir,
  aoSelecionar,
}: Props) {
  const quadro = useRef<HTMLDivElement>(null);
  const gesto = useRef<Gesto | null>(null);
  const [arrastando, setArrastando] = useState(false);

  const indice = Math.max(0, areas.findIndex((a) => a.id === selecionada));
  const cor = areas[indice]?.cor ?? '#F2B03C';
  const caixa = caixaDe(pontos);

  function posicao(ev: React.PointerEvent): Ponto | null {
    const c = quadro.current?.getBoundingClientRect();
    if (!c || c.width === 0) return null;
    return [prender((ev.clientX - c.left) / c.width), prender((ev.clientY - c.top) / c.height)];
  }

  const focarPonto = (i: number) =>
    requestAnimationFrame(() => quadro.current?.querySelector<HTMLButtonElement>(`[data-ponto="${i}"]`)?.focus());

  // ───────────────────────── o ponteiro ─────────────────────────

  function aoPressionarNaImagem(ev: React.PointerEvent) {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    const p = posicao(ev);
    if (!p) return;
    quadro.current?.setPointerCapture?.(ev.pointerId);
    gesto.current = { tipo: 'desenho', x: p[0], y: p[1], telaX: ev.clientX, telaY: ev.clientY, mexeu: false };
  }

  function aoPressionarNoPonto(ev: React.PointerEvent, i: number) {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    ev.stopPropagation();
    quadro.current?.setPointerCapture?.(ev.pointerId);
    gesto.current = { tipo: 'ponto', i, telaX: ev.clientX, telaY: ev.clientY, mexeu: false };
    aoAtivar(i);
  }

  /** Apertar o ponto do meio já cria o ponto, e o mesmo gesto o arrasta. */
  function aoPressionarNoMeio(ev: React.PointerEvent, i: number) {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    ev.stopPropagation();
    if (pontos.length >= MAX_PONTOS) return;
    quadro.current?.setPointerCapture?.(ev.pointerId);
    aoComecar();
    aoMudar(comPontoNovo(pontos, i, meioDoLado(pontos, i)));
    gesto.current = { tipo: 'ponto', i: i + 1, telaX: ev.clientX, telaY: ev.clientY, mexeu: true };
    aoAtivar(i + 1);
    setArrastando(true);
  }

  function aoMover(ev: React.PointerEvent) {
    const g = gesto.current;
    if (!g) return;
    // Mão que treme num clique não é arrasto.
    if (!g.mexeu && Math.hypot(ev.clientX - g.telaX, ev.clientY - g.telaY) < FOLGA_DO_CLIQUE) return;
    if (!editavel) {
      // Quem só vê não desenha — e o arrasto dele também não é um clique:
      // soltar não troca a área selecionada.
      g.mexeu = true;
      return;
    }
    const p = posicao(ev);
    if (!p) return;
    if (!g.mexeu) {
      g.mexeu = true;
      aoComecar();
      setArrastando(true);
    }
    if (g.tipo === 'ponto') {
      aoMudar(comPontoEm(pontos, g.i, p));
      return;
    }
    aoAtivar(null);
    const arrastada = { x1: Math.min(g.x, p[0]), y1: Math.min(g.y, p[1]), x2: Math.max(g.x, p[0]), y2: Math.max(g.y, p[1]) };
    aoMudar(forma === 'circulo' ? elipse(arrastada) : retangulo(arrastada));
  }

  function aoSoltar(ev: React.PointerEvent) {
    const g = gesto.current;
    if (!g) return;
    gesto.current = null;
    setArrastando(false);

    if (g.tipo === 'ponto') {
      if (g.mexeu) focarPonto(g.i);
      return;
    }
    if (g.mexeu) {
      // Um risco fino viraria uma área sem tamanho. Volta a que estava:
      // quem quer o quadro inteiro tem o atalho ao lado.
      if (editavel && (caixa.x2 - caixa.x1 < 0.01 || caixa.y2 - caixa.y1 < 0.01)) aoDesistir();
      return;
    }
    if (ev.type !== 'pointerup') return;
    // Foi um clique. Vale a MENOR área que contém o ponto: é a que a pessoa
    // está vendo ali, mesmo com uma maior por baixo. Clicar dentro da que já
    // está selecionada não troca nada.
    let alvo: { id: string; tamanho: number } | null = null;
    for (const a of areas) {
      const desenho = a.id === selecionada ? pontos : a.pontos;
      if (!contem(desenho, g.x, g.y)) continue;
      const t = areaDe(desenho);
      if (!alvo || t < alvo.tamanho || (t === alvo.tamanho && a.id === selecionada)) alvo = { id: a.id, tamanho: t };
    }
    if (alvo && alvo.id !== selecionada) aoSelecionar(alvo.id);
  }

  // ───────────────────────── o teclado ─────────────────────────

  function aoTeclarNoPonto(ev: React.KeyboardEvent, i: number) {
    if (!editavel) return;
    const passo = ev.shiftKey ? PASSO_LARGO : PASSO;
    const [x, y] = pontos[i]!;
    const para: Record<string, Ponto> = {
      ArrowLeft: [x - passo, y],
      ArrowRight: [x + passo, y],
      ArrowUp: [x, y - passo],
      ArrowDown: [x, y + passo],
    };
    const novo = para[ev.key];
    if (novo) {
      ev.preventDefault();
      aoComecar();
      aoMudar(comPontoEm(pontos, i, novo));
      return;
    }
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && pontos.length > 3) {
      ev.preventDefault();
      aoComecar();
      aoMudar(semPonto(pontos, i));
      const vizinho = Math.max(0, i - 1);
      aoAtivar(vizinho);
      focarPonto(vizinho);
    }
  }

  function criarPontoPeloTeclado(i: number) {
    if (pontos.length >= MAX_PONTOS) return;
    aoComecar();
    aoMudar(comPontoNovo(pontos, i, meioDoLado(pontos, i)));
    aoAtivar(i + 1);
    focarPonto(i + 1);
  }

  const traco = comProblema ? '#FF5A5F' : cor;

  return (
    <div
      ref={quadro}
      data-quadro-das-areas
      onPointerDown={aoPressionarNaImagem}
      onPointerMove={aoMover}
      onPointerUp={aoSoltar}
      onPointerCancel={aoSoltar}
      className="relative max-w-full cursor-crosshair touch-none select-none overflow-hidden rounded-xl border border-farol-borda"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="block w-full" draggable={false} />

      {/* Os contornos. O desenho vai de 0 a 100 nos dois eixos e estica com a
          imagem; `non-scaling-stroke` mantém o traço com a mesma espessura. */}
      <svg
        aria-hidden
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 h-full w-full"
      >
        {/* O que está FORA da área selecionada escurece. */}
        <path d={`M0 0H100V100H0Z${caminho(pontos)}`} fillRule="evenodd" fill="rgb(0 0 0 / 0.55)" />
        {/* As OUTRAS áreas do canal: tracejadas, cada uma na sua cor. */}
        {areas.map((a) =>
          a.id === selecionada ? null : (
            <polygon
              key={a.id}
              data-contorno-de={a.id}
              points={noDesenho(a.pontos)}
              fill={a.cor}
              fillOpacity={0.18}
              stroke={a.cor}
              strokeWidth={2}
              strokeDasharray="6 4"
              vectorEffect="non-scaling-stroke"
            />
          ),
        )}
        <polygon points={noDesenho(pontos)} fill="none" stroke="rgb(4 8 14 / 0.55)" strokeWidth={4} vectorEffect="non-scaling-stroke" />
        <polygon
          data-contorno-selecionado
          points={noDesenho(pontos)}
          fill="none"
          stroke={traco}
          strokeWidth={2}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {/* As outras áreas, para o TECLADO: quem decide com o mouse é o gesto no
          quadro (clique × arrasto), não o botão — o `onClick` daqui só atende
          o teclado (`detail` 0), senão soltar o arrasto em cima de outra área
          trocaria a seleção. */}
      {areas.map((a) => {
        if (a.id === selecionada) return null;
        const c = caixaDe(a.pontos);
        return (
          <button
            key={a.id}
            type="button"
            data-outra-area={a.id}
            aria-label={`Selecionar a área ${a.nome}`}
            onClick={(ev) => {
              if (ev.detail === 0) aoSelecionar(a.id);
            }}
            className="absolute cursor-crosshair rounded bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            style={{ left: pc(c.x1), top: pc(c.y1), width: pc(c.x2 - c.x1), height: pc(c.y2 - c.y1) }}
          >
            <Etiqueta cor={a.cor} dentro={c.y1 < 0.07}>
              {a.nome}
            </Etiqueta>
          </button>
        );
      })}

      {etiqueta !== null && (
        <div
          className="pointer-events-none absolute"
          style={{ left: pc(caixa.x1), top: pc(caixa.y1), width: pc(caixa.x2 - caixa.x1), height: pc(caixa.y2 - caixa.y1) }}
        >
          <Etiqueta cor={cor} dentro={caixa.y1 < 0.07}>
            {etiqueta}
          </Etiqueta>
        </div>
      )}

      {/* Os pontos do meio: arrastar um deles cria um ponto naquele lado. */}
      {editavel &&
        pontos.length < MAX_PONTOS &&
        pontos.map((p, i) => {
          const q = pontos[(i + 1) % pontos.length]!;
          if (Math.hypot(q[0] - p[0], q[1] - p[1]) < LADO_MINIMO_PARA_O_MEIO) return null;
          const m = meioDoLado(pontos, i);
          return (
            <button
              key={`meio-${i}`}
              type="button"
              data-meio={i}
              aria-label={`Criar um ponto entre o ${i + 1} e o ${((i + 1) % pontos.length) + 1}`}
              title="Arraste para criar um ponto aqui"
              onPointerDown={(ev) => aoPressionarNoMeio(ev, i)}
              onClick={(ev) => {
                if (ev.detail === 0) criarPontoPeloTeclado(i);
              }}
              className="group absolute grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 cursor-copy place-items-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
              style={{ left: pc(m[0]), top: pc(m[1]) }}
            >
              <span className="block h-2.5 w-2.5 rounded-full border border-white/90 bg-black/50 transition-transform group-hover:scale-125" />
            </button>
          );
        })}

      {/* Os pontos do contorno. */}
      {editavel &&
        pontos.map(([x, y], i) => (
          <button
            key={`ponto-${i}`}
            type="button"
            data-ponto={i}
            aria-pressed={ativo === i}
            aria-label={
              `Ponto ${i + 1} de ${pontos.length}: a ${Math.round(x * 100)}% da esquerda e ${Math.round(y * 100)}% do topo. ` +
              `As setas movem${pontos.length > 3 ? '; Delete tira' : ''}.`
            }
            onPointerDown={(ev) => aoPressionarNoPonto(ev, i)}
            onFocus={() => aoAtivar(i)}
            onKeyDown={(ev) => aoTeclarNoPonto(ev, i)}
            className={`absolute grid h-7 w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-white ${
              arrastando ? 'cursor-grabbing' : 'cursor-grab'
            }`}
            style={{ left: pc(x), top: pc(y) }}
          >
            <span
              className={`block rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(4_8_14/0.6)] transition-[width,height] ${
                ativo === i ? 'h-[18px] w-[18px]' : 'h-3.5 w-3.5'
              }`}
              style={{ background: traco }}
            />
          </button>
        ))}
    </div>
  );
}

/**
 * O nome da área, colado no canto do retângulo que a envolve — por fora, em
 * cima. Área que encosta no topo do quadro não tem "em cima": ali a etiqueta
 * vai por dentro, senão seria cortada.
 */
function Etiqueta({ cor, dentro, children }: { cor: string; dentro: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`pointer-events-none absolute -left-0.5 top-0 max-w-[calc(100%+4px)] truncate px-[7px] py-0.5 text-[11px] font-semibold text-[#1B1403] ${
        dentro ? 'rounded-br-[5px]' : '-translate-y-full rounded-t-[5px]'
      }`}
      style={{ background: cor }}
    >
      {children}
    </span>
  );
}
