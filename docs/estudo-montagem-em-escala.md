# Montagem em escala — estudo

> **Situação: ESTUDO.** Nada daqui está construído. É o plano para ser
> discutido e aprovado antes de qualquer código. Data: 07/10/2026.
>
> **O dono respondeu às perguntas no mesmo dia** — estão na seção 11, com o
> que cada resposta muda no desenho.
>
> **08/10/2026:** a câmera do piloto foi instalada (canal 4, VHD 3250 VF G8).
> As primeiras medidas, o algoritmo de leitura da bancada e a prova ao vivo
> estão no roadmap, seção **A19**, e em `docs/prova-leitura-da-bancada.md`.
> Este estudo entrou no plano por lá.
>
> **10/10/2026:** o dono retomou o livro-caixa como "saldo de produção" — os pedidos do
> KDS agrupados por produto, com baixa pelo que a montagem conclui e atenção aos
> especiais. A avaliação e as outras possibilidades de controle de produção estão em
> [controle-de-producao.md](controle-de-producao.md). A linha "a ficha como sequência de
> camadas", da seção 7, mudou: a conferência é por conjunto, a ordem é pista, e as
> fichas o Farol puxa do Regem para base própria.

## A pergunta do dono

> Em período de alta demanda na montagem são centenas de hambúrgueres sendo
> montados, com 4 setores de montagem. Entrando em análise a cada segundo —
> que é o tempo de colocar um ingrediente e o quadro mudar — e integrando com
> o pedido que vem do Regem, vai exigir processamento.
>
> Se eu quiser saber quantos produtos foram feitos, o Regem já registra a
> venda. A ideia do controle por vídeo é verificar **se o pedido registrado
> foi preparado** e, principalmente, **se foi preparado corretamente**, como
> manda a ficha técnica.
>
> Vai ter momento em que há 9 x-burguers no KDS, e um setor produz 2, outro
> produz 6 e outro produz 1. Como controlar isso? Com todos os setores
> cobertos por câmeras focadas, priorizando as análises locais e subindo à
> nuvem quando necessário.

São três perguntas dentro de uma:

1. **Qual pedido é este lanche?** — quando ninguém diz, e há nove iguais na fila.
2. **Dá para processar?** — quatro bancadas, centenas de lanches, um ingrediente por segundo.
3. **O que roda na loja e o que sobe?**

---

## 1 · O que já estava desenhado, e continua valendo

O roadmap tem a seção **"A regra de montagem — desenho fechado"**. Quatro
decisões dela seguem de pé e este estudo se apoia nelas:

| decisão | por quê |
|---|---|
| **Não classificar: verificar.** "É o queijo, que é o que deveria entrar agora?" | escolher entre 12 ingredientes acerta ~95% por item — com 8 itens, 66% no lanche inteiro. Confirmar UM esperado passa de 99% |
| **Contar deposições já pega metade dos erros** | a ficha pede 6 camadas, aconteceram 5: faltou algo, sem identificar nada |
| **O quadro que vale é o de logo depois que a mão sai** | durante a deposição a mão tapa o ingrediente |
| **O alerta sai no KDS da estação, em segundos, e o julgamento é local** | ida e volta à nuvem leva 2 a 5 s; nesse tempo o pão já fechou |

## 2 · O que aquele desenho supunha, e a loja não tem

Ele parte de uma frase: *"o Regem entrega a receita esperada do pedido"*.
Isso supõe saber, para cada lanche na bancada, **de qual pedido ele é**.

Na loja de verdade:

- o KDS mostra a fila inteira para todos; ninguém aperta "este é meu";
- há **quatro bancadas** montando em paralelo;
- na mesma bancada há **vários lanches abertos ao mesmo tempo** — na hora do
  pico monta-se em lote: os pães de todos, a carne de todos, o queijo de todos;
- e são **centenas** por hora.

O desenho antigo responde "este lanche está certo?" quando se sabe qual é o
lanche. Falta a peça de antes: **saber qual é**.

