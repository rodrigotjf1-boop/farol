"""O teste dos hambúrgueres (R2 do repasse): o que vai ao modelo, o que volta, e o teto que não se passa.

Nenhuma chamada de verdade: o cliente é um dublê que anota o pedido e devolve a resposta pela ferramenta, com o uso
de tokens de que a conta do custo precisa.
"""

from __future__ import annotations

import base64
import csv
import json
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np
import pytest

from farol_agent.juizes import nuvem
from farol_agent.pipeline import recorte
from ferramentas.repasse import hamburgueres as r2

FICHAS = {
    "impressao": "abc",
    "base": {
        "formato": 1,
        "produtos": [
            {"nome": "Numero 02", "categoria": "BURGUER", "ficha": {"nome": "Numero 02", "ingredientes": [
                {"nome": "Carne 56gr", "quantidade": 2, "unidade": "unidade"},
                {"nome": "Cebola ao molho shoyo", "quantidade": 35, "unidade": "grama", "preparo": True},
            ]}},
            {"nome": "Coca lata", "categoria": "BEBIDAS", "ficha": None},
            {"nome": "Numero 01", "categoria": "BURGUER", "ficha": {"nome": "Numero 01", "ingredientes": [
                {"nome": "Carne 56gr", "quantidade": 2, "unidade": "unidade"},
                {"nome": "Alface", "quantidade": 1, "unidade": "porção"},
                {"nome": "Molho especial billy jack", "quantidade": 1, "unidade": "porção"},
            ]}},
        ],
    },
}

RESPOSTA_PADRAO = {"cena": "lanche_em_montagem", "produto": "Numero 01", "confianca": 0.8,
                   "ingredientes_vistos": ["Alface", "Carne 56gr"], "motivo": "alface sobre a carne"}


class Cliente:
    """Dublê do `anthropic.Anthropic`: anota cada pedido e devolve a resposta pela ferramenta."""

    def __init__(self, respostas=None, uso=(1000, 50), falhas=None):
        self.pedidos: list[dict] = []
        self.respostas = list(respostas or [])
        self.uso = uso
        self.falhas = list(falhas or [])
        self.messages = SimpleNamespace(create=self._criar)

    def _criar(self, **pedido):
        self.pedidos.append(pedido)
        if self.falhas:
            erro = self.falhas.pop(0)
            if erro is not None:
                raise erro
        dados = self.respostas.pop(0) if self.respostas else RESPOSTA_PADRAO
        conteudo = [] if dados is None else [SimpleNamespace(type="tool_use", name="responder", input=dados)]
        return SimpleNamespace(
            content=conteudo, stop_reason="tool_use",
            usage=SimpleNamespace(input_tokens=self.uso[0], output_tokens=self.uso[1],
                                  cache_creation_input_tokens=0, cache_read_input_tokens=0),
        )


def erro_chamado(nome: str) -> Exception:
    return type(nome, (Exception,), {})("recusado")


