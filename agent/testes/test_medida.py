"""A medida de cada olhada: quantos objetos o detector viu, guardada por hora.

Pedido do dono em 07/10/2026: "um motor de análise analítica para determinar
padrões — com uma semana de uso verificar as análises e ir criando um padrão
de funcionamento". Padrão não sai de veredito: "conforme" com a regra pedindo
"pelo menos 1 pessoa" não diz se havia uma ou quatro. Sai do NÚMERO.

O que tem de ficar provado:

- a medida é o que o detector viu com certeza, e não depende do que a regra
  pede — a mesma cena dá a mesma medida com qualquer limite;
- a hora guarda soma, quantidade e maior valor; juiz que não mede (a nuvem)
  não entra na quantidade, e por isso não vira zero na média;
- a fila de uma loja em operação ganha as colunas ao abrir;
- os três números sobem como em `contratos/resumo-do-agente.json`.
"""

from __future__ import annotations

import sqlite3
from datetime import timedelta

import numpy as np
import pytest

from farol_agent import imagens
from farol_agent.contrato import resumo_para_nuvem
from farol_agent.fila import Fila
from farol_agent.juizes.detector import CERTEZA, JuizDetector
from farol_agent.modelos import Resultado, Veredito, Via
from testes.conftest import BASE

from .test_detector import MotorFixo
from .test_onde_foi_julgado import _RESUMO_ANTIGO


@pytest.fixture
def fila(tmp_path):
    f = Fila(tmp_path / "fila.db")
    yield f
    f.fechar()


@pytest.fixture
def foto(tmp_path):
    caminho = tmp_path / "quadro.jpg"
    imagens.escrever(str(caminho), np.full((48, 64, 3), 127, dtype=np.uint8))
    return caminho


def _linha(fila, regra="r1", zona="z1") -> dict:
    achadas = [dict(l) for l in fila._con.execute("select * from resumo_hora") if l["regra_id"] == regra and l["zona_id"] == zona]
    assert len(achadas) == 1, f"esperava uma linha para {regra}/{zona}, achei {len(achadas)}"
    return achadas[0]


def _do_detector(medida: float | None, resultado=Resultado.CONFORME) -> Veredito:
    return Veredito(resultado=resultado, confianca=0.9, motivo="ok", via=Via.DETECTOR, modelo="fixo", custo_centavos=0.0, latencia_ms=90, medida=medida)


# ───────────────────────────── o detector ─────────────────────────────


def test_a_medida_e_quantos_o_detector_viu_COM_CERTEZA(foto):
    # Duas pessoas certas, um "talvez" (o casaco) e um descartado.
    motor = MotorFixo([0.93, CERTEZA, 0.41, 0.05])

    v = JuizDetector(motor).julgar(foto, "", contexto={"parametros": {"objeto": "pessoa", "minimo": 1}})

    assert v.medida == 2.0, "o talvez entrou na medida — ou a detecção no limiar ficou de fora"
    assert "vi 2 pessoas" in v.motivo, "a medida e o motivo têm de dizer a mesma coisa"


def test_cena_vazia_mede_zero_e_zero_e_medida(foto):
    v = JuizDetector(MotorFixo([0.06])).julgar(foto, "", contexto={"parametros": {"objeto": "pessoa", "minimo": 1}})

    assert v.medida == 0.0
    assert v.medida is not None, "zero pessoas é uma medida; None é 'não medi'"


@pytest.mark.parametrize(
    "parametros",
    [
        {"objeto": "pessoa", "minimo": 1},                 # presença: "tem que ter alguém"
        {"objeto": "pessoa", "minimo": 0, "maximo": 0},    # "ninguém na área"
        {"objeto": "pessoa", "minimo": 0, "maximo": 3},    # fila até 3
        {"objeto": "pessoa", "minimo": 5},                 # exige cinco
    ],
)
def test_a_medida_NAO_depende_do_que_a_regra_pede(foto, parametros):
    """A mesma cena, com quatro regras diferentes: sempre três pessoas.

    O veredito muda (conforme numa, fora na outra); a medida, não. É isso
    que deixa o padrão da loja ser calculado sem olhar a regra.
    """
    v = JuizDetector(MotorFixo([0.95, 0.91, 0.88])).julgar(foto, "", contexto={"parametros": parametros})

    assert v.medida == 3.0


# ───────────────────────────── a hora ─────────────────────────────


def test_a_hora_guarda_soma_quantidade_e_maior_valor(fila):
    for medida in (1, 0, 4, 2):
        fila.contar_veredito(BASE, "r1", "z1", _do_detector(medida), BASE)

    l = _linha(fila)
    assert (l["soma_medida"], l["com_medida"], l["max_medida"]) == (7, 4, 4)


