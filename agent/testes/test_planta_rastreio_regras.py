"""Cada regra do rastreio firme (A26, 28/10/2026) num caso curto e direto — as vistas montadas à mão, sem câmera
simulada, para cada decisão ter o seu teste (as mutações de `rastreio.py` mostraram que os cenários grandes passam
mesmo sem várias delas). A regra, o porquê e de onde veio (a gravação de 27/10 ou a simulação) ficam no nome."""

from __future__ import annotations

import math

from farol_agent.planta_viva import rastreio as rt
from testes.cozinha_simulada import A, L
from testes.test_planta_rastreio import BANCADA, CAM_A, PLANTA


def ob(canal: str, trilha: int, x: float, y: float, s: float = 0.05, **kw) -> rt.Observacao:
    return rt.Observacao(canal, trilha, x, y, s, **kw)


def pessoa(r: rt.Rastreio, numero: int) -> rt.Pessoa:
    return next(p for p in r.pessoas if p.numero == numero)


# ───────────────────────────── a posição de uma caixa ─────────────────────────────

def test_escondida_pela_bancada_e_mais_baixa_que_a_padrao_fica_do_lado_de_la():
    """Pela cabeça de alguém mais baixo, o raio cruza a altura padrão ANTES da pessoa — dentro da bancada; o que fica
    no chão livre mais perto seria a beira de cá. Quem a bancada esconde está do lado de lá."""
    canal = rt.CanalDoRastreio("1", CAM_A.homografia(), altura_medida=2.2)
    x, y = 4.0, 2.62
    caixa = CAM_A.caixa(x, y, PLANTA.moveis, altura=1.45)
    topo = (((caixa[0] + caixa[2]) / 2) / L, caixa[1] / A)
    so_a_cabeca = rt.cm.ponto_na_altura(canal.cam, topo, rt.cm.ALTURA_DA_CABECA)
    assert BANCADA.dentro(*so_a_cabeca), "pré-condição: a cabeça sozinha cai dentro da bancada"
    p = rt.posicao_da_caixa(canal.h, canal.cam, caixa, L, A, planta=PLANTA)
    assert p is not None and p.pela_cabeca
    assert p.y > BANCADA.y + BANCADA.h, "do lado de lá"
    assert math.hypot(p.x - x, p.y - y) < 0.5


def test_o_pe_colado_na_beira_de_ca_do_movel_e_o_pe():
    """A planta erra uns centímetros: o pé a menos de `MARGEM_DA_PLANTA` dentro da beira por onde o raio entra é de quem
    está encostado do lado de cá; mais para dentro, a bancada esconde."""
    cam = rt.cm.camera_da_homografia(CAM_A.homografia())
    assert rt.movel_que_esconde(cam, (3.5, 1.85), (BANCADA,)) is None
    assert rt.movel_que_esconde(cam, (3.5, 2.3), (BANCADA,)) == BANCADA
    assert rt.movel_que_esconde(cam, (2.0, 1.0), (BANCADA,)) is None, "no chão livre, nada esconde"


def test_a_cabeca_acima_da_area_calibrada_nao_e_cobrada():
    """A área calibrada é do chão; a cabeça fica acima dela na imagem por natureza — só os lados contam."""
    canal = rt.CanalDoRastreio("1", CAM_A.homografia(), altura_medida=2.2)
    area = [(0.0, 0.5), (1.0, 0.5), (1.0, 0.95), (0.0, 0.95)]
    caixa = (0.46 * L, 0.35 * A, 0.54 * L, A, 0.9)  # o pé passa da borda de baixo: vale a cabeça, em v = 0,35
    p = rt.posicao_da_caixa(canal.h, canal.cam, caixa, L, A, area=area)
    assert p is not None and p.pela_cabeca and p.sigma < 1.0, p
    de_lado = rt.posicao_da_caixa(canal.h, canal.cam, caixa, L, A, area=[(0.6, 0.5), (1.0, 0.5), (1.0, 0.95), (0.6, 0.95)])
    assert de_lado.sigma > p.sigma + 0.8, "saindo pelo lado, conta"


def test_agachada_o_pe_ainda_vale_com_mais_duvida():
    """A cabeça baixa demais para o pé (agachada, ou escondida por algo fora da planta): fica o pé, com 3× a dúvida."""
    canal = rt.CanalDoRastreio("1", CAM_A.homografia(), altura_medida=2.2)
    em_pe = rt.posicao_da_caixa(canal.h, canal.cam, CAM_A.caixa(2.0, 1.2, altura=1.7), L, A)
    agachada = rt.posicao_da_caixa(canal.h, canal.cam, CAM_A.caixa(2.0, 1.2, altura=1.0), L, A)
    assert agachada is not None and not agachada.pela_cabeca and agachada.altura is None
    assert math.hypot(agachada.x - 2.0, agachada.y - 1.2) < 0.15
    assert agachada.sigma > 2.5 * em_pe.sigma and em_pe.altura is not None


