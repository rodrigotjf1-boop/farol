"""Juiz binário — probabilidade por pergunta, num passe só.

Recebe um esquema de perguntas de sim ou não e devolve a probabilidade de
cada uma. É o único caminho que atende prioridade **urgente**, porque
responde em dezenas de milissegundos, e é a base da verificação de
montagem.

## Por que veredito POR ITEM, e nunca agregado

Um sanduíche de oito ingredientes, com 95% de acerto por item, dá 66% de
acerto no veredito "o sanduíche está certo" — 0,95⁸. Um sistema que acerta
dois terços das vezes não serve para nada: a loja aprende a ignorá-lo em
duas semanas.

A saída, então, não é "o sanduíche está certo". É oito respostas: *tem
queijo? tem picles? tem bacon?* Cada uma com a própria probabilidade,
cada uma comparada ao próprio limiar. O que vai para a tela é o item que
falhou, não um veredito sobre o conjunto.

Esta classe **não oferece** um agregado de propósito. Se alguém precisar
dele, vai ter que escrevê-lo e, ao escrever, vai ter que encarar a conta
acima.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from farol_agent.juizes.base import ErroDoJuiz
from farol_agent.modelos import Resultado, Veredito, Via


@dataclass
class Pergunta:
    """Uma pergunta de sim ou não, com o que se espera para estar conforme."""

    id: str
    texto: str
    esperado: bool = True
    # Alto de propósito: a pergunta binária é usada onde o erro custa caro
    # (item faltando num pedido pago, EPI ausente).
    limiar: float = 0.90

    def avaliar(self, probabilidade: float) -> tuple[Resultado, float]:
        """Devolve `(resultado, confiança)` para esta pergunta."""
        p_sim = max(0.0, min(1.0, probabilidade))
        p_esperado = p_sim if self.esperado else 1.0 - p_sim

        if p_esperado >= self.limiar:
            return Resultado.CONFORME, round(p_esperado, 3)
        if (1.0 - p_esperado) >= self.limiar:
            return Resultado.NAO_CONFORME, round(1.0 - p_esperado, 3)
        # Nem uma coisa nem outra com convicção: dizer "não sei" é a
        # resposta honesta, e é o que impede o alerta falso.
        return Resultado.NAO_AVALIAVEL, round(max(p_esperado, 1.0 - p_esperado), 3)


@dataclass
class RespostaItem:
    pergunta: Pergunta
    probabilidade: float
    resultado: Resultado
    confianca: float


class MotorBinario(Protocol):
    """Quem roda o modelo e devolve uma probabilidade por pergunta."""

    nome_modelo: str

    def perguntar(self, imagem: Path, perguntas: list[str]) -> list[float]:
        """Probabilidade de "sim" para cada pergunta, na mesma ordem."""
        ...


class JuizBinario:
    nome = "binario"

    def __init__(self, motor: MotorBinario) -> None:
        self.motor = motor

    # ─────────────────── uso normal: uma pergunta ────────────────────

    def julgar(
        self,
        imagem: Path,
        criterio: str,
        *,
        contexto: dict[str, Any] | None = None,
        referencias: list[Path] | None = None,
    ) -> Veredito:
        """O critério da regra vira a pergunta."""
        ctx = contexto or {}
        pergunta = Pergunta(
            id="criterio",
            texto=criterio,
            esperado=bool(ctx.get("esperado", True)),
            limiar=float(ctx.get("limiar_binario", 0.90)),
        )
        inicio = time.monotonic()
        resposta = self.julgar_itens(imagem, [pergunta])[0]
        return Veredito(
            resultado=resposta.resultado,
            confianca=resposta.confianca,
            motivo=f"p(sim)={resposta.probabilidade:.3f} para: {criterio[:80]}",
            via=Via.DETECTOR,
            modelo=self.motor.nome_modelo,
            custo_centavos=0.0,
            latencia_ms=int((time.monotonic() - inicio) * 1000),
        )

    # ──────────────── uso da montagem: item por item ─────────────────

    def julgar_itens(
        self, imagem: Path, perguntas: list[Pergunta]
    ) -> list[RespostaItem]:
        """Uma resposta por pergunta. **Não existe resposta do conjunto.**"""
        if not perguntas:
            return []

        probabilidades = self.motor.perguntar(imagem, [p.texto for p in perguntas])
        if len(probabilidades) != len(perguntas):
            raise ErroDoJuiz(
                f"o motor devolveu {len(probabilidades)} probabilidades "
                f"para {len(perguntas)} perguntas",
                recuperavel=True,
            )

        saida = []
        for pergunta, p in zip(perguntas, probabilidades):
            resultado, confianca = pergunta.avaliar(float(p))
            saida.append(
                RespostaItem(
                    pergunta=pergunta,
                    probabilidade=float(p),
                    resultado=resultado,
                    confianca=confianca,
                )
            )
        return saida


def perguntas_da_ficha(itens: list[str], *, limiar: float = 0.90) -> list[Pergunta]:
    """Transforma a ficha técnica do Regem num esquema de perguntas.

    É aqui que classificação aberta vira verificação binária. Perguntar "o
    que tem neste sanduíche?" é problema aberto, com ~95% por item.
    Perguntar "tem picles? tem queijo?" — sabendo pela ficha que deveria ter
    — é problema fechado, e passa de 99%.

    O contexto do Regem não é enfeite: é o que muda a natureza da pergunta.
    """
    return [
        Pergunta(id=item, texto=f"O ingrediente '{item}' está presente?", limiar=limiar)
        for item in itens
    ]
