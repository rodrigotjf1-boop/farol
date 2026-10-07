// Como o console escreve número, hora e proporção. Um lugar só, para a
// mesma grandeza não aparecer de dois jeitos em duas telas.

const inteiro = new Intl.NumberFormat('pt-BR');

export const numero = (n: number): string => inteiro.format(n);

/** "1 canal", "3 canais". */
/** Texto que a API manda em minúscula e sem ponto vira frase: "Esta loja …." */
export function frase(texto: string): string {
  const t = texto.trim();
  if (!t) return '';
  const comMaiuscula = t.charAt(0).toLocaleUpperCase('pt-BR') + t.slice(1);
  return /[.!?…]$/.test(comMaiuscula) ? comMaiuscula : comMaiuscula + '.';
}

export function plural(n: number, um: string, varios: string): string {
  return `${numero(n)} ${n === 1 ? um : varios}`;
}

/** Quanto `parte` é de `total`, de 0 a 100, sem dividir por zero. */
export function porcento(parte: number, total: number): number {
  return total > 0 ? Math.round((parte / total) * 100) : 0;
}

/** "0,87" — confiança é fração, com vírgula. */
export function fracao(v: number | null, casas = 2): string {
  return v === null ? '—' : v.toFixed(casas).replace('.', ',');
}

/** "0,09 s", "1,9 s" — tempo médio de um julgamento. */
export function segundos(ms: number | null): string {
  if (ms === null) return '—';
  const s = ms / 1000;
  return `${s.toFixed(s < 1 ? 2 : 1).replace('.', ',')} s`;
}

/**
 * A hora de um instante, no relógio DA LOJA.
 *
 * O navegador de quem olha pode estar em outro fuso (o dono viajando, o
 * suporte em outra cidade). "A que horas foi" é a hora da cozinha.
 */
export function horaNaLoja(iso: string | null, fuso: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

/** "07/10 21:42" no relógio da loja; só a hora quando é de hoje. */
export function quandoNaLoja(iso: string | null, fuso: string, agora: string): string {
  if (!iso) return '—';
  const dia = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, day: '2-digit', month: '2-digit' });
  const d = dia.format(new Date(iso));
  return d === dia.format(new Date(agora)) ? horaNaLoja(iso, fuso) : `${d} ${horaNaLoja(iso, fuso)}`;
}

/** "07/10 21:42" no relógio de quem olha — para telas sem loja definida. */
export function diaEHora(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/**
 * O rótulo de um balde da série. `inicio` já vem no relógio da loja, sem
 * fuso ("2026-10-07T12:00:00"), então se lê o texto — passar por `Date`
 * aplicaria o fuso do navegador por cima.
 */
export function rotuloDoBalde(inicio: string, passo: 'hora' | 'dia'): string {
  if (passo === 'hora') return `${inicio.slice(11, 13)}h`;
  const [ano, mes, dia] = inicio.slice(0, 10).split('-').map(Number);
  // Meio-dia UTC: qualquer fuso cai no mesmo dia da semana.
  const semana = new Date(Date.UTC(ano!, mes! - 1, dia!, 12)).getUTCDay();
  return `${DIAS[semana]} ${String(dia).padStart(2, '0')}`;
}

/** "desde as 14h" a partir de um instante, no relógio da loja. */
export function desdeAHora(iso: string | null | undefined, fuso: string): string | null {
  if (!iso) return null;
  const h = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, hour: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  return `desde as ${Number(h.replace(/\D/g, ''))}h`;
}
