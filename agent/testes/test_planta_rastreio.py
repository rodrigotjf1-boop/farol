"""O rastreio firme (A26, 28/10/2026), contra a cozinha simulada (`testes/cozinha_simulada.py`): a verdade é onde cada
pessoa estava. O que a gravação de 27/10 mostrou e aqui não pode voltar: a mesma pessoa em duas câmeras virando duas,
o ponto pulando quando a bancada esconde as pernas (e o caminho atravessando o móvel), e a troca de câmera virando outra
pessoa."""

from __future__ import annotations

import json
import math

import numpy as np

from farol_agent.planta_viva import rastreio as rt
from testes.cozinha_simulada import A, L, CameraSimulada

BANCADA = rt.Movel(3.0, 1.8, 2.0, 0.7, 0.9)
PLANTA = rt.Planta((BANCADA,), (0.0, 0.0, 8.0, 5.0))
CAM_A = CameraSimulada("1", (0.3, 0.3, 2.2), (4.0, 2.6, 0.0))
CAM_B = CameraSimulada("2", (7.7, 4.7, 2.2), (4.0, 2.4, 0.0))


def canais(*cams, **k):
    return {c.canal: (c, rt.CanalDoRastreio(c.canal, c.homografia(), altura_medida=2.2, **k)) for c in cams}


def torta(h, dx, dy):
    """A homografia de uma calibração que errou o piso em (dx, dy) metros."""
    return (np.array([[1, 0, dx], [0, 1, dy], [0, 0, 1]]) @ np.array(h).reshape(3, 3)).ravel().tolist()


def rodar(cams, caminhos, *, planta=PLANTA, segundos=None, semente=1, a_cada=0.5, alturas=None, canais_prontos=None,
          perde=0.0, desvio=0.0):
    """Cada pessoa anda pelo caminho dela ((t) → (x, y) ou nulo, fora da cozinha); devolve, por instante, a verdade e o
    que o rastreio mostrou. `perde`: a chance de o detector não achar uma pessoa num quadro; `desvio`: o erro da
    calibração de cada câmera (sorteado até este tanto, em metros)."""
    rng = np.random.default_rng(semente)
    lidos = canais_prontos or canais(*cams)
    if desvio:
        lidos = {k: (cam, rt.CanalDoRastreio(k, torta(c.h, *rng.uniform(-desvio, desvio, 2)), altura_medida=2.2))
                 for k, (cam, c) in lidos.items()}
    r = rt.Rastreio(planta)
    saida = []
    total = segundos or 10.0
    for passo in range(int(total / a_cada) + 1):
        t = passo * a_cada
        verdade = {}
        for k, caminho in enumerate(caminhos):
            p = caminho(t)
            if p is not None:
                verdade[k] = p
        obs = []
        for cam, canal in lidos.values():
            caixas = []
            for k, (x, y) in verdade.items():
                c = cam.caixa(x, y, planta.moveis, altura=(alturas or {}).get(k, 1.7), rng=rng)
                if c is not None and rng.random() >= perde:
                    caixas.append(c)
            obs.extend(canal.observacoes(t, caixas, L, A, r))
        saida.append((t, verdade, r.passo(t, obs, dia="2026-10-28")))
    return saida


def reta(x0, y0, x1, y1, v=1.2, comeco=0.0):
    dist = math.hypot(x1 - x0, y1 - y0)

    def onde(t):
        s = (t - comeco) * v
        if s < 0 or s > dist:
            return None
        return x0 + (x1 - x0) * s / dist, y0 + (y1 - y0) * s / dist
    return onde


def _de_lado_e_no_raio(p: rt.Posicao, x: float, y: float) -> tuple[float, float]:
    dx, dy = x - p.x, y - p.y
    raio = dx * p.rumo[0] + dy * p.rumo[1]
    return abs(-dx * p.rumo[1] + dy * p.rumo[0]), abs(raio)


