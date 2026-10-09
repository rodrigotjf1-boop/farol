// =====================================================================
// O que é "marcar um canal"
// =====================================================================
// A árvore mostra setor → canal. O banco guarda ÁREAS (zonas): o critério
// vale numa área de um canal — a IMAGEM COMPLETA (o canal inteiro, onde
// moram os critérios gerais) ou um QUADRO (um recorte marcado na imagem).
//
// Canal SEM quadro: marcar o canal é marcar a imagem completa dele.
//
// Canal COM quadros: o critério vai para um lugar escolhido. A mesma câmera
// do caixa confere presença dentro do balcão e fila do lado do cliente, e
// "marcar o canal" não diria onde o critério vale. Ali a árvore mostra a
// imagem completa e os quadros, e é neles que se marca.
//
// Estas funções são a única ponte entre as duas visões, para a regra não
// ficar espalhada pela tela.
// =====================================================================

import { rotuloDaArea } from '@/componentes/canal/quadros';
import type { Ponto, Regra, Setor } from '@/lib/api';

/** O canal tem quadros: o critério é marcado num lugar dele (a imagem completa ou um quadro), não no canal. */
export const temVariasAreas = (p: Ponto): boolean => p.zonas.length > 1;

/** A área que representa o canal: a imagem completa dele (a principal); na falta, a primeira. */
export function areaDoCanal(p: Ponto): string | null {
  const z = p.zonas.find((x) => x.principal) ?? p.zonas[0];
  return z?.id ?? null;
}

/** Áreas deste canal que estão marcadas. */
export function marcadasNoCanal(p: Ponto, marcadas: ReadonlySet<string>): string[] {
  return p.zonas.filter((z) => marcadas.has(z.id)).map((z) => z.id);
}

export function canalMarcado(p: Ponto, marcadas: ReadonlySet<string>): boolean {
  return p.zonas.some((z) => marcadas.has(z.id));
}

/** Canal 1, Canal 2, Canal 3 — na ordem em que estão no gravador, que é
 *  como quem opera a loja os conhece. A API devolve por nome; em ordem
 *  alfabética a "Chapa" (canal 3) viria antes da "Montagem" (canal 1).
 *  Câmera sem número de canal (IP direta) vai para o fim, por nome. */
export function emOrdem(pontos: Ponto[]): Ponto[] {
  return [...pontos].sort((a, b) => {
    const ca = a.canal ?? Number.POSITIVE_INFINITY;
    const cb = b.canal ?? Number.POSITIVE_INFINITY;
    return ca !== cb ? ca - cb : a.nome.localeCompare(b.nome, 'pt-BR');
  });
}

/** Canais que entram na árvore: os ativos, e os desativados que ainda
 *  estiverem marcados — para dar como desmarcá-los. */
export function canaisDoSetor(s: Setor, marcadas: ReadonlySet<string>): Ponto[] {
  return emOrdem(
    s.pontos.filter((p) => p.zonas.length > 0 && (p.ativo || canalMarcado(p, marcadas))),
  );
}

export type EstadoDoSetor = 'nenhum' | 'alguns' | 'todos';

export function estadoDoSetor(s: Setor, marcadas: ReadonlySet<string>): EstadoDoSetor {
  const canais = canaisDoSetor(s, marcadas);
  const n = canais.filter((p) => canalMarcado(p, marcadas)).length;
  if (n === 0) return 'nenhum';
  return n === canais.length ? 'todos' : 'alguns';
}

/** Marca ou desmarca um canal. Marcar = a imagem completa dele. */
export function alternarCanal(p: Ponto, marcadas: ReadonlySet<string>): Set<string> {
  const novo = new Set(marcadas);
  if (canalMarcado(p, marcadas)) {
    for (const z of p.zonas) novo.delete(z.id);
  } else {
    const area = areaDoCanal(p);
    if (area) novo.add(area);
  }
  return novo;
}

/** Marca o setor inteiro; se já estava inteiro, desmarca. */
export function alternarSetor(s: Setor, marcadas: ReadonlySet<string>): Set<string> {
  const novo = new Set(marcadas);
  const canais = canaisDoSetor(s, marcadas);
  if (estadoDoSetor(s, marcadas) === 'todos') {
    for (const p of canais) for (const z of p.zonas) novo.delete(z.id);
    return novo;
  }
  for (const p of canais) {
    // Canal já marcado fica como está: quem escolheu uma área específica
    // não quer vê-la trocada ao marcar o setor.
    if (canalMarcado(p, marcadas)) continue;
    if (!p.ativo) continue;
    if (temVariasAreas(p)) {
      // "O setor inteiro" é tudo o que há nele: todas as áreas do canal.
      for (const z of p.zonas) novo.add(z.id);
      continue;
    }
    const area = areaDoCanal(p);
    if (area) novo.add(area);
  }
  return novo;
}

/** Quantos canais (não áreas) estão marcados. */
export function contarCanais(setores: Setor[], marcadas: ReadonlySet<string>): number {
  let n = 0;
  for (const s of setores) for (const p of s.pontos) if (canalMarcado(p, marcadas)) n += 1;
  return n;
}

/**
 * Onde o critério vale, numa frase: "Vale em 2 canais — em Balcão, só
 * “Quadro 1 · Lado do cliente”." A parte dos lugares só aparece no canal em
 * que nem todos estão marcados: é a que diz algo que o número de canais não diz.
 */
export function resumoDeOndeVale(setores: Setor[], marcadas: ReadonlySet<string>): string {
  const total = contarCanais(setores, marcadas);
  if (total === 0) return 'Nenhum canal marcado.';
  const emAreas: string[] = [];
  for (const s of setores) {
    for (const p of s.pontos) {
      if (!temVariasAreas(p)) continue;
      const dentro = p.zonas.filter((z) => marcadas.has(z.id));
      if (dentro.length > 0 && dentro.length < p.zonas.length) {
        emAreas.push(`em ${p.nome}, só ${dentro.map((z) => `“${rotuloDaArea(z)}”`).join(' e ')}`);
      }
    }
  }
  const base = total === 1 ? 'Vale em 1 canal' : `Vale em ${total} canais`;
  return `${base}${emAreas.length > 0 ? ` — ${emAreas.join('; ')}` : ''}.`;
}

export function rotuloDoCanal(p: { nome: string; canal: number | null }): string {
  return p.canal != null ? `Canal ${p.canal} · ${p.nome}` : p.nome;
}

/** Os critérios que valem num canal, com a área em que valem. */
export function criteriosDoCanal(
  regras: Regra[],
  pontoId: string,
): Array<{ regra: Regra; zonaId: string; zonaNome: string }> {
  const saida: Array<{ regra: Regra; zonaId: string; zonaNome: string }> = [];
  for (const regra of regras) {
    for (const a of regra.alvos) {
      if (a.ponto_id === pontoId) {
        saida.push({ regra, zonaId: a.zona_id, zonaNome: a.zona_nome });
      }
    }
  }
  return saida;
}
