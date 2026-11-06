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
    # com a janela que segue, igual: dentro da folga o encaixe absorve, e a janela não anda (ERR-137)
    seguindo = ler(cena, p=pdl.Parametros(segue=True))
    assert contados(seguindo) == [(1, "passo", 11)]
    assert {(round(s.cx), round(s.cy)) for s in seguindo.passos} <= {(300, 250), (300, 420)}


# ───────────────────────── a janela que segue (05/11/2026) ─────────────────────────

SEGUE = pdl.Parametros(segue=True)


def _empurrado(dx: int):
    """O queijo na tampa (5→6); a mão empurra o lanche inteiro, papel junto, `dx` px para a direita (8); a carne chega
    na base já no lugar novo (13→15). O detector vê os pães onde estão: antes do empurrão no lugar de antes."""
    e = (dx, 0)
    cena = [mesa()] * 4 + [mesa(maos=[(250, 180, 420, 240)])] + [mesa(queijos=[(300, 250, 96)])] * 3
    cena += [mesa(queijos=[(300, 250, 96)], maos=[(150, 300, 300, 360)])]
    cena += [mesa(queijos=[(300, 250, 96)], empurrao=e)] * 4
    cena += [mesa(queijos=[(300, 250, 96)], maos=[(250, 360, 420, 430)], empurrao=e)]
    cena += [mesa(queijos=[(300, 250, 96)], carnes=[(300, 420, 64)], empurrao=e)] * 4
    depois = [(TAMPA[0] + dx, TAMPA[1]), (BASE[0] + dx, BASE[1])]
    return cena, (lambda i: [TAMPA, BASE] if i < 9 else depois)


def test_o_lanche_empurrado_com_a_janela_fixa_fica_torto_e_da_passos_falsos():
    # o que o dono viu ("só a ponta do hambúrguer aparece"): empurrado 60 px, os pontos de antes e de depois caem no mesmo
    # grupo, e a janela fixa nasce no MEIO do caminho; o empurrão vira passo nas duas metades
    cena, pontos = _empurrado(60)
    leitura = ler(cena, pontos_de=pontos)
    assert [(round(m.cx), round(m.cy)) for m in leitura.metades] == [(330, 250), (330, 420)]
    assert contados(leitura) == [(1, "passo", 6), (2, "passo", 9), (1, "passo", 10), (2, "passo", 15)]


def test_a_janela_que_segue_nasce_onde_o_pao_estava_e_anda_com_o_lanche_empurrado():
    cena, pontos = _empurrado(60)
    leitura = ler(cena, p=SEGUE, pontos_de=pontos)
    # nasce no lugar do pão nos primeiros quadros; o empurrão não é passo; a carne é, já no lugar novo
    assert [(round(m.cx), round(m.cy)) for m in leitura.metades] == [(300, 250), (300, 420)]
    assert contados(leitura) == [(1, "passo", 6), (2, "passo", 15)]
    queijo, carne = (s for s in leitura.passos if s.tipo == "passo")
    assert (round(queijo.cx), round(queijo.cy)) == (300, 250)
    assert abs(carne.cx - 360) <= 4 and abs(carne.cy - 420) <= 4
    # o recorte de cada passo sai da janela daquele passo
    j = pdl.janela_do_passo(carne, 2, 300.0, 420.0, float(D), None)
    assert (j.cx, j.cy) == (carne.cx, carne.cy)
    assert pdl.janela_do_passo(pdl.Passo(T0, 1, "passo", 0.5, 0.0, "q"), 1, 300.0, 250.0, float(D), None).cx == 300.0


def test_a_janela_que_segue_a_mesma_peca_vista_no_lugar_novo_nao_e_outra_metade():
    # empurrado 120 px: os pontos de depois formam OUTRO grupo — com a janela fixa, 4 metades (dois "lanches"), e a de
    # antes vê o vazio como passo
    cena, pontos = _empurrado(120)
    fixa = ler(cena, pontos_de=pontos)
    assert len(fixa.metades) == 4
    assert (1, "passo", 10) in contados(fixa)
    seguindo = ler(cena, p=SEGUE, pontos_de=pontos)
    assert [(m.k, round(m.cx), round(m.cy)) for m in seguindo.metades] == [(1, 300, 250), (3, 300, 420)]
    assert contados(seguindo) == [(1, "passo", 6), (3, "passo", 15)]
    carne = next(s for s in seguindo.passos if seg(s) == 15)
    assert abs(carne.cx - 420) <= 4


