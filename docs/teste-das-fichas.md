# Identificar o produto pela ficha técnica — o experimento de 09/10/2026

Em 09/10, lendo o estudo do lote, o dono disse como a conferência vai funcionar: com o Regem,
**o pedido vai ao KDS com a ficha técnica, sem os valores**; e **"a ordem não é importante, e
sim todos os ingredientes"**. Citou quatro fichas e, durante o trabalho, a quinta. Este
experimento mede, com as imagens dos lotes de 08/10, o que a nuvem consegue fazer com elas.

Gasto: **R$ 1,03** (R$ 0,70 na primeira rodada, R$ 0,33 na segunda), dentro do teto de
R$ 5,00 do teste da nuvem (acumulado: R$ 3,94). As imagens ficaram no PC da loja só durante
o experimento e não estão neste repositório.

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
  as quantidades (três discos de pão, duas carnes, duas fatias de queijo, alface, molho);
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
| seco · Haiku 5.5 | 15 | 12 certas | **15 certas** | 12 (12) | 51 de 78 (65%) | 0,13 centavo | 2,0 s |
| dicionário · Haiku 5.5 | 15 | 12 certas | **15 certas** | 13 (13) | 59 de 78 (76%) | 0,13 centavo | 1,8 s |
| dicionário · Sonnet 5.5 | 5 | 5 certas | 5 certas | 4 (4) | 19 de 26 (73%) | 5,85 centavos | 6,4 s |

O que cada variante errou, por item:

| variante · modelo | não viu, ou contou errado |
|---|---|
| seco · Haiku 5.5 | molho rosé 10; carne 5; queijo 3; no Mussarela Bug: a mussarela, a geleia e a cebola crispy nas três vezes (chamou a geleia de "molho rosé") |
| dicionário · Haiku 5.5 | molho rosé 12; pão 2; carne 2; queijo 1; mussarela 1; geleia 1 |
| dicionário · Sonnet 5.5 | molho rosé 3; pão 2; carne 1; queijo 1 — e o Mussarela Bug com os seis itens certos |

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
   seis itens no maior. Os itens certos subiram de 65% para 76%.
4. **O molho embaixo da alface não se vê depois** (25 erros em 28). Os quadros que escolhi
   eram os do fim de cada fase; o molho entra e a alface cobre em segundos. Para conferir
   molho, o quadro tem de ser o da posição parada logo depois dele — a quietude por posição
   do plano. O mesmo vale para o pão embaixo da carne.
5. **Custa quase nada no caminho barato:** 0,13 centavo por lanche — R$ 0,0013. Mil lanches
   por dia: R$ 1,30. No modelo maior, R$ 58.
6. **O modelo maior fica para a dúvida:** acertou tudo dizendo a ficha, mas custa 45 vezes
   mais e viu os itens tão bem quanto o barato com dicionário.

## O que isto não é

- **Não é o sistema lendo sozinho.** As posições foram recortadas por mim, à mão; os quadros
  foram escolhidos por mim. Achar as posições e os instantes é o trabalho das ondas 4 e 5.
- **É um lote, cinco lanches, dois produtos**, três repetições. "15 de 15" aqui é pouco.
- **Que os quatro são o Número 01** é leitura minha contra a ficha do dono: falta ele dizer.
- **Sem o pedido**: aqui a nuvem escolhe entre cinco fichas. Com o pedido conhecido (o Regem
  na loja), a pergunta fica mais fácil — "estes ingredientes estão todos?".
- No lote anterior (21h37 a 21h41) há uma posição compatível com o Número 02 e três que não
  estão entre estas fichas; a rodada 1 passou por ele sem gabarito, e os números não entram
  na conta.

## A correção do PR #69, conferida contra a nuvem

No mesmo roteiro, com o código novo lido direto do pacote (sem instalar nada):

| o que | os pedidos que saíram | o que voltou |
|---|---|---|
| a cascata do juiz, com o limiar forçado para reconsultar | Haiku 4.5 com a ferramenta forçada (teto 300); depois Sonnet 5.5 com a escolha livre (teto 2.000) | veredito do Sonnet: "dentro", 0,70, com a frase; 5,9 centavos as duas |
| o pedido de "Analisar as fotos e descrever" | Sonnet 5.5 com a escolha livre (teto 3.000) | respondeu pela ferramenta, 818 unidades de saída: descrição de 343 letras e 5 pontos a conferir; 6,8 centavos |

A forma nova funciona. Falta o pacote ser trocado na loja.

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
