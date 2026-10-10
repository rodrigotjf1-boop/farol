# Estudo de um lote de montagem, passo a passo — 08/10/2026

Sugestão do dono: com a loja em operação e a montagem acontecendo, estudar o padrão — os
ingredientes, o passo a passo dos movimentos até a conclusão — para depois comparar os
pedidos reais do KDS com o que está sendo produzido.

**O que foi lido:** um lote inteiro, da gravação do canal 4 (bancada de montagem, câmera de
cima), das 21h42min45 às 21h47min35 do relógio do gravador — 4 min 50 s, 4.357 quadros.
De 2 em 2 segundos, o recorte do tampo: 146 recortes, olhados um a um. Nenhuma chamada à
nuvem. As folhas com os recortes foram apagadas do PC da loja depois de copiadas e não estão
neste repositório.

**O que isto é:** a leitura de UM lote, feita por mim a olho. Os nomes dos ingredientes são
pela aparência (não conheço o cardápio); o que está marcado com "pelo que se vê" é
inferência. Serve para desenhar o algoritmo — não é medida de acerto.

## O que foi montado

**Cinco lanches**, em quatro folhas de papel alumínio e uma caixa de isopor:

| posição | o que era | como ficou aberto |
|---|---|---|
| folhas 1, 2 e 3, e a caixa | **quatro lanches de duas carnes** | **três discos** cada: a tampa do pão e dois discos, cada um com uma carne clara e queijo — **uma fatia por carne nas três folhas; na caixa, duas por carne** (uma embaixo e uma em cima: ver "Relido em 09/10"). Na tampa: molho laranja e alface |
| folha 4 | **um lanche diferente** | **dois discos**: a tampa com molho vermelho (de sachê) e uma cobertura escura; a base com uma carne escura e molho branco |

No total: 14 discos de pão, 8 carnes claras, **10 fatias de queijo** (6 nas três folhas e 4
na caixa), 4 tampas com molho laranja e alface — e o quinto lanche, que não levou queijo
nem alface.

Correção ao que eu tinha anotado na primeira olhada (40 quadros espaçados): não eram nove
lanches. Eram oito carnes em quatro lanches, e um quinto de outro tipo.

Segunda correção, de 09/10: eu tinha contado **8** fatias de queijo, pelo quadro parado.
São 10 — na caixa cada carne levou duas, e a de baixo só aparece quando entra.

**Em 09/10 o dono deu os nomes:** os quatro batem com a ficha do **Número 01**; o quinto é
o **Mussarela Bug**. Ver "Conferido com as fichas do dono", mais abaixo.

## O passo a passo

| hora | duração | fase | o que se vê |
|---|---|---|---|
| 21:42:45 | — | **forrar** | quatro folhas de papel alumínio lado a lado e uma caixa aberta à direita; a mão alisa as folhas |
| 21:42:51 → 21:43:17 | 26 s | **pães** | chegam empilhados; cada um é aberto e os discos ficam lado a lado, com o lado cortado para cima |
| 21:43:19 → 21:43:51 | 32 s | **carnes** | uma cuba com as carnes prontas vem para cima da bancada; com o pegador, uma carne em cada disco de baixo (8) |
| 21:43:53 → 21:44:07 | 14 s | **o lanche diferente** | molho vermelho de um sachê na tampa, e uma cobertura escura por cima |
| 21:44:09 → 21:44:17 | 8 s | *(mãos fora)* | **bancada parada: as oito carnes à vista, sem nada por cima** |
| 21:44:19 → 21:44:27 | 8 s | **molho** | bisnaga de molho laranja, nas quatro tampas |
| 21:44:25 → 21:44:51 | 26 s | **alface** | por cima do molho, nas quatro tampas |
| 21:44:53 → 21:45:27 | 34 s | **queijo** | um maço de fatias na mão; nas três folhas, uma fatia por carne (6, das 21:44:57 às 21:45:09); na caixa, quatro — a fatia, a carne virada com o pegador por cima dela, e outra fatia por cima, nas duas carnes (21:45:04 a 21:45:25) |
| 21:45:29 → 21:45:31 | 2 s | *(mãos fora)* | **bancada parada: queijo e alface à vista** |
| 21:45:33 → 21:45:55 | 22 s | **o lanche diferente** | a carne escura na base; molho branco de um potinho, com colher |
| 21:45:57 → 21:46:07 | 10 s | **fechar a caixa** | um disco vai para cima do outro; **a tampa da caixa fecha e o lanche fecha junto** (a tampa do pão estava na tampa da caixa); um código é escrito à caneta; a caixa sai |
| 21:46:09 → 21:46:49 | 40 s | **fechar e embrulhar, três vezes** | empilha os dois discos, vira a tampa por cima, embrulha no papel impresso — 10 a 14 s cada |
| 21:46:57 → 21:47:19 | 22 s | **embalar** | três caixinhas de papelão; um embrulho em cada; fecha; escreve à caneta |
| 21:47:21 | — | **fim** | bancada limpa — menos o quinto lanche, **ainda aberto** quando a leitura acabou (21:47:35) |

