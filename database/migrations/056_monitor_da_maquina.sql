-- =====================================================================
-- Farol · migration 056 — o monitoramento da máquina: os sensores, o
-- pico de cada minuto e as quedas do PC
-- =====================================================================
-- O dono, 25/10/2026, depois de o PC da loja apagar às 08:49 de sábado
-- (falta de energia) e ficar 20 horas desligado: "um monitoramento de
-- funcionamento do pc servidor do agente com relatórios de usos por
-- horários, picos de uso, % de uso do processador, da memória e da placa,
-- temperaturas, para verificar se o pc está sobrecarregado, se
-- sobreaquece. o máximo de dados possíveis."
--
--   • **uso_hora.sensores** — o que o agente mede além do processador, da
--     memória e da placa (`agent/farol_agent/sensores.py`): a placa NVIDIA
--     (memória, temperatura, consumo, ventoinha, frequência), a frequência
--     real do processador, as zonas térmicas da placa-mãe, o disco
--     (ocupado, leitura, escrita, temperatura, saúde, horas ligado), há
--     quanto tempo o PC está ligado e em quantas amostras a placa segurou a
--     frequência por temperatura ou energia. De cada campo somado: soma,
--     amostras e pico (`{"gpuTempC": {"soma":…, "amostras":…, "max":…}}`);
--
--   • **uso_hora.minutos** — o pico de cada minuto da hora:
--     `[[minuto, {"cpu":…, "mem":…, "gpu":…, "gpuTempC":…}], …]`. É o que
--     deixa ver o estouro que a média da hora esconde;
--
--   • **computador_queda** — o desligamento inesperado do PC, como o
--     Windows registrou (eventos 41 e 6008): quando apagou, quando ligou de
--     novo e a causa (energia, tela azul, botão segurado, durante a
--     suspensão). Uma linha por subida do Windows (o agente manda de novo a
--     cada envio; a nuvem guarda uma vez).
--
-- Nenhuma linha que já existe muda: as colunas nascem nulas e a tabela é
-- nova. Idempotente: pode rodar de novo sem efeito.
-- =====================================================================

alter table uso_hora add column if not exists sensores jsonb;
alter table uso_hora add column if not exists minutos jsonb;

create table if not exists computador_queda (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null references tenant(id) on delete cascade,
  loja_id     uuid not null references loja(id)   on delete cascade,
  agente_id   uuid not null references agente(id) on delete cascade,
  -- quando o PC apagou (do binário do evento 6008) — nulo quando o Windows não registrou
  desligou    timestamptz,
  -- quando o Windows subiu de novo (o evento 41 é escrito nessa subida)
  ligou       timestamptz not null,
  causa       text not null check (causa in ('energia', 'tela-azul', 'botao', 'suspensao')),
  bugcheck    text check (bugcheck is null or char_length(bugcheck) <= 20),
  recebido_em timestamptz not null default now(),
  check (desligou is null or desligou <= ligou)
);
create unique index if not exists computador_queda_uk on computador_queda (agente_id, ligou);
create index if not exists computador_queda_loja_idx on computador_queda (loja_id, ligou desc);

comment on column uso_hora.sensores is
  'Os sensores da hora (migration 056): de cada campo somado, soma, amostras e pico; a saúde e as horas do disco; há quanto tempo o PC está ligado; as amostras com a placa segurando a frequência.';
comment on column uso_hora.minutos is
  'O pico de cada minuto da hora (migration 056): [[minuto, {campo: pico}], …].';
comment on table computador_queda is
  'O desligamento inesperado do PC do agente, pelo registro do Windows (eventos 41 e 6008): quando apagou, quando ligou e a causa (migration 056).';
