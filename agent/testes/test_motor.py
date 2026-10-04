"""As três portas do motor.

O que está sendo protegido aqui é a confiança da loja no sistema. Um alerta
a mais com confiança duvidosa, ou o mesmo alerta de cinco em cinco minutos,
e alguém desliga o Farol — e um sistema desligado tem acurácia zero,
qualquer que seja o número no painel.
"""

from __future__ import annotations

from datetime import timedelta

import pytest

from farol_agent.fila import Fila
from farol_agent.modelos import Resultado
from farol_agent.motor import MotorDeRegras
from testes.conftest import BASE, JuizFixo


@pytest.fixture
def fila(tmp_path):
    f = Fila(tmp_path / "fila.db")
    yield f
    f.fechar()


def _rodar(motor, fonte, juiz, ts):
    """Dispara o gatilho em `ts` e drena a fila logo depois.

    Os dois segundos não são enfeite: o quadro escolhido na rajada é
    carimbado alguns décimos à FRENTE do instante do gatilho, e no agente
    real a drenagem é outro laço, que roda depois da captura. Drenar no
    mesmo instante do gatilho testaria uma situação que não existe.
    """
    from farol_agent.modelos import EventoGatilho

    motor.preparar(EventoGatilho(ponto_id=fonte.ponto_id, ts=ts), fonte)
    return motor.processar(juiz, ts + timedelta(seconds=2), limite=50)


# ─────────────────────── porta 3: vira alerta? ────────────────────────


def test_nao_conforme_com_confianca_alta_vira_alerta(fila, regra, fonte):
    motor = MotorDeRegras(fila, [regra])
    juiz = JuizFixo(Resultado.NAO_CONFORME, confianca=0.95)

    alertas = _rodar(motor, fonte, juiz, BASE)

    assert len(alertas) == 1
    assert alertas[0].regra_id == "r1"
    assert alertas[0].severidade is regra.severidade
    assert alertas[0].confianca == 0.95


def test_confianca_abaixo_do_minimo_nao_alerta(fila, regra, fonte):
    """Mas o julgamento fica registrado, para afinar o limiar depois."""
    motor = MotorDeRegras(fila, [regra])
    juiz = JuizFixo(Resultado.NAO_CONFORME, confianca=0.50)   # mínimo é 0.70

    alertas = _rodar(motor, fonte, juiz, BASE)

    assert alertas == []
    assert juiz.chamadas == 1
    assert fila.resumo().get("concluido") == 1


def test_nao_avaliavel_nunca_alerta(fila, regra, fonte):
    """É indicador de câmera, não de operação."""
    motor = MotorDeRegras(fila, [regra])
    juiz = JuizFixo(Resultado.NAO_AVALIAVEL, confianca=0.99)

    assert _rodar(motor, fonte, juiz, BASE) == []


def test_conforme_nao_alerta(fila, regra, fonte):
    motor = MotorDeRegras(fila, [regra])
    juiz = JuizFixo(Resultado.CONFORME, confianca=0.99)

    assert _rodar(motor, fonte, juiz, BASE) == []


# ──────────────────── porta 2: vale pagar para julgar? ─────────────────


def test_janela_de_silencio_impede_ate_a_analise(fila, regra, fonte):
    """O ponto não é só calar o alerta: é NÃO PAGAR para reconfirmar."""
    motor = MotorDeRegras(fila, [regra])
    juiz = JuizFixo(Resultado.NAO_CONFORME, confianca=0.95)

    primeiros = _rodar(motor, fonte, juiz, BASE)
    assert len(primeiros) == 1
    assert juiz.chamadas == 1

    # 5 minutos depois, dentro do cooldown de 15
    segundos = _rodar(motor, fonte, juiz, BASE + timedelta(minutes=5))
    assert segundos == []
    assert juiz.chamadas == 1, "não pode ter chamado o juiz dentro do silêncio"


