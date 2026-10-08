// As opções de um critério, com o texto que explica cada uma na tela.

import {
  Activity,
  Clock,
  Hash,
  Layers,
  ListOrdered,
  Moon,
  RefreshCw,
  ScanSearch,
  Store,
  UserRoundCheck,
  type LucideIcon,
} from 'lucide-react';

import { juntarDias } from '@/componentes/horario/semana';
import type { FaixaDeHorario, ParametrosDoDetector, Porteiro, Quando, Regra } from '@/lib/api';

export const TIPOS: ReadonlyArray<{ valor: Regra['tipo']; titulo: string; ajuda: string; icone: LucideIcon }> = [
  { valor: 'estado', titulo: 'Estado', ajuda: 'limpeza, organização, uso de touca e luva', icone: ScanSearch },
  { valor: 'presenca', titulo: 'Presença', ajuda: 'tem alguém, ou algo, na área', icone: UserRoundCheck },
  { valor: 'contagem', titulo: 'Contagem', ajuda: 'quantas pessoas, fila, ocupação', icone: Hash },
  { valor: 'comparacao', titulo: 'Comparação', ajuda: 'compara com um padrão guardado', icone: Layers },
  { valor: 'acao', titulo: 'Ação', ajuda: 'sequência com etapas; custa bem mais', icone: ListOrdered },
];

export const iconeDoTipo = (v: string): LucideIcon => TIPOS.find((t) => t.valor === v)?.icone ?? ScanSearch;

/** Em que horário o critério é conferido, em relação ao horário DA LOJA. */
export const QUANDOS: ReadonlyArray<{ valor: Quando; titulo: string; ajuda: string; icone: LucideIcon }> = [
  { valor: 'no_horario', titulo: 'No horário', ajuda: 'só com a loja aberta', icone: Store },
  { valor: 'fora_do_horario', titulo: 'Fora do horário', ajuda: 'só com a loja fechada', icone: Moon },
  { valor: 'sempre', titulo: 'Sempre', ajuda: 'aberta ou fechada', icone: Clock },
];

/**
 * Quando vale a pena conferir. Quem responde é o detector, dentro da loja,
 * antes de a imagem ir para a nuvem.
 */
export const PORTEIROS: ReadonlyArray<{ valor: Porteiro; titulo: string; ajuda: string; icone: LucideIcon }> = [
  { valor: 'sempre', titulo: 'Em toda olhada', ajuda: 'mesmo sem ninguém na imagem', icone: RefreshCw },
  { valor: 'pessoa', titulo: 'Com pessoa na área', ajuda: 'uniforme, touca, uso de equipamento', icone: UserRoundCheck },
  { valor: 'livre', titulo: 'Com a área livre', ajuda: 'limpeza e organização: gente na frente esconde', icone: ScanSearch },
  { valor: 'movimento', titulo: 'Quando algo se mexe', ajuda: 'ação: sem movimento não há o que julgar', icone: Activity },
];

/**
 * As opções de "quando vale a pena conferir" que cabem naquele tipo. É a
 * MESMA regra do servidor (`porteiroNaoCabe`, em api/src/rotas/regras.ts):
 * presença e contagem já são julgadas na loja em toda olhada, e "quando
 * algo se mexe" é de critério de ação. Lista vazia = o tipo não tem a escolha.
 */
export function porteirosDoTipo(tipo: string): ReadonlyArray<(typeof PORTEIROS)[number]> {
  if (TIPOS_DO_DETECTOR.includes(tipo)) return [];
  return PORTEIROS.filter((p) => p.valor !== 'movimento' || tipo === 'acao');
}

// "Em toda olhada" é o comum e não leva etiqueta; o que foge dele, leva.
const ETIQUETA_DO_PORTEIRO: Record<string, string> = {
  pessoa: 'só com pessoa na área',
  livre: 'só com a área livre',
  movimento: 'só quando algo se mexe',
};

/** A etiqueta do critério na lista — ou `null` quando ele pergunta em toda olhada. */
export function etiquetaDoPorteiro(regra: Pick<Regra, 'tipo' | 'porteiro'>): string | null {
  if (!porteirosDoTipo(regra.tipo).some((p) => p.valor === regra.porteiro)) return null;
  return ETIQUETA_DO_PORTEIRO[regra.porteiro] ?? null;
}

/**
 * O critério de comparação está num canal sem foto padrão: cadastrado, e
 * não conferido ali. A mesma regra do agente (`JuizDoPadrao.atende`): sem
 * foto no canal, o critério fica de fora dizendo que falta a foto.
 * Sem `pontoId` (a lista "Sem canal"), não há canal de que falar.
 */
