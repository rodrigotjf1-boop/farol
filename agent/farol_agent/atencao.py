"""A atenção — o quadro acordou? assentou? (os estados do quadro, contados)

A olhada de rotina, de 30 em 30 segundos, pergunta "algo mudou?" comparando
com a olhada anterior. No pico quase sempre mudou, e o instante que
interessa — o quadro que **parou** — passa entre uma olhada e outra.

A atenção lê o que a rotina não vê. O fluxo MENOR de cada canal já fica
aberto o tempo todo; duas vezes por segundo, aqui, mede-se quanto cada
quadro mudou desde a leitura anterior (a medida do porteiro e da quietude)
e acompanha-se o estado dele:

    repouso ──(duas leituras seguidas com movimento)──▶ ACORDOU ─▶ em atividade
    em atividade ──(cinco segundos medidos sem movimento)──▶ ASSENTOU ─▶ repouso

## Por enquanto, só conta

Nada aqui muda o que a loja faz: as olhadas são as de sempre. O que existe
é a contagem, por quadro e por hora — quantas leituras, em quantas havia
movimento, quantos clarões, quantas vezes o quadro acordou e assentou. É a
medida que a gravação deu uma vez (docs/decisoes.md, 12/10/2026, "O passo 0
do A20", item 5), agora ao vivo e em todo quadro que tem critério. Com ela
se decide se os gatilhos do estudo ("mexeu", "parou", "entrou", "saiu")
passam a sair daqui.

## O clarão

A luz que acende, a câmera que troca para infravermelho: a área inteira
muda de uma vez. Não é movimento de ninguém. A leitura em que mais de 60%
dos pontos mudam não conta — nem como movimento, nem como calma. É contada
à parte.

## Não sei não é calma

Sem fluxo menor, com o fluxo parado ou na primeira leitura depois de um
buraco, não há medida. Em repouso, o buraco quebra a sequência de leituras
com movimento. Em atividade, quebra a calma: os cinco segundos têm de ser
MEDIDOS, do começo ao fim.

Os números de fábrica (duas leituras, cinco segundos, 60%) são o ponto de
partida do plano, e não medida de loja nenhuma: é para calibrá-los que a
contagem existe.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Callable

import numpy as np

from farol_agent.modelos import Zona
from farol_agent.porteiro import PARTE_QUE_MUDOU, SALTO_DO_PONTO
from farol_agent.quietude import PASSO, fracao_que_mudou, reduzir

_log = logging.getLogger(__name__)

# Quantas leituras seguidas com movimento acordam o quadro.
LEITURAS_PARA_ACORDAR = 2
# Quanto tempo medido sem movimento faz o quadro assentar.
CALMA_PARA_ASSENTAR_SEG = 5.0
# Acima desta parte dos pontos mudando de uma vez, a leitura é um clarão.
PARTE_DO_CLARAO = 0.60

# O que se conta de cada quadro, em cada hora. Os nomes são os do resumo.
CONTADORES = ("leituras", "com_movimento", "claroes", "acordou", "assentou")


@dataclass
class _Quadro:
    zona: Zona
    # A cena reduzida da última leitura. `None` = não há com o que comparar.
    anterior: np.ndarray | None = None
    em_atividade: bool = False
    # Em repouso: quantas leituras seguidas com movimento.
    seguidas: int = 0
    # Em atividade: de quando se conta a calma — a última leitura com
    # movimento, ou a primeira calma depois de um buraco. `None` = não se sabe.
    calmo_desde: datetime | None = None


class Atencao:
    """Acompanha o estado de cada quadro no fluxo menor, e conta o que acontece nele."""

    def __init__(
        self,
        *,
        passo: float = PASSO,
        salto: int = SALTO_DO_PONTO,
        parte: float = PARTE_QUE_MUDOU,
        clarao: float = PARTE_DO_CLARAO,
        acordar: int = LEITURAS_PARA_ACORDAR,
        assentar_seg: float = CALMA_PARA_ASSENTAR_SEG,
        relogio: Callable[[], datetime] = datetime.now,
    ) -> None:
        self._relogio = relogio
        self.passo = passo
        self.salto = salto
        self.parte = parte
        self.clarao = clarao
        self.acordar = acordar
        self.assentar = timedelta(seconds=assentar_seg)
        # Por canal, os quadros acompanhados.
        self._quadros: dict[str, dict[str, _Quadro]] = {}
        # Por canal, o instante do último quadro do fluxo menor já lido.
        self._ultimo_quadro: dict[str, datetime] = {}
        # O que foi contado e ainda não foi colhido: por (hora cheia, canal,
        # quadro), os contadores e o instante da última leitura somada.
        self._contado: dict[tuple[datetime, str, str], tuple[dict[str, int], datetime]] = {}
        self._trava = threading.Lock()
        self._parar = threading.Event()
        self._thread: threading.Thread | None = None

    # ───────────────────────── o que acompanhar ─────────────────────────

    def montar(self, quadros: dict[str, list[Zona]]) -> None:
        """Os quadros a acompanhar, por canal. O que continua guarda o estado; o que saiu é largado."""
        with self._trava:
            novos: dict[str, dict[str, _Quadro]] = {}
            for ponto_id, zonas in quadros.items():
                antes = self._quadros.get(str(ponto_id), {})
                do_canal: dict[str, _Quadro] = {}
                for z in zonas:
                    velho = antes.get(z.id)
                    # Quadro redesenhado é outro recorte: o estado não vale.
                    mesmo = velho is not None and velho.zona.poligono == z.poligono
                    do_canal[z.id] = velho if mesmo else _Quadro(z)
                if do_canal:
                    novos[str(ponto_id)] = do_canal
            self._quadros = novos
            self._ultimo_quadro = {p: t for p, t in self._ultimo_quadro.items() if p in novos}

    @property
    def canais(self) -> list[str]:
        return list(self._quadros)

    def estado(self, ponto_id: str, zona_id: str) -> str | None:
        """Como o quadro está: "repouso" ou "em_atividade". `None` = não é acompanhado."""
        with self._trava:
            q = self._quadros.get(str(ponto_id), {}).get(str(zona_id))
            if q is None:
                return None
            return "em_atividade" if q.em_atividade else "repouso"

    # ───────────────────────── a leitura ─────────────────────────

    def amostrar(self, fontes: dict[str, Any]) -> None:
        """Uma leitura de cada quadro acompanhado. NUNCA abre fluxo: usa o menor, que já está aberto."""
        agora = self._relogio()
        with self._trava:
            canais = [(ponto_id, list(do_canal.values())) for ponto_id, do_canal in self._quadros.items()]
        for ponto_id, do_canal in canais:
            quadro = None
            pegar = getattr(fontes.get(ponto_id), "quadro_do_fluxo_menor", None)
            if pegar is not None:
                try:
                    quadro = pegar()
                except Exception as e:  # noqa: BLE001
                    _log.debug("a atenção não leu o canal %s: %s", ponto_id, e)
            # Sem quadro, ou com o mesmo de antes (o fluxo parou): não se sabe.
            novo = quadro is not None and self._ultimo_quadro.get(ponto_id) != quadro.ts
            if novo:
                self._ultimo_quadro[ponto_id] = quadro.ts
            for q in do_canal:
                fracao: float | None = None
                if novo:
                    try:
                        fracao = self._medir(q, quadro)
                    except Exception as e:  # noqa: BLE001
                        _log.debug("a atenção não mediu %s: %s", q.zona.nome, e)
                        q.anterior = None
                else:
                    # Depois de um buraco, a próxima leitura não tem com o que comparar.
                    q.anterior = None
                with self._trava:
                    self._ler(ponto_id, q, agora, fracao)

    def _medir(self, q: _Quadro, quadro: Any) -> float | None:
        pequeno = reduzir(quadro, q.zona)
        antes, q.anterior = q.anterior, pequeno
        if antes is None:
            return None
        return fracao_que_mudou(antes, pequeno, self.salto)

    def _ler(self, ponto_id: str, q: _Quadro, agora: datetime, fracao: float | None) -> None:
        """Uma leitura do quadro: anda o estado e soma o que aconteceu. Quem chama segura a trava."""
        if fracao is None:
            # Não sei: em repouso quebra a sequência; em atividade, a calma.
            q.seguidas = 0
            q.calmo_desde = None
            return
        if fracao > self.clarao:
            # O clarão não conta: nem movimento, nem calma.
            self._somar(ponto_id, q, agora, leituras=1, claroes=1)
            return

        mexeu = fracao >= self.parte
        somas = {"leituras": 1, "com_movimento": 1 if mexeu else 0}
        if not q.em_atividade:
            q.seguidas = q.seguidas + 1 if mexeu else 0
            if q.seguidas >= self.acordar:
                # Acordou. A calma, quando vier, conta desta leitura.
                q.em_atividade, q.seguidas, q.calmo_desde = True, 0, agora
                somas["acordou"] = 1
        elif mexeu:
            q.calmo_desde = agora
        elif q.calmo_desde is None:
            # A primeira leitura calma depois de um buraco: a conta recomeça aqui.
            q.calmo_desde = agora
        elif agora - q.calmo_desde >= self.assentar:
            q.em_atividade, q.calmo_desde = False, None
            somas["assentou"] = 1
        self._somar(ponto_id, q, agora, **somas)

    def _somar(self, ponto_id: str, q: _Quadro, agora: datetime, **somas: int) -> None:
        hora = agora.replace(minute=0, second=0, microsecond=0)
        contado, _ = self._contado.get((hora, ponto_id, q.zona.id), ({}, agora))
        for nome, valor in somas.items():
            if valor:
                contado[nome] = contado.get(nome, 0) + valor
        self._contado[(hora, ponto_id, q.zona.id)] = (contado, agora)

    # ───────────────────────── a colheita ─────────────────────────

    def colher(self) -> list[tuple[datetime, str, str, dict[str, int]]]:
        """O que foi contado desde a última colheita — e a conta recomeça do zero.

        Uma linha por (hora, canal, quadro): o instante da última leitura
        somada (é ele que diz em que hora a linha cai), o canal, o quadro e
        os contadores que andaram. Quem colhe é quem grava: se a gravação
        falhar, o que foi colhido se perde — são segundos de contagem.
        """
        with self._trava:
            contado, self._contado = self._contado, {}
        return [
            (ultima, ponto_id, zona_id, somas)
            for (_, ponto_id, zona_id), (somas, ultima) in sorted(contado.items(), key=lambda par: par[0])
            if somas
        ]

    # ───────────────────────── thread própria ─────────────────────────

    def iniciar(self, fontes: Callable[[], dict[str, Any]]) -> None:
        """Lê em thread própria, no passo dela: a auditoria passa segundos julgando."""
        if self._thread is not None:
            return
        self._parar.clear()

        def laco() -> None:
            while not self._parar.wait(self.passo):
                try:
                    self.amostrar(fontes())
                except Exception:  # noqa: BLE001
                    _log.exception("a atenção falhou numa leitura; sigo")

        self._thread = threading.Thread(target=laco, name="farol-atencao", daemon=True)
        self._thread.start()

    def parar(self) -> None:
        self._parar.set()
        if self._thread is not None:
            self._thread.join(timeout=3)
            self._thread = None
