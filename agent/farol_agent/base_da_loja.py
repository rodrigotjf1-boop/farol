"""A base de conhecimento da loja no computador dela (A21, a parte da loja da fatia T5).

A nuvem guarda o que a loja ensinou — as fotos de referência (T1), os exemplos da bancada que a conferência guardou (T4)
e o "não se vê de cima" — e entrega a lista com a impressão (`GET /v1/agentes/base`) e cada quadro pelo id
(`GET /v1/agentes/base/quadros/:id`); o contrato é `contratos/base-de-conhecimento.json`. Aqui fica a cópia da loja, ao
lado da configuração:

- `base-da-loja/base.json`: a lista como veio (a impressão e os itens);
- `base-da-loja/quadros/<sha256>.jpg`: cada quadro, guardado pelo resumo. O que chega com resumo diferente do da lista
  não fica.

**Só o que falta.** A lista é pequena e vem inteira; o quadro só desce se ainda não está no disco (o quadro de um id
nunca muda de imagem). O que saiu da lista sai do disco. O quadro que a nuvem não acha mais (404) saiu da base no
caminho: fica para a próxima lista.

**Com a loja FECHADA** (`BaseEmFundo`), como a gravação de treino: a internet da loja é a dos pedidos. Uma vez a cada
`A_CADA_S` e na primeira volta com a loja fechada; a loja sem horário cadastrado não busca (e o registro diz por quê,
uma vez). À mão, quando quem instala quiser: `farol-agent ingredientes base`.

Quem lê: o juiz de ingrediente dos passos do lanche (`juizes.ingrediente.JuizDaLoja`).
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import threading
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Protocol

import numpy as np

from farol_agent import imagens
from farol_agent.configuracao import ler_do_disco
from farol_agent.nuvem import ErroDaNuvem
from farol_agent.treino_servico import janelas_da_loja, loja_fechada

_log = logging.getLogger(__name__)

PASTA = "base-da-loja"
LISTA = "base.json"
QUADROS = "quadros"
# Os vetores dos quadros, guardados pelo juiz de ingrediente (o modelo só olha o quadro novo).
VETORES = "vetores.json"
# De quanto em quanto tempo a base desce, com a loja fechada (a nuvem: "uma vez por dia"; aqui, a cada 6 horas: o que
# o dono conferiu à tarde já vale na abertura).
A_CADA_S = 6 * 3600.0
# A volta da linha de execução: sem nada a fazer (ou fora da hora), espera isto.
PAUSA_S = 300.0
_SHA = re.compile(r"^[0-9a-f]{64}$")


class ClienteDaBase(Protocol):
    def base_da_loja(self) -> dict[str, Any]: ...

    def quadro_da_base(self, quadro_id: str) -> bytes: ...


@dataclass(frozen=True)
class Descida:
    """O que uma descida da base fez: quantos ingredientes e quadros a lista tem; quantos quadros desceram agora, quantos
    não ficaram (o resumo não bateu), quantos a nuvem não achou mais (404) e quantos saíram do disco; se a impressão
    mudou."""

    itens: int
    quadros: int
    baixados: int
    recusados: int
    sumiram: int
    apagados: int
    mudou: bool


class BaseDaLoja:
    """A cópia da base na loja. A descida é uma por vez (a trava)."""

    def __init__(self, raiz: str | Path) -> None:
        self.raiz = Path(raiz)
        self._trava = threading.Lock()

    @classmethod
    def ao_lado(cls, caminho_config: str | Path) -> "BaseDaLoja":
        return cls(Path(caminho_config).parent / PASTA)

    @property
    def vetores(self) -> Path:
        return self.raiz / VETORES

    def lista(self) -> dict[str, Any] | None:
        """A lista em disco, ou nulo (nunca desceu, ou o arquivo está torto)."""
        try:
            bruto = json.loads((self.raiz / LISTA).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        return bruto if isinstance(bruto, dict) and isinstance(bruto.get("itens"), list) else None

    def impressao(self) -> str | None:
        lista = self.lista()
        return lista.get("impressao") if lista else None

    def caminho(self, sha256: str) -> Path:
        return self.raiz / QUADROS / f"{sha256}.jpg"

    def abrir(self, sha256: str) -> np.ndarray | None:
        if not isinstance(sha256, str) or not _SHA.match(sha256):
            return None
        return imagens.ler(self.caminho(sha256))

    def descer(self, cliente: ClienteDaBase) -> Descida:
        """A lista e os quadros que faltam. Erro de rede sobe (`ErroDaNuvem`): a cópia que havia fica como estava."""
        with self._trava:
            lista = cliente.base_da_loja()
            itens = lista.get("itens") if isinstance(lista, dict) else None
            if not isinstance(itens, list):
                raise ErroDaNuvem("a lista da base veio sem os itens")
            quer: dict[str, str] = {}
            for item in itens:
                quadros = item.get("quadros") if isinstance(item, dict) else None
                for q in quadros if isinstance(quadros, list) else []:
                    sha, qid = (q.get("sha256"), q.get("id")) if isinstance(q, dict) else (None, None)
                    if isinstance(sha, str) and _SHA.match(sha) and isinstance(qid, str):
                        quer.setdefault(sha, qid)
            pasta = self.raiz / QUADROS
            pasta.mkdir(parents=True, exist_ok=True)
            baixados = recusados = sumiram = 0
            for sha, qid in quer.items():
                destino = self.caminho(sha)
                if destino.is_file():
                    continue
                try:
                    dados = cliente.quadro_da_base(qid)
                except ErroDaNuvem as e:
                    if e.status == 404:
                        sumiram += 1
                        continue
                    raise
                if hashlib.sha256(dados).hexdigest() != sha:
                    recusados += 1
                    continue
                temporario = destino.with_name(destino.name + ".novo")
                temporario.write_bytes(dados)
                os.replace(temporario, destino)
                baixados += 1
            apagados = 0
            for arq in pasta.iterdir():
                if not arq.is_file():
                    continue
                if arq.name.endswith(".novo") or (arq.suffix == ".jpg" and arq.stem not in quer):
                    arq.unlink(missing_ok=True)
                    apagados += 1
            antes = self.impressao()
            temporario = self.raiz / (LISTA + ".novo")
            temporario.write_text(json.dumps(lista, ensure_ascii=False), encoding="utf-8")
            os.replace(temporario, self.raiz / LISTA)
            return Descida(len(itens), len(quer), baixados, recusados, sumiram, apagados, antes != lista.get("impressao"))


class BaseEmFundo:
    """A base desce numa linha de execução própria: com a loja FECHADA, uma vez a cada `a_cada_s`."""

    def __init__(
        self, cliente: ClienteDaBase, caminho_config: str | Path, *, relogio: Callable[[], datetime] = datetime.now,
        agora: Callable[[], float] = time.monotonic, pausa_s: float = PAUSA_S, a_cada_s: float = A_CADA_S,
        depois_de_mudar: Callable[[], Any] | None = None,
    ) -> None:
        self.cliente = cliente
        self.caminho_config = Path(caminho_config)
        self.base = BaseDaLoja.ao_lado(caminho_config)
        # A24 F3: quando a base muda (a marcação e a conferência do dono) — e na primeira descida depois que o agente
        # sobe —, o juiz se monta AQUI, com a loja fechada, e não no primeiro lanche da noite (o juiz treinado calcula
        # as 8 vistas de cada exemplo novo)
        self.depois_de_mudar = depois_de_mudar
        self._juiz_montado = False
        self._relogio, self._agora = relogio, agora
        self.pausa_s, self.a_cada_s = pausa_s, a_cada_s
        self._proxima: float | None = None
        self._avisou_sem_horario = False
        self._ultimo_erro: str | None = None
        self._parar = threading.Event()
        self._linha: threading.Thread | None = None

    def volta(self) -> Descida | None:
        """Uma volta: desce a base se a loja está fechada e já é hora. Devolve o que desceu, ou nulo."""
        if self._proxima is not None and self._agora() < self._proxima:
            return None
        config_json = ler_do_disco(self.caminho_config)
        if not config_json:
            return None
        fechada = loja_fechada(janelas_da_loja(config_json), self._relogio())
        if fechada is None:
            if not self._avisou_sem_horario:
                _log.info("base da loja: a loja não tem horário de funcionamento cadastrado; a base espera ele para descer")
                self._avisou_sem_horario = True
            return None
        if not fechada:
            return None
        try:
            d = self.base.descer(self.cliente)
        except ErroDaNuvem as e:
            # A mesma frase não volta ao registro a cada volta (ERR-014); o que não melhora repetindo espera a vez seguinte.
            if str(e) != self._ultimo_erro:
                _log.info("base da loja: não desceu agora (%s)", e)
                self._ultimo_erro = str(e)
            if not e.recuperavel:
                self._proxima = self._agora() + self.a_cada_s
            return None
        self._ultimo_erro = None
        self._proxima = self._agora() + self.a_cada_s
        if d.mudou or d.baixados or d.apagados or d.recusados or d.sumiram:
            _log.info(
                "base da loja: %d ingrediente(s), %d quadro(s); desceram %d, saíram %d%s%s", d.itens, d.quadros,
                d.baixados, d.apagados, f", {d.recusados} com o resumo errado (não ficaram)" if d.recusados else "",
                f", {d.sumiram} já não estavam na nuvem" if d.sumiram else "",
            )
        if self.depois_de_mudar is not None and (d.mudou or d.baixados or d.apagados or not self._juiz_montado):
            try:
                self.depois_de_mudar()
                self._juiz_montado = True
            except Exception:  # noqa: BLE001 — o juiz tenta de novo no primeiro lanche; a base já desceu
                _log.exception("base da loja: o juiz não se refez agora; ele tenta de novo no primeiro lanche")
        return d

    def _rodar(self) -> None:
        while not self._parar.is_set():
            try:
                self.volta()
            except Exception:  # noqa: BLE001 — um defeito numa volta não para a linha
                _log.exception("base da loja: erro inesperado; sigo")
            self._parar.wait(self.pausa_s)

    def iniciar(self) -> None:
        if self._linha is not None:
            return
        self._parar.clear()
        self._linha = threading.Thread(target=self._rodar, name="farol-base-da-loja", daemon=True)
        self._linha.start()

    def parar(self, espera_s: float = 10.0) -> None:
        self._parar.set()
        if self._linha is not None:
            self._linha.join(espera_s)
            self._linha = None
