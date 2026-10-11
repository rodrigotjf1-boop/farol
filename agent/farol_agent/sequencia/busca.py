"""A busca pelo meio: achar, entre duas olhadas, onde a cena mudou — sem ler o intervalo inteiro.

O agente olha cada canal de tempos em tempos. Numa olhada a cena está de um
jeito ("a tampa nua"); na seguinte, de outro ("coberta"). O que houve no meio
ficou no gravador. Em vez de trazer o intervalo todo, pede-se o bloco **do
meio**, escolhe-se o quadro parado dele e pergunta-se a quem sabe julgar:

- ainda está como ANTES → o que se procura, se houve, veio depois: a busca
  anda para a frente;
- já está como DEPOIS → veio antes: anda para trás;
- ACHOU → o que se procura está à vista. A dúvida acaba.

Cada passo é um bloco baixado e um quadro julgado (pedido do dono em
10/10/2026, medido na mesma madrugada: `docs/teste-das-fichas.md`, rodada 5).

## Quando a busca para sem achar

- **a mão em cima** — o bloco do meio não tem trecho parado: o alvo está
  coberto por quem trabalha. Esse quadro não vai a juízo, e o bloco é a
  **janela da mão**: é dela que sai a grade de quadros (`grade.py`), com
  outra pergunta ("o que foi posto?");
- **apertou** — o bloco do meio já foi lido: entre as duas pontas não há
  quadro novo para olhar. Sobra a dúvida, do tamanho de um bloco ou menos;
- **não sei** — quem julga não soube dizer daquele quadro. A busca não chuta
  um lado;
- **limite** — os passos acabaram.

Em todos, `Resultado.janela` diz de onde tirar a grade.

## O que este módulo NÃO faz

Não fala com o gravador nem com juiz nenhum: recebe quem lê um bloco e quem
julga um quadro. A conversa com o gravador (a hora dele, a gravação que já
assentou, o trecho que veio cortado) é do `gravado.py`. Tudo aqui está num
relógio só — o de quem lê os blocos.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Callable

from farol_agent.dvr.arquivo import inicio_do_bloco
from farol_agent.sequencia.bloco import Escolha

# Quantos blocos, no máximo, uma busca lê. Cada passo corta a dúvida pela
# metade: seis passos apertam uma dúvida de até 64 blocos. É teto de gasto
# (um pedido ao gravador e um juízo por passo), não medida de loja.
MAX_PASSOS = 6


class Lado(str, Enum):
    """O que o juiz diz do quadro escolhido."""

    ANTES = "antes"      # a cena ainda está como na ponta de antes
    DEPOIS = "depois"    # já está como na ponta de depois
    ACHOU = "achou"      # o que se procura está à vista
    NAO_SEI = "nao_sei"  # não deu para dizer


ACHOU = "achou"
MAO = "mao"
APERTOU = "apertou"
NAO_SEI = "nao_sei"
LIMITE = "limite"


@dataclass(frozen=True)
class Leitura:
    """Um bloco lido: de onde até onde ele vai, e o quadro escolhido nele."""

    de: datetime
    ate: datetime
    escolha: Escolha


@dataclass(frozen=True)
class Passo:
    """Um passo da busca, para quem for conferir depois."""

    # O bloco lido.
    de: datetime
    ate: datetime
    # O instante do quadro escolhido, e se ele estava num trecho parado.
    ts: datetime
    parado: bool
    # O que o juiz disse. `None` = não foi a juízo (a mão em cima do alvo).
    lado: Lado | None


@dataclass(frozen=True)
class Resultado:
    desfecho: str
    # A dúvida que sobra: o que se procura, se houve, está entre estes dois
    # instantes. Quando ACHOU, é o bloco em que foi achado.
    de: datetime
    ate: datetime
    # O quadro que decidiu: onde achou, o da mão, ou o que o juiz não soube ler.
    instante: datetime | None
    # De onde tirar a grade de quadros: o bloco da mão, ou a dúvida que sobrou.
    # `None` quando achou — não há mais o que perguntar.
    janela: tuple[datetime, datetime] | None
    passos: tuple[Passo, ...]

    @property
    def achou(self) -> bool:
        return self.desfecho == ACHOU


def buscar(
    ler: Callable[[datetime], Leitura],
    julgar: Callable[[Leitura], Lado],
    de: datetime,
    ate: datetime,
    *,
    bloco_s: int,
    desvio_s: int = 0,
    max_passos: int = MAX_PASSOS,
) -> Resultado:
    """Procura, entre `de` (a cena como antes) e `ate` (como depois), o que houve no meio.

    `ler` recebe o COMEÇO de um bloco e devolve o bloco lido; `julgar` diz de
    que lado o quadro escolhido está. `bloco_s` e `desvio_s` são os do
    gravador (medidos): é por eles que se sabe, sem baixar nada, se o bloco do
    meio já foi lido.

    O que `ler` ou `julgar` levantarem sobe como está: quem chama decide se
    espera e tenta de novo.
    """
    if ate <= de:
        raise ValueError("a ponta de depois vem depois da de antes")
    if max_passos < 1:
        raise ValueError("a busca dá pelo menos um passo")

    antes, depois = de, ate
    lidos: set[datetime] = set()
    passos: list[Passo] = []

    def fim(desfecho: str, instante: datetime | None, janela: tuple[datetime, datetime] | None) -> Resultado:
        return Resultado(desfecho=desfecho, de=antes, ate=depois, instante=instante, janela=janela, passos=tuple(passos))

    while len(passos) < max_passos:
        comeco = inicio_do_bloco(antes + (depois - antes) / 2, bloco_s, desvio_s)
        if comeco in lidos:
            # O quadro deste bloco já foi julgado: não há quadro novo entre as pontas.
            return fim(APERTOU, passos[-1].ts, (antes, depois))
        leitura = ler(comeco)
        lidos.add(comeco)
        escolha = leitura.escolha

        if not escolha.parado:
            # A mão em cima do alvo: este quadro não vai a juízo. O bloco é a janela da mão.
            passos.append(Passo(leitura.de, leitura.ate, escolha.ts, False, None))
            return fim(MAO, escolha.ts, (leitura.de, leitura.ate))

        # Resposta que não é nenhum dos quatro lados vale como "não sei": a busca não chuta.
        try:
            lado = Lado(julgar(leitura))
        except ValueError:
            lado = Lado.NAO_SEI
        passos.append(Passo(leitura.de, leitura.ate, escolha.ts, True, lado))
        if lado is Lado.ACHOU:
            antes, depois = leitura.de, leitura.ate
            return fim(ACHOU, escolha.ts, None)
        if lado is not Lado.ANTES and lado is not Lado.DEPOIS:
            return fim(NAO_SEI, escolha.ts, (antes, depois))
        # A ponta só anda com um quadro de DENTRO da dúvida. O bloco do meio pode
        # passar das pontas, e o quadro escolhido cair fora delas: ele não diz
        # nada de novo (ou contradiz a olhada da ponta) — as pontas ficam, e a
        # volta seguinte acha o mesmo bloco já lido.
        if antes < escolha.ts < depois:
            if lado is Lado.ANTES:
                antes = escolha.ts
            else:
                depois = escolha.ts

    return fim(LIMITE, passos[-1].ts, (antes, depois))
