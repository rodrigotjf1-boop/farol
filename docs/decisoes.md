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

---

## 08/10/2026 · O porteiro: a loja decide se vale perguntar à nuvem

Fase 1 do plano A16 (`docs/roadmap.md`). No primeiro dia inteiro de operação,
94% do que a loja gastou com a nuvem voltou "não deu para avaliar", e no canal
em que o detector também olhava, 271 de 482 perguntas foram feitas sem ninguém
na imagem. A loja sabia, de graça, que não havia o que perguntar.

### Na dúvida, pergunta

Segurar uma pergunta que tinha resposta esconde um problema; fazer uma que não
tinha custa um centavo. Por isso o porteiro só segura quando tem certeza:

| modo | segura quando | o que passa |
|---|---|---|
| com pessoa na área | nenhuma detecção de pessoa chega a 0,35 | o "talvez" (0,35 a 0,70) e a certeza |
| com a área livre | alguma detecção chega a 0,70 | o "talvez" e a área vazia |
| quando algo se mexe | menos de 1,2% dos pontos mudou mais de 24 tons | a primeira olhada, e qualquer mudança maior |

Os limiares 0,35 e 0,70 são os do próprio detector (`DUVIDA` e `CERTEZA`): o
porteiro não tem números seus. Sem detector instalado, ou com o detector
falhando numa imagem, a pergunta é feita — o porteiro não decide o que não
consegue ver. Modo que o agente não conhece (um que a nuvem ganhe depois)
volta a "em toda olhada".

### O que ficou de fora, e por quê

- **Presença e contagem não têm porteiro.** Já são julgadas na loja em toda
  olhada, e "não há ninguém" ali é o veredito, não um motivo para não olhar. A
  API recusa (422), a tela não mostra a escolha e o agente ignora se descer.
- **"Quando algo se mexe" é só de critério de ação.** Em critério de estado,
  a cena parada é justamente o que se quer julgar.
- **O movimento compara com a olhada ANTERIOR**, não com uma referência
  fixa: mede o que mudou de uma olhada para a outra. Mudança lenta, abaixo do
  limiar a cada passo, não dispara — aceito, porque ação é gente se mexendo.
- **O porteiro vem antes do borrão de rosto e da memória de cena repetida.**
  A imagem ainda não saiu de lugar nenhum, o detector conta melhor no recorte
  inteiro, e a olhada segurada não pode fazer a seguinte sair como "repetida".

### "Nada a conferir" é um desfecho, não um resultado

A olhada segurada é o oitavo desfecho de uma olhada (`sem_condicao`), ao lado
de sem quadro, sem cena, em silêncio, repetida, já julgada, sem juiz e
enfileirada. A soma dos oito continua sendo as capturas. Não é análise: não
entra em "conforme", nem em "não deu para avaliar", nem no custo. Na tela de
Análises é uma linha à parte, com a quantidade por critério — sem ela um
critério com poucas análises pareceria um critério que ninguém confere.

Tela de sem sinal continua sendo "sem cena" (defeito de câmera): o porteiro
só é consultado depois dessa porta.

### "Avisar só se continuar"

`confirmar_em` é em quantas olhadas SEGUIDAS o critério tem de ficar fora
para avisar (1 = na primeira, como era).

- Conta como "continua" um novo veredito fora do critério **e** a cena que não
  mudou desde o último. Sem a segunda parte, o critério nunca avisaria
  justamente do que continua: a bancada suja parada é a mesma imagem, e
  imagem repetida não é julgada de novo.
- Um conforme zera a espera. "Não deu para avaliar" e fora do critério com
  confiança abaixo do mínimo não confirmam nem desmentem.
- Em critério "com pessoa na área", ficar sem ninguém zera a espera: quem
  estava fora do critério saiu. Em "com a área livre", gente passando na
  frente não zera: a sujeira não saiu dali.
- O aviso confirmado pela cena parada sai com o julgamento que estava
  esperando (a imagem e o motivo dele), e o silêncio conta a partir da olhada
  que confirmou.
- A espera vive na memória do agente. Reiniciar o agente ou mudar a
  configuração da loja recomeça a contagem: o aviso atrasa algumas olhadas,
  não sai errado.

### A faixa de horas não pediu coluna

`regra.janelas` existe desde a migration 001 e o agente sempre a respeitou;
faltava a tela. A gaveta edita uma faixa só, igual em todos os dias. O que foi
gravado com mais detalhe pela API (dias diferentes, mais de uma faixa) aparece
resumido, e é mantido enquanto ninguém mexer na caixa. A API passou a conferir
o formato (o mesmo do horário da loja): antes bastava ser uma lista.

### O banco local de teste e a subida automática

Efeito colateral descoberto neste trabalho: subir a API contra o banco local
de desenvolvimento (montado à mão, sem a tabela de controle e sem pgvector)
agora cria a tabela de controle vazia, a 001 falha e a guarda fecha a porta.
Não é defeito — é a guarda fazendo o que deve num banco que ela não conhece.
Para esse banco, a API sobe com `MIGRAR_NA_SUBIDA=nao`.

---

## 08/10/2026 · A área é o desenho: marcação por pontos, recorte exato

Pedido do dono, usando a tela de área do canal 15 (imagem de olho de peixe):
"a criação das áreas marcadas teria que ser mais flexível, para uma área não
invadir outra (…) a marcação tem que ser flexível para ser mais exata e
facilitar o critério ser mais eficiente". E a pergunta: "o critério se aplica
somente a essa área? o frame é cortado e analisado somente o corte?"

### O que era verdade até aqui

Sim, o critério vale só na área e só o recorte é analisado. Mas com duas
folgas, e era por elas que uma área invadia a outra:

1. a tela só desenhava **retângulo** — numa imagem torta, o retângulo pega o
   que não é da área;
2. o agente recortava o retângulo com **5% de folga para cada lado**
   (`Zona.bbox`, margem padrão) — a borda da área vizinha entrava junto.

O banco, a API e o agente já guardavam a área como polígono (lista de pontos
em fração do quadro). Faltava a tela desenhar, e o agente respeitar.

### O que passou a valer

**A área é o desenho de quem configurou a loja.** Nada fora dele é analisado.

- **Tela:** o contorno é feito de pontos. Arrastar um ponto ajusta; o ponto
  menor, no meio de cada lado, cria um ponto novo; arrastar sobre a imagem
  continua redesenhando como retângulo (o começo mais rápido). Há desfazer,
  teclado (setas movem, Delete tira, Enter cria) e os números de cada ponto.
  Até 24 pontos pela tela (a API aceita 64).
- **Agente:** o recorte é o retângulo que envolve o desenho, **sem folga**, e
  o que fica fora do polígono é trocado por cinza liso antes de qualquer
  coisa. Daí em diante ninguém vê o que ficou de fora: nem o porteiro, nem a
  memória de cena repetida (movimento na área ao lado deixou de ser "cena
  nova" desta), nem o detector, nem a nuvem, nem o disco.
- **Área retangular** (todas as que existiam): não há o que apagar; muda só a
  folga de 5%, que sai.

### Escolhas, e por quê

- **Cinza liso (114), e não preto.** Preto é a cara da tela de "sem sinal" do
  gravador, e uma área estreita com 90% de preto em volta seria lida como
  câmera sem sinal por quem medisse o recorte depois. Branco é a de luz
  estourada. O cinza é o do enchimento de quadro dos detectores.
- **"Tem cena?" é medido só dentro do desenho.** Medindo o retângulo inteiro,
  a cena em volta faria parecer que há imagem numa área cuja parte da câmera
  está tampada.
- **O juiz da nuvem é avisado.** Quando algo foi apagado, o pedido leva uma
  linha: o cinza está fora da área, foi posto de propósito e não é motivo
  para "não avaliável". Vai no pedido, e não nas instruções, porque as
  instruções são o que fica em cache — mexer nelas invalida o cache de todas
  as lojas.
- **Contorno que se cruza e desenho sem tamanho são recusados** — na tela
  (enquanto se desenha, com o motivo) e na API (422). Um laço não diz o que
  é dentro e o que é fora. A menor área aceita é um quadradinho de 1% de
  lado.
- **Sobreposição é dita, não proibida.** Área dentro de área existe de
  propósito (o salão inteiro e, dentro dele, o balcão). A tela avisa quando
  parte da área também está dentro de outra **que tem critério**: ali os
  critérios da outra enxergam a mesma coisa.
- **As ferramentas de bancada não mudaram** (`farol-agent analisar`, o
  sandbox): seguem com a margem explícita delas.

### O que falta medir

O efeito de apagar o entorno sobre o julgamento da nuvem não foi medido com
imagem de loja — só com imagem sintética nos testes. A primeira área
desenhada por pontos em produção é a medida: comparar "não deu para avaliar"
do critério antes e depois.

### Depende do agente novo

Enquanto a loja estiver com o agente anterior, ele segue recortando o
retângulo em volta do desenho, com a folga. O desenho por pontos só passa a
valer por inteiro com o agente desta versão instalado.

---

## 08/10/2026 · A foto padrão: a loja compara antes de perguntar

Pedido do dono (07/10): "uma foto padrão do ambiente limpo e organizado para
padrão de comparação" e "melhorar a análise local e depender da nuvem em
último caso". É a fase 2 do A16 (o inventário de equipamentos fica para a
parte seguinte da mesma fase).

### O que é

A **foto padrão** é o quadro do canal com o ambiente como deve ficar. Vale
para o canal inteiro: cada critério compara o recorte da **sua área**. Um
canal guarda até quatro (dia, noite, loja fechada…).

- **Guardar é copiar o quadro que o canal já tem.** Não há envio de imagem
  pelo console: a foto padrão é o quadro de preview — o que o agente capturou,
  com rosto borrado — no instante em que alguém olhou e disse "é assim que
  deve ficar". A cópia é feita dentro do banco, com o resumo (`sha256`)
  calculado lá. A gaveta diz **de quando é** o quadro que vai ser guardado.
- **O detector conta as pessoas do quadro** na hora da captura, e a gaveta
  avisa antes de guardar. A foto guardada com gente carrega isso na lista.
- **Nenhuma foto é "a que vale".** A loja compara com **a que mais se parecer**
  com a cena — não com a mais nova, nem com uma média (a média de cenas
  legítimas não é cena nenhuma). O protótipo dizia "em uso agora" na primeira
  da lista; isso saiu, e clicar numa foto passou a escolher qual aparece no
  quadro.
- **A loja mantém uma cópia.** A configuração leva `id`, nome e `sha256` de
  cada foto; o agente baixa as que não tem, confere o resumo antes de aceitar
  e apaga do disco as que saíram da configuração (com os recortes delas).

### Tabela própria, e não a base de conhecimento

Desde a migration 001 existe `base_conhecimento` (tipo `padrao`) com
`base_frame`. Não foi usada: ela é **por loja**, guarda vetor de semelhança
(pede `pgvector`) e foi pensada para o envio de imagens pelo agente. A foto
padrão é **por canal**, é uma imagem inteira que o console precisa mostrar, e
nasce de um quadro que já está no banco. `foto_padrao` (migration 024) tem só
isso. O juiz antigo de comparação com a base (`JuizComparacao`) continua no
código para quem montar o seletor sem o juiz da foto.

### A medida: o pior bloco

As duas imagens (o recorte de agora e o mesmo recorte da foto) são reduzidas
a 384 pontos, suavizadas e comparadas por semelhança estrutural (SSIM). O
mapa é cortado em blocos de uns 21 pontos e a medida é o **pior bloco**, não
a média: um objeto que ocupa 1% da área muda a média em 1% — menos do que a
mesma cena oscila sozinha.

Medido na loja em 08/10/2026 (três canais, quadros de verdade, só números):

| | semelhança |
|---|---|
| a mesma cena, 11 capturas em 2 min (dois canais) | 0,96 a 0,99 |
| a mesma cena, luz de −20% a +20% | 0,89 a 0,99 |
| um pedaço de 0,2% da área fora do lugar | até 0,83 |
| um pedaço de 0,5% da área fora do lugar | até 0,66 |
| os recortes da operação, com gente | abaixo de 0,10 |

O limiar é **0,90**. Num terceiro canal havia algo que muda sozinho (0,84 no
pior caso): ali a loja pergunta mais vezes — custa chamada, não erra.

Três peças do comparador foram medidas uma a uma antes de ficar (com cena
sintética, e cada uma tem o seu teste):

- **suavizar antes de medir** — a olhada que vem do fluxo menor do gravador
  (352 × 240) dá 0,98 contra a foto do fluxo principal; sem suavizar, 0,89.
  Ruído de sensor forte: 0,99 contra 0,87;
- **só o que é da área conta no bloco da borda** — uma mudança do lado de
  fora, no mesmo bloco: 1,00; tirando a média do bloco inteiro, 0,64;
- **a beirada do desenho fica de fora** (2 pontos) — a janela da medida
  enxerga além da borda: mudança a 1 ponto dela, por fora, dá 0,95; sem
  tirar a beirada, 0,85.

**O que a comparação NÃO vê:** mudança menor que uns 0,2% da área — farelo,
respingo, um pano pequeno. Para isso serve o critério de estado, com a foto
padrão indo junto para a nuvem.

### O relógio do gravador

O gravador escreve data e hora em cima da imagem, e o relógio da foto nunca é
o de agora: sem tratar, toda área com o relógio dentro daria "diferente" para
sempre. Quem diz onde ele fica é o próprio gravador (Intelbras/Dahua:
`configManager.cgi?action=getConfig&name=VideoWidget`, retângulo em 0–8192,
só quando `EncodeBlend` — gravado NA imagem). Os blocos que tocam o retângulo
ficam de fora da conta. O gravador é perguntado uma vez, e só quando algum
critério compara com foto. Gravador que não responde (ou de outra família)
fica sem retângulo: área com o relógio dentro vai dar "diferente" — pergunta
a mais, não veredito errado.

### Diferente não é irregular

A loja só decide sozinha **uma** coisa: *igual à foto padrão → conforme*,
sem custo. Cena diferente pode ser sujeira — ou uma caixa de insumo nova, ou
a luz da tarde. Então:

- **diferente** → vai a quem sabe julgar (a nuvem), com o recorte da foto
  padrão ao lado e o aviso de que aquela é a MESMA área em ordem;
- **loja em modo `local`** (nada sai) → "não deu para avaliar", dizendo que
  a cena está diferente da foto e não há a quem perguntar;
- **canal sem foto padrão** → o critério de comparação não é conferido ali, e
  aparece como "falta a foto padrão" na lista de critérios e, no Painel,
  como critério que "não tem quem julgue", com o motivo;
- a semelhança medida vai no veredito (`medida`), nos dois casos — é dela que
  sai, depois, "este critério nunca dá igual à foto": foto velha, ou área com
  algo que muda sozinho.

### 🔴 Muda uma promessa: comparação pode sair da loja

Até aqui valia "presença, contagem e comparação **não saem da loja**". Para
comparação, deixou de valer por inteiro: o que **não** é igual à foto padrão
vai à nuvem. É o texto do protótipo aprovado pelo dono em 08/10 — "só vai à
nuvem, com a foto padrão ao lado, quando a loja ficar em dúvida" —, e é o
que torna o critério útil: sem isso, "diferente" não teria veredito nunca.

Continua valendo, sem exceção: **presença e contagem não saem da loja**, e
**loja em modo `local` não manda nada**, nem comparação.

O que sai é o recorte da área com o entorno apagado, como nos outros
critérios de nuvem. A foto padrão que vai ao lado vem do quadro de preview,
que já tem rosto borrado.

### Critério de estado com a foto junto

Em "Quando vale a pena conferir", o critério de **estado** ganhou a caixa
"Mandar a foto padrão do canal junto, para a nuvem comparar com ela"
(`regra.com_padrao`). A pergunta deixa de ser "está limpo?" para ser "o que
mudou em relação a isto?". A loja escolhe a foto mais parecida e manda o
recorte dela; canal sem foto pergunta sem ela. Vai sempre à nuvem (passado o
porteiro): aqui a foto serve ao julgamento, não a evitá-lo.

### O que falta medir

- **Quantas vezes "diferente" acontece em operação.** Com gente na área a
  cena nunca é igual à foto (abaixo de 0,10): critério de comparação pede
  **"com a área livre"** em "Quando vale a pena conferir", senão toda olhada
  com alguém na frente vira pergunta à nuvem. Não foi posto como obrigatório;
  a primeira semana com um critério de comparação ligado diz se deve ser.
- **O efeito da foto ao lado sobre o veredito da nuvem** não foi medido com
  imagem de loja. É comparar "não deu para avaliar" e o acerto de um critério
  de estado antes e depois de marcar a caixa.
- **Câmera que mudou de posição** faz toda foto antiga dar "diferente". Hoje
  isso aparece como custo de nuvem naquele critério; a sugestão "esta foto
  nunca dá igual" é do motor de padrões (fase 5).

### Depende do agente novo

Agente anterior não conhece foto padrão: o critério de comparação continua
sem quem o julgue e a caixa "mandar a foto junto" não tem efeito, até o
agente desta versão ser instalado na loja.

---

## 08/10/2026 · O inventário: os equipamentos da loja

Pedido do dono (madrugada de 08/10): "os equipamentos por setores, onde
poderíamos ter até 4 fotos do equipamento devidamente limpo, para identificar
seu lugar no setor e padrão; uma única análise dele completa e sua descrição
ficava guardada na base para ajudar em análises". É a segunda parte da fase 2
do A16. Esta entrega é o cadastro; a análise única das fotos é a seguinte.

### Não é o catálogo `equipamento`

A tabela `equipamento` (migration 002) é o **catálogo da distribuição** — o
que o Farol indica comprar. É do Farol, não da loja, e nenhuma rota do
console o devolve. O inventário é o contrário: a chapa, a bancada e o caixa
DESTA loja. Por isso tabelas próprias (`inventario_item`, `inventario_foto`,
migration 025), sem ligação nenhuma com o catálogo, e tudo filtrado pela
conta de quem pede.

### Duas origens de foto

- **O quadro de um canal.** Copia o quadro que o canal tem (o de preview, com
  rosto borrado), dentro do banco, e guarda junto o **desenho da área naquele
  instante**. A imagem guardada é o quadro **inteiro**: a tela mostra só o
  retângulo em volta do desenho (uma janela sobre a imagem, sem cortar
  arquivo nenhum), e a API não precisa de biblioteca de imagem. Se a área for
  redesenhada depois, a foto continua mostrando o que foi fotografado.
- **A foto enviada.** O navegador reduz antes de subir (1600 pontos no lado
  maior, JPEG) — foto de celular tem de 4 a 12 MB. A API só confere que é um
  JPEG inteiro, lê a largura e a altura do próprio arquivo e recusa acima de
  1,5 MB. É servida de volta com `nosniff`.

Até quatro fotos por equipamento; o limite é conferido com a linha do
equipamento travada (seis envios ao mesmo tempo dão quatro fotos).

### "Onde aparece" não é um campo

É o canal e a área das fotos tiradas do quadro. **A foto é a prova de que
ele aparece ali.** No protótipo aprovado não havia como dizer de que canal
era o quadro: "Usar o quadro de um canal" passou a perguntar. Quando a planta
existir (fase 4), ela poderá dizer o mesmo de outro jeito.

### "Compara na loja" é a regra do agente

No protótipo, a etiqueta dizia "tem a foto tirada do quadro do canal e o
lugar marcado". Mas quem compara na loja é o juiz da foto padrão, e ele
compara com a **foto padrão do canal** — não com a foto do equipamento. A
etiqueta passou a dizer a verdade do motor: aparece no equipamento que está
num canal **com foto padrão**. As fotos do inventário servem para dizer onde
ele aparece, para descrever e para identificar; a nota no pé da tela diz isso.

Manter dois mecanismos de comparação (um pela foto padrão do canal, outro
pela foto do equipamento) daria duas respostas diferentes para a mesma área.
Ficou um.

### As fotos são guardadas na hora

No protótipo as fotos ficavam na gaveta até o "Salvar". Na tela, cada foto é
um envio (ou uma cópia feita no banco) no instante em que é posta: segurar
imagens no navegador até o fim é perder tudo num fechar de gaveta, e salvar
quatro imagens de uma vez pede tratar falha no meio. Consequência: num
equipamento novo, a **primeira foto já cria o cadastro** — e pede o nome
antes. "Salvar equipamento" grava o nome, o setor, o tipo e a descrição.

### A descrição vai com a pergunta à nuvem

É o "ajudar em análises" do pedido. O agente recebe, **por área**, os
equipamentos descritos que aparecem nela, e a pergunta feita a um modelo
sobre aquela área leva um bloco a mais:

    EQUIPAMENTOS NESTA ÁREA — como cada um é e como fica quando está limpo e
    no lugar (descrição guardada pela loja; serve para reconhecer o que
    aparece, não é o critério):
    - Chapa: Chapa elétrica de inox, com duas tampas…

- **Por área, não por critério.** O mesmo critério vale em várias áreas, e
  cada uma tem os seus equipamentos: quem diz a área é a olhada, não o
  cadastro do critério.
- **Com limite**: no máximo 4 equipamentos e 500 caracteres de cada um. É
  texto pago a cada análise.
- **No pedido, não nas instruções fixas**: as instruções são o que fica em
  cache; mexer nelas invalidaria o cache de todas as lojas.
- **O detector não leva**: presença e contagem não leem texto.
- **A loja compara com FOTO, não com texto.** A descrição não entra na
  comparação local; serve à nuvem e a quem lê.

### O que sobe a versão da configuração

Só o que o agente consome: o nome, o tipo e a descrição de equipamento
**descrito**, e as fotos tiradas de canal dele (que dizem onde aparece).
Cadastrar um equipamento ainda sem descrição, mexer nos pontos a conferir ou
enviar foto do celular não faz o agente remontar a auditoria — remontar zera
a contagem de "avisar só se continuar".

### Excluir apaga de verdade

O equipamento e as fotos somem do banco: nada do histórico aponta para eles,
e as fotos são imagens de dentro da loja. A pergunta diz quantas fotos vão e
que a descrição deixa de ir à nuvem. Os critérios criados a partir dele são
critérios como os outros: continuam.

### O que falta, e o que não foi medido

- **A análise única das fotos** entrou em seguida (seção abaixo).
- **O efeito da descrição sobre o veredito da nuvem** não foi medido com
  imagem de loja.
- **Depende do agente novo**: o agente anterior ignora os equipamentos da
  configuração e pergunta como sempre perguntou.

---

## 08/10/2026 · A análise única das fotos do equipamento

"Uma única análise dele completa e sua descrição ficava guardada na base"
(pedido do dono). É o botão "Analisar as fotos e descrever" do inventário.

### Quem pergunta ao modelo é o computador da loja

A chave do modelo mora no computador da loja, e a nuvem do Farol não tem
nenhuma. Em vez de dar uma chave à API (segredo novo em produção, e imagem de
loja passando por mais um lugar), a análise virou **um comando para o
agente**, como "capturar quadro": o console pede, o agente recebe na batida,
baixa as fotos do equipamento (conferindo o resumo de cada uma), pergunta ao
modelo uma vez e devolve a descrição e a lista do que vale conferir.

Consequências aceitas: precisa do agente ligado (a tela diz), e a batida do
agente fica parada enquanto ele espera o modelo — até um minuto. O limite
para o agente ser dado como fora do ar é de cinco minutos.

### A resposta é uma sugestão

O que o agente devolve fica guardado **no comando**, e não mexe no cadastro.
A tela põe a sugestão nos campos; a pessoa lê, corrige e salva. Só aí ela
vira a descrição do equipamento — e passa a ir junto com as perguntas à
nuvem.

- Gravar direto apagaria, sem pergunta, o que alguém escreveu à mão.
- Descrição de modelo que ninguém leu iria junto com toda análise daquela
  área dali em diante: um erro na descrição viraria erro em todo veredito.
- Fechar a gaveta sem salvar não perde a sugestão (ela volta ao reabrir), e
  "Manter a que estava" a deixa de lado.
- Salvar a descrição é decidir qual ela é: as sugestões que esperavam ficam
  resolvidas. Se o texto salvo veio de uma, o cadastro guarda quando e por
  qual modelo foi escrita.

### O que vai ao modelo, e o que volta

- Até quatro fotos, reduzidas a 1000 pontos. A foto de canal vai recortada
  pela área, com o entorno apagado e o aviso do cinza — a mesma conta de toda
  análise. A foto enviada pelo console passa pelo borrão de rosto antes (a do
  canal já passou na captura); é mitigação, não garantia.
- O modelo mais capaz, porque é uma vez só. Quatro fotos e uma resposta curta
  custam centavos; o custo vai na resposta e aparece na tela.
- A resposta é pedida por ferramenta (campos fixos) e **cortada**, não
  recusada, quando passa do tamanho: a pessoa vai ler de qualquer jeito, e
  jogar fora uma análise já paga por uma frase comprida seria desperdício.
  Sem descrição nenhuma, aí é erro, com a frase do que faltou nas fotos.
- O erro do provedor não vai para a tela: vai o tipo dele (chave, limite,
  rede). O texto completo fica no log do computador da loja.

### Loja em modo local

Nenhuma imagem sai dela, nem para descrever equipamento. A API recusa o
pedido na hora e o agente recusa de novo se o comando chegar: são duas
portas para a mesma promessa.

### O que não foi medido

A qualidade da descrição com fotos de loja de verdade. Os testes usam um
modelo de mentira; a primeira análise feita na loja é a medida, e é por isso
que ela passa por uma pessoa antes de valer.


## 08/10/2026 · O vigia: olhar mais vezes o que é julgado na loja

Fase 3 do A16. "Melhorar a programação de análise, já que está gastando
pouco do PC servidor" (pedido do dono).

### O que sobrava, e o que não sobrava

Medido na loja em 08/10/2026, com o agente em operação:

| | medida |
|---|---|
| processador, com a loja aberta | 3% |
| o detector, por quadro (fluxo menor ou principal) | 85 a 95 ms |
| uma olhada pelo fluxo principal (abrir, pegar a rajada, fechar) | 1,7 a 1,8 s por canal |
| fluxo menor (704 × 480) | já fica aberto o tempo todo, um por canal com critério |

Sobra processador. O que **não** sobra é fluxo principal: ele é aberto a
cada olhada, e a placa de rede do computador da loja está limitada (o cabo
emendado). "Olhar tudo a cada 10 segundos", como o roteiro dizia, manteria
o fluxo principal de quatro canais aberto quase o tempo todo.

Daí o desenho: gastar o que sobra (processador e fluxo menor) para decidir
**quando** vale abrir o que não sobra.

### O vigia não julga

A cada 10 segundos ele conta, no último quadro do fluxo menor, o que cada
critério de presença e de contagem procura, no recorte da área. Se a
contagem é diferente da que ele viu **no instante da última olhada** daquele
canal, pede uma olhada agora. Quem julga, conta no resumo e avisa é essa
olhada — a mesma de sempre, pelo fluxo principal.

Por isso o erro dele custa pouco nos dois sentidos: viu mudança que não
houve, uma olhada a mais; não viu a mudança, fica como era antes (a rotina
pega em até 30 segundos).

E por isso não foi preciso medir o que ficou sem medir: **se o detector vê
no fluxo menor o mesmo que no principal** com gente na cena (a loja estava
fechada). O vigia nunca compara um fluxo com o outro — compara o menor com
ele mesmo.

### Os limites

- **Só presença e contagem.** A olhada extra passa um filtro no motor
  (`somente`): o critério de estado, de ação ou de comparação daquele canal
  não é olhado, não conta olhada e não vai à nuvem.
- **Uma olhada extra por canal a cada 20 segundos, no máximo.** Pessoa na
  borda da área faz a contagem piscar.
- **Quadro do fluxo menor com mais de 5 segundos não vale** (fluxo travado),
  e fonte sem fluxo menor não é vigiada. O vigia nunca abre fluxo: a função
  que ele usa (`quadro_do_fluxo_menor`) devolve nada em vez de cair no
  principal.
- **Sem olhada antes, não há com o que comparar**: configuração nova, ou
  olhada em que o fluxo menor não tinha quadro, zeram a referência.
- **O freio**: processador acima de 60% por quatro medidas seguidas para o
  vigia; abaixo de 45% pelo mesmo tempo, volta. Duas marcas para não ligar
  e desligar a cada medida. Sem medida do processador ele segue — "não
  medi" não é zero nem é cem. A rotina não tem freio.

### Em cena movimentada ele vira "a cada 20 segundos"

Numa cozinha em serviço a contagem muda o tempo todo. Ali o vigia pede
olhada sempre que pode: o canal passa a ser olhado a cada 20 segundos (as
extras) mais a cada 30 (a rotina) — umas cinco olhadas por minuto em vez de
duas. É o teto, e é o que o limite de 20 segundos existe para garantir.

### O que a olhada extra conta, e o que não conta

A olhada extra cai quando algo mudou, e não num instante qualquer. Isso
muda o que se pode fazer com ela:

| | rotina | extra |
|---|---|---|
| análises, conformes, fora do critério | conta | conta (é análise feita) |
| aviso | sim | sim — é para isso que ela existe |
| maior valor da hora | sim | sim (o pico que a rotina não veria) |
| **média** da medida da hora | sim | **não** |
| "avisar só se continuar": mais uma olhada fora | sim | **não** |
| "avisar só se continuar": viu em ordem, zera | sim | sim |

- **A média.** Conta de exemplo: balcão com um atendente, e cliente que
  fica 20 segundos a cada 2 minutos. A ocupação média verdadeira é 1,17. A
  olhada extra cai logo depois de cada chegada e de cada saída; somada, a
  média iria a 1,28. A média da hora é o número que a fase 5 chama de
  "ocupação típica": fica só com a amostra regular.
- **"Avisar só se continuar".** "Por 2 olhadas seguidas" queria dizer meio
  minuto fora do critério. Com a extra contando, viraria dez segundos — e o
  campo existe justamente para não avisar do que durou um instante. A extra
  não começa nem adianta a espera. Se ela viu a área em ordem, a espera
  recomeça: aí a condição não continuou mesmo.
- **A taxa.** "Fora do critério em X% das análises" passa a incluir as
  extras, e por isso **não é fração de tempo**. Para quem precisar da conta
  só da rotina, o resumo da hora ganhou `extras` e `extras_fora` (migration
  027): `rotina = julgadas − extras`, `rotina fora = fora − extras_fora`. A
  tela de Análises não mudou: ela conta análises, e a extra é uma.

### O maior valor só sobe junto de uma média

A API recusa "pico sem medida" (`comMedida` zero com `maxMedida`), e está
certa. Só que a hora em que a única medida veio de uma olhada extra tem
exatamente isso na fila da loja. Linha recusada não sobe de novo — a hora
ficaria sem resumo. Então o corpo que sobe leva `maxMedida` nulo enquanto
não houver medida de rotina na hora; a primeira olhada de rotina soma, a
linha sobe de novo, e o pico vai junto. Se a hora acabar sem nenhuma
olhada de rotina com medida (os últimos segundos antes de fechar), aquele
pico não sobe.

### O que não foi medido

- O detector no fluxo menor contra o principal, com gente (dito acima).
- Quantas olhadas extras o vigia faz numa noite de movimento, e quantas
  deram em aviso. A primeira noite com o agente novo é a medida: o resumo
  da hora tem `extras` para isso.
- O efeito no processador com a loja cheia. A conta diz pouco (quatro
  áreas × 90 ms a cada 10 s é menos de 4% de um núcleo), e o freio existe
  para o caso de a conta estar errada.


## 08/10/2026 · A planta da loja

Fase 4 do A16. "Um desenho do ambiente onde os canais estão e o
posicionamento nesse ambiente, como se fosse algo 3D" (pedido do dono).
Tela: Canais → Planta.

### Retângulos em metros, e não uma imagem

A planta são três listas: ambientes, móveis e câmeras, cada coisa com
posição e tamanho em metros. Uma foto da planta baixa seria mais rápida de
pôr na tela e não serviria para nada além de olhar: é por ser feita de
retângulos que dá para calcular o que cada câmera alcança, o que nenhuma
vê, e escrever onde cada câmera está.

A "perspectiva" é a mesma planta girada 45° e deitada: não há modelo 3D,
biblioteca nem arquivo de imagem. O que é alto (parede do fundo, móvel,
poste da câmera) é desenhado em pé, cortado em pedaços de até um metro e
pintado do mais distante para o mais próximo.

### Um documento por loja, salvo inteiro

A tabela `planta` tem uma linha por loja, com o documento em JSON. Não há
uma tabela por ambiente, móvel e câmera:

- a tela edita tudo e salva de uma vez ("Concluir edição"). Salvar por
  partes deixaria a planta pela metade quando a rede caísse no meio;
- "Descartar mudanças" é só não salvar.

O preço de não ter chave estrangeira é pago em dois lugares, de propósito:
na **gravação**, a API confere que o setor de cada ambiente, o equipamento
de cada móvel e o canal de cada câmera são desta loja; na **leitura**, tira
a câmera cujo canal foi excluído e solta o móvel do equipamento que saiu do
inventário e o ambiente do setor que deixou de existir. A planta guardada
não é reescrita por isso — quem a reescreve é o próximo salvamento.

### Quem salva diz a versão que leu

Dois gerentes editando a mesma planta: o segundo a salvar apagaria o
desenho do primeiro sem saber. Cada salvamento manda a versão que tinha na
mão; a gravação é uma instrução só, que só grava se a versão ainda for
aquela. Senão, 409, nada é gravado, a edição continua aberta e a tela diz o
que houve. "Descartar mudanças" recarrega o que está guardado.

### O que a câmera vê

O campo de visão é um setor de círculo (posição, direção, abertura da
lente e alcance), **cortado nas paredes do ambiente em que a câmera está**.
"Ver" um móvel é o centro dele estar nesse desenho.

É estimativa, e a tela diz: móvel alto na frente da câmera não faz sombra,
e a altura da câmera não entra na conta do chão. Serve para achar o canto
que ninguém olha, não para laudo.

### A frase do lugar

De cada câmera sai uma frase, escrita pela API:

    Câmera no ambiente Atendimento, a 2,7 m do chão. No campo de visão:
    mesa (3), balcão de atendimento e caixa.

- É a MESMA frase na tela e no agente: a tela mostra o que o servidor
  escreveu, e é isso que desce na configuração (`pontos[].lugar`).
- O nome de cada móvel é o do **inventário** quando ele está ligado a um
  equipamento; senão, o que foi escrito na planta.
- Do mais perto ao mais longe, no máximo oito nomes ("e mais N"). É texto
  pago a cada análise.
- **"mesa (3)", e não "3 mesas"**: o plural de um nome escrito por alguém
  não se adivinha ("balcão", "freezer").
- **Sem móvel na frente, a frase não diz "não há equipamento"**: a imagem
  pode mostrar um que ninguém desenhou, e uma frase assim faria o modelo
  duvidar do que vê. (O protótipo aprovado dizia; a tela e o protótipo
  foram mudados juntos.)
- No pedido ao modelo ela vai num bloco próprio, que diz de onde veio e que
  a planta pode estar incompleta: "na dúvida, vale o que a imagem mostra".
  Só nos tipos que leem texto (estado, ação, comparação); o detector não
  leva. Vai no pedido, e não nas instruções fixas (que ficam em cache).

### Duas cópias da mesma conta

O cone e "o que a câmera vê" existem na API (que escreve a frase) e no
console (que desenha o cone enquanto a câmera é arrastada). Os dois
programas não compartilham código. O que mantém as cópias iguais é um teste
só: `api/testes/planta.test.ts` importa o arquivo do console
(`web/lib/planta.ts`, que por isso não importa nada) e exige a mesma
resposta das duas, no exemplo de `contratos/planta.json` e em quatrocentas
câmeras sorteadas.

### O que sobe a versão da configuração

O agente consome a frase. Então sobe a versão: salvar a planta com
documento diferente; e mudar o nome (ou excluir) um equipamento do
inventário **que está na planta**. Salvar a mesma planta de novo, ou
renomear um equipamento que não está em frase nenhuma, não acorda o agente.

