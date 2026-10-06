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


# ───────────── a fila de uma loja que JÁ existe (ERR-019) ─────────────


ESQUEMA_ANTIGO = """
create table analise (
  id integer primary key autoincrement, chave text not null unique,
  regra_id text not null, ponto_id text not null, zona_id text,
  prioridade text not null, criterio text not null,
  criterio_versao integer not null, imagem_caminho text not null,
  contexto text not null default '{}', capturado_em text not null,
  expira_em text not null, estado text not null default 'pendente',
  tentativas integer not null default 0, proxima_em text not null,
  erro text, resultado text, confianca real, motivo text, via text,
  modelo text, custo_centavos real, latencia_ms integer, julgado_em text
);
create table alerta (
  id integer primary key autoincrement, regra_id text not null,
  zona_id text, ts text not null, enviado integer not null default 0
);
"""


def test_fila_de_versao_antiga_ganha_as_colunas_novas(tmp_path):
    """Atualizar o agente não pode quebrar a fila que já está no disco.

    O esquema usa "create table if not exists", que não mexe em tabela
    existente. Sem a evolução, o primeiro insert depois da atualização
    morreria com "no such column" — numa loja em operação, com fila cheia.
    """
    import sqlite3

    caminho = tmp_path / "fila.db"
    con = sqlite3.connect(caminho)
    con.executescript(ESQUEMA_ANTIGO)
    con.execute(
        "insert into alerta (regra_id, zona_id, ts) values ('r-velha','z1','2026-10-01T10:00:00')"
    )
    con.commit()
    con.close()

    fila = Fila(caminho)
    try:
        assert fila.enfileirar(
            chave="k-nova", regra_id="r1", ponto_id="p1", zona_id="z1",
            prioridade="intermediaria", criterio="c", criterio_versao=1,
            imagem_caminho=tmp_path / "a.jpg", capturado_em=BASE,
            phash="00ff00ff00ff00ff",
        )
        fila.registrar_alerta(
            regra_id="r1", zona_id="z1", ts=BASE, chave="k-nova",
            evento={"idempotenciaKey": "k-nova"},
        )

        # O alerta antigo não tem corpo: não há como remontá-lo, então ele
        # fica de fora em vez de subir pela metade.
        assert [c for _, c in fila.eventos_a_subir()] == [{"idempotenciaKey": "k-nova"}]
        # Mas continua valendo para o silêncio.
        assert fila.ultimo_alerta("r-velha") is not None
    finally:
        fila.fechar()


def test_abrir_a_fila_duas_vezes_nao_repete_a_evolucao(tmp_path):
    caminho = tmp_path / "fila.db"
    Fila(caminho).fechar()
    Fila(caminho).fechar()   # "duplicate column name" se a checagem falhar


def test_eventos_sobem_do_mais_antigo_ao_mais_novo(fila):
    for i, minuto in enumerate([30, 10, 20]):
        fila.registrar_alerta(
            regra_id="r1", zona_id="z1", ts=BASE + timedelta(minutes=minuto),
            chave=f"k{i}", evento={"idempotenciaKey": f"k{i}"},
        )

    ordem = [c["idempotenciaKey"] for _, c in fila.eventos_a_subir()]
    assert ordem == ["k1", "k2", "k0"]


def test_recusado_pela_nuvem_sai_da_fila_mas_fica_registrado(fila):
    fila.registrar_alerta(
        regra_id="r1", zona_id="z1", ts=BASE, chave="k", evento={"idempotenciaKey": "k"}
    )
    (id_, _), = fila.eventos_a_subir()

    fila.marcar_enviados([id_], estado=2)

    assert fila.eventos_a_subir() == []
    assert fila.a_subir() == 0
    # O registro fica: é a prova de que o evento existiu e por que não subiu.
    assert fila.ultimo_alerta("r1") is not None


def test_ultimo_alerta_por_zona_nao_mistura_canais(fila):
    fila.registrar_alerta(regra_id="r1", zona_id="z1", ts=BASE)

    assert fila.ultimo_alerta("r1", "z1") is not None
    assert fila.ultimo_alerta("r1", "z2") is None
