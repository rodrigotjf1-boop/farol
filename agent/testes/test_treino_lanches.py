"""Os quadros de cada lanche, da captura densa da bancada (A21, fatia T3c-2).

A bancada aqui é desenhada: um tampo cinza e as duas metades do pão como discos laranja. O detector é de mentira e
acha os discos pela cor — o de verdade (RF-DETR Nano) não entra no CI. O que se protege:

- as metades vizinhas são um lanche; o lanche é seguido de quadro em quadro;
- o braço por cima não encerra o lanche; o que entrou depois de o braço sair é uma etapa;
- o lanche empurrado é o mesmo (pela cara), num trecho novo, com outra caixa fixa;
- sem pão por mais que o perfil diz, o lanche termina; a trilha curta não é lanche;
- o `metades.csv` e os recortes na caixa fixa, no formato que a identificação lê;
- a virada da meia-noite;
- e as contas: os pedaços do quadro, a repetição entre pedaços, o tamanho do pão, a caixa fixa, as caixas do modelo.
"""

from __future__ import annotations

import csv
import json
from datetime import datetime, timedelta
from pathlib import Path

import cv2
import numpy as np
import pytest

from farol_agent import treino_lanches as tl
from farol_agent import treino_quadros as tq
from farol_agent.juizes import detector as det
from farol_agent.juizes.base import ErroDoJuiz

LARGURA, ALTURA = 960, 540
LARANJA = (0, 140, 255)
PERFIL = tl.PerfilDaBancada(pao_px_min=50, pao_px_max=120, mexe=6.0, mudou=6.0, sumiu_s=12, parecido=0.5, duracao_minima_s=40)
T0 = datetime(2026, 10, 15, 21, 0, 0)


class DetectorDaCor:
    """Acha os discos laranja da imagem que recebe (o pedaço do quadro), como o modelo acharia os pães."""

    def __init__(self):
        self.chamadas = 0

    def caixas(self, imagem, classe, limite):
        self.chamadas += 1
        assert classe == tl.CLASSE_DO_PAO and limite == tl.LIMITE_DO_PAO
        mascara = cv2.inRange(imagem, (0, 130, 245), (10, 150, 255))
        n, _, stats, _ = cv2.connectedComponentsWithStats(mascara)
        saida = []
        for i in range(1, n):
            x, y, w, h, area = stats[i]
            if area >= 200:
                saida.append((float(x), float(y), float(x + w), float(y + h), 0.9))
        return saida


def quadro(paes=(), por_cima=None, escuro=None, mao=None) -> np.ndarray:
    img = np.full((ALTURA, LARGURA, 3), 90, np.uint8)
    for x in range(0, LARGURA, 60):
        cv2.line(img, (x, 0), (x, ALTURA - 1), (110, 110, 110), 1)
    for cx, cy in paes:
        cv2.circle(img, (cx, cy), 40, LARANJA, -1)
    if escuro is not None:
        # O ingrediente no meio da metade, como a carne no pão: a borda do pão continua à vista (e o detector o vê).
        cv2.circle(img, escuro, 28, (30, 30, 30), -1)
    if por_cima is not None:
        x, y = por_cima
        cv2.rectangle(img, (x - 110, y - 110), (x + 110, y + 110), (220, 220, 220), -1)
    if mao is not None:  # a mão em cima de UMA metade: ela some do detector, e a região do lanche encolhe
        x, y = mao
        cv2.rectangle(img, (x - 55, y - 55), (x + 55, y + 55), (220, 220, 220), -1)
    return img


def montar_densa(pasta: Path, quadros: list[tuple[datetime, np.ndarray]]) -> Path:
    densa = pasta / "densa"
    (densa / "recortes").mkdir(parents=True)
    linhas = []
    for i, (t, img) in enumerate(quadros):
        nome = f"q{i:04d}.jpg"
        cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 95])[1].tofile(str(densa / "recortes" / nome))
        texto = f"{t:%Y-%m-%d %H:%M:%S.%f}"[:-3]
        linhas.append(["x.dav", i, texto, texto, 0, nome])
    with (densa / tq.PARADAS).open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(tq.CABECALHO)
        w.writerows(linhas)
    return densa


