"""A gravação de treino, do lado da loja: o que ler, o andamento e o que apagar (A21, fatia T3a).

Quem cria a gravação de treino é o console (quem configura a loja): do que o
gravador já guardou, ou programada para um horário. A loja:

1. pergunta à nuvem o que tem de ler (`GET /v1/agentes/treino/gravacoes`):
   as gravações ativas e as que ela já pode apagar do disco;
2. escolhe a próxima: a que já estava lendo (volta de onde parou) e, depois,
   a mais antiga cujo horário já acabou — com a folga que o gravador leva
   para a gravação assentar (o perfil do gravador diz a dele; medido em
   10/10/2026: até ~2 min 15 s na loja de teste);
3. conta o andamento (`POST /v1/agentes/treino/gravacoes/:id/andamento`):
   lendo, com a porcentagem; pronta; ou falhou, com o motivo que a tela
   mostra;
4. apaga do disco o que a nuvem diz que já pode sair.

**Cada recusa tem destino** (o contrato é `contratos/gravacao-de-treino.json`):

    401/403  o token não vale → parar e avisar; nada sai do disco
    404   a gravação não é desta loja, ou não existe mais → esquecer
    409   alguém cancelou no console, ou ela já foi encerrada → parar de
          ler e apagar o que se guardou dela
    422   o corpo estava errado → não repetir: é erro de quem mandou
    rede, 5xx, 429 → de passagem: nada sai do disco, e o andamento é
          contado de novo na volta seguinte

Buscar o trecho no gravador e ler a bancada são as fatias seguintes (T3b e
T3c). **Tudo isto dorme:** o agente ainda não declara "treino" à nuvem, e
nada no agente chama este módulo.
"""

from __future__ import annotations

import logging
import re
import shutil
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Callable

from farol_agent.nuvem import ErroDaNuvem

_log = logging.getLogger(__name__)

# As situações que a nuvem lista para a loja ler (as ATIVAS da API).
ATIVAS = ("programada", "fila", "lendo")
# O que a loja conta (os ANDAMENTOS da API).
LENDO, PRONTA, FALHOU = "lendo", "pronta", "falhou"
# O motivo de "falhou" cabe em 200 caracteres na nuvem.
MAX_MOTIVO = 200
# A porcentagem só sobe à nuvem quando anda pelo menos isto (e sempre na primeira vez).
PASSO_DO_PROGRESSO = 5
# Se o perfil do gravador não disser, a folga para a gravação assentar: "uns 3 minutos" (onda 2, medido em 10/10).
FOLGA_PADRAO_S = 180.0

# A chave vira nome de pasta no computador da loja: só o que é seguro como nome (nada de barra, nem "..").
_CHAVE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")

# O que a loja faz depois de contar o andamento.
SEGUIR = "seguir"  # a nuvem anotou
PARAR = "parar"  # 409: pare de ler e apague o que guardou desta gravação
ESQUECER = "esquecer"  # 404: a gravação não é desta loja (ou não existe mais)
CREDENCIAL = "credencial"  # 401/403: o token não vale — pare e avise; nada sai do disco
RECUSADO = "recusado"  # 422 e outros 4xx: não repita
DEPOIS = "depois"  # rede, 5xx, 429: conte de novo na volta seguinte


@dataclass(frozen=True)
class Gravacao:
    """Uma gravação de treino que a loja tem de ler."""

    id: str
    chave: str
    ponto_id: str | None
    canal: int | None
    inicio: datetime
    fim: datetime
    origem: str
    situacao: str


def chave_valida(chave: Any) -> bool:
    return isinstance(chave, str) and bool(_CHAVE.match(chave))


def _data(valor: Any) -> datetime | None:
    if not isinstance(valor, str):
        return None
    try:
        d = datetime.fromisoformat(valor)
    except ValueError:
        return None
    # Sem fuso não se sabe que horário é: a nuvem sempre manda com.
    return d if d.tzinfo is not None else None


def ler_lista(corpo: Any) -> tuple[list[Gravacao], list[str]]:
    """A resposta de `GET /v1/agentes/treino/gravacoes`, conferida.

    Tolerante: a gravação fora do formato fica de fora (e é contada no
    registro), e a lista do que apagar só leva chave que serve de nome de
    pasta. Resposta sem as duas listas não é resposta: lista vazia.
    """
    if not isinstance(corpo, dict):
        return [], []
    gravacoes: list[Gravacao] = []
    fora = 0
    for g in corpo.get("gravacoes") or []:
        if not isinstance(g, dict):
            fora += 1
            continue
        inicio, fim = _data(g.get("inicio")), _data(g.get("fim"))
        canal = g.get("canal")
        ok = (
            isinstance(g.get("id"), str)
            and g["id"]
            and chave_valida(g.get("chave"))
            and inicio is not None
            and fim is not None
            and fim > inicio
            and g.get("situacao") in ATIVAS
            and (canal is None or (isinstance(canal, int) and not isinstance(canal, bool)))
        )
        if not ok:
            fora += 1
            continue
        ponto = g.get("pontoId")
        gravacoes.append(
            Gravacao(
                id=g["id"],
                chave=g["chave"],
                ponto_id=ponto if isinstance(ponto, str) and ponto else None,
                canal=canal,
                inicio=inicio,  # type: ignore[arg-type]
                fim=fim,  # type: ignore[arg-type]
                origem=g.get("origem") if isinstance(g.get("origem"), str) else "",
                situacao=g["situacao"],
            )
        )
    if fora:
        _log.warning("treino: %d gravação(ões) da lista fora do formato ficaram de fora", fora)
    apagar = [c for c in (corpo.get("apagar") or []) if chave_valida(c)]
    return gravacoes, apagar


