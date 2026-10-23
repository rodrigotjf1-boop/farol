// O botão, igual em toda tela.
//
// Quem age é a chapa (`primario`: carvão no papel, papel na chapa). A
// mostarda NÃO é cor de botão: ela fica para "olhe aqui". Vermelho
// (ketchup) só em ação que tira ou apaga. Caminho "Comanda": pílula, letra
// da placa de cardápio e uma mola no toque.

import { LoaderCircle } from 'lucide-react';
import type { ComponentProps } from 'react';

export type Variante = 'primario' | 'secundario' | 'fantasma' | 'perigo' | 'perigo-leve';

const BASE =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full border border-transparent ' +
  'font-display text-[15px] font-extrabold uppercase leading-none tracking-[.05em] no-underline ' +
  'transition duration-300 ease-mola hover:scale-[1.03] active:scale-[.96] ' +
  'disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:scale-100';

const DA_VARIANTE: Record<Variante, string> = {
  primario: 'bg-farol-marca text-farol-sobre-marca hover:opacity-90',
  secundario: 'border-farol-borda-forte bg-farol-painel text-farol-tinta hover:border-farol-marca',
  fantasma: 'text-farol-suave hover:bg-farol-realce hover:text-farol-tinta',
  perigo: 'bg-farol-critico text-farol-sobre-critico hover:opacity-90',
  'perigo-leve': 'text-farol-critico hover:bg-farol-critico-leve',
};

type Forma = { variante?: Variante; mini?: boolean; quadrado?: boolean };

/** As classes do botão, para dar a mesma cara a um `<Link>`. */
export function classesDoBotao({ variante = 'secundario', mini = false, quadrado = false }: Forma = {}): string {
  // No celular o alvo cresce para 44 px: dedo não é ponteiro.
  const altura = mini ? 'min-h-8 max-md:min-h-9' : 'min-h-[38px] max-md:min-h-11';
  const largura = quadrado ? (mini ? 'w-8 max-md:w-9 px-0' : 'w-[38px] max-md:w-11 px-0') : mini ? 'px-2.5' : 'px-3.5';
  return `${BASE} ${DA_VARIANTE[variante]} ${altura} ${largura}`;
}

// `ComponentProps<'button'>` inclui o `ref`: o menu precisa dele para se
// posicionar a partir do botão que o abriu.
type Props = ComponentProps<'button'> & Forma & {
  /** A ação está acontecendo: trava o botão e mostra que está trabalhando. */
  ocupado?: boolean;
};

export function Botao({
  variante,
  mini,
  quadrado,
  ocupado = false,
  className = '',
  children,
  disabled,
  type = 'button',
  ...resto
}: Props) {
  return (
    <button
      type={type}
      disabled={disabled || ocupado}
      aria-busy={ocupado || undefined}
      className={`${classesDoBotao({ variante, mini, quadrado })} ${className}`}
      {...resto}
    >
      {ocupado && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}
