"""O teste dos hambúrgueres, a bancada com memória: a tabela de itens que vai de quadro em quadro, e as fichas no fim.

Nenhuma chamada de verdade: o cliente é o dublê da primeira rodada.
"""

from __future__ import annotations

import csv
from types import SimpleNamespace

import pytest

from ferramentas.repasse import bancada as rb
from ferramentas.repasse import hamburgueres as r2
from ferramentas.repasse import ingredientes as ri

from .test_repasse_com_pedidos import imagens, ninguem
from .test_repasse_hamburgueres import Cliente, montar_pasta


def produto(nome, *ingredientes, categoria="BURGUER"):
    return {"nome": nome, "categoria": categoria, "ficha": {"nome": nome, "ingredientes": [
        {"nome": n, "quantidade": q, "unidade": u} for n, q, u in ingredientes]}}


N01 = (("Pao de dois cortes", 1, "unidade"), ("Carne 56gr", 2, "unidade"), ("Fatia de queijo cheddar", 2, "unidade"),
       ("Alface", 1, "porção"))
N11 = (("Pao de dois cortes", 1, "unidade"), ("Carne 56gr", 4, "unidade"), ("Fatia de queijo cheddar", 4, "unidade"),
       ("Alface", 1, "porção"))
N08 = (("Pão gold mix Prime", 1, "unidade"), ("Carne 120gr", 1, "unidade"), ("Fatia de queijo cheddar", 1, "unidade"),
       ("Maionese vigor 1kg", 1, "porção"), ("Ovo", 1, "unidade"), ("Anel de cebola empanada", 3, "unidade"),
       ("Bacon", 2, "fita"))
FICHAS = {"base": {"produtos": [
    produto("Numero 01", *N01), produto("TRIO 01", *N01, categoria="TRIOS"),
    produto("Numero 11", *N11), produto("Numero 08", *N08),
]}}


def item(n, ingredientes=(), pao="", fechado=False):
    """Um item da tabela como o modelo devolve: ingredientes como nome ou (nome, peças)."""
    def um(v):
        nome, q = v if isinstance(v, tuple) else (v, 0)
        return {"nome": nome, "quantos": q}
    return {"item": n, "ingredientes": [um(v) for v in ingredientes], "pao": pao, "fechado": fechado}


def tabela(*itens, cena="lanche_em_montagem"):
    return {"cena": cena, "itens": list(itens), "motivo": "pão aberto"}


def rodar(pasta, cliente, *, janelas=("19:50-20:01",), teto=100.0, **k):
    linhas = []
    r = rb.repassar(pasta, FICHAS, [r2.janela(j) for j in janelas], cliente, teto_centavos=teto, pessoas=ninguem,
                    dizer=linhas.append, **k)
    return r, linhas


def lanches():
    return r2.agrupar_iguais(r2.produtos_com_ficha(FICHAS))


# ── a montagem ──


def test_a_montagem_junta_as_paradas_seguidas_e_corta_a_que_passa_do_maximo():
    def parada(h):
        return {"na_loja": f"2026-10-12 {h}.000", "recorte": f"{h}.jpg"}

    horas = ["19:50:00", "19:51:00", "19:52:30", "19:56:00", "19:57:00", "20:10:00"]
    m = rb.montagens([parada(h) for h in horas], juntar_s=120, max_s=300)
    assert [[p["na_loja"][11:19] for p in s] for s in m] == [
        ["19:50:00", "19:51:00", "19:52:30"], ["19:56:00", "19:57:00"], ["20:10:00"]]
    m = rb.montagens([parada(h) for h in horas], juntar_s=240, max_s=300)
    assert [[p["na_loja"][11:19] for p in s] for s in m] == [
        ["19:50:00", "19:51:00", "19:52:30"], ["19:56:00", "19:57:00"], ["20:10:00"]], "cortada aos 5 min do começo"
    m = rb.montagens([parada(h) for h in horas], juntar_s=240, max_s=600)
    assert [len(s) for s in m] == [5, 1]


