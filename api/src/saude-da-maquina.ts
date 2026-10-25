// =====================================================================
// A saúde da máquina: os sensores, o pico de cada minuto e as quedas
// =====================================================================
// O monitoramento pedido pelo dono em 25/10/2026 (migration 056): "relatórios
// de usos por horários, picos de uso, % de uso do processador, da memória e
// da placa, temperaturas, para verificar se o pc está sobrecarregado, se
// sobreaquece. o máximo de dados possíveis."
//
// O agente mede (`agent/farol_agent/sensores.py`) e manda, junto com o uso
// de cada hora (`POST /v1/uso`): `sensores` (soma, amostras e pico de cada
// campo), `minutos` (o pico de cada minuto) e `queda` (o último desligamento
// inesperado, do registro do Windows). Aqui fica a conferência do que chega
// — texto de fora: só os campos conhecidos, nas faixas que valem — e a conta
// que a tela mostra: as médias, os picos, os minutos acima do limite e a
// conclusão "sobrecarregado?" e "esquentando?".
// =====================================================================

/** Os campos somados dos sensores e a faixa de cada um (a mesma de `contratos/uso-da-maquina.json`). */
export const CAMPOS_DOS_SENSORES: Readonly<Record<string, readonly [number, number]>> = {
  gpuMemPct: [0, 100],
  gpuMemMb: [0, 1_000_000],
  gpuTempC: [0, 130],
  gpuPotenciaW: [0, 2_000],
  gpuVentoinhaPct: [0, 100],
  gpuClockMhz: [0, 10_000],
  cpuDesempenhoPct: [0, 400],
  tempPlacaMaeC: [0, 130],
  discoOcupadoPct: [0, 100],
  discoLeituraMbs: [0, 100_000],
  discoEscritaMbs: [0, 100_000],
  discoTempC: [0, 130],
};
/** O que vem no pico de cada minuto: o uso (0–100) e os sensores de `NO_MINUTO` do agente. */
export const CAMPOS_DO_MINUTO: Readonly<Record<string, readonly [number, number]>> = {
  cpu: [0, 100],
  mem: [0, 100],
  gpu: [0, 100],
  gpuTempC: [0, 130],
  gpuPotenciaW: [0, 2_000],
  tempPlacaMaeC: [0, 130],
  discoOcupadoPct: [0, 100],
};
export const CAUSAS_DA_QUEDA = ['energia', 'tela-azul', 'botao', 'suspensao'] as const;
export type CausaDaQueda = (typeof CAUSAS_DA_QUEDA)[number];
export const SAUDES_DO_DISCO = ['ok', 'atencao', 'ruim'] as const;

/**
 * Os limites que a tela usa para dizer "sobrecarregado" e "esquentando". A placa NVIDIA começa a segurar a frequência
 * por volta de 83 °C; processador e memória acima de 90% por muitos minutos é a máquina no limite; disco acima de 60 °C
 * já é calor demais para um SSD.
 */
export const LIMITES = {
  cpuPct: 90,
  memPct: 90,
  gpuPct: 95,
  gpuTempC: 83,
  tempPlacaMaeC: 70,
  discoTempC: 60,
  /** Minutos acima do limite, num dia, para dizer "sobrecarregado". */
  minutosParaSobrecarga: 30,
} as const;

const ehNumero = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const COM_FUSO = /(Z|[+-]\d{2}:?\d{2})$/i;

export type SensoresDaHora = Record<string, { soma: number; amostras: number; max: number } | number | string>;

