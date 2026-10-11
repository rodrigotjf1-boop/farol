"""A base de fichas que a loja tem em disco.

A base de fichas diz o que a loja vende e do que cada produto é feito. Ela
mora na nuvem (é lá que o console a mostra, e é a nuvem que a lê da fonte) e
a loja mantém uma cópia, porque é a loja que confere — a cada olhada, sem
internet.

A configuração diz QUAL base a loja tem de ter (a impressão do documento), ou
que não tem nenhuma. Este módulo cuida do resto:

- baixa o documento quando a impressão anunciada não é a da cópia;
- apaga a cópia quando a configuração diz que a loja não tem base;
- entrega o documento a quem for usar.

**Falha de rede não é falha da loja.** O documento que não desceu é pedido
de novo mais tarde; enquanto isso, vale a cópia que está em disco.

**Só a configuração apaga.** Nuvem fora do ar, resposta torta ou
configuração que não fala de fichas não tiram nada do disco: "não sei" não é
"não tem".
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

_log = logging.getLogger(__name__)

# O formato do documento que este agente entende. A nuvem que passe a mandar
# outro é mais nova que o agente: ele não guarda o que não sabe ler.
FORMATO = 1

_IMPRESSAO = re.compile(r"^[0-9a-f]{64}$")


@dataclass(frozen=True)
class FichasRef:
    """A base de fichas da loja, como a configuração a descreve."""

    # A impressão do documento. É uma marca de versão dada pela nuvem — a
    # loja não a recalcula, só compara.
    impressao: str
    produtos: int = 0
    com_ficha: int = 0


def ref_da_configuracao(bruto: Any) -> FichasRef | None:
    """A entrada `fichas` da configuração, quando ela descreve uma base.

    `None` para o que não descreve: quem chama é que sabe se a configuração
    disse "a loja não tem" (a entrada veio nula) ou não disse nada.
    """
    if not isinstance(bruto, dict):
        return None
    impressao = bruto.get("impressao")
    if not isinstance(impressao, str) or not _IMPRESSAO.match(impressao):
        return None
    return FichasRef(impressao=impressao, produtos=_inteiro(bruto.get("produtos")), com_ficha=_inteiro(bruto.get("comFicha")))


def _inteiro(valor: Any) -> int:
    return valor if isinstance(valor, int) and not isinstance(valor, bool) and valor >= 0 else 0


def _defeito(resposta: Any) -> tuple[str, bool] | None:
    """Por que o que desceu não serve — e se pedir de novo adianta. `None` = serve."""
    if not isinstance(resposta, dict):
        return "o que desceu não é a base de fichas", True
    impressao, base = resposta.get("impressao"), resposta.get("base")
    if not isinstance(impressao, str) or not _IMPRESSAO.match(impressao) or not isinstance(base, dict):
        return "o que desceu não é a base de fichas", True
    formato = base.get("formato")
    if isinstance(formato, bool) or formato != FORMATO:
        # Só muda com agente novo (ou com outra base): pedir de novo todo
        # minuto seria baixar o mesmo documento para descartar de novo.
        return f"a base de fichas veio num formato que este agente não conhece ({formato!r})", False
    if not isinstance(base.get("produtos"), list):
        return "o que desceu não é a base de fichas", True
    return None


class Fichas:
    def __init__(self, arquivo: str | Path, baixar: Callable[[], Any] | None = None) -> None:
        self.arquivo = Path(arquivo)
        self._baixar = baixar
        # O laço da nuvem declara e o laço da auditoria busca: um de cada vez.
        self._trava = threading.RLock()
        # O que a configuração anuncia. `None` = não tem base, ou ainda não
        # disse nada (e aí não há o que baixar).
        self._ref: FichasRef | None = None
        # O arquivo como foi lido da última vez: (quando mudou, tamanho) e o
        # que havia nele. Evita reler o documento inteiro a cada volta.
        self._lido: tuple[tuple[int, int], dict[str, Any] | None] | None = None
        # A nuvem já respondeu o que tinha para a base anunciada, e não era
        # ela (ou não era um formato que se entenda). Pedir de novo só faz
        # sentido quando a configuração anunciar outra coisa.
        self._esperando_a_configuracao = False
        # Por que a base ainda não desceu. Some quando desce.
        self.falha: str | None = None

    # ───────────────────────── o que a loja deve ter ─────────────────────────

    def declarar(self, ref: FichasRef | None) -> None:
        """O que a configuração diz: a base que a loja tem, ou `None` = não tem. Não baixa nada."""
        with self._trava:
            if ref != self._ref:
                self._esperando_a_configuracao = False
            self._ref = ref
            if ref is None:
                self.falha = None
                self._apagar()

    def _guardado(self) -> dict[str, Any] | None:
        """O que está no arquivo, se for uma cópia inteira e legível."""
        try:
            info = self.arquivo.stat()
        except OSError:
            self._lido = None
            return None
        marca = (info.st_mtime_ns, info.st_size)
        if self._lido is not None and self._lido[0] == marca:
            return self._lido[1]
        guardado: dict[str, Any] | None
        try:
            guardado = json.loads(self.arquivo.read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            _log.warning("a cópia da base de fichas em disco está ilegível (%s): será baixada de novo", e)
            guardado = None
        if _defeito(guardado) is not None:
            guardado = None
        self._lido = (marca, guardado)
        return guardado

    def impressao_em_disco(self) -> str | None:
        """A impressão da cópia que a loja tem. `None` = não tem (ou não dá para ler)."""
        with self._trava:
            guardado = self._guardado()
            return None if guardado is None else str(guardado["impressao"])

    def falta(self) -> bool:
        """A base que a configuração anuncia ainda não está em disco — e vale pedir?"""
        with self._trava:
            if self._ref is None or self._esperando_a_configuracao:
                return False
            return self.impressao_em_disco() != self._ref.impressao

    # ───────────────────────── baixar e apagar ─────────────────────────

    def baixar_se_falta(self) -> bool:
        """Pede a base à nuvem, se falta. Devolve se uma cópia nova foi gravada."""
        with self._trava:
            if self._baixar is None or not self.falta():
                return False
            anunciada = self._ref.impressao  # type: ignore[union-attr]
            try:
                resposta = self._baixar()
            except Exception as e:  # noqa: BLE001
                # A rede volta; a base é pedida de novo na próxima vez.
                self.falha = str(e)
                _log.warning("não baixei a base de fichas: %s", e)
                return False
            defeito = _defeito(resposta)
            if defeito is not None:
                self.falha, pedir_de_novo = defeito
                self._esperando_a_configuracao = not pedir_de_novo
                _log.warning("a base de fichas que desceu foi descartada: %s", self.falha)
                return False

            guardar = {
                "impressao": resposta["impressao"],
                "baixadaEm": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "base": resposta["base"],
            }
            temporario = self._temporario()
            try:
                self.arquivo.parent.mkdir(parents=True, exist_ok=True)
                temporario.write_text(json.dumps(guardar, ensure_ascii=False), encoding="utf-8")
                # Troca atômica: queda de luz no meio não deixa meio documento.
                os.replace(temporario, self.arquivo)
            except OSError as e:
                self.falha = f"não consegui gravar a base de fichas: {e}"
                _log.warning("%s", self.falha)
                try:
                    temporario.unlink()
                except OSError:
                    pass
                return False
            self._lido = None
            self.falha = None
            # A nuvem entrega a base que tem AGORA. Se já não é a anunciada,
            # a configuração está a caminho de dizer isso: a cópia nova fica,
            # e não se pede de novo até lá.
            self._esperando_a_configuracao = resposta["impressao"] != anunciada
            _log.info(
                "base de fichas em disco: %d produto(s), %d com ficha",
                len(resposta["base"]["produtos"]),
                sum(1 for p in resposta["base"]["produtos"] if isinstance(p, dict) and p.get("ficha")),
            )
            return True

    def _temporario(self) -> Path:
        return self.arquivo.with_name(self.arquivo.name + ".tmp")

    def _apagar(self) -> None:
        """A loja não tem mais base: a cópia sai do disco."""
        self._lido = None
        for arq in (self.arquivo, self._temporario()):
            try:
                arq.unlink()
            except FileNotFoundError:
                continue
            except OSError as e:
                _log.warning("não apaguei %s: %s", arq.name, e)
                continue
            if arq == self.arquivo:
                _log.info("a loja não tem mais base de fichas: a cópia saiu do disco")

    # ───────────────────────── entregar ─────────────────────────

    def base(self) -> dict[str, Any] | None:
        """O documento que a loja tem em disco. `None` = não tem.

        É a cópia que há — pode ser a de ontem, se a de hoje ainda não
        desceu. Sem base, quem pergunta diz que não dá para conferir pela
        ficha; não inventa.
        """
        with self._trava:
            guardado = self._guardado()
            return None if guardado is None else guardado["base"]
