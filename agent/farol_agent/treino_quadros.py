"""A gravação de treino vira um quadro por segundo da bancada (A21, fatia T3c-1).

A leitura da bancada da rodada 12 lê um quadro por SEGUNDO do recorte da área
de montagem — o dono, 14/10/2026: "para colocar a carne e um queijo um
colaborador demora 2 a 3 s; com intervalos de 15 s ou mais entre quadros,
nunca vai funcionar". Ao vivo, era a captura densa; aqui, a gravação que a
T3b trouxe do gravador.

Para cada pedaço baixado, em ordem, os quadros com a hora certa
(`gravacao_lida.quadros_com_hora`: o relógio de dentro consertado, a
contagem como reserva), um a cada `a_cada_s` segundos, recortados na área de
montagem (o recorte do agente). A hora da loja é a do gravador menos o
adianto que a busca mediu. Sai no formato que a leitura da bancada lê:
`paradas.csv` (pedaco, indice, no_gravador, na_loja, mexeu_por_s, recorte) e a
pasta `recortes/` — o mesmo da captura densa ao vivo e do leitor do repasse.

**Retoma de onde parou.** O que cada pedaço deu fica anotado em `densa.json`,
trocado de uma vez a cada pedaço, e o `paradas.csv` é refeito dele. O pedaço
que não terminou é lido de novo; o que não abre fica anotado e não se repete.

**Quando parar.** Quem chama diz se pode seguir (`pode_seguir`, antes de cada
pedaço): a leitura pesa no processador do computador da loja, que é também o
servidor local do Regem.

**Dorme:** nada no agente chama este módulo ainda (a T3d liga).
"""

from __future__ import annotations

import csv
import io
import json
import os
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable, Iterable, Iterator

import numpy as np

from farol_agent.gravacao_lida import TAXA_PROVISORIA, guardar_recorte, instante, quadros_com_hora, relogio_de_dentro_vale
from farol_agent.modelos import Zona

FORMATO = 1
DENSA = "densa.json"
PARADAS = "paradas.csv"
RECORTES = "recortes"
# Um quadro por segundo: o que a rodada 12 leu (a carne e o queijo levam 2 a 3 s para entrar).
A_CADA_S = 1.0
CABECALHO = ["pedaco", "indice", "no_gravador", "na_loja", "mexeu_por_s", "recorte"]
NAO_ABRIU = "não abriu"

Leitor = Callable[[Path], Iterable[tuple[int, float, bool, np.ndarray]]]


@dataclass(frozen=True)
class Densa:
    """Como ficou a captura densa da gravação, depois desta vez."""

    pedacos: int
    lidos: int
    quadros: int
    erros: int
    # Nulo = todos os pedaços lidos; "pode_seguir" = quem chama mandou parar.
    parou: str | None = None

    @property
    def completa(self) -> bool:
        return self.parou is None

    @property
    def fracao(self) -> float:
        return self.lidos / self.pedacos if self.pedacos else 1.0


def _texto(t: datetime) -> str:
    return f"{t:%Y-%m-%d %H:%M:%S.%f}"[:-3]


