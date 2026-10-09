// =====================================================================
// O estado do critério — observar, ensaiar, medir, avisar
// =====================================================================
// Pedido do dono (A19, 08/10/2026): "nada de aplicar alterações antes de
// o projeto analisar de verdade os processos". Todo critério passa por
// quatro estados, e só o último avisa:
//
//   observando  só conta o que acontece. Não julga e não gasta.
//   ensaio      julga e mostra. Não avisa ninguém.
//   medido      como o ensaio, com o acerto medido à vista.
//   valendo     avisa.
//
// Ligado ou desligado continua sendo `regra.ativa`: o estado diz o que o
// critério LIGADO faz.
//
// **Quem escolhe o quê.** Uma pessoa leva o critério a "observando" e a
// "em ensaio" — e de volta, quantas vezes quiser: descer um degrau nunca
// é recusado. A "medido" e a "valendo" só se chega com o acerto medido, e
// quem mede é o banco de provas (onda 2). Até ele existir, nenhuma rota do
// console promove um critério: o que já avisava antes desta mudança
// continua valendo, e o que desceu não sobe à mão.
// =====================================================================

export const ESTADOS = ['observando', 'ensaio', 'medido', 'valendo'] as const;
export type Estado = (typeof ESTADOS)[number];

/** Os estados que uma pessoa escolhe. Os outros dois saem da medida. */
export const ESTADOS_QUE_SE_ESCOLHE: readonly string[] = ['observando', 'ensaio'];

/** O estado de todo critério que já existia, e de quem é criado pelo cadastro de hoje. */
export const ESTADO_DE_SEMPRE: Estado = 'valendo';

/**
 * O que o agente declara que sabe fazer (`?sabe=estados` ao pedir a
 * configuração). Agente que não declara nunca ouviu falar de estado: para
 * ele todo critério que desce AVISA. Por isso só lhe desce o que está
 * valendo.
 */
export const SABE_ESTADOS = 'estados';

const MAX_SABERES = 12;
const SABER = /^[a-z][a-z0-9_]{0,31}$/;

/** O que o agente disse que sabe, da query `sabe=a,b`. Valor torto é ignorado. */
export function lerSabe(bruto: unknown): Set<string> {
  if (typeof bruto !== 'string') return new Set();
  return new Set(bruto.split(',').map((s) => s.trim()).filter((s) => SABER.test(s)).slice(0, MAX_SABERES));
}

/**
 * O estado pedido cabe? Devolve o problema, ou `null`.
 *
 * `atual` é o estado de agora (`null` quando o critério está nascendo).
 * Pedir o estado em que o critério já está não muda nada, e por isso
 * passa — é o que a tela manda ao salvar sem mexer.
 */
export function estadoNaoCabe(novo: unknown, atual: string | null): { erro: string; mensagem: string } | null {
  if (novo == null) return null;
  if (typeof novo !== 'string' || !(ESTADOS as readonly string[]).includes(novo)) {
    return { erro: 'validacao', mensagem: `estado: um de ${ESTADOS.join(', ')}` };
  }
  if (novo === atual) return null;
  if (ESTADOS_QUE_SE_ESCOLHE.includes(novo)) return null;
  return {
    erro: 'so_com_medida',
    mensagem:
      `um critério só chega a "${novo}" com o acerto medido, pelo banco de provas. ` +
      'Daqui ele vai para "observando" ou "ensaio".',
  };
}
