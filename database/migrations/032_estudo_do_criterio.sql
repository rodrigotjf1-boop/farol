-- =====================================================================
-- Farol · migration 032 — o estudo do critério
-- =====================================================================
-- A19, onda 1, fatia 1.3. Pedido do dono (08/10/2026): os critérios têm de
-- ser estudados para gerar gatilhos, sem julgamento desnecessário "sem
-- movimento ou sem o contexto acontecendo". O exemplo é dele: para saber
-- se o colaborador da chapa salga as carnes, é preciso haver carne na
-- chapa e colaborador no posto — sem isso não se analisa.
--
-- **regra_estudo** — a ficha de seis partes de um critério (uma por
-- critério):
--
--   partes    o texto de cada parte, do jeito que a pessoa lê e corrige:
--             contexto, gatilho, janela, ação, desfecho e fora de contexto.
--   contexto  o que a loja confere SOZINHA antes de olhar: uma lista de
--             sinais (há pessoa, está parado, está como na foto padrão),
--             cada um num lugar do canal. Todos têm de valer.
--   gatilho   o que abre a análise (alguém entrou, saiu do padrão, a cada
--             N minutos). Basta um.
--   confirmado_em / confirmado_por
--             só o estudo CONFIRMADO por uma pessoa desce para o agente.
--             Sem estudo confirmado, o critério segue com o "quando vale a
--             pena conferir" de sempre (regra.porteiro).
--
-- **resumo_hora.sem_gatilho** — a olhada do critério com estudo em que o
-- contexto valia e nenhum gatilho abriu a análise. É o décimo desfecho de
-- uma olhada, e fecha o funil: olhadas → com contexto → com gatilho →
-- julgadas.
--
-- Mexer no contexto, no gatilho ou na confirmação muda o que o agente faz:
-- a versão da configuração da loja sobe, como já sobe quando o critério
-- ou os canais dele mudam. Corrigir só o texto de uma parte não sobe.
--
-- Nada muda para quem já está no ar: nenhum critério tem estudo, e nenhuma
-- linha existente é atualizada.
--
-- Idempotente: pode rodar de novo sem efeito.
-- =====================================================================

create table if not exists regra_estudo (
  regra_id       uuid primary key references regra(id) on delete cascade,
  partes         jsonb not null default '{}'::jsonb
                   check (jsonb_typeof(partes) = 'object'),
  contexto       jsonb not null default '[]'::jsonb
                   check (jsonb_typeof(contexto) = 'array'),
  gatilho        jsonb not null default '[]'::jsonb
                   check (jsonb_typeof(gatilho) = 'array'),
  confirmado_em  timestamptz,
  confirmado_por uuid references usuario(id) on delete set null,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

comment on table regra_estudo is
  'O estudo de um critério: as seis partes em texto e, na forma que o agente '
  'entende, o contexto e o gatilho que a loja confere sozinha.';
comment on column regra_estudo.partes is
  'O texto de cada parte (contexto, gatilho, janela, acao, desfecho, fora), '
  'como a pessoa lê e corrige.';
comment on column regra_estudo.contexto is
  'O que precisa estar acontecendo: lista de {sinal, onde, zonaId?}. Todas '
  'as condições têm de valer.';
comment on column regra_estudo.gatilho is
  'O que abre a análise: lista de {sinal, onde?, zonaId?, minutos?}. Basta '
  'uma. Vazia = toda olhada.';
comment on column regra_estudo.confirmado_em is
  'Quando uma pessoa confirmou o estudo. Nulo = ainda não confirmado: não '
  'desce para o agente.';

alter table resumo_hora
  add column if not exists sem_gatilho integer not null default 0
    check (sem_gatilho >= 0);

comment on column resumo_hora.sem_gatilho is
  'Olhadas de critério com estudo em que o contexto valia e nenhum gatilho '
  'abriu a análise.';

-- ─────────── a versão da configuração acompanha a mudança ───────────
-- O agente só puxa a configuração quando `loja.config_versao` muda. E só
-- muda o que o agente USA: o contexto, o gatilho e se o estudo está
-- confirmado. Corrigir o texto de uma parte não faz a loja remontar a
-- auditoria.
create or replace function tg_config_versao_regra_estudo()
returns trigger language plpgsql as $$
declare v_loja uuid;
begin
  if tg_op = 'UPDATE'
     and new.contexto = old.contexto
     and new.gatilho = old.gatilho
     and (new.confirmado_em is null) = (old.confirmado_em is null) then
    return null;
  end if;
  select r.loja_id into v_loja
    from regra r
   where r.id = coalesce(new.regra_id, old.regra_id);
  -- Nulo quando a própria regra está sendo apagada: o gatilho dela já
  -- subiu a versão.
  if v_loja is not null then perform bump_config_versao(v_loja); end if;
  return null;
end $$;

drop trigger if exists regra_estudo_config_versao on regra_estudo;
create trigger regra_estudo_config_versao
  after insert or update or delete on regra_estudo
  for each row execute function tg_config_versao_regra_estudo();
