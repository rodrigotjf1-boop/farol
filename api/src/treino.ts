// =====================================================================
// O treinamento da bancada: o lanche que a loja leu e a conta da ficha
// =====================================================================
// A21, fatia T4 (migration 049). A loja grava um horário de movimento,
// lê os lanches (sem nuvem) e manda, de cada um, as ETAPAS: o que apareceu
// em cada metade e os nomes das fichas que a leitura acha possíveis
// (`candidatos`). Leitura certa e específica = um candidato; um grupo que a
// cor não separa ("molho laranja") = vários; "não deu para ver" = nenhum.
//
// O PALPITE da ficha é feito aqui, com as fichas de hoje — a loja não
// precisa saber delas para ler. É a mesma conta do protótipo aprovado:
// cada ingrediente da ficha está "visto" quando uma etapa o tem entre os
// candidatos; a ficha que mais bate ganha, e o que veio a mais e não é
// adicional do produto pesa contra. O que "não se vê de cima" não entra.
//
// A fila de conferência começa pela dúvida: é onde cada resposta ensina
// mais.
// =====================================================================

import type { Base } from './fichas.js';
import { chaveDoIngrediente } from './ingredientes.js';
import { tamanhoDoJpeg } from './rotas/inventario.js';

export const LADOS = ['pao', 'tampo', 'base', 'outro'] as const;
export type Lado = (typeof LADOS)[number];
export const ORIGENS = ['gravador', 'programada', 'carga'] as const;

export const MAX_ETAPAS = 60;
export const MAX_QUADROS = 40;
export const MAX_BYTES_DO_QUADRO = 300_000;
export const MAX_CANDIDATOS = 12;
/** Uma gravação de treino vai de 15 minutos a 1 hora; a conta aceita até 2 horas, para a carga das leituras antigas. */
export const MAX_DURACAO_MS = 2 * 3600_000;
/** Decisão do dono (15/10/2026): o quadro da etapa sai 30 dias depois da conferência. */
export const DIAS_DOS_QUADROS = 30;
/** A meta proposta e aprovada (15/10/2026): o lanche certo em 9 de cada 10, com pelo menos 30 conferidos. */
export const META = { acerto: 0.9, minimo: 30 } as const;

export type EtapaLida = {
  hora: string;
  lado: Lado;
  /** É o que a metade já tinha quando apareceu (e não algo que entrou depois). */
  inicio: boolean;
  /** O que a leitura disse, para mostrar ("molho laranja"). Nulo = não deu para ver. */
  leu: string | null;
  /** Os nomes das fichas que a leitura acha possíveis. Um = leitura específica; vários = um grupo; nenhum = não sei. */
  candidatos: string[];
  /** Quantas vezes entrou de uma vez (duas fatias juntas = 2). */
  vezes: number;
  /** O índice do quadro da etapa em `quadros`. Nulo = sem quadro. */
  quadro: number | null;
};

export type LancheLido = {
  gravacao: { chave: string; pontoId: string | null; inicio: string; fim: string; origem: (typeof ORIGENS)[number] };
  lanche: { chave: string; abertoEm: string | null; fechouEm: string | null; etapas: EtapaLida[] };
  quadros: Array<{ bytes: Buffer; largura: number; altura: number }>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ehData = (v: unknown): v is string => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));
const texto = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

