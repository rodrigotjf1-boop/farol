"""A calibração de cada câmera pelos pontos do piso, no agente (A26, parte P1, 25/10/2026).

A MESMA conta de `api/src/calibracao.ts` (a nuvem calcula ao salvar; o agente usa a homografia que desce na
configuração e, sem ela, calcula dos pares): a imagem NORMALIZADA ((0, 0) em cima à esquerda, (1, 1) embaixo à
direita) → a planta, em metros. DLT normalizado (Hartley), a homografia com norma 1 e o sinal que põe o chão marcado do
lado positivo do horizonte; o erro de cada ponto; o erro "conferido", deixando um ponto de fora por vez; e o pedaço do
piso que a câmera vê. `contratos/calibracao-da-camera.json` confere os dois lados.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Sequence

import numpy as np

MINIMO_DE_PARES = 4
ALCANCE_DA_AREA = 15.0
PONTOS_POR_LADO = 24

Pt = tuple[float, float]


@dataclass(frozen=True)
class Par:
    img: Pt
    piso: Pt


def _normalizacao(pts: np.ndarray) -> tuple[np.ndarray, np.ndarray] | None:
    c = pts.mean(axis=0)
    media = float(np.mean(np.hypot(*(pts - c).T)))
    if not media > 1e-12:
        return None
    k = math.sqrt(2.0) / media
    t = np.array([[k, 0, -k * c[0]], [0, k, -k * c[1]], [0, 0, 1]], dtype=np.float64)
    inv = np.array([[1 / k, 0, c[0]], [0, 1 / k, c[1]], [0, 0, 1]], dtype=np.float64)
    return t, inv


def lado_do_horizonte(h: Sequence[float], p: Pt) -> float:
    return h[6] * p[0] + h[7] * p[1] + h[8]


def projetar(h: Sequence[float], p: Pt) -> Pt | None:
    """Onde o ponto da imagem cai no piso; nulo no horizonte ou atrás da câmera."""
    w = lado_do_horizonte(h, p)
    if not w > 1e-9:
        return None
    return ((h[0] * p[0] + h[1] * p[1] + h[2]) / w, (h[3] * p[0] + h[4] * p[1] + h[5]) / w)


def homografia(pares: Sequence[Par]) -> list[float] | None:
    """A homografia imagem → piso pelos pares; nula quando eles não definem uma (menos de 4, numa reta…)."""
    if len(pares) < MINIMO_DE_PARES:
        return None
    img = np.array([p.img for p in pares], dtype=np.float64)
    piso = np.array([p.piso for p in pares], dtype=np.float64)
    ni, np_ = _normalizacao(img), _normalizacao(piso)
    if ni is None or np_ is None:
        return None
    ui = (ni[0] @ np.c_[img, np.ones(len(img))].T).T
    xp = (np_[0] @ np.c_[piso, np.ones(len(piso))].T).T
    linhas = []
    for (u, v, _), (x, y, _) in zip(ui, xp):
        linhas.append([-u, -v, -1, 0, 0, 0, x * u, x * v, x])
        linhas.append([0, 0, 0, -u, -v, -1, y * u, y * v, y])
    a = np.array(linhas, dtype=np.float64)
    # os autovalores de AᵀA (o mesmo critério da nuvem: o 2º menor longe de zero)
    valores, vetores = np.linalg.eigh(a.T @ a)
    if not valores[1] > 1e-9 * max(1.0, valores[8]):
        return None
    hn = vetores[:, 0].reshape(3, 3)
    h = (np_[1] @ hn @ ni[0]).reshape(9)
    centro = (float(img[:, 0].mean()), float(img[:, 1].mean()))
    if lado_do_horizonte(h, centro) < 0:
        h = -h
    if any(not lado_do_horizonte(h, p.img) > 0 for p in pares):
        return None
    h = h / np.linalg.norm(h)
    if not np.all(np.isfinite(h)):
        return None
    return [float(x) for x in h]


def _r3(n: float) -> float:
    return round(n * 1000) / 1000


@dataclass(frozen=True)
class Erros:
    por_par: list[float]
    medio_m: float
    maximo_m: float
    conferido_por_par: list[float | None] | None
    conferido_mediana_m: float | None
    conferido_maximo_m: float | None


def erros_da_calibracao(pares: Sequence[Par], h: Sequence[float]) -> Erros:
    def erro(hh: Sequence[float] | None, p: Par) -> float | None:
        q = projetar(hh, p.img) if hh is not None else None
        return None if q is None else _r3(math.hypot(q[0] - p.piso[0], q[1] - p.piso[1]))

    por_par = [erro(h, p) for p in pares]
    por_par_f = [math.inf if e is None else e for e in por_par]
    conferido = mediana = maximo = None
    if len(pares) >= 5:
        conferido = [erro(homografia([q for j, q in enumerate(pares) if j != i]), p) for i, p in enumerate(pares)]
        validos = [e for e in conferido if e is not None]
        if validos:
            mediana, maximo = _r3(float(np.median(validos))), _r3(max(validos))
        else:
            conferido = None
    return Erros(por_par_f, _r3(sum(por_par_f) / len(por_par_f)), _r3(max(por_par_f)), conferido, mediana, maximo)


def area_vista(h: Sequence[float], pares: Sequence[Par], alcance: float = ALCANCE_DA_AREA) -> list[Pt]:
    """O pedaço do piso que a câmera vê: a borda da imagem levada à planta, cortada no horizonte e no alcance."""
    n = PONTOS_POR_LADO
    cx = sum(p.piso[0] for p in pares) / len(pares)
    cy = sum(p.piso[1] for p in pares) / len(pares)
    borda: list[Pt] = ([(i / n, 0.0) for i in range(n)] + [(1.0, i / n) for i in range(n)]
                       + [(1 - i / n, 1.0) for i in range(n)] + [(0.0, 1 - i / n) for i in range(n)])

    def valido(p: Pt) -> bool:
        q = projetar(h, p)
        return q is not None and math.hypot(q[0] - cx, q[1] - cy) <= alcance

    def corte(bom: Pt, ruim: Pt) -> Pt:
        a, b = bom, ruim
        for _ in range(30):
            m = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
            if valido(m):
                a = m
            else:
                b = m
        return a

    saida: list[Pt] = []
    for i, p in enumerate(borda):
        q = borda[(i + 1) % len(borda)]
        vp, vq = valido(p), valido(q)
        if vp:
            saida.append(projetar(h, p))  # type: ignore[arg-type]
        if vp != vq:
            saida.append(projetar(h, corte(p, q) if vp else corte(q, p)))  # type: ignore[arg-type]
    return [(_r3(x), _r3(y)) for x, y in saida]


def pares_de(lista: Sequence[dict]) -> list[Par]:
    """Os pares como chegam da configuração: `[{img: [u, v], piso: [x, y]}]`."""
    return [Par((float(p["img"][0]), float(p["img"][1])), (float(p["piso"][0]), float(p["piso"][1]))) for p in lista]
