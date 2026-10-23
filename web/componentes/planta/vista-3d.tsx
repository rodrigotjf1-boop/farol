'use client';

// =====================================================================
// A planta em 3D (planta viva, degrau 1)
// =====================================================================
// A mesma planta de sempre — ambientes, móveis e câmeras, em metros —
// com volume: o chão de cada ambiente, paredes baixas (para ver dentro),
// cada móvel na altura dele e cada câmera no lugar, olhando para onde
// aponta e com a inclinação. Tocar numa câmera mostra o que ela vê,
// SIMULADO, por cima da imagem de verdade do canal: onde os contornos não
// batem com a imagem, a posição, a altura, a direção ou a inclinação da
// câmera na planta está errada — e as faixas do painel acertam.
//
// Só olha: desenhar continua na vista de cima. Durante a edição, mexer
// nas faixas do painel muda a câmera aqui na hora (a planta é o rascunho).
// Desenha só quando algo muda (girar, a planta, o tema): nenhum laço
// parado gastando bateria.
// =====================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import type { Selecao } from '@/componentes/planta/desenho';
import type { CanalNaPlanta } from '@/componentes/planta/painel';
import { numeroDoCanal } from '@/componentes/planta/situacao';
import { previewApi } from '@/lib/api';
import { inclinacaoDe, molduraDoQueExiste, rad, type Camera, type Planta } from '@/lib/planta';

type Props = {
  planta: Planta;
  selecao: Selecao | null;
  canais: ReadonlyMap<string, CanalNaPlanta>;
  aoSelecionar: (s: Selecao | null) => void;
};

/** A proporção da imagem quando o canal ainda não tem imagem: a do fluxo menor dos gravadores mais comuns. */
const ASPECTO_PADRAO = 16 / 9;
/**
 * As camadas: o desenho principal vê as três. A câmera simulada vê os CONTORNOS (ambiente e móveis) — é o que se
 * compara com a imagem de verdade do canal, por baixo; o preenchimento tamparia a imagem. Sem imagem do canal, ela
 * vê também o preenchimento. Rótulos, cones e paredes ficam só no desenho principal.
 */
const AMBIENTE = 0;
const MARCAS = 1;
const PREENCHIMENTO = 2;

/** As cores vêm dos tokens do console (triplos RGB em `globals.css`), nos dois temas. */
const token = (nome: string): THREE.Color => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(nome).trim().split(/\s+/).join(',');
  return new THREE.Color(`rgb(${v || '128,128,128'})`);
};
const css = (cor: THREE.Color): string => `#${cor.getHexString()}`;
/** O texto por cima de uma cor: escuro na cor clara, claro na escura (a cor da situação muda com o tema). */
const textoSobre = (cor: THREE.Color): string => {
  const c = cor.clone().convertLinearToSRGB();
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b > 0.55 ? '#1b1a17' : '#ffffff';
};

/** A direção para onde a câmera olha, no espaço 3D (x da planta = X, y da planta = Z, altura = Y). */
function olharDe(cam: Camera): THREE.Vector3 {
  const i = rad(inclinacaoDe(cam));
  const d = rad(cam.dir);
  return new THREE.Vector3(Math.cos(d) * Math.cos(i), -Math.sin(i), Math.sin(d) * Math.cos(i));
}

/** A câmera virtual no lugar da de verdade: abertura da lente = campo horizontal; a proporção, a da imagem do canal. */
function cameraVirtual(cam: Camera, aspecto: number): THREE.PerspectiveCamera {
  const vfov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(rad(cam.abertura) / 2) / aspecto));
  const c = new THREE.PerspectiveCamera(vfov, aspecto, 0.05, 60);
  c.position.set(cam.x, cam.alt, cam.y);
  const olhar = olharDe(cam);
  // Olhando direto para o chão, "para cima" não pode ser o eixo vertical: vira a direção da câmera no chão.
  if (inclinacaoDe(cam) >= 89.5) c.up.set(Math.cos(rad(cam.dir)), 0, Math.sin(rad(cam.dir)));
  c.lookAt(c.position.clone().add(olhar));
  c.updateMatrixWorld();
  c.updateProjectionMatrix();
  c.layers.set(AMBIENTE);
  return c;
}

