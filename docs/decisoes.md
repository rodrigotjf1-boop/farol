# Decisões de projeto — Farol

Registro das decisões tomadas e do porquê. Decisão nova entra aqui com data.
Quando uma decisão é revertida, a antiga **fica** e ganha nota de revogação —
saber o que já foi tentado vale tanto quanto saber o que vale hoje.

---

## 03/10/2026 · Arquitetura em três camadas

Console na nuvem, agente sempre na loja, julgamento configurável por loja em
`loja.modo_julgamento`.

**Por quê:** local ou nuvem não é escolha binária. O console precisa ser
multi-loja. O agente precisa falar com a câmera. Só o julgamento tem de fato
duas respostas possíveis, e ela depende do cliente — por LGPD, por operação
sem internet, ou por custo.

---

## 03/10/2026 · Escopo completo na v1, com feature flag

Montagem, contagem treinada, sequência de ação, Jev e julgamento local entram
no código da v1, nascendo **desligados** (`regra.ativa = false`) até terem
acurácia medida.

**Por quê:** fatiar em v1.1 e v1.2 dispersa a lógica e muda o rumo no meio.
Construir tudo e ligar por medição mantém a coerência e não custa quase nada —
o caro é refazer a estrutura depois.

---

## 03/10/2026 · Campo agora, política depois

Os campos de retenção, consentimento e expurgo entram na migration 001 e ficam
sem uso. A política que os preenche se decide no Bloco B, sobre a estrutura real.

**Por quê:** concilia não travar na LGPD no início com não refazer o banco no
fim. Adicionar coluna em tabela vazia é trivial; adicionar em tabela com um ano
de evento de loja de cliente é migração de madrugada.

---

## 03/10/2026 · 🔴 O gatilho é em dois estágios — correção

**Decisão anterior (revogada no mesmo dia):** usar a detecção de pessoa do
gravador MHDX 3000 como gatilho classificado em todos os canais.

**O que mudou:** a ficha técnica do MHDX 3116-C diz, na seção de inteligências
de vídeo: *"Quantidade de canais: 1 (HDCVI, AHD, HDTVI ou analógico)"*. A
inteligência roda em **um canal só**, não nos dezesseis. E a lista de recursos é
cerca virtual, linha virtual, objeto abandonado e detecção de face — **não há
classificação de pessoa e veículo** na especificação. O que prometia isso era a
descrição do anúncio no marketplace, que é texto de marketing.

**Decisão nova:**

| Estágio | Onde | O que faz |
|---|---|---|
| 1 | DVR, **todos os canais** | Detecção de movimento por zona (330 zonas, 22×15) → evento bruto |
| 2 | Agente, iGPU via OpenVINO | RF-DETR classifica: é pessoa? Filtra a mosca |

**Consequência:** o detector local volta a ser parte fixa do agente, não
opcional. O PC passa a ter trabalho contínuo, a iGPU vira requisito duro, e o
processador **nunca** pode ser a versão F.

**Nota de mercado:** nenhum gravador barato classifica em todos os canais com
câmera analógica sem inteligência — na Hikvision a limitação é equivalente.
Então a classificação no agente é a resposta certa independente de marca, e o
gravador passa a ser comprado por um motivo só: gravar em 1080p real em vez de
1080N.

---

## 03/10/2026 · Modo sandbox no agente

O agente reproduz uma pasta de quadros gravados como se fosse câmera ao vivo,
com relógio simulado.

**Por quê:** sem isso, cada teste depende de ir à loja, esperar o horário certo
e torcer para a cena acontecer — e é aí que o projeto trava e perde o fio. Com
sandbox, o mesmo cenário se reproduz em segundos, quantas vezes quiser, e dá
para comparar versões de prompt contra o mesmo material. É também o que
viabiliza o conjunto de avaliação e a medição de acurácia.

---

## 03/10/2026 · Gabarito replicável nas estações de montagem

