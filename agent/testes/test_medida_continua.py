"""Presença e contagem medem TEMPO: toda olhada é julgada.

Na loja, em 07/10/2026, dois critérios pediam "quanto tempo o posto fica
vazio". O silêncio de quinze minutos pulava a olhada inteira depois de cada
aviso — 14 de 16 olhadas — e a cena parada (posto vazio é a mesma imagem
por meia hora) sumia como "repetida" ou "já julgada". Não se media nada.

Em presença e contagem quem julga é o detector, na loja: não há chamada a
economizar. Então a olhada entra sempre, e o silêncio passa a segurar só o
aviso. Em estado e ação nada muda — lá cada olhada custa.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import timedelta

import numpy as np
import pytest

from farol_agent.fila import Fila
from farol_agent.modelos import EventoGatilho, Frame, Resultado, TipoRegra, Zona
from farol_agent.motor import CONTINUOS, MotorDeRegras
from testes.conftest import BASE, JuizFixo


@pytest.fixture
def fila(tmp_path):
    f = Fila(tmp_path / "fila.db")
    yield f
    f.fechar()


class FonteParada:
    """O posto vazio: a MESMA imagem em toda olhada."""

    def __init__(self, ponto_id: str = "ponto-teste"):
        self.ponto_id = ponto_id
        self._imagem = np.random.default_rng(7).integers(0, 255, (480, 640, 3), dtype=np.uint8)

    def rajada(self, ts, quantidade=6, stream="main"):
        return [
            Frame(imagem=self._imagem.copy(), ts=ts + timedelta(milliseconds=200 * i), ponto_id=self.ponto_id)
            for i in range(quantidade)
        ]

    def fechar(self) -> None:
        pass


def _de_presenca(regra, tipo=TipoRegra.PRESENCA):
    return replace(regra, tipo=tipo, parametros={"objeto": "pessoa", "minimo": 1, "maximo": None})


def _olhar(motor, fonte, ts):
    return motor.preparar(EventoGatilho(ponto_id=fonte.ponto_id, ts=ts), fonte)


def _julgar(motor, juiz, ts):
    return motor.processar(juiz, ts + timedelta(seconds=2), limite=50)


def _linha(fila, regra="r1", zona="z1") -> dict:
    achadas = [
        dict(l) for l in fila._con.execute("select * from resumo_hora").fetchall()
        if l["regra_id"] == regra and l["zona_id"] == zona
    ]
    assert len(achadas) == 1, f"esperava uma linha para {regra}/{zona}, achei {len(achadas)}"
    return achadas[0]


def test_os_tipos_continuos_sao_presenca_e_contagem():
    # Comparação também é local, mas pode escalar para um modelo; estado e
    # ação vão para a nuvem. Se alguém acrescentar um tipo aqui, que seja
    # sabendo que ele passa a ser julgado a cada trinta segundos.
    assert set(CONTINUOS) == {TipoRegra.PRESENCA, TipoRegra.CONTAGEM}


@pytest.mark.parametrize("tipo", [TipoRegra.PRESENCA, TipoRegra.CONTAGEM])
def test_no_silencio_a_olhada_e_julgada_e_o_aviso_nao_sai(fila, regra, fonte, tipo):
    motor = MotorDeRegras(fila, [_de_presenca(regra, tipo)])
    juiz = JuizFixo(Resultado.NAO_CONFORME, confianca=0.95)

    _olhar(motor, fonte, BASE)
    primeiros = _julgar(motor, juiz, BASE)
    # um minuto depois: dentro dos quinze de silêncio
    preparo = _olhar(motor, fonte, BASE + timedelta(minutes=1))
    segundos = _julgar(motor, juiz, BASE + timedelta(minutes=1))

    assert len(primeiros) == 1
    assert preparo.em_silencio == [], "a olhada foi pulada pelo silêncio"
    assert juiz.chamadas == 2, "a segunda olhada não foi julgada"
    assert segundos == [], "avisou de novo dentro do silêncio"

    l = _linha(fila)
    assert (l["capturas"], l["enfileiradas"], l["em_silencio"]) == (2, 2, 0)
    # As duas contam como "fora do critério" — é a medida. Aviso, um só.
    assert (l["nao_conformes"], l["alertas"]) == (2, 1)


def test_estado_continua_pulando_a_olhada_no_silencio(fila, regra, fonte):
    """Em estado cada olhada custa uma chamada: ali o silêncio não mudou."""
    motor = MotorDeRegras(fila, [regra])
    juiz = JuizFixo(Resultado.NAO_CONFORME, confianca=0.95)

    _olhar(motor, fonte, BASE)
    _julgar(motor, juiz, BASE)
    preparo = _olhar(motor, fonte, BASE + timedelta(minutes=1))
    _julgar(motor, juiz, BASE + timedelta(minutes=1))

    assert preparo.em_silencio == ["r1"]
    assert juiz.chamadas == 1
    l = _linha(fila)
    assert (l["capturas"], l["enfileiradas"], l["em_silencio"]) == (2, 1, 1)


def test_posto_vazio_e_a_mesma_cena_e_conta_em_TODA_olhada(fila, regra):
    """Quatro olhadas de trinta em trinta segundos sobre a mesma imagem.

    Duas caem no mesmo minuto: com a chave por minuto a segunda virava
    "já julgada" e a medida de dois minutos virava um.
    """
    motor = MotorDeRegras(fila, [_de_presenca(regra)])
    juiz = JuizFixo(Resultado.NAO_CONFORME, confianca=0.95)
    fonte = FonteParada()

    for i in range(4):
        ts = BASE + timedelta(seconds=30 * i)
        _olhar(motor, fonte, ts)
        _julgar(motor, juiz, ts)

    l = _linha(fila)
    assert (l["capturas"], l["enfileiradas"]) == (4, 4)
    assert (l["repetidas"], l["ja_julgadas"]) == (0, 0)
    assert l["nao_conformes"] == 4, "quatro olhadas com o posto vazio = dois minutos vazio"
    assert l["alertas"] == 1


def test_em_estado_a_cena_parada_continua_sem_ser_rejulgada(fila, regra):
    """O atalho que economiza chamada à nuvem fica onde estava."""
    motor = MotorDeRegras(fila, [regra])
    juiz = JuizFixo(Resultado.CONFORME, confianca=0.95)
    fonte = FonteParada()

    for i in range(4):
        ts = BASE + timedelta(seconds=30 * i)
        _olhar(motor, fonte, ts)
        _julgar(motor, juiz, ts)

    l = _linha(fila)
    assert l["capturas"] == 4
    assert l["enfileiradas"] < 4, "cena idêntica foi mandada de novo ao juiz"
    assert juiz.chamadas == l["enfileiradas"]


def test_passado_o_silencio_volta_a_avisar(fila, regra, fonte):
    motor = MotorDeRegras(fila, [_de_presenca(regra)])
    juiz = JuizFixo(Resultado.NAO_CONFORME, confianca=0.95)

    avisos = []
    for minutos in (0, 5, 10, 16):
        ts = BASE + timedelta(minutes=minutos)
        _olhar(motor, fonte, ts)
        avisos.append(len(_julgar(motor, juiz, ts)))

    assert avisos == [1, 0, 0, 1]
    assert juiz.chamadas == 4


def test_silencio_zero_avisa_em_toda_olhada(fila, regra, fonte):
    motor = MotorDeRegras(fila, [replace(_de_presenca(regra), cooldown_min=0)])
    juiz = JuizFixo(Resultado.NAO_CONFORME, confianca=0.95)

    _olhar(motor, fonte, BASE)
    a = _julgar(motor, juiz, BASE)
    _olhar(motor, fonte, BASE + timedelta(seconds=30))
    b = _julgar(motor, juiz, BASE + timedelta(seconds=30))

    assert (len(a), len(b)) == (1, 1)


def test_conforme_no_meio_do_silencio_e_contado_como_conforme(fila, regra, fonte):
    """O posto esvaziou, avisou, e alguém voltou: o resumo tem que ver a volta."""
    motor = MotorDeRegras(fila, [_de_presenca(regra)])

    _olhar(motor, fonte, BASE)
    _julgar(motor, JuizFixo(Resultado.NAO_CONFORME, confianca=0.95), BASE)
    _olhar(motor, fonte, BASE + timedelta(minutes=2))
    _julgar(motor, JuizFixo(Resultado.CONFORME, confianca=0.95), BASE + timedelta(minutes=2))

    l = _linha(fila)
    assert (l["nao_conformes"], l["conformes"], l["alertas"]) == (1, 1, 1)


def test_duas_olhadas_na_fila_antes_do_veredito_dao_UM_aviso(fila, regra, fonte):
    """Vale para todo tipo: o silêncio é conferido de novo na hora do aviso.

    Em estado, duas olhadas podiam entrar na fila antes de a primeira ser
    julgada (a nuvem demorou, a internet caiu). As duas viravam aviso.
    """
    motor = MotorDeRegras(fila, [regra])
    juiz = JuizFixo(Resultado.NAO_CONFORME, confianca=0.95)

    _olhar(motor, fonte, BASE)
    _olhar(motor, fonte, BASE + timedelta(seconds=40))   # ninguém julgou ainda
    avisos = motor.processar(juiz, BASE + timedelta(seconds=45), limite=50)

    assert juiz.chamadas == 2
    assert len(avisos) == 1


def test_o_aviso_de_um_canal_nao_cala_o_outro(fila, regra):
    """O mesmo critério em dois canais: o silêncio é o do canal DO ITEM.

    `_regra` acha a regra pelo id e devolve a do primeiro canal. Se o
    silêncio fosse conferido pela zona dela, o aviso do canal 1 calaria o
    canal 2 — que é o que o silêncio por canal existe para impedir.
    """
    base = _de_presenca(regra)
    no_1 = replace(base, zona=Zona(id="z1", nome="z1", poligono=regra.zona.poligono, ponto_id="canal-1"))
    no_2 = replace(base, zona=Zona(id="z2", nome="z2", poligono=regra.zona.poligono, ponto_id="canal-2"))
    motor = MotorDeRegras(fila, [no_1, no_2])
    juiz = JuizFixo(Resultado.NAO_CONFORME, confianca=0.95)

    from testes.conftest import FonteSintetica

    _olhar(motor, FonteSintetica("canal-1"), BASE)
    do_1 = _julgar(motor, juiz, BASE)
    _olhar(motor, FonteSintetica("canal-2"), BASE + timedelta(minutes=1))
    do_2 = _julgar(motor, juiz, BASE + timedelta(minutes=1))
    # e o canal 1, de novo, dentro do silêncio dele
    _olhar(motor, FonteSintetica("canal-1"), BASE + timedelta(minutes=2))
    de_novo_1 = _julgar(motor, juiz, BASE + timedelta(minutes=2))

    assert [(a.zona_id) for a in do_1] == ["z1"]
    assert [(a.zona_id) for a in do_2] == ["z2"], "o canal 2 foi calado pelo aviso do canal 1"
    assert de_novo_1 == []


def test_a_chave_por_olhada_muda_a_cada_segundo_e_continua_deterministica():
    ts = BASE.replace(second=10)
    args = ("r1", 1, "p1", 0xABCDEF, ts)

    assert Fila.chave_idempotente(*args, por_olhada=True) == Fila.chave_idempotente(*args, por_olhada=True)
    assert Fila.chave_idempotente(*args, por_olhada=True) != Fila.chave_idempotente(
        "r1", 1, "p1", 0xABCDEF, ts + timedelta(seconds=30), por_olhada=True
    )
    # A chave de sempre (por minuto) não mudou: é ela que evita pagar duas
    # vezes pela mesma cena em estado e ação.
    assert Fila.chave_idempotente(*args) == Fila.chave_idempotente(
        "r1", 1, "p1", 0xABCDEF, ts + timedelta(seconds=30)
    )
