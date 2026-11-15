-- =====================================================================
-- Farol · migration 063 — por qual via saiu o pedido de conexão com o Regem
-- =====================================================================
-- F6 do Hub DMS, plano "Clique Farol → Regem" (15/11/2026). O Farol passa a
-- poder conectar o Regem de dois jeitos: pela página de 01/10 ("Autorizar o
-- Farol", com o segredo do aplicativo) ou pelo CLIQUE do Padrão DMS (o
-- pedido empurrado e a troca com o token do DMS ID, a volta com o `iss` do
-- Regem). A volta precisa saber por qual dos dois o pedido saiu: a do clique
-- confere o `iss` e troca o código pela ligação de cada loja.
--
-- Só o PEDIDO ganha a coluna. O acesso de cada loja (`regem_loja`) diz a via
-- sozinho: a ligação do clique começa com `dms_lg_regem_`.
--
-- O pedido que já existe (vale 10 minutos) é da página de 01/10: o padrão.
--
-- Idempotente: pode rodar de novo sem efeito.
-- =====================================================================

alter table regem_pedido add column if not exists via text not null default 'chave';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'regem_pedido_via_ck') then
    alter table regem_pedido add constraint regem_pedido_via_ck check (via in ('chave', 'clique'));
  end if;
end $$;

comment on column regem_pedido.via is
  'Por onde o pedido saiu: chave = a página de 01/10 (segredo do aplicativo); '
  'clique = o Padrão DMS (token do DMS ID; a volta confere o iss do Regem).';
