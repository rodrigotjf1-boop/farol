-- =====================================================================
-- Farol · migration 046 — a credencial própria de quem entrega os alertas
-- =====================================================================
-- Pedido da sessão do Hub DMS (14/10/2026, decisão D10 do dono: abrir já
-- as correções das brechas dos produtos), aprovado pelo dono no mesmo dia
-- ("Pode"): as rotas do transporte — `POST /v1/envios/reivindicar` e
-- `POST /v1/envios/:id/resultado` — aceitavam a credencial geral da
-- distribuição (`x-farol-admin`), a mesma que emite agente e cadastra loja.
-- Quem entregasse os alertas carregaria a chave mestra de todas as lojas.
--
-- **transporte** — quem entrega (o n8n, o Regem), um por linha:
--
--   • o token é do transporte e só serve para reivindicar e devolver
--     envios; o banco guarda só o resumo (SHA-256), como no agente — nem
--     quem administra consegue lê-lo depois de emitido;
--   • `tipos` diz que destinos ele pode entregar (o n8n, WhatsApp e
--     e-mail; o Regem, o KDS): o envio de outro tipo não chega a ele;
--   • revogar um não derruba o outro (`revogado_em`); o nome só não pode
--     repetir entre os que estão valendo.
--
-- **envio.transporte_id** — quem reivindicou o envio. O resultado só é
-- aceito de quem o reivindicou.
--
-- Nada muda para quem já está no ar: a tabela nasce vazia e a coluna nova
-- nasce nula. Conferido pelo dono no console em 14/10/2026: nenhum envio
-- tinha sido reivindicado até hoje (todos "na fila", 0 tentativas) — não
-- há envio "mandado" sem transporte esperando resultado.
--
-- Idempotente: pode rodar de novo sem efeito.
-- =====================================================================

create table if not exists transporte (
  id           uuid primary key default gen_random_uuid(),
  nome         text not null check (length(btrim(nome)) between 1 and 60),
  tipos        text[] not null
               check (cardinality(tipos) >= 1 and tipos <@ array['whatsapp', 'email', 'kds', 'webhook']),
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  criado_em    timestamptz not null default now(),
  usado_em     timestamptz,
  revogado_em  timestamptz
);

-- O nome não repete entre os que estão valendo: revogado, o nome fica livre para o próximo.
create unique index if not exists transporte_nome_valendo_uk
  on transporte (lower(btrim(nome))) where revogado_em is null;

alter table envio add column if not exists transporte_id uuid references transporte(id) on delete set null;

comment on table transporte is
  'Quem entrega os alertas (n8n, Regem). O token só reivindica e devolve '
  'envios dos tipos da linha; o banco guarda só o resumo. A chave geral da '
  'distribuição não vale nessas rotas (migration 046).';
comment on column envio.transporte_id is
  'Quem reivindicou o envio. O resultado só é aceito dele.';