# ───────────────────────────── o vulto em cada câmera ─────────────────────────────

def test_a_trilha_segue_a_caixa_que_se_sobrepoe_e_anda_com_ela():
    tr = rt.TrilhasDaCamera()
    assert tr.passo(0.0, [(100, 50, 160, 300), (400, 60, 450, 260)]) == [1, 2]
    # cada uma andou 20 px para o lado: a mesma trilha (a caixa prevista anda junto)
    assert tr.passo(0.5, [(420, 60, 470, 260), (120, 50, 180, 300)]) == [2, 1]
    assert tr.passo(1.0, [(140, 50, 200, 300)]) == [1]
    # uma caixa que não se sobrepõe a nenhuma (nem à prevista) é outro vulto
    assert tr.passo(1.5, [(600, 50, 650, 300)]) == [3]
    assert rt.sobreposicao((0, 0, 10, 10), (5, 0, 15, 10)) == 50 / 150 and rt.sobreposicao((0, 0, 1, 1), (2, 2, 3, 3)) == 0.0


# ───────────────────────────── ligar a vista à pessoa ─────────────────────────────

def test_quem_foi_visto_agora_escolhe_antes_de_quem_sumiu():
    """Uma vista entre duas pessoas — uma vista no quadro anterior, outra sumida há 1 s: é da que está sendo vista (a
    vista de quem passa não "revive" quem já saiu)."""
    r = rt.Rastreio()
    r.passo(0.0, [ob("1", 1, 2.0, 2.0), ob("2", 1, 2.0, 2.0), ob("1", 2, 3.0, 2.0), ob("2", 2, 3.0, 2.0)])
    r.passo(0.5, [ob("1", 2, 3.0, 2.0)])
    r.passo(1.0, [ob("1", 9, 2.45, 2.0)])
    assert pessoa(r, 1).visto_em == 0.0 and pessoa(r, 2).visto_em == 1.0


def test_a_trilha_trocada_pela_camera_nao_troca_as_pessoas():
    """A câmera trocou as trilhas de duas pessoas paradas lado a lado: a distância decide, não a trilha."""
    r = rt.Rastreio()
    for t in (0.0, 0.5):
        r.passo(t, [ob("1", 1, 2.0, 2.0), ob("2", 1, 2.0, 2.0), ob("1", 2, 3.0, 2.0), ob("2", 2, 3.0, 2.0)])
    r.passo(1.0, [ob("1", 2, 2.0, 2.0), ob("2", 1, 2.0, 2.0), ob("1", 1, 3.0, 2.0), ob("2", 2, 3.0, 2.0)])
    assert abs(pessoa(r, 1).x - 2.0) < 0.2 and abs(pessoa(r, 2).x - 3.0) < 0.2


def test_uma_camera_com_duas_caixas_sao_duas_pessoas():
    """Duas caixas da MESMA câmera nunca vão para a mesma pessoa. A segunda, colada na primeira, aparece depois de
    vista `CONFIRMA_PERTO` vezes."""
    r = rt.Rastreio()
    for t in (0.0, 0.5, 1.0):
        r.passo(t, [ob("1", 1, 2.0, 2.0)])
    for k in range(rt.CONFIRMA_PERTO):
        mostradas = r.passo(1.5 + k * 0.5, [ob("1", 1, 2.0, 2.0), ob("1", 2, 2.9, 2.0)])
    assert len(mostradas) == 2
    assert abs(pessoa(r, 1).x - 2.0) < 0.1, "a primeira não é puxada pela caixa da outra"


def test_quem_some_e_volta_para_tras_continua_e_recomeca_de_onde_foi_visto():
    """Andando a 1,8 m/s, some 1 s e volta 1,5 m para trás: a previsão em linha reta já está 3 m à frente; o que vale é
    o quanto deu para andar desde o último lugar visto — e a posição recomeça dali, não da previsão."""
    r = rt.Rastreio()
    for k, x in enumerate((1.0, 1.9, 2.8, 3.7)):
        r.passo(k * 0.5, [ob("1", 1, x, 2.0), ob("2", 1, x, 2.0)])
    r.passo(2.0, [])
    volta = r.passo(2.5, [ob("1", 5, 2.2, 2.0, s=0.3), ob("2", 5, 2.2, 2.0, s=0.3)])
    assert [n for n, *_ in volta] == [1], volta
    assert abs(volta[0][1] - 2.2) < 0.25, "recomeça de onde voltou a ser vista, não da previsão 3 m à frente"


def test_a_trilha_ligada_alcanca_o_que_deu_para_andar():
    """A mesma trilha (canal 1, 27/10, 59 s): 1 s sem ser vista, a vista volta 1,85 m dali — o raio da trilha ligada
    cresce com o tempo, como o das outras (era fixo em 1,6 m e virava outra pessoa)."""
    r = rt.Rastreio()
    for k, x in enumerate((1.0, 1.9, 2.8, 3.7)):
        r.passo(k * 0.5, [ob("1", 1, x, 2.0)])
    r.passo(2.0, [])
    volta = r.passo(2.5, [ob("1", 1, 1.85, 2.0)])
    assert [n for n, *_ in volta] == [1], volta
    assert pessoa(r, 1).visto_em == 2.5 and len(r.pessoas) == 1, "a vista foi para ela (não nasceu outra)"