def test_atras_da_bancada_a_posicao_sai_da_cabeca_e_do_lado_de_la():
    canal = rt.CanalDoRastreio("1", CAM_A.homografia(), altura_medida=2.2)
    for x, y in [(3.6, 2.85), (4.2, 2.8), (4.8, 3.0)]:  # encostado na bancada, do lado de lá para a câmera A
        for altura in (1.65, 1.75):
            caixa = CAM_A.caixa(x, y, PLANTA.moveis, altura=altura)
            assert caixa is not None
            so_o_pe = rt.posicao_da_caixa(canal.h, canal.cam, caixa, L, A, planta=rt.Planta())
            p = rt.posicao_da_caixa(canal.h, canal.cam, caixa, L, A, planta=PLANTA)
            assert p is not None and p.pela_cabeca
            assert math.hypot(so_o_pe.x - x, so_o_pe.y - y) > 0.4, "a base da caixa é a beira da bancada, longe do pé"
            assert not BANCADA.dentro(p.x, p.y) and p.y > BANCADA.y + BANCADA.h, "do lado de lá do móvel que esconde"
            lado, raio = _de_lado_e_no_raio(p, x, y)
            assert lado < 0.1, f"a direção da cabeça é certa ({lado:.2f} m de lado)"
            if altura == 1.65:
                assert raio < 0.15, "com a altura padrão, a distância também"
            assert raio <= 1.5 * p.sigma_raio, f"10 cm mais alta: a distância erra ({raio:.2f} m), dentro da dúvida dita"
            assert p.sigma_raio > 2 * p.sigma, "pela cabeça, a distância vale menos que a direção"


def test_de_frente_para_a_bancada_o_pe_vale_e_mede_a_altura():
    canal = rt.CanalDoRastreio("1", CAM_A.homografia(), altura_medida=2.2)
    caixa = CAM_A.caixa(3.8, 1.55, PLANTA.moveis, altura=1.8)  # do lado de cá, encostado
    p = rt.posicao_da_caixa(canal.h, canal.cam, caixa, L, A, planta=PLANTA)
    assert p is not None and not p.pela_cabeca
    assert math.hypot(p.x - 3.8, p.y - 1.55) < 0.1
    assert p.altura is not None and abs(p.altura - 1.8) < 0.08


def test_uma_pessoa_andando_reto_em_duas_cameras_e_uma_so_e_reta():
    res = rodar([CAM_A, CAM_B], [reta(1.0, 3.6, 7.0, 3.6)], segundos=5.0)
    numeros = {n for _, _, mostradas in res for n, _, _ in mostradas}
    assert numeros == {1}, numeros
    instantes = [(t, v, m) for t, v, m in res if v and t >= 1.0]
    assert sum(len(m) == 1 for _, _, m in instantes) >= 0.95 * len(instantes)
    desvio = max(abs(y - 3.6) for _, _, m in instantes for _, _, y in m)
    erro = max(math.hypot(x - v[0][0], y - v[0][1]) for _, v, m in instantes for _, x, y in m)
    assert desvio < 0.25, f"o caminho reto ficou reto (desvio {desvio:.2f} m)"
    assert erro < 0.5, f"perto de onde a pessoa estava (erro {erro:.2f} m)"


def test_atras_da_bancada_o_caminho_nao_atravessa_o_movel():
    # anda ao longo da bancada, do lado de lá para a câmera A (que só vê o tronco) e de cá para a B
    res = rodar([CAM_A, CAM_B], [reta(2.6, 2.85, 5.4, 2.85, v=0.8)], segundos=4.0)
    pontos = [(x, y) for _, v, m in res if v for _, x, y in m]
    assert pontos and not any(BANCADA.dentro(x, y) for x, y in pontos)
    assert all(y > BANCADA.y + BANCADA.h for _, y in pontos), "sempre do lado em que a pessoa estava"
    assert {n for _, _, m in res for n, _, _ in m} == {1}


def test_a_troca_de_camera_nao_vira_outra_pessoa():
    # cada câmera olha a sua metade: a pessoa passa de uma para a outra no meio
    esquerda = CameraSimulada("6", (0.3, 2.5, 2.2), (2.6, 2.5, 0.0), abertura_h=80)
    direita = CameraSimulada("8", (7.7, 2.5, 2.2), (5.4, 2.5, 0.0), abertura_h=80)
    res = rodar([esquerda, direita], [reta(0.8, 3.8, 7.2, 3.8)], segundos=6.0, planta=rt.Planta((), (0, 0, 8, 5)))
    assert {n for _, _, m in res for n, _, _ in m} == {1}


