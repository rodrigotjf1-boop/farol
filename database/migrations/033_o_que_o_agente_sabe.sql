-- =====================================================================
-- Farol · migration 033 — o que o agente da loja sabe fazer
-- =====================================================================
-- A19, onda 1. Ao pedir a configuração, o agente declara o que sabe fazer
-- (`?sabe=estados,estudo,bancada`), e a nuvem só manda certas coisas para
-- quem declara (o critério que não está valendo, o estudo do critério).
-- Até aqui a declaração valia para aquele pedido e era esquecida.
--
-- **agente.sabe** guarda a última declaração; **agente.sabe_em**, quando
-- ela foi feita — que é também a última vez que o agente pediu a
-- configuração. Serve para duas coisas:
--
--   1. o console dizer se a loja já sabe lidar com o que foi configurado
--      ("o critério em observação ainda não chegou à loja: o agente de lá
--      é o antigo");
--   2. conferir, depois de trocar o pacote do agente, que o agente novo
--      pediu a configuração de novo sabendo mais.
--
-- `sabe_em` nulo = nunca pediu a configuração desde esta migration.
-- `sabe` vazio com `sabe_em` preenchido = pediu sem declarar nada (o
-- agente de antes dos estados).
--
-- Nada muda para quem já está no ar: a tabela `agente` não tem gatilho de
-- `config_versao`, e nenhum agente puxa configuração por causa disto.
--
-- Idempotente: pode rodar de novo sem efeito.
-- =====================================================================

alter table agente
  add column if not exists sabe text[] not null default '{}';

alter table agente
  add column if not exists sabe_em timestamptz;
