// =====================================================================
// Análises — a conta que a tela faz, sem tela
// =====================================================================
// A API entrega o MIÚDO: uma célula por dia, hora, critério e área. Tudo o
// que a tela mostra — os números, as barras, as linhas — é recorte e soma
// dessas células, feito aqui. Trocar um filtro não vai ao servidor; só
// trocar o PERÍODO vai.
//
// "Análise" é o que terminou em veredito (conforme, fora do critério ou
// "não deu para avaliar"). Célula só com olhadas — câmera sem cena, cena
// repetida — não entra em nada desta tela.
// =====================================================================

import type { Analises, AvisoDaAnalise, CelulaDeAnalise } from '@/lib/api';

export type Periodo = 'hoje' | 'ontem' | '7d' | 'dia';
export type Onde = 'tudo' | 'loja' | 'nuvem';
export type Vista = 'resultado' | 'onde' | 'custo';

export type Filtros = {
  periodo: Periodo;
  /** O dia escolhido em "Outro dia", AAAA-MM-DD. */
  dia: string;
  /** Das `de` horas (inclusive) às `ate` horas (exclusive): 18 e 22 = 18h, 19h, 20h e 21h. */
  de: number;
  ate: number;
  canal: string;
  criterio: string;
  onde: Onde;
};

export const FILTROS_PADRAO: Omit<Filtros, 'dia'> = {
  periodo: 'hoje',
  de: 0,
  ate: 24,
  canal: '',
  criterio: '',
  onde: 'tudo',
};

// ───────────────────────── os dias ─────────────────────────
// Os dias são TEXTO (AAAA-MM-DD) no calendário da loja. A conta é feita em
// UTC de propósito: passar por `new Date(texto)` no fuso do navegador
// faria o dia andar para trás em quem está a oeste de Greenwich.

const emDias = (dia: string): number => {
  const [a, m, d] = dia.split('-').map(Number) as [number, number, number];
  return Date.UTC(a, m - 1, d) / 86_400_000;
};

/** `dia` menos `n` dias. */
export function diaMenos(dia: string, n: number): string {
  return new Date((emDias(dia) - n) * 86_400_000).toISOString().slice(0, 10);
}

const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** "qua 07/10" — ou "qua 07", quando o mês já está dito em outro lugar. */
export function rotuloDoDia(dia: string, comMes = true): string {
  const semana = SEMANA[new Date(emDias(dia) * 86_400_000).getUTCDay()];
  return `${semana} ${dia.slice(8, 10)}${comMes ? `/${dia.slice(5, 7)}` : ''}`;
}

export const hh = (h: number): string => `${String(h).padStart(2, '0')}h`;

/** O intervalo de dias que o período pede ao servidor. */
export function intervaloDoPeriodo(f: Pick<Filtros, 'periodo' | 'dia'>, hoje: string): { de: string; ate: string } {
  if (f.periodo === 'ontem') return { de: diaMenos(hoje, 1), ate: diaMenos(hoje, 1) };
  if (f.periodo === '7d') return { de: diaMenos(hoje, 6), ate: hoje };
  if (f.periodo === 'dia') return { de: f.dia, ate: f.dia };
  return { de: hoje, ate: hoje };
}

/** Todos os dias de `de` a `ate`, do mais antigo ao mais novo. */
export function diasEntre(de: string, ate: string): string[] {
  const dias: string[] = [];
  for (let d = emDias(de); d <= emDias(ate); d += 1) dias.push(new Date(d * 86_400_000).toISOString().slice(0, 10));
  return dias;
}

// ───────────────────────── o recorte ─────────────────────────

/**
 * De que lado a célula fica quando o filtro é "na loja" ou "na nuvem". Um
 * critério é julgado num lugar só, então quase toda célula é de um lado
 * inteiro; na que tem dos dois (a hora em que o agente trocou de juiz),
 * vale a maioria — assim "na loja" + "na nuvem" dá sempre o total.
 */
export const ladoDaCelula = (c: CelulaDeAnalise): 'loja' | 'nuvem' => (c.naNuvem > c.naLoja ? 'nuvem' : 'loja');

type Menos = 'horas' | 'canal' | '';

/**
 * As células do recorte. `menos` deixa um filtro de fora: o gráfico de
 * horas mostra o dia inteiro (com as horas de fora apagadas), e a lista de
 * canais mostra todos (com o escolhido marcado).
 */
export function recortar(celulas: CelulaDeAnalise[], f: Filtros, menos: Menos = ''): CelulaDeAnalise[] {
  return celulas.filter((c) => {
    if (c.analises <= 0) return false;
    if (menos !== 'horas' && (c.hora < f.de || c.hora >= f.ate)) return false;
    if (menos !== 'canal' && f.canal && c.pontoId !== f.canal) return false;
    if (f.criterio && c.regraId !== f.criterio) return false;
    if (f.onde !== 'tudo' && ladoDaCelula(c) !== f.onde) return false;
    return true;
  });
}

export function recortarAvisos(avisos: AvisoDaAnalise[], f: Filtros): AvisoDaAnalise[] {
  return avisos.filter((a) => {
    if (a.hora < f.de || a.hora >= f.ate) return false;
    if (f.canal && a.pontoId !== f.canal) return false;
    if (f.criterio && a.regraId !== f.criterio) return false;
    if (f.onde !== 'tudo' && a.onde !== f.onde) return false;
    return true;
  });
}

export type Soma = {
  analises: number;
  conformes: number;
  fora: number;
  naoAvaliou: number;
  naLoja: number;
  naNuvem: number;
  avisos: number;
  custoCentavos: number;
  latenciaMs: number;
  comLatencia: number;
};

