"""O corpo do lanche de treino, para a conferência (A21, fatia T3c-4).

Cada lanche que a leitura da bancada achou (`treino_lanches`) vira o corpo de
`POST /v1/agentes/treino/lanches` (o contrato é `contratos/lanche-de-treino.json`):
a gravação, o lanche (quando abriu, quando fechou, as etapas) e os quadros das
etapas, REDUZIDOS (decisão 1 do dono, 15/10/2026: os quadros das etapas sobem
reduzidos, para conferir, e saem 30 dias depois da conferência; a gravação
inteira fica na loja).

**Sem identificação, a etapa vai sem leitura.** Enquanto a identificação dos
ingredientes (T3c-3) não entra, a etapa sai com `leu` nulo e sem candidatos —
a conferência pergunta à pessoa o que era, e a resposta vira exemplo da base
(T4). Quem tem a identificação passa as etapas lidas (`etapas`).

**A etapa sobe no recorte da METADE em que entrou o ingrediente** (o dono,
15/10/2026: "o ideal é que os cortes centralizem o máximo possível ou no tampo
superior ou no tampo inferior do pão, que é onde vão os ingredientes"). Sem a
identificação, a metade é a que MUDOU desde a etapa anterior, no miolo de cada
metade e com a luz alinhada (`metade_da_etapa`); na dúvida, o recorte inteiro,
como antes.

**Os limites do contrato** valem aqui antes de valer lá: até 60 etapas, até 40
quadros de até 300 kB, até 12 candidatos, "vezes" de 1 a 6. A etapa que passa
dos 40 quadros vai sem quadro.

E o envio, com o destino de cada resposta: 409 (a gravação foi encerrada no
console) para de mandar os lanches dela; 422 não se repete (é erro de quem
mandou); rede e 5xx, de novo depois.

**Dorme:** nada no agente chama este módulo ainda (a T3d liga).
"""

from __future__ import annotations

import base64
import csv
import logging
import math
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Callable

import cv2
import numpy as np

from farol_agent.nuvem import ErroDaNuvem
from farol_agent.treino import Gravacao

_log = logging.getLogger(__name__)

MAX_ETAPAS = 60
MAX_QUADROS = 40
MAX_BYTES_DO_QUADRO = 300_000
MAX_CANDIDATOS = 12
VEZES = (1, 6)
LADOS = ("pao", "tampo", "base", "outro")
# O lado maior do quadro reduzido (a carga de 14/10 subiu com até 360 px).
LADO_DO_QUADRO = 360

# O recorte da metade. Medido nos 9 lanches das 21h48 de 14/10 (58 etapas com a anterior no mesmo trecho, revistas
# uma a uma no antes e no depois, em 16/10): a mudança na caixa inteira não serve — a mão e o lanche do lado mudam
# junto (55 de 58 "espalhadas"); no DISCO de cada metade, com a luz alinhada (o jeito do identificador da rodada 12),
# 23 etapas decididas e 23 certas; as outras 35 sobem no recorte inteiro.
METADES = "metades.csv"
# ΔE (Lab do OpenCV) a partir do qual o pixel mudou.
DIFERENCA_E = 22.0
# O disco, do lado menor da caixa do detector: dentro do pão, longe do papel-alumínio da borda (que cintila).
RAIO_DO_DISCO = 0.42
# Do disco: a menor mudança certa medida foi 0,18; a fraca que errava, 0,06.
MUDOU_NA_METADE = 0.10
# Vezes a outra metade: com 1,5, o pão chegando numa ganhava do molho que entrou na outra.
RAZAO_DA_METADE = 2.0
# Quadros antes da etapa em que se procuram as metades (o pão coberto de ingrediente some do detector).
JANELA_DA_METADE = 30
# Quadros: alguma metade vista até aqui da etapa — senão o lanche já tinha saído (a mão no lugar vazio "mudou").
PRESENTE = 2
# Da mediana do trecho: a caixa menor que isso não é metade (um "pão" de 20 px entre as duas, visto várias vezes).
TAMANHO_DA_METADE = 0.6
# Em volta da metade, de cada lado, no recorte que sobe.
FOLGA_DA_METADE = 0.35

ENVIADO, ENCERRADA, RECUSADO, DEPOIS = "enviado", "encerrada", "recusado", "depois"


def _com_fuso(t: datetime) -> str:
    """A hora da loja com o fuso dela (o computador da loja está no fuso dela)."""
    return (t if t.tzinfo is not None else t.astimezone()).isoformat(timespec="seconds")


