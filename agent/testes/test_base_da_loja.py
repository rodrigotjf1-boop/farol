"""A base de conhecimento da loja no computador dela (A21, a parte da loja da T5).

Com uma nuvem de mentira (a lista e os quadros, como no contrato `contratos/base-de-conhecimento.json`). O que se protege:

- a descida baixa só o quadro que falta, guarda pelo sha256 e não guarda o que chega com outro resumo; o 404 de um quadro
  (saiu da base no caminho) não para a descida; o que saiu da lista sai do disco, e a sobra de uma descida que caiu
  também; a lista em disco é trocada de uma vez, e diz se a impressão mudou;
- erro de rede na lista ou num quadro sobe, e a cópia que havia fica como estava;
- a linha de execução: com a loja aberta não desce; sem horário cadastrado não desce (e diz uma vez); com a loja fechada
  desce, e a seguinte só depois de `a_cada_s`; o erro que passa (rede) tenta de novo na volta seguinte, o que não passa
  (401) espera `a_cada_s`; a mesma frase de erro não volta ao registro a cada volta.
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime
from pathlib import Path

import pytest

from farol_agent.base_da_loja import BaseDaLoja, BaseEmFundo
from farol_agent.nuvem import ErroDaNuvem

IMAGENS = {f"q{n}": f"imagem {n}".encode() for n in range(1, 6)}


def resumo(dados: bytes) -> str:
    return hashlib.sha256(dados).hexdigest()


class NuvemDeMentira:
    def __init__(self, ids: list[str], impressao: str = "imp-1") -> None:
        self.ids, self.impressao = ids, impressao
        self.pedidos: list[str] = []
        self.falha_lista: ErroDaNuvem | None = None
        self.falha_quadro: dict[str, ErroDaNuvem] = {}
        self.troca: dict[str, bytes] = {}

    def base_da_loja(self):
        self.pedidos.append("lista")
        if self.falha_lista is not None:
            raise self.falha_lista
        itens = [{"nome": f"Ingrediente {i}", "visivel": True,
                  "quadros": [{"id": i, "origem": "bancada", "sha256": resumo(IMAGENS[i]), "largura": 10, "altura": 10}]}
                 for i in self.ids]
        return {"impressao": self.impressao, "itens": itens + [{"nome": "Sal", "visivel": False, "quadros": []}]}

    def quadro_da_base(self, quadro_id: str) -> bytes:
        self.pedidos.append(quadro_id)
        if quadro_id in self.falha_quadro:
            raise self.falha_quadro[quadro_id]
        return self.troca.get(quadro_id, IMAGENS[quadro_id])


def test_a_descida_baixa_so_o_que_falta_e_guarda_pelo_resumo(tmp_path: Path):
    base = BaseDaLoja(tmp_path / "base-da-loja")
    nuvem = NuvemDeMentira(["q1", "q2", "q3"])
    d = base.descer(nuvem)
    assert (d.itens, d.quadros, d.baixados, d.recusados, d.sumiram, d.apagados, d.mudou) == (4, 3, 3, 0, 0, 0, True)
    for i in ("q1", "q2", "q3"):
        assert base.caminho(resumo(IMAGENS[i])).read_bytes() == IMAGENS[i]
    assert base.impressao() == "imp-1" and len(base.lista()["itens"]) == 4
    # de novo, com um a mais: só ele desce; a impressão igual diz que não mudou
    nuvem.pedidos.clear()
    nuvem.ids = ["q1", "q2", "q3", "q4"]
    d = base.descer(nuvem)
    assert nuvem.pedidos == ["lista", "q4"] and d.baixados == 1 and not d.mudou


def test_o_quadro_com_outro_resumo_nao_fica_e_o_404_nao_para(tmp_path: Path):
    base = BaseDaLoja(tmp_path / "b")
    nuvem = NuvemDeMentira(["q1", "q2", "q3"])
    nuvem.troca["q1"] = b"outra coisa"
    nuvem.falha_quadro["q2"] = ErroDaNuvem("404 em /v1/agentes/base/quadros/q2", recuperavel=False, status=404)
    d = base.descer(nuvem)
    assert (d.baixados, d.recusados, d.sumiram) == (1, 1, 1)
    assert not base.caminho(resumo(IMAGENS["q1"])).exists() and not base.caminho(resumo(IMAGENS["q2"])).exists()
    assert base.caminho(resumo(IMAGENS["q3"])).is_file()
    assert sorted(p.name for p in (base.raiz / "quadros").iterdir()) == [f"{resumo(IMAGENS['q3'])}.jpg"]


def test_o_que_saiu_da_lista_sai_do_disco_e_a_sobra_tambem(tmp_path: Path):
    base = BaseDaLoja(tmp_path / "b")
    nuvem = NuvemDeMentira(["q1", "q2"])
    base.descer(nuvem)
    sobra = base.raiz / "quadros" / f"{resumo(IMAGENS['q5'])}.jpg.novo"
    sobra.write_bytes(b"pela metade")
    alheio = base.raiz / "quadros" / "leia-me.txt"  # o que não é da descida fica
    alheio.write_text("x", encoding="utf-8")
    nuvem.ids, nuvem.impressao = ["q2"], "imp-2"
    d = base.descer(nuvem)
    assert d.apagados == 2 and d.mudou
    assert sorted(p.name for p in (base.raiz / "quadros").iterdir()) == sorted([f"{resumo(IMAGENS['q2'])}.jpg", "leia-me.txt"])
    assert base.impressao() == "imp-2"


def test_erro_de_rede_sobe_e_a_copia_fica_como_estava(tmp_path: Path):
    base = BaseDaLoja(tmp_path / "b")
    nuvem = NuvemDeMentira(["q1"])
    base.descer(nuvem)
    antes = (base.raiz / "base.json").read_text(encoding="utf-8")
    nuvem.ids, nuvem.impressao = ["q1", "q2"], "imp-2"
    nuvem.falha_quadro["q2"] = ErroDaNuvem("não cheguei na nuvem: timed out")
    with pytest.raises(ErroDaNuvem):
        base.descer(nuvem)
    assert (base.raiz / "base.json").read_text(encoding="utf-8") == antes
    nuvem.falha_lista = ErroDaNuvem("a nuvem não respondeu em 15s")
    with pytest.raises(ErroDaNuvem):
        base.descer(nuvem)
    assert base.impressao() == "imp-1"


def test_a_lista_do_contrato_e_lida_como_a_nuvem_manda(tmp_path: Path):
    # o mesmo arquivo que os testes da API leem: as chaves que o agente usa são as do contrato
    contrato = json.loads((Path(__file__).resolve().parents[2] / "contratos" / "base-de-conhecimento.json").read_text(encoding="utf-8"))
    assert {"nome", "visivel", "quadros"} <= set(contrato["lista"]["chavesDoItem"])
    assert {"id", "sha256"} <= set(contrato["lista"]["chavesDoQuadro"])

    class DoContrato:
        def __init__(self) -> None:
            self.pedidos: list[str] = []

        def base_da_loja(self):
            return contrato["lista"]["resposta"]

        def quadro_da_base(self, quadro_id):
            self.pedidos.append(quadro_id)
            return b"os bytes do exemplo"

    nuvem = DoContrato()
    d = BaseDaLoja(tmp_path / "b").descer(nuvem)
    # os dois quadros do exemplo são pedidos pelo id; os resumos do exemplo são de mentira: nenhum fica
    assert (d.itens, d.quadros, d.recusados, d.baixados) == (2, 2, 2, 0)
    assert nuvem.pedidos == ["2b3c4d5e-6f70-4812-9a3b-4c5d6e7f8091", "3c4d5e6f-7081-4923-ab4c-5d6e7f809102"]


def test_a_lista_torta_nao_vale(tmp_path: Path):
    base = BaseDaLoja(tmp_path / "b")
    assert base.lista() is None and base.impressao() is None
    base.raiz.mkdir()
    (base.raiz / "base.json").write_text("{", encoding="utf-8")
    assert base.lista() is None
    (base.raiz / "base.json").write_text(json.dumps({"itens": "x"}), encoding="utf-8")
    assert base.lista() is None
    assert base.abrir("../../segredo") is None


# ───────────────────────── a linha de execução ─────────────────────────

# Todo dia das 19h às 3h (a madrugada é do dia em que a loja abriu: `Janela.contem`).
CONFIG_COM_HORARIO = {"loja": {"horarioFuncionamento": [{"dias": [1, 2, 3, 4, 5, 6, 7], "hora_ini": "19:00", "hora_fim": "03:00"}]},
                      "pontos": []}


class Relogios:
    def __init__(self, quando: datetime) -> None:
        self.quando, self.s = quando, 0.0

    def agora(self) -> float:
        return self.s

    def hora(self) -> datetime:
        return self.quando


def _fundo(tmp_path: Path, config: dict, nuvem, r: Relogios) -> BaseEmFundo:
    caminho = tmp_path / "configuracao.json"
    caminho.write_text(json.dumps(config), encoding="utf-8")
    return BaseEmFundo(nuvem, caminho, relogio=r.hora, agora=r.agora, pausa_s=300, a_cada_s=6 * 3600)


def test_com_a_loja_aberta_nao_desce_e_fechada_desce_a_cada_seis_horas(tmp_path: Path):
    nuvem = NuvemDeMentira(["q1"])
    r = Relogios(datetime(2026, 10, 21, 21, 0))  # aberta
    fundo = _fundo(tmp_path, CONFIG_COM_HORARIO, nuvem, r)
    assert fundo.volta() is None and nuvem.pedidos == []
    r.quando = datetime(2026, 10, 22, 9, 0)  # fechada
    d = fundo.volta()
    assert d is not None and d.baixados == 1
    assert (tmp_path / "base-da-loja" / "base.json").is_file()
    nuvem.pedidos.clear()
    r.s += 3600
    assert fundo.volta() is None and nuvem.pedidos == []
    r.s += 5 * 3600
    assert fundo.volta() is not None and nuvem.pedidos == ["lista"]


def test_sem_horario_cadastrado_nao_desce_e_diz_uma_vez(tmp_path: Path, caplog):
    nuvem = NuvemDeMentira(["q1"])
    fundo = _fundo(tmp_path, {"loja": {}, "pontos": []}, nuvem, Relogios(datetime(2026, 10, 22, 9, 0)))
    with caplog.at_level(logging.INFO):
        assert fundo.volta() is None and fundo.volta() is None
    assert nuvem.pedidos == []
    assert sum("não tem horário de funcionamento" in r.message for r in caplog.records) == 1


def test_o_erro_que_passa_tenta_de_novo_e_o_que_nao_passa_espera(tmp_path: Path, caplog):
    nuvem = NuvemDeMentira(["q1"])
    r = Relogios(datetime(2026, 10, 22, 9, 0))
    fundo = _fundo(tmp_path, CONFIG_COM_HORARIO, nuvem, r)
    nuvem.falha_lista = ErroDaNuvem("não cheguei na nuvem: timed out")
    with caplog.at_level(logging.INFO):
        assert fundo.volta() is None
        r.s += 300
        assert fundo.volta() is None
    assert nuvem.pedidos == ["lista", "lista"]
    assert sum("não desceu agora" in rec.message for rec in caplog.records) == 1
    nuvem.falha_lista = ErroDaNuvem("401 em /v1/agentes/base — token inválido", recuperavel=False, status=401)
    nuvem.pedidos.clear()
    r.s += 300
    assert fundo.volta() is None
    r.s += 300
    assert fundo.volta() is None
    assert nuvem.pedidos == ["lista"]
    nuvem.falha_lista = None
    r.s += 6 * 3600
    assert fundo.volta() is not None
