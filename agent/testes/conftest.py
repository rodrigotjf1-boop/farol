"""Dublês compartilhados pelos testes.

A fonte sintética existe para que os testes não dependam de imagem
gravada: cada quadro tem ruído próprio, então o pHash muda e o
deduplicador não engole o segundo evento — que é justamente o que os
testes de janela de silêncio e de limiar precisam exercitar.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Iterator

import numpy as np
import pytest

from farol_agent.juizes.base import ErroDoJuiz
from farol_agent.modelos import (
    Frame,
    Janela,
    Prioridade,
    Regra,
    Resultado,
    Severidade,
    TipoRegra,
    Veredito,
    Via,
    Zona,
)

BASE = datetime(2026, 7, 18, 16, 0, 0)


class FonteSintetica:
    """Gera quadros com ruído determinístico por instante."""

    def __init__(self, ponto_id: str = "ponto-teste", largura: int = 640, altura: int = 480):
        self.ponto_id = ponto_id
        self.largura_q = largura
        self.altura_q = altura

    def _imagem(self, ts: datetime) -> np.ndarray:
        semente = int(ts.timestamp()) % (2**31)
        rng = np.random.default_rng(semente)
        return rng.integers(0, 255, (self.altura_q, self.largura_q, 3), dtype=np.uint8)

    def quadro(self, ts: datetime, stream: str = "main") -> Frame | None:
        return Frame(imagem=self._imagem(ts), ts=ts, ponto_id=self.ponto_id)

    def rajada(self, ts: datetime, quantidade: int = 6, stream: str = "main") -> list[Frame]:
        return [
            Frame(
                imagem=self._imagem(ts + timedelta(milliseconds=200 * i)),
                ts=ts + timedelta(milliseconds=200 * i),
                ponto_id=self.ponto_id,
            )
            for i in range(quantidade)
        ]

    def intervalo(self, ini, fim, fps: float = 2.0, stream: str = "sub") -> Iterator[Frame]:
        t = ini
        passo = timedelta(seconds=1 / fps)
        while t <= fim:
            yield Frame(imagem=self._imagem(t), ts=t, ponto_id=self.ponto_id)
            t += passo

    def fechar(self) -> None:
        pass


class JuizFixo:
    """Devolve sempre o mesmo veredito. Conta quantas vezes foi chamado."""

    nome = "fixo"

    def __init__(
        self,
        resultado: Resultado = Resultado.NAO_CONFORME,
        confianca: float = 0.95,
        erro: ErroDoJuiz | None = None,
    ) -> None:
        self.resultado = resultado
        self.confianca = confianca
        self.erro = erro
        self.chamadas = 0

    def julgar(self, imagem, criterio, *, contexto=None, referencias=None) -> Veredito:
        self.chamadas += 1
        if self.erro:
            raise self.erro
        return Veredito(
            resultado=self.resultado,
            confianca=self.confianca,
            motivo="dublê",
            via=Via.LOCAL,
            modelo="fixo",
            custo_centavos=0.0,
        )


@pytest.fixture
def zona() -> Zona:
    return Zona(
        id="z1",
        nome="zona de teste",
        poligono=[(0.1, 0.1), (0.9, 0.1), (0.9, 0.9), (0.1, 0.9)],
    )


@pytest.fixture
def regra(zona: Zona) -> Regra:
    return Regra(
        id="r1",
        zona=zona,
        nome="regra de teste",
        tipo=TipoRegra.ESTADO,
        criterio="a bancada está limpa",
        prioridade=Prioridade.INTERMEDIARIA,
        severidade=Severidade.ATENCAO,
        confianca_minima=0.70,
        cooldown_min=15,
        ativa=True,
        borrar_rosto=False,   # o dublê não tem rosto; pular acelera o teste
    )


@pytest.fixture
def fonte() -> FonteSintetica:
    return FonteSintetica()
