-- =====================================================================
-- Farol · migration 047 — a base de conhecimento passa a valer: o
-- ingrediente da loja e as fotos de referência dele
-- =====================================================================
-- A21, fatia T1. Pedido do dono (15/10/2026): "já providencie a opção de
-- agregar imagens nas fichas em cada ingrediente" — o protótipo e as
-- decisões aprovados no mesmo dia ("aprovado"; PR #147).
--
-- `base_conhecimento` e `base_frame` existem desde a 001 e nunca foram
-- usadas: nada gravava nem lia nelas (conferido em 15/10, as duas
-- vazias). Passam a guardar:
--
--   • **o ingrediente da loja** — `base_conhecimento`, tipo `item`, um
--     por NOME e por loja. A ficha não tem número de ingrediente e é
--     trocada inteira a cada importação: o nome é a chave, sem olhar
--     maiúscula nem espaço nas pontas. `visivel = false` é o "não se vê
--     de cima" (sal, tempero): o Farol para de esperar vê-lo na bancada;
--
--   • **a foto de referência** — `base_frame`, origem `foto`, mandada pelo
--     console já reduzida e guardada no banco, como as do inventário. Até
--     6 por ingrediente: a conta é da rota, com o ingrediente travado na
--     transação. O `sha256` é o que o agente vai comparar para saber se já
--     tem a foto (como a foto padrão, fatia T5);
--
--   • a origem `bancada` fica reservada ao exemplo que a conferência do
--     treinamento cria (fatias T4 e T5): o recorte do ingrediente.
--
-- O `url` da 001 deixa de ser obrigatório (a imagem mora no banco); o
-- quadro tem imagem OU endereço. O `embedding` continua lá, vazio.
--
-- Nenhuma linha que já existe é alterada: as tabelas estão vazias, e as
-- colunas novas nascem nulas ou com o padrão.
--
-- Idempotente: pode rodar de novo sem efeito.
-- =====================================================================

-- ───────────────────────── o ingrediente ─────────────────────────

alter table base_conhecimento add column if not exists visivel boolean not null default true;

alter table base_conhecimento drop constraint if exists base_conhecimento_nome_cabe;
alter table base_conhecimento add constraint base_conhecimento_nome_cabe
  check (char_length(btrim(nome)) between 1 and 120);

-- Um item por nome, por loja e tipo — sem olhar maiúscula nem espaço nas pontas.
create unique index if not exists base_conhecimento_nome_uk
  on base_conhecimento (loja_id, tipo, lower(btrim(nome)));

-- ───────────────────────── a foto ─────────────────────────

alter table base_frame alter column url drop not null;

alter table base_frame add column if not exists origem text not null default 'foto';
alter table base_frame drop constraint if exists base_frame_origem_conhecida;
alter table base_frame add constraint base_frame_origem_conhecida
  check (origem in ('foto', 'bancada'));

alter table base_frame add column if not exists imagem    bytea;
alter table base_frame add column if not exists tipo      text not null default 'image/jpeg';
alter table base_frame add column if not exists largura   integer;
alter table base_frame add column if not exists altura    integer;
alter table base_frame add column if not exists sha256    text;
alter table base_frame add column if not exists legenda   text;
alter table base_frame add column if not exists criado_por uuid references usuario(id) on delete set null;

alter table base_frame drop constraint if exists base_frame_sha256_formato;
alter table base_frame add constraint base_frame_sha256_formato
  check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$');

alter table base_frame drop constraint if exists base_frame_legenda_cabe;
alter table base_frame add constraint base_frame_legenda_cabe
  check (legenda is null or char_length(legenda) <= 120);

-- A imagem no banco, ou o endereço dela: um dos dois.
alter table base_frame drop constraint if exists base_frame_tem_imagem;
alter table base_frame add constraint base_frame_tem_imagem
  check (imagem is not null or url is not null);

-- As fotos de um ingrediente, na ordem em que chegaram.
create index if not exists base_frame_base_origem_idx on base_frame (base_id, origem, criado_em);

comment on column base_conhecimento.visivel is
  'Falso = "não se vê de cima" (sal, tempero): o Farol não espera ver o item na bancada (migration 047).';
comment on column base_frame.origem is
  '`foto`: a foto de referência mandada pelo console. `bancada`: o recorte que a conferência do treinamento '
  'guardou como exemplo (migration 047).';
comment on column base_frame.imagem is
  'A imagem, no banco (como as fotos do inventário). A listagem nunca traz os bytes.';
