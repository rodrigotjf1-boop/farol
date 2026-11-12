// =====================================================================
// O alerta que o transporte leva — o texto, a gravidade e a ordem da fila
// =====================================================================
// Pedido da sessão do Regem (onda 3 da auditoria do KDS, 11/11/2026): o
// KDS mostra o alerta na tela da cozinha, e até aqui o envio reivindicado
// do motivo `evento` saía só com o `evento_id` — sem o que mostrar. Agora
// cada envio leva o `alerta` montado aqui: título, detalhe, gravidade,
// prioridade, onde, quando e a loja (com o id dela no Regem).
//
// ## A gravidade de cada motivo
//
// - `evento`: a da REGRA e a prioridade do evento (ou da regra), como o
//   despacho decidiu quem recebe (`despacho.ts`, `eventosParaAvisar`);
// - `agente_caiu`: emergência e urgente, como o despacho o resolve;
// - `computador`: a do tipo do aviso (`GRAVIDADE` do aviso da máquina).
//
// As três saem da MESMA expressão em SQL que ordena a fila: o que aparece
// como "emergência" no KDS é o que saiu antes.
// =====================================================================

import type { Prioridade, Severidade } from './alertas.js';
import { GRAVIDADE } from './aviso-da-maquina.js';

/** Da mais leve para a mais grave: a fila sai de trás para a frente. */
export const ORDEM_DA_SEVERIDADE: readonly Severidade[] = ['info', 'atencao', 'critico', 'emergencia'];
export const ORDEM_DA_PRIORIDADE: readonly Prioridade[] = ['leve', 'intermediaria', 'urgente'];

/**
 * Quanto o transporte tem para devolver o resultado de um envio que levou. Passou disto sem resposta (o transporte
 * caiu no meio), o envio volta à fila como `falhou`, com o motivo, e o próximo a reivindicar leva de novo — o mesmo
 * id: o transporte deduplica pelo id do envio.
 */
export const PRAZO_DO_RESULTADO_S = 120;
export const ERRO_DO_PRAZO = `o transporte levou e não devolveu o resultado em ${PRAZO_DO_RESULTADO_S / 60} minutos`;

/** O destino do KDS não tem endereço digitado: é a loja do Regem ligada à loja do alerta. */
export const ENDERECO_DO_KDS = 'regem';
export const ERRO_DO_KDS_SEM_REGEM =
  'esta loja não está ligada a uma loja do Regem: a tela da cozinha não tem para onde ir';

const lista = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(', ');

/** A gravidade do aviso da máquina em SQL, montada do MESMO `GRAVIDADE` que o aviso usa. */
const doComputador = (campo: 'severidade' | 'prioridade', senao: string) =>
  `case e.payload->>'tipo' ${Object.entries(GRAVIDADE)
    .map(([tipo, g]) => `when '${tipo}' then '${g[campo]}'`)
    .join(' ')} else '${senao}' end`;

/** A severidade de um envio, sobre `envio e`, `evento ev` e `regra r` (as duas últimas por `left join`). */
export const SEVERIDADE_DO_ENVIO_SQL =
  `(case e.motivo when 'agente_caiu' then 'emergencia' when 'evento' then coalesce(r.severidade, 'atencao') `
  + `when 'computador' then ${doComputador('severidade', 'atencao')} else 'atencao' end)`;

/** A prioridade: a do evento vence a da regra (o agente sabe se aquela cena era urgente), como no despacho. */
export const PRIORIDADE_DO_ENVIO_SQL =
  `(case e.motivo when 'agente_caiu' then 'urgente' when 'evento' then coalesce(ev.prioridade, r.prioridade, 'intermediaria') `
  + `when 'computador' then ${doComputador('prioridade', 'urgente')} else 'intermediaria' end)`;

/**
 * A ordem da fila: o agente caído antes de tudo (sem ele, nada da loja está sendo auditado), depois a gravidade, a
 * prioridade e a chegada. O `id` desempata, para a ordem não depender do plano do banco.
 */
export const ORDEM_DA_FILA_SQL =
  `(e.motivo = 'agente_caiu') desc, `
  + `array_position(array[${lista(ORDEM_DA_SEVERIDADE)}], ${SEVERIDADE_DO_ENVIO_SQL}) desc nulls last, `
  + `array_position(array[${lista(ORDEM_DA_PRIORIDADE)}], ${PRIORIDADE_DO_ENVIO_SQL}) desc nulls last, `
  + `e.criado_em, e.id`;

/** Uma linha da leitura do envio reivindicado (`rotas/alertas.ts`). */
export interface LinhaDoEnvio {
  id: string;
  motivo: string;
  payload: unknown;
  tentativas: number;
  loja_id: string | null;
  evento_id: string | null;
  destino_tipo: string;
  destino_endereco: string;
  segredo_ref: string | null;
  severidade: Severidade;
  prioridade: Prioridade;
  criado_em: Date | string;
  loja_nome: string | null;
  regem_loja_id: string | null;
  regra_nome: string | null;
  evento_motivo: string | null;
  ocorrido_em: Date | string | null;
  ponto_nome: string | null;
  zona_nome: string | null;
  zona_principal: boolean | null;
}

