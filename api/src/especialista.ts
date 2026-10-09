// =====================================================================
// O especialista — o padrão de funcionamento da loja, sem banco
// =====================================================================
// A16, fase 5. Pedido do dono (07/10/2026): "com uma semana de uso
// verificar as análises e ir criando um padrão de funcionamento; liberar
// descrição de funcionamento por setor; e o que saiu do padrão, para
// análise e correção do responsável pela loja".
//
// Tudo aqui é conta sobre NÚMERO guardado por hora (`resumo_hora`): a
// medida de cada olhada (quantas pessoas o detector viu), o que ficou fora
// do critério e o que não deu para avaliar. Nenhuma imagem entra, e
// nenhum modelo de linguagem: as frases são montadas dos números, e cada
// uma diz de onde saiu.
//
// ## As quatro lentes
//
//   frequência  o que se repete: a semana típica de cada indicador, a
//               descrição de cada setor e o que anda junto;
//   anomalia    a hora muito diferente do que costuma ser naquele dia da
//               semana e naquela hora — mesmo quando nenhum critério avisou;
//   tendência   para onde os números apontam, semana a semana, e hoje
//               contra o normal;
//   sugestões   o que os números mostram sobre os próprios critérios.
//
// ## O dia é o da OPERAÇÃO
//
// Loja que fecha à 1h não tem dois dias: a madrugada pertence à noite que
// começou. O dia vira às 6h (`VIRADA_DO_DIA`): as horas de 0 a 5 são do
// dia anterior. Quem corta é o banco, no fuso da loja; aqui o dia já chega
// pronto.
//
// ## A taxa é da ROTINA
//
// A olhada extra do vigia (fase 3) cai quando algo mudou, e não num
// instante qualquer. "Fora do critério em X%" é feita só das olhadas de
// rotina (`julgadas − extras`), para que a semana de antes do vigia e a de
// depois sejam comparáveis. A média da medida já é só da rotina.
//
// ## O que fica fora da conta do padrão
//
// A hora que o responsável marcou como "foi só desta vez" ou como
// "é problema" não ensina o padrão: um problema que se repete não pode
// virar o normal.
// =====================================================================

export const VIRADA_DO_DIA = 6;
/** O padrão é feito dos 28 dias antes de hoje. Hoje não entra. */
export const DIAS_DO_PADRAO = 28;
/** Com menos dias medidos que isto, não há padrão para mostrar. */
export const MINIMO_DE_DIAS = 7;
/** A partir daqui o padrão por dia da semana fica firme (três de cada). */
export const DIAS_PARA_FIRMAR = 21;

/** Amostra mínima para uma hora ter valor: menos que isto é acaso. */
export const MINIMO_NA_HORA = { medida: 3, taxa: 5 } as const;
/** Dias iguais (mesmo dia da semana) para o normal ser "daquele dia"; senão vale a hora, em qualquer dia. */
const MINIMO_DE_DIAS_IGUAIS = 3;
const MINIMO_DE_DIAS_NA_HORA = 5;

export type TipoDeIndicador = 'medida' | 'fora' | 'na';

export type Celula = {
  /** O dia da operação, AAAA-MM-DD. */
  dia: string;
  hora: number;
  regraId: string;
  zonaId: string;
  /** Conformes + fora do critério + sem avaliar — rotina e extras. */
  julgadas: number;
  fora: number;
  na: number;
  extras: number;
  extrasFora: number;
  somaMedida: number;
  comMedida: number;
  maxMedida: number | null;
  alertas: number;
  /** Olhadas que caíram no silêncio depois de um aviso: o critério não as julgou. */
  emSilencio: number;
  custoCentavos: number;
};

/** Um critério numa área: é de onde saem os indicadores. */
export type Serie = {
  regraId: string;
  zonaId: string;
  regraNome: string;
  tipo: 'estado' | 'acao' | 'presenca' | 'contagem' | 'comparacao';
  ativa: boolean;
  objeto: string | null;
  minimo: number | null;
  maximo: number | null;
  porteiro: string;
  comPadrao: boolean;
  pontoId: string;
  pontoNome: string;
  canal: number | null;
  zonaNome: string;
  variasAreas: boolean;
  /** A área foi desenhada, ou é o quadro inteiro? */
  areaDesenhada: boolean;
  fotosPadrao: number;
  setorId: string;
  setorNome: string;
};

export type Revisao = {
  regraId: string;
  zonaId: string;
  tipo: TipoDeIndicador;
  dia: string;
  hora: number;
  estado: 'esperado' | 'problema';
  /** "Foi só desta vez": a hora fica de fora da conta do padrão. */
  soDestaVez: boolean;
  texto: string;
  virou: string | null;
  quem: string | null;
  /** AAAA-MM-DD, no relógio da loja. */
  em: string;
};

/** O disco da máquina de análise num dia: a última leitura. */
export type DiscoDoDia = { dia: string; livreGb: number; totalGb: number | null };

export type Entrada = {
  /** O dia da operação de agora, e a hora do relógio da loja. */
  hoje: string;
  horaAgora: number;
  setores: Array<{ id: string; nome: string }>;
  series: Serie[];
  celulas: Celula[];
  revisoes: Revisao[];
  disco: DiscoDoDia[];
};

/** Um pedaço de frase: texto corrido, ou um trecho em destaque. */
export type Trecho = string | { forte: string };
export type Frase = Trecho[];

export type Indicador = {
  id: string;
  tipo: TipoDeIndicador;
  regraId: string;
  zonaId: string;
  setorId: string;
  nome: string;
  /** O que o número conta: "pessoas", "fora do critério". */
  curto: string;
  onde: string;
  /** Entra no seletor da semana típica. */
  noSeletor: boolean;
};

/**
 * O normal de uma hora. `n` é quantos dias foram olhados; `noMiolo`, quantos
 * deles fazem a faixa (`min` a `max`) — o dia que já tinha fugido do costume
 * é olhado, mas não alarga a faixa.
 */
export type Normal = { n: number; noMiolo: number; media: number; mediana: number; min: number; max: number; base: 'dia' | 'hora' };

/** A média e a faixa são do miolo (`noMiolo` dos `n` dias): o dia atípico é contado, mas não vira o costume. */
export type CelulaDaSemana = { diaDaSemana: number; hora: number; n: number; noMiolo: number; media: number; min: number; max: number };

export type DescricaoDoSetor = {
  setorId: string;
  setor: string;
  /** Nulo = nenhum critério mede este setor. */
  texto: string | null;
  fatos: Array<[string, string]>;
};

export type Relacao = {
  setorId: string;
  pergunta: string;
  titulo: string;
  forca: 'forte' | 'moderada' | 'nenhuma';
  /** [rótulo, taxa em %, é o lado calmo?] */
  linhas: Array<[string, number, boolean]>;
  sufixo: string;
  pe: string;
};

export type CriterioProposto = {
  nome: string;
  tipo: 'contagem';
  objeto: string;
  minimo: number;
  maximo: number | null;
  zonaId: string;
  lugar: string;
  janela: [string, string];
  regra: string;
  texto: string;
};

export type Anomalia = {
  id: string;
  indicadorId: string;
  tipo: TipoDeIndicador;
  regraId: string;
  zonaId: string;
  pontoId: string;
  setorId: string;
  dia: string;
  hora: number;
  onde: string;
  titulo: string;
  grave: boolean;
  estado: 'rever' | 'esperado' | 'problema';
  visto: number;
  normal: Normal;
  conta: Frase;
  curto: string;
  mais: string | null;
  /** Quando é a avaliação que some, costuma ser a câmera: a tela oferece ver o quadro. */
  camera: boolean;
  criterio: CriterioProposto | null;
  /** O critério que já existe e pode ser ajustado. */
  ajustar: { regraId: string; nome: string } | null;
  revisao: { quem: string | null; em: string; texto: string; virou: string | null; soDestaVez: boolean } | null;
};

export type HojeContraONormal = {
  indicadorId: string;
  /** O nome do critério — com o canal, quando ele vale em mais de um: duas opções nunca têm o mesmo nome. */
  rotulo: string;
  diaDaSemana: number;
  horas: Array<{ hora: number; min: number; max: number; media: number; visto: number | null; completa: boolean }>;
  nota: string;
};

export type Tendencia = {
  setorId: string;
  titulo: string;
  serie: number[];
  sentido: 'sobe' | 'cai' | 'estável';
  seguidas: number;
  /** O sentido que pede atenção. */
  ruim: 'sobe' | 'cai';
  limite: number | null;
  valor: string;
  legenda: string;
  texto: Frase;
};

export type Sugestao = {
  setorId: string;
  icone: 'area' | 'pessoa' | 'foto' | 'criterio' | 'duvida';
  titulo: string;
  texto: Frase;
  acao:
    | { tipo: 'area'; rotulo: string; pontoId: string }
    | { tipo: 'criterio'; rotulo: string; regraId: string; porteiro?: 'pessoa' }
    | { tipo: 'criar'; rotulo: string; criterio: CriterioProposto };
};

export type Padroes = {
  hoje: string;
  base: { dias: number; de: string | null; ate: string | null; firme: boolean };
  /** Menos de sete dias medidos: não há padrão para mostrar. */
  suficiente: boolean;
  setores: Array<{ id: string; nome: string }>;
  indicadores: Indicador[];
  descricoes: DescricaoDoSetor[];
  semana: Record<string, CelulaDaSemana[]>;
  relacoes: Relacao[];
  anomalias: Anomalia[];
  aRever: number;
  hojeContraONormal: HojeContraONormal[];
  tendencias: Tendencia[];
  sugestoes: Sugestao[];
  parecer: { frequencia: string | null; anomalias: Frase; tendencia: Frase | null };
};

