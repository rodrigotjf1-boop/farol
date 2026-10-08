'use client';

// =====================================================================
// O desenho da planta
// =====================================================================
// Um SVG montado da planta: o chão de cada ambiente, o que cada câmera
// alcança, os móveis (em pé, na perspectiva) e as câmeras por cima de
// tudo. O desenho é feito NO TAMANHO em que aparece: a câmera e as letras
// ficam do mesmo tamanho no computador e no celular; quem encolhe é o chão.
//
// Fora da edição, tocar numa câmera ou num equipamento o escolhe. Na
// edição (sempre de cima) quem manda é o arrasto: mover câmera, móvel e
// ambiente, girar a câmera pela bolinha âmbar e desenhar um retângulo novo.
// As setas do teclado movem o que está escolhido.
// =====================================================================

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';

import { cobre, numeroDoCanal, type Situacao } from '@/componentes/planta/situacao';
import type { Ponto } from '@/lib/api';
import {
  alvoNoChao, ambienteEm, centroDe, coberturaDaPlanta, coneDaCamera, fatias, grade, LIMITES, lugarDoNome, molduraDeEdicao, molduraDoQueExiste,
  moverAmbiente, noLimite, PAREDE, pinoDa, projetor, rad,
  type Moldura, type Movel, type Planta, type Pt,
} from '@/lib/planta';

export type Selecao = { tipo: 'camera' | 'movel' | 'ambiente'; id: string };
export type Ferramenta = '' | 'ambiente' | 'movel';
export type Camada = 'situacao' | 'cobertura';
export type Retangulo = { x: number; y: number; w: number; h: number };

type Gesto =
  | { modo: 'camera' }
  | { modo: 'girar' }
  | { modo: 'mover'; dx: number; dy: number }
  | { modo: 'desenhar'; x: number; y: number };

const pontos = (lista: Array<[number, number] | [number, number, number]>): string =>
  lista.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

