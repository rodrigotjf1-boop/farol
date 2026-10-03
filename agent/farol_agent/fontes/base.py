"""Abstração da fonte de vídeo.

Três implementações concretas na v1:

    FonteSandbox  — pasta de quadros gravados com relógio simulado
    FonteRTSP     — DVR ou câmera IP
    FonteUSB      — câmera UVC direto pelo OpenCV

O resto do agente não sabe qual está em uso. É isto que permite desenvolver e
testar o produto inteiro neste PC, sem depender de loja, câmera ou horário.
"""

from __future__ import annotations

from datetime import datetime
from typing import Iterator, Protocol, runtime_checkable

from farol_agent.modelos import Frame


@runtime_checkable
class FonteVideo(Protocol):
    """Contrato de qualquer fonte de quadros."""

    ponto_id: str

    def quadro(self, ts: datetime, stream: str = "main") -> Frame | None:
        """O quadro mais próximo de `ts`.

        Retorna None quando não há quadro disponível naquele instante — fora
        do horário gravado, no sandbox, ou falha de captura, no RTSP.
        """
        ...

    def rajada(
        self, ts: datetime, quantidade: int = 6, stream: str = "main"
    ) -> list[Frame]:
        """Vários quadros a partir de `ts`.

        O pipeline descarta os primeiros e escolhe o mais nítido: o primeiro
        quadro após abrir um RTSP costuma vir do buffer e ser um I-frame
        parcial, com artefato.
        """
        ...

    def intervalo(
        self, ini: datetime, fim: datetime, fps: float = 2.0, stream: str = "sub"
    ) -> Iterator[Frame]:
        """Sequência de quadros no intervalo, à taxa pedida.

        É o que alimenta regra do tipo `acao` e a verificação de montagem.
        """
        ...

    def fechar(self) -> None:
        ...