def test_os_quadros_vao_um_a_cada_intervalo_e_no_maximo_tantos():
    """Medido na rodada 9 (14/10/2026): a tabela recomeçava a cada pausa de 2 min; a montagem ficou longa, e quem
    limita o custo é o intervalo entre os quadros."""
    seq = [{"na_loja": f"2026-10-12 {h}.000", "recorte": h} for h in
           ["19:50:00", "19:50:10", "19:50:25", "19:50:40", "19:50:50", "19:51:05"]]
    assert [p["recorte"] for p in rb.espacar(seq, 20, 10)] == ["19:50:00", "19:50:25", "19:50:50"]
    assert [p["recorte"] for p in rb.espacar(seq, 20, 2)] == ["19:50:00", "19:50:50"]
    assert len(rb.espacar(seq, 0, 10)) == 6


# ── a memória da tabela ──


def test_o_nome_que_entrou_nao_sai_e_a_contagem_nao_diminui():
    i = rb.Item(1)
    i.juntar(["Carne 56gr", "Fatia de queijo cheddar"], {"carne 56gr": 1, "fatia de queijo cheddar": 2}, "", False)
    i.juntar(["carne 56GR"], {"carne 56gr": 2}, "", False)
    i.juntar(["Alface"], {"carne 56gr": 1}, "", False)
    assert i.nomes == {"carne 56gr": "Carne 56gr", "fatia de queijo cheddar": "Fatia de queijo cheddar", "alface": "Alface"}
    assert i.quantos == {"carne 56gr": 2, "fatia de queijo cheddar": 2}
    assert i.visto_em == 3


def test_o_pao_do_fechamento_fica_e_o_fechado_nao_reabre():
    i = rb.Item(1)
    i.juntar([], {}, "Pao Brioche", False)
    assert (i.pao, i.fechado) == ("Pao Brioche", False)
    i.juntar([], {}, "Pao de dois cortes", False)
    assert i.pao == "Pao de dois cortes", "antes do fechamento, vale o último visto"
    i.juntar([], {}, "Pao de dois cortes — pão cortado duas vezes", True)
    i.juntar([], {}, "Pao Brioche", False)
    i.juntar([], {}, "", False)
    assert (i.pao, i.fechado, i.pao_no_fechamento) == ("Pao de dois cortes", True, True)
    i.juntar([], {}, "Pão gold mix Prime", True)
    assert i.pao == "Pão gold mix Prime", "outro fechamento vale"


def test_a_tabela_vira_texto_para_a_proxima_pergunta():
    assert rb.texto_da_tabela([]) == "A tabela até a imagem anterior: nenhum lanche ainda."
    um = rb.Item(1)
    um.juntar(["Carne 56gr", "Alface"], {"carne 56gr": 2}, "Pao de dois cortes", True)
    dois = rb.Item(2)
    assert rb.texto_da_tabela([um, dois]) == (
        "A tabela até a imagem anterior:\n"
        "- item 1: Carne 56gr ×2; Alface · pão: Pao de dois cortes · fechado\n"
        "- item 2: só o pão aberto · pão: não definido"
    )


def test_o_que_o_modelo_devolve_entra_na_tabela_pelo_numero():
    itens = [rb.Item(2)]
    rb.aplicar(itens, tabela(
        item(1, [("Carne 120gr", 1)]), item(2, ["Alface"]), "torto", {"item": "x"}, {"item": 0}, item(3), {"sem": 1},
    ))
    assert [i.numero for i in itens] == [1, 2, 3]
    assert itens[0].quantos == {"carne 120gr": 1} and list(itens[1].nomes) == ["alface"]
    rb.aplicar(itens, {"itens": [{"item": 1, "ingredientes": [], "pao": "", "fechado": "sim"}]})
    assert not itens[0].fechado, "fechado só com true de verdade"
    rb.aplicar(itens, {})
    assert len(itens) == 3


# ── as fichas no fim ──


def test_a_cobertura_conta_o_parecido():
    parecidos, _ = ri.grupos_de_parecidos({"molho branco": ["Maionese vigor 1kg"]})
    n08 = next(l for l in lanches() if l["nome"] == "Numero 08")
    assert rb.cobertura(["Ovo", "molho branco", "Bacon"], n08, parecidos) == (3, 7)
    assert rb.cobertura(["Ovo", "molho branco"], n08, {}) == (1, 7)


