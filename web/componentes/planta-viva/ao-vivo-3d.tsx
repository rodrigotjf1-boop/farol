'use client';

// =====================================================================
// Ao vivo › 3D e Câmeras (A26, P7): a mesma cena, de dois jeitos
// =====================================================================
// Do protótipo aprovado pelo dono em 27/10/2026. A planta com volume — o
// chão de cada ambiente com a grade, cada móvel na altura dele — e cada
// pessoa como um boneco simples (corpo, cabeça, anel no chão) com o POSTO
// por cima (sem nome, sem rosto). No 3D, gira e aproxima; em Câmeras, a
// cena é vista do lugar de cada câmera da planta (simulada: a imagem de
// verdade não sai da loja), com quantas pessoas caem na imagem dela.
//
// As posições vêm de `posicoes` (um ref que a página atualiza a cada
// quadro): o laço de desenho lê dali, sem passar pelo React a cada quadro.
// Só desenha a vista que está aberta.
// =====================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { inclinacaoDe, molduraDoQueExiste, rad, type Camera, type Planta } from '@/lib/planta';

export type PosicaoNaCena = { x: number; y: number; rotulo: string };

type Props = {
  planta: Planta;
  modo: '3d' | 'cams';
  posicoes: { readonly current: ReadonlyMap<number, PosicaoNaCena> };
  escolhida: number | null;
  nomeDaCamera: (pontoId: string) => string;
};

const ASPECTO = 16 / 9;

/** As cores da cena (sempre escura) vêm dos tokens do console, em `globals.css`. */
function token(nome: string): THREE.Color {
  const v = getComputedStyle(document.documentElement).getPropertyValue(nome).trim().split(/\s+/).join(',');
  return new THREE.Color(`rgb(${v || '128,128,128'})`);
}

/** O posto escrito numa etiqueta que sempre olha para quem vê. */
function etiqueta(texto: string): THREE.Sprite {
  const alt = 58;
  const tela = document.createElement('canvas');
  const g = tela.getContext('2d')!;
  const fonte = `700 ${alt * 0.6}px "JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace`;
  g.font = fonte;
  const larg = Math.ceil(g.measureText(texto).width + alt * 0.5);
  tela.width = larg;
  tela.height = alt;
  g.font = fonte;
  g.fillStyle = `#${token('--rotulo').getHexString()}`;
  g.beginPath();
  g.roundRect(0, 0, larg, alt, alt * 0.22);
  g.fill();
  g.fillStyle = `#${token('--sobre-rotulo').getHexString()}`;
  g.textBaseline = 'middle';
  g.fillText(texto, alt * 0.25, alt / 2 + 2);
  const textura = new THREE.CanvasTexture(tela);
  textura.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: textura, depthTest: false, transparent: true }));
  s.userData.largura = larg / alt;
  s.renderOrder = 5;
  return s;
}

type Boneco = { grupo: THREE.Group; rotulo: THREE.Sprite; texto: string; materiais: THREE.Material[] };

type Cena = {
  cena: THREE.Scene;
  bonecos: Map<number, Boneco>;
  centro: THREE.Vector3;
  tamanho: number;
  liberar: () => void;
};

/** Libera da GPU o que um objeto guardou (geometrias, materiais, texturas). */
function liberarObjeto(o: THREE.Object3D): void {
  o.traverse((x) => {
    const m = x as THREE.Mesh;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      (mat as THREE.MeshBasicMaterial).map?.dispose();
      mat.dispose();
    }
  });
}

