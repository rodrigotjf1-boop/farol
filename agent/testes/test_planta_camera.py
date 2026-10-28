"""A câmera inteira tirada da homografia do chão (A26, rastreio firme): contra a câmera SIMULADA do contrato
(`ferramentas/contrato_calibracao.py`), que tem posição, alvo e lente conhecidos — a conta tem de achar a verdade."""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

from farol_agent.planta_viva import calibracao as cal
from farol_agent.planta_viva import camera as cm
from ferramentas import contrato_calibracao as sim

CONTRATO = json.loads((Path(__file__).resolve().parents[2] / "contratos" / "calibracao-da-camera.json").read_text(encoding="utf-8"))
H = cal.homografia(cal.pares_de(CONTRATO["pares"]))


def imagem_na_altura(x: float, y: float, z: float) -> tuple[float, float]:
    """Onde o ponto (x, y, z) aparece na imagem da câmera simulada."""
    direita, baixo, frente = sim._eixos()
    d = np.array([x, y, z]) - sim.CAMERA
    zc = float(d @ frente)
    fx = 0.5 / math.tan(math.radians(sim.ABERTURA_H / 2))
    return 0.5 + fx * float(d @ direita) / zc, 0.5 + fx * sim.ASPECTO * float(d @ baixo) / zc


def test_acha_a_posicao_a_altura_e_a_lente_da_camera():
    c = cm.camera_da_homografia(H)
    assert c is not None
    # o piso do contrato foi arredondado ao centímetro (como quem mede com trena): a câmera sai a poucos centímetros
    assert math.hypot(c.centro[0] - sim.CAMERA[0], c.centro[1] - sim.CAMERA[1]) < 0.05
    assert abs(c.altura - sim.CAMERA[2]) < 0.05
    fx = 0.5 / math.tan(math.radians(sim.ABERTURA_H / 2))
    assert abs(c.foco - fx * sim.ASPECTO) / (fx * sim.ASPECTO) < 0.02, "o foco, em alturas de imagem"


def test_a_cabeca_vira_posicao_no_piso():
    c = cm.camera_da_homografia(H)
    for x, y in [(2.5, 4.4), (3.5, 6.0), (1.8, 5.2), (4.2, 7.5)]:
        uv = imagem_na_altura(x, y, cm.ALTURA_DA_CABECA)
        p = cm.ponto_na_altura(c, uv, cm.ALTURA_DA_CABECA)
        assert p is not None and math.hypot(p[0] - x, p[1] - y) < 0.08, (x, y, p)
        # e o pé, pelo mesmo caminho, bate com a homografia
        pe = cm.ponto_na_altura(c, imagem_na_altura(x, y, 0.0), 0.0)
        assert pe is not None and math.hypot(pe[0] - x, pe[1] - y) < 0.05


def test_a_confianca_na_cabeca_cai_com_a_diferenca_para_a_altura_medida():
    c = cm.camera_da_homografia(H)
    assert cm.confianca_da_cabeca(c, None) == 1.0
    assert cm.confianca_da_cabeca(c, float(sim.CAMERA[2])) > 0.97
    assert abs(cm.confianca_da_cabeca(c, c.altura / 1.2) - 0.5) < 0.06, "20% de diferença: meia confiança"
    assert cm.confianca_da_cabeca(c, c.altura / 1.5) == 0.0


def test_o_que_nao_e_camera_fica_de_fora():
    assert cm.camera_da_homografia([0, 0, 0, 0, 0, 0, 0, 0, 1]) is None
    c = cm.camera_da_homografia(H)
    # acima da câmera não se chega olhando para baixo
    assert cm.ponto_na_altura(c, (0.5, 0.9), c.altura + 0.5) is None
