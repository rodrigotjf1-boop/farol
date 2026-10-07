// Como o orçamento fala com quem lê: os nomes e o dinheiro.

import type { Tom } from '@/componentes/ui/pecas';
import type { Carga, FaixaDePreco, Importancia, Nivel } from '@/lib/api';

export const NOME_DO_NIVEL: Record<Nivel, string> = {
  basico: 'Básico',
  intermediario: 'Intermediário',
  avancado: 'Avançado',
};

export const NOME_DA_CARGA: Record<Carga, string> = {
  sem_uso: 'sem uso',
  leve: 'uso leve',
  moderada: 'uso moderado',
  intensa: 'uso intenso',
};

/** O tom da carga segue o peso: quanto mais usado, mais chama. */
export const TOM_DA_CARGA: Record<Carga, Tom> = {
  sem_uso: 'neutro',
  leve: 'ok',
  moderada: 'atencao',
  intensa: 'critico',
};

export const NOME_DA_IMPORTANCIA: Record<Importancia, string> = {
  critico: 'crítica',
  normal: 'normal',
  baixo: 'baixa',
};

export const NOME_DO_USO: Record<string, string> = {
  presenca: 'presença',
  contagem: 'contagem',
  comparacao: 'comparação',
  estado: 'estado',
  acao: 'ação',
};

export const NOME_DO_PAPEL: Record<string, string> = {
  camera: 'Câmera',
  gravador: 'Gravador',
  computador: 'Computador',
  placa_de_video: 'Placa de vídeo',
};

const reais = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});

export function dinheiro(valor: number): string {
  return reais.format(valor);
}

/** "R$ 535" ou "R$ 900 a R$ 1.200". */
export function faixa(f: { min: number; max: number }): string {
  return f.min === f.max ? dinheiro(f.min) : `${dinheiro(f.min)} a ${dinheiro(f.max)}`;
}

const CONFIANCA: Record<string, string> = {
  confirmado: 'preço conferido',
  indice: 'preço de busca',
  estimado: 'faixa de mercado',
};

/** "faixa de mercado, ago/2026" — preço sem data é preço errado esperando a hora. */
export function origemDoPreco(f: FaixaDePreco): string {
  const [ano, mes] = f.cotadoEm.split('-');
  const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${CONFIANCA[f.confianca] ?? f.confianca}, ${meses[Number(mes) - 1] ?? mes}/${ano}`;
}
