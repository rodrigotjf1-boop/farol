"""FonteSandbox — reproduz uma pasta de quadros como se fosse câmera ao vivo.

É a peça que torna o método de trabalho possível. Sem ela, cada teste depende
de ir ao restaurante, esperar o horário certo e torcer para a cena acontecer —
e é aí que o projeto trava e perde o fio.

Com ela, o mesmo cenário se reproduz em segundos, quantas vezes quiser, e dá
para comparar duas versões de prompt contra exatamente o mesmo material. É
também o que viabiliza o conjunto de avaliação e a medição de acurácia.

Duas formas de datar os quadros:

  1. nome do arquivo com timestamp — `canal5_20260718_160119.jpg`
  2. sequencial — na ordem alfabética, a partir de `inicio`, à taxa `fps`
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Iterator

import cv2

from farol_agent.fontes.base import FonteVideo
from farol_agent.modelos import Frame

# canal5_20260718_160119.jpg · 20260718_160119.png · qualquer coisa_AAAAMMDD_HHMMSS
_PADRAO_TS = re.compile(r"(\d{8})[_\-](\d{6})")

_EXTENSOES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


class FonteSandbox(FonteVideo):
    """Lê quadros de disco e os serve com relógio simulado."""

    def __init__(
        self,
        pasta: str | Path,
        ponto_id: str,
        inicio: datetime | None = None,
        fps: float = 1.0,
    ) -> None:
        self.pasta = Path(pasta)
        self.ponto_id = ponto_id
        self.fps = fps

        if not self.pasta.is_dir():
            raise FileNotFoundError(f"pasta de sandbox não encontrada: {self.pasta}")

        arquivos = sorted(
            p for p in self.pasta.iterdir()
            if p.is_file() and p.suffix.lower() in _EXTENSOES
        )
        if not arquivos:
            raise ValueError(f"nenhum quadro em {self.pasta}")

        base = inicio or datetime(2026, 1, 1, 8, 0, 0)
        passo = timedelta(seconds=1.0 / fps if fps > 0 else 1.0)

        # (timestamp, caminho), ordenado no tempo
        self._quadros: list[tuple[datetime, Path]] = []
        for i, arq in enumerate(arquivos):
            ts = self._ts_do_nome(arq) or (base + passo * i)
            self._quadros.append((ts, arq))
        self._quadros.sort(key=lambda x: x[0])

    # ────────────────────────── utilidades ──────────────────────────

    @staticmethod
    def _ts_do_nome(arq: Path) -> datetime | None:
        m = _PADRAO_TS.search(arq.stem)
        if not m:
            return None
        try:
            return datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M%S")
        except ValueError:
            return None

    def _ler(self, ts: datetime, caminho: Path) -> Frame | None:
        imagem = cv2.imread(str(caminho))
        if imagem is None:
            return None
        return Frame(imagem=imagem, ts=ts, ponto_id=self.ponto_id, stream="main")

    @property
    def inicio(self) -> datetime:
        return self._quadros[0][0]

    @property
    def fim(self) -> datetime:
        return self._quadros[-1][0]

    def __len__(self) -> int:
        return len(self._quadros)

    # ───────────────────────── contrato ─────────────────────────────

    def quadro(self, ts: datetime, stream: str = "main") -> Frame | None:
        """O quadro cujo timestamp está mais próximo de `ts`."""
        melhor = min(self._quadros, key=lambda x: abs((x[0] - ts).total_seconds()))
        return self._ler(melhor[0], melhor[1])

    def rajada(
        self, ts: datetime, quantidade: int = 6, stream: str = "main"
    ) -> list[Frame]:
        """`quantidade` quadros a partir do mais próximo de `ts`.

        No sandbox não há buffer sujo para descartar, mas a assinatura é a
        mesma do RTSP de propósito: o pipeline que escolhe o melhor quadro
        roda idêntico nos dois, e o que foi calibrado aqui vale lá.
        """
        idx = min(
            range(len(self._quadros)),
            key=lambda i: abs((self._quadros[i][0] - ts).total_seconds()),
        )
        saida: list[Frame] = []
        for ts_q, caminho in self._quadros[idx : idx + quantidade]:
            f = self._ler(ts_q, caminho)
            if f is not None:
                saida.append(f)
        return saida

    def intervalo(
        self, ini: datetime, fim: datetime, fps: float = 2.0, stream: str = "sub"
    ) -> Iterator[Frame]:
        """Quadros entre `ini` e `fim`, reamostrados para `fps`."""
        passo = timedelta(seconds=1.0 / fps if fps > 0 else 1.0)
        alvo = ini
        ultimo: Path | None = None
        while alvo <= fim:
            cand = min(
                self._quadros, key=lambda x: abs((x[0] - alvo).total_seconds())
            )
            # Não repetir o mesmo arquivo quando o fps pedido é maior que o
            # material disponível — melhor devolver menos que duplicar.
            if cand[1] != ultimo:
                f = self._ler(cand[0], cand[1])
                if f is not None:
                    # O tempo que vale é o da linha simulada, não o do arquivo
                    f.ts = alvo
                    yield f
                ultimo = cand[1]
            alvo += passo

    def fechar(self) -> None:
        self._quadros.clear()
