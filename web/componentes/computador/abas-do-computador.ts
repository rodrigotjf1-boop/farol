// As vistas de "Computador da loja": a saúde (A26) e o horário em que ele dorme e acorda (A22).

import { Activity, Moon } from 'lucide-react';

import type { Aba } from '@/componentes/ui/abas';

export const abasDoComputador = (lojaId: string): Aba[] => [
  { href: `/lojas/${lojaId}/computador`, rotulo: 'Saúde', icone: Activity },
  { href: `/lojas/${lojaId}/computador/horario`, rotulo: 'Horário', icone: Moon },
];
