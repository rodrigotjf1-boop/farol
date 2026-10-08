// =====================================================================
// A semana da loja, do jeito que a tela mostra
// =====================================================================
// A API guarda FAIXAS: `{ dias: [2, 3, 4], hora_ini, hora_fim }`. A tela
// mostra SETE DIAS, cada um com a sua hora de abrir e de fechar — é assim
// que o dono da loja pensa o horário. Estas funções são a ponte entre as
// duas formas, e o texto que resume a semana numa linha.
//
// Quem decide se a loja está aberta AGORA é o servidor (e, na loja, o
// agente). Aqui não há conta de relógio.
// =====================================================================

import type { FaixaDeHorario } from '@/lib/api';

export type Dia = { abre: boolean; ini: string; fim: string };

/** Segunda é o dia 1; domingo, o 7 — como no banco. */
export const DIAS = [
  { curto: 'seg', nome: 'Segunda' },
  { curto: 'ter', nome: 'Terça' },
  { curto: 'qua', nome: 'Quarta' },
  { curto: 'qui', nome: 'Quinta' },
  { curto: 'sex', nome: 'Sexta' },
  { curto: 'sáb', nome: 'Sábado' },
  { curto: 'dom', nome: 'Domingo' },
] as const;

/** O que o campo de hora traz quando o dia ainda não tem horário. */
const SUGESTAO: Pick<Dia, 'ini' | 'fim'> = { ini: '18:00', fim: '23:00' };

/**
 * As faixas da API viram sete dias. Um dia que aparece em mais de uma
 * faixa (o console não cria isso, mas a API aceita) fica com a primeira.
 */
export function paraSemana(horario: FaixaDeHorario[]): Dia[] {
  const semana: Dia[] = DIAS.map(() => ({ abre: false, ...SUGESTAO }));
  for (const f of horario) {
    for (const d of f.dias) {
      const dia = semana[d - 1];
      if (dia && !dia.abre) semana[d - 1] = { abre: true, ini: f.hora_ini, fim: f.hora_fim };
    }
  }
  // Dia fechado sugere o horário de um dia aberto: quem marca a segunda
  // quase sempre quer o mesmo da terça.
  const molde = semana.find((d) => d.abre);
  if (molde) for (const d of semana) if (!d.abre) Object.assign(d, { ini: molde.ini, fim: molde.fim });
  return semana;
}

/** Os sete dias viram faixas: dias com a mesma hora andam juntos. */
export function paraFaixas(semana: Dia[]): FaixaDeHorario[] {
  const porHora = new Map<string, number[]>();
  semana.forEach((d, i) => {
    if (!d.abre) return;
    const chave = `${d.ini}|${d.fim}`;
    porHora.set(chave, [...(porHora.get(chave) ?? []), i + 1]);
  });
  return [...porHora].map(([chave, dias]) => {
    const [hora_ini, hora_fim] = chave.split('|') as [string, string];
    return { dias, hora_ini, hora_fim };
  });
}

/** [2, 3, 4, 7] → "ter a qui e dom". */
export function juntarDias(dias: number[]): string {
  const grupos: [number, number][] = [];
  for (const d of [...dias].sort((a, b) => a - b)) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo[1] === d - 1) ultimo[1] = d;
    else grupos.push([d, d]);
  }
  const nome = (d: number) => DIAS[d - 1]?.curto ?? String(d);
  const nomes = grupos.map(([a, b]) => (a === b ? nome(a) : b === a + 1 ? `${nome(a)} e ${nome(b)}` : `${nome(a)} a ${nome(b)}`));
  return nomes.length > 1 ? `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}` : (nomes[0] ?? '');
}

/**
 * A semana numa linha: "ter a qui e dom, 18:00 às 23:30 · sex e sáb, 18:00
 * às 01:00 · seg fechada". `null` quando a loja não informou horário.
 */
export function resumoDoHorario(horario: FaixaDeHorario[]): string | null {
  if (horario.length === 0) return null;
  const partes = horario.map((f) => `${juntarDias(f.dias)}, ${f.hora_ini} às ${f.hora_fim}`);
  const abertos = new Set(horario.flatMap((f) => f.dias));
  const fechados = DIAS.map((_, i) => i + 1).filter((d) => !abertos.has(d));
  if (fechados.length > 0) partes.push(`${juntarDias(fechados)} ${fechados.length === 1 ? 'fechada' : 'fechadas'}`);
  return partes.join(' · ');
}

/** A hora de fechar é menor ou igual à de abrir: fecha no dia seguinte. */
export const fechaNoDiaSeguinte = (d: Pick<Dia, 'ini' | 'fim'>): boolean => d.fim <= d.ini;

/** O que impede de salvar, ou `null`. */
export function problemaDaSemana(semana: Dia[]): string | null {
  for (const [i, d] of semana.entries()) {
    if (!d.abre) continue;
    const nome = DIAS[i]!.nome;
    if (!d.ini || !d.fim) return `${nome}: diga a hora de abrir e a de fechar.`;
    if (d.ini === d.fim) return `${nome}: abrir e fechar na mesma hora não diz nada. Para o dia inteiro, use 00:00 às 23:59.`;
  }
  return null;
}
