-- =====================================================================
-- Farol · migration 045 — o balcão: o registro de cada dúvida e do custo dela
-- =====================================================================
-- A20, "a dúvida passa pelo nosso servidor" — o balcão, fase 1d (a porta).
-- O plano foi aprovado pelo dono em 13/10/2026; o teto de gasto por loja e
-- por dia, no piloto, é de R$ 40,00.
--
-- **duvida** — uma linha por pergunta que o servidor fez (ou está fazendo)
-- a uma plataforma de IA em nome de uma loja, com a conta DELA. É daqui
-- que saem três coisas:
--
--   • o TETO DO DIA: antes de perguntar, soma-se o que a loja já gastou no
--     dia da operação (`dia` — a madrugada pertence à noite anterior, como
--     no resto do Farol) e o que está reservado para as perguntas em voo;
--   • a RESPOSTA REPETIDA: a mesma dúvida (a mesma `chave`, que o agente
--     manda) não é paga duas vezes — a segunda recebe a resposta guardada;
--   • a CONTA: quanto cada loja gastou, com que modelo, e quantas vezes o
--     modelo forte foi reconsultado.
--
-- O que NÃO é guardado, de propósito: a imagem (nenhuma delas) e o texto do
-- pedido. O servidor recebe as imagens, repassa à plataforma e esquece.
-- Fica o veredito — o resultado, a confiança e o motivo, a mesma frase que
-- o agente já manda quando o critério vira aviso.
--
-- Os estados:
--   perguntando  a reserva foi feita e a chamada está em voo (ou o servidor
--                caiu no meio: passado um tempo, a dúvida pode ser tentada
--                de novo);
--   respondida   a plataforma respondeu, e o veredito está guardado;
--   falhou       não houve veredito; `falha` diz de que lado foi o erro. A
--                reserva é solta, e a mesma dúvida pode ser tentada de novo.
--
-- O critério, o canal e a área vão sem chave estrangeira: o registro é
-- histórico, e não some quando o critério é excluído.
--
-- Nada muda para quem já está no ar: a tabela nasce vazia, nenhuma linha
-- existente é atualizada e nenhum gatilho mexe na versão da configuração.
--
-- Idempotente: pode rodar de novo sem efeito.
-- =====================================================================

create table if not exists duvida (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenant(id) on delete cascade,
  loja_id             uuid not null references loja(id) on delete cascade,
  agente_id           uuid references agente(id) on delete set null,
  -- A chave da dúvida: quem a faz é o agente, e ela é a mesma enquanto a cena e a pergunta forem as mesmas.
  chave               text not null check (chave ~ '^[0-9a-f]{32}$'),
  regra_id            uuid not null,
  criterio_versao     integer not null check (criterio_versao >= 1),
  ponto_id            uuid not null,
  zona_id             uuid not null,
  config_versao       integer not null,
  -- O dia da operação da loja em que a dúvida foi feita: é por ele que se soma o teto.
  dia                 date not null,
  estado              text not null check (estado in ('perguntando', 'respondida', 'falhou')),
  tentativas          integer not null default 1 check (tentativas >= 1),
  -- Quanto esta dúvida segura do teto enquanto não se sabe o custo dela.
  reservado_centavos  double precision not null check (reservado_centavos >= 0),
  provedor            text not null,
  modelo              text,
  reconsultou         boolean not null default false,
  resultado           text check (resultado in ('conforme', 'nao_conforme', 'nao_avaliavel')),
  confianca           double precision check (confianca between 0 and 1),
  motivo              text,
  tokens_entrada      integer,
  tokens_saida        integer,
  -- Em centavos de real, com todas as casas: é o número devolvido a quem perguntou, e a quem perguntar de novo.
  custo_centavos      double precision check (custo_centavos >= 0),
  latencia_ms         integer,
  -- De que lado foi o erro, quando não houve veredito.
  falha               text check (falha in ('conta', 'pedido', 'limite', 'plataforma', 'resposta')),
  criada_em           timestamptz not null default now(),
  tentada_em          timestamptz not null default now(),
  respondida_em       timestamptz,
  constraint duvida_uma_por_chave unique (loja_id, chave),
  constraint duvida_respondida_tem_resposta
    check (estado <> 'respondida' or (resultado is not null and modelo is not null and respondida_em is not null)),
  constraint duvida_que_falhou_diz_onde
    check ((estado = 'falhou') = (falha is not null))
);

-- O teto do dia: o que a loja gastou naquele dia.
create index if not exists duvida_loja_dia_idx on duvida (loja_id, dia);
-- O limite por minuto: o que a loja perguntou agora há pouco.
create index if not exists duvida_loja_tentada_idx on duvida (loja_id, tentada_em);