def test_o_numero_08_sai_pelos_raros_mesmo_sem_o_pao():
    """O exemplo do dono: os ingredientes raros dizem o lanche, com o pão não definido."""
    i = rb.Item(1)
    i.juntar(["Carne 120gr", "Fatia de queijo cheddar", "Maionese vigor 1kg", "Ovo", "Anel de cebola empanada", "Bacon"],
             {"carne 120gr": 1, "ovo": 1, "anel de cebola empanada": 3, "bacon": 2}, "", True)
    ls = lanches()
    a = rb.avaliar(i, ri.vocabulario(ls), ls, ri.pesos_por_raridade(ls), {}, {})
    assert [l["nome"] for l, _ in a.batem] == ["Numero 08"]
    assert [(l["nome"], n, m) for l, _, n, m in a.parecidas][0] == ("Numero 08", 6, 7)
    assert a.frente["nome"] == "Numero 08"
    assert "→ batem 1: Numero 08 · parecidas: Numero 08 6 de 7;" in a.texto()
    assert "pão: não definido · fechado" in a.texto()
    assert (a.falta[0]["nome"], a.falta[1], a.fora_do_padrao) == ("Numero 08", ["Pão gold mix Prime"], False)
    assert a.texto().endswith(" · falta 1 de Numero 08: Pão gold mix Prime (perguntar no quadro ?)")


def test_o_ciclo_de_aprendizado_fora_do_padrao_e_falta_um():
    """O dono, 14/10/2026: a montagem que nenhuma ficha explica é alerta e fica guardada; a que bate com uma ficha a
    menos de um ingrediente vira pergunta, com o quadro."""
    ls = lanches()
    vocab, peso = ri.vocabulario(ls), ri.pesos_por_raridade(ls)

    estranho = rb.Item(1, ultimo_quadro="r007.jpg")
    estranho.juntar(["Carne 56gr", "Ovo"], {}, "", True)
    a = rb.avaliar(estranho, vocab, ls, peso, {}, {})
    assert (a.fora_do_padrao, a.falta) == (True, None)
    assert "FORA DO PADRÃO: nenhuma ficha explica" in a.texto()

    aberto = rb.Item(2)
    aberto.juntar(["Carne 56gr", "Ovo"], {}, "", False)
    assert rb.avaliar(aberto, vocab, ls, peso, {}, {}).fora_do_padrao is False, "aberto, pode ser só o começo"

    sem_alface = rb.Item(3, ultimo_quadro="r009.jpg")
    sem_alface.juntar(["Carne 56gr", "Fatia de queijo cheddar"], {"carne 56gr": 2}, "Pao de dois cortes", True)
    a = rb.avaliar(sem_alface, vocab, ls, peso, {}, {})
    assert (a.falta[0]["nome"], a.falta[1]) == ("Numero 01", ["Alface"])
    assert "falta 1 de Numero 01 (= TRIO 01): Alface (perguntar no quadro r009.jpg)" in a.texto()

    so_carne = rb.Item(4)
    so_carne.juntar(["Carne 56gr"], {}, "", True)
    assert rb.avaliar(so_carne, vocab, ls, peso, {}, {}).falta is None, "faltando dois ou mais, não se pergunta"
    dois_faltando = rb.Item(6)
    dois_faltando.juntar(["Carne 56gr", "Fatia de queijo cheddar"], {}, "", True)
    assert rb.avaliar(dois_faltando, vocab, ls, peso, {}, {}).falta is None, "faltam o pão e a alface"

    sem_alface_aberto = rb.Item(7)
    sem_alface_aberto.juntar(["Carne 56gr", "Fatia de queijo cheddar"], {}, "Pao de dois cortes", False)
    assert rb.avaliar(sem_alface_aberto, vocab, ls, peso, {}, {}).falta is None, "aberto, a alface ainda pode vir"

    so_de_fora = rb.Item(8)
    so_de_fora.juntar(["outro: tomate"], {}, "", True)
    a = rb.avaliar(so_de_fora, vocab, ls, peso, {}, {})
    assert (a.fora, a.fora_do_padrao) == (["outro: tomate"], False), "sem nada da lista, não há padrão a comparar"

    completo = rb.Item(5)
    completo.juntar(["Carne 56gr", "Fatia de queijo cheddar", "Alface"], {}, "Pao de dois cortes", True)
    a = rb.avaliar(completo, vocab, ls, peso, {}, {})
    assert (a.falta, a.fora_do_padrao) == (None, False)


