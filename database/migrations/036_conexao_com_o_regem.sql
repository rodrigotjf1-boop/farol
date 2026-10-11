-- =====================================================================
-- Farol · migration 036 — a conexão com o Regem
-- =====================================================================
-- "Regem no Farol", fatia 1 (plano aprovado pelo dono em 11/10/2026): a
-- conta do Farol se conecta ao Regem, e cada loja de lá é ligada a uma
-- loja daqui. O Regem é a primeira FONTE de fichas e produtos; a base das
-- fichas vem na migration seguinte, com a leitura.
--
-- Como é o caminho, visto do banco:
--
--   1. a diretoria pede para conectar → nasce um `regem_pedido`, com a
--      impressão do `state` e o verificador do PKCE (cifrado). Vale 10
--      minutos e uma volta só;
--   2. a pessoa autoriza no Regem e volta com o código → o servidor troca o
--      código pelo acesso de cada loja autorizada → nasce um `regem_loja`
--      por loja, ainda SEM loja do Farol (`loja_id` vazio);
--   3. a diretoria diz qual loja do Farol é cada uma → `loja_id` é
--      preenchido. A que ficar sem par tem o acesso devolvido e a linha
--      apagada.
--
-- O ACESSO É SEGREDO. `acesso_cifrado` guarda o acesso da loja no Regem
-- cifrado (AES-256-GCM, com a chave que só o ambiente do servidor tem).
-- Ele não é devolvido por rota nenhuma, não desce para o agente e não
-- entra em registro. Sem a chave, o que está aqui não serve a ninguém.
--
-- Uma loja do Regem entra uma vez por conta, e cada loja do Farol é par de
-- no máximo uma loja do Regem: as duas regras ficam no banco, não só na
-- API.
--
-- Idempotente: pode rodar de novo sem efeito.
-- =====================================================================

-- O pedido de conexão em curso, da ida ao Regem até a volta.
create table if not exists regem_pedido (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid        not null references tenant(id) on delete cascade,
  -- Quem começou: só esta pessoa, com a sessão dela, termina.
  usuario_id          uuid        not null references usuario(id) on delete cascade,
  -- A impressão (sha256) do `state` que foi com a pessoa ao Regem. O valor
  -- em si não fica guardado.
  estado_hash         text        not null,
  -- O verificador do PKCE, cifrado: o Regem só entrega os acessos a quem o
  -- apresentar junto com o código.
  verificador_cifrado text        not null,
  criado_em           timestamptz not null default now(),
  expira_em           timestamptz not null,
  -- Preenchido na volta, qualquer que seja o desfecho: um pedido serve uma
  -- vez só.
  usado_em            timestamptz
);

create unique index if not exists regem_pedido_estado_uk on regem_pedido (estado_hash);

-- A faxina dos pedidos vencidos procura por aqui.
create index if not exists regem_pedido_expira_idx on regem_pedido (expira_em);

-- O acesso de UMA loja do Regem, e a loja do Farol a que ela foi ligada.
create table if not exists regem_loja (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid        not null references tenant(id) on delete cascade,
  -- A loja do Farol. Vazio = autorizada no Regem e ainda não ligada. Loja
  -- apagada leva a ligação junto (o acesso, do lado do Regem, a diretoria
  -- tira em Configurações → Aplicativos conectados).
  loja_id            uuid        references loja(id) on delete cascade,
  regem_loja_id      uuid        not null,
  regem_loja_nome    text        not null,
  regem_empresa_nome text        not null,
  acesso_cifrado     text        not null,
  conectado_por      uuid        references usuario(id) on delete set null,
  conectado_em       timestamptz not null default now(),
  ligado_em          timestamptz
);

-- A mesma loja do Regem não entra duas vezes na mesma conta: autorizar de
-- novo troca o acesso da linha que já existe.
create unique index if not exists regem_loja_regem_uk on regem_loja (tenant_id, regem_loja_id);

-- Uma loja do Farol é par de, no máximo, uma loja do Regem.
create unique index if not exists regem_loja_loja_uk on regem_loja (loja_id) where loja_id is not null;

comment on table regem_pedido is
  'Pedido de conexão com o Regem em curso: da ida da diretoria à página de '
  'autorização até a volta. Vale 10 minutos e uma volta.';
comment on table regem_loja is
  'O acesso de uma loja do Regem (cifrado) e a loja do Farol a que ela foi '
  'ligada. loja_id vazio = autorizada e ainda não ligada.';
comment on column regem_loja.acesso_cifrado is
  'O acesso da loja no Regem, cifrado com a chave do ambiente do servidor. '
  'Nunca sai por rota, nunca desce para o agente, nunca entra em registro.';
