// =====================================================================
// A calibração de cada câmera pelos pontos do piso (A26, parte P1)
// =====================================================================
// O pedido do dono (25/10/2026): "definir onde cada canal fica no mapa e
// onde cobre", e o código das pessoas na planta pronto, à espera das fotos.
//
// Quem configura marca, na imagem do canal, pontos do CHÃO cuja posição na
// planta ele sabe (um canto de azulejo, o pé de uma bancada, fita no piso
// medida com trena) — de 4 para cima; o estudo recomenda de 8 a 15
// (`docs/estudo-planta-viva.md`, seção 4). Daí sai a homografia: a conta
// que leva qualquer ponto do chão na imagem para o lugar dele na planta, em
// metros. É ela que (1) desenha na planta o pedaço do piso que a câmera vê
// de verdade, no lugar do cone, e (2) leva o pé de cada pessoa ao mapa
// (parte P2, no agente — `agent/farol_agent/planta_viva/calibracao.py`, a
// mesma conta, conferida pelo mesmo contrato).
//
// A imagem entra NORMALIZADA: (0, 0) é o canto de cima à esquerda e (1, 1)
// o de baixo à direita. Assim a mesma calibração vale para o fluxo cheio e
// para o reduzido, que mostram o mesmo campo.
//
// **Erro conferido.** O erro de cada ponto contra a conta feita com ele
// mesmo é otimista. Com 5 pontos ou mais, cada ponto é deixado de fora por
// vez, a conta é refeita sem ele, e mede-se onde ele cai: é a régua que a
// tela mostra ("acerta a uns 12 cm"). Lente muito aberta curva a imagem nas
// bordas e o erro conferido cresce ali — é por ele que se vê.
//
// Conferida por `contratos/calibracao-da-camera.json`, lido aqui
// (`api/testes/calibracao.test.ts`) e no agente (`test_planta_calibracao.py`).
// =====================================================================

export type Pt = [number, number];
export type Par = { img: Pt; piso: Pt };
/** A homografia 3 × 3 por linhas, com norma 1 e o sinal que põe o chão marcado do lado positivo do horizonte. */
export type Homografia = [number, number, number, number, number, number, number, number, number];

export const LIMITES_DA_CALIBRACAO = {
  minimoDePares: 4,
  maximoDePares: 40,
  /** Dois pontos mais perto que isto, na imagem (fração da largura), são o mesmo ponto marcado duas vezes. */
  distanciaMinimaNaImagem: 0.01,
  /** Idem no piso, em metros. */
  distanciaMinimaNoPiso: 0.05,
  /** Até onde a área vista vai, a partir do centro dos pontos marcados (metros): o horizonte não vira infinito. */
  alcanceDaArea: 15,
  /** Pontos por lado da imagem para desenhar a área vista. */
  pontosPorLado: 24,
} as const;

// ───────────────────────── álgebra pequena ─────────────────────────

/** Autovetor do MENOR autovalor de uma matriz simétrica n × n (Jacobi), e os autovalores em ordem crescente. */
function autoDecomposicao(m: number[][]): { valores: number[]; vetores: number[][] } {
  const n = m.length;
  const a = m.map((l) => l.slice());
  const v: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j): number => (i === j ? 1 : 0)));
  let escala = 0;
  for (let p = 0; p < n; p++) for (let q = 0; q < n; q++) escala += a[p]![q]! ** 2;
  for (let varredura = 0; varredura < 100; varredura++) {
    let fora = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) fora += a[p]![q]! ** 2;
    if (fora <= 1e-30 * Math.max(1e-300, escala)) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p]![q]!;
        if (Math.abs(apq) < 1e-300) continue;
        const theta = (a[q]![q]! - a[p]![p]!) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k]![p]!;
          const akq = a[k]![q]!;
          a[k]![p] = c * akp - s * akq;
          a[k]![q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p]![k]!;
          const aqk = a[q]![k]!;
          a[p]![k] = c * apk - s * aqk;
          a[q]![k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k]![p]!;
          const vkq = v[k]![q]!;
          v[k]![p] = c * vkp - s * vkq;
          v[k]![q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const ordem = Array.from({ length: n }, (_, i) => i).sort((i, j) => a[i]![i]! - a[j]![j]!);
  return { valores: ordem.map((i) => a[i]![i]!), vetores: ordem.map((i) => v.map((linha) => linha[i]!)) };
}

const mult3 = (a: number[], b: number[]): number[] => {
  const r = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] = r[i * 3 + j]! + a[i * 3 + k]! * b[k * 3 + j]!;
  return r;
};

/** A normalização de Hartley: o centro dos pontos vai à origem e a distância média ao centro vira raiz de 2. */
function normalizacao(pts: Pt[]): { t: number[]; inversa: number[] } | null {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const media = pts.reduce((s, p) => s + Math.hypot(p[0] - cx, p[1] - cy), 0) / pts.length;
  if (!(media > 1e-12)) return null;
  const k = Math.SQRT2 / media;
  return { t: [k, 0, -k * cx, 0, k, -k * cy, 0, 0, 1], inversa: [1 / k, 0, cx, 0, 1 / k, cy, 0, 0, 1] };
}

