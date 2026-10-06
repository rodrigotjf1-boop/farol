-- =====================================================================
-- Farol · migration 006 — a óptica do ponto e a largura real da zona
-- =====================================================================
-- Sem estes números, o sistema não consegue responder a pergunta que
-- decide tudo: **esta câmera, nesta posição, sustenta esta regra?**
--
-- E a resposta não vem do megapixel. Vem de `px/cm no objeto`:
--
--     largura enquadrada = distância × largura_do_sensor ÷ focal
--     px/cm              = pixels_horizontais ÷ largura enquadrada
--
-- Medido em 05/10/2026 numa TWG TW-7327 (1/2.7", 2,8 mm) a 60 cm:
-- enquadra 115 cm, dá 16,7 px/cm — acima dos 12,8 que a montagem item a
-- item exige. A 1,5 m a MESMA câmera dá 6,7 e não sustenta. A diferença
-- não é a câmera: é a distância.
--
-- `largura_cena_cm` na zona é o que permite escolher a RESOLUÇÃO DE
-- ENVIO. Recortar não muda px/cm — quem muda é o redimensionamento antes
-- de mandar ao modelo. Zona estreita sustenta a mesma precisão com envio
-- menor, e é aí que mora a diferença de custo entre uma loja viável e
-- uma cara demais.
-- =====================================================================

alter table ponto add column if not exists sensor_pol        text;
alter table ponto add column if not exists focal_mm          numeric(5,2);
alter table ponto add column if not exists distancia_cm      numeric(7,1);
alter table ponto add column if not exists resolucao_h       integer;
-- Quando alguém mede a cena com fita métrica em vez de calcular pela
-- óptica. Medida vence conta: a lente real tem distorção, e a conta não.
alter table ponto add column if not exists largura_cena_cm   numeric(7,1);
alter table ponto add column if not exists optica_medida_em  timestamptz;

comment on column ponto.largura_cena_cm is
  'largura real enquadrada, MEDIDA. Quando preenchida, vence o cálculo pela óptica.';
comment on column ponto.optica_medida_em is
  'quando a óptica foi conferida no local; nulo = só o que foi digitado';

-- A zona precisa saber quanto do mundo ela cobre, em centímetros, para o
-- sistema decidir a resolução de envio. Sem isso só dá para supor.
alter table zona add column if not exists largura_cena_cm numeric(7,1);

comment on column zona.largura_cena_cm is
  'largura real do que a zona cobre, em cm. Define a resolução de envio mínima.';

-- Catálogo de formatos de sensor. Existe como tabela, e não como
-- constante no código, porque o instalador escolhe de uma lista — e
-- lista no banco se corrige sem subir versão do agente.
create table if not exists formato_sensor (
  nome        text primary key,
  largura_mm  numeric(5,2) not null,
  altura_mm   numeric(5,2),
  observacao  text
);

insert into formato_sensor (nome, largura_mm, altura_mm, observacao) values
  ('1/4"',   3.60, 2.70, 'comum em camera analogica antiga'),
  ('1/3"',   4.80, 3.60, 'muito comum em 1 MP e 2 MP de entrada'),
  ('1/2.9"', 5.00, 2.81, 'tipico em 2 MP recentes'),
  ('1/2.8"', 5.08, 2.85, 'o mais comum em 2 MP de CFTV'),
  ('1/2.7"', 5.37, 3.02, 'medido no projeto: TWG TW-7327'),
  ('1/2.5"', 5.76, 3.24, null),
  ('1/2"',   6.40, 3.60, 'sensor maior, melhor com pouca luz'),
  ('1/1.8"', 7.18, 4.04, 'topo de linha de CFTV')
on conflict (nome) do nothing;

-- Preenche o que já se sabe do ponto criado nos testes, sem inventar
-- nada: só a resolução, que foi medida pelo próprio agente.
update ponto set resolucao_h = 1920
 where resolucao_h is null and origem = 'dvr';