export function faltaAFotoPadrao(regra: Pick<Regra, 'tipo' | 'alvos'>, pontoId: string | undefined): boolean {
  if (regra.tipo !== 'comparacao' || !pontoId) return false;
  const noCanal = regra.alvos.find((a) => a.ponto_id === pontoId);
  // Resposta de API antiga não traz a contagem: sem saber, não acusa.
  return noCanal !== undefined && noCanal.ponto_padroes === 0;
}

/** O critério de estado leva a foto padrão do canal à nuvem. Nos outros tipos a escolha não existe. */
export const mandaAFotoPadrao = (regra: Pick<Regra, 'tipo' | 'com_padrao'>): boolean =>
  regra.tipo === 'estado' && regra.com_padrao === true;

/** Em quantas olhadas seguidas fora do critério ele avisa. */
export const CONFIRMACOES: ReadonlyArray<{ v: number; r: string }> = [
  { v: 1, r: 'na primeira olhada fora do critério' },
  { v: 2, r: 'por 2 olhadas seguidas' },
  { v: 3, r: 'por 3 olhadas seguidas' },
  { v: 5, r: 'por 5 olhadas seguidas' },
];

const TODOS_OS_DIAS = [1, 2, 3, 4, 5, 6, 7];

/**
 * A faixa de horas do critério, do jeito que a gaveta sabe editar: UMA
 * faixa, valendo todos os dias. `null` = sem faixa. `'detalhada'` = há
 * faixas que a gaveta não edita (dias diferentes, ou mais de uma) — elas
 * continuam valendo até alguém trocá-las.
 */
export function faixaSimples(janelas: FaixaDeHorario[] | undefined): { de: string; ate: string } | 'detalhada' | null {
  if (!janelas || janelas.length === 0) return null;
  const [f] = janelas;
  if (!f || janelas.length > 1 || TODOS_OS_DIAS.some((d) => !f.dias.includes(d))) return 'detalhada';
  return { de: f.hora_ini, ate: f.hora_fim };
}

/** A faixa que a gaveta grava: uma só, todos os dias. */
export const faixaDeTodosOsDias = (de: string, ate: string): FaixaDeHorario[] => [
  { dias: TODOS_OS_DIAS, hora_ini: de, hora_fim: ate },
];

/** "das 20:00 às 22:00", ou "seg a sex, 08:00 às 10:00 · sáb, 09:00 às 11:00". `null` = sem faixa. */
export function resumoDaFaixa(janelas: FaixaDeHorario[] | undefined): string | null {
  const simples = faixaSimples(janelas);
  if (simples === null) return null;
  if (simples !== 'detalhada') return `das ${simples.de} às ${simples.ate}`;
  return (janelas ?? []).map((f) => `${juntarDias(f.dias)}, ${f.hora_ini} às ${f.hora_fim}`).join(' · ');
}

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
/** Os ajustes de um critério numa linha: "prioridade intermediária · confiança mínima 0,70 · silêncio de 15 min · versão 3". */
export const ajustesEmLinha = (r: Pick<Regra, 'prioridade' | 'confianca_minima' | 'cooldown_min' | 'criterio_versao'>): string =>
  `prioridade ${nomeDaPrioridade(r.prioridade)} · confiança mínima ${Number(r.confianca_minima).toFixed(2).replace('.', ',')} · silêncio de ${r.cooldown_min} min · versão ${r.criterio_versao}`;
export const nomeDoTipo = (v: string): string =>
  TIPOS.find((t) => t.valor === v)?.titulo.toLowerCase() ?? v;

export const PRIORIDADES: Array<{ v: string; r: string }> = [
  { v: 'leve', r: 'leve — pode esperar horas' },
  { v: 'intermediaria', r: 'intermediária — até 30 s' },
  { v: 'urgente', r: 'urgente — menos de 2 s, só na loja' },
];

/** Os tipos julgados pelo detector local, dentro da loja. */
export const TIPOS_DO_DETECTOR: ReadonlyArray<string> = ['presenca', 'contagem'];

/**
 * O que o detector procura, em uma frase — ou `null` quando o critério
 * ainda não diz. `null` num critério de presença é coisa para a tela
 * mostrar: ele está cadastrado e não tem como ser verificado.
 */
export function resumoDaProcura(p: ParametrosDoDetector | undefined): string | null {
  if (!p?.objeto) return null;
  const minimo = p.minimo ?? 0;
  const maximo = p.maximo ?? null;
  if (maximo === 0) return `não deve haver ${p.objeto}`;
  if (maximo === null) return `pelo menos ${minimo} × ${p.objeto}`;
  if (minimo === 0) return `no máximo ${maximo} × ${p.objeto}`;
  if (minimo === maximo) return `exatamente ${minimo} × ${p.objeto}`;
  return `de ${minimo} a ${maximo} × ${p.objeto}`;
}