def test_faltando_conta_o_parecido_e_nao_repete():
    ficha = {"nome": "X", "ingredientes": [{"nome": "Ketchup"}, {"nome": "Alface"}, {"nome": "alface "}, {"nome": "Ovo"}]}
    parecidos, _ = ri.grupos_de_parecidos({"molho vermelho": ["Ketchup", "Geleia"]})
    assert rb.faltando(["Geleia"], ficha, parecidos) == ["Alface", "Ovo"]
    assert rb.faltando(["Geleia"], ficha, {}) == ["Ketchup", "Alface", "Ovo"]
    assert rb.cobertura(["Geleia", "Ovo"], ficha, parecidos) == (2, 3)


def test_no_lanche_fechado_a_contagem_exata_separa_o_01_do_11():
    ls = lanches()
    duas = rb.Item(1)
    duas.juntar(["Carne 56gr", "Fatia de queijo cheddar", "Alface"], {"carne 56gr": 2, "fatia de queijo cheddar": 2},
                "Pao de dois cortes", True)
    a = rb.avaliar(duas, ri.vocabulario(ls), ls, ri.pesos_por_raridade(ls), {}, {})
    assert sorted(l["nome"] for l, _ in a.batem) == ["Numero 01", "Numero 11"], "duas carnes cabem nas duas fichas"
    assert [l["nome"] for l in a.exatas] == ["Numero 01"]
    assert "contagem exata: Numero 01 (= TRIO 01)" in a.texto()

    aberta = rb.Item(2)
    aberta.juntar(["Carne 56gr"], {"carne 56gr": 2}, "", False)
    assert rb.avaliar(aberta, ri.vocabulario(ls), ls, ri.pesos_por_raridade(ls), {}, {}).exatas == [], \
        "aberto, ainda pode vir carne"

    tres = rb.Item(3)
    tres.juntar(["Carne 56gr"], {"carne 56gr": 3}, "", True)
    a = rb.avaliar(tres, ri.vocabulario(ls), ls, ri.pesos_por_raridade(ls), {}, {})
    assert [l["nome"] for l, _ in a.batem] == ["Numero 11"] and a.exatas == []

    sem_conta = rb.Item(4)
    sem_conta.juntar(["Alface"], {}, "", True)
    assert rb.avaliar(sem_conta, ri.vocabulario(ls), ls, ri.pesos_por_raridade(ls), {}, {}).exatas == []


def test_o_pao_do_fechamento_entra_na_conta():
    ls = lanches()
    i = rb.Item(1)
    i.juntar(["Fatia de queijo cheddar"], {}, "Pão gold mix Prime", True)
    a = rb.avaliar(i, ri.vocabulario(ls), ls, ri.pesos_por_raridade(ls), {}, {})
    assert a.vistos == ["Fatia de queijo cheddar", "Pão gold mix Prime"]
    assert [l["nome"] for l, _ in a.batem] == ["Numero 08"], "o pão tira o 01 e o 11"


def test_item_vazio_nao_aponta_nada():
    ls = lanches()
    a = rb.avaliar(rb.Item(1), ri.vocabulario(ls), ls, ri.pesos_por_raridade(ls), {}, {})
    assert (a.vistos, a.batem, a.parecidas, a.frente) == ([], [], [], None)
    assert a.texto() == "item 1: só o pão aberto · pão: não definido → batem 0"


# ── a rodada inteira ──


