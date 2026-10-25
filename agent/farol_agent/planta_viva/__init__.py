"""A planta viva (A26, partes P1 e P2): cada câmera calibrada pelos pontos do piso e as pessoas no mapa, sem nome.

- `calibracao`: a homografia imagem → piso, a mesma conta da nuvem (`api/src/calibracao.ts`), conferida pelo mesmo
  contrato (`contratos/calibracao-da-camera.json`).
- `pessoas`: de cada quadro, a pessoa → o pé → o ponto na planta; as câmeras juntas; o caminho sem nome; o calor por
  célula e o tempo em cada posto. Nasce DESLIGADO (`FAROL_PLANTA_VIVA`).
"""
