-- =====================================================================
-- Farol · migration 034 — a imagem completa de volta
-- =====================================================================
-- A19, onda 1, fatia 1.5 (frente A: canal → quadros → critérios). As
-- palavras são as do dono:
--
--   canal            a câmera;
--   imagem completa  o canal inteiro; os critérios dela são os gerais;
--   quadro           um recorte marcado dentro da imagem, com nome e papel.
--
-- Até aqui a "área principal" do canal era uma área como as outras: nascia
-- "Quadro inteiro" e podia ser redesenhada. Redesenhada, continuava com o
-- nome de quadro inteiro cobrindo um quinto da imagem — e o canal ficava
-- sem ter onde pôr um critério que vale para a câmera toda. Na loja de
-- verdade há dois canais assim.
--
-- Daqui em diante a principal É a imagem completa: sempre o canal inteiro,
-- com nome fixo, sem papel. Quem quer conferir só uma parte marca um quadro.
--
-- O que esta migration faz com o que já existe:
--
--   1. a principal que não cobre a imagem inteira deixa de ser a principal:
--      vira um quadro como os outros, com o mesmo desenho, o mesmo nome e os
--      mesmos critérios — NADA muda no que é analisado;
--   2. o canal que ficou sem principal e já tem uma área cobrindo tudo passa
--      a tê-la como imagem completa (a mais antiga); o que não tem, ganha uma;
--   3. a imagem completa se chama "Imagem completa" em todo canal. "Quadro
--      inteiro" deixa de ser nome de área: a que sobrou com esse nome (e já
--      não é o quadro inteiro) passa a se chamar "Área marcada".
--
-- E a regra fica no banco, não só na API: a principal é sempre o canal
-- inteiro, sem papel, e nunca está excluída (`zona_principal_e_a_imagem_completa`).
--
-- Os critérios não mudam de lugar: `regra_alvo` aponta para a área, e a área
-- continua a mesma. O histórico (`resumo_hora`, eventos, fotos do inventário)
-- também. As linhas de `zona` mudam, então os gatilhos sobem a versão da
-- configuração das lojas mexidas: o agente puxa de novo e recebe os mesmos
-- quadros, com os mesmos números, e a imagem completa a mais.
--
-- Idempotente: pode rodar de novo sem efeito.
-- =====================================================================

-- 1. A principal que não é o canal inteiro (ou que está excluída) deixa de
--    ser a principal. Em todos os canais, inclusive os excluídos: a regra do
--    fim desta migration vale para a tabela inteira.
update zona
   set principal = false, atualizado_em = now()
 where principal
   and (poligono <> '[[0,0],[1,0],[1,1],[0,1]]'::jsonb or excluida_em is not null);

-- 2. Canal sem principal que JÁ tem uma área cobrindo a imagem inteira: a
--    imagem completa é ela — a mais antiga, se houver mais de uma.
update zona z
   set principal = true, atualizado_em = now()
  from (
    select distinct on (c.ponto_id) c.id
      from zona c
     where c.excluida_em is null
       and c.poligono = '[[0,0],[1,0],[1,1],[0,1]]'::jsonb
       and not exists (select 1 from zona p where p.ponto_id = c.ponto_id and p.principal)
     order by c.ponto_id, c.criado_em, c.id
  ) escolhida
 where z.id = escolhida.id;

-- 3. "Imagem completa" passa a ser o nome da imagem completa. O quadro que
--    já se chamava assim sai do caminho antes (o nome é único no canal): ganha
--    o começo do próprio id, que não se repete.
update zona z
   set nome = z.nome || ' · ' || left(z.id::text, 4), atualizado_em = now()
 where not z.principal
   and z.excluida_em is null
   and lower(z.nome) = 'imagem completa';

-- 4. A imagem completa de quem já tinha: o nome fixo, sem papel e sem ordem.
update zona
   set nome = 'Imagem completa', papel = 'livre', ordem = 0, atualizado_em = now()
 where principal
   and (nome <> 'Imagem completa' or papel <> 'livre' or ordem <> 0);

-- 5. Canal que ficou sem: nasce a imagem completa dele.
insert into zona (ponto_id, nome, poligono, principal)
select p.id, 'Imagem completa', '[[0,0],[1,0],[1,1],[0,1]]'::jsonb, true
  from ponto p
 where not exists (select 1 from zona z where z.ponto_id = p.id and z.principal);

-- 6. "Quadro inteiro" deixa de ser nome de área. O que sobrou com esse nome é
--    um quadro (a área que foi redesenhada sem ninguém trocar o nome): passa a
--    se chamar "Área marcada" — com o começo do id, se o canal já tiver uma.
--    (`lower()` dos dois lados: em banco de localidade "C" ele não baixa a
--    letra acentuada, e a comparação tem de ser a mesma do índice do nome.)
update zona z
   set nome = case
                when exists (select 1 from zona o
                              where o.ponto_id = z.ponto_id and o.id <> z.id
                                and o.excluida_em is null and lower(o.nome) = lower('Área marcada'))
                  then 'Área marcada · ' || left(z.id::text, 4)
                else 'Área marcada'
              end,
       atualizado_em = now()
 where not z.principal
   and z.excluida_em is null
   and lower(z.nome) = 'quadro inteiro';

-- 7. A regra, no banco: a principal é a imagem completa. Nenhum caminho —
--    desta API, de uma versão antiga dela, ou de mão no banco — redesenha,
--    dá papel ou exclui a imagem completa de um canal.
alter table zona drop constraint if exists zona_principal_e_a_imagem_completa;
alter table zona add constraint zona_principal_e_a_imagem_completa
  check (not principal
         or (poligono = '[[0,0],[1,0],[1,1],[0,1]]'::jsonb
             and papel = 'livre'
             and excluida_em is null));

comment on column zona.principal is
  'A imagem completa do canal: sempre o canal inteiro, com o nome "Imagem '
  'completa", sem papel. Uma por canal. Os critérios postos nela são os '
  'critérios gerais do canal; as outras áreas são os quadros.';
