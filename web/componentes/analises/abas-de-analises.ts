// As duas vistas de "Análises": o que foi julgado, e o padrão de
// funcionamento que sai disso. `aRever` é quantas saídas do padrão esperam
// a resposta de alguém.

import { ChartColumn, Repeat } from 'lucide-react';

import type { Aba } from '@/componentes/ui/abas';

export const abasDeAnalises = (lojaId: string, aRever?: number): Aba[] => [
  { href: `/lojas/${lojaId}/analises`, rotulo: 'O que foi julgado', icone: ChartColumn },
  { href: `/lojas/${lojaId}/analises/padroes`, rotulo: 'Padrões', icone: Repeat, conta: aRever, oQueConta: 'saídas do padrão para rever' },
];
