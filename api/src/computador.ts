// =====================================================================
// O horário do computador da loja (A22)
// =====================================================================
// O pedido do dono (15/10/2026): "uma forma do servidor ser programado para
// desligar e ligar preenchendo um horário, a desligada e a ligada". E o
// horário dele (16/10/2026): "adormecer servidor 1 hora após [fechar] e
// ligar 1 hora antes [de abrir]".
//
// "Dormir" é entrar em espera; "acordar" é uma tarefa agendada que o liga.
// Quem aplica é o agente (fatia P3), no relógio do computador da loja. Aqui
// fica a conta, sem banco: quem salva confere, a tela desenha a semana, e o
// vigia do "agente sem sinal" pergunta se o silêncio é o sono programado.
//
// Formato (`loja.horario_computador`; nulo = nunca programado):
//
//   { ligado: true,
//     dias: [{ dia: 1, dorme: '04:00', acorda: '18:00' }, …,
//            { dia: 7, dorme: '06:45', acorda: '18:00' }] }
//
//   dia: 1 = segunda … 7 = domingo, como o horário da loja. `dorme` e
//   `acorda` no relógio da loja, ou nulo (nada naquele dia). O estado de cada
//   instante é o do último acontecimento antes dele, dando a volta na
//   semana: na segunda sem "acorda", ele dorme e só acorda no "acorda"
//   seguinte.
//
// A semana se conta em MINUTOS desde segunda 00:00 (0 a 10.079), e todo
// trecho é [início, fim) — o minuto do fim já não conta.
// =====================================================================

import { type Faixa, relogioDaLoja } from './horario.js';

export type DiaDoComputador = { dia: number; dorme: string | null; acorda: string | null };
export type HorarioDoComputador = { ligado: boolean; dias: DiaDoComputador[] };
export type Trecho = [number, number];

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const DIA = 1440;
export const SEMANA = 7 * DIA;

/** A folga da sugestão: dorme 1 hora depois de fechar e acorda 1 hora antes de abrir (o dono, 16/10/2026). */
export const FOLGA_DA_SUGESTAO_MIN = 60;
/** A sugestão não manda dormir por menos que isto (a loja que fecha à tarde e reabre à noite fica acordada). */
export const SONO_MINIMO_MIN = 60;
/** Depois do "acorda", o silêncio ainda é o computador acordando: ele leva ~40 s, e o vigia espera 5 min. */
export const FOLGA_PARA_ACORDAR_MIN = 10;
/** A última batida até isto antes do "dorme" ainda é ele indo dormir; mais cedo, ele caiu antes da hora. */
export const FOLGA_ANTES_DE_DORMIR_MIN = 10;
/** A palavra que o agente declara quando sabe dormir e acordar sozinho (`agente.sabe`; entra com a fatia P3). */
export const SABE_DORMIR = 'dormir';

const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
export const hora = (m: number) => {
  const x = ((m % DIA) + DIA) % DIA;
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
};
const naSemana = (m: number) => ((m % SEMANA) + SEMANA) % SEMANA;

/**
 * Confere e normaliza o que veio do console: os sete dias, cada um uma vez, com as horas em HH:MM ou vazias. Devolve o
 * horário limpo (os dias de segunda a domingo) ou a frase do problema.
 */
export function lerHorarioDoComputador(bruto: unknown): { horario?: HorarioDoComputador; problema?: string } {
  if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) {
    return { problema: 'horário: {ligado, dias}' };
  }
  const { ligado, dias } = bruto as Record<string, unknown>;
  if (typeof ligado !== 'boolean') return { problema: 'ligado: verdadeiro ou falso' };
  if (!Array.isArray(dias) || dias.length !== 7) {
    return { problema: 'dias: os sete dias da semana, de segunda (1) a domingo (7)' };
  }
  const porDia = new Map<number, DiaDoComputador>();
  for (const [i, d] of dias.entries()) {
    const onde = `dias[${i}]`;
    if (typeof d !== 'object' || d === null || Array.isArray(d)) return { problema: `${onde}: {dia, dorme, acorda}` };
    const { dia, dorme, acorda } = d as Record<string, unknown>;
    if (typeof dia !== 'number' || !Number.isInteger(dia) || dia < 1 || dia > 7) {
      return { problema: `${onde}: dia de 1 (segunda) a 7 (domingo)` };
    }
    if (porDia.has(dia)) return { problema: `${onde}: o dia ${dia} veio duas vezes` };
    const limpo = (v: unknown): string | null | undefined => {
      if (v === null || v === undefined || v === '') return null;
      return typeof v === 'string' && HORA.test(v) ? v : undefined;
    };
    const dormeLimpo = limpo(dorme);
    const acordaLimpo = limpo(acorda);
    if (dormeLimpo === undefined) return { problema: `${onde}: dorme no formato HH:MM, ou vazio` };
    if (acordaLimpo === undefined) return { problema: `${onde}: acorda no formato HH:MM, ou vazio` };
    if (dormeLimpo !== null && dormeLimpo === acordaLimpo) {
      return { problema: `${onde}: dormir e acordar na mesma hora não diz nada` };
    }
    porDia.set(dia, { dia, dorme: dormeLimpo, acorda: acordaLimpo });
  }
  return { horario: { ligado, dias: [1, 2, 3, 4, 5, 6, 7].map((d) => porDia.get(d)!) } };
}

