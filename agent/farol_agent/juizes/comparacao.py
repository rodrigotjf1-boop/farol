"""Juiz de comparação — o caso comum, de graça.

Compara o quadro com o que a loja já sabe que é certo (a base de
conhecimento) e só chama um modelo quando a cena não se parece com nada
conhecido. Numa cozinha, a maior parte do tempo a cena É a conhecida: a
bancada está do jeito de sempre, a passagem está livre do jeito de sempre.

Três faixas, e a do meio é a que importa:

    sim >= limiar                     → conforme (custo zero)
    limiar > sim > limiar - margem    → escala: cena nova, não irregular
    sim <= limiar - margem            → destoa do conhecido

Sem a faixa do meio, toda cena legítima porém nova — caixa de insumo
diferente, luz de fim de tarde, funcionário novo de altura diferente —
viraria alerta. A loja desligaria o sistema na primeira semana, e com
razão.
"""

from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Any

from farol_agent.base_conhecimento import BaseConhecimento, Embedder
from farol_agent import imagens
from farol_agent.juizes.base import ErroDoJuiz, Juiz
from farol_agent.modelos import Resultado, Veredito, Via

_log = logging.getLogger(__name__)


class JuizComparacao:
    nome = "comparacao"

    def __init__(
        self,
        embedder: Embedder,
        bases: dict[str, BaseConhecimento],
        *,
        escalar_para: Juiz | None = None,
        exigir_base_pronta: bool = True,
    ) -> None:
        self.embedder = embedder
        self.bases = bases
        self.escalar_para = escalar_para
        self.exigir_base_pronta = exigir_base_pronta

    def julgar(
        self,
        imagem: Path,
        criterio: str,
        *,
        contexto: dict[str, Any] | None = None,
        referencias: list[Path] | None = None,
    ) -> Veredito:
        inicio = time.monotonic()
        base_id = (contexto or {}).get("base_id")

        base = self.bases.get(str(base_id)) if base_id else None
        if base is None:
            return self._escalar(
                imagem, criterio, contexto,
                motivo=f"regra sem base de conhecimento utilizável (base_id={base_id!r})",
            )

        if self.exigir_base_pronta and not base.pronta:
            # Base com uma ou duas referências acusa tudo que for diferente.
            # Melhor pagar o modelo do que ensinar a loja a ignorar alerta.
            return self._escalar(
                imagem, criterio, contexto,
                motivo=f"base {base.id} tem só {len(base.referencias)} referências (mínimo 3)",
            )

        img = imagens.ler(str(imagem))
        if img is None:
            raise ErroDoJuiz(f"não li a imagem {imagem}", recuperavel=False)

        sim = base.similaridade(self.embedder.embed(img))
        ms = int((time.monotonic() - inicio) * 1000)

        if sim >= base.limiar:
            return Veredito(
                resultado=Resultado.CONFORME,
                confianca=_confianca_acima(sim, base.limiar),
                motivo=f"igual ao conhecido da base {base.nome} (similaridade {sim:.3f})",
                via=Via.COMPARACAO,
                modelo=f"comparacao:{base.id}",
                custo_centavos=0.0,
                latencia_ms=ms,
            )

        if sim > base.limiar - base.margem:
            return self._escalar(
                imagem, criterio, contexto,
                motivo=(
                    f"similaridade {sim:.3f} na banda de incerteza da base "
                    f"{base.nome} ({base.limiar - base.margem:.3f}..{base.limiar:.3f})"
                ),
            )

        return Veredito(
            resultado=Resultado.NAO_CONFORME,
            confianca=_confianca_abaixo(sim, base.limiar - base.margem),
            motivo=f"destoa do conhecido da base {base.nome} (similaridade {sim:.3f})",
            via=Via.COMPARACAO,
            modelo=f"comparacao:{base.id}",
            custo_centavos=0.0,
            latencia_ms=ms,
        )

    def _escalar(
        self,
        imagem: Path,
        criterio: str,
        contexto: dict[str, Any] | None,
        *,
        motivo: str,
    ) -> Veredito:
        if self.escalar_para is None:
            # Sem para quem escalar, a resposta honesta é "não sei" — e
            # `nao_avaliavel` é exatamente isso, não um erro.
            _log.info("comparação sem escalada: %s", motivo)
            return Veredito(
                resultado=Resultado.NAO_AVALIAVEL,
                confianca=None,
                motivo=motivo,
                via=Via.COMPARACAO,
                modelo="comparacao",
                custo_centavos=0.0,
            )

        _log.info("comparação escalou para %s: %s", self.escalar_para.nome, motivo)
        v = self.escalar_para.julgar(imagem, criterio, contexto=contexto)
        v.motivo = f"{v.motivo} [escalado: {motivo}]" if v.motivo else motivo
        return v


def _confianca_acima(sim: float, limiar: float) -> float:
    """Quanto mais acima do limiar, mais confiante — saturando em 1,0."""
    if limiar >= 1.0:
        return 1.0
    return round(min(1.0, 0.5 + 0.5 * (sim - limiar) / (1.0 - limiar)), 3)


def _confianca_abaixo(sim: float, piso: float) -> float:
    """Quanto mais abaixo do piso, mais confiante de que destoa."""
    if piso <= 0.0:
        return 1.0
    return round(min(1.0, 0.5 + 0.5 * (piso - sim) / piso), 3)