function montarCena(planta: Planta): Cena {
  const cena = new THREE.Scene();
  const fundo = token('--cena');
  cena.background = fundo;
  const [x0, y0, x1, y1] = molduraDoQueExiste(planta);
  const tamanho = Math.max(x1 - x0, y1 - y0, 4);
  cena.fog = new THREE.Fog(fundo, tamanho * 1.6, tamanho * 3.4);
  cena.add(new THREE.HemisphereLight(0xcfe0ff, 0x101820, 2.2));
  const sol = new THREE.DirectionalLight(0xffffff, 1.2);
  sol.position.set(x0 - 2, 12, y0 - 2);
  cena.add(sol);
  const piso = token('--cena-piso');
  const parede = token('--cena-parede');
  for (const a of planta.ambientes) {
    const chao = new THREE.Mesh(new THREE.PlaneGeometry(a.w, a.h), new THREE.MeshLambertMaterial({ color: piso }));
    chao.rotation.x = -Math.PI / 2;
    chao.position.set(a.x + a.w / 2, 0, a.y + a.h / 2);
    cena.add(chao);
    const lado = Math.max(a.w, a.h);
    const grade = new THREE.GridHelper(lado, Math.max(1, Math.round(lado / 0.5)), 0x2b4466, 0x1b304b);
    grade.position.set(a.x + a.w / 2, 0.003, a.y + a.h / 2);
    grade.scale.set(a.w / lado, 1, a.h / lado);
    (grade.material as THREE.Material).transparent = true;
    (grade.material as THREE.Material).opacity = 0.5;
    cena.add(grade);
    const borda = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(a.w, 0.9, a.h)),
      new THREE.LineBasicMaterial({ color: parede, transparent: true, opacity: 0.55 }),
    );
    borda.position.set(a.x + a.w / 2, 0.45, a.y + a.h / 2);
    cena.add(borda);
  }
  const movel = token('--cena-movel');
  const movel2 = token('--cena-movel-2');
  for (const m of planta.moveis) {
    const caixa = new THREE.Mesh(new THREE.BoxGeometry(m.w, m.alt, m.h), new THREE.MeshLambertMaterial({ color: movel2 }));
    caixa.position.set(m.x + m.w / 2, m.alt / 2, m.y + m.h / 2);
    cena.add(caixa);
    const b = new THREE.LineSegments(new THREE.EdgesGeometry(caixa.geometry), new THREE.LineBasicMaterial({ color: movel }));
    b.position.copy(caixa.position);
    cena.add(b);
  }
  const bonecos = new Map<number, Boneco>();
  return {
    cena,
    bonecos,
    centro: new THREE.Vector3((x0 + x1) / 2, 0, (y0 + y1) / 2),
    tamanho,
    liberar: () => liberarObjeto(cena),
  };
}

function novoBoneco(c: Cena): Boneco {
  const grupo = new THREE.Group();
  const pessoa = token('--pessoa');
  const corpoM = new THREE.MeshLambertMaterial({ color: pessoa, transparent: true });
  const cabecaM = new THREE.MeshLambertMaterial({ color: pessoa.clone().offsetHSL(0, 0, 0.1), transparent: true });
  const anelM = new THREE.MeshBasicMaterial({ color: token('--pessoa-claro'), transparent: true, opacity: 0.55, side: THREE.DoubleSide });
  const corpo = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 1.3, 20), corpoM);
  corpo.position.y = 0.65;
  const cabeca = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 14), cabecaM);
  cabeca.position.y = 1.47;
  const anel = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.34, 32), anelM);
  anel.rotation.x = -Math.PI / 2;
  anel.position.y = 0.01;
  const rotulo = etiqueta('·');
  rotulo.position.y = 1.95;
  grupo.add(corpo, cabeca, anel, rotulo);
  c.cena.add(grupo);
  return { grupo, rotulo, texto: '', materiais: [corpoM, cabecaM, anelM] };
}

/** Põe cada boneco onde a pessoa está, com o posto por cima; quem saiu da cena sai. */
function atualizar(c: Cena, posicoes: ReadonlyMap<number, PosicaoNaCena>, escolhida: number | null): void {
  for (const [n, b] of c.bonecos) {
    if (!posicoes.has(n)) {
      c.cena.remove(b.grupo);
      liberarObjeto(b.grupo);
      c.bonecos.delete(n);
    }
  }
  for (const [n, p] of posicoes) {
    let b = c.bonecos.get(n);
    if (!b) {
      b = novoBoneco(c);
      c.bonecos.set(n, b);
    }
    b.grupo.position.set(p.x, 0, p.y);
    if (b.texto !== p.rotulo) {
      b.grupo.remove(b.rotulo);
      liberarObjeto(b.rotulo);
      b.rotulo = etiqueta(p.rotulo);
      b.rotulo.position.y = 1.95;
      b.grupo.add(b.rotulo);
      b.texto = p.rotulo;
    }
    const opaco = escolhida === null || escolhida === n ? 1 : 0.3;
    for (const m of b.materiais) m.opacity = m === b.materiais[2] ? 0.55 * opaco : opaco;
  }
}

