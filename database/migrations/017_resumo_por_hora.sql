-- =====================================================================
-- Farol · migration 017 — o que o agente olhou, por hora
-- =====================================================================
-- Até aqui a nuvem só recebia o "não conforme" que virou alerta. O
-- conforme, o "não deu para avaliar", a câmera sem cena e o critério sem
-- juiz ficavam na loja. No console, uma loja calada podia ser cozinha em
-- ordem ou sistema parado — coisas opostas, com a mesma cara.
--
-- Esta tabela recebe, por hora, critério e canal, quantas vezes o agente
-- olhou e no que deu cada olhada. É dela que sai a tela "o que o Farol
-- viu" e os sinais de defeito.
--
-- ## Por que agregado, e não um registro por olhada
--
-- Oito canais a cada trinta segundos são 23 mil olhadas por dia e por
-- loja, quase todas "nada mudou". Guardar uma por uma encheria o banco de
-- linhas que ninguém vai ler, e mandaria para fora da loja muito mais do
-- que a pergunta precisa. O resumo responde "quanto" e "em que proporção";
-- o "o quê, exatamente" de um não conforme continua na tabela `evento`.
--
-- Agregado e sem pessoa: sobrevive ao expurgo de mídia.
--
-- ## Os contadores
--
-- Cada olhada termina em UM destes sete, e a soma deles é `capturas`:
--
--   sem_juiz      o critério está ligado e ninguém na loja sabe julgá-lo
--   sem_quadro    a câmera não entregou imagem
--   sem_cena      veio imagem, mas sem cena (tela de sem sinal, tampada)
--   em_silencio   já alertou há pouco; não se julga de novo
--   repetidas     a cena não mudou desde a última olhada
--   ja_julgadas   esta cena exata já tinha veredito
--   enfileiradas  foi para julgamento
--
-- O que foi enfileirado vira conforme, não conforme, não avaliável ou
-- falha (o juiz não respondeu).
--
-- ## Por que a chave tem o agente
--
-- O agente manda o ACUMULADO da hora, e a nuvem troca o valor antigo pelo
-- novo — assim um pedido repetido depois de uma queda de rede dá no mesmo.
-- Se a chave fosse só (critério, canal, hora), um agente reinstalado no
-- meio da hora começaria do zero e apagaria o que o anterior contou. Com o
-- agente na chave, cada instalação tem a sua linha e a leitura soma.
--
-- Agente apagado não leva o histórico junto: a coluna vira nula, e nulo
-- não conflita em índice único.
-- =====================================================================

create table if not exists resumo_hora (
  id                 bigint generated always as identity primary key,
  tenant_id          uuid not null references tenant(id) on delete cascade,
  loja_id            uuid not null references loja(id)   on delete cascade,
  agente_id          uuid references agente(id) on delete set null,
  regra_id           uuid not null references regra(id) on delete cascade,
  zona_id            uuid not null references zona(id)  on delete cascade,
  -- a hora cheia em que as cenas foram capturadas
  hora               timestamptz not null,

  capturas           integer not null default 0 check (capturas >= 0),
  sem_juiz           integer not null default 0 check (sem_juiz >= 0),
  sem_quadro         integer not null default 0 check (sem_quadro >= 0),
  sem_cena           integer not null default 0 check (sem_cena >= 0),
  em_silencio        integer not null default 0 check (em_silencio >= 0),
  repetidas          integer not null default 0 check (repetidas >= 0),
  ja_julgadas        integer not null default 0 check (ja_julgadas >= 0),
  enfileiradas       integer not null default 0 check (enfileiradas >= 0),

  conformes          integer not null default 0 check (conformes >= 0),
  nao_conformes      integer not null default 0 check (nao_conformes >= 0),
  nao_avaliaveis     integer not null default 0 check (nao_avaliaveis >= 0),
  falhas             integer not null default 0 check (falhas >= 0),
  alertas            integer not null default 0 check (alertas >= 0),

  -- soma e quantidade, não a média: média de média erra quando as horas
  -- têm volumes diferentes
  soma_confianca     numeric(12,4) not null default 0,
  com_confianca      integer not null default 0 check (com_confianca >= 0),
  soma_latencia_ms   bigint  not null default 0,
  com_latencia       integer not null default 0 check (com_latencia >= 0),
  custo_centavos     numeric(12,4) not null default 0,

  ultimo_resultado   text check (ultimo_resultado in ('conforme','nao_conforme','nao_avaliavel')),
  ultimo_motivo      text,
  -- por que NÃO deu para julgar, na última vez em que não deu
  ultimo_impedimento text,
  ultima_em          timestamptz,

  recebido_em        timestamptz not null default now(),
  atualizado_em      timestamptz not null default now()
);

create unique index if not exists resumo_hora_uk
  on resumo_hora (agente_id, regra_id, zona_id, hora);

-- A tela pergunta sempre "esta loja, deste instante para cá".
create index if not exists resumo_hora_loja_idx on resumo_hora (loja_id, hora desc);

comment on table resumo_hora is
  'Por hora, critério e canal: quantas vezes o agente olhou e no que deu. '
  'Agregado e sem pessoa. O agente manda o acumulado da hora e a nuvem '
  'substitui; a leitura soma as linhas de agentes diferentes.';
