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

> **Estudo do Frigate** (07/10/2026), a pedido do dono:
> [`estudo-frigate.md`](estudo-frigate.md). Conclusão: não substitui o agente
> (Linux, vídeo contínuo, sem critério em linguagem natural), mas três
> ideias dele atacam os itens 1, 6, 7 e 10 desta lista — estado ensinado
> com exemplos da loja, gatilho por movimento na área e permanência
> seguindo o objeto. Aguardando decisão.

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
- **A tela** ("Análises", item novo na navegação, só para quem vê os
  resultados): filtros de período, horas, canal, critério e onde foi
  julgado; seis números do recorte; um gráfico hora a hora que também é
  filtro, com três vistas (resultado, onde julgou, custo); por canal; por
  critério e canal; avisos do recorte. **Protótipo aprovado pelo dono em
  07/10/2026 e portado para `web/`.**
- **Só o período vai ao servidor.** A rota entrega as células do período e
  o navegador recorta e soma: hora, canal, critério e "onde foi julgado"
  respondem na hora. A conta mora em `web/componentes/analises/conta.ts`.
- **"Na loja" × "na nuvem" no filtro**: a célula inteira fica do lado da
  maioria, para as duas partes somarem sempre o total. Um critério é
  julgado num lugar só; a célula mista é a hora em que o agente trocou de
  juiz.
- **Hoje se atualiza sozinho** (a cada minuto, com a aba à vista); dia que
  já passou não muda e não é consultado de novo.
- **Pedido seguinte do dono, ao aprovar**: "incluir análise de uso do
  servidor de análise, a máquina local; opção de analisar uso junto com os
  filtros". O bloco "Máquina de análise" (processador, memória, placa de
  vídeo e disco do computador da loja, hora a hora, seguindo o período e
  as horas) está no protótipo, **em aprovação**; a tela do app entra sem
  ele. O que acompanha canal e critério é o TEMPO de julgamento, que sai
  das próprias análises — o uso da máquina é dela inteira.

### O uso da máquina de análise (migration 021)

Pedido do dono ao aprovar a tela de Análises: "incluir análise de uso do
servidor de análise, a máquina local; opção de analisar uso junto com os
filtros". A pergunta por trás é de capacidade: o computador da loja está
dando conta? cabe mais uma câmera, mais um critério?

A máquina da loja de teste: Intel Core i7-10700F (8 núcleos, 16 fios),
16 GB de memória, Radeon RX 560, disco de 223 GB com 64 livres. Numa noite
com 7 critérios o processo do agente ficou perto de 2% do processador da
máquina e 355 MB de memória.

- **O agente mede a cada volta** (uns trinta segundos) e guarda por hora:
  processador, memória e placa de vídeo da máquina inteira; a parte do
  próprio agente (processador e memória); e o disco livre onde ficam a
  fila e as imagens.
- **Sem dependência nova.** O pacote do agente é trocado na loja sem
  instalar nada pela rede, então nada de `psutil`: no Windows os números
  vêm das chamadas que o Gerenciador de Tarefas usa (`kernel32`, `psapi` e
  os contadores `GPU Engine`), por `ctypes`; no Linux, de `/proc`.
- **"Não medi" não é zero.** Cada peça tem a sua quantidade de amostras;
  máquina sem contador de placa de vídeo manda zero amostras dela e a tela
  diz "sem medida". Peça que falha três vezes seguidas para de ser tentada.
- **O pico é carga sustentada**: a maior média de meio minuto da hora, não
  um estouro de meio segundo. É o que interessa a quem decide comprar
  máquina.
- **A placa de vídeo é o maior motor**, somando os processos de cada um —
  a conta do Gerenciador de Tarefas. Somar motores diferentes passaria de
  100% numa placa fazendo duas coisas.
- **Medir nunca derruba a auditoria**: toda leitura é protegida, e a subida
  do uso tem estado próprio — nuvem antiga, sem a rota, não custa um
  evento nem um resumo.
- **`POST /v1/uso`** recebe o acumulado da hora e troca (como o resumo);
  **`GET /v1/lojas/:id/analises`** devolve o uso das mesmas horas, por
  máquina, com soma, quantidade e pico de cada peça, e de que a máquina é
  feita (`agente.maquina`).
- **O que acompanha os filtros.** O uso é da máquina inteira: segue o
  período e as horas, não o canal nem o critério. O que responde a canal e
  critério é o TEMPO que a máquina passou julgando, que sai das próprias
  análises (a latência somada das julgadas na loja).