type Acontecimento = { t: number; tipo: 'dorme' | 'acorda' };

function acontecimentos(h: HorarioDoComputador): Acontecimento[] {
  const saida: Acontecimento[] = [];
  for (const d of h.dias) {
    const base = (d.dia - 1) * DIA;
    if (d.dorme) saida.push({ t: base + minutos(d.dorme), tipo: 'dorme' });
    if (d.acorda) saida.push({ t: base + minutos(d.acorda), tipo: 'acorda' });
  }
  return saida.sort((a, b) => a.t - b.t);
}

/** Os trechos da semana em que ele dorme, em minutos desde segunda 00:00, sem dar a volta (o que passa de domingo é
 * partido em dois). Desligado, ou sem nenhum "dorme": nenhum. */
export function trechosDormindo(h: HorarioDoComputador | null | undefined): Trecho[] {
  if (!h || !h.ligado) return [];
  const ev = acontecimentos(h);
  if (!ev.some((e) => e.tipo === 'dorme')) return [];
  if (!ev.some((e) => e.tipo === 'acorda')) return [[0, SEMANA]];
  // O estado de segunda 00:00 é o do último acontecimento da semana (ela dá a volta).
  let dormindo = ev[ev.length - 1]!.tipo === 'dorme';
  let inicio = 0;
  const saida: Trecho[] = [];
  for (const e of ev) {
    if (e.tipo === 'dorme' && !dormindo) {
      dormindo = true;
      inicio = e.t;
    } else if (e.tipo === 'acorda' && dormindo) {
      if (e.t > inicio) saida.push([inicio, e.t]);
      dormindo = false;
    }
  }
  if (dormindo) saida.push([inicio, SEMANA]);
  return saida;
}

/** Os trechos da semana com a loja aberta, pelo horário de funcionamento (o minuto de fechar ainda é aberto, como em
 * `faixaContem`). Sem horário, a loja vale como sempre aberta. */
export function trechosAberta(faixas: Faixa[] | null | undefined): Trecho[] {
  if (!faixas || faixas.length === 0) return [[0, SEMANA]];
  const brutos: Trecho[] = [];
  for (const f of faixas) {
    for (const dia of f.dias) {
      const ini = (dia - 1) * DIA + minutos(f.hora_ini);
      const fim = (f.hora_fim > f.hora_ini ? (dia - 1) * DIA : dia * DIA) + minutos(f.hora_fim) + 1;
      if (fim <= SEMANA) brutos.push([ini, fim]);
      else brutos.push([ini, SEMANA], [0, fim - SEMANA]);
    }
  }
  return juntar(brutos);
}

function juntar(trechos: Trecho[]): Trecho[] {
  const ordem = [...trechos].sort((a, b) => a[0] - b[0]);
  const saida: Trecho[] = [];
  for (const t of ordem) {
    const ultimo = saida[saida.length - 1];
    if (ultimo && t[0] <= ultimo[1]) ultimo[1] = Math.max(ultimo[1], t[1]);
    else saida.push([t[0], t[1]]);
  }
  return saida;
}

function cruzar(a: Trecho[], b: Trecho[]): Trecho[] {
  const saida: Trecho[] = [];
  for (const x of a) {
    for (const y of b) {
      const ini = Math.max(x[0], y[0]);
      const fim = Math.min(x[1], y[1]);
      if (fim > ini) saida.push([ini, fim]);
    }
  }
  return juntar(saida);
}

/** Os trechos em que ele dormiria com a loja aberta. Vazio = pode salvar. */
export function choques(h: HorarioDoComputador | null | undefined, faixas: Faixa[] | null | undefined): Trecho[] {
  return cruzar(trechosDormindo(h), trechosAberta(faixas));
}

