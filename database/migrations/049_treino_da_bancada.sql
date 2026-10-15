-- =====================================================================
-- Farol · migration 049 — o treinamento da bancada: a gravação de treino,
-- os lanches que a loja leu, os quadros das etapas e a conferência
-- =====================================================================
-- A21, fatia T4. Pedido do dono (15/10/2026): "o modo treinamento, com as
-- fichas na mão, e imagens gravadas separadas, se roda análises locais e
-- traz o resultado para o usuário corrigir ou confirmar acertos,
-- aprimorando e aprendendo cada caso". Protótipo e decisões aprovados no
-- mesmo dia (PR #147).
--
--   • **treino_gravacao** — um horário de movimento gravado para treino,
--     numa bancada (canal). A gravação inteira fica no computador da loja;
--     aqui fica só o que ela é. `chave` é o nome que a loja dá a ela: subir
--     de novo a mesma gravação não cria outra. `origem`: do gravador,
--     programada, ou `carga` (as leituras feitas antes da gravação
--     automática, fatia T3);
--
--   • **treino_lanche** — um lanche que a loja leu na gravação: as etapas
--     (o que apareceu em cada metade, e os nomes das fichas que a leitura
--     acha possíveis) e, depois da conferência, o que a pessoa disse. O
--     palpite da ficha é feito AQUI, com as fichas de hoje; `palpite`
--     guarda o que valia na hora da conferência, e `acertou` é a conta que
--     a tela mostra — só sobre o que alguém conferiu;
--
--   • **treino_quadro** — o quadro de cada etapa, reduzido (decisão 1 do
--     dono): sobe para conferir de qualquer lugar e sai 30 dias depois da
--     conferência (a rotina da API apaga);
--
--   • **base_frame** ganha de onde veio o exemplo da bancada: o lanche, a
--     etapa e o canal. O exemplo fica enquanto a base o usar — o quadro do
--     treino, não.
--
-- Nenhuma linha que já existe é alterada: as tabelas são novas e as
-- colunas novas de `base_frame` nascem nulas.
--
-- Idempotente: pode rodar de novo sem efeito.
-- =====================================================================

create table if not exists treino_gravacao (
  id          uuid primary key default gen_random_uuid(),
  loja_id     uuid not null references loja(id) on delete cascade,
  ponto_id    uuid references ponto(id) on delete set null,
  chave       text not null check (char_length(chave) between 1 and 120),
  inicio      timestamptz not null,
  fim         timestamptz not null,
  origem      text not null check (origem in ('gravador', 'programada', 'carga')),
  situacao    text not null default 'pronta'
              check (situacao in ('programada', 'fila', 'lendo', 'pronta', 'apagada', 'cancelada', 'falhou')),
  progresso   smallint check (progresso between 0 and 100),
  criado_por  uuid references usuario(id) on delete set null,
  criado_em   timestamptz not null default now(),
  lida_em     timestamptz,
  apagada_em  timestamptz,
  check (fim > inicio)
);
create unique index if not exists treino_gravacao_chave_uk on treino_gravacao (loja_id, chave);
create index if not exists treino_gravacao_loja_idx on treino_gravacao (loja_id, inicio desc);

create table if not exists treino_lanche (
  id             uuid primary key default gen_random_uuid(),
  gravacao_id    uuid not null references treino_gravacao(id) on delete cascade,
  loja_id        uuid not null references loja(id) on delete cascade,
  chave          text not null check (char_length(chave) between 1 and 120),
  aberto_em      timestamptz,
  fechou_em      timestamptz,
  -- as etapas, como a loja leu: { etapas: [{ hora, lado, inicio, leu, candidatos, vezes, quadro }] }
  leitura        jsonb not null,
  situacao       text not null default 'conferir' check (situacao in ('conferir', 'conferido', 'pulado')),
  -- o que a pessoa disse: o produto, cada etapa, o que faltou e o que veio a mais
  resposta       jsonb,
  -- o produto que a pessoa disse (nulo = não era um lanche, ou não dá para saber)
  produto        text,
  -- o palpite da ficha na hora da conferência, e se ele era o certo
  palpite        text,
  acertou        boolean,
  conferido_por  uuid references usuario(id) on delete set null,
  conferido_em   timestamptz,
  recebido_em    timestamptz not null default now(),
  criado_em      timestamptz not null default now()
);
create unique index if not exists treino_lanche_chave_uk on treino_lanche (gravacao_id, chave);
create index if not exists treino_lanche_loja_idx on treino_lanche (loja_id, situacao);

create table if not exists treino_quadro (
  id         uuid primary key default gen_random_uuid(),
  lanche_id  uuid not null references treino_lanche(id) on delete cascade,
  n          smallint not null check (n >= 0),
  imagem     bytea not null,
  tipo       text not null default 'image/jpeg',
  largura    integer,
  altura     integer,
  sha256     text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  criado_em  timestamptz not null default now()
);
create unique index if not exists treino_quadro_n_uk on treino_quadro (lanche_id, n);

-- o exemplo da bancada: de qual lanche, de qual etapa e de qual canal ele veio
alter table base_frame add column if not exists lanche_id uuid references treino_lanche(id) on delete set null;
alter table base_frame add column if not exists etapa     smallint;
alter table base_frame add column if not exists ponto_id  uuid references ponto(id) on delete set null;
create index if not exists base_frame_lanche_idx on base_frame (lanche_id) where lanche_id is not null;

comment on table treino_gravacao is
  'O horário de movimento gravado para treino (A21). A gravação inteira fica no computador da loja (migration 049).';
comment on table treino_lanche is
  'Um lanche lido pela loja numa gravação de treino, e a conferência dele. O acerto conta só o que alguém conferiu.';
comment on table treino_quadro is
  'O quadro de cada etapa, reduzido, para conferir. Sai 30 dias depois da conferência (decisão do dono, 15/10/2026).';