def test_depois_do_silencio_volta_a_alertar(fila, regra, fonte):
    motor = MotorDeRegras(fila, [regra])
    juiz = JuizFixo(Resultado.NAO_CONFORME, confianca=0.95)

    _rodar(motor, fonte, juiz, BASE)
    depois = _rodar(motor, fonte, juiz, BASE + timedelta(minutes=16))

    assert len(depois) == 1
    assert juiz.chamadas == 2


def test_cooldown_zero_nao_silencia(fila, regra, fonte):
    regra.cooldown_min = 0
    motor = MotorDeRegras(fila, [regra])
    juiz = JuizFixo(Resultado.NAO_CONFORME, confianca=0.95)

    _rodar(motor, fonte, juiz, BASE)
    segundos = _rodar(motor, fonte, juiz, BASE + timedelta(seconds=30))

    assert len(segundos) == 1


# ───────────────────── porta 1: a regra vale agora? ────────────────────


def test_regra_inativa_nao_se_aplica(fila, regra, fonte):
    regra.ativa = False
    motor = MotorDeRegras(fila, [regra])
    juiz = JuizFixo()

    assert _rodar(motor, fonte, juiz, BASE) == []
    assert juiz.chamadas == 0


def test_regra_fora_da_janela_nao_se_aplica(fila, regra, fonte):
    from farol_agent.modelos import Janela

    # BASE é 16:00; a janela cobre só a manhã.
    regra.janelas = [Janela(dias=[], hora_ini="06:00", hora_fim="11:00")]
    motor = MotorDeRegras(fila, [regra])
    juiz = JuizFixo()

    assert _rodar(motor, fonte, juiz, BASE) == []
    assert juiz.chamadas == 0


def test_janela_que_cruza_a_meia_noite(fila, regra, fonte):
    """O protótipo errava isto e contornava com 23:00-23:59."""
    from farol_agent.modelos import EventoGatilho, Janela

    regra.janelas = [Janela(dias=[], hora_ini="23:00", hora_fim="01:00")]
    motor = MotorDeRegras(fila, [regra])

    meia_noite_e_meia = BASE.replace(hour=0, minute=30)
    assert motor.regras_aplicaveis(
        EventoGatilho(ponto_id=fonte.ponto_id, ts=meia_noite_e_meia)
    ) == [regra]

    tarde = BASE.replace(hour=15, minute=0)
    assert motor.regras_aplicaveis(
        EventoGatilho(ponto_id=fonte.ponto_id, ts=tarde)
    ) == []


def test_gatilho_com_zona_filtra_outras_zonas(fila, regra, fonte):
    from farol_agent.modelos import EventoGatilho

    motor = MotorDeRegras(fila, [regra])
    evento = EventoGatilho(ponto_id=fonte.ponto_id, ts=BASE, zona_id="outra-zona")

    assert motor.regras_aplicaveis(evento) == []


# ──────────────────────────── falhas ───────────────────────────────────


def test_erro_recuperavel_volta_para_a_fila(fila, regra, fonte):
    from farol_agent.juizes.base import ErroDoJuiz

    motor = MotorDeRegras(fila, [regra])
    juiz = JuizFixo(erro=ErroDoJuiz("502 do gateway", recuperavel=True))

    assert _rodar(motor, fonte, juiz, BASE) == []
    assert fila.resumo().get("pendente") == 1, "tem que continuar pendente"


def test_erro_definitivo_nao_fica_martelando(fila, regra, fonte):
    """Chave inválida não melhora com insistência."""
    from farol_agent.juizes.base import ErroDoJuiz

    motor = MotorDeRegras(fila, [regra])
    juiz = JuizFixo(erro=ErroDoJuiz("chave inválida", recuperavel=False))

    _rodar(motor, fonte, juiz, BASE)

    # Volta à fila, mas com a próxima tentativa fora do horizonte útil —
    # a expiração vai descartá-lo antes de qualquer nova tentativa.
    prontos = fila.proximos(BASE + timedelta(hours=1))
    assert prontos == []
    assert juiz.chamadas == 1
