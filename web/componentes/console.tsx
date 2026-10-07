'use client';

// O que toda tela do console precisa saber, buscado UMA vez pela moldura:
// quem está logado, o que pode, quais lojas existem, em qual está e como
// vai o agente dela.

import { createContext, useContext } from 'react';

import type { Eu, LojaResumo } from '@/lib/api';

/** Minutos sem bater a partir dos quais o agente é dado como fora.
 *
 * Generoso de propósito: o agente bate a cada poucos segundos, mas
 * internet de loja oscila, o Windows atualiza, o PC é desligado para
 * limpar o balcão. Avisar a cada soluço treina todo mundo a ignorar o
 * aviso. É o mesmo limite que a API usa nos sinais. */
export const LIMITE_DO_AGENTE_SEG = 5 * 60;

export type Saude = {
  estado: 'ativo' | 'fora' | 'nenhum';
  /** "Agente ativo" */
  titulo: string;
  /** "Ativo" */
  curto: string;
  /** "bateu há 12 s" */
  detalhe: string;
};

/** "há 12 s", "há 3 min", "há 2 h", "há 4 dias". */
export function haQuanto(segundos: number | null): string {
  if (segundos == null) return 'nunca';
  // "bateu há 0 s" é conta de máquina; nos primeiros segundos é "agora".
  // (Só cabe depois de "bateu": agente sem sinal nunca está a 5 s.)
  if (segundos < 5) return 'agora';
  if (segundos < 60) return `há ${segundos} s`;
  const min = Math.floor(segundos / 60);
  if (min < 60) return `há ${min} min`;
  const horas = Math.floor(min / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.floor(horas / 24);
  return `há ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
}

export function saudeDaLoja(loja: Pick<LojaResumo, 'agentes' | 'segundos_sem_bater'>): Saude {
  if (loja.agentes === 0) {
    return { estado: 'nenhum', titulo: 'Sem agente', curto: 'Não instalado', detalhe: 'nada é verificado nesta loja' };
  }
  const s = loja.segundos_sem_bater;
  if (s !== null && s <= LIMITE_DO_AGENTE_SEG) {
    return { estado: 'ativo', titulo: 'Agente ativo', curto: 'Ativo', detalhe: `bateu ${haQuanto(s)}` };
  }
  return {
    estado: 'fora',
    titulo: 'Agente sem sinal',
    curto: 'Sem sinal',
    detalhe: s === null ? 'ainda não bateu' : `última batida ${haQuanto(s)}`,
  };
}

export type Console = {
  eu: Eu;
  /** Gerente, presidente e suporte mexem na configuração.
   *
   * ⚠️ Só serve para esconder botão. Quem decide é a API: se o front
   * mentisse, a rota responderia 403 do mesmo jeito. */
  configura: boolean;
  /** Supervisão para cima, e o suporte, veem os resultados. */
  veResultados: boolean;
  lojas: LojaResumo[] | null;
  lojaId: string | null;
  loja: LojaResumo | null;
  saude: Saude | null;
  /** Quantos sinais de defeito a loja tem agora. Nulo: ainda não se sabe. */
  sinais: number | null;
  /** A tela de um canal avisa de que loja ele é (o endereço não diz). */
  definirLoja: (id: string | null) => void;
  /** Depois de mexer em algo que muda o que a moldura mostra. */
  atualizar: () => void;
};

export const ContextoDoConsole = createContext<Console | null>(null);

export function useConsole(): Console {
  const c = useContext(ContextoDoConsole);
  if (!c) throw new Error('useConsole fora da moldura do console');
  return c;
}

export function podeConfigurar(eu: Eu): boolean {
  return eu.nivel === 'suporte' || eu.nivel === 'gerente' || eu.nivel === 'presidente';
}

export function podeVerResultados(eu: Eu): boolean {
  return eu.nivel !== 'execucao';
}

const NOME_DO_NIVEL: Record<Eu['nivel'], string> = {
  presidente: 'diretoria',
  gerente: 'gerente',
  supervisao: 'supervisão',
  execucao: 'execução',
  suporte: 'suporte',
};

export const nomeDoNivel = (n: Eu['nivel']): string => NOME_DO_NIVEL[n] ?? n;

/** As iniciais para o círculo da conta: "Ana Souza" → "AS". */
export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  const primeira = partes[0]![0] ?? '';
  const ultima = partes.length > 1 ? (partes[partes.length - 1]![0] ?? '') : '';
  return (primeira + ultima).toUpperCase();
}
