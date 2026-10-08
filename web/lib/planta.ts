// =====================================================================
// A planta da loja — a conta, sem tela
// =====================================================================
// A planta é feita de retângulos, em metros. Aqui mora a conta que a tela
// faz com ela: o que cada câmera alcança, o que nenhuma vê, e como o chão
// vira desenho (de cima e em perspectiva).
//
// ⚠️ Este arquivo não importa nada, de propósito. O cone da câmera e "o
// que ela vê" existem também na API (`api/src/planta.ts`), que escreve a
// frase do lugar de cada canal. São duas cópias da mesma conta; o que as
// mantém iguais é `api/testes/planta.test.ts`, que importa ESTE arquivo e
// exige a mesma resposta das duas.
// =====================================================================

export type Ambiente = { id: string; nome: string; setorId: string | null; x: number; y: number; w: number; h: number };
export type Movel = { id: string; nome: string; itemId: string | null; x: number; y: number; w: number; h: number; alt: number };
/** `dir` em graus: 0 = para a direita da planta, 90 = para baixo. */
export type Camera = { pontoId: string; x: number; y: number; alt: number; dir: number; abertura: number; alcance: number };
export type Planta = { ambientes: Ambiente[]; moveis: Movel[]; cameras: Camera[] };

export type Pt = [number, number];
type Retangulo = { x: number; y: number; w: number; h: number };

/** Os mesmos limites da API (`LIMITES_DA_PLANTA`): a tela não deixa passar o que ela recusaria. */
export const LIMITES = {
  ambientes: 30,
  moveis: 200,
  nome: 60,
  extensao: 200,
  ladoDoAmbiente: [0.5, 100],
  ladoDoMovel: [0.2, 30],
  alturaDoMovel: [0.1, 5],
  alturaDaCamera: [2, 4],
  abertura: [40, 120],
  alcance: [1, 12],
} as const;

export const PLANTA_VAZIA: Planta = { ambientes: [], moveis: [], cameras: [] };
/** A câmera que acaba de entrar na planta: no teto, lente comum, olhando para baixo no desenho. */
export const CAMERA_NOVA = { alt: 2.6, dir: 90, abertura: 80, alcance: 3 } as const;

export const rad = (g: number): number => (g * Math.PI) / 180;
export const noLimite = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
/** Arredonda para a grade — e tira o lixo do ponto flutuante (0,30000000000000004). */
export const grade = (v: number, passo: number): number => Math.round(Math.round(v / passo) * passo * 100) / 100;
export const centroDe = (r: Retangulo): Pt => [r.x + r.w / 2, r.y + r.h / 2];
export const comVirgula = (n: number): string => String(n).replace('.', ',');

/** O ambiente em que o ponto está (a borda conta). O primeiro desenhado vence. */
export const ambienteEm = (planta: Planta, x: number, y: number): Ambiente | undefined =>
  planta.ambientes.find((a) => x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h);

// ───────────────────────── a geometria, no chão ─────────────────────────

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

/** As câmeras que alcançam o centro do móvel. */
export const camerasQueVeem = (planta: Planta, m: Movel): Camera[] =>
  planta.cameras.filter((cam) => dentroDoPoligono(centroDe(m), coneDaCamera(planta, cam)));

export type Cobertura = { ambiente: Ambiente; parte: number; faixas: Array<[number, number, number, number]> };

/**
 * A cobertura de cada ambiente, em quadros de meio metro: `parte` é quanto
 * do chão alguma câmera alcança, e `faixas` são os retângulos que nenhuma
 * vê. `cobrem` decide quais câmeras contam — canal sem imagem ou pausado
 * não cobre nada.
 */
export function coberturaDaPlanta(planta: Planta, cobrem: (cam: Camera) => boolean = () => true): Cobertura[] {
  const cones = planta.cameras.filter(cobrem).map((cam) => coneDaCamera(planta, cam));
  const passo = 0.5;
  return planta.ambientes.map((a) => {
    const faixas: Cobertura['faixas'] = [];
    let total = 0;
    let cobertos = 0;
    for (let y = a.y; y < a.y + a.h - 0.01; y += passo) {
      let inicio: number | null = null;
      for (let x = a.x; x < a.x + a.w - 0.01; x += passo) {
        total += 1;
        const visto = cones.some((c) => dentroDoPoligono([x + passo / 2, y + passo / 2], c));
        if (visto) cobertos += 1;
        if (!visto && inicio === null) inicio = x;
        if ((visto || x + passo >= a.x + a.w - 0.01) && inicio !== null) {
          faixas.push([inicio, y, visto ? x : Math.min(x + passo, a.x + a.w), Math.min(y + passo, a.y + a.h)]);
          inicio = null;
        }
      }
    }
    return { ambiente: a, parte: total ? cobertos / total : 0, faixas };
  });
}

