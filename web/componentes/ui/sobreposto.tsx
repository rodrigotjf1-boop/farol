'use client';

// =====================================================================
// O que abre POR CIMA da tela: gaveta, diálogo e menu
// =====================================================================
// Criar e editar acontecem numa GAVETA que desliza da direita, com a lista
// à vista atrás. Formulário que abria no topo da página ficava fora da
// vista de quem tinha clicado lá embaixo. No celular a gaveta sobe de
// baixo.
//
// Gaveta e diálogo usam o `<dialog>` do navegador, aberto com
// `showModal()`: ele prende o foco, deixa o resto da página inerte e
// fecha no Esc — três coisas que caixa montada à mão costuma errar.
// =====================================================================

import { X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { Botao, type Variante } from './botao';

function useDialogoAberto(ocupado: boolean, aoFechar: () => void) {
  const ref = useRef<HTMLDialogElement>(null);

  // Efeito de LAYOUT, e não o comum: ao desmontar, o `close()` tem de rodar com o <dialog> ainda na página. É o
  // `close()` que devolve o foco a quem abriu (o botão, a linha da lista); no efeito comum a limpeza roda depois
  // de o React já ter tirado o elemento, e o foco caía na página — quem usa o teclado perdia o lugar.
  useLayoutEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => {
      if (d?.open) d.close();
    };
  }, []);

  const props = {
    ref,
    onCancel: (e: React.SyntheticEvent) => {
      // O Esc fecharia o <dialog> por conta própria, e a tela continuaria
      // achando que ele está aberto.
      e.preventDefault();
      if (!ocupado) aoFechar();
    },
    onClick: (e: React.MouseEvent) => {
      // Clique no fundo escuro: o alvo é o próprio <dialog>.
      if (e.target === ref.current && !ocupado) aoFechar();
    },
  };
  return props;
}

// ───────────────────────── gaveta ─────────────────────────

export function Gaveta({
  titulo,
  descricao,
  children,
  rodape,
  ocupado = false,
  larga = false,
  aoFechar,
}: {
  titulo: string;
  descricao?: ReactNode;
  children: ReactNode;
  /** Os botões, sempre à vista no pé. */
  rodape: ReactNode;
  ocupado?: boolean;
  /** Mais espaço para quem tem abas e uma ficha em duas colunas (a gaveta do critério). */
  larga?: boolean;
  aoFechar: () => void;
}) {
  const id = useId();
  const dialogo = useDialogoAberto(ocupado, aoFechar);

  return (
    <dialog
      {...dialogo}
      aria-labelledby={`${id}-titulo`}
      className={
        `fixed inset-y-0 left-auto right-0 m-0 h-full max-h-none ${larga ? 'w-[min(620px,100%)]' : 'w-[min(480px,100%)]'} max-w-none ` +
        'animate-desliza border-l border-farol-borda bg-farol-painel p-0 shadow-farol-2 ' +
        // No celular: folha que sobe de baixo.
        'max-md:inset-x-0 max-md:bottom-0 max-md:top-auto max-md:h-auto max-md:max-h-[92dvh] max-md:w-full ' +
        'max-md:animate-sobe-folha max-md:rounded-t-[20px] max-md:border-l-0 max-md:border-t'
      }
    >
      <div className="flex h-full max-h-[inherit] flex-col max-md:max-h-[92dvh]">
        <header className="flex items-start gap-3 border-b border-farol-borda px-5 pb-3.5 pt-[18px]">
          <div className="min-w-0 flex-1">
            <h2 id={`${id}-titulo`} className="break-words font-display text-xl font-semibold leading-tight tracking-tight">
              {titulo}
            </h2>
            {descricao && <p className="mt-0.5 text-[13px] text-farol-suave">{descricao}</p>}
          </div>
          <Botao variante="fantasma" mini quadrado aria-label="Fechar" onClick={aoFechar} disabled={ocupado}>
            <X className="h-[18px] w-[18px]" aria-hidden />
          </Botao>
        </header>
        {/* `relative`: o que é `absolute` lá dentro (o texto só para leitor de tela, o rádio por cima do cartão)
            fica preso a esta caixa. Sem isso ele escapa do corte e faz a gaveta INTEIRA rolar — o cabeçalho some. */}
        <div className="relative flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-[18px]">{children}</div>
        <footer className="flex flex-wrap items-center gap-2.5 border-t border-farol-borda bg-farol-painel-2 px-5 py-3.5 pb-[calc(14px+env(safe-area-inset-bottom,0px))]">
          {rodape}
        </footer>
      </div>
    </dialog>
  );
}

