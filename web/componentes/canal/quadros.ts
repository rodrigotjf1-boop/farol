// =====================================================================
// As palavras do canal: imagem completa, quadro e papel
// =====================================================================
// O canal é a câmera. A IMAGEM COMPLETA é o canal inteiro — fixa, uma por
// canal —, e os critérios postos nela são os critérios gerais. O QUADRO é
// um recorte marcado dentro da imagem, com nome e PAPEL; cada quadro tem os
// seus critérios.
//
// Um lugar só para os nomes: a tela do canal, a tela do desenho e a árvore
// de critérios dizem a mesma coisa do mesmo jeito.
// =====================================================================

import type { Papel } from '@/lib/api';

export const NOME_DA_IMAGEM_COMPLETA = 'Imagem completa';

/** Quantos quadros um canal aceita. O mesmo teto do servidor (`api/src/rotas/preview.ts`). */
export const MAX_QUADROS = 8;

/**
 * Os papéis, na ordem em que aparecem para escolher. `oQueE` descreve o
 * quadro — não promete análise: o que cada papel muda no que o Farol faz
 * está em `oQueOPapelMuda`, e só diz o que já existe.
 */
export const PAPEIS: ReadonlyArray<{ valor: Papel; nome: string; oQueE: string }> = [
  { valor: 'posto', nome: 'posto de trabalho', oQueE: 'Onde alguém trabalha: o lugar de quem monta, de quem atende, de quem está na chapa.' },
  { valor: 'cuba', nome: 'cuba de ingrediente', oQueE: 'Uma cuba de ingrediente, ou uma fileira delas.' },
  { valor: 'montagem', nome: 'posição de montagem', oQueE: 'Onde o lanche é montado.' },
  { valor: 'equipamento', nome: 'equipamento', oQueE: 'Chapa, fritadeira, forno, estufa.' },
  { valor: 'impressora', nome: 'impressora e comanda', oQueE: 'Onde a comanda sai.' },
  { valor: 'caixa', nome: 'caixa e gaveta', oQueE: 'Gaveta de dinheiro, maquininha, balcão do cliente.' },
  { valor: 'pia', nome: 'pia', oQueE: 'Lavagem das mãos e dos utensílios.' },
  { valor: 'piso', nome: 'piso', oQueE: 'O chão: limpeza, objeto caído, passagem livre.' },
  { valor: 'livre', nome: 'sem papel definido', oQueE: 'Um recorte como os de sempre: só delimita onde o critério vale.' },
];

export const nomeDoPapel = (p: Papel | undefined): string =>
  PAPEIS.find((x) => x.valor === (p ?? 'livre'))?.nome ?? 'sem papel definido';

export const oQueEOPapel = (p: Papel | undefined): string =>
  PAPEIS.find((x) => x.valor === (p ?? 'livre'))?.oQueE ?? '';

/**
 * O que o papel MUDA no que o Farol faz — só o que já existe. Hoje é um só:
 * a regra do quadro de bancada (`agent/farol_agent/motor.py`,
 * `PAPEL_DE_BANCADA`), que vale para os critérios que olham uma imagem
 * (estado, ação e comparação; presença e contagem seguem em toda olhada).
 * Os outros papéis dizem ao Farol o que há no quadro, e mais nada.
 */
export const O_QUE_O_PAPEL_MUDA: Partial<Record<Papel, { muda: string; cuidado: string }>> = {
  montagem: {
    muda:
      'Neste papel, os critérios de estado, ação e comparação deste quadro só são conferidos com o quadro parado: ' +
      'com mão na frente, a olhada espera as mãos saírem. E, com o quadro parado e ninguém à vista, a imagem ' +
      'vai sem o borrão de rosto. Presença e contagem seguem em toda olhada.',
    cuidado: 'Pensado para câmera que olha de cima. Se esta câmera mostra rostos, prefira outro papel.',
  },
};

/** O que o agente da loja declara saber quando sabe a regra do quadro de bancada. */
export const SABE_BANCADA = 'bancada';

/** Uma área do canal, do jeito que estas funções precisam dela. */
type Area = { nome: string; principal?: boolean; numero?: number | null };

/** "Imagem completa" ou "Quadro 2 · Montagem". */
export function rotuloDaArea(z: Area): string {
  if (z.principal) return NOME_DA_IMAGEM_COMPLETA;
  return z.numero != null ? `Quadro ${z.numero} · ${z.nome}` : z.nome;
}

/** "na imagem completa" ou "no Quadro 2 · Montagem" — para o meio de uma frase. */
export function naArea(z: Area): string {
  return z.principal ? 'na imagem completa' : `no ${rotuloDaArea(z)}`;
}

/** "em 2 canais (3 quadros)" — o critério é um cadastro só, e isto diz onde ele vale. */
export function emQuantosLugares(canais: number, quadros: number): string {
  const base = canais === 1 ? 'em 1 canal' : `em ${canais} canais`;
  if (quadros <= 0) return base;
  return `${base} (${quadros === 1 ? '1 quadro' : `${quadros} quadros`})`;
}

/** Um nome que ainda não existe no canal: "Quadro novo", "Quadro novo 2"… */
export function nomeParaQuadroNovo(nomes: readonly string[]): string {
  const usados = new Set(nomes.map((n) => n.trim().toLowerCase()));
  let nome = 'Quadro novo';
  for (let n = 2; usados.has(nome.toLowerCase()); n += 1) nome = `Quadro novo ${n}`;
  return nome;
}