// ───────────────────────── do chão para a tela ─────────────────────────

/** A altura da parede do fundo, em metros: baixa, para não esconder o que está atrás. */
export const PAREDE = 0.5;
/** A câmera fica no teto, mas o marcador dela fica perto do chão: com oito
 *  câmeras a 2,6 m, as cabeças se embaralham longe de onde cada uma está. */
export const pinoDa = (cam: Pick<Camera, 'alt'>): number => Math.min(cam.alt, 1.3);

/** O retângulo de chão que a tela mostra, em metros: [x1, y1, x2, y2]. */
export type Moldura = [number, number, number, number];

/** O que existe, com folga nenhuma: é o que a planta mostra fora da edição. */
export function molduraDoQueExiste(planta: Planta): Moldura {
  const rs: Retangulo[] = [...planta.ambientes, ...planta.moveis];
  const xs = [...rs.flatMap((r) => [r.x, r.x + r.w]), ...planta.cameras.map((c) => c.x)];
  const ys = [...rs.flatMap((r) => [r.y, r.y + r.h]), ...planta.cameras.map((c) => c.y)];
  if (!xs.length) return [0, 0, 14, 9];
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/**
 * Na edição a moldura tem espaço para desenhar: começa na origem, tem pelo
 * menos 14 × 9 m e sempre dois metros além do que já existe (até o limite).
 */
export function molduraDeEdicao(planta: Planta): Moldura {
  const [, , x2, y2] = planta.ambientes.length || planta.moveis.length || planta.cameras.length ? molduraDoQueExiste(planta) : [0, 0, 0, 0];
  return [0, 0, Math.min(LIMITES.extensao, Math.max(14, x2 + 2)), Math.min(LIMITES.extensao, Math.max(9, y2 + 2))];
}

export type Projetor = {
  t: number;
  escala: number;
  /** Do chão (metros) para a tela. O terceiro número é a profundidade: maior = mais perto de quem olha. */
  p: (x: number, y: number, z?: number) => [number, number, number];
  /** Da tela de volta ao CHÃO (altura zero), em qualquer vista: é `p` ao contrário. */
  chao: (sx: number, sy: number) => Pt;
};

/**
 * `t` vai de 0 (vista de cima) a 1 (em perspectiva): gira 45° e deita a
 * planta. Tudo o que existe tem de caber em `largura` × `altura`, com a
 * margem.
 */
export function projetor(planta: Planta, moldura: Moldura, t: number, largura: number, altura: number, margem = 30): Projetor {
  const giro = rad(45 * t);
  const queda = rad(90 - 48 * t); // 90° = de cima; 42° = em perspectiva
  const [x1, y1, x2, y2] = moldura;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const cru = (x: number, y: number, z = 0): [number, number, number] => {
    const dx = x - cx;
    const dy = y - cy;
    const xr = dx * Math.cos(giro) - dy * Math.sin(giro);
    const yr = dx * Math.sin(giro) + dy * Math.cos(giro);
    return [xr, yr * Math.sin(queda) - z * Math.cos(queda), yr];
  };
  // os cantos do chão, o alto da parede do fundo e a cabeça das câmeras
  const marcos = [
    [x1, y1, 0], [x2, y1, 0], [x1, y2, 0], [x2, y2, 0], [x1, y1, PAREDE],
    ...planta.cameras.map((c) => [c.x, c.y, pinoDa(c) + 0.5]),
  ].map(([x, y, z]) => cru(x!, y!, z! * t));
  const minX = Math.min(...marcos.map((m) => m[0]));
  const maxX = Math.max(...marcos.map((m) => m[0]));
  const minY = Math.min(...marcos.map((m) => m[1]));
  const maxY = Math.max(...marcos.map((m) => m[1]));
  const escala = Math.min((largura - 2 * margem) / Math.max(maxX - minX, 0.001), (altura - 2 * margem) / Math.max(maxY - minY, 0.001));
  const ox = (largura - (maxX + minX) * escala) / 2;
  const oy = (altura - (maxY + minY) * escala) / 2;
  return {
    t,
    escala,
    p: (x, y, z = 0) => {
      const [a, b, fundo] = cru(x, y, z * t);
      return [a * escala + ox, b * escala + oy, fundo];
    },
    chao: (sx, sy) => {
      const xr = (sx - ox) / escala;
      const yr = (sy - oy) / escala / Math.sin(queda);
      return [xr * Math.cos(giro) + yr * Math.sin(giro) + cx, -xr * Math.sin(giro) + yr * Math.cos(giro) + cy];
    },
  };
}

/**
 * Onde o nome do ambiente cabe: o ponto do chão mais longe de câmera e de
 * móvel. `meia` é meia largura do nome e `alto` a altura dele, em metros na
 * escala de agora. `evitar` são outros pontos do chão a contornar — em
 * perspectiva, onde a cabeça de cada câmera aparece.
 */
export function lugarDoNome(planta: Planta, a: Ambiente, meia: number, alto: number, evitar: Pt[] = []): Pt {
  const folgaX = Math.min(meia + 0.15, a.w / 2);
  const folgaY = Math.min(alto, a.h / 2);
  let melhor: Pt = [a.x + a.w / 2, a.y + a.h / 2];
  let nota = -1;
  for (let y = a.y + folgaY; y <= a.y + a.h - folgaY + 0.01; y += 0.25) {
    for (let x = a.x + folgaX; x <= a.x + a.w - folgaX + 0.01; x += 0.25) {
      // o nome é mais largo do que alto: a distância na horizontal pesa menos
      const ate = (ox: number, oy: number): number => Math.max(Math.abs(x - ox) / (meia + 0.3), Math.abs(y - oy) / alto);
      const cameras = [...planta.cameras.map((c): Pt => [c.x, c.y]), ...evitar].map(([ox, oy]) => ate(ox, oy));
      const moveis = planta.moveis.map((m) => ate(noLimite(x, m.x, m.x + m.w), noLimite(y, m.y, m.y + m.h)));
      const livre = Math.min(...cameras, ...moveis, 99);
      if (livre > nota + 0.001) {
        nota = livre;
        melhor = [x, y];
      }
    }
  }
  return melhor;
}

/** Um retângulo cortado em pedaços de até um metro: é o que deixa um balcão
 *  comprido passar por trás de uma mesa e pela frente de outra. */
export function fatias(tamanho: number): Array<[number, number]> {
  const n = Math.max(1, Math.ceil(tamanho));
  return Array.from({ length: n }, (_, i) => [(tamanho * i) / n, (tamanho * (i + 1)) / n] as [number, number]);
}

// ───────────────────────── mexer na planta ─────────────────────────
// Toda mudança devolve uma planta NOVA: a tela guarda a de antes para
// "Descartar mudanças", e o React só redesenha o que mudou de referência.

/** Move um ambiente e leva junto quem mora nele: os móveis e as câmeras cujo centro está dentro. */
export function moverAmbiente(planta: Planta, id: string, nx: number, ny: number): Planta {
  const a = planta.ambientes.find((x) => x.id === id);
  if (!a) return planta;
  const [mx, my] = [nx - a.x, ny - a.y];
  if (mx === 0 && my === 0) return planta;
  const dentro = (px: number, py: number): boolean => px >= a.x && px <= a.x + a.w && py >= a.y && py <= a.y + a.h;
  const soma = (v: number, d: number): number => Math.round((v + d) * 100) / 100;
  return {
    ambientes: planta.ambientes.map((x) => (x.id === id ? { ...x, x: nx, y: ny } : x)),
    moveis: planta.moveis.map((m) => (dentro(...centroDe(m)) ? { ...m, x: Math.max(0, soma(m.x, mx)), y: Math.max(0, soma(m.y, my)) } : m)),
    cameras: planta.cameras.map((c) => (dentro(c.x, c.y) ? { ...c, x: Math.max(0, soma(c.x, mx)), y: Math.max(0, soma(c.y, my)) } : c)),
  };
}

/** O menor retângulo que contém o ponto: móvel antes de ambiente. É o que o toque escolhe na edição. */
export function alvoNoChao(planta: Planta, x: number, y: number): { tipo: 'movel' | 'ambiente'; id: string } | null {
  const contem = (r: Retangulo): boolean => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  const menor = <T extends Retangulo>(lista: T[]): T | undefined => lista.filter(contem).sort((a, b) => a.w * a.h - b.w * b.h)[0];
  const movel = menor(planta.moveis);
  if (movel) return { tipo: 'movel', id: movel.id };
  const ambiente = menor(planta.ambientes);
  return ambiente ? { tipo: 'ambiente', id: ambiente.id } : null;
}

/** Iguais no que é salvo? (A ordem das listas conta: é a ordem do desenho.) */
export const mesmaPlanta = (a: Planta, b: Planta): boolean => JSON.stringify(a) === JSON.stringify(b);
