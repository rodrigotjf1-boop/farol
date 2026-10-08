"""A cena de agora é a da foto padrão?

A loja responde isto sozinha, sem modelo e sem custo: se o quadro de agora é
igual ao que alguém guardou como "é assim que deve ficar", está conforme, e
não há o que perguntar a ninguém. O que não for igual não é acusado de nada:
vai para quem sabe julgar, com a foto padrão ao lado.

## A medida: o pior bloco

As duas imagens são reduzidas, suavizadas e comparadas por semelhança
estrutural (SSIM), que tolera a luz subir e descer. O mapa de semelhança é
cortado em blocos de uns 21 pontos e a medida é o **pior bloco** — não a
média. A média perdoa justamente o que interessa: um objeto que ocupa 1% da
área muda a média em 1%, e isso é menos do que a mesma cena oscila sozinha.

## O que foi medido (loja, 08/10/2026, três canais, quadros de verdade)

Em 384 pontos, com o relógio do gravador de fora:

    a mesma cena, 11 capturas em 2 min     0,96 a 0,99   (dois canais)
    a mesma cena, luz de -20% a +20%       0,89 a 0,99
    um pedaço de 0,2% da área fora do lugar   até 0,83
    um pedaço de 0,5% da área fora do lugar   até 0,66
    os recortes da operação, com gente     abaixo de 0,10

O limiar de 0,90 fica entre "a mesma cena" e "mudou 0,2% da área". Num
terceiro canal havia algo que muda sozinho (0,84 no pior caso): ali a loja
pergunta mais vezes — custa chamada, não erra.

## O que isto NÃO vê

Mudança menor que uns 0,2% da área: farelo, respingo, um pano pequeno. Para
isso serve o critério de estado, com a foto padrão indo junto para a nuvem.

## O relógio do gravador

O gravador escreve data e hora em cima da imagem, e o relógio da foto padrão
nunca é o de agora. Os blocos que tocam o retângulo do relógio ficam de fora
da conta (`ignorar`). Quem diz onde ele fica é o próprio gravador.
"""

from __future__ import annotations

from typing import Sequence

import cv2
import numpy as np

# O lado maior em que a comparação é feita, e o tamanho do bloco. São os da
# medição: 384 pontos, grade de 18 (blocos de ~21).
LADO = 384
BLOCO = 21

# A partir de quanto a cena é "a da foto padrão".
LIMIAR_IGUAL = 0.90

# Bloco com menos que isto dentro da área não conta: é quase todo entorno.
PARTE_MINIMA_DO_BLOCO = 0.5

Retangulo = tuple[float, float, float, float]   # x1, y1, x2, y2, em fração do recorte


def _preparar(bgr: np.ndarray, tamanho: tuple[int, int]) -> np.ndarray:
    cinza = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY) if bgr.ndim == 3 else bgr
    if (cinza.shape[1], cinza.shape[0]) != tamanho:
        cinza = cv2.resize(cinza, tamanho, interpolation=cv2.INTER_AREA)
    # Suaviza o ruído do sensor e o da compressão: nenhum dos dois é cena.
    return cv2.GaussianBlur(cinza, (0, 0), 1.0).astype(np.float32)


def _mapa_de_semelhanca(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """SSIM ponto a ponto, com a janela de costume (11, sigma 1,5)."""
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2

    def media(x: np.ndarray) -> np.ndarray:
        return cv2.GaussianBlur(x, (11, 11), 1.5)

    ma, mb = media(a), media(b)
    va = media(a * a) - ma * ma
    vb = media(b * b) - mb * mb
    vab = media(a * b) - ma * mb
    return ((2 * ma * mb + c1) * (2 * vab + c2)) / ((ma * ma + mb * mb + c1) * (va + vb + c2))


def semelhanca(
    atual: np.ndarray,
    padrao: np.ndarray,
    *,
    dentro: np.ndarray | None = None,
    ignorar: Sequence[Retangulo] = (),
) -> float | None:
    """Quão igual à foto padrão é a cena de agora: o pior bloco, de 0 a 1.

    `atual` e `padrao` são o MESMO recorte (a mesma área do mesmo canal), em
    qualquer tamanho. `dentro` é a máscara do desenho da área (o que não é
    zero conta), no tamanho que for. `ignorar` são retângulos, em fração do
    recorte, que não entram na conta — o relógio do gravador.

    `None` quando não sobra bloco para comparar: aí não há medida, e quem
    chama tem de tratar como "não sei".
    """
    h, w = atual.shape[:2]
    escala = min(1.0, LADO / max(h, w))
    tamanho = (max(8, round(w * escala)), max(8, round(h * escala)))
    largura, altura = tamanho

    mapa = _mapa_de_semelhanca(_preparar(atual, tamanho), _preparar(padrao, tamanho))

    mascara = None
    if dentro is not None:
        reduzida = cv2.resize(dentro, tamanho, interpolation=cv2.INTER_NEAREST)
        # A beirada do desenho fica de fora: a janela da medida enxerga uns
        # pontos além da borda, e o que está colado nela POR FORA não é da
        # área. Medido: uma mudança a 1 ponto da borda, do lado de fora,
        # dá 0,95 com a beirada tirada e 0,85 sem tirar.
        mascara = cv2.erode(reduzida, np.ones((3, 3), dtype=np.uint8), iterations=2) > 0

    colunas = max(2, round(largura / BLOCO))
    linhas = max(2, round(altura / BLOCO))
    pior: float | None = None
    for i in range(linhas):
        y1, y2 = i * altura // linhas, (i + 1) * altura // linhas
        for j in range(colunas):
            x1, x2 = j * largura // colunas, (j + 1) * largura // colunas
            if y2 <= y1 or x2 <= x1:
                continue
            if any(
                not (x2 / largura <= rx1 or x1 / largura >= rx2 or y2 / altura <= ry1 or y1 / altura >= ry2)
                for rx1, ry1, rx2, ry2 in ignorar
            ):
                continue
            bloco = mapa[y1:y2, x1:x2]
            if mascara is not None:
                da_area = mascara[y1:y2, x1:x2]
                if float(da_area.mean()) < PARTE_MINIMA_DO_BLOCO:
                    continue
                valor = float(bloco[da_area].mean())
            else:
                valor = float(bloco.mean())
            if pior is None or valor < pior:
                pior = valor

    if pior is None:
        return None
    return float(min(1.0, max(0.0, pior)))
