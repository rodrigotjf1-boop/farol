// =====================================================================
// A planta da loja — a conta, sem banco
// =====================================================================
// A planta é feita de retângulos, em metros: os ambientes, os móveis e
// cada câmera no seu lugar. Aqui mora o que a API precisa dela:
//
//   1. ler o que o console mandou (`lerPlanta`): tudo conferido e
//      arredondado, o que não é da planta fica de fora;
//   2. o que cada câmera vê (`moveisVistos`): o setor de círculo da lente,
//      cortado nas paredes do ambiente em que ela está;
//   3. a frase do lugar (`descricaoDoLugar`), que desce ao agente e vai
//      junto com a pergunta feita a um modelo sobre aquele canal.
//
// ⚠️ A geometria (2) existe também no console (`web/lib/planta.ts`), que
// desenha o cone enquanto a câmera é arrastada. São duas cópias da mesma
// conta, em dois programas que não compartilham código. O que as mantém
// iguais é `api/testes/planta.test.ts`: ele roda as duas sobre o exemplo
// de `contratos/planta.json` e sobre centenas de câmeras sorteadas, e
// exige a mesma resposta.
// =====================================================================

export type Ambiente = { id: string; nome: string; setorId: string | null; x: number; y: number; w: number; h: number };
export type Movel = { id: string; nome: string; itemId: string | null; x: number; y: number; w: number; h: number; alt: number };
/**
 * `dir` em graus: 0 = para a direita da planta, 90 = para baixo. `incl` em graus abaixo do horizonte (0 = reto, 90 =
 * direto no chão): opcional — a planta de antes não tinha, e quem não manda continua sem. Só a vista em 3D e a câmera
 * simulada do console usam; o leque no chão e a frase do lugar não mudam com ela.
 */
export type Camera = { pontoId: string; x: number; y: number; alt: number; dir: number; abertura: number; alcance: number; incl?: number };
/**
 * Área de medida (pedido do dono, 28/10/2026: o balcão, o atendimento do delivery e a saída dos entregadores). NÃO é
 * ambiente: ambiente é parede para o que cada câmera cobre; a área só marca um pedaço de chão para contar.
 *   espera — quanto tempo cada pessoa fica dentro (a fila do balcão, a retirada, a espera dos entregadores);
 *   porta  — quem entra (o caminho começa nela) e quem sai (o caminho termina nela), com a hora.
 */
export type TipoDeArea = 'espera' | 'porta';
export type Area = { id: string; nome: string; tipo: TipoDeArea; x: number; y: number; w: number; h: number };
export type Planta = { ambientes: Ambiente[]; moveis: Movel[]; cameras: Camera[]; areas: Area[] };
export const TIPOS_DE_AREA: readonly TipoDeArea[] = ['espera', 'porta'];

export const LIMITES_DA_PLANTA = {
  ambientes: 30,
  moveis: 200,
  cameras: 64,
  areas: 20,
  nome: 60,
  /** Nada passa disto, em metros: nem posição, nem o fim de um retângulo. */
  extensao: 200,
  ladoDoAmbiente: [0.5, 100],
  ladoDoMovel: [0.2, 30],
  ladoDaArea: [0.3, 60],
  alturaDoMovel: [0.1, 5],
  alturaDaCamera: [0.5, 10],
  abertura: [20, 180],
  alcance: [0.5, 30],
  inclinacao: [0, 90],
} as const;

/** Quantos nomes cabem na frase do lugar. É texto pago a cada análise. */
export const MAX_NOMES_NO_LUGAR = 8;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/i;

const centesimos = (n: number): number => Math.round(n * 100) / 100;
const comVirgula = (n: number): string => String(n).replace('.', ',');

function medida(v: unknown, [min, max]: readonly [number, number]): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = centesimos(v);
  return n < min || n > max ? null : n;
}

