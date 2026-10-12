"""A quietude — o quadro de bancada parou de mexer? (as mãos saíram)

Na posição de montagem a imagem que vale é a de quando **as mãos saíram**: o
que foi montado fica à vista, sem mão na frente e sem ninguém no quadro. O
borrão de rosto não serve ali — de cima não há rosto, e ele apagava o pão
(12 de 40 momentos, no teste de 08/10/2026).

O detector de pessoas também não serve: visto de cima ele vê braço e mão,
não gente. Na medida de 09/10 (canal 4, uma hora cheia), o tampo mudava em
82% das olhadas e o detector só via alguém com certeza em 15%.

O que serve é o **movimento**, medido de perto. O fluxo MENOR de cada canal
já fica aberto o tempo todo; duas vezes por segundo, aqui, mede-se quanto o
quadro mudou desde a amostra anterior — a mesma medida do porteiro. Quieto
é: nada mexeu nas três últimas amostras (um segundo e meio).

## O que foi medido (loja, gravação de 08/10/2026, 21h10–21h20, canal 4)

Com a gravação do fluxo principal, uma amostra a cada 0,53 s:

    o tampo mexia em 29% das amostras, e ficou parado 71% do tempo
    "parou" (mexia, e ficou 1,6 s parado): 20 vezes em 10 minutos
    quieto, pela regra daqui, em 67% dos instantes

E, conferido a olho em 22 recortes: nos 12 instantes em que o tampo parou
não havia mão nem braço no quadro; dos 10 instantes ao acaso, os 6 que esta
regra deixaria passar também não tinham — e os 2 com mãos ela segurou.

## O que a regra NÃO cobre

A medida é de meio em meio segundo, e a foto é tirada depois dela: a mão
que entra nesse intervalo sai na foto. Na série medida, em 20 dos 751
instantes quietos (3%) a amostra seguinte já mexia.

## O que NÃO foi medido

Tudo isso saiu do fluxo PRINCIPAL gravado (o gravador não guarda o menor).
O fluxo menor ao vivo (704×480) deu ruído zero com a loja fechada, e a
mesma gravação reduzida ao tamanho dele deu a mesma resposta amostra por
amostra (ver `docs/decisoes.md`). Com a loja aberta e o fluxo menor de
verdade, ainda não. E são dez minutos, de um canal, de uma noite.

## Não sei não é quieto

Sem fluxo menor, com o fluxo parado ou sem três amostras recentes, a
resposta é `None`: quem pergunta decide o que fazer com "não sei" — e o
motor, nesse caso, segue como sempre foi (com o borrão de rosto).
"""

from __future__ import annotations

import logging
import threading
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from functools import lru_cache
from typing import Any, Callable

import cv2
import numpy as np

from farol_agent.modelos import Frame, Zona
from farol_agent.pipeline import recorte
from farol_agent.porteiro import PARTE_QUE_MUDOU, SALTO_DO_PONTO

_log = logging.getLogger(__name__)

# De quanto em quanto tempo o quadro é medido.
PASSO = 0.5
# Quantas amostras seguidas sem movimento fazem o quadro "quieto" (1,5 s).
AMOSTRAS_QUIETAS = 3
# Amostra mais velha que isto não diz como o quadro está AGORA.
VELHO = timedelta(seconds=2)
# O quadro reduzido em que se mede o movimento — o do porteiro.
_LADO = (96, 54)


@lru_cache(maxsize=256)
def _molde(
    poligono: tuple[tuple[float, float], ...], largura: int, altura: int
) -> tuple[int, int, int, int, np.ndarray | None]:
    """Onde o quadro fica na imagem do canal e, dentro do retângulo, o que NÃO é dele.

    Sai do mesmo recorte que o resto do agente usa (`recortar_area`), feito
    uma vez por desenho e por tamanho de imagem: o desenho do quadro não
    muda de uma leitura para a outra, e desenhá-lo duas vezes por segundo
    era a maior parte do custo da medida.
    """
    zona = Zona(id="", nome="", poligono=[tuple(p) for p in poligono])
    x1, y1, x2, y2 = zona.bbox(largura, altura, 0.0)
    if x2 <= x1 or y2 <= y1:
        # Desenho sem área: `recortar_area` devolve a imagem inteira.
        return 0, 0, largura, altura, None
    # Uma imagem em branco do tamanho da do canal, só para pedir o desenho.
    em_branco = Frame(np.zeros((altura, largura), dtype=np.uint8), datetime.min, "")
    _, dentro = recorte.recortar_area(em_branco, zona)
    if dentro is None:
        return x1, y1, x2, y2, None
    fora = dentro == 0
    fora.flags.writeable = False     # é de todos os que lerem este quadro: ninguém escreve nele
    return x1, y1, x2, y2, fora


