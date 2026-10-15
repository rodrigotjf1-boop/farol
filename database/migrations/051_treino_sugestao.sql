-- =====================================================================
-- Farol · migration 051 — as sugestões para as fichas: o que quem
-- configura respondeu
-- =====================================================================
-- A21, fatia T6. Do protótipo aprovado pelo dono em 15/10/2026: o Farol
-- olha SÓ o que foi conferido e sugere onde a ficha pode estar diferente
-- do que a bancada faz — um nome para duas coisas, a quantidade, o que
-- entra e não está na ficha, o nome novo escrito na conferência. Ele não
-- muda a ficha: diz onde mudar. Quem configura a loja responde.
--
-- A sugestão em si é CALCULADA na hora, das conferências (muda quando
-- alguém confere mais). Aqui fica só a resposta, pela `chave` da
-- sugestão — o tipo, o produto e o ingrediente —, e um retrato do que ela
-- dizia quando foi respondida (`resumo`), para a resposta não mudar de
-- sentido se as conferências mudarem depois.
-- =====================================================================

create table if not exists treino_sugestao (
  id            uuid primary key default gen_random_uuid(),
  loja_id       uuid not null references loja(id) on delete cascade,
  chave         text not null check (char_length(chave) between 1 and 300),
  decisao       text not null check (decisao in ('sim', 'nao')),
  resumo        jsonb not null,
  decidido_por  uuid references usuario(id) on delete set null,
  decidido_em   timestamptz not null default now()
);
create unique index if not exists treino_sugestao_chave_uk on treino_sugestao (loja_id, chave);

comment on table treino_sugestao is
  'A resposta de quem configura a loja a uma sugestão para as fichas (A21, fatia T6). A sugestão é calculada das conferências; aqui fica a resposta, pela chave dela.';
comment on column treino_sugestao.decisao is
  'sim = vai mudar a ficha; nao = a ficha fica como está (cada sugestão diz o que cada resposta quer dizer).';
