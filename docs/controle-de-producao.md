# Controle de produção — a ideia do dono, avaliada

> **Situação: AVALIAÇÃO.** Nada daqui está construído. Data: 10/10/2026.
>
> Parte do estudo de 07/10 ([estudo-montagem-em-escala.md](estudo-montagem-em-escala.md), o
> "livro-caixa da montagem"), da leitura da bancada (roadmap, A19, ondas 4 e 5) e do que o
> dono disse na madrugada de 10/10.

## O que o dono disse

> No KDS a lista de pedidos nem sempre é seguida à risca: tem produtos mais demorados no
> preparo que outros, e tem momentos, na alta demanda, de um tipo de carne ainda não estar
> pronta no conservador.
>
> Uma ideia (avaliar e dar sugestões): no KDS tem vários pedidos; o Farol já agrupa produtos
> similares com quantidades. Exemplo: tem 8 números 08 para serem produzidos, 5 números 01,
> 1 número 01 com adicional de ovo. Então a montagem vai concluindo — concluiu 1 número 01,
> concluiu 3 números 08 — e assim vai subtraindo. Provavelmente vão chegando mais pedidos no
> KDS, e vão somando aos produtos. O ideal é: por mais que estejam agrupados, o KDS tem um
> controle de tempo, e caso algum dos produtos especiais (com observações ou adicionais)
> demore a ficar concluído, ou passe do prazo, emitir notificação. É uma ideia; verifique
> mais possibilidades de controle de produção.

E, na mesma conversa, o que vale para tudo o que segue:

> É um projeto que estamos produzindo para o Mister Burguer, que está sendo nossa cobaia
> para teste e produção; porém é um projeto para distribuição. Estamos criando um algoritmo
> de análise, um motor de análise, cortes e diagnósticos, e outros casos não vão ter as
> mesmas condições que temos no Mister Burguer; por isso temos que fazer de uma forma a se
> adaptar a vários tipos de situações para controle.

## 1 · De onde a ideia vem, e o que ela acrescenta

É o **livro-caixa** do estudo de 07/10: de um lado a demanda (o que o KDS pede), do outro a
produção (o que a câmera vê fechar); cada montagem concluída dá baixa num item aberto do
mesmo produto, sem supor ordem; a conta fecha por fila de produção, e quais bancadas
atendem cada fila é cadastro de cada restaurante.

O que o dono acrescenta agora:

- **o saldo como lista agrupada**, por produto, com quantidade — e o especial (com
  observação ou adicional) em linha própria;
- **a fila viva:** chega pedido, soma; fecha lanche, subtrai;
- **o tempo:** o prazo que o KDS já controla, com a atenção primeiro nos especiais;
- **o motivo de a ordem não ser seguida:** produto demorado, e carne que ainda não chegou ao
  conservador. Não é desvio — é o gargalo aparecendo.

O exemplo dele, na forma em que a tela mostraria:

| produto | no KDS | visto na bancada | falta |
|---|---|---|---|
| Número 08 | 8 | 3 | 5 |
| Número 01 | 5 | 1 | 4 |
| Número 01 + ovo *(especial)* | 1 | 0 | 1 — há 6 min |

## 2 · A avaliação

**É a espinha certa**, por três razões:

1. **É como a cozinha trabalha.** Quem monta adianta o que dá e deixa para depois o que
   depende da chapa. Conferir pedido a pedido, na ordem, acusaria erro o tempo todo.
2. **Não exige saber de qual pedido é cada lanche** — o que nenhuma câmera sabe quando há
   oito iguais na fila.
3. **É como o mercado mostra a fila a quem produz** (seção 4): itens iguais somados, com o
   modificado em subgrupo.

**Cinco ajustes que eu faria:**

1. **Dois números, não um: o KDS manda, a câmera confere.** A câmera não dá baixa na
   verdade do KDS. Ela identifica o produto em bem menos que 100% das vezes (quem vende isso
   promete 85%); uma baixa errada esconderia um pedido que ainda falta. Ficam lado a lado
   "no KDS" e "visto na bancada", e **a diferença é o controle**: pronto no KDS sem montagem
   vista; montagem sem pedido; aberto há mais tempo que o normal (a tabela do estudo de
   07/10, seção 3.1).
