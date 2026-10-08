# Roadmap de implementação — Farol

Documento de trabalho. O que está feito, o que vem agora, e as interfaces que
fazem cada peça encaixar na próxima.

**Método:** construção contínua até a v1 de pé, com porta de teste só no fim de
cada bloco grande. Não se para para testar incremento — isso dispersa a lógica e
muda o rumo no meio.

---

## Onde estamos, e o alvo imediato (06/10/2026)

### A tese do produto, dita pelo dono

O Farol nasceu local, mas **análise de imagem tem variáveis demais e opções de
equipamento demais** — e o que decide não é a técnica, é **quanto o cliente
pode investir**.

Então a lógica de funcionamento é uma só, e **as variações se adaptam ao
equipamento**. Um cliente com R$ 20 mil e muitos canais e outro com um PC de
escritório e três câmeras rodam o mesmo produto, com caminhos diferentes por
dentro. O que o cliente não tiver, o sistema compensa — e o que ele precisar
providenciar vira tutorial, não impedimento.

O wizard é quem descobre qual caminho: intenção, estrutura do local, número de
canais, **orçamento disponível** e **gasto mensal aceitável com API** quando a
máquina não comporta modelo local grande.

### O que o banco já antecipava

Boa parte disso está no esquema desde a 001, e vale saber antes de projetar:

| tabela | o que já tem |
|---|---|
| `levantamento` | `intencao`, `n_cameras`, `tem_internet_estavel`, `imagem_pode_sair`, `precisa_offline`, `precisa_busca` |
| `levantamento_item` | **`specs_declaradas` × `specs_detectadas`** + `detectado_em` — o que o cliente diz ter contra o que a máquina confirmou |
| `diagnostico` | `custo_implantacao`, `custo_mensal`, `modo_julgamento_sugerido`, `analises_dia`, e os dois diagramas |
| `equipamento` + `equipamento_preco` | catálogo com preço |
| `requisito_uso` | px/cm, fps, cor, WDR e quadros por análise, por tipo de regra |

**Falta no `levantamento`:** `orcamento_disponivel` e `gasto_api_aceitavel` —
as duas variáveis que o dono pôs no centro e que o esquema não previu.

### Puxar dos equipamentos em vez de perguntar

`specs_detectadas` existe porque **o que o cliente declara erra**. Ele não sabe
se o canal entrega 1080p real ou 1080N esticado; não sabe a focal da lente; às
vezes não sabe quantos canais o gravador tem.

O agente já sabe medir quase tudo isso: `dvr info` (modelo e firmware),
`dvr canais` (quantos existem de verdade), `sondar` (`detalhe_real` **distingue
1080p nativo de 1080N esticado**). Falta ler as specs da **própria máquina** —
CPU, RAM, GPU — que é o que decide se cabe modelo local.

Medir vence perguntar, e o preview já provou isso: `resolucao_h` se preencheu
sozinha com a largura do quadro capturado.

### 🎯 O alvo imediato

**Três canais rodando por mais de uma semana**, com os erros sendo coletados e
lidos, para afinar o motor local e o da nuvem.

Não é "mais funcionalidade". É **a mesma coisa funcionando por tempo
suficiente para revelar o que uma tarde de teste esconde**: deriva, vazamento
de memória, fila que cresce, câmera que cai de madrugada, regra que dispara
demais.

### ✅ O que bloqueava, e saiu do caminho

**`farol-agent servir` agora roda o motor.** O que faltava em 06/10 era que ele
sincronizava configuração e atendia comandos, e só — o motor existia e era
testado, mas só no `laco`, contra material gravado com gatilho simulado. As
duas metades estão juntas, numa thread própria, para que a auditoria nunca
atrase o heartbeat.

**O alerta tem para onde ir.** A7 fechada: política em tabela, transporte pelo
Regem/n8n, e o vigia que avisa quando um agente para de bater — porque agente
calado significa loja não auditada com console verde.

### 🔴 O que ainda bloqueia o alvo

| bloqueio | natureza |
|---|---|
| detector local só cobre 17 objetos | presença e contagem já são julgadas na loja (A10); objeto fora da lista — a espátula — e `comparacao` ainda esperam a fase das fotos de referência |
| nenhum critério rodando na loja | os dois cadastrados em 06/10 ("Copo" e "Produto") nasceram antes dos campos do detector e ficam de fora até serem editados. "Produto" pede contagem de **produção**, que não existe — ver A10 |
| rosto reconhecível em imagem que sai da loja | o borrão só apaga o rosto que o detector acha: 3 de 8 canais com gente (A11). **Bloqueia ligar critério de nuvem** numa loja; não bloqueia presença e contagem, que não saem dela |
| nenhum destino de alerta cadastrado | passo do dono, **Loja → Alertas** |
| dois canais configurados | o alvo pede três; o ponto "Bancada" ainda aponta para o endereço antigo do gravador |

Saíram desta tabela em 06/10/2026: a migration 012 (aplicada), a 013
(aplicada) e o agente anterior ao conserto do evento — o que roda agora é o
do PC da loja, com o código da `main`.

### ⚠️ O caminho do evento nunca tinha sido percorrido (06/10/2026)

Ao preparar o critério em vários canais, o caminho "agente → evento gravado na
nuvem" foi percorrido até o fim pela primeira vez — a única regra ligada em
produção era de `presenca`, que não sai da loja. Estavam nele:

| defeito | efeito | registro |
|---|---|---|
| o agente mandava `idempotencia_key`, a API esperava `idempotenciaKey` | **toda** subida de evento recusada com 422 | ERR-018 |
| evento que não subia na hora era descartado com a variável | internet fora por um minuto = evento perdido | ERR-019 |
| o motor aplicava cada critério a todos os canais | com 3 canais, 2/3 das análises sobre a imagem errada, e pagas | ERR-020 |
| a API declarava `criterio_versao`/`imagem_hash` e não os copiava do corpo | a migration 010 nunca recebeu dado | ERR-021 |
| hora do evento sem fuso | gravada três horas fora, sem erro | ERR-022 |

Corrigidos no PR #32, com `contratos/evento-do-agente.json` lido pelos testes
dos DOIS lados e uma prova ponta a ponta (cliente HTTP real do agente contra a
API real): na `main`, 4 enfileirados e 0 entregues; no PR, 2 e 2.

**A lição que fica no desenho:** cada lado era testado contra um dublê de si
mesmo. Toda mensagem que atravessa a fronteira agente↔nuvem ganha um arquivo
em `contratos/`, com um teste de cada lado lendo o mesmo arquivo.

### Histórico do que já não bloqueia

**`servir` sem motor** (resolvido em 06/10).

Ou seja: hoje o agente **conversa com a nuvem e captura preview, mas não
audita nada**. Ligar uma regra não faria diferença.

Juntar as duas metades é o próximo trabalho, e é maior que as lacunas
pequenas:

1. O gatilho CGI real (`GatilhoCGI`, provado contra o MHDX) alimenta o motor
2. O motor usa as regras que **desceram da nuvem**, não o YAML
3. A fila persiste e o juiz julga
4. O evento sobe para `POST /v1/eventos`
5. Nada disso pode atrapalhar o heartbeat nem a captura de preview

### Ordem acordada

| # | o quê | por quê | estado |
|---|---|---|---|
| 1 | lacunas pequenas: editar ponto, renomear zona, status do agente | removem atrito imediato e são rápidas | ✅ |
| 2 | `evento.criterio_versao` + `imagem_hash` | só é barato enquanto não há evento gravado | ✅ mig. 010 |
| 3 | **ligar o motor no `servir`** | é o que destrava o alvo de 3 canais | ✅ |
| 4 | A7 · alertas | transforma "o Farol viu" em "alguém soube" | ✅ mig. 011 · PR #30 |
| 5 | wizard com orçamento e auto-detecção | quando houver o que dimensionar | ⬅️ aqui |

---

## Estado

| Bloco | Estado |
|---|---|
| **A1 · Fundação e contrato** | ✅ feito |
| **A2 · Agente** | ⬅️ aqui — A2.1, A2.2 e A2.4 feitos; **A2.3 espera o DVR (06/10)** |
| A3 · Console | — |
| A4 · Inteligência avançada, MCP e DMS | — |
| **Porta · v1 de pé** | — |
| B · Implementar e testar | — |

### A1 — o que ficou pronto

- Repo `farol` com os quatro módulos, estrutura de monorepo
- `database/migrations/001_estrutura_inicial.sql` — modelo completo da v1,
  incluindo o que só será usado nas camadas finais
- `docs/decisoes.md` — 12 decisões registradas com data e motivo
- `docs/licencas.md` — as sete armadilhas que inviabilizam produto revendido
- Protótipo preservado em `prototipo/` como referência histórica

### A1 — fechado em 04/10/2026

- **Banco no ar:** Postgres 17 + pgvector 0.8.7 na VPS própria, serviço
  `farol-db`. Supabase foi descartado — o Farol grava série temporal de evento e
  embedding, e a VPS já paga tem folga de sobra.
- **`farol-api` no ar** (`17e788b`): Fastify, `/saude` informando a última
  migration aplicada, e o runner `api/scripts/migrar.mjs`.
- **Migrations 001 e 002 aplicadas** por `npm run migrar` dentro do contêiner.
  Migration passa a viajar pelo deploy, nunca por paste; ver `decisoes.md` 04/10.

### A1 — fechado em 05/10/2026

- **`farol-web` NO AR** em `app.monitorfarol.com.br`, com login funcionando.
- **CI em quatro jobs**: api (com Postgres real), web, agente e as duas imagens.
- **Backup diário** no Backblaze B2, conferido dentro do bucket.
- O domínio `api.` **não é mais necessário**: o Next faz proxy da API pela rede
  interna, então a API nunca é exposta à internet.

### A1 — pendência conhecida

- ⚠️ `app.monitorfarol.com.br` está com **Configuration Rule em `Full`** na
  Cloudflare porque o Traefik não emitiu certificado para esse host. Contorno,
  não estado final — ver ERR-007. Quando o certificado sair, apagar a regra e
  voltar o host para `strict`.

---

## A2 — O agente

O maior bloco. Quatro entregas, cada uma testável sozinha, cada uma usando a
anterior. Tudo em Python, empacotável com PyInstaller one-dir.

### Princípio de desenho: três abstrações

O agente tem três pontos onde a implementação varia por loja, por câmera ou por
plano. Esses três viram interface, e o resto do código não sabe qual é a
implementação concreta. É o que permite construir o escopo completo sem
condicional espalhada.

```python
# 1 · de onde vem a imagem
class FonteVideo(Protocol):
    def quadro(self, ts: datetime, stream: Literal['main','sub']) -> Frame: ...
    def intervalo(self, ini: datetime, fim: datetime, fps: float) -> Iterator[Frame]: ...
    # implementações: FonteRTSP · FonteUSB · FonteSandbox

# 2 · o que avisa que algo aconteceu
class Gatilho(Protocol):
    def escutar(self) -> Iterator[EventoGatilho]: ...
    # implementações: GatilhoWebhook (ISAPI) · GatilhoCGI (DVR) · GatilhoDetector (RF-DETR)

# 3 · quem dá o veredito
class Juiz(Protocol):
    def julgar(self, quadros: list[Frame], regra: Regra, contexto: dict) -> Veredito: ...
    # implementações: JuizNuvem · JuizLocal · JuizComparacao · JuizBinario
```

`EventoGatilho` carrega ponto, zona, timestamp e, quando a fonte souber, a
classe detectada. `Veredito` carrega resultado, confiança, motivo, custo,
latência e a proveniência — modelo e via.

---

### A2.1 · Esqueleto, sandbox e pipeline de quadro

Sem julgamento ainda. A base que tudo o mais usa.

- Núcleo: carrega configuração, cofre de segredos com DPAPI no Windows,
  fingerprint da máquina, heartbeat
- `FonteSandbox` — **primeiro**, não por último: lê uma pasta de quadros com
  relógio simulado e os reproduz como se fossem câmera ao vivo. É o que permite
  desenvolver e testar sem depender de loja, câmera ou horário
- Pipeline de quadro, as etapas 4 a 8 das quinze:
  descarta os primeiros, escolhe o mais nítido de uma rajada, recorta a zona
  pelo polígono, borra rosto quando a regra permite, hash perceptual com
  deduplicação, redimensiona para a resolução da regra
- Buffer circular do sub-stream em segmentos, com extração de clipe com pré-roll

**Porta:** processa uma pasta de quadros e devolve os recortes corretos, com
dedupe funcionando. Verificável olhando os arquivos de saída.

