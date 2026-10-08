-- =====================================================================
-- Farol · migration 021 — o uso da máquina de análise, por hora
-- =====================================================================
-- Pedido do dono em 07/10/2026, ao aprovar a tela de Análises: "incluir
-- análise de uso do servidor de análise, a máquina local; opção de
-- analisar uso junto com os filtros". A pergunta por trás é de capacidade:
-- o computador da loja está dando conta? cabe mais uma câmera?
--
-- O agente tira uma amostra por volta (uns trinta segundos) e manda, por
-- hora, o ACUMULADO de cada peça: soma e quantidade de amostras (para a
-- média) e o maior valor (o pico). A nuvem troca o valor antigo pelo novo,
-- como no resumo por hora — um pedido repetido dá no mesmo.
--
-- ## Por que soma e quantidade, e não a média
--
-- Quem junta várias horas (ou vários dias) é a leitura. Média de média
-- erra quando as horas têm quantidades diferentes de amostras — a hora em
-- que o agente foi reiniciado tem metade.
--
-- ## Por que cada peça tem a SUA quantidade
--
-- "Não medi" não é zero. Máquina sem contador de placa de vídeo manda
-- `gpu_amostras = 0` e pico nulo; a média dela não existe, e a tela diz
-- "sem medida" em vez de 0%.
--
-- ## O que cada número é
--
-- cpu / gpu   ocupação MÉDIA da máquina inteira entre duas amostras. O pico
--             é a maior dessas médias — carga sustentada, não um estouro
--             de meio segundo.
-- mem         memória em uso na hora da amostra.
-- proc_*      a parte do agente: quanto do processador da máquina ele
--             usou, e a memória dele.
-- disco_*     o disco onde ficam a fila e as imagens julgadas; é uma
--             posição, vale a última leitura da hora.
--
-- A linha é da MÁQUINA (do agente), não da loja inteira: uma loja com dois
-- computadores tem duas linhas por hora. Apagado o agente, o uso dele vai
-- junto — é dado da máquina, não auditoria da loja.
-- =====================================================================

create table if not exists uso_hora (
  id               bigint generated always as identity primary key,
  tenant_id        uuid not null references tenant(id) on delete cascade,
  loja_id          uuid not null references loja(id)   on delete cascade,
  agente_id        uuid not null references agente(id) on delete cascade,
  -- a hora cheia em que as amostras foram tiradas
  hora             timestamptz not null,
  amostras         integer not null check (amostras > 0),

  cpu_soma         numeric(12,2) not null default 0 check (cpu_soma >= 0),
  cpu_amostras     integer not null default 0 check (cpu_amostras >= 0),
  cpu_max          numeric(5,2) check (cpu_max between 0 and 100),

  mem_soma         numeric(12,2) not null default 0 check (mem_soma >= 0),
  mem_amostras     integer not null default 0 check (mem_amostras >= 0),
  mem_max          numeric(5,2) check (mem_max between 0 and 100),

  gpu_soma         numeric(12,2) not null default 0 check (gpu_soma >= 0),
  gpu_amostras     integer not null default 0 check (gpu_amostras >= 0),
  gpu_max          numeric(5,2) check (gpu_max between 0 and 100),

  proc_cpu_soma     numeric(12,2) not null default 0 check (proc_cpu_soma >= 0),
  proc_cpu_amostras integer not null default 0 check (proc_cpu_amostras >= 0),
  proc_cpu_max      numeric(5,2) check (proc_cpu_max between 0 and 100),
  proc_mem_max_mb   numeric(10,1) check (proc_mem_max_mb >= 0),

  disco_livre_gb   numeric(10,2) check (disco_livre_gb >= 0),
  disco_total_gb   numeric(10,2) check (disco_total_gb >= 0),

  recebido_em      timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);

create unique index if not exists uso_hora_uk on uso_hora (agente_id, hora);

-- A tela pergunta sempre "esta loja, entre este dia e aquele".
create index if not exists uso_hora_loja_idx on uso_hora (loja_id, hora desc);

comment on table uso_hora is
  'Por hora e por máquina (agente): processador, memória, placa de vídeo e '
  'disco. Soma e quantidade de amostras de cada peça (média) e o maior valor '
  '(pico). O agente manda o acumulado da hora e a nuvem substitui.';

-- De que é feita a máquina: processador, núcleos, memória, placa de vídeo.
-- Texto livre vindo do sistema operacional; a tela só mostra.
alter table agente add column if not exists maquina jsonb;

comment on column agente.maquina is
  'As peças do computador em que o agente roda, como o sistema operacional '
  'as descreve: {processador, nucleos, memoriaGb, placaDeVideo}.';
