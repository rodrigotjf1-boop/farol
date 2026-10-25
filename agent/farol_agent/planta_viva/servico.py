"""A planta viva no serviço do agente (A26, P2, 25/10/2026). Nasce DESLIGADA: só com `FAROL_PLANTA_VIVA=1`.

Uma linha de execução: a cada `A_CADA_S`, pega o quadro mais recente do fluxo REDUZIDO de cada canal CALIBRADO
(a homografia que desce na configuração), acha as pessoas com o detector da auditoria (o mesmo, carregado uma vez),
leva o pé de cada uma ao chão, junta as câmeras, segue cada caminho sem nome e soma o minuto
(`planta_viva.pessoas`). Os minutos fechados sobem em lote (`POST /v1/planta-viva/minutos`); se a nuvem não aceita,
ficam guardados na memória (até `GUARDA_MINUTOS`) e sobem depois — a nuvem antiga (sem a rota) é tentada de novo a cada
`PAUSA_APOS_RECUSA_S`.

Só com a loja aberta (o horário cadastrado). Nada aqui guarda nem sobe imagem.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from farol_agent.planta_viva.pessoas import NOTA_MINIMA, Minutos, Rastreador, juntar, vistas_do_canal

_log = logging.getLogger(__name__)

A_CADA_S = 0.5
CONFIG_A_CADA_S = 60.0
SOBE_A_CADA_S = 60.0
GUARDA_MINUTOS = 240
POR_LOTE = 60
PAUSA_APOS_RECUSA_S = 600.0
IDADE_MAXIMA_DO_QUADRO_S = 2.0
ROTA = "/v1/planta-viva/minutos"


def ligada(valor: str | None) -> bool:
    return (valor or "").strip().lower() in ("1", "sim", "true", "ligado", "ligada")


def abrir_fluxo_reduzido(ponto) -> Any:
    """O fluxo REDUZIDO do canal (é o que basta para achar gente e custa menos), drenado o tempo todo."""
    from farol_agent.fontes.rtsp import _LeitorContinuo
    from farol_agent.servico import url_do_ponto

    leitor = _LeitorContinuo(
        url_do_ponto(ponto, sub=True), f"canal{ponto.canal}-planta",
        alcance=(ponto.host, int(ponto.porta or 554)) if ponto.host else None,
    )
    leitor.iniciar()
    return leitor


class PlantaViva:
    def __init__(
        self,
        caminho_config: str | Path,
        enviar: Callable[[list[dict]], None],
        *,
        detector_de: Callable[[], Any] | None = None,
        abrir_fluxo: Callable[[Any], Any] = abrir_fluxo_reduzido,
        relogio: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
        a_cada_s: float = A_CADA_S,
    ) -> None:
        if detector_de is None:
            from farol_agent.treino_servico import _detector_da_auditoria as detector_de
        self.caminho_config = Path(caminho_config)
        self._enviar = enviar
        self._detector_de = detector_de
        self._abrir_fluxo = abrir_fluxo
        self._relogio = relogio
        self.a_cada_s = a_cada_s
        self.rastreador = Rastreador()
        self.minutos = Minutos()
        self.pendentes: list[dict] = []
        self.fluxos: dict[str, Any] = {}
        self.canais: dict[str, Any] = {}  # id do ponto → o PontoConfig (com a homografia)
        self._chave: tuple | None = None
        self._motivo_dito: str | None = None
        self._conferir_em = 0.0
        self._subir_em = 0.0
        self._pausa_ate = 0.0
        self._ultimo_t: float | None = None
        self._erro_dito: str | None = None
        self._parar = threading.Event()
        self._linha: threading.Thread | None = None

    # ───────────────────────────── as peças ─────────────────────────────

    def pecas(self) -> tuple[tuple | None, dict[str, Any] | str]:
        """(a chave do que se lê, as peças) — ou (nulo, o motivo de não ler agora)."""
        from farol_agent.bancada_ao_vivo import aberta
        from farol_agent.configuracao import de_json, ler_do_disco
        from farol_agent.treino_servico import janelas_da_loja

        config_json = ler_do_disco(self.caminho_config)
        if not config_json:
            return None, "sem configuração em disco"
        # o horário da loja é o do relógio do computador da loja (hora local, sem fuso — como a bancada ao vivo)
        if not aberta(janelas_da_loja(config_json), self._relogio().astimezone().replace(tzinfo=None)):
            return None, "a loja está fechada"
        calibrados = [p for p in de_json(config_json).pontos if p.homografia and p.host]
        if not calibrados:
            return None, "nenhum canal calibrado pelos pontos do piso (Canais → Planta → Calibrar)"
        detector = self._detector_de()
        if detector is None:
            return None, "o detector não está instalado neste computador (farol-agent detector instalar)"
        chave = tuple(sorted((p.id, p.host, p.porta, p.canal, p.usuario, p.segredo_ref, tuple(p.homografia)) for p in calibrados))
        return chave, {"pontos": calibrados, "detector": detector}

    def _fechar_fluxos(self) -> None:
        for f in self.fluxos.values():
            try:
                f.parar()
            except Exception:  # noqa: BLE001
                _log.debug("planta viva: erro ao fechar um fluxo", exc_info=True)
        self.fluxos, self.canais = {}, {}

    # ───────────────────────────── uma volta ─────────────────────────────

    def passo(self, agora_s: float) -> None:
        if agora_s >= self._conferir_em:
            self._conferir_em = agora_s + CONFIG_A_CADA_S
            chave, pecas = self.pecas()
            if chave is None:
                if self.fluxos:
                    self._fechar_fluxos()
                    self.pendentes.extend(self.minutos.fechados(datetime.max.replace(tzinfo=timezone.utc)))
                    self._ultimo_t = None
                if pecas != self._motivo_dito:
                    _log.info("planta viva: não leio agora — %s", pecas)
                    self._motivo_dito = pecas  # type: ignore[assignment]
            elif chave != self._chave or not self.fluxos:
                self._fechar_fluxos()
                for p in pecas["pontos"]:  # type: ignore[index]
                    self.fluxos[p.id] = self._abrir_fluxo(p)
                    self.canais[p.id] = p
                self._detector = pecas["detector"]  # type: ignore[index]
                self._chave, self._motivo_dito = chave, None
                _log.info("planta viva: lendo %d canal(is) calibrado(s), %.0f quadros por segundo",
                          len(self.fluxos), 1 / self.a_cada_s)
        if self.fluxos:
            self._olhar(agora_s)
        if agora_s >= self._subir_em:
            self._subir_em = agora_s + SOBE_A_CADA_S
            self.pendentes.extend(self.minutos.fechados(self._relogio()))
            self._subir(agora_s)

    def _olhar(self, agora_s: float) -> None:
        vistas = []
        for pid, fluxo in self.fluxos.items():
            q = fluxo.ultimo(IDADE_MAXIMA_DO_QUADRO_S)
            if q is None:
                continue
            _, img = q
            altura, largura = img.shape[:2]
            p = self.canais[pid]
            caixas = self._detector.caixas(img, "person", NOTA_MINIMA)
            vistas.extend(vistas_do_canal(pid, p.homografia, p.erro_da_calibracao_m or 0.0, caixas, largura, altura))
        quando = self._relogio()
        dt = self.a_cada_s if self._ultimo_t is None else min(2.0, max(0.0, agora_s - self._ultimo_t))
        self._ultimo_t = agora_s
        pessoas = self.rastreador.passo(agora_s, juntar(vistas), dia=quando.astimezone().date().isoformat())
        self.minutos.somar(quando, dt, pessoas)

    def _subir(self, agora_s: float) -> None:
        if len(self.pendentes) > GUARDA_MINUTOS:
            perdidos = len(self.pendentes) - GUARDA_MINUTOS
            self.pendentes = self.pendentes[perdidos:]
            _log.warning("planta viva: %d minuto(s) mais velhos saíram da memória sem subir (a nuvem não aceitou)", perdidos)
        if not self.pendentes or agora_s < self._pausa_ate:
            return
        from farol_agent.nuvem import ErroDaNuvem

        while self.pendentes:
            lote = self.pendentes[:POR_LOTE]
            try:
                self._enviar(lote)
            except ErroDaNuvem as e:
                if not e.recuperavel:
                    self._pausa_ate = agora_s + PAUSA_APOS_RECUSA_S
                if str(e) != self._erro_dito:
                    self._erro_dito = str(e)
                    _log.warning("planta viva: os minutos ficaram sem subir (%s) — guardados, sobem depois", e)
                return
            self.pendentes = self.pendentes[len(lote):]
            if self._erro_dito is not None:
                _log.info("planta viva: a nuvem voltou a aceitar os minutos")
                self._erro_dito = None

    # ───────────────────────────── ligar e desligar ─────────────────────────────

    def _rodar(self) -> None:
        while not self._parar.is_set():
            comeco = time.monotonic()
            try:
                self.passo(comeco)
            except Exception as e:  # noqa: BLE001 — um defeito num quadro não para a planta viva
                texto = f"{type(e).__name__}: {e}"
                if texto != self._erro_dito:
                    self._erro_dito = texto
                    _log.exception("planta viva: erro inesperado (%s); sigo", texto)
            self._parar.wait(max(0.0, self.a_cada_s - (time.monotonic() - comeco)))
        self._fechar_fluxos()

    def iniciar(self) -> None:
        if self._linha is not None:
            return
        self._parar.clear()
        self._linha = threading.Thread(target=self._rodar, name="farol-planta-viva", daemon=True)
        self._linha.start()

    def parar(self, espera_s: float = 10.0) -> None:
        self._parar.set()
        if self._linha is not None:
            self._linha.join(espera_s)
        self._linha = None