A loja tem **4 estações de montagem**: 1 usada todo dia, 2 nos fins de semana,
as 4 só em alta demanda. A câmera dedicada começa **só na estação diária**.

**Mas:** o campo `ponto.gabarito` guarda altura, ângulo, distância e posição do
LED, e as quatro estações devem receber a câmera no **mesmo gabarito**, mesmo
que só uma seja ligada agora.

**Por quê:** o classificador treinado na estação 1 só transfere para as outras
três se o enquadramento e a luz forem equivalentes. Se cada estação for
improvisada, é preciso treinar quatro vezes. Padronizar na instalação custa
nada; descobrir depois custa quatro conjuntos de treino.

**Lacuna conhecida e aceita:** produção de fim de semana e de pico nas estações
2, 3 e 4 fica sem auditoria de montagem até elas receberem câmera.

---

## 03/10/2026 · Veredito por item, nunca agregado

Em regra que soma vários itens — montagem, checklist de fechamento — o veredito
é **por item** ("faltou o queijo"), nunca agregado ("a montagem está errada").

**Por quê:** o erro se multiplica. Classificador com 95% por ingrediente acerta
só 66% dos sanduíches de oito itens; com 98%, 85%. Veredito agregado só é
usável acima de 99% por item, e isso exige condição controlada.

---

## 03/10/2026 · Auditar o resultado, não o caminho

Quando o resultado é observável, a regra verifica o resultado mais um ou dois
marcos — não todas as etapas do procedimento.

**Por quê:** a limpeza da chapa tem seis etapas; checar as seis é série de
quadros, que multiplica o token por 6 a 10 e perde acurácia em cada elo.
Checar a chapa limpa com filme de óleo no fim, mais dois marcos, entrega quase
o mesmo valor de controle por um sexto do custo.

---

## 03/10/2026 · Detecção de face desligada

A detecção de face do gravador fica **desligada** na configuração padrão, e o
produto não implementa reconhecimento facial.

**Por quê:** dado biométrico é categoria sensível e mudaria a classificação
jurídica do produto inteiro. A regra deve ser "havia alguém sem touca na chapa",
não "o João estava sem touca".

---

## 03/10/2026 · O site fica como está, por ora

A landing promete processamento local. A conta etapa por etapa mostra que **14
das 15 etapas do pipeline rodam na loja**, e que três das cinco categorias de
regra nunca chegam à nuvem. O texto se sustenta.

**Revisão adiada** para quando a v1 estiver rodando e houver base medida para
detalhar a proposta com número em vez de promessa.

---

## 03/10/2026 · Câmera da montagem em dois tempos — revisão

**Decisão anterior:** câmera IP 4 MP dedicada ligada direto no PC, R$ 1.534 com
instalação, para a estação de montagem.

**O que mudou:** refazendo a conta de pixel por centímetro, uma **analógica de
5 MP em close empata opticamente** com a IP de 4 MP.

| | IP 4 MP | Analógica 5 MP em close |
|---|---|---|
| Pixels horizontais | 2688 | 2592 |
| Px/cm enquadrando 40 cm | 67 | 65 |
| No modelo, após resize para 640 | 16 px/cm | 16 px/cm |
| Custo com instalação | R$ 1.534 | **≈ R$ 400** |

**Decisão nova — testar em dois tempos:**

1. **Primeiro** a analógica 5 MP em close mais barra de LED, por ~R$ 400,
   ocupando um dos 7 canais livres do MHDX 3116-C.
2. **Só se** o framerate pelo gravador não sustentar a sequência, subir para a
   IP ligada direto no agente.

**Por quê:** a diferença real entre as duas não é óptica, é **taxa de quadros**.
A montagem precisa de 2 a 5 quadros por segundo durante 20 a 40 segundos, e o
main-stream do MHDX é 1080p a 15 FPS compartilhados entre 16 canais, dentro de
96 Mbps de throughput. Se sustentar, economiza R$ 1.100 por estação — e com 4
estações no horizonte, R$ 4.400. Se não sustentar, descobre-se medindo, não
discutindo.