// ───────────────────────── datas e palavras ─────────────────────────

export const DIA = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'] as const;
const DIAS_PLURAL = ['segundas', 'terças', 'quartas', 'quintas', 'sextas', 'sábados', 'domingos'];
const ARTIGO = ['das', 'das', 'das', 'das', 'das', 'dos', 'dos'];

const emDias = (dia: string): number => {
  const [a, m, d] = dia.split('-').map(Number) as [number, number, number];
  return Date.UTC(a, m - 1, d) / 86_400_000;
};
/** `dia` mais `n` dias (ou menos, com `n` negativo). */
export const somaDias = (dia: string, n: number): string => new Date((emDias(dia) + n) * 86_400_000).toISOString().slice(0, 10);
/** 0 = segunda … 6 = domingo. */
export const diaDaSemana = (dia: string): number => (new Date(emDias(dia) * 86_400_000).getUTCDay() + 6) % 7;
/** "26/09" */
const diaEMes = (dia: string): string => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

/**
 * A resposta do responsável, em uma frase: é o que fica escrito ao lado da
 * saída do padrão depois de revista.
 */
export function textoDaRevisao(r: { estado: 'esperado' | 'problema'; soDestaVez: boolean; nota: string; oQueHouve: string; oQueFoiFeito: string; dia: string; hora: number }): string {
  if (r.estado === 'problema') return `${r.oQueHouve.trim()} ${r.oQueFoiFeito.trim()}`.trim();
  const dow = diaDaSemana(r.dia);
  const nota = r.nota.trim();
  return (
    (nota ? `${nota} ` : '') +
    (r.soDestaVez
      ? 'Foi só desta vez: esta hora ficou de fora da conta do padrão.'
      : `Acontece sempre: o padrão ${ARTIGO[dow]} ${DIAS_PLURAL[dow]} às ${String(r.hora).padStart(2, '0')}h passa a contar com isso.`)
  );
}

export const hh = (h: number): string => `${String(((h % 24) + 24) % 24).padStart(2, '0')}h`;
const horas = (h: number): string => `${hh(h)} às ${hh(h + 1)}`;
/** "20:00": a hora cheia como a faixa de horas de um critério a guarda. */
const emPonto = (h: number): string => `${String(((h % 24) + 24) % 24).padStart(2, '0')}:00`;
/** A ordem das horas dentro de um dia da operação: das 6h às 5h. */
export const ordemDaHora = (h: number): number => (h - VIRADA_DO_DIA + 24) % 24;

export const umaCasa = (v: number): string => v.toFixed(1).replace('.', ',');
const porcento = (v: number): string => `${Math.round(v)}%`;
const dinheiro = (centavos: number): string => `R$ ${(centavos / 100).toFixed(2).replace('.', ',')}`;
const plural = (n: number, um: string, varios: string): string => `${n} ${n === 1 ? um : varios}`;

/** O plural do objeto do detector: "pessoa" → "pessoas", "celular" → "celulares". */
export function pluralDoObjeto(objeto: string): string {
  if (objeto.endsWith('s')) return objeto;
  return objeto.endsWith('r') ? `${objeto}es` : `${objeto}s`;
}
/** "2,0 pessoas", "1,0 pessoa", "0,0 pessoas". */
const comObjeto = (v: number, objeto: string): string => `${umaCasa(v)} ${v >= 1.95 || v < 0.95 ? pluralDoObjeto(objeto) : objeto}`;

const soma = (vs: number[]): number => vs.reduce((a, b) => a + b, 0);
const mediana = (vs: number[]): number => {
  const o = [...vs].sort((a, b) => a - b);
  return o.length % 2 ? o[(o.length - 1) / 2]! : (o[o.length / 2 - 1]! + o[o.length / 2]!) / 2;
};

// ───────────────────────── os indicadores ─────────────────────────

const DO_DETECTOR = new Set(['presenca', 'contagem']);
export const chaveDaSerie = (s: { regraId: string; zonaId: string }): string => `${s.regraId}|${s.zonaId}`;
export const idDoIndicador = (s: { regraId: string; zonaId: string }, tipo: TipoDeIndicador): string => `${chaveDaSerie(s)}|${tipo}`;
const lugarDe = (s: Serie): string => `${s.pontoNome}${s.variasAreas ? ` · ${s.zonaNome}` : ''}`;

/** Junta células num valor: média da medida, ou % das olhadas. Nulo = nada medido. */
export function juntar(tipo: TipoDeIndicador, cs: Celula[]): number | null {
  if (tipo === 'medida') {
    const com = soma(cs.map((c) => c.comMedida));
    return com > 0 ? soma(cs.map((c) => c.somaMedida)) / com : null;
  }
  if (tipo === 'fora') {
    // só as olhadas de rotina: a extra cai quando algo mudou
    const rotina = soma(cs.map((c) => c.julgadas - c.extras));
    return rotina > 0 ? (soma(cs.map((c) => c.fora - c.extrasFora)) / rotina) * 100 : null;
  }
  const julgadas = soma(cs.map((c) => c.julgadas));
  return julgadas > 0 ? (soma(cs.map((c) => c.na)) / julgadas) * 100 : null;
}

/** O valor de UMA hora — ou nulo, se a amostra é pequena demais para dizer. */
export function valorDaHora(tipo: TipoDeIndicador, c: Celula | undefined): number | null {
  if (!c) return null;
  if (tipo === 'medida') return c.comMedida >= MINIMO_NA_HORA.medida ? c.somaMedida / c.comMedida : null;
  const amostra = tipo === 'fora' ? c.julgadas - c.extras : c.julgadas;
  return amostra >= MINIMO_NA_HORA.taxa ? juntar(tipo, [c]) : null;
}

const texto = (tipo: TipoDeIndicador, v: number): string => (tipo === 'medida' ? umaCasa(v) : porcento(v));

// ───────────────────────── o motor ─────────────────────────

/**
 * Os pisos de "muito diferente": abaixo disso é ruído, por maior que seja a
 * diferença relativa. `faixa` é quanto o valor tem de passar do que já se
 * viu naquela hora; `desvio`, quanto tem de ficar longe do meio. São
 * valores de partida — "o posto que costuma ter dois ficou com um" tem de
 * aparecer, "1,9 em vez de 2,0" não —, e é com as primeiras saídas do
 * padrão de uma loja de verdade que se afinam.
 */
export const PISO = {
  medida: { faixa: 0.5, desvio: 0.6 },
  taxa: { faixa: 10, desvio: 15 },
} as const;
const MAX_ANOMALIAS = 60;
const MAX_RELACOES = 6;
const MAX_SUGESTOES = 8;
/** "Nunca ficou fora do critério: vale manter?" — só as de mais olhadas: numa loja nova seriam quase todos os critérios. */
const MAX_DUVIDAS = 2;
/** A parte das olhadas de uma hora que o silêncio depois do aviso tem de tirar para a saída do padrão dizer. */
const SILENCIO_QUE_SE_DIZ = 0.25;
const MAX_NO_HOJE = 6;
/** Na descrição de um setor: quantas taxas "fora do critério" e quantas "sem avaliar" cabem. */
const MAX_TAXAS_NA_DESCRICAO = 2;

