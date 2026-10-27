// =====================================================================
// Importar a planta de um arquivo — a conta, sem tela
// =====================================================================
// Pedido do dono em 27/10/2026 ("pode colocar o botão"): a planta da cozinha
// foi montada em escala pelo projeto do arquiteto, fora do console, e entra
// por um arquivo. O arquivo é o mesmo formato que a API guarda (ambientes,
// móveis e câmeras em metros), com uma diferença: a câmera pode vir pelo
// NÚMERO DO CANAL (`canal: 4`), porque quem monta o arquivo não sabe o
// identificador do canal no console. Aqui ele é trocado pelo canal da loja.
//
// O que esta conta NÃO faz: decidir se a planta vale. Quem decide é a API, ao
// salvar (`api/src/planta.ts`, `lerPlanta`). Aqui só se confere a FORMA (é uma
// planta? cada peça tem nome e números?) e se liga cada câmera a um canal — o
// resto (limites, tamanhos) a API diz no "Concluir edição", com o mesmo texto
// de sempre. Duas réguas para a mesma coisa acabariam diferentes.
//
// Não importa nada (os testes da API a leem pelo caminho, como `planta.ts`).
// =====================================================================

import type { Ambiente, Camera, Movel, Planta } from './planta';

/** Um canal cadastrado na loja, do jeito que a tela já tem. */
export type CanalDaLoja = { id: string; canal: number | null; nome: string };

/** Cada câmera do arquivo e o que aconteceu com ela. */
export type CameraImportada = {
  /** Como o arquivo chamou a câmera ("canal 4"). */
  rotulo: string;
  /** O número do canal no arquivo (nulo quando veio só pelo identificador): a tela ordena por ele. */
  numero: number | null;
  /** O canal da loja em que ela entrou; nulo = ficou de fora. */
  ponto: CanalDaLoja | null;
  /** Por que ficou de fora (nulo quando entrou). */
  motivo: string | null;
};

export type Importacao = { planta: Planta; cameras: CameraImportada[] };

/** O maior arquivo aceito: uma planta de verdade tem poucos KB. */
export const TAMANHO_MAXIMO_DO_ARQUIVO = 1_000_000;

const ehNumero = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const centesimos = (n: number): number => Math.round(n * 100) / 100;
const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

type Bruto = Record<string, unknown>;
const objeto = (v: unknown): Bruto | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Bruto) : null);

/** x, y, largura e comprimento: os quatro números, ou o que falta. */
function retangulo(o: Bruto, onde: string): { r?: { x: number; y: number; w: number; h: number }; problema?: string } {
  for (const k of ['x', 'y', 'w', 'h'] as const) {
    if (!ehNumero(o[k])) return { problema: `${onde}: falta ${k === 'x' || k === 'y' ? 'a posição' : 'o tamanho'} (${k}) em metros` };
  }
  return { r: { x: centesimos(o.x as number), y: centesimos(o.y as number), w: centesimos(o.w as number), h: centesimos(o.h as number) } };
}

/**
 * Lê o texto do arquivo. `setores` e `itens` são os ids que a loja tem: o setor do ambiente e o equipamento do móvel
 * só ficam se forem desta loja (o arquivo pode vir de outra); senão viram "sem setor" e "sem cadastro".
 */
