-- =====================================================================
-- Farol · migration 031 — o estado do critério
-- =====================================================================
-- A19, onda 1, fatia 1.2. Pedido do dono (08/10/2026): "nada de aplicar
-- alterações antes de o projeto analisar de verdade os processos". Virado
-- método: todo critério passa por quatro estados, e só o último avisa.
--
--   observando  só conta o que acontece (as olhadas, o contexto). Não
--               julga e não gasta.
--   ensaio      julga e mostra. Não avisa ninguém.
--   medido      como o ensaio, com o acerto medido à vista. Quem leva um
--               critério até aqui é o banco de provas (onda 2).
--   valendo     avisa.
--
-- **regra.estado** nasce `valendo`, e é o que toda regra existente passa a
-- ter: os critérios de hoje ficam como estão — quem avisava continua
-- avisando. (Ligado ou desligado continua sendo `regra.ativa`: o estado
-- diz o que o critério LIGADO faz.) A tela nova é que vai criar critério
-- em "observando"; até ela existir, o cadastro de hoje cria como sempre.
--
-- **resumo_hora.observadas** — a olhada do critério que só observa: passou
-- pelo "quando vale a pena conferir" e parou ali, sem julgamento e sem
-- custo. É o nono desfecho de uma olhada, ao lado de sem_juiz, sem_quadro,
-- sem_cena, sem_condicao, em_silencio, repetidas, ja_julgadas e
-- enfileiradas.
--
-- Nada muda para quem já está no ar. Não há atualização de linha aqui: os
-- gatilhos de `config_versao` não disparam, e nenhum agente puxa
-- configuração por causa desta migration.
--
-- Idempotente: pode rodar de novo sem efeito.
-- =====================================================================

alter table regra
  add column if not exists estado text not null default 'valendo'
    check (estado in ('observando', 'ensaio', 'medido', 'valendo'));

alter table resumo_hora
  add column if not exists observadas integer not null default 0
    check (observadas >= 0);

comment on column regra.estado is
  'O que o critério LIGADO faz: observando (só conta), ensaio (julga, não '
  'avisa), medido (como o ensaio, com o acerto medido) ou valendo (avisa). '
  'Ligado ou desligado é regra.ativa.';
comment on column resumo_hora.observadas is
  'Olhadas de critério em "observando": passaram pelo contexto e pararam '
  'ali, sem julgamento e sem custo.';