---

## 3 · A ideia central: não perguntar de qual pedido é — conferir a conta

Para nove x-burguers iguais, tanto faz qual deles a bancada 2 montou. Eles são
intercambiáveis. O que interessa é que **a conta feche**:

- todo lanche pedido foi montado por alguém;
- todo lanche montado tinha um pedido;
- todo lanche montado saiu conforme a ficha do produto.

### 3.1 O livro-caixa da montagem

De um lado entra a **demanda**: cada item que aparece no KDS. Do outro, a
**produção**: cada montagem que uma câmera viu começar e terminar. Cada
montagem concluída dá baixa num item aberto do mesmo produto — o mais antigo.

O exemplo do dono:

| | x-burguer |
|---|---|
| no KDS | 9 |
| bancada 1 montou | 2 |
| bancada 2 montou | 6 |
| bancada 3 montou | 1 |
| **saldo** | **0 — fechou** |

A câmera é da bancada, então **quem montou quanto sai de graça**: é o número
de produtividade por estação que hoje ninguém tem.

E a conta que não fecha é o alerta:

| a conta mostra | o que significa | para quem |
|---|---|---|
| item marcado **pronto** no KDS, sem montagem vista | o pedido registrado **não foi preparado** à vista da câmera — ou saiu de outro lugar | gestão |
| montagem concluída **sem item aberto** | lanche feito sem pedido: erro, refeição de funcionário ou desvio | gestão |
| item aberto há mais tempo que o normal, sem montagem | pedido esquecido | KDS, na hora |
| montagem que **não bate com a ficha** | preparado errado | KDS da estação, na hora |

As três primeiras linhas respondem "o pedido registrado foi preparado?". A
quarta responde "foi preparado corretamente?".

### 3.2 Como saber qual produto é, sem ninguém dizer

A cada instante o KDS tem poucos produtos **distintos** em aberto — quatro,
seis, não o cardápio inteiro. O lanche que está começando só pode ser um deles.

E a cada camada colocada, a lista encolhe:

```
abertos no KDS:  x-burguer · x-salada · x-bacon

 pão            → os três continuam possíveis
 carne          → os três
 queijo         → os três
 bacon          → só o x-bacon
```

Ou seja: em cada passo a pergunta é "esta camada é **uma das duas ou três**
que as fichas abertas esperam agora?" — não "qual dos 30 ingredientes da loja
é este?". A vantagem da verificação binária continua valendo; só que contra
um conjunto pequeno de hipóteses em vez de uma receita só.

Quando o lanche fecha, sobra uma hipótese — é o produto, e dá baixa no livro.

Se **não sobra nenhuma**, procura-se a ficha aberta mais parecida, e a
diferença vira o texto do alerta: *"x-salada sem o tomate"*. Sempre por item,
nunca "a montagem está errada".

### 3.3 Item com observação

"Sem cebola" e "adicional de bacon" entram no livro como **outra receita**:
a ficha do produto com a alteração aplicada. A montagem que fecha como
x-burguer comum, quando o único x-burguer aberto era "sem cebola", é
divergência — e o alerta diz qual pedido pedia.

### 3.4 E quando for preciso saber o pedido exato

Há uma alternativa mais simples que qualquer inferência: **dizer**. Uma
etiqueta com código grande, impressa pelo Regem junto com o pedido, posta ao
lado da embalagem; a câmera lê o código e a montagem nasce amarrada ao item.
É o que a indústria faz para rastrear peça em linha de produção.

Custa um gesto do montador a cada lanche. **Não recomendo exigir de início**:
o livro-caixa por produto já responde às duas perguntas do dono sem mudar a
rotina de ninguém. Fica como degrau opcional, para onde ele quiser rastreio
pedido a pedido.

### 3.5 Fila de produção e bancadas — cadastro de cada restaurante, não regra

A loja de teste tem **dois KDS**: o do delivery, atendido por 2 bancadas, e o
do balcão, atendido por 4. Outro restaurante terá outra divisão. Então isso
**não entra no código**: entra no cadastro.