def hora_do_recorte(nome: str, inicio: datetime) -> datetime:
    """A hora de um recorte do lanche ("21h00m12.jpg"), no dia do lanche — e no dia seguinte, se passou da meia-noite."""
    t = datetime.strptime(Path(nome).stem, "%Hh%Mm%S")
    hora = inicio.replace(hour=t.hour, minute=t.minute, second=t.second, microsecond=0)
    return hora + timedelta(days=1) if hora < inicio.replace(microsecond=0) else hora


def reduzir(imagem: np.ndarray, lado: int = LADO_DO_QUADRO) -> bytes | None:
    """O quadro reduzido (lado maior até `lado`), em JPEG, dentro do limite do contrato."""
    h, w = imagem.shape[:2]
    k = lado / max(h, w)
    if k < 1.0:  # o pequeno não aumenta
        imagem = cv2.resize(imagem, (max(1, round(w * k)), max(1, round(h * k))), interpolation=cv2.INTER_AREA)
    for qualidade in (85, 70, 55):
        ok, dados = cv2.imencode(".jpg", imagem, [cv2.IMWRITE_JPEG_QUALITY, qualidade])
        if ok and len(dados) <= MAX_BYTES_DO_QUADRO:
            return dados.tobytes()
    return None


def _ler(caminho: Path) -> np.ndarray | None:
    try:
        return cv2.imdecode(np.fromfile(str(caminho), np.uint8), cv2.IMREAD_COLOR)
    except OSError:
        return None


Caixa = tuple[float, float, float, float]


def ler_metades(pasta: Path) -> list[tuple[str, int, list[Caixa]]]:
    """O `metades.csv` do lanche (`treino_lanches`): por quadro, na ordem do tempo, o trecho e as metades vistas pelo
    detector (em pixels do recorte). Sem o arquivo, ou torto: vazio — e as etapas sobem no recorte inteiro."""
    saida = []
    try:
        with (Path(pasta) / METADES).open(encoding="utf-8", newline="") as f:
            for linha in csv.DictReader(f):
                caixas = []
                for m in (linha.get("metades") or "").split(";"):
                    partes = m.split(":")
                    if len(partes) >= 4:
                        caixas.append(tuple(float(v) for v in partes[:4]))
                saida.append((linha["quadro"], int(linha["trecho"]), caixas))
    except (OSError, KeyError, ValueError, TypeError):
        return []
    return saida


def _centro(c) -> tuple[float, float]:
    return (c[0] + c[2]) / 2, (c[1] + c[3]) / 2


def _lado(c) -> float:
    return min(c[2] - c[0], c[3] - c[1])


def metades_na_etapa(linhas: list[tuple[str, int, list[Caixa]]], trecho: int, indice: int) -> list[tuple[Caixa, int]]:
    """As metades na hora da etapa (a linha `indice` do `metades.csv`): as caixas do trecho na janela antes dela,
    juntas pelo centro, e os dois grupos com mais caixas. De cada metade, a caixa mais perto no tempo e a distância,
    em quadros. A metade que só aparece depois da etapa ainda não tinha chegado: não entra."""
    todas = [(i, c) for i, (_, t, cs) in enumerate(linhas) if t == trecho for c in cs]
    if not todas:
        return []
    mediana = float(np.median([_lado(c) for _, c in todas]))
    grupos: list[list[tuple[int, Caixa]]] = []
    for i, c in todas:
        if _lado(c) < TAMANHO_DA_METADE * mediana or not indice - JANELA_DA_METADE <= i <= indice + PRESENTE:
            continue
        for g in grupos:
            gx = float(np.median([_centro(b)[0] for _, b in g]))
            gy = float(np.median([_centro(b)[1] for _, b in g]))
            if math.dist(_centro(c), (gx, gy)) < 0.5 * _lado(c):
                g.append((i, c))
                break
        else:
            grupos.append([(i, c)])
    grupos = sorted((g for g in grupos if len(g) >= 2 or any(i == indice for i, _ in g)), key=len, reverse=True)[:2]
    saida = []
    for g in grupos:
        if min(i for i, _ in g) > indice:
            continue
        i, c = min(g, key=lambda ic: (abs(ic[0] - indice), ic[0] > indice))
        saida.append((c, abs(i - indice)))
    return saida