def _ler_anotacoes(arquivo: Path, a_cada_s: float, adianto_s: float) -> dict[str, dict]:
    """O que já foi lido. Anotação de outro formato, de outro passo ou de outro adianto não vale: lê-se tudo de novo."""
    try:
        bruto = json.loads(arquivo.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if (
        not isinstance(bruto, dict)
        or bruto.get("formato") != FORMATO
        or bruto.get("a_cada_s") != a_cada_s
        or bruto.get("adianto_s") != adianto_s
        or not isinstance(bruto.get("pedacos"), dict)
    ):
        return {}
    return {k: v for k, v in bruto["pedacos"].items() if isinstance(v, dict) and isinstance(v.get("linhas"), list)}


def _trocar(arquivo: Path, texto: str) -> None:
    """Escreve de uma vez: quem cai no meio não deixa o arquivo pela metade."""
    temporario = arquivo.with_name(arquivo.name + ".novo")
    temporario.write_text(texto, encoding="utf-8", newline="")
    os.replace(temporario, arquivo)


def _gravar(saida: Path, anotados: dict[str, dict], a_cada_s: float, adianto_s: float) -> None:
    _trocar(saida / DENSA, json.dumps({"formato": FORMATO, "a_cada_s": a_cada_s, "adianto_s": adianto_s, "pedacos": anotados}, ensure_ascii=False))
    linhas = sorted((linha for a in anotados.values() for linha in a["linhas"]), key=lambda l: l[2])
    buffer = io.StringIO()
    w = csv.writer(buffer, lineterminator="\n")
    w.writerow(CABECALHO)
    w.writerows(linhas)
    _trocar(saida / PARADAS, buffer.getvalue())


def _ler_pedaco(
    arquivo: Path, de: datetime, ate: datetime, zona: Zona, recortes: Path, *, a_cada_s: float, adianto_s: float, ler: Leitor
) -> dict:
    """Um pedaço: os recortes, um a cada `a_cada_s` s, e as linhas do `paradas.csv`, com a hora certa."""
    duracao_s = max(0.001, (ate - de).total_seconds())
    amostras: list[tuple[int, float, str]] = []
    proxima = 0.0
    total = 0
    fim_de_dentro = 0.0
    for indice, segundos, do_relogio, imagem in ler(arquivo):
        total = indice + 1
        if do_relogio:
            fim_de_dentro = max(fim_de_dentro, segundos)
        if segundos < proxima:
            continue
        # Depois de um salto do relógio (quadros que o gravador não guardou), a próxima amostra é um passo depois
        # desta — e não uma atrás da outra, quadro a quadro, até alcançar a grade (como no leitor do repasse).
        proxima = proxima + a_cada_s if segundos < proxima + a_cada_s else segundos + a_cada_s
        nome = f"{de:%Y-%m-%d_%H-%M-%S}_q{indice:05d}.jpg"
        guardar_recorte(imagem, zona, recortes / nome)
        amostras.append((indice, segundos, nome))
    if total == 0:
        return {"linhas": [], "quadros": 0, "hora_pela": "", "erro": NAO_ABRIU}
    pelo_de_dentro = fim_de_dentro > 0.0 and relogio_de_dentro_vale(fim_de_dentro, duracao_s)
    linhas = []
    for indice, segundos, nome in amostras:
        no_gravador = de + timedelta(seconds=segundos) if pelo_de_dentro else instante(de, indice, total, duracao_s)
        linhas.append([arquivo.name, indice, _texto(no_gravador), _texto(no_gravador - timedelta(seconds=adianto_s)), 0, nome])
    return {"linhas": linhas, "quadros": total, "hora_pela": "relógio de dentro" if pelo_de_dentro else "contagem", "erro": ""}


def densa_da_gravacao(
    pedacos: list[tuple[Path, datetime, datetime]],
    zona: Zona,
    saida: Path,
    *,
    adianto_s: float,
    a_cada_s: float = A_CADA_S,
    pode_seguir: Callable[[], bool] = lambda: True,
    ao_andar: Callable[[Densa], None] | None = None,
    ler: Leitor | None = None,
) -> Densa:
    """Lê os pedaços (`treino_trecho.pedacos_baixados`) e escreve a captura densa em `saida`.

    `adianto_s`: quanto o relógio do gravador está adiantado em relação ao do computador (o que a busca mediu).
    """
    saida = Path(saida)
    recortes = saida / RECORTES
    recortes.mkdir(parents=True, exist_ok=True)
    ler = ler or (lambda arquivo: quadros_com_hora(arquivo, taxa_provisoria=TAXA_PROVISORIA))
    anotados = _ler_anotacoes(saida / DENSA, a_cada_s, adianto_s)
    nomes = [arquivo.name for arquivo, _, _ in pedacos]

    def contar(parou: str | None = None) -> Densa:
        feitos = [anotados[n] for n in nomes if n in anotados]
        return Densa(
            pedacos=len(nomes), lidos=len(feitos), quadros=sum(len(a["linhas"]) for a in feitos),
            erros=sum(1 for a in feitos if a.get("erro")), parou=parou,
        )

    for arquivo, de, ate in pedacos:
        if arquivo.name in anotados:
            continue
        if not pode_seguir():
            return contar("pode_seguir")
        anotados[arquivo.name] = _ler_pedaco(arquivo, de, ate, zona, recortes, a_cada_s=a_cada_s, adianto_s=adianto_s, ler=ler)
        _gravar(saida, anotados, a_cada_s, adianto_s)
        if ao_andar is not None:
            ao_andar(contar())
    if not (saida / PARADAS).exists():
        _gravar(saida, anotados, a_cada_s, adianto_s)
    return contar()


def linhas_da_densa(saida: Path) -> Iterator[dict]:
    """As linhas do `paradas.csv`, como a leitura da bancada as lê."""
    with (Path(saida) / PARADAS).open(encoding="utf-8", newline="") as f:
        yield from csv.DictReader(f)
