-- =====================================================================
-- Farol · migration 019 — mais de uma área por canal
-- =====================================================================
-- Pedido do dono (07/10/2026), com os critérios da primeira loja de
-- verdade na mão: a mesma câmera do caixa precisa conferir PRESENÇA dentro
-- do balcão e FILA do lado do cliente. "Cada área pode ter seu critério
-- diferente; o critério, mesmo sendo no canal, fica destinado à área
-- marcada quando houver mais de uma."
--
-- O banco já aceitava várias áreas por canal desde a 001, e o critério já
-- aponta para ÁREAS desde a 012 (`regra_alvo`). Faltava poder criar a
-- segunda área — e poder excluir uma sem perder o que ela registrou.
--
-- ## Excluir é marcar
--
-- `resumo_hora.zona_id` é `on delete cascade`. Apagar a linha da área
-- levaria junto tudo o que foi contado nela — e a tela promete que "o que
-- já foi registrado continua no histórico". Então a área excluída fica na
-- tabela, marcada, como já acontece com canal e critério (migration 014).
--
-- O que DEIXA de existir quando se exclui é o vínculo: as linhas de
-- `regra_alvo` daquela área são apagadas, e é isso que tira os critérios
-- dela. Por isso quem lê critério por `regra_alvo` não precisa de filtro;
-- quem lista ÁREAS precisa de `excluida_em is null`.
--
-- ## Nome único no canal
--
-- Duas áreas "Balcão" na mesma câmera deixariam a tela de critérios e o
-- painel dizendo "Balcão" duas vezes, sem dizer qual. O índice vale só
-- entre as que existem: excluída a área, o nome fica livre.
-- =====================================================================

alter table zona
  add column if not exists excluida_em  timestamptz,
  add column if not exists excluida_por uuid references usuario(id) on delete set null;

comment on column zona.excluida_em is
  'Quando a área foi excluída pelo console. Nulo = existe. A linha nunca é apagada: o resumo por hora aponta para ela.';

-- Até aqui cada canal tinha uma área só, então não há nome repetido. Se
-- houver (banco de teste, mão no banco), o segundo ganha um número — sem
-- isto o índice abaixo falharia e a migration pararia o deploy.
with repetidas as (
  select id,
         row_number() over (partition by ponto_id, lower(nome) order by principal desc, criado_em, id) as n
    from zona
   where excluida_em is null
)
update zona z
   set nome = z.nome || ' ' || r.n
  from repetidas r
 where r.id = z.id and r.n > 1;

create unique index if not exists zona_nome_por_ponto_uk
  on zona (ponto_id, lower(nome))
  where excluida_em is null;
