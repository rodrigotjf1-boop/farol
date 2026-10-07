-- =====================================================================
-- Farol · migration 014 — excluir critério e excluir canal
-- =====================================================================
-- Pedido do dono (07/10/2026): poder EXCLUIR um critério e um canal, além
-- de editar.
--
-- Até aqui não havia exclusão. Critério só saía "de um canal" (e ia para
-- "Sem canal" quando saía do último); canal só era desativado — e
-- continuava na tela, com o nome antigo, para sempre.
--
-- ## Excluir não é apagar a linha
--
-- Todo veredito gravado aponta para o critério que o produziu e para a
-- área onde aconteceu. Apagar a linha quebraria a pergunta que o produto
-- existe para responder daqui a seis meses: "o que foi auditado naquele
-- dia, e por qual critério?".
--
-- Então excluir é MARCAR. A linha fica; some das telas, da árvore de
-- canais e do que desce para o agente. O histórico continua com nome.
--
--   excluido_em / excluida_em   quando — nulo = está valendo
--   excluido_por / excluida_por quem — some com o usuário, o registro fica
--
-- ## Desativar continua existindo
--
-- `ponto.ativo = false` é PAUSAR: o canal fica na tela, marcado, com os
-- critérios guardados, e volta com um clique. Excluir é para o canal que
-- não existe mais (câmera trocada de lugar, cadastro errado).
-- =====================================================================

alter table ponto
  add column if not exists excluido_em  timestamptz,
  add column if not exists excluido_por uuid references usuario(id) on delete set null;

alter table regra
  add column if not exists excluida_em  timestamptz,
  add column if not exists excluida_por uuid references usuario(id) on delete set null;

comment on column ponto.excluido_em is
  'Quando o canal foi excluído pelo console. Nulo = existe. A linha nunca é apagada: o histórico aponta para ela.';
comment on column regra.excluida_em is
  'Quando o critério foi excluído pelo console. Nulo = existe. A linha nunca é apagada: os vereditos apontam para ela.';
