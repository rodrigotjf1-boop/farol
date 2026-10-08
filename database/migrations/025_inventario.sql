-- =====================================================================
-- Farol · migration 025 — o inventário de equipamentos da loja
-- =====================================================================
-- Fase 2 do plano A16, segunda parte. Pedido do dono (madrugada de
-- 08/10/2026): "os equipamentos por setores, onde poderíamos ter até 4
-- fotos do equipamento devidamente limpo, para identificar seu lugar no
-- setor e padrão; uma única análise dele completa e sua descrição ficava
-- guardada na base para ajudar em análises".
--
-- ## Não é a tabela `equipamento`
--
-- `equipamento` (migration 002) é o CATÁLOGO DA DISTRIBUIÇÃO: o que o Farol
-- indica comprar (gravador, câmera, computador). É do Farol, não da loja, e
-- nenhuma rota do console o devolve. O inventário é o contrário: a chapa, a
-- bancada e o caixa DESTA loja, cadastrados por quem a configura. Por isso
-- o nome diferente (`inventario_*`) e nenhuma ligação entre as duas.
--
-- ## O que cada equipamento guarda
--
--   - nome, setor e tipo;
--   - até quatro fotos dele limpo e no lugar (o limite é da API);
--   - a descrição — como ele é e como fica quando está em ordem — e a lista
--     do que vale conferir nele. A descrição vai junto com cada pergunta
--     feita à nuvem sobre a área em que ele aparece.
--
-- ## As duas origens de foto
--
--   `canal`  o quadro do canal, copiado como está (o mesmo quadro de
--            preview, com rosto borrado pelo agente), mais o DESENHO da
--            área naquele instante (`recorte`). A imagem guardada é o
--            quadro inteiro: quem mostra ou analisa recorta pelo desenho.
--            Assim a API não precisa de biblioteca de imagem, e o recorte
--            não se perde se a área for redesenhada depois.
--   `envio`  uma foto mandada pelo console (do celular, de perto). Chega
--            já reduzida pelo navegador; a API só confere que é JPEG e o
--            tamanho.
--
-- "Onde aparece" não é coluna: é o canal e a área das fotos de origem
-- `canal`. A foto É a prova de que ele aparece ali.
--
-- ⚠️ Como em `ponto.preview` e `foto_padrao`: nenhuma listagem pode usar
-- `select *` em `inventario_foto` — traria os bytes de todas.
--
-- Idempotente: pode rodar de novo sem efeito.
-- =====================================================================

create table if not exists inventario_item (
  id            uuid primary key default gen_random_uuid(),
  loja_id       uuid not null references loja(id) on delete cascade,
  setor_id      uuid not null references setor(id) on delete cascade,
  nome          text not null check (length(btrim(nome)) between 1 and 80),
  tipo          text not null default 'outro'
                check (tipo in ('chapa', 'fritadeira', 'bancada', 'geladeira', 'balcao',
                                'caixa', 'prateleira', 'pia', 'outro')),
  descricao     text not null default '' check (length(descricao) <= 2000),
  -- O que vale conferir nele: lista de frases curtas. Cada uma pode virar
  -- um critério.
  conferir      jsonb not null default '[]'::jsonb check (jsonb_typeof(conferir) = 'array'),
  -- Quando a descrição foi escrita pela análise das fotos, e por qual
  -- modelo. Nulos = escrita à mão (ou ainda não escrita).
  descrito_em   timestamptz,
  descrito_por  text,
  criado_por    uuid references usuario(id) on delete set null,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Dois equipamentos com o mesmo nome na mesma loja não dizem qual é qual.
create unique index if not exists inventario_item_nome_uq
  on inventario_item (loja_id, lower(btrim(nome)));
create index if not exists inventario_item_setor_idx on inventario_item (setor_id);

comment on table inventario_item is
  'Os equipamentos DA LOJA (chapa, bancada, caixa…), como ficam limpos e no '
  'lugar. Não confundir com `equipamento`, o catálogo da distribuição.';

create table if not exists inventario_foto (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references inventario_item(id) on delete cascade,
  origem     text not null check (origem in ('canal', 'envio')),
  -- De que canal e de que área veio a foto de origem `canal`. Canal ou área
  -- excluídos deixam a foto, sem o lugar.
  ponto_id   uuid references ponto(id) on delete set null,
  zona_id    uuid references zona(id) on delete set null,
  -- O desenho da área no instante da foto: [[x, y], …] em fração do quadro.
  recorte    jsonb check (recorte is null or jsonb_typeof(recorte) = 'array'),
  imagem     bytea not null,
  tipo       text not null default 'image/jpeg',
  largura    integer,
  altura     integer,
  sha256     text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  criada_por uuid references usuario(id) on delete set null,
  criada_em  timestamptz not null default now(),
  -- foto do canal tem o desenho; foto enviada não tem
  check ((origem = 'canal') = (recorte is not null))
);

create index if not exists inventario_foto_item_idx on inventario_foto (item_id, criada_em);
create index if not exists inventario_foto_zona_idx on inventario_foto (zona_id) where zona_id is not null;

comment on table inventario_foto is
  'As fotos do equipamento limpo. `canal` = o quadro do canal copiado, com o '
  'desenho da área em `recorte`; `envio` = foto mandada pelo console.';

-- O agente recebe, por área, a descrição dos equipamentos que aparecem
-- nela. Só o que ele CONSOME sobe a versão da configuração — o nome, o tipo
-- e a descrição de equipamento descrito, e as fotos de canal (que dizem
-- onde ele aparece). Trocar a ordem das fotos, ou cadastrar um equipamento
-- ainda sem descrição, não faz o agente remontar a auditoria.
create or replace function tg_config_versao_inventario_item()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if new.nome is not distinct from old.nome
       and new.tipo is not distinct from old.tipo
       and new.descricao is not distinct from old.descricao then
      return null;
    end if;
    if new.descricao = '' and old.descricao = '' then return null; end if;
    perform bump_config_versao(new.loja_id);
  elsif tg_op = 'INSERT' then
    if new.descricao <> '' then perform bump_config_versao(new.loja_id); end if;
  else
    if old.descricao <> '' then perform bump_config_versao(old.loja_id); end if;
  end if;
  return null;
end $$;

drop trigger if exists inventario_item_config_versao on inventario_item;
create trigger inventario_item_config_versao
  after insert or update or delete on inventario_item
  for each row execute function tg_config_versao_inventario_item();

create or replace function tg_config_versao_inventario_foto()
returns trigger language plpgsql as $$
declare
  v_loja uuid;
  v_descricao text;
begin
  if coalesce(new.origem, old.origem) <> 'canal' then return null; end if;
  select i.loja_id, i.descricao into v_loja, v_descricao
    from inventario_item i where i.id = coalesce(new.item_id, old.item_id);
  -- Equipamento sem descrição não desce ao agente; e na exclusão do
  -- equipamento inteiro ele já não existe aqui (quem sobe a versão é o
  -- gatilho dele).
  if v_loja is not null and v_descricao <> '' then perform bump_config_versao(v_loja); end if;
  return null;
end $$;

drop trigger if exists inventario_foto_config_versao on inventario_foto;
create trigger inventario_foto_config_versao
  after insert or delete on inventario_foto
  for each row execute function tg_config_versao_inventario_foto();
