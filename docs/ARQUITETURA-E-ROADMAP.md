# Projeto de Monitoramento Visual Inteligente — Arquitetura & Roadmap
### Integração com Regem | Mister Burguer
*Documento de referência — v1 — 18/07/2026*

---

## 1. Visão geral

Sistema de visão computacional que monitora o CFTV interno da loja de forma contínua, avalia a execução de tarefas e padrões operacionais usando IA, e emite eventos/alertas roteados pelo Regem (via webhook → n8n) para os canais certos: WhatsApp (C&O, gerentes, futuramente clientes), KDS interno e dashboards.

O objetivo não é vigilância de pessoas, e sim **garantia de padrão operacional**: EPI, limpeza, organização, porções, uso correto de equipamentos — sempre por **setor/zona** (a câmera define a área), nunca por identificação individual, mantendo o projeto fora do escopo sensível da LGPD.

### Princípio de operação por período

| Período | Modo | Comportamento |
|---|---|---|
| **Durante o turno** | Monitoramento ativo | Verificação contínua de tarefas e padrões; alertas em tempo quase real para KDS e gerência |
| **Fora do turno** | Vigília / auxílio | Monitoramento de exceção: alertas de emergência para casos específicos (movimento indevido, porta aberta, etc.) e registro de eventos atípicos para consulta posterior |

---

## 2. Arquitetura do sistema

### Topologia física (na loja)

```
┌─────────────────────────────────────────────────────────────┐
│  LOJA (rede local — cabeamento Cat6)                         │
│                                                              │
│   [Câmeras CFTV] → [DVR Motorola MTD161L0013]                │
│                          │ RTSP (porta 554)                  │
│                          ▼                                   │
│   ┌──────────────────────────────────────────┐              │
│   │  MINI PC / SERVIDOR LOCAL                 │              │
│   │  • Serviço de captura (RTSP)              │              │
│   │  • Motor de análise (IA)                  │              │
│   │  • Interface de configuração (web local)  │              │
│   │  • Buffer de eventos (resiliência)        │              │
│   └──────────────────────────────────────────┘              │
│                          │ HTTPS (só eventos JSON)           │
└──────────────────────────┼──────────────────────────────────┘
                           ▼
              ┌────────────────────────┐
              │  n8n (webhook)         │  ← roteamento
              └───────────┬────────────┘
                          │
        ┌─────────────────┼──────────────────┬─────────────┐
        ▼                 ▼                  ▼             ▼
   [WhatsApp C&O]   [WhatsApp Gerente]   [KDS interno]  [Regem]
                                                          │
                                              ┌───────────┴──────────┐
                                              ▼                      ▼
                                       [Dashboard gerente]   [Base de dados nuvem]
```

**Decisão de arquitetura confirmada:** o processamento de vídeo roda **na loja** (mini PC/servidor local). Só o **evento** (texto JSON + snapshot comprimido) sai pela internet. Isso mantém o vídeo na rede local (leve, seguro, sem VPN nem exposição do DVR) e minimiza banda de saída. O upgrade para cabeamento Cat6 reforça exatamente esse fluxo interno RTSP.

### Componentes de software

O sistema se divide em quatro peças com responsabilidades separadas:

**Motor de análise (o script atual, evoluído):** captura frames por setor, chama a IA, aplica regras de emissão, mantém buffer de resiliência e envia eventos. É o coração e já está funcional.

**Interface de configuração (a construir):** aplicação web local, atrelada ao motor, onde o gestor cadastra e edita zonas, padrões de controle, horários e urgências — sem tocar em código. As alterações são persistidas e o motor as lê dinamicamente.

**Camada de integração Regem:** o contrato de evento (JSON padronizado) e o webhook. Já definido e testável.

**Base de dados na nuvem:** armazena registros importantes (eventos atípicos, histórico de conformidade, imagens de referência) para consulta e relatórios.

---

## 3. Modelo de configuração de controles (o núcleo do produto)

A grande evolução é sair de um `config.yaml` editado à mão para um **modelo de controles rico**, editável por interface, e com integração de contexto vindo do Regem (ex.: horários de pico).

### Anatomia de uma zona

Cada **zona** corresponde a uma câmera/área física e contém uma lista de **controles**. Um controle é uma regra de verificação com contexto.

Exemplo do controle que você descreveu, estruturado:

```
Zona: 5 — Chapa
  Controle: "Uso correto da chapa em pico"
    Ativação:      durante horários de pico (fonte: Regem envia janela de pico)
    Padrão:        carnes congeladas no lado esquerdo da chapa;
                   no máximo 8 unidades por vez;
                   tempo mínimo de preparo 2 min por leva
    Verificação:   contar unidades no lado esquerdo; sinalizar se > 8;
                   estimar se há giro rápido demais (< 2 min) por observação
                   de mudança entre capturas sucessivas
    Urgência:      média
    Ação:          alerta KDS da estação + registro
```

