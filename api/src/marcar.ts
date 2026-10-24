// =====================================================================
// Marcar ingredientes: o recorte de um passo e a pilha que a câmera vê
// =====================================================================
// A24, fase F3 (migration 055). O dono, 23/10/2026: "para treinamento
// inicial, antes de associar com ficha, primeiro teríamos que treinar
// identificar ingrediente como no teste de 112 [...] ali é um bom
// treinamento de ingrediente". Protótipo aprovado em 24/10/2026.
//
//   • a LOJA escolhe, com a loja fechada, os recortes da noite que valem
//     marcar — os de dúvida do juiz, um pouco de cada ingrediente e o
//     começo das peças — e manda (`POST /v1/agentes/treino/recortes`;
//     contrato em `contratos/recorte-para-marcar.json`). Eles ficam na
//     gravação `ao-vivo` da noite, a mesma dos lanches da conferência;
//   • a TELA mostra um recorte por vez: a pessoa marca a pilha de cima para
//     baixo (com a quantidade do que se conta por unidade), ou diz "não é
//     ingrediente", ou "não dá para ver";
//   • o DE CIMA da pilha vira exemplo da base da loja (`base_frame`, origem
//     `bancada`): é o que o recorte mostra por inteiro — o de baixo aparece
//     só pela borda. "Não é ingrediente" vira exemplo do que não é comida
//     (o mesmo da conferência, migration 054); "não dá para ver" não ensina
//     nada;
//   • o acerto ("o Farol acertou antes") compara o nome que o juiz deu com o
//     de cima, pela chave do ingrediente (o outro nome conta como o
//     ingrediente das fichas, migration 053).
// =====================================================================

import type { Base } from './fichas.js';
import { chaveDoIngrediente, ingredientesDaBase } from './ingredientes.js';
import { nomeQueConta, type OutrosNomes } from './outros-nomes.js';
import { tamanhoDoJpeg } from './rotas/inventario.js';
import { lerContorno, lerGravacao, MAX_BYTES_DO_QUADRO, MAX_PECAS, type GravacaoLida } from './treino.js';

/** Por que a loja escolheu o recorte: o juiz teve dúvida, um pouco de cada ingrediente, ou o começo da peça (o pão). */
export const MOTIVOS_DO_RECORTE = ['duvida', 'cobertura', 'comeco'] as const;
export type MotivoDoRecorte = (typeof MOTIVOS_DO_RECORTE)[number];
/** O que a pessoa responde: a pilha, "não é ingrediente", ou "não dá para ver". */
export const ESTADOS_DA_MARCACAO = ['pilha', 'nada', 'nao-da'] as const;
export type EstadoDaMarcacao = (typeof ESTADOS_DA_MARCACAO)[number];

/** Os recortes de um envio (uns 25 recortes de até 300 kB cabem em ~10 MB de base64). */
export const MAX_RECORTES_POR_ENVIO = 25;
/** Os recortes de uma noite: a amostra é de uns 100; o resto a loja nem manda. */
export const MAX_RECORTES_POR_NOITE = 300;
export const MAX_NA_PILHA = 12;
export const MAX_VEZES = 20;
export const MAX_OBSERVACAO = 300;
/** A imagem do recorte sai 30 dias depois da marcação; o recorte que ninguém marcou sai inteiro em 30 dias. */
export const DIAS_DOS_RECORTES = 30;

const ehData = (v: unknown): v is string => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));
const texto = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

export type RecorteLido = {
  chave: string;
  lanche: string | null;
  hora: string;
  peca: number | null;
  motivo: MotivoDoRecorte;
  palpite: string | null;
  nota: number | null;
  contorno: number[][][] | null;
  bytes: Buffer;
  largura: number;
  altura: number;
};

