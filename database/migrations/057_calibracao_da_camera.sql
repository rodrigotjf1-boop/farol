-- =====================================================================
-- Farol · migration 057 — a calibração de cada câmera pelos pontos do
-- piso (A26, parte P1)
-- =====================================================================
-- O dono, 25/10/2026: "definir onde cada canal fica no mapa e onde cobre",
-- e o código das pessoas na planta pronto, à espera das fotos.
--
--   • **camera_calibracao** — uma por canal: os pontos do CHÃO marcados na
--     imagem do canal, cada um com a posição dele na planta, em metros
--     (`pares`: [{img: [u, v], piso: [x, y]}], a imagem normalizada de 0 a
--     1). Daí a nuvem calcula a homografia (imagem → piso), o erro de cada
--     ponto, o erro conferido (deixando um ponto de fora por vez) e o
--     pedaço do piso que a câmera vê — `api/src/calibracao.ts`; o agente
--     usa a mesma conta para levar o pé de cada pessoa ao mapa.
--
--     Fica fora do documento da planta de propósito: a planta é salva
--     inteira pela tela que a desenha, e a calibração tem tela, versão e
--     ritmo próprios (refaz-se quando a câmera é mexida).
--
-- Tabela nova: nada que já existe muda. Idempotente.
-- =====================================================================

create table if not exists camera_calibracao (
  ponto_id        uuid primary key references ponto(id) on delete cascade,
  tenant_id       uuid not null references tenant(id) on delete cascade,
  loja_id         uuid not null references loja(id)   on delete cascade,
  pares           jsonb not null,
  -- a conta, guardada para quem lê não refazer (e para o agente)
  homografia      jsonb not null,
  erro_medio_m    numeric(7,3) not null,
  erro_maximo_m   numeric(7,3) not null,
  -- deixando um ponto de fora por vez (nulo com 4 pontos): a régua que a tela mostra
  erro_conferido_m numeric(7,3),
  area            jsonb not null,
  versao          integer not null default 1,
  atualizada_por  uuid,
  atualizada_em   timestamptz not null default now(),
  check (jsonb_typeof(pares) = 'array' and jsonb_array_length(pares) between 4 and 40),
  check (jsonb_typeof(homografia) = 'array' and jsonb_array_length(homografia) = 9)
);
create index if not exists camera_calibracao_loja_idx on camera_calibracao (loja_id);

-- A homografia desce ao agente na configuração: mudou, a configuração sobe de versão e ele baixa de novo (como a planta).
create or replace function tg_config_versao_calibracao()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if new.homografia is not distinct from old.homografia then return null; end if;
    perform bump_config_versao(new.loja_id);
  elsif tg_op = 'INSERT' then
    perform bump_config_versao(new.loja_id);
  else
    perform bump_config_versao(old.loja_id);
  end if;
  return null;
end $$;

drop trigger if exists camera_calibracao_config_versao on camera_calibracao;
create trigger camera_calibracao_config_versao
  after insert or update or delete on camera_calibracao
  for each row execute function tg_config_versao_calibracao();

comment on table camera_calibracao is
  'A calibração de cada câmera pelos pontos do piso (migration 057): os pares imagem → planta, a homografia, os erros e o piso que a câmera vê.';
