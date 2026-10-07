// =====================================================================
// Horário de funcionamento da loja
// =====================================================================
// O horário é DA LOJA. Cada critério só diz se é conferido com ela aberta
// (`no_horario`), fechada (`fora_do_horario`) ou `sempre` — mudou o horário
// da loja, mudou para todos os critérios.
//
// Formato, o mesmo de `regra.janelas`:
//
//   [{ dias: [2, 3, 4, 7], hora_ini: '18:00', hora_fim: '23:30' },
//    { dias: [5, 6],       hora_ini: '18:00', hora_fim: '01:00' }]
//
//   dias: 1 = segunda … 7 = domingo.
//   hora_fim <= hora_ini: fecha no DIA SEGUINTE. A madrugada pertence ao
//   dia em que a loja abriu — sexta das 18h à 1h cobre o sábado à 0h30.
//
// Lista vazia = sempre aberta. É o comportamento de antes desta função
// existir, e é o que impede uma loja sem horário de ficar sem auditoria.
//
// Tudo aqui é conta, sem banco: o mesmo código responde a quem salva o
// horário e a quem pergunta "está aberta agora?".
// =====================================================================

export type Faixa = { dias: number[]; hora_ini: string; hora_fim: string };

export const QUANDOS = ['no_horario', 'fora_do_horario', 'sempre'] as const;
export type Quando = (typeof QUANDOS)[number];

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

// Sete dias, e ninguém abre e fecha mais que umas poucas vezes no dia. O
// teto existe para um corpo malformado não virar uma lista de dez mil.
const MAX_FAIXAS = 28;

/**
 * Confere e normaliza o que veio do console. Devolve as faixas limpas ou a
 * frase do problema.
 */
export function lerHorario(bruto: unknown): { faixas?: Faixa[]; problema?: string } {
  if (!Array.isArray(bruto)) return { problema: 'horario: lista de {dias, hora_ini, hora_fim}' };
  if (bruto.length > MAX_FAIXAS) return { problema: `horario: no máximo ${MAX_FAIXAS} faixas` };

  const faixas: Faixa[] = [];
  for (const [i, f] of bruto.entries()) {
    const onde = `horario[${i}]`;
    if (typeof f !== 'object' || f === null || Array.isArray(f)) {
      return { problema: `${onde}: objeto {dias, hora_ini, hora_fim}` };
    }
    const { dias, hora_ini: ini, hora_fim: fim } = f as Record<string, unknown>;
    if (!Array.isArray(dias) || dias.length === 0) {
      return { problema: `${onde}: dias é uma lista com ao menos um dia (1 = segunda … 7 = domingo)` };
    }
    const limpos = new Set<number>();
    for (const d of dias) {
      if (typeof d !== 'number' || !Number.isInteger(d) || d < 1 || d > 7) {
        return { problema: `${onde}: dia inválido (${String(d)}); use 1 = segunda … 7 = domingo` };
      }
      limpos.add(d);
    }
    if (typeof ini !== 'string' || !HORA.test(ini)) return { problema: `${onde}: hora_ini no formato HH:MM` };
    if (typeof fim !== 'string' || !HORA.test(fim)) return { problema: `${onde}: hora_fim no formato HH:MM` };
    if (ini === fim) {
      // "18:00 às 18:00" tanto pode ser um engano quanto vinte e quatro
      // horas. Quem abre o dia inteiro escreve 00:00 às 23:59.
      return { problema: `${onde}: abrir e fechar na mesma hora não diz nada; para o dia inteiro use 00:00 às 23:59` };
    }
    faixas.push({ dias: [...limpos].sort((a, b) => a - b), hora_ini: ini, hora_fim: fim });
  }
  return { faixas };
}

/** O dia da semana (1 = segunda … 7 = domingo) e a hora "HH:MM" no relógio DA LOJA. */
export function relogioDaLoja(instante: Date, fuso: string): { dia: number; hora: string } {
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone: fuso,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instante);
  const de = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '';
  const dia = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(de('weekday')) + 1;
  return { dia, hora: `${de('hour')}:${de('minute')}` };
}

/** A faixa cobre aquele dia e hora? */
export function faixaContem(f: Faixa, dia: number, hora: string): boolean {
  if (f.hora_ini < f.hora_fim) {
    return f.dias.includes(dia) && hora >= f.hora_ini && hora <= f.hora_fim;
  }
  // Fecha no dia seguinte. A parte de antes da meia-noite é do próprio
  // dia; a de depois pertence ao dia ANTERIOR — é a loja que abriu ontem.
  const ontem = dia === 1 ? 7 : dia - 1;
  return (f.dias.includes(dia) && hora >= f.hora_ini) || (f.dias.includes(ontem) && hora <= f.hora_fim);
}

/**
 * A loja está aberta naquele instante? `null` quando ela não informou
 * horário: não é "aberta" nem "fechada", é "não se sabe" — e quem decide o
 * que fazer com isso é quem chama.
 */
export function abertaEm(horario: Faixa[] | null | undefined, instante: Date, fuso: string): boolean | null {
  if (!horario || horario.length === 0) return null;
  return faixaDeAgora(horario, instante, fuso) !== null;
}

/** A faixa em que a loja está aberta naquele instante, ou `null` se fechada. */
export function faixaDeAgora(horario: Faixa[] | null | undefined, instante: Date, fuso: string): Faixa | null {
  if (!horario || horario.length === 0) return null;
  const { dia, hora } = relogioDaLoja(instante, fuso);
  return horario.find((f) => faixaContem(f, dia, hora)) ?? null;
}

/**
 * O que a tela mostra da loja AGORA: aberta ou fechada, e até que horas.
 * Sai do relógio do servidor, no fuso da loja — o do navegador erra.
 */
export function situacaoAgora(
  horario: Faixa[] | null | undefined,
  instante: Date,
  fuso: string,
): { aberta_agora: boolean | null; fecha_as: string | null } {
  if (!horario || horario.length === 0) return { aberta_agora: null, fecha_as: null };
  const f = faixaDeAgora(horario, instante, fuso);
  return { aberta_agora: f !== null, fecha_as: f?.hora_fim ?? null };
}

/**
 * O critério deve ser conferido naquele instante, pelo horário da loja?
 *
 * Loja sem horário é tratada como sempre aberta: "no horário" roda sempre e
 * "fora do horário" não roda nunca.
 */
export function horaDeConferir(quando: Quando, horario: Faixa[] | null | undefined, instante: Date, fuso: string): boolean {
  if (quando === 'sempre') return true;
  const aberta = abertaEm(horario, instante, fuso) ?? true;
  return quando === 'no_horario' ? aberta : !aberta;
}
