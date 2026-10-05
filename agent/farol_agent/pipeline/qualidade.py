"""Medição de qualidade do quadro e escolha do melhor.

Duas funções fazem trabalho pesado aqui, e a segunda vale ouro no diagnóstico:

  nitidez()          — variância do Laplaciano: o quadro está focado?
  detalhe_real()     — energia de alta frequência: a imagem tem o detalhe que
                       a resolução promete, ou foi esticada?

A segunda é o que detecta **1080N**. Um gravador que grava 960×1080 esticado
entrega um stream que *declara* 1920×1080 — o ffprobe não acusa nada. Mas
imagem esticada não tem conteúdo de alta frequência. Medindo, aparece.
"""

from __future__ import annotations

import cv2
import numpy as np

from farol_agent.modelos import Frame


def nitidez(imagem: np.ndarray) -> float:
    """Variância do Laplaciano. Maior é mais nítido.

    Não tem escala absoluta: serve para comparar quadros da MESMA câmera na
    MESMA cena. Para julgar foco em absoluto, use a calibração do ponto.
    """
    cinza = cv2.cvtColor(imagem, cv2.COLOR_BGR2GRAY) if imagem.ndim == 3 else imagem
    return float(cv2.Laplacian(cinza, cv2.CV_64F).var())


def detalhe_real(imagem: np.ndarray) -> float:
    """Fração da energia espectral que está na metade alta do espectro.

    Imagem nativa fica tipicamente entre 0,15 e 0,45. Imagem esticada de uma
    resolução menor cai abaixo de ~0,08, porque o upscale não cria detalhe.

    É a sonda que pega 1080N, e também pega câmera fora de foco, lente suja e
    stream recomprimido.
    """
    cinza = cv2.cvtColor(imagem, cv2.COLOR_BGR2GRAY) if imagem.ndim == 3 else imagem
    cinza = cinza.astype(np.float32) / 255.0

    # Janela de Hanning evita que a borda da imagem vire energia de alta
    # frequência falsa no espectro.
    h, w = cinza.shape
    janela = np.outer(np.hanning(h), np.hanning(w))
    espectro = np.abs(np.fft.fftshift(np.fft.fft2(cinza * janela)))

    cy, cx = h // 2, w // 2
    yy, xx = np.ogrid[:h, :w]
    raio = np.sqrt((yy - cy) ** 2 + (xx - cx) ** 2)
    raio_max = float(min(cy, cx)) or 1.0

    total = float(espectro.sum())
    if total <= 0:
        return 0.0
    alta = float(espectro[raio > raio_max * 0.5].sum())
    return alta / total


def saturacao_media(imagem: np.ndarray) -> float:
    """Saturação média em 0..1.

    Perto de zero significa que a câmera caiu para infravermelho preto e
    branco — e aí **toda regra que depende de cor morre**: touca branca, luva
    azul, produto cru contra selado.
    """
    if imagem.ndim != 3:
        return 0.0
    hsv = cv2.cvtColor(imagem, cv2.COLOR_BGR2HSV)
    return float(hsv[:, :, 1].mean()) / 255.0


def faixa_dinamica(imagem: np.ndarray) -> tuple[float, float]:
    """Fração de pixels estourados e cortados, em 0..1.

    Muito estourado ou muito cortado significa que o WDR não dá conta da cena —
    contraluz de porta ou janela ao fundo transforma a pessoa em silhueta, e
    nenhum modelo julga silhueta.
    """
    cinza = cv2.cvtColor(imagem, cv2.COLOR_BGR2GRAY) if imagem.ndim == 3 else imagem
    n = cinza.size or 1
    return (
        float((cinza >= 250).sum()) / n,   # estourado
        float((cinza <= 5).sum()) / n,     # cortado
    )


def cena_utilizavel(imagem: np.ndarray) -> tuple[bool, str]:
    """A imagem contém uma CENA, ou é tela gerada pelo gravador?

    Medido no MHDX 3116-C em 05/10/2026: canal sem câmera transmite uma
    tela preta com o logotipo e o relógio. Ela tem **99,5% dos pixels
    praticamente pretos** e saturação zero.

    Sem esta porta, essa tela seguiria o pipeline inteiro e chegaria ao
    modelo, que seria perguntado se a bancada está limpa a respeito de um
    retângulo preto. Custa dinheiro e devolve absurdo — e, pior, um
    "não conforme" sobre nada viraria alerta para a cozinha.

    O veredito certo aqui é `nao_avaliavel`, e ele sai de graça.

    ⚠️ `detalhe_real` **não** serve para isto: a tela de sem-sinal marcou
    0,661, mais alto que cena real, porque o texto do relógio sobre preto
    chapado é pura alta frequência. Medida boa para uma coisa pode mentir
    para outra.
    """
    estourado, cortado = faixa_dinamica(imagem)

    if cortado > 0.90:
        # Cozinha escura ainda tem ruído de sensor; preto chapado em 90%
        # da imagem é coisa gerada, não captada.
        return False, f"{cortado:.0%} da imagem em preto absoluto — tela de 'sem sinal'"

    if estourado > 0.90:
        return False, f"{estourado:.0%} da imagem estourada — tela branca ou luz direta"

    cinza = cv2.cvtColor(imagem, cv2.COLOR_BGR2GRAY) if imagem.ndim == 3 else imagem
    if float(cinza.std()) < 3.0:
        # Imagem chapada de qualquer tom: câmera tampada, lente coberta,
        # fluxo congelado num quadro liso.
        return False, "imagem praticamente uniforme — câmera tampada ou fluxo parado"

    return True, ""


def melhor_quadro(
    quadros: list[Frame], descartar: int = 2, zona_bbox: tuple[int, int, int, int] | None = None
) -> Frame | None:
    """Escolhe o quadro mais nítido de uma rajada.

    `descartar` joga fora os primeiros: o primeiro quadro após abrir um RTSP
    costuma vir do buffer e ser um I-frame parcial, com artefato. O protótipo
    não fazia isso e por isso capturava quadro sujo.

    `zona_bbox` mede a nitidez **só dentro da zona** — o que importa é a
    bancada estar focada, não o fundo.
    """
    if not quadros:
        return None

    candidatos = quadros[descartar:] or quadros[-1:]

    for f in candidatos:
        img = f.imagem
        if zona_bbox is not None:
            x1, y1, x2, y2 = zona_bbox
            recorte = img[y1:y2, x1:x2]
            if recorte.size > 0:
                img = recorte
        f.nitidez = nitidez(img)

    return max(candidatos, key=lambda f: f.nitidez or 0.0)