/** Onde o ponto da imagem cai no piso; nulo se ele está no horizonte ou atrás da câmera. */
export function projetar(h: readonly number[], p: Pt): Pt | null {
  const w = h[6]! * p[0] + h[7]! * p[1] + h[8]!;
  if (!(w > 1e-9)) return null;
  return [(h[0]! * p[0] + h[1]! * p[1] + h[2]!) / w, (h[3]! * p[0] + h[4]! * p[1] + h[5]!) / w];
}

/** O lado de que o ponto está do horizonte: positivo = chão à frente da câmera. */
const ladoDoHorizonte = (h: readonly number[], p: Pt): number => h[6]! * p[0] + h[7]! * p[1] + h[8]!;

/**
 * A homografia imagem → piso pelos pares (DLT normalizado, mínimos quadrados). Nula quando os pares não definem
 * uma (menos de 4, todos numa reta, três de quatro numa reta…).
 */
export function homografia(pares: readonly Par[]): Homografia | null {
  if (pares.length < 4) return null;
  const ni = normalizacao(pares.map((p) => p.img));
  const np = normalizacao(pares.map((p) => p.piso));
  if (!ni || !np) return null;
  const ata = Array.from({ length: 9 }, () => new Array<number>(9).fill(0));
  const somar = (linha: number[]) => {
    for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) ata[i]![j]! += linha[i]! * linha[j]!;
  };
  for (const { img, piso } of pares) {
    const u = ni.t[0]! * img[0] + ni.t[2]!;
    const v = ni.t[4]! * img[1] + ni.t[5]!;
    const x = np.t[0]! * piso[0] + np.t[2]!;
    const y = np.t[4]! * piso[1] + np.t[5]!;
    somar([-u, -v, -1, 0, 0, 0, x * u, x * v, x]);
    somar([0, 0, 0, -u, -v, -1, y * u, y * v, y]);
  }
  const { valores, vetores } = autoDecomposicao(ata);
  // Um só jeito de ligar os pontos: o segundo menor autovalor longe de zero. Perto de zero = mais de uma
  // homografia serve (pontos numa reta) — não há calibração.
  if (!(valores[1]! > 1e-9 * Math.max(1, valores[8]!))) return null;
  const hn = vetores[0]!;
  let h = mult3(mult3(np.inversa, hn), ni.t);
  // O chão marcado fica à frente da câmera: os pontos do lado positivo do horizonte.
  const centro: Pt = [pares.reduce((s, p) => s + p.img[0], 0) / pares.length, pares.reduce((s, p) => s + p.img[1], 0) / pares.length];
  if (ladoDoHorizonte(h, centro) < 0) h = h.map((x) => -x);
  if (pares.some((p) => !(ladoDoHorizonte(h, p.img) > 0))) return null; // um ponto marcado "atrás" do horizonte
  // Norma 1, com o sinal que deixa o chão marcado do lado positivo. NÃO se divide pelo último número: ele é o
  // horizonte no canto de cima da imagem, e é negativo quando a câmera vê a parede acima do chão.
  const norma = Math.hypot(...h);
  const final = h.map((x) => x / norma);
  if (final.some((x) => !Number.isFinite(x))) return null;
  return final as Homografia;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const mediana = (xs: number[]) => {
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m]! : (o[m - 1]! + o[m]!) / 2;
};

export type ErrosDaCalibracao = {
  /** Distância (m) entre onde cada ponto marcado cai pela conta e onde ele está na planta, na ordem dos pares. */
  porPar: number[];
  medioM: number;
  maximoM: number;
  /** Deixando um ponto de fora por vez (5 pares ou mais); nulo com 4. É a régua honesta. */
  conferido: { porPar: (number | null)[]; medianaM: number; maximoM: number } | null;
};

export function errosDaCalibracao(pares: readonly Par[], h: readonly number[]): ErrosDaCalibracao {
  const porPar = pares.map((p) => {
    const q = projetar(h, p.img);
    return q ? r3(dist(q, p.piso)) : Number.POSITIVE_INFINITY;
  });
  let conferido: ErrosDaCalibracao['conferido'] = null;
  if (pares.length >= 5) {
    const lista = pares.map((p, i) => {
      const sem = homografia(pares.filter((_, j) => j !== i));
      const q = sem ? projetar(sem, p.img) : null;
      return q ? r3(dist(q, p.piso)) : null;
    });
    const validos = lista.filter((e): e is number => e !== null);
    conferido = validos.length
      ? { porPar: lista, medianaM: r3(mediana(validos)), maximoM: r3(Math.max(...validos)) }
      : null;
  }
  return {
    porPar,
    medioM: r3(porPar.reduce((s, e) => s + e, 0) / porPar.length),
    maximoM: r3(Math.max(...porPar)),
    conferido,
  };
}

