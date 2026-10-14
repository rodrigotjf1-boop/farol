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
    """Cada argumento é a lista de ingredientes de um lanche, na ordem esquerda, meio, direita: o nome, ou (nome,
    quantas peças)."""
    lugares = ["esquerda", "meio", "direita"]

    def item(v):
        nome, n = v if isinstance(v, tuple) else (v, 0)
        return {"nome": nome, "quantos": n}

    return {
        "cena": cena,
        "lanches": [{"onde": lugares[i], "ingredientes_vistos": [item(x) for x in v]} for i, v in enumerate(por_lanche)],
        "confianca": 0.7,
        "motivo": "pão com alface",
    }


def ficha(nome, *ingredientes):
    """Um lanche já agrupado, como `agrupar_iguais` devolve: (nome do ingrediente, quantidade, unidade)."""
    return {"nome": nome, "ingredientes": [{"nome": n, "quantidade": q, "unidade": u} for n, q, u in ingredientes]}


NUMERO_01 = ficha("Numero 01", ("Carne 56gr", 2, "unidade"), ("Alface", 1, "porção"), ("Pao de dois cortes", 1, "unidade"))
NUMERO_11 = ficha("Numero 11", ("Carne 56gr", 4, "unidade"), ("Alface", 1, "porção"), ("Pao de dois cortes", 1, "unidade"))
NUMERO_04 = ficha("Numero 04", ("Carne 56gr", 2, "unidade"), ("Ketchup", 1, "porção"), ("Pao Brioche", 1, "unidade"))
MUSSARELA = ficha("Mussarela Burg", ("Blend 150gr", 1, "unidade"), ("Geleia de pimenta", 1, "porção"),
                  ("Cebola crispy", 35, "grama"), ("Pao Brioche", 1, "unidade"))
QUATRO = [NUMERO_01, NUMERO_11, NUMERO_04, MUSSARELA]
VERMELHOS = {"molho vermelho": ["Ketchup", "Geleia de pimenta"]}


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

    r, _ = rodar(pasta, cliente, saida=pasta / "respostas" / "r4.csv")

    assert (r["naFrente"], r["comContagem"]) == (1, 0)
    with (pasta / "respostas" / "r4.csv").open(encoding="utf-8") as f:
        [linha] = list(csv.DictReader(f))
    assert linha["recortes"] == "r000.jpg|r001.jpg"
    assert linha["lanches"] == (
        "esquerda: Alface (fora da lista: outro: tomate) → batem 1: Numero 01 (= TRIO 01)"
        " · na frente: Numero 01 (= TRIO 01) (folga 1.4)"
        " | meio: Carne 56gr → batem 2: Numero 02; Numero 01 (= TRIO 01)"
    )
    assert linha["motivo"] == "pão com alface"


# ── desde a sétima rodada: a descrição da loja, as peças contadas, o parecido e a conta das parecidas ──


def test_a_descricao_da_loja_vai_ao_lado_do_nome_e_a_que_nao_tem_ingrediente_e_apontada():
    vocab = ["Alface", "Pão gold mix Prime"]
    descricoes = {"pão GOLD mix prime": " pão de brioche com gergelim mesclado ", "Pão que saiu": "x", "Alface": "  "}
    assert ri.texto_do_vocabulario(vocab, descricoes) == "- Alface\n- Pão gold mix Prime — pão de brioche com gergelim mesclado"
    assert ri.texto_do_vocabulario(vocab) == "- Alface\n- Pão gold mix Prime"
    assert ri.descricoes_sem_ingrediente(vocab, descricoes) == ["Pão que saiu"]


def test_as_pecas_contadas_saem_da_resposta_e_o_texto_tambem_vale():
    nomes, quantos = ri.ler_itens([
        {"nome": "Carne 56gr", "quantos": 2}, {"nome": " carne 56GR", "quantos": 3}, {"nome": "Alface", "quantos": 0},
        "Ketchup", {"nome": "Bacon", "quantos": "duas"}, {"nome": "", "quantos": 4}, {"nome": "Tomate", "quantos": -1},
    ])
    assert nomes == ["Carne 56gr", " carne 56GR", "Alface", "Ketchup", "Bacon", "Tomate"]
    assert quantos == {"carne 56gr": 3}, "nome repetido fica com a maior contagem; o que não é número não conta"


