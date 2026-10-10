# A planta viva — o ambiente em 3D, com as câmeras e as pessoas (estudo de 10/10/2026)

> **Estudo, não plano de execução.** Nada aqui está ligado nem implementado. Ele responde ao
> que o dono descreveu em 10/10, diz o que dá para fazer, com que erro e a que custo, e fecha
> com uma prova barata para o piloto. As duas decisões que são dele estão no fim da seção 6.
> Na ordem do roadmap, a planta viva são as ondas 9 e 10.

## O que o dono disse

Em 10/10/2026, com quatro imagens de exemplo (uma planta com os cones das câmeras, pessoas e
trajetos; a mesma loja em 3D; e a imagem de cada câmera simulada) — "não para seguir
fielmente, e sim para representar a ideia":

> a nossa planta e algo de muito valor no projeto. ele define o ambiente, vamos colocar
> representações com identificação dos colaboradores simulando seus passos durante o
> expediente, para analise de dados de seus movimentos e controle das ações para tomada de
> decisões. a ideia e que uma analise grafica do ambiente vai ser gerada em formato 3d de
> acordo com as imagens das cameras que geralmente sao espalhadas para cobrir o ambiente e
> nao deixar pontos cegos, e com isso conseguimos montar o ambiente (como num jogo online).
> […] quando for produzir usar o maximo de recurso para produzir algo de maior qualidade e
> detalhes.

São cinco pedidos numa frase. O estudo trata um de cada vez.

## Em uma página

| a parte | dá? | como | o que pede |
|---|---|---|---|
| **1. O ambiente em 3D**, com acabamento de jogo | **dá** | a planta que o Farol já guarda, em metros, ganha volume; os equipamentos vêm de uma biblioteca de peças no mesmo estilo | nada da loja: a planta desenhada basta |
| **2. A imagem de cada câmera, simulada** | **dá** | uma câmera virtual no lugar da de verdade, com o ângulo da lente dela | a inclinação de cada câmera, que a planta de hoje não tem, e o ângulo da lente de cada modelo, que a base de equipamentos ainda não guarda |
| **3. Montar o ambiente pelas imagens das câmeras** | **em parte** | calibrada por pontos, cada câmera projeta no chão o piso que ela vê: sai um mosaico visto de cima, para desenhar a planta por cima. O volume fiel sai de uma filmagem da loja com o celular | marcar pontos no piso, uma vez por câmera |
| **4. As pessoas na planta, ao vivo** | **dá, com erro a medir** | detectar a pessoa nas câmeras de canto e projetar o pé dela no piso | calibração por pontos; o computador da loja olhando várias vezes por segundo, e não a cada 30 s |
| **5. Cada pessoa com o nome, o expediente inteiro** | **a parte difícil** | nenhuma câmera segura "quem é quem" por horas numa cozinha de uniforme igual. O nome vem de fora da imagem: o ponto, a escala, o posto | a decisão do dono sobre de onde vem a identidade |

**O que eu recomendo:** fazer em degraus, cada um útil sozinho — (1) a planta em 3D com a
câmera simulada, que já serve para decidir onde pôr câmera; (2) o movimento **por posto**,
sem nome, que já mostra onde a loja trabalha e onde ninguém passa; (3) as figuras ao vivo;
(4) o nome, vindo do ponto e da escala do Regem, mostrado como "provável". Rosto, não.

## 1 · O que o Farol já tem

- **A planta em metros** (`web/lib/planta.ts`, `api/src/planta.ts`, `contratos/planta.json`):
  ambientes retangulares, móveis com altura, e cada câmera com posição, altura (2 a 4 m),
  direção, abertura (40° a 120°) e alcance. É dela que sai a conta de cobertura — o que
  nenhuma câmera vê — e a frase que descreve o lugar de cada câmera.
- **Uma vista em perspectiva**, desenhada à mão (uma projeção sobre o desenho plano): os
  móveis aparecem em pé. Não é 3D de verdade: não tem luz, sombra nem câmera que se move.
- **A base de equipamentos**, que guarda a lente em milímetros de 8 dos 16 modelos de câmera
  — e de nenhum o ângulo. Na planta, a abertura é escolhida à mão, com a dica "2,8 mm abre
  perto de 100°; 3,6 mm, perto de 80°".

