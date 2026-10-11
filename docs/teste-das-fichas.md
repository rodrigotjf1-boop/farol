# Identificar o produto pela ficha técnica — o experimento de 09/10/2026

Em 09/10, lendo o estudo do lote, o dono disse como a conferência vai funcionar: com o Regem,
**o pedido vai ao KDS com a ficha técnica, sem os valores**; e **"a ordem não é importante, e
sim todos os ingredientes"**. Citou quatro fichas e, durante o trabalho, a quinta. Este
experimento mede, com as imagens dos lotes de 08/10, o que a nuvem consegue fazer com elas.

Gasto: **R$ 1,32** (R$ 0,70 na primeira rodada, R$ 0,33 na segunda e R$ 0,29 na terceira, a
do molho), dentro do teto de R$ 5,00 do teste da nuvem (acumulado: R$ 4,23). **A rodada 4,
de 09/10 à noite, com a câmera regulada, custou mais R$ 0,21 e está mais abaixo; a rodada 5,
da madrugada de 10/10 (a revisão pelo gravador), mais R$ 0,11 — acumulado: R$ 4,60.** As imagens
ficaram no PC da loja só durante o experimento e não estão neste repositório.

## As fichas

| ficha | pão | carne | queijo | o resto |
|---|---|---|---|---|
| Número 01 | 3 fatias (pão de dois cortes) | 2 de 56 g | 2 fatias | alface; molho especial (meio rosé) |
| Número 02 | 2 fatias (pão de um corte) | 2 de 56 g | 2 fatias | cebola ao molho shoyu |
| Número 16 | 2 fatias (pão de um corte) | 2 de 56 g | não leva fatia | molho cheddar cremoso; cebola ao molho shoyu |
| Número 08 | 2 fatias (pão prime, de um corte) | 1 de 120 g | 1 fatia de cheddar | ovo; 2 fatias de bacon; 3 anéis de cebola; maionese |
| Mussarela Bug | 2 fatias (pão brioche prime) | 1 artesanal de 150 g | — | mussarela empanada; maionese de alho; geleia de pimenta; cebola crispy |

## O gabarito

O lote estudado (08/10, 21h42 a 21h49), cinco posições:

- quatro lanches cuja montagem bate com a ficha do **Número 01** nos cinco ingredientes, com
  as quantidades (três discos de pão, duas carnes, duas fatias de queijo, alface, molho) —
  **menos o da caixa, que levou 4 fatias de queijo: ver a errata na rodada 3. As tabelas
  abaixo já estão com o gabarito corrigido;**
- o quinto é o **Mussarela Bug** — dito pelo dono enquanto eu trabalhava. A leitura às cegas
  de 08/10 tinha anotado os seis ingredientes dele sem saber o nome de nenhum: carne grossa e
  escura, molho branco, molho vermelho de sachê, cobertura granulada, pão de um corte e, por
  último, um empanado dourado.

Os quadros são os **mais parados** de cada instante, na resolução da câmera, pelo caminho do
agente (recorta a área, apaga o que fica fora), **sem o borrão de rosto** — eu olhei cada um
antes de mandar; nenhum mostra a cabeça de ninguém.

## Rodada 1 — o tampo inteiro de uma vez, quatro fichas

A nuvem recebe a cena, o mapa do canal, quatro quadros do tampo (21:44:11, 21:44:51,
21:45:14 e 21:45:54) e as quatro primeiras fichas; devolve, por posição, o que viu, a ficha,
o que falta e o que sobra. O Mussarela Bug ainda não estava entre as fichas: o certo para
ele era "nenhuma".

| o que foi | modelo | fichas certas, de 5 | Número 01 achado, de 4 | custo | tempo |
|---|---|---|---|---|---|
| os quatro quadros | Haiku 5.5 (3 vezes) | 1, 2 e 3 | 0, 1 e 2 | 0,6 centavo | 6 s |
| os quatro quadros | Sonnet 5.5 | 4 | 4 | 20,5 centavos | 18 s |
| só o último quadro | Haiku 5.5 (3 vezes) | 1, 1 e 1 | 0, 0 e 0 | 0,3 centavo | 4 s |
| só o último quadro | Sonnet 5.5 | 5 | 4 | 9,9 centavos | 11 s |

- **O modelo barato se perde com cinco lanches de uma vez:** em duas das três vezes contou
  seis e sete posições onde há cinco, e só numa posição, numa das vezes, contou os três
  discos de pão.
- **O modelo maior leu certo** os quatro Número 01 — três discos, duas carnes, alface — e
  errou o quinto: forçou a ficha mais parecida (o 08), apesar da instrução.
- **A foto final não serve para o modelo barato:** só com o último quadro, "falta a carne"
  nos quatro (ela está embaixo do queijo). O modelo maior acertou as fichas por eliminação —
  só o 01 tem alface —, com confiança de 0,3; num cardápio inteiro isso não se sustenta.

## Rodada 2 — uma posição por vez, cinco fichas

Cada chamada leva só os recortes de **uma** posição, em ordem de tempo (quatro quadros; seis
no Mussarela Bug, até a mussarela entrar), e as cinco fichas. Duas variantes: "seco" (só as
fichas) e "dicionário" (as fichas e como cada ingrediente aparece de cima).

Duas réguas para a ficha: a que o **modelo disse**, e a que sai da **conta** — pegar o que
ele disse que viu e comparar com cada ficha, em código (quantidade onde se conta, presença no
resto). "Firme" é quando a ficha mais próxima ganha da segunda por dois itens ou mais.

| variante · modelo | chamadas | ficha dita pelo modelo | ficha pela conta | firmes (e certas) | itens com a quantidade certa | custo por posição | tempo |
|---|---|---|---|---|---|---|---|
| seco · Haiku 5.5 | 15 | 12 certas | **15 certas** | 12 (12) | 54 de 78 (69%) | 0,13 centavo | 2,0 s |
| dicionário · Haiku 5.5 | 15 | 12 certas | **15 certas** | 13 (13) | 58 de 78 (74%) | 0,13 centavo | 1,8 s |
| dicionário · Sonnet 5.5 | 5 | 5 certas | 5 certas | 4 (4) | 20 de 26 (77%) | 5,85 centavos | 6,4 s |

O que cada variante errou, por item:

| variante · modelo | não viu, ou contou errado |
|---|---|
| seco · Haiku 5.5 | molho rosé 10; carne 5; no Mussarela Bug: a mussarela, a geleia e a cebola crispy nas três vezes (chamou a geleia de "molho rosé") |
| dicionário · Haiku 5.5 | molho rosé 12; pão 2; carne 2; queijo 2 (na caixa, disse 2 fatias em duas das três vezes); mussarela 1; geleia 1 |
| dicionário · Sonnet 5.5 | molho rosé 3; pão 2; carne 1 — e o Mussarela Bug com os seis itens certos |

## O que se lê disso

1. **Uma posição por vez é o que faz o modelo barato funcionar.** Com o tampo inteiro ele
   acertou a ficha em 6 de 15 posições; com uma posição por chamada, em 12 de 15 — e em 15
   de 15 pela conta.
2. **Comparar com a ficha é conta, não opinião do modelo.** Nas 35 chamadas da segunda rodada
   a conta deu a ficha certa; o modelo, dizendo ele mesmo, errou 6 — numa delas tinha visto
   os itens do Número 01, com as quantidades, e disse "02". E a conta sabe dizer "não tenho
   folga": nenhuma resposta firme saiu errada. É o desenho do juiz por item, que já está no
   agente.
3. **O dicionário de ingredientes vale o que custa** (nada: vai em cache). Sem ele o
   Mussarela Bug não foi reconhecido nenhuma vez; com ele, em 2 de 3 no modelo barato e com os
   seis itens no maior. Os itens certos subiram de 69% para 74%.
4. **O molho embaixo da alface não se vê depois** (25 erros em 28). Os quadros que escolhi
   eram os do fim de cada fase; o molho entra e a alface cobre em segundos. Para conferir
   molho, o quadro tem de ser o da posição parada logo depois dele — a quietude por posição
   do plano. O mesmo vale para o pão embaixo da carne. **Foi o que a rodada 3 mediu: com
   esse quadro e a regra da casa, 12 de 12.**
5. **Custa quase nada no caminho barato:** 0,13 centavo por lanche — R$ 0,0013. Mil lanches
   por dia: R$ 1,30. No modelo maior, R$ 58.
6. **O modelo maior fica para a dúvida:** acertou tudo dizendo a ficha, mas custa 45 vezes
   mais e viu os itens tão bem quanto o barato com dicionário.

## O que isto não é

- **Não é o sistema lendo sozinho.** As posições foram recortadas por mim, à mão; os quadros
  foram escolhidos por mim. Achar as posições e os instantes é o trabalho das ondas 4 e 5.
- **É um lote, cinco lanches, dois produtos**, três repetições. "15 de 15" aqui é pouco.
- **Que os quatro são o Número 01** é leitura minha contra a ficha do dono: falta ele dizer
  — e o da caixa levou o dobro de queijo.
