-- =====================================================================
-- Farol · migration 016 — a importância de cada canal
-- =====================================================================
-- Pedido do dono (07/10/2026): classificar os canais "de acordo com a
-- importância e a quantidade de usos de análise".
--
-- A quantidade de usos se CALCULA — sai dos critérios que valem no canal.
-- A importância não: só quem conhece a loja sabe que a fritadeira importa
-- mais que o corredor. Por isso é um campo, e é o único desta migration.
--
--   critico   primeiro a ser resolvido quando o dinheiro não dá para tudo
--   normal    o padrão
--   baixo     por último
--
-- O orçamento usa isto para ORDENAR — o que vem primeiro na lista e nos
-- pacotes. Não muda o que o canal precisa: um canal crítico com um critério
-- de presença continua servindo com câmera básica.
-- =====================================================================

alter table ponto
  add column if not exists importancia text not null default 'normal'
    check (importancia in ('critico','normal','baixo'));

comment on column ponto.importancia is
  'O quanto este canal importa para a loja. Ordena o orçamento; não muda o requisito do canal.';
