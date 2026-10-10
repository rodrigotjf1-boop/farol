-- =====================================================================
-- Farol · migration 035 — a família do critério
-- =====================================================================
-- A19, onda 1, fatia 1.5 (a gaveta nova do critério). O plano troca os
-- cinco tipos de hoje por quatro FAMÍLIAS — o que o critério pergunta:
--
--   estado         como está?              um quadro, o melhor
--   acontecimento  aconteceu? alguém fez?  uma sequência curta
--   processo       foi feito como manda?   etapas ao longo do tempo
--   medida         quanto? por quanto tempo?  conta ou cronometra
--
-- Presença, contagem e comparação com a foto padrão continuam: são formas
-- de conferir um Estado. O `tipo` segue dizendo COMO o critério é julgado
-- (é por ele que o agente escolhe o juiz); a família diz o que ele
-- pergunta.
--
-- Hoje só a família Estado tem juiz. As outras três chegam com a sequência
-- (onda 2) e com a leitura da bancada: até lá o critério delas só OBSERVA —
-- conta as olhadas, o contexto e o gatilho, sem julgar. No banco elas são
-- carregadas pelo tipo `acao` (o de texto livre), que é o que o agente já
-- conhece: nada novo desce para a loja.
--
-- Vazio = a família natural do tipo: `acao` é acontecimento, os outros
-- quatro são estado. Nenhuma linha é atualizada — os critérios de hoje
-- ficam exatamente como estão, e a versão da configuração de loja nenhuma
-- sobe.
--
-- Idempotente: pode rodar de novo sem efeito.
-- =====================================================================

alter table regra add column if not exists familia text;

-- A família cabe no tipo — a regra fica no banco, não só na API.
alter table regra drop constraint if exists regra_familia_cabe_no_tipo;
alter table regra add constraint regra_familia_cabe_no_tipo
  check (familia is null
         or (familia = 'estado' and tipo in ('estado', 'presenca', 'contagem', 'comparacao'))
         or (familia in ('acontecimento', 'processo', 'medida') and tipo = 'acao'));

comment on column regra.familia is
  'O que o critério pergunta: estado, acontecimento, processo ou medida. '
  'Vazio = a família natural do tipo (acao = acontecimento; os outros = '
  'estado). Só a família estado é julgada hoje; as outras só observam, e '
  'são carregadas pelo tipo acao.';
