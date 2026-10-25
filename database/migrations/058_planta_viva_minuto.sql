-- =====================================================================
-- Farol · migration 058 — as pessoas na planta, por minuto (A26, P3)
-- =====================================================================
-- O agente (`agent/farol_agent/planta_viva/`) leva o pé de cada pessoa ao
-- chão da planta pelas câmeras calibradas (migration 057), junta as
-- câmeras e segue cada caminho SEM NOME. A cada minuto sobe:
--
--   • calor   — os segundos-pessoa em cada célula do piso
--               ([[i, j, segundos], …], célula de `celula_m` metros);
--   • pico    — quantas pessoas ao mesmo tempo, no máximo;
--   • caminhos — o caminho de cada um, 1 ponto por segundo, para o replay
--               ([[numero, [[segundo, x, y], …]], …]); o número é do dia e
--               não diz quem é.
--
-- O tempo em cada posto a nuvem conta na leitura, do calor com a planta.
-- Sem imagem, sem nome, sem rosto (estudo da planta viva, seção 7). A
-- guarda é curta: o caminho some em 7 dias; o minuto inteiro em 90
-- (`api/src/rotas/planta-viva.ts`).
--
-- Tabela nova. Idempotente.
-- =====================================================================

create table if not exists planta_minuto (
  loja_id    uuid not null references loja(id)   on delete cascade,
  minuto     timestamptz not null,
  tenant_id  uuid not null references tenant(id) on delete cascade,
  agente_id  uuid not null references agente(id) on delete cascade,
  celula_m   numeric(4,2) not null check (celula_m in (0.25, 0.5)),
  calor      jsonb not null,
  pico       smallint not null check (pico between 0 and 60),
  caminhos   jsonb,
  recebido_em timestamptz not null default now(),
  primary key (loja_id, minuto),
  check (date_trunc('minute', minuto) = minuto)
);

comment on table planta_minuto is
  'As pessoas na planta, por minuto e sem nome (migration 058): o calor por célula, o pico e os caminhos para o replay (7 dias).';