def test_calibracao_torta_de_uma_camera_nao_duplica_a_pessoa():
    """Na loja, o mesmo pé visto por duas câmeras caiu a ~1 m: a homografia de uma delas desviada 0,8 m."""
    lidos = canais(CAM_A, CAM_B)
    lidos["2"] = (CAM_B, rt.CanalDoRastreio("2", torta(lidos["2"][1].h, 0.8, 0.0), altura_medida=2.2))
    res = rodar([CAM_A, CAM_B], [reta(1.0, 3.6, 7.0, 3.6)], segundos=5.0, canais_prontos=lidos)
    duplas = sum(len(m) > 1 for t, v, m in res if t >= 2.0)
    assert duplas <= 1, f"{duplas} instantes com a pessoa em dobro"


def test_duas_pessoas_lado_a_lado_continuam_duas():
    res = rodar([CAM_A, CAM_B], [reta(1.0, 3.4, 7.0, 3.4, v=1.0), reta(1.0, 4.2, 7.0, 4.2, v=1.0)], segundos=5.0)
    instantes = [m for t, v, m in res if t >= 1.5 and len(v) == 2]
    assert sum(len(m) == 2 for m in instantes) >= 0.9 * len(instantes)
    assert len({n for m in instantes for n, _, _ in m}) == 2, "cada uma com o seu número, sem trocar"


def test_oito_pessoas_cruzando_a_cozinha():
    cams = [CAM_A, CAM_B, CameraSimulada("3", (7.7, 0.3, 2.2), (4.0, 2.5, 0.0)), CameraSimulada("4", (0.3, 4.7, 2.2), (4.0, 2.5, 0.0))]
    caminhos = [
        reta(0.6, 0.8, 7.4, 0.8, v=1.0), reta(7.4, 1.4, 0.6, 1.4, v=0.9),
        reta(0.6, 3.1, 7.4, 3.1, v=1.1), reta(7.4, 3.9, 0.6, 3.9, v=1.0),
        reta(0.6, 4.6, 7.4, 4.6, v=0.8), reta(2.0, 0.5, 2.3, 4.7, v=0.6),
        reta(6.0, 4.7, 6.2, 0.5, v=0.65), reta(1.2, 2.9, 1.2, 4.6, v=0.25),
    ]  # todas continuam na cozinha durante os 6 s
    res = rodar(cams, caminhos, segundos=6.0, semente=7)
    instantes = [(v, m) for t, v, m in res if t >= 1.5]
    certos = sum(len(m) == len(v) for v, m in instantes)
    assert certos >= 0.8 * len(instantes), f"a contagem certa em {certos} de {len(instantes)} instantes"
    assert max(abs(len(m) - len(v)) for v, m in instantes) <= 2
    assert len({n for _, m in instantes for n, _, _ in m}) <= 11, "poucas trocas de número com 8 pessoas"


def test_quem_sai_nao_vira_fantasma_quando_outro_passa_no_lugar():
    def parada_e_sai(t):  # fica 2 s junto à câmara fria e entra nela (some)
        return (1.4, 4.1) if t <= 2.0 else None

    res = rodar([CAM_A, CAM_B], [parada_e_sai, reta(0.6, 4.0, 7.4, 4.0, v=1.0, comeco=1.0)], segundos=7.0)
    depois = [m for t, v, m in res if t >= 2.0 + rt.MOSTRA_SEM_VER_S + 0.5 and v]
    assert depois and sum(len(m) == 1 for m in depois) >= 0.9 * len(depois), [len(m) for m in depois]