/** Os `sensores` de uma hora, conferidos: só os campos conhecidos, nas faixas; `amostras` até as da hora. */
export function lerSensores(bruto: unknown, amostrasDaHora: number, onde: string): { sensores?: SensoresDaHora; problema?: string } {
  if (bruto == null) return {};
  if (typeof bruto !== 'object' || Array.isArray(bruto)) return { problema: `${onde}.sensores: objeto` };
  const saida: SensoresDaHora = {};
  for (const [campo, v] of Object.entries(bruto as Record<string, unknown>)) {
    const faixa = CAMPOS_DOS_SENSORES[campo];
    if (faixa) {
      const c = (v ?? {}) as Record<string, unknown>;
      const n = c.amostras;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > amostrasDaHora) {
        return { problema: `${onde}.sensores.${campo}.amostras: inteiro de 1 a amostras (${amostrasDaHora})` };
      }
      if (!ehNumero(c.max) || c.max < faixa[0] || c.max > faixa[1]) return { problema: `${onde}.sensores.${campo}.max: de ${faixa[0]} a ${faixa[1]}` };
      if (!ehNumero(c.soma) || c.soma < faixa[0] * n || c.soma > c.max * n + 0.05) {
        return { problema: `${onde}.sensores.${campo}.soma: entre ${faixa[0]} e o pico, por amostra` };
      }
      saida[campo] = { soma: c.soma, amostras: n, max: c.max };
    } else if (campo === 'discoSaude') {
      if (!SAUDES_DO_DISCO.includes(v as (typeof SAUDES_DO_DISCO)[number])) return { problema: `${onde}.sensores.discoSaude: ${SAUDES_DO_DISCO.join(', ')}` };
      saida[campo] = v as string;
    } else if (campo === 'discoHorasLigado' || campo === 'ligadoHaH') {
      if (!ehNumero(v) || v < 0 || v > 1_000_000) return { problema: `${onde}.sensores.${campo}: número a partir de 0` };
      saida[campo] = v;
    } else if (campo === 'gpuLimitaTemperatura' || campo === 'gpuLimitaEnergia') {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > amostrasDaHora) {
        return { problema: `${onde}.sensores.${campo}: inteiro de 0 a amostras (${amostrasDaHora})` };
      }
      saida[campo] = v;
    }
    // campo desconhecido (agente mais novo que a nuvem): fica de fora, sem recusar a hora
  }
  return { sensores: saida };
}

export type MinutoDaHora = [number, Record<string, number>];

/** Os `minutos` de uma hora, conferidos: até 60, sem repetir o minuto, só os campos conhecidos nas faixas. */
export function lerMinutos(bruto: unknown, onde: string): { minutos?: MinutoDaHora[]; problema?: string } {
  if (bruto == null) return {};
  if (!Array.isArray(bruto) || bruto.length > 60) return { problema: `${onde}.minutos: lista de até 60 [minuto, {campo: pico}]` };
  const vistos = new Set<number>();
  const saida: MinutoDaHora[] = [];
  for (const [i, item] of bruto.entries()) {
    if (!Array.isArray(item) || item.length !== 2) return { problema: `${onde}.minutos[${i}]: [minuto, {campo: pico}]` };
    const [m, picos] = item as [unknown, unknown];
    if (typeof m !== 'number' || !Number.isInteger(m) || m < 0 || m > 59 || vistos.has(m)) {
      return { problema: `${onde}.minutos[${i}]: o minuto de 0 a 59, sem repetir` };
    }
    vistos.add(m);
    if (typeof picos !== 'object' || picos === null || Array.isArray(picos)) return { problema: `${onde}.minutos[${i}]: os picos num objeto` };
    const limpos: Record<string, number> = {};
    for (const [campo, v] of Object.entries(picos as Record<string, unknown>)) {
      const faixa = CAMPOS_DO_MINUTO[campo];
      if (!faixa) continue;
      if (!ehNumero(v) || v < faixa[0] || v > faixa[1]) return { problema: `${onde}.minutos[${i}].${campo}: de ${faixa[0]} a ${faixa[1]}` };
      limpos[campo] = v;
    }
    saida.push([m, limpos]);
  }
  return { minutos: saida.sort((a, b) => a[0] - b[0]) };
}

export type Queda = { desligou: string | null; ligou: string; causa: CausaDaQueda; bugcheck: string | null };