/** O nome, numa linha só: vai para dentro de uma frase lida por um modelo. */
function nomeLimpo(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const limpo = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return limpo && limpo.length <= LIMITES_DA_PLANTA.nome ? limpo : null;
}

const faixa = ([min, max]: readonly [number, number]): string => `de ${comVirgula(min)} a ${comVirgula(max)}`;

/**
 * Lê a planta que veio no corpo. Devolve a planta LIMPA (só os campos que
 * existem, medidas com duas casas) ou a frase do que está errado, dizendo
 * onde.
 */
export function lerPlanta(corpo: unknown): { planta?: Planta; problema?: string } {
  const L = LIMITES_DA_PLANTA;
  if (typeof corpo !== 'object' || corpo === null || Array.isArray(corpo)) return { problema: 'mande a planta: ambientes, moveis e cameras' };
  const c = corpo as Record<string, unknown>;
  for (const lista of ['ambientes', 'moveis', 'cameras'] as const) {
    if (!Array.isArray(c[lista])) return { problema: `${lista}: lista obrigatória (pode ser vazia)` };
    if ((c[lista] as unknown[]).length > L[lista]) return { problema: `${lista}: no máximo ${L[lista]}` };
  }
  const posicao: readonly [number, number] = [0, L.extensao];

  /** O retângulo no chão, comum a ambiente e móvel. */
  const retangulo = (o: Record<string, unknown>, onde: string, lado: readonly [number, number]) => {
    const x = medida(o.x, posicao);
    const y = medida(o.y, posicao);
    if (x === null || y === null) return { problema: `${onde}: posição (x, y) em metros, ${faixa(posicao)}` };
    const w = medida(o.w, lado);
    const h = medida(o.h, lado);
    if (w === null || h === null) return { problema: `${onde}: largura e comprimento ${faixa(lado)} (metros)` };
    if (x + w > L.extensao + 1e-9 || y + h > L.extensao + 1e-9) return { problema: `${onde}: passa de ${L.extensao} m da origem da planta` };
    return { x, y, w, h };
  };
  const objeto = (v: unknown): Record<string, unknown> | null =>
    typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

  const ambientes: Ambiente[] = [];
  for (const [i, bruto] of (c.ambientes as unknown[]).entries()) {
    const onde = `ambientes[${i}]`;
    const o = objeto(bruto);
    if (!o) return { problema: `${onde}: não é um ambiente` };
    if (typeof o.id !== 'string' || !ID.test(o.id)) return { problema: `${onde}.id: letras, números e hífen, até 40` };
    if (ambientes.some((a) => a.id === o.id)) return { problema: `${onde}.id: repetido` };
    const nome = nomeLimpo(o.nome);
    if (!nome) return { problema: `${onde}.nome: texto de 1 a ${L.nome} caracteres` };
    const setorId = o.setorId ?? null;
    if (setorId !== null && (typeof setorId !== 'string' || !UUID.test(setorId))) return { problema: `${onde}.setorId: o setor, ou nada` };
    const r = retangulo(o, onde, L.ladoDoAmbiente);
    if ('problema' in r) return r;
    ambientes.push({ id: o.id, nome, setorId: setorId === null ? null : setorId.toLowerCase(), ...r });
  }

  const moveis: Movel[] = [];
  for (const [i, bruto] of (c.moveis as unknown[]).entries()) {
    const onde = `moveis[${i}]`;
    const o = objeto(bruto);
    if (!o) return { problema: `${onde}: não é um móvel` };
    if (typeof o.id !== 'string' || !ID.test(o.id)) return { problema: `${onde}.id: letras, números e hífen, até 40` };
    if (moveis.some((m) => m.id === o.id)) return { problema: `${onde}.id: repetido` };
    const nome = nomeLimpo(o.nome);
    if (!nome) return { problema: `${onde}.nome: texto de 1 a ${L.nome} caracteres` };
    const itemId = o.itemId ?? null;
    if (itemId !== null && (typeof itemId !== 'string' || !UUID.test(itemId))) return { problema: `${onde}.itemId: o equipamento do inventário, ou nada` };
    const item = itemId === null ? null : itemId.toLowerCase();
    // Um equipamento está num lugar só.
    if (item !== null && moveis.some((m) => m.itemId === item)) return { problema: `${onde}.itemId: este equipamento já está na planta` };
    const r = retangulo(o, onde, L.ladoDoMovel);
    if ('problema' in r) return r;
    const alt = medida(o.alt, L.alturaDoMovel);
    if (alt === null) return { problema: `${onde}.alt: altura ${faixa(L.alturaDoMovel)} (metros)` };
    moveis.push({ id: o.id, nome, itemId: item, ...r, alt });
  }

  const cameras: Camera[] = [];
  for (const [i, bruto] of (c.cameras as unknown[]).entries()) {
    const onde = `cameras[${i}]`;
    const o = objeto(bruto);
    if (!o) return { problema: `${onde}: não é uma câmera` };
    if (typeof o.pontoId !== 'string' || !UUID.test(o.pontoId)) return { problema: `${onde}.pontoId: o canal` };
    const pontoId = o.pontoId.toLowerCase();
    // Uma câmera está num lugar só.
    if (cameras.some((k) => k.pontoId === pontoId)) return { problema: `${onde}.pontoId: este canal já está na planta` };
    const x = medida(o.x, posicao);
    const y = medida(o.y, posicao);
    if (x === null || y === null) return { problema: `${onde}: posição (x, y) em metros, ${faixa(posicao)}` };
    const alt = medida(o.alt, L.alturaDaCamera);
    if (alt === null) return { problema: `${onde}.alt: altura ${faixa(L.alturaDaCamera)} (metros)` };
    if (typeof o.dir !== 'number' || !Number.isFinite(o.dir)) return { problema: `${onde}.dir: direção em graus` };
    const dir = ((Math.round(o.dir) % 360) + 360) % 360;
    const abertura = medida(o.abertura, L.abertura);
    if (abertura === null) return { problema: `${onde}.abertura: ${faixa(L.abertura)} (graus)` };
    const alcance = medida(o.alcance, L.alcance);
    if (alcance === null) return { problema: `${onde}.alcance: ${faixa(L.alcance)} (metros)` };
    // Ausente (ou nulo) fica ausente: a planta de antes do campo não muda só por ser salva de novo.
    if (o.incl === undefined || o.incl === null) {
      cameras.push({ pontoId, x, y, alt, dir, abertura, alcance });
      continue;
    }
    const incl = medida(o.incl, L.inclinacao);
    if (incl === null) return { problema: `${onde}.incl: inclinação ${faixa(L.inclinacao)} (graus abaixo do horizonte)` };
    cameras.push({ pontoId, x, y, alt, dir, abertura, alcance, incl: Math.round(incl) });
  }

  // As áreas de medida: a planta de antes não tinha — ausente (ou nulo) é lista vazia. Quem decide "ausente mantém as
  // que estavam" é a gravação (`rotas/planta.ts`), que sabe o que estava.
  const areas: Area[] = [];
  if (c.areas !== undefined && c.areas !== null) {
    if (!Array.isArray(c.areas)) return { problema: 'areas: lista (pode ser vazia)' };
    if (c.areas.length > L.areas) return { problema: `areas: no máximo ${L.areas}` };
    for (const [i, bruto] of (c.areas as unknown[]).entries()) {
      const onde = `areas[${i}]`;
      const o = objeto(bruto);
      if (!o) return { problema: `${onde}: não é uma área` };
      if (typeof o.id !== 'string' || !ID.test(o.id)) return { problema: `${onde}.id: letras, números e hífen, até 40` };
      if (areas.some((a) => a.id === o.id)) return { problema: `${onde}.id: repetido` };
      const nome = nomeLimpo(o.nome);
      if (!nome) return { problema: `${onde}.nome: texto de 1 a ${L.nome} caracteres` };
      if (typeof o.tipo !== 'string' || !TIPOS_DE_AREA.includes(o.tipo as TipoDeArea)) return { problema: `${onde}.tipo: espera ou porta` };
      const r = retangulo(o, onde, L.ladoDaArea);
      if ('problema' in r) return r;
      areas.push({ id: o.id, nome, tipo: o.tipo as TipoDeArea, ...r });
    }
  }

  return { planta: { ambientes, moveis, cameras, areas } };
}

