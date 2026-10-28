"""As pessoas na planta, sem nome (A26, parte P2, 25/10/2026).

⚠️ Desde 28/10/2026 o serviço segue as pessoas pelo RASTREIO FIRME (`rastreio.py`): os passos 1 a 4 abaixo deram, na
volta do dono pela cozinha em 27/10, a mesma pessoa em dobro, o zigue-zague e a troca de número entre câmeras. Daqui o
serviço usa só o passo 5 (`Minutos`); `vistas_do_canal`, `juntar` e `Rastreador` ficam para refazer e comparar uma
gravação de diagnóstico (o "antes").

O pedido do dono: o controle de movimento dos colaboradores, com o código pronto à espera das fotos. O caminho é o do
estudo (`docs/estudo-planta-viva.md`, seção 5), nos degraus 2 e 3 — por posto e as figuras ao vivo, SEM nome e sem
rosto (seção 7: o legítimo interesse não cobre biometria):

1. **o pé**: de cada pessoa que o detector acha (`MotorOnnx.caixas(..., "person", ...)`), o meio da base da caixa, na
   imagem normalizada. Caixa cortada pela borda de baixo da imagem tem o pé fora do quadro: fica de fora;
2. **o ponto na planta**: o pé pela homografia do canal (`calibracao.projetar`). Cada ponto leva a INCERTEZA dele, em
   metros: quanto 1% da altura da imagem vale no chão ali (a derivada da homografia — longe da câmera, um pixel é muito
   chão) somado ao erro conferido da calibração. Ponto fora da planta é descartado;
3. **as câmeras juntas**: no mesmo instante, pontos de câmeras DIFERENTES a menos de `RAIO_DE_JUNTAR` viram uma pessoa
   só, na média pesada pela incerteza (a câmera que vê de perto manda). Dois pontos da MESMA câmera nunca se juntam:
   são duas pessoas;
4. **o caminho, sem nome**: cada pessoa segue a mais perto do instante anterior, dentro do que dá para andar
   (`VELOCIDADE_MAXIMA`); quem some por `PERDA_S` acaba; o número do caminho é do dia e não diz quem é;
5. **o minuto que sobe**: os segundos-pessoa em cada célula de `CELULA_M` (o calor), o pico de pessoas ao mesmo tempo
   e, para o replay, o caminho de cada um a 1 ponto por segundo. O tempo em cada POSTO a nuvem conta do calor, com a
   planta, que é ela quem tem (`api/src/planta-viva.ts`).

Nada aqui sobe imagem: sai só posição e tempo. Nasce DESLIGADO (`FAROL_PLANTA_VIVA`).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime
from typing import Iterable, Sequence

from farol_agent.planta_viva.calibracao import projetar

LIGAR = "FAROL_PLANTA_VIVA"
NOTA_MINIMA = 0.6
RAIO_DE_JUNTAR = 0.6  # m
VELOCIDADE_MAXIMA = 2.5  # m/s (andando rápido numa cozinha)
FOLGA_DE_PORTA = 0.5  # m: o mínimo que se aceita para seguir alguém entre dois instantes
PERDA_S = 3.0
CELULA_M = 0.25
PIXEL_DE_ERRO = 0.01  # da altura da imagem: o erro de achar o pé (a base da caixa)
BORDA_DE_BAIXO = 0.985  # a caixa que encosta aqui tem o pé fora do quadro


@dataclass(frozen=True)
class Vista:
    """Uma pessoa vista por uma câmera, já no chão da planta."""

    canal: str
    x: float
    y: float
    sigma: float  # incerteza (m)
    nota: float


@dataclass(frozen=True)
class Pessoa:
    """Uma pessoa num instante, com as câmeras juntas."""

    x: float
    y: float
    sigma: float
    canais: tuple[str, ...]


def pe_da_caixa(caixa: Sequence[float], largura: int, altura: int) -> tuple[float, float] | None:
    """O meio da base da caixa (x0, y0, x1, y1, nota em pixels), normalizado; nulo se a base encosta embaixo."""
    x0, _y0, x1, y1 = caixa[:4]
    v = y1 / altura
    if v >= BORDA_DE_BAIXO:
        return None
    return ((x0 + x1) / 2 / largura, v)


def incerteza(h: Sequence[float], pe: tuple[float, float], erro_da_calibracao: float) -> float | None:
    """Quanto o ponto no chão pode estar errado (m): o erro de achar o pé, levado ao chão pela derivada da homografia
    ali, mais o erro da calibração. Nulo perto do horizonte (lá um pixel é chão sem fim)."""
    centro = projetar(h, pe)
    if centro is None:
        return None
    d = PIXEL_DE_ERRO
    maior = 0.0
    for du, dv in ((d, 0.0), (0.0, d)):
        q = projetar(h, (pe[0] + du, pe[1] + dv))
        if q is None:
            return None
        maior = max(maior, math.hypot(q[0] - centro[0], q[1] - centro[1]))
    return round(maior + max(0.0, erro_da_calibracao), 3)


def vistas_do_canal(canal: str, h: Sequence[float], erro_da_calibracao: float, caixas: Iterable[Sequence[float]],
                    largura: int, altura: int, limites: tuple[float, float, float, float] | None = None) -> list[Vista]:
    """As pessoas de um quadro de um canal, no chão. `limites` (x0, y0, x1, y1) da planta: o que cai fora não conta."""
    saida: list[Vista] = []
    for c in caixas:
        nota = float(c[4]) if len(c) > 4 else 1.0
        if nota < NOTA_MINIMA:
            continue
        pe = pe_da_caixa(c, largura, altura)
        if pe is None:
            continue
        p = projetar(h, pe)
        s = incerteza(h, pe, erro_da_calibracao)
        if p is None or s is None:
            continue
        if limites and not (limites[0] <= p[0] <= limites[2] and limites[1] <= p[1] <= limites[3]):
            continue
        saida.append(Vista(canal, round(p[0], 3), round(p[1], 3), s, nota))
    return saida


def juntar(vistas: Sequence[Vista], raio: float = RAIO_DE_JUNTAR) -> list[Pessoa]:
    """As vistas do mesmo instante, de várias câmeras, em pessoas: as de câmeras diferentes perto uma da outra se
    juntam (média pesada por 1/σ²); as da mesma câmera nunca. A mais certa primeiro decide o grupo."""
    grupos: list[list[Vista]] = []
    for v in sorted(vistas, key=lambda v: v.sigma):
        melhor, dist_melhor = None, None
        for g in grupos:
            if any(o.canal == v.canal for o in g):
                continue
            px, py = _media(g)
            d = math.hypot(px - v.x, py - v.y)
            if d <= raio and (dist_melhor is None or d < dist_melhor):
                melhor, dist_melhor = g, d
        if melhor is None:
            grupos.append([v])
        else:
            melhor.append(v)
    pessoas = []
    for g in grupos:
        x, y = _media(g)
        sigma = 1.0 / math.sqrt(sum(1.0 / max(1e-6, o.sigma) ** 2 for o in g))
        pessoas.append(Pessoa(round(x, 3), round(y, 3), round(sigma, 3), tuple(sorted({o.canal for o in g}))))
    return pessoas


def _media(g: Sequence[Vista]) -> tuple[float, float]:
    pesos = [1.0 / max(1e-6, o.sigma) ** 2 for o in g]
    total = sum(pesos)
    return sum(o.x * p for o, p in zip(g, pesos)) / total, sum(o.y * p for o, p in zip(g, pesos)) / total


@dataclass
class Caminho:
    numero: int
    x: float
    y: float
    visto_em: float
    pontos: list[tuple[float, float, float]] = field(default_factory=list)  # (t, x, y)


class Rastreador:
    """Liga as pessoas de um instante às do anterior pela posição no chão (não pela aparência: na cozinha todos vestem
    igual — estudo, seção 5). Sem nome: o número do caminho recomeça a cada dia."""

    def __init__(self, *, velocidade_maxima: float = VELOCIDADE_MAXIMA, perda_s: float = PERDA_S) -> None:
        self.velocidade_maxima = velocidade_maxima
        self.perda_s = perda_s
        self.ativos: list[Caminho] = []
        self._proximo = 1
        self._dia: str | None = None

    def passo(self, t: float, pessoas: Sequence[Pessoa], *, dia: str | None = None) -> list[tuple[int, float, float]]:
        """As pessoas do instante `t` (segundos) com o número do caminho de cada uma."""
        if dia is not None and dia != self._dia:
            self._dia, self._proximo, self.ativos = dia, 1, []
        self.ativos = [c for c in self.ativos if t - c.visto_em <= self.perda_s]
        pares = []
        for i, p in enumerate(pessoas):
            for j, c in enumerate(self.ativos):
                alcance = max(FOLGA_DE_PORTA, self.velocidade_maxima * max(0.0, t - c.visto_em)) + p.sigma
                d = math.hypot(p.x - c.x, p.y - c.y)
                if d <= alcance:
                    pares.append((d, i, j))
        usados_p: set[int] = set()
        usados_c: set[int] = set()
        numero_de: dict[int, int] = {}
        for d, i, j in sorted(pares):
            if i in usados_p or j in usados_c:
                continue
            usados_p.add(i)
            usados_c.add(j)
            c = self.ativos[j]
            c.x, c.y, c.visto_em = pessoas[i].x, pessoas[i].y, t
            c.pontos.append((t, c.x, c.y))
            numero_de[i] = c.numero
        for i, p in enumerate(pessoas):
            if i in usados_p:
                continue
            c = Caminho(self._proximo, p.x, p.y, t, [(t, p.x, p.y)])
            self._proximo += 1
            self.ativos.append(c)
            numero_de[i] = c.numero
        return [(numero_de[i], p.x, p.y) for i, p in enumerate(pessoas)]


class Minutos:
    """O que sobe à nuvem, por minuto: o calor (segundos-pessoa por célula), o pico de pessoas ao mesmo tempo e o
    caminho de cada um a 1 ponto por segundo (para o replay)."""

    def __init__(self, *, celula: float = CELULA_M) -> None:
        self.celula = celula
        self._abertos: dict[str, dict] = {}

    def somar(self, quando: datetime, dt: float, pessoas: Sequence[tuple[int, float, float]]) -> None:
        """`pessoas` no instante `quando` (com fuso), valendo `dt` segundos cada (o intervalo entre dois quadros)."""
        chave = quando.replace(second=0, microsecond=0).isoformat()
        m = self._abertos.setdefault(chave, {"calor": {}, "pico": 0, "caminhos": {}})
        m["pico"] = max(m["pico"], len(pessoas))
        segundo = quando.second
        for numero, x, y in pessoas:
            celula = (int(math.floor(x / self.celula)), int(math.floor(y / self.celula)))
            m["calor"][celula] = m["calor"].get(celula, 0.0) + dt
            pontos = m["caminhos"].setdefault(numero, {})
            pontos.setdefault(segundo, (round(x, 2), round(y, 2)))  # 1 por segundo: o primeiro do segundo

    def fechados(self, agora: datetime) -> list[dict]:
        """Os minutos que já acabaram (antes do minuto de `agora`), prontos para subir — e saem daqui."""
        corte = agora.replace(second=0, microsecond=0).isoformat()
        prontos = sorted(k for k in self._abertos if k < corte)
        saida = []
        for k in prontos:
            m = self._abertos.pop(k)
            saida.append({
                "minuto": k,
                "celulaM": self.celula,
                "calor": [[i, j, round(s, 1)] for (i, j), s in sorted(m["calor"].items())],
                "pico": m["pico"],
                "caminhos": [[n, [[seg, x, y] for seg, (x, y) in sorted(pts.items())]] for n, pts in sorted(m["caminhos"].items())],
            })
        return saida