Do primeiro pão à última caixa: **4 min 30 s para quatro lanches embalados** — 68 s por
lanche, montando em lote.

Tempo de cada lanche aberto na bancada, do pão ao fechamento: a caixa, 2 min 52 s; as
folhas, de 3 min 20 s a 3 min 50 s; o quinto, mais de 4 min 40 s e não fechou até o fim
desta leitura. (Fechou às 21:49:18, com 6 min 21 s aberto: ver "Como o Mussarela Bug
fechou".)

## O que isso muda no algoritmo da leitura da bancada

**1 · A montagem é por ingrediente, não por lanche.** Ninguém monta um lanche inteiro e
passa ao seguinte: todos os pães, depois todas as carnes, depois todo o molho, toda a
alface, todo o queijo. Cada fase dura de 8 a 34 s e tem um objeto que a denuncia — a cuba
das carnes e o pegador, a bisnaga, o maço de queijo, o sachê, o potinho e a colher, o papel
impresso, as caixinhas, a caneta.

Isso explica um número da prova ao vivo: só 19 dos 73 itens postos vinham depois de uma ida
às cubas. **A mão não vai à cuba para cada camada:** a carne vem numa cuba para cima da
bancada, o queijo num maço na mão, o molho numa bisnaga — e uma ida serve várias posições.
A "prova 1" do plano ("de onde a mão veio") passa a ser, nesta loja, **"em que fase
estamos"**: a ida à cuba é um dos sinais, o objeto na mão é o outro — e o objeto da fase é
mais fácil de reconhecer do que o ingrediente no lanche.

**2 · Uma leitura por fase, quando as mãos saem.** No fim de cada fase a camada que acabou
de entrar está por cima, em todas as posições, sem mão na frente. Três a cinco quadros
contam o lote inteiro:

| o quadro | o que ele mostra |
|---|---|
| depois dos pães | quantos discos em cada posição (três = duas carnes; dois = uma) |
| depois das carnes (21:44:09) | quantas carnes, e a cor de cada uma |
| depois do molho e da alface (21:44:51) | que tampas levaram molho e alface, e a cor do molho |
| depois do queijo (21:45:29) | quantas fatias **estão por cima** — a que ficou embaixo da carne só se conta quando entra |
| antes de fechar | o que falta em cada disco |

A foto final, sozinha, não serve: mostra o queijo e a alface, e esconde a carne e o molho
que estão embaixo. É a confirmação, com imagem, de que **se acompanha a montagem; não se
julga o lanche pronto**.

**3 · A unidade da leitura é o disco; a posição agrupa os discos.** A folha (ou a caixa)
continua sendo a posição, como no plano. Mas dentro dela o lanche fica aberto em dois ou
três discos, e é em cada disco que as camadas se empilham: a tampa (molho, alface) e um
disco por carne (carne, queijo). O número de discos já diz o tamanho do lanche.

**4 · O produto tem assinatura.** Neste lote, dois produtos se distinguem sem dúvida, de
cima, por quatro coisas: quantos discos, a cor da carne, a cor do molho, e se tem queijo e
alface. É a "sequência de camadas contra as fichas" do plano — com a ressalva de que a ficha
do Regem precisa dizer **as camadas que se veem de cima e em que disco ficam**. (O dono, em
09/10: a ordem não importa, importam todos os ingredientes. A ficha entra como conjunto, e
"3 fatias de pão" já diz os três discos.)

**5 · O fechamento é um acontecimento visível**, e de dois jeitos: a tampa da caixa que
fecha o lanche junto; ou empilhar, virar a tampa e embrulhar. Cada um é **um lanche
contado**, com o tipo da embalagem. O tempo aberto de cada posição sai de graça. (O dono, em
10/10: a caixa é pedido para viagem; embalado só no papel kraft é consumo no local — está
em [decisoes.md](decisoes.md).)

**6 · A conferência com o KDS é por lote, antes de ser por lanche.** As embalagens são
marcadas **à caneta**, e neste lote nenhuma comanda de papel apareceu no recorte: não há
nada legível por máquina ligando cada lanche ao seu pedido. O que dá para conferir já é a
**conta do lote** — "o KDS tinha em preparo quatro de duas carnes e um do outro; a bancada
fez quatro de duas carnes e um do outro" — e, dentro dele, a conta de cada disco ("toda
carne levou queijo"). Ligar cada lanche a um pedido depende do código impresso (plano,
passo 8) ou de ler a caneta.

**7 · O lanche que ficou esperando** mostra um critério que ninguém pediu e a câmera dá:
quanto tempo um lanche fica aberto na bancada esperando um componente.