**O que NÃO muda:** o gabarito continua obrigatório e idêntico nas quatro
estações, e a barra de LED continua sendo requisito, não acessório — luz
constante é pré-requisito do classificador treinado.

### Por que câmera dedicada, e por que a do setor não serve

Registrado porque a pergunta vai voltar. **Não é megapixel, é pixel por
centímetro no objeto** — e isso depende muito mais da distância que do sensor:

| | Setor · 2 MP | Setor · 4 MP | Dedicada em close |
|---|---|---|---|
| Largura enquadrada | 350 cm | 350 cm | 40 cm |
| Px/cm no modelo | 2,8 | 3,8 | **16** |
| Picles de 3 cm | **8 px** | 11 px | **48 px** |
| Fatia de queijo de 10 cm | 28 px | 38 px | 160 px |

Subir de 2 para 4 MP na câmera do setor leva o picles de 8 para 11 pixels — não
resolve. Uma câmera de R$ 2.769 na parede perde para uma de R$ 173 a meio metro.

Mais quatro fatores: **oclusão** (a do setor vê de lado, o corpo do montador
tapa; a dedicada vê por cima do ombro), **taxa de quadros** (as outras regras
pegam um quadro; montagem é sequência), **luz** (ambiente de cozinha tem sombra
e reflexo variáveis, e luz constante é pré-requisito do classificador) e
**estabilidade** (o classificador aprende a cena; cinco graus de desvio degradam
em silêncio).

**E o inverso também vale:** para todas as outras regras — touca, bancada limpa,
fila, presença, fechamento — a câmera do setor basta, porque o objeto é grande e
um quadro só responde. A montagem é a única que pede câmera própria.

## 04/10/2026 · Migration viaja pelo deploy, não pela área de transferência

**Decisão:** o `farol-api` carrega `database/migrations` dentro da própria
imagem, e aplicar é `npm run migrar` no console do serviço. O banco do Farol
**não fica exposto na internet** e nenhuma credencial sai do painel.

**O que foi descartado, e por quê:**

| Caminho | Por que não |
|---|---|
| Colar o SQL no console do Postgres | Foi tentado. O terminal do navegador travou duas vezes com 16 KB, e um paste truncado aplica meia estrutura em silêncio |
| Expor a porta 5432 e aplicar de fora | Superfície permanente de ataque para resolver um incômodo de dez minutos. A 5432 é varrida o dia inteiro |
| MCP de Postgres | Não evita a exposição: o MCP roda na máquina do operador, não na VPS. Só muda onde o segredo é digitado |

**Por quê:** o problema nunca foi falta de acesso, era o SQL viajar por fora do
git. Com a migration dentro da imagem, "o deploy subiu" e "o banco está na
versão certa" deixam de ser a mesma aposta — o `/saude` responde as duas.

**Como o runner se protege** (`api/scripts/migrar.mjs`):

- **Checksum por arquivo** em `farol_migracao`. Migration já aplicada que muda
  de conteúdo faz o runner **recusar**, em vez de seguir com o banco na versão
  velha e o repo mostrando a nova — erro que só aparece quando quebra.
- **Normaliza CRLF no checksum**, senão o mesmo arquivo teria impressão digital
  diferente entre o Windows e o contêiner.
- **Advisory lock com `Client` dedicado, nunca `Pool`:** lock de sessão só vale
  na mesma conexão, e um pool pode devolver outra no meio.
- **Uma transação por arquivo:** se a 003 falha, a 002 continua valendo.
- **Mora em `api/scripts/`**, não junto das migrations, porque precisa do `pg` —
  resolver módulo a partir de uma pasta sem `node_modules` acima não funciona.
  Acha a pasta subindo, então vale no contêiner (`/app/database`) e na máquina.

**Detalhe de montagem:** o contexto de build é a **raiz do repo**, não `api/` —
é o que permite o `COPY database ./database`. No EasyPanel isso é *Build Path*
`/` na aba Source e `api/Dockerfile` na aba Build.