def test_fora_da_area_calibrada_a_vista_vale_menos():
    """O canal 8 da loja errou 1,5–2 m com o pé fora do contorno dos pontos marcados (a lente distorce na borda)."""
    area = [(0.3, 0.5), (0.7, 0.5), (0.7, 0.9), (0.3, 0.9)]
    assert rt.fora_da_area((0.5, 0.7), area) == 0.0 and rt.fora_da_area((0.5, 0.7), None) == 0.0
    assert abs(rt.fora_da_area((0.8, 0.7), area) - 0.1) < 1e-9
    assert abs(rt.fora_da_area((0.8, 1.0), area) - math.hypot(0.1, 0.1)) < 1e-9, "fora pelo canto"
    assert rt.fora_da_area((0.5, 0.7), list(reversed(area))) == 0.0, "a ordem do contorno não importa"
    canal = rt.CanalDoRastreio("1", CAM_A.homografia(), altura_medida=2.2)
    caixa = CAM_A.caixa(2.0, 1.4)
    dentro = rt.posicao_da_caixa(canal.h, canal.cam, caixa, L, A, area=[(0, 0), (1, 0), (1, 1), (0, 1)])
    fora = rt.posicao_da_caixa(canal.h, canal.cam, caixa, L, A, area=[(0.9, 0.0), (1.0, 0.0), (1.0, 1.0), (0.9, 1.0)])
    assert fora.sigma > dentro.sigma + 1.0, "longe do contorno: a dúvida cresce (e outra câmera manda)"


def test_pe_cortado_embaixo_fica_mais_perto_da_camera_que_a_borda():
    """Embaixo do canal 6 (27/10), o pé saía pela borda de baixo e a cabeça sozinha punha a pessoa a 3 m dali."""
    canal = rt.CanalDoRastreio("1", CAM_A.homografia(), altura_medida=2.2)
    # alguém alto (2 m) quase embaixo da câmera, com o pé fora do quadro: pela altura padrão a cabeça cairia longe
    x, y = 0.9, 0.9
    topo = CAM_A.imagem(x, y, 2.0)
    borda = rt.projetar(canal.h, (topo[0], rt.BORDA_DE_BAIXO))  # o chão da borda de baixo, na coluna da pessoa
    limite = math.hypot(borda[0] - canal.cam.centro[0], borda[1] - canal.cam.centro[1])
    assert CAM_A.imagem(x, y, 0.0)[1] > 1.0, "o pé está fora do quadro"
    caixa = ((topo[0] - 0.03) * L, topo[1] * A, (topo[0] + 0.03) * L, A, 0.9)
    so_a_cabeca = rt.cm.ponto_na_altura(canal.cam, topo, rt.cm.ALTURA_DA_CABECA)
    assert math.hypot(so_a_cabeca[0] - canal.cam.centro[0], so_a_cabeca[1] - canal.cam.centro[1]) > limite + 0.5
    p = rt.posicao_da_caixa(canal.h, canal.cam, caixa, L, A)
    assert p is not None and p.pela_cabeca
    assert math.hypot(p.x - canal.cam.centro[0], p.y - canal.cam.centro[1]) <= limite + 0.05, "não passa da borda"
    assert math.hypot(p.x - x, p.y - y) < math.hypot(so_a_cabeca[0] - x, so_a_cabeca[1] - y), "mais perto da verdade"


def test_quem_some_e_volta_por_outro_lado_continua_com_o_numero():
    """27/10, 122–123 s: o dono sumiu 1 s, virou, e voltou longe de onde a previsão em linha reta o punha."""
    canal = rt.CanalDoRastreio("1", CAM_A.homografia(), altura_medida=2.2)
    r = rt.Rastreio(PLANTA)
    t = 0.0
    for y in (3.0, 3.4, 3.8, 4.2):  # subindo a 0,8 m/s
        r.passo(t, canal.observacoes(t, [CAM_A.caixa(6.5, y)], L, A, r))
        t += 0.5
    r.passo(t, [])  # some (coberto) …
    t += 0.5
    volta = r.passo(t + 0.5, canal.observacoes(t + 0.5, [CAM_A.caixa(5.3, 3.6)], L, A, r))  # … e volta para trás
    assert [n for n, *_ in volta] == [1], volta


def test_o_ponto_nunca_cai_dentro_de_moveis_encostados():
    parede = rt.Movel(0.0, 0.0, 1.0, 3.0, 2.0)
    bancada = rt.Movel(1.0, 1.0, 0.8, 1.0, 0.9)  # encostada na parede
    x, y = rt.no_chao_livre(1.05, 1.5, (parede, bancada))
    assert not parede.dentro(x, y) and not bancada.dentro(x, y)
    assert abs(x - (bancada.x + bancada.w + rt.FOLGA_DO_MOVEL)) < 1e-9 or y in (bancada.y - rt.FOLGA_DO_MOVEL, bancada.y + bancada.h + rt.FOLGA_DO_MOVEL)
    cercado = tuple(rt.Movel(x0, y0, 1.0, 1.0, 0.9) for x0 in (0, 1, 2) for y0 in (0, 1, 2) if (x0, y0) != (1, 1)) + (rt.Movel(1, 1, 1, 1, 0.9),)
    x, y = rt.no_chao_livre(1.5, 1.5, cercado)
    assert not any(m.dentro(x, y) for m in cercado), "no meio de um bloco de móveis: o chão livre em volta"