def _disco(forma: tuple[int, ...], cx: float, cy: float, r: float) -> np.ndarray:
    yy, xx = np.mgrid[0:forma[0], 0:forma[1]]
    return (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r


def alinhar_luz(atual: np.ndarray, ref: np.ndarray) -> np.ndarray:
    """O quadro atual na luz do de referência: a sombra de quem chega muda o tom e mantém o desenho; o ingrediente novo
    muda o desenho. Por canal, ganho e deslocamento ajustados nos pixels de desenho igual (correlação ≥ 0,8 em janelas
    de 11 px, com textura), por mínimos quadrados, cortando os que fogem."""
    a = cv2.cvtColor(atual, cv2.COLOR_BGR2GRAY).astype(np.float32)
    r = cv2.cvtColor(ref, cv2.COLOR_BGR2GRAY).astype(np.float32)
    k = (11, 11)
    ma, mr = cv2.blur(a, k), cv2.blur(r, k)
    va = cv2.blur(a * a, k) - ma * ma
    vr = cv2.blur(r * r, k) - mr * mr
    ncc = (cv2.blur(a * r, k) - ma * mr) / np.sqrt(np.maximum(va * vr, 1e-6))
    ok = (ncc >= 0.8) & (va >= 30) & (vr >= 30)
    if int(ok.sum()) < 2000:
        return atual
    saida = np.empty(atual.shape, np.float32)
    for canal in range(3):
        x = ref[..., canal][ok].astype(np.float32)
        y = atual[..., canal][ok].astype(np.float32)
        manter = np.ones(len(x), bool)
        g, o = 1.0, 0.0
        for _ in range(3):
            matriz = np.vstack([x[manter], np.ones(int(manter.sum()), np.float32)]).T
            (g, o), *_ = np.linalg.lstsq(matriz, y[manter], rcond=None)
            fora = y - (g * x + o)
            mad = float(np.median(np.abs(fora[manter]))) + 1e-6
            manter = np.abs(fora) <= 2.5 * 1.4826 * mad
        saida[..., canal] = (atual[..., canal].astype(np.float32) - o) / max(float(g), 0.3)
    return np.clip(saida, 0, 255).astype(np.uint8)


def fracoes_que_mudaram(atual: np.ndarray, anterior: np.ndarray, caixas: list[Caixa]) -> list[float]:
    """De cada metade, quanto do disco mudou da etapa anterior para esta (com a luz alinhada)."""
    lab_atual = cv2.cvtColor(alinhar_luz(atual, anterior), cv2.COLOR_BGR2LAB).astype(np.float32)
    lab_antes = cv2.cvtColor(anterior, cv2.COLOR_BGR2LAB).astype(np.float32)
    mudou = np.linalg.norm(lab_atual - lab_antes, axis=2) > DIFERENCA_E
    mudou = cv2.morphologyEx(mudou.astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8)) > 0
    saida = []
    for c in caixas:
        d = _disco(atual.shape, *_centro(c), RAIO_DO_DISCO * _lado(c))
        saida.append(float(mudou[d].sum()) / max(1, int(d.sum())))
    return saida


def metade_da_etapa(pasta: Path, linhas: list[tuple[str, int, list[Caixa]]], nome: str, anterior: str | None,
                    atual: np.ndarray) -> Caixa | None:
    """A caixa da metade em que entrou o que a etapa `nome` trouxe (comparada com a etapa `anterior`), ou nula — o
    recorte inteiro: a primeira etapa, o lanche no lugar novo, sem metade conhecida, o lanche que já tinha saído,
    nenhuma metade que mudou o bastante, as duas que mudaram parecido."""
    if not anterior or not linhas:
        return None
    onde = {q: (i, t) for i, (q, t, _) in enumerate(linhas)}
    if nome not in onde or anterior not in onde or onde[nome][1] != onde[anterior][1]:
        return None
    indice, trecho = onde[nome]
    metades = metades_na_etapa(linhas, trecho, indice)
    if not metades or min(d for _, d in metades) > PRESENTE:
        return None
    antes = _ler(Path(pasta) / anterior)
    if antes is None or antes.shape != atual.shape:
        return None
    caixas = [c for c, _ in metades]
    f = fracoes_que_mudaram(atual, antes, caixas)
    k = max(range(len(f)), key=f.__getitem__)
    if f[k] < MUDOU_NA_METADE or any(f[k] < RAZAO_DA_METADE * f[j] for j in range(len(f)) if j != k):
        return None
    return caixas[k]


def recorte_da_metade(imagem: np.ndarray, caixa: Caixa) -> np.ndarray | None:
    """A metade e a folga em volta, de cada lado — centrada nela o quanto o recorte do lanche deixa. Nulo se a caixa
    cai fora do recorte."""
    x0, y0, x1, y1 = caixa
    mx, my = FOLGA_DA_METADE * (x1 - x0), FOLGA_DA_METADE * (y1 - y0)
    xa, ya = int(max(0, x0 - mx)), int(max(0, y0 - my))
    xb, yb = int(min(imagem.shape[1], x1 + mx)), int(min(imagem.shape[0], y1 + my))
    if xb - xa < 10 or yb - ya < 10:
        return None
    return imagem[ya:yb, xa:xb]