/** O corpo que a loja manda para `POST /v1/agentes/treino/lanches` — conferido inteiro antes de qualquer gravação. */
export function lerLancheDeTreino(corpo: unknown): LancheLido | { problema: string } {
  const c = (corpo ?? {}) as { gravacao?: Record<string, unknown>; lanche?: Record<string, unknown>; quadros?: unknown };
  const g = c.gravacao ?? {};
  if (!texto(g.chave, 120)) return { problema: 'gravacao.chave: um texto de até 120 letras' };
  if (g.pontoId !== undefined && g.pontoId !== null && !(typeof g.pontoId === 'string' && UUID.test(g.pontoId))) {
    return { problema: 'gravacao.pontoId: o id do canal, ou nulo' };
  }
  if (!ehData(g.inicio) || !ehData(g.fim)) return { problema: 'gravacao.inicio e gravacao.fim: data e hora com fuso' };
  const duracao = Date.parse(g.fim) - Date.parse(g.inicio);
  if (!(duracao > 0) || duracao > MAX_DURACAO_MS) return { problema: 'gravacao: o fim depois do início, e no máximo 2 horas' };
  if (!ORIGENS.includes(g.origem as (typeof ORIGENS)[number])) return { problema: `gravacao.origem: ${ORIGENS.join(', ')}` };

  const l = c.lanche ?? {};
  if (!texto(l.chave, 120)) return { problema: 'lanche.chave: um texto de até 120 letras' };
  for (const campo of ['abertoEm', 'fechouEm'] as const) {
    if (l[campo] !== undefined && l[campo] !== null && !ehData(l[campo])) return { problema: `lanche.${campo}: data e hora, ou nulo` };
  }
  if (!Array.isArray(l.etapas) || l.etapas.length === 0 || l.etapas.length > MAX_ETAPAS) {
    return { problema: `lanche.etapas: de 1 a ${MAX_ETAPAS}` };
  }
  if (c.quadros !== undefined && (!Array.isArray(c.quadros) || c.quadros.length > MAX_QUADROS)) {
    return { problema: `quadros: no máximo ${MAX_QUADROS}` };
  }
  const quadros: LancheLido['quadros'] = [];
  for (const [i, q] of ((c.quadros as unknown[]) ?? []).entries()) {
    const b64 = (q as { imagemBase64?: unknown })?.imagemBase64;
    if (typeof b64 !== 'string' || !b64) return { problema: `quadros[${i}]: faltou a imagem` };
    const bytes = Buffer.from(b64, 'base64');
    if (bytes.length > MAX_BYTES_DO_QUADRO) return { problema: `quadros[${i}]: a imagem passa de ${MAX_BYTES_DO_QUADRO / 1000} kB` };
    const tamanho = tamanhoDoJpeg(bytes);
    if (!tamanho) return { problema: `quadros[${i}]: não é um JPEG que dê para abrir` };
    quadros.push({ bytes, ...tamanho });
  }

  const etapas: EtapaLida[] = [];
  for (const [i, bruto] of (l.etapas as unknown[]).entries()) {
    const e = (bruto ?? {}) as Record<string, unknown>;
    if (!ehData(e.hora)) return { problema: `etapas[${i}].hora: data e hora com fuso` };
    if (!LADOS.includes(e.lado as Lado)) return { problema: `etapas[${i}].lado: ${LADOS.join(', ')}` };
    if (typeof e.inicio !== 'boolean') return { problema: `etapas[${i}].inicio: true ou false` };
    if (e.leu !== null && !texto(e.leu, 80)) return { problema: `etapas[${i}].leu: um texto de até 80 letras, ou nulo` };
    if (!Array.isArray(e.candidatos) || e.candidatos.length > MAX_CANDIDATOS || !e.candidatos.every((n) => texto(n, 120))) {
      return { problema: `etapas[${i}].candidatos: até ${MAX_CANDIDATOS} nomes` };
    }
    if (!Number.isInteger(e.vezes) || (e.vezes as number) < 1 || (e.vezes as number) > 6) return { problema: `etapas[${i}].vezes: de 1 a 6` };
    if (e.quadro !== null && !(Number.isInteger(e.quadro) && (e.quadro as number) >= 0 && (e.quadro as number) < quadros.length)) {
      return { problema: `etapas[${i}].quadro: o índice de um quadro mandado, ou nulo` };
    }
    etapas.push({
      hora: e.hora,
      lado: e.lado as Lado,
      inicio: e.inicio,
      leu: e.leu === null ? null : (e.leu as string).trim(),
      candidatos: [...new Set((e.candidatos as string[]).map((n) => n.trim()))],
      vezes: e.vezes as number,
      quadro: e.quadro as number | null,
    });
  }
  return {
    gravacao: { chave: g.chave.trim(), pontoId: (g.pontoId as string | null | undefined) ?? null, inicio: g.inicio, fim: g.fim, origem: g.origem as (typeof ORIGENS)[number] },
    lanche: { chave: l.chave.trim(), abertoEm: (l.abertoEm as string | null | undefined) ?? null, fechouEm: (l.fechouEm as string | null | undefined) ?? null, etapas },
    quadros,
  };
}

