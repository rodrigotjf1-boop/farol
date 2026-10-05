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
