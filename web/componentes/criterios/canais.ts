// =====================================================================
// O que é "marcar um canal"
// =====================================================================
// A árvore mostra setor → canal. O banco guarda ÁREAS (zonas): o critério
// vale numa área de um canal, porque é pela área que o agente recorta o
// quadro.
//
// Marcar um canal é marcar a área PRINCIPAL dele — o corte que o usuário
// desenhou em "Área de análise"; na falta de desenho, o quadro inteiro.
// Estas funções são a única ponte entre as duas visões, para a regra não
// ficar espalhada pela tela.
// =====================================================================

import type { Ponto, Regra, Setor } from '@/lib/api';

/** A área que representa o canal: a principal; na falta, a primeira. */
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

/** Marca ou desmarca um canal. Marcar = a área principal dele. */
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
    // não quer vê-la trocada pela principal ao marcar o setor.
    if (canalMarcado(p, marcadas)) continue;
    if (!p.ativo) continue;
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
