# Frigate — estudo

> **Situação: ESTUDO.** Nada daqui está construído nem decidido. É o
> levantamento para o dono escolher o que fazer. Data: 07/10/2026.
>
> Fontes: a documentação oficial (`docs.frigate.video`, versão **0.18**), o
> repositório (`github.com/blakeblackshear/frigate`, tag `v0.18.0`) e as
> páginas do Frigate+. Cada afirmação leva o link; no fim está o que **não**
> foi possível confirmar.

## A pergunta do dono

> Faça um estudo da API do Frigate e o que podemos usar dela, se tem custos,
> o que podemos agregar ao projeto.

## A resposta em quatro linhas

1. **O Frigate é um gravador com detecção de objetos**, de código aberto e
   gratuito, feito para rodar em Linux, processando o vídeo de todas as
   câmeras o tempo inteiro. A API dele é completa e bem documentada.
2. **Ele não substitui o agente do Farol**: não roda oficialmente em Windows,
   não usaria a placa de vídeo do PC da loja, e não julga critério escrito em
   português ("a bancada está limpa") — só reconhece objetos de uma lista
   fixa.
3. **Custo**: o programa é grátis. O que custa é a máquina (Linux, de
   preferência com acelerador) e a manutenção. O serviço pago deles
   (Frigate+, US$ 50 por ano) **não pode ser usado em loja de cliente** sem
   uma licença comercial à parte, cujo preço não é público.
4. **O que vale trazer para o Farol são três ideias dele, feitas por nós**,
   sem instalar o Frigate: ensinar um "estado" com exemplos da própria loja,
   disparar a análise por movimento na área, e medir permanência seguindo o
   objeto. As três atacam itens que já estão na nossa lista (A15).

## 1. O que é o Frigate

