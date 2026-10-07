"""Um canal, mais de uma área: cada área é julgada no SEU recorte.

Na loja, em 07/10/2026, a mesma câmera do caixa precisava de duas perguntas
que não cabem no mesmo quadro: "tem atendente?" vale DENTRO do balcão e
"quantos na fila?" vale do lado do cliente. Com o quadro inteiro, o cliente
na fila respondia "tem atendente" e o atendente entrava na conta da fila.

A partir da migration 019 o console deixa marcar várias áreas no canal e
pôr o critério na área. O que este arquivo guarda é o lado do agente: o
que o juiz recebe é o recorte daquela área, a medida fica separada por
área, e o aviso de uma não cala a outra.

Dois defeitos só apareciam aqui, com o MESMO critério em duas áreas — coisa
que não existia enquanto cada canal tinha uma área só:

- a imagem era gravada como `hora_canal_critério.jpg`: as duas áreas saem
  da mesma olhada, no mesmo segundo, e a segunda cobria a primeira antes de
  ela ser julgada;
- a chave da fila não levava a área: dois recortes iguais (piso vazio dos
  dois lados) viravam "repetido", e a segunda área ficava sem medida.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import timedelta
from hashlib import sha256
from pathlib import Path

import cv2
import numpy as np
import pytest

from farol_agent.fila import Fila
from farol_agent.modelos import EventoGatilho, Frame, Resultado, TipoRegra, Veredito, Via, Zona
from farol_agent.motor import MotorDeRegras
from testes.conftest import BASE

PONTO = "ponto-caixa"

# Do mesmo tamanho e à mesma distância do começo de cada metade do quadro:
# com as duas metades iguais, os dois recortes saem IDÊNTICOS. Longe do meio
# de propósito — o recorte leva 5% de margem, que não pode atravessar a
# divisa entre uma metade e a outra.
BALCAO = Zona(id="z-balcao", nome="dentro do balcão", poligono=[(0.1, 0.0), (0.4, 0.0), (0.4, 1.0), (0.1, 1.0)], ponto_id=PONTO)
CLIENTE = Zona(id="z-cliente", nome="lado do cliente", poligono=[(0.6, 0.0), (0.9, 0.0), (0.9, 1.0), (0.6, 1.0)], ponto_id=PONTO)


class FonteDoCaixa:
    """A câmera do caixa, com cada metade do quadro clara ou escura.

    A textura é a MESMA nas duas metades e muda a cada instante, como numa
    câmera de verdade; o que distingue uma metade da outra é só o brilho —
    é ele que diz, no juiz, que recorte chegou. A rajada inteira cai no
    mesmo segundo, como na loja: as áreas do canal saem da mesma olhada.
    """

    ponto_id = PONTO

    def __init__(self, esquerda_clara: bool = False, direita_clara: bool = True):
        self.esquerda_clara = esquerda_clara
        self.direita_clara = direita_clara

    def _imagem(self, ts) -> np.ndarray:
        rng = np.random.default_rng(int(ts.timestamp() * 1000) % (2**31))
        textura = rng.integers(0, 40, (480, 320, 3), dtype=np.uint8)
        img = np.empty((480, 640, 3), dtype=np.uint8)
        img[:, :320] = textura + (200 if self.esquerda_clara else 10)
        img[:, 320:] = textura + (200 if self.direita_clara else 10)
        return img

    def rajada(self, ts, quantidade=6, stream="main"):
        return [
            Frame(imagem=self._imagem(ts + timedelta(milliseconds=10 * i)), ts=ts + timedelta(milliseconds=10 * i), ponto_id=PONTO)
            for i in range(quantidade)
        ]

    def fechar(self) -> None:
        pass


class JuizDoClaro:
    """Diz "conforme" se a imagem QUE RECEBEU é clara. Guarda o que viu."""

    nome = "do-claro"

    def __init__(self) -> None:
        self.vistas: list[tuple[int, int, float]] = []

    def julgar(self, imagem: Path, criterio, *, contexto=None, referencias=None) -> Veredito:
        # `imdecode` e não `imread`: o `imread` falha calado em caminho com
        # acento no Windows (ver `farol_agent/imagens.py`).
        img = cv2.imdecode(np.frombuffer(Path(imagem).read_bytes(), dtype=np.uint8), cv2.IMREAD_COLOR)
        assert img is not None, f"o juiz não conseguiu abrir {imagem}"
        media = float(img.mean())
        self.vistas.append((img.shape[1], img.shape[0], media))
        return Veredito(
            resultado=Resultado.CONFORME if media > 128 else Resultado.NAO_CONFORME,
            confianca=0.95,
            motivo="dublê",
            via=Via.LOCAL,
            modelo="do-claro",
            custo_centavos=0.0,
        )


@pytest.fixture
def fila(tmp_path):
    f = Fila(tmp_path / "fila.db")
    yield f
    f.fechar()


def _presenca(regra, zona: Zona, id: str = "r1"):
    return replace(regra, id=id, zona=zona, tipo=TipoRegra.PRESENCA, parametros={"objeto": "pessoa", "minimo": 1, "maximo": None})


def _olhada(motor, fonte, juiz, ts):
    motor.preparar(EventoGatilho(ponto_id=PONTO, ts=ts), fonte)
    return motor.processar(juiz, ts + timedelta(seconds=2), limite=50)


def _linhas(fila) -> dict[tuple[str, str], dict]:
    return {(l["regra_id"], l["zona_id"]): dict(l) for l in fila._con.execute("select * from resumo_hora").fetchall()}


def test_cada_area_recebe_o_seu_recorte_e_tem_o_seu_veredito(fila, regra):
    """Critérios diferentes em áreas diferentes do MESMO canal."""
    motor = MotorDeRegras(fila, [_presenca(regra, BALCAO, "r-atendente"), _presenca(regra, CLIENTE, "r-fila")])
    juiz = JuizDoClaro()

    alertas = _olhada(motor, FonteDoCaixa(), juiz, BASE)

    assert len(juiz.vistas) == 2, "uma olhada no canal = um julgamento POR ÁREA"
    # Nenhum dos dois recebeu o quadro inteiro (640 de largura): cada um viu
    # a sua metade, com a margem. E uma era escura, a outra clara.
    assert all(largura < 320 for largura, _, _ in juiz.vistas), juiz.vistas
    assert sorted(media > 128 for _, _, media in juiz.vistas) == [False, True]

    linhas = _linhas(fila)
    assert set(linhas) == {("r-atendente", "z-balcao"), ("r-fila", "z-cliente")}
    assert (linhas[("r-atendente", "z-balcao")]["nao_conformes"], linhas[("r-atendente", "z-balcao")]["conformes"]) == (1, 0)
    assert (linhas[("r-fila", "z-cliente")]["nao_conformes"], linhas[("r-fila", "z-cliente")]["conformes"]) == (0, 1)
    # Só o balcão (escuro = "ninguém") avisa.
    assert [(a.regra_id, a.zona_id) for a in alertas] == [("r-atendente", "z-balcao")]


def test_o_mesmo_criterio_em_duas_areas_julga_cada_uma_com_a_SUA_imagem(fila, regra):
    """As duas áreas saem da mesma olhada, no mesmo segundo.

    Com o nome do arquivo sem a área, o recorte do lado do cliente (claro)
    cobria o do balcão (escuro) antes do julgamento: o balcão vazio era
    julgado com a imagem do outro lado e saía "conforme".
    """
    motor = MotorDeRegras(fila, [_presenca(regra, BALCAO), _presenca(regra, CLIENTE)])
    juiz = JuizDoClaro()

    alertas = _olhada(motor, FonteDoCaixa(esquerda_clara=False, direita_clara=True), juiz, BASE)

    assert sorted(media > 128 for _, _, media in juiz.vistas) == [False, True], "as duas áreas foram julgadas com a mesma imagem"
    assert [(a.regra_id, a.zona_id) for a in alertas] == [("r1", "z-balcao")]
    assert len(list(fila.spool.glob("*.jpg"))) == 2, "uma imagem guardada por área"


def test_o_silencio_do_aviso_e_por_area(fila, regra):
    """O balcão avisa às 16h00. Um minuto depois o lado do cliente passa a
    estar fora do critério: é OUTRO lugar, e o aviso dele não pode ficar
    preso nos quinze minutos de silêncio do balcão."""
    motor = MotorDeRegras(fila, [_presenca(regra, BALCAO), _presenca(regra, CLIENTE)])
    juiz = JuizDoClaro()

    primeiros = _olhada(motor, FonteDoCaixa(esquerda_clara=False, direita_clara=True), juiz, BASE)
    depois = _olhada(motor, FonteDoCaixa(esquerda_clara=False, direita_clara=False), juiz, BASE + timedelta(minutes=1))

    assert [(a.regra_id, a.zona_id) for a in primeiros] == [("r1", "z-balcao")]
    assert [(a.regra_id, a.zona_id) for a in depois] == [("r1", "z-cliente")], "o silêncio do balcão calou o lado do cliente"

    linhas = _linhas(fila)
    assert set(linhas) == {("r1", "z-balcao"), ("r1", "z-cliente")}
    assert (linhas[("r1", "z-balcao")]["nao_conformes"], linhas[("r1", "z-balcao")]["alertas"]) == (2, 1)
    assert (linhas[("r1", "z-cliente")]["nao_conformes"], linhas[("r1", "z-cliente")]["alertas"]) == (1, 1)


def test_duas_areas_com_a_mesma_cena_sao_duas_medidas(fila, regra):
    """Piso vazio dos dois lados: os dois recortes são IGUAIS, ponto a ponto.

    A chave da fila sem a área tratava o segundo como repetido do primeiro —
    e a segunda área ficava sem medida justamente quando estava vazia.
    """
    motor = MotorDeRegras(fila, [_presenca(regra, BALCAO), _presenca(regra, CLIENTE)])
    juiz = JuizDoClaro()

    _olhada(motor, FonteDoCaixa(esquerda_clara=False, direita_clara=False), juiz, BASE)

    assert len(juiz.vistas) == 2, "a segunda área sumiu como repetida da primeira"
    # A premissa do teste: os dois recortes eram mesmo a mesma imagem.
    assert juiz.vistas[0] == juiz.vistas[1], juiz.vistas
    linhas = _linhas(fila)
    for lugar in (("r1", "z-balcao"), ("r1", "z-cliente")):
        l = linhas[lugar]
        assert (l["capturas"], l["enfileiradas"], l["repetidas"], l["nao_conformes"]) == (1, 1, 0, 1), (lugar, l)


def test_a_area_entra_na_chave_e_sem_area_a_chave_e_a_de_sempre():
    args = ("r1", 1, "p1", 0xABCDEF, BASE)

    assert Fila.chave_idempotente(*args, zona_id="z1") == Fila.chave_idempotente(*args, zona_id="z1")
    assert Fila.chave_idempotente(*args, zona_id="z1") != Fila.chave_idempotente(*args, zona_id="z2")
    assert Fila.chave_idempotente(*args, zona_id="z1") != Fila.chave_idempotente(*args)
    # Sem área (bancada, um corte só) nada mudou: a chave gravada antes
    # desta versão continua sendo reconhecida. A conta está escrita aqui
    # por extenso para o formato antigo não mudar sem ninguém perceber.
    de_sempre = sha256(f"r1:1:p1:{0xABCDEF:016x}:{BASE:%Y%m%d%H%M}".encode("utf-8")).hexdigest()[:32]
    assert Fila.chave_idempotente(*args) == de_sempre
