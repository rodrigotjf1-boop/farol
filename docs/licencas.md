# Licenças — o que pode e o que mata o produto

O Farol é **distribuído** e instalado em loja de cliente. Isso restringe o que
pode ser embutido: só **MIT, Apache 2.0 e BSD**. Verificar a cada dependência
nova, no mesmo trabalho em que ela entra.

## As seis armadilhas mapeadas

| Dependência | Licença | Por que mata |
|---|---|---|
| **Ultralytics YOLO** (v8/11/12/26) | AGPL-3.0 | Alcança código, pesos **e arquitetura**, inclusive em pesquisa interna. Enterprise é preço fechado sob consulta. **Usar RF-DETR Nano/Small (Apache 2.0)** |
| **jina-clip-v2** | CC-BY-NC-4.0 | Proíbe uso comercial — e é o que o Frigate oferece na busca semântica. **Usar SigLIP 2 (Apache 2.0)**, que é melhor e limpo |
| **n8n** | Sustainable Use | Proíbe revenda, white-label e hospedagem paga. **Usar Node-RED (Apache 2.0)** |
| **Pesos do YOLO-NAS** | non-commercial | A arquitetura é Apache, os pesos não. E a NVIDIA não emite mais licença comercial |
| **Imagem Docker do Frigate** | embute FFmpeg `--enable-gpl` | Redistribuir a imagem cria obrigação GPL de fornecer o fonte. **Build LGPL próprio** |
| **Redis 7.4+** | RSALv2 / SSPL | **Usar Valkey (BSD-3)** — drop-in, sem motivo para o Redis |
| **tldraw** (SDK 4.0+) | comercial paga em produção | Tentador para o editor de polígono da zona. **Usar Konva.js ou SVG (MIT)** |

## Pilha aprovada

| Camada | Escolha | Licença |
|---|---|---|
| Captura e proxy | go2rtc · MediaMTX | MIT |
| Decodificação | FFmpeg em build LGPL próprio, link dinâmico, sem x264/x265 | LGPL-2.1+ |
| Detector | RF-DETR Nano/Small via OpenVINO | Apache 2.0 |
| Embedding | SigLIP 2 ViT-B | Apache 2.0 |
| Modelo local | Qwen3.5-9B / 27B · Intern-Decision-2B | Apache 2.0 |
| Servidor de modelo | vLLM | Apache 2.0 |
| Entrega de alerta | Node-RED | Apache 2.0 |
| Banco e índice | PostgreSQL + pgvector | PostgreSQL License |
| Fila e cache | Valkey | BSD-3 |
| ONVIF | agsh/onvif (Node) · onvif-python | MIT |
| Editor de polígono | Konva.js | MIT |
| Serviço Windows | WinSW | MIT |

## Driver NVIDIA — restrição concreta no instalador

Seção 2.7 do EULA: *"you may not sell, rent, sublicense, distribute or transfer
the SOFTWARE"*. **O instalador não pode embutir o driver** — tem que orientar o
download no site da NVIDIA.

A licença do **NVIDIA AI Enterprise** (US$ 4.500/GPU/ano, mínimo 4 GPUs) **não é
necessária**: vLLM com pesos Apache 2.0 tem custo de licença zero. Ela só compra
o container NIM, SLA e suporte.
