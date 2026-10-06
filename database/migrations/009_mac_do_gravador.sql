-- =====================================================================
-- Farol · migration 009 — o MAC do gravador, para sobreviver ao DHCP
-- =====================================================================
-- `ponto.host` é um endereço IP, e endereço IP muda. Na tela do MHDX em
-- 06/10/2026: **Modo DHCP**. Queda de luz, troca de roteador, lease que
-- expira — e o Farol passa a procurar a câmera num endereço que já é de
-- outro aparelho, ou de ninguém.
--
-- O sintoma seria idêntico ao ERR-013: comando entregue, captura
-- falhando, equipamento aparentemente normal na própria tela. Numa loja,
-- sem ninguém por perto para medir.
--
-- O MAC não muda. Gravado aqui, o agente pode varrer a rede procurando
-- aquele aparelho e dizer **"o gravador mudou de 192.168.1.108 para
-- 192.168.1.112"** — em vez de só falhar.
--
-- ## Por que AVISAR e não corrigir sozinho
--
-- Corrigir sozinho é conveniente, e é também como um equipamento
-- **trocado** passa despercebido: alguém substitui o gravador, o novo
-- pega o IP antigo, e o sistema segue analisando como se nada tivesse
-- acontecido. O MAC é justamente o que distingue "mudou de endereço" de
-- "é outro aparelho".
--
-- Então: o agente **propõe**, o console **mostra**, uma pessoa
-- **confirma**. `mac_visto_em` é o que permite a essa pessoa saber se a
-- informação é de agora ou de três meses atrás.
-- =====================================================================

alter table ponto
  add column if not exists mac           text,
  add column if not exists mac_visto_em  timestamptz;

comment on column ponto.mac is
  'MAC do gravador, lido pelo agente na rede da loja. Endereço IP muda '
  '(DHCP); MAC não. É o que permite reencontrar o aparelho quando o host '
  'parar de responder — e o que distingue "mudou de IP" de "é outro '
  'equipamento".';

comment on column ponto.mac_visto_em is
  'Quando o agente confirmou esse MAC neste host pela última vez. Sem a '
  'data, ninguém sabe se a informação é de agora ou de meses atrás.';

-- Procurar pelo MAC é a consulta que o reencontro faz. Parcial porque a
-- maioria dos pontos não terá MAC até algum agente passar por lá.
create index if not exists ponto_mac_idx on ponto (mac) where mac is not null;
