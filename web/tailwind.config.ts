import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './componentes/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Identidade do Farol: fundo escuro de sala de monitoramento, e o
        // âmbar do facho como cor de ação. Vermelho fica reservado para
        // alerta de verdade — se a interface inteira gritar, nada grita.
        farol: {
          fundo: '#0B1016',
          painel: '#131A23',
          borda: '#1F2A36',
          tinta: '#E6EDF3',
          suave: '#8B9AAB',
          facho: '#E2A340',
          ok: '#2EA06A',
          atencao: '#D99A2B',
          critico: '#D1495B',
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
