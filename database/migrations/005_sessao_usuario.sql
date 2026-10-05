-- =====================================================================
-- Farol · migration 005 — sessão de usuário
-- =====================================================================
-- Sessão com **token opaco guardado no banco**, não JWT.
--
-- JWT é conveniente e tem uma propriedade ruim para este produto: não dá
-- para revogar. Demitiu o gerente às 14h, o crachá dele continua abrindo
-- a porta até o token expirar. Num sistema cujo trabalho é auditar
-- pessoas, isso é inaceitável — e a volta (lista de revogados) acaba
-- sendo uma tabela no banco, que é o que teríamos feito desde o começo.
--
-- Guardamos só o **hash** do token. Vazamento do banco não dá sessão a
-- ninguém, e quem administra não consegue se passar por um usuário.
-- =====================================================================

create table if not exists sessao (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid        not null references usuario(id) on delete cascade,
  token_hash  text        not null,
  criada_em   timestamptz not null default now(),
  expira_em   timestamptz not null,
  -- Última vez que o token foi usado: é o que permite encerrar sessão
  -- ociosa sem derrubar quem está trabalhando.
  usada_em    timestamptz not null default now(),
  -- Proveniência, para o usuário poder ver "onde estou conectado" e
  -- encerrar o que não reconhece.
  ip          text,
  agente_http text,
  revogada_em timestamptz
);

create unique index if not exists sessao_token_uk on sessao (token_hash);

-- A consulta de toda requisição: achar a sessão viva pelo hash.
create index if not exists sessao_viva_idx
  on sessao (token_hash) where revogada_em is null;

create index if not exists sessao_usuario_idx
  on sessao (usuario_id, criada_em desc);

-- Troca de senha precisa derrubar as sessões abertas. Sem este campo,
-- quem roubou a senha continua dentro mesmo depois de ela ser trocada —
-- que é justamente o momento em que se quer expulsá-lo.
alter table usuario add column if not exists senha_trocada_em timestamptz;
alter table usuario add column if not exists ultimo_acesso_em timestamptz;

comment on table sessao is
  'sessão de console. Token opaco, guardado como hash; revogar é UPDATE.';
