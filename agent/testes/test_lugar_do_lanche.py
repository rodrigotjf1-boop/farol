"""O lugar do lanche (A23.2e): o papel ou a caixa é o lugar do lanche, e o lanche só termina no embrulho.

A bancada aqui é desenhada: o tampo cinza, o papel bege, as metades do pão como discos laranja (o detector de mentira
os acha pela cor, como em `test_treino_lanches`), o ingrediente que cobre a metade, o pacote kraft do embrulho e a
bandeja do consumo local. O que se protege:

- o lanche vive do primeiro pão no papel até o EMBRULHO — e não até o pão sumir debaixo dos ingredientes;
- só é lugar o pão em cima do papel (ou na caixa): sem papel, no que já é da bancada vazia, ou cortado pela borda, não;
- só é lanche com pão em `confirma` quadros no primeiro minuto;
- dois papéis lado a lado são dois lanches, cada um com o seu fim; a faixa de cada um vai até a metade do caminho;
- o lanche MOVIDO continua no lugar novo; o embrulho seguido de um lanche NOVO ao lado não é movido;
- a bancada vazia aprendida: a bandeja que sai não prende o lanche montado onde ela estava;
- a rede (parado e sem pão) e o teto; o fim só é entregue depois do tempo do movido; o encerrar.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import cv2
import numpy as np

from farol_agent import lugar_do_lanche as ldl
from farol_agent import treino_lanches as tl

from .test_treino_lanches import AO_LONGO, LARANJA, DetectorDaCor

LARGURA, ALTURA = 960, 540
T0 = datetime(2026, 10, 15, 21, 0, 0)
PAPEL = (190, 210, 225)
PACOTE = (60, 110, 150)
BANDEJA = (40, 60, 120)
CAIXA = (235, 235, 235)
ESCURO = (30, 30, 30)
VERDE = (60, 170, 60)


def mesa(papeis=(), paes=(), cobertos=(), pacotes=(), bandejas=(), miolos=(), ponto=None) -> np.ndarray:
    """A bancada: `papeis`, `pacotes`, `bandejas` como retângulos (x0, y0, x1, y1); `paes` como (cx, cy); `cobertos`
    (cx, cy, cor): o ingrediente que cobre a metade inteira (o detector não a vê mais); `miolos` (cx, cy, cor): o
    ingrediente no meio da metade (a borda do pão continua à vista); `ponto`: um pinguinho que pisca (movimento)."""
    img = np.full((ALTURA, LARGURA, 3), 95, np.uint8)
    for x in range(0, LARGURA, 60):
        cv2.line(img, (x, 0), (x, ALTURA - 1), (105, 105, 105), 1)
    for x0, y0, x1, y1 in bandejas:
        cv2.rectangle(img, (x0, y0), (x1, y1), BANDEJA, -1)
    for x0, y0, x1, y1 in papeis:
        cv2.rectangle(img, (x0, y0), (x1, y1), PAPEL, -1)
    for x0, y0, x1, y1 in pacotes:
        cv2.rectangle(img, (x0, y0), (x1, y1), PACOTE, -1)
    for cx, cy in paes:
        cv2.circle(img, (cx, cy), 40, LARANJA, -1)
    for cx, cy, cor in miolos:
        cv2.circle(img, (cx, cy), 26, cor, -1)
    for cx, cy, cor in cobertos:
        cv2.circle(img, (cx, cy), 46, cor, -1)
    if ponto is not None:
        cv2.circle(img, ponto, 30, (250, 250, 250), -1)
    return img


def papel_em(cx: int) -> tuple[int, int, int, int]:
    return (cx - 105, 170, cx + 105, 470)


def metades_em(cx: int) -> list[tuple[int, int]]:
    """A tampa em cima e a base embaixo, no mesmo papel."""
    return [(cx, 250), (cx, 350)]


def pacote_em(cx: int, lado=(70, 70)) -> tuple[int, int, int, int]:
    w, h = lado
    return (cx - w // 2, 320 - h // 2, cx + w // 2, 320 + h // 2)


def ler(cena, leitor: ldl.LeitorDeLugares | None = None, ate_o_fim=True):
    """Lê a cena (uma lista de (t, imagem)) e devolve os lugares entregues, na ordem do começo."""
    leitor = leitor or ldl.LeitorDeLugares(AO_LONGO)
    det = DetectorDaCor()
    entregues = []
    for t, img in cena:
        grupos = tl.lanches_do_quadro(tl.paes(det, img, AO_LONGO), AO_LONGO, LARGURA, ALTURA)
        entregues += leitor.quadro(img, t, grupos)
    if ate_o_fim:
        entregues += leitor.encerrar(cena[-1][0])
    return sorted(entregues, key=lambda l: l.inicio), leitor


def t(s: float) -> datetime:
    return T0 + timedelta(seconds=s)


def lanches(lugares, leitor):
    return [l for l in lugares if leitor.e_lanche(l)]


def cena_do_embrulho(cx=300, pao_ate=40, embrulho=70, fim=95, pacote=(70, 70)):
    """O papel aos 5 s; as metades aos 10 s; os ingredientes cobrem as metades em `pao_ate` (o detector não vê mais o
    pão); o embrulho em `embrulho`: o papel vira um pacote no mesmo lugar."""
    saida = []
    for s in range(fim):
        if s < 5:
            img = mesa()
        elif s < 10:
            img = mesa(papeis=[papel_em(cx)])
        elif s < embrulho:
            cobertos = [(x, y, ESCURO) for x, y in metades_em(cx)] if s >= pao_ate else []
            img = mesa(papeis=[papel_em(cx)], paes=metades_em(cx), cobertos=cobertos)
        else:
            img = mesa(pacotes=[pacote_em(cx, pacote)])
        saida.append((t(s), img))
    return saida


# ───────────────────────────── a vida do lanche ─────────────────────────────


def test_o_lanche_vive_do_primeiro_pao_ate_o_embrulho_e_nao_ate_o_pao_sumir():
    lugares, leitor = ler(cena_do_embrulho())

    so = lanches(lugares, leitor)
    assert len(so) == 1
    l = so[0]
    assert (l.inicio, l.fim, l.porque) == (t(10), t(70), "embrulho"), "o pão some aos 40 s; o lanche segue até o embrulho"
    assert l.com_pao == 30 and l.movido == []


def test_o_embrulho_com_o_pacote_maior_tambem_termina():
    # o pacote ocupa 23% da faixa (mais que o mínimo de 12%): o limite é a metade da ocupação típica do próprio lugar
    lugares, leitor = ler(cena_do_embrulho(pacote=(150, 140)))

    assert [(l.fim, l.porque) for l in lanches(lugares, leitor)] == [(t(70), "embrulho")]


def test_o_fim_so_e_entregue_depois_do_tempo_do_movido():
    cena = cena_do_embrulho()
    leitor = ldl.LeitorDeLugares(AO_LONGO)
    det = DetectorDaCor()
    entregue_em = None
    for quando, img in cena:
        grupos = tl.lanches_do_quadro(tl.paes(det, img, AO_LONGO), AO_LONGO, LARGURA, ALTURA)
        if leitor.quadro(img, quando, grupos) and entregue_em is None:
            entregue_em = quando
    assert entregue_em == t(70 + leitor.p.move_s + 1), "o fim aos 70 s, entregue quando o movido já não pode voltar"


def test_encerrar_entrega_o_vivo_como_encerrado_e_o_que_esperava_como_estava():
    # o segundo lanche começa aos 76 s (longe do segundo do embrulho: não é movido) e está aberto quando a leitura acaba
    cena = [(q, img if s < 76 else mesa(pacotes=[pacote_em(300)], papeis=[papel_em(650)], paes=metades_em(650)))
            for s, (q, img) in enumerate(cena_do_embrulho(cx=300))]

    lugares, leitor = ler(cena[:80])
    assert [(l.porque, l.fim) for l in lanches(lugares, leitor)] == [("embrulho", t(70))], (
        "o que esperava a volta do movido sai como estava; o aberto tem pão em 4 quadros só"
    )
    lugares, leitor = ler(cena[:95])
    assert [(l.porque, l.fim) for l in lanches(lugares, leitor)] == [("embrulho", t(70)), ("encerrado", t(94))]


# ───────────────────────────── o que é lugar de lanche ─────────────────────────────


def test_o_pao_sem_papel_nao_e_lugar():
    cena = [(t(s), mesa() if s < 5 else mesa(paes=metades_em(300))) for s in range(40)]
    lugares, _ = ler(cena)
    assert lugares == []


def test_o_que_o_detector_acha_no_que_ja_e_da_bancada_vazia_nao_e_pao():
    # o papel e o "pão" já estavam lá no primeiro quadro (a bancada vazia de partida): são da bancada
    cena = [(t(s), mesa(papeis=[papel_em(300)], paes=metades_em(300))) for s in range(40)]
    lugares, _ = ler(cena)
    assert lugares == []


def test_o_copo_da_bancada_vazia_com_papel_em_volta_nao_e_pao():
    # o "pão" (o copo bege da borda, visto de cima) já estava no primeiro quadro; depois um papel é posto em volta dele:
    # a região tem papel novo, mas a metade em si é a da bancada vazia
    copo = [(300, 300)]
    cena = [(t(s), mesa(paes=copo) if s < 5 else mesa(papeis=[papel_em(300)], paes=copo)) for s in range(40)]
    lugares, _ = ler(cena)
    assert lugares == []


def test_o_pao_nas_cubas_nao_e_lugar():
    # o papel e o pão no alto do recorte (a frente das cubas): o centro acima de 1/4 da altura
    cena = [(t(s), mesa() if s < 5 else mesa(papeis=[(195, 60, 405, 200)], paes=[(300, 120)])) for s in range(40)]
    lugares, _ = ler(cena)
    assert lugares == []


def test_o_pao_parado_na_bancada_nao_vira_bancada_vazia():
    # o pão fica 40 s direto na bancada (sem papel: não é lugar) — a bancada não o aprende como vazio, e quando o papel
    # chega em volta dele, o lanche nasce
    cena = []
    for s in range(70):
        if s < 5:
            img = mesa()
        elif s < 45:
            img = mesa(paes=metades_em(300))
        else:
            img = mesa(papeis=[papel_em(300)], paes=metades_em(300))
        cena.append((t(s), img))
    lugares, leitor = ler(cena)
    assert [l.inicio for l in lanches(lugares, leitor)] == [t(45)]


def test_o_pao_cortado_pela_borda_nao_comeca_lanche():
    def cena_na(cx):
        return [(t(s), mesa() if s < 5 else mesa(papeis=[(0, 170, cx + 105, 470)], paes=metades_em(cx))) for s in range(40)]

    leitor = ldl.LeitorDeLugares(AO_LONGO)
    assert leitor.meio_pao == 42.5
    assert ler(cena_na(30))[0] == [], "o centro a menos de meio pão da borda"
    assert len(ler(cena_na(60))[0]) == 1


def cena_que_nao_confirma(fim=90):
    """O pão é visto só aos 10, 11 e 12 s; o pinguinho que pisca mantém a faixa mexendo (a rede não fecha antes)."""
    cena = []
    for s in range(fim):
        cobertos = [(x, y, ESCURO) for x, y in metades_em(300)] if s >= 13 else []
        ponto = (300, 440) if s % 2 else None
        cena.append((t(s), mesa() if s < 5 else mesa(papeis=[papel_em(300)], paes=metades_em(300) if s >= 10 else [],
                                                     cobertos=cobertos, ponto=ponto)))
    return cena


def test_so_e_lanche_com_pao_em_cinco_quadros_no_primeiro_minuto():
    lugares, leitor = ler(cena_que_nao_confirma(), ate_o_fim=False)

    assert [(l.com_pao, l.porque, l.fim) for l in lugares] == [(3, "não confirmou", t(70))]
    assert lanches(lugares, leitor) == []


# ───────────────────────────── vizinhos ─────────────────────────────


def test_dois_papeis_lado_a_lado_sao_dois_lanches_cada_um_com_o_seu_embrulho():
    cena = []
    for s in range(100):
        papeis, paes, pacotes = [], [], []
        if s >= 5:
            for cx, embrulho in ((300, 50), (560, 80)):
                if s < embrulho:
                    papeis.append(papel_em(cx))
                    paes += metades_em(cx) if s >= 10 else []
                else:
                    pacotes.append(pacote_em(cx))
        cena.append((t(s), mesa(papeis=papeis, paes=paes, pacotes=pacotes)))
    lugares, leitor = ler(cena)

    assert [(l.inicio, l.fim, l.porque) for l in lanches(lugares, leitor)] == [
        (t(10), t(50), "embrulho"), (t(10), t(80), "embrulho"),
    ]


def test_a_faixa_de_cada_lugar_vai_ate_a_metade_do_caminho_para_o_vizinho():
    # três caixas estreitas lado a lado (como as de isopor), a 140 px uma da outra
    centros = (200, 340, 480)
    caixas = [(cx - 60, 180, cx + 60, 440) for cx in centros]
    paes = [p for cx in centros for p in metades_em(cx)]
    img_caixas = mesa(papeis=caixas, paes=paes)
    leitor = ldl.LeitorDeLugares(AO_LONGO)
    det = DetectorDaCor()
    for s in range(12):
        img = mesa() if s < 2 else img_caixas
        leitor.quadro(img, t(s), tl.lanches_do_quadro(tl.paes(det, img, AO_LONGO), AO_LONGO, LARGURA, ALTURA))

    a, b, c = sorted(leitor.ativos, key=lambda l: l.cx)
    meia = leitor.papel_w / 2
    assert all(abs(l.cx - cx) <= 1 for l, cx in zip((a, b, c), centros))
    assert (a.x0, a.x1) == (a.cx - meia, (a.cx + b.cx) / 2), "a da ponta vai meio papel para fora"
    assert (b.x0, b.x1) == ((a.cx + b.cx) / 2, (b.cx + c.cx) / 2), "a do meio, só até a metade do caminho"
    assert (c.x0, c.x1) == ((b.cx + c.cx) / 2, c.cx + meia)


# ───────────────────────────── o movido ─────────────────────────────


def test_o_lanche_movido_continua_no_lugar_novo():
    # aos 40 s o colaborador leva o papel com o lanche (a alface no miolo) de x 250 para x 650
    cena = []
    for s in range(95):
        cx = 250 if s < 40 else 650
        if s < 5:
            img = mesa()
        elif s < 70:
            img = mesa(papeis=[papel_em(cx)], paes=metades_em(cx) if s >= 10 else [],
                       miolos=[(cx, 250, VERDE)] if s >= 10 else [])
        else:
            img = mesa(pacotes=[pacote_em(650)])
        cena.append((t(s), img))
    lugares, leitor = ler(cena)

    so = lanches(lugares, leitor)
    assert len(so) == 1, "um lanche só, e não dois"
    l = so[0]
    assert (l.inicio, l.fim, l.porque) == (t(10), t(70), "embrulho")
    assert [(q, round(de / 10) * 10, para) for q, de, para in l.movido] == [(t(40), 250, 650)]


def test_o_embrulho_e_um_lanche_novo_ao_lado_no_mesmo_segundo_nao_sao_movido():
    # aos 40 s, o lanche A (alface no miolo) é embrulhado e levado, e no mesmo segundo o lanche B (carne no miolo)
    # aparece em x 650, já com as metades: tudo como um movido, menos a cara
    cena = []
    for s in range(95):
        if s < 5:
            img = mesa()
        elif s < 40:
            img = mesa(papeis=[papel_em(250)], paes=metades_em(250) if s >= 10 else [],
                       miolos=[(x, y, VERDE) for x, y in metades_em(250)] if s >= 10 else [])
        elif s < 70:
            img = mesa(papeis=[papel_em(650)], paes=metades_em(650), miolos=[(x, y, ESCURO) for x, y in metades_em(650)])
        else:
            img = mesa(pacotes=[pacote_em(650)])
        cena.append((t(s), img))
    lugares, leitor = ler(cena)

    so = lanches(lugares, leitor)
    assert [(l.inicio, l.fim, l.movido) for l in so] == [(t(10), t(40), []), (t(40), t(70), [])]


def test_o_movido_que_so_aparece_depois_continua():
    # aos 40 s o papel vai de x 250 para x 650, e a mão cobre o pão no lugar novo até os 44 s
    cena = []
    for s in range(95):
        if s < 5:
            img = mesa()
        elif s < 40:
            img = mesa(papeis=[papel_em(250)], paes=metades_em(250) if s >= 10 else [],
                       miolos=[(250, 250, VERDE)] if s >= 10 else [])
        elif s < 70:
            img = mesa(papeis=[papel_em(650)], paes=metades_em(650), miolos=[(650, 250, VERDE)],
                       cobertos=[(x, y, (200, 200, 200)) for x, y in metades_em(650)] if s < 44 else [])
        else:
            img = mesa(pacotes=[pacote_em(650)])
        cena.append((t(s), img))
    lugares, leitor = ler(cena)

    so = lanches(lugares, leitor)
    assert [(l.inicio, l.fim, len(l.movido)) for l in so] == [(t(10), t(70), 1)]


def test_o_lanche_novo_com_o_papel_ja_posto_nao_e_movido():
    # o lanche A é embrulhado e levado aos 40 s; o papel do lanche B já estava posto desde os 30 s e o pão dele chega
    # aos 40 s, com a mesma cara: a faixa de B não encheu de uma vez — é um lanche novo
    cena = []
    for s in range(95):
        papeis, paes, pacotes = [], [], []
        if 5 <= s < 40:
            papeis.append(papel_em(250))
            paes += metades_em(250) if s >= 10 else []
        if 30 <= s < 70:
            papeis.append(papel_em(650))
            paes += metades_em(650) if s >= 40 else []
        if s >= 70:
            pacotes.append(pacote_em(650))
        cena.append((t(s), mesa(papeis=papeis, paes=paes, pacotes=pacotes)))
    lugares, leitor = ler(cena)

    assert [(l.inicio, l.fim, l.movido) for l in lanches(lugares, leitor)] == [(t(10), t(40), []), (t(40), t(70), [])]


def test_o_embrulho_devagar_e_um_lanche_igual_ao_lado_nao_sao_movido():
    # o papel do lanche A se fecha devagar (de 40 a 55 s ele vira o pacote): não esvaziou de uma vez; o lanche B, igual
    # a ele, aparece no segundo em que A fica baixo
    cena = []
    for s in range(110):
        papeis, paes, pacotes = [], [], []
        if 5 <= s < 40:
            papeis.append(papel_em(250))
            paes += metades_em(250) if s >= 10 else []
        elif 40 <= s < 55:
            area = 63000 - (s - 40) * (63000 - 4900) / 15
            w = int((area * 0.7) ** 0.5)
            h = int(area / w)
            papeis.append((250 - w // 2, 320 - h // 2, 250 + w // 2, 320 + h // 2))
        elif s >= 55:
            pacotes.append(pacote_em(250))
        if 49 <= s < 80:
            papeis.append(papel_em(650))
            paes += metades_em(650)
        if s >= 80:
            pacotes.append(pacote_em(650))
        cena.append((t(s), mesa(papeis=papeis, paes=paes, pacotes=pacotes)))
    lugares, leitor = ler(cena)

    so = lanches(lugares, leitor)
    assert [(l.inicio, l.movido) for l in so] == [(t(10), []), (t(49), [])]
    assert so[0].fim == t(49), "o primeiro quadro abaixo da metade da ocupação típica"


# ───────────────────────────── a bancada vazia aprendida ─────────────────────────────


def cena_da_bandeja(volta_aos=None):
    """A bandeja do consumo local está à direita no primeiro quadro; sai em 1 s; aos 70 s um lanche é montado onde
    ela estava, e é embrulhado aos 110 s (o pacote é levado na hora)."""
    saida = []
    for s in range(130):
        bandejas = [(600, 200, 900, 500)] if s < 1 or (volta_aos is not None and s >= volta_aos) else []
        if 65 <= s < 110:
            img = mesa(bandejas=bandejas, papeis=[papel_em(750)], paes=metades_em(750) if s >= 70 else [])
        else:
            img = mesa(bandejas=bandejas)
        saida.append((t(s), img))
    return saida


def test_a_bandeja_que_sai_nao_prende_o_lanche_montado_onde_ela_estava():
    lugares, leitor = ler(cena_da_bandeja())

    so = lanches(lugares, leitor)
    assert [(l.inicio, l.fim, l.porque) for l in so] == [(t(70), t(110), "embrulho")]
    assert leitor.bancada.aprendidas >= 1, "a bancada sem a bandeja virou uma aparência vazia"


def test_sem_aprender_a_bancada_vazia_o_lanche_onde_estava_a_bandeja_nao_termina_no_embrulho():
    # a mesma cena, sem deixar a bancada aprender (o controle: é o aprender que solta o lanche)
    p = ldl.Parametros(quieto_s=10_000)
    lugares, leitor = ler(cena_da_bandeja(), ldl.LeitorDeLugares(AO_LONGO, p))

    assert [l.porque for l in lanches(lugares, leitor)] != ["embrulho"]


def test_a_faixa_coberta_por_um_lugar_vivo_nao_aprende():
    lab = ldl.bancada_lab(mesa())
    b = ldl.BancadaVazia(lab, ldl.Parametros(quieto_s=2, parado_s=0, aprende_a_cada_s=0))
    outra = ldl.bancada_lab(mesa(bandejas=[(600, 200, 900, 500)]))
    parado = np.zeros(lab.shape[1])
    cobertas = set(b.faixas(600, 900))
    for s in range(6):
        b.aprender(outra, t(s), parado, [], cobertas)
    assert b.aprendidas == 0
    for s in range(6, 12):
        b.aprender(outra, t(s), parado, [], set())
    assert b.aprendidas > 0
    assert int(b.ocupado(outra).sum()) == 0 and int(b.ocupado(lab).sum()) == 0, "as duas aparências contam como vazias"


# ───────────────────────────── a rede e o teto ─────────────────────────────


def test_o_lugar_parado_e_sem_pao_termina_no_ultimo_movimento():
    cena = []
    for s in range(100):
        if s < 5:
            img = mesa()
        else:
            cobertos = [(x, y, ESCURO) for x, y in metades_em(300)] if s >= 21 else []
            img = mesa(papeis=[papel_em(300)], paes=metades_em(300) if s >= 10 else [], cobertos=cobertos)
        cena.append((t(s), img))
    lugares, leitor = ler(cena, ate_o_fim=False)

    assert [(l.fim, l.porque) for l in lanches(lugares, leitor)] == [(t(21), "parado")], (
        "os ingredientes cobrem o pão aos 21 s e nada mais mexe: a rede fecha 45 s depois, na hora do último movimento"
    )


def test_nada_vive_mais_que_o_teto():
    p = ldl.Parametros(vida_max_s=60)
    cena = [(t(s), mesa() if s < 5 else mesa(papeis=[papel_em(300)], paes=metades_em(300),
                                             ponto=(300, 440) if s % 2 else None)) for s in range(90)]
    lugares, leitor = ler(cena, ldl.LeitorDeLugares(AO_LONGO, p), ate_o_fim=False)

    assert [(l.inicio, l.fim, l.porque) for l in lanches(lugares, leitor)][0] == (t(5), t(65), "teto")
