-- =====================================================================
-- Farol · migration 004 — o que foi MEDIDO no gravador, separado do que
-- foi lido em ficha técnica
-- =====================================================================
-- O perfil do MHDX 3116-C nasceu na 001 a partir de documentação. Hoje
-- (05/10/2026) o aparelho foi ligado e sondado de verdade, e três coisas
-- que a documentação não diz apareceram.
--
-- Daí as colunas novas: `verificado_em` e `firmware_verificado` separam
-- "alguém leu num manual" de "alguém ligou o aparelho e mediu". A semana
-- inteira deste projeto foi uma sequência de conclusões tiradas de
-- leitura não conferida; o catálogo não pode repetir isso em escala,
-- porque é dele que sai a recomendação de compra para o cliente.
-- =====================================================================

alter table perfil_gravador add column if not exists verificado_em       timestamptz;
alter table perfil_gravador add column if not exists firmware_verificado text;
alter table perfil_gravador add column if not exists canais              integer;

-- Comportamento que muda o desenho do agente, não é detalhe de operação:
-- se a transmissão de eventos fecha a cada evento, quem não religa recebe
-- o primeiro alerta do turno e fica mudo o resto do dia — sem erro.
alter table perfil_gravador add column if not exists evento_religa boolean not null default false;

comment on column perfil_gravador.verificado_em is
  'quando um aparelho DESTE modelo foi sondado de verdade; nulo = só ficha técnica';
comment on column perfil_gravador.evento_religa is
  'a transmissão de eventos fecha após cada evento e exige reconexão';

update perfil_gravador
   set verificado_em       = timestamptz '2026-10-05 09:00:00-03',
       firmware_verificado = '4.001.00IB000.0.T,build:2025-12-25 17:10:56',
       canais              = 16,
       evento_religa       = true,
       -- `keepalive`, não `heartbeat`: o nome que funcionou no aparelho.
       evento_tpl = 'http://{host}/cgi-bin/eventManager.cgi?action=attach&codes=[All]&keepalive=20',
       observacoes = observacoes
         || E'\n\n--- MEDIDO em 05/10/2026, unidade DTP0014446184 ---\n'
         || E'eventManager CONFIRMADO: entrega evento estruturado '
         || E'(Code=...;action=...;index=...). E a premissa do gatilho em dois estagios.\n'
         || E'PORÉM a transmissao FECHA a cada evento: sem religar, o agente recebe o '
         || E'primeiro alerta do turno e fica mudo, sem erro nenhum.\n'
         || E'Contagem de canais: este firmware IGNORA getProductDefinition e '
         || E'devVideoInput. So responde contando table.ChannelTitle.\n'
         || E'RTSP /cam/realmonitor?channel=N&subtype=0 confirmado nos 16 canais.\n'
         || E'Porta de servico 37777 aberta junto com 80 e 554.\n'
         || E'O parametro do attach e keepalive, nao heartbeat.'
 where fabricante = 'intelbras' and modelo = 'MHDX 3116-C';

-- Quem ainda não foi verificado fica explícito, para a recomendação ao
-- cliente poder dizer "este a gente testou" e "este a gente só leu".
create index if not exists perfil_gravador_verificado_idx
  on perfil_gravador (fabricante, modelo) where verificado_em is not null;
