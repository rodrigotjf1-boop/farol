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
| **A2.3 · detector local** não existe | regra de `presenca`, `contagem` e `comparacao` é 100% local por desenho; sem detector, o seletor recusa (corretamente) e a regra fica de fora da captura — ver ERR-014 |
| migration 011 não está na nuvem | passo do dono, console do `farol-api` |
| nenhum destino de alerta cadastrado | passo do dono, **Loja → Alertas** |
| só um canal configurado | o alvo pede três |

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

O quadro de preview é cena real da loja, com pessoas. Então: **borrão de
rosto antes de sair da loja** (`recorte.borrar_rostos`, já existe), expurgo
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
