// As vistas de "Canais": a lista de câmeras, a planta da loja e o inventário de equipamentos.

import { List, Map, Package } from 'lucide-react';

import type { Aba } from '@/componentes/ui/abas';

export const abasDeCanais = (lojaId: string): Aba[] => [
  { href: `/lojas/${lojaId}/canais`, rotulo: 'Lista', icone: List },
  // a planta tem as vistas dela embaixo (a planta viva, A26): a aba fica marcada nelas também
  { href: `/lojas/${lojaId}/canais/planta`, rotulo: 'Planta', icone: Map, incluiFilhas: true },
  { href: `/lojas/${lojaId}/canais/inventario`, rotulo: 'Inventário', icone: Package },
];
