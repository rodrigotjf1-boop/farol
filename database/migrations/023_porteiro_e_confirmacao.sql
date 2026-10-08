-- =====================================================================
-- Farol · migration 023 — o porteiro e o "avisar só se continuar"
-- =====================================================================
-- Fase 1 do plano A16 ("local primeiro"). No primeiro dia inteiro de
-- operação de uma loja (07/10/2026), 94% do gasto com a nuvem voltou sem
-- veredito; no canal em que o detector também olhava, mais da metade das
-- perguntas foi feita SEM NINGUÉM NA IMAGEM. A loja sabia, de graça, que
-- não havia o que perguntar.
--
-- **regra.porteiro** — quando vale a pena conferir. Quem responde é o
-- detector, dentro da loja, antes de a imagem entrar na fila:
--
--   sempre     em toda olhada (como era)
--   pessoa     só com gente na área    (uniforme, touca, uso de equipamento)
--   livre      só com a área livre     (limpeza: gente na frente esconde)
--   movimento  só quando algo mudou    (ação: sem movimento não há o que julgar)
--
-- Só conta para o que pode ir à nuvem. Presença e contagem já são julgadas
-- na loja em toda olhada: a API não aceita porteiro nelas.
--
-- **regra.confirmar_em** — em quantas olhadas SEGUIDAS o critério tem de
-- ficar fora para virar aviso. 1 = avisa na primeira, como sempre foi.
-- Evita o aviso por algo que durou um instante.
--
-- **resumo_hora.sem_condicao** — as olhadas que o porteiro segurou. Não são
-- análise: não vão à nuvem, não custam, e não entram em "não deu para
-- avaliar". É o oitavo desfecho de uma olhada, ao lado de sem_quadro,
-- sem_cena, em_silencio, repetidas, ja_julgadas e enfileiradas.
--
-- A faixa de horas do critério não pede coluna: `regra.janelas` existe
-- desde a migration 001 e o agente já a respeita. Faltava só a tela.
--
-- Idempotente: pode rodar de novo sem efeito.
-- =====================================================================

alter table regra
  add column if not exists porteiro text not null default 'sempre'
    check (porteiro in ('sempre', 'pessoa', 'livre', 'movimento'));

alter table regra
  add column if not exists confirmar_em integer not null default 1
    check (confirmar_em between 1 and 10);

alter table resumo_hora
  add column if not exists sem_condicao integer not null default 0
    check (sem_condicao >= 0);

comment on column regra.porteiro is
  'Quando vale a pena conferir: sempre, pessoa (só com gente na área), '
  'livre (só com a área livre) ou movimento (só quando algo mudou). Quem '
  'responde é o detector, na loja, antes de perguntar à nuvem.';
comment on column regra.confirmar_em is
  'Em quantas olhadas seguidas o critério tem de ficar fora para virar '
  'aviso. 1 = na primeira.';
comment on column resumo_hora.sem_condicao is
  'Olhadas que o porteiro segurou: a condição do critério não valia '
  '(ninguém na área, gente na frente, nada se mexeu). Não foram à nuvem.';