2. **Os especiais, um a um; os comuns, pelo saldo.** O especial é raro e é onde o pedido
   sai errado. Cada um é conferido no que ele tem de diferente da ficha — o ovo apareceu? a
   segunda fatia de queijo? a alface ficou de fora? — e o que a loja não decidir sozinha
   sobe à nuvem (um quadro, cerca de R$ 0,001, medido na rodada 5 do teste das fichas). O
   comum fecha pela contagem, com conferência por amostragem.
3. **O tempo: o normal de cada produto, e o prazo do KDS.** "Esquecido" não é um tempo
   único: cada produto tem o seu, aprendido da própria loja (07/10, seção 3.6). Para o
   especial, três sinais: **não começou** (nenhuma posição com a cara dele) com boa parte do
   prazo gasta; **começou e parou** (a posição está aberta e nada entra — esperando a
   carne); **passou do prazo**. O aviso aparece na estação, não em mensagem.
4. **A conta fecha por fila, e pede câmera em todas as bancadas daquela fila.** No piloto
   há uma câmera sobre uma das duas frentes da ilha: o "visto na bancada" é parcial. Serve
   como produção daquela bancada e para a conformidade; o saldo só fecha com a outra frente
   coberta.
5. **Em degraus**, cada um útil sozinho: contar o que fecha, por tipo de base (na loja-piloto,
   caixa ou papel) → dizer o produto pela ficha → os especiais → o aviso na estação. São as
   etapas E1 a E4 do estudo de 07/10 e as ondas 4 e 5 do A19.

**O que o dono decidiu depois de ler (10/10).** Sobre o ajuste 1: o KDS ganha **um modo a
mais**, ao lado do "por pedido" — "por produto, com baixa automática", em que a fila aparece
somada por produto e a quantidade diminui sozinha quando o Farol identifica a montagem. É
opção da loja e **nasce desligado**: só se liga com o acerto da identificação medido naquela
loja, e a baixa errada tem de poder ser desfeita com um toque. Os dois números continuam
guardados por baixo. Do lado do Regem pede o item poder ser dado como feito (hoje o avanço
é por pedido) e uma porta para o Farol entregar o acontecimento de produção; entra no plano
de lá. Registro em [decisoes.md](decisoes.md), 10/10, "O KDS 'por produto, com baixa
automática'".

## 3 · Mais possibilidades de controle de produção

| | o que entrega | precisa de | câmera? |
|---|---|---|---|
| **1 · Demanda por ingrediente crítico** | "os pedidos abertos pedem 14 carnes de 56 g, 3 de 120 g, 6 ovos" — a chapa vê a necessidade antes de a montagem parar | pedidos + fichas | **não.** A câmera da chapa entra depois: "há 8 na chapa, faltam 6" |
| **2 · Tempo por etapa** | entrou no KDS → começou a montar → fechou → saiu: onde o pedido espera | pedidos + posições acompanhadas | sim |
| **3 · Lanche esperando componente** | posição aberta, parada há mais que o normal dela | posições acompanhadas | sim |
| **4 · Ritmo contra a fila** | fechados por 10 min × entrando por 10 min: "a fila cresce — abrir outra bancada" | pedidos + contagem | sim (uma versão só com os toques do KDS sai sem câmera) |
| **5 · Produção por bancada e por turno** | quanto cada bancada montou — por bancada, não por pessoa | contagem | sim |
| **6 · Base contra destino** | pedido de viagem montado na base de mesa, ou o contrário | pedidos + tipo de base | sim |
| **7 · Sobra e refação** | montagem sem pedido; saldo negativo | o saldo | sim |
| **8 · Tempo no passe** | pronto e parado debaixo da lâmpada | câmera no passe | sim, outra câmera |

