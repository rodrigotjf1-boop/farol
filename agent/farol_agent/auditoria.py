"""O motor ligado à configuração que desceu e à nuvem.

Até aqui as duas metades existiam separadas: o `servir` falava com a
nuvem e capturava preview; o motor, a fila e o juiz rodavam só no `laco`,
contra material gravado com gatilho simulado. **O agente conversava e não
auditava nada.** Esta peça junta as duas.

## Por que amostragem, e não o gatilho do gravador

O desenho prevê gatilho em dois estágios: o DVR avisa movimento, o agente
classifica. Isso continua sendo o certo para escala, e o `GatilhoCGI` já
está provado contra o MHDX.

Mas para a primeira semana de operação de verdade — que é o que o dono
pediu, três canais por mais de sete dias — a amostragem periódica ganha,
por três motivos:

1. **O deduplicador torna a amostragem barata.** Cena que não mudou tem
   o mesmo pHash e é descartada antes de virar análise. Numa cozinha
   parada, mil capturas viram zero chamadas.
2. **Menos peças que podem quebrar calado.** Manter N transmissões de
   evento abertas por uma semana é exatamente o tipo de coisa que falha
   na terça de madrugada sem ninguém ver — e o MHDX já nos mostrou que
   fecha a transmissão a cada evento.
3. **Falha de uma câmera não derruba as outras.** Uma captura que falha
   é uma captura; uma transmissão que morre é um canal cego até alguém
   reiniciar.

O gatilho entra depois, quando houver semana de dados dizendo quanto ele
economiza de verdade.

## O que esta peça garante

- **A auditoria nunca atrasa o heartbeat.** Captura e julgamento rodam em
  thread própria; o laço da nuvem segue batendo mesmo com o modelo lento.
- **Configuração nova reconstrói tudo.** Regra ligada, área redesenhada
  ou ponto novo passam a valer sem reiniciar o agente.
- **Evento que não subiu não se perde.** Fica na fila local até a nuvem
  aceitar — é o mesmo princípio da configuração em disco.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime
from typing import Any

from farol_agent.configuracao import ConfigDaLoja, PontoConfig
from farol_agent.fila import Fila
from farol_agent.modelos import EventoGatilho
from farol_agent.motor import MotorDeRegras
from farol_agent.nuvem import ErroDaNuvem

_log = logging.getLogger(__name__)

INTERVALO_CAPTURA_PADRAO = 30.0
LIMITE_POR_PASSADA = 10


class Auditoria:
    """Mantém o motor em dia com a configuração e roda o laço de análise."""

    def __init__(
        self,
        cliente,
        caminho_fila: str,
        *,
        intervalo_captura: float = INTERVALO_CAPTURA_PADRAO,
        construir_fonte=None,
        construir_juiz=None,
    ) -> None:
        self.cliente = cliente
        self.fila = Fila(caminho_fila)
        self.intervalo_captura = intervalo_captura

        # Injetáveis para o teste não precisar de câmera nem de API.
        self._construir_fonte = construir_fonte or self._fonte_rtsp
        self._construir_juiz = construir_juiz or self._juiz_padrao

        self.motor: MotorDeRegras | None = None
        self.juiz = None
        self.fontes: dict[str, Any] = {}
        self.versao_montada: int | None = None
        self.ultimo_erro: str | None = None

        self._parar = threading.Event()
        self._thread: threading.Thread | None = None

    # ─────────────────────────── montagem ───────────────────────────

    @staticmethod
    def _fonte_rtsp(ponto: PontoConfig):
        from farol_agent.fontes.rtsp import FonteRTSP
        from farol_agent.servico import url_do_ponto

        # `abrir_sub=True`: o leitor contínuo do sub mantém o quadro mais
        # recente em memória, e é dele que a amostragem bebe. Abrir o main
        # a cada captura gastaria um dos poucos fluxos simultâneos que o
        # gravador aceita — e esse fluxo faz falta ao preview.
        return FonteRTSP(
            ponto.id,
            url_do_ponto(ponto),
            url_sub=url_do_ponto(ponto, sub=True),
            abrir_sub=True,
        )

    @staticmethod
    def _juiz_padrao(config: ConfigDaLoja):
        """O SELETOR, nunca um juiz direto.

        Ligar `JuizNuvem` aqui furaria a proteção que o desenho tem: a
        categoria da regra decide o juiz, e `presenca`, `contagem` e
        `comparacao` **não podem sair da loja** — é promessa do produto,
        não preferência.

        E não é só privacidade: a medição de 05/10 mostrou o modelo de
        nuvem lendo um mouse como controle remoto, duas vezes, com 95% de
        confiança. Identificação de objeto é trabalho de detector.

        O seletor levanta erro claro quando falta o juiz de uma
        categoria, em vez de desviar para o que estiver à mão.
        """
        from farol_agent.juizes.nuvem import JuizNuvem
        from farol_agent.juizes.seletor import JuizPorRegra, SeletorDeJuiz

        nuvem = None
        try:
            nuvem = JuizNuvem()
        except Exception as e:  # noqa: BLE001
            # Sem chave, o seletor ainda serve: regra local continua
            # atendida, e regra de nuvem falha dizendo o que falta.
            _log.warning("juiz de nuvem indisponível: %s", e)

        seletor = SeletorDeJuiz(config.modo_julgamento, nuvem=nuvem)
        return JuizPorRegra(seletor, {r.id: r for r in config.regras})

    def montar(self, config: ConfigDaLoja) -> None:
        """(Re)constrói motor, juiz e fontes a partir da configuração."""
        if config.versao == self.versao_montada:
            return

        regras = config.regras
        self.motor = MotorDeRegras(self.fila, regras)

        # Fontes só para pontos que têm regra: abrir câmera que ninguém
        # audita é fluxo do gravador gasto à toa.
        com_regra = {r.zona.id for r in regras}
        novas: dict[str, Any] = {}
        for ponto in config.pontos:
            if not any(z.id in com_regra for z in ponto.zonas):
                continue
            if ponto.id in self.fontes:
                novas[ponto.id] = self.fontes.pop(ponto.id)
                continue
            try:
                novas[ponto.id] = self._construir_fonte(ponto)
            except Exception as e:  # noqa: BLE001
                # Um ponto mal configurado não pode impedir os outros de
                # serem auditados.
                _log.error("não abri o ponto %s: %s", ponto.nome, e)

        self._fechar(self.fontes.values())
        self.fontes = novas

        # O juiz se refaz a CADA versão, não só na primeira: ele carrega o
        # mapa de regras e o modo de julgamento da loja, e os dois mudam.
        # Guardar o juiz da primeira montagem faria regra nova ser julgada
        # pelo mapa velho — e o seletor diria "regra não existe".
        if regras:
            try:
                self.juiz = self._construir_juiz(config)
            except Exception as e:  # noqa: BLE001
                self.ultimo_erro = str(e)
                _log.error("sem juiz: %s", e)

        self.versao_montada = config.versao
        _log.info(
            "auditoria montada: v%s · %d regra(s) em %d ponto(s)",
            config.versao, len(regras), len(self.fontes),
        )

    @staticmethod
    def _fechar(fontes) -> None:
        for f in fontes:
            fechar = getattr(f, "fechar", None)
            if callable(fechar):
                try:
                    fechar()
                except Exception:  # noqa: BLE001
                    pass

    # ──────────────────────────── o laço ────────────────────────────

    def capturar(self, agora: datetime | None = None) -> int:
        """Uma rodada de captura em todos os pontos. Devolve enfileirados."""
        if self.motor is None:
            return 0
        agora = agora or datetime.now()
        total = 0

        for ponto_id, fonte in list(self.fontes.items()):
            evento = EventoGatilho(ponto_id=ponto_id, ts=agora, origem="amostragem")
            try:
                p = self.motor.preparar(evento, fonte)
            except Exception as e:  # noqa: BLE001
                # Câmera caída não pode derrubar o laço nem as outras.
                _log.warning("captura falhou no ponto %s: %s", ponto_id, e)
                continue
            total += len(p.enfileirados)
            if p.sem_cena:
                _log.warning("ponto %s sem cena: %s", ponto_id, p.sem_cena)

        return total

    def julgar(self, agora: datetime | None = None) -> list:
        """Drena a fila e devolve os alertas."""
        if self.motor is None or self.juiz is None:
            return []
        try:
            return self.motor.processar(
                self.juiz, agora or datetime.now(), limite=LIMITE_POR_PASSADA
            )
        except Exception as e:  # noqa: BLE001
            self.ultimo_erro = str(e)
            _log.exception("julgamento falhou")
            return []

    def subir(self, alertas: list) -> int:
        """Manda os eventos para a nuvem. O que não subir, fica na fila.

        Evento perdido é auditoria perdida, e auditoria perdida não se
        recupera: a cena já passou. Então falha aqui não descarta nada —
        é o mesmo princípio da configuração em disco.
        """
        if not alertas:
            return 0

        eventos = [
            {
                # Vem da FILA. Inventar uma chave aqui anularia a
                # protecao contra duplicata na retentativa.
                "idempotencia_key": a.chave,
                "regra_id": a.regra_id,
                "criterio_versao": a.criterio_versao,
                "ocorrido_em": a.ts.isoformat(),
                "veredito": a.veredito.resultado.value,
                "confianca": a.confianca,
                "motivo": a.motivo,
                "modelo": a.veredito.modelo,
                "via": a.veredito.via.value if a.veredito.via else None,
                "tokens_entrada": a.veredito.tokens_entrada,
                "tokens_saida": a.veredito.tokens_saida,
                "custo_centavos": a.veredito.custo_centavos,
                "latencia_ms": a.veredito.latencia_ms,
            }
            for a in alertas
        ]

        try:
            self.cliente._pedir("POST", "/v1/eventos", {"eventos": eventos})
        except ErroDaNuvem as e:
            self.ultimo_erro = str(e)
            _log.error("não subi %d evento(s): %s", len(eventos), e)
            return 0
        return len(eventos)

    def passo(self, agora: datetime | None = None) -> dict[str, int]:
        """Uma volta completa: captura, julga, sobe."""
        agora = agora or datetime.now()
        enfileirados = self.capturar(agora)
        alertas = self.julgar(agora)
        subidos = self.subir(alertas)
        return {
            "enfileirados": enfileirados,
            "alertas": len(alertas),
            "subidos": subidos,
        }

    # ───────────────────────── thread própria ─────────────────────────

    def iniciar(self) -> None:
        """Roda em thread própria para não atrasar o heartbeat.

        Um julgamento na nuvem leva segundos; numa loja com várias regras,
        uma passada inteira pode levar minutos. Se isso rodasse no mesmo
        laço do heartbeat, o console veria o agente como caído enquanto
        ele estava trabalhando — o pior diagnóstico possível.
        """
        if self._thread is not None:
            return
        self._parar.clear()
        self._thread = threading.Thread(
            target=self._laco, name="farol-auditoria", daemon=True
        )
        self._thread.start()

    def _laco(self) -> None:
        while not self._parar.is_set():
            try:
                r = self.passo()
                if r["alertas"]:
                    _log.info(
                        "%d alerta(s), %d subido(s)", r["alertas"], r["subidos"]
                    )
            except Exception:  # noqa: BLE001
                _log.exception("erro inesperado na auditoria; seguindo")
            self._parar.wait(self.intervalo_captura)

    def parar(self) -> None:
        self._parar.set()
        if self._thread is not None:
            self._thread.join(timeout=5)
            self._thread = None
        self._fechar(self.fontes.values())
        self.fontes = {}
