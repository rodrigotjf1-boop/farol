"""O limite de análises por volta, e o que não disputa com ele (A20, fatia 1.5).

A cada volta saem para julgamento no máximo dez análises: é o que impede uma
volta de levar minutos quando a nuvem demora. Mas o que o detector julga na
própria loja responde em décimos de segundo — e disputava as mesmas dez
vagas. Com doze critérios no mesmo instante, dois ficavam para a volta
seguinte, fossem de onde fossem; e a resposta de um décimo de segundo
esperava na fila atrás da de dois segundos.

O que estes testes protegem:

1. o que a loja julga sozinha tem o limite DELA, e não gasta o da nuvem;
2. dentro da mesma prioridade, sai na frente — e a urgência continua acima;
3. o limite dela existe: a fila acumulada não segura a volta;
4. sem ninguém julgado na loja (ou sem o limite dela), nada muda;
5. pela auditoria, "julgado na loja" é o que o seletor entrega ao DETECTOR —
   a comparação com a foto padrão e o que vai à nuvem continuam no limite.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import timedelta

import pytest

from farol_agent.auditoria import LIMITE_DA_LOJA_POR_PASSADA, LIMITE_POR_PASSADA, Auditoria
from farol_agent.configuracao import de_json
from farol_agent.fila import Fila
from farol_agent.juizes.seletor import JuizPorRegra, SeletorDeJuiz
from farol_agent.modelos import EventoGatilho, Resultado, TipoRegra, Veredito, Via
from farol_agent.motor import MotorDeRegras
from testes.conftest import BASE

from .test_auditoria import FonteBoa, NuvemDeTeste
from .test_configuracao import resposta

SEG = timedelta(seconds=1)


@pytest.fixture
def fila(tmp_path):
    f = Fila(tmp_path / "fila.db")
    yield f
    f.fechar()


def por(fila: Fila, regra_id: str, quando, *, prioridade: str = "intermediaria", n: int = 0) -> None:
    assert fila.enfileirar(
        chave=f"{regra_id}-{quando:%H%M%S}-{n}", regra_id=regra_id, ponto_id="p1", zona_id="z1",
        prioridade=prioridade, criterio="c", criterio_versao=1, imagem_caminho=fila.spool / f"{regra_id}-{n}.jpg",
        capturado_em=quando, contexto={"regra_id": regra_id, "zona_id": "z1", "ponto_id": "p1"},
    )


def doze_de_cada(fila: Fila) -> None:
    """Doze análises do detector e doze da nuvem, intercaladas no tempo, segundo a segundo.

    Entram na fila da mais NOVA para a mais velha: a ordem de saída é a do
    instante da imagem, e não a de chegada — e só dá para ver a diferença
    quando as duas discordam.
    """
    for i in reversed(range(12)):
        por(fila, "nuv", BASE + (2 * i + 1) * SEG, n=i)
        por(fila, "det", BASE + (2 * i) * SEG, n=i)


def de_quem(itens) -> list[str]:
    return [i.regra_id for i in itens]


# ═════════════════════════════ a fila ═════════════════════════════


def test_as_medidas():
    assert (LIMITE_POR_PASSADA, LIMITE_DA_LOJA_POR_PASSADA) == (10, 100)


def test_sem_dizer_quem_e_da_loja_o_limite_e_um_so_como_sempre(fila):
    doze_de_cada(fila)

    primeiros = fila.proximos(BASE + 60 * SEG, limite=10)

    assert de_quem(primeiros) == ["det", "nuv"] * 5, "os dez mais velhos, de quem forem"
    # E dizer quem é da loja SEM dar o limite dela também não muda nada.
    assert len(fila.proximos(BASE + 60 * SEG, limite=10, da_loja={"det"})) == 10


def test_o_que_a_loja_julga_sozinha_nao_gasta_o_limite_da_nuvem(fila):
    doze_de_cada(fila)

    itens = fila.proximos(BASE + 60 * SEG, limite=10, da_loja={"det"}, limite_da_loja=100)

    assert de_quem(itens).count("det") == 12, "tudo o que é da loja sai nesta volta"
    assert de_quem(itens).count("nuv") == 10, "e a nuvem continua com as dez vagas dela"
    # O que sobrou da nuvem sai na seguinte — e o que saiu não sai de novo.
    assert de_quem(fila.proximos(BASE + 61 * SEG, limite=10, da_loja={"det"}, limite_da_loja=100)) == ["nuv", "nuv"]
    assert fila.proximos(BASE + 62 * SEG, limite=10, da_loja={"det"}, limite_da_loja=100) == []


def test_o_que_e_da_loja_sai_na_frente_dentro_da_mesma_prioridade(fila):
    doze_de_cada(fila)

    itens = fila.proximos(BASE + 60 * SEG, limite=10, da_loja={"det"}, limite_da_loja=100)

    assert de_quem(itens) == ["det"] * 12 + ["nuv"] * 10
    # E cada grupo na ordem de sempre: o mais velho primeiro.
    for grupo in ("det", "nuv"):
        capturas = [i.capturado_em for i in itens if i.regra_id == grupo]
        assert capturas == sorted(capturas)


def test_a_urgencia_continua_acima_de_tudo(fila):
    por(fila, "det", BASE)
    por(fila, "nuv", BASE + SEG, prioridade="urgente")
    por(fila, "det", BASE + 2 * SEG, prioridade="leve", n=1)
    por(fila, "nuv", BASE + 3 * SEG, n=1)

    itens = fila.proximos(BASE + 60 * SEG, limite=10, da_loja={"det"}, limite_da_loja=100)

    assert [(i.prioridade, i.regra_id) for i in itens] == [
        ("urgente", "nuv"), ("intermediaria", "det"), ("intermediaria", "nuv"), ("leve", "det"),
    ]


def test_o_limite_da_loja_existe_a_fila_acumulada_nao_segura_a_volta(fila):
    doze_de_cada(fila)

    itens = fila.proximos(BASE + 60 * SEG, limite=10, da_loja={"det"}, limite_da_loja=5)

    assert de_quem(itens) == ["det"] * 5 + ["nuv"] * 10
    assert [i.capturado_em for i in itens[:5]] == [BASE + (2 * i) * SEG for i in range(5)], "as cinco mais velhas"
    # As outras sete saem nas voltas seguintes, cinco de cada vez.
    assert de_quem(fila.proximos(BASE + 61 * SEG, limite=10, da_loja={"det"}, limite_da_loja=5)) == ["det"] * 5 + ["nuv"] * 2
    assert de_quem(fila.proximos(BASE + 62 * SEG, limite=10, da_loja={"det"}, limite_da_loja=5)) == ["det"] * 2


def test_o_que_ainda_nao_esta_pronto_nao_sai_em_nenhum_dos_dois_grupos(fila):
    por(fila, "det", BASE)
    por(fila, "nuv", BASE + SEG)
    por(fila, "det", BASE + 30 * SEG, n=1)
    por(fila, "nuv", BASE + 31 * SEG, n=1)

    itens = fila.proximos(BASE + 10 * SEG, limite=10, da_loja={"det"}, limite_da_loja=100)

    assert de_quem(itens) == ["det", "nuv"]
    assert fila.resumo() == {"enviando": 2, "pendente": 2}, "só o que saiu foi marcado"


def test_mais_de_um_criterio_julgado_na_loja(fila):
    for i in range(6):
        por(fila, "presenca", BASE + i * SEG, n=i)
        por(fila, "contagem", BASE + i * SEG, n=i)
        por(fila, "estado", BASE + i * SEG, n=i)

    itens = fila.proximos(BASE + 60 * SEG, limite=4, da_loja={"presenca", "contagem"}, limite_da_loja=100)

    quem = de_quem(itens)
    assert (quem.count("presenca"), quem.count("contagem"), quem.count("estado")) == (6, 6, 4)
    assert set(quem[:12]) == {"presenca", "contagem"} and quem[12:] == ["estado"] * 4


# ═════════════════════════════ o motor ═════════════════════════════


class PorCriterio:
    """Responde pelo critério do item, e anota a ordem em que foi chamado."""

    nome = "por-criterio"

    def __init__(self) -> None:
        self.chamados: list[str] = []

    def julgar(self, imagem, criterio, *, contexto=None, referencias=None) -> Veredito:
        self.chamados.append(contexto["regra_id"])
        return Veredito(resultado=Resultado.CONFORME, confianca=0.9, motivo="dublê", via=Via.LOCAL, modelo="x")


def test_o_motor_passa_adiante_quem_e_da_loja(fila, regra):
    det = replace(regra, id="det", tipo=TipoRegra.PRESENCA, parametros={"objeto": "pessoa", "minimo": 1}, cooldown_min=0)
    nuv = replace(regra, id="nuv", cooldown_min=0)
    motor = MotorDeRegras(fila, [det, nuv])
    doze_de_cada(fila)
    juiz = PorCriterio()

    # Um limite que não é o de fábrica da fila: tem de ser o que foi pedido que chega lá.
    motor.processar(juiz, BASE + 60 * SEG, limite=4, da_loja=["det"], limite_da_loja=100)

    assert juiz.chamados == ["det"] * 12 + ["nuv"] * 4
    juiz.chamados.clear()
    # Sem dizer quem é da loja, o limite é um só.
    doze_de_cada_de_novo = Fila(fila.caminho.parent / "outra.db")
    try:
        doze_de_cada(doze_de_cada_de_novo)
        MotorDeRegras(doze_de_cada_de_novo, [det, nuv]).processar(juiz, BASE + 60 * SEG, limite=4)
        assert len(juiz.chamados) == 4
    finally:
        doze_de_cada_de_novo.fechar()


# ════════════════════════════ a auditoria ════════════════════════════


class Detector:
    nome = "detector"

    def __init__(self) -> None:
        self.vistos: list[str] = []

    def atende(self, parametros) -> None:
        pass

    def julgar(self, imagem, criterio, *, contexto=None, referencias=None) -> Veredito:
        self.vistos.append(contexto["regra_id"])
        return Veredito(resultado=Resultado.CONFORME, confianca=0.9, motivo="vi", via=Via.DETECTOR, modelo="d", medida=1.0)


class Nuvem:
    nome = "nuvem"

    def __init__(self) -> None:
        self.vistos: list[str] = []

    def julgar(self, imagem, criterio, *, contexto=None, referencias=None) -> Veredito:
        self.vistos.append(contexto["regra_id"])
        return Veredito(resultado=Resultado.CONFORME, confianca=0.9, motivo="ok", via=Via.NUVEM, modelo="n", custo_centavos=1.0)


def loja_com(presencas: int, estados: int) -> dict:
    """Um canal com `presencas` critérios de presença e `estados` critérios de estado, todos valendo sempre."""
    corpo = resposta(versao=5)
    base = {**corpo["pontos"][0]["zonas"][0]["regras"][0], "janelas": [], "quando": "sempre", "cooldownMin": 0}
    regras = [
        {**base, "id": f"pre{i:02d}", "nome": f"presença {i}", "tipo": "presenca", "parametros": {"objeto": "pessoa", "minimo": 1}}
        for i in range(presencas)
    ] + [{**base, "id": f"est{i:02d}", "nome": f"estado {i}"} for i in range(estados)]
    corpo["pontos"][0]["zonas"][0]["regras"] = regras
    return corpo


def auditoria_com(tmp_path, corpo: dict, *, detector=None, nuvem=None):
    detector, nuvem = detector or Detector(), nuvem or Nuvem()
    a = Auditoria(
        NuvemDeTeste(), str(tmp_path / "fila.db"),
        construir_fonte=lambda ponto: FonteBoa(ponto.id),
        construir_juiz=lambda cfg: JuizPorRegra(
            SeletorDeJuiz("nuvem", nuvem=nuvem, detector=detector), {r.id: r for r in cfg.regras}
        ),
        medidor=None,
    )
    a.montar(de_json(corpo))
    return a, detector, nuvem


def test_pela_auditoria_so_o_que_o_detector_julga_fica_fora_do_limite(tmp_path):
    a, detector, nuvem = auditoria_com(tmp_path, loja_com(presencas=12, estados=12))
    assert a._julgados_pelo_detector == {f"pre{i:02d}" for i in range(12)}

    a.passo(BASE)

    assert len(detector.vistos) == 12, "os doze de presença saem na mesma volta"
    assert len(nuvem.vistos) == LIMITE_POR_PASSADA, "e a nuvem continua com dez por volta"
    # Os dois da nuvem que sobraram saem na volta seguinte.
    a.julgar(BASE + 5 * SEG)
    assert len(nuvem.vistos) == 12
    a.fila.fechar()


def test_sem_detector_nada_e_tratado_como_julgado_na_loja(tmp_path):
    """O juiz que não tem seletor (o de bancada, o de teste): o limite é um só, como sempre."""
    from .test_auditoria import JuizDeTeste

    a = Auditoria(
        NuvemDeTeste(), str(tmp_path / "fila.db"),
        construir_fonte=lambda ponto: FonteBoa(ponto.id),
        construir_juiz=lambda cfg: JuizDeTeste(Resultado.CONFORME),
        medidor=None,
    )
    a.montar(de_json(loja_com(presencas=12, estados=12)))
    assert a._julgados_pelo_detector == set()

    a.passo(BASE)

    assert a.fila.resumo().get("concluido") == LIMITE_POR_PASSADA
    a.fila.fechar()


def test_remontar_refaz_a_lista_do_que_o_detector_julga(tmp_path):
    a, _, _ = auditoria_com(tmp_path, loja_com(presencas=2, estados=1))
    assert a._julgados_pelo_detector == {"pre00", "pre01"}

    corpo = loja_com(presencas=1, estados=2)
    corpo["versao"] = 6
    a.montar(de_json(corpo))

    assert a._julgados_pelo_detector == {"pre00"}
    a.fila.fechar()


def test_o_criterio_que_so_observa_nao_entra_na_lista(tmp_path):
    corpo = loja_com(presencas=2, estados=0)
    corpo["pontos"][0]["zonas"][0]["regras"][1]["estado"] = "observando"
    a, _, _ = auditoria_com(tmp_path, corpo)
    assert a._julgados_pelo_detector == {"pre00"}
    a.fila.fechar()
