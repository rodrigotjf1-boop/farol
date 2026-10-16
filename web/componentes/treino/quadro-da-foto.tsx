'use client';

// =====================================================================
// Uma foto do lanche, maior — por cima da gaveta do lanche
// =====================================================================
// A21, pedido do dono em 15/10/2026: "ter a opção de ver a foto por
// completo para melhor análise". A miniatura da foto (com `object-cover`)
// mostra só o meio do recorte; aqui ele aparece inteiro (`object-contain`),
// maior. Do protótipo aprovado no mesmo dia (`mockups/farol-conexoes-e-
// fichas.html`, tela Treinamento) — e, desde a conferência nova (também de
// 15/10), ele passa as FOTOS do lanche, não as etapas:
//
//   • abre por cima da gaveta, sem fechá-la: é outro `<dialog>` modal, e o
//     navegador deixa a gaveta inerte atrás;
//   • Anterior e Próxima, as setas do teclado e arrastar o quadro para o
//     lado passam as fotos; o leitor de tela ouve a foto nova;
//   • Esc, o X ou um clique fora fecham SÓ o quadro. O `cancel` do
//     <dialog> de dentro sobe pela árvore do React até o `onCancel` da
//     gaveta: sem o `stopPropagation`, o Esc fecharia as duas (ERR-128);
//   • ao fechar, o foco volta para a miniatura da foto que estava à vista
//     (quem faz isso é a gaveta, que sabe qual é).
// =====================================================================

