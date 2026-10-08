'use client';

// A foto de um equipamento, enchendo a caixa em que está.
//
// A foto que veio do quadro de um canal é guardada INTEIRA, com o desenho da
// área daquele instante. Aqui se mostra só o retângulo em volta do desenho —
// é o equipamento, não a cozinha toda. A foto enviada aparece como veio.
//
// É um desenho (`svg`) e não uma `img` porque o recorte é uma janela sobre a
// imagem: a janela é a `viewBox`, e o navegador faz a conta de encher a caixa
// sem deformar, seja qual for a proporção das duas.

import { inventarioApi, type FotoDoEquipamento as Foto } from '@/lib/api';

/** O retângulo em volta do desenho, em fração do quadro — ou o quadro inteiro. */
export function caixaDoRecorte(recorte: Foto['recorte']): { x: number; y: number; w: number; h: number } {
  const inteiro = { x: 0, y: 0, w: 1, h: 1 };
  if (!recorte || recorte.length < 3) return inteiro;
  const xs = recorte.map((p) => p[0]);
  const ys = recorte.map((p) => p[1]);
  const x = Math.max(0, Math.min(...xs));
  const y = Math.max(0, Math.min(...ys));
  const w = Math.min(1, Math.max(...xs)) - x;
  const h = Math.min(1, Math.max(...ys)) - y;
  return w > 0.005 && h > 0.005 ? { x, y, w, h } : inteiro;
}

export function FotoDoEquipamento({ foto, alt, className = '' }: { foto: Foto; alt: string; className?: string }) {
  const c = caixaDoRecorte(foto.origem === 'canal' ? foto.recorte : null);
  // Só a proporção importa: a imagem é esticada para esta caixa, e a janela é medida nela.
  const largura = foto.largura && foto.largura > 0 ? foto.largura : 1600;
  const altura = foto.altura && foto.altura > 0 ? foto.altura : 900;
  const janela = [c.x * largura, c.y * altura, c.w * largura, c.h * altura].map((v) => Math.round(v * 100) / 100).join(' ');

  return (
    <svg
      role="img"
      aria-label={alt}
      viewBox={janela}
      preserveAspectRatio="xMidYMid slice"
      data-foto-do-equipamento={foto.origem}
      className={`block h-full w-full ${className}`}
    >
      <image href={inventarioApi.urlDaFoto(foto.id)} x={0} y={0} width={largura} height={altura} preserveAspectRatio="none" />
    </svg>
  );
}
