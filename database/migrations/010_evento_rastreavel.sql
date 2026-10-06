-- =====================================================================
-- Farol · migration 010 — o evento guarda de onde veio
-- =====================================================================
-- `evento` registra o veredito, o modelo, o custo e a latência. Faltam
-- duas coisas que só são baratas AGORA, enquanto a tabela está vazia, e
-- que são impossíveis de reconstruir depois.
--
-- ## `criterio_versao` — qual redação produziu este veredito
--
-- Reescrever critério é o que mais se faz nos primeiros meses: a frase
-- nunca sai boa de primeira. O esquema já versiona a redação em
-- `regra.criterio_versao`, e o agente já a usa na chave de idempotência.
--
-- Mas o evento guarda só `regra_id`. Como a regra é mutável, um evento
-- de ontem aponta para a redação de hoje — e a pergunta que mais importa
-- fica sem resposta: **"a versão 2 acerta mais que a 1?"**
--
-- Sem isso, toda melhoria de critério é opinião. Com isso, é medição.
--
-- ## `imagem_hash` — qual cena foi julgada
--
-- O pHash já existe dentro de `idempotencia_key`, misturado com regra,
-- ponto e instante. Extraído numa coluna própria, ele permite:
--
--   · agrupar vereditos sobre a MESMA cena e ver se o modelo é estável;
--   · reenviar um conjunto fixo e detectar **deriva do modelo** — o
--     provedor atualiza, o veredito muda, e num produto de auditoria
--     ninguém é avisado de que a regra passou a se comportar diferente;
--   · montar o conjunto de avaliação a partir da operação, em vez de
--     alguém rotular cinquenta cenas num sábado.
--
-- ## Por que agora
--
-- Nenhuma regra está ligada, então `evento` está vazia. Acrescentar
-- coluna aqui é instantâneo. Depois de uma loja rodando por um mês,
-- seria `ALTER TABLE` sobre milhões de linhas — e, pior, os eventos já
-- gravados nunca teriam esses valores.
-- =====================================================================

alter table evento
  add column if not exists criterio_versao integer,
  add column if not exists imagem_hash     text;

comment on column evento.criterio_versao is
  'Versão da redação do critério que produziu ESTE veredito. A regra é '
  'mutável; sem isto, um evento de ontem aponta para a redação de hoje e '
  'não há como comparar o desempenho entre versões.';

comment on column evento.imagem_hash is
  'pHash do quadro julgado. Agrupa vereditos sobre a mesma cena, permite '
  'reenviar um conjunto fixo para detectar deriva do modelo, e deixa o '
  'conjunto de avaliação se construir a partir da operação.';

-- A consulta da deriva é "todos os vereditos desta cena, em ordem".
create index if not exists evento_imagem_hash_idx
  on evento (imagem_hash, ocorrido_em)
  where imagem_hash is not null;

-- E a comparação entre redações é "esta regra, agrupada por versão".
create index if not exists evento_regra_versao_idx
  on evento (regra_id, criterio_versao)
  where regra_id is not null;
