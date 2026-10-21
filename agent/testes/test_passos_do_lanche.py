"""Os passos do lanche (A23.3): em cada metade do pão, o que chegou e quando.

A bancada aqui é desenhada: o tampo cinza, o papel claro com um desenho fixo (como os logos impressos, que dão ao encaixe
onde se prender), as metades do pão como discos com textura, e o que chega nelas: a fatia de queijo (um quadrado amarelo),
a carne (um disco marrom), a mão e o braço (manchas escuras), a tampa do fechamento. Os discos e as caixas do detector
são passados prontos (o Hough tem o teste dele). O que se protege:

- o que chegou numa metade é um passo, na hora do primeiro quadro parado, só nela;
- a mão que passa não é passo; o braço apoiado parado e que depois sai é PASSAGEM (os dois passos, transitórios);
- a luz que muda na bancada inteira não é passo;
- o pão empurrado dentro da folga não é passo, e a janela não anda com o encaixe (ERR-137);
- o FECHAMENTO é o primeiro passo em que o que chegou é papel; o que vem depois não conta; a carne que ficou parada um
  quadro só antes da tampa é o passo PROVISÓRIO — e a sobra pequena, não;
- as metades: o grupo de poucos pontos, o sem caixa do detector e o do lugar de antes do empurrão não são metade; a
  metade só é olhada depois de estar no lugar dela;
- os discos do Hough só abaixo do topo da bancada; o recorte da metade;
- com o JUIZ DE INGREDIENTE (aqui, um de mentira que olha a cor do miolo da janela): a peça que sai da janela (o lanche
  levado: a janela vê o inox) termina ali, e nada depois dela conta — nem o pão do lanche seguinte no mesmo lugar; o
  passo sem ingrediente que não toma a janela é vazio; a metade que não começa em comida sai; o começo e os passos levam
  o nome e a nota.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

import cv2
import numpy as np

from farol_agent import passos_do_lanche as pdl

LARGURA, ALTURA = 960, 540
T0 = datetime(2026, 10, 18, 21, 9, 0)
D = 140  # o diâmetro do pão, em pixels
TAMPA, BASE = (300, 250), (300, 420)
PAPEL = (170, 150, 430, 530)
CINZA_PAO = (150, 195, 220)
QUEIJO = (20, 190, 250)
CARNE = (40, 70, 115)
MAO = (70, 100, 150)
COROA = (40, 110, 190)


def _desenho(semente: int, h: int, w: int, forca: int) -> np.ndarray:
    ruido = np.random.default_rng(semente).integers(-forca, forca + 1, (h, w)).astype(np.float32)
    return cv2.GaussianBlur(ruido, (0, 0), 1.2).astype(np.int16)[..., None]


FUNDO = _desenho(1, ALTURA, LARGURA, 10)
MANCHAS = _desenho(2, ALTURA, LARGURA, 30)


def mesa(paes=(TAMPA, BASE), queijos=(), carnes=(), maos=(), coroas=(), luz=0, empurrao=(0, 0), papel_na_mesa=True,
         inox=(95, 95, 95)) -> np.ndarray:
    """A bancada num quadro: `paes` (cx, cy); `queijos` (cx, cy, lado); `carnes` (cx, cy, raio); `maos` (x0, y0, x1, y1);
    `coroas` (cx, cy): a tampa já virada em cima; `luz`: somada ao quadro todo; `empurrao`: o papel e tudo em cima dele
    andam (dx, dy); sem `papel_na_mesa`, só o inox (o lanche foi levado com o papel); `inox`: a cor do tampo."""
    img = np.empty((ALTURA, LARGURA, 3), np.int16)
    img[:] = inox
    x0, y0, x1, y1 = PAPEL
    papel = np.zeros((ALTURA, LARGURA), np.uint8)
    if papel_na_mesa:
        cv2.rectangle(papel, (x0, y0), (x1, y1), 1, -1)
    img[papel.astype(bool)] = (200, 215, 225)
    # o desenho impresso no papel (fixo): manchas fortes onde o papel está
    img = np.where(papel[..., None].astype(bool), img + MANCHAS, img + FUNDO)
    for cx, cy in paes:
        cv2.circle(img, (cx, cy), D // 2, CINZA_PAO, -1)
    for cx, cy, lado in queijos:
        cv2.rectangle(img, (cx - lado // 2, cy - lado // 2), (cx + lado // 2, cy + lado // 2), QUEIJO, -1)
    for cx, cy, r in carnes:
        cv2.circle(img, (cx, cy), r, CARNE, -1)
    for cx, cy in coroas:
        cv2.circle(img, (cx, cy), D // 2 + 4, COROA, -1)
    # a textura do pão e do que está em cima dele (a mesma em todo quadro: é a cara da coisa, não ruído do sensor)
    dentro = np.zeros((ALTURA, LARGURA), np.uint8)
    for cx, cy in list(paes) + list(coroas):
        cv2.circle(dentro, (cx, cy), D // 2 + 4, 1, -1)
    img = np.where(dentro[..., None].astype(bool), img + FUNDO, img)
    for a0, b0, a1, b1 in maos:
        cv2.rectangle(img, (a0, b0), (a1, b1), MAO, -1)
    if empurrao != (0, 0):
        img = cv2.warpAffine(img.astype(np.float32), np.float32([[1, 0, empurrao[0]], [0, 1, empurrao[1]]]), (LARGURA, ALTURA),
                             borderMode=cv2.BORDER_REPLICATE).astype(np.int16)
    return np.clip(img + luz, 0, 255).astype(np.uint8)


def caixas_de(paes) -> list[tuple]:
    return [(cx - D / 2, cy - D / 2, cx + D / 2, cy + D / 2, 0.9) for cx, cy in paes]


def ler(cena: list[np.ndarray], paes=(TAMPA, BASE), p: pdl.Parametros | None = None, pontos_de=None, juiz=None) -> pdl.Leitura:
    """Lê a cena (um quadro por segundo desde T0). `pontos_de(i)`: os pães vistos no quadro i (padrão: os dois no lugar)."""
    passos = pdl.PassosDoLanche(p or pdl.Parametros())
    quadros = {}
    for i, img in enumerate(cena):
        nome = f"q{i:03d}"
        quadros[nome] = img
        vistos = pontos_de(i) if pontos_de else paes
        passos.ver(nome, T0 + timedelta(seconds=i), img, caixas_de(vistos), 0, LARGURA,
                   achados=[(float(cx), float(cy), float(D)) for cx, cy in vistos])
    return passos.ler(lambda nome: quadros.get(nome), juiz=juiz)


def seg(s: pdl.Passo) -> int:
    return int((s.hora - T0).total_seconds())


def contados(leitura: pdl.Leitura) -> list[tuple[int, str, int]]:
    """Os passos que não são o começo: (metade, tipo, segundo)."""
    return [(s.metade, s.tipo, seg(s)) for s in leitura.passos if s.tipo != "comeco"]


def test_o_queijo_que_chega_na_tampa_e_um_passo_na_hora_do_primeiro_quadro_parado():
    cena = [mesa()] * 4 + [mesa(maos=[(250, 180, 420, 240)]), mesa(maos=[(280, 200, 430, 270)])]
    cena += [mesa(queijos=[(300, 250, 96)])] * 4
    leitura = ler(cena)
    assert [(m.k, round(m.cx), round(m.cy)) for m in leitura.metades] == [(1, 300, 250), (2, 300, 420)]
    assert [(s.metade, seg(s)) for s in leitura.passos if s.tipo == "comeco"] == [(1, 1), (2, 1)]
    assert contados(leitura) == [(1, "passo", 7)]
    passo = next(s for s in leitura.passos if s.tipo == "passo")
    # a parte é do disco da JANELA (0,62 do diâmetro do pão: pega o que passa da borda): a fatia de 96 px no pão de 140
    # é 9216 / 23674 = 0,39 dele
    assert 0.35 <= passo.parte <= 0.5
    assert passo.papel is not None and passo.papel < 0.2
    assert passo.mascara is not None and passo.mascara.dtype == bool
    assert leitura.fechou is None


def test_a_mao_que_passa_nao_e_passo():
    cena = [mesa()] * 4 + [mesa(maos=[(250, 180, 420, 240)]), mesa(maos=[(240, 380, 420, 450)]), mesa(maos=[(290, 220, 440, 300)])]
    cena += [mesa()] * 4
    assert contados(ler(cena)) == []


def test_o_braco_apoiado_parado_e_que_sai_e_passagem():
    cena = [mesa()] * 4 + [mesa(maos=[(300, 222, 430, 278)])] * 5 + [mesa(maos=[(330, 240, 440, 300)])] + [mesa()] * 4
    assert contados(ler(cena)) == [(1, "transitorio", 5), (1, "transitorio", 11)]


def test_a_luz_que_muda_na_bancada_inteira_nao_e_passo():
    # o colaborador que chega escurece a bancada (medido em 14/10: o cheddar foi de L 165 a 136); sem a correção pelo
    # papel em volta, a diferença passa do limite de mudança
    cena = [mesa()] * 4 + [mesa(luz=-35)] * 3 + [mesa(luz=-10)] * 3
    assert contados(ler(cena)) == []


def test_o_papel_empurrado_dentro_da_folga_nao_e_passo_e_a_janela_nao_anda():
    cena = [mesa()] * 4 + [mesa(maos=[(150, 300, 300, 360)])] + [mesa(empurrao=(14, 6))] * 4
    cena += [mesa(empurrao=(14, 6), maos=[(250, 180, 420, 240)])] + [mesa(empurrao=(14, 6), queijos=[(300, 250, 96)])] * 3
    leitura = ler(cena)
    assert contados(leitura) == [(1, "passo", 11)]
    assert [(round(m.cx), round(m.cy)) for m in leitura.metades] == [(300, 250), (300, 420)]


def test_fechou_quando_a_tampa_sai_e_a_carne_parada_um_quadro_so_e_provisoria():
    cena = [mesa()] * 4
    cena += [mesa(maos=[(250, 360, 420, 430)])]  # a carne vindo na espátula
    cena += [mesa(carnes=[(300, 420, 64)], maos=[(380, 360, 450, 480)])]  # a carne pousada, a mão ainda ali
    cena += [mesa(carnes=[(300, 420, 64)])]  # UM quadro parado com a carne
    cena += [mesa(paes=[BASE], carnes=[(300, 420, 64)], coroas=[(305, 330)], maos=[(260, 280, 400, 380)])]  # a tampa virando
    cena += [mesa(paes=[BASE], carnes=[(300, 420, 64)], coroas=[BASE])] * 3  # fechado
    cena += [mesa(paes=[BASE], carnes=[(300, 420, 64)], coroas=[BASE], maos=[(200, 380, 420, 500)])] * 2  # o embrulho
    leitura = ler(cena, pontos_de=lambda i: [TAMPA, BASE] if i < 7 else [BASE])
    assert leitura.fechou == T0 + timedelta(seconds=9)
    assert contados(leitura) == [(2, "provisorio", 6), (1, "fechou", 9)]
    provisorio = next(s for s in leitura.passos if s.tipo == "provisorio")
    assert provisorio.quadro == "q006" and provisorio.parte >= 0.5
    # nada depois do fechamento: a tampa chegando na base e o embrulho não são passo
    assert all(s.hora <= leitura.fechou for s in leitura.passos)


def test_a_sobra_pequena_antes_do_fechamento_nao_vira_provisorio():
    cena = [mesa()] * 4
    cena += [mesa(maos=[(250, 360, 420, 430)]), mesa(queijos=[(320, 440, 70)], maos=[(380, 360, 450, 480)])]
    cena += [mesa(queijos=[(320, 440, 70)])]  # UM quadro com um pedaço (~20% do disco da janela): pendente, não confirmado
    cena += [mesa(paes=[BASE], queijos=[(320, 440, 70)], coroas=[(305, 330)], maos=[(260, 280, 400, 380)])]
    cena += [mesa(paes=[BASE], coroas=[BASE])] * 3
    leitura = ler(cena, pontos_de=lambda i: [TAMPA, BASE] if i < 7 else [BASE])
    assert [t for _, t, _ in contados(leitura)] == ["fechou"]
    # o pedaço chegou a ser pendente (senão o teste não prova o limite): ele é o último antes do fechamento, pequeno
    p = pdl.Parametros()
    assert 0.10 <= 70 * 70 / (np.pi * (p.raio * D) ** 2) < p.provisorio_min


def test_o_provisorio_e_o_ultimo_pendente_antes_do_fechamento_e_nao_o_maior():
    # no P7, a sobra grande da junção das peças (21:10:39, 67%) veio antes da pequena (21:10:43, 36%): quem estava na metade
    # quando a tampa veio era a pequena, e nada vira provisório
    cena = [mesa()] * 4
    cena += [mesa(maos=[(250, 360, 420, 430)]), mesa(carnes=[(300, 420, 64)], maos=[(380, 360, 450, 480)])]
    cena += [mesa(carnes=[(300, 420, 64)])]  # a carne parada UM quadro (6)
    cena += [mesa(maos=[(240, 370, 420, 470)])]  # tirada
    cena += [mesa(queijos=[(320, 440, 70)], maos=[(380, 360, 450, 480)]), mesa(queijos=[(320, 440, 70)])]  # o pedaço (9)
    cena += [mesa(paes=[BASE], queijos=[(320, 440, 70)], coroas=[(305, 330)], maos=[(260, 280, 400, 380)])]
    cena += [mesa(paes=[BASE], coroas=[BASE])] * 3
    leitura = ler(cena, pontos_de=lambda i: [TAMPA, BASE] if i < 10 else [BASE])
    assert [t for _, t, _ in contados(leitura)] == ["fechou"]


def test_as_metades_saem_dos_grupos_fortes_com_caixa_do_detector():
    p = pdl.Parametros()
    pontos = [pdl.Ponto(f"q{i}", 300, 250, D, True) for i in range(20)]
    pontos += [pdl.Ponto(f"q{i}", 302, 421, D, i % 2 == 0) for i in range(18)]
    pontos += [pdl.Ponto(f"q{i}", 600, 300, D, False) for i in range(20)]  # o logo redondo do papel: sem caixa
    pontos += [pdl.Ponto(f"q{i}", 185, 250, D, True) for i in range(4)]  # o lugar de antes do empurrão: poucos pontos
    pontos += [pdl.Ponto(f"q{i}", 800, 400, D, True) for i in range(2)]  # visto 2 vezes só
    grupos = pdl.agrupar(pontos, p)
    assert len(grupos) == 5
    fortes = pdl.metades_fortes(grupos, p)
    assert [(round(g.cx), round(g.cy), g.pontos) for g in fortes] == [(300, 250, 20), (302, 421, 18)]


def test_a_metade_so_e_olhada_depois_de_estar_no_lugar_dela():
    # a base chega no segundo 5 (antes, só a tampa); o que mudou antes disso no lugar dela não é passo dela
    cena = [mesa(paes=[TAMPA])] * 5 + [mesa()] * 5
    leitura = ler(cena, pontos_de=lambda i: [TAMPA] if i < 5 else [TAMPA, BASE])
    desde = {m.k: int((m.desde - T0).total_seconds()) for m in leitura.metades}
    assert desde == {1: 0, 2: 5}
    assert [(s.metade, seg(s)) for s in leitura.passos if s.tipo == "comeco"] == [(1, 1), (2, 6)]
    assert contados(leitura) == []


def test_sem_metade_nao_ha_passo_e_nao_abre_quadro():
    abertos = []
    passos = pdl.PassosDoLanche()
    for i in range(5):
        passos.ver(f"q{i}", T0 + timedelta(seconds=i), mesa(), [], 0, LARGURA, achados=[])
    leitura = passos.ler(lambda nome: abertos.append(nome))
    assert leitura.metades == [] and leitura.passos == [] and leitura.fechou is None and abertos == []


def test_os_discos_do_hough_so_abaixo_do_topo_da_bancada():
    img = np.full((ALTURA, LARGURA, 3), 200, np.uint8)  # o papel claro
    for cx, cy in ((200, 60), (500, 360)):  # o de cima está na frente das cubas: não é bancada
        cv2.circle(img, (cx, cy), 70, (40, 90, 150), -1)  # a casca
        cv2.circle(img, (cx, cy), 60, (170, 205, 230), -1)  # o miolo
    achados = pdl.discos(img, 0, LARGURA)
    assert len(achados) == 1
    cx, cy, d = achados[0]
    assert abs(cx - 500) < 6 and abs(cy - 360) < 6 and abs(d - 140) < 12
    assert pdl.discos(img, 0, 100) == []  # a faixa mais estreita que um pão


def test_o_recorte_da_metade_e_a_janela_dela_no_quadro_cheio():
    img = mesa()
    m = pdl.MetadeVista(1, 300.0, 250.0, float(D), T0)
    r = pdl.recorte(img, m)
    lado = 2 * int(0.62 * D)
    assert r.shape[:2] == (lado, lado)
    assert np.array_equal(r, img[250 - lado // 2:250 + lado // 2, 300 - lado // 2:300 + lado // 2])


# ───────────────────────── o juiz de ingrediente ─────────────────────────

@dataclass(frozen=True)
class _Visto:
    nome: str | None
    nota: float
    ingrediente: str | None

    def comida(self) -> bool:
        return self.nota >= 0.48


# O inox frio: o tampo da loja, sob a luz dela, não tem o matiz do papel (nos passos de saída da primeira noite, o que
# chegou era papel em 0 a 60%). O cinza neutro do desenho, com a correção de luz pelo anel de papel, vira "papel".
INOX_FRIO = (140, 105, 75)
CORES = {"Pão": CINZA_PAO, "Queijo": QUEIJO, "Carne": CARNE, "Coroa": COROA, "inox": INOX_FRIO,
         "papel": (200, 215, 225), "mão": MAO}
COMIDA = {"Pão", "Queijo", "Carne", "Coroa"}


class JuizDeMentira:
    """O juiz pela cor do MIOLO da janela: comida (0,70) se é pão, queijo, carne ou a tampa; o resto, `nada` (0,20)."""

    def __init__(self, nada: float = 0.20) -> None:
        self.olhados: list[tuple[int, int]] = []
        self.nada = nada

    def __call__(self, corte: np.ndarray) -> _Visto:
        h, w = corte.shape[:2]
        self.olhados.append((h, w))
        miolo = corte[h // 2 - 10:h // 2 + 10, w // 2 - 10:w // 2 + 10].reshape(-1, 3).mean(axis=0)
        nome = min(CORES, key=lambda n: float(np.linalg.norm(miolo - np.array(CORES[n], np.float64))))
        if nome in COMIDA:
            return _Visto(nome, 0.70, None if nome == "Pão" else nome)
        return _Visto(nome, self.nada, None)


def _levado() -> list[np.ndarray]:
    """O queijo na tampa (parado no segundo 6); o lanche levado com o papel no 8 (a janela passa a ver o inox, parada já
    no 9: a mão do desenho é lisa, e a correção de luz pelo anel em volta tira a troca de uma cor lisa pela outra); o pão
    do lanche seguinte no lugar da tampa no 12 (parado no 13)."""
    return [mesa(inox=INOX_FRIO)] * 4 + [mesa(maos=[(250, 180, 420, 240)], inox=INOX_FRIO)] \
        + [mesa(queijos=[(300, 250, 96)], inox=INOX_FRIO)] * 3 \
        + [mesa(paes=[], papel_na_mesa=False, maos=[(200, 150, 450, 520)], inox=INOX_FRIO)] \
        + [mesa(paes=[], papel_na_mesa=False, inox=INOX_FRIO)] * 3 + [mesa(paes=[TAMPA], papel_na_mesa=False, inox=INOX_FRIO)] * 3


def test_sem_o_juiz_o_lanche_levado_vira_passo():
    # o que a primeira noite ao vivo mostrou (20 para 21/10): a janela fixa vê o inox quando o lanche sai, e isso contava
    assert contados(ler(_levado())) == [(1, "passo", 6), (1, "passo", 9), (2, "passo", 9), (1, "passo", 13)]


def test_com_o_juiz_a_peca_que_sai_da_janela_termina_ali_e_nada_depois_conta():
    juiz = JuizDeMentira()
    leitura = ler(_levado(), juiz=juiz)
    # o queijo fica; o inox na tampa e na base é a peça saindo (toma a janela inteira); o pão do lanche seguinte, no lugar
    # da tampa, não é deste lanche
    assert contados(leitura) == [(1, "passo", 6), (1, "saiu", 9), (2, "saiu", 9)]
    queijo = next(s for s in leitura.passos if s.tipo == "passo")
    assert (queijo.nome, queijo.nota) == ("Queijo", 0.70)
    assert all(s.nome is None and s.nota == 0.20 for s in leitura.passos if s.tipo == "saiu")
    # o começo leva o nome mais parecido de todos (o pão) e a nota
    assert {(s.metade, s.nome, s.nota) for s in leitura.passos if s.tipo == "comeco"} == {(1, "Pão", 0.70), (2, "Pão", 0.70)}
    # o juiz olhou a JANELA da metade, no quadro cheio
    lado = 2 * int(0.62 * D)
    assert set(juiz.olhados) == {(lado, lado)}
    assert leitura.fechou is None


def test_com_o_juiz_o_grande_sem_ingrediente_mas_perto_da_nota_de_comida_e_vazio_e_nao_corta_a_metade():
    # a base do P7 em 18/10 (ovo, queijo e alface: 0,477) — abaixo da nota de comida, mas na margem do "saiu": o passo não
    # conta, e o que vem depois na metade é julgado um a um (aqui, o pão do lanche seguinte, que é comida)
    leitura = ler(_levado(), juiz=JuizDeMentira(nada=0.46))
    assert contados(leitura) == [(1, "passo", 6), (1, "vazio", 9), (2, "vazio", 9), (1, "passo", 13)]


def test_com_o_juiz_o_que_nao_e_ingrediente_e_nao_toma_a_janela_e_vazio():
    # um pegador largado em cima da tampa e esquecido ali: muda o miolo, mas é menos da metade da janela
    pegador = (250, 200, 350, 300)
    cena = [mesa()] * 4 + [mesa(maos=[(250, 180, 420, 240)])] + [mesa(maos=[pegador])] * 4
    sem = ler(cena)
    assert contados(sem) == [(1, "passo", 6)]
    assert next(s for s in sem.passos if s.tipo == "passo").parte < pdl.Parametros().saiu_parte
    com = ler(cena, juiz=JuizDeMentira())
    assert contados(com) == [(1, "vazio", 6)]
    assert next(s for s in com.passos if s.tipo == "vazio").nome is None


def test_com_o_juiz_a_metade_que_nao_comeca_em_comida_sai():
    # um terceiro "pão" visto no inox ao lado do papel (o detector e o Hough acharam): não é peça do lanche
    fora = (600, 300)
    cena = [mesa()] * 4 + [mesa(maos=[(250, 180, 420, 240)])] + [mesa(queijos=[(300, 250, 96)])] * 3
    sem = ler(cena, pontos_de=lambda i: [TAMPA, BASE, fora])
    assert [(round(m.cx), round(m.cy)) for m in sem.metades] == [(300, 250), (600, 300), (300, 420)]
    com = ler(cena, pontos_de=lambda i: [TAMPA, BASE, fora], juiz=JuizDeMentira())
    assert [(round(m.cx), round(m.cy)) for m in com.metades] == [(300, 250), (300, 420)]
    assert {s.metade for s in com.passos} == {1, 3}
    assert contados(com) == [(1, "passo", 6)]


def test_o_juiz_nao_olha_a_passagem_nem_o_fechamento():
    juiz = JuizDeMentira()
    cena = [mesa()] * 4 + [mesa(maos=[(300, 222, 430, 278)])] * 5 + [mesa(maos=[(330, 240, 440, 300)])] + [mesa()] * 4
    leitura = ler(cena, juiz=juiz)
    assert contados(leitura) == [(1, "transitorio", 5), (1, "transitorio", 11)]
    # só os dois começos foram olhados
    assert len(juiz.olhados) == 2
