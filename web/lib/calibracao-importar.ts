// =====================================================================
// Importar os pontos de calibração de um arquivo — a conta, sem tela
// =====================================================================
// Pedido do dono em 27/10/2026 ("pode colocar"): a calibração das câmeras da
// cozinha foi feita fora do console, pela grade do piso (0,72 m) e a altura
// das câmeras (2,20 m), e entra por um arquivo — tocar 57 pontos à mão, duas
// vezes cada, é o trabalho que ela poupa. Como no "Importar planta"
// (`planta-importar.ts`), cada calibração do arquivo vem pelo NÚMERO DO CANAL
// e entra no canal da loja com esse número.
//
// O arquivo: `{ calibracoes: [{ canal: 1, pares: [{ img: [u, v], piso: [x, y] }] }] }`
// — `img` em fração da imagem (0 a 1), `piso` em metros na planta. Também vale
// uma calibração só (`{ pares: [...] }`, com `canal`) ou a lista sozinha.
//
// Quem decide se a calibração vale é a API, ao salvar (`lerCalibracao`): aqui
// só a forma (cada ponto tem os quatro números) e a quantidade que a API aceita.
// Não importa nada (os testes da API a leem pelo caminho).
// =====================================================================

import type { ParDaCalibracao } from './planta-viva';

/** Um canal cadastrado na loja, do jeito que a tela já tem. */
export type CanalDaLoja = { id: string; canal: number | null; nome: string };

/** Cada calibração do arquivo e o que vai acontecer com ela. */
export type CalibracaoImportada = {
  /** Como o arquivo chamou ("canal 1"). */
  rotulo: string;
  numero: number | null;
  pares: ParDaCalibracao[];
  /** O canal da loja em que ela entra; nulo = fica de fora. */
  ponto: CanalDaLoja | null;
  motivo: string | null;
};

/** O que a API aceita numa calibração (`LIMITES_DA_CALIBRACAO`). */
export const PONTOS_POR_CALIBRACAO = [4, 40] as const;
export const TAMANHO_MAXIMO_DO_ARQUIVO = 1_000_000;

const ehNumero = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
type Bruto = Record<string, unknown>;
const objeto = (v: unknown): Bruto | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Bruto) : null);

/** Os pares de uma calibração, conferidos na forma; ou o que está errado. */
function lerPares(bruto: unknown, onde: string): { pares?: ParDaCalibracao[]; problema?: string } {
  if (!Array.isArray(bruto)) return { problema: `${onde}: faltam os pontos (pares)` };
  const pares: ParDaCalibracao[] = [];
  for (const [i, b] of bruto.entries()) {
    const o = objeto(b);
    const img = o?.img, piso = o?.piso;
    if (!Array.isArray(img) || img.length !== 2 || !img.every(ehNumero) || !Array.isArray(piso) || piso.length !== 2 || !piso.every(ehNumero)) {
      return { problema: `${onde}, ponto ${i + 1}: precisa de img [u, v] e piso [x, y]` };
    }
    if (img.some((v) => v < 0 || v > 1)) return { problema: `${onde}, ponto ${i + 1}: img vai de 0 a 1 (fração da imagem)` };
    pares.push({ img: [img[0], img[1]], piso: [piso[0], piso[1]] });
  }
  return { pares };
}

/**
 * Lê o texto do arquivo e liga cada calibração a um canal da loja: pelo identificador (`pontoId`) ou pelo número do
 * canal. Fica de fora, com o motivo: o número sem canal cadastrado, o repetido em dois gravadores, a segunda do mesmo
 * canal e a que tem pontos de menos ou de mais.
 */
export function lerArquivoDePontos(conteudo: string, canais: CanalDaLoja[]): { calibracoes?: CalibracaoImportada[]; problema?: string } {
  if (conteudo.length > TAMANHO_MAXIMO_DO_ARQUIVO) return { problema: 'o arquivo é grande demais para pontos de calibração' };
  let bruto: unknown;
  try {
    bruto = JSON.parse(conteudo);
  } catch {
    return { problema: 'o arquivo não é de pontos de calibração (não é um arquivo JSON)' };
  }
  const raiz = objeto(bruto);
  const lista: unknown[] | null = Array.isArray(bruto)
    ? bruto
    : raiz && Array.isArray(raiz.calibracoes)
      ? (raiz.calibracoes as unknown[])
      : raiz && Array.isArray(raiz.pares)
        ? [raiz]
        : null;
  if (!lista || lista.length === 0) return { problema: 'o arquivo não traz nenhuma calibração (calibracoes com canal e pares)' };

  const [minimo, maximo] = PONTOS_POR_CALIBRACAO;
  const usados = new Set<string>();
  const saida: CalibracaoImportada[] = [];
  for (const [i, b] of lista.entries()) {
    const o = objeto(b);
    if (!o) return { problema: `calibração ${i + 1}: não é uma calibração` };
    const numero = ehNumero(o.canal) && Number.isInteger(o.canal) ? o.canal : null;
    const rotulo = numero !== null ? `canal ${numero}` : `calibração ${i + 1}`;
    const { pares, problema } = lerPares(o.pares, rotulo);
    if (!pares) return { problema };

    let ponto: CanalDaLoja | null = null;
    let motivo: string | null = null;
    const porId = typeof o.pontoId === 'string' ? canais.find((c) => c.id === o.pontoId) : undefined;
    if (porId) ponto = porId;
    else if (numero === null) motivo = 'o arquivo não diz de que canal ela é';
    else {
      const mesmos = canais.filter((c) => c.canal === numero);
      if (mesmos.length === 1) ponto = mesmos[0]!;
      else if (mesmos.length === 0) motivo = `o canal ${numero} não está cadastrado no console`;
      else motivo = `há ${mesmos.length} canais com o número ${numero} (gravadores diferentes)`;
    }
    if (ponto && usados.has(ponto.id)) {
      motivo = `${ponto.canal != null ? `o canal ${ponto.canal}` : ponto.nome} já entrou por outra calibração do arquivo`;
      ponto = null;
    }
    if (ponto && (pares.length < minimo || pares.length > maximo)) {
      motivo = `${pares.length} ponto(s): a calibração precisa de ${minimo} a ${maximo}`;
      ponto = null;
    }
    if (ponto) usados.add(ponto.id);
    saida.push({ rotulo, numero, pares, ponto, motivo });
  }
  return { calibracoes: saida };
}
