"""Gatilho pelo `eventManager` do gravador.

Transforma o que a Dahua emite em `EventoGatilho`, que é o que o motor de
regras entende. É o primeiro dos dois estágios: **o gravador diz que
mexeu, o agente diz o quê.**

## Por que pedir `[All]` e filtrar aqui

O firmware trunca a lista de `codes` por volta de 100 caracteres. Uma
lista grande chega cortada ao meio, e o gravador passa a assinar um
conjunto diferente do pedido — **sem avisar**. O jeito seguro é assinar
tudo e descartar do lado de cá, onde dá para ver o que foi descartado.

## O que é ruído e o que é gatilho

Um gravador emite muita coisa que não interessa à auditoria de processo:
login de usuário, disco cheio, mudança de configuração. Passar tudo ao
motor faria cada um desses virar uma análise paga.

`VideoLoss` merece nota: **não é gatilho de análise**, porque sem sinal
não há o que julgar. Mas é informação de primeira ordem sobre a câmera, e
vai para o log — câmera que perde sinal toda tarde é problema que o
painel tem que mostrar, mesmo não gerando alerta de operação.
"""

from __future__ import annotations

import logging
from typing import Iterator

from farol_agent.dvr.dahua import ClienteDahua, ErroDoGravador, Evento
from farol_agent.modelos import EventoGatilho

_log = logging.getLogger(__name__)

# Códigos que significam "alguém ou alguma coisa se mexeu no canal".
MOVIMENTO = frozenset(
    {
        "VideoMotion",          # movimento bruto, todos os canais
        "SmartMotionHuman",     # já classificado como pessoa, quando há
        "SmartMotionVehicle",
        "CrossLineDetection",
        "CrossRegionDetection",
    }
)

# Chegam, importam para o diagnóstico, mas não acionam análise.
DIAGNOSTICO = frozenset({"VideoLoss", "VideoBlind", "VideoAbnormalDetection"})


class GatilhoCGI:
    nome = "cgi"

    def __init__(
        self,
        cliente: ClienteDahua,
        *,
        canal_para_ponto: dict[int, str],
        codigos: frozenset[str] = MOVIMENTO,
        so_inicio: bool = True,
    ) -> None:
        self.cliente = cliente
        # O gravador fala em canal; o Farol fala em ponto. O mapa é o
        # que liga a instalação física ao modelo de negócio, e viver
        # aqui evita espalhar número de canal pelo resto do código.
        self.canal_para_ponto = canal_para_ponto
        self.codigos = codigos
        self.so_inicio = so_inicio
        self._fechado = False
        self.descartados: dict[str, int] = {}

    def eventos(self) -> Iterator[EventoGatilho]:
        # `[All]` de propósito: ver o cabeçalho do módulo.
        for bruto in self.cliente.eventos("All"):
            if self._fechado:
                return
            convertido = self._converter(bruto)
            if convertido is not None:
                yield convertido

    def _converter(self, e: Evento) -> EventoGatilho | None:
        if e.codigo in DIAGNOSTICO:
            # Não vira análise, mas não some: câmera que perde sinal toda
            # tarde é problema, e o painel precisa saber.
            _log.info(
                "diagnóstico: %s %s no canal %d", e.codigo, e.acao, e.canal
            )
            self._contar(e.codigo)
            return None

        if e.codigo not in self.codigos:
            self._contar(e.codigo)
            return None

        # `Stop` é o fim do movimento. Analisar nos dois pontos dobraria o
        # custo para olhar duas vezes a mesma cena.
        if self.so_inicio and e.acao not in ("Start", "Pulse"):
            return None

        ponto = self.canal_para_ponto.get(e.canal)
        if ponto is None:
            # Canal que ninguém cadastrou. Acontece em gravador de 16 com
            # 4 câmeras — e não pode virar erro, só silêncio contado.
            self._contar(f"canal_{e.canal}_sem_ponto")
            return None

        return EventoGatilho(
            ponto_id=ponto,
            ts=_agora(),
            classe=_classe(e.codigo),
            origem="dvr_cgi",
            bruto={"codigo": e.codigo, "acao": e.acao, "canal": e.canal, **e.dados},
        )

    def _contar(self, chave: str) -> None:
        self.descartados[chave] = self.descartados.get(chave, 0) + 1

    def fechar(self) -> None:
        self._fechado = True


def _classe(codigo: str) -> str | None:
    """O que o próprio gravador já classificou, quando classificou.

    `SmartMotion*` vem da inteligência de vídeo — que na MHDX roda em UM
    canal só. Nos outros quinze chega `VideoMotion` puro, sem classe, e
    quem decide se é pessoa é o detector local. É exatamente por isso que
    o gatilho tem dois estágios.
    """
    if codigo == "SmartMotionHuman":
        return "pessoa"
    if codigo == "SmartMotionVehicle":
        return "veiculo"
    return None


def _agora():
    from datetime import datetime

    # O relógio que vale é o do agente, não o do gravador: DVR com hora
    # errada carimbaria evento no futuro, e a linha do tempo da loja
    # ficaria impossível de ler. O horário do gravador fica no `bruto`
    # quando ele manda, para dar para comparar depois.
    return datetime.now()