/** A `queda` do corpo: quando apagou (ou nulo) e ligou, com fuso, e a causa. */
export function lerQueda(bruto: unknown, agora: Date = new Date()): { queda?: Queda | null; problema?: string } {
  if (bruto == null) return { queda: null };
  if (typeof bruto !== 'object' || Array.isArray(bruto)) return { problema: 'queda: objeto {desligou, ligou, causa, bugcheck}' };
  const v = bruto as Record<string, unknown>;
  const data = (x: unknown) => typeof x === 'string' && x.length <= 40 && COM_FUSO.test(x.trim()) && !Number.isNaN(Date.parse(x));
  if (!data(v.ligou)) return { problema: 'queda.ligou: data e hora com fuso' };
  if (v.desligou != null && !data(v.desligou)) return { problema: 'queda.desligou: data e hora com fuso, ou nulo' };
  const ligou = Date.parse(v.ligou as string);
  if (ligou > agora.getTime() + 10 * 60_000) return { problema: 'queda.ligou: no futuro' };
  if (v.desligou != null && Date.parse(v.desligou as string) > ligou) return { problema: 'queda.desligou: depois de ligar' };
  if (!CAUSAS_DA_QUEDA.includes(v.causa as CausaDaQueda)) return { problema: `queda.causa: ${CAUSAS_DA_QUEDA.join(', ')}` };
  if (v.bugcheck != null && (typeof v.bugcheck !== 'string' || v.bugcheck.length > 20)) return { problema: 'queda.bugcheck: texto de até 20 letras, ou nulo' };
  return {
    queda: {
      desligou: (v.desligou as string | null | undefined) ?? null,
      ligou: v.ligou as string,
      causa: v.causa as CausaDaQueda,
      bugcheck: (v.bugcheck as string | null | undefined) ?? null,
    },
  };
}

// ───────────────────────── a conta da tela ─────────────────────────

export type HoraDaSaude = {
  hora: Date;
  amostras: number;
  cpu: { media: number | null; max: number | null };
  mem: { media: number | null; max: number | null };
  gpu: { media: number | null; max: number | null };
  sensores: SensoresDaHora | null;
  minutos: MinutoDaHora[] | null;
};

type Pico = { valor: number; quando: string } | null;

export type ResumoDaSaude = {
  /** A média e o pico de cada coisa no período (o pico com a hora em que aconteceu). */
  cpu: { media: number | null; pico: Pico };
  mem: { media: number | null; pico: Pico };
  gpu: { media: number | null; pico: Pico };
  sensores: Record<string, { media: number; pico: Pico }>;
  /** Minutos acima do limite no período (pelo pico de cada minuto). */
  minutosAcima: { cpu: number; mem: number; gpu: number; gpuTempC: number };
  /** Amostras em que a placa segurou a frequência por temperatura ou energia. */
  placaSegurou: { temperatura: number; energia: number };
  discoSaude: string | null;
  ligadoHaH: number | null;
  sobrecarregado: boolean;
  esquentando: boolean;
  /** Por que a tela diz o que diz (frases curtas, na ordem). */
  porque: string[];
};

const r1 = (n: number) => Math.round(n * 10) / 10;

