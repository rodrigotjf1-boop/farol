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


# ───────── a porta que a tela de "sem sinal" obrigou a existir ─────────


def _preto(largura=640, altura=480):
    """A tela que o MHDX transmite em canal sem câmera: preto absoluto."""
    import numpy as np

    return np.zeros((altura, largura, 3), dtype=np.uint8)


class FonteDeTelaPreta:
    """Fonte que só devolve a tela de sem-sinal do gravador."""

    def __init__(self, ponto_id="ponto-teste"):
        self.ponto_id = ponto_id

    def quadro(self, ts, stream="main"):
        from farol_agent.modelos import Frame

        return Frame(imagem=_preto(), ts=ts, ponto_id=self.ponto_id)

    def rajada(self, ts, quantidade=6, stream="main"):
        from datetime import timedelta

        from farol_agent.modelos import Frame

        return [
            Frame(
                imagem=_preto(),
                ts=ts + timedelta(milliseconds=200 * i),
                ponto_id=self.ponto_id,
            )
            for i in range(quantidade)
        ]

    def intervalo(self, ini, fim, fps=2.0, stream="sub"):
        return iter(())

    def fechar(self):
        pass


def test_tela_de_sem_sinal_nao_chega_ao_juiz(fila, regra):
    """Medido no MHDX em 05/10/2026: canal sem câmera transmite preto.

    Sem esta porta, o modelo seria perguntado se a bancada está limpa a
    respeito de um retângulo preto — custo real, resposta absurda, e um
    "não conforme" sobre nada viraria alerta para a cozinha.
    """
    motor = MotorDeRegras(fila, [regra])
    juiz = JuizFixo(Resultado.NAO_CONFORME, confianca=0.99)

    alertas = _rodar(motor, FonteDeTelaPreta(), juiz, BASE)

    assert alertas == []
    assert juiz.chamadas == 0, "não pode ter pago para julgar tela preta"


def test_sem_cena_e_distinto_de_repetido(fila, regra):
    """Um diz "nada mudou", o outro diz "a câmera parou de funcionar".

    Confundir os dois faz o painel mostrar calmaria quando devia mostrar
    defeito — e é a loja que descobre, semanas depois.
    """
    from farol_agent.modelos import EventoGatilho

    motor = MotorDeRegras(fila, [regra])
    fonte = FonteDeTelaPreta()

    p = motor.preparar(EventoGatilho(ponto_id=fonte.ponto_id, ts=BASE), fonte)

    assert p.sem_cena == [regra.id]
    assert p.repetidos == []
    assert motor._lugar(regra) in motor.sem_cena
    assert "preto" in motor.sem_cena[motor._lugar(regra)]


def test_camera_que_volta_sai_da_lista_de_defeito(fila, regra, fonte):
    """Senão o painel acusaria defeito para sempre depois do primeiro."""
    from farol_agent.modelos import EventoGatilho

    motor = MotorDeRegras(fila, [regra])

    motor.preparar(EventoGatilho(ponto_id="ponto-teste", ts=BASE), FonteDeTelaPreta())
    assert motor._lugar(regra) in motor.sem_cena

    motor.preparar(EventoGatilho(ponto_id=fonte.ponto_id, ts=BASE), fonte)
    assert motor._lugar(regra) not in motor.sem_cena


# ─────────────── cada critério no SEU canal (ERR-020) ───────────────


def _em_outro_canal(regra, zona_id, ponto_id, regra_id=None):
    """A mesma regra (ou outra) numa zona de OUTRO canal."""
    from dataclasses import replace

    from farol_agent.modelos import Zona

    zona = Zona(id=zona_id, nome=zona_id, poligono=regra.zona.poligono, ponto_id=ponto_id)
    return replace(regra, id=regra_id or regra.id, zona=zona)


