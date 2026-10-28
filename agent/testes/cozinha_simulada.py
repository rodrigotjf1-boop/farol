"""Uma cozinha SIMULADA para os testes do rastreio (A26): câmeras de furo com posição, alvo e lente conhecidos, móveis com
altura que escondem as pernas de quem está atrás, e o "detector" que devolve a caixa de cada pessoa como a câmera a vê
(o alto da cabeça e o ponto mais baixo que aparece), com o tremor de um detector de verdade.

A calibração de cada câmera sai como na loja: pares de pontos do piso → homografia (`calibracao.homografia`). Assim o
rastreio é posto à prova contra a VERDADE (onde cada pessoa estava), não contra outra conta.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from farol_agent.planta_viva import calibracao as cal
from farol_agent.planta_viva.rastreio import Movel, _corte_da_caixa

L, A = 704, 396  # o fluxo reduzido


@dataclass
class CameraSimulada:
    canal: str
    posicao: tuple[float, float, float]
    alvo: tuple[float, float, float]
    abertura_h: float = 90.0
    aspecto: float = 16 / 9
    _eixos: tuple = field(init=False, repr=False)

    def __post_init__(self) -> None:
        c, a = np.array(self.posicao, float), np.array(self.alvo, float)
        f = (a - c) / np.linalg.norm(a - c)
        direita = np.cross(f, [0.0, 0.0, 1.0])
        direita /= np.linalg.norm(direita)
        baixo = np.cross(f, direita)
        self._eixos = (direita, baixo, f)

    @property
    def fx(self) -> float:
        return 0.5 / math.tan(math.radians(self.abertura_h / 2))

    def imagem(self, x: float, y: float, z: float) -> tuple[float, float] | None:
        """Onde o ponto aparece na imagem normalizada (pode cair fora de 0..1); nulo atrás da câmera."""
        direita, baixo, frente = self._eixos
        d = np.array([x, y, z]) - np.array(self.posicao)
        prof = float(d @ frente)
        if prof <= 0.05:
            return None
        return 0.5 + self.fx * float(d @ direita) / prof, 0.5 + self.fx * self.aspecto * float(d @ baixo) / prof

    def homografia(self) -> list[float]:
        """A calibração da loja: pontos do piso que a câmera vê, marcados na imagem."""
        pares = []
        for gx in np.linspace(-6, 14, 41):
            for gy in np.linspace(-6, 14, 41):
                uv = self.imagem(float(gx), float(gy), 0.0)
                if uv and 0.05 <= uv[0] <= 0.95 and 0.35 <= uv[1] <= 0.95:
                    pares.append(cal.Par((uv[0], uv[1]), (float(gx), float(gy))))
        h = cal.homografia(pares)
        assert h is not None, f"a câmera {self.canal} não vê piso que dê para calibrar"
        return h

    def caixa(self, x: float, y: float, moveis: tuple[Movel, ...] = (), *, altura: float = 1.7, ombros: float = 0.45,
              rng: np.random.Generator | None = None, tremor: float = 0.012) -> tuple[float, float, float, float, float] | None:
        """A caixa (pixels) da pessoa em pé em (x, y), como o detector a daria; nula se ela não aparece."""
        c = np.array(self.posicao, float)
        visivel = None
        for z in np.arange(0.0, altura, 0.02):  # o ponto mais baixo do corpo que a câmera vê (a bancada esconde)
            p = np.array([x, y, z])
            if not any(_corte_da_caixa(c, p, (m.x, m.y, 0.0), (m.x + m.w, m.y + m.h, m.alt)) for m in moveis):
                visivel = float(z)
                break
        if visivel is None or altura - visivel < 0.4:
            return None  # quase toda escondida: o detector não acha
        topo, base = self.imagem(x, y, altura), self.imagem(x, y, visivel)
        meio = self.imagem(x, y, altura / 2)
        if not topo or not base or not meio:
            return None
        frente = self._eixos[2]
        prof = float((np.array([x, y, altura / 2]) - c) @ frente)
        meia = self.fx * (ombros / 2) / prof
        u0, u1 = meio[0] - meia, meio[0] + meia
        v0, v1 = topo[1], base[1]
        if rng is not None:
            alto = v1 - v0
            u0, u1 = u0 + rng.normal(0, tremor) * alto / self.aspecto, u1 + rng.normal(0, tremor) * alto / self.aspecto
            v0, v1 = v0 + rng.normal(0, tremor) * alto, v1 + rng.normal(0, tremor) * alto
        u0, u1, v0, v1 = max(0.0, u0), min(1.0, u1), max(0.0, v0), min(1.0, v1)
        if u1 - u0 < 0.01 or v1 - v0 < 0.03 or u1 <= 0 or u0 >= 1:
            return None
        return (u0 * L, v0 * A, u1 * L, v1 * A, 0.9)
