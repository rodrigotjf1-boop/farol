-- =====================================================================
-- Farol · migration 030 — a cena do canal e o papel do quadro
-- =====================================================================
-- A19, onda 1, fatia 1.1 ("o pedido com contexto"). Pergunta do dono em
-- 08/10/2026: "o que sobe à nuvem? Se enviar um corte sem contexto, a
-- análise vai falhar e o custo vai ser em vão." Na loja, naquela noite,
-- 93% das análises pagas voltaram sem resposta, e o próprio modelo disse o
-- que faltava: "não permite identificar qual elemento é a gaveta".
--
-- O que faltava era onde guardar o contexto. Esta migration cria o lugar:
--
-- **loja.tipo_negocio** — que negócio é ("hamburgueria"). Vale para a loja
-- inteira; quem configura escreve.
--
-- **ponto.cena** — o que esta câmera vê e de onde olha, escrito por quem
-- configura, com detalhes (decisão do dono em 09/10/2026: o usuário
-- escreve; o sistema não propõe a partir da imagem). Com quem escreveu e
-- quando.
--
-- **zona.papel** — o que o quadro é: posto de trabalho, cuba, posição de
-- montagem, equipamento, impressora e comanda, caixa e gaveta, pia, piso —
-- ou sem papel definido, que é como toda área existente fica.
--
-- **zona.ordem** — a ordem do quadro dentro do canal. O NÚMERO que aparece
-- na tela e no mapa do canal ("Quadro 2") não é guardado: é a posição do
-- quadro entre os quadros do canal, por esta ordem e, no empate, pela data
-- de criação. Com todos em zero, vale a ordem de criação.
--
-- **loja.pedido_com_contexto** — a chave. Desligada, o agente pergunta à
-- nuvem como sempre perguntou. Ligada, toda pergunta leva a cena (e o mapa
-- do canal, quando o critério vale num quadro), e canal sem cena escrita
-- não manda imagem para fora. É chave INTERNA, da distribuição — como
-- `modo_julgamento`: não é opção do console da loja (decisão do dono em
-- 09/10/2026: "a lógica de funcionamento é interna").
--
-- Nada muda para quem já está no ar: as colunas nascem vazias e a chave,
-- desligada. Não há atualização de linha existente aqui — os gatilhos de
-- `config_versao` não disparam, e nenhum agente puxa configuração por
-- causa desta migration.
--
-- Idempotente: pode rodar de novo sem efeito.
-- =====================================================================

alter table loja
  add column if not exists tipo_negocio text not null default ''
    check (length(tipo_negocio) <= 80);

alter table loja
  add column if not exists pedido_com_contexto boolean not null default false;

alter table ponto
  add column if not exists cena text not null default ''
    check (length(cena) <= 2000);

alter table ponto
  add column if not exists cena_escrita_em timestamptz;

alter table ponto
  add column if not exists cena_escrita_por uuid references usuario(id) on delete set null;

alter table zona
  add column if not exists papel text not null default 'livre'
    check (papel in ('posto', 'cuba', 'montagem', 'equipamento', 'impressora',
                     'caixa', 'pia', 'piso', 'livre'));

alter table zona
  add column if not exists ordem integer not null default 0
    check (ordem between 0 and 99);

comment on column loja.tipo_negocio is
  'Que negócio é ("hamburgueria"). Vai junto com a cena do canal em toda '
  'pergunta feita a um modelo.';
comment on column loja.pedido_com_contexto is
  'Chave interna, da distribuição: ligada, toda pergunta à nuvem leva a '
  'cena e o mapa do canal, e canal sem cena escrita não manda imagem para '
  'fora. Não é opção do console da loja.';
comment on column ponto.cena is
  'O que esta câmera vê e de onde olha, escrito por quem configura o canal. '
  'Vazio = ainda não descrita.';
comment on column ponto.cena_escrita_em is
  'Quando a cena foi escrita ou mudada pela última vez.';
comment on column ponto.cena_escrita_por is
  'Quem escreveu a cena pela última vez.';
comment on column zona.papel is
  'O que o quadro é: posto, cuba, montagem, equipamento, impressora, caixa, '
  'pia, piso ou livre (sem papel definido).';
comment on column zona.ordem is
  'Ordem do quadro dentro do canal. O número mostrado ("Quadro 2") é a '
  'posição por esta ordem e, no empate, pela data de criação.';
