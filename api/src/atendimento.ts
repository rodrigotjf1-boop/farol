// =====================================================================
// O atendimento na planta — a conta, sem banco (pedido do dono, 28/10/2026)
// =====================================================================
// "Faça a integração com o balcão, e o atendimento delivery e saída dos
// entregadores." Protótipo aprovado em 29/10/2026 (`mockups/farol-planta-atendimento.html`).
//
// O dono marca na planta as ÁREAS DE MEDIDA (`Area` em `planta.ts`), e a
// conta sai dos CAMINHOS que o agente já manda a cada minuto (1 ponto por
// segundo, um número por pessoa e por dia, sem nome — `planta_minuto`):
//
//   • área de ESPERA: cada vez que um caminho entra na área e fica — de
//     quando entra até quando sai. Sair por até `toleranciaForaS` (o ponto
//     pulou a borda, a pessoa se mexeu) não termina a espera; quem fica menos
//     que `esperaMinimaS` só passou e não conta;
//   • PORTA: o caminho que COMEÇA na área é alguém entrando; o que TERMINA
//     nela é alguém saindo — e se os dois são o mesmo caminho, o tempo entre
//     um e outro é o "tempo na loja". O caminho que termina perto do fim do
//     período pode só estar piscando: a saída dele não conta ainda.
//
// O número do caminho recomeça a cada dia: o mesmo número em horas
// distantes são caminhos diferentes (separados por um vazio de mais de
// `vazioQueSeparaS`). O caminho fica 7 dias (`planta-viva.ts`): o período
// desta conta vai até isso.
//
// Sem nome e sem rosto: a resposta tem horas e durações, nunca o caminho.
// =====================================================================

import { dentroDaArea, type Area } from './planta.js';

export const ATENDIMENTO = {
  /** Quem fica menos que isto numa área de espera só passou. */
  esperaMinimaS: 5,
  /** Sair da área por até isto não termina a espera. */
  toleranciaForaS: 4,
  /** O caminho que termina a menos disto do fim do período ainda pode voltar: a saída dele não conta. */
  fimRecenteS: 15,
  /** Dois pontos do mesmo número separados por mais que isto são caminhos diferentes (o número é do dia). */
  vazioQueSeparaS: 30,
  /** O quanto se lê antes e depois do período, para saber onde o caminho começou e terminou. */
  margemMin: 2,
  /** O período vai até a guarda do caminho. */
  periodoMaximoDias: 7,
  /** Uma espera acima disto entra na conta "acima de 5 min". */
  esperaLongaS: 300,
  /** O máximo de esperas e de entradas/saídas devolvidas por área (as mais novas). */
  maximoPorArea: 5000,
} as const;

export type MinutoComCaminhos = { minuto: Date; caminhos: [number, [number, number, number][]][] | null };
/** Um ponto de um caminho: [ms, x, y]. */
type Ponto = [number, number, number];

export type HoraDeEspera = { hora: string; pessoas: number; medianaS: number };
export type EsperaDaArea = {
  id: string;
  nome: string;
  tipo: 'espera';
  /** Cada espera: [quando começou (ISO), quantos segundos]. */
  visitas: [string, number][];
  pessoas: number;
  medianaS: number | null;
  maiorS: number | null;
  acimaDe5Min: number;
  porHora: HoraDeEspera[];
  /** Quantas pessoas estão na área agora (pelo ao vivo); nulo sem sinal. */
  agora: number | null;
};
export type HoraDaPorta = { hora: string; entradas: number; saidas: number };
export type PortaDaArea = {
  id: string;
  nome: string;
  tipo: 'porta';
  entradas: string[];
  saidas: string[];
  /** Da entrada à saída pela mesma porta, de quem as câmeras seguiram o caminho inteiro. */
  naLoja: { quantos: number; medianaS: number | null };
  porHora: HoraDaPorta[];
  agora: number | null;
};
export type ResultadoDaArea = EsperaDaArea | PortaDaArea;

const mediana = (v: readonly number[]): number | null => {
  if (!v.length) return null;
  const o = [...v].sort((a, b) => a - b);
  return o[Math.floor(o.length / 2)]!;
};
const horaDe = (ms: number): string => new Date(Math.floor(ms / 3_600_000) * 3_600_000).toISOString();

/** Os caminhos do período: os pontos de cada número em ordem, cortados onde o mesmo número some por muito tempo. */
export function caminhosDosMinutos(minutos: readonly MinutoComCaminhos[]): Ponto[][] {
  const por = new Map<number, Ponto[]>();
  for (const m of [...minutos].sort((a, b) => a.minuto.getTime() - b.minuto.getTime())) {
    const base = m.minuto.getTime();
    for (const [n, pontos] of m.caminhos ?? []) {
      const lista = por.get(n) ?? [];
      for (const [seg, x, y] of pontos) lista.push([base + seg * 1000, x, y]);
      por.set(n, lista);
    }
  }
  const saida: Ponto[][] = [];
  for (const lista of por.values()) {
    lista.sort((a, b) => a[0] - b[0]);
    let atual: Ponto[] = [];
    for (const p of lista) {
      if (atual.length && p[0] - atual[atual.length - 1]![0] > ATENDIMENTO.vazioQueSeparaS * 1000) {
        saida.push(atual);
        atual = [];
      }
      atual.push(p);
    }
    if (atual.length) saida.push(atual);
  }
  return saida;
}

