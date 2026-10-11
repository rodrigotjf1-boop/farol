-- =====================================================================
-- Farol · migration 037 — a base de fichas da loja e a leitura do Regem
-- =====================================================================
-- "Regem no Farol", fatia 2 (plano aprovado pelo dono em 11/10/2026): o
-- servidor lê do Regem o cardápio e as fichas de cada loja ligada e guarda
-- a cópia NO FORMATO DO FAROL — é dela que a tela Fichas vive e, na fatia
-- seguinte, é ela que desce para o agente.
--
-- Duas coisas entram:
--
--   1. `fichas_da_loja` — a base de fichas, UMA linha por loja, com o
--      documento inteiro. Ele é trocado inteiro quando muda: não existe
--      "meia base". Não tem preço, custo nem cliente — a fonte nem manda;
--   2. o estado da leitura, em `regem_loja` (a conexão é quem lê): quando
--      leu, quando tentou, por que falhou, quando tenta de novo, e quando o
--      Regem tirou o acesso.
--
-- Decisões do dono que o banco guarda:
--
--   • "ao desconectar, as fichas são apagadas na hora" — e, pela mesma
--     regra, quando o acesso é tirado pelo Regem. Quem apaga é o servidor,
--     junto com a conexão; aqui, apagar a LOJA leva a base junto;
--   • "ficha técnica não é algo que se mude constantemente" — a leitura é
--     ao ligar a loja, uma vez por dia e a pedido. `proxima_em` é a agenda.
--
-- Nenhuma linha que já existe é alterada: as colunas novas nascem vazias,
-- e loja ligada com `proxima_em` vazio é lida na primeira volta da rotina.
--
-- Idempotente: pode rodar de novo sem efeito.
-- =====================================================================

create table if not exists fichas_da_loja (
  loja_id       uuid primary key references loja(id) on delete cascade,
  tenant_id     uuid        not null references tenant(id) on delete cascade,
  -- De onde veio. Hoje só o Regem; a planilha e outros sistemas entram aqui.
  fonte         text        not null,
  -- O documento, no formato do Farol (`api/src/fichas.ts`).
  conteudo      jsonb       not null,
  -- A impressão (sha256) do documento: é por ela que se sabe se mudou.
  impressao     text        not null,
  produtos      integer     not null,
  com_ficha     integer     not null,
  -- Quando o DOCUMENTO mudou pela última vez (não quando foi lido).
  atualizada_em timestamptz not null default now()
);

alter table fichas_da_loja drop constraint if exists fichas_da_loja_fonte_conhecida;
alter table fichas_da_loja add constraint fichas_da_loja_fonte_conhecida
  check (fonte in ('regem'));

create index if not exists fichas_da_loja_tenant_idx on fichas_da_loja (tenant_id);

-- O estado da leitura, na conexão de cada loja.
alter table regem_loja add column if not exists versao_catalogo  text;
alter table regem_loja add column if not exists versao_fichas    text;
-- A última leitura que DEU CERTO (com mudança ou sem).
alter table regem_loja add column if not exists lida_em          timestamptz;
alter table regem_loja add column if not exists tentada_em       timestamptz;
-- Por que a última tentativa falhou. Vazio = deu certo (ou nunca tentou).
alter table regem_loja add column if not exists falha            text;
-- O Regem respondeu que o acesso não vale mais: a base foi apagada, e a
-- loja espera alguém conectar de novo.
alter table regem_loja add column if not exists acesso_tirado_em timestamptz;
-- A agenda: quando a rotina lê esta loja de novo. Vazio = na próxima volta.
alter table regem_loja add column if not exists proxima_em       timestamptz;
-- Uma leitura em curso. Evita duas ao mesmo tempo (duas réplicas, ou a
-- rotina e o "Buscar agora"); leitura que morreu no meio solta em minutos.
alter table regem_loja add column if not exists lendo_desde      timestamptz;

alter table regem_loja drop constraint if exists regem_loja_falha_conhecida;
alter table regem_loja add constraint regem_loja_falha_conhecida
  check (falha is null or falha in ('sem_resposta', 'recusado', 'resposta_torta', 'acesso_ilegivel'));

-- A rotina procura por aqui: só as lojas ligadas e com o acesso de pé.
create index if not exists regem_loja_agenda_idx
  on regem_loja (proxima_em nulls first)
  where loja_id is not null and acesso_tirado_em is null;

comment on table fichas_da_loja is
  'A base de fichas da loja no formato do Farol: o que ela vende e do que '
  'cada produto é feito. Um documento por loja, trocado inteiro quando muda. '
  'Sem preço, custo nem cliente.';
comment on column regem_loja.acesso_tirado_em is
  'O Regem respondeu que o acesso não vale mais. A base de fichas da loja '
  'foi apagada nesse instante; a linha fica até alguém conectar de novo.';
comment on column regem_loja.proxima_em is
  'Quando a rotina lê esta loja de novo. Vazio = na próxima volta. A leitura '
  'é ao ligar, uma vez por dia e a pedido — nunca de minutos em minutos.';