---

### A2.2 · Julgamento em nuvem, fila e motor de regras

O ciclo fechado. A partir daqui o agente produz veredito de verdade.

- `JuizNuvem` — Claude com schema JSON forçado, prompt base separado do critério
  versionado para pagar cache, `max_tokens` curto
- Fila persistente em SQLite: chave idempotente gerada no cliente, prioridade,
  reenvio após queda de link, lote de madrugada para prioridade leve
- Cascata de modelo: barato primeiro, escala para o caro só quando a confiança
  vier baixa
- Motor de regras: janela de horário, cooldown por par zona-regra, deduplicação,
  severidade, e os três destinos — conforme vira métrica sem imagem, não
  conforme vira alerta com clipe, não avaliável vira fila de revisão
- Envio para a API, com reenvio

**Porta:** o lote gravado do sandbox atravessa e vira vereditos coerentes, com
cooldown funcionando e sem duplicar em retry.

---

### A2.3 · Fontes reais e os três gatilhos

Aqui o agente sai do sandbox e encosta no mundo.

- `FonteRTSP` — dois streams, sub contínuo e main só no evento. Catálogo de
  perfis de gravador resolve a URL a partir de fabricante e modelo
- `FonteUSB` — câmera UVC direto pelo OpenCV, para a estação de montagem
- `GatilhoCGI` — `eventManager.cgi` do DVR em conexão longa.
  ⚠️ O firmware trunca a lista de `codes` em ~100 caracteres: usar `[All]` e
  filtrar no agente
- `GatilhoWebhook` — ISAPI `httpHosts`, para câmera com IA embarcada
- `GatilhoDetector` — RF-DETR Nano via OpenVINO na iGPU. **Não é opcional:**
  a inteligência do MHDX roda em 1 canal só, então a classificação "é pessoa?"
  acontece aqui, em todos os canais
- Reconciliação: gatilho bruto do DVR em dois estágios, movimento depois
  classificação

**Porta:** as mesmas regras do sandbox rodando contra o DVR e as câmeras reais.
É onde aparece o que o sandbox esconde — vapor, contraluz, ângulo, latência.

---

### A2.4 · Julgamento local, comparação e verificação binária

Fecha os quatro caminhos de julgamento. É o que torna `loja.modo_julgamento`
real.

- `JuizLocal` — vLLM servindo Qwen3.5-9B ou 27B conforme a VRAM disponível.
  Desligar o modo de raciocínio: para veredito sim ou não é token jogado fora
- `JuizComparacao` — SigLIP 2 gera embedding do quadro e compara com os frames
  da base de conhecimento. Abaixo do limiar, escala para o VLM. Custo zero no
  caso comum
- `JuizBinario` — Intern-Decision-2B: recebe um esquema de perguntas sim/não e
  devolve probabilidade por pergunta num único passe, em 33 ms. É o que atende
  prioridade urgente, e é a base da verificação de montagem
- Seleção do juiz por `loja.modo_julgamento` e por prioridade da regra

**Porta do bloco A2:** as cinco categorias de regra, os quatro caminhos de
julgamento e os três níveis de prioridade, rodando contra o sandbox e contra as
câmeras reais, com o mesmo contrato de evento.

---

## A regra de montagem — desenho fechado, implementação em A4

Estudada e parqueada. O tipo `acao` já existe na migration 001; esta é a
especificação de como ela funciona quando for implementada.

> **07/10/2026 — este desenho supõe saber de qual pedido é o lanche.** Na loja
> há quatro bancadas, vários lanches abertos em cada uma e ninguém diz qual é
> de quem. O que falta para chegar lá, com as medidas do PC da loja, está em
> [`estudo-montagem-em-escala.md`](estudo-montagem-em-escala.md): conferir a
> **conta** (demanda do KDS × produção vista), não adivinhar o pedido de cada
> lanche. As quatro decisões abaixo continuam valendo e o estudo se apoia nelas.

### A simplificação que torna o problema tratável

Classificar um ingrediente entre doze possíveis é difícil e trava em ~95% por
item — e com oito itens, 95% por item dá 66% de acerto no sanduíche inteiro.

Mas o sistema **sabe o que esperar**, porque o pedido veio do Regem. Então a
pergunta muda de categoria:

| Pergunta | Tipo | Acurácia |
|---|---|---|
| "Qual destes 12 ingredientes é este?" | classificação aberta | ~95% |
| **"É o queijo, que é o que deveria entrar agora?"** | verificação binária | **>99%** |

Restringir a hipótese com a receita é o que leva a acurácia ao patamar em que o
veredito vale. E é exatamente o formato do `JuizBinario`.

### A segunda: contar já pega metade dos erros

A receita espera seis ingredientes; aconteceram cinco deposições. Faltou algo —
e isso se sabe **sem identificar nada**. Contar mão entrando e saindo da zona é
detector local, custo zero.

| Camada | O que pega | Custo |
|---|---|---|
| 1 · contagem de deposições | ingrediente faltando ou a mais | R$ 0 |
| 2 · verificação binária por deposição | ingrediente errado, ordem errada | R$ 0 |
| 3 · VLM | o caso duvidoso | R$ 0,006 |

### O laço

1. Regem entrega a receita esperada do pedido
2. Detector marca início da sequência — o pão base entra na zona
3. A cada deposição: captura o quadro **logo após a mão soltar**, não durante
4. `JuizBinario` verifica contra o esperado na posição N
5. Fim da sequência — a tampa entra, ou o item sai da zona
6. Divergência por contagem ou por verificação vira alerta **por item**:
   "faltou o queijo", nunca "a montagem está errada"

### Onde o alerta sai, e por que isso decide o valor

No **KDS da estação, em segundos** — o montador corrige antes de fechar o
sanduíche. É a diferença entre evitar o problema e registrar o problema.

Por isso a regra é de prioridade **urgente**, e por isso precisa de julgamento
local: a ida e volta à nuvem gasta 2 a 5 segundos só de rede, e nesse tempo o
pão já fechou.

O WhatsApp entra depois e por outro motivo — reincidência. "O queijo faltou 4
vezes hoje" é informação de gestão, não de correção.

### Quando não há pedido no sistema

1. **Melhor:** o pedido de balcão também entra no Regem, e o problema não existe
2. **Fallback:** contagem pura contra a faixa normal da loja — pega o caso
   grosseiro
3. **Último caso:** classificação aberta com confiança baixa, só para métrica,
   sem alertar

### Dependência que precisa ser confirmada

**O pedido chega ao KDS antes de o montador começar a montar?** Se chega, o laço
fecha. Se o montador monta primeiro e o pedido entra depois, a verificação
binária perde a referência e cai para contagem — ainda útil, bem menos preciso.

---

## Hardware do teste de montagem

Definido pelo levantamento de 03/10/2026. A fixação é detalhe de instalação; o
que importa é que a óptica permita o enquadramento.

**A conta:** `largura enquadrada = distância × largura do sensor ÷ focal`.
A 60–85 cm, enquadrando 50–100 cm, a lente útil fica entre **3 e 8,5 mm** — fora
da faixa da lente padrão de 2,8 mm, que a essa distância enquadra 160 cm.

| Trilha | Modelo | Preço | O que o teste responde |
|---|---|---|---|
| Analógica | Intelbras VHD 3250 VF G7 · 2 MP · 2,7–12 mm manual · DWDR | R$ 534,76 | O caminho pelo DVR sustenta 2 a 5 quadros por segundo sem atrapalhar os outros canais? |
| USB | ELP USB 1080p varifocal 2,8–12 mm · UVC | ≈ R$ 562 | Destrava o software já: entra no OpenCV sem RTSP nem gravador |

**Varifocal manual, não motorizada.** A motorizada pode refazer autofoco no boot
e mudar o enquadramento — e enquadramento que muda quebra o classificador
treinado, em silêncio.

**Descartados no levantamento:** lente fixa de 6 mm não existe no varejo BR
especializado, e a genérica de marketplace não é mais barata que a varifocal de
marca. Dahua não tem canal de varejo no Brasil. A VHD 3150 VF G7 é 720p, apesar
de a loja anunciar 2 MP.

---

## Motor de dimensionamento — o que o usuário recebe

A pesquisa de mercado virou dado consultável na migration 002. A partir do que o
usuário quer analisar e do que já tem, o sistema monta a estrutura recomendada e
aponta o que está fora do padrão — **para menos**, que inviabiliza, e **para
mais**, que é dinheiro parado.

### As três pontas que se comparam

| Ponta | De onde vem |
|---|---|
| **Requerido** | `requisito_uso`, derivado das regras que ele quer |
| **Declarado** | o formulário: `levantamento_item.specs_declaradas` |
| **Detectado** | o agente, medindo na instalação: `specs_detectadas` |

Divergência entre declarado e detectado também vira alerta — é comum o cliente
achar que tem 4 MP e ter 720p.

### Sondas de diagnóstico — medir, não ler ficha

O agente não confia em datasheet. Ele mede o que a câmera devolve de verdade:

| Sonda | Método | O que revela |
|---|---|---|
| Resolução real | `ffprobe` no stream | Pega "anunciado 2 MP, é 720p" |
| ⭐ **Detalhe real × nominal** | energia de alta frequência por FFT ou variância do Laplaciano | **Detecta 1080N mesmo quando o stream declara 1920×1080** — imagem esticada não tem alta frequência |
| Foco | variância do Laplaciano na zona | A lente está focada no plano de trabalho? |
| Ruído | desvio padrão em área uniforme | Sensor fraco ou luz insuficiente |
| Faixa dinâmica | histograma, pixels em 0 e em 255 | O WDR dá conta da cena? |
| Cor ou infravermelho | saturação média | Se cai para preto e branco, **toda regra de cor morre à noite** |
| FPS real | contagem de quadros recebidos | Ficha e entrega raramente batem |
| ⭐ **px/cm real** | objeto de referência de tamanho conhecido no quadro | Fecha a conta óptica com **medição**, não teoria |
| Decode do PC | decodificar N streams e medir CPU | Capacidade real, não tabela |
| Gravador | CGI/ONVIF: modelo, resolução configurada, `eventManager` responde? | Confirma o perfil antes de depender dele |

A sonda de **px/cm** merece destaque: com uma folha A4 apoiada na bancada, o
sistema mede quantos pixels os 21 cm ocupam e devolve o px/cm real. Toda a
especificação óptica — lente de 3 a 8,5 mm, 12,8 px/cm para montagem — deixa de
ser cálculo e vira medição de trinta segundos.

### O pacote de entrega

Ao fechar o diagnóstico, o usuário leva cinco coisas:

1. **Lista de materiais** com link de loja brasileira e custo
2. **Achados** por gravidade — atende, atende com limitação, não atende,
   superdimensionado, divergente — cada um com o upgrade indicado e qual regra
   fica comprometida
3. ⭐ **Diagrama de topologia** — como os equipamentos se ligam fisicamente,
   marcando o que já existe e o que é compra. Mermaid gerado dos dados
4. ⭐ **Diagrama de funcionamento** — o caminho do quadro até o alerta, **só com
   as camadas ativas naquele projeto**, não o fluxo genérico
5. ⭐ **Ficha de instalação por ponto** — `diagnostico_ponto`. Não é "monte a
   câmera ali", é *"a 62 cm do tampo, inclinada 45°, lente em 6 mm, enquadrando
   52 cm, px/cm esperado 31"*. E o campo `px_por_cm_medido` fecha o laço na
   instalação

---

## Dependências externas

| O que | De quem | Bloqueia |
|---|---|---|
| Supabase do Farol: projeto novo ou reaproveitado | dono | aplicar a migration 001 |
| DVR MHDX 3116-C | compra | A2.3 — fontes reais |
| Câmeras de teste da montagem | compra | A4 — montagem |
| Pedido chega ao KDS antes da montagem? | confirmar na operação | desenho do laço de montagem |
| Cabo de rede entre o PC da loja e o gravador: tem emenda, e a placa só fecha enlace forçada em 10 Mbps Half Duplex (em autonegociação não sobe — testado em 07/10) | o dono troca por um cabo inteiro; depois, devolver a placa à autonegociação | montagem em escala: 4 bancadas em alta + o resto da loja pedem 13,6 Mbps |
| Distância do PC até a bancada | medir | decide se a USB entra |

---

## Pendências de fim de projeto

> Entram **depois** do produto implementado e testado. Registradas aqui para
> não serem reinventadas, e porque algumas condicionam decisões de desenho
> que se tomam antes.

### P1 · Cartão de integração de IA pelo próprio lojista (BYO)