export interface Alerta {
  titulo: string;
  detalhe: string;
  severidade: Severidade;
  prioridade: Prioridade;
  /** O canal da câmera e, quando o critério é de um quadro marcado, o quadro. Nulo = não é de uma câmera. */
  onde: string | null;
  /** Quando aconteceu (ISO, UTC): o evento, o último sinal do agente, o começo do aviso da máquina. */
  ocorrido_em: string;
  loja: { id: string | null; nome: string | null; regem_loja_id: string | null };
  /** A mensagem pronta, em uma linha, para o transporte que só repassa texto. */
  texto: string;
}

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const textoDe = (v: unknown, max = 300): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim().replace(/\s+/g, ' ');
  return t ? t.slice(0, max) : null;
};
const iso = (v: Date | string | null | undefined): string | null => {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const comPonto = (t: string) => (/[.!?…]$/.test(t) ? t : `${t}.`);
const maiuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

const TITULO_DO_COMPUTADOR: Record<string, string> = {
  esquentando: 'O computador do Farol está esquentando',
  sobrecarregado: 'O computador do Farol está sobrecarregado',
  disco: 'O disco do computador do Farol está quase cheio',
};

/** O título e o detalhe de cada motivo. Motivo que o Farol não conhece mais sai com um texto que diz isso. */
function tituloEDetalhe(l: LinhaDoEnvio): { titulo: string; detalhe: string; quando: string | null } {
  const p = ehObjeto(l.payload) ? l.payload : {};
  if (l.motivo === 'evento') {
    return {
      titulo: textoDe(l.regra_nome, 120) ?? 'Um critério ficou fora do combinado',
      detalhe: comPonto(maiuscula(textoDe(l.evento_motivo) ?? 'o critério ficou fora do combinado')),
      quando: iso(l.ocorrido_em),
    };
  }
  if (l.motivo === 'agente_caiu') {
    const agente = textoDe(p.agente, 80);
    const consequencia = textoDe(p.consequencia) ?? 'esta loja não está sendo auditada';
    return {
      titulo: 'O Farol parou de auditar esta loja',
      detalhe: `${agente ? `O agente "${agente}" parou de mandar sinal` : 'O agente parou de mandar sinal'}: ${comPonto(consequencia)}`,
      quando: iso(textoDe(p.desde)),
    };
  }
  if (l.motivo === 'computador') {
    const tipo = textoDe(p.tipo, 40) ?? '';
    const porque = Array.isArray(p.porque) ? p.porque.map((x) => textoDe(x)).filter((x): x is string => !!x) : [];
    const consequencia = textoDe(p.consequencia);
    const partes = [porque.length ? comPonto(maiuscula(porque.join('; '))) : null, consequencia ? comPonto(maiuscula(consequencia)) : null];
    return {
      titulo: TITULO_DO_COMPUTADOR[tipo] ?? 'O computador do Farol pede atenção',
      detalhe: partes.filter(Boolean).join(' ') || 'Veja no console: Computador da loja › Saúde.',
      quando: iso(textoDe(p.desde)),
    };
  }
  return { titulo: 'Aviso do Farol', detalhe: `Aviso do tipo "${l.motivo}".`, quando: null };
}

/** O alerta de um envio reivindicado. */
export function alertaDoEnvio(l: LinhaDoEnvio): Alerta {
  const { titulo, detalhe, quando } = tituloEDetalhe(l);
  const ponto = textoDe(l.ponto_nome, 80);
  const zona = textoDe(l.zona_nome, 80);
  const onde = ponto && zona && l.zona_principal === false ? `${ponto} › ${zona}` : ponto;
  const loja = textoDe(l.loja_nome, 120);
  const p = ehObjeto(l.payload) ? l.payload : {};
  // O aviso da máquina já traz a mensagem pronta (`textoDoAviso`); os outros a ganham aqui, no mesmo formato.
  const pronto = l.motivo === 'computador' ? textoDe(p.texto, 1000) : null;
  return {
    titulo,
    detalhe,
    severidade: l.severidade,
    prioridade: l.prioridade,
    onde,
    ocorrido_em: quando ?? iso(l.criado_em) ?? new Date(0).toISOString(),
    loja: { id: l.loja_id, nome: loja, regem_loja_id: l.regem_loja_id },
    texto: pronto ?? `Farol · ${loja ?? 'loja'}: ${titulo}${onde ? ` (${onde})` : ''}. ${detalhe}`,
  };
}

/** O que sai na reivindicação, por envio: os campos de sempre e o `alerta`. */
export function envioReivindicado(l: LinhaDoEnvio) {
  return {
    id: l.id,
    motivo: l.motivo,
    payload: l.payload,
    tentativas: l.tentativas,
    loja_id: l.loja_id,
    evento_id: l.evento_id,
    destino_tipo: l.destino_tipo,
    destino_endereco: l.destino_endereco,
    segredo_ref: l.segredo_ref,
    alerta: alertaDoEnvio(l),
  };
}