def cena(t0: datetime = T0) -> list[tuple[datetime, np.ndarray]]:
    """Um lanche de 0 a 54 s (o braço passa aos 10–11 s e deixa um ingrediente escuro; empurrado aos 30 s) e uma
    bandeja curta de 60 a 65 s, até 79 s."""
    saida = []
    for s in range(80):
        # O detector de verdade não dá a mesma caixa ao pixel de um quadro para o outro: 2 px de tremor.
        t = 2 * (s % 2)
        if s < 30:
            paes, escuro = [(300 + t, 270), (390 + t, 270)], (390 + t, 270) if s >= 12 else None
        elif s < 55:
            paes, escuro = [(550 + t, 270), (640 + t, 270)], (640 + t, 270)
        else:
            paes, escuro = [], None
        if 60 <= s <= 65:
            paes = paes + [(150, 110), (240, 110)]
        por_cima = (345, 270) if s in (10, 11) else None
        mao = (300 + t, 270) if s in (20, 21, 22) else None
        saida.append((t0 + timedelta(seconds=s), quadro(paes, por_cima, escuro, mao)))
    return saida


def cena_do_puxao(puxa_em=50, dx=400, dy=20, outra_cara=False, perto_depois_da_mao=False, mao=True, t0: datetime = T0):
    """Um lanche à esquerda (com o ingrediente escuro desde os 5 s); em `puxa_em` e no segundo seguinte a mão cobre o
    lugar; depois ele está `dx`, `dy` px dali (com outro ingrediente, se `outra_cara`) por 30 s, e some.
    `perto_depois_da_mao`: o que aparece está perto (250 px), logo depois da mão. Sem a `mao`, ele aparece no lugar
    novo já em `puxa_em` (e a cara do lugar, a do último quadro, é a do lanche).

    A mão é de uma cor que não é a do lanche: a cara do lugar com ela por cima dá −0,005 com a do lanche. (A mão cinza
    do `quadro()` dá 0,60 — passaria no "parecido" do empurrão de perto, e o teste da cara não pegaria nada.)"""
    if perto_depois_da_mao:
        dx, dy = 250, 0
    saida = []
    fim = puxa_em + 32
    for s in range(fim + 16):
        t = 2 * (s % 2)
        paes, escuro = [], None
        coberto = mao and puxa_em <= s < puxa_em + 2
        if s < puxa_em:
            paes, escuro = [(300 + t, 270), (390 + t, 270)], (390 + t, 270) if s >= 5 else None
        elif not coberto and s < fim:
            paes = [(300 + dx + t, 270 + dy), (390 + dx + t, 270 + dy)]
            escuro = (390 + dx + t, 270 + dy)
        img = quadro(paes, None, escuro)
        if coberto:
            cv2.rectangle(img, (235, 160), (455, 380), (200, 120, 60), -1)  # a mão por cima, nas duas metades
        if outra_cara and puxa_em <= s < fim and not coberto:
            # O "outro lanche", parecido: o mesmo escuro e mais um ingrediente vermelho na outra metade. Depois do JPEG
            # do quadro, a cara dá 0,71–0,72 com a do lanche: parecida para o empurrão de perto (0,5), não para o
            # puxão (0,9). (O mesmo lanche dá 0,998–1,000.)
            cv2.circle(img, (300 + dx + t, 270 + dy), 28, (40, 40, 200), -1)
        saida.append((t0 + timedelta(seconds=s), img))
    return saida


def test_o_lanche_puxado_ao_longo_da_bancada_e_o_mesmo(tmp_path):
    # 400 px é mais que 1,5 lado do lanche (o empurrão de perto): só a regra do puxão junta. E 20 px fora da linha, como
    # o puxão de verdade (a mão não puxa reto).
    resumo = tl.lanches_da_densa(montar_densa(tmp_path, cena_do_puxao()), tmp_path / "lanches", DetectorDaCor(), PERFIL)
    lanches = [r for r in resumo if r["eLanche"]]
    assert len(resumo) == 1 and len(lanches) == 1, f"um lanche só, não dois: {[(r['lanche'], r['duracaoS']) for r in resumo]}"
    assert lanches[0]["mudouDeLugar"] == 1
    assert "21h00m52.jpg" in lanches[0]["etapas"], "no lugar novo, um trecho novo (outra caixa fixa)"