/** O rótulo do tamanho certo para quem olha: perto da câmera encolhe (senão a pessoa a 1 m vira uma faixa). */
function rotulosPara(c: Cena, olho: THREE.Camera, base: number): void {
  for (const b of c.bonecos.values()) {
    const k = Math.min(1, olho.position.distanceTo(b.grupo.position) / 4);
    b.rotulo.scale.set(b.rotulo.userData.largura * base * k, base * k, 1);
  }
}

/** A câmera virtual no lugar da de verdade: a abertura da lente é o campo horizontal. */
function cameraVirtual(cam: Camera): THREE.PerspectiveCamera {
  const vfov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(rad(cam.abertura) / 2) / ASPECTO));
  const c = new THREE.PerspectiveCamera(vfov, ASPECTO, 0.05, 60);
  c.position.set(cam.x, cam.alt, cam.y);
  const i = rad(inclinacaoDe(cam));
  const d = rad(cam.dir);
  if (inclinacaoDe(cam) >= 89.5) c.up.set(Math.cos(d), 0, Math.sin(d));
  c.lookAt(c.position.clone().add(new THREE.Vector3(Math.cos(d) * Math.cos(i), -Math.sin(i), Math.sin(d) * Math.cos(i))));
  c.updateMatrixWorld();
  c.updateProjectionMatrix();
  return c;
}

/** Quantas pessoas caem na imagem desta câmera (o meio do corpo dentro do quadro, na frente dela). */
function naImagem(olho: THREE.PerspectiveCamera, posicoes: ReadonlyMap<number, PosicaoNaCena>): number {
  let n = 0;
  for (const p of posicoes.values()) {
    const v = new THREE.Vector3(p.x, 0.9, p.y).project(olho);
    if (v.z > -1 && v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1) n += 1;
  }
  return n;
}

