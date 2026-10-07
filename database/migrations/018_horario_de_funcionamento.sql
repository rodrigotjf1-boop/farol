-- =====================================================================
-- Farol · migration 018 — horário de funcionamento da loja
-- =====================================================================
-- Pedido do dono (07/10/2026): "colocar horário de funcionamento da loja.
-- opção de classificar quais análises são feitas no horário e quais são
-- feitas fora do horário".
--
-- Na primeira loja de verdade os critérios de presença e de fila rodaram
-- com a casa fechada e acusaram a falta de gente: oito avisos falsos em
-- minutos. E os de nuvem foram julgados uma vez por minuto para responder
-- "não há ninguém" — custo sem pergunta.
--
-- ## O horário é DA LOJA; o critério só diz de que lado fica
--
-- `loja.horario_funcionamento` guarda quando a loja abre. Cada critério
-- diz em `regra.quando` se é conferido com ela aberta, fechada ou sempre.
-- Mudou o horário da loja, mudou para todos os critérios — ninguém edita
-- vinte critérios porque a sexta passou a fechar à uma.
--
-- O formato é o mesmo de `regra.janelas`:
--
--   [{"dias":[2,3,4,7],"hora_ini":"18:00","hora_fim":"23:30"},
--    {"dias":[5,6],     "hora_ini":"18:00","hora_fim":"01:00"}]
--
--   dias: 1 = segunda … 7 = domingo. `hora_fim` menor ou igual a
--   `hora_ini` quer dizer que fecha no DIA SEGUINTE — e a madrugada
--   pertence ao dia em que a loja abriu.
--
-- ## Lista vazia = sempre aberta
--
-- É o comportamento de até aqui. Loja que não informa horário continua
-- sendo auditada o tempo todo, e critério "no horário" roda sempre. Um
-- critério "fora do horário" numa loja sem horário não roda nunca — ela
-- nunca está fechada — e o console diz isso.
--
-- ## O padrão é "no horário"
--
-- Quase todo critério é de operação: bancada, touca, fila, presença.
-- Quem quer vigiar a casa fechada marca "fora do horário"; quem quer as
-- duas coisas marca "sempre". Os critérios que já existem ficam "no
-- horário" — nas lojas sem horário informado nada muda para eles.
--
-- O agente antigo ignora os dois campos e segue como estava.
-- =====================================================================

alter table loja
  add column if not exists horario_funcionamento jsonb not null default '[]'::jsonb;

comment on column loja.horario_funcionamento is
  'Quando a loja abre: [{dias:[1..7], hora_ini:''HH:MM'', hora_fim:''HH:MM''}]. '
  'Vazio = sempre aberta. hora_fim <= hora_ini = fecha no dia seguinte.';

alter table regra
  add column if not exists quando text not null default 'no_horario';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'regra_quando_ck' and conrelid = 'regra'::regclass
  ) then
    alter table regra
      add constraint regra_quando_ck
      check (quando in ('no_horario', 'fora_do_horario', 'sempre'));
  end if;
end $$;

comment on column regra.quando is
  'Em que horário o critério é conferido, em relação ao horário DA LOJA: '
  'no_horario (aberta), fora_do_horario (fechada) ou sempre.';
