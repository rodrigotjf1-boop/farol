"""O vigia — olha entre uma olhada e outra, e pede olhada extra quando algo muda.

A auditoria olha cada canal a cada trinta segundos, abrindo o fluxo principal
do gravador (1,7 s por canal, medido na loja em 08/10/2026). Entre uma olhada
e outra, um posto pode esvaziar e encher de novo sem ninguém ver.

O computador da loja tem folga (processador a 3% com a loja aberta), e o
fluxo MENOR de cada canal já fica aberto o tempo todo. O vigia usa os dois:
a cada dez segundos ele conta, no último quadro do fluxo menor, o que os
critérios de presença e de contagem procuram (85 ms por área). Se a contagem
mudou desde a última olhada, ele pede uma olhada **agora** naquele canal.

## O vigia não julga

Quem julga continua sendo a olhada de sempre, pelo fluxo principal: é ela que
conta no resumo, mede e avisa. O vigia só decide QUANDO olhar. Por isso o
erro dele é barato nos dois sentidos:

    viu mudança que não houve   → uma olhada a mais (1,7 s de fluxo principal)
    não viu a mudança           → fica como era: a próxima olhada de rotina pega

O detector no fluxo menor não foi medido contra o principal com gente na
cena (a loja estava fechada na medição). Este desenho não depende disso: a
comparação é sempre do fluxo menor com ele mesmo — a contagem de agora contra
a contagem do instante da última olhada.

## Limites

- **No máximo uma olhada extra por canal a cada vinte segundos.** Uma pessoa
  na borda da área faz a contagem piscar; sem o limite, cada piscada abriria
  o fluxo principal.
- **Só presença e contagem.** O que pode ir à nuvem continua no ritmo de
  sempre.
- **Canal sem fluxo menor aberto, ou com o quadro parado há mais de cinco
  segundos, não é vigiado** — fica na rotina.
- **O freio.** Processador acima de 60% por quatro medidas seguidas (uns dois
  minutos) e o vigia para; volta quando ficar abaixo de 45% pelo mesmo tempo.
  Sem medida do processador não há como saber, e ele segue: o custo dele é
  pequeno e limitado.

## O que a olhada extra conta

Ela cai quando algo mudou, e não num instante qualquer. Por isso é uma
análise como as outras (resultado, aviso, maior valor da hora), mas fica
FORA da média da hora, NÃO adianta o "avisar só se continuar" e é contada
à parte no resumo (`extras`, `extras_fora`) — ver `fila.contar_veredito`,
`motor._avaliar` e `docs/decisoes.md` (08/10/2026, "O vigia").
"""

from __future__ import annotations

import logging
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Callable

import numpy as np

from farol_agent.modelos import Regra, TipoRegra
from farol_agent.pipeline import recorte

_log = logging.getLogger(__name__)

# De quanto em quanto tempo o vigia olha o fluxo menor.
INTERVALO_PADRAO = 10.0
# O mínimo entre duas olhadas extras no MESMO canal.
MINIMO_ENTRE_EXTRAS = timedelta(seconds=20)
# Quadro do fluxo menor mais velho que isto é fluxo parado: não se confia.
QUADRO_VELHO = timedelta(seconds=5)

VIGIADOS = (TipoRegra.PRESENCA, TipoRegra.CONTAGEM)


class Freio:
    """Para o vigia quando a máquina está ocupada; solta quando ela folga.

    Duas marcas, de propósito: parar em 60% e voltar em 60% faria o vigia
    ligar e desligar a cada medida perto do limite.
    """

    def __init__(self, *, parar_acima_de: float = 60.0, voltar_abaixo_de: float = 45.0, medidas: int = 4) -> None:
        self.parar_acima_de = parar_acima_de
        self.voltar_abaixo_de = voltar_abaixo_de
        self._ultimas: deque[float] = deque(maxlen=medidas)
        self.puxado = False

    def alimentar(self, cpu: float | None) -> bool:
        """Uma medida do processador (%). Devolve `True` quando o estado MUDOU.

        `None` é "não medi": não entra na conta e não muda nada.
        """
        if cpu is None:
            return False
        self._ultimas.append(float(cpu))
        if len(self._ultimas) < (self._ultimas.maxlen or 1):
            return False
        if not self.puxado and all(v > self.parar_acima_de for v in self._ultimas):
            self.puxado = True
            return True
        if self.puxado and all(v < self.voltar_abaixo_de for v in self._ultimas):
            self.puxado = False
            return True
        return False


@dataclass
class _Alvo:
    """Um critério vigiado numa área: o que contar, e quanto havia na última olhada."""

    regra: Regra
    classe: str
    na_ultima_olhada: int | None = None