// ───────────────────────── a conta da ficha ─────────────────────────

/** Quantas vezes o ingrediente entra: o número, quando a unidade se conta de cima (fatia, unidade); o resto é presença. */
export function vezesNaFicha(quantidade: number | null, unidade: string | null): number {
  const u = (unidade ?? '').trim().toLowerCase();
  if (quantidade !== null && Number.isInteger(quantidade) && quantidade >= 1 && /^(fatias?|unidades?|un|und)$/.test(u)) return quantidade;
  return 1;
}

export type Palpite = { produtoId: string; produto: string; batem: number; total: number; fora: number; nota: number };

/**
 * As fichas que mais batem com o que a loja leu, da melhor para a pior. `invisiveis`: as chaves dos ingredientes
 * marcados "não se vê de cima" — não entram na conta.
 */
export function palpitesDoLanche(etapas: EtapaLida[], base: Base | null, invisiveis: Set<string> = new Set()): Palpite[] {
  if (!base) return [];
  const comLeitura = etapas.filter((e) => e.candidatos.length > 0);
  const palpites: Palpite[] = [];
  for (const p of base.produtos) {
    if (!p.ficha || !p.cozinha) continue;
    const naFicha = new Set(p.ficha.ingredientes.map((i) => chaveDoIngrediente(i.nome)));
    const adicionais = new Set<string>();
    for (const g of p.adicionais ?? []) {
      if (g.tipo !== 'adicionar') continue;
      for (const o of g.opcoes ?? []) if ((o.efeito?.tipo === 'insumo' || o.efeito?.tipo === 'preparo') && o.efeito.nome) adicionais.add(chaveDoIngrediente(o.efeito.nome));
    }
    let batem = 0;
    let total = 0;
    for (const i of p.ficha.ingredientes) {
      const k = chaveDoIngrediente(i.nome);
      if (invisiveis.has(k)) continue;
      total += 1;
      if (comLeitura.some((e) => e.candidatos.some((c) => chaveDoIngrediente(c) === k))) batem += 1;
    }
    // a etapa lida que não cabe na ficha: fora; a que é adicional do produto não pesa contra. A que a leitura viu
    // sem achar nome nas fichas ("molho verde" numa loja sem molho verde) também é fora — e estranha.
    let fora = 0;
    let estranhos = 0;
    for (const e of etapas) {
      if (e.candidatos.length === 0) {
        if (e.leu !== null) {
          fora += 1;
          estranhos += 1;
        }
        continue;
      }
      const ks = e.candidatos.map(chaveDoIngrediente);
      if (ks.some((k) => naFicha.has(k))) continue;
      fora += 1;
      if (!ks.some((k) => adicionais.has(k))) estranhos += 1;
    }
    if (total === 0) continue;
    palpites.push({ produtoId: p.id, produto: p.nome, batem, total, fora, nota: batem / total - 0.2 * estranhos });
  }
  return palpites.sort((a, b) => b.nota - a.nota || a.fora - b.fora || a.produto.localeCompare(b.produto, 'pt-BR'));
}

// ───────────────────────── a conferência ─────────────────────────

export const RESPOSTAS_DA_ETAPA = ['certo', 'outro', 'nada'] as const;
export const FALTAS = ['cliente', 'faltou', 'naoviu'] as const;
export const A_MAIS = ['adicional', 'amais'] as const;

