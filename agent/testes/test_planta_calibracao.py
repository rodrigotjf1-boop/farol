"""A calibração da câmera pelos pontos do piso, no agente (A26, P1): a mesma conta da nuvem, pelo mesmo contrato.

`contratos/calibracao-da-camera.json` vem de uma câmera SIMULADA (agent/ferramentas/contrato_calibracao.py): os pares e
os testes são a geometria de verdade. O que fica provado:

- com os pares exatos, cada ponto da imagem cai onde a geometria diz (a 1 mm);
- 4 pares bastam; com ruído, o erro de cada par e o conferido (deixando um de fora) são os do contrato;
- a área vista fecha em volta do chão marcado e para no alcance (a borda de cima pega o chão a ~18 m);
- pontos numa reta, ou três de quatro numa reta, não dão calibração.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from farol_agent.planta_viva import calibracao as cal

CONTRATO = json.loads((Path(__file__).resolve().parents[2] / "contratos" / "calibracao-da-camera.json").read_text(encoding="utf-8"))
TOL = CONTRATO["toleranciaM"]


def dentro(pt, poligono) -> bool:
    x, y = pt
    dentro_ = False
    for i in range(len(poligono)):
        x1, y1 = poligono[i]
        x2, y2 = poligono[(i + 1) % len(poligono)]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            dentro_ = not dentro_
    return dentro_


def test_com_os_pares_exatos_cada_ponto_cai_onde_a_geometria_diz():
    pares = cal.pares_de(CONTRATO["pares"])
    h = cal.homografia(pares)
    assert h is not None and math.isclose(math.hypot(*h), 1.0, abs_tol=1e-9), "norma 1"
    assert all(cal.lado_do_horizonte(h, p.img) > 0 for p in pares), "o chão marcado do lado positivo"
    for t in CONTRATO["testes"]:
        q = cal.projetar(h, tuple(t["img"]))
        assert q is not None and math.hypot(q[0] - t["piso"][0], q[1] - t["piso"][1]) < TOL, (t, q)
    for p in CONTRATO["bordaDeCimaAindaNoChao"]:
        assert cal.projetar(h, tuple(p)) is not None
    e = cal.erros_da_calibracao(pares, h)
    assert e.maximo_m <= TOL and e.conferido_maximo_m is not None and e.conferido_maximo_m <= TOL


def test_quatro_pares_bastam():
    quatro = cal.pares_de([CONTRATO["pares"][i] for i in (0, 2, 6, 8)])
    h = cal.homografia(quatro)
    assert h is not None
    for t in CONTRATO["testes"]:
        q = cal.projetar(h, tuple(t["img"]))
        assert math.hypot(q[0] - t["piso"][0], q[1] - t["piso"][1]) < 5 * TOL
    assert cal.erros_da_calibracao(quatro, h).conferido_por_par is None, "com 4 não há como deixar um de fora"


def test_com_ruido_os_erros_sao_os_do_contrato():
    pares = cal.pares_de(CONTRATO["comRuido"]["pares"])
    e = cal.erros_da_calibracao(pares, cal.homografia(pares))
    esperado = CONTRATO["comRuido"]["erros"]
    assert e.por_par == esperado["porPar"]
    assert (e.medio_m, e.maximo_m) == (esperado["medioM"], esperado["maximoM"])
    assert e.conferido_por_par == esperado["conferido"]["porPar"]
    assert (e.conferido_mediana_m, e.conferido_maximo_m) == (esperado["conferido"]["medianaM"], esperado["conferido"]["maximoM"])
    assert e.conferido_mediana_m > e.medio_m * 0.9, "o conferido não é mais otimista que o erro contra a própria conta"


def test_a_area_vista_fecha_em_volta_do_chao_marcado_e_para_no_alcance():
    pares = cal.pares_de(CONTRATO["pares"])
    h = cal.homografia(pares)
    area = cal.area_vista(h, pares)
    assert [list(p) for p in area] == CONTRATO["area"]
    for p in pares:
        assert dentro(p.piso, area), p
    cx = sum(p.piso[0] for p in pares) / len(pares)
    cy = sum(p.piso[1] for p in pares) / len(pares)
    longe = max(math.hypot(x - cx, y - cy) for x, y in area)
    assert cal.ALCANCE_DA_AREA - 0.05 < longe <= cal.ALCANCE_DA_AREA + 0.01, "a borda de cima é cortada no alcance"


@pytest.mark.parametrize("nome", ["numaReta", "tresDeQuatroNumaReta"])
def test_pontos_numa_reta_nao_dao_calibracao(nome):
    assert cal.homografia(cal.pares_de(CONTRATO["degenerados"][nome])) is None
    assert cal.homografia(cal.pares_de(CONTRATO["pares"][:3])) is None, "menos de 4"


def test_a_calibracao_desce_na_configuracao_do_canal(caplog):
    from testes.test_configuracao import resposta

    from farol_agent.configuracao import de_json

    h = cal.homografia(cal.pares_de(CONTRATO["pares"]))
    dados = resposta()
    dados["pontos"][0]["calibracao"] = {"homografia": h, "erroM": 0.026, "versao": 2}
    p = de_json(dados).pontos[0]
    assert p.homografia == h and p.erro_da_calibracao_m == 0.026
    assert de_json(resposta()).pontos[0].homografia is None, "nuvem antiga: sem calibração"
    torta = resposta()
    torta["pontos"][0]["calibracao"] = {"homografia": [1, 2, 3], "erroM": 0.1}
    with caplog.at_level("WARNING"):
        assert de_json(torta).pontos[0].homografia is None
    assert any("calibração" in r.getMessage() for r in caplog.records), "a torta é dita, e a configuração não cai"


def test_um_ponto_do_outro_lado_do_horizonte_nao_da_calibracao():
    # o mesmo chão, mas um ponto marcado no teto (acima do horizonte): a conta que o aceitasse poria o resto ao contrário
    pares = cal.pares_de(CONTRATO["pares"])
    h = cal.homografia(pares)
    assert cal.projetar(h, (0.5, -0.4)) is None, "acima do horizonte não cai no piso"