def test_o_desvio_de_cada_camera_e_aprendido_com_quem_anda_sozinho():
    """Calibração da câmera B torta em 0,6 m: andando sozinha à vista das duas, cada câmera aprende metade da diferença
    — e as vistas, corrigidas, passam a concordar."""
    lidos = canais(CAM_A, CAM_B)
    lidos["2"] = (CAM_B, rt.CanalDoRastreio("2", torta(lidos["2"][1].h, 0.6, 0.0), altura_medida=2.2))
    ida_e_volta = lambda t: (1.0 + abs((t * 1.0) % 12 - 6), 4.4)  # noqa: E731 — longe da bancada: o pé sempre à vista
    r = rt.Rastreio(PLANTA)
    rng = np.random.default_rng(3)
    for k in range(80):
        t = k * 0.5
        x, y = ida_e_volta(t)
        obs = []
        for cam, canal in lidos.values():
            c = cam.caixa(x, y, PLANTA.moveis, rng=rng)
            obs.extend(canal.observacoes(t, [c] if c else [], L, A, r))
        r.passo(t, obs, dia="d")
    resumo = r.desvios.resumo()
    assert set(resumo) == {"1", "2"} and min(n for *_, n in resumo.values()) >= rt.DESVIO_A_PARTIR_DE
    diferenca = resumo["2"][0] - resumo["1"][0]
    assert abs(diferenca - 0.6) < 0.15, resumo
    assert abs(resumo["2"][1] - resumo["1"][1]) < 0.15
    # guardado e lido de volta, e esquecido quando a câmera é calibrada de novo
    de_volta = rt.DesvioDasCameras.de_json(json.loads(json.dumps(r.desvios.para_json())))
    assert de_volta.resumo() == resumo and de_volta.de("2", x, y) == r.desvios.de("2", x, y)
    de_volta.esquecer("2")
    assert "2" not in de_volta.resumo() and de_volta.de("2", x, y) == (0.0, 0.0)
    assert rt.DesvioDasCameras.de_json({"celula": 99}).geral == {}, "outra régua: recomeça"


def test_um_falso_positivo_solto_nao_vira_gente():
    canal = rt.CanalDoRastreio("1", CAM_A.homografia(), altura_medida=2.2)
    r = rt.Rastreio(PLANTA)
    caixa = CAM_A.caixa(2.0, 1.0)
    assert r.passo(0.0, canal.observacoes(0.0, [caixa], L, A, r)) == []
    assert r.passo(0.5, canal.observacoes(0.5, [], L, A, r)) == []
    assert r.passo(1.6, []) == [] and r.pessoas == [], "a tentativa some"


def test_coberta_por_um_instante_continua_e_depois_some():
    canal = rt.CanalDoRastreio("1", CAM_A.homografia(), altura_medida=2.2)
    r = rt.Rastreio(PLANTA)
    for t in (0.0, 0.5, 1.0):
        r.passo(t, canal.observacoes(t, [CAM_A.caixa(2.0, 1.0)], L, A, r))
    assert [n for n, *_ in r.passo(1.5, [])] == [1], "falhou um quadro: continua"
    # 28/10: continua NA PLANTA enquanto o rastreio a segura (antes saía dela 1 s depois — o dono via sumir e voltar)
    assert [n for n, *_ in r.passo(1.0 + rt.PERDA_S - 0.1, [])] == [1], "sem ser vista 3,9 s: ainda no mapa"
    assert r.passo(1.0 + rt.PERDA_S + 0.1, []) == [], "passou do prazo: some da planta"
    assert r.pessoas == []


# ───────────────────────────── quem pisca não some (28/10/2026) ─────────────────────────────

