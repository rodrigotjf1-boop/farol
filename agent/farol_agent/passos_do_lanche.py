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
   2b. **A JANELA QUE SEGUE** (05/11/2026, a chave `FAROL_BANCADA_JANELA_SEGUE`). O dono: "a janela não pode ficar fixa
   no lugar, tem que acompanhar como um detector humano: forma um retângulo e acompanha seus movimentos". Medido nas
   noites de 02 a 04/11: a janela fixa nasce centrada (o pão a 0,06 diâmetro do centro, na mediana), mas em 10% das
   metades o pão escorrega 0,30 diâmetro ou mais durante o lanche ("só a ponta do hambúrguer aparece"); e o lanche
   empurrado além da folga puxa a mediana para o MEIO do caminho (a janela fica torta antes e depois). Então: a janela
   nasce onde o pão estava nos primeiros quadros da metade, e anda só quando a peça inteira, parada, está a mais que a
   folga do lugar — achada pela correlação do último estado assentado (o que já chegou junto), nunca o encaixe de cada
   quadro (o ERR-137). A peça que andou para onde outra metade nasceu é a mesma: a de depois sai.
   2c. **AS METADES FANTASMAS** (06/11/2026, a chave `FAROL_BANCADA_SEM_FANTASMA`). O dono: "a organização dos pães na
   bancada já dá a dimensão de quantos serão produzidos". Mas, numa folha de 51 lugares das noites de 04 e 05/11, a
   metade a mais quase nunca era o pão do vizinho: era o MESMO pão contado duas vezes (o `agrupar` parte os discos dele
   em dois grupos, a meio diâmetro um do outro) ou um círculo no alumínio vazio ao lado. Cada ponto guarda a cor do
   miolo (o croma, `miolo` do diâmetro em volta do centro) e cada metade, o quanto MOSTROU pão: o maior croma mediano em
   `janela_pao` pontos seguidos — o pão de verdade mostra a cor dele em algum momento (antes do ingrediente, ou quando a
   mão ou a grelha sai de cima); o círculo no alumínio, nunca. Com a chave: duas metades a menos de `mesmo_pao` diâmetro
   são uma só (fica a que mais mostrou pão), e a que nunca mostrou pão (abaixo de `cor_do_pao`) sai — nunca todas. O
   quanto mostrou pão vai sempre para o `passos.json` (com a chave desligada também), para medir a régua nas noites
   conferidas antes de ligá-la.
3. **PARADA**: |Δcinza| médio no disco abaixo de `quieto`, contra o quadro anterior, com a luz corrigida pelo papel em
   volta do pão (a sombra de quem chega, a luz do salão). Medido no L9: parado 1,9 a 8,9; com a mão, 9,2 a 40.
4. **Um PASSO**: o que difere do último estado assentado (ΔE > `delta`) em DOIS quadros parados seguidos e não mudou
   entre eles, em `minimo` do disco ou mais — a mão que pousou e saiu volta ao que era e não conta.
5. **A PASSAGEM**: o passo que devolve o que havia antes do passo anterior desfaz os dois (o braço apoiado parado dois
   quadros, R2 de 00:05:01).
6. **O FECHAMENTO**: o primeiro passo cujo conteúdo novo é o PAPEL em volta — a tampa saiu de cima da metade dela. Depois
   dele, nada conta (o embrulho). Antes dele, o último pendente não confirmado de cada outra metade vira um passo
   PROVISÓRIO: a carne que entra no fim fica parada um quadro só (o frango do L9).