- **Fila de produção** = um KDS. É de onde vem a demanda.
- **Bancada** = uma câmera de montagem. É de onde vem a produção.
- Cada fila diz quais bancadas a atendem. Uma bancada pode atender mais de uma
  fila, se o restaurante trabalhar assim.

**O livro-caixa fecha por fila**: o que o KDS do delivery pediu contra o que as
bancadas do delivery montaram. Nove x-burguers no balcão divididos 2 / 6 / 1
entre três das quatro bancadas dele continuam sendo uma conta só.

### 3.6 O montador não segue a ordem da lista — e não é erro

Dito pelo dono: o colaborador olha a lista e nem sempre segue a ordem. Quando
um produto demora, ou o ingrediente ainda não está à mão, ele adianta os mais
rápidos.

Três consequências, todas a favor do livro-caixa por produto:

- **a baixa nunca supõe ordem.** "O mais antigo do mesmo produto" é só
  contabilidade; nada no desenho exige que o lanche da vez seja o primeiro da
  fila;
- **"fora de ordem" não é alerta.** É como a cozinha trabalha;
- **"pedido esquecido" não pode ser um tempo único.** Cada produto tem o seu
  tempo normal — e ele se aprende da própria loja, observando quanto cada um
  leva do KDS até a montagem. O alerta é "este passou muito do normal dele",
  nunca "este passou de 10 minutos".

---

## 4 · Vários lanches abertos na mesma bancada

Com montagem em lote, a mão passa por seis lanches seguidos. Não dá para
tratar a bancada como uma sequência só.

A unidade passa a ser a **posição de montagem**: cada embalagem ou papel
aberto na bancada é uma posição, acompanhada pelo lugar onde está. Cada uma
tem a sua própria linha do tempo de camadas, e a regra do "quadro depois que
a mão sai" vale por posição — olha-se o pedaço da imagem daquela embalagem.

Isso exige o detector saber achar "base de montagem aberta". O modelo de hoje
não conhece: nas câmeras da loja ele chamou a embalagem aberta de "tigela",
com 0,66. Entra na lista do que precisa ser treinado (seção 7).

---

## 5 · O volume: não é "analisar a cada segundo"

A intuição "um ingrediente por segundo, quatro bancadas, logo quatro análises
por segundo sem parar" superestima o custo, porque junta duas coisas de preço
muito diferente:

| | o que faz | quando | custo medido |
|---|---|---|---|
| **vigiar** | comparar o quadro com o anterior, na área de cada posição | todo quadro, 15 por segundo | **2,8 ms** por quadro, no processador |
| **julgar** | rodar o modelo no recorte da posição | só quando a posição **mudou e a mão saiu** | **88 ms** por análise, na placa de vídeo |

Vigiar é barato e contínuo. Julgar é caro e raro: uma vez por camada.

### Medido no PC da loja (07/10/2026)

i7-10700F, Radeon RX 560, gravador Intelbras MHDX 3116-C:

| o que foi medido | resultado |
|---|---|
| **4 canais no fluxo principal (1920×1080) ao mesmo tempo** | 15,0 a 15,4 quadros/s em cada um — a taxa cheia |
| processador gasto com os 4, decodificando e vigiando | **10% da máquina** |
| vigiar (diferença entre quadros) | 2,7 a 2,9 ms por quadro |
| uma análise do detector | 88 ms na placa, 113 ms no processador |
| rede ocupada por **um** fluxo principal | **2,8 Mbps** |
| **8 canais no fluxo principal ao mesmo tempo** | cai para 9 a 11 quadros/s — **não sustenta** |
| velocidade negociada pela placa de rede do PC com a rede do gravador | **10 Mbps** — numa placa gigabit |

### A conta do pico

Supondo 400 lanches por hora somando as quatro bancadas, 8 camadas cada:

```
400 × 8 = 3.200 análises por hora = 0,9 por segundo
0,9 × 88 ms = 8% do tempo da placa de vídeo
```