export type DiaDesenhado = { dia: number; dormindo: Trecho[]; aberta: Trecho[]; choques: Trecho[] };

/** A semana para a tela desenhar: de cada dia, os trechos em minutos DO DIA (0 a 1440). */
export function semanaDesenhada(h: HorarioDoComputador | null | undefined, faixas: Faixa[] | null | undefined): DiaDesenhado[] {
  const porDia = (trechos: Trecho[], dia: number): Trecho[] => {
    const base = (dia - 1) * DIA;
    return cruzar(trechos, [[base, base + DIA]]).map(([i, f]) => [i - base, f - base] as Trecho);
  };
  const dormindo = trechosDormindo(h);
  const aberta = faixas && faixas.length ? trechosAberta(faixas) : [];
  const choque = choques(h, faixas);
  return [1, 2, 3, 4, 5, 6, 7].map((dia) => ({
    dia,
    dormindo: porDia(dormindo, dia),
    aberta: porDia(aberta, dia),
    choques: porDia(choque, dia),
  }));
}

/**
 * A sugestão pelo horário da loja: em cada trecho com ela fechada, dorme `folga` minutos depois de fechar e acorda
 * `folga` minutos antes de abrir — se sobrar ao menos `SONO_MINIMO_MIN` de sono. Sem horário da loja, não há o que
 * sugerir (nulo).
 */
export function sugestao(faixas: Faixa[] | null | undefined, folga = FOLGA_DA_SUGESTAO_MIN): HorarioDoComputador | null {
  if (!faixas || faixas.length === 0) return null;
  const aberta = trechosAberta(faixas);
  // Os trechos FECHADA, dando a volta na semana: do fim de um aberto ao começo do próximo.
  const fechada: Trecho[] = [];
  for (let i = 0; i < aberta.length; i++) {
    const fecha = aberta[i]![1];
    const proximo = aberta[(i + 1) % aberta.length]![0] + (i + 1 === aberta.length ? SEMANA : 0);
    if (proximo > fecha) fechada.push([fecha, proximo]);
  }
  const dias: DiaDoComputador[] = [1, 2, 3, 4, 5, 6, 7].map((dia) => ({ dia, dorme: null, acorda: null }));
  const sonoDoDia = new Map<number, number>();
  for (const [fecha, abre] of fechada) {
    // `fecha` é o minuto depois do último aberto: o fechamento é `fecha - 1`.
    const dorme = fecha - 1 + folga;
    const acorda = abre - folga;
    if (acorda - dorme < SONO_MINIMO_MIN) continue;
    const diaDorme = Math.floor(naSemana(dorme) / DIA) + 1;
    const diaAcorda = Math.floor(naSemana(acorda) / DIA) + 1;
    // Um "dorme" por dia: se dois trechos fechados caem no mesmo dia, fica o do sono mais longo.
    if ((sonoDoDia.get(diaDorme) ?? -1) >= acorda - dorme) continue;
    sonoDoDia.set(diaDorme, acorda - dorme);
    dias[diaDorme - 1]!.dorme = hora(dorme);
    dias[diaAcorda - 1]!.acorda = hora(acorda);
  }
  return { ligado: true, dias };
}

/** O minuto da semana daquele instante, no relógio da loja. */
export function minutoDaSemana(instante: Date, fuso: string): number {
  const { dia, hora: h } = relogioDaLoja(instante, fuso);
  return (dia - 1) * DIA + minutos(h);
}

export type SituacaoDoComputador = {
  /** No horário de dormir agora (a conta pura do horário: no minuto do "acorda" ele já está acordado). */
  dormindo_agora: boolean;
  /** Quando dormiu e quando acorda (HH:MM no relógio da loja) — do trecho de agora, ou do último que passou. */
  dormiu_as: string | null;
  acorda_as: string | null;
};

