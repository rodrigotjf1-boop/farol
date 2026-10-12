"""O borrão de rosto apaga o rosto — ou não se pode chamá-lo de borrão.

Em 06/10/2026 duas imagens saíram de uma loja com o nome "-borrado" e com
os rostos reconhecíveis. O detector tinha achado o rosto e a função tinha
devolvido `borrou=True`: o que ela aplicava era um desfoque de 8% do lado
do rosto — um sigma de ~2 px num rosto de 150 px.

Não havia nenhum teste do borrão: todos os outros passam
`borrar_rosto=False` "porque o dublê não tem rosto". Este arquivo põe um
rosto no dublê.

A medida usada aqui é a que interessa: **depois do borrão, não sobra borda
nenhuma dentro do rosto** — ele vira uma cor só. Traço de olho, boca e nariz
são bordas; se não sobra borda, não sobra traço.

Por que uma cor e não um mosaico está medido em `pipeline/recorte.py`.
"""

from __future__ import annotations

import base64
import dataclasses
from datetime import datetime

import cv2
import numpy as np
import pytest

from farol_agent import imagens
from farol_agent.fila import Fila
from farol_agent.modelos import EventoGatilho, Frame
from farol_agent.motor import MotorDeRegras
from farol_agent.pipeline import recorte
from farol_agent.preview import capturar
from testes.conftest import BASE, FonteSintetica

# Onde o dublê "acha" o rosto, em fração do quadro que recebe.
ROSTO = (0.40, 0.30, 0.20, 0.30)


class DetectorFixo:
    """Faz o papel do YuNet: acha sempre os mesmos rostos, na mesma fração."""

    def __init__(self, rostos=(ROSTO,)):
        self.rostos = rostos
        self.w = self.h = 0

    def setInputSize(self, tamanho):  # noqa: N802 — é o nome que o OpenCV usa
        self.w, self.h = tamanho

    def detect(self, img):
        if not self.rostos:
            return 0, None
        linhas = [
            [fx * self.w, fy * self.h, fw * self.w, fh * self.h] + [0.0] * 10 + [0.9]
            for fx, fy, fw, fh in self.rostos
        ]
        return 1, np.array(linhas, dtype=np.float32)


@pytest.fixture
def com_rosto(monkeypatch):
    monkeypatch.setattr(recorte, "_obter_detector", lambda: DetectorFixo())


