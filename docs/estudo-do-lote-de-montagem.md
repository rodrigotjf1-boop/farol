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
| folhas 1, 2 e 3, e a caixa | **quatro lanches de duas carnes** | **três discos** cada: a tampa do pão e dois discos, cada um com uma carne clara e uma fatia de queijo. Na tampa: molho laranja e alface |
| folha 4 | **um lanche diferente** | **dois discos**: a tampa com molho vermelho (de sachê) e uma cobertura escura; a base com uma carne escura e molho branco |

No total: 14 discos de pão, 8 carnes claras, 8 fatias de queijo, 4 tampas com molho laranja
e alface — e o quinto lanche, que não levou queijo nem alface.

Correção ao que eu tinha anotado na primeira olhada (40 quadros espaçados): não eram nove
lanches. Eram oito carnes em quatro lanches, e um quinto de outro tipo.

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
| 21:44:53 → 21:45:27 | 34 s | **queijo** | um maço de fatias na mão; uma fatia por carne (8) |
| 21:45:29 → 21:45:31 | 2 s | *(mãos fora)* | **bancada parada: queijo e alface à vista** |
| 21:45:33 → 21:45:55 | 22 s | **o lanche diferente** | a carne escura na base; molho branco de um potinho, com colher |
| 21:45:57 → 21:46:07 | 10 s | **fechar a caixa** | um disco vai para cima do outro; **a tampa da caixa fecha e o lanche fecha junto** (a tampa do pão estava na tampa da caixa); um código é escrito à caneta; a caixa sai |
| 21:46:09 → 21:46:49 | 40 s | **fechar e embrulhar, três vezes** | empilha os dois discos, vira a tampa por cima, embrulha no papel impresso — 10 a 14 s cada |
| 21:46:57 → 21:47:19 | 22 s | **embalar** | três caixinhas de papelão; um embrulho em cada; fecha; escreve à caneta |
| 21:47:21 | — | **fim** | bancada limpa — menos o quinto lanche, **ainda aberto** quando a leitura acabou (21:47:35) |

Do primeiro pão à última caixa: **4 min 30 s para quatro lanches embalados** — 68 s por
lanche, montando em lote.

Tempo de cada lanche aberto na bancada, do pão ao fechamento: a caixa, 2 min 52 s; as
folhas, de 3 min 20 s a 3 min 50 s; o quinto, mais de 4 min 40 s e não fechou.

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
| depois do queijo (21:45:29) | quantas fatias |
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
do Regem precisa dizer **as camadas que se veem de cima e em que disco ficam**.

**5 · O fechamento é um acontecimento visível**, e de dois jeitos: a tampa da caixa que
fecha o lanche junto; ou empilhar, virar a tampa e embrulhar. Cada um é **um lanche
contado**, com o tipo da embalagem. O tempo aberto de cada posição sai de graça.

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

## O que ainda não se sabe

- **O que eram os dois produtos** (o dono sabe pelo cardápio) e se a carne clara e a escura
  são o que parecem.
- Se **todo** lote é montado assim, por ingrediente. Um lanche avulso, fora do pico, pode
  ser montado de uma vez. É uma semana em "observando" que responde.
- Se há pão embaixo de cada carne (pelo que se vê, sim: aparece a borda clara do disco) ou
  se a segunda carne fica direto na folha.
- O que o KDS tinha em preparo nesses cinco minutos. A leitura do banco do Regem não
  conectou nesta sessão; é o próximo passo, e é ele que fecha a primeira conferência.
- O relógio do gravador está 27 s adiantado: para casar com a hora do pedido, desconta-se.