def test_a_janela_que_segue_nao_anda_com_o_que_chega():
    cena = [mesa()] * 4 + [mesa(maos=[(250, 180, 420, 240)]), mesa(maos=[(280, 200, 430, 270)])]
    cena += [mesa(queijos=[(300, 250, 96)])] * 4 + [mesa(queijos=[(300, 250, 96)], carnes=[(300, 420, 66)])] * 4
    fixa, seguindo = ler(cena), ler(cena, p=SEGUE)
    assert contados(seguindo) == contados(fixa) == [(1, "passo", 7), (2, "passo", 11)]
    assert all((round(s.cx), round(s.cy)) in {(300, 250), (300, 420)} for s in seguindo.passos)


def test_a_janela_que_segue_nao_vai_para_onde_ja_se_via_pao():
    # o lugar novo já tinha pão ANTES de a peça sumir (o vizinho parecido estava ali): a janela não pula para ele
    cena, pontos = _empurrado(120)
    vizinho = [(TAMPA[0] + 120, TAMPA[1]), (BASE[0] + 120, BASE[1])]
    leitura = ler(cena, p=SEGUE, pontos_de=lambda i: pontos(i) + (vizinho if i < 4 else []))
    assert all((round(s.cx), round(s.cy)) in {(300, 250), (300, 420), (420, 250), (420, 420)} for s in leitura.passos)
    assert not any(s.metade in (1, 3) and s.cx is not None and round(s.cx) != 300 for s in leitura.passos)


def test_a_janela_que_segue_nao_pula_para_um_pedaco_parecido_quando_a_peca_esta_no_lugar():
    # um pedaço igual ao pão de antes do queijo aparece em volta (o mesmo desenho, colado), e uma fatia pequena chega no
    # pão: a peça continua no lugar (a correlação de perto é boa) — a janela não procura, não pula
    copia = mesa()[250 - 86:250 + 86, 300 - 86:300 + 86].copy()

    def com_copia(img):
        img = img.copy()
        img[250 - 86:250 + 86, 480 - 86:480 + 86] = copia
        return img

    cena = [mesa()] * 4 + [mesa(maos=[(250, 180, 420, 240)])] + [com_copia(mesa(queijos=[(300, 250, 70)]))] * 4
    longe = pdl.Parametros(segue=True, busca=1.5)  # a busca alcança a cópia (180 px)
    leitura = ler(cena, p=longe)
    assert contados(leitura) == [(1, "passo", 6)]
    assert all((round(s.cx), round(s.cy)) in {(300, 250), (300, 420)} for s in leitura.passos)


def _contar_procuras(monkeypatch) -> list[int]:
    vezes: list[int] = []
    original = pdl._Metade._onde_andou

    def contando(self, img, cinza_l):
        vezes.append(self.k)
        return original(self, img, cinza_l)

    monkeypatch.setattr(pdl._Metade, "_onde_andou", contando)
    return vezes


def test_a_janela_que_segue_so_procura_com_a_cena_parada(monkeypatch):
    # o custo: a busca em volta é a conta mais cara do quadro — a mão passando (a cena mexendo) não faz procurar
    vezes = _contar_procuras(monkeypatch)
    cena = [mesa()] * 4 + [mesa(maos=[(250, 180, 420, 240)]), mesa(maos=[(240, 380, 420, 450)]), mesa(maos=[(290, 220, 440, 300)])]
    cena += [mesa()] * 4
    assert contados(ler(cena, p=SEGUE)) == [] and vezes == []


def test_a_janela_que_segue_nao_procura_sem_mudanca(monkeypatch):
    # nem com a luz da bancada mudando (corrigida pelo papel em volta): sem o que mudou, nada a procurar
    vezes = _contar_procuras(monkeypatch)
    cena = [mesa()] * 4 + [mesa(luz=-35)] * 3 + [mesa(luz=-10)] * 3
    assert contados(ler(cena, p=SEGUE)) == [] and vezes == []


