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
        referencias: list[Path] | None = None,
    ) -> Veredito:
        ...


# Quanto dos equipamentos da área vai junto com a pergunta. É texto pago a
# cada análise: o bastante para reconhecer, não o cadastro inteiro.
MAX_EQUIPAMENTOS_NO_PEDIDO = 4
MAX_DESCRICAO_NO_PEDIDO = 500


def bloco_dos_equipamentos(equipamentos: Any) -> str | None:
    """O trecho do pedido que apresenta os equipamentos da área — ou nada.

    Aceita o que vier no contexto (objetos com `nome`/`tipo`/`descricao`,
    ou dicionários): o contexto atravessa a fila em JSON.
    """
    linhas: list[str] = []
    for e in list(equipamentos or [])[:MAX_EQUIPAMENTOS_NO_PEDIDO]:
        ler = e.get if isinstance(e, dict) else (lambda k, _e=e: getattr(_e, k, None))
        nome, descricao = str(ler("nome") or "").strip(), str(ler("descricao") or "").strip()
        if not nome or not descricao:
            continue
        if len(descricao) > MAX_DESCRICAO_NO_PEDIDO:
            descricao = descricao[: MAX_DESCRICAO_NO_PEDIDO - 1].rstrip() + "…"
        linhas.append(f"- {nome}: {descricao}")
    if not linhas:
        return None
    return (
        "EQUIPAMENTOS NESTA ÁREA — como cada um é e como fica quando está limpo e no lugar "
        "(descrição guardada pela loja; serve para reconhecer o que aparece, não é o critério):\n"
        + "\n".join(linhas)
    )


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
