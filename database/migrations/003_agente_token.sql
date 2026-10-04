-- =====================================================================
-- Farol · migration 003 — credencial do agente
-- =====================================================================
-- O agente precisa provar quem é para mandar evento. A 001 deu a ele
-- `fingerprint`, que identifica a máquina mas NÃO é segredo: é derivado de
-- hardware, é previsível e o próprio agente o anuncia antes de estar
-- autorizado. Identificador não serve como senha.
--
-- O fluxo que este modelo permite:
--   1. agente instalado se apresenta com o fingerprint    → estado 'novo'
--   2. o dono aprova no console                           → emite o token
--   3. o token aparece UMA vez e vira hash aqui           → estado 'ativo'
--   4. agente manda evento com Authorization: Bearer ...
--
-- Guardamos o **hash**, nunca o token. Vazamento do banco não entrega
-- acesso de escrita a nenhuma loja, e nem eu consigo ler o token de um
-- agente já instalado — o que é o ponto.
-- =====================================================================

alter table agente add column if not exists token_hash      text;
alter table agente add column if not exists token_emitido_em timestamptz;
alter table agente add column if not exists token_usado_em   timestamptz;

-- Dois agentes não podem compartilhar credencial: se acontecesse, revogar
-- um derrubaria o outro, e o log apontaria para a máquina errada.
create unique index if not exists agente_token_hash_uk
  on agente (token_hash) where token_hash is not null;

-- O evento chega pelo agente; guardar qual deles permite auditar e revogar
-- com precisão depois. Sem isto, "de onde veio este evento" só se responde
-- por aproximação.
alter table evento add column if not exists agente_id uuid
  references agente(id) on delete set null;

create index if not exists evento_agente_idx on evento (agente_id, criado_em desc);

-- Busca da tela de métricas e da linha do tempo: por loja e dia.
create index if not exists evento_loja_ocorrido_idx
  on evento (loja_id, ocorrido_em desc);

-- Só os alertas, que é o que a tela abre primeiro. Índice parcial porque
-- conformidade é a esmagadora maioria das linhas e não se consulta assim.
create index if not exists evento_nao_conforme_idx
  on evento (loja_id, ocorrido_em desc) where veredito = 'nao_conforme';
