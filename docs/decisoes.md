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

## 12/10/2026 (noite) · A forma da resposta guardada e a próxima troca do pacote: o que o dono respondeu

Ao relatório da noite, com as duas decisões que faltavam:

1. **A forma da resposta vazia guardada:** "a recomendada" — guardar só depois de **duas**
   respostas vazias seguidas para a mesma cena. É como a fatia 1.3 já estava no repositório
   (`VAZIAS_PARA_GUARDAR = 2`): nada a mudar no código.
2. **A próxima troca do pacote do agente na loja:** "pode". Ela leva, de uma vez, as fatias
   1.1b, 1.2a, 1.3 e 1.5, a correção do aviso de "continua fora" (ERR-110) e o ajuste de
   custo da leitura contínua — o pacote da `main` em `b9c99de`. É feita fora do horário de
   movimento: depois do fechamento das 3h de 13/10, ou antes da abertura das 19h.

O que se confere depois da troca: o registro do agente sem aviso nem erro; a fila com as
colunas novas do resumo; e, com a loja aberta, o tempo da imagem até a resposta de novo
(esperado, pela conta: perto de 1,3 s nos dois critérios) e as primeiras contagens da
atenção. A semana de números da leitura contínua conta a partir dessa troca.

## 12/10/2026 (noite) · O balcão: o plano para a dúvida passar pelo nosso servidor, e o que foi medido para ele

O dono respondeu em 12/10 que "a dúvida passa pelo nosso servidor" e que o primeiro passo da
proteção entra "já, com os passos 1 e 2 do núcleo". Este é o plano para isso — **à espera da
aprovação dele; nada foi programado e nada mudou na loja**. As fases estão no
[roadmap](roadmap.md), seção A20, "O balcão, em fases".

### Como é hoje (lido no código)

- **Na loja:** a chave da plataforma, no ambiente do processo do agente, lida em dois pontos
  (`juizes/nuvem.py` e `descrever.py`); três textos de instruções — o pedido de sempre, o
  pedido com contexto e a descrição de equipamento, 124 linhas ao todo; os nomes dos
  modelos, a regra da reconsulta, os rótulos e a ordem das partes do pedido; a tabela de
  preço e a conta do custo.
- **No servidor:** nenhuma chave de plataforma e nenhuma chamada a modelo (as dependências
  da API são `fastify` e `pg`); nenhum limite de pedidos e nenhum teto de gasto; o custo que
  ele guarda é o que o agente informa (`evento`, `resumo_hora`). Tudo o que entra em TEXTO
  no pedido com contexto sai do banco dele — o critério e a descrição do processo, a cena,
  os quadros com número e papel, os equipamentos da área, a frase da planta. Da loja vêm só
  as imagens: a que se audita, o mapa do canal e o recorte da foto padrão.

### O que este plano desfaz, de propósito

Em 08/10 ("A análise única das fotos do equipamento") ficou decidido não dar chave à API:
"segredo novo em produção, e imagem de loja passando por mais um lugar". O balcão faz as
duas coisas, porque a chave e as instruções no computador da loja são o que o dono mandou
proteger. O que responde às duas razões: uma chave no lugar de uma por loja, no ambiente do
serviço e nunca em registro, com limite de gasto também do lado da plataforma; e a imagem
só em trânsito — nenhuma imagem em banco nem em registro nesta entrega.

### Três jeitos, e o recomendado

| jeito | o que resolve | o que não resolve |
|---|---|---|
| **A · o balcão dentro do nosso servidor** (recomendado) | a chave e as instruções saem da loja; teto por loja; instrução, modelo e plataforma mudam sem trocar pacote | o servidor entra no caminho de toda resposta paga |
| B · um portão pronto na frente da plataforma (Cloudflare AI Gateway, LiteLLM) | a chave sai da loja; orçamento, limite e registro prontos | quem monta o pedido continua sendo a loja: as instruções ficam lá; a imagem passa por mais uma empresa |
| C · tudo na loja, com o pacote compilado e cifrado | nenhum caminho novo | as instruções ficam legíveis no módulo compilado (ensaio de 12/10) e, cifradas no disco, aparecem na memória e no pedido que sai |

O B pode entrar depois, **atrás** do balcão, se for preciso passar sozinho de uma plataforma
para outra. Do C fica o pacote compilado, para o funil, que continua na loja. Fontes,
conferidas em 12/10: a página das chaves guardadas do AI Gateway (o pedido inteiro continua
vindo de quem chama), a das chaves virtuais do LiteLLM (pede um Postgres ao lado), a da
configuração do Frigate (a chave no arquivo de quem instala) e a das áreas de trabalho da
Anthropic (limite de gasto por mês numa área, menos na área padrão).

### O desenho

1. A loja decide que há dúvida, como hoje: o movimento, as condições do estudo, a cena
   repetida, a resposta vazia guardada.
2. Entrega ao servidor as imagens e os números de cadastro do critério, do canal e do
   quadro, com a versão da configuração que tem. Sem texto de instrução, sem chave.
3. O servidor confere o agente (`autenticarAgente`), que o critério é da loja e está na
   mesma versão, e o teto do dia; monta o pedido com o que tem no banco e com as instruções,
   que passam a existir só lá; pergunta; devolve o resultado, a confiança e o motivo; anota
   o custo e o tempo.
4. **Só o pedido com contexto é levado para o servidor.** O pedido de sempre (86% das
   análises pagas sem resposta em 07 e 08/10) fica para trás com o caminho antigo.
5. O que nunca saiu da loja continua lá: presença, contagem, o que é urgente e a comparação
   que deu "igual".

A prova da primeira fase é a igualdade: o pedido montado pelo servidor igual, letra por
letra, ao que o agente monta hoje, caso a caso. É o que mantém valendo o que foi medido em
08 e 09/10.

### O que foi medido para o plano

**O caminho** (12/10, 19h54, do computador da loja, com a loja aberta, dez vezes cada;
pedido pequeno, sem credencial):

| de onde para onde | ligação já aberta (menor · mediana · maior) | ligação nova, tudo |
|---|---|---|
| a loja → o nosso servidor | 24 · **30** · 41 ms | 121 · 139 · 166 ms |
| a loja → a plataforma (só o caminho) | 131 · **137** · 150 ms | 203 · 226 · 232 ms |

Não medido: o trecho do servidor até a plataforma. Se for igual ao da loja, o caminho cresce
perto de 30 ms, numa análise que leva 1,7 s com o pedido novo.

**O alcance do servidor, visto da loja** (o registro do agente, de 06 a 12/10; uma batida a
cada 10 s; só contagens):

| dia | batidas que falharam | maior trecho | o que foi |
|---|---|---|---|
| 06/10 (instalação) | 100 | 21 min | 89 sem resposta em 15 s, 7 de rede, 4 com o servidor em reinício (503) |
| 07/10 | 168 | 7 min | 105 em reinício, com um trecho de 6 min seguidos; 53 sem resposta; 10 de rede |
| 08/10 | 3 | menos de 1 min | rede e prazo |
| 09/10 | 7 | 4 min | 6 sem resposta e um erro do servidor (500) |
| 10/10 | 12 | 1 min | rede e prazo |
| 11/10 | 0 | — | — |
| 12/10 | 1 | menos de 1 min | prazo |

De 08 a 12/10: 23 de umas 43 mil batidas, com 71 publicações na `main` e nenhuma batida
pegando o servidor em reinício. Quando o motivo é prazo, o registro não separa "a internet
da loja caiu" de "o servidor não respondeu". A dúvida que não chega espera na fila e é
refeita em 30 s, depois em 2, 10 e 30 min (`BACKOFF_SEG`); presença e contagem não passam
por ali.

**O dinheiro** (dos testes de 08 e 09/10 e da fila de 07 e 08/10): a rotina custa de 0,10 a
0,24 centavo; a reconsulta, de 4,6 a 5,5 centavos; foram 860 análises pagas por dia, com
quatro critérios → de R$ 0,86 a R$ 2,06 por dia no pedido novo, sem a reconsulta, cuja
frequência não foi medida.

### O que fica para o dono decidir

1. A aprovação do plano (as quatro fases).
2. O teto de gasto por loja e por dia, no piloto (recomendado: R$ 5,00).
3. **Quem paga a plataforma na distribuição.** A pendência P1 (05/10) previa a conta do
   lojista, com a chave no computador da loja e nunca no console. Com o balcão a chave tem
   de estar no servidor, ou viajar a cada pedido. Recomendado: a conta do Farol como padrão,
   com teto por loja, e a do lojista como opção. Pode esperar: no piloto a conta é a do dono.

### O que não se sabe

O tempo do servidor até a plataforma; quantas vezes a reconsulta acontece com o pedido novo,
e se ela paga o que custa; o limite de pedidos por minuto da conta, que passa a ser dividido
entre as lojas; o peso, na internet da loja, da imagem na resolução da câmera; e a loja em
modo local, com o modelo dentro dela, que continuaria precisando das instruções lá (não
existe hoje).

## 12/10/2026 (noite) · O borrão de rosto desligava calado em pasta com acento (ERR-111)

Achado ao rodar a suíte do agente contra o pacote compilado, num espelho debaixo de
`C:\Users\Usuário\…`: o detector de rosto não abria, com o arquivo do modelo no lugar certo.

**O defeito.** O leitor de modelo do OpenCV abre o arquivo pela API ANSI do Windows, como o
`imread` (ERR-001). Com acento em qualquer pasta do caminho ele não abre; o agente tratava
isso como "não há detector nesta instalação", avisava uma vez no registro e seguia — com o
borrão ligado no critério, a imagem ia adiante com o rosto. Na loja do piloto o caminho não
tem acento (`C:\Farol\agent`), e o borrão sempre abriu; num computador instalado debaixo do
nome de uma pessoa, não abriria.

**Medido** (12/10, OpenCV 5.0.0, o mesmo arquivo, numa pasta com acento): pelo caminho,
falha; pelos bytes lidos pelo Python, abre e detecta. O ONNX Runtime 1.31, que carrega o
detector de presença e o vetor, abre pelo caminho com acento — não tinha o defeito.

**A correção.** O agente lê o arquivo e entrega os bytes ao OpenCV (`pipeline/recorte.py`,
`_abrir_yunet`), com os mesmos limiares. Se o OpenCV instalado não souber abrir pelos bytes,
vale o caminho, como antes.

Conferido: 6 testes novos em `agent/testes/test_borrao.py` — a pasta com acento; os bytes
entregues; a reserva pelo caminho, em três casos; o arquivo que sumiu — e 15 mutações,
nenhuma viva. A suíte do agente passa.

**O que fica.** A correção chega à loja na troca de pacote seguinte à desta madrugada (o
pacote `b9c99de` já estava lá quando o defeito foi achado). A loja do piloto não é afetada
enquanto isso.

## 12/10/2026 (noite) · A suíte do agente passa contra o pacote compilado — e o roteiro que o monta

O ensaio da manhã ("O pacote compilado, ensaiado") deixou quatro testes falhando contra o
módulo compilado, nenhum de comportamento. O que cada um era, e o que foi feito:

| o teste | por que falhava | o que mudou |
|---|---|---|
| `--so-haiku` nasce desligada; as opções do comando do gravador (dois testes) | conferiam lendo o TEXTO do programa, que o módulo não tem | conferem pelo analisador de verdade: o comando recebe o padrão quando a opção não é escrita, e o valor quando é |
| toda opção que `cmd_analisar` lê foi declarada | confere o que está ESCRITO: precisa do texto | igual onde há texto; contra o pacote compilado é pulado, com o motivo — e só ali, com `FAROL_PACOTE_COMPILADO=1`. Fora dali, não achar o texto é falha (`testes/conftest.py`, `texto_do_programa`, com testes próprios) |
| o detector de rosto viaja no pacote | o módulo não leva arquivo de dados dentro; e, no espelho, o caminho tinha acento | os dados vão ao lado do módulo, no caminho em que o programa os procura; o acento era o ERR-111, corrigido acima |

**O roteiro** `agent/ferramentas/pacote_compilado.sh` — fica fora do pacote da loja — faz as
duas coisas a partir de um commit: `compilar` monta o pacote (o módulo, os dados ao lado e
o `pyproject.toml`) e `testar` roda a suíte contra ele, num espelho em que o texto do agente
não está. Sai do git, e não da pasta de trabalho, para o pacote não levar arquivo solto da
máquina de quem compila.

**Medido em 12/10**, a partir do commit desta entrega (Python 3.14, Nuitka 4.3):

| o quê | o resultado |
|---|---|
| compilar os 64 arquivos do agente | 1 min 22 s (3 min na primeira vez, que instala o compilador); um módulo de 4,2 MB, com o arquivo do detector de rosto ao lado |
| a suíte contra o módulo, sem o texto do agente | **1.479 passam, 1 é pulado** (o que confere o texto), nenhum falha |
| a suíte contra o texto | 1.480 de 1.480 |

Conferido também: 21 mutações nos testes reescritos e no ajudante, nenhuma viva.

**O que continua faltando para o pacote compilado valer na loja:** o roteiro de troca do
pacote aceitar o módulo no lugar da pasta; a assinatura do arquivo, que pede um certificado
de assinatura de código (compra do dono); e a prova na loja, com o "pode". E ele esconde o
"como", não os textos: as instruções só saem da loja com o balcão (acima).

## 12/10/2026 (noite) · As fichas do Regem ganharam a embalagem do balcão: no Farol ela fica de fora, como a de viagem

O Regem passou a mandar, na leitura das fichas, `so_balcao` em cada linha — a linha só entra
na venda feita na loja: a embalagem do balcão — e `mesma_embalagem` no topo — a empresa usa
a mesma embalagem nas duas vendas. O contrato é o de lá (`docs/integracao-farol.md`, §5,
desde 12/10/2026). É só acréscimo, e o leitor do Farol não confere lista fechada de chaves:
nada quebrava.

**O que ficaria errado sem ajuste.** A linha que é só embalagem não entra na base de fichas
do Farol — não é do que o lanche é feito (decisão do dono, no cabeçalho de `api/src/fichas.ts`).
O leitor só conhecia a de viagem (`so_delivery`): a do balcão entraria como ingrediente do
lanche assim que a loja marcasse uma. Na produção, hoje, nenhuma linha está marcada
(informado pela sessão do Regem em 12/10).

**O que entrou.** `api/src/regem-fichas.ts` tira a linha marcada com `so_delivery` **ou**
com `so_balcao`. A chave `mesma_embalagem` só diz qual das duas embalagens vale em cada
venda: para o Farol as duas ficam de fora, com ela ligada ou desligada. Linha de embalagem é
só a que vem marcada com `true`.

Conferido: 2 testes novos e 1 caso a mais em `api/testes/fichas.test.ts` — a bandeja do
balcão e a caixa de viagem fora da ficha, com a chave dos dois lados; a base não muda com os
campos novos; só o `true` conta —, e 9 mutações, nenhuma viva. A amostra guardada em
`contratos/regem-catalogo-e-fichas.json` é uma resposta de verdade de antes dos campos
novos, e fica como está até a próxima captura.

No mesmo dia o Regem também passou a converter quilo e grama, litro e ml sem cadastro (a
unidade informada na ficha pode vir como "grama", "ml" ou "porção"). No Farol a unidade do
ingrediente é texto livre e só é mostrada: conferido, sem ajuste.

## 13/10/2026 (madrugada) · O pacote `b9c99de` na loja

Trocado em 13/10, às 3h08, com a loja fechada (o turno de segunda termina às 3h), com o
"pode" que o dono deu na noite anterior. Leva de uma vez as fatias 1.1b, 1.2a, 1.3 e 1.5, a
correção do aviso de "continua fora" (ERR-110) e o ajuste de custo da leitura contínua.

Conferido: a loja estava fechada e a troca ainda não tinha sido feita; o arquivo na loja era
idêntico ao daqui; o agente subiu de primeira, com a configuração de sempre e o detector na
placa de vídeo; nenhum aviso nem erro no registro, na subida e três minutos depois; as
marcas de cada fatia nos arquivos e as seis colunas novas no resumo da hora; o pacote
anterior (`9831ae0`) guardado para a volta.

As contagens da leitura contínua nascem em zero com a loja fechada, de propósito: só somam
em critério que vale na hora. A semana de números conta das 19h de 13/10. O "pode" valeu
para esta troca; a seguinte, que leva a correção do borrão de rosto (ERR-111), pede outro.

## 13/10/2026 (madrugada) · O balcão aprovado: as três respostas do dono, e o que elas mudam no desenho

À página do plano ("O balcão: o plano para a dúvida passar pelo nosso servidor"):

1. **O plano:** "aprovo as quatro fases; cada troca na loja espera o meu pode".
2. **O teto de gasto por loja, por dia, no piloto:** "até 40,00 por dia". (O recomendado
   era R$ 5,00; o teto é do dono, e ele muda sem trocar pacote.)
3. **Quem paga a plataforma, na distribuição:** "só a conta do lojista, com a chave dele
   guardada cifrada no nosso servidor".

O que a terceira resposta muda, **desde a fase 1**: a chave da plataforma não é uma do
serviço — é **uma por loja**, da conta de quem é dono da loja, guardada cifrada no banco
(do jeito que o acesso de cada loja ao Regem já é: `api/src/cifra.ts`, presa à loja), e
nunca devolvida por rota nenhuma. O piloto entra pelo mesmo caminho: a chave da loja do
piloto é a do dono. Enquanto a tela "conectar a conta de IA" não existe (é a pendência P1,
com protótipo antes), quem põe a chave é a distribuição, de dentro do serviço, por um
comando que pergunta sem mostrar o que se digita — nunca como argumento. A pendência P1
fica assim: a decisão de onde a chave mora está tomada (no servidor, cifrada); continua
aberto o cartão da tela, com o passo a passo de cada plataforma.

Com isso a regra "nada fora de um módulo presume a plataforma" vale também para a chave:
cada loja tem a plataforma dela e a chave dela, e o balcão pergunta com as duas.

## 13/10/2026 (madrugada) · O expediente de pico, guardado à parte na loja — e o que o gravador guarda

Pedido do dono: "deixe uma cópia das imagens do expediente de hoje a partir das 19:30 até as
23:59 do dia 12 que teremos muito material para testes e padrões de uso."

**O que foi medido antes de copiar** (13/10, por volta das 5h, do computador da loja):

| o quê | o resultado |
|---|---|
| até quando o gravador guarda | às 4h58 ele tinha a gravação das 12h de 12/10 e não tinha a das 11h: **perto de 17 horas**. O começo da janela pedida sumiria por volta das 12h30 de 13/10 |
| a velocidade com que ele entrega a gravação | um pedido sozinho: 0,89 MB/s, 3,1 vezes o tempo real; **dois juntos somam o mesmo** (0,47 + 0,39 MB/s) — o limite é o cabo, em 10 Mbit/s |
| o fluxo gravado | só o principal, perto de 2,2 Mbit/s por canal (1 GB por hora); o fluxo menor não é gravado |
| o relógio do gravador | 21 s adiantado em relação ao computador |