def test_com_o_juiz_a_janela_que_segue_julga_onde_a_janela_estava():
    # empurrado 120 px: a carne chega na base no lugar novo — o juiz olha a janela que andou (no lugar de onde a metade
    # nasceu, agora, só o papel)
    cena, pontos = _empurrado(120)
    leitura = ler(cena, p=SEGUE, pontos_de=pontos, juiz=JuizDeMentira(nada=0.46))
    assert [(s.metade, s.tipo, seg(s), s.nome) for s in leitura.passos if s.tipo != "comeco"] == [
        (1, "passo", 6, "Queijo"), (3, "passo", 15, "Carne")]


def test_a_janela_que_segue_nao_sai_da_faixa_do_lugar():
    cena, pontos = _empurrado(60)
    passos = pdl.PassosDoLanche(SEGUE)
    quadros = {}
    for i, img in enumerate(cena):
        quadros[f"q{i:03d}"] = img
        vistos = [v for v in pontos(i) if v[0] <= 340]
        passos.ver(f"q{i:03d}", T0 + timedelta(seconds=i), img, caixas_de(vistos), 0, 340,
                   achados=[(float(cx), float(cy), float(D)) for cx, cy in vistos])
    leitura = passos.ler(lambda nome: quadros.get(nome))
    assert all(s.cx is None or s.cx <= 340 for s in leitura.passos)


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


# ───────────────────────── as metades fantasmas (o 2c) ─────────────────────────


def test_a_regua_das_fantasmas_nasce_desligada_com_os_numeros_medidos():
    p = pdl.Parametros()
    assert (p.sem_fantasma, p.miolo, p.janela_pao, p.mesmo_pao, p.cor_do_pao) == (False, 0.3, 8, 0.7, 24.0)


def test_a_cor_do_miolo_separa_o_pao_do_inox_e_do_papel():
    img = mesa()
    pao, inox, papel = (pdl.croma_do_miolo(img, x, y, D) for x, y in (TAMPA, (700, 300), (200, 480)))
    assert pao is not None and inox is not None and papel is not None
    assert pao > 24 > 12 > papel > inox
    # o pão contado de novo a meio diâmetro: metade do miolo no pão, metade no papel
    meio = pdl.croma_do_miolo(img, TAMPA[0] + D // 2, TAMPA[1], D)
    assert meio is not None and papel < meio < pao
    # o canto do quadro (preso em 0 antes de fatiar) e fora dele
    assert pdl.croma_do_miolo(img, 5, ALTURA - 5, D) is not None
    assert pdl.croma_do_miolo(img, -200, -200, D) is None


def test_a_cor_do_miolo_e_so_do_disco_e_nao_dos_cantos_do_quadrado():
    img = np.full((200, 200, 3), 128, np.uint8)  # cinza: croma zero
    r = int(0.3 * 100)
    for x, y in ((70, 70), (130 - 6, 70), (70, 130 - 6), (130 - 6, 130 - 6)):  # os cantos do quadrado de lado 2r em volta
        img[y:y + 6, x:x + 6] = (0, 200, 255)
    assert 100 - r == 70
    assert pdl.croma_do_miolo(img, 100, 100, 100) == 0.0


def test_o_croma_conta_o_vermelho_e_o_verde_tambem_e_nao_so_o_amarelo():
    # uma cor só no eixo a do Lab (b no meio: nem amarelo nem azul) — o vermelho do ketchup, o verde da alface — não é cinza
    for a in (128 + 50, 128 - 50):
        cor = cv2.cvtColor(np.uint8([[[150, a, 128]]]), cv2.COLOR_LAB2BGR)[0, 0]
        img = np.full((60, 60, 3), cor, np.uint8)
        lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32)
        assert abs(float(lab[..., 2].mean()) - 128) < 8, "a cor de teste quase não tem b"
        croma = pdl.croma_do_miolo(img, 30, 30, 40)
        assert croma is not None and croma > 30


