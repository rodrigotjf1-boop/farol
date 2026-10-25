"""Gera `contratos/calibracao-da-camera.json` (A26, P1, 25/10/2026) a partir de uma câmera SIMULADA.

A câmera tem posição, direção, inclinação e lente conhecidas; os pontos do piso são projetados nela pela geometria da
câmera de furo (sem distorção). Assim o contrato confere as duas contas (`api/src/calibracao.ts` e
`farol_agent/planta_viva/calibracao.py`) contra a VERDADE da geometria — onde cada ponto da imagem cai no piso —, e não
uma contra a outra. Os erros com ruído e a área vista saem da conta do agente e a da nuvem tem de bater.

    python ferramentas/contrato_calibracao.py ../contratos/calibracao-da-camera.json
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from farol_agent.planta_viva import calibracao as cal  # noqa: E402

# A câmera: num canto da cozinha, a 2,6 m, olhando para um ponto do piso a uns 3,4 m; lente de 90° na horizontal,
# imagem 16:9. A borda de cima da imagem pega o chão a ~18 m (passa do alcance da área: o corte aparece).
CAMERA = np.array([1.4, 2.2, 2.6])
ALVO = np.array([3.0, 5.2, 0.0])
ABERTURA_H = 90.0
ASPECTO = 16 / 9


def _eixos():
    f = ALVO - CAMERA
    f = f / np.linalg.norm(f)
    direita = np.cross(f, [0.0, 0.0, 1.0])
    direita = direita / np.linalg.norm(direita)
    baixo = np.cross(f, direita)
    return direita, baixo, f


def imagem_de(x: float, y: float) -> tuple[float, float] | None:
    """Onde o ponto (x, y) do piso aparece na imagem normalizada; nulo atrás da câmera."""
    direita, baixo, frente = _eixos()
    d = np.array([x, y, 0.0]) - CAMERA
    z = float(d @ frente)
    if z <= 0:
        return None
    fx = 0.5 / math.tan(math.radians(ABERTURA_H / 2))
    fy = fx * ASPECTO
    return 0.5 + fx * float(d @ direita) / z, 0.5 + fy * float(d @ baixo) / z


def piso_de(u: float, v: float) -> tuple[float, float] | None:
    """O contrário: onde o raio do ponto (u, v) da imagem encontra o piso."""
    direita, baixo, frente = _eixos()
    fx = 0.5 / math.tan(math.radians(ABERTURA_H / 2))
    fy = fx * ASPECTO
    raio = frente + direita * (u - 0.5) / fx + baixo * (v - 0.5) / fy
    if raio[2] >= 0:
        return None
    t = -CAMERA[2] / raio[2]
    p = CAMERA + t * raio
    return float(p[0]), float(p[1])


def r6(n: float) -> float:
    return round(n, 6)


def main(destino: str) -> None:
    # pontos espalhados pela imagem; o piso arredondado ao centímetro, como quem mede com trena, e a imagem refeita
    # dele (o par fica exato)
    espalhados = [(0.12, 0.35), (0.5, 0.33), (0.88, 0.36), (0.1, 0.6), (0.48, 0.62), (0.9, 0.58), (0.15, 0.86),
                  (0.52, 0.88), (0.86, 0.84), (0.3, 0.47), (0.7, 0.74), (0.32, 0.95)]
    pisos = []
    for u, v in espalhados:
        p = piso_de(u, v)
        assert p is not None
        pisos.append((round(p[0], 2), round(p[1], 2)))
    pares = []
    for x, y in pisos:
        uv = imagem_de(x, y)
        assert uv is not None and 0.02 < uv[0] < 0.98 and 0.02 < uv[1] < 0.98, (x, y, uv)
        pares.append({"img": [r6(uv[0]), r6(uv[1])], "piso": [x, y]})

    testes = []
    for u, v in [(0.5, 0.5), (0.2, 0.8), (0.85, 0.7), (0.5, 0.95), (0.1, 0.4)]:
        p = piso_de(u, v)
        assert p is not None
        testes.append({"img": [u, v], "piso": [r6(p[0]), r6(p[1])]})
    acima = [[0.5, 0.0]]  # a borda de cima no meio: o chão a ~18 m, ainda à frente
    assert piso_de(0.5, 0.0) is not None

    # o ruído de quem marca com o mouse: alguns milésimos da imagem (fixo, para o contrato ser o mesmo sempre)
    desvios = [(0.003, -0.002), (-0.002, 0.001), (0.0, 0.003), (0.002, 0.002), (-0.003, 0.0), (0.001, -0.003),
               (0.002, 0.0), (-0.001, 0.002), (0.0, -0.002), (0.003, 0.001), (-0.002, -0.001), (0.001, 0.001)]
    com_ruido = [{"img": [r6(p["img"][0] + du), r6(p["img"][1] + dv)], "piso": p["piso"]}
                 for p, (du, dv) in zip(pares, desvios)]
    pr = cal.pares_de(com_ruido)
    h = cal.homografia(pr)
    assert h is not None
    e = cal.erros_da_calibracao(pr, h)

    exatos = cal.pares_de(pares)
    h_exata = cal.homografia(exatos)
    assert h_exata is not None
    area = cal.area_vista(h_exata, exatos)

    contrato = {
        "_": [
            "A calibração de cada câmera pelos pontos do piso (A26, P1). Gerado por agent/ferramentas/contrato_calibracao.py",
            "de uma câmera SIMULADA (posição, direção e lente conhecidas, sem distorção): os pares e os testes são a",
            "geometria de verdade. Lido por api/testes/calibracao.test.ts e agent/testes/test_planta_calibracao.py.",
            "Mudou a conta de um lado? Gere de novo e o outro lado tem de acompanhar.",
        ],
        "camera": {"posicao": CAMERA.tolist(), "alvo": ALVO.tolist(), "aberturaH": ABERTURA_H, "aspecto": "16:9"},
        "pares": pares,
        "testes": testes,
        "toleranciaM": 0.001,
        "bordaDeCimaAindaNoChao": acima,
        "comRuido": {
            "pares": com_ruido,
            "erros": {
                "porPar": e.por_par, "medioM": e.medio_m, "maximoM": e.maximo_m,
                "conferido": {"porPar": e.conferido_por_par, "medianaM": e.conferido_mediana_m,
                              "maximoM": e.conferido_maximo_m},
            },
        },
        "area": [list(p) for p in area],
        "degenerados": {
            "numaReta": [{"img": [0.1 + 0.2 * i, 0.5], "piso": [1.0 + i, 3.0]} for i in range(5)],
            "tresDeQuatroNumaReta": [{"img": [0.1, 0.5], "piso": [1.0, 3.0]}, {"img": [0.3, 0.5], "piso": [2.0, 3.0]},
                                     {"img": [0.5, 0.5], "piso": [3.0, 3.0]}, {"img": [0.4, 0.9], "piso": [2.5, 1.5]}],
        },
    }
    Path(destino).write_text(json.dumps(contrato, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"ok: {len(pares)} pares, {len(testes)} testes, área com {len(area)} pontos; com ruído: "
          f"médio {e.medio_m} m, conferido {e.conferido_mediana_m} m (máx {e.conferido_maximo_m} m)")


if __name__ == "__main__":
    main(sys.argv[1])
