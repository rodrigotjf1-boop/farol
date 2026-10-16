-- =====================================================================
-- Farol · migration 052 — o horário do computador da loja
-- =====================================================================
-- A22, fatia P2. O pedido do dono (15/10/2026): "uma forma do servidor ser
-- programado para desligar e ligar preenchendo um horário, a desligada e a
-- ligada". O protótipo foi aprovado em 16/10/2026, com o horário dele:
-- dormir 1 hora depois de fechar e acordar 1 hora antes de abrir.
--
-- O horário é da LOJA (como o de funcionamento) e desce para o agente na
-- configuração: quem aplica é o agente (fatia P3), no relógio do
-- computador. O formato (conferido em `api/src/computador.ts` e no
-- contrato `contratos/horario-do-computador.json`):
--
--   { "ligado": true,
--     "dias": [{ "dia": 1, "dorme": "04:00", "acorda": "18:00" }, …] }
--
--   os sete dias (1 = segunda … 7 = domingo); dorme e acorda em HH:MM, ou
--   nulo. Nulo na coluna = nunca programado (o computador fica ligado o
--   tempo todo, como até aqui).
--
-- Salvar sobe a `config_versao` da loja na mesma linha (como o horário de
-- funcionamento): é por ela que o agente sabe que precisa puxar de novo.
-- =====================================================================

alter table loja add column if not exists horario_computador jsonb;

comment on column loja.horario_computador is
  'O horário em que o computador da loja dorme e acorda sozinho (A22): {ligado, dias:[{dia, dorme, acorda}]}, no relógio da loja. Nulo = nunca programado.';
