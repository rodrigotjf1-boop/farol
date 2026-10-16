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


# O que fica fora da área é trocado por este cinza liso — o mesmo do
# enchimento de quadro dos detectores. Nem preto, que é a cara da tela de
# "sem sinal", nem branco, que é a de luz estourada.
COR_DE_FORA = (114, 114, 114)


def recortar_area(frame: Frame, zona: Zona) -> tuple[Frame, np.ndarray | None]:
    """O recorte EXATO da área e, dentro dele, o que é a área.

    A área é o desenho de quem configurou a loja: um polígono. O recorte é
    o retângulo que o envolve, **sem folga** — os 5% de folga faziam a
    borda da área vizinha entrar junto. O que a pessoa marcou é a resposta
    dela.

    O segundo valor é a máscara do polígono dentro do recorte (255 = é da
    área), ou `None` quando o polígono É o retângulo inteiro e não há nada
    a apagar.
    """
    x1, y1, x2, y2 = zona.bbox(frame.largura, frame.altura, 0.0)
    if x2 <= x1 or y2 <= y1:
        return frame, None

    recorte = frame.imagem[y1:y2, x1:x2].copy()
    h, w = recorte.shape[:2]
    pontos = np.array(
        [[int(px * frame.largura) - x1, int(py * frame.altura) - y1] for px, py in zona.poligono],
        dtype=np.int32,
    )
    dentro = np.zeros((h, w), dtype=np.uint8)
    cv2.fillPoly(dentro, [pontos], 255)
    # Tudo dentro: o desenho É o retângulo, e não há o que apagar.
    if int(cv2.countNonZero(dentro)) == h * w:
        return frame.copia_com(recorte), None
    return frame.copia_com(recorte), dentro


def miolo(frame: Frame, dentro: np.ndarray | None) -> np.ndarray:
    """Só os pontos DA ÁREA, como uma imagem de uma coluna.

    É o que as medidas de qualidade têm de olhar. Medir o recorte inteiro
    contaria o que está fora do desenho: uma área estreita sobre um fundo
    claro pareceria ter cena mesmo com a câmera dela tampada.
    """
    if dentro is None:
        return frame.imagem
    pontos = frame.imagem[dentro > 0]
    return pontos.reshape(-1, 1, 3) if frame.imagem.ndim == 3 else pontos.reshape(-1, 1)


def apagar_fora(frame: Frame, dentro: np.ndarray | None) -> Frame:
    """Troca por cinza liso o que está fora da área.

    Depois daqui, o que não foi marcado não chega a ninguém: nem ao
    detector (que contaria a pessoa da área ao lado), nem à nuvem, nem ao
    disco.
    """
    if dentro is None:
        return frame
    imagem = frame.imagem.copy()
    imagem[dentro == 0] = COR_DE_FORA if imagem.ndim == 3 else COR_DE_FORA[0]
    return frame.copia_com(imagem)


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
# O tamanho com que o detector nasce; cada detecção acerta o dela.
_ENTRADA_YUNET = (320, 320)


def _pastas_de_modelo() -> list[Path]:
    env = os.environ.get("FAROL_MODELOS")
    pastas = [Path(env)] if env else []
    pastas.append(Path(__file__).resolve().parent.parent / "modelos")
    pastas.append(Path.cwd() / "modelos")
    return pastas


def _abrir_yunet(caminho: Path):
    """Abre o YuNet pelos BYTES do arquivo, e não pelo caminho.

    O leitor de modelo do OpenCV abre o arquivo pela API ANSI do Windows,
    como o `imread` (ERR-001): com acento em QUALQUER pasta do caminho ele
    não abre. Aqui a falha desligava o borrão de rosto em silêncio — só um
    aviso no registro, e a imagem seguia com o rosto (ERR-111). Medido em
    12/10/2026, no OpenCV 5.0: o mesmo arquivo abre pelos bytes e não abre
    de dentro de `…\\Usuário\\…`. Quem lê o arquivo é o Python, que é
    Unicode — a mesma volta de `farol_agent.imagens`.

    O OpenCV que só sabe abrir pelo caminho continua atendido.
    """
    criar = getattr(getattr(cv2, "FaceDetectorYN", None), "create", None)
    if criar is not None:
        try:
            dados = np.fromfile(str(caminho), dtype=np.uint8)
            return criar("onnx", dados, np.empty(0, dtype=np.uint8), _ENTRADA_YUNET, 0.6, 0.3, 5000)
        except (cv2.error, TypeError, OSError):
            pass
    return cv2.FaceDetectorYN_create(str(caminho), "", _ENTRADA_YUNET, 0.6, 0.3, 5000)


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
                        _detector = _abrir_yunet(caminho)
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


# O rosto achado vira UMA cor. Não é desfoque e não é mosaico, e a escolha
# foi medida, não suposta.
#
# Até 06/10/2026 isto era um desfoque de 8% do lado do rosto — num rosto de
# 150 px, um sigma de ~2 px. A função devolvia `borrou=True`, o arquivo
# viajava como "borrado" e o rosto continuava reconhecível (ERR-026). Não
# havia um teste sequer: todos passavam `borrar_rosto=False`.
#
# A medida, nas câmeras de uma loja: depois de "borrar", o próprio detector
# de rosto ainda acha um rosto ali? Pontuação dele em cinco rostos reais:
#
#     antes              0,93   0,65   0,86   0,78   0,62
#     desfoque antigo    0,93   0,65   0,86   0,75   0,64    ← não fazia nada
#     mosaico 6 células  0,46   0,19   0,53   0,80   0,54
#     mosaico 2 células    —      —      —    0,19   0,33
#     uma cor              —      —      —      —    0,12
#
# Rosto pequeno (20 a 40 px) já é um mosaico: reduzir a seis células quase
# não tira nada dele. Só a cor única zera em todos.

