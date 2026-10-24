-- =====================================================================
-- Farol · migration 055 — marcar ingredientes: o recorte de um passo da
-- noite e a pilha que a pessoa marca
-- =====================================================================
-- A24, fase F3. O dono, 23/10/2026: "para treinamento inicial, antes de
-- associar com ficha, primeiro teríamos que treinar identificar
-- ingrediente como no teste de 112 [...] ali é um bom treinamento de
-- ingrediente". Protótipo "Marcar ingredientes" aprovado em 24/10/2026.
--
--   • **treino_recorte** — o recorte de UM passo de um lanche da noite ao
--     vivo, escolhido pela loja com a loja fechada (os de dúvida do juiz e
--     um pouco de cada ingrediente). Fica na gravação `ao-vivo` daquela
--     noite, a mesma dos lanches da conferência. `chave` é o nome que a
--     loja dá ao recorte: mandar de novo o mesmo recorte não cria outro, e
--     o que alguém já marcou não muda por baixo. A pessoa marca a pilha que
--     a câmera vê, de cima para baixo (`resposta`), ou diz "não é
--     ingrediente" ou "não dá para ver"; `cima` é o nome do de cima da
--     pilha, e `acertou`, se o juiz tinha dito esse nome. A imagem sai 30
--     dias depois da marcação (a rotina da API apaga; a linha fica, para a
--     conta do acerto); o recorte que ninguém marcou sai inteiro em 30 dias;
--
--   • **base_frame.recorte_id** — o exemplo que a marcação criou (origem
--     `bancada`, a mesma da conferência: desce para a loja pelo caminho de
--     sempre). Marcar de novo troca o exemplo daquele recorte.
--
-- Nenhuma linha que já existe muda: a tabela é nova e a coluna nova de
-- `base_frame` nasce nula.
-- Idempotente: pode rodar de novo sem efeito.
-- =====================================================================

create table if not exists treino_recorte (
  id           uuid primary key default gen_random_uuid(),
  gravacao_id  uuid not null references treino_gravacao(id) on delete cascade,
  loja_id      uuid not null references loja(id) on delete cascade,
  chave        text not null check (char_length(chave) between 1 and 160),
  -- a pasta do lanche no computador da loja ("passos-21h39m05-3"), para juntar os recortes do mesmo lanche
  lanche       text check (lanche is null or char_length(lanche) between 1 and 120),
  hora         timestamptz not null,
  -- a peça do pão em que o passo caiu (1 = a primeira metade que chegou)
  peca         smallint check (peca is null or peca between 1 and 8),
  -- por que a loja escolheu: o juiz teve dúvida, um pouco de cada ingrediente, ou o começo da peça (o pão)
  motivo       text not null check (motivo in ('duvida', 'cobertura', 'comeco')),
  -- o que o juiz disse: o nome e a nota (de 0 a 1). Nulo = ele não deu nome
  palpite      text check (palpite is null or char_length(palpite) between 1 and 120),
  nota         real check (nota is null or (nota >= 0 and nota <= 1)),
  -- o contorno do que chegou, em pixels do recorte: [[[x, y], ...], ...]
  contorno     jsonb,
  imagem       bytea,
  tipo         text not null default 'image/jpeg',
  largura      integer,
  altura       integer,
  sha256       text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  situacao     text not null default 'marcar' check (situacao in ('marcar', 'marcado', 'pulado')),
  -- o que a pessoa marcou: { estado: pilha | nada | nao-da, pilha: [{ nome, vezes }], obs }
  resposta     jsonb,
  cima         text check (cima is null or char_length(cima) between 1 and 120),
  acertou      boolean,
  marcado_por  uuid references usuario(id) on delete set null,
  marcado_em   timestamptz,
  recebido_em  timestamptz not null default now(),
  criado_em    timestamptz not null default now()
);
create unique index if not exists treino_recorte_chave_uk on treino_recorte (gravacao_id, chave);
create index if not exists treino_recorte_loja_idx on treino_recorte (loja_id, situacao, hora);

-- o exemplo da base que a marcação criou
alter table base_frame add column if not exists recorte_id uuid references treino_recorte(id) on delete set null;
create index if not exists base_frame_recorte_idx on base_frame (recorte_id) where recorte_id is not null;

comment on table treino_recorte is
  'O recorte de um passo da noite ao vivo, para marcar a pilha que a câmera vê (A24 F3, migration 055). A imagem sai 30 dias depois da marcação.';
comment on column base_frame.recorte_id is
  'O recorte marcado que criou este exemplo (migration 055). Marcar de novo troca o exemplo.';
