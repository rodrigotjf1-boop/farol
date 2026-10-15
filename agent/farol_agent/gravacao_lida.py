"""Ler um pedaço de gravação do gravador: os quadros com a hora certa, e o recorte da área.

Serve a quem lê gravação no computador da loja — o leitor do expediente (R1 do repasse, `ferramentas/repasse/leitor.py`)
e a gravação de treino (A21, T3c). Mora no pacote do agente porque o pacote leva só `farol_agent`.

**A hora de cada quadro** é o começo do pedaço (no relógio do gravador) mais o RELÓGIO DE DENTRO da gravação,
consertado: ele recua às vezes (um terço de segundo, visto em 13/10/2026), e o recuo é ignorado guardando o maior
valor já visto. Enquanto ele não anda (parado no zero), vale a contagem dos quadros com a taxa provisória. No fim do
pedaço, quem lê confere se o relógio de dentro terminou perto do tamanho do pedaço; se não, a hora sai da contagem
(`instante`): a taxa de quadros muda dentro do pedaço (medido em 14/10/2026: 13,7 e 11,9 quadros por segundo em dois
pedaços seguidos), e a contagem pura chegou a errar 29,6 s — por isso ela é a reserva, não a regra.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path
from typing import Iterator

import cv2
import numpy as np

from farol_agent.configuracao import de_json
from farol_agent.modelos import Frame, Zona
from farol_agent.pipeline import recorte

# A taxa medida da gravação (3.851 quadros em 298,6 s, 13/10/2026): o relógio da leitura quando o de dentro não anda.
TAXA_PROVISORIA = 12.9
# O relógio de dentro só vale se terminar a até 10% do tamanho do pedaço (o medido: 300,2 s num pedaço de 300).
FOLGA_DO_RELOGIO_DE_DENTRO = 0.1


def instante(comeco: datetime, indice: int, total: int, duracao_s: float) -> datetime:
    """A hora do quadro `indice` de `total`, num pedaço de `duracao_s` que começa em `comeco` (pela contagem)."""
    if total <= 0:
        raise ValueError("pedaço sem quadro")
    return comeco + timedelta(seconds=indice * duracao_s / total)


def relogio_de_dentro_vale(fim_de_dentro_s: float, duracao_s: float) -> bool:
    """O relógio de dentro terminou perto do tamanho do pedaço? Senão, a hora sai da contagem."""
    return abs(fim_de_dentro_s - duracao_s) <= FOLGA_DO_RELOGIO_DE_DENTRO * duracao_s


def quadros_com_hora(arquivo: Path, *, taxa_provisoria: float = TAXA_PROVISORIA) -> Iterator[tuple[int, float, bool, np.ndarray]]:
    """Os quadros do pedaço, em ordem: (índice, segundos desde o começo do pedaço, se é do relógio de dentro, imagem).

    Os segundos são os do relógio de dentro consertado (nunca recua; a origem é o primeiro quadro) e, enquanto ele
    não anda, os da contagem (e aí o terceiro valor é falso). O pedaço que não abre não dá nenhum quadro.
    """
    cap = cv2.VideoCapture(str(arquivo), cv2.CAP_FFMPEG)
    try:
        if not cap.isOpened():
            return
        indice = -1
        origem: float | None = None
        de_dentro_s = 0.0
        while True:
            ok, imagem = cap.read()
            if not ok or imagem is None:
                break
            indice += 1
            ms = float(cap.get(cv2.CAP_PROP_POS_MSEC))
            if origem is None:
                origem = ms
            de_dentro_s = max(de_dentro_s, (ms - origem) / 1000.0)
            if de_dentro_s > 0.0:
                yield indice, de_dentro_s, True, imagem
            else:
                yield indice, indice / taxa_provisoria, False, imagem
    finally:
        cap.release()


def quadro_do_canal(config_json: dict, canal: int, numero: int | None = None) -> tuple[str, Zona]:
    """O ponto do canal e o quadro a medir: o de papel "montagem", senão o de `numero`, senão o primeiro."""
    config = de_json(config_json)
    ponto = next((p for p in config.pontos if p.canal == canal), None)
    if ponto is None:
        raise ValueError(f"o canal {canal} não está na configuração")
    quadros = sorted((z for z in ponto.zonas if z.numero is not None), key=lambda z: z.numero)
    if not quadros:
        raise ValueError(f"o canal {canal} não tem quadro desenhado")
    if numero is not None:
        escolhido = next((z for z in quadros if z.numero == numero), None)
        if escolhido is None:
            raise ValueError(f"o canal {canal} não tem o quadro {numero}")
        return str(ponto.id), escolhido
    return str(ponto.id), next((z for z in quadros if z.papel == "montagem"), quadros[0])


def guardar_recorte(imagem: np.ndarray, zona: Zona, destino: Path) -> None:
    """O quadro no tamanho da câmera, com o que é de fora do desenho apagado — o recorte do agente."""
    f, dentro = recorte.recortar_area(Frame(imagem, datetime.min, ""), zona)
    f = recorte.apagar_fora(f, dentro)
    ok, bytes_ = cv2.imencode(".jpg", f.imagem, [cv2.IMWRITE_JPEG_QUALITY, 90])
    if not ok:
        raise ValueError("não consegui gravar o recorte")
    destino.parent.mkdir(parents=True, exist_ok=True)
    # Pelos bytes, e não pelo caminho: com acento na pasta o OpenCV não grava (ERR-111).
    bytes_.tofile(str(destino))