def proxima(gravacoes: list[Gravacao], agora: datetime, folga_s: float = FOLGA_PADRAO_S) -> Gravacao | None:
    """A próxima a ler: a que já estava lendo; senão, a mais antiga cujo horário já acabou e assentou.

    A programada ainda por acontecer (ou que acabou há menos que a folga)
    espera: o gravador ainda não tem o trecho inteiro.
    """
    lendo = sorted((g for g in gravacoes if g.situacao == LENDO), key=lambda g: g.inicio)
    if lendo:
        return lendo[0]
    prontas = [g for g in gravacoes if g.situacao in ("fila", "programada") and g.fim + timedelta(seconds=folga_s) <= agora]
    return min(prontas, key=lambda g: g.inicio) if prontas else None


def _destino(e: ErroDaNuvem) -> str:
    if e.status == 409:
        return PARAR
    if e.status == 404:
        return ESQUECER
    if e.status in (401, 403):
        return CREDENCIAL
    if e.status == 429 or e.status >= 500 or e.status == 0:
        return DEPOIS
    return RECUSADO


class Andamento:
    """Conta à nuvem o andamento de UMA gravação — e diz o que a loja faz depois.

    `contar` é quem leva o corpo à nuvem (`ClienteNuvem.andamento_da_gravacao`).
    A porcentagem só sobe quando anda pelo menos `PASSO_DO_PROGRESSO` (e na
    primeira vez); "lendo" nunca diz 100 — quem diz é "pronta".
    """

    def __init__(self, gravacao: Gravacao, contar: Callable[[str, dict[str, Any]], Any]):
        self.gravacao = gravacao
        self._contar = contar
        self._ultimo: int | None = None

    def lendo(self, progresso: float) -> str:
        p = max(0, min(99, int(progresso)))
        if self._ultimo is not None and p < self._ultimo + PASSO_DO_PROGRESSO:
            return SEGUIR
        destino = self._mandar({"situacao": LENDO, "progresso": p})
        if destino == SEGUIR:
            self._ultimo = p
        return destino

    def pronta(self) -> str:
        return self._mandar({"situacao": PRONTA})

    def falhou(self, motivo: str) -> str:
        texto = " ".join((motivo or "").split())[:MAX_MOTIVO] or "a leitura falhou sem dizer por quê"
        return self._mandar({"situacao": FALHOU, "motivo": texto})

    def _mandar(self, corpo: dict[str, Any]) -> str:
        try:
            self._contar(self.gravacao.id, corpo)
        except ErroDaNuvem as e:
            destino = _destino(e)
            nivel = {PARAR: logging.INFO, DEPOIS: logging.INFO, CREDENCIAL: logging.ERROR}.get(destino, logging.WARNING)
            _log.log(nivel, "treino: andamento %s da gravação %s não entrou (%s): %s", corpo["situacao"], self.gravacao.chave, destino, e)
            return destino
        return SEGUIR


def pasta_da_gravacao(raiz: Path, chave: str) -> Path | None:
    """Onde a loja guarda o que leu de uma gravação. Nulo para chave que não serve de nome de pasta.

    O caminho é resolvido: um atalho com o nome da chave que aponte para fora da raiz não é seguido.
    """
    if not chave_valida(chave):
        return None
    raiz = Path(raiz).resolve()
    pasta = (raiz / chave).resolve()
    return pasta if pasta.parent == raiz else None


def apagar_do_disco(raiz: Path, chaves: list[str]) -> list[str]:
    """Apaga as pastas das gravações que já podem sair. Devolve as chaves que saíram.

    Só dentro da raiz, e só pasta com nome de chave. Apagar o que não existe
    não é erro; o que não sai (arquivo preso) fica para a volta seguinte.
    """
    saiu: list[str] = []
    for chave in chaves:
        pasta = pasta_da_gravacao(raiz, chave)
        if pasta is None or not pasta.is_dir():
            continue
        try:
            shutil.rmtree(pasta)
        except OSError as e:
            _log.warning("treino: a pasta da gravação %s não saiu agora (%s); tento na volta seguinte", chave, type(e).__name__)
            continue
        saiu.append(chave)
    if saiu:
        _log.info("treino: %d gravação(ões) apagada(s) do disco, como a nuvem mandou", len(saiu))
    return saiu


def perguntar(buscar: Callable[[], Any]) -> tuple[list[Gravacao], list[str]] | None:
    """Pergunta à nuvem o que ler. Nulo quando não deu para perguntar agora (e nada muda no disco)."""
    try:
        corpo = buscar()
    except ErroDaNuvem as e:
        _log.info("treino: a lista das gravações não veio agora: %s", e)
        return None
    return ler_lista(corpo)