Na distribuição, o lojista conecta a **conta de IA dele** — Anthropic, OpenAI
ou Gemini — por um cartão na tela de integrações, com **passo a passo** do
provedor escolhido: onde criar a conta, onde gerar a chave, onde pôr o limite
de gasto, e onde colar a chave no Farol.

**Por que BYO e não a chave da distribuição:** o custo da análise escala com o
número de câmeras e de regras, e é o único custo do produto que cresce por uso.
Com a conta no nome do lojista, o teto de gasto é dele, a fatura é dele, e a
distribuição não vira intermediária de um custo variável que não controla.
Convive com o modo local (VLM no PC da loja), que custa zero por análise.

**O que já está pronto para isto:** o protocolo `Juiz`
(`agent/farol_agent/juizes/base.py`) recebe imagem + critério e devolve
veredito; `JuizNuvem`, `JuizLocal`, `JuizComparacao` e `JuizSimulado` já
convivem por trás dele. Um `JuizOpenAI` e um `JuizGemini` entram como irmãos,
sem tocar no motor. **Nada escrito daqui até lá pode presumir Anthropic fora
de `juizes/nuvem.py`** — nem preço, nem nome de modelo, nem formato de erro.

**O que falta decidir quando chegar a vez:**

- Onde a chave do lojista fica guardada. Ela é segredo **dele**, não da
  distribuição — então vive no cofre do agente, na loja, e o console nunca a
  recebe nem a mostra. Mesmo tratamento da senha do gravador.
- Como o cartão prova que a chave funciona antes de salvar (uma análise de
  teste contra um quadro guardado, com o custo mostrado na hora).
- O que acontece quando a chave do lojista expira ou fica sem crédito: a fila
  não pode encher calada. Alerta na tela e no painel da distribuição.
- Tabela de preço por provedor para a estimativa de custo — hoje
  `PRECO_USD_MTOK` só conhece os modelos da Anthropic, e é valor de referência,
  não de cobrança.
- Se a distribuição oferece uma conta própria como alternativa para quem não
  quer abrir conta de IA, e com que margem.

### P2 · A chave sai da variável de ambiente e vai para um cofre

**Decisão do dono em 05/10/2026:** nos testes a chave fica direto na variável
`ANTHROPIC_API_KEY`; o cofre entra depois. Registrado para não virar o padrão
por esquecimento.