7. **O JUIZ DE INGREDIENTE** (quando há: `juizes.ingrediente`, a base da loja). O dono, 21/10/2026: "o recorte tem
   sempre que ser focado em ingredientes, de preferência os cadastrados". Na primeira noite ao vivo, 35 de 112 passos
   eram de janela SEM ingrediente — quase todos a peça indo embora (embrulhada, fechada na caixa ou levada: a janela
   fixa passa a ver o inox, o alumínio, a tampa) e alguns de peça que não era pão. Então:
   - a metade cujo COMEÇO não parece comida nenhuma (nem pão: nota abaixo de `comeco_min`) não é peça do lanche — sai
     (o pano escuro do L33: 0,24; o queijo da metade que já chegou carregada fica: 0,42);
   - o passo que não parece ingrediente não conta (`vazio`); se ele tomou `saiu_parte` da janela ou mais, com a nota
     bem abaixo da de comida (`saiu_nota`), a peça SAIU dela, e nada depois conta (`saiu`: o fim da metade — é também o
     fechamento no alumínio e na caixa, que a cor do papel não pega).
   Cada passo leva o nome do ingrediente mais parecido que não é pão (o pão sai das peças) e a nota do juiz. Com o PÃO
   NO PASSO (o juiz treinado com `FAROL_BANCADA_PAO_NO_PASSO`, 05/11/2026): o passo em que o juiz vê pão bem acima do
   melhor ingrediente (a tampa que chega por cima, a metade puxada — 71 de 336 passos respondidos em 02 e 03/11) não
   conta: sai como `vazio`, com o nome do pão. Com o NÃO É INGREDIENTE no juiz (`FAROL_BANCADA_NADA_NO_JUIZ`, 05/11):
   o passo que o juiz põe na classe dos exemplos "não era ingrediente" do dono (o alumínio, o inox, a mão — 125 de 461
   passos contados e respondidos em 02 e 03/11) também sai como `vazio`.

O que este módulo entrega: a hora, a metade, a parte do disco, quanto do que chegou é papel, o quadro e a máscara — e,
com o juiz, o nome e a nota.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import datetime
from typing import Callable, Protocol

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
    # O juiz de ingrediente (o 7 do cabeçalho): a menor nota do começo de uma peça do lanche; a parte da janela e a nota
    # abaixo da qual o passo sem ingrediente quer dizer que a peça saiu dela. A margem até a nota de comida (0,48) é de
    # propósito: o "saiu" corta o resto da metade. Medido: nos passos grandes da noite de 20-21/10, os sem ingrediente de
    # 0,28 a 0,45 (um em 0,451) e os com comida de 0,51 para cima; em 18/10, a base do P7 com ovo, queijo e alface em
    # 0,477 (fica vazio, e o resto da metade é julgado passo a passo).
    comeco_min: float = 0.35
    saiu_parte: float = 0.50
    saiu_nota: float = 0.45
    # A JANELA QUE SEGUE (o 2b do cabeçalho; a chave `FAROL_BANCADA_JANELA_SEGUE`, desligada por padrão): a janela nasce
    # na mediana dos pontos dos primeiros `nasce_quadros` quadros da metade (não na do lanche inteiro) e anda com a peça
    # quando ela, PARADA, aparece inteira a mais que a folga do lugar: a busca vai até `busca` diâmetros e a correlação
    # da peça inteira (o último estado assentado) tem de dar `segue_ncc` ou mais. A mesma peça vista de novo no lugar novo
    # (a menos de `mesma_peca` diâmetro da janela que andou) não é outra metade.
    segue: bool = False
    nasce_quadros: int = 5
    busca: float = 1.0
    segue_ncc: float = 0.70
    mesma_peca: float = 0.5
    # quando procurar: a mudança contra o estado assentado em `segue_parte` da janela ou mais (a correlação da peça no
    # lugar abaixo de `segue_ncc` decide em `_onde_andou`). Para onde a janela pode ir: dentro da faixa do lugar, num
    # ponto onde não se via pão ANTES de a peça sumir, e não para cima de uma metade que já existia antes (o vizinho
    # parecido: a janela não pula para ele)
    segue_parte: float = 0.15
    # AS METADES FANTASMAS (o 2c do cabeçalho; a chave `FAROL_BANCADA_SEM_FANTASMA`, desligada por padrão). A cor do miolo
    # de cada ponto: o croma médio (Lab do OpenCV) no disco de `miolo` do diâmetro; o quanto a metade mostrou pão: o maior
    # croma mediano em `janela_pao` pontos seguidos. Medido na folha de 04 e 05/11 (121 metades marcadas a olho, uma vez;
    # `docs/decisoes.md`, 06/11): o pão, 43 na mediana; a fantasma, 26. Com a chave: a menos de `mesmo_pao` diâmetro é o
    # mesmo pão (fica um), e abaixo de `cor_do_pao` não é pão (sai).
    sem_fantasma: bool = False
    miolo: float = 0.3
    janela_pao: int = 8
    mesmo_pao: float = 0.7
    cor_do_pao: float = 24.0