def fraca(caixa, nota=0.4):
    """A mesma caixa com a nota baixa do detector (entre a fraca e a mínima)."""
    return (*caixa[:4], nota)


def test_quem_pisca_de_1_a_4_s_fica_no_mapa_no_mesmo_lugar_e_com_o_numero():
    """O dono, 28/10: "do nada a pessoa no mapa some mesmo estando ainda no mapa, e depois aparece no mesmo local"."""
    canal = rt.CanalDoRastreio("1", CAM_A.homografia(), altura_medida=2.2)
    r = rt.Rastreio(PLANTA)
    for t in (0.0, 0.5, 1.0):
        r.passo(t, canal.observacoes(t, [CAM_A.caixa(2.0, 1.0)], L, A, r))
    no_sumico = [r.passo(t, canal.observacoes(t, [], L, A, r)) for t in (1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5)]
    assert all(len(m) == 1 for m in no_sumico), "parada e sem ser vista 3,5 s: continua no mapa"
    assert all(math.hypot(x - 2.0, y - 1.0) < 0.3 for m in no_sumico for _, x, y in m), "no mesmo lugar, não anda sozinha"
    volta = r.passo(5.0, canal.observacoes(5.0, [CAM_A.caixa(2.0, 1.0)], L, A, r))
    assert [n for n, *_ in volta] == [1], "voltou com o mesmo número"
    assert r.contas.voltas_longas == 1 and r.contas.voltas_curtas == 0 and r.contas.perdidas == 0


def test_parada_com_o_detector_falhando_metade_das_vezes_fica_no_mapa():
    """Duas câmeras perdendo a pessoa em metade dos quadros: com 1 s na planta ela sumia; com o prazo inteiro, fica."""
    res = rodar([CAM_A, CAM_B], [lambda t: (2.0, 1.0)], segundos=60.0, perde=0.5, semente=3)
    depois = [m for t, v, m in res if t >= 2.0]
    assert sum(len(m) == 1 for m in depois) >= 0.97 * len(depois), sum(len(m) == 1 for m in depois) / len(depois)
    assert len({n for m in depois for n, *_ in m}) == 1, "o mesmo número o tempo todo"


def test_a_caixa_fraca_sozinha_nao_cria_gente():
    canal = rt.CanalDoRastreio("1", CAM_A.homografia(), altura_medida=2.2)
    r = rt.Rastreio(PLANTA)
    for t in (0.0, 0.5, 1.0, 1.5, 2.0):
        assert r.passo(t, canal.observacoes(t, [fraca(CAM_A.caixa(2.0, 1.0))], L, A, r)) == []
    assert r.pessoas == [], "nem tentativa"
    assert [c for c in canal.observacoes(2.5, [fraca(CAM_A.caixa(2.0, 1.0), nota=rt.NOTA_FRACA - 0.01)], L, A, r)] == [], \
        "abaixo da nota fraca nem vira vista"
    # uma vista forte solta (a tentativa) e depois só fracas: a fraca não segura quem ainda não foi confirmado
    r.passo(3.0, canal.observacoes(3.0, [CAM_A.caixa(4.0, 4.0)], L, A, r))
    assert len(r.pessoas) == 1 and not r.pessoas[0].confirmada
    for t in (3.5, 4.0, 4.5):
        r.passo(t, canal.observacoes(t, [fraca(CAM_A.caixa(4.0, 4.0))], L, A, r))
    assert r.pessoas == [], "a tentativa some no prazo dela"


def test_a_caixa_fraca_segura_quem_ja_esta_sem_ensinar_altura_nem_desvio():
    canal = rt.CanalDoRastreio("1", CAM_A.homografia(), altura_medida=2.2)
    r = rt.Rastreio(PLANTA)
    for t in (0.0, 0.5, 1.0):
        r.passo(t, canal.observacoes(t, [CAM_A.caixa(2.0, 1.0)], L, A, r))
    (p,) = r.pessoas
    alturas, vistas = list(p.alturas), p.vistas
    t = 1.5
    while t <= 1.0 + rt.FRACA_SEGURA_S:  # só a fraca, por todo o tempo em que ela pode segurar
        assert [n for n, *_ in r.passo(t, canal.observacoes(t, [fraca(CAM_A.caixa(2.0, 1.0))], L, A, r))] == [1], t
        t += 0.5
    assert p.alturas == alturas and p.vistas == vistas, "a fraca não mede altura nem conta como vista"
    assert r.contas.seguradas_pela_fraca >= 10
    assert r.desvios.resumo() == {}
    # passou de FRACA_SEGURA_S desde a última forte: a fraca já não segura, e a pessoa sai depois do prazo de sempre
    fim = t + rt.PERDA_S + 0.5
    while t <= fim:
        r.passo(t, canal.observacoes(t, [fraca(CAM_A.caixa(2.0, 1.0))], L, A, r))
        t += 0.5
    assert r.pessoas == [], "a fraca não segura um fantasma a noite inteira"