def montar_pasta(tmp_path: Path, horas: list[str], *, largura=1907, altura=885) -> Path:
    pasta = tmp_path / "canal-04"
    (pasta / "recortes").mkdir(parents=True)
    with (pasta / "paradas.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["pedaco", "indice", "no_gravador", "na_loja", "mexeu_por_s", "recorte"])
        for i, h in enumerate(horas):
            nome = f"r{i:03d}.jpg"
            img = np.full((altura, largura, 3), 120, np.uint8)
            cv2.circle(img, (largura // 2, altura // 2), 80, (40, 160, 40), -1)
            (pasta / "recortes" / nome).write_bytes(cv2.imencode(".jpg", img)[1].tobytes())
            w.writerow(["p.dav", i, f"2026-10-12 {h}.000", f"2026-10-12 {h}.000", 3.0, nome])
    return pasta


def rodar(pasta, cliente, janelas=("19:50-20:01",), teto=100.0, **k):
    linhas = []
    r = r2.repassar(pasta, FICHAS, [r2.janela(j) for j in janelas], cliente, teto_centavos=teto, dizer=linhas.append, **k)
    return r, linhas


def imagem_do_pedido(pedido) -> np.ndarray:
    bloco = pedido["messages"][0]["content"][0]
    assert bloco["type"] == "image" and bloco["source"]["media_type"] == "image/jpeg"
    return cv2.imdecode(np.frombuffer(base64.standard_b64decode(bloco["source"]["data"]), np.uint8), cv2.IMREAD_COLOR)


# ───────────────────────────── o que perguntar ─────────────────────────────


def test_so_as_paradas_das_janelas_e_na_ordem_da_hora(tmp_path):
    pasta = montar_pasta(tmp_path, ["19:55:00", "19:49:59", "19:50:00", "20:01:00", "22:55:10", "20:00:59"])

    escolhidas = r2.nas_janelas(r2.ler_paradas(pasta), [r2.janela("19:50-20:01"), r2.janela("22:50-22:59")])

    assert [p["na_loja"][11:19] for p in escolhidas] == ["19:50:00", "19:55:00", "20:00:59", "22:55:10"]


def test_parada_sem_recorte_nao_e_perguntada(tmp_path):
    pasta = montar_pasta(tmp_path, ["19:55:00"])
    paradas = r2.ler_paradas(pasta)
    paradas[0]["recorte"] = ""
    assert r2.nas_janelas(paradas, [r2.janela("19:50-20:01")]) == []


def test_janela_torta_e_recusada():
    with pytest.raises(ValueError):
        r2.janela("19h50-20h")


TRIO_01 = {"nome": "TRIO 01", "categoria": "BURGUER + BATATA + REFRI", "ficha": {"nome": "TRIO 01", "ingredientes": [
    {"nome": "Alface", "quantidade": 1, "unidade": "porção"},
    {"nome": "carne 56gr", "quantidade": 2, "unidade": "Unidade"},
    {"nome": "Molho especial billy jack", "quantidade": 1, "unidade": "porção"},
]}}


def com_trio(*extras):
    fichas = json.loads(json.dumps(FICHAS))
    fichas["base"]["produtos"].extend(extras)
    return fichas


def test_o_trio_com_a_mesma_ficha_e_o_mesmo_lanche_e_fica_um_nome_so():
    """O TRIO 01 leva o sanduíche do Numero 01 (fichas de 14/10/2026): mesmos ingredientes, em outra ordem."""
    trio_07 = {"nome": "TRIO 07", "categoria": "OS MAIS PEDIDOS", "ficha": {"nome": "x", "ingredientes": [{"nome": "Bacon", "quantidade": 1, "unidade": "fita"}]}}
    trio_07_de_novo = dict(trio_07, categoria="BURGUER + BATATA + REFRI")
    produtos = r2.agrupar_iguais(r2.produtos_com_ficha(com_trio(TRIO_01, trio_07, trio_07_de_novo)))
    texto = r2.texto_das_fichas(produtos)

    assert [p["nome"] for p in produtos] == ["Numero 01", "Numero 02", "TRIO 07"]
    assert texto.splitlines()[0].startswith("- Numero 01 (o mesmo lanche vai em: TRIO 01): Carne 56gr (2 unidade)")
    assert texto.splitlines()[2] == "- TRIO 07: Bacon (1 fita)", "o mesmo nome duas vezes não vira 'o mesmo lanche vai em'"


def test_o_nome_que_fica_e_o_que_nao_e_trio_mesmo_que_o_trio_venha_antes_no_alfabeto():
    lanche = {"nome": "X-Burg", "categoria": "BURGUER", "ficha": {"nome": "x", "ingredientes": [{"nome": "Blend 150gr", "quantidade": 1, "unidade": "unidade"}]}}
    trio = dict(lanche, nome="TRIO X", categoria="BURGUER + BATATA + REFRI")
    produtos = r2.agrupar_iguais(r2.produtos_com_ficha(com_trio(trio, lanche)))
    assert [p["nome"] for p in produtos][-1] == "X-Burg"
    assert produtos[-1]["mesmo_lanche"] == ["TRIO X"]


def test_ficha_com_quantidade_diferente_e_outro_lanche():
    dobro = json.loads(json.dumps(TRIO_01))
    dobro["ficha"]["ingredientes"][1]["quantidade"] = 4
    produtos = r2.agrupar_iguais(r2.produtos_com_ficha(com_trio(dobro)))
    assert [p["nome"] for p in produtos] == ["Numero 01", "Numero 02", "TRIO 01"]


def test_o_trio_tambem_e_resposta_da_lista(tmp_path):
    pasta = montar_pasta(tmp_path, ["19:55:00"])
    cliente = Cliente(respostas=[dict(RESPOSTA_PADRAO, produto="TRIO 01")])

    r = r2.repassar(pasta, com_trio(TRIO_01), [r2.janela("19:50-20:01")], cliente, teto_centavos=10.0, dizer=lambda s: None)

    assert r["respostas"][0].produto_da_lista is True
    assert "(o mesmo lanche vai em: TRIO 01)" in cliente.pedidos[0]["system"][0]["text"]


def test_as_fichas_vao_todas_as_que_tem_ficha_na_ordem_do_nome_com_as_quantidades():
    produtos = r2.produtos_com_ficha(FICHAS)
    texto = r2.texto_das_fichas(produtos)

    assert [p["nome"] for p in produtos] == ["Numero 01", "Numero 02"]
    assert texto.splitlines() == [
        "- Numero 01: Carne 56gr (2 unidade); Alface (1 porção); Molho especial billy jack (1 porção)",
        "- Numero 02: Carne 56gr (2 unidade); Cebola ao molho shoyo (35 grama)",
    ]


# ───────────────────────────── o pedido ─────────────────────────────


def test_o_pedido_e_o_do_agente_modelo_de_rotina_ferramenta_forcada_e_o_fixo_em_cache(tmp_path):
    pasta = montar_pasta(tmp_path, ["19:55:00"])
    cliente = Cliente()

    rodar(pasta, cliente)

    [pedido] = cliente.pedidos
    assert pedido["model"] == nuvem.MODELO_COM_CONTEXTO == "claude-haiku-5-5"
    assert pedido["tool_choice"] == {"type": "tool", "name": "responder"}
    assert pedido["tools"] == [r2.FERRAMENTA]
    assert pedido["max_tokens"] == nuvem.MAX_TOKENS
    [sistema] = pedido["system"]
    assert sistema["cache_control"] == {"type": "ephemeral"}
    assert sistema["text"].startswith(r2.INSTRUCOES)
    assert "- Numero 01: Carne 56gr (2 unidade); Alface (1 porção)" in sistema["text"]
    assert "Coca lata" not in sistema["text"]
    assert pedido["messages"][0]["content"][1]["text"] == "A bancada às 19:55:00. O que está sendo montado?"


def test_a_imagem_vai_no_lado_maior_de_ate_1568(tmp_path):
    pasta = montar_pasta(tmp_path, ["19:55:00"])
    cliente = Cliente()

    rodar(pasta, cliente)

    img = imagem_do_pedido(cliente.pedidos[0])
    assert img.shape[1] == 1568
    assert img.shape[0] == round(885 * 1568 / 1907)


def test_a_imagem_pequena_vai_como_esta(tmp_path):
    pasta = montar_pasta(tmp_path, ["19:55:00"], largura=640, altura=300)
    cliente = Cliente()

    rodar(pasta, cliente)

    assert imagem_do_pedido(cliente.pedidos[0]).shape[:2] == (300, 640)


def test_com_rosto_vai_o_recorte_borrado(tmp_path, monkeypatch):
    def borrar(frame):
        return frame.copia_com(np.zeros_like(frame.imagem)), True

    monkeypatch.setattr(recorte, "borrar_rostos", borrar)
    pasta = montar_pasta(tmp_path, ["19:55:00"])
    cliente = Cliente()

    r, linhas = rodar(pasta, cliente)

    assert imagem_do_pedido(cliente.pedidos[0]).mean() < 5, "foi o recorte sem o borrão"
    assert r["borradas"] == 1 and r["respostas"][0].borrou is True
    assert "borrado" in linhas[0]


def test_sem_rosto_vai_o_recorte_como_esta(tmp_path, monkeypatch):
    monkeypatch.setattr(recorte, "borrar_rostos", lambda frame: (frame, False))
    pasta = montar_pasta(tmp_path, ["19:55:00"])
    cliente = Cliente()

    r, _ = rodar(pasta, cliente)

    assert imagem_do_pedido(cliente.pedidos[0]).mean() > 50
    assert r["borradas"] == 0


# ───────────────────────────── a resposta ─────────────────────────────


def test_a_resposta_e_lida_e_gravada_na_loja(tmp_path):
    pasta = montar_pasta(tmp_path, ["19:55:00", "19:56:00"])
    fora = dict(RESPOSTA_PADRAO, produto="X-Tudo", confianca=1.7)
    cliente = Cliente(respostas=[RESPOSTA_PADRAO, fora])

    r, linhas = rodar(pasta, cliente, saida=pasta / "respostas" / "teste.csv")

    a, b = r["respostas"]
    assert (a.cena, a.produto, a.confianca, a.produto_da_lista) == ("lanche_em_montagem", "Numero 01", 0.8, True)
    assert a.ingredientes_vistos == "Alface; Carne 56gr"
    assert b.produto_da_lista is False and b.confianca == 1.0
    assert "(FORA DA LISTA)" in linhas[1] and "(FORA DA LISTA)" not in linhas[0]
    assert "alface sobre a carne" not in "\n".join(linhas), "o que o modelo escreve não é impresso"
    with (pasta / "respostas" / "teste.csv").open(encoding="utf-8") as f:
        gravadas = list(csv.DictReader(f))
    assert [g["produto"] for g in gravadas] == ["Numero 01", "X-Tudo"]
    assert gravadas[0]["motivo"] == "alface sobre a carne"
    assert r["produtos"] == {"Numero 01": 1, "X-Tudo": 1}
    assert r["cenas"] == {"lanche_em_montagem": 2}


def test_outro_e_nao_sei_nao_sao_fora_da_lista(tmp_path):
    pasta = montar_pasta(tmp_path, ["19:55:00", "19:56:00"])
    cliente = Cliente(respostas=[dict(RESPOSTA_PADRAO, produto="outro"), dict(RESPOSTA_PADRAO, produto="nao_sei")])

    _, linhas = rodar(pasta, cliente)

    assert not any("FORA DA LISTA" in l for l in linhas)


def test_resposta_sem_a_ferramenta_e_erro_da_parada_e_segue(tmp_path):
    pasta = montar_pasta(tmp_path, ["19:55:00", "19:56:00"])
    cliente = Cliente(respostas=[None, RESPOSTA_PADRAO])

    r, _ = rodar(pasta, cliente)

    assert r["respostas"][0].erro.startswith("sem resposta")
    assert r["respostas"][0].custo_centavos is not None, "a chamada sem a ferramenta também custou"
    assert r["respostas"][1].produto == "Numero 01"
    assert r["perguntadas"] == 2


# ───────────────────────────── o custo e o teto ─────────────────────────────


def test_o_custo_e_a_conta_do_agente():
    uso = SimpleNamespace(input_tokens=1200, output_tokens=80, cache_creation_input_tokens=900, cache_read_input_tokens=3000)
    juiz = SimpleNamespace(dolar=5.4)
    assert r2.custo_centavos("claude-haiku-5-5", uso, 5.4) == nuvem.JuizNuvem._custo(juiz, "claude-haiku-5-5", uso)
    assert r2.custo_centavos("claude-haiku-5-5", uso, 5.4) > 0


def test_o_teto_e_duro(tmp_path):
    # 10.000 tokens de entrada e 100 de saída no Haiku 5.5: 0,567 centavo por pergunta, com o dólar a 5,40.
    pasta = montar_pasta(tmp_path, [f"19:5{i}:00" for i in range(6)])
    cliente = Cliente(uso=(10_000, 100))

    r, _ = rodar(pasta, cliente, teto=2.0)

    assert len(cliente.pedidos) == 3, "a quarta passaria do teto"
    assert r["gastoCentavos"] == pytest.approx(3 * 0.567, abs=1e-3)
    assert r["gastoCentavos"] <= 2.0
    assert "teto" in r["motivoDoFim"]


def test_modelo_sem_preco_nao_roda(tmp_path):
    pasta = montar_pasta(tmp_path, ["19:55:00"])
    with pytest.raises(ValueError, match="sem preço não há teto"):
        rodar(pasta, Cliente(), modelo="claude-que-nao-existe")


def test_fichas_sem_produto_com_ficha_nao_roda(tmp_path):
    pasta = montar_pasta(tmp_path, ["19:55:00"])
    with pytest.raises(ValueError, match="nenhum produto com ficha"):
        r2.repassar(pasta, {"base": {"produtos": []}}, [r2.janela("19:50-20:01")], Cliente(), teto_centavos=1.0, dizer=lambda s: None)


# ───────────────────────────── os erros ─────────────────────────────


def test_chave_recusada_para_tudo(tmp_path):
    pasta = montar_pasta(tmp_path, ["19:55:00", "19:56:00", "19:57:00"])
    cliente = Cliente(falhas=[erro_chamado("AuthenticationError")])

    r, _ = rodar(pasta, cliente)

    assert len(cliente.pedidos) == 1
    assert r["respostas"][0].erro == "AuthenticationError"
    assert "repetir não resolve" in r["motivoDoFim"]


def test_erro_passageiro_conta_e_segue_e_tres_seguidos_param(tmp_path):
    pasta = montar_pasta(tmp_path, [f"19:5{i}:00" for i in range(6)])
    passageiro = erro_chamado("APIConnectionError")
    cliente = Cliente(falhas=[passageiro, None, passageiro, passageiro, passageiro])

    r, _ = rodar(pasta, cliente)

    assert [x.erro for x in r["respostas"]] == ["APIConnectionError", "", "APIConnectionError", "APIConnectionError", "APIConnectionError"]
    assert "3 erros seguidos" in r["motivoDoFim"]


def test_recorte_que_sumiu_e_anotado_e_segue(tmp_path):
    pasta = montar_pasta(tmp_path, ["19:55:00", "19:56:00"])
    (pasta / "recortes" / "r000.jpg").unlink()
    cliente = Cliente()

    r, _ = rodar(pasta, cliente)

    assert r["respostas"][0].erro.startswith("recorte:")
    assert len(cliente.pedidos) == 1


# ───────────────────────────── a linha de comando ─────────────────────────────


def test_sem_chave_nada_e_perguntado(tmp_path, monkeypatch, capsys):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    pasta = montar_pasta(tmp_path, ["19:55:00"])
    arquivo = tmp_path / "fichas.json"
    arquivo.write_text(json.dumps(FICHAS), encoding="utf-8")

    codigo = r2.main([str(pasta), "--fichas", str(arquivo), "--janela", "19:50-20:01", "--teto-centavos", "100"])

    assert codigo == 2
    assert "NÃO há chave" in capsys.readouterr().out