export function AoVivo3D({ planta, modo, posicoes, escolhida, nomeDaCamera }: Props) {
  const caixa = useRef<HTMLDivElement>(null);
  const telas = useRef(new Map<string, HTMLCanvasElement>());
  const escolhidaRef = useRef(escolhida);
  escolhidaRef.current = escolhida;
  const [semWebgl, setSemWebgl] = useState(false);
  const [contagens, setContagens] = useState<Record<string, number>>({});
  const cena = useMemo(() => (typeof window === 'undefined' ? null : montarCena(planta)), [planta]);
  useEffect(() => () => cena?.liberar(), [cena]);

  // ───────────── 3D: de cima, girando ─────────────
  useEffect(() => {
    const div = caixa.current;
    if (modo !== '3d' || !div || !cena) return;
    let render: THREE.WebGLRenderer;
    try {
      render = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setSemWebgl(true);
      return;
    }
    render.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    render.domElement.className = 'block h-full w-full';
    div.appendChild(render.domElement);
    const olho = new THREE.PerspectiveCamera(45, 1, 0.05, 400);
    const controle = new OrbitControls(olho, render.domElement);
    controle.enableDamping = true;
    controle.maxPolarAngle = Math.PI * 0.49;
    const { centro, tamanho } = cena;
    olho.position.set(centro.x - tamanho * 0.15, tamanho * 0.95, centro.z + tamanho * 0.95);
    controle.target.copy(centro);
    controle.update();
    const medir = () => {
      const r = div.getBoundingClientRect();
      render.setSize(r.width, r.height, false);
      olho.aspect = r.width / Math.max(1, r.height);
      olho.updateProjectionMatrix();
    };
    const observador = new ResizeObserver(medir);
    observador.observe(div);
    medir();
    let quadro = 0;
    const desenhar = () => {
      atualizar(cena, posicoes.current, escolhidaRef.current);
      for (const b of cena.bonecos.values()) b.rotulo.scale.set(b.rotulo.userData.largura * 0.24, 0.24, 1);
      controle.update();
      render.render(cena.cena, olho);
      quadro = requestAnimationFrame(desenhar);
    };
    quadro = requestAnimationFrame(desenhar);
    return () => {
      cancelAnimationFrame(quadro);
      observador.disconnect();
      controle.dispose();
      render.dispose();
      render.domElement.remove();
    };
  }, [modo, cena, posicoes]);

  // ───────────── Câmeras: a cena do lugar de cada câmera da planta ─────────────
  useEffect(() => {
    if (modo !== 'cams' || !cena) return;
    const quadros: Array<{ pontoId: string; render: THREE.WebGLRenderer; olho: THREE.PerspectiveCamera; tela: HTMLCanvasElement }> = [];
    try {
      for (const cam of planta.cameras) {
        const tela = telas.current.get(cam.pontoId);
        if (!tela) continue;
        const render = new THREE.WebGLRenderer({ canvas: tela, antialias: true });
        render.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
        quadros.push({ pontoId: cam.pontoId, render, olho: cameraVirtual(cam), tela });
      }
    } catch {
      for (const q of quadros) q.render.dispose();
      setSemWebgl(true);
      return;
    }
    const medir = () => {
      for (const q of quadros) {
        const w = q.tela.parentElement?.clientWidth ?? 0;
        if (w) q.render.setSize(w, Math.round(w / ASPECTO), false);
      }
    };
    const observador = new ResizeObserver(medir);
    for (const q of quadros) if (q.tela.parentElement) observador.observe(q.tela.parentElement);
    medir();
    let quadro = 0;
    let contadoEm = 0;
    const desenhar = (agora: number) => {
      atualizar(cena, posicoes.current, escolhidaRef.current);
      for (const q of quadros) {
        rotulosPara(cena, q.olho, 0.18);
        q.render.render(cena.cena, q.olho);
      }
      if (agora - contadoEm > 500) {
        contadoEm = agora;
        setContagens(Object.fromEntries(quadros.map((q) => [q.pontoId, naImagem(q.olho, posicoes.current)])));
      }
      quadro = requestAnimationFrame(desenhar);
    };
    quadro = requestAnimationFrame(desenhar);
    return () => {
      cancelAnimationFrame(quadro);
      observador.disconnect();
      for (const q of quadros) q.render.dispose();
    };
  }, [modo, cena, planta, posicoes]);

  if (semWebgl) {
    return (
      <p className="p-6 text-[14px] text-farol-cena-suave" role="status">
        Este navegador não desenha em 3D (WebGL desligado). A vista Planta mostra as mesmas pessoas.
      </p>
    );
  }
  if (modo === '3d') {
    return (
      <div ref={caixa} className="relative h-[min(66vh,640px)] w-full" data-vista-3d>
        <span className="pointer-events-none absolute left-3.5 top-3 font-mono text-[11px] text-farol-cena-suave">
          arraste para girar · roda ou pinça para aproximar
        </span>
      </div>
    );
  }
  if (!planta.cameras.length) {
    return <p className="p-6 text-[14px] text-farol-cena-suave">Nenhuma câmera na planta: ponha as câmeras no Desenho.</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-2.5 p-2.5 md:grid-cols-2" data-vista-cameras>
      {planta.cameras.map((cam) => {
        const n = contagens[cam.pontoId] ?? 0;
        return (
          <figure key={cam.pontoId} className="m-0 overflow-hidden rounded-[14px] border border-farol-cena-suave/25 bg-farol-cena">
            <div className="relative">
              <canvas
                ref={(el) => {
                  if (el) telas.current.set(cam.pontoId, el);
                  else telas.current.delete(cam.pontoId);
                }}
                className="block aspect-video h-auto w-full"
                aria-label={`A cozinha simulada do lugar de ${nomeDaCamera(cam.pontoId)}`}
                role="img"
              />
              <span className="pointer-events-none absolute left-2.5 top-2 font-mono text-[11px] font-semibold text-farol-cena-tinta [text-shadow:0_1px_2px_#000]">
                {nomeDaCamera(cam.pontoId).toUpperCase()} · SIMULADA
              </span>
            </div>
            <figcaption className="flex items-end justify-between gap-2.5 px-3 pb-3 pt-2.5 text-farol-cena-tinta">
              <span className="min-w-0">
                <b className="block truncate font-display text-[20px] font-extrabold uppercase leading-[1.25]">{nomeDaCamera(cam.pontoId)}</b>
                <small className="font-mono text-[11px] text-farol-cena-suave">a imagem de verdade fica na loja</small>
              </span>
              <span
                className={`whitespace-nowrap rounded-full border-[1.5px] px-2.5 py-1.5 font-mono text-[11.5px] font-semibold ${n ? 'border-farol-cena-ok text-farol-cena-ok' : 'border-farol-cena-suave/50 text-farol-cena-suave'}`}
                data-na-imagem={n}
              >
                {n} na imagem
              </span>
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}