**O que se guarda:** os seis canais configurados no Farol (montagem 1, visão geral da
montagem, chapa e os três de atendimento), em pedaços de cinco minutos, em
`C:\Farol\guardado\expediente-2026-10-12\` — a pasta que o dono autorizou para guardar
material à parte. **As imagens não saem da loja.** Os outros canais do gravador não foram
copiados: não cabem no tempo. O canal da montagem vai primeiro, inteiro; os outros cinco
vão intercalados, do mais antigo para o mais novo, que é a ordem em que o gravador apaga.

Cuidados com o gravador: um pedido por vez; pedido recusado não se repete (a conta é a mesma
do ao vivo); a cópia para sozinha antes de a loja abrir. O andamento e o que entrou, pedaço
a pedaço, ficam na própria pasta (`registros.csv`).

## 13/10/2026 (manhã) · O balcão, fase 1a: o cadastro — a conta de IA de cada loja, a chave interna e o teto

A primeira fatia da fase 1 do balcão ([roadmap](roadmap.md), A20, "O balcão, em fases").
**É só o cadastro: ninguém pergunta nada a plataforma nenhuma por causa dela**, e nada muda
para quem está no ar — a chave interna nasce desligada e loja nenhuma tem conta.

**O que cada loja passa a ter** (migration 044):

| o quê | onde mora | como nasce |
|---|---|---|
| **a conta de IA** — de que plataforma é, e a chave dela | `conta_ia`, uma linha por loja. A chave é guardada cifrada (AES-256-GCM, com a chave que só o ambiente do serviço tem — a mesma que guarda o acesso de cada loja ao Regem), presa à empresa e à loja: o texto cifrado de uma loja, colado na linha de outra, não abre | nenhuma loja tem |
| **a chave interna** (a dúvida pelo servidor) | `loja.duvida_pelo_servidor` | desligada |
| **o teto de gasto por dia** | `loja.teto_duvida_centavos_dia`, em centavos, de R$ 0,00 a R$ 10.000,00 | R$ 40,00 — o que o dono fixou para o piloto |

**As regras:**

1. **A chave da conta entra e não sai.** Entra por uma rota só, é cifrada na hora, e nenhuma
   rota a devolve — nem inteira, nem um pedaço, nem cifrada. Não vai para o registro nem para
   mensagem de erro: a recusa nunca repete o que veio. Quem a lê de volta é uma função só,
   para quem vai perguntar (a fatia 1c).
2. **Ligar pede duas coisas, e a recusa diz qual falta:** o pedido com contexto ligado (o
   balcão só fala esse pedido) e a conta de IA cadastrada. **E, ligado, nenhuma das duas
   sai:** a conta não é tirada e o pedido com contexto não desliga — a ordem da volta é
   desligar o balcão, e depois o que for. As três rotas param na mesma trava da loja; no
   banco, a regra `loja_balcao_pede_contexto` é a segunda tranca, para o caminho que não
   passa por elas.
3. **Só `true` e `false` movem a chave interna**, e o teto é um inteiro de centavos. Campo
   com o nome errado é recusado, e não tomado por "não mudei nada".
4. **A versão da configuração sobe só quando a chave interna muda de lado** — é por ela que o
   agente sabe que precisa puxar a configuração. O teto e a conta são só do servidor: não
   sobem a versão, e nada deles desce para o agente. (O agente ainda não lê a chave interna:
   isso é a fase 2.)
5. **Tudo é da distribuição.** Não existe rota do console para nada disto: ele recusa os
   três campos, até do presidente. A tela "conectar a conta de IA" continua sendo a
   pendência P1, com protótipo antes.
6. **Nada fora de `api/src/balcao/` presume uma plataforma** — nem o nome, nem a cara da
   chave. Plataforma nova entra ali, e na lista da migration que guarda a conta.

**Os comandos da distribuição**, de dentro do serviço. A chave é perguntada sem aparecer na
tela; nunca vai em argumento, que fica no histórico do terminal e na lista de processos:

```
npm run provisionar -- conta-ia <lojaId> anthropic       (pergunta a chave)
npm run provisionar -- conta-ia <lojaId> tirar
npm run provisionar -- balcao   <lojaId>                 (mostra como está)
npm run provisionar -- balcao   <lojaId> ligar|desligar
npm run provisionar -- teto     <lojaId> 40,00
```

**Achado na entrega:** o comando `contexto … desligar` tratava toda recusa como "canais sem
cena". Com a recusa nova (o balcão ligado), ele passou a dizer o motivo certo e a ordem da
volta.

**Como foi conferido.** O arquivo de testes do cadastro, contra Postgres de verdade: a chave
que entra e não aparece em resposta, erro ou registro; as recusas, cada uma por um motivo
só; as duas corridas (ligar × tirar a conta, ligar × desligar o contexto: soltas juntas, só
uma passa, e a outra é recusada com o motivo); as esperas com a ordem fixa (outra conexão
para no meio do que uma rota faz, e a rota chamada nesse instante espera e decide com o que
ficou gravado); e os comandos rodando contra a API de verdade, com a chave entrando pela
entrada padrão. O roteiro de mutação estraga cada regra de propósito, uma por vez, e os
testes pegam todas. A migration foi aplicada duas vezes no banco local: nenhuma loja que já
existia mudou de versão.

**O que falta da fase 1:** a 1b — a montagem do pedido com contexto do lado do servidor,
igual, letra por letra, ao que o agente monta hoje; e a 1c — a porta que recebe a dúvida, a
chamada à plataforma, o registro do custo e o corte pelo teto. Nenhuma chamada paga antes
da fase 3.

**Em aberto, para antes da segunda loja:** R$ 40,00 é o teto que o dono deu para o piloto.
Cada loja tem o seu, e a distribuição muda com o comando `teto`; com que valor uma loja
NOVA nasce, na distribuição, é decisão dele.

## 13/10/2026 (manhã) · O balcão, fase 1b: o servidor monta o pedido igual ao do agente, letra por letra

A segunda fatia da fase 1. **Ainda ninguém pergunta nada a plataforma nenhuma:** o que
entrou é a MONTAGEM do pedido com contexto do lado do servidor (`api/src/balcao/pedido.ts`),
sem banco, sem rede e sem rota — e a prova de que ela dá o mesmo pedido que o agente monta
hoje. O agente não mudou: ganhou só um teste.

**A prova é um arquivo que os dois lados leem** (`contratos/pedido-com-contexto.json`):
31 casos, cada um com a configuração como ela desce para a loja, o item da análise e o
conteúdo do pedido que sai — ou por que não há pedido. O "esperado" de cada caso não foi
escrito à mão: é **gerado pelo código do agente**. O teste do agente confere que ele
continua montando assim; o do servidor exige o mesmo conteúdo, com as chaves na mesma
ordem. Mudou o texto de um lado, o teste do outro quebra.

| o que os casos cobrem | exemplos |
|---|---|
| as formas do pedido | critério de quadro (com o mapa em esquema e em fotografia) e critério geral (a imagem completa, sem mapa); com e sem foto padrão; a comparação que não deu "igual" |
| o que vai na pergunta | o "como deve ser" numa linha só; o aviso de que o cinza em volta foi apagado; os equipamentos da área (só os quatro primeiros que têm nome e descrição) |
| os textos da configuração | cada um com o seu teto (negócio 80, nomes 60, cena 2000, lugar 400, descrição 500 letras) e o corte dito com reticências; negócio, setor e câmera que faltam; quadro com papel desconhecido, sem nome, com número torto |
| de quem é o quê | dois canais na mesma loja; o mesmo critério em duas áreas do canal |
| o que NÃO vira pedido | canal sem a cena escrita; quadro sem o mapa; critério que saiu da configuração; presença, contagem, critério urgente e loja em modo local (nada disso vai para fora) |

**Três coisas que o porte tinha de acertar, e que um porte "no olho" erraria:**

1. **O que é espaço em branco.** O agente é Python, e o Python conta como espaço 29
   caracteres — entre eles U+0085 e U+001C a U+001F, que o JavaScript não conta; e não
   conta U+FEFF, que o JavaScript conta. O servidor usa a lista do Python (ela está no
   contrato, calculada pelo próprio Python, e os dois lados conferem).
2. **O tamanho de um texto.** O Python conta letras; o JavaScript conta unidades de 16
   bits, e um emoji vale duas. O teto e o corte, no servidor, contam letra.
3. **Papel de quadro com nome de coisa do JavaScript** (`constructor`, `toString`): no
   servidor ganharia um rótulo absurdo. Tem caso no contrato, e não ganha.

**O plano dizia "da loja só saem imagens". Saem também três fatos sobre elas**, que só a
loja sabe porque vêm dos pixels ou do que ela tem em disco, e que mudam o texto do pedido:
se o cinza em volta da área foi apagado; se o mapa do canal é o esquema ou a fotografia; e
que foto padrão a loja escolheu para ir junto. Vão como três campos pequenos, com a dúvida
(a fatia 1c). Não são lógica: são fatos sobre as imagens. Todo o resto do texto — a cena, os
quadros, o lugar, os equipamentos, o "como deve ser" — o servidor tira do que ele mesmo
guarda.

**O servidor recusa o que a loja já não manda** (segunda tranca) e confere mais do que o
agente: o critério tem de ser daquela área daquele canal; a foto padrão tem de ser daquele
canal, e só vai quando o critério pede; comparação sem a foto não pergunta.

**As instruções** (o texto fixo de como julgar) passam a morar também no servidor
(`api/src/balcao/instrucoes.ts`), geradas a partir das do agente — não redigitadas. Nenhuma
rota as devolve. O contrato não guarda o texto delas: guarda o resumo (sha256), e cada lado
confere o seu.

**Como foi conferido.** Os 31 casos, dos dois lados. Estragos de propósito, um por vez, em
cópias do código: 142 no montador do servidor e 53 no do agente — todos pegos pelos testes.
Na primeira rodada passaram sete (quatro no servidor, três no agente), e cada um teve a sua
resposta: dois eram conferência repetida no servidor (o código ficou mais simples); três
eram casos que faltavam no contrato (entraram: os papéis de quadro, a cena vazia, o nome
do setor acima do teto); e dois eram estragos que não mudavam nada (um mal escrito, e um
num trecho que só serve ao pedido antigo). No agente, o papel desconhecido vira "sem papel"
em dois lugares: tirar um só não muda o pedido, e isso ficou anotado no roteiro. A suíte
inteira da API e a do agente.

**O que falta da fase 1:** a 1c — a porta que recebe a dúvida do agente, a chamada à
plataforma com a conta da loja, o registro do custo e o corte pelo teto.

## 13/10/2026 (manhã) · O balcão, fase 1c: o servidor sabe perguntar à plataforma e ler a resposta como o agente lê

A terceira fatia da fase 1 — a que estava prevista como "a porta" foi partida em duas, e
esta é a primeira metade. **Continua sem nenhuma chamada de verdade:** entra o módulo que
leva o pedido à plataforma, com a conta da loja, e transforma a resposta em veredito
(`api/src/balcao/plataforma.ts`). Não há rota, nem banco, nem teto: isso é a 1d.

**A mesma prova, estendida.** O arquivo de contrato ganhou uma segunda parte, `respostas`:
50 casos com o que a plataforma devolve, chamada a chamada — o corpo como ela manda, ou um
erro —, e o que sai disso: o veredito, o custo e as chamadas feitas, ou o erro e se vale
tentar de novo. Como na 1b, o "esperado" é gerado pelo código do agente, e o servidor tem
de dar o mesmo.

| o que os casos cobrem | exemplos |
|---|---|
| o veredito | os três resultados; a confiança cortada entre 0 e 1; a confiança que veio em texto, ou não veio; o motivo aparado, vazio ou ausente |
| a reconsulta | confiança abaixo de 0,75 leva a MESMA pergunta ao modelo forte, e vale a resposta dele; "não deu para avaliar" nunca reconsulta; a reconsulta que falha (sobrecarga, sem permissão, resposta em texto, resultado inválido) não derruba a primeira resposta |
| a ferramenta | texto antes da ferramenta; outra ferramenta antes da certa; resposta só em texto; resultado que não existe |
| os erros | pedido recusado, chave recusada, sem permissão, modelo que não existe (não vale tentar de novo); limite, erro e sobrecarga (vale) |
| o modelo que recusa a ferramenta forçada | é chamado de novo, no mesmo modelo, com a escolha livre e o teto de saída maior |
| o custo | com escrita e com leitura de cache; contas nulas; resposta sem a conta dos tokens (sem custo — não se inventa zero) |

**O custo sai igual até a última casa:** a conta é feita na mesma ordem que o agente faz, e
o contrato compara o número inteiro, não um arredondamento. É dele que vai sair o teto do
dia.

**O que o servidor decide por conta própria** (e o agente não tem):

- **De que lado está cada erro** — da conta da loja (chave recusada, sem permissão ou sem
  crédito), do pedido, do limite da plataforma, da plataforma, ou da resposta —, para a
  porta dizer a coisa certa a quem perguntou.
- **Pedido grande demais (413) e pedido que a plataforma não entende (422) não valem
  tentar de novo.** No agente eles são tentados cinco vezes antes de desistir; o mesmo
  pedido não passa na segunda.
- **A chamada vai uma vez, com 30 segundos de limite** — o mesmo do agente. Quem repete é a
  fila do agente, que guarda em disco.
- **A chave da conta vai no cabeçalho da chamada e em mais lugar nenhum:** não entra no
  corpo, nem em mensagem de erro, nem em registro. O erro de rede não leva o endereço.

**O que vale lembrar da medição:** uma reconsulta ao modelo forte custa perto de 5,6
centavos, contra 0,1 centavo da chamada de rotina (com os números de exemplo do contrato).
É a reconsulta, e não a rotina, que gasta o teto.

**Como foi conferido.** Os 50 casos de resposta e os 31 de pedido, dos dois lados. O
transporte de verdade, contra um servidor local: os cabeçalhos, o corpo, o tempo esgotado,
a plataforma fora do ar, a resposta que não é JSON. Estragos de propósito em cópias do
código: 246 no servidor (a montagem e a chamada) e 76 no agente — todos pegos. Um passou
na primeira rodada do servidor (aceitar um bloco com o nome da ferramenta que não é chamada
de ferramenta): faltava o caso no contrato, e entrou.

**O que falta da fase 1:** a 1d — a porta que recebe a dúvida do agente, o registro de cada
pergunta e do custo dela, e o corte pelo teto do dia.

## 13/10/2026 (manhã) · O balcão, fase 1d: a porta — a dúvida entra, o teto corta antes, o custo fica registrado

A última fatia da fase 1: **o servidor está pronto**. Entra a rota que recebe a dúvida do
agente (`POST /v1/agentes/duvidas`), o registro de cada pergunta (migration 045) e o corte
pelo teto do dia. **Continua sem nenhuma chamada paga:** só a loja LIGADA pergunta por
aqui, nenhuma loja está ligada, e o agente que está na loja nem conhece este caminho (isso
é a fase 2, com a troca do pacote e o "pode").

**O caminho de uma dúvida, na ordem:**

| passo | o que acontece | se não passa |
|---|---|---|
| 1 · quem pergunta | o agente, pelo token dele; a loja sai dali, nunca do corpo | 401 |
| 2 · o corpo | as imagens e de que critério, canal e área é a dúvida; campo que não é o esperado é recusado | 422 |
| 3 · a loja está ligada? | é a primeira coisa que a loja desligada ouve | 409: o agente pergunta como sempre |
| 4 · a dúvida é repetida? | a que já foi respondida recebe a resposta guardada | — (não é paga de novo) |
| 5 · a configuração e o critério | a versão tem de ser a que a loja tem em mãos; o critério, o que ela conferiu | 409: puxa a configuração; ou descarta a dúvida |
| 6 · o pedido | montado aqui, com o texto do critério que o SERVIDOR guarda | 422: o que nunca vai para fora |
| 7 · a reserva | sob a trava da loja: o limite por minuto e o teto do dia | 429 |
| 8 · a pergunta | à plataforma, com a conta da loja, sem conexão com o banco na mão | 502, com o lado do erro |
| 9 · o registro | o veredito e o custo — ou de que lado foi o erro | — |

O formato do corpo, da resposta e de cada recusa — com o que o agente faz em cada uma — é
`contratos/duvida-do-agente.json`. O lado do agente entra na fase 2 e lê o mesmo arquivo.

**O teto não é passado nem por uma pergunta.** Antes de perguntar, soma-se o que a loja já
gastou no dia (o custo de verdade das respondidas) e o que está reservado para as perguntas
em voo; se isso mais a reserva da dúvida nova passa do teto, ela não é feita. A reserva é o
pior caso de uma dúvida — a chamada de rotina e a reconsulta, as duas com a saída no teto —,
perto de 20 centavos; quando a resposta chega, a reserva vira o custo de verdade (um décimo
de centavo, na rotina). A que falha solta a reserva. Duas dúvidas ao mesmo tempo param na
mesma trava da loja, uma de cada vez: a trava dura poucas instruções, nunca a chamada.

**Os números da porta, e de onde vêm:**

| o quê | quanto | por quê |
|---|---|---|
| o dia do teto | o dia da OPERAÇÃO da loja: vira às 6h, no fuso dela | a madrugada pertence à noite anterior, como no resto do Farol; uma loja que fecha às 3h tem um teto por noite |
| a reserva de uma dúvida | o pior caso, calculado dos preços e do câmbio (perto de 20 centavos) | para o teto não ser passado por quem está em voo |
| a entrada no pior caso | 8.000 tokens — ESTIMATIVA: três imagens e todo o texto no teto | a medir na fase 3, com a conta de tokens de verdade |
| o limite por minuto | 30 dúvidas por loja | não é teto de gasto: é a válvula contra o agente que disparou (ele pergunta no máximo dez por volta do laço) |
| a dúvida perdida | 2 minutos | o servidor caiu no meio: passado isso, a mesma dúvida pode ser tentada de novo |

**O que NÃO é guardado, de propósito:** nenhuma imagem e nenhum texto de pedido. O servidor
recebe as imagens, repassa à plataforma e esquece. Fica uma linha por pergunta: de quem, de
que critério, o veredito (o resultado, a confiança e o motivo — a mesma frase que o agente
já manda quando o critério vira aviso), o modelo, os tokens e o custo. No registro do
serviço vão o resultado e o custo; do erro, o lado dele e o que a plataforma disse — nunca
a imagem, o pedido ou a chave. À loja o erro chega com uma frase nossa, e não com a da
plataforma.

**A conta do dia, para a distribuição:** `npm run provisionar -- balcao <lojaId>` passa a
mostrar quantas dúvidas a loja fez hoje, quantas ficaram sem resposta, quantas foram
reconsultadas e quanto custaram, ao lado do teto.

**O que fica sabido, e não resolvido:**

1. Resposta que a plataforma dá e não dá para ler (sem a ferramenta) é cobrada por ela e
   não entra na conta do servidor: a dúvida fica como "sem resposta", sem custo.
2. Se o servidor cair depois de a plataforma responder e antes de gravar, a tentativa
   seguinte paga de novo. É raro, e a alternativa (gravar antes de saber a resposta) não
   existe.
3. Cada dúvida monta de novo a configuração da loja (sete consultas). A medir na fase 3; se
   pesar, guarda-se por versão.
4. A página de saúde não diz que versão do código está no ar: em entrega sem migration, não
   dá para ver por ela que o serviço reiniciou (confere-se pela entrega do gancho).
5. A dúvida que ficou pelo caminho (o serviço reiniciou com ela em voo) continua segurando a
   reserva dela — o pior caso, perto de 20 centavos — até o dia virar, a não ser que o
   agente a tente de novo: não dá para saber se a plataforma cobrou, e o teto fica do lado
   seguro. Cada entrega no meio do expediente pode prender a reserva das que estavam em
   voo. A medir na fase 3; se pesar, a perdida passa a contar menos depois de um tempo.
6. O corpo é lido antes de o token ser conferido, como nas outras rotas do agente: quem não
   tem token consegue fazer o serviço ler até 12 MB (nas outras, até 32). Conferir o token
   antes de ler o corpo é melhoria para todas as rotas, e não só para esta.

**Como foi conferido.** Os testes da porta, contra Postgres de verdade e com um roteiro no
lugar da plataforma: o pedido que sai é igual, letra por letra, ao que a loja montaria com a
configuração que tem em mãos; as corridas (duas dúvidas no limite do teto; a loja desligada
no meio; a mesma dúvida respondida enquanto a outra esperava) com outra conexão segurando a
loja; a chamada HTTP de verdade contra um servidor local. Estragos de propósito, um por vez,
em cópias do código — os números estão no PR. A migration, aplicada duas vezes no banco
local: nenhuma loja que já existia mudou de versão.

**A fase 1 acaba aqui.** O que vem: a fase 2 — o agente aprende a entregar a dúvida (com a
chave interna desligada, ele pergunta como hoje) —, que muda o pacote da loja e espera o
"pode" da troca; e, para a fase 3, o dono põe a chave da loja do piloto pelo comando de
dentro do serviço.

## 13/10/2026 (manhã) · A prova da placa: o detector só fica na placa de vídeo se ela responder igual ao processador

**O que foi achado.** No estudo das bibliotecas de imagem (pedido do dono), rodei o modelo
do detector — o mesmo arquivo, conferido pelo sha256 — fora da loja, num computador com
placa integrada da Intel (UHD, driver de 12/2022) e a mesma roda `onnxruntime-directml`
1.24.4 da loja. A sessão abre na placa sem erro e sem aviso, e **a placa responde lixo**:

| | processador | placa de vídeo |
|---|---|---|
| pessoas com certeza em 8 quadros de um vídeo público (pedestres) | 3, 5, 7, 6, 3, 4, 6, 7 | **0 em todos** |
| a maior nota de qualquer candidato | 0,89 a 0,92 | 0,04, sempre, qualquer que seja a imagem |

Com a classe do próprio agente (`MotorOnnx.pontuar`), o mesmo resultado. O agente tratava
"a sessão abriu na placa" como "a placa responde certo". Num computador assim, toda regra
de presença diria "posto vazio" para sempre, com confiança alta — e nada no registro
diria que há algo errado (ERR-112).

**A loja do piloto não tem o defeito.** Medido lá no mesmo dia, só leitura: em 13 entradas
(uma cena de mentira e 6 quadros do fluxo principal da gravação guardada, inteiros e
recortados — as imagens só na memória do roteiro), a RX 560 respondeu **igual** ao
processador (diferença de 0,000 nas vinte maiores notas). De quebra: uma inferência custa
106 ms no processador da loja e 89 ms na placa.

**A decisão: a placa só fica se passar na prova, na partida.** Três cenas de mentira,
sempre as mesmas (ruído ampliado, blocos coloridos, cinza liso), rodam na placa e no
processador; mede-se a média da diferença entre os números crus de cada resposta,
**ordenados** — o modelo escolhe os trezentos candidatos lá dentro, e uma diferença de
arredondamento troca a ordem das linhas sem mudar o que foi visto.

| | a diferença, nas três cenas |
|---|---|
| a placa que acerta (RX 560, a loja) | 0,00001 · 0,00001 · 0,00000 |
| a placa que erra (Intel UHD) | 1,25 · 2,18 · 1,84 |
| **a régua** | **0,05** — cinco mil vezes acima de quem acerta, vinte e cinco vezes abaixo de quem erra |

Acima da régua em **qualquer** cena, resposta com número que não é número, ou placa que nem
roda a prova: o detector passa para o processador, o registro diz por quê e o
`farol-agent detector instalar` mostra na tela (é quando tem alguém olhando). Custa uma
sessão a mais no processador e seis inferências, uma vez, ao subir. Sem placa não há prova
nem segunda sessão.

**O que NÃO foi feito, e por quê:**

- *Descobrir por que esta placa erra.* Com a entrada de tamanho fixo o DirectML dá erro ao
  rodar; sem otimizar o grafo o provedor nem inicia. Não importa para a decisão: driver é
  coisa da máquina do cliente, e o agente não pode depender de ele estar em dia.
- *Deixar de usar a placa.* Na loja ela acerta e é 16% mais rápida que o processador.
- *Provar com imagem de câmera.* A prova não pode depender de ter alguém na frente da
  câmera na hora em que o agente sobe; as cenas de mentira separam quem acerta de quem erra
  por cinco ordens de grandeza.

**O piloto não é a regra do motor.** A placa da loja do piloto funcionar não dizia nada
sobre a da próxima loja. O que depende de driver se prova em cada máquina, a cada partida.

**Conferido:** 18 testes novos em `agent/testes/test_detector.py`; 32 estragos de propósito,
um por vez, em cópia — todos pegos; a suíte inteira do agente (1.583 passam, 1 pulado). E
a prova de ponta a ponta, na máquina do defeito: com a correção o agente avisa no registro
("respondeu diferente do processador (diferença 2.18; o aceito é até 0.05)"), abre o
detector no processador e vê 3, 5, 7, 6, 3, 4, 6 e 7 pessoas.

**Na loja:** chega na próxima troca de pacote (que pede o "pode"). Lá a placa passa na
prova e continua sendo usada; o que muda é cerca de 1 segundo a mais na subida (abrir a
sessão do processador levou 0,4 s na máquina de desenvolvimento, e são seis inferências de
0,1 s cada).

## 13/10/2026 (manhã) · O estudo das bibliotecas de imagem: o que foi medido e o que muda no Farol

**O pedido do dono (13/10, ~5h):** "faça depois um estudo com todas bibliotecas famosas e de
grande recurso no tratamento de imagens do python e se torne um especialista no uso de cada
uma." Feito por medida, e não por leitura: 50 bibliotecas conferidas no índice oficial
(versão, data, licença, se instala no Python 3.14) e 17 instaladas num ambiente à parte e
exercitadas, uma família por vez. O que era da loja foi medido na loja, só leitura, com o
que já está instalado lá; os roteiros foram apagados em seguida. O conhecimento ficou numa
base permanente fora do repositório (guias, armadilhas reproduzidas e os roteiros para medir
de novo); aqui fica o que toca o produto.

**O agente usa as bibliotecas certas.** Ele é OpenCV e NumPy em 21 arquivos, mais o ONNX
Runtime para o detector. Na mesma tarefa, as bibliotecas "de ciência" custam muito mais:

| a mesma operação, em imagem de 1920×1080 | OpenCV | a outra |
|---|---|---|
| borrão gaussiano | 2,9 ms | SciPy 24,7 ms |
| distância até a borda | 6,2 ms | SciPy 118,5 ms |
| mediana 5×5 | 2,6 ms | SciPy 586 ms |
| regiões com medidas | 3,6 ms | scikit-image 42,6 ms |

Nenhuma troca é recomendada. O que existe a mais entra como camada, onde servir.

**O que o estudo achou e já mudou:** a prova da placa (a entrada acima; ERR-112).

**O que foi medido na loja** (computador do piloto, OpenCV 5.0 do agente, a gravação
guardada do expediente de 12/10):

| | |
|---|---|
| a gravação do gravador (`.dav`) | abre: 1920×1080, HEVC |
| velocidade de leitura | 175 quadros por segundo — doze vezes o tempo real, por canal |
| um pedaço de 5 minutos | lido inteiro em 22 s |
| quadros por segundo | declara 15; entrega perto de 13 (3.851 quadros em 298,6 s) |
| o relógio de cada quadro | **não anda sempre para a frente**: passo comum de 67 ms, com volta de 334 ms e saltos de até 2,3 s |
| o detector, por passada | 106 ms no processador, 89 ms na placa de vídeo |
| a placa responde igual ao processador? | sim, em 13 de 13 entradas |
| reduzir com `INTER_LINEAR` (o do agente) ou `INTER_AREA` | a nota muda no máximo 0,03; as contagens não mudam |

Daí três consequências:

1. **A gravação guardada pode ser repassada pelas análises**, dentro da loja: as 4h30 de um
   canal são lidas em 20 minutos (54 pedaços × 22 s). A hora de cada cena tem de sair do nome
   do arquivo e da contagem dos quadros, nunca do relógio de dentro da gravação.
   **Corrigido em 14/10 (ERR-115): é o contrário.** Medido em dois pedaços seguidos da
   bancada, a taxa de quadros muda dentro do pedaço e a contagem chegou a errar 29,6 s; o
   relógio de dentro não recuou e terminou em 300,2 s. A hora sai do nome do arquivo e do
   relógio de dentro, consertado; a contagem fica como conferência (ver "O leitor do
   expediente", 14/10).
2. **O modo de reduzir a imagem antes do detector fica como está.** A suspeita era boa — o
   preparo publicado com o modelo usa um modo que tira a média ao reduzir, e o do agente não
   tira (num xadrez de 1 ponto, reduzido 5 vezes, só o `INTER_AREA` devolve a média) —, e a
   medida com quadros de verdade a derrubou.
3. **Não é a placa de vídeo que viabiliza o detector:** ela rende 16% a mais que o
   processador. O pacote que a usa (`onnxruntime-directml`) está parado na 1.24.4, de março,
   com o pacote geral na 1.31; se um dia ele faltar, o processador dá conta — e o próprio
   OpenCV 5 roda o mesmo modelo, com a mesma resposta, em 132 ms contra 117 (medido na
   máquina de desenvolvimento).

**O que fica anotado, sem mudar nada agora:**

- *A conta da nitidez* (`Laplacian(CV_64F).var()`) custa 15,3 ms em 1920×1080; a mesma conta
  por `meanStdDev(Laplacian(CV_16S))` dá o mesmo número em 2,1 ms. Entra quando aquele trecho
  for mexido.
- *"A câmera saiu do lugar"* se mede: o deslocamento em 7 ms (`cv2.phaseCorrelate`), o giro
  em 12 ms (pontos de referência e ajuste com descarte de erro; mediu 1,48° de 1,5°). Medido
  em cena de mentira e parada — falta provar com gente mexendo na frente.
- *Comparar com foto de referência exige alinhar antes:* 2 pontos de deslocamento derrubam a
  parecença (SSIM) de 1,00 para 0,69; desfeito o deslocamento, volta a 0,9993.
- *A aceleração de vídeo pela placa piora* em placa integrada (de 2 a 4 vezes mais lento):
  não ligar por padrão.
- *Opção do OpenCV por variável de ambiente só vale se a variável existir quando o processo
  nasce.* Posta de dentro do Python — mesmo antes de importar o OpenCV — não tem efeito no
  Windows. Ler só os quadros-chave da gravação depende disso (ou do PyAV, que faz de dentro).
- *Rastrear pessoas:* num vídeo público com 15 a 20 pessoas, o ByteTrack do pacote
  `trackers` (licença Apache) criou 24 identidades; um rastreador mínimo, 74. Medida por
  pessoa (tempo de permanência) depende do rastreador; ocupação de área, não.
- *Só o movimento não mede presença:* concorda com o detector em 80% a 91% dos quadros num
  vídeo em que todos andam, e quem para some. O desenho de hoje — o movimento acorda, o
  detector decide — fica.
- *Licença:* Ultralytics (YOLO), AlbumentationsX e BoxMOT são AGPL e continuam fora
  (`docs/licencas.md`); o pacote pronto do PyAV traz peças de licença mais restrita, e por
  isso serve a ferramenta nossa, não ao produto.

**O que não foi feito:** a família de treino (PyTorch e as demais) não foi rodada — a
instalação quebra em pasta funda no Windows; o que se sabe dela veio da documentação. Os
exercícios de movimento e de rastreamento usaram um vídeo público, e não imagem de loja: os
números valem para ele.

**À espera do dono** (a página do estudo leva as três perguntas): o plano do repasse da
gravação guardada pelas análises; "a câmera saiu do lugar" como proteção do núcleo; e medir,
critério por critério, se o computador das próximas lojas precisa de placa de vídeo.

## 13/10/2026 (tarde) · As respostas do dono ao estudo, o plano do repasse e a placa de vídeo medida critério por critério

**O que o dono respondeu (13/10, 13h28), palavra por palavra:**

- "1 · Repassar a gravação guardada pelas análises: sim, apresente o plano agora, antes da
  fase 2 do balcão."
- "2 · A câmera saiu do lugar, como proteção do núcleo: sim, entra no roteiro do núcleo (com
  protótipo da tela antes)."
- "3 · Placa de vídeo no computador das próximas lojas: meça primeiro: quero os números
  critério por critério antes de mudar a exigência."
- "Outra coisa: ja produzi duas fichas de sanduiche, o que temos que atentar somente os
  ingredientes, essa ficha leva em conta embalagens o que nao precisamos analisar, no momento
  a camera da bancada fora nos ingredientes e insumos da ficha tecnica. cadastrei de dois
  hamburguers ja da para fazer um teste e tentar procurar ou identificar ele nas imagens que
  temos gravadas no servidor."

**O que isso muda na ordem.** O plano do repasse passa à frente da fase 2 do balcão. A fase 2
tinha sido começada pelo lado do servidor (a versão da pergunta, que o servidor anuncia ao
agente, e o "sabe" novo que o agente declara); isso ficou num ramo local, sem ir ao ar e sem
PR. A fase 1 do balcão, que está no ar, não muda. O plano foi entregue ao dono no mesmo dia,
numa página local (não publicada), com quatro perguntas; **nada foi programado e nada mudou
na loja.** O roteiro das fases está em [roadmap.md](roadmap.md), "O repasse, em fases".

### O que foi medido para o plano

Tudo só de leitura, em 13/10, entre 13h30 e 13h45: dois roteiros levados ao computador da
loja e apagados em seguida, e consultas ao banco do Regem (só contagem e horário por produto;
nenhum dado de cliente). Nenhuma chamada paga.

**As fichas chegaram à loja.** A cópia que o agente guarda foi gravada às 06h20 de 13/10: 68
produtos, 2 com ficha, e nenhuma embalagem (o Farol já deixa de fora a de viagem e a do
balcão).

| | Numero 01 | Numero 02 |
|---|---|---|
| Carne 56 g | 2 unidades | 2 unidades |
| Fatia de queijo cheddar | 2 unidades | 2 unidades |
| Pão gergelim de 1 corte | 1 unidade | 1 unidade |
| Alface | 1 porção | — |
| Molho especial billy jack | 1 porção | — |
| Molho shoyo | — | 1 porção |

O que separa um do outro é a alface e o molho: é isso que o teste tem de enxergar.

**O Regem diz a hora do pedido.** Na janela guardada (12/10, das 19h30 às 23h59): "Numero 02"
às 19:53:14 e às 19:55:15; "Numero 01" às 22:50:45. Há ainda 22 vendas de combos cujo nome
sugere o mesmo lanche (6 "TRIOS 01", 5 "Trio 01 + Batata + Refri Lata", 3 "TRIO 02" e 8
"Dois Mr 02 (Duplo Cheddar)…"), mas o combo não tem componente cadastrado no Regem: **não foi
suposto** que levam o mesmo lanche — é pergunta ao dono.

**A loja, como está configurada** (versão 133 da configuração): modo nuvem; o pedido com
contexto desligado; o tipo de negócio vazio; nenhum canal com cena escrita nem foto padrão; e
só dois critérios, os dois de presença (canal 1 e canal 13), valendo. O canal 4, da bancada,
tem um quadro desenhado (1907×885 pontos) e nenhum critério.

**A bancada na gravação** (canal 4, os 54 pedaços de 5 minutos da janela, sem buraco):

| | |
|---|---|
| leitura com 2 fios | perto de 105 quadros por segundo: 36 a 43 s por pedaço de 5 minutos |
| a bancada mexendo | de 30% a 66% do tempo (4 pedaços medidos, espalhados na noite) |
| a bancada para depois de mexer | 7, 10, 8 e 7 vezes em 5 minutos: média de 8 — perto de 430 paradas nas 4h30 (conta sobre 4 pedaços) |
| o detector, um quadro a cada 5 minutos | pessoa em 32 de 54; e nomes errados para o que está na bancada: "donut" em 7, "vaso sanitário" em 3, "bolo" em 2 |

O detector de hoje não conhece comida: a lista dele não tem hambúrguer nem ingrediente. Para
ingrediente é preciso outra camada.

**Dois quadros olhados** (na pasta temporária da sessão; apagados da loja e da sessão em
seguida; nenhuma imagem guardada): a câmera vê de cima; as cubas ficam no alto, as bisnagas à
direita, o papel de montagem no meio; o lanche tem perto de 200 pontos de largura na imagem
cheia; e, **fechado, o lanche esconde os ingredientes** — o teste tem de olhar durante a
montagem, não o lanche pronto.

### A placa de vídeo, critério por critério (a resposta 3)

Lido do resumo da hora que o próprio agente guarda (cinco noites, de 08 a 12/10) e da medida
da manhã na loja (entrada acima): a mesma passada do detector leva 106,1 ms no processador e
88,8 ms na placa — 17 ms de diferença por olhada.

| critério | olhadas por hora cheia (12/10) | o julgamento na placa (registrado) | no processador (conta: + 17 ms) | a placa poupa, por hora |
|---|---|---|---|---|
| presença no atendimento (canal 13) | perto de 165 | 88 a 90 ms | perto de 106 ms | 2,9 s |
| presença na montagem (canal 1) | perto de 185 | 93 a 94 ms | perto de 111 ms | 3,2 s |
| os dois, com a loja aberta | 320 a 370 | | | 5,6 a 6,4 s |

Com a loja aberta, a máquina fica quase parada: processador a 1,7%, placa a 2,2%, memória a
38% (média das oito horas cheias da noite de 12/10). Os outros tipos de critério, que a loja
não usa hoje: estado e ação vão à nuvem, e a placa não entra; a comparação com a foto padrão
leva 78 ms na placa e 98 ms no processador (medida de outra ocasião); a leitura contínua roda
no processador.

**O que isso diz:** para o que a loja faz hoje, a placa poupa perto de 6 segundos de
processador por hora — não é ela que segura o Farol. **A exigência não muda agora** (é a
ordem do dono: medir antes): se o teste dos hambúrgueres mostrar que o caminho é ensinar o
detector ou pôr um modelo maior dentro da loja, a conta muda, e a decisão fica para depois
dele.

### O plano entregue

**O repasse, três jeitos:** (A) dentro da loja, com as mesmas análises do agente, escrevendo
o resultado à parte — o recomendado: a imagem não sai da loja e o que se mede é o que valeria
ao vivo; (B) um roteiro solto para cada teste — mais rápido no primeiro, mas não é o que roda
ao vivo, e o segundo teste começa do zero; (C) levar a gravação ao nosso servidor — a imagem
sai da loja, e são perto de 0,85 GB por hora de cada câmera (118 pedaços de 5 minutos
somaram 8,39 GB). Quem faz como o A: o Frigate, com o "Debug Replay", que repassa um trecho
gravado pelo caminho de detecção da câmera.

**O teste dos dois hambúrgueres, em camadas que se somam:** (1) a hora do pedido no Regem diz
onde procurar; (2) pistas da própria imagem, sem custo — quando a bancada para, se apareceu
verde em cima do pão, se a mão foi à bisnaga; (3) a pergunta paga a um modelo que sabe ver,
com o recorte e as duas fichas ("é o 01, o 02, outro, ou não dá para ver?"); (4) depois,
ensinar o detector com as imagens da loja. Quem faz parecido com a camada 3: a Intel publica
um modelo de referência em que um modelo de linguagem e visão olha o prato e compara com o
pedido.

**O custo estimado** (conta sobre os preços medidos em 08 e 09/10, em pedido parecido: 0,10 a
0,24 centavo por olhada; 4,6 a 5,5 centavos a segunda opinião do modelo forte):

| | olhadas | só a rotina | com segunda opinião em 1 de cada 5 |
|---|---|---|---|
| a amostra (os três pedidos e dois trechos de trio) | perto de 60 | R$ 0,06 a 0,15 | até R$ 0,85 |
| a noite inteira da bancada | perto de 430 | R$ 0,43 a 1,03 | até R$ 5,80 |

Do teto de R$ 5,00 dado pelo dono para os testes pagos desta fase, R$ 4,60 já foram usados.

### O que não se sabe — o teste responde

- Se dá para distinguir a alface e a cor do molho, de cima, nesta câmera.
- Quantas montagens há na noite: parada não é lanche — um lanche tem várias paradas, e há
  parada sem lanche.
- Se a mão cobre o lanche justamente nas paradas (num dos dois quadros olhados, cobria).
- Quanto tempo passa, no pico, entre o pedido entrar no Regem e a montagem começar.
- Como o teste se sai com os outros 17 hambúrgueres do cardápio na mesma bancada: ele tem de
  saber dizer "é outro".
- De quem é cada lanche quando há vários pedidos ao mesmo tempo.
- Quanto processador o repasse gasta na loja com um fio só: os 38% a menos foram medidos na
  máquina de desenvolvimento, com um vídeo público.

### Quatro números corrigidos na página, no mesmo dia (ERR-113)

A página foi entregue às 13h47. Ao conferir cada número dela contra o arquivo da medida,
antes de gravar esta entrada, quatro estavam errados ou mal marcados:

- *a economia da placa* dizia "perto de 5 segundos" por hora: a conta comparava o julgamento
  inteiro registrado pelo agente (na placa) com só a passada do detector (no processador) —
  coisas de tamanhos diferentes. Com a mesma medida dos dois lados, dá 5,6 a 6,4 s;
- *as olhadas por hora de cada critério* diziam 150 e 165: o total da noite tinha sido
  dividido por nove "horas com registro", e uma delas é a das 3h, com 7 olhadas. Por hora
  cheia são 165 e 185 — e as duas linhas não somavam o total da tabela, que estava certo;
- *"com um fio só gasta 38% menos processador"* levava a marca de medido na loja, e é do
  estudo das bibliotecas, na máquina de desenvolvimento;
- *"1 GB por hora de cada câmera"* era arredondamento de 0,85.

A página foi corrigida e o dono avisado. A conclusão não muda em nenhum dos quatro.

**À espera do dono** (a página do plano leva as quatro perguntas): o plano — a recomendação
é aprovar R1 e R2 agora, e R3 e R4 depois do resultado; o teto de gasto do teste — a
recomendação é R$ 1,00, só para a amostra; se os trios levam o mesmo lanche; e o que tem em
cada cuba e em cada bisnaga.

## 14/10/2026 (madrugada) · A primeira noite do pacote novo, medida; a cópia do expediente, fechada; e a conexão que cai no meio da resposta (ERR-114)

Três coisas da noite de 13/10. As medidas são só de leitura, no computador da loja, com
roteiros levados, rodados e apagados em seguida; nenhuma troca de pacote nem de
configuração, nenhuma chamada paga.

**Os lembretes das 19h12 e das 19h27 não dispararam:** o computador de desenvolvimento
entrou em suspensão das 16h37 às 21h25 (registro de energia do Windows). As medidas foram
feitas às 21h35, com a loja aberta, e o computador ficou acordado durante elas por um pedido
ao Windows que acaba com o processo. Daqui em diante, trabalho com hora marcada leva esse
pedido.

### O pacote `b9c99de` com a loja aberta

No ar desde as 3h08 de 13/10 (fatias 1.1b, 1.2a, 1.3, 1.5 e ERR-110).

**Da imagem capturada até a resposta existir** — 9 minutos (21h35 a 21h44), 42 análises,
relógio de parede, leitura de meio em meio segundo:

| | antes (12/10, 19h08–19h18) | depois (13/10, 21h35–21h44) |
|---|---|---|
| critério do canal que a volta abre primeiro (atendimento) | mediana 2,9 s; 9 em 10 em até 3,6 s | mediana 1,3 s; 9 em 10 em até 1,5 s; a maior, 3,1 s (17 análises) |
| critério do canal que a volta abre por último (montagem) | mediana 1,3 s; 9 em 10 em até 1,6 s | mediana 1,1 s; 9 em 10 em até 1,7 s; a maior, 3,1 s (25 análises) |

A fatia 1.1b fez o que a conta dizia: os dois critérios perto de 1,3 s. Em 98% das leituras
a fila estava vazia (19 de 1.076 com algo esperando); o que mais esperou foi visto esperando
2,6 s depois da captura.

**O processador** — o uso que o agente mede e guarda por hora:

| | antes (12/10, 19h–3h, pacote `9831ae0`) | depois (13/10, 19h–21h, pacote `b9c99de`) |
|---|---|---|
| a máquina | 2% (a maior hora: 6%) | 2% (a maior hora: 8%, às 19h) |
| a parte do agente | 1,3% a 1,4% | 1,3% |
| a placa de vídeo | 2% | 2% |
| a memória | 38% a 39% | 39% |

Numa janela de 20 s às 21h34: máquina 2%, os dois processos do agente 1,2%, memória 6,3 de
15,9 GB. **A leitura contínua — perto de 7.000 leituras por hora em cada quadro, duas por
segundo — não aparece no uso da máquina.**

**A atenção, as primeiras contagens** (a semana de números conta das 19h de 13/10):

| quadro | hora | olhadas da rotina | leituras | com movimento | acordou | assentou | clarões |
|---|---|---|---|---|---|---|---|
| atendimento (canal 13) | 19h | 114 | 6.977 | 9% | 15 | 16 | 0 |
| | 20h | 112 | 7.056 | 9% | 16 | 16 | 0 |
| | 21h (até 21h35) | 71 | 4.093 | 20% | 22 | 21 | 0 |
| montagem (canal 1, a imagem completa) | 19h | 177 | 6.997 | 46% | 69 | 68 | 0 |
| | 20h | 171 | 7.056 | 73% | 38 | 38 | 0 |
| | 21h (até 21h35) | 89 | 4.093 | 72% | 24 | 24 | 0 |

"Acordou" e "assentou" andam juntos, e nenhum clarão. É uma noite: a conclusão — se a
olhada pode seguir o quadro que assentou em vez do relógio — é da semana inteira (fatia
1.2b).

**Os vereditos da noite, até 21h44:** atendimento, 316 olhadas — 69 conformes, 241 fora do
critério (76%), 5 sem avaliação, 11 avisos; montagem, 465 — 376, 78 (17%), 8 e 9 avisos. No
atendimento, a parte fora do critério foi de 14% a 26% nas noites de 09 a 12/10 (54% em
08/10). **O caminho do detector não mudou entre os dois pacotes** (conferido no repositório:
`pipeline/recorte.py` e `juizes/` iguais; presença não passa pela memória de cena repetida),
e a leitura contínua concorda com ele: naquele quadro, movimento em só 9% das leituras. A
diferença está na cena: o posto ficou sem ninguém, ou a câmera e o quadro deixaram de
coincidir — o que só o dono, que conhece a noite da loja, ou uma medida de deslocamento da
câmera (R4) respondem.

**O registro do agente desde a última montagem (6h20):** nenhuma chamada paga; 19 subidas; 3
capturas que falharam entre 19h22 e 19h23 ("o gravador não respondeu na rede" — o cabo da
loja segue em 10 Mbps); de 21h02 a 21h05 a nuvem ficou fora de alcance para a loja
(conexões cortadas e uma batida sem resposta em 15 s); e **dois "erro inesperado no laço"**,
às 14h02 e às 21h04 — o ERR-114, abaixo.

### A cópia do expediente de 12/10, fechada

A cópia rodou na loja das 5h06 às 18h23 de 13/10, sozinha depois das 16h37, e terminou o
plano sem falha. Fechada na mesma noite: nenhum processo dela, os roteiros apagados, o `LEIA.txt`
da pasta reescrito com o que de fato ficou, e `C:\Farol\` só com os quatro roteiros de
sempre.

| canal | pedaços inteiros de 5 min (de 54) | o trecho |
|---|---|---|
| 1, 4, 6 e 13 | 54 cada | 19h30 a 00h00, sem buraco |
| 2 | 33 | 21h00–21h20, 21h30–21h55 e 22h00–00h00 |
| 15 | 29 | 21h00–21h15, 21h30–21h55, 22h00–22h55, 23h00–23h25 e 23h30–23h55 |

Mais uma amostra de 20 s de cada pedaço de 5 minutos dos canais 1, 2, 6, 13 e 15 (270).
Ao todo, 20,0 GB em 548 arquivos; o disco da loja ficou com 41,8 GB livres de 222,9.

O que a cópia mediu do gravador:

- **ele guarda perto de 18 horas e meia** — o pedaço mais velho que ainda veio tinha 18,60 h;
  o mais novo que já não veio, 18,37 h. Isso corrige o "perto de 17 horas" da madrugada de
  13/10;
- um pedaço de 5 minutos levou 149 s (mediana; de 73 a 276 s) pelo cabo de 10 Mbps — 0,81 GB
  por hora de câmera;
- quando chegou a vez dos canais 2 e 15 (15h28), o gravador já tinha apagado até as 21h. A
  cópia andou junto da borda do apagamento, no mesmo ritmo, e perdeu um pedaço cada vez que
  a borda a alcançou.

### A conexão que cai no meio da resposta (ERR-114)

As duas pilhas da noite terminam em `http.client.RemoteDisconnected` — o servidor fechou a
conexão sem responder —, saídas da batida do coração. O `urllib` só embrulha em `URLError` o
que acontece ao ENVIAR o pedido; o que acontece ao LER a resposta sobe cru, e o cliente da
nuvem só traduzia o primeiro. Na batida, o estrago foi uma pilha no registro. No caminho que
sobe os avisos seria pior: a passada da auditoria estourava antes de marcar a seguinte, e o
laço ficava sem espera — uma olhada atrás da outra, enquanto a nuvem continuasse fechando a
porta.

**A correção**, só no agente: o que cai ao ler a resposta vira o erro de rede de sempre
("seguindo com a configuração local"), com frase sem número que muda; e a passada marca a
seguinte mesmo quando estoura. O mesmo buraco estava em mais quatro lugares que leem
resposta pela rede e foi fechado junto: o juiz local, o cliente do gravador (a transmissão
de eventos que solta deixava de religar), o texto que o gravador devolve e a procura do
gravador na rede.

**Como foi conferido:** 55 testes novos (`agent/testes/test_conexao_que_cai.py`) — 42
falhavam sem a correção —, 31 mutações, nenhuma viva, e a suíte inteira do agente (1.638).
**Na loja ainda não está:** vai na próxima troca de pacote, junto com o ERR-111 e o ERR-112,
e a troca pede o "pode" do dono.

## 14/10/2026 (madrugada) · O pacote `89ef553` na loja, o modo de testes e o que o dono contou do atendimento

**O que o dono respondeu ao relatório da noite, palavra por palavra:**

- Sobre o atendimento: "o canal 13 no quadro marcado onde so amostra o atendendo e o caixa de
  atendimento, em dias com demanda menos o caixa sai e ajuda a liberar pedidos e fazer
  sorvetes entao a movimentação vai ser menor, na segunda feira foi atipico porque foi
  feriado dia das crianças a demanda foi como um final de semana, entao sempre tem atendendo
  no setor, so sai para pegar pedidos ou bebidas porem a maior parte fica com movimento,
  sexta sabado e domingo sao de maior movimento e um colaborador no atendimento mais fixo,
  so dias de semana com demanda menor ele ajuda com outras tarefas e sai do setor."
- Sobre o repasse: "a ideia de usarmos as alterações para analisar as imagens separadas e
  porque teve alta demanda e muito material para avaliar o agente, porem nao podemos mudar a
  logica do algoritimo da analise na montagem ao vivo.."
- Sobre a troca: "pode fazer a troca do pacote nao precisa ficar fora do expediente, estamos
  em modo testes ainda. nao estamos em modo produção ainda ate alinharmos e os testes forem
  eficazes".

**O que isso fixa:**

1. **O posto vazio da noite de 13/10 é real.** Em dia de semana com menos movimento, quem
   fica no caixa sai para liberar pedidos e fazer sorvete; o 12/10 foi feriado, com movimento
   de fim de semana. A detecção e a leitura contínua acertaram. Isso é **perfil desta loja**
   (o dia da semana muda o que é normal no atendimento), e não regra do motor: é o que o
   especialista do padrão da loja já compara por dia da operação.
2. **O repasse é um caminho à parte.** A gravação guardada serve para avaliar o agente com
   material de muito movimento; o que roda ao vivo na montagem não muda por causa dele. É o
   jeito A do plano (as mesmas análises, lendo da gravação, com o resultado escrito
   separado). As quatro perguntas do plano continuam em aberto.
3. **Modo de testes:** enquanto o dono disser que o piloto é teste, a troca de pacote na loja
   pode ser feita com a loja aberta. O "pode" de cada troca continua.

### A troca

Às 2h23 de 14/10, com a loja aberta, para o pacote da `main` em `89ef553` — leva o ERR-111
(o borrão de rosto pelos bytes), o ERR-112 (a prova da placa) e o ERR-114 (a conexão que cai
no meio). Pacote montado com `git archive`, a impressão sha256 conferida dos dois lados.
Subiu de primeira: configuração v141, 2 critérios, **o detector na placa de vídeo — a placa
passou na prova**, nenhum aviso nem erro no registro, a fila capturando 20 s depois. A
conferência das marcas dos três defeitos e das fatias de antes deu "tudo certo"; o pacote
anterior (`b9c99de`) ficou guardado ao lado para a volta.

### As fichas, na mesma madrugada

O dono atualizou as fichas da categoria de hambúrgueres e começou a dos trios. A cópia que o
agente guarda foi trocada às 2h23: das 19 da categoria BURGUER, as 19 têm ficha; dos 19
trios, nenhuma ainda. As fichas do 01 e do 02 mudaram em relação às do plano do repasse: o
01 leva agora pão de dois cortes, e o 02 leva cebola ao molho shoyo (um preparo) no lugar do
molho shoyo. O pão diferente se vê de cima mesmo com o lanche fechado.

## 14/10/2026 (madrugada) · O repasse aprovado; R1, o leitor do expediente — a noite da bancada lida na loja

**O dono, às 2h40:** "planos aprovados e pode prosseguir enquanto monto as outras fichas". A
leitura que eu fiz, e que vai a ele no relatório: aprovadas as quatro fases do plano, nas
recomendações da página — R1 e R2 agora, com teto de R$ 1,00 para a amostra paga da R2; R3 e
R4 depois do resultado. Dos trios, a resposta vem das fichas que ele está montando; das cubas
e bisnagas, a amostra começa sem.

### O que entra

`agent/ferramentas/repasse/leitor.py` — uma ferramenta nossa, **fora do pacote do agente**
(o pacote leva só `farol_agent`): vai à loja, roda com o Python do agente sobre a gravação
guardada e sai de lá. Para cada pedaço de 5 minutos de um canal:

- dá a cada quadro a hora — o nome do arquivo mais o **relógio de dentro da gravação,
  consertado** (o recuo é ignorado; a origem é o primeiro quadro); a contagem dos quadros fica
  como conferência e como reserva, quando o de dentro não anda ou termina longe dos 300 s;
- reduz o quadro ao tamanho do fluxo menor e o passa, de meio em meio segundo do relógio da
  gravação, pela **quietude do agente — importada, não copiada**: a mesma que, ao vivo, diz
  quando o quadro de bancada parou de mexer;
- cada vez que o quadro para depois de mexer, anota a parada (a hora do gravador e a da loja,
  quanto mexeu antes) e guarda o recorte do quadro no tamanho da câmera, com o de fora
  apagado como o agente apaga — **na loja**, na pasta guardada;
- escreve `paradas.csv` e `resumo.json` numa pasta própria. Não fala com o gravador, não mexe
  na configuração, não muda o agente — a ordem do dono para o repasse.

**Corrigido no caminho (ERR-115):** o plano dizia que a hora sairia da contagem e que o
relógio de dentro não servia. O ensaio em dois pedaços mostrou o contrário (a contagem errava
até 29,6 s) e a regra foi trocada antes de qualquer número sair. A "prova" da emenda entre
pedaços que eu tinha posto saía da própria fórmula; a de agora é medida.

### A noite da bancada, lida na loja (canal 4, 12/10, 19h30 a 00h00)

Às 2h55 de 14/10, com 4 fios de leitura: 54 de 54 pedaços em 23 minutos.

| | |
|---|---|
| paradas da bancada | **743** — mediana de 14 por pedaço de 5 minutos (de 5 a 20) |
| a bancada mexendo | em 78% das amostras |
| quanto mexeu antes de parar | mediana de 4,5 s; 9 em 10 até 52 s |
| quadros por segundo (contagem em 300 s) | de 11,9 a 15,0 — mediana 13,9 |
| hora pelo relógio de dentro | 46 pedaços; ele termina em 300,0 s (mediana), de 270 a 301,5 |
| hora pela contagem (relógio de dentro parado) | 8 pedaços: os que começam às 19h30, 20h00, 20h30, 21h00, 21h30, 22h00, 22h30 e 23h30 |
| onde os dois valem, a contagem difere do de dentro | mediana de 7,8 s; até 33,2 s |
| emendas entre pedaços | mediana de −0,07 s; 6 acima de 2 s, todas na entrada de um pedaço da hora cheia ou da meia hora (até +29,8 s, às 20h00) |

**O que isso diz do gravador** (leitura minha, com o padrão medido, sem a prova pela imagem):
ele grava em arquivos de meia hora. O pedaço pedido logo antes da virada vem curto (o de 19h55
termina em 270 s; os de 20h25, 20h55, 21h25 e 22h25, entre 291 e 294 s), e o que começa na
virada vem sem relógio de dentro. Nos 46 pedaços com relógio, a hora de uma parada vale até o
segundo; nos 8 da virada, pode errar dezenas de segundos. A prova independente — o relógio que
o gravador escreve na própria imagem — fica para quando um minuto fizer diferença.

**As paradas perto dos três pedidos de hambúrguer** (hora da loja): das 19h53 às 20h00, 8
(19h53m16 a 19h59m57); das 22h50 às 22h58, 23. São as candidatas da amostra da R2.

### Como foi conferido

38 testes novos (`agent/testes/test_repasse_leitor.py`), com vídeos sintéticos gravados com o
nome dos pedaços da cópia: a hora pelo relógio de dentro quando a taxa muda no meio do pedaço,
o relógio parado, o estragado, o que recua e o que salta; as paradas da quietude do agente; o
que mexe fora do quadro não conta; o buraco entre pedaços zera a memória; o recorte no tamanho
da câmera com o de fora apagado; a janela de horas que passa da meia-noite; a linha de comando.
40 mutações, nenhuma viva (a primeira rodada deixou três: dois testes frouxos, apertados, e um
trecho de código redundante, que saiu). A suíte inteira do agente: 1.676.

### O que não foi medido

- Se as paradas são montagens: um lanche tem várias paradas, e há parada sem lanche. É a R2.
- A hora nos 8 pedaços da virada, contra o relógio escrito na imagem.
- Se a quietude acha na gravação o mesmo que ao vivo: ao vivo ela lê o fluxo menor; aqui, o
  principal reduzido (a medida de 09/10 deu a mesma resposta nos dois, em dez minutos).

## 14/10/2026 (madrugada) · R2, a primeira amostra: o modelo vê os ingredientes, mas uma foto só não diz qual lanche

### O que entra

`agent/ferramentas/repasse/hamburgueres.py` — também fora do pacote do agente. Lê o que a R1
deixou (as paradas e os recortes), escolhe as paradas das janelas pedidas e pergunta, a cada
uma, com as fichas da loja: o que está na bancada? É um dos lanches da lista? Qual? **O que é do
agente vem dele, importado:** o modelo de rotina (`claude-haiku-5-5`, o mesmo que pergunta com
contexto ao vivo), a chamada pela ferramenta forçada, a leitura da resposta, a conta do custo e
o borrão de rosto. **O teto é duro:** antes de cada pergunta, se o gasto mais o custo da anterior
passar dele, para; modelo sem preço na tabela não roda; chave recusada para tudo. O que o modelo
escreve fica no arquivo da loja e não é impresso.

**As fichas iguais viram um lanche só.** O dono montou as fichas dos trios na mesma madrugada, e
elas responderam à pergunta 3 do plano: o **TRIO 01 leva o mesmo lanche do Numero 01**, e o
**TRIO 02 o do Numero 02** — os mesmos ingredientes, nas mesmas quantidades. A lista que vai ao
modelo junta os produtos de ficha igual ("Numero 01 — o mesmo lanche vai em: TRIO 01"): ele vê o
sanduíche, e não teria como escolher entre dois nomes para ele.

### A primeira amostra (14/10, 3h36, na loja, com a chave da loja)

Três janelas, perto dos pedidos do Regem: 19h50–20h01 (dois Numero 02, um TRIO 01 e dois TRIO
02), 22h50–22h59 (um Numero 01) e 23h23–23h32 (dois TRIOS 01 e um TRIO 02). As 64 paradas da
bancada nessas janelas foram perguntadas, com teto de R$ 1,00.

| | |
|---|---|
| perguntas | 64, nenhum erro |
| custo | **R$ 0,105** no total — de 0,155 a 0,337 centavo por pergunta |
| o que o modelo viu | bancada sem lanche 30 · não dá para ver 23 · lanche em montagem 9 · lanche fechado 2 |
| qual lanche | "não sei" 62 · "Numero 06" 2 (23h30m56 e 23h31m38; nenhum pedido conhecido dele ali) |
| borradas | 16 — o borrão de rosto achou "rosto" em 16 dos 64 recortes |

**Dois recortes olhados** (na pasta da sessão, sem descrever pessoas; apagados dali em seguida —
na loja eles continuam na pasta guardada do repasse): quando o lanche está aberto, **os
ingredientes aparecem bem** (alface e molho branco nítidos, dois lanches montados em embalagem
de delivery); num outro momento, o lanche estava no canto do quadro e o resto era papel vazio.

**O que isso diz:**

1. **"A bancada parou" não é "há um lanche na bancada":** 30 das 64 paradas não tinham lanche.
2. **Uma foto só mostra uma parte da montagem.** O que se vê num instante — alface, molho — é
   comum à maioria dos lanches: dos 19 hambúrgueres, 7 levam alface e molho especial. O que
   separa um do outro (o pão, quantas carnes) aparece em outro instante. Daí os 62 "não sei": o
   modelo não inventou.
3. **O borrão de rosto atrapalha na bancada:** de cima, a regra do próprio agente para a bancada
   é não borrar (o borrão apagava o pão — 12 de 40 momentos, 08/10). O quadro da loja está como
   "livre", e não como "montagem", e por isso a R2 borrou.

### A próxima rodada (dentro do teto que sobra: R$ 0,895)

- **A pergunta com os pedidos:** os candidatos são os lanches pedidos no Regem nos minutos
  anteriores — "é o lanche de algum destes pedidos? de qual?" —, e não a lista inteira. É a
  conferência do pedido pela ficha, o uso que o produto quer; o modelo de referência da Intel
  faz assim (a estação compara o prato com o pedido).
- **Uma sequência, e não uma foto:** quatro a seis quadros da mesma montagem, de um minuto, numa
  pergunta só — o pão, a carne e o recheio aparecem em instantes diferentes.
- **Sem o borrão na bancada**, como o agente.

### O que não foi medido

Se a sequência com os pedidos acerta; quanto custa (pela conta, perto de 0,6 centavo por
pergunta com quatro imagens); e de que lanche eram as paradas "em montagem".

## 14/10/2026 (madrugada) · R2, rodadas 2 a 6: os ingredientes de cada lanche — e o que separa uma ficha da outra (ERR-116)

### O que o dono contou

- **A câmera do canal 4 filma só a bancada 1.** No pico e no fim de semana ela monta só os
  pedidos do balcão; em dia de semana, balcão e delivery. O Regem só tem os de delivery (pela
  integração). Na noite de 12/10 (feriado, com movimento de fim de semana), os pedidos do Regem
  **não são o gabarito do canal 4**.
- **Trio e sanduíche são a mesma ficha na bancada:** a batata e a bebida saem de outro setor. O
  canal 4 confere a ficha do sanduíche e os adicionais — e, quando chegarmos lá, as observações
  ("sem alface", "sem ovo").
- O que ele pediu agora: "só verificar a identificação dos ingredientes e pesquisar nas fichas
  se batem"; e que, "com análises seguidas, a identificação dos ingredientes seja mais fácil".
  Ofereceu uma régua ou uma folha A4 no tampo, como escala, se for útil.
- **O teto da amostra paga passou a US$ 5,00** do saldo da conta (era R$ 1,00).

### O que entra

- `agent/ferramentas/repasse/com_pedidos.py` (rodada 2): junta as paradas seguidas numa
  sequência (até 40 s entre elas; até 5 quadros espalhados), borra como o agente borra a
  bancada (sem borrão quando a bancada está quieta e o detector de pessoas do agente não acha
  ninguém a 0,35 ou mais) e pergunta com os pedidos do Regem dos minutos anteriores.
- `agent/ferramentas/repasse/ingredientes.py` (rodadas 3 a 6): **o modelo não escolhe o
  lanche** — diz os ingredientes que vê, com os nomes das fichas da loja; quais fichas batem
  (as que têm todos os vistos) é conta daqui, sem custo. Desde a quarta, **uma lista para cada
  lanche** (esquerda, meio, direita): na terceira, os lanches montados ao mesmo tempo viravam uma
  lista só, que não batia com nada (a sequência das 23h30, que na quarta rodada veio com três
  lanches).
- **ERR-116:** a ferramenta usava o teto de saída da pergunta do agente (300). Na quarta rodada,
  2 das 15 respostas pararam nele — as listas estavam inteiras e só a frase final se perdeu,
  então os números valem; mas a ferramenta as contava como respostas inteiras. Agora o teto é
  dela (1.000) e a resposta cortada é erro, não dado. Na sexta rodada, a maior resposta teve
  326.

### As rodadas (na loja, nas mesmas 15 sequências das três janelas; 45 recortes)

| rodada | o que mudou | lanches com ingrediente | batem com UMA ficha | com várias | com nenhuma | custo |
|---|---|---|---|---|---|---|
| 2 | os pedidos como candidatos | — | "não sei" nas 15 | | | 5,617 centavos |
| 3 | só os ingredientes (Haiku 5.5) | 6 sequências | 0 | 3 | 3 | 4,642 centavos |
| 4 | uma lista por lanche | 24 lanches | 0 | 19 | 5 | 4,846 centavos |
| 5 | o mesmo, no Sonnet 5.5 | 25 de 26 | 0 | 20 | 5 | 98,156 centavos |
| 6 | Haiku, com a cópia nova das fichas | 20 lanches | 0 | 13 | 7 | 4,832 centavos |

A R2 inteira, com a primeira amostra (10,529): **128,6 centavos — R$ 1,29**, perto de
US$ 0,24 (conta do agente, com o dólar a 5,40). Na rodada 2, o detector do agente não foi
achado (a variável apontava para outra pasta) e os 45 recortes foram borrados; da 3 em diante,
7 dos 45.

**A cópia das fichas mudou no meio:** as correções que o dono fez nesta madrugada chegaram ao
computador da loja às 04h15, durante a rodada 5. As rodadas 4 e 5 conferiram contra a cópia
anterior; a 6, contra a nova.

### O que isso diz

1. **Em nenhum dos 70 lanches das rodadas 4 a 6 os ingredientes vistos apontaram uma ficha
   só.**
2. **Os dois modelos discordam do pão nas mesmas imagens:** onde o Haiku diz "Pão de dois
   cortes", o Sonnet diz "Pão Brioche" (19h50, 22h50, 23h23). Nenhum escolheu "Pão gold mix
   Prime", que na cópia nova é o pão de 9 dos 19 lanches. O nome comercial não diz ao modelo
   como o pão é; sem gabarito, não se sabe qual dos dois acertou.
3. **O que separa uma ficha da outra é o pão, a carne (56 g, 120 g, 150 g ou frango) e quantas
   carnes** — Numero 01 leva 2 carnes de 56 g, Numero 11 leva 4; Numero 03 leva 1 de 120 g,
   Numero 05 leva 2. Pela cópia nova: se esses três fossem vistos certos, os 19 lanches cairiam
   em 10 grupos; 5 seriam um lanche só, e nos outros 5 as coberturas separam (cebola crispy,
   bacon, tomate, molho cheddar…). É justamente o que os modelos confundem ou não contam.
4. **O modelo maior custou 20 vezes mais** (98,2 contra 4,8 centavos nas mesmas sequências) e
   viu um pouco mais — a carne em mais duas sequências; anotou "item empanado" e "molho
   vermelho" —, mas também não chegou a uma ficha.
5. **Conta sem custo, fora da ferramenta (exploração):** dando mais peso ao ingrediente raro (o
   que está em poucas fichas diz mais que o pão), o lanche da esquerda das 19h59 aponta "Mussarela
   Burg" nas três rodadas: cebola crispy, blend de 150 g e maionese — e o "item empanado" e o
   "molho vermelho" do Sonnet seriam, na ficha, o disco de mussarela empanada e a geleia de
   pimenta. **Não está conferido:** não há gabarito.

### O que não foi medido

Se algum pão, carne ou lanche acertou — falta o gabarito. E se a resposta muda de uma rodada para
a outra só por acaso: entre as rodadas 4 e 6, a lista de nomes também mudou.

### O que vem — o dono decide

- **O gabarito:** (a) a lista de vendas do sistema do balcão de 12/10, com item e hora — naquela
  noite, a bancada 1 montou só o balcão; (b) uma calibração: cada pão e cada carne no tampo, um
  de cada vez, com a hora anotada; (c) o dono marcar alguns recortes.
- **A referência da própria câmera** (o que a calibração dá: "assim é o Pão gold mix Prime aqui")
  e **a contagem de carnes e fatias** de cada lanche ao longo da montagem — é o "análises
  seguidas" do dono.
- **A escala:** um marcador impresso fixo no tampo dá a medida em centímetros e mostra na hora se
  a câmera saiu do lugar (a R4). Para a carne, só ajuda se os discos de 56, 120 e 150 g tiverem
  diâmetros diferentes: de cima, a câmera vê o diâmetro, não a altura.

## 14/10/2026 (madrugada) · R2, rodadas 7 e 8: o que a loja descreve, as peças contadas e a montagem inteira (ERR-117)

### O que o dono contou

- "o nome do pão é um nome comercial, é um pão de brioche com gergelim mesclado"; "os discos são
  de tamanhos diferentes: o de 120 é bem maior que o de 56, e o blend 150gr é mais deformado, não
  é simétrico o círculo" — **a escala vai servir para a carne**.
- "a medida em ml não é necessária, o importante é detectar a presença do molho e ser similar".
- O balcão ainda está em outro sistema; o importante agora é identificar os ingredientes para
  comparar com as fichas. O marcador vai ser impresso mais tarde e medido.
- Ele trocou no Regem o nome do insumo do pão — e a ficha do Farol não mudou (abaixo).

### O que entra (`ingredientes.py`)

- **O arquivo da loja** (`--da-loja`): como cada ingrediente aparece de cima, ao lado do nome na
  pergunta, e os grupos de parecidos. É dado da loja, não regra daqui.
- **As peças contadas:** o modelo diz quantas peças vê (disco, fatia, fita); a ficha com menos
  peças do que se contou não bate. A unidade da ficha diz o que é peça (unidade, fita); molho,
  porção, grama e ml não se contam.
- **O parecido:** visto um membro do grupo, a ficha com outro bate ("molho vermelho": ketchup e
  geleia de pimenta). O modelo que não sabe qual molho é escreve "outro: molho <cor>", e isso vale
  como o grupo daquela cor.
- **A conta das parecidas:** o ingrediente raro pesa mais que o comum; "uma ficha na frente" só
  quando ela fica sozinha e com ponto a favor. Ordena; não diz que acertou.
- **ERR-117:** na rodada 7 o modelo copiou a linha inteira da lista ("Carne 56gr — o disco de
  carne pequeno") como nome, e a ferramenta pôs o ingrediente fora da lista; a rodada foi
  repetida (7b) com a leitura que tira o que vem depois do travessão. E a descrição do pão de
  dois cortes, que falava em "três partes", fez o modelo contar 3 pães: a pergunta passou a dizer
  que o pão conta 1.

### As rodadas (as mesmas três janelas)

| rodada | o que mudou | lanches vistos | com UMA ficha | com várias | com nenhuma | com contagem | custo |
|---|---|---|---|---|---|---|---|
| 7 | descrição, contagem e parecidos (Haiku) — a leitura errada do ERR-117 | 9 | 0 | 6 | 0 | 6 | 4,889 centavos |
| 7b | a mesma, com a leitura certa | 15 | 0 | 12 | 3 | 8 | 4,933 centavos |
| 8 | a montagem inteira: até 2 min entre paradas, 8 quadros | 9 | 0 | 7 | 2 | 7 | 4,193 centavos |

A R2 até aqui: **142,6 centavos — R$ 1,43**, perto de US$ 0,26 (conta do agente, dólar a 5,40).

### O que isso diz

1. **A descrição das carnes ajudou:** na 7b, o Haiku chamou de "Carne 120gr" a montagem das
   19h52, onde antes só o Sonnet tinha visto a carne de 120; e viu a de 120 em mais duas.
2. **O pão continua sem resposta:** com a descrição, o Haiku segue dizendo "Pão de dois cortes";
   em nenhuma rodada um modelo escolheu o pão de brioche com gergelim mesclado.
3. **A montagem inteira junta o que as partes não juntavam:** a das 19h50 (5 min, 8 quadros) deu
   pão de dois cortes, carne de 56 g e 2 fatias de cheddar — só o Numero 01 ou o Numero 11. O que
   separa os dois é quantas carnes (2 ou 4); o modelo contou 1.
4. **Nenhuma ficha ficou sozinha na frente** em nenhuma rodada: os candidatos empatam porque
   diferem na quantidade (01 × 11) ou no pão.
5. **O molho:** às 23h30, alface com um molho branco aparece em seis das sete rodadas que viram
   lanche ("outro: maionese branca" ou "Maionese vigor 1kg"; na sexta, "MAionese Verde"). O
   "Molho especial billy jack" está em 7 dos 19 lanches, e não sabemos como ele é: se for branco,
   aquelas montagens são do grupo 01, 03, 05, 06, 07, 10 e 11.

### A troca de nome que não chegou ao Farol (medido no banco do Regem, só leitura)

- **O aviso funcionou:** a mudança foi anotada no Regem às 04h46m50 e entregue ao Farol às
  04h47m05, com a resposta 204.
- **Mas o retrato das fichas do Regem manda o nome GUARDADO em cada linha da ficha**
  (`ficha_ingrediente.insumo_nome`), e não o nome atual do insumo. Trocar o nome no estoque não
  muda as linhas: 17 seguem "Pão gold mix Prime", e o Farol lê "nada mudou". Há mais três casos,
  mais antigos: "Emabalagem batata vermelha" (3 linhas), "Caixa hamburguer aurora 56gr" no lugar
  de Carne 56gr (1) e "Bombona molho shoyo" no lugar de Molho Shoyo (1).
- É do lado do Regem, e a decisão é do dono: (a) a troca de nome no estoque leva o nome às linhas
  das fichas, com uma correção única das que já divergem; (b) o retrato das fichas passa a mandar
  o nome atual do insumo; ou os dois. Até lá, o arquivo da loja da R2 leva o pão com os dois nomes.

### O que não foi medido

Se algum lanche acertou: segue sem gabarito.

## 14/10/2026 (manhã) · R2, rodada 9: a bancada com memória — a tabela de itens do dono — e o ciclo de aprendizado

### O que o dono propôs (14/10, 10h14 e 10h35)

- **A tabela de itens:** "o frame detecta que o colaborador coloque 5 pares de tampos de pães, então logicamente está
  produzindo 5 hambúrgueres e serão 5 fichas, já teria uma tabela com 5 colunas item 1, item 2 [...] depois iria
  adicionando ingredientes em cada item conforme detectar nos frames [...] e ao final vai filtrando as fichas".
- **A rotina como pista:** "ao montar os ingredientes o colaborador coloca um tampo sobre o outro, o que permite ver
  mais detalhes do pão ao fim da montagem [...] perceber um padrão e rotina".
- **O raro diz o lanche:** o Numero 08 é o único com 3 anéis de cebola, bacon e ovo — "ou ao menos detectar [...]
  10 ingredientes detectados de 11 (pão não definido)".
- **O ciclo de aprendizado:** a montagem fora do padrão das fichas vira alerta e fica guardada; se repetir, pede-se
  ao usuário uma definição. E a que identifica "5 de 6 ingredientes" separa o quadro e pergunta qual é o que não foi
  identificado. "Isso conta como treinamento e base de conhecimento."
- **O KDS do Farol:** o comparativo com o KDS fica para quando houver a integração; e, para quem usa só o Farol,
  "teremos nosso próprio KDS com a descrição do que está sendo detectado e produzido".

O ciclo de aprendizado e o KDS do Farol são telas e alertas novos: entram no roteiro, com protótipo antes (regra do
dono). Na R2, eles aparecem só como marcação no resultado de cada item.

### O que entra (`agent/ferramentas/repasse/bancada.py`)

- **A montagem com memória:** os quadros vão um a um, em ordem, e cada pergunta leva a tabela como está (item 1,
  item 2... com o que cada um tem e quantas peças, o pão e se fechou). O modelo devolve a tabela depois daquele
  quadro; a memória é daqui: o nome que entrou não sai, a contagem não diminui, o pão do fechamento fica e o item
  fechado não reabre.
- **No fim, cada item vai às fichas:** as que batem, as mais parecidas com "N de M ingredientes da ficha vistos" e,
  no item fechado, a ficha de contagem exata (duas carnes: Numero 01, e não o 11).
- **O ciclo de aprendizado, como marcação:** item fechado que nenhuma ficha explica é "fora do padrão"; item fechado
  que bate com uma ficha a menos de um ingrediente vira "falta 1 de <ficha>: <ingrediente>", com o quadro em que o
  item foi visto por último — o que se mostraria na pergunta.
- **A montagem longa:** a primeira versão recomeçava a tabela a cada pausa de 2 minutos e perdia os pães abertos
  antes de chegar o recheio. Agora a tabela vale enquanto a pausa for de até 5 minutos, e quem limita o custo é o
  intervalo entre os quadros (um a cada 20 s).

### As rodadas (as mesmas janelas)

| rodada | o que mudou | perguntas | itens | com pão | fechados | o que se viu | custo |
|---|---|---|---|---|---|---|---|
| 9 | a tabela, recomeçando a cada 2 min | 48 | 21 | 0 | 4 | 1 fora do padrão; 3 de contagem exata (todos Numero 10) | 8,138 centavos |
| 9b | a tabela contínua, um quadro a cada 20 s | 30 | 15 | 0 | 0 | 10 itens às 22h50 (5 só com o pão aberto) | 5,928 centavos |

A R2 até aqui: **156,7 centavos — R$ 1,57**, perto de US$ 0,29.

### O que isso diz

1. **A tabela conta os lanches:** o modelo abriu 6 itens às 22h50 e 4 às 23h23 — os pares de pão que o dono
   descreveu.
2. **O "fora do padrão" achou o que a escala vai resolver:** na montagem das 19h57 às 20h00, um lanche fechado com
   carne de 120 g e geleia de pimenta — nenhuma
   ficha tem as duas; a mais parecida é o Mussarela Burg, que leva o blend de 150 g. É o tamanho da carne lido errado.
3. **Um quadro por vez vê pouco:** cada item da 9b ficou com uma ou duas coisas (alface; uma carne e uma fatia) —
   menos que a rodada 8, que olhava 8 quadros juntos e viu pão, carne e duas fatias na montagem das 19h50. De cima, um
   quadro só mostra a camada de cima.
4. **O pão nunca foi nomeado, e nenhum item da 9b fechou:** o pão continua esperando a referência da própria câmera.
5. **Ninguém perguntaria nada ainda:** sem item fechado completo, não houve "falta 1" — a pergunta do ciclo de
   aprendizado depende do fechamento ser visto.

### O nome do pão no Regem, de novo (14/10, 10h26, só leitura)

O dono viu na ficha do Regem o nome novo e entendeu que tinha atualizado: a LISTA de escolha mostra o nome atual do
insumo, mas o campo "Insumo" logo abaixo (cinza) guarda o antigo — é ele que vai para o Farol. Conferido no banco: as
9 fichas com esse pão seguem "Pão gold mix Prime", inclusive a Mussarela Burg salva às 10h13. Salvar a ficha de novo
não troca o nome guardado.

### O que vem

- **A tabela olhando uma sequência curta** (3 a 4 quadros por pergunta, em vez de um): junta o que a rodada 8 via com
  a memória da 9.
- **A referência da câmera para o pão e a escala para a carne** (a calibração do dono, mais tarde).
- **O ciclo de aprendizado e o KDS do Farol:** protótipo antes, quando a identificação estiver de pé.

### O que não foi medido

Se algum item acertou: segue sem gabarito.

## 14/10/2026 (manhã) · Quem entrega os alertas tem credencial própria — a chave geral sai das rotas de envio (migration 046, ERR-118)

### O pedido

A sessão do Hub DMS, pela decisão D10 do dono (abrir já as correções das brechas dos produtos), achou que as rotas do
transporte — `POST /v1/envios/reivindicar` e `POST /v1/envios/:id/resultado` — aceitavam a **credencial geral da
distribuição** (`x-farol-admin`), a mesma que emite agente, cadastra loja e liga o balcão. Quem entregasse os alertas
(o n8n, o Regem) carregaria a chave mestra de todas as lojas. O pedido está em
`docs/pedido-hub-dms-credencial-do-transporte.md`.

O plano foi apresentado e o dono respondeu "Pode" (14/10, 11h25), com o print da aba "Chegou?": todos os avisos "na
fila", 0 tentativas — **nada consumia essas rotas**. Então não houve transição: a chave geral saiu delas já.

### Três caminhos, e o escolhido

- **A · token por transporte, guardado só em resumo** (escolhido): o padrão do token do agente; um por transporte,
  com os tipos de destino que ele entrega; revoga-se um sem derrubar o outro; cada envio anota quem o levou.
- **B · uma segunda variável de ambiente:** sem migration, mas um token só para todos, revogar exige mexer no
  servidor, e não há registro de quem entregou.
- **C · pedido assinado (HMAC):** protege contra repetição de pedido, mas pesa no n8n. Fica como camada para depois.

### O que entra

- **Migration 046:** a tabela `transporte` (nome, tipos, resumo do token, criado, último uso, revogado; o nome não
  repete entre os que valem) e `envio.transporte_id`.
- **`autenticarTransporte`** (`auth.ts`): `Authorization: Bearer fart_…`; o que não tem o prefixo nem chega ao banco;
  inexistente, errado e revogado dão a mesma recusa; o último uso é anotado sem segurar a resposta.
- **As rotas de envio:** só o token do transporte. A reivindicação respeita os tipos dele (o pedido vale dentro deles);
  o resultado só vale do envio que ele mesmo reivindicou — o de outro é 404; id torto também é 404, e não erro do
  banco.
- **A distribuição emite, lista e revoga** (`rotas/transportes.ts`, só com a chave geral) e pela linha de comando:
  `npm run provisionar -- transporte <nome> <tipos>`, `transportes`, `transporte-revogar <id>`. O token aparece uma
  vez. O contrato para quem montar o transporte: `docs/transporte-dos-alertas.md`.
- **Fica fora:** a chave geral continua nas outras rotas de distribuição (agentes, lojas, balcão, usuários,
  transportes). Se o Hub quiser tratá-las, é outro pedido.

### Como foi provado

Os testes da API contra Postgres (`testes/transportes.test.ts` e `testes/rotas-alertas.test.ts`): a emissão (o token
com o prefixo, o banco só com o resumo), as recusas (nome, tipos, token no corpo, nome repetido; revogado, o nome fica
livre), a lista sem token nem resumo; o token do transporte recusado em todas as rotas de distribuição; a chave geral,
o token do agente, o token revogado e o sem prefixo recusados nas rotas de envio; os dois transportes de tipos
diferentes, cada um levando só os seus; o resultado de outro transporte recusado; os comandos de provisionar pela API
de verdade. A reivindicação que dá certo fica toda num arquivo: ela pega envios de todas as lojas, e os arquivos de
teste rodam ao mesmo tempo (V93). As mutações numa cópia, até zero vivas.


## 14/10/2026 (tarde) · R2, rodadas 10 a 11b: a calibração na pergunta, o jeito do dono (o mais raro decide, a mais próxima sai sempre), sem borrão e com fotos de referência

### O que o dono pediu

- Depois da calibração do canal 4 (escala, discos crus e assados, os quatro pães crus e tostados, os molhos — o
  arquivo de parâmetros fica na loja): "com o que temos já consegue um teste com a gravação que temos no servidor para
  verificar se alguma ficha bate?".
- Depois das rodadas 10 e 10b: "retira o borrão de rosto para não atrapalhar. Importante verificar padrões: os tampos
  ficam sempre próximos, o tampo de baixo leva carne e o de cima molhos e alguns ingredientes. Se tem uma mussarela
  empanada, somente 1 ficha tem ela, então já filtra as fichas, só conferir os outros ingredientes. O Numero 08, por
  exemplo, se tem anel de cebola no tampo, já exclui todas as fichas, só vai restar conferir o ovo, a maionese, as
  fatias de bacon. Com os tipos de pães e blends passados já tinha que dar para definir fichas técnicas."
- "Já temos fichas técnicas e fotos dos principais ingredientes [...] são fichas e montagens fechadas; anomalias vão
  ser à parte, em um lanche de um colaborador que possa ser montado personalizado. Porém nas vendas são padrões de
  ingredientes e até mesmo a ordem que cada um segue."
- "Atenção aos testes: ainda não estamos validando adicionais e extras; ao pegar um exemplo que não bate, fora do
  padrão de uma ficha, pode ser que seja uma alteração à parte — use outros quadros para teste se for o caso."

### O que entra

- **O arquivo da loja calibrado** (dado da loja, fora do repositório): o topo por fora de cada pão (liso só o
  brioche; o de 1 corte o mais claro; o mesclado o mais avermelhado), a fatia do meio do pão de dois cortes, os discos
  ASSADOS (o 120 é o maior; o blend, menor, escuro e irregular), a maionese creme, o barbecue quase preto e o "Molho
  especial billy jack" — que está em 15 fichas e não tinha descrição — no grupo "molho laranja".
- **A pergunta da bancada** diz que base e tampo vizinhos são UM item (a base leva a carne; o tampo, os molhos e
  alguns ingredientes) e que o pão se diz pelo tampo visto POR FORA (o miolo tostado é parecido em todos).
- **`ingredientes.com_pao`:** só concorrem as fichas que levam pão — a porção de anéis não se monta no pão.
- **`ingredientes.pelo_mais_raro`:** o visto que menos fichas têm decide e os outros se conferem; o que não cabe fica
  FORA DA FICHA sem tirá-la — leitura errada ou adicional, que ainda não se valida. O filtro tenta começar por cada
  visto e fica com o começo que deixa menos fora (no empate, o mais raro): um raro fora da ficha não decide sozinho
  contra dois que concordam. A contagem de peças não filtra: é evidência.
- **`bancada.py`:** a MAIS PRÓXIMA sai sempre que há candidata (a que tem mais da ficha visto; no empate, a da conta das
  parecidas), com "confere N de M", o que falta ver e o que ficou fora da ficha; `--sem-borrao` (só com a opção dita, e
  a rodada avisa: "borrão de rosto: DESLIGADO"; ERR-056 — de cima, as mãos sempre aparecem e o borrão caía na comida;
  o agente da loja continua com o borrão até a correção do ERR-056); `--referencias <pasta>` manda antes de cada quadro
  as fotos da loja (o nome do arquivo é a legenda), no formato da foto de referência do agente: rotuladas, o fim em
  cache, a bancada por último. As 13 fotos desta rodada são recortes dos quadros da calibração de 14/10 (discos
  assados, os quatro topos por fora, a fatia do meio, um miolo tostado, os molhos no tampo) — ficam na loja só durante
  a rodada.

### As rodadas (as mesmas três janelas da 9b; o gabarito é a montagem das 19h57, o Mussarela Burg)

| rodada | o que mudou | perguntas | gasto | na montagem das 19h57 |
|---|---|---|---|---|
| 9b | (a referência) | 30 | 5,928 centavos | o Mussarela não aparece |
| 10 | descrições calibradas | 30 | 5,684 | o tampo (geleia + cebola crispy) bate SÓ com o Mussarela; um segundo item, Carne 120 + maionese (pela descrição do dono, a base: o blend com maionese, lido como Carne 120) → Numero 08 |
| 10b | a 10 repetida | 30 | 6,058 | o Mussarela não aparece; um "barbecue" → Numero 15 |
| 11 | o jeito do dono, sem borrão | 30 | 5,416 | o tampo → Mussarela; um item "Carne 120 + ketchup" (provavelmente a base) → mais próxima Mussarela (o ketchup no grupo da geleia), a Carne 120 fora da ficha |
| 11b | a 11 + as 13 fotos de referência | 30 | 5,355 | um item com o BLEND e a MAIONESE — a base, pela descrição do dono —, lidos certos pela primeira vez, mais um "barbecue"; o tampo → Mussarela |

R2: R$ 1,80 de US$ 5,00. As fotos não encareceram a rodada (5,355 × 5,416 centavos): o bloco delas vai em cache.

Na 11b, o filtro ainda começava pelo mais raro: o "barbecue" (só o Numero 15 tem) decidiu a base, e o blend e a
maionese ficaram fora — a conta das parecidas, ao lado, punha o Mussarela na frente. Daí o filtro que começa por cada
visto. **A conferência sem custo**, com as fichas da loja (`conferir_mais_raro.py`, só a conta, na loja), dos itens
que o modelo leu nas rodadas 10 a 11b:

- 11b, a base (blend, maionese, barbecue) → Mussarela, o barbecue fora da ficha;
- 11b, o tampo (Carne 120, geleia, crispy) → Mussarela; e base e tampo juntos → Mussarela, **confere 4 de 6** — falta
  o disco de mussarela empanada (o dono: ainda não tinha chegado nos quadros) e o pão;
- 11, o item Carne 120 + ketchup → Mussarela; 10, o tampo → Mussarela;
- 10, o item Carne 120 + maionese → Numero 08, e 10b (só o barbecue) → Numero 15: nessas leituras não havia o que a
  conta corrigisse.

O "barbecue" não é da ficha do Mussarela e o dono não o citou: pode ser leitura errada ou um adicional — e adicional
ainda não se valida. Fica como "fora da ficha (leitura ou adicional)", nunca como erro.

### O que não foi medido, e o que vem

- **Um gabarito só, e uma rodada de cada:** o modelo muda de uma vez para outra (a 10 e a 10b). Para medir acerto,
  mais gabaritos de montagens PADRÃO (sem adicional, como o dono pediu): ele diz a hora e o lanche de montagens do
  próximo expediente, ou rotula os quadros de outras montagens de 12/10.
- **O pão nunca foi nomeado** (nenhum item com pão nas rodadas 10 a 11b). O topo por fora aparece no fechamento: olhar
  mais de um quadro por pergunta e, depois, a medida local com os parâmetros da calibração.
- **Base e tampo ainda viram dois itens**, mesmo com a frase na pergunta (11 e 11b). Juntar pela posição é o próximo.
- **A ordem da montagem** ("até mesmo a ordem que cada um segue"): a tabela pode guardar em que quadro cada
  ingrediente entrou e comparar com a ordem da ficha — depois de saber se a ordem cadastrada no Regem é a da montagem.
- O borrão sai só no teste; no agente da loja, a correção do ERR-056 é do A19 e a troca de pacote pede o "pode".

### Como foi provado

Os testes das ferramentas (`test_repasse_bancada.py`, `test_repasse_ingredientes.py`, `test_repasse_com_pedidos.py`):
a porção fora da disputa, o mais raro com o disco lido errado, o raro fora da ficha que não decide sozinho, a mais
próxima com várias candidatas e no empate, o molho de cor pelo grupo, o "sem borrão" que não chama o detector nem borra,
as referências lidas da pasta (com acento no nome, maiúscula na extensão, arquivo quebrado, o máximo) e mandadas antes
do quadro com o cache. As mutações numa cópia, até zero vivas; a suíte inteira do agente.

## 14/10/2026 (noite) · A porta para outro sistema no Padrão DMS, parte 1: erro em problem+json, revogado igual a inexistente, limite de chamadas, código novo e "só validar" (sem migration)

### O pedido

O Padrão DMS de integração (Hub DMS, aprovado pelo dono em 14/10) vale para toda porta que um sistema de fora usa. A
sessão do Hub listou o que faltava na porta das fichas (`/v1/integracao/fichas`) em
`docs/pedido-hub-dms-porta-no-padrao.md` e, com a sessão do Farol ocupada, o dono pediu que a parte sem tela e sem
migration fosse feita de lá ("o farol está super ocupado na tarefa, não tem como prosseguir?").

### O que entra

- **O erro da porta em `application/problem+json`** (RFC 9457): `type`, `title`, `status`, `detail`, `request_id` —
  e o `erro` e a `mensagem` do Farol junto, como extensão. Quem já lia `erro` continua lendo. Vale também para o que o
  próprio Fastify recusa na porta (JSON torto, corpo grande, tipo errado, rota inexistente, erro interno). Fora da
  porta, o console segue no `{ erro, mensagem }` de sempre (`porta-problema.ts`, `erros.ts`).
- **O código revogado responde IGUAL ao que nunca existiu** (o `acesso_revogado` saiu): mesmo status, mesmo corpo
  (menos o `request_id`), mesmo `WWW-Authenticate: Bearer error="invalid_token"`. A frase diz o que fazer nos dois
  casos. Quem tem um código revogado não fica sabendo que ele existiu.
- **O código novo no formato do Padrão:** `dms_ap_farol_` + 43 + `_` + 6 dígitos de conferência (`gerarChave` do
  pacote comum 0.1.1, copiado em `api/src/dms/`). O código colado pela metade ou com uma letra trocada é recusado sem ir
  ao banco, e o de outro produto ou de outro tipo não entra nem se estivesse no banco. **O `farol_…` de antes continua
  valendo** até ser revogado: ninguém precisa trocar o código que já usa.
- **Limite de chamadas** (429 com `Retry-After`, a frase diz o mesmo tempo): por acesso, 60 consultas por minuto, 12
  envios por hora e 60 conferências por hora; somando a conta, 240 consultas por minuto e 60 envios por hora. A cota da
  conta só conta o que passou na do acesso — um sistema preso num laço de 429 não gasta a cota das outras lojas. As
  cotas são do processo (a API roda numa cópia só).
- **`?somente_validar=true` no envio:** confere tudo e responde o que entraria (`so_validado`, `gravado: false`), sem
  gravar a base, a data do último envio nem a versão que faz o agente baixar. Tem cota própria: quem está montando a
  integração confere várias vezes seguidas, e na cota dos envios travaria em 12. Só `true` e `false` valem — quem
  escreveu `somente_validar=1` queria conferir, e gravar seria o engano que dói (400).
- **A documentação** (`docs/integracao-fichas.md` e a página `/integracao`, só o texto): o prefixo novo, a tabela de
  erros, a forma do erro, a conferência sem gravar e os limites.

### O que fica para a parte 2 (pede protótipo e migration 047)

A validade de 12 meses, a suspensão depois de 90 dias sem uso, a senha e o termo ao criar o acesso. Sem elas, o kit do
Padrão falha em "vencida" e "suspensa" — o teste do kit espera exatamente essas duas falhas, para a parte 2 não passar
despercebida. O nome dos campos (`comFicha`, `recebidoEm` em camelCase; o Padrão usa `snake_case`) é decisão do dono.

### Como foi provado

Os testes da API contra Postgres (`testes/rota-acessos.test.ts`): o corpo problem+json com as extensões; o revogado,
o inexistente e o antigo inexistente com o mesmo corpo e os mesmos cabeçalhos; o código antigo valendo e os que não
servem recusados mesmo com a linha no banco; a 61ª consulta, o 13º envio e a 61ª conferência em 429 (com o
`Retry-After` dentro da janela, nem acima nem muito abaixo); a conta com seis lojas — o acesso que insiste no 429 não
gasta a cota das outras, e a 241ª consulta e o 61º envio da conta param; o "só validar" sem gravar nada, na loja sem
base e na com base, e os valores tortos recusados sem gravar. **O kit de testes do Padrão roda contra a porta de
verdade** (`testes/dms/kit-conformidade.mts`, cópia do Hub) e falha só em vencida e suspensa. Sem banco
(`testes/erros.test.ts`): 404, 400, 413, 415, 500 e o 4xx sem tradução em problem+json na porta, e o contrato de
sempre fora dela (também em `/v1/integracaox/…`). As mutações uma a uma, arquivo restaurado a cada uma, até zero vivas.

## 15/10/2026 · O treinamento da bancada e as fotos por ingrediente: protótipo e decisões aprovados (sem código)

### O pedido

O dono pediu, na madrugada de 15/10, as fotos por ingrediente nas fichas ("já providencie a opção de agregar imagens
nas fichas em cada ingrediente") e o modo treinamento ("com as fichas na mão, e imagens gravadas separadas, se roda
análises locais e traz o resultado para o usuário corrigir ou confirmar acertos aprimorando e aprendendo cada caso.
dando sugestões de nomes para mudar na ficha se for o caso"). Perguntou também se a base de conhecimento na nuvem já
existia: não existe em uso — as tabelas da migration 001 estão vazias (o levantamento está no A21 do roadmap).

### O que entra

- **O protótipo**, nas partes do protótipo do lado do Regem (`mockups/regem/partes/`, montado em
  `mockups/farol-conexoes-e-fichas.html`): na tela Fichas, o botão das fotos em cada ingrediente e a gaveta do
  ingrediente (fotos, envio, limite, "não se vê de cima", exemplos da bancada, fotos de ingrediente que saiu das
  fichas); a tela Treinamento (os números, o acerto por gravação com a meta, as abas Lanches, Ingredientes, Sugestões
  para as fichas e Gravações; a gaveta do lanche; a nova gravação de treino). Desenhos no lugar dos quadros da câmera:
  nenhuma imagem de loja. Os controles do protótipo mostram cada situação e cada perfil.
- **O plano** no roadmap (A21): o desenho, as decisões e as fatias T0 a T6.

### As decisões (o dono: "aprovado", 15/10)

1. A gravação inteira fica só no computador da loja; os quadros das etapas sobem reduzidos e saem 30 dias depois da
   conferência; o recorte conferido vira exemplo da base.
2. A meta: o lanche certo em 9 de cada 10, com pelo menos 30 conferidos, antes das outras estações.
3. Conferem diretoria, gerência e supervisão; gravação, sugestões, tirar foto e "não se vê de cima" ficam com quem
   configura a loja.
4. Até 6 fotos por ingrediente.

### Como foi conferido

Num Chrome sem janela: 19 cenários (telas, gavetas e diálogos) em 16 larguras, de 320 a 1920 px — nada passa da borda
interna da área de conteúdo nem de cada gaveta, nada rola nem corta para o lado, sem erro de script e sem botão sem
nome. Os fluxos em 1280 e 375 px: conferir com "Está tudo certo", corrigir (outro lanche, outra etapa, o que faltou),
o atalho das etapas, o nome novo virando sugestão, responder a uma sugestão, as abas pelo teclado, a gravação com erro
e certa, a foto e o arquivo que não é foto, tirar foto, "não se vê de cima", e da ficha às fotos e de volta. A medida
achou dois defeitos, corrigidos antes de mostrar: o ladrilho "Enviar foto" passava 5 px da borda da gaveta em 320 px
(proporção quadrada numa caixa com texto) e a etiqueta azul saía com o dobro da altura (no estilo de base, `.dado` é a
cor da etiqueta e também o bloco dos números grandes).

## 15/10/2026 · A21, fatia T1: a base de conhecimento passa a valer — o ingrediente da loja e as fotos dele (migration 047)

### O pedido

A primeira fatia de código do A21 (o plano está no roadmap): as fotos de referência por ingrediente, do lado da nuvem.
A tela vem na T2; o agente baixa as fotos na T5.

### O que entra

- **A migration 047** dá uso às tabelas da 001, que estavam vazias. O ingrediente é um item da loja
  (`base_conhecimento`, tipo `item`), um por nome, sem olhar maiúscula nem espaço nas pontas (índice único). O
  `visivel = false` é o "não se vê de cima". A foto é um quadro (`base_frame`, origem `foto`): imagem no banco, tipo,
  largura, altura, `sha256`, legenda e quem mandou. A origem `bancada` fica reservada ao exemplo que a conferência vai
  criar. O `url` deixa de ser obrigatório. Nenhuma linha que já existia muda: as tabelas estavam vazias.
- **Os ingredientes saem das fichas** (`api/src/ingredientes.ts`). Entram os da ficha e o que um adicional acrescenta
  (um insumo, ou um preparo da casa). Não entram a bebida que o adicional põe junto, a observação, nem o que o grupo de
  "tirar" retira — nem quando a fonte manda um efeito de insumo por engano.
- **As rotas** (`api/src/rotas/ingredientes.ts`):
  - `GET /v1/lojas/:id/ingredientes` traz os ingredientes com as fotos (sem os bytes), os exemplos, o "não se vê"
    e os órfãos;
  - `POST /v1/lojas/:id/ingredientes/fotos` recebe a foto (JPEG de até 1,5 MB, como no inventário), com o
    ingrediente travado na transação: até 6, mesmo com envios ao mesmo tempo. O nome que fica é o da ficha, não o
    que veio;
  - `GET /v1/base/fotos/:id/imagem` e `DELETE /v1/base/fotos/:id`. O exemplo da bancada não se tira por aqui;
  - `PUT /v1/lojas/:id/ingredientes/visivel` aceita só `true` ou `false`;
  - `POST /v1/base/itens/:id/juntar` e `DELETE /v1/base/itens/:id`: só para o órfão, o ingrediente que saiu das
    fichas e ainda tem foto.
- **Quem pode** (decisão do dono, 15/10): ver e mandar foto, quem acompanha a loja (supervisão para cima); tirar,
  "não se vê", juntar e apagar, quem configura (gerência para cima). Outra conta não acha nada (404).

### O que mudou do protótipo

O protótipo, ao juntar as fotos de um órfão a um ingrediente que já tem fotos, guardava "as 6 primeiras" e
descartava o resto. A rota recusa (409) e diz quantas tirar antes: juntar nunca descarta foto que alguém mandou.

### Como foi provado

- **Testes da API com Postgres de verdade** (`api/testes/ingredientes.test.ts`, 12 testes; 6 sem banco):
  - a lista e quem vê;
  - a foto: JPEG, tamanho, legenda, o nome da ficha guardado, os bytes iguais na volta, outra conta;
  - o máximo com cinco envios ao mesmo tempo (passam dois);
  - tirar foto;
  - "não se vê" com valores tortos;
  - o órfão: ao renomear na ficha, juntar recusado por passar do máximo, juntar com outra caixa, apagar; e o item sem
    foto, que não vira órfão.
- **A suíte inteira da API** contra um banco de teste local montado com as 47 migrations: passaram todas, menos a já
  conhecida do banco local sem pgvector ("embedding de dimensão errada"). A 047 roda duas vezes sem erro.
- **Mutação: 30 trocas no código novo, 30 mortas**, cada uma por teste que de fato rodou e falhou, com um controle sem
  troca que passa antes e depois. A última viva — gravar o nome como veio, e não o da ficha — morreu com o teste que
  confere o nome guardado.
- A primeira rodada de mutação deu "30 de 30" sem ter rodado teste nenhum: o comando não achava o roteiro. O controle,
  posto depois, pegou isso.

## 15/10/2026 · A21, fatia T2: as fotos de cada ingrediente na tela Fichas (sem migration)

### O que entra

- **Na gaveta do produto**, cada ingrediente da ficha ganha o botão das fotos, com o número delas, "sem foto" ou "não se
  vê". O adicional que acrescenta um ingrediente (um insumo ou um preparo da casa) também tem. A bebida que um adicional
  põe junto, não.
- **A gaveta do ingrediente** (`web/componentes/fichas/gaveta-do-ingrediente.tsx`) mostra:
  - as fotos, com a data no relógio da loja;
  - "Enviar foto": a foto é reduzida no aparelho, como no inventário, e guardada na hora;
  - tirar foto, com confirmação;
  - "Não se vê de cima";
  - como fotografar;
  - e "Voltar ao X-Burger", quando a gaveta foi aberta a partir de um produto.
- **O órfão**: a tela Fichas avisa quando um ingrediente que saiu das fichas ainda tem fotos. A gaveta dele diz de qual
  ingrediente elas são (juntar) ou as apaga, com confirmação.
- **Por perfil**: a supervisão vê e manda foto. Tirar, "não se vê", juntar e apagar aparecem só para quem configura
  (é a API que decide).

### O que mudou do protótipo

- A frase do "não se vê de cima" não promete o que ainda não existe. O protótipo dizia "o Farol para de esperar vê-lo";
  a tela diz que é a marca que o treinamento vai usar.
- Os exemplos da bancada e o reconhecimento só aparecem quando existirem (fatias T4 e T5).
- A legenda de cada foto (o "jeito": "na chapa, antes de ir para o pão") ficou para depois. A API já a guarda; a tela
  mostra a data.

### Como foi provado

- **No console local**, ligado a uma API local com o banco de teste, num Chrome sem janela:
  - **gerência**:
    - abriu o X-Burger: cinco botões na ficha, os dois adicionais certos, e nenhum na bebida;
    - abriu o Blend da casa e enviou duas fotos 1600×1200, que o próprio console reduziu e que voltaram e abriram;
    - tirou uma (pelo diálogo);
    - marcou e desmarcou "não se vê";
    - voltou ao X-Burger, que já dizia "1".
  - **o órfão**: foto na cebola; a cebola renomeada na ficha; o aviso apareceu; as fotos foram juntadas ao nome novo e
    o aviso sumiu.
  - **supervisão**: sem "tirar" nem "não se vê", com "Enviar foto".
- **Larguras**: com cada gaveta e o diálogo abertos, 6 estados em 16 larguras (320 a 1920 px). Nada sai da tela nem
  rola para o lado, sem erro de script.
- **Medição**: a primeira rodada acusou duas falsas falhas.
  - A animação de entrada da gaveta recomeça ao cruzar o corte do celular. A medida passou a esperar por ela.
  - O diálogo de confirmação fica sobre a tela inteira. Ele passou a ser medido contra a própria caixa.
- **Build**: `next build` passou.

## 15/10/2026 · A porta para outro sistema no Padrão DMS, parte 2: validade, renovar, suspenso e reativar, senha e termo, teto e avisos (migration 048)

### O pedido

A parte 2 do pedido da sessão do Hub DMS (`docs/pedido-hub-dms-porta-no-padrao.md`), com as regras do acesso próprio
do Padrão DMS (§2.4, aprovadas pelo dono em 14/10). O protótipo foi preparado pela sessão do Hub, publicado como página
("Acesso próprio do Farol") e no `mockups/farol-conexoes-e-fichas.html`, e **aprovado pelo dono em 15/10/2026**
("aprovado"). Junto, a troca dos nomes dos campos da porta para snake_case — que o dono aprovou na mesma conversa.

### O que entra

- **Migration 048** (`acesso_externo`): `vence_em` (12 meses; os que já existiam passam a vencer 12 meses depois de
  criados), `ultimo_uso_em` (os de antes: o último envio, ou a criação), `token_hash_anterior` e `anterior_vale_ate`
  (o código de antes da renovação), `renovado_*`, `reativado_*`, `termo_versao` e `termo_aceito_em`; e
  `usuario.acessos_vistos_em`.
- **Validade:** o código vale 12 meses; nos 15 dias antes, a lista e a tela Fichas avisam ("vence em N dias").
  **Vencido**, a porta responde `401 chave-vencida` (`erro: acesso_vencido`), com a data no relógio da loja.
- **Renovar** (`POST /v1/acessos/:id/renovar`, com a senha): sai um código novo, e o de antes vale mais 7 dias — o
  tempo de trocar no sistema —, a não ser que já tivesse vencido. Uma instrução só. Renovar de novo dentro dos 7 dias
  para o mais velho na hora.
- **Suspenso:** 90 dias sem uso (qualquer chamada aceita na porta, anotada no máximo uma vez por hora), a porta
  responde `403 chave-suspensa` (`erro: acesso_suspenso`). A chamada recusada não conta como uso. A reativação e a
  renovação recomeçam a contagem. **Reativar** (`POST /v1/acessos/:id/reativar`) é um clique, com o mesmo código; o
  vencido não se reativa (409: precisa de código novo).
- **Vencido e suspenso NÃO apagam as fichas** — só revogar apaga. A tela Fichas diz que as do último envio continuam
  valendo.
- **Criar** pede o aceite do **termo de uso** na versão de agora (`termo-do-acesso.ts`, versão 1; o texto vem da API,
  e a versão aceita fica guardada) e a **senha** de quem cria. Senha errada é 403 (a sessão continua); **só a errada
  conta**: na 11ª errada em 15 minutos, a confirmação para (429) até a janela passar.
- **Teto:** no máximo 10 acessos valendo por conta (Padrão §2.4). A criação trava a linha da conta antes de contar
  (V105): duas pessoas ao mesmo tempo não passam juntas do teto. No teto, o botão vira o aviso.
- **Avisos para a diretoria:** quem é da diretoria vê, no topo de Conexões, o que OUTRA pessoa fez nos acessos nos
  últimos 7 dias (criou, renovou, reativou, revogou), até dizer "Entendi". O Farol não manda e-mail: o aviso é no
  console. Sai das colunas de cada acesso — não há tabela de eventos.
- **A porta em snake_case** (Padrão DMS): `com_ficha`, `sem_ficha`, `de_fora`, `recebido_em`; e a consulta diz até
  quando o código usado vale (`vence_em`). Os campos do console seguem como eram.
- **A tela:** Conexões (a linha do acesso com a situação e o "criado por", Renovar, Reativar, a gaveta de renovar, o
  termo e a senha na de criar, o teto e o aviso) e Fichas (o aviso de vence, venceu e suspenso); a documentação
  (`docs/integracao-fichas.md` e `/integracao`).

### O que a tela tem de diferente do protótipo aprovado

- A linha do suspenso diz "90 dias sem **uso**" (no protótipo, "sem envio"): a regra do Padrão é uso, e uma consulta
  (GET) também conta.
- O aviso para a diretoria traz também "reativou" e "revogou" (o protótipo mostrava "criou" e "renovou").
- Renovado depois de vencer, a linha diz "esperando o primeiro envio com ele" até o sistema enviar com o código novo —
  o estado "renovado-vencido" do protótipo, decidido pelas datas.
- O selo do renovado diz "renovado hoje, 05:18" (no protótipo, "código novo desde hoje, 10:05"): o texto longo passava
  8 px da coluna em 768 px. O protótipo foi trocado junto.

### O que fica para o dono

- **Rede com mais de 10 lojas:** o teto de 10 do Padrão vale aqui também, e o Farol é um acesso por loja. Se uma rede
  maior quiser ligar todas, a recomendação da sessão do Hub é tirar o teto de 10 só no Farol (o limite de chamadas já
  é por conta). É uma constante.

### Como foi provado

Os testes da API contra Postgres (`testes/rota-acessos.test.ts`, 33 testes): criar com o termo e a senha; só a senha
errada conta (a certa e o termo errado, não); o teto com duas criações ao mesmo tempo, presas na trava da conta; renovar
(os 7 dias do código antigo, renovar duas vezes, renovar o vencido, o revogado não se renova nem se reativa); vencido e
suspenso na porta, nas duas pontas de cada prazo (14 e 16 dias; 89 e 91), sem a chamada recusada contar como uso; o uso
anotado uma vez por hora; os avisos (quem fez, a gerência e a outra conta não veem; "Entendi"; os 7 dias). **O kit do
Padrão passa inteiro** (zero falhas, com o vencido e o suspenso). As mutações uma a uma (44, cada uma com os testes da
regra que ela mexe), até zero vivas. A migration aplicada duas vezes no banco local (sem efeito na segunda). A suíte
inteira da API: 1439 de 1440 (a que falha é a do embedding de dimensão errada, que pede o pgvector, ausente no banco
local; no CI ela roda). **As telas de verdade** (o console construído, contra a API local num banco descartável, com
login): cada estado em Conexões e Fichas, as gavetas de criar e de renovar (com os erros), o reativar, o aviso e o teto,
nas 16 larguras de 320 a 1920 px, sem nada passar da borda nem erro de JavaScript — o roteiro achou o selo do renovado
passando da coluna em 768 px, corrigido antes do PR.

## 15/10/2026 · A21, fatia T4 (a API): a conferência do treinamento — o lanche lido, o palpite, a resposta e o exemplo (migration 049)

### O pedido

A conferência do protótipo aprovado em 15/10 (tela Treinamento), do lado da nuvem. A tela vem logo depois, num PR
próprio. A T4 vem antes da T3 (o roadmap diz por quê): a rota que recebe o lanche lido é a que o agente vai usar, e as
leituras de 14/10 entram por ela numa carga.

### O que entra

- **A migration 049**, com três tabelas:
  - `treino_gravacao`: a gravação, com a chave da loja, o canal, o horário, a origem (`gravador`, `programada` ou
    `carga`) e a situação;
  - `treino_lanche`: a leitura (jsonb), a situação (`conferir`, `conferido`, `pulado`), a resposta, o produto, o
    palpite e o acerto;
  - `treino_quadro`: os quadros reduzidos, pelo número da etapa.

  `base_frame` ganha `lanche_id`, `etapa` e `ponto_id`: o exemplo diz de que lanche, etapa e canal veio. Nenhuma linha
  que já existia muda.
- **O contrato** `contratos/lanche-de-treino.json`. Cada etapa diz:
  - o lado e se é o começo da metade;
  - o que a leitura disse;
  - os nomes das fichas que ela acha possíveis: um nome é leitura específica; vários, um grupo que a cor não separa
    (o "molho laranja"); nenhum, não deu para ver;
  - quantas vezes;
  - o quadro.
- **O palpite da ficha** (`api/src/treino.ts`) é feito na nuvem, com as fichas de hoje:
  - o ingrediente da ficha conta como visto quando alguma etapa o tem entre os possíveis;
  - a nota é o que bate sobre o total, menos 0,2 por estranho;
  - o adicional do produto não é estranho;
  - o "não se vê de cima" não entra na conta;
  - o produto sem ficha, ou que a cozinha não faz, não entra.
- **A fila** começa pelos lanches a conferir, na ordem do motivo: a leitura não viu uma etapa; ficou entre dois
  nomes; o palpite tem diferença; e, por último, os que o Farol acha que acertou. É onde a resposta ensina mais.
- **As rotas** (`api/src/rotas/treino.ts`):
  - `POST /v1/agentes/treino/lanches`:
    - com o token do agente, e o canal tem de ser da loja;
    - o mesmo lanche mandado de novo troca a leitura e os quadros;
    - o lanche já conferido não muda;
  - `GET /v1/lojas/:id/treino`: a fila, as gravações, as contas e o que cada ingrediente já ensinou;
  - `GET /v1/treino/lanches/:id` e `GET /v1/treino/quadros/:id/imagem`;
  - `POST /v1/treino/lanches/:id/conferencia`. A resposta diz:
    - o produto, ou "não era um lanche";
    - etapa por etapa: certo, era outro (qual), ou não era ingrediente;
    - o que faltou: o cliente pediu assim, faltou, ou estava lá e a leitura não viu;
    - o que veio a mais: pedido do cliente, ou a mais sem pedido;
  - `POST /v1/treino/lanches/:id/pular`.
- **O exemplo.** A etapa respondida com nome das fichas, e que tem quadro, vira um quadro `bancada` do ingrediente,
  com a imagem copiada. Conferir de novo troca os exemplos do lanche. "Certo" só vale onde a leitura disse um nome; no
  grupo, a pessoa escolhe qual.
- **Os 30 dias.** De hora em hora, o servidor apaga os quadros dos lanches conferidos há mais de 30 dias. O exemplo
  fica (decisão 1).
- **Quem pode.** Conferir e ver é de quem acompanha a loja: supervisão para cima (decisão 3). Outra conta não acha
  nada (404).

### Como foi provado

- **Testes da API** (`api/testes/treino.test.ts`): 16, sendo 8 sem banco e 8 com Postgres de verdade.
  - Sem banco:
    - o corpo do contrato e as recusas (o limite de 2 horas, o quadro que não é JPEG ou passa do tamanho, as vezes, o
      lado);
    - o palpite (o que não se vê, o estranho, o adicional, o que a cozinha não faz, o visto sem nome);
    - o motivo;
    - a resposta ("certo" num grupo é recusado);
    - o que vira exemplo e o aprendizado.
  - Com banco:
    - o corpo do contrato de ponta a ponta;
    - o canal de outra loja;
    - a fila com as fichas de hoje e as miniaturas;
    - quem vê e quem confere (a execução não);
    - o acerto e os exemplos com a imagem copiada;
    - conferir de novo;
    - mandar de novo o conferido;
    - pular;
    - os 30 dias.
- **Mutação: 34 trocas no código novo, 34 mortas**, com um controle sem troca que passa antes e depois.
- **A suíte inteira da API** contra um banco de teste local montado com as 49 migrations: 1467 de 1468. A que falha é a
  já conhecida do banco local sem pgvector ("embedding de dimensão errada"); no CI ela roda. A 049 roda duas vezes sem
  erro.

### O número

A 048 foi da porta (#150), que chegou antes à `main`. Esta fica com a 049.

## 15/10/2026 · A21, fatia T4 (a tela): Treinamento no console — a fila, a conferência e o que a bancada já sabe (sem migration)

### O que entra

- **A tela Treinamento** (`web/app/(console)/lojas/[id]/treinamento/page.tsx`). Ela fica no menu depois de Fichas,
  para o mesmo grupo (supervisão para cima e o suporte). No celular, mora no "Mais". Também aparece no "Ir para".
  - **Os números**: os lanches conferidos; o lanche certo antes da conferência ("2 de 4"); os ingredientes da bancada
    com exemplo.
  - **A barra de acerto de cada gravação**, com o traço da meta nos 90%. A frase diz quanto falta para a meta valer
    (30 conferidos).
  - **Lanches**: para conferir, conferidos e pulados. A fila começa pela dúvida, como a API ordena. Cada linha tem as
    miniaturas do tampo e da base, o palpite e o motivo.
  - **Ingredientes**: os dos produtos conferidos na bancada e o que a conferência ensinou. Cada um mostra as fotos, os
    exemplos e o estado: "reconhece", "aprendendo", "sem exemplo" ou "não se vê de cima". O ingrediente abre a gaveta
    da T2. O aviso do órfão também está aqui.
  - **Gravações**: a situação de cada uma e o "Conferir".
- **A gaveta de conferência** (`web/componentes/treino/gaveta-do-lanche.tsx`):
  - "Qual lanche era?": nada vem marcado;
  - as etapas, com o quadro;
  - "Marcar as outras N como certas";
  - a conta da ficha do lanche escolhido, com o que falta e o que veio a mais;
  - "Pular", "Está tudo certo" e "Salvar e ir para o próximo". O próximo é o da mesma lista.
- **Quem pode**: a execução não vê a tela nem o item do menu (a API responde 403). Só quem configura marca "não se vê
  de cima" e tira foto (como na T2).

### O que mudou do protótipo

- **Ficou de fora o que ainda não tem serviço**: "Nova gravação de treino" (T3) e a aba "Sugestões para as fichas"
  (T6). A frase do topo diz que o caso conferido "vira exemplo na base da bancada". O protótipo dizia "para a próxima
  leitura", e isso só vale com a T5.
- **A leitura de verdade não tem um nível de certeza; tem os nomes possíveis.** Por isso:
  - em vez de "certeza alta / média / baixa", a etapa mostra "pode ser: A ou B" (o grupo que a cor não separa), ou
    "= nome da ficha" quando a palavra da leitura é outra;
  - no grupo, há um botão para cada nome e não há "Certo" (a API recusa "certo" num grupo);
  - os motivos da fila viraram "uma etapa ficou sem leitura" e "a leitura ficou entre dois nomes".
- **"Não sei o que era"** limpa a resposta da etapa (a etapa sem resposta não ensina), em vez de guardar um "não sei".
- **O lanche conferido abre de novo**, com a resposta de antes e "Salvar de novo" (a API troca os exemplos). No
  protótipo, a linha do conferido não abria.
- **O nome escrito à mão** (fora das fichas) fica guardado na resposta. A sugestão para as fichas vem com a T6.

### Como foi provado

- **No console local**, ligado a uma API local com o banco de teste, num Chrome sem janela. A conta de teste tinha:
  - as fichas do contrato e mais um X-Bacon e um X-Salada;
  - o canal da bancada;
  - 11 lanches com quadros DESENHADOS (nenhuma imagem da loja), mandados pela rota do agente;
  - 4 conferidos.
- **Gerência**:
  - a fila de 7 começa pelo lanche sem leitura numa etapa, depois a dúvida;
  - os números ("4", "2 de 4") e a barra;
  - o lanche sem leitura: "Eu sei o que era" sem nome não deixa salvar, e o pé diz por quê; com o tomate escolhido, a
    conta mostra "1 de 2";
  - "Salvar e ir para o próximo" abriu a dúvida, "1 de 6 para conferir";
  - na dúvida: um botão por nome e nenhum "Certo"; "Não sei o que era" limpa;
  - "Pular" abriu o próximo, e o filtro passou a dizer "Pulados 1" e "Conferidos 5";
  - o conferido reabriu com o tomate e o produto de antes;
  - as abas Ingredientes (o sal "não se vê de cima", o tomate com exemplo) e Gravações;
  - o "Mais" do celular.
- **Supervisão**: conferiu com "Está tudo certo" (5 exemplos novos), e a gaveta do ingrediente aparece sem o "não se
  vê".
- **Execução**: "Seu perfil não vê o treinamento da loja", sem o item no menu.
- **Larguras**: 10 estados (cada gaveta aberta) em 16 larguras, de 320 a 1920 px. Nada sai da tela nem rola para o
  lado, sem erro de script, em três rodadas, cada uma numa conta nova.
- **Correções feitas antes do PR**, achadas nas capturas:
  - no celular, a barra de acerto punha o número antes da data (a posição na grade);
  - a etapa marcada "Certo" mostrava a leitura riscada, como se estivesse errada;
  - os três números e as quatro escolhas de "Qual lanche era?" ocupavam a tela do celular, empilhados.
- **Build**: `next build` passou.

## 15/10/2026 · A carga das leituras de 14/10 para a conferência (sem código no repositório)

As leituras que a bancada fez em 14/10 (as do repasse, rodada 12) subiram para a conferência pela rota do agente
(`POST /v1/agentes/treino/lanches`). Foi uma vez só, por um roteiro numa pasta temporária do computador da loja, que
depois foi apagada.

- **O que subiu.** 10 lanches de duas gravações:
  - `carga-2026-10-14-2148`: os lanches 01, 02, 14, 20, 28, 30, 35 e 38;
  - `carga-2026-10-14-1930`: o Numero 16 e o Mussarela.

  São 64 quadros reduzidos, com no máximo 360 px. O lanche 27, a trilha que misturou o 28 e o 30, não tem etapa de
  ingrediente e ficou de fora.
- **A leitura usada** é o identificador local sem a correção de luz: o resultado da v12, o melhor medido.
- **Os nomes possíveis de cada etapa** saem das fichas da loja (31 nomes). O grupo de cor vira os nomes dele que estão
  nas fichas. O "não sei" do identificador vira "não deu para ver". O que não é ingrediente (papel, fechou, saiu) fica
  de fora.
- **O canal 4** veio da configuração que desce para o agente, e o token, do ambiente do computador da loja. Nenhum dos
  dois foi impresso.
- **Para quê.** O dono confere em Treinamento. Cada etapa respondida vira exemplo da base, e o acerto começa a contar.

## 15/10/2026 · A21, fatia T3 (a nuvem e a tela): a gravação de treino — criar, cancelar, apagar as imagens, e a conversa com a loja (migration 050)

### O que entra

- **A migration 050**: `treino_gravacao.motivo`, o porquê de a leitura ter falhado, como a loja contou.
- **As regras** (`api/src/treino-gravacao.ts`), as do protótipo:
  - de 15 minutos a 1 hora;
  - do gravador: o horário já terminou e começou há no máximo 18 horas, o que o gravador desta loja guarda;
  - programada: ainda vai começar, até 7 dias;
  - a data chega com o fuso escrito: o console monta no relógio da loja.
- **No console** (quem configura):
  - `POST /v1/lojas/:id/treino/gravacoes` cria. O canal tem de ser uma câmera do gravador desta loja, e duas gravações
    do mesmo canal não se sobrepõem (a que falhou ou foi cancelada não segura o horário);
  - `POST /v1/treino/gravacoes/:id/cancelar` cancela a programada ou a da fila;
  - `POST /v1/treino/gravacoes/:id/apagar-imagens` apaga, só quando a gravação está pronta e com tudo conferido. Os
    quadros saem da nuvem na hora e o exemplo fica.
- **Para a loja** (com o token do agente):
  - `GET /v1/agentes/treino/gravacoes` diz o que ler e o que ela já pode apagar do computador dela: a cancelada, a
    apagada, a que falhou, e a pronta com tudo conferido há mais de 30 dias;
  - `POST /v1/agentes/treino/gravacoes/:id/andamento` recebe lendo (com a porcentagem), pronta ou falhou (com o
    motivo). A gravação cancelada no console responde 409, e a loja para;
  - o lanche de gravação cancelada ou apagada não entra (409).

  O contrato é `contratos/gravacao-de-treino.json`.
- **A lista da tela** traz as câmeras do gravador, as regras e se o computador da loja já sabe gravar (o agente ativo
  declara `treino`).
- **A tela**:
  - "Nova gravação de treino" (`web/componentes/treino/gaveta-da-gravacao.tsx`): a bancada, de onde, o dia e os dois
    horários, com o erro dito antes de mandar;
  - "Cancelar" e "Apagar as imagens" (com confirmação) na aba Gravações;
  - o motivo da falha na linha;
  - o aviso enquanto o computador da loja não sabe gravar: a gravação espera na fila.

### O que mudou do protótipo

- **"Programar" não grava ao vivo**: o gravador já grava sempre. O computador da loja busca o trecho nele depois que o
  horário termina, como na gravação "do que o gravador já guardou". É um caminho só.
- **"30 minutos gravados levam perto de 1 hora para ler" ficou de fora**: ainda não foi medido com o módulo da loja.
- **O diálogo de apagar** diz o que acontece agora: os quadros saem da nuvem, e o computador da loja recebe a ordem de
  apagar a gravação.
- **O aviso de que a loja ainda não sabe gravar** é novo: o protótipo não tinha esse estado.

### Como foi provado

- **Testes da API** (`api/testes/treino-gravacao.test.ts`): 10, sendo 4 sem banco e 6 com Postgres de verdade.
  - As regras, com os limites.
  - Quem cria; o canal de outra loja e a câmera IP recusados; a sobreposição.
  - A lista da loja com as chaves do contrato; o andamento.
  - A falha com o motivo.
  - Cancelar, com o lanche da cancelada recusado.
  - Apagar as imagens: os quadros saem e o exemplo fica.
  - A regra dos 30 dias para a loja apagar a dela.
- **Mutação: 39 trocas no código novo, 39 mortas**, com controle antes e depois. Duas, de trecho com quebra de linha,
  não tinham sido aplicadas: o arquivo de rotas está com CRLF. O roteiro avisou ("trecho não achado"), e elas rodaram
  de novo com trechos de uma linha.
- **A suíte inteira da API** contra o banco de teste com as 50 migrations: 1477 de 1478. A que falha é a conhecida do
  banco local sem pgvector; no CI ela roda. A 050 roda duas vezes sem erro.
- **A tela**, no console local:
  - criar com 5 minutos mostra o erro, e com 30 minutos cria;
  - a programada aparece no topo e cancela;
  - o diálogo de apagar apaga a gravação conferida;
  - a supervisão não cria, não cancela e não apaga;
  - 13 estados × 16 larguras, sem nada para fora e sem erro de script.
- **Build**: `next build` passou.

### Falta

A parte da loja: o módulo do agente que pergunta, busca o trecho no gravador, lê os lanches (as ferramentas da rodada
12, que viram módulo com testes), manda e conta o andamento, e apaga o que a nuvem disser. Entra num pacote novo, com o
"pode" do dono.

## 15/10/2026 · A21, fatia T6: as sugestões para as fichas (migration 051)

### O que entra

- **As sugestões** (`api/src/treino-sugestoes.ts`) são tiradas SÓ do que alguém conferiu, com as fichas de hoje. São
  quatro tipos, os do protótipo:
  - **nome fora das fichas**: alguém escreveu, na conferência, um nome que não está em ficha nenhuma. A sugestão é
    cadastrar, para os exemplos irem para o ingrediente certo. Conta uma vez por lanche;
  - **falta na ficha**: num produto, quem conferiu disse que um ingrediente veio "a mais, sem pedido";
  - **ficha diferente da bancada**: num produto, quem conferiu disse que um ingrediente da ficha FALTOU, e a etapa
    mostra menos do que a ficha pede. O título diz quanto entrou (o valor que mais aparece) ou que não entrou;
  - **um nome para duas coisas**: o mesmo nome confirmado em etapas que a leitura viu como molhos de cores diferentes.
- **A migration 051** guarda a resposta de quem configura (`sim`: vai mudar a ficha; `nao`: fica como está), pela
  chave da sugestão (o tipo, o produto e o ingrediente). Junto vai um retrato do que a sugestão dizia: a respondida que
  as conferências deixaram de mostrar continua na tela, como foi respondida.
- **As rotas**:
  - a lista da loja traz as sugestões, com a resposta, e de onde as fichas vêm;
  - `POST /v1/lojas/:id/treino/sugestoes` guarda a resposta. É de quem configura, e só vale para o que o Farol sugere
    AGORA.
- **A tela**: a aba "Sugestões para as fichas" (`web/componentes/treino/painel-das-sugestoes.tsx`), com a conta das
  que esperam resposta. Cada cartão traz:
  - o que a bancada mostrou;
  - a sugestão;
  - onde mudar, pela origem das fichas: no Regem, em Estoque › Fichas técnicas; na planilha, importando de novo; ou
    no sistema que envia as fichas;
  - os dois botões, com o que cada resposta quer dizer.

  Quem não configura vê a frase "Quem configura a loja responde às sugestões".

### Os limites — leitura minha, para o dono confirmar

Um caso só não vira sugestão. A falta na ficha e a ficha diferente pedem pelo menos 3 lanches E pelo menos metade dos
conferidos daquele produto. O molho de duas cores pede cada cor em pelo menos 2 etapas. O nome fora das fichas vale
desde a primeira vez: é um nome que ninguém tem onde guardar.

### O que mudou do protótipo

- **Ficou de fora a frase** "quando a ficha chegar com a mudança, o Farol leva junto as fotos e os exemplos do nome
  antigo": isso ainda não existe. O órfão continua sendo juntado à mão, em Fichas (fatia T2). No lugar dela, a
  respondida diz quem respondeu e quando.
- **O "dois jeitos" só olha molho**: a leitura de verdade dá nome de cor só aos molhos ("molho laranja", "molho
  branco"). A cebola e a carne têm grupos próprios, que já são "um nome para duas coisas" de propósito.

### Como foi provado

- **Testes da API** (`api/testes/treino-sugestoes.test.ts`): 9, sendo 6 sem banco e 3 com Postgres de verdade.
  - Cada tipo, com o limite de cada lado. Os casos que NÃO sugerem: o pedido do cliente, a leitura que não viu, a
    etapa que mostra o que a ficha pede, a cebola de duas cores.
  - A ordem dos tipos.
  - A resposta: a supervisão e outra conta não respondem; a decisão torta e a sugestão que não existe são recusadas;
    mudar a resposta guarda o retrato novo; a respondida que sumiu das conferências fica.
- **Mutação: 25 trocas no código novo, 25 mortas**, com controle antes e depois. Três testes foram reforçados antes da
  rodada, porque deixariam mutação viva: a moda com contagens misturadas, a ordem dos tipos que não coincide com a
  alfabética, e o retrato quando a resposta muda.
- **A suíte inteira da API** contra o banco de teste com as 51 migrations: 1486 de 1487. A que falha é a conhecida do
  banco local sem pgvector; no CI ela roda. A 051 roda duas vezes sem erro.
- **A tela**, no console local:
  - uma conta com três X-Burger conferidos de um jeito que gera três sugestões;
  - a gerência respondeu "Vou cadastrar": a conta da aba caiu de 3 para 2, e a respondida foi para o fim, com quem
    respondeu;
  - a supervisão viu os cartões sem os botões;
  - 3 estados × 16 larguras, sem nada para fora;
  - o roteiro completo da tela também passou de novo (13 estados × 16 larguras).
- **Build**: `next build` passou.

## 15/10/2026 · A21, fatia T5 (a parte da nuvem): a base de conhecimento desce para a loja (sem migration)

### O que entra

- **`GET /v1/agentes/base`** (`api/src/rotas/base-na-loja.ts`), com o token do agente. Traz os ingredientes da loja
  que têm o que ensinar:
  - as fotos de referência (T1);
  - os exemplos da bancada que a conferência guardou (T4);
  - o "não se vê de cima" (a leitura para de esperar vê-lo).

  De cada quadro vão só o id, a origem, o sha256 e o tamanho. O ingrediente sem quadro e visível não desce. A
  `impressao` muda quando entra ou sai um quadro, quando um quadro muda de imagem, ou quando um ingrediente muda de "se
  vê" para "não se vê"; a ordem não muda.
- **`GET /v1/agentes/base/quadros/:id`**: a imagem de um quadro DESTA loja. Outra loja recebe 404.
- **O contrato** é `contratos/base-de-conhecimento.json`.

### Por que não pela configuração

As fichas descem marcadas na configuração (`fichas.impressao`). A base muda a cada conferência, e pôr a marca dela na
configuração faria a loja puxar a configuração inteira a cada lanche conferido. A loja pede a lista quando precisa:
antes de ler uma gravação de treino e uma vez por dia. É a frequência de leitura pelo dado, como o cadastro das fichas.

### Como foi provado

- **Testes da API** (`api/testes/base-na-loja.test.ts`): 5, sendo 2 sem banco e 3 com Postgres de verdade.
  - A marca (a ordem não conta; o nome sem maiúscula nem espaço; muda com quadro, imagem e "não se vê").
  - A lista com as chaves do contrato; o item sem nada a ensinar não desce.
  - O quadro com os mesmos bytes do resumo; o da outra loja e sem token, recusados.
  - A impressão muda com a foto nova, o "não se vê" e a foto tirada.
- **Mutação: 9 trocas, 9 mortas**, com controle antes e depois.
- **A suíte inteira da API**: 1491 de 1492. A que falha é a conhecida do banco local sem pgvector; no CI ela roda.

### Falta

A parte da loja: baixar a lista, guardar cada quadro pelo sha256, apagar o que saiu, e a leitura comparar com os
exemplos. Entra num pacote novo, com o "pode" do dono.

## 15/10/2026 · A fila da cozinha chega à loja: a parte da nuvem (fatia 5 do "Regem no Farol", sem migration)

### O que entra

- **`GET /v1/agentes/fila-da-cozinha?versao=`** (`api/src/rotas/fila-da-cozinha.ts`), com o token do agente. A nuvem
  lê a fila no Regem (`GET /integracao/producao`, a fase 2 de lá) com o acesso guardado da loja. O agente nunca vê
  esse acesso.
- **A conversão** (`api/src/fila-da-cozinha.ts`): os pedidos da janela do Regem (em produção nas últimas 24 horas;
  prontos, entregues ou cancelados nas últimas 2 horas), cada um com os itens, a variação, as escolhas e a
  observação. A escolha sai no formato da base de fichas (`Efeito`) e com os ids fixos de lá: a opção, o insumo, a
  sub-receita. Assim a loja casa o "sem cebola" com o ingrediente da ficha pelo id, sem depender de nome. O id da
  variação, que o Regem troca a cada salvamento, não desce: a variação casa pelo código, como na base.
- **A versão é a do que desce**, e não a do Regem. Lá a versão muda quando muda o que não desce (o id da variação),
  e a loja baixaria a mesma fila de novo. A hora em que o Regem montou a resposta também não entra.
- **O contrato** é `contratos/fila-da-cozinha.json`: a resposta de exemplo do Regem (`doRegem`) e exatamente o que
  desce dela, o "nada mudou", o ritmo e cada recusa com o que o agente faz.

### O ritmo: uma leitura do Regem por loja a cada 15 segundos

O Regem aceita 60 chamadas por minuto por acesso, somando cardápio, fichas e fila, e sugere ler a fila de 15 em 15
segundos. A última leitura de cada loja fica na memória da API:

- quem pergunta dentro dos 15 s recebe a mesma leitura;
- perguntas ao mesmo tempo esperam a MESMA leitura;
- uma falha fica guardada por 30 s, e o Regem fora do ar não recebe uma chamada a cada pergunta;
- a falha de passagem não apaga a leitura boa: a pergunta seguinte ao Regem ainda leva a versão de lá;
- a loja sem leitura há 10 minutos sai da memória.

Toda resposta, de acerto ou de recusa, diz em quantos segundos perguntar de novo (`esperarS`). A nuvem regula o
ritmo da loja sem pacote novo. Cada réplica da API tem a sua memória: com N réplicas, até N leituras por loja a cada
15 s.

### As recusas

| status | erro | quando | o agente pergunta de novo em |
|---|---|---|---|
| 404 | `sem_regem` | a loja não está ligada ao Regem, ou o acesso foi tirado lá | 600 s |
| 409 | `sem_escopo` | ligada, mas a autorização não inclui a fila (é preciso conectar de novo) | 600 s |
| 502 | `regem_fora` | o Regem não respondeu, ou respondeu fora do contrato | 30 s |
| 503 | `sem_chave` | esta instalação não tem a chave que abre o acesso | 600 s |

**O acesso tirado no Regem** (401 na leitura da fila) não é tratado aqui: a rota dispara a leitura das fichas. Ela
confirma com a chamada dela e aplica a regra que já existe (o acesso cai e a base da loja sai na hora, decisão de
11/10). A regra fica num lugar só.

### Uma escrita a menos por pergunta

Cada pergunta do agente anotava o uso do token na linha do agente (`token_usado_em`). Com a fila perguntada a cada
15 s, seriam 4 escritas por minuto por loja só para isso. Agora a anotação acontece no máximo uma vez por minuto.
Ninguém lê esse campo além da própria escrita.

### Como foi provado

- **Testes da API** (`api/testes/fila-da-cozinha.test.ts`): 22, sendo 5 sem banco e 17 com Postgres de verdade e o
  Regem de teste (que passou a responder a fila e o 403 de escopo).
  - O contrato: a resposta do exemplo é a que a conversão tira do exemplo do Regem, com a versão; as chaves e as
    listas; o que não desce.
  - O tolerante: pedido, item e escolha fora do contrato ficam de fora e são contados.
  - A versão: muda com o que desce, e só com isso.
  - A rota: a fila exatamente como no contrato; o "nada mudou"; as perguntas juntas (5 ao mesmo tempo, 1 leitura);
    a pergunta "mudou?" ao Regem com a versão de lá; a mudança que não desce; cada falha do Regem (erro, limite,
    mudo, página, resposta torta); a falha guardada; o escopo; o acesso tirado (a conexão cai e a base sai); uma loja
    não vê a fila da outra; a conexão nova não usa a versão da antiga; sem a chave; a faxina da memória; a anotação
    do uso do token.
- **Mutação: 33 trocas, 33 mortas**, com controle antes e depois (a conversão, a memória, as perguntas juntas, cada
  recusa, a versão, a faxina e a anotação do uso do token).
- **Um teste antigo ficou firme.** Na suíte inteira, o teste de corrida do teto das dúvidas do balcão falhou uma vez:
  ele esperava tempos fixos, e com mais carga a segunda dúvida chegava depois de a primeira terminar (e cabia no
  teto). Agora ele espera pelo efeito: as duas chamadas paradas na trava do banco, e a resposta da que perde. Com a
  trava tirada da rota de propósito, ele falha (ERR-127).
- **A suíte inteira da API**: 1513 de 1514. A que falha é a conhecida do banco local sem pgvector; no CI ela roda.

### Falta

- **A parte da loja**: o agente perguntar a fila no ritmo que a nuvem diz, guardar a última, e a conferência da
  bancada usá-la (a escolha "sem" explica a falta do ingrediente). Entra num pacote novo, com o "pode" do dono.
- **No piloto**, o Regem da loja hoje só tem pedido de delivery (o dono, 14/10). O balcão e o salão entram na fila
  quando passarem pelo Regem.

## 15/10/2026 · A21, fatia T3a: a gravação de treino do lado da loja — a conversa com a nuvem (dormindo, sem migration)

### O que entra

- **`farol_agent/treino.py`**, no agente, e duas chamadas no cliente da nuvem (`gravacoes_de_treino` e
  `andamento_da_gravacao`). O agente:
  - pergunta o que ler e o que já pode apagar (`GET /v1/agentes/treino/gravacoes`), e confere a lista: a gravação
    fora do formato fica de fora, e a chave que não serve de nome de pasta não entra;
  - escolhe a próxima: a que já estava lendo (volta de onde parou) e, depois, a mais antiga cujo horário acabou há
    mais que a folga do gravador para a gravação assentar (o perfil do gravador diz a dele; sem perfil, 3 minutos);
  - conta o andamento: a porcentagem só sobe quando anda 5 pontos (e "lendo" nunca diz 100 — quem diz é "pronta");
    a que não entrou é mandada de novo; o motivo da falha vai limpo, com até 200 caracteres, e nunca vazio;
  - dá a cada recusa o destino do contrato: 401/403 para e avisa; 404 esquece a gravação; 409 para de ler e apaga o
    que guardou dela; 422 não repete; rede, 5xx e 429 contam de novo na volta seguinte;
  - apaga do disco só o que a nuvem mandou, só pasta e só dentro da pasta do treino: um atalho com o nome da chave
    que aponte para fora não é seguido.
- **A T3 da loja ficou em quatro fatias** (o roadmap, A21): T3a (esta), T3b buscar o trecho no gravador, T3c ler a
  bancada, T3d ligar.

### Dormindo

Nada no agente chama o módulo, e o agente ainda não declara "treino": a tela continua avisando que o computador da
loja não sabe gravar. Declarar antes da leitura da bancada (T3c) faria o console prometer o que a loja não faz. Um
teste guarda isso.

### Como foi provado

- **Testes do agente** (`agent/testes/test_treino.py`): 26. O contrato (`contratos/gravacao-de-treino.json`, o mesmo
  da API): a lista do exemplo, os corpos do andamento e cada recusa; a próxima; a porcentagem; o motivo; a lista
  torta; o disco (com o atalho para fora, provado com a junção de pasta do Windows); e as duas rotas pela rede de
  verdade.
- **Mutação: 24 trocas, 24 mortas**, com controle antes e depois.
- **A suíte inteira do agente**: 1815 passaram, 1 pulado.

### Falta

T3b (buscar no gravador: a hora de buscar é decisão do dono — a placa da loja é de 10 Mbit/s e, pela conta com a
medida de 10/10 (um bloco de 2 s = 0,53 MB em 1,9 s), 30 minutos de gravação são perto de 480 MB e 28 minutos de
rede), T3c (ler a bancada) e T3d (ligar). A troca de pacote pede o "pode".

## 15/10/2026 · A21, fatia T3b: buscar no gravador o trecho da gravação de treino (dormindo, sem migration)

### O que entra

`farol_agent/treino_trecho.py`, no agente, em cima do cliente de arquivo do gravador (onda 2, fatia 2.1):

- **Pedaços de até 40 s, alinhados aos blocos do gravador.** É o maior pedido do cliente, e o pedido desalinhado
  cobriria mais que isso. Com bloco de 3 s, o pedaço é de 39 s; sem bloco medido, de 40 s sem a fração do segundo.
- **A hora é a do gravador.** O instante da nuvem vira a hora do computador (o fuso da máquina) e, com a diferença
  que o cliente mede, a do gravador. O nome de cada pedaço é a hora do gravador em que ele começa.
- **Só o que assentou** (pelo perfil do gravador), **só quando "pode buscar"** (quem chama decide; a hora é do dono)
  e **com 2 GB livres no disco**, no mínimo: o computador da loja é também o servidor local do Regem.
- **Retoma de onde parou.** O manifesto da pasta (`trecho.json`, trocado de uma vez a cada pedaço) diz o que já veio;
  o que veio não é pedido de novo, nem depois de o agente reiniciar. O pedaço que sumiu do disco volta a ser pedido;
  manifesto torto, ou de outro formato, vale como vazio.
- **O destino de cada erro do gravador:** sem gravação no pedaço, anota e segue (o gravador guarda ~18 h); ocupado,
  para e tenta depois; senha recusada, para tudo (o cliente não repete a senha recusada — a conta do gravador
  trava); outro erro, o pedaço é tentado de novo depois e, na terceira vez, fica anotado como falho e a busca segue.

Quem chama recebe como a busca ficou (os pedaços que vieram, sem gravação e falhos; por que parou) e conta o andamento
— a ligação com a T3a é a T3d.

### Como foi provado

- **Testes do agente** (`agent/testes/test_treino_trecho.py`): 22, com um gravador de mentira que faz a mesma conta
  de alinhamento do cliente de verdade e recusa, como ele, o pedido que cobre mais de 40 s. Os pedaços com cinco
  perfis de gravador; a hora; o assentar; a retomada (com o agente "reiniciado"); cada erro; o disco; o manifesto.
- **Mutação: 19 trocas, 19 mortas**, com controle antes e depois.
- **A suíte inteira do agente**: 1837 passaram, 1 pulado.

### O que não foi medido

O gravador da loja entregando um trecho de 30 minutos assim, pedaço a pedaço: a conta de 480 MB e 28 minutos é feita
com a medida de um bloco (10/10). A primeira busca de verdade é a prova — e ela pede a troca do pacote.

### Depois, no mesmo dia: os pedaços com o nome que o leitor do repasse lê

Ao começar a T3c, ficou à vista que o leitor do expediente (R1, `ferramentas/repasse/leitor.py`, testado no CI) lê
`canal-NN/AAAA-MM-DD_HH-MM-SS.dav` — o nome da cópia guardada da loja —, e não o nome que a T3b dava. Como a T3b
dorme, mudou sem custo: os pedaços ficam na pasta do canal com esse nome, e o manifesto anota onde cada um começa e
termina (os pedaços daqui têm até 40 s, não 5 minutos). `pedacos_baixados` entrega à leitura só os que vieram
inteiros, em ordem: o arquivo pela metade que fica de uma queda (o manifesto nunca disse que ele veio) não entra, e é
pedido de novo por cima. Testes 25; mutação 25 de 25.

## 15/10/2026 · A21, fatia T3c-1: a gravação de treino vira um quadro por segundo da bancada (dormindo, sem migration)

### O achado que ordenou a T3c

O pacote da loja leva só `farol_agent`, compilado (`ferramentas/pacote_compilado.sh`): o `ferramentas/repasse/` não
vai. E a leitura da bancada da rodada 12 — `quadros_por_lanche` v3 e `identificar_lanche` v14, que até hoje rodaram
como roteiros soltos na loja — lê a CAPTURA DENSA (um quadro por segundo, feita ao vivo), enquanto o leitor do
expediente (R1) tira só um quadro por parada da bancada. A T3c ficou em quatro: a captura densa a partir da gravação
(esta), os quadros de cada lanche, os ingredientes (com a calibração do canal 4 num perfil da loja) e o corpo do lanche
de treino.

### O que entra

- **`farol_agent/gravacao_lida.py`**: o que o R1 e a gravação de treino dividem, agora dentro do pacote — os quadros
  com a hora certa (o relógio de dentro consertado; a contagem como reserva, e o aviso de qual valeu em cada quadro),
  a folga do relógio de dentro (10% do tamanho do pedaço), a hora pela contagem, o quadro do canal (o de papel
  "montagem") e o recorte da área. O `ferramentas/repasse/leitor.py` passou a importá-los dali, com os mesmos nomes
  (os 38 testes dele seguem verdes).
- **`farol_agent/treino_quadros.py`**: para cada pedaço que a busca trouxe (`treino_trecho.pedacos_baixados`, com o
  fim no que o pedido cobre — o último pedaço, curto, traz o bloco inteiro), um recorte a cada segundo da área de
  montagem, com a hora do gravador e a da loja (menos o adianto). Depois de um salto do relógio, a amostra seguinte é
  um passo depois — não uma atrás da outra. Sai em `paradas.csv` + `recortes/`, o formato da captura densa ao vivo e
  do R1. A retomada é pelo `densa.json` (trocado de uma vez a cada pedaço, e o `paradas.csv` refeito dele): o pedaço
  lido não é lido de novo, o que não abre fica anotado e não se repete, e anotação de outro passo ou de outro adianto
  não vale. Quem chama diz se pode seguir, antes de cada pedaço (o computador da loja é também o servidor do Regem).

### Como foi provado

- **Testes do agente** (`agent/testes/test_treino_quadros.py`): 15, com vídeo de verdade (o sintético do R1) e com
  uma captura de mentira para o relógio de dentro que recua e o que não anda; o relógio que termina longe do tamanho
  do pedaço; o salto; a retomada; o pedaço que não abre; a ordem; e a captura densa consumindo o manifesto da busca.
- **Mutação: 21 trocas, 21 mortas** (uma ficou viva na primeira rodada — a borda dos 10% do relógio de dentro; o teste
  da borda entrou e ela morreu), com controle antes e depois, rodando também os testes do R1.
- **A suíte inteira do agente**: 1855 passaram, 1 pulado.

### O que não foi medido

A captura densa a partir de um pedaço `.dav` de verdade do gravador da loja — os testes usam AVI. A leitura de verdade
(e a comparação com a captura densa ao vivo de 14/10) espera a troca do pacote ou uma rodada à parte na loja.

## 15/10/2026 · A21, fatia T3c-2: os quadros de cada lanche (dormindo, sem migration)

### O que entra

- **`farol_agent/treino_lanches.py`**: o `quadros_por_lanche` v3 da rodada 12 como módulo. Da captura densa
  (T3c-1): o detector acha os pães abertos (o quadro inteiro e 6 pedaços sobrepostos; o mesmo pão visto em vários
  pedaços conta uma vez); as metades vizinhas são um lanche; o lanche é seguido de quadro em quadro — no mesmo lugar,
  pela sobreposição; empurrado ou fechado, pela cara (as cores do miolo), num trecho novo; sem pão por mais que o
  perfil diz, termina; a trilha curta não é lanche. Cada lanche vira uma pasta: os recortes na CAIXA FIXA de cada
  trecho, as etapas (mexeu, assentou e ficou diferente) e o `metades.csv` (onde o detector viu cada metade, em pixels
  da caixa) — o que a identificação dos ingredientes (T3c-3) lê. O resumo de todas as trilhas fica em `lanches.json`.
- **O que é da loja vai no perfil** (`PerfilDaBancada`, sem valor de fábrica): o tamanho do pão em pixels, os
  limites de "mexeu" e "mudou", o tempo sem pão que encerra, a cara parecida e a duração mínima. O que é do modelo e
  da conta (a nota 0,3, as metades a 1,6 diâmetro, a folga de 25%) fica no código, com a medida de onde veio.
- **A hora com a data**: o v3 contava o segundo do dia, e a gravação que passa da meia-noite se perderia.
- **O detector ganhou as caixas** (`MotorOnnx.caixas`, na mesma sessão e com a mesma prova da placa de vídeo; a
  conta das caixas, `interpretar_caixas`, testável sem o arquivo do modelo).

### Como foi provado

- **Testes do agente** (`agent/testes/test_treino_lanches.py`): 10, com uma bancada desenhada (as metades como discos)
  e um detector de mentira que acha os discos pela cor. A cena: o braço por cima, o ingrediente que fica, a mão em
  cima de UMA metade (a região encolhe), o lanche empurrado, a bandeja curta, e o tremor de 2 px que o detector de
  verdade tem; a virada da meia-noite; e as contas.
- **Mutação: 25 trocas, 25 mortas**, com controle antes e depois. Duas pediram teste melhor no caminho: a cena era
  "perfeita demais" (parado, a caixa vinha igual ao pixel, e um limite exigente de "mesmo lugar" passava) — entraram o
  tremor e a mão sobre uma metade só.
- **A suíte inteira do agente**: 1865 passaram, 1 pulado.

### O que não foi medido

O módulo contra o `quadros_por_lanche` v3 nos mesmos quadros de verdade da loja (14/10): a comparação é numa rodada
à parte, no computador da loja (as imagens não saem de lá).

## 15/10/2026 · A21, fatia T3c-4 (antes da T3c-3): o corpo do lanche de treino (dormindo, sem migration)

### Por que antes do identificador

A conferência (T4) já aceita a etapa sem leitura: a pessoa diz o que era, e a resposta vira exemplo da base. Então o
ciclo do treinamento — o gravador, a leitura da bancada, a conferência, o exemplo — anda antes de o identificador da
rodada 12 (1.160 linhas, ainda mudando; o acerto dele só se mede na conferência) virar módulo. Ele entra depois, como
peça trocável: quem tem as etapas lidas as passa ao corpo.

### O que entra

- **`farol_agent/treino_corpo.py`**: cada lanche da leitura da bancada (T3c-2) vira o corpo de
  `POST /v1/agentes/treino/lanches` (`contratos/lanche-de-treino.json`): a gravação, o lanche (quando abriu, quando
  fechou, as etapas) e os quadros das etapas reduzidos (lado maior até 360 px, em JPEG dentro dos 300 kB; o pequeno
  não aumenta). Sem identificação, a primeira etapa é o pão aberto e as outras vão de lado não sabido, sem leitura. A
  hora vai com o fuso, e a etapa que passou da meia-noite é do dia seguinte. Os limites do contrato valem antes de
  valer lá: 60 etapas, 40 quadros (a etapa que passa vai sem quadro), 12 candidatos (só texto), "vezes" de 1 a 6, e o
  lado fora da lista vira "outro".
- **O envio** (`ClienteNuvem.lanche_de_treino`), com destino: 409 (a gravação foi encerrada) para de mandar; 422 e 413
  não se repetem; rede, 5xx, 429 e credencial, de novo depois.
- **A busca (T3b) guarda o adianto do gravador** que mediu, no manifesto (`adiantoS`): é ele que a captura densa
  desconta para dar a hora da loja.

### Como foi provado

- **Testes do agente** (`agent/testes/test_treino_corpo.py`): 16, contra o contrato (as chaves, os lados, as origens
  e os limites são os do arquivo; a rota também); e a T3b ganhou o teste do adianto.
- **Mutação: 20 trocas, 20 mortas**, com controle antes e depois (quatro sobreviveram na primeira rodada: uma era
  redundância no código, que saiu, e três pediram casos nos testes — candidato torto antes dos bons, "vezes" negativo,
  adianto que vem como texto).
- **A suíte inteira do agente**: 1882 passaram, 1 pulado.

## 15/10/2026 · A21, fatia T3d-1: uma volta da gravação de treino, do começo ao fim (dormindo, sem migration)

### O que entra

- **`farol_agent/treino_laco.py`**: a volta que junta a parte da loja da T3 — perguntar (T3a), apagar o que a nuvem
  mandou, a próxima gravação, buscar o trecho no gravador (T3b), a captura densa (T3c-1), os lanches (T3c-2), o corpo
  de cada um e o envio (T3c-4), "pronta". O andamento sobe em faixas: a busca até 50%, a captura densa até 70%, os
  lanches até 85%, o envio até 99%.
- **Cada parada tem destino.** Fora da hora, gravador ocupado, gravação que não assentou, disco cheio, nuvem fora do
  ar, loja aberta no meio da leitura: a volta para, e a seguinte retoma de onde parou — sem baixar de novo o que veio,
  sem ler de novo os lanches que já foram lidos (o detector em cada quadro pesa: uma gravação de 30 minutos são ~1.800
  quadros × 7 pedaços, pela conta uns 24 minutos de processador), sem reenviar lanche (`enviados.json`). Senha
  recusada, gravação sem canal, gravador sem nada do horário: a gravação falha, com o motivo. Cancelada no console
  (409, no andamento ou no lanche): para, e o que se guardou dela sai do disco; nenhum lanche dela sai depois. A nuvem
  não conhece a gravação (404): esquece, e apaga. Token que não vale: para, sem apagar nada. O lanche recusado por estar
  torto (422) não vai de novo.
- **A leitura dos lanches (T3c-2) passou a parar** quando quem chama manda (pergunta a cada 30 quadros; parada, não
  escreve nada e recomeça depois), e a que terminou é reaproveitada (`lanches.json`, escrito por último).
- **Sem o adianto anotado**, a volta mede de novo no gravador, em vez de ficar presa.

As peças que dependem da loja entram de fora (`Pecas`): a nuvem, o gravador do canal, a área de montagem, o detector,
o perfil da bancada, "pode buscar?" e "pode ler?" (a hora é decisão do dono), e os relógios.

### Como foi provado

- **De ponta a ponta, sem mentira no meio** (`agent/testes/test_treino_laco.py`, 17 testes): o gravador de mentira
  grava VÍDEO de verdade (AVI) da cena pedida — a bancada desenhada —, e a captura densa decodifica, recorta a área de
  montagem e dá a hora (a da loja: o gravador estava 25 s adiantado), a leitura acha o lanche, o corpo segue o contrato
  e sai pela nuvem de mentira; o andamento termina em "pronta". E cada parada acima, uma por uma.
- **Mutação: 22 trocas, 22 mortas**, com controle antes e depois.
- **A suíte inteira do agente**: 1900 passaram, 1 pulado.

### Falta (T3d-2)

Ligar no serviço do agente — a linha de execução que dá a volta de tempos em tempos, o cliente do gravador com a senha
do cofre e o perfil medido, o detector, o perfil da bancada da loja (os números do canal 4, medidos na calibração de
14/10), e as duas horas (buscar e ler) — e o agente declarar "treino". É o pacote novo, com o "pode" do dono, e as duas
horas são decisão dele.

## 15/10/2026 · A21, T4: o quadro maior da etapa, na conferência do lanche (sem migration)

O pedido do dono, na gaveta do lanche: "ter a opção de ver a foto por completo para melhor análise; talvez ao clicar
abrir um modal pequeno com a foto, para dar mais certeza ao usuário". Protótipo antes (#166), **aprovado no mesmo dia**.

### O que entra

- **A miniatura da etapa vira botão**, com uma lupa no canto que aparece sem o mouse em cima, porque no celular não
  há mouse. A miniatura continua com 96 px e `object-cover`, ou seja, mostra só o meio do recorte. A etapa sem quadro
  continua sem botão.
- **O quadro maior** (`web/componentes/treino/quadro-da-etapa.tsx`):
  - É outro `<dialog>` modal, aberto por cima da gaveta sem fechá-la; o navegador deixa a gaveta inerte atrás.
  - O recorte aparece inteiro (`object-contain`), na proporção dele, sobre o "palco", o fundo das imagens de câmera do
    console.
  - Mostra a hora e o lado da etapa, o que o Farol leu (com o "×2" e o "pode ser" do grupo) e "você disse", quando a
    etapa já foi respondida.
  - Anterior e Próxima, as setas do teclado e o arrasto de lado passam as etapas; o leitor de tela ouve a etapa nova.
  - Esc, o X ou um clique fora fecham só o quadro. O foco volta para a miniatura da etapa que estava à vista, não a que
    abriu: é ao lado dela que se responde.
- **ERR-128, de quebra.** O Esc num diálogo aberto dentro de uma gaveta fechava os dois: o `cancel` do `<dialog>` sobe
  pela árvore do React. Já estava no ar no "Tirar esta foto?" da gaveta do ingrediente. A base dos diálogos
  (`ui/sobreposto.tsx`) para a subida, e o quadro maior também.

### Onde a tela difere do protótipo aprovado

- **O desenho do protótipo tinha as duas metades** do lanche lado a lado. No console aparece a imagem que subiu da
  loja, como ela é.
- **O protótipo mostrava a certeza** ("pouca certeza", "certeza alta"). A conferência do console não tem esse campo;
  quando a leitura ficou entre nomes, ela mostra "pode ser: A ou B", como na linha da etapa.
- **A etapa sem quadro** não abre nada pela miniatura. Se o quadro maior chega nela pelas setas, mostra "Esta etapa
  não tem quadro".

### Como foi provado

No console local (API e console desta máquina, banco de teste descartável), num Chrome sem janela, com tecla e clique
de verdade. Os lanches de teste ganharam quadros LARGOS e um em pé, desenhados por script (nada da loja), porque com
quadro quadrado a miniatura não corta nada.

- Abrir, as setas, os botões, o arrasto, o Esc, o clique fora, o X, "você disse" e "pode ser": tudo passou.
- O quadro aberto foi medido em 16 larguras (320 a 1920) e em 4 telas baixas (667×375, 844×390, 1366×600, 320×480):
  nada passa da borda, a imagem fica inteira dentro da caixa, e o quadro cabe na tela.
- O roteiro achou três defeitos, corrigidos antes do PR:
  - o `close` atrasado do ensaio duplo do modo estrito fechava o quadro ao abrir;
  - o quadro em pé passava da caixa, porque a altura em porcentagem não vale numa grade;
  - o ERR-128.
- Mutação: 5 mutantes, 5 mortos, com controle antes e depois. Os mutantes:
  - o Esc do quadro subindo até a gaveta;
  - o foco que não volta para a miniatura;
  - o foco que não passa ao outro botão no fim da fila;
  - o clique do fim do arrasto fechando o quadro;
  - o ERR-128.

  Na primeira rodada um mutante sobreviveu. O defeito era do roteiro, não do código: ele lia o foco pelo texto do
  elemento, e quando o foco caía na página, o texto da página inteira tem "Anterior". Corrigido no roteiro.

## 15/10/2026 · A21, fatia T3d-2: a gravação de treino ligada no serviço do agente (sem migration; vale com o pacote novo)

### O que entra

- **`farol_agent/treino_servico.py` (`TreinoEmFundo`)** liga a volta da T3d-1 numa linha de execução própria do
  serviço, como a auditoria:
  - dá uma volta, e outra logo depois (5 s) enquanto uma gravação termina — pronta, falhou ou parou;
  - sem nada a fazer, ou fora da hora, espera 5 minutos;
  - um erro inesperado numa volta fica no registro e não para a linha.
- **As peças saem da configuração em disco, a cada volta** (ela muda com o console):
  - o gravador do ponto do canal, com o perfil de arquivo medido daquele gravador; a senha do cofre só é lida na hora
    do pedido;
  - a área de montagem do canal;
  - o detector da auditoria, o mesmo, carregado uma vez;
  - o perfil da bancada da loja, `perfil_da_bancada.json` ao lado da configuração, com os números da câmera.
- **Sem o detector ou sem o perfil da bancada**, a gravação não fica presa: é buscada e falha na leitura, com o motivo
  que a tela mostra.
- **O agente declara "treino"** ao pedir a configuração (`contratos/o-que-o-agente-sabe.json`). É isso que tira da
  tela Treinamento o aviso "o computador da loja ainda não sabe gravar".
- **`farol-agent servir --sem-treino`** não liga a gravação de treino e também não declara "treino". A configuração
  guardada anota o que ESTE agente declarou. Assim ele não acha que "falta treino" a cada batida, o que o faria puxar
  a configuração de novo, para sempre.

### A hora de buscar e de ler: proposta, a decisão é do dono

**Só com a loja FECHADA**, pelo horário de funcionamento que vem na configuração:
- a placa de rede da loja de teste é de 10 Mbit/s;
- o computador é também o servidor local do Regem;
- buscar 30 minutos no gravador e ler a bancada não podem disputar o expediente.

A leitura dos lanches para quando a loja abre e retoma depois. Loja sem horário cadastrado não busca, e o registro diz
isso uma vez.

### Como foi provado

- **Testes da T3 e do que o agente sabe, entre eles:**
  - as peças lidas da configuração em disco, com a senha do cofre só na hora;
  - o perfil medido do gravador;
  - a hora, com a janela que cruza a meia-noite;
  - a linha que espera pouco ou muito, e que não para com um erro;
  - o serviço com e sem `--sem-treino`;
  - a volta que falha sem detector ou sem perfil;
  - o agente `--sem-treino` que não puxa a configuração a cada batida.
- **API:** os testes que leem o contrato, com banco, 21 de 21.
- **Mutação: 27 trocas, 27 mortas**, com controle antes e depois. Na primeira rodada 3 sobreviveram e ganharam
  teste:
  - o canal cujo ponto não tem o endereço do gravador;
  - o perfil da bancada torto de outros jeitos (JSON quebrado, lista no lugar do objeto, número que é texto);
  - o parar que não espera a volta em curso.
- **Suíte inteira do agente: 1926 passaram, 1 pulado.**
  - Um teste da foto padrão trazia a lista de saberes escrita à mão; agora ele a monta de `nuvem.SABE`.
  - Numa das rodadas, com a máquina carregada, o teste de tempo do RTSP (desistir em menos de 5 s) passou do tempo.
    Sozinho, ele passa 3 de 3, e a rodada seguinte passou inteira.

### Falta, para valer na loja

- **O pacote novo**, com o "pode" do dono.
- **Na troca, o `perfil_da_bancada.json` da loja.** São os números do canal 4, da calibração de 14/10, os mesmos da
  comparação de 15/10.
- **O gravador gravando — feito.** O HD de antes falhou, e a loja ficou sem gravar das 11h30 às 17h05 de 15/10. O
  dono pôs um de 2 TB na mesma tarde, e o gravador voltou a gravar (conferido). A gravação de treino "do gravador"
  depende do que ele guarda; quantos dias cabem nos 2 TB ainda é para medir.
- **As decisões do dono:**
  - a hora de buscar e ler;
  - se o computador da loja dorme de madrugada (A22). Dormindo, ele não busca nem lê.

## 15/10/2026 · A21: o estudo das fichas — o palpite pesa pela raridade, e a família (sem migration, sem tela)

### Por quê

O dono, conferindo os lanches com o quadro maior: "é bom ter um agente de análise lógica de estudo das fichas":
- "o cheddar cremoso é usado somente no Número 16 (e no Trio 16, praticamente a mesma ficha); ao detectar, já temos uns
  95% de chance de ser o 16";
- "anel de cebola, 95% o Número 08 ou o Trio 08, o único com anel";
- "todos os cardápios vão ter os ingredientes raros, que vão em 1 ou poucos itens (2 no máximo), os intermediários e os
  muito usados".

O palpite de antes dava a todo ingrediente o mesmo peso (`batem/total − 0,2 × estranhos`), então o pão valia tanto
quanto o cheddar cremoso.

**Medido nas fichas reais da loja-piloto** (a cópia do agente, só leitura):
- 45 produtos de cozinha, que formam 20 famílias, e 31 ingredientes;
- 21 ingredientes raros, 8 intermediários e 2 comuns;
- 15 das 20 famílias têm um ingrediente raro.

Os exemplos do dono se confirmaram: cheddar cremoso só no 16, ovo só no 08, anel no 08.

### O que entra (`api/src/estudo-das-fichas.ts`)

O estudo é calculado das fichas de qualquer loja; nada é escrito para o piloto.
- **Família:** produtos de cozinha com a mesma ficha vista de cima são um lanche só para a bancada. "Mesma ficha" quer
  dizer os mesmos ingredientes, nas mesmas quantidades de contar; o que "não se vê de cima" não conta. A mesma carne em
  duas linhas soma.
- **Peso:** `log((famílias + 1) / famílias que usam o ingrediente)`. As faixas servem para explicar, não para contar:
  - raro: 1 ou 2 famílias;
  - comum: 40% delas ou mais;
  - intermediário: o resto.
- **Nota de cada família**, somando as evidências da leitura:
  - o ingrediente da ficha que a leitura viu soma o peso; num grupo "pode ser A ou B", o peso se divide;
  - o que a leitura viu e a ficha não tem tira o peso. O adicional do produto continua não tirando nada (a regra do
    protótipo aprovado);
  - o que a ficha tem e não foi visto tira um terço do peso (o cliente pode ter mandado tirar);
  - a quantidade de contar que bate soma um quarto; a que não bate tira um quarto. O que vai por peso não se conta;
  - a leitura sem nome nas fichas tira um pouco de todas, e não muda a ordem.
- **As opções de "Qual lanche era?"** são de famílias diferentes. O irmão (o trio) segue em "Outro produto", e a
  resposta da API traz `familia` e `raros` (o porquê) para a conferência nova.
- **O acerto conta a família:** escolher o "Trio 16" quando o palpite foi o "Número 16" não é erro. Vale para as
  conferências daqui em diante; as de antes ficam como foram contadas.
- **Os números da tela não mudam:** "confere X de Y" e "fora da ficha" seguem a mesma conta.

### Como foi provado

- **Testes com um cardápio INVENTADO** (`api/testes/estudo-das-fichas.test.ts`), com o caso do dono: pão, carne, queijo
  e alface batem inteiros com um lanche, mas o cheddar cremoso só existe em outro. A conta de antes dava o primeiro; o
  estudo dá o certo. Também cobrem:
  - o cliente que tirou um ingrediente;
  - o lanche mais um adicional;
  - a quantidade que desempata;
  - o grupo que divide o peso;
  - o que vai por peso, que não se conta;
  - as famílias, as faixas e o acerto.
- **Na rota** (`treino.test.ts`): a loja com o lanche e o trio dele. O trio não é a segunda opção, e conferir como trio
  é acerto.
- **Mutação: 29 trocas, 29 mortas**, com controle antes e depois. Duas sobreviveram na primeira rodada e ganharam teste:
  a quantidade que separa as famílias, e o que faltou que pesa.
- **Simulação no cardápio real da loja**, com leituras sorteadas: cada ingrediente visto ou não, o nome certo ou trocado
  por outro do cardápio, às vezes um a mais. São 19 lanches, 400 leituras cada, acerto por família:

  | Leitura | Antes | Com o estudo |
  |---|---|---|
  | Vê 90%, nome certo 90%, a mais 10% | 75,2% | 87,2% |
  | Vê 75%, nome certo 75%, a mais 30% | 54,9% | 62,1% |
  | Vê 60%, nome certo 60%, a mais 50% | 34,7% | 38,8% |

  O ganho cai quando a leitura erra muito: o raro lido errado engana mais, porque pesa muito. A simulação troca o nome
  por qualquer ingrediente; a leitura de verdade confunde parecidos, e as conferências vão medir isso.

### Depois

- **As perguntas que separam as fichas**, na conferência nova (protótipo antes).
- **Os pesos medidos.** Com as conferências, sai quanto a leitura erra cada ingrediente. Com os pedidos do KDS e da
  fila do Regem, sai quantas vezes tiram a cebola, quantas pedem o cheddar como adicional e quanto cada lanche vende.
- **Só os produtos montados na bancada.** Hoje a batata, os nuggets e o combo kids também contam; falta ligar o setor da
  bancada ao setor do produto.
- **As variações** (o "Duplo" que usa 2× a ficha).

## 15/10/2026 · Sem teto de acessos por conta: uma rede com mais de 10 lojas liga todas (sem migration)

### Por quê

O Padrão DMS (§2.4) põe no máximo 10 acessos valendo por conta, e a parte 2 da porta seguiu isso. No Farol, o acesso
vale para **uma loja**, e cada loja tem no máximo um: uma rede com 11 lojas ficava com uma de fora. A sessão do Hub
recomendou tirar o teto só no Farol, e o **dono aprovou em 15/10/2026**. O limite que sobra é o natural: um acesso por
loja, garantido pela trava da loja na criação (V105) e pelo índice único `acesso_externo_loja_uk`.

### O que muda

- **A criação** (`POST /v1/acessos`) não conta mais os acessos da conta: saem a recusa `teto_de_acessos` e a trava da
  linha da conta, que só servia a essa contagem. Ficam a trava da loja e a recusa `ja_tem_acesso`.
- **A leitura** (`GET /v1/acessos`) diz `teto: { maximo: null, ativos }`: `null` é "sem teto".
- **A tela** só mostra o estado "o máximo" quando a API manda um número. Para qualquer conta de hoje, nada muda à vista.
- O Padrão ganha a exceção do Farol (repositório do hub, §2.4).

### Como foi provado

- `api/testes/rota-acessos.test.ts`: uma rede com 11 lojas liga as 11, e a leitura diz `{ maximo: null, ativos: 11 }`;
  a 11ª loja pedida duas vezes ao mesmo tempo, com os dois pedidos presos na trava da loja: um passa, o outro recebe
  `ja_tem_acesso`.
- Mutação, com controle antes e depois: a leitura voltar a dizer 10, a criação voltar a recusar a 11ª, a criação sem
  conferir se a loja já tem acesso, e a criação sem travar a loja. O teste pega as quatro.

## 15/10/2026 · A21: a conferência nova do lanche — uma foto por cartão (sem migration)

O protótipo (#171) saiu do que o dono pediu conferindo de verdade. Ele pediu quatro coisas:

- o recorte que pega as duas metades;
- a foto que só mostra o papel do delivery;
- poder marcar mais de um ingrediente por etapa;
- as perguntas que separam as fichas (o 16 e o trio 16).

O protótipo foi **aprovado no mesmo dia** ("prototipos aprovados"), com as três escolhas que ficaram para ele
confirmar ("2 ok"):

- sobrando uma ficha nas perguntas, ela já fica marcada;
- o trio com a ficha do lanche conta como acerto;
- o lanche sem palpite conta como não acertado.

### O que entra

- **A API aceita a resposta por foto** (`versao: 2`, `lerConferencia` em `api/src/treino.ts`). Vem uma resposta por
  foto, na ordem das fotos que a gaveta recebeu, com:
  - tudo o que aparece na foto (nomes das fichas, ou escritos à mão);
  - "não dá para analisar", com o que houve;
  - as respostas às perguntas;
  - a observação do lanche.

  A resposta por etapa continua aceita, e as já guardadas continuam valendo.
- **As fotos** (`fotosDoLanche`): viram uma foto só as etapas que apontam para o mesmo quadro (a carga de 14/10 fazia
  assim com o que "já estava") ou para quadros com a mesma imagem (o sha256 de cada quadro). A resposta guarda as
  etapas de cada foto: depois de 30 dias, sem os quadros, o agrupamento da hora da conferência continua valendo.
- **O que cada etapa ensina** (`ensinoDasEtapas`) é um ponto só para os dois formatos. Os exemplos, o aprendizado e as
  sugestões para as fichas leem por ele. Nos exemplos:
  - cada marca vai com o quadro da etapa;
  - a mesma imagem com o mesmo nome entra uma vez;
  - a foto ruim não ensina;
  - o nome fora das fichas vira sugestão.
- **O palpite traz o que a tela nova precisa:**
  - os ingredientes da ficha, cada um com em quantas famílias entra;
  - o que o cliente pode pedir a mais e o que pode mandar tirar;
  - o porquê: o raro que a leitura viu e o raro que ela pode ter visto, com o que leu e em que outro lanche ele vai;
  - quais fichas são plausíveis para as perguntas.
- **Sem nada visto da ficha, não há palpite.** A lista diz "sem palpite", a conferência guarda `palpite` nulo e o
  lanche conta como não acertado.
- **A gaveta nova** (`web/componentes/treino/gaveta-do-lanche.tsx`; as contas em `conferencia-por-foto.ts`), como o
  protótipo:
  - o palpite com o porquê;
  - as perguntas que separam as fichas, que não mudam de lugar sob o dedo;
  - um cartão por foto, com as marcas;
  - o atalho "Marcar o que o Farol leu";
  - "Não dá para analisar";
  - "Outro ingrediente";
  - a conta da ficha pelas marcas;
  - a observação do lanche.

  O quadro maior passa as fotos (`quadro-da-foto.tsx`).
- **A lista** diz "sem leitura dos ingredientes" no lanche em que nenhuma etapa tem leitura. Antes dizia "uma etapa
  ficou sem leitura".

### Onde a tela difere do protótipo aprovado

- **A certeza da leitura.** O protótipo tinha "certeza alta/média/pouca", mas a leitura da loja não manda certeza.
  - "Foto sem dúvida" é a foto em que cada leitura dá UM nome: o que ela disse, ou, quando ficou entre dois, o que está
    na ficha do lanche.
  - A foto sem leitura, ou com uma leitura que nenhuma ficha tem, é dúvida. O selo da foto diz "com dúvida" ou "sem
    leitura".
  - Consequência: o recorte só do papel lido como "pão" é "sem dúvida", e o atalho marca nele o pão da ficha. Quem
    confere marca "Não dá para analisar"; a marca fica guardada, mas não ensina.
  - Quando o identificador mandar a certeza (T3c-3), ela entra aqui.
- **As fotos parecidas.** O protótipo juntava as quase iguais; aqui só se juntam as IGUAIS (o mesmo quadro, ou os
  mesmos bytes). Quem sabe juntar as parecidas é o computador da loja, que tem a gravação (com a T3c-3). Por isso não
  aparece "N fotos parecidas".
- **A conta dos exemplos.** O protótipo contava um exemplo por foto do cartão. Com fotos iguais, a imagem é uma só e
  entra uma vez.
- **"Outro ingrediente"** mantém o "Um ingrediente que não está nas fichas…" da conferência de antes. O nome escrito
  entra marcado e vira sugestão para as fichas.
- **As plausíveis** usam os números do protótipo: até 2,5 abaixo do melhor, de 2 a 4 fichas. Ainda não foram medidos.

### Como foi provado

- **API, Postgres de verdade (banco de teste descartável):**
  - o agrupamento;
  - a resposta por foto, certa e torta;
  - o que cada etapa ensina, nos dois formatos;
  - os exemplos sem repetir a imagem;
  - o aprendizado e as sugestões pela resposta nova;
  - o lanche sem leitura;
  - o palpite com o que a tela precisa.

  Os testes do treino e do estudo: 52, todos passando. A suíte inteira: 1540 de 1541. A falha é a conhecida do banco
  local sem pgvector (ERR-029).
- **Mutação da API:** 33 mutantes, 33 mortos, com controle antes e depois.
- **Console local, num Chrome sem janela, com tecla e clique de verdade.** Os lanches de teste são desenhos, nada da
  loja:
  - o caso do dono;
  - a foto da dúvida;
  - o sem leitura;
  - as fotos de bytes iguais;
  - o conferido no formato antigo, que reabre com as marcas nas fotos.

  A gaveta foi medida em 4 estados × 16 larguras (320 a 1920) e o quadro maior em 4 telas baixas.
- **Mutação da tela:** 15 mutantes, 15 mortos, com controle antes e depois. Na primeira rodada, um ficou vivo: o atalho
  marcando a foto com dúvida. Nenhum lanche de teste tinha uma foto MISTURADA (uma leitura que dá nome e outra que
  não dá). O lanche das fotos iguais ganhou um "molho verde", e o mutante morreu.
- **Achados e corrigidos antes do PR:**
  - em 320 px, o texto do atalho não quebrava a linha e passava da borda;
  - o palpite saía colado para o leitor de tela ("achaCheddar"), e o selo da foto também ("verdecom dúvida").

### Falta

- **A T3c-3 na loja:** os nomes possíveis em cada leitura, o papel como "não é ingrediente", a certeza e juntar as
  fotos parecidas. (O recorte da METADE entrou antes, no corpo do lanche: ver 16/10.)
- **As conferências já feitas** no formato antigo (um nome por etapa) seguem valendo e não ganham nada "refeitas" pela
  regra nova: a resposta antiga não tem as outras marcas da foto. O ganho vem de quem conferiu REABRIR o lanche e
  marcar tudo o que aparece em cada foto ("Salvar de novo" troca os exemplos dele).

## 16/10/2026 · A21: a etapa sobe no recorte da METADE em que entrou o ingrediente (sem migration; vale com o pacote novo)

### O pedido

O dono, conferindo os lanches de 14/10 (15/10, ~18h): "o ideal é que os cortes centralizem o máximo possível ou no
tampo superior ou no tampo inferior do pão, que é onde vão os ingredientes". Até aqui, o quadro de cada etapa era o
recorte do lanche inteiro: as duas metades e o papel em volta. Na madrugada de 16/10, junto com o "pode" da troca de
pacote, ele perguntou se isso estava resolvido. Não estava: ia junto com a T3c-3. Entrou antes, sozinho.

### O que entra

- **`farol_agent/treino_corpo.py`**, ao montar o corpo do lanche. Cada etapa, menos a primeira (o pão aberto), é
  comparada com a anterior no mesmo trecho, que tem a mesma caixa fixa. A metade que mudou sobe recortada, centrada
  nela, com 35% de folga de cada lado. O lado continua "outro": quem diz se é tampo ou base é a identificação.
- **As metades** vêm do `metades.csv` que a leitura da bancada já escreve:
  - as caixas do detector nos 30 quadros antes da etapa (o pão coberto de ingrediente some do detector);
  - juntas pelo centro, ficam os dois grupos com mais caixas;
  - de cada metade, vale a caixa mais perto no tempo.
- **A mudança** se mede no miolo de cada metade: um disco de 0,42 do lado da caixa, longe do papel-alumínio da borda,
  que cintila. Antes de comparar, a luz do quadro é alinhada à do anterior (a sombra muda o tom e mantém o desenho).
  Um pixel mudou quando o ΔE passa de 22. A metade da etapa é a que tem 10% ou mais do miolo mudado e pelo menos o
  dobro da outra.
- **Na dúvida, sobe o recorte inteiro**, como antes:
  - a primeira etapa;
  - o lanche no lugar novo (outro trecho);
  - nenhuma metade conhecida;
  - nenhuma metade vista até 2 quadros da etapa (o lanche já tinha saído);
  - a metade que só aparece depois da etapa (ainda não tinha chegado);
  - a caixa menor que 0,6 da mediana do trecho (não é metade);
  - nenhuma metade mudou o bastante;
  - as duas mudaram parecido;
  - sem `metades.csv`, ou com ele torto.

### Como foi medido, nos lanches de verdade

Nos 9 lanches das 21h48 de 14/10 (os da carga da conferência), 58 etapas têm a anterior no mesmo trecho. Cada versão
da regra rodou no computador da loja, só lendo as pastas e sem o detector. As decisões foram revistas uma a uma, no
antes e no depois:

| versão | o que mudou | decididas | certas |
|---|---|---|---|
| 1 | a mudança na caixa inteira | 1 (55 "espalhadas": a mão e o lanche do lado mudam junto) | — |
| 2 | o miolo de cada metade, com a luz alinhada | 29 | 10 das 16 revistas |
| 4 | sem a caixa pequena (um "pão" de 20 px entre as metades), a posição mais perto no tempo, só a janela antes | 30 | 24, mais 2 neutras; 4 erradas |
| 6 | o mínimo de 10%, o dobro da outra, alguma metade vista até 2 quadros | 23 | 23 |

As outras 35 sobem no recorte inteiro. Os 4 erros da versão 4:
- três depois de o lanche sair: a mão, ou o vazio, no lugar dele;
- um em que o pão chegando numa metade ganhou do molho que entrou na outra.

A trava pela cor não serviu: a ideia era que papel-alumínio e inox têm pouca saturação, mas no inox escuro a
saturação oscila.

### Como foi provado

- **Testes do agente** (`agent/testes/test_treino_corpo.py`): 27 novos, com o recorte desenhado (o papel riscado,
  as metades e os ingredientes). Cobrem:
  - a metade certa e centrada;
  - um sexto do miolo já vale;
  - na dúvida, o inteiro: as duas mudaram, mudou pouco, só a luz;
  - a luz que muda junto não esconde o ingrediente;
  - o lugar novo;
  - o lanche que saiu;
  - a metade que não tinha chegado;
  - a caixa pequena;
  - uma metade só;
  - as metades de perto da etapa e a metade coberta que some do detector;
  - o detector que não viu na hora, mas viu perto;
  - o tom do pão que escurece um pouco e a carne parecida com o pão;
  - a metade um pouco menor;
  - o cintilar em pontinhos, um pão visto uma vez só e uma folha nova junto com a luz;
  - sem `metades.csv`, ou torto;
  - o recorte na borda.
- **Mutação: 33 trocas, 33 mortas**, com controle antes e depois. Na primeira rodada morreram 30; as 3 vivas
  pediram casos novos nos testes:
  - o cintilar em pontinhos (a abertura que limpa a mudança);
  - um pão visto uma vez só (o grupo de uma caixa não é metade);
  - uma folha nova junto com a luz (o ajuste da luz só pelo papel de desenho igual).
- **A suíte inteira do agente:** 1953 passaram, 1 pulado.

### Falta

- **Valer na loja:** o pacote novo (o "pode" de 16/10).
- **A T3c-3:** diz o lado (tampo ou base) e lê o que entrou; esta regra fica como a escolha da metade para o recorte.
- **Medir de novo** com os lanches da primeira gravação de treino: outras horas e outros colaboradores.

## 16/10/2026 · A22, fatia P2 (a API): o horário do computador da loja (migration 052)

### O que o dono decidiu

- **"protótipo aprovado"** (16/10, ~01h10). Lido como o protótipo do computador da loja, com as três decisões.
- **O horário (16/10, ~02h15):** "o expediente comum é de domingo a quinta das 19:00 até as 03:00 e sexta e sábado das
  19:00 até as 05:45. adormecer servidor 1 hora após esses horários e ligar 1 hora antes".
- **As três decisões, então:**
  - não salvar com o computador dormindo com a loja aberta;
  - a folga da sugestão é de **1 hora**, e não 30 minutos;
  - o teste de 3 minutos na tela, só para quem configura (entra com a P3).

### O que entra

- **Migration 052:** `loja.horario_computador` (jsonb; nulo = nunca programado), com
  `{ligado, dias:[{dia, dorme, acorda}]}`, os sete dias, no relógio da loja.
- **`api/src/computador.ts`, a conta sem banco.**
  - A semana se conta em minutos desde segunda 00:00.
  - O estado de cada instante é o do último acontecimento antes dele, dando a volta na semana. Sem "acorda" no dia,
    ele dorme até o "acorda" seguinte.
  - Os choques com a loja aberta contam o minuto de fechar como aberto, como `faixaContem`. Sem horário da loja, ela
    vale como sempre aberta.
  - A sugestão: 1 hora depois de fechar e 1 hora antes de abrir, com sono mínimo de 1 hora. Dois trechos fechados no
    mesmo dia: fica o mais longo.
  - O silêncio do agente.
- **O silêncio do agente.** Ele só é sono quando estas quatro coisas valem juntas:
  - o horário está ligado;
  - o agente declara `dormir` (o pacote antigo fica ligado o tempo todo, e o silêncio dele é queda);
  - agora cai no sono programado, até 10 minutos depois do "acorda";
  - ele bateu até 10 minutos antes do "dorme".

  Calado desde mais cedo, ele caiu antes da hora. Passou do "acorda" sem voltar: "não acordou".
- **As rotas** (`api/src/rotas/computador.ts`):
  - `GET /v1/lojas/:id/computador` traz o horário, a semana desenhada, a sugestão, os choques, a situação e o agente;
  - `POST …/conferir` traz a semana de um rascunho, sem salvar: a gaveta redesenha pela API, e a conta é uma só;
  - `PUT` salva. Quem salva é quem configura, e a versão da configuração sobe na mesma linha.
  - O `PUT` recusa dois casos:
    - `sem_horario_da_loja`;
    - `dorme_com_a_loja_aberta`, que diz o dia e o trecho: "na segunda, das 19:00 às 24:00; …".
- **A moldura e o vigia.** `GET /v1/lojas` e `GET /v1/lojas/:id` passam a trazer
  `computador: {ligado, dormindo, nao_acordou, acorda_as}`, que é nulo sem horário. O vigia do "agente caiu"
  (`despacho.ts`) não avisa do agente que dorme no horário.
- **A configuração** leva `loja.horarioComputador`. O agente antigo ignora a entrada.
- **O contrato** `contratos/horario-do-computador.json` traz o formato, o horário de funcionamento da loja piloto, a
  sugestão, os instantes dormindo ou acordado, os choques e a palavra `dormir`.
- **A palavra `dormir`:** ela entra em `o-que-o-agente-sabe.json` com a P3, junto com o agente que a declara. O
  contrato dos saberes exige que o agente declare exatamente a lista.

### Até a P3, nada muda na loja

Nenhum agente declara `dormir`: a moldura e o vigia seguem como hoje, e o horário só fica guardado e desce na
configuração.

### Como foi provado

- **Testes** (`api/testes/computador.test.ts`): 32. Cobrem:
  - a conta, com os casos do contrato;
  - a recusa com o dia e o trecho;
  - o silêncio: o pacote antigo, a queda antes da hora, a folga de acordar, o "não acordou" e o sono que atravessa a
    semana;
  - as rotas com duas lojas na mesma conta e uma vizinha;
  - a configuração que desce;
  - o vigia com envio de verdade.
- **Mutação: 33 trocas, 33 mortas**, com controle antes e depois. Na primeira rodada sobraram 3: duas eram
  código redundante, que saiu; a terceira pediu um caso (faixas da loja que se encostam viram uma só).
- **A suíte inteira da API:** 1569 de 1570. A que falta é a conhecida do banco local sem pgvector (ERR-029).

### Falta

- **A tela (P2b):** "Computador da loja", a gaveta do horário, e a moldura dizendo "Dormindo · acorda às 18:00".
- **O teste de verdade numa madrugada (P1):** pede o "pode" do dono.
- **O agente aplicar o horário (P3):** a espera e o despertador, o teste de 3 minutos e "o que aconteceu". Vai no
  pacote novo, com o "pode".
- **Mudar o horário da loja depois:** se ele passar a chocar com um horário já salvo, a tela do computador mostra o
  choque. A P3 também não deve dormir com a loja aberta (a guarda do lado da loja).

## 16/10/2026 · A22, fatia P2 (a tela): o Computador da loja no console (sem migration)

### O que entra

- **`/lojas/<id>/computador` — "Computador da loja",** do protótipo aprovado em 16/10/2026:
  - como ele está agora: acordado (bateu há…), dormindo até HH:MM ou não acordou às HH:MM;
  - o aviso de cada situação, inclusive o do pacote antigo ("ainda não sabe dormir e acordar sozinho");
  - a semana em barras de 24 horas (acordado, dormindo, a loja aberta e o choque), com a marca de agora;
  - "Antes de programar", com a folga de 1 hora.
- **A gaveta "Horário do computador":**
  - "Dormir e acordar sozinho";
  - "Sugerir pelo horário da loja";
  - a hora de dormir e a de acordar de cada dia;
  - a semana redesenhada pela API a cada mudança (`conferir`);
  - o choque de cada dia, com o trecho;
  - "Salvar o horário" travado enquanto houver choque. Sem o horário da loja, a gaveta manda informá-lo em Critérios.
- **A moldura:**
  - o estado do agente no pé da coluna leva à tela do computador e diz "Dormindo · acorda às HH:MM" quando é o sono
    programado;
  - a faixa vermelha do "sem sinal" diz "não acordou às HH:MM" quando é o caso;
  - a lista de lojas tem o selo "dormindo".

### Divergências do protótipo

- **O teste "dormir 3 minutos" e "O que aconteceu"** ficam para a P3: quem dorme é o agente, e é ele quem conta o que
  aconteceu.
- **A folga da sugestão é 1 hora,** e não 30 minutos (decisão do dono).
- **A semana e os choques vêm da API,** e a gaveta pede a cada mudança. No protótipo a conta era da página.
- **A marca de agora** usa o relógio do navegador no fuso da loja (é só a marca; quem diz "dormindo" é a API).
- **Novo:** sem o horário da loja, a gaveta avisa e manda informá-lo em Critérios. A API recusa salvar ligado sem ele.

### Como foi provado

- **O roteiro de tela** (no console local contra o banco de teste, num Chrome sem janela, com cliques de verdade)
  cobriu:
  - as cinco situações: sem horário, acordado, dormindo, não acordou e pacote antigo, com o aviso de cada uma e o pé
    da coluna levando à tela;
  - a faixa vermelha só na queda;
  - a gaveta: o rascunho pela API, o choque do sábado com o trecho e o salvar travado, a sugestão, salvar, salvar sem
    mexer (nada muda) e desligar;
  - a lista com "dormindo";
  - a supervisão sem o botão.
- **As medidas:** 144, em 16 larguras (320 a 1920), com e sem a gaveta, e nenhum problema. Na primeira rodada, o selo
  "dormindo · acorda às…" da lista passava da borda em 320 px. Ele e o do "sem sinal", que agora pode dizer "não
  acordou às…", passaram a quebrar a linha.
- **O build do console** passa.
