"""A fila: idempotência, ordem, retentativa e validade.

Esta é a camada que decide se o agente perde evento quando a internet cai e
se a conta chega dobrada quando ela volta.
"""

from __future__ import annotations

from datetime import timedelta

import pytest

from farol_agent.fila import BACKOFF_SEG, Fila
from farol_agent.modelos import Resultado, Veredito, Via
from testes.conftest import BASE


@pytest.fixture
def fila(tmp_path):
    f = Fila(tmp_path / "fila.db")
    yield f
    f.fechar()


def _enfileirar(fila, chave="k1", prioridade="intermediaria", ts=None, regra="r1"):
    return fila.enfileirar(
        chave=chave,
        regra_id=regra,
        ponto_id="p1",
        zona_id="z1",
        prioridade=prioridade,
        criterio="critério",
        criterio_versao=1,
        imagem_caminho="/spool/x.jpg",
        capturado_em=ts or BASE,
    )


# ───────────────────────── idempotência ────────────────────────────────


def test_chave_e_deterministica():
    a = Fila.chave_idempotente("r1", 1, "p1", 0xABCD, BASE)
    b = Fila.chave_idempotente("r1", 1, "p1", 0xABCD, BASE)
    assert a == b


def test_versao_do_criterio_muda_a_chave():
    """Critério reescrito é outra pergunta — tem que ser julgado de novo."""
    a = Fila.chave_idempotente("r1", 1, "p1", 0xABCD, BASE)
    b = Fila.chave_idempotente("r1", 2, "p1", 0xABCD, BASE)
    assert a != b


def test_minuto_diferente_muda_a_chave():
    a = Fila.chave_idempotente("r1", 1, "p1", 0xABCD, BASE)
    b = Fila.chave_idempotente("r1", 1, "p1", 0xABCD, BASE + timedelta(minutes=1))
    assert a != b


def test_enfileirar_a_mesma_chave_duas_vezes_nao_duplica(fila):
    assert _enfileirar(fila) is True
    assert _enfileirar(fila) is False, "retry não pode cobrar duas vezes"
    assert fila.resumo().get("pendente") == 1


# ──────────────────────────── ordem ────────────────────────────────────


def test_urgente_sai_antes(fila):
    _enfileirar(fila, "leve", prioridade="leve", ts=BASE)
    _enfileirar(fila, "urg", prioridade="urgente", ts=BASE + timedelta(minutes=1))

    prontos = fila.proximos(BASE + timedelta(minutes=2), limite=10)

    assert [p.chave for p in prontos] == ["urg", "leve"]


def test_proximos_nao_devolve_o_mesmo_item_duas_vezes(fila):
    """Dois laços de envio não podem pegar o mesmo item — alerta em dobro."""
    _enfileirar(fila)

    primeiro = fila.proximos(BASE, limite=10)
    segundo = fila.proximos(BASE, limite=10)

    assert len(primeiro) == 1
    assert segundo == []


# ───────────────────────── retentativa ─────────────────────────────────


def test_adiar_espera_mais_a_cada_tentativa(fila):
    _enfileirar(fila)
    item = fila.proximos(BASE)[0]

    fila.adiar(item, "rede caiu", BASE)

    # Ainda não está pronto no instante seguinte
    assert fila.proximos(BASE + timedelta(seconds=1)) == []
    # Mas está depois da espera da primeira tentativa
    pronto = fila.proximos(BASE + timedelta(seconds=BACKOFF_SEG[1] + 1))
    assert len(pronto) == 1
    assert pronto[0].tentativas == 1


def test_desiste_depois_de_esgotar_as_tentativas(fila):
    # Prioridade `leve` porque as cinco esperas somadas passam das duas
    # horas de validade de uma `intermediaria` — que então seria descartada
    # por expiração antes de chegar a `falhou`.
    _enfileirar(fila, prioridade="leve")
    agora = BASE

    for _ in range(len(BACKOFF_SEG) + 1):
        prontos = fila.proximos(agora)
        if not prontos:
            break
        fila.adiar(prontos[0], "falhou", agora)
        agora += timedelta(seconds=max(BACKOFF_SEG) + 1)

    assert fila.resumo().get("falhou") == 1


# ─────────────────────────── validade ──────────────────────────────────


def test_urgente_expira_rapido(fila):
    """Alerta urgente de uma hora atrás não serve para agir."""
    _enfileirar(fila, prioridade="urgente", ts=BASE)

    assert fila.proximos(BASE + timedelta(hours=1)) == []
    assert fila.resumo().get("descartado") == 1


def test_leve_aguenta_a_noite(fila):
    _enfileirar(fila, prioridade="leve", ts=BASE)

    assert len(fila.proximos(BASE + timedelta(hours=8))) == 1


# ─────────────────────── veredito e limpeza ────────────────────────────


def test_veredito_guardado_e_recuperavel(fila):
    _enfileirar(fila)
    item = fila.proximos(BASE)[0]
    fila.concluir(
        item.id,
        Veredito(
            resultado=Resultado.NAO_CONFORME,
            confianca=0.9,
            motivo="restos no canto",
            via=Via.NUVEM,
            modelo="m",
            custo_centavos=1.5,
        ),
        BASE,
    )

    v = fila.veredito_de("k1")
    assert v is not None
    assert v.resultado is Resultado.NAO_CONFORME
    assert v.confianca == 0.9
    assert fila.custo_centavos(BASE - timedelta(days=1)) == pytest.approx(1.5)


def test_limpeza_apaga_imagem_do_spool(fila, tmp_path):
    """Disco cheio num PC de loja derruba o agente de um jeito difícil de ver."""
    img = tmp_path / "quadro.jpg"
    img.write_bytes(b"conteudo")

    fila.enfileirar(
        chave="k9", regra_id="r1", ponto_id="p1", zona_id="z1",
        prioridade="leve", criterio="c", criterio_versao=1,
        imagem_caminho=img, capturado_em=BASE,
    )
    item = fila.proximos(BASE)[0]
    fila.concluir(item.id, Veredito(resultado=Resultado.CONFORME, confianca=1.0), BASE)

    apagados = fila.limpar_concluidos(BASE + timedelta(days=1))

    assert apagados == 1
    assert not img.exists()


def test_alerta_registra_e_devolve_o_ultimo(fila):
    assert fila.ultimo_alerta("r1") is None

    fila.registrar_alerta(regra_id="r1", zona_id="z1", ts=BASE)
    fila.registrar_alerta(regra_id="r1", zona_id="z1", ts=BASE + timedelta(minutes=5))

    ultimo = fila.ultimo_alerta("r1")
    assert ultimo == BASE + timedelta(minutes=5)
