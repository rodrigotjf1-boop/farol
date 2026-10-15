// =====================================================================
// A fila da cozinha, do jeito que a loja usa
// =====================================================================
// A19, fatia 5 ("a fila da cozinha chega à loja"). O Regem entrega a fila
// da cozinha da loja (`GET /integracao/producao`, a v2 do contrato de lá —
// `docs/integracao-farol.md` §6, no repositório do Regem): os pedidos em
// produção (recebido, preparo) das últimas 24 horas e os concluídos ou
// cancelados das últimas 2 horas, na ordem em que entraram, com os itens,
// a variação, as escolhas (o que acrescenta e o que tira) e a observação.
// Nada de cliente, mesa, senha de retirada ou valor: lá nem sai.
//
// Aqui a resposta de lá vira o formato do Farol, que o agente lê. É o que
// vai deixar a conferência da bancada saber, sozinha, que a cebola que
// faltou era o "sem cebola" do cliente — o dono, 15/10/2026: "isso vai se
// ajustar com o KDS".
//
// A escolha sai no formato da base de fichas (`Efeito`, de `fichas.ts`) e
// com os ids FIXOS de lá (a opção, o insumo, a sub-receita): a loja casa a
// fila com a base que já tem, sem depender de nome. O id da variação, que o
// Regem troca a cada salvamento, fica de fora — a variação casa pelo código
// (ou pelo nome), como na base.
//
// Tolerante: pedido sem id, etapa ou hora de entrada, item sem descrição e
// escolha sem tipo ou nome ficam de fora (e se conta quantos); resposta sem
// a lista de pedidos é torta.
// =====================================================================

import { createHash } from 'node:crypto';

import type { Efeito } from './fichas.js';
import { efeitoDe } from './regem-fichas.js';

export const ORIGENS_DO_PEDIDO = ['balcao', 'mesa', 'comanda', 'delivery', 'totem'] as const;
export const ETAPAS_DO_PEDIDO = ['recebido', 'preparo', 'pronto', 'entregue', 'cancelado'] as const;
const CONSUMOS = ['local', 'viagem'] as const;

export type EscolhaDoItem = {
  tipo: 'adicionar' | 'remover';
  /** O id FIXO da opção — o mesmo `Opcao.id` da base de fichas. Nulo: opção criada só naquele produto. */
  opcaoId: string | null;
  nome: string;
  /** Quantas vezes a escolha foi feita naquele item. A quantidade do efeito é de UMA vez. */
  vezes: number;
  /** O que a escolha muda na montagem, como na base de fichas. O nome do preparo e do produto a loja acha na base, pelo id. */
  efeito: Efeito;
};

export type ItemDaFila = {
  /** O id do item no pedido: é por ele que se diz qual item a bancada montou. */
  id: string | null;
  produtoId: string | null;
  fichaId: string | null;
  /** Como ficou na venda. Casa com a variação da base pelo `codigo` (ou pelo nome). */
  variacao: { nome: string | null; codigo: string | null; fator: number } | null;
  /** O texto que a cozinha lê. */
  descricao: string;
  quantidade: number;
  observacao: string | null;
  /** O item que saiu da venda depois de entrar na fila. */
  removido: boolean;
  /** As escolhas em texto, como a cozinha lê ("+ 2x Bacon · sem Cebola"); nulo quando já vêm na descrição. */
  escolhasEmTexto: string | null;
  escolhas: EscolhaDoItem[];
};

export type PedidoDaFila = {
  id: string;
  numero: number | null;
  origem: (typeof ORIGENS_DO_PEDIDO)[number] | null;
  canal: string | null;
  consumo: (typeof CONSUMOS)[number] | null;
  etapa: (typeof ETAPAS_DO_PEDIDO)[number];
  /** O pedido mudou depois de entrar na fila (item acrescentado ou retirado). */
  alterado: boolean;
  setorId: string | null;
  tempoPreparoMin: number | null;
  criadoEm: string;
  iniciadoEm: string | null;
  prontoEm: string | null;
  entregueEm: string | null;
  canceladoEm: string | null;
  itens: ItemDaFila[];
};

export type FilaDaCozinha = { geradoEm: string | null; pedidos: PedidoDaFila[]; foraDoFormato: number };

type Bruto = Record<string, unknown>;
const ehObjeto = (v: unknown): v is Bruto => typeof v === 'object' && v !== null && !Array.isArray(v);
const texto = (v: unknown, max = 500): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const numero = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const data = (v: unknown): string | null => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);
const umDe = <T extends string>(lista: readonly T[], v: unknown): T | null => (lista.includes(v as T) ? (v as T) : null);
/** A fila não traz o nome do preparo nem o do produto que uma escolha acrescenta: a loja os acha na base dela. */
const SEM_NOMES = new Map<string, string>();