// ───────────────────────── diálogo ─────────────────────────

/**
 * A pergunta antes de fazer algo que não se desfaz com um clique.
 *
 * O foco começa no CANCELAR: quem aperta Enter por reflexo não exclui
 * nada sem ter lido.
 */
export function Dialogo({
  titulo,
  children,
  rotuloConfirmar,
  rotuloOcupado = 'Aguarde…',
  variante = 'perigo',
  ocupado = false,
  erro,
  formulario = false,
  aoConfirmar,
  aoCancelar,
}: {
  titulo: string;
  children: ReactNode;
  rotuloConfirmar: string;
  rotuloOcupado?: string;
  variante?: Variante;
  ocupado?: boolean;
  erro?: string | null;
  /** O diálogo pede um dado (um nome, por exemplo): o foco vai para o
   *  campo, e Enter confirma. Sem isto ele é uma pergunta, e o foco
   *  começa no Cancelar. */
  formulario?: boolean;
  aoConfirmar: () => void;
  aoCancelar: () => void;
}) {
  const id = useId();
  const dialogo = useDialogoAberto(ocupado, aoCancelar);

  return (
    <dialog
      {...dialogo}
      aria-labelledby={`${id}-titulo`}
      aria-describedby={`${id}-texto`}
      className="w-[min(460px,calc(100%-2rem))] animate-surge rounded-[18px] border border-farol-borda bg-farol-painel p-0 shadow-farol-2"
    >
      <form
        className="flex flex-col gap-3 p-[22px]"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ocupado) aoConfirmar();
        }}
      >
        <h2 id={`${id}-titulo`} className="break-words font-display text-[19px] font-semibold leading-snug tracking-tight">
          {titulo}
        </h2>
        <div id={`${id}-texto`} className="flex flex-col gap-2.5 text-farol-suave [&_strong]:font-semibold [&_strong]:text-farol-tinta">
          {children}
        </div>
        {erro && (
          <p role="alert" className="rounded-[10px] bg-farol-critico-leve px-3 py-2 text-[13px] text-farol-critico">
            {erro}
          </p>
        )}
        <div className="mt-1.5 flex flex-wrap justify-end gap-2.5">
          <Botao autoFocus={!formulario} onClick={aoCancelar} disabled={ocupado}>
            Cancelar
          </Botao>
          {/* Numa pergunta, o botão de confirmar NÃO é o de envio: Enter no
              Cancelar focado não pode excluir nada. */}
          <Botao
            type={formulario ? 'submit' : 'button'}
            variante={variante}
            onClick={formulario ? undefined : aoConfirmar}
            disabled={ocupado}
          >
            {ocupado ? rotuloOcupado : rotuloConfirmar}
          </Botao>
        </div>
      </form>
    </dialog>
  );
}

// ───────────────────────── menu ─────────────────────────

/**
 * Menu que abre de um botão. Fica em posição FIXA, calculada a partir do
 * botão: assim nenhuma caixa com rolagem o corta, e ele nunca passa da
 * borda da tela.
 *
 * Ele é desenhado FORA de onde o botão está — no fim da página, ou dentro
 * do `<dialog>` aberto, se o botão estiver em um. Posição fixa só é
 * "fixa na tela" enquanto nenhum ancestral tem `transform`: bastou a
 * seção do setor entrar com animação para o menu do canal abrir 290 px
 * para o lado e ficar ATRÁS dos cartões do setor de baixo.
 */