@pytest.mark.parametrize("cena,porque", [
    (dict(puxa_em=20), "puxado antes de ser lanche (20 s, o perfil pede 40)"),
    (dict(dx=400, dy=200), "longe e fora do eixo da bancada (200 px para baixo)"),
    (dict(outra_cara=True), "longe, com outra cara: é outro lanche"),
    (dict(outra_cara=True, mao=False), "a 1,56 lado, sem a mão e com a cara só parecida: o empurrão de perto não vai até lá"),
])
def test_longe_so_junta_o_puxao(tmp_path, cena, porque):
    resumo = tl.lanches_da_densa(montar_densa(tmp_path, cena_do_puxao(**cena)), tmp_path / "lanches", DetectorDaCor(), PERFIL)
    assert len(resumo) == 2, f"{porque}: {[(r['lanche'], r['duracaoS'], r['mudouDeLugar']) for r in resumo]}"
    assert all(r["mudouDeLugar"] == 0 for r in resumo)


def test_perto_vale_a_cara_do_lugar_e_o_parecido_ao_lado_depois_da_mao_e_outro(tmp_path):
    # Perto, logo depois da mão, aparece um lanche parecido (0,71 com a cara da última vista — passaria no "parecido"
    # de 0,5) e diferente. A cara do lugar é a da mão, e ele não se junta. Medido na densa de 14/10: com a da última
    # vista, o empurrão de perto juntou mais 4, e nenhum era o mesmo lanche (o embrulho com o pão aberto ao lado).
    cena = cena_do_puxao(perto_depois_da_mao=True, outra_cara=True)
    resumo = tl.lanches_da_densa(montar_densa(tmp_path, cena), tmp_path / "lanches", DetectorDaCor(), PERFIL)
    assert len(resumo) == 2 and all(r["mudouDeLugar"] == 0 for r in resumo), [(r["lanche"], r["duracaoS"]) for r in resumo]


def test_o_lanche_sem_cara_nao_quebra_a_busca_longe(tmp_path):
    # Outra loja, a câmera mais longe: o pão pequeno no quadro. A região de uma metade só (37 px) fica menor que a caixa
    # mínima, e o lanche fica sem cara — a busca longe passa por ele sem comparar (e sem quebrar).
    pequeno = tl.PerfilDaBancada(**{**PERFIL.__dict__, "pao_px_min": 10})
    quadros = []
    for s in range(80):
        img = quadro()
        if s < 45:
            cv2.circle(img, (150, 270), 12, LARANJA, -1)
        elif s < 76:
            for cx in (600, 690):
                cv2.circle(img, (cx, 270), 40, LARANJA, -1)
        quadros.append((T0 + timedelta(seconds=s), img))
    resumo = tl.lanches_da_densa(montar_densa(tmp_path, quadros), tmp_path / "lanches", DetectorDaCor(), pequeno)
    assert len(resumo) == 2 and all(r["mudouDeLugar"] == 0 for r in resumo), resumo


def cena_da_troca(paes_depois, escuros_depois, mao=False, puxa_em=50, t0: datetime = T0):
    """O lanche à esquerda (com o ingrediente escuro desde os 5 s); em `puxa_em` ele some (com a `mao`, ela cobre o lugar
    por 2 s) e aparece o que está em `paes_depois` (com os ingredientes escuros em `escuros_depois`) por 30 s."""
    saida = []
    depois = puxa_em + (2 if mao else 0)
    fim = depois + 30
    for s in range(fim + 16):
        t = 2 * (s % 2)
        if s < puxa_em:
            img = quadro([(300 + t, 270), (390 + t, 270)], None, (390 + t, 270) if s >= 5 else None)
        elif s < depois:
            img = quadro()
            cv2.rectangle(img, (235, 160), (455, 380), (200, 120, 60), -1)  # a mão por cima, de outra cor
        elif s < fim:
            img = quadro([(x + t, y) for x, y in paes_depois])
            for x, y in escuros_depois:
                cv2.circle(img, (x + t, y), 28, (30, 30, 30), -1)
        else:
            img = quadro()
        saida.append((t0 + timedelta(seconds=s), img))
    return saida


