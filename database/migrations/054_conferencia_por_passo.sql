-- =====================================================================
-- Farol · migration 054 — a conferência por passo: a noite ao vivo vira
-- gravação de treino, e o "não era ingrediente" vira exemplo
-- =====================================================================
-- A23.3. O protótipo "conferência por passo" foi aprovado pelo dono em
-- 20/10/2026, e em 21/10 ele perguntou: "esses erros estão saindo como
-- aprendizado para o agente?". Até aqui, não: o juiz de ingrediente da
-- leitura ao vivo (PR #197) lê cada passo do lanche, mas ninguém confere e
-- nada volta como exemplo.
--
--   • **treino_gravacao.origem** ganha `ao-vivo`: a noite da leitura ao vivo
--     de uma bancada (um canal, uma noite). Os lanches que a loja leu, com
--     os passos e o recorte de cada um, sobem depois do fechamento para
--     conferir — pelo mesmo caminho dos lanches da gravação de treino. Ela
--     nasce `pronta`: não há nada a buscar no gravador;
--
--   • **base_conhecimento.tipo** ganha `nada`: o recorte que a pessoa marcou
--     "não era ingrediente" (o inox, o alumínio do delivery, a tampa da
--     caixa, a mão) vira exemplo do que NÃO é ingrediente. Desce para a loja
--     à parte dos ingredientes, e o juiz dela aprende a separar.
--
-- Nenhuma linha que já existe muda: as restrições só ganham um valor.
-- Idempotente: pode rodar de novo sem efeito.
-- =====================================================================

alter table treino_gravacao drop constraint if exists treino_gravacao_origem_check;
alter table treino_gravacao add constraint treino_gravacao_origem_check
  check (origem in ('gravador', 'programada', 'carga', 'ao-vivo'));

alter table base_conhecimento drop constraint if exists base_conhecimento_tipo_check;
alter table base_conhecimento add constraint base_conhecimento_tipo_check
  check (tipo in ('item', 'padrao', 'fora', 'nada'));

comment on column treino_gravacao.origem is
  'De onde veio: do gravador, programada, a carga das leituras antigas, ou ao-vivo (a noite da leitura ao vivo de uma bancada, migration 054).';
