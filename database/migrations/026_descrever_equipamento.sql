-- =====================================================================
-- Farol · migration 026 — a análise única das fotos do equipamento
-- =====================================================================
-- Fase 2 do plano A16, última parte. Pedido do dono: "uma única análise
-- dele completa e sua descrição ficava guardada na base".
--
-- "Analisar as fotos e descrever" é um COMANDO para o agente da loja, como
-- "capturar quadro": quem tem a chave do modelo é o computador da loja, e
-- a API continua sem chave nenhuma. O agente baixa as fotos do equipamento,
-- pergunta ao modelo UMA vez e devolve a descrição e a lista do que vale
-- conferir nele.
--
-- ## A resposta é uma SUGESTÃO, não uma gravação
--
-- O que o agente devolve fica guardado no próprio comando (`resultado`) e
-- NÃO mexe no cadastro. A tela mostra a sugestão nos campos, a pessoa lê,
-- corrige e salva — aí sim vira a descrição do equipamento, e o comando é
-- marcado como aplicado (`aplicado_em`). Gravar direto apagaria, sem
-- pergunta, o que alguém escreveu à mão; e descrição de modelo que ninguém
-- leu iria junto com toda pergunta feita à nuvem dali em diante.
--
-- Idempotente: pode rodar de novo sem efeito.
-- =====================================================================

-- O comando novo. A restrição é recriada com os dois tipos.
alter table comando_agente drop constraint if exists comando_agente_tipo_check;
alter table comando_agente
  add constraint comando_agente_tipo_check
  check (tipo in ('capturar_quadro', 'descrever_item'));

-- De que equipamento é o comando. Excluído o equipamento, o comando vai junto.
alter table comando_agente
  add column if not exists item_id uuid references inventario_item(id) on delete cascade;

-- O que o agente devolveu: { descricao, conferir, modelo, custoCentavos }.
alter table comando_agente
  add column if not exists resultado jsonb;

-- Quando a sugestão foi levada ao cadastro (ou deixada de lado, ao salvar
-- outra descrição). Nulo = ainda está esperando alguém ler.
alter table comando_agente
  add column if not exists aplicado_em timestamptz;

create index if not exists comando_item_idx
  on comando_agente (item_id, criado_em desc)
  where item_id is not null;

comment on column comando_agente.resultado is
  'A resposta do agente a um comando que devolve dados (descrever_item): '
  'a descrição sugerida e o que vale conferir. Não é a descrição do '
  'equipamento enquanto alguém não salvar.';
