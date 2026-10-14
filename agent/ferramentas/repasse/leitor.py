"""O leitor do expediente guardado (R1 do repasse).

Lê a gravação de um canal, pedaço por pedaço, dá a cada quadro a HORA certa e passa os quadros pela MESMA
quietude do agente — a que, ao vivo, diz quando o quadro de bancada parou de mexer (as mãos saíram). Cada parada
vira uma linha no resultado e um recorte do quadro, no tamanho da câmera, para o que vem depois (R2).

**A hora.** A hora de cada quadro é o NOME do arquivo (o começo do pedaço, no relógio do gravador) mais o
RELÓGIO DE DENTRO da gravação, consertado: ele recua às vezes (um terço de segundo, visto em 13/10/2026), e o
recuo é ignorado guardando o maior valor já visto. A contagem dos quadros (`começo + i × 300 s / N`) fica como
conferência e como reserva: ela supõe a taxa de quadros constante dentro do pedaço, e a taxa muda — medido em
14/10/2026, em dois pedaços seguidos da bancada: 13,7 e 11,9 quadros por segundo, e a contagem chegou a errar
29,6 s contra o relógio de dentro, que não recuou nenhuma vez e terminou em 300,2 s. Se o relógio de dentro não
andar, ou terminar longe do tamanho do pedaço, a hora sai da contagem, e o resumo diz qual valeu. A hora "na loja"
desconta o adianto do gravador (21 s em 13/10/2026).

**As mesmas medidas.** A quietude, o recorte do quadro e a cor de fora são as do agente, importadas — não
copiadas. O quadro é reduzido ao tamanho do fluxo menor (704×480) antes da medida, como ao vivo, e amostrado de
meio em meio segundo do relógio da gravação, como ao vivo.

**À parte.** Roda no computador da loja (a gravação não sai de lá), com o Python do agente, e escreve numa pasta
própria. Não fala com o gravador, não mexe na configuração, não muda o agente.

    cd /d C:\\Farol\\agent && .venv\\Scripts\\python.exe -X utf8 <este arquivo>
        <pasta do expediente> <canal> <pasta de saída> [--de HH:MM] [--ate HH:MM] [--adianto-do-gravador 21]
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

try:
    import farol_agent  # noqa: F401
except ImportError:  # na loja, rodando como arquivo solto
    sys.path.insert(0, r"C:\Farol\agent")

import cv2
import numpy as np

from farol_agent.configuracao import de_json
from farol_agent.modelos import Frame, Zona
from farol_agent.pipeline import recorte
from farol_agent.quietude import PASSO, Quietude

# Um pedaço da cópia: 5 minutos, pedidos ao gravador por horário.
DURACAO_DO_PEDACO_S = 300.0
# O tamanho do fluxo menor, em que a quietude mede ao vivo.
LADO_DO_FLUXO_MENOR = (704, 480)
# A taxa medida da gravação (3.851 quadros em 298,6 s, 13/10/2026): o relógio da leitura quando o de dentro não anda.
TAXA_PROVISORIA = 12.9
# O adianto do relógio do gravador sobre o do computador da loja, medido em 13/10/2026.
ADIANTO_DO_GRAVADOR_S = 21.0
# O relógio de dentro só vale se terminar a até 10% do tamanho do pedaço (o medido: 300,2 s num pedaço de 300).
FOLGA_DO_RELOGIO_DE_DENTRO = 0.1

_NOME_DO_PEDACO = re.compile(r"^(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})\.dav$")


@dataclass(frozen=True)
class Pedaco:
    arquivo: Path
    comeco: datetime  # no relógio do gravador


@dataclass
class Parada:
    """O quadro parou de mexer: o instante em que a quietude disse "quieto" depois de ter visto mexer."""

    pedaco: str
    indice: int  # o quadro da gravação, contado do começo do pedaço
    segundos: float = 0.0  # do começo do pedaço, pelo relógio da leitura
    no_gravador: datetime | None = None
    na_loja: datetime | None = None
    mexeu_por_s: float = 0.0  # quanto tempo mexeu antes de parar (do primeiro "mexeu" à parada)
    recorte: str = ""


@dataclass
class DoPedaco:
    pedaco: str
    quadros: int = 0
    amostras: int = 0
    mexendo: int = 0
    paradas: int = 0
    taxa: float = 0.0
    erro: str = ""
    segundos_de_leitura: float = 0.0
    primeiro: datetime | None = None
    ultimo: datetime | None = None
    # A hora pela contagem contra o relógio de dentro da gravação, nas amostras (`comparar_relogios`).
    relogios: dict = field(default_factory=dict)
    # De onde saiu a hora das paradas: "relógio de dentro" ou, se ele estava estragado, "contagem".
    hora_pela: str = ""


def comparar_relogios(amostras: list[tuple[int, float]], total: int, duracao_s: float = DURACAO_DO_PEDACO_S) -> dict:
    """A hora pela contagem dos quadros contra a do relógio de dentro da gravação, nas amostras de um pedaço.

    O relógio de dentro recua às vezes (um terço de segundo, medido em 13/10/2026): ele é "consertado" guardando o
    maior valor já visto. O que sai: quantas vezes recuou, o maior desvio entre os dois relógios e onde o de
    dentro termina. Desvio grande quer dizer que a taxa de quadros mudou DENTRO do pedaço, e a hora pela contagem
    erra ali.
    """
    recuos = 0
    anterior: float | None = None
    consertado = 0.0
    maior = 0.0
    for indice, ms in amostras:
        if anterior is not None and ms < anterior:
            recuos += 1
        anterior = ms
        consertado = max(consertado, ms)
        maior = max(maior, abs(indice * duracao_s / total - consertado / 1000.0))
    return {"recuos": recuos, "desvioMaxS": round(maior, 3), "fimPeloDeDentroS": round(consertado / 1000.0, 3)}


def pedacos(pasta: Path, canal: int) -> list[Pedaco]:
    """Os pedaços INTEIROS do canal, na ordem — sem as amostras de 20 s e sem o que não é gravação."""
    saida = []
    for arquivo in (pasta / f"canal-{canal:02d}").glob("*.dav"):
        achou = _NOME_DO_PEDACO.match(arquivo.name)
        if achou:
            saida.append(Pedaco(arquivo, datetime.strptime(achou.group(1), "%Y-%m-%d_%H-%M-%S")))
    return sorted(saida, key=lambda p: p.comeco)


def instante(comeco: datetime, indice: int, total: int, duracao_s: float = DURACAO_DO_PEDACO_S) -> datetime:
    """A hora do quadro `indice` de `total`, num pedaço de `duracao_s` que começa em `comeco`."""
    if total <= 0:
        raise ValueError("pedaço sem quadro")
    return comeco + timedelta(seconds=indice * duracao_s / total)


def quadro_do_canal(config_json: dict, canal: int, numero: int | None = None) -> tuple[str, Zona]:
    """O ponto do canal e o quadro a medir: o de papel "montagem", senão o de `numero`, senão o primeiro."""
    config = de_json(config_json)
    ponto = next((p for p in config.pontos if p.canal == canal), None)
    if ponto is None:
        raise ValueError(f"o canal {canal} não está na configuração")
    quadros = sorted((z for z in ponto.zonas if z.numero is not None), key=lambda z: z.numero)
    if not quadros:
        raise ValueError(f"o canal {canal} não tem quadro desenhado")
    if numero is not None:
        escolhido = next((z for z in quadros if z.numero == numero), None)
        if escolhido is None:
            raise ValueError(f"o canal {canal} não tem o quadro {numero}")
        return str(ponto.id), escolhido
    return str(ponto.id), next((z for z in quadros if z.papel == "montagem"), quadros[0])


class _FonteDaGravacao:
    """Faz as vezes da fonte ao vivo para a quietude: o "fluxo menor" é o quadro da gravação, reduzido."""

    def __init__(self) -> None:
        self.atual: Frame | None = None

    def quadro_do_fluxo_menor(self) -> Frame | None:
        return self.atual


def guardar_recorte(imagem: np.ndarray, zona: Zona, destino: Path) -> None:
    """O quadro no tamanho da câmera, com o que é de fora do desenho apagado — o recorte do agente."""
    f, dentro = recorte.recortar_area(Frame(imagem, datetime.min, ""), zona)
    f = recorte.apagar_fora(f, dentro)
    ok, bytes_ = cv2.imencode(".jpg", f.imagem, [cv2.IMWRITE_JPEG_QUALITY, 90])
    if not ok:
        raise ValueError("não consegui gravar o recorte")
    destino.parent.mkdir(parents=True, exist_ok=True)
    # Pelos bytes, e não pelo caminho: com acento na pasta o OpenCV não grava (ERR-111).
    bytes_.tofile(str(destino))


@dataclass
class _Memoria:
    """O que atravessa de um pedaço para o seguinte: a bancada já mexeu, e desde quando."""

    visto_mexer: bool = False
    mexeu_desde: datetime | None = None


def ler_pedaco(
    pedaco: Pedaco,
    ponto_id: str,
    zona: Zona,
    quietude: Quietude,
    relogio: dict,
    pasta_dos_recortes: Path | None,
    memoria: _Memoria | None = None,
    *,
    duracao_s: float = DURACAO_DO_PEDACO_S,
    taxa_provisoria: float = TAXA_PROVISORIA,
    adianto_s: float = ADIANTO_DO_GRAVADOR_S,
) -> tuple[DoPedaco, list[Parada]]:
    """Lê um pedaço inteiro, passa as amostras pela quietude e devolve o que mediu e as paradas, com a hora certa.

    A leitura anda no relógio de dentro da gravação, consertado (nunca recua; a origem é o primeiro quadro). Se
    ele não anda (parado no zero), anda na contagem. No fim, se o relógio de dentro não terminar perto do tamanho
    do pedaço, ele é dado como estragado e a hora das paradas sai da contagem.
    """
    do_pedaco = DoPedaco(pedaco=pedaco.arquivo.name)
    paradas: list[Parada] = []
    memoria = memoria if memoria is not None else _Memoria()
    fonte = _FonteDaGravacao()
    cap = cv2.VideoCapture(str(pedaco.arquivo), cv2.CAP_FFMPEG)
    t0 = time.perf_counter()
    de_dentro_s = 0.0  # o relógio de dentro, consertado: nunca recua
    try:
        if not cap.isOpened():
            do_pedaco.erro = "não abriu"
            return do_pedaco, paradas
        indice = -1
        proxima = 0.0  # a próxima amostra, em segundos do pedaço
        origem: float | None = None
        de_dentro: list[tuple[int, float]] = []
        while True:
            ok, imagem = cap.read()
            if not ok or imagem is None:
                break
            indice += 1
            ms = float(cap.get(cv2.CAP_PROP_POS_MSEC))
            if origem is None:
                origem = ms
            de_dentro_s = max(de_dentro_s, (ms - origem) / 1000.0)
            # O relógio de dentro, e — se ele não anda — a contagem.
            segundos = de_dentro_s if de_dentro_s > 0.0 else indice / taxa_provisoria
            if segundos < proxima:
                continue
            # Depois de um salto do relógio (quadros que o gravador não guardou), a próxima amostra é meio segundo
            # depois desta — e não uma atrás da outra, quadro a quadro, até alcançar a grade.
            proxima = proxima + PASSO if segundos < proxima + PASSO else segundos + PASSO
            de_dentro.append((indice, ms - origem))
            agora = pedaco.comeco + timedelta(seconds=segundos)
            relogio["agora"] = agora
            pequena = cv2.resize(imagem, LADO_DO_FLUXO_MENOR, interpolation=cv2.INTER_AREA)
            fonte.atual = Frame(pequena, agora, ponto_id, stream="sub")
            quietude.amostrar({ponto_id: fonte})
            estado = quietude.quieto(ponto_id, zona.id)
            do_pedaco.amostras += 1
            if estado is False:
                do_pedaco.mexendo += 1
                if not memoria.visto_mexer:
                    memoria.mexeu_desde = agora
                memoria.visto_mexer = True
            elif estado is True and memoria.visto_mexer:
                parada = Parada(
                    pedaco=pedaco.arquivo.name,
                    indice=indice,
                    segundos=segundos,
                    mexeu_por_s=round((agora - (memoria.mexeu_desde or agora)).total_seconds(), 1),
                )
                if pasta_dos_recortes is not None:
                    nome = f"{pedaco.comeco:%Y-%m-%d_%H-%M-%S}_q{indice:05d}.jpg"
                    guardar_recorte(imagem, zona, pasta_dos_recortes / nome)
                    parada.recorte = nome
                paradas.append(parada)
                memoria.visto_mexer = False
                memoria.mexeu_desde = None
        do_pedaco.quadros = indice + 1
    finally:
        cap.release()
        do_pedaco.segundos_de_leitura = round(time.perf_counter() - t0, 1)
    if do_pedaco.quadros <= 0:
        do_pedaco.erro = do_pedaco.erro or "sem quadro"
        return do_pedaco, []
    do_pedaco.taxa = round(do_pedaco.quadros / duracao_s, 3)
    do_pedaco.relogios = comparar_relogios(de_dentro, do_pedaco.quadros, duracao_s)
    do_pedaco.paradas = len(paradas)
    # O relógio de dentro vale se terminar perto do tamanho do pedaço; fora disso está estragado, e vale a contagem.
    pelo_de_dentro = abs(de_dentro_s - duracao_s) <= FOLGA_DO_RELOGIO_DE_DENTRO * duracao_s
    do_pedaco.hora_pela = "relógio de dentro" if pelo_de_dentro else "contagem"
    total = do_pedaco.quadros
    do_pedaco.primeiro = pedaco.comeco
    do_pedaco.ultimo = (
        pedaco.comeco + timedelta(seconds=de_dentro_s) if pelo_de_dentro else instante(pedaco.comeco, total - 1, total, duracao_s)
    )
    for p in paradas:
        p.no_gravador = (
            pedaco.comeco + timedelta(seconds=p.segundos) if pelo_de_dentro else instante(pedaco.comeco, p.indice, total, duracao_s)
        )
        p.na_loja = p.no_gravador - timedelta(seconds=adianto_s)
    return do_pedaco, paradas


def _hora(texto: str | None) -> tuple[int, int] | None:
    if not texto:
        return None
    hh, mm = texto.split(":")
    return int(hh), int(mm)


def na_janela(p: Pedaco, de: tuple[int, int] | None, ate: tuple[int, int] | None, duracao_s: float = DURACAO_DO_PEDACO_S) -> bool:
    """O pedaço toca a janela [de, ate) — horas do relógio do gravador, contadas a partir do dia do pedaço
    (o que passa da meia-noite continua sendo da mesma noite)."""
    base = p.comeco.replace(hour=0, minute=0, second=0, microsecond=0)
    if p.comeco.hour < 6:
        base -= timedelta(days=1)

    def limite(hm: tuple[int, int]) -> datetime:
        t = base + timedelta(hours=hm[0], minutes=hm[1])
        return t + timedelta(days=1) if hm[0] < 6 else t

    fim = p.comeco + timedelta(seconds=duracao_s)
    if de is not None and fim <= limite(de):
        return False
    if ate is not None and p.comeco >= limite(ate):
        return False
    return True


def repassar(
    pasta: Path,
    canal: int,
    saida: Path,
    config_json: dict,
    *,
    de: str | None = None,
    ate: str | None = None,
    numero: int | None = None,
    adianto_s: float = ADIANTO_DO_GRAVADOR_S,
    duracao_s: float = DURACAO_DO_PEDACO_S,
    taxa_provisoria: float = TAXA_PROVISORIA,
    dizer=print,
) -> dict:
    """O canal inteiro (ou a janela pedida): as paradas em `paradas.csv`, os recortes em `recortes/`, o resumo em `resumo.json`."""
    ponto_id, zona = quadro_do_canal(config_json, canal, numero)
    escolhidos = [p for p in pedacos(pasta, canal) if na_janela(p, _hora(de), _hora(ate), duracao_s)]
    saida.mkdir(parents=True, exist_ok=True)
    relogio = {"agora": datetime.min}
    quietude = Quietude(relogio=lambda: relogio["agora"])
    quietude.montar({ponto_id: [zona]})
    resumo = {
        "canal": canal,
        "quadro": {"numero": zona.numero, "nome": zona.nome, "papel": zona.papel},
        "adiantoDoGravadorS": adianto_s,
        "pedacos": [],
    }
    todas: list[Parada] = []
    anterior: DoPedaco | None = None
    memoria = _Memoria()
    for p in escolhidos:
        # Um buraco entre pedaços (um que faltou, ou que não abriu) zera a memória: o quadro de depois não tem com
        # o que ser comparado — como ao vivo, depois de o fluxo parar — e o "já mexeu" de antes não vale mais.
        if anterior is None or anterior.ultimo is None or (p.comeco - anterior.ultimo).total_seconds() > 2.0:
            quietude.montar({})
            quietude.montar({ponto_id: [zona]})
            memoria = _Memoria()
        do_pedaco, paradas = ler_pedaco(
            p, ponto_id, zona, quietude, relogio, saida / "recortes", memoria,
            duracao_s=duracao_s, taxa_provisoria=taxa_provisoria, adianto_s=adianto_s,
        )
        linha = asdict(do_pedaco)
        if anterior is not None and anterior.ultimo is not None and do_pedaco.primeiro is not None:
            # A prova da hora: do último quadro de um pedaço ao primeiro do seguinte.
            linha["emendaS"] = round((do_pedaco.primeiro - anterior.ultimo).total_seconds(), 3)
        resumo["pedacos"].append(linha)
        todas.extend(paradas)
        rel = do_pedaco.relogios
        dizer(
            f"{p.comeco:%H:%M} · {do_pedaco.quadros} quadros ({do_pedaco.taxa} por s) em {do_pedaco.segundos_de_leitura} s · "
            f"mexendo em {100 * do_pedaco.mexendo / max(1, do_pedaco.amostras):.0f}% das amostras · paradas {do_pedaco.paradas}"
            + (f" · hora pelo {do_pedaco.hora_pela}; a contagem difere em até {rel['desvioMaxS']} s, {rel['recuos']} recuo(s) do de dentro" if rel else "")
            + (f" · ERRO: {do_pedaco.erro}" if do_pedaco.erro else "")
        )
        # Pedaço com erro não tem `ultimo`: o seguinte recomeça a memória (o buraco, acima).
        anterior = do_pedaco
    with (saida / "paradas.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["pedaco", "indice", "no_gravador", "na_loja", "mexeu_por_s", "recorte"])
        for x in todas:
            w.writerow([x.pedaco, x.indice, f"{x.no_gravador:%Y-%m-%d %H:%M:%S.%f}"[:-3], f"{x.na_loja:%Y-%m-%d %H:%M:%S.%f}"[:-3], x.mexeu_por_s, x.recorte])
    lidos = [d for d in resumo["pedacos"] if not d["erro"]]
    resumo["total"] = {
        "pedacos": len(escolhidos),
        "lidos": len(lidos),
        "paradas": len(todas),
        "amostras": sum(d["amostras"] for d in lidos),
        "mexendo": sum(d["mexendo"] for d in lidos),
        "emendas": [d["emendaS"] for d in resumo["pedacos"] if "emendaS" in d],
        "desvioMaxS": max((d["relogios"].get("desvioMaxS", 0.0) for d in lidos), default=0.0),
        "horaPelaContagem": sum(1 for d in lidos if d["hora_pela"] == "contagem"),
    }
    (saida / "resumo.json").write_text(json.dumps(resumo, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    return resumo


def main(argv: list[str] | None = None) -> int:
    if sys.stdout is not None:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    a = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    a.add_argument("pasta", type=Path)
    a.add_argument("canal", type=int)
    a.add_argument("saida", type=Path)
    a.add_argument("--de")
    a.add_argument("--ate")
    a.add_argument("--quadro", type=int, default=None)
    a.add_argument("--adianto-do-gravador", type=float, default=ADIANTO_DO_GRAVADOR_S)
    a.add_argument("--configuracao", type=Path, default=Path(r"C:\Farol\agent\configuracao.json"))
    args = a.parse_args(argv)
    config_json = json.loads(args.configuracao.read_text(encoding="utf-8"))
    t0 = time.perf_counter()
    r = repassar(
        args.pasta, args.canal, args.saida, config_json,
        de=args.de, ate=args.ate, numero=args.quadro, adianto_s=args.adianto_do_gravador,
        dizer=lambda s: print(s, flush=True),
    )
    t = r["total"]
    print(
        f"FIM: {t['lidos']} de {t['pedacos']} pedaços · {t['paradas']} paradas · mexendo em "
        f"{100 * t['mexendo'] / max(1, t['amostras']):.0f}% das amostras · pedaços com a hora pela contagem (relógio "
        f"de dentro estragado): {t['horaPelaContagem']} · a contagem difere do de dentro em até {t['desvioMaxS']} s · "
        f"emendas de {min(t['emendas'], default=0):.2f} a {max(t['emendas'], default=0):.2f} s · em {time.perf_counter() - t0:.0f} s",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