**8 · A cabeça de quem monta entra no recorte** em vários momentos, vista de cima. O borrão
de rosto não a pega (não há rosto) e, no teste da nuvem, apagou pão em 12 de 40 quadros. No
quadro de bancada o caminho é outro: mandar o quadro em que as mãos saíram — que é também o
melhor para ler — e apagar a pessoa pelo contorno quando ela estiver no quadro.

## Conferido com as fichas do dono (09/10)

O que a leitura tinha anotado, sem conhecer o cardápio, contra a ficha que o dono citou:

| | o que a leitura anotou | a ficha |
|---|---|---|
| **Número 01** (os quatro) | três discos de pão | 3 fatias de pão |
| | duas carnes claras, uma em cada disco | 2 carnes de 56 g |
| | duas fatias de queijo, uma por carne — **certo em três; na caixa eram quatro** | 2 fatias de queijo |
| | alface na tampa | alface |
| | molho laranja, de bisnaga, embaixo da alface | molho especial (meio rosé) |
| **Mussarela Bug** (o quinto) | dois discos de pão | pão brioche prime |
| | uma carne grossa e escura | carne artesanal de 150 g |
| | molho branco de um potinho, com colher | maionese de alho |
| | molho vermelho de sachê, na tampa | geleia de pimenta |
| | cobertura granulada por cima do molho vermelho | cebola crispy |
| | um empanado dourado, posto por último | mussarela empanada |

Cinco de cinco no Número 01 em três dos quatro; no da caixa a leitura errou o queijo (anotou
2, eram 4). Seis de seis no Mussarela Bug. Foi lido por mim, a olho, de 2 em 2 segundos —
não pelo sistema. O que o sistema consegue com as mesmas imagens está em
[teste-das-fichas.md](teste-das-fichas.md).

## Como o Mussarela Bug fechou

A leitura do lote parava às 21:47:35 com ele aberto. Lido depois, até fechar:

| hora | o que se vê |
|---|---|
| 21:42:57 | o pão aberto em dois discos |
| 21:43:55 → 21:44:04 | a geleia de pimenta na tampa, de um sachê |
| 21:44:05 → 21:44:09 | a cebola crispy por cima da geleia |
| 21:45:35 | a carne na base |
| 21:45:39 → 21:45:55 | a maionese de alho sobre a carne |
| 21:45:55 → 21:49:14 | **parado: 3 min 19 s esperando**, com a carne e a maionese prontas |
| 21:49:16 | **a mussarela empanada chega, com o pegador**, e vai por cima da carne |
| 21:49:18 → 21:49:22 | a tampa é virada por cima: fechado |
| 21:49:24 → 21:49:36 | embrulhado no papel impresso |

**6 min 21 s aberto**, dos quais 3 min 19 s esperando a fritura. É o "lanche que ficou
esperando" virando número — e o tipo de coisa que só a câmera conta: o KDS sabe quando o
pedido entrou e quando saiu, não que a carne ficou três minutos esfriando na bancada.

Na primeira olhada (um quadro a cada 19,5 s) a mussarela não aparecia: ela fica à vista
por dois segundos.

## Relido em 09/10: o molho e o queijo

Duas releituras da mesma gravação, feitas antes de ela sumir do gravador (que guarda 15 h).

**O molho.** O dono disse a regra da casa: "os molhos são sempre colocados primeiro na
tampa superior do pão, e geralmente usando bisnagas ou potes." De segundo em segundo, a
regra aparece nas cinco tampas deste lote: o molho laranja nas quatro (21:44:19, 21:44:20,
21:44:22 e 21:44:24 — a bisnaga passa por todas em 7 s) e a geleia na do Mussarela Bug
(21:43:58). O molho fica à vista de 7 a mais de 20 s, até a alface (ou a cebola crispy)
cobrir. A maionese, de pote, foi sobre a carne. A tabela, e o que isso mudou na leitura,
estão em [teste-das-fichas.md](teste-das-fichas.md), "Rodada 3".

**O queijo da caixa.** A 5 quadros por segundo, das 21:45:14 às 21:45:27:

| hora | o que se vê na caixa |
|---|---|
| 21:45:04 | uma fatia sobre a carne do disco de baixo |
| 21:45:15 → 21:45:16 | o pegador vira essa carne por cima da fatia: o queijo fica embaixo, com uma ponta aparecendo |
| 21:45:18 → 21:45:19 | outra fatia por cima dela |
| 21:45:20 → 21:45:21 | uma fatia sobre a carne do outro disco |
| 21:45:21 → 21:45:22 | o pegador vira essa carne por cima da fatia |
| 21:45:24 → 21:45:25 | outra fatia por cima |

