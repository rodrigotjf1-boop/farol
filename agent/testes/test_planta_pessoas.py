"""As pessoas na planta, sem nome (A26, P2): o pé, o ponto no chão com a incerteza, as câmeras juntas, o caminho e o
minuto que sobe. As caixas das pessoas vêm da câmera SIMULADA do contrato (`ferramentas/contrato_calibracao.py`): o pé
de quem está em (x, y) no chão aparece onde a geometria diz.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from farol_agent.planta_viva import calibracao as cal
from farol_agent.planta_viva import pessoas as pv
from ferramentas.contrato_calibracao import imagem_de

CONTRATO = json.loads((Path(__file__).resolve().parents[2] / "contratos" / "calibracao-da-camera.json").read_text(encoding="utf-8"))
H = cal.homografia(cal.pares_de(CONTRATO["pares"]))
L, A = 704, 396  # o fluxo reduzido, 16:9


def caixa_de_quem_esta_em(x: float, y: float, nota: float = 0.9, altura_px: float = 120) -> list[float]:
    u, v = imagem_de(x, y)
    return [u * L - 18, v * A - altura_px, u * L + 18, v * A, nota]


def test_o_pe_e_o_meio_da_base_e_a_caixa_cortada_embaixo_fica_de_fora():
    assert pv.pe_da_caixa([100, 50, 140, 300, 0.9], 704, 396) == pytest.approx((120 / 704, 300 / 396))
    assert pv.pe_da_caixa([100, 50, 140, 395, 0.9], 704, 396) is None, "o pé está abaixo do quadro"


def test_quem_esta_no_chao_cai_no_lugar_e_a_incerteza_cresce_com_a_distancia():
    perto = pv.vistas_do_canal("c1", H, 0.03, [caixa_de_quem_esta_em(2.5, 4.4)], L, A)
    longe = pv.vistas_do_canal("c1", H, 0.03, [caixa_de_quem_esta_em(1.5, 8.0)], L, A)
    assert len(perto) == len(longe) == 1
    assert (perto[0].x, perto[0].y) == pytest.approx((2.5, 4.4), abs=0.01)
    assert (longe[0].x, longe[0].y) == pytest.approx((1.5, 8.0), abs=0.01)
    assert 0.03 < perto[0].sigma < longe[0].sigma, "longe da câmera, um pixel é mais chão"
    pe = pv.pe_da_caixa(caixa_de_quem_esta_em(2.5, 4.4), L, A)
    assert pv.incerteza(H, pe, 0.10) == pytest.approx(pv.incerteza(H, pe, 0.0) + 0.10, abs=0.002), "o erro da calibração soma"
    assert pv.incerteza(H, (0.5, -0.4), 0.03) is None, "acima do horizonte não há chão"


def test_nota_baixa_e_fora_da_planta_nao_contam():
    caixas = [caixa_de_quem_esta_em(2.5, 4.4, nota=0.4), caixa_de_quem_esta_em(3.5, 5.5)]
    assert len(pv.vistas_do_canal("c1", H, 0.03, caixas, L, A)) == 1
    assert pv.vistas_do_canal("c1", H, 0.03, [caixa_de_quem_esta_em(3.5, 5.5)], L, A, limites=(0, 0, 3, 5)) == []


def test_as_cameras_juntas_a_que_ve_de_perto_manda_e_a_mesma_camera_nunca_junta():
    a = pv.Vista("c1", 2.0, 3.0, 0.05, 0.9)
    b = pv.Vista("c2", 2.3, 3.0, 0.20, 0.9)
    (p,) = pv.juntar([a, b])
    assert p.canais == ("c1", "c2") and 2.0 < p.x < 2.05 and p.sigma < 0.05
    assert len(pv.juntar([a, pv.Vista("c1", 2.3, 3.0, 0.05, 0.9)])) == 2, "duas da mesma câmera: duas pessoas"
    assert len(pv.juntar([a, pv.Vista("c2", 3.0, 3.0, 0.05, 0.9)])) == 2, "longe: duas pessoas"


def test_o_caminho_segue_cada_um_sem_nome_e_recomeca_no_dia_seguinte():
    r = pv.Rastreador()
    pessoa = lambda x, y: pv.Pessoa(x, y, 0.05, ("c1",))  # noqa: E731
    numeros = set()
    for s in range(10):
        saida = r.passo(float(s), [pessoa(1.0 + 0.5 * s, 2.0), pessoa(6.0 - 0.5 * s, 2.6)])
        numeros.add(tuple(n for n, _, _ in saida))
    assert numeros == {(1, 2)}, "cada um com o mesmo número o tempo todo, mesmo se cruzando"
    assert r.passo(20.0, [pessoa(5.5, 2.0)])[0][0] == 3, "sumiu por mais que a perda: caminho novo"
    assert r.passo(21.0, [pessoa(9.0, 9.0)])[0][0] == 4, "longe demais para ter andado em 1 s: outra pessoa"
    assert r.passo(22.0, [pessoa(9.0, 9.0)], dia="2026-10-26")[0][0] == 1, "o número recomeça no dia"


def test_o_minuto_que_sobe_calor_pico_e_caminho_a_1_por_segundo():
    m = pv.Minutos()
    t0 = datetime(2026, 10, 25, 22, 10, 0, tzinfo=timezone.utc)
    for k in range(4):  # 2 quadros por segundo, 2 s
        m.somar(t0 + timedelta(seconds=k * 0.5), 0.5, [(1, 1.0, 1.4), (2, 5.0, 5.0)])
    assert m.fechados(t0 + timedelta(seconds=30)) == [], "o minuto ainda não acabou"
    m.somar(t0 + timedelta(minutes=1), 0.5, [(1, 1.0, 1.4)])
    (fechado,) = m.fechados(t0 + timedelta(minutes=1, seconds=1))
    assert fechado["minuto"] == "2026-10-25T22:10:00+00:00" and fechado["pico"] == 2 and "postos" not in fechado
    assert [4, 5, 2.0] in fechado["calor"] and [20, 20, 2.0] in fechado["calor"]
    assert fechado["caminhos"] == [[1, [[0, 1.0, 1.4], [1, 1.0, 1.4]]], [2, [[0, 5.0, 5.0], [1, 5.0, 5.0]]]]
    assert len(m.fechados(t0 + timedelta(minutes=5))) == 1, "o minuto seguinte, uma vez só"


def test_o_minuto_tem_o_formato_do_contrato():
    contrato = json.loads((Path(__file__).resolve().parents[2] / "contratos" / "planta-viva-minuto.json").read_text(encoding="utf-8"))
    m = pv.Minutos()
    t0 = datetime(2026, 10, 25, 22, 10, 0, tzinfo=timezone.utc)
    m.somar(t0, 0.5, [(1, 1.0, 1.4)])
    (fechado,) = m.fechados(t0 + timedelta(minutes=1))
    assert list(fechado) == contrato["chavesDoMinuto"]
    exemplo = contrato["minuto"]
    assert fechado["minuto"] == exemplo["minuto"] and fechado["celulaM"] == exemplo["celulaM"]
    assert all(len(c) == 3 for c in fechado["calor"]) and all(len(p) == 3 for _, pts in fechado["caminhos"] for p in pts)


def test_o_minuto_sai_dentro_do_que_a_nuvem_aceita():
    """ERR-158 (28/10/2026): um ponto negativo recusava o LOTE inteiro na nuvem (422), e o lote nunca passava."""
    m = pv.Minutos()
    t0 = datetime(2026, 10, 28, 22, 10, 0, tzinfo=timezone.utc)
    m.somar(t0, 0.5, [(1, 4.0, -0.3), (2, 4.0, 0.0), (3, -0.01, 2.0), (4, 250.0, 1.0), (5, float("nan"), 1.0)])
    for k in range(70):  # 70 caminhos no mesmo minuto: a nuvem aceita até 60
        m.somar(t0 + timedelta(seconds=1 + k * 0.5), 0.5, [(100 + k, 1.0, 1.0)] + ([(7, 2.0, 2.0)] if k < 30 else []))
    (fechado,) = m.fechados(t0 + timedelta(minutes=1))
    numeros = [n for n, _ in fechado["caminhos"]]
    assert 1 not in numeros and 3 not in numeros and 4 not in numeros and 5 not in numeros, "o de fora fica de fora"
    assert 2 in numeros and 7 in numeros, "a beira (0,0) vale; o caminho mais longo fica"
    assert len(numeros) == pv.MAXIMO_NA_NUVEM and numeros == sorted(numeros)
    assert all(i >= 0 and j >= 0 for i, j, _ in fechado["calor"]) and fechado["pico"] <= pv.MAXIMO_NA_NUVEM