def test_o_miolo_e_tres_decimos_do_diametro():
    # um anel colorido de 20 a 30 px em volta do centro, no cinza: no miolo de 30 px (0,3 de 100), ele é 5/9 da área
    img = np.full((200, 200, 3), 128, np.uint8)
    cv2.circle(img, (100, 100), 30, (0, 200, 255), -1)
    cv2.circle(img, (100, 100), 20, (128, 128, 128), -1)
    cheio = np.full((10, 10, 3), (0, 200, 255), np.uint8)
    cor = pdl.croma_do_miolo(cheio, 5, 5, 20)
    assert cor is not None and cor > 50
    anel = pdl.croma_do_miolo(img, 100, 100, 100)
    assert anel is not None and abs(anel / cor - 5 / 9) < 0.1


def test_cada_ponto_leva_a_cor_do_miolo_da_caixa_e_do_disco():
    img = mesa()
    passos = pdl.PassosDoLanche()
    passos.ver("q0", T0, img, caixas_de([TAMPA]), 0, LARGURA, achados=[])
    passos.ver("q1", T0 + timedelta(seconds=1), img, [], 0, LARGURA, achados=[(700.0, 300.0, float(D))])
    caixa, disco = passos.pontos
    assert caixa.caixa and caixa.croma is not None and caixa.croma > 24
    assert not disco.caixa and disco.croma == 0.0


def test_o_grupo_mostra_pao_pelo_trecho_seguido_na_ordem_do_tempo():
    # 10 quadros de alumínio, 3 de pão, 10 de alumínio: um relance (o melhor trecho de 8 é alumínio); e o ponto sem cor
    # não entra
    serie = [10.0] * 10 + [40.0] * 3 + [10.0] * 10
    pontos = [pdl.Ponto(f"q{i}", 300, 250, D, True, c) for i, c in enumerate(serie)] + [pdl.Ponto("q99", 300, 250, D, True)]
    (g,) = pdl.agrupar(pontos)
    assert g.pontos == 24 and g.pao == 10.0
    (g,) = pdl.agrupar([pdl.Ponto(f"q{i}", 300, 250, D, True, c) for i, c in enumerate([10.0] * 10 + [40.0] * 5)])
    assert g.pao == 40.0
    assert pdl.agrupar([pdl.Ponto("q0", 300, 250, D, True)])[0].pao is None


def test_o_quanto_mostrou_pao_e_o_melhor_trecho_e_nao_um_relance():
    aluminio, pao = 10.0, 40.0
    # o pão que aparece 5 quadros seguidos (antes do ingrediente cobrir) conta; um relance de 3, não
    assert pdl.mostrou_pao([aluminio] * 20 + [pao] * 5 + [aluminio] * 20, 8) == pao
    assert pdl.mostrou_pao([aluminio] * 20 + [pao] * 3 + [aluminio] * 20, 8) == aluminio
    # com menos pontos que a janela, a mediana deles; sem nenhum, nulo
    assert pdl.mostrou_pao([30.0, 50.0, 10.0], 8) == 30.0
    assert pdl.mostrou_pao([], 8) is None


def _g(cx, cy, pontos=20, pao=None, d=D):
    return pdl.Grupo(float(cx), float(cy), float(d), pontos, 5, pao)


def test_o_mesmo_pao_contado_duas_vezes_fica_um_o_que_mais_mostrou_pao():
    p = pdl.Parametros(sem_fantasma=True, cor_do_pao=0.0)  # só a distância
    tampa, de_novo, base = _g(300, 250, pontos=20, pao=30.0), _g(370, 250, pontos=25, pao=20.0), _g(300, 420, pao=35.0)
    # o de mais pontos mostrou menos pão: fica a tampa
    assert pdl.sem_fantasmas([de_novo, tampa, base], p) == [base, tampa]
    # empate na cor: fica o de mais pontos
    igual = _g(370, 250, pontos=25, pao=30.0)
    assert set(pdl.sem_fantasmas([tampa, igual], p)) == {igual}


