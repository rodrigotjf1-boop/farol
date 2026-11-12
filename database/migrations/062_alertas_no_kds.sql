-- =====================================================================
-- Farol · migration 062 — os alertas na tela da cozinha do Regem
-- =====================================================================
-- Pedido da sessão do Regem em 11/11/2026 (onda 3 da auditoria do KDS: o
-- Regem busca os alertas com um transporte `fart_` do tipo `kds`). Duas
-- coisas no banco:
--
-- **O envio levado e sem resultado volta à fila.** Se o transporte cai no
-- meio, o envio ficava `enviado` para sempre. Agora, a cada reivindicação,
-- o `enviado` há mais de 2 minutos vira `falhou` (com o motivo) e entra de
-- novo na fila (`api/src/rotas/alertas.ts`). O índice parcial abaixo segura
-- essa procura: a tabela `envio` cresce com o uso, e os `enviado` de agora
-- são poucos.
--
-- **O destino do KDS não se digita.** Até aqui o endereço do KDS era o id
-- da loja no Regem, digitado no console: um id de loja do Regem de OUTRA
-- empresa poria o alerta na tela da cozinha dela. Agora o endereço é o
-- marcador `regem` ("a loja do Regem ligada à loja do alerta",
-- `regem_loja`), resolvido na reivindicação. Os destinos do KDS que já
-- existem passam ao marcador — menos o que daria dois no mesmo escopo
-- (o índice único `destino_endereco_uk` recusaria): esse fica como está e
-- também segue a ligação da loja.
--
-- Idempotente: pode rodar de novo sem efeito.
-- =====================================================================

create index if not exists envio_enviado_idx
  on envio (despachado_em) where estado = 'enviado';

update destino d
   set endereco = 'regem',
       atualizado_em = now()
 where d.tipo = 'kds'
   and d.endereco <> 'regem'
   and not exists (
         select 1
           from destino o
          where o.tipo = 'kds'
            and o.id <> d.id
            and o.tenant_id = d.tenant_id
            and coalesce(o.loja_id, '00000000-0000-0000-0000-000000000000'::uuid)
              = coalesce(d.loja_id, '00000000-0000-0000-0000-000000000000'::uuid)
       );

comment on column destino.endereco is
  'Número E.164, e-mail ou URL. Nunca segredo — o token do webhook vai '
  'por `segredo_ref`, resolvido no ambiente de quem despacha. No KDS, o '
  'marcador `regem`: a loja do Regem ligada à loja do alerta (migration 062).';
