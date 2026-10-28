"""As pessoas do instante para a tela "Ao vivo" do console (A26, P6, 28/10/2026).

O rastreio (`rastreio.py`) dá, a cada meio segundo, cada pessoa no chão da planta. Daqui elas vão à nuvem
(`POST /v1/planta-viva/agora`, `contratos/planta-viva-agora.json`), numa linha de execução PRÓPRIA — o pedido pela
internet não pode atrasar o rastreio — e só o instante mais novo vale: se o anterior ainda não saiu, ele é trocado.

Rápido (`A_CADA_OLHANDO_S`) só enquanto alguém olha a tela; quando ninguém olha, um instante a cada
`A_CADA_SEM_OLHAR_S` — a resposta da nuvem diz (`{"olhando": true}`). Quem abre a tela vê o movimento começar em até
esse tempo. Nuvem que ainda não tem a rota (antiga): tenta de novo a cada `PAUSA_APOS_RECUSA_S`.

Nada de imagem, nada de nome: o número da pessoa (do dia), onde ela está, para onde anda e que canais a viram.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime
from typing import Any, Callable, Sequence

_log = logging.getLogger(__name__)

ROTA = "/v1/planta-viva/agora"
A_CADA_OLHANDO_S = 0.5
A_CADA_SEM_OLHAR_S = 5.0
ESPERA_APOS_FALHA_S = 5.0
PAUSA_APOS_RECUSA_S = 600.0


def dados_do_instante(quando: datetime, pessoas: Sequence[tuple], canais: Sequence[str]) -> dict[str, Any]:
    """O corpo do envio: `pessoas` como o rastreio dá (`Rastreio.agora`: número, x, y, vx, vy, canais que a viram)."""
    return {
        "quando": quando.isoformat(),
        "pessoas": [
            {"n": int(n), "x": round(float(x), 2), "y": round(float(y), 2), "vx": round(float(vx), 2), "vy": round(float(vy), 2),
             "canais": list(vistos)}
            for n, x, y, vx, vy, vistos in pessoas
        ],
        "canais": list(canais),
    }


class EnvioAoVivo:
    """Leva à nuvem o instante mais novo, numa linha própria; o ritmo segue a resposta (alguém olhando ou não)."""

    def __init__(self, enviar: Callable[[dict], dict], *, relogio: Callable[[], float] = time.monotonic) -> None:
        self._enviar = enviar
        self._relogio = relogio
        self._pendente: dict | None = None
        self._proximo = 0.0  # antes disto, o instante novo nem entra (o ritmo)
        self.olhando = False
        self.enviados = 0
        self._erro_dito: str | None = None
        self._cond = threading.Condition()
        self._parar = False
        self._linha: threading.Thread | None = None

    def publicar(self, dados: dict) -> None:
        """O instante mais novo. Fora do ritmo, fica de fora; se o anterior ainda não saiu, é trocado por este."""
        with self._cond:
            if self._relogio() < self._proximo:
                return
            self._pendente = dados
            self._cond.notify()

    def enviar_pendente(self) -> bool:
        """Manda o que está pendente (a linha própria chama; o teste também). Devolve se mandou."""
        with self._cond:
            dados, self._pendente = self._pendente, None
        if dados is None:
            return False
        from farol_agent.nuvem import ErroDaNuvem

        try:
            resposta = self._enviar(dados) or {}
        except ErroDaNuvem as e:
            espera = ESPERA_APOS_FALHA_S if e.recuperavel else PAUSA_APOS_RECUSA_S
            with self._cond:
                self._proximo = self._relogio() + espera
            if str(e) != self._erro_dito:
                self._erro_dito = str(e)
                _log.warning("planta viva: o instante para a tela ao vivo não subiu (%s); tento de novo em %.0f s", e, espera)
            return False
        self.enviados += 1
        olhando = resposta.get("olhando") is True
        if olhando != self.olhando:
            _log.info("planta viva: %s", "alguém abriu a tela ao vivo — mando a cada meio segundo" if olhando
                      else "ninguém olha a tela ao vivo — mando devagar")
        self.olhando = olhando
        if self._erro_dito is not None:
            _log.info("planta viva: a tela ao vivo voltou a receber")
            self._erro_dito = None
        with self._cond:
            self._proximo = self._relogio() + (A_CADA_OLHANDO_S if olhando else A_CADA_SEM_OLHAR_S)
        return True

    def _rodar(self) -> None:
        while True:
            with self._cond:
                while self._pendente is None and not self._parar:
                    self._cond.wait()
                if self._parar:
                    return
            try:
                self.enviar_pendente()
            except Exception:  # noqa: BLE001 — um defeito num envio não para a tela ao vivo
                _log.exception("planta viva: erro inesperado ao mandar o instante; sigo")

    def iniciar(self) -> None:
        if self._linha is not None:
            return
        self._parar = False
        self._linha = threading.Thread(target=self._rodar, name="farol-planta-ao-vivo", daemon=True)
        self._linha.start()

    def parar(self, espera_s: float = 5.0) -> None:
        with self._cond:
            self._parar = True
            self._cond.notify()
        if self._linha is not None:
            self._linha.join(espera_s)
        self._linha = None
