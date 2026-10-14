"""O teste dos hambúrgueres, a bancada com memória: a tabela de itens que vai de quadro em quadro, e as fichas no fim.

Nenhuma chamada de verdade: o cliente é o dublê da primeira rodada.
"""

from __future__ import annotations

import base64
import csv
from types import SimpleNamespace

import cv2
import numpy as np
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
    assert a.texto().endswith(
        " · falta 1 de Numero 08: Pão gold mix Prime (perguntar no quadro ?) · pelo mais raro: Numero 08 (decidiu: Anel"
        " de cebola empanada) — mais próxima: Numero 08, confere 6 de 7; falta ver: Pão gold mix Prime")


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
    assert (a.pelo_raro, a.proxima, a.confere) == ([], None, None)
    assert a.texto() == "item 1: só o pão aberto · pão: não definido → batem 0"


# ── o jeito do dono (rodada 11): o mais raro decide e a mais próxima sai sempre ──

MUSSARELA = (("Pao Brioche com gergelim mesclado", 1, "unidade"), ("Blend 150gr", 1, "unidade"),
             ("Maionese vigor 1kg", 1, "porção"), ("Disco mussarela empanada", 1, "unidade"),
             ("Geleia de pimenta zafran", 1, "porção"), ("Cebola crispy", 30, "grama"))
COM_PORCAO = {"base": {"produtos": [
    produto("Numero 01", *N01), produto("Numero 11", *N11), produto("Numero 08", *N08),
    produto("Mussarela Burg", *MUSSARELA),
    produto("10 ANEIS DE CEBOLA", ("Anel de cebola empanada", 10, "unidade"), categoria="PORCOES"),
]}}


def avaliar_em(fichas, nomes, quantos=None, pao="", fechado=True, grupos=None):
    ls = r2.agrupar_iguais(r2.produtos_com_ficha(fichas))
    parecidos, nomes_dos_grupos = ri.grupos_de_parecidos(grupos)
    i = rb.Item(1)
    i.juntar(nomes, quantos or {}, pao, fechado)
    return rb.avaliar(i, ri.vocabulario(ls), ls, ri.pesos_por_raridade(ls, parecidos), parecidos, nomes_dos_grupos)


def test_o_molho_de_cor_vale_pelo_grupo_tambem_no_mais_raro():
    a = avaliar_em(COM_PORCAO, ["outro: molho branco"], grupos={"molho branco": ["Maionese vigor 1kg"]})
    assert [l["nome"] for l in a.pelo_raro] == ["Mussarela Burg", "Numero 08"] and a.a_conferir == []
    assert [l["nome"] for l in avaliar_em(COM_PORCAO, ["outro: molho branco"]).pelo_raro] == []


def test_o_mussarela_das_19h57_fica_e_o_disco_lido_como_120_vai_a_conferir():
    """A rodada 10 (14/10/2026): no tampo, a geleia e a cebola crispy; e o blend lido como Carne 120, que só o Numero
    08 tem. A conta antiga diz "nenhuma bate"; a do dono acha o Mussarela e manda o disco a conferir."""
    a = avaliar_em(COM_PORCAO, ["Carne 120gr", "Geleia de pimenta zafran", "Cebola crispy"], {"carne 120gr": 1})
    assert (a.batem, a.fora_do_padrao) == ([], True)
    assert [l["nome"] for l in a.pelo_raro] == ["Mussarela Burg"] and a.proxima["nome"] == "Mussarela Burg"
    assert (a.decidiram, a.a_conferir, a.confere) == (["Cebola crispy"], ["Carne 120gr"], (2, 6))
    assert a.falta_conferir == ["Pao Brioche com gergelim mesclado", "Blend 150gr", "Maionese vigor 1kg",
                                "Disco mussarela empanada"]
    assert a.texto().endswith(
        " · pelo mais raro: Mussarela Burg (decidiu: Cebola crispy) — mais próxima: Mussarela Burg, confere 2 de 6; "
        "falta ver: Pao Brioche com gergelim mesclado, Blend 150gr, Maionese vigor 1kg, Disco mussarela empanada; "
        "fora da ficha (leitura ou adicional): Carne 120gr")