export function lerArquivoDaPlanta(
  conteudo: string,
  canais: CanalDaLoja[],
  setores: string[] = [],
  itens: string[] = [],
): { importacao?: Importacao; problema?: string } {
  if (conteudo.length > TAMANHO_MAXIMO_DO_ARQUIVO) return { problema: 'o arquivo é grande demais para ser uma planta' };
  let bruto: unknown;
  try {
    bruto = JSON.parse(conteudo);
  } catch {
    return { problema: 'o arquivo não é uma planta (não é um arquivo JSON)' };
  }
  const raiz = objeto(bruto);
  // aceita também a resposta da API inteira ({ planta: {...} })
  const p = raiz && objeto(raiz.planta) ? objeto(raiz.planta)! : raiz;
  if (!p || !Array.isArray(p.ambientes) || !Array.isArray(p.moveis)) {
    return { problema: 'o arquivo não é uma planta: faltam os ambientes e os equipamentos' };
  }
  if (p.cameras !== undefined && !Array.isArray(p.cameras)) return { problema: 'as câmeras do arquivo não são uma lista' };

  const ids = new Set<string>();
  const ambientes: Ambiente[] = [];
  for (const [i, bA] of (p.ambientes as unknown[]).entries()) {
    const o = objeto(bA);
    const onde = `ambiente ${i + 1}`;
    if (!o) return { problema: `${onde}: não é um ambiente` };
    const id = texto(o.id);
    const nome = texto(o.nome);
    if (!id || !nome) return { problema: `${onde}: falta o id ou o nome` };
    if (ids.has(id)) return { problema: `${onde}: o id "${id}" se repete no arquivo` };
    ids.add(id);
    const { r, problema } = retangulo(o, `${onde} (${nome})`);
    if (problema) return { problema };
    const setorId = typeof o.setorId === 'string' && setores.includes(o.setorId) ? o.setorId : null;
    ambientes.push({ id, nome, setorId, ...r! });
  }

  const moveis: Movel[] = [];
  for (const [i, bM] of (p.moveis as unknown[]).entries()) {
    const o = objeto(bM);
    const onde = `equipamento ${i + 1}`;
    if (!o) return { problema: `${onde}: não é um equipamento` };
    const id = texto(o.id);
    const nome = texto(o.nome);
    if (!id || !nome) return { problema: `${onde}: falta o id ou o nome` };
    if (ids.has(id)) return { problema: `${onde}: o id "${id}" se repete no arquivo` };
    ids.add(id);
    const { r, problema } = retangulo(o, `${onde} (${nome})`);
    if (problema) return { problema };
    if (!ehNumero(o.alt)) return { problema: `${onde} (${nome}): falta a altura (alt) em metros` };
    const itemId = typeof o.itemId === 'string' && itens.includes(o.itemId) ? o.itemId : null;
    moveis.push({ id, nome, itemId, ...r!, alt: centesimos(o.alt) });
  }

  // As câmeras: pelo identificador do canal desta loja, ou pelo número do canal.
  const cameras: Camera[] = [];
  const relatorio: CameraImportada[] = [];
  const usados = new Set<string>();
  for (const [i, bC] of ((p.cameras as unknown[] | undefined) ?? []).entries()) {
    const o = objeto(bC);
    const onde = `câmera ${i + 1}`;
    if (!o) return { problema: `${onde}: não é uma câmera` };
    const numero = ehNumero(o.canal) && Number.isInteger(o.canal) ? o.canal : null;
    const rotulo = numero !== null ? `canal ${numero}` : onde;
    for (const k of ['x', 'y', 'alt', 'dir', 'abertura', 'alcance'] as const) {
      if (!ehNumero(o[k])) return { problema: `${rotulo}: falta ${k}` };
    }
    let ponto: CanalDaLoja | null = null;
    let motivo: string | null = null;
    const porId = typeof o.pontoId === 'string' ? canais.find((c) => c.id === o.pontoId) : undefined;
    if (porId) ponto = porId;
    else if (numero === null) motivo = 'o arquivo não diz de que canal ela é';
    else {
      const mesmos = canais.filter((c) => c.canal === numero);
      if (mesmos.length === 1) ponto = mesmos[0]!;
      else if (mesmos.length === 0) motivo = `o canal ${numero} não está cadastrado no console`;
      else motivo = `há ${mesmos.length} canais com o número ${numero} (gravadores diferentes): ponha à mão na edição`;
    }
    if (ponto && usados.has(ponto.id)) {
      motivo = `${ponto.canal != null ? `o canal ${ponto.canal}` : ponto.nome} já entrou por outra câmera do arquivo`;
      ponto = null;
    }
    relatorio.push({ rotulo, numero, ponto, motivo });
    if (!ponto) continue;
    usados.add(ponto.id);
    cameras.push({
      pontoId: ponto.id,
      x: centesimos(o.x as number),
      y: centesimos(o.y as number),
      alt: centesimos(o.alt as number),
      dir: centesimos(o.dir as number),
      abertura: centesimos(o.abertura as number),
      alcance: centesimos(o.alcance as number),
      ...(ehNumero(o.incl) ? { incl: centesimos(o.incl) } : {}),
    });
  }

  return { importacao: { planta: { ambientes, moveis, cameras }, cameras: relatorio } };
}