/** Um texto como etiqueta que sempre olha para quem vê. */
function etiqueta(texto: string, o: { fundo?: string; cor: string; altura?: number; mono?: boolean }): THREE.Sprite {
  const alt = 64;
  const tela = document.createElement('canvas');
  const g = tela.getContext('2d')!;
  const fonte = o.mono
    ? `600 ${alt * 0.5}px "JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace`
    : `800 ${alt * 0.62}px "Big Shoulders Display Variable", "Big Shoulders Display", "Arial Narrow", sans-serif`;
  g.font = fonte;
  const larg = Math.ceil(g.measureText(texto).width + alt * 0.6);
  tela.width = larg;
  tela.height = alt;
  g.font = fonte;
  if (o.fundo) {
    g.fillStyle = o.fundo;
    g.beginPath();
    g.roundRect(0, 0, larg, alt, alt / 2);
    g.fill();
  }
  g.fillStyle = o.cor;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(texto, larg / 2, alt / 2 + alt * 0.04);
  const textura = new THREE.CanvasTexture(tela);
  textura.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: textura, depthTest: false, transparent: true }));
  const h = o.altura ?? 0.32;
  s.scale.set((h * larg) / alt, h, 1);
  s.renderOrder = 10;
  s.layers.set(MARCAS);
  return s;
}

/** Libera o que a GPU guardou de um grupo (geometrias, materiais e texturas). */
function esvaziar(grupo: THREE.Group): void {
  grupo.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      (mat as THREE.MeshBasicMaterial).map?.dispose();
      mat.dispose();
    }
  });
  grupo.clear();
}

type Motor = {
  render: THREE.WebGLRenderer;
  renderOlho: THREE.WebGLRenderer | null;
  cena: THREE.Scene;
  vista: THREE.PerspectiveCamera;
  controle: OrbitControls;
  conteudo: THREE.Group;
  olhoAtual: THREE.PerspectiveCamera | null;
  enquadrada: boolean;
};

