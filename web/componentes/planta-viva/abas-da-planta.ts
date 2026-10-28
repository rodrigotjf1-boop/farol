// As vistas da Planta (em Canais): o desenho (A16) e a planta viva (A26) — o que cada câmera cobre, a calibração pelos
// pontos do piso, o movimento e o movimento ao vivo.

import { Crosshair, Footprints, PencilRuler, Radio, ScanEye } from 'lucide-react';

import type { Aba } from '@/componentes/ui/abas';

export const abasDaPlanta = (lojaId: string): Aba[] => [
  { href: `/lojas/${lojaId}/canais/planta`, rotulo: 'Desenho', icone: PencilRuler },
  { href: `/lojas/${lojaId}/canais/planta/cobertura`, rotulo: 'O que cada câmera cobre', icone: ScanEye },
  { href: `/lojas/${lojaId}/canais/planta/calibrar`, rotulo: 'Calibrar câmera', icone: Crosshair },
  { href: `/lojas/${lojaId}/canais/planta/movimento`, rotulo: 'Movimento', icone: Footprints },
  { href: `/lojas/${lojaId}/canais/planta/ao-vivo`, rotulo: 'Ao vivo', icone: Radio },
];