**Por onde eu começaria:** pela **1**. É dado puro (pedidos × fichas), não depende de câmera
nem de reconhecer ingrediente, ajuda no pico — é a resposta direta à carne que não chegou
ao conservador — e é o que o mercado vende primeiro (seção 4). Depois o saldo com os dois
números na bancada do piloto, e os especiais. As possibilidades 2 a 5 saem quase de graça
quando as posições estiverem sendo acompanhadas.

## 4 · Como o mercado faz

| referência | desde | porte | o que faz | o que ensina |
|---|---|---|---|---|
| **Toast** — KDS, "All Day Display" e "Production Item Count" | 2012 | cerca de 164 mil restaurantes no fim de 2025 | soma os itens iguais dos pedidos abertos, com subgrupo por modificador; e soma por ingrediente ("10 hambúrgueres") | a lista agrupada do dono é padrão de mercado, e a soma por ingrediente também. Nenhuma das duas usa câmera: quem dá baixa é o toque na tela |
| **Kitchen Brains** — QPM | 1969 | "algumas das maiores operadoras de alimentação"; mais de 125 países | gestão de produção: automatiza a cocção para a comida estar "quente, fresca e disponível" | planejar a produção é produto por si, antes de qualquer visão |
| **PreciTaste** | 2012 ¹ | mais de 3.700 sistemas instalados em outubro de 2024 ¹; teste em 8 lojas da Chipotle | câmeras acompanham o nível dos ingredientes e o tempo de cada um, preveem a demanda e dizem o que preparar; também conferem o que entra na sacola contra o pedido | quem usa visão em escala começou por **planejar**, e a conferência veio junto |
| **Agot AI** | 2019 | piloto em cerca de 20 lojas; comprada pela HME | confere a montagem contra o pedido | prometia pegar mais de 85% dos erros — não 100% |

¹ Do resultado da busca: as páginas de origem não abriram para conferência.

São empresas grandes, com redes padronizadas: servem de referência de **desenho**, não de
prazo. O que nenhuma faz, pelo que foi verificado, é fechar a conta da produção pela câmera
em cima de um gravador comum, com o julgamento dentro da loja.

## 5 · Um motor, muitas lojas

O Mister Burguer é o piloto; o produto é para distribuir. Tudo o que foi aprendido lá
separa-se em três camadas — e só a primeira é código do motor:

| camada | o que é | exemplos desta semana |
|---|---|---|
| **O motor** — igual para todo cliente | posição de montagem; item; acontecimento (entrou, cobriu, fechou); roteiro esperado; a revisão pelo gravador; o saldo demanda × produção; os juízes, do barato ao caro; o banco de provas; observar → ensaiar → medir → avisar | a busca pelo meio; "o que cobre o quê"; os dois números do saldo |
| **O perfil da loja** — cadastro; o sistema propõe, o responsável confirma | fichas e produtos; o dicionário de ingredientes (como aparece, onde entra, depois de quê, o que cobre, com que utensílio); as bases de montagem (os tipos, o que cada um significa, onde fica cada parte); as regras da casa; filas e bancadas; os tempos normais | molho primeiro, na tampa; a rotina pão–molho–alface–carne–queijo; caixa = viagem e papel = mesa; na caixa, a tampa em cima; um queijo por carne |
| **Os adaptadores** — por instalação | de onde vêm as fichas e os pedidos; o que o gravador entrega, e como; a câmera, medida na instalação; para onde vai o aviso | o Regem; este gravador entrega a gravação em pedaços de 2 s; 17 a 18 px por cm na bancada |

**Degraus pelo que o cliente tem** — cada um entrega algo sozinho:

| o cliente tem | o Farol entrega |
|---|---|
| só as câmeras | presença, tempos, limpeza; contar montagens e produção por bancada |
| + as fichas (do Regem, de planilha, de outro sistema) | qual produto foi montado; conformidade por amostragem |
| + os pedidos (um KDS integrado) | o saldo, os especiais, a demanda por ingrediente, o aviso na estação |
| + câmera em todas as bancadas de uma fila | a conta fecha |

