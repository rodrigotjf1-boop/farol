// =====================================================================
// A saúde do computador do agente — a conta da tela (A26, M2)
// =====================================================================
// A API devolve as horas (`GET /v1/lojas/:id/computador/saude`); aqui ela
// vira o que a tela desenha: a hora (ou o dia) no relógio da LOJA, a média e
// o pico da medida escolhida, se a loja estava aberta e o pico de cada
// minuto da hora. Nada aqui busca nada: é testado pela API
// (`api/testes/saude-da-maquina.test.ts`), como `lib/planta.ts`.
// =====================================================================

export type MedidaDaHora = { media: number | null; max: number | null };
export type SensorDaHora = { soma: number; amostras: number; max: number };
export type HoraDaSaude = {
  hora: string;
  amostras: number;
  cpu: MedidaDaHora;
  mem: MedidaDaHora;
  gpu: MedidaDaHora;
  sensores: Record<string, SensorDaHora | number | string> | null;
  minutos: Array<[number, Record<string, number>]> | null;
  discoLivreGb: number | null;
  discoTotalGb: number | null;
};
export type Pico = { valor: number; quando: string } | null;
export type ResumoDaSaude = {
  cpu: { media: number | null; pico: Pico };
  mem: { media: number | null; pico: Pico };
  gpu: { media: number | null; pico: Pico };
  sensores: Record<string, { media: number; pico: Pico }>;
  minutosAcima: { cpu: number; mem: number; gpu: number; gpuTempC: number };
  placaSegurou: { temperatura: number; energia: number };
  discoSaude: string | null;
  ligadoHaH: number | null;
  sobrecarregado: boolean;
  esquentando: boolean;
  porque: string[];
};
export type Queda = { desligou: string | null; ligou: string; causa: 'energia' | 'tela-azul' | 'botao' | 'suspensao'; bugcheck: string | null; foraMin: number | null };
export type Limites = { cpuPct: number; memPct: number; gpuPct: number; gpuTempC: number; tempPlacaMaeC: number; discoTempC: number; minutosParaSobrecarga: number };
export type SaudeDaMaquina = {
  fuso: string;
  dias: number;
  maquina: { processador?: string; nucleos?: number; memoriaGb?: number; placaDeVideo?: string } | null;
  limites: Limites;
  ultimas24h: ResumoDaSaude;
  periodo: ResumoDaSaude;
  horas: HoraDaSaude[];
  quedas: Queda[];
};

/** O que o gráfico pode mostrar. As três primeiras vêm de qualquer agente; as outras, do pacote que lê os sensores. */
export const MEDIDAS = {
  cpu: { nome: 'Processador', unidade: '%', limite: (l: Limites) => l.cpuPct, sensor: false },
  mem: { nome: 'Memória', unidade: '%', limite: (l: Limites) => l.memPct, sensor: false },
  gpu: { nome: 'Placa de vídeo', unidade: '%', limite: (l: Limites) => l.gpuPct, sensor: false },
  gpuTempC: { nome: 'Temperatura da placa', unidade: '°C', limite: (l: Limites) => l.gpuTempC, sensor: true },
  tempPlacaMaeC: { nome: 'Placa-mãe', unidade: '°C', limite: (l: Limites) => l.tempPlacaMaeC, sensor: true },
} as const;
export type Medida = keyof typeof MEDIDAS;

const ehSensor = (v: unknown): v is SensorDaHora =>
  typeof v === 'object' && v !== null && typeof (v as SensorDaHora).soma === 'number' && typeof (v as SensorDaHora).amostras === 'number';

/** A média e o pico da medida numa hora; nulos quando a hora não tem a medida. */
export function daHora(h: HoraDaSaude, m: Medida): MedidaDaHora & { amostras: number } {
  if (m === 'cpu' || m === 'mem' || m === 'gpu') return { ...h[m], amostras: h.amostras };
  const s = h.sensores?.[m];
  if (!ehSensor(s) || s.amostras <= 0) return { media: null, max: null, amostras: 0 };
  return { media: Math.round((s.soma / s.amostras) * 10) / 10, max: s.max, amostras: s.amostras };
}

/** As horas trazem algum sensor? Agente antigo não manda: a tela esconde o que é de sensor. */
export const temSensores = (horas: readonly HoraDaSaude[]): boolean => horas.some((h) => h.sensores && Object.keys(h.sensores).length > 0);

/** O dia da semana (1 = segunda), a data e a hora no relógio da loja. */
export function noRelogioDaLoja(iso: string, fuso: string): { dia: number; data: string; hora: number } {
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone: fuso, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const de = (t: string) => partes.find((p) => p.type === t)?.value ?? '';
  return {
    dia: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(de('weekday')) + 1,
    data: `${de('year')}-${de('month')}-${de('day')}`,
    hora: Number(de('hour')),
  };
}