Com mil lanches por hora, 20%. **O PC que já está na loja dá conta das quatro
bancadas com folga.** O gargalo não é processamento.

### O gargalo que apareceu

**É o cabo de rede, não o computador.** A placa do PC é gigabit e está
**forçada em 10 Mbps Half Duplex** — e não por descuido: em autonegociação o
enlace não fecha (testado em 07/10, com volta automática). O cabo é Cat6, mas
tem uma **emenda no caminho**; o dono vai trocar por um inteiro. Cada fluxo
principal ocupa 2,8 Mbps:

```
4 bancadas em alta            4 × 2,8  = 11,2 Mbps
14 canais no fluxo reduzido   14 × 0,17 =  2,4 Mbps
                                          ─────────
                                          13,6 Mbps   numa ligação de 10
```

Os quatro sozinhos passam no limite (medido: taxa cheia); **os quatro mais o
resto da loja não cabem.** O cabo novo é pré-requisito do projeto de montagem.
Depois de trocado: devolver a placa à autonegociação e conferir que ela fecha
a 100 Mbps ou mais.

---

## 6 · O que roda na loja e o que sobe

| | onde | por quê |
|---|---|---|
| vigiar as posições, achar o quadro certo | loja | contínuo; nenhuma imagem sai |
| confirmar a camada contra as fichas abertas | loja | o alerta tem que chegar antes de o lanche fechar |
| manter o livro-caixa e fechar a conta | loja | funciona com a internet fora |
| receber a fila do KDS e as fichas | loja | o Regem já tem servidor dentro da loja — sem ida à nuvem |
| avisar o KDS da estação | loja | idem |
| **ensinar o modelo da loja** (seção 7) | nuvem, fora do horário | rotular exemplos é trabalho de modelo grande, feito uma vez |
| **desempatar a montagem duvidosa** | nuvem, depois | a tira de quadros daquele lanche vai para o modelo grande com a ficha; vira dado de gestão, não alerta na hora |
| **conferir o modelo local** por amostragem | nuvem, toda semana | saber se ele continua acertando, antes que alguém pare de confiar |

"Subir quando necessário" fica então com sentido preciso: **nunca para o
alerta da hora; sempre para ensinar, desempatar e conferir.**

Um ganho de privacidade vem junto: o recorte da posição de montagem mostra
embalagem e mãos, não rosto. É o tipo de imagem que pode sair da loja sem o
problema descrito na seção A11 do roadmap.

---

## 7 · O que precisa existir e ainda não existe

Dito sem enfeite — é aqui que está o trabalho:

| falta | situação hoje | caminho |
|---|---|---|
| **reconhecer os ingredientes desta loja** | o detector conhece 17 objetos genéricos; nenhum é ingrediente | fotos de referência de cada ingrediente, vistas pela câmera da bancada → comparação por semelhança → com os exemplos acumulados, um classificador pequeno treinado só para esta loja |
| **achar a posição de montagem** | não existe; a embalagem aberta é lida como "tigela" | mesma coleta de exemplos, uma classe: "base aberta" |
| **câmera que enxergue a camada** | a análise de hoje usa o fluxo reduzido, de 704×480. Quantos px por cm cada câmera de bancada entrega no fluxo principal **não foi medido** | uma câmera por bancada, de cima, enquadrando só a área de montagem, no fluxo principal. A meta do roadmap é 12,8 px por cm; mede-se com uma folha A4 na bancada (etapa E0) |
| **a fila do KDS chegando ao agente** | não existe integração | o Regem expõe, na rede da loja, os itens abertos e os marcados prontos |
| **a ficha como sequência de camadas** | a ficha técnica do Regem lista insumos e quantidades, para custo | cada ficha ganha a lista das camadas **visíveis**, na ordem de montagem. Sal e óleo não são camada |
| **o alerta voltando ao KDS** | o transporte de alertas do Farol ainda não entrega em lugar nenhum | é a peça que já estava na fila do roadmap |

