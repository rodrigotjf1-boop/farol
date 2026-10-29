// =====================================================================
// A planta com vida (Ao vivo, 29/10/2026): a cor de cada lugar e a cara de cada equipamento
// =====================================================================
// Do protótipo aprovado pelo dono ("onde é chapa ou fritadeira, o inox, o
// salão… setorizar com cores"). Um lugar só para as duas vistas: a de cima
// (`ao-vivo-planta.tsx`) e a 3D (`ao-vivo-3d.tsx`), para a chapa ter a mesma
// cor nas duas.
//
// A cor do lugar é token (`--lugar-*` em `globals.css`), porque aparece
// também na legenda e no "Por setor". As do equipamento ficam aqui: só
// existem dentro da cena, que é sempre escura.
// =====================================================================

import type { TipoDeAmbiente, TipoDeMovel } from '@/lib/planta';

export const corDoLugar = (t: TipoDeAmbiente): string => `rgb(var(--lugar-${t}))`;

/** Quanto da cor do lugar vai no chão (o resto é o piso da cena): forte a ponto de separar, fraco a ponto de não brigar com as pessoas. */
export const FORCA_DO_CHAO = 0.24;

/**
 * O equipamento visto de cima: o fundo, e a tinta do nome por cima dele (`clara` = `--cena-tinta`, `escura` =
 * `--sobre-rotulo`). Cada par medido acima de 4,5:1 (`verificar` da tela confere).
 */
export const DE_CIMA: Record<TipoDeMovel, { fundo: string; tinta: 'clara' | 'escura' }> = {
  chapa: { fundo: '#4a3a33', tinta: 'clara' },
  fritadeira: { fundo: '#5e4d24', tinta: 'clara' },
  geladeira: { fundo: '#d9e2ea', tinta: 'escura' },
  bancada: { fundo: '#b9c3cd', tinta: 'escura' },
  pia: { fundo: '#a8b4c0', tinta: 'escura' },
  estufa: { fundo: '#5f5236', tinta: 'clara' },
  prateleira: { fundo: '#4f5d6e', tinta: 'clara' },
  balcao: { fundo: '#2a2d33', tinta: 'clara' },
  caixa: { fundo: '#2a2d33', tinta: 'clara' },
  totem: { fundo: '#1f2630', tinta: 'clara' },
  mesa: { fundo: '#7a4f2c', tinta: 'clara' },
  cabine: { fundo: '#7f3524', tinta: 'clara' },
  banco: { fundo: '#8f3a27', tinta: 'clara' },
  estrutura: { fundo: '#565c64', tinta: 'clara' },
};

/** As cores dos materiais do 3D (aço, chapa, óleo, vidro, madeira, couro, granito, concreto, tela). */
export const MATERIAL = {
  inox: 0xd3dae2,
  inoxEscuro: 0x9aa5b1,
  chapa: 0x1a1a1c,
  brasa: 0xff7a2f,
  oleo: 0xe0a91f,
  oleoBrilho: 0x5a3a00,
  cuba: 0x23262b,
  branco: 0xeef2f5,
  vidro: 0x9fd3ff,
  madeira: 0x8a5a33,
  couro: 0xa8452f,
  granito: 0x24262b,
  frente: 0x3a3f47,
  concreto: 0x737a84,
  tela: 0x3da5ff,
  preto: 0x15171a,
  luz: 0xffb347,
} as const;

/** A cor do material para o SVG da vista de cima. */
export const emCss = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