/** O corpo que a loja manda para `POST /v1/agentes/treino/recortes` — conferido inteiro antes de qualquer gravação. */
export function lerRecortesParaMarcar(corpo: unknown): { gravacao: GravacaoLida; recortes: RecorteLido[] } | { problema: string } {
  const c = (corpo ?? {}) as { gravacao?: unknown; recortes?: unknown };
  const gravacao = lerGravacao(c.gravacao);
  if ('problema' in gravacao) return gravacao;
  // os recortes são da noite da leitura ao vivo: é nela que estão os passos com o juiz
  if (gravacao.origem !== 'ao-vivo') return { problema: 'gravacao.origem: os recortes para marcar são da noite ao vivo (ao-vivo)' };
  if (!Array.isArray(c.recortes) || c.recortes.length === 0 || c.recortes.length > MAX_RECORTES_POR_ENVIO) {
    return { problema: `recortes: de 1 a ${MAX_RECORTES_POR_ENVIO} por envio` };
  }
  const chaves = new Set<string>();
  const recortes: RecorteLido[] = [];
  for (const [i, bruto] of (c.recortes as unknown[]).entries()) {
    const r = (bruto ?? {}) as Record<string, unknown>;
    if (!texto(r.chave, 160)) return { problema: `recortes[${i}].chave: um texto de até 160 letras` };
    const chave = r.chave.trim();
    if (chaves.has(chave)) return { problema: `recortes[${i}].chave: "${chave}" veio duas vezes` };
    chaves.add(chave);
    if (r.lanche !== undefined && r.lanche !== null && !texto(r.lanche, 120)) return { problema: `recortes[${i}].lanche: um texto de até 120 letras, ou nulo` };
    if (!ehData(r.hora)) return { problema: `recortes[${i}].hora: data e hora com fuso` };
    if (r.peca !== undefined && r.peca !== null && !(Number.isInteger(r.peca) && (r.peca as number) >= 1 && (r.peca as number) <= MAX_PECAS)) {
      return { problema: `recortes[${i}].peca: de 1 a ${MAX_PECAS}, ou nulo` };
    }
    if (!MOTIVOS_DO_RECORTE.includes(r.motivo as MotivoDoRecorte)) return { problema: `recortes[${i}].motivo: ${MOTIVOS_DO_RECORTE.join(', ')}` };
    if (r.palpite !== undefined && r.palpite !== null && !texto(r.palpite, 120)) return { problema: `recortes[${i}].palpite: um nome de até 120 letras, ou nulo` };
    const temNota = r.nota !== undefined && r.nota !== null;
    if (temNota && !(typeof r.nota === 'number' && Number.isFinite(r.nota) && r.nota >= 0 && r.nota <= 1)) {
      return { problema: `recortes[${i}].nota: de 0 a 1, ou nulo` };
    }
    let contorno: number[][][] | null = null;
    if (r.contorno !== undefined && r.contorno !== null) {
      contorno = lerContorno(r.contorno);
      if (!contorno) return { problema: `recortes[${i}].contorno: pedaços de pontos [x, y], em pixels do recorte` };
      if (!contorno.length) contorno = null;
    }
    const b64 = r.imagemBase64;
    if (typeof b64 !== 'string' || !b64) return { problema: `recortes[${i}]: faltou a imagem` };
    const bytes = Buffer.from(b64, 'base64');
    if (bytes.length > MAX_BYTES_DO_QUADRO) return { problema: `recortes[${i}]: a imagem passa de ${MAX_BYTES_DO_QUADRO / 1000} kB` };
    const tamanho = tamanhoDoJpeg(bytes);
    if (!tamanho) return { problema: `recortes[${i}]: não é um JPEG que dê para abrir` };
    recortes.push({
      chave,
      lanche: typeof r.lanche === 'string' ? r.lanche.trim() : null,
      hora: r.hora,
      peca: (r.peca as number | null | undefined) ?? null,
      motivo: r.motivo as MotivoDoRecorte,
      palpite: typeof r.palpite === 'string' ? r.palpite.trim() : null,
      nota: temNota ? Math.round((r.nota as number) * 1000) / 1000 : null,
      contorno,
      bytes,
      ...tamanho,
    });
  }
  return { gravacao, recortes };
}

