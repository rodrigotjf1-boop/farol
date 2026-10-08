// As vistas de "Canais": a lista de câmeras e o inventário de equipamentos.
// (A planta entra aqui quando existir.)

import { List, Package } from 'lucide-react';

import type { Aba } from '@/componentes/ui/abas';

export const abasDeCanais = (lojaId: string): Aba[] => [
  { href: `/lojas/${lojaId}/canais`, rotulo: 'Lista', icone: List },
  { href: `/lojas/${lojaId}/canais/inventario`, rotulo: 'Inventário', icone: Package },
];