export function Menu({
  gatilho,
  children,
  alinhar = 'inicio',
}: {
  /** O botão que abre. Recebe o que precisa para se ligar ao menu. */
  gatilho: (props: {
    ref: React.RefObject<HTMLButtonElement | null>;
    onClick: () => void;
    'aria-haspopup': 'menu';
    'aria-expanded': boolean;
  }) => ReactNode;
  /** Os itens. Recebem `fechar` para chamar depois de agir. */
  children: (fechar: () => void) => ReactNode;
  alinhar?: 'inicio' | 'fim';
}) {
  const [aberto, setAberto] = useState(false);
  const [lugar, setLugar] = useState<{ left: number; top: number; origem: string } | null>(null);
  const [onde, setOnde] = useState<Element | null>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const caixa = useRef<HTMLDivElement>(null);

  const abrir = () => {
    // Dentro de um <dialog> modal, só o que está NELE fica por cima.
    setOnde(botao.current?.closest('dialog') ?? document.body);
    setAberto(true);
  };

  const fechar = (devolverFoco = false) => {
    setAberto(false);
    setLugar(null);
    if (devolverFoco) botao.current?.focus();
  };

  useLayoutEffect(() => {
    if (!aberto || !botao.current || !caixa.current) return;
    const b = botao.current.getBoundingClientRect();
    const largura = caixa.current.offsetWidth;
    const altura = caixa.current.offsetHeight;
    let left = alinhar === 'fim' ? b.right - largura : b.left;
    if (left + largura > window.innerWidth - 8) left = b.right - largura;
    left = Math.min(Math.max(8, left), window.innerWidth - largura - 8);
    let top = b.bottom + 6;
    const paraCima = top + altura > window.innerHeight - 8;
    if (paraCima) top = Math.max(8, b.top - altura - 6);
    setLugar({ left, top, origem: `${b.left + b.width / 2 - left}px ${paraCima ? '100%' : '0'}` });
    caixa.current.querySelector<HTMLElement>('button, a')?.focus({ preventScroll: true });
  }, [aberto, alinhar]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => {
      const alvo = e.target as Node;
      if (!caixa.current?.contains(alvo) && !botao.current?.contains(alvo)) fechar();
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        fechar(true);
        return;
      }
      // O menu mora fora da ordem da página: o Tab sairia dele para lugar
      // nenhum. Ele fecha e o foco volta ao botão, de onde o Tab segue.
      if (e.key === 'Tab') {
        fechar(true);
        return;
      }
      const itens = [...(caixa.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a') ?? [])];
      if (itens.length === 0) return;
      const atual = itens.indexOf(document.activeElement as HTMLElement);
      let proximo = -1;
      if (e.key === 'ArrowDown') proximo = (atual + 1) % itens.length;
      if (e.key === 'ArrowUp') proximo = (atual - 1 + itens.length) % itens.length;
      if (e.key === 'Home') proximo = 0;
      if (e.key === 'End') proximo = itens.length - 1;
      if (proximo >= 0) {
        e.preventDefault();
        itens[proximo]!.focus({ preventScroll: true });
      }
    };
    const some = () => fechar();
    document.addEventListener('pointerdown', fora);
    document.addEventListener('keydown', tecla, true);
    window.addEventListener('resize', some);
    window.addEventListener('scroll', some, true);
    return () => {
      document.removeEventListener('pointerdown', fora);
      document.removeEventListener('keydown', tecla, true);
      window.removeEventListener('resize', some);
      window.removeEventListener('scroll', some, true);
    };
  }, [aberto]);

  return (
    <>
      {gatilho({
        ref: botao,
        onClick: () => (aberto ? fechar() : abrir()),
        'aria-haspopup': 'menu',
        'aria-expanded': aberto,
      })}
      {aberto &&
        onde &&
        createPortal(
          <div
            ref={caixa}
            role="menu"
            style={{
              left: lugar?.left ?? 0,
              top: lugar?.top ?? 0,
              transformOrigin: lugar?.origem,
              visibility: lugar ? 'visible' : 'hidden',
            }}
            className="fixed z-[75] min-w-[190px] animate-surge rounded-xl border border-farol-borda bg-farol-painel p-[5px] text-farol-tinta shadow-farol-2"
          >
            {/* Escolher um item devolve o foco ao botão do menu: a gaveta (ou o diálogo) que o item abrir guarda
                esse botão como "quem abriu", e é para ele que o foco volta quando ela fechar. Sem isso o item
                sumia com o foco, e fechar a gaveta largava quem usa o teclado no começo da página. */}
            {children(() => fechar(true))}
          </div>,
          onde,
        )}
    </>
  );
}

/** A classe de um item de menu — botão ou link. */
export const ITEM_DE_MENU =
  'flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left font-medium no-underline ' +
  'hover:bg-farol-realce focus-visible:bg-farol-realce max-md:min-h-11';

export function RotuloDeMenu({ children }: { children: ReactNode }) {
  return <p className="px-2.5 pb-0.5 pt-1.5 text-[11.5px] font-semibold text-farol-suave">{children}</p>;
}

export function DivisorDeMenu() {
  return <hr className="my-[5px] border-0 border-t border-farol-borda" />;
}