- Projeto de código aberto, muito usado (36 mil estrelas no GitHub), ainda em
  versão 0.x. A última estável é a **0.18.0**, de 12/09/2026
  ([releases](https://github.com/blakeblackshear/frigate/releases)).
- O público declarado é doméstico: "The most popular NVR for privacy focused
  home automation enthusiasts" ([frigate.video](https://frigate.video/)).
- Como funciona: lê o vídeo de cada câmera continuamente, procura movimento,
  e onde há movimento roda um detector de objetos (pessoa, carro, garrafa…).
  Segue cada objeto enquanto ele está no quadro, sabe em que **zona** ele
  entrou e por quanto tempo ficou, grava o vídeo e guarda um "evento" por
  objeto.
- Tudo roda na máquina local: "your camera feeds never leave your home".

### Onde ele roda — e onde não roda

| | o que a documentação diz | para o PC da loja (i7-10700F, 16 GB, Radeon RX 560, Windows 10) |
|---|---|---|
| Sistema | instalação recomendada: Docker em Linux (Debian) direto na máquina. **"Windows is not officially supported"** — alguns conseguem com WSL ou VirtualBox ([instalação](https://docs.frigate.video/frigate/installation)) | fora do suporte oficial |
| Máquina virtual | "is not recommended" (mesma página) | o único jeito num Windows |
| Placa de vídeo | AMD só pela imagem `-rocm`; a lista da AMD não inclui a geração da RX 560 ([matriz ROCm](https://rocm.docs.amd.com/en/latest/compatibility/compatibility-matrix.html)) | a RX 560 **não seria usada** |
| Processador | precisa de AVX2 (o i7 tem); detecção em processador é "generally not recommended" ([hardware](https://docs.frigate.video/frigate/hardware)) | rodaria tudo no processador |
| Memória | 8 GB no mínimo com os recursos extras; 16 GB recomendado para 8 câmeras ou mais ([planejamento](https://docs.frigate.video/frigate/planning_setup)) | no limite |

Ou seja: para usar o Frigate de verdade numa loja seria **outra máquina**
(Linux, idealmente com acelerador Hailo, GPU Intel ou Nvidia), não o PC que
já está lá.

## 2. A API — o que ela oferece

Há especificação pronta (OpenAPI 3.1): <https://docs.frigate.video/frigate-api.yaml>.
Todos os caminhos ficam sob `/api`. A porta `8971` é autenticada (login com
usuário e senha devolve um token); a `5000` é interna, sem senha
([autenticação](https://docs.frigate.video/configuration/authentication)).

| grupo | para que serve | exemplos |
|---|---|---|
| **Eventos** (objetos seguidos) | o que apareceu, onde, quando, por quanto tempo, em que zonas | `GET /events` (filtros por câmera, rótulo, zona, horário), `GET /events/{id}`, `GET /events/summary` |
| **Criar evento por fora** | um sistema externo registra um evento e pede o clipe | `POST /events/{camera}/{label}/create` |
| **Revisão** | períodos com atividade, separados em "alerta" e "detecção" | `GET /review`, `GET /review/summary` |
| **Gravações e exportação** | listar, cortar e baixar trechos | `GET /{camera}/start/{ini}/end/{fim}/clip.mp4`, `POST /export/...` |
| **Imagens** | último quadro, quadro de um instante gravado, foto e clipe de um evento | `GET /{camera}/latest.jpg`, `GET /events/{id}/snapshot.jpg` |
| **Busca** | por semelhança/descrição (roda local) e por **movimento numa região** de uma gravação (novo na 0.18) | `GET /events/search`, `POST /{camera}/search/motion` |
| **Estatísticas** | processador, memória, placa de vídeo, velocidade do detector, quadros por segundo de cada câmera | `GET /stats`, `GET /metrics` (formato Prometheus) |
| **Configuração** | ler e alterar, ligar e desligar recursos por câmera | `GET /config`, `PUT /camera/{camera}/set/{recurso}` |
| **Classificação e IA** | treinar classificador próprio, gerar descrição por modelo de linguagem, "vigiar" uma condição | `POST /classification/{nome}/train`, `POST /vlm/monitor` |

Além da API há o **MQTT**, que é por onde ele avisa em tempo real
([MQTT](https://docs.frigate.video/integrations/mqtt)): `frigate/events`
(objeto novo, atualizado, terminado, com as zonas), `frigate/<zona>/<objeto>`
(quantos há agora na zona), `frigate/<camera>/motion`,
`frigate/<camera>/classification/<modelo>` (o estado mudou) e
`frigate/stats`.

O que **não** tem: webhook (só notificação de navegador, e só para alertas),
agendador, horário de funcionamento, contagem acumulada, cruzamento de linha.
"Frigate is an NVR, not an automation platform"
([perfis](https://docs.frigate.video/configuration/profiles)).

## 3. Custos

| | custo | observação |
|---|---|---|
| O programa | **grátis** — licença MIT | pode usar, modificar e até vender junto. A **marca não**: "You may not use 'Frigate' in the name of a commercial product, service, or app" ([marca](https://raw.githubusercontent.com/blakeblackshear/frigate/dev/TRADEMARK.md)). Dizer "compatível com Frigate" pode |
| A API | **grátis** — é do seu próprio servidor | não há cobrança por chamada |
| **Frigate+** (modelos melhores, treinados com as suas imagens) | US$ 50 por ano ([preço](https://frigate.video/plus/), visto em 07/10/2026) | **não serve para o Farol como está**: "What the standard subscription does not cover is using Frigate+ models to provide a product or service to others" — usar em loja de cliente, embutir em equipamento ou em serviço gerenciado exige licença comercial ([perguntas](https://docs.frigate.video/plus/faq)). Preço da licença comercial: **não publicado**. As imagens enviadas ficam com eles e entram no treino do modelo de todos |
| Máquina | o custo de verdade | Linux dedicado por loja; a documentação pede acelerador para mais de poucas câmeras; disco para gravação contínua |
| IA generativa (opcional) | de quem põe a chave | Gemini, OpenAI, Azure ou modelo local (Ollama). Não cita Claude |
| Manutenção | tempo nosso | uma versão a cada 6–7 meses, **todas** com mudança que quebra configuração (0.16, 0.17 e 0.18 quebraram) |

## 4. O que ele faz que o Farol ainda não faz

Estes são os itens da nossa lista (roteiro, A15) que o Frigate resolve do
jeito dele:

| o que falta no Farol | como o Frigate faz | o porém |
|---|---|---|
| **Evento de segundos** (a gaveta do caixa abriu) — hoje só há uma foto a cada 30 s | **classificação de estado**: um modelo pequeno (MobileNetV2) treinado com exemplos de um recorte fixo da câmera ("aberta" / "fechada"), que roda quando há movimento no recorte ou a cada N segundos ([estado](https://docs.frigate.video/configuration/custom_classification/state_classification)) | um modelo por caso, treinado com fotos rotuladas |
| **Referência da loja** ("isto é o certo, isto é o errado") | a mesma classificação de estado, e a de objeto (capacete, mochila, entregador) ([objeto](https://docs.frigate.video/configuration/custom_classification/object_classification)) | idem |
| **Tempo de permanência** no posto | segue o objeto: hora de entrada e de saída, zonas em que entrou, `loitering_time` (tempo mínimo parado na zona) ([zonas](https://docs.frigate.video/configuration/zones)) | só para objeto que o detector conhece |
| **Gatilho por movimento na área** | o movimento decide onde rodar a detecção; a classificação de estado tem `motion: true` por recorte | o aviso de movimento por MQTT é da câmera inteira, não da zona |
| **Busca em gravações** ("alguém pegou a sacola às 15h?") | busca por descrição/semelhança (local) e busca de movimento numa região desenhada | precisa que o Frigate grave o vídeo; a busca por descrição só cobre objetos que ele seguiu |
| **Contar produção** | dá para contar eventos que terminaram numa zona | sem contador pronto; o objeto precisa ser de classe conhecida |
| **Uso da máquina** | `GET /stats` | já fizemos o nosso (migration 021) |

E o que ele **não** faz, e é o centro do Farol:

- julgar critério escrito em linguagem natural ("uniforme completo",
  "bancada limpa entre pedidos");
- avaliar uma cena sem objeto de classe conhecida;
- a conta por hora de conforme / fora do critério / não deu para avaliar,
  o horário de funcionamento, o silêncio do aviso, o custo por análise.

A lista de objetos dele é a do COCO (pessoa, garrafa, copo, faca…) — a mesma
família do detector que já usamos. Nenhuma lista dele tem uniforme, touca,
luva, sacola de entrega, gaveta de caixa ou bancada.

## 5. Por que não trocar o agente pelo Frigate

1. **Windows.** O PC da loja é Windows; o Frigate não tem suporte oficial
   nele, e em máquina virtual a placa de vídeo "may be difficult or
   impossible" de repassar.
2. **Carga.** Ele precisa do vídeo contínuo: a 5 quadros por segundo são
   150 quadros decodificados por câmera a cada 30 s, contra **1** hoje. "Video
   decoding is one of the most CPU-intensive tasks in Frigate"
   ([processador](https://docs.frigate.video/troubleshooting/cpu)). Sem
   acelerador, isso disputa o processador com todo o resto.
3. **O gravador da loja.** Cada canal vira uma conexão de vídeo permanente
   no gravador Intelbras. O limite de conexões simultâneas não foi
   confirmado em fonte oficial — é risco a medir, não a supor.
4. **O que é nosso não está lá.** Critério em português, áreas com critério
   próprio, horário, contagem por hora, console — nada disso vem com ele.
5. **Manutenção.** Projeto 0.x que quebra configuração a cada versão, com
   foco em casa. Numa rede de lojas, cada atualização seria trabalho nosso.

## 6. O que agregar ao Farol

### A. Copiar três ideias, feitas por nós (recomendado)

Sem instalar o Frigate, sem licença, sem máquina nova. Em ordem de valor:

1. **Estado ensinado com exemplos da loja.** O dono marca um recorte e
   separa algumas fotos em "certo" e "errado"; o agente treina um
   classificador pequeno e passa a julgar aquele recorte **na loja**, em
   milissegundos e sem custo por análise. Resolve de uma vez três itens da
   A15: a referência da loja (6), o evento de segundos (7, porque dá para
   olhar a cada segundo) e parte do custo de nuvem (10). O que hoje vai ao
   modelo de nuvem por R$ 0,013 passaria a ser julgado local quando o caso
   for "um de dois estados".
2. **Gatilho por movimento na área.** Olhar com mais frequência só quando
   algo se mexe no recorte, e não julgar cena parada. É o item 7 da A15, e
   reduz análise de nuvem com a loja vazia.
3. **Permanência seguindo a pessoa.** Ligar as detecções de uma olhada à
   seguinte para dizer "ficou 4 minutos fora do posto", em vez de contar
   olhadas vazias. É o item 1 da A15 (mostrar tempo), feito direito.

### B. Conector opcional: o Farol lê um Frigate que já existe

Para a loja que **já tem** (ou aceita ter) uma máquina Linux com o Frigate:
o agente do Farol assina o MQTT e a API dele e transforma em critério —
"pessoa na zona do caixa", "quantos na zona da fila", "estado da gaveta" —
aproveitando o rastreamento e o vídeo contínuo que ele já faz. Não
redistribuímos nada; usamos o nome só como referência ("compatível com
Frigate"), o que a política de marca permite.

Custo: desenvolver e manter o conector, e conviver com as quebras de versão
deles. Só vale se houver cliente pedindo.

### C. Embutir o Frigate no produto (não recomendado agora)

A licença do código permite, mas: exige máquina Linux por loja, a marca não
pode ir no nome, os modelos do Frigate+ não podem ser usados, e a
manutenção passa a ser nossa. Reavaliar se um dia o Farol precisar de vídeo
contínuo em todas as câmeras.

## 7. Próximo passo sugerido

- **Decidir** se a ideia A.1 (estado ensinado com exemplos) entra no roteiro
  e em que posição. É a que mais muda o produto: tira da nuvem o que é
  "um de dois estados" e cobre evento de segundos.
- **Uma bancada de um dia**, se o dono quiser ver o Frigate funcionando:
  numa máquina Linux qualquer (ou máquina virtual, sabendo que é fora do
  suporte), ler **dois canais** do gravador pelo subfluxo e medir o uso de
  processador, a qualidade da detecção de pessoa e o comportamento do
  gravador com conexões permanentes. Não mexe em nada da loja além de ler o
  vídeo. Precisa do "pode" e de uma máquina.

## 8. O que não foi possível confirmar

- O **preço da licença comercial** do Frigate+ (os termos só dizem que existe).
- O **limite de conexões de vídeo simultâneas** do gravador Intelbras/Dahua
  em fonte oficial.
- O **desempenho em processador** no i7-10700F e o uso de processador por
  câmera — a documentação não dá número.
- Se roda bem em **Docker Desktop/WSL2**; a documentação só diz "não
  suportado oficialmente".
- As **licenças dos modelos** e das dependências da imagem Docker, para o
  caso de redistribuir.
- Os campos de `GET /stats` vieram do código da versão 0.18, não de página
  de documentação.
- Os textos dos termos do Frigate+ foram lidos por resumo automático da
  página: antes de qualquer decisão jurídica, ler o original
  (<https://plus.frigate.video/terms-and-conditions/>).

## 9. Como foi feito

Levantamento em 07/10/2026 nas páginas oficiais, com o link ao lado de cada
afirmação. Três pontos que pesam na decisão foram abertos e conferidos uma
segunda vez: a falta de suporte a Windows, a licença do código com a marca
reservada, e a proibição de usar os modelos do Frigate+ em serviço para
terceiros. O Frigate não foi instalado nem testado.
