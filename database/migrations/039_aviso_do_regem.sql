-- =====================================================================
-- Farol · migration 039 — o aviso do Regem
-- =====================================================================
-- Pedido do dono em 11/10/2026: "as fichas, ao serem alteradas no Regem,
-- já enviam ao Farol as modificações, em vez de o Farol ficar buscando".
--
-- O Regem tem um aviso assinado de "algo mudou nesta loja" (padrão
-- Standard Webhooks). O aviso NÃO leva dado: é só o gatilho, e quem lê é a
-- leitura de sempre. O que entra aqui é o estado desse aviso, na conexão
-- de cada loja (`regem_loja`), e nada mais:
--
--   • o SEGREDO com que o Regem assina o aviso desta loja. É sorteado pelo
--     servidor do Farol e entregue ao Regem no registro; fica cifrado, com
--     a mesma chave dos acessos, e não sai por rota, tela nem registro;
--   • quando o registro foi aceito pelo Regem e quando foi tentado — o
--     Farol registra ao ler (ao ligar a loja, uma vez por dia e a pedido),
--     nunca de minutos em minutos;
--   • quando chegou o último aviso;
--   • o aviso que chegou e AINDA não foi atendido por uma leitura. É o que
--     faz a rotina ler de novo a loja cujo aviso chegou no meio de outra
--     leitura: aviso a mais não custa, aviso perdido custaria um dia.
--
-- Nenhuma linha que já existe é alterada: as colunas nascem vazias, e loja
-- ligada sem registro é registrada na leitura seguinte.
--
-- A leitura diária e o "Buscar agora" continuam: são a rede de segurança.
--
-- Idempotente: pode rodar de novo sem efeito.
-- =====================================================================

alter table regem_loja add column if not exists aviso_segredo_cifrado text;
alter table regem_loja add column if not exists aviso_registrado_em   timestamptz;
alter table regem_loja add column if not exists aviso_tentado_em      timestamptz;
alter table regem_loja add column if not exists aviso_recebido_em     timestamptz;
alter table regem_loja add column if not exists aviso_pendente_desde  timestamptz;

comment on column regem_loja.aviso_segredo_cifrado is
  'O segredo com que o Regem assina o aviso desta loja, cifrado com a chave '
  'do ambiente do servidor. Sorteado pelo Farol; nunca sai por rota, tela '
  'nem registro. Vazio = o aviso ainda não foi registrado.';
comment on column regem_loja.aviso_registrado_em is
  'Quando o Regem aceitou o registro do aviso. Vazio = não registrado (o '
  'Regem ainda não aceita, ou a tentativa falhou): vale só a leitura diária.';
comment on column regem_loja.aviso_pendente_desde is
  'Um aviso chegou e nenhuma leitura começou depois dele. A rotina lê a '
  'loja na próxima volta; começar uma leitura limpa a marca.';