def test_a_ficha_com_menos_pecas_do_que_se_contou_nao_bate_e_o_molho_nao_se_conta():
    def nomes(batem):
        return [l["nome"] for l, _ in batem]

    assert nomes(ri.fichas_que_batem(["Carne 56gr"], QUATRO, {"carne 56gr": 3})) == ["Numero 11"]
    assert nomes(ri.fichas_que_batem(["Carne 56gr"], QUATRO, {"carne 56gr": 2})) == ["Numero 01", "Numero 04", "Numero 11"]
    assert nomes(ri.fichas_que_batem(["Alface"], QUATRO, {"alface": 5})) == ["Numero 01", "Numero 11"], "porção não é peça"
    assert ri.fichas_que_batem(["Carne 56gr"], QUATRO, {"carne 56gr": 5}) == []


def test_a_ficha_que_repete_o_ingrediente_soma_as_pecas():
    dupla = ficha("Dupla", ("Carne 56gr", 2, "unidade"), ("Carne 56gr", 1, "Unidade"), ("Bacon", 2, "fita"))
    assert ri.fichas_que_batem(["Carne 56gr", "Bacon"], [dupla], {"carne 56gr": 3, "bacon": 2}) != []
    assert ri.fichas_que_batem(["Bacon"], [dupla], {"bacon": 3}) == [], "fita também é peça"


def test_o_parecido_vale_e_o_outro_molho_da_cor_vale_como_o_grupo():
    parecidos, grupos = ri.grupos_de_parecidos(VERMELHOS)
    vocab = ri.vocabulario(QUATRO)

    # visto o ketchup, a ficha com a geleia (parecida) bate — e sem o grupo, não
    assert [l["nome"] for l, _ in ri.fichas_que_batem(["Ketchup"], QUATRO, parecidos=parecidos)] == ["Numero 04", "Mussarela Burg"]
    assert [l["nome"] for l, _ in ri.fichas_que_batem(["Ketchup"], QUATRO)] == ["Numero 04"]

    dentro, fora = ri.separar(["Outro:  Molho VERMELHO", "outro: molho roxo", "Alface"], vocab, grupos)
    assert (dentro, fora) == (["molho vermelho", "Alface"], ["outro: molho roxo"])
    dentro, fora = ri.separar(["outro: molho vermelho"], vocab)
    assert (dentro, fora) == ([], ["outro: molho vermelho"]), "sem o arquivo da loja, a cor não vale nada"
    assert [l["nome"] for l, _ in ri.fichas_que_batem(["molho vermelho"], QUATRO, parecidos=parecidos)] == ["Numero 04", "Mussarela Burg"]


def test_grupo_sem_membro_ou_sem_nome_e_ignorado():
    parecidos, grupos = ri.grupos_de_parecidos({"molho branco": [], " ": ["Maionese"], "molho verde": ["", "Maionese verde"]})
    assert grupos == {"molho verde": "molho verde"}
    assert parecidos == {"molho verde": frozenset({"maionese verde"}), "maionese verde": frozenset({"maionese verde"})}


