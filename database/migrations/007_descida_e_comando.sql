-- =====================================================================
-- Farol · migration 007 — a descida da configuração e o comando de volta
-- =====================================================================
-- O agente vive atrás do NAT da loja e só fala de dentro para fora:
-- `ativar`, `heartbeat`, `eventos`. Não há rota da nuvem até ele, e não
-- vai haver — o produto promete não exigir mudança de rede.
--
-- Daí os dois caminhos desta migration, que resolvem problemas opostos:
--
--   CONFIGURAÇÃO desce porque o AGENTE pede. De dentro para fora, NAT
--   nenhum atrapalha. Só precisa de um jeito barato de ele saber que
--   mudou algo: `loja.config_versao`, um inteiro que o heartbeat devolve.
--   Igual ao que ele tem, não faz nada; diferente, puxa a configuração.
--   Sem isso, ou a configuração inteira trafega a cada batida, ou o
--   agente descobre a mudança tarde demais.
--
--   COMANDO desce porque a NUVEM pede ("capture um quadro agora"), e aí
--   não dá para esperar o agente lembrar de perguntar. Vai na resposta do
--   heartbeat, que já existe e já é autenticado pelo token do agente.
--
-- E `zona.principal` responde quem manda no recorte: o corte pertence ao
-- CANAL, o usuário desenha a região que importa, e na falta de desenho
-- vale o quadro inteiro. O sistema não adivinha recorte — corte
-- automático erraria calado, cortando justamente o que importa, e o
-- veredito sairia confiante sobre o pedaço errado.
-- =====================================================================

-- ───────────────── a versão da configuração da loja ─────────────────

alter table loja
  add column if not exists config_versao integer not null default 1;

comment on column loja.config_versao is
  'Sobe a cada mudança em ponto, zona ou regra desta loja. O heartbeat '
  'devolve este número; o agente compara com o que tem e só puxa quando '
  'difere.';

-- Quem sobe a versão é um gatilho, não a rota. Rota que lembra de
-- incrementar é rota que um dia esquece — e configuração que não desce
-- falha em silêncio: a loja segue analisando pela regra velha e ninguém
-- percebe até alguém conferir na mão.
create or replace function bump_config_versao(p_loja_id uuid)
returns void language sql as $$
  update loja set config_versao = config_versao + 1 where id = p_loja_id;
$$;

create or replace function tg_config_versao_ponto()
returns trigger language plpgsql as $$
declare v_loja uuid;
begin
  select st.loja_id into v_loja
    from setor st
   where st.id = coalesce(new.setor_id, old.setor_id);
  if v_loja is not null then perform bump_config_versao(v_loja); end if;
  return null;
end $$;

create or replace function tg_config_versao_zona()
returns trigger language plpgsql as $$
declare v_loja uuid;
begin
  select st.loja_id into v_loja
    from ponto p join setor st on st.id = p.setor_id
   where p.id = coalesce(new.ponto_id, old.ponto_id);
  if v_loja is not null then perform bump_config_versao(v_loja); end if;
  return null;
end $$;

create or replace function tg_config_versao_regra()
returns trigger language plpgsql as $$
declare v_loja uuid;
begin
  select st.loja_id into v_loja
    from zona z
    join ponto p on p.id = z.ponto_id
    join setor st on st.id = p.setor_id
   where z.id = coalesce(new.zona_id, old.zona_id);
  if v_loja is not null then perform bump_config_versao(v_loja); end if;
  return null;
end $$;

drop trigger if exists ponto_config_versao on ponto;
create trigger ponto_config_versao
  after insert or update or delete on ponto
  for each row execute function tg_config_versao_ponto();

drop trigger if exists zona_config_versao on zona;
create trigger zona_config_versao
  after insert or update or delete on zona
  for each row execute function tg_config_versao_zona();

drop trigger if exists regra_config_versao on regra;
create trigger regra_config_versao
  after insert or update or delete on regra
  for each row execute function tg_config_versao_regra();

-- ──────────────────── o corte principal do canal ────────────────────

alter table zona
  add column if not exists principal boolean not null default false;

comment on column zona.principal is
  'O corte DO CANAL: a região que o usuário desenhou como importante. '
  'Vale para toda análise do ponto que não mire uma zona específica. '
  'Na falta de desenho, a zona "Quadro inteiro" é a principal.';

-- Um canal tem um corte principal, não dois. Índice parcial: só as
-- principais disputam unicidade.
create unique index if not exists zona_principal_por_ponto
  on zona (ponto_id) where principal;

-- Os pontos que já existem ficam com a zona que têm como principal —
-- sem isto o agente não teria recorte nenhum para usar depois da
-- atualização, e passaria a mandar o quadro inteiro sem ninguém pedir.
update zona z
   set principal = true
 where not exists (select 1 from zona o where o.ponto_id = z.ponto_id and o.principal)
   and z.id = (select min(o2.id::text)::uuid from zona o2 where o2.ponto_id = z.ponto_id);

-- ─────────────────────── comando para o agente ───────────────────────

create table if not exists comando_agente (
  id             uuid primary key default gen_random_uuid(),
  agente_id      uuid not null references agente(id) on delete cascade,
  tipo           text not null check (tipo in ('capturar_quadro')),
  ponto_id       uuid references ponto(id) on delete cascade,
  parametros     jsonb not null default '{}'::jsonb,
  estado         text not null default 'pendente'
                 check (estado in ('pendente','entregue','concluido','expirado','falhou')),
  resultado_url  text,
  erro           text,
  criado_por     uuid references usuario(id) on delete set null,
  criado_em      timestamptz not null default now(),
  entregue_em    timestamptz,
  concluido_em   timestamptz,
  -- Comando expira. Sem isto, um agente que estava offline acorda horas
  -- depois e captura um quadro que ninguém mais espera — a tela que
  -- pediu já foi fechada, e a imagem vira lixo com cena real da loja
  -- dentro.
  expira_em      timestamptz not null default now() + interval '2 minutes'
);

-- A busca do agente é sempre "o que está pendente para mim e ainda vale".
create index if not exists comando_pendente_idx
  on comando_agente (agente_id, criado_em)
  where estado = 'pendente';

create index if not exists comando_ponto_idx on comando_agente (ponto_id);
