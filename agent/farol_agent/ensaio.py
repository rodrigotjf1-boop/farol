"""Rejulgar imagens já capturadas, para comparar modelo e prompt.

Toda decisão de modelo, de critério e de foto de referência vira uma
pergunta empírica: **isto acerta mais que aquilo nas MESMAS imagens?**

Comparar contra a câmera ao vivo não responde — a cena muda entre uma
execução e outra, e aí não se sabe se a diferença veio do modelo ou do
que estava na mesa. As imagens enviadas ficam em disco justamente por
isso: o conjunto é fixo, então a comparação é controlada.

É também o que separa "o Haiku errou" de "este erro é de modelo barato".
Em 05/10/2026 o Haiku leu um mouse como controle remoto duas vezes, com
85% e 95% de confiança. A pergunta seguinte — o Sonnet acertaria? e com
foto de referência da própria loja? — só tem resposta aqui.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from farol_agent.juizes.base import ErroDoJuiz, Juiz
from farol_agent.modelos import Resultado, Veredito

# Nomes curtos para a linha de comando. O ID completo muda com a data da
# versão e ninguém decora.
MODELOS = {
    "haiku": "claude-haiku-4-5-20251001",
    "sonnet": "claude-sonnet-5-5",
    "opus": "claude-opus-5-5",
}

EXTENSOES = {".jpg", ".jpeg", ".png", ".webp"}


@dataclass
class Caso:
    """Uma imagem julgada, com o gabarito ao lado quando existe."""

    arquivo: Path
    veredito: Veredito | None = None
    erro: str | None = None
    esperado: Resultado | None = None

    @property
    def acertou(self) -> bool | None:
        """None quando não há gabarito ou não houve veredito."""
        if self.esperado is None or self.veredito is None:
            return None
        return self.veredito.resultado is self.esperado


@dataclass
class Ensaio:
    casos: list[Caso] = field(default_factory=list)
    centavos: float = 0.0

    @property
    def com_gabarito(self) -> list[Caso]:
        return [c for c in self.casos if c.acertou is not None]

    @property
    def acertos(self) -> int:
        return sum(1 for c in self.com_gabarito if c.acertou)

    @property
    def acuracia(self) -> float | None:
        julgados = self.com_gabarito
        return (self.acertos / len(julgados)) if julgados else None

    @property
    def erros_confiantes(self) -> list[Caso]:
        """Os que erraram com confiança alta.

        São a classe de erro que mais importa, e a que o produto hoje NÃO
        detecta: a cascata escala quando a confiança está baixa, então um
        erro a 95% passa por ela intocado. Contá-los separadamente é o que
        impede de ler "80% de acurácia" como tranquilidade.
        """
        return [
            c
            for c in self.com_gabarito
            if c.acertou is False
            and c.veredito is not None
            and (c.veredito.confianca or 0.0) >= 0.85
        ]


def carregar_gabarito(caminho: str | Path | None) -> dict[str, Resultado]:
    """JSON `{"arquivo.jpg": "conforme", …}` → gabarito.

    Recusa valor que não seja um `Resultado` em vez de ignorar em silêncio:
    gabarito errado contamina toda conclusão tirada dele, e o estrago só
    aparece depois de uma decisão de produto já tomada.
    """
    if not caminho:
        return {}

    dados = json.loads(Path(caminho).read_text(encoding="utf-8"))
    if not isinstance(dados, dict):
        raise ValueError("o gabarito tem que ser um objeto {arquivo: resultado}")

    validos = {r.value for r in Resultado}
    gabarito: dict[str, Resultado] = {}
    for arquivo, esperado in dados.items():
        if esperado not in validos:
            raise ValueError(
                f"{arquivo}: '{esperado}' não é resultado válido "
                f"(use {', '.join(sorted(validos))})"
            )
        gabarito[arquivo] = Resultado(esperado)
    return gabarito


def imagens_de(pasta: str | Path) -> list[Path]:
    p = Path(pasta)
    if p.is_file():
        return [p]
    return sorted(a for a in p.iterdir() if a.suffix.lower() in EXTENSOES)


def rodar(
    juiz: Juiz,
    arquivos: list[Path],
    criterio: str,
    *,
    referencias: list[Path] | None = None,
    gabarito: dict[str, Resultado] | None = None,
    contexto: dict[str, Any] | None = None,
) -> Ensaio:
    """Julga cada arquivo e junta o resultado."""
    gabarito = gabarito or {}
    ensaio = Ensaio()

    for arquivo in arquivos:
        caso = Caso(arquivo=arquivo, esperado=gabarito.get(arquivo.name))
        try:
            caso.veredito = juiz.julgar(
                arquivo, criterio, contexto=contexto, referencias=referencias
            )
            if caso.veredito.custo_centavos:
                ensaio.centavos += caso.veredito.custo_centavos
        except ErroDoJuiz as e:
            caso.erro = str(e)
            if not e.recuperavel:
                ensaio.casos.append(caso)
                break
        ensaio.casos.append(caso)

    return ensaio
