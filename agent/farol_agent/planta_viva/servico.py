"""A planta viva no serviço do agente (A26, P2, 25/10/2026). Nasce DESLIGADA: só com `FAROL_PLANTA_VIVA=1`.

Uma linha de execução: a cada `A_CADA_S`, pega o quadro mais recente do fluxo REDUZIDO de cada canal CALIBRADO
(a homografia que desce na configuração), acha as pessoas com o detector da auditoria (o mesmo, carregado uma vez),
põe cada uma no chão, junta as câmeras e segue cada uma sem nome (`planta_viva.rastreio`, desde 28/10: pé ou cabeça,
o chão livre da planta, o filtro que junta as câmeras e o desvio de cada câmera aprendido com o movimento) e soma o
minuto (`planta_viva.pessoas.Minutos`). Os minutos fechados sobem em lote (`POST /v1/planta-viva/minutos`); se a nuvem
não aceita, ficam guardados na memória (até `GUARDA_MINUTOS`) e sobem depois — a nuvem antiga (sem a rota) é tentada de
novo a cada `PAUSA_APOS_RECUSA_S`.

O desvio aprendido de cada câmera fica em disco (`planta-viva-desvios.json`, ao lado da configuração), com a marca da
calibração de que veio: calibrou de novo, aquela câmera recomeça a aprender.

Só com a loja aberta (o horário cadastrado). Nada aqui guarda nem sobe imagem.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from farol_agent.planta_viva import rastreio as rt
from farol_agent.planta_viva.pessoas import Minutos

_log = logging.getLogger(__name__)

A_CADA_S = 0.5
CONFIG_A_CADA_S = 60.0
SOBE_A_CADA_S = 60.0
GUARDA_MINUTOS = 240
POR_LOTE = 60
PAUSA_APOS_RECUSA_S = 600.0
IDADE_MAXIMA_DO_QUADRO_S = 2.0
ROTA = "/v1/planta-viva/minutos"
GUARDA_DESVIOS_A_CADA_S = 300.0
CONTA_DESVIOS_A_CADA_S = 1800.0
ARQUIVO_DOS_DESVIOS = "planta-viva-desvios.json"


def marca_da_calibracao(h: list[float]) -> str:
    """A marca da homografia: o desvio aprendido de uma câmera só vale para a calibração de que veio."""
    return hashlib.sha256(json.dumps([round(float(x), 9) for x in h]).encode()).hexdigest()[:16]


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
        self.rastreio = rt.Rastreio()
        self.minutos = Minutos()
        self.pendentes: list[dict] = []
        self.fluxos: dict[str, Any] = {}
        self.canais: dict[str, rt.CanalDoRastreio] = {}  # id do ponto → o canal do rastreio (homografia, câmera, trilhas)
        self.nomes: dict[str, str] = {}  # id do ponto → "canal 6", para o registro
        # o que a tela ao vivo mostra: as pessoas do último instante (número, x, y, vx, vy, câmeras) e quando
        self.ao_vivo: tuple[datetime, list[tuple]] | None = None
        self.arquivo_dos_desvios = self.caminho_config.parent / ARQUIVO_DOS_DESVIOS
        self._marcas: dict[str, str] = {}  # id do ponto → a marca da calibração de que o desvio aprendido veio
        self._carregar_desvios()
        self._guardar_desvios_em = 0.0
        self._contar_desvios_em = 0.0
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
        config = de_json(config_json)
        calibrados = [p for p in config.pontos if p.homografia and p.host]
        if not calibrados:
            return None, "nenhum canal calibrado pelos pontos do piso (Canais → Planta → Calibrar)"
        detector = self._detector_de()
        if detector is None:
            return None, "o detector não está instalado neste computador (farol-agent detector instalar)"
        planta = rt.Planta(tuple(rt.Movel(*m) for m in config.planta_moveis), config.planta_limites)
        chave = (tuple(sorted((p.id, p.host, p.porta, p.canal, p.usuario, p.segredo_ref, tuple(p.homografia), p.altura_da_camera_m,
                               tuple(p.area_calibrada or ())) for p in calibrados)), planta)
        return chave, {"pontos": calibrados, "detector": detector, "planta": planta}

    # ───────────────────────────── o desvio aprendido de cada câmera ─────────────────────────────

    def _carregar_desvios(self) -> None:
        try:
            dados = json.loads(self.arquivo_dos_desvios.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return
        except (OSError, ValueError) as e:
            _log.warning("planta viva: o desvio guardado das câmeras não deu para ler (%s); recomeça a aprender", e)
            return
        if isinstance(dados, dict):
            self.rastreio.desvios = rt.DesvioDasCameras.de_json(dados.get("desvios"))
            marcas = dados.get("marcas")
            self._marcas = {str(k): str(v) for k, v in marcas.items()} if isinstance(marcas, dict) else {}

    def _guardar_desvios(self) -> None:
        if not self.rastreio.desvios.geral:
            return
        dados = {"versao": 1, "marcas": self._marcas, "desvios": self.rastreio.desvios.para_json()}
        temporario = self.arquivo_dos_desvios.with_suffix(".tmp")
        try:
            temporario.write_text(json.dumps(dados), encoding="utf-8")
            os.replace(temporario, self.arquivo_dos_desvios)
        except OSError as e:
            _log.warning("planta viva: não deu para guardar o desvio aprendido das câmeras (%s)", e)

    def _montar_canais(self, pontos: list, planta: rt.Planta) -> None:
        self.rastreio.planta = planta
        self.canais = {}
        for p in pontos:
            marca = marca_da_calibracao(p.homografia)
            if self._marcas.get(p.id) != marca:
                self.rastreio.desvios.esquecer(p.id)  # calibrou de novo (ou é a primeira vez): recomeça a aprender
                self._marcas[p.id] = marca
            canal = rt.CanalDoRastreio(p.id, p.homografia, erro_da_calibracao=p.erro_da_calibracao_m or 0.0,
                                       altura_medida=p.altura_da_camera_m, area=p.area_calibrada)
            self.canais[p.id] = canal
            nome = f"canal {p.canal}" if p.canal is not None else p.nome
            self.nomes[p.id] = nome
            if canal.cam is None:
                _log.info("planta viva: %s — a calibração não dá a câmera inteira: só o pé vale", nome)
            else:
                medida = f" (medida na planta: {p.altura_da_camera_m:.2f} m)" if p.altura_da_camera_m else ""
                _log.info("planta viva: %s — a calibração põe a câmera a %.2f m%s; a cabeça vale %.0f%%",
                          nome, canal.cam.altura, medida, 100 * canal.confianca)

    def _fechar_fluxos(self) -> None:
        for f in self.fluxos.values():
            try:
                f.parar()
            except Exception:  # noqa: BLE001
                _log.debug("planta viva: erro ao fechar um fluxo", exc_info=True)
        self.fluxos = {}
        self.ao_vivo = None

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
                self._montar_canais(pecas["pontos"], pecas["planta"])  # type: ignore[index]
                self._detector = pecas["detector"]  # type: ignore[index]
                self._chave, self._motivo_dito = chave, None
                _log.info("planta viva: lendo %d canal(is) calibrado(s), %.0f quadros por segundo; a planta com %d móvel(is)",
                          len(self.fluxos), 1 / self.a_cada_s, len(pecas["planta"].moveis))  # type: ignore[index]
        if self.fluxos:
            self._olhar(agora_s)
        if agora_s >= self._subir_em:
            self._subir_em = agora_s + SOBE_A_CADA_S
            self.pendentes.extend(self.minutos.fechados(self._relogio()))
            self._subir(agora_s)
        if agora_s >= self._guardar_desvios_em:
            self._guardar_desvios_em = agora_s + GUARDA_DESVIOS_A_CADA_S
            self._guardar_desvios()
        if self.fluxos and agora_s >= self._contar_desvios_em:
            self._contar_desvios_em = agora_s + CONTA_DESVIOS_A_CADA_S
            resumo = self.rastreio.desvios.resumo()
            if resumo:
                _log.info("planta viva: o desvio aprendido das câmeras (m): %s", "; ".join(
                    f"{self.nomes.get(pid, pid)} ({dx:+.2f}; {dy:+.2f}) em {n} vez(es)" for pid, (dx, dy, n) in resumo.items()))

    def _olhar(self, agora_s: float) -> None:
        vistas = []
        for pid, fluxo in self.fluxos.items():
            q = fluxo.ultimo(IDADE_MAXIMA_DO_QUADRO_S)
            if q is None:
                continue
            _, img = q
            altura, largura = img.shape[:2]
            caixas = self._detector.caixas(img, "person", rt.NOTA_MINIMA)
            vistas.extend(self.canais[pid].observacoes(agora_s, caixas, largura, altura, self.rastreio, img))
        quando = self._relogio()
        dt = self.a_cada_s if self._ultimo_t is None else min(2.0, max(0.0, agora_s - self._ultimo_t))
        self._ultimo_t = agora_s
        pessoas = self.rastreio.passo(agora_s, vistas, dia=quando.astimezone().date().isoformat())
        self.ao_vivo = (quando, self.rastreio.agora(agora_s))
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
        self._guardar_desvios()

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
