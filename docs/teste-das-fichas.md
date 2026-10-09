# Identificar o produto pela ficha técnica — o experimento de 09/10/2026

Em 09/10, lendo o estudo do lote, o dono disse como a conferência vai funcionar: com o Regem,
**o pedido vai ao KDS com a ficha técnica, sem os valores**; e **"a ordem não é importante, e
sim todos os ingredientes"**. Citou quatro fichas e, durante o trabalho, a quinta. Este
experimento mede, com as imagens dos lotes de 08/10, o que a nuvem consegue fazer com elas.

Gasto: **R$ 1,32** (R$ 0,70 na primeira rodada, R$ 0,33 na segunda e R$ 0,29 na terceira, a
do molho), dentro do teto de R$ 5,00 do teste da nuvem (acumulado: R$ 4,23). **A rodada 4,
de 09/10 à noite, com a câmera regulada, custou mais R$ 0,21 e está mais abaixo.** As imagens
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