export type CamadaMarcada = { nome: string; vezes: number };
export type Marcacao = { estado: EstadoDaMarcacao; pilha: CamadaMarcada[]; obs: string | null };

/**
 * O que a tela manda para `POST /v1/treino/recortes/:id/marcacao`. O nome da pilha tem de ser um ingrediente das
 * fichas da loja (ou um outro nome dele, que vira o das fichas); o mesmo nome pode voltar mais abaixo (carne, queijo,
 * carne). Devolve a marcação com os nomes como estão nas fichas.
 */
export function lerMarcacao(corpo: unknown, nomesDasFichas: string[], outros: OutrosNomes): Marcacao | { problema: string } {
  const c = (corpo ?? {}) as Record<string, unknown>;
  if (!ESTADOS_DA_MARCACAO.includes(c.estado as EstadoDaMarcacao)) return { problema: `estado: ${ESTADOS_DA_MARCACAO.join(', ')}` };
  const estado = c.estado as EstadoDaMarcacao;
  let obs: string | null = null;
  if (c.obs !== undefined && c.obs !== null) {
    if (typeof c.obs !== 'string' || c.obs.length > MAX_OBSERVACAO) return { problema: `obs: um texto de até ${MAX_OBSERVACAO} letras, ou nulo` };
    obs = c.obs.trim() || null;
  }
  const bruta = c.pilha ?? [];
  if (!Array.isArray(bruta)) return { problema: 'pilha: a lista do que a câmera vê, de cima para baixo' };
  if (estado !== 'pilha') {
    if (bruta.length) return { problema: `pilha: vazia quando o estado é "${estado}"` };
    return { estado, pilha: [], obs };
  }
  if (bruta.length === 0 || bruta.length > MAX_NA_PILHA) return { problema: `pilha: de 1 a ${MAX_NA_PILHA} ingredientes` };
  const dasFichas = new Map(nomesDasFichas.map((n) => [chaveDoIngrediente(n), n]));
  const pilha: CamadaMarcada[] = [];
  for (const [i, b] of bruta.entries()) {
    const camada = (b ?? {}) as Record<string, unknown>;
    if (!texto(camada.nome, 120)) return { problema: `pilha[${i}].nome: o nome de um ingrediente das fichas` };
    const nome = dasFichas.get(chaveDoIngrediente(nomeQueConta(camada.nome.trim(), outros)));
    if (!nome) return { problema: `pilha[${i}].nome: "${camada.nome.trim()}" não está nas fichas da loja` };
    const vezes = camada.vezes ?? 1;
    if (!Number.isInteger(vezes) || (vezes as number) < 1 || (vezes as number) > MAX_VEZES) return { problema: `pilha[${i}].vezes: de 1 a ${MAX_VEZES}` };
    pilha.push({ nome, vezes: vezes as number });
  }
  return { estado, pilha, obs };
}

/** O nome que vira exemplo: o de cima da pilha. Nulo = "não é ingrediente" ou "não dá para ver". */
export const deCima = (m: Marcacao): string | null => (m.estado === 'pilha' ? (m.pilha[0]?.nome ?? null) : null);

/**
 * O Farol acertou antes? O nome que o juiz deu × o que a pessoa marcou em cima, pela chave do ingrediente (o outro
 * nome conta como o das fichas). "Não é ingrediente" e "não dá para ver" não entram na conta: nulo.
 */
export function acertouORecorte(palpite: string | null, m: Marcacao, outros: OutrosNomes): boolean | null {
  const cima = deCima(m);
  if (!cima) return null;
  if (!palpite) return false;
  return chaveDoIngrediente(nomeQueConta(palpite, outros)) === chaveDoIngrediente(cima);
}

