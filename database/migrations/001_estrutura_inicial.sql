-- =====================================================================
-- Farol · migration 001 — estrutura inicial
-- =====================================================================
-- Modelo completo da v1. Campos que só serão usados nas camadas finais
-- (julgamento local, base de conhecimento, contagem treinada, retenção)
-- nascem aqui de propósito: coluna em tabela vazia é trivial; em tabela
-- com um ano de evento de loja de cliente é migração de madrugada.
--
-- Convenções: uuid como PK, snake_case, criado_em/atualizado_em em tudo
-- que é editável, idempotente (if not exists / guardas).
-- =====================================================================

create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- ─────────────────────────── tenant e acesso ───────────────────────────

create table if not exists tenant (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  documento     text,                                   -- CNPJ
  plano         text not null default 'trial'
                check (plano in ('trial','essencial','completo','local')),
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists usuario (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete cascade,
  nome          text not null,
  email         text not null,
  senha_hash    text not null,
  nivel         text not null default 'execucao'
                check (nivel in ('presidente','gerente','supervisao','execucao','suporte')),
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists usuario_tenant_email_uk on usuario (tenant_id, lower(email));

-- ─────────────────────────── hierarquia física ─────────────────────────

create table if not exists loja (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenant(id) on delete cascade,
  nome            text not null,
  timezone        text not null default 'America/Sao_Paulo',
  -- o campo que torna o app configurável: onde o modelo de visão roda
  modo_julgamento text not null default 'nuvem'
                  check (modo_julgamento in ('nuvem','local','hibrido')),
  -- resolução padrão do recorte enviado ao modelo
  resolucao_padrao text not null default 'r640'
                  check (resolucao_padrao in ('r384','r640','r1mp','r1080')),
  ativa           boolean not null default true,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);
create index if not exists loja_tenant_idx on loja (tenant_id);

create table if not exists setor (
  id            uuid primary key default gen_random_uuid(),
  loja_id       uuid not null references loja(id) on delete cascade,
  nome          text not null,
  ordem         integer not null default 0,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists setor_loja_idx on setor (loja_id);

-- ponto = uma câmera. Pode vir de canal do gravador ou IP direta no agente.
create table if not exists ponto (
  id             uuid primary key default gen_random_uuid(),
  setor_id       uuid not null references setor(id) on delete cascade,
  nome           text not null,
  origem         text not null default 'dvr' check (origem in ('dvr','ip')),
  fabricante     text,                                  -- intelbras | hikvision | dahua | …
  canal          integer,                               -- quando origem = dvr
  host           text,
  porta          integer default 554,
  usuario        text,
  -- segredo NÃO fica aqui: referência ao cofre do agente
  segredo_ref    text,
  url_main       text,                                  -- resolvido pelo catálogo de perfis
  url_sub        text,
  -- a estação de montagem dedicada precisa de gabarito replicável entre estações
  gabarito       jsonb,                                 -- {altura_cm, angulo_graus, distancia_cm, led}
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index if not exists ponto_setor_idx on ponto (setor_id);

create table if not exists zona (
  id            uuid primary key default gen_random_uuid(),
  ponto_id      uuid not null references ponto(id) on delete cascade,
  nome          text not null,
  poligono      jsonb not null,                         -- [[x,y],…] normalizado 0..1
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists zona_ponto_idx on zona (ponto_id);

-- ─────────────────────── base de conhecimento ──────────────────────────
-- item  = um ingrediente, um utensílio
-- padrao = como a bancada deve ficar no fechamento

create table if not exists base_conhecimento (
  id            uuid primary key default gen_random_uuid(),
  loja_id       uuid not null references loja(id) on delete cascade,
  tipo          text not null check (tipo in ('item','padrao')),
  nome          text not null,
  descricao     text,
  -- limiar de similaridade abaixo do qual escala para o modelo de visão
  limiar        numeric(4,3) not null default 0.880,
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists base_loja_idx on base_conhecimento (loja_id);

create table if not exists base_frame (
  id            uuid primary key default gen_random_uuid(),
  base_id       uuid not null references base_conhecimento(id) on delete cascade,
  url           text not null,
  -- SigLIP 2 ViT-B → 768 dimensões
  embedding     vector(768),
  principal     boolean not null default false,
  criado_em     timestamptz not null default now()
);
create index if not exists base_frame_base_idx on base_frame (base_id);

-- ───────────────────────────── regras ──────────────────────────────────

create table if not exists regra (
  id                  uuid primary key default gen_random_uuid(),
  zona_id             uuid not null references zona(id) on delete cascade,
  nome                text not null,
  tipo                text not null
                      check (tipo in ('estado','acao','presenca','contagem','comparacao')),
  criterio            text not null,                    -- o que é "conforme", em texto
  criterio_versao     integer not null default 1,
  processo_descricao  text,                             -- o POP, para contexto humano
  prioridade          text not null default 'intermediaria'
                      check (prioridade in ('urgente','intermediaria','leve')),
  severidade          text not null default 'atencao'
                      check (severidade in ('info','atencao','critico','emergencia')),
  confianca_minima    numeric(4,3) not null default 0.700,
  cooldown_min        integer not null default 15,
  resolucao           text check (resolucao in ('r384','r640','r1mp','r1080')),
  -- [{dias:[1..7], hora_ini:'HH:MM', hora_fim:'HH:MM'}]  — vazio = sempre
  janelas             jsonb not null default '[]'::jsonb,
  -- ['whatsapp','kds','registro','tarefa_regem','tv_regemboard']
  acoes               jsonb not null default '["registro"]'::jsonb,
  base_id             uuid references base_conhecimento(id) on delete set null,
  -- regras que nascem desligadas até ter acurácia medida
  ativa               boolean not null default false,
  retencao_midia_dias integer not null default 90,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);
create index if not exists regra_zona_idx on regra (zona_id);
create index if not exists regra_ativa_idx on regra (ativa) where ativa;

-- ───────────────────────────── agente ──────────────────────────────────

create table if not exists agente (
  id                uuid primary key default gen_random_uuid(),
  loja_id           uuid not null references loja(id) on delete cascade,
  nome              text not null,
  fingerprint       text not null,
  versao            text,
  ultimo_heartbeat  timestamptz,
  estado            text not null default 'novo'
                    check (estado in ('novo','ativo','inativo','bloqueado')),
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);
create unique index if not exists agente_fingerprint_uk on agente (fingerprint);
create index if not exists agente_loja_idx on agente (loja_id);

-- ───────────────────────────── eventos ─────────────────────────────────

create table if not exists evento (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenant(id) on delete cascade,
  loja_id           uuid not null references loja(id) on delete cascade,
  regra_id          uuid references regra(id) on delete set null,
  zona_id           uuid references zona(id) on delete set null,
  ocorrido_em       timestamptz not null,
  veredito          text not null
                    check (veredito in ('conforme','nao_conforme','nao_avaliavel')),
  confianca         numeric(4,3),
  motivo            text,
  -- imagem só existe quando há alerta; conformidade é linha de métrica
  midia_url         text,
  -- proveniência: dá para auditar custo e comparar modelo depois
  modelo            text,
  via               text check (via in ('nuvem','local','comparacao','detector')),
  tokens_entrada    integer,
  tokens_saida      integer,
  custo_centavos    numeric(10,4),
  latencia_ms       integer,
  prioridade        text check (prioridade in ('urgente','intermediaria','leve')),
  em_lote           boolean not null default false,
  -- busca por descrição sem reprocessar nada
  embedding         vector(768),
  -- gerada no cliente: retry após queda de internet não duplica nada
  idempotencia_key  text not null,
  criado_em         timestamptz not null default now()
);
create unique index if not exists evento_idempotencia_uk on evento (idempotencia_key);
create index if not exists evento_loja_data_idx on evento (loja_id, ocorrido_em desc);
create index if not exists evento_regra_idx on evento (regra_id, ocorrido_em desc);
create index if not exists evento_veredito_idx on evento (loja_id, veredito, ocorrido_em desc);

create table if not exists evento_revisao (
  id              uuid primary key default gen_random_uuid(),
  evento_id       uuid not null references evento(id) on delete cascade,
  veredito_humano text not null
                  check (veredito_humano in ('conforme','nao_conforme','nao_avaliavel')),
  usuario_id      uuid references usuario(id) on delete set null,
  observacao      text,
  -- revisão vira conjunto de avaliação: é assim que o sistema melhora
  no_conjunto     boolean not null default true,
  criado_em       timestamptz not null default now()
);
create index if not exists evento_revisao_evento_idx on evento_revisao (evento_id);

-- ───────────────────────── métricas do dia ─────────────────────────────
-- Agregada e sem pessoa: é a única coisa que sobrevive ao expurgo.

create table if not exists metrica_dia (
  id              uuid primary key default gen_random_uuid(),
  loja_id         uuid not null references loja(id) on delete cascade,
  dia             date not null,
  regra_id        uuid references regra(id) on delete set null,
  setor_id        uuid references setor(id) on delete set null,
  total           integer not null default 0,
  conformes       integer not null default 0,
  nao_conformes   integer not null default 0,
  nao_avaliaveis  integer not null default 0,
  -- a pergunta que leva à decisão: "isso está virando padrão?"
  reincidencia_max integer not null default 0,
  custo_centavos  numeric(10,4) not null default 0,
  atualizado_em   timestamptz not null default now()
);
create unique index if not exists metrica_dia_uk on metrica_dia (loja_id, dia, coalesce(regra_id,'00000000-0000-0000-0000-000000000000'::uuid));

-- ───────────────────────────── auditoria ───────────────────────────────

create table if not exists auditoria (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references tenant(id) on delete set null,
  usuario_id  uuid references usuario(id) on delete set null,
  nivel       text,
  acao        text not null,
  detalhe     jsonb,
  origem      text,
  criado_em   timestamptz not null default now()
);
create index if not exists auditoria_tenant_data_idx on auditoria (tenant_id, criado_em desc);

-- Log de consulta à busca: quem pesquisou o quê. Exigência de LGPD quando
-- existe índice pesquisável de atividade humana.
create table if not exists busca_log (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references tenant(id) on delete set null,
  usuario_id  uuid references usuario(id) on delete set null,
  loja_id     uuid references loja(id) on delete set null,
  termo       text,
  filtros     jsonb,
  resultados  integer,
  criado_em   timestamptz not null default now()
);
create index if not exists busca_log_tenant_idx on busca_log (tenant_id, criado_em desc);

-- ─────────────────── catálogo de perfis de gravador ────────────────────
-- É o que faz instalação em loja nova durar uma hora em vez de um dia.

create table if not exists perfil_gravador (
  id              uuid primary key default gen_random_uuid(),
  fabricante      text not null,
  modelo          text,
  url_main_tpl    text not null,
  url_sub_tpl     text not null,
  porta_padrao    integer not null default 554,
  evento_tipo     text check (evento_tipo in ('isapi','dahua_cgi','onvif','nenhum')),
  evento_tpl      text,
  observacoes     text,
  criado_em       timestamptz not null default now()
);
create unique index if not exists perfil_gravador_uk on perfil_gravador (fabricante, coalesce(modelo,''));

-- Perfil do MHDX 3116-C, confirmado na ficha técnica da distribuidora em 03/10/2026.
-- ⚠️ A inteligência de vídeo roda em 1 canal só — a detecção de MOVIMENTO
-- existe em todos os 16, e é ela que serve de gatilho bruto. A classificação
-- "é pessoa?" acontece no agente, não no gravador.
insert into perfil_gravador (fabricante, modelo, url_main_tpl, url_sub_tpl, evento_tipo, evento_tpl, observacoes)
values (
  'intelbras', 'MHDX 3116-C',
  'rtsp://{usuario}:{senha}@{host}:{porta}/cam/realmonitor?channel={canal}&subtype=0',
  'rtsp://{usuario}:{senha}@{host}:{porta}/cam/realmonitor?channel={canal}&subtype=1',
  'dahua_cgi',
  'http://{host}/cgi-bin/eventManager.cgi?action=attach&codes=[All]&heartbeat=5',
  'Dahua OEM. Rede Gigabit, throughput 96 Mbps, 128 conexoes. Sub-stream D1/CIF. '
  || 'Inteligencia de video em 1 canal apenas; movimento em todos. '
  || 'Firmware trunca a lista de codes em ~100 caracteres: usar [All] e filtrar no agente. '
  || 'Desligar deteccao de face: dado biometrico.'
) on conflict do nothing;