### 07/10/2026 · A saúde tem de dizer que a porta está fechada

Três PRs entraram na `main` em 44 segundos (#51, #52 e #53), e o #52 levava
a migration 022. O deploy subiu com o código novo e a guarda de partida fez
o que devia: recusou todo pedido com 503 até a migration ser aplicada, três
minutos depois. O agente da loja guardou o que tinha e subiu em seguida;
nada se perdeu.

O que estava errado era a saúde. `/saude` fica de fora da guarda — de
propósito, para responder mesmo com a porta fechada — e dizia `ok: true`
com a API recusando tudo. A frase acima, "o `/saude` responde as duas",
era verdade só pela metade: ele dizia o que o banco tinha, não o que o
código esperava.

**Agora** `/saude` devolve também:

| campo | o que diz |
|---|---|
| `ok` | `false` quando há migration pendente — a API está recusando |
| `pendentes` | os arquivos que o código tem e o banco não |
| `ultimaNoCodigo` | a última migration que o código **no ar** conhece |
| `aviso` | o comando que resolve, só quando há pendência |

O status segue **200**: verificação de saúde que derruba contêiner levaria
junto o console de onde se roda a migration. Quem diz que não está bem é o
corpo.

`ultimaNoCodigo` responde a outra pergunta daquela noite — "qual deploy
ficou?". `versao` é fixa (`0.1.0`); com três implantações seguidas e uma
delas atropelada pela seguinte, não havia como saber de fora qual código
estava rodando, a não ser provocando o 503 numa rota qualquer.

**Regra de processo:** PR com migration é mesclado **sozinho e por
último**, e o `npm run migrar` vem logo em seguida. Com mais de um PR
aberto, a ordem vai dita na mensagem a quem mescla, não só na descrição do
PR.

### 08/10/2026 · A migration é aplicada na subida do serviço

**Decisão do dono:** "as migrations e PR e merge não precisam de
autorização: aplicar assim que fizer". Como o banco não fica exposto e
ninguém além dele entra no painel, "assim que fizer" só tem um jeito: o
próprio serviço aplica ao subir.

**Como ficou** (`api/src/guarda.ts`, `api/scripts/migrador.mjs`):

1. Ao subir, **antes de abrir a porta**, o serviço aplica as migrations
   pendentes — com o mesmo aplicador do `npm run migrar` (trava, checksum,
   uma transação por arquivo, que inclui o registro de que foi aplicada).
2. Confere se o banco ficou em dia.
3. Em dia, atende. Se não, recusa com 503 e diz qual arquivo não entrou —
   o processo **não sai**, porque é do console dele que se conserta.

A janela de 503 entre o deploy e a migration deixa de existir no caso
normal: o primeiro pedido já encontra o banco em dia.

| situação na subida | o que o serviço faz |
|---|---|
| nada pendente | atende |
| aplicou tudo | atende; `/saude` lista em `migracaoNaSubida.aplicadas` |
| o SQL de uma migration falhou | recusa com 503; `/saude` diz o arquivo e o código do banco; as anteriores continuam valendo; **não tenta de novo sozinho** (o SQL não muda sem novo deploy) |
| um arquivo já aplicado foi editado | recusa, como acima |
| o banco não respondeu | atende, mas não dá o esquema por certo: confere de novo a cada 10 s, e aplica quando o banco voltar |

A última linha fecha um buraco antigo: banco fora do ar na subida virava
"esquema em dia" para sempre, e cada pedido que tocasse a coluna nova
morria com 500.

**O que se perde:** o momento em que alguém olhava antes de aplicar. O que
fica no lugar: toda migration passa pelo CI num Postgres de verdade (pelo
mesmo aplicador), é idempotente, e uma falha não derruba nada — fecha a
porta e diz por quê.

**Reserva:** `npm run migrar` continua existindo, para ver o erro de uma
migration que a subida não conseguiu aplicar. `MIGRAR_NA_SUBIDA=nao`, no
ambiente do serviço, volta ao jeito antigo (só confere).

**Como conferir de fora, depois de um merge com migration:**
`curl https://api.monitorfarol.com.br/saude` → `ok: true`, `pendentes: []`,
`ultimaNoCodigo` = a migration nova, e ela em `migracaoNaSubida.aplicadas`.

## 05/10/2026 — Primeira medição de acurácia com câmera e juiz de verdade

Seis análises contra a TWG no canal 1, recorte 640×170, Haiku 4.5, critério
`"ha um controle remoto sobre a mesa branca"`. Verdade de campo conferida
depois, olhando as imagens enviadas.

| # | o que havia | veredito | confiança | certo? |
|---|---|---|---|---|
| 01 | só mouse e copo | conforme | 85% | ❌ falso positivo |
| 02 | mão, mouse e copo | nao_conforme | 90% | ✓ certo, **motivo contradizia o veredito** |
| 03 | copo e mouse | conforme | 95% | ❌ falso positivo |
| 04 | controle na mesa | conforme | 95% | ✓ |
| 05 | controle na mesa | conforme | 95% | ✓ |
| 06 | controle na mesa | conforme | 95% | ✓ |

**4 de 6.** Os dois erros são **falsos positivos confiantes**: o modelo leu o
**mouse** como controle remoto, a 85% e 95% de confiança. E o acerto do 02 foi
sorte — o `motivo` dizia "há um objeto escuro que corresponde a um controle
remoto" enquanto o veredito dizia `nao_conforme`.

### O que isto estabelece

**1 · A confiança do modelo não detecta esta classe de erro.** O produto hoje
se apoia em `confianca_minima` (0,70) e na cascata (`escalar_abaixo_de` 0,75),
e as duas escalam quando a confiança está BAIXA. Um falso positivo a 95% passa
pelas duas intocado. A cascata pega o que o modelo sabe que não sabe; não pega
o que ele acha que sabe e errou.

**2 · O critério era do tipo errado para este juiz, e a arquitetura já dizia
isso.** "Há um controle remoto sobre a mesa" é regra de **`presenca`** —
identificação de classe de objeto. O desenho do projeto já separa `presenca`,
`contagem` e `comparacao` como **100% locais**, por detector, justamente porque
VLM generalista erra classe de objeto parecido. A medição não contradiz o
desenho: é a evidência que faltava para ele.

**3 · Objeto parecido é o risco real na cozinha.** Mouse × controle remoto é o
ensaio inofensivo de termômetro × caneta, frasco de sanitizante × frasco de
molho, luva azul × pano azul. Toda regra que dependa de distinguir objeto
semelhante vai para o detector, nunca para o juiz de nuvem.

**4 · A resolução do envio provavelmente agravou.** O recorte saiu 640×170 e o
objeto ocupava ~60×30 px. O teste rodou **sem `--largura-cm`**, então o motor
de dimensionamento não tinha como avisar que a resolução estava abaixo do que
a pergunta exigia. Medição às cegas: informar a óptica do ponto deixa de ser
opcional antes de comparar modelos.

### Custo medido (corrige a estimativa anterior)

**1459 tokens de entrada, ~103 de saída, R$ 0,0107 por análise** — a 200
análises/dia numa loja, **R$ 64/mês**. A estimativa que eu tinha feito antes
(R$ 0,0037) estava **3× baixa**: medi só o texto do critério e ignorei as
instruções de sistema, o esquema da ferramenta e o custo fixo do uso de
ferramenta. Vale a regra: estimativa de custo se confere contra fatura, não
contra contagem de caracteres.

O cache de prompt está configurado (`cache_control` nas instruções), mas os
seis custos saíram idênticos — ou seja, **não houve acerto de cache**. O
provável é o piso mínimo de tokens para cache, que as instruções não alcançam.
Não compensa perseguir agora: o ganho máximo seria sobre a fração fixa do
prompt, e a decisão grande (detector local para `presenca`) tira essas
chamadas da nuvem inteiramente.
