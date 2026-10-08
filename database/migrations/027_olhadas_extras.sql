-- =====================================================================
-- Farol · migration 027 — as olhadas extras do vigia, contadas à parte
-- =====================================================================
-- A16, fase 3. Entre uma olhada de rotina e outra (trinta segundos), o
-- agente passou a vigiar o fluxo menor do gravador: quando a contagem de
-- um critério de presença ou de contagem muda, ele olha AGORA aquele canal
-- em vez de esperar a rotina. É o que pega o que dura segundos.
--
-- A olhada extra é uma análise como as outras: entra em `conformes`,
-- `nao_conformes` e nos demais contadores da hora. Mas ela não cai num
-- instante qualquer — cai justamente quando algo mudou. Para dizer "em
-- quanto do tempo o posto ficou vazio", ou para comparar esta semana com
-- a anterior (quando o vigia não existia), é preciso saber quantas das
-- análises da hora foram extras:
--
--   rotina            = conformes + nao_conformes + nao_avaliaveis - extras
--   rotina fora       = nao_conformes - extras_fora
--
--   extras_fora <= extras <= conformes + nao_conformes + nao_avaliaveis
--   extras_fora <= nao_conformes
--
-- A média da medida (`soma_medida` / `com_medida`) já é só da rotina: o
-- agente não soma a medida da olhada extra. O maior valor (`max_medida`)
-- conta com ela.
--
-- Agente antigo não manda os campos, e a linha fica com zero — que é a
-- verdade: ele não fazia olhada extra.
-- =====================================================================

alter table resumo_hora
  add column if not exists extras integer not null default 0 check (extras >= 0);

alter table resumo_hora
  add column if not exists extras_fora integer not null default 0 check (extras_fora >= 0);

comment on column resumo_hora.extras is
  'Quantas das análises desta hora foram olhadas extras do vigia (feitas '
  'porque a contagem mudou entre duas olhadas de rotina). Já estão dentro '
  'de conformes + nao_conformes + nao_avaliaveis.';
comment on column resumo_hora.extras_fora is
  'Quantas das olhadas extras deram fora do critério. Já estão dentro de '
  'nao_conformes.';
