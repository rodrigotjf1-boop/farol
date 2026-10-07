"""O resumo por hora diz ONDE cada análise foi julgada: na loja ou na nuvem.

Pedido do dono em 07/10/2026, vendo os números da primeira noite: "das
análises, quais foram locais e quais foram nuvem", e quanto custaram as da
nuvem. O evento já guardava a via de cada "fora do critério"; o resumo —
que é o que conta TUDO o que foi olhado — só tinha o total e o custo.

"Na loja" é o que roda no computador dela: detector, modelo local e
comparação. Só a via `nuvem` manda a imagem para fora e gera custo por
análise.
"""

from __future__ import annotations

import sqlite3
from datetime import timedelta

import pytest

from farol_agent.contrato import resumo_para_nuvem
from farol_agent.fila import Fila
from farol_agent.modelos import Resultado, Veredito, Via
from testes.conftest import BASE


@pytest.fixture
def fila(tmp_path):
    f = Fila(tmp_path / "fila.db")
    yield f
    f.fechar()


def _veredito(via: Via, resultado=Resultado.CONFORME, custo: float | None = None) -> Veredito:
    return Veredito(resultado=resultado, confianca=0.9, motivo="ok", via=via, modelo="teste", custo_centavos=custo, latencia_ms=100)


def _linha(fila, regra="r1", zona="z1") -> dict:
    achadas = [dict(l) for l in fila._con.execute("select * from resumo_hora") if l["regra_id"] == regra and l["zona_id"] == zona]
    assert len(achadas) == 1, f"esperava uma linha para {regra}/{zona}, achei {len(achadas)}"
    return achadas[0]


@pytest.mark.parametrize(
    ("via", "coluna"),
    [
        (Via.NUVEM, "julgadas_nuvem"),
        (Via.DETECTOR, "julgadas_loja"),
        (Via.LOCAL, "julgadas_loja"),
        (Via.COMPARACAO, "julgadas_loja"),
    ],
)
def test_cada_via_cai_do_lado_certo(fila, via, coluna):
    fila.contar_veredito(BASE, "r1", "z1", _veredito(via), BASE)

    l = _linha(fila)
    outra = "julgadas_loja" if coluna == "julgadas_nuvem" else "julgadas_nuvem"
    assert (l[coluna], l[outra]) == (1, 0)


def test_loja_mais_nuvem_e_a_soma_dos_tres_resultados(fila):
    """Qualquer que seja o resultado: conforme, fora ou "não deu para avaliar"."""
    fila.contar_veredito(BASE, "r1", "z1", _veredito(Via.DETECTOR, Resultado.CONFORME), BASE)
    fila.contar_veredito(BASE, "r1", "z1", _veredito(Via.DETECTOR, Resultado.NAO_CONFORME), BASE)
    fila.contar_veredito(BASE, "r1", "z1", _veredito(Via.NUVEM, Resultado.NAO_AVALIAVEL, custo=1.3), BASE)
    fila.contar_veredito(BASE, "r1", "z1", _veredito(Via.NUVEM, Resultado.CONFORME, custo=1.2), BASE)
    fila.contar_veredito(BASE, "r1", "z1", _veredito(Via.NUVEM, Resultado.NAO_CONFORME, custo=1.4), BASE)

    l = _linha(fila)
    assert (l["julgadas_loja"], l["julgadas_nuvem"]) == (2, 3)
    assert l["julgadas_loja"] + l["julgadas_nuvem"] == l["conformes"] + l["nao_conformes"] + l["nao_avaliaveis"]
    assert l["custo_centavos"] == pytest.approx(3.9)


def test_a_conta_e_por_hora_por_criterio_e_por_area(fila):
    fila.contar_veredito(BASE, "r1", "z1", _veredito(Via.NUVEM), BASE)
    fila.contar_veredito(BASE, "r1", "z2", _veredito(Via.DETECTOR), BASE)
    fila.contar_veredito(BASE + timedelta(hours=1), "r1", "z1", _veredito(Via.DETECTOR), BASE + timedelta(hours=1))

    linhas = {(l["hora"], l["zona_id"]): dict(l) for l in fila._con.execute("select * from resumo_hora")}
    assert linhas[(Fila.hora_de(BASE), "z1")]["julgadas_nuvem"] == 1
    assert linhas[(Fila.hora_de(BASE), "z2")]["julgadas_loja"] == 1
    depois = linhas[(Fila.hora_de(BASE + timedelta(hours=1)), "z1")]
    assert (depois["julgadas_loja"], depois["julgadas_nuvem"]) == (1, 0)


def test_o_que_sobe_para_a_nuvem_leva_os_dois_numeros(fila):
    fila.contar_veredito(BASE, "r1", "z1", _veredito(Via.NUVEM, custo=1.3), BASE)
    fila.contar_veredito(BASE, "r1", "z1", _veredito(Via.DETECTOR), BASE)

    corpo = resumo_para_nuvem(fila.resumos_a_subir()[0])

    assert (corpo["julgadasLoja"], corpo["julgadasNuvem"]) == (1, 1)


# O resumo como era antes desta versão: sem as duas colunas.
_RESUMO_ANTIGO = """
create table resumo_hora (
  hora text not null, regra_id text not null, zona_id text not null,
  capturas integer not null default 0, sem_juiz integer not null default 0,
  sem_quadro integer not null default 0, sem_cena integer not null default 0,
  em_silencio integer not null default 0, repetidas integer not null default 0,
  ja_julgadas integer not null default 0, enfileiradas integer not null default 0,
  conformes integer not null default 0, nao_conformes integer not null default 0,
  nao_avaliaveis integer not null default 0, falhas integer not null default 0,
  alertas integer not null default 0, soma_confianca real not null default 0,
  com_confianca integer not null default 0, soma_latencia_ms integer not null default 0,
  com_latencia integer not null default 0, custo_centavos real not null default 0,
  ultimo_resultado text, ultimo_motivo text, ultimo_impedimento text, ultima_em text,
  versao integer not null default 0, estado integer not null default 1,
  primary key (hora, regra_id, zona_id)
);
"""


def test_a_fila_de_uma_loja_em_operacao_ganha_as_colunas_e_segue(tmp_path):
    """Atualizar o agente não pode quebrar no primeiro julgamento.

    A fila da loja existe há semanas, e `create table if not exists` não
    toca em tabela que já existe. A linha da hora em curso fica com zero
    nos dois lados (ninguém contou a via até ali) e passa a somar dali.
    """
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
        assert (antes["conformes"], antes["julgadas_loja"], antes["julgadas_nuvem"]) == (5, 0, 0)

        fila.contar_veredito(BASE, "r1", "z1", _veredito(Via.NUVEM, custo=1.3), BASE)

        depois = _linha(fila)
        assert (depois["conformes"], depois["julgadas_loja"], depois["julgadas_nuvem"]) == (6, 0, 1)
        # A linha antiga sobe sem erro: os dois números existem, valendo zero e um.
        corpo = resumo_para_nuvem(fila.resumos_a_subir()[0])
        assert corpo["julgadasLoja"] + corpo["julgadasNuvem"] <= corpo["conformes"] + corpo["naoConformes"] + corpo["naoAvaliaveis"]
    finally:
        fila.fechar()