def test_a_vista_pela_cabeca_nao_alcanca_quem_esta_longe_no_mesmo_rumo():
    """A dúvida grande no sentido do raio não pode deixar a vista "achar" qualquer um naquele rumo: o raio conta ao
    menos 40% na distância."""
    r = rt.Rastreio()
    for t in (0.0, 0.5):
        r.passo(t, [ob("1", 1, 2.0, 4.0)])
    r.passo(1.0, [ob("1", 2, 2.0, 7.5, s=0.1, sigma_raio=2.0, rumo=(0.0, 1.0), pela_cabeca=True)])
    assert pessoa(r, 1).visto_em == 0.5 and len(r.pessoas) == 2, "a de longe é outra (tentativa)"


# ───────────────────────────── nascer, aparecer e juntar ─────────────────────────────

def test_a_vista_de_uma_camera_so_vai_para_quem_as_outras_estao_vendo():
    """A câmera de longe (ou torta naquele canto) põe a pessoa a 1,6 m de onde as outras duas a veem: é a mesma."""
    r = rt.Rastreio()
    r.passo(0.0, [ob("1", 1, 4.0, 4.0), ob("2", 1, 4.0, 4.0)])
    for k in range(1, 7):
        mostradas = r.passo(k * 0.5, [ob("1", 1, 4.0, 4.0), ob("2", 1, 4.0, 4.0), ob("3", 1, 5.6, 4.0, s=0.1)])
        assert len(mostradas) == 1, (k, mostradas)
    assert "3" in pessoa(r, 1).canais_agora


def test_caixa_a_mais_de_uma_camera_colada_em_alguem_demora_a_aparecer():
    """A câmera que já vê a pessoa dá uma segunda caixa a 1,4 m: só aparece se continuar sendo vista
    (`CONFIRMA_PERTO`), não no segundo quadro."""
    r = rt.Rastreio()
    r.passo(0.0, [ob("1", 1, 4.0, 4.0), ob("2", 1, 4.0, 4.0)])
    for k in range(1, rt.CONFIRMA_PERTO):
        mostradas = r.passo(k * 0.5, [ob("1", 1, 4.0, 4.0), ob("2", 1, 4.0, 4.0), ob("1", 2, 5.4, 4.0)])
        assert len(mostradas) == 1, (k, mostradas)


def test_duas_pessoas_juntas_por_um_segundo_vistas_por_cameras_diferentes_viram_uma():
    """A câmera 2 começa longe (3 m: é outra pessoa) e vem chegando até ficar a 45 cm da que a câmera 1 vê, parada ali
    — cada câmera vendo só "a sua": depois de 1 s juntas, eram uma (fica o número mais antigo)."""
    r = rt.Rastreio()
    for t in (0.0, 0.5):
        r.passo(t, [ob("1", 1, 2.0, 2.0)])
    caminho_da_2 = [5.0, 5.0, 4.2, 3.4, 2.8, 2.5, 2.45, 2.45, 2.45, 2.45, 2.45]
    vistas_duas = False
    for k, x in enumerate(caminho_da_2):
        mostradas = r.passo(1.0 + k * 0.5, [ob("1", 1, 2.0, 2.0), ob("2", 1, x, 2.0)])
        vistas_duas = vistas_duas or len(mostradas) == 2
    assert vistas_duas, "pré-condição: houve duas"
    assert len(mostradas) == 1 and mostradas[0][0] == 1, mostradas


def test_sem_ser_vista_ela_nao_sai_andando_pela_planta():
    """Andando a 1,6 m/s e coberta: a velocidade cai pela metade a cada quadro sem ser vista."""
    r = rt.Rastreio()
    for k in range(4):
        r.passo(k * 0.5, [ob("1", 1, 1.0 + 0.8 * k, 2.0), ob("2", 1, 1.0 + 0.8 * k, 2.0)])
    r.passo(2.0, [])
    (_, x, _, *_), = r.passo(2.5, [])
    assert x - 3.4 <= 1.25, f"andou {x - 3.4:.2f} m sem ser vista"


def test_o_desvio_nao_aprende_com_gente_perto():
    """Duas pessoas a 1 m: a vista de uma câmera pode ser de qualquer uma — não ensina o desvio."""
    r = rt.Rastreio()
    for k in range(20):
        r.passo(k * 0.5, [ob("1", 1, 2.0, 2.0), ob("2", 1, 2.3, 2.0), ob("1", 2, 2.0, 3.0), ob("2", 2, 2.3, 3.0)])
    assert r.desvios.geral == {}
