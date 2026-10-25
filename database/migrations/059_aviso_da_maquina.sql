-- =====================================================================
-- Farol · migration 059 — o aviso da máquina (A26, M3)
-- =====================================================================
-- O pedido do dono (25/10/2026): saber "se o pc está sobrecarregado, se
-- sobreaquece". A tela (M2) mostra o relatório; esta parte avisa, pelos
-- destinos dos alertas, quando o computador do agente está esquentando ou
-- no limite (`api/src/aviso-da-maquina.ts`).
--
--   • `envio.motivo` ganha 'computador' — o payload diz o tipo
--     ('esquentando' ou 'sobrecarregado'), o porquê e o texto pronto;
--   • `computador_aviso` guarda, por computador e tipo, a hora do último
--     aviso: um de cada tipo a cada 12 horas, contadas desde ele. A marca
--     troca na mesma instrução que cria os envios.
--
-- Idempotente: pode rodar de novo sem efeito.
-- =====================================================================

-- O motivo novo. A restrição é recriada com os quatro.
alter table envio drop constraint if exists envio_motivo_check;
alter table envio
  add constraint envio_motivo_check
  check (motivo in ('evento', 'agente_caiu', 'busca_concluida', 'computador'));

create table if not exists computador_aviso (
  agente_id  uuid not null references agente(id) on delete cascade,
  tipo       text not null check (tipo in ('esquentando', 'sobrecarregado')),
  tenant_id  uuid not null references tenant(id) on delete cascade,
  loja_id    uuid not null references loja(id)   on delete cascade,
  ultimo_em  timestamptz not null,
  primary key (agente_id, tipo)
);