class Julgado(Protocol):
    """O que o juiz de ingrediente diz de um recorte (`juizes.ingrediente.Nota`)."""

    nome: str | None
    nota: float
    ingrediente: str | None

    def comida(self) -> bool: ...


Juiz = Callable[[np.ndarray], Julgado]


@dataclass(frozen=True)
class Ponto:
    """Um pão visto num quadro: o centro e o diâmetro, se foi o detector (caixa) ou o Hough (disco) e a cor do miolo
    naquele quadro (`croma_do_miolo`; nula quando não se mediu)."""

    quadro: str
    cx: float
    cy: float
    d: float
    caixa: bool
    croma: float | None = None


@dataclass
class Passo:
    """O que aconteceu numa metade. `tipo`: comeco (o primeiro estado parado: o pão, ou o pão que já chegou carregado),
    passo, provisorio, transitorio (a passagem: não conta), fechou, e — com o juiz de ingrediente — vazio (a janela sem
    ingrediente: não conta) e saiu (a peça saiu da janela: o fim da metade). `parte`: do disco da JANELA (`raio` do
    diâmetro do pão, que pega o que passa da borda — a fatia de queijo inteira no pão é ~0,4 dele); `papel`: do que
    chegou, quanto é papel; `quadro`: onde o que chegou aparece (o recorte); `mascara`: o que chegou, na janela da
    metade, na escala da conta; `nome` e `nota`: o que o juiz viu na janela (o ingrediente mais parecido que não é pão —
    no começo, o mais parecido de todos — e a nota da comida)."""

    hora: datetime
    metade: int
    tipo: str
    parte: float
    papel: float | None
    quadro: str
    mascara: np.ndarray | None = None
    nome: str | None = None
    nota: float | None = None
    # onde a janela estava neste passo (a janela que segue anda com a peça); nulo = onde a metade nasceu
    cx: float | None = None
    cy: float | None = None


@dataclass(frozen=True)
class MetadeVista:
    k: int
    cx: float
    cy: float
    d: float
    desde: datetime | None
    # o quanto a metade mostrou pão (`mostrou_pao`); nulo sem cor medida
    pao: float | None = None


@dataclass
class Leitura:
    metades: list[MetadeVista]
    # Na ordem da hora (e da metade); os de depois do fechamento já saíram.
    passos: list[Passo]
    fechou: datetime | None
    # com `sem_fantasma`: as metades que saíram por serem fantasmas (sem passos; `k` 0)
    fantasmas: list[MetadeVista] = field(default_factory=list)


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


