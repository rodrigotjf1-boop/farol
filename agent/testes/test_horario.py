"""Horário de funcionamento: quando é hora de conferir cada critério.

O horário é DA LOJA; o critério diz se é conferido com ela aberta
(`no_horario`), fechada (`fora_do_horario`) ou `sempre`. Quem decide é este
computador, pelo relógio dele.

Os casos de "aberta ou fechada" vêm de `contratos/horario-de-funcionamento.json`,
que a API também lê: se as duas contas divergirem, a tela diz "aberta" e o
agente não olha.
"""

from __future__ import annotations

import json
from dataclasses import replace
from datetime import datetime, timedelta
from pathlib import Path

import pytest

from farol_agent import configuracao
from farol_agent.configuracao import ErroDeConfiguracao
from farol_agent.fila import Fila
from farol_agent.modelos import EventoGatilho, Janela, Resultado
from farol_agent.motor import MotorDeRegras
from testes.conftest import JuizFixo

from .test_configuracao import resposta

CONTRATO = json.loads(
    (Path(__file__).resolve().parents[2] / "contratos" / "horario-de-funcionamento.json").read_text(encoding="utf-8")
)
DA_LOJA = [Janela(dias=f["dias"], hora_ini=f["hora_ini"], hora_fim=f["hora_fim"]) for f in CONTRATO["horario"]]

QUARTA_NOITE = datetime(2026, 10, 7, 21, 40)   # aberta
QUARTA_MANHA = datetime(2026, 10, 7, 10, 0)    # fechada


@pytest.fixture
def fila(tmp_path):
    f = Fila(tmp_path / "fila.db")
    yield f
    f.fechar()


def _aberta(ts: datetime) -> bool:
    return any(j.contem(ts) for j in DA_LOJA)


# ───────────────────────── a conta, pelo contrato ─────────────────────────


@pytest.mark.parametrize("caso", CONTRATO["casos"], ids=lambda c: f'{c["quando"]} {c["porque"]}')
def test_aberta_ou_fechada_como_no_contrato(caso):
    assert _aberta(datetime.fromisoformat(caso["quando"])) is caso["aberta"], caso["porque"]


def test_o_contrato_cobre_a_madrugada_dos_dois_lados():
    # Sem estes dois casos o contrato não pegaria o erro que motivou a conta:
    # conferir só o dia de hoje numa faixa que atravessa a meia-noite.
    porques = " | ".join(c["porque"] for c in CONTRATO["casos"])
    assert "ainda é a sexta" in porques and "resto da quinta" in porques


def test_janela_sem_dias_que_cruza_a_meia_noite_continua_valendo_todo_dia():
    """A janela própria do critério, do jeito que já existia."""
    j = Janela(dias=[], hora_ini="23:00", hora_fim="01:00")
    assert j.contem(datetime(2026, 10, 7, 23, 30))
    assert j.contem(datetime(2026, 10, 8, 0, 30))
    assert not j.contem(datetime(2026, 10, 8, 12, 0))


# ───────────────────────── é hora de conferir? ─────────────────────────


@pytest.mark.parametrize(
    ("estado", "ts"), [("aberta", QUARTA_NOITE), ("fechada", QUARTA_MANHA)]
)
@pytest.mark.parametrize("quando", ["no_horario", "fora_do_horario", "sempre"])
def test_hora_de_conferir_com_horario(regra, estado, ts, quando):
    r = replace(regra, quando=quando, horario_da_loja=DA_LOJA)
    assert r.vale_agora(ts) is CONTRATO["conferir"]["com_horario"][estado][quando]


@pytest.mark.parametrize("quando", ["no_horario", "fora_do_horario", "sempre"])
def test_loja_sem_horario_vale_como_sempre_aberta(regra, quando):
    r = replace(regra, quando=quando, horario_da_loja=[])
    for ts in (QUARTA_NOITE, QUARTA_MANHA, datetime(2026, 10, 5, 4, 0)):
        assert r.vale_agora(ts) is CONTRATO["conferir"]["sem_horario"][quando]


def test_o_padrao_e_no_horario_e_sem_horario_nada_muda(regra):
    """Critério de antes de o horário existir: continua valendo sempre."""
    assert regra.quando == "no_horario"
    assert regra.horario_da_loja == []
    assert regra.vale_agora(QUARTA_MANHA)


def test_criterio_desligado_nao_vale_a_hora_que_for(regra):
    r = replace(regra, ativa=False, quando="sempre", horario_da_loja=DA_LOJA)
    assert not r.vale_agora(QUARTA_NOITE)


