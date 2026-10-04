"""Juiz simulado — roda o laço inteiro sem gastar nem depender de internet.

Não é brinquedo de teste: é a peça que permite exercitar fila, retentativa,
janela de silêncio, limiar de confiança e caminho do alerta contra o
material gravado, quantas vezes for preciso, de graça. Sem ele, cada ajuste
no motor custaria chamadas de API e uma ida ao restaurante.

O veredito é **determinístico por imagem** (sai do pHash), então a mesma
cena dá sempre o mesmo resultado e dá para comparar duas versões do motor
contra exatamente o mesmo material.
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

from farol_agent import imagens
from farol_agent.juizes.base import ErroDoJuiz
from farol_agent.modelos import Resultado, Veredito, Via
from farol_agent.pipeline import dedupe


class JuizSimulado:
    nome = "simulado"

    def __init__(
        self,
        *,
        fracao_nao_conforme: float = 0.30,
        fracao_nao_avaliavel: float = 0.10,
        confianca_base: float = 0.85,
        latencia_ms: int = 0,
    ) -> None:
        self.fracao_nao_conforme = fracao_nao_conforme
        self.fracao_nao_avaliavel = fracao_nao_avaliavel
        self.confianca_base = confianca_base
        self.latencia_ms = latencia_ms

    def julgar(
        self,
        imagem: Path,
        criterio: str,
        *,
        contexto: dict[str, Any] | None = None,
    ) -> Veredito:
        img = imagens.ler(str(imagem))
        if img is None:
            raise ErroDoJuiz(f"não li a imagem {imagem}", recuperavel=False)

        if self.latencia_ms:
            time.sleep(self.latencia_ms / 1000)

        # 0..1 derivado do hash: estável para a mesma cena, espalhado entre
        # cenas diferentes.
        h = dedupe.phash(img)
        sorteio = (h & 0xFFFF) / 0xFFFF
        oscila = ((h >> 16) & 0xFF) / 0xFF

        if sorteio < self.fracao_nao_avaliavel:
            resultado = Resultado.NAO_AVALIAVEL
        elif sorteio < self.fracao_nao_avaliavel + self.fracao_nao_conforme:
            resultado = Resultado.NAO_CONFORME
        else:
            resultado = Resultado.CONFORME

        confianca = min(1.0, max(0.0, self.confianca_base - 0.25 + oscila * 0.35))

        return Veredito(
            resultado=resultado,
            confianca=round(confianca, 2),
            motivo=f"simulado ({resultado.value}) para: {criterio[:60]}",
            via=Via.LOCAL,
            modelo="simulado",
            custo_centavos=0.0,
            latencia_ms=self.latencia_ms,
        )