export function montarPadroes(e: Entrada): Padroes {
  const { hoje } = e;
  const primeiro = somaDias(hoje, -DIAS_DO_PADRAO);
  const serieDe = new Map(e.series.map((s) => [chaveDaSerie(s), s]));
  // só o que é de uma série conhecida (critério, área e canal que ainda existem)
  const celulas = e.celulas.filter((c) => serieDe.has(chaveDaSerie(c)));
  const doPeriodo = celulas.filter((c) => c.dia >= primeiro && c.dia < hoje);
  const deHoje = celulas.filter((c) => c.dia === hoje);

  const dias = [...new Set(doPeriodo.map((c) => c.dia))].sort();
  // o dia da semana de cada dia, uma vez só: a conta do normal pergunta isso dezenas de milhares de vezes
  const dowDe = new Map(dias.map((d) => [d, diaDaSemana(d)]));
  const base = { dias: dias.length, de: dias[0] ?? null, ate: dias[dias.length - 1] ?? null, firme: dias.length >= DIAS_PARA_FIRMAR };
  const vazio: Padroes = {
    hoje, base, suficiente: false, setores: e.setores, indicadores: [], descricoes: [], semana: {}, relacoes: [], anomalias: [], aRever: 0,
    hojeContraONormal: [], tendencias: [], sugestoes: [],
    parecer: { frequencia: null, anomalias: ['Nada fugiu do padrão que ainda precise de revisão.'], tendencia: null },
  };
  if (dias.length < MINIMO_DE_DIAS) return vazio;

  // ── índices ──
  const porSerie = new Map<string, Celula[]>();
  for (const c of doPeriodo) {
    const k = chaveDaSerie(c);
    (porSerie.get(k) ?? porSerie.set(k, []).get(k)!).push(c);
  }
  const celulaEm = new Map<string, Celula>();
  for (const c of celulas) celulaEm.set(`${chaveDaSerie(c)}|${c.dia}|${c.hora}`, c);
  const celula = (s: { regraId: string; zonaId: string }, dia: string, hora: number): Celula | undefined => celulaEm.get(`${chaveDaSerie(s)}|${dia}|${hora}`);

  const revisaoDe = new Map(e.revisoes.map((r) => [`${idDoIndicador(r, r.tipo)}|${r.dia}|${r.hora}`, r]));
  /** A hora que não ensina o padrão: "foi só desta vez" ou "é problema". */
  const foraDaConta = (ind: Indicador, dia: string, hora: number): boolean => {
    const r = revisaoDe.get(`${ind.id}|${dia}|${hora}`);
    return Boolean(r && (r.estado === 'problema' || r.soDestaVez));
  };

  // ── os indicadores ──
  const variasZonas = new Map<string, number>();
  for (const s of e.series) variasZonas.set(s.regraId, (variasZonas.get(s.regraId) ?? 0) + 1);
  const indicadores: Indicador[] = [];
  for (const s of e.series) {
    const cs = porSerie.get(chaveDaSerie(s)) ?? [];
    if (!cs.length) continue;
    const onde = lugarDe(s);
    const sufixo = (variasZonas.get(s.regraId) ?? 1) > 1 ? ` · ${onde}` : '';
    const novo = (tipo: TipoDeIndicador, nome: string, curto: string, noSeletor: boolean): void => {
      indicadores.push({ id: idDoIndicador(s, tipo), tipo, regraId: s.regraId, zonaId: s.zonaId, setorId: s.setorId, nome: nome + sufixo, curto, onde, noSeletor });
    };
    if (s.objeto && soma(cs.map((c) => c.comMedida)) >= 20) {
      novo('medida', `${s.regraNome}: ${pluralDoObjeto(s.objeto)}`, pluralDoObjeto(s.objeto), true);
    }
    if (soma(cs.map((c) => c.julgadas - c.extras)) >= 50) novo('fora', `${s.regraNome} fora do critério`, 'fora do critério', true);
    const julgadas = soma(cs.map((c) => c.julgadas));
    if (julgadas >= 50) novo('na', `${s.regraNome} sem conseguir avaliar`, 'sem avaliar', (juntar('na', cs) ?? 0) >= 10);
  }
  const serieDoInd = (ind: Indicador): Serie => serieDe.get(chaveDaSerie(ind))!;
  const valor = (ind: Indicador, dia: string, hora: number): number | null => valorDaHora(ind.tipo, celula(ind, dia, hora));

  // ── o normal ──
  /** Os valores de uma hora nos dias do período — de um dia da semana, ou de todos. */
  type Amostra = { v: number; ensinado: boolean };
  /** As amostras de uma hora — de um dia da semana ou de todos; `antesDe` deixa só os dias anteriores àquele. */
  const amostrasDe = (ind: Indicador, hora: number, dow: number | null, antesDe: string | null): Amostra[] & { tiradas: number } => {
    // `tiradas`: as horas medidas que uma revisão deixou de fora da conta
    const as = Object.assign([] as Amostra[], { tiradas: 0 });
    for (const d of dias) {
      if ((antesDe !== null && d >= antesDe) || (dow !== null && dowDe.get(d) !== dow)) continue;
      const v = valor(ind, d, hora);
      if (v === null) continue;
      if (foraDaConta(ind, d, hora)) {
        as.tiradas += 1;
        continue;
      }
      // "acontece sempre neste dia e hora": o responsável ensinou o padrão
      const r = revisaoDe.get(`${ind.id}|${d}|${hora}`);
      as.push({ v, ensinado: Boolean(r && r.estado === 'esperado' && !r.soDestaVez) });
    }
    return as;
  };
  /**
   * A faixa do normal é a do MIOLO: o dia que já tinha fugido do costume não
   * a alarga. Sem isto, a segunda vez que algo acontece esconderia a
   * primeira — e as duas sumiriam da lista antes de alguém rever. O que o
   * responsável disse que "acontece sempre" entra na faixa, por mais longe
   * que esteja: foi ensinado.
   */
  const resumir = (as: Amostra[], daBase: 'dia' | 'hora', tipo: TipoDeIndicador): Normal => {
    const vs = as.map((a) => a.v);
    const meio = mediana(vs);
    const espalha = mediana(vs.map((v) => Math.abs(v - meio)));
    const raio = Math.max((tipo === 'medida' ? PISO.medida : PISO.taxa).desvio, 3 * 1.4826 * espalha);
    const miolo = as.filter((a) => a.ensinado || Math.abs(a.v - meio) <= raio).map((a) => a.v);
    return { n: vs.length, noMiolo: miolo.length, media: soma(miolo) / miolo.length, mediana: meio, min: Math.min(...miolo), max: Math.max(...miolo), base: daBase };
  };
  /**
   * O normal de um dia da semana e uma hora. Com `antesDe`, é o que era
   * costume ANTES daquele dia — é com isso que uma hora é comparada. Com os
   * dias de depois na conta, o passado mudaria de cara: se o balcão passou a
   * ter quatro pessoas aos sábados, os sábados antigos, com duas, virariam
   * "menos do que o normal".
   *
   * Com menos de três dias iguais ainda não há "normal das sextas": vale o
   * daquela hora em qualquer dia — e com menos de cinco, nada.
   */
  const normal = (ind: Indicador, dow: number, hora: number, antesDe: string | null = null): Normal | null => {
    const iguais = amostrasDe(ind, hora, dow, antesDe);
    // Três dias iguais MEDIDOS. A hora que uma revisão tirou da conta não tira do dia da semana o direito
    // de ter um normal: sobrando duas, é com elas.
    if (iguais.length + iguais.tiradas >= MINIMO_DE_DIAS_IGUAIS && iguais.length >= 2) return resumir(iguais, 'dia', ind.tipo);
    const todos = amostrasDe(ind, hora, null, antesDe);
    return todos.length >= MINIMO_DE_DIAS_NA_HORA ? resumir(todos, 'hora', ind.tipo) : null;
  };
  const nomeDoNormal = (n: Normal, dow: number, hora: number): string =>
    n.base === 'dia' ? `${ARTIGO[dow]} ${DIAS_PLURAL[dow]} às ${hh(hora)}` : `às ${hh(hora)}`;

  // ── frequência: a semana típica ──
  const semanaDe = (ind: Indicador): CelulaDaSemana[] => {
    const saida: CelulaDaSemana[] = [];
    for (let dow = 0; dow < 7; dow += 1) {
      for (let hora = 0; hora < 24; hora += 1) {
        const as = amostrasDe(ind, hora, dow, null);
        if (!as.length) continue;
        // O mesmo miolo do normal: um dia atípico não faz daquela a "hora mais cheia" da semana.
        const r = resumir(as, 'dia', ind.tipo);
        saida.push({ diaDaSemana: dow, hora, n: r.n, noMiolo: r.noMiolo, media: r.media, min: r.min, max: r.max });
      }
    }
    return saida.sort((a, b) => a.diaDaSemana - b.diaDaSemana || ordemDaHora(a.hora) - ordemDaHora(b.hora));
  };
  const semana: Record<string, CelulaDaSemana[]> = {};
  for (const ind of indicadores) semana[ind.id] = semanaDe(ind);

  /** A média de cada hora do dia, em todos os dias da semana. */
  const perfilDoDia = (ind: Indicador): Map<number, number> => {
    const porHora = new Map<number, number[]>();
    for (const c of semana[ind.id] ?? []) (porHora.get(c.hora) ?? porHora.set(c.hora, []).get(c.hora)!).push(c.media);
    return new Map([...porHora].map(([h, vs]) => [h, soma(vs) / vs.length]));
  };
  /** As horas seguidas, em volta da mais alta, que ficam perto dela: é o pico. */
  const picoDe = (perfil: Map<number, number>): { de: number; ate: number; horas: Set<number> } | null => {
    if (perfil.size < 3) return null;
    const ordenadas = [...perfil].sort((a, b) => ordemDaHora(a[0]) - ordemDaHora(b[0]));
    const topo = ordenadas.reduce((a, b) => (b[1] > a[1] ? b : a));
    if (topo[1] <= 0) return null;
    const i = ordenadas.indexOf(topo);
    let [de, ate] = [i, i];
    const perto = (k: number): boolean => ordenadas[k]![1] >= topo[1] * 0.75 && Math.abs(ordemDaHora(ordenadas[k]![0]) - ordemDaHora(ordenadas[k + (k < i ? 1 : -1)]![0])) === 1;
    while (de > 0 && perto(de - 1)) de -= 1;
    while (ate < ordenadas.length - 1 && perto(ate + 1)) ate += 1;
    // pico que é o dia inteiro não é pico
    if (ate - de + 1 > ordenadas.length * 0.6) return null;
    return { de: ordenadas[de]![0], ate: ordenadas[ate]![0], horas: new Set(ordenadas.slice(de, ate + 1).map((x) => x[0])) };
  };

  // ── frequência: como cada setor funciona ──
  const taxaDoPeriodo = (ind: Indicador, filtro: (c: Celula) => boolean = () => true): number | null =>
    juntar(ind.tipo, (porSerie.get(chaveDaSerie(ind)) ?? []).filter(filtro));
  const picoDoSetor = new Map<string, NonNullable<ReturnType<typeof picoDe>>>();
  const descricoes: DescricaoDoSetor[] = e.setores.map((setor) => {
    const doSetor = indicadores.filter((i) => i.setorId === setor.id);
    if (!doSetor.length) return { setorId: setor.id, setor: setor.nome, texto: null, fatos: [] };
    const frases: string[] = [];
    const fatos: Array<[string, string]> = [];
    // a medida com mais olhadas é a que conta o movimento do setor
    const medidas = doSetor
      .filter((i) => i.tipo === 'medida')
      .sort((a, b) => soma((porSerie.get(chaveDaSerie(b)) ?? []).map((c) => c.comMedida)) - soma((porSerie.get(chaveDaSerie(a)) ?? []).map((c) => c.comMedida)));
    let pico: ReturnType<typeof picoDe> = null;
    for (const [n, ind] of medidas.slice(0, 2).entries()) {
      const s = serieDoInd(ind);
      const perfil = perfilDoDia(ind);
      const grade = semana[ind.id] ?? [];
      if (!grade.length) continue;
      const topo = grade.reduce((a, b) => (b.media > a.media ? b : a));
      const doPico = picoDe(perfil);
      if (n === 0) {
        pico = doPico;
        if (doPico) picoDoSetor.set(setor.id, doPico);
      }
      if (doPico) {
        const media = soma([...doPico.horas].map((h) => perfil.get(h)!)) / doPico.horas.size;
        frases.push(`Em ${ind.onde}, o movimento tem pico das ${hh(doPico.de)} às ${hh(doPico.ate + 1)}: ${comObjeto(media, s.objeto!)}, em média.`);
        if (n === 0) fatos.push(['Pico', `${hh(doPico.de)} às ${hh(doPico.ate + 1)}`]);
      } else {
        const geral = taxaDoPeriodo(ind);
        if (geral !== null) frases.push(`Em ${ind.onde} há ${comObjeto(geral, s.objeto!)}, em média, sem hora de pico marcada.`);
      }
      fatos.push([n === 0 ? 'Hora mais cheia' : `Hora mais cheia · ${ind.onde}`, `${DIA[topo.diaDaSemana]} às ${hh(topo.hora)}, ${comObjeto(topo.media, s.objeto!)}`]);
    }
    // "Fora do critério": por critério, juntando os canais do setor em que ele vale — e só as duas maiores
    // taxas. Uma frase por canal viraria um parágrafo sem fim numa loja com o mesmo critério em vários.
    const porCriterio = new Map<string, Indicador[]>();
    for (const ind of doSetor.filter((i) => i.tipo === 'fora')) (porCriterio.get(ind.regraId) ?? porCriterio.set(ind.regraId, []).get(ind.regraId)!).push(ind);
    const foras = [...porCriterio.values()]
      .map((grupo) => {
        const cs = grupo.flatMap((i) => porSerie.get(chaveDaSerie(i)) ?? []);
        return { grupo, geral: juntar('fora', cs) ?? 0, noPico: pico ? juntar('fora', cs.filter((c) => pico!.horas.has(c.hora))) : null };
      })
      .filter((x) => x.geral >= 1)
      .sort((a, b) => b.geral - a.geral)
      .slice(0, MAX_TAXAS_NA_DESCRICAO);
    for (const { grupo, geral, noPico } of foras) {
      const s = serieDoInd(grupo[0]!);
      // num canal só, e numa área que tem nome, a frase diz onde
      const onde = grupo.length === 1 && grupo[0]!.onde !== s.pontoNome ? ` (${grupo[0]!.onde})` : '';
      const comPico = noPico !== null && Math.abs(noPico - geral) >= 2;
      frases.push(`“${s.regraNome}”${onde} fica fora do critério em ${porcento(geral)} das olhadas${comPico ? ` — ${porcento(noPico)} no pico.` : '.'}`);
      if (fatos.length < 4) fatos.push([`${s.regraNome} fora do critério`, comPico ? `${porcento(geral)} · ${porcento(noPico)} no pico` : porcento(geral)]);
    }
    // "Não deu para avaliar" é de cada canal (é o que aquela câmera mostra): os dois que menos conseguem.
    const nas = doSetor
      .filter((i) => i.tipo === 'na')
      .map((ind) => ({ ind, geral: taxaDoPeriodo(ind) ?? 0 }))
      .filter((x) => x.geral >= 30)
      .sort((a, b) => b.geral - a.geral)
      .slice(0, MAX_TAXAS_NA_DESCRICAO);
    for (const { ind, geral } of nas) {
      const s = serieDoInd(ind);
      frases.push(`Em ${ind.onde}, “${s.regraNome}” não dá para avaliar em ${porcento(geral)} das olhadas.`);
      if (fatos.length < 4) fatos.push([`${s.regraNome} sem avaliar (${ind.onde})`, `${porcento(geral)} das olhadas`]);
    }
    if (!frases.length) frases.push('Os critérios deste setor ficaram dentro do combinado em praticamente todas as olhadas do período.');
    return { setorId: setor.id, setor: setor.nome, texto: frases.join(' '), fatos };
  });

  // ── frequência: o que anda junto ──
  // A mesma taxa, medida em duas situações: as horas em que a medida ficou
  // abaixo do costume dela, e as horas em que ficou no costume ou acima.
  //
  // A comparação é feita DENTRO da mesma hora do dia: "às 20h, nos dias com
  // um no balcão" contra "às 20h, nos dias com dois". Comparar todas as
  // horas juntas diria só que o pico é diferente da hora vazia — e isso
  // todo mundo sabe. Hora do dia em que só houve um dos casos fica de fora.
  const forcaDe = (a: number, b: number): Relacao['forca'] => {
    const maior = Math.max(a, b);
    const menor = Math.max(Math.min(a, b), 0.01);
    if (maior < 2) return 'nenhuma'; // duas taxas perto de zero não são relação nenhuma
    return maior / menor >= 2 ? 'forte' : maior / menor >= 1.3 ? 'moderada' : 'nenhuma';
  };
  /** `horas`: as horas do dia em que a comparação foi feita, na ordem do dia. */
  type RelacaoCrua = Relacao & { medida: Indicador; taxa: Indicador; limiar: number; poucas: number; baixa: number; alta: number; horas: number[] };
  const relacoesCruas: RelacaoCrua[] = [];
  for (const m of indicadores.filter((i) => i.tipo === 'medida')) {
    const sm = serieDoInd(m);
    const horasDeM = (porSerie.get(chaveDaSerie(m)) ?? []).map((c) => [c, valorDaHora('medida', c)] as const).filter((x): x is readonly [Celula, number] => x[1] !== null);
    if (horasDeM.length < 16) continue;
    // O costume é o DAQUELA hora do dia (o da loja inteira mistura pico e hora vazia), e o limiar é um
    // número inteiro de objetos: "menos de 2" se entende, "menos de 1,7" não.
    const porHoraDoDia = new Map<number, Array<readonly [Celula, number]>>();
    for (const x of horasDeM) (porHoraDoDia.get(x[0].hora) ?? porHoraDoDia.set(x[0].hora, []).get(x[0].hora)!).push(x);
    const casos = [...porHoraDoDia]
      .map(([hora, xs]) => {
        const doCostume = Math.max(1, Math.round(mediana(xs.map((x) => x[1]))));
        const comMenos = xs.filter((x) => x[1] < doCostume - 0.5);
        const noCostume = xs.filter((x) => x[1] >= doCostume - 0.5);
        const media = (ys: typeof xs): number => soma(ys.map((y) => y[1])) / Math.max(ys.length, 1);
        return {
          hora, limiar: doCostume, separa: media(noCostume) - media(comMenos),
          abaixo: new Set(comMenos.map((x) => x[0].dia)),
          costume: new Set(noCostume.map((x) => x[0].dia)),
        };
      })
      // Dois casos DE VERDADE: os dias "com menos" ficam pelo menos meio objeto abaixo dos outros. Com o
      // costume em volta de 2,5, dividir os dias em "menos de 3" e "3 ou mais" separa 2,4 de 2,6 — ruído.
      .filter((g) => g.abaixo.size >= 2 && g.costume.size >= 2 && g.separa >= 0.5);
    if (!casos.length) continue;
    // um limiar só, para caber numa frase: o mais comum entre as horas em que há os dois casos
    const votos = new Map<number, number>();
    for (const g of casos) votos.set(g.limiar, (votos.get(g.limiar) ?? 0) + 1);
    const limiar = [...votos].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
    const comparaveis = casos.filter((g) => g.limiar === limiar).sort((a, b) => ordemDaHora(a.hora) - ordemDaHora(b.hora)).map((g) => [g.hora, g] as const);
    const abaixo = new Set(comparaveis.flatMap(([h, g]) => [...g.abaixo].map((d) => `${d}|${h}`)));
    const noCostume = new Set(comparaveis.flatMap(([h, g]) => [...g.costume].map((d) => `${d}|${h}`)));
    const nasHoras = comparaveis.map(([h]) => hh(h)).join(', ');
    for (const t of indicadores.filter((i) => i.tipo === 'fora' && i.setorId === m.setorId)) {
      const st = serieDoInd(t);
      const cs = porSerie.get(chaveDaSerie(t)) ?? [];
      const emPoucas = cs.filter((c) => abaixo.has(`${c.dia}|${c.hora}`));
      const emBastante = cs.filter((c) => noCostume.has(`${c.dia}|${c.hora}`));
      if (emPoucas.length < 8 || emBastante.length < 8) continue; // só se diz com amostra mínima
      const [baixa, alta] = [juntar('fora', emPoucas), juntar('fora', emBastante)];
      if (baixa === null || alta === null) continue;
      // duas taxas perto de zero: o critério quase nunca fica fora, com muita ou com pouca gente — não há o que mostrar
      if (Math.max(baixa, alta) < 2) continue;
      const forca = forcaDe(baixa, alta);
      // o critério que vale em mais de um canal é dito com o canal
      const taxa = `“${st.regraNome}”${(variasZonas.get(st.regraId) ?? 1) > 1 ? ` em ${t.onde}` : ''}`;
      const objetos = pluralDoObjeto(sm.objeto!);
      const mesma = chaveDaSerie(m) === chaveDaSerie(t);
      // a medida e a taxa do MESMO critério andam juntas por definição: não é descoberta
      if (mesma) continue;
      relacoesCruas.push({
        medida: m, taxa: t, limiar, poucas: emPoucas.length, baixa, alta, horas: comparaveis.map(([h]) => h),
        setorId: m.setorId,
        pergunta: `${objetos[0]!.toUpperCase()}${objetos.slice(1)} em ${m.onde} × ${taxa}`,
        titulo:
          forca === 'nenhuma'
            ? `${taxa} não muda com o número de ${objetos} em ${m.onde}`
            : baixa > alta
              ? `Com menos de ${limiar} em ${m.onde}, ${taxa} fica mais tempo fora do critério`
              : `Com ${limiar} ou mais em ${m.onde}, ${taxa} fica mais tempo fora do critério`,
        forca,
        linhas: [
          [`Com menos de ${limiar} em ${m.onde}`, baixa, forca === 'nenhuma' || baixa <= alta],
          [`Com ${limiar} ou mais`, alta, forca === 'nenhuma' || alta <= baixa],
        ],
        sufixo: `das olhadas de ${taxa} fora do critério`,
        pe: `${plural(emPoucas.length, 'hora', 'horas')} com menos de ${limiar} · ${emBastante.length} com ${limiar} ou mais · comparando as mesmas horas do dia (${nasHoras})`,
      });
    }
  }
  // O "não deu para avaliar" de um critério, no pico do setor e fora dele. Quando a taxa é a mesma com a
  // loja cheia ou vazia, não é o movimento que atrapalha: é o que a câmera mostra. O que quase sempre dá
  // para avaliar (fora do seletor) não entra, nem o setor sem pico: não há com o que comparar.
  const relacoesDoPico: Array<Relacao & { baixa: number; alta: number }> = [];
  for (const t of indicadores.filter((i) => i.tipo === 'na' && i.noSeletor)) {
    const pico = picoDoSetor.get(t.setorId);
    if (!pico) continue;
    const st = serieDoInd(t);
    const cs = porSerie.get(chaveDaSerie(t)) ?? [];
    const noPico = cs.filter((c) => pico.horas.has(c.hora));
    const foraDele = cs.filter((c) => !pico.horas.has(c.hora));
    if (noPico.length < 8 || foraDele.length < 8) continue;
    const [cheia, vazia] = [juntar('na', noPico), juntar('na', foraDele)];
    if (cheia === null || vazia === null) continue;
    const forca = forcaDe(cheia, vazia);
    const nome = `“${st.regraNome}”${(variasZonas.get(st.regraId) ?? 1) > 1 ? ` em ${t.onde}` : ''}`;
    // a frase só manda olhar a sugestão de marcar um quadro quando essa sugestão existe (a mesma condição dela)
    const haSugestaoDeArea = !DO_DETECTOR.has(st.tipo) && !st.areaDesenhada && (juntar('na', cs) ?? 0) >= 50;
    relacoesDoPico.push({
      baixa: cheia, alta: vazia, setorId: t.setorId,
      pergunta: `Movimento × “${st.regraNome}” sem avaliar em ${t.onde}`,
      titulo:
        forca === 'nenhuma'
          ? `${nome} fica sem avaliar com a loja cheia ou vazia: não é o movimento`
          : cheia > vazia
            ? `${nome} fica mais tempo sem avaliar no pico`
            : `${nome} fica mais tempo sem avaliar fora do pico`,
      forca,
      linhas: [
        [`Das ${hh(pico.de)} às ${hh(pico.ate + 1)}`, cheia, forca === 'nenhuma' || cheia <= vazia],
        ['Nas outras horas', vazia, forca === 'nenhuma' || vazia <= cheia],
      ],
      sufixo: 'das olhadas sem conseguir avaliar',
      pe:
        forca !== 'nenhuma'
          ? `${plural(noPico.length, 'hora', 'horas')} no pico · ${foraDele.length} fora dele`
          : haSugestaoDeArea
            ? 'Quando a taxa não muda com a hora, o problema é o que a câmera mostra — veja a sugestão de marcar um quadro.'
            : 'Quando a taxa não muda com a hora, o problema é o que a câmera mostra, e não o movimento.',
    });
  }
  const pesoDaForca = { forte: 0, moderada: 1, nenhuma: 2 } as const;
  const relacoes: Relacao[] = [...relacoesCruas.map(({ medida: _m, taxa: _t, limiar: _l, poucas: _p, horas: _h, ...r }) => r), ...relacoesDoPico]
    .sort((a, b) => pesoDaForca[a.forca] - pesoDaForca[b.forca] || Math.abs(b.baixa - b.alta) - Math.abs(a.baixa - a.alta))
    .slice(0, MAX_RELACOES)
    .map(({ baixa: _b, alta: _a, ...r }) => r);

  // ── anomalias: o que fugiu do padrão ──
  const anomalias: Anomalia[] = [];
  const horaCompleta = (dia: string, hora: number): boolean => dia < hoje || ordemDaHora(hora) < ordemDaHora(e.horaAgora);
  const comMedidaNaHora = new Set<string>();
  // a medida primeiro: a taxa do mesmo critério na mesma hora é consequência dela
  const ordemDoTipo = { medida: 0, fora: 1, na: 2 } as const;
  for (const ind of [...indicadores].sort((a, b) => ordemDoTipo[a.tipo] - ordemDoTipo[b.tipo])) {
    const s = serieDoInd(ind);
    const piso = ind.tipo === 'medida' ? PISO.medida : PISO.taxa;
    const dasCelulas = [...(porSerie.get(chaveDaSerie(ind)) ?? []), ...deHoje.filter((c) => chaveDaSerie(c) === chaveDaSerie(ind))];
    for (const c of dasCelulas) {
      if (!horaCompleta(c.dia, c.hora)) continue;
      const visto = valorDaHora(ind.tipo, c);
      if (visto === null) continue;
      const dow = diaDaSemana(c.dia);
      const n = normal(ind, dow, c.hora, c.dia);
      if (!n) continue;
      // Com o padrão firme, a comparação é sempre com o normal DAQUELE dia da semana: o normal "daquela
      // hora em qualquer dia" apontaria toda sexta e todo sábado de três semanas atrás. Em loja nova ele
      // vale — e responder "acontece sempre" é o que ensina o padrão. A hora já revista aparece sempre.
      if (n.base === 'hora' && base.firme && !revisaoDe.has(`${ind.id}|${c.dia}|${c.hora}`)) continue;
      const folga = Math.max(piso.faixa, 0.25 * (n.max - n.min));
      const acima = visto > n.max + folga;
      const abaixo = visto < n.min - folga;
      const desvio = Math.abs(visto - n.mediana);
      // taxa menor que o normal é boa notícia, não saída do padrão
      if (!(acima || (abaixo && ind.tipo === 'medida')) || desvio < piso.desvio) continue;
      const naMesmaHora = `${chaveDaSerie(ind)}|${c.dia}|${c.hora}`;
      if (ind.tipo === 'medida') comMedidaNaHora.add(naMesmaHora);
      else if (ind.tipo === 'fora' && comMedidaNaHora.has(naMesmaHora)) continue;

      const grave = ind.tipo === 'medida' ? visto <= n.mediana / 2 || (n.mediana > 0 && visto >= n.mediana * 2) : visto - n.mediana >= 40;
      const nome = nomeDoNormal(n, dow, c.hora);
      // A faixa é a do miolo: se algum dia ficou de fora dela, a frase diz quantos a fazem.
      const masculino = ARTIGO[dow] === 'dos';
      const anteriores =
        n.base === 'dia'
          ? n.noMiolo === n.n
            ? `n${masculino ? 'os' : 'as'} ${n.n} ${DIAS_PLURAL[dow]} anteriores`
            : `em ${n.noMiolo} d${masculino ? 'os' : 'as'} ${n.n} ${DIAS_PLURAL[dow]} anteriores`
          : n.noMiolo === n.n
            ? `nos ${n.n} dias anteriores`
            : `em ${n.noMiolo} dos ${n.n} dias anteriores`;
      const faixa = `de ${texto(ind.tipo, n.min)} a ${texto(ind.tipo, n.max)} ${anteriores}`;
      const objetos = s.objeto ? pluralDoObjeto(s.objeto) : '';
      const conta: Frase =
        ind.tipo === 'medida'
          ? ['Visto: ', { forte: comObjeto(visto, s.objeto!) }, ` em média. Normal ${nome}: `, { forte: umaCasa(n.mediana) }, ` (${faixa}).`]
          : ind.tipo === 'fora'
            ? ['Fora do critério em ', { forte: porcento(visto) }, ` das olhadas. Normal ${nome}: `, { forte: porcento(n.mediana) }, ` (${faixa}).`]
            : ['Sem conseguir avaliar em ', { forte: porcento(visto) }, ` das olhadas. Normal ${nome}: `, { forte: porcento(n.mediana) }, ` (${faixa}).`];
      const curto =
        ind.tipo === 'medida'
          ? `${comObjeto(visto, s.objeto!)} em média; o normal ${nome} é ${umaCasa(n.mediana)}`
          : `${porcento(visto)} das olhadas; o normal ${nome} é ${porcento(n.mediana)}`;
      const titulo =
        ind.tipo === 'medida'
          ? `“${s.regraNome}”: ${acima ? 'mais' : 'menos'} ${objetos} do que o normal`
          : ind.tipo === 'fora'
            ? `“${s.regraNome}” fora do critério por muito mais tempo`
            : visto >= 80
              ? `“${s.regraNome}” quase parou de conseguir avaliar`
              : `“${s.regraNome}” ficou mais tempo sem conseguir avaliar`;
      const foraNaHora = juntar('fora', [c]);
      // A hora fugiu do costume sem passar do limite do critério: é por isso que ele não avisou (ou quase não).
      const oLimite =
        ind.tipo !== 'medida'
          ? ''
          : acima && s.maximo !== null && visto <= s.maximo
            ? ` Ele olha o limite de ${s.maximo}, não o que é costume nessa hora.`
            : abaixo && s.minimo !== null && s.minimo >= 1 && visto >= s.minimo
              ? ` Ele só pede ${s.minimo}, não o que é costume nessa hora.`
              : '';
      // Depois de avisar, o critério fica o período de silêncio sem olhar: a taxa é só da parte da hora que
      // foi olhada. Quando o silêncio tirou um quarto das olhadas, ou mais, a frase diz.
      const olhou = c.julgadas - c.extras;
      const oSilencio =
        c.emSilencio > 0 && c.emSilencio >= (olhou + c.emSilencio) * SILENCIO_QUE_SE_DIZ
          ? ` Depois de avisar, ele ficou em silêncio em ${c.emSilencio} das ${olhou + c.emSilencio} olhadas da hora: a taxa é só das que ele fez.`
          : '';
      const mais =
        ind.tipo === 'medida'
          ? foraNaHora !== null && c.julgadas - c.extras >= MINIMO_NA_HORA.taxa
            ? `Na mesma hora, o critério ficou fora em ${porcento(foraNaHora)} das olhadas e avisou ${plural(c.alertas, 'vez', 'vezes')}.${oLimite}`
            : null
          : ind.tipo === 'fora'
            ? `Foram ${c.fora - c.extrasFora} olhadas fora do critério em ${c.julgadas - c.extras}; o critério avisou ${plural(c.alertas, 'vez', 'vezes')} — uma por período de silêncio.${oSilencio}`
            : 'Quando é a avaliação que some de uma hora para outra, costuma ser a câmera: mexeram nela ou algo ficou na frente.';

      // O critério que a correção pode propor: o costume daquela hora virando limite.
      let criterio: CriterioProposto | null = null;
      if (ind.tipo === 'medida' && s.objeto) {
        // O limite é o costume: com gente de menos, o meio do normal; com gente demais, o teto dele.
        const limiteDe = (nn: Normal): number => (abaixo ? Math.max(1, Math.round(nn.mediana)) : Math.max(1, Math.ceil(nn.max)));
        const limite = limiteDe(n);
        // Hora do pico do setor, e as outras horas do pico pedem o MESMO limite: o critério vale para o pico
        // inteiro ("pelo menos 2 no pico"). Senão, só para aquela hora — um limite só não serve a horas diferentes.
        const pico = picoDoSetor.get(s.setorId);
        const doPico =
          pico !== undefined &&
          pico.horas.has(c.hora) &&
          [...pico.horas].every((h) => {
            const nn = h === c.hora ? n : normal(ind, dow, h, c.dia);
            return nn !== null && limiteDe(nn) === limite;
          });
        const janela: [string, string] = doPico ? [emPonto(pico.de), emPonto(pico.ate + 1)] : [emPonto(c.hora), emPonto(c.hora + 1)];
        const quando = doPico ? 'no pico' : `às ${hh(c.hora)}`;
        const das = doPico ? `${hh(pico.de)} às ${hh(pico.ate + 1)}` : horas(c.hora);
        if (abaixo) {
          const minimo = limite;
          if ((s.minimo ?? 0) < minimo) {
            criterio = {
              nome: `Pelo menos ${minimo} em ${ind.onde} ${quando}`, tipo: 'contagem', objeto: s.objeto, minimo, maximo: null, zonaId: s.zonaId, lugar: ind.onde, janela,
              regra: `pelo menos ${minimo} × ${s.objeto}`,
              texto: `Das ${das} há pelo menos ${plural(minimo, s.objeto, objetos)} em ${ind.onde}.`,
            };
          }
        } else {
          const maximo = limite;
          if (s.maximo === null || s.maximo > maximo) {
            criterio = {
              nome: `No máximo ${maximo} em ${ind.onde} ${quando}`, tipo: 'contagem', objeto: s.objeto, minimo: 0, maximo, zonaId: s.zonaId, lugar: ind.onde, janela,
              regra: `no máximo ${maximo} × ${s.objeto}`,
              texto: `Das ${das} há no máximo ${plural(maximo, s.objeto, objetos)} em ${ind.onde}.`,
            };
          }
        }
      }
      const r = revisaoDe.get(`${ind.id}|${c.dia}|${c.hora}`);
      anomalias.push({
        id: `${ind.id}|${c.dia}|${c.hora}`, indicadorId: ind.id, tipo: ind.tipo, regraId: s.regraId, zonaId: s.zonaId, pontoId: s.pontoId, setorId: s.setorId,
        dia: c.dia, hora: c.hora, onde: ind.onde, titulo, grave, estado: r ? r.estado : 'rever', visto, normal: n, conta, curto, mais,
        camera: ind.tipo === 'na', criterio, ajustar: ind.tipo === 'medida' ? null : { regraId: s.regraId, nome: s.regraNome },
        revisao: r ? { quem: r.quem, em: r.em, texto: r.texto, virou: r.virou, soDestaVez: r.soDestaVez } : null,
      });
    }
  }
  // A revisão de uma hora que hoje não seria apontada (o padrão mudou) continua no histórico? Não:
  // a lista é do que os números dizem AGORA. O registro da revisão fica guardado no banco.
  anomalias.sort((a, b) => (a.dia < b.dia ? 1 : a.dia > b.dia ? -1 : ordemDaHora(b.hora) - ordemDaHora(a.hora)) || Number(b.grave) - Number(a.grave));
  anomalias.splice(MAX_ANOMALIAS);
  const aRever = anomalias.filter((a) => a.estado === 'rever');

  // ── tendência: hoje contra o normal ──
  const dowDeHoje = diaDaSemana(hoje);
  const hojeContraONormal: HojeContraONormal[] = [];
  for (const ind of indicadores.filter((i) => i.tipo === 'medida').slice(0, MAX_NO_HOJE)) {
    const linhas: HojeContraONormal['horas'] = [];
    for (let k = 0; k < 24; k += 1) {
      const hora = (k + VIRADA_DO_DIA) % 24;
      const n = normal(ind, dowDeHoje, hora);
      if (!n) continue;
      linhas.push({ hora, min: n.min, max: n.max, media: n.media, visto: valor(ind, hoje, hora), completa: horaCompleta(hoje, hora) });
    }
    if (linhas.length < 2) continue;
    const fora = linhas.filter((l) => l.completa && l.visto !== null && (l.visto > l.max * 1.15 + 0.01 || l.visto < l.min * 0.85 - 0.01));
    const frente = linhas.filter((l) => !l.completa && ordemDaHora(l.hora) > ordemDaHora(e.horaAgora));
    const jaMediu = linhas.some((l) => l.completa && l.visto !== null);
    const s = serieDoInd(ind);
    hojeContraONormal.push({
      indicadorId: ind.id, rotulo: `${s.regraNome}${(variasZonas.get(s.regraId) ?? 1) > 1 ? ` · ${ind.onde}` : ''}`, diaDaSemana: dowDeHoje, horas: linhas,
      nota:
        (fora.length ? `Fora da faixa do normal: ${fora.map((l) => hh(l.hora)).join(', ')}. ` : jaMediu ? 'Até agora, o dia está dentro do normal. ' : 'Hoje ainda não há hora inteira medida. ') +
        (frente.length ? `O esperado daqui em diante: ${frente.map((l) => `${umaCasa(l.media)} às ${hh(l.hora)}`).join(', ')}.` : 'Não há mais hora com padrão hoje.') +
        // só quando a hora de agora é uma das que têm padrão: com a loja ainda fechada, não há hora corrente a dizer
        (linhas.some((l) => l.hora === e.horaAgora) ? ' A hora corrente ainda está incompleta.' : ''),
    });
  }

  // ── tendência: semana a semana ──
  /** A inclinação por semana (mínimos quadrados) e há quantas semanas anda no mesmo sentido. */
  /** `piso`: quanto a reta tem de andar, em valor, para deixar de ser "estável" — um ponto percentual a mais não é subida. */
  const rumoDe = (serie: number[], piso: number): { inclina: number; seguidas: number; sentido: Tendencia['sentido'] } => {
    const n = serie.length;
    const mx = (n - 1) / 2;
    const my = soma(serie) / n;
    const inclina = soma(serie.map((v, i) => (i - mx) * (v - my))) / soma(serie.map((_, i) => (i - mx) ** 2));
    let seguidas = 0;
    for (let i = n - 1; i > 0; i -= 1) {
      if (Math.sign(serie[i]! - serie[i - 1]!) !== Math.sign(inclina) || serie[i] === serie[i - 1]) break;
      seguidas += 1;
    }
    // Quanto a reta ajustada anda da primeira semana à última, em proporção do valor. O primeiro contra o
    // último seria ruído: uma série que só oscila (2,1 → 1,9 → 2,1 → 1,9) pareceria queda.
    const anda = Math.abs(inclina) * (n - 1);
    const muda = anda / Math.max(Math.abs(my), 0.001);
    return { inclina, seguidas, sentido: muda < 0.06 || anda < piso ? 'estável' : inclina > 0 ? 'sobe' : 'cai' };
  };
  const setas = (serie: number[], f: (v: number) => string): string => serie.map(f).join(' → ');
  /** As quatro semanas antes de hoje, da mais antiga para a mais recente: os dias de cada uma. */
  const semanas = [3, 2, 1, 0].map((w) => Array.from({ length: 7 }, (_, i) => somaDias(hoje, -(w * 7 + 7 - i))));
  const tendencias: Tendencia[] = [];
  for (const ind of indicadores) {
    const s = serieDoInd(ind);
    // o critério que vale em mais de um canal é dito com o canal: dois cartões nunca têm o mesmo título
    const emVarios = (variasZonas.get(s.regraId) ?? 1) > 1;
    if (ind.tipo === 'medida') {
      // a hora mais cheia da semana típica, nas últimas quatro vezes em que aquele dia aconteceu
      const firmes = (semana[ind.id] ?? []).filter((c) => c.n >= 2);
      if (!firmes.length) continue;
      const topo = firmes.reduce((a, b) => (b.media > a.media ? b : a));
      const serie = semanas
        .map((ds) => ds.find((d) => diaDaSemana(d) === topo.diaDaSemana)!)
        .map((d) => valor(ind, d, topo.hora))
        .filter((v): v is number => v !== null);
      if (serie.length < 3) continue;
      const rumo = rumoDe(serie, 0.3);
      const ruim: Tendencia['ruim'] = s.maximo !== null ? 'sobe' : 'cai';
      const ultimo = serie[serie.length - 1]!;
      const faltam = s.maximo !== null && rumo.inclina > 0 ? Math.round((s.maximo - ultimo) / rumo.inclina) : 0;
      tendencias.push({
        setorId: s.setorId, titulo: `${s.regraNome} no pico de ${DIA[topo.diaDaSemana]}${emVarios ? ` · ${ind.onde}` : ''}`, serie, ...rumo, ruim, limite: s.maximo,
        valor: umaCasa(ultimo), legenda: `${pluralDoObjeto(s.objeto!)}, ${DIA[topo.diaDaSemana]} às ${hh(topo.hora)}`,
        texto: [
          { forte: setas(serie, umaCasa) },
          ` ${ARTIGO[topo.diaDaSemana] === 'dos' ? 'nos últimos' : 'nas últimas'} ${serie.length === 4 ? 'quatro' : serie.length} ${DIAS_PLURAL[topo.diaDaSemana]}. `,
          rumo.sentido === 'sobe' && s.maximo !== null && faltam > 0
            ? `No mesmo ritmo, a média da hora encosta no limite de ${s.maximo} em cerca de ${plural(faltam, 'semana', 'semanas')}.`
            : rumo.sentido === 'estável'
              ? 'Sem mudança que peça ação.'
              : '',
        ],
      });
    } else if (ind.tipo === 'fora') {
      // Um cartão por critério, juntando os canais do setor em que ele vale: é a mesma pergunta feita em
      // vários lugares. O primeiro canal responde pelo grupo; os outros entram na conta dele.
      const grupo = indicadores.filter((i) => i.tipo === 'fora' && i.regraId === ind.regraId && i.setorId === ind.setorId);
      if (grupo[0] !== ind) continue;
      const todas = grupo.flatMap((i) => porSerie.get(chaveDaSerie(i)) ?? []);
      if ((juntar('fora', todas) ?? 0) < 2) continue;
      const serie = semanas.map((ds) => juntar('fora', todas.filter((c) => ds.includes(c.dia)))).filter((v): v is number => v !== null);
      if (serie.length < 3) continue;
      const rumo = rumoDe(serie, 3);
      const correcao = e.revisoes
        .filter((r) => r.estado === 'problema' && r.tipo === 'fora' && grupo.some((i) => chaveDaSerie(i) === chaveDaSerie(r)))
        .sort((a, b) => (a.em < b.em ? 1 : -1))[0];
      const ondeDaCorrecao = correcao && grupo.length > 1 ? grupo.find((i) => chaveDaSerie(i) === chaveDaSerie(correcao))!.onde : null;
      // o mesmo critério em outro setor tem o cartão dele: o título diz de qual setor é este
      const emOutroSetor = e.series.some((x) => x.regraId === s.regraId && x.setorId !== s.setorId);
      const ondes = grupo.map((i) => i.onde);
      tendencias.push({
        setorId: s.setorId, titulo: `${s.regraNome} fora do critério${emOutroSetor ? ` · ${s.setorNome}` : ''}`, serie, ...rumo, ruim: 'sobe', limite: null,
        valor: porcento(serie[serie.length - 1]!), legenda: 'das olhadas, na última semana',
        texto: [
          { forte: setas(serie, porcento) },
          ` ${serie.length === 4 ? 'nas últimas quatro semanas' : `nas últimas ${serie.length} semanas`}, em ${ondes.length > 1 ? `${ondes.slice(0, -1).join(', ')} e ${ondes[ondes.length - 1]}` : ondes[0]}.`,
          correcao ? ` Há uma correção registrada em ${diaEMes(correcao.em)}${ondeDaCorrecao ? `, em ${ondeDaCorrecao}` : ''}.` : '',
        ],
      });
    }
  }
  // o gasto com a nuvem, por dia com análise
  {
    const serie = semanas
      .map((ds) => {
        const cs = doPeriodo.filter((c) => ds.includes(c.dia));
        const diasComAnalise = new Set(cs.map((c) => c.dia)).size;
        return diasComAnalise ? soma(cs.map((c) => c.custoCentavos)) / diasComAnalise : null;
      })
      .filter((v): v is number => v !== null);
    if (serie.length >= 3 && serie.some((v) => v > 0)) {
      const rumo = rumoDe(serie, 0);
      tendencias.push({
        setorId: 'loja', titulo: 'Gasto com a nuvem', serie, ...rumo, ruim: 'sobe', limite: null,
        valor: dinheiro(serie[serie.length - 1]!), legenda: 'por dia com análise',
        texto: [
          { forte: setas(serie, dinheiro) },
          ' por dia, semana a semana.',
          rumo.sentido === 'estável' ? ' Não mudou: o gasto acompanha o número de critérios que vão à nuvem, não o movimento.' : '',
        ],
      });
    }
  }
  // o disco da máquina de análise
  {
    const leituras = e.disco.filter((d) => d.dia >= primeiro && d.dia <= hoje).sort((a, b) => (a.dia < b.dia ? -1 : 1));
    if (leituras.length >= 7) {
      const xs = leituras.map((d) => emDias(d.dia));
      const mx = soma(xs) / xs.length;
      const my = soma(leituras.map((d) => d.livreGb)) / leituras.length;
      const porDia = soma(leituras.map((d, i) => (xs[i]! - mx) * (d.livreGb - my))) / Math.max(soma(xs.map((x) => (x - mx) ** 2)), 0.001);
      const ultima = leituras[leituras.length - 1]!;
      const serie = semanas.map((ds) => [...leituras].reverse().find((d) => d.dia <= ds[6]!)?.livreGb).filter((v): v is number => v !== undefined);
      if (serie.length >= 3) {
        const rumo = rumoDe(serie, 1);
        const perde = -porDia;
        const diasAteEncher = perde > 0.01 ? Math.round(ultima.livreGb / perde) : null;
        tendencias.push({
          setorId: 'loja', titulo: 'Disco da máquina de análise', serie, ...rumo, ruim: 'cai', limite: null,
          valor: String(Math.round(ultima.livreGb)), legenda: `GB livres${ultima.totalGb ? ` de ${Math.round(ultima.totalGb)}` : ''}`,
          texto:
            diasAteEncher !== null && rumo.sentido === 'cai'
              ? [{ forte: `${umaCasa(perde)} GB a menos por dia.` }, ` Nesse ritmo o disco enche em cerca de ${plural(diasAteEncher, 'dia', 'dias')}, por volta de ${diaEMes(somaDias(hoje, diasAteEncher))}.`]
              : ['O espaço livre não está caindo.'],
        });
      }
    }
  }

  // ── sugestões: o que os números mostram sobre os próprios critérios ──
  const sugestoes: Sugestao[] = [];
  const duvidas: Array<Sugestao & { olhadas: number }> = [];
  const nDias = plural(dias.length, 'dia', 'dias');
  // Uma sugestão por critério (o ajuste é do critério inteiro) ou por canal (a área e a foto são do canal).
  const jaSugerido = new Set<string>();
  const uma = (chave: string): boolean => !jaSugerido.has(chave) && Boolean(jaSugerido.add(chave));
  // Os de pior número primeiro: é deles a sugestão quando o critério vale em vários canais.
  const naDe = (s: Serie): number => juntar('na', porSerie.get(chaveDaSerie(s)) ?? []) ?? 0;
  for (const s of [...e.series].sort((a, b) => naDe(b) - naDe(a))) {
    const cs = porSerie.get(chaveDaSerie(s)) ?? [];
    const julgadas = soma(cs.map((c) => c.julgadas));
    if (julgadas < 40) continue;
    const na = juntar('na', cs) ?? 0;
    const custo = soma(cs.map((c) => c.custoCentavos));
    const semResposta = soma(cs.map((c) => (c.julgadas ? (c.custoCentavos * c.na) / c.julgadas : 0)));
    const onde = lugarDe(s);
    const noCanal = (variasZonas.get(s.regraId) ?? 1) > 1 ? ` (${onde})` : '';
    const leTexto = !DO_DETECTOR.has(s.tipo);
    if (leTexto && na >= 50 && !s.areaDesenhada && uma(`area|${s.pontoId}`)) {
      sugestoes.push({
        setorId: s.setorId, icone: 'area', titulo: `Marque um quadro em ${s.pontoNome}`,
        texto: [
          `“${s.regraNome}” não consegue avaliar em `, { forte: `${porcento(na)} das olhadas` }, ' neste canal.',
          ...(semResposta >= 1 ? [` Em ${nDias}, `, { forte: dinheiro(semResposta) }, ' foram gastos em perguntas que voltaram sem resposta.'] : []),
          ' A pergunta é feita sobre a imagem completa; com o critério num quadro marcado, a imagem que sobe é só o que importa.',
        ],
        acao: { tipo: 'area', rotulo: 'Abrir o canal', pontoId: s.pontoId },
      });
    } else if ((s.tipo === 'estado' || s.tipo === 'acao') && s.porteiro === 'sempre' && na >= 30 && uma(`pessoa|${s.regraId}`)) {
      sugestoes.push({
        setorId: s.setorId, icone: 'pessoa', titulo: `Só confira “${s.regraNome}” com alguém na área`,
        texto: [
          `Em ${onde}, ele não dá para avaliar em `, { forte: `${porcento(na)} das olhadas` },
          ...(semResposta >= 1 ? [' — cerca de ', { forte: dinheiro(semResposta) }, ` em ${nDias}.`] : ['.']),
          ' Se ele depende de gente na imagem, ligue “Com pessoa na área”: a loja confere antes, sem custo, e só pergunta quando há alguém.',
        ],
        acao: { tipo: 'criterio', rotulo: 'Ajustar o critério', regraId: s.regraId, porteiro: 'pessoa' },
      });
    }
    // A foto padrão serve ao critério que olha o ESTADO do lugar e que de fato varia (a bancada que às vezes
    // está suja). O que quase não consegue avaliar tem outro problema antes; e o que nunca fica fora (a touca,
    // quando há alguém) não é coisa que uma foto do lugar vazio resolva.
    const foraDoPeriodo = juntar('fora', cs) ?? 0;
    if (s.tipo === 'estado' && !s.comPadrao && s.fotosPadrao === 0 && custo >= 50 && julgadas >= 200 && na < 30 && foraDoPeriodo >= 5 && uma(`foto|${s.pontoId}`)) {
      sugestoes.push({
        setorId: s.setorId, icone: 'foto', titulo: `Use a foto padrão em “${s.regraNome}”${noCanal}`,
        texto: [
          `Hoje cada olhada de ${onde} vai à nuvem: `, { forte: `${julgadas.toLocaleString('pt-BR')} análises e ${dinheiro(custo)}` }, ` em ${nDias}.`,
          ' Com a foto padrão do canal guardada, a loja compara sozinha e só pergunta à nuvem quando a cena está diferente.',
        ],
        acao: { tipo: 'area', rotulo: 'Ver a foto padrão', pontoId: s.pontoId },
      });
    }
    // O critério ligado que, em duas semanas ou mais de olhadas, nunca ficou fora nem avisou.
    const rotina = soma(cs.map((c) => c.julgadas - c.extras));
    if (s.ativa && dias.length >= 14 && rotina >= 500 && soma(cs.map((c) => c.fora)) === 0 && soma(cs.map((c) => c.alertas)) === 0 && na < 30) {
      duvidas.push({
        olhadas: rotina,
        setorId: s.setorId, icone: 'duvida', titulo: `“${s.regraNome}”${noCanal} nunca ficou fora do critério: vale manter?`,
        texto: [
          `Em ${nDias} foram `, { forte: `${rotina.toLocaleString('pt-BR')} olhadas` }, ` em ${onde} e nenhuma fora do critério.`,
          ' Se o limite está folgado demais, ele não avisa do que importa; se está certo, é só a confirmação de que vai bem.',
        ],
        acao: { tipo: 'criterio', rotulo: 'Ver o critério', regraId: s.regraId },
      });
    }
  }
  // Das dúvidas, só as de mais olhadas: é onde a pergunta mais pesa, e a lista não vira só isso.
  sugestoes.push(...duvidas.sort((a, b) => b.olhadas - a.olhadas).slice(0, MAX_DUVIDAS).map(({ olhadas: _o, ...d }) => d));
  // da relação forte nasce o critério que ninguém pensou em cadastrar
  for (const r of relacoesCruas) {
    if (r.forca !== 'forte' || r.baixa <= r.alta) continue;
    const sm = serieDoInd(r.medida);
    const st = serieDoInd(r.taxa);
    if ((sm.minimo ?? 0) >= r.limiar) continue; // já existe quem avise disso
    const objetos = pluralDoObjeto(sm.objeto!);
    // O critério vale nas horas em que a relação foi medida. Fora delas, ter menos gente é o normal: sem a
    // faixa de horas ele avisaria o dia todo. Das horas comparadas, fica o maior trecho de horas seguidas
    // (a gaveta de critério guarda uma faixa só).
    let trecho: number[] = [];
    let atual: number[] = [];
    for (const h of r.horas) {
      atual = atual.length && ordemDaHora(h) - ordemDaHora(atual[atual.length - 1]!) === 1 ? [...atual, h] : [h];
      if (atual.length > trecho.length) trecho = atual;
    }
    const [de, ate] = [trecho[0]!, trecho[trecho.length - 1]!];
    const pico = picoDoSetor.get(r.setorId);
    const quando = pico && pico.de === de && pico.ate === ate ? 'no pico' : `das ${hh(de)} às ${hh(ate + 1)}`;
    const criterio: CriterioProposto = {
      nome: `Pelo menos ${r.limiar} em ${r.medida.onde} ${quando}`, tipo: 'contagem', objeto: sm.objeto!, minimo: r.limiar, maximo: null, zonaId: sm.zonaId, lugar: r.medida.onde,
      janela: [emPonto(de), emPonto(ate + 1)], regra: `pelo menos ${r.limiar} × ${sm.objeto}`,
      texto: `Das ${hh(de)} às ${hh(ate + 1)} há pelo menos ${plural(r.limiar, sm.objeto!, objetos)} em ${r.medida.onde}.`,
    };
    sugestoes.push({
      setorId: r.setorId, icone: 'criterio', titulo: `Crie o critério “${criterio.nome}”`,
      texto: [
        `Em ${nDias}, ${r.medida.onde} ficou com menos de ${r.limiar} em `, { forte: plural(r.poucas, 'hora', 'horas') },
        `. Nessas horas “${st.regraNome}” fica fora do critério em `, { forte: `${porcento(r.baixa)} das olhadas` },
        `; com ${r.limiar} ou mais, em ${porcento(r.alta)}.`,
        (sm.minimo ?? 0) > 0 ? ` Hoje “${sm.regraNome}” só pede ${sm.minimo}.` : ' Hoje nenhum critério avisa disso.',
      ],
      acao: { tipo: 'criar', rotulo: 'Criar critério', criterio },
    });
  }
  const ordemDoSetor = new Map(e.setores.map((s, i) => [s.id, i]));
  // na ordem dos setores; dentro de cada um, o que pede ação primeiro e a dúvida por último
  sugestoes.sort(
    (a, b) =>
      (ordemDoSetor.get(a.setorId) ?? 99) - (ordemDoSetor.get(b.setorId) ?? 99) ||
      Number(a.icone === 'duvida') - Number(b.icone === 'duvida') ||
      a.titulo.localeCompare(b.titulo, 'pt-BR'),
  );
  sugestoes.splice(MAX_SUGESTOES);

  // ── o parecer: uma frase por lente ──
  const forte = aRever.find((a) => a.grave) ?? aRever[0];
  const quando = (a: Anomalia): string => (a.dia === hoje ? 'hoje' : a.dia === somaDias(hoje, -1) ? 'ontem' : `${DIA[diaDaSemana(a.dia)]}, ${diaEMes(a.dia)}`);
  const sobe = tendencias.find((t) => t.sentido === t.ruim) ?? tendencias[0];
  const frasePlana = (f: Frase): string => f.map((t) => (typeof t === 'string' ? t : t.forte)).join('');
  const primeira = descricoes.find((d) => d.texto)?.texto ?? null;
  const parecer: Padroes['parecer'] = {
    frequencia: primeira ? `${primeira.split('. ').slice(0, 2).join('. ').replace(/\.$/, '')}.` : null,
    anomalias: forte
      ? [
          { forte: `${aRever.length === 1 ? '1 saída do padrão espera' : `${aRever.length} saídas do padrão esperam`} a sua revisão.` },
          ` A mais forte: ${quando(forte)}, das ${horas(forte.hora)}, em ${forte.onde} — ${forte.curto}.`,
        ]
      : ['Nada fugiu do padrão que ainda precise de revisão.'],
    tendencia: sobe
      ? [{ forte: `${sobe.titulo}: ${sobe.sentido}${sobe.seguidas > 1 ? ` há ${sobe.seguidas} semanas` : ''}.` }, ` ${frasePlana(sobe.texto).trim()}`]
      : null,
  };

  return {
    hoje, base, suficiente: true, setores: e.setores, indicadores, descricoes, semana, relacoes, anomalias, aRever: aRever.length,
    hojeContraONormal, tendencias, sugestoes, parecer,
  };
}
