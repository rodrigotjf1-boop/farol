"""O teste dos hambúrgueres, rodadas de ingredientes: o que se vê em CADA lanche, e as fichas que batem — conta daqui.

Nenhuma chamada de verdade: o cliente é o dublê da primeira rodada.
"""

from __future__ import annotations

import csv
from types import SimpleNamespace

import pytest

from ferramentas.repasse import hamburgueres as r2
from ferramentas.repasse import ingredientes as ri

from .test_repasse_com_pedidos import imagens, ninguem
from .test_repasse_hamburgueres import TRIO_01, Cliente, com_trio, montar_pasta


def lanches():
    return r2.agrupar_iguais(r2.produtos_com_ficha(com_trio(TRIO_01)))


def resposta(*por_lanche, cena="lanche_em_montagem"):
    """Cada argumento é a lista de ingredientes de um lanche, na ordem esquerda, meio, direita."""
    lugares = ["esquerda", "meio", "direita"]
    return {
        "cena": cena,
        "lanches": [{"onde": lugares[i], "ingredientes_vistos": v} for i, v in enumerate(por_lanche)],
        "confianca": 0.7,
        "motivo": "pão com alface",
    }


def rodar(pasta, cliente, *, janelas=("19:50-20:01",), teto=100.0, **k):
    linhas = []
    r = ri.repassar(pasta, com_trio(TRIO_01), [r2.janela(j) for j in janelas], cliente, teto_centavos=teto,
                    pessoas=ninguem, dizer=linhas.append, **k)
    return r, linhas


def test_o_vocabulario_e_um_nome_por_ingrediente_na_ordem():
    assert ri.vocabulario(lanches()) == ["Alface", "Carne 56gr", "Cebola ao molho shoyo", "Molho especial billy jack"]


def test_o_que_e_da_lista_ganha_o_nome_da_lista_e_o_resto_fica_fora():
    dentro, fora = ri.separar(["alface", "  CARNE 56GR ", "Alface", "outro: tomate", ""], ri.vocabulario(lanches()))
    assert dentro == ["Alface", "Carne 56gr"]
    assert fora == ["outro: tomate"]


def test_batem_as_fichas_que_tem_todos_os_vistos_da_mais_vista_para_a_menos():
    batem = ri.fichas_que_batem(["Carne 56gr"], lanches())
    assert [(l["nome"], round(c, 2)) for l, c in batem] == [("Numero 02", 0.5), ("Numero 01", 0.33)]
    batem = ri.fichas_que_batem(["Alface", "carne 56gr"], lanches())
    assert [l["nome"] for l, _ in batem] == ["Numero 01"]
    assert ri.fichas_que_batem(["Alface", "Cebola ao molho shoyo"], lanches()) == []


def test_sem_ingrediente_visto_nenhuma_ficha_bate():
    assert ri.fichas_que_batem([], lanches()) == []


def test_a_pergunta_leva_o_vocabulario_as_imagens_e_nao_os_lanches(tmp_path):
    pasta = montar_pasta(tmp_path, ["19:52:00", "19:52:10", "19:52:20"])
    cliente = Cliente(respostas=[resposta(["Alface", "Carne 56gr"])])

    r, linhas = rodar(pasta, cliente)

    [feito] = cliente.pedidos
    sistema = feito["system"][0]["text"]
    assert sistema.startswith(ri.INSTRUCOES)
    assert sistema.endswith("- Alface\n- Carne 56gr\n- Cebola ao molho shoyo\n- Molho especial billy jack")
    assert "Numero 01" not in sistema, "o modelo não escolhe o lanche"
    assert feito["tools"] == [ri.FERRAMENTA]
    assert feito["tool_choice"] == {"type": "tool", "name": "responder"}
    assert feito["max_tokens"] == ri.TETO_DE_SAIDA >= 3 * 300, "a lista por lanche passou dos 300 do agente (ERR-116)"
    assert len(imagens(feito)) == 3
    [l] = r["montagens"][0].lanches
    assert (l.onde, l.vistos) == ("esquerda", ["Alface", "Carne 56gr"])
    assert [x["nome"] for x, _ in l.batem] == ["Numero 01"]
    assert "esquerda: Alface, Carne 56gr → batem 1: Numero 01 (= TRIO 01)" in linhas[0]
    assert "pão com alface" not in linhas[0]