def test_a_tabela_vai_de_quadro_em_quadro_e_a_memoria_e_daqui(tmp_path):
    pasta = montar_pasta(tmp_path, ["19:50:00", "19:51:00", "19:52:00"])
    cliente = Cliente(respostas=[
        tabela(item(1, [("Carne 56gr", 1)]), item(2)),
        tabela(item(1, [("Carne 56gr", 2), ("Fatia de queijo cheddar", 2)]), item(2, [("Carne 56gr", 1)])),
        tabela(item(1, ["Alface"], pao="Pao de dois cortes", fechado=True), cena="lanche_fechado"),
    ])
    da_loja = {"descricoes": {"Ovo": "o ovo frito"}}

    r, linhas = rodar(pasta, cliente, da_loja=da_loja)

    primeiro, segundo, terceiro = cliente.pedidos
    assert primeiro["system"][0]["text"].startswith(rb.INSTRUCOES) and "- Ovo — o ovo frito" in primeiro["system"][0]["text"]
    assert primeiro["tools"] == [rb.FERRAMENTA] and primeiro["max_tokens"] == rb.TETO_DE_SAIDA
    assert len(imagens(primeiro)) == 1, "um quadro por pergunta"
    texto = lambda p: p["messages"][0]["content"][-1]["text"]  # noqa: E731
    assert texto(primeiro).startswith("A tabela até a imagem anterior: nenhum lanche ainda.")
    assert "às 19:50:00 (quadro 1 de 3 desta montagem)" in texto(primeiro)
    assert "- item 1: Carne 56gr ×1 · pão: não definido\n- item 2: só o pão aberto" in texto(segundo)
    assert "- item 1: Carne 56gr ×2; Fatia de queijo cheddar ×2 · pão: não definido" in texto(terceiro)

    [m] = r["feitas"]
    um, dois = m.avaliados
    assert um.item.quantos == {"carne 56gr": 2, "fatia de queijo cheddar": 2}, "o quadro 3 não tirou a carne"
    assert (um.item.pao, um.item.fechado) == ("Pao de dois cortes", True)
    assert [l["nome"] for l in um.exatas] == ["Numero 01"]
    assert (r["itens"], r["comPao"], r["fechados"], r["contagemExataUma"], r["perguntas"]) == (2, 1, 1, 1, 3)
    assert (r["batemUma"], r["batemVarias"], r["nenhumaBate"], r["naFrente"]) == (0, 2, 0, 0), "o 01 e o 11 empatam"
    assert (r["foraDoPadrao"], r["faltaUm"]) == (0, 0)
    assert (um.item.ultimo_quadro, dois.item.ultimo_quadro) == ("r002.jpg", "r001.jpg"), "o quadro em que foi visto"
    assert r["cenas"] == {"lanche_em_montagem": 2, "lanche_fechado": 1}
    assert linhas[0].startswith("19:50:00–19:52:00 · 3 quadros · 3 perguntas · item 1: Carne 56gr ×2;")
    assert " | item 2: Carne 56gr ×1 · pão: não definido → batem 2" in linhas[0]


def test_cada_montagem_comeca_com_a_tabela_vazia_e_os_quadros_sao_espalhados(tmp_path):
    horas = [f"19:50:{s:02d}" for s in range(0, 60, 5)] + ["20:00:00"]
    pasta = montar_pasta(tmp_path, horas)
    cliente = Cliente(respostas=[tabela(item(1, ["Alface"]))] * 6)

    r, _ = rodar(pasta, cliente, quadros=4, intervalo_s=0)

    assert r["montagens"] == 2 and len(cliente.pedidos) == 5
    texto = lambda p: p["messages"][0]["content"][-1]["text"]  # noqa: E731
    assert "(quadro 4 de 4 desta montagem)" in texto(cliente.pedidos[3])
    assert texto(cliente.pedidos[4]).startswith("A tabela até a imagem anterior: nenhum lanche ainda."), \
        "a montagem seguinte não herda a tabela"
    assert [m.quadros for m in r["feitas"]][0] == ["r000.jpg", "r004.jpg", "r007.jpg", "r011.jpg"]


def test_a_resposta_cortada_ou_sem_a_ferramenta_nao_mexe_na_tabela(tmp_path):
    pasta = montar_pasta(tmp_path, ["19:50:00", "19:51:00", "19:52:00"])
    cliente = Cliente(respostas=[tabela(item(1, [("Carne 56gr", 1)])), tabela(item(1, [("Carne 56gr", 9)])), None])
    criar = cliente.messages.create
    vezes = []

    def cortando_a_segunda(**pedido):
        r = criar(**pedido)
        vezes.append(1)
        if len(vezes) == 2:
            r.stop_reason = "max_tokens"
        return r

    cliente.messages = SimpleNamespace(create=cortando_a_segunda)

    r, _ = rodar(pasta, cliente)

    [m] = r["feitas"]
    assert m.itens[0].quantos == {"carne 56gr": 1}
    assert m.erros[0].startswith("cortada no teto de saída") and m.erros[1].startswith("sem resposta")
    assert (m.perguntas, r["erros"]) == (3, 2)
    assert r["gastoCentavos"] == pytest.approx(m.custo_centavos) and m.custo_centavos > 0


