-- =====================================================================
-- Farol · migration 040 — as fichas por planilha
-- =====================================================================
-- Pedido do dono em 11/10/2026: importar as fichas por planilha (Excel),
-- com o modelo de colunas à mão do usuário. É o que faz o Farol servir a
-- quem não usa o Regem — o produto é para distribuição.
--
-- A base de fichas é a mesma (`fichas_da_loja`, um documento por loja, no
-- formato do Farol). O que muda:
--
--   1. a ORIGEM passa a poder ser `planilha`, além de `regem`. Uma loja
--      recebe as fichas de um lugar só: quem garante é a API (loja ligada
--      ao Regem não importa planilha);
--   2. `importacao` — o registro da ÚLTIMA importação: o nome do arquivo,
--      quando, quem, as contas e o que ficou de fora, com o motivo de cada
--      linha. Decisão do dono (11/10): "entra o que está certo e a tela
--      lista o que ficou de fora" — a lista tem de continuar à mão depois
--      de importar. Vazio quando a base veio do Regem.
--
-- Nenhuma linha que já existe é alterada: toda base de hoje é `regem`, e a
-- coluna nova nasce vazia.
--
-- Idempotente: pode rodar de novo sem efeito.
-- =====================================================================

alter table fichas_da_loja drop constraint if exists fichas_da_loja_fonte_conhecida;
alter table fichas_da_loja add constraint fichas_da_loja_fonte_conhecida
  check (fonte in ('regem', 'planilha'));

alter table fichas_da_loja add column if not exists importacao jsonb;

comment on column fichas_da_loja.fonte is
  'De onde a base veio: regem (lida do Regem) ou planilha (importada). Uma '
  'loja recebe as fichas de um lugar só.';
comment on column fichas_da_loja.importacao is
  'O registro da última importação por planilha: arquivo, quando, quem, as '
  'contas e o que ficou de fora, com o motivo. Vazio quando a base é do Regem.';