def croma_do_miolo(img: np.ndarray, cx: float, cy: float, d: float, p: Parametros | None = None) -> float | None:
    """A cor do miolo do pão visto (o 2c do cabeçalho): o croma médio — a distância do cinza no Lab do OpenCV — no disco
    de `miolo` do diâmetro em volta do centro. O pão é amarelado; o alumínio e o inox, cinzas. Nulo fora do quadro."""
    p = p or Parametros()
    h, w = img.shape[:2]
    r = max(4, int(p.miolo * d))
    # presos em 0 ANTES de fatiar: o numpy conta o começo negativo do fim (V131)
    x0, y0, x1, y1 = max(0, int(cx - r)), max(0, int(cy - r)), min(w, int(cx + r)), min(h, int(cy + r))
    if x1 <= x0 or y1 <= y0:
        return None
    yy, xx = np.mgrid[y0:y1, x0:x1]
    dentro = (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r
    if not dentro.any():
        return None
    lab = cv2.cvtColor(img[y0:y1, x0:x1], cv2.COLOR_BGR2LAB).astype(np.float32)
    return float(np.hypot(lab[..., 1][dentro] - 128.0, lab[..., 2][dentro] - 128.0).mean())


def mostrou_pao(cromas: list[float], janela: int) -> float | None:
    """O quanto a metade MOSTROU pão: o maior croma mediano em `janela` pontos seguidos, na ordem do tempo (com menos
    pontos, a mediana deles). O pão de verdade mostra a cor dele em algum momento; o círculo no alumínio, nunca. Nulo sem
    nenhum ponto com cor."""
    if not cromas:
        return None
    if len(cromas) <= janela:
        return float(np.median(cromas))
    return max(float(np.median(cromas[i:i + janela])) for i in range(len(cromas) - janela + 1))


@dataclass(frozen=True)
class Grupo:
    cx: float
    cy: float
    d: float
    pontos: int
    caixas: int
    # o quanto mostrou pão (`mostrou_pao`); nulo sem cor medida
    pao: float | None = None


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
    return [Grupo(*(float(np.median([getattr(v, a) for v in g])) for a in ("cx", "cy", "d")), len(g), sum(v.caixa for v in g),
                  mostrou_pao([v.croma for v in g if v.croma is not None], p.janela_pao))
            for g in grupos]


def sem_fantasmas(grupos: list[Grupo], p: Parametros | None = None) -> list[Grupo]:
    """As metades sem as FANTASMAS (o 2c do cabeçalho): duas a menos de `mesmo_pao` do diâmetro (o mediano do lugar) são
    o mesmo pão — fica a que mais mostrou pão (empate: a de mais pontos); depois, a que nunca mostrou pão (abaixo de
    `cor_do_pao`) sai — mas nunca todas: sem nenhuma com pão, fica a que mais mostrou. A metade sem cor medida não é
    julgada pela cor."""
    p = p or Parametros()
    if not grupos:
        return []
    d = sorted(g.d for g in grupos)[len(grupos) // 2]
    ficam: list[Grupo] = []
    for g in sorted(grupos, key=lambda g: (-(g.pao if g.pao is not None else -1.0), -g.pontos)):
        if all(float(np.hypot(g.cx - f.cx, g.cy - f.cy)) >= p.mesmo_pao * d for f in ficam):
            ficam.append(g)
    com_pao = [g for g in ficam if g.pao is None or g.pao >= p.cor_do_pao]
    return com_pao or ficam[:1]


def metades_fortes(grupos: list[Grupo], p: Parametros | None = None) -> list[Grupo]:
    """As metades: vistas em `vistos_min` quadros ou mais, confirmadas pelo detector e com `forte` do maior grupo — e,
    com `sem_fantasma`, sem as fantasmas; de cima para baixo (e da esquerda para a direita)."""
    p = p or Parametros()
    validos = [g for g in grupos if g.pontos >= p.vistos_min and g.caixas >= 1]
    if not validos:
        return []
    maior = max(g.pontos for g in validos)
    fortes = [g for g in validos if g.pontos >= p.forte * maior]
    if p.sem_fantasma:
        fortes = sem_fantasmas(fortes, p)
    return sorted(fortes, key=lambda g: (g.cy, g.cx))


def recorte(img: np.ndarray, m: MetadeVista, p: Parametros | None = None) -> np.ndarray:
    """A janela da metade no quadro, em resolução cheia (o recorte que se compara com os exemplos)."""
    p = p or Parametros()
    h, w = img.shape[:2]
    r = int(p.raio * m.d)
    cx, cy = int(m.cx), int(m.cy)
    return img[max(0, cy - r):min(h, cy + r), max(0, cx - r):min(w, cx + r)]


def janela_do_passo(s: "Passo", k: int, cx: float, cy: float, d: float, desde: datetime | None) -> MetadeVista:
    """A janela da metade NO PASSO: onde ela estava naquela hora (a janela que segue anda com a peça), ou onde a metade
    nasceu — o recorte de cada passo sai dela."""
    return MetadeVista(k, s.cx if s.cx is not None else cx, s.cy if s.cy is not None else cy, d, desde)


class _Metade:
    """A conta de uma metade, quadro a quadro (ver o cabeçalho do módulo)."""

    def __init__(self, k: int, g: Grupo, p: Parametros):
        self.k, self.cx, self.cy, self.d, self.p = k, g.cx, g.cy, g.d, p
        self.pao = g.pao  # o quanto mostrou pão (vai para o `passos.json`)
        # onde a janela nasceu (a janela que segue anda; a metade continua dita pelo lugar onde nasceu)
        self.cx0, self.cy0 = g.cx, g.cy
        self.n = int(round(2 * p.raio * g.d * p.escala))  # o lado da janela, na escala da conta
        self.desde: datetime | None = None
        # a janela que segue: quantas vezes andou, a última vez que a peça foi vista no lugar, e se esta metade é a mesma
        # peça de outra que andou até aqui (sai da leitura)
        self.andou = 0
        self.vista_em: datetime | None = None
        self.mesma_de: int | None = None
        # quem pergunta se o lugar novo é de outra metade, e se a janela pode ir até ele (postos pelo `PassosDoLanche.ler`)
        self.outra_em: Callable[[_Metade, float, float], _Metade | None] | None = None
        self.pode_ir: Callable[[_Metade, float, float], bool] | None = None
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
        quadro, hora, lab, difere, cx, cy = self.pendente
        parte = float(difere.sum()) / self.area
        self.descartados.append(Passo(hora, self.k, "provisorio", round(parte, 3), round(self._papel_em(lab, difere), 2),
                                      quadro, difere, cx=cx, cy=cy))
        self.pendente = None

    def _onde_andou(self, img: np.ndarray, cinza_l: np.ndarray) -> tuple[float, float] | None:
        """A janela que segue (o 2b do cabeçalho): a peça inteira — o último estado assentado — achada em volta, a mais
        que a folga e até `busca` diâmetros para cada lado, com a correlação de `segue_ncc` ou mais. Nulo quando ela ainda
        está no lugar (a correlação dentro da folga já é boa: a fatia que chegou não a tira dali, nem um pedaço parecido
        em volta) ou quando não se acha com certeza. (Achada a mais que a folga é certo: dentro dela, na mesma escala, a
        busca de perto já teria achado a mesma correlação.)"""
        p, n = self.p, self.n
        aqui = float(cv2.minMaxLoc(cv2.matchTemplate(cinza_l, self.estado[1], cv2.TM_CCOEFF_NORMED))[1])
        if aqui >= p.segue_ncc:
            return None
        h, w = img.shape[:2]
        r = p.raio * self.d + p.busca * self.d
        # V131: prender em 0 e na borda ANTES de fatiar
        x0, y0 = max(0, int(self.cx - r)), max(0, int(self.cy - r))
        x1, y1 = min(w, int(self.cx + r)), min(h, int(self.cy + r))
        if (x1 - x0) * p.escala < n + 2 or (y1 - y0) * p.escala < n + 2:
            return None
        regiao = cv2.resize(img[y0:y1, x0:x1], (int((x1 - x0) * p.escala), int((y1 - y0) * p.escala)),
                            interpolation=cv2.INTER_AREA)
        cinza_r = cv2.cvtColor(regiao, cv2.COLOR_BGR2GRAY).astype(np.float32)
        _, ncc, _, (bx, by) = cv2.minMaxLoc(cv2.matchTemplate(cinza_r, self.estado[1], cv2.TM_CCOEFF_NORMED))
        if ncc < p.segue_ncc:
            return None
        return x0 + (bx + n / 2) / p.escala, y0 + (by + n / 2) / p.escala

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
                self.passos.append(Passo(hora, self.k, "comeco", 1.0, None, quadro, cx=self.cx, cy=self.cy))
                self.vista_em = hora
            return
        # o encaixe no estado assentado: onde o pão está agora (empurrado ou não); a janela não anda com o encaixe (ERR-137)
        x, y = self._encaixe(cinza_l, self.estado[1])
        lab = lab_l[y:y + n, x:x + n].copy()
        cinza = cinza_l[y:y + n, x:x + n]
        lab[..., 0] -= self._luz(lab[..., 0], self.estado[0][..., 0])
        difere = (np.sqrt(((lab - self.estado[0]) ** 2).sum(axis=2)) > p.delta) & self.disco
        difere = cv2.morphologyEx(difere.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)).astype(bool)
        # a janela que segue: parada e a peça não está mais inteira no lugar — procura a peça inteira em volta; achada
        # num lugar onde ela pode ir (`pode_ir`: na faixa, e vazio antes de ela sumir — ou com a mesma peça vista de
        # novo depois), a janela anda até ela
        if p.segue and parada and float(difere.sum()) / self.area >= p.segue_parte:
            novo = self._onde_andou(img, cinza_l)
            if novo is not None and self.pode_ir is not None and not self.pode_ir(self, *novo):
                novo = None
            outra = self.outra_em(self, *novo) if novo is not None and self.outra_em is not None else None
            if novo is not None and (outra is None or (outra.desde is not None and self.vista_em is not None
                                                       and outra.desde > self.vista_em)):
                if outra is not None:
                    outra.mesma_de = self.k  # a mesma peça, vista de novo no lugar novo: aquela metade sai
                self.cx, self.cy = novo
                self.andou += 1
                # o que estava pendente e a passagem eram do lugar de antes
                self.pendente, self.antes = None, None
                largo = self._janela(img)
                if largo is None:
                    return
                cinza_l = cv2.cvtColor(largo, cv2.COLOR_BGR2GRAY).astype(np.float32)
                lab_l = cv2.cvtColor(cv2.GaussianBlur(largo, (3, 3), 0), cv2.COLOR_BGR2LAB).astype(np.float32)
                x, y = self._encaixe(cinza_l, self.estado[1])
                lab = lab_l[y:y + n, x:x + n].copy()
                cinza = cinza_l[y:y + n, x:x + n]
                lab[..., 0] -= self._luz(lab[..., 0], self.estado[0][..., 0])
                difere = (np.sqrt(((lab - self.estado[0]) ** 2).sum(axis=2)) > p.delta) & self.disco
                difere = cv2.morphologyEx(difere.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)).astype(bool)
        self.anterior = cinza
        if not parada:
            return
        if float(difere.sum()) / self.area < p.minimo:
            self.vista_em = hora
        if self.pendente is not None:
            quadro_p, hora_p, lab_p, difere_p, cx_p, cy_p = self.pendente
            chegou = difere_p & difere & (np.sqrt(((lab - lab_p) ** 2).sum(axis=2)) < p.estavel)
            parte = float(chegou.sum()) / self.area
            if parte < p.minimo:
                self.descartar()
            else:
                passo = Passo(hora_p, self.k, "passo", round(parte, 3), round(self._papel_em(lab, chegou), 2), quadro, chegou,
                              cx=cx_p, cy=cy_p)
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
        self.pendente = (quadro, hora, lab, difere, self.cx, self.cy) if float(difere.sum()) / self.area >= p.minimo else None