Duas incertezas que só a medição resolve, e que podem limitar o resultado:

- **Molho e camada fina.** Ketchup e maionese sobre a carne mudam pouco a
  imagem. Pode ser que "passou molho" seja detectável e "qual molho" não.
- **Ingredientes parecidos.** Dois queijos amarelos, vistos de cima, podem ser
  indistinguíveis. Aí a ficha é conferida até onde a câmera alcança, e o
  relatório diz onde não alcança.

---

## 8 · Como o mercado faz

| quem | o que faz | o que ensina |
|---|---|---|
| **Agot AI** (EUA, 2019) | câmeras sobre a linha de montagem de fast-food; compara em tempo real com o pedido e avisa o funcionário ("faltou o queijo"). Piloto com a Yum! Brands em cerca de 20 restaurantes | a própria empresa dizia pegar **mais de 85%** dos erros de pedido — não 99%. Levantou cerca de US$ 14 milhões e foi comprada pela HME |
| **Dragontail / Domino's** ("Pizza Checker") | uma câmera sobre a bancada de corte fotografa a pizza pronta: tipo, coberturas, distribuição. Resposta em 3 segundos; cerca de 2.000 lojas em 7 países | pizza é **aberta**: uma foto no fim mostra tudo. Hambúrguer é **fechado**: no fim não se vê nada — por isso aqui é obrigatório acompanhar a sequência |
| **PreciTaste** (EUA) | câmeras de profundidade e computador na loja; o produto principal é dizer o que preparar e quando, com acurácia de pedido como aplicação a mais. US$ 24 milhões em 2022 | quem vende isso em escala põe o processamento **dentro da loja**, e ganha dinheiro primeiro com planejamento de produção, depois com conferência |

**Tempo e porte.** São empresas com dezenas de milhões de dólares, anos de
desenvolvimento e redes de milhares de lojas com linha de montagem
padronizada. Não é referência de prazo para nós. É referência de **desenho** —
e os três apontam para o mesmo: processar na loja, restringir pelo pedido, e
prometer menos que 100%.

---

## 9 · As abordagens, lado a lado

| | como funciona | a favor | contra |
|---|---|---|---|
| **A · adivinhar o pedido de cada lanche** | casar cada montagem com um pedido específico, por tempo e conteúdo | não muda a rotina | com nove iguais na fila a resposta é arbitrária — e não serve para nada |
| **B · livro-caixa por produto** | identificar o produto pela sequência; fechar a conta demanda × produção | responde às duas perguntas do dono; não muda a rotina; dá produção por bancada | não diz qual pedido específico saiu errado quando há vários iguais |
| **C · identificação explícita** | etiqueta com código ao lado da embalagem; a câmera lê | rastreio pedido a pedido, robusto | um gesto a mais por lanche, na hora em que menos se tem tempo |
| **D · auditoria por amostragem** | de tempos em tempos, a tira de quadros de uma montagem vai para o modelo grande, com a ficha | usa o que já existe; dá o percentual de conformidade; gera os exemplos para ensinar o modelo local | não avisa na hora; custa por análise |

**Recomendação: B como espinha, começando por D.**

D vem primeiro porque é barato, usa o que já está construído, e produz as
duas coisas de que B depende: os exemplos rotulados da própria loja, e a
medida de quanto a câmera atual consegue enxergar. B entra em seguida, em
degraus. C fica disponível para quem quiser o rastreio completo.

---

## 10 · Etapas propostas

Cada etapa entrega algo que se usa sozinho, e tem uma porta: só se passa para
a seguinte com a medida na mão.

