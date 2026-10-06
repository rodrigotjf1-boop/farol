-- =====================================================================
-- Farol · migration 011 — para quem o alerta vai, e se chegou
-- =====================================================================
-- O Farol já sabe ver e já sabe julgar. O que falta é a parte que dá
-- valor ao resto: **alguém saber**. Um veredito que fica no banco é um
-- relatório; um veredito que chega a quem pode agir é uma auditoria.
--
-- ## A divisão: o Farol decide, outro entrega
--
-- Reimplementar WhatsApp aqui significaria manter um segundo cadastro de
-- número, uma segunda fila de retentativa, e descobrir sozinho os mesmos
-- erros de template da Meta que o Regem já catalogou. Pior: amarraria um
-- produto REVENDÁVEL a um provedor de mensageria.
--
-- Então estas tabelas guardam a DECISÃO — quem recebe o quê — e o
-- despacho sai por webhook para o Regem ou o n8n. Exceção: o KDS, que é
-- integração direta Farol↔Regem e é onde o alerta vale mais, porque a
-- cozinha já está olhando para aquela tela.
--
-- ## Por que política em tabela, e não `if` no código
--
-- "Urgente sempre; intermediário só para a gerência; leve conforme a
-- loja" é regra de NEGÓCIO, e muda sem aviso. Em código, cada mudança
-- custa um deploy. Em tabela, quem opera muda sozinho — e a mudança fica
-- auditável, que é o que um produto de auditoria deve a si mesmo.
-- =====================================================================

-- ───────────────────────── destino ──────────────────────────
-- Quem recebe. Separado da regra DE PROPÓSITO: se o número morasse na
-- regra, cada regra nova repetiria o cadastro de quem avisar, e trocar o
-- celular do gerente viraria caça ao tesouro por trinta regras.

create table if not exists destino (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete cascade,
  -- Nulo = vale para a rede inteira. Uma rede de dez lojas cadastra o
  -- celular do dono uma vez, não dez.
  loja_id     uuid references loja(id) on delete cascade,
  tipo        text not null
              check (tipo in ('whatsapp','email','kds','webhook')),
  nome        text not null,                 -- "Celular do gerente"
  -- Número em E.164, e-mail, ou URL. NUNCA um segredo: ver `segredo_ref`.
  endereco    text not null,
  -- Para a política "intermediário só para a gerência".
  papel       text check (papel in ('presidente','gerente','supervisao','execucao')),
  -- O token do webhook NÃO mora aqui: aqui fica o NOME da variável que o
  -- despachante resolve no ambiente dele. Mesmo desenho do cofre do
  -- agente. Guardar o token na linha o exporia em todo backup, em todo
  -- `select *` e em toda tela que listar destinos — e o dono do produto
  -- nunca autorizou isso.
  segredo_ref text,
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists destino_loja_idx on destino (tenant_id, loja_id)
  where ativo;

-- O mesmo endereço cadastrado duas vezes manda o alerta duas vezes, e
-- quem recebe aprende a ignorar os dois.
create unique index if not exists destino_endereco_uk
  on destino (tenant_id, coalesce(loja_id, '00000000-0000-0000-0000-000000000000'::uuid), tipo, endereco);

comment on column destino.endereco is
  'Número E.164, e-mail ou URL. Nunca segredo — o token do webhook vai '
  'por `segredo_ref`, resolvido no ambiente de quem despacha.';
comment on column destino.loja_id is
  'Nulo = destino de toda a rede. Evita recadastrar o dono em cada loja.';

-- ──────────────────── politica_alerta ─────────────────────
-- Casa (severidade × prioridade) com destino. Nulo = curinga.

create table if not exists politica_alerta (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete cascade,
  -- Nulo = padrão da rede. Loja que cadastrou política decide por si.
  loja_id     uuid references loja(id) on delete cascade,
  severidade  text check (severidade in ('info','atencao','critico','emergencia')),
  prioridade  text check (prioridade in ('urgente','intermediaria','leve')),
  -- `false` é VETO: silencia a combinação inteira, mesmo que outra linha
  -- mande enviar. "Não me avise de leve à noite" tem que ser dizível em
  -- uma linha, sem apagar as outras.
  enviar      boolean not null default true,
  destino_id  uuid references destino(id) on delete cascade,
  criado_em   timestamptz not null default now()
);

create index if not exists politica_escopo_idx
  on politica_alerta (tenant_id, loja_id);

-- Enviar sem destino não quer dizer nada; vetar com destino é ambíguo.
alter table politica_alerta
  drop constraint if exists politica_destino_coerente;
alter table politica_alerta
  add constraint politica_destino_coerente
  check ((enviar and destino_id is not null) or (not enviar and destino_id is null));

comment on table politica_alerta is
  'Por severidade × prioridade (nulo = qualquer), para onde vai. Uma '
  'linha com enviar=false veta a combinação. Sem política que case, o '
  'padrão é conservador no sentido certo: emergência e urgente alcançam '
  'todos os destinos ativos da loja; o resto não sai. Alerta a mais '
  'incomoda; emergência não vista tira a razão de ser do produto.';

-- ───────────────────────── envio ──────────────────────────
-- O que foi despachado, para quem, e **o que aconteceu**.

create table if not exists envio (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant(id) on delete cascade,
  loja_id      uuid references loja(id) on delete cascade,
  -- Nulo de propósito: alerta de infraestrutura ("o agente caiu") não
  -- nasce de evento nenhum, e é justamente o mais urgente de todos —
  -- porque sem agente NADA está sendo auditado.
  evento_id    uuid references evento(id) on delete set null,
  destino_id   uuid not null references destino(id) on delete cascade,
  motivo       text not null
               check (motivo in ('evento','agente_caiu','busca_concluida')),
  -- `enviado` = entreguei ao transporte. `entregue` = o transporte
  -- confirmou. São fatos diferentes, e a diferença entre eles é a única
  -- coisa que explica um alerta que ninguém viu.
  estado       text not null default 'pendente'
               check (estado in ('pendente','enviado','entregue','falhou','descartado')),
  tentativas   integer not null default 0,
  erro         text,
  payload      jsonb,
  -- Mesma proteção do evento: retentativa depois de queda de rede não
  -- pode mandar o mesmo aviso de novo.
  chave        text not null,
  criado_em    timestamptz not null default now(),
  despachado_em  timestamptz,
  confirmado_em  timestamptz
);

create unique index if not exists envio_chave_uk on envio (chave);
create index if not exists envio_pendente_idx
  on envio (criado_em) where estado in ('pendente','falhou');
create index if not exists envio_evento_idx on envio (evento_id);

comment on column envio.chave is
  'Idempotência do DESPACHO. Para evento: evento+destino. Para agente '
  'caído: agente+destino+faixa de tempo — assim um agente fora do ar por '
  'três dias avisa de novo periodicamente, sem avisar a cada minuto.';
comment on column envio.estado is
  '`enviado` é "passei adiante"; `entregue` é "o transporte confirmou". '
  'Sem os dois não há como responder "o alerta chegou?".';