### "Situação agora"

A câmera é pintada com o que o console já sabe: canal pausado, sinal de
"sem imagem", critérios ligados (e se valem com a loja aberta ou fechada) e
ocorrência nos últimos dez minutos. Duas regras para não afirmar à toa:

- com o computador da loja sem bater, nenhuma câmera aparece "conferindo";
- perfil que não vê resultados não recebe sinais nem ocorrências: para ele
  a planta não acusa "sem imagem" nem "aviso".

### O que a tela tem e o protótipo aprovado não tinha

Levado ao protótipo no mesmo trabalho:

1. **Ligar o móvel a um equipamento do inventário** (um campo na edição).
   O protótipo tinha móveis já ligados no exemplo, e nenhum jeito de ligar.
2. **"Tirar da planta" para a câmera.** Sem isso, câmera posta por engano
   não saía mais.
3. **Canal fora da planta, na lista de câmeras**: "pôr na planta" na
   edição (tocar o põe no meio do primeiro ambiente), "fora da planta" fora
   dela. No exemplo do protótipo todos os canais já estavam postos.
4. A frase do lugar, como descrito acima.

Só na tela (não muda o desenho): as setas do teclado movem o que está
escolhido; "computador da loja sem sinal" e "nenhum critério ligado" como
motivos de "sem conferência agora"; o nome do móvel aparece sempre que
cabe; o nome do ambiente desvia do marcador das câmeras.

### O que ficou de fora

- **Portas.** O exemplo do protótipo desenha duas, mas não há ferramenta
  para criá-las, e inventar uma seria tela sem protótipo. A planta de
  verdade não tem porta, e a frase não fala delas.
- **Anomalias e resultados no chão.** Vêm com a fase 5.

### O que não foi medido

O efeito da frase no veredito da nuvem. Ela custa uns cem caracteres por
pergunta nos canais que estão na planta; se ajuda, só comparando antes e
depois numa loja com a planta desenhada.
## 08/10/2026 · O especialista: o padrão da loja

Fase 5 do A16. "Com uma semana de uso, verificar as análises e ir criando um
padrão de funcionamento; liberar descrição de funcionamento por setor; e o
que saiu do padrão, para análise e correção do responsável pela loja"
(pedido do dono). Tela: Análises → Padrões.

### Só número, e nada guardado além da resposta

Tudo sai do que já é guardado por hora (`resumo_hora`): a medida de cada
olhada, o que ficou fora do critério e o que não deu para avaliar. Nenhuma
imagem entra, e nenhum modelo de linguagem: as frases são montadas dos
números.

O padrão não é guardado: é refeito a cada pedido, dos 28 dias antes de
hoje — alguns milhares de linhas já somadas por hora. Guardar o padrão
pronto pediria uma rotina para refazê-lo e um jeito de saber que
envelheceu; refazer na hora não envelhece. A única tabela nova é a da
resposta do responsável (`padrao_revisao`, migration 029).

O custo, medido no banco de teste (9 critérios em áreas, 24 dias, 1.152
linhas de hora): 17 ms de busca e 81 ms de conta. Cresce com critérios ×
horas; o console guarda a resposta por meio minuto. Se uma loja grande
pesar, o primeiro passo é montar as amostras de cada hora uma vez só — a
conta as refaz a cada comparação.

A conta mora num arquivo sem banco (`api/src/especialista.ts`); a rota só
busca o que ela precisa.

### O dia é o da operação

Loja que fecha à 1h não tem dois dias: a madrugada pertence à noite que
começou. O dia vira às 6h, no relógio da loja, e quem corta é o banco. Hoje
não entra no padrão. Com menos de 7 dias medidos não há padrão para
mostrar; com 21, ele é chamado de firme (três de cada dia da semana).

### A taxa é da rotina, e da parte que foi olhada

- A olhada extra do vigia (fase 3) cai quando algo mudou, e não num
  instante qualquer: "fora do critério em X% das olhadas" é feita só das
  olhadas de rotina, para a semana de antes do vigia e a de depois serem
  comparáveis.
- Depois de avisar, o critério de nuvem fica o período de silêncio sem
  olhar. A taxa é das olhadas que ele fez; a saída do padrão diz quando o
  silêncio tirou um quarto das olhadas da hora, ou mais.
- Hora com menos de 5 olhadas (ou 3 medidas) não tem valor: é acaso.

### O normal de uma hora

O normal é o **daquele dia da semana e daquela hora**, e é o que era
costume **antes** daquele dia. Com os dias de depois na conta, o passado
mudaria de cara: se o balcão passou a ter quatro pessoas aos sábados, os
sábados antigos, com duas, virariam "menos do que o normal".

A faixa do normal é a do **miolo** (mediana, e o que fica a até três
desvios medianos dela, com um piso): o dia que já tinha fugido do costume
não a alarga. Sem isso, a segunda vez que algo acontece esconderia a
primeira — e as duas sumiriam da lista antes de alguém rever.

Pede três dias iguais medidos (e dois que contem). Sem isso, vale "aquela
hora em qualquer dia", com cinco dias ou mais — mas só em loja nova, ou na
hora que já tem resposta. Em loja com o padrão firme, comparar a sexta com
"qualquer dia" apontaria toda sexta de três semanas atrás.

### O que é saída do padrão

A hora que passa da faixa do normal por mais do que uma folga **e** fica
longe do meio:

| | além da faixa | longe do meio |
|---|---|---|
| medida (pessoas na área) | 0,5 | 0,6 |
| taxas (% das olhadas) | 10 pontos | 15 pontos |

São valores de partida. Medida aponta nos dois sentidos; taxa, só para
cima (taxa menor que o normal é boa notícia). "Muito fora do normal":
metade ou o dobro, na medida; 40 pontos acima, na taxa. Medida e taxa do
mesmo critério na mesma hora viram uma saída só, a da medida.

A frase diz por que o critério não avisou, quando é o caso: "ele olha o
limite de 6, não o que é costume nessa hora".

### O que a resposta faz

- **Era esperado, acontece sempre**: aquela hora passa a fazer parte da
  faixa do normal, por mais longe que esteja. Foi ensinada.
- **Era esperado, foi só desta vez**, e **é problema**: a hora fica de
  fora da conta do padrão. Problema que se repete não pode virar o normal.
- Uma resposta por hora: há índice único, e a segunda pessoa a responder
  recebe "já foi revista por outra pessoa" (o erro fica na gaveta, com o
  que ela escreveu).
- Quem grava é a API, que refaz a conta e tira dela — nunca do pedido — o
  critério, a área, o dia e a hora.
- **O critério proposto** leva o costume como limite (com gente de menos, o
  meio do normal; com gente demais, o teto dele) e **nasce desligado**. Se
  a hora é do pico do setor e as outras horas do pico pedem o mesmo limite,
  ele vale para o pico inteiro ("pelo menos 2 no pico"); senão, só para
  aquela hora — um limite só não serve a horas diferentes. Não se propõe o
  que o critério já pede.

### O que anda junto