def reduzir(quadro: Any, zona: Zona) -> np.ndarray:
    """O quadro (a área `zona` da imagem do canal), em tons de cinza, no tamanho da medida.

    O que é de fora do desenho é apagado antes: movimento na área ao lado
    não é movimento desta. A cor fica de fora — a câmera troca de cor e de
    infravermelho sem nada ter mexido.

    O resultado é, ponto a ponto, o de recortar a área, apagar o que é de
    fora (`recorte.apagar_fora`), passar para cinza e reduzir — nessa ordem.
    Aqui o cinza vem antes do apagar, e o desenho do quadro é guardado: dá
    no mesmo (o cinza liso de fora é o mesmo tom nos três canais) e custa
    uma fração.
    """
    x1, y1, x2, y2, fora = _molde(tuple(tuple(p) for p in zona.poligono), quadro.largura, quadro.altura)
    pedaco = quadro.imagem[y1:y2, x1:x2]
    cinza = cv2.cvtColor(pedaco, cv2.COLOR_BGR2GRAY) if pedaco.ndim == 3 else pedaco
    if fora is not None:
        if cinza is pedaco:
            cinza = pedaco.copy()      # a imagem é da fonte: não se escreve nela
        cinza[fora] = recorte.COR_DE_FORA[0]
    return cv2.resize(cinza, _LADO, interpolation=cv2.INTER_AREA).astype(np.int16)


def fracao_que_mudou(antes: np.ndarray, agora: np.ndarray, salto: int = SALTO_DO_PONTO) -> float:
    """Que parte dos pontos mudou de uma leitura para a outra, de 0 a 1.

    Um ponto "mudou" quando o tom dele variou mais do que `salto`. É a
    medida do porteiro; quem chama decide o que é "mexeu" (a quietude e a
    atenção usam o mesmo limite, `PARTE_QUE_MUDOU`).
    """
    return float(np.mean(np.abs(agora - antes) > salto))


@dataclass
class _Quadro:
    zona: Zona
    # A cena reduzida da última amostra.
    anterior: np.ndarray | None = None
    # As últimas amostras: (quando, mexeu?). `None` = não deu para medir.
    amostras: deque[tuple[datetime, bool | None]] = field(default_factory=lambda: deque(maxlen=AMOSTRAS_QUIETAS))