export type RespostaDaEtapa = { v: (typeof RESPOSTAS_DA_ETAPA)[number]; nome: string | null } | null;
export type Conferencia = {
  /** O produto que a pessoa disse, com o nome da ficha. Nulo = não era um lanche, ou não dá para saber. */
  produto: string | null;
  /** Uma por etapa, na mesma ordem. Nulo = a pessoa não respondeu esta etapa (ela não ensina nada). */
  etapas: RespostaDaEtapa[];
  /** O que a ficha tem e a bancada não mostrou: o cliente pediu assim, faltou, ou estava lá e a leitura não viu. */
  faltas: Record<string, (typeof FALTAS)[number]>;
  /** O que veio a mais: pedido do cliente (adicional) ou a mais, sem pedido. */
  aMais: Record<string, (typeof A_MAIS)[number]>;
};

function lerMapa<T extends string>(valor: unknown, aceitos: readonly T[], campo: string): { mapa: Record<string, T> } | { problema: string } {
  if (valor === undefined || valor === null) return { mapa: {} };
  if (typeof valor !== 'object' || Array.isArray(valor)) return { problema: `${campo}: um objeto { nome: escolha }` };
  const mapa: Record<string, T> = {};
  const pares = Object.entries(valor as Record<string, unknown>);
  if (pares.length > 30) return { problema: `${campo}: no máximo 30` };
  for (const [nome, escolha] of pares) {
    if (!texto(nome, 120)) return { problema: `${campo}: o nome de um ingrediente` };
    if (!aceitos.includes(escolha as T)) return { problema: `${campo}.${nome}: ${aceitos.join(', ')}` };
    mapa[nome.trim()] = escolha as T;
  }
  return { mapa };
}

/** O que a pessoa respondeu, conferido contra as etapas do lanche e as fichas de hoje. */
export function lerConferencia(corpo: unknown, etapas: EtapaLida[], base: Base | null): Conferencia | { problema: string } {
  const c = (corpo ?? {}) as Record<string, unknown>;
  let produto: string | null = null;
  if (c.produto !== null && c.produto !== undefined) {
    if (!texto(c.produto, 160)) return { problema: 'produto: o nome de um produto da loja, ou nulo' };
    const achado = base?.produtos.find((p) => p.ficha && chaveDoIngrediente(p.nome) === chaveDoIngrediente(c.produto as string));
    if (!achado) return { problema: 'produto: este produto não tem ficha na loja' };
    produto = achado.nome;
  }
  if (!Array.isArray(c.etapas) || c.etapas.length !== etapas.length) return { problema: `etapas: uma resposta por etapa (${etapas.length})` };
  const respostas: RespostaDaEtapa[] = [];
  for (const [i, bruta] of (c.etapas as unknown[]).entries()) {
    if (bruta === null) {
      respostas.push(null);
      continue;
    }
    const r = bruta as { v?: unknown; nome?: unknown };
    if (!RESPOSTAS_DA_ETAPA.includes(r.v as (typeof RESPOSTAS_DA_ETAPA)[number])) return { problema: `etapas[${i}].v: ${RESPOSTAS_DA_ETAPA.join(', ')}, ou nulo` };
    // "certo" só onde a leitura disse UM nome: num grupo, a pessoa diz qual era
    if (r.v === 'certo' && etapas[i]!.candidatos.length !== 1) return { problema: `etapas[${i}]: a leitura não disse um nome só; diga qual era` };
    if (r.v === 'outro' && !texto(r.nome, 120)) return { problema: `etapas[${i}].nome: o nome do que era` };
    respostas.push({ v: r.v as (typeof RESPOSTAS_DA_ETAPA)[number], nome: r.v === 'outro' ? (r.nome as string).trim() : null });
  }
  const faltas = lerMapa(c.faltas, FALTAS, 'faltas');
  if ('problema' in faltas) return faltas;
  const aMais = lerMapa(c.aMais, A_MAIS, 'aMais');
  if ('problema' in aMais) return aMais;
  return { produto, etapas: respostas, faltas: faltas.mapa, aMais: aMais.mapa };
}

