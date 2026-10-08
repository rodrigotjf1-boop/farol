-- =====================================================================
-- Farol · migration 024 — a foto padrão do canal
-- =====================================================================
-- Fase 2 do plano A16 ("local primeiro"). Pedido do dono (07/10/2026): "uma
-- foto padrão do ambiente limpo e organizado para padrão de comparação".
--
-- A foto padrão é o quadro do canal num momento em que o ambiente está como
-- deve ficar: limpo, organizado e sem ninguém na frente. Serve a duas coisas:
--
--   1. a LOJA compara o quadro de agora com ela, antes de perguntar a
--      alguém: igual ao padrão é conforme, e não custou chamada nenhuma;
--   2. quando a pergunta é feita à nuvem, a foto padrão vai junto — o
--      modelo passa a ver "como deveria estar" ao lado de "como está".
--
-- ## Por que tabela própria, e não `base_frame`
--
-- `base_conhecimento`/`base_frame` (migration 001) são por LOJA e guardam
-- endereço de arquivo e vetor de 768 dimensões, para comparação por modelo.
-- A foto padrão é por CANAL, é a própria imagem, e a comparação é feita na
-- loja sem modelo nenhum (medido em 08/10/2026: a mesma cena dá 0,96 a 0,99
-- de semelhança, e uma mudança de 0,2% da área cai abaixo de 0,84).
--
-- ## Por que `bytea`
--
-- É a cópia do quadro de preview do canal (migration 008), que já mora no
-- banco: poucas centenas de kB, com rosto borrado pelo agente. São no
-- máximo quatro por canal (dia, noite, loja fechada…), e a API não deixa
-- passar disso. O espaço fica preso ao número de câmeras, não ao tempo.
--
-- ⚠️ Como em `ponto.preview`: nenhuma listagem pode usar `select *` aqui.
-- Uma lista de fotos traria os bytes de todas para escrever quatro nomes.
--
-- `sha256` é da imagem: o agente guarda as fotos em disco por ele, e só
-- baixa de novo a que mudou.
--
-- `pessoas` é quantas pessoas o detector da loja viu no quadro quando ele
-- foi capturado (nulo = não foi medido). A tela avisa antes de guardar uma
-- foto padrão com gente na frente.
--
-- Idempotente: pode rodar de novo sem efeito.
-- =====================================================================

create table if not exists foto_padrao (
  id            uuid primary key default gen_random_uuid(),
  ponto_id      uuid not null references ponto(id) on delete cascade,
  nome          text not null check (length(btrim(nome)) between 1 and 60),
  imagem        bytea not null,
  tipo          text not null default 'image/jpeg',
  largura       integer,
  altura        integer,
  sha256        text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  pessoas       integer check (pessoas is null or pessoas >= 0),
  capturada_em  timestamptz not null,
  criada_por    uuid references usuario(id) on delete set null,
  criada_em     timestamptz not null default now()
);

create index if not exists foto_padrao_ponto_idx on foto_padrao (ponto_id, criada_em desc);

-- Duas fotos com o mesmo nome no mesmo canal não dizem qual é qual.
create unique index if not exists foto_padrao_nome_uq on foto_padrao (ponto_id, lower(btrim(nome)));

comment on table foto_padrao is
  'O quadro do canal com o ambiente como deve ficar. A loja compara com ele '
  'antes de perguntar à nuvem; e, quando pergunta, ele vai junto.';

-- Quantas pessoas o detector viu no quadro de preview, na captura.
alter table ponto
  add column if not exists preview_pessoas integer
    check (preview_pessoas is null or preview_pessoas >= 0);

comment on column ponto.preview_pessoas is
  'Pessoas que o detector da loja viu no quadro de preview. Nulo = a loja '
  'não mediu (agente antigo, ou sem detector).';

-- "Mandar a foto padrão do canal junto": nos critérios que vão à nuvem, o
-- modelo recebe a foto padrão ao lado do quadro de agora.
alter table regra
  add column if not exists com_padrao boolean not null default false;

comment on column regra.com_padrao is
  'Quando o critério vai à nuvem, a foto padrão do canal vai junto. Sem '
  'foto padrão no canal, a pergunta é feita como sempre foi.';

-- Guardar ou excluir uma foto padrão muda o que o agente tem de ter em
-- disco: sobe a versão da configuração, como ponto, zona e regra.
create or replace function tg_config_versao_foto_padrao()
returns trigger language plpgsql as $$
declare v_loja uuid;
begin
  select st.loja_id into v_loja
    from ponto p join setor st on st.id = p.setor_id
   where p.id = coalesce(new.ponto_id, old.ponto_id);
  if v_loja is not null then perform bump_config_versao(v_loja); end if;
  return null;
end $$;

drop trigger if exists foto_padrao_config_versao on foto_padrao;
create trigger foto_padrao_config_versao
  after insert or update or delete on foto_padrao
  for each row execute function tg_config_versao_foto_padrao();