| etapa | entrega | precisa de | porta |
|---|---|---|---|
| **E0 · piloto de UMA bancada** | regular e testar uma câmera de cima antes de instalar as outras: enquadramento, px por cm medido com a folha A4, e os números do pico — montagens por hora, posições abertas ao mesmo tempo, tempo por camada | uma câmera sobre uma bancada, o agente e o cabo novo; uma semana | a câmera entrega os 12,8 px por cm e a camada aparece no quadro depois que a mão sai. Só então se compram as outras |
| **E1 · contar montagens por bancada** | "montagem começou / terminou" por posição; total produzido × total pedido por período; produção por bancada | detector de "base aberta"; a fila do KDS vinda do Regem | a contagem bater com a venda em mais de 95% das horas |
| **E2 · saber qual produto** | o livro-caixa por produto; "pronto sem montagem" e "montagem sem pedido" | reconhecimento de ingredientes da loja; fichas com as camadas visíveis | identificar o produto certo em mais de 90% das montagens |
| **E3 · conferir a ficha na hora** | alerta no KDS da estação antes de o lanche fechar: "faltou o queijo" | E2 + o caminho de volta ao KDS | alerta falso raro o bastante para ninguém desligar |
| **E4 · observações e porção** | "sem cebola", adicional, quantidade | E3 estável | — |

E0 pode começar já, junto com a semana de operação que é o alvo imediato.
Não disputa nada com ela. O dono foi explícito: **primeiro regular e testar
uma câmera; depois instalar as outras.**

---

## 11 · Respondido pelo dono (07/10/2026)

| pergunta | resposta | o que muda no desenho |
|---|---|---|
| O pedido aparece no KDS antes de o montador começar? | **Sim.** O operador registra no balcão e o pedido aparece no KDS de produção, ou no destinado. O colaborador olha a lista e começa | o livro-caixa tem a demanda na hora; a verificação por camada tem contra o que conferir |
| O montador segue a ordem da lista? | **Nem sempre.** Produto demorado, ou sem ingrediente à mão, fica para depois; ele adianta os rápidos | seção 3.6: a baixa não supõe ordem, "fora de ordem" não é alerta, e "esquecido" é por produto |
| Um KDS para todas as bancadas? | **Dois.** Delivery, com 2 bancadas; balcão, com 4. **E isso varia de restaurante para restaurante — não pode virar regra** | seção 3.5: fila de produção e bancadas são cadastro; o livro-caixa fecha por fila |
| Cabe uma câmera de cima em cada bancada? | **Sim, terá uma em cima de cada montagem.** Primeiro regular e testar uma; depois instalar as outras | a etapa E0 vira o piloto de uma bancada |
| A etiqueta com código (opção C) cabe na rotina? | não respondido | segue como degrau opcional; nada depende dela |

### O que ainda falta saber, e só a medição responde

- qual canal recebe a câmera do piloto, e quantos px por cm ela entrega;
- se a camada fina (molho) aparece no quadro;
- quantas posições ficam abertas ao mesmo tempo numa bancada, no pico.

---

## Fontes

- [CNBC — Agot AI e a acurácia de pedido por visão computacional](https://www.cnbc.com/amp/2021/09/16/this-start-up-uses-computer-vision-to-get-your-fast-food-order-made-accurately-.html)
- [TechCrunch — Agot AI: onde o pedido dá errado](https://techcrunch.com/2022/02/11/agot-ai-gives-restaurants-computer-vision-to-see-where-food-orders-go-wrong)
- [Hospitality Technology — Agot AI levanta US$ 12 milhões; piloto com a Yum!](https://hospitalitytech.com/agot-ai-raises-12-million-develop-build-computer-vision-tech-foodservice)
- [CB Insights — Agot AI (aquisição pela HME)](https://www.cbinsights.com/company/agotai)
- [iTWire — câmeras da Dragontail conferem a pizza na Domino's](https://itwire.com/deals/dragontail-ai-cameras-check-pizza-quality-for-domino-s)
- [QSR Magazine — PreciTaste levanta US$ 24 milhões](https://www.qsrmagazine.com/news/precitaste-raises-24m-grow-vision-ai-technology/)
- [Intel — resumo da plataforma PreciTaste](https://www.intel.com.tr/content/dam/www/central-libraries/us/en/documents/2022-09/precitaste-platform-partner-brief.pdf)