**Quatro fatias: uma embaixo e uma em cima de cada carne.** Nas três folhas, uma fatia por
carne, postas à mão entre 21:44:57 e 21:45:09, sem pegador. O quadro parado do fim mostra,
na caixa, as duas de cima e a ponta de uma de baixo.

O que isto ensina: "o que fica coberto só se confere quando entra" vale também para quem
monta o gabarito — eu contei o queijo pelo quadro parado e errei. E a contagem tem de sair
dos acontecimentos também no pão de três discos, não só no empilhado.

## O lote anterior (21h37 a 21h41), lido depois

Da gravação, de 2 em 2 segundos, a partir das 21:36:55 — o lote já estava em andamento.
Quatro posições, todas com pão de um corte (dois discos):

| posição | o que entrou, pela ordem em que se vê | o que parece ser |
|---|---|---|
| 1 e 2 | na tampa, cebola crispy e, por cima, um creme laranja forte (21:37:41 a 21:37:51); na base, carne escura (21:37:59 a 21:38:03) e molho branco (21:38:39 a 21:38:51). Fechadas e embrulhadas das 21:38:59 às 21:39:20 | **nenhuma das cinco fichas** |
| 3 | na tampa, pedaços escuros e brilhantes de cebola; na base, duas carnes postas juntas, sobrepostas (21:39:59), uma fatia de queijo (21:40:07), a segunda carne passada para cima do queijo (21:40:13 a 21:40:15) e outra fatia (21:40:17). Fechada às 21:40:33 e embrulhada | **compatível com o Número 02**: 2 carnes, 2 fatias, cebola ao molho shoyu |
| 4 | o mesmo da 3 (carne às 21:39:57 e às 21:40:13; queijo às 21:40:17 e às 21:40:21) e, por último, **tiras de bacon por cima da cebola** (21:40:29 a 21:40:35) | o Número 02 com bacon? — o dono diz |

As contagens deste lote são "pelo que se vê": na posição 3 não dá para garantir, de cima,
que foram duas carnes e não três. E a técnica vista na caixa do lote seguinte (a carne
virada por cima da fatia) pode ser o que aconteceu aqui: a "segunda carne passada para cima
do queijo" pode ter sido a mesma carne, virada. Não foi relido quadro a quadro. Nas
posições 1 e 2 a leitura começou com a cobertura já na tampa: não dá para dizer o que
entrou primeiro.

**O que este lote ensina e o outro não mostrava — o empilhamento.** No pão de um corte as
duas carnes e as duas fatias vão **empilhadas na mesma base**: carne, queijo, carne,
queijo, em 20 segundos, com as mãos em cima o tempo todo. O quadro parado do fim mostra
**uma** fatia de queijo e mais nada. No Número 01 cada carne tem o seu disco e o quadro
parado basta; aqui a contagem só sai dos **acontecimentos** — cada vez que algo é posto
naquela posição —, ou de uma sequência de quadros bem mais densa.

## O que ainda não se sabe

- Se **todo** lote é montado assim, por ingrediente. Foram dois lotes, da mesma noite e da
  mesma pessoa. Um lanche avulso, fora do pico, pode ser montado de uma vez. É uma semana em
  "observando" que responde. **O dono, em 10/10:** cada colaborador tem as suas manias e a
  ordem pode mudar, mas na maioria das vezes a rotina é pão, molho, alface, carne, queijo,
  carne, queijo. Na noite de 09/10 os dois jeitos apareceram com três minutos de diferença:
  às 19h51, molho e alface antes das carnes; às 19h54, carnes e queijo antes do molho (como
  neste lote das 21h42). Dentro de cada pão a ordem foi a mesma. Está em
  [decisoes.md](decisoes.md), 10/10.
- O que são as posições 1 e 2 do lote anterior, e se a 4 é o Número 02 com bacon.
- **O que o KDS tinha em preparo: não dá para saber por aqui.** Eu tinha escrito que faltava
  ler o banco do Regem — estava errado. A loja ainda roda o Eclética; o Regem está sendo
  finalizado para entrar lá. Com ele, o pedido vai ao KDS com a ficha técnica (sem os
  valores), e o Farol passa a ter o pedido e os ingredientes. **Mudou em 10/10:** a fila
  não precisa levar os ingredientes — o Farol puxa as fichas e os produtos do Regem e
  guarda base própria ([decisoes.md](decisoes.md)).
- Se a caixa das 21h45 era um Número 01 com queijo em dobro pedido pelo cliente, ou outro
  produto. **O dono, em 10/10:** queijo em dobro é só adicional; o geral é um queijo por
  carne, e uma carne com dois queijos é raro. Era adicional, então — ou erro: com o pedido
  em mãos o sistema saberá.
- Se a maionese vai sobre a carne por padrão (a regra da casa é molho primeiro, na tampa).
- O relógio do gravador está 27 s adiantado: para casar com a hora do pedido, desconta-se.
