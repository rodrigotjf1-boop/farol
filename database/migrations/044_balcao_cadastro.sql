-- =====================================================================
-- Farol · migration 044 — o balcão: a conta de IA de cada loja, a chave e o teto
-- =====================================================================
-- A20, "a dúvida passa pelo nosso servidor" — o balcão, fase 1a. O plano
-- foi aprovado pelo dono em 13/10/2026, com três respostas:
--
--   • "aprovo as quatro fases; cada troca na loja espera o meu pode";
--   • o teto de gasto por loja, por dia, no piloto: "até 40,00 por dia";
--   • na distribuição: "só a conta do lojista, com a chave dele guardada
--     cifrada no nosso servidor".
--
-- Esta migration cria só o CADASTRO. Ninguém pergunta nada a plataforma
-- nenhuma por causa dela: a porta que recebe a dúvida vem depois.
--
-- **conta_ia** — a conta de IA de cada loja: de que plataforma é, e a
-- chave dela, CIFRADA (AES-256-GCM, com a chave que só o ambiente do
-- serviço tem — a mesma que guarda o acesso de cada loja ao Regem —, e
-- presa à loja: o texto cifrado de uma loja, colado na linha de outra, não
-- abre). O texto claro não é gravado em lugar nenhum e nenhuma rota o
-- devolve. Uma conta por loja.
--
-- **loja.duvida_pelo_servidor** — a chave interna. Desligada, o agente
-- pergunta como sempre perguntou. Ligada, a dúvida é entregue ao servidor,
-- que pergunta com a conta daquela loja. É da distribuição, como
-- `pedido_com_contexto`: não é opção do console.
--
-- **loja.teto_duvida_centavos_dia** — quanto a loja pode gastar por dia
-- com a dúvida, em centavos. O servidor corta ANTES de perguntar. Nasce em
-- R$ 40,00 (o que o dono fixou para o piloto) e muda loja a loja.
--
-- **O balcão só fala o pedido com contexto** — então loja com a chave
-- interna ligada tem `pedido_com_contexto` ligado. As rotas recusam com o
-- motivo, dos dois lados (ligar o balcão sem o contexto; desligar o
-- contexto com o balcão ligado); a regra `loja_balcao_pede_contexto` é a
-- segunda tranca, para o caminho que não passa por elas.
--
-- Nada muda para quem já está no ar: a tabela nasce vazia e a chave,
-- desligada. Nenhuma linha existente é atualizada com valor que o agente
-- leia — os gatilhos de `config_versao` não disparam, e nenhum agente puxa
-- configuração por causa desta migration.
--
-- Idempotente: pode rodar de novo sem efeito.
-- =====================================================================

alter table loja
  add column if not exists duvida_pelo_servidor boolean not null default false;

alter table loja
  add column if not exists teto_duvida_centavos_dia integer not null default 4000
    check (teto_duvida_centavos_dia between 0 and 1000000);

-- Ligado o balcão, o pedido com contexto está ligado — a regra fica no banco, não só na API.
alter table loja drop constraint if exists loja_balcao_pede_contexto;
alter table loja add constraint loja_balcao_pede_contexto
  check (not duvida_pelo_servidor or pedido_com_contexto);

create table if not exists conta_ia (
  loja_id        uuid primary key references loja(id) on delete cascade,
  tenant_id      uuid not null references tenant(id) on delete cascade,
  -- De que plataforma é a conta. A lista é a de `api/src/balcao/plataformas.ts`.
  provedor       text not null check (provedor in ('anthropic')),
  -- A chave, cifrada. Nunca o texto claro.
  chave_cifrada  text not null check (chave_cifrada like 'v1.%'),
  criada_em      timestamptz not null default now(),
  atualizada_em  timestamptz not null default now()
);
