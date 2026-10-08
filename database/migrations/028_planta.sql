-- =====================================================================
-- Farol · migration 028 — a planta da loja
-- =====================================================================
-- A16, fase 4. Pedido do dono (07/10/2026): "um desenho do ambiente onde
-- os canais estão e o posicionamento nesse ambiente, como se fosse algo
-- 3D".
--
-- A planta é feita de retângulos, em metros: os ambientes, os móveis e
-- equipamentos, e cada câmera no seu lugar (posição, altura, para onde
-- olha, abertura da lente e alcance). Por ser feita de retângulos — e não
-- de uma imagem — dá para calcular o que cada câmera cobre e escrever a
-- descrição do lugar de cada canal, que vai junto com a pergunta feita a
-- um modelo.
--
-- **Um documento por loja**, e não uma tabela por coisa desenhada. A tela
-- edita tudo e salva de uma vez ("Concluir edição"); "Descartar mudanças"
-- volta ao que estava. Salvar por partes deixaria a planta pela metade
-- quando a rede caísse no meio. `versao` sobe a cada salvamento: quem
-- salva diz a versão que leu, e se outra pessoa salvou antes a gravação é
-- recusada — ninguém apaga o desenho do outro sem ver.
--
--   documento = {
--     "ambientes": [{ id, nome, setorId, x, y, w, h }],
--     "moveis":    [{ id, nome, itemId, x, y, w, h, alt }],
--     "cameras":   [{ pontoId, x, y, alt, dir, abertura, alcance }]
--   }
--
-- `setorId`, `itemId` (equipamento do inventário) e `pontoId` são conferidos
-- pela API na gravação — têm de ser desta loja. Depois disso um canal ou um
-- equipamento pode ser excluído: a LEITURA tira da planta a câmera cujo
-- canal não existe mais e solta o móvel do equipamento que saiu do
-- inventário. O documento não tem chave estrangeira, e não precisa.
--
-- **A versão da configuração.** O agente recebe, por canal, a descrição do
-- lugar tirada da planta. Então a planta que muda sobe a versão; e o
-- equipamento do inventário que muda de NOME (ou é excluído) também sobe
-- quando está desenhado na planta — o nome dele entra na descrição da
-- câmera que o vê.
--
-- Idempotente: pode rodar de novo sem efeito.
-- =====================================================================

create table if not exists planta (
  loja_id        uuid primary key references loja(id) on delete cascade,
  documento      jsonb not null check (jsonb_typeof(documento) = 'object'),
  versao         integer not null default 1 check (versao >= 1),
  atualizado_por uuid references usuario(id) on delete set null,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

comment on table planta is
  'A planta da loja: ambientes, móveis e câmeras, em metros. Um documento '
  'por loja, salvo inteiro. `versao` é a trava de quem edita ao mesmo tempo.';

create or replace function tg_config_versao_planta()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if new.documento is not distinct from old.documento then return null; end if;
    perform bump_config_versao(new.loja_id);
  elsif tg_op = 'INSERT' then
    perform bump_config_versao(new.loja_id);
  else
    perform bump_config_versao(old.loja_id);
  end if;
  return null;
end $$;

drop trigger if exists planta_config_versao on planta;
create trigger planta_config_versao
  after insert or update or delete on planta
  for each row execute function tg_config_versao_planta();

-- O equipamento do inventário que está desenhado na planta: o nome dele
-- entra na descrição do lugar da câmera que o vê. É a mesma função da
-- migration 025, com esse caso a mais.
create or replace function tg_config_versao_inventario_item()
returns trigger language plpgsql as $$
declare
  v_na_planta boolean := false;
begin
  if tg_op = 'UPDATE' then
    if new.nome is not distinct from old.nome
       and new.tipo is not distinct from old.tipo
       and new.descricao is not distinct from old.descricao then
      return null;
    end if;
    if new.nome is distinct from old.nome then
      select exists (
        select 1 from planta pl
         where pl.loja_id = new.loja_id
           and pl.documento->'moveis' @> jsonb_build_array(jsonb_build_object('itemId', new.id::text))
      ) into v_na_planta;
      if v_na_planta then
        perform bump_config_versao(new.loja_id);
        return null;
      end if;
    end if;
    if new.descricao = '' and old.descricao = '' then return null; end if;
    perform bump_config_versao(new.loja_id);
  elsif tg_op = 'INSERT' then
    if new.descricao <> '' then perform bump_config_versao(new.loja_id); end if;
  else
    select exists (
      select 1 from planta pl
       where pl.loja_id = old.loja_id
         and pl.documento->'moveis' @> jsonb_build_array(jsonb_build_object('itemId', old.id::text))
    ) into v_na_planta;
    if old.descricao <> '' or v_na_planta then perform bump_config_versao(old.loja_id); end if;
  end if;
  return null;
end $$;
