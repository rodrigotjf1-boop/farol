// As opções de um critério, com o texto que explica cada uma na tela.

import type { Regra } from '@/lib/api';

export const TIPOS: Array<{ v: Regra['tipo']; r: string; ajuda: string }> = [
  { v: 'estado', r: 'Estado', ajuda: 'um quadro responde: EPI, limpeza, organização' },
  { v: 'presenca', r: 'Presença', ajuda: 'tem alguém na zona neste horário' },
  { v: 'contagem', r: 'Contagem', ajuda: 'quantas pessoas, fila, ocupação' },
  { v: 'comparacao', r: 'Comparação', ajuda: 'compara com um padrão guardado' },
  { v: 'acao', r: 'Ação', ajuda: 'sequência com etapas — custa bem mais' },
];

export const SEVERIDADES = ['info', 'atencao', 'critico', 'emergencia'] as const;

// O banco guarda sem acento (`atencao`, `critico`); a tela escreve em
// português. Valor desconhecido aparece como veio, em vez de sumir.
const NOME_DA_SEVERIDADE: Record<string, string> = {
  info: 'informativo',
  atencao: 'atenção',
  critico: 'crítico',
  emergencia: 'emergência',
};
const NOME_DA_PRIORIDADE: Record<string, string> = {
  leve: 'leve',
  intermediaria: 'intermediária',
  urgente: 'urgente',
};

export const nomeDaSeveridade = (v: string): string => NOME_DA_SEVERIDADE[v] ?? v;
export const nomeDaPrioridade = (v: string): string => NOME_DA_PRIORIDADE[v] ?? v;
export const nomeDoTipo = (v: string): string =>
  TIPOS.find((t) => t.v === v)?.r.toLowerCase() ?? v;

export const PRIORIDADES: Array<{ v: string; r: string }> = [
  { v: 'leve', r: 'Leve — pode esperar horas' },
  { v: 'intermediaria', r: 'Intermediária — até 30 s' },
  { v: 'urgente', r: 'Urgente — menos de 2 s, só local' },
];

/** A mesma classe de campo do resto do console. */
export const campo = 'w-full rounded-lg border border-farol-borda bg-farol-fundo px-3 py-2 text-sm';
export const rotulo = 'block text-xs font-medium text-farol-suave';