class _Olhar:
    """O juiz de ingrediente sobre a janela das metades (o 7 do cabeçalho). O quadro aberto por último fica à mão: as
    metades de um mesmo passo olham o mesmo quadro."""

    def __init__(self, abrir: Callable[[str], np.ndarray | None], juiz: Juiz, p: Parametros) -> None:
        self.abrir, self.juiz, self.p = abrir, juiz, p
        self._quadro: str | None = None
        self._img: np.ndarray | None = None

    def _julgar(self, s: Passo, m: _Metade) -> Julgado | None:
        if s.quadro != self._quadro:
            self._quadro, self._img = s.quadro, self.abrir(s.quadro)
        if self._img is None:
            return None
        corte = recorte(self._img, janela_do_passo(s, m.k, m.cx0, m.cy0, m.d, m.desde), self.p)
        if corte.shape[0] < 8 or corte.shape[1] < 8:
            return None
        return self.juiz(corte)

    def peca(self, m: _Metade) -> bool:
        """A metade é peça do lanche? O começo dela parece comida: o pão, ou o pão que já chegou carregado. Sem começo
        (a metade nunca parou) ou sem o quadro, fica como está."""
        comeco = next((s for s in m.passos if s.tipo == "comeco"), None)
        if comeco is None:
            return True
        j = self._julgar(comeco, m)
        if j is None:
            return True
        comeco.nome, comeco.nota = j.nome, j.nota
        return j.nota >= self.p.comeco_min

    def passos(self, m: _Metade) -> None:
        """Os passos e os provisórios da metade, na ordem: o que não parece ingrediente não conta; o que tomou a janela
        sem ingrediente é a peça saindo dela, e o que vem depois sai da lista."""
        saiu: datetime | None = None
        for s in sorted(m.passos, key=lambda s: s.hora):
            if s.tipo not in ("passo", "provisorio"):
                continue
            j = self._julgar(s, m)
            if j is None:
                continue
            s.nome, s.nota = j.ingrediente, j.nota
            if j.comida():
                # o NÃO É INGREDIENTE (com a chave, `juizes.treinado.FOLGA_DO_NADA`): o alumínio, o inox, a mão que o
                # dono ensinou — não conta; sai como vazio, com o ingrediente mais parecido (o que o juiz leu)
                if getattr(j, "nada", False):
                    s.tipo = "vazio"
                    continue
                # o PÃO no passo (com a chave, `juizes.treinado.FOLGA_DO_PAO`): a tampa que chegou, a metade puxada — não
                # é ingrediente; sai como vazio, com o nome do pão (a conferência mostra o que o juiz leu)
                pao = getattr(j, "pao", None)
                if pao:
                    s.tipo, s.nome = "vazio", pao
                continue
            if s.parte >= self.p.saiu_parte and j.nota < self.p.saiu_nota:
                s.tipo, saiu = "saiu", s.hora
                break
            s.tipo = "vazio"
        if saiu is not None:
            # o fechamento fica: é o do lanche (`Leitura.fechou`), mesmo quando a peça desta metade já tinha saído
            m.passos = [s for s in m.passos if s.tipo in ("comeco", "fechou") or s.hora <= saiu]


