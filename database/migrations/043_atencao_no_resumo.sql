-- =====================================================================
-- Farol · migration 043 — o que a atenção conta em cada quadro
-- =====================================================================
-- A20, fatia 1.2a. Aprovada pelo dono em 12/10/2026: "aprovo as duas
-- partes: contar primeiro, agir depois de uma semana de números".
--
-- A olhada de rotina, de 30 em 30 segundos, quase sempre acha que "algo
-- mudou" e quase nunca vê o instante em que o quadro parou. O agente
-- passou a ler o fluxo menor de cada canal duas vezes por segundo e a
-- acompanhar o estado de cada quadro que tem critério:
--
--   repouso → ACORDOU (duas leituras seguidas com movimento) → em atividade
--   em atividade → ASSENTOU (cinco segundos medidos sem movimento) → repouso
--
-- **Por enquanto ele só conta.** Nada muda no que a loja faz. O que entra
-- aqui é a contagem, na linha do resumo de cada critério daquele quadro,
-- na hora em que o critério valia:
--
--   leituras       quantas leituras do quadro deram medida
--   com_movimento  em quantas havia movimento
--   claroes        em quantas a área inteira mudou de uma vez (a luz que
--                  acende, a câmera que troca para infravermelho): não
--                  contam como movimento nem como calma
--   acordou        quantas vezes o quadro acordou
--   assentou       quantas vezes o quadro assentou
--
--   com_movimento + claroes <= leituras
--
-- A conta é do QUADRO: dois critérios no mesmo quadro levam o mesmo
-- número, e ela não se soma entre critérios. É com ela, ao lado das
-- olhadas de hoje (`capturas`, `enfileiradas`), que se decide se os
-- gatilhos do estudo passam a sair dos estados do quadro.
--
-- Agente antigo não manda os campos, e a linha fica com zero — que é a
-- verdade: ele não lia.
--
-- Nenhuma linha existente é atualizada. Idempotente: pode rodar de novo
-- sem efeito.
-- =====================================================================

alter table resumo_hora
  add column if not exists leituras integer not null default 0 check (leituras >= 0);

alter table resumo_hora
  add column if not exists com_movimento integer not null default 0 check (com_movimento >= 0);

alter table resumo_hora
  add column if not exists claroes integer not null default 0 check (claroes >= 0);

alter table resumo_hora
  add column if not exists acordou integer not null default 0 check (acordou >= 0);

alter table resumo_hora
  add column if not exists assentou integer not null default 0 check (assentou >= 0);

comment on column resumo_hora.leituras is
  'A atenção do agente: quantas leituras do quadro deste critério deram medida '
  'nesta hora (duas por segundo, no fluxo menor). Não são olhadas.';
comment on column resumo_hora.com_movimento is
  'A atenção: em quantas das leituras havia movimento no quadro.';
comment on column resumo_hora.claroes is
  'A atenção: em quantas das leituras a área inteira mudou de uma vez. Não '
  'contam como movimento nem como calma.';
comment on column resumo_hora.acordou is
  'A atenção: quantas vezes o quadro acordou (duas leituras seguidas com '
  'movimento, a partir do repouso).';
comment on column resumo_hora.assentou is
  'A atenção: quantas vezes o quadro assentou (cinco segundos medidos sem '
  'movimento, depois de acordar).';