export function Vista3D({ planta, selecao, canais, aoSelecionar }: Props) {
  const caixa = useRef<HTMLDivElement>(null);
  const tela = useRef<HTMLCanvasElement>(null);
  const olho = useRef<HTMLCanvasElement>(null);
  const motor = useRef<Motor | null>(null);
  const selecionar = useRef(aoSelecionar);
  selecionar.current = aoSelecionar;
  const [semWebgl, setSemWebgl] = useState(false);
  const [tema, setTema] = useState(0);
  const [mistura, setMistura] = useState(65);
  /** A proporção da imagem de cada canal, lida da própria imagem quando ela chega. */
  const [aspectos, setAspectos] = useState<Record<string, number>>({});
  const [imagemFalhou, setImagemFalhou] = useState<Record<string, boolean>>({});

  const camSel = selecao?.tipo === 'camera' ? planta.cameras.find((c) => c.pontoId === selecao.id) : undefined;
  const canalSel = camSel ? canais.get(camSel.pontoId) : undefined;

  const desenhar = useCallback(() => {
    const m = motor.current;
    if (!m) return;
    m.render.render(m.cena, m.vista);
    if (m.renderOlho && m.olhoAtual) m.renderOlho.render(m.cena, m.olhoAtual);
  }, []);

  // ───────────────────────── montar o motor (uma vez) ─────────────────────────
  useEffect(() => {
    const canvas = tela.current;
    const div = caixa.current;
    if (!canvas || !div) return;
    let render: THREE.WebGLRenderer;
    try {
      render = new THREE.WebGLRenderer({ canvas, antialias: true });
    } catch {
      setSemWebgl(true);
      return;
    }
    render.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const cena = new THREE.Scene();
    const vista = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
    vista.layers.enable(MARCAS);
    vista.layers.enable(PREENCHIMENTO);
    const controle = new OrbitControls(vista, canvas);
    controle.maxPolarAngle = Math.PI * 0.49;
    controle.screenSpacePanning = true;
    // Luz clara e por igual: é planta para ler, não cena de cinema (com pouca luz, a caixa cinza virava marrom).
    const luzCeu = new THREE.HemisphereLight(0xffffff, 0xb8b0a0, 2.4);
    const luzSol = new THREE.DirectionalLight(0xffffff, 1.6);
    luzSol.position.set(-6, 14, -4);
    cena.add(luzCeu, luzSol);
    const conteudo = new THREE.Group();
    cena.add(conteudo);
    motor.current = { render, renderOlho: null, cena, vista, controle, conteudo, olhoAtual: null, enquadrada: false };

    const tamanho = () => {
      const r = div.getBoundingClientRect();
      render.setSize(r.width, r.height, false);
      vista.aspect = r.width / Math.max(1, r.height);
      vista.fov = vista.aspect < 0.9 ? 52 : 42;
      vista.updateProjectionMatrix();
      desenhar();
    };
    const observador = new ResizeObserver(tamanho);
    observador.observe(div);
    controle.addEventListener('change', desenhar);

    // Tocar (sem arrastar) numa câmera, num móvel ou num ambiente escolhe; no vazio, solta.
    const mira = new THREE.Raycaster();
    mira.layers.enableAll();
    let apertou: { x: number; y: number } | null = null;
    const aoApertar = (e: PointerEvent) => {
      apertou = { x: e.clientX, y: e.clientY };
    };
    const aoSoltar = (e: PointerEvent) => {
      if (!apertou || Math.hypot(e.clientX - apertou.x, e.clientY - apertou.y) > 6) return;
      const r = canvas.getBoundingClientRect();
      mira.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), vista);
      const alvo = mira.intersectObjects(conteudo.children, true).find((h) => h.object.userData.selecao);
      selecionar.current(alvo ? (alvo.object.userData.selecao as Selecao) : null);
    };
    canvas.addEventListener('pointerdown', aoApertar);
    canvas.addEventListener('pointerup', aoSoltar);

    // O tema muda pelo botão (atributo no <html>) ou pelo aparelho.
    const mudouTema = () => setTema((n) => n + 1);
    const atributo = new MutationObserver(mudouTema);
    atributo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-tema'] });
    const aparelho = window.matchMedia('(prefers-color-scheme: dark)');
    aparelho.addEventListener('change', mudouTema);

    return () => {
      observador.disconnect();
      atributo.disconnect();
      aparelho.removeEventListener('change', mudouTema);
      canvas.removeEventListener('pointerdown', aoApertar);
      canvas.removeEventListener('pointerup', aoSoltar);
      controle.dispose();
      esvaziar(conteudo);
      motor.current?.renderOlho?.dispose();
      render.dispose();
      motor.current = null;
    };
  }, [desenhar]);

  // O quadrinho da câmera escolhida tem o próprio desenhador (fundo transparente, por cima da imagem do canal).
  useEffect(() => {
    const m = motor.current;
    const canvas = olho.current;
    if (!m || !canvas || !camSel) return;
    let r: THREE.WebGLRenderer | null = null;
    try {
      r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      r.setClearColor(0x000000, 0);
      r.setPixelRatio(1);
    } catch {
      r = null;
    }
    m.renderOlho = r;
    const ajustar = () => {
      if (!r) return;
      const w = canvas.parentElement?.clientWidth ?? 320;
      const aspecto = aspectos[camSel.pontoId] ?? ASPECTO_PADRAO;
      r.setSize(w, Math.round(w / aspecto), false);
      desenhar();
    };
    const obs = new ResizeObserver(ajustar);
    if (canvas.parentElement) obs.observe(canvas.parentElement);
    ajustar();
    return () => {
      obs.disconnect();
      r?.dispose();
      if (motor.current) motor.current.renderOlho = null;
    };
    // a câmera escolhida (não os números dela) troca o quadrinho
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camSel?.pontoId, aspectos, desenhar]);

  // ───────────────────────── a cena, refeita quando a planta, a escolha ou o tema mudam ─────────────────────────
  useEffect(() => {
    const m = motor.current;
    if (!m) return;
    esvaziar(m.conteudo);
    const C = {
      fundo: token('--fundo'),
      chao: token('--painel-2'),
      ambiente: token('--realce'),
      borda: token('--borda-forte'),
      movel: token('--metal'),
      tinta: token('--tinta'),
      suave: token('--suave'),
      mostarda: token('--mostarda'),
      sobreMostarda: token('--sobre-mostarda'),
      ketchup: token('--ketchup'),
      ok: token('--ok'),
      critico: token('--critico'),
      painel: token('--painel'),
    };
    m.cena.background = C.fundo;
    const add = (o: THREE.Object3D, camada = AMBIENTE) => {
      o.layers.set(camada);
      m.conteudo.add(o);
      return o;
    };

    const [x0, y0, x1, y1] = molduraDoQueExiste(planta);
    const largura = Math.max(2, x1 - x0);
    const fundo = Math.max(2, y1 - y0);
    const centro = new THREE.Vector3((x0 + x1) / 2, 0, (y0 + y1) / 2);

    // o chão em volta de tudo
    const base = new THREE.Mesh(new THREE.PlaneGeometry(largura + 4, fundo + 4), new THREE.MeshStandardMaterial({ color: C.chao, roughness: 1 }));
    base.rotation.x = -Math.PI / 2;
    base.position.set(centro.x, -0.01, centro.z);
    add(base, PREENCHIMENTO);

    // os ambientes: chão, contorno, paredes baixas e o nome
    for (const a of planta.ambientes) {
      const piso = new THREE.Mesh(new THREE.BoxGeometry(a.w, 0.02, a.h), new THREE.MeshStandardMaterial({ color: C.ambiente, roughness: 0.95 }));
      piso.position.set(a.x + a.w / 2, 0, a.y + a.h / 2);
      piso.userData.selecao = { tipo: 'ambiente', id: a.id } satisfies Selecao;
      add(piso, PREENCHIMENTO);
      const contorno = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(a.w, 0.001, a.h)),
        new THREE.LineBasicMaterial({ color: C.mostarda }),
      );
      contorno.position.set(a.x + a.w / 2, 0.015, a.y + a.h / 2);
      add(contorno);
      const parede = new THREE.MeshStandardMaterial({ color: C.borda, transparent: true, opacity: 0.22, depthWrite: false });
      for (const [px, pz, w, h] of [
        [a.x + a.w / 2, a.y, a.w, 0.06],
        [a.x + a.w / 2, a.y + a.h, a.w, 0.06],
        [a.x, a.y + a.h / 2, 0.06, a.h],
        [a.x + a.w, a.y + a.h / 2, 0.06, a.h],
      ] as const) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(w, 1.1, h), parede);
        p.position.set(px, 0.55, pz);
        add(p, MARCAS);
      }
      const nome = etiqueta(a.nome.toUpperCase(), { cor: css(C.suave), altura: 0.36 });
      nome.position.set(a.x + a.w / 2, 0.08, a.y + a.h / 2);
      add(nome, MARCAS);
    }

    // os móveis: caixa na altura dele, com a aresta marcada (é ela que se compara com a imagem do canal)
    for (const mv of planta.moveis) {
      const escolhido = selecao?.tipo === 'movel' && selecao.id === mv.id;
      const corpo = new THREE.Mesh(
        new THREE.BoxGeometry(mv.w, mv.alt, mv.h),
        new THREE.MeshStandardMaterial({ color: escolhido ? C.mostarda : C.movel, roughness: 0.75, metalness: 0 }),
      );
      corpo.position.set(mv.x + mv.w / 2, mv.alt / 2, mv.y + mv.h / 2);
      corpo.userData.selecao = { tipo: 'movel', id: mv.id } satisfies Selecao;
      add(corpo, PREENCHIMENTO);
      const arestas = new THREE.LineSegments(new THREE.EdgesGeometry(corpo.geometry), new THREE.LineBasicMaterial({ color: C.mostarda }));
      arestas.position.copy(corpo.position);
      add(arestas);
      const nome = etiqueta(mv.nome, { cor: css(C.tinta), altura: 0.32, mono: true });
      nome.position.set(mv.x + mv.w / 2, mv.alt + 0.22, mv.y + mv.h / 2);
      add(nome, MARCAS);
    }

    // as câmeras: o corpo, o número na cor da situação, o cone de visão e, na escolhida, o chão que ela vê
    let olhoAtual: THREE.PerspectiveCamera | null = null;
    for (const cam of planta.cameras) {
      const canal = canais.get(cam.pontoId);
      const escolhida = camSel?.pontoId === cam.pontoId;
      const aspecto = aspectos[cam.pontoId] ?? ASPECTO_PADRAO;
      const virtual = cameraVirtual(cam, aspecto);
      if (escolhida) {
        // Sem a imagem do canal por baixo, a simulação mostra também o preenchimento (senão sobram só linhas).
        if (imagemFalhou[cam.pontoId]) virtual.layers.enable(PREENCHIMENTO);
        olhoAtual = virtual;
      }
      const tom = canal?.situacao.tom;
      const corDaSituacao = tom === 'ok' ? C.ok : tom === 'critico' ? C.critico : tom === 'atencao' ? C.mostarda : C.suave;
      const cor = escolhida ? C.ketchup : corDaSituacao;

      const corpo = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.26), new THREE.MeshStandardMaterial({ color: cor, roughness: 0.5 }));
      corpo.position.copy(virtual.position);
      corpo.lookAt(virtual.position.clone().add(olharDe(cam)));
      corpo.userData.selecao = { tipo: 'camera', id: cam.pontoId } satisfies Selecao;
      add(corpo, MARCAS);
      // Um alvo maior que o corpo, para o dedo acertar.
      const toque = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
      toque.position.copy(virtual.position);
      toque.userData.selecao = { tipo: 'camera', id: cam.pontoId } satisfies Selecao;
      add(toque, MARCAS);
      const numero = etiqueta(canal ? numeroDoCanal(canal.ponto) : '?', { fundo: css(cor), cor: textoSobre(cor), altura: 0.4, mono: true });
      numero.position.set(cam.x, cam.alt + 0.42, cam.y);
      add(numero, MARCAS);

      // O cone: os quatro cantos da imagem até onde tocam o chão (ou 6 m, se olham acima do chão).
      const cantos = ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([x, y]) => {
        const p = new THREE.Vector3(x, y, 0.5).unproject(virtual);
        const d = p.sub(virtual.position).normalize();
        const t = d.y < -0.01 ? Math.min(40, -virtual.position.y / d.y) : 6;
        return { p: virtual.position.clone().add(d.multiplyScalar(t)), noChao: d.y < -0.01 && t < 40 };
      });
      const linhas: THREE.Vector3[] = [];
      for (const k of cantos) linhas.push(virtual.position.clone(), k.p);
      for (let i = 0; i < 4; i += 1) linhas.push(cantos[i]!.p, cantos[(i + 1) % 4]!.p);
      const cone = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(linhas),
        new THREE.LineBasicMaterial({ color: cor, transparent: true, opacity: escolhida ? 0.9 : 0.35 }),
      );
      add(cone, MARCAS);
      if (escolhida && cantos.every((k) => k.noChao)) {
        const forma = new THREE.Shape(cantos.map((k) => new THREE.Vector2(k.p.x, k.p.z)));
        const chao = new THREE.Mesh(
          new THREE.ShapeGeometry(forma),
          new THREE.MeshBasicMaterial({ color: C.ketchup, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }),
        );
        chao.rotation.x = Math.PI / 2;
        chao.position.y = 0.02;
        add(chao, MARCAS);
      }
    }
    m.olhoAtual = olhoAtual;

    // Enquadra a planta inteira na primeira vez; depois, quem gira é quem está olhando.
    if (!m.enquadrada) {
      const tam = Math.max(largura, fundo);
      m.vista.position.set(centro.x + tam * 0.55, tam * 0.85, centro.z + tam * 1.05);
      m.controle.target.copy(centro);
      m.controle.minDistance = 2;
      m.controle.maxDistance = tam * 4 + 10;
      m.controle.update();
      m.enquadrada = true;
    }
    desenhar();
  }, [planta, selecao, canais, tema, aspectos, imagemFalhou, camSel, desenhar]);

  if (semWebgl) {
    return (
      <div className="grid aspect-[16/11] max-w-full place-items-center rounded-xl border border-farol-borda bg-farol-painel-2 p-6 text-center text-farol-suave max-md:aspect-[4/3.4]">
        Este aparelho não desenhou o 3D. A vista de cima e a perspectiva continuam valendo.
      </div>
    );
  }

  const urlDaImagem = camSel ? previewApi.url(camSel.pontoId) : null;
  const numeroSel = canalSel ? numeroDoCanal(canalSel.ponto) : '';
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div
        ref={caixa}
        className="relative aspect-[16/11] max-w-full overflow-hidden rounded-xl border border-farol-borda bg-farol-painel-2 max-md:aspect-[4/3.4]"
      >
        <canvas
          ref={tela}
          className="block h-full w-full cursor-grab touch-none active:cursor-grabbing"
          role="img"
          aria-label={`A planta em 3D: ${planta.ambientes.length} ambientes, ${planta.moveis.length} equipamentos e ${planta.cameras.length} câmeras. Arraste para girar.`}
        />
      </div>

      {planta.cameras.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Escolher a câmera">
          <span className="mr-1 font-mono text-[11px] font-medium uppercase tracking-[.08em] text-farol-suave">Câmeras</span>
          {[...planta.cameras]
            .sort((a, b) => {
              const na = canais.get(a.pontoId);
              const nb = canais.get(b.pontoId);
              return (na ? numeroDoCanal(na.ponto) : '?').localeCompare(nb ? numeroDoCanal(nb.ponto) : '?');
            })
            .map((c) => {
            const canal = canais.get(c.pontoId);
            const ativa = camSel?.pontoId === c.pontoId;
            return (
              <button
                key={c.pontoId}
                type="button"
                aria-pressed={ativa}
                title={canal?.ponto.nome}
                onClick={() => aoSelecionar(ativa ? null : { tipo: 'camera', id: c.pontoId })}
                className={`min-h-9 rounded-full border px-3 font-mono text-[13px] font-semibold transition ${
                  ativa ? 'border-farol-marca bg-farol-marca text-farol-sobre-marca' : 'border-farol-borda bg-farol-painel text-farol-tinta hover:border-farol-marca'
                }`}
              >
                {canal ? numeroDoCanal(canal.ponto) : '?'}
              </button>
            );
          })}
        </div>
      )}

      {camSel && (
        <section className="flex min-w-0 flex-col gap-2" aria-label={`O que a câmera ${numeroSel} vê`}>
          <h3 className="font-display text-[17px] font-extrabold uppercase tracking-[.04em]">
            O que a câmera {numeroSel} vê <span className="font-mono text-[11px] font-medium normal-case tracking-normal text-farol-suave">simulado</span>
          </h3>
          <div
            className="relative w-full max-w-full overflow-hidden rounded-[10px] bg-farol-palco"
            style={{ aspectRatio: String(aspectos[camSel.pontoId] ?? ASPECTO_PADRAO) }}
          >
            {urlDaImagem && !imagemFalhou[camSel.pontoId] && (
              // A imagem de verdade do canal, por baixo (o mesmo endereço da tela do canal).
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={urlDaImagem}
                alt={`A imagem do canal ${numeroSel}`}
                className="absolute inset-0 h-full w-full object-cover"
                onLoad={(e) => {
                  const im = e.currentTarget;
                  if (im.naturalWidth && im.naturalHeight) setAspectos((a) => ({ ...a, [camSel.pontoId]: im.naturalWidth / im.naturalHeight }));
                }}
                onError={() => setImagemFalhou((f) => ({ ...f, [camSel.pontoId]: true }))}
              />
            )}
            <canvas
              ref={olho}
              className="absolute inset-0 h-full w-full"
              style={{ opacity: imagemFalhou[camSel.pontoId] ? 1 : mistura / 100 }}
              role="img"
              aria-label={`A câmera ${numeroSel} simulada, pela posição, altura, direção, abertura e inclinação da planta`}
            />
          </div>
          {imagemFalhou[camSel.pontoId] ? (
            <p className="text-[13px] text-farol-suave">Este canal ainda não tem imagem: só a simulação aparece.</p>
          ) : (
            <label className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-farol-suave">
              <span>Simulação por cima da imagem</span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={mistura}
                onChange={(e) => setMistura(Number(e.target.value))}
                className="min-w-0 flex-1 accent-farol-mostarda"
              />
              <span className="w-10 text-right font-mono text-farol-tinta">{mistura}%</span>
            </label>
          )}
          <p className="text-[13px] text-farol-suave">
            Os contornos em mostarda são os equipamentos e os ambientes da planta. Se não caem em cima dos de verdade na imagem,
            acerte a posição, a altura, a direção ou a inclinação da câmera no painel (em Editar planta).
          </p>
        </section>
      )}
    </div>
  );
}