- **A tela**: o bloco "Máquina de análise", dentro de Análises —
  **aprovado pelo dono em 07/10/2026 e portado para `web/`**. Usa as
  mesmas colunas do gráfico de análises e também escolhe a hora; com mais
  de uma máquina na loja, aparece um seletor. O ritmo do disco ("0,6 GB a
  menos por dia") só é dito com seis horas ou mais entre a primeira e a
  última leitura do recorte.

### Fica para o fim (por decisão do dono)

Ocultar a pessoa na imagem que vai à nuvem; limpeza das imagens julgadas no
PC da loja (`limpar_concluidos` existe e ninguém chama — com a medida a cada
olhada o disco cresce 0,6 GB por dia nesta loja, medido); consentimento e
prazo de guarda.

---

## A16 · Local primeiro, o ambiente e o padrão da loja (aprovado em 08/10/2026 — as cinco fases feitas)

Na noite de 07/10/2026, com a loja em operação e a tela de Análises no ar, o
dono deu a direção das próximas semanas, em cinco pedidos:

1. **Esquema do ambiente** — "um desenho do ambiente onde os canais estão e o
   posicionamento nesse ambiente, como se fosse algo 3D".
2. **Foto padrão** — "uma foto padrão do ambiente limpo e organizado para
   padrão de comparação".
3. **Local primeiro** — "temos que melhorar a análise local e depender da
   nuvem em último caso; melhorar a programação de análise, já que está
   gastando pouco do PC servidor".
4. **Motor de padrões** — "com uma semana de uso verificar as análises e ir
   criando um padrão de funcionamento; liberar descrição de funcionamento por
   setor; e o que saiu do padrão, para análise e correção do responsável pela
   loja — as correções servem para aprimorar ou até criar critérios".
5. **As três lentes e o especialista** — frequência ("comportamentos,
   frequências e dados recorrentes; tem relação entre os dados X e Y?"),
   anomalia ("algo que fuja completamente do comportamento padrão e mereça
   atenção"), tendência ("o que esses dados sugerem sobre o que pode
   acontecer a seguir"); "como se estivesse um especialista em análises de
   comportamento embutido no projeto, definindo padrões, saídas do padrão,
   sugestões de ação", ajudando a "aprimorar os critérios e melhorar o
   controle".

### O que o primeiro dia mediu

Lido na fila do agente da loja às 23h07 de 07/10/2026, só números, com o dia
ainda correndo.

| | |
|---|---|
| Análises na nuvem no dia | 856 |
| …que voltaram "não deu para avaliar" | **802 (94%)** |
| Gasto do dia na nuvem | R$ 11,24 |
| …gasto em "não deu para avaliar" | **R$ 10,56 (94%)** |
| Análises na loja (detector) | 2.073, sem custo |
| Uso da máquina com a loja aberta | processador ~3%, placa de vídeo < 1%, memória 50% |

Por critério de nuvem:

| critério | canal | análises | deram veredito | gasto |
|---|---|---|---|---|
| Uso da gaveta do caixa (ação) | 2 | 374 | 14 (4%) | R$ 4,97 |
| Uniforme (estado) | 6 | 246 | 25 (10%) | R$ 3,15 |
| Uso da chapa (ação) | 6 | 236 | 15 (6%) | R$ 3,12 |

E o cruzamento que justifica o porteiro, no canal 6 (o único em que o
detector também olha): das 482 chamadas à nuvem, **271 foram feitas sem
ninguém na imagem — e nenhuma delas deu veredito**; 195 tinham alguém; 16 não
tinham olhada do detector por perto para comparar.

Três causas, e cada uma pede um remédio diferente:

1. **Ninguém na imagem** (271 de 482 no canal 6). A loja já sabia, de graça.
   → o porteiro (fase 1).
2. **"O ângulo e a resolução não permitem"** — tirando as chamadas sem
   ninguém, o canal 6 ainda só deu veredito em 40 das 211 que sobram, e a
   gaveta do caixa em 14 de 374. A pergunta é feita sobre o quadro inteiro,
   pequeno. → área marcada (já existe, falta desenhar) e foto padrão (fase 2).
3. **A ação não estava acontecendo naquele instante** ("não há proteína sendo
   colocada na chapa no momento"). Um quadro solto não julga uma ação: na
   maior parte do tempo não há o que avaliar, e isso hoje é cobrado e contado
   como "não deu para avaliar". → só perguntar quando houver movimento na
   área (fase 3) e, no limite, a análise de sequência do roteiro original.

O porteiro, sozinho, não resolve: no canal 6 ele tira 56% das chamadas, e as
que sobram ainda voltam sem veredito quatro vezes em cinco. No canal 2 não dá
para dizer quanto tira — nenhum critério de pessoa olha aquele canal hoje.

### O que já existe e não está ligado

O desenho de "local primeiro" já está no código desde a A2.4 e a A3.5:

- **Base de conhecimento** (`base_conhecimento`, `base_frame`, migration 001):
  tipo `padrao` = "a cena inteira num estado (bancada limpa, passagem
  livre)". É a "foto padrão" do pedido 2.
- **`JuizComparacao`**: compara o quadro com a base e decide em três faixas —
  parecido → conforme, de graça; **na dúvida → escala para um modelo**;
  muito diferente → destoa. "Nuvem em último caso" é o comportamento dele.
- **Referência no pedido à nuvem** (`juizes/nuvem.py`, feito): a foto padrão
  vai junto com a cena, e a pergunta deixa de ser "está limpo?" para ser "o
  que mudou em relação a isto?".
- **Falta**: a tela para capturar o padrão, levar as fotos ao agente, o
  modelo de comparação instalado na loja, e montar o juiz no serviço.
- **Não cabe nesta máquina como está**: o juiz local por modelo de linguagem
  com visão (`JuizLocal`) foi previsto com um modelo de 9 bilhões de
  parâmetros; a Radeon RX 560 da loja tem 4 GB de memória de vídeo. Um
  modelo menor que caiba é medição a fazer no ensaio, não promessa.

### As fases, na ordem proposta

A ordem é de quanto cada uma devolve e do que depende — a do dono pode ser
outra, e é dele a decisão.

**Fase 0 · Coletar a medida — feito (PR #52, migration 022).** O agente
passa a guardar, por hora e por área, quantas pessoas o detector viu (soma,
quantidade e maior valor), e não só "conforme / fora". Sem isso o padrão não
tem do que ser feito. O agente da loja foi trocado em 07/10/2026, às 23h19: a
semana de dados corre desde então.

**Fase 1 · O porteiro: a loja decide se vale chamar a nuvem — feito
(08/10/2026, migration 023).** Cada critério que pode ir à nuvem diz quando
a pergunta faz sentido, em "Quando vale a pena conferir":

| opção | segura a olhada quando | para |
|---|---|---|
| em toda olhada | nunca (como era) | — |
| com pessoa na área | o detector não viu nem um "talvez" de pessoa | uniforme, touca, uso de equipamento |
| com a área livre | o detector viu alguém com certeza | limpeza e organização |
| quando algo se mexe | menos de 1,2% da cena mudou desde a olhada anterior | critério de ação |

Quem responde é o detector, de graça, dentro da loja. A olhada segurada é
contada como **"nada a conferir"** (`sem_condicao`, o oitavo desfecho de uma
olhada): não é análise, não vai à nuvem, não custa e não entra em "não deu
para avaliar". A tela de Análises diz quantas foram, por critério. Presença
e contagem não têm a escolha — já são julgadas na loja em toda olhada.

Junto vieram duas coisas da mesma gaveta, que estavam no protótipo aprovado:

- **"Avisar só se continuar"** (`confirmar_em`): o critério só avisa depois
  de ficar fora por 2, 3 ou 5 olhadas seguidas. Vale para todos os tipos.
- **A faixa de horas do critério** (`regra.janelas`, que já existia no
  banco, na API e no agente): ganhou o campo na tela.

*Como conferir:* no critério, escolher "Com pessoa na área" e ligar; em
Análises, a linha "N olhadas ficaram em nada a conferir" passa a aparecer, e
"não deu para avaliar" e o custo da nuvem daquele critério caem. Pelo que o
primeiro dia mediu, no canal 6 isso tira 56% das chamadas sem perder
veredito nenhum; nos outros canais é o próprio porteiro que passa a medir.
As decisões de desenho estão em `docs/decisoes.md` (08/10/2026, "O
porteiro").

**Fase 2 · Inventário, foto padrão e comparação na loja — feita (08/10/2026,
migrations 024, 025 e 026).** Duas referências do que é "limpo e no lugar",
guardadas uma vez:

- **Foto padrão do canal** — o quadro do ambiente limpo, organizado e sem
  ninguém (mais de uma: dia, noite). Vale para todas as áreas do canal:
  cada critério compara o recorte da sua área.
- **Inventário de equipamentos** (pedido do dono na madrugada de
  08/10/2026): "os equipamentos por setores, onde poderíamos ter até 4
  fotos do equipamento devidamente limpo, para identificar seu lugar no
  setor e padrão; uma única análise dele completa e sua descrição ficava
  guardada na base para ajudar em análises locais". Cada equipamento tem
  setor, tipo, até quatro fotos, onde aparece (canal e área) e a
  descrição — escrita **uma vez**, na nuvem, a partir das fotos, com a
  lista do que vale conferir nele. Na planta (fase 4), o equipamento é o
  próprio móvel desenhado.

A comparação é feita na loja: parecido com a referência → conforme, sem
custo; diferente → vai à nuvem **com a referência e a descrição ao lado**;
diferente por várias olhadas seguidas → aviso.

Dois limites, para não prometer errado:

1. **A loja compara com FOTO, não com texto.** A descrição serve à nuvem,
   a quem lê e à sugestão de critério. E a foto que vale para comparar é a
   **da própria câmera** — o recorte do equipamento no quadro do canal.
   Foto de celular, de perto, serve para descrever e identificar.
2. **O detector da loja não conhece "chapa" nem "fritadeira"** (ele conhece
   17 coisas: pessoa, copo, faca, geladeira…). O lugar do equipamento na
   imagem é marcado uma vez — à mão, ou sugerido pela análise única e
   ajustado —, não achado sozinho a cada olhada.

*Telas: Inventário (aba em Canais), a foto padrão na tela do canal, e
"comparação" no critério.*

**O que a foto padrão entregou (fase 2, primeira parte):**

- **Canais → Quadro e área:** "Guardar a de agora" copia o quadro do canal
  como foto padrão (até quatro por canal, com nome); o quadro ganhou as
  vistas *Agora*, *Foto padrão* e *Comparar* (divisor que se arrasta);
  excluir pergunta antes e diz o que deixa de ser conferido.
- **Critério de comparação:** julgado na loja contra a foto padrão do canal,
  no recorte da área. Igual → conforme, sem custo. Diferente → vai à nuvem
  com a foto ao lado (em loja de modo local: "não deu para avaliar"). Canal
  sem foto: "falta a foto padrão".
- **Critério de estado:** a caixa "Mandar a foto padrão do canal junto".
- **Medido antes de ligar** (loja, 08/10, só números): a mesma cena dá 0,96
  a 0,99 de semelhança; um pedaço de 0,2% da área fora do lugar, até 0,83.
  O limiar ficou em 0,90. Os números, o método e os limites estão em
  `docs/decisoes.md` (08/10/2026, "A foto padrão").
- **Não usou `base_conhecimento`:** a foto é por canal e nasce do quadro que
  já está no banco; ganhou a tabela `foto_padrao`.

*Como conferir:* em Canais → Quadro e área, guardar uma foto com o ambiente
em ordem; criar um critério de **comparação** naquele canal, com "Com a área
livre", e ligar. Em Análises, as olhadas com a cena igual à foto aparecem
como conformes **julgadas na loja**, sem custo; só as diferentes vão à
nuvem.

**O inventário (fase 2, segunda parte) — o cadastro está feito (08/10/2026,
migration 025).** Em Canais → Inventário:

- os equipamentos por setor, com tipo, até quatro fotos e a descrição;
- duas origens de foto: **o quadro de um canal** (cópia do quadro, com o
  desenho da área — é o que diz **onde o equipamento aparece**) e a **foto
  enviada** (reduzida no navegador antes de subir);
- a descrição de cada equipamento **vai junto com a pergunta feita à nuvem**
  sobre a área em que ele aparece (no máximo quatro equipamentos e 500
  caracteres de cada um, por pergunta);
- **"compara na loja"** aparece no equipamento que está num canal com foto
  padrão — é a regra do agente, não a de "ter foto própria";
- a tabela `equipamento` que já existia é o catálogo da distribuição (o que
  o Farol indica comprar): o inventário ganhou tabelas próprias
  (`inventario_item`, `inventario_foto`).

*Como conferir:* em Canais → Inventário, cadastrar a chapa, usar o quadro do
canal dela como foto e escrever a descrição. A próxima pergunta à nuvem de
um critério de estado naquela área leva a descrição junto (com o agente
desta versão instalado).

**"Analisar as fotos e descrever" — feito (08/10/2026, migration 026).** A
descrição feita **uma vez** a partir das fotos, com a lista do que vale
conferir (cada ponto vira critério com um clique, já com "com a área livre"
e a foto padrão junto).

- **Quem analisa é o computador da loja**, com a chave que já está lá: é um
  comando novo para o agente (`descrever_item`), como "capturar quadro". A
  nuvem do Farol continua sem chave de modelo.
- **A resposta é uma sugestão.** Vai para os campos; a pessoa lê, corrige e
  salva. Fechar sem salvar não a perde; "Manter a que estava" a deixa de
  lado.
- **Loja em modo local** não manda imagem nem para isto: o pedido é
  recusado dizendo por quê, e a descrição pode ser escrita à mão.
- Custa centavos por equipamento (quatro fotos e uma resposta curta, no
  modelo mais capaz); o custo aparece na nota da sugestão.

*Como conferir:* em Canais → Inventário, abrir um equipamento com foto e
clicar em "Analisar as fotos e descrever". Em até um minuto a descrição e
os pontos a conferir aparecem nos campos; ler, corrigir e salvar. Precisa
do agente desta versão instalado e ligado.

**Não foi medido:** a qualidade da descrição com fotos de loja de verdade
(os testes usam um modelo de mentira). A primeira análise feita na loja é a
medida — e é por isso que ela passa pela leitura de uma pessoa antes de
valer.

**Fase 3 · Programação de análise pela folga da máquina — feita (08/10/2026,
migration 027).** O pedido: "melhorar a programação de análise, já que está
gastando pouco do PC servidor". Três das quatro peças já tinham entrado com
a fase 1 (o porteiro "quando algo se mexe" para critério de ação, o "avisar
só se continuar" e a nuvem só depois do porteiro). Faltava olhar mais vezes
o que é julgado na loja — e isso virou **o vigia**:

- **A cada 10 segundos** o agente conta, no último quadro do **fluxo menor**
  do gravador (que já fica aberto), o que os critérios de **presença** e de
  **contagem** procuram. Se a contagem mudou desde a última olhada, ele olha
  **agora** aquele canal — pelo fluxo principal, com juiz, resumo e aviso —
  em vez de esperar os 30 segundos da rotina.
- **Só presença e contagem.** A olhada extra não acorda o critério que pode
  ir à nuvem: custo de nuvem igual ao de antes.
- **No máximo uma olhada extra por canal a cada 20 segundos.**
- **O freio:** processador acima de 60% por quatro medidas seguidas (uns
  dois minutos) e o vigia para; volta abaixo de 45% pelo mesmo tempo. A
  rotina de 30 segundos não para nunca.
- **O que não mudou de sentido:** a média de ocupação da hora continua
  feita só das olhadas de rotina; o maior valor passa a incluir o pico que
  a olhada extra pegou; "avisar só se continuar por N olhadas" continua
  contando olhadas de rotina (a extra não adianta a contagem — e, se ela
  viu a área em ordem, a espera recomeça).
- **Contado à parte:** o resumo da hora diz quantas análises foram olhadas
  extras e quantas delas deram fora do critério (`extras`, `extras_fora`).
  É o que deixa a fase 5 comparar esta semana com a anterior sem confundir
  "o vigia olhou mais" com "a loja mudou".

Por que não "olhar tudo a cada 10 segundos", como estava escrito aqui: cada
olhada pelo fluxo principal custa 1,7 s de fluxo aberto por canal (medido na
loja em 08/10), e o computador da loja está com a rede limitada. Quatro
canais a cada 10 segundos seria fluxo principal aberto quase o tempo todo.
O vigia gasta o que estava sobrando — o processador e o fluxo menor — e só
abre o principal quando tem motivo.

*Sem tela nova.* Em Análises, os critérios de presença e de contagem passam
a mostrar mais análises nas horas de movimento, e o maior valor da hora
sobe quando a olhada extra pega um pico.

*Como conferir:* no computador da loja, o registro do agente diz, ao ligar,
"vigia: N canal(is) com presença ou contagem, olhados a cada 10s pelo fluxo
menor". Em Análises, num critério de presença, a hora com movimento passa a
ter mais de 120 análises (120 é o que a rotina faz sozinha). Para desligar:
`--intervalo-rapido 0` no comando do agente.

**Não foi medido:** se o detector vê no fluxo menor (704 × 480) o mesmo que
no principal com gente na cena — a loja estava fechada na hora da medição.
O desenho não depende disso (o vigia compara o fluxo menor com ele mesmo, e
quem julga é sempre o principal), mas a consequência prática depende:
quantas olhadas extras por hora o vigia faz numa noite de movimento, e
quantas delas deram em algo, só a primeira noite diz. As decisões estão em
`docs/decisoes.md` (08/10/2026, "O vigia").

**Fase 4 · Esquema do ambiente — feita (08/10/2026, migration 028).** A
planta da loja desenhada no console (Canais → Planta): ambientes, móveis e
cada câmera na sua posição, com a direção para onde olha — vista de cima
para editar, em perspectiva para ler. Serve a três coisas:

- **(a) achar o lugar** — cada câmera aparece onde está, pintada pela
  situação de agora (conferindo, aviso nos últimos 10 minutos, sem
  conferência, sem imagem ou pausada). Tocar nela mostra o canal, o que ele
  confere e leva a "Quadro e área" e às Análises daquele canal.
- **(b) cobertura** — o que nenhuma câmera vê, pintado no chão, e a parte
  coberta de cada ambiente. Canal sem imagem ou pausado não cobre.
- **(c) contexto para o julgamento** — de cada câmera sai uma frase,
  escrita da planta: "Câmera no ambiente Atendimento, a 2,7 m do chão. No
  campo de visão: mesa (3), balcão de atendimento e caixa." A tela mostra a
  frase, e ela vai junto com cada análise daquele canal feita por um modelo
  (nuvem ou modelo da loja).

A planta é feita de retângulos em metros — é isso que permite a conta de
cobertura e a frase. O móvel pode ser ligado a um equipamento do inventário
(fase 2): aí o nome que vai na frase é o do inventário, e tocar no móvel
mostra o que o inventário sabe dele.

Edita-se tudo de uma vez: "Concluir edição" salva a planta inteira,
"Descartar mudanças" volta ao que está guardado. Quem salva diz a versão
que leu; se outra pessoa salvou no meio, nada é gravado e a tela avisa.

*Como conferir:* em Canais → Planta, "Desenhar a planta": o botão
"Ambiente" e arrastar para desenhar a cozinha; "Equipamento" para a chapa;
na lista de câmeras, tocar num canal para pô-lo na planta, arrastar para o
lugar e girar a bolinha âmbar. "Concluir edição". Tocar na câmera mostra a
frase do lugar; "Cobertura" mostra o que ninguém vê.

**Ficou de fora, e por quê:** as **portas** (o exemplo do protótipo as
desenha, mas não há ferramenta para criá-las — a frase "a porta fica à
esquerda" não é escrita); e resultados e anomalias mostrados na planta além
da situação de cada câmera (a fase 5 é que traz as anomalias). **Não foi
medido:** se a frase do lugar muda o veredito da nuvem — é texto a mais em
cada pergunta, e o efeito só aparece comparando antes e depois numa loja
com a planta desenhada. As decisões estão em `docs/decisoes.md`
(08/10/2026, "A planta da loja").

**Fase 5 · O especialista: padrão, anomalia, tendência e correção — feita
(08/10/2026, migration 029).** Em Análises → Padrões. O que entrou, o que
ficou de fora e como conferir estão depois da lista do que foi pedido.

| lente | o que responde | de que é feita | quando dá para dizer |
|---|---|---|---|
| **Frequência** | o que se repete: ocupação típica de cada setor por hora, a hora de pico, o que acontece toda sexta | média e maior valor da medida, taxa de fora do critério, por setor × dia da semana × hora | por hora: 1 semana; por dia da semana: 3 semanas |
| **Relação** | X anda junto com Y? "quando a fila passa de 3, o balcão está com 1 atendente em 80% das vezes" | as horas em que os dois foram medidos, lado a lado; só se diz com amostra mínima | 2 semanas |
| **Anomalia** | o que fugiu do padrão e merece atenção | a hora comparada com o normal daquela hora e daquele dia (mediana e dispersão, não média) | 1 semana |
| **Tendência** | o que vem a seguir: "a fila do pico cresce há 3 semanas", "o disco enche em 3 meses", "hoje o pico deve ser às 20h" | a mesma hora ao longo das semanas | 2 a 4 semanas |

- **Descrição de funcionamento por setor**: um texto curto, gerado dos
  números — "Atendimento: abre às 18h; pico das 20h às 21h, com 2 pessoas no
  balcão; fila acima de 3 em 4% do tempo".
- **Saídas do padrão vão para o responsável**, que responde uma de duas
  coisas: *era esperado* (e o padrão aprende — "às sextas é assim") ou *é
  problema* (e registra a correção: o que houve, o que foi feito).
- **A correção vira controle**: da saída do padrão nasce um critério
  ("balcão sem atendente por mais de 5 minutos entre 20h e 22h") ou o ajuste
  de um que já existe. É o caminho para o critério que ninguém pensou em
  cadastrar.
- **Sugestões do especialista**: o que os números mostram sobre os próprios
  critérios — "este não consegue avaliar em 90% das vezes: marque a área",
  "este nunca fica fora do critério: vale manter?".

**O que entrou.** A aba **Padrões** dentro de Análises, com a contagem das
saídas do padrão que esperam resposta. Aparece com 7 dias de análises; o
padrão é feito dos 28 dias antes de hoje, refeito cada vez que a tela abre.

- **Parecer**: uma frase por lente, cada uma levando ao dado de onde saiu.
- **Frequência**: cada setor em palavras (o movimento e o pico, as duas
  maiores taxas fora do critério, os dois canais que menos conseguem
  avaliar); a **semana típica** de um indicador, por dia da semana e hora;
  e **o que anda junto** — "com menos de 2 na chapa, a bancada fica mais
  tempo fora do critério", comparando a mesma hora do dia nas duas
  situações, e "a touca fica sem avaliar com a loja cheia ou vazia: não é
  o movimento".
- **Anomalias**: a hora muito diferente do que costuma ser naquele dia da
  semana e naquela hora, mesmo sem aviso de critério. Quem configura a
  loja responde *era esperado* ("acontece sempre" ensina o padrão; "foi
  só desta vez" tira a hora da conta) ou *é problema* (o que houve, o que
  foi feito). Do problema nasce um critério — proposto com o costume
  daquela hora como limite, e que nasce desligado — ou abre-se o que já
  existe para ajuste.
- **Tendência**: hoje contra o normal do mesmo dia da semana, hora a
  hora, com o que se espera daqui em diante; e, semana a semana, a hora
  mais cheia, a taxa fora do critério de cada critério, o gasto com a
  nuvem e o disco da máquina ("nesse ritmo enche em N dias").
- **Sugestões**: marcar a área onde o critério não consegue avaliar;
  conferir só com alguém na área; usar a foto padrão; criar o critério
  que uma relação forte mostra (com a faixa de horas em que ela foi
  medida); e "nunca ficou fora do critério: vale manter?" — esta última
  só para os dois critérios de mais olhadas.

*Como conferir:* em Análises, a aba Padrões. Com menos de 7 dias de
análises a tela diz quantos já tem. Com o padrão formado: tocar num quadro
da semana típica mostra de que ele é feito; em Anomalias, "Era esperado"
e "É problema" abrem as duas gavetas; a resposta tira a saída de "A
rever" e ela passa a aparecer em "Revistas", com quem respondeu.

**Ficou de fora, e por quê:**

- **"Abre às 18h, de terça a domingo"** na descrição do setor. O exemplo
  do plano e o do protótipo traziam essa frase; a descrição da tela começa
  pelo movimento. O horário em que há análise não é o horário da loja (um
  critério pode valer só numa faixa de horas), e repetir o horário
  cadastrado da loja em cada setor não diz nada novo.
- **O parecer escrito por modelo de linguagem.** As frases são montadas
  dos números, sempre no mesmo formato. Se entra modelo, e com que
  frequência, é a decisão 3 abaixo.
- **Saída do padrão por aviso.** Elas aparecem na tela (e a aba conta
  quantas esperam resposta); mandar por aviso é a decisão 2 abaixo.
- **Anomalias na planta.** A planta continua mostrando a situação de
  agora de cada câmera.
- **O que mudou no critério depois de "ajustar".** A revisão guarda que
  o critério foi aberto para ajuste, e não o que foi mudado nele.

**Não foi medido:** os limites do que é "muito diferente do normal" numa
loja de verdade. São valores de partida (para a medida, meio objeto além
da faixa e 0,6 do meio; para as taxas, 10 pontos além da faixa e 15 do
meio), postos para que "o posto que costuma ter dois ficou com um"
apareça e "1,9 em vez de 2,0" não. A loja tinha dois dias de medida
quando a fase saiu: quantas saídas do padrão por dia isso dá, e quantas
delas o responsável acha que valem, só as primeiras semanas dizem. As
decisões estão em `docs/decisoes.md` (08/10/2026, "O especialista").

### Como o especialista é feito

**Números primeiro; modelo de linguagem só para escrever.** Padrão, anomalia
e tendência são conta — mediana, dispersão, comparação semana a semana — feita
no servidor, sempre igual, sem custo por análise e sem imagem. O texto do
parecer ("o que isso quer dizer, o que fazer") pode ser escrito por um modelo
de linguagem a partir desses números, uma vez por dia ou por semana — texto
sobre contagem, centavos por loja. O modelo não vê imagem e não inventa
número: cada frase aponta o dado de onde saiu.

### O silêncio do critério deixa buraco no padrão

Visto na loja na noite de 07/10: depois de cada aviso, o critério de nuvem
fica o período de silêncio **sem olhar** — "Uso da gaveta" parou às 23h13m59
e voltou às 23h28m49; uniforme e chapa, o mesmo desenho. É economia, e está
certo para o aviso. Para o padrão, é um buraco: "fora do critério em 8% das
olhadas" não conta o tempo em que ninguém olhou justamente depois de achar
um problema. O dado para corrigir isso já existe: o resumo de cada hora
conta as olhadas que caíram no silêncio (`em_silencio`), ao lado das
repetidas e das já julgadas. O motor de padrões faz a conta sobre a parte
da hora que foi olhada, e diz quando ela é pequena. Com a comparação na
loja (fase 2), o critério pode continuar sendo conferido durante o
silêncio, sem custo.

*Na fase 5:* a taxa é feita das olhadas que o critério fez, e a saída do
padrão de uma taxa diz quando o silêncio tirou um quarto das olhadas da
hora, ou mais ("depois de avisar, ele ficou em silêncio em 10 das 30
olhadas da hora: a taxa é só das que ele fez"). A descrição do setor, a
semana típica e a tendência ainda não dizem.

### Os protótipos (aprovados pelo dono em 08/10/2026)

Em `mockups/farol-console.html`:

| onde | o que mostra |
|---|---|
| **Análises → Padrões** | o parecer; as quatro lentes (frequência, anomalias, tendência, sugestões); a revisão de cada saída do padrão — "era esperado" ou "é problema" — e a correção virando critério |
| **Canais → Planta** | os ambientes, os equipamentos e as câmeras; em perspectiva e de cima; situação agora e cobertura; edição por arrasto |
| **Canais → Inventário** | os equipamentos por setor, as fotos, a análise única e o que vale conferir |
| **Quadro e área** | a foto padrão do canal e a comparação com o quadro de agora |
| **gaveta do critério** | "quando vale a pena conferir" (o porteiro), a faixa de horas, "avisar só se continuar" e a comparação com a foto padrão |

O que o protótipo mostra e depende de coisa que ainda não existe:

- **A lista de saídas do padrão é a do exemplo.** A regra que decide o que
  é "muito diferente do normal" (mediana e dispersão por dia da semana e
  hora) entrou com a fase 5, com limites de partida; afinam-se com as
  primeiras semanas de dados da loja, medindo quantas aponta por dia —
  anomalia demais vira ruído.
- **As frases de Padrões** eram, no protótipo aprovado, exemplos escritos
  à mão ("Balcão com uma pessoa no pico", "a fila estoura mais"). A tela
  monta cada frase dos números da loja, sempre no mesmo formato; com a
  fase 5 o protótipo passou a mostrar as frases nesse formato, com os
  números do exemplo. O que mais a tela tem de diferente do protótipo
  aprovado foi levado a ele no mesmo trabalho e está listado em
  `docs/decisoes.md` ("O especialista").
- **"Nada a conferir"** (a olhada que o porteiro segurou) entrou na tela
  Análises com a fase 1, como uma linha à parte: não é análise, e por isso
  não virou fatia das barras. Essa linha não estava no protótipo aprovado —
  foi acrescentada a ele no mesmo trabalho.
- **A faixa de horas do critério** ganhou o campo na tela com a fase 1.
- **A foto padrão** entrou com a fase 2: é o quadro que o canal já tem,
  copiado — sem envio de imagem pelo console. O que a tela ganhou além do
  protótipo aprovado foi levado a ele no mesmo trabalho: escolher qual foto
  aparece no quadro (saiu "em uso agora": a loja compara com a que mais se
  parecer), "N pessoas no quadro" na foto guardada com gente, a pergunta
  antes de excluir, o limite de quatro, de quando é o quadro que vai ser
  guardado, e a etiqueta "falta a foto padrão" na lista de critérios.
- **O inventário** entrou com a fase 2 (cadastro, fotos, onde aparece e a
  descrição à mão). O que a tela tem de diferente do protótipo aprovado foi
  levado a ele no mesmo trabalho: as fotos são guardadas na hora (a
  primeira já cria o cadastro, e pede o nome); "usar o quadro de um canal"
  pergunta de qual canal; "compara na loja" passou a ser "o canal tem foto
  padrão"; o campo do nome do setor novo; e o botão de excluir, com a
  pergunta.
- **A planta** pede tabelas novas.
- **O parecer** do protótipo é montado dos números, sem modelo de linguagem
  — e o da tela também.

### O que vale para todas as fases

- Imagem de loja não sai da loja além do que já sai hoje; tudo aqui é número.
- "Não medi" não é zero. Padrão com pouca amostra diz que tem pouca amostra.
- Medir antes de prometer: cada método de julgamento local passa pelo ensaio
  com gabarito antes de ligar em loja.
- Tela nova passa por protótipo aprovado.

### Decisões que são do dono

1. A ordem das fases. *Decidido em 08/10/2026: "aplicar todas as etapas até
   o final", na ordem proposta.*
2. Quem recebe as saídas do padrão (o gerente da loja? a diretoria?) e por
   onde (só na tela, ou também pelo aviso). *Como saiu na fase 5: só na
   tela; vê quem vê as análises (supervisão para cima) e responde quem
   configura a loja (gerência para cima).*
3. Se o parecer escrito por modelo de linguagem entra, e com que frequência.
   *Como saiu na fase 5: sem modelo.*
4. As fotos do inventário e a foto padrão sobem para a nuvem (para a
   análise única e para o console mostrar). São imagens da loja, sem
   pessoas: o detector avisa quando há alguém no quadro, mas quem decide
   guardar é o responsável.

---

## A17 · A área por pontos (feito em 08/10/2026)

Pedido do dono no meio da fase 1 do A16, usando a tela: a marcação da área
tinha de ser flexível, "para uma área não invadir outra". A área deixou de
ser só retângulo: é um contorno de pontos, o agente recorta exatamente o
desenho (sem os 5% de folga) e apaga o que fica fora dele antes de analisar.
O que mudou, as escolhas e o que falta medir estão em `docs/decisoes.md`
(08/10/2026, "A área é o desenho").

Fica mais fácil, com isso, o que o A16 quer: critério mais exato pergunta
menos e erra menos. A planta (fase 4) e a comparação com a foto padrão
(fase 2) passam a usar o mesmo desenho.

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

---

## A18 · O momento do ocorrido, o ambiente que calcula e a cara do produto (aprovado em 08/10/2026; onda 0 feita; a ordem foi revista no A19)

**Pedido do dono (08/10/2026).** Dez coisas, cada uma numa linha:

1. a confiança aparece em **%**;
2. **relatórios por e-mail** — diário, semanal e mensal; a pessoa escolhe um ou os três;
3. **resumo do que saiu do padrão por WhatsApp** — diário, semanal e mensal; idem;
4. em toda análise crítica, urgente ou fora do padrão, um botão que **busca no HD o
   trecho do ocorrido** — 5 s antes e 5 s depois, a princípio. Ver se a Intelbras tem
   API para isso; se não tiver, criar;
5. **o que está fora do critério é o dado mais importante**: manda nos painéis e nos
   relatórios;
6. **a planta passa a calcular**: pé-direito, distância e modelo da câmera (puxar os
   dados técnicos), calor por perto, fumaça por setor, arrumação padrão, sugestão de
   posição. Depois: a pessoa na planta e o mapa de calor de movimentação;
7. **a planta fiel à loja**: nem tudo é quadrado; ver se um rascunho à mão pode virar a
   planta, corrigida depois pelo usuário;
8. conferir se **os critérios estão sendo bem analisados**, o que melhorar no motor
   local, e se câmera melhor dá ganho — e qual;
9. tudo com **o impacto calculado**: equipamento, armazenamento, desempenho;
10. **a cara do produto**: moderno, tecnológico, minimalista, com movimento — como uma
    empresa de porte internacional se apresenta. Sem se prender à paleta.

O plano foi feito por três papéis: engenharia (o que o agente e a API ganham),
arquitetura (dados, guarda, custo) e técnica de circuito monitorado (gravador, câmera,
lente, disco). Antes de escrever, medimos a loja.

### O que a loja mediu (08/10/2026, 12h — só leitura, só números)

Nenhuma imagem saiu da loja nem foi gravada: bytes e quadros foram contados na memória.

| o quê | medido |
|---|---|
| Gravador | Intelbras MHDX 3116-C, firmware 4.001 (25/12/2025) |
| Fluxo principal, por canal | 1920×1080, 15 quadros/s, H.265, 2.048 kbit/s (nos arquivos: 2,13 Mbit/s) |
| Fluxo menor, por canal | 704×480, 15 quadros/s, H.264, 160 kbit/s — **não é gravado** |
| Disco do gravador | **218,8 GB**, cheio, sobrescrevendo |
| O que o HD guarda | **15,4 horas**, igual nos 6 canais conferidos (o arquivo mais antigo era de 21h da véspera) |
| Relógio do gravador | **27 s adiantado** em relação ao PC; NTP **desligado** |
| Buscar o que há gravado (`mediaFileFind`) | funciona: 0,3 a 2,3 s; arquivos de 30 min (≈ 476 MB) |
| 10 s gravados, por HTTP (`loadfile.cgi`) | funciona: **2,64 MB em 6,3 s** (primeiro byte em 1,3 s), formato DAV |
| 10 s gravados, por RTSP (`cam/playback`) | funciona: 153 quadros de 1920×1080 em 12,4 s (abre em 3,5 s) |
| PC de análise | 68 GB livres de 239; sem `ffmpeg`; o OpenCV instalado grava VP8, VP9 e MP4V, **não grava H.264** (falta a biblioteca OpenH264) |
| Detector local (presença) | 93 a 95 ms por olhada; confiança média de 89% e 92%; 2% a 7% de "não deu para avaliar" |
| Critérios de nuvem (3) | 1.284 análises pagas na noite de 07/10, **1.192 voltaram "não deu para avaliar" (93%)**; R$ 16,87 |
| Avisos | **156 numa noite**; 85 deles de dois critérios de presença |
| Tamanho de uma pessoa | de 385 a 688 px (mediana do maior lado, por canal) no fluxo principal; de 128 a 229 px na imagem que hoje vai para a nuvem |

Por critério de nuvem, na noite de 07/10 (dia da operação):

| critério | análises | "não deu para avaliar" | gasto |
|---|---|---|---|
| Uso da gaveta do caixa (ação) | 567 | 540 (95%) | R$ 7,52 |
| Uso da chapa (ação) | 374 | 349 (93%) | R$ 4,94 |
| Uniforme (estado) | 343 | 303 (88%) | R$ 4,40 |

### O que a medida mudou no plano

**1. O HD guarda 15 horas — o botão não pode depender dele.** O que aconteceu às 19h já
não existe às 10h30 do dia seguinte. Então o trecho é **puxado pelo agente na hora do
aviso** e guardado no PC da loja; o botão mostra o que já está guardado. Buscar direto
no HD continua existindo ("ampliar o trecho"), mas só enquanto o gravador tiver aquela
hora — e a tela diz quando não tem mais.

**2. O relógio do gravador está 27 s adiantado — mais que a margem de 5 s.** Sem
corrigir, o trecho mostraria outro momento. O agente mede a diferença a cada busca e
desconta. Ligar o NTP no gravador resolve na origem.

**3. Os critérios de nuvem pagam por resposta que não vem.** 93% das análises pagas
voltaram "não deu para avaliar". As frases do modelo dizem por quê: "cozinha sem pessoas
visíveis", "a chapa está visível, mas não há proteína", "visão geral do estabelecimento".
São quatro causas, nenhuma é a câmera:

- todas as áreas são o **quadro inteiro** (nenhuma foi desenhada);
- o porteiro está em **"sempre"** em todos (a pergunta é feita com a cozinha vazia);
- a imagem vai para a nuvem com **640 px de largura** — 11% dos pixels que a câmera
  entrega;
- **ação** (gaveta, chapa) é julgada por **uma foto**; ação se vê em sequência.

**4. Um critério nunca foi julgado e ninguém soube.** "Produto" (contagem) foi olhado
2.170 vezes e ficou "sem juiz" em todas: o objeto não está no vocabulário do detector.

**5. 156 avisos numa noite é ruído.** Um critério de presença fora por duas horas gera
um aviso a cada 15 minutos. O que interessa é o **episódio**: quando começou, quanto
durou, quando voltou ao normal.

**6. A imagem do evento não sobe para a nuvem** (só a assinatura dela). Hoje o console
não consegue mostrar nem a foto do ocorrido; o trecho em vídeo resolve as duas coisas.

**7. Erro achado no caminho.** O cliente do gravador (`ClienteDahua`), depois de seis
respostas de erro seguidas, passa a responder "senha recusada" para tudo, sem falar com
o gravador (contador de tentativas do `urllib` que só zera no sucesso). A busca de
trechos dispararia isso em minutos: "não há gravação" volta como erro 400.

### Respostas diretas

**A Intelbras tem API?** Tem, e é oficial: a "HTTP API V3.59" da Intelbras é a
especificação CGI da Dahua com a marca dela (pede-se pelo canal de suporte; há também o
NetSDK). Não é preciso criar protocolo. Os três caminhos da especificação —
`mediaFileFind` (buscar), `loadfile.cgi` (baixar por horário) e RTSP `cam/playback` —
foram **testados no gravador da loja e funcionaram**. O que se cria é o cliente: o
`ClienteDahua` de hoje só fala ao vivo.
Fonte: <https://botminio.apps.intelbras.com.br/dvr/HTTP_API_V3_59_Intelbras.pdf> (lido em 08/10/2026).

**Os critérios estão sendo bem analisados?** Os do detector local, sim (93 ms, 2% a 7%
de dúvida). Os de nuvem, não: 93% sem resposta, pelas quatro causas acima.

**O motor local funciona? O que melhorar?** Funciona. O que falta: (a) ele devolve só a
pontuação e **joga fora as caixas** que o modelo calcula — com elas vêm a posição de
cada pessoa (base do mapa de calor), a contagem por área e o porteiro exato, sem custo
de inferência; (b) recortar a área na **resolução nativa**; (c) acusar na tela o
critério que não tem juiz; (d) medir um modelo um degrau acima (entrada de 512 px) para
objeto pequeno, antes de adotar.

**Câmera melhor dá ganho? Qual?** Hoje, nenhum: 89% dos pixels que as câmeras já
entregam são jogados fora antes da nuvem. A ordem do ganho, do grátis ao caro:

| passo | ganho | custo |
|---|---|---|
| 1. Desenhar a área e mandar o recorte na resolução da câmera | 3× o detalhe em cada direção (9× os pixels). Uma pessoa passa de ≈ 200 px para ≈ 600 px; a cabeça, de ≈ 30 px para ≈ 90 px (o mínimo usual para classificar é 40 px) | nenhum |
| 2. Porteiro "com pessoa na área" | −54% a −59% das perguntas (havia gente em 41% a 46% das imagens dos canais com critério de nuvem) | nenhum |
| 3. Rajada para ação (3 a 5 quadros) | a ação passa a ser visível | 3× os tokens de imagem, só nesses critérios |
| 4. Lente e posição (aproximar, 3,6 mm no lugar de 2,8 mm) | +20% a +30% de detalhe | baixo |
| 5. Câmera de 4 MP ou 5 MP | +33% / +35% de detalhe por direção | câmera + disco (o dobro por canal) |
| 6. Câmera 4K | +100% | câmera + disco (4×) + gravador que aceite |

Câmera melhor só vale para **detalhe pequeno** (touca, luva, etiqueta) ou **cena larga**,
e só depois dos passos 1 a 3. Dois limites que não dependem da câmera: o modelo de nuvem
reduz toda imagem inteira para até 1.568 px no lado maior (2.576 px nos modelos mais
novos) — resolução a mais só aparece no **recorte**; e no cabo analógico o gravador é
quem limita (o MHDX 3116-C aceita até 5 MP Lite).
Fonte dos limites de imagem: <https://platform.claude.com/docs/en/build-with-claude/vision> (lido em 08/10/2026).

### Frente 1 · Critérios que respondem

| | o quê | por quê |
|---|---|---|
| 1.1 | **Confiança em %** em todas as telas, avisos e relatórios ("confiança 87%", "confiança mínima 70%"). A API continua guardando a fração | pedido 1 |
| 1.2 | **Saúde do critério**: o critério que não consegue avaliar aparece como problema, com a causa e o que fazer ("93% sem resposta — desenhe a área e ligue 'com pessoa na área'"); o que não tem juiz é acusado; o gasto sem resposta é somado | achados 3 e 4 |
| 1.3 | **Recorte nativo**: a resolução deixa de ser um ajuste e passa a sair do tamanho da área — manda-se o recorte como a câmera entrega, até o limite do modelo | achado 3 |
| 1.4 | **Rajada para ação**: 3 a 5 quadros em 2 a 4 s, numa pergunta só | achado 3 |
| 1.5 | **Episódios**: olhadas seguidas fora do critério viram um episódio (início, duração, fim). Um aviso no começo, lembrete opcional, um trecho de vídeo. Relatórios contam episódios e **minutos fora** | achado 5 |
| 1.6 | **O detector devolve as caixas** (posição de cada pessoa na imagem) | base das frentes 5 e 6 |
| 1.7 | **Relógio**: diferença gravador × PC medida e guardada; aviso se passar de 5 s | achado 2 |
| 1.8 | **Cliente do gravador** não trava depois de seis erros | achado 7 |

Medida que fecha a frente: as mesmas 200 imagens julgadas como hoje e com recorte
nativo, lado a lado — quantas deixam de voltar "não deu para avaliar". Custa cerca de
R$ 5 de nuvem; precisa do "pode" do dono.

### Frente 2 · O momento do ocorrido (evento ↔ vídeo)

**O caminho de um trecho:**

1. O critério avisa às 10:30:30 (relógio do PC).
2. O agente espera o "depois" existir no HD e pede ao gravador de 10:30:23 a 10:30:37
   (os 10 s mais 2 s de folga de cada lado, já no relógio do gravador).
3. Converte no PC da loja: de DAV/H.265 para **MP4/H.264**, cortado em 10:30:25–10:30:35,
   720p, sem áudio. H.265 não abre em todo navegador (no Windows depende de placa e de
   extensão); H.264 abre em 97% deles.
4. Guarda no PC da loja. **Crítico e urgente sobem na hora**; os outros sobem quando
   alguém clica.
5. No console, **"Ver o momento"** abre o vídeo com a marca no instante do aviso.

**O que entra:**

| | o quê |
|---|---|
| 2.1 | Cliente do gravador: `o_que_ha_gravado(canal, de, até)` e `baixar_trecho(canal, de, até)`; `loadfile.cgi` primeiro, RTSP de reserva; **um pedido por vez** por gravador |
| 2.2 | Conversão no agente, com o rosto borrado onde o critério manda (a mesma regra da imagem que sai da loja) |
| 2.3 | Captura automática em todo aviso de critério fora; fila própria, que sobrevive a reinício |
| 2.4 | Guarda na loja com teto em GB e em dias (o mais antigo sai primeiro) |
| 2.5 | Subida para a nuvem: na hora (crítico, urgente) ou sob clique (até 10 s de espera: é o intervalo em que o agente fala com a nuvem) |
| 2.6 | Tela: botão **"Ver o momento"** no evento, no aviso, no relatório e na saída do padrão; vídeo de 10 s com a marca do instante; quadro a quadro; **"ampliar"** para 30 s ou 1 min (enquanto o HD tiver); estados "buscando na loja", "o gravador não guarda mais esta hora", "a loja está fora do ar" |
| 2.7 | Margem ajustável por loja (10 s a princípio; 20, 30, 60) |
| 2.8 | Na saída do padrão (que é de uma hora, não de um instante): a linha do tempo daquela hora, com os episódios e seus trechos |

**Três caminhos para converter o vídeo, e o escolhido:**

| caminho | como | a favor | contra |
|---|---|---|---|
| A · OpenH264 + OpenCV (**recomendado**) | uma biblioteca de 1 MB (a que o OpenCV da loja já procura); os quadros passam pelo nosso código | é onde o rosto é borrado; nada novo a manter; a patente do H.264 é coberta pela Cisco, que distribui o binário | qualidade e taxa têm menos ajuste; o índice do MP4 fica no fim (num vídeo de 1 MB não pesa) |
| B · `ffmpeg` junto do agente | programa de ~100 MB, baixado com conferência de assinatura, como o modelo do detector | rápido; converte sem recodificar quando dá; índice no começo | 100 MB a mais por loja; o borrão vira um passo à parte |
| C · mandar o H.265 como veio | só troca a embalagem | zero processamento | não abre em boa parte dos navegadores no Windows |

O primeiro passo da frente é a prova de bancada dos caminhos A e B, medindo tempo e
tamanho, antes de escolher de vez.

**O que o trecho NÃO garante.** O agente olha cada critério a cada ≈ 46 s. O quadro que
gerou o aviso mostra o **estado** fora do critério; o **ato** pode ter sido até 46 s
antes. Por isso: "voltar 30 s" fica a um clique, e os critérios de ação passam a usar a
rajada (1.4) e o vigia (que olha a cada 10 s).

**Recomendações do técnico, para o gravador:**

- **Trocar o disco.** 218,8 GB dão 15 horas. Por proporção (14,2 GB por hora, com os
  canais de hoje): 2 TB ≈ 5 dias; 4 TB ≈ 11 dias; 6 TB ≈ 16 dias; 10 TB (o máximo do
  gravador) ≈ 27 dias. Disco **de vigilância** (feito para gravar sem parar). Se o de
  hoje for um SSD comum, ele é regravado inteiro 1,5 vez por dia e não dura.
- **Gravar por movimento com a loja fechada.** A loja fica fechada mais da metade do dia, e
  a gravação contínua de cozinha vazia ocupa o disco do mesmo jeito. O gravador já tem
  detecção de movimento ligada nos canais. A confirmar no menu dele.
- **Ligar o NTP** (hoje desligado).
- **Não** ligar a gravação do fluxo menor: gastaria disco para uma imagem que não serve
  de prova.

### Frente 3 · Relatórios e resumos

**Quem recebe e quando.** Cada pessoa escolhe, por loja: e-mail (diário, semanal,
mensal — um, dois ou os três) e WhatsApp (idem). Horários de partida: o diário sai às 8h
com o dia da operação anterior (que fecha às 6h); o semanal, segunda às 8h; o mensal, no
dia 1.

**O que vem primeiro é o que saiu do critério.** A mesma ordem no e-mail, no WhatsApp e
na página:

1. episódios fora do critério, do mais grave ao menos, com minutos fora e o link
   **"ver o momento"**;
2. reincidência: o mesmo critério, na mesma hora, em 3 dias ou mais;
3. o que fugiu do padrão (do especialista) e ainda não foi respondido;
4. o que melhorou e o que piorou contra o período anterior;
5. o que **não deu para avaliar** (critério sem resposta, canal sem imagem, loja fora do ar);
6. numa linha só: o que ficou dentro do critério, e o gasto de nuvem do período.

O WhatsApp leva o resumo em três linhas e o link da página do relatório; o e-mail leva o
relatório inteiro. O mensal acrescenta tendência e sugestões.

**Como é entregue.** Fica a decisão de 06/10: **o Farol decide e monta; quem entrega é o
transportador** (Regem/n8n), pela fila de envios que já existe. Entra um tipo novo de
envio ("relatório"), criado por um trabalho agendado, uma vez por assinatura e período.

**Custos e regras (pesquisados em 08/10/2026):**

- WhatsApp: cobra-se por modelo de mensagem entregue. O resumo é modelo de **utilidade**
  — sem texto promocional, só com dados da própria loja, para quem pediu para receber.
  Preço no Brasil: **entre R$ 0,035 e R$ 0,08 por mensagem** (duas fontes divergem; a
  tabela oficial da Meta não pôde ser lida — conferir antes de fechar preço). Uma pessoa
  com os três resumos recebe ≈ 35 mensagens por mês: de R$ 1,20 a R$ 2,80.
- E-mail: de US$ 0,10 a US$ 0,90 por mil. Exige SPF, DKIM e DMARC no domínio.

### Frente 4 · O que está fora do critério, na frente

- **Início da loja**: no topo, "fora do critério agora" e "hoje", por gravidade ×
  reincidência × minutos fora; cada linha com o seu momento. O que está em ordem fica
  recolhido numa linha.
- **Índice da loja** (0 a 100), pesado pela gravidade, com a tendência — um número para
  o dono acompanhar e comparar lojas.
- **Análises, avisos e relatórios** na mesma ordem: fora do critério → fora do padrão →
  sem resposta → em ordem.

### Frente 5 · O ambiente que calcula

**Dados técnicos da câmera — de onde vêm.** Em câmera analógica (HDCVI, a da loja) o
gravador **não sabe o modelo**: o cabo só leva imagem. Medido: ele informa a resolução e
a taxa de cada canal, nada da lente. Então:

- resolução, quadros e taxa: lidos do gravador, sozinhos (já funciona);
- modelo: o usuário escolhe na base de equipamentos; a base passa a trazer sensor,
  lente, ângulo de visão, WDR e alcance do infravermelho de cada modelo (hoje traz só os
  megapixels);
- câmera IP: modelo e lente lidos do próprio aparelho;
- **calibração por 4 pontos** (o melhor caminho para câmera sem ficha): o usuário marca
  na imagem 4 pontos do piso que existem na planta; daí sai a relação exata entre imagem
  e planta — é ela que depois põe a pessoa no lugar certo.

**O que a planta passa a calcular:**

| | o quê |
|---|---|
| 5.1 | **Pé-direito** por ambiente, **inclinação** por câmera |
| 5.2 | **Pixels por metro em cada ponto do piso**: distância real (com a altura) e ângulo da lente → um mapa de onde a câmera serve para presença, para estado e para leitura (os mínimos da nossa base: 1,5, 3 e 12 px/cm) |
| 5.3 | **Ponto cego e sombra**: o que um móvel alto esconde; quanto de cada setor está coberto; onde duas câmeras se sobrepõem |
| 5.4 | **Veredito por critério**: "daqui, esta câmera entrega 1,9 px/cm na bancada; uniforme pede 3" → aproximar 1,2 m, trocar a lente, ou outra câmera. Com simulador: arrastar a câmera e ver o veredito mudar |
| 5.5 | **Calor**: chapa, fritadeira e forno (do inventário) ganham raio de calor e de gordura; câmera dentro dele recebe aviso de posição e de limpeza |
| 5.6 | **Fumaça e vapor por setor**: o setor marcado avisa o juiz ("pode haver fumaça: se estiver encoberto, diga que não dá para avaliar") e ganha um **índice de visibilidade** por canal e hora. Olhada encoberta espera e tenta de novo, em vez de pagar a nuvem |
| 5.7 | **Saúde da imagem**: lente suja (queda lenta, dia após dia), câmera fora do lugar (a foto padrão deixou de bater), contraluz |
| 5.8 | **Arrumação padrão**: equipamentos na planta + foto padrão = "o ambiente em ordem"; o que saiu do lugar vira critério proposto |
| 5.9 | **Forma livre**: ambiente por pontos (o mesmo editor da área), parede em curva, portas e passagens |
| 5.10 | **Rascunho → planta**: foto do desenho à mão → um modelo de visão devolve os ambientes → o usuário informa **uma medida real** (a escala) e corrige arrastando |

Sobre fumaça: medimos nitidez, contraste e "véu" nas imagens de uma noite. **Há sinal** —
a nitidez do canal da chapa caiu 40% entre 1h e 2h; a do atendimento caiu pela metade
entre 16h e 17h. Mas no quadro inteiro a fumaça se mistura com o que mudou na cena. O índice tem de
ser medido em **trechos fixos** (parede, coifa), contra a foto padrão.

Sobre o rascunho: é viável **com** correção humana. A pesquisa mais próxima (croqui à mão
→ planta por modelo de linguagem com visão, 2025) acerta 83% das paredes antes da
correção. O cálculo passa a ser feito sobre uma **grade** de 25 cm, o que torna curva e
forma livre simples — e acaba com as duas cópias da conta de geometria (API e console).
Antes de construir: teste com 5 rascunhos de verdade, um deles da loja.
Fonte: <https://arxiv.org/abs/2510.20838> (lido em 08/10/2026).

### Frente 6 · A pessoa na planta (depois)

Caixa do detector (1.6) → ponto do pé → posição na planta (calibração por 4 pontos) →
**ocupação por célula de 50 cm, por hora**. Sai: mapa de calor por período, tempo de
permanência por setor, setor vazio × setor cheio, caminhos mais usados.

Nasce **anônimo**: guarda-se a contagem por célula, não o trajeto de alguém. Limites
conhecidos: pé escondido por bancada, lente de 2,8 mm sem correção de distorção, uma
amostra a cada 10 s.

Atenção jurídica (fica para o final, por decisão do dono, mas a modelagem já respeita):
o relatório do grupo de trabalho do CNPD (2026, consultivo) desaconselha usar câmera para
avaliação de desempenho individual. Mapa de calor por **setor e horário** é gestão do
ambiente; por **pessoa** seria avaliação.
Fonte: <https://www.gov.br/anpd/pt-br/cnpd/grupos-de-trabalho/gt1-relatorio-final-cnpd.pdf> (lido em 08/10/2026).

### Frente 7 · A cara do produto

**Três caminhos:**

| | caminho | referências | ganha | perde |
|---|---|---|---|---|
| A | Tradicional — painel de operação | [Grafana](https://grafana.com/docs/grafana/latest/dashboards/), [shadcn/ui](https://ui.shadcn.com/blocks) | familiar, barato | parece com todos |
| B | Moderno — instrumento de precisão | [Linear](https://linear.app/now/how-we-redesigned-the-linear-ui), [Vercel Geist](https://vercel.com/geist/introduction), [Stripe](https://docs.stripe.com/stripe-apps/design) | sóbrio, rápido, denso sem cansar | pouco "uau" sozinho |
| C | Inovador — sala de controle viva | [Verkada](https://www.verkada.com/command/), [Rhombus](https://www.rhombus.com/blog/introducing-floorplans-complete-clarity-of-your-global-security-camera-network), [View Transitions](https://nextjs.org/docs/app/guides/view-transitions), [cmdk](https://github.com/pacocoursey/cmdk) | impacto, movimento, o produto "vivo" | risco de enfeite e de peso |

**Recomendado: a base do B com as peças de assinatura do C.** Base escura por padrão
(sala de controle), com o tema claro completo; neutros com um fio de azul; **uma** cor de
sinal — o âmbar do facho, que é a identidade do Farol; números em fonte de largura fixa;
borda de 1 px no lugar de sombra. As peças de assinatura, cada uma carregando função:

- **o facho**: a varredura de luz do farol como marca viva (login, carregando, "olhando
  agora");
- **a planta viva**: cones das câmeras, mapa de pixels, calor — a planta como tela, não
  como cadastro;
- **a linha do tempo do dia**: episódios entrando ao vivo, cada um com o seu momento;
- **a miniatura que vira vídeo** (transição contínua);
- **Ctrl+K**: ir a qualquer loja, canal, critério ou dia;
- **o início em mosaico**, com uma peça principal: o estado da loja agora.

**Regras do movimento e do desempenho** (para o impacto não custar a velocidade):
transições de 150 a 250 ms; nada se move sem motivo; "reduzir movimento" do aparelho é
respeitado; desfoque em no máximo duas superfícies; primeira tela em menos de 2 s em 4G;
animação a 60 quadros/s medida em celular simples.

**Entrega:** primeiro o **protótipo navegável** (login, início da loja, evento com o
vídeo, linha do tempo, planta viva, relatório, Padrões), claro e escuro, 1440 e 375 px.
Aprovado, o porte entra por partes: cores e tipos → casca → telas. Toda tela nova das
outras frentes já nasce nesse protótipo. A página que apresenta este plano foi feita
nessa direção, como primeira amostra.

### O mercado, e onde o Farol fica

Verificado em 08/10/2026. "Porte" é o que a fonte declara.

| quem | o que tem do que está neste plano | porte | desde |
|---|---|---|---|
| [Verkada](https://www.verkada.com/blog/ai-powered-search/) (EUA) | trecho do evento, busca por frase, mapa de calor na planta, linha do tempo | 30 mil+ organizações; avaliada em US$ 5,8 bi | não verificado |
| [Rhombus](https://restauranttechnologynews.com/2025/09/rhombus-launches-ai-solution-to-give-restaurants-customized-operational-intelligence-and-automated-event-responses/) (EUA) | critério escrito em texto, planta com cone e lacuna de cobertura, aviso por e-mail | 3.000+ clientes; US$ 90 mi+ captados | não verificado |
| [Solink](https://solink.com/solutions/restaurants/) (Canadá) | vídeo ligado ao caixa, **resumo por e-mail diário ou semanal** | 35 mil+ locais | 2009 (não verificado) |
| [Lumana](https://lumana.ai/solutions/hospitality) (EUA) | IA sobre câmeras existentes, mapa de calor, cozinha | US$ 64 mi captados | 2024 (lançamento público) |
| [Wobot](https://wobot.ai/) (Índia/EUA) | procedimento em fast-food por câmeras existentes | US$ 5,5 mi (não verificado) | não verificado |
| [Emilia AI](https://startups.com.br/negocios/rodada-de-investimento/prosus-sobe-aposta-em-ia-nos-restaurantes-e-investe-us-15m-na-emilia-ai/) (Brasil como mercado principal) | IA sobre as câmeras do restaurante + caixa | US$ 1,5 mi captado | 2024 |

Quem tem tudo isso tem de 3 mil a 30 mil clientes e de US$ 30 milhões a bilhões, e quase
todos vendem a própria câmera. **Os pares do Farol são Emilia e Wobot.** Do que foi
verificado, ninguém entrega: resumo por WhatsApp ao dono; cálculo de pixels e sugestão de
posição dentro do console (isso existe em ferramenta de projeto, como
[JVSG](https://www.jvsg.com/) e AXIS Site Designer); e nenhum trabalha sobre gravador
analógico com o julgamento feito na loja.

### Impacto

**No PC da loja**

| | hoje | com o plano |
|---|---|---|
| Processador | detector a 93 ms por olhada | + 1 a 2 s por trecho (estimado; medir na prova de bancada). Com episódios, de 20 a 40 trechos por dia (estimado) |
| Disco | 68 GB livres; imagens do agente: 260 MB | trechos: ≈ 1,3 MB cada em 720p (estimado). 156 por dia (o pior caso, sem episódios) = 200 MB/dia. Teto proposto: **10 GB ou 30 dias** |
| Rede interna | cabo a 10 Mbit/s (pendência antiga); 14 fluxos menores ≈ 2,4 Mbit/s | cada trecho: 2,64 MB em 6 s, um por vez. Com o cabo a 10 Mbit/s, é o gargalo — mais um motivo para trocá-lo |
| Internet (subida) | eventos e resumos: poucos kB | 20 a 40 MB por dia se só crítico e urgente sobem sozinhos. **A subida da loja não foi medida** |

**No gravador:** uma sessão de leitura por vez (6 s cada). Nenhuma mudança de gravação é
necessária para o plano funcionar; o disco maior e o NTP são recomendações.

**Na nuvem**

| | conta |
|---|---|
| Trechos | 30 por dia × 1,3 MB ≈ 1,2 GB por mês por loja, com 30 dias de guarda |
| Onde guardar | piloto: tabela própria no banco, com teto e validade (nada novo a instalar). Antes da segunda loja: armazenamento de objetos. **O espaço livre do servidor não foi medido** (não acesso a VPS) |
| Relatórios | a mesma conta do especialista (medida: 17 ms de busca + 81 ms de cálculo para 24 dias). Feitos à noite, por trabalho agendado |
| Planta | grade de 25 cm: loja de 200 m² = 3.200 células × até 16 câmeras — milissegundos, no navegador |

**No gasto com IA**

| | conta |
|---|---|
| Hoje | R$ 16,87 por noite (≈ R$ 500 por mês), 93% sem resposta |
| Porteiro "com pessoa" | ≈ −55% das perguntas |
| Recorte nativo | a imagem custa mais: de 299 para ≈ 700 unidades de imagem num recorte de ¼ do quadro (2,3×) |
| Resultado esperado | **gasto parecido, com resposta** — a conferir no teste lado a lado |
| Rajada (ação) | 3× a imagem, só nos critérios de ação |
| WhatsApp | R$ 1,20 a R$ 2,80 por pessoa por mês, com os três resumos |

### A ordem

Tamanho: **P** = até meio dia de trabalho; **M** = um dia; **G** = dois a três dias.
É a minha parte; o que depende do dono está na coluna ao lado.

| onda | o quê | tamanho | depende de |
|---|---|---|---|
| 0 ✅ | Confiança em %; cliente do gravador sem travar; base de equipamentos corrigida (o gravador comprime em H.265, a base dizia H.264) | P | — |
| 1 | Critérios que respondem: saúde do critério, recorte nativo, rajada, episódios, caixas do detector | G | o "pode" do teste pago (≈ R$ 5); o dono desenhar as áreas e ligar o porteiro |
| 2 | **Protótipo da cara nova**, já com as telas novas das ondas 3, 4 e 6 | G | aprovação do dono |
| 3 | O momento do ocorrido: prova de bancada → relógio medido a cada busca → captura automática → guarda → subida → "Ver o momento" | G | onde guardar na nuvem; recomendações do gravador |
| 4 | Relatórios e resumos; o início "fora do critério primeiro"; índice da loja | G | o transportador (Regem/n8n) entregando; modelo de WhatsApp aprovado na Meta |
| 5 | Porte da cara nova para o app, por partes | G | onda 2 aprovada |
| 6 | O ambiente que calcula (5.1 a 5.8), a forma livre (5.9) e o rascunho (5.10) | G + M + M | teste dos 5 rascunhos |
| 7 | A pessoa na planta e o mapa de calor | G | ondas 1 e 6 |
| 8 | Busca investigativa (A8), que reaproveita a onda 3 | G | HD maior |

As ondas 1 e 2 andam juntas: uma é do agente e da API, a outra é desenho.

**Onda 0 — feita em 08/10/2026.** A confiança aparece em porcento no painel da loja, nas
Análises, na linha de ajustes de cada critério e no campo da gaveta ("Confiança mínima, em
%"); a API continua guardando a fração, com três casas, e o que abre para editar não é
arredondado (72,5% vai e volta inteiro). O protótipo foi atualizado junto. O cliente do
gravador zera a conta de tentativas a cada pedido (ERR-053 do registro de erros). A medida
do relógio do gravador saiu desta onda: ela só tem uso junto da busca do trecho, e foi
para a onda 3.

### Ideias acrescentadas

- **Episódio e minutos fora** no lugar de contagem de avisos (frente 1).
- **Índice da loja**, comparável entre lojas da rede (frente 4).
- **Ciência do evento**: quem viu, o que foi feito — o ciclo que as saídas do padrão já
  fecham, levado a todo evento.
- **Compartilhar o momento** por link que vence (para o gerente, pelo WhatsApp).
- **Biblioteca de exemplos**: marcar um trecho como "exemplo do certo" ou "do errado" —
  material de treinamento da equipe, direto da operação.
- **Aviso no navegador e no celular** (notificação do próprio app), sem custo por
  mensagem, ao lado do WhatsApp.
- **Modo parede**: o estado da loja numa TV, sem toque.
- **A câmera saiu do lugar**: comparação diária com a foto padrão.

### O que não foi medido

- Quanto tempo depois do instante o gravador já entrega o trecho (medimos um trecho de
  30 minutos atrás).
- Tempo e tamanho da conversão para H.264 no PC da loja.
- A subida da internet da loja; o espaço livre do servidor.
- O ganho real do recorte nativo e da rajada (é o teste pago da onda 1).
- Vários trechos e vários fluxos ao vivo ao mesmo tempo, no cabo de hoje.
- O preço oficial do WhatsApp no Brasil.
- Se o disco do gravador é SSD ou HD.

### Decisões que são do dono

1. Aprovar o plano e a ordem das ondas.
2. O disco do gravador: trocar por um de vigilância (recomendo 4 TB: ≈ 11 dias).
3. Ligar o NTP no gravador — eu ligo pela API, com o "pode", ou o dono liga no menu.
4. O teste pago da onda 1 (≈ R$ 5).
5. Quais trechos sobem sozinhos (recomendo: crítico e urgente).
6. Por quanto tempo guardar: na loja (recomendo 30 dias, 10 GB) e na nuvem (30 dias).
7. Onde guardar na nuvem (recomendo: banco no piloto, objetos antes da segunda loja).
8. A direção da cara nova (recomendo B + as peças do C) e a lista de telas do protótipo.
9. Confirmar que e-mail e WhatsApp saem pelo transportador (Regem/n8n).
10. Mapa de calor: por setor e horário, anônimo (recomendo).
11. Borrar rosto nos trechos: seguir o critério (recomendo), sempre, ou nunca.

**Aprovado pelo dono em 08/10/2026** ("está tudo aprovado"), lido como as onze na opção
recomendada. Na mesma mensagem ele apontou o que faltava — a análise de processos, os
ingredientes da montagem e a ligação entre quadros e critérios — e pediu que nada fosse
aplicado antes disso. **A ordem das ondas passou a ser a do A19.**

---

## A19 · O Farol entende o processo: quadros, acontecimentos, etapas e a leitura da bancada (aprovado em 09/10/2026; onda 1 em andamento)

**O dono aprovou o A18 em 08/10/2026 ("está tudo aprovado")** — lido como as onze decisões
na opção recomendada. E apontou o que faltava:

1. não havia plano para **analisar os ingredientes da montagem e identificar o produto**;
2. a ligação entre **quadros e critérios está confusa** — o certo é
   `canal [ quadro 1 [critérios] · quadro 2 [critérios] · critérios gerais da imagem completa ]`;
3. as análises estão **limitadas a presença e a uma lista curta de objetos**; a cozinha
   pede julgar **ações de pessoas, preparo e processos**, comparando, se for o caso, **o
   contexto completo do processo**;
4. **nada de aplicar alterações antes de o projeto analisar de verdade** os processos e o
   funcionamento da loja;
5. "se não existe ferramenta que reconheça os ingredientes, **crie uma solução**, um
   algoritmo, tirando ideias do que já temos";
6. o **canal 4 recebeu a câmera nova**: Intelbras VHD 3250 VF G8 (varifocal de 2,7 a 12 mm,
   1080p);
7. os critérios têm de ser **estudados para gerar gatilhos**, sem julgamento desnecessário
   "sem movimento ou sem o contexto acontecendo". O exemplo dele: para saber se o
   colaborador da chapa salga as carnes, é preciso haver carne na chapa e colaborador no
   posto — sem isso não se analisa. "Temos que ter um **estudo condicional dos critérios**,
   para aprimorar e já servir de funil para as análises."

Este bloco é a resposta. Ele **reordena o A18**: o que faz o Farol analisar de verdade vem
antes do vídeo do ocorrido, dos relatórios e do porte da cara nova. E traz para dentro do
plano o estudo da montagem (`docs/estudo-montagem-em-escala.md`), que tinha ficado de fora.

### O que foi olhado antes de escrever

**Na loja, com ela aberta (08/10, 21h20 às 22h) — canal 4, a câmera nova sobre a bancada:**

| o quê | medido |
|---|---|
| Imagem | 1920×1080, 15 quadros/s, H.265 |
| Detalhe na bancada | **≈ 12 px por cm** (a comanda, tomada como de 80 mm, ocupa ≈ 100 px). A meta do estudo era 12,8 |
| O enquadramento | **35% do quadro é piso**; as cubas ficam **cortadas no topo** e parte delas atrás dos suportes pendurados na prateleira; há um **reflexo forte da luminária** no meio do inox; a lente está perto do mais aberto (2,7 mm) |
| O que aparece | a impressora de comandas e o teclado; **a comanda impressa fica na bancada, ao lado do lanche** (visto nas duas observações) |
| Movimento em 150 s | nada mexendo em 70% do tempo; mão na faixa das cubas em 6% (8 idas de ≈ 0,5 s); o lado da embalagem em 29% |
| Mão em movimento | sai borrada (obturador lento); parada, fica nítida |
| Olhar para trás | o gravador **já entrega o que gravou 8 s antes** (6 s = 1,59 MB em 1,8 s) |
| Folga da máquina | com a loja aberta: **3% do processador e 3% da placa de vídeo** |

O canal 1 (vista geral, câmera antiga) vê de lado a linha inteira de cubas, a tostadeira e
as fritadeiras: serve de segunda vista.

**No código** (levantamento completo de 08/10):

- o banco **já liga critério a área** (`regra_alvo`), com várias áreas por canal. Não
  existe "critério geral do canal": marcar o canal grava a área "Quadro inteiro". A
  confusão é de tela — a lista de canais não mostra as áreas; com uma área só ela é
  invisível e, ao criar a segunda, os critérios antigos aparecem sob "Quadro inteiro" sem
  aviso; o nome "Quadro inteiro" continua depois de a área ser redesenhada (no canal 4 ele
  cobre 20% × 78% do quadro); "vale em N canais" às vezes conta áreas;
- **todo julgamento usa um quadro só**, inclusive "ação";
- a descrição do processo (`processo_descricao`) existe no banco, desce ao agente e **não
  chega ao juiz**; a tela não tem o campo;
- fotos de referência do certo e do errado só entram pela linha de comando;
- existem no código, **sem estar ligados ao serviço**: o juiz binário ("é o queijo, que
  deveria entrar agora?"), a base de exemplos por semelhança e o gancho "o que o Regem
  sabe" (pedido em produção, ficha técnica);
- **nada traz o pedido em preparo** do Regem para o Farol;
- o único banco de provas é manual, com 6 imagens.

**No mercado e na pesquisa** (verificado em 08/10/2026):

- **Quem confere montagem sabe o pedido antes** — recebe do caixa ou da tela da cozinha
  (Agot AI, PreciTaste, Dragontail) ou **lê a comanda** (Plainsight) — e só confere.
  Ninguém alega identificar o produto do zero. A câmera é dedicada, de cima, perto da
  estação. A maior rede de fast-food confere com balança, não com câmera.
- **Higiene e procedimento por pessoa** (touca, luva, celular) rodam em câmera de
  segurança comum.
- **Armadilhas relatadas:** queijo derretido esconde o que está embaixo; lanche embrulhado
  é opaco; alerta falso faz a equipe ignorar o sistema; imagem casada com o pedido errado;
  uso como punição gera rejeição.
- **O que a pesquisa mede** (em conjuntos de teste públicos): reconhecer etapas, com
  exemplos rotulados, 70% a 90%; fluxo por zonas com câmera de teto, ≈ 80%; **detectar
  erro de procedimento, nota de 40 a 70 em 100, com muito alarme falso**; modelos de
  linguagem com visão acertam bem "o que aparece" e mal "em que ordem" (≈ 50% contra
  ≈ 90% de uma pessoa).
- **Modelo de nuvem:** saiu o Claude Haiku 5.5, a **US$ 0,10 por milhão** — dez vezes
  menos que o Haiku 4.5 que o agente usa hoje — e ele aceita a imagem de 1080p sem reduzir.
- **Licenças** (produto distribuído): ficam RF-DETR, RTMPose, MediaPipe, DINOv2, SigLIP e
  CLIP (Apache ou MIT). Ficam fora Ultralytics/YOLO (AGPL), YOLO-World (GPL), DINOv3 e
  Qwen2.5-VL-3B.

Fontes: tabela de preços e modelos da Anthropic
(<https://platform.claude.com/docs/en/about-claude/pricing>,
<https://platform.claude.com/docs/en/about-claude/models/overview>); patente da Agot
(<https://patents.google.com/patent/US11562569B2/en>); Plainsight
(<https://insights.plainsight.ai/food-order-accuracy-software/>); detecção de erro em
procedimento (<https://arxiv.org/html/2404.01933>, <https://arxiv.org/html/2606.21579>);
ordem temporal (<https://arxiv.org/abs/2410.02763>); fluxo por zonas
(<https://arxiv.org/html/2506.06081v1>).

### A regra que organiza tudo: observar → ensaiar → medir → avisar

Pedido 4 do dono, virado método. Toda capacidade nova e todo critério passam por quatro
estados, e a tela mostra em qual está:

| estado | o que faz | sai dele quando |
|---|---|---|
| **observando** | só colhe números do que acontece; não julga | há dados de pelo menos alguns dias de operação |
| **em ensaio** | julga e mostra, **não avisa ninguém** | o responsável marcou "acertou / errou" num número mínimo de exemplos |
| **medido** | tem o acerto, o alarme falso e o "não deu para ver" medidos, à vista no critério | passa da meta combinada |
| **valendo** | avisa | — (volta a "em ensaio" se o texto, o quadro ou o modelo mudar) |

O código já previa: o critério "nasce desligado até ter acurácia medida". Faltava a medida.

### Frente A · Canal → quadros → critérios

**As palavras** (as do dono):

- **canal** — a câmera;
- **imagem completa** — o canal inteiro; os critérios dela são os **critérios gerais**;
- **quadro** — um recorte marcado dentro da imagem, com nome e **papel**; cada quadro tem
  os seus critérios.

"Quadro inteiro" deixa de ser nome de área.

**O que muda:**

| | hoje | passa a ser |
|---|---|---|
| Imagem completa | uma área como as outras, que pode ser redesenhada | fixa, sempre o canal inteiro. Quem quer menos, marca um quadro |
| Áreas já redesenhadas | "Quadro inteiro" cobrindo 20% do canal | viram "Quadro 1", e o canal ganha a imagem completa de volta (migração) |
| Papel do quadro | não existe | posto de trabalho · cuba (ingrediente) · posição de montagem · equipamento · impressora/comanda · caixa/gaveta · pia · piso · livre |
| Tela do canal | lista de canais sem as áreas; área e critério em telas separadas | a imagem com os quadros numerados e, ao lado, a árvore: **Imagem completa (critérios gerais) · Quadro 1 (critérios) · Quadro 2 (critérios)**, com "+ critério" em cada um |
| Contagens | "vale em N canais" ora conta canais, ora áreas | "em N canais (M quadros)" |
| Quadros sobrepostos | só um aviso | o critério diz em qual quadro vale; a sobreposição aparece desenhada |

O banco muda pouco (o vínculo já existe): um campo de papel, uma ordem, a migração das
áreas redesenhadas. O trabalho é de tela — **protótipo antes**.

### Frente B · O que o Farol sabe julgar

**De cinco tipos para quatro famílias:**

| família | a pergunta | exemplos | como julga | o que devolve |
|---|---|---|---|---|
| **Estado** | "como está?" | bancada limpa; uniforme; cuba abastecida | um quadro, o melhor (existe) | veredito |
| **Acontecimento** | "aconteceu? alguém fez?" | abriu a gaveta; usou o celular; derrubou | uma **sequência curta**: o que o gravador tem dos segundos anteriores + o agora | veredito + o instante |
| **Processo** | "foi feito como manda?" | lavar as mãos antes de montar; uso da chapa; montagem; abertura e fechamento | **etapas ao longo do tempo**, cada uma no seu quadro | veredito **por etapa** |
| **Medida** | "quanto? por quanto tempo?" | lanches montados por hora; tempo do pedido na bancada; minutos sem ninguém no posto | conta ou cronometra acontecimentos | **número**, não veredito |

Presença, contagem e comparação com a foto padrão continuam; passam a ser formas de Estado
e de Medida. O critério "Produto" que o dono cadastrou (contar a produção) é uma Medida —
por isso nunca teve juiz.

**O estudo condicional de cada critério — o funil.** Pedido 7 do dono. Antes de julgar,
cada critério ganha uma ficha com seis partes. O exemplo é o dele:

| parte | a pergunta | "o colaborador da chapa salga as carnes?" | como se confere |
|---|---|---|---|
| **Contexto** | o que precisa estar acontecendo? | há carne na chapa **e** há colaborador no posto | na loja: o quadro da chapa difere da chapa vazia; presença no quadro do posto |
| **Gatilho** | o que abre a análise? | uma carne acabou de ser posta | na loja: "algo foi posto" no quadro da chapa |
| **Janela** | até quando observar? | até a carne ser virada ou tirada (ou N segundos) | na loja |
| **Ação** | o que se procura na janela? | o gesto de salgar sobre a carne | a sequência da janela — regra local se houver sinal; senão, nuvem |
| **Desfecho** | como termina? | salgou: dentro · a janela fechou sem salgar: fora · a mão tapou: não deu para ver | — |
| **Fora de contexto** | e sem carne, ou sem ninguém? | **não se julga, não se paga e não conta como análise** | — |

- **Quem escreve a ficha:** ao cadastrar o critério, o sistema propõe as seis partes
  (uma consulta à nuvem, centavos, uma vez) e liga cada condição a um sinal que **este
  canal e estes quadros** já dão. Onde não houver sinal local, ele diz — e mostra o custo.
  O responsável confirma ou corrige.
- **O funil aparece em números**, em Análises e no próprio critério: olhadas → com
  contexto → com gatilho → julgadas → fora do critério. E, no estado "observando", o
  critério já mostra **quantas vezes por dia o gatilho acontece** e quanto custaria ligado.
- O porteiro de hoje ("sempre", "com pessoa", "área livre", "movimento") vira um caso
  particular do contexto.
- **Quando a ação é fina demais para a câmera** (o sal não aparece), a ficha sugere dar a
  ela um rastro visível: o **lugar marcado da ferramenta**. O saleiro saiu do lugar e
  voltou dentro da janela = salgou. É conferência local, barata e objetiva — e é o
  ambiente virando padrão, como o dono pediu no A18.
- A medida de 08/10 mostra o tamanho do problema: 93% das análises pagas foram feitas
  fora de contexto (cozinha vazia, chapa sem carne).

**O que sobe para a nuvem: o recorte nunca vai sozinho.** Pergunta do dono (08/10, 22h30):
"o que sobe à nuvem? o quadro completo ou o nosso quadro com corte? Se enviar um corte sem
contexto, a análise vai falhar e o custo vai ser em vão — não pode enviar o corte do tampo
da montagem sem informar que é para analisar os ingredientes sobre um tampo de montagem,
numa hamburgueria."

*Hoje* (lido no código e na loja, configuração 113):

| | o que vai |
|---|---|
| A imagem | **o recorte da área** — nunca o canal inteiro, a não ser que a área seja ele —, com o que fica fora do desenho apagado, o rosto borrado e **reduzido a 640 px no lado maior** |
| O texto | o texto do critério, e mais nada da cena. As instruções fixas dizem só "estabelecimento alimentício" |
| O que poderia ir, e não vai | a frase do lugar (depende da planta desenhada: 0 caracteres na loja), os equipamentos (0), a foto padrão (0), a descrição do processo (o campo existe e não entra no pedido) |
| A resposta possível | "dentro", "fora" ou "não deu para avaliar", e uma frase |

A loja e o canal não têm onde guardar "que negócio é" nem "o que esta câmera vê": não
existe o campo.

O exemplo da noite de 08/10 — critério "Produto" (ação), canal 4, área sobre o tampo,
texto "identificar itens (ingredientes) de montagem do hambúrguer":

- subiu uma **tira de 640×155 px**. O tampo tem 1.629×397 px na câmera: foi com 15% dos
  pixels, a ≈ 4,7 px por cm;
- 190 análises em duas horas, R$ 2,33: **118 "dentro" e 72 "não deu para avaliar"**;
- "dentro", aqui, não quer dizer nada. O modelo respondeu que viu ingredientes ("pães,
  carnes, queijo em fatias") e chutou o resto ("embalagem tipo batedeira", "ingrediente
  rosa, possivelmente carne ou tomate"). Não há lista, não há produto, não há comparação
  com pedido: **a resposta só sabe ser veredito**;
- o que ele acertou veio de uma frase: o texto do critério dizia "montagem do hambúrguer".
  O contexto dependeu de quem cadastrou lembrar de escrevê-lo.

Nos três critérios que foram com o canal inteiro, na mesma noite (1.510 análises,
R$ 19,83, 93% sem resposta), o próprio modelo disse o que faltava: "não permite identificar
qual elemento é a gaveta de dinheiro"; "não há contexto temporal"; "a imagem está de
cabeça para baixo".

*No plano* — a anatomia de todo pedido à nuvem, nesta ordem:

| # | parte | o que é | de onde vem | custo |
|---|---|---|---|---|
| 1 | **A cena** | que negócio é, que setor e que posto, de onde a câmera olha: "hamburgueria; bancada de montagem; câmera no teto, olhando de cima" | escrita **uma vez** por canal, **por quem configura, com detalhes** (decisão do dono em 09/10: sem proposta a partir da imagem; um botão só para aprimorar o texto fica para depois). A loja ganha o campo "tipo de negócio" | fixo, em cache |
| 2 | **O mapa do canal** | a imagem fixa do canal, pequena, com os quadros numerados e o papel de cada um: "1 = cubas; 2 = onde o lanche é montado, sobre papel alumínio; 3 = impressora" | os quadros do canal (frente A) | fixo, em cache |
| 3 | **O recorte, na resolução da câmera** | o quadro do critério como a câmera entrega (1.629×397, não 640×155) — ou a sequência de recortes, numerados | ao vivo | é o que se paga inteiro |
| 4 | **A pergunta, na forma da família** | estado: o critério · acontecimento: "aconteceu X nesta sequência?" · processo: as etapas numeradas · leitura: "liste o que há em cada posição" | a ficha do critério | — |
| 5 | **O que se espera** | a ficha do produto, quando o pedido é conhecido; as fotos de referência do certo e do errado | o Regem; o responsável | fixo por critério, em cache |

E **a resposta toma a forma da pergunta**: veredito (estado); veredito e instante
(acontecimento); lista por etapa — feita, não feita, não deu para ver — (processo);
**lista por posição — ingrediente e confiança —** (leitura); número (medida).

Três regras, cada uma com teste:

1. **Recorte nunca sobe sozinho.** Sem a cena escrita, o pedido não sai da loja: o critério
   aparece como "falta descrever a cena", e não como análise feita.
2. **Critério geral manda a imagem completa; critério de quadro manda o mapa e o recorte.**
3. **O que é fixo vai em cache** — a cena, o mapa, as referências. Ler do cache custa de 5%
   a 10% do preço; o que se paga inteiro é só o recorte ao vivo.

O contexto custa quase nada: o mapa (640×360) são 299 unidades de imagem e a cena, umas
200 de texto — em cache, menos de R$ 0,0001 por pedido no Haiku 5.5. Um recorte na
resolução da câmera sai por ≈ R$ 0,001; a sequência de seis, por ≈ R$ 0,004. Hoje cada
tira de 640×155 custa R$ 0,012 e vai sem contexto. (Conta sobre a tabela oficial.)

**Medido na noite de 08/10 — o teste lado a lado.** Autorizado pelo dono ("pode", teto de
R$ 5,00; gasto: R$ 2,91). A mesma cena de três maneiras, em 40 momentos da gravação do
canal 4, com gabarito meu e provisório — o registro inteiro está em
[teste-contexto-na-nuvem.md](teste-contexto-na-nuvem.md):

| maneira · modelo | achou, dos 89 alimentos à vista | inventou | momentos sem erro | custo | tempo |
|---|---|---|---|---|---|
| hoje (640×155, o pedido de hoje) · Haiku 4.5 | 58% | 17 | 4 de 40 | 1,20 centavo | 2,0 s |
| só a imagem maior · Haiku 4.5 | 58% | 16 | 4 de 40 | 1,56 centavo | 2,2 s |
| cena + mapa + recorte + lista · Haiku 4.5 | 66% | 25 | 8 de 40 | 2,45 centavos | 3,8 s |
| **cena + mapa + recorte + lista · Haiku 5.5** | **79%** | **15** | **17 de 40** | **0,14 centavo** | **1,7 s** |
| cena + mapa + recorte + lista · Sonnet 5.5 (em 14 momentos) | 79% | 0 | 8 de 14 | 5,45 centavos | 6,3 s |

O que o teste fixa no plano:

1. **Mais pixels sem contexto não compram nada** (58% → 58%, 30% mais caro). O recorte na
   resolução da câmera só vai junto com a cena e com a pergunta em lista.
2. **O Haiku 5.5 é o modelo da leitura de rotina:** com o contexto, acha mais, inventa
   menos, responde a todos, é mais rápido e custa 8 vezes menos que a análise de hoje. O
   cache funcionou nele (39 de 40 chamadas leram o trecho fixo); no Haiku 4.5 **nunca**
   entra — o trecho fixo fica abaixo do mínimo daquele modelo.
3. **O Sonnet 5.5 não inventou nada**, mas custa 39 vezes mais: desempate e conferência por
   amostragem, nunca rotina.
4. **Um quadro só não basta para avisar.** O melhor ficou em 79%; ninguém vê bem o molho, e
   a carne clara se confunde com o pão. É a confirmação medida de que a leitura acompanha a
   montagem (frente C) e de que nenhum aviso sai antes do banco de provas.
5. **A reconsulta ao modelo forte nunca funcionou** — o Sonnet 5.5 recusa a forma de
   chamada que o agente usava, e o erro levava junto a resposta do modelo barato; o botão
   "Analisar as fotos e descrever" tinha o mesmo defeito. Corrigido no PR #69.
6. **O borrão de rosto atrapalha o quadro de bancada:** apagou pão em 12 dos 40 momentos e
   não pega a cabeça vista de cima. Na bancada o quadro que sobe é o de "as mãos saíram", e
   quem aparece é apagado pelo contorno — entra na onda 1.

**A sequência.** Ao disparar, o agente busca no gravador os segundos anteriores (medido:
disponível 8 s depois) e junta o agora. Manda **6 quadros numa grade 3×2**, recorte na
resolução da câmera, cada um numerado — o formato que a pesquisa mediu como o melhor. Para
processo longo, os quadros são escolhidos **por mudança** (o instante depois que a mão sai),
não por relógio.

**Na dúvida, a busca pelo meio** (pedido do dono em 10/10/2026, medido na mesma madrugada —
rodada 5 de `docs/teste-das-fichas.md`). Quando a leitura perde uma etapa — a tampa aparece
nua numa olhada e coberta na seguinte —, o agente não busca o intervalo inteiro: pede ao
gravador **o bloco de 2 s do meio**, escolhe na loja o quadro parado da tampa e julga só
esse. Nua: anda para a frente; coberta: para trás; molho à vista: achou, e a dúvida acaba
sem aviso. Se não achar, sobra a janela em que a mão está sobre a tampa, e dela sai a grade
de 6 quadros com a pergunta "o que foi posto". Medido: um passo leva cerca de 3,3 s (1,9 s
é baixar, numa rede presa em 10 Mbit/s até a troca do cabo); nos lotes com molho coberto
bastou um passo, e no lote sem molho, dois blocos e uma grade (cerca de 7 s). Tocar 10 s de
gravação leva de 11 a 13 s; baixá-los inteiros, de 5 a 7 s.

**A escada de juízes** — do barato ao caro, local primeiro:

| degrau | o quê | onde | custo |
|---|---|---|---|
| 1 | **Sinais por quadro**, o tempo todo: movimento, presença, braço e mão, mudança contra a foto padrão | loja | 6 ms por quadro (medido) |
| 2 | **Acontecimentos por regra**: "a mão entrou na cuba 3", "algo ficou na posição 2", "a comanda saiu", "20 s na pia" | loja | desprezível |
| 3 | **Processo**: os acontecimentos, em ordem, contra as etapas esperadas | loja | desprezível |
| 4 | **Nuvem, com a sequência e o contexto completo**: para o que não tem regra local, para desempatar e para conferir por amostragem | nuvem | ≈ R$ 0,003 por sequência |
| 5 | **A loja ensina**: "acertou / errou" e os exemplos viram o conjunto de prova e, depois, um classificador da própria loja | loja + nuvem | uma vez |

O degrau 4 é o que **abre o leque já**: qualquer ação ou processo descrito em texto pode
ser julgado numa sequência, sem esperar modelo próprio. Os degraus 1 a 3 entram onde o
volume é alto ou o aviso tem de ser na hora (a montagem).

**O que esperar, sem enfeite:**

| | expectativa | por quê |
|---|---|---|
| Presença, permanência, ordem dos postos, tempos | boa | é geometria e relógio |
| "O que aparece" numa sequência (tem touca? a chapa está fechada? pôs o queijo?) | boa, **a medir no banco de provas** | é o forte dos modelos |
| "Em que ordem aconteceu" | fraca pelo modelo; **boa quando a ordem sai dos acontecimentos locais** | a ordem é medida no relógio, não perguntada ao modelo |
| "Houve erro no procedimento" | **triagem, com revisão humana** — nunca punição automática | a literatura mede muito alarme falso |
| Camada fina (molho), ingredientes parecidos, o que fica embaixo do queijo | limitada | a câmera não vê |

**Exemplos do que passa a caber:**

| o que se quer saber | família | como |
|---|---|---|
| Lavou as mãos antes de voltar à montagem | processo | ≥ 20 s no quadro da pia (local) antes de entrar no quadro da bancada; a nuvem confere a sequência na dúvida |
| Touca e uniforme | estado | recorte da pessoa na resolução da câmera, só com gente no quadro |
| Usou o celular na produção | acontecimento | o detector já conhece "celular"; a sequência confirma |
| Bancada limpa entre pedidos | estado | comparação com a foto padrão quando a bancada fica livre (local) |
| Uso da chapa (fechou, tempo, abriu) | processo | mudança no quadro da chapa, cronometrada; sequência na nuvem |
| Gaveta do caixa aberta sem cliente | acontecimento | mudança no quadro da gaveta + presença no quadro do cliente |
| Lanches montados por hora, por bancada | medida | leitura da bancada (frente C) |
| Tempo do pedido na bancada | medida | da comanda impressa ao lanche embalado |
| Montagem conforme a ficha | processo | leitura da bancada + ficha |
| Pedido completo na sacola | processo | itens postos no quadro da embalagem × o pedido |
| Abertura e fechamento | processo | etapas por quadro, em 30 min |

**Como o processo é cadastrado.** O responsável descreve "como explicaria a um funcionário
novo". O sistema devolve as etapas numeradas, o quadro de cada uma, o que observar — e
**o que a câmera não vai conseguir ver**. Ele ajusta, e o critério nasce "em ensaio".
Modelos prontos por área (higiene, chapa, montagem, embalagem, caixa, limpeza, abertura
e fechamento).

### Frente C · A leitura da bancada — o algoritmo para ingredientes e produto

Não existe ferramenta pronta que reconheça os ingredientes desta loja. O algoritmo abaixo é
nosso, montado com o que o Farol já tem: os quadros por pontos, a foto padrão e a
comparação por blocos, o detector, o vigia (que olha o tempo todo, barato), o porteiro de
movimento, a base de exemplos por semelhança e o juiz binário.

**A ideia central: três provas independentes para cada camada, nenhuma delas "adivinhar o
ingrediente pela foto".**

| prova | a pergunta | como | custo |
|---|---|---|---|
| **1 · de onde a mão veio** | "de qual cuba ela pegou?" | cada cuba é um quadro com o papel "ingrediente X" (o **planograma** da bancada). A ponta do braço dentro do quadro por 0,2 s = pegou X | regra, local |
| **2 · o que ficou** | "a camada nova parece X?" | quando a mão sai, o pedaço que mudou na posição de montagem é comparado com os exemplos de X — pergunta de **sim ou não**, contra o que as fichas abertas esperam | local, ms |
| **3 · o que o pedido espera** | "X é uma das camadas que deviam entrar agora?" | as fichas dos pedidos abertos reduzem as hipóteses a duas ou três | regra |

As três concordam: camada confirmada. Discordam: "duvidosa" — vai, depois, para a nuvem
com a sequência, e vira exemplo. Nunca vira aviso sozinha.

**Depois do estudo do lote (08/10, 21h42) — o que mudou neste desenho.** Um lote inteiro
foi lido da gravação, de 2 em 2 segundos, e escrito passo a passo em
[estudo-do-lote-de-montagem.md](estudo-do-lote-de-montagem.md). Cinco lanches em 4 min 30 s.
Quatro coisas que o desenho acima não sabia:

- **A montagem é por ingrediente, em lote** — todos os pães, todas as carnes, todo o molho,
  toda a alface, todo o queijo —, e cada fase (de 8 a 34 s) tem um objeto que a denuncia: a
  cuba das carnes e o pegador, a bisnaga, o maço de queijo, o sachê, o papel de embrulho.
  A prova 1 passa a valer como **"em que fase estamos"**: a ida à cuba é um sinal, o objeto
  na mão é o outro.
- **Uma leitura por fase, quando as mãos saem.** No fim de cada fase a camada que entrou
  está por cima em todas as posições, sem mão na frente: três a cinco quadros contam o lote
  inteiro. A foto final sozinha não serve — mostra o queijo e a alface e esconde a carne e
  o molho.
- **A unidade da leitura é o disco.** A folha (ou a caixa) continua sendo a posição; dentro
  dela o lanche fica aberto em dois ou três discos — a tampa do pão e um disco por carne —
  e é em cada disco que as camadas se empilham. O número de discos já diz o tamanho do
  lanche, e o produto tem **assinatura**: quantos discos, a cor da carne, a cor do molho,
  se tem queijo e alface.
- **A conferência com o KDS começa pela conta do lote.** As embalagens são marcadas à
  caneta e nenhuma comanda apareceu no recorte: não há nada legível por máquina ligando o
  lanche ao pedido. O que já dá para conferir é "o KDS tinha em preparo quatro deste e um
  daquele; a bancada fez quatro deste e um daquele" — e, em cada disco, "toda carne levou
  queijo".

**O passo a passo:**

1. **Cadastro, uma vez por bancada:** os quadros (cubas com o ingrediente de cada uma,
   área de montagem, impressora, embalagem) e a foto padrão da bancada vazia.
2. **O braço:** o que difere do fundo e está ligado à borda do operador é o braço; a ponta
   é a mão. Sem modelo: é geometria da vista de cima.
3. **"Pegou":** a mão dentro do quadro de uma cuba por 3 quadros seguidos.
4. **Posição de montagem:** nesta loja o lanche é montado sobre uma folha de papel
   alumínio ou dentro da caixa. A folha (ou a caixa) que aparece na bancada **abre uma
   posição**; o que entra em cima é camada dela; quando sai inteira, fechou. **Cada
   posição que fecha é um lanche montado** — a contagem de produção que o critério
   "Produto" pedia. Dentro da posição o lanche fica **aberto em discos** (a tampa do pão
   e um disco por carne), e as camadas se empilham em cada disco. O fechamento se vê de
   dois jeitos: a tampa da caixa fecha e o lanche fecha junto; ou os discos são
   empilhados, a tampa é virada por cima e o lanche é embrulhado.
5. **"Pôs" e "tirou":** quando a mão sai de cima de uma posição e ela fica parada por
   0,6 s, compara-se com a última vez em que esteve parada. Mancha nova = algo foi posto;
   mancha que sumiu = tirado. Guarda-se o tamanho em centímetros, a cor e o recorte. A
   quietude é **por posição**, não da bancada inteira (no pico ela nunca para), e a mancha
   tem de ter cor e forma de alimento — o brilho do papel alumínio amassado não conta.
6. **A camada:** liga-se cada "pôs" ao último "pegou" (prova 1), confere-se a aparência
   (prova 2) contra o que as fichas abertas esperam (prova 3). Como a montagem é por
   ingrediente, o "pegou" vale para a fase inteira: o que entra em todas as posições até
   a fase mudar é o mesmo ingrediente.
7. **O produto:** a sequência de camadas de uma posição contra as fichas abertas. Sobra
   uma: é o produto. Não sobra: a mais parecida, e a diferença é o texto do aviso
   ("x-salada sem o tomate") — sempre por item.
8. **O pedido:** a comanda sai da impressora dentro do quadro. O instante amarra a
   bancada ao pedido que o Regem acabou de imprimir; com vários abertos, um **código
   visual de 3 a 4 cm impresso na comanda** amarra cada lanche ao seu pedido (a ≈ 12 px
   por cm, cada célula do código tem 6 a 8 px: legível). Sem nada disso, vale o
   livro-caixa por produto do estudo — e é por ele que a conferência começa: **a conta
   do lote** contra o que o KDS tem em preparo.
9. **A loja se rotula sozinha:** toda vez que a mão vem da cuba X e uma camada aparece, o
   recorte ganha o rótulo "X" de graça. Em dias, cada ingrediente tem dezenas de exemplos
   **desta bancada, desta luz**. A nuvem confere uma amostra; o responsável corrige o que
   ela errar. Com ≈ 50 exemplos por ingrediente (estimativa; a pesquisa mede 84% de
   acerto com 16 exemplos por classe em fotos de comida bem mais variadas), treina-se o
   classificador da loja — uma regressão sobre a assinatura da imagem, segundos de
   processador, sem placa de vídeo.
10. **Quando a câmera sai do lugar:** a foto padrão deixa de bater; os quadros são
    realinhados sozinhos ou o sistema pede para conferir.

**O que o algoritmo não resolve, e o plano diz:** molho e camada fina (talvez "passou
molho", dificilmente "qual"); dois queijos parecidos (aí a prova 1 decide); o que fica
embaixo de outra camada (por isso se acompanha a sequência, e não a foto final); cuba
escondida da câmera.

**A primeira prova, ao vivo** — rodada em 08/10, às 22h, com os degraus 2 a 4 e a comanda:
ver "Prova de 08/10" abaixo.

**As etapas do estudo, atualizadas:**

| etapa | entrega | situação |
|---|---|---|
| **E0 · piloto de uma bancada** | câmera regulada; px por cm medido; números da operação por uma semana, em "observando": comandas, idas às cubas, itens postos, posições abertas ao mesmo tempo, tempo por lanche | **câmera instalada (canal 4) e regulada em 09/10**: ≈ 17 a 18 px/cm no centro do tampo (era 12), piso em 9% da imagem (era 35%); a leitura dos ingredientes com ela está em [teste-das-fichas.md](teste-das-fichas.md), rodada 4. Falta medir o px/cm por um objeto de tamanho conhecido, e os números da semana |
| **E1 · contar montagens** | lanches por hora e por bancada, pelo fechamento de cada posição; tempo de cada lanche aberto na bancada | precisa do passo 5 |
| **E2 · qual produto** | uma leitura por fase; discos, camadas e a assinatura do produto; **a conta do lote contra o KDS**; "pronto sem montagem", "montagem sem pedido" | precisa das fichas com as camadas visíveis (e em que disco ficam) e da fila do Regem |
| **E3 · conferir na hora** | aviso na estação antes de o lanche fechar | só com o alarme falso medido e baixo |
| **E4 · observações e porção** | "sem cebola", adicional, quantidade | depois |

**Regulagem da câmera do canal 4** (é o "regular e testar uma" do dono). Os passos foram
conferidos em 09/10 nos manuais oficiais — o da câmera (VHD 3250 VF G8, 01-25) e o do
gravador (MHDX 3116-C, 01-22):

1. **Subir o enquadramento:** afrouxar os parafusos do suporte, girar o suporte e o corpo
   da câmera e apertar — as cubas inteiras no topo, a borda da bancada embaixo, o piso
   fora.
2. **Fechar a lente.** O zoom e o foco ficam atrás da **tampa de baixo** da câmera: abrir
   a tampa e afrouxar, sem tirar, os dois parafusos da estrutura de ajuste. **O segundo
   parafuso é o zoom; o primeiro, o foco** — movem-se para a esquerda ou para a direita.
   Primeiro o zoom, até a bancada ocupar a largura do quadro (meta: 14 a 16 px por cm);
   depois o foco, que tem de ser refeito toda vez que o zoom muda. Apertar os dois e
   **fechar bem a tampa**. (O plano falava em "anel do zoom" e "anel do foco": este
   modelo não tem anel.)
3. **Tirar os suportes pendurados da frente das cubas**, ou deslocar a câmera alguns
   centímetros para que não as cubram.
4. **Tirar o reflexo de cima da área de montagem:** o inox e o papel alumínio espelham a
   luminária. Deslocar a luminária ou a câmera alguns centímetros, ou pôr um difusor na
   luminária. E **marcar na bancada onde as folhas são postas** (duas a quatro posições
   fixas): é o padrão de arrumação que mais ajuda a leitura.
5. **Folha A4 na bancada por um minuto**, para medir o px por cm com régua certa.
6. **O menu de imagem da câmera, pelo gravador** — botão direito sobre a imagem do canal 4:
   *Conf. câmera* (mostra na tela do gravador o brilho, o contraste, a saturação, a
   nitidez e o *Dia & Noite* da câmera) e *Menu da câmera* (botão *Entrar* e o joystick na
   tela; *Cancelar* salva e sai). Se o menu não responder: *Menu principal › Sistema ›
   PTZ*, canal 4, *Modo Controle* em HDCVI e *Protocolo* em Intelbras-1. **Este modelo
   não tem ajuste de obturador** — o plano sugeria 1/100, e estava errado. O que vale
   testar, um ajuste por vez e medindo antes e depois: *Dia/noite* em "Colorido" (a
   bancada é sempre iluminada, e a leitura depende da cor) e *Luz de fundo* em "HLC"
   (atenua o foco de luz — o reflexo do inox e do papel alumínio) contra "Off". O borrão
   da mão depende do tempo de exposição, que esta câmera decide sozinha: o que está ao
   alcance é **mais luz na bancada**, a testar.
7. **Depois de reenquadrar, redesenhar a área do canal 4**: a que existe deixa de bater.

Feito isso, eu meço de novo daqui (nitidez, px por cm, o que ficou visível).

### Frente D · O banco de provas — o que garante "analisar de verdade"

- Cada critério tem o seu **conjunto de prova**: sequências reais da loja com a resposta
  certa, marcada pelo responsável ("acertou / errou" e "o que era") — a tabela existe no
  banco e não tem tela.
- **Ensaio automático** a cada mudança de texto, de quadro ou de modelo: acerto, alarme
  falso e "não deu para ver", por critério.
- O número fica **à vista no critério** ("acerta 92% — medido em 60 exemplos").
- Só passa a "valendo" com a meta batida. A meta é do dono; sugiro alarme falso de no
  máximo 1 em 10 avisos para começar.
- A primeira rodada mede os critérios que a loja já tem e os primeiros processos, com o
  Haiku 5.5 e com o Sonnet 5.5, lado a lado. Custo: centavos.

### Prova de 08/10 — a leitura da bancada, ao vivo

Das 21h36 às 21h49, treze minutos com a loja em operação, no canal 4. Rodaram os passos 2,
3 e 5 e a comanda — **sem modelo nenhum e sem ajuste**: só diferença de imagem e geometria.
Nenhuma imagem inteira foi guardada; ficaram os números e uma folha com os recortes
pequenos do que ele detectou (apagada da loja depois de copiada).

| | resultado |
|---|---|
| Processamento | 11.707 quadros de 1080p, **15,0 por segundo, em tempo real**; 6,1 ms por quadro (mediana) |
| Mão na faixa das cubas | 146 idas, concentradas nas colunas 3 a 5 |
| Itens postos / tirados | 73 / 61 |
| Comandas | 32 — **não conferido** (esse sinal não guardou recorte) |
| O que os recortes mostram (96) | **≈ 40% são camadas e itens de verdade** — pão, carne, fatia de queijo, alface, molho branco, molho laranja, batata, caixa — **todos distinguíveis a olho no recorte**. Os outros ≈ 60% são brilho do papel alumínio e do inox |
| Onde se monta | os recortes de alimento vieram quase todos do terço esquerdo da bancada, sobre papel alumínio e em caixas |

O que a prova ensinou:

1. **O sinal existe.** A 12 px por cm as camadas aparecem e se distinguem — inclusive o
   molho, que o estudo temia não ver (branco sobre a carne aparece bem).
2. **A posição de montagem desta loja é a folha de papel alumínio** (ou a caixa).
3. **O papel alumínio amassado é o grande gerador de alarme falso.** Daí as duas regras
   do passo 5: comparar por posição, e exigir cor e forma de alimento.
4. **Esperar a bancada inteira parar atrasa a leitura no pico:** vários itens saíram no
   mesmo instante. A quietude tem de ser por posição.
5. Só 19 dos 73 "postos" vieram até 4 s depois de uma ida às cubas. Com as duas correções,
   esse é o número que mede o progresso.

Não é acerto medido: não houve contagem humana para comparar. É a prova de que o caminho
tem sinal — e o primeiro dado da etapa E0.

### Estudo do lote de 08/10 — a montagem, passo a passo

Pedido do dono: estudar o padrão de montagem com a loja em operação, para depois comparar
os pedidos do KDS com o que é produzido. Um lote inteiro (21h42min45 a 21h47min35), lido da
gravação do canal 4 de 2 em 2 segundos — 146 recortes, olhados um a um, sem nuvem. O
registro completo: [estudo-do-lote-de-montagem.md](estudo-do-lote-de-montagem.md).

| fase | duração | o que denuncia a fase |
|---|---|---|
| forrar | — | quatro folhas de papel alumínio e uma caixa aberta |
| pães | 26 s | chegam empilhados; cada um aberto em discos, lado cortado para cima |
| carnes | 32 s | a cuba das carnes sobre a bancada e o pegador: uma carne por disco |
| molho | 8 s | a bisnaga, nas tampas |
| alface | 26 s | por cima do molho |
| queijo | 34 s | o maço de fatias na mão: uma por carne |
| fechar e embalar | 1 min 20 s | a tampa da caixa; ou empilhar, virar a tampa, embrulhar e pôr na caixinha; código à caneta |

Saíram **quatro lanches de duas carnes** (três discos cada; 8 carnes, 10 fatias de queijo
— a caixa levou o dobro: errata abaixo —, 4 tampas com molho laranja e alface) e **um
lanche de outro tipo** (dois discos; molho vermelho de
sachê, cobertura escura, carne escura, molho branco), que ficou aberto mais de 4 min 40 s
e não tinha fechado quando a leitura acabou. Do primeiro pão à última caixa: 4 min 30 s.

É a leitura de **um** lote, feita por mim a olho — desenha o algoritmo, não mede acerto.

**Conferido com as fichas do dono (09/10):** os quatro lanches de duas carnes batem com a
ficha do **Número 01** — a leitura, feita sem conhecer o cardápio, tinha anotado três
discos de pão, duas carnes, duas fatias de queijo, alface e molho laranja na tampa: os
cinco ingredientes, com as quantidades. O quinto é o **Mussarela Bug** (o dono disse o nome
e a ficha enquanto eu trabalhava): os seis ingredientes dele também estavam na leitura.
Ficou 6 min 21 s aberto — 3 min 19 s esperando a mussarela empanada sair da fritura.

**Errata de 09/10 — o queijo da caixa.** Relido a 5 quadros por segundo: o lanche da caixa
levou **4 fatias**, não 2 — em cada carne, uma fatia, a carne virada com o pegador por
cima dela, e outra fatia por cima (21:45:04 a 21:45:25). Eu tinha contado pelo quadro
parado, que mostra as de cima. O lote teve 10 fatias, não 8. Se foi queijo em dobro pedido
pelo cliente, está certo; se era um Número 01 comum, sobraram duas — sem o pedido não dá
para dizer. Na rodada 2 do experimento das fichas, 5 das 7 leituras da nuvem tinham dito
"3 fatias à vista, uma a mais que a ficha", e eu contei como erro delas: o gabarito
errado era o meu.

**A conferência com o KDS daquela noite não existe:** a loja ainda roda o Eclética. Eu
tinha escrito que faltava "ler o que o Regem tinha em preparo" — estava errado: o Regem
ainda não está na loja. O pedido só chega ao Farol quando ele entrar (ver abaixo).

### As fichas técnicas — a conferência é por conjunto (do dono, 09/10)

O dono, depois de ler o estudo do lote:

- **A loja-piloto é a Mister Burguer.** O sistema de hoje, com KDS, é o **Eclética**; o
  **Regem está sendo finalizado para entrar lá** e substituí-lo.
- Com o Regem, **o pedido vai ao KDS com a ficha técnica, sem os valores**: o Farol passa a
  ter o pedido e os ingredientes.
- **"A ordem não é importante, e sim todos os ingredientes."**
- Recursos da nuvem para análise: ele providencia o que for preciso.

Cinco fichas (na loja o lanche tem número ou nome):

| ficha | pão | carne | queijo | o resto |
|---|---|---|---|---|
| Número 01 | 3 fatias (pão de dois cortes) | 2 de 56 g | 2 fatias | alface; molho especial (meio rosé) |
| Número 02 | 2 fatias (pão de um corte) | 2 de 56 g | 2 fatias | cebola ao molho shoyu |
| Número 16 | 2 fatias (pão de um corte) | 2 de 56 g | não leva fatia | molho cheddar cremoso; cebola ao molho shoyu |
| Número 08 | 2 fatias (pão prime, de um corte) | 1 de 120 g | 1 fatia de cheddar | ovo; 2 fatias de bacon; 3 anéis de cebola; maionese |
| Mussarela Bug | 2 fatias (pão brioche prime) | 1 artesanal de 150 g | — | mussarela empanada; maionese de alho; geleia de pimenta; cebola crispy |

**O que isso muda no desenho da leitura da bancada:**

1. **A prova 3 é o conjunto da ficha**, com quantidade onde se conta — não uma sequência de
   camadas. Some a exigência de "em que ordem": é o ponto fraco dos modelos, e deixou de
   ser necessário. (Em 10/10 o dono disse a rotina da casa: a ordem volta como **pista**,
   não como exigência — ver "A rotina da casa", mais abaixo.)
2. **Identificar o produto** é achar a ficha cujo conjunto bate com o que entrou na posição.
   A diferença sai **por item** — "falta a alface", "sobra uma fatia de queijo" —, nunca como
   veredito do lanche inteiro (0,95 elevado a 8 dá 0,66: é a regra do juiz binário, que já
   tem a função `perguntas_da_ficha` esperando esta lista).
3. **"Fatias de pão" são os discos:** três fatias = três discos. A ficha já diz quantos
   discos a posição tem de ter.
4. **O que se conta e o que só se vê:** pão, carne (e de qual tamanho), fatia de queijo,
   bacon, anel de cebola e ovo se contam; alface, molhos e cebola são presença.
5. **O dicionário de ingredientes da loja.** Cada ingrediente de ficha ganha a sua linha:
   como aparece de cima (disco fino, disco grosso e escuro, quadrado amarelo, folha verde,
   creme laranja, creme branco, farelo dourado, mancha vermelha…), se conta, e o objeto
   que o traz (cuba, bisnaga, maço, sachê, potinho, pegador). O sistema propõe a partir das
   fichas e do que a bancada mostra; o responsável confirma. O que a câmera não vê (sal,
   tempero) e o que não é da bancada (embalagem) ficam marcados "não conferível".
6. **Os pares que a câmera não separa** saem das fichas: dois produtos cuja diferença é só
   um item não conferível. Entre as cinco há um par difícil — o 02 e o 16 diferem por "duas
   fatias de queijo" contra "molho cheddar cremoso", os dois amarelos. Para esses, só o
   pedido decide.
7. **O empilhamento.** No pão de três fatias cada carne tem o seu disco e o quadro parado
   mostra tudo. No pão de um corte as carnes e os queijos vão empilhados na mesma base
   (carne, queijo, carne, queijo, em 20 s): o quadro do fim mostra uma fatia. Aí a
   contagem sai dos acontecimentos — cada vez que algo é posto naquela posição.
8. **Sem o pedido** (hoje, com o Eclética) as fichas já deixam dizer **qual produto** foi
   montado e contar a produção por produto. O "contra o pedido" — faltou, sobrou, trocou —
   começa quando o Regem entrar na loja.

**Medido em 09/10 — o experimento das fichas** (R$ 1,32 com a rodada do molho; registro em
[teste-das-fichas.md](teste-das-fichas.md)). Com os quadros parados do lote de 08/10 e as
fichas do dono, perguntou-se à nuvem o que entrou em cada posição e que ficha ela é. O
gabarito: quatro Número 01 (o da caixa com queijo a mais — a errata acima; os números já
estão com o gabarito corrigido) e um Mussarela Bug.

| como foi perguntado | modelo | ficha certa | custo |
|---|---|---|---|
| o tampo inteiro de uma vez (cinco lanches), quatro fichas | Haiku 5.5 | 6 de 15 | 0,6 centavo o lote |
| idem | Sonnet 5.5 | 4 de 5 | 20,5 centavos o lote |
| **uma posição por vez**, cinco fichas, com o dicionário de ingredientes — a ficha dita pelo modelo | Haiku 5.5 | 12 de 15 | 0,13 centavo o lanche |
| idem — **a ficha pela conta**: o modelo só diz o que viu, o código compara com as fichas | Haiku 5.5 | **15 de 15** | 0,13 centavo o lanche |
| uma posição por vez, com o dicionário | Sonnet 5.5 | 5 de 5 | 5,85 centavos o lanche |
| **idem, mais o quadro da tampa logo depois do molho e a regra da casa no dicionário** (rodada 3) | Haiku 5.5 | **15 de 15**, dita pelo modelo e pela conta | 0,14 centavo o lanche |

O que ele fixa:

1. **Uma posição por chamada.** Com cinco lanches no mesmo quadro o modelo barato se perde
   (contou seis e sete posições onde havia cinco).
2. **A comparação com a ficha é conta, em código** — por item, com quantidade onde se conta
   e com "não tenho folga" quando duas fichas ficam perto. Nenhuma resposta firme saiu
   errada nas 35 chamadas.
3. **O dicionário de ingredientes vai no pedido.** Sem ele o Mussarela Bug não foi
   reconhecido nenhuma vez pelo modelo barato; com ele, os itens certos subiram de 69% para
   74% — e para 100% com a regra da casa sobre o molho e o quadro certo (rodada 3).
4. **O que fica coberto só se confere no instante em que entra:** o molho embaixo da alface
   passou sem ser visto em 25 de 28 leituras (com o quadro do instante certo e a regra da
   casa: 12 de 12 — ver "O molho", abaixo), e a foto final escondeu a carne. O queijo
   também: na caixa, a fatia de baixo de cada carne só aparece quando entra. E no pão de
   um corte as carnes e os queijos vão empilhados na mesma base (lote anterior): aí a
   contagem sai dos acontecimentos, não do quadro parado.
5. **O caminho barato basta para a rotina:** R$ 0,0013 por lanche. O modelo maior, 45 vezes
   mais caro, fica para a dúvida.

Não é o sistema lendo sozinho: as posições e os quadros foram escolhidos por mim, e é um
lote só. Achar a posição e o instante é o trabalho das ondas 4 e 5.

**A correção do PR #69 foi conferida contra a nuvem** no mesmo roteiro, com o código novo
lido do pacote: a cascata saiu com a ferramenta forçada no modelo barato e a escolha livre
no forte, e o veredito do forte voltou; o pedido de "Analisar as fotos e descrever" voltou
com a descrição e cinco pontos a conferir.

**Local primeiro — a regra do dono (09/10) e a prova.** Lendo o experimento, o dono
perguntou: "ainda não é possível a análise de comparação na loja, sem nuvem? Por que não
deixar a nuvem só quando a confiança de uma análise local não chegar à porcentagem
aceitável?" É a escada de juízes deste plano, dita como regra: **a loja decide o que sabe;
só o "não sei" sobe.** A nuvem, nos testes, foi a régua — não a arquitetura.

Na mesma madrugada rodou um leitor local de teste, sem modelo nenhum (só OpenCV): a mancha
que mudou em cima de um disco, a assinatura dela (cor, textura, tamanho, forma), ensinado
com as manchas de umas posições e testado nas de outra, com 1 a 7 exemplos por ingrediente.

| | resultado |
|---|---|
| Tempo | 7 ms por posição, no processador |
| A quantidade que entrou | certa em 23 de 29 acontecimentos |
| **Firme** (decidiria na loja) | 11 de 34 manchas — **10 certas**; a errada era mancha falsa, não ingrediente |
| **"Não sei"** (subiria à nuvem) | 23 de 34 |
| Ingrediente nunca visto | "não sei" em 5 de 6 |

**Hoje ainda não dá para comparar só na loja** — o leitor local não existe no produto, e o
de teste decide 1 em cada 3. Mas quando decide, acerta, e quando não sabe, diz: é o
comportamento que a regra pede. O que inverte a proporção: **exemplos** (a loja gera
centenas por noite; a nuvem rotula os primeiros — mil custam R$ 1,30 — e o responsável
confere por amostragem), **uma assinatura melhor que "cor média"** (um modelo de
assinatura no PC; o agente já tem o encaixe) e **a mancha limpa** (a sombra de quem se
debruça e a mão geram manchas falsas; discos encostados contam errado). A nuvem fica com
três papéis: **ensinar**, **responder o "não sei"** e **conferir uma amostra** do que a loja
decidiu sozinha. O motivo de ir para a loja não é o custo: é não depender da internet,
responder em milissegundos e a imagem não sair. Registro e roteiro em
[teste-das-fichas.md](teste-das-fichas.md).

**O molho — a regra da casa (do dono, 09/10) e a rodada 3.** Lendo que o molho era o ponto
fraco, o dono disse como a loja monta: **"os molhos são sempre colocados primeiro na tampa
superior do pão, e geralmente usando bisnagas ou potes."** A gravação confirma no lote das
21h42: nas quatro tampas do Número 01 a bisnaga passa em 7 s (21:44:18 a 21:44:25) e o
molho fica à vista de 7 a mais de 20 s, até a alface cobrir; no Mussarela Bug a geleia é a
primeira coisa na tampa. (A maionese, de pote, foi posta sobre a carne nas três vezes em
que apareceu: o dono diz se é o padrão.)

O que a regra muda na leitura: **onde** (só o disco da tampa), **quando** (o primeiro
acontecimento da tampa — o quadro parado logo depois dele, antes do ingrediente seguinte)
e **com o quê** (a bisnaga, o pote ou o sachê que passou por cima: é o que diz *qual*
molho quando a cor não basta).

Rodada 3 do experimento das fichas (R$ 0,29): os mesmos quadros da rodada 2 e mais um por
posição — o da tampa logo depois do molho. Haiku 5.5, 15 leituras por linha:

| o que mudou | molho rosé visto, de 12 | itens certos, de 78 | queijo a mais da caixa apontado |
|---|---|---|---|
| rodada 2 (quadros do fim de cada fase), com o dicionário | 0 | 58 (74%) | 1 de 3 |
| mais o quadro certo, o mesmo dicionário | 8 | 70 (90%) | 1 de 3 |
| mais o quadro certo **e a regra da casa escrita no dicionário** | **12** | **78 (100%)** | **3 de 3** |

0,14 centavo e 1,8 s por lanche. O Sonnet 5.5, com a regra, também acertou tudo (5 de 5
lanches, a 5 centavos cada). **A regra da casa é dado de primeira classe:** vai no
dicionário de ingredientes da loja, como as fichas — onde cada coisa entra, quando, e com
que utensílio. E sem nuvem: o leitor local de teste viu a mancha do molho entrar em 9 de
10 casos (escapou o molho claro sobre a tampa clara), em 7 ms, e a cor separa o rosé, a
geleia e a maionese; inventou mancha em 2 de 11 controles, as duas com um braço no quadro
— é o portão de "as mãos saíram" que falta. São cinco lanches de um lote, com o quadro
escolhido por mim: prova de sinal, não medida de acerto. Registro em
[teste-das-fichas.md](teste-das-fichas.md), "Rodada 3".

**A rotina da casa — a ordem é pista, não regra (do dono, 10/10).** "Os colaboradores têm
manias, cada um diferente do outro, pode ter uma ordem diferente; porém na maioria das
vezes vão usar a mesma rotina: pão, molho, alface, carne, queijo, carne, queijo. Os
produtos que tiverem esses itens na ficha técnica vão ter um padrão de ordem de montagem."
A conferência continua por conjunto — ordem diferente não é erro. A rotina entra como **o
que se espera a seguir**: a leitura pergunta "entrou o que vinha agora?", sabe o que cobre
o quê (a alface cobre o molho; o queijo, a carne) e sabe quando desconfiar de que perdeu
uma etapa — é o que abre a revisão pelo gravador, que então olha o último quadro parado
antes de a cobertura entrar. Vai para o dicionário de ingredientes: para cada um, em que
pão entra e depois de quê. E aprende-se olhando, por produto (não por pessoa), com o pedido
dizendo o que está em preparo.

Nos três lotes lidos do começo ao fim, **a ordem dentro de cada pão não mudou** (na tampa,
molho antes da alface; na base, carne antes do queijo); **o que mudou foi qual lado vem
primeiro** — a tampa em um, as carnes em dois, na mesma noite com três minutos de
diferença. A tabela e o que falta medir estão em `docs/decisoes.md`, 10/10.

**A embalagem diz o destino (do dono, 10/10).** "A caixa é quando o pedido sai para viagem;
quando é embalado só no papel kraft, o pedido é para consumo no local (mesa)." O destino
aparece antes do primeiro ingrediente — a posição nasce como caixa aberta ou como folha —, e
com isso a leitura separa os pedidos de viagem dos de mesa ao casar com o KDS, conta a
produção por destino e acusa embalagem trocada (triagem). E a caixa diz onde está a tampa:
na metade de cima, em todas as lidas — o que dá à revisão pelo gravador o alvo que hoje é
apontado à mão. Detalhe em `docs/decisoes.md`, 10/10.

**O piloto não vira regra do motor (do dono, 10/10).** O Mister Burguer é a cobaia; o Farol
é para distribuir. As regras da casa acima — o molho, a rotina, a embalagem — são **perfil
da loja**, não código: o motor trabalha com posição, item, acontecimento, roteiro esperado
e saldo, e cada loja traz o seu perfil. As três camadas (motor, perfil da loja,
adaptadores) e os degraus pelo que o cliente tem estão em
[controle-de-producao.md](controle-de-producao.md), seção 5.

**O saldo de produção (do dono, 10/10).** Agrupar os pedidos do KDS por produto, subtrair o
que a montagem conclui, somar o que chega, e avisar do especial que demora. É o livro-caixa
do estudo de 07/10, e fica como espinha da onda 5 — com o ajuste de que **a câmera confere
o KDS, não dá baixa nele**. A avaliação, os cinco ajustes e as oito possibilidades de
controle de produção (a começar pela demanda por ingrediente crítico, que não pede câmera)
estão em [controle-de-producao.md](controle-de-producao.md).

**O encaixe no Regem** (lido no código do Regem em 09/10; é tarefa de lá, com plano e PR
próprios):

- O que já existe: o produto aponta a ficha (`produto.ficha_id`); a ficha tem os
  ingredientes com nome, quantidade e unidade (`ficha_ingrediente`), a marca de "só no
  delivery" (embalagem) e a sub-receita (`sub_ficha_id`); o adicional pode apontar ficha
  ou insumo; e a fila de produção — o que alimenta o KDS — é `GET /producao/fila`, com
  descrição, quantidade, complementos em texto e observação de cada item.
- **Mudou em 10/10, por decisão do dono:** a fila **não** precisa levar os ingredientes. O
  Farol **puxa as fichas, os produtos e os adicionais** de cada loja e guarda **base
  própria** de consulta (a mesma base recebe planilha, para a loja sem Regem); se não for
  viável, o Regem repassa de outro jeito. Na base do Farol a linha "só no delivery" fica
  de fora e **a sub-receita entra como um ingrediente só** (o "molho especial" é uma coisa
  na bancada, não cinco insumos).
- Da fila de produção o Farol lê só **qual produto, quantos, com que adicionais e
  observação, para onde vai e a que horas** — e quando ficou pronto. **Entregue pela
  nuvem em 11/10** (a fase 2 do lado do Regem), com até 1 minuto de atraso na loja que
  tem servidor próprio; a conversa pela rede da loja ficou para a fase 3.
- O que o Regem já entrega e o que falta para isso está em
  [controle-de-producao.md](controle-de-producao.md), seção 6. Lá, o plano vem antes do
  código.

### Impacto

| | conta |
|---|---|
| **Processador da loja** | hoje 3% com a loja aberta. Os sinais por quadro medidos na prova: 6 ms por quadro de 1080p, a 15 quadros/s = 9% de um núcleo por bancada — mais a decodificação do fluxo (medida em 07/10: quatro fluxos principais juntos = 10% da máquina) |
| **Rede interna** | um fluxo principal por bancada: 2,1 Mbit/s. Com o cabo a 10 Mbit/s cabem até quatro juntos, no limite (medido em 07/10) — o cabo novo continua sendo pré-requisito para mais de uma bancada |
| **Olhar para trás** | 6 s = 1,6 MB em ≈ 2 s, um pedido por vez ao gravador |
| **Disco da loja** | a sequência guardada de cada julgamento: ≈ 0,3 MB. Com 1.000 por dia e 30 dias: 9 GB; teto e rodízio como nos trechos de vídeo |
| **Nuvem, por sequência** | 6 recortes de 960×540 = 4.200 unidades de imagem. No Haiku 5.5: **≈ US$ 0,0006, ou R$ 0,003** (dólar a R$ 5,40, o do agente). Mil por dia: ≈ R$ 3 |
| **Na dúvida, o modelo maior** | Sonnet 5.5: ≈ R$ 0,06 por sequência — só no que for crítico, ou a conta dobra |
| **Hoje, para comparar** | R$ 0,013 por análise de **um** quadro (Haiku 4.5), com 93% sem resposta |
| **Treino do classificador da loja** | segundos no processador, fora do horário |

Conta minha sobre a tabela oficial de preços; o acerto do Haiku 5.5 nesta tarefa **não
foi medido** — é o primeiro uso do banco de provas.

### O disco do gravador e a máquina da loja — respostas ao dono (09/10)

**O disco.** O dono vai trocar o do gravador e perguntou: SSD de 1 TB ou HD SATA de 3 TB —
o HD perde muito na busca das imagens? **Não perde nada que se note, e é a escolha certa.**

| | SSD de 1 TB | HD de 3 TB |
|---|---|---|
| Quanto guarda (14 câmeras, como estão: 14,2 GB por hora, medido) | ≈ 2,7 dias | ≈ 8 dias |
| Buscar e baixar um trecho | igual | igual: quem limita é o gravador, que entrega a gravação perto da velocidade em que ela foi feita (10 s de vídeo em 6 a 12 s, medido), e a rede |
| Gravar | sobra | sobra: são 4 MB por segundo |
| O que o fabricante diz | fora da lista: a Intelbras só lista SSD (de 512 GB) para outros modelos | na lista: "a Intelbras recomenda o uso de disco rígido WD Purple", e o de 3 TB consta |
| Desgaste | regrava ≈ 124 TB por ano, sem parar | feito para isso |

O que importa aqui é quantos dias a gravação fica: "buscar o trecho" (A18) e o estudo dos
processos precisam do ocorrido de ontem e de anteontem — a releitura do queijo da caixa só
foi possível porque a gravação, de 15 h, ainda existia. O gravador aceita **um** HD SATA de
**até 24 TB** (lista de capacidade da Intelbras, de 09/2025; a base do Farol dizia 10 e foi
corrigida). Instala-se com o gravador desligado e **formata-se pelo gravador** (*Menu
principal › Armazenamento › Gerenciar HD › Formatar*); o disco antigo não se lê em
computador. Não foi medido com HD: a conta é da velocidade do gravador, não do disco.

**A máquina mínima.** O dono pediu a configuração mínima que faria o que o servidor de hoje
faz. Medido em 09/10 às 2h40, e pela telemetria do agente (de 08/10, 23h, a 09/10, 2h):

| | o Farol | a máquina inteira |
|---|---|---|
| Processador (i7-10700F, 16 núcleos lógicos) | 1,6% (pico 2,4%) — um quarto de um núcleo | 3% (pico 10%) |
| Memória (16 GB) | 0,3 a 0,5 GB em uso (1,2 GB reservados) | 7,9 GB em uso |
| Placa de vídeo (RX 560) | o detector | 3% |
| Disco (223 GB) | 1 GB | 161 GB ocupados |

**O Farol é o menor inquilino dessa máquina.** São 274 processos: o navegador (12
processos, 1,7 GB), um aplicativo de IA de mesa, o antivírus, um programa de câmeras e um
sistema de restaurante instalados como serviço (cada um com o seu banco de dados), dois
programas de acesso remoto, componentes de internet banking — e **o servidor local do
Regem da loja** (API, tela, impressão, sincronismo e banco: 0,4 GB de memória, parado, e
1,9 GB de disco). O dono confirmou: a máquina está cheia de instalações, e o ideal é
formatar.

| peça | mínimo para o Farol de hoje, numa máquina limpa | por quê |
|---|---|---|
| Processador | 4 núcleos atuais com vídeo integrado — a classe do Intel N100 ou N150 | em teste sintético (número de agregador, não medido por nós) um núcleo do N100 rende ≈ 65% de um do i7-10700F: o quarto de núcleo do Farol viraria ≈ 10% do N100 |
| Memória | 8 GB; **16 GB se o servidor do Regem ficar na mesma máquina** | o Windows costuma ocupar 3 a 4 GB; o Farol, 0,3 a 1,2 GB; o Regem parado, 0,4 GB (com a loja vendendo, não medido) |
| Disco | SSD de 240 GB | o Farol ocupa 1 GB e o Regem local 1,9 GB; a sequência guardada da leitura da bancada, ≈ 9 GB por mês |
| Placa de vídeo | nenhuma | o detector leva 113 ms no processador do i7 e 88 ms na placa: ela quase não ajuda; são 5 julgamentos por minuto |
| Rede | uma porta de cabo para o gravador e Wi-Fi (ou segunda porta) para a internet | são duas redes |
| Sistema | Windows 10 ou 11, 64 bits | é onde o agente roda |

Na base do Farol, um mini PC N150 com 16 GB e SSD de 500 GB aparece de R$ 2.087 a R$ 2.673
(busca de 07/10). Duas ressalvas. **É conta de escala, não medida:** nenhum mini PC foi
testado — antes de indicar para várias lojas, testa-se um. E **é o mínimo para hoje, não
para o plano:** a leitura da bancada lê o fluxo principal o tempo todo (medido no i7: 9% de
um núcleo por bancada, mais a decodificação — quatro fluxos principais são 10% da máquina)
e o leitor local vai rodar um modelo de assinatura de imagem. Para isso a referência
continua a montagem da base (i5 de mesa com vídeo integrado), a dimensionar quando o
leitor local for medido.

**Formatar a máquina da loja pede roteiro:** apaga o agente (o token dele é preso à
instalação por um arquivo ao lado da configuração: sem esse arquivo guardado, só com
token novo emitido no console), a fila local, as senhas guardadas nas variáveis do
Windows, o acesso remoto, a rota até o gravador e o banco local do Regem.

### A ordem, revista (substitui a do A18)

**Aprovada pelo dono em 09/10/2026** — "tudo aprovado e revisado", depois de ler as
respostas daquela madrugada. Lido como o "está tudo aprovado" do A18: a ordem como está e
as opções recomendadas (os cinco primeiros processos sugeridos; a nuvem rotula os primeiros
exemplos do leitor local quando a onda 5 chegar; meta de partida de 9 em cada 10 decididos
na loja, errando no máximo 1 em 50; um critério só passa a avisar com no máximo 1 alarme
falso em 10 avisos). No Regem, a fila de produção com os ingredientes fica aprovada para
planejar: lá o plano é apresentado antes do código, como manda a regra daquele projeto. Se
ele corrigir alguma dessas leituras, vale a correção.

| onda | o quê | tamanho | depende de |
|---|---|---|---|
| 0 ✅ | Confiança em %; cliente do gravador | P | — |
| 1 ✅ | **Quadros, estudo condicional e contexto:** imagem completa × quadros com papel; a ficha de cada critério (contexto, gatilho, janela, ação, desfecho) e o funil em números; **a anatomia do pedido à nuvem** (a cena, o mapa do canal, o recorte na resolução da câmera, a resposta na forma da família — o recorte nunca sobe sozinho); Haiku 5.5 (medido); no quadro de bancada, o quadro de "as mãos saíram" no lugar do borrão de rosto; os quatro estados do critério | G | protótipo aprovado |
| 2 | **Sequência e banco de provas:** olhar para trás (na dúvida, **a busca pelo meio** no gravador, por blocos — de 2 s no gravador do piloto, e uns 3 minutos depois do fato, quando a gravação assentou), grade de 6 quadros, a família Acontecimento; "acertou / errou"; o acerto medido de cada critério. **Em andamento:** as fatias 2.1 e 2.2a (o agente pedir ao gravador o que já foi gravado, medir o que ele entrega e conferir o que voltou) feitas em 10/10, e a 2.2b (a busca pelo meio e a grade, no agente) em 11/10 | G | o dono marcar os exemplos |
| 3 | **Processo e Medida:** etapas por quadro, cronômetros e contadores, episódios, modelos prontos | G | onda 2 medida |
| 4 | **Leitura da bancada, E0 → E1:** câmera regulada, números da semana, as fases do lote, contar montagens pelo fechamento, a comanda | G | a câmera do canal 4 foi regulada em 09/10 e o dono redesenhou o quadro da bancada na mesma noite (conferido contra a gravação); falta ele escrever a cena do canal |
| 5 | **Leitura da bancada, E2 → E3:** **o leitor local de ingredientes** (ensinado pela nuvem; só o "não sei" sobe, uma posição por chamada), o dicionário de ingredientes (com as regras e a rotina da casa), a ficha comparada em código, o produto, **a conta do lote contra o KDS**, aviso na estação; o modo do KDS "por produto, com baixa automática" (opção da loja, desligada de fábrica — 10/10) | G+ | as fichas e os produtos puxados do Regem para a base do Farol (decisão de 10/10); os pedidos do KDS lidos na loja; alarme falso medido |
| 6 | O momento em vídeo ("Ver o momento") — reaproveita a sequência da onda 2 | M | onde guardar na nuvem |
| 7 | Relatórios, resumos e o início "fora do critério primeiro" | G | transportador |
| 8 | Porte da cara nova | G | protótipo geral aprovado |
| 9 | O ambiente que calcula; forma livre; rascunho — com a 10, **a planta viva** (10/10): o ambiente em 3D, com as câmeras e as pessoas | G+M+M | a planta da loja desenhada; protótipo aprovado |
| 10 | A pessoa na planta; busca investigativa | G+G | ondas 2 e 9; disco maior; o dono dizer de onde vem a identidade |

O **protótipo** anda junto desde a onda 1 e já nasce na cara nova: a tela do canal com
quadros e critérios, o cadastro do processo, a sequência com a resposta por etapa, o
"acertou / errou", a bancada lida ao vivo.

**Nenhuma onda liga aviso sem passar pelo banco de provas.**

### As duas listas — o que falta (10/10/2026)

Pedido do dono: "atualize nosso roadmap: um com suas pendências e outro com as minhas". É o
retrato de 10/10; a ordem das ondas continua a da tabela acima. O que cada item de controle
de produção é, e por que, está em [controle-de-producao.md](controle-de-producao.md).

**Vale para as duas listas** (dono, 10/10): o Mister Burguer é o piloto, e o Farol é produto
para distribuir. Nada do que se aprende lá vira regra do motor: regra da casa é perfil da
loja; o que o gravador entrega é medido na instalação.

#### A lista do Farol — o que falta eu fazer

| # | o quê | onde entra | depende de |
|---|---|---|---|
| 1 ✅ | **Fechar a onda 1:** o sistema propor o estudo do critério — **feito em 10/10**, por regras, no servidor, que era o caminho recomendado (se o dono preferir outro, o botão é o mesmo: troca-se quem responde) | onda 1, fatia 1.3 | — |
| 2 ✅ | Três acertos pequenos de tela — **feitos em 11/10** (PR #105): a tabela passou a decidir pelo próprio espaço (vira cartões quando não cabe; vale para Painel, Análises e Alertas — a do Painel rolava de lado de 768 a 1.280 px); o cartão "Critérios ligados" diz quantos só observam; e "área" → "quadro" na única frase de tela em que sobrava | onda 1 | — |
| 3 | **A base de fichas e produtos do Farol** (decisão de 10/10): puxar do Regem as fichas, os produtos e os adicionais de cada loja e guardar base própria; aceitar também planilha, para a loja sem Regem; por cima dela, o dicionário de ingredientes e as regras da casa. **O plano e o protótipo das duas telas foram aprovados pelo dono em 11/10** ("O lado do Farol que usa o Regem — o plano, aprovado"); a fatia 1 (conectar e ligar as lojas) foi entregue em 11/10 (PR #101); a fatia 2 (ler e guardar as fichas; a tela Fichas) também, no mesmo dia (PR #102); a fatia 3 (a cópia chega ao computador da loja) também (PR #103); falta trocar o pacote do agente na loja, com o "pode" do dono; as fatias 4 e 5 ficam para depois | nova; antes da onda 5 | o Regem com as fichas da loja |
| 4 | **O plano no projeto Regem — aprovado pelo dono em 10/10** (a página "Porta do Farol no Regem"; o resumo e as respostas dele estão em "O lado do Regem — o plano, aprovado"): três fases — o catálogo e as fichas, a fila de produção só para leitura, e o modo do KDS "por produto, com baixa automática". **As fases 1 e 2 estão no ar desde 11/10** ("A fase 1, entregue" e "A fase 2, entregue"); **a 3 fica para a onda 5, com o aviso pela rede da loja** | projeto Regem — plano antes do código | o lado do Farol que consome (item 3); o segredo do aplicativo, que é do dono, só quando esse lado existir |
| 5 | **Onda 2 — sequência e banco de provas:** o agente buscar no gravador (cliente de arquivo, medindo o que cada gravador entrega), a busca pelo meio, a grade de 6 quadros, a família Acontecimento passando a julgar, "acertou / errou", o acerto medido de cada critério. **O plano está em "Onda 2 — como ela entra"** (10/10): oito fatias; **a 2.1 (o cliente de arquivo do gravador) e a 2.2a (medir o gravador e ler o trecho) estão feitas, em 10/10**; a 2.2b (a busca pelo meio e a grade) também, em 11/10 (PR #104) — as três só do agente e dormindo; a 2.3 espera a decisão 1 do dono | onda 2 | o protótipo das telas aprovado; as três decisões do plano; o dono marcar os exemplos |
| 6 | **Onda 3 — processo e medida:** etapas por quadro, cronômetros, contadores, episódios | onda 3 | a onda 2 medida |
| 7 | **Onda 4 — a bancada, primeira parte:** achar sozinho as posições e o tipo de base; contar o que fecha, por tipo de base; as fases do lote; os números da semana | onda 4 | a cena do canal |
| 8 | **Onda 5 — a bancada, segunda parte:** o leitor de ingredientes; o roteiro esperado (ficha + rotina); o produto; **o saldo de produção, com os dois números**; os especiais, um a um; o aviso na estação | onda 5 | os itens 3 e 4; o Regem na loja; a outra frente da ilha com câmera, para a conta fechar |
| 9 | **Controle de produção sem câmera:** a demanda por ingrediente crítico (carnes por tipo), a partir dos pedidos e das fichas | novo; candidato a entrar cedo | os itens 3 e 4; o dono dizer onde quer ver |
| 10 | **O perfil da loja:** o cadastro em que o sistema propõe e o responsável confirma — bases de montagem, dicionário, regras da casa, filas e bancadas —, para outra loja entrar sem engenheiro | atravessa as ondas 4 e 5 | protótipo aprovado |
| 11 | **A planta viva** (as ondas 9 e 10 juntas, com a régua de acabamento mais alta): **o estudo está escrito** ([estudo-planta-viva.md](estudo-planta-viva.md), 10/10) — o que dá para fazer em cada parte, com que erro, e em quatro degraus; faltam a prova de medida no piloto e o protótipo em alta qualidade, para aprovar | ondas 9 e 10; o protótipo pode andar antes | o dono dizer onde ela entra na ordem e de onde vem a identidade; a planta da loja desenhada; para a prova, os pontos marcados no piso |
| 12 | Ondas 6 a 8: o momento em vídeo; relatórios e resumos; o porte da cara nova | ondas 6 a 8 | as de cada linha da tabela das ondas |
| 13 | Medidas que ficaram devendo: o gravador depois do cabo novo; **o atraso da gravação recente depois do disco novo, e "tocar a gravação" nos segundos recentes** (10/10); o juiz local do molho sobre o quadro que a busca escolhe; a loja reconhecer a base e achar a tampa; a rotina por produto, numa semana observando | — | o cabo; o disco; as fichas |

#### A lista do dono

| # | o quê | para quê | quando |
|---|---|---|---|
| 1 | **O Regem rodando na loja**, com as fichas dos lanches e os adicionais cadastrados | é de onde o Farol puxa fichas, produtos e pedidos; daí vem também a rotina dos outros itens | os testes estão para começar |
| 2 | ✅ **O plano do lado do Regem foi aprovado em 10/10** (as seis decisões respondidas). A fase 1 entrou no ar em 11/10. **Fica da parte dele, quando o lado do Farol que consome estiver pronto** (antes disso não há o que fazer: sem o segredo a página responde "ainda não disponível"): criar o segredo do aplicativo Farol e colá-lo nos dois painéis (o passo a passo vai na hora; o valor não passa por mim) e autorizar o Farol na página, como presidente | os itens 3, 4, 8 e 9 da outra lista | quando eu avisar |
| 3 | **A cena do canal "montagem 1"** — console → Canais → montagem 1 → "A cena deste canal" → "Salvar a cena" | o pedido com contexto e a leitura da bancada | quando puder |
| 4 | **Na loja, na semana de 12/10:** o HD no gravador; o cabo, e avisar "cabo trocado, pode"; as fotos padrão; o reflexo da luminária; a folha A4 por um minuto; **e, se topar, a prova da planta viva** — 15 a 20 pontos marcados no piso com fita e medidos com trena, e uma pessoa parando uns 10 segundos em cada um (uns 20 minutos, antes de abrir; o passo a passo está em [estudo-planta-viva.md](estudo-planta-viva.md), seção 8) | guardar mais dias de gravação; a rede; a comparação com a foto; a medida da câmera; saber quanto erra a posição de uma pessoa na planta, nesta loja | na visita |
| 5 | **A câmera da outra frente da ilha** (a da chapa) | sem ela o saldo não fecha: parte da produção fica fora da conta | depois de o algoritmo estar alinhado no canal 4, como o dono definiu |
| 6 | **Aprovar o protótipo das telas da onda 2**, responder às **três decisões do plano dela** (a imagem do exemplo na nuvem; a meta para "valendo"; quem marca) e, depois, **marcar os exemplos** "acertou / errou" | é o que deixa um critério novo chegar a avisar | quando for apresentado |
| 7 | **Crédito da nuvem** | a chave tem R$ 0,40 dos R$ 5,00; o valor é dito antes da próxima rodada paga | antes de a onda 2 medir |
| 8 | Respostas que ajudam, sem travar: as perguntas da página do plano (a caixinha de papelão, a caneta nas embalagens, a bisnaga marcada por cor, o horário dos critérios de presença, o "voltar a valer", quem aparece na imagem) | afinar | quando puder |
| 9 | **Desenhar a planta da loja** — console → Canais → Planta → "Desenhar a planta" (uns dez minutos, sem medida exata) | é a base da planta viva e do cálculo de cada câmera; hoje a loja não tem planta | quando puder |
| 10 | **Duas decisões da planta viva:** de onde vem a identidade de cada colaborador (o ponto e a escala do Regem, um sinal no uniforme, ou o rosto) e onde ela entra na ordem das ondas | molda o desenho; hoje são as ondas 9 e 10 | antes do protótipo |
| 11 | **Ligar a chave do pedido com contexto** | só quando houver critério de estado que suba à nuvem; o passo a passo é preparado antes | mais adiante |
| 12 | **A data para formatar o computador da loja** | a máquina é também o servidor do Regem: pede roteiro | quando decidir |

Saíram da lista do dono em 10/10: a imagem dos dois lados da ilha (ele já tinha mandado em
09/10, e mandou de novo; a ilha tem duas frentes, e o canal 4 vê a da fritadeira); a rotina
dos outros itens (vem com as fichas); "em lote ou lanche por lanche" (não há regra: a lista
do KDS nem sempre é seguida); o queijo em dobro (só como adicional); os ingredientes na fila
de produção do Regem (não precisa: o Farol puxa as fichas).

### Onda 1 — como ela entra (09/10/2026)

Levantamento do código feito antes de começar. Três coisas dele mudam o jeito de entrar:

- **O agente antigo recusa a configuração inteira** se receber um valor novo em campo que
  ele conhece (tipo, resolução, horário). Tudo o que a onda 1 acrescenta desce em **campo
  novo**, e o que muda comportamento só desce para o agente que disser que sabe lidar com
  aquilo. Sem isso, um critério "em ensaio" viraria aviso numa loja com o agente antigo.
- **Os testes comparam o pedido à nuvem letra por letra.** O pedido de hoje fica como está;
  o pedido com contexto é um caminho ao lado, ligado por loja.
- **O funil já tem quase todos os números:** olhadas, "nada a conferir", julgadas na loja e
  na nuvem e fora do critério já são contados por hora, por critério e por quadro. Falta
  contar a olhada que só observa.

| fatia | o que entra | tela? | nasce |
|---|---|---|---|
| **1.0 · protótipo** | as telas da onda — o canal com a imagem completa, os quadros e os critérios; a cena; o estudo do critério, o funil e os estados — em `mockups/farol-console-novo.html`, na cara nova. Revisto em 09/10 com os dois recados do dono (abaixo) | é o protótipo | **aprovado pelo dono em 09/10** (versão 3) |
| **1.1 · o pedido com contexto** ✅ (09/10, migration 030) | a loja ganha "tipo de negócio"; o canal, a cena; o quadro, o papel e a ordem. O agente monta o pedido na anatomia do plano — cena, mapa do canal, recorte na resolução da câmera, pergunta — com o que é fixo em cache, no Haiku 5.5. Sem cena escrita o pedido não sai: a olhada conta como "sem juiz", com o motivo | não | desligado; a chave é **interna**, por loja (da distribuição): não é opção de tela |
| **1.2 · os quatro estados** ✅ (09/10, migration 031) | observando · em ensaio · medido · valendo. Só "valendo" avisa; "observando" conta sem julgar. Critério que já avisa hoje continua valendo | não | os de hoje ficam como estão |
| **1.3 · o estudo do critério e o funil** ✅ (09/10, migration 032: o motor e os números; 10/10: a proposta do sistema, por regras, sem migration) | as seis partes (contexto, gatilho, janela, ação, desfecho, fora de contexto), com cada condição ligada a um sinal da loja; a proposta do sistema — que saiu **por regras, no servidor**, e não pedida ao agente como a descrição de um equipamento (decisão de 10/10); o funil servido em números | não | sem estudo, o critério segue com o "quando vale a pena conferir" de hoje |
| **1.4 · o quadro de bancada** ✅ (09/10, sem migration; **uma parte mudou:** quem aparece não é apagado — a imagem com alguém à vista sai como hoje, com o borrão) | em quadro com papel "posição de montagem": sobe o quadro de quando as mãos saem, sem o borrão de rosto; quem aparecer é apagado | não | só onde o papel for esse — e o campo do papel só chega ao console na fatia 1.5 |
| **1.5 · as telas** ✅ (09/10: a parte da nuvem — o que o agente declara saber, migration 033; a tela do canal e a migração das áreas, migration 034; a gaveta nova do critério — famílias, estudo, funil e estados —, migration 035; **o "ir para" (Ctrl K)**. A proposta do estudo é da fatia 1.3) | o porte do protótipo aprovado para o console; a migração das áreas redesenhadas (a principal que não é o canal inteiro vira um quadro, e o canal ganha a imagem completa de volta); as contagens "em N canais (M quadros)" | sim | o protótipo foi aprovado em 09/10 |

**De onde sai cada número do funil que o protótipo mostra** (para não desenhar o que não
existe):

| no protótipo | de onde sai | existe hoje? |
|---|---|---|
| olhadas | `resumo_hora.capturas` | sim |
| com contexto | `capturas` menos `sem_condicao` (a olhada que o "quando vale a pena conferir" segurou) | sim |
| com gatilho | `resumo_hora.sem_gatilho` (o contexto valia e nada abriu a análise): com gatilho = com contexto menos ele | sim (fatia 1.3) |
| julgadas, e quantas na nuvem | `conformes` + `nao_conformes` + `nao_avaliaveis`; `julgadas_nuvem` | sim |
| fora do critério | `nao_conformes` | sim |
| custo de nuvem por dia | `custo_centavos` | sim |
| "ainda não julga" (observando) | `resumo_hora.observadas`: a olhada que passou pelo contexto e só foi contada | sim (fatia 1.2) |
| "quanto custaria ligado" | gatilhos por dia × o preço medido do pedido. É o **teto** — se toda análise precisasse da nuvem: antes de ligar não se sabe quantas a loja resolve sozinha | sim (fatia 1.3): `GET /v1/regras/:id/funil`; sem preço medido, não há teto |

Cada fatia é um PR com teste; a que tem migration é mesclada sozinha e por último. Nada
liga sozinho na loja: o pedido com contexto é uma chave **interna** por loja — fica na
distribuição, como o modo de julgamento, e não aparece no console da loja; quem liga é o
dono. O agente da loja só recebe cada fatia quando o pacote for trocado — com o "pode"
dele, como da outra vez.

**O que o dono corrigiu no protótipo (09/10, 5h20).** Dois recados, os dois já no
protótipo (versão 3) e valendo para o motor:

1. **A cena é escrita por quem usa, com detalhes.** "O que esta câmera vê e de onde
   olha: o usuário preenche com detalhes." Saiu o "Propor a partir da imagem" e, com
   ele, o estado "proposta pelo sistema": a cena está em branco ou descrita. O campo
   ganhou a orientação do que vale escrever — que posto é e o que se faz nele; de onde a
   câmera olha; o que aparece sempre, e em que parte da imagem; o que engana (brilho,
   reflexo, vapor). **Para depois:** um botão só para aprimorar o texto, "de forma que
   fique mais eficaz" — de graça, se houver como. O que se sabe hoje: de graça, só a
   conferência por regra (dizer o que falta no texto, sem reescrever); reescrever com um
   modelo de nuvem, só texto, sai por cerca de um décimo de centavo por clique no Haiku
   5.5 (conta sobre a tabela — uns 500 tokens de entrada e 250 de saída —, não medida);
   modelo de texto rodando na loja não foi medido, e a máquina de hoje não tem um
   instalado. Escolhe-se quando o botão entrar.
2. **O que sobe para a nuvem é lógica interna.** "Não é necessário o usuário escolher ou
   informar critério que sobe; nossa prioridade é o máximo de análises no servidor, e
   quando não tiver a margem de confiança boa, sobe à nuvem." Saiu da tela o cartão "O
   que sobe para a nuvem"; o estudo do critério deixou de marcar "na loja" e "na nuvem"
   em cada parte (ficam o sinal que a loja usa e a marca "a câmera não vê"); a tela do
   canal não fala mais em nuvem nem em cache. O que continua à vista é **resultado**:
   no funil, quantas análises precisaram da nuvem e quanto custaram. **No motor:** a
   anatomia do pedido (cena, mapa, recorte, pergunta) continua sendo como o Farol
   pergunta quando precisa perguntar — só não é assunto de tela. E a ordem "o servidor
   da loja primeiro; a nuvem só quando a confiança dele não for boa" passa a ser a regra
   de todo critério, não só da leitura da bancada. Hoje a loja decide sozinha presença,
   contagem e "igual à foto padrão"; o que mais ela vai decidir entra pelas ondas (o
   estudo condicional na fatia 1.3, a leitura da bancada nas ondas 4 e 5), cada passo
   medido antes de valer.

A proposta do **estudo do critério** (as seis partes) continua como no plano: o recado
foi sobre a cena. Se o dono quiser o mesmo lá — ele escreve, o sistema não propõe —,
muda-se antes da fatia 1.3.

**A fatia 1.1, entregue em 09/10** (o registro inteiro está em
[decisoes.md](decisoes.md), "O pedido com contexto"):

- **o que entrou:** a migration 030 (tipo de negócio, cena, papel, ordem e a chave); as
  rotas que guardam isso; o número do quadro calculado num lugar só; o caminho novo do
  pedido no agente — cena, mapa do canal, recorte na resolução da câmera, critério —, com
  o que é fixo em cache, no Haiku 5.5; o mapa do canal (esquema primeiro, fotografia só
  com o lugar vazio); a trava "sem cena, o recorte não sai";
- **a chave nasce desligada e é interna:** liga-se de dentro do serviço, com
  `npm run provisionar -- contexto <lojaId> ligar`, que recusa — dizendo quais — enquanto
  houver canal sem cena com critério que depende dela;
- **conferido contra a API de verdade** (5 centavos, imagens geradas por computador): os
  dois modelos aceitam a forma do pedido; o trecho fixo voltou do cache (2.250 de 3.155
  unidades de entrada); um critério de quadro saiu por **0,10 centavo**, contra 1,2
  centavo da análise de hoje;
- **o que ainda não dá para usar na loja:** o campo da cena ainda não está no console — a
  tela é a fatia 1.5, depois do protótipo aprovado. Até lá a chave fica desligada, e nada
  muda — **o campo da cena entrou em 09/10** (a tela do canal, abaixo); a chave continua
  desligada até as cenas estarem escritas;
- **achado no caminho:** as imagens julgadas nunca eram apagadas do disco da loja
  (ERR-062, PR #77): a auditoria passou a limpar, com guarda de 15 dias.

**A fatia 1.2, entregue em 09/10** ([decisoes.md](decisoes.md), "O estado do critério"):

- **o que entrou:** `regra.estado` (migration 031) e o que o agente faz em cada um —
  observando conta a olhada e para, sem julgar e sem gastar; em ensaio e medido julgam e
  nunca avisam; valendo é como sempre foi. O contador novo do resumo por hora
  (`observadas`) é o "ainda não julga" do funil;
- **os de hoje ficam como estão:** todo critério que existia está valendo, e o cadastro de
  hoje cria como sempre criou;
- **quem escolhe:** uma pessoa leva a observando e a em ensaio; a medido e a valendo só se
  chega com o acerto medido (onda 2). Critério que desce de valendo não volta à mão;
- **só valendo avisa, nos dois lados:** o agente não manda, e o servidor não avisa do que
  chegar mesmo assim (o evento fica guardado);
- **o agente antigo** só recebe o que está valendo: o resto só desce para quem declara que
  sabe (`?sabe=estados`);
- **ficou para o banco de provas:** o "volta a em ensaio se o texto, o quadro ou o modelo
  mudar" — sem ter como medir de novo, a regra faria um critério parar de avisar para sempre;
- **em aberto para a fatia 1.5:** a tela nova só pode oferecer "descer de valendo" quando
  houver o caminho de volta.

**A fatia 1.3, primeira parte, entregue em 09/10** ([decisoes.md](decisoes.md), "O estudo do
critério: o contexto, o gatilho e o funil"):

- **o que entrou:** os sinais que a loja lê sozinha (pessoa, movimento, foto padrão), cada um
  num lugar do canal — o quadro do critério, a imagem completa ou outro quadro; o estudo na
  forma que o agente confere (o contexto, em que tudo vale; o gatilho, em que basta um); a
  ficha guardada na nuvem (migration 032) e o funil servido em números, com "quanto custaria
  ligado" sobre preço medido;
- **com estudo, o porteiro não é consultado;** sem estudo, tudo segue como sempre. Só o estudo
  confirmado desce, e só para o agente que declara saber (`?sabe=estudo`);
- **achado no caminho (ERR-064):** o agente só puxava a configuração quando a versão mudava —
  trocado o pacote, o que a nuvem escondia do agente antigo nunca chegaria ao novo. Agora ele
  puxa de novo quando passa a saber mais;
- **o que falta nesta fatia:** a proposta do sistema para a ficha — espera o dono dizer se o
  estudo é proposto pelo sistema ou escrito por quem usa, como a cena;
- **para a fatia 1.5:** a nuvem guardar o que o agente da loja sabe, para a tela dizer se o
  estudo já vale lá — **entrou em 09/10** (abaixo).

**A fatia 1.4, entregue em 09/10** ([decisoes.md](decisoes.md), "O quadro de bancada: a
imagem espera as mãos saírem"):

- **o que entrou:** em quadro com o papel "posição de montagem", a imagem do critério só sai
  com o quadro **quieto há um segundo e meio** — medido de meio em meio segundo no fluxo
  menor, que já fica aberto. Com mão na frente a olhada é "nada a conferir" e é **refeita
  quando o quadro para** (até duas tentativas por canal a cada volta de rotina). E a imagem
  do quadro quieto em que o detector **não vê ninguém** vai **sem o borrão de rosto**. Sem
  medida (fluxo menor parado), a olhada segue como sempre, com o borrão;
- **vem antes do estudo:** a olhada que as mãos seguraram não gasta o gatilho;
- **uma parte do plano mudou — "quem aparecer é apagado" não entrou.** O detector da loja dá
  caixas, não contorno, e de cima vê mal quem está ali; apagar pela caixa cobriria o tampo.
  No lugar, a imagem com alguém à vista sai **como sempre saiu, com o borrão** (e também
  quando não há detector, ou ele falha). Apagar pelo contorno pede um modelo que a loja não
  tem e ninguém mediu;
- **medido na loja** (gravação de 08/10, canal 4, dez minutos, loja aberta): o tampo fica
  quieto em 67% dos instantes; a classe do agente deu a mesma resposta da série medida em
  1.125 de 1.125; **com o quadro quieto o detector não viu ninguém em nenhum dos 751
  instantes** (nem um "talvez"); conferido a olho, nos 12 instantes em que o tampo parou não
  havia mão nem braço. Pela conta sobre a série, a imagem sai já na rotina em 7 de cada 10
  voltas, e em 9 de cada 10 com as duas tentativas;
- **achado no caminho, antes de mesclar:** o laço acordando de segundo em segundo para a
  bancada chamaria o vigia dez vezes mais. O vigia ganhou o passo dele;
- **o que a regra não cobre:** a mão que entra no meio segundo entre a última medida e a
  foto (3 em cada 100 instantes quietos, na série); e a **câmera que mostra rosto** — a regra
  foi pensada para a câmera de cima, e num quadro de câmera lateral a imagem sem o borrão
  depende só de o detector não ter visto ninguém;
- **para a fatia 1.5:** a tela em que se escolhe o papel tem de dizer o que ele muda (a
  imagem espera o quadro parar, e sai sem o borrão quando não há ninguém à vista) —
  **entrou em 09/10**, na gaveta do quadro; e, se o funil for separar "havia mão na
  frente" do resto do "nada a conferir", é contador novo;
- **ainda não dá para usar na loja:** nenhum quadro tem o papel, e o campo do papel só chega
  ao console na fatia 1.5 (**chegou em 09/10**, na gaveta do quadro; na loja ainda ninguém
  marcou). Não foi medido com o fluxo menor de verdade e a loja aberta — o gravador não
  guarda esse fluxo.

**Da fatia 1.5, a parte que não depende de tela, entregue em 09/10** ([decisoes.md](decisoes.md),
"A nuvem guarda o que o agente da loja declara saber"; migration 033):

- **o que entrou:** a nuvem guarda, por agente, o que ele declarou saber ao pedir a
  configuração pela última vez, e quando (`agente.sabe`, `agente.sabe_em`); a rota da loja
  que o console já usa devolve os dois. O agente passa a declarar também `bancada`;
- **por que agora:** conferido na loja, a versão que o agente informa é um texto fixo
  ("0.1.0-loja") e não muda com o pacote — sem isto, a nuvem não sabe qual pacote está lá. É
  também como se confere a troca do pacote, de fora;
- **regra para o roteiro da troca:** em toda **volta** de pacote, apagar a configuração
  guardada na loja antes de subir o agente antigo. O agente só pede de novo quando passa a
  saber mais; voltando ao pacote de hoje com a configuração do novo em disco, um critério em
  observação seria julgado (e pago) — ninguém seria avisado, mas gastaria;
- **o que falta:** a tela que usa isso.

**A fatia 1.5, a tela do canal, entregue em 09/10** ([decisoes.md](decisoes.md), "A imagem
completa de volta: o canal, os quadros e a tela do canal"; migration 034):

- **o que entrou:** a imagem completa passa a ser fixa — uma por canal, sempre o canal
  inteiro, com a regra no banco —, e o que se marca dentro dela são os quadros, com número
  e papel. A migration levou as áreas de antes para esse modelo sem mudar o que é
  analisado (na loja, dois canais tinham a principal redesenhada: ela virou "Quadro 1", e
  o canal ganhou a imagem completa). A tela nova do canal: a imagem com os quadros
  numerados, a árvore "onde cada critério vale", a cena do canal com o tipo de negócio e a
  gaveta do quadro (nome, papel, contorno, exclusão);
- **a tela só afirma o que é verdade:** "falta descrever a cena" e "olhando agora" aparecem
  só quando são fato — quem diz se a cena está fazendo falta é o servidor, e a chave
  interna continua fora do console; a gaveta do quadro diz o que o papel "posição de
  montagem" muda e se o computador da loja já tem a regra;
- **achado no caminho:** o canal criado junto com a loja, pela distribuição, nascia sem
  área nenhuma. Passou a nascer com a imagem completa, e os que existiam ganharam a deles;
- **onde diverge do protótipo:** dez pontos, listados na decisão — os principais: não há a
  barra de cima com o "ir para"; o texto de cada papel só diz o que o quadro é (o protótipo
  prometia leituras que ainda não existem); e o critério ainda abria a gaveta de antes
  (**resolvido na parte seguinte**, abaixo);
- **o que faltava nesta fatia:** a gaveta nova do critério — entregue em seguida — e o
  "ir para".

**A fatia 1.5, a gaveta nova do critério, entregue em 09/10** ([decisoes.md](decisoes.md), "A
gaveta nova do critério: as famílias, o estudo, o funil e os estados"; migration 035):

- **o que entrou:** as quatro **famílias** (estado, acontecimento, processo, medida), com a
  regra no banco — só a família Estado tem juiz hoje, e as outras três só observam; o
  critério criado pela tela nasce **observando e ligado** (conta, sem julgar e sem avisar);
  a gaveta com as quatro abas do protótipo — o critério com **o estudo** (as seis partes, e
  as condições de contexto e de gatilho que a loja confere sozinha), **o funil** em números,
  **o estado** e o aviso; e, na tela do canal, cada critério com a família e os números dos
  últimos 7 dias naquele lugar;
- **a migration não muda critério nenhum:** a família vazia vale a natural do tipo, nada de
  família desce para o agente e a configuração de loja nenhuma sobe de versão. O critério
  de ação de antes, que já julgava, continua julgado pelo texto;
- **a tela só afirma o que é verdade:** o custo usa o preço medido (sem preço, "—"); descer
  de "valendo" não é oferecido (para parar um aviso, desliga-se o critério); "medido" e
  "valendo" não têm botão; quem não configura abre a gaveta só para ler;
- **onde diverge do protótipo:** onze pontos, listados na decisão — os principais: **"Propor
  o estudo" não entrou** (no lugar, quatro modelos de partida e "escrever do zero"); o funil
  mostra 7 dias, não 24 horas; a troca de estado vale ao salvar; não há "Parar de avisar";
- **o que muda para quem cria critério:** até o banco de provas (onda 2), nenhum critério
  NOVO chega a "valendo" — os que já avisam continuam. Por isso Padrões ("É problema" →
  "criar um critério para acompanhar", no lugar de "que avisa quando repetir") e o Inventário
  passaram a criar critério que observa, e a planta e a tela do desenho mostram o estado no
  lugar de "ligado";
- **achados no caminho:** em tela de 320 px a árvore "Onde vale" empurrava a gaveta 8 px
  para o lado (texto da entrega anterior); as consultas do funil não filtravam pela loja e
  não andavam pelo índice da tabela (uma delas no ar desde a fatia 1.3); e "Ver a foto
  padrão", em Padrões, caía na tela do canal. Corrigidos;
- **o que faltava:** a proposta do estudo pelo sistema (fatia 1.3 — por regras, no servidor,
  primeiro) e o "ir para" (Ctrl K), entregue em seguida.

**A fatia 1.5, o "ir para", entregue em 09/10** ([decisoes.md](decisoes.md), "O 'ir para' (Ctrl K), e o
foco que volta a quem abriu"; sem migration):

- **o que entrou:** o botão "Ir para…" e o atalho Ctrl K abrem uma busca com as telas da loja,
  os canais e os critérios de cada canal; escolher um critério abre o canal já com a gaveta
  dele. A busca não liga para acento e aceita várias palavras;
- **achado no caminho:** ao fechar a paleta — e qualquer gaveta ou diálogo do console — o foco
  caía na página. Corrigido na peça compartilhada: volta ao botão ou à linha que abriu;
- **onde diverge do protótipo:** o botão mora no menu lateral (o console de hoje não tem a
  barra de cima), e a lista tem também as telas da loja;
- **com isto a fatia 1.5 fecha.** Da onda 1 falta a proposta do estudo (1.3). Ficou para uma
  limpeza à parte trocar "área" por "quadro" nos textos de Análises e do Painel.

**A fatia 1.3, a proposta do estudo, entregue em 10/10** ([decisoes.md](decisoes.md), "O sistema
propõe o estudo do critério — por regras, no servidor"; sem migration):

- **o que entrou:** o botão "Propor o estudo" na gaveta do critério. O servidor lê o texto
  do critério e os lugares em que ele vale (a cena do canal, o papel dos quadros, a foto
  padrão) e devolve as seis partes, o contexto e o gatilho já ligados a um sinal da loja, e
  o porquê de cada escolha. É um rascunho: a pessoa confirma ou corrige, e nada é gravado
  antes de ela salvar;
- **o que a proposta sabe do lugar:** de cima, movimento no lugar do detector de pessoas; em
  posição de montagem, nada de "lugar livre" (a loja já espera as mãos saírem); gatilho da
  foto padrão só com foto em todos os canais; a condição "há alguém" olhando o quadro de
  posto do canal, num acontecimento;
- **"a câmera não vê":** sete coisas que nenhuma câmera de loja alcança (o gesto de salgar,
  a temperatura, a data da etiqueta, o cheiro, o peso, o som, quem foi), com o motivo e a
  sugestão do que escrever no lugar. Não são guardadas: saem do texto, toda vez;
- **por regras, no servidor:** sem modelo, sem custo, sem depender do computador da loja.
  A proposta por um modelo que lê a imagem pode vir depois, atrás do mesmo botão;
- **o que não foi medido:** quantas propostas são confirmadas sem correção — só o uso diz;
- **com isto a onda 1 fecha.**

**A escolha do porte.** O plano manda o protótipo nascer na cara nova, e assim foi feito; o
porte da cara nova inteira é a onda 8. As telas da onda 1 entram no console com as peças e
as cores de hoje — o console não fica com duas caras —, e a cara nova chega para tudo de
uma vez na onda 8. Foi o caminho recomendado; o dono aprovou o protótipo sem pedir o outro
(adiantar "cores e tipos" para o console inteiro agora).

### Onda 2 — como ela entra (10/10/2026)

**É plano, não entrega.** Nada desta seção está no ar. Foi escrito depois de ler o código
de ponta a ponta — o que o agente, a nuvem e a tela têm hoje para a sequência e para o banco
de provas — e de reconferir os fatos em que ele se apoia.

**Cinco coisas que o código mostrou, e o que cada uma muda no jeito de entrar:**

1. **O agente não sabe buscar no gravador.** O cliente do gravador só fala ao vivo. O
   caminho de arquivo foi medido à mão (rodada 5: o bloco de 2 s chega em ≈ 1,9 s), e três
   coisas que ele exige não existem: **um pedido por vez** por gravador, **nunca repetir o
   pedido recusado** (a conta é a mesma do ao vivo) e **medir o relógio** do gravador contra
   o do computador (na loja, 24 a 30 s de diferença).
2. **A nuvem não guarda cada análise.** Guarda o resumo por hora e o que virou aviso. O
   critério em ensaio — justamente o que precisa ser medido — não deixa nada na nuvem sobre
   o qual marcar "acertou / errou".
3. **A imagem nunca sobe**, só a assinatura dela; fica 15 dias no computador da loja. Para
   marcar, o responsável precisa **ver** o que o juiz viu.
4. **"Ação" é julgada como "estado", por um quadro só,** e o agente nem recebe a família do
   critério. A sequência entra como um caminho ao lado, só para o agente que declara saber.
5. **O pedido à nuvem é conferido letra por letra,** e o texto fixo dele fica em cache em
   todas as lojas. A grade de 6 quadros é **outro pedido**: o de hoje não muda uma vírgula.

| fatia | o que entra | tela? | nasce |
|---|---|---|---|
| **2.0 · protótipo** | as telas da onda: os exemplos de um critério, com "acertou / errou" e "o que era"; o acerto medido à vista no critério, com a meta; a sequência (a grade de 6 quadros, com o instante marcado) | é o protótipo | espera a aprovação do dono |
| **2.1 · o cliente de arquivo do gravador** ✅ (10/10) | pedir ao gravador um trecho já gravado; um pedido por vez por gravador; pedido recusado não se repete; a diferença de relógio medida a cada busca. O que **cada gravador** entrega — o tamanho do bloco, o atraso até a gravação estar disponível — fica no perfil dele e é medido na instalação: nada disso é regra do motor | não | dormindo: nada o chama |
| **2.2a · o agente mede o gravador e lê o trecho** ✅ (10/10) | o agente mede sozinho o que o gravador entrega (o tamanho do bloco, onde ele começa e quantos quadros por segundo) e guarda esse perfil na máquina; pede o trecho em cima dos blocos; lê o trecho, **confere pelos quadros se ele veio inteiro** e escolhe o quadro parado | não | dormindo: nada o chama |
| **2.2b · a busca pelo meio e a grade, na loja** ✅ (11/10) | a busca pelo meio entre dois instantes; montar a grade de 6 quadros numerados; guardar a sequência ao lado da análise (≈ 0,3 MB cada, com teto e rodízio). **Muda pelo que a 2.2a mediu:** a busca só começa quando a gravação assentou no gravador (uns 3 minutos), e trecho que não veio inteiro é pedido de novo mais tarde | não | dormindo |
| **2.3 · o exemplo chega à nuvem** | cada julgamento de critério em ensaio (e valendo) deixa na nuvem um **exemplo**: o veredito, o motivo, a versão do critério e a imagem que o juiz viu — com teto por critério por dia e prazo de guarda (decisão 1, abaixo) | não | desligado por loja; pede migration |
| **2.4 · "acertou / errou" e o acerto medido** | a tela dos exemplos; a conta por critério e por versão — acerto, alarme falso, "não deu para ver"; o estado **medido** quando há exemplos marcados o bastante; **valendo** só com a meta batida; e a volta a "em ensaio" quando o texto, o quadro ou o modelo muda (ficou para esta onda) | sim | com o protótipo aprovado |
| **2.5 · Acontecimento passa a julgar** | a pergunta em sequência ("aconteceu isto nesta sequência?"), com a grade de 6, num pedido à parte; a resposta traz o **instante**; a família passa a descer para o agente que sabe. Critério novo continua nascendo observando | sim (a troca de estado destrava) | só no agente que declara saber |
| **2.6 · a primeira rodada de medida** | o dono marca os exemplos; medem-se os critérios que a loja tem e o primeiro acontecimento — "o molho vai na tampa antes da alface", que é regra da casa e já foi lido à mão na rodada 5 | — | depende dele e do crédito da nuvem |

**A ordem.** A 2.1 e a 2.2 são só do agente, não ligam nada e não têm tela: a **2.1, a
2.2a e a 2.2b estão feitas** (10 e 11/10, registros abaixo).
A 2.0 foi apresentada ao dono em 10/10 e espera a aprovação dele. A 2.3 espera a decisão 1;
a 2.4 e a 2.5 esperam o protótipo aprovado. Trocar o pacote do agente na loja continua
pedindo o "pode" dele.

**Três decisões que são do dono:**

1. **A imagem do exemplo na nuvem do Farol.** Recomendo: sobe **a imagem que o juiz viu** —
   já recortada no quadro e com o borrão de rosto —, reduzida, só de critério em ensaio ou
   valendo, no máximo 20 por critério por dia; o exemplo não marcado sai em 15 dias, e o
   marcado fica enquanto o critério não mudar. É o que deixa marcar de qualquer lugar, com a
   loja ligada ou não. A outra forma: a imagem só sobe quando alguém abre o exemplo — não
   guarda nada, mas é lenta e depende de o computador da loja estar no ar.
2. **A meta para "valendo".** Sugiro, para começar: no máximo **1 alarme falso em 10
   avisos**, medido em pelo menos 40 exemplos marcados, dos quais pelo menos 10 em que o
   juiz disse "fora". A meta é dele.
3. **Quem marca.** Sugiro: quem já vê as análises — supervisão, gerência e diretoria.
   Mudar o critério continua com a gerência.

**As contas** (medidas onde diz; o resto é conta):

| o quê | quanto | de onde vem |
|---|---|---|
| um passo da busca pelo meio | ≈ 3,3 s (1,9 s é baixar o bloco) | medido na loja, rodada 5, com a rede presa em 10 Mbit/s |
| um bloco de 2 s, pelo cliente do agente | 0,53 MB em 1,9 s (1,4 s até o primeiro byte); os 30 quadros lidos em 0,3 s | medido na loja em 10/10, uma medida, com a rede presa em 10 Mbit/s |
| a hora do gravador, por HTTP | 0,6 s | medido na loja em 10/10, uma medida |
| medir o que o gravador entrega | 6 pedidos, 4,7 s | medido na loja em 10/10, uma medida, pela rotina do agente |
| três blocos já assentados (6 s) | 1,58 MB em 2,25 s; os 90 quadros contados e o quadro parado escolhido em 0,9 s | medido na loja em 10/10, uma medida |
| um bloco recém-gravado passar a vir inteiro | de 1 min e 20 s a 2 min e 15 s | medido na loja em 10/10, três blocos; o pior caso não foi medido |
| um quadro na nuvem | 0,10 centavo, em 1,2 s | medido, rodada 5 (Haiku 5.5) |
| uma grade de 6 quadros na nuvem | 0,17 centavo, em 1,6 s | medido, rodada 5, com a grade daquele teste; com 6 recortes de 960 × 540 a conta do plano dá ≈ 0,3 centavo |
| o laço da busca pelo meio, pelo agente | três blocos em 4,5 s; quatro em 6,2 s | medido na loja em 11/10, uma medida de cada, loja fechada, juiz de mentira |
| a grade de 6 quadros, do pedido à imagem | 3,3 s para uma janela de 1,7 s (dois blocos) | medido na loja em 11/10, uma medida |
| a sequência guardada na loja | ≈ 0,3 MB pela conta; 0,49 MB medido com o quadro inteiro (células de 960 × 540) | conta; e uma medida na loja em 11/10 |
| os exemplos na nuvem, por loja | ≈ 90 MB, em regime | conta: 10 critérios × 20 por dia × 15 dias × 30 KB |

**O que a onda 2 não faz:** ler a bancada (ondas 4 e 5), mostrar o momento em vídeo (onda
6), dar baixa no KDS (onda 5, e só como opção da loja).

**O que não foi medido:** o acerto do juiz em **sequências** desta loja (na rodada 5, lidas
à mão: o que foi posto, 9 de 9; o utensílio, 6 de 9); o caminho de arquivo em outro gravador
que não o do piloto; quanto o computador da loja aguenta buscando e julgando ao mesmo tempo;
a busca depois de o cabo ser trocado; o pior caso do atraso da gravação recente, e se ele
muda com o disco novo; e se "tocar a gravação" entrega os segundos recentes.

**A fatia 2.1, o cliente de arquivo do gravador, entregue em 10/10** ([decisoes.md](decisoes.md),
"O agente aprende a pedir ao gravador o que já foi gravado"; só o agente — sem migration e
sem tela):

- **o que entrou:** um módulo novo no agente (`dvr/arquivo.py`), que pede ao gravador um
  trecho já gravado e mede a diferença entre o relógio dele e o do computador. **Nada o
  chama ainda:** a loja segue com o pacote de antes, e esta fatia não pede troca de pacote;
- **as regras, cada uma com teste:** um pedido por vez por gravador (a vez é do aparelho,
  não de quem pede); pedido recusado não se repete — um pedido sem credencial e, no máximo,
  um com ela; recusada, a porta fecha para aquela senha até ela mudar; a hora do pedido é a
  do gravador; ou o trecho chega inteiro, ou não fica arquivo nenhum;
- **provado no gravador da loja** (só leitura, um pedido com credencial por chamada): a hora
  do gravador por HTTP — a primeira chamada de verdade dessa forma neste modelo — veio em
  0,58 s, com o gravador 25,1 s adiantado; um bloco de 2 s veio com 529.080 bytes, o tamanho
  que o gravador declarou, em 1,89 s (1,43 s até o primeiro byte); o leitor de vídeo do
  agente abriu os 30 quadros de 1920 × 1080 em 0,29 s. O arquivo foi apagado, e o agente da
  loja seguiu de pé (o mesmo processo desde a véspera, sem aviso nem erro no registro);
- **o que mudou do plano:** nenhum número de aparelho ficou no motor. O bloco de 2 s e o
  atraso medidos no piloto foram para a ficha do gravador na base de equipamentos; sem
  medida, o agente não supõe bloco nenhum. Quem mede o perfil de cada gravador é o próprio
  agente — isso entrou na 2.2a, a primeira que precisa dele. **Corrigido na 2.2a:** duas
  das medidas do piloto que foram para a ficha estavam erradas (o pedido "arredondado para
  baixo" e a gravação disponível "uns 3 s" depois); a ficha e o módulo foram corrigidos;
- **como foi testado:** 50 testes novos, contra um gravador de mentira que **confere** a
  resposta ao desafio de senha (a bateria do agente foi a 1.059); 79 mutações do módulo,
  as 79 pegas pelos testes;
- **o que não foi medido:** outro gravador que não o do piloto; horas de busca com o ao vivo
  aberto; o caminho depois do cabo novo.

**A fatia 2.2a, o agente mede o gravador e lê o trecho, entregue em 10/10**
([decisoes.md](decisoes.md), "O agente mede o que o gravador entrega, e confere o que
voltou"; só o agente — sem migration e sem tela):

- **o que entrou:** três peças no agente, todas dormindo (nada as chama; a loja segue com o
  pacote de antes):
  1. **a medida do gravador** (`sequencia/perfil.py`): com uns seis pedidos de 1 s, na
     gravação de dez minutos atrás, o agente descobre o tamanho do bloco, onde os blocos
     começam e quantos quadros por segundo o gravador grava; confere com um pedido de dois
     blocos; e guarda o perfil ao lado da configuração. Gravador que entrega de outro jeito
     sai **sem bloco**, com o motivo escrito — o agente não confia numa conta que não é a
     daquele aparelho;
  2. **o pedido em cima dos blocos** (`dvr/arquivo.py`): começa no começo do bloco em que o
     intervalo começa e termina 1 s depois do começo do último bloco;
  3. **a leitura do trecho** (`sequencia/bloco.py`): conta os quadros, diz se o trecho
     **veio inteiro**, escolhe o quadro parado (a regra medida na rodada 5, como régua de
     fábrica: cada câmera pode ter a sua) e dá o instante de cada quadro;
- **o que a medida mostrou — e que corrige a rodada 5** ([teste-das-fichas.md](teste-das-fichas.md),
  "O que o gravador entrega, medido de novo"): da gravação assentada, o gravador do piloto
  devolve **os blocos que começam dentro do pedido** (eu tinha escrito "arredonda para baixo
  nas duas pontas": errado). E **a gravação recente vem cortada, com o tamanho declarado
  batendo**: em três blocos acompanhados, o bloco só passou a vir inteiro entre 1 min e 20 s
  e 2 min e 15 s depois de gravado (eu tinha escrito "uns 3 s": uma medida só). Foi a rotina
  de medida que mostrou — a primeira rodada dela no gravador de verdade não fechou com o que
  estava escrito;
- **provado no gravador da loja** (só leitura; a pasta de medida conferida vazia no fim): a
  medida do perfil em 4,7 s, com 6 pedidos — blocos de 2 s a partir de segundo par, 15
  quadros por segundo, relógio 24,8 s adiantado; três blocos de cinco minutos de idade,
  pedidos pelo meio deles: 1,58 MB em 2,25 s, 90 quadros de 90 esperados, **inteiro**, o
  quadro parado escolhido em 0,9 s; um bloco de 21 s de idade: 268 KB com o tamanho
  declarado batendo, 17 quadros de 30 esperados — **dito como não inteiro**;
- **como foi testado:** 63 testes novos e 5 mudados (a bateria do agente foi a 1.122); 148
  mutações das três peças, as 148 pegas pelos testes. Um erro achado no caminho: o instante
  de um quadro, guardado em microssegundos, voltava no quadro vizinho — corrigido, com teste;
- **o que não foi medido:** outro gravador; o pior caso do atraso (foram três blocos); o
  mesmo gravador com o disco novo; a medida rodando sozinha no agente (foi chamada à mão).

**A fatia 2.2b, a busca pelo meio e a grade, entregue em 11/10** ([decisoes.md](decisoes.md),
"A busca pelo meio e a grade de seis quadros entram no agente"; só o agente — sem migration e
sem tela; PR #104):

- **o que entrou:** quatro peças no agente, todas dormindo. **A busca pelo meio** (um bloco
  por passo; para ao achar, na janela da mão, quando não há quadro novo, quando o juiz não
  sabe e no teto de seis passos); **a grade** de seis quadros numerados, em que o número
  devolve o instante; **as duas com o gravador** (a hora dele por dentro, o relógio do
  computador por fora; só pede o que já assentou; confere pelos quadros o que voltou e, se
  veio cortado, volta em um minuto); e **a guarda** das sequências, com teto e rodízio;
- **provado no gravador da loja** (só leitura, loja fechada, juiz de mentira): o laço em
  4,5 s para três blocos e 6,2 s para quatro, todos inteiros; a grade de uma janela de
  1,7 s em 3,3 s (488 KB com o quadro inteiro); "cedo demais" respondido sem pedido nenhum;
  21 pedidos de trecho, um de cada vez, nenhuma recusa;
- **o que a medida mostrou — o perfil do gravador envelhece:** em 10/10 os blocos começavam
  em segundo par; em 11/10, em ímpar. Com o perfil velho o bloco volta sem gravação, e a
  janela, com um bloco a menos. Trecho assentado que volta assim é sinal de medir de novo
  — decisão de quem vai chamar a busca (fatia 2.5);
- **como foi testado:** 110 testes novos (o gravador de mentira entrega vídeo de verdade);
  169 mutações das quatro peças, as 169 pegas;
- **o que não foi medido:** o juízo dentro do laço; a busca com a loja aberta; outro
  gravador; por que o começo dos blocos mudou.

**Os segundos que acabaram de passar — o que a medida muda na onda 2.** O plano contava
olhar para trás "na hora": tampa nua agora, coberta 10 s depois, e o agente busca no
gravador o que houve no meio. Neste gravador isso só é de confiança uns 3 minutos depois.

| caminho | o que é | o que custa | para que serve |
|---|---|---|---|
| **esperar a gravação assentar** | o agente guarda o intervalo em dúvida, espera 3 minutos, pede, confere pelos quadros se veio inteiro e, se não veio, pede de novo mais tarde | nada de novo: é o que a 2.1 e a 2.2a já fazem | **medir** (a onda 2 inteira): para marcar "acertou / errou" não importa se a leitura saiu 3 minutos depois |
| **a memória curta, no agente** | o agente guarda ele mesmo os últimos minutos do canal da bancada, direto do fluxo ao vivo, e olha para trás sem pedir nada ao gravador | pela conta do bloco medido (0,53 MB a cada 2 s): ≈ 2 Mbit/s de rede e ≈ 50 MB de memória por canal vigiado. **Não foi provado na loja** | **avisar a cozinha na hora** por uma sequência — o "faltou o molho" antes de o lanche sair (onda 5 em diante) |
| **duas medidas baratas** | o mesmo teste depois do disco novo; e "tocar a gravação" nos segundos recentes | uma ida à loja que já está marcada; alguns pedidos de leitura | saber se o atraso é do disco de hoje, e se há um caminho mais curto |

**O que eu recomendo, e já sigo:** a onda 2 vai pelo primeiro caminho — ela existe para
medir, e medir não tem pressa. As duas medidas baratas eu faço quando o disco for trocado
(semana de 12/10). A memória curta fica desenhada para quando houver aviso de cozinha
dependendo de sequência (a onda 5), e entra com prova na loja antes de qualquer código de
produção. Se o dono quiser a memória curta antes, é só dizer.

### O lado do Regem — o plano, aprovado (10/10/2026)

**Aprovado pelo dono em 10/10, à noite** — as respostas marcadas na página "Porta do Farol
no Regem" e duas mensagens em seguida (abaixo, em "O que o dono respondeu"). **As fases 1 e
2 estão no ar desde 11/10/2026** (abaixo, em "A fase 1, entregue" e "A fase 2, entregue");
a fase 3 fica para a onda 5. O
plano foi escrito em cima do código do Regem que estava no ar em 10/10 (`origin/main`
`bb7beca6`), com os fatos reconferidos um a um.

**O que o código do Regem mostrou:**

1. **Os dados existem; falta a porta.** Ficha, ingredientes, variações e adicionais estão no
   banco. As rotas de hoje pedem o login de uma pessoa, e a leitura para máquina que existe
   (a do totem) não traz ficha, variação nem tempo de preparo.
2. **A API de integração já serve de molde.** É a do Liame e do RegemCast: acesso por loja,
   escopo, limite de 60 chamadas por minuto e revogação que vale na chamada seguinte. Só
   roda na nuvem, e hoje só tem vendas, clientes e cupons.
3. **O item da fila guarda só o texto.** O produto, a variação e os adicionais estão na
   comanda, a um passo. Quem avança é o pedido inteiro: o item não tem estado próprio.
4. **A soma por produto do KDS é do navegador, pelo texto da descrição.** "X-Burger" e
   "X-Burger · Grande" são dois grupos.
5. **No servidor da loja, nenhuma credencial de outro sistema vale,** fora a do totem. O
   servidor da loja conversa com a nuvem a cada 1 minuto.
6. **No piloto, o agente do Farol roda no mesmo computador do servidor local do Regem** (os
   cinco serviços dele de pé, conferido em 10/10).

| fase | o que entra | onde roda | pede da loja | quando |
|---|---|---|---|---|
| **1 · catálogo** | o Farol como aplicativo conectado do Regem, autorizado pelo presidente numa página (como o Liame); leitura de produtos, variações, adicionais e fichas, **sem preço e sem custo**; retrato inteiro com número de versão | só nuvem; uma migration só-nuvem no Regem | nada | ✅ **no ar em 11/10/2026** (PR 648 do Regem, migration 315) |
| **2 · fila de produção, só leitura** | os pedidos em produção e os concluídos das últimas 2 horas, com o produto de cada item, os adicionais, **a observação do item** e os horários; sem o cliente e sem valores | só nuvem; sem migration | nada | ✅ **no ar em 11/10/2026** (PR 649 do Regem) |
| **3 · KDS por produto, com baixa automática, e os avisos** | somar pelo produto; o item poder ser dado como feito; a porta por onde o Farol avisa "fechou um X" e entrega os avisos da cozinha — quem decide a baixa é o Regem; desfazer com um toque; o registro de cada baixa | **a rede da loja** (decidido em 10/10): o agente do Farol fala com o servidor local do Regem | atualização do servidor da loja | onda 5, com o acerto medido; o plano dela é apresentado antes do código |

#### A fase 1, entregue (11/10/2026)

No ar no Regem desde 11/10/2026, de madrugada (PR 648 de lá; migration 315, só da nuvem — o
número mudou porque a 314 ficou com outra frente do Regem, mesclada minutos antes).

| o que entrou | como ficou |
|---|---|
| o Farol como aplicativo conectado | acesso **por loja**, dado pelo presidente na página "Autorizar o Farol" (os textos aprovados); as três leituras vão juntas, sem chave para ligar ou desligar. Ele revoga em Configurações → Aplicativos conectados |
| a leitura do catálogo | categorias, setores da loja, produtos, variações, combos e adicionais — o que cada adicional acrescenta (insumo, ficha ou produto) e o ingrediente que ele retira |
| a leitura das fichas | as fichas e os ingredientes, na ordem, com a quantidade como foi informada e a do estoque |
| a versão | cada leitura é o retrato inteiro, com a impressão do conteúdo; o Farol manda a que tem e, se nada mudou, recebe só "nada mudou" |
| o que não sai | preço, custo, margem, CMV, cliente, venda — nenhuma consulta das duas leituras toca nesses campos, e o teste varre as respostas atrás de nome e de valor de dinheiro |

**Como foi conferido:** 23 testes novos contra banco de verdade (o retrato campo a campo; a
loja A não lê a B nem outra empresa; o mesmo número de consultas com 5 produtos e com 500);
a suíte inteira do Regem (2.275 testes) e o CI verdes; a página em 16 larguras de tela, sem
barra de rolagem para o lado; a migration na nuvem com a conferência dela; e o deploy pela
rota nova respondendo.

**Um achado no caminho, corrigido antes de ir ao ar:** no Regem, "ter um aplicativo
conectado" ligava a cópia das vendas que serve ao Liame e ao RegemCast. O acesso do Farol,
que não lê vendas, ligaria a cópia de 91 dias de uma empresa que ninguém ia ler. A rotina
de lá passou a olhar o que o acesso libera; para os dois aplicativos de antes nada mudou.

**O que isso combina para o lado do Farol** (item 3 da lista abaixo, com plano e protótipo
antes do código): o contrato está no Regem, em `docs/integracao-farol.md`; o endereço de
volta padrão já registrado lá é `https://api.monitorfarol.com.br/v1/regem/retorno`; a
página do Regem diz que o acesso pode ser revogado "no Farol" — o console do Farol **tem
de ter o "desconectar"**, que chama a rota de revogar de lá; e o acesso de cada loja é um
segredo — fica cifrado no servidor do Farol, nunca na tela, nunca na loja.

#### A fase 2, entregue (11/10/2026)

No ar no Regem desde 11/10/2026, de manhã cedo (PR 649 de lá; sem migration — o acesso do
Farol já levava esta leitura desde a fase 1).

| o que entrou | como ficou |
|---|---|
| a leitura da fila da cozinha | os pedidos **em produção** (recebido ou em preparo) das últimas 24 horas e os **concluídos ou cancelados** das últimas 2 horas, na ordem em que entraram |
| o pedido | o número na fila, de onde veio (balcão, mesa, comanda, delivery, totem), o canal (iFood, cardápio…), **comer na loja ou viagem**, a etapa e os horários de cada etapa, e se foi alterado depois de entrar |
| o item | o produto, a ficha e a variação como ficaram na venda; as escolhas — com o mesmo número fixo da opção que vem no catálogo, quantas vezes foi escolhida, o que acrescenta e o que retira —; **a observação**, como foi escrita; e se o item foi retirado do pedido |
| a versão | o mesmo esquema do catálogo: o Farol manda a que tem e recebe só "nada mudou" |
| o que não sai | quem é o cliente, a mesa, a senha de retirada, o motivo do cancelamento e qualquer valor — a leitura nem toca a tabela onde isso fica, e o teste varre a resposta atrás de cada um |

**Como foi conferido:** 9 testes novos contra banco de verdade (a janela, com os casos de
borda; o pedido e o item campo a campo; a loja A não lê a B; a versão; três consultas com 5
pedidos ou com 300); a suíte inteira do Regem (2.284 testes) e o CI verdes; e o deploy pela
rota nova respondendo.

**Três coisas que o Farol precisa saber ao consumir:**

- **O atraso.** Na loja com servidor próprio (o caso do piloto), a fila chega à nuvem pelo
  sincronismo do Regem: até 1 minuto depois. Somado aos 2 a 3 minutos que o gravador leva
  para entregar a gravação inteira, a conferência por sequência continua sendo "depois do
  fato" — a leitura pela nuvem não é o gargalo. O aviso na hora é assunto da fase 3, pela
  rede da loja.
- **"Viagem ou comer na loja" vem do pedido.** O campo sai na leitura, e casa com a pista
  que o dono deu em 10/10 (caixa = viagem; papel kraft = consumo na loja): a embalagem vista
  pela câmera pode ser conferida contra o que o pedido dizia.
- **Quem avança é o pedido inteiro, e nem toda loja usa todas as etapas.** Há loja que vai
  de "recebido" direto a "pronto". O item não tem etapa própria — é o que a fase 3 muda.

**O que o Farol faz com isso, do lado dele:** a base própria de fichas e produtos (item 3 da
lista abaixo), alimentada pela fase 1; e, com a fase 2, a demanda por ingrediente crítico e
os dois números do saldo de produção.

**O que o dono respondeu (10/10):**

| decisão | resposta |
|---|---|
| 1 · a fase 1 pode começar? | **pode** |
| 2 · como o Farol recebe o acesso | pela página "Autorizar o Farol" — o presidente autoriza, ninguém copia segredo |
| 3 · os textos da página de autorização | aprovados como estão |
| 4 · a observação do item (o "sem cebola") sai na fila? | sai |
| 5 · quando entra a fase 2 | logo depois da fase 1 |
| 6 · por onde chega o aviso do Farol (fase 3) | **pela rede da loja:** "o Regem é feito para rodar localmente, o servidor faz a ponte de comunicação com a nuvem justamente para quedas ou oscilações de internet não influenciarem o funcionamento local; então o servidor de análise do Farol é local, e é mais fácil e ágil enviar ao KDS de destino responsável pelo alerta" |

**Os canais do aviso, ditos por ele na mesma resposta** (o desenho não muda: o Farol decide,
o Regem entrega):

- **na cozinha, pelo alerta do KDS do Regem** — que já tem mensagens cadastradas: erro,
  faltou ingrediente, caiu item. Vai ao KDS do setor responsável, pela rede da loja;
- **por WhatsApp, quando é urgente e não interessa à cozinha** — só para o responsável ou o
  presidente;
- **por e-mail, os relatórios.**

O WhatsApp e o e-mail saem pela internet, porque o destino está fora da loja; o aviso da
cozinha não passa por ela. O que isso pede do Regem entra no plano da fase 3: o servidor
local aceitar o Farol como aparelho da loja (hoje só aceita o próprio servidor e o totem), a
porta local do aviso, e o destino escolhido pelo setor.

**Onde a ficha fica — pergunta do dono (10/10):** "o nosso agente não está no servidor
local? não estamos fazendo as análises locais? (…) então como na nuvem ficam as fichas para
analisar a precisão da montagem?" A análise é local. A nuvem é só o caminho por onde a ficha
viaja — Regem (nuvem) → Farol (nuvem) → agente, no computador da loja — e a cópia que chega
fica guardada na loja, como já ficam as áreas e os critérios. A conferência da montagem usa
essa cópia e não depende de internet; para a nuvem só sobe o que o agente não conseguiu
julgar.

**O que não foi conferido:** o banco de produção do Regem (li as migrations e o schema); o
atraso real do sincronismo da loja para a nuvem (1 minuto é do código, não de medida). E
alguns identificadores do Regem mudam a cada salvamento — a variação, o ingrediente da
ficha: o Farol casa pelo produto e pelo nome, e trata cada leitura como retrato inteiro.

### O lado do Farol que usa o Regem — o plano, aprovado (11/10/2026)

**Apresentado ao dono em 11/10, de manhã cedo**, na página "Regem no Farol", com o protótipo
das duas telas (`mockups/farol-conexoes-e-fichas.html`), e **aprovado por ele no mesmo dia**
(as respostas estão abaixo, em "O que o dono respondeu"). **As fatias 1, 2 e 3 foram entregues** (mais
abaixo, "A fatia 1, entregue", "A fatia 2, entregue" e "A fatia 3, entregue"); as fatias 4 e 5 ficam para depois.

**O que o código do Farol mostrou** (lido na `main` de 11/10):

1. **O servidor do Farol nunca chamou outro sistema.** Não há cliente de saída, nem molde de
   prazo e de nova tentativa a seguir.
2. **Ele não guarda segredo que precise ser lido de volta.** Senha, sessão e acesso do agente
   ficam só como impressão digital; senha de câmera nem sobe. O acesso de cada loja ao Regem
   é o primeiro segredo que o servidor precisa guardar e usar — entra cifrado.
3. **O console não tem tela de conexão nem de configuração da conta**, e não existe ação só
   da diretoria: o que o gerente configura, a diretoria também.
4. **A sessão do console só vale no endereço do console.** Por isso a volta do Regem tem de
   chegar pelo console, e não pelo servidor: é o que permite exigir que quem volta é quem
   começou.
5. **O agente já tem o jeito de receber uma cópia:** a configuração leva só a marca do que
   mudou, e ele baixa o que falta (é como chegam as fotos padrão).

**O caminho de uma ficha:** Regem → servidor do Farol (que pergunta de tempos em tempos,
guarda a cópia e a mostra na tela) → computador da loja (o agente baixa quando muda e
guarda). A conferência usa a cópia da loja e não depende de internet; nem o acesso ao Regem
nem o segredo descem para a loja.

**As duas telas do protótipo:**

| tela | para quê | o que dá para fazer |
|---|---|---|
| **Conexões** (da conta) | dizer de onde o Farol lê; mostra o que ele lê e o que não lê antes de a pessoa sair para o Regem | conectar; dizer qual loja do Farol é cada loja de lá (o Farol sugere pelo nome); autorizar outra loja; desconectar |
| **Fichas** (da loja, no menu) | ver o que o Farol sabe de cada produto: a ficha na ordem, as variações, o que o cliente pode pedir a mais ou tirar | procurar e filtrar; **"Buscar agora"**, para trazer na hora o que mudou no Regem; **não se edita** — as fichas são do Regem |

Na ficha, o preparo da casa entra como um ingrediente só e a embalagem de viagem fica de
fora (as duas decisões de 10/10). A tela diz quando a busca do dia falhou — e aí as fichas
que já vieram continuam valendo. Quando a loja é desconectada, ou o acesso é tirado no
Regem, as fichas daquela loja são apagadas (decisão de 11/10).

**Cinco fatias, uma de cada vez:**

| fatia | o que entra | onde | banco | pede do dono |
|---|---|---|---|---|
| **1 · conectar e ligar as lojas** | a tela Conexões e o que há por trás: a ida, a volta, a troca do código pelo acesso de cada loja, o par das lojas e o desconectar, que devolve o acesso | servidor e console | migration 036 | duas variáveis no painel; autorizar no Regem |
| **2 · ler e guardar as fichas** | o servidor busca as fichas quando a loja é ligada e, depois, **uma vez por dia**; quando muda, refaz a cópia da loja no formato do Farol; a tela Fichas, com o "Buscar agora" | servidor e console | migration 037 | as fichas cadastradas no Regem |
| **3 · a cópia chega à loja** | o agente baixa as fichas quando mudam e as guarda; a partir daqui um critério pode dizer "montado como a ficha manda" | servidor e agente | sem migration | o "pode" para trocar o pacote na loja |
| **4 · planilha, para a loja sem Regem** | a mesma base recebe as fichas por planilha; tela nova, com protótipo próprio | servidor e console | a ver | aprovar o protótipo |
| **5 · a fila da cozinha chega à loja** | o servidor repassa ao agente o que a cozinha tem para fazer; alimenta a demanda e o saldo | servidor e agente | sem migration | nada |

**O que o plano respeita:** o acesso ao Regem é segredo — cifrado no servidor, fora da tela,
fora da loja e fora dos registros; só quem começou a conexão a termina; o Regem é um
**adaptador** (a base tem o formato do Farol e amanhã recebe planilha ou outro sistema); a
tela diz "atualizado hoje, 04:10", e não como a leitura é feita; uma migration por vez; e nos
testes um Regem de mentira que recusa o que o de verdade recusa, com uma chamada de verdade
antes de dizer que funciona.

**Um ajuste pequeno no Regem vai junto com a fatia 1:** o endereço para onde o Regem devolve
a pessoa passa a ser o do console do Farol (hoje aponta para o servidor).

**O que o dono respondeu (11/10):**

| decisão | resposta | o que muda |
|---|---|---|
| 1 · as duas telas | **aprovadas: pode começar a fatia 1** | a fatia 1 começou |
| 2 · quem conecta e desconecta | **só a diretoria** | entra no Farol a primeira ação que só a diretoria faz; o gerente vê a conexão e as fichas, sem os botões |
| 3 · ao desconectar, as fichas | **são apagadas na hora** (eu tinha recomendado que ficassem) | o diálogo diz isso antes de confirmar; os critérios que usam ficha param de conferir até conectar de novo |
| 4 · a ordem | fatias 1, 2 e 3 agora; planilha e fila depois | nada: é a ordem do plano |
| outra coisa | "o servidor não precisa perguntar ao Regem a cada 5 min; ficha técnica não é algo que se mude constantemente" | a busca é feita quando a loja é ligada e, depois, uma vez por dia; a tela Fichas ganhou o "Buscar agora" |

**Aplicado pela mesma regra da resposta 3, e dito a ele para mudar se quiser:** quando o
acesso é tirado **pelo Regem** (em Configurações → Aplicativos conectados), o Farol também
apaga as fichas daquela loja assim que percebe.

**O que não foi conferido:** quantas fichas o piloto terá e como os adicionais serão
cadastrados; o atraso real da leitura (os números vêm do código, não de medida); e nada foi
executado contra o Regem de verdade — a página de autorização só abre depois que o segredo
do aplicativo existir nos dois painéis.

**A fatia 1, entregue (11/10/2026 · PR #101, migration 036):** a conta conecta ao Regem, liga
cada loja de lá a uma loja daqui e desconecta. Tela **Conexões** (gerente para cima e o suporte
veem; só a diretoria age), cinco rotas no servidor, duas tabelas, e o acesso de cada loja
guardado cifrado. O Regem recebeu o ajuste do endereço de volta, que passou a ser o do
console. Medido: 97 testes novos; 111 estragos de propósito no código, todos pegos; a tela
num navegador de verdade (133 passos; oito estados em 16 larguras sem barra para o lado); e
uma chamada de verdade do cliente do Farol ao Regem real. A tela ainda não fala de fichas nem
de "atualizado hoje": essas frases chegam com a fatia 2, junto do código que as sustenta — a
lista do que difere do protótipo está em `docs/decisoes.md`. **Falta, do dono:** pôr o segredo
do aplicativo nos dois serviços e a chave dos acessos no `farol-api`, e autorizar pela tela.
A fatia 2 veio em seguida (abaixo).

**A fatia 2, entregue (11/10/2026 · PR #102, migration 037):** o servidor lê do Regem o
cardápio e as fichas de cada loja ligada e guarda a **base de fichas no formato do Farol** (um
documento por loja, trocado inteiro quando muda, sem preço nem custo). A leitura é ao ligar a
loja, uma vez por dia às 04h e pouco do relógio dela, e no "Buscar agora". Tela **Fichas** (da
loja, para quem configura) e a tela Conexões dizendo a situação de cada busca. Falha na
leitura não apaga nada; acesso tirado no Regem apaga a base da loja na hora. Medido: 67
testes novos; 131 estragos de propósito, todos pegos; as duas telas num navegador (253
passos; 20 estados em 16 larguras); e a leitura de produção contra o Regem real. **Do dono:**
as mesmas três variáveis da fatia 1 e, depois, as fichas cadastradas no Regem; e duas
perguntas — a supervisão vê as fichas? como fica a barra de baixo do celular com sete itens?
A fatia 3 veio em seguida (abaixo).

**A fatia 3, entregue (11/10/2026 · PR #103, migration 038):** a base de fichas passa a
ter uma **cópia no computador da loja**. Base nova, trocada ou apagada sobe a versão da
configuração da loja (um gatilho no banco); a configuração leva a marca da base, ou nulo; o
agente baixa o documento quando a marca não é a da cópia dele (`GET /v1/agentes/fichas`),
guarda em `fichas.json` e **apaga a cópia quando a loja deixa de ter base**. Só a configuração
apaga: falha de rede e resposta torta deixam a cópia de antes valendo. Medido: 13 testes
novos na API e 69 no agente; 119 estragos de propósito, todos pegos; e os dois
lados de verdade, um contra o outro (25 conferências). **Ainda não muda o que a loja confere:**
nenhum critério usa a ficha. **Do dono:** o "pode" para trocar o pacote do agente na loja — até
lá, o agente de lá ignora a base. **As fatias 4 (planilha) e 5 (fila da cozinha) ficam para
depois**, como ele decidiu; a planilha tem protótipo próprio antes.

### O que não foi medido

- O acerto dos modelos de nuvem em **sequências** desta loja. Em quadro único foi medido
  (o teste lado a lado), com gabarito meu, provisório.
- Se todo lote é montado por ingrediente — estudaram-se dois, da mesma noite e da mesma
  pessoa. O que o KDS tinha em preparo não se sabe: os pedidos estão no Eclética.
- O sistema achando sozinho a posição e o instante: no experimento das fichas quem
  recortou e escolheu os quadros fui eu.
- (A forma nova de chamar o modelo forte, do PR #69, **foi conferida contra a nuvem em
  09/10**, com o código do pacote.)
- A leitura da bancada contra uma contagem humana, num pico de verdade e com a câmera
  regulada. (Com a câmera regulada foi medida, em 09/10 à noite, a leitura dos
  INGREDIENTES pela nuvem — rodada 4 do experimento das fichas —, não a leitura da
  bancada.)
- As 32 comandas da prova (sem recorte para conferir).
- Se a comanda é impressa em todas as bancadas e fica sempre ao lado do lanche.
- Se o gesto de salgar aparece na câmera da chapa (canal 6, ≈ 3 a 4 px por cm).
- Se o trecho recém-gravado (que não começa no cabeçalho do arquivo) é lido sem erro.
- O px por cm com régua (a folha A4): os 12 saem da comanda, tomada como de 80 mm, e
  batem com o pão, que sai com ≈ 10 cm na conta. O campo de visão da lente na ficha do
  fabricante (a página dele recusou a leitura; a busca indica 109° a 33°).
- O efeito de cada ajuste do menu da câmera (HLC, Dia/noite) e de mais luz na bancada
  sobre o reflexo e o borrão da mão. Obturador a câmera não tem (manual).
- O leitor do molho com o quadro escolhido pelo sistema (na rodada 3 quem escolheu fui
  eu) e em mais de um lote.
- A busca de trechos com um HD no gravador: a conta diz que não muda, porque quem limita
  é o gravador — medir quando o disco for trocado.
- Um mini PC rodando o agente: a máquina mínima é conta de escala.

### Da parte do dono

0. ✅ **Feito pelo dono em 08/10:** o critério "Produto" (canal 4) e os outros critérios
   pagos saíram. Conferido na loja às 23h54 (configuração 116): ficaram dois critérios de
   presença, julgados lá mesmo, sem custo. A leitura dos ingredientes entra pela onda 1
   (contexto e resposta em lista) e pela leitura da bancada.
1. Regular a câmera do canal 4 (os sete itens acima) e avisar — eu meço de novo. **Anotado
   a pedido dele (09/10):** os passos estão na página do plano, em "Na loja: a lista", com
   o HD e o cabo. Ele faz quando estiver na loja, na semana de 12/10.
2. Confirmar **a rotina** que a câmera mostrou: a comanda sai em cada bancada e fica ao
   lado do lanche até embalar? o lanche é sempre montado sobre o papel alumínio ou na
   caixa, no lado esquerdo? **A montagem é sempre por ingrediente, em lote? As embalagens
   são sempre marcadas à caneta?**
3. Escolher os **3 a 5 processos** que quer ver julgados primeiro. Sugestão: montagem
   conforme a ficha; sal na carne (o exemplo dele); lavar as mãos antes de montar; pedido
   completo na sacola; bancada limpa entre pedidos.
4. ✅ **O lado do Regem: o plano foi apresentado e aprovado em 10/10** ("O lado do Regem —
   o plano, aprovado"). O caminho mudou em relação ao de 09/10: o Farol puxa as fichas e os
   produtos para base própria, e a fila de produção sai sem os ingredientes. **As fases 1
   e 2 entraram no ar em 11/10.** No mesmo dia foi apresentado o plano do lado do Farol
   ("O lado do Farol que usa o Regem — o plano, aprovado"), com o protótipo das duas telas —
   **aprovado por ele no mesmo dia.** Da parte dele fica, quando a fatia 1 estiver pronta,
   colar duas variáveis nos painéis (o passo a passo vai na hora; os valores não passam por
   mim) e autorizar o Farol no Regem.
5. ✅ **Aprovada em 09/10** ("tudo aprovado e revisado").
6. ✅ O quinto lanche do lote das 21h42 é o **Mussarela Bug** (dito pelo dono em 09/10, com
   a ficha). Falta ele confirmar que os quatro são o **Número 01**, dizer o que são as
   posições do lote anterior que não batem com as fichas, e passar **as fichas de todos os
   lanches** — onde estão cadastradas, ou a lista.
7. ✅ **O agente da loja foi atualizado em 09/10, às 01h50** (o dono: "pode trocar"): está
   com a correção da reconsulta (PR #69) e a do cliente do gravador (PR #66); subiu sem
   aviso nem erro.
8. Dizer a **meta do leitor local**: que parte dos lanches a loja tem de decidir sozinha, e
   com que erro, antes de a nuvem ficar só com o "não sei". E o "pode" para a nuvem
   rotular os primeiros exemplos (mil exemplos ≈ R$ 1,30).
9. ✅ **Pedido pelo dono em 09/10; chega no domingo, 11/10, e ele instala na semana de
   12/10.** O disco do gravador: um HD de 3 TB da linha de vigilância (o WD Purple de 3 TB
   está na lista de compatibilidade da Intelbras) — ≈ 8 dias de gravação no lugar das 15 h
   de hoje. Formatar pelo gravador depois de instalar e conferir a hora (NTP).
10. **O cabo de rede** entre o PC e o gravador (ele troca no mesmo dia do HD): ao trocar,
    avisar — a placa volta de 10
    Mbit/s forçado para automático (com o "pode" dele) e eu meço.
11. **Cadastrar as fichas técnicas no Regem**, na conta da Mister Burguer, e dar o ok: elas
    viram o dicionário de ingredientes e os pares difíceis.
12. Dizer **as outras regras da casa**, como a do molho (o que vai onde, e com que
    utensílio); se a **maionese** vai sobre a carne por padrão; e se o lanche da **caixa**
    das 21h45 era queijo em dobro pedido pelo cliente.
13. **Formatar o PC da loja** (ele disse que é o ideal): só com roteiro — a máquina é
    também o servidor local do Regem da loja.
