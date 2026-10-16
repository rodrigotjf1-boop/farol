"""Os quadros de cada lanche, da captura densa da bancada (A21, fatia T3c-2).

É o `quadros_por_lanche` v3 da rodada 12 (14/10/2026) como módulo do agente. O
dono, 14/10: "precisamos ter os quadros necessários para a análise local e
identificar os ingredientes"; "um pão na bancada é o start da montagem".

1. Em cada quadro da captura densa (`treino_quadros`), o detector que a loja já
   tem (RF-DETR Nano) acha os pães abertos — ele os chama de "donut". Medido
   em 14/10: nota mediana 0,83 com pão e 0,04 sem; com o limite 0,3, 127 de 130
   quadros com pão e 3 alarmes em 159 sem. O quadro inteiro e mais 6 pedaços
   sobrepostos (o pão é pequeno no quadro de 384 px do modelo).
2. As duas metades vizinhas (base e tampo) são UM lanche; o lanche é seguido
   pela posição de quadro em quadro. O lanche que se mexeu ("o colaborador pode
   chegar para o lado quando tem alta demanda" — o dono, 14/10) ou que fechou
   (as duas metades viram um disco) é reconhecido pela CARA: as cores do miolo
   do recorte. Empurrado, ele começa um trecho novo, com outra caixa. E o lanche
   PUXADO ao longo da bancada ("puxa da esquerda para a direita, para o meio do
   tampo" — o dono, 15/10) é ele mesmo longe, se já era lanche, ficou no eixo da
   área de montagem e tem a cara muito parecida (`MESMA_CARA_LONGE`) com a da
   última vez que ele foi VISTO (e não com a do lugar, com a mão por cima).
3. Recorte do lanche em cada quadro em que ele está, numa CAIXA FIXA por trecho
   (a câmera é fixa; medido na v2: a caixa que acompanha o detector muda de
   tamanho a cada quadro, e "o lanche andou" se mistura com "entrou
   ingrediente"). As ETAPAS dentro da caixa (mexeu, assentou e ficou diferente
   da última vez parado). E `metades.csv`: em cada quadro, onde o detector viu
   cada metade, em pixels da caixa — é o que a identificação dos ingredientes
   (T3c-3) lê.

**O que é da loja vai no perfil** (`PerfilDaBancada`): o tamanho do pão em
pixels (a lente e a distância da câmera), os limites de "mexeu" e "mudou" (o
ruído da câmera), quanto tempo sem pão encerra o lanche, a cara parecida e a
duração mínima. O que é do modelo e da conta fica aqui.

**A hora é a data inteira**, e não o segundo do dia (o v3 contava o segundo do
dia, e a gravação que passa da meia-noite se perderia).

**Dorme:** nada no agente chama este módulo ainda (a T3d liga).
"""

from __future__ import annotations

import csv
import io
import json
import math
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Protocol

import cv2
import numpy as np

