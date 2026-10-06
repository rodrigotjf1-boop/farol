-- =====================================================================
-- Farol · migration 012 — um critério, vários canais
-- =====================================================================
-- Até aqui `regra.zona_id` amarrava o critério a UMA área de UM canal.
-- "A bancada está limpa" numa cozinha com três câmeras eram três
-- cadastros — e, pior, três edições quando a redação mudava. Esquecer uma
-- deixa a loja auditando por duas redações ao mesmo tempo, sem ninguém
-- saber qual.
--
-- O dono descreveu o que quer (06/10/2026): marcar os canais numa árvore,
-- como num explorador de arquivos — o setor inteiro, ou abrir o setor e
-- marcar só um canal. Um cadastro, vários canais.
--
-- ## O modelo: o critério tem um CONJUNTO de áreas
--
-- `regra_alvo (regra_id, zona_id)`. O que está marcado na árvore é o que
-- está nesta tabela, linha por linha — sem "setor inteiro" guardado como
-- vínculo vivo. Isso é deliberado:
--
--   · a exceção sai de graça: não querer o critério num canal é só não
--     marcar aquele canal;
--   · câmera nova instalada no setor NÃO herda os critérios sozinha. Ela
--     aparece na árvore, desmarcada. Herdar ligaria um critério num
--     enquadramento que ninguém conferiu — e critério que erra no primeiro
--     dia ensina a loja a ignorar o Farol.
--
-- ## Por que a área, e não o canal
--
-- Marcar um canal na tela grava a ÁREA PRINCIPAL dele (`zona.principal`,
-- o corte que o usuário desenhou; na falta de desenho, o quadro inteiro).
-- Guardar a área e não o canal mantém tudo o que já existe funcionando sem
-- mudança: a descida para o agente, o recorte e o evento são indexados por
-- área desde a 001.
--
-- ## `regra.loja_id` — o critério ganha dono direto
--
-- O dono do critério era derivado: regra → zona → ponto → setor → loja.
-- Com o conjunto de áreas podendo ficar VAZIO (o usuário tira o critério
-- do último canal), essa cadeia some e o critério ficaria sem empresa —
-- impossível de listar com segurança, impossível de devolver a um canal.
-- Todo registro tem dono; este passa a ter o seu escrito.
-- =====================================================================

alter table regra
  add column if not exists loja_id uuid references loja(id) on delete cascade;

update regra r
   set loja_id = st.loja_id
  from zona z
  join ponto p  on p.id  = z.ponto_id
  join setor st on st.id = p.setor_id
 where z.id = r.zona_id
   and r.loja_id is null;

-- As duas são seguras de repetir: `set not null` e `drop not null` não
-- reclamam quando a coluna já está como se pede.
alter table regra alter column loja_id set not null;
alter table regra alter column zona_id drop not null;

create index if not exists regra_loja_idx on regra (loja_id);

comment on column regra.loja_id is
  'A loja dona do critério. Antes era derivada da zona; com o critério '
  'valendo em vários canais — ou em nenhum, por um momento — o dono '
  'precisa estar escrito.';

comment on column regra.zona_id is
  'LEGADO, não ler. Onde o critério vale está em `regra_alvo`. Os valores '
  'antigos ficam só para o código anterior continuar funcionando se for '
  'preciso voltar uma versão; critério novo nasce com isto nulo.';

-- ───────────────────────── regra_alvo ─────────────────────────

create table if not exists regra_alvo (
  regra_id  uuid not null references regra(id) on delete cascade,
  zona_id   uuid not null references zona(id)  on delete cascade,
  criado_em timestamptz not null default now(),
  primary key (regra_id, zona_id)
);

-- "Quais critérios valem neste canal?" é a pergunta da árvore e da
-- descida para o agente.
create index if not exists regra_alvo_zona_idx on regra_alvo (zona_id);

comment on table regra_alvo is
  'Em quais áreas (e portanto em quais canais) cada critério vale. É o '
  'que a árvore de canais mostra marcado. Um critério com zero linhas '
  'aqui não é auditado em lugar nenhum.';

-- Todo critério que já existia continua valendo exatamente onde valia.
insert into regra_alvo (regra_id, zona_id)
select r.id, r.zona_id
  from regra r
 where r.zona_id is not null
on conflict do nothing;

-- ─────────── a versão da configuração acompanha a mudança ───────────
-- O agente só puxa a configuração quando `loja.config_versao` muda. Marcar
-- ou desmarcar um canal tem que subir esse número, senão a tela mostra o
-- critério no canal e o agente segue sem auditá-lo.

-- A função da 007 achava a loja pela zona da regra. A zona agora pode ser
-- nula; o dono está na própria regra.
create or replace function tg_config_versao_regra()
returns trigger language plpgsql as $$
begin
  perform bump_config_versao(coalesce(new.loja_id, old.loja_id));
  return null;
end $$;

create or replace function tg_config_versao_regra_alvo()
returns trigger language plpgsql as $$
declare v_loja uuid;
begin
  select r.loja_id into v_loja
    from regra r
   where r.id = coalesce(new.regra_id, old.regra_id);
  -- Nulo quando a própria regra está sendo apagada: o gatilho dela já
  -- subiu a versão.
  if v_loja is not null then perform bump_config_versao(v_loja); end if;
  return null;
end $$;

drop trigger if exists regra_alvo_config_versao on regra_alvo;
create trigger regra_alvo_config_versao
  after insert or update or delete on regra_alvo
  for each row execute function tg_config_versao_regra_alvo();
