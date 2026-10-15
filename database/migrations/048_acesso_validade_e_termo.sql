-- =====================================================================
-- Farol · migration 048 — o acesso de outro sistema no Padrão DMS, parte 2
-- =====================================================================
-- Protótipo aprovado pelo dono em 15/10/2026 ("aprovado"), pelas regras do
-- acesso próprio do Padrão DMS (§2.4, aprovadas em 14/10/2026):
--
--   • o código VALE 12 MESES (`vence_em`), com aviso 15 dias antes;
--   • RENOVAR troca o código: o novo entra em `token_hash`, e o de antes
--     passa a `token_hash_anterior`, valendo até `anterior_vale_ate` (7
--     dias) — o tempo de trocar no sistema. Renovar o vencido não deixa
--     código antigo valendo;
--   • 90 DIAS SEM USO, fica suspenso. "Uso" é qualquer chamada aceita na
--     porta (`ultimo_uso_em`); reativar (`reativado_em`) conta como uso.
--     Suspenso e vencido NÃO apagam as fichas: só revogar apaga;
--   • quem cria confirma a senha e aceita o TERMO de uso do acesso; a
--     versão do texto fica guardada (`termo_versao`, `termo_aceito_em`);
--   • os outros da diretoria veem um aviso do que alguém fez nos acessos
--     (criou, renovou, reativou, revogou — tirado das colunas de cada um);
--     `usuario.acessos_vistos_em` guarda até quando a pessoa já viu.
--
-- Os acessos que já existem passam a vencer 12 meses depois de criados, e
-- o último uso deles é o último envio (ou a criação, se nunca enviaram).
-- Nenhum vence nem é suspenso por esta migration: a porta abriu em
-- 11/10/2026.
--
-- Idempotente: pode rodar de novo sem efeito.
-- =====================================================================

alter table acesso_externo add column if not exists vence_em timestamptz;
alter table acesso_externo add column if not exists ultimo_uso_em timestamptz;
alter table acesso_externo add column if not exists termo_versao text;
alter table acesso_externo add column if not exists termo_aceito_em timestamptz;
alter table acesso_externo add column if not exists renovado_em timestamptz;
alter table acesso_externo add column if not exists renovado_por uuid references usuario(id) on delete set null;
alter table acesso_externo add column if not exists reativado_em timestamptz;
alter table acesso_externo add column if not exists reativado_por uuid references usuario(id) on delete set null;
alter table acesso_externo add column if not exists token_hash_anterior text;
alter table acesso_externo add column if not exists anterior_vale_ate timestamptz;

update acesso_externo set vence_em = criado_em + interval '12 months' where vence_em is null;
update acesso_externo set ultimo_uso_em = coalesce(recebido_em, criado_em) where ultimo_uso_em is null;

alter table acesso_externo alter column vence_em set default (now() + interval '12 months');
alter table acesso_externo alter column vence_em set not null;

-- O código de antes da troca também é procurado pela impressão: um índice, e nunca repetido.
create unique index if not exists acesso_externo_token_anterior_uk
  on acesso_externo (token_hash_anterior) where token_hash_anterior is not null;

alter table usuario add column if not exists acessos_vistos_em timestamptz;

comment on column acesso_externo.vence_em is
  'Até quando o código vale (12 meses desde a criação ou a última renovação). '
  'Vencido, a porta responde chave-vencida; as fichas ficam.';
comment on column acesso_externo.ultimo_uso_em is
  'A última chamada aceita na porta (anotada no máximo uma vez por hora). '
  '90 dias sem uso, nem reativação, e o acesso fica suspenso.';
comment on column acesso_externo.token_hash_anterior is
  'A impressão do código de antes da renovação, que ainda vale até '
  'anterior_vale_ate (7 dias), para dar tempo de trocar no sistema.';
comment on column acesso_externo.termo_versao is
  'A versão do termo de uso do acesso que quem criou aceitou.';
comment on column usuario.acessos_vistos_em is
  'Até quando a pessoa já viu os avisos do que os outros da diretoria fizeram '
  'nos acessos de outro sistema (Conexões).';
