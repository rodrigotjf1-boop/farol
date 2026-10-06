"""Recorte da zona, máscara, borrão de rosto e redimensionamento.

A ordem importa e não é arbitrária:

    1. recorta a zona      — reduz o que trafega e preserva o detalhe
    2. borra o rosto       — mitigação de LGPD de graça, antes de sair da loja
    3. redimensiona        — o maior fator isolado de custo

Redimensionar antes de recortar jogaria fora justamente o detalhe que se pagou
na câmera.
"""

from __future__ import annotations

import cv2
import numpy as np

from farol_agent.modelos import Frame, Zona


def recortar_zona(
    frame: Frame, zona: Zona, margem: float = 0.05, mascarar: bool = False
) -> Frame:
    """Recorta o retângulo da zona, opcionalmente mascarando fora do polígono.

    `mascarar=True` escurece o que está fora do polígono dentro do retângulo.
    Ajuda o modelo a não se distrair com o que está ao lado, mas tira contexto —
    deixe desligado por padrão e ligue por regra, medindo a diferença.
    """
    x1, y1, x2, y2 = zona.bbox(frame.largura, frame.altura, margem)
    if x2 <= x1 or y2 <= y1:
        return frame

    recorte = frame.imagem[y1:y2, x1:x2].copy()

    if mascarar:
        h, w = recorte.shape[:2]
        pts = np.array(
            [
                [
                    int(px * frame.largura) - x1,
                    int(py * frame.altura) - y1,
                ]
                for px, py in zona.poligono
            ],
            dtype=np.int32,
        )
        mascara = np.zeros((h, w), dtype=np.uint8)
        cv2.fillPoly(mascara, [pts], 255)
        escurecido = (recorte * 0.25).astype(np.uint8)
        recorte = np.where(mascara[:, :, None] > 0, recorte, escurecido)

    return frame.copia_com(recorte)


def redimensionar(frame: Frame, lado_maior: int) -> Frame:
    """Reduz para que o maior lado tenha `lado_maior` pixels.

    Nunca amplia: aumentar não cria detalhe, só custo de token.
    """
    h, w = frame.imagem.shape[:2]
    atual = max(h, w)
    if atual <= lado_maior:
        return frame
    escala = lado_maior / atual
    novo = cv2.resize(
        frame.imagem,
        (max(1, int(w * escala)), max(1, int(h * escala))),
        interpolation=cv2.INTER_AREA,
    )
    return frame.copia_com(novo)


def px_por_cm(largura_px: int, largura_cena_cm: float) -> float:
    """Pixels por centímetro na imagem que chega ao modelo.

    É o número que decide se a regra funciona — não o megapixel da câmera.
    Uma câmera de 8 MP longe perde para uma de 2 MP perto.

    Referência: a montagem item a item exige ~12,8 px/cm, o que dá 38 px num
    picles de 3 cm. Regra de estado comum se resolve com 3 px/cm.
    """
    if largura_cena_cm <= 0:
        return 0.0
    return largura_px / largura_cena_cm


def lente_para_enquadrar(
    distancia_cm: float, largura_cena_cm: float, sensor_mm: float = 5.0
) -> float:
    """Distância focal em mm para enquadrar `largura_cena_cm` a `distancia_cm`.

        largura = distância × largura_do_sensor ÷ focal

    Sensor de 1/2.8" tem ~5,0 mm de largura útil; 1/2.7", ~5,37 mm.

    A 85 cm, enquadrar 50 cm pede 8,5 mm; enquadrar 100 cm pede 4,25 mm. A
    lente padrão de 2,8 mm enquadra 152 cm — larga demais para inspeção.
    """
    if largura_cena_cm <= 0:
        return 0.0
    return distancia_cm * sensor_mm / largura_cena_cm


import logging
import os
from contextlib import contextmanager
from pathlib import Path

_log = logging.getLogger(__name__)

# Detector resolvido na primeira chamada e guardado. `False` significa
# "já procurei e não há detector" — evita tentar de novo a cada quadro.
_detector: object | None = None
_avisou = False

# YuNet: Apache 2.0, ~340 KB, do OpenCV Zoo. Baixar para `modelos/`.
_MODELO_YUNET = "face_detection_yunet_2023mar.onnx"


def _pastas_de_modelo() -> list[Path]:
    env = os.environ.get("FAROL_MODELOS")
    pastas = [Path(env)] if env else []
    pastas.append(Path(__file__).resolve().parent.parent / "modelos")
    pastas.append(Path.cwd() / "modelos")
    return pastas