export function somar(celulas: CelulaDeAnalise[]): Soma {
  const s: Soma = {
    analises: 0, conformes: 0, fora: 0, naoAvaliou: 0, naLoja: 0, naNuvem: 0,
    avisos: 0, custoCentavos: 0, latenciaMs: 0, comLatencia: 0,
  };
  for (const c of celulas) {
    s.analises += c.analises;
    s.conformes += c.conformes;
    s.fora += c.naoConformes;
    s.naoAvaliou += c.naoAvaliaveis;
    s.naLoja += c.naLoja;
    s.naNuvem += c.naNuvem;
    s.avisos += c.alertas;
    s.custoCentavos += c.custoCentavos;
    s.latenciaMs += c.somaLatenciaMs;
    s.comLatencia += c.comLatencia;
  }
  return s;
}

/** Em quantas horas (de dias diferentes contam separadas) houve o que `tem` diz. */
export function horasCom(celulas: CelulaDeAnalise[], tem: (c: CelulaDeAnalise) => boolean = () => true): number {
  return new Set(celulas.filter(tem).map((c) => `${c.dia}-${c.hora}`)).size;
}

// ───────────────────────── as barras ─────────────────────────

export type Balde = {
  /** O que vai escrito embaixo e na dica: "19h" ou "qua 07". */
  rotulo: string;
  /** Com 24 barras, um rótulo a cada três. */
  mostra: boolean;
  /** A hora (gráfico de um dia) ou o dia (gráfico de vários dias). */
  hora?: number;
  dia?: string;
  /** Hora de hoje que ainda não chegou: não há o que mostrar nem escolher. */
  futura: boolean;
  soma: Soma;
};

/**
 * As barras do gráfico. Num dia só, uma por hora — o dia inteiro, mesmo com
 * um intervalo de horas escolhido. Em vários dias, uma por dia, já dentro
 * das horas escolhidas.
 */
export function baldes(dados: Analises, f: Filtros): Balde[] {
  if (dados.de === dados.ate) {
    const doDia = recortar(dados.celulas, f, 'horas');
    return Array.from({ length: 24 }, (_, h) => ({
      rotulo: hh(h),
      mostra: h % 3 === 0,
      hora: h,
      futura: dados.de === dados.hoje && h > dados.horaAgora,
      soma: somar(doDia.filter((c) => c.hora === h)),
    }));
  }
  const noRecorte = recortar(dados.celulas, f);
  return diasEntre(dados.de, dados.ate).map((dia) => ({
    rotulo: rotuloDoDia(dia, false),
    mostra: true,
    dia,
    futura: false,
    soma: somar(noRecorte.filter((c) => c.dia === dia)),
  }));
}

/** O teto do eixo: o primeiro valor "redondo" acima do maior. */
export function tetoRedondo(maior: number, minimo = 10): number {
  if (maior <= 0) return minimo;
  const grandeza = 10 ** Math.floor(Math.log10(maior));
  const passo = grandeza / 5;
  return Math.max(minimo, Math.ceil(maior / passo) * passo);
}

/** Os pedaços de uma barra, de BAIXO para cima, conforme o que o gráfico mostra. */
export function pedacos(s: Soma, vista: Vista): Array<{ cor: string; valor: number }> {
  if (vista === 'onde') {
    return [
      { cor: 'bg-farol-marca', valor: s.naLoja },
      { cor: 'bg-farol-facho', valor: s.naNuvem },
    ];
  }
  if (vista === 'custo') return [{ cor: 'bg-farol-facho', valor: s.custoCentavos }];
  // "Fora do critério" embaixo, encostado na base: as partes vermelhas de
  // todas as barras partem da mesma altura e dá para comparar de relance.
  return [
    { cor: 'bg-farol-critico', valor: s.fora },
    { cor: 'bg-farol-graf-na', valor: s.naoAvaliou },
    { cor: 'bg-farol-graf-ok', valor: s.conformes },
  ];
}

export const tamanho = (s: Soma, vista: Vista): number => (vista === 'custo' ? s.custoCentavos : s.analises);

// ───────────────────────── as linhas ─────────────────────────

export type LinhaDaTabela = {
  chave: string;
  regraId: string;
  pontoId: string;
  areaNome: string | null;
  soma: Soma;
};

/** Critério × canal (× área), do que mais ficou fora do critério para o que menos ficou. */
export function linhas(celulas: CelulaDeAnalise[]): LinhaDaTabela[] {
  const grupos = new Map<string, CelulaDeAnalise[]>();
  for (const c of celulas) {
    const chave = `${c.regraId}|${c.zonaId}`;
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave)!.push(c);
  }
  return [...grupos.entries()]
    .map(([chave, cs]) => ({
      chave,
      regraId: cs[0]!.regraId,
      pontoId: cs[0]!.pontoId,
      areaNome: cs[0]!.areaNome,
      soma: somar(cs),
    }))
    .sort((a, b) => b.soma.fora - a.soma.fora || b.soma.naoAvaliou - a.soma.naoAvaliou || b.soma.analises - a.soma.analises);
}

// ───────────────────────── como se escreve ─────────────────────────

const reais = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const reaisFinos = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', minimumFractionDigits: 3, maximumFractionDigits: 3,
});

/** "R$ 6,59" a partir de centavos. */
export const dinheiro = (centavos: number): string => reais.format(centavos / 100);
/** "R$ 0,013" — o custo de UMA análise precisa da terceira casa. */
export const dinheiroFino = (centavos: number): string => reaisFinos.format(centavos / 100);