- **Sem o pedido**: aqui a nuvem escolhe entre cinco fichas. Com o pedido conhecido (o Regem
  na loja), a pergunta fica mais fácil — "estes ingredientes estão todos?".
- No lote anterior (21h37 a 21h41) há uma posição compatível com o Número 02 e três que não
  estão entre estas fichas; a rodada 1 passou por ele sem gabarito, e os números não entram
  na conta.

## Rodada 3 — o molho, com a regra da casa (09/10)

O dono, ao ler que o molho era o ponto fraco: **"os molhos são sempre colocados primeiro na
tampa superior do pão, e geralmente usando bisnagas ou potes."**

**O que a gravação mostra** (lote das 21h42, relido de segundo em segundo antes de sumir do
gravador):

| posição | o molho entra | fica à vista até | o que cobre |
|---|---|---|---|
| folha 1 | 21:44:19, de bisnaga | ≈ 21:44:26 (7 s, 4 deles sem ninguém na frente) | a alface |
| folha 2 | 21:44:20 | entre 21:44:35 e 21:44:45 (15 a 25 s) | a alface |
| folha 3 | 21:44:22 | entre 21:44:35 e 21:44:45 (13 a 23 s) | a alface |
| caixa | 21:44:24 | entre 21:44:45 e 21:44:51 (21 a 27 s) | a alface |
| folha 4 (Mussarela Bug) | 21:43:58, a geleia, de sachê | ≈ 21:44:05 (7 s) | a cebola crispy |

A regra vale nas cinco tampas: o molho é a primeira coisa que entra nelas, e a bisnaga
passa pelas quatro em 7 segundos. Uma coisa fora dela: a **maionese** (de pote) foi posta
**sobre a carne**, na base, nas três vezes em que apareceu nos dois lotes — o dono diz se
é o padrão. No lote das 21h37 a leitura começou com a tampa já coberta: não dá para dizer
o que entrou primeiro.

**O experimento.** Os mesmos quadros da rodada 2 e mais **um** por posição: o da tampa
logo depois de o molho entrar (no Mussarela Bug, só o recorte da tampa). Duas variantes,
as duas com o dicionário: "quadro" (o dicionário da rodada 2, sem mudar uma letra) e
"regra" (o dicionário com a regra da casa — o texto está no fim deste arquivo). R$ 0,29.

| variante · modelo | leituras | molho rosé visto (4 lanches) | geleia | itens certos | ficha dita pelo modelo | ficha pela conta | queijo a mais da caixa apontado | custo por posição | tempo |
|---|---|---|---|---|---|---|---|---|---|
| rodada 2 · dicionário · Haiku 5.5 | 15 | **0 de 12** | 2 de 3 | 58 de 78 (74%) | 12 | 15 | 1 de 3 | 0,13 centavo | 1,8 s |
| quadro · Haiku 5.5 | 15 | 8 de 12 | 3 de 3 | 70 de 78 (90%) | 14 | 15 | 1 de 3 | 0,14 centavo | 1,8 s |
| **regra · Haiku 5.5** | 15 | **12 de 12** | 3 de 3 | **78 de 78** | 15 | 15 (todas firmes) | 3 de 3 | 0,14 centavo | 1,8 s |
| regra · Sonnet 5.5 | 5 | 4 de 4 | 1 de 1 | 26 de 26 | 5 | 5 | 1 de 1 | 5,04 centavos | 4,9 s |

O que se lê:

1. **O quadro certo é metade do caminho; a regra da casa é a outra metade.** Só com o
   quadro a mais, o modelo barato viu o molho em 8 de 12 — e em nenhuma das três vezes na
   folha 1, onde o molho é claro sobre uma tampa clara. Com a regra escrita ("o molho é
   posto primeiro, na tampa; procure no quadro logo depois de ele entrar"), 12 de 12.
2. **A regra da casa é dado de primeira classe.** Vai no dicionário de ingredientes da
   loja, como as fichas: onde cada coisa entra, quando, e com que utensílio. Não custa
   nada (vai em cache).
3. **O instante certo existe e dura:** de 7 a mais de 20 segundos com o molho à vista. O
   gatilho é o primeiro acontecimento da tampa; o quadro, o da posição parada logo depois.
4. **O utensílio diz qual molho.** A bisnaga, o pote e o sachê aparecem na imagem. Se cada
   molho tiver a sua bisnaga marcada (tampa ou fita de uma cor), "qual molho" deixa de
   depender da cor do creme — é uma padronização barata, para o dono decidir.

Limites: cinco lanches de um lote; as três repetições são a mesma imagem perguntada de
novo, não imagens novas; o quadro do molho foi escolhido por mim (o mais parado e sem
ninguém na frente), não pelo sistema; e o dicionário foi escrito olhando estes mesmos
lanches. É prova de sinal.

### Errata do gabarito — o queijo da caixa

Ao conferir os recortes desta rodada apareceu uma segunda fatia no disco de baixo da caixa.
Relido a 5 quadros por segundo (21:45:14 a 21:45:27): **o lanche da caixa levou 4 fatias
de queijo** — em cada carne, uma fatia, a carne virada com o pegador por cima dela, e outra
fatia por cima. O meu gabarito dizia 2, tirado do quadro parado (que mostra as de cima);
nos quadros enviados aparecem 3.

Na rodada 2, **5 das 7 leituras da caixa tinham dito "3 fatias, uma a mais que a ficha"** —
e eu contei isso como erro delas. O erro era do gabarito. As tabelas deste arquivo estão
com o gabarito corrigido (na caixa, "3 ou 4 fatias" é o certo; "2" é o errado). Os números
antigos da rodada 2, de itens certos, eram 51, 59 e 19.

Se a caixa era um Número 01 com queijo em dobro pedido pelo cliente, a montagem está certa;
se era um Número 01 comum, sobraram duas fatias. Sem o pedido não dá para dizer — é o que a
conta contra o pedido resolve quando o Regem estiver na loja.

### E a loja, sozinha, vê o molho?

O mesmo método do leitor local de teste (a mancha que mudou em cima de um disco), só nos
molhos, com o quadro de depois tirado logo depois de o molho entrar; e 11 pares de controle
em que nada entrou.

| | resultado |
|---|---|
| Viu o molho entrar | 9 de 10 (escapou o da folha 1: molho claro sobre tampa clara) |
| Inventou mancha onde nada entrou | 2 de 11 — as duas com um braço no quadro |
| Tempo | 7 ms por posição |
| A cor da mancha (L\*, a\*, b\*) | molho rosé 70, 11, 56 (três exemplos, a 6 um do outro) · geleia 35, 34, 31 · maionese 70, −8, 28 (três, a 23) |
| Distância entre as médias | rosé × geleia 49; rosé × maionese 33; geleia × maionese 54 |

Dizer **que** o molho entrou, e de que família de cor ele é, a loja faz sozinha. O que
falta é o portão de "as mãos saíram" (as duas manchas falsas) e mais exemplos — o creme
laranja forte, com dois, não ficou consistente.

## Rodada 4 — a câmera regulada (09/10, à noite)

Em 09/10 o dono regulou a câmera do canal 4 e mudou a posição dela ("câmera regulada, mudei
posição e está nas melhores condições; verifique se teve ganho") e, à noite: "após uns 40
min de gravação verifique os novos quadros e se melhora a detecção do molho, do queijo, dos
ingredientes em si".

**O que mudou na imagem** (medido à tarde, com a loja fechada): cerca de **17 a 18 pixels
por centímetro** no centro do tampo, contra 12 em 08/10; a faixa de piso caiu de 35% para 9%
da imagem. O recorte de uma posição de montagem passou de 190 a 320 px de largura para 285 a
500 px.

**De onde saíram os quadros.** A gravação do canal 4 das 19h11 às 19h58, um instante a cada
20 s (143 instantes). Até 19h42 nenhum lanche foi montado nessa frente da ilha. Dois lotes
foram lidos de segundo em segundo, para o gabarito e para escolher os quadros:

| lote | o que é | posições |
|---|---|---|
| 19:51:10 a 19:51:59 | duas caixas brancas | D1 e D2: pão de um corte, molho cremoso laranja-claro na tampa, alface por cima, 1 carne grossa, 2 fatias de queijo |
| 19:54:36 a 19:56:46 | três folhas de papel | E1: pão pequeno, 2 carnes finas, 2 fatias, bacon, ovo, picles na tampa · E2: como as caixas · E3: 1 carne, 2 fatias, molho vermelho-escuro e mostarda na tampa, picles |

**A regra da casa valeu de novo:** nas quatro tampas que levaram molho ele foi a primeira
coisa a entrar, de bisnaga. Nas caixas ficou à vista **6 e 8 segundos** antes de a alface
cobrir (em 08/10: de 7 a 20 s).

**O experimento.** A mesma pergunta das rodadas 2 e 3 — as mesmas instruções e as mesmas
cinco fichas, sem mudar uma letra —, uma posição por chamada, Haiku 5.5, três leituras de
cada. Os quadros são os de cada acontecimento da posição (pão, carne, queijo, o da tampa
logo depois do molho, o fim), na resolução da câmera, recortados por mim. Olhei cada recorte
antes de mandar: nenhum mostra a cabeça de ninguém. Variantes:

- **sem o quadro do molho**, **com ele** e **com ele e a regra da casa** — as três da
  rodada 3;
- **a imagem cheia** e **a imagem reduzida a 0,69** — 0,69 leva os 17,5 px/cm de agora aos
  12 de antes: é o jeito de separar o que é resolução do que é o resto;
- no lote das folhas, **o dicionário de 08/10** e **um dicionário escrito para esta noite**
  (picles, mostarda, molho barbecue, a face tostada do pão, as duas carnes finas) — o de
  08/10 também tinha sido escrito olhando os lanches daquela noite.

108 leituras, **R$ 0,21** (acumulado da chave: R$ 4,49 de R$ 5,00).

### O molho

O lote das caixas é o caso de 08/10: molho claro na tampa, coberto pela alface em segundos.
Seis leituras por linha, com o dicionário da noite:

| | imagem cheia | reduzida a 0,69 | 08/10 (rodada 3) |
|---|---|---|---|
| sem o quadro do molho | **0 de 6** | 0 de 6 | 0 de 12 |
| com o quadro, sem dizer a regra | **6 de 6** (as 6 com o nome certo) | 4 de 6 (1 com o nome certo) | 8 de 12 |
| com o quadro e a regra da casa | 6 de 6 (as 6 com o nome certo) | 6 de 6 (3 com o nome certo) | 12 de 12 |

No lote das folhas os dois molhos (o creme do E2 e o vermelho-escuro do E3) foram vistos
nas 24 leituras com o quadro, cheia ou reduzida, com ou sem a regra. Juntando os dois lotes,
**sem dizer a regra: 12 de 12 na imagem cheia e 10 de 12 na reduzida.** O nome é outra
conversa: o creme do E2, igual ao das caixas, foi chamado de "maionese" nas três leituras da
imagem cheia sem a regra, e de "molho rosé" nas três com ela.

### O queijo, e os outros itens

Itens com a quantidade certa, com o dicionário da noite (o gabarito é a minha leitura de
segundo em segundo):

| lote | variante | imagem cheia | reduzida a 0,69 |
|---|---|---|---|
| caixas (2 posições, 30 itens) | com o quadro | 27 (90%) | 19 (63%) |
| caixas | com o quadro e a regra | 28 (93%) | 28 (93%) |
| folhas (3 posições, 51 itens) | com o quadro | 36 (71%) | 38 (75%) |
| folhas | com o quadro e a regra | 34 (67%) | 36 (71%) |

- **Queijo:** nas caixas, duas fatias desencontradas foram contadas certo em 23 de 24
  leituras. Nas folhas, em 25 de 36: no E2 a imagem cheia viu **três** onde há duas (a parte
  em que uma cobre a outra parece uma terceira), e no E3, com as fatias quase alinhadas, a
  reduzida viu **uma**.
- **As duas carnes finas do E1** foram lidas como discos de pão na imagem cheia (carne certa
  em 1 de 6) e como carne na reduzida (6 de 6). O lanche fechado, visto por fora, foi
  contado como mais um disco de pão.
- **Com o dicionário de 08/10 no lote das folhas:** 62% a 77% dos itens, e de 10 a 14
  ingredientes ditos que não estavam lá em 9 leituras — a face tostada do pão virou "cebola
  crispy" e "mussarela empanada", o picles virou "anel de cebola", a mostarda virou "ovo".
  Com o dicionário da noite, de 2 a 6.

### O que se lê

1. **A regulagem melhorou o que depende da imagem: o molho.** Com o quadro tirado logo
   depois de ele entrar, o modelo barato viu o molho em todas as leituras (12 de 12) **sem
   precisar da regra da casa** — nas caixas, as seis com o nome certo. Reduzida à nitidez
   de antes, a mesma imagem das caixas volta à taxa de 08/10 (4 de 6; lá, 8 de 12).
2. **O que nenhuma câmera resolve: o molho debaixo da alface.** Sem o quadro da hora certa,
   0 de 6, como em 08/10. Ele fica à vista de 6 a 8 segundos: achar esse instante é o
   gatilho por posição do plano, não a lente.
3. **Nos lanches parecidos com os de 08/10 o resultado é o mesmo:** 90% a 93% dos itens nas
   caixas (lá, 90% e 100%, com o dicionário afinado em três rodadas sobre os mesmos
   lanches).
4. **Nos lanches que o dicionário não conhecia, o que falta é conhecimento, não pixel.** A
   imagem cheia não leu melhor que a reduzida (67% a 75% nas duas). O dicionário escrito
   para a noite tirou os ingredientes inventados; o que sobrou de erro é de contagem.
5. **A contagem de fatias e de carnes empilhadas continua o ponto fraco**, e mais pixels
   não ajudam: muda o erro (três em vez de duas, uma em vez de duas). O caminho é o do
   plano — contar pelo acontecimento (cada fatia entrando), não pela pilha pronta.
6. **Um cuidado novo:** com o enquadramento de agora, a cabeça de quem monta entra pela
   parte de baixo da imagem em vários instantes (em 08/10 não entrava). Os recortes desta
   rodada foram escolhidos sem ela. O quadro da bancada tem de terminar acima da beirada do
   tampo.

Limites: dois lotes de uma noite, cinco posições; as três leituras de cada linha são a
mesma imagem perguntada de novo; os quadros e os recortes foram escolhidos por mim, não pelo
sistema; o gabarito é meu, e eu não sei o nome dos produtos (falta a ficha deles — por isso
"o nome certo" do molho cremoso é o que a imagem mostra, um creme laranja-claro); o
dicionário da noite foi escrito olhando estes mesmos lanches; as imagens ficaram no
computador da loja só durante a medida e foram apagadas. Não foi medido o leitor local.

## Rodada 5 — a revisão pelo gravador: a busca pelo meio (09 para 10/10)

O dono, ao ler a rodada 4: "quando houver uma perda de etapa ou gerar confiança baixa de que
foi colocado um ingrediente ou não, é possível puxar frames rapidamente no HD somente da
etapa que faltou análise? Exemplo: imagem aos 15 s mostra o tampo do pão e o próximo frame,
aos 25 s, já mostra alface sobre o molho; então, na dúvida, uma busca dos frames entre os 15
e os 25 s procurando a colocação do molho (…) seria uma forma de rever e considerar a
confirmação do erro na montagem". E, com a medida em andamento: "não é necessário puxar
todos os segundos do intervalo. Puxa o valor do meio (…) como se fosse uma busca, vai ganhar
desempenho"; "a ideia é reduzir, para não ter tantos frames a carregar sem necessidade só
para achar um ponto que passou pelo intervalo"; "ainda podemos ter ganho quando o cabo for
substituído".

É o "olhar para trás" da onda 2, com um jeito de escolher o que buscar. Foi medido na loja,
na mesma madrugada, só com leitura da gravação do canal 4.

**De onde saíram os quadros.** O lote das caixas da rodada 4 e doze minutos do pico (23:46 a
23:58, um instante a cada 10 s, 73 instantes), de onde saíram mais três lotes:

| lote | o que é | o que acontece na tampa |
|---|---|---|
| D1 e D2 — 19:51:18 a 19:51:38 | duas caixas | nua → a bisnaga passa por cima → creme à vista por **5 s** (D1) e **7 s** (D2) → alface |
| A — 23:50:08 a 23:50:24 | uma caixa | nua por 5 s → **alface direto**, sem molho |
| B — 23:51:48 a 23:52:24 | duas folhas de papel, quatro metades de pão | as duas tampas nuas por mais de 20 s → fatia de queijo, sem molho |
| C — 23:57:16 a 23:57:34 | uma caixa | nua → um saco de molho, 5 s sobre a tampa → molho vermelho, que **continua à vista** |

Eu não sei se os lanches de A e de B levam molho na tampa: falta a ficha deles. O que a
gravação mostra é o que entrou.

### Quanto custa voltar no gravador

| jeito | o que se pede | quanto demora (medido) |
|---|---|---|
| tocar a gravação | 10 s | **11,2 a 13,4 s** (5 medidas): abre em 2,0 a 3,5 s e entrega na velocidade do relógio |
| tocar a gravação | um quadro só, uma conexão por instante | 3,0 s cada (73 em 219 s) |
| baixar por horário (arquivo) | 10 s — 2,6 MB, 150 quadros | **3,9 e 6,2 s** para baixar, mais 0,9 s para decodificar |
| baixar por horário | 13 s | 6,0 s, mais 1,1 s |
| baixar por horário | **um bloco de 2 s** — 0,53 MB, 30 quadros | **mediana de 1,9 s** (de 0,6 a 3,6; 45 blocos, contando o pedido do desafio), mais 0,18 s para decodificar |

- **O gravador entrega a gravação em blocos de 2 s** (nesta gravação, a partir de segundo
  par). Para ver um instante pede-se o bloco que o contém. **Corrigido em 10/10:** eu tinha
  escrito aqui que "o pedido é arredondado para baixo nas duas pontas" e que pedir de :27 a
  :29 devolvia o bloco de :26 a :28. Não é assim: medido de novo, o gravador devolve **os
  blocos que começam dentro do pedido** — o pedido de 2 s que começa em segundo ímpar
  devolve o bloco SEGUINTE, e de :20 a :33 são sete blocos (210 quadros), não seis. As
  medidas estão em "O que o gravador entrega, medido de novo", no fim desta rodada.
- **O pedido** é o "baixar por horário" da API oficial do gravador
  (`/cgi-bin/loadfile.cgi?action=startLoad&channel=…&startTime=…&endTime=…&subtype=0`, com
  autenticação digest). O arquivo vem no formato do gravador, e o leitor de vídeo que o
  agente já usa abre como está.
- **A rede entregou de 3 a 9 Mbit/s:** a placa do computador da loja está presa em
  10 Mbit/s até a troca do cabo. Baixar é a maior parte do passo — **depois do cabo é para
  medir de novo.**
- **A gravação recente NÃO vem inteira.** **Corrigido em 10/10:** eu tinha escrito aqui que
  "o que foi gravado até uns 3 s antes já vem inteiro" — uma medida só, que deu certo uma
  vez. Acompanhando três blocos desde a gravação, o bloco só passou a vir inteiro entre
  1 min e 20 s e 2 min e 15 s depois de gravado; antes disso vem pela metade, com o tamanho
  declarado batendo (as medidas estão no fim desta rodada). O relógio do gravador anda de
  24 a 27 s adiantado em relação ao do computador.
- **Cada pedido com a credencial foi feito uma vez só** — a conta do gravador é a mesma do ao
  vivo, e pedido recusado não se repete. Não houve recusa. O agente da loja não registrou
  aviso nem erro durante a medida.

### A busca pelo meio, nos lotes

Cada passo é um bloco: **baixar**, **escolher na loja** o melhor quadro da tampa e **julgar
só esse quadro**. A escolha é local: no recorte da tampa, o quadro do meio do trecho mais
parado do bloco (25 ms por tampa). Tampa nua: o molho, se houve, veio depois — a busca anda
para a frente. Coberta: veio antes — anda para trás. Molho à vista: achou, e a dúvida acaba.
Bloco sem trecho parado é a mão em cima da tampa: não vai a juízo. Dos 73 pares de bloco e
tampa desta rodada, 64 tinham um trecho parado e 9 não (em três desses nove o quadro de menor
movimento saiu limpo; dois foram a juízo assim mesmo, e saíram certos).

| lote | as pontas (o que as olhadas espaçadas veriam) | passos | resultado |
|---|---|---|---|
| D1 | nua às 19:51:20 · coberta às 19:51:36 | **1** — o bloco do meio, 19:51:28 | **molho à vista** |
| D2 | nua às 19:51:22 · coberta às 19:51:36 | **1** — o bloco do meio, 19:51:28 | **molho à vista** |
| A | nua às 23:50:14 · coberta às 23:50:20 | **2 blocos** — 23:50:16 (nua) e 23:50:18 (a mão em cima) — **e a grade** | **alface direto sobre a tampa nua** |

Quando a busca não acha o molho, ela aperta a dúvida até sobrar a janela em que a mão está
sobre a tampa (2 a 6 s). Dessa janela, que àquela altura já foi baixada, sai **uma grade de
6 quadros numerados**, e a pergunta muda: o que foi posto, e com que utensílio.

**Um passo leva cerca de 3,3 s na rede de hoje:** 1,9 s para baixar, 0,2 s para decodificar e
1,2 s para julgar na nuvem. D1 e D2: um passo, R$ 0,001. A: dois blocos, um quadro e uma
grade julgados, cerca de 7 s e R$ 0,003. Para comparar: tocar o intervalo inteiro de D (16 s)
levaria uns 18 a 20 s antes de julgar qualquer coisa (os 24 s medidos levaram 25,6 e 30,4 s);
baixá-lo inteiro, uns 8 a 11 s, pela conta dos 10 e dos 13 s medidos.

Os passos da tabela foram refeitos em cima dos blocos já baixados e julgados um a um: o laço
automático ainda não existe.

### O juízo

Para a busca andar, alguém tem de dizer o estado da tampa em cada quadro. Nesta rodada foi o
Haiku 5.5, com a cena e a regra da casa em poucas linhas, um quadro por chamada, três
leituras de cada. Os quadros são os que a loja escolheu sozinha em cada bloco, no tamanho em
que a câmera entrega (uns 300 × 300 px). Olhei cada um antes de mandar: nenhum mostra a
cabeça de ninguém; nas três grades aparecem mãos.

| estado (o gabarito é meu) | quadros | leituras certas |
|---|---|---|
| caixa sem pão | 5 | 15 de 15 |
| tampa nua | 10 | 27 de 30 |
| molho à vista (creme laranja-claro e molho vermelho) | 10 | **30 de 30** |
| coberta pela alface | 5 | 15 de 15 |
| **total** | **30** | **87 de 90** |

- **As três erradas são o mesmo quadro** — a tampa nua de D2 às 19:51:20, lida como "coberta:
  farelo ou ingrediente granulado". É a face tostada do pão, o engano da rodada 4. As três
  vieram com confiança 0,6; **as 87 certas, com 0,8 ou mais**: nesta amostra um corte em 0,7
  separa. O bloco vizinho (19:51:22) saiu certo.
- **As grades**, três leituras de cada: **o que foi posto saiu certo nas 9** — folhas em A,
  molho em D1 e em C. Em A, as três disseram "folhas, só a mão, molho em nenhum quadro". O
  utensílio saiu certo em 6 de 9: a bisnaga vista de cima foi chamada de "pote" nas três de
  D1, e nelas o modelo disse "molho à vista" em quadros em que só a bisnaga aparece.
- **1,2 s por quadro** (de 0,9 a 1,6) e 1,6 s por grade; **0,10 centavo por quadro** e 0,17
  por grade. 102 leituras, **R$ 0,11** (acumulado da chave: R$ 4,60 de R$ 5,00).

### A primeira tentativa: o intervalo inteiro

Antes da proposta da busca, o intervalo foi lido inteiro, tocando a gravação, e a loja ficou
com um quadro por "repouso" da tampa. Em D1, dos 457 quadros de 30 s sobraram 8 — caixa vazia,
tampa nua, creme, alface, com repetições —, e em D2, 7. Funciona, e escolher leva 4 ms; o
caro é trazer tudo. Um número dali serve à busca: **o creme muda só 9% a 10% do recorte da
tampa.** O limiar de "mudou" tem de ser baixo, e alguma repetição é o preço.

### Relido com a rotina da casa

Depois de ler esta rodada, o dono disse a rotina da casa — pão, molho, alface, carne, queijo,
carne, queijo, com as manias de cada um ([decisoes.md](decisoes.md), 10/10). Ela diz **o que
cobre o quê**, e com isso onde a revisão deve olhar: o último quadro parado **antes de a
cobertura entrar**. Relendo os blocos desta rodada assim, nos três casos de dúvida o bloco
imediatamente anterior ao da alface já trazia a resposta — molho à vista em D1 e em D2,
tampa nua em A (as nove leituras certas). Achar o bloco da cobertura não deve pedir nuvem: a
alface mudou 21% e 27% do recorte da tampa, contra 9% e 10% do creme (duas posições; não foi
medido como regra).

E nem toda tampa pede revisão. No lote das 19:54 (relido em 10/10, um quadro a cada 5 s) as
carnes e o queijo entraram antes do molho, e a alface só veio 75 s depois dele: o molho
ficou à vista esse tempo todo. O caso apertado é o de quem põe a alface em seguida — 5 a 8 s
nas caixas das 19:51, 7 a 20 s em 08/10.

### O que se lê

1. **Dá para rever só o que ficou em dúvida, e a busca pelo meio é o jeito barato.** Um passo
   quando o molho foi posto e coberto — o caso que hoje viraria alarme falso —, dois blocos e
   uma grade quando não foi.
2. **O meio cai no molho porque ele fica de 5 a 8 s à vista** (rodadas 4 e 5) num intervalo
   de 10 a 20 s entre a tampa nua e a coberta, e porque dentro do bloco de 2 s a loja escolhe
   o quadro sem mão.
3. **O que sobe é pouco:** um quadro de 300 px por passo. Com o quadro certo, o molho foi
   lido em 30 de 30.
4. **Dizer que NÃO houve molho pede a janela da mão:** é ela que mostra a alface entrando
   direto. E continua triagem, com revisão de gente — nenhum aviso sai antes do banco de
   provas.
5. **O que falta é o que já estava no plano:** a loja saber sozinha onde está a tampa (a
   leitura da bancada, ondas 4 e 5) e a ficha de cada lanche — sem ela, "sem molho" não é
   erro nem acerto.
6. **O cabo ainda dá ganho:** baixar é 1,9 s dos 3,3 s do passo, numa rede presa em
   10 Mbit/s. Julgar (1,2 s) e decodificar (0,2 s) não dependem dele.

Limites: quatro posições em caixa, de uma noite (e duas em papel, que não foram a juízo); o
alvo — onde está a tampa — foi apontado por mim; o gabarito é meu; as três leituras de cada
quadro são a mesma imagem perguntada de novo; a busca foi refeita sobre blocos já baixados,
não rodou como laço; não houve nesta amostra molho coberto em menos de 2 s, nem molho claro
sobre pão claro; o juiz local do molho (o da rodada 3) não foi posto em cima do quadro que a
busca escolhe; depois da troca do cabo nada foi medido. As imagens ficaram no computador da
loja só durante a medida e foram apagadas (a pasta foi conferida vazia).

### O que o gravador entrega, medido de novo (10/10, à noite)

Ao escrever a rotina que mede o gravador sozinha (onda 2, fatia 2.2a), a primeira medida de
verdade não bateu com o que esta rodada dizia: "o pedido de 1 s devolveu 0,8 s". Medi de
novo, pedido a pedido, contando os quadros de cada resposta (canal 4, `loadfile.cgi`, só
leitura). São dois comportamentos, conforme a idade da gravação.

**Gravação que já assentou (dez minutos de idade): vêm os blocos que COMEÇAM dentro do
pedido.** Os segundos são de um mesmo minuto; cada bloco tem 30 quadros e uns 527 KB.

| pedido | o que voltou |
|---|---|
| de :48 a :49 | o bloco de :48 inteiro — 30 quadros |
| de :48 a :50 | 30 quadros |
| de :48 a :51 · de :48 a :52 | 60 quadros |
| de :49 a :50 · de :51 a :52 | nada |
| de :49 a :51 · de :49 a :52 | só o bloco de :50 — 30 quadros |
| de :50 a :51 · de :50 a :52 | 30 quadros |
| de :48 a :53 | 90 quadros |
| de :49 a :53 | 60 quadros |
| de :48 a :60 | 180 quadros |
| 2 s antes a 2 s depois da virada do minuto · 4 s antes a 4 s depois | 60 · 120 quadros: a virada não muda nada |
| de :08 a :21 (o formato do "de :20 a :33" de cima) | **210 quadros**, 3,69 MB em 8,7 s |
| de :08 a :20 | 180 quadros, 3,16 MB em 6,3 s |
| de :15 a :17 (o formato do "de :27 a :29" de cima) | 525.385 bytes — **o mesmo arquivo** do pedido de :16 a :17; o bloco de :14 tem 526.565 |

Então, para ter um intervalo, o pedido começa no começo do bloco em que o intervalo começa
— senão esse bloco não vem — e basta terminar 1 s depois do começo do último bloco.

**Gravação recente: vem cortada, e o gravador não avisa.**

- Pedidos de 12 e 13 s em gravação de uns 45 s de idade devolveram 141, 145, 163, 161, 168 e
  185 quadros, onde eram 180 e 195.
- Um bloco pedido de novo de 5 em 5 s, com pedidos de 1 s, desde que acabou de ser gravado:
  veio **pela metade** (≈ 267 KB, e o leitor de vídeo tira dele 0, 14 ou 15 quadros) até
  passar a vir inteiro (≈ 528 KB, 30 quadros). Três blocos acompanhados:

  | bloco | ainda pela metade aos | inteiro aos |
  |---|---|---|
  | 18:57:00 | 77 s | 81 s |
  | 19:10:30 | 78 s | 84 s |
  | 19:06:44 | 130 s | 135 s |

- **O tamanho declarado bate nos dois casos.** Quem baixa não tem como perceber que veio
  menos; quem lê percebe, contando os quadros.

**A rotina do agente, no gravador da loja** (a mesma que entra no agente, rodada à mão):

| passo | resultado |
|---|---|
| medir o gravador | 6 pedidos, 4,7 s: blocos de 2 s a partir de segundo par, 15 quadros por segundo, relógio 24,8 s adiantado |
| três blocos assentados (5 min de idade), pedidos pelo meio deles | 1,58 MB em 2,25 s; 90 quadros de 90 esperados — **inteiro**; o quadro parado escolhido em 0,9 s |
| um bloco de 21 s de idade | 268 KB, tamanho declarado batendo; 17 quadros de 30 esperados — **dito como não inteiro** |

**O que isto muda.** Os números de custo desta rodada (um bloco em 1,9 s, um passo em 3,3 s)
foram tirados de gravação assentada e continuam valendo. O que cai é a ideia de olhar, pelo
caminho de arquivo, os segundos que acabaram de passar: neste gravador, antes de uns 2 a
3 minutos a resposta não é de confiança. A busca pelo meio continua possível — começa mais
tarde. Como a onda 2 lida com isso está em [decisoes.md](decisoes.md) (10/10) e no
[roadmap](roadmap.md).

Limites: um gravador, um canal, uma noite; três blocos acompanhados (não sei o pior caso, nem
de que depende — o palpite é o fechamento do pedaço do disco em que o bloco está, e não foi
medido); o disco é o de hoje (218,8 GB, cheio, sobrescrevendo) e vai ser trocado na semana
de 12/10 — **depois da troca é para medir de novo**; não foi medido se "tocar a gravação"
(RTSP) entrega os segundos recentes.

### O laço da busca, no gravador de verdade (11/10)

Em 10/10 os passos da busca foram refeitos à mão, em cima de blocos já baixados. Em 11/10 o
**laço** rodou sozinho no gravador da loja — as rotinas da fatia 2.2b, levadas para a pasta
de medição, com a loja fechada (cena parada) e um juiz de mentira ("sempre antes", "sempre
depois"): o que se mede é a mecânica, não o juízo.

| passo | resultado |
|---|---|
| medir o gravador | 7 pedidos, 21,4 s: blocos de 2 s **a partir de segundo ímpar**, 15 quadros por segundo, relógio 22,6 s adiantado |
| a busca, andando para a frente (janela de 16 s, 5 min de idade) | 3 blocos em 4,5 s — 1,25, 1,07 e 1,13 s, uns 513 KB cada; todos inteiros, todos com quadro parado |
| a busca, andando para trás | 4 blocos em 6,2 s |
| a busca com o alvo no centro, e num canto | 3 blocos em 4,2 s, e em 3,9 s |
| a grade de 6 quadros da janela que sobrou (1,7 s) | dois blocos num pedido (1.030 KB em 2,4 s); 3,3 s do pedido à imagem; 2.888 × 1.084 pontos, 488 KB em JPEG |
| uma busca cedo demais (a janela acabou havia 30 s) | "ainda não: faltam 150,8 s" — nenhum pedido saiu |

Vinte e um pedidos de trecho ao todo, um de cada vez, nenhuma recusa; a pasta de medição
ficou vazia e o agente da loja seguiu de pé.

**O começo dos blocos mudou.** Em 10/10 a mesma rotina mediu blocos a partir de segundo
**par**; em 11/10, de segundo **ímpar**. O tamanho do bloco e a taxa são os mesmos. Não sei
o que mudou entre as duas medidas (o computador da loja foi reiniciado em 10/10; do
gravador não sei). O perfil guardado, portanto, envelhece: o que isso pede do agente está em
[decisoes.md](decisoes.md) (11/10).

Limites: uma medida de cada, um canal, loja fechada. O bloco chegou mais depressa do que na
rodada 5 (mediana de 1,9 s lá); não sei por quê — a rede da loja mudou de caminho em 10/10
(o Wi-Fi 2 caiu) e não foi medida.

## E sem nuvem? A prova do leitor local

O dono, ao ler o resultado: "ainda não é possível a análise de comparação na loja, sem
nuvem? O PC ainda está com uso baixo. Por que não deixar a nuvem só quando a confiança de
uma análise local não chegar à porcentagem aceitável?"

**É o desenho.** A escada de juízes do plano começa na loja, e a base de exemplos do agente
(`base_conhecimento.py`) já tem as três faixas: bate com o conhecido (decide na loja), "não
sei" (sobe ao modelo), destoa. Nos experimentos acima a nuvem foi a régua — para saber se a
informação está na imagem e de que jeito perguntar. Do que eles usaram, só uma peça é da
nuvem: "que ingrediente é esta mancha". A posição, o que mudou, a contagem e a comparação
com a ficha são conta, na loja.

**A prova**, na mesma madrugada: um leitor local de teste, sem modelo nenhum (só OpenCV, no
processador), com os mesmos quadros.

1. **A mancha nova:** o que mudou entre o quadro parado de antes e o de depois, **em cima
   de um disco** (o que antes já era alimento). Na primeira versão, sem essa condição, o
   papel alumínio que se mexe e a sombra do braço davam manchas maiores que o ingrediente.
2. **A assinatura da mancha:** cor (média e variação), textura, tamanho e forma.
3. **Ensinado com as manchas de umas posições, testado nas de outra:** 29 acontecimentos
   dos dois lotes, 12 ingredientes, de 1 a 7 exemplos de cada.
4. **Firme** só quando o exemplo mais parecido ganha com folga do primeiro de outro
   ingrediente **e** a mancha está tão perto dele quanto exemplos iguais costumam estar
   entre si. Fora disso, **"não sei"** — o que subiria à nuvem.

| | resultado |
|---|---|
| Tempo | 7 ms por posição (mediana), no processador |
| A quantidade que entrou | certa em 23 de 29 acontecimentos |
| Manchas achadas | 40 — 34 de ingrediente com exemplo em outra posição, 6 de ingrediente nunca visto |
| Com exemplo: **firme** | 11 de 34 — **10 certas**. A errada era uma mancha falsa (o disco de cima se mexeu), não um ingrediente |
| Com exemplo: "não sei" | 23 de 34 — o que subiria à nuvem |
| Ingrediente nunca visto | "não sei" em 5 de 6, que é o certo; 1 dita com firmeza (outra mancha falsa) |
| Firmes e certas, por ingrediente | queijo 4 de 7; alface 2 de 6; maionese 2 de 3; carne de 56 g 2 de 7; nenhuma nos molhos e na carne grossa |
| O produto, só com o que foi dito com firmeza | o Número 01 em 2 das 4 posições |

O que se lê:

1. **A regra se comporta como o dono quer:** quando o leitor local é firme, acerta; quando
   não sabe, diz. O que ele ainda não faz é ser firme o bastante — decide 1 em cada 3.
2. **Hoje, então, ainda não dá para comparar só na loja.** Não por falta de máquina (7 ms
   por posição; o PC da loja trabalha a 3%): o leitor local não existe no produto, e este,
   de teste, conhece de 1 a 7 exemplos de cada ingrediente.
3. **O que faz a proporção inverter é conhecido:**
   - *exemplos* — a loja gera centenas por noite; a nuvem rotula os primeiros (mil exemplos
     custam R$ 1,30) e o responsável confere por amostragem;
   - *uma assinatura melhor que "cor média"* — um modelo de assinatura de imagem rodando no
     PC. O agente já tem o encaixe (`EmbedderSigLIP`); falta instalar o modelo e medir;
   - *a mancha limpa* — esperar a posição parar e a pessoa sair (a sombra de quem se
     debruça criou manchas falsas; a mão tem cor de alimento), confirmar que a mancha
     continua lá no quadro seguinte, e separar discos encostados (contaram errado).
4. **O papel da nuvem depois disso:** ensinar (os primeiros exemplos e todo ingrediente
   novo), responder a faixa do "não sei", e conferir uma amostra do que a loja decidiu
   sozinha — é o que pega o leitor local errando com firmeza.
5. **O motivo de ir para a loja não é o custo** (a nuvem sairia por R$ 1,30 a cada mil
   lanches): é não depender da internet, responder em milissegundos — o aviso tem de
   chegar antes de o lanche fechar — e a imagem não sair da loja.

Limites: os limiares que recortam a mancha foram postos a olho nestas mesmas imagens (os
da resposta — a folga e a distância — foram fixados antes de ver o resultado); os pares
"antes e depois" foram escolhidos por mim; são dois lotes de uma noite. É prova de sinal,
como a primeira prova da bancada — não é medida de acerto. O roteiro está no fim deste
arquivo.

## A correção do PR #69, conferida contra a nuvem

No mesmo roteiro, com o código novo lido direto do pacote (sem instalar nada):

| o que | os pedidos que saíram | o que voltou |
|---|---|---|
| a cascata do juiz, com o limiar forçado para reconsultar | Haiku 4.5 com a ferramenta forçada (teto 300); depois Sonnet 5.5 com a escolha livre (teto 2.000) | veredito do Sonnet: "dentro", 0,70, com a frase; 5,9 centavos as duas |
| o pedido de "Analisar as fotos e descrever" | Sonnet 5.5 com a escolha livre (teto 3.000) | respondeu pela ferramenta, 818 unidades de saída: descrição de 343 letras e 5 pontos a conferir; 6,8 centavos |

A forma nova funciona. **O pacote foi trocado na loja em 09/10, às 01h50**, com o "pode" do
dono: o agente subiu com o código novo, sem aviso nem erro.

## O pedido da segunda rodada

Instruções (fixas, em cache):

```
Você confere a MONTAGEM de UM lanche numa bancada de um estabelecimento alimentício, a partir de
recortes de câmera. Não é vigilância de pessoas: você descreve ALIMENTOS, nunca quem aparece.

Responda SEMPRE pela ferramenta `conferir`.

1. Os QUADROS são da MESMA posição de montagem (uma folha de papel alumínio ou uma caixa), em ordem
   de tempo, vistos de CIMA. O lanche é montado ABERTO: os discos de pão ficam lado a lado e os
   ingredientes entram por cima deles. Um ingrediente que aparece num quadro pode estar COBERTO no
   quadro seguinte: junte o que você viu em TODOS os quadros.
2. Conte o que dá para contar: discos de pão, carnes, fatias de queijo. O que não dá para contar,
   diga só que viu (quantidade 1).
3. Compare com as FICHAS recebidas. A ordem dos ingredientes não importa: importa se estão todos.
   Diga qual ficha é, o que FALTA para ela e o que SOBRA (viu e a ficha não tem). Se não bate com
   nenhuma, responda `nenhuma` — não force a ficha mais parecida.
4. Na dúvida, confiança baixa. Chutar é erro. Não suponha ingrediente que você não viu em quadro nenhum.
5. Não descreva nem identifique pessoas. Mãos, braços e utensílios podem aparecer: ignore-os.
```

O dicionário (fixo por loja, em cache) — escrito a partir do que os lotes mostraram; o
responsável confirma:

```
- pão: disco claro ou dourado; cada fatia é um disco.
- carne de 56 g: disco fino, marrom claro, quase do tamanho do pão.
- carne de 120 g e carne artesanal de 150 g: disco grosso e escuro.
- fatia de queijo: quadrado amarelo-alaranjado, liso.
- alface: folhas verdes.
- molho especial (meio rosé): creme laranja-claro; fica embaixo da alface.
- molho cheddar cremoso: creme laranja forte, cobrindo o pão.
- maionese e maionese de alho: creme branco, em cima da carne.
- cebola ao molho shoyu: pedaços escuros e brilhantes no centro do pão.
- cebola crispy: farelo marrom-dourado, seco, cobrindo o pão.
- geleia de pimenta: mancha vermelha brilhante.
- mussarela empanada: disco dourado, empanado, do tamanho da carne.
- bacon: tiras vermelho-escuras. ovo: branco com gema amarela. anel de cebola: anel dourado, empanado.
```

A resposta: os itens vistos, cada um com a quantidade; a ficha; o que falta; o que sobra; a
confiança. Na conta em código, a distância entre o que foi visto e uma ficha é a soma das
diferenças de quantidade (pão, carne, queijo, bacon, anel) mais um por ingrediente presente
de um lado e ausente do outro, mais um se a carne vista é fina e a da ficha é grossa (ou o
contrário).

### A regra da casa, como entrou no dicionário (rodada 3)

Só mudaram as linhas dos molhos:

```
- REGRA DA CASA PARA OS MOLHOS: o molho é posto PRIMEIRO, na TAMPA do pão (o disco de cima, o que
  fica sem carne), com bisnaga ou de um pote, antes de qualquer outro ingrediente da tampa. Procure o
  molho na tampa, no quadro logo depois de ele entrar: nos quadros seguintes ele costuma estar COBERTO
  (pela alface, pela cebola crispy) e não aparece mais.
- molho especial (meio rosé): creme laranja-claro, num montinho no centro da tampa; depois fica embaixo da alface.
- molho cheddar cremoso: creme laranja forte, cobrindo a tampa.
- maionese e maionese de alho: creme branco (nesta bancada já foi visto também em cima da carne).
- geleia de pimenta: mancha vermelha brilhante no centro da tampa.
```

## O roteiro do leitor local

Guardado para a prova poder ser refeita. Não é código do produto: as faixas das posições e
os pares de quadros são os daquela noite, e as imagens não estão neste repositório.

```python
"""A19 — prova do LEITOR LOCAL de ingredientes: sem nuvem, sem modelo, so OpenCV, no processador.

A pergunta do dono (09/10): "ainda nao e possivel a analise de comparacao na loja, sem nuvem? ... por que nao
deixar [a nuvem] so quando a confianca de uma analise local nao chegar a porcentagem aceitavel?"

O que este roteiro faz, com os quadros nativos dos dois lotes de 08/10 (ficam so no rascunho da sessao):

  1. para cada ACONTECIMENTO conhecido (um ingrediente entrou numa posicao entre dois quadros parados), tira a
     MANCHA NOVA: o que mudou EM CIMA DE UM DISCO entre o "antes" e o "depois";
  2. de cada mancha, a ASSINATURA: cor (media e variacao, em Lab), textura, tamanho e forma;
  3. ensina com as manchas de umas posicoes e testa nas de OUTRA posicao (deixa-uma-posicao-de-fora). O exemplo
     mais parecido diz o ingrediente. A resposta so e FIRME se (a) o mais parecido ganha com folga do primeiro
     exemplo de outro ingrediente e (b) a mancha esta tao perto dele quanto os exemplos de um mesmo ingrediente
     costumam estar entre si. Fora disso e "NAO SEI" — o que subiria a nuvem;
  4. para as posicoes do Numero 01, compara o conjunto lido com as fichas, em codigo.

Os rotulos vem da leitura quadro a quadro e das fichas do dono. Os limiares da MANCHA foram postos a olho nestas
imagens; os da RESPOSTA (folga 1,35; distancia = 1,5 x a mediana entre exemplos iguais) foram fixados antes de
ver o resultado. E prova de que o sinal existe na loja, nao medida de acerto.

    python leitor_local.py <pasta loja (com a19g, a19h, a19i)> <pasta de saida>
"""
import json
import sys
import time
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np

L, SAIDA = Path(sys.argv[1]), Path(sys.argv[2])
SAIDA.mkdir(parents=True, exist_ok=True)

FAIXA = {"P1": (0, 190), "P2": (188, 380), "P3": (380, 700), "P4": (700, 985), "P5": (985, 1235), "P4b": (860, 1100),
         "A1": (0, 175), "A2": (175, 370), "A3": (370, 700), "A4": (700, 960)}

# (rotulo, posicao, antes, depois, unidades esperadas, faixa de y opcional)
EVENTOS = [
    # lote das 21h42 — quatro Numero 01 (P1, P2, P3, P5) e o Mussarela Bug (P4)
    ("pao", "P5", "a19g/214304", "a19g/214316", 3, None),
    ("carne_56g", "P3", "a19g/214316", "a19g/214411", 2, None),
    ("carne_56g", "P5", "a19g/214344", "a19g/214355", 2, None),
    ("molho_rose", "P2", "a19g/214414", "a19g/214425", 1, None),
    ("molho_rose", "P3", "a19g/214414", "a19g/214425", 1, None),
    ("molho_rose", "P5", "a19g/214414", "a19g/214425", 1, None),
    ("alface", "P1", "a19g/214414", "a19g/214435", 1, None),
    ("alface", "P2", "a19g/214435", "a19g/214445", 1, None),
    ("alface", "P3", "a19g/214435", "a19g/214445", 1, None),
    ("alface", "P5", "a19g/214445", "a19g/214451", 1, None),
    ("queijo", "P1", "a19g/214451", "a19g/214514", 2, None),
    ("queijo", "P2", "a19g/214455", "a19g/214514", 2, None),
    ("queijo", "P3", "a19g/214455", "a19g/214514", 2, None),
    ("queijo", "P5", "a19g/214455", "a19g/214514", 1, None),
    ("geleia", "P4", "a19g/214344", "a19g/214404", 1, (0, 300)),
    ("cebola_crispy", "P4", "a19g/214404", "a19g/214411", 1, (0, 300)),
    ("carne_grossa", "P4", "a19g/214529", "a19g/214535", 1, (150, 300)),
    ("maionese", "P4", "a19g/214535", "a19g/214554", 1, (150, 330)),
    ("mussarela", "P4b", "a19h/214909", "a19i/214916", 1, None),
    # lote das 21h37
    ("creme_laranja", "A1", "a19g/213734", "a19g/213745", 1, None),
    ("creme_laranja", "A2", "a19g/213745", "a19g/213755", 1, None),
    ("carne_grossa", "A1", "a19g/213745", "a19g/213804", 1, (190, 397)),
    ("carne_grossa", "A2", "a19g/213755", "a19g/213804", 1, None),
    ("maionese", "A1", "a19g/213834", "a19g/213855", 1, None),
    ("maionese", "A2", "a19g/213834", "a19g/213855", 1, None),
    ("carne_56g", "A3", "a19g/213945", "a19g/214004", 1, None),  # duas carnes sobrepostas: de cima, uma mancha
    ("carne_56g", "A4", "a19g/213945", "a19g/214004", 1, None),
    ("queijo", "A4", "a19g/214014", "a19g/214025", 1, None),
    ("bacon", "A4", "a19g/214025", "a19g/214035", 1, (0, 200)),
]
SE_CONTA = {"pao", "carne_56g", "carne_grossa", "queijo", "mussarela"}

LIMIAR_DE_MUDANCA = 26.0   # distancia em Lab para dizer que o pixel mudou
AREA_MINIMA = 900          # px: menor que isso e resto de brilho
AREA_DE_UM_DISCO = 10500   # px: um pao de ~10 cm a ~12 px por cm
FOLGA_FIRME = 1.35         # o mais parecido tem de ganhar do primeiro de outro ingrediente por esta razao
PERTO = 1.5                # ... e estar a no maximo isto x a distancia tipica entre exemplos do mesmo ingrediente


def ler(ref: str, pos: str, y) -> np.ndarray:
    pasta, hora = ref.split("/")
    img = cv2.imdecode(np.fromfile(L / pasta / f"nativo_{hora}.jpg", np.uint8), cv2.IMREAD_COLOR)
    assert img is not None, ref
    x1, x2 = FAIXA[pos]
    peca = img[:, x1:x2]
    return peca if y is None else peca[y[0] : y[1]]


def comida(bgr: np.ndarray) -> np.ndarray:
    """Cor de alimento: tons quentes (pao, carne, queijo, molhos) e verdes (alface), com saturacao.
    O papel aluminio e o isopor ficam de fora (pouca cor, ou cor fria); a sombra do braco tambem (escura)."""
    h, s, v = cv2.split(cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV))
    quente = ((h <= 32) | (h >= 170)) & (s > 60) & (v > 40)
    verde = (h > 32) & (h < 95) & (s > 60) & (v > 40)
    return quente | verde


def claro(bgr: np.ndarray) -> np.ndarray:
    """Creme branco (maionese): muito claro e sem cor."""
    _h, s, v = cv2.split(cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV))
    return (v > 200) & (s < 70)


def manchas(antes: np.ndarray, depois: np.ndarray) -> tuple[list[dict], np.ndarray]:
    """As manchas novas: o que mudou EM CIMA DE UM DISCO (antes ja era alimento) e continua alimento ou creme
    claro; ou um disco novo (caiu sobre o aluminio ou o isopor) — este tem de ter tamanho e forma de disco."""
    la = cv2.cvtColor(cv2.GaussianBlur(antes, (5, 5), 0), cv2.COLOR_BGR2LAB).astype(np.float32)
    ld = cv2.cvtColor(cv2.GaussianBlur(depois, (5, 5), 0), cv2.COLOR_BGR2LAB).astype(np.float32)
    mudou = np.linalg.norm(ld - la, axis=2) > LIMIAR_DE_MUDANCA
    ca, cd = comida(antes), comida(depois)
    m = (mudou & (cd | (claro(depois) & ca))).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    n, rot, stats, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    lab = cv2.cvtColor(depois, cv2.COLOR_BGR2LAB).astype(np.float32)
    lap = np.abs(cv2.Laplacian(cv2.cvtColor(depois, cv2.COLOR_BGR2GRAY), cv2.CV_32F, ksize=3))
    saida, fica = [], np.zeros_like(m)
    for k in range(1, n):
        area = int(stats[k, cv2.CC_STAT_AREA])
        if area < AREA_MINIMA:
            continue
        dentro = rot == k
        contornos, _ = cv2.findContours(dentro.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        c = max(contornos, key=cv2.contourArea)
        solidez = cv2.contourArea(c) / max(1.0, cv2.contourArea(cv2.convexHull(c)))
        sobre_disco = float(ca[dentro].mean())
        if sobre_disco < 0.35 and (area < 4000 or solidez < 0.75):
            continue  # caiu fora de um disco e nao tem tamanho nem forma de disco: brilho, sombra, papel que mexeu
        fica[dentro] = 1
        px = lab[dentro]
        (_, _), (w, h), _ = cv2.minAreaRect(c)
        per = cv2.arcLength(c, True)
        saida.append(dict(
            area=area, caixa=[int(v) for v in stats[k, :4]], unidades=max(1, int(round(area / AREA_DE_UM_DISCO))),
            v=[float(px[:, 0].mean()), float(px[:, 1].mean()), float(px[:, 2].mean()),
               float(px[:, 0].std()), float(px[:, 1].std()), float(px[:, 2].std()),
               float(lap[dentro].mean()), float(np.log(area)),
               float(area / max(1.0, w * h)), float(4 * np.pi * cv2.contourArea(c) / max(1.0, per * per))],
        ))
    saida.sort(key=lambda s: -s["area"])
    return saida, fica


t0 = time.perf_counter()
amostras, tempos, folha = [], [], []
for rot, pos, a, d, n, y in EVENTOS:
    antes, depois = ler(a, pos, y), ler(d, pos, y)
    ti = time.perf_counter()
    ms, mascara = manchas(antes, depois)
    tempos.append((time.perf_counter() - ti) * 1000)
    for k, s in enumerate(ms):
        amostras.append(dict(rotulo=rot, pos=pos, evento=f"{rot}@{pos}", ordem=k, esperadas=n, **s))
    pinta = depois.copy()
    pinta[mascara > 0] = (0.45 * pinta[mascara > 0] + 0.55 * np.array([255, 0, 255])).astype(np.uint8)
    for s in ms:
        x, yy, w, h = s["caixa"]
        cv2.rectangle(pinta, (x, yy), (x + w, yy + h), (0, 255, 255), 2)
    linha = np.hstack([antes, depois, pinta])
    texto = f"{rot} @ {pos}: {len(ms)} mancha(s), {sum(s['unidades'] for s in ms)} unidade(s); esperadas {n}"
    cv2.putText(linha, texto, (4, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 3)
    cv2.putText(linha, texto, (4, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)
    folha.append(linha)
print(f"{len(EVENTOS)} acontecimentos · {len(amostras)} manchas · {np.median(tempos):.1f} ms por posicao (mediana; maior {max(tempos):.1f} ms)")
larg = max(l.shape[1] for l in folha)
for b in range(0, len(folha), 6):
    bloco = [cv2.copyMakeBorder(l, 0, 4, 0, larg - l.shape[1], cv2.BORDER_CONSTANT, value=(40, 40, 40)) for l in folha[b : b + 6]]
    ok, buf = cv2.imencode(".jpg", np.vstack(bloco), [cv2.IMWRITE_JPEG_QUALITY, 86])
    buf.tofile(SAIDA / f"manchas_{b // 6:02d}.jpg")

# quantas unidades entraram: pela area quando o ingrediente se conta, pelo "tem ou nao tem" quando nao
conta_certa, erros_de_conta = 0, []
for rot, pos, a, d, n, y in EVENTOS:
    ms = [s for s in amostras if s["evento"] == f"{rot}@{pos}"]
    lido = sum(s["unidades"] for s in ms) if rot in SE_CONTA else (1 if ms else 0)
    conta_certa += lido == n
    if lido != n:
        erros_de_conta.append(f"{rot}@{pos}: leu {lido}, eram {n} ({len(ms)} mancha(s))")
print(f"quantidade certa em {conta_certa} de {len(EVENTOS)} acontecimentos · erros: {erros_de_conta}")


def normalizar(treino: list[dict]):
    X = np.array([t["v"] for t in treino], np.float32)
    mu, sd = X.mean(0), X.std(0) + 1e-6
    return (X - mu) / sd, mu, sd


def distancia_tipica(Z: np.ndarray, rotulos: list[str]) -> float:
    """Entre exemplos do MESMO ingrediente: a mediana da distancia ao igual mais proximo."""
    ds = []
    for i, r in enumerate(rotulos):
        iguais = [j for j, q in enumerate(rotulos) if q == r and j != i]
        if iguais:
            ds.append(float(np.linalg.norm(Z[iguais] - Z[i], axis=1).min()))
    return float(np.median(ds)) if ds else 9e9


# deixa-uma-posicao-de-fora
res = []
for pos in sorted({s["pos"] for s in amostras}):
    treino = [s for s in amostras if s["pos"] != pos]
    rotulos = [t["rotulo"] for t in treino]
    Z, mu, sd = normalizar(treino)
    tipica = distancia_tipica(Z, rotulos)
    for s in [s for s in amostras if s["pos"] == pos]:
        z = (np.array(s["v"], np.float32) - mu) / sd
        d = np.linalg.norm(Z - z, axis=1)
        ordem = np.argsort(d)
        dito, d1 = rotulos[int(ordem[0])], float(d[ordem[0]])
        outro = next((float(d[i]) for i in ordem if rotulos[int(i)] != dito), 9e9)
        folga = outro / max(1e-6, d1)
        firme = folga >= FOLGA_FIRME and d1 <= PERTO * tipica
        res.append(dict(pos=pos, evento=s["evento"], certo=s["rotulo"], dito=dito, unidades=s["unidades"], folga=round(folga, 2), perto=round(d1 / tipica, 2), firme=bool(firme), tinha_exemplo=s["rotulo"] in set(rotulos)))

com = [r for r in res if r["tinha_exemplo"]]
sem = [r for r in res if not r["tinha_exemplo"]]
fi = [r for r in com if r["firme"]]
print(f"\nmanchas: {len(res)} · com exemplo do ingrediente em OUTRA posicao: {len(com)} · de ingrediente nunca visto: {len(sem)}")
print(f"COM exemplo: o mais parecido acerta {sum(1 for r in com if r['dito'] == r['certo'])} de {len(com)} · FIRMES {len(fi)}: {sum(1 for r in fi if r['dito'] == r['certo'])} certas, {sum(1 for r in fi if r['dito'] != r['certo'])} erradas · NAO SEI {len(com) - len(fi)} (iriam a nuvem)")
fs = [r for r in sem if r["firme"]]
print(f"NUNCA VISTO: {len(sem)} · ditas com firmeza (seria erro): {len(fs)} · NAO SEI: {len(sem) - len(fs)}")
por = defaultdict(lambda: [0, 0, 0, 0])
for r in com:
    p = por[r["certo"]]
    p[0] += 1
    p[1] += r["dito"] == r["certo"]
    p[2] += r["firme"] and r["dito"] == r["certo"]
    p[3] += r["firme"] and r["dito"] != r["certo"]
print("por ingrediente (manchas, mais parecido certo, firmes certas, firmes erradas):", {k: tuple(v) for k, v in sorted(por.items())})
print("firmes:", [(r["evento"], r["dito"], r["folga"], r["perto"]) for r in com if r["firme"]])
print("nao sei:", [(r["evento"], "->", r["dito"], r["folga"], r["perto"]) for r in com if not r["firme"]])
print("nunca visto:", [(r["evento"], "->", r["dito"], r["folga"], r["perto"], "FIRME" if r["firme"] else "nao sei") for r in sem])

# o conjunto lido x as fichas, em codigo — so com o que o leitor local disse com firmeza
FICHAS = {
    "01": {"pao": 3, "carne": 2, "queijo": 2, "alface": 1, "molho_rose": 1},
    "02": {"pao": 2, "carne": 2, "queijo": 2, "cebola_shoyu": 1},
    "16": {"pao": 2, "carne": 2, "molho_cheddar": 1, "cebola_shoyu": 1},
    "08": {"pao": 2, "carne": 1, "queijo": 1, "ovo": 1, "bacon": 2, "anel": 3, "maionese": 1},
    "mussarela_bug": {"pao": 2, "carne": 1, "mussarela": 1, "maionese": 1, "geleia": 1, "cebola_crispy": 1},
}
PARA_A_FICHA = {"carne_56g": "carne", "carne_grossa": "carne", "creme_laranja": "molho_cheddar"}
print("\nas posicoes do Numero 01, so com o que foi dito com firmeza (sem contar o pao, que nao teve acontecimento limpo):")
for pos in ("P1", "P2", "P3", "P5"):
    visto = defaultdict(int)
    for r in res:
        if r["pos"] == pos and r["firme"]:
            k = PARA_A_FICHA.get(r["dito"], r["dito"])
            if k == "pao":
                continue
            visto[k] = visto[k] + r["unidades"] if r["dito"] in SE_CONTA else 1
    ds = []
    for nome, f in FICHAS.items():
        sem_pao = {k: v for k, v in f.items() if k != "pao"}
        dist = sum(abs(visto.get(k, 0) - sem_pao.get(k, 0)) if k in ("carne", "queijo", "bacon", "anel") else int((visto.get(k, 0) > 0) != (sem_pao.get(k, 0) > 0)) for k in set(visto) | set(sem_pao))
        ds.append((dist, nome))
    ds.sort()
    print(f"   {pos}: firme em {dict(visto)} · ficha mais proxima: {ds[0][1]} (faltam {ds[0][0]} itens; a segunda, {ds[1][1]}, a {ds[1][0]})")

(SAIDA / "leitor_local.json").write_text(json.dumps(dict(resultados=res, ms_mediana=float(np.median(tempos))), ensure_ascii=False, indent=1), encoding="utf-8")
print(f"\ntempo total: {time.perf_counter() - t0:.1f} s")
```