@dataclass
class PassosDoLanche:
    """Os passos de UM lanche. Enquanto o lugar vive, `ver` a cada quadro (o que se viu de pão na faixa dele); no fim,
    `ler` abre os quadros de novo, na ordem, e devolve as metades e os passos."""

    p: Parametros = field(default_factory=Parametros)
    quadros: list[tuple[str, datetime]] = field(default_factory=list)
    pontos: list[Ponto] = field(default_factory=list)
    # a faixa do lugar (a maior vista): a janela que segue não sai dela
    faixa: tuple[float, float] | None = None

    def ver(self, quadro: str, hora: datetime, img: np.ndarray, caixas: list[tuple], x0: float, x1: float,
            achados: list[tuple[float, float, float]] | None = None) -> None:
        """Um quadro do lugar: as caixas do detector (x0, y0, x1, y1, ...) com o centro na faixa [x0, x1] e os discos
        de pão da faixa (`achados`, quando quem chama já os tem); cada um com a cor do miolo neste quadro."""
        self.quadros.append((quadro, hora))
        self.faixa = (x0, x1) if self.faixa is None else (min(self.faixa[0], x0), max(self.faixa[1], x1))
        for c in caixas:
            cx = (c[0] + c[2]) / 2
            if x0 <= cx <= x1:
                cy, d = (c[1] + c[3]) / 2, ((c[2] - c[0]) + (c[3] - c[1])) / 2
                self.pontos.append(Ponto(quadro, cx, cy, d, True, croma_do_miolo(img, cx, cy, d, self.p)))
        for cx, cy, d in (discos(img, x0, x1, self.p) if achados is None else achados):
            self.pontos.append(Ponto(quadro, cx, cy, d, False, croma_do_miolo(img, cx, cy, d, self.p)))

    def ler(self, abrir: Callable[[str], np.ndarray | None], juiz: Juiz | None = None) -> Leitura:
        """As metades e os passos. Com o `juiz` de ingrediente, o 7 do cabeçalho: a peça que não é comida sai antes do
        fechamento (o passo dela não fecha o lanche), e os passos sem ingrediente saem depois dele."""
        p = self.p
        grupos = agrupar(self.pontos, p)
        fortes = metades_fortes(grupos, p)
        # com `sem_fantasma`, as que saíram ficam ditas na leitura (para conferir a régua na loja)
        fantasmas = [MetadeVista(0, g.cx, g.cy, g.d, None, g.pao)
                     for g in metades_fortes(grupos, replace(p, sem_fantasma=False)) if g not in fortes] if p.sem_fantasma else []
        metades = [_Metade(k + 1, g, p) for k, g in enumerate(fortes)]
        nomes = [q for q, _ in self.quadros]
        for m in metades:
            perto = {pt.quadro for pt in self.pontos if abs(pt.cx - m.cx) < p.perto * m.d and abs(pt.cy - m.cy) < p.perto * m.d}
            i = next((i for i, q in enumerate(nomes) if q in perto and any(o in perto for o in nomes[i + 1:i + 3])), None)
            m.desde = self.quadros[i][1] if i is not None else None
            if p.segue and i is not None:
                # a janela que segue nasce onde o pão estava nos primeiros quadros da metade — a mediana do lanche inteiro
                # cai no meio do caminho quando ele é empurrado
                primeiros = set(nomes[i:i + p.nasce_quadros])
                pts = [pt for pt in self.pontos if pt.quadro in primeiros
                       and abs(pt.cx - m.cx) < p.junta * m.d and abs(pt.cy - m.cy) < p.junta * m.d]
                if pts:
                    m.cx = m.cx0 = float(np.median([pt.cx for pt in pts]))
                    m.cy = m.cy0 = float(np.median([pt.cy for pt in pts]))
        if p.segue:
            def outra_em(quem: _Metade, cx: float, cy: float) -> _Metade | None:
                """A metade (outra) onde a janela que andou foi parar: a mesma peça vista de novo, ou um vizinho."""
                return next((o for o in metades if o is not quem and o.mesma_de is None and o.desde is not None
                             and float(np.hypot(o.cx - cx, o.cy - cy)) < p.mesma_peca * max(o.d, quem.d)), None)

            hora_de = dict(self.quadros)

            def pode_ir(quem: _Metade, cx: float, cy: float) -> bool:
                """Na faixa do lugar, e sem pão visto ali ANTES de a peça sumir (fora os pontos dela mesma, no lugar de
                antes): o vizinho parecido estava lá. Não basta perguntar à metade de lá (`outra_em`): ela pode ter andado
                antes, atrás do papel empurrado, e deixado o lugar — o que conta é o que se viu ali."""
                if self.faixa is not None and not self.faixa[0] <= cx <= self.faixa[1]:
                    return False
                ate, ocupa, dela = quem.vista_em, p.perto * quem.d, p.junta * quem.d
                if ate is None:
                    return False
                for pt in self.pontos:
                    h = hora_de.get(pt.quadro)
                    if h is None or h > ate:
                        continue
                    if abs(pt.cx - quem.cx) < dela and abs(pt.cy - quem.cy) < dela:
                        continue
                    if abs(pt.cx - cx) < ocupa and abs(pt.cy - cy) < ocupa:
                        return False
                return True

            for m in metades:
                m.outra_em, m.pode_ir = outra_em, pode_ir
        if metades:
            for quadro, hora in self.quadros:
                vivas = [m for m in metades if m.desde is not None and hora >= m.desde and m.mesma_de is None]
                if not vivas:
                    continue
                img = abrir(quadro)
                if img is None:
                    continue
                for m in vivas:
                    if m.mesma_de is None:
                        m.olhar(quadro, hora, img)
        # a metade que era a mesma peça de outra que andou até ela sai da leitura (com os passos dela)
        metades = [m for m in metades if m.mesma_de is None]
        for m in metades:
            m.descartar()  # o pendente do fim, que ficou sem o quadro seguinte
        olhar = _Olhar(abrir, juiz, p) if juiz is not None else None
        if olhar is not None:
            metades = [m for m in metades if olhar.peca(m)]
        fechou = self._fechar(metades)
        if olhar is not None:
            for m in metades:
                olhar.passos(m)
        passos = sorted((ps for m in metades for ps in m.passos), key=lambda s: (s.hora, s.metade))
        return Leitura([MetadeVista(m.k, m.cx0, m.cy0, m.d, m.desde, m.pao) for m in metades], passos, fechou, fantasmas)

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