def test_o_anel_de_cebola_leva_ao_08_e_a_porcao_de_aneis_nao_concorre():
    so_o_anel = avaliar_em(COM_PORCAO, ["Anel de cebola empanada"], fechado=False)
    assert [l["nome"] for l in so_o_anel.pelo_raro] == ["Numero 08"], "a porção de anéis não leva pão"
    a = avaliar_em(COM_PORCAO, ["Anel de cebola empanada", "Ovo"], fechado=False)
    assert [l["nome"] for l in a.pelo_raro] == ["Numero 08"], "a porção não leva pão"
    assert (a.confere, a.a_conferir) == ((2, 7), [])
    assert a.falta_conferir == ["Pão gold mix Prime", "Carne 120gr", "Fatia de queijo cheddar", "Maionese vigor 1kg",
                                "Bacon"]
    assert "fora da ficha" not in a.texto()


def test_com_varias_candidatas_a_mais_proxima_e_a_que_tem_mais_da_ficha_visto():
    # carne 56 e alface: o 01 e o 11 têm as duas, de 4 ingredientes cada — empate; desempata a conta das parecidas
    a = avaliar_em(COM_PORCAO, ["Carne 56gr", "Alface"], {"carne 56gr": 4})
    assert [l["nome"] for l in a.pelo_raro] == ["Numero 01", "Numero 11"]
    assert a.proxima["nome"] == "Numero 11", "quatro carnes: a conta das parecidas põe o 11 na frente"
    assert " · pelo mais raro: Numero 01; Numero 11 (decidiu: Alface) — mais próxima: Numero 11, confere 2 de 4" in a.texto()
    # a que tem mais da ficha visto ganha, mesmo atrás na ordem do nome e empatada na conta das parecidas
    fichas = {"base": {"produtos": [
        produto("Alfa", ("Pao Brioche", 1, "unidade"), ("Alface", 1, "porção"), ("Tomate", 1, "porção"),
                ("Picles", 1, "porção"), ("Ovo", 1, "unidade")),
        produto("Beta", ("Pao Brioche", 1, "unidade"), ("Alface", 1, "porção")),
    ]}}
    b = avaliar_em(fichas, ["Alface"], pao="Pao Brioche")
    assert [l["nome"] for l in b.pelo_raro] == ["Alfa", "Beta"]
    assert (b.proxima["nome"], b.confere, b.falta_conferir) == ("Beta", (2, 2), [])


def test_mais_de_quatro_candidatas_diz_quantas_sobraram():
    fichas = {"base": {"produtos": [produto(f"X{n}", ("Pao Brioche", 1, "unidade"), ("Alface", 1, "porção"),
                                            (f"Molho {n}", 1, "porção")) for n in range(6)]}}
    a = avaliar_em(fichas, ["Alface"])
    assert " · pelo mais raro: X0; X1; X2; X3 e mais 2 (decidiu: Alface) — mais próxima: X0, confere 1 de 3" in a.texto()


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
    assert (r["peloMaisRaroUma"], r["comProxima"], r["comBorrao"]) == (1, 1, True)
    with (pasta / "respostas" / "r9.csv").open(encoding="utf-8") as f:
        linhas = list(csv.DictReader(f))
    assert [(l["de"][11:], l["item"]) for l in linhas] == [("19:50:00", "1"), ("19:50:00", "2"), ("19:58:00", "")]
    assert linhas[0]["quadros"] == "r000.jpg|r001.jpg" and linhas[0]["perguntas"] == "2"
    assert linhas[0]["resultado"].startswith("item 1: Ovo; Bacon · pão: não definido → batem 1: Numero 08")
    assert linhas[2]["resultado"] == "nenhum lanche na tabela"


# ── sem o borrão e com as fotos de referência (rodada 11) ──