Já existe conta AWS usada para guardar segredos do Liame — mesmo modelo serve
aqui, e é o que a documentação da Anthropic recomenda ("store API keys in a
secrets manager, rotate them periodically").

**Por que não é urgente agora:** a chave vive num notebook, presa a um
workspace com teto de gasto, e com expiração. O estrago de um vazamento é
limitado pelo teto e pela data.

**Por que vira urgente na distribuição:** a chave passa a viver em PC de loja,
máquina que a distribuição não controla fisicamente e onde qualquer um com
acesso ao Windows lê a variável de ambiente. Nesse ponto ou ela está num cofre,
ou é a chave do próprio lojista (P1) — e as duas coisas se resolvem juntas.

**Federação de identidade está fora para o agente.** O Console a oferece no
lugar da chave estática, e ela é melhor — token curto, rotação automática, nada
guardado em variável de ambiente. Mas exige um provedor de identidade (AWS IAM,
GCP, Azure, GitHub Actions, Kubernetes) emitindo o token, e o agente roda em PC
de cozinha, onde não há nenhum e nunca haverá. O próprio aviso do Console diz:
"ambientes sem um provedor de identidade ainda podem precisar de uma chave de
API". Então o caminho do agente é **chave estática + cofre**, ou a chave do
próprio lojista (P1). Se um dia a análise rodar do lado da nuvem numa máquina
com identidade de plataforma, aí a federação volta à mesa — para aquele caminho,
não para o da loja.

**Quando mexer, decidir:** uma chave por loja ou uma para todas (uma para
todas significa que um vazamento obriga a trocar em todas); se o agente busca
no cofre ao subir ou recebe injetada; e como o agente sobrevive ao cofre fora
do ar — a fila em disco já guarda o que não foi julgado, então a resposta
provavelmente é "acumula e avisa", não "para".

---

## A3.5 · Fotos de referência no cadastro do critério

Pedido do dono em 05/10/2026, e **a medição do mesmo dia é a justificativa**:
o Haiku leu um mouse como controle remoto duas vezes, a 85% e 95%. O modelo
decidiu pela aparência genérica porque não tinha a aparência DAQUELA loja.

No cadastro do critério — "verificar se o colaborador usa a espátula
regularmente" — o usuário anexa **uma ou mais fotos da espátula, de ângulos
diferentes**. Elas servem a dois usos distintos, e confundi-los é erro:

**Uso A · comparação por embedding (custo zero).** `JuizComparacao` já compara
o quadro com os embeddings guardados e só chama modelo quando a cena não se
parece com nada conhecido. É o caminho de `presenca`, `contagem` e
`comparacao`, que por desenho **não vão à nuvem**.

**Uso B · referência no pedido ao modelo (feito).** As fotos vão junto com o
quadro, rotuladas, antes da cena a julgar. É o que ancora a identificação do
objeto e é a resposta direta ao erro do mouse. Já implementado em
`juizes/nuvem.py` (`_conteudo`) e exercitável por `--referencia` no `analisar`
e no `ensaio`.

### O que já existe (migration 001)

| tabela | o que guarda |
|---|---|
| `base_conhecimento` | o item ou padrão: tipo `item` (ingrediente, **utensílio**) ou `padrao`, com `limiar` próprio |
| `base_frame` | **N fotos por item**, cada uma com `embedding vector(768)` (SigLIP 2 ViT-B) e uma marcada `principal` |
| `regra.base_id` | liga o critério ao item de referência |

O modelo de dados do pedido **já está pronto**. Falta a tela, o upload, o
cálculo do embedding e o `base_id` chegando ao juiz.

### O que falta

1. **Tela** no cadastro de regra: anexar fotos, marcar a principal, ver as que
   já existem. Vários ângulos é o ponto — uma foto só ensina um ângulo.
2. **Upload** para o storage, com as mesmas regras de LGPD das fotos de
   ponto/vistoria (consentimento e expurgo). Foto de utensílio não tem pessoa,
   mas a tela não pode depender disso: valida.
3. **Embedding** no envio (SigLIP 2), gravado em `base_frame.embedding`.
4. **Ligar `regra.base_id` ao juiz**: hoje `--referencia` é manual na linha de
   comando; no agente as fotos vêm da regra.
5. **Teto por regra.** Cada referência custa tokens em toda análise. Com
   `cache_control` no bloco (já feito) a leitura cai a 0,1×, mas o teto
   precisa existir — sugestão de partida: 3 a 5 fotos.

### A medir quando estiver pronto

Com `farol-agent ensaio` e as imagens já guardadas, a pergunta "referência
melhora?" é empírica, não opinião: mesmo conjunto, mesmo critério, com e sem
`--referencia`. E a pergunta "é o modelo barato?" também: `--modelo haiku`
contra `--modelo sonnet` nas mesmas imagens.

---

## A5 · Preview do canal e marcação da área (plano — aguarda aprovação)

Pedido do dono: no app web, ver o canal e **marcar a área principal de
análise** com o mouse, em vez de digitar `--area 0.15,0.47,0.85,0.80`. É a
peça que transforma o motor de dimensionamento em algo que o lojista usa.

### O obstáculo, que não é de tela

O agente só fala **de dentro para fora**: `ativar`, `heartbeat`, `eventos`.
Ele vive atrás do NAT da loja e **o console não tem rota até ele**. Nenhuma
tela resolve isso; é preciso um caminho de volta.

**Caminho escolhido: comando pendente carregado pelo heartbeat.** O heartbeat
já existe e já é autenticado pelo token do agente — então o canal de volta é
a RESPOSTA dele, não uma conexão nova. Sem porta aberta na loja, sem túnel,
sem exceção de firewall: continua tudo saindo de dentro.

    console                 nuvem                      agente (loja)
    "ver canal 1"  ──▶  grava comando pendente
                                  ◀──────────  heartbeat (já acontece)
                                  ──────────▶  "capture o ponto X"
                                  ◀──────────  POST do quadro
    mostra o quadro ◀───────┘

**Alternativas descartadas:** WebSocket persistente agente→nuvem (mantém
conexão de pé 24h por loja para um caso que acontece na instalação, e some
quando a internet oscila); abrir porta na loja (inaceitável — o produto
promete não exigir mudança de rede).

### A5.0 · A descida da configuração (pré-requisito, e está faltando)

**Confirmado pelo dono em 06/10/2026: a configuração é feita na nuvem, no app,
e desce para o agente usar.** O código já dizia isso — `config.py` abre com
"no produto final a configuração desce do console" — mas **a descida não
existe**. Hoje o agente lê as regras de um YAML local, e
`GET /v1/lojas/:id/regras` é autenticada por sessão de console, não por token
de agente.

Sem isso, desenhar a área no app não chega ao agente, e o preview seria uma
tela bonita que não muda o que a loja analisa.

**Dois caminhos de descida, e eles são diferentes:**

| | o que desce | quem inicia | como |
|---|---|---|---|
| **configuração** | regras, zonas, corte do canal, fotos de referência | o agente, quando quiser | `GET /v1/agentes/configuracao` com o token do agente |
| **comando** | "capture um quadro agora" | a nuvem | resposta do `heartbeat` |

A configuração **não precisa** do heartbeat: é o agente que pede, de dentro
para fora, e NAT nenhum atrapalha. O que o heartbeat carrega é só
`config_versao` — um inteiro. Igual, o agente não faz nada; diferente, ele
puxa. Assim a configuração inteira não trafega a cada batida.

Só o **comando** precisa do canal de volta, porque quem inicia é a nuvem e
precisa chegar agora.

**O agente nunca para por falta de descida.** Se a nuvem estiver fora, ele
segue com a última configuração que tem, em disco. Regra de auditoria que para
quando a internet oscila não serve a uma cozinha.

### Quem corta, e de onde vem o corte

**Quem corta é o AGENTE, na loja, antes de a imagem sair.** Não é detalhe de
implementação — é a arquitetura de custo e de privacidade. Em `motor.py`, nesta
ordem: `zona.bbox()` → `recortar_zona()` → `borrar_rostos()` → `redimensionar()`
→ só então a imagem viaja.

Se o corte acontecesse na nuvem, a loja subiria o quadro inteiro para jogar
fora 60% depois de já ter pago por ele — e mandaria para fora cena que ninguém
pediu: as outras mesas, o salão, quem está passando. **O que não é a área
marcada nunca sai da loja.**

**O corte pertence ao CANAL.** Cada canal (`ponto`) tem o seu, e ele vale para
tudo que se analisa ali. Duas origens, nesta ordem de autoridade:

1. **O usuário desenhou a região importante** → é esta, sempre. Prioridade 1.
2. **Não desenhou** → o padrão do sistema: o quadro inteiro, que já nasce com o
   ponto (`console.ts` cria a zona `Quadro inteiro` na mesma transação do
   cadastro).

**O sistema não adivinha recorte.** Um corte automático erraria calado,
cortando justamente o que importa, e o veredito sairia confiante sobre o pedaço
errado. O padrão é o quadro inteiro — e o diagnóstico **diz o que isso custa**:
menos px/cm, mais token, menos confiança. Informar em vez de chutar.

**Duas decisões diferentes, que não se misturam:**

| decisão | de quem | o quê |
|---|---|---|
| **ONDE** | do usuário | a região do canal que importa |
| **QUANTOS PIXELS** | do sistema | o degrau de envio (r384 … r1080) |

O motor de dimensionamento une as duas: `px/cm no modelo = resolução_de_envio ÷
largura_da_zona_cm`. É por isso que **marcar a área barateia sem perder
precisão** — zona estreita sustenta o mesmo px/cm com envio menor.

**Zonas finas continuam possíveis.** Uma câmera aberta pode cobrir chapa, pia e
montagem; regra que precise mirar só um pedaço usa a zona dela. O corte do
canal é o padrão de quem não mira nada específico — não uma trava.

Na migration: `zona.principal boolean` marca qual é o corte do canal, mesmo
padrão que `base_frame.principal` já usa. O desenho do usuário vira a principal;
`Quadro inteiro` é a principal até existir desenho.

### Migration (próxima na sequência: **007**)

    comando_agente
      id, agente_id, tipo ('capturar_quadro'), ponto_id,
      parametros jsonb, estado ('pendente'|'entregue'|'concluido'|'expirado'),
      resultado_url, criado_em, entregue_em, concluido_em, expira_em

Comando **expira** (sugestão: 2 min). Sem isso, um agente que estava offline
acorda horas depois e captura um quadro que ninguém mais espera.

### Latência — a decisão que muda o trabalho

O heartbeat de hoje decide quanto o preview demora. Três opções:

| | como | espera | custo |
|---|---|---|---|
| **A** | heartbeat como está | até 1 intervalo | zero |
| **B** | heartbeat encurta para 2 s enquanto a tela está aberta | ~2 s | tráfego só durante o uso |
| **C** | long-poll: o heartbeat segura até 25 s quando não há comando | quase imediato | 1 conexão presa por loja |

**Recomendo B.** O preview é usado na instalação e no ajuste de regra, não o
dia inteiro; pagar conexão presa (C) por um caso raro é desenho caro. E (A)
com intervalo longo faz o usuário achar que travou.

### Privacidade — não é detalhe aqui

> ⚠️ **Corrigido em 06/10/2026 (A11):** o borrão que "já existia" não
> apagava o rosto, e mesmo consertado só alcança o rosto que o detector
> acha. Ler A11 antes de confiar nesta seção.

O quadro de preview é cena real da loja, com pessoas. Então: **borrão de
rosto antes de sair da loja** (`recorte.borrar_rostos`), expurgo
por data como nas fotos de ponto/vistoria, e o quadro de preview **não** vira
evento nem fica no histórico — é descartável por natureza.

### Ordem

1. Migration 007 + rota de comando + heartbeat devolvendo pendências
2. Agente: atender `capturar_quadro`, borrar rosto, subir, confirmar
3. Tela: preview + desenho do retângulo → grava `zona.poligono`
4. Em cima da tela pronta: o diagnóstico por zona (já calculado em
   `GET /v1/pontos/:id/diagnostico`) aparece ao lado do desenho — *"esta área
   sustenta estado em r384; montagem não, aproxime 1,4×"*

### P3 · Renomear o cadastro de teste para "Regem"

Pedido do dono em 06/10/2026, **para o fim do processo**: onde está `teste1`,
passar a ser **Regem**.

É o cadastro criado no provisionamento inicial do console (tenant/loja de
teste). Fica para depois de o produto estar implementado e testado, porque
renomear antes só atrapalha quem está rastreando dado de teste no meio do
desenvolvimento.

**A confirmar quando chegar a vez:** qual registro carrega o nome — `tenant`,
`loja`, ou os dois. São tabelas diferentes e o nome aparece em telas
diferentes. Conferir pela leitura antes de escrever, e a troca é um `update`
simples, sem migration.

---

## A6 · Modo local: ver o canal ao vivo (plano — aguarda aprovação)

Definição do dono em 06/10/2026: **a nuvem é administração de
configuração.** Ver câmera ao vivo é outra coisa, e não deve passar por
ela.

### Por que não pela nuvem

Vídeo contínuo subindo da loja é o oposto de tudo que o produto decidiu:
custo de banda da loja, latência, e cena crua saindo o tempo todo quando a
arquitetura inteira existe para que **só o recorte viaje**. Um minuto de
MJPEG a 5 fps é mais tráfego que um dia de análises.

### O desenho

**Quando o usuário está NA loja, o navegador fala direto com o agente.** O
agente serve o canal na rede local; a nuvem não vê o vídeo e não paga por
ele. É o mesmo princípio dos apps satélites do Regem (KDS e Ponto falam por
rede local), e pelo mesmo motivo.

| | onde funciona | o que serve | quem paga |
|---|---|---|---|
| **nuvem** (feito) | de qualquer lugar | quadro fixo do canal, desenhar o corte, regras | caminho de dados, uma imagem |
| **local** (A6) | só dentro da loja | canal ao vivo, procurar algo, conferir enquadramento | ninguém: não sai da loja |

A tela **oferece o modo local quando alcança o agente** e cai no quadro
fixo quando não alcança. Quem está em casa configura; quem está na loja vê
ao vivo. Nenhum dos dois caminhos depende do outro.

### Onde roda (definido pelo dono em 06/10/2026)

**Na própria máquina do agente** — a que tem placa de vídeo, onde vão
rodar as camadas de análise local. E **pelo sub-stream do DVR**, que é
exatamente o que o sub-stream existe para fazer: resolução baixa, banda
baixa, fluxo contínuo.

Isso torna o item muito mais barato do que parecia, por dois motivos que
já estão no código:

**O quadro já está em memória.** `_LeitorContinuo` (`fontes/rtsp.py`) já
drena o sub-stream numa thread e guarda o mais recente, para o pipeline de
gatilho. Servir MJPEG a partir dele não abre nada novo — é entregar um
quadro que já foi decodificado.

**Uma conexão com o DVR, N espectadores.** Gravador tem limite de fluxos
RTSP simultâneos; o MHDX não é exceção. Se cada navegador abrisse o
próprio fluxo, três pessoas olhando esgotariam o gravador e **derrubariam
a análise junto** — o pior modo de falha possível, porque a auditoria para
por causa de alguém que só queria olhar. Servindo do quadro que o agente
já tem, o número de espectadores não toca no DVR.

### O que precisa ser decidido

1. **Como o navegador acha o agente.** O agente não tem nome na rede, e
   mDNS não roda em navegador. Candidatos: o agente informa o IP local no
   heartbeat e o console tenta; ou um endereço fixo configurado na
   instalação. O primeiro é automático e falha sozinho; o segundo é chato
   e previsível.
2. **HTTPS.** Página servida em `https://` não busca `http://` da rede
   local — o navegador bloqueia por conteúdo misto. É o obstáculo real
   deste item, não o streaming.
3. **Autenticação do fluxo local.** Câmera aberta na LAN da loja é
   problema de segurança, não recurso. O agente tem que exigir credencial
   também na rede local, e ela não pode ser a mesma do token da nuvem.
4. **Formato.** MJPEG é trivial e pesado; WebRTC é leve e complexo.
   Começar por MJPEG em resolução baixa, medir, e só então decidir se
   vale WebRTC.

### Liga com a busca

O dono notou que isto ajuda a **busca**: marcar o local na hora de buscar
filtra melhor. Ou seja, a mesma marcação de área que define o corte serve
de filtro — "mostre as análises desta região, neste período". A área deixa
de ser só configuração e vira dimensão de consulta. Entra no desenho da
tela de busca (A7), ainda não escrita.

### P5 · O wizard precisa de duas perguntas que o esquema não previu

`levantamento` pergunta intenção, número de câmeras, internet, se a imagem pode
sair, offline e busca. **Não pergunta quanto o cliente pode investir nem quanto
aceita gastar por mês com API** — e são essas duas que decidem o caminho
inteiro, segundo o próprio dono.

Entram como `orcamento_disponivel` e `gasto_api_aceitavel`. Com elas, o
`diagnostico` deixa de recomendar "o melhor" e passa a recomendar **o melhor
que cabe** — que é outra coisa, e é a que faz o produto vender.

Junto: **auto-detecção**. `levantamento_item` já separa `specs_declaradas` de
`specs_detectadas` porque o que o cliente declara erra — ele não sabe se o
canal entrega 1080p real ou 1080N esticado, nem a focal da lente. O agente já
mede quase tudo (`dvr info`, `dvr canais`, `sondar` com `detalhe_real`); falta
ler as specs da **própria máquina** (CPU, RAM, GPU), que é o que decide se cabe
modelo local.

### P4 · O gravador da loja precisa de IP fixo

Visto na tela do MHDX em 06/10/2026: **Modo DHCP**.

`ponto.host` é campo fixo no cadastro. Com DHCP, o endereço do gravador
muda sozinho — queda de luz, troca de roteador, lease que expira — e o
Farol para de achar a câmera **sem ninguém ter mexido em nada**. O
sintoma seria idêntico ao ERR-013: comando entregue, captura falhando,
equipamento aparentemente normal.

Entra no procedimento de instalação: **IP fixo no gravador, ou reserva
por MAC no roteador**, antes de cadastrar o ponto.

E vale avaliar uma defesa no produto, porque instalação boa não se
garante por documento: o agente conhece o MAC do gravador
(`dvr descobrir` já o lê). Se o host parar de responder, ele poderia
varrer a rede procurando aquele MAC e avisar *"o gravador mudou de
192.168.1.108 para 192.168.1.112"* — em vez de só falhar. A decisão de
**corrigir sozinho ou só avisar** fica para quando chegar a vez;
corrigir sozinho é conveniente e é também como um equipamento trocado
passa despercebido.

---

## A7 · Alertas: política no Farol, transporte fora — ✅ FEITO (06/10/2026, PR #30)

**O Farol decide QUEM recebe O QUÊ; quem entrega é outro.**

Reimplementar WhatsApp aqui significaria manter dois cadastros de número,
duas filas de retentativa e descobrir sozinho os mesmos erros de template
da Meta que o Regem já catalogou. Pior: amarraria um produto **revendável**
a um provedor de mensageria.

Então o Farol **publica** o alerta — webhook, e MCP quando existir — e o
Regem ou o n8n entrega. Exceção: **o KDS**, que é integração direta
Farol↔Regem e é onde o alerta vale mais, porque a cozinha já está olhando
para aquela tela.

### O banco — migration 011, aplicada

| tabela | para quê |
|---|---|
| `destino` | quem recebe: tipo (`whatsapp`, `email`, `kds`, `webhook`), endereço, perfil, escopo (loja ou rede), `segredo_ref`, ativo |
| `politica_alerta` | por severidade × prioridade (nulo = curinga): avisar ou **vetar**, e para qual destino |
| `envio` | o que foi despachado, para quem, quando, e o resultado — é o que responde "o alerta chegou?" |

### Como a resolução decide (`api/src/alertas.ts`)

1. **O escopo mais específico ganha inteiro.** Loja com política própria ignora
   as linhas da rede. Somar os dois tornaria impossível uma loja receber MENOS
   que o padrão da rede — todo veto local seria desfeito por uma linha de rede.
2. **O veto ganha do envio.** Uma linha `enviar: false` que case silencia a
   combinação, mesmo com outra linha mandando enviar. É como se lê regra de
   firewall, e é a única forma de "não me avise disso" não exigir apagar o resto.
3. **Sem política, emergência e urgente alcançam todos os destinos ativos.** A
   assimetria é deliberada: um alerta a mais incomoda por um instante; uma
   emergência não vista tira do produto a razão de existir.
4. **Só `nao_conforme` alerta.** Conforme é métrica; não avaliável é fila de
   revisão. Sem o filtro, oito regras conformando o dia inteiro mandariam
   centenas de "está tudo bem", e no terceiro dia ninguém abriria mais nenhuma.

### O vigia do vigia

Job de um minuto (`despacharAgentesCaidos`): agente ativo sem bater há mais de
cinco minutos gera aviso de emergência. Não porque uma máquina parou, mas por
causa do que o silêncio significa — **aquela loja parou de ser auditada** e o
console segue verde. O aviso diz a consequência em português, não "sem
heartbeat".

Duas armadilhas resolvidas ali (ERR-015 e ERR-016):

- a faixa de repetição conta **desde a queda**, não desde o calendário: balde
  fixo fazia um agente que caía às 05:59 receber o segundo aviso um minuto
  depois;
- **o transporte não pode ser o agente** — o aviso de que o agente caiu
  dependeria do agente. O transporte é infraestrutura da distribuição e puxa de
  todas as lojas.

### A tela — `/lojas/[id]/alertas`

Três perguntas na ordem em que aparecem na cabeça de quem configura: *para quem
eu aviso* → *aviso de quê, para quem* → *chegou?*

A política que o dono descreveu vira linha de tabela, não `if` no código:
urgente sempre; intermediário conforme o papel; leve com destino próprio ou
nenhum. Quem opera muda isso sem deploy.

### Decisões travadas desde já

- **Nenhum número de telefone entra na regra.** A regra diz a severidade;
  o destino é configuração separada. Misturar os dois faz cada regra nova
  repetir o cadastro de quem avisar, e um número que muda vira caça ao
  tesouro por trinta regras.
- **`envio` registra o RESULTADO, não só a tentativa.** "Mandei" e
  "chegou" são fatos diferentes, e a diferença entre eles é o que explica
  um alerta que ninguém viu.
- **Nenhum segredo na linha.** `destino.segredo_ref` guarda o NOME da
  variável, resolvida no ambiente de quem despacha — mesmo desenho do cofre
  do agente. O console mostra *que existe* segredo, nunca qual.

### O que falta para o alerta sair de verdade

| falta | de quem |
|---|---|
| `npm run migrar` na nuvem (mig. 011) | do dono, console do `farol-api` |
| cadastrar o primeiro destino em **Loja → Alertas** | do dono |
| o lado do n8n/Regem puxando `POST /v1/envios/reivindicar` | a fazer, depois da semana de operação |

---

## A9 · Um critério, vários canais — ✅ FEITO (06/10/2026, migration 012)

**Pedido do dono (06/10/2026):** *"o critério geral é como se fosse um critério
local, porém se forem muitos canais, ao invés de repetir, ele é cadastrado de
forma a atender vários canais"*. E, na segunda rodada, **como**: uma árvore
como a de um explorador de arquivos — o setor é a pasta, o canal é o que está
dentro; marca-se o setor inteiro ou abre-se o setor e marca-se um canal só. Em
cada canal, "+ critério"; cada critério aparece como um arquivo, com editar e
tirar (sempre confirmando, e dizendo que a análise deixa de ser verificada
naquele canal).

> Vocabulário: o que o dono chama de **zona** é o `setor` do banco, e o
> **canal** é o `ponto`. No banco, `zona` é a área desenhada dentro do canal.
> A tela fala a língua do dono; o código, a do banco.

### O modelo

| o quê | como ficou |
|---|---|
| `regra_alvo (regra_id, zona_id)` | o conjunto de áreas onde o critério vale — é exatamente o que a árvore mostra marcado |
| `regra.loja_id` | o critério ganha dono direto; antes era derivado da zona, e com o conjunto podendo ficar vazio o dono sumiria |
| `regra.zona_id` | legado, não se lê mais; fica preenchido só para o código anterior funcionar se for preciso voltar uma versão |
| marcar um canal | grava a **área principal** dele (`zona.principal`); canal com mais de uma área abre um terceiro nível na árvore |
| a descida para o agente | **expandida no servidor**: o mesmo critério desce debaixo de cada área, com o mesmo id — o agente não mudou para isso |

### As três perguntas, respondidas pela árvore

1. **Área dentro do canal** → a principal. Quem desenhou mais de uma área
   escolhe abrindo o canal.
2. **Canal novo entra sozinho?** → **não.** O conjunto é explícito: câmera
   instalada depois aparece na árvore **desmarcada**, e o setor passa a mostrar
   a caixa parcial ("2 de 3"). Herdar ligaria um critério num enquadramento que
   ninguém conferiu. *Se o dono preferir herança, é uma coluna a mais em
   `regra_alvo` — fica como decisão aberta, não como dívida.*
3. **Exceção** → não precisa de recurso próprio: é não marcar o canal.

### O que a tela faz, e o que não faz

- **Editar** muda em todos os canais (o formulário avisa em quantos).
- **Tirar do canal** tira só daquele. A pergunta diz onde ele continua valendo.
- **Tirar do último canal** não apaga o critério: ele é **desligado** e vai para
  "Sem canal", com o histórico. Dali volta a qualquer canal. "Ligado" sem canal
  nenhum seria a pior mentira que esta tela pode contar, e a API recusa.
- ~~Não existe "apagar critério".~~ **Mudou em 07/10/2026**, a pedido do dono —
  ver "Excluir critério e canal", logo abaixo.
- **Ligar/desligar** vale para o critério inteiro, em todos os canais dele.

### Excluir critério e canal; editar canal — ✅ 07/10/2026, migration 014

**Pedido do dono:** *"dar opção de editar ou excluir os critérios. Também os
canais, editar ou excluir."*

| | antes | agora |
|---|---|---|
| critério | editar; tirar de um canal | + **excluir** (sai de todos e some da tela) |
| canal | só criar — a API editava e desativava, **a tela não** | + **editar** (inclui pausar) e **excluir** |

A falta do "editar canal" na tela já tinha custado: o ponto "Bancada" ficou
preso no endereço antigo do gravador, sem ter como corrigir.

**Excluir é marcar, não apagar a linha** (`excluido_em`, `excluido_por`). Todo
veredito gravado aponta para o critério e para a área; apagar a linha quebraria
a pergunta que o produto existe para responder meses depois. O excluído some da
tela, da árvore e do que desce para o agente — o histórico continua com nome.

- **Excluir canal não exclui os critérios dele:** saem só daquele canal. O que
  valia só ali é desligado e vai para "Sem canal" — a mesma regra de tirar do
  último canal. A pergunta de confirmação lista quem fica sem canal e quem
  continua nos outros.
- **Pausar ≠ excluir.** Pausar (`ativo = false`, pelo Editar) deixa o canal na
  tela, marcado, com os critérios guardados.
- Outra conta recebe 404; perfil de execução, 403. Quem excluiu fica registrado.

Conferido no navegador (1280 e 375 px) e por 15 testes contra Postgres real.
De quebra: a tela da loja tinha **761 px de largura num celular de 375** — o
texto `sr-only` da tabela escapava da caixa de rolagem (ERR-028). Corrigido
aqui e na tela de alertas.

**Não incluído:** editar ou excluir **setor**. Não foi pedido; se for, segue o
mesmo desenho.

### O evento diz em qual canal foi — e não às cegas

Com um critério em vários canais, só o agente sabe de qual veio o quadro. A API
aceita `zonaId` do agente **apenas se for um dos canais do critério agora**:

| o agente mandou | resultado |
|---|---|
| zona que é canal do critério | gravado naquele canal |
| zona que não é (o critério saiu de lá, ou é invenção) | recusado — volta em `recusados` para a fila do agente andar |
| nada, e o critério vale num canal só | gravado naquele |
| nada, e o critério vale em vários | gravado **sem** canal: é agente antigo, o veredito é verdadeiro e não se recupera |

Sem a checagem, um critério geral seria passe para gravar evento em qualquer
área da loja.

### Conferido

Navegador de verdade, do início ao fim: marcar o setor (3 canais), desmarcar um
(caixa parcial, 2), criar, tirar com a pergunta (foco inicial em "Cancelar",
Esc cancela), último canal indo para "Sem canal", editar abrindo com os canais
atuais. Em 375 px a página tem 375 px — sem rolagem lateral.

---

## A10 · Detector local: presença e contagem na loja — ✅ fase 1 (06/10/2026, migration 013)

Critério de `presenca` e de `contagem` é 100% local por desenho. Até aqui
isso queria dizer que eles **não rodavam**: o seletor recusava mandá-los à
nuvem e não havia juiz na loja. Agora há.

### O que foi construído

| peça | o quê |
|---|---|
| `JuizDetector` (agente) | RF-DETR Nano (Apache 2.0) pelo ONNX Runtime; usa a placa de vídeo por DirectML quando há |
| modelo fixado | `sha256` conferido na carga — o agente só carrega o modelo que foi medido; baixa só em `farol-agent detector instalar`, nunca em serviço |
| `regra.parametros` (mig. 013) | `{"objeto","minimo","maximo"}` — o que procurar e quantos |
| contrato | `contratos/objetos-do-detector.json`, lido pelos testes do agente E da API (a lição do ERR-018) |
| console | no formulário, presença e contagem ganham "o que procurar" e "quantos"; o explorador mostra o que o detector procura, ou "falta dizer o que procurar" |

### Por que o critério tem campos

O detector não lê português. Tirar "o que procurar" do texto livre seria erro
silencioso: "copo sujo na bancada" viraria "há copo?", e ninguém notaria que
"sujo" foi ignorado. O texto fica para a pessoa ler; quem decide é o campo.

### Os limiares vieram das câmeras da loja, não da ficha

Medido em 06/10/2026 nos 14 canais com câmera de uma loja, substream 704×480:

| o que era | o que o modelo disse |
|---|---|
| pessoas de corpo inteiro | "pessoa" 0,83 a 0,94 |
| casaco pendurado | "pessoa" **0,41** |
| banquinho de plástico | "vaso sanitário" **0,57** |
| pessoa cortada no canto do quadro | não viu |
| velocidade (i7-10700F / Radeon RX 560) | 113 ms no processador, 88 ms na placa |

Daí: **0,70** para "está lá", **0,35** para "talvez". E a regra central —
com `c` certos e `t` em dúvida, a quantidade real está entre `c` e `c + t`:

- o intervalo cabe no que o critério pede → `conforme`;
- fica inteiro fora → `nao_conforme`;
- atravessa a fronteira → **`nao_avaliavel`**, nunca alerta.

O casaco não prova presença e não acusa ninguém em área restrita. Conferido
com o modelo real, pelo código do agente, nas próprias cenas.

### O que esta fase NÃO faz

| limite | fase que resolve |
|---|---|
| objeto fora dos 17 (a espátula) | **fase 2**: fotos de referência do cadastro (A3.5) — detecção por exemplo ou comparação por embedding |
| objeto pequeno no substream (copo a 704×480) | **continua sem medida**: na noite de 06/10 não havia copo em cena na bancada. Medir com um copo posto de propósito, no sub e no fluxo principal recortado |
| contar **produção** ao longo do tempo ("do início do preparo até embalar = 1 unidade") | não é o `contagem` daqui, que conta quantos objetos há no quadro AGORA e responde conforme/não conforme. Contar produção é métrica de fluxo: pede rastreio em vídeo e um resultado que é número, não veredito. Pedido do dono em 06/10/2026 (critério "Produto"), detalhado por ele em 07/10: o que importa é conferir se o pedido registrado foi preparado, e conforme a ficha. **Estudo em [`estudo-montagem-em-escala.md`](estudo-montagem-em-escala.md)**, aguardando decisão |
| "copo SUJO", "sem luva" — estado do objeto | não é presença: é critério de `estado`, pela nuvem ou por modelo de linguagem local (**fase 3**) |
| pessoa parcialmente fora do quadro | limite do modelo; mitiga-se com o enquadramento da área |
| a imagem do alerta com a caixa desenhada | junto com o envio de mídia do evento, que ainda não existe |

### Medido com a loja em operação (06/10/2026, 23h)

Os mesmos canais, agora com gente trabalhando. Só números saíram da loja.

| o que foi medido | resultado |
|---|---|
| pessoa de perto, vista de cima, cortada pela borda (canal 4) | **0,72** no quadro inteiro do sub; **0,97** num ladrilho do fluxo principal |
| pessoa de corpo inteiro (canal 1) | 0,92 no sub; 0,97 no ladrilho |
| embalagem aberta com o lanche dentro | "tigela" 0,22 no sub, **0,66** no ladrilho do principal — o detector não conhece a embalagem |
| copo | nenhum em cena; nada medido |
| canal 14 | tinha imagem à tarde; às 23h, tela de "sem sinal" |

**O que isso diz:** 0,72 está a dois centésimos do limiar. Naquele canal uma
regra de "posto ocupado" vai oscilar entre `conforme` e `nao_avaliavel`
conforme a pessoa se mexe. O modelo recebe o quadro inteiro reduzido a
384×384; cortado em seis ladrilhos, a mesma pessoa vai a 0,97. Julgar em
ladrilhos custa ~0,5 s por quadro nesta máquina — cabe na cadência de 30 s
com 14 canais. **Não construído**: primeiro a semana de operação mostra com
que frequência o `nao_avaliavel` aparece de verdade.

### A abertura dos canais em fila

Medido na mesma loja: os canais RTSP abrem **um de cada vez**, ~2,1 s cada
(14 canais ≈ 30 s). Depois de abertos, 15 quadros/s por canal, ~170 kbit/s
cada, ~4 % de processador com os 14. Não bloqueia; fica para investigar se
é o gravador ou o `open` do OpenCV segurando a fila.

**Respondido em 07/10/2026: é o OpenCV.** Ele abre um fluxo de cada vez. E
isso tinha um efeito pior que a fila: um canal cadastrado com o endereço
errado esperava 30 s por tentativa, e nesse tempo **nenhum outro canal
abria**. Corrigido — antes de chamar o OpenCV o agente pergunta à rede se o
gravador atende (1,5 s, fora da trava), e o OpenCV passa a desistir em 5 s
(ERR-030).

---

## A11 · A imagem que sai da loja: o borrão não borrava — 🟡 corrigido, cobertura parcial (06/10/2026)

### O que aconteceu

Para conferir uma medida, dois quadros foram trazidos de uma loja depois de
passarem por `recorte.borrar_rostos`, com "-borrado" no nome do arquivo. **Os
rostos estavam reconhecíveis.** As cópias foram apagadas; o defeito ficou.

Eram dois defeitos, um em cima do outro:

1. **O borrão não apagava.** O detector achava o rosto, a função devolvia
   `borrou=True`, e o que ela aplicava era um desfoque de 8% do lado do rosto
   — num rosto de 150 px, um sigma de ~2 px.
2. **Ninguém conferia.** Todos os testes do agente passam `borrar_rosto=False`
   ("o dublê não tem rosto"). Não havia um teste do borrão.

### A medida: depois de "borrar", o detector de rosto ainda acha um rosto ali?

Pontuação do próprio detector, em cinco rostos de câmeras da loja:

| | 107×125 px | 47×66 | 42×53 | 21×27 | 34×43 |
|---|---|---|---|---|---|
| antes | 0,93 | 0,65 | 0,86 | 0,78 | 0,62 |
| desfoque antigo | **0,93** | **0,65** | **0,86** | 0,75 | 0,64 |
| mosaico de 6 células | 0,46 | 0,19 | 0,53 | 0,80 | 0,54 |
| mosaico de 2 células | — | — | — | 0,19 | 0,33 |
| **uma cor só** | — | — | — | — | 0,12 |

O desfoque antigo não mudava nem a segunda casa. E rosto pequeno já é um
mosaico: reduzi-lo a seis células quase não tira nada. Só a cor única zera.

### O que foi corrigido

- O rosto achado vira **uma cor** (a média da região), com 25% de margem em
  volta da caixa — a caixa do detector vai da testa ao queixo, justa.
- `borrou=True` passa a significar exatamente "achei e apaguei pelo menos um".
  Caixa fora do quadro não conta.
- 13 testes, com um rosto no dublê, nos dois caminhos por onde a imagem sai:
  o preview e o que o motor guarda para o juiz. Oito deles falham no código
  antigo.

### O que NÃO está resolvido

| limite | consequência |
|---|---|
| o detector de rosto achou rosto em **3 de 8 canais com gente** | câmera de teto mostra rosto de cima, de lado ou longe. Imagem que sai da loja ainda pode levar rosto reconhecível |
| `borrou` não vai no evento | o motor descarta o retorno; não dá para responder depois "esta imagem saiu protegida?" |
| `borrar_rosto` é sempre ligado | critério que precise VER o rosto (máscara) hoje não tem como pedir isso |

### Proposta — aguardando decisão do dono

**Ocultar a pessoa, não o rosto.** O detector de objetos acha gente com 0,83 a
0,97 nestas câmeras — muito mais do que o de rosto acha rosto. Para toda
imagem que sai da loja, cada pessoa detectada vira um retângulo de uma cor.

- **Preview** (a única imagem que sai sem recorte): oculta pessoas sempre. Quem
  desenha uma área na tela não precisa ver quem está nela.
- **Critério de nuvem**: escolha por critério — *nada*, *rostos* ou *pessoas*.
  "Bancada limpa" não precisa de ninguém; "uso de touca" precisa da pessoa e
  fica com *rostos*.

Custa uma inferência a mais por imagem que sai (~90 ms) e exige o detector
instalado. Sem ele, cai para *rostos* e **avisa** — nunca em silêncio.

### Regra de trabalho que fica

Imagem de câmera de loja **não sai da loja para diagnóstico**. Mede-se lá e
trazem-se números. O casaco-que-parece-pessoa e o banquinho foram descobertos
olhando imagem; da próxima vez, quem olha é o dono, na tela dele.

---

## A12 · Base de equipamentos, classe dos canais e orçamento — ✅ os 4 passos (07/10/2026)

**Pedido do dono (07/10/2026):**

> Vamos montar uma base de dados de todos os equipamentos que já encontramos em
> pesquisas e nas verificações locais, com as especificações e as entregas
> reais. Não é informação sensível: pode ser JSON, bem leve, por modelo. Serve
> para montar orçamento conforme as respostas do usuário e o uso lógico de cada
> um. Classificar o equipamento em básico, intermediário, avançado. Classificar
> as câmeras, o setor ou o canal conforme a importância e a quantidade de usos
> de análise. Opção de deixar os canais rodando no PC de análise, pelo navegador.
>
> A base é de uso do projeto Monitor Farol, e não do usuário. Ao usuário só são
> apresentadas soluções e opções.

### O que já existia, e ninguém via

A migration 002 já tinha uma tabela `equipamento` com 21 modelos, o requisito
de cada tipo de análise (`requisito_uso`) e as tabelas do levantamento e do
diagnóstico. Sem tela, sem as medições de campo, sem nível. E o documento de
arquitetura de agosto tinha mais 15 modelos com faixa de preço que nunca
viraram cadastro.

### Decisões

- **A base é da distribuição.** O usuário não vê nem edita o catálogo; recebe
  soluções e opções. Nenhuma rota do console devolve o catálogo.
- **Um arquivo JSON por modelo é a fonte da verdade** (`catalogo/`). O banco
  guarda uma cópia, porque o orçamento cruza equipamento com loja. Modelo novo
  é arquivo novo — sem migration.
- **`medido` é separado de `specs`, e vence.** A ficha dizia "nunca o i7 versão
  F"; o PC da loja é um i7-10700F e sobra.
- **Preço sempre com data, fonte e confiança.**

### Os quatro passos

| passo | o quê | situação |
|---|---|---|
| **1 · a base** | `catalogo/`: 39 modelos, com nível, motivo, para que serve, preço datado e o que foi medido na loja. Conferida por teste a cada envio | ✅ feito |
| **2 · a carga** | a API copia os arquivos para o banco **a cada subida** (`api/src/catalogo.ts`): só a linha que mudou, nunca apaga, e arquivo com defeito não grava nada. A tabela ganha `nivel`, `medido`, `precos` e `fontes`. O requisito de cada uso veio para `catalogo/usos.json`. `/saude` devolve quantos modelos há no banco | ✅ feito (migration 015) |
| **3 · a classe do canal e o orçamento** | `GET /v1/lojas/:id/orcamento` e a tela **Loja → Orçamento**: carga de cada canal, o que precisa enxergar, opções por nível e três pacotes | ✅ feito (migration 016) |
| **4 · os canais no navegador do PC de análise** | `farol-agent servir --visor`: o mosaico em `http://127.0.0.1:8765`, só neste computador | ✅ feito |

### Passo 3 — a classe de cada canal sai do uso, e o orçamento sai da classe ✅

A conta mora em `api/src/orcamento.ts` — pura, sem banco. A rota
`GET /v1/lojas/:id/orcamento` só junta o que ela precisa; a tela é
**Loja → Orçamento**.

**Duas leituras de cada canal, e são perguntas diferentes:**

| | de onde sai | o que dimensiona |
|---|---|---|
| **quanto é usado** | dos critérios que valem nele: 120 capturas por hora × os quadros que cada uso julga por análise | computador e rede |
| **o que precisa enxergar** | do uso mais exigente entre os critérios dele (px por cm, cor, WDR, julgamento na loja) | a câmera |

Um canal com dez critérios de presença é muito usado e serve com qualquer
câmera; um canal com um único critério de leitura é pouco usado e precisa da
melhor.

| carga | quadros julgados por hora | exemplo |
|---|---|---|
| sem uso | 0 | nenhum critério |
| leve | até 120 | um critério simples |
| moderada | até 480 | dois a quatro critérios simples |
| intensa | acima | cinco ou mais — ou um só critério de ação, que julga 8 quadros por análise |

Conta o uso **previsto**: critério cadastrado e desligado entra, porque foi
para usá-lo que a loja o cadastrou.

**A importância** (`ponto.importancia`: crítico, normal, baixo — migration 016)
é o único dado que só o dono sabe. Ela **ordena** — crítico primeiro, depois o
mais usado — e não muda o que o canal precisa.

**As opções:** para cada canal, até três câmeras — uma por nível — entre as que
servem a **todos** os usos dele. Para critério de estado não se oferece câmera
básica: ela não fecha o quadro. Dentro do nível, a recomendada vem antes; entre
iguais, a mais barata.

**Os três pacotes:** cada um usa, em cada canal, a opção daquele nível; quando
não há opção daquele nível que sirva, sobe — e diz por quê. Câmera que **já
atende** (óptica informada e px por cm suficiente) não entra. Gravador e
computador entram com o porte que a loja exige, e a tela avisa para tirá-los da
conta se a loja já os tem. Soma parcial é dita como parcial: o que não tem
preço não entra no total, e o cartão mostra "+ N itens sem preço" ao lado do
número.

**O computador só pede placa de vídeo** quando há critério que só um modelo de
visão julga (estado, ação) **e** a imagem não pode sair da loja. Presença e
contagem nunca pedem.

**O que chega ao usuário é solução, não catálogo:** marca, modelo, nível, a
razão do nível e a faixa de preço. Equipamento descartado nem é lido do banco;
observação interna, fonte e medição de campo não entram na consulta — e um
teste confere isso pelo conteúdo, modelo a modelo. Só quem configura a loja
(gerente, presidente, suporte) vê o orçamento.

**Os preços** de dez modelos que estavam sem cotação foram buscados em lojas
brasileiras em 07/10/2026 e entraram como `indice` — vieram de resultado de
busca, não de página conferida. A tela mostra a origem e a data ao lado de cada
valor.

**O que não faz ainda:**

| limite | caminho |
|---|---|
| a variante do uso (estado que depende de **cor**, **leitura** de etiqueta, **montagem**) não existe no critério — só o tipo | um campo no critério; aí o canal pede a câmera certa para cor à noite ou leitura |
| não sabe o que a loja **já tem** de gravador e computador | o levantamento (`levantamento_item`, da migration 002) — a mesma conta, alimentada pelas respostas do cliente |
| orçamento para quem **ainda não é cliente** (sem canal cadastrado) | o formulário de levantamento; a conta é a mesma |
| a frequência é fixa em 120 capturas por hora | quando a cadência por critério existir, a carga passa a usá-la |

### Passo 4 — os canais no navegador, no PC de análise ✅

`farol-agent servir --visor` (porta em `--visor-porta`, padrão 8765). A
página é servida pelo próprio agente — `agent/farol_agent/visor.py` — e
mostra o mosaico dos canais **cadastrados no console**, cada um com o nome e
quantos critérios valem nele. Clicar num canal amplia.

- **Só no próprio PC.** O servidor escuta em `127.0.0.1` e **não tem opção**
  para abrir na rede: a imagem não sai do computador e nada passa pela nuvem.
  É o mesmo que olhar a tela do gravador — por isso aqui não há borrão de
  rosto. Pedido que chega com nome de outro site é recusado.
- **Só abre câmera enquanto alguém olha.** O canal abre no primeiro quadro
  pedido e fecha depois de 20 s sem pedido; aba escondida não pede. Se a
  auditoria já tem o canal aberto, a página usa o quadro dela em vez de abrir
  uma segunda conexão com o gravador.
- **Não é MJPEG, de propósito.** O navegador limita em seis as conexões com o
  mesmo endereço; dezesseis fluxos contínuos mostrariam seis. Cada quadro é
  um pedido curto: medido com 16 canais na tela, 4 quadros por segundo em
  cada um.
- **A página não leva o cadastro do gravador:** endereço, usuário e
  referência de senha não saem do agente.
- Diz o que está acontecendo: "abrindo o canal…", "sem sinal" (a tela preta
  do gravador), ou o motivo de não abrir ("senha da câmera não encontrada").

**O que não faz:** não mostra canal que não está cadastrado no console (o
mosaico é do que a loja cadastrou, não dos 16 do gravador); não grava; e não
abre fora do PC — ver de outro computador é outra funcionalidade, com senha.

---

## A13 · O que o Farol viu: o resumo por hora — ✅ agente, API e tela (07/10/2026, migration 017)

### O problema

A nuvem só recebia o "não conforme" que virou alerta. O conforme, o "não deu
para avaliar", a câmera sem cena e o critério sem juiz ficavam na loja e
sumiam na limpeza. No console, **uma loja calada podia ser cozinha em ordem
ou sistema parado** — coisas opostas, com a mesma cara. A página "Painel" era
um texto dizendo que as telas viriam a seguir.

### O que foi construído

- **O agente conta, por hora, critério e canal, tudo o que olhou**
  (`fila.py`, tabela `resumo_hora` no SQLite da loja). Cada olhada termina em
  um de sete desfechos — sem juiz, sem quadro, sem cena, em silêncio,
  repetida, já julgada, enfileirada — e a soma deles é o número de capturas.
  O que foi enfileirado vira conforme, não conforme, não avaliável ou falha.
  A conta é somada **na hora em que a coisa acontece**, e não recontada da
  fila de análises: a fila é limpa, e um resumo que dependesse dela encolheria
  sozinho.
- **Câmera que não responde passou a deixar rastro.** A exceção saía do motor
  sem contar nada: canal morto ficava com zero olhadas, igual a canal sem
  critério. Agora conta como "sem quadro" e o erro segue subindo.
- **Critério sem juiz também.** Ele continua sem ser capturado (A10), mas
  entra no resumo com o motivo — é o que deixa o console dizer "falta instalar
  o detector" em vez de mostrar um critério ligado e mudo.
- **O agente manda o acumulado da hora e a nuvem substitui**
  (`POST /v1/resumos`, corpo em `contratos/resumo-do-agente.json`, lido pelos
  testes dos dois lados). A mesma linha sobe várias vezes enquanto a hora
  corre; um pedido repetido depois de uma queda de rede dá no mesmo. Sobe a
  cada 5 minutos, com estado próprio: recusa do resumo não segura evento, e o
  contrário também não.
- **A soma que chega durante a subida não se perde:** cada linha tem versão, e
  "a nuvem tem" só vale para a versão que subiu.
- **O texto de erro sobe sem segredo.** Motivo de falha vem de biblioteca, de
  modelo e de câmera; endereço com senha embutida, cabeçalho de autorização e
  chave de API são trocados por `…` antes de gravar.
- **A leitura** (`GET /v1/lojas/:id/resultados?periodo=24h|7d`): totais, série
  com todos os baldes no relógio **da loja**, uma linha por critério e canal,
  as últimas vezes fora do critério com o estado do aviso, e os **sinais**.
  Supervisão para cima, e o suporte.

### Os sinais

Apontam defeito **do Farol**, não da cozinha — "não conforme" é resultado e
fica nos números. A conta está em `api/src/resultados.ts`, sem banco.

| sinal | quando | por que esse limiar |
|---|---|---|
| sem agente / agente fora | nenhum agente batendo há mais de 5 min | o mesmo limite que o console já usava |
| canal sem imagem | 80% do que foi olhado na hora corrente e na anterior veio sem cena, com pelo menos 4 olhadas | só a hora corrente não decide: às 14h01 ela tem duas olhadas |
| critério sem juiz | 80% das olhadas sem ninguém que julgue | um sinal por **critério**, não por canal: a causa é uma só |
| julgamento falhando | 5 falhas ou mais, e mais falhas que julgamentos | uma falha em quarenta é oscilação de rede |
| avalia pouco | metade dos julgamentos sem resposta, com pelo menos 10 | por **canal**: a mesma pergunta pode ser respondível de uma câmera e não de outra |
| falta dizer o que procurar | presença ou contagem sem objeto | só existe em critério de antes da migration 013; a API já recusa criar assim |
| nunca olhado | ligado, com canal, sem horário próprio, e nenhuma olhada | critério de fim de semana numa quarta está certo em não ter sido olhado |

Com o agente fora, "canal sem imagem" e "nunca olhado" **não aparecem**: são
consequência, e dizer as duas coisas manda a pessoa olhar a câmera quando o
problema é o computador.

### Decisões

- **Agregado, e não um registro por olhada.** Oito canais a cada trinta
  segundos são 23 mil olhadas por dia, quase todas "nada mudou". O resumo
  responde "quanto" e "em que proporção" com uma linha por hora; o "o quê,
  exatamente" de um não conforme continua em `evento`. E sai menos coisa da
  loja.
- **A chave na nuvem tem o agente.** Agente reinstalado no meio da hora começa
  do zero; sem o agente na chave, ele apagaria o que o anterior contou. A
  leitura soma.
- **Soma e quantidade, não média.** Média de média erra quando as horas têm
  volumes diferentes.
- **Não se exige que o critério ainda valha no canal** para aceitar o resumo:
  tirar o critério do canal às 15h não apaga o que foi olhado às 14h. Exige-se
  que critério e canal sejam da loja do agente — os dois, na mesma consulta.

### O que NÃO faz

- "Desde quando" o canal está sem imagem tem precisão de **hora**, que é a do
  resumo.
- Item que expira na fila antes de ser julgado não entra em contador nenhum.
- Agente antigo não manda resumo; loja com agente de antes desta versão
  aparece sem números até ser atualizada.

---

## A14 · Console redesenhado — ✅ protótipo aprovado e portado para o app (07/10/2026)

Pedido do dono: web app minimalista, intuitivo, limpo, responsivo e dinâmico,
com animações e ícones modernos, usando o kit de marca — e **protótipo de
todas as telas para aprovação antes de mexer no app**.

### O protótipo

- Navegável, em `mockups/farol-console.html` (um arquivo, abre com dois
  cliques), com as fontes em `mockups/console/`. Oito telas: entrada, painel
  "o que o Farol viu", canais, área do canal, critérios, alertas, orçamento e
  lojas; tema claro e escuro; computador, tablet e celular.
- **Aprovado pelo dono em 07/10/2026**, com as seis decisões que vinham nele:
  tema claro e escuro seguindo o aparelho; botão principal na cor do
  logotipo, âmbar só para "olhe aqui"; a loja como contexto no topo;
  formulário em gaveta; fontes e ícones novos; filtro de ligados e
  desligados nos critérios.

### O que mudou no app

- **Uma navegação que muda de forma:** coluna à esquerda no computador, trilho
  no tablet, barra embaixo no celular. A loja é o contexto, no topo, e o menu
  é o da loja escolhida: Painel, Canais, Critérios, Alertas e Orçamento.
- **A moldura não recarrega** ao trocar de tela (`app/(console)/layout.tsx`):
  ela guarda quem está usando, as lojas e a saúde do agente, e as telas leem
  de lá (`useConsole`).
- **O agente fora do ar aparece em toda tela**, e não só no painel: faixa no
  topo, ponto ao lado da loja e o bloco do agente na navegação.
- **A tela "O que o Farol viu"** (A13) é o painel de cada loja: saúde, números,
  gráfico por hora ou por dia, o que precisa de atenção, a tabela por critério
  e canal e as últimas vezes fora do critério.
- **Criar e editar acontecem em gaveta** (folha que sobe, no celular);
  excluir pergunta antes, dizendo a consequência, com o foco no Cancelar.
- **Tabela vira cartões no celular** em vez de rolar de lado.
- Peças em `web/componentes/ui/`; cores como variáveis em `globals.css`, nos
  dois temas; fontes servidas pelo próprio app (`@fontsource-variable`), sem
  pedido a servidor de fontes; ícones `lucide-react`.

### O que a API ganhou

`GET /v1/lojas` passou a trazer, de cada loja, os critérios, os agentes, há
quanto tempo o agente não bate e o resultado das últimas 24 horas — numa
consulta só para todas as lojas da conta. **Execução não recebe o resultado**:
a tela de resultados já é fechada para ela, e a lista não pode ser porta
lateral. Guardado por `api/testes/lista-de-lojas.test.ts`, que foi conferido
estragando o código de cinco jeitos (os cinco foram pegos).

### Conferido em navegador de verdade

Contra o build de produção e a API local: as oito telas em 1440, 1024, 768 e
375 px, nos dois temas — sem rolagem lateral e sem erro de script ou de rede.
E **usando** a tela, com clique de mouse: abrir e fechar cada gaveta, criar,
editar e excluir um canal, os menus, as chaves, o filtro, as abas, a troca de
período, de loja e de tema; como supervisão (vê, não configura), como
execução (não vê resultado) e numa conta vazia (os estados vazios).

Usar a tela achou o que a foto não mostra: **o menu "…" abria 290 px para o
lado e atrás dos cartões de baixo.** A animação de entrada da seção terminava
com `animation-fill-mode: both`, e o navegador segurava um `transform`
identidade para sempre — o que basta para a seção virar a referência de todo
`position: fixed` dentro dela. O menu passou a ser desenhado fora da seção, e
as animações de entrada usam `backwards`.

### Diferente do protótipo

Duas coisas que o protótipo mostra e o app **não faz**, porque dependem de uma
decisão que não é da tela — ficam para o dono decidir:

- **"Pacote indicado" no orçamento.** A API calcula os três caminhos e não
  escolhe um. Destacar um deles pede uma regra de negócio (qual pacote se
  indica, e por quê); a tela não inventa.
- **"Pontos de atenção" no cartão de cada loja.** Os sinais são calculados por
  loja, no painel dela. Trazê-los na lista é calcular os de todas as lojas a
  cada batida da moldura (30 s). No lugar, o cartão mostra a saúde do agente
  e o percentual conforme em 24 horas.

E quatro de propósito:

- **No orçamento, as câmeras que servem a cada canal ficam recolhidas**, menos
  as do primeiro: com oito canais, tudo aberto era uma página de catálogo.
- **"Novo canal" deixa cadastrar o setor ali mesmo.**
- **No celular, as abas dos Alertas vão sem ícone:** com ele, a terceira
  ficava cortada na borda.
- **"Sem imagem desde as 14h"** tem precisão de hora, que é a do resumo.

Por ordem do dono (07/10/2026), "pacote indicado" e "pontos de atenção na
lista de lojas" ficam como **pendência**: não cobrar, não construir até ele
retomar.

---

## A15 · Os critérios de uma loja de verdade — 🟡 primeira noite (07/10/2026)

O dono cadastrou seis canais e sete critérios na loja de teste (hamburgueria)
para o expediente da noite servir de escola. Premissa dele: **critério varia
muito** — cada usuário, em cada loja, terá os seus; há os padrões
(atendimento, chapa, montagem) e sempre haverá ações específicas. E decisão
dele: **LGPD fica para o fim do projeto**, para não atrasar o desenvolvimento.

### O que cada tipo consegue hoje

No serviço existem dois juízes: o detector, na loja, e o modelo de nuvem.

| tipo | quem julga | precisa de |
|---|---|---|
| presença, contagem | detector local | "o que procurar" preenchido, com um dos 17 objetos |
| estado, ação (não urgente) | nuvem | a chave no PC da loja; loja em modo nuvem ou híbrido |
| estado, ação **urgente** | binário ou modelo local | não instalado em loja nenhuma: fica sem quem julgue |
| comparação | juiz de comparação | **não é montado no serviço**: fica sem quem julgue |

"Ação" é julgada por **uma foto**, igual a estado — a tela diz "sequência com
etapas", e sequência não é avaliada.

### O que os sete critérios mostraram

| critério | o que se viu |
|---|---|
| Fila de atendimento (contagem) | cadastrada como "de 5 a 8 pessoas" querendo dizer "avise com 5 a 8". O sistema leu como a faixa **certa** e acusou a loja vazia. A tela pergunta o que é aceitável; quem cadastra pensa no que quer ser avisado |
| Presença no atendimento, tempo de setor na chapa (presença) | o detector julga "tem alguém"; o que se quer é **tempo** com o posto vazio |
| Uso da chapa clamshell (ação) | com o quadro inteiro reduzido a 640 px, o modelo respondeu "o ângulo e a distância não permitem avaliar os platens" — que no quadro original se veem bem. Falta área; e carregar a chapa também é "carne com platen levantado", por segundos |
| Uniforme (estado) | quatro peças num critério só; "touca padrão da loja" pede referência |
| Gaveta do caixa (ação) | abrir a gaveta dura segundos e a olhada é a cada 30 s; "colaborador × entregador" só por uniforme ou lado do balcão |
| Produto (contagem) | é contador de produção: outra ferramenta |

Fora isso: o canal do caixa principal estava cadastrado com o número de um
corredor (só olhando a imagem se viu), e **não há horário de funcionamento na
tela** — a API aceita `janelas`, o formulário não tem. Com a loja fechada,
presença e fila geraram 8 avisos falsos em minutos.

### O que mudou no agente

**Presença e contagem são julgadas em toda olhada.** Depois de cada aviso o
critério ficava quinze minutos sem ser julgado (14 de 16 olhadas), e o posto
vazio — a mesma imagem por meia hora — sumia como "repetida" ou "já julgada".
Não se media tempo nenhum. Nesses dois tipos quem julga é o detector, na
loja: não há chamada a economizar. Agora a olhada entra sempre, com chave
própria, e **o silêncio segura só o aviso**. A conta do tempo passa a existir
no resumo: cada olhada "fora do critério" é um intervalo de posto vazio (de 30
a 45 segundos nesta loja — o ciclo real, com quatro canais, passa dos 30).

O silêncio é conferido na hora do aviso, pelo canal do item, **para todo
tipo**. Fecha um furo antigo: duas olhadas que entravam na fila antes do
primeiro veredito viravam dois avisos. Estado e ação continuam pulando a
olhada no silêncio — lá cada uma custa.

### O que os critérios reais pedem, e não existe

1. Mostrar o tempo (posto ocupado X% do tempo, maior ausência) — os números
   já chegam; falta a tela dizer.
2. Horário de funcionamento — **feito** (migration 018; telas aprovadas e
   entregues junto com as áreas). Ver abaixo.
3. Mais de uma área por canal, cada área com os seus critérios — **feito**
   (migration 019). Ver abaixo.
4. A pergunta da contagem na língua de quem cadastra: "avisar quando passar
   de N".
5. "Só avisa se continuar assim" por algumas olhadas.
6. Referência da loja: "isto é o certo, isto é o errado". O juiz de nuvem já
   aceita fotos de referência; o console não tem como mandar.
7. Disparo por movimento na área, para evento de segundos.
8. Contador de produção.
9. Antes de ligar: testar o critério nas imagens do canal e responder
   "consigo avaliar" ou "não consigo, porque…".
10. O detector como porta da nuvem: critério que depende de gente (uniforme,
    gaveta) só vai ao modelo quando o detector vê alguém na área. Com a loja
    fechada os três critérios de nuvem foram julgados uma vez por minuto
    cada — o relógio que o gravador escreve na imagem muda o quadro — para
    responder "não há ninguém".

### Horário de funcionamento (migration 018)

Pedido do dono, na mesma noite: "colocar horário de funcionamento da loja.
opção de classificar quais análises são feitas no horário e quais são feitas
fora do horário".

- **O horário é da loja; o critério só diz de que lado fica.**
  `loja.horario_funcionamento` guarda quando ela abre, no formato das janelas
  do critério. `regra.quando` diz se o critério é conferido **no horário**,
  **fora do horário** ou **sempre**. Mudou o horário da loja, mudou para todos
  — ninguém edita vinte critérios porque a sexta passou a fechar à uma.
- **Sem horário informado, a loja vale como sempre aberta.** É como era, e é o
  que impede uma loja de ficar sem auditoria por falta de um cadastro. Nela,
  critério "fora do horário" não roda nunca, e a tela precisa dizer isso.
- **O padrão é "no horário"**, inclusive para os critérios que já existem.
- **A madrugada pertence ao dia em que a loja abriu.** Sexta das 18h à 1h
  cobre o sábado à 0h30, e não a sexta à 0h30. A janela do critério no agente
  conferia só o dia de hoje e errava os dois lados; foi corrigida junto.
- **Quem decide se confere é o agente**, com o relógio do computador da loja.
  Fora da hora o critério não vale: nem câmera, nem fila, nem juiz, nem
  olhada no resumo. A API usa a mesma conta para dizer "aberta agora" na
  tela — os dois lados leem os mesmos casos em
  `contratos/horario-de-funcionamento.json`.
- **O sinal "nunca olhado"** deixa de acusar critério que só roda com a loja
  aberta.
- Agente antigo ignora os dois campos e segue como estava.
- **Na tela** (protótipo aprovado pelo dono em 07/10/2026): uma faixa no
  alto de Critérios diz o horário e se a loja está aberta agora ("aberta
  agora · fecha às 23:00"); o horário se edita numa gaveta, dia a dia, com
  seletor de hora; o formulário do critério pergunta "Em que horário
  conferir"; o cartão do critério mostra "fora do horário" ou "sempre"
  (o padrão, "no horário", não ganha etiqueta); o painel avisa quando a
  loja está fechada e os critérios do horário esperam.

### Mais de uma área por canal (migration 019)

Pedido do dono: a câmera do caixa confere presença **dentro do balcão** e
fila **do lado do cliente** — "cada área pode ter seu critério diferente;
o critério, mesmo sendo no canal, fica destinado à área marcada".

- **O banco já tinha área por canal** (`zona`) e critério por área
  (`regra_alvo`); faltava criar a segunda. A 019 acrescenta só a exclusão
  por marca (`zona.excluida_em`) e o nome único por canal.
- **Canal com uma área só continua igual**: marca-se o canal. Com mais de
  uma, o canal deixa de ter caixa de marcar e o critério é posto **na
  área** — na árvore do formulário e na tela de critérios, que agrupa por
  área. O painel passa a dizer "canal · área".
- **Excluir uma área é marcar**: o que ela registrou fica no histórico. Os
  critérios saem dela; o que ficar sem lugar nenhum é desligado e vai para
  "Sem canal". A última área do canal não se exclui. Excluída a principal,
  a mais antiga assume. O diálogo diz isso antes, com o nome dos critérios.
- **Até 8 áreas por canal.** Cada área com critério de nuvem é uma imagem
  a mais por olhada; oito é teto, não meta.
- **Área nova nasce no meio do quadro, sem critério** — nada passa a ser
  verificado só por criar. Mexer em área é de quem configura (gerente);
  antes a supervisão conseguia renomear, e não devia.
- **Na imagem, clique seleciona e arrasto desenha.** Toda loja começa com
  a área "Quadro inteiro" cobrindo a imagem; se apertar sobre outra área
  já trocasse a seleção, não haveria onde desenhar a segunda (ERR-035 —
  estava assim no protótipo, e só apareceu usando a tela a partir do
  estado real). O clique vale para a menor área sob o ponteiro.
- **No agente**, duas coisas ainda identificavam o julgamento por canal +
  critério, sem a área: o nome da imagem guardada e a chave da fila. Com
  o mesmo critério em duas áreas do mesmo canal, a segunda imagem gravava
  por cima da primeira e as duas áreas saíam com o veredito da segunda
  (ERR-034). A área entrou nos dois. **O agente da loja precisa ser o
  desta versão antes de alguém marcar o mesmo critério em duas áreas de um
  canal.**
- O recorte que vai ao juiz é o retângulo da área **com 5% de margem**: ao
  desenhar "dentro do balcão", deixar folga do lado de dentro, não em cima
  da linha do balcão.

### Análises: hora a hora, onde foi julgado e quanto custou (migration 020)

Pedido do dono, com a loja em operação: apresentar melhor o resultado das
análises — "usando gráficos, filtrar por horas, análises de somente um
canal, em determinada hora; das análises, quais foram locais e quais foram
nuvem", e "média de custo, total de custos dentro do período apresentado,
quando análises na nuvem". Perguntou também se valia criar um agente local
para tratar e apresentar os resultados.

**O que a primeira noite mediu** (07/10, das 16h às 20h, 7 critérios):
1.061 análises julgadas na loja pelo detector (0,09 s cada, sem custo por
análise) e 503 na nuvem (2,1 s cada; R$ 6,59 no total, 1,3 centavo cada —
de R$ 1,50 a R$ 2,60 por hora com três critérios de nuvem).

- **Não é preciso outro agente para apresentar.** Os números já sobem
  prontos, por hora, critério e área; faltavam dois contadores e a tela.
  Um resumo escrito por IA ("o que aconteceu no turno") pode vir depois,
  por cima dos MESMOS números — texto sobre contagem, sem imagem — e não
  entra antes de a tela de números existir.
- **O resumo por hora passa a dizer onde julgou**: `julgadas_loja` e
  `julgadas_nuvem`. "Na loja" é o que roda no computador dela (detector,
  modelo local, comparação); só a nuvem manda a imagem para fora e tem
  custo por análise.
- **Sem preenchimento retroativo.** O que o agente não informou — linha
  antiga, agente antigo, a hora da atualização — é repartido NA LEITURA
  pelo tipo do critério (presença, contagem e comparação na loja; estado e
  ação na nuvem), que é o que o serviço fazia até aqui. A regra mora num
  lugar só (`api/src/analises.ts`) e a soma loja + nuvem fecha sempre com
  o que foi julgado.
- **`GET /v1/lojas/:id/analises?de=&ate=`** entrega o miúdo: uma célula por
  dia, hora, critério e área (até 31 dias), no relógio da loja, com
  análises, resultado, loja × nuvem, custo e tempo. A tela recorta e soma
  sem voltar ao servidor a cada filtro.
- **O custo é estimativa**: o preço de tabela do modelo, convertido com o
  dólar fixo do agente (`FAROL_DOLAR`, R$ 5,40). A conta de verdade é a
  fatura do provedor. A tela tem de dizer isso.
- **"Fora do critério" é contagem; "aviso" é registro.** Toda olhada fora
  do critério é contada. Só vira aviso — com hora, motivo e imagem — a que
  passa pela confiança mínima e pelo silêncio do critério. A lista da tela
  é de avisos, e o número ao lado dela é o de avisos, não o de "fora".
- **A tela** ("Análises", item novo na navegação): filtros de período,
  horas, canal, critério e onde foi julgado; seis números do recorte; um
  gráfico hora a hora que também é filtro, com três vistas (resultado,
  onde julgou, custo); por canal; por critério e canal; avisos do recorte.
  **Protótipo em aprovação** (branch `feat/analises-graficos`).

### Fica para o fim (por decisão do dono)

Ocultar a pessoa na imagem que vai à nuvem; limpeza das imagens julgadas no
PC da loja (`limpar_concluidos` existe e ninguém chama — com a medida a cada
olhada o disco cresce 0,6 GB por dia nesta loja, medido); consentimento e
prazo de guarda.

---

## A8 · Busca investigativa nas gravações (plano)

**Definição do dono (06/10/2026):** não é monitoramento. É pergunta
pontual, feita por uma pessoa, sobre algo que já passou e que **nenhum
critério cobria** — "alguém pegou a sacola às 15h?".

E, decisivo para o desenho: **não tem pressa.** A tela avisa que vai
demorar X minutos e manda o resultado pelo mesmo caminho dos alertas.
Isso muda tudo — o que seria inviável em tempo real fica confortável.

### Por que força bruta está morta

8 horas de um canal a 30 fps são 864 mil quadros. A R$ 0,0107 cada:
**R$ 9.245 por busca.** Qualquer desenho que analise tudo morre aqui.

### O funil, do mais barato ao mais caro

1. **Já analisado?** Se o período cruza eventos julgados, a resposta sai
   do `evento.embedding` — busca semântica sobre o que já existe. Custo
   zero. É o que aquela coluna no esquema de 001 antecipava.
2. **Índice de movimento do gravador.** Só os trechos com movimento são
   candidatos. ⚠️ **Precisa de bancada:** o MHDX já nos surpreendeu três
   vezes, e não se afirma o que a CGI dele faz sem testar.
3. **Diferença de quadro na área marcada**, pelo sub-stream, em amostragem
   grossa. Sem modelo, só aritmética de pixels. É aqui que marcar o lugar
   na busca paga: a comparação ignora o resto da cena.
4. **Detector local** nos candidatos (A2.3).
5. **VLM** só nos finalistas — e **local**, não na nuvem.

### Bissecção, não varredura

Quando a pergunta é de **transição** — "quando o copo apareceu?" — não se
varre: se bissecciona. Se às 14h não havia e às 18h havia, olha-se 16h.
Oito horas viram ~13 análises em vez de milhares. E transição é a forma da
maioria das perguntas reais: quando sujou, quando saiu, quando a fila
começou.

### Análise local: já existe

`JuizLocal` está implementado — fala `chat/completions` (vLLM, Ollama,
llama.cpp), só biblioteca padrão, raciocínio desligado de propósito. Falta
**o servidor de modelo na máquina com GPU**, não o código.

É o que torna a busca viável: milhares de quadros a custo de energia, não
de token. Uma busca que custaria R$ 9 mil na nuvem custa o tempo da
máquina.

### Rodar nas sombras

A busca é um **trabalho longo, de baixa prioridade, retomável**:

- **Cede a vez à análise ao vivo, sempre.** Uma busca não pode atrasar um
  alerta de agora. A regra que vale: trabalho de investigação só avança
  quando não há nada da operação na fila.
- **Retomável de verdade.** O PC de loja reinicia, cai luz, Windows
  atualiza. A busca guarda até onde chegou e continua — senão sete
  minutos perdidos viram "nunca mais uso isso".
- **Janela própria.** Fora do horário de operação ela pode usar a máquina
  inteira.
- **Teto declarado.** A tela diz "isto vai analisar até N quadros" antes
  de começar, e a busca para ao atingir o teto dizendo o que examinou. Sem
  teto, uma pergunta mal feita come a madrugada.

### O que o período de gravação impõe

A tela pergunta ao gravador **o que ele realmente tem** antes de deixar
escolher as datas. Buscar no que já foi sobrescrito devolve "não achei"
quando a resposta certa é "isso não existe mais" — e as duas levam a
decisões opostas.
