"""A câmera inteira tirada da calibração do piso (A26, rastreio firme, 28/10/2026).

A calibração dá só a homografia do chão: o ponto da imagem → o ponto do piso. Para uma pessoa atrás da bancada isso
não basta — a base da caixa do detector é a beira do móvel, não o pé (o zigue-zague da gravação de 27/10). Com a
câmera inteira (onde ela está, a que altura, para onde olha e a lente), o ALTO da caixa (a cabeça) também vira posição:
o raio que passa pela cabeça cruza a altura de uma pessoa em pé num ponto só.

A câmera sai da própria homografia, sem nenhum dado a mais (a decomposição de Zhang): supondo pixels quadrados e o
centro da imagem no centro da lente — o que vale para as câmeras de segurança comuns —, a homografia do chão é
`K · [r1 r2 t]`, com `r1` e `r2` perpendiculares e do mesmo tamanho. Isso dá o foco, depois a rotação e a posição. A
imagem é a normalizada da calibração ((0, 0) em cima à esquerda, (1, 1) embaixo à direita), no formato 16:9 da câmera
(o fluxo reduzido é a mesma imagem esticada: a fração não muda).

A distorção da lente não entra (a homografia também não tem): a conta vale melhor no meio da imagem, que é onde a
calibração marcou os pontos.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Sequence

import numpy as np

ASPECTO = 16 / 9
ALTURA_DA_CABECA = 1.65  # m: o alto da cabeça de um adulto em pé — é até onde vai a caixa do detector


@dataclass(frozen=True)
class Camera:
    """A câmera no espaço da planta: a posição (x, y no piso, z a altura, em metros) e o que leva um ponto da imagem a
    um raio. `para_cima` diz o sinal do eixo z da decomposição (a imagem cresce para baixo; o eixo pode sair invertido)."""

    centro: tuple[float, float, float]
    foco: float  # em alturas de imagem
    rotacao: np.ndarray  # mundo → câmera (as linhas são os eixos da câmera)
    para_cima: float
    aspecto: float

    @property
    def altura(self) -> float:
        return abs(self.centro[2])

    def raio(self, uv: Sequence[float]) -> np.ndarray:
        """A direção, no mundo, do raio que sai da câmera e passa pelo ponto (u, v) da imagem normalizada."""
        p = np.array([(uv[0] - 0.5) * self.aspecto / self.foco, (uv[1] - 0.5) / self.foco, 1.0])
        return self.rotacao.T @ p


def _piso_de(hm: np.ndarray, uv: Sequence[float]) -> tuple[float, float] | None:
    q = hm @ np.array([uv[0], uv[1], 1.0])
    if not q[2] > 1e-9:
        return None
    return float(q[0] / q[2]), float(q[1] / q[2])


def camera_da_homografia(h: Sequence[float], aspecto: float = ASPECTO) -> Camera | None:
    """A câmera que explica a homografia `h` (imagem normalizada → piso). Nula quando a homografia não é de uma câmera
    de verdade (o foco sai imaginário, a câmera fica atrás do piso…).

    Na grande-angular a distorção da lente puxa a conta (o canal 8 da loja dá 2,92 m com a câmera a 2,20 m): o chão
    continua certo — é a homografia —, mas a cabeça vale menos. Quem usa compara `altura` com a medida da planta
    (`confianca_da_cabeca`)."""
    hm = np.array(h, dtype=np.float64).reshape(3, 3)
    try:
        g = np.linalg.inv(hm)  # piso → imagem normalizada
    except np.linalg.LinAlgError:
        return None
    s = np.array([[aspecto, 0.0, -aspecto / 2], [0.0, 1.0, -0.5], [0.0, 0.0, 1.0]])
    g = s @ g  # piso → imagem centrada, em alturas de imagem
    g1, g2 = g[:, 0], g[:, 1]
    candidatos = []
    a = g1[2] * g2[2]
    if abs(a) > 1e-12:
        candidatos.append(-(g1[0] * g2[0] + g1[1] * g2[1]) / a)
    b = g1[2] ** 2 - g2[2] ** 2
    if abs(b) > 1e-12:
        candidatos.append(-(g1[0] ** 2 + g1[1] ** 2 - g2[0] ** 2 - g2[1] ** 2) / b)
    validos = [c for c in candidatos if c > 1e-6 and math.isfinite(c)]
    if not validos:
        return None
    return _com_foco(hm, g, math.sqrt(float(np.median(validos))), aspecto)


def _com_foco(hm: np.ndarray, g: np.ndarray, foco: float, aspecto: float) -> Camera | None:
    """A câmera com este foco: a rotação e a posição que a homografia pede (a rotação mais perto da medida)."""
    g1, g2, g3 = g[:, 0], g[:, 1], g[:, 2]
    kinv = np.diag([1.0 / foco, 1.0 / foco, 1.0])
    m1, m2, m3 = kinv @ g1, kinv @ g2, kinv @ g3
    lam = 2.0 / (np.linalg.norm(m1) + np.linalg.norm(m2))
    r1, r2, t = lam * m1, lam * m2, lam * m3
    # O chão que a câmera VÊ tem de ficar na frente dela (profundidade positiva). Não vale olhar a origem da planta:
    # ela costuma ficar atrás da câmera (o canto da loja).
    visto = _piso_de(hm, (0.5, 0.75))
    if visto is None:
        return None
    if (r1 * visto[0] + r2 * visto[1] + t)[2] < 0:
        r1, r2, t = -r1, -r2, -t
    r = np.column_stack([r1, r2, np.cross(r1, r2)])
    u, _, vt = np.linalg.svd(r)
    r = u @ vt  # a rotação mais perto (a medida tem ruído)
    centro = -r.T @ t
    if not np.all(np.isfinite(centro)) or abs(centro[2]) < 0.3:
        return None
    return Camera((float(centro[0]), float(centro[1]), float(centro[2])), foco, r, 1.0 if centro[2] > 0 else -1.0, aspecto)


def confianca_da_cabeca(cam: Camera, altura_medida: float | None) -> float:
    """De 0 a 1: o quanto a posição pela cabeça vale nesta câmera. Sem a medida, 1. Com ela, cai com a diferença entre
    a altura da conta e a medida (20% de diferença já é meia confiança; 40%, nenhuma)."""
    if not altura_medida or altura_medida <= 0:
        return 1.0
    erro = abs(cam.altura - altura_medida) / altura_medida
    return max(0.0, min(1.0, 1.0 - erro / 0.4))


def ponto_na_altura(cam: Camera, uv: Sequence[float], altura: float) -> tuple[float, float] | None:
    """Onde o raio do ponto (u, v) da imagem passa pela `altura` (metros acima do piso), na planta. Nulo se o raio não
    chega lá na frente da câmera (a altura acima da câmera, ou o raio subindo)."""
    d = cam.raio(uv)
    alvo = cam.para_cima * altura
    if abs(d[2]) < 1e-9:
        return None
    s = (alvo - cam.centro[2]) / d[2]
    if not s > 0:
        return None
    return cam.centro[0] + s * float(d[0]), cam.centro[1] + s * float(d[1])