/** As esperas de um caminho numa área: [começo, fim] em ms (fim = o último ponto dentro). */
export function esperasNoCaminho(caminho: readonly Ponto[], area: Area): [number, number][] {
  const saida: [number, number][] = [];
  let atual: [number, number] | null = null;
  for (const [t, x, y] of caminho) {
    if (!dentroDaArea(area, x, y)) continue;
    if (atual && t - atual[1] <= ATENDIMENTO.toleranciaForaS * 1000) atual[1] = t;
    else {
      if (atual) saida.push(atual);
      atual = [t, t];
    }
  }
  if (atual) saida.push(atual);
  return saida;
}

/** Quantas pessoas do instante estão dentro da área (nulo = sem sinal ao vivo). */
const quantasDentro = (area: Area, pessoas: readonly { x: number; y: number }[] | null): number | null =>
  pessoas === null ? null : pessoas.filter((p) => dentroDaArea(area, p.x, p.y)).length;

/**
 * A conta da aba Atendimento. `minutos` pode trazer a margem antes e depois do período (para saber onde cada caminho
 * começou e terminou); só conta o que ACONTECEU dentro de [de, ate). `fimDosDados`: até onde se leu (o agora, ou o fim
 * do período com a margem) — o caminho que termina perto disso pode continuar, e a saída dele não conta.
 * `agoraPessoas`: as posições ao vivo (nulo sem sinal) — só para "quantos estão lá agora".
 */
export function atendimentoDoPeriodo(
  minutos: readonly MinutoComCaminhos[],
  areas: readonly Area[],
  de: Date,
  ate: Date,
  { fimDosDados = new Date(ate.getTime() + ATENDIMENTO.margemMin * 60_000), agoraPessoas = null }:
    { fimDosDados?: Date; agoraPessoas?: readonly { x: number; y: number }[] | null } = {},
): ResultadoDaArea[] {
  const A = ATENDIMENTO;
  const caminhos = caminhosDosMinutos(minutos);
  const deMs = de.getTime();
  const ateMs = ate.getTime();
  const noPeriodo = (t: number) => t >= deMs && t < ateMs;
  const terminou = (c: readonly Ponto[]) => c[c.length - 1]![0] < fimDosDados.getTime() - A.fimRecenteS * 1000;

  return areas.map((area): ResultadoDaArea => {
    if (area.tipo === 'espera') {
      const visitas: [number, number][] = [];
      for (const c of caminhos) {
        for (const [ini, fim] of esperasNoCaminho(c, area)) {
          const s = Math.round((fim - ini) / 1000) + 1;
          if (s >= A.esperaMinimaS && noPeriodo(ini)) visitas.push([ini, s]);
        }
      }
      visitas.sort((a, b) => a[0] - b[0]);
      const duracoes = visitas.map((v) => v[1]);
      const horas = new Map<string, number[]>();
      for (const [ini, s] of visitas) {
        const h = horaDe(ini);
        horas.set(h, [...(horas.get(h) ?? []), s]);
      }
      return {
        id: area.id,
        nome: area.nome,
        tipo: 'espera',
        visitas: visitas.slice(-A.maximoPorArea).map(([ini, s]) => [new Date(ini).toISOString(), s]),
        pessoas: visitas.length,
        medianaS: mediana(duracoes),
        maiorS: duracoes.length ? Math.max(...duracoes) : null,
        acimaDe5Min: duracoes.filter((s) => s > A.esperaLongaS).length,
        porHora: [...horas.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([hora, l]) => ({ hora, pessoas: l.length, medianaS: mediana(l)! })),
        agora: quantasDentro(area, agoraPessoas),
      };
    }
    const entradas: number[] = [];
    const saidas: number[] = [];
    const naLoja: number[] = [];
    for (const c of caminhos) {
      const [t0, x0, y0] = c[0]!;
      const [t1, x1, y1] = c[c.length - 1]!;
      const entrou = dentroDaArea(area, x0, y0);
      const saiu = dentroDaArea(area, x1, y1) && terminou(c) && c.length > 1;
      if (entrou && noPeriodo(t0)) entradas.push(t0);
      if (saiu && noPeriodo(t1)) saidas.push(t1);
      if (entrou && saiu && noPeriodo(t1)) naLoja.push(Math.round((t1 - t0) / 1000));
    }
    entradas.sort((a, b) => a - b);
    saidas.sort((a, b) => a - b);
    const horas = new Map<string, { entradas: number; saidas: number }>();
    for (const t of entradas) { const h = horaDe(t); const v = horas.get(h) ?? { entradas: 0, saidas: 0 }; v.entradas += 1; horas.set(h, v); }
    for (const t of saidas) { const h = horaDe(t); const v = horas.get(h) ?? { entradas: 0, saidas: 0 }; v.saidas += 1; horas.set(h, v); }
    return {
      id: area.id,
      nome: area.nome,
      tipo: 'porta',
      entradas: entradas.slice(-A.maximoPorArea).map((t) => new Date(t).toISOString()),
      saidas: saidas.slice(-A.maximoPorArea).map((t) => new Date(t).toISOString()),
      naLoja: { quantos: naLoja.length, medianaS: mediana(naLoja) },
      porHora: [...horas.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([hora, v]) => ({ hora, ...v })),
      agora: quantasDentro(area, agoraPessoas),
    };
  });
}
