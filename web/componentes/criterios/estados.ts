// =====================================================================
// O estado do critério — observar, ensaiar, medir, avisar
// =====================================================================
// Todo critério passa por quatro estados, e só o último avisa. Ligado ou
// desligado continua sendo outra coisa (`ativa`): o estado diz o que o
// critério LIGADO faz. As regras estão em `api/src/estado.ts`; aqui ficam os
// nomes e as frases, num lugar só.
// =====================================================================

import type { Tom } from '@/componentes/ui/pecas';
import type { EstadoDoCriterio } from '@/lib/api';

export const NOME_DO_ESTADO: Record<EstadoDoCriterio, string> = {
  observando: 'observando',
  ensaio: 'em ensaio',
  medido: 'medido',
  valendo: 'valendo',
};

// O âmbar é de "olhe aqui": o critério em ensaio está julgando, e alguém
// precisa conferir se ele acerta. Verde só no que avisa.
export const TOM_DO_ESTADO: Record<EstadoDoCriterio, Tom> = {
  observando: 'neutro',
  ensaio: 'atencao',
  medido: 'vazado',
  valendo: 'ok',
};

/** O que o critério faz em cada estado, para a segunda linha da lista. */
export const O_QUE_FAZ_NO_ESTADO: Record<EstadoDoCriterio, string> = {
  observando: 'só conta o que acontece, sem julgar',
  ensaio: 'julga e mostra, sem avisar',
  medido: 'julga com o acerto medido, sem avisar',
  valendo: 'avisa',
};

/** Valor desconhecido (API mais nova que a tela) cai no que sempre existiu. */
export const estadoConhecido = (e: string | undefined): EstadoDoCriterio =>
  e === 'observando' || e === 'ensaio' || e === 'medido' ? e : 'valendo';
