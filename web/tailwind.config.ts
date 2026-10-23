import type { Config } from 'tailwindcss';

// Cada cor é uma variável definida em `globals.css`, com um valor no tema
// claro e outro no escuro. Aqui só se dá nome a elas.
//
// O formato `rgb(var(--x) / <alpha-value>)` é o que mantém `bg-farol-ok/15`
// funcionando: a variável guarda os três canais, e o Tailwind põe a
// opacidade.
const cor = (nome: string) => `rgb(var(--${nome}) / <alpha-value>)`;

export default {
  content: ['./app/**/*.{ts,tsx}', './componentes/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Identidade do Farol, tirada do kit de marca: o azul-marinho do
        // logotipo é quem age (botão principal); o âmbar do facho aparece
        // só onde é para olhar — item ativo, foco, atenção. Verde e
        // vermelho ficam para resultado. Se a interface inteira gritar,
        // nada grita.
        farol: {
          fundo: cor('fundo'),
          painel: cor('painel'),
          'painel-2': cor('painel-2'),
          realce: cor('realce'),
          borda: cor('borda'),
          'borda-forte': cor('borda-forte'),
          tinta: cor('tinta'),
          suave: cor('suave'),
          marca: cor('marca'),
          'sobre-marca': cor('sobre-marca'),
          facho: cor('facho'),
          'facho-tinta': cor('facho-tinta'),
          'facho-icone': cor('facho-icone'),
          'facho-leve': cor('facho-leve'),
          ok: cor('ok'),
          'ok-leve': cor('ok-leve'),
          critico: cor('critico'),
          'critico-leve': cor('critico-leve'),
          'sobre-critico': cor('sobre-critico'),
          'graf-ok': cor('graf-ok'),
          'graf-na': cor('graf-na'),
          palco: cor('palco'),
          'palco-tinta': cor('palco-tinta'),
          'palco-suave': cor('palco-suave'),
          // As cores do lanche, cheias: os blocos grandes de número do caminho "Comanda".
          ketchup: cor('ketchup'),
          mostarda: cor('mostarda'),
          'sobre-mostarda': cor('sobre-mostarda'),
          picles: cor('picles'),
          pao: cor('pao'),
        },
      },
      fontFamily: {
        sans: ['"Hanken Grotesk Variable"', '"Hanken Grotesk"', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
        // A letra da placa de cardápio: alta e estreita. Os títulos vão em maiúsculas (ver `Cabecalho` e `Titulo`).
        display: ['"Big Shoulders Display Variable"', '"Big Shoulders Display"', '"Arial Narrow"', 'Impact', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', '"JetBrains Mono"', 'ui-monospace', '"Cascadia Mono"', 'Consolas', 'monospace'],
      },
      boxShadow: {
        'farol-1': 'var(--sombra-1)',
        'farol-2': 'var(--sombra-2)',
      },
      transitionTimingFunction: {
        farol: 'cubic-bezier(.2, .8, .2, 1)',
        // A mola do caminho "Comanda": passa um pouco do ponto e volta.
        mola: 'cubic-bezier(.34, 1.56, .64, 1)',
      },
      keyframes: {
        sobe: { from: { opacity: '0', transform: 'translateY(10px)' }, to: { opacity: '1', transform: 'none' } },
        aparece: { from: { opacity: '0' }, to: { opacity: '1' } },
        desliza: { from: { transform: 'translateX(100%)' }, to: { transform: 'none' } },
        'sobe-folha': { from: { transform: 'translateY(100%)' }, to: { transform: 'none' } },
        surge: { from: { opacity: '0', transform: 'scale(.96)' }, to: { opacity: '1', transform: 'none' } },
        cresce: { from: { transform: 'scaleY(0)' }, to: { transform: 'none' } },
        varre: { '0%, 100%': { transform: 'rotate(-16deg)' }, '50%': { transform: 'rotate(16deg)' } },
        pulso: { '0%, 100%': { opacity: '1' }, '50%': { opacity: '.4' } },
        onda: {
          '0%': { boxShadow: '0 0 0 0 rgb(var(--ok) / .55)' },
          '70%, 100%': { boxShadow: '0 0 0 8px rgb(var(--ok) / 0)' },
        },
        brilho: { from: { backgroundPosition: '100% 0' }, to: { backgroundPosition: '0 0' } },
      },
      animation: {
        // As de ENTRADA usam `backwards`, não `both`: elas terminam no estado
        // natural do elemento. Com `both` o navegador segura para sempre um
        // `transform` identidade — e isso basta para o elemento virar a
        // referência de todo `position: fixed` que estiver dentro dele.
        sobe: 'sobe 340ms cubic-bezier(.2, .8, .2, 1) backwards',
        aparece: 'aparece 220ms backwards',
        desliza: 'desliza 340ms cubic-bezier(.2, .8, .2, 1) backwards',
        'sobe-folha': 'sobe-folha 340ms cubic-bezier(.2, .8, .2, 1) backwards',
        surge: 'surge 220ms cubic-bezier(.2, .8, .2, 1) backwards',
        cresce: 'cresce 340ms cubic-bezier(.2, .8, .2, 1) backwards',
        varre: 'varre 7s ease-in-out infinite',
        pulso: 'pulso 2s ease-in-out infinite',
        onda: 'onda 2.4s ease-out infinite',
        brilho: 'brilho 1.4s ease-in-out infinite',
        'gira-lento': 'spin 14s linear infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