# A caixa do detector vai, justa, da testa ao queixo. A margem cobre o
# contorno, a orelha e o erro da própria caixa.
_MARGEM_DO_ROSTO = 0.25


def _caixas_de_rosto(img: np.ndarray) -> list[tuple[int, int, int, int]] | None:
    """`(x, y, largura, altura)` de cada rosto achado. `None` = não deu para procurar.

    A diferença entre lista vazia e `None` importa para quem chama: "procurei
    e não há rosto" é uma resposta; "não consegui procurar" é outra.
    """
    det = _obter_detector()
    if det is None:
        return None

    try:
        with _opencv_sem_aviso():
            if hasattr(det, "detect") and hasattr(det, "setInputSize"):
                # YuNet
                h, w = img.shape[:2]
                det.setInputSize((w, h))
                _, faces = det.detect(img)
                if faces is None:
                    return []
                return [(int(f[0]), int(f[1]), int(f[2]), int(f[3])) for f in faces]

            # Haar
            cinza = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            return [
                (int(x), int(y), int(cw), int(ch))
                for x, y, cw, ch in det.detectMultiScale(
                    cinza, scaleFactor=1.15, minNeighbors=4, minSize=(24, 24)
                )
            ]
    except cv2.error as e:
        _log.debug("detecção de rosto falhou neste quadro: %s", e)
        return None


def _apagar(regiao: np.ndarray) -> np.ndarray:
    """A região inteira na cor média dela. Não há filtro que traga o resto de volta.

    A cor média, e não preto: um retângulo preto no meio da cena puxa o
    olho de quem julga, gente ou modelo; a média some no entorno.
    """
    cor = regiao.reshape(-1, regiao.shape[-1] if regiao.ndim == 3 else 1).mean(axis=0)
    saida = np.empty_like(regiao)
    saida[...] = np.round(cor).astype(regiao.dtype) if regiao.ndim == 3 else int(round(cor[0]))
    return saida


# O borrão desligado NESTE computador. O dono, 16/10/2026: "não vamos tratar ou distorcer rostos até final do produto
# funcionando por completo determinado por mim" (LGPD fica para o fim do projeto). A loja piloto põe
# FAROL_BORRAR_ROSTOS=0 nas variáveis do computador dela; sem a variável, o borrão segue LIGADO — o padrão do produto
# para qualquer outra loja.
BORRAO_DESLIGADO = ("0", "nao", "não", "false", "desligado")
_avisou_desligado = False


def borrao_ligado() -> bool:
    """Falso só quando o computador da loja desligou o borrão (`FAROL_BORRAR_ROSTOS`)."""
    return os.environ.get("FAROL_BORRAR_ROSTOS", "").strip().lower() not in BORRAO_DESLIGADO


def borrar_rostos(frame: Frame) -> tuple[Frame, bool]:
    """Apaga os rostos que o detector achar. Mitigação de LGPD, não garantia.

    Retorna `(frame, borrou)`. `borrou=True` quer dizer exatamente uma coisa:
    **pelo menos um rosto foi achado e apagado**. Não quer dizer "esta imagem
    não tem rosto reconhecível" — o detector não acha rosto de costas, de
    cima ou longe, e câmera de teto é quase sempre um desses (medido numa
    loja em 06/10/2026: de 8 canais com gente, achou rosto em 3).

    Quem precisa de garantia não pode se apoiar neste retorno; precisa não
    mandar a imagem.

    **Nunca levanta exceção**: sem detector, o pipeline segue e devolve
    `False`. Com o borrão desligado neste computador (`borrao_ligado`), a
    imagem segue como veio e o detector nem é perguntado.
    """
    global _avisou_desligado
    if not borrao_ligado():
        if not _avisou_desligado:
            _avisou_desligado = True
            _log.info("borrão de rosto DESLIGADO neste computador (FAROL_BORRAR_ROSTOS): as imagens saem como vieram")
        return frame, False
    caixas = _caixas_de_rosto(frame.imagem)
    if not caixas:
        return frame, False

    img = frame.imagem.copy()
    h_img, w_img = img.shape[:2]
    apagados = 0
    for (x, y, w, h) in caixas:
        mx, my = int(w * _MARGEM_DO_ROSTO), int(h * _MARGEM_DO_ROSTO)
        x1, y1 = max(0, x - mx), max(0, y - my)
        x2, y2 = min(w_img, x + w + mx), min(h_img, y + h + my)
        if x2 <= x1 or y2 <= y1:
            continue
        img[y1:y2, x1:x2] = _apagar(img[y1:y2, x1:x2])
        apagados += 1

    # Caixa degenerada não apaga nada, e então não se pode dizer que borrou.
    if not apagados:
        return frame, False
    return frame.copia_com(img), True
