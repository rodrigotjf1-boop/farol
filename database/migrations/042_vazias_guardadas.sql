-- =====================================================================
-- Farol · migration 042 — a resposta vazia guardada, contada à parte
-- =====================================================================
-- A20, fatia 1.3. Decisão do dono (12/10/2026): da cena de impressão
-- idêntica guarda-se só a resposta vazia ("não deu para avaliar"), por
-- duas horas. Quando a cena de uma olhada é idêntica a uma que a nuvem
-- acabou de não conseguir avaliar — duas vezes seguidas —, o agente não
-- paga para ouvir o mesmo de novo.
--
-- Essa olhada é uma "já julgada", e continua contada em `ja_julgadas`. O
-- que entra aqui é a marca de QUANTAS das "já julgadas" foram seguradas
-- pela resposta vazia guardada:
--
--   vazias_guardadas <= ja_julgadas
--
-- Fica à parte porque muda uma conta: para dizer em quantas olhadas o
-- critério não pôde ser avaliado naquele canal, a vazia guardada conta
-- junto com `nao_avaliaveis`. Sem ela, o canal em que a nuvem nunca
-- consegue avaliar passaria a mostrar duas análises por vez no lugar de
-- cento e vinte por hora, e o sinal "não conseguiu avaliar" demoraria
-- horas para aparecer.
--
--   não pôde avaliar  = nao_avaliaveis + vazias_guardadas
--   foi perguntado    = conformes + nao_conformes + nao_avaliaveis
--                       + vazias_guardadas
--
-- Agente antigo não manda o campo, e a linha fica com zero — que é a
-- verdade: ele não guardava resposta.
--
-- Nenhuma linha existente é atualizada. Idempotente: pode rodar de novo
-- sem efeito.
-- =====================================================================

alter table resumo_hora
  add column if not exists vazias_guardadas integer not null default 0 check (vazias_guardadas >= 0);

comment on column resumo_hora.vazias_guardadas is
  'Quantas das olhadas "já julgadas" desta hora foram seguradas pela resposta '
  'vazia guardada: a cena era idêntica a uma que a nuvem não conseguiu '
  'avaliar há pouco, e não foi paga de novo. Já estão dentro de ja_julgadas.';