def test_a_caixa_fraca_longe_de_quem_esta_nao_e_ela():
    canal = rt.CanalDoRastreio("1", CAM_A.homografia(), altura_medida=2.2)
    r = rt.Rastreio(PLANTA)
    for t in (0.0, 0.5, 1.0):
        r.passo(t, canal.observacoes(t, [CAM_A.caixa(2.0, 1.0)], L, A, r))
    longe = canal.observacoes(1.5, [fraca(CAM_A.caixa(6.0, 4.0))], L, A, r)
    assert longe and longe[0].fraca
    r.passo(1.5, longe)
    (p,) = r.pessoas
    assert math.hypot(p.x - 2.0, p.y - 1.0) < 0.3 and r.contas.seguradas_pela_fraca == 0, "não puxou a pessoa para lá"


def test_a_vista_forte_escolhe_antes_da_fraca():
    canal_a = rt.CanalDoRastreio("1", CAM_A.homografia(), altura_medida=2.2)
    r = rt.Rastreio(PLANTA)
    for t in (0.0, 0.5, 1.0):
        r.passo(t, canal_a.observacoes(t, [CAM_A.caixa(2.0, 1.0)], L, A, r))
    # a mesma câmera vê uma caixa fraca BEM onde a pessoa estava (um reflexo) e a forte a 30 cm: a forte fica com a
    # pessoa, e a fraca não vira ninguém (se a fraca escolhesse antes, a forte viraria uma pessoa nova)
    vistas = canal_a.observacoes(1.5, [fraca(CAM_A.caixa(2.0, 1.0)), CAM_A.caixa(2.3, 1.1)], L, A, r)
    assert sorted(o.fraca for o in vistas) == [False, True]
    r.passo(1.5, vistas)
    (p,) = r.pessoas
    assert p.forte_em == 1.5 and r.contas.seguradas_pela_fraca == 0


def test_as_contas_do_sumico_e_quem_renasce_perto_de_onde_sumiu():
    canal = rt.CanalDoRastreio("1", CAM_A.homografia(), altura_medida=2.2)
    r = rt.Rastreio(PLANTA)
    vista = lambda t: canal.observacoes(t, [CAM_A.caixa(2.0, 1.0)], L, A, r)  # noqa: E731
    for t in (0.0, 0.5, 1.0):
        r.passo(t, vista(t))
    r.passo(1.5, [])
    r.passo(2.0, vista(2.0))  # 1 s sem ver: volta curta
    t = 2.5
    while t <= 2.0 + rt.PERDA_S + 0.5:  # some de vez
        r.passo(t, [])
        t += 0.5
    assert r.pessoas == []
    longe = lambda t: canal.observacoes(t, [CAM_A.caixa(5.5, 4.0)], L, A, r)  # noqa: E731
    r.passo(8.0, longe(8.0))
    r.passo(8.5, longe(8.5))
    assert len(r.pessoas) == 1 and r.pessoas[0].confirmada and r.contas.renasceram == 0, "longe de onde sumiu: é outra"
    r.pessoas = []
    t = 2.0 + 10.0  # 10 s depois de vista pela última vez, alguém aparece no mesmo lugar
    r.passo(t, vista(t))
    r.passo(t + 0.5, vista(t + 0.5))
    c = r.contas_e_zerar()
    assert (c.voltas_curtas, c.voltas_longas, c.perdidas, c.renasceram) == (1, 0, 1, 1)
    assert c.renasceram_s == [10.5], "do último instante em que foi vista até aparecer de novo"
    assert r.contas == rt.Contas(), "a leitura zera"