export function DesenhoDaPlanta({
  planta,
  t,
  camada,
  editando,
  ferramenta,
  selecao,
  canais,
  nomeDoMovel,
  movelToca,
  aoSelecionar,
  aoMudar,
  aoDesenhar,
}: {
  planta: Planta;
  /** 0 = vista de cima, 1 = em perspectiva. */
  t: number;
  camada: Camada;
  editando: boolean;
  ferramenta: Ferramenta;
  selecao: Selecao | null;
  /** O canal de cada câmera e a situação dele agora. */
  canais: ReadonlyMap<string, { ponto: Ponto; situacao: Situacao }>;
  nomeDoMovel: (m: Movel) => string;
  /** Fora da edição: este móvel tem o que mostrar ao ser tocado? */
  movelToca: (m: Movel) => boolean;
  aoSelecionar: (s: Selecao | null) => void;
  aoMudar: (planta: Planta) => void;
  /** Um retângulo novo acabou de ser desenhado com a ferramenta ligada. */
  aoDesenhar: (ret: Retangulo) => void;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [tamanho, setTamanho] = useState<[number, number]>([800, 550]);
  const gesto = useRef<Gesto | null>(null);
  const [rascunho, setRascunho] = useState<Retangulo | null>(null);

  // O desenho acompanha o tamanho da caixa.
  useLayoutEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const medir = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setTamanho([Math.round(r.width), Math.round(r.height)]);
    };
    medir();
    const olho = new ResizeObserver(medir);
    olho.observe(el);
    return () => olho.disconnect();
  }, []);

  // O pedaço de chão que aparece. Fica PARADO durante um arrasto: se a
  // moldura crescesse com o que está sendo arrastado, o chão correria por
  // baixo do dedo.
  const calcular = useCallback((p: Planta): Moldura => (editando ? molduraDeEdicao(p) : molduraDoQueExiste(p)), [editando]);
  const [moldura, setMoldura] = useState<Moldura>(() => calcular(planta));
  useEffect(() => {
    if (!gesto.current) setMoldura(calcular(planta));
  }, [planta, calcular]);

  const [L, A] = tamanho;
  const proj = useMemo(() => projetor(planta, moldura, t, L, A), [planta, moldura, t, L, A]);
  const { p } = proj;
  const emPe = t > 0.04;
  const estreita = L < 520;
  const cobertura = camada === 'cobertura' && !editando;
  const chao = (lista: Pt[]): string => pontos(lista.map(([x, y]) => p(x, y, 0)));
  const cantos = (r: Retangulo): Pt[] => [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
  const situacaoDe = (pontoId: string): Situacao | undefined => canais.get(pontoId)?.situacao;

  // ───────────────────────── o desenho ─────────────────────────

  // 1 · o chão de cada ambiente, do fundo para a frente
  const ambientes = [...planta.ambientes].sort((a, b) => p(...centroDe(a))[2] - p(...centroDe(b))[2]);

  // 2 · o que nenhuma câmera vê
  const cegos = cobertura ? coberturaDaPlanta(planta, (cam) => cobre(situacaoDe(cam.pontoId))).flatMap((c) => c.faixas) : [];

  // 5 · paredes do fundo e móveis, em pedaços de até um metro, do mais
  //     distante para o mais próximo
  const volumes: Array<{ fundo: number; chave: string; no: ReactNode }> = [];
  const fundoDe = (x: number, y: number): number => p(x, y)[2];
  if (emPe) {
    // Só as paredes de FORA, e só as do fundo: parede entre dois ambientes
    // esconderia o que está atrás dela.
    const deFora = (x: number, y: number): boolean => !ambienteEm(planta, x, y);
    for (const a of planta.ambientes) {
      fatias(a.w).forEach(([de, ate], i) => {
        const [x1, x2] = [a.x + de, a.x + ate];
        if (!deFora((x1 + x2) / 2, a.y - 0.05)) return;
        volumes.push({
          fundo: fundoDe((x1 + x2) / 2, a.y) - 0.02,
          chave: `pa-${a.id}-x${i}`,
          no: (
            <>
              <polygon className="pl-parede" points={pontos([p(x1, a.y, 0), p(x2, a.y, 0), p(x2, a.y, PAREDE), p(x1, a.y, PAREDE)])} />
              <polyline className="pl-contorno" points={pontos([p(x1, a.y, PAREDE), p(x2, a.y, PAREDE)])} />
            </>
          ),
        });
      });
      fatias(a.h).forEach(([de, ate], i) => {
        const [y1, y2] = [a.y + de, a.y + ate];
        if (!deFora(a.x - 0.05, (y1 + y2) / 2)) return;
        volumes.push({
          fundo: fundoDe(a.x, (y1 + y2) / 2) - 0.02,
          chave: `pa-${a.id}-y${i}`,
          no: (
            <>
              <polygon className="pl-parede flanco" points={pontos([p(a.x, y1, 0), p(a.x, y2, 0), p(a.x, y2, PAREDE), p(a.x, y1, PAREDE)])} />
              <polyline className="pl-contorno" points={pontos([p(a.x, y1, PAREDE), p(a.x, y2, PAREDE)])} />
            </>
          ),
        });
      });
    }
  }
  for (const m of planta.moveis) {
    const marcado = selecao?.tipo === 'movel' && selecao.id === m.id;
    const toca = editando || movelToca(m) ? ' toca' : '';
    const z = m.alt;
    const fx = fatias(m.w);
    const fy = fatias(m.h);
    const nome = nomeDoMovel(m);
    fx.forEach(([xa, xb], i) =>
      fy.forEach(([ya, yb], j) => {
        const [x1, x2, y1, y2] = [m.x + xa, m.x + xb, m.y + ya, m.y + yb];
        const ultimoX = i === fx.length - 1;
        const ultimoY = j === fy.length - 1;
        const [X1, X2, Y1, Y2] = [m.x, m.x + m.w, m.y, m.y + m.h];
        const cl = `pl-contorno${marcado ? ' sel' : ''}`;
        const [tx, ty] = p(m.x + m.w / 2, m.y + m.h / 2, z);
        // o nome cabe? só nos maiores, para não virar sopa de letras
        const cabe = (m.w * Math.cos(rad(45 * t)) + m.h * Math.sin(rad(45 * t))) * proj.escala >= nome.length * 5.8 + 6;
        volumes.push({
          fundo: fundoDe((x1 + x2) / 2, (y1 + y2) / 2),
          chave: `mo-${m.id}-${i}-${j}`,
          no: (
            <>
              {emPe && ultimoY && (
                <polygon className={`pl-movel frente${toca}`} data-movel={m.id} points={pontos([p(x1, y2, 0), p(x2, y2, 0), p(x2, y2, z), p(x1, y2, z)])} />
              )}
              {emPe && ultimoX && (
                <polygon className={`pl-movel flanco${toca}`} data-movel={m.id} points={pontos([p(x2, y1, 0), p(x2, y2, 0), p(x2, y2, z), p(x2, y1, z)])} />
              )}
              <polygon className={`pl-movel tampo${toca}`} data-movel={m.id} points={pontos([p(x1, y1, z), p(x2, y1, z), p(x2, y2, z), p(x1, y2, z)])} />
              {ultimoX && ultimoY && (
                <>
                  {/* o contorno do móvel inteiro vai com o pedaço mais próximo */}
                  {emPe ? (
                    <>
                      <polygon className={cl} points={pontos([p(X1, Y1, z), p(X2, Y1, z), p(X2, Y1, 0), p(X2, Y2, 0), p(X1, Y2, 0), p(X1, Y2, z)])} />
                      <polyline className={cl} points={pontos([p(X1, Y2, z), p(X2, Y2, z), p(X2, Y1, z)])} />
                      <polyline className={cl} points={pontos([p(X2, Y2, z), p(X2, Y2, 0)])} />
                    </>
                  ) : (
                    <polygon className={cl} points={pontos([p(X1, Y1), p(X2, Y1), p(X2, Y2), p(X1, Y2)])} />
                  )}
                  {cabe && (
                    <text className="pl-movel-nome" x={tx.toFixed(1)} y={(ty + 3).toFixed(1)}>
                      {nome}
                    </text>
                  )}
                </>
              )}
            </>
          ),
        });
      }),
    );
  }
  volumes.sort((a, b) => a.fundo - b.fundo);

  // o nome do ambiente, onde houver espaço — e só se couber na largura dele
  const letra = estreita ? 6.6 : 8.4; // largura média de uma letra do nome, em pontos da tela
  const naTela = (r: Retangulo): number => (r.w * Math.cos(rad(45 * t)) + r.h * Math.sin(rad(45 * t))) * proj.escala;
  // Em perspectiva a cabeça da câmera aparece acima do pé dela: o nome desvia das duas.
  const cabecas: Pt[] = emPe
    ? planta.cameras.map((c) => {
        const [hx, hy] = p(c.x, c.y, pinoDa(c));
        return proj.chao(hx, hy);
      })
    : [];

  const raio = estreita ? 10 : 12.5;
  const camSel = editando && selecao?.tipo === 'camera' ? planta.cameras.find((c) => c.pontoId === selecao.id) : undefined;

  // ───────────────────────── os gestos da edição ─────────────────────────

  /** Onde o ponteiro está, em metros no chão (só vale de cima). */
  function noChao(ev: PointerEvent<SVGSVGElement>): Pt {
    const el = svg.current!;
    const pt = el.createSVGPoint();
    pt.x = ev.clientX;
    pt.y = ev.clientY;
    const q = pt.matrixTransform(el.getScreenCTM()!.inverse());
    return proj.chao(q.x, q.y);
  }
  const alvo = (ev: { target: EventTarget }, atributo: string): string | null =>
    (ev.target as Element).closest?.(`[${atributo}]`)?.getAttribute(atributo) ?? null;

  function aoApertar(ev: PointerEvent<SVGSVGElement>) {
    if (!editando || t > 0.02) return;
    svg.current?.setPointerCapture?.(ev.pointerId);
    const [x, y] = noChao(ev);
    if (alvo(ev, 'data-alca') !== null) {
      gesto.current = { modo: 'girar' };
      return;
    }
    const cam = alvo(ev, 'data-cam');
    if (cam) {
      gesto.current = { modo: 'camera' };
      aoSelecionar({ tipo: 'camera', id: cam });
      return;
    }
    if (ferramenta) {
      gesto.current = { modo: 'desenhar', x, y };
      return;
    }
    const tocado = alvoNoChao(planta, x, y);
    if (!tocado) {
      aoSelecionar(null);
      return;
    }
    const item = (tocado.tipo === 'movel' ? planta.moveis : planta.ambientes).find((i) => i.id === tocado.id)!;
    gesto.current = { modo: 'mover', dx: x - item.x, dy: y - item.y };
    aoSelecionar(tocado);
  }

  function aoArrastar(ev: PointerEvent<SVGSVGElement>) {
    const g = gesto.current;
    if (!g) return;
    const [x, y] = noChao(ev);
    const [, , maxX, maxY] = moldura;
    if (g.modo === 'desenhar') {
      const x1 = noLimite(grade(Math.min(g.x, x), 0.25), 0, maxX);
      const y1 = noLimite(grade(Math.min(g.y, y), 0.25), 0, maxY);
      const x2 = noLimite(grade(Math.max(g.x, x), 0.25), 0, maxX);
      const y2 = noLimite(grade(Math.max(g.y, y), 0.25), 0, maxY);
      setRascunho({ x: x1, y: y1, w: grade(x2 - x1, 0.25), h: grade(y2 - y1, 0.25) });
      return;
    }
    if (!selecao) return;
    if (g.modo === 'camera' || g.modo === 'girar') {
      aoMudar({
        ...planta,
        cameras: planta.cameras.map((c) => {
          if (c.pontoId !== selecao.id) return c;
          if (g.modo === 'camera') return { ...c, x: noLimite(grade(x, 0.1), 0, maxX), y: noLimite(grade(y, 0.1), 0, maxY) };
          return { ...c, dir: (Math.round((Math.atan2(y - c.y, x - c.x) * 180) / Math.PI) + 360) % 360 };
        }),
      });
      return;
    }
    if (selecao.tipo === 'movel') {
      aoMudar({
        ...planta,
        moveis: planta.moveis.map((m) =>
          m.id === selecao.id ? { ...m, x: noLimite(grade(x - g.dx, 0.1), 0, maxX - m.w), y: noLimite(grade(y - g.dy, 0.1), 0, maxY - m.h) } : m,
        ),
      });
    } else if (selecao.tipo === 'ambiente') {
      const a = planta.ambientes.find((i) => i.id === selecao.id);
      if (!a) return;
      // quem mora dentro do ambiente vai junto com ele
      aoMudar(moverAmbiente(planta, a.id, noLimite(grade(x - g.dx, 0.5), 0, Math.max(0, maxX - a.w)), noLimite(grade(y - g.dy, 0.5), 0, Math.max(0, maxY - a.h))));
    }
  }

  function aoSoltar() {
    const g = gesto.current;
    if (!g) return;
    gesto.current = null;
    if (g.modo === 'desenhar') {
      const r = rascunho;
      setRascunho(null);
      if (r && r.w >= 0.5 && r.h >= 0.5) aoDesenhar(r);
      return;
    }
    // agora sim a moldura pode acompanhar o que mudou de lugar
    setMoldura(calcular(planta));
  }

  /** As setas movem o que está escolhido: 10 cm por toque, meio metro com Shift. */
  function aoTeclar(ev: KeyboardEvent<SVGSVGElement>) {
    if (!editando) {
      const cam = alvo(ev, 'data-cam');
      if (cam && (ev.key === 'Enter' || ev.key === ' ')) {
        ev.preventDefault();
        aoSelecionar({ tipo: 'camera', id: cam });
      }
      return;
    }
    const passo = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
    if (!passo || !selecao) return;
    ev.preventDefault();
    const d = ev.shiftKey ? 0.5 : 0.1;
    const fim = LIMITES.extensao;
    const anda = (v: number, k: number, max: number): number => noLimite(grade(v + k * d, 0.1), 0, max);
    if (selecao.tipo === 'camera') {
      aoMudar({ ...planta, cameras: planta.cameras.map((c) => (c.pontoId === selecao.id ? { ...c, x: anda(c.x, passo[0]!, fim), y: anda(c.y, passo[1]!, fim) } : c)) });
    } else if (selecao.tipo === 'movel') {
      aoMudar({ ...planta, moveis: planta.moveis.map((m) => (m.id === selecao.id ? { ...m, x: anda(m.x, passo[0]!, fim - m.w), y: anda(m.y, passo[1]!, fim - m.h) } : m)) });
    } else {
      const a = planta.ambientes.find((i) => i.id === selecao.id);
      if (a) aoMudar(moverAmbiente(planta, a.id, anda(a.x, passo[0]!, fim - a.w), anda(a.y, passo[1]!, fim - a.h)));
    }
  }

  function aoClicar(ev: { target: EventTarget }) {
    if (editando) return; // na edição quem manda é o arrasto
    const cam = alvo(ev, 'data-cam');
    if (cam) {
      aoSelecionar({ tipo: 'camera', id: cam });
      return;
    }
    const movel = alvo(ev, 'data-movel');
    const m = movel ? planta.moveis.find((x) => x.id === movel) : undefined;
    if (m && movelToca(m)) aoSelecionar({ tipo: 'movel', id: m.id });
  }

  return (
    <div
      ref={caixa}
      data-planta
      className={`planta relative aspect-[16/11] max-w-full overflow-hidden rounded-xl border border-farol-borda bg-farol-painel-2 max-md:aspect-[4/3.4] ${
        editando ? 'editando' : ''
      }`}
    >
      <svg
        ref={svg}
        data-planta-svg
        viewBox={`0 0 ${L} ${A}`}
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label={editando ? 'Planta da loja, em edição. As setas movem o que está escolhido.' : 'Planta da loja com as câmeras'}
        tabIndex={editando ? 0 : undefined}
        onClick={aoClicar}
        onKeyDown={aoTeclar}
        onPointerDown={aoApertar}
        onPointerMove={aoArrastar}
        onPointerUp={aoSoltar}
        onPointerCancel={aoSoltar}
      >
        {ambientes.map((a) => (
          <polygon
            key={a.id}
            className={`pl-piso${editando && selecao?.tipo === 'ambiente' && selecao.id === a.id ? ' sel' : ''}`}
            data-ambiente={a.id}
            points={chao(cantos(a))}
          />
        ))}

        {cegos.map(([x1, y1, x2, y2], i) => (
          <polygon key={i} className="pl-cego" points={chao([[x1, y1], [x2, y1], [x2, y2], [x1, y2]])} />
        ))}

        {/* 4 · o campo de visão de cada câmera, pintado no chão */}
        {planta.cameras.map((cam) => {
          const chave = situacaoDe(cam.pontoId)?.chave ?? 'semcrit';
          const marcada = selecao?.tipo === 'camera' && selecao.id === cam.pontoId;
          const apagado = selecao?.tipo === 'camera' && !marcada && !editando;
          const classe = cobertura ? (chave === 'semimagem' || chave === 'pausado' ? chave : 'ok') : chave;
          return (
            <polygon
              key={cam.pontoId}
              className={`pl-cone ${classe}${marcada ? ' sel' : ''}${apagado ? ' apagado' : ''}`}
              data-cone={cam.pontoId}
              points={chao(coneDaCamera(planta, cam))}
            />
          );
        })}

        {volumes.map((v) => (
          <g key={v.chave}>{v.no}</g>
        ))}

        {planta.ambientes.map((a) => {
          const largo = a.nome.length * letra;
          if (largo > naTela(a) - 8) return null;
          const [tx, ty] = p(...lugarDoNome(planta, a, largo / 2 / proj.escala, 15 / proj.escala, cabecas), 0);
          return (
            <text key={a.id} className={`pl-nome${estreita ? ' pq' : ''}`} x={tx.toFixed(1)} y={(ty + 4).toFixed(1)}>
              {a.nome}
            </text>
          );
        })}

        {/* 6 · as câmeras, por cima de tudo: têm de dar para tocar */}
        {planta.cameras.map((cam) => {
          const canal = canais.get(cam.pontoId);
          const chave = canal?.situacao.chave ?? 'semcrit';
          const marcada = selecao?.tipo === 'camera' && selecao.id === cam.pontoId;
          const [bx, by] = p(cam.x, cam.y, 0);
          const [hx, hy] = p(cam.x, cam.y, pinoDa(cam));
          const numero = canal ? numeroDoCanal(canal.ponto) : '?';
          return (
            <g key={cam.pontoId}>
              {emPe && (
                <>
                  <line className="pl-poste" x1={bx.toFixed(1)} y1={by.toFixed(1)} x2={hx.toFixed(1)} y2={hy.toFixed(1)} />
                  <circle className="pl-chao" cx={bx.toFixed(1)} cy={by.toFixed(1)} r="2.5" />
                </>
              )}
              <g
                className={`pl-cam ${chave}${marcada ? ' sel' : ''}${raio < 12 ? ' pq' : ''}`}
                data-cam={cam.pontoId}
                role="button"
                tabIndex={0}
                aria-pressed={marcada}
                aria-label={`Câmera ${canal?.ponto.nome ?? 'sem canal'}, ${numero === 'IP' ? 'câmera IP' : `canal ${numero}`}: ${canal?.situacao.texto ?? 'sem situação'}`}
              >
                <circle className="toque" cx={hx.toFixed(1)} cy={hy.toFixed(1)} r={raio + 8.5} />
                <circle className="anel" cx={hx.toFixed(1)} cy={hy.toFixed(1)} r={raio + 4.5} />
                <circle className="miolo" cx={hx.toFixed(1)} cy={hy.toFixed(1)} r={raio} />
                <text x={hx.toFixed(1)} y={hy.toFixed(1)}>
                  {numero}
                </text>
              </g>
            </g>
          );
        })}

        {/* 7 · na edição: a mira da câmera escolhida e o retângulo que está sendo desenhado */}
        {camSel &&
          (() => {
            const [ax, ay] = p(camSel.x, camSel.y);
            const [mx, my] = p(camSel.x + Math.cos(rad(camSel.dir)) * 1.5, camSel.y + Math.sin(rad(camSel.dir)) * 1.5);
            return (
              <>
                <line className="pl-mira" x1={ax.toFixed(1)} y1={ay.toFixed(1)} x2={mx.toFixed(1)} y2={my.toFixed(1)} />
                <circle className="pl-alca" data-alca="" cx={mx.toFixed(1)} cy={my.toFixed(1)} r="9" />
              </>
            );
          })()}
        {rascunho && <polygon className="pl-rascunho" points={chao(cantos(rascunho))} />}
      </svg>
    </div>
  );
}