def _quadro(largura=640, altura=480, semente=7) -> Frame:
    """Xadrez aleatório de blocos de 8 px: borda forte em toda parte."""
    rng = np.random.default_rng(semente)
    blocos = rng.integers(0, 2, (altura // 8 + 1, largura // 8 + 1), dtype=np.uint8) * 255
    img = np.kron(blocos, np.ones((8, 8), dtype=np.uint8))[:altura, :largura]
    return Frame(imagem=np.dstack([img, img, img]), ts=datetime.now(), ponto_id="p")


def _caixa(largura, altura, fracao=ROSTO, folga=0):
    fx, fy, fw, fh = fracao
    return (
        int(fx * largura) + folga,
        int(fy * altura) + folga,
        int((fx + fw) * largura) - folga,
        int((fy + fh) * altura) - folga,
    )


def _borda_mais_forte(img, caixa) -> int:
    """A maior diferença entre dois pixels vizinhos dentro da caixa."""
    x1, y1, x2, y2 = caixa
    r = img[y1:y2, x1:x2].astype(np.int16)
    return int(max(np.abs(np.diff(r, axis=0)).max(), np.abs(np.diff(r, axis=1)).max()))


# ───────────────────────── o borrão em si ─────────────────────────


def test_dentro_do_rosto_nao_sobra_borda(com_rosto):
    f = _quadro()
    caixa = _caixa(f.largura, f.altura)
    assert _borda_mais_forte(f.imagem, caixa) == 255, "o dublê precisa ter detalhe"

    depois, borrou = recorte.borrar_rostos(f)

    assert borrou is True
    assert _borda_mais_forte(depois.imagem, caixa) == 0


def test_o_desfoque_ANTIGO_nao_passaria_nesta_medida():
    """Guarda a razão do teste acima: 8% do lado deixava a borda quase inteira."""
    f = _quadro()
    x1, y1, x2, y2 = caixa = _caixa(f.largura, f.altura)
    k = max(3, int(min(x2 - x1, y2 - y1) * 0.08) | 1)

    antigo = f.imagem.copy()
    antigo[y1:y2, x1:x2] = cv2.GaussianBlur(antigo[y1:y2, x1:x2], (k, k), 0)

    assert _borda_mais_forte(antigo, _caixa(f.largura, f.altura, folga=k)) > 40


def test_a_margem_cobre_alem_da_caixa_do_detector(com_rosto):
    # A caixa do detector vai da testa ao queixo, justa. Orelha e contorno
    # ficam de fora dela — e também identificam.
    f = _quadro()
    x1, y1, x2, y2 = _caixa(f.largura, f.altura)

    depois, _ = recorte.borrar_rostos(f)

    faixa = (x1 - 20, y1 - 20, x1, y2 + 20)   # à esquerda do rosto
    assert _borda_mais_forte(depois.imagem, faixa) == 0


def test_fora_do_rosto_a_imagem_fica_intacta(com_rosto):
    # O juiz precisa do resto da cena. Apagar a mais é trocar um defeito
    # por outro.
    f = _quadro()
    x1, y1, x2, y2 = _caixa(f.largura, f.altura)
    mx, my = int((x2 - x1) * 0.25) + 2, int((y2 - y1) * 0.25) + 2

    depois, _ = recorte.borrar_rostos(f)

    fora = np.ones(f.imagem.shape[:2], dtype=bool)
    fora[y1 - my : y2 + my, x1 - mx : x2 + mx] = False
    assert np.array_equal(depois.imagem[fora], f.imagem[fora])


def test_o_quadro_original_nao_e_alterado(com_rosto):
    f = _quadro()
    antes = f.imagem.copy()

    recorte.borrar_rostos(f)

    assert np.array_equal(f.imagem, antes)


def test_rosto_na_beira_do_quadro_tambem_e_apagado(monkeypatch):
    monkeypatch.setattr(
        recorte, "_obter_detector", lambda: DetectorFixo(rostos=((0.90, 0.0, 0.20, 0.25),))
    )
    f = _quadro()

    depois, borrou = recorte.borrar_rostos(f)

    assert borrou is True
    assert _borda_mais_forte(depois.imagem, (f.largura - 50, 0, f.largura, 100)) == 0


def test_todos_os_rostos_do_quadro_sao_apagados(monkeypatch):
    outro = (0.05, 0.55, 0.15, 0.25)
    monkeypatch.setattr(recorte, "_obter_detector", lambda: DetectorFixo(rostos=(ROSTO, outro)))
    f = _quadro()

    depois, _ = recorte.borrar_rostos(f)

    assert _borda_mais_forte(depois.imagem, _caixa(f.largura, f.altura)) == 0
    assert _borda_mais_forte(depois.imagem, _caixa(f.largura, f.altura, outro)) == 0


# ───────────────── o que `borrou` quer dizer, e o que não ─────────────────


def test_sem_rosto_achado_devolve_False_e_o_mesmo_quadro(monkeypatch):
    monkeypatch.setattr(recorte, "_obter_detector", lambda: DetectorFixo(rostos=()))
    f = _quadro()

    depois, borrou = recorte.borrar_rostos(f)

    assert borrou is False
    assert depois is f


def test_sem_detector_devolve_False_e_nao_levanta(monkeypatch):
    monkeypatch.setattr(recorte, "_obter_detector", lambda: None)
    f = _quadro()

    depois, borrou = recorte.borrar_rostos(f)

    assert borrou is False
    assert depois is f


def test_caixa_fora_do_quadro_nao_conta_como_borrado(monkeypatch):
    # Dizer "borrei" sem ter apagado nada é a mentira que este arquivo
    # existe para impedir.
    monkeypatch.setattr(
        recorte, "_obter_detector", lambda: DetectorFixo(rostos=((2.0, 2.0, 0.1, 0.1),))
    )
    f = _quadro()

    depois, borrou = recorte.borrar_rostos(f)

    assert borrou is False
    assert np.array_equal(depois.imagem, f.imagem)


def test_o_detector_de_rosto_viaja_no_pacote(monkeypatch):
    """Sem detector o borrão fica desligado e o pipeline segue — de propósito.

    Então "há detector nesta instalação" tem que ser conferido em algum
    lugar, e é aqui: o modelo vai dentro do pacote, e o OpenCV instalado
    precisa conseguir carregá-lo.
    """
    monkeypatch.setattr(recorte, "_detector", None)

    assert recorte._obter_detector() is not None
    assert recorte._caixas_de_rosto(_quadro().imagem) is not None


# ─────────── o modelo abre de qualquer pasta, com acento ou sem (ERR-111) ───────────
# O PC de loja costuma ter acento no caminho (`C:\Users\João`), e o leitor de
# modelo do OpenCV não abre arquivo em caminho assim. O borrão desligava calado:
# um aviso no registro, e a imagem seguia com o rosto.


def _modelo_de_fabrica():
    return next(
        p / recorte._MODELO_YUNET
        for p in recorte._pastas_de_modelo()
        if (p / recorte._MODELO_YUNET).is_file()
    )


def test_o_detector_de_rosto_abre_de_pasta_com_acento(monkeypatch, tmp_path):
    import shutil

    pasta = tmp_path / "configuração da loja" / "modelos"
    pasta.mkdir(parents=True)
    shutil.copyfile(_modelo_de_fabrica(), pasta / recorte._MODELO_YUNET)

    # Só a pasta com acento: é dela que o modelo tem de abrir.
    monkeypatch.setattr(recorte, "_pastas_de_modelo", lambda: [pasta])
    monkeypatch.setattr(recorte, "_detector", None)

    detector = recorte._obter_detector()

    assert detector is not None, "com acento no caminho o borrão de rosto ficava desligado"
    assert hasattr(detector, "setInputSize"), "tem de ser o detector do modelo, e não um substituto"
    assert recorte._caixas_de_rosto(_quadro().imagem) is not None


def _arquivo_de_mentira(tmp_path):
    arquivo = tmp_path / "modelos" / recorte._MODELO_YUNET
    arquivo.parent.mkdir()
    arquivo.write_bytes(b"\x08\x01os-bytes-do-modelo")
    return arquivo


def test_o_modelo_de_rosto_e_entregue_ao_opencv_pelos_bytes(monkeypatch, tmp_path):
    # Vale em qualquer sistema: quem lê o arquivo é o Python, e o OpenCV só
    # recebe os bytes — do caminho ele não fica sabendo.
    arquivo = _arquivo_de_mentira(tmp_path)
    chamadas = []

    class Fabrica:
        @staticmethod
        def create(*args):
            chamadas.append(args)
            return "aberto-pelos-bytes"

    monkeypatch.setattr(cv2, "FaceDetectorYN", Fabrica, raising=False)
    monkeypatch.setattr(
        cv2, "FaceDetectorYN_create", lambda *a: pytest.fail("abriu pelo caminho"), raising=False
    )

    assert recorte._abrir_yunet(arquivo) == "aberto-pelos-bytes"

    ((formato, modelo, configuracao, entrada, *limiares),) = chamadas
    assert formato == "onnx"
    assert modelo.dtype == np.uint8 and modelo.tobytes() == b"\x08\x01os-bytes-do-modelo"
    assert configuracao.dtype == np.uint8 and configuracao.size == 0
    assert tuple(entrada) == (320, 320)
    assert limiares == [0.6, 0.3, 5000]


@pytest.mark.parametrize(
    "falha",
    [cv2.error("não sei abrir pelos bytes"), TypeError("assinatura de antes"), None],
    ids=["o-opencv-recusa-os-bytes", "a-assinatura-e-a-antiga", "nao-ha-como-abrir-pelos-bytes"],
)
def test_o_opencv_que_so_abre_pelo_caminho_continua_atendido(monkeypatch, tmp_path, falha):
    arquivo = _arquivo_de_mentira(tmp_path)
    pelo_caminho = []

    class Fabrica:
        @staticmethod
        def create(*args):
            raise falha

    if falha is None:
        monkeypatch.delattr(cv2, "FaceDetectorYN", raising=False)
    else:
        monkeypatch.setattr(cv2, "FaceDetectorYN", Fabrica, raising=False)
    monkeypatch.setattr(
        cv2, "FaceDetectorYN_create", lambda *a: pelo_caminho.append(a) or "aberto-pelo-caminho", raising=False
    )

    assert recorte._abrir_yunet(arquivo) == "aberto-pelo-caminho"
    assert pelo_caminho == [(str(arquivo), "", (320, 320), 0.6, 0.3, 5000)]


def test_o_arquivo_que_sumiu_nao_derruba_quem_procura_o_detector(monkeypatch, tmp_path):
    # O arquivo some entre o "existe?" e a leitura: vale a regra de sempre —
    # o OpenCV diz que não abriu, e quem procura segue para a pasta seguinte.
    sumiu = tmp_path / "modelos" / recorte._MODELO_YUNET

    class Fabrica:
        @staticmethod
        def create(*args):
            pytest.fail("não há bytes para entregar")

    def pelo_caminho(*a):
        raise cv2.error("arquivo não encontrado")

    monkeypatch.setattr(cv2, "FaceDetectorYN", Fabrica, raising=False)
    monkeypatch.setattr(cv2, "FaceDetectorYN_create", pelo_caminho, raising=False)

    with pytest.raises(cv2.error):
        recorte._abrir_yunet(sumiu)


# ─────────────── os dois caminhos por onde a imagem sai da loja ───────────────


class FonteDeXadrez:
    ponto_id = "ponto-teste"

    def rajada(self, ts, quantidade=4, stream="main"):
        return [
            Frame(imagem=_quadro(semente=i).imagem, ts=ts, ponto_id=self.ponto_id)
            for i in range(quantidade)
        ]


def test_o_PREVIEW_sobe_com_o_rosto_apagado(com_rosto):
    """O preview é a única imagem que sai da loja sem recorte."""
    q = capturar(FonteDeXadrez(), lado_maior=640, jpeg=90)

    img = cv2.imdecode(np.frombuffer(base64.b64decode(q.imagem_base64), np.uint8), cv2.IMREAD_COLOR)

    assert q.rosto_borrado is True
    # Folga de 8 px: o JPEG mistura o que está na borda do bloco.
    assert _borda_mais_forte(img, _caixa(640, 480, folga=8)) <= 16
    assert _borda_mais_forte(img, (0, 0, 100, 100)) > 100, "o resto da cena continua lá"


def test_a_imagem_que_o_MOTOR_guarda_para_o_juiz_tem_o_rosto_apagado(
    com_rosto, regra, tmp_path
):
    fila = Fila(tmp_path / "fila.db")
    try:
        com_borrao = dataclasses.replace(regra, borrar_rosto=True)
        motor = MotorDeRegras(fila, [com_borrao])
        fonte = FonteSintetica()

        p = motor.preparar(EventoGatilho(ponto_id=fonte.ponto_id, ts=BASE), fonte)

        assert p.enfileirados, "a análise tem que ter sido enfileirada"
        (arquivo,) = list(fila.spool.glob("*.jpg"))
        img = imagens.ler(arquivo)
        h, w = img.shape[:2]
        assert _borda_mais_forte(img, _caixa(w, h, folga=8)) <= 16
        assert _borda_mais_forte(img, (0, 0, 60, 60)) > 100, "o resto da cena continua lá"
    finally:
        fila.fechar()
