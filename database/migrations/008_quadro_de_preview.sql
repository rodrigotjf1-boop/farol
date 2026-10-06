-- =====================================================================
-- Farol · migration 008 — o quadro de preview do canal
-- =====================================================================
-- O usuário abre o canal cadastrado, pede um quadro de teste e desenha
-- em cima dele a área que importa. Não há modelo envolvido e não há
-- análise: é sincronização e caminho de dados.
--
-- ## O preview pertence ao CANAL, não a uma captura
--
-- É uma imagem FIXA do que aquele canal enquadra. A cena não muda de
-- lugar: a bancada é a bancada. Então ela fica guardada no ponto e só
-- troca quando o usuário clica em atualizar — o que dispara uma captura
-- nova pelo `comando_agente`.
--
-- Guardar assim é o que permite reabrir a tela e já ver o canal, sem
-- esperar a loja responder. Capturar a cada abertura seria lentidão
-- gratuita num dado que praticamente não muda.
--
-- Uma imagem por canal, substituída e não acumulada: o espaço fica preso
-- ao número de câmeras, não ao tempo de uso. Some junto com o ponto.
--
-- ## É a ÚNICA imagem que sai da loja sem recorte
--
-- E tem que ser: para decidir onde cortar, o usuário precisa ver o que
-- está fora do corte. Toda outra imagem do produto é recortada no agente
-- antes de viajar.
--
-- Por isso recebe tratamento próprio: **rosto borrado no agente antes de
-- subir**, e não vira evento nem histórico. Serve para desenhar.
--
-- ## De quebra, responde o que hoje é digitado à mão
--
-- `resolucao_h` é campo que o diagnóstico exige e que alguém precisa
-- descobrir e digitar. O quadro capturado **sabe** a largura dele. Medir
-- vence perguntar: ninguém erra o que não precisa responder.
--
-- ## Por que `bytea` e não um storage
--
-- Uma imagem por canal, de poucas centenas de kB, substituída no lugar.
-- Um bucket para isso significaria credencial nova no agente, URL
-- assinada, provedor a mais na conta e mais uma coisa fora do ar na hora
-- da instalação. Foto de referência da base de conhecimento é outra
-- história — permanente e aos montes — e aí storage se justifica.
--
-- ⚠️ Nenhuma consulta de `ponto` usa `select *` hoje (conferido em
-- `console.ts`, `configuracao.ts` e `diagnostico.ts`, que listam as
-- colunas). Mantenha assim: um `select *` numa listagem traria os bytes
-- de todos os canais para preencher uma tabela de texto.
-- =====================================================================

alter table ponto
  add column if not exists preview          bytea,
  add column if not exists preview_tipo     text,
  add column if not exists preview_largura  integer,
  add column if not exists preview_altura   integer,
  add column if not exists preview_em       timestamptz;

comment on column ponto.preview is
  'JPEG do que o canal enquadra, com rosto já borrado pelo agente. É a '
  'única imagem do produto que sai da loja sem recorte — e tem que ser, '
  'porque o usuário precisa ver o que está fora do corte para decidir '
  'onde cortar. Serve para desenhar a área; não vira evento nem '
  'histórico. Nunca a traga num select de listagem.';

comment on column ponto.preview_largura is
  'Largura em pixels do quadro capturado. Preenche `resolucao_h` quando '
  'ela estiver vazia: medir vence perguntar.';
