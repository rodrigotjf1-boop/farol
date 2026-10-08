-- =====================================================================
-- Farol · migration 022 — a medida de cada olhada, por hora
-- =====================================================================
-- Pedido do dono em 07/10/2026: "um motor de análise analítica para
-- determinar padrões — com uma semana de uso verificar as análises e ir
-- criando um padrão de funcionamento, e liberar descrição de funcionamento
-- por setor; e o que saiu do padrão em alguns momentos, para análise e
-- correção do responsável pela loja".
--
-- Padrão não sai de veredito. "Conforme", com a regra pedindo "pelo menos
-- uma pessoa no balcão", não diz se havia uma ou quatro; e "fora do
-- critério" na fila não diz se eram cinco ou doze. O que descreve o
-- funcionamento de um setor é o NÚMERO medido em cada olhada.
--
-- O detector, na loja, já conta: "vi 2 pessoas". Estas três colunas
-- guardam, por hora, critério e área, a soma e a quantidade dessas
-- medidas (para a média) e o maior valor. Com uma semana disso dá para
-- dizer "às quintas, das 19h às 20h, o balcão tem 2 pessoas em média e
-- nunca menos de 1" — e apontar a hora que saiu disso.
--
--   com_medida <= conformes + nao_conformes + nao_avaliaveis
--
-- Juiz que não mede (a nuvem julgando "uniforme completo") não entra na
-- quantidade: "não medi" não é zero. Hora sem medida tem `max_medida`
-- NULO; hora em que só se viu zero tem `max_medida` ZERO — são coisas
-- diferentes, e a leitura precisa das duas.
--
-- Começa a contar no dia em que o agente da loja for atualizado: a semana
-- de dados que o padrão precisa corre a partir daí. Agente antigo não
-- manda os campos, e a linha fica sem medida.
-- =====================================================================

alter table resumo_hora
  add column if not exists soma_medida numeric(14,2) not null default 0 check (soma_medida >= 0);

alter table resumo_hora
  add column if not exists com_medida integer not null default 0 check (com_medida >= 0);

alter table resumo_hora
  add column if not exists max_medida numeric(10,2) check (max_medida >= 0);

comment on column resumo_hora.soma_medida is
  'Soma do que o juiz mediu nas cenas desta hora (o detector: quantos '
  'objetos viu com certeza). Com `com_medida`, dá a média da hora.';
comment on column resumo_hora.com_medida is
  'Quantos julgamentos desta hora trouxeram medida. Juiz que não mede não '
  'entra aqui — "não medi" não é zero.';
comment on column resumo_hora.max_medida is
  'O maior valor medido na hora. Nulo = nada foi medido; zero = mediu e '
  'só viu zero.';