def test_sem_borrao_nenhum_recorte_e_borrado_nem_com_gente_a_vista(tmp_path, monkeypatch):
    """O dono, 14/10/2026: "retira o borrão de rosto para não atrapalhar" (ERR-056). Só com o pedido dito."""
    from farol_agent.pipeline import recorte

    chamadas = []
    monkeypatch.setattr(recorte, "borrar_rostos", lambda f: (chamadas.append(1), (f, True))[1])
    alguem = lambda img: [0.99]  # noqa: E731
    pasta = montar_pasta(tmp_path, ["19:50:00", "19:51:00"])
    linhas = []
    r = rb.repassar(pasta, FICHAS, [r2.janela("19:50-20:01")], Cliente(respostas=[tabela(item(1))] * 2),
                    teto_centavos=100, pessoas=alguem, com_borrao=False, dizer=linhas.append)
    assert (r["borradas"], r["comBorrao"], chamadas) == (0, False, [])
    assert "borradas" not in linhas[0]

    r = rb.repassar(pasta, FICHAS, [r2.janela("19:50-20:01")], Cliente(respostas=[tabela(item(1))] * 2),
                    teto_centavos=100, pessoas=alguem, dizer=linhas.append)
    assert (r["borradas"], r["comBorrao"], len(chamadas)) == (2, True, 2), "sem o pedido, a regra do agente vale"


def jpg(caminho, largura, altura, cor):
    caminho.write_bytes(cv2.imencode(".jpg", np.full((altura, largura, 3), cor, np.uint8))[1].tobytes())


def test_as_referencias_sao_lidas_da_pasta_pelo_nome_e_reduzidas(tmp_path, monkeypatch):
    pasta = tmp_path / "fotos de referência da loja"
    pasta.mkdir()
    jpg(pasta / "Blend 150gr — assado.jpg", 1000, 600, 60)
    jpg(pasta / "alface.JPEG", 100, 80, 200)
    (pasta / "leia-me.txt").write_text("não é foto", encoding="utf-8")
    refs = rb.ler_referencias(pasta)
    assert [l for l, _ in refs] == ["alface", "Blend 150gr — assado"], "na ordem do nome, sem diferença de maiúscula"
    grande = cv2.imdecode(np.frombuffer(base64.standard_b64decode(refs[1][1]), np.uint8), cv2.IMREAD_COLOR)
    pequena = cv2.imdecode(np.frombuffer(base64.standard_b64decode(refs[0][1]), np.uint8), cv2.IMREAD_COLOR)
    assert (grande.shape[1], grande.shape[0], pequena.shape[1]) == (rb.LADO_DA_REFERENCIA, 192, 100)

    monkeypatch.setattr(rb, "MAX_REFERENCIAS", 1)
    with pytest.raises(ValueError, match="no máximo 1"):
        rb.ler_referencias(pasta)
    (pasta / "quebrada.png").write_bytes(b"isto nao e imagem")
    with pytest.raises(ValueError, match="quebrada.png não é uma imagem"):
        rb.ler_referencias(pasta)


def test_as_referencias_vao_antes_do_quadro_rotuladas_e_em_cache(tmp_path):
    pasta = montar_pasta(tmp_path, ["19:50:00", "19:51:00"])
    refs = [("Blend 150gr — assado", "AAAA"), ("Pao Brioche — topo por fora", "BBBB")]
    cliente = Cliente(respostas=[tabela(item(1))] * 2)

    rodar(pasta, cliente, referencias=refs)

    for pedido in cliente.pedidos:
        conteudo = pedido["messages"][0]["content"]
        assert [b["type"] for b in conteudo] == ["text", "text", "image", "text", "image", "text", "text", "image", "text"]
        assert conteudo[0]["text"].startswith("REFERÊNCIA — 2 fotos desta loja")
        assert (conteudo[1]["text"], conteudo[2]["source"]["data"]) == ("Referência: Blend 150gr — assado", "AAAA")
        assert (conteudo[3]["text"], conteudo[4]["source"]["data"]) == ("Referência: Pao Brioche — topo por fora", "BBBB")
        assert conteudo[5] == {"type": "text", "text": "FIM DAS REFERÊNCIAS.", "cache_control": {"type": "ephemeral"}}
        assert conteudo[6]["text"] == "AGORA A BANCADA:" and conteudo[8]["text"].startswith("A tabela até")
    assert rb.blocos_de_referencia([]) == [] and rb.blocos_de_referencia(None) == []
