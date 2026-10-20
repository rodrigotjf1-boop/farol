"""Os passos do lanche (A23.3): em cada metade do pão, o que chegou e quando.

É a peça entre o LUGAR do lanche (`lugar_do_lanche`, A23.2e: o lanche vive do primeiro pão no papel até o embrulho) e o
NOME do ingrediente (o que chegou, comparado com os exemplos que o dono confirmou). O dono, 16/10/2026: "nosso agente é
como uma IA olhando a bancada e descrevendo cada passo"; "a mão sair não significa nenhum tipo de conclusão".

Medido na noite de 18/10 da loja piloto (canal 4, um quadro por segundo), contra os gabaritos do dono — o P7 (Numero 11
com ovo: carnes 21:09:26, cheddar 21:10:01 a 21:10:12, ovo 21:10:23, molho 21:10:24, alface 21:10:30, fechado 21:10:45)
e o L9 (Numero 13: cream cheese 21:12:32, alface 21:12:36, frango 21:12:46, fechado 21:12:48):

1. **As METADES**, no fim do lugar, com tudo o que se viu nele: os discos de pão (círculos de Hough abaixo do topo da
   bancada) e as caixas do detector, agrupados pela posição. Vale o grupo visto em `vistos_min` quadros ou mais,
   confirmado pelo detector ao menos uma vez (o papel tem logos redondos impressos, e o Hough acha círculo neles) e com
   pelo menos `forte` dos pontos do maior grupo (o papel empurrado no começo do P7 deixou grupos no lugar de antes, 115 px
   à esquerda, com um quinto dos pontos).
2. **A janela FIXA de cada metade**, a partir do primeiro quadro em que ela já está no lugar dela (um ponto a até `perto`
   do diâmetro em 2 de 3 quadros seguidos). A janela não anda: o encaixe de cada quadro, dentro de uma folga, absorve o
   tremido e o pão empurrado. A janela que andava com o encaixe saiu 130 px da peça no P7 (ERR-137).
3. **PARADA**: |Δcinza| médio no disco abaixo de `quieto`, contra o quadro anterior, com a luz corrigida pelo papel em
   volta do pão (a sombra de quem chega, a luz do salão). Medido no L9: parado 1,9 a 8,9; com a mão, 9,2 a 40.
4. **Um PASSO**: o que difere do último estado assentado (ΔE > `delta`) em DOIS quadros parados seguidos e não mudou
   entre eles, em `minimo` do disco ou mais — a mão que pousou e saiu volta ao que era e não conta.
5. **A PASSAGEM**: o passo que devolve o que havia antes do passo anterior desfaz os dois (o braço apoiado parado dois
   quadros, R2 de 00:05:01).
6. **O FECHAMENTO**: o primeiro passo cujo conteúdo novo é o PAPEL em volta — a tampa saiu de cima da metade dela. Depois
   dele, nada conta (o embrulho). Antes dele, o último pendente não confirmado de cada outra metade vira um passo
   PROVISÓRIO: a carne que entra no fim fica parada um quadro só (o frango do L9).

O nome do que chegou não é deste módulo: ele entrega a hora, a metade, a parte do disco, quanto do que chegou é papel, o
quadro e a máscara — o recorte que a comparação com os exemplos lê.

**Dorme:** nada no agente chama este módulo ainda.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable

import cv2
import numpy as np

from farol_agent.lugar_do_lanche import TOPO_DA_BANCADA


@dataclass(frozen=True)
class Parametros:
    """A conta dos passos (medida na noite de 18/10 da loja piloto; ver o cabeçalho do módulo)."""

    # Parada: |Δcinza| médio no disco, com a luz corrigida.
    quieto: float = 9.0
    # O ponto mudou (ΔE do Lab do OpenCV); e não mudou entre os dois quadros parados.
    delta: float = 22.0
    estavel: float = 12.0
    # A menor parte do disco que é um passo.
    minimo: float = 0.10
    # O que chegou e é papel (ΔE da cor do papel em volta, medida no começo): a peça saiu de cima dele.
    papel_de: float = 18.0
    # O fechamento: o primeiro passo com `fechou_papel` do que chegou sendo papel, em `fechou_parte` do disco.
    fechou_parte: float = 0.20
    fechou_papel: float = 0.80
    # O último pendente não confirmado antes do fechamento vira o provisório quando cobre a metade quase toda e não é
    # papel (o frango do L9: 84% do disco, 11% de papel; as sobras da junção das peças no P7, no P8 e no P4: 33–36%).
    provisorio_min: float = 0.50
    provisorio_papel: float = 0.50
    # A passagem: o passo que devolve o que havia antes do anterior (ΔE abaixo de `voltou_de` em `voltou_parte`).
    voltou_de: float = 15.0
    voltou_parte: float = 0.70
    # A janela: meia largura em diâmetros (pega o que passa da borda: a fatia de queijo é maior que a carne); a conta em
    # `escala` da resolução; a folga do encaixe em pixels dessa escala (12 = 24 px cheios).
    raio: float = 0.62
    escala: float = 0.5
    folga_px: int = 12
    # Os discos de pão (raio em pixels, na escala do canal 4 da loja piloto: o pão tem 100 a 260 px).
    raio_min_px: int = 55
    raio_max_px: int = 125
    # As metades: o agrupamento (em diâmetros), quantos quadros, a parte do maior grupo; o "já está no lugar".
    junta: float = 0.45
    vistos_min: int = 3
    forte: float = 0.30
    perto: float = 0.25


@dataclass(frozen=True)
class Ponto:
    """Um pão visto num quadro: o centro e o diâmetro, e se foi o detector (caixa) ou o Hough (disco)."""

    quadro: str
    cx: float
    cy: float
    d: float
    caixa: bool


@dataclass
class Passo:
    """O que aconteceu numa metade. `tipo`: comeco (o primeiro estado parado: o pão, ou o pão que já chegou carregado),
    passo, provisorio, transitorio (a passagem: não conta) ou fechou. `parte`: do disco da JANELA (`raio` do diâmetro do
    pão, que pega o que passa da borda — a fatia de queijo inteira no pão é ~0,4 dele); `papel`: do que chegou, quanto é
    papel; `quadro`: onde o que chegou aparece (o recorte); `mascara`: o que chegou, na janela da metade, na escala da
    conta."""

    hora: datetime
    metade: int
    tipo: str
    parte: float
    papel: float | None
    quadro: str
    mascara: np.ndarray | None = None


@dataclass(frozen=True)
class MetadeVista:
    k: int
    cx: float
    cy: float
    d: float
    desde: datetime | None


@dataclass
class Leitura:
    metades: list[MetadeVista]
    # Na ordem da hora (e da metade); os de depois do fechamento já saíram.
    passos: list[Passo]
    fechou: datetime | None


def discos(img: np.ndarray, x0: float, x1: float, p: Parametros | None = None) -> list[tuple[float, float, float]]:
    """Os discos de pão no trecho x, abaixo do topo da bancada: (cx, cy, diâmetro), em pixels do quadro."""
    p = p or Parametros()
    h, w = img.shape[:2]
    a, b = max(0, int(x0)), min(w, int(x1))
    if b - a < 2 * p.raio_min_px:
        return []
    cinza = cv2.medianBlur(cv2.cvtColor(img[:, a:b], cv2.COLOR_BGR2GRAY), 7)
    c = cv2.HoughCircles(cinza, cv2.HOUGH_GRADIENT, dp=1.2, minDist=1.6 * p.raio_min_px, param1=90, param2=40,
                         minRadius=p.raio_min_px, maxRadius=p.raio_max_px)
    if c is None:
        return []
    return [(float(x) + a, float(y), 2.0 * float(r)) for x, y, r in c[0] if y > TOPO_DA_BANCADA * h + 0.5 * r]


@dataclass(frozen=True)
class Grupo:
    cx: float
    cy: float
    d: float
    pontos: int
    caixas: int


def agrupar(pontos: list[Ponto], p: Parametros | None = None) -> list[Grupo]:
    """Os pontos pela posição: cada um entra no primeiro grupo cuja mediana está a menos de `junta` do diâmetro."""
    p = p or Parametros()
    grupos: list[list[Ponto]] = []
    for pt in pontos:
        for g in grupos:
            gx, gy, gd = (float(np.median([getattr(v, a) for v in g])) for a in ("cx", "cy", "d"))
            if abs(pt.cx - gx) < p.junta * gd and abs(pt.cy - gy) < p.junta * gd:
                g.append(pt)
                break
        else:
            grupos.append([pt])
    return [Grupo(*(float(np.median([getattr(v, a) for v in g])) for a in ("cx", "cy", "d")), len(g), sum(v.caixa for v in g))
            for g in grupos]


def metades_fortes(grupos: list[Grupo], p: Parametros | None = None) -> list[Grupo]:
    """As metades: vistas em `vistos_min` quadros ou mais, confirmadas pelo detector e com `forte` do maior grupo; de
    cima para baixo (e da esquerda para a direita)."""
    p = p or Parametros()
    validos = [g for g in grupos if g.pontos >= p.vistos_min and g.caixas >= 1]
    if not validos:
        return []
    maior = max(g.pontos for g in validos)
    return sorted((g for g in validos if g.pontos >= p.forte * maior), key=lambda g: (g.cy, g.cx))


def recorte(img: np.ndarray, m: MetadeVista, p: Parametros | None = None) -> np.ndarray:
    """A janela da metade no quadro, em resolução cheia (o recorte que se compara com os exemplos)."""
    p = p or Parametros()
    h, w = img.shape[:2]
    r = int(p.raio * m.d)
    cx, cy = int(m.cx), int(m.cy)
    return img[max(0, cy - r):min(h, cy + r), max(0, cx - r):min(w, cx + r)]


class _Metade:
    """A conta de uma metade, quadro a quadro (ver o cabeçalho do módulo)."""

    def __init__(self, k: int, g: Grupo, p: Parametros):
        self.k, self.cx, self.cy, self.d, self.p = k, g.cx, g.cy, g.d, p
        self.n = int(round(2 * p.raio * g.d * p.escala))  # o lado da janela, na escala da conta
        self.desde: datetime | None = None
        self.estado: tuple[np.ndarray, np.ndarray] | None = None  # (Lab, cinza) do último estado assentado
        self.anterior: np.ndarray | None = None  # o cinza do quadro anterior, no encaixe
        self.pendente: tuple[str, datetime, np.ndarray, np.ndarray] | None = None  # (quadro, hora, Lab, difere)
        self.antes: tuple[np.ndarray, np.ndarray, Passo] | None = None  # (Lab antes do último passo, máscara, o passo)
        self.papel_lab: np.ndarray | None = None
        self.passos: list[Passo] = []
        self.descartados: list[Passo] = []
        m = np.zeros((self.n, self.n), np.uint8)
        cv2.circle(m, (self.n // 2, self.n // 2), self.n // 2, 1, -1)
        self.disco = m.astype(bool)
        self.area = float(self.disco.sum())
        # O PAPEL em volta do pão: os cantos da janela, fora do disco e fora da cruz do meio (onde encostam os vizinhos).
        self.papel = ~self.disco
        t = self.n // 6
        self.papel[self.n // 2 - t:self.n // 2 + t, :] = False
        self.papel[:, self.n // 2 - t:self.n // 2 + t] = False

    def _janela(self, img: np.ndarray) -> np.ndarray | None:
        h, w = img.shape[:2]
        f = self.p.folga_px
        r = self.p.raio * self.d + f / self.p.escala
        x0, y0, x1, y1 = int(self.cx - r), int(self.cy - r), int(self.cx + r), int(self.cy + r)
        if x0 < 0 or y0 < 0 or x1 > w or y1 > h:
            return None
        lado = self.n + 2 * f
        return cv2.resize(img[y0:y1, x0:x1], (lado, lado), interpolation=cv2.INTER_AREA)

    @staticmethod
    def _encaixe(largo: np.ndarray, ref: np.ndarray) -> tuple[int, int]:
        """Onde a referência (n x n) cabe melhor no recorte com folga."""
        _, _, (x, y), _ = cv2.minMaxLoc(cv2.matchTemplate(largo, ref, cv2.TM_SQDIFF))
        return x, y

    def _luz(self, atual: np.ndarray, ref: np.ndarray) -> float:
        """Quanto a luz mudou: a diferença mediana no papel em volta do pão."""
        return float(np.median(atual[self.papel] - ref[self.papel]))

    def _papel_em(self, lab: np.ndarray, mascara: np.ndarray) -> float:
        if self.papel_lab is None or not mascara.any():
            return 0.0
        return float((np.sqrt(((lab[mascara] - self.papel_lab) ** 2).sum(axis=1)) < self.p.papel_de).mean())

    def descartar(self) -> None:
        """O pendente que o quadro parado seguinte não confirmou fica guardado: o último antes do fechamento pode ser a
        carne que entrou já no fim."""
        if self.pendente is None:
            return
        quadro, hora, lab, difere = self.pendente
        parte = float(difere.sum()) / self.area
        self.descartados.append(Passo(hora, self.k, "provisorio", round(parte, 3), round(self._papel_em(lab, difere), 2),
                                      quadro, difere))
        self.pendente = None

    def olhar(self, quadro: str, hora: datetime, img: np.ndarray) -> None:
        p, f, n = self.p, self.p.folga_px, self.n
        largo = self._janela(img)
        if largo is None:
            return
        cinza_l = cv2.cvtColor(largo, cv2.COLOR_BGR2GRAY).astype(np.float32)
        mexeu = None
        if self.anterior is not None:
            x, y = self._encaixe(cinza_l, self.anterior)
            atual = cinza_l[y:y + n, x:x + n]
            mexeu = float(np.abs(atual - self._luz(atual, self.anterior) - self.anterior)[self.disco].mean())
        parada = mexeu is not None and mexeu < p.quieto
        lab_l = cv2.cvtColor(cv2.GaussianBlur(largo, (3, 3), 0), cv2.COLOR_BGR2LAB).astype(np.float32)
        if self.estado is None:
            self.anterior = cinza_l[f:f + n, f:f + n]
            if parada:
                self.estado = (lab_l[f:f + n, f:f + n].copy(), cinza_l[f:f + n, f:f + n].copy())
                self.papel_lab = np.median(self.estado[0][self.papel], axis=0)
                self.passos.append(Passo(hora, self.k, "comeco", 1.0, None, quadro))
            return
        # o encaixe no estado assentado: onde o pão está agora (empurrado ou não); a janela não anda (ERR-137)
        x, y = self._encaixe(cinza_l, self.estado[1])
        lab = lab_l[y:y + n, x:x + n].copy()
        cinza = cinza_l[y:y + n, x:x + n]
        lab[..., 0] -= self._luz(lab[..., 0], self.estado[0][..., 0])
        self.anterior = cinza
        difere = (np.sqrt(((lab - self.estado[0]) ** 2).sum(axis=2)) > p.delta) & self.disco
        difere = cv2.morphologyEx(difere.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)).astype(bool)
        if not parada:
            return
        if self.pendente is not None:
            quadro_p, hora_p, lab_p, difere_p = self.pendente
            chegou = difere_p & difere & (np.sqrt(((lab - lab_p) ** 2).sum(axis=2)) < p.estavel)
            parte = float(chegou.sum()) / self.area
            if parte < p.minimo:
                self.descartar()
            else:
                passo = Passo(hora_p, self.k, "passo", round(parte, 3), round(self._papel_em(lab, chegou), 2), quadro, chegou)
                if self.antes is not None:
                    lab_antes, masc_antes, anterior = self.antes
                    junto = chegou & masc_antes
                    if anterior.tipo == "passo" and junto.sum() >= 0.5 * chegou.sum():
                        voltou = np.sqrt(((lab[junto] - lab_antes[junto]) ** 2).sum(axis=1)) < p.voltou_de
                        if float(voltou.mean()) >= p.voltou_parte:
                            anterior.tipo = passo.tipo = "transitorio"
                self.passos.append(passo)
                self.antes = (self.estado[0].copy(), chegou, passo)
                self.estado = (np.where(chegou[..., None], lab, self.estado[0]),
                               np.where(chegou, cinza, self.estado[1]).astype(np.float32))
                difere = difere & ~chegou
                self.pendente = None
        self.pendente = (quadro, hora, lab, difere) if float(difere.sum()) / self.area >= p.minimo else None


@dataclass
class PassosDoLanche:
    """Os passos de UM lanche. Enquanto o lugar vive, `ver` a cada quadro (o que se viu de pão na faixa dele); no fim,
    `ler` abre os quadros de novo, na ordem, e devolve as metades e os passos."""

    p: Parametros = field(default_factory=Parametros)
    quadros: list[tuple[str, datetime]] = field(default_factory=list)
    pontos: list[Ponto] = field(default_factory=list)

    def ver(self, quadro: str, hora: datetime, img: np.ndarray, caixas: list[tuple], x0: float, x1: float,
            achados: list[tuple[float, float, float]] | None = None) -> None:
        """Um quadro do lugar: as caixas do detector (x0, y0, x1, y1, ...) com o centro na faixa [x0, x1] e os discos
        de pão da faixa (`achados`, quando quem chama já os tem)."""
        self.quadros.append((quadro, hora))
        for c in caixas:
            cx = (c[0] + c[2]) / 2
            if x0 <= cx <= x1:
                self.pontos.append(Ponto(quadro, cx, (c[1] + c[3]) / 2, ((c[2] - c[0]) + (c[3] - c[1])) / 2, True))
        for cx, cy, d in (discos(img, x0, x1, self.p) if achados is None else achados):
            self.pontos.append(Ponto(quadro, cx, cy, d, False))

    def ler(self, abrir: Callable[[str], np.ndarray | None]) -> Leitura:
        p = self.p
        metades = [_Metade(k + 1, g, p) for k, g in enumerate(metades_fortes(agrupar(self.pontos, p), p))]
        nomes = [q for q, _ in self.quadros]
        for m in metades:
            perto = {pt.quadro for pt in self.pontos if abs(pt.cx - m.cx) < p.perto * m.d and abs(pt.cy - m.cy) < p.perto * m.d}
            i = next((i for i, q in enumerate(nomes) if q in perto and any(o in perto for o in nomes[i + 1:i + 3])), None)
            m.desde = self.quadros[i][1] if i is not None else None
        if metades:
            for quadro, hora in self.quadros:
                vivas = [m for m in metades if m.desde is not None and hora >= m.desde]
                if not vivas:
                    continue
                img = abrir(quadro)
                if img is None:
                    continue
                for m in vivas:
                    m.olhar(quadro, hora, img)
        for m in metades:
            m.descartar()  # o pendente do fim, que ficou sem o quadro seguinte
        fechou = self._fechar(metades)
        passos = sorted((ps for m in metades for ps in m.passos), key=lambda s: (s.hora, s.metade))
        return Leitura([MetadeVista(m.k, m.cx, m.cy, m.d, m.desde) for m in metades], passos, fechou)

    def _fechar(self, metades: list[_Metade]) -> datetime | None:
        """O primeiro passo cujo conteúdo novo é papel fecha o lanche; antes dele, o provisório de cada outra metade;
        depois dele, nada conta."""
        p = self.p
        candidatos = sorted((ps for m in metades for ps in m.passos if ps.tipo == "passo"), key=lambda s: (s.hora, s.metade))
        fecho = next((s for s in candidatos if s.parte >= p.fechou_parte and (s.papel or 0.0) >= p.fechou_papel), None)
        if fecho is None:
            return None
        fecho.tipo = "fechou"
        for m in metades:
            if m.k != fecho.metade:
                # o último passo de ANTES do fechamento (a tampa que chega na base no mesmo segundo não conta)
                ultimo = max((s.hora for s in m.passos if s.tipo in ("comeco", "passo") and s.hora < fecho.hora), default=None)
                # só o ÚLTIMO pendente antes do fechamento — o que estava na metade quando a tampa veio —, se for grande e
                # não for papel (no P7, a sobra da junção das peças às 21:10:43 era o último, com 36%: nada)
                cands = [d for d in m.descartados if (ultimo is None or d.hora > ultimo) and d.hora < fecho.hora]
                if cands and cands[-1].parte >= p.provisorio_min and (cands[-1].papel or 0.0) < p.provisorio_papel:
                    m.passos.append(cands[-1])
            m.passos = [s for s in m.passos if s.tipo in ("comeco", "fechou") or s.hora < fecho.hora]
        return fecho.hora
