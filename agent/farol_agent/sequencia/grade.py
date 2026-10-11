"""A grade de quadros numerados: uma sequência numa imagem só.

Quando a busca pelo meio aperta a dúvida sem achar o que procura, sobra uma
janela de poucos segundos — a mão em cima do alvo. Um quadro só não conta o
que houve ali; a sequência conta. A grade põe alguns quadros da janela lado a
lado, **numerados na ordem do tempo**, e a pergunta passa a ser sobre a
sequência ("o que foi posto, e em qual quadro?").

A resposta vem em número de quadro; `Grade.instantes` devolve o instante de
cada número — é assim que "aconteceu no quadro 4" vira uma hora.

## O que é fixo e o que não é

- **Seis quadros, três por linha**: o formato do plano da onda 2 (e o da
  rodada 5 do teste das fichas). Quem chama pode pedir outro.
- **Os instantes** são o meio de cada fatia igual da janela: nenhum quadro
  fica em cima das pontas, que as olhadas já viram.
- **A célula** é o recorte do alvo no tamanho em que a câmera entrega, só
  reduzido quando passa do teto. Nunca é ampliada: ponto inventado não ajuda
  quem julga.

Este módulo não fala com o gravador: recebe os quadros (ou um trecho já
baixado). Quem busca o trecho é o `gravado.py`.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Sequence

import cv2
import numpy as np

from farol_agent.sequencia import bloco
from farol_agent.sequencia.bloco import Caixa, QuadroGravado

QUADROS_DA_GRADE = 6
COLUNAS = 3
# O maior tamanho de uma célula (largura, altura). Recorte maior é reduzido para caber.
MAIOR_CELULA = (960, 540)
# O fio escuro entre as células, em pontos: separa um quadro do vizinho para quem julga.
FIO = 4


class GradeIncompleta(Exception):
    """Faltou quadro para algum instante da grade: o trecho não cobre a janela inteira."""

    def __init__(self, faltam: int, de: int) -> None:
        super().__init__(f"faltaram {faltam} de {de} quadros da grade: o trecho não cobre a janela inteira")
        self.faltam = faltam
        self.de = de


@dataclass(frozen=True)
class Grade:
    # A imagem pronta (BGR): as células, na ordem do tempo, da esquerda para a direita e de cima para baixo.
    imagem: np.ndarray
    # O instante do quadro de cada número: o do "1" é `instantes[0]`.
    instantes: tuple[datetime, ...]
    colunas: int
    # O tamanho de cada célula (largura, altura), em pontos.
    celula: tuple[int, int]

    def instante_do(self, numero: int) -> datetime:
        """O instante do quadro de número `numero` (a partir de 1), como está escrito na grade."""
        if not 1 <= numero <= len(self.instantes):
            raise ValueError(f"a grade tem os quadros de 1 a {len(self.instantes)}")
        return self.instantes[numero - 1]


def instantes_da_grade(de: datetime, ate: datetime, quantos: int = QUADROS_DA_GRADE) -> list[datetime]:
    """Os instantes dos quadros da grade: o meio de cada uma das `quantos` fatias iguais da janela."""
    if ate <= de:
        raise ValueError("a janela termina depois de começar")
    if quantos < 1:
        raise ValueError("a grade tem pelo menos um quadro")
    # Cada instante sai da janela inteira, numa conta só: somar fatias já arredondadas (o instante é guardado
    # em microssegundos) acumularia o erro de uma em cada quadro.
    return [de + (ate - de) * (2 * i + 1) / (2 * quantos) for i in range(quantos)]


def _caber(imagem: np.ndarray, maior: tuple[int, int]) -> np.ndarray:
    """A imagem reduzida para caber em `maior`, sem mudar a proporção. Nunca amplia."""
    altura, largura = imagem.shape[:2]
    escala = min(maior[0] / largura, maior[1] / altura)
    if escala >= 1:
        return imagem
    novo = (max(1, round(largura * escala)), max(1, round(altura * escala)))
    return cv2.resize(imagem, novo, interpolation=cv2.INTER_AREA)


def _numerar(celula: np.ndarray, numero: int) -> np.ndarray:
    """A célula com o número dela no canto de cima, à esquerda: branco sobre uma placa escura."""
    saida = celula.copy()
    altura, largura = saida.shape[:2]
    # A placa cresce com a célula, e não some numa célula pequena.
    lado = max(18, round(min(altura, largura) * 0.16))
    cv2.rectangle(saida, (0, 0), (lado, lado), (0, 0, 0), thickness=-1)
    texto = str(numero)
    fonte = cv2.FONT_HERSHEY_SIMPLEX
    tamanho = lado / 34.0
    espessura = max(1, round(lado / 14))
    (w, h), _ = cv2.getTextSize(texto, fonte, tamanho, espessura)
    cv2.putText(saida, texto, ((lado - w) // 2, (lado + h) // 2), fonte, tamanho, (255, 255, 255), espessura, cv2.LINE_AA)
    return saida


def montar(
    quadros: Sequence[QuadroGravado],
    *,
    caixa: Caixa | None = None,
    colunas: int = COLUNAS,
    maior_celula: tuple[int, int] = MAIOR_CELULA,
) -> Grade:
    """A grade dos quadros dados, na ordem em que vieram — que tem de ser a do tempo.

    `caixa` é o alvo (em fração do quadro): cada célula é o recorte dele. Sem
    ela, vai o quadro inteiro.
    """
    if not quadros:
        raise ValueError("a grade tem pelo menos um quadro")
    if colunas < 1:
        raise ValueError("a grade tem pelo menos uma coluna")
    instantes = [q.ts for q in quadros]
    if any(depois < antes for antes, depois in zip(instantes, instantes[1:])):
        raise ValueError("os quadros da grade vêm na ordem do tempo")

    celulas = [_caber(bloco._recortar(q.imagem, caixa), maior_celula) for q in quadros]
    if len({c.shape for c in celulas}) != 1:
        raise ValueError("os quadros da grade têm de ter o mesmo tamanho")
    altura, largura = celulas[0].shape[:2]
    numeradas = [_numerar(c, i + 1) for i, c in enumerate(celulas)]

    linhas = -(-len(numeradas) // colunas)
    tela = np.zeros((linhas * altura + (linhas - 1) * FIO, colunas * largura + (colunas - 1) * FIO, 3), dtype=np.uint8)
    for i, celula in enumerate(numeradas):
        y = (i // colunas) * (altura + FIO)
        x = (i % colunas) * (largura + FIO)
        tela[y:y + altura, x:x + largura] = celula
    return Grade(imagem=tela, instantes=tuple(instantes), colunas=colunas, celula=(largura, altura))


def grade_do_trecho(
    caminho: Path,
    de: datetime,
    ate: datetime,
    janela: tuple[datetime, datetime],
    *,
    qps: float | None = None,
    caixa: Caixa | None = None,
    quantos: int = QUADROS_DA_GRADE,
    colunas: int = COLUNAS,
) -> Grade:
    """A grade da `janela`, tirada de um trecho já baixado que vai de `de` até `ate`.

    Se o trecho não tem quadro para algum instante (veio cortado, ou a janela
    passa dele), levanta `GradeIncompleta`: grade com buraco contaria uma
    sequência que não é a que houve.
    """
    instantes = instantes_da_grade(janela[0], janela[1], quantos)
    quadros = bloco.quadros_dos_instantes(caminho, de, ate, instantes, qps=qps)
    faltam = sum(1 for q in quadros if q is None)
    if faltam:
        raise GradeIncompleta(faltam, len(quadros))
    return montar([q for q in quadros if q is not None], caixa=caixa, colunas=colunas)