def test_a_janela_propria_do_criterio_E_o_horario_da_loja_valem_juntos(regra):
    """Critério "no horário" que ainda tem faixa própria só vale nas duas."""
    so_ate_as_20 = [Janela(dias=[], hora_ini="18:00", hora_fim="20:00")]
    r = replace(regra, janelas=so_ate_as_20, quando="no_horario", horario_da_loja=DA_LOJA)
    assert r.vale_agora(datetime(2026, 10, 7, 19, 0))
    assert not r.vale_agora(QUARTA_NOITE), "21h40 está no horário da loja, fora da faixa do critério"
    assert not r.vale_agora(datetime(2026, 10, 5, 19, 0)), "segunda às 19h: na faixa do critério, loja fechada"


# ───────────────────────── o motor não olha fora da hora ─────────────────────────


class FonteQueConta:
    """Conta quantas vezes a câmera foi pedida."""

    ponto_id = "ponto-teste"

    def __init__(self):
        self.pedidos = 0

    def rajada(self, ts, quantidade=6, stream="main"):
        from testes.conftest import FonteSintetica

        self.pedidos += 1
        return FonteSintetica(self.ponto_id).rajada(ts, quantidade)


def test_fora_da_hora_o_motor_nem_pede_imagem_a_camera(fila, regra):
    """Loja fechada, critério "no horário": nada de câmera, fila ou juiz.

    Na loja, em 07/10/2026, presença e fila rodaram com a casa fechada e
    geraram oito avisos falsos; os de nuvem foram julgados uma vez por
    minuto para responder "não há ninguém".
    """
    r = replace(regra, quando="no_horario", horario_da_loja=DA_LOJA)
    motor = MotorDeRegras(fila, [r])
    fonte = FonteQueConta()
    juiz = JuizFixo(Resultado.NAO_CONFORME, confianca=0.95)

    preparo = motor.preparar(EventoGatilho(ponto_id=fonte.ponto_id, ts=QUARTA_MANHA), fonte)
    avisos = motor.processar(juiz, QUARTA_MANHA + timedelta(seconds=2))

    assert fonte.pedidos == 0
    assert preparo.enfileirados == [] and avisos == [] and juiz.chamadas == 0
    assert fila._con.execute("select count(*) from resumo_hora").fetchone()[0] == 0, "não olhou: não conta olhada"

    # À noite, com a loja aberta, o mesmo critério roda.
    motor.preparar(EventoGatilho(ponto_id=fonte.ponto_id, ts=QUARTA_NOITE), fonte)
    assert fonte.pedidos == 1
    assert len(motor.processar(juiz, QUARTA_NOITE + timedelta(seconds=2))) == 1


def test_criterio_de_fora_do_horario_so_roda_com_a_loja_fechada(fila, regra):
    r = replace(regra, quando="fora_do_horario", horario_da_loja=DA_LOJA)
    motor = MotorDeRegras(fila, [r])
    fonte = FonteQueConta()

    motor.preparar(EventoGatilho(ponto_id=fonte.ponto_id, ts=QUARTA_NOITE), fonte)
    assert fonte.pedidos == 0, "rodou com a loja aberta"
    motor.preparar(EventoGatilho(ponto_id=fonte.ponto_id, ts=QUARTA_MANHA), fonte)
    assert fonte.pedidos == 1


# ───────────────────────── o que desce da nuvem ─────────────────────────


def test_a_configuracao_traz_o_horario_da_loja_para_cada_criterio():
    bruto = resposta()
    bruto["loja"]["horarioFuncionamento"] = CONTRATO["horario"]
    for p in bruto["pontos"]:
        for z in p["zonas"]:
            for r in z["regras"]:
                r["quando"] = "fora_do_horario"

    config = configuracao.de_json(bruto)

    assert config.regras, "o dublê de configuração tem que ter critério"
    for r in config.regras:
        assert r.quando == "fora_do_horario"
        assert [(j.dias, j.hora_ini, j.hora_fim) for j in r.horario_da_loja] == [
            (f["dias"], f["hora_ini"], f["hora_fim"]) for f in CONTRATO["horario"]
        ]


def test_nuvem_antiga_que_nao_manda_os_campos_deixa_tudo_como_era():
    config = configuracao.de_json(resposta())

    for r in config.regras:
        assert r.quando == "no_horario"
        assert r.horario_da_loja == []


def test_quando_desconhecido_e_recusado_dizendo_qual_criterio():
    bruto = resposta()
    regra = bruto["pontos"][0]["zonas"][0]["regras"][0]
    regra["quando"] = "de madrugada"

    with pytest.raises(ErroDeConfiguracao, match="quando='de madrugada'"):
        configuracao.de_json(bruto)
