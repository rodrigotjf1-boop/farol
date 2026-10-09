"""Os sinais da loja — o que ela sabe sozinha, de graça, sobre cada lugar.

O estudo de um critério (A19) diz QUANDO vale a pena olhar: o **contexto**
que precisa estar acontecendo e o **gatilho** que abre a análise. O exemplo
é do dono: para saber se o colaborador da chapa salga as carnes, é preciso
haver carne na chapa e colaborador no posto — sem isso não se analisa. Na
medida de 08/10/2026, 93% das análises pagas foram feitas fora de contexto.

Aqui ficam os sinais com que a loja confere isso, e a conta.

## Três sinais, cada um lido num lugar

O lugar é um quadro do canal ou a imagem completa.

    pessoa      o detector de pessoas (o mesmo do porteiro)
    movimento   o que mudou desde a olhada anterior (a medida do porteiro)
    padrão      a cena é a da foto padrão do canal? (`comparar.py`)

De cada um saem dois NÍVEIS, para o contexto, e duas BORDAS, para o gatilho:

    sinal       vale             não vale     começou           acabou
    pessoa      pessoa           sem_pessoa   entrou            saiu
    movimento   movimento        parado       mexeu (*)         parou
    padrão      fora_do_padrao   no_padrao    saiu_do_padrao    voltou_ao_padrao

    (*) "mexeu" é o próprio nível: movimento já é mudança.

E dois gatilhos do relógio: `toda_olhada` e `a_cada` N minutos.

## Na dúvida, pergunta

É a regra do porteiro, e vale aqui inteira: segurar uma pergunta que tinha
resposta é pior do que fazer uma que não tinha. Por isso:

- o que não se sabe ler **não segura** — sem detector, sem foto padrão,
  lugar que não existe mais, primeira olhada: a condição de contexto vale e
  o gatilho dispara;
- `pessoa` só deixa de valer quando o detector não viu **nem um talvez**;
  `sem_pessoa`, só quando viu alguém **com certeza**;
- a borda de pessoa tem histerese: a certeza liga, o "nem um talvez"
  desliga, e o que fica no meio mantém o que era. Sem isso, uma pessoa na
  beirada do quadro faria "entrou" e "saiu" a cada olhada.

## A olhada anterior

A borda compara com a olhada ANTERIOR daquele lugar. Se ela tem mais de
cinco minutos (o critério estava fora do horário, a câmera caiu), não é
"anterior": é outra cena. Aí não se sabe — e dispara.

## Tudo é lido em toda olhada

O contexto que falhou não interrompe a leitura dos outros sinais do estudo:
a borda de amanhã precisa do nível de hoje. O custo é pequeno e limitado
(o detector, 85 ms por lugar; o resto, milésimos), e cada lugar é lido uma
vez por olhada, não importa quantos critérios perguntem.

## O que isto NÃO vê

O ritmo é o da olhada (30 s). O que começa e termina entre duas olhadas não
é borda de nada. Gatilho de segundos — "as mãos saíram de cima do lanche" —
pede sequência, que é da onda 2.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Callable

import cv2
import numpy as np

from farol_agent import comparar
from farol_agent.modelos import GATILHOS_SEM_LUGAR, Condicao, Estudo, Zona
from farol_agent.porteiro import PARTE_QUE_MUDOU, SALTO_DO_PONTO

_log = logging.getLogger(__name__)

# Olhada anterior mais velha que isto não é "a anterior": é outra cena.
VELHO = timedelta(minutes=5)

# O quadro reduzido em que se mede o movimento — o do porteiro.
_LADO_DO_MOVIMENTO = (96, 54)


@dataclass(frozen=True)
class Lugar:
    """Onde um sinal é lido nesta olhada: a chave do lugar, a imagem dele e como dizer o nome."""

    chave: str
    imagem: np.ndarray
    zona: Zona
    nome: str


@dataclass(frozen=True)
class Presenca:
    # O detector viu ao menos um "talvez".
    talvez: bool
    # Viu alguém com certeza.
    certeza: bool
    # Com histerese: é o que as bordas usam.
    ocupado: bool
    # `ocupado` na olhada anterior. `None` = não sei.
    antes: bool | None


@dataclass(frozen=True)
class Movimento:
    # Algo mudou desde a olhada anterior. `None` = não há anterior.
    agora: bool | None
    antes: bool | None


@dataclass(frozen=True)
class Padrao:
    # A cena NÃO é a da foto padrão.
    fora: bool
    antes: bool | None
    semelhanca: float


@dataclass(frozen=True)
class Parecer:
    """O que o estudo diz desta olhada."""

    # A primeira condição de contexto que não vale, dita para quem lê. `None` = o contexto vale.
    falta: str | None
    # O sinal dessa condição ("pessoa", "sem_pessoa"…).
    sinal_que_falta: str | None
    # Algum gatilho abriu a análise (ou o estudo não tem gatilho).
    disparou: bool


@dataclass
class _Guardado:
    ts: datetime
    leitura: object
    pequeno: np.ndarray | None = None


class Sinais:
    """Lê os sinais de cada lugar, uma vez por olhada, e confere o estudo de cada critério.

    `pessoas(imagem, lugar, ts)` devolve os pontos do detector de pessoas
    (ou `None`: não há detector, ou ele falhou). `semelhanca(imagem, zona)`
    devolve quão igual à foto padrão do canal é aquele recorte (ou `None`:
    não há foto, não há medida).
    """

    def __init__(
        self,
        pessoas: Callable[[np.ndarray, str, datetime], list[float] | None] | None = None,
        *,
        semelhanca: Callable[[np.ndarray, Zona], float | None] | None = None,
        certeza: float = 0.70,
        duvida: float = 0.35,
        limiar_padrao: float = comparar.LIMIAR_IGUAL,
        salto: int = SALTO_DO_PONTO,
        parte: float = PARTE_QUE_MUDOU,
        velho: timedelta = VELHO,
    ) -> None:
        self._pessoas = pessoas
        self._semelhanca = semelhanca
        self.certeza = certeza
        self.duvida = duvida
        self.limiar_padrao = limiar_padrao
        self.salto = salto
        self.parte = parte
        self.velho = velho
        # Por lugar: a leitura mais recente de cada sinal.
        self._presenca: dict[str, _Guardado] = {}
        self._movimento: dict[str, _Guardado] = {}
        self._padrao: dict[str, _Guardado] = {}
        # Por critério naquele quadro: quando a análise abriu pela última vez.
        self._ultimo_disparo: dict[str, datetime] = {}

    # ─────────────────────────── os sinais ───────────────────────────

    def _anterior(self, guardado: _Guardado | None, ts: datetime) -> _Guardado | None:
        """A leitura da olhada anterior, se ela ainda é "a anterior"."""
        if guardado is None or guardado.leitura is None:
            return None
        if not timedelta(0) < ts - guardado.ts <= self.velho:
            return None
        return guardado

    def presenca(self, lugar: Lugar, ts: datetime) -> Presenca | None:
        guardado = self._presenca.get(lugar.chave)
        if guardado is not None and guardado.ts == ts:
            return guardado.leitura  # type: ignore[return-value]
        pontos = None
        if self._pessoas is not None:
            try:
                pontos = self._pessoas(lugar.imagem, lugar.chave, ts)
            except Exception as e:  # noqa: BLE001
                # Detector que falhou numa imagem não pode calar o critério.
                _log.warning("os sinais não contaram pessoas em %s (%s): não segura", lugar.nome, e)
        leitura: Presenca | None = None
        if pontos is not None:
            talvez = any(p >= self.duvida for p in pontos)
            certeza = any(p >= self.certeza for p in pontos)
            anterior = self._anterior(guardado, ts)
            antes = anterior.leitura.ocupado if anterior is not None else None  # type: ignore[union-attr]
            # A certeza liga, o "nem um talvez" desliga, o meio mantém. Sem
            # saber o que era, o meio conta como alguém: é o lado que pergunta.
            ocupado = True if certeza else False if not talvez else (antes if antes is not None else True)
            leitura = Presenca(talvez=talvez, certeza=certeza, ocupado=ocupado, antes=antes)
        self._presenca[lugar.chave] = _Guardado(ts, leitura)
        return leitura

    def movimento(self, lugar: Lugar, ts: datetime) -> Movimento | None:
        guardado = self._movimento.get(lugar.chave)
        if guardado is not None and guardado.ts == ts:
            return guardado.leitura  # type: ignore[return-value]
        imagem = lugar.imagem
        cinza = cv2.cvtColor(imagem, cv2.COLOR_BGR2GRAY) if imagem.ndim == 3 else imagem
        pequeno = cv2.resize(cinza, _LADO_DO_MOVIMENTO, interpolation=cv2.INTER_AREA).astype(np.int16)
        anterior = self._anterior(guardado, ts)
        agora: bool | None = None
        antes: bool | None = None
        if anterior is not None and anterior.pequeno is not None:
            agora = bool(float(np.mean(np.abs(pequeno - anterior.pequeno) > self.salto)) >= self.parte)
            antes = anterior.leitura.agora  # type: ignore[union-attr]
        leitura = Movimento(agora=agora, antes=antes)
        self._movimento[lugar.chave] = _Guardado(ts, leitura, pequeno)
        return leitura

    def padrao(self, lugar: Lugar, ts: datetime) -> Padrao | None:
        guardado = self._padrao.get(lugar.chave)
        if guardado is not None and guardado.ts == ts:
            return guardado.leitura  # type: ignore[return-value]
        s = None
        if self._semelhanca is not None:
            try:
                s = self._semelhanca(lugar.imagem, lugar.zona)
            except Exception as e:  # noqa: BLE001
                _log.warning("os sinais não compararam %s com a foto padrão (%s): não segura", lugar.nome, e)
        leitura: Padrao | None = None
        if s is not None:
            anterior = self._anterior(guardado, ts)
            antes = anterior.leitura.fora if anterior is not None else None  # type: ignore[union-attr]
            leitura = Padrao(fora=float(s) < self.limiar_padrao, antes=antes, semelhanca=float(s))
        self._padrao[lugar.chave] = _Guardado(ts, leitura)
        return leitura

    # ─────────────────────────── o contexto ───────────────────────────

    def _nivel(self, c: Condicao, lugar: Lugar | None, ts: datetime) -> tuple[bool, str | None]:
        """A condição de contexto vale? E, quando não vale, por quê."""
        if lugar is None:
            # O lugar não existe (mais) neste canal: não segura.
            return True, None
        if c.sinal in ("pessoa", "sem_pessoa"):
            p = self.presenca(lugar, ts)
            if p is None:
                return True, None
            if c.sinal == "pessoa":
                return (True, None) if p.talvez else (False, f"ninguém em {lugar.nome}")
            return (True, None) if not p.certeza else (False, f"há gente em {lugar.nome}")
        if c.sinal in ("movimento", "parado"):
            m = self.movimento(lugar, ts)
            if m is None or m.agora is None:
                return True, None
            if c.sinal == "movimento":
                return (True, None) if m.agora else (False, f"nada se mexeu em {lugar.nome}")
            return (True, None) if not m.agora else (False, f"há movimento em {lugar.nome}")
        if c.sinal in ("fora_do_padrao", "no_padrao"):
            d = self.padrao(lugar, ts)
            if d is None:
                return True, None
            if c.sinal == "fora_do_padrao":
                return (True, None) if d.fora else (False, f"{lugar.nome} está como na foto padrão")
            return (True, None) if not d.fora else (False, f"{lugar.nome} não está como na foto padrão")
        # Sinal que este agente não conhece: não segura.
        return True, None

    # ─────────────────────────── o gatilho ───────────────────────────

    def _acontecimento(self, g: Condicao, lugar: Lugar | None, criterio: str, ts: datetime) -> bool:
        """O gatilho disparou nesta olhada? Na dúvida, disparou."""
        if g.sinal == "toda_olhada":
            return True
        if g.sinal == "a_cada":
            ultimo = self._ultimo_disparo.get(criterio)
            if ultimo is None or not g.minutos or ts < ultimo:
                return True
            return ts - ultimo >= timedelta(minutes=g.minutos)
        if lugar is None:
            return True
        if g.sinal in ("entrou", "saiu"):
            p = self.presenca(lugar, ts)
            if p is None or p.antes is None:
                return True
            return (p.ocupado and not p.antes) if g.sinal == "entrou" else (p.antes and not p.ocupado)
        if g.sinal in ("mexeu", "parou"):
            m = self.movimento(lugar, ts)
            if m is None or m.agora is None:
                return True
            if g.sinal == "mexeu":
                return m.agora
            return True if m.antes is None else (m.antes and not m.agora)
        if g.sinal in ("saiu_do_padrao", "voltou_ao_padrao"):
            d = self.padrao(lugar, ts)
            if d is None or d.antes is None:
                return True
            return (d.fora and not d.antes) if g.sinal == "saiu_do_padrao" else (d.antes and not d.fora)
        return True

    # ─────────────────────────── a conta ───────────────────────────

    def avaliar(
        self,
        estudo: Estudo,
        *,
        criterio: str,
        ts: datetime,
        onde: Callable[[Condicao], Lugar | None],
    ) -> Parecer:
        """O contexto vale? Algum gatilho abriu a análise?

        `criterio` é o critério NAQUELE quadro (a chave de "por lugar" do
        motor): é dele o relógio do "a cada N minutos". `onde` entrega o
        lugar de uma condição — ou `None`, quando ele não existe no canal.
        """
        falta: str | None = None
        qual: str | None = None
        for c in estudo.contexto:
            vale, motivo = self._nivel(c, onde(c), ts)
            if not vale and falta is None:
                falta, qual = motivo, c.sinal

        # Todos os gatilhos são lidos, mesmo depois de um disparar e mesmo
        # com o contexto faltando: a borda da próxima olhada sai desta leitura.
        disparos = [
            self._acontecimento(g, None if g.sinal in GATILHOS_SEM_LUGAR else onde(g), criterio, ts)
            for g in estudo.gatilho
        ]
        disparou = (not estudo.gatilho) or any(disparos)

        if falta is None and disparou:
            # O relógio do "a cada" conta desde a última vez que a análise
            # ABRIU — por qualquer gatilho, e só com o contexto valendo.
            self._ultimo_disparo[criterio] = ts
        return Parecer(falta=falta, sinal_que_falta=qual, disparou=disparou)

    def esquecer(self, criterios: set[str], lugares: set[str]) -> None:
        """Larga a memória do que saiu da configuração."""
        for chave in list(self._ultimo_disparo):
            if chave not in criterios:
                del self._ultimo_disparo[chave]
        for memoria in (self._presenca, self._movimento, self._padrao):
            for chave in list(memoria):
                if chave not in lugares:
                    del memoria[chave]