import { ChevronLeft, ChevronRight, ImageOff, X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

import { Botao } from '@/componentes/ui/botao';
import { AJUDA } from '@/componentes/ui/campo';
import { Chip } from '@/componentes/ui/pecas';
import { treinoApi } from '@/lib/api';

/** Uma foto como o quadro maior a mostra — os textos já prontos, os mesmos do cartão da foto na gaveta. */
export type FotoNoQuadro = {
  quadroId: string | null;
  /** "19:37:15", no relógio da loja. */
  hora: string;
  /** "tampo", "pão aberto · já estava". */
  lado: string;
  /** O que a leitura da loja disse na foto ("pão, molho laranja"), ou "nada". */
  leu: string;
  /** Quando uma leitura ficou entre nomes (a cor não separa dois molhos): os nomes possíveis, já escritos. */
  podeSer: string | null;
  /** O que a pessoa já disse da foto ("Pão gergelim, Cheddar cremoso", "não dá para analisar"), ou nada. */
  disse: string | null;
};

// O arrasto que passa a foto: andar de lado mais que isto, e bem mais de lado do que para cima ou para baixo.
const ARRASTO_PX = 40;

export function QuadroDaFoto({
  fotos,
  indice,
  aoIr,
  aoFechar,
}: {
  fotos: FotoNoQuadro[];
  indice: number;
  aoIr: (i: number) => void;
  aoFechar: () => void;
}) {
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const antes = useRef<HTMLButtonElement>(null);
  const depois = useRef<HTMLButtonElement>(null);
  const passarFoco = useRef<HTMLButtonElement | null>(null);
  const arrasto = useRef<{ x: number; y: number } | null>(null);
  const arrastou = useRef(false);
  const [anuncio, setAnuncio] = useState('');
  const f = fotos[indice]!;
  const total = fotos.length;

  // Efeito de LAYOUT, como em `ui/sobreposto`: ao desmontar, o `close()` roda com o <dialog> ainda na página.
  useLayoutEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    // O foco no próprio quadro: o leitor de tela lê o título e o que o Farol leu; as setas já passam as fotos.
    d?.focus();
    return () => {
      if (d?.open) d.close();
    };
  }, []);

  // O botão que chegou ao fim da fila (a primeira ou a última foto) se desliga, e o foco cairia na página: ele passa
  // para o outro.
  useEffect(() => {
    if (passarFoco.current) {
      passarFoco.current.focus();
      passarFoco.current = null;
    }
  }, [indice]);

  const ir = (i: number) => {
    if (i < 0 || i >= total || i === indice) return;
    const ativo = document.activeElement;
    if (i === 0 && ativo === antes.current) passarFoco.current = depois.current;
    else if (i === total - 1 && ativo === depois.current) passarFoco.current = antes.current;
    aoIr(i);
    const n = fotos[i]!;
    setAnuncio(`Foto ${i + 1} de ${total}, às ${n.hora}, ${n.lado}: o Farol leu ${n.leu}.`);
  };

  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      aria-labelledby={`${id}-titulo`}
      aria-describedby={`${id}-texto`}
      data-quadro-da-foto
      className="max-h-[calc(100dvh-2rem)] w-[min(640px,calc(100%-2rem))] animate-surge overflow-y-auto rounded-[18px] border border-farol-borda bg-farol-painel p-0 shadow-farol-2 outline-none focus-visible:ring-0"
      onCancel={(ev) => {
        // O Esc fecha só o quadro: a gaveta do lanche continua aberta atrás.
        ev.preventDefault();
        ev.stopPropagation();
        aoFechar();
      }}
      onClose={(ev) => {
        ev.stopPropagation();
        // Fechado pelo navegador por conta própria (sem o `cancel`): a tela acompanha. O `close` que nós mesmos pedimos
        // chega DEPOIS, e não conta: ao desmontar, o quadro já saiu da página; no ensaio duplo do modo estrito (em
        // desenvolvimento o React monta, desmonta e monta de novo), ele já está aberto outra vez — e fechá-lo aqui
        // fazia o quadro sumir no mesmo instante em que abria.
        const d = ref.current;
        if (d && d.isConnected && !d.open) aoFechar();
      }}
      onClick={(ev) => {
        // O clique que termina um arrasto não fecha nada, mesmo que o dedo (ou o mouse) tenha saído do quadro.
        if (arrastou.current) {
          arrastou.current = false;
          return;
        }
        // Clique no fundo escuro: o alvo é o próprio <dialog>.
        if (ev.target === ref.current) aoFechar();
      }}
      onKeyDown={(ev) => {
        if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
          ev.preventDefault();
          ir(indice + (ev.key === 'ArrowRight' ? 1 : -1));
        }
      }}
    >
      <div className="flex flex-col gap-3 p-4 sm:p-5">
        <header className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id={`${id}-titulo`} className="break-words font-display text-[19px] font-semibold leading-snug tracking-tight">
              Foto das {f.hora}
            </h2>
            <p id={`${id}-texto`} className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] text-farol-suave">
              <span>
                {f.lado} · o Farol leu <b className="font-semibold text-farol-tinta">{f.leu}</b>
              </span>
              {f.podeSer && <span className="text-xs">{f.podeSer}</span>}
              {f.disse && (
                <Chip tom="atencao" quebra>
                  você disse: {f.disse}
                </Chip>
              )}
            </p>
          </div>
          <Botao variante="fantasma" mini quadrado aria-label="Fechar a foto" onClick={aoFechar}>
            <X className="h-[18px] w-[18px]" aria-hidden />
          </Botao>
        </header>

        {/* A foto inteira, na proporção dela, sobre o "palco" (o fundo das imagens de câmera do console). Em tela
            baixa ela encolhe sem cortar; `touch-pan-y` deixa o arrasto de lado para cá, e o de pé para a rolagem.
            A imagem ocupa a caixa (`absolute inset-0`) e o `object-contain` a encaixa: com `max-h-full` numa grade, a
            porcentagem não segurava a altura, e o quadro em pé passava da caixa (medido em 320–480 px e em tela baixa). */}
        <div
          className="relative aspect-[16/10] max-h-[min(460px,max(120px,calc(100dvh-260px)))] w-full touch-pan-y select-none overflow-hidden rounded-xl bg-farol-palco"
          data-quadro-inteiro
          onPointerDown={(ev) => {
            arrasto.current = { x: ev.clientX, y: ev.clientY };
          }}
          onPointerCancel={() => {
            arrasto.current = null;
          }}
          onPointerUp={(ev) => {
            const a = arrasto.current;
            arrasto.current = null;
            if (!a) return;
            const dx = ev.clientX - a.x;
            const dy = ev.clientY - a.y;
            if (Math.abs(dx) > ARRASTO_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
              arrastou.current = true;
              ir(indice + (dx < 0 ? 1 : -1));
            }
          }}
        >
          {f.quadroId ? (
            // eslint-disable-next-line @next/next/no-img-element -- o quadro vem da API, por id, e o navegador já o guardou para a miniatura
            <img
              key={f.quadroId}
              src={treinoApi.urlDoQuadro(f.quadroId)}
              alt={`A foto inteira das ${f.hora} (${f.lado})`}
              draggable={false}
              className="absolute inset-0 h-full w-full object-contain"
            />
          ) : (
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-[13px] text-farol-palco-suave">
              <ImageOff className="h-6 w-6" aria-hidden />
              Esta foto não subiu da loja
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Botao ref={antes} onClick={() => ir(indice - 1)} disabled={indice === 0}>
            <ChevronLeft className="h-4 w-4" aria-hidden />
            Anterior
          </Botao>
          <span className="font-mono text-[12.5px] text-farol-suave">
            {indice + 1} de {total}
          </span>
          <Botao ref={depois} onClick={() => ir(indice + 1)} disabled={indice === total - 1}>
            Próxima
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Botao>
        </div>
        <p className={AJUDA}>A foto inteira, como subiu da loja: a miniatura mostra só o meio dela. Passe as fotos pelas setas ou arrastando a foto para o lado.</p>
        <p className="sr-only" aria-live="polite">
          {anuncio}
        </p>
      </div>
    </dialog>
  );
}
