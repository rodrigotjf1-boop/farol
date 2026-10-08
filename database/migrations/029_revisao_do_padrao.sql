-- =====================================================================
-- Farol · migration 029 — o que o responsável respondeu às saídas do padrão
-- =====================================================================
-- A16, fase 5. Pedido do dono (07/10/2026): "o que saiu do padrão, para
-- análise e correção do responsável pela loja — as correções servem para
-- aprimorar ou até criar critérios".
--
-- O padrão de funcionamento NÃO é guardado: ele é refeito dos números de
-- `resumo_hora` cada vez que a tela abre (a conta está em
-- `api/src/especialista.ts`). O que se guarda aqui é só o que uma pessoa
-- disse sobre uma hora que fugiu dele:
--
--   esperado  "acontece sempre neste dia e hora" (o padrão passa a contar
--             com isso) ou "foi só desta vez" (`so_desta_vez`: a hora fica
--             de fora da conta do padrão);
--   problema  o que houve e o que foi feito. A hora também fica de fora da
--             conta: problema que se repete não pode virar o normal.
--
-- A chave é a hora de UM indicador: o critério, a área, o que se olha
-- (`medida`, `fora` do critério ou `na` — sem conseguir avaliar), o dia da
-- OPERAÇÃO (a madrugada pertence à noite anterior: o dia vira às 6h) e a
-- hora do relógio da loja. Uma resposta por hora: a segunda é recusada
-- (índice único), e não escrita por cima da primeira.
--
-- Critério ou área excluídos levam as respostas junto: sem eles a hora não
-- volta a ser apontada.
--
-- Idempotente: pode rodar de novo sem efeito.
-- =====================================================================

create table if not exists padrao_revisao (
  id              uuid primary key default gen_random_uuid(),
  loja_id         uuid not null references loja(id) on delete cascade,
  regra_id        uuid not null references regra(id) on delete cascade,
  zona_id         uuid not null references zona(id) on delete cascade,
  indicador       text not null check (indicador in ('medida', 'fora', 'na')),
  -- o dia da operação e a hora do relógio da loja
  dia             date not null,
  hora            smallint not null check (hora between 0 and 23),
  estado          text not null check (estado in ('esperado', 'problema')),
  so_desta_vez    boolean not null default false,
  -- "era esperado": a anotação, opcional
  nota            text not null default '' check (length(nota) <= 1000),
  -- "é problema": o que houve e o que foi feito
  o_que_houve     text not null default '' check (length(o_que_houve) <= 1000),
  o_que_foi_feito text not null default '' check (length(o_que_foi_feito) <= 1000),
  -- no que a correção deu: "Propôs o critério …", "Abriu … para ajuste"
  virou           text check (virou is null or length(virou) <= 300),
  criado_por      uuid references usuario(id) on delete set null,
  criado_em       timestamptz not null default now(),
  -- problema sem dizer o que houve e o que foi feito não é correção
  check (estado = 'esperado' or (btrim(o_que_houve) <> '' and btrim(o_que_foi_feito) <> '')),
  -- "foi só desta vez" é um jeito de ser esperado
  check (not so_desta_vez or estado = 'esperado')
);

-- Uma resposta por hora de cada indicador.
create unique index if not exists padrao_revisao_hora_uq
  on padrao_revisao (loja_id, regra_id, zona_id, indicador, dia, hora);

comment on table padrao_revisao is
  'O que o responsável respondeu a uma hora que fugiu do padrão: era '
  'esperado (sempre, ou só daquela vez) ou é problema (com a correção). O '
  'padrão em si não é guardado: é refeito de resumo_hora.';
