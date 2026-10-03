-- =====================================================================
-- Farol · migration 002 — base técnica e motor de dimensionamento
-- =====================================================================
-- Transforma a pesquisa de mercado em dado consultável. O sistema usa isto
-- para, a partir do que o usuário quer analisar e do que ele já tem, montar
-- a estrutura recomendada, apontar o que está fora do padrão para mais ou
-- para menos, e indicar o upgrade quando passar com limitação.
--
-- Três pontas se comparam: REQUERIDO (pelas regras) × DECLARADO (formulário)
-- × DETECTADO (pelo agente na instalação).
-- =====================================================================

-- ─────────────────────── catálogo de equipamento ───────────────────────

create table if not exists equipamento (
  id            uuid primary key default gen_random_uuid(),
  categoria     text not null check (categoria in (
                  'camera_ip','camera_analogica','camera_usb',
                  'gravador_dvr','gravador_nvr',
                  'computador','gpu','acelerador',
                  'switch','roteador','nobreak','disco','iluminacao')),
  fabricante    text not null,
  modelo        text not null,
  -- specs canônicas por categoria, com os campos que o motor compara.
  -- O que varia por categoria fica aqui; o que é comum vira coluna.
  specs         jsonb not null default '{}'::jsonb,
  -- recomendado  = entra na proposta
  -- aceitavel    = funciona, com ressalva registrada
  -- descartado   = não propor; o motivo fica em observacao
  status        text not null default 'aceitavel'
                check (status in ('recomendado','aceitavel','descartado')),
  observacao    text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists equipamento_uk on equipamento (fabricante, modelo);
create index if not exists equipamento_categoria_idx on equipamento (categoria, status);

-- Preço muda toda semana e a fonte importa. Histórico, não coluna única.
create table if not exists equipamento_preco (
  id            uuid primary key default gen_random_uuid(),
  equipamento_id uuid not null references equipamento(id) on delete cascade,
  loja          text not null,
  preco         numeric(10,2) not null,
  url           text,
  em_estoque    boolean,
  -- confirmado = página aberta e lida; indice = veio de busca, conferir
  confianca     text not null default 'indice'
                check (confianca in ('confirmado','indice','estimado')),
  cotado_em     date not null default current_date
);
create index if not exists equipamento_preco_idx on equipamento_preco (equipamento_id, cotado_em desc);

-- ──────────────────── requisito por tipo de uso ────────────────────────
-- O que cada categoria de regra EXIGE para funcionar. É a outra metade da
-- comparação: sem isto, não há como dizer que um equipamento "não atende".

create table if not exists requisito_uso (
  id              uuid primary key default gen_random_uuid(),
  -- casa com regra.tipo da migration 001
  tipo_regra      text not null check (tipo_regra in
                  ('estado','acao','presenca','contagem','comparacao')),
  -- subcaso, quando o mesmo tipo tem exigências diferentes
  variante        text,
  descricao       text not null,
  -- os números que o motor compara
  px_por_cm_min   numeric(6,2),     -- no quadro que chega ao modelo
  fps_min         numeric(5,2),
  exige_cor       boolean not null default false,
  exige_wdr_db    integer,
  exige_local     boolean not null default false,  -- prioridade urgente
  quadros_por_analise integer not null default 1,
  observacao      text,
  criado_em       timestamptz not null default now()
);
create unique index if not exists requisito_uso_uk on requisito_uso (tipo_regra, coalesce(variante,''));

-- ───────────────────── levantamento do cliente ─────────────────────────
-- O formulário: o que ele quer analisar e o que já tem.

create table if not exists levantamento (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid references tenant(id) on delete cascade,
  loja_id       uuid references loja(id) on delete set null,
  nome          text not null,
  -- o que ele quer analisar, por setor: [{setor, tipos:[], horas_dia, prioridade}]
  intencao      jsonb not null default '[]'::jsonb,
  n_cameras     integer,
  -- condições que mudam o dimensionamento
  tem_internet_estavel boolean,
  imagem_pode_sair     boolean not null default true,
  precisa_offline      boolean not null default false,
  precisa_busca        boolean not null default false,
  estado        text not null default 'rascunho'
                check (estado in ('rascunho','diagnosticado','aprovado','instalado')),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists levantamento_tenant_idx on levantamento (tenant_id);

-- O que ele DECLARA que já tem. Uma linha por equipamento existente.
create table if not exists levantamento_item (
  id              uuid primary key default gen_random_uuid(),
  levantamento_id uuid not null references levantamento(id) on delete cascade,
  categoria       text not null,
  -- quando reconhece no catálogo, aponta; quando não, fica só o texto livre
  equipamento_id  uuid references equipamento(id) on delete set null,
  descricao_livre text,
  quantidade      integer not null default 1,
  -- specs declaradas pelo usuário quando o modelo não está no catálogo
  specs_declaradas jsonb not null default '{}'::jsonb,
  -- specs que o AGENTE detectou na instalação — a terceira ponta
  specs_detectadas jsonb,
  detectado_em    timestamptz,
  criado_em       timestamptz not null default now()
);
create index if not exists levantamento_item_idx on levantamento_item (levantamento_id);

-- ───────────────────────── diagnóstico ─────────────────────────────────
-- O resultado: estrutura recomendada mais os achados.

create table if not exists diagnostico (
  id              uuid primary key default gen_random_uuid(),
  levantamento_id uuid not null references levantamento(id) on delete cascade,
  -- a estrutura que o motor montou: [{categoria, equipamento_id, qtd, motivo}]
  recomendado     jsonb not null default '[]'::jsonb,
  custo_implantacao numeric(10,2),
  custo_mensal      numeric(10,2),
  modo_julgamento_sugerido text
                  check (modo_julgamento_sugerido in ('nuvem','local','hibrido')),
  analises_dia    integer,
  -- resumo: quantos achados de cada gravidade
  resumo          jsonb not null default '{}'::jsonb,
  gerado_em       timestamptz not null default now()
);
create index if not exists diagnostico_levantamento_idx on diagnostico (levantamento_id, gerado_em desc);

-- Cada achado da comparação. É isto que vira o alerta na tela.
create table if not exists diagnostico_item (
  id              uuid primary key default gen_random_uuid(),
  diagnostico_id  uuid not null references diagnostico(id) on delete cascade,
  -- atende             → segue
  -- atende_com_limitacao → funciona, mas com ressalva; upgrade sugerido
  -- nao_atende         → inviabiliza a regra; upgrade obrigatório
  -- superdimensionado  → sobra; dá para economizar
  -- divergente         → o declarado não bate com o detectado
  gravidade       text not null check (gravidade in
                  ('atende','atende_com_limitacao','nao_atende',
                   'superdimensionado','divergente')),
  categoria       text not null,
  item            text not null,          -- o que foi avaliado
  requerido       text,                   -- o que a regra exige, legível
  encontrado      text,                   -- o que ele tem, legível
  mensagem        text not null,          -- o alerta, em português
  -- o upgrade indicado, quando houver
  upgrade_equipamento_id uuid references equipamento(id) on delete set null,
  upgrade_custo   numeric(10,2),
  -- qual regra fica comprometida, quando aplicável
  regra_afetada   text,
  ordem           integer not null default 0
);
create index if not exists diagnostico_item_idx on diagnostico_item (diagnostico_id, gravidade, ordem);

-- =====================================================================
-- SEED — a pesquisa de 01 a 03/10/2026 vira dado consultável
-- =====================================================================

-- ─── requisitos por tipo de uso ───
insert into requisito_uso (tipo_regra, variante, descricao, px_por_cm_min, fps_min, exige_cor, exige_wdr_db, exige_local, quadros_por_analise, observacao) values
 ('presenca', null, 'Presenca em zona e horario', 1.5, 2, false, null, false, 1,
  'Detector local resolve. Nao usa modelo de visao.'),
 ('contagem', null, 'Contagem de pessoas, fila e ocupacao', 1.5, 2, false, null, false, 1,
  'Detector local. Modelo de visao erra contagem — nao usar VLM aqui.'),
 ('comparacao', null, 'Comparacao com padrao de referencia', 3.0, 0.2, false, null, false, 1,
  'Embedding local compara com a base de conhecimento. So escala para VLM abaixo do limiar.'),
 ('estado', null, 'Estado em um quadro: EPI, limpeza, organizacao', 3.0, 0.2, false, 90, false, 1,
  'O caso mais confiavel. Um quadro resolve.'),
 ('estado', 'cor', 'Estado que depende de cor: touca branca, luva azul, produto cru', 3.0, 0.2, true, 120, false, 1,
  'Se a camera cai para infravermelho preto e branco, a regra morre a noite.'),
 ('estado', 'leitura', 'Leitura de texto, etiqueta ou validade', 12.0, 0.2, false, 120, false, 1,
  'Exige resolucao bem maior que estado comum.'),
 ('acao', null, 'Sequencia de acao: procedimento com etapas', 3.0, 2, false, 90, false, 8,
  'Multiplica o token por 6 a 10. Preferir auditar o resultado mais dois marcos.'),
 ('acao', 'montagem', 'Montagem item a item com verificacao binaria', 12.8, 2, true, 120, true, 10,
  'Camera dedicada em close, luz controlada e receita vinda do Regem. '
  || 'Prioridade urgente: a ida e volta a nuvem gasta 2 a 5 s so de rede.')
on conflict do nothing;

-- ─── gravadores ───
insert into equipamento (categoria, fabricante, modelo, status, observacao, specs) values
 ('gravador_dvr','Intelbras','MHDX 3116-C','recomendado',
  'Grava 1080p real. Inteligencia de video em 1 canal apenas; movimento em todos os 16 — '
  || 'por isso a classificacao acontece no agente. Firmware trunca a lista de codes do '
  || 'eventManager.cgi em ~100 caracteres: usar [All] e filtrar no agente. Desligar deteccao de face.',
  '{"canais_bnc":16,"canais_ip":8,"resolucao_max_real":"5MP Lite","grava_1080n":false,
    "fps_por_canal_full":15,"throughput_mbps":96,"conexoes_simultaneas":128,
    "inteligencia_canais":1,"inteligencia_tipos":["cerca_virtual","linha_virtual","objeto_abandonado","face"],
    "movimento_todos_canais":true,"zonas_movimento":330,
    "protocolo_evento":"dahua_cgi","rede_mbps":1000,"substream":"D1/CIF",
    "compressao":["H.264+","H.264"],"onvif":true,"rtsp":true,"disco_max_tb":10}'::jsonb),
 ('gravador_dvr','Intelbras','MHDX 3108-C','recomendado',
  'Mesma familia, 8 canais. Para ate 8 cameras.',
  '{"canais_bnc":8,"canais_ip":4,"resolucao_max_real":"5MP Lite","grava_1080n":false,
    "inteligencia_canais":1,"movimento_todos_canais":true,"protocolo_evento":"dahua_cgi"}'::jsonb),
 ('gravador_dvr','Intelbras','MHDX 1308','descartado',
  'ARMADILHA: grava 1080p Lite (960x1080 esticado) por padrao. O modo Full HD existe, mas '
  || 'ativa-lo DESABILITA a deteccao inteligente e os canais IP — escolhe resolucao ou IA, nunca os dois.',
  '{"grava_1080n":true,"armadilha":"1080N"}'::jsonb),
 ('gravador_dvr','Intelbras','MHDX 1204-C','descartado',
  'Grava 1080N: 960x1080 esticado. Metade da resolucao horizontal real.',
  '{"grava_1080n":true,"armadilha":"1080N"}'::jsonb),
 ('gravador_nvr','Intelbras','NVD 1408 P','aceitavel',
  'NVR 8 canais com 8 portas PoE — dispensa switch PoE separado.',
  '{"canais_ip":8,"poe_portas":8,"resolucao_max_real":"4K","protocolo_evento":"dahua_cgi"}'::jsonb)
on conflict (fabricante, modelo) do nothing;

-- ─── cameras ───
insert into equipamento (categoria, fabricante, modelo, status, observacao, specs) values
 ('camera_analogica','Intelbras','VHD 3250 VF G7','recomendado',
  'Varifocal MANUAL — vantagem em inspecao fixa: ajusta uma vez, trava, nao desalinha. '
  || 'Motorizada pode refazer autofoco no boot e quebrar o classificador treinado.',
  '{"resolucao_h":1920,"mp":2,"sensor_pol":0.357,"sensor_mm":5.0,
    "lente_min_mm":2.7,"lente_max_mm":12,"lente_motorizada":false,
    "wdr":"DWDR","cor_24h":false,"interface":"analogica_4em1","corpo":"bullet_metal"}'::jsonb),
 ('camera_analogica','Hikvision','DS-2CE16H0T-ITPF','aceitavel',
  'Melhor relacao preco por megapixel. Lente FIXA de 2,8 mm: so serve a curta distancia. '
  || 'A 85 cm enquadra 160 cm — larga demais para inspecao de bancada.',
  '{"resolucao_h":2592,"mp":5,"lente_min_mm":2.8,"lente_max_mm":2.8,
    "interface":"analogica_4em1","cor_24h":false}'::jsonb),
 ('camera_analogica','Intelbras','VHD 3150 VF G7','descartado',
  'ARMADILHA: lojas anunciam 2 MP, o datasheet oficial diz 1 MP / 1280x720.',
  '{"resolucao_h":1280,"mp":1,"armadilha":"anunciado_2mp_e_720p"}'::jsonb),
 ('camera_ip','Hikvision','DS-2CD2043G2-LI2U','recomendado',
  'AcuSense: classifica pessoa a bordo e faz POST no webhook via ISAPI httpHosts, '
  || 'com detectionTarget ja resolvido. Smart Hybrid Light e microfone.',
  '{"resolucao_h":2688,"mp":4,"lente_min_mm":2.8,"lente_max_mm":2.8,
    "ia_embarcada":true,"protocolo_evento":"isapi","luz_branca":true,
    "interface":"ip_poe","onvif":["S","G"]}'::jsonb),
 ('camera_ip','Hikvision','DS-2CD2T47G2-LSU/SL','recomendado',
  'ColorVu: cor 24 h real. Sensor 1/1.8 F1.0. Necessaria onde a regra depende de cor a noite.',
  '{"resolucao_h":2688,"mp":4,"sensor_pol":0.555,"lente_min_mm":2.8,"lente_max_mm":2.8,
    "wdr_db":130,"cor_24h":true,"interface":"ip_poe"}'::jsonb),
 ('camera_ip','Intelbras','VIP 3260 Z IA','recomendado',
  'IP varifocal mais barata com estoque e o melhor WDR da faixa. Autofoco: desligar e travar '
  || 'o zoom apos calibrar, senao o enquadramento muda e quebra o classificador.',
  '{"resolucao_h":1920,"mp":2,"lente_min_mm":2.7,"lente_max_mm":13.5,"lente_motorizada":true,
    "wdr_db":120,"starlight":true,"fps_max":30,"interface":"ip_poe"}'::jsonb),
 ('camera_ip','Intelbras','VIP 3830 B IA','aceitavel',
  '8 MP 4K com ONVIF S, T e G. Lente fixa de 3,6 mm.',
  '{"resolucao_h":3840,"mp":8,"lente_min_mm":3.6,"lente_max_mm":3.6,
    "wdr_db":120,"interface":"ip_poe","onvif":["S","T","G"]}'::jsonb),
 ('camera_usb','ELP','USB 1080p varifocal 2.8-12mm','aceitavel',
  'UVC plug-and-play: entra no OpenCV direto, sem RTSP, sem gravador, sem rede. '
  || 'Taxa de quadros garantida. Limite de cabo USB passivo: ~5 m. Corpo plastico, sem WDR.',
  '{"resolucao_h":1920,"mp":2,"lente_min_mm":2.8,"lente_max_mm":12,"lente_motorizada":false,
    "fps_max":30,"interface":"usb_uvc","cabo_max_m":5}'::jsonb)
on conflict (fabricante, modelo) do nothing;

-- ─── computador, GPU e acelerador ───
insert into equipamento (categoria, fabricante, modelo, status, observacao, specs) values
 ('computador','Intel','i7 10a geracao com UHD 630','recomendado',
  'QuickSync decodifica H.264 e H.265 por hardware. NUNCA a versao F: sem iGPU nao ha decode.',
  '{"tem_igpu":true,"quicksync":true,"decode_streams_1080p":16,"inferencias_s":50}'::jsonb),
 ('computador','Intel','Mini PC N150','aceitavel',
  'Decodifica ~8 streams 1080p. Basta quando a camera entrega o evento pronto.',
  '{"tem_igpu":true,"quicksync":true,"decode_streams_1080p":8,"inferencias_s":33}'::jsonb),
 ('gpu','NVIDIA','RTX 5060 Ti 16GB','recomendado',
  'Melhor VRAM por real com CUDA. Roda modelo de visao de 9B a 12B em 4 bits.',
  '{"vram_gb":16,"banda_gbs":448,"watts":180,"fp8":true}'::jsonb),
 ('gpu','NVIDIA','RTX PRO 4000 Blackwell 24GB','aceitavel',
  'O piso NVIDIA novo de 24 GB no Brasil. Driver profissional sem clausula de datacenter.',
  '{"vram_gb":24,"watts":140,"ecc":true,"fp8":true}'::jsonb),
 ('gpu','NVIDIA','RTX 3090 24GB usada','descartado',
  'Sem nota, sem garantia, sem reposicao. Estudo de campo aponta 43% mais falha de ventoinha '
  || 'em placa que veio de mineracao. Inaceitavel em equipamento instalado em loja de cliente.',
  '{"vram_gb":24,"banda_gbs":936,"watts":350,"fp8":false,"risco":"usada"}'::jsonb),
 ('acelerador','Google','Coral USB Accelerator','descartado',
  'Projeto abandonado na pratica: ultima noticia oficial em 2022, driver nao compila em kernels '
  || 'recentes. A documentacao do Frigate retirou a recomendacao. E no Brasil custa R$ 1.117 a 2.160 '
  || 'por 4 TOPS, contra R$ 1.799 por 26 TOPS do Hailo. Nao roda modelos com atencao.',
  '{"tops":4,"status":"abandonado"}'::jsonb)
on conflict (fabricante, modelo) do nothing;

-- ─── nobreak: a armadilha da onda ───
insert into equipamento (categoria, fabricante, modelo, status, observacao, specs) values
 ('nobreak','TS Shara','XPro 1500VA 4538','recomendado',
  'Senoidal PURA confirmada na ficha. Entrada bivolt automatica.',
  '{"va":1500,"watts":900,"onda":"senoidal_pura","bivolt":true}'::jsonb),
 ('nobreak','SMS','Pro 1500VA','descartado',
  'ARMADILHA: a ficha diz senoidal por aproximacao (retangular PWM). Fonte com PFC ativo '
  || 'reclama ou desliga. Mais barato, nao serve.',
  '{"va":1500,"onda":"aproximada","armadilha":"nao_e_senoidal_pura"}'::jsonb)
on conflict (fabricante, modelo) do nothing;