# O modelo chama o pão aberto de "donut"; a nota a partir da qual ele conta (medido em 14/10, acima).
CLASSE_DO_PAO = "donut"
LIMITE_DO_PAO = 0.3
# Duas caixas que se cobrem nisto ou mais são o mesmo pão (entre os pedaços do quadro).
MESMO_PAO = 0.3
# Duas metades cujos centros ficam a menos disto (em diâmetros) são o mesmo lanche.
JUNTA_METADES = 1.6
# A folga em volta das metades, na região do lanche (de cada lado, em fração do tamanho).
FOLGA_DA_REGIAO = 0.25
# A região que cobre a do lanche nisto ou mais é ele, no mesmo lugar.
MESMO_LUGAR = 0.2
# Quanto a região do lanche anda na direção da nova a cada quadro (não encolhe de uma vez: a metade coberta some do detector).
ACOMPANHA = 0.3
# Até quantos "lados" do lanche ele pode ter sido empurrado e ainda ser ele (com a mesma cara).
EMPURRADO_ATE = 1.5
# O PUXÃO ao longo da bancada (o dono, 15/10/2026: "o colaborador puxa o hambúrguer que está aguardando, já com os
# pães, molho e alface, da esquerda para a direita, para o meio do tampo"). Longe (mais que `EMPURRADO_ATE`), ainda é
# ele se: já era lanche (`duracao_minima_s` do perfil), reaparece quase no mesmo eixo da área de montagem (o lado
# maior do recorte; fora dele no máximo `FORA_DO_EIXO` lado) e com a cara MUITO parecida com a da última vez que foi
# visto. Medido na densa das 21h30 de 14/10 (16/10): o puxão de verdade, 0,98; os enganos que as colunas sozinhas
# juntariam (a carne da chapa para o pão, pães diferentes), até 0,75; o pão vazio na mão, 0,93 — mas ele não era
# lanche ainda.
# PERTO, a cara continua a do LUGAR (a de cada quadro, com o lanche visto ou não). Medido na mesma densa: com a da
# última vista, o empurrão de perto juntou mais 4, e nenhum era o mesmo lanche (o embrulho com o pão aberto ao lado, a
# carne da chapa com a carne no pão); a do lugar recusa o que aparece ao lado logo depois da mão.
MESMA_CARA_LONGE = 0.9
FORA_DO_EIXO = 0.5
# A região nova que CRESCE muito não é o lanche que se mexeu: é ele junto de outra coisa ao lado. Medido na densa de
# 14/10 (16/10): das 8 junções de perto, as que cresceram mais que 1,5 vez foram vários pães postos de uma vez (2,46), a
# bandeja de carnes ao lado do lanche coberto (1,66) e o par de pães que sai da mão para a bancada (1,73, ainda não era
# lanche); o empurrão, o fechar e a mão por cima ficaram entre 0,29 e 0,90.
CRESCE_ATE = 1.5
# A menor caixa que vira recorte, em pixels.
CAIXA_MINIMA = 50


@dataclass(frozen=True)
class PerfilDaBancada:
    """O que é da LOJA (da câmera, da lente, da distância) na leitura da bancada. Medido na instalação."""

    # O lado maior de um pão aberto, em pixels do quadro em resolução cheia (na loja piloto: 93–113 mm ≈ 100–260 px).
    pao_px_min: float
    pao_px_max: float
    # Média |Δcinza| (um quarto do tamanho) abaixo da qual o lanche está parado, e a partir da qual a parada é outra.
    mexe: float
    mudou: float
    # Sem pão visto por tanto tempo, o lanche terminou (fechado e embrulhado, ou saiu).
    sumiu_s: float
    # A correlação das cores do miolo para "é o mesmo lanche" depois de mexido.
    parecido: float
    # A trilha mais curta que isso não é lanche (a bandeja de discos e o embrulho).
    duracao_minima_s: float

    @classmethod
    def de_json(cls, dados: dict[str, Any]) -> "PerfilDaBancada":
        return cls(**{k: float(dados[k]) for k in cls.__dataclass_fields__})


class Detector(Protocol):
    def caixas(self, imagem_bgr: np.ndarray, classe: str, limite: float) -> list[tuple[float, float, float, float, float]]:
        ...


Caixa = tuple[float, float, float, float, float]