function escolha(bruto: unknown): EscolhaDoItem | null {
  if (!ehObjeto(bruto)) return null;
  const tipo = umDe(['adicionar', 'remover'] as const, bruto.tipo);
  const nome = texto(bruto.nome, 200);
  if (!tipo || !nome) return null;
  const vezes = numero(bruto.vezes);
  return {
    tipo,
    opcaoId: texto(bruto.opcao_id, 64),
    nome,
    vezes: vezes !== null && Number.isInteger(vezes) && vezes >= 1 ? vezes : 1,
    efeito: efeitoDe(tipo, bruto, SEM_NOMES, SEM_NOMES),
  };
}

/** `fora` conta o que ficou de fora por estar fora do contrato. */
function item(bruto: unknown, fora: { n: number }): ItemDaFila | null {
  if (!ehObjeto(bruto)) return null;
  const descricao = texto(bruto.descricao);
  if (!descricao) return null;
  const v = ehObjeto(bruto.variacao) ? bruto.variacao : null;
  const quantidade = numero(bruto.quantidade);
  const brutas = Array.isArray(bruto.adicionais) ? bruto.adicionais : [];
  const escolhas = brutas.map(escolha).filter((x): x is EscolhaDoItem => x !== null);
  // Uma escolha perdida em silêncio muda o pedido (o "sem cebola" que some): conta.
  fora.n += brutas.length - escolhas.length;
  return {
    id: texto(bruto.id, 64),
    produtoId: texto(bruto.produto_id, 64),
    fichaId: texto(bruto.ficha_id, 64),
    variacao: v ? { nome: texto(v.nome, 200), codigo: texto(v.codigo, 60), fator: numero(v.fator_ficha) ?? 1 } : null,
    descricao,
    quantidade: quantidade !== null && quantidade > 0 ? quantidade : 1,
    observacao: texto(bruto.observacao),
    removido: bruto.removido === true,
    escolhasEmTexto: texto(bruto.adicionais_texto),
    escolhas,
  };
}

/** A resposta de `GET /integracao/producao` (a que veio com a fila) no formato do Farol. Nulo = resposta torta. */
export function filaParaOAgente(corpo: unknown): FilaDaCozinha | null {
  if (!ehObjeto(corpo) || !Array.isArray(corpo.pedidos)) return null;
  const fora = { n: 0 };
  const pedidos: PedidoDaFila[] = [];
  for (const bruto of corpo.pedidos) {
    const id = ehObjeto(bruto) ? texto(bruto.id, 64) : null;
    const etapa = ehObjeto(bruto) ? umDe(ETAPAS_DO_PEDIDO, bruto.status) : null;
    const criadoEm = ehObjeto(bruto) ? data(bruto.criado_em) : null;
    if (!ehObjeto(bruto) || !id || !etapa || !criadoEm) {
      fora.n += 1;
      continue;
    }
    const itensBrutos = Array.isArray(bruto.itens) ? bruto.itens : [];
    const itens = itensBrutos.map((i) => item(i, fora)).filter((x): x is ItemDaFila => x !== null);
    fora.n += itensBrutos.length - itens.length;
    const n = numero(bruto.numero);
    const tempo = numero(bruto.tempo_preparo_min);
    pedidos.push({
      id,
      numero: n !== null && Number.isInteger(n) ? n : null,
      origem: umDe(ORIGENS_DO_PEDIDO, bruto.origem),
      canal: texto(bruto.canal, 80),
      consumo: umDe(CONSUMOS, bruto.consumo),
      etapa,
      alterado: bruto.alterado === true,
      setorId: texto(bruto.setor_id, 64),
      tempoPreparoMin: tempo !== null && tempo >= 0 ? tempo : null,
      criadoEm,
      iniciadoEm: data(bruto.iniciado_em),
      prontoEm: data(bruto.pronto_em),
      entregueEm: data(bruto.entregue_em),
      canceladoEm: data(bruto.cancelado_em),
      itens,
    });
  }
  return { geradoEm: data(corpo.gerado_em), pedidos, foraDoFormato: fora.n };
}

/**
 * A versão do que desce para a loja: a impressão dos pedidos. Não entra a
 * hora em que o Regem montou a resposta — ela muda a cada leitura, e a loja
 * baixaria a mesma fila de novo.
 */
export function versaoDaFila(fila: Pick<FilaDaCozinha, 'pedidos'>): string {
  return createHash('sha256').update(JSON.stringify(fila.pedidos), 'utf8').digest('hex');
}
