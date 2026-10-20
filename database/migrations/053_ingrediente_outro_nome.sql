-- =====================================================================
-- Farol · migration 053 — o outro nome de um ingrediente das fichas
-- =====================================================================
-- Do protótipo aprovado pelo dono em 19/10/2026 ("prototipo aprovado"):
-- na aba Sugestões, o "nome fora das fichas" — um nome escrito à mão na
-- conferência que não está em ficha nenhuma — ganha a resposta "É um
-- ingrediente das fichas". Quem configura escolhe qual, e o nome escrito
-- vira um OUTRO NOME dele:
--
--   • os exemplos guardados com o outro nome passam a ser do ingrediente
--     das fichas — quem lê os soma (a lista, a base que desce para a loja),
--     como os do nome parecido (#190);
--   • as conferências seguintes contam o outro nome como o ingrediente das
--     fichas (as sugestões, o aprendizado, os exemplos novos), e a gaveta da
--     conferência entende sozinha quando alguém o escreve de novo.
--
-- A `chave` é a do nome escrito (`chaveDoIngrediente`: sem acento, sem as
-- palavras que só ligam, no singular, o peso junto do número): uma por
-- loja. O `ingrediente` é o nome como estava nas fichas quando foi juntado.
-- =====================================================================

create table if not exists ingrediente_outro_nome (
  id           uuid primary key default gen_random_uuid(),
  loja_id      uuid not null references loja(id) on delete cascade,
  chave        text not null check (char_length(chave) between 1 and 200),
  nome         text not null check (char_length(nome) between 1 and 120),
  -- o nome da ficha vem do sistema de fichas (Regem, planilha), sem o limite de 120 da conferência
  ingrediente  text not null check (char_length(ingrediente) between 1 and 200),
  criado_por   uuid references usuario(id) on delete set null,
  criado_em    timestamptz not null default now()
);
create unique index if not exists ingrediente_outro_nome_uk on ingrediente_outro_nome (loja_id, chave);

comment on table ingrediente_outro_nome is
  'O outro nome de um ingrediente das fichas: o nome escrito à mão na conferência que quem configura juntou a um ingrediente delas (resposta "É um ingrediente das fichas" ao "nome fora das fichas"). Quem lê conta o outro nome como o ingrediente.';
comment on column ingrediente_outro_nome.chave is
  'A chave do nome escrito (chaveDoIngrediente da API): uma por loja.';
comment on column ingrediente_outro_nome.ingrediente is
  'O ingrediente das fichas a que o nome foi juntado, como estava nas fichas.';

-- ───────────── o exemplo do nome escrito à mão, fora das fichas ─────────────
-- Até aqui, o nome escrito à mão que não está nas fichas ficava só na resposta da conferência: não virava exemplo. Agora
-- o exemplo dele é guardado à parte, com tipo 'fora'. Ele NÃO desce para a loja nem aparece na lista dos ingredientes
-- enquanto o nome não vale; passa a valer quando vira outro nome de um ingrediente das fichas (acima) ou quando a ficha
-- chega com ele (escrito igual ou de outro jeito, pela chave). Assim a imagem fica guardada (a do treino sai em 30 dias),
-- e os exemplos "se juntam sozinhos quando a ficha chegar" (o protótipo aprovado).
alter table base_conhecimento drop constraint if exists base_conhecimento_tipo_check;
alter table base_conhecimento add constraint base_conhecimento_tipo_check check (tipo in ('item', 'padrao', 'fora'));