def test_o_mesmo_pao_e_menos_de_sete_decimos_do_diametro_mediano():
    p = pdl.Parametros(sem_fantasma=True, cor_do_pao=0.0)
    a = _g(300, 250, pao=30.0)
    assert pdl.sem_fantasmas([a, _g(300 + 0.69 * D, 250, pao=20.0)], p) == [a]
    assert len(pdl.sem_fantasmas([a, _g(300 + 0.71 * D, 250, pao=20.0)], p)) == 2
    # a base e o tampo encostados (1 diâmetro) são duas metades
    assert len(pdl.sem_fantasmas([a, _g(300, 250 + D, pao=20.0)], p)) == 2
    # o diâmetro é o MEDIANO do lugar: com dois pães de 100 e um de 140, 84 px já é longe (0,84 do mediano; seria perto
    # pelo maior)
    p100 = [_g(300, 250, pao=30.0, d=100), _g(384, 250, pao=20.0, d=100), _g(700, 250, pao=30.0, d=140)]
    assert len(pdl.sem_fantasmas(p100, p)) == 3
    assert pdl.sem_fantasmas([], p) == []


def test_o_circulo_que_nunca_mostrou_pao_sai_mas_nunca_todos():
    p = pdl.Parametros(sem_fantasma=True)
    tampa, base, aluminio = _g(300, 250, pao=30.0), _g(300, 420, pao=26.0), _g(700, 300, pao=5.0)
    assert pdl.sem_fantasmas([tampa, aluminio, base], p) == [tampa, base]
    # o corte é de 24: no corte, fica
    assert pdl.sem_fantasmas([tampa, _g(700, 300, pao=24.0)], p) == [tampa, _g(700, 300, pao=24.0)]
    # sem cor medida, não se julga pela cor
    sem_cor = _g(700, 300, pao=None)
    assert pdl.sem_fantasmas([tampa, sem_cor], p) == [tampa, sem_cor]
    # nenhuma com pão: fica a que mais mostrou; e uma só fica sempre
    assert pdl.sem_fantasmas([_g(300, 250, pao=10.0), _g(700, 300, pao=20.0)], p) == [_g(700, 300, pao=20.0)]
    assert pdl.sem_fantasmas([aluminio], p) == [aluminio]


def test_as_metades_fortes_so_tiram_as_fantasmas_com_a_chave():
    grupos = [_g(700, 300, pao=5.0), _g(300, 420, pao=30.0), _g(300, 250, pao=30.0)]
    com = pdl.metades_fortes(grupos, pdl.Parametros(sem_fantasma=True))
    assert [(g.cx, g.cy) for g in com] == [(300.0, 250.0), (300.0, 420.0)], "de cima para baixo"
    assert len(pdl.metades_fortes(grupos, pdl.Parametros())) == 3


