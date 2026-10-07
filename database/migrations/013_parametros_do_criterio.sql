-- =====================================================================
-- Farol · migration 013 — o que o detector procura
-- =====================================================================
-- Critério de presença e de contagem é julgado dentro da loja, por um
-- detector de objetos. O detector não lê português: ele sabe achar um
-- conjunto fechado de objetos e contar.
--
-- Até aqui a regra tinha só o texto do critério. Tirar "o que procurar"
-- desse texto seria adivinhação, e do tipo que erra em silêncio: o critério
-- "copo sujo na bancada" viraria "há copo?", e ninguém perceberia que a
-- palavra "sujo" ficou de fora.
--
-- Então a regra ganha os campos que o juiz local precisa:
--
--   {"objeto": "pessoa", "minimo": 1, "maximo": null}   tem que ter alguém
--   {"objeto": "pessoa", "minimo": 0, "maximo": 0}      não pode ter ninguém
--   {"objeto": "pessoa", "minimo": 0, "maximo": 3}      no máximo três
--
-- O texto do critério continua existindo — é o que a pessoa lê na tela e
-- no alerta. Quem decide é o campo.
--
-- ## Por que jsonb, e não três colunas
--
-- O detector é o primeiro juiz que precisa de campos; a comparação por
-- referência e a verificação de montagem vão precisar dos delas, e cada
-- uma tem formato próprio. Uma coluna por campo de cada juiz viraria uma
-- tabela larga, quase toda nula. A validação do formato mora na API, que é
-- quem sabe qual juiz atende qual tipo de critério.
--
-- ## Critério de presença que já existe
--
-- Fica com `{}`. Ele já não era julgado (não havia juiz); continua não
-- sendo, e o agente passa a dizer por quê: "o critério não diz o que
-- procurar". Basta editar e escolher o objeto.
-- =====================================================================

alter table regra
  add column if not exists parametros jsonb not null default '{}'::jsonb;

comment on column regra.parametros is
  'Campos para os juízes que não leem o texto do critério. Presença e '
  'contagem: {"objeto","minimo","maximo"} — o que o detector local procura '
  'e quantos são aceitáveis. Vazio nos tipos que usam só o texto.';

-- `parametros` muda o que o agente faz, então mexer nele tem que subir a
-- versão da configuração. O gatilho da 007/012 em `regra` já dispara em
-- qualquer UPDATE da linha — não há nada a acrescentar aqui, e fica
-- anotado para ninguém criar um segundo gatilho por engano.