def pedacos_do_quadro(largura: int, altura: int) -> list[tuple[int, int, int, int]]:
    """O quadro inteiro e 6 pedaços sobrepostos (30%), como (x0, y0, largura, altura)."""
    tw, th = int(largura / 3 * 1.3), int(altura / 2 * 1.3)
    saida = [(0, 0, largura, altura)]
    for y0 in (0, altura - th):
        for x0 in (0, (largura - tw) // 2, largura - tw):
            saida.append((x0, y0, tw, th))
    return saida


def iou(a, b) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    uniao = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / uniao if uniao > 0 else 0.0


def centro(a) -> tuple[float, float]:
    return (a[0] + a[2]) / 2, (a[1] + a[3]) / 2


def lado_maior(a) -> float:
    return max(a[2] - a[0], a[3] - a[1])


def fora_do_eixo(a, b, largura: int, altura: int) -> float:
    """Quanto o centro de `b` sai do eixo da área de montagem passando pelo de `a`, em pixels: a bancada corre ao longo
    do lado maior do recorte (deitado, o eixo é o horizontal; em pé, o vertical)."""
    (ax, ay), (bx, by) = centro(a), centro(b)
    return abs(by - ay) if largura >= altura else abs(bx - ax)


def paes(detector: Detector, imagem: np.ndarray, perfil: PerfilDaBancada) -> list[Caixa]:
    """Os pães abertos do quadro, sem repetição entre os pedaços e do tamanho de um pão."""
    h, w = imagem.shape[:2]
    achados: list[Caixa] = []
    for x0, y0, tw, th in pedacos_do_quadro(w, h):
        for bx0, by0, bx1, by1, nota in detector.caixas(imagem[y0:y0 + th, x0:x0 + tw], CLASSE_DO_PAO, LIMITE_DO_PAO):
            achados.append((x0 + bx0, y0 + by0, x0 + bx1, y0 + by1, nota))
    achados.sort(key=lambda a: -a[4])
    ficam: list[Caixa] = []
    for a in achados:
        if all(iou(a, b) < MESMO_PAO for b in ficam):
            ficam.append(a)
    return [a for a in ficam if perfil.pao_px_min <= lado_maior(a) <= perfil.pao_px_max]


def lanches_do_quadro(achados: list[Caixa]) -> list[tuple]:
    """Junta as metades vizinhas. Cada região: (x0, y0, x1, y1, quantas metades, as metades)."""
    grupos: list[list[Caixa]] = []
    for a in achados:
        ca = centro(a)
        d = lado_maior(a)
        for g in grupos:
            if any(math.dist(ca, centro(b)) < JUNTA_METADES * max(d, lado_maior(b)) for b in g):
                g.append(a)
                break
        else:
            grupos.append([a])
    regioes = []
    for g in grupos:
        x0, y0 = min(b[0] for b in g), min(b[1] for b in g)
        x1, y1 = max(b[2] for b in g), max(b[3] for b in g)
        mx, my = FOLGA_DA_REGIAO * (x1 - x0), FOLGA_DA_REGIAO * (y1 - y0)
        regioes.append((x0 - mx, y0 - my, x1 + mx, y1 + my, len(g), tuple(g)))
    return regioes


def aparencia(imagem: np.ndarray, regiao) -> np.ndarray:
    """As cores (matiz × saturação) do MIOLO da região — o meio, onde está a comida e não o papel em volta."""
    x0, y0, x1, y1 = regiao[:4]
    mx, my = 0.25 * (x1 - x0), 0.25 * (y1 - y0)
    xa, ya = int(max(0, x0 + mx)), int(max(0, y0 + my))
    xb, yb = int(min(imagem.shape[1], x1 - mx)), int(min(imagem.shape[0], y1 - my))
    if xb - xa < 10 or yb - ya < 10:
        xa, ya, xb, yb = int(max(0, x0)), int(max(0, y0)), int(min(imagem.shape[1], x1)), int(min(imagem.shape[0], y1))
    hsv = cv2.cvtColor(imagem[ya:yb, xa:xb], cv2.COLOR_BGR2HSV)
    h = cv2.calcHist([hsv], [0, 1], None, [18, 16], [0, 180, 0, 256])
    return cv2.normalize(h, h).astype(np.float32)


@dataclass
class Trilha:
    """Um lanche seguido na bancada."""

    id: int
    regiao: tuple
    visto: datetime
    inicio: datetime
    fim: datetime | None = None
    trecho: int = 0
    mudou_de_lugar: int = 0
    # a cara do lugar (de cada quadro) e a da última vez que o lanche foi visto (a do puxão)
    cara: np.ndarray | None = None
    cara_vista: np.ndarray | None = None
    # cada quadro: (hora, recorte, trecho, região, metades vistas)
    quadros: list[tuple] = field(default_factory=list)
    caixas: dict[int, tuple[int, int, int, int]] = field(default_factory=dict)
    etapas: list[str] = field(default_factory=list)

    @property
    def duracao_s(self) -> float:
        return ((self.fim or self.visto) - self.inicio).total_seconds()


def _hora(texto: str) -> datetime:
    return datetime.strptime(texto, "%Y-%m-%d %H:%M:%S.%f")


def ler_imagem(caminho: Path) -> np.ndarray | None:
    # Pelos bytes, e não pelo caminho: com acento na pasta o OpenCV não abre (ERR-111).
    try:
        return cv2.imdecode(np.fromfile(str(caminho), np.uint8), cv2.IMREAD_COLOR)
    except OSError:
        return None


class Interrompida(Exception):
    """Quem chama mandou parar no meio da leitura (a loja abriu): nada fica escrito, e a leitura recomeça depois."""


# De quantos em quantos quadros se pergunta se pode seguir (o detector leva ~0,1 s por pedaço no processador).
PERGUNTA_A_CADA = 30


def seguir(
    linhas: list[dict], recortes: Path, detector: Detector, perfil: PerfilDaBancada,
    pode_seguir: Callable[[], bool] = lambda: True,
) -> tuple[list[Trilha], int, int]:
    """Segue os lanches pela captura densa. Devolve as trilhas (todas, curtas inclusive) e o tamanho do quadro."""
    ativos: list[Trilha] = []
    todos: list[Trilha] = []
    largura = altura = 0
    ultima: datetime | None = None
    for n, linha in enumerate(linhas):
        if n % PERGUNTA_A_CADA == 0 and n and not pode_seguir():
            raise Interrompida()
        img = ler_imagem(recortes / linha["recorte"])
        if img is None:
            continue
        altura, largura = img.shape[:2]
        agora = _hora(linha["na_loja"])
        ultima = agora
        regioes = lanches_do_quadro(paes(detector, img, perfil))
        livres = list(ativos)
        sem_par = []
        vistas: dict[int, tuple] = {}
        # 1) O lanche que ficou no lugar: a região cobre a dele. Um lanche, uma região.
        for r in sorted(regioes, key=lambda r: -max((iou(a.regiao, r) for a in livres), default=0.0)):
            par = max(livres, key=lambda a: iou(a.regiao, r), default=None)
            if par is not None and iou(par.regiao, r) >= MESMO_LUGAR:
                par.regiao = tuple((1 - ACOMPANHA) * p + ACOMPANHA * q for p, q in zip(par.regiao, r[:4]))
                par.visto = agora
                vistas[par.id] = r[5]
                livres.remove(par)
            else:
                sem_par.append(r)
        # 2) O lanche que se MEXEU (empurrado, ou fechado): região sem par, perto de um lanche sem par e com a mesma cara
        #    (a do lugar). Longe, só o PUXADO ao longo da bancada: já era lanche, no mesmo eixo, com a cara muito
        #    parecida com a da última vez que foi visto.
        for r in sem_par:
            cara = aparencia(img, r)
            candidatos = [
                a for a in livres if a.cara is not None
                and math.dist(centro(a.regiao), centro(r)) < EMPURRADO_ATE * lado_maior(a.regiao)
                and lado_maior(r) <= CRESCE_ATE * lado_maior(a.regiao)
                and cv2.compareHist(a.cara, cara, cv2.HISTCMP_CORREL) >= perfil.parecido
            ]
            if not candidatos:
                candidatos = [
                    a for a in livres if a.cara_vista is not None
                    and (agora - a.inicio).total_seconds() >= perfil.duracao_minima_s
                    and lado_maior(r) <= CRESCE_ATE * lado_maior(a.regiao)
                    and fora_do_eixo(a.regiao, r, largura, altura) <= FORA_DO_EIXO * lado_maior(a.regiao)
                    and cv2.compareHist(a.cara_vista, cara, cv2.HISTCMP_CORREL) >= MESMA_CARA_LONGE
                ]
            if candidatos:
                par = min(candidatos, key=lambda a: math.dist(centro(a.regiao), centro(r)))
                par.regiao = r[:4]
                par.visto = agora
                par.mudou_de_lugar += 1
                par.trecho += 1  # empurrado: daqui em diante, outra caixa fixa
                vistas[par.id] = r[5]
                livres.remove(par)
            else:
                novo = Trilha(id=len(todos) + 1, regiao=r[:4], visto=agora, inicio=agora)
                vistas[novo.id] = r[5]
                ativos.append(novo)
                todos.append(novo)
        for a in list(ativos):
            if (agora - a.visto).total_seconds() > perfil.sumiu_s:
                a.fim = agora
                ativos.remove(a)
                continue
            # O quadro conta para o lanche mesmo sem pão visto (braço por cima, carne cobrindo a base, embrulhando).
            a.quadros.append((agora, linha["recorte"], a.trecho, tuple(a.regiao), vistas.get(a.id, ())))
            x0, y0, x1, y1 = a.regiao
            if x1 - x0 >= CAIXA_MINIMA and y1 - y0 >= CAIXA_MINIMA:
                a.cara = aparencia(img, a.regiao)
                # A do puxão é a do lanche VISTO: sem pão neste quadro, o lugar dele mostra a mão por cima ou a bancada
                # vazia (depois do puxão), e o lanche puxado não se reconheceria (16/10/2026).
                if a.id in vistas:
                    a.cara_vista = a.cara
    for a in ativos:
        a.fim = ultima
    return todos, largura, altura


def caixa_do_trecho(regioes: list[tuple], largura: int, altura: int) -> tuple[int, int, int, int]:
    """A caixa fixa de um trecho: a união das regiões do lanche. Se a união passa do dobro da região de costume (uma
    região errada no meio), a caixa de costume, centrada na mediana."""
    x0, y0 = min(r[0] for r in regioes), min(r[1] for r in regioes)
    x1, y1 = max(r[2] for r in regioes), max(r[3] for r in regioes)
    lw = float(np.median([r[2] - r[0] for r in regioes]))
    lh = float(np.median([r[3] - r[1] for r in regioes]))
    if x1 - x0 > 2 * lw or y1 - y0 > 2 * lh:
        cx = float(np.median([(r[0] + r[2]) / 2 for r in regioes]))
        cy = float(np.median([(r[1] + r[3]) / 2 for r in regioes]))
        x0, x1, y0, y1 = cx - 0.75 * lw, cx + 0.75 * lw, cy - 0.75 * lh, cy + 0.75 * lh
    return int(max(0, x0)), int(max(0, y0)), int(min(largura, x1)), int(min(altura, y1))


def nome_do_recorte(t: datetime) -> str:
    """O nome do recorte do lanche: a hora da loja, como a identificação (rodada 12) lê — "19h32m27.jpg"."""
    return f"{t:%Hh%Mm%S}.jpg"


def escrever_lanche(a: Trilha, recortes: Path, saida: Path, largura: int, altura: int, perfil: PerfilDaBancada) -> Path:
    """Os recortes do lanche na caixa fixa de cada trecho, as etapas e o `metades.csv` (as metades vistas pelo
    detector, em pixels da caixa fixa: x0:y0:x1:y1:nota, separadas por ponto e vírgula)."""
    pasta = saida / f"lanche-{a.id:02d}"
    pasta.mkdir(parents=True, exist_ok=True)
    por_trecho: dict[int, list] = {}
    for _, _, trecho, regiao, _ in a.quadros:
        por_trecho.setdefault(trecho, []).append(regiao)
    a.caixas = {t: caixa_do_trecho(rs, largura, altura) for t, rs in por_trecho.items()}
    a.etapas = []
    anterior = estavel = None
    mexendo = False
    trecho_anterior = None
    buffer = io.StringIO()
    w = csv.writer(buffer, lineterminator="\n")
    w.writerow(["quadro", "hora", "trecho", "caixa", "metades"])
    for hora, recorte, trecho, _, metades in a.quadros:
        img = ler_imagem(recortes / recorte)
        if img is None:
            continue
        x0, y0, x1, y1 = a.caixas[trecho]
        if x1 - x0 < CAIXA_MINIMA or y1 - y0 < CAIXA_MINIMA:
            continue
        pedaco = img[y0:y1, x0:x1]
        nome = nome_do_recorte(hora)
        cv2.imencode(".jpg", pedaco, [cv2.IMWRITE_JPEG_QUALITY, 92])[1].tofile(str(pasta / nome))
        vistas = ";".join(f"{b[0] - x0:.0f}:{b[1] - y0:.0f}:{b[2] - x0:.0f}:{b[3] - y0:.0f}:{b[4]:.2f}" for b in metades)
        w.writerow([nome, f"{hora:%H:%M:%S}", trecho, f"{x0}:{y0}:{x1}:{y1}", vistas])
        # As etapas: na caixa fixa, a comparação é direta (um quarto do tamanho, cinza).
        g = cv2.resize(cv2.cvtColor(pedaco, cv2.COLOR_BGR2GRAY), None, fx=0.25, fy=0.25, interpolation=cv2.INTER_AREA).astype(np.int16)
        if trecho != trecho_anterior:
            a.etapas.append(nome)  # o pão aberto, ou o lanche no lugar novo
            estavel = g
            mexendo = False
        elif anterior is not None and anterior.shape == g.shape:
            mexe = float(np.abs(g - anterior).mean())
            if mexe < perfil.mexe:
                if mexendo and estavel is not None and float(np.abs(g - estavel).mean()) >= perfil.mudou:
                    a.etapas.append(nome)
                estavel = g
                mexendo = False
            else:
                mexendo = True
        anterior = g
        trecho_anterior = trecho
    (pasta / "metades.csv").write_text(buffer.getvalue(), encoding="utf-8", newline="")
    return pasta


def lanches_da_densa(
    densa: Path, saida: Path, detector: Detector, perfil: PerfilDaBancada, *, linhas: list[dict] | None = None,
    pode_seguir: Callable[[], bool] = lambda: True,
) -> list[dict] | None:
    """A captura densa (`treino_quadros`: `paradas.csv` + `recortes/`) vira uma pasta por lanche, em `saida`.

    Devolve o resumo de cada trilha — as curtas também, marcadas como "não é lanche" —, que fica em `lanches.json`
    (escrito por último: ele existir quer dizer que a leitura terminou). Nulo quando `pode_seguir` mandou parar no
    meio: nada fica escrito, e a leitura recomeça na vez seguinte.
    """
    densa, saida = Path(densa), Path(saida)
    if linhas is None:
        from farol_agent.treino_quadros import linhas_da_densa

        linhas = list(linhas_da_densa(densa))
    recortes = densa / "recortes"
    try:
        todos, largura, altura = seguir(linhas, recortes, detector, perfil, pode_seguir)
    except Interrompida:
        return None
    saida.mkdir(parents=True, exist_ok=True)
    resumo = []
    for a in todos:
        e_lanche = a.duracao_s >= perfil.duracao_minima_s
        if e_lanche:
            escrever_lanche(a, recortes, saida, largura, altura, perfil)
        resumo.append({
            "lanche": a.id,
            "inicio": f"{a.inicio:%Y-%m-%d %H:%M:%S}",
            "fim": f"{a.fim:%Y-%m-%d %H:%M:%S}" if a.fim else None,
            "duracaoS": round(a.duracao_s, 1),
            "eLanche": e_lanche,
            "mudouDeLugar": a.mudou_de_lugar,
            "quadros": len(a.quadros),
            "etapas": list(a.etapas),
            "pasta": f"lanche-{a.id:02d}" if e_lanche else None,
        })
    (saida / RESUMO).write_text(json.dumps(resumo, ensure_ascii=False, indent=1), encoding="utf-8")
    return resumo


RESUMO = "lanches.json"


def lanches_ja_lidos(saida: Path) -> list[dict] | None:
    """O resumo de uma leitura que já terminou (o `lanches.json` é escrito por último), ou nulo."""
    try:
        bruto = json.loads((Path(saida) / RESUMO).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return bruto if isinstance(bruto, list) and all(isinstance(r, dict) for r in bruto) else None
