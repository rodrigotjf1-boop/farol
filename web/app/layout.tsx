import type { Metadata, Viewport } from 'next';

// As fontes vêm do pacote, não do Google em tempo de execução: o console
// não faz pedido a terceiro para desenhar a própria tela, e a montagem da
// imagem não depende de mais uma rede estar de pé.
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/figtree';
import '@fontsource-variable/jetbrains-mono';

import './globals.css';

import { ProvedorDeAvisos } from '@/componentes/ui/avisos';

export const metadata: Metadata = {
  title: 'Farol — monitor de operação',
  description: 'Auditoria de processo operacional por visão computacional',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', sizes: 'any' },
    ],
    apple: '/icone-192.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F2F5F9' },
    { media: '(prefers-color-scheme: dark)', color: '#0A111B' },
  ],
};

// Roda ANTES de a página ser desenhada: quem escolheu um tema não pode ver
// o outro piscar a cada carregamento. A escolha fica no navegador porque é
// preferência de quem olha, não dado da loja.
const TEMA_ANTES_DE_PINTAR = `
try {
  var t = localStorage.getItem('farol-tema');
  if (t === 'claro' || t === 'escuro') document.documentElement.dataset.tema = t;
} catch (e) {}
`;

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    // `suppressHydrationWarning` só no <html>: o atributo `data-tema` é
    // posto pelo script acima, antes de o React assumir.
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: TEMA_ANTES_DE_PINTAR }} />
      </head>
      <body>
        <ProvedorDeAvisos>{children}</ProvedorDeAvisos>
      </body>
    </html>
  );
}