### Tipos de controle previstos

O sistema deve suportar múltiplos tipos, cadastráveis livremente:

**Controle de EPI** — touca, luva, calçado fechado, avental, proteção na câmara fria. Verificação por presença/ausência na cena. (Já validado em teste: funciona bem.)

**Controle de limpeza/arrumação** — estado de superfícies (chapa, bancada, piso), organização de estoque, itens fora do lugar, itens jogados. Verificação por estado em horário-chave (v1) evoluindo para verificação da ação de limpar (v2, ver §7).

**Controle de porção/produto** — nível de batata no cesto, quantidade de itens na chapa, transbordamento. Estimativa visual aproximada de excesso, não medição exata.

**Controle de processo com tempo** — sequência e duração (ex.: tempo mínimo na chapa, item esquecido fritando). Requer análise de sequência de frames (v2).

**Controle de exceção fora de turno** — movimento em área que deveria estar vazia, porta/equipamento aberto, presença indevida. Ativo no modo vigília.

### Contexto dinâmico do Regem

Um diferencial importante: o Regem **alimenta o motor com contexto** que muda a verificação. O exemplo dos horários de pico é o primeiro caso: o Regem envia a janela de pico cadastrada, e certos controles só ativam (ou mudam de rigor) durante ela. Isso vale para: horários de pico, cardápio do dia, promoções ativas, escala de turno. O motor consulta esse contexto antes de decidir o que verificar.

---

## 4. A interface de configuração (a construir)

A interface é o que transforma o script num produto operável por não-programadores. Requisitos funcionais:

**Cadastro de zonas** — associar cada zona a um canal do DVR, com nome e descrição da área.

**Cadastro/edição de controles** — criar controles em linguagem natural guiada (formulário: o que verificar, o que é conforme, o que dispara alerta, horário/ativação, urgência, ação). Poder adicionar quantos controles quiser por zona.

**Ligar/desligar controles** sem apagá-los; ajustar limiares de confiança e janelas de horário.

**Teste ao vivo** — botão "testar agora" que captura a zona e mostra o veredito da IA na hora (o `teste_camera.py` vira uma função da interface).

**Visualização de histórico** — ver eventos recentes, filtrar por zona/tipo/urgência, rever snapshots.

**Sincronização com o motor** — ao salvar, a configuração é persistida e o motor passa a aplicá-la sem reinício manual.

Tecnicamente, a interface pode ser uma pequena aplicação web local (o motor expõe uma API local; a interface consome). Como você já trabalha com o stack do Regem, faz sentido alinhar a tecnologia da interface com ele para reaproveitar componentes e, no futuro, embutir essa configuração como um módulo do próprio Regem.

---

## 5. Pesquisa de APIs / modelos de visão (custo x qualidade)

Levantamento de mercado (julho/2026) para escolher o motor de análise equilibrando custo operacional e qualidade. Há dois caminhos: **API na nuvem** (paga por uso, zero infra) ou **modelo local self-hosted** (custo fixo de hardware, zero por análise).

### Opção A — APIs de nuvem (pagas, por uso)

Preços por 1 milhão de tokens (entrada/saída). O custo por imagem depende da resolução, mas em geral fica em **centavos ou frações de centavo** por análise de frame na resolução que usamos (sub-stream leve).

| Modelo | Preço in/out (US$/1M tok) | Perfil | Nota para o projeto |
|---|---|---|---|
| **Gemini 3 Flash** | ~$0,50 / $3,00 | Muito barato, rápido, multimodal, tem free tier | Forte candidato para volume; ótimo custo |
| **Gemini 2.5 Flash** | ~$0,15 / $0,60 | Ainda mais barato, 1M contexto, free tier generoso | Excelente para prototipar e alto volume |
| **Claude Haiku 4.5** | ~$1,00 / $5,00 | Barato, boa aderência a instruções | Bom equilíbrio qualidade/custo |
| **Claude Sonnet** (atual) | ~$3,00 / $15,00 | Alta qualidade de julgamento | O que usamos; ótimo, mas mais caro em escala |
| **Gemini 3.1 Pro** | ~$2,00 / $12,00 | Alta capacidade | Quando precisar de análise mais fina |
| **GPT-5.x** | ~$2,50 / $15,00 | Alta qualidade | Alternativa robusta |
| **Grok 4.x** | ~$0,20 / $0,50 | Muito barato | Avaliar qualidade de visão para o caso |

