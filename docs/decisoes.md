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