/** O resumo do período: as horas em ordem (a mais velha primeiro). */
export function resumirSaude(horas: HoraDaSaude[]): ResumoDaSaude {
  const pecas = ['cpu', 'mem', 'gpu'] as const;
  const base = Object.fromEntries(
    pecas.map((p) => {
      const com = horas.filter((h) => h[p].media != null);
      const media = com.length ? r1(com.reduce((s, h) => s + (h[p].media as number) * h.amostras, 0) / com.reduce((s, h) => s + h.amostras, 0)) : null;
      let pico: Pico = null;
      for (const h of horas) if (h[p].max != null && (!pico || (h[p].max as number) > pico.valor)) pico = { valor: h[p].max as number, quando: h.hora.toISOString() };
      return [p, { media, pico }];
    }),
  ) as Pick<ResumoDaSaude, 'cpu' | 'mem' | 'gpu'>;

  const sensores: ResumoDaSaude['sensores'] = {};
  for (const campo of Object.keys(CAMPOS_DOS_SENSORES)) {
    let soma = 0;
    let n = 0;
    let pico: Pico = null;
    for (const h of horas) {
      const c = h.sensores?.[campo];
      if (!c || typeof c !== 'object') continue;
      soma += c.soma;
      n += c.amostras;
      if (!pico || c.max > pico.valor) pico = { valor: c.max, quando: h.hora.toISOString() };
    }
    if (n > 0) sensores[campo] = { media: r1(soma / n), pico };
  }

  const minutosAcima = { cpu: 0, mem: 0, gpu: 0, gpuTempC: 0 };
  const placaSegurou = { temperatura: 0, energia: 0 };
  let discoSaude: string | null = null;
  let ligadoHaH: number | null = null;
  for (const h of horas) {
    for (const [, picos] of h.minutos ?? []) {
      if ((picos.cpu ?? 0) >= LIMITES.cpuPct) minutosAcima.cpu += 1;
      if ((picos.mem ?? 0) >= LIMITES.memPct) minutosAcima.mem += 1;
      if ((picos.gpu ?? 0) >= LIMITES.gpuPct) minutosAcima.gpu += 1;
      if ((picos.gpuTempC ?? 0) >= LIMITES.gpuTempC) minutosAcima.gpuTempC += 1;
    }
    const s = h.sensores ?? {};
    if (typeof s.gpuLimitaTemperatura === 'number') placaSegurou.temperatura += s.gpuLimitaTemperatura;
    if (typeof s.gpuLimitaEnergia === 'number') placaSegurou.energia += s.gpuLimitaEnergia;
    if (typeof s.discoSaude === 'string') discoSaude = s.discoSaude;
    if (typeof s.ligadoHaH === 'number') ligadoHaH = s.ligadoHaH;
  }

  const porque: string[] = [];
  const dias = Math.max(1, horas.length / 24);
  const sobre = minutosAcima.cpu / dias >= LIMITES.minutosParaSobrecarga || minutosAcima.mem / dias >= LIMITES.minutosParaSobrecarga
    || minutosAcima.gpu / dias >= LIMITES.minutosParaSobrecarga;
  if (minutosAcima.cpu) porque.push(`processador acima de ${LIMITES.cpuPct}% em ${minutosAcima.cpu} minuto(s)`);
  if (minutosAcima.mem) porque.push(`memória acima de ${LIMITES.memPct}% em ${minutosAcima.mem} minuto(s)`);
  if (minutosAcima.gpu) porque.push(`placa acima de ${LIMITES.gpuPct}% em ${minutosAcima.gpu} minuto(s)`);
  const quente: string[] = [];
  if ((sensores.gpuTempC?.pico?.valor ?? 0) >= LIMITES.gpuTempC) quente.push(`placa chegou a ${sensores.gpuTempC!.pico!.valor} °C`);
  if (placaSegurou.temperatura > 0) quente.push(`a placa segurou a frequência por temperatura em ${placaSegurou.temperatura} amostra(s)`);
  if ((sensores.tempPlacaMaeC?.pico?.valor ?? 0) >= LIMITES.tempPlacaMaeC) quente.push(`placa-mãe chegou a ${sensores.tempPlacaMaeC!.pico!.valor} °C`);
  if ((sensores.discoTempC?.pico?.valor ?? 0) >= LIMITES.discoTempC) quente.push(`disco chegou a ${sensores.discoTempC!.pico!.valor} °C`);
  porque.push(...quente);
  if (discoSaude && discoSaude !== 'ok') porque.push(discoSaude === 'ruim' ? 'o disco diz que está com defeito' : 'o disco pede atenção');
  return { ...base, sensores, minutosAcima, placaSegurou, discoSaude, ligadoHaH, sobrecarregado: sobre, esquentando: quente.length > 0, porque };
}
