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