def test_perto_a_regiao_que_cresce_muito_nao_e_o_lanche_que_se_mexeu(tmp_path):
    # Logo abaixo, quatro pães postos de uma vez (como às 22:07 de 14/10): a 0,70 lado, a cara 0,99 — mas a região é
    # 2,07 vezes a do lanche. É ele junto de outra coisa, e não ele empurrado.
    cena = cena_da_troca([(300, 420), (390, 420), (480, 420), (570, 420)], [(390, 420), (570, 420)])
    resumo = tl.lanches_da_densa(montar_densa(tmp_path, cena), tmp_path / "lanches", DetectorDaCor(), PERFIL)
    assert len(resumo) == 2 and all(r["mudouDeLugar"] == 0 for r in resumo), [(r["lanche"], r["duracaoS"], r["mudouDeLugar"]) for r in resumo]


def test_perto_a_regiao_que_cresce_pouco_ainda_e_o_lanche(tmp_path):
    # Empurrado 250 px com as metades mais afastadas (120 px): a região é 1,17 vez a do lanche, e ele é o mesmo.
    cena = cena_da_troca([(550, 270), (670, 270)], [(670, 270)])
    resumo = tl.lanches_da_densa(montar_densa(tmp_path, cena), tmp_path / "lanches", DetectorDaCor(), PERFIL)
    assert len(resumo) == 1 and resumo[0]["mudouDeLugar"] == 1, [(r["lanche"], r["duracaoS"]) for r in resumo]


def test_longe_a_regiao_que_cresce_muito_nao_e_o_lanche_puxado(tmp_path):
    # Depois da mão, 1,64 lado adiante no eixo, dois lanches lado a lado com a mesma cara (0,99): a região é 2,07 vezes.
    cena = cena_da_troca([(620, 290), (710, 290), (800, 290), (890, 290)], [(710, 290), (890, 290)], mao=True)
    resumo = tl.lanches_da_densa(montar_densa(tmp_path, cena), tmp_path / "lanches", DetectorDaCor(), PERFIL)
    assert len(resumo) == 2 and all(r["mudouDeLugar"] == 0 for r in resumo), [(r["lanche"], r["duracaoS"], r["mudouDeLugar"]) for r in resumo]


def test_fora_do_eixo_e_pelo_lado_maior_do_recorte():
    a, b = (0, 0, 100, 100), (300, 40, 400, 140)
    assert tl.fora_do_eixo(a, b, 960, 540) == 40, "deitado: o eixo é o horizontal"
    assert tl.fora_do_eixo(a, b, 540, 960) == 300, "em pé: o eixo é o vertical"


# ───────────────────────────── a cena ─────────────────────────────


def test_o_lanche_e_seguido_com_o_braco_o_ingrediente_e_o_empurrao(tmp_path):
    densa = montar_densa(tmp_path, cena())
    resumo = tl.lanches_da_densa(densa, tmp_path / "lanches", DetectorDaCor(), PERFIL)

    assert [(r["lanche"], r["eLanche"]) for r in resumo] == [(1, True), (2, False)], "a bandeja de 6 s não é lanche"
    l1 = resumo[0]
    assert l1["inicio"] == "2026-10-15 21:00:00"
    assert l1["fim"] == "2026-10-15 21:01:07", "terminou 13 s depois do último pão visto (o perfil diz 12)"
    assert l1["mudouDeLugar"] == 1, "empurrado: o mesmo lanche"
    assert l1["quadros"] == 67, "do pão aberto ao último quadro antes de encerrar, inclusive com o braço por cima"
    assert l1["etapas"][0] == "21h00m00.jpg", "a primeira etapa é o pão aberto"
    assert "21h00m30.jpg" in l1["etapas"], "o lanche no lugar novo começa outra etapa"
    entrou = [e for e in l1["etapas"] if "21h00m12.jpg" <= e <= "21h00m14.jpg"]
    assert len(entrou) == 1, "o ingrediente que ficou depois de o braço sair é uma etapa (uma só)"
    assert json.loads((tmp_path / "lanches" / "lanches.json").read_text(encoding="utf-8")) == resumo
    assert not (tmp_path / "lanches" / "lanche-02").exists()


