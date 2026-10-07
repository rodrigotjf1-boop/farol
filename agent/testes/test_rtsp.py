"""O leitor contínuo e a armadilha do buffer.

`cv2.VideoCapture` acumula quadros. Quem abre e lê de vez em quando
recebe o que estava na fila, não o de agora — e num alerta de cozinha
isso significa julgar uma cena que já passou. O quadro parece bom, o
veredito parece razoável, e está errado por trinta segundos.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import numpy as np

from farol_agent.fontes.rtsp import _LeitorContinuo


def leitor_com(quando, imagem=None):
    l = _LeitorContinuo("rtsp://irrelevante", "teste")
    l._ultimo = (quando, imagem if imagem is not None else np.zeros((4, 4, 3), np.uint8))
    return l


def test_quadro_recente_e_entregue():
    l = leitor_com(datetime.now())
    assert l.ultimo(idade_maxima_seg=5) is not None


def test_quadro_velho_e_recusado():
    """Entregar quadro de dez segundos atrás como se fosse de agora
    produz veredito sobre cena que já passou."""
    l = leitor_com(datetime.now() - timedelta(seconds=10))
    assert l.ultimo(idade_maxima_seg=5) is None


def test_sem_quadro_nenhum_devolve_none():
    l = _LeitorContinuo("rtsp://irrelevante", "teste")
    assert l.ultimo() is None


def test_a_idade_limite_e_configuravel():
    l = leitor_com(datetime.now() - timedelta(seconds=3))
    assert l.ultimo(idade_maxima_seg=5) is not None
    assert l.ultimo(idade_maxima_seg=1) is None


def test_parar_sem_ter_iniciado_nao_estoura():
    _LeitorContinuo("rtsp://irrelevante", "teste").parar()


def test_transporte_tcp_configurado_antes_do_ffmpeg():
    """O padrão do FFmpeg é UDP, que perde pacote e rasga quadro — e
    quadro rasgado é justamente o que estraga julgamento por imagem."""
    import os

    assert "rtsp_transport;tcp" in os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"]


# ───────────── canal que não responde não segura os outros ─────────────
#
# Na loja, em 07/10/2026: um canal cadastrado com o endereço antigo do
# gravador levava 30 s para desistir a cada tentativa, e nesse tempo nenhum
# outro canal abria — o OpenCV abre um fluxo de cada vez.


def _porta_fechada() -> int:
    """Uma porta em que ninguém atende: conexão recusada na hora."""
    import socket

    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    porta = s.getsockname()[1]
    s.close()
    return porta


def test_alcanca_diz_se_alguem_atende():
    import socket

    from farol_agent.fontes.rtsp import alcanca

    ouvindo = socket.socket()
    ouvindo.bind(("127.0.0.1", 0))
    ouvindo.listen(1)
    try:
        assert alcanca("127.0.0.1", ouvindo.getsockname()[1]) is True
    finally:
        ouvindo.close()
    assert alcanca("127.0.0.1", _porta_fechada()) is False


def test_gravador_que_nao_responde_NEM_chega_ao_opencv(monkeypatch):
    import time

    from farol_agent.fontes import rtsp

    chamadas = []
    monkeypatch.setattr(rtsp, "_abrir", lambda url: chamadas.append(url))

    l = rtsp._LeitorContinuo("rtsp://irrelevante", "teste", ("127.0.0.1", _porta_fechada()))
    l.iniciar()
    inicio = time.monotonic()
    while l.ultimo_erro is None and time.monotonic() - inicio < 5:
        time.sleep(0.05)
    l.parar()

    assert chamadas == [], "abrir no OpenCV prenderia a fila dos outros canais"
    assert l.ultimo_erro == "o gravador não respondeu na rede"
    assert l.reconexoes >= 1
    assert time.monotonic() - inicio < 5, "tem que desistir em segundos, não em 30"


def test_o_aviso_de_canal_fora_do_ar_sai_UMA_vez(monkeypatch, caplog):
    import logging
    import time

    from farol_agent.fontes import rtsp

    monkeypatch.setattr(rtsp, "_abrir", lambda url: None)
    l = rtsp._LeitorContinuo("rtsp://irrelevante", "bancada", ("127.0.0.1", _porta_fechada()))
    with caplog.at_level(logging.WARNING, logger="farol_agent.fontes.rtsp"):
        for _ in range(4):
            l._falhou("o gravador não respondeu na rede")
        time.sleep(0)

    avisos = [r for r in caplog.records if "não respondeu" in r.getMessage()]
    assert len(avisos) == 1, "um aviso por tentativa afogaria o log"
    assert l.reconexoes == 4


def test_quando_o_canal_volta_o_erro_some(monkeypatch):
    import socket
    import time

    from farol_agent.fontes import rtsp

    class CapFalso:
        def isOpened(self):   # noqa: N802 — nome do OpenCV
            return True

        def read(self):
            time.sleep(0.01)
            return True, np.zeros((4, 4, 3), np.uint8)

        def release(self):
            pass

    ouvindo = socket.socket()
    ouvindo.bind(("127.0.0.1", 0))
    ouvindo.listen(5)
    monkeypatch.setattr(rtsp, "_abrir", lambda url: CapFalso())
    try:
        l = rtsp._LeitorContinuo("rtsp://irrelevante", "teste", ("127.0.0.1", ouvindo.getsockname()[1]))
        l.ultimo_erro = "o gravador não respondeu na rede"
        l._avisou = True
        l.iniciar()
        inicio = time.monotonic()
        while l.ultimo() is None and time.monotonic() - inicio < 5:
            time.sleep(0.02)
        l.parar()
    finally:
        ouvindo.close()

    assert l.ultimo() is not None
    assert l.ultimo_erro is None


def test_o_fluxo_principal_tambem_desiste_rapido(monkeypatch):
    import time

    import pytest

    from farol_agent.fontes import rtsp

    monkeypatch.setattr(rtsp, "_abrir", lambda url: pytest.fail("não podia chamar o OpenCV"))
    fonte = rtsp.FonteRTSP(
        "p1", "rtsp://irrelevante", abrir_sub=False, alcance=("127.0.0.1", _porta_fechada())
    )

    inicio = time.monotonic()
    with pytest.raises(rtsp.ErroDaFonte, match="não respondeu na rede"):
        fonte.rajada(datetime.now(), quantidade=1)
    assert time.monotonic() - inicio < 5


def test_sem_endereco_conhecido_abre_como_sempre(monkeypatch):
    # Câmera USB, arquivo, URL pronta: não há o que perguntar à rede.
    from farol_agent.fontes import rtsp

    class CapFechado:
        def isOpened(self):   # noqa: N802
            return False

        def release(self):
            pass

    chamadas = []
    monkeypatch.setattr(rtsp, "_abrir", lambda url: chamadas.append(url) or CapFechado())
    fonte = rtsp.FonteRTSP("p1", "rtsp://irrelevante", abrir_sub=False)

    try:
        fonte.rajada(datetime.now(), quantidade=1)
    except rtsp.ErroDaFonte:
        pass
    assert chamadas == ["rtsp://irrelevante"]


def test_o_opencv_e_avisado_para_desistir_em_5_segundos(monkeypatch):
    import cv2

    from farol_agent.fontes import rtsp

    visto = {}

    class Cap:
        def __init__(self, url, api, parametros=None):
            visto["parametros"] = parametros

        def set(self, *a):
            return True

    monkeypatch.setattr(cv2, "VideoCapture", Cap)

    rtsp._abrir("rtsp://irrelevante")

    p = visto["parametros"]
    assert p is not None, "sem os limites o OpenCV espera 30 s"
    pares = dict(zip(p[0::2], p[1::2]))
    assert pares[int(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC)] == 5000
    assert pares[int(cv2.CAP_PROP_READ_TIMEOUT_MSEC)] == 5000