class Quietude:
    """Acompanha o movimento de alguns quadros no fluxo menor, e diz se estão quietos."""

    def __init__(
        self,
        *,
        passo: float = PASSO,
        salto: int = SALTO_DO_PONTO,
        parte: float = PARTE_QUE_MUDOU,
        relogio: Callable[[], datetime] = datetime.now,
    ) -> None:
        # O relógio é o de AGORA, e não o da olhada: a volta de rotina
        # carimba todos os canais com o instante em que começou, e o sexto
        # canal é olhado dez segundos depois. "Quieto" é agora.
        self._relogio = relogio
        self.passo = passo
        self.salto = salto
        self.parte = parte
        # Por canal, os quadros acompanhados.
        self._quadros: dict[str, dict[str, _Quadro]] = {}
        # Por canal, o instante do último quadro do fluxo menor já medido.
        self._ultimo_quadro: dict[str, datetime] = {}
        self._trava = threading.Lock()
        self._parar = threading.Event()
        self._thread: threading.Thread | None = None

    # ───────────────────────── o que acompanhar ─────────────────────────

    def montar(self, quadros: dict[str, list[Zona]]) -> None:
        """Os quadros a acompanhar, por canal. O que continua guarda a memória; o que saiu é largado."""
        with self._trava:
            novos: dict[str, dict[str, _Quadro]] = {}
            for ponto_id, zonas in quadros.items():
                antes = self._quadros.get(ponto_id, {})
                do_canal: dict[str, _Quadro] = {}
                for z in zonas:
                    velho = antes.get(z.id)
                    # Quadro redesenhado é outro recorte: a memória não vale.
                    mesmo = velho is not None and velho.zona.poligono == z.poligono
                    do_canal[z.id] = velho if mesmo else _Quadro(z)
                if do_canal:
                    novos[ponto_id] = do_canal
            self._quadros = novos

    @property
    def canais(self) -> list[str]:
        return list(self._quadros)

    # ───────────────────────── a medida ─────────────────────────

    def amostrar(self, fontes: dict[str, Any]) -> None:
        """Uma amostra de cada quadro acompanhado. NUNCA abre fluxo: usa o menor, que já está aberto."""
        agora = self._relogio()
        with self._trava:
            canais = list(self._quadros.items())
        for ponto_id, do_canal in canais:
            quadro = None
            pegar = getattr(fontes.get(ponto_id), "quadro_do_fluxo_menor", None)
            if pegar is not None:
                try:
                    quadro = pegar()
                except Exception as e:  # noqa: BLE001
                    _log.debug("a quietude não leu o canal %s: %s", ponto_id, e)
            # Sem quadro, ou com o mesmo de antes (o fluxo parou): não se sabe.
            novo = quadro is not None and self._ultimo_quadro.get(ponto_id) != quadro.ts
            if novo:
                self._ultimo_quadro[ponto_id] = quadro.ts
            for q in do_canal.values():
                mexeu: bool | None = None
                if novo:
                    try:
                        mexeu = self._medir(q, quadro)
                    except Exception as e:  # noqa: BLE001
                        _log.debug("a quietude não mediu %s: %s", q.zona.nome, e)
                        q.anterior = None
                else:
                    # Depois de um buraco, a próxima amostra não tem com o que comparar.
                    q.anterior = None
                with self._trava:
                    q.amostras.append((agora, mexeu))

    def _medir(self, q: _Quadro, quadro: Any) -> bool | None:
        pequeno = reduzir(quadro, q.zona)
        antes, q.anterior = q.anterior, pequeno
        if antes is None:
            return None
        return bool(fracao_que_mudou(antes, pequeno, self.salto) >= self.parte)

    def quieto(self, ponto_id: str, zona_id: str) -> bool | None:
        """O quadro está quieto há um segundo e meio? `None` = não sei.

        `False` basta UMA das últimas amostras ter mexido. `True` exige as
        três, todas medidas e recentes.
        """
        agora = self._relogio()
        with self._trava:
            q = self._quadros.get(str(ponto_id), {}).get(str(zona_id))
            ultimas = list(q.amostras) if q is not None else []
        if not ultimas:
            return None
        quando, _ = ultimas[-1]
        if not timedelta(0) <= agora - quando <= VELHO:
            return None
        if any(mexeu is True for _, mexeu in ultimas):
            return False
        if len(ultimas) < AMOSTRAS_QUIETAS or any(mexeu is None for _, mexeu in ultimas):
            return None
        return True

    # ───────────────────────── thread própria ─────────────────────────

    def iniciar(self, fontes: Callable[[], dict[str, Any]]) -> None:
        """Mede em thread própria: a auditoria passa segundos julgando, e a medida é de meio em meio segundo."""
        if self._thread is not None:
            return
        self._parar.clear()

        def laco() -> None:
            while not self._parar.wait(self.passo):
                try:
                    self.amostrar(fontes())
                except Exception:  # noqa: BLE001
                    _log.exception("a quietude falhou numa amostra; sigo")

        self._thread = threading.Thread(target=laco, name="farol-quietude", daemon=True)
        self._thread.start()

    def parar(self) -> None:
        self._parar.set()
        if self._thread is not None:
            self._thread.join(timeout=3)
            self._thread = None
