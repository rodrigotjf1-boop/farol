-- =====================================================================
-- Farol · migration 041 — a porta para outro sistema
-- =====================================================================
-- Pedido do dono em 11/10/2026: o Farol é produto para distribuição, e a
-- operação que não usa o Regem tem de conseguir mandar as fichas dela por
-- uma porta documentada — com o acesso criado PELO PRÓPRIO USUÁRIO, no
-- console ("as integrações devem ser dinâmicas, feitas pelo usuário, e não
-- nós colocando tokens direto na API"). Protótipo aprovado no mesmo dia.
--
-- Duas coisas entram:
--
--   1. `acesso_externo` — o acesso que a diretoria cria para um sistema
--      enviar as fichas de UMA loja. O código de acesso aparece uma vez, na
--      hora em que é criado; aqui fica só a impressão dele (sha256). Quem lê
--      o banco não consegue enviar nada, e nem a distribuição consegue ver o
--      código de um acesso já criado. Revogar não apaga a linha: fica
--      registrado quem criou, quem revogou e quando;
--   2. a ORIGEM `sistema` em `fichas_da_loja`, além de `regem` e `planilha`.
--
-- Uma loja tem, no máximo, UM acesso valendo — a regra fica no banco. A
-- regra maior ("uma loja recebe as fichas de um lugar só": ou o Regem, ou
-- um sistema) é da API, que trava a loja enquanto confere.
--
-- Nenhuma linha que já existe é alterada.
--
-- Idempotente: pode rodar de novo sem efeito.
-- =====================================================================

create table if not exists acesso_externo (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid        not null references tenant(id) on delete cascade,
  -- O acesso vale para uma loja. Loja apagada leva o acesso junto.
  loja_id      uuid        not null references loja(id) on delete cascade,
  -- Como a conta chama o sistema. É o nome que a tela Fichas mostra.
  nome         text        not null,
  -- A impressão (sha256) do código de acesso. O código em si não é guardado.
  token_hash   text        not null,
  criado_por   uuid        references usuario(id) on delete set null,
  criado_em    timestamptz not null default now(),
  -- O último envio que o Farol aceitou (com mudança ou sem).
  recebido_em  timestamptz,
  -- Preenchido = o acesso não vale mais. A linha fica, como registro.
  revogado_em  timestamptz,
  revogado_por uuid        references usuario(id) on delete set null
);

alter table acesso_externo drop constraint if exists acesso_externo_nome_cabe;
alter table acesso_externo add constraint acesso_externo_nome_cabe
  check (char_length(nome) between 1 and 40);

-- É por aqui que a porta acha o acesso de quem chega. Dois acessos não têm
-- o mesmo código.
create unique index if not exists acesso_externo_token_uk on acesso_externo (token_hash);

-- Uma loja tem, no máximo, um acesso valendo.
create unique index if not exists acesso_externo_loja_uk on acesso_externo (loja_id) where revogado_em is null;

create index if not exists acesso_externo_tenant_idx on acesso_externo (tenant_id);

alter table fichas_da_loja drop constraint if exists fichas_da_loja_fonte_conhecida;
alter table fichas_da_loja add constraint fichas_da_loja_fonte_conhecida
  check (fonte in ('regem', 'planilha', 'sistema'));

comment on table acesso_externo is
  'O acesso que a diretoria cria para outro sistema enviar as fichas de uma '
  'loja. Só a impressão do código fica guardada; revogar preenche '
  'revogado_em e a linha fica como registro.';
comment on column acesso_externo.token_hash is
  'A impressão (sha256) do código de acesso. O código aparece uma vez, para '
  'quem o criou, e não é guardado.';
comment on column fichas_da_loja.fonte is
  'De onde a base veio: regem (lida do Regem), planilha (importada) ou '
  'sistema (enviada por outro sistema, pela porta). Uma loja recebe as '
  'fichas de um lugar só.';
comment on column fichas_da_loja.importacao is
  'O registro da última importação por planilha ou do último envio de outro '
  'sistema: quando, quem, as contas e o que ficou de fora, com o motivo. '
  'Vazio quando a base é do Regem.';
