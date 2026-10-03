# Monitor de Tarefas da Hamburgueria — Guia de Instalação

Protótipo que captura imagens do DVR Motorola MTD161L0013 via RTSP, analisa a execução de tarefas com IA (Claude, API Anthropic) e envia alertas no Telegram quando algo está fora do padrão.

## Etapa 1 — Preparar o DVR

Acesse o menu do DVR com o mouse e faça três coisas. Primeiro, em Rede (Network), defina um IP fixo (exemplo: 192.168.1.108) em vez de DHCP, para o endereço nunca mudar. Segundo, confirme que a porta RTSP 554 está habilitada (Rede > Portas ou Avançado). Terceiro, em Sistema > Usuários, crie um usuário exclusivo chamado `monitor` com permissão apenas de visualização remota, e anote a senha.

## Etapa 2 — Descobrir a URL RTSP do seu firmware

No computador, instale o VLC (videolan.org). Abra Mídia > Abrir Transmissão de Rede e teste as URLs abaixo, substituindo usuário, senha e IP pelos seus:

```
rtsp://monitor:SENHA@192.168.1.108:554/chID=1&streamType=main
rtsp://192.168.1.108:554/user=monitor&password=SENHA&channel=1&stream=0.sdp?
rtsp://monitor:SENHA@192.168.1.108:554/Streaming/Channels/101
rtsp://monitor:SENHA@192.168.1.108:554/cam/realmonitor?channel=1&subtype=0
```

Quando uma delas mostrar a imagem, anote qual foi. No arquivo `config.yaml`, deixe ativo o `url_rtsp_template` correspondente (opções A, B ou C já comentadas lá) e ajuste para o sub-stream (mais leve): `streamType=sub`, `stream=1` ou canal `102`, conforme o padrão.

## Etapa 3 — Criar o bot do Telegram

No Telegram, fale com o @BotFather e envie `/newbot`. Escolha um nome e guarde o token gerado (formato `123456:ABC...`). Depois fale com o @userinfobot para descobrir seu `chat_id`. Envie uma mensagem qualquer para o seu bot recém-criado (isso o autoriza a te responder). Coloque token e chat_id no `config.yaml`.

## Etapa 4 — Obter a chave da API Anthropic

Crie uma conta em https://console.anthropic.com, gere uma API key e adicione créditos. O custo por análise de frame é de centavos; com verificação a cada 5 minutos em 4 tarefas, o gasto mensal tende a ficar baixo — acompanhe no painel do console. Documentação da API: https://docs.claude.com/en/api/overview

## Etapa 5 — Instalar e rodar

No computador de monitoramento (Windows, Linux ou Mac) com Python 3.10+:

```bash
cd monitor-loja
pip install -r requirements.txt

# Linux/Mac:
export ANTHROPIC_API_KEY="sua-chave-aqui"
# Windows (PowerShell):
$env:ANTHROPIC_API_KEY="sua-chave-aqui"

python monitor_loja.py
```

O script roda em loop: a cada ciclo (padrão 5 minutos), verifica cada tarefa que estiver dentro da janela de horário, captura um frame do canal correspondente, envia para análise e alerta no Telegram (com foto) se o resultado for "não conforme" com confiança suficiente. Todo veredito fica registrado em `historico.jsonl` e as fotos dos alertas em `snapshots/`.

## Etapa 6 — Ajustar as tarefas

Edite a seção `tarefas` do `config.yaml`. Cada tarefa tem o canal da câmera, uma janela de horário opcional e um `criterio` escrito em linguagem natural descrevendo o que é "conforme". Já deixei quatro exemplos prontos (EPI na chapa, limpeza de bancada, porta da câmara fria, fila no balcão) — ajuste os textos para a realidade da sua loja. Quanto mais específico o critério, melhor o resultado. Comece com 2 ou 3 tarefas, observe os vereditos no `historico.jsonl` por alguns dias e vá calibrando os critérios e a `confianca_minima` antes de confiar nos alertas.

## Dicas e problemas comuns

Se a captura falhar, teste a URL exata no VLC de novo — caracteres especiais na senha (@, :, /) precisam ser codificados na URL (por exemplo, @ vira %40). Se os vereditos vierem "indeterminado" com frequência, a câmera pode estar longe demais ou escura — melhore o enquadramento ou a iluminação da área. Para rodar 24h, configure o script como serviço (systemd no Linux) ou use o Agendador de Tarefas do Windows para reiniciá-lo no boot.

## Próximos passos possíveis

Quando o básico estiver validado: comparação de frames antes/depois para tarefas de limpeza, verificação de sequência (a tarefa X ocorreu após a Y?), dashboard web com histórico de conformidade por funcionário/turno, e detecção local com YOLO para filtrar frames (reduzindo custo de API).