def _com_fantasmas(p):
    # o pão contado de novo a meio diâmetro da tampa (visto PRIMEIRO) e um círculo no inox, com caixa do detector
    de_novo, inox = (TAMPA[0] + D // 2, TAMPA[1]), (700, 300)
    return ler([mesa()] * 12, p=p, pontos_de=lambda i: [de_novo, TAMPA, BASE, inox])


def test_sem_a_chave_toda_metade_forte_fica_e_leva_o_quanto_mostrou_pao():
    leitura = _com_fantasmas(pdl.Parametros())
    assert len(leitura.metades) == 4 and leitura.fantasmas == []
    pao = {(round(m.cx), round(m.cy)): m.pao for m in leitura.metades}
    assert pao[TAMPA] is not None and pao[TAMPA] > 24 and pao[(700, 300)] == 0.0
    assert pao[TAMPA] > pao[(TAMPA[0] + D // 2, TAMPA[1])] > pao[(700, 300)]


def test_com_a_chave_ficam_a_tampa_e_a_base_e_as_fantasmas_sao_ditas():
    leitura = _com_fantasmas(pdl.Parametros(sem_fantasma=True))
    assert [(m.k, round(m.cx), round(m.cy)) for m in leitura.metades] == [(1, *TAMPA), (2, *BASE)]
    assert sorted((m.k, round(m.cx), round(m.cy), m.desde) for m in leitura.fantasmas) == [
        (0, TAMPA[0] + D // 2, TAMPA[1], None), (0, 700, 300, None)]
    assert all(m.pao is not None and m.pao < 24 for m in leitura.fantasmas)
    # só a distância (sem o corte da cor): sai o pão contado de novo, o círculo no inox fica
    so_distancia = _com_fantasmas(pdl.Parametros(sem_fantasma=True, cor_do_pao=0.0))
    assert sorted((round(m.cx), round(m.cy)) for m in so_distancia.metades) == [(300, 250), (300, 420), (700, 300)]
    assert [(round(m.cx), round(m.cy)) for m in so_distancia.fantasmas] == [(TAMPA[0] + D // 2, TAMPA[1])]


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


@dataclass(frozen=True)
class _VistoComPao(_Visto):
    pao: str | None = None


class JuizQueVePao(JuizDeMentira):
    """O juiz treinado com o PÃO NO PASSO (`juizes.treinado.FOLGA_DO_PAO`): quando o miolo é pão, a nota diz o pão."""

    def __call__(self, corte: np.ndarray) -> _Visto:
        v = super().__call__(corte)
        return _VistoComPao(v.nome, v.nota, v.ingrediente, pao="Pão de dois cortes" if v.nome == "Pão" else None)


def test_com_o_pao_no_passo_o_passo_que_e_pao_nao_conta_e_leva_o_nome_do_pao():
    # o dono, 05/11/2026: "pão nunca é cogitado como ingrediente nos chutes, sempre detecta o pão como alguma carne" —
    # o pão que chega no lugar da tampa (o 13) era um passo; com o pão no passo, é vazio com o nome do pão
    leitura = ler(_levado(), juiz=JuizQueVePao(nada=0.46))
    assert contados(leitura) == [(1, "passo", 6), (1, "vazio", 9), (2, "vazio", 9), (1, "vazio", 13)]
    pao = next(s for s in leitura.passos if s.tipo == "vazio" and seg(s) == 13)
    assert (pao.nome, pao.nota) == ("Pão de dois cortes", 0.70)
    # o queijo (não é pão) continua passo, com o nome dele; o vazio de sempre (o inox) continua sem nome
    assert next(s for s in leitura.passos if s.tipo == "passo").nome == "Queijo"
    assert all(s.nome is None for s in leitura.passos if s.tipo == "vazio" and seg(s) == 9)


def test_com_o_pao_no_passo_o_comeco_continua_o_pao_da_metade():
    # o começo de cada metade É o pão: continua começo (a peça do lanche), não vira vazio
    leitura = ler(_levado(), juiz=JuizQueVePao())
    assert {(s.metade, s.tipo) for s in leitura.passos if s.nome == "Pão"} == {(1, "comeco"), (2, "comeco")}
    assert contados(leitura) == [(1, "passo", 6), (1, "saiu", 9), (2, "saiu", 9)]


@dataclass(frozen=True)
class _VistoComNada(_VistoComPao):
    nada: bool = False


class JuizQueVeONada(JuizDeMentira):
    """O juiz treinado com o NÃO É INGREDIENTE (`juizes.treinado.FOLGA_DO_NADA`): aqui, o "queijo" é o que o dono
    ensinou que não é ingrediente (no desenho, o papel-alumínio que brilha amarelo); o pão também é visto."""

    def __call__(self, corte: np.ndarray) -> _Visto:
        v = super().__call__(corte)
        return _VistoComNada(v.nome, v.nota, v.ingrediente, pao="Pão de dois cortes" if v.nome == "Pão" else None,
                             nada=v.nome in ("Queijo", "Pão"))


def test_com_o_nao_e_ingrediente_o_passo_que_nao_e_ingrediente_nao_conta():
    # o queijo (que aqui é o "não é ingrediente") deixa de ser passo: sai como vazio, com o que o juiz leu; o pão que
    # chega no lugar da tampa também é "não é", e o "não é" vem antes do pão (vazio, sem o nome do pão)
    leitura = ler(_levado(), juiz=JuizQueVeONada(nada=0.46))
    assert contados(leitura) == [(1, "vazio", 6), (1, "vazio", 9), (2, "vazio", 9), (1, "vazio", 13)]
    seis = next(s for s in leitura.passos if seg(s) == 6)
    assert (seis.nome, seis.nota) == ("Queijo", 0.70)
    assert next(s for s in leitura.passos if seg(s) == 13).nome is None
    # o começo continua o pão da metade (o "não é" só vale para os passos)
    assert {s.tipo for s in leitura.passos if s.nome == "Pão"} == {"comeco"}


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
