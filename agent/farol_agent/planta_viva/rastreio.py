"""O rastreio firme das pessoas na planta (A26, 28/10/2026) — o caminho B aprovado pelo dono em 27/10.

O que a gravação de 27/10 mostrou (o dono andando sozinho pela cozinha): a mesma pessoa vista por duas câmeras caía a
~1 m dela mesma e virava DUAS; atrás da bancada, a base da caixa do detector é a beira do móvel, não o pé, e o ponto
pulava (o zigue-zague, e a rota que atravessava equipamento); a troca do canal 6 para o 8 virava outra pessoa. Daqui
sai, a cada instante, cada pessoa UMA vez, num ponto suave, no chão livre, com o mesmo número de câmera em câmera:

1. **o vulto em cada câmera** (`TrilhasDaCamera`): a caixa de um quadro liga à do quadro anterior pela sobreposição — o
   mesmo vulto na mesma câmera leva o mesmo número de trilha, mesmo quando o ponto no chão oscila;
2. **pé ou cabeça** (`posicao_da_caixa`): o pé (o meio da base da caixa) pela homografia, quando ele é mesmo o pé. Não é
   quando a base encosta no fim da imagem, ou quando o raio da câmera até aquele ponto do chão passa por dentro de um
   móvel da planta (a bancada esconde as pernas: a base da caixa é a beira dela). Aí vale a CABEÇA (o alto da caixa): o
   raio dela, pela câmera inteira (`camera.py`), cruza a altura da pessoa num ponto só — e a pessoa fica do lado de lá
   do móvel que a esconde. Pela cabeça a direção é certa e a distância nem tanto (a altura de cada um varia): a dúvida
   vai maior no sentido do raio do que de lado;
3. **o chão livre** (`no_chao_livre`): ponto que cai dentro de um móvel vai para a beira dele;
4. **a pessoa** (`Rastreio`): um filtro de Kalman (posição e velocidade) por pessoa junta as câmeras — a trilha de cada
   câmera fica LIGADA à pessoa, e na troca de câmera ela segue a mesma —, dá o movimento reto e suave, atravessa uma
   falha curta do detector e só aparece depois de vista duas vezes (um falso positivo solto não vira gente). Duas
   pessoas que andam juntas por mais de um segundo, cada uma vista por câmeras diferentes, eram uma: viram uma.

Sem nome e sem rosto (estudo, seção 7): a "aparência" é só a cor média da roupa no tronco, para desempatar quem está
perto, e não sai do computador da loja.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, replace
from typing import Iterable, Sequence

import numpy as np

from farol_agent.planta_viva import camera as cm
from farol_agent.planta_viva.calibracao import projetar

NOTA_MINIMA = 0.5  # era 0,6: o rastreio só mostra quem foi visto duas vezes, dá para ouvir o detector mais baixo (medir na loja)
BORDA_DE_BAIXO = 0.985  # a caixa que encosta aqui tem o pé fora do quadro
BORDA_DE_CIMA = 0.012  # e aqui, a cabeça
PIXEL_DE_ERRO = 0.01  # da altura da imagem: o erro de achar a beira da caixa
ALTURA_DE_GENTE = (1.3, 2.05)  # m: a cabeça olhada no ponto do pé fora disto = a base da caixa não é o pé
DUVIDA_DA_ALTURA = 0.1  # m: o quanto a altura de uma pessoa foge da padrão (a medida dela: metade)
DUVIDA_FORA_DA_AREA = 10.0  # m por fração da imagem: a dúvida a mais do ponto fora do contorno dos pontos marcados
ROCA_DO_MOVEL = 0.1  # m: o raio que passa até isto acima do móvel conta como escondido por ele (a base raspa na beira)
MARGEM_DA_PLANTA = 0.2  # m: o pé a menos disto dentro da beira do móvel é o pé (a planta erra uns centímetros)
FOLGA_DO_MOVEL = 0.12  # m: quanto fora do móvel o ponto fica
FORA_DA_PLANTA = 0.5  # m: além disto fora dos ambientes, o ponto não é desta planta
SOBREPOSICAO_MINIMA = 0.2
TRILHA_SOME_S = 1.5
RAIO_DE_JUNTAR = 1.2  # m: o que duas câmeras veem de uma pessoa caiu a até ~1 m (medido em 27/10)
RAIO_DA_LIGACAO = 1.6  # m: a trilha já ligada a uma pessoa continua nela até esta distância
RAIO_DA_ORFA = 2.0  # m: a vista de uma câmera só, sem dono, até isto de quem as outras câmeras veem, vai para ela
VELOCIDADE_MAXIMA = 2.0  # m/s (andando rápido numa cozinha)
ACELERACAO = 1.0  # m/s²: o quanto o filtro aceita que a pessoa mude de velocidade entre dois quadros
CONFIRMA_EM = 2  # vistas para a pessoa aparecer
CONFIRMA_PERTO = 5  # … e se nasceu de uma câmera só, colada em quem já está sendo visto
TENTATIVA_SOME_S = 1.0
PERDA_S = 4.0  # sem ser vista, a pessoa continua por este tempo (coberta, o detector falhou) …
MOSTRA_SEM_VER_S = 1.0  # … e aparece na planta por este
AMORTECE_SEM_VER = 0.5  # a cada quadro sem ser vista, a velocidade cai a isto (parada atrás de algo, não some andando)
JUNTAR_IGUAIS_M = 0.6
JUNTAR_IGUAIS_S = 1.0
PESO_DA_APARENCIA = 0.4  # m: o quanto roupa de cor diferente "afasta" na hora de ligar
BONUS_DA_LIGACAO = 0.1  # m: o quanto a trilha já ligada "aproxima" a vista da pessoa dela
RAIO_CONTA_AO_MENOS = 0.4  # na distância de uma vista pela cabeça, o desvio no sentido do raio vale ao menos isto
CELULA_DO_DESVIO = 1.5  # m: o desvio de cada câmera é aprendido por pedaço do chão deste tamanho (e no geral)
DESVIO_A_PARTIR_DE = 5  # vezes: antes disto, o desvio aprendido não é usado
DESVIO_PESO_DO_GERAL = 10  # quantas vezes o pedaço do chão precisa aprender para valer tanto quanto o geral
DESVIO_PASSO_MINIMO = 0.05  # o quanto cada vez puxa, no mínimo (a calibração não muda sozinha: devagar)
DESVIO_MAXIMO = 1.5  # m: diferença maior que isto entre câmeras não é desvio, é outra pessoa
ISOLADA_M = 1.5  # m: só aprende com quem não tem ninguém por perto


# ───────────────────────────── a planta ─────────────────────────────

@dataclass(frozen=True)
class Movel:
    x: float
    y: float
    w: float
    h: float
    alt: float

    def dentro(self, x: float, y: float) -> bool:
        return self.x < x < self.x + self.w and self.y < y < self.y + self.h


@dataclass(frozen=True)
class Planta:
    """O que o rastreio usa da planta da loja: os móveis (com a altura) e o retângulo que cobre os ambientes."""

    moveis: tuple[Movel, ...] = ()
    limites: tuple[float, float, float, float] | None = None  # x0, y0, x1, y1

    def na_planta(self, x: float, y: float) -> bool:
        if self.limites is None:
            return True
        x0, y0, x1, y1 = self.limites
        return x0 - FORA_DA_PLANTA <= x <= x1 + FORA_DA_PLANTA and y0 - FORA_DA_PLANTA <= y <= y1 + FORA_DA_PLANTA


def no_chao_livre(x: float, y: float, moveis: Sequence[Movel], folga: float = FOLGA_DO_MOVEL) -> tuple[float, float]:
    """O ponto, ou — se ele cai dentro de um móvel — o chão livre mais perto: a beira mais perto do móvel, `folga` para
    fora, que não caia dentro de outro (móveis encostados: a bancada na parede, a ilha colada no balcão); sem nenhuma
    assim, o chão livre em volta, procurado em círculos de 10 cm."""
    def livre(px: float, py: float) -> bool:
        return not any(m.dentro(px, py) for m in moveis)

    if livre(x, y):
        return x, y
    saidas = []
    for m in moveis:
        if m.dentro(x, y):
            saidas += [(x - m.x, m.x - folga, y), (m.x + m.w - x, m.x + m.w + folga, y),
                       (y - m.y, x, m.y - folga), (m.y + m.h - y, x, m.y + m.h + folga)]
    for _, px, py in sorted(saidas):
        if livre(px, py):
            return px, py
    for passo in range(1, 31):
        r = passo * 0.1
        for k in range(16):
            px, py = x + r * math.cos(k * math.pi / 8), y + r * math.sin(k * math.pi / 8)
            if livre(px, py):
                return px, py
    return x, y


def _corte_da_caixa(p0: np.ndarray, p1: np.ndarray, lo: Sequence[float], hi: Sequence[float]) -> tuple[float, float] | None:
    """Onde o segmento p0→p1 entra e sai da caixa [lo, hi] (frações de 0 a 1), ou nulo se não passa por ela."""
    t0, t1 = 0.0, 1.0
    for a in range(len(lo)):
        d = p1[a] - p0[a]
        if abs(d) < 1e-12:
            if p0[a] < lo[a] or p0[a] > hi[a]:
                return None
            continue
        ta, tb = (lo[a] - p0[a]) / d, (hi[a] - p0[a]) / d
        if ta > tb:
            ta, tb = tb, ta
        t0, t1 = max(t0, ta), min(t1, tb)
        if t0 > t1:
            return None
    return t0, t1


def movel_que_esconde(cam: cm.Camera, pe: tuple[float, float], moveis: Sequence[Movel]) -> Movel | None:
    """O móvel que fica entre a câmera e aquele ponto do chão (a câmera não vê o chão ali: a base da caixa é a beira do
    móvel). O ponto a menos de `MARGEM_DA_PLANTA` da beira por onde o raio entra não conta — é o pé de quem está
    encostado do lado de cá (a planta erra uns centímetros)."""
    c = np.array([cam.centro[0], cam.centro[1], cam.altura])
    f = np.array([pe[0], pe[1], 0.0])
    melhor, entrada = None, 2.0
    for m in moveis:
        if m.dentro(c[0], c[1]) and c[2] <= m.alt:
            continue  # a câmera está dentro dele (um armário alto em volta dela): não conta
        corte = _corte_da_caixa(c, f, (m.x, m.y, -1.0), (m.x + m.w, m.y + m.h, m.alt + ROCA_DO_MOVEL))
        if corte is None:
            continue
        t0, _ = corte
        horizontal = (1.0 - t0) * math.hypot(f[0] - c[0], f[1] - c[1])  # do ponto em que o raio entra até o pé
        if horizontal < MARGEM_DA_PLANTA:
            continue
        if t0 < entrada:
            melhor, entrada = m, t0
    return melhor


def depois_do_movel(cam: cm.Camera, ponto: tuple[float, float], m: Movel, folga: float = FOLGA_DO_MOVEL) -> tuple[float, float]:
    """O ponto, levado para o lado de lá do móvel (no rumo da câmera até ele), se ele ficou do lado de cá ou dentro: quem
    o móvel esconde está atrás dele."""
    cx, cy = cam.centro[0], cam.centro[1]
    dx, dy = ponto[0] - cx, ponto[1] - cy
    dist = math.hypot(dx, dy)
    if dist < 1e-9:
        return ponto
    ux, uy = dx / dist, dy / dist
    corte = _corte_da_caixa(np.array([cx, cy]), np.array([cx + ux * 100, cy + uy * 100]), (m.x, m.y), (m.x + m.w, m.y + m.h))
    if corte is None:
        return ponto
    saida = corte[1] * 100 + folga
    if dist >= saida:
        return ponto
    return cx + ux * saida, cy + uy * saida


# ───────────────────────────── a posição de uma caixa ─────────────────────────────

@dataclass(frozen=True)
class Posicao:
    x: float
    y: float
    sigma: float  # m: a dúvida de lado (e em todo sentido, pelo pé)
    sigma_raio: float  # m: a dúvida no sentido do raio da câmera (pela cabeça, maior)
    rumo: tuple[float, float] | None  # o sentido do raio no chão (da câmera para o ponto)
    pela_cabeca: bool
    altura: float | None  # a altura da pessoa, quando pé e cabeça valeram juntos


def _incerteza(ponto, uv, erro_px: float) -> tuple[float, float] | None:
    """Quanto o ponto no chão anda quando a beira da caixa erra `erro_px`: (de lado — o erro na horizontal da imagem —,
    no sentido do raio — o erro na vertical). Nulo perto do horizonte."""
    centro = ponto(uv)
    if centro is None:
        return None
    saida = []
    for du, dv in ((erro_px, 0.0), (0.0, erro_px)):
        q = ponto((uv[0] + du, uv[1] + dv))
        if q is None:
            return None
        saida.append(math.hypot(q[0] - centro[0], q[1] - centro[1]))
    return saida[0], saida[1]


def altura_da_cabeca_no_pe(cam: cm.Camera, cabeca_uv: Sequence[float], pe: tuple[float, float]) -> float | None:
    """A que altura o raio da cabeça passa sobre o ponto do pé: a altura da pessoa, se o pé for mesmo o pé."""
    d = cam.raio(cabeca_uv)
    horizontal = d[0] ** 2 + d[1] ** 2
    if horizontal < 1e-12:
        return None
    s = ((pe[0] - cam.centro[0]) * d[0] + (pe[1] - cam.centro[1]) * d[1]) / horizontal
    if not s > 0:
        return None
    return cam.para_cima * (cam.centro[2] + s * float(d[2]))


def fora_da_area(uv: Sequence[float], area: Sequence[tuple[float, float]] | None) -> float:
    """Quanto o ponto da imagem fica fora do contorno dos pontos marcados na calibração (em fração da imagem; 0 dentro).
    Sem o contorno (a nuvem é antiga), 0."""
    if not area or len(area) < 3:
        return 0.0
    p = (float(uv[0]), float(uv[1]))
    lados = list(zip(area, list(area[1:]) + [area[0]]))
    cruzes = [(b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) for a, b in lados]
    if all(c >= 0 for c in cruzes) or all(c <= 0 for c in cruzes):
        return 0.0
    melhor = float("inf")
    for a, b in lados:
        ab = (b[0] - a[0], b[1] - a[1])
        t = max(0.0, min(1.0, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / max(1e-12, ab[0] ** 2 + ab[1] ** 2)))
        melhor = min(melhor, math.hypot(p[0] - a[0] - t * ab[0], p[1] - a[1] - t * ab[1]))
    return melhor


def fora_dos_lados(u: float, area: Sequence[tuple[float, float]]) -> float:
    """Quanto a coluna `u` da imagem passa dos lados da área calibrada (em fração da imagem; 0 entre eles)."""
    us = [p[0] for p in area]
    return max(0.0, min(us) - u, u - max(us))


def posicao_da_caixa(h: Sequence[float], cam: cm.Camera | None, caixa: Sequence[float], largura: int, altura_img: int, *,
                     planta: Planta = Planta(), erro_da_calibracao: float = 0.0, altura_da_pessoa: float | None = None,
                     confianca_da_cabeca: float = 1.0, area: Sequence[tuple[float, float]] | None = None) -> Posicao | None:
    """Onde está a pessoa da caixa (x0, y0, x1, y1 em pixels), no chão da planta — pelo pé ou pela cabeça. Nulo quando
    não dá para saber (a caixa sem pé nem cabeça, perto do horizonte, fora da planta). `area`: o contorno, na imagem, dos
    pontos marcados na calibração — fora dele a lente distorce e a conta erra (o canal 8 errou 1,5–2 m em 27/10): a
    dúvida cresce com o quanto o ponto fica de fora."""
    x0, y0, x1, y1 = (float(v) for v in caixa[:4])
    meio = (x0 + x1) / 2 / largura
    pe_uv = (meio, y1 / altura_img)
    cabeca_uv = (meio, y0 / altura_img)
    calib = max(0.0, erro_da_calibracao)
    cabeca_ok = cam is not None and cabeca_uv[1] > BORDA_DE_CIMA and confianca_da_cabeca > 0
    pe = projetar(h, pe_uv) if pe_uv[1] < BORDA_DE_BAIXO else None
    esconde = movel_que_esconde(cam, pe, planta.moveis) if pe is not None and cam is not None else None
    if pe is not None and esconde is None:
        duas = _incerteza(lambda uv: projetar(h, uv), pe_uv, PIXEL_DE_ERRO)
        if duas is None:
            return None
        s = max(duas) + calib + DUVIDA_FORA_DA_AREA * fora_da_area(pe_uv, area)
        altura = altura_da_cabeca_no_pe(cam, cabeca_uv, pe) if cabeca_ok else None  # type: ignore[arg-type]
        if altura is not None and not ALTURA_DE_GENTE[0] <= altura <= ALTURA_DE_GENTE[1]:
            # agachada, ou escondida por algo que não está na planta (outra pessoa, um carrinho): o pé fica, com dúvida
            s, altura = s * 3, None
        x, y = no_chao_livre(pe[0], pe[1], planta.moveis)
        if not planta.na_planta(x, y):
            return None
        return Posicao(x, y, s, s, None, False, altura)
    if not cabeca_ok:
        return None
    alt = altura_da_pessoa or cm.ALTURA_DA_CABECA
    acima = cam.altura - alt  # type: ignore[union-attr]
    if acima < 0.2:
        return None  # a câmera quase na altura da cabeça: o raio corre paralelo, a distância não sai
    ponto = cm.ponto_na_altura(cam, cabeca_uv, alt)  # type: ignore[arg-type]
    duas = _incerteza(lambda uv: cm.ponto_na_altura(cam, uv, alt), cabeca_uv, PIXEL_DE_ERRO)  # type: ignore[arg-type]
    if ponto is None or duas is None:
        return None
    dist = math.hypot(ponto[0] - cam.centro[0], ponto[1] - cam.centro[1])  # type: ignore[union-attr]
    # a altura de cada um foge da padrão: no sentido do raio isso pesa a distância sobre o quanto a câmera fica acima
    # da cabeça (a 2,2 m, com a cabeça a 1,65 m, 5 cm de diferença são uns 40 cm no chão a 4 m da câmera)
    duvida = DUVIDA_DA_ALTURA * (0.5 if altura_da_pessoa else 1.0)
    # a área calibrada é do CHÃO: a cabeça fica acima dela na imagem por natureza — só conta o quanto sai pelos lados
    fora = DUVIDA_FORA_DA_AREA * (fora_dos_lados(cabeca_uv[0], area) if area else 0.0)
    s_lado = (duas[0] + calib + fora) / max(0.25, confianca_da_cabeca)
    s_raio = (duas[1] + calib + fora + duvida * dist / acima) / max(0.25, confianca_da_cabeca)
    if esconde is not None:
        ponto = depois_do_movel(cam, ponto, esconde)  # type: ignore[arg-type]
    elif pe_uv[1] >= BORDA_DE_BAIXO:
        # o pé passa da borda de baixo: a pessoa está MAIS PERTO da câmera que o chão que aparece ali (embaixo da
        # câmera, a cabeça sozinha errava metros — o canal 6 em 27/10)
        borda = projetar(h, (meio, BORDA_DE_BAIXO))
        if borda is not None:
            cx, cy = cam.centro[0], cam.centro[1]  # type: ignore[union-attr]
            limite = math.hypot(borda[0] - cx, borda[1] - cy)
            if dist > limite > 0:
                ponto = (cx + (ponto[0] - cx) * limite / dist, cy + (ponto[1] - cy) * limite / dist)
                s_raio = min(s_raio, max(s_lado, limite / 2))
    x, y = no_chao_livre(ponto[0], ponto[1], planta.moveis)
    if not planta.na_planta(x, y):
        return None
    rx, ry = x - cam.centro[0], y - cam.centro[1]  # type: ignore[union-attr]
    n = math.hypot(rx, ry) or 1.0
    return Posicao(x, y, s_lado, max(s_lado, s_raio), (rx / n, ry / n), True, None)


def aparencia_da_caixa(img: np.ndarray, caixa: Sequence[float]) -> np.ndarray | None:
    """A cor da roupa no tronco: 8 faixas de matiz para o que tem cor e 3 de claro/escuro para o que não tem (o branco
    do uniforme), somando 1. Nada que diga quem é: só a cor."""
    try:
        import cv2
    except ImportError:  # pragma: no cover — o agente sempre tem o OpenCV
        return None
    alto, largo = img.shape[:2]
    x0, y0, x1, y1 = (float(v) for v in caixa[:4])
    w, hh = x1 - x0, y1 - y0
    a, b = int(max(0, x0 + 0.3 * w)), int(min(largo, x1 - 0.3 * w))
    c, d = int(max(0, y0 + 0.22 * hh)), int(min(alto, y0 + 0.55 * hh))
    if b - a < 3 or d - c < 3:
        return None
    hsv = cv2.cvtColor(np.ascontiguousarray(img[c:d, a:b]), cv2.COLOR_BGR2HSV).reshape(-1, 3).astype(np.int32)
    com_cor = hsv[:, 1] >= 50
    hist = np.zeros(11, dtype=np.float64)
    np.add.at(hist, (hsv[com_cor, 0] * 8 // 180).clip(0, 7), 1.0)
    np.add.at(hist, 8 + (hsv[~com_cor, 2] * 3 // 256).clip(0, 2), 1.0)
    total = hist.sum()
    return hist / total if total > 0 else None


# ───────────────────────────── o vulto em cada câmera ─────────────────────────────

def sobreposicao(a: Sequence[float], b: Sequence[float]) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    uniao = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / uniao if uniao > 0 else 0.0


class TrilhasDaCamera:
    """O mesmo vulto de quadro em quadro numa câmera: a caixa liga à do quadro anterior (andada pelo passo que ela
    vinha dando) pela sobreposição. A trilha é só uma preferência na hora de ligar a vista à pessoa (`BONUS_DA_LIGACAO`):
    quando ela troca duas pessoas enfileiradas, a distância no chão decide."""

    def __init__(self) -> None:
        self._ativas: dict[int, tuple[tuple[float, ...], float, tuple[float, float]]] = {}  # caixa, quando, passo/s
        self._proxima = 1

    def passo(self, t: float, caixas: Sequence[Sequence[float]]) -> list[int]:
        self._ativas = {k: v for k, v in self._ativas.items() if t - v[1] <= TRILHA_SOME_S}
        previstas = {}
        for k, (c, quando, (vx, vy)) in self._ativas.items():
            dt = t - quando
            previstas[k] = (c[0] + vx * dt, c[1] + vy * dt, c[2] + vx * dt, c[3] + vy * dt)
        pares = sorted(((s, i, k) for i, c in enumerate(caixas) for k in previstas
                        if (s := sobreposicao(c, previstas[k])) >= SOBREPOSICAO_MINIMA), reverse=True)
        dono: dict[int, int] = {}
        usadas: set[int] = set()
        for _, i, k in pares:
            if i in dono or k in usadas:
                continue
            dono[i] = k
            usadas.add(k)
        saida = []
        for i, c in enumerate(caixas):
            caixa = tuple(float(v) for v in c[:4])
            k = dono.get(i)
            if k is None:
                k = self._proxima
                self._proxima += 1
                passo = (0.0, 0.0)
            else:
                antes, quando, _ = self._ativas[k]
                dt = max(1e-3, t - quando)
                passo = (((caixa[0] + caixa[2]) - (antes[0] + antes[2])) / 2 / dt,
                         ((caixa[1] + caixa[3]) - (antes[1] + antes[3])) / 2 / dt)
            self._ativas[k] = (caixa, t, passo)
            saida.append(k)
        return saida


# ───────────────────────────── a pessoa ─────────────────────────────

@dataclass
class Observacao:
    """Uma pessoa vista por uma câmera, no chão: a posição, a dúvida (de lado e no sentido do raio) e de que trilha."""

    canal: str
    trilha: int
    x: float
    y: float
    sigma: float
    sigma_raio: float | None = None
    rumo: tuple[float, float] | None = None
    pela_cabeca: bool = False
    altura: float | None = None
    aparencia: np.ndarray | None = None
    bruto: tuple[float, float] | None = None  # o ponto antes de tirar o desvio aprendido da câmera

    @classmethod
    def da_posicao(cls, canal: str, trilha: int, p: Posicao, aparencia: np.ndarray | None = None) -> "Observacao":
        return cls(canal, trilha, p.x, p.y, p.sigma, p.sigma_raio, p.rumo, p.pela_cabeca, p.altura, aparencia)

    @property
    def maior_duvida(self) -> float:
        return max(self.sigma, self.sigma_raio or 0.0)

    def covariancia(self) -> np.ndarray:
        lado = max(0.05, self.sigma) ** 2
        if self.rumo is None or not self.sigma_raio:
            return np.eye(2) * lado
        u = np.array(self.rumo, dtype=np.float64)
        v = np.array([-u[1], u[0]])
        return max(0.05, self.sigma_raio) ** 2 * np.outer(u, u) + lado * np.outer(v, v)


@dataclass
class Pessoa:
    numero: int
    estado: np.ndarray  # x, y, vx, vy
    cov: np.ndarray
    visto_em: float
    criado_em: float
    vistas: int = 1
    confirmada: bool = False
    confirma_em: int = CONFIRMA_EM  # vistas para aparecer
    ligacoes: dict[str, int] = field(default_factory=dict)  # canal → trilha
    canais_agora: tuple[str, ...] = ()
    aparencia: np.ndarray | None = None
    alturas: list[float] = field(default_factory=list)
    juntas_desde: dict[int, float] = field(default_factory=dict)  # outra pessoa → desde quando anda junto
    visto_xy: tuple[float, float] | None = None  # onde estava quando foi vista por último

    @property
    def x(self) -> float:
        return float(self.estado[0])

    @property
    def y(self) -> float:
        return float(self.estado[1])

    @property
    def altura(self) -> float | None:
        return float(np.median(self.alturas)) if len(self.alturas) >= 3 else None


def _parecidas(a: np.ndarray | None, b: np.ndarray | None) -> float:
    """De 0 a 1 (1 = a mesma cor de roupa). Sem a aparência de um dos lados: neutro."""
    if a is None or b is None:
        return 0.5
    return float(np.minimum(a, b).sum())


def distancia_corrigida(o: Observacao, x: float, y: float) -> float:
    """A distância da vista ao ponto, com a parte no sentido do raio encolhida pela dúvida dela: a vista pela cabeça
    pode cair longe no rumo da câmera e ainda ser da mesma pessoa; de lado, não."""
    dx, dy = x - o.x, y - o.y
    if o.rumo is None or not o.sigma_raio or o.sigma_raio <= o.sigma:
        return math.hypot(dx, dy)
    raio = dx * o.rumo[0] + dy * o.rumo[1]
    lado = -dx * o.rumo[1] + dy * o.rumo[0]
    # o raio conta ao menos 40%: sem isso, a vista pela cabeça de quem passa "acha" qualquer pessoa no mesmo rumo
    return math.hypot(lado, raio * max(RAIO_CONTA_AO_MENOS, max(0.05, o.sigma) / o.sigma_raio))


class CanalDoRastreio:
    """Um canal calibrado: a homografia, a câmera inteira tirada dela (e o quanto a cabeça vale nela, pela altura medida
    na planta) e as trilhas dos vultos. Das caixas de um quadro saem as vistas do canal, no chão."""

    def __init__(self, canal: str, h: Sequence[float], *, erro_da_calibracao: float = 0.0, altura_medida: float | None = None,
                 area: Sequence[tuple[float, float]] | None = None) -> None:
        self.canal = canal
        self.h = list(h)
        self.erro = erro_da_calibracao or 0.0
        self.area = list(area) if area else None
        self.cam = cm.camera_da_homografia(self.h)
        self.confianca = cm.confianca_da_cabeca(self.cam, altura_medida) if self.cam else 0.0
        self.trilhas = TrilhasDaCamera()

    def observacoes(self, t: float, caixas: Sequence[Sequence[float]], largura: int, altura: int, rastreio: "Rastreio",
                    img: np.ndarray | None = None) -> list[Observacao]:
        caixas = [c for c in caixas if (float(c[4]) if len(c) > 4 else 1.0) >= NOTA_MINIMA]
        saida = []
        for c, trilha in zip(caixas, self.trilhas.passo(t, caixas)):
            p = posicao_da_caixa(self.h, self.cam, c, largura, altura, planta=rastreio.planta, erro_da_calibracao=self.erro,
                                 altura_da_pessoa=rastreio.altura_de(self.canal, trilha), confianca_da_cabeca=self.confianca,
                                 area=self.area)
            if p is not None:
                saida.append(Observacao.da_posicao(self.canal, trilha, p, aparencia_da_caixa(img, c) if img is not None else None))
        return saida


class DesvioDasCameras:
    """O quanto cada câmera erra o chão, aprendido com o próprio movimento (a calibração torta de 27/10: o mesmo pé visto
    por duas câmeras caía a ~1 m). Quando uma pessoa SOZINHA (ninguém a `ISOLADA_M`) é vista pelo pé por duas ou mais
    câmeras, cada câmera fica sabendo quanto o ponto dela difere do das outras; a média disso, em cada pedaço do chão
    (`CELULA_DO_DESVIO`; a calibração erra diferente em cada canto) e no geral da câmera, é tirada das vistas seguintes.

    Não acha o "certo" de fora — deixa as câmeras de acordo entre si, que é o que impede a pessoa em dobro. Vive na
    memória do agente: recomeça quando ele reinicia e se refaz em minutos de movimento."""

    def __init__(self, celula: float = CELULA_DO_DESVIO) -> None:
        self.celula = celula
        self.geral: dict[str, list[float]] = {}  # canal → [dx, dy, quantas]
        self.local: dict[tuple[str, int, int], list[float]] = {}

    def _chave(self, canal: str, x: float, y: float) -> tuple[str, int, int]:
        return canal, int(math.floor(x / self.celula)), int(math.floor(y / self.celula))

    def de(self, canal: str, x: float, y: float) -> tuple[float, float]:
        g = self.geral.get(canal)
        if not g or g[2] < DESVIO_A_PARTIR_DE:
            return 0.0, 0.0
        perto = self.local.get(self._chave(canal, x, y))
        if not perto:
            return g[0], g[1]
        peso = perto[2] / (perto[2] + DESVIO_PESO_DO_GERAL)
        return peso * perto[0] + (1 - peso) * g[0], peso * perto[1] + (1 - peso) * g[1]

    def aprender(self, canal: str, bx: float, by: float, mx: float, my: float) -> None:
        """A vista CRUA da câmera (bx, by) e onde as outras câmeras puseram a mesma pessoa (mx, my): o desvio geral da
        câmera e o daquele pedaço do chão andam, cada um pela SUA correção (senão um passa do ponto para compensar o
        outro), metade do caminho — a outra câmera anda a outra metade."""
        for alvo, chave in ((self.geral, canal), (self.local, self._chave(canal, bx, by))):
            d = alvo.setdefault(chave, [0.0, 0.0, 0.0])  # type: ignore[arg-type]
            rx, ry = bx - d[0] - mx, by - d[1] - my
            passo = max(DESVIO_PASSO_MINIMO, 1.0 / (d[2] + 2))
            d[0] += passo * rx / 2
            d[1] += passo * ry / 2
            d[2] += 1

    def resumo(self) -> dict[str, tuple[float, float, int]]:
        """O desvio geral de cada câmera (dx, dy em m, quantas vezes aprendeu): o diagnóstico da calibração."""
        return {k: (round(v[0], 2), round(v[1], 2), int(v[2])) for k, v in sorted(self.geral.items())}

    def esquecer(self, canal: str) -> None:
        """A calibração da câmera mudou: o que se aprendeu dela não vale mais."""
        self.geral.pop(canal, None)
        self.local = {k: v for k, v in self.local.items() if k[0] != canal}

    def para_json(self) -> dict:
        return {"celula": self.celula, "geral": {k: list(v) for k, v in self.geral.items()},
                "local": [[c, i, j, *v] for (c, i, j), v in self.local.items()]}

    @classmethod
    def de_json(cls, dados: object) -> "DesvioDasCameras":
        """O que foi guardado em disco; o que vier torto fica de fora (recomeça a aprender)."""
        d = cls()
        if not isinstance(dados, dict) or dados.get("celula") != d.celula:
            return d

        def tres(v: object) -> list[float] | None:
            ok = isinstance(v, list) and len(v) == 3 and all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in v)
            return [float(x) for x in v] if ok else None  # type: ignore[union-attr]

        for k, v in (dados.get("geral") or {}).items():
            if isinstance(k, str) and (t := tres(v)) is not None:
                d.geral[k] = t
        for linha in dados.get("local") or []:
            if isinstance(linha, list) and len(linha) == 6 and isinstance(linha[0], str) and all(isinstance(x, int) for x in linha[1:3]):
                if (t := tres(linha[3:])) is not None:
                    d.local[(linha[0], linha[1], linha[2])] = t
        return d


class Rastreio:
    """Cada pessoa uma vez, com o mesmo número, num ponto suave e no chão livre."""

    def __init__(self, planta: Planta = Planta()) -> None:
        self.planta = planta
        self.pessoas: list[Pessoa] = []
        self.desvios = DesvioDasCameras()
        self._proximo = 1
        self._dia: str | None = None
        self._t: float | None = None

    def _sem_desvio(self, o: Observacao) -> Observacao:
        dx, dy = self.desvios.de(o.canal, o.x, o.y)
        if not dx and not dy:
            return o
        return replace(o, x=o.x - dx, y=o.y - dy, bruto=(o.x, o.y))

    def _aprender_desvios(self, p: Pessoa, vistas: Sequence[Observacao]) -> None:
        pelo_pe = [o for o in vistas if not o.pela_cabeca]
        if len({o.canal for o in pelo_pe}) < 2:
            return
        if any(q is not p and math.hypot(q.x - p.x, q.y - p.y) < ISOLADA_M for q in self.pessoas):
            return  # outra pessoa perto: a vista pode ser dela
        for o in pelo_pe:
            outras = [q for q in pelo_pe if q is not o]
            pesos = [1 / max(0.05, q.sigma) ** 2 for q in outras]
            mx = sum(q.x * w for q, w in zip(outras, pesos)) / sum(pesos)
            my = sum(q.y * w for q, w in zip(outras, pesos)) / sum(pesos)
            if math.hypot(o.x - mx, o.y - my) <= DESVIO_MAXIMO:
                bx, by = o.bruto or (o.x, o.y)
                self.desvios.aprender(o.canal, bx, by, mx, my)

    # o filtro
    @staticmethod
    def _prever(p: Pessoa, dt: float) -> None:
        if dt <= 0:
            return
        f = np.array([[1, 0, dt, 0], [0, 1, 0, dt], [0, 0, 1, 0], [0, 0, 0, 1]], dtype=np.float64)
        q = ACELERACAO ** 2 * np.array([[dt ** 4 / 4, 0, dt ** 3 / 2, 0], [0, dt ** 4 / 4, 0, dt ** 3 / 2],
                                        [dt ** 3 / 2, 0, dt ** 2, 0], [0, dt ** 3 / 2, 0, dt ** 2]])
        p.estado = f @ p.estado
        p.cov = f @ p.cov @ f.T + q

    @staticmethod
    def _corrigir(p: Pessoa, o: Observacao) -> None:
        hm = np.array([[1, 0, 0, 0], [0, 1, 0, 0]], dtype=np.float64)
        y = np.array([o.x, o.y]) - hm @ p.estado
        s = hm @ p.cov @ hm.T + o.covariancia()
        k = p.cov @ hm.T @ np.linalg.inv(s)
        p.estado = p.estado + k @ y
        p.cov = (np.eye(4) - k @ hm) @ p.cov
        v = math.hypot(p.estado[2], p.estado[3])
        if v > VELOCIDADE_MAXIMA:
            p.estado[2:] *= VELOCIDADE_MAXIMA / v

    def _nova(self, t: float, obs: Sequence[Observacao]) -> Pessoa:
        info = sum(np.linalg.inv(o.covariancia()) for o in obs)
        cov = np.linalg.inv(info)
        xy = cov @ sum(np.linalg.inv(o.covariancia()) @ np.array([o.x, o.y]) for o in obs)
        p = Pessoa(self._proximo, np.array([xy[0], xy[1], 0.0, 0.0]), np.zeros((4, 4)), t, t)
        p.cov[:2, :2] = cov
        p.cov[2:, 2:] = np.eye(2) * 1.0  # parada ou andando: ainda não se sabe
        p.visto_xy = (float(xy[0]), float(xy[1]))
        self._proximo += 1
        for o in obs:
            self._guardar(p, o, primeira=True)
        p.canais_agora = tuple(sorted({o.canal for o in obs}))
        return p

    @staticmethod
    def _guardar(p: Pessoa, o: Observacao, primeira: bool = False) -> None:
        p.ligacoes[o.canal] = o.trilha
        if o.altura is not None:
            p.alturas = (p.alturas + [o.altura])[-15:]
        if o.aparencia is not None:
            novo = 0.3 if primeira else 0.15
            p.aparencia = o.aparencia if p.aparencia is None else (1 - novo) * p.aparencia + novo * o.aparencia

    def altura_de(self, canal: str, trilha: int) -> float | None:
        """A altura já medida da pessoa a que esta trilha está ligada (deixa a posição pela cabeça mais certa)."""
        for p in self.pessoas:
            if p.ligacoes.get(canal) == trilha:
                return p.altura
        return None

    def passo(self, t: float, observacoes: Iterable[Observacao], *, dia: str | None = None) -> list[tuple[int, float, float]]:
        """As pessoas do instante `t` (segundos): (número, x, y) — só as confirmadas e vistas há pouco."""
        if dia is not None and dia != self._dia:
            self._dia, self._proximo, self.pessoas = dia, 1, []
        dt = 0.0 if self._t is None else max(0.0, t - self._t)
        self._t = t
        for p in self.pessoas:
            self._prever(p, dt)
        obs = [self._sem_desvio(o) for o in observacoes]
        dono: dict[int, Pessoa] = {}

        def livre(i: int, p: Pessoa) -> bool:
            """Uma vista por câmera por pessoa: duas caixas da mesma câmera são duas pessoas."""
            return i not in dono and not any(q is p and obs[j].canal == obs[i].canal for j, q in dono.items())

        # 1. cada vista à pessoa mais perto (a distância corrigida pela dúvida, a cor da roupa para desempatar). A trilha
        #    já ligada à pessoa ganha um bônus — é o que a segura na troca de câmera e com a calibração torta —, mas não
        #    manda: quando a câmera troca as caixas de duas pessoas enfileiradas, a distância decide.
        pares = []
        for i, o in enumerate(obs):
            for p in self.pessoas:
                # a distância à previsão — ou, se a pessoa sumiu um tempo, ao último lugar em que foi vista: sem ser
                # vista ela pode ter virado para qualquer lado, e a previsão segue reto
                d = distancia_corrigida(o, p.x, p.y)
                if p.visto_xy is not None and t - p.visto_em > dt + 1e-6:
                    d = min(d, distancia_corrigida(o, *p.visto_xy))
                ligada = p.ligacoes.get(o.canal) == o.trilha
                andou = VELOCIDADE_MAXIMA * (t - p.visto_em)
                alcance = max(RAIO_DA_LIGACAO if ligada else RAIO_DE_JUNTAR, andou) + o.sigma
                if d <= alcance:
                    custo = d + PESO_DA_APARENCIA * (1 - _parecidas(o.aparencia, p.aparencia)) - (BONUS_DA_LIGACAO if ligada else 0.0)
                    # quem foi visto no quadro anterior escolhe antes de quem está sumido: a vista de quem passa perto
                    # não "revive" quem já saiu
                    sumida = t - p.visto_em > dt + 1e-6
                    pares.append((sumida, custo, i, p))
        for *_, i, p in sorted(pares, key=lambda x: (x[0], x[1])):
            if livre(i, p):
                dono[i] = p
        # 2. cada pessoa corrigida pelas vistas dela (várias câmeras = várias correções)
        tocadas: dict[int, list[Observacao]] = {}
        for i, p in dono.items():
            tocadas.setdefault(id(p), []).append(obs[i])
        for p in self.pessoas:
            vistas = tocadas.get(id(p))
            if not vistas:
                p.canais_agora = ()
                p.estado[2:] *= AMORTECE_SEM_VER  # sem ser vista, não sai andando sozinha pela planta
                continue
            sumiu = t - p.visto_em
            if p.visto_xy is not None and sumiu > dt + 1e-6:
                # voltou a ser vista depois de um tempo: recomeça do último lugar em que esteve, sem a velocidade de
                # antes (a previsão em linha reta já não vale) e com a dúvida do quanto deu para andar
                raio = 0.5 * VELOCIDADE_MAXIMA * sumiu
                p.estado = np.array([p.visto_xy[0], p.visto_xy[1], 0.0, 0.0])
                p.cov = np.diag([raio ** 2, raio ** 2, 1.0, 1.0])
            for o in vistas:
                self._corrigir(p, o)
                self._guardar(p, o)
            self._aprender_desvios(p, vistas)
            p.canais_agora = tuple(sorted({o.canal for o in vistas}))
            p.visto_em = t
            p.visto_xy = (p.x, p.y)
            p.vistas += 1
            if p.vistas >= p.confirma_em:
                p.confirmada = True
        # 4. as vistas sem dono: as de câmeras diferentes, perto uma da outra, são uma pessoa nova só
        grupos: list[list[Observacao]] = []
        for o in sorted((o for i, o in enumerate(obs) if i not in dono), key=lambda o: o.maior_duvida):
            perto = [(distancia_corrigida(o, g[0].x, g[0].y), k) for k, g in enumerate(grupos) if all(x.canal != o.canal for x in g)]
            perto = [pk for pk in perto if pk[0] <= RAIO_DE_JUNTAR + o.sigma]
            if perto:
                grupos[min(perto)[1]].append(o)
            else:
                grupos.append([o])
        for g in grupos:
            if len(g) == 1:
                # a vista de UMA câmera, sem dono, perto de quem as OUTRAS câmeras estão vendo agora e esta não viu: é a
                # mesma pessoa, vista de longe ou com a calibração torta naquele canto — não uma pessoa nova
                o = g[0]
                vistas_agora = [p for p in self.pessoas if p.confirmada and p.visto_em == t and o.canal not in p.canais_agora]
                perto = [(distancia_corrigida(o, p.x, p.y), p.numero, p) for p in vistas_agora]
                perto = [x for x in perto if x[0] <= RAIO_DA_ORFA + o.sigma]
                if perto:
                    _, _, p = min(perto, key=lambda x: (x[0], x[1]))
                    self._corrigir(p, o)
                    self._guardar(p, o)
                    p.canais_agora = tuple(sorted(set(p.canais_agora) | {o.canal}))
                    continue
            nova = self._nova(t, g)
            if len({o.canal for o in g}) >= 2:
                nova.confirmada = True  # duas câmeras viram ao mesmo tempo: é gente
            elif any(p.confirmada and p.visto_em == t and distancia_corrigida(g[0], p.x, p.y) <= RAIO_DA_ORFA + g[0].sigma
                     for p in self.pessoas):
                # uma câmera só, colada em quem já está sendo visto (a câmera de longe que vê duas caixas onde há uma
                # pessoa): só aparece se continuar sendo vista
                nova.confirma_em = CONFIRMA_PERTO
            self.pessoas.append(nova)
        # 5. quem some: a tentativa logo; a confirmada depois de PERDA_S
        self.pessoas = [p for p in self.pessoas if t - p.visto_em <= (PERDA_S if p.confirmada else TENTATIVA_SOME_S)]
        # 6. duas pessoas juntas por mais de um segundo, vistas por câmeras diferentes: eram uma (a mais antiga fica)
        self._juntar_iguais(t)
        return [(n, x, y) for n, x, y, *_ in self.agora(t)]

    def agora(self, t: float) -> list[tuple[int, float, float, float, float, tuple[str, ...]]]:
        """As pessoas para mostrar no instante `t`: (número, x, y, vx, vy, câmeras que a viram agora) — no chão livre."""
        saida = []
        for p in self.pessoas:
            if p.confirmada and t - p.visto_em <= MOSTRA_SEM_VER_S:
                x, y = no_chao_livre(p.x, p.y, self.planta.moveis)
                saida.append((p.numero, round(x, 3), round(y, 3), round(float(p.estado[2]), 2), round(float(p.estado[3]), 2),
                              p.canais_agora))
        return saida

    def _juntar_iguais(self, t: float) -> None:
        sai: set[int] = set()
        for a in sorted(self.pessoas, key=lambda p: p.numero):
            for b in self.pessoas:
                if b.numero <= a.numero or id(a) in sai or id(b) in sai:
                    continue
                perto = math.hypot(a.x - b.x, a.y - b.y) <= JUNTAR_IGUAIS_M
                juntas = perto and a.canais_agora and b.canais_agora and not set(a.canais_agora) & set(b.canais_agora)
                if juntas:
                    desde = a.juntas_desde.setdefault(b.numero, t)
                    if t - desde >= JUNTAR_IGUAIS_S:
                        for canal, trilha in b.ligacoes.items():
                            if canal in b.canais_agora or canal not in a.ligacoes:
                                a.ligacoes[canal] = trilha
                        a.vistas += b.vistas
                        a.confirmada = a.confirmada or b.confirmada
                        a.alturas = (a.alturas + b.alturas)[-15:]
                        a.canais_agora = tuple(sorted(set(a.canais_agora) | set(b.canais_agora)))
                        sai.add(id(b))
                elif not perto:
                    a.juntas_desde.pop(b.numero, None)
        if sai:
            self.pessoas = [p for p in self.pessoas if id(p) not in sai]
