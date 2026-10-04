"""Contrato do juiz.

Um juiz recebe uma imagem e um critério e devolve um Veredito. Só isso.

A abstração existe porque o Farol vai ter quatro: nuvem (API da Anthropic),
local (VLM no PC da loja), comparação (embedding contra a base de
conhecimento) e detector (modelo de visão, para contagem). A regra escolhe
qual, e o resto do agente não precisa saber a diferença.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Protocol

from farol_agent.modelos import Veredito


class Juiz(Protocol):
    """Quem sabe transformar imagem + critério em veredito."""

    nome: str

    def julgar(
        self,
        imagem: Path,
        criterio: str,
        *,
        contexto: dict[str, Any] | None = None,
    ) -> Veredito:
        ...


class ErroDoJuiz(Exception):
    """Falha ao julgar.

    `recuperavel` separa o que vale retentar (rede caiu, 429, 529) do que
    não vale (crédito acabou, chave inválida, imagem corrompida). Sem essa
    distinção a fila fica martelando para sempre um erro que nunca vai
    passar, ou desiste de um que passaria em trinta segundos.
    """

    def __init__(self, mensagem: str, *, recuperavel: bool = True) -> None:
        super().__init__(mensagem)
        self.recuperavel = recuperavel
