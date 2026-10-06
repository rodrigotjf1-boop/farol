// Ícones da árvore. Desenhados à mão e pequenos de propósito: são três, e
// uma biblioteca inteira para isso pesaria mais que a tela.
//
// Todos são decorativos (`aria-hidden`): o texto ao lado já diz o que é.

type Props = { className?: string };

const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

/** A seta de abrir e recolher. Gira em vez de trocar de desenho. */
export function Seta({ aberta }: { aberta: boolean }) {
  return (
    <svg {...base} className={`shrink-0 transition-transform ${aberta ? 'rotate-90' : ''}`}>
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}

export function Pasta({ className = '' }: Props) {
  return (
    <svg {...base} className={`shrink-0 ${className}`}>
      <path d="M1.8 4.2c0-.7.5-1.2 1.2-1.2h3l1.4 1.6H13c.7 0 1.2.5 1.2 1.2v6c0 .7-.5 1.2-1.2 1.2H3c-.7 0-1.2-.5-1.2-1.2z" />
    </svg>
  );
}

export function Camera({ className = '' }: Props) {
  return (
    <svg {...base} className={`shrink-0 ${className}`}>
      <rect x="1.8" y="4.5" width="9" height="7" rx="1.2" />
      <path d="m10.8 7 3.4-1.8v5.6L10.8 9" />
    </svg>
  );
}

export function Arquivo({ className = '' }: Props) {
  return (
    <svg {...base} className={`shrink-0 ${className}`}>
      <path d="M4 1.8h5l3 3v8.4c0 .6-.4 1-1 1H4c-.6 0-1-.4-1-1v-10.4c0-.6.4-1 1-1z" />
      <path d="M9 1.8v3h3" />
    </svg>
  );
}