O que falta para a planta viva: a **inclinação** da câmera (hoje a planta só sabe para onde
ela aponta no chão), o **ângulo da lente** por modelo, o volume desenhado de verdade e as
pessoas.

## 2 · O ambiente em 3D

Três caminhos, que se somam:

| caminho | o esforço em cada loja | o resultado | serve para muitas lojas? |
|---|---|---|---|
| **a) reconstruir das próprias câmeras** | nenhum | geometria grosseira; com poucas câmeras fixas, não é confiável para desenhar | só como apoio |
| **b) filmar a loja com o celular** | uma visita, uns minutos andando com o celular | fotográfico — a loja como ela é | camada opcional; envelhece quando a loja muda de lugar um equipamento |
| **c) dar volume à planta e usar peças prontas** | nenhum: a planta já existe | o "jogo" limpo, igual em toda loja | **sim** |

**Recomendo (c) como o padrão do produto e (b) como camada "foto", opcional.** Só (c) entra
numa loja nova sem visita e sem depender de licença de terceiro.

- **A tela:** React Three Fiber sobre three.js (licença MIT, conferida em 10/10), que encaixa
  no console de hoje (Next). A documentação dá o teto de trabalho: cada peça desenhada é uma
  chamada, "não mais que 1.000 no máximo, e de preferência algumas centenas"; peças repetidas
  desenham-se juntas; e desenhar só quando algo muda "economiza bateria" [9]. Uma loja com
  dezenas de equipamentos, câmeras e pessoas cabe com folga — **a medir no celular**.
- **As peças:** bibliotecas de uso livre (CC0), como Kenney e Quaternius, que têm conjuntos
  de interior, de restaurante e de personagens animados [14]. Para o acabamento que o dono
  pediu, o caminho é uma biblioteca **própria**, pequena e no mesmo estilo — chapa,
  fritadeira, bancada, cuba, balcão, geladeira, pia —, feita uma vez e usada em toda loja.
- **O que dá a cara de jogo:** luz e sombra suaves, materiais com brilho (o inox), a câmera
  que gira e aproxima com o dedo, e a passagem contínua entre "planta" e "3D" — a mesma cena
  vista de cima.
- **A camada "foto" (b):** o celular gera a cena no próprio aparelho, sem sensor especial, e
  exporta num formato aberto (SPZ) [12]; um leitor de código livre (Spark, MIT) mostra a cena
  dentro do mesmo desenho, misturada com as peças [13]. O preço do aplicativo não foi
  reconferido: a página do produto fala em planos.
- **Reconstruir das câmeras (a):** há modelos que tiram geometria de poucas imagens, mas boa
  parte tem licença só para pesquisa (DUSt3R e MASt3R); o que pode ser usado em produto
  (MapAnything, Apache-2.0, conferida) entrega geometria aproximada — serve para **ajudar a
  calibrar**, não para desenhar a loja.

## 3 · A imagem de cada câmera, simulada

Com o ambiente em 3D, cada câmera da planta vira uma câmera virtual no mesmo lugar, com o
ângulo da lente do modelo. A tela mostra "o que esta câmera veria daqui" — **antes de furar
a parede**. Três usos:

1. **Projetar a instalação:** mover a câmera na planta e ver o quadro mudar; a conta de
   cobertura, que hoje é um leque no chão, passa a considerar o que o móvel esconde.
2. **Calibrar:** pôr a imagem simulada por cima do quadro real do canal. Onde as duas não
   batem, a posição, a altura ou a inclinação cadastrada está errada.