def test_o_metades_e_os_recortes_ficam_como_a_identificacao_le(tmp_path):
    densa = montar_densa(tmp_path, cena())
    tl.lanches_da_densa(densa, tmp_path / "lanches", DetectorDaCor(), PERFIL)
    pasta = tmp_path / "lanches" / "lanche-01"
    with (pasta / "metades.csv").open(encoding="utf-8", newline="") as f:
        linhas = list(csv.DictReader(f))
    assert list(linhas[0]) == ["quadro", "hora", "trecho", "caixa", "metades"]
    assert len(linhas) == 67 and linhas[0]["hora"] == "21:00:00" and linhas[0]["quadro"] == "21h00m00.jpg"
    caixas = {l["trecho"]: l["caixa"] for l in linhas}
    assert set(caixas) == {"0", "1"} and caixas["0"] != caixas["1"], "uma caixa fixa por trecho"
    x0, y0, x1, y1 = (int(v) for v in caixas["0"].split(":"))
    recorte = cv2.imdecode(np.fromfile(str(pasta / linhas[0]["quadro"]), np.uint8), cv2.IMREAD_COLOR)
    assert recorte.shape[:2] == (y1 - y0, x1 - x0)
    metades = [m.split(":") for m in linhas[0]["metades"].split(";")]
    assert len(metades) == 2, "as duas metades vistas no primeiro quadro"
    for bx0, by0, bx1, by1, nota in metades:
        assert 0 <= float(bx0) < float(bx1) <= x1 - x0 and 0 <= float(by0) < float(by1) <= y1 - y0, "em pixels da caixa"
        assert float(nota) == 0.9
    com_braco = next(l for l in linhas if l["hora"] == "21:00:10")
    assert com_braco["metades"] == "", "o braço por cima: o quadro conta, sem metade vista"


def test_a_leitura_que_acaba_com_o_lanche_na_bancada_termina_ele_no_ultimo_quadro(tmp_path):
    # Até os 58 s: o pão foi visto pela última vez aos 54, e o perfil espera 12 s para encerrar — o lanche ainda está
    # na bancada quando a gravação acaba. Ele termina no último quadro lido, e não no último em que o pão foi visto.
    densa = montar_densa(tmp_path, cena()[:59])
    resumo = tl.lanches_da_densa(densa, tmp_path / "lanches", DetectorDaCor(), PERFIL)
    assert (resumo[0]["fim"], resumo[0]["duracaoS"]) == ("2026-10-15 21:00:58", 58.0)


def test_a_virada_da_meia_noite_nao_quebra_o_lanche(tmp_path):
    t0 = datetime(2026, 10, 15, 23, 59, 30)
    densa = montar_densa(tmp_path, cena(t0))
    resumo = tl.lanches_da_densa(densa, tmp_path / "lanches", DetectorDaCor(), PERFIL)
    assert resumo[0]["eLanche"] and resumo[0]["duracaoS"] == 67.0
    assert resumo[0]["fim"] == "2026-10-16 00:00:37"


def test_a_leitura_para_quando_mandam_sem_escrever_nada_e_a_que_terminou_e_reaproveitada(tmp_path):
    densa = montar_densa(tmp_path, cena())
    perguntas = []

    def pode():
        perguntas.append(1)
        return len(perguntas) < 2  # a segunda pergunta (no quadro 60) diz que a loja abriu

    assert tl.lanches_da_densa(densa, tmp_path / "lanches", DetectorDaCor(), PERFIL, pode_seguir=pode) is None
    assert tl.lanches_ja_lidos(tmp_path / "lanches") is None, "interrompida, nada fica escrito"
    assert len(perguntas) == 2, f"pergunta a cada {tl.PERGUNTA_A_CADA} quadros"
    resumo = tl.lanches_da_densa(densa, tmp_path / "lanches", DetectorDaCor(), PERFIL)
    assert tl.lanches_ja_lidos(tmp_path / "lanches") == resumo
    (tmp_path / "lanches" / tl.RESUMO).write_text('{"não": "é lista"}', encoding="utf-8")
    assert tl.lanches_ja_lidos(tmp_path / "lanches") is None


def test_sem_quadro_que_abra_nao_ha_lanche(tmp_path):
    densa = montar_densa(tmp_path, cena()[:3])
    for p in (densa / "recortes").iterdir():
        p.write_bytes(b"isto nao e jpeg")
    assert tl.lanches_da_densa(densa, tmp_path / "lanches", DetectorDaCor(), PERFIL) == []


# ───────────────────────────── as contas ─────────────────────────────


