"""Um trecho baixado do gravador: ler os quadros e escolher o **quadro parado**.

Quando o agente olha para trás, ele não julga o vídeo: julga UM quadro de
cada trecho — o que mostra a cena sem mão na frente. A escolha é feita na
loja, sem modelo nenhum, pelo movimento entre um quadro e o seguinte.

## A regra, e de onde ela vem

É a que foi medida na loja de teste (rodada 5, `docs/teste-das-fichas.md`,
"A busca pelo meio"): no recorte do alvo, reduzido a 96 pontos de largura e
suavizado, um ponto **mudou** quando o cinza salta mais de 16; o quadro está
**parado** quando menos de 1,2% dos pontos mudou desde o anterior. O quadro
escolhido é o do **meio do trecho parado mais longo**.

Dos 73 pares de bloco e alvo daquela rodada, 64 tinham um trecho parado.
Nos outros 9 a mão estava em cima do alvo: aí o que se devolve é o quadro de
menor movimento, **marcado como não parado** — quem chama decide se ele vai a
juízo (na rodada, não foi).

O trecho parado mínimo é dito em TEMPO (um quarto de segundo, os 4 quadros
medidos a 15 por segundo), para a regra não depender de quantos quadros por
segundo o gravador entrega.

Esses quatro números são a **régua de fábrica** (`Regua`): saíram de uma
câmera, numa noite. A régua é da câmera e da cena, não do motor — outra
câmera pode pedir outra, e ela entra por quem chama.

## O instante de cada quadro, e se o trecho veio inteiro

O arquivo não diz a hora de cada quadro de um jeito que o leitor de vídeo
devolva. O instante sai do COMEÇO do trecho e da taxa do gravador, medida
na instalação: o quadro `i` está em `de + i / qps`. O erro é de um quadro.

A taxa serve também para a conta que importa mais: **o trecho veio
inteiro?** O gravador da loja de teste entrega a gravação recente cortada,
com o tamanho declarado batendo (medido em 10/10/2026): o cliente não tem
como perceber. Aqui dá — eram para vir `(ate − de) · qps` quadros, e vieram
menos. `Escolha.inteiro` diz isso; quem chama espera e pede de novo.

Sem a taxa (gravador ainda não medido), o instante sai da posição do quadro
entre as duas pontas, e NÃO se sabe se o trecho veio inteiro.

## Memória

Um quadro de 1920 × 1080 pesa 6 MB na memória; 2 s são 30 quadros. Por isso
o trecho é lido DUAS vezes: na primeira guarda-se só a medida do movimento
(o recorte reduzido), e na segunda vai-se até o quadro escolhido. Custa uns
0,3 s a mais por bloco, e o agente nunca segura o trecho inteiro.
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Iterator

import cv2
import numpy as np

@dataclass(frozen=True)
class Regua:
    """Com que régua se diz que o alvo está parado. É da CÂMERA e da cena, não do motor.

    Os valores de fábrica são os medidos na loja de teste (rodada 5: uma
    câmera, uma noite, 73 pares de bloco e alvo). Servem de ponto de partida;
    câmera com mais chuvisco, ou cena mais escura, pede outra régua — que
    entra por quem chama, sem mexer neste módulo.
    """

    # O recorte do alvo é reduzido a esta largura antes de medir o movimento.
    largura: int = 96
    # Um ponto "mudou" quando o cinza salta mais que isto de um quadro para o outro.
    salto: int = 16
    # O quadro está parado quando menos que esta parte dos pontos mudou.
    parte_parada: float = 0.012
    # O trecho parado dura pelo menos isto (os 4 quadros medidos, a 15 por segundo).
    tempo_parado_s: float = 0.25


REGUA_DE_FABRICA = Regua()

# Teto de leitura: um trecho de 40 s a 30 quadros por segundo, com folga.
MAX_QUADROS = 1500
# O instante de um quadro é guardado em microssegundos inteiros: 2/15 s vira 0,133333 s, um fio ANTES do quadro 2,
# e a conta de volta (instante → quadro) cairia no quadro 1. A folga, em segundos, cobre esse arredondamento (de
# até meio microssegundo) sem alcançar o microssegundo inteiro: um microssegundo antes do começo já é fora do trecho.
FOLGA_DO_INSTANTE = 0.75e-6

# x1, y1, x2, y2 em fração do quadro (0 a 1).
Caixa = tuple[float, float, float, float]


class TrechoIlegivel(Exception):
    """O leitor de vídeo não tirou quadro nenhum do arquivo."""


@dataclass(frozen=True)
class Escolha:
    """O quadro escolhido de um trecho."""

    # A posição dele no trecho, a partir de zero, e quantos quadros o trecho tinha.
    indice: int
    quadros: int
    # O instante dele, no relógio em que as pontas do trecho foram ditas (o do gravador).
    ts: datetime
    # Quantos quadros tem o trecho parado em que ele está. Zero = não havia trecho
    # parado: este é só o de menor movimento (a mão em cima do alvo).
    parado_quadros: int
    # Quanto do alvo mudou desde o quadro anterior (0 a 1).
    movimento: float
    # O quadro inteiro, como o gravador entregou (BGR).
    imagem: np.ndarray
    # Quantos quadros eram para vir, pela taxa do gravador. `None` = taxa não medida.
    esperados: int | None = None

    @property
    def parado(self) -> bool:
        return self.parado_quadros > 0

    @property
    def inteiro(self) -> bool | None:
        """O trecho veio inteiro? `None` = não dá para saber (o gravador não foi medido). Tolera um quadro."""
        return None if self.esperados is None else self.quadros >= self.esperados - 1


@dataclass(frozen=True)
class QuadroGravado:
    """Um quadro do trecho, com o instante dele."""

    indice: int
    ts: datetime
    imagem: np.ndarray


def _caminho_que_o_leitor_abre(caminho: Path) -> str:
    """O leitor de vídeo do OpenCV tropeça em acento no caminho, no Windows (como o `imread`: ERR-001).

    O nome curto do Windows (8.3) é sempre ASCII e aponta para o mesmo arquivo.
    Fora do Windows, ou se o sistema não der o nome curto, vai o caminho como está.
    """
    texto = str(caminho)
    if os.name != "nt" or texto.isascii():
        return texto
    try:
        import ctypes

        tamanho = ctypes.windll.kernel32.GetShortPathNameW(texto, None, 0)
        if tamanho:
            curto = ctypes.create_unicode_buffer(tamanho)
            if ctypes.windll.kernel32.GetShortPathNameW(texto, curto, tamanho):
                return curto.value
    except (OSError, AttributeError):
        pass
    return texto


def ler_quadros(caminho: Path, *, maximo: int = MAX_QUADROS) -> Iterator[np.ndarray]:
    """Os quadros do trecho, um de cada vez, na ordem. Quem recebe não deve guardá-los todos."""
    leitor = cv2.VideoCapture(_caminho_que_o_leitor_abre(Path(caminho)), cv2.CAP_FFMPEG)
    try:
        lidos = 0
        while lidos < maximo:
            ok, quadro = leitor.read()
            if not ok or quadro is None:
                break
            lidos += 1
            yield quadro
    finally:
        leitor.release()


def contar_quadros(caminho: Path) -> int:
    """Quantos quadros o trecho tem — contados, não lidos do cabeçalho (que nem sempre diz)."""
    return sum(1 for _ in ler_quadros(caminho))


def _recortar(quadro: np.ndarray, caixa: Caixa | None) -> np.ndarray:
    if caixa is None:
        return quadro
    altura, largura = quadro.shape[:2]
    x1, y1, x2, y2 = caixa
    pedaco = quadro[int(altura * y1):int(altura * y2), int(largura * x1):int(largura * x2)]
    # Caixa que não pega ponto nenhum: mede-se o quadro inteiro, em vez de estourar.
    return pedaco if pedaco.size else quadro


def _reduzir(quadro: np.ndarray, largura: int) -> np.ndarray:
    altura = max(1, round(quadro.shape[0] * largura / quadro.shape[1]))
    pequeno = cv2.resize(quadro, (largura, altura), interpolation=cv2.INTER_AREA)
    cinza = cv2.cvtColor(pequeno, cv2.COLOR_BGR2GRAY) if pequeno.ndim == 3 else pequeno
    return cv2.GaussianBlur(cinza, (5, 5), 0)


def medir_movimento(caminho: Path, caixa: Caixa | None = None, regua: Regua = REGUA_DE_FABRICA) -> list[float]:
    """Para cada quadro, a parte do alvo que mudou desde o anterior. O primeiro não tem anterior: vale 1."""
    medidas: list[float] = []
    anterior: np.ndarray | None = None
    for quadro in ler_quadros(caminho):
        agora = _reduzir(_recortar(quadro, caixa), regua.largura)
        if anterior is None or anterior.shape != agora.shape:
            medidas.append(1.0)
        else:
            medidas.append(float((cv2.absdiff(anterior, agora) > regua.salto).mean()))
        anterior = agora
    return medidas


def trecho_mais_parado(medidas: list[float], regua: Regua = REGUA_DE_FABRICA) -> tuple[int, int] | None:
    """O primeiro e o último quadro do trecho parado mais longo, ou `None` se nenhum par de quadros ficou parado.

    Um quadro entra no trecho quando mudou pouco em relação ao anterior; o
    anterior entra junto (é a outra ponta da comparação). No empate, fica o
    primeiro: é o mais perto do começo do trecho.
    """
    melhor: tuple[int, int] | None = None
    inicio: int | None = None
    for i in range(1, len(medidas) + 1):
        parado = i < len(medidas) and medidas[i] < regua.parte_parada
        if parado and inicio is None:
            inicio = i - 1
        if not parado and inicio is not None:
            if melhor is None or (i - 1) - inicio > melhor[1] - melhor[0]:
                melhor = (inicio, i - 1)
            inicio = None
    return melhor


def quadros_que_bastam(qps: float, regua: Regua = REGUA_DE_FABRICA) -> int:
    """Quantos quadros seguidos fazem um trecho parado, a `qps` quadros por segundo. Nunca menos que dois."""
    if qps <= 0:
        return 2
    return max(2, math.ceil(regua.tempo_parado_s * qps - 1e-9))


def _quadro_numero(caminho: Path, indice: int) -> np.ndarray:
    for i, quadro in enumerate(ler_quadros(caminho, maximo=indice + 1)):
        if i == indice:
            return quadro
    raise TrechoIlegivel("o trecho mudou entre uma leitura e a outra")


def _taxa(quadros: int, de: datetime, ate: datetime, qps: float | None) -> float:
    """Quantos quadros por segundo: a medida do gravador, ou — sem ela — o que o próprio trecho mostra."""
    if qps is not None and qps > 0:
        return qps
    return quadros / (ate - de).total_seconds()


def escolher_quadro_parado(
    caminho: Path,
    de: datetime,
    ate: datetime,
    *,
    qps: float | None = None,
    caixa: Caixa | None = None,
    regua: Regua = REGUA_DE_FABRICA,
) -> Escolha:
    """O quadro parado do trecho que cobre de `de` até `ate`.

    `qps` é a taxa medida do gravador: com ela o instante de cada quadro sai
    do começo do trecho, e `Escolha.inteiro` diz se veio tudo. `caixa` é o
    alvo: onde olhar o movimento (a tampa, a posição de montagem). Sem ela,
    mede-se o quadro inteiro. `regua` é a da câmera; sem ela, vale a de
    fábrica. A imagem devolvida é sempre o quadro INTEIRO: quem chama recorta
    como precisar.
    """
    if ate <= de:
        raise ValueError("o trecho termina depois de começar")
    medidas = medir_movimento(caminho, caixa, regua)
    quadros = len(medidas)
    if not quadros:
        raise TrechoIlegivel("o leitor de vídeo não tirou quadro nenhum do trecho")
    taxa = _taxa(quadros, de, ate, qps)
    parado = trecho_mais_parado(medidas, regua)
    if parado is not None and parado[1] - parado[0] + 1 >= quadros_que_bastam(taxa, regua):
        indice, tamanho = (parado[0] + parado[1]) // 2, parado[1] - parado[0] + 1
    else:
        # Sem trecho parado: o de menor movimento, dito como NÃO parado.
        indice, tamanho = (int(np.argmin(medidas[1:])) + 1 if quadros > 1 else 0), 0
    return Escolha(
        indice=indice, quadros=quadros, ts=de + timedelta(seconds=indice / taxa), parado_quadros=tamanho,
        movimento=medidas[indice], imagem=_quadro_numero(caminho, indice),
        esperados=None if qps is None or qps <= 0 else round((ate - de).total_seconds() * qps),
    )


def quadros_dos_instantes(
    caminho: Path, de: datetime, ate: datetime, instantes: list[datetime], *, qps: float | None = None,
) -> list[QuadroGravado | None]:
    """O quadro que cobre cada instante pedido, na ordem em que foram pedidos.

    Instante que o trecho não cobre — antes do começo, ou depois do último
    quadro que VEIO (o trecho pode ter vindo cortado) — volta `None`: quem
    chama decide se espera e pede de novo. Dois instantes que caem no mesmo
    quadro devolvem o mesmo quadro duas vezes. O instante que este módulo
    deu a um quadro (`Escolha.ts`, `QuadroGravado.ts`) volta nesse quadro.
    """
    if ate <= de:
        raise ValueError("o trecho termina depois de começar")
    quadros = contar_quadros(caminho)
    if not quadros:
        raise TrechoIlegivel("o leitor de vídeo não tirou quadro nenhum do trecho")
    taxa = _taxa(quadros, de, ate, qps)
    # o quadro i cobre de `de + i/taxa` até o seguinte; fora de 0..quadros-1, o trecho não cobre
    indices = [math.floor(((t - de).total_seconds() + FOLGA_DO_INSTANTE) * taxa) for t in instantes]
    precisos = {i for i in indices if 0 <= i < quadros}
    imagens: dict[int, np.ndarray] = {}
    for i, quadro in enumerate(ler_quadros(caminho, maximo=max(precisos) + 1 if precisos else 0)):
        if i in precisos:
            imagens[i] = quadro
    if len(imagens) != len(precisos):
        raise TrechoIlegivel("o trecho mudou entre uma leitura e a outra")
    return [
        QuadroGravado(indice=i, ts=de + timedelta(seconds=i / taxa), imagem=imagens[i]) if i in imagens else None
        for i in indices
    ]