def test_criterio_de_um_canal_nao_e_aplicado_ao_quadro_de_outro(fila, regra):
    """O defeito que só aparece com dois canais.

    O polígono da zona é normalizado 0..1, então "cabe" em qualquer imagem:
    sem conferir o dono, o critério da bancada era recortado do quadro da
    fritadeira, julgado e pago. Com um canal só, ninguém via.
    """
    from farol_agent.modelos import EventoGatilho

    da_bancada = _em_outro_canal(regra, "z-bancada", "canal-1", regra_id="r-bancada")
    da_fritadeira = _em_outro_canal(regra, "z-frit", "canal-2", regra_id="r-frit")
    motor = MotorDeRegras(fila, [da_bancada, da_fritadeira])

    no_canal_1 = motor.regras_aplicaveis(EventoGatilho(ponto_id="canal-1", ts=BASE))
    no_canal_2 = motor.regras_aplicaveis(EventoGatilho(ponto_id="canal-2", ts=BASE))

    assert [r.id for r in no_canal_1] == ["r-bancada"]
    assert [r.id for r in no_canal_2] == ["r-frit"]


def test_o_MESMO_criterio_em_dois_canais_vale_nos_dois(fila, regra):
    # Um cadastro, vários canais: o mesmo id aparece uma vez por canal.
    from farol_agent.modelos import EventoGatilho

    no_1 = _em_outro_canal(regra, "z1", "canal-1")
    no_2 = _em_outro_canal(regra, "z2", "canal-2")
    motor = MotorDeRegras(fila, [no_1, no_2])

    aplicaveis = motor.regras_aplicaveis(EventoGatilho(ponto_id="canal-2", ts=BASE))

    assert [(r.id, r.zona.id) for r in aplicaveis] == [("r1", "z2")]


def test_o_silencio_e_por_canal(fila, regra):
    """A bancada suja do canal 1 não pode calar a do canal 2.

    O silêncio era indexado só pelo critério. Com o mesmo critério em três
    canais, o primeiro alerta do dia calaria os outros dois por quinze
    minutos — e a loja teria um canal auditado e dois de enfeite.
    """
    no_1 = _em_outro_canal(regra, "z1", "canal-1")
    no_2 = _em_outro_canal(regra, "z2", "canal-2")
    motor = MotorDeRegras(fila, [no_1, no_2])

    fila.registrar_alerta(regra_id="r1", zona_id="z1", ts=BASE)
    logo_depois = BASE + timedelta(minutes=1)

    assert motor._em_silencio(no_1, logo_depois) is True
    assert motor._em_silencio(no_2, logo_depois) is False, "o canal 2 foi calado pelo 1"


def test_o_alerta_e_gravado_JUNTO_com_o_corpo_que_vai_subir(fila, regra, fonte):
    # Os dois na mesma linha: se o corpo fosse guardado depois, um PC
    # desligado entre os dois passos deixaria um alerta que conta para o
    # silêncio e nunca chega a ninguém.
    motor = MotorDeRegras(
        fila, [regra], serializar=lambda a: {"idempotenciaKey": a.chave, "x": 1}
    )
    alertas = _rodar(motor, fonte, JuizFixo(Resultado.NAO_CONFORME, 0.95), BASE)

    pendentes = fila.eventos_a_subir()
    assert len(pendentes) == 1
    assert pendentes[0][1] == {"idempotenciaKey": alertas[0].chave, "x": 1}


def test_o_alerta_leva_o_hash_da_cena(fila, regra, fonte):
    # É o que permite agrupar vereditos sobre a MESMA imagem e perceber
    # quando o modelo muda de ideia. Só é barato de guardar agora.
    motor = MotorDeRegras(fila, [regra])
    alertas = _rodar(motor, fonte, JuizFixo(Resultado.NAO_CONFORME, 0.95), BASE)

    assert alertas[0].imagem_hash is not None
    assert len(alertas[0].imagem_hash) == 16
    int(alertas[0].imagem_hash, 16)   # é hexadecimal