A mesma taxa em duas situações, comparadas **dentro da mesma hora do dia**:
"às 20h, nos dias com um no balcão" contra "às 20h, nos dias com dois".
Juntar todas as horas diria só que o pico é diferente da hora vazia. O
limiar é um número inteiro de objetos ("menos de 2" se entende, "menos de
1,7" não), e só se diz com amostra (oito horas de cada lado). Os dois casos
têm de ser dois casos de verdade: os dias "com menos" ficam pelo menos meio
objeto abaixo dos outros — com o costume em volta de 2,5, dividir os dias
em "menos de 3" e "3 ou mais" separaria 2,4 de 2,6, que é ruído. Relação entre
duas taxas que são zero não é relação; a medida e a taxa do mesmo critério
andam juntas por definição, e ficam de fora.

A segunda relação é a do "não deu para avaliar" com o movimento: quando a
taxa é a mesma no pico e fora dele, não é o movimento que atrapalha — é o
que a câmera mostra. A frase só manda olhar a sugestão de marcar a área
quando essa sugestão existe.

Da relação forte em que **menos gente** piora o critério nasce a sugestão
de criar "pelo menos N" — com a faixa de horas em que a relação foi
medida. Sem a faixa, o critério avisaria o dia todo: fora do pico, ter
menos gente é o normal.

### Tendência

Quatro semanas, e o rumo é o da reta ajustada (o primeiro contra o último
seria ruído: uma série que só oscila pareceria queda). Para dizer "sobe" ou
"cai" a reta tem de andar 6% do valor **e** um mínimo em valor (0,3 objeto;
3 pontos de taxa; 1 GB de disco): um ponto percentual a mais não é subida.
A taxa é um cartão por critério, juntando os canais do setor.

### Sugestões e descrição, curtas de propósito

- No máximo oito sugestões. "Nunca ficou fora do critério: vale manter?"
  está no plano aprovado, mas numa loja nova quase todo critério passa
  semanas sem ficar fora: valem só as duas de mais olhadas, por último.
- A descrição do setor leva o movimento, as duas maiores taxas fora do
  critério (por critério, juntando os canais) e os dois canais que menos
  conseguem avaliar. Uma frase por critério e canal virava um parágrafo
  sem fim com a touca em três canais e a bancada em dois.

### O que a tela tem e o protótipo aprovado não tinha

Levado ao protótipo no mesmo trabalho:

1. **As frases no formato do servidor.** O protótipo aprovado tinha frases
   escritas à mão; passou a mostrar o que a tela escreve: o título de cada
   saída do padrão (`“Alguém no balcão”: menos pessoas do que o normal`), o
   nome do critério proposto (`Pelo menos 2 em Balcão · Dentro do balcão no
   pico`), a descrição de cada setor, as relações, as tendências e as
   sugestões.
2. **"Nas 3 quartas anteriores"**, no lugar de "nos outros 3 dias iguais":
   o normal é o de antes daquela hora.
3. **O setor sem critério na faixa de setores** (Estoque), e o que cada
   lente diz para ele: "nenhum indicador deste setor tem números para uma
   semana típica", "ainda não há relação para mostrar", "aparece quando um
   critério de presença ou de contagem…", "nenhuma sugestão agora". E, em
   "Todas", "nenhuma saída do padrão neste período".
4. **A base**: "refeito cada vez que esta tela abre · o dia vira às 6h"
   (era "refeito toda madrugada, às 6h" — não há rotina de madrugada).
5. **"Até agora: N dias com análise"**, na loja que ainda não tem padrão.
6. **O seletor "O que olhar"** lista a taxa de cada canal (o critério em
   dois canais aparece duas vezes, com o canal no nome) e o "sem conseguir
   avaliar"; o de **"O que comparar"** leva o nome do critério e quebra a
   linha no celular, em vez de espremer.
7. **A foto padrão sugerida por canal**, com o canal no título.
8. **Por que o critério não avisou** ("ele só pede 1…"), e **quanto da hora
   ficou em silêncio**, na saída do padrão.
9. **"Nunca ficou fora do critério: vale manter?"** — estava no plano e
   não no protótipo.
10. **"Sem análise"** na grade, onde o protótipo dizia "fechada": a tela
    sabe que não houve análise, não que a loja estava fechada.
11. **"Por dia com análise"** no gasto, onde o protótipo dizia "por dia
    aberto".

Saiu do protótipo: "quanto isso economiza sai do ensaio com as imagens já
guardadas", na sugestão da foto padrão — esse ensaio não existe.

### O que os testes acharam antes de sair

- **Salvar um critério aberto por esta tela tirava-o de todos os canais.**
  A gaveta do critério, na edição, marcava os canais que a tela que a abriu
  passava — e esta passava lista vazia. A gaveta passou a tirar os canais
  do próprio critério; salvar sem mexer em nada deixa tudo onde está.
- **Dois cartões de tendência com o mesmo título** (o critério em dois
  canais): a tela usa o título como chave, e um cartão ficava na tela ao
  trocar de setor.
- **O critério sugerido pela relação nascia sem faixa de horas.**
- **Dias divididos por ruído viravam "relação"** (o costume em volta de
  2,5 separado em "menos de 3" e "3 ou mais"). Apareceu porque uma troca
  de linha no motor passou sem teste acusando — e o teste dela só passava
  porque a relação nem chegava a existir.
- **Um teste que não testava**: a série era mexida antes de gerar os
  números, o gerador não a reconhecia, e a conferência passava por não
  haver número nenhum. Foi a troca de uma linha no motor, sem teste
  nenhum acusando, que mostrou.

### O que não foi medido

Os limites do que é saída do padrão, numa loja de verdade: a loja tinha
dois dias de medida quando a fase saiu. Quantas saídas por dia eles dão,
quantas o responsável acha que valem, e se as sugestões acertam, só as
primeiras semanas dizem.

## 09/10/2026 · O disco da loja: quanto tempo a análise fica guardada

A cada análise o agente grava no disco da loja a imagem que foi julgada (o
*spool*) e uma linha na fila local. **Nada disso era apagado.** A fila
sabia limpar o que tinha sido julgado, com teste e tudo — e ninguém a
chamava (ERR-062). Na loja-piloto: 0,37 GB em quatro dias, com recortes de
640 px. Achado ao desenhar o recorte na resolução da câmera, que deixaria
cada imagem de cinco a oito vezes maior.

### O que passou a valer

- **Guarda de 15 dias** para a análise ENCERRADA — julgada, vencida antes
  de ser julgada, ou falhada de vez — e para a imagem dela. É o mesmo
  prazo do resumo por hora que a loja guarda.
- **Quem limpa é a auditoria**, na volta de rotina, no máximo de hora em
  hora. Falha na limpeza vira uma linha de log; a volta segue.
- **O que ainda espera julgamento não é tocado**, seja de quando for.
- **Só sai arquivo de dentro do spool.** A limpeza não apaga o que o
  agente não criou.
- **A linha só sai se a imagem saiu.** Arquivo preso por outro programa
  fica para a limpeza seguinte, e é pela linha que ela o acha.

### Por que 15 dias, e o que isso não decide

O que conta a história da loja não mora ali: o resumo por hora e os
eventos sobem para a nuvem. A imagem no disco serve para conferir, nos
dias seguintes, "por que ele disse isso?".

O **banco de provas** (A19, onda 2) vai precisar de exemplos guardados
para o responsável marcar "acertou" ou "errou". Onde eles ficam, e por
quanto tempo, é decisão daquela onda — o que for exemplo marcado não
pode depender deste prazo.

### O que não foi medido

O tamanho do spool com o recorte na resolução da câmera, numa loja em
operação: a conta de "cinco a oito vezes" sai do tamanho das imagens, não
de uma semana de uso.

## 09/10/2026 · O pedido com contexto: a cena, o mapa e o recorte na resolução da câmera

A19, onda 1, fatia 1.1. Pergunta do dono (08/10): "o que sobe à nuvem? Se
enviar um corte sem contexto, a análise vai falhar e o custo vai ser em
vão." Naquela noite, 93% das análises pagas voltaram sem resposta. O teste
lado a lado ([teste-contexto-na-nuvem.md](teste-contexto-na-nuvem.md))
mediu o que o contexto compra; esta fatia põe isso no motor.

### O que o pedido leva, e em que ordem

| # | parte | de onde vem | no cache? |
|---|---|---|---|
| 1 | **a cena** — o negócio, o setor, a câmera e o que ela vê | `loja.tipo_negocio`, o setor, o nome do canal e `ponto.cena` (mais a frase da planta, quando há) | sim, por canal |
| 2 | **o mapa do canal** — a câmera inteira, pequena, com os quadros numerados, e a legenda: "2 = Montagem (posição de montagem)" | desenhado pelo agente; `zona.papel` e o número do quadro | sim, por canal |
| 3 | a foto padrão, quando o critério a pede | como já era | sim, por área |
| 4 | **a imagem a auditar**, apresentada: "o recorte do quadro 2 — Montagem" ou "a imagem completa desta câmera" | o quadro de agora | não: é o que se paga inteiro |
| 5 | **o critério** (e a descrição do processo, o aviso da área e os equipamentos, quando há) | o critério | não |

As três regras, cada uma com teste:

1. **O recorte nunca sobe sozinho.** Com a chave ligada, o critério julgado
   na nuvem em canal SEM cena escrita não é capturado: a olhada conta como
   "sem juiz", com o motivo "falta descrever a cena deste canal". E o juiz
   de nuvem recusa — antes de abrir a imagem — o pedido que chegar sem a
   cena por qualquer outro caminho.
2. **Critério geral manda a imagem completa; critério de quadro manda o
   mapa e o recorte.**
3. **O que é fixo vai em cache.**

### Quem escreve o quê

- **A cena é escrita por quem configura o canal, com detalhes** (dono,
  09/10). O sistema não propõe a partir da imagem. Um botão só para
  aprimorar o texto fica para depois.
- **O tipo de negócio** é da loja; quem configura escreve.
- **O papel do quadro** é uma lista fechada: posto, cuba, montagem,
  equipamento, impressora, caixa, pia, piso — ou "livre", que é como toda
  área existente ficou.
- **O número do quadro não é guardado.** É a posição dele entre os quadros
  do canal (por `zona.ordem` e, no empate, pela criação). A área que cobre
  o quadro inteiro é a imagem completa: não tem número. A conta é feita num
  lugar só, em SQL (`api/src/cena.ts`); a tela e o agente recebem o número
  pronto.

### A chave é interna

`loja.pedido_com_contexto` nasce desligada e **não é opção do console da
loja** (dono, 09/10: "a lógica de funcionamento é interna, não é necessário
usuário escolher ou informar critério que sobe"). O console recusa o campo
com todas as letras — nem o presidente a liga.

Quem liga é a distribuição, de dentro do serviço, sem digitar segredo:

    npm run provisionar -- contexto <lojaId> ligar
    npm run provisionar -- contexto <lojaId> desligar

**Ligar com canal sem cena é recusado, dizendo quais** — só os que
perderiam análise: sem cena e com critério ligado de estado, de ação ou de
comparação. Para ligar assim mesmo, `--mesmo-assim`.

### Como entrou sem mexer no que funciona

- **O pedido de sempre não mudou uma letra.** O pedido com contexto é um
  caminho ao lado, com instruções próprias (`INSTRUCOES_COM_CONTEXTO`): o
  cache de um não depende do outro, e os testes que comparam o texto do
  pedido antigo continuam passando sem alteração.
- **Tudo desce em campo novo.** O agente antigo ignora `tipoNegocio`,
  `pedidoComContexto`, `cena`, `papel` e `numero`: com a chave ligada e o
  agente antigo, a loja pergunta como sempre.
- **A migration 030 não atualiza linha nenhuma:** os gatilhos de versão não
  disparam, e nenhum agente puxa configuração por causa dela.

### O modelo de rotina

Com contexto, a pergunta de rotina vai no **Haiku 5.5** (US$ 0,10 e 0,50
por milhão). A reconsulta continua no Sonnet 5.5, com o MESMO pedido. Sem
contexto, o pedido de sempre segue no Haiku 4.5: o modelo novo só foi
medido com contexto.

### A resolução, e o que ficou como estava

- **Estado e ação julgados na nuvem:** o recorte vai como a câmera entrega
  (teto de 1.920 px no lado maior; nunca amplia), em vez de 640.
- **Comparação com a foto padrão: o recorte continua em 640.** O
  comparador da loja foi medido com essa entrada; o que não é igual vai
  adiante com a cena e o mapa, mas com o recorte de sempre. Aumentar ali
  pede medir o comparador de novo.
- **O que é julgado na loja** (presença, contagem, urgente, loja de modo
  local) não muda em nada.

### O mapa é a foto do lugar, não de quem está nele

O recorte mostra só o que foi marcado; o mapa mostra a câmera inteira. Por
isso:

1. **nasce como esquema** — o desenho dos quadros sobre fundo liso, sem um
   ponto da imagem da câmera. Nenhum critério espera por fotografia;
2. **vira fotografia só com o lugar vazio:** o detector de pessoas olha o
   quadro inteiro, e um "talvez" já é alguém. Sem detector, fica no
   esquema. A fotografia ainda passa pelo borrão de rosto;
3. **muda devagar:** com a fotografia feita, tenta-se outra no máximo de
   hora em hora, e só troca por uma claramente mais clara (15%) ou quando a
   atual passa de uma semana. Trocar o arquivo joga fora o cache.

A legenda diz ao modelo qual dos dois está vendo. Não é garantia de que
ninguém aparece — o detector erra —; é a mesma medida do porteiro, do lado
conservador.

### A chave da análise

A análise guardada passa a ser de uma cena e de um modelo: mudou o texto da
cena, um quadro ou o modelo de rotina, a mesma imagem é perguntada de novo.

### Conferido contra a API de verdade (09/10/2026, 6h32)

Quatro chamadas, do PC da loja, com o código deste ramo numa pasta de
rascunho (a instalação não foi tocada) e **imagens geradas por
computador** — nenhuma imagem da loja. Custo: 5 centavos.

| chamada | modelo | entrada | do cache | gravado no cache | custo |
|---|---|---|---|---|---|
| critério de quadro (cena + mapa + recorte de 1.229×497) | Haiku 5.5 | 905 | 0 | 2.250 | 0,24 centavo |
| a mesma, de novo | Haiku 5.5 | 905 | **2.250** | 0 | **0,10 centavo** |
| critério geral (cena + imagem completa de 1.920×1.080) | Haiku 5.5 | 2.781 | 1.458 | 340 | 0,22 centavo |
| o pedido da reconsulta (o mesmo do quadro) | Sonnet 5.5 | 891 | 0 | 2.140 | 4,63 centavos |

O que isso prova: os dois modelos aceitam a forma do pedido e respondem
pela ferramenta (o Haiku 5.5 com a escolha forçada, o Sonnet 5.5 com a
livre); o trecho fixo é lido do cache na segunda chamada; e a imagem de
1.920×1.080 entra inteira (2.781 unidades de entrada: é a conta da imagem
sem redução).

A análise de hoje, com a tira de 640 px, custa 1,2 centavo.

### O que não foi medido

- **O acerto com o pedido novo nos critérios de estado da loja.** O teste
  lado a lado mediu a leitura de itens na bancada; os critérios de estado
  (limpeza, uniforme) com cena e mapa ainda não têm número.
- **O mapa em esquema contra o mapa em fotografia:** o teste lado a lado
  usou a fotografia.
- **O tamanho do spool** com o recorte na resolução da câmera, numa semana
  de uso.
- **Quantas vezes o mapa vira fotografia**, e a que horas, numa loja em
  operação.
- **O borrão de rosto em quadro de câmera de cima** continua valendo neste
  caminho até a fatia 1.4 (o quadro "as mãos saíram"). Na bancada ele
  apagou pão em 12 de 40 momentos, no teste lado a lado: ligar a chave
  antes da 1.4 não piora o que já acontece hoje, mas a leitura da bancada
  só fica boa depois dela.

## 09/10/2026 · O estado do critério: observar, ensaiar, medir, avisar

A19, onda 1, fatia 1.2. Pedido do dono (08/10): "nada de aplicar alterações
antes de o projeto analisar de verdade os processos". Virou método: todo
critério passa por quatro estados, e só o último avisa.

| estado | o que o agente faz | custa? | avisa? |
|---|---|---|---|
| **observando** | conta a olhada — e se o contexto valia — e para | não | não |
| **em ensaio** | julga e conta o veredito | o que o julgamento custar | não |
| **medido** | como o ensaio, com o acerto medido à vista | idem | não |
| **valendo** | julga, e o veredito pode virar aviso | idem | sim |

Ligado ou desligado continua sendo outra coisa (`regra.ativa`): o estado diz
o que o critério LIGADO faz.

### Os critérios de hoje ficam como estão

- Todo critério que já existia está **valendo**: quem avisava continua
  avisando. A migration 031 não atualiza linha nenhuma.
- O cadastro de hoje não fala em estado, e cria o critério como sempre
  criou: valendo (e desligado). **Quem vai criar em "observando" é a tela
  nova** (fatia 1.5), que manda o estado no pedido.
- As telas de hoje não mandam estado nenhum: até a tela nova existir,
  ninguém desce um critério sem querer.

### Quem escolhe o quê

- Uma pessoa leva o critério a **observando** e a **em ensaio**, de qualquer
  estado, quantas vezes quiser. Descer um degrau nunca é recusado.
- A **medido** e a **valendo** só se chega com o acerto medido, e quem mede
  é o banco de provas (onda 2). Nenhuma rota do console promove — nem para
  o presidente. É a regra do plano: "nenhuma onda liga aviso sem passar
  pelo banco de provas".
- Pedir o estado em que o critério já está não muda nada, e passa: é o que
  a tela manda ao salvar sem mexer.

A consequência, dita com todas as letras: **critério que desce de "valendo"
não volta à mão**, e critério novo (criado pela tela nova) não avisa antes
da onda 2. Os de hoje não são tocados.

**Ponto em aberto para a fatia 1.5:** a tela nova não pode oferecer "descer
de valendo" enquanto não houver o caminho de volta — ou o banco de provas,
ou um "voltar a valer" que a decisão do dono autorize. Sem isso, um toque
errado deixaria a loja sem o aviso até a onda 2.

### O que não entrou, de propósito

O plano diz que um critério valendo "volta a em ensaio se o texto, o quadro
ou o modelo mudar". **Isso entra com o banco de provas**, não agora: hoje
não há como medir de novo, e a regra faria um critério que avisa parar de
avisar — para sempre — porque alguém corrigiu uma vírgula.

### Só quem está valendo avisa — nos dois lados

- **No agente:** a porta do aviso (`_avaliar`) começa por aí. Em ensaio e
  medido o veredito é contado e mostrado, e para.
- **Na nuvem:** o aviso nasce no servidor (`eventosParaAvisar`), e ali o
  estado vem da regra, não do agente — como já era com a severidade. Evento
  de critério que não está valendo é **guardado** (é o fato) e **não vira
  aviso**. Serve para o evento que estava a caminho quando o critério
  desceu e para o agente com a configuração velha.

### O agente antigo não pode receber o que não sabe

O agente de antes desta fatia ignora o campo novo: um critério em ensaio,
na mão dele, viraria aviso. Por isso o agente passa a dizer o que sabe ao
pedir a configuração (`?sabe=estados`), e **critério que não está valendo
só desce para quem declara**. Para o agente antigo, esse critério não
existe.

Estado que o agente novo não conheça (um que a nuvem ganhe depois) não
derruba a configuração e não vira aviso: o critério fica só observando.

### Observando

- A olhada passa pelas mesmas portas de sempre — a câmera entrega cena? o
  "quando vale a pena conferir" deixa? — e para ali, contada como
  **observada**. A imagem não vai para o disco, nada entra na fila,
  ninguém é perguntado.
- É o nono desfecho de uma olhada (`resumo_hora.observadas`), ao lado de
  "nada a conferir", "cena repetida" e os outros. A conta das olhadas
  continua fechando. Toda olhada conta: para quem não julga não existe
  "cena repetida".
- Não precisa de juiz: critério que só observa não fica "sem quem julgue"
  por faltar a chave da nuvem, o detector ou a cena do canal. O que faltar
  aparece quando ele passar a ensaio.
- **O que já estava na fila também não é julgado.** A olhada que esperava a
  vez quando o critério desceu para "observando" fica de lado e vence
  sozinha; se o critério voltar a ensaio antes disso, é julgada.
- **Presença e contagem em "observando" também não são medidas.** Para
  elas, julgar é de graça e é a própria medida — o caminho é passar a "em
  ensaio", que não avisa.
- O vigia (a olhada extra entre uma rotina e outra) não olha por quem só
  observa.
- Em loja que pergunta com contexto, o mapa do canal é cuidado do mesmo
  jeito: fica pronto para quando o critério passar a ensaio.

### Em ensaio

- O veredito entra no resumo por hora e aparece nas análises. Não vira
  alerta, não vira evento, não registra silêncio, e o "avisar só se
  continuar" não guarda nada.
- **Não há silêncio:** valendo, o critério se cala pelo tempo de silêncio
  dele depois de avisar; em ensaio não há aviso, e toda cena nova é
  julgada — inclusive a do critério que avisou minutos antes, quando
  valia. É assim que se juntam exemplos — e, num critério julgado na
  nuvem, é o custo do ensaio. O funil mostra.
- A cena igual à anterior continua sem ser julgada de novo, como sempre.

### O que não foi medido

- Quanto custa um dia de ensaio de um critério de nuvem nesta loja.
- Onde ficam os exemplos que o responsável vai marcar "acertou / errou"
  (hoje a imagem julgada fica 15 dias no disco da loja): é da onda 2.
- Nenhum critério da loja mudou de estado: o comportamento em produção foi
  provado nos testes (agente e API), não na loja. O pacote do agente que
  está na loja é anterior a esta fatia e só recebe o que está valendo.

## 09/10/2026 · O estudo do critério: o contexto, o gatilho e o funil

A19, onda 1, fatia 1.3 — a parte que não depende de tela nem da resposta do
dono sobre quem escreve a ficha. Pedido dele (08/10): os critérios têm de
ser estudados para gerar gatilhos, sem julgamento desnecessário "sem
movimento ou sem o contexto acontecendo". O exemplo: para saber se o
colaborador da chapa salga as carnes, é preciso haver carne na chapa e
colaborador no posto — sem isso não se analisa.

### O que é o estudo

A ficha de seis partes do critério — contexto, gatilho, janela, ação,
desfecho e fora de contexto —, em texto. Duas delas têm também a forma que
a loja confere **sozinha, de graça**:

- **contexto** — o que precisa estar acontecendo. Uma lista de condições;
  **todas** têm de valer. Não valeu: a olhada é "nada a conferir".
- **gatilho** — o que abre a análise. Uma lista; **basta um**. Vazia é
  "toda olhada". O contexto valia e nada abriu: a olhada é "sem gatilho".

Cada condição lê um **sinal** num **lugar** do canal — o quadro do próprio
critério (`aqui`), a imagem completa (`canal`) ou outro quadro do mesmo
canal (`quadro`). "Há colaborador no posto" é o sinal `pessoa` no quadro do
posto, lido por um critério que mora no quadro da chapa.

| sinal | de onde vem | vale | não vale | começou | acabou |
|---|---|---|---|---|---|
| **pessoa** | o detector de pessoas da loja | `pessoa` | `sem_pessoa` | `entrou` | `saiu` |
| **movimento** | o que mudou desde a olhada anterior | `movimento` | `parado` | `mexeu` | `parou` |
| **foto padrão** | a cena é a da foto padrão do canal? | `fora_do_padrao` | `no_padrao` | `saiu_do_padrao` | `voltou_ao_padrao` |

As duas primeiras colunas de nomes são para o contexto; as duas últimas,
para o gatilho. Há ainda dois gatilhos do relógio: `toda_olhada` e `a_cada`
N minutos (de 1 a 720). O contrato é `contratos/estudo-do-criterio.json`,
lido pelos testes dos dois lados.

O exemplo do dono, nessa forma: contexto = `fora_do_padrao` aqui (há carne:
a chapa não está como na foto da chapa vazia) **e** `pessoa` no quadro do
posto; gatilho = `saiu_do_padrao` aqui (a carne acabou de ser posta).

**O porteiro de hoje vira caso particular.** "Só com pessoa na área" é o
contexto `pessoa` aqui; "só com a área livre", `sem_pessoa` aqui; "só com
movimento", `movimento` aqui. O critério **com estudo confirmado
responde pelo estudo, e o porteiro guardado nele não é consultado**. Sem
estudo, tudo segue como sempre.

### Na dúvida, pergunta

É a regra do porteiro, e vale inteira: segurar uma pergunta que tinha
resposta é pior do que fazer uma que não tinha.

- O que não se sabe ler **não segura**: sem detector, sem foto padrão no
  canal, quadro que foi excluído, primeira olhada — a condição de contexto
  vale e o gatilho dispara.
- `pessoa` só deixa de valer quando o detector não viu **nem um talvez**;
  `sem_pessoa`, só quando viu alguém **com certeza**.
- A borda de pessoa tem **histerese**: a certeza liga, o "nem um talvez"
  desliga, e o meio mantém o que era.
- A borda compara com a olhada **anterior daquele lugar**. Anterior com
  mais de cinco minutos não é anterior: é outra cena — não se sabe, e
  dispara.
- No agente, sinal que ele não conheça (um que a nuvem ganhe depois) não
  derruba a configuração: condição de contexto desconhecida sai da lista e
  gatilho desconhecido faz o critério ser conferido em toda olhada.

### O que o agente faz, em ordem

    é hora? → está em silêncio? → a câmera entrega cena?
      → o estudo: o CONTEXTO vale?      não → "nada a conferir"
                  um GATILHO abriu?     não → "sem gatilho"
      → o critério só observa?          sim → "observada"
      → borrão · cena repetida · fila · julgamento

- **Tudo é lido em toda olhada**, mesmo com o contexto faltando e mesmo
  depois de um gatilho disparar: a borda da próxima olhada sai da leitura
  desta. Cada lugar é lido uma vez por olhada, não importa quantos critérios
  perguntem.
- **O relógio dos sinais é o da olhada**, não o do quadro escolhido (cada
  critério escolhe o quadro mais nítido da rajada).
- **"A cada N minutos" conta desde a última vez que a análise abriu** — por
  qualquer gatilho, e só com o contexto valendo. O relógio é do critério
  naquele quadro.
- **O gatilho e o contexto têm de coincidir na mesma olhada.** Gatilho que
  dispara com o contexto faltando não fica guardado.
- **Presença e contagem não usam estudo:** são conferidas na loja em toda
  olhada, e ali a olhada é a própria medida.
- **"Avisar só se continuar":** faltar `pessoa` zera a espera (o que estava
  fora do critério numa pessoa deixou de estar); faltar outra condição, ou
  ficar sem gatilho, nem anda nem zera.
- **Em "observando" o funil já conta:** a olhada que passou pelo contexto e
  pelo gatilho é a "observada". É o que mostra quantas vezes por dia o
  gatilho acontece antes de alguém mandar julgar.
- `resumo_hora.sem_gatilho` é o **décimo desfecho** de uma olhada; a conta
  das olhadas continua fechando.

### O que a nuvem guarda e serve

- `regra_estudo` (migration 032): os seis textos, o contexto, o gatilho, e
  quem confirmou. `GET`, `PUT` e `DELETE /v1/regras/:id/estudo`.
- **Só o estudo confirmado desce**, e só para o agente que declara saber
  (`?sabe=estudo`). Os textos ficam na nuvem: para o agente descem o
  contexto e o gatilho.
- Grava e tira quem configura (gerência para cima, e o suporte). A ficha que
  não cabe é recusada dizendo por quê, e nada é gravado pela metade: sinal
  ou lugar desconhecido, o mesmo sinal repetido no mesmo lugar, uma coisa e
  o contrário dela no mesmo lugar (o critério nunca seria conferido),
  "toda olhada" ao lado de outro gatilho, quadro que não é de um canal do
  critério, e contexto ou gatilho em critério de presença ou de contagem.
- **A confirmação guarda quem e quando, e só muda quando muda o que foi
  confirmado** (o contexto ou o gatilho). Salvar de novo, ou corrigir um
  texto, não troca o autor.
- **A versão da configuração só sobe quando muda o que o agente usa.**
  Corrigir o texto de uma parte não faz a loja remontar a auditoria.
- **O funil** — `GET /v1/regras/:id/funil?dias=N` (supervisão para cima):

      olhadas = sem juiz + sem imagem + em silêncio
              + sem contexto + sem gatilho + com gatilho

  "Com gatilho" é a olhada que passou pelas duas portas: a observada, a
  enfileirada, a de cena repetida e a que já tinha veredito. Vem o total,
  por quadro e por dia (no relógio da loja), e o que foi julgado, onde, e
  quanto custou.
- **"Quanto custaria ligado"** = gatilhos por dia × o preço **medido** de
  uma análise na nuvem. Os gatilhos por dia são a média dos dias inteiros
  (hoje só entra quando é o único, e aí o número sai marcado como parcial).
  O preço é o que este critério pagou por análise nos últimos 30 dias; sem
  isso, o que a loja pagou; **sem isso, não há preço** — nada de número
  inventado. Presença, contagem e loja em modo local: zero. É o **teto**:
  antes de ligar não se sabe quantas análises a loja resolve sozinha.

### O agente que passa a saber mais (ERR-064)

A nuvem monta a configuração conforme o que o agente declara, e o agente só
a puxava quando a **versão** mudava. Trocado o pacote na loja, o agente novo
subiria com a configuração que o antigo guardou — sem o critério em
observação, sem o estudo — e nunca pediria de novo. Agora a configuração
guardada em disco leva a anotação do que o agente declarou ao pedi-la, e ele
puxa de novo, uma vez, quando sabe mais do que sabia. A auditoria remonta
quando a mesma versão chega pedida sabendo mais.

### O que foi medido na loja — os sinais, sobre a gravação (09/10)

O estudo ainda não roda na loja. O que dá para medir já é o que os SINAIS
dizem: a gravação da noite de 08/10 (loja aberta) passada pelo mesmo
código, no computador da loja, com o detector dela (rfdetr-nano na placa
de vídeo; certeza 0,70, dúvida 0,35). Um quadro a cada 10 s; os sinais
lidos a cada 10 s e, com um quadro em três, a cada 30 s — o ritmo da
olhada. Nenhum quadro falhou. Só números saíram: nenhuma imagem foi
guardada, e a instalação do agente não foi tocada.

**Canal 4 — a câmera de cima da bancada de montagem, das 21h às 22h**
(120 olhadas a cada 30 s):

| | o quadro do tampo | a imagem completa |
|---|---|---|
| o detector viu alguém com certeza | 18 (15%) | 70 (58%) |
| viu ao menos um "talvez" | 43 (36%) | 87 (73%) |
| alguém chegou · o lugar ficou livre | 13 · 13 | 14 · 14 |
| algo mudou desde a olhada anterior | 98 de 119 (82%) | 106 de 119 (89%) |
| o lugar parou (mexia, e não mexe mais) | 10 | 6 |

**Canal 6 — a câmera da chapa, das 21h às 21h30** (60 olhadas a cada 30 s;
o canal só tem a imagem completa):

| | a imagem completa |
|---|---|
| o detector viu alguém com certeza | 53 (88%) |
| viu ao menos um "talvez" | 53 (88%) |
| alguém chegou · o lugar ficou livre | 3 · 2 |
| algo mudou desde a olhada anterior | 55 de 59 (93%) |
| o lugar parou | 1 |

O que isso diz:

1. **Na câmera de cima, "há pessoa" não quer dizer "há alguém montando".**
   O tampo mudou em 82% das olhadas e o detector só viu alguém com certeza
   em 15% — de cima ele vê braço e mão, não gente. O contexto `pessoa`
   nesse quadro deixaria de valer em 77 das 120 olhadas de uma hora cheia.
   Ali o sinal é o **movimento**. Na câmera da chapa é o contrário: o
   detector é firme (certeza e "talvez" dão o mesmo número, 88%).
   **Quem escreve o estudo — a pessoa ou o sistema — tem de escolher o
   sinal pela câmera.**
2. **O funil em potencial, no tampo, nessa hora:** em toda olhada, 120
   análises; só com algo mudado, 98; só quando o tampo para, **10**; a
   cada dez minutos, 6. (Fora as primeiras olhadas, em que ainda não há
   anterior para comparar e, na dúvida, a análise abre.) É conta sobre os
   sinais, não sobre um critério rodando.
3. **O ritmo de 30 s perde bordas.** A cada 10 s o tampo "parou" 26 vezes
   na hora; a cada 30 s, 10. Na chapa, 11 contra 1 em meia hora. Gatilho
   fino pede olhar mais vezes entre uma olhada e outra — é o que a
   sequência da onda 2 (e o quadro de bancada, fatia 1.4) vão precisar.
4. **Nenhum canal da loja tem foto padrão guardada:** o sinal "há algo
   ali" (`fora_do_padrao`), que o exemplo da chapa pede, depende de alguém
   guardar a foto da chapa vazia.

### O que não entrou

- **Quem escreve a ficha.** O plano diz que o sistema propõe as seis partes
  e liga cada condição a um sinal; o dono corrigiu que a *cena* é escrita
  por quem usa, e ainda não disse se o mesmo vale para o estudo. A rota
  aceita a ficha pronta; a proposta fica para depois da resposta dele.
- **A tela** (fatia 1.5): a ficha, o funil e a frase de cada condição.
- **A ação conferida por sinal** — "o saleiro saiu do lugar marcado e voltou
  = salgou". Os sinais para isso existem (`saiu_do_padrao` e
  `voltou_ao_padrao` no quadro do saleiro), mas hoje o estudo só decide
  QUANDO julgar; julgar por sinal é juiz novo.
- **A olhada extra do vigia para gatilho:** o ritmo é o da olhada (30 s).
  O que começa e termina entre duas olhadas não é borda de nada.
- **O sinal de outra câmera.** A condição olha um quadro do MESMO canal.
  "Há alguém na bancada" talvez se veja melhor pela câmera lateral (canal
  1) do que pela de cima (canal 4) — não foi medido —, e hoje o critério
  do canal 4 não tem como perguntar ao canal 1.
- **A nuvem saber o que o agente da loja sabe.** Hoje o agente declara ao
  pedir a configuração, e a nuvem não guarda. A tela vai precisar disso para
  dizer "o estudo já vale na loja" — entra com ela.

### O que não foi medido

- O estudo **rodando na loja**: o agente instalado é o pacote antigo, e não
  há critério com estudo. O comportamento foi provado em teste; o que se
  mediu na loja foram os SINAIS, sobre a gravação.
- O sinal da **foto padrão** na loja: nenhum canal dela tem foto padrão
  guardada.
- As outras quatro câmeras, e outras horas: mediram-se dois canais, na
  noite de 08/10.
- Se o canal 1 (a câmera lateral) vê bem quem está na bancada — é
  suposição pelo que a câmera da chapa mostrou.
- O custo do detector a mais por olhada, com vários critérios com estudo.

## 09/10/2026 · O quadro de bancada: a imagem espera as mãos saírem

A19, onda 1, fatia 1.4. Do plano: em quadro com o papel "posição de
montagem", sobe o quadro de quando as mãos saem, sem o borrão de rosto, e
quem aparecer é apagado. Vem do teste na nuvem (08/10): o borrão de rosto
apagou pão em 12 dos 40 momentos e, de cima, não há rosto para ele pegar.

### A regra

Vale só em **quadro com o papel "posição de montagem"**, e só para critério
que **manda imagem para julgar** (estado, ação, comparação). Presença e
contagem continuam conferidas em toda olhada, com mão ou sem.

- **A imagem só sai com o quadro quieto:** nada mexeu nas três últimas
  medidas dele no fluxo menor, tiradas de meio em meio segundo — um segundo
  e meio. A medida é a do porteiro: o quadro reduzido a 96×54, e "mexeu" é
  1,2% dos pontos saltarem mais de 24 níveis de cinza. Só conta o que está
  dentro do desenho do quadro.
- **Com mão na frente a olhada é "nada a conferir"**, e fica anotada: é
  refeita quando o quadro parar (abaixo).
- **Sem o borrão de rosto só vai o quadro quieto em que o detector da loja
  não vê ninguém** — nem um "talvez" (nenhum ponto de pessoa de 0,35 para
  cima). Quem ele olha é a própria imagem que vai sair.
- **Com alguém à vista, a imagem sai como sempre saiu: com o borrão.** O
  mesmo sem detector instalado, ou com ele falhando: o que não se sabe conta
  como "pode haver alguém".
- **Não sei não é quieto.** Sem fluxo menor, com o fluxo parado, sem três
  medidas seguidas ou com a última feita há mais de dois segundos, não se
  sabe — e a olhada segue **como sempre foi: sai, e com o borrão**. A regra
  nova nunca deixa um canal sem análise por falta de medida.

Só o movimento segura a olhada. O detector não segura nada: decide se a
imagem leva o borrão.

Quem mede é a `quietude.py`, em thread própria (a auditoria passa segundos
julgando; a medida é de meio em meio segundo). Ela **nunca abre fluxo**: usa
o fluxo menor, que o agente já mantém aberto em todo canal com critério.

### Por que o movimento, e não o detector de pessoas

Medido na fatia 1.3, na câmera de cima: em uma hora cheia o tampo mudou em
82% das olhadas e o detector só viu alguém com certeza em 15% — de cima ele
vê braço e mão, não gente. "As mãos saíram" não sai dele.

### Onde entra, no motor

    é hora? → está em silêncio? → a câmera entrega cena?
      → o quadro é de bancada, e está mexendo?  → "nada a conferir"
      → o estudo: o CONTEXTO vale? um GATILHO abriu?
      → o critério só observa?
      → borrão (menos na bancada quieta e sem ninguém à vista) · …

**Antes do estudo, de propósito:** a olhada que não pode sair não gasta o
gatilho. Com "a cada dez minutos", a olhada segurada pela mão contaria como
a análise dos dez minutos, e a de verdade só viria dez minutos depois.

Como o estudo só lê os sinais nas olhadas que passam, na bancada ele compara
sempre **duas cenas sem mãos**: "mexeu desde a olhada anterior" passa a
querer dizer "o que está no tampo mudou".

### A olhada refeita

A rotina olha a cada 30 s, e a mão não tem hora. Com uma olhada de bancada
esperando, o laço da auditoria **acorda de segundo em segundo**; quando o
quadro está quieto, abre o fluxo principal e olha **só os critérios que
esperavam, naquele quadro** — o resto do canal não é acordado.

- A porta é conferida de novo **depois** de abrir: abrir leva de um a três
  segundos, e a mão pode ter voltado.
- **No máximo duas tentativas por canal a cada volta de rotina.** Cada uma
  abre o fluxo principal.
- Cada tentativa entra no resumo da hora como uma olhada a mais daquele
  critério. A que as mãos seguraram fica contada como "nada a conferir".
- Critério que saiu do horário, ou canal que ficou sem fonte, com olhada
  esperando: a espera é largada, e o laço volta a dormir.

### O vigia continua no passo dele

Achado na revisão, antes de mesclar: o laço chamava o vigia **a cada vez
que acordava**. Acordando de segundo em segundo para a bancada, o detector
do vigia rodaria dez vezes mais nos canais de presença — numa máquina que
já tem freio por uso de processador. O vigia ganhou a vez dele (a cada
10 s, contados do fim da rotina ou da última olhada dele), e o laço dorme
só o que falta para ela.

### O que foi medido na loja (gravação de 08/10, canal 4, das 21h10 às 21h20)

Loja aberta, a câmera de cima da bancada, o quadro do tampo. Só números
saíram; a instalação do agente não foi tocada.

**1. Quanto o tampo mexe.** Do fluxo principal gravado, uma medida a cada
0,53 s (1.126 medidas):

| | |
|---|---|
| o tampo mexia | em 325 de 1.125 medidas (29%) |
| trechos parados | 25 — 21 com 1,6 s ou mais, 14 com 4 s ou mais, 10 com 10 s ou mais |
| quieto, pela regra | em 751 instantes (67%) |

**2. "Parou" quer dizer "as mãos saíram"?** Conferido a olho em 22 recortes
do quadro (apagados depois): nos 12 instantes em que o tampo parou não
havia mão nem braço; dos 10 instantes ao acaso, os 6 que a regra deixaria
passar também não tinham, e os 2 com mãos ela segurou. (Os outros 2 ela
segurou sem haver mão: erra para o lado de esperar.)

**3. O fluxo menor.** O gravador não guarda o fluxo menor (pedir a gravação
dele dá erro 404), então a regra não pôde ser medida nele com a loja
aberta. Duas conferências no lugar: a mesma gravação **reduzida ao tamanho
do fluxo menor** deu a mesma resposta ("mexeu" ou não) em 1.125 de 1.125
medidas; e o fluxo menor **ao vivo, com a loja fechada**, deu ruído zero em
119 medidas (nada parado parece mexer).

**4. A classe do agente, sobre a gravação.** A `Quietude` do ramo — a
mesma que vai para a loja —, alimentada com a gravação reduzida a 704×480:
quieto em 751 medidas, mexendo em 371, "não sei" nas 3 primeiras. A mesma
resposta da série do item 1 em **1.125 de 1.125**.

**5. O detector, com o quadro quieto.** No recorte do tampo (1630×397, do
fluxo principal), o detector da loja (rfdetr-nano na placa de vídeo; 86 ms
por recorte, em média):

| | viu alguém com certeza | viu ao menos um "talvez" |
|---|---|---|
| com o quadro **quieto** (751) | **0** | **0** (o maior ponto foi 0,13) |
| com o quadro mexendo (371) | 112 (30%) | 212 (57%) |

Nesta gravação, quieto e ninguém à vista andaram juntos: **em todos os 751
instantes quietos a imagem iria sem o borrão**. O caso de alguém parado
dentro do quadro não apareceu em dez minutos — quando aparecer, a imagem
vai com o borrão.

**6. O que o laço faria** — conta sobre a série do item 1, não medida com o
agente rodando: uma rotina a cada 30 s, em todas as fases possíveis, com o
fluxo principal levando 1,5 s, 2,5 s ou 3,5 s para abrir:

| | |
|---|---|
| a imagem sai já na rotina | em 70% das voltas |
| com até duas tentativas | em 88% a 90% (a terceira acrescentava 1 em 100) |
| aberturas do fluxo principal por volta | 1,28 (hoje: 1) |
| da rotina até a foto que saiu | 2,5 s, em média |

### O que a regra não cobre

- **A mão que entra entre a última medida e a foto.** A medida é de meio em
  meio segundo e a foto é tirada depois dela: na série, em 20 dos 751
  instantes quietos (3%) a medida seguinte já mexia. É foto com mão, como
  as de hoje. (O detector olha essa mesma foto: se vir alguém nela, ela
  leva o borrão.)
- **Câmera que mostra rosto.** A regra foi pensada para a câmera de cima.
  Se um quadro de câmera lateral for marcado como "posição de montagem", a
  imagem sem o borrão depende só de o detector não ter visto ninguém nela
  — e quantas vezes ele deixa de ver quem está na foto não foi medido.
  **A tela em que se escolhe o papel (fatia 1.5) tem de dizer isso.**

### O que mudou em relação ao plano

**"Quem aparecer é apagado" não entrou.** No lugar: sem o borrão só vai a
imagem em que o detector não vê ninguém; com alguém à vista, ela sai como
sempre saiu, **com o borrão de rosto**. Por quê:

- o detector da loja devolve caixas, não contorno — apagar pela caixa
  cobriria o tampo, que é o que se quer ver;
- de cima ele vê mal quem está ali (item 5: 30% com o quadro mexendo):
  apagar "quem o detector viu" não apagaria quem importa;
- apagar pelo contorno pede um modelo de segmentação, que a loja não tem
  instalado e ninguém mediu.

**E a olhada com alguém à vista não é segurada** — foi a primeira versão
desta fatia, descartada na revisão. Numa câmera lateral quem trabalha na
bancada é visto quase o tempo todo (na da chapa, em 88% das olhadas):
segurar faria o critério só enxergar a bancada vazia. E um "há alguém"
errado e persistente deixaria o critério sem análise nenhuma. Com o
borrão, o pior caso é o de hoje.

### O que não entrou

- **Apagar quem aparece, pelo contorno** (acima).
- **A sequência** (onda 2): a bancada continua com a olhada de um quadro só.
- **O motivo separado no funil.** A olhada que as mãos seguraram entra em
  "nada a conferir", junto com a do porteiro e a do contexto do estudo. Se a
  tela (fatia 1.5) quiser dizer "N vezes havia mão na frente", é contador
  novo.
- **Onde escolher o papel do quadro.** O papel existe na nuvem desde a
  fatia 1.1, mas o console ainda não tem o campo (fatia 1.5). Até lá, nenhum
  quadro é de bancada, e nada muda em loja nenhuma.

### O que não foi medido

- **O fluxo menor de verdade, com a loja aberta** — só reduzido (item 3) e
  ao vivo com a loja fechada.
- **A regra rodando na loja:** o agente instalado é o pacote antigo, e
  nenhum quadro tem o papel. O comportamento foi provado em teste; na loja
  mediram-se a quietude e o detector, sobre a gravação.
- **Quanto leva para abrir o fluxo principal ao vivo** naquela máquina (a
  placa de rede dela está forçada a 10 Mbps até a troca do cabo). A conta do
  item 6 foi feita com três valores.
- **Se a foto sem mãos acerta mais** na resposta do modelo. Mediu-se que o
  borrão apagava o pão e que a regra entrega quadro sem mãos; o ganho no
  acerto é assunto do banco de provas (onda 2).
- **Outras bancadas, noites e câmeras:** são dez minutos, de um canal, de
  uma noite.
- **O custo da medida na máquina da loja.** No computador de desenvolvimento
  uma medida de um quadro leva 0,6 ms (duas por segundo: um milésimo de um
  núcleo); na loja não foi medido.

## 09/10/2026 · A nuvem guarda o que o agente da loja declara saber

A19, onda 1 — a parte da fatia 1.5 que não depende de tela (migration 033).

### Por quê

Ao pedir a configuração o agente declara o que sabe fazer
(`?sabe=estados,estudo,bancada`), e a nuvem só manda certas coisas para
quem declara. A declaração valia para aquele pedido e era esquecida. Faz
falta em dois lugares:

1. **A tela** (fatia 1.5) precisa dizer se o que foi configurado já vale na
   loja: um critério criado em "observando" não chega ao agente antigo, e
   quem configura tem de saber disso sem adivinhar.
2. **O dia da troca do pacote.** É como se confere, de fora, que o agente
   novo subiu e pediu a configuração de novo sabendo mais.

**A versão que o agente informa no sinal de vida não serve para isso.**
Conferido na loja em 09/10: o agente roda com `--versao 0.1.0-loja`, um
texto fixo de quem o instalou. Não muda com o pacote — pela versão, a
nuvem não distingue o pacote de hoje do de amanhã.

### O que entrou

- `agente.sabe` (a lista, em ordem) e `agente.sabe_em` (a hora) — migration
  033. Gravados quando o agente pede a configuração, pelo que ele declarou
  naquele pedido. **Vale a última declaração:** quem pede sem declarar nada
  fica com a lista vazia e a hora nova (é o agente de antes dos estados).
  `sabe_em` nulo = ainda não pediu desde que isto é guardado.
- **Anotar nunca impede a configuração de descer:** se a gravação falhar,
  fica o aviso no registro do serviço e a loja recebe a configuração.
- O que vem torto não é guardado: só nomes em minúsculas, no máximo 12.
- `GET /v1/lojas/:id` devolve `sabe` e `sabe_em` de cada agente, ao lado da
  versão e do sinal de vida. Nenhuma tela usa ainda.
- O agente passa a declarar **`bancada`** (o quadro de bancada, fatia 1.4).
  Não muda o que desce — o papel do quadro desce para todos —, só informa.
  Como ele passou a saber mais, o agente que já tivesse a configuração a
  pede de novo, uma vez (é o mecanismo do ERR-064).
- O vocabulário está em `contratos/o-que-o-agente-sabe.json`, lido pelos
  testes dos dois lados.

### A volta ao pacote antigo — o que isto NÃO resolve

O agente pede a configuração de novo quando passa a saber **mais**. Quando
passa a saber **menos** — o pacote voltou a uma versão anterior —, ele sobe
com a configuração que o pacote novo guardou em disco, e não pede de novo
enquanto a versão dela não mudar.

- Do pacote da fatia 1.2 em diante, o estado do critério é respeitado. O
  que o pacote não conhece — o estudo, por exemplo — é ignorado: o critério
  volta a ser conferido como antes de o estudo existir (mais análises, não
  aviso errado).
- **O pacote que está na loja hoje é anterior a isso.** Voltando a ele com
  a configuração do pacote novo em disco, um critério "em observação" ou
  "em ensaio" seria **julgado** — e pago, se for de nuvem. Ninguém seria
  avisado: o servidor só avisa do que está valendo. Mas gastaria.
- Por isso, **em toda volta de pacote: apagar
  `C:\Farol\agent\configuracao.json` antes de subir o agente antigo.** Ele
  pede a configuração do zero, declarando só o que sabe, e recebe só o que
  entende.
- A nuvem não tem como perceber a volta sozinha: a versão informada é fixa
  (acima), e a declaração só chega quando o agente pede. Fazer o instalador
  informar o pacote de verdade na versão é mudança na loja — fica para o
  roteiro da troca, com o "pode" do dono.

### O que não entrou

- **A tela.** Dizer "este critério ainda não chegou à loja" é da fatia 1.5.
- **Dizer por critério** o que vale na loja: hoje a nuvem guarda a lista do
  agente; cruzar com cada critério é conta da tela.

### O que não foi medido

- Com o agente da loja: ele é o pacote antigo, pede sem declarar nada, e
  só pede quando a versão da configuração muda. Depois desta migration, a
  linha dele fica com `sabe_em` nulo até a próxima mudança de configuração.

## 09/10/2026 · A imagem completa de volta: o canal, os quadros e a tela do canal

A19, onda 1 — a primeira parte das telas da fatia 1.5 (migration 034). O
protótipo da onda foi aprovado pelo dono em 09/10 ("protótipos aprovados").

### Por quê

As palavras são as do dono: o **canal** é a câmera; a **imagem completa** é
o canal inteiro, e os critérios dela são os **critérios gerais**; o
**quadro** é um recorte marcado dentro da imagem, com nome e **papel**, e
tem os seus critérios.

Até aqui a "área principal" do canal era uma área como as outras: nascia
"Quadro inteiro" e podia ser redesenhada. Redesenhada, ficava com o nome de
quadro inteiro cobrindo um pedaço da imagem — e o canal deixava de ter onde
pôr um critério que vale para a câmera toda. **Na loja de verdade dois dos
seis canais estavam assim** (lido da configuração dela em 09/10: "montagem
1" e "Atendimento principal"), um deles com um critério de presença.

### O que mudou no modelo

- **A principal É a imagem completa.** Uma por canal, sempre o canal
  inteiro, com o nome "Imagem completa", sem papel. Não se redesenha, não se
  renomeia e não se exclui; dela só se informa a largura real da cena.
- **A regra está no banco**, não só na API
  (`zona_principal_e_a_imagem_completa`): a principal é o canal inteiro, sem
  papel, e nunca está excluída. Nenhum caminho — desta API, de uma versão
  antiga dela, ou de mão no banco — quebra isso.
- **Quem diz o que é a imagem completa é ser a principal, não o desenho.** O
  número do quadro deixou de sair do contorno: um quadro esticado até cobrir
  a imagem toda continua sendo quadro, com número e papel (a câmera fechada
  só na bancada pode ter a imagem inteira como "posição de montagem").
- **Todo canal nasce com ela** — pelo console e pela distribuição. *Achado
  no caminho:* o canal criado junto com a loja, pela distribuição, nascia
  sem área nenhuma; não aparecia na árvore de critérios e não descia com
  área para o agente.
- **Um canal tem a imagem completa e até oito quadros** (antes, oito áreas
  contando a principal).

### O que a migration fez com o que existia

1. A principal que não cobria a imagem inteira deixou de ser a principal:
   virou um quadro como os outros, com o mesmo desenho, o mesmo nome e os
   mesmos critérios. **Nada muda no que é analisado**: o vínculo do critério
   é com a área, e a área é a mesma.
2. O canal que ficou sem principal e já tinha uma área cobrindo tudo passou
   a tê-la como imagem completa (a mais antiga); o que não tinha, ganhou uma.
3. "Quadro inteiro" deixou de ser nome de área: a imagem completa se chama
   "Imagem completa" em todo canal, e o quadro que ainda tinha o nome de
   fábrica (redesenhado sem ninguém trocar) passou a se chamar "Área marcada".

Os casos tortos também estão cobertos (e testados, com o arquivo da
migration rodando num esquema à parte): quadro que já se chamava "Imagem
completa", canal com duas áreas cobrindo tudo, canal sem área, canal só com
área excluída, principal marcada como excluída, principal com papel, canal
excluído. Rodar de novo não muda nada.

### As rotas

- `PATCH /v1/zonas/:id` — na imagem completa, tudo o que a mudaria é
  recusado com `409 imagem_completa_fixa` e o motivo ("…Para conferir só uma
  parte, marque um quadro"); mandar de volta o que ela já é passa, e a
  largura real da cena grava. Num quadro, `principal: true` é recusado, e o
  nome "Imagem completa" também (422).
- `POST /v1/pontos/:id/zonas` — nunca cria principal; recusa o nome
  reservado; o teto conta só quadros.
- `DELETE /v1/zonas/:id` — a imagem completa não se exclui (409). Saíram o
  "o canal precisa de pelo menos uma área" e o "a principal passa para a
  mais antiga": não há mais como chegar neles.
- `GET /v1/pontos/:id` — a imagem completa primeiro e os quadros na ordem do
  número; de cada critério, em quantos canais e quadros ele vale e se **falta
  a cena** para ele; do canal, se a cena está fazendo falta.
- `GET /v1/lojas/:id` — de cada área, o número e o papel; de cada canal, se
  a cena já foi escrita.

### A tela do canal (`/pontos/:id`)

É o porte do protótipo, com as peças e as cores do console de hoje (o
caminho "a" do roadmap — a cara nova chega para tudo de uma vez na onda 8):

- **o canal e os quadros** — a imagem com cada quadro numerado, a faixa
  riscada onde dois se sobrepõem, a contagem ("4 quadros · 6 critérios — 2
  gerais, 4 em quadros") e o "+ Quadro";
- **onde cada critério vale** — a árvore: a imagem completa (os critérios
  gerais) e um nó por quadro, com o papel, os critérios e o "+ critério";
- **a cena deste canal** — o tipo de negócio (da loja) e o texto de quem
  configura, com a orientação do que vale escrever;
- **a gaveta do quadro** — nome, papel, "Redesenhar o contorno" e a exclusão
  em dois passos.

A tela do desenho por pontos (`/pontos/:id/area`) continua, agora só para
os quadros, e segue com as fotos padrão, as medidas e a conexão do canal: a
tela do canal tem o atalho "Desenho, fotos e conexão".

### A tela só afirma o que é verdade

- **"Falta descrever a cena"** aparece no critério e no cartão da cena só
  quando a cena está fazendo falta de fato — a loja já pergunta com contexto
  e o canal está sem o texto. Quem diz é o servidor. **A chave interna
  continua fora do console:** a tela não recebe a chave, recebe a
  consequência dela, por canal e por critério. Critério desligado e
  critério que só observa não acusam falta (um não é conferido, o outro
  conta as olhadas sem precisar entender a imagem).
- **"Olhando agora"** só com o agente vivo, o canal ativo e um critério
  ligado que valha no horário de agora e não esteja parado por falta da
  cena. Critério com faixa de horas própria não entra na conta: a tela não
  sabe se a faixa é agora, e prefere não afirmar.
- **O que o papel muda.** Só um papel muda a análise hoje — "posição de
  montagem" (fatia 1.4) —, e a gaveta diz o que muda, que foi pensado para
  câmera de cima, e se o computador da loja já tem a regra (pelo que o
  agente declarou saber, migration 033).
- **A lista de critérios mostra o estado ao lado do "Ligado"**: o que só
  observa ou está em ensaio está ligado e não avisa ninguém.

### Onde a tela diverge do protótipo aprovado

1. **Sem a barra de cima** com o caminho e o "Ir para… (Ctrl K)": o console
   de hoje não tem barra de cima; o caminho fica acima do título. O "ir para"
   não entrou.
2. **O texto de cada papel** ficou só com o que o quadro é. O protótipo dizia
   também o que o Farol faria com ele ("a leitura da bancada usa para saber
   de onde a mão pegou", "marca o instante em que o pedido chega"), e isso
   ainda não existe.
3. **A frase do campo da cena** ("Este texto diz ao Farol o que a câmera
   está vendo") e o aviso depois de salvar ("O agente da loja recebe na
   próxima batida") não prometem uso: o que o Farol faz com o texto é lógica
   interna e muda de loja para loja.
4. **A pastilha "em branco"** da cena é âmbar quando a cena não está tirando
   análise de ninguém, e vermelha só quando está.
5. **Apagar a cena** de um canal que já a tem não se faz pela tela (o campo
   vazio é recusado, com o motivo).
6. **O critério ainda abre a gaveta de hoje.** A gaveta nova — o estudo, o
   funil, os estados, as famílias — é a parte seguinte da fatia. Por isso a
   segunda linha de cada critério diz o estado em palavras, sem os números
   do funil, e mostra o tipo de hoje no lugar da família.
7. **Critério desligado** aparece como "desligado" (o protótipo não tinha o
   caso).
8. **O quadro novo** nasce "Quadro novo", abre com o foco no nome, e o
   contorno se ajusta na tela do desenho.
9. **Canal pausado** não oferece "+ critério" nem "Atualizar quadro".
10. **Na lista de canais** ficou o cartão do console de hoje, com as
    pastilhas novas ("N quadros", "cena descrita" ou "falta a cena").

### O que não entrou

- A gaveta nova do critério (estudo, funil, estados, famílias) e a proposta
  do estudo pelo sistema.
- O "ir para" (Ctrl K).
- "Quadro" no lugar de "área" nas telas de Análises e do Painel (os dados
  continuam chegando como "área").
- Copiar os quadros, a cena e os critérios de um canal para outro igual — a
  ilha de montagem da loja tem duas frentes com as mesmas medidas.

### O que não foi medido

- Com a loja de verdade: a tela foi conferida num navegador, contra a API
  local e uma loja inventada (214 conferências, 16 larguras de 320 a 1920
  px, tema claro e escuro, com e sem a gaveta). A migration foi conferida no
  banco local e num esquema de teste com os casos de antes.

## 09/10/2026 · A gaveta nova do critério: as famílias, o estudo, o funil e os estados

A19, onda 1 — a segunda parte das telas da fatia 1.5 (migration 035). É a
gaveta do protótipo aprovado em 09/10, com as quatro abas: "O critério", "O
funil", "Estado" e "Aviso".

### Por quê

Os estados (fatia 1.2) e o estudo com o funil (fatia 1.3) já existiam no
servidor e no agente, e não tinham tela: o critério ainda abria a gaveta de
antes, que não mostra nenhum dos dois. Sem tela ninguém escreve um estudo,
ninguém vê quantas vezes por dia o gatilho acontece, e "observar → ensaiar"
não sai do papel.

### As famílias (migration 035)

O plano troca os cinco tipos por quatro **famílias** — o que o critério
pergunta: **estado** (como está?), **acontecimento** (aconteceu? alguém
fez?), **processo** (foi feito como manda?) e **medida** (quanto? por quanto
tempo?). Presença, contagem e a comparação com a foto padrão continuam: são
**formas de conferir um Estado**.

- A coluna `regra.familia` guarda a família; vazia vale a **natural do
  tipo** (`acao` é acontecimento; os outros quatro são estado). **A
  migration não muda critério nenhum**, e a configuração de loja nenhuma
  sobe de versão: nada de família desce para o agente.
- **Só a família Estado tem juiz hoje.** As outras três chegam com a
  sequência (onda 2) e com a leitura da bancada. Até lá o critério delas **só
  observa** — conta as olhadas, o contexto e o gatilho, sem julgar —, e é
  guardado com o tipo de texto livre (`acao`), que o agente já conhece.
- **A regra está no banco** (`regra_familia_cabe_no_tipo`): estado vai com os
  quatro jeitos de conferir; as outras três, só com `acao`.
- O servidor recusa: a família que não cabe no tipo (422); levar a "em
  ensaio" um critério de família sem juiz, ao criar e ao editar
  (`422 familia_so_observa`, com a frase de quando o julgamento chega); e
  levar a uma família sem juiz um critério que está julgando, a não ser
  descendo a "observando" no mesmo pedido.
- **O critério de ação de antes das famílias, que já julgava, continua como
  está** — julgado pelo texto, como sempre. Só a troca é recusada: quem não
  muda de estado nem de família não é barrado. Se descer a "observando", não
  volta ao ensaio antes de a família dele ter juiz.
- Quem troca o tipo sem dizer a família fica com a natural do tipo novo;
  mandar o mesmo tipo de volta (a gaveta manda o tipo em todo salvar) não
  troca a família guardada.

### Nascer observando — e ligado

Até aqui todo critério nascia desligado. O critério criado pela gaveta nova
nasce **observando e ligado**: observar não julga, não gasta e não avisa, e
desligado ele não contaria nada — o funil ficaria em branco, que é
justamente o que se quer ver antes de decidir julgar. O cadastro de antes
(quem cria sem dizer o estado) continua nascendo valendo e desligado, e o
que nasce "em ensaio" também nasce desligado. `ativa` no pedido de criação
não manda: quem decide é o estado.

### O que a tela do canal passou a receber

De cada critério, em cada lugar (`GET /v1/pontos/:id`): a família, se o
estudo está **confirmado**, e os números do funil **naquele lugar** nos
últimos 7 dias — olhadas, com gatilho, julgadas, fora do critério. É a mesma
conta e a mesma permissão do funil do critério (supervisão para cima, e o
suporte): quem não pode ver recebe o canal sem número nenhum. Os dias são
os do **relógio da loja**, e é uma consulta para o canal inteiro.

Na árvore "onde cada critério vale", a segunda linha de cada critério diz a
família (ou, num Estado, a forma de conferir) e esses números: "estado · 130
julgadas de 2.880 olhadas · 11 fora"; quem só observa mostra os gatilhos
("270 gatilhos em 270 olhadas · ainda não julga").

### A gaveta

- **O critério** — o nome, o texto ("como você explicaria a um funcionário
  novo"), a família, a forma de conferir (num Estado), onde vale, em que
  horário, e **o estudo**: as seis partes (contexto, gatilho, janela, ação,
  desfecho, fora de contexto). O contexto e o gatilho têm, além do texto, as
  **condições que a loja confere sozinha, de graça**: um sinal (há alguém,
  está tudo parado, parou de se mexer, de tempos em tempos, está diferente
  da foto padrão…) num lugar (onde o critério vale, a imagem completa, ou um
  quadro do mesmo canal). O estudo começa por um de quatro **modelos** ou do
  zero; só o **confirmado** vale — o rascunho fica guardado e não muda nada.
- **O funil** — olhadas → com contexto → com gatilho → julgadas → fora do
  critério, dos últimos 7 dias; o que não entrou no funil; quantas vezes por
  dia o gatilho acontece; e quanto custa (ou custaria) por dia.
- **Estado** — observando · em ensaio · medido · valendo, e o interruptor
  de ligado/desligado. A troca fica marcada e **vale ao salvar**.
- **Aviso** — prioridade, gravidade, confiança, silêncio e "avisar só se
  continuar", como já eram.

Salvar são até duas idas ao servidor — o critério e, se mudou, o estudo. Se
a segunda falhar, o critério já está salvo e a mensagem diz; a gaveta nunca
apaga um estudo que não conseguiu ler. **Quem não configura abre a gaveta
para ler**: os campos ficam travados, o rodapé só tem "Fechar", e o funil
aparece para quem pode vê-lo.

### A tela só afirma o que é verdade

- **Para onde vai o texto do critério**, caso a caso: enquanto só observa,
  a nenhum modelo; em presença e contagem, a nenhum modelo; em comparação,
  só quando a cena não é igual à foto padrão; nos outros, ao modelo, como
  pergunta.
- **O custo.** "Por dia, no máximo, quando julgar" é o teto — gatilhos por
  dia × o preço **medido** de uma análise na nuvem (do critério ou, na
  falta, da loja), e a tela diz de onde ele vem. Sem preço medido aparece
  "—": número inventado não entra. No critério que já julga, o custo é a
  média dos dias **em que houve olhada** (dividir pelos sete diria um dia
  mais barato do que ele é).
- **"Passar para em ensaio"** diz o que custa antes de salvar, e que não
  avisa ninguém. "Medido" e "valendo" não têm botão: só se chega lá com o
  acerto medido, e o banco de provas é a onda 2.
- **Descer de "valendo" não é oferecido.** Não há caminho de volta antes do
  banco de provas, e um toque errado deixaria a loja sem o aviso. Para parar
  um aviso, desliga-se o critério — ali mesmo —, e ligar de novo volta a
  avisar.
- **O critério de antes das famílias** é dito como é: "já era julgado antes
  de as famílias existirem, e continua". Em ensaio, a gaveta avisa antes do
  clique que voltar a só observar não tem volta.
- **Família sem juiz fica fora de alcance enquanto o critério julga** — é a
  recusa do servidor, mostrada antes. A que está guardada continua ao
  alcance (clicou em outra por engano: dá para voltar).
- **O estudo na loja.** A gaveta avisa quando o computador da loja ainda
  não sabe usar o estudo (pelo que o agente declara, migration 033): ele
  fica guardado e passa a valer quando o programa de lá for atualizado. Em
  presença e contagem o estudo guarda só os textos: são conferidas na loja
  em toda olhada.

### Onde a gaveta diverge do protótipo aprovado

1. **"Propor o estudo" não entrou.** No lugar dele: "Começar por um modelo"
   (com alguém no lugar, com o lugar livre, quando o lugar para, de tempos em
   tempos) e "Escrever do zero". A proposta — por regras, no servidor,
   primeiro — é a parte seguinte.
2. **O contexto e o gatilho têm editor de condições** (o sinal e o lugar).
   No protótipo o "pelo sinal: …" era resultado da proposta. Sem a proposta
   não há a pastilha "a câmera não vê" nem a "Sugestão".
3. **A aba "O critério" guarda os campos da gaveta de antes** que o
   protótipo não mostrava e de que o critério precisa: a forma de conferir,
   o que o detector procura, onde vale, o horário e a faixa de horas, a foto
   padrão.
4. **"Sem estudo confirmado, conferir"** — o "quando vale a pena conferir" de
   antes continua valendo enquanto o critério não tem estudo confirmado, e
   aparece só nesse caso.
5. **O funil mostra os últimos 7 dias**, no relógio da loja (o protótipo
   dizia "últimas 24 horas"), sem o "uma olhada a cada N s". Ganhou a linha
   do que não entrou no funil, e "vezes por dia" é a média dos dias inteiros.
6. **Estado:** não há "Parar de avisar (voltar a em ensaio)" nem o botão
   "Medir" apagado (o texto do passo diz o que falta); a troca vale ao
   salvar (no protótipo valia no clique); e o interruptor de
   ligado/desligado mora nesta aba (o protótipo não tinha).
7. **O passo "em ensaio"** diz "daqui só sobe com o acerto medido — pelo
   banco de provas"; o protótipo dizia "quando você marcou acertou ou errou
   num número mínimo de exemplos", que é a onda 2.
8. **Aviso** tem os campos de hoje, editáveis (o protótipo mostrava uma
   lista só para ler).
9. **Trocar de família com o critério julgando:** as famílias sem juiz
   ficam travadas (o protótipo deixava escolher e avisava depois).
10. **Na árvore do canal**, os números são dos últimos 7 dias, e um Estado
    mostra a forma de conferir ("presença", "contra a foto padrão") no lugar
    da palavra "estado".
11. **Na linha de condição**, o sinal e o lugar ficam um embaixo do outro:
    lado a lado, na largura da gaveta, o seletor cortava o texto.

### O que muda para quem cria critério — e nas telas que já existiam

**Até o banco de provas (onda 2), nenhum critério NOVO chega a "valendo".**
É a regra aprovada — observar, ensaiar, medir, avisar —, agora valendo em
toda tela que cria critério. Os critérios que já avisam continuam avisando.
O critério novo conta ("observando") e, quando quem configura decide, julga
e mostra nas análises ("em ensaio"); aviso, só com o acerto medido.

Por isso três telas que já existiam mudaram de texto:

- **Padrões → "É problema".** A opção "Criar um critério que avisa quando
  repetir — nasce desligado: você revisa e liga" passou a "Criar um critério
  para acompanhar — nasce observando: conta, sem julgar e sem avisar. Na aba
  Estado dele você passa a 'em ensaio', que julga e mostra". A frase que o
  servidor guarda na revisão também: "…que nasce observando: conta, sem
  avisar" (as revisões de antes guardam a frase de então). As três frases
  foram levadas ao protótipo do console (`mockups/farol-console.html`).
- **Padrões (sugestões) e Inventário ("o que vale conferir").** O critério
  criado a partir deles abre na gaveta nova, com o que a sugestão trouxe (a
  contagem e a faixa de horas; a área livre e a foto padrão), e nasce
  observando e ligado.
- **A planta e a tela do desenho.** A etiqueta de cada critério dizia
  "ligado" (em verde) ou "desligado". Com critério nascendo ligado e só
  observando, passou a dizer o estado — "observando", "em ensaio",
  "valendo" —, como a árvore do canal: verde só no que avisa.

### O que não entrou

- A proposta do estudo pelo sistema ("Propor o estudo").
- O "ir para" (Ctrl K).
- "Quadro" no lugar de "área" nas telas de Análises e do Painel.
- "Parar de avisar" como volta a "em ensaio": depende do banco de provas.
- No cartão "Critérios ligados" da página da loja, dizer quantos dos ligados
  só observam.

### Achados no caminho

- Na gaveta do critério, numa tela de 320 px, a dica "imagem completa e N
  quadros · escolha onde" (da árvore "Onde vale", texto da entrega anterior)
  empurrava a gaveta 8 px para o lado. A dica passou a descer de linha.
- As consultas do funil sobre os resumos por hora — a do critério, no ar
  desde a fatia 1.3, e a nova, da tela do canal — não filtravam pela loja, e
  os índices da tabela começam por ela. Com a tabela pequena não aparece;
  com muitas lojas, cada abertura de tela leria os resumos de todas. As três
  consultas ganharam o filtro (conferido pelo plano de execução; o resultado
  é o mesmo).
- Em Padrões, "Ver a foto padrão" tinha passado a cair na tela do canal (na
  entrega anterior), um clique antes da foto. Voltou a abrir a tela do
  desenho, que é onde a foto padrão mora.

### O que não foi medido

- Com a loja de verdade: as telas foram conferidas num navegador, contra a
  API local, o build de produção do console e lojas inventadas — 780
  conferências na tela do canal e na gaveta do critério (16 larguras, de 320
  a 1920 px, com a gaveta aberta em cada aba; tema claro e escuro; quatro
  defeitos plantados de propósito, todos pegos), mais os roteiros das telas
  que abrem a mesma gaveta: Padrões (730) e Inventário (246). As regras do
  servidor e a migration: 96 mutações, 96 pegas pelos testes.
- Na loja não há estudo escrito (não havia tela para isso), e a
  configuração que desce para ela (lida em 09/10, versão 127) tem dois
  critérios ligados, os dois de presença e valendo. Os números do funil que
  a tela vai mostrar lá são os desses critérios, sem estudo: nenhum critério
  da loja passou ainda por "observando" ou "em ensaio".

## 09/10/2026 · O "ir para" (Ctrl K), e o foco que volta a quem abriu

A19, onda 1 — a última peça das telas da fatia 1.5, do protótipo aprovado
em 09/10. Sem migration, e nada muda no servidor.

### O que entrou

- **A paleta.** O botão **Ir para…** (no menu lateral; no celular, uma lupa
  no topo) e o atalho **Ctrl K** (ou ⌘ K) abrem um campo de busca com uma
  lista: as telas da loja, os canais e os critérios de cada canal.
- **Escolher um critério abre o canal já com a gaveta dele.** O critério que
  vale em dois canais aparece nos dois, e quem procura escolhe em qual quer
  abrir. O que não vale em canal nenhum leva à tela de critérios, onde fica
  o "Sem canal".
- **A busca** não liga para acento nem para maiúscula, e aceita várias
  palavras em qualquer ordem: "montagem limpa" acha "Bancada limpa entre
  pedidos", do canal Montagem 1.
- **O teclado:** as setas escolhem (e dão a volta), Home e End vão às
  pontas, Enter vai, Esc fecha. O foco não sai do campo; o leitor de tela
  ouve a opção ativa.
- **Fora de uma loja** (na lista de lojas), a paleta lista as lojas.
- **Quem não vê Análises e Orçamento no menu não os vê na paleta** — é a
  mesma regra do menu, e quem decide de fato é a API.
- Os canais e os critérios saem do servidor na hora em que a paleta abre. Se
  os critérios não chegarem, a paleta diz e segue servindo para as telas e
  os canais.
- Na tela do canal, o endereço com `?criterio=<id>` abre a gaveta daquele
  critério e volta a ser o endereço do canal: recarregar não reabre nada. Se
  o critério não vale mais ali, a tela diz.

### O foco volta a quem abriu

*Achado pelo roteiro da paleta:* ao fechar — a paleta, e também **toda
gaveta e todo diálogo do console** —, o foco caía na página, e quem usa o
teclado perdia o lugar. O `<dialog>` do navegador devolve o foco sozinho ao
ser fechado, mas a limpeza que o fechava rodava depois de o React já ter
tirado o elemento da página. Passou a rodar antes (efeito de layout, na
peça compartilhada): o foco volta ao botão, ou à linha da lista, que abriu.

E o menu "⋯" passou a devolver o foco ao botão dele quando um item é
escolhido: a gaveta (ou o diálogo) que o item abre guarda esse botão como
"quem abriu", e é para ele que o foco volta ao fechar. Antes o item sumia
com o foco. O que cada gaveta faz ao ABRIR não mudou: o nome no critério
novo, o botão de excluir na gaveta aberta para excluir, o "Cancelar" no
diálogo de exclusão.

### Onde diverge do protótipo

1. **O botão mora no menu lateral** (no celular, no topo): o console de hoje
   não tem a barra de cima do protótipo.
2. **A lista tem também as telas da loja** — as do menu e as que moram
   dentro delas (Padrões, Planta, Inventário). O protótipo, que só tem a
   tela de canais, lista "Canais".
3. **A busca aceita várias palavras.**
4. **Com uma gaveta ou um diálogo aberto, o atalho não faz nada:** a tela de
   baixo está inerte, e a paleta não se empilha por cima.
5. **"Ctrl K" aparece escrito só na coluna larga do menu;** no trilho do
   tablet e no celular fica o botão.

### O que não entrou

- Os quadros na lista (o protótipo também não os lista).
- "Quadro" no lugar de "área" nos textos de Análises e do Painel: é uma
  limpeza de vocabulário à parte, palavra por palavra ("área" também é
  palavra da cozinha).
- *Visto no caminho, e não mexido:* a tabela do Painel rola para o lado
  entre 820 e 1.280 px de largura quando a loja tem muitos critérios. É a
  peça de tabela de antes; fica anotado.

### O que não foi medido

- Com a loja de verdade. A paleta foi conferida num navegador, contra o
  build de produção e uma loja inventada: 218 conferências (o botão, o
  atalho, a lista contra o que a API devolve, a busca, o teclado, ir a uma
  tela, a um canal e a um critério, quem só vê, e 16 larguras de 320 a 1.920
  px). E, por ter mexido na peça dos diálogos e dos menus, os roteiros das
  telas que a usam rodaram de novo — a gaveta do critério (782),
  Padrões (730) e Inventário (246) —, mais um roteiro só do
  foco, ao abrir e ao fechar, pela linha, pelo menu e pelo "+ critério" (36).

## 10/10/2026 · A revisão na dúvida é uma busca pelo meio no gravador (pedido do dono, medido)

O dono, ao ler a rodada 4 do teste das fichas: quando a leitura perder uma etapa, ou não
tiver confiança de que um ingrediente entrou, **rever no gravador só o trecho que ficou sem
análise antes de emitir o alerta do erro**. E como: "não é necessário puxar todos os segundos
do intervalo. Puxa o valor do meio (…) como se fosse uma busca, vai ganhar desempenho"; "a
ideia é reduzir, para não ter tantos frames a carregar sem necessidade só para achar um ponto
que passou pelo intervalo".

### O que fica valendo

- **A revisão é uma busca, não uma releitura.** Entre a olhada em que a tampa está nua e a
  olhada em que está coberta, o agente pede ao gravador o bloco de 2 s do meio, escolhe na
  loja o quadro parado e julga só esse. Nua: o molho, se houve, veio depois; coberta: veio
  antes; molho à vista: achou, e não há erro a avisar.
- **Dizer que NÃO houve pede a janela da mão.** Quando a busca aperta a dúvida sem achar o
  molho, sobra a janela em que a mão está sobre a tampa; dela sai a grade de 6 quadros com a
  pergunta "o que foi posto, e com que utensílio".
- **O pedido ao gravador é o de arquivo** ("baixar por horário"), em blocos de 2 s — e nunca
  se repete um pedido recusado: a conta é a mesma do ao vivo.
- **Entra com o "olhar para trás" da onda 2** e serve à leitura da bancada (ondas 4 e 5).
  Nada foi ligado nem implementado agora.

### O que foi medido

Na loja, na madrugada de 10/10, só com leitura da gravação (rodada 5 de
`docs/teste-das-fichas.md`): um passo leva cerca de 3,3 s — 1,9 s para baixar o bloco, 0,2 s
para decodificar, 1,2 s para julgar; nos dois lotes em que o molho foi posto e coberto
bastou **um passo**; no lote sem molho, dois blocos e uma grade (cerca de 7 s). Tocar 10 s de
gravação leva de 11 a 13 s, e baixá-los inteiros, de 5 a 7 s. O juízo dos quadros escolhidos
pela loja: 87 de 90 leituras certas, as 30 de molho todas certas; as três erradas, de um
quadro só, vieram com a menor confiança da rodada. Custo: R$ 0,11.

### O que não muda

- Erro de procedimento continua **triagem, com revisão de gente**; nenhum aviso sai antes do
  banco de provas.
- Sem a ficha do lanche, "sem molho" não é erro nem acerto.

### O que não foi medido

- O laço automático (os passos foram refeitos sobre blocos já baixados e julgados um a um).
- A loja achar sozinha onde está a tampa: o alvo foi apontado à mão.
- Depois da troca do cabo: a rede da loja está presa em 10 Mbit/s, e baixar é a maior parte
  do passo.
- Lanche montado sobre papel indo a juízo; molho coberto em menos de 2 s; molho claro sobre
  pão claro; o juiz local do molho em cima do quadro que a busca escolhe.

## 10/10/2026 · A rotina de montagem é pista, não regra (dito pelo dono; conferido na gravação)

O dono, depois de ler a rodada 5 do teste das fichas: "os colaboradores têm manias, cada um
diferente do outro, pode ter uma ordem diferente; porém na maioria das vezes vão usar a
mesma rotina: pão, molho, alface, carne, queijo, carne, queijo. Os produtos que tiverem
esses itens na ficha técnica vão ter um padrão de ordem de montagem, ajudando nossa análise
e entendimento."

### O que fica valendo

- **A conferência continua por conjunto** (09/10: "a ordem não é importante, e sim todos os
  ingredientes"). Ordem diferente não é erro.
- **A rotina é o que se espera a seguir.** Com a ficha (o conjunto) e a rotina (a ordem),
  cada posição tem um roteiro: a leitura pergunta "entrou o que vinha agora?", sabe o que
  cobre o quê e sabe quando desconfiar de que perdeu uma etapa. Montagem fora da rotina
  **abre a revisão** (a busca no gravador, entrada anterior); não é o veredito.
- **A rotina mora no dicionário de ingredientes da loja**, junto da regra do molho: para
  cada ingrediente, em que pão entra (tampa ou base) e depois de quê. Vale para todo
  produto cuja ficha tenha aqueles itens.
- **Aprende-se por produto, olhando.** Em "observando", com o pedido dizendo qual produto
  está em preparo, o sistema anota a ordem em que cada item entrou e guarda a rotina mais
  comum e as variações. Por produto (e por turno, se servir) — **não por pessoa**: o Farol
  não reconhece quem monta. Se um dia interessar por colaborador, viria da escala do Regem,
  e é decisão do dono.

### O que a gravação mostra (os três lotes lidos do começo ao fim)

| lote | a ordem em que entrou |
|---|---|
| 08/10, 21h42 — cinco lanches, em folhas e caixa | pães → carnes → molho → alface → queijo |
| 09/10, 19h51 — duas caixas | pães → molho → alface → carne → queijo (**a rotina do dono**) |
| 09/10, 19h54 — três folhas | pães → carne → queijo → molho → … → alface, 75 s depois do molho |

- **Dentro de cada pão a ordem não mudou em nenhum:** na tampa, o molho antes da alface —
  nas 10 tampas em que o molho foi visto entrar, ele foi o primeiro; na base, a carne antes
  do queijo dela, e no pão de um corte, carne, queijo, carne, queijo na mesma base (08/10,
  21h40).
- **O que mudou foi qual lado vem primeiro:** a tampa em um lote, as carnes em dois — na
  mesma noite, com três minutos de diferença.
- Três lotes não dizem "a maioria". Dizem que a parte firme da rotina é a de cada pão.

### O que a rotina muda na leitura

1. **A pergunta fica estreita:** "entrou o molho?", e não "o que há aqui?". Mais barata e
   mais certa (rodada 3: de 8 para 12 leituras certas em 12 quando a regra do molho foi
   escrita no dicionário).
2. **A dúvida nasce da rotina:** chegou a alface e o molho não foi visto.
3. **A revisão sabe onde olhar:** o último quadro parado antes de a cobertura entrar. Relida
   assim, a rodada 5 se resolvia com um quadro em cada uma das três dúvidas.
4. **Nem toda tampa pede revisão:** onde a alface só vem no fim (19h54: 75 s depois), o
   molho fica à vista e a olhada comum pega. O caso apertado é o de quem põe a alface em
   seguida (5 a 8 s nas caixas das 19h51).

### O que não foi medido

- Quantas vezes a rotina é seguida, por produto: pede as fichas, o pedido e uma semana em
  "observando".
- A rotina dos outros itens — bacon, picles, ovo, cebola crispy e ao shoyu, maionese,
  mostarda: o dono diz.
- Reconhecer sem nuvem que a tampa "já foi coberta" (indício: a alface mudou 21% e 27% do
  recorte da tampa, contra 9% e 10% do creme — duas posições).

## 10/10/2026 · A embalagem diz o destino do pedido (dito pelo dono)

O dono: "a caixa é quando o pedido sai para viagem; quando é embalado só no papel kraft
(marrom), o pedido é para consumo no local (mesa)."

### O que fica valendo

- **Caixa = viagem; só o papel kraft = mesa.** É regra da casa, como a do molho e a rotina:
  vai para o dicionário da loja.
- **O destino aparece antes do primeiro ingrediente:** a posição nasce como caixa aberta ou
  como folha de papel. Com isso a leitura (a) separa, entre os pedidos em preparo, os de
  viagem dos de mesa — menos candidatos para casar com cada posição; (b) conta a produção e
  o tempo por destino; (c) acusa "pedido de viagem montado no papel", ou o contrário — como
  triagem, igual a qualquer outro erro de procedimento.
- **A embalagem diz também onde está a tampa.** Na caixa, a tampa do pão fica na metade de
  cima (a tampa da caixa) e a base na de baixo: foi assim nas quatro caixas lidas em 09/10 e
  na de 08/10. Achar a caixa aberta — um quadrado branco grande — dá a posição da tampa sem
  ninguém apontar, que é o que faltava à revisão pelo gravador. No papel os discos ficam
  lado a lado, e a tampa é o disco que recebe o molho.

### O que a gravação mostra

- 09/10: às 19h51, duas caixas; às 19h54, três lanches no papel kraft, embrulhados e marcados
  à caneta; às 23h50 e às 23h57, uma caixa cada; às 23h52, dois no papel.
- 08/10, 21h42: três lanches montados sobre folhas, embrulhados no papel impresso e postos em
  **caixinhas de papelão**; e um na caixa branca. Falta o dono dizer se o embrulho que vai
  para a caixinha de papelão é viagem.

### O que não foi medido

- A loja reconhecer sozinha "caixa" × "papel" e achar a tampa por aí.
- Quantos pedidos de cada destino por noite.
- A embalagem contra o pedido: pede o pedido, que só chega com o Regem na loja.

## 10/10/2026 · O Farol é para distribuir; as fichas vêm do Regem para base própria; o saldo de produção; a planta viva (dito pelo dono)

Cinco coisas ditas pelo dono na madrugada de 10/10, depois das regras da casa.

### 1. O piloto não vira regra do motor

"É um projeto que estamos produzindo para o Mister Burguer, que está sendo nossa cobaia para
teste e produção; porém é um projeto para distribuição. (…) outros casos não vão ter as
mesmas condições que temos no Mister Burguer; por isso temos que fazer de uma forma a se
adaptar a vários tipos de situações para controle."

Fica valendo, para tudo o que vier:

- **O motor** é igual para todo cliente: posição de montagem, item, acontecimento, roteiro
  esperado, a revisão pelo gravador, o saldo demanda × produção, os juízes, o banco de
  provas.
- **O perfil da loja** é cadastro — o sistema propõe, o responsável confirma: fichas,
  dicionário de ingredientes, bases de montagem (tipos, o que significam, onde fica cada
  parte), regras da casa, filas e bancadas. **Toda regra da casa entra aqui**, nunca no
  código do motor: molho primeiro na tampa, a rotina, caixa = viagem, um queijo por carne.
- **Os adaptadores** são por instalação: de onde vêm fichas e pedidos, o que o gravador
  entrega (medido na instalação, guardado na base de equipamentos), para onde vai o aviso.
- **Degraus pelo que o cliente tem:** só câmeras → com fichas → com pedidos → com todas as
  bancadas de uma fila cobertas. Cada degrau entrega algo sozinho.

### 2. As fichas: o Farol puxa do Regem e guarda base própria

"Não precisa ingredientes na fila de produção. Na integração Farol e Regem o Farol já puxa
as fichas técnicas e seus produtos, e fica com base própria de consulta; se não for viável
usar dessa forma, vemos uma forma de o Regem repassar."

Muda o plano de 09/10, em que cada item da fila levaria a lista de ingredientes. Agora:

- o Farol **copia** fichas, produtos e adicionais de cada loja e consulta a própria cópia;
- da fila de produção ele precisa só de **qual produto, quantos, com que adicionais e
  observação, para onde vai e a que horas** — e de saber quando ficou pronto;
- "base própria" serve também à loja sem Regem: a mesma base recebe fichas de planilha.

O que o Regem já tem e o que falta para isso está em
[controle-de-producao.md](controle-de-producao.md), seção 6. No Regem, o plano vem antes do
código.

### 3. O saldo de produção

A ideia do dono — agrupar os pedidos do KDS por produto, subtrair o que a montagem conclui,
somar o que chega, e avisar do especial que demora — é o livro-caixa do estudo de 07/10.
Avaliada em [controle-de-producao.md](controle-de-producao.md): fica como espinha, com
cinco ajustes (o principal: **a câmera confere o KDS, não dá baixa nele**) e oito
possibilidades de controle de produção, a começar pela demanda por ingrediente crítico, que
não pede câmera.

### 4. Três respostas

- **Queijo em dobro é só adicional.** O geral é um queijo por carne; uma carne com dois
  queijos é raro. A caixa de 08/10 com quatro fatias era, então, adicional — ou erro: com o
  pedido em mãos, o sistema saberá.
- **Não há regra de "em lote" ou "lanche por lanche".** A lista do KDS nem sempre é seguida:
  há produto mais demorado, e há hora em que um tipo de carne ainda não está pronto no
  conservador.
- **A rotina dos outros itens** (bacon, picles, ovo, cebola, maionese) vem com as fichas.

### 5. A planta viva: o ambiente em 3D, com as pessoas

"A nossa planta é algo de muito valor no projeto. Ela define o ambiente; vamos colocar
representações com identificação dos colaboradores simulando seus passos durante o
expediente, para análise de dados de seus movimentos e controle das ações para tomada de
decisões. A ideia é que uma análise gráfica do ambiente vai ser gerada em formato 3D de
acordo com as imagens das câmeras, que geralmente são espalhadas para cobrir o ambiente e
não deixar pontos cegos, e com isso conseguimos montar o ambiente (como num jogo online)."

Vieram quatro imagens de referência — "não para seguir fielmente, e sim para representar a
ideia": a tela da Planta de hoje, ainda vazia na loja, e um ensaio dele em três vistas — a
planta com os cones de cada câmera, as pessoas com nome e os trajetos, e uma barra de
números (área, cobertura, câmeras, pessoas em cena, fora do critério); o mesmo ambiente em
3D, girável, com cones e pessoas; e a imagem de cada canal simulada a partir da planta,
para conferir o enquadramento antes de instalar. E a régua: "quando for produzir, usar o
máximo de recurso para produzir algo de maior qualidade e detalhes".

Fica valendo:

- **A planta passa a ser uma das faces principais do produto**, não um cadastro de apoio:
  o ambiente em 2D e em 3D, as câmeras e o que cada uma cobre, e as pessoas se movendo — ao
  vivo e no replay do expediente.
- É a junção das ondas 9 (o ambiente que calcula) e 10 (a pessoa na planta), com acabamento
  mais alto. Entra pelo caminho de toda tela: plano, protótipo aprovado, código.

**Primeira leitura, a confirmar no estudo** — nada disto foi medido:

| parte | dá? | como |
|---|---|---|
| a planta em 3D, com acabamento de jogo | sim | a planta desenhada ganha volume; os equipamentos vêm de uma biblioteca de peças; é trabalho de desenho e de tela |
| a imagem de cada câmera simulada a partir da planta | sim | serve para decidir onde pôr a câmera antes de furar a parede. Pede a inclinação de cada câmera e o ângulo da lente de cada modelo. *(Corrigido no mesmo dia: eu tinha escrito que a base de equipamentos "já guarda a lente de cada modelo"; ela guarda a lente em milímetros de 8 dos 16 modelos, e de nenhum o ângulo — a abertura é posta à mão na planta.)* |
| montar o ambiente a partir das imagens das câmeras | em parte | cada câmera, calibrada, projeta o piso que ela vê sobre a planta: sai um mosaico visto de cima, para desenhar por cima e conferir. O volume inteiro, sozinho, a partir de poucas câmeras fixas, não é confiável hoje; para o ambiente fiel, o caminho é uma filmagem da loja com o celular |
| as pessoas na planta, ao vivo | sim, com erro a medir | detecção nas câmeras de canto e o pé de cada pessoa projetado no piso. Na câmera de cima o detector de hoje não serve (medido: 15% de certeza) |
| cada pessoa com o nome, o expediente inteiro | é a parte difícil | manter "quem é quem" por horas, numa cozinha apertada e de uniforme igual, falha sem âncoras. As que não pedem reconhecer rosto: o ponto e a escala do Regem (quem bateu o ponto, quem está escalado em qual posto), o posto fixo, um sinal no uniforme |

- **Uma decisão do dono molda o desenho: de onde vem a identidade** — do ponto e da escala
  (o que eu recomendo), de um sinal no uniforme, ou do rosto, que é dado biométrico: o mais
  delicado na lei e o que pior funciona com câmera alta. A LGPD segue para o final, como ele
  definiu; esta escolha é de desenho.
- **O que o projeto já tinha escrito** (`FAROL-Mapeamento-Arquitetura-e-Orcamento.md`, §10.4
  e §18): "o Farol não identifica pessoas", a responsabilização vem de cruzar o evento com a
  escala do Regem, e a base legal de auditoria de processo "não cobre avaliação de
  produtividade individual". **O nome na planta cabe nessa posição se vier da escala e do
  ponto** — o Farol acompanha figuras, e quem dá o nome é o Regem. Acompanhar os passos de
  cada pessoa o expediente inteiro já é avaliação individual: é decisão do dono, e muda o
  desenho desde o começo — o que se guarda por pessoa, quem pode ver, por quanto tempo. A
  proposta: o padrão é por posto e sem nome; o nome é uma opção que o cliente liga.
- **Muita análise não precisa de nome:** mapa de calor, fluxo, tempo em cada posto, posto
  vazio, idas e vindas entre a chapa e a montagem. O nome entra por cima.
- **É o mesmo motor para qualquer loja:** a planta, a calibração de cada câmera e a
  biblioteca de peças são perfil da loja; projetar, acompanhar e desenhar são do motor.
- **A primeira prova é barata e sem nuvem:** calibrar duas ou três câmeras de canto do
  piloto por quatro pontos e medir o erro de posição, e por quanto tempo um trajeto se
  mantém.

### O que não muda

- Nada foi ligado nem implementado. As ondas seguem na ordem aprovada; as duas listas do
  que falta — a do Farol e a do dono — estão no roadmap, logo depois da tabela das ondas.

## 10/10/2026 · O sistema propõe o estudo do critério — por regras, no servidor (a onda 1 fecha)

O protótipo aprovado em 09/10 tem o botão "Propor o estudo": "A partir do seu texto, deste
canal e destes quadros, o sistema propõe as seis partes e liga cada condição a um sinal que a
loja já dá. Você confirma ou corrige." Faltava decidir **quem** propõe. O plano de 08/10
falava em pedir ao computador da loja, como a descrição de um equipamento (com modelo de
nuvem); a recomendação levada ao dono foi começar **por regras, no servidor**. Em 10/10 ele
mandou seguir com o que era da minha parte, e a fatia saiu pelo caminho recomendado. Se ele
preferir outro, o botão é o mesmo: troca-se quem responde.

### O que fica valendo

1. **A proposta é por regras e mora no servidor** (`api/src/proposta-do-estudo.ts`; a rota é
   `POST /v1/lojas/:id/estudo-proposto`). Não vai a modelo nenhum, não custa nada, responde
   na hora, não depende do computador da loja estar ligado, e a mesma entrada dá sempre a
   mesma proposta.
2. **Pedir a proposta não grava nada.** Ela vale para o critério como está na gaveta — salvo
   ou ainda não — e volta como **rascunho**: nunca confirmado. Só entra no banco quando a
   pessoa salva o critério, e só o estudo confirmado desce para a loja (regra de 09/10).
3. **O assunto sai do texto; o sinal sai do lugar.** O vocabulário é de cozinha e de loja em
   geral — é dado, não regra do motor, e nada dele é do piloto (decisão de 10/10, "O piloto
   não vira regra do motor"). O lugar é lido de três coisas que a conta já tem: a **cena**
   escrita do canal (de onde a câmera olha), o **papel** de cada quadro e se o canal tem
   **foto padrão**.

| o texto fala de (exemplos de palavra) | câmera comum | a cena diz "de cima" | o critério vale em posição de montagem |
|---|---|---|---|
| o que alguém usa ou faz (touca, uniforme, luva, mãos, usar o celular) | contexto: há alguém · gatilho: alguém chegou, ou 5 min | contexto: algo se mexe · gatilho: 5 min | como "de cima", e a sugestão de mudar o critério de lugar |
| limpeza e organização (limpo, restos, sujo, organizado); aberto ou fechado, ligado ou desligado (porta, tampa, fechada) | contexto: não há ninguém · gatilho: o lugar ficou sem ninguém, ou 10 min | contexto: está tudo parado · gatilho: parou de se mexer, ou 10 min | sem contexto · gatilho: 10 min |
| abastecimento (abastecida, vazia, falta) | contexto: não há ninguém · gatilho: 15 min | contexto: está tudo parado · gatilho: 15 min | sem contexto · gatilho: 15 min |
| nenhuma palavra conhecida (o caminho geral) | contexto: não há ninguém · gatilho: parou de se mexer, ou 10 min | contexto: está tudo parado · gatilho: parou de se mexer, ou 10 min | sem contexto · gatilho: 10 min |
| comparação com a foto padrão | com foto em **todos** os canais do critério: gatilho "deixou de estar como na foto", ou 15 min, com o contexto de lugar livre da coluna; sem foto em algum: o caminho geral | idem | idem |
| acontecimento, processo ou medida | contexto: há alguém — no quadro de posto do canal, quando o critério está num canal só e ele tem um posto só · gatilho: algo se mexeu desde a olhada anterior | sem contexto · gatilho: algo se mexeu | idem |
| presença e contagem | só os seis textos: são conferidas na loja em toda olhada | idem | idem |

"A cada N minutos" conta desde a última vez que a análise abriu — é como a loja conta.

4. **Por que cada escolha** (o que a loja faz com o sinal está em `agent/farol_agent/sinais.py`
   e `motor.py`):
   - o que a loja não sabe ler **não segura**: gatilho da foto padrão em canal sem foto
     abriria a análise em toda olhada. Por isso ele só entra com foto em todos os canais;
   - de cima o detector de pessoas vê mão e braço, não gente: o sinal que serve é o
     movimento. Basta **um** canal do critério ser de cima para a proposta inteira usar
     movimento, que serve em todos;
   - em **posição de montagem** a loja já espera as mãos saírem antes de conferir. Pôr "está
     tudo parado" por cima compararia com a olhada de 30 s antes: no pico o quadro muda a
     cada olhada, e o critério nunca seria conferido. Ali a proposta não leva condição de
     lugar livre;
   - a condição que olha **outro quadro** (o posto) só entra quando o critério está num
     canal só: o quadro de um canal não existe no outro.
5. **A proposta diz o porquê.** Junto com a ficha voltam as frases do que o sistema leu ("Li
   'restos' no seu texto…") e do que ele supôs sobre a câmera ("Usei o detector de pessoas.
   Se a câmera olha de cima, troque por movimento…"; "A cena deste canal ainda não foi
   descrita…"). É o que deixa a pessoa corrigir sabendo de onde a escolha veio.
6. **"A câmera não vê" e a sugestão.** São sete coisas que nenhuma câmera de loja alcança,
   e só o que vale em qualquer instalação: o **gesto** de salgar ou temperar (o saleiro e o
   pote aparecem; o sal, não), a temperatura, a data de uma etiqueta, o cheiro, o peso, o que
   foi dito ou ouvido, e **quem** foi (o Farol não identifica pessoas). Cada uma vem com o
   motivo e com uma sugestão do que escrever no lugar. Há mais duas sugestões, de lugar:
   critério sobre o que alguém usa, marcado em posição de montagem (ali ele só é conferido
   com as mãos fora); e "lavar as mãos" sem estar num quadro de pia.
7. **As notas não são guardadas.** Saem do texto da parte "ação", pela mesma função, na
   proposta e toda vez que a ficha é lida. Valem enquanto a causa está no texto: quem segue a
   sugestão e reescreve a ação deixa de ser avisado. Nenhuma migration.
8. **Quem pede:** quem configura (gerência para cima, e o suporte). O canal de outra conta,
   de outra loja, excluído ou inexistente responde como o que não existe. No registro do
   servidor fica só o assunto que a regra achou — nunca o texto do critério —, para afinar o
   vocabulário.

### Na tela

- No critério sem estudo, o botão **"Propor o estudo"**. Sem a explicação escrita, ou sem
  canal marcado, ele trava e diz o que falta. Os modelos e "Escrever do zero" continuam,
  logo abaixo.
- Proposta feita, a ficha abre com a faixa **"Proposto pelo sistema"**, o porquê e o elo
  **"Voltar ao que estava"** — que devolve a ficha de antes da primeira proposta, mesmo
  depois de "Propor de novo", e mesmo que ela fosse um estudo confirmado.
- Ao lado da ação, o selo ("a câmera não vê", "a câmera não lê", "o Farol não ouve", "o Farol
  não diz quem") com o motivo; depois da ficha, a "Sugestão". Quem só vê lê as duas coisas
  e não tem o botão.
- As caixas de texto da ficha passam a crescer com o texto (no celular, duas linhas escondiam
  o fim da frase). Onde o navegador não sabe fazer isso, ficam como eram.

### Onde diverge do protótipo aprovado

- O protótipo escreve "pelo sinal: …" debaixo de cada parte. No console o sinal **é** a
  condição, que se escolhe e se troca ali mesmo, com "A loja confere por: …" (está assim
  desde a gaveta nova, de 09/10). As partes que não têm condição não têm linha de sinal.
- A faixa traz o porquê e o "Voltar ao que estava", que o protótipo não tinha.
- O vazio mantém os modelos e "Escrever do zero" (o protótipo mostra só o botão).
- "Propor de novo" só aparece depois de uma proposta feita naquela gaveta; numa ficha escrita
  à mão o botão diz "Propor o estudo".
- Não há o aviso "Estudo proposto…" que some sozinho: quem diz é a faixa, que recebe o foco.
- "Deste canal e destes quadros" virou "dos lugares em que o critério vale": o critério pode
  valer em vários canais.

### O que não foi medido, e o que isto não faz

- **Quantas propostas são confirmadas sem correção** — só o uso diz. Não há contador disso.
- A proposta **não lê a imagem**: do lugar ela sabe a cena escrita, o papel dos quadros e a
  foto padrão. Canal sem cena cai no detector de pessoas, e a faixa diz isso.
- "De cima" é lido da cena **por palavras** ("de cima", "zenital", "para baixo", "do teto",
  "no teto"; "de lado", "de frente", "de canto" dizem o contrário). Cena que diz de outro
  jeito não é entendida — e a frase "se a câmera olha de cima, troque por movimento" fica à
  vista para isso.
- O vocabulário é pequeno de propósito: palavra que engana ficou de fora ("salgados",
  "cachorro-quente", "câmara fria", "anéis de cebola", "à mão").
- Janela, ação e desfecho continuam sendo só texto: a loja confere o contexto e o gatilho.
- Com isto **a onda 1 fecha**. A proposta por um modelo que lê a imagem pode vir depois,
  atrás do mesmo botão.

## 10/10/2026 · O KDS "por produto, com baixa automática": um modo a mais, desligado de fábrica (dito pelo dono)

Depois de ler a avaliação do saldo de produção, o dono respondeu à ressalva "a câmera confere
o KDS, não dá baixa nele":

> a nao ser que uma mudança no kds ao exibir por pedido, colocar por produto agrupado no
> regem ja tem essa opção, e conforme identifica a produção no farol podemos por uma opção
> de diminuir automatico no kds, seria um modo de funcionar alem do kds separado por pedido
> onde o usuario avança o pedido.

### O que fica valendo

1. **O KDS ganha um modo além do "por pedido":** "por produto, com baixa automática". Nele a
   fila aparece somada por produto, e a quantidade **diminui sozinha** quando o Farol
   identifica a montagem fechada. O modo "por pedido", em que a pessoa avança o pedido,
   continua como é.
2. **É opção da loja, e nasce desligado.** A ressalva de antes vira a condição de ligar: a
   câmera identifica o produto em bem menos que 100% das vezes, e uma baixa errada esconde um
   pedido que ainda falta. O modo só é ligado, loja a loja, **com o acerto da identificação
   medido naquela loja** (o banco de provas, onda 2 em diante), e a baixa errada tem de poder
   ser desfeita com um toque.
3. **Os dois números continuam por baixo.** "No KDS" e "visto na bancada" seguem guardados
   lado a lado: é a diferença entre eles que mostra o pronto sem montagem vista, a montagem
   sem pedido e o esquecido. O modo muda o que a tela mostra e quem dá a baixa, não o que se
   mede.
4. **O que pede do lado do Regem.** Hoje o avanço é **por pedido**, e o item da fila não
   tem estado próprio nem o id do produto. O modo precisa de: o item (ou a contagem por
   produto) poder ser dado como feito; uma porta por onde o Farol entrega o **acontecimento
   de produção** (qual produto fechou, em que bancada, a que horas, com que confiança) — quem
   decide a baixa é o Regem; e o desfazer. Entra no **plano do lado do Regem**, que é
   apresentado lá antes de qualquer código.
5. **Quando:** com a identificação do produto, que é a onda 5. Antes disso não há o que
   ligar.

### O que não muda

- Nada foi ligado nem implementado. A conta só fecha com câmera em todas as bancadas da
  fila (no piloto, a outra frente da ilha ainda não tem).

## 10/10/2026 · O agente aprende a pedir ao gravador o que já foi gravado — dormindo (onda 2, fatia 2.1)

A onda 2 precisa olhar **para trás**: os segundos antes de um gatilho, o bloco do meio de um
intervalo em dúvida. O agente só sabia ver o agora. O caminho de arquivo do gravador tinha
sido medido à mão na rodada 5 ([teste-das-fichas.md](teste-das-fichas.md)); faltava o agente
saber pedi-lo sem pôr o ao vivo em risco.

### O que fica valendo

1. **Um pedido por vez, por gravador.** A vez é do aparelho (endereço e porta), não de quem
   pede: dois pedaços do agente que falam com o mesmo gravador dividem a mesma vez. Quem
   espera mais de 20 s desiste e diz que o gravador está ocupado.
2. **Pedido recusado não se repete.** A conta é a mesma do ao vivo, e o gravador trava a
   conta depois de algumas senhas erradas — aí a loja inteira fica cega. O cliente faz o
   desafio de senha à mão: um pedido sem credencial, para receber o desafio, e **um** com
   ela. Recusado, fecha a porta para aquela senha e não fala mais com o gravador até a senha
   mudar ou o agente reiniciar. "Não há gravação nesse trecho" é outra resposta, e não fecha
   nada.
3. **Nenhum número de aparelho mora no motor.** O tamanho do bloco e o atraso até a gravação
   poder ser pedida entram por um **perfil do gravador**. Sem medida, o agente não supõe
   bloco nenhum e espera 10 s, por cautela. O que se mediu de cada modelo fica na base de
   equipamentos; quem mede o perfil na instalação é o próprio agente (fatia 2.2a).
   **Corrigido na fatia 2.2a (abaixo):** a cautela passou a 3 minutos — a gravação recente
   não vem inteira.
4. **A hora do pedido é a do gravador.** O agente mede a diferença entre o relógio do
   gravador e o do computador — perguntando a hora ao próprio gravador, por HTTP —, guarda
   por 5 minutos e converte.
5. **Ou o trecho inteiro, ou nada.** O que chega cortado, maior que o teto (24 MB), fora do
   tempo (45 s) ou como página de texto no lugar do vídeo é apagado e dito como erro. Um
   pedido cobre no máximo 40 s: olhar para trás é coisa de segundos.
   **Corrigido na fatia 2.2a (abaixo):** "inteiro" aqui é o que o gravador **declarou**. Ele
   pode declarar e mandar menos vídeo do que foi pedido; se veio o vídeo todo, quem diz é
   quem lê, contando os quadros.
6. **Segredo.** Nada escreve em registro o usuário, a senha, o cabeçalho de autorização nem
   o identificador que o gravador manda no desafio (ele traz o número de série). Da senha
   recusada guarda-se só uma impressão, com sal que muda a cada vez que o agente sobe.

### O que foi medido (loja de teste, 10/10, só leitura)

| o quê | quanto |
|---|---|
| a hora do gravador, pedida por HTTP | veio em 0,58 s; o gravador estava 25,1 s adiantado em relação ao computador da loja |
| um bloco de 2 s do fluxo principal, pelo cliente novo | 529.080 bytes — o tamanho que o gravador declarou — em 1,89 s; 1,43 s até o primeiro byte |
| o leitor de vídeo do agente sobre esse bloco | 30 quadros de 1920 × 1080, em 0,29 s |

Uma medida de cada, com a rede da loja ainda presa em 10 Mbit/s. Cada chamada fez um pedido
com a credencial, e nenhum foi recusado. O arquivo foi apagado; o agente da loja seguiu de
pé — o mesmo processo desde a véspera, sem aviso nem erro no registro.

### Como foi testado

50 testes, contra um gravador de mentira que roda na própria máquina e **confere** a resposta
ao desafio de senha (um dublê que aceitasse qualquer cabeçalho não provaria a conta). Depois,
79 mutações do módulo — cada regra trocada de propósito, uma de cada vez —, as 79 pegas
pelos testes.

### O que não muda, e o que não foi medido

- **Nada chama o módulo.** A loja segue com o pacote de antes; trocar o pacote continua
  pedindo o "pode" do dono, e esta fatia não pede troca nenhuma. O cliente do ao vivo não
  foi tocado.
- Não foi medido: outro gravador que não o do piloto; horas de busca com o ao vivo aberto; o
  caminho depois do cabo novo; o desafio com SHA-256 num gravador de verdade (o do piloto
  usa MD5 — o SHA-256 está provado só contra o gravador de mentira dos testes).

## 10/10/2026 · O agente mede o que o gravador entrega, e confere o que voltou — dormindo (onda 2, fatia 2.2a)

A fatia 2.1 deixou o perfil do gravador para o agente medir. Ao escrever essa medida, a
primeira rodada dela no gravador de verdade não fechou com o que a rodada 5 dizia. Medi de
novo, pedido a pedido ([teste-das-fichas.md](teste-das-fichas.md), "O que o gravador
entrega, medido de novo"), e duas coisas que eu tinha escrito estavam erradas.

### O que a medida mostrou

1. **Da gravação que já assentou, o gravador do piloto devolve os blocos que COMEÇAM dentro
   do pedido.** Pedir 1 s a partir do começo de um bloco devolve o bloco todo; pedir o
   segundo seguinte não devolve nada. Eu tinha escrito "o pedido é arredondado para baixo
   nas duas pontas" — errado: o bloco em que o pedido começa, se já tinha começado, não vem.
2. **A gravação recente vem cortada, e o gravador não avisa.** O tamanho que ele declara
   bate com o que chega, e o vídeo tem menos do que foi pedido. Em três blocos acompanhados
   desde a gravação, o bloco só passou a vir inteiro entre 1 min e 20 s e 2 min e 15 s
   depois. Eu tinha escrito "o que foi gravado até uns 3 s antes já vem inteiro" — uma
   medida só, que deu certo uma vez.

### O que fica valendo

1. **O pedido é feito em cima dos blocos.** Começa no começo do bloco em que o intervalo
   começa — senão esse bloco não vem — e termina 1 s depois do começo do último bloco
   preciso. Um segundo, e não o bloco inteiro, de propósito: se os blocos não estiverem onde
   o perfil diz, volta um bloco a menos, e quem lê percebe pela conta dos quadros — em vez
   de receber, calado, o vídeo do segundo ao lado.
2. **Quem lê confere se o trecho veio inteiro.** Quem baixa não tem como saber. Quem lê
   conta os quadros: eram para vir tantos segundos vezes a taxa do gravador, com um quadro
   de tolerância. Não veio inteiro: quem chamou espera e pede de novo.
3. **O instante de cada quadro sai do começo do trecho e da taxa medida** — não de esticar
   os quadros entre as duas pontas, que num trecho cortado dá a hora errada.
4. **A cautela de quem não mediu é de 3 minutos** (era de 10 s). Não é número de aparelho: o
   único gravador medido levou até 2 min e 15 s, e a cautela fica acima. O agente **não
   mede** em quanto tempo a gravação assenta — varia de bloco para bloco, e medir o pior
   caso ocuparia o gravador por minutos. A conferência de verdade é a conta dos quadros.
5. **A medida do gravador é do agente, e é curta:** o relógio; pedidos de 1 s, segundo a
   segundo, na gravação de dez minutos atrás, até achar três começos de bloco; o tamanho do
   bloco é a distância entre eles, o desvio conta da meia-noite, a taxa sai dos quadros de
   um bloco; e um pedido de dois blocos seguidos confere a conta. No gravador do piloto,
   seis pedidos.
6. **Gravador que entrega de outro jeito sai sem bloco, e isso fica escrito:** blocos de
   tamanho que varia, bloco maior que a sonda, bloco que veio cortado, conferência que não
   bate. Sem bloco, o agente pede como veio e confere o que voltou — vale mais não saber do
   que pedir com a conta de outro aparelho. Canal sem gravação naquele horário é erro, dito
   com a pergunta "este canal está gravando?".
7. **O perfil medido fica na máquina,** num arquivo ao lado da configuração, um registro por
   gravador (endereço e porta). Número impossível no arquivo não é usado: mede-se de novo.
8. **O quadro parado é escolhido na loja, sem modelo nenhum** — a regra medida na rodada 5,
   agora em código: no alvo reduzido a 96 pontos de largura e suavizado, um ponto mudou
   quando o cinza salta mais de 16; o quadro está parado quando menos de 1,2% mudou; fica o
   do meio do trecho parado mais longo, que tem de durar um quarto de segundo. Sem trecho
   parado, volta o de menor movimento, **marcado como não parado**. Esses quatro números
   são a **régua de fábrica**: saíram de uma câmera, numa noite. A régua é da câmera e da
   cena, não do motor — outra câmera pode ter a sua, que entra por quem chama.

### O que foi medido (loja de teste, 10/10 à noite, só leitura)

| o quê | quanto |
|---|---|
| a medida do gravador, pela rotina do agente | 6 pedidos em 4,7 s: blocos de 2 s a partir de segundo par, 15 quadros por segundo, relógio 24,8 s adiantado |
| três blocos de cinco minutos de idade, pedidos pelo meio deles | 1,58 MB em 2,25 s; 90 quadros de 90 esperados — inteiro; o quadro parado escolhido em 0,9 s; o instante dele voltou no mesmo quadro |
| um bloco de 21 s de idade | 268 KB, o tamanho declarado batendo; 17 quadros de 30 esperados — dito como não inteiro |
| um bloco recém-gravado passar a vir inteiro | aos 81, 84 e 135 s (ainda pela metade aos 77, 78 e 130 s) |

Uma medida de cada, fora a última (três blocos). A rede da loja segue presa em 10 Mbit/s.
Nenhum pedido foi recusado; a pasta de medida foi conferida vazia no fim.

### Como foi testado

A medida, contra um gravador de mentira que entrega em blocos de vários jeitos — o medido e
os que a medida não pode engolir. A leitura, com vídeos de verdade gravados pelo próprio
teste. 63 testes novos e 5 mudados; 148 mutações das três peças, as 148 pegas pelos testes.
Um erro achado no caminho: o instante de um quadro é guardado em microssegundos, e a conta de
volta caía no quadro vizinho (2/15 s vira 0,133333 s, um fio antes do quadro 2) — corrigido,
com teste.

### O que não muda, e o que não foi medido

- **Nada chama estas peças.** A loja segue com o pacote de antes; esta fatia não pede troca
  de pacote. O cliente do ao vivo não foi tocado.
- **O que isto muda na onda 2** está no [roadmap](roadmap.md) ("Os segundos que acabaram de
  passar"): a onda 2 mede, e para medir a sequência pode ser lida 3 minutos depois. Avisar a
  cozinha na hora por uma sequência pede outra peça — o agente guardar os últimos minutos do
  canal —, que não foi provada e não entra agora.
- Não foi medido: outro gravador; o pior caso do atraso (três blocos, uma noite); o mesmo
  gravador com o disco novo; "tocar a gravação" nos segundos recentes; a medida rodando
  sozinha dentro do agente (foi chamada à mão).

## 10/10/2026 · O plano do lado do Regem foi aprovado; o aviso da cozinha vai pela rede da loja (dito pelo dono)

O dono respondeu às seis decisões da página "Porta do Farol no Regem" e, em seguida,
escreveu duas vezes sobre onde as coisas rodam.

### O que fica valendo

1. **A fase 1 pode começar** (o Farol como aplicativo conectado do Regem; a leitura de
   produtos, variações, adicionais e fichas, sem preço e sem custo). O acesso é dado pela
   página "Autorizar o Farol", com os textos aprovados como estão. **A fase 2** (a fila de
   produção, só leitura) vem logo depois da 1, e **a observação do item sai na fila**.
2. **O aviso da cozinha vai pela rede da loja.** O dono: "o Regem é feito para rodar
   localmente, o servidor faz a ponte de comunicação com a nuvem justamente para quedas ou
   oscilações de internet não influenciarem o funcionamento local; então o servidor de
   análise do Farol é local, e é mais fácil e ágil enviar ao KDS de destino responsável pelo
   alerta". O caminho é: câmera → agente do Farol → servidor local do Regem → KDS do setor
   responsável. Nada dele passa pela internet.
3. **Os canais, por tipo de aviso:**
   - **alerta no KDS do Regem** — que já tem mensagens cadastradas — para o que interessa à
     cozinha: erro, faltou ingrediente, caiu item;
   - **WhatsApp**, quando é urgente e não interessa à cozinha: só para o responsável ou o
     presidente;
   - **e-mail**, para os relatórios.
4. **A análise é local, e a ficha fica na loja.** Ele perguntou como as fichas "ficam na
   nuvem" se a análise é local. A nuvem é só o caminho — Regem (nuvem) → Farol (nuvem) →
   agente — e a cópia que chega fica guardada no computador da loja, como as áreas e os
   critérios. A conferência da montagem usa essa cópia e não depende de internet.

### O que isto muda no desenho dos alertas (A7), e o que não muda

- **Não muda:** o Farol decide quem recebe o quê, e quem entrega é outro; o KDS é a
  integração direta com o Regem; o WhatsApp e o e-mail saem pelo transportador.
- **Muda, para o KDS:** hoje quem resolve a política e despacha é a API do Farol, na nuvem.
  Para o aviso chegar com a internet fora, a decisão do aviso de cozinha tem de descer para
  a loja com a configuração, a entrega tem de ser feita pelo agente, e o registro do envio
  sobe depois. Do lado do Regem, o servidor local tem de aceitar o Farol como aparelho da
  loja (hoje só aceita o próprio servidor e o totem).
- **Nada disso entra agora.** É da fase 3, na onda 5, com o acerto medido antes — nenhum
  aviso sai sem passar pelo banco de provas. O plano dela é apresentado antes do código, no
  Farol e no Regem.

### O que não foi conferido

O sistema de alertas do KDS do Regem, no código de hoje: quais mensagens ele tem
cadastradas, como escolhe o KDS de destino e se já recebe alerta de fora. É a primeira coisa
do plano da fase 3.

## 11/10/2026 · O plano do lado do Farol que usa o Regem foi aprovado; as fichas saem com a conexão, e a busca é uma vez por dia (dito pelo dono)

As duas leituras do Regem entraram no ar em 11/10 (o catálogo e as fichas; a fila da cozinha).
No mesmo dia o dono recebeu o plano do lado do Farol — a página "Regem no Farol" — com o
protótipo de duas telas (`mockups/farol-conexoes-e-fichas.html`), e respondeu.

### O que fica valendo

1. **As duas telas estão aprovadas** — Conexões (da conta) e Fichas (da loja) —, e a fatia 1
   (conectar e ligar as lojas) pode começar. A ordem é a do plano: fatias 1, 2 e 3 agora; a
   planilha e a fila da cozinha depois.
2. **Só a diretoria conecta e desconecta o Regem.** É a primeira ação do Farol que só a
   diretoria faz: até aqui, o que o gerente configura a diretoria também configura, e nada era
   só dela. O gerente vê a conexão e as fichas, sem os botões.
3. **Ao desconectar, as fichas daquela loja são apagadas na hora.** Eu tinha recomendado que
   ficassem, paradas na última leitura, para os critérios seguirem funcionando; o dono preferiu
   o contrário. O diálogo de desconectar diz isso antes de confirmar, e os critérios que usam
   ficha param de conferir até a loja ser conectada de novo.
4. **O servidor não pergunta ao Regem de cinco em cinco minutos.** O dono: "o servidor não
   precisa perguntar ao Regem a cada 5 min; ficha técnica não é algo que se mude
   constantemente". A busca é feita quando a loja é ligada e, depois, uma vez por dia; para
   trazer uma mudança na hora, a tela Fichas tem o "Buscar agora".

### O que eu apliquei pela mesma regra, e disse a ele

Quando o acesso é tirado **pelo Regem** (lá, em Configurações → Aplicativos conectados), o
Farol também apaga as fichas daquela loja assim que percebe: sem acesso, sem fichas, dos dois
lados. Ficou dito na página e na conversa, para ele mudar se preferir que nesse caso fiquem.

### O que isto muda no desenho

- **Frequência proporcional ao dado.** Cadastro que muda pouco não se consulta de minutos em
  minutos: lê-se ao ligar, uma vez por dia e sob pedido. Vale para qualquer outra fonte de
  fichas que entrar depois (planilha, outro sistema).
- **Sem conexão, sem dado.** A cópia das fichas existe enquanto a loja está conectada. O que
  já foi usado numa análise fica na análise; a base de consulta, não.
- **Uma ação só da diretoria.** O servidor passa a ter a conferência "é a diretoria?", ao lado
  da que já existia ("pode configurar?").

### O que não foi conferido

Nada foi executado contra o Regem de verdade: a página de autorização só abre depois que o
segredo do aplicativo existir nos dois painéis. Quantas fichas o piloto terá, e como os
adicionais serão cadastrados, só se sabe com as fichas no Regem da loja.

## 11/10/2026 · A conta do Farol se conecta ao Regem: a primeira chamada a outro sistema, o primeiro segredo guardado e a primeira ação só da diretoria (fatia 1)

A fatia 1 do plano "Regem no Farol" (aprovado em 11/10): a conta conecta, cada loja de lá é
ligada a uma loja daqui, e dá para desconectar. Nada é lido ainda — a leitura das fichas é a
fatia 2. Migration 036, PR #101.

### O que entrou

- **A tela Conexões** (da conta; entrada no pé da coluna do console e, no celular, no menu da
  conta), para quem configura: gerente para cima e o suporte veem; **só a diretoria** conecta,
  liga e desconecta — nem o suporte.
- **O caminho:** "Conectar ao Regem" leva à página de autorização de lá → a pessoa volta com
  as lojas autorizadas → diz qual loja do Farol é cada uma (o Farol sugere pelo nome) →
  conectado. "Não usar esta loja agora" devolve o acesso dela ao Regem.
- **No servidor:** `GET /v1/regem`, `POST /v1/regem/conectar`, `GET /v1/regem/retorno`,
  `PUT /v1/regem/lojas` e `POST /v1/regem/lojas/:id/desconectar`; duas tabelas
  (`regem_pedido`, `regem_loja`).
- **Duas variáveis novas no serviço `farol-api`:** o segredo do aplicativo (o mesmo valor que o
  `regem-api` tem) e a chave que cifra os acessos guardados. Sem as duas, a tela diz que a
  conexão ainda não está disponível, e a rota de conectar recusa.

### O que eu decidi no caminho, e por quê

1. **A volta do Regem chega pelo console, não pelo servidor.** A sessão de quem pediu só
   existe no endereço do console; é ela que deixa o servidor exigir que quem volta é a mesma
   pessoa, da mesma conta, e que continua da diretoria. O `state` sozinho não diz de quem é.
   Pediu um ajuste no Regem: o endereço de volta padrão do aplicativo `farol` passou a ser o
   do console.
2. **O pedido de conexão é gasto ANTES de trocar o código**, numa instrução só, qualquer que
   seja o desfecho. O Regem faz o mesmo com o código (a tentativa que falha também gasta):
   não existe segunda chance, e fingir que existe abriria espaço para a mesma volta passar
   duas vezes. Sem sessão, o pedido não é gasto — quem chega deslogado não é, que se saiba,
   quem começou.
3. **Um pedido em curso por pessoa, valendo dez minutos** (o tempo que o código do Regem
   vale). Pedir de novo derruba o anterior da mesma pessoa e limpa os vencidos; não há rotina
   de faxina à parte.
4. **O acesso de cada loja fica cifrado (AES-256-GCM) com a chave do ambiente, e o texto é
   cifrado PARA a conta e a loja de lá.** Colado em outra linha do banco, não decifra. Quem
   copiar o banco sem a chave não leva acesso nenhum. O acesso não sai por rota nenhuma (a
   consulta da tela nem o busca), não desce para o agente e não entra em registro; a rota da
   volta tem o registro de pedidos desligado, porque o endereço dela carrega o código e o
   `state`.
5. **Devolver o acesso tem três desfechos, e só um mantém a ligação:** *devolvido* (o Regem
   aceitou, ou o acesso já não valia lá); *sem devolver* (o Regem recusou, ou o que está
   guardado não dá para ler: a ligação sai daqui e a tela diz que o acesso se tira pelo
   Regem); *sem resposta* (fora do ar, lento, ou quem respondeu foi a borda com uma página: a
   ligação fica, e a tela pede para tentar de novo). Apagar a ligação sem o Regem ter
   respondido deixaria lá um acesso valendo que ninguém mais guarda.
6. **Ligar é tudo ou nada; "não usar" é loja a loja.** Os pares são gravados numa transação;
   as devoluções vêm depois, uma chamada ao Regem por loja, e a resposta diz qual não foi
   devolvida. "Uma loja do Farol, um par" e "uma loja do Regem por conta" são índices do
   banco, não só conferência da rota.
7. **A sugestão de pares só existe quando não há dúvida** (uma loja de cada lado, ou o nome
   que casa sem empate). Sem sugestão, a escolha começa VAZIA e o Salvar fica travado: um
   valor de fábrica "não usar" devolveria o acesso sem ninguém ter decidido.
8. **Autorizar de novo uma loja já ligada troca o acesso e mantém o par.**
9. **A tela só afirma o que o serviço sustenta.** Nesta entrega ela diz o que o Farol *pode
   ler*, e não que lê; a linha da loja diz "ligada desde", e não "atualizado hoje"; o diálogo
   de desconectar não fala das fichas. As frases do protótipo voltam com a fatia 2, junto do
   código que as torna verdadeiras.

### O que foi medido

- **97 testes novos** (a cifra, a sugestão de pares, o cliente do Regem e as rotas), com um
  Regem de teste que é um servidor de verdade e recusa o que o Regem recusa, na mesma ordem.
  A suíte inteira da API passa — menos a de sempre no banco local, que não tem a extensão de
  vetores.
- **111 estragos de propósito no código, 111 pegos por um teste.** Na primeira rodada três
  passaram: um teste frouxo (as duas lojas do caso tinham o mesmo id, e quem recusava era
  outra conferência) e duas conferências duplicadas na cifra — o tamanho da marca conferido à
  mão E pela biblioteca, e o formato da chave que já garantia o tamanho. Ficou uma conferência
  para cada coisa.
- **A tela, num navegador de verdade:** 133 passos do caminho inteiro (ida, cancelar,
  autorizar, ligar, repetição acusada, "não usar", autorizar outra loja, os perfis, o Regem
  fora do ar no meio, o diálogo e o foco), nenhuma resposta 429 ou 401; 144 medidas — oito
  estados em 16 larguras, claro e escuro nas pontas, com o diálogo aberto — sem nenhuma barra
  para o lado; e o estado da instalação sem as variáveis. O roteiro foi conferido estragando a
  tela em três lugares: 14 conferências acusaram.
- **Uma chamada de verdade:** o cliente do Farol, o mesmo código que vai para produção, contra
  o Regem real (o servidor dele com as proteções de produção e Postgres). Segredo errado é
  recusado sem gastar o código; a troca devolveu o acesso das duas lojas; o código não vale
  duas vezes; verificador errado gasta o código; o acesso lê o cardápio, as fichas e a fila, e
  **não lê as vendas** (403); devolvido, a leitura seguinte é recusada; devolver de novo conta
  como devolvido.

### Onde a tela difere do protótipo

1. No celular, a entrada "Conexões" mora no menu da conta: o topo do console de verdade já
   leva a troca de loja, a busca e a conta, e não cabe mais um botão.
2. As frases sobre fichas e sobre "atualizado hoje" ficaram para a fatia 2 (item 9, acima):
   o cartão diz "O que o Farol pode ler"; a linha diz "ligada desde"; não há "Ver fichas"; o
   diálogo de desconectar e o aviso depois de ligar não falam das fichas.
3. Sem sugestão, a escolha começa em "Escolha a loja…" (item 7). No protótipo sempre havia
   sugestão.
4. Para o gerente, o cartão de ligar diz "Só a diretoria liga as lojas." — o protótipo só
   travava os campos.
5. Estados que o protótipo não tinha: a conexão ainda não disponível na instalação; os
   recados da volta (cancelada, vencida, de outra pessoa, que falhou); e o desconectar em que
   o acesso continua aparecendo no Regem.

### O que não foi conferido

- **Nada em produção.** A autorização de verdade só acontece depois que o dono puser as duas
  variáveis no `farol-api` e o segredo no `regem-api`.
- O repasse da volta pelo console foi conferido no console local; em produção há a borda na
  frente, e só a primeira autorização dirá.
- A borda do Regem aceitando o nome com que o servidor do Farol se apresenta: a chamada de
  verdade foi direta, sem ela.

## 11/10/2026 · As fichas do Regem viram a base de fichas do Farol: lidas ao ligar a loja, uma vez por dia e a pedido (fatia 2)

A fatia 2 do plano "Regem no Farol": o servidor lê do Regem o cardápio e as fichas de cada
loja ligada, guarda a cópia **no formato do Farol** e a mostra na tela Fichas. Migration 037,
PR #102.

### O que entrou

- **A base de fichas da loja** (`fichas_da_loja`): um documento por loja — os produtos que ela
  vende, a ficha de cada um na ordem, as variações, o que vem no combo e o que cada opção muda
  na montagem. Sem preço, custo nem cliente: o Regem nem manda.
- **A leitura**, em três momentos e só neles (decisão do dono: "ficha técnica não é algo que
  se mude constantemente"): quando a loja é ligada ou conectada de novo; uma vez por dia, às
  04h e pouco **do relógio da loja**; e no botão "Buscar agora".
- **A tela Fichas** (da loja, no menu de quem configura): a lista com busca e filtros, a
  gaveta do produto, e o "Buscar agora". Não se edita.
- **A tela Conexões** passou a dizer, de cada loja: quando foi a última busca boa, se a última
  falhou, o que a base tem, e quando o acesso foi tirado no Regem.
- **No servidor:** `GET /v1/lojas/:id/fichas`, `GET /v1/lojas/:id/fichas/produtos/:produtoId`
  e `POST /v1/lojas/:id/fichas/buscar`; um relógio novo no serviço, de um minuto, que só olha
  a agenda.

### O que eu decidi no caminho, e por quê

1. **A base é um documento por loja, trocado inteiro** — e não tabelas de produto, ficha e
   ingrediente. Quem a consome lê tudo de uma vez (a tela; e, na fatia 3, o agente, que baixa
   a cópia quando ela muda), e a regra "quando muda, refaz a cópia" pede troca inteira: não
   existe meia base. O dicionário de ingredientes e as regras da casa, quando vierem, apontam
   para os ids que o documento já carrega.
2. **O formato é o do Farol, não o do Regem.** O adaptador deixa de fora o que não se vende
   (produto, variação e opção inativos; ficha inativa), a linha que só vale para viagem, e os
   ids que o Regem troca a cada salvamento. Por isso "mudou" não é a versão de lá: é a
   **impressão do documento daqui**. O Regem pode dizer que mudou e a base ficar igual — e aí
   nada é regravado, e o agente não baixa cópia à toa.
3. **O preparo da casa entra como um ingrediente só**, apontando para a ficha dele (decisão
   de 10/10). A quantidade é a que a pessoa escreveu na ficha ("2 fatias"), não a do estoque.
4. **A agenda é pelo relógio de cada loja, e cada loja tem o seu minuto** (tirado do id dela):
   mil lojas não batem no Regem no mesmo instante. Falhou, tenta de novo em meia hora — não
   espera o dia seguinte. O relógio do servidor é à parte do vigia dos agentes: cada um com o
   seu passo.
5. **Falha na leitura não apaga nada.** Sem resposta, recusa ou resposta fora do contrato: a
   base de ontem continua valendo, a tela diz que a última busca falhou, e o motivo fica no
   registro — para quem olha a tela a consequência é uma só.
6. **Acesso tirado no Regem apaga a base da loja na hora** (a mesma regra do desconectar,
   dita ao dono em 11/10), e só a dela. A ligação fica, para a tela dizer o que houve, com
   dois caminhos: "Conectar de novo" (o par é mantido e as fichas voltam) e "Desconectar".
7. **Uma leitura por loja de cada vez, e nenhuma grava depois que a conexão saiu.** A vez é
   pega numa instrução só (vale entre réplicas e entre a rotina e o botão); a base é gravada
   na mesma transação em que a ligação é travada. Quem desconecta no meio de uma busca não vê
   as fichas reaparecerem.
8. **Um mudou e o outro não:** o Farol busca os dois inteiros de novo. A base se monta com o
   cardápio e as fichas juntos, e o Farol não guarda a resposta crua de lá.
9. **Quem vê as fichas: quem configura a loja** (gerente para cima e o suporte) — os perfis
   do protótipo. A supervisão ficou de fora por enquanto; é pergunta para o dono.
10. **Frases do protótipo que continuam de fora**, porque ainda não são verdade: "o Farol usa
    isto para conferir, pela câmera" e "os critérios que usam ficha param de conferir" (nenhum
    critério usa a ficha ainda); e "sabe o que foi pedido" (a fila da cozinha é a fatia 5).

### O que foi medido

- **67 testes novos** — a conversão (contra uma resposta de verdade do Regem, gravada em
  `contratos/regem-catalogo-e-fichas.json`), a leitura e as rotas. A suíte inteira da API
  passa, menos a de sempre no banco local.
- **131 estragos de propósito no código, 131 pegos por um teste.** Na primeira rodada seis
  passaram, e os seis eram teste frouxo: opções que já chegavam na ordem, item nulo numa
  lista, o "mudou?" que não era sim nem não, a vez que não era solta, a contagem de produtos
  e a falha que não era limpa. Cada um ganhou o caso que faltava.
- **As duas telas num navegador de verdade:** 119 passos na Fichas e 134 na Conexões, sem
  nenhuma resposta 429 ou 401; e 360 medidas — 20 estados das duas telas em 16 larguras
  (claro e escuro nas pontas), com a gaveta e o diálogo abertos e uma lista de 44 produtos de
  nome comprido — sem barra para o lado.
- **A chamada de verdade:** o código de leitura que vai para produção, contra o Regem real.
  Leu o cardápio e as fichas, montou a base (4 produtos, 1 com ficha), recebeu "nada mudou" ao
  perguntar com a versão, e, com o acesso devolvido, recebeu "acesso tirado".

### O que a medida de largura não pegou, e a foto pegou

Com "Fichas", a barra de baixo do celular passaria a sete itens — e, de 320 a 375 px, os
rótulos "Alertas" e "Orçamento" se encostavam. Nada passava da tela, então a medida de "sem
barra para o lado" não acusou; foi a foto. **No celular a barra ficou como estava (seis
itens)**, e "Fichas" abre pelo "Ir para…" e pelo "Ver fichas" da tela Conexões. Como a barra
deve ficar com sete itens é pergunta para o dono, com protótipo.

### Onde a tela difere do protótipo

1. As três frases do item 10, que voltam quando forem verdade.
2. A linha de uma loja com o acesso tirado tem "Conectar de novo" **e** "Desconectar": sem o
   segundo, a loja do Farol ficaria presa a uma ligação morta.
3. Estados que o protótipo não tinha: "Buscando as fichas no Regem…" (a primeira busca, que a
   tela acompanha sozinha) e "O Farol ainda não conseguiu ler o Regem desta loja" (a primeira
   busca falhou, e não há fichas de ontem para mostrar).
4. O aviso da busca que falhou diz de quando são as fichas que estão na tela ("as da busca de
   hoje, 04:10"), e não "as de ontem": é o que o servidor sabe com certeza.
5. No celular, "Fichas" não está na barra de baixo (acima).

### O que não foi conferido

- **Nada em produção:** nenhuma loja está conectada. A primeira leitura de verdade acontece
  quando o dono puser as variáveis e autorizar.
- **O piloto ainda não tem fichas no Regem.** O tamanho real do documento de uma loja, e
  quanto leva a leitura dela, só se sabe com as fichas cadastradas.
- A leitura do dia às 04h do relógio da loja foi provada pela conta e pelos testes; ninguém
  esperou uma madrugada.

## 11/10/2026 · A cópia das fichas chega ao computador da loja: a configuração anuncia a base e o agente a baixa (fatia 3)

A fatia 3 do plano "Regem no Farol": a base de fichas que o servidor guarda (fatia 2) passa a
ter uma cópia no computador da loja — é lá que um critério vai poder conferir "montado como a
ficha manda", sem internet. Migration 038, PR #103.

### O que entrou

- **A base muda → a loja fica sabendo.** Base nova, base trocada ou base apagada sobem a
  versão da configuração da loja (`loja.config_versao`), que é o que o agente compara a cada
  batida. Quem sobe é um gatilho no banco (migration 038).
- **A configuração leva a marca da base** (`fichas`: a impressão do documento e as duas
  contas), ou **nulo** quando a loja não tem base.
- **O agente baixa o documento** por `GET /v1/agentes/fichas` quando a marca anunciada não é a
  da cópia dele, e o guarda em `fichas.json`, ao lado da fila. Quando a configuração diz que a
  loja não tem base (desconectou, ou o Regem tirou o acesso), **a cópia sai do disco**.
- **O agente declara que sabe guardar fichas** (`?sabe=…,fichas`).
- O contrato: `contratos/fichas-da-loja.json`, lido pelos testes dos dois lados.

### O que eu decidi no caminho, e por quê

1. **O mesmo caminho das fotos padrão:** a configuração leva só a marca, e o documento desce
   por uma rota própria, só quando difere. A base de uma loja grande não trafega a cada
   mudança de critério.
2. **O plano dizia "sem migration"; entrou uma, pequena — um gatilho.** A base é escrita por
   três caminhos (a leitura, o desconectar e o acesso tirado) e vai ganhar outros (a
   planilha). Avisar a loja em cada rota deixaria a primeira que esquecesse com a ficha velha
   no computador da loja, sem erro nenhum. No banco, quem escreve na base avisa — como ponto,
   área, critério e foto padrão já fazem. Leitura que não mudou nada não escreve, e escrita
   que não mexe na impressão não sobe a versão: a loja não puxa configuração à toa.
3. **A marca desce para todo agente.** O pacote antigo ignora a entrada, e não há o que
   esconder dele. A palavra `fichas` na declaração só informa — e faz o pacote novo, ao subir,
   pedir a configuração de novo (a regra do ERR-064), que é quando ele descobre a base.
4. **Só a configuração apaga.** Nulo = "a loja não tem base": a cópia (e o temporário, se
   houver) sai do disco. Configuração que não fala de fichas, entrada torta, nuvem fora do ar
   ou um 404 na hora de baixar **não apagam nada**: "não sei" não é "não tem".
5. **A impressão é uma marca de versão, não um resumo dos bytes.** O banco guarda o documento
   em `jsonb`, que reordena as chaves: o que desce não tem os mesmos bytes do que foi
   impresso. A loja não recalcula; compara. O que garante o documento inteiro é outra coisa:
   resposta cortada não é JSON (provado com um servidor de verdade que derruba a conexão no
   meio), o formato é conferido antes de gravar, e a gravação é por troca de arquivo.
6. **A nuvem entrega a base que tem AGORA, com a impressão dela** (as duas saem da mesma
   linha). Se a base mudou depois que a configuração desceu, o agente guarda a nova e **espera
   a configuração confirmar** — não fica pedindo de novo a cada minuto.
7. **Formato que o agente não conhece não vira cópia** (a nuvem é mais nova que ele), e também
   não é pedido todo minuto: só de novo quando a configuração anunciar outra base, ou quando o
   agente for outro.
8. **O que falha é pedido de novo em um minuto** — a mesma espera das fotos padrão —, e
   enquanto isso vale a cópia que há. Nada disso derruba a auditoria.
9. **Uma trava própria:** o laço da nuvem (que declara) e o da auditoria (que busca) rodam em
   linhas diferentes; duas voltas ao mesmo tempo baixam uma vez só.

### O que isto NÃO faz

- **Nenhum critério usa a ficha ainda.** A cópia chega e fica; o que a loja confere não muda.
- **O console não diz se a cópia chegou.** Não há tela nem frase nova: isso pede protótipo.
  Sabe-se pela declaração do agente (`agente.sabe` com `fichas`) e, no piloto, olhando o
  arquivo no computador da loja.
- **"Apagadas na hora" vale na nuvem.** No computador da loja a cópia sai quando o agente
  pega a configuração seguinte — segundos, com a loja ligada; com o agente desligado ou sem
  internet, quando ele voltar.

### O que foi medido

- **13 testes novos na API e 69 no agente.** Na API, a base é escrita e apagada
  pelos caminhos de produção (a leitura contra o Regem de teste, o desconectar, o acesso
  tirado), não por SQL do teste. No agente, três deles usam um servidor HTTP de verdade — um
  cortando a resposta em quatro pontos.
- **119 estragos de propósito, 119 pegos por um teste:** 17 nas duas rotas,
  7 no gatilho (trocado no banco local e devolvido) e 95 no agente. Antes
  de rodar, a lista pediu três casos que faltavam: a outra loja **da mesma conta** não sobe de
  versão, não ter quem baixe não é falha, e a cópia apagada à mão é baixada de novo. E na
  primeira rodada do agente um estrago passou ("diz que apagou o que não apagou"): o teste
  procurava a frase no registro num nível em que ela não aparece — olhava para o lugar errado
  e passava sempre. Corrigido o teste, o estrago foi pego.
- **Os dois lados de verdade, um contra o outro:** o código do agente como roda na loja
  (cliente, sincronizador, o passo do serviço e a auditoria) contra a API de pé no banco
  local, com a base lida de um Regem de teste. 25 conferências: loja sem base; conecta e
  liga → a versão sobe uma vez, uma puxada de configuração e um download; "Buscar agora" sem
  mudança → a loja bate e não puxa nada; cardápio muda → mais um download, e só; o agente
  reinicia → acha a cópia e não baixa; desconecta → a cópia sai do disco.
- As suítes inteiras: a da API (menos a de sempre no banco local) e a do agente.

### Na volta de pacote

Voltar o agente da loja para um pacote de antes desta fatia: além de apagar
`configuracao.json` (ERR-070), **apagar `fichas.json`** — o pacote antigo não a conhece, e a
cópia ficaria no disco sem ninguém para atualizá-la ou apagá-la.

### O que não foi conferido

- **Nada na loja.** O pacote do agente do piloto não foi trocado: isso espera o "pode" do
  dono. Até lá o agente de lá ignora a marca da base.
- **Nada em produção com base de verdade:** nenhuma loja está conectada ao Regem.
- **O tamanho do documento do piloto** e quanto leva para descer pela internet da loja: só
  com as fichas cadastradas no Regem.

## 11/10/2026 · A busca pelo meio e a grade de seis quadros entram no agente, dormindo (fatia 2.2b)

A fatia 2.2b da onda 2: o agente passa a saber fazer, sozinho, o que em 10/10 foi feito à mão
— entre duas olhadas, achar no gravador onde a cena mudou, lendo um bloco por passo; e,
quando não acha, montar a grade de quadros numerados da janela que sobrou. Só o agente, sem
migration e sem tela. **Nada chama estas peças ainda**, e a loja segue com o pacote de antes.
PR #104.

### O que entrou

Quatro módulos em `agent/farol_agent/sequencia/`:

- **`busca.py` — a busca pelo meio, como conta.** Recebe quem lê um bloco e quem julga um
  quadro. Pede o bloco do meio, julga o quadro parado dele e anda: "ainda como antes" →
  para a frente; "já como depois" → para trás; "achou" → acaba.
- **`grade.py` — a grade.** Seis quadros da janela, três por linha, numerados na ordem do
  tempo; o número devolve o instante ("aconteceu no quadro 4" vira uma hora).
- **`gravado.py` — as duas, com o gravador da loja.** A hora dele, só o que já assentou, e o
  trecho conferido pelos quadros.
- **`guarda.py` — a sequência guardada** ao lado das análises (a imagem e uma ficha), com
  teto em bytes e rodízio.

### O que eu decidi no caminho, e por quê

1. **A busca para de quatro jeitos, e todos dizem de onde tirar a grade.** *A mão em cima*:
   o bloco não tem trecho parado — esse quadro **não vai a juízo**, e o bloco é a janela da
   grade (é o lote A da rodada 5). *Apertou*: o bloco do meio já foi lido, e não há quadro
   novo entre as pontas. *Não sei*: o juiz não soube dizer — a busca não chuta um lado.
   *Limite*: seis passos, que apertam uma dúvida de até 64 blocos.
2. **A ponta só anda com um quadro de dentro da dúvida.** O bloco do meio pode passar das
   pontas, e o quadro escolhido cair fora delas: ele não diz nada de novo, e uma resposta
   que contradiga a olhada da ponta não inverte a dúvida.
3. **Quem chama fala no relógio do computador; o pedido sai na hora do gravador.** É no
   relógio do computador que as olhadas são marcadas. O que volta — o resultado, os passos,
   o que o juiz recebe, os instantes da grade — está nele também. A hora do gravador não
   sai do módulo.
4. **Só se pede o que já assentou**, e isso é conferido ANTES de qualquer pedido: o último
   bloco de que a busca pode precisar tem de ter a idade do perfil (a cautela de 180 s).
   Cedo demais não é erro: é "ainda não", com quanto falta.
5. **O que voltou é conferido pelos quadros.** Bloco com menos quadros do que o gravador
   grava naquele tempo não vai a juízo; janela com quadro faltando não vira grade (com um
   buraco no meio, o instante de cada quadro sairia errado). Os dois são "voltar depois" —
   em um minuto, a mesma espera das outras coisas que o agente tenta de novo.
6. **A célula da grade é o recorte do alvo no tamanho da câmera**, só reduzida quando passa
   de 960 × 540. Nunca é ampliada: ponto inventado não ajuda quem julga.
7. **Os instantes da grade saem da janela inteira, numa conta só.** Somando fatias já
   arredondadas (o instante é guardado em microssegundos), o erro de uma ia para todos os
   quadros — o teste achou isso antes de qualquer uso.
8. **A guarda é por teto, não por prazo.** Passou do teto (200 MB de fábrica; é escolha do
   produto, e quem instala pode dar outro), saem as mais antigas; a que acabou de entrar
   nunca sai. O disco do computador da loja não cresce para sempre.
9. **Nenhum número do piloto no motor.** O tamanho do bloco, onde ele começa e a taxa vêm
   do perfil medido de cada gravador; gravador sem perfil não tem busca.

### Provado no gravador da loja (11/10, só leitura; a loja estava fechada)

As mesmas rotinas, com os módulos novos levados para a pasta de medição (a instalação do
agente não foi tocada; a pasta ficou vazia no fim), e um juiz de mentira — mede a mecânica,
não o juízo:

- **o laço da busca**, numa janela de 16 s com cinco minutos de idade: três blocos em 4,5 s
  (de 1,07 a 1,25 s e uns 513 KB por bloco), todos inteiros; andando para trás, quatro
  blocos em 6,2 s. Um pedido por vez, 21 pedidos de trecho ao todo, nenhuma recusa;
- **a grade** de uma janela de 1,7 s: dois blocos (1.030 KB) num pedido só, 3,3 s do pedido
  à imagem pronta; 2.888 × 1.084 pontos, 488 KB em JPEG (o quadro inteiro, células de
  960 × 540). Olhei a imagem: os seis números legíveis, e o relógio que o gravador escreve
  em cada quadro é o da janela pedida;
- **cedo demais** (janela que acabou havia 30 s): "ainda não, faltam 150,8 s" — e nenhum
  pedido saiu.

### O que a medida mostrou, e que ninguém tinha visto: o perfil envelhece

Em 10/10 os blocos deste gravador começavam em **segundo par**; em 11/10, em **segundo
ímpar** (bloco de 2 s e 15 quadros por segundo nos dois dias). Não conferi o que mudou — o
computador da loja foi reiniciado em 10/10; do gravador não sei.

O que isso muda: o perfil guardado deixa de valer sem aviso. Com ele velho, o bloco pedido
cai entre dois blocos de verdade — o gravador responde **sem gravação**, e uma janela de
vários blocos volta com **um bloco a menos** (é para isso que o pedido termina um segundo
depois do começo do último bloco: quem lê percebe pela conta dos quadros). **Trecho que já
assentou e volta assim é sinal de medir o gravador de novo**, antes de concluir que não há
gravação. Está escrito no módulo e tem teste; quem decide medir de novo é a peça que vai
chamar a busca (fatia 2.5), que ainda não existe.

### O que foi medido aqui

- **110 testes novos.** A busca, com os dois lotes da rodada 5 (um passo quando o molho foi
  posto e coberto; dois blocos e a janela da mão quando não foi). A grade, até o algarismo
  de cada célula. O gravador de mentira entrega **vídeo de verdade**, gravado na hora, como
  o da loja entrega. A suíte inteira do agente passa.
- **169 estragos de propósito, 169 pegos por um teste**, na primeira rodada.

### O que não foi medido

- **O juízo dentro do laço.** Com juiz de verdade, cada passo ganha o tempo dele (1,2 s na
  rodada 5); e o acerto em sequências desta loja continua sem medida.
- **A busca com a loja aberta**, com gente na frente do alvo e o ao vivo carregado.
- Outro gravador; o mesmo depois do disco novo; o porquê de o começo dos blocos ter mudado.
- A grade com o recorte do alvo: os 488 KB são do quadro inteiro.

## 11/10/2026 · Três acertos pequenos de tela: a tabela que decide pelo próprio espaço, "só observam" e "quadro"

Os três acertos que ficaram anotados na onda 1 (o item 2 da lista "o que falta eu fazer", no
roadmap). Nenhuma tela nova. PR #105.

### 1. A tabela vira cartões quando NÃO CABE — e quem decide é o espaço dela

A tabela do Painel rolava para o lado de 768 a 1.280 px de largura: com o menu ao lado, a
peça tinha de 641 a 960 px, e as nove colunas pedem 1.045. A peça de tabela decidia pela
largura da **tela** (cartões abaixo de 768 px), e isso errava no meio do caminho — tablet,
notebook, janela pela metade.

Agora a tabela **mede a si mesma**: se, como tabela, precisa de mais largura do que a caixa
tem, vira cartões; quando volta a caber, volta a ser tabela. Não há número de tela: a largura
de que ela precisa muda com o que está escrito nela (o nome do critério, a data da última
análise), e nenhum número serviria para toda loja.

- Vale para as três telas que usam a peça: **Painel, Análises e Alertas**. Em Alertas a
  tabela das regras de aviso (cinco colunas) passou a ser tabela já a partir de 600 px —
  porque cabe.
- O cartão largo (tablet e notebook) tem **quatro colunas** de rótulo e valor, no lugar das
  duas do celular; o título ocupa a linha toda.
- A medida é feita antes de a tela ser pintada: não há troca à vista ao abrir. Ao
  redimensionar a janela, a troca acontece no quadro seguinte.

### 2. O cartão "Critérios ligados" diz quantos só observam

"5 de 6" parecia "5 conferindo". Com critério que nasce ligado e só observando, o cartão do
Painel passou a dizer: "1 desligado · 2 só observam". A conta é do servidor: dos critérios
ligados e com canal ativo, os que estão em "observando" (em ensaio, medido e valendo já
julgam, e não entram).

### 3. "Quadro" no lugar de "área"

Em Análises e no Painel sobrava UMA frase de tela com "área" no sentido do desenho — "ninguém
na área", no aviso das olhadas que a loja segurou. Passou a "ninguém no quadro". O Painel não
tinha nenhuma. O resto era comentário de código.

### Achado no caminho — e corrigido, porque é a mesma regra (nada rola para o lado)

- **Um rótulo de coluna que não quebrava a linha.** No cartão do celular, o nome da coluna
  herdava o "não quebra" da célula de número: em Análises, "Custo por análise na nuvem"
  passava 7 px da caixa a 320 px. Já era assim; a medida nova pegou. O rótulo passou a
  quebrar a linha.
- **As abas de Alertas rolavam para o lado a 320 px.** Passaram a quebrar a linha
  ("Chegou?" desce para a segunda).

Na primeira tentativa eu atribuí os 7 px ao cabeçalho escondido da tabela e mexi nele; a
medida seguinte mostrou que não era (a sobra continuava com o cabeçalho fora). Desfiz, e a
causa certa — o rótulo — saiu de um diagnóstico que tira uma peça de cada vez.

### O que eu vi e NÃO mexi (é pergunta para o dono)

A regra "a lógica interna não aparece na tela" é de depois destas telas, e elas ainda dizem:
"não perguntou à nuvem" e a etiqueta "na nuvem" / "na loja" (Análises, coluna "Onde julga"),
"Custo por análise na nuvem" (Análises) e "versão 0.9.4" no cartão do agente (Painel). Trocar
isso é mudar o que a tela de Análises conta — não é acerto pequeno.

### O que foi medido

- **As três telas em 16 larguras** (de 320 a 1.920 px), num navegador de verdade contra o
  build de produção e uma loja inventada: nenhuma página passa da tela, nenhuma peça rola
  para o lado, nenhum erro de script. **Antes**, a mesma medida acusava o Painel em sete
  larguras (de 768 a 1.280).
- Olhei as fotos das peças que mudaram: os cartões do Painel a 1.024 px e os de Análises a
  900 px; as abas de Alertas a 320 px.
- A linha do total, em Análises: com o fio em cima como tabela, sem ele em cartões.
- O cartão com 0, 1 e 2 critérios só observando: sem a frase, "1 só observa", "2 só
  observam".
- No servidor: um teste novo na rota de resultados; 6 estragos de propósito na conta, os 6
  pegos; a suíte inteira passa (menos a de sempre no banco local).

### O que não foi medido

- Com a loja de verdade e os nomes de critério dela.
- O roteiro antigo da tela do canal (`ver_canal`) continua sem rodar desde o PR 85: não foi
  posto em dia aqui.

---

## 11/10/2026 (noite) · A supervisão vê as fichas — e o pacote do agente da loja foi trocado

O dono respondeu às perguntas da página do plano "Regem no Farol": **"1 pode ver"** (a
supervisão vê as fichas), **"2 o recomendado"** (um item "Mais" na barra do celular —
protótipo antes), **"3 não entendi"** (a pergunta do acesso tirado no Regem foi explicada de
novo; até ele responder, fica como está: as fichas são apagadas) e **"4 pode"** (trocar o
pacote do agente na loja).

### 1. Quem vê as fichas

| | vê a lista e o produto | pede "Buscar agora" | conecta e desconecta |
|---|---|---|---|
| diretoria | sim | sim | sim |
| gerente | sim | sim | não |
| suporte | sim | sim | não |
| supervisão | **sim (novo)** | não | não |
| execução | não | não | não |

- **No servidor** (é onde a regra mora): `podeAcompanhar` em `rbac.ts` — supervisão para cima
  e o suporte. As duas rotas de ver usam essa; a de buscar continua exigindo quem configura a
  loja, e responde 403 dizendo de quem é a busca. A execução recebe 403 sem dado nenhum.
- **A tela não oferece o que o servidor recusa:** a resposta da lista leva `podeBuscar`, e é
  ela (não o perfil lido no navegador) que decide se o botão aparece.
- **As frases acompanham o botão.** Para quem não busca, nenhuma frase manda usar "Buscar
  agora": o aviso da busca que falhou termina em "Ele tenta de novo sozinho."; o de "o Regem
  ainda não tem fichas" termina em "depois, elas chegam aqui na busca do dia seguinte."; o
  rodapé da gaveta, em "O Farol busca as fichas uma vez por dia.". Cada uma é verdade pelo
  serviço: a rotina diária e a nova tentativa não dependem de ninguém clicar.
- **A recusa** deixou de dizer "Esta tela é de quem configura a loja" (não é mais verdade):
  "Seu perfil não vê as fichas da loja — as fichas aparecem para a supervisão, a gerência e a
  diretoria."
- **O item "Fichas" do menu** (e do "Ir para…") aparece para quem vê os resultados: é o mesmo
  grupo. Não criei uma marca nova na moldura para dizer a mesma coisa.

### 2. O pacote do agente na loja

Trocado às **18h38**, com a loja fechada (ela abre às 19h no domingo; li o horário na
configuração guardada antes de trocar): pacote `81183e3`, pelo `trocar_pacote.ps1` de sempre —
monta ao lado, confere, troca o conjunto. Em 15 segundos o agente estava no ar. Conferido
depois, só lendo: o código instalado declara `estados, estudo, bancada, fichas`; a
configuração guardada foi pedida de novo com essa declaração ("o agente sabe mais do que sabia
quando a configuração desceu (fichas): puxando de novo"); nenhum aviso nem erro no registro;
3 processos, 7,9% de um núcleo; e **não há `fichas.json`** — certo, porque a loja ainda não
tem base de fichas na nuvem. O pacote anterior (`e09ed16`) ficou guardado; para voltar a ele,
`voltar_pacote.ps1` e apagar também o `fichas.json`, se existir.

### O que o dono pediu a mais, e que NÃO está nesta entrega

1. **O Regem avisa o Farol quando a ficha muda** (em vez de o Farol só buscar uma vez por
   dia). O Regem já tem o mecanismo de aviso (assinado, padrão Standard Webhooks) para outro
   produto; falta deixar o Farol registrar e o cardápio e as fichas virarem "recurso que
   avisa". O pedido está escrito para o projeto Regem. Do lado do Farol: registrar o aviso ao
   ligar a loja (endereço e segredo sorteados pelo servidor, o segredo guardado cifrado),
   receber, conferir a assinatura e ler na hora. A leitura diária e o "Buscar agora" ficam,
   como rede de segurança.
2. **Importar fichas por planilha**, com o modelo de colunas à mão do usuário.
3. **Conexões e Fichas não podem ser telas "do Regem".** O Farol é produto para distribuição:
   quem não usa o Regem tem de conseguir mandar as fichas por uma porta documentada, e o
   acesso é gerado pelo próprio usuário no console. Depois, o hub de MCP.

Os itens 2 e 3 mudam tela: plano e protótipo antes.

### O que foi medido

- **Servidor:** os 14 testes das rotas de fichas (o de "quem pode" foi refeito: sem sessão,
  execução, supervisão, gerente, suporte e diretoria, nas três rotas); **15 estragos de
  propósito** na regra — a execução passa a ver, a supervisão deixa de ver, a supervisão pede
  a busca, o botão oferecido a quem não pode… —, os 15 pegos.
- **Tela, num navegador, contra o build de produção e uma conta inventada:** 131 passos (a
  supervisão chega pelo menu, vê a mesma lista da gerência, abre a gaveta, não tem botão; a
  busca pedida à mão por ela é recusada; a execução não vê o item e, pelo endereço, recebe a
  recusa) e 396 medidas em 16 larguras, com os três estados novos da supervisão: nada rola
  para o lado, nenhum erro de script.
- Olhei as fotos da lista e dos avisos da supervisão, a 1.440 e a 375 px.

### O que não foi medido

- A cópia das fichas chegando ao computador da loja de verdade: não há base na nuvem para
  essa loja enquanto ninguém conectar o Regem dela em produção.

---

## 11/10/2026 (noite) · O aviso do Regem — o lado do Farol (migration 039)

Pedido do dono: "as fichas, ao serem alteradas no Regem, já enviam ao Farol as modificações,
em vez de o Farol ficar buscando". O Regem já tem um aviso assinado de "algo mudou nesta loja"
(padrão Standard Webhooks), usado por outro produto. Esta entrega é a metade do Farol:
**registrar** o aviso e **receber**. A metade do Regem (deixar o Farol registrar e o cardápio
e as fichas avisarem) é plano do projeto de lá. As duas metades entram em qualquer ordem:
enquanto o Regem responde "ainda não aceito", o Farol segue só com a leitura diária.

### Como funciona

1. **O aviso não leva dado.** É só o gatilho; quem lê é a leitura de sempre, com a versão que
   já tem. Aviso repetido não custa e aviso perdido não perde nada: a leitura diária e o
   "Buscar agora" continuam.
2. **Ninguém digita nada.** O endereço (`/v1/regem/avisos/<id da conexão>`) e o segredo do
   aviso são sorteados pelo servidor do Farol. O segredo fica cifrado com a mesma chave dos
   acessos, com contexto próprio (o da loja A, colado na linha da loja B, não abre), e não
   sai por rota, tela nem registro.
3. **Registra depois de ler.** Depois de uma leitura que deu certo — ao ligar a loja, uma vez
   por dia e a pedido —, em segundo plano. Refaz o registro a cada 20 horas, com o mesmo
   endereço e o mesmo segredo: é o que religa um aviso que o Regem tenha pausado. Não há
   relógio novo nem consulta de minutos em minutos.
4. **O aviso só marca a loja.** A rota confere a assinatura sobre o texto exato que chegou e
   o relógio (cinco minutos), marca "tem aviso esperando" e dispara a leitura em segundo
   plano. Começar uma leitura limpa a marca; o aviso que chega **no meio** de uma leitura
   fica marcado e a rotina lê a loja de novo na volta seguinte.
5. **Aviso repetido não vira uma leitura por pedido.** Com a última leitura começada há menos
   de 15 segundos, o aviso só marca: quem lê é a rotina, em até um minuto.
6. **O fim.** Desconectar apaga a conexão: quem avisar recebe 404, que é o que faz o Regem
   parar. Acesso tirado no Regem apaga o segredo junto com as fichas. Conectar de novo
   registra com o acesso novo.

### O que eu decidi no caminho, e por quê

- **Não chamo `DELETE /integracao/webhook` ao desconectar.** O Regem já apaga o registro do
  acesso devolvido e não avisa acesso devolvido. Uma chamada a menos é um jeito a menos de o
  desconectar falhar pela metade. (O pedido ao Regem dizia que o Farol chamaria; corrigi lá.)
- **Um segredo por conexão, guardado antes de ir ao Regem.** Se o Regem aceitar e a resposta
  se perder, o aviso que chegar já pode ser conferido.
- **A rota responde 404 igual** para conexão que não existe, sem segredo ou com segredo que
  não abre mais: para quem avisa é a mesma coisa, e o registro seguinte conserta sozinho.
- **O `tipo` do aviso não é lido** — o corpo nem é interpretado. Qualquer aviso assinado
  dispara a leitura das duas rotas.
- **Nenhuma tela mudou.** A tela Fichas só passa a mostrar "atualizado" mais cedo. Dizer
  "atualiza sozinho" fica para quando houver um aviso de verdade chegando.
- **Uma variável nova, opcional:** `REGEM_AVISO_URL`, só para teste e desenvolvimento. Em
  produção o endereço é o do próprio servidor.

### O que foi medido

- **18 testes novos** (`aviso-do-regem.test.ts`): a assinatura conferida contra a conta do
  Regem (copiada para o Regem de mentira dos testes); o registro ao ligar, o 422, a meia
  hora de espera, o registro diário com o mesmo segredo, as falhas, duas tentativas ao mesmo
  tempo; o aviso que chega, o que chega logo depois de uma leitura, o que chega no meio de
  uma; nove jeitos de aviso que não vale (outro segredo, corpo mexido, relógio, cabeçalho
  faltando, o aviso de outra loja); desconectar, acesso tirado e conectar de novo.
- **66 estragos de propósito**, em quatro arquivos: na assinatura (o relógio, o corpo, o id ou
  o instante fora da conta, assinatura de outra versão, comparar só o tamanho), no segredo,
  no registro (cedo demais, tarde demais, sem esperar, duas tentativas ao mesmo tempo, o
  endereço errado, o segredo novo que não é guardado), na leitura (a marca que não é limpa, a
  rotina que ignora a loja com aviso) e na rota (o corpo interpretado antes de conferir, o
  relógio de quem mandou, o aviso recusado que é atendido). **Os 66 pegos.** Um tinha
  sobrevivido — "sem a chave do ambiente, tenta assim mesmo" —, porque o teste chamava com a
  meia hora de espera ainda valendo e a tentativa nem começava: o teste passou a envelhecer a
  tentativa antes e a conferir que nada é anotado.
- Os 121 testes vizinhos (fichas e conexão), que usam o mesmo Regem de mentira, seguem
  passando.
- A migration aplicada duas vezes no banco local: as cinco colunas nascem vazias e nenhuma
  conexão que já existia muda.

### O que não foi medido

- **Um aviso de verdade.** O Regem ainda não envia aviso de cardápio nem de ficha, e não
  aceita o registro do Farol: tudo acima foi medido contra o Regem de mentira.
- **A borda.** O aviso do Regem chega com a identificação `Regem-Integracao/1`. Depois do
  deploy confiro, de fora, que um pedido com essa identificação chega à rota (404 em JSON, e
  não a página de bloqueio da borda).
- O atraso entre a mudança no Regem e a leitura no Farol: depende do lado de lá (o aviso sai,
  no máximo, um por minuto por loja).

**Conferido depois do deploy (11/10, 20h04):** a migration 039 aplicada; um pedido de fora,
com a identificação do Regem e sem assinatura, a um id sorteado, respondeu 404 em JSON
("não existe esse aviso") — a rota está no ar e a borda deixa a identificação passar.

---

## 11/10/2026 (noite) · A primeira conexão de verdade, as respostas do dono e as fichas por planilha — o servidor (migration 040)

### A primeira conexão de verdade

Às 20h23 o dono conectou a conta dele ao Regem e ligou a loja do piloto. Conferido:

- **no servidor:** a tela Conexões mostra a loja "atualizada hoje, 20:23", com 68 produtos e
  nenhuma ficha (as fichas ainda vão ser cadastradas no Regem);
- **no computador da loja** (só leitura): a cópia chegou no mesmo minuto — 68 produtos, a
  marca igual à que a configuração anuncia, nenhum campo de dinheiro ou de cliente —, e o
  agente escreveu "base de fichas em disco: 68 produto(s), 0 com ficha", sem aviso nem erro.

Era o que a fatia 3 não tinha conseguido medir: a cópia chegando à loja de verdade.

### As respostas do dono (página do plano, 11/10 à noite)

1. **O protótipo "fichas de qualquer origem" está aprovado: "pode começar pela planilha".**
2. **Planilha com problema: "entra o que está certo e a tela lista o que ficou de fora"** —
   e não "nada entra", que era o que eu recomendava e o que o protótipo mostrava.
3. Acesso tirado lá no Regem: o Farol apaga as fichas daquela loja (como está).
4. Telas antigas que dizem "nuvem" e "versão": fazer o protótipo do antes e depois.

### O que "entra o que está certo" quer dizer aqui

**O grão é o produto.** Um produto com qualquer linha errada fica INTEIRO de fora, com a
linha e o motivo; os outros entram. Não entra "o produto menos a linha errada": o Farol
conferiria a montagem contra uma ficha com um ingrediente a menos, e ninguém saberia. Pela
mesma razão, o combo que leva um produto que ficou de fora fica de fora junto. Foi dito ao
dono antes de fazer; se ele preferir por linha, muda-se num lugar só (`planilha-fichas.ts`).

O que impede a planilha INTEIRA é só o que não deixa lê-la: sem a aba Fichas, sem uma coluna
obrigatória, grande demais.

### O que entrou (só o servidor; a tela é a entrega seguinte)

- **`planilha-fichas.ts`** — o segundo adaptador da base (o primeiro é o do Regem). Recebe as
  células, aba por aba, e devolve a base no formato do Farol, as contas, o que ficou de fora
  e o que não é de produto nenhum. Os títulos valem em qualquer ordem, com ou sem acento. A
  unidade é de lista (dez), aceita do jeito que se escreve ("gr", "fatias", "UN"). O id do
  produto sai do nome: é o mesmo a cada importação. Faz também a volta (a base em linhas) e
  guarda o modelo.
- **Quem abre o arquivo é o navegador de quem importa.** Para o servidor vão só as células.
  O servidor não abre .xlsx: um arquivo compactado vindo de fora é o tipo de coisa que
  derruba servidor, e aqui ele nem chega. Toda regra continua no servidor.
- **Rotas** (de quem configura a loja; a supervisão vê as fichas e não importa):
  `POST /v1/lojas/:id/fichas/importar` (confere; com `gravar: true`, importa),
  `GET …/fichas/importacao` (o registro da última importação, com a lista do que ficou de
  fora), `GET …/fichas/planilha` (as fichas da loja de volta em planilha) e
  `GET /v1/fichas/modelo` (o modelo sai do servidor: é sempre o que o servidor lê).
- **Uma loja recebe as fichas de um lugar só.** A que está ligada ao Regem não importa nem
  confere planilha (409) — e a que é ligada no meio da importação não fica com as duas: a
  gravação é uma instrução só, que só grava se a loja continua sem ligação. Ler o Regem
  depois substitui a base e apaga o registro da planilha.
- **Importar troca a base inteira.** A mesma planilha de novo não muda nada: a data da base
  não anda e o agente da loja não baixa de novo.
- **Migration 040:** a origem `planilha` passa a valer em `fichas_da_loja`, e entra a coluna
  `importacao` (o registro da última importação). Nenhuma base existente muda.
- A lista da tela Fichas passou a dizer a origem de verdade (`fonte`), se a pessoa pode
  importar (`podeImportar`) e o resumo da importação.

### O que eu decidi no caminho, e por quê

- **O modelo é o do protótipo, sem tirar nem pôr:** as sete colunas da aba Fichas (Produto,
  Código, Categoria, Vai para a cozinha, Ingrediente, Quantidade, Unidade) e as três abas
  opcionais. O exemplo do modelo é lido sem problema nenhum, e há teste disso.
- **"Tira" só o que está na ficha.** "Sem cebola" num produto cuja ficha não tem cebola é
  problema: quase sempre é o nome escrito diferente, e o Farol precisaria casar os dois.
- **Linha preenchida sem o nome do produto derruba o produto de cima.** É o hábito de quem
  escreve o nome só na primeira linha; pular a linha calado faria o produto entrar com um
  ingrediente a menos.
- **O registro guarda só o nome do arquivo**, sem a pasta: o caminho no computador de quem
  importou não é assunto do servidor.
- **A lista de problemas tem teto (500); a conta, não.**

### O que foi medido

- **36 testes novos:** 23 do leitor, sem banco (o modelo lido sem problema; a ida e a volta;
  cada defeito de linha deixando o produto de fora e o vizinho entrando; as outras abas; o
  combo que cai junto, inclusive o que vem antes daquele de que depende; o que impede tudo), e
  13 das rotas, com banco (quem pode; a loja do vizinho; conferir sem gravar; importar; importar
  de novo; nada certo; a loja ligada ao Regem; a loja ligada **no meio** da importação; a
  planilha e depois o Regem; o modelo; a planilha de volta; o nome do arquivo).
- **91 estragos de propósito** no leitor, nas rotas e na leitura do Regem: os 91 pegos. Dois
  tinham sobrevivido, e os dois eram código redundante — a chave do nome tirava de novo os
  espaços que a célula já vinha sem, e a medida devolvia "não serve" quando o recado já deixava
  o produto de fora. Saíram do código, em vez de ganhar teste de enfeite.
- Os testes vizinhos (fichas, conexão, aviso) seguem passando; dois deles comparavam a
  resposta inteira da lista e ganharam os campos novos.
- A migration aplicada duas vezes no banco local: nenhuma base existente muda, nenhuma versão
  de configuração sobe, a regra da origem aceita `regem` e `planilha`.

### O que não foi medido

- **Um arquivo de Excel de verdade.** O servidor recebe células; quem as tira do arquivo é a
  tela, que é a entrega seguinte.
- Uma planilha grande de loja (centenas de produtos): o teto é 20 mil linhas e 8 MB; o tempo
  de leitura não foi medido.
- A lista de unidades é a minha proposta, mostrada ao dono no modelo; a loja pode pedir outras.

### O que vem

A tela (protótipo aprovado): a loja sem fichas com os jeitos de tê-las, a importação em três
passos, a etiqueta da origem — com o passo "Conferir" refeito para a resposta 2 do dono: o
que entra, o que fica de fora, e o botão que importa o que está certo. Depois, a porta para
outro sistema e o "Mais" na barra do celular.

## 11/10/2026 (noite) · As fichas por planilha — a tela

A segunda metade da planilha: a tela que abre o arquivo do Excel. Do protótipo aprovado
(`mockups/farol-conexoes-e-fichas.html`), com o passo "Conferir" refeito para a resposta do
dono — "entra o que está certo e a tela lista o que ficou de fora" — e mostrado no próprio
protótipo antes de virar tela (situação "planilha · com produtos de fora").

### O que entrou

- **A loja sem fichas mostra os jeitos de tê-las** — conectar ao Regem ou importar planilha —
  em vez de só mandar conectar ao Regem. Cada jeito tem o botão para quem pode e a frase para
  quem não pode (conectar é da diretoria; importar é de quem configura a loja).
- **Importar em três passos, numa gaveta:** o modelo (as sete colunas, o que é cada uma, as
  três abas opcionais e o botão "Baixar o modelo"), enviar (.xlsx ou .csv, até 2 MB) e
  conferir (o que entra, o que fica de fora e por quê, e o aviso de que importar troca as
  fichas que a loja tem). Nada é gravado antes do botão do passo 3, e o botão diz o que faz:
  "Importar", "Importar os N que estão certos" ou, sem nada certo, não existe.
- **A tela Fichas diz a origem:** "da planilha · importada hoje, 21:33", com "Importar de
  novo" e "Baixar a planilha" (as fichas da loja de volta no modelo, para corrigir).
- **O que ficou de fora continua à mão** depois de importar: a tela diz quantos produtos
  ficaram de fora e quais (os seis primeiros), e "Ver o que ficou de fora" abre a lista com a
  aba, a linha, o motivo e o que fazer. A supervisão vê quantos e quais; o motivo é de quem
  importa.
- **`web/lib/planilha.ts`** — abre o arquivo no navegador e manda ao servidor só as células.
  Lê .xlsx (o texto que o Excel guarda numa tabela à parte, o texto com formatação dentro da
  célula, a linha em branco no meio — a linha do problema é a da planilha) e .csv (ponto e
  vírgula, vírgula ou tabulação; UTF-8 ou a codificação antiga do Windows). Escreve o .xlsx
  que a pessoa baixa. Dois tetos antes de qualquer trabalho: 2 MB o arquivo, 30 MB aberto.
- **Uma dependência nova no console: `fflate` 0.8.3**, com a versão exata. É só o que abre e
  fecha o arquivo compactado; não tem dependência própria. A alternativa pronta para ler
  Excel tinha quatro dias de publicada e trazia outras atrás.

### O que eu decidi no caminho, e por quê

- **Os problemas saem na ordem em que se corrige:** uma aba de cada vez, na ordem do modelo,
  e de cima para baixo dentro da aba. O servidor (#108) ordenava só pelo número da linha, e
  "Adicionais, linha 2" saía antes de "Fichas, linha 6" do mesmo produto. Mudou no leitor, com
  teste.
- **A loja com fichas de planilha que é ligada ao Regem** não estava no protótipo, e a tela
  dizia coisas erradas nesse intervalo ("corrija a planilha e importe de novo", que o servidor
  recusa). Passou a dizer o que acontece: as fichas da planilha ficam até a busca no Regem dar
  certo, e aí as de lá entram no lugar; os botões são os do Regem; e a tela troca sozinha
  quando a busca termina. A frase é a que o protótipo usa para o mesmo caso no outro sistema.
  O servidor já fazia assim (desconectar e "acesso tirado" só apagam as fichas que vieram do
  Regem).
- **O resumo da lista ganhou os nomes** (`quais`, os seis primeiros): o protótipo diz quais
  produtos ficaram de fora, e a lista só trazia a conta.
- **O botão "Ver o que ficou de fora" fica na linha de baixo do aviso**, e não ao lado da
  frase: ao lado, o botão (mais alto) tirava a frase da linha do ícone.

### Diferenças do protótipo, ditas

- **O terceiro jeito ("receber de outro sistema") e os cartões "Outro sistema" e "Planilha"
  da tela Conexões não entraram:** são da entrega seguinte, a porta para outro sistema, que
  refaz a tela Conexões para as três origens. Até lá a loja sem fichas mostra dois jeitos, e
  a frase de abertura não diz "escolha um dos três".
- **O aviso de troca diz quantos produtos saem** ("Os 2 produtos que ela tem hoje saem"), e
  não a data da importação anterior: é o que o servidor responde na conferência.
- **Os produtos sem ficha** aparecem numa linha de ajuda embaixo das contas, e não numa caixa
  de aviso: não é um problema, e três caixas seguidas disputavam a atenção.
- **"Falta ligar esta loja ao Regem"** ficou como no protótipo: enquanto a conta tem loja do
  Regem esperando para ser ligada, a loja sem ligação não oferece a planilha pela tela (o
  servidor aceita). Quem resolve é a entrega seguinte, que trata as origens por loja.

### O que foi medido

- **Num navegador de verdade, com arquivos de verdade** (escritos pelo openpyxl, fora do
  código do Farol) — 152 passos conferidos: a loja sem fichas para a diretoria, a gerência e a
  supervisão; o modelo, e o arquivo baixado aberto por outro leitor (as quatro abas, os
  títulos com acento, texto como texto e número como número, o título em negrito e preso no
  alto); o que não é planilha (um arquivo compactado que não é Excel, o .xls antigo, o arquivo
  vazio) e a planilha sem uma coluna obrigatória, cada um com o motivo na tela; a planilha com
  problemas (dois entram, dois ficam de fora, com a linha da PLANILHA — há uma linha em branco
  no meio — e sem as colunas de preço e custo que ela trazia aparecerem em lugar nenhum);
  importar e abrir a lista do que ficou de fora; importar de novo a certa (a base trocada
  inteira); baixar a planilha da loja, abri-la por outro leitor e importá-la de volta ("nada
  mudou"); a toda errada; a de uma aba só, com o nome que o Excel dá; o texto com negrito num
  pedaço da célula; os dois CSV; e a loja com planilha que é ligada ao Regem (a busca que
  falha, a que demora, e a troca pelas fichas de lá sem recarregar a tela).
- **144 medidas de largura** (8 estados, 16 larguras de 320 a 1920, e o tema escuro em duas;
  565 conferências na rodada, contando os cliques que abrem cada estado):
  nada passa da tela e nenhuma peça rola para o lado, com cada gaveta aberta. As fotos foram
  olhadas; dois acertos saíram daí (o rótulo "Adicionais, linha 2" quebrava em duas linhas, e
  o botão ao lado da frase do aviso).
- O roteiro da tela Fichas pelo Regem (132 passos; 396 conferências na rodada de medida)
  segue passando.
- **Na API:** dois testes novos (a ordem dos problemas; os nomes no resumo da lista). A lista
  de estragos de propósito foi de 91 para 98; os sete novos e o que mudou foram rodados, e os
  oito foram pegos. A ordenação dos "soltos" era redundante (cada aba já é lida inteira, de
  cima para baixo) e saiu do código. A suíte inteira: 1.184 testes, 1.183 passando — o que
  falha no banco local é o do embedding, que pede uma extensão que ele não tem (passa no CI).

### O que não foi medido

- **O Excel de verdade, nas duas pontas.** Os arquivos de teste foram escritos por outra
  biblioteca (openpyxl), que grava no mesmo formato — texto na tabela à parte, número como
  número —, e foi ela que abriu o modelo e a planilha que a tela baixa. O Excel é mais
  exigente que ela com o arquivo que abre. O primeiro teste de verdade é o do dono: baixar o
  modelo, abrir no Excel, preencher, salvar e importar.
- **O leitor do arquivo não tem teste no repositório:** o console não tem onde rodar teste (o
  CI dele é a compilação). Quem o guarda hoje é o roteiro de navegador, que não roda no CI.
- A planilha grande (centenas de produtos) e o celular de verdade.

## 11/10/2026 (noite) · A porta para outro sistema — o servidor (migration 041)

Pedido do dono (11/10): o Farol é produto para distribuição, e a operação que não usa o Regem
tem de conseguir mandar as fichas dela "com documentação que vamos liberar"; e "as integrações
devem ser dinâmicas, feitas pelo usuário, e não nós colocando tokens direto na API". O
protótipo "fichas de qualquer origem" (aprovado) mostra o fluxo: a diretoria cria o acesso em
Conexões, o código aparece uma vez, e ela o entrega a quem cuida do sistema.

Esta entrega é só o servidor. **Sem tela ainda: ninguém cria acesso, e a porta fica
fechada** — toda chamada sem um código que exista é recusada.

### O que entrou

- **Migration 041:** a tabela `acesso_externo` (o acesso de UMA loja: o nome que a conta dá ao
  sistema, a impressão do código, quem criou, quando recebeu por último, quem revogou) e a
  origem `sistema` em `fichas_da_loja`. Uma loja tem no máximo um acesso valendo (índice no
  banco). Nenhuma linha que existe muda.
- **O console** (`rotas/acessos.ts`): `GET /v1/acessos` (quem configura vê os acessos da
  conta e de onde cada loja recebe as fichas), `POST /v1/acessos` (só a diretoria: cria e
  devolve o código, **uma vez**), `DELETE /v1/acessos/:id` (só a diretoria: revoga).
- **A porta** (sem sessão; `Authorization: Bearer <código>`): `PUT /v1/integracao/fichas`
  (o sistema envia o cardápio inteiro da loja) e `GET /v1/integracao/fichas` (o que o Farol
  tem dele, para quem integra testar o código).
- **`porta-fichas.ts`** — o terceiro adaptador da base. Confere a FORMA do envio e o desmonta
  nas mesmas linhas da planilha; as REGRAS são as do leitor da planilha. O mesmo cardápio dá a
  mesma base pelos dois caminhos (há teste), e a unidade que vale num vale no outro.
- **A documentação da porta:** [integracao-fichas.md](integracao-fichas.md), escrita para
  quem programa o sistema da loja. A página pública dela vem com a tela.

### O código é segredo

Começa por `farol_` e tem 256 bits sorteados. O banco guarda só a impressão (sha256): quem lê
o banco não envia nada, e nem a distribuição vê o código de um acesso já criado. Ele não
entra em registro do servidor, a lista não o traz, e a resposta que o entrega sai com
"não guardar". A loja e a conta saem DO ACESSO: nada no corpo do envio escolhe a loja.

Revogar vale na hora e apaga as fichas que o sistema mandou — numa instrução só. As de
planilha (a loja que ganhou o acesso e o sistema ainda não enviou) ficam: não são dele. A
linha do acesso fica, como registro de quem criou e quem revogou.

### Uma loja recebe as fichas de um lugar só

- A loja ligada ao Regem não ganha acesso; a loja com acesso não é ligada ao Regem (e nem
  aparece como opção), nem importa planilha.
- A loja com fichas de **planilha** pode ganhar acesso: as da planilha ficam até o sistema
  enviar as dele, e aí as do sistema entram no lugar (é o que o protótipo diz).
- **Criar o acesso e ligar ao Regem travam a linha da loja antes de conferir.** Duas pessoas
  ao mesmo tempo, uma em cada ação, não deixam a loja com as duas origens. O teste das duas
  chamadas juntas pegou um defeito meu antes de sair: a trava e a conferência estavam na mesma
  instrução, e quem esperava a trava conferia com o retrato de antes da espera — as duas
  passavam. Ficou em duas instruções (ERR-107 do registro de erros).

### O que eu decidi no caminho, e por quê

- **O envio é o mesmo modelo da planilha, com outra forma.** Lá o produto é um bloco de
  linhas; aqui, um objeto com as listas dele (`ingredientes`, `variacoes`, `adicionais`,
  `combo`). Uma regra só para os dois caminhos, e uma documentação que o dono já conhece.
- **Entra o que está certo, como na planilha.** A decisão do dono para a planilha ("entra o
  que está certo e a tela lista o que ficou de fora") vale aqui: o produto com problema fica
  inteiro de fora, os outros entram, e a resposta diz quais e por quê, com o caminho no que
  foi enviado (`produtos[1].ingredientes[1]`). A lista fica guardada para a tela Fichas.
- **A forma errada recusa o envio inteiro** (422, com o caminho do campo). É erro de quem
  programou o envio, e meia leitura esconderia o defeito.
- **O nome é a identidade do produto**, como na planilha. Dois produtos com o mesmo nome
  ficam os dois de fora — mesmo seguidos: aqui cada um é um objeto, e o leitor passou a saber
  onde cada um começa, para não somar os ingredientes de um aos do outro.
- **Nenhuma frase da porta fala em planilha, aba, linha ou coluna.** As cinco frases do
  leitor que falavam são ditas com as palavras do envio, e há teste que varre todas.
- **Os números da tela Conexões** para a loja ligada ao Regem passaram a contar só a base que
  veio do Regem. Na loja que tinha planilha e acabou de ser ligada, mostravam os da planilha.
- **A trava é a leve** (`for no key update`): a outra barra quem só aponta para a loja —
  gravar uma ficha, um evento —, e um teste vizinho mostrou.

### O que foi medido

- **33 testes novos:** 14 do leitor do envio, sem banco (o mesmo cardápio dando a mesma base
  pelos dois caminhos; cada defeito de conteúdo deixando o produto de fora, com o caminho; a
  ordem dos problemas; o nome repetido, seguido ou não; 37 defeitos de forma, cada um com o
  caminho do campo; os tetos, no limite e um acima; nenhuma frase falando em planilha), e 19
  das rotas, com banco (quem pode; a loja do vizinho; o código que não fica em lugar nenhum;
  a credencial da porta; o envio certo, o repetido, o com produto de fora, o sem nada certo, o
  de forma errada e o grande demais; revogar, e revogar no meio do envio; a loja do Regem, a
  loja com acesso e a loja de planilha, uma contra a outra; as duas pessoas ao mesmo tempo; a
  planilha chegando junto com o acesso; os números da tela Conexões).
- **109 estragos de propósito** no leitor do envio, nas rotas do acesso e da porta e nas
  rotas das fichas e do Regem: os 109 pegos. Dois tinham sobrevivido: um era meu (o estrago
  estava mal escrito e não estragava nada), e o outro pedia um teste — a loja que teve o
  acesso revogado volta a aparecer como livre. Três trechos saíram do código por serem
  redundantes, em vez de ganhar teste de enfeite.
- A lista de estragos da planilha (98) teve oito conferidos de novo, por causa das linhas
  mexidas: os oito pegos.
- A migration aplicada duas vezes no banco local, com as regras provadas por linhas de
  verdade (um acesso valendo por loja; o código não se repete; o nome cabe; os revogados
  ficam; apagar a loja leva os acessos).
- A suíte inteira: 1.217 testes, 1.216 passando (o que falha no banco local é o do embedding,
  que pede uma extensão que ele não tem; passa no CI).
- Um teste vizinho (apagar a loja logo depois de ligá-la ao Regem) passou a esperar a leitura
  em segundo plano terminar: falhava de vez em quando, por apagar a loja no meio da leitura
  dela.

### O que não foi medido

- **Um sistema de verdade enviando.** Não há nenhum ainda, e sem a tela ninguém cria acesso.
- A borda deixando passar uma chamada de programa na porta (confere-se de fora, depois do
  deploy).
- O envio grande de verdade (milhares de produtos): os tetos foram testados, o tempo não.

### O que vem

A tela (protótipo aprovado): a tela Conexões refeita para as três origens, com o cartão
"Outro sistema" (criar o acesso, o código que aparece uma vez, revogar) e o da planilha; o
terceiro jeito na loja sem fichas; a etiqueta "do <sistema>" na tela Fichas, com a lista do
que ficou de fora do envio; e a página da documentação. **Uma coisa para o dono decidir:** o
protótipo mostra a documentação em `monitorfarol.com.br/integracao`, e o site não está neste
repositório — a página pode ir no console (aberta, sem login) ou no site.

## 11/10/2026 (noite) · A porta para outro sistema — a tela

A segunda metade da porta: o que a diretoria vê e faz. Do protótipo aprovado
(`mockups/farol-conexoes-e-fichas.html`). Com esta entrega a porta abre: a diretoria cria o
acesso de uma loja, entrega o código e o endereço da documentação a quem cuida do sistema, e
o sistema passa a enviar.

### O que entrou

- **A tela Conexões é das três origens.** Depois do Regem vêm o cartão **Outro sistema** (os
  acessos da conta, com o que cada um já enviou; "Criar acesso" e "Revogar" para a diretoria;
  quem configura vê, sem os botões) e o cartão **Planilha** (leva à tela Fichas das lojas que
  podem importar, e baixa o modelo). A frase do alto deixou de falar só em "ler".
- **Criar o acesso** (gaveta): o nome do sistema e a loja. As lojas que já recebem de outro
  lugar aparecem travadas, com o motivo ("já recebe do Regem", "já tem um acesso"); a de
  planilha pode, com o aviso de que as fichas dela ficam até o sistema enviar. Depois de
  criar, **o código aparece uma vez**, com "Copiar" e o que entregar a quem cuida do sistema.
- **Revogar** (diálogo): diz que o sistema para de enviar na hora e — só se ele já enviou —
  que as fichas que ele mandou são apagadas.
- **A tela Fichas:** o terceiro jeito na loja sem fichas ("Receber de outro sistema"); a loja
  que **espera o primeiro envio** ("O <sistema> ainda não enviou as fichas"); a origem "do
  <sistema> · recebido hoje, 23:01"; o aviso do que ficou de fora do envio, com a lista (o
  caminho no que foi enviado e o motivo); e a loja de planilha que ganhou um acesso (as da
  planilha ficam até o sistema enviar).
- **A documentação, aberta:** `/integracao`, sem login, com o conteúdo de
  [integracao-fichas.md](integracao-fichas.md). É o endereço que a tela manda entregar.

### O código na tela

Ele existe em um lugar só: na gaveta de quem acabou de criar. Não vai para o endereço, não é
guardado pelo navegador e sai da tela quando a gaveta fecha (há conferência disso no roteiro).
Aparece inteiro, quebrando a linha — num campo de uma linha só, o fim dele ficava escondido no
celular.

### O que eu decidi no caminho, e por quê

- **Fechar sem copiar pede confirmação** (pelo "Concluir", pelo X e pelo Esc). Não está no
  protótipo. Um toque fora da gaveta jogava fora um código que não aparece de novo, e o
  conserto é revogar e criar outro.
- **O aviso do que ficou de fora vale também para o envio do sistema.** O protótipo não o
  mostra na origem "sistema" (é de antes da resposta do dono, "entra o que está certo"). A
  regra é a mesma da planilha, e a tela é a mesma peça; o que muda é o lugar do problema — o
  caminho no envio, em vez da aba e da linha — e quem corrige ("quem cuida do <sistema>").
- **A documentação fica no console**, em `app.monitorfarol.com.br/integracao`, e não em
  `monitorfarol.com.br/integracao`, que é o que o protótipo mostra: o site não está neste
  repositório, e a tela não pode mandar entregar um endereço que não existe. A tela escreve o
  endereço do próprio console. **Fica para o dono decidir** se a página vai também para o
  site; se for, muda uma frase.
- **A página da documentação não passou por protótipo.** É texto para quem programa, com as
  peças que o console já tem; o conteúdo é o do arquivo da documentação. O dono revê.
- **Na loja que recebe de outro sistema, o botão do alto é "Conexões"** (para a diretoria):
  é lá que o acesso se vê e se revoga. Quem configura não tem botão — não há o que fazer no
  Farol.

### Diferenças do protótipo, ditas

- O cartão "Planilha" mostra as lojas que têm fichas de planilha pelo nome, sem a data da
  importação (a data está na tela Fichas da loja).
- "Ir para Fichas" aparece para cada loja que pode importar, e não só para uma.
- O "Mais" na barra do celular é a entrega seguinte.

### O que foi medido

- **Num navegador de verdade, com a porta de verdade** — 120 passos conferidos. O roteiro faz
  o papel do outro sistema: pega o código que a tela mostra e envia as fichas pela porta. Os
  três cartões de Conexões, para a diretoria e para a gerência; criar o acesso (o nome pedido;
  as lojas com o motivo de cada uma; o código com a forma certa; "Concluir", o X e o Esc
  perguntando antes de fechar sem copiar; "Copiar" copiando o código, uma vez); depois de
  fechar, o código fora da tela, do endereço, do que o navegador guarda e da resposta do
  servidor; a loja que espera o primeiro envio; o envio com um produto de fora (o preço que
  ele mandava não ficou em lugar nenhum); a origem, o aviso e a lista do que ficou de fora; a
  supervisão vendo sem o botão; a loja de planilha que ganha acesso; a conta sem loja livre;
  revogar com e sem fichas, e o código revogado recusado na porta; os três jeitos de volta,
  por perfil; e a documentação abrindo sem login, com o resto do console ainda pedindo login.
- **168 medidas de largura** nas telas da porta (nove estados em 16 larguras, de 320 a 1920,
  e no tema escuro em duas; a gaveta do código em quatro larguras): nada passa da tela e
  nenhuma peça rola para o lado, com cada gaveta e o diálogo abertos. A rodada de medida soma
  313 conferências, contando os cliques que abrem cada estado. As fotos foram olhadas; dois
  acertos saíram daí (o código inteiro à vista no celular; o endereço da documentação sem
  partir no meio). A foto da gaveta do código leva um código de mentira, posto antes do
  retrato.
- Os roteiros vizinhos seguem passando, já com o terceiro jeito e os cartões novos: Conexões
  (134 passos), a planilha (152) e as fichas pelo Regem (132), e as rodadas de medida de cada
  um (184, 565 e 396 conferências).
- **Uma correção ao que escrevi na entrega da tela da planilha:** os "565" de lá são as
  conferências da rodada de medida, e não medidas de largura. As medidas de largura daquela
  tela são 144 (oito estados, nas mesmas 18 combinações). O resultado não muda — nenhuma
  falhou —, mas o número estava com o nome errado, inclusive na descrição do PR #109.

### O que não foi medido

- **Um sistema de verdade enviando**, e a página da documentação lida por quem vai integrar.
- **O servidor não mudou nesta entrega** (os testes e os estragos de propósito dele são os da
  entrega anterior). As telas, como as outras do console, não têm teste no repositório: quem
  as guarda é o roteiro de navegador.
- O celular de verdade.

## 12/10/2026 (madrugada) · O "Mais" na barra do celular

O último pedaço do protótipo "fichas de qualquer origem" (aprovado em 11/10; o dono tinha
respondido "o recomendado" à pergunta do item "Mais").

**O problema que resolve:** a barra de baixo do celular comporta seis itens, e por isso a tela
Fichas só abria, no celular, pelo "Ir para…" — e Conexões, pelo menu da conta. Quem não
soubesse procurar não achava.

**O que entrou:** a barra passa a ser Painel · Análises · Canais · Critérios · Alertas ·
**Mais**. O "Mais" abre uma folha com o que não cabe na barra, cada tela com uma linha
dizendo o que é: **Fichas** ("o que a loja vende e do que é feito"), **Orçamento** ("o que
falta para a loja ficar coberta") e **Conexões** ("de onde vêm as fichas das lojas"). O
Orçamento saiu da barra e foi para a folha, como no protótipo. No computador nada muda: a
coluna continua com tudo.

### Como ficou, e por quê

- **Cada perfil vê na folha o que pode abrir.** Fichas é de quem acompanha a loja; Orçamento e
  Conexões, de quem configura. A supervisão tem o "Mais" só com a Fichas; para a execução, que
  não abre nenhuma das três, o botão nem existe. (Quem decide o acesso continua sendo a API.)
- **O "Mais" fica marcado quando a tela de agora mora nele**, com o mesmo realce que desliza
  entre os itens — e, dentro da folha, a tela atual também. Assim a barra continua dizendo
  onde a pessoa está.
- **A folha é a gaveta do console**, e não uma peça nova: no celular ela já sobe de baixo,
  prende o foco, fecha no Esc e devolve o foco ao botão.
- **Em Conexões (que é da conta, sem loja escolhida)** a barra fica com "Lojas" e o "Mais",
  que traz só Conexões.
- O menu da conta continua levando a Conexões: são dois caminhos para o mesmo lugar.

### O que foi medido

- **206 conferências num navegador de verdade:** a barra e a folha para a gerência, a
  diretoria, a supervisão e a execução; abrir, fechar pelo "Fechar" e pelo Esc (o foco volta
  para o botão); ir para Fichas, Orçamento e Conexões pela folha, com o "Mais" marcado e o
  realce em cima dele; a volta para uma tela da barra; no computador, nenhum "Mais" e a coluna
  com os sete itens; e, nas oito larguras de celular (320 a 640), cada rótulo dentro do
  próprio item e a dois pontos ou mais do vizinho, com a barra e com a folha aberta, sem nada
  rolando para o lado.
- Os roteiros das fichas, da porta, de Conexões e da planilha seguem passando.

### O que não foi medido

- O celular de verdade (o polegar alcançando o "Mais", a folha com a barra do sistema).

## 12/10/2026 · O motor que aprende: a régua do dono, o que a loja mediu e a prioridade

Nada foi programado nesta entrada: é direção, medida e plano. O plano está no
[roadmap](roadmap.md), A20. O estudo inteiro, com as contas e as fontes de mercado, foi
entregue ao dono como página local (não publicada, por descrever a lógica que ele mandou
proteger).

### O que o dono disse

- **A régua:** "a ideia de controle do Farol é como se um ser humano estivesse parado
  olhando fixo para aquele local e respondendo o mais rápido possível aos critérios".
- **Aprender:** o motor aprende com as análises e "com o tempo" depende pouco da nuvem; o
  nosso servidor vira "uma base de parâmetros" (objeto novo entra: "ao invés de 80 tipos de
  objetos já teríamos 81"); com muitas lojas, "uma grande margem de aprendizado".
- **De onde se aprende:** "não só aprender com a nuvem": foto local de objeto que não está
  na lista "também é um aprendizado"; da nuvem, "só aprendemos quando a confiança é alta e
  consegue avaliar, se não consegue não é aprendizado"; "o contexto é tão importante quanto
  a imagem de referência".
- **O ritmo:** "30 seg de intervalo… é muita coisa"; o movimento "só na área de corte" como
  gatilho, "um funil".
- **Proteger:** "não permitir cópia da lógica de funcionamento… em restaurantes que vão usar
  nosso projeto".
- **A regra de trabalho:** "sempre devemos considerar tecnologias e recursos como opção para
  aumentar sucesso". E, sobre um veredito meu tirado só do piloto: "não podemos só pensar
  como base no que temos de teste agora, estou pensando num modo geral".
- **A prioridade:** "temos que focar no controle e preparo com alertas, que é a raiz da
  lógica; o restante são adicionais quando a estrutura estiver pronta, estável e aprendendo".

### O que a loja mediu

Leitura do registro do agente no computador da loja, de 07/10 às 16h até a madrugada de
12/10. Só leitura, só números; os roteiros de leitura foram apagados de lá.

| o quê | o número |
|---|---|
| olhadas · análises | 21.783 · 17.217 |
| decididas na loja pelo detector | 15.495 (90%), 91 ms cada, sem custo |
| pagas à nuvem | 1.722 (10%), 2,2 s e 1,30 centavo cada: **R$ 22,44**, tudo em 07 e 08/10 |
| pagas que voltaram "não deu para avaliar" | **1.483 (86%)**: gaveta 627 de 658, chapa 438 de 468, touca e uniforme 333 de 384, ingredientes 85 de 212 |
| pela régua do dono (avaliou, com confiança de 0,85 ou mais) | **208 de 1.722**: 11 centavos por exemplo |
| a confiança declarada | 196 das 239 avaliações na faixa de 0,85 a 0,90; 12 acima de 0,90; 541 "não deu para avaliar" com 0,85 ou mais |
| da imagem até a resposta | mediana de **18 s** na loja (9 em 10 em até 37 s) e 37 s pela nuvem; mais até 30 s de espera pela olhada |
| o que segurou as olhadas | o silêncio depois de um veredito (1.758) e a cena repetida (175); **as portas de contexto e de gatilho seguraram zero**: nenhum critério tinha condição ligada |
| a mesma cena paga de novo | 676 de 1.717 (39%) com a impressão da imagem idêntica à de uma cena já julgada no mesmo critério, e a mesma resposta em 675; a regra da cena repetida lembra 30 s |
| a impressão da imagem inteira e o "fora do critério" | das 81 respostas "fora", 14 tinham cena quase igual já julgada, e 2 batiam: não serve para decidir |
| "há alguém aqui?" na mesma câmera (a da chapa) | sem ninguém na imagem: 224 de 468 pagas da chapa (48%) e 189 de 384 de touca e uniforme (49%), todas "não deu para avaliar"; nenhuma das 81 respostas de verdade dessa câmera aconteceu sem gente |
| presença no setor inteiro × no posto | canal 1 (imagem inteira da montagem): alguém em 93% de 6.466 leituras; canal 13 (quadro do colaborador): 61% de 5.710 |
| o material que existe | 17.225 imagens analisadas no computador da loja (893 MB), apagadas 15 dias depois: **as primeiras somem em 22/10** |

Tudo rodou com a pergunta do jeito antigo (o recorte sozinho, no Haiku 4.5): o pedido com
contexto está no motor desde 09/10, **desligado nesta loja**. Desde 09/10 o motor não foi à
nuvem: a configuração que ele tem hoje (versão 131) traz dois critérios, os dois de presença
(canais 1 e 13); os quatro pagos não estão nela. O valor de R$ 22,44 é a conta do próprio
agente (o que foi e voltou × a tabela de preço, com o dólar a R$ 5,40); o teto de R$ 5,00
citado no roadmap é o das rodadas de teste — outra conta.

### O que se concluiu

1. **O maior desperdício não é falta de aprendizado:** é pagar por pergunta que volta vazia
   e pagar de novo pela mesma cena. Corta-se com o que já está construído.
2. **A nuvem só ensina resposta firme, e mesmo ela precisa de conferência:** em 05/10 um
   mouse foi lido como controle remoto com 85% e 95% de confiança. Avaliou, com confiança
   alta, e com uma amostra conferida por gente.
3. **São cinco fontes de aprendizado:** o que alguém mostra (foto local, com nome), o que
   alguém conta (o contexto), o que o motor observa (o normal do lugar), o que a nuvem
   responde com firmeza e o que o responsável corrige. Todo conhecimento é guardado com o
   contexto dele e só responde dentro dele.
4. **"O mais rápido possível" hoje é perto de meio minuto**, com o juiz levando 0,09 s. A
   demora é espera: a próxima olhada e a fila entre a imagem e o juiz.
5. **Módulos, sim; dois motores separados, não:** o detector acha pessoa e objeto na mesma
   passada, e a leitura de cada câmera é uma só.
6. **Entre câmeras, o que informa é o posto, e não o setor:** a presença na imagem inteira
   da câmera aberta não filtra (93%); no nível do posto, sim (61%). E câmera de tampo não vê
   gente (15% das olhadas, com o tampo mexendo em 82% — medida de 09/10), então "há alguém
   neste posto" só pode vir de outra câmera.

### O que ficou de fora, e por quê

- **A presença da imagem inteira como filtro entre canais:** seguraria 11 de 171 análises.
- **A trajetória com direção (de um setor para o outro) como gatilho:** pede acompanhar
  pessoas o tempo todo e calibrar cada câmera contra a planta; a antecedência que ela dá, a
  imagem leve em memória e a gravação já cobrem. Continua nas ondas 9 e 10, para os fins
  delas.
- **A nossa nuvem agora:** com o preço de hoje (0,14 centavo por análise no teste de 08/10),
  uma máquina com placa de vídeo sempre ligada empata entre 48 e 140 lojas como a do piloto.

### Três erros meus, corrigidos na mesma noite

- Escrevi que o servidor não guarda imagem nenhuma. Guarda as fotos apresentadas (a foto
  padrão e as do inventário) e o quadro de cada canal; não guarda as imagens das análises.
- Tratei as respostas vazias da nuvem como novidade. Estavam registradas desde 08/10
  (`agent/farol_agent/contexto.py`), e foi o dono quem apontou a causa.
- Dei um veredito de produto ("descartar") a partir do estado do piloto. A regra de 10/10
  — o piloto não vira regra do motor — vale também para os meus vereditos.

## 12/10/2026 · O juiz esperava a volta seguinte: onde ficavam os 18 s (ERR-108)

Primeira medição do passo 0 do A20, e a correção que saiu dela. Só o agente muda, e só no
repositório: **na loja, o pacote continua o de 11/10 até a troca, com o "pode" do dono.**

### O que foi medido

Leitura da fila do agente na loja (só leitura, só números), de 07 a 12/10:

| o quê | o número |
|---|---|
| da captura à resposta, com os dois critérios de hoje (detector) | mediana de 11 a 13 s; 9 em 10 em até 21 a 32 s; a menor, 5 s |
| o mesmo, em 07 e 08/10 (nove critérios) | mediana de 32 a 38 s no detector e de 23 a 41 s na nuvem, conforme o critério |
| como as esperas se repartem (detector, de 09/10 em diante) | 5 a 10 s: 11% · 10 a 15 s: 44% · 15 a 20 s: 21% · 20 a 25 s: 13% · 30 a 35 s: 12% |
| o tempo do juiz | 0,09 s |

As esperas caem em degraus de 10 em 10 segundos — o passo do vigia e o da rotina. Não era
o juiz que demorava: era a resposta que esperava o despertar seguinte.

### A causa

A volta dá ao julgamento a hora em que ela **começou**. O quadro capturado nela leva a
hora em que foi **lido**, que é segundos depois (abrir o fluxo principal leva de 1 a 3 s
por canal). Na fila o item nasce pronto "no instante do quadro", e ela só entrega o que
está pronto até a hora que recebe: o quadro recém-capturado ainda não estava. Saía na
olhada extra do vigia (10 s depois, e só quando algo tinha mudado) ou na rotina seguinte
(30 s depois).

Os testes não viam: o dublê de câmera carimbava o quadro com a hora que recebia, e a fila
guarda a hora em segundos — nos testes o quadro nascia pronto.

### A correção

O relógio do julgamento passa a ser o da volta, **adiantado até o quadro mais novo que
espera na fila** (`Auditoria._hora_de_julgar`, `Fila.mais_novo_pendente`). O adianto tem
teto de 10 minutos: a validade e a espera entre tentativas contam nesse mesmo relógio, e
um quadro com a hora errada, muito à frente, não pode arrastar a fila inteira. Se a
pergunta à fila falhar, vale a hora dada, como antes.

### Como foi conferido

- Cinco testes novos (quatro na auditoria, um na fila): o quadro lido 3 s depois do começo
  da volta é julgado na mesma volta; o de uma hora à frente espera o relógio chegar; a
  espera entre tentativas não é atropelada (conferida no segundo exato); a pergunta que
  falha não para o julgamento; e "o mais novo que espera" não conta o que já saiu.
- 11 mutações, nenhuma viva. A suíte inteira do agente passa.

### O que não foi medido

- **O ganho na loja.** A conta diz que a resposta passa a sair no fim da captura da
  própria volta (poucos segundos, com dois canais), e não 10 a 30 s depois. O número de
  verdade só existe depois da troca do pacote.
- O limite de dez análises por volta (`LIMITE_POR_PASSADA`) continua: com muitos critérios
  no mesmo instante, o que passar de dez sai na volta seguinte. Fica para o passo 1.

## 12/10/2026 · O passo 0 do A20: o que as medições disseram

O dono autorizou o passo 0 na manhã de 12/10 ("pode trazer para a medição do passo 0 e
pode guardar à parte no computador da loja"; "pode começar o passo 0"). Tudo aqui é
medição: nada mudou na loja além de uma pasta nova, e o único código que mudou foi a
correção do registro acima.

### 1 · Onde ficavam os 18 s

Achado e corrigido: o registro acima (ERR-108).

### 2 · As imagens que a nuvem julgou, guardadas

As 1.722 imagens julgadas pela nuvem em 07 e 08/10 foram copiadas, no computador da loja,
para `C:\Farol\guardado\exemplos-da-nuvem-2026-10\` (93 MB), com o registro de cada
resposta (`registros.csv`) e um `LEIA.txt`. A limpeza de 15 dias do agente não apaga essa
pasta. Uma cópia veio para a medição e ficou só na pasta temporária da sessão.

### 3 · A memória por vetor

O modelo é o previsto no desenho (SigLIP 2 base, em ONNX; vetor de 768 números; o arquivo
foi conferido pelo sha256 publicado). Três jeitos de tirar o vetor: **inteiro** (a imagem
achatada para 224×224, como o agente tem escrito), **reduzido** (o mesmo, no modelo
quantizado) e **em pedaços** (três quadrados — esquerda, meio, direita —, e a média deles).

**A cena repetida.** Para cada análise paga, a cena mais parecida já julgada no mesmo
critério (1.717 análises com alguma anterior):

| jeito | semelhança de pelo menos | a memória teria respondido | com a mesma resposta da nuvem |
|---|---|---|---|
| inteiro | 0,99 | 638 (37%) | 638 (100%) |
| inteiro | 0,98 | 887 (52%) | 883 (99,5%) |
| inteiro | 0,95 | 1.420 (83%) | 1.328 (93,5%) |
| em pedaços | 0,995 | 612 (36%) | 612 (100%) |
| em pedaços | 0,99 | 870 (51%) | 868 (99,8%) |
| a impressão da imagem, que o motor já tem (medida de 12/10) | idêntica | 676 (39%) | 675 |

Para "não pagar de novo pela mesma cena", o vetor dá o mesmo que a impressão que já existe.
E quase tudo o que ele repetiria é "não deu para avaliar": em 0,98, das 887, 873.

**Separa o "fora" do "dentro"?** Só as análises que a nuvem avaliou; para cada uma, o
vizinho mais parecido entre as outras avaliadas do mesmo critério, sem contar as cenas a
menos de 10 minutos (são quase a mesma imagem):

| critério | avaliadas (dentro · fora) | inteiro | reduzido | em pedaços | dizer sempre a maioria |
|---|---|---|---|---|---|
| gaveta do caixa | 31 (17 · 14) | 71% | 74% | **87%** | 55% |
| touca e uniforme | 51 (13 · 38) | 55% | 67% | 71% | **75%** |
| chapa | 30 (1 · 29) | — | — | — | não dá para medir: quase uma resposta só |
| ingredientes | 127 (127 · 0) | — | — | — | não dá para medir: uma resposta só |

**Pela régua do dono** (a memória guarda só o que a nuvem avaliou com confiança de 0,85 ou
mais), com o vetor em pedaços, sobre as 204 respostas firmes que vieram depois da primeira:

| semelhança de pelo menos | a memória teria respondido | com a resposta contrária |
|---|---|---|
| 0,98 | 20 (10%) | 2 |
| 0,95 | 174 (85%) | 22 (12,6%) |
| 0,93 | 200 (98%) | 25 (12,5%) |

O que isso diz:

1. **A memória pela imagem inteira não pode valer para critério de detalhe.** Na touca ela
   acerta menos do que "dizer sempre a maioria", nos três jeitos. Onde ela responde muito
   (0,95), responde o contrário em 1 de cada 8 — a meta do plano é 1 em 50.
2. **O recorte muda o resultado.** Na gaveta, tirar o vetor em pedaços levou de 71% para
   87%. É a mesma direção do pedido do dono: analisar a área certa, e não a imagem toda.
   Para a touca, o recorte certo é a pessoa (a cabeça), e não o quadro.
3. **O gabarito é fraco.** As "respostas certas" aqui são as da nuvem do jeito antigo, e ela
   mesma respondeu diferente a cenas quase iguais. Sem os exemplos marcados pelo responsável
   ("acertou / errou"), nenhuma dessas porcentagens é acerto de verdade. As amostras são
   pequenas (31 e 51).
4. **O plano muda aqui, como estava combinado:** a memória só passa a valer (passo 4)
   depois do caderno com a prova (passo 3) e com o vetor do recorte certo — a medir de novo
   quando houver exemplo marcado.

Achados de passagem, no código que ainda não está ligado: `EmbedderSigLIP.embed` pega a
**primeira** saída do modelo, que neste arquivo é a tabela de 196 pedaços (150.528
números), e não o vetor de 768 (`pooler_output`); e o agente não tem o endereço nem o
sha256 do modelo, como tem para o detector. Os dois se acertam ao montar o juiz de
comparação (passo 2).

O tempo do vetor **na máquina de desenvolvimento** (não na da loja): 138 ms com o modelo
inteiro e 115 ms com o reduzido.

### 4 · O que o "Propor o estudo" daria aos quatro critérios pagos

A função de regras do servidor, chamada com o texto de cada critério e com os canais como
estão na loja (sem cena escrita, sem papel nos quadros, sem foto padrão):

| critério | o que ela propõe |
|---|---|
| touca e uniforme | só com gente no lugar; quando alguém entra; e a cada 5 minutos |
| gaveta do caixa | com o lugar livre; quando quem mexeu sai da frente; e a cada 10 minutos |
| chapa | o caminho geral (não achou palavra conhecida no texto): com o lugar livre; quando para; e a cada 10 minutos |
| ingredientes da montagem | o caminho geral: o mesmo |

Ou seja: as portas do funil que seguraram zero olhadas se ligam com um clique por critério
("Propor o estudo", ler e confirmar). A da touca é a mesma "há alguém aqui?" que teria
segurado 49% das análises pagas dela sem perder resposta.

### 5 · O movimento por área, na gravação

A gravação de domingo, 11/10, lida no computador da loja pelo caminho do agente: duas
leituras por segundo, o quadro reduzido ao tamanho do fluxo menor (medido: 704×480) e a
**mesma conta de movimento que o agente já usa** (a área reduzida a 96×54; ponto que saltou
mais de 24; 1,2% dos pontos). Só números saíram; nenhuma imagem foi gravada. Cada trecho
tem perto de 30 minutos.

| canal · área · hora | com movimento | "assentou" com 3 s · 5 s · 10 s de calma | "parou" visto a cada 10 s | "parou" visto a cada 30 s | o maior trecho calmo |
|---|---|---|---|---|---|
| 4 · o tampo · 19h (abertura) | 11% | 26 · 23 · 11 | 11 | 6 | 8 min 36 s |
| 4 · o tampo · 21h (pico) | 62% | 43 · 33 · 16 | 15 | 3 | 64 s |
| 4 · o tampo · 2h (fim do serviço) | 62% | 41 · 29 · 16 | 9 | 3 | 75 s |
| 13 · o quadro do colaborador · 21h | 49% | 48 · 26 · 14 | 12 | 3 | 82 s |
| 6 · a chapa (imagem inteira) · 21h | 53% | 60 · 32 · 12 | 11 | 1 | 101 s |

"Assentou" é a área ficar calma pelo tempo dito depois de ter mexido; "acordou" (duas
leituras seguidas com movimento) deu os mesmos números, ou um a mais.

O que isso diz:

1. **A olhada de 30 s não serve de gatilho no pico.** Às 21h, de 58 olhadas no tampo, 50
   acharam "algo mudou": quase sempre mudou. E ela viu 3 dos 33 a 43 momentos em que o
   tampo parou.
2. **Ler sempre e analisar no "assentou" dá menos análises, e nos instantes certos.** A
   rotina faz 120 olhadas por hora. Com a análise saindo quando o tampo assenta por 5 s:
   46 por hora na abertura, 68 no pico e 62 no fim do serviço (menos 43% a 62%). Com 10 s:
   22, 33 e 34 por hora (menos 71% a 81%). E cada uma sai com as mãos fora da cena.
3. **O repouso existe mesmo com a loja aberta:** o tampo ficou calmo em 89% do tempo na
   abertura e em 38% no pico.
4. **O clarão precisa de filtro.** Às 2h a área inteira mudou de uma vez 85 vezes em 28
   minutos (às 19h, nenhuma; às 21h, uma). Sem filtro, cada uma acordaria o quadro.
5. **A conta é barata:** perto de 2 ms por leitura e por área, já com a redução do quadro
   principal, que o fluxo menor ao vivo dispensa.
6. Comparar com a média dos quadros anteriores, como o Frigate faz, deu **menos**
   acontecimentos e mais tempo "em atividade": para achar o instante em que a área parou, a
   diferença entre leituras seguidas, que o agente já usa, serviu melhor.

A medida de 09/10 (na chapa, 11 "parou" a cada 10 s contra 1 a cada 30 s, em meia hora) se
repetiu igual nesta gravação.

### 6 · O tempo do vetor no computador da loja

Medido lá, com 40 das imagens guardadas, 60 vetores por jeito (o modelo foi baixado para
uma pasta de medição e apagado em seguida):

| jeito | por vetor (mediana) |
|---|---|
| modelo inteiro, na placa de vídeo | 78 ms |
| modelo inteiro, no processador | 98 ms |
| modelo reduzido, no processador | 75 ms |
| modelo reduzido, na placa de vídeo | 365 ms |

Preparar a imagem leva 1,2 ms. O vetor custa o mesmo que uma passada do detector (91 ms):
a máquina da loja aguenta, desde que ele saia por acontecimento, e não a cada leitura. O
modelo reduzido não é atalho: o vetor dele é outro (semelhança de 0,77 com o do modelo
inteiro, no mesmo quadro) e na placa de vídeo ele é quatro vezes mais lento. A internet da
loja baixou o modelo a 7 Mbit/s.

### 7 · O que não foi medido

- **Reconhecer o que foi apresentado** (a foto padrão e as fotos do inventário): a loja não
  tem foto padrão guardada. Depende de o responsável cadastrar referências.
- **O acerto de verdade** de qualquer juiz: falta o exemplo marcado pelo responsável.
- **O vetor do recorte certo** (a pessoa, na touca; a gaveta, no caixa): a medir quando
  houver exemplo marcado.
- **O ganho na loja** da correção do relógio do julgamento e do repouso por movimento: só
  com o pacote trocado.
- **Movimento pequeno em quadro pequeno:** os dois quadros da loja são grandes (699×393 e
  440×382 no fluxo menor). Quadro pequeno ainda não existe para medir.

O que ficou na loja: só a pasta `C:\Farol\guardado\`. Os roteiros desta medição e a pasta
de medição foram apagados de lá; os roteiros de leitura de sessões anteriores continuam, e
saem no primeiro passo da proteção.

## 12/10/2026 · O pacote compilado, ensaiado (o primeiro passo da proteção)

O dono respondeu em 12/10 que o primeiro passo da proteção entra já, com os passos 1 e 2
do núcleo. Antes de mexer no pacote que vai para a loja, um ensaio na máquina de
desenvolvimento, numa cópia fora do repositório. **Nada mudou no repositório nem na loja.**

| o quê | o resultado |
|---|---|
| compilar os 63 arquivos do agente num módulo de máquina (Nuitka, com o compilador da Microsoft, no Python 3.14) | 1 min 37 s; um arquivo só, de 4,1 MB |
| a suíte do agente contra o módulo, num espelho do repositório **sem o texto do agente** | **1.302 de 1.306 passam** (contra o texto, 1.306 de 1.306) |
| os 4 que falham | 3 leem o texto do próprio programa para conferir as opções da linha de comando — no módulo não há texto para ler; 1 espera o arquivo do detector de rosto dentro da pasta do pacote — o módulo não leva arquivo de dados, ele vai ao lado |
| o que continua legível dentro do módulo | os textos fixos: o nome dos modelos, as mensagens e as instruções mandadas à nuvem (procurados e achados no arquivo) |

O que isso diz:

1. **O pacote compilado é viável com o que o agente usa hoje.** Nenhum dos quatro testes
   que falham é de comportamento.
2. **Ele esconde o "como", e não os textos.** A lógica vira código de máquina; o que está
   escrito por extenso continua lá. As instruções só saem da loja quando a dúvida passar
   pelo nosso servidor (passo 2) — ou com a versão paga do compilador, que embaralha os
   textos (€ 250 por ano, pelo site do fabricante, lido em 12/10).

O que falta para valer na loja: os três testes passarem a conferir as opções de outro
jeito; o arquivo de dados ir junto; o roteiro de troca do pacote aceitar o módulo no lugar
da pasta; a assinatura do arquivo, que pede um certificado de assinatura de código (compra
do dono); e a prova na loja, com o "pode".

## 12/10/2026 (tarde) · As respostas do dono ao passo 0, o pacote trocado na loja e a resposta vazia guardada (fatia 1.3, migration 042)

### O que o dono respondeu

Na página do passo 0, à tarde:

1. **Trocar o pacote do agente na loja:** "pode trocar o pacote, fora do horário de
   movimento."
2. **A leitura contínua (fatia 1.2):** "aprovo as duas partes: contar primeiro, agir depois
   de uma semana de números."
3. **A resposta guardada da cena idêntica (fatia 1.3):** "só a resposta vazia, por 2 horas."
4. **A régua do que a nuvem ensina:** "avaliou, com confiança de 0,85 ou mais, e com uma
   amostra conferida por gente antes de valer."

A régua fecha o que faltava para o passo 3 (o caderno com a prova): a resposta da nuvem só
vira exemplo se avaliou, com confiança de 0,85 ou mais, e depois de uma amostra das
respostas daquele critério ter sido conferida por uma pessoa.

### O pacote trocado na loja

Em 12/10, às 16h43, com a loja fechada (ela abre às 19h). O pacote é o da `main` em
`9831ae0`: em relação ao que estava lá (o de 11/10), muda só a correção do relógio do
julgamento (ERR-108, a fatia 1.1) — dois arquivos. O agente subiu sem aviso nem erro, com a
mesma configuração; o pacote anterior ficou guardado ao lado. **O tempo da imagem até a
resposta, com a correção, se mede com a loja aberta** — ainda não foi medido.

### A conta refeita antes de programar a fatia 1.3 — e o que estava errado

A regra do dono foi simulada sobre as 1.722 análises que a nuvem julgou em 07 e 08/10,
andando no tempo como o motor andaria: a olhada segurada não cria resposta nova, e a
resposta mais nova da mesma cena é a que vale.

| por quanto tempo a vazia vale | seguradas (das 1.722 pagas) | o que a nuvem respondeu de verdade nelas | reais poupados (de 22,44) |
|---|---|---|---|
| 30 minutos | 639 (37,1%) | 638 vazias · 1 "fora" | 8,37 |
| 1 hora | 658 (38,2%) | 657 vazias · 1 "fora" | 8,62 |
| **2 horas** | **670 (38,9%)** | **669 vazias · 1 "fora"** | **8,78** |
| 4 horas ou mais | 671 (39,0%) | 670 vazias · 1 "fora" | 8,79 |

Depois de uma resposta vazia, a cena idêntica voltou em até 1 minuto 305 vezes, entre 1 e 5
minutos 303, entre 5 e 30 minutos 50, entre 30 minutos e 2 horas 13, e nunca depois de 2
horas: as 2 horas cobrem tudo o que foi medido.

**O erro.** A página do passo 0 e o roteiro diziam que guardar só a resposta vazia não tinha
"risco de esconder um 'fora'". Tinha: em 08/10, no critério de touca e uniforme, a mesma
impressão de imagem recebeu "não deu para avaliar" (confiança 0,2) e, na olhada seguinte,
37 segundos depois, "fora do critério" (confiança 0,85). Com a regra na forma simples, a
segunda pergunta não teria sido feita. É 1 das 81 respostas "fora" do período. O número
estava na medição ("das 81 respostas 'fora', uma tinha cena idêntica já julgada — e a
resposta guardada era outra"); faltou conferir que a "outra" era justamente a vazia.

**A variante medida.** Guardar só depois de a nuvem devolver vazio mais de uma vez
**seguida** para a mesma cena:

| vazias seguidas antes de guardar | seguradas | delas, "fora" | reais poupados |
|---|---|---|---|
| 1 (a forma simples) | 670 (38,9%) | 1 | 8,78 |
| **2** | **556 (32,3%)** | **0** | **7,27** |
| 3 | 495 (28,7%) | 0 | 6,48 |
| 5 | 418 (24,3%) | 0 | 5,47 |

A amostra é pequena (81 respostas "fora"; um caso). O que ela mostra é a direção: a mesma
impressão pode receber duas respostas, e pedir a vazia duas vezes tira o caso visto por
R$ 1,51 no período (114 análises a mais).

### A regra, como ficou no motor

- **Só a resposta vazia que veio da nuvem é guardada**, e **por 2 horas** contadas da cena
  da última vazia paga. A olhada segurada não renova o prazo.
- **A guarda vale depois de duas vazias seguidas** para a mesma cena. É uma constante
  (`VAZIAS_PARA_GUARDAR`); com 1 ela é a forma simples. **A escolha entre as duas é do
  dono**, e a loja só recebe a fatia depois dela (a troca do pacote pede o "pode").
- **A mesma cena** é a mesma pergunta: o critério e a redação dele, o canal, o quadro e a
  impressão da imagem que sairia — idêntica, e não "parecida".
- **A resposta mais nova é a que vale:** um "dentro" ou um "fora" para a mesma cena desfaz
  o que estava guardado. Nenhum dos dois é repetido de memória.
- **A olhada segurada não confirma nem desmente:** como o "não deu para avaliar" de
  verdade, não anda nem zera a espera do "avisar só se continuar".
- **A guarda mora na memória do motor**, que é montado de novo a cada mudança de
  configuração da loja e a cada partida do programa. Mexeu no quadro, na resolução, na
  cena escrita ou no modelo: a próxima olhada pergunta de novo. A resposta de uma olhada
  que já esperava na fila quando a configuração mudou não conta. Passado o prazo, a vazia
  sai da memória — é o que faz a contagem recomeçar da primeira.
- Presença e contagem não passam por ela: ali cada olhada é a medida.

### O resumo da hora e o sinal "não conseguiu avaliar"

A olhada segurada é uma "já julgada" — o desfecho continua um dos dez. À parte, o resumo
passa a levar **quantas das "já julgadas" foram seguradas pela resposta vazia guardada**
(`vaziasGuardadas` no contrato, `resumo_hora.vazias_guardadas` na migration 042; opcional:
agente antigo não manda, e fica zero).

Ela existe por causa de uma conta. O sinal "X não conseguiu avaliar N% das vezes em tal
canal" pedia pelo menos 10 análises, com metade ou mais vazias. Com a guarda, o canal em
que a nuvem **nunca** consegue avaliar passaria a ter duas análises pagas a cada duas
horas: o sinal que mais importa levaria perto de dez horas para aparecer. Agora ele conta
as **vezes em que o critério pediu resposta** — as análises e as olhadas seguradas —, e a
segurada conta como uma vez em que não deu para avaliar. A frase da tela é a mesma. Os
números da tabela ("análises", "sem avaliar") continuam sendo do que foi julgado de
verdade.

### Como foi conferido

- **Agente:** 30 testes novos; a suíte inteira passa (1.336). 44 mutações, nenhuma viva. A
  primeira rodada deixou duas vivas, as duas na mesma conferência — a contagem que
  recomeçava depois de vencer estava escrita duas vezes (na anotação da resposta e na
  limpeza da memória); ficou só na limpeza.
- **Servidor:** a validação (a segurada nunca passa das "já julgadas"), a gravação (a hora
  que sobe de novo substitui), o sinal (com as contas à mão) e o caminho inteiro, do corpo
  do agente até a tela de resultados, com dois canais — num a nuvem não avalia, no outro
  avalia. 24 mutações, nenhuma viva.
- **A migration 042**, aplicada duas vezes no banco local: uma coluna, zero de fábrica,
  nenhuma linha existente alterada.
- **O pior caso do caminho novo** (a hora em que toda olhada foi segurada: 120 "já
  julgadas", nada julgado) é aceito pela validação do resumo.

### O que não foi medido

- **O ganho na loja.** A conta acima é sobre dois dias, com a pergunta do jeito antigo. Os
  quatro critérios pagos não estão na configuração de hoje; com eles de volta, com o estudo
  ligado e com a pergunta com contexto, a nuvem deve responder mais, e a guarda segura
  menos.
- **Quantas vezes a configuração muda por dia** numa loja em operação (cada mudança zera a
  guarda): no piloto mudou muito, porque está sendo montado.
- **Se a variante de duas vazias esconde algum "fora"** numa amostra maior: em 81, nenhum.

Lido no código ao fazer esta fatia: a cena que o motor dá como **repetida** (parecida com
uma de até 30 s antes) contava como "continua fora" para o "avisar só se continuar", mesmo
quando a cena repetida não era a que estava fora. Reproduzido e corrigido no registro
abaixo (ERR-110).

## 12/10/2026 (tarde) · O aviso de "continua fora" saía de uma cena que ninguém avaliou (ERR-110)

Defeito no coração do aviso, achado ao escrever a fatia 1.3 e corrigido em seguida. Só o
agente muda, e só no repositório. **Na loja não havia como acontecer hoje:** os dois
critérios ligados são de presença, que não passam pela memória de cena repetida.

### O que acontecia

Critério valendo, com "avisar só se continuar" em 3 olhadas. Reproduzido em teste, no
passo da rotina (uma olhada a cada 30 s):

| olhada | a cena | o que o motor fez | a espera |
|---|---|---|---|
| 0 s | bancada suja | pagou a análise: "fora do critério" | 1 de 3 |
| 30 s | outra cena, que a nuvem não avalia | pagou a análise: "não deu para avaliar" | 1 de 3 (certo: não confirma nem desmente) |
| 60 s | a mesma da anterior | "cena repetida": não paga | **2 de 3** (errado) |
| 90 s | a mesma | pagou: "não deu para avaliar" | 2 de 3 |
| 120 s | a mesma | "cena repetida" | **3 de 3 — sai o aviso** |

O aviso de "continua fora" saía dois minutos depois de um único "fora", com a imagem do
primeiro, sem ninguém ter visto o fora de novo. Acontecia com e sem a resposta vazia
guardada, desde que o "avisar só se continuar" entrou.

### A causa

Toda olhada dada como "repetida" (ou "já julgada", a mesma cena no mesmo minuto) contava
como mais uma olhada em que o fora continuava. A memória de cena repetida respondia só
"é repetição de algo recente" — sem dizer **de quê**. E o que se repetia podia ser a cena
que veio depois do fora.

Os testes não viam porque andavam de 10 em 10 segundos com a mesma imagem: tudo era
repetição da primeira olhada. No passo de verdade (rotina de 30 s, memória de 30 s) a cena
parada alterna "vai a julgamento" e "repetida", e é aí que o caso aparece.

### A correção

- A memória de cena repetida passa a dizer **de qual cena** a de agora é repetição — a
  mais recente das parecidas (`Deduplicador.repeticao_de`).
- O motor lembra, pelo mesmo tempo, de que análise é cada cena que passou.
- **A cena repetida só conta como "continua fora" quando repete a cena do próprio
  julgamento fora do critério que está esperando.** Repetir uma cena que ninguém avaliou,
  uma que nem foi a julgamento (a segurada pela resposta vazia guardada) ou uma cuja
  resposta ainda não veio não conta — e também não zera a espera.
- Em presença e contagem, a mesma olhada entrando duas vezes no mesmo segundo deixou de
  contar como "mais uma".

O que continua igual: a bancada suja parada avisa na terceira olhada com uma análise paga
só; e a cena fora que volta depois de outra coisa no meio (alguém passou na frente) conta.

### Como foi conferido

17 testes novos (`agent/testes/test_continua_fora.py`), com a sequência da tabela acima, o
espelho dela, a cena "já julgada" nos dois sentidos, a cena cuja resposta demorou, presença
e dois quadros com a mesma imagem. 21 mutações, nenhuma viva — a primeira delas é o próprio
defeito de volta. A suíte inteira do agente passa.

### O que fica para depois

A frase da tela de critérios sobre o "avisar só se continuar" não muda. O que muda para
quem usa: um aviso de "continua" passa a significar que a mesma cena fora do critério foi
vista de novo, ou que uma análise nova confirmou.

## 12/10/2026 (noite) · A atenção: os estados de cada quadro, só contando (fatia 1.2a, migration 043)

O dono aprovou a leitura contínua em duas partes: "contar primeiro, agir depois de uma
semana de números". Esta é a primeira. **Nada muda no que a loja faz** — nem depois da
troca do pacote: as olhadas continuam as de hoje. O que passa a existir é a contagem.

### O que entra

Uma linha de execução própria no agente, a **atenção**, lê o fluxo menor de cada canal duas
vezes por segundo — o fluxo que já fica aberto; nenhum é aberto por causa dela — e mede
quanto cada quadro mudou desde a leitura anterior, com a mesma conta do porteiro e da
quietude. Para cada quadro que tem critério, de qualquer tipo, ela acompanha o estado:

| de | para | quando |
|---|---|---|
| repouso | **acordou** → em atividade | duas leituras seguidas com movimento |
| em atividade | **assentou** → repouso | cinco segundos medidos sem movimento, contados da última leitura que mexeu |

- **O clarão não conta.** A leitura em que mais de 60% dos pontos mudam de uma vez (a luz
  que acende, a câmera que troca para infravermelho) não é movimento nem calma. É contada à
  parte.
- **Não sei não é calma.** Sem fluxo menor, com o fluxo parado ou na primeira leitura
  depois de um buraco, não há medida: em repouso isso quebra a sequência; em atividade, os
  cinco segundos recomeçam da primeira leitura calma depois do buraco.

Os três números (duas leituras, cinco segundos, 60%) são o ponto de partida do plano, e não
medida de loja nenhuma: é para calibrá-los que a contagem existe.

### Onde a conta mora

No resumo da hora, na linha de cada critério do quadro que valia naquela hora, cinco
números: `leituras`, `comMovimento`, `claroes`, `acordou`, `assentou` (migration 043;
opcionais — agente antigo não manda, e ficam zero). A conta é do **quadro**: dois critérios
no mesmo quadro levam o mesmo número. Ela fica na linha do critério porque é ali que estão
as olhadas de hoje (`capturas`, `enfileiradas`): o que se quer comparar, critério por
critério, é "quantas análises a rotina fez" com "quantas vezes o quadro acordou ou
assentou". Fora do horário do critério não há linha.

O servidor confere (inteiros de 0 a 100.000; movimento e clarão juntos não passam das
leituras), grava e substitui pelo acumulado. **Nenhuma tela mostra isso ainda** — tela
nova passa por protótipo. Os números se leem do resumo, e é com uma semana deles que se
decide a segunda parte.

### Como foi conferido

- **Agente:** 36 testes novos (`agent/testes/test_atencao.py`): a máquina de estados com as
  medidas dadas pelo teste, para os limites exatos; com a imagem de verdade (a mão que entra
  e muda de lugar acorda; o que mexe fora do quadro não; a luz que muda a cena inteira é
  clarão); a conta por hora; dois canais; e, pela auditoria, que a conta vai para a linha de
  cada critério do quadro, que o critério fora do horário não leva, e que **nenhuma olhada
  a mais e nenhuma análise** acontecem por causa dela. 61 mutações, nenhuma viva (a primeira
  rodada deixou uma, num teste que não distinguia "sem com o que comparar" de "igual à
  anterior": o teste foi apertado).
- **Servidor:** a validação campo a campo, a gravação e a substituição pelo acumulado. 27
  mutações, nenhuma viva.
- **A migration 043**, aplicada duas vezes no banco local: cinco colunas, zero de fábrica,
  nenhuma linha existente alterada.
- A quietude (o quadro de bancada que espera as mãos saírem) não mudou de comportamento: a
  conta de movimento dela passou a ser uma função dividida com a atenção, e os testes dela
  passam como estavam.

### O que não foi medido

- **Nada na loja ainda:** a atenção só roda lá depois da troca do pacote, com o "pode".
- **O custo de processador ao vivo.** Na gravação a conta levou perto de 2 ms por leitura e
  por área; com dois quadros são perto de 8 ms por segundo. Ao vivo, com todos os canais,
  mede-se pelo uso da máquina que o agente já manda.
- **Se os três números servem** para quadro pequeno, câmera escura ou cena com reflexo: é
  o que a semana de contagem vai dizer.

## 12/10/2026 (noite) · O limite por volta, e o que não disputa com ele (fatia 1.5)

Só o agente muda, e só no repositório. Na loja de hoje nada mudaria: ela tem dois critérios,
bem abaixo do limite.

### O que acontecia

A cada volta saem para julgamento no máximo dez análises — é o que impede uma volta de
levar minutos quando a nuvem demora. Mas as dez vagas eram de todos: o que o detector julga
na própria loja, em décimos de segundo, disputava com o que vai à nuvem e leva segundos.
Numa loja com doze critérios olhados no mesmo instante, dois ficavam para a volta seguinte,
fossem de onde fossem — e, pela conta, com mais critérios do que vagas a cada volta a fila
cresce até as análises vencerem (não foi visto acontecer: a loja de teste nunca teve tantos).
E a ordem era a do instante da imagem: a resposta de um décimo de segundo esperava atrás da
de dois segundos.

### O que entra

- O que o **detector** julga na loja (presença e contagem) tem o limite dele — cem por
  volta — e não gasta o da nuvem, que continua em dez.
- Dentro da mesma prioridade, sai na frente. A urgência continua acima de tudo, e cada grupo
  continua saindo do mais velho para o mais novo.
- "Julgado na loja", aqui, é só o que o seletor entrega ao detector, apurado uma vez por
  versão da configuração. A comparação com a foto padrão (que passa adiante o que não é
  igual) e o modelo local (que pode levar segundos) continuam no limite de dez.
- O limite de cem existe para a fila acumulada — o programa que ficou parado, a câmera que
  voltou — não segurar a volta inteira.

### Como foi conferido

13 testes novos (`agent/testes/test_limite_por_volta.py`): na fila (os dois limites, a
ordem, a urgência, o que ainda não está pronto, mais de um critério da loja — com as
análises entrando na fila da mais nova para a mais velha, para a ordem de chegada discordar
da de saída), no motor e pela auditoria, com doze critérios de presença e doze de estado
num canal: os doze de presença saem na mesma volta, a nuvem fica com dez, e os dois que
sobram saem na seguinte. 24 mutações, nenhuma viva. A suíte inteira do agente passa.

### O que não foi medido

O tempo de uma volta com muitos critérios de verdade: a loja de hoje tem dois. O limite de
cem é conta, e não medida — o detector levou 91 ms por análise no computador do piloto, e
cem por volta dariam perto de nove segundos numa máquina igual. Com a segunda loja, mede-se.

## 12/10/2026 (noite) · O custo da leitura contínua, medido — e o desenho do quadro guardado

A atenção lê cada quadro duas vezes por segundo, o dia inteiro. Antes de ela ir para a
loja, o custo de uma leitura foi medido **na máquina de desenvolvimento** (não na da loja),
com a imagem no tamanho do fluxo menor (704×480).

### O que foi medido

Por leitura de um quadro (recortar, apagar o que é de fora do desenho, cinza, reduzir e
comparar):

| o quadro | antes | depois |
|---|---|---|
| a imagem completa | 0,84 ms | 0,35 ms |
| um quadro retangular, meia imagem | 0,19 ms | 0,15 ms |
| um quadro desenhado por pontos, grande (80% × 80% da imagem) | 2,89 ms | 0,29 ms |
| um quadro desenhado por pontos, pequeno (25% × 25%) | 0,23 ms | 0,06 ms |

Uma volta de leitura inteira, com uma fonte de mentira que copia o quadro a cada vez (a de
verdade não copia: é um teto):

| a loja | antes | depois | a duas por segundo, depois |
|---|---|---|---|
| 2 canais, 2 quadros cada | 2,8 ms | 1,6 ms | 0,3% de um núcleo |
| 6 canais, 2 quadros cada | 8,4 ms | 4,0 ms | 0,8% |
| 6 canais, 3 quadros cada (um por pontos, grande) | 26 ms | 18 ms | 3,6% |
| 16 canais, 3 quadros cada | 191 ms | 48 ms | 9,6% |

### O que mudou

O que pesava era o quadro desenhado por pontos: a cada leitura o desenho era refeito e o
que ficava de fora era apagado na imagem em cores. Agora o desenho de cada quadro é feito
uma vez (por desenho e por tamanho de imagem) e guardado, e o cinza vem antes do apagar.

**O resultado é o mesmo, ponto a ponto** — a medida de movimento já foi calibrada com ele.
Conferido contra a conta de antes em oito desenhos (a imagem completa, retângulo, triângulo,
por pontos, pequeno, encostado e passando da borda, sem área), quatro tamanhos de imagem, em
cores e em cinza; e a imagem que vem da fonte não é alterada. 44 testes novos
(`agent/testes/test_reduzir.py`), 11 mutações, nenhuma viva. A quietude e a atenção passam
como estavam.

### O que isso diz

1. **Na loja de hoje o custo é desprezível** (dois quadros: frações de 1% de um núcleo na
   máquina de desenvolvimento; a da loja é mais lenta, e ainda assim sobra).
2. **O que resta é a redução da imagem**, que cresce com o tamanho do quadro. Numa loja
   com muitos canais, o próximo passo — só se a medida ao vivo pedir — é reduzir a imagem
   do canal uma vez e recortar os quadros dela. Isso muda a conta em casas decimais, e por
   isso não entrou agora: pede calibrar de novo.

### O que não foi medido

O custo no computador da loja, ao vivo: aparece no uso da máquina que o agente já manda,
comparando os dias de antes e de depois da troca do pacote.

## 12/10/2026 (noite) · A fatia 1.1 medida na loja — e o que a medida pediu em seguida (fatia 1.1b)

### A medida

Com a loja aberta (19h08 a 19h18 de 12/10), o pacote trocado às 16h43 e os mesmos dois
critérios de presença de antes. Um roteiro de leitura olhou a fila do agente de meio em
meio segundo e anotou, com o relógio de parede, quando cada análise capturada passou a ter
resposta. Só leitura, só números; o roteiro foi apagado da loja em seguida.

| da imagem capturada até a resposta existir | antes (11/10, pacote anterior) | depois (12/10, 19h08–19h18) |
|---|---|---|
| critério do canal que a volta abre primeiro | mediana de 13 s; 9 em 10 em até 32 s | mediana de 2,9 s; 9 em 10 em até 3,6 s; a maior, 3,7 s (19 análises) |
| critério do canal que a volta abre por último | mediana de 11 s; 9 em 10 em até 21 s | mediana de 1,3 s; 9 em 10 em até 1,6 s; a maior, 1,7 s (24 análises) |

Em 92% das leituras a fila estava vazia; o item que mais esperou foi visto esperando 3,2 s
depois da captura. Das 43 análises, 14 entraram e saíram entre duas leituras. O registro do
agente desde a troca não tem aviso nem erro.

Duas ressalvas da medida: os números de antes são do relógio do próprio motor, lidos da
fila, e os de depois são do relógio de parede, com até 1,5 s a mais (a fila guarda a hora
da captura sem a fração de segundo, e a leitura é de meio em meio segundo) — a diferença
real é um pouco maior do que a tabela mostra. E o campo "julgado em" da fila deixou de
servir para medir espera: depois da correção ele é o relógio da volta, adiantado até o
quadro mais novo.

### O que ela pediu

O critério do primeiro canal leva 1,6 s a mais que o do último. É o tempo de abrir o
segundo canal: a volta abre os canais um a um, e só julgava no fim. Com dois canais é
pouco; com seis, a resposta do primeiro esperaria a abertura de cinco — perto de oito
segundos, pela conta (cada canal leva de um a dois segundos para abrir).

### O que entra (fatia 1.1b)

**O que o detector julga na loja sai logo depois de cada canal**, antes de o seguinte ser
aberto — na olhada de rotina e na olhada extra do vigia. O que vai à nuvem continua no fim
da volta: uma chamada de segundos no meio da captura atrasaria os canais que faltam. O
aviso que nasce no meio da captura é devolvido pela volta e sobe nela, como antes.

Conferido: 8 testes novos (`agent/testes/test_julgar_por_canal.py`), com três canais e um
diário da ordem em que as coisas acontecem — captura do canal, detector daquele canal,
captura do seguinte —; a nuvem só depois da última captura; a falha no meio que não impede
os outros canais; o aviso que não se perde. 10 mutações, nenhuma viva. A suíte do agente
passa.

### O que não foi medido

O ganho da fatia 1.1b na loja: só com a troca do pacote. Com os dois canais de hoje a conta
dá perto de 1,6 s a menos no critério do primeiro canal. E o tempo até o aviso **chegar a
alguém** (o envio para o servidor e dali para a pessoa) continua sem medida de ponta a
ponta: o que se mediu foi até a resposta existir na loja.