/** O trecho de sono em que o instante cai (até `folga` minutos depois do "acorda"), ou o último que já passou. */
function trechoDeAgora(h: HorarioDoComputador | null | undefined, m: number, folga = 0) {
  const trechos = trechosDormindo(h);
  if (trechos.length === 0) return null;
  // Junta o que foi partido no fim da semana (domingo → segunda) num trecho só, dando a volta.
  const inteiros: Trecho[] = [];
  for (const t of trechos) inteiros.push([t[0], t[1]]);
  const primeiro = inteiros[0]!;
  const ultimo = inteiros[inteiros.length - 1]!;
  if (inteiros.length > 1 && primeiro[0] === 0 && ultimo[1] === SEMANA) {
    inteiros.shift();
    ultimo[1] = SEMANA + primeiro[1];
  }
  // Agora "dentro" de um trecho (com a folga); o minuto pode estar uma semana à frente do começo.
  for (const [ini, fim] of inteiros) {
    for (const x of [m, m + SEMANA]) {
      if (x >= ini && x < fim + folga) return { ini, fim, dentro: true, desde: x - ini };
    }
  }
  // Fora de todos: o último que acabou antes de agora.
  let melhor: { ini: number; fim: number; desde: number } | null = null;
  for (const [ini, fim] of inteiros) {
    for (const x of [m, m + SEMANA]) {
      if (x >= fim + folga && (melhor === null || x - ini < melhor.desde)) melhor = { ini, fim, desde: x - ini };
    }
  }
  return melhor ? { ...melhor, dentro: false } : null;
}

/** O horário diz que ele dorme agora? A conta do horário puro (a do contrato): no minuto do "acorda" ele já está acordado. */
export function situacaoDoComputador(h: HorarioDoComputador | null | undefined, instante: Date, fuso: string): SituacaoDoComputador {
  const t = trechoDeAgora(h, minutoDaSemana(instante, fuso));
  if (!t) return { dormindo_agora: false, dormiu_as: null, acorda_as: null };
  return { dormindo_agora: t.dentro, dormiu_as: hora(t.ini), acorda_as: hora(t.fim) };
}

export type SilencioDoAgente = {
  /** O agente está calado porque dorme no horário: o console mostra "dormindo" e o aviso de sem sinal não sai. */
  dormindo: boolean;
  /** Dormiu no horário e não voltou depois do "acorda" (com a folga): o aviso volta, e a tela diz a hora. */
  nao_acordou: boolean;
  acorda_as: string | null;
};

/**
 * O silêncio do agente é o sono programado? Só quando:
 *   · o horário está ligado e o agente DECLARA que sabe dormir (o pacote antigo fica ligado o tempo todo, e o
 *     silêncio dele é queda de verdade);
 *   · agora cai num trecho de dormir (até `FOLGA_PARA_ACORDAR_MIN` depois do "acorda");
 *   · e ele bateu até `FOLGA_ANTES_DE_DORMIR_MIN` antes do "dorme" — calado desde mais cedo, ele caiu antes da hora.
 */
export function silencioDoAgente(args: {
  horario: HorarioDoComputador | null | undefined;
  fuso: string;
  sabe: readonly string[] | null | undefined;
  ultimaBatida: Date | null | undefined;
  agora: Date;
}): SilencioDoAgente {
  const nada: SilencioDoAgente = { dormindo: false, nao_acordou: false, acorda_as: null };
  const { horario, fuso, sabe, ultimaBatida, agora } = args;
  if (!horario?.ligado || !ultimaBatida || !(sabe ?? []).includes(SABE_DORMIR)) return nada;
  const t = trechoDeAgora(horario, minutoDaSemana(agora, fuso), FOLGA_PARA_ACORDAR_MIN);
  if (!t) return nada;
  const dormiuEm = agora.getTime() - t.desde * 60_000;
  const acordaEm = dormiuEm + (t.fim - t.ini) * 60_000;
  const foiDormir = ultimaBatida.getTime() >= dormiuEm - FOLGA_ANTES_DE_DORMIR_MIN * 60_000;
  if (!foiDormir) return nada;
  if (t.dentro) return { dormindo: true, nao_acordou: false, acorda_as: hora(t.fim) };
  // Passou do "acorda" (e da folga) e não bateu desde então.
  return ultimaBatida.getTime() < acordaEm ? { dormindo: false, nao_acordou: true, acorda_as: hora(t.fim) } : nada;
}

export type ComputadorDaLoja = { ligado: boolean } & SilencioDoAgente;

/**
 * O que a moldura do console mostra do computador da loja, ao lado do "agente ativo / sem sinal": nulo quando o
 * horário nunca foi programado. `agente` é o que bateu por último (a batida pode vir como texto, de dentro de JSON).
 */
export function computadorDaLoja(
  horario: HorarioDoComputador | null | undefined,
  fuso: string,
  agente: { batida: Date | string | null; sabe: string[] | null } | null | undefined,
  agora: Date,
): ComputadorDaLoja | null {
  if (!horario) return null;
  const batida = agente?.batida ? new Date(agente.batida) : null;
  return { ligado: horario.ligado, ...silencioDoAgente({ horario, fuso, sabe: agente?.sabe, ultimaBatida: batida, agora }) };
}