def test_o_ponto_nunca_fica_dentro_do_movel_e_o_dia_novo_recomeca():
    assert rt.no_chao_livre(4.0, 2.4, (BANCADA,)) == (4.0, BANCADA.y + BANCADA.h + rt.FOLGA_DO_MOVEL)
    assert rt.no_chao_livre(3.1, 2.0, (BANCADA,)) == (BANCADA.x - rt.FOLGA_DO_MOVEL, 2.0)
    r = rt.Rastreio(PLANTA)
    o = rt.Observacao("1", 1, 4.0, 2.2, 0.05)
    r.passo(0.0, [o], dia="2026-10-28")
    (n, x, y), = r.passo(0.5, [o], dia="2026-10-28")
    assert n == 1 and not BANCADA.dentro(x, y)
    r.passo(1.0, [rt.Observacao("1", 9, 1.0, 1.0, 0.05)], dia="2026-10-29")
    (n, _, _), = r.passo(1.5, [rt.Observacao("1", 9, 1.0, 1.0, 0.05)], dia="2026-10-29")
    assert n == 1, "o número é do dia"


def test_a_aparencia_e_so_a_cor_da_roupa():
    img = np.zeros((A, L, 3), np.uint8)
    img[100:300, 100:200] = (255, 255, 255)  # uniforme branco
    img[100:300, 400:500] = (0, 0, 200)  # vermelho (BGR)
    branco = rt.aparencia_da_caixa(img, (100, 60, 200, 330))
    vermelho = rt.aparencia_da_caixa(img, (400, 60, 500, 330))
    assert branco is not None and vermelho is not None
    assert abs(branco.sum() - 1) < 1e-9 and branco.shape == (11,)
    assert rt._parecidas(branco, branco) > 0.99 and rt._parecidas(branco, vermelho) < 0.1
    assert rt._parecidas(None, branco) == 0.5


# ───────────────────────────── o minuto recusado pela nuvem (ERR-158, 28/10/2026) ─────────────────────────────

def test_a_pessoa_na_beira_mostrada_e_guardada_fica_dentro_da_planta():
    """A loja de 28/10: a parede do fundo da cozinha é o y = 0; a vista vale até 0,5 m além da beira e a previsão anda
    sem ser vista — a pessoa saía em y negativo e a nuvem recusava o minuto inteiro a noite toda."""
    r = rt.Rastreio(rt.Planta((), (0.0, 0.0, 8.0, 5.0)))
    for k in range(4):  # andando para a parede; a última vista já 0,3 m além dela
        r.passo(k * 0.5, [rt.Observacao("1", 1, 4.0, 0.6 - 0.3 * k, 0.05)], dia="2026-10-28")
    vistos = 0
    for t in (2.0, 3.0, 4.5):  # depois, sem ser vista: a previsão segue para fora
        for _, x, y in r.passo(t, [], dia="2026-10-28"):
            vistos += 1
            assert 0.0 <= x <= 8.0 and 0.0 <= y <= 5.0, (t, x, y)
        for _, x, y, *_ in r.agora(t):
            assert 0.0 <= x <= 8.0 and 0.0 <= y <= 5.0, ("ao vivo", t, x, y)
    assert vistos >= 2, "continua no mapa enquanto o rastreio a segura — dentro da planta"


def test_dentro_da_bancada_encostada_na_parede_o_chao_livre_e_a_frente_dela():
    bancada = rt.Movel(3.0, 0.0, 2.0, 1.0, 0.9)  # a montagem encostada na parede do fundo (y = 0)
    limites = (0.0, 0.0, 8.0, 5.0)
    assert rt.no_chao_livre(4.0, 0.2, (bancada,))[1] < 0, "sem os limites a beira mais perto é a de trás: atrás da parede"
    assert rt.no_chao_livre(4.0, 0.2, (bancada,), limites=limites) == (4.0, bancada.y + bancada.h + rt.FOLGA_DO_MOVEL)
    assert rt.Planta((), limites).prender(-0.3, 5.2) == (0.0, 5.0) and rt.Planta((), None).prender(-0.3, 5.2) == (-0.3, 5.2)