/** A loja estava aberta nesta hora? Pelos trechos (minutos do dia) de cada dia da semana; sem horário: não se sabe. */
export function abertaNaHora(semana: ReadonlyArray<{ dia: number; aberta: ReadonlyArray<readonly [number, number]> }> | null, dia: number, hora: number): boolean | null {
  if (!semana || !semana.length) return null;
  const d = semana.find((x) => x.dia === dia);
  if (!d) return null;
  const ini = hora * 60;
  return d.aberta.some(([a, b]) => a < ini + 60 && b > ini);
}

export type Barra = {
  chave: string;
  rotulo: string;
  media: number | null;
  pico: number | null;
  /** Quantas horas entraram (o dia junta as dele). */
  horas: number;
  aberta: boolean | null;
  /** Os índices das horas desta barra, em `SaudeDaMaquina.horas`. */
  indices: number[];
};

/**
 * As barras do gráfico: uma por hora (até um dia) ou uma por dia (7 e 31 dias), no relógio da loja. A média do dia é a
 * das horas pesada pelas amostras; o pico, o maior.
 */
export function barras(horas: readonly HoraDaSaude[], m: Medida, fuso: string, porDia: boolean,
  semana: ReadonlyArray<{ dia: number; aberta: ReadonlyArray<readonly [number, number]> }> | null = null): Barra[] {
  const grupos = new Map<string, { rotulo: string; soma: number; n: number; pico: number | null; horas: number; aberta: boolean | null; indices: number[] }>();
  horas.forEach((h, i) => {
    const r = noRelogioDaLoja(h.hora, fuso);
    const v = daHora(h, m);
    const chave = porDia ? r.data : h.hora;
    const rotulo = porDia ? `${r.data.slice(8, 10)}/${r.data.slice(5, 7)}` : `${r.hora}h`;
    const g = grupos.get(chave) ?? { rotulo, soma: 0, n: 0, pico: null, horas: 0, aberta: porDia ? null : abertaNaHora(semana, r.dia, r.hora), indices: [] };
    if (v.media != null) {
      g.soma += v.media * v.amostras;
      g.n += v.amostras;
    }
    if (v.max != null) g.pico = g.pico == null ? v.max : Math.max(g.pico, v.max);
    g.horas += 1;
    g.indices.push(i);
    grupos.set(chave, g);
  });
  return [...grupos.entries()].map(([chave, g]) => ({
    chave,
    rotulo: g.rotulo,
    media: g.n > 0 ? Math.round((g.soma / g.n) * 10) / 10 : null,
    pico: g.pico,
    horas: g.horas,
    aberta: g.aberta,
    indices: g.indices,
  }));
}

/** O pico de cada minuto da hora, para a medida (o minuto que não veio fica nulo). */
export function minutosDaHora(h: HoraDaSaude, m: Medida): Array<number | null> {
  const campo = m;
  const saida: Array<number | null> = Array.from({ length: 60 }, () => null);
  for (const [minuto, picos] of h.minutos ?? []) {
    const v = picos[campo];
    if (typeof v === 'number' && minuto >= 0 && minuto < 60) saida[minuto] = v;
  }
  return saida;
}

const CAUSAS: Record<Queda['causa'], string> = {
  energia: 'falta de energia',
  'tela-azul': 'tela azul (o Windows travou)',
  botao: 'desligado pelo botão',
  suspensao: 'caiu durante a espera',
};
export const causaDaQueda = (c: Queda['causa']): string => CAUSAS[c] ?? c;

/** "19 h 55 min", "2 min", "3 d 4 h". */
export function tempoFora(min: number | null): string {
  if (min == null) return 'tempo não registrado';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ${String(min % 60).padStart(2, '0')} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

/** Quando foi, no relógio da loja: "às 21h" (num dia) ou "24/10 às 21h" (num período maior). */
export function quandoNaLoja(iso: string, fuso: string, comDia: boolean): string {
  const r = noRelogioDaLoja(iso, fuso);
  return comDia ? `${r.data.slice(8, 10)}/${r.data.slice(5, 7)} às ${r.hora}h` : `às ${r.hora}h`;
}

/** Data e hora com minuto, no relógio da loja: "24/10 · 08:49". */
export function dataHoraNaLoja(iso: string, fuso: string): string {
  const partes = new Intl.DateTimeFormat('en-GB', { timeZone: fuso, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(iso));
  const de = (t: string) => partes.find((p) => p.type === t)?.value ?? '';
  return `${de('day')}/${de('month')} · ${de('hour')}:${de('minute')}`;
}

/** O último valor de um campo "solto" dos sensores (saúde do disco, horas ligado), da hora mais nova que o tem. */
export function ultimoDosSensores(horas: readonly HoraDaSaude[], campo: string): number | string | null {
  for (let i = horas.length - 1; i >= 0; i--) {
    const v = horas[i]!.sensores?.[campo];
    if (typeof v === 'number' || typeof v === 'string') return v;
  }
  return null;
}

/** Número com vírgula, sem casas quando não precisa. */
export const num = (n: number | null | undefined, casas = 0): string =>
  n == null ? '—' : n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas });
