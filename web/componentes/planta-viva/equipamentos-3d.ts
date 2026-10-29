// =====================================================================
// Ao vivo › 3D: cada equipamento com a cara do que ele é (29/10/2026)
// =====================================================================
// Do protótipo aprovado pelo dono ("onde é chapa ou fritadeira, o inox, o
// salão"): a chapa com o tampo preto e a brasa, a fritadeira com as duas
// cubas de óleo, a bancada de inox com tampo, pés e a prateleira de baixo,
// a geladeira branca (a alta com porta de vidro), a pia com a cuba e a
// torneira, a estufa de vidro com a luz, a prateleira em camadas, o totem
// com a tela, o caixa com o monitor, o balcão com tampo de granito, mesa e
// cabine de madeira com o banco de couro, e o pilar de concreto.
//
// Tudo em caixas e cilindros — cabe uma loja de 75 móveis sem pesar. Os
// materiais são criados uma vez por cena e divididos entre os móveis.
// =====================================================================

import * as THREE from 'three';

import { tipoDoMovel, type Movel } from '@/lib/planta';

import { MATERIAL } from './cara-da-planta';

export type Materiais = ReturnType<typeof materiaisDaCena>;

export function materiaisDaCena() {
  const padrao = (color: number, roughness = 0.5, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  return {
    inox: padrao(MATERIAL.inox, 0.3, 0.45),
    inoxEscuro: padrao(MATERIAL.inoxEscuro, 0.4, 0.4),
    chapa: padrao(MATERIAL.chapa, 0.55, 0.3),
    brasa: new THREE.MeshBasicMaterial({ color: MATERIAL.brasa, transparent: true, opacity: 0.5 }),
    oleo: new THREE.MeshStandardMaterial({ color: MATERIAL.oleo, emissive: MATERIAL.oleoBrilho, roughness: 0.25 }),
    cuba: padrao(MATERIAL.cuba, 0.6),
    branco: padrao(MATERIAL.branco, 0.45),
    vidro: new THREE.MeshStandardMaterial({ color: MATERIAL.vidro, transparent: true, opacity: 0.38, roughness: 0.1 }),
    madeira: padrao(MATERIAL.madeira, 0.7),
    couro: padrao(MATERIAL.couro, 0.6),
    granito: padrao(MATERIAL.granito, 0.3, 0.2),
    frente: padrao(MATERIAL.frente, 0.6),
    concreto: padrao(MATERIAL.concreto, 0.9),
    tela: new THREE.MeshBasicMaterial({ color: MATERIAL.tela }),
    preto: padrao(MATERIAL.preto, 0.6),
    luz: new THREE.MeshBasicMaterial({ color: MATERIAL.luz, transparent: true, opacity: 0.35 }),
  };
}

/** Uma caixa (no mínimo 1 cm de cada lado) no lugar dado, dentro do grupo. */
function bloco(g: THREE.Group, w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.01, w), Math.max(0.01, h), Math.max(0.01, d)), mat);
  m.position.set(x, y, z);
  g.add(m);
  return m;
}

/**
 * O móvel montado pelo tipo, com o canto de cima à esquerda em (x, 0, y) da planta. A brasa de todas as chapas é o
 * mesmo material (`M.brasa`): quem desenha faz ela respirar mexendo na opacidade dele.
 */
export function equipamento(m: Movel, M: Materiais): THREE.Group {
  const g = new THREE.Group();
  g.position.set(m.x, 0, m.y);
  const { w, h, alt } = m;
  const cx = w / 2;
  const cz = h / 2;
  const pernas = (topo: number) => {
    for (const [px, pz] of [[0.04, 0.04], [w - 0.04, 0.04], [0.04, h - 0.04], [w - 0.04, h - 0.04]] as const) bloco(g, 0.04, topo, 0.04, M.inoxEscuro, px, topo / 2, pz);
  };
  switch (tipoDoMovel(m)) {
    case 'chapa': {
      bloco(g, w, alt - 0.05, h, M.inoxEscuro, cx, (alt - 0.05) / 2, cz);
      bloco(g, w - 0.06, 0.05, h - 0.12, M.chapa, cx, alt - 0.025, cz + 0.03);
      const brasa = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(0.05, w - 0.2), Math.max(0.05, h - 0.3)), M.brasa);
      brasa.rotation.x = -Math.PI / 2;
      brasa.position.set(cx, alt + 0.004, cz + 0.03);
      g.add(brasa);
      for (let k = 1; k <= 4; k += 1) bloco(g, 0.05, 0.05, 0.03, M.preto, (k * w) / 5, alt * 0.75, h + 0.015);
      break;
    }
    case 'fritadeira': {
      bloco(g, w, alt - 0.04, h, M.inoxEscuro, cx, (alt - 0.04) / 2, cz);
      bloco(g, w, 0.04, h, M.inox, cx, alt - 0.02, cz);
      for (const k of [0, 1]) {
        const px = w * (0.27 + k * 0.46);
        bloco(g, w * 0.36, 0.02, h * 0.6, M.cuba, px, alt + 0.005, cz);
        bloco(g, w * 0.3, 0.02, h * 0.48, M.oleo, px, alt + 0.012, cz);
      }
      break;
    }
    case 'geladeira': {
      bloco(g, w, alt, h, M.branco, cx, alt / 2, cz);
      if (alt >= 1.4) bloco(g, w - 0.08, alt - 0.25, 0.02, M.vidro, cx, alt / 2 + 0.05, h + 0.011);
      else bloco(g, w - 0.04, 0.02, h - 0.04, M.inoxEscuro, cx, alt + 0.01, cz);
      break;
    }
    case 'pia': {
      pernas(alt - 0.04);
      bloco(g, w, 0.04, h, M.inox, cx, alt - 0.02, cz);
      bloco(g, Math.min(w * 0.6, 0.5), 0.03, h * 0.6, M.cuba, cx, alt + 0.005, cz);
      bloco(g, 0.03, 0.25, 0.03, M.inoxEscuro, cx, alt + 0.12, 0.08);
      break;
    }
    case 'estufa': {
      bloco(g, w, alt * 0.45, h, M.inoxEscuro, cx, alt * 0.225, cz);
      bloco(g, w, alt * 0.55, h, M.vidro, cx, alt * 0.725, cz);
      bloco(g, w - 0.1, 0.02, h - 0.1, M.luz, cx, alt * 0.6, cz);
      break;
    }
    case 'prateleira': {
      for (const [px, pz] of [[0.03, 0.03], [w - 0.03, 0.03], [0.03, h - 0.03], [w - 0.03, h - 0.03]] as const) bloco(g, 0.03, alt, 0.03, M.inoxEscuro, px, alt / 2, pz);
      for (let y = 0.25; y < alt; y += 0.42) bloco(g, w, 0.025, h, M.inox, cx, y, cz);
      break;
    }
    case 'totem': {
      bloco(g, w, 0.06, h, M.preto, cx, 0.03, cz);
      bloco(g, w * 0.7, alt, h * 0.5, M.preto, cx, alt / 2, cz);
      bloco(g, w * 0.55, alt * 0.4, 0.01, M.tela, cx, alt * 0.7, cz + h * 0.26);
      break;
    }
    case 'caixa':
    case 'balcao': {
      bloco(g, w, alt - 0.04, h, M.frente, cx, (alt - 0.04) / 2, cz);
      bloco(g, w + 0.04, 0.04, h + 0.04, M.granito, cx, alt - 0.02, cz);
      if (tipoDoMovel(m) === 'caixa') {
        bloco(g, 0.45, 0.3, 0.03, M.preto, cx, alt + 0.2, cz);
        bloco(g, 0.4, 0.25, 0.01, M.tela, cx, alt + 0.2, cz + 0.02);
      }
      break;
    }
    case 'mesa': {
      bloco(g, w, 0.04, h, M.madeira, cx, alt, cz);
      const pe = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, alt, 10), M.preto);
      pe.position.set(cx, alt / 2, cz);
      g.add(pe);
      break;
    }
    case 'cabine': {
      // a mesa no meio e um banco de cada lado, no sentido do lado maior
      const deitada = w >= h;
      const lado = deitada ? w : h;
      const banco = lado * 0.25;
      const altura = Math.max(alt, 0.8);
      bloco(g, deitada ? w * 0.42 : w * 0.8, 0.04, deitada ? h * 0.8 : h * 0.42, M.madeira, cx, 0.75, cz);
      for (const s of [-1, 1]) {
        const [px, pz] = deitada ? [cx + s * (lado / 2 - banco / 2), cz] : [cx, cz + s * (lado / 2 - banco / 2)];
        const [bw, bd] = deitada ? [banco, h * 0.9] : [w * 0.9, banco];
        bloco(g, bw, 0.45, bd, M.couro, px, 0.225, pz);
        const [ex, ez] = deitada ? [px + s * (banco / 2 - 0.06), pz] : [px, pz + s * (banco / 2 - 0.06)];
        bloco(g, deitada ? 0.12 : bw, altura, deitada ? bd : 0.12, M.couro, ex, altura / 2, ez);
      }
      break;
    }
    case 'banco': {
      bloco(g, w, 0.45, h, M.couro, cx, 0.225, cz);
      const encosto = Math.max(alt, 0.6);
      if (w >= h) bloco(g, w, encosto, 0.12, M.couro, cx, encosto / 2, h - 0.06);
      else bloco(g, 0.12, encosto, h, M.couro, w - 0.06, encosto / 2, cz);
      break;
    }
    case 'estrutura':
      bloco(g, w, alt, h, M.concreto, cx, alt / 2, cz);
      break;
    default: {
      // bancada de inox: tampo, pés e a prateleira de baixo
      pernas(alt - 0.05);
      bloco(g, w, 0.05, h, M.inox, cx, alt - 0.025, cz);
      bloco(g, w - 0.1, 0.03, h - 0.1, M.inoxEscuro, cx, 0.2, cz);
    }
  }
  return g;
}
