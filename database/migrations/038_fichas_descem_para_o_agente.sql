-- =====================================================================
-- Farol · migration 038 — a base de fichas desce para o agente
-- =====================================================================
-- "Regem no Farol", fatia 3 (plano aprovado pelo dono em 11/10/2026): a
-- cópia das fichas chega ao computador da loja, do mesmo jeito que as
-- fotos padrão — a configuração diz o que a loja tem de ter, e o agente
-- baixa o que falta.
--
-- O agente só puxa a configuração quando `loja.config_versao` muda. Então
-- a base de fichas passa a mexer nela, como ponto, área, critério e foto
-- padrão já mexem:
--
--   • base nova (a primeira leitura da loja)            → sobe a versão;
--   • base trocada (a IMPRESSÃO do documento mudou)     → sobe a versão;
--   • base apagada (desconectou, ou o acesso foi tirado) → sobe a versão,
--     e é por aí que a cópia some do computador da loja.
--
-- Uma leitura que não mudou nada não escreve na base (a gravação já é
-- condicional), e uma escrita que não mexe na impressão não sobe nada: a
-- loja não puxa configuração à toa.
--
-- O gatilho fica no banco, e não em cada rota, porque a base é escrita por
-- três caminhos (a leitura, o desconectar e o acesso tirado) e vai ganhar
-- outros (a planilha): quem esquecer de avisar deixaria a loja com a ficha
-- velha, sem erro nenhum.
--
-- Nenhuma linha que já existe é alterada, e nenhuma versão sobe ao aplicar.
--
-- Idempotente: pode rodar de novo sem efeito.
-- =====================================================================

create or replace function tg_config_versao_fichas_da_loja()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.impressao is not distinct from old.impressao then
    return null;
  end if;
  -- Apagada junto com a loja, a linha da loja já não existe: não sobe nada.
  perform bump_config_versao(coalesce(new.loja_id, old.loja_id));
  return null;
end $$;

drop trigger if exists fichas_da_loja_config_versao on fichas_da_loja;
create trigger fichas_da_loja_config_versao
  after insert or update or delete on fichas_da_loja
  for each row execute function tg_config_versao_fichas_da_loja();
