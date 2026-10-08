"""As fotos padrão que a loja tem em disco.

A foto padrão de um canal é o quadro dele com o ambiente como deve ficar. Ela
mora na nuvem (é lá que o console a guarda e mostra) e a loja mantém uma
cópia, porque é a loja que compara — a cada olhada, sem internet.

A configuração diz o que cada canal TEM (`id`, `nome` e o `sha256` da
imagem). Este módulo cuida do resto:

- baixa o que falta, uma imagem por vez, e confere o resumo antes de aceitar;
- larga o que não está mais na configuração;
- entrega as imagens de um canal já abertas.

**Falha de rede não é falha da loja.** Uma foto que não desceu fica na lista
do que falta e é pedida de novo mais tarde; enquanto isso, o canal compara
com as que tem. Se não tem nenhuma, o juiz diz que não deu para avaliar e
por quê — não inventa veredito.
"""

from __future__ import annotations

import hashlib
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np

from farol_agent import imagens

_log = logging.getLogger(__name__)


@dataclass(frozen=True)
class PadraoRef:
    """Uma foto padrão, como a configuração a descreve."""

    id: str
    nome: str
    sha256: str


class Padroes:
    def __init__(self, pasta: str | Path, baixar: Callable[[str], bytes] | None = None) -> None:
        self.pasta = Path(pasta)
        # Os recortes das fotos por área, que vão junto à nuvem. Quem grava
        # é o juiz; quem apaga os de foto excluída é este módulo.
        self.recortes = self.pasta / "recortes"
        self._baixar = baixar
        self._por_ponto: dict[str, list[PadraoRef]] = {}
        self._abertas: dict[str, np.ndarray] = {}
        # O que já foi conferido contra o resumo: (foto, quando mudou, tamanho).
        # Evita reler o arquivo inteiro a cada volta do agente.
        self._conferidas: dict[str, tuple[int, int]] = {}
        # Por que cada foto ainda não desceu. Some quando desce.
        self.falhas: dict[str, str] = {}

    # ───────────────────────── o que a loja deve ter ─────────────────────────

    def declarar(self, por_ponto: dict[str, list[PadraoRef]]) -> None:
        """O que a configuração diz que cada canal tem. Não baixa nada."""
        self._por_ponto = {p: list(refs) for p, refs in por_ponto.items() if refs}
        conhecidas = {r.id for refs in self._por_ponto.values() for r in refs}
        for foto_id in list(self._abertas):
            if foto_id not in conhecidas:
                del self._abertas[foto_id]
        for foto_id in list(self.falhas):
            if foto_id not in conhecidas:
                del self.falhas[foto_id]
        self._largar_o_que_saiu(conhecidas)

    def tem(self, ponto_id: str | None) -> bool:
        """O canal tem foto padrão, segundo a configuração?"""
        return bool(ponto_id) and bool(self._por_ponto.get(str(ponto_id)))

    def _arquivo(self, ref: PadraoRef) -> Path:
        return self.pasta / f"{ref.id}.jpg"

    def _em_disco(self, ref: PadraoRef) -> bool:
        arq = self._arquivo(ref)
        if not arq.is_file():
            self._conferidas.pop(ref.id, None)
            return False
        info = arq.stat()
        marca = (info.st_mtime_ns, info.st_size)
        if self._conferidas.get(ref.id) == marca:
            return True
        if hashlib.sha256(arq.read_bytes()).hexdigest() != ref.sha256:
            return False
        self._conferidas[ref.id] = marca
        return True

    def faltam(self) -> list[PadraoRef]:
        """As fotos declaradas que ainda não estão (inteiras) em disco."""
        return [r for refs in self._por_ponto.values() for r in refs if not self._em_disco(r)]

    # ───────────────────────── baixar e largar ─────────────────────────

    def baixar_o_que_falta(self) -> int:
        """Pede à nuvem cada foto que falta. Devolve quantas desceram."""
        if self._baixar is None:
            return 0
        desceram = 0
        for ref in self.faltam():
            try:
                dados = self._baixar(ref.id)
            except Exception as e:  # noqa: BLE001
                # A rede volta; a foto é pedida de novo na próxima vez.
                self.falhas[ref.id] = str(e)
                _log.warning("não baixei a foto padrão “%s”: %s", ref.nome, e)
                continue
            resumo = hashlib.sha256(dados).hexdigest()
            if resumo != ref.sha256:
                # Imagem cortada no caminho, ou outra imagem: comparar com
                # ela seria comparar com o que ninguém guardou.
                self.falhas[ref.id] = "a imagem que desceu não é a que a nuvem descreveu"
                _log.warning("a foto padrão “%s” desceu diferente do resumo: descartada", ref.nome)
                continue
            self.pasta.mkdir(parents=True, exist_ok=True)
            destino = self._arquivo(ref)
            temporario = destino.with_suffix(".tmp")
            temporario.write_bytes(dados)
            # Troca atômica: queda de luz no meio não deixa meia imagem.
            os.replace(temporario, destino)
            self.falhas.pop(ref.id, None)
            self._abertas.pop(ref.id, None)
            desceram += 1
            _log.info("foto padrão “%s” em disco (%d kB)", ref.nome, len(dados) // 1024)
        return desceram

    def _largar_o_que_saiu(self, conhecidas: set[str]) -> None:
        """Foto excluída no console some do disco da loja — ela e os recortes dela."""
        if not self.pasta.is_dir():
            return
        for arq in self.pasta.glob("*.jpg"):
            if arq.stem not in conhecidas:
                try:
                    arq.unlink()
                    _log.info("foto padrão %s saiu da configuração: apagada do disco", arq.stem)
                except OSError as e:
                    _log.warning("não apaguei %s: %s", arq.name, e)
        if not self.recortes.is_dir():
            return
        for arq in self.recortes.glob("*.jpg"):
            # "<foto>_<área>_<desenho>.jpg"
            if arq.name.split("_", 1)[0] not in conhecidas:
                try:
                    arq.unlink()
                except OSError as e:
                    _log.warning("não apaguei %s: %s", arq.name, e)

    # ───────────────────────── entregar ─────────────────────────

    def do_ponto(self, ponto_id: str | None) -> list[tuple[PadraoRef, np.ndarray]]:
        """As fotos do canal que estão em disco, abertas. Da mais nova para a mais antiga."""
        saida: list[tuple[PadraoRef, np.ndarray]] = []
        for ref in self._por_ponto.get(str(ponto_id), []) if ponto_id else []:
            img = self._abertas.get(ref.id)
            if img is None:
                if not self._em_disco(ref):
                    continue
                img = imagens.ler(str(self._arquivo(ref)))
                if img is None:
                    self.falhas[ref.id] = "o arquivo da foto não abre como imagem"
                    continue
                self._abertas[ref.id] = img
            saida.append((ref, img))
        return saida
