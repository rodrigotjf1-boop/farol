"""Abstração do gatilho.

Um gatilho responde a uma pergunta só: **quando vale a pena olhar?**

Sem ele, o agente teria que julgar quadro a quadro em dezesseis canais o
dia inteiro. Com ele, o trabalho caro acontece quando alguma coisa
aconteceu — e é essa diferença que define se o produto cabe num PC de
loja ou precisa de um servidor.

Quatro implementações na v1:

    GatilhoCGI       eventManager do gravador (Dahua/Intelbras)
    GatilhoWebhook   ISAPI httpHosts, para câmera com IA embarcada
    GatilhoDetector  RF-DETR na iGPU — classifica "é pessoa?" localmente
    GatilhoRelogio   simples passagem de tempo, para regra periódica

O motor de regras não sabe qual está em uso: todos emitem `EventoGatilho`.
"""

from __future__ import annotations

from typing import Iterator, Protocol, runtime_checkable

from farol_agent.modelos import EventoGatilho


@runtime_checkable
class Gatilho(Protocol):
    """Fonte de 'aconteceu alguma coisa aqui'."""

    nome: str

    def eventos(self) -> Iterator[EventoGatilho]:
        """Emite enquanto durar. Bloqueia entre um evento e outro."""
        ...

    def fechar(self) -> None:
        ...