def test_os_pedacos_do_quadro_sao_o_inteiro_e_seis_sobrepostos_que_cobrem_tudo():
    pedacos = tl.pedacos_do_quadro(LARGURA, ALTURA)
    assert pedacos[0] == (0, 0, LARGURA, ALTURA) and len(pedacos) == 7
    coberto = np.zeros((ALTURA, LARGURA), bool)
    for x0, y0, w, h in pedacos[1:]:
        assert w == int(LARGURA / 3 * 1.3) and h == int(ALTURA / 2 * 1.3)
        coberto[y0:y0 + h, x0:x0 + w] = True
    assert coberto.all(), "os seis pedaços cobrem o quadro inteiro"


def test_o_mesmo_pao_visto_em_varios_pedacos_conta_uma_vez_e_o_tamanho_filtra():
    img = quadro([(480, 270)])
    achados = tl.paes(DetectorDaCor(), img, PERFIL)
    assert len(achados) == 1
    x0, y0, x1, y1, _ = achados[0]
    assert abs((x0 + x1) / 2 - 480) <= 1 and abs((y0 + y1) / 2 - 270) <= 1
    pequeno = tl.PerfilDaBancada(**{**PERFIL.__dict__, "pao_px_min": 100})
    assert tl.paes(DetectorDaCor(), img, pequeno) == [], "menor que um pão, não é pão"
    grande = tl.PerfilDaBancada(**{**PERFIL.__dict__, "pao_px_max": 70})
    assert tl.paes(DetectorDaCor(), img, grande) == [], "maior que um pão, não é pão"


def test_metades_vizinhas_sao_um_lanche_e_distantes_sao_dois():
    a, b, longe = (260, 230, 340, 310, 0.9), (350, 230, 430, 310, 0.8), (800, 100, 880, 180, 0.9)
    regioes = tl.lanches_do_quadro([a, b, longe])
    assert [r[4] for r in regioes] == [2, 1]
    x0, y0, x1, y1 = regioes[0][:4]
    assert (x0, x1) == (260 - 0.25 * 170, 430 + 0.25 * 170) and (y0, y1) == (230 - 0.25 * 80, 310 + 0.25 * 80)


def test_a_caixa_fixa_e_a_uniao_e_a_regiao_errada_no_meio_nao_a_estica():
    normais = [(100, 100, 300, 200), (110, 105, 310, 205), (105, 95, 305, 195)]
    assert tl.caixa_do_trecho(normais, 960, 540) == (100, 95, 310, 205)
    com_erro = normais + [(100, 100, 900, 500)]
    x0, y0, x1, y1 = tl.caixa_do_trecho(com_erro, 960, 540)
    assert x1 - x0 < 400 and y1 - y0 < 200, "a região errada no meio não estica a caixa"
    assert tl.caixa_do_trecho([(-50, -20, 1000, 600)], 960, 540) == (0, 0, 960, 540)


def test_o_perfil_da_bancada_exige_todo_numero_da_loja():
    dados = {k: getattr(PERFIL, k) for k in tl.PerfilDaBancada.__dataclass_fields__}
    assert tl.PerfilDaBancada.de_json(dados) == PERFIL
    del dados["sumiu_s"]
    with pytest.raises(KeyError):
        tl.PerfilDaBancada.de_json(dados)


def test_as_caixas_do_modelo_viram_pixels_da_imagem():
    logits = np.full((1, 300, 91), -9.0, np.float32)
    caixas = np.zeros((1, 300, 4), np.float32)
    donut = det._COCO91.index("donut")
    logits[0, 7, donut] = 2.0  # nota 0,88
    caixas[0, 7] = (0.5, 0.25, 0.2, 0.1)
    logits[0, 9, donut] = -1.0  # nota 0,27: abaixo do limite
    saida = det.interpretar_caixas(caixas, logits, "donut", 0.3, 800, 400)
    assert len(saida) == 1
    x0, y0, x1, y1, nota = saida[0]
    assert (x0, y0, x1, y1) == pytest.approx((320.0, 80.0, 480.0, 120.0)) and nota == pytest.approx(0.8808, abs=1e-4)
    with pytest.raises(ErroDoJuiz):
        det.interpretar_caixas(np.zeros((1, 300, 3)), logits, "donut", 0.3, 800, 400)
    with pytest.raises(ErroDoJuiz):
        det.interpretar_caixas(caixas, logits, "pão", 0.3, 800, 400)