def _obter_detector():
    """Resolve o detector de rosto disponível nesta instalação.

    OpenCV 5 removeu `CascadeClassifier` do módulo principal e oferece o
    `FaceDetectorYN`, que é melhor mas exige arquivo de modelo. OpenCV 4 tem
    os dois. O agente roda nas duas versões, então tenta na ordem e aceita
    não ter nenhum.
    """
    global _detector, _avisou
    if _detector is not None:
        return _detector or None

    # 1 · YuNet (OpenCV >= 4.5.4), se o modelo estiver presente
    if hasattr(cv2, "FaceDetectorYN_create"):
        for pasta in _pastas_de_modelo():
            caminho = pasta / _MODELO_YUNET
            if caminho.is_file():
                try:
                    with _opencv_sem_aviso():
                        _detector = cv2.FaceDetectorYN_create(
                            str(caminho), "", (320, 320), 0.6, 0.3, 5000
                        )
                    return _detector
                except cv2.error:
                    pass

    # 2 · Haar cascade (OpenCV 4)
    if hasattr(cv2, "CascadeClassifier") and hasattr(cv2, "data"):
        try:
            cc = cv2.CascadeClassifier(
                cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
            )
            if not cc.empty():
                _detector = cc
                return _detector
        except cv2.error:
            pass

    # 3 · nenhum — segue sem borrar, mas avisa uma vez
    _detector = False
    if not _avisou:
        _avisou = True
        _log.warning(
            "sem detector de rosto nesta instalação (OpenCV %s). O borrão de "
            "rosto fica desligado — baixe %s para uma pasta 'modelos/' para "
            "habilitar. O pipeline segue normalmente.",
            cv2.__version__,
            _MODELO_YUNET,
        )
    return None


@contextmanager
def _opencv_sem_aviso():
    """Cala o WARNING do OpenCV durante a detecção de rosto.

    O OpenCV 5 imprime, a cada detecção do YuNet:

        [ WARN] … setPreferableTarget Targets are not supported by the
        new graph engine for now

    Não é falha — o detector funciona, e foi o que borrou o rosto na
    primeira análise de campo. Mas a linha cai no meio do relatório e
    parece erro para quem está lendo o veredito, o que custa confiança
    justamente onde o produto precisa dela.

    Só o nível WARNING some, e só durante a detecção: erro continua
    visível, e os avisos do FFMPEG no RTSP continuam saindo.
    """
    try:
        from cv2.utils import logging as cvlog
    except (ImportError, AttributeError):
        yield
        return

    try:
        anterior = cvlog.getLogLevel()
        cvlog.setLogLevel(cvlog.LOG_LEVEL_ERROR)
    except (AttributeError, cv2.error):
        yield
        return

    try:
        yield
    finally:
        try:
            cvlog.setLogLevel(anterior)
        except (AttributeError, cv2.error):
            pass


def borrar_rostos(frame: Frame, fator: float = 0.08) -> tuple[Frame, bool]:
    """Borra rostos detectados. Mitigação de LGPD a custo zero.

    Retorna `(frame, borrou)`. O segundo valor vai para o evento: saber se
    uma imagem teve rosto borrado antes de sair da loja é exatamente o tipo
    de coisa que a revisão de LGPD vai perguntar, e não dá para reconstruir
    depois.

    **Nunca levanta exceção.** Borrar rosto é melhoria de privacidade, não
    requisito de correção: se não há detector, o pipeline segue.
    """
    det = _obter_detector()
    if det is None:
        return frame, False

    img = frame.imagem.copy()
    caixas: list[tuple[int, int, int, int]] = []

    try:
        with _opencv_sem_aviso():
            if hasattr(det, "detect") and hasattr(det, "setInputSize"):
                # YuNet
                h, w = img.shape[:2]
                det.setInputSize((w, h))
                _, faces = det.detect(img)
                if faces is not None:
                    caixas = [
                        (int(f[0]), int(f[1]), int(f[2]), int(f[3])) for f in faces
                    ]
            else:
                # Haar
                cinza = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
                caixas = [
                    (int(x), int(y), int(cw), int(ch))
                    for x, y, cw, ch in det.detectMultiScale(
                        cinza, scaleFactor=1.15, minNeighbors=4, minSize=(24, 24)
                    )
                ]
    except cv2.error as e:
        _log.debug("detecção de rosto falhou neste quadro: %s", e)
        return frame, False

    if not caixas:
        return frame, False

    h_img, w_img = img.shape[:2]
    for (x, y, w, h) in caixas:
        x, y = max(0, x), max(0, y)
        w, h = min(w, w_img - x), min(h, h_img - y)
        if w <= 0 or h <= 0:
            continue
        k = max(3, int(min(w, h) * fator) | 1)   # ímpar, como o GaussianBlur exige
        img[y : y + h, x : x + w] = cv2.GaussianBlur(
            img[y : y + h, x : x + w], (k, k), 0
        )

    return frame.copia_com(img), True
