"""Medir o que ESTE gravador entrega pelo caminho de arquivo, e guardar na máquina.

O motor não traz número de aparelho nenhum (`dvr.arquivo`): o tamanho do
bloco, onde os blocos começam e quantos quadros por segundo são **medidos
aqui**, com o gravador da loja, e guardados num arquivo ao lado da
configuração.

## O que se sabe de como um gravador entrega (medido na loja de teste, 10/10/2026)

- A gravação que já **assentou** vem em blocos inteiros: o gravador devolve
  os blocos que COMEÇAM dentro do pedido. Pedir 1 s a partir do começo de um
  bloco devolve o bloco todo; pedir o segundo seguinte não devolve nada.
- A gravação **recente** vem cortada por tamanho, sem lugar certo, e muitas
  vezes o leitor nem abre. Em três blocos acompanhados, o bloco só passou a
  vir inteiro entre 1 min e 20 s e 2 min e 15 s depois de gravado.

## Como se mede (uns seis pedidos, um de cada vez)

A medida usa gravação de **dez minutos atrás**, que já assentou:

1. **O relógio.** Tudo o que se pede é dito na hora do gravador.
2. **Os começos de bloco.** Pede-se 1 s, segundo a segundo, a partir do
   começo de um minuto. O segundo que devolve gravação é começo de bloco;
   o que não devolve, não é. Com três começos sabe-se o tamanho do bloco (a
   distância entre eles), onde os blocos começam e quantos quadros tem um
   bloco — daí a taxa.
3. **A conferência.** Um pedido só para dois blocos seguidos tem de devolver
   os dois. Se não devolver, este gravador entrega de outro jeito — e o
   perfil sai **sem bloco**: o agente pede como veio e confere o que voltou,
   em vez de confiar numa conta que não é a deste aparelho.

## O que NÃO se mede aqui

**Em quanto tempo a gravação assenta.** Varia de bloco para bloco (não é um
número: depende de quando o gravador fecha o pedaço em que o bloco está), e
medir o pior caso ocuparia o gravador por minutos. O perfil sai com o atraso
de cautela do `dvr.arquivo`, e quem pede um trecho confere, pelos quadros, se
ele veio inteiro (`bloco.Escolha.inteiro`) — e espera, se não veio.

Pedido recusado não se repete (é do `dvr.arquivo`): credencial recusada no
meio da medida acaba a medida. E a medida não roda sozinha: quem a chama
decide quando.
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable

from farol_agent.dvr.arquivo import ClienteDeArquivo, PerfilDeArquivo, SemGravacao, inicio_do_bloco
from farol_agent.dvr.dahua import ErroDoGravador
from farol_agent.sequencia import bloco

_log = logging.getLogger(__name__)

NOME_PADRAO = "gravadores.json"

# A idade da gravação usada na medida: já assentada no gravador (a recente vem cortada).
IDADE_DA_MEDIDA = timedelta(minutes=10)
# Até quantos segundos seguidos se sonda atrás dos começos de bloco.
JANELA_DA_SONDA = 24
# Sem começo de bloco nenhum nestes primeiros segundos, o canal não tem gravação ali: a sonda para.
SONDA_SEM_NADA = 12
# Quantos começos de bloco bastam: dois espaços iguais.
COMECOS_QUE_BASTAM = 3


class MedidaIncompleta(ErroDoGravador):
    """O gravador respondeu, mas não deu para tirar o perfil dele."""


@dataclass(frozen=True)
class Medida:
    """O perfil medido de um gravador, e como a medida foi."""

    perfil: PerfilDeArquivo
    medido_em: datetime
    canal: int
    # Quantos pedidos de trecho a medida fez.
    pedidos: int
    # Quanto o relógio do gravador estava adiantado, em segundos.
    relogio_s: float
    # O que a medida achou de diferente do esperado, em palavras.
    notas: tuple[str, ...] = ()
    # O que a sonda viu: (segundo a partir do começo do minuto, quadros que voltaram).
    leituras: tuple[tuple[int, int], ...] = ()


def arquivo_ao_lado(caminho_config: str | Path) -> Path:
    """O arquivo dos gravadores mora junto da configuração, como a identidade da máquina."""
    return Path(caminho_config).parent / NOME_PADRAO


def _chave(host: str, porta: int) -> str:
    return f"{host}:{porta}"


def _apagar(arquivo: Path) -> None:
    # No Windows o leitor de vídeo pode segurar o arquivo por um instante depois de fechar.
    for _ in range(10):
        try:
            arquivo.unlink(missing_ok=True)
            return
        except OSError:
            time.sleep(0.05)


def medir(
    cliente: ClienteDeArquivo,
    canal: int,
    pasta: Path,
    *,
    contar: Callable[[Path], int] = bloco.contar_quadros,
    agora: Callable[[], datetime] = datetime.now,
) -> Medida:
    """Mede o perfil de arquivo do gravador de `cliente`, pelo canal dado.

    `cliente` tem de pedir **como veio**: um `ClienteDeArquivo` sem bloco no
    perfil. Os trechos da medida passam por `pasta` e são apagados.
    """
    if cliente.perfil.bloco_s is not None:
        raise ValueError("a medida pede um cliente sem bloco no perfil: os pedidos têm de sair como vieram")
    arquivo = Path(pasta) / "medida-do-gravador.dav"
    notas: list[str] = []
    pedidos = 0

    def quadros_de(de: datetime, ate: datetime) -> int:
        """Quantos quadros o gravador devolve para o pedido de `de` a `ate`. Zero = não devolveu gravação."""
        nonlocal pedidos
        pedidos += 1
        try:
            cliente.baixar(canal, de, ate, arquivo)
        except SemGravacao:
            return 0
        try:
            return contar(arquivo)
        finally:
            _apagar(arquivo)

    # 1. O relógio: medido agora, não o guardado.
    diferenca = cliente.relogio(idade_maxima_s=0)

    # 2. Os começos de bloco, na gravação de dez minutos atrás, a partir do começo de um minuto.
    base = inicio_do_bloco(agora() + diferenca - IDADE_DA_MEDIDA, 60)
    leituras: list[tuple[int, int]] = []
    for segundo in range(JANELA_DA_SONDA):
        de = base + timedelta(seconds=segundo)
        leituras.append((segundo, quadros_de(de, de + timedelta(seconds=1))))
        comecos = [s for s, quadros in leituras if quadros > 0]
        if len(comecos) == COMECOS_QUE_BASTAM or (not comecos and segundo + 1 == SONDA_SEM_NADA):
            break
    if not comecos:
        raise MedidaIncompleta(
            f"o gravador não devolveu gravação do canal {canal} a partir de {base:%H:%M:%S} (na hora dele)",
            dica="este canal está gravando? o disco do gravador guarda este horário?",
        )

    bloco_s: int | None = None
    desvio_s = 0
    qps: float | None = None
    por_bloco = [quadros for _, quadros in leituras if quadros > 0]
    espacos = {depois - antes for antes, depois in zip(comecos, comecos[1:])}
    if len(comecos) < COMECOS_QUE_BASTAM:
        notas.append(f"em {JANELA_DA_SONDA} s de gravação achei só {len(comecos)} começo(s) de bloco")
    elif len(espacos) != 1:
        notas.append("os blocos não têm tamanho fixo: começam nos segundos " + ", ".join(str(s) for s in comecos))
    elif max(por_bloco) - min(por_bloco) > 1:
        notas.append("os blocos vieram com " + ", ".join(str(q) for q in por_bloco) + " quadros: a gravação pode ter vindo cortada")
    else:
        bloco_s = espacos.pop()
        primeiro = base + timedelta(seconds=comecos[0])
        desvio_s = (primeiro.hour * 3600 + primeiro.minute * 60 + primeiro.second) % bloco_s
        qps = round(max(por_bloco) / bloco_s, 2)

    # 3. A conferência: um pedido só para dois blocos seguidos devolve os dois.
    if bloco_s is not None:
        primeiro = base + timedelta(seconds=comecos[0])
        dois = quadros_de(primeiro, primeiro + timedelta(seconds=bloco_s + 1))
        if abs(dois - 2 * max(por_bloco)) > 1:
            notas.append(
                f"um pedido para dois blocos seguidos devolveu {dois} quadros, e não {2 * max(por_bloco)}: "
                "este gravador não entrega os blocos que começam dentro do pedido",
            )
            bloco_s, desvio_s, qps = None, 0, None

    perfil = PerfilDeArquivo(bloco_s=bloco_s, porta=cliente.perfil.porta, desvio_s=desvio_s, qps=qps)
    return Medida(
        perfil=perfil, medido_em=agora().replace(microsecond=0), canal=canal, pedidos=pedidos,
        relogio_s=round(diferenca.total_seconds(), 1), notas=tuple(notas), leituras=tuple(leituras),
    )


# ───────────────────────── guardar e ler ─────────────────────────


def guardar(caminho: str | Path, host: str, medida: Medida) -> None:
    """Guarda (ou troca) o perfil medido deste gravador, sem mexer nos dos outros."""
    p = Path(caminho)
    todos = _ler_tudo(p)
    todos[_chave(host, medida.perfil.porta)] = {
        "bloco_s": medida.perfil.bloco_s,
        "desvio_s": medida.perfil.desvio_s,
        "qps": medida.perfil.qps,
        "atraso_s": medida.perfil.atraso_s,
        "medido_em": medida.medido_em.isoformat(timespec="seconds"),
        "canal": medida.canal,
        "pedidos": medida.pedidos,
        "relogio_s": medida.relogio_s,
        "notas": list(medida.notas),
        "leituras": [list(par) for par in medida.leituras],
    }
    p.parent.mkdir(parents=True, exist_ok=True)
    temporario = p.with_suffix(p.suffix + ".tmp")
    temporario.write_text(json.dumps(todos, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporario, p)


def ler(caminho: str | Path, host: str, porta: int = 80) -> PerfilDeArquivo | None:
    """O perfil guardado deste gravador, ou `None` se ele ainda não foi medido (ou o arquivo não se lê)."""
    dados = _ler_tudo(Path(caminho)).get(_chave(host, porta))
    if not isinstance(dados, dict):
        return None
    try:
        bloco_s = dados.get("bloco_s")
        qps = dados.get("qps")
        perfil = PerfilDeArquivo(
            bloco_s=None if bloco_s is None else int(bloco_s),
            atraso_s=float(dados["atraso_s"]),
            porta=porta,
            desvio_s=int(dados.get("desvio_s") or 0),
            qps=None if qps is None else float(qps),
        )
    except (KeyError, TypeError, ValueError):
        _log.warning("o perfil guardado do gravador %s não se lê: será medido de novo", host)
        return None
    # Perfil impossível não é usado: vale mais não saber do que pedir com conta errada.
    # (O desvio cabe dentro do bloco — o que também recusa bloco de zero ou negativo.)
    impossivel = (
        perfil.atraso_s < 0
        or (perfil.qps is not None and perfil.qps <= 0)
        or (perfil.bloco_s is not None and not 0 <= perfil.desvio_s < perfil.bloco_s)
    )
    if impossivel:
        _log.warning("o perfil guardado do gravador %s tem número impossível: será medido de novo", host)
        return None
    return perfil


def quando_foi_medido(caminho: str | Path, host: str, porta: int = 80) -> datetime | None:
    """Quando o perfil deste gravador foi medido, para quem decide se está na hora de medir de novo."""
    dados = _ler_tudo(Path(caminho)).get(_chave(host, porta))
    try:
        return datetime.fromisoformat(dados["medido_em"]) if isinstance(dados, dict) else None
    except (KeyError, TypeError, ValueError):
        return None


def _ler_tudo(p: Path) -> dict:
    if not p.is_file():
        return {}
    try:
        dados = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        _log.warning("o arquivo dos gravadores (%s) não se lê (%s): começo outro", p.name, type(e).__name__)
        return {}
    return dados if isinstance(dados, dict) else {}