*Preços de mercado coletados em jul/2026, sujeitos a mudança; confirmar nas páginas oficiais antes de fechar. Descontos de prompt caching (até 90%) e batch (até 50%) reduzem muito o custo real quando o prompt de sistema é fixo — que é o nosso caso.*

**Vantagens da nuvem:** zero infra, sempre atualizado, qualidade de ponta, começa hoje. **Desvantagens:** custo cresce com volume, depende de internet, dado sai da loja.

### Opção B — Modelos locais self-hosted (custo fixo, zero por análise)

Rodam no próprio mini PC/servidor (com GPU) — **sem custo por imagem** e **sem enviar imagem para fora**.

| Modelo | Requisito | Perfil |
|---|---|---|
| **Qwen2.5-VL 7B** | ~6-8 GB VRAM (GPU 8-16GB) | O "cavalo de batalha" self-hosted 2026; forte em objetos, texto, layout; gera JSON de coordenadas/bounding boxes; melhor custo por VRAM |
| **Qwen2.5-VL 3B** | ~2-4 GB (roda até em Jetson) | Versão leve para hardware modesto/edge |
| **Qwen3-VL 8B / Gemma 4** | 16-24 GB VRAM | Estado da arte local, mais pesado |
| **Llama 3.2 Vision 11B** | GPU 8-16GB | Alternativa da Meta; qualidade decente, mas Qwen supera em benchmarks |
| **SmolVLM2 / Moondream** | Muito leve | Para hardware bem limitado |

Ferramentas de execução: **Ollama** (mais simples), **LM Studio** (interface amigável, arrasta imagem), **vLLM** (produção/performance). Qwen2.5-VL roda via Ollama até em CPU (3-8 tokens/s no 7B — lento mas funciona sem GPU).

**Vantagens do local:** custo por análise ZERO, dados nunca saem da loja (privacidade máxima), independe de internet, previsível. **Desvantagens:** exige hardware com GPU (investimento inicial), qualidade um pouco abaixo dos modelos de nuvem de ponta, mais trabalho de setup/manutenção.

### Recomendação de estratégia (híbrida)

A abordagem mais econômica e robusta é **híbrida em duas camadas**:

**Camada 1 — filtro local barato/grátis:** um modelo local (Qwen2.5-VL) ou detector leve (YOLO) roda o tempo todo filtrando "há algo que merece atenção?" (tem pessoa na zona? mudou o estado?). Custo zero por frame.

**Camada 2 — julgamento fino sob demanda:** só quando a camada 1 sinaliza algo relevante, envia para uma API de nuvem de qualidade (Gemini Flash para volume, Sonnet para casos críticos) para o veredito refinado. Assim você paga API só nos momentos que importam, não em cada frame.

Isso pode reduzir o custo operacional em 80-90% frente a mandar todo frame para a nuvem, mantendo alta qualidade nos vereditos que geram alerta.

---

## 6. Base de dados na nuvem

Armazenamento leve para os registros que importam (não é para guardar todo frame — isso incharia). O que vale persistir:

**Eventos de não-conformidade** — cada alerta gerado, com zona, controle, veredito, confiança, timestamp e link do snapshot.

**Eventos atípicos fora de turno** — para consulta e auditoria posterior.

**Histórico de conformidade** — série temporal por zona/controle para dashboards e relatórios de tendência (a limpeza está sendo feita no horário? a taxa de EPI melhorou?).

**Snapshots de alertas** — imagens dos momentos de não-conformidade (armazenamento de objetos/blob), com política de retenção (ex.: 30-90 dias) para controlar custo.

**Catálogo de zonas e controles** — a configuração em si, para backup e para a futura distribuição multi-loja.

Opções de tecnologia a avaliar (todas com camada gratuita/barata para começar): Postgres gerenciado (Supabase, Neon), Firebase/Firestore, ou o mesmo banco que o Regem já usa — o que evita mais um sistema. A escolha ideal é **reusar a infra do Regem** se possível, para centralizar.

---

## 7. Fiscalização da ação (não só do estado) — evolução v2

Ponto que você levantou: verificar não só "está limpo" mas "a limpeza está sendo feita corretamente" (esfregar, usar produto). Isso exige análise temporal, e o caminho é:

**v2a — sequência de frames:** em vez de 1 foto, o controle captura N frames numa janela (ex.: 1 a cada 10s por 3 min) e envia o conjunto para a IA avaliar junto: "houve ação de limpeza? a pessoa esfregou a superfície? usou produto/pano?". Viável e boa relação custo/benefício.

**v2b — presença e duração da ação:** verificar que alguém permaneceu na estação executando a tarefa pelo tempo esperado. Garante que a ação aconteceu, mesmo sem julgar a técnica fina.