3. **Explicar:** quem configura vê por que um critério não funciona naquele canal ("daqui a
   pia não aparece").

A categoria existe como programa de computador para projetistas: o JVSG mostra as zonas de
cada câmera numa planta e tem base de mais de 23 mil modelos [16]. No Farol ela nasce dentro
do console, sobre a planta e a base de equipamentos que já temos.

**O que pede:** a **inclinação** de cada câmera na planta (campo novo; a altura já existe) e
o **ângulo da lente** de cada modelo na base de equipamentos — que só afirma o que o manual
do modelo diz, e hoje traz a lente em milímetros de metade dos modelos.

## 4 · Montar o ambiente pelas imagens das câmeras

É o pedido "de acordo com as imagens das câmeras". O que é realista hoje:

- **O piso, sim.** Marcados alguns pontos do chão na imagem e na planta, cada câmera passa a
  saber onde cada ponto do piso que ela vê fica na planta. Juntando as câmeras, sai um
  **mosaico do piso visto de cima** — a foto do chão da loja, em escala —, e a planta é
  desenhada por cima dele, em vez de medir parede por parede. Quem faz isso em produto pede
  de **8 a 15 pontos por câmera, no mínimo 8** [2].
- **Os móveis, em parte.** O que encosta no piso aparece no mosaico pelo contorno. A altura
  e a forma não saem daí.
- **O volume inteiro, sozinho, não.** Com poucas câmeras fixas, cada parte da loja é vista
  de um lado só; a reconstrução automática erra onde não vê. Para o ambiente fiel, o caminho
  é a filmagem com o celular (seção 2, b).

A mesma calibração por pontos é a base da seção 5. Faz-se uma vez por câmera — e de novo se
a câmera for mexida.

## 5 · As pessoas na planta

**Como se faz.** Em cada câmera de canto, um detector acha a pessoa e os pontos do corpo;
o **tornozelo** é projetado no piso pela calibração; um acompanhador liga a pessoa de um
quadro ao seguinte; e as câmeras são ligadas entre si pela **posição no piso e pela hora**,
não pela aparência.

**O erro, medido por quem fez** (estudo de 06/2026, três câmeras nas bordas de uma área de
5,5 × 3 m, 24 pontos de calibração, tornozelo pelo MediaPipe [1]):

| situação | erro |
|---|---|
| pessoa parada, por eixo, em cada câmera | de 3,6 a 13,2 cm |
| pessoa andando, uma câmera só | 15,8 a 19,0 cm |
| pessoa andando, as três câmeras juntas | 13,9 cm |

É área aberta. **Numa cozinha, o que estraga a conta é o pé escondido.** A projeção supõe que
o ponto visto está no chão; se a bancada tapa o pé e o que se vê é a borda dela, o ponto vai
parar longe. Conta de geometria, não medida: com a câmera a 2,7 m e a bancada a 0,9 m, o
ponto cai **50% mais longe** — a 4 m da câmera, 2 m de erro. Por isso:

- cada pessoa precisa ser vista por **mais de uma câmera**, e vale a que enxerga o pé;
- sem pé à vista, projeta-se pela cabeça, com a altura da pessoa (erro de uns 10% da
  distância);
- a câmera de cima da bancada não acha gente (de cima o detector de hoje vê mão e braço),
  mas **confirma a ocupação** do posto, pelo movimento.

Longe da câmera o erro também cresce — conta de geometria: 10 pixels de erro no pé valem 6 a
9 cm a 3 m, 16 a 24 cm a 6 m e 40 a 60 cm a 10 m, numa lente de 110° em imagem de 1.920
pontos de largura.

**Acompanhar custa pouco; manter a identidade é que é difícil.** No conjunto de teste em que
todos se vestem igual (DanceTrack), o mesmo acompanhador que vai bem na rua desaba [3]:

| | na rua (MOT17) | todos de roupa igual |
|---|---|---|
| achar as pessoas | 64,5 | **71,0** |
| manter quem é quem (associação) | 62,0 | **32,1** |
| identidade ao longo do vídeo (IDF1) | 77,3 | **53,9** |

Achar continua fácil; **trocar uma pessoa pela outra é o que acontece** — e cozinha é
uniforme igual, espaço apertado e gente se cruzando. A aparência não segura a identidade:
quem segura é a geometria (onde cada um está no piso) e as âncoras da seção 6.

**O que se usa, e o que não se pode usar** (licenças conferidas em 10/10 na página de cada
projeto):

| serve | licença | não serve | licença |
|---|---|---|---|
| `roboflow/trackers` (ByteTrack, OC-SORT) | Apache-2.0 | `boxmot` | AGPL-3.0 |
| `ifzhang/ByteTrack`, `noahcao/OC_SORT` | MIT | StrongSORT e DeepSORT originais | GPL-3.0 |
| `roboflow/supervision` | MIT | modelos de reidentificação treinados em bases só de pesquisa | a conferir caso a caso |

**O que isso pede do computador da loja.** Hoje o Farol olha cada canal a cada 30 segundos.
Para pôr gente na planta é preciso olhar **várias vezes por segundo**, o tempo todo, nas
câmeras de canto — pelo fluxo menor. O detector da loja leva hoje de 85 a 95 ms por olhada
(medido). Quantas câmeras o computador da loja aguenta assim, ao lado do que ele já faz,
**não foi medido**: é a primeira pergunta da prova (seção 8).

## 6 · Quem é quem

| de onde vem o nome | o que dá | o que custa | observação |
|---|---|---|---|
| **o ponto e a escala** — quem bate o ponto num lugar conhecido "batiza" o trajeto que está ali; a escala diz quem está em qual posto | o nome enquanto o acompanhamento não se perde; a cada evento, reconfirma | nada de aparelho; a porta de leitura do Regem | é como se liga pessoa a acontecimento sem biometria: a loja sem caixa da Amazon "não coleta nem usa nenhuma informação biométrica" — liga a pessoa ao meio de pagamento na entrada [4] |
| **o posto** — sem nome: "o posto da chapa", "quem está na montagem" | por posto, sempre | nada | é o que o projeto faz desde o começo |
| **um sinal no uniforme** — cor por função, número por pessoa | por função; por pessoa só com número visível | uniforme | depende de a câmera ler o sinal: a medir |
| **crachá por rádio** (Bluetooth; banda ultralarga) | 1 a 5 m no Bluetooth; dezenas de centímetros na banda ultralarga, com antenas na loja | aparelho por pessoa e antenas | números de fornecedor, não conferidos |
| **o rosto** | o nome direto | — | **não recomendo** (abaixo) |

**O que o projeto já tinha decidido.** O documento de arquitetura diz: "O Farol não identifica
pessoas" — sem reconhecimento facial, e os nomes, quando existirem, vêm do cruzamento com a
escala do Regem (`FAROL-Mapeamento-Arquitetura-e-Orcamento.md`, seções 10.4 e 18). A planta
viva, como o dono descreveu, **revê isso**: põe o nome na tela. (O caminho é
`docs/FAROL-Mapeamento-Arquitetura-e-Orcamento.md`.)

**O que eu recomendo.**

1. **Nasce por posto, sem nome.** É o degrau que já serve para decidir — onde a loja
   trabalha, onde ninguém passa, onde se cruza demais — e não depende de identidade.
2. **O nome vem do ponto e da escala do Regem**, e aparece como **"provável"**: firme logo
   depois de um evento, em dúvida depois de uma troca possível, firme de novo no evento
   seguinte. A tela não finge certeza que não tem.
3. **É opção da loja, desligada de fábrica** — como todo o resto que o piloto ensinou
   (decisão de 10/10: o piloto não vira regra do motor).
4. **Sem rosto e sem "jeito de andar".** Além do custo, é o que a lei trata como dado
   sensível (seção 7).

**As duas decisões que são do dono:**

- **De onde vem a identidade** — recomendo o ponto e a escala do Regem.
- **Onde a planta viva entra na ordem** — recomendo o estudo e o protótipo já, em paralelo,
  e o motor na ordem atual (ondas 9 e 10): o degrau 1 não depende de nada; os degraus 3 e 4
  dependem da sequência (onda 2) e do computador da loja aguentar.

## 7 · A lei, em duas notas

Pela regra do dono, a LGPD fica para o fim do desenvolvimento. Ficam só dois pontos que
**decidem o desenho** — não é parecer jurídico, e vai a advogado antes de virar produto:

- **Câmera de segurança cabe no "legítimo interesse", com cuidados** — acesso restrito aos
  vídeos, prazo curto de guarda, aviso à vista, relatório de impacto — e **sem** "tecnologias
  que tratem as imagens a nível biométrico, levando assim ao tratamento de dados sensíveis"
  (guia da ANPD, fev/2024, exemplo 4) [5]. O mesmo guia diz que o legítimo interesse **não se
  aplica a dado sensível**.
- **Medir produtividade de empregado é onde a ANPD vê excesso.** No exemplo 7, um programa
  que rastreia a atividade dos funcionários para medir produtividade "interfere de forma
  excessiva e desproporcional" — mesmo avisado —, porque na relação de emprego o empregado
  não tem "meios efetivos de oposição" [5]. O exemplo é de computador (webcam e teclado), não
  de câmera de ambiente; a direção é a mesma.

Para a planta viva: **por posto e agregado** é o chão seguro; o nome, por âncora de evento
e desligável por loja; rosto e jeito de andar, não.

## 8 · A prova barata, no piloto

Antes de construir, medir. Uma noite de gravação responde às três perguntas que decidem:

1. **Quanto erra a posição** nesta loja, com estas câmeras?
2. **Por quanto tempo o acompanhamento segura a mesma pessoa** no pico, sem trocar?
3. **O computador da loja aguenta** olhar várias vezes por segundo?

**O que pede da loja, uma vez (uns 20 minutos, antes de abrir):**

1. Marcar **15 a 20 pontos no piso** com fita, espalhados — inclusive atrás das bancadas — e
   medir cada um com trena a partir de duas paredes.
2. Uma pessoa **para uns 10 segundos em cada ponto** e depois anda um caminho combinado;
   repete com duas pessoas se cruzando.
3. A gravação daquela noite fica no gravador, como sempre.

**O que eu faço com isso**, sem nuvem: calibro com 8 a 12 pontos e confiro com os outros;
comparo "pé" contra "base da caixa"; meço o erro por câmera e por zona (pé à vista, pé
escondido); anoto à mão uma amostra do pico e conto as trocas por pessoa por hora.

**A régua que eu sugiro:** 95% das posições a até 50 cm onde o pé aparece; e o
acompanhamento durando, na mediana, mais do que o intervalo entre duas âncoras (dois eventos
de ponto ou de posto). Se não passar, a planta viva fica no degrau 2 (por posto) nesta loja —
e isso já é produto.

## 9 · Em degraus

Cada degrau entrega algo sozinho, e cada loja para no degrau que as câmeras dela permitem:

| degrau | o que entrega | depende de |
|---|---|---|
| **1 · A planta em 3D e a câmera simulada** | ver a loja, decidir onde pôr câmera, achar o que nenhuma cobre | a planta desenhada; a inclinação de cada câmera |
| **2 · O movimento por posto** | onde a loja trabalha, hora a hora: ocupação e passagem, sem nome | o que o Farol já mede (presença e movimento por quadro) |
| **3 · As figuras ao vivo** | cada pessoa como uma figura andando na planta, sem nome | calibração por pontos; a prova da seção 8; o computador da loja aguentar |
| **4 · O nome** | "provável: fulano", pelo ponto e pela escala | a decisão do dono; a porta de leitura do Regem; a loja ligar |

## 10 · O mercado

| quem | desde | porte | o que mostra | conferido em 10/10 |
|---|---|---|---|---|
| NVIDIA, aplicação de localização em tempo real | 2023 (o fluxo multicâmera) | referência para integradores | pontos andando na planta, cada um com um número e o rastro colorido; 8 câmeras, 4 com o modelo mais pesado | sim, na documentação [6] — o ano, não |
| Verkada | 2016 | cerca de 30 mil clientes | mapa de calor de pessoas sobre a planta, com as câmeras calibradas | o recurso, sim [7]; o porte, não |
| RetailNext | 2007 | mais de 600 varejistas, mais de 100 países, 100 mil sensores | contagem, jornada do cliente, mapa de calor | sim [8] |
| JVSG | — (clientes citam uso desde 2010) | base de mais de 23 mil modelos de câmera | as zonas de cada câmera numa planta, com modelos em 3D | sim [16] |
| Amazon, loja sem caixa | — | — | liga a pessoa ao pagamento na entrada, sem biometria | sim [4] |
| PreciTaste | 2012 | milhares de cozinhas (3.700 numa fonte, mais de 7.000 em outra) | o nível das cubas e o que produzir | o que faz, sim [15]; o porte e o ano, **não** |

**Leitura:** a pesquisa não achou quem venda, para cozinha, a figura **identificada**
andando em 3D. O mais perto é o ponto numerado da NVIDIA e o mapa de calor da Verkada. É
espaço de produto — e é também um aviso: quem está mais adiantado mostra **onde**, não
**quem**.

## 11 · O que não foi medido

- O erro de posição **nesta loja** — tudo o que está na seção 5 é de outro lugar ou é conta.
- Quanto tempo o acompanhamento segura a identidade no pico, com este uniforme.
- Quantas câmeras o computador da loja acompanha várias vezes por segundo.
- O desenho em 3D no celular do dono: quantas peças, com que fluidez.
- Se a câmera lê um sinal no uniforme.
- O erro do "pé" tirado dos pontos do corpo nas câmeras da loja (o estudo citado usou outras).
- Um número da pesquisa **não bateu** na conferência e ficou de fora: o "erro da calibração
  de 2,5 a 6,1 cm" atribuído ao estudo [1] — o texto não traz esse número.

## Fontes

Reconferidas por mim em 10/10/2026 (abertas e lidas de novo), salvo onde diz o contrário. A
pesquisa completa, com 82 fontes, foi feita por um agente de busca no mesmo dia; o que não
foi reconferido está marcado.

1. "Measurement-Calibrated Multi-Camera Fusion for Vision-Based Indoor Localization", Toro
   Diz, Hoss e Klarmann, 11/06/2026 — <https://arxiv.org/html/2606.13509v1>
2. NVIDIA, calibração de câmeras para acompanhamento multicâmera, 27/08/2024 —
   <https://developer.nvidia.com/blog/simplifying-camera-calibration-to-enhance-ai-powered-multi-camera-tracking>
3. DanceTrack, tabela 3 (ByteTrack em MOT17 e em DanceTrack) —
   <https://ar5iv.labs.arxiv.org/html/2111.14690>
4. Just Walk Out, perguntas frequentes — <https://justwalkout.com/faq>
5. ANPD, "Hipóteses legais de tratamento de dados pessoais — legítimo interesse", guia
   orientativo, fev/2024, exemplos 4 (p. 14–15) e 7 (p. 24–25); lido no PDF —
   <https://tce.pb.gov.br/wp-content/uploads/2025/03/guia_legitimo_interesse.pdf> (cópia
   hospedada por um tribunal de contas; a página da ANPD recusou a leitura)
