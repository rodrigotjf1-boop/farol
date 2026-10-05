// =====================================================================
// Níveis de acesso
// =====================================================================
// A regra do projeto é dura e vale aqui: **RBAC no servidor, nunca no
// front**. A API não pode sequer devolver dado que o perfil não pode ver
// — esconder botão na tela é conforto, não controle.
//
// Hierarquia (a mesma do CHECK da migration 001):
//
//   presidente  > gerente > supervisao > execucao
//   suporte     — técnico da DISTRIBUIÇÃO, fora da hierarquia da loja
//
// `suporte` existe para quem instala e dá manutenção. Ele enxerga a
// configuração (pontos, câmeras, agentes) porque é o trabalho dele, mas
// **não é o dono do negócio** — e por isso não herda tudo do presidente.
// =====================================================================

import type { FastifyReply } from 'fastify';

import type { Sessao } from './rotas/sessao.js';

export const NIVEIS = ['execucao', 'supervisao', 'gerente', 'presidente'] as const;
export type Nivel = (typeof NIVEIS)[number] | 'suporte';

/** Posição na hierarquia. `suporte` fica fora e é tratado à parte. */
function posicao(nivel: string): number {
  const i = NIVEIS.indexOf(nivel as (typeof NIVEIS)[number]);
  return i < 0 ? -1 : i;
}

export function peloMenos(sessao: Sessao, minimo: (typeof NIVEIS)[number]): boolean {
  return posicao(sessao.nivel) >= posicao(minimo);
}

/** Quem pode mexer na configuração de câmeras, pontos e regras. */
export function podeConfigurar(sessao: Sessao): boolean {
  // Suporte configura porque é quem instala. Da hierarquia da loja, só
  // gerente para cima — supervisão acompanha a operação, não a monta.
  return sessao.nivel === 'suporte' || peloMenos(sessao, 'gerente');
}

export function exigirConfigurar(sessao: Sessao, resposta: FastifyReply): boolean {
  if (podeConfigurar(sessao)) return true;
  resposta.status(403).send({
    erro: 'sem_permissao',
    mensagem: 'seu perfil não pode alterar a configuração de pontos e câmeras',
  });
  return false;
}
