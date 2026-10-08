// As vistas de "Canais": a lista de câmeras, a planta da loja e o inventário de equipamentos.

import { List, Map, Package } from 'lucide-react';

import type { Aba } from '@/componentes/ui/abas';

export const abasDeCanais = (lojaId: string): Aba[] => [
  { href: `/lojas/${lojaId}/canais`, rotulo: 'Lista', icone: List },
  { href: `/lojas/${lojaId}/canais/planta`, rotulo: 'Planta', icone: Map },
  { href: `/lojas/${lojaId}/canais/inventario`, rotulo: 'Inventário', icone: Package },
];