/** O ponto (x, y) dentro da área (a borda conta). */
export const dentroDaArea = (a: Pick<Area, 'x' | 'y' | 'w' | 'h'>, x: number, y: number): boolean =>
  x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h;

// ───────────────────────── a geometria, no chão ─────────────────────────

type Pt = [number, number];
const rad = (g: number): number => (g * Math.PI) / 180;

export const centroDe = (r: { x: number; y: number; w: number; h: number }): Pt => [r.x + r.w / 2, r.y + r.h / 2];

/** O ambiente em que o ponto está (a borda conta). O primeiro desenhado vence. */
export const ambienteEm = (planta: Planta, x: number, y: number): Ambiente | undefined =>
  planta.ambientes.find((a) => x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h);

/**
 * O que a câmera alcança no chão: um setor de círculo, cortado nas paredes
 * do ambiente em que ela está. Câmera fora de todo ambiente não é cortada.
 */
export function coneDaCamera(planta: Planta, cam: Camera): Pt[] {
  const pontos: Pt[] = [[cam.x, cam.y]];
  const de = cam.dir - cam.abertura / 2;
  const passos = Math.max(6, Math.round(cam.abertura / 6));
  for (let i = 0; i <= passos; i += 1) {
    const a = rad(de + (cam.abertura * i) / passos);
    pontos.push([cam.x + Math.cos(a) * cam.alcance, cam.y + Math.sin(a) * cam.alcance]);
  }
  const a = ambienteEm(planta, cam.x, cam.y);
  if (!a) return pontos;
  // recorte de polígono por retângulo, um lado de cada vez
  const lados: Array<[(p: Pt) => boolean, (p: Pt, q: Pt) => Pt]> = [
    [(p) => p[0] >= a.x, (p, q) => [a.x, p[1] + ((q[1] - p[1]) * (a.x - p[0])) / (q[0] - p[0])]],
    [(p) => p[0] <= a.x + a.w, (p, q) => [a.x + a.w, p[1] + ((q[1] - p[1]) * (a.x + a.w - p[0])) / (q[0] - p[0])]],
    [(p) => p[1] >= a.y, (p, q) => [p[0] + ((q[0] - p[0]) * (a.y - p[1])) / (q[1] - p[1]), a.y]],
    [(p) => p[1] <= a.y + a.h, (p, q) => [p[0] + ((q[0] - p[0]) * (a.y + a.h - p[1])) / (q[1] - p[1]), a.y + a.h]],
  ];
  let poligono = pontos;
  for (const [dentro, corte] of lados) {
    const novo: Pt[] = [];
    poligono.forEach((p, i) => {
      const q = poligono[(i + 1) % poligono.length]!;
      if (dentro(p)) novo.push(p);
      if (dentro(p) !== dentro(q)) novo.push(corte(p, q));
    });
    poligono = novo;
  }
  return poligono;
}