6. NVIDIA, aplicação RTLS —
   <https://docs.nvidia.com/mms/text/MDX_Real_Time_Location_System_App.html>
7. Verkada, mapa de calor de pessoas na planta —
   <https://help.verkada.com/command/organization-settings/buildings-and-floors/people-heat-maps-for-floor-plans>
8. RetailNext — <https://retailnext.net/about/who-we-are>
9. React Three Fiber, desempenho — <https://r3f.docs.pmnd.rs/advanced/scaling-performance>
10. Licenças, pela página de cada projeto no GitHub: `roboflow/trackers` (Apache-2.0),
    `ifzhang/ByteTrack`, `noahcao/OC_SORT`, `roboflow/supervision`, `pmndrs/react-three-fiber`,
    `mrdoob/three.js`, `sparkjsdev/spark` (MIT), `facebookresearch/map-anything` (Apache-2.0),
    `mikel-brostrom/boxmot` (AGPL-3.0), `dyhBUPT/StrongSORT` e `nwojke/deep_sort` (GPL-3.0)
11. DUSt3R e MASt3R, licença só para uso não comercial — **não reconferido** —
    <https://github.com/naver/dust3r>
12. Scaniverse — <https://nianticspatial.com/products/scaniverse> (gera a cena no aparelho,
    sem sensor especial, e exporta SPZ: conferido; o preço, não)
13. Spark — <https://github.com/sparkjsdev/spark> (a licença, conferida; os formatos que lê,
    **não reconferidos**)
14. Kenney e Quaternius, peças CC0 — **não reconferido** — <https://kenney.nl/support> ·
    <https://quaternius.com/faq.html>
15. PreciTaste — <https://precitaste.com/qsr/> (a página não traz número de instalações)
16. JVSG — <https://www.jvsg.com/software/ip-video-system-design-tool/>
