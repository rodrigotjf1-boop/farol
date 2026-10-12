"""Deduplicação perceptual — economia de graça.

Se o recorte é praticamente idêntico ao que foi enviado há trinta segundos, não
envie: você pagaria duas vezes pela mesma cena. Numa cozinha, a maior parte do
tempo a bancada está parada, e sem isto metade das chamadas é repetição.

pHash por DCT, implementado aqui em vez de trazer dependência: são vinte linhas
e evita mais um pacote no instalador.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import cv2
import numpy as np


def phash(imagem: np.ndarray, tamanho: int = 32, lado: int = 8) -> int:
    """Hash perceptual de 64 bits.

    Reduz para 32×32, aplica DCT, pega o bloco 8×8 de baixa frequência
    (descartando o termo DC, que é só o brilho médio) e compara cada
    coeficiente com a mediana.
    """
    cinza = cv2.cvtColor(imagem, cv2.COLOR_BGR2GRAY) if imagem.ndim == 3 else imagem
    pequeno = cv2.resize(cinza, (tamanho, tamanho), interpolation=cv2.INTER_AREA)
    dct = cv2.dct(pequeno.astype(np.float32))
    bloco = dct[:lado, :lado].flatten()
    mediana = float(np.median(bloco[1:]))   # sem o DC
    bits = 0
    for i, v in enumerate(bloco):
        if v > mediana:
            bits |= 1 << i
    return bits


def distancia(a: int, b: int) -> int:
    """Hamming entre dois hashes. 0 = idêntico, 64 = oposto."""
    return bin(a ^ b).count("1")


class Deduplicador:
    """Memória curta de hashes por zona.

    `limiar` é a distância de Hamming abaixo da qual duas cenas são
    consideradas a mesma. Entre 4 e 8 funciona bem para cena de cozinha:
    abaixo de 4 passa repetição, acima de 10 começa a engolir mudança real.
    """

    def __init__(self, limiar: int = 6, memoria_seg: int = 30) -> None:
        self.limiar = limiar
        self.memoria = timedelta(seconds=memoria_seg)
        self._visto: dict[str, list[tuple[datetime, int]]] = {}

    def repetido(self, chave: str, imagem: np.ndarray, ts: datetime) -> bool:
        """True quando esta cena já foi enviada há pouco.

        `chave` deve identificar o par zona-regra: a mesma cena pode ser
        relevante para uma regra e irrelevante para outra.
        """
        return self.repeticao_de(chave, imagem, ts) is not None

    def repeticao_de(self, chave: str, imagem: np.ndarray, ts: datetime) -> datetime | None:
        """O instante da cena de que esta é repetição — ou `None`, se ela é nova.

        A cena nova passa a ser lembrada; a repetida, não (lembrá-la
        renovaria a memória a cada olhada, e a cena parada nunca mais seria
        vista de novo). Havendo mais de uma parecida na memória, vale a mais
        recente: é dela que a cena de agora é continuação.

        Quem chama precisa do instante para saber O QUE está se repetindo:
        "a mesma cena de há pouco" não diz se aquela cena foi dada como fora
        do critério ou se ninguém conseguiu avaliá-la.
        """
        h = phash(imagem)
        historico = self._visto.setdefault(chave, [])

        # Esquece o que saiu da janela de memória
        corte = ts - self.memoria
        historico[:] = [(t, v) for t, v in historico if t >= corte]

        for quando, anterior in reversed(historico):
            if distancia(h, anterior) <= self.limiar:
                return quando

        historico.append((ts, h))
        return None

    def limpar(self) -> None:
        self._visto.clear()
