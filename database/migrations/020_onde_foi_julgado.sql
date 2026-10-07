-- =====================================================================
-- Farol · migration 020 — onde cada análise foi julgada
-- =====================================================================
-- Pedido do dono em 07/10/2026, vendo os números da primeira noite da loja:
-- "das análises, quais foram locais e quais foram nuvem", e o custo total e
-- médio das análises na nuvem dentro do período apresentado.
--
-- O `evento` já guarda a via de cada "fora do critério". O resumo por hora
-- — que é o que conta TUDO o que foi olhado — só tinha o total e o custo.
-- Estas duas colunas dizem quantos dos julgamentos concluídos da hora
-- foram feitos no computador da loja (detector, modelo local, comparação)
-- e quantos foram feitos na nuvem.
--
--   julgadas_loja + julgadas_nuvem <= conformes + nao_conformes + nao_avaliaveis
--
-- É "menor ou igual", e não "igual", de propósito:
--
--   - linha de antes desta versão tem zero nos dois lados;
--   - a hora em que o agente foi atualizado tem a conta pela metade.
--
-- NÃO há preenchimento retroativo aqui. O que falta para fechar a conta é
-- repartido NA LEITURA, pelo tipo do critério (presença, contagem e
-- comparação são julgados na loja; estado e ação, na nuvem) — que é o que
-- o serviço fazia até esta versão. Assim a coluna guarda só o que o agente
-- de fato informou, e a regra de repartir o resto mora num lugar só
-- (`api/src/analises.ts`), com teste.
--
-- Agente antigo não manda os dois campos: entram como zero e a leitura
-- reparte, do mesmo jeito.
-- =====================================================================

alter table resumo_hora
  add column if not exists julgadas_loja integer not null default 0 check (julgadas_loja >= 0);

alter table resumo_hora
  add column if not exists julgadas_nuvem integer not null default 0 check (julgadas_nuvem >= 0);

comment on column resumo_hora.julgadas_loja is
  'Julgamentos concluídos nesta hora no computador da loja (detector, modelo '
  'local, comparação). Zero em linha anterior à migration 020: o resto é '
  'repartido na leitura, pelo tipo do critério.';
comment on column resumo_hora.julgadas_nuvem is
  'Julgamentos concluídos nesta hora na nuvem — os únicos com custo por '
  'análise e com a imagem saindo da loja.';
