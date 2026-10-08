"""A área é o DESENHO de quem configurou a loja.

Pedido do dono (08/10/2026): "a criação das áreas marcadas teria que ser mais
flexível, para uma área não invadir outra". Até aqui a área era um retângulo
e o agente ainda recortava com 5% de folga para cada lado: numa imagem torta
(olho de peixe), o recorte de uma área levava um pedaço da vizinha.

O que se protege aqui:

- o recorte é EXATO — o retângulo que envolve o desenho, sem folga;
- o que fica fora do polígono é apagado (cinza liso) antes de qualquer coisa:
  o porteiro, a memória de cena repetida, o juiz e o disco não veem;
- "tem cena?" é medido só no que é da área;
- o juiz da nuvem é avisado de que o cinza foi posto de propósito;
- área retangular (todas as de hoje) segue sem máscara.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import timedelta

import cv2
import numpy as np
import pytest

from farol_agent import imagens
from farol_agent.fila import Fila
from farol_agent.juizes.nuvem import AVISO_DA_AREA, INSTRUCOES, _montar_pedido
from farol_agent.modelos import EventoGatilho, Frame, Zona
from farol_agent.motor import MotorDeRegras
from farol_agent.pipeline import qualidade, recorte
from farol_agent.pipeline.recorte import COR_DE_FORA
from farol_agent.porteiro import Porteiro
from testes.conftest import BASE

CINZA = np.array(COR_DE_FORA)


def zona(*pontos, id="z1") -> Zona:
    return Zona(id=id, nome="área de teste", poligono=list(pontos))


RETANGULO = zona((0.25, 0.25), (0.75, 0.25), (0.75, 0.75), (0.25, 0.75))
# Um triângulo com o canto reto em cima, à esquerda: o canto de baixo, à
# direita, do retângulo que o envolve fica FORA dele.
TRIANGULO = zona((0.25, 0.25), (0.75, 0.25), (0.25, 0.75))
# Um "L": o quadrante de cima, à direita, é de fora.
EM_L = zona((0.2, 0.2), (0.5, 0.2), (0.5, 0.5), (0.8, 0.5), (0.8, 0.8), (0.2, 0.8))
QUADRO_INTEIRO = zona((0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0))


def ruido(largura=1000, altura=1000, semente=1) -> np.ndarray:
    return np.random.default_rng(semente).integers(20, 235, (altura, largura, 3), dtype=np.uint8)


def quadro(imagem: np.ndarray) -> Frame:
    return Frame(imagem=imagem, ts=BASE, ponto_id="ponto-teste")


# ───────────────────────────── o recorte ─────────────────────────────


def test_o_recorte_e_exato_sem_folga():
    # 50% de 1000 px são 500 px. Com os 5% de folga de antes eram 550, e a
    # borda da área ao lado vinha junto.
    f, dentro = recorte.recortar_area(quadro(ruido()), RETANGULO)
    assert (f.largura, f.altura) == (500, 500)
    assert dentro is None, "área retangular não tem o que apagar"


def test_o_quadro_inteiro_segue_inteiro_e_sem_mascara():
    # Toda loja nasce com esta área em cada canal.
    original = ruido(640, 480)
    f, dentro = recorte.recortar_area(quadro(original), QUADRO_INTEIRO)
    assert f.imagem.shape == original.shape and dentro is None
    assert np.array_equal(f.imagem, original)


def test_o_poligono_diz_o_que_e_da_area():
    f, dentro = recorte.recortar_area(quadro(ruido()), TRIANGULO)
    assert (f.largura, f.altura) == (500, 500), "o recorte é o retângulo que envolve o desenho"
    assert dentro is not None and dentro.shape == (500, 500)
    assert dentro[50, 50] == 255, "perto do canto reto: dentro"
    assert dentro[450, 450] == 0, "o canto oposto: fora"
    # Um triângulo retângulo ocupa metade do retângulo que o envolve.
    assert 0.49 < cv2.countNonZero(dentro) / dentro.size < 0.52


def test_area_em_L_deixa_o_recorte_do_canto_de_fora():
    f, dentro = recorte.recortar_area(quadro(ruido()), EM_L)
    assert (f.largura, f.altura) == (600, 600)
    assert dentro[100, 100] == 255 and dentro[500, 500] == 255 and dentro[500, 100] == 255
    assert dentro[100, 500] == 0, "o quadrante de cima, à direita, não é da área"


def test_apagar_troca_por_cinza_so_o_que_e_de_fora():
    original = ruido()
    q = quadro(original.copy())
    f, dentro = recorte.recortar_area(q, TRIANGULO)
    limpo = recorte.apagar_fora(f, dentro)

    assert np.array_equal(limpo.imagem[dentro == 0], np.tile(CINZA, (int((dentro == 0).sum()), 1)))
    assert np.array_equal(limpo.imagem[dentro > 0], f.imagem[dentro > 0]), "o que é da área não muda"
    assert np.array_equal(q.imagem, original), "o quadro de origem fica como veio"
    assert not np.array_equal(f.imagem, limpo.imagem), "e o recorte cru também não é mexido"


def test_o_recorte_nao_e_um_pedaco_vivo_do_quadro():
    # O mesmo quadro é recortado por todas as áreas do canal, uma depois da
    # outra. Se o recorte fosse uma janela para dentro dele, borrar um rosto
    # numa área borraria o quadro que a próxima ainda vai recortar.
    q = quadro(ruido())
    for z in (RETANGULO, TRIANGULO):
        f, _ = recorte.recortar_area(q, z)
        assert not np.shares_memory(f.imagem, q.imagem)


def test_sem_mascara_apagar_devolve_o_mesmo_quadro():
    f, dentro = recorte.recortar_area(quadro(ruido()), RETANGULO)
    assert recorte.apagar_fora(f, dentro) is f


def test_o_miolo_e_so_o_que_e_da_area():
    f, dentro = recorte.recortar_area(quadro(ruido()), TRIANGULO)
    m = recorte.miolo(f, dentro)
    assert m.shape == (cv2.countNonZero(dentro), 1, 3)
    assert recorte.miolo(f, None) is f.imagem


def test_imagem_em_tons_de_cinza_tambem_e_recortada_e_apagada():
    cinza = np.random.default_rng(3).integers(20, 235, (400, 400), dtype=np.uint8)
    f, dentro = recorte.recortar_area(quadro(cinza), TRIANGULO)
    limpo = recorte.apagar_fora(f, dentro)
    assert limpo.imagem.ndim == 2 and limpo.imagem[190, 190] == COR_DE_FORA[0]
    assert recorte.miolo(f, dentro).shape == (cv2.countNonZero(dentro), 1)


def test_poligono_sem_area_nao_apaga_a_imagem_inteira():
    # A API não deixa gravar; se descer assim, o pior desfecho seria julgar
    # um retângulo todo cinza.
    f, dentro = recorte.recortar_area(quadro(ruido()), zona((0.2, 0.2), (0.2, 0.2), (0.2, 0.2)))
    assert dentro is None


def test_o_que_e_apagado_nao_fica_com_cara_de_camera_sem_sinal():
    # Uma faixa fina atravessando o quadro: 9 em cada 10 pontos do recorte
    # são de fora. Apagados em PRETO, o recorte seria a tela de "sem sinal"
    # do gravador (mais de 90% em preto absoluto) para quem o medisse
    # depois. O cinza liso não se confunde com defeito nenhum.
    faixa = zona((0.1, 0.1), (0.2, 0.1), (0.9, 0.8), (0.9, 0.9), (0.8, 0.9), (0.1, 0.2))
    f, dentro = recorte.recortar_area(quadro(ruido()), faixa)
    assert cv2.countNonZero(dentro) / dentro.size < 0.25

    limpo = recorte.apagar_fora(f, dentro)

    assert qualidade.cena_utilizavel(limpo.imagem) == (True, "")
    estourado, cortado = qualidade.faixa_dinamica(limpo.imagem)
    assert estourado < 0.05 and cortado < 0.05


# ───────────────────────────── o motor ─────────────────────────────


class FonteDeQuadros:
    """Entrega as imagens dadas, uma por olhada (a última se repete)."""

    ponto_id = "ponto-teste"

    def __init__(self, *imagens_):
        self.imagens = list(imagens_)
        self.olhada = 0

    def rajada(self, ts, quantidade=6, stream="main"):
        img = self.imagens[min(self.olhada, len(self.imagens) - 1)]
        self.olhada += 1
        return [Frame(img.copy(), ts + timedelta(milliseconds=100 * i), self.ponto_id) for i in range(quantidade)]


@pytest.fixture
def fila(tmp_path):
    f = Fila(tmp_path / "fila.db")
    yield f
    f.fechar()


def olhar(motor, fonte, ts=BASE):
    return motor.preparar(EventoGatilho(ponto_id=fonte.ponto_id, ts=ts), fonte)


def item(fila):
    (i,) = fila.proximos(BASE + timedelta(hours=1), limite=10)
    return i


def test_o_que_vai_para_o_juiz_e_o_recorte_exato(fila, regra):
    regra = replace(regra, zona=RETANGULO)
    motor = MotorDeRegras(fila, [regra])

    assert olhar(motor, FonteDeQuadros(ruido(640, 480))).enfileirados == ["r1"]

    na_fila = item(fila)       # a fila entrega cada item uma vez
    salvo = imagens.ler(na_fila.imagem_caminho)
    assert salvo.shape[:2] == (240, 320), "metade de 640 × 480, sem os 5% de folga"
    assert "fora_da_area" not in na_fila.contexto, "área retangular: nada foi apagado"


def test_o_que_vai_para_o_juiz_nao_tem_o_que_ficou_fora_do_desenho(fila, regra):
    regra = replace(regra, zona=TRIANGULO)
    motor = MotorDeRegras(fila, [regra])

    assert olhar(motor, FonteDeQuadros(ruido(640, 480))).enfileirados == ["r1"]

    na_fila = item(fila)
    salvo = imagens.ler(na_fila.imagem_caminho).astype(int)
    assert salvo.shape[:2] == (240, 320)
    # O canto de baixo, à direita, é de fora: cinza liso (o JPEG treme um pouco).
    canto = salvo[200:236, 270:316]
    assert np.abs(canto - CINZA).max() <= 6, "o que está fora do desenho foi para o disco"
    assert canto.std() < 3
    # ...e perto do canto reto continua a cena.
    assert salvo[4:60, 4:60].std() > 20
    assert na_fila.contexto.get("fora_da_area") == "apagado", "o juiz tem de saber que o cinza é de propósito"


def test_tem_cena_e_medido_so_dentro_da_area(fila, regra):
    # A cena existe em volta, mas DENTRO do desenho está tudo preto: a câmera
    # daquela área não mostra nada. Medindo o retângulo inteiro, o ruído de
    # fora faria parecer que há cena.
    img = ruido(640, 480)
    dentro = np.zeros((480, 640), dtype=np.uint8)
    cv2.fillPoly(dentro, [np.array([[160, 120], [480, 120], [160, 360]], dtype=np.int32)], 255)
    img[dentro > 0] = 0
    motor = MotorDeRegras(fila, [replace(regra, zona=TRIANGULO)])

    p = olhar(motor, FonteDeQuadros(img))

    assert (p.sem_cena, p.enfileirados) == (["r1"], [])


def test_o_que_esta_fora_estar_preto_nao_tira_a_cena_de_dentro(fila, regra):
    img = np.zeros((480, 640, 3), dtype=np.uint8)
    dentro = np.zeros((480, 640), dtype=np.uint8)
    cv2.fillPoly(dentro, [np.array([[160, 120], [480, 120], [160, 360]], dtype=np.int32)], 255)
    img[dentro > 0] = ruido(640, 480)[dentro > 0]
    motor = MotorDeRegras(fila, [replace(regra, zona=TRIANGULO)])

    assert olhar(motor, FonteDeQuadros(img)).enfileirados == ["r1"]


def test_movimento_fora_do_desenho_nao_e_cena_nova(fila, regra):
    # Duas olhadas: a segunda só muda FORA do triângulo (a área ao lado).
    a = ruido(640, 480, semente=1)
    b = a.copy()
    b[300:360, 400:480] = ruido(80, 60, semente=9)      # o canto de fora
    motor = MotorDeRegras(fila, [replace(regra, zona=TRIANGULO)])
    fonte = FonteDeQuadros(a, b)

    assert olhar(motor, fonte, BASE).enfileirados == ["r1"]
    assert olhar(motor, fonte, BASE + timedelta(seconds=10)).repetidos == ["r1"]


def test_movimento_dentro_do_desenho_continua_sendo_cena_nova(fila, regra):
    a = ruido(640, 480, semente=1)
    b = ruido(640, 480, semente=2)
    motor = MotorDeRegras(fila, [replace(regra, zona=TRIANGULO)])
    fonte = FonteDeQuadros(a, b)

    assert olhar(motor, fonte, BASE).enfileirados == ["r1"]
    assert olhar(motor, fonte, BASE + timedelta(seconds=10)).enfileirados == ["r1"]


def test_o_porteiro_nao_ve_quem_esta_na_area_ao_lado(fila, regra):
    vistas = []

    class Detector:
        def pontuar(self, imagem_bgr, classe):
            vistas.append(imagem_bgr.copy())
            return [0.9]

    regra = replace(regra, zona=TRIANGULO, porteiro="pessoa")
    motor = MotorDeRegras(fila, [regra], porteiro=Porteiro(Detector()))

    olhar(motor, FonteDeQuadros(ruido(640, 480)))

    (vista,) = vistas
    assert vista.shape[:2] == (240, 320)
    assert np.array_equal(vista[230, 310], CINZA), "o detector recebeu o que está fora do desenho"


# ───────────────────────────── o juiz da nuvem ─────────────────────────────


def test_o_juiz_e_avisado_de_que_o_cinza_foi_posto_de_proposito():
    contexto = {"regra_id": "r1", "fora_da_area": "apagado"}
    pedido = _montar_pedido("a bancada está limpa", contexto)

    assert AVISO_DA_AREA in pedido
    assert "não é defeito da imagem nem motivo para `nao_avaliavel`" in pedido
    assert "fora_da_area" not in pedido, "a marca é do agente; não vira linha de contexto"
    assert "- regra_id: r1" in pedido, "o resto do contexto segue indo"
    assert contexto == {"regra_id": "r1", "fora_da_area": "apagado"}, "o contexto de quem chamou não é mexido"


def test_sem_nada_apagado_o_pedido_e_o_de_sempre():
    assert _montar_pedido("a bancada está limpa", {"regra_id": "r1"}) == (
        "CRITÉRIO A AUDITAR:\na bancada está limpa\n\nCONTEXTO DA OPERAÇÃO:\n- regra_id: r1"
    )
    assert _montar_pedido("a bancada está limpa", None) == "CRITÉRIO A AUDITAR:\na bancada está limpa"


def test_o_aviso_da_area_nao_mexe_nas_instrucoes_que_ficam_em_cache():
    # Mudar as instruções invalida o cache de todas as lojas.
    assert "cinza" not in INSTRUCOES and "ÁREA DE ANÁLISE" not in INSTRUCOES