/** O nome que a etapa ensina: o único candidato ("certo") ou o que a pessoa disse ("outro"). */
export function nomeEnsinado(etapa: EtapaLida, r: RespostaDaEtapa): string | null {
  if (!r) return null;
  if (r.v === 'certo') return etapa.candidatos[0] ?? null;
  if (r.v === 'outro') return r.nome;
  return null;
}

/**
 * O que vira exemplo na base de conhecimento: cada etapa que a pessoa confirmou ou corrigiu, que tem quadro, e cujo
 * nome está nas fichas (com o nome da ficha). O nome que não está nas fichas fica na resposta — vira sugestão.
 */
export function exemplosDaConferencia(etapas: EtapaLida[], conferencia: Conferencia, nomesNasFichas: string[]): Array<{ etapa: number; nome: string; quadro: number }> {
  const porChave = new Map(nomesNasFichas.map((n) => [chaveDoIngrediente(n), n]));
  const saida: Array<{ etapa: number; nome: string; quadro: number }> = [];
  etapas.forEach((e, i) => {
    const nome = nomeEnsinado(e, conferencia.etapas[i] ?? null);
    const daFicha = nome ? porChave.get(chaveDoIngrediente(nome)) : undefined;
    if (daFicha && e.quadro !== null) saida.push({ etapa: i, nome: daFicha, quadro: e.quadro });
  });
  return saida;
}

/**
 * O que o Farol já sabe de cada ingrediente, contado SÓ nos lanches conferidos: em quantos ele estava, e em quantos a
 * leitura da loja o reconheceu antes da conferência (a etapa "certo").
 */
export function aprendizado(conferidos: Array<{ etapas: EtapaLida[]; conferencia: Conferencia }>): Record<string, { presente: number; reconheceu: number }> {
  const conta: Record<string, { presente: number; reconheceu: number; nome: string }> = {};
  for (const { etapas, conferencia } of conferidos) {
    const presentes = new Map<string, { nome: string; reconheceu: boolean }>();
    etapas.forEach((e, i) => {
      const r = conferencia.etapas[i] ?? null;
      const nome = nomeEnsinado(e, r);
      if (!nome) return;
      const k = chaveDoIngrediente(nome);
      const ja = presentes.get(k);
      presentes.set(k, { nome: ja?.nome ?? nome, reconheceu: (ja?.reconheceu ?? false) || r?.v === 'certo' });
    });
    for (const [nome, f] of Object.entries(conferencia.faltas)) {
      const k = chaveDoIngrediente(nome);
      if (f === 'naoviu' && !presentes.has(k)) presentes.set(k, { nome, reconheceu: false });
    }
    for (const [k, p] of presentes) {
      const c = (conta[k] ??= { presente: 0, reconheceu: 0, nome: p.nome });
      c.presente += 1;
      if (p.reconheceu) c.reconheceu += 1;
    }
  }
  return Object.fromEntries(Object.values(conta).map((c) => [c.nome, { presente: c.presente, reconheceu: c.reconheceu }]));
}

export const MOTIVOS = ['coberto', 'duvida', 'diferenca', 'certo'] as const;
export type Motivo = (typeof MOTIVOS)[number];

/** Por que o lanche está na fila — e a ordem dela: o coberto e a dúvida primeiro. */
export function motivoDoLanche(etapas: EtapaLida[], melhor: Palpite | undefined): Motivo {
  if (etapas.some((e) => e.leu === null && e.candidatos.length === 0)) return 'coberto';
  if (etapas.some((e) => e.candidatos.length > 1)) return 'duvida';
  if (!melhor || melhor.batem < melhor.total || melhor.fora > 0) return 'diferenca';
  return 'certo';
}
