"""Captura o quadro de preview de um canal.

É o quadro que o usuário vê no app para desenhar a área de análise. Não
passa por modelo nenhum: captura, borra rosto, reduz e entrega.

Duas decisões aqui não são óbvias e custam caro se saírem erradas:

**Captura do MAIN, não do sub.** O preview é a base para desenhar o
recorte e também é o que informa `resolucao_h` à nuvem. Capturar do
sub-stream faria o sistema acreditar que o canal entrega 704 px quando
entrega 1920 — e o motor de dimensionamento passaria a recusar regras que
a câmera sustenta, ou a recomendar equipamento que ninguém precisa
comprar.

**A dimensão relatada é a ORIGINAL, não a transportada.** A imagem é
reduzida para viajar, mas quem decide `resolucao_h` é o sensor, não a
conveniência de banda. Relatar 1280 porque foi o que trafegou seria
mentir sobre a câmera por causa de uma escolha de transporte.
"""

from __future__ import annotations

import base64
import logging
import time
from dataclasses import dataclass
from datetime import datetime

import cv2

from farol_agent.pipeline import qualidade, recorte

_log = logging.getLogger(__name__)

# Basta de sobra para desenhar um retângulo e segura o JPEG em poucas
# centenas de kB. Mandar 1920 seria pagar banda da loja por pixel que
# ninguém vai olhar — o desenho é grosso, não é inspeção.
LADO_MAIOR_PADRAO = 1280
JPEG_PADRAO = 82


@dataclass
class QuadroDePreview:
    imagem_base64: str
    tipo: str
    # Do quadro CAPTURADO, não do transportado.
    largura: int
    altura: int
    bytes: int
    rosto_borrado: bool
    ms: int


class ErroDoPreview(Exception):
    pass


def capturar(
    fonte,
    *,
    lado_maior: int = LADO_MAIOR_PADRAO,
    jpeg: int = JPEG_PADRAO,
    rajada: int = 4,
    borrar_rosto: bool = True,
) -> QuadroDePreview:
    """Um quadro do canal, pronto para subir.

    `fonte` segue o mesmo contrato do pipeline (`rajada`), então o
    sandbox serve de dublê e o preview se testa sem câmera.
    """
    inicio = time.monotonic()

    quadros = fonte.rajada(datetime.now(), quantidade=rajada)
    if not quadros:
        raise ErroDoPreview("o canal não entregou quadro nenhum")

    # Mesmo critério do pipeline: descarta os primeiros, que vêm do buffer
    # do RTSP e trazem artefato. Preview sujo faz o usuário desenhar a
    # área olhando um quadro que não representa a cena.
    melhor = qualidade.melhor_quadro(quadros, descartar=min(2, len(quadros) - 1))
    if melhor is None:
        raise ErroDoPreview("não consegui escolher um quadro")

    utilizavel, porque = qualidade.cena_utilizavel(melhor.imagem)
    if not utilizavel:
        # Subir a tela de "sem sinal" do gravador faria o usuário desenhar
        # uma área sobre um retângulo preto, e a regra nasceria mirando o
        # nada.
        raise ErroDoPreview(f"o canal não entregou cena: {porque}")

    largura_real, altura_real = melhor.largura, melhor.altura

    f = melhor
    borrou = False
    if borrar_rosto:
        # Esta é a única imagem do produto que sai da loja SEM recorte —
        # é preciso ver o que está fora da área para decidir onde cortar.
        # Por isso o borrão aqui não é conforto: é o que impede uma foto
        # aberta da operação de viajar com rosto reconhecível.
        f, borrou = recorte.borrar_rostos(f)

    f = recorte.redimensionar(f, lado_maior)

    ok, buffer = cv2.imencode(".jpg", f.imagem, [int(cv2.IMWRITE_JPEG_QUALITY), jpeg])
    if not ok:
        raise ErroDoPreview("falhei ao codificar o JPEG")

    dados = buffer.tobytes()
    return QuadroDePreview(
        imagem_base64=base64.b64encode(dados).decode("ascii"),
        tipo="image/jpeg",
        largura=largura_real,
        altura=altura_real,
        bytes=len(dados),
        rosto_borrado=borrou,
        ms=int((time.monotonic() - inicio) * 1000),
    )