def test_a_conta_das_parecidas_pesa_o_raro_e_aponta_uma_so_na_frente():
    peso = ri.pesos_por_raridade(QUATRO, ri.grupos_de_parecidos(VERMELHOS)[0])
    assert peso["cebola crispy"] > peso["alface"] > peso["carne 56gr"], "a cebola está em 1 ficha, a alface em 2, a carne em 3"
    assert peso["molho vermelho"] == pytest.approx(peso["alface"]), "o grupo vale pelas fichas de qualquer membro"

    parecidas = ri.fichas_parecidas(["Cebola crispy", "Pao de dois cortes"], QUATRO, peso)
    assert parecidas[0][0]["nome"] == "Mussarela Burg", "o raro vence o pão, mesmo com o pão contra"
    assert [round(p, 2) for _, p in parecidas] == [0.51, -0.51, -0.51, -1.9], "o que a ficha não tem tira ponto"
    frente, folga = ri.na_frente(parecidas)
    assert frente["nome"] == "Mussarela Burg" and folga == pytest.approx(1.02, abs=0.01)
    assert ri.na_frente(ri.fichas_parecidas(["Ketchup", "Alface"], [NUMERO_01, MUSSARELA], peso)) == (None, 0.0), \
        "na frente com zero ponto não é na frente"

    # contar mais carnes do que a ficha leva é contra ela
    contra = ri.fichas_parecidas(["Carne 56gr"], QUATRO, peso, {"carne 56gr": 4})
    assert [l["nome"] for l, _ in contra][0] == "Numero 11"
    assert ri.na_frente(contra)[0]["nome"] == "Numero 11"

    # empate na frente, ou nada a favor: nenhuma
    assert ri.na_frente(ri.fichas_parecidas(["Alface"], QUATRO, peso)) == (None, 0.0)
    assert ri.na_frente(ri.fichas_parecidas(["Ketchup"], [NUMERO_01], peso)) == (None, 0.0)
    assert ri.na_frente([]) == (None, 0.0)
    assert ri.na_frente([(NUMERO_04, 0.7)])[0] is NUMERO_04


def test_a_rodada_leva_a_descricao_conta_as_pecas_e_diz_a_da_frente(tmp_path):
    pasta = montar_pasta(tmp_path, ["19:52:00", "19:52:10"])
    cliente = Cliente(respostas=[resposta([("Carne 56gr", 2), "outro: molho branco", "Alface"], [("Carne 56gr", 3)])])
    da_loja = {"descricoes": {"Carne 56gr": "o disco pequeno"}, "parecidos": {"molho branco": ["Molho especial billy jack"]}}

    r, linhas = rodar(pasta, cliente, da_loja=da_loja)

    sistema = cliente.pedidos[0]["system"][0]["text"]
    assert "- Carne 56gr — o disco pequeno\n" in sistema
    assert "outro: molho <cor>" in sistema
    esquerda, meio = r["montagens"][0].lanches
    assert esquerda.vistos == ["Carne 56gr", "molho branco", "Alface"] and esquerda.quantos == {"carne 56gr": 2}
    assert [x["nome"] for x, _ in esquerda.batem] == ["Numero 01"]
    assert "esquerda: Carne 56gr ×2, molho branco, Alface → batem 1: Numero 01 (= TRIO 01) · na frente: Numero 01" in linhas[0]
    assert (meio.batem, meio.frente) == ([], None), "três carnes: nenhuma das fichas leva tantas"
    assert (r["comContagem"], r["naFrente"], r["nenhumaBate"]) == (2, 1, 1)


def test_o_nome_com_a_descricao_copiada_da_lista_vale_pelo_nome():
    """Medido na loja em 14/10/2026 (rodada 7, ERR-117): o modelo devolveu a linha da lista inteira como nome."""
    nomes, quantos = ri.ler_itens([
        {"nome": "Carne 56gr — o disco de carne pequeno", "quantos": 2},
        "Pao de dois cortes — pão cortado duas vezes (três partes: base, meio e topo)",
        {"nome": "X-Salada", "quantos": 0}, {"nome": "Batata - média", "quantos": 0},
    ])
    assert nomes == ["Carne 56gr", "Pao de dois cortes", "X-Salada", "Batata - média"], "o hífen não é o travessão"
    assert quantos == {"carne 56gr": 2}


def test_a_resposta_no_formato_antigo_ainda_e_lida(tmp_path):
    pasta = montar_pasta(tmp_path, ["19:52:00"])
    antiga = {"cena": "lanche_em_montagem", "lanches": [{"onde": "meio", "ingredientes_vistos": ["Alface", "Carne 56gr"]}],
              "confianca": 0.5, "motivo": "x"}

    r, _ = rodar(pasta, Cliente(respostas=[antiga]))

    [l] = r["montagens"][0].lanches
    assert (l.vistos, l.quantos, r["comContagem"]) == (["Alface", "Carne 56gr"], {}, 0)
