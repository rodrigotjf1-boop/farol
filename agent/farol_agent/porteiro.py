"""O porteiro — a loja decide se vale perguntar à nuvem.

No primeiro dia inteiro de operação (07/10/2026) a loja fez 856 perguntas à
nuvem e 802 voltaram "não deu para avaliar": 94% do gasto sem veredito. No
canal em que o detector também olhava, 271 das 482 perguntas foram feitas
**sem ninguém na imagem** — e nenhuma delas deu veredito. A loja sabia, de
graça, que não havia o que perguntar.

O porteiro é essa conferência, feita antes de a imagem entrar na fila:

- ``pessoa``     só vale perguntar com gente na área (uniforme, touca, uso
                 de um equipamento);
- ``livre``      só vale com a área livre (limpeza, organização: uma pessoa
                 na frente esconde o que se quer ver);
- ``movimento``  só vale quando algo mudou desde a olhada anterior (ação:
                 sem movimento não há o que julgar);
- ``sempre``     pergunta em toda olhada, como era.

## Na dúvida, pergunta

Segurar uma pergunta que tinha resposta é pior do que fazer uma que não
tinha: a primeira esconde um problema, a segunda custa um centavo. Por isso
o porteiro só segura quando tem **certeza**:

- ``pessoa``: segura se o detector não viu nem um "talvez";
- ``livre``: segura se o detector viu alguém com certeza.

O que ficou no meio — o casaco pendurado que parece gente, a pessoa cortada
no canto — passa. E sem detector instalado, tudo passa: o porteiro não
decide o que não consegue ver.

A olhada segurada não é análise: não vai à nuvem, não custa e não entra em
"não deu para avaliar". No resumo da hora ela é contada como "nada a
conferir" (``sem_condicao``).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import cv2
import numpy as np

_log = logging.getLogger(__name__)

PORTEIROS = ("sempre", "pessoa", "livre", "movimento")

# O quadro reduzido em que se mede o movimento. Pequeno de propósito: ruído
# de sensor e compressão somem na redução; gente e objeto mudando de lugar,
# não.
_MOVIMENTO_LADO = (96, 54)
# Um ponto "mudou" quando o tom dele variou mais do que isto (de 0 a 255)...
SALTO_DO_PONTO = 24
# ...e a cena "mexeu" quando pelo menos esta parte dos pontos mudou.
PARTE_QUE_MUDOU = 0.012


@dataclass(frozen=True)
class Decisao:
    """Se vale perguntar e, quando não vale, por quê."""

    vale: bool
    motivo: str | None = None


_VALE = Decisao(True)


class Porteiro:
    """Decide, por critério e por olhada, se a pergunta faz sentido.

    `detector` é o motor de detecção (o mesmo do juiz de presença) ou
    `None`. `certeza` e `duvida` são os limiares dele.
    """

    def __init__(
        self,
        detector: Any = None,
        *,
        classe_pessoa: str = "person",
        certeza: float = 0.70,
        duvida: float = 0.35,
        salto: int = SALTO_DO_PONTO,
        parte: float = PARTE_QUE_MUDOU,
    ) -> None:
        self.detector = detector
        self.classe_pessoa = classe_pessoa
        self.certeza = certeza
        self.duvida = duvida
        self.salto = salto
        self.parte = parte
        # A cena anterior de cada lugar, reduzida, para medir o movimento.
        self._anterior: dict[str, np.ndarray] = {}
        # A última contagem de pessoas, por área e instante: três critérios
        # na mesma área saem da mesma olhada, e o detector roda uma vez.
        self._visto: tuple[str, datetime, list[float]] | None = None
        self._avisou_sem_detector = False

    # ─────────────────────────── a decisão ───────────────────────────

    def decidir(self, modo: str, imagem_bgr: np.ndarray, *, lugar: str, area: str, ts: datetime) -> Decisao:
        """`lugar` é o critério naquela área; `area` é só a área."""
        if modo == "movimento":
            return self._movimento(imagem_bgr, lugar)
        if modo not in ("pessoa", "livre"):
            return _VALE

        pontos = self._pessoas(imagem_bgr, area, ts)
        if pontos is None:
            return _VALE
        if modo == "pessoa":
            # Nem um "talvez": aí sim, não há ninguém.
            if not any(p >= self.duvida for p in pontos):
                return Decisao(False, "ninguém na área")
            return _VALE
        if any(p >= self.certeza for p in pontos):
            return Decisao(False, "há gente na frente")
        return _VALE

    # ─────────────────────────── as medidas ───────────────────────────

    def _pessoas(self, imagem_bgr: np.ndarray, area: str, ts: datetime) -> list[float] | None:
        if self.detector is None:
            if not self._avisou_sem_detector:
                self._avisou_sem_detector = True
                _log.info(
                    "porteiro sem detector: critério que pede 'com pessoa' ou 'com a área "
                    "livre' vai perguntar em toda olhada. Rode: farol-agent detector instalar"
                )
            return None
        if self._visto is not None and self._visto[0] == area and self._visto[1] == ts:
            return self._visto[2]
        try:
            pontos = [float(p) for p in self.detector.pontuar(imagem_bgr, self.classe_pessoa)]
        except Exception as e:  # noqa: BLE001
            # Detector que falhou numa imagem não pode calar o critério:
            # sem a conta, pergunta.
            _log.warning("o porteiro não conseguiu contar pessoas (%s): pergunta mesmo assim", e)
            return None
        self._visto = (area, ts, pontos)
        return pontos

    def _movimento(self, imagem_bgr: np.ndarray, lugar: str) -> Decisao:
        cinza = cv2.cvtColor(imagem_bgr, cv2.COLOR_BGR2GRAY) if imagem_bgr.ndim == 3 else imagem_bgr
        pequeno = cv2.resize(cinza, _MOVIMENTO_LADO, interpolation=cv2.INTER_AREA).astype(np.int16)
        antes = self._anterior.get(lugar)
        # A referência é sempre a olhada ANTERIOR: o que se mede é o que
        # mudou de uma olhada para a outra.
        self._anterior[lugar] = pequeno
        if antes is None or antes.shape != pequeno.shape:
            # Primeira olhada: não há com o que comparar. Pergunta.
            return _VALE
        mudou = float(np.mean(np.abs(pequeno - antes) > self.salto))
        if mudou < self.parte:
            return Decisao(False, "nada se mexeu")
        return _VALE

    def esquecer(self, lugares_que_ficam: set[str]) -> None:
        """Larga a memória de critério que saiu da configuração."""
        for lugar in list(self._anterior):
            if lugar not in lugares_que_ficam:
                del self._anterior[lugar]