**Limite honesto:** avaliar a *qualidade técnica* do movimento (direção, cobertura, tempo de contato de sanitizante — que é invisível na câmera) é caro e limitado. Recomenda-se mirar em "ação aconteceu + resultado ficou bom", que cobre a maior parte da necessidade de gestão.

---

## 8. Investimento em câmeras (melhorar a análise)

Os testes mostraram que o ângulo/resolução das câmeras atuais limita algumas análises (ex.: ver dentro do cesto de batata, avaliar a superfície da chapa). Câmeras melhores elevam diretamente a qualidade da IA. Diretrizes para o levantamento de compra:

**Resolução:** mínimo 4MP, idealmente 4K nas zonas críticas (chapa, montagem) — mais pixels = a IA enxerga detalhe (luva, resíduo, contagem de itens).

**Posicionamento:** ângulo que enxergue a área de interesse de perto (dentro do cesto, superfície da chapa), não só visão ampla de segurança. Pode exigir câmeras dedicadas por estação.

**Iluminação/sensor:** bom desempenho em pouca luz e contra vapor/gordura da cozinha.

**Compatibilidade:** manter padrão RTSP/ONVIF para integrar ao mesmo motor sem retrabalho.

**Estratégia faseada:** não trocar tudo de uma vez. Priorizar as zonas de maior valor (as prioridades definidas: limpeza, porções) e onde o teste mostrou limitação. Um levantamento de custo por câmera + instalação deve ser feito com fornecedor local; posso ajudar a montar a especificação técnica para cotação.

---

## 9. Estudo de DVRs para distribuição futura

Visão de produto distribuível: configs pré-definidas para os DVRs mais comuns do mercado, para que outras lojas instalem rápido.

**O que já sabemos (base para o catálogo):** o firmware **TVT** (usado no Motorola MTD161L0013, porta de servidor 6036) usa URL RTSP no formato `rtsp://user:senha@ip:554/chID={canal}&streamType=sub`. A permissão remota do usuário precisa estar ativa (aba "Remoto") ou o RTSP falha silenciosamente — aprendizado valioso e documentado.

**Levantamento a fazer** (perfis de RTSP por fabricante, para o catálogo): Intelbras (líder no Brasil), Hikvision, Dahua, Giga, Multilaser, e outros OEMs TVT/Xiongmai. Cada um tem seu padrão de URL, porta e peculiaridades de permissão. Montar uma tabela "fabricante → template RTSP → observações" que o instalador seleciona e já funciona.

Isso é a fundação de um **modo de distribuição**: um instalador escolhe o DVR na lista, o sistema aplica o template certo, e o cliente só cadastra as zonas e controles pela interface.

---

## 10. Roadmap sugerido (fases)

**Fase 0 — Concluída ✅**
Diagnóstico do DVR, RTSP funcionando, motor de análise validado ponta a ponta (câmera → IA → veredito correto com alta confiança).

**Fase 1 — Fechar o ciclo com o Regem (próximo passo)**
Conectar o webhook do n8n; calibrar critérios dos setores prioritários; ver o primeiro alerta chegar no Regem/WhatsApp ponta a ponta. Poucos controles, bem calibrados.

**Fase 2 — Interface de configuração (MVP)**
Aplicação local para cadastrar/editar zonas e controles sem código, com teste ao vivo. Integração do contexto de pico vindo do Regem.

**Fase 3 — Base de dados na nuvem + dashboards**
Persistência de eventos e histórico; dashboards de conformidade no Regem (gerente/presidente).

**Fase 4 — Otimização de custo (arquitetura híbrida)**
Introduzir a camada de filtro local (Qwen2.5-VL/YOLO) + API sob demanda; medir e reduzir custo operacional.

**Fase 5 — Fiscalização da ação (v2)**
Análise de sequência de frames para limpeza e processos com tempo.

**Fase 6 — Câmeras e escala**
Upgrade faseado de câmeras nas zonas críticas; refino contínuo.

**Fase 7 — Distribuição**
Catálogo de DVRs com configs pré-definidas; empacotamento para instalação em outras lojas.

---

## 11. Decisões em aberto (para definir)

Alguns pontos que valem decisão antes de avançar nas próximas fases:

**Motor de análise:** começar 100% nuvem (rápido, simples) e migrar para híbrido depois, ou já preparar o local desde a Fase 2? (Recomendação: começar nuvem, arquitetar para híbrido.)

**Hardware do mini PC:** definir se terá GPU desde já (habilita o local) ou começar sem (só nuvem). Depende da escolha acima.

**Banco de dados:** reusar a infra do Regem ou subir um serviço dedicado? (Recomendação: reusar o Regem.)

**Tecnologia da interface:** alinhar com o stack do Regem para reaproveitar e futuramente embutir como módulo.

---

*Documento vivo — atualizar a cada fase concluída.*
