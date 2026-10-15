// =====================================================================
// A gravação de treino: criar, cancelar, apagar as imagens e o andamento
// =====================================================================
// A21, fatia T3 (migration 050). Do protótipo aprovado pelo dono em
// 15/10/2026 (`mockups/farol-conexoes-e-fichas.html`, "Nova gravação de
// treino"):
//
//   • DO QUE O GRAVADOR JÁ GUARDOU: o horário já terminou e começou há no
//     máximo 18 horas — o que o gravador desta loja guarda (medido em
//     13/10/2026: perto de 17 horas; o protótipo diz "cerca de 18");
//   • PROGRAMADA: um horário que ainda vai começar. O gravador grava sempre:
//     o computador da loja busca o trecho nele depois que o horário termina;
//   • de 15 minutos a 1 hora;
//   • quem cria, cancela e apaga é quem configura a loja (decisão 3);
//   • a loja conta o andamento: lendo (com a porcentagem), pronta, ou
//     falhou (com o motivo, que a tela mostra).
//
// As datas chegam com o fuso escrito (o console monta no relógio da loja):
// sem ele, "19:30" viraria a hora do servidor.
// =====================================================================

import { DIAS_DOS_QUADROS } from './treino.js';

export const GRAVACAO = {
  minimoMin: 15,
  maximoMin: 60,
  /** O que o gravador desta loja guarda, com folga (medido em 13/10/2026: perto de 17 horas). */
  gravadorGuardaH: 18,
  /** Até quando se programa: uma semana. */
  programarAteDias: 7,
} as const;

export const DE_ONDE = ['gravador', 'programada'] as const;
export type DeOnde = (typeof DE_ONDE)[number];

/** As situações em que a loja ainda tem trabalho com a gravação (e em que ela se cancela). */
export const ATIVAS = ['programada', 'fila', 'lendo'] as const;
/** O que a loja conta da gravação. */
export const ANDAMENTOS = ['lendo', 'pronta', 'falhou'] as const;
export type Andamento = (typeof ANDAMENTOS)[number];
export const MAX_MOTIVO = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Data e hora COM o fuso escrito ("…-03:00" ou "…Z"). */
const comFuso = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= 40 && /(?:[+-]\d{2}:\d{2}|Z)$/.test(v) && !Number.isNaN(Date.parse(v));

export type NovaGravacao = { pontoId: string; de: DeOnde; inicio: Date; fim: Date };

/** O pedido de gravação, conferido com as regras do protótipo. As frases são as que a tela mostra. */
export function lerNovaGravacao(corpo: unknown, agora: Date): NovaGravacao | { problema: string } {
  const c = (corpo ?? {}) as Record<string, unknown>;
  if (typeof c.pontoId !== 'string' || !UUID.test(c.pontoId)) return { problema: 'escolha a bancada (o canal)' };
  if (!DE_ONDE.includes(c.de as DeOnde)) return { problema: 'escolha de onde vem: do que o gravador já guardou, ou programar' };
  if (!comFuso(c.inicio) || !comFuso(c.fim)) return { problema: 'preencha o dia e os dois horários' };
  const inicio = new Date(c.inicio);
  const fim = new Date(c.fim);
  const minutos = (fim.getTime() - inicio.getTime()) / 60_000;
  if (!(minutos > 0)) return { problema: 'o fim precisa ser depois do começo' };
  if (minutos < GRAVACAO.minimoMin || minutos > GRAVACAO.maximoMin) return { problema: 'uma gravação de treino vai de 15 minutos a 1 hora' };
  if (c.de === 'gravador') {
    if (fim.getTime() > agora.getTime()) return { problema: 'este horário ainda não terminou: escolha “Programar”' };
    if (agora.getTime() - inicio.getTime() > GRAVACAO.gravadorGuardaH * 3600_000) {
      return { problema: 'o gravador não guarda mais este horário: ele guarda cerca de 18 horas' };
    }
  } else {
    if (inicio.getTime() < agora.getTime()) return { problema: 'este horário já começou: escolha “Do que o gravador já guardou”' };
    if (inicio.getTime() - agora.getTime() > GRAVACAO.programarAteDias * 86_400_000) return { problema: 'programe com até 7 dias de antecedência' };
  }
  return { pontoId: c.pontoId, de: c.de as DeOnde, inicio, fim };
}

export type AndamentoLido = { situacao: Andamento; progresso: number | null; motivo: string | null };

/** O que a loja conta: lendo (com a porcentagem, se souber), pronta, ou falhou (com o motivo). */
export function lerAndamento(corpo: unknown): AndamentoLido | { problema: string } {
  const c = (corpo ?? {}) as Record<string, unknown>;
  if (!ANDAMENTOS.includes(c.situacao as Andamento)) return { problema: `situacao: ${ANDAMENTOS.join(', ')}` };
  const situacao = c.situacao as Andamento;
  let progresso: number | null = null;
  if (c.progresso !== undefined && c.progresso !== null) {
    if (!Number.isInteger(c.progresso) || (c.progresso as number) < 0 || (c.progresso as number) > 100) return { problema: 'progresso: de 0 a 100' };
    progresso = c.progresso as number;
  }
  let motivo: string | null = null;
  if (situacao === 'falhou') {
    if (typeof c.motivo !== 'string' || !c.motivo.trim() || c.motivo.length > MAX_MOTIVO) return { problema: `motivo: por que falhou, em até ${MAX_MOTIVO} letras` };
    motivo = c.motivo.trim();
  }
  if (situacao === 'pronta') progresso = 100;
  return { situacao, progresso, motivo };
}

/**
 * A loja só conta andamento de gravação que ainda é dela: programada, na fila ou lendo. Cancelada (alguém desistiu no
 * console), apagada, pronta e falhou não voltam a ser lidas — a loja para.
 */
export function aindaEDaLoja(atual: string): boolean {
  return (ATIVAS as readonly string[]).includes(atual);
}

/**
 * A gravação que a loja já pode apagar do computador dela: cancelada, apagada, que falhou — ou pronta, com todos os
 * lanches conferidos há mais de 30 dias (a mesma regra dos quadros na nuvem).
 */
export const SQL_DO_QUE_A_LOJA_APAGA = `
  g.situacao in ('cancelada', 'apagada', 'falhou')
  or (g.situacao = 'pronta'
      and exists (select 1 from treino_lanche l where l.gravacao_id = g.id)
      and not exists (select 1 from treino_lanche l
                       where l.gravacao_id = g.id
                         and (l.conferido_em is null or l.conferido_em >= now() - make_interval(days => ${DIAS_DOS_QUADROS}))))`;