def etapas_sem_leitura(resumo: dict) -> list[dict]:
    """As etapas da leitura da bancada (T3c-2), sem identificação: a primeira é o pão aberto; as outras, de lado ainda
    não sabido. Cada uma com o recorte dela (`arquivo`)."""
    inicio = datetime.strptime(resumo["inicio"], "%Y-%m-%d %H:%M:%S")
    saida = []
    for i, nome in enumerate(resumo.get("etapas") or []):
        saida.append({
            "hora": hora_do_recorte(nome, inicio), "lado": "pao" if i == 0 else "outro", "inicio": i == 0,
            "leu": None, "candidatos": [], "vezes": 1, "arquivo": nome,
        })
    return saida


def corpo_do_lanche(gravacao: Gravacao, resumo: dict, pasta_do_lanche: Path, etapas: list[dict] | None = None) -> dict:
    """O corpo de `POST /v1/agentes/treino/lanches` para um lanche (`resumo` é a linha dele em `lanches.json`).

    `etapas`: as etapas lidas (com `hora`, `lado`, `inicio`, `leu`, `candidatos`, `vezes` e o `arquivo` do recorte);
    sem elas, as da leitura da bancada, sem leitura.
    """
    etapas = list(etapas if etapas is not None else etapas_sem_leitura(resumo))
    if len(etapas) > MAX_ETAPAS:
        _log.warning("treino: o lanche %s teve %d etapas; vão as %d primeiras", resumo["lanche"], len(etapas), MAX_ETAPAS)
        etapas = etapas[:MAX_ETAPAS]
    quadros: list[dict] = []
    saida_etapas = []
    linhas = ler_metades(pasta_do_lanche)
    na_metade = 0
    for k, e in enumerate(etapas):
        indice = None
        if e.get("arquivo") and len(quadros) < MAX_QUADROS:
            imagem = _ler(Path(pasta_do_lanche) / e["arquivo"])
            if imagem is not None and k > 0:
                caixa = metade_da_etapa(pasta_do_lanche, linhas, e["arquivo"], etapas[k - 1].get("arquivo"), imagem)
                pedaco = recorte_da_metade(imagem, caixa) if caixa is not None else None
                if pedaco is not None:
                    imagem = pedaco
                    na_metade += 1
            dados = reduzir(imagem) if imagem is not None else None
            if dados is not None:
                indice = len(quadros)
                quadros.append({"imagemBase64": base64.b64encode(dados).decode("ascii")})
        candidatos = [c for c in (e.get("candidatos") or []) if isinstance(c, str) and c.strip()][:MAX_CANDIDATOS]
        saida_etapas.append({
            "hora": _com_fuso(e["hora"]),
            "lado": e["lado"] if e.get("lado") in LADOS else "outro",
            "inicio": bool(e.get("inicio")),
            "leu": e.get("leu") or None,
            "candidatos": candidatos,
            "vezes": min(VEZES[1], max(VEZES[0], int(e.get("vezes") or 1))),
            "quadro": indice,
        })
    _log.debug("treino: o lanche %s sobe %d de %d etapas no recorte da metade", resumo["lanche"], na_metade, len(etapas))
    aberto = datetime.strptime(resumo["inicio"], "%Y-%m-%d %H:%M:%S")
    fechou = datetime.strptime(resumo["fim"], "%Y-%m-%d %H:%M:%S") if resumo.get("fim") else None
    return {
        "gravacao": {
            "chave": gravacao.chave, "pontoId": gravacao.ponto_id, "inicio": gravacao.inicio.isoformat(),
            "fim": gravacao.fim.isoformat(), "origem": gravacao.origem,
        },
        "lanche": {
            "chave": f"lanche-{int(resumo['lanche']):02d}", "abertoEm": _com_fuso(aberto),
            "fechouEm": _com_fuso(fechou) if fechou else None, "etapas": saida_etapas,
        },
        "quadros": quadros,
    }


def mandar(enviar: Callable[[dict], Any], corpo: dict) -> str:
    """Manda o corpo (`ClienteNuvem.lanche_de_treino`) e diz o que a loja faz depois."""
    try:
        enviar(corpo)
    except ErroDaNuvem as e:
        if e.status == 409:
            return ENCERRADA
        if e.status in (401, 403) or e.status == 429 or e.status >= 500 or e.status == 0:
            _log.info("treino: o lanche %s não entrou agora (%s); vai de novo depois", corpo["lanche"]["chave"], e)
            return DEPOIS
        _log.warning("treino: a nuvem recusou o lanche %s (%s); não repito", corpo["lanche"]["chave"], e)
        return RECUSADO
    return ENVIADO