export function dentroDoPoligono(pt: Pt, poligono: Pt[]): boolean {
  let dentro = false;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i, i += 1) {
    const [xi, yi] = poligono[i]!;
    const [xj, yj] = poligono[j]!;
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

/** Os móveis cujo CENTRO está no que a câmera alcança, do mais perto ao mais longe. */
export function moveisVistos(planta: Planta, cam: Camera): Movel[] {
  const cone = coneDaCamera(planta, cam);
  const distancia = (m: Movel): number => Math.hypot(m.x + m.w / 2 - cam.x, m.y + m.h / 2 - cam.y);
  return planta.moveis
    .filter((m) => dentroDoPoligono(centroDe(m), cone))
    .map((m, i) => ({ m, i, d: distancia(m) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((v) => v.m);
}

// ───────────────────────── a frase do lugar ─────────────────────────

/**
 * Onde a câmera fica e o que tem na frente dela, em uma frase. É o que vai
 * junto com cada análise do canal feita por um modelo — por isso é curta,
 * e por isso só afirma o que a planta sabe: sem móvel no campo de visão,
 * ela não diz "não há equipamento" (a imagem pode mostrar um que ninguém
 * desenhou).
 *
 * `nomeDe` dá o nome de cada móvel: o do equipamento do inventário, quando
 * ele está ligado a um, ou o que foi escrito na planta.
 */
export function descricaoDoLugar(planta: Planta, cam: Camera, nomeDe: (m: Movel) => string = (m) => m.nome): string {
  const a = ambienteEm(planta, cam.x, cam.y);
  const quantos = new Map<string, number>();
  for (const m of moveisVistos(planta, cam)) {
    const n = nomeDe(m).toLowerCase();
    quantos.set(n, (quantos.get(n) ?? 0) + 1);
  }
  // "mesa (3)", e não "3 mesas": o plural de um nome escrito por alguém
  // não se adivinha ("balcão", "freezer").
  const nomes = [...quantos].map(([n, q]) => (q > 1 ? `${n} (${q})` : n));
  const cabem = nomes.slice(0, MAX_NOMES_NO_LUGAR);
  const resto = nomes.length - cabem.length;
  if (resto > 0) cabem.push(`mais ${resto}`);
  const lista = cabem.length > 1 ? `${cabem.slice(0, -1).join(', ')} e ${cabem[cabem.length - 1]}` : cabem[0];
  return (
    `Câmera ${a ? `no ambiente ${a.nome}` : 'fora dos ambientes desenhados'}, a ${comVirgula(cam.alt)} m do chão.` +
    (lista ? ` No campo de visão: ${lista}.` : '')
  );
}

/** A frase do lugar de cada câmera da planta, pelo canal. */
export function lugaresDaPlanta(planta: Planta, nomeDoItem: ReadonlyMap<string, string> = new Map()): Map<string, string> {
  const nomeDe = (m: Movel): string => (m.itemId && nomeDoItem.get(m.itemId)) || m.nome;
  return new Map(planta.cameras.map((cam) => [cam.pontoId, descricaoDoLugar(planta, cam, nomeDe)]));
}

/**
 * O que o rastreio da planta viva, no agente, usa da planta (A26, rastreio firme, 28/10/2026): os móveis com a altura —
 * a pessoa nunca fica dentro de um, e o móvel entre a câmera e o chão esconde as pernas de quem está atrás — e o
 * retângulo que cobre os ambientes (ponto muito fora dele não é desta planta). Só números: o nome dos móveis não desce.
 */
export function plantaParaOAgente(planta: Planta): {
  moveis: { x: number; y: number; w: number; h: number; alt: number }[];
  limites: [number, number, number, number] | null;
} {
  const a = planta.ambientes;
  return {
    moveis: planta.moveis.map(({ x, y, w, h, alt }) => ({ x, y, w, h, alt })),
    limites: a.length
      ? [
          Math.min(...a.map((r) => r.x)),
          Math.min(...a.map((r) => r.y)),
          centesimos(Math.max(...a.map((r) => r.x + r.w))),
          centesimos(Math.max(...a.map((r) => r.y + r.h))),
        ]
      : null,
  };
}

/** A altura medida de cada câmera da planta, pelo canal: o agente confere com a que a calibração dá. */
export const alturasDasCameras = (planta: Planta): Map<string, number> => new Map(planta.cameras.map((c) => [c.pontoId, c.alt]));
