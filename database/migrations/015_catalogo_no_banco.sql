-- =====================================================================
-- Farol · migration 015 — o catálogo de equipamentos chega ao banco
-- =====================================================================
-- A fonte da verdade do que o projeto sabe sobre equipamento passou a ser
-- um arquivo JSON por modelo, em `catalogo/` (PR #38). O banco guarda uma
-- CÓPIA, porque o orçamento cruza equipamento com loja, levantamento e
-- diagnóstico — e isso é junção, não leitura de arquivo.
--
-- A cópia é refeita a cada subida da API, a partir dos arquivos que vieram
-- na imagem. Ninguém edita `equipamento` à mão: a próxima subida desfaria.
--
-- Esta migration só abre espaço para o que o arquivo tem e a tabela não
-- tinha:
--
--   slug          o nome do arquivo — a ponte entre os dois
--   nivel         basico | intermediario | avancado (nulo onde não se aplica)
--   nivel_motivo  por que este nível
--   serve_para    câmera: os usos de análise que ela sustenta
--   medido        o que o equipamento ENTREGOU, medido em campo
--   precos        preço ou faixa, cada um com data, fonte e confiança
--   fontes        de onde veio cada informação
--
-- ## Por que `precos` aqui, se existe `equipamento_preco`
--
-- `equipamento_preco` é histórico de COTAÇÃO: loja, preço exato, estoque —
-- o que o motor de orçamento grava quando cota de verdade. O catálogo traz
-- também FAIXA de mercado ("de 900 a 1.200"), que não cabe naquela tabela
-- e não é cotação. São duas coisas, e ficam em dois lugares.
--
-- ## De quem é
--
-- Da distribuição. Nenhuma rota do console devolve estas linhas ao usuário:
-- a ele chegam soluções e opções montadas a partir delas.
-- =====================================================================

alter table equipamento
  add column if not exists slug         text,
  add column if not exists nivel        text
    check (nivel in ('basico','intermediario','avancado')),
  add column if not exists nivel_motivo text,
  add column if not exists serve_para   jsonb not null default '[]'::jsonb,
  add column if not exists medido       jsonb not null default '[]'::jsonb,
  add column if not exists precos       jsonb not null default '[]'::jsonb,
  add column if not exists fontes       jsonb not null default '[]'::jsonb;

create unique index if not exists equipamento_slug_uk
  on equipamento (slug) where slug is not null;

comment on column equipamento.slug is
  'Nome do arquivo em catalogo/equipamentos. Nulo = linha que não veio do catálogo.';
comment on column equipamento.medido is
  'O que o equipamento entregou, medido em campo. Quando discorda de specs, vale este.';
