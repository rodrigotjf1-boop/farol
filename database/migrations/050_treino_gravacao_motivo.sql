-- =====================================================================
-- Farol · migration 050 — a gravação de treino diz por que não deu certo
-- =====================================================================
-- A21, fatia T3: a gravação de treino criada no console (do que o gravador
-- já guardou, ou programada). Quem a lê é o computador da loja, que conta
-- o andamento à nuvem: lendo, pronta — ou falhou, e então a tela diz o
-- porquê ("o gravador não guarda mais esse horário"), em vez de só "falhou".
--
-- `motivo` é o texto curto que a loja manda junto com a falha. Nulo em
-- todas as outras situações. Nenhuma linha que já existia muda.
-- =====================================================================

alter table treino_gravacao add column if not exists motivo text;

alter table treino_gravacao drop constraint if exists treino_gravacao_motivo_cabe;
alter table treino_gravacao add constraint treino_gravacao_motivo_cabe
  check (motivo is null or char_length(btrim(motivo)) between 1 and 200);

comment on column treino_gravacao.motivo is
  'Por que a leitura da gravação não deu certo, como a loja contou (A21, fatia T3). Nulo fora da situação falhou.';
