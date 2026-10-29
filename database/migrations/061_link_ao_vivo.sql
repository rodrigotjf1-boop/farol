-- =====================================================================
-- Farol · migration 061 — o link só do ao vivo
-- =====================================================================
-- Pedido do dono em 29/10/2026: "a ideia de ver do celular não é ter
-- acesso completo ao webapp, é ver somente a movimentação ao vivo".
-- Protótipo aprovado no mesmo dia, com o recomendado: quem configura a loja
-- cria um link; quem o recebe abre no celular SEM login e vê só o
-- movimento ao vivo daquela loja (a planta sem as câmeras, as pessoas pelo
-- posto, quantas há em cada setor). Nada de imagem, histórico, relatório,
-- outra loja ou botão que mude alguma coisa.
--
-- **link_ao_vivo** — um por link:
--
--   • o código vai no endereço (`/ver/<código>`) e aparece UMA vez, para
--     quem o criou; o banco guarda só a impressão (SHA-256), como o acesso
--     de outro sistema (migration 041) — nem quem lê o banco abre o link;
--   • `vence_em` nulo = vale até alguém desligar; com data, para sozinho;
--   • desligar preenche `desligado_em` — a linha fica, como registro de
--     quem criou, para quem e quando parou;
--   • `ultimo_uso_em` é a última leitura aceita (anotada no máximo uma vez
--     por minuto), para a lista dizer se o link está sendo usado.
--
-- Loja apagada leva os links junto. Nada muda para quem já está no ar: a
-- tabela nasce vazia.
--
-- Idempotente: pode rodar de novo sem efeito.
-- =====================================================================

create table if not exists link_ao_vivo (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid        not null references tenant(id) on delete cascade,
  loja_id        uuid        not null references loja(id) on delete cascade,
  -- Para quem é o link ("Celular do gerente"). É o nome que a lista mostra.
  nome           text        not null,
  token_hash     text        not null,
  criado_por     uuid        references usuario(id) on delete set null,
  criado_em      timestamptz not null default now(),
  vence_em       timestamptz,
  ultimo_uso_em  timestamptz,
  desligado_em   timestamptz,
  desligado_por  uuid        references usuario(id) on delete set null
);

alter table link_ao_vivo drop constraint if exists link_ao_vivo_nome_cabe;
alter table link_ao_vivo add constraint link_ao_vivo_nome_cabe
  check (char_length(btrim(nome)) between 1 and 40);
alter table link_ao_vivo drop constraint if exists link_ao_vivo_token_e_impressao;
alter table link_ao_vivo add constraint link_ao_vivo_token_e_impressao
  check (token_hash ~ '^[0-9a-f]{64}$');
alter table link_ao_vivo drop constraint if exists link_ao_vivo_vence_depois;
alter table link_ao_vivo add constraint link_ao_vivo_vence_depois
  check (vence_em is null or vence_em > criado_em);

create unique index if not exists link_ao_vivo_token_uk on link_ao_vivo (token_hash);
-- A lista da loja (os mais novos primeiro) e a conta dos que estão valendo.
create index if not exists link_ao_vivo_loja_idx on link_ao_vivo (loja_id, criado_em desc);

comment on table link_ao_vivo is
  'O link que abre só o movimento ao vivo de uma loja, sem login (migration '
  '061). Só a impressão do código fica guardada; desligar preenche '
  'desligado_em e a linha fica como registro.';
comment on column link_ao_vivo.token_hash is
  'A impressão (sha256) do código do link. O código aparece uma vez, para '
  'quem o criou, e não é guardado.';
comment on column link_ao_vivo.vence_em is
  'Até quando o link vale. Nulo: até alguém desligar.';
comment on column link_ao_vivo.ultimo_uso_em is
  'A última leitura aceita pelo link (anotada no máximo uma vez por minuto).';