export const GRUPOS_DOS_NOMES = ['Pães', 'Carnes', 'Queijos', 'Molhos', 'Outros'] as const;
export type GrupoDosNomes = (typeof GRUPOS_DOS_NOMES)[number];

// As palavras de cada grupo, na chave do ingrediente (sem acento, no singular). O molho vem antes do queijo: o "Molho
// cheddar" é molho; a carne antes do queijo: o "Frango recheado" é carne. O que não cai em nenhum fica em "Outros".
const PALAVRAS_DO_GRUPO: Array<[GrupoDosNomes, RegExp]> = [
  ['Pães', /^pao\b/],
  ['Molhos', /\b(molho|maionese|ketchup|catchup|mostarda|barbecue|bbq|geleia|aioli|pesto|sauce)\b/],
  ['Carnes', /\b(carne|blend|hamb|hamburguer|frango|bife|costela|nugget|linguica|file|picanha|smash|pernil|calabresa)\b/],
  ['Queijos', /\b(queijo|cheddar|mussarela|mucarela|mozzarella|cream cheese|catupiry|requeijao|provolone|parmesao|gorgonzola|coalho)\b/],
];
// O que se conta por unidade ou fatia: pela unidade da ficha, ou pela palavra no nome ("Fatia de queijo", "Anel de cebola").
const UNIDADES_QUE_CONTAM = new Set(['u', 'un', 'und', 'unid', 'unidade', 'fatia', 'pc', 'pca', 'peca', 'disco', 'anel']);
const NOME_QUE_CONTA = /\b(fatia|disco|anel|unidade)\b/;

export type NomeParaMarcar = { nome: string; conta: boolean };

/**
 * Os ingredientes das fichas para a pilha, em grupos (Pães, Carnes, Queijos, Molhos, Outros), com o "conta" do que se
 * marca com quantidade (− e +): a carne, e o que a ficha pede por unidade ou fatia (o pão, não). Na ordem das fichas
 * dentro do grupo; o grupo sem nome não vem.
 */
export function nomesParaMarcar(base: Base | null): Array<{ grupo: GrupoDosNomes; nomes: NomeParaMarcar[] }> {
  if (!base) return [];
  const unidades = new Map<string, Set<string>>();
  const anotar = (nome: string | null | undefined, unidade: string | null | undefined) => {
    if (!nome?.trim() || !unidade?.trim()) return;
    const chave = chaveDoIngrediente(nome);
    const u = chaveDoIngrediente(unidade).replace(/\.$/, '');
    if (!unidades.has(chave)) unidades.set(chave, new Set());
    unidades.get(chave)!.add(u);
  };
  for (const p of base.produtos) {
    for (const i of p.ficha?.ingredientes ?? []) anotar(i.nome, i.unidade);
    for (const g of p.adicionais ?? []) {
      for (const o of g.opcoes ?? []) if (o.efeito?.tipo === 'insumo') anotar(o.efeito.nome, o.efeito.unidade);
    }
  }
  const porGrupo = new Map<GrupoDosNomes, NomeParaMarcar[]>(GRUPOS_DOS_NOMES.map((g) => [g, []]));
  for (const { nome } of ingredientesDaBase(base)) {
    const chave = chaveDoIngrediente(nome);
    const grupo = PALAVRAS_DO_GRUPO.find(([, re]) => re.test(chave))?.[0] ?? 'Outros';
    // o pão não se conta: a pilha tem um pão embaixo (o pão de dois cortes é um nome só)
    const conta =
      grupo !== 'Pães' &&
      (grupo === 'Carnes' || NOME_QUE_CONTA.test(chave) || [...(unidades.get(chave) ?? [])].some((u) => UNIDADES_QUE_CONTAM.has(u)));
    porGrupo.get(grupo)!.push({ nome, conta });
  }
  return GRUPOS_DOS_NOMES.map((grupo) => ({ grupo, nomes: porGrupo.get(grupo)! })).filter((g) => g.nomes.length);
}
