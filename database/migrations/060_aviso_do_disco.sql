-- =====================================================================
-- Farol · migration 060 — o aviso da máquina ganha o DISCO QUASE CHEIO
-- =====================================================================
-- Em 27/10/2026 o disco do computador da loja encheu às 21h20 e a bancada
-- ao vivo parou de ver lanches até a meia-noite (ERR-156 do registro
-- interno). O disco livre já chega a cada hora (`uso_hora.disco_livre_gb`)
-- e aparecia só na tela Saúde; agora vira aviso pelos destinos dos
-- alertas, como o calor e a sobrecarga (`api/src/aviso-da-maquina.ts`).
--
--   • `computador_aviso.tipo` ganha 'disco' — um a cada 12 horas por
--     computador, contadas desde o último, como os outros dois.
--
-- Idempotente: pode rodar de novo sem efeito.
-- =====================================================================

alter table computador_aviso drop constraint if exists computador_aviso_tipo_check;
alter table computador_aviso
  add constraint computador_aviso_tipo_check
  check (tipo in ('esquentando', 'sobrecarregado', 'disco'));