Três cuidados que saem daí:

- **Regra da casa nunca vira `if` do motor.** Uma pizzaria não tem tampa nem caixa; uma
  loja sem Regem tem fichas de outro lugar. O teste de cada peça é: outro tipo de cozinha
  conseguiria usar?
- **O perfil não pode depender de mim.** Nesta semana eu apontei à mão onde estava a tampa
  e escolhi os limiares olhando os quadros. No produto, quem propõe é o sistema — a partir
  das fichas e do que a bancada mostra — e quem confirma é o responsável pela loja.
- **O que o aparelho faz se mede na instalação** e fica na base de equipamentos: este
  gravador baixa arquivo por horário em pedaços de 2 s; outro pode só tocar a gravação, e
  aí a revisão usa outro caminho.

## 6 · A integração com o Regem, como o dono decidiu

> Não precisa ingredientes na fila de produção. Na integração Farol e Regem o Farol já puxa
> as fichas técnicas e seus produtos, e fica com base própria de consulta; se não for viável
> usar dessa forma, vemos uma forma de o Regem repassar.

**É viável: os dados existem todos no Regem. O que falta é a porta.** Lido no código do Regem
(a `main` do GitHub em 10/10/2026, revisão `bb7beca6`); nada foi executado, e o banco de
produção não foi consultado.

| o Farol precisa de | o Regem já tem | o que falta |
|---|---|---|
| as fichas com os ingredientes, sem custo | `GET /fichas` devolve todas as fichas da empresa numa chamada, cada uma com os ingredientes (nome, quantidade, unidade, sub-receita, a marca "só no delivery"); o custo sai zerado para quem não tem a permissão | só responde a usuário logado: não há leitura por credencial de integração; não separa por loja, nem diz "o que mudou desde" |
| os produtos, com a ficha, as variações e o tempo de preparo | o produto aponta a ficha; a variação tem o seu fator sobre a ficha; há o tempo de preparo e a marca "vai para a produção" | a lista de produtos traz a ficha, mas variações e adicionais só saem produto a produto; a leitura de catálogo por credencial (a que o totem usa) não traz ficha nem variação |
| os adicionais, e o que cada um muda | o adicional aponta para um insumo ou para uma ficha; "sem cebola" aponta para a linha da ficha que deixa de entrar; "repetir" grava uma linha por vez | o identificador do adicional dentro do produto muda cada vez que o cardápio é salvo: o estável é o da opção de origem, e é esse que tem de sair. Adicional só informativo não tem vínculo nenhum |
| os pedidos em produção | `GET /producao/fila`: por pedido, a origem, a mesa, o consumo (local ou viagem), a plataforma, o estado e os horários (criado, iniciado, pronto, entregue); por item, a descrição, a quantidade, os complementos **em texto** e a observação | o item não traz o identificador do produto, da variação nem dos adicionais — estão guardados na venda, e a fila não os junta. Só responde a usuário logado, com o módulo do KDS ligado |
| saber quando ficou pronto | por **pedido**: pronto e entregue, com a hora | por **item** não existe: o toque no KDS vale para o pedido inteiro. O pedido entregue sai da fila, e não há leitura "desde tal hora" |
| o prazo | o tempo de preparo de cada produto; o cartão guarda o maior entre os itens; as cores por loja (verde até 5 min e amarelo até 10, de fábrica) | a conta do atraso é feita só na tela do KDS |
| o destino | "local" ou "viagem" no pedido de balcão e de totem; a plataforma no pedido de canal | mesa, entrega e retirada de canal chegam sem a marca de consumo |
| a soma por produto | o KDS já tem o "resumo de itens": soma os iguais entre os pedidos a produzir | soma pelo **texto** da descrição, na tela: o mesmo produto com adicional diferente vira outra linha; e não há soma por ingrediente |

Três coisas que essa leitura muda na avaliação:

- **"Não precisa de ingredientes na fila" está certo — precisa de identificadores.** Hoje o
  item da fila é texto ("X-Burger (2x Bacon, Sem cebola)"). Para o Farol achar a ficha na
  base própria, o item tem de trazer o identificador do produto, da variação e de cada
  adicional. Os dados existem; é juntar, não criar.
- **O KDS só sabe do pedido inteiro; a câmera dá o item.** O toque de "pronto" vale para o
  pedido todo. "Vi fechar 3 números 08" é informação que o Regem não tem hoje — é o que o
  "visto na bancada" acrescenta ao resumo de itens que o KDS já mostra.
- **A leitura fiel dos pedidos é na loja.** Com servidor local, a fila nasce na loja e sobe
  à nuvem de minuto em minuto; e a porta de integração que existe hoje só funciona na
  nuvem. O catálogo pode vir da nuvem; os pedidos, do servidor da loja — onde o agente do
  Farol já está.

**O que o plano do lado do Regem tem de propor** (lá, antes de qualquer código):

1. a credencial do Farol, por loja, criada pela distribuição — valendo também no servidor
   da loja;
2. uma leitura de catálogo em lote: produtos, variações, fichas com os ingredientes (sem
   custo), adicionais com identificador estável e o que cada um muda, tempo de preparo —
   com "o que mudou desde";
3. a leitura dos pedidos em produção com os identificadores, a observação, o destino e os
   horários — e as conclusões "desde tal hora", para o pedido que já saiu da fila;
4. a soma por produto e por ingrediente feita no servidor: a possibilidade 1 da seção 3
   mora aqui — é uma tela do KDS da chapa, sem câmera.

**Se a porta demorar:** a base do Farol recebe as fichas por planilha — o que ela tem de
saber fazer de qualquer jeito, para a loja sem Regem. O que não se faz é o Farol entrar no
Regem com usuário e senha de colaborador: funcionaria hoje, mas é credencial de pessoa
posta em máquina, e casaria pedido com ficha pelo texto.

**Não verificado:** quantas fichas e produtos a loja-piloto terá, e como os adicionais dela
serão cadastrados (com ficha, com insumo, ou só informativos).

## 7 · O que não foi medido, e o que falta saber

- Nada desta avaliação foi medido: é desenho. A primeira medida possível é a possibilidade 1,
  que só precisa dos pedidos e das fichas.
- Quanto a câmera acerta o produto ao fechar — é a porta do degrau E2 (mais de 90%).
- Quantos especiais há por hora no pico, e quanto tempo cada produto leva do KDS ao
  fechamento: sai da primeira semana com os pedidos chegando.
- Em outra cozinha: nada. O motor só foi exercitado no piloto.

## Fontes

Verificadas em 10/10/2026.

- [Toast — All Day Display no KDS](https://support.toasttab.com/en/article/KDS-All-Day-1493055871075)
- [Toast — Production Item Count no KDS](https://support.toasttab.com/article/Production-Item-Count)
- [Toast — resultados de 2025: "Total Locations (…) approximately 164,000" (cópia do comunicado)](https://www.01net.it/toast-announces-fourth-quarter-and-full-year-2025-financial-results/)
- [Wikipedia — Toast, Inc. (fundação em 2012)](https://en.wikipedia.org/wiki/Toast,_Inc.)
- [Perishable News — Kitchen Brains: fundada em 1969, QPM, mais de 125 países](https://perishablenews.com/retailfoodservice/kitchen-brains-accelerates-growth-with-investment-from-source-capital/)
- [The Batch (deeplearning.ai) — o que o sistema da PreciTaste faz no teste da Chipotle](https://www.deeplearning.ai/the-batch/chipotle-tests-ai-for-predicting-customer-demand)
- PreciTaste, fundação e número de sistemas: [Restaurant Leadership](https://restaurantleadership.com/company/precitaste) e [Convenience Store News](https://www.csnews.com/precitaste-automation-solutions) — vistos só pelo resultado da busca.
- As fontes da Agot AI estão em [estudo-montagem-em-escala.md](estudo-montagem-em-escala.md).