class Vigia:
    def __init__(
        self,
        contar: Callable[[np.ndarray, str], int],
        *,
        classes: dict[str, str],
        minimo_entre_extras: timedelta = MINIMO_ENTRE_EXTRAS,
    ) -> None:
        # `contar(imagem, classe)` devolve quantos objetos daquela classe o
        # detector vê com certeza. `classes` traduz o objeto do critério
        # ("pessoa") para a classe do detector ("person").
        self._contar = contar
        self._classes = classes
        self.minimo_entre_extras = minimo_entre_extras
        self._alvos: dict[str, list[_Alvo]] = {}          # por canal
        self._ultima_extra: dict[str, datetime] = {}
        self.freio = Freio()

    # ───────────────────────── o que vigiar ─────────────────────────

    def montar(self, regras: list[Regra]) -> None:
        """Os critérios de presença e de contagem que têm o que procurar.

        Remontar (configuração nova) zera a referência: sem olhada desde
        então, o vigia não tem com o que comparar.
        """
        self._alvos = {}
        for r in regras:
            if r.tipo not in VIGIADOS or not r.zona.ponto_id:
                continue
            classe = self._classes.get(str((r.parametros or {}).get("objeto") or "").strip().lower())
            if not classe:
                continue
            self._alvos.setdefault(str(r.zona.ponto_id), []).append(_Alvo(r, classe))
        self._ultima_extra = {p: t for p, t in self._ultima_extra.items() if p in self._alvos}

    @property
    def canais(self) -> list[str]:
        return list(self._alvos)

    def _quadro(self, fonte: Any, agora: datetime):
        """O último quadro do fluxo menor — ou nada. NUNCA abre fluxo."""
        pegar = getattr(fonte, "quadro_do_fluxo_menor", None)
        if pegar is None:
            return None
        quadro = pegar()
        if quadro is None or agora - quadro.ts > QUADRO_VELHO:
            return None
        return quadro

    def _contagens(self, ponto_id: str, fonte: Any, agora: datetime) -> list[int] | None:
        """Quanto de cada alvo do canal há no fluxo menor agora. `None` = sem quadro confiável."""
        quadro = self._quadro(fonte, agora)
        if quadro is None:
            return None
        saida: list[int] = []
        for alvo in self._alvos.get(ponto_id, []):
            if not alvo.regra.vale_agora(agora):
                # Fora do horário do critério não há o que vigiar: a olhada
                # extra também não o julgaria.
                saida.append(-1)
                continue
            f, dentro = recorte.recortar_area(quadro, alvo.regra.zona)
            saida.append(int(self._contar(recorte.apagar_fora(f, dentro).imagem, alvo.classe)))
        return saida

    # ───────────────────────── depois de uma olhada ─────────────────────────

    def anotar_olhada(self, ponto_id: str, fonte: Any, agora: datetime) -> None:
        """A auditoria acabou de olhar este canal: é com ESTE instante que se compara."""
        alvos = self._alvos.get(ponto_id)
        if not alvos:
            return
        try:
            contagens = self._contagens(ponto_id, fonte, agora)
        except Exception as e:  # noqa: BLE001
            _log.debug("o vigia não leu o canal %s depois da olhada: %s", ponto_id, e)
            contagens = None
        for i, alvo in enumerate(alvos):
            # Sem quadro, a referência some: melhor não comparar do que
            # comparar com o que já era velho.
            alvo.na_ultima_olhada = None if contagens is None or contagens[i] < 0 else contagens[i]

    # ───────────────────────── entre uma olhada e outra ─────────────────────────

    def olhar(self, fontes: dict[str, Any], agora: datetime) -> list[str]:
        """Os canais em que a contagem mudou desde a última olhada: pedem olhada agora."""
        if self.freio.puxado:
            return []
        mudaram: list[str] = []
        for ponto_id, alvos in self._alvos.items():
            fonte = fontes.get(ponto_id)
            if fonte is None:
                continue
            ultima = self._ultima_extra.get(ponto_id)
            if ultima is not None and agora - ultima < self.minimo_entre_extras:
                continue
            try:
                contagens = self._contagens(ponto_id, fonte, agora)
            except Exception as e:  # noqa: BLE001
                # O vigia nunca derruba a auditoria: sem ele, fica a rotina.
                _log.debug("o vigia não leu o canal %s: %s", ponto_id, e)
                continue
            if contagens is None:
                continue
            if any(
                alvo.na_ultima_olhada is not None and n >= 0 and n != alvo.na_ultima_olhada
                for alvo, n in zip(alvos, contagens)
            ):
                mudaram.append(ponto_id)
                self._ultima_extra[ponto_id] = agora
        return mudaram