def test_o_teto_e_duro_e_para_tudo(tmp_path):
    pasta = montar_pasta(tmp_path, ["19:50:00", "19:51:00", "19:52:00", "19:58:00", "19:59:00"])
    cliente = Cliente(uso=(10_000, 100), respostas=[tabela(item(1))] * 5)

    r, linhas = rodar(pasta, cliente, teto=2.0)

    assert len(cliente.pedidos) == 3
    assert "teto" in r["motivoDoFim"] and len(linhas) == 2
    parada = r["feitas"][1]
    assert (parada.erros, parada.perguntas, r["montagens"]) == (["teto"], 0, 2), "a montagem em que parou fica anotada"


def test_erro_que_repetir_nao_resolve_para_tudo_e_tres_seguidos_tambem(tmp_path):
    from .test_repasse_hamburgueres import erro_chamado

    pasta = montar_pasta(tmp_path, ["19:50:00", "19:51:00", "19:58:00"])
    r, _ = rodar(pasta, Cliente(falhas=[erro_chamado("AuthenticationError")]))
    assert "AuthenticationError" in r["motivoDoFim"] and r["perguntas"] == 0

    pasta2 = montar_pasta(tmp_path / "b", ["19:50:00", "19:51:00", "19:52:00", "19:53:00"])
    falha = erro_chamado("APIConnectionError")
    r, _ = rodar(pasta2, Cliente(falhas=[falha, falha, falha]))
    assert r["motivoDoFim"] == "3 erros seguidos"

    pasta3 = montar_pasta(tmp_path / "c", ["19:50:00", "19:51:00", "19:52:00", "19:53:00"])
    r, _ = rodar(pasta3, Cliente(falhas=[falha, falha, None, falha], respostas=[tabela(item(1))]))
    assert r["motivoDoFim"] == "acabaram as montagens das janelas" and r["perguntas"] == 1, "a resposta zera a conta"


def test_modelo_sem_preco_e_fichas_vazias_nao_rodam(tmp_path):
    pasta = montar_pasta(tmp_path, ["19:50:00"])
    with pytest.raises(ValueError, match="sem preço"):
        rodar(pasta, Cliente(), modelo="claude-que-nao-existe")
    with pytest.raises(ValueError, match="nenhum produto com ficha"):
        rb.repassar(pasta, {"base": {"produtos": []}}, [r2.janela("19:50-20:01")], Cliente(), teto_centavos=1,
                    pessoas=ninguem, dizer=lambda s: None)


def test_o_resultado_e_gravado_na_loja_um_item_por_linha(tmp_path):
    pasta = montar_pasta(tmp_path, ["19:50:00", "19:51:00", "19:58:00"])
    cliente = Cliente(respostas=[tabela(item(1, ["Ovo"]), item(2)), tabela(item(1, ["Bacon"])), tabela()])

    r, _ = rodar(pasta, cliente, saida=pasta / "respostas" / "r9.csv")

    assert (r["batemUma"], r["batemVarias"]) == (1, 0)
    with (pasta / "respostas" / "r9.csv").open(encoding="utf-8") as f:
        linhas = list(csv.DictReader(f))
    assert [(l["de"][11:], l["item"]) for l in linhas] == [("19:50:00", "1"), ("19:50:00", "2"), ("19:58:00", "")]
    assert linhas[0]["quadros"] == "r000.jpg|r001.jpg" and linhas[0]["perguntas"] == "2"
    assert linhas[0]["resultado"].startswith("item 1: Ovo; Bacon · pão: não definido → batem 1: Numero 08")
    assert linhas[2]["resultado"] == "nenhum lanche na tabela"