def test_juiz_que_nao_mede_nao_entra_na_media(fila):
    """A nuvem julga "uniforme completo": não há número de coisa nenhuma."""
    fila.contar_veredito(BASE, "r1", "z1", Veredito(resultado=Resultado.CONFORME, via=Via.NUVEM, custo_centavos=1.3), BASE)
    fila.contar_veredito(BASE, "r1", "z1", Veredito(resultado=Resultado.NAO_AVALIAVEL, via=Via.NUVEM, custo_centavos=1.3), BASE)

    l = _linha(fila)
    assert (l["soma_medida"], l["com_medida"], l["max_medida"]) == (0, 0, None)
    assert l["conformes"] + l["nao_avaliaveis"] == 2, "o veredito continua contado"


def test_a_hora_em_que_so_houve_zero_tem_maximo_zero_nao_nulo(fila):
    fila.contar_veredito(BASE, "r1", "z1", _do_detector(0), BASE)
    fila.contar_veredito(BASE, "r1", "z1", _do_detector(0), BASE)

    l = _linha(fila)
    assert (l["soma_medida"], l["com_medida"], l["max_medida"]) == (0, 2, 0)


def test_a_medida_e_por_hora_por_criterio_e_por_area(fila):
    fila.contar_veredito(BASE, "r1", "z1", _do_detector(2), BASE)
    fila.contar_veredito(BASE, "r1", "z2", _do_detector(5), BASE)
    fila.contar_veredito(BASE + timedelta(hours=1), "r1", "z1", _do_detector(1), BASE + timedelta(hours=1))

    linhas = {(l["hora"], l["zona_id"]): dict(l) for l in fila._con.execute("select * from resumo_hora")}
    assert linhas[(Fila.hora_de(BASE), "z1")]["max_medida"] == 2
    assert linhas[(Fila.hora_de(BASE), "z2")]["max_medida"] == 5
    assert linhas[(Fila.hora_de(BASE + timedelta(hours=1)), "z1")]["soma_medida"] == 1


def test_a_medida_fica_guardada_com_o_julgamento(fila, tmp_path):
    """Na tabela de análises, e volta inteira quando a cena é reaproveitada."""
    chave = "c" * 32
    assert fila.enfileirar(
        chave=chave, regra_id="r1", ponto_id="p1", zona_id="z1", prioridade="intermediaria",
        criterio="x", criterio_versao=1, imagem_caminho=tmp_path / "a.jpg", capturado_em=BASE, contexto={}, phash="0" * 16,
    )
    item = fila.proximos(BASE + timedelta(seconds=1))[0]

    fila.concluir(item.id, _do_detector(3), BASE + timedelta(seconds=2))

    assert fila.veredito_de(chave).medida == 3.0
    guardada = fila._con.execute("select medida from analise where chave = ?", (chave,)).fetchone()["medida"]
    assert guardada == 3.0


# ─────────────────────── a loja que já está rodando ───────────────────────


def test_a_fila_de_uma_loja_em_operacao_ganha_as_colunas_e_segue(tmp_path):
    caminho = tmp_path / "fila.db"
    antigo = sqlite3.connect(caminho)
    antigo.executescript(_RESUMO_ANTIGO)
    antigo.execute(
        "insert into resumo_hora (hora, regra_id, zona_id, capturas, enfileiradas, conformes) values (?,?,?,?,?,?)",
        (Fila.hora_de(BASE), "r1", "z1", 5, 5, 5),
    )
    antigo.commit()
    antigo.close()

    fila = Fila(caminho)
    try:
        antes = _linha(fila)
        assert (antes["soma_medida"], antes["com_medida"], antes["max_medida"]) == (0, 0, None)

        fila.contar_veredito(BASE, "r1", "z1", _do_detector(2), BASE)

        depois = _linha(fila)
        assert (depois["conformes"], depois["soma_medida"], depois["com_medida"], depois["max_medida"]) == (6, 2, 1, 2)
    finally:
        fila.fechar()


# ───────────────────────────── o que sobe ─────────────────────────────


def test_os_tres_numeros_sobem_para_a_nuvem(fila):
    fila.contar_veredito(BASE, "r1", "z1", _do_detector(1), BASE)
    fila.contar_veredito(BASE, "r1", "z1", _do_detector(3), BASE)

    corpo = resumo_para_nuvem(fila.resumos_a_subir()[0])

    assert (corpo["somaMedida"], corpo["comMedida"], corpo["maxMedida"]) == (4.0, 2, 3.0)


def test_sem_medida_o_maior_valor_sobe_nulo(fila):
    fila.contar_veredito(BASE, "r1", "z1", Veredito(resultado=Resultado.CONFORME, via=Via.NUVEM), BASE)

    corpo = resumo_para_nuvem(fila.resumos_a_subir()[0])

    assert (corpo["somaMedida"], corpo["comMedida"], corpo["maxMedida"]) == (0.0, 0, None)
