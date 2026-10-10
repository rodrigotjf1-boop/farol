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