def test_dois_lanches_ao_mesmo_tempo_sao_conferidos_cada_um_com_a_sua_ficha(tmp_path):
    """Medido na loja em 14/10/2026: dois lanches montados juntos, e a lista única não batia com ficha nenhuma."""
    pasta = montar_pasta(tmp_path, ["19:52:00"])
    cliente = Cliente(respostas=[resposta(["Alface", "Carne 56gr"], ["Cebola ao molho shoyo"])])

    r, linhas = rodar(pasta, cliente)

    esquerda, meio = r["montagens"][0].lanches
    assert [x["nome"] for x, _ in esquerda.batem] == ["Numero 01"]
    assert [x["nome"] for x, _ in meio.batem] == ["Numero 02"]
    assert r["lanches"] == 2 and r["batemUma"] == 2
    assert " | meio: Cebola ao molho shoyo → batem 1: Numero 02" in linhas[0]


def test_lanche_sem_nada_visto_e_item_que_nao_e_lanche_nao_contam(tmp_path):
    pasta = montar_pasta(tmp_path, ["19:52:00"])
    torto = resposta([], ["Alface"])
    torto["lanches"].insert(0, "alface")
    cliente = Cliente(respostas=[torto])

    r, linhas = rodar(pasta, cliente)

    assert [l.onde for l in r["montagens"][0].lanches] == ["meio"]
    assert r["lanches"] == 1
    assert not r["montagens"][0].erro


def test_o_resumo_conta_por_lanche_uma_varias_e_nenhuma(tmp_path):
    pasta = montar_pasta(tmp_path, ["19:51:00", "19:53:00", "19:55:00"])
    cliente = Cliente(respostas=[
        resposta(["Alface"], ["Carne 56gr"]),                   # só o 01 · os dois
        resposta(["Alface", "Cebola ao molho shoyo"], ["outro: tomate"]),  # nenhum · só fora da lista
        resposta(cena="sem_lanche"),
    ])

    r, _ = rodar(pasta, cliente)

    assert (r["lanches"], r["comIngrediente"], r["batemUma"], r["batemVarias"], r["nenhumaBate"]) == (4, 3, 1, 1, 1)
    assert r["cenas"] == {"lanche_em_montagem": 2, "sem_lanche": 1}


def test_a_resposta_cortada_no_teto_de_saida_e_erro_e_nao_dado(tmp_path):
    """Medido na loja em 14/10/2026 (ERR-116): 2 de 15 respostas pararam no teto de saída; o custo vale, a lista não."""
    pasta = montar_pasta(tmp_path, ["19:51:00", "19:53:00"])
    cliente = Cliente(respostas=[resposta(["Alface"]), resposta(["Carne 56gr"])])
    criar = cliente.messages.create
    vezes = []

    def cortando_a_primeira(**pedido):
        r = criar(**pedido)
        vezes.append(1)
        if len(vezes) == 1:
            r.stop_reason = "max_tokens"
        return r

    cliente.messages = SimpleNamespace(create=cortando_a_primeira)

    r, linhas = rodar(pasta, cliente)

    cortada, inteira = r["montagens"]
    assert cortada.erro.startswith("cortada no teto de saída") and cortada.lanches == []
    assert cortada.custo_centavos > 0 and r["gastoCentavos"] == pytest.approx(cortada.custo_centavos * 2)
    assert [l.vistos for l in inteira.lanches] == [["Carne 56gr"]]
    assert (r["erros"], r["lanches"], len(linhas)) == (1, 1, 1)


def test_o_teto_e_duro(tmp_path):
    pasta = montar_pasta(tmp_path, [f"19:5{i}:00" for i in range(6)])
    cliente = Cliente(uso=(10_000, 100), respostas=[resposta(["Alface"])] * 6)

    r, _ = rodar(pasta, cliente, teto=2.0)

    assert len(cliente.pedidos) == 3
    assert "teto" in r["motivoDoFim"]


def test_modelo_sem_preco_nao_roda(tmp_path):
    pasta = montar_pasta(tmp_path, ["19:52:00"])
    with pytest.raises(ValueError, match="sem preço"):
        rodar(pasta, Cliente(), modelo="claude-que-nao-existe")


def test_o_resultado_e_gravado_na_loja(tmp_path):
    pasta = montar_pasta(tmp_path, ["19:52:00", "19:52:10"])
    cliente = Cliente(respostas=[resposta(["Alface", "outro: tomate"], ["Carne 56gr"])])

    rodar(pasta, cliente, saida=pasta / "respostas" / "r4.csv")

    with (pasta / "respostas" / "r4.csv").open(encoding="utf-8") as f:
        [linha] = list(csv.DictReader(f))
    assert linha["recortes"] == "r000.jpg|r001.jpg"
    assert linha["lanches"] == (
        "esquerda: Alface (fora da lista: outro: tomate) → batem 1: Numero 01 (= TRIO 01)"
        " | meio: Carne 56gr → batem 2: Numero 02; Numero 01 (= TRIO 01)"
    )
    assert linha["motivo"] == "pão com alface"
