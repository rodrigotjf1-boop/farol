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

/** "87%" — a confiança é guardada como fração (de 0 a 1) e mostrada em porcento, sem casas. */
export function confiancaEmPorcento(v: number | null): string {
  return v === null ? '—' : `${Math.round(v * 100)}%`;
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

/**
 * Uma data no relógio da loja, como se escreve num prazo: "27/10" no ano de agora, "15/10/2027" em outro ano.
 * Para validade e vencimento, em que a hora não importa.
 */
export function dataNaLoja(iso: string, fuso: string, agora: Date = new Date()): string {
  const f = (d: Date) => new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
  const d = f(new Date(iso));
  return d.slice(6) === f(agora).slice(6) ? d.slice(0, 5) : d;
}

/**
 * "hoje, 04:10", "ontem, 04:10" ou "09/10, 04:10" — no relógio DA LOJA.
 * Para o que acontece uma vez por dia (a busca das fichas): o que importa é
 * de que dia é, dito como se fala.
 */
export function diaFaladoNaLoja(iso: string | null, fuso: string, agora: Date = new Date()): string {
  if (!iso) return '—';
  const dia = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, day: '2-digit', month: '2-digit', year: 'numeric' });
  const quando = new Date(iso);
  const d = dia.format(quando);
  const hora = horaNaLoja(iso, fuso);
  if (d === dia.format(agora)) return `hoje, ${hora}`;
  if (d === dia.format(new Date(agora.getTime() - 24 * 3600_000))) return `ontem, ${hora}`;
  return `${d.slice(0, 5)}, ${hora}`;
}

const UNIDADES_QUE_NAO_MUDAM = new Set(['kg', 'g', 'mg', 'l', 'ml', 'un', 'und', 'cm', 'm']);

/** O plural de uma unidade escrita por extenso: "fatia" → "fatias", "porção" → "porções", "colher" → "colheres". */
function noPlural(unidade: string): string {
  const u = unidade.trim();
  if (u.length < 3 || UNIDADES_QUE_NAO_MUDAM.has(u.toLowerCase()) || /[^\p{L}]/u.test(u) || /s$/i.test(u)) return u;
  if (/ão$/i.test(u)) return u.replace(/ão$/i, 'ões');
  if (/[rz]$/i.test(u)) return `${u}es`;
  if (/m$/i.test(u)) return u.replace(/m$/i, 'ns');
  return `${u}s`;
}

/**
 * A quantidade de um ingrediente, como se lê numa ficha: "1 unidade",
 * "2 fatias", "120 g" (a fração de quilo vira gramas), "15 ml".
 */
export function quantidadeDaFicha(quantidade: number | null, unidade: string | null): string {
  if (quantidade === null) return unidade ?? '—';
  let q = quantidade;
  let u = (unidade ?? '').trim();
  const pequena = q > 0 && q < 1;
  if (pequena && u.toLowerCase() === 'kg') [q, u] = [q * 1000, 'g'];
  else if (pequena && u.toLowerCase() === 'l') [q, u] = [q * 1000, 'ml'];
  const numeroEscrito = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(Math.round(q * 1000) / 1000);
  if (!u) return numeroEscrito;
  return `${numeroEscrito} ${q > 1 ? noPlural(u) : u}`;
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