/**
 * O pedaço do piso que a câmera vê: a borda da imagem levada à planta. O que fica no horizonte (ou mais longe que
 * `LIMITES_DA_CALIBRACAO.alcanceDaArea` do centro dos pontos marcados) é cortado ali — a borda da área vira uma
 * reta entre os dois cortes.
 */
export function areaVista(h: readonly number[], pares: readonly Par[], alcance: number = LIMITES_DA_CALIBRACAO.alcanceDaArea): Pt[] {
  const n = LIMITES_DA_CALIBRACAO.pontosPorLado;
  const centro: Pt = [pares.reduce((s, p) => s + p.piso[0], 0) / pares.length, pares.reduce((s, p) => s + p.piso[1], 0) / pares.length];
  const borda: Pt[] = [];
  for (let i = 0; i < n; i++) borda.push([i / n, 0]);
  for (let i = 0; i < n; i++) borda.push([1, i / n]);
  for (let i = 0; i < n; i++) borda.push([1 - i / n, 1]);
  for (let i = 0; i < n; i++) borda.push([0, 1 - i / n]);
  const valido = (p: Pt) => {
    const q = projetar(h, p);
    return q !== null && dist(q, centro) <= alcance;
  };
  /** Entre um ponto válido e um que não é, o último válido (busca binária no lado da imagem). */
  const corte = (bom: Pt, ruim: Pt): Pt => {
    let a = bom;
    let b = ruim;
    for (let k = 0; k < 30; k++) {
      const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (valido(m)) a = m;
      else b = m;
    }
    return a;
  };
  const saida: Pt[] = [];
  for (let i = 0; i < borda.length; i++) {
    const p = borda[i]!;
    const q = borda[(i + 1) % borda.length]!;
    const vp = valido(p);
    const vq = valido(q);
    if (vp) saida.push(projetar(h, p)!);
    if (vp !== vq) saida.push(projetar(h, vp ? corte(p, q) : corte(q, p))!);
  }
  return saida.map(([x, y]) => [r3(x), r3(y)]);
}

// ───────────────────────── o que chega da tela ─────────────────────────

export type Calibracao = {
  pares: Par[];
  homografia: Homografia;
  erros: ErrosDaCalibracao;
  area: Pt[];
};

const ehNumero = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * Os pares de uma calibração, conferidos, e a conta. `extensao` é o tamanho máximo da planta (metros): ponto no
 * piso fora dela é engano de digitação.
 */
export function lerCalibracao(corpo: unknown, extensao: number): { calibracao?: Calibracao; problema?: string } {
  const L = LIMITES_DA_CALIBRACAO;
  const c = typeof corpo === 'object' && corpo !== null && !Array.isArray(corpo) ? (corpo as Record<string, unknown>) : null;
  if (!c || !Array.isArray(c.pares)) return { problema: 'pares: a lista dos pontos marcados [{ img: [u, v], piso: [x, y] }]' };
  if (c.pares.length < L.minimoDePares) return { problema: `pares: pelo menos ${L.minimoDePares} pontos (o recomendado é de 8 a 15)` };
  if (c.pares.length > L.maximoDePares) return { problema: `pares: no máximo ${L.maximoDePares}` };
  const pares: Par[] = [];
  for (const [i, bruto] of (c.pares as unknown[]).entries()) {
    const o = typeof bruto === 'object' && bruto !== null ? (bruto as Record<string, unknown>) : {};
    const img = o.img;
    const piso = o.piso;
    if (!Array.isArray(img) || img.length !== 2 || !img.every(ehNumero) || img.some((n) => n < 0 || n > 1)) {
      return { problema: `pares[${i}].img: [u, v] de 0 a 1 (a posição na imagem)` };
    }
    if (!Array.isArray(piso) || piso.length !== 2 || !piso.every(ehNumero) || piso.some((n) => n < 0 || n > extensao)) {
      return { problema: `pares[${i}].piso: [x, y] em metros, de 0 a ${extensao} (a posição na planta)` };
    }
    const par: Par = { img: [img[0] as number, img[1] as number], piso: [piso[0] as number, piso[1] as number] };
    const repetido = pares.findIndex((p) => dist(p.img, par.img) < L.distanciaMinimaNaImagem || dist(p.piso, par.piso) < L.distanciaMinimaNoPiso);
    if (repetido >= 0) return { problema: `pares[${i}]: é o mesmo ponto que pares[${repetido}] (perto demais na imagem ou no piso)` };
    pares.push(par);
  }
  const h = homografia(pares);
  if (!h) {
    return {
      problema: 'os pontos não definem o piso: estão quase numa reta (ou um deles caiu do outro lado do horizonte) — '
        + 'marque pontos espalhados, nos quatro cantos do chão que a câmera vê',
    };
  }
  return { calibracao: { pares, homografia: h, erros: errosDaCalibracao(pares, h), area: areaVista(h, pares) } };
}
