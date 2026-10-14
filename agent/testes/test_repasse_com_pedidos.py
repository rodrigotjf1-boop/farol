"""O teste dos hambúrgueres, segunda rodada: a montagem em sequência, com os pedidos do Regem como candidatos.

Nenhuma chamada de verdade (o cliente é o dublê da primeira rodada); o detector de pessoas é um dublê que diz os
pontos que o teste manda.
"""

from __future__ import annotations

import base64
import csv
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np
import pytest

from farol_agent.juizes.detector import DUVIDA
from farol_agent.pipeline import recorte
from ferramentas.repasse import com_pedidos as rp
from ferramentas.repasse import hamburgueres as r2

from .test_repasse_hamburgueres import RESPOSTA_PADRAO, TRIO_01, Cliente, com_trio, montar_pasta

NOMES = {"Numero 01", "Numero 02", "TRIO 01", "NUmero 03", "Numero 09"}


def pedido(hora: str, descricao: str, quantidade: int = 1) -> rp.Pedido:
    return rp.Pedido(datetime.strptime(f"2026-10-12 {hora}", rp.F), descricao, quantidade)


def lanches(fichas=None):
    return r2.agrupar_iguais(r2.produtos_com_ficha(fichas or com_trio(TRIO_01)))


def ninguem(img):
    return [0.01, 0.02]


def rodar(pasta, cliente, pedidos, *, janelas=("19:50-20:01",), teto=100.0, pessoas=ninguem, fichas=None, **k):
    linhas = []
    r = rp.repassar(
        pasta, fichas or com_trio(TRIO_01), pedidos, [r2.janela(j) for j in janelas], cliente,
        teto_centavos=teto, pessoas=pessoas, dizer=linhas.append, **k,
    )
    return r, linhas


def imagens(pedido_feito) -> list[np.ndarray]:
    blocos = [b for b in pedido_feito["messages"][0]["content"] if b["type"] == "image"]
    return [cv2.imdecode(np.frombuffer(base64.standard_b64decode(b["source"]["data"]), np.uint8), cv2.IMREAD_COLOR) for b in blocos]


# ───────────────────────────── os nomes do pedido ─────────────────────────────


@pytest.mark.parametrize(
    ("descricao", "nome"),
    [
        ("Numero 01", "Numero 01"),
        ("numero  01", "Numero 01"),
        ("Trio 01  + Batata + Refri Lata", "TRIO 01"),
        ("TRIOS 01", "TRIO 01"),
        ("TRIO 1", "TRIO 01"),
        ("NUmero 03", "NUmero 03"),
        ("Número 3", "NUmero 03"),
        ("Numero 09 - 3 Triplo", "Numero 09"),
        ("Dois Mr 02 (Duplo Cheddar) + Batata + Molho + 2 Refri Lata", None),
        ("TRIO 14 Kids", None),
        ("Batata Frita - Grande", None),
    ],
)
def test_o_nome_do_pedido_e_achado_na_ficha_ou_fica_sem(descricao, nome):
    assert rp.nome_na_ficha(descricao, NOMES) == nome


def test_os_candidatos_sao_os_pedidos_dos_minutos_antes_pela_ficha_um_por_lanche():
    pedidos = [
        pedido("19:30:00", "Numero 02"),             # antes da janela de 15 min
        pedido("19:42:00", "TRIOS 01", 2),           # o mesmo lanche do Numero 01
        pedido("19:50:00", "Numero 01"),
        pedido("19:51:00", "Numero 02"),
        pedido("19:52:00", "Dois Mr 02 (Duplo Cheddar)"),  # sem ficha: não é suposto
        pedido("19:58:00", "Numero 02"),             # depois do fim da sequência
    ]
    cands, sem = rp.candidatos(pedidos, datetime(2026, 10, 12, 19, 55), datetime(2026, 10, 12, 19, 56), lanches(), 15)

    assert [(c["nome"], q) for c, q in cands] == [("Numero 01", 3), ("Numero 02", 1)]
    assert sem == ["Dois Mr 02 (Duplo Cheddar) ×1"]


# ───────────────────────────── as sequências ─────────────────────────────


def test_paradas_seguidas_sao_uma_montagem():
    paradas = [{"na_loja": f"2026-10-12 {h}.000"} for h in ("19:50:00", "19:50:30", "19:51:05", "19:53:00", "19:53:20")]
    seqs = rp.sequencias(paradas, 40)
    assert [[p["na_loja"][11:19] for p in s] for s in seqs] == [["19:50:00", "19:50:30", "19:51:05"], ["19:53:00", "19:53:20"]]


def test_espalhar_leva_o_primeiro_e_o_ultimo():
    assert rp.espalhar(list(range(10)), 5) == [0, 2, 4, 7, 9]
    assert rp.espalhar([1, 2, 3], 5) == [1, 2, 3]
    assert rp.espalhar([1, 2, 3], 1) == [2]


# ───────────────────────────── o borrão, como o agente faz na bancada ─────────────────────────────


def bytes_de_teste() -> bytes:
    img = np.full((300, 600, 3), 150, np.uint8)
    return cv2.imencode(".jpg", img)[1].tobytes()


def test_sem_ninguem_a_vista_vai_sem_o_borrao(monkeypatch):
    monkeypatch.setattr(recorte, "borrar_rostos", lambda f: (f.copia_com(np.zeros_like(f.imagem)), True))
    _, borrou = rp.preparar_da_bancada(bytes_de_teste(), ninguem)
    assert borrou is False


@pytest.mark.parametrize("pessoas", [lambda img: [0.1, DUVIDA], None, lambda img: None, lambda img: 1 / 0])
def test_alguem_a_vista_ou_sem_detector_vai_borrado(monkeypatch, pessoas):
    monkeypatch.setattr(recorte, "borrar_rostos", lambda f: (f.copia_com(np.zeros_like(f.imagem)), True))
    b64, borrou = rp.preparar_da_bancada(bytes_de_teste(), pessoas)
    img = cv2.imdecode(np.frombuffer(base64.standard_b64decode(b64), np.uint8), cv2.IMREAD_COLOR)
    assert borrou is True
    assert img.mean() < 5, "foi a imagem sem o borrão"


def test_logo_abaixo_da_duvida_ainda_e_ninguem(monkeypatch):
    monkeypatch.setattr(recorte, "borrar_rostos", lambda f: (f.copia_com(np.zeros_like(f.imagem)), True))
    _, borrou = rp.preparar_da_bancada(bytes_de_teste(), lambda img: [DUVIDA - 0.001])
    assert borrou is False


# ───────────────────────────── a pergunta ─────────────────────────────


def test_a_sequencia_vai_numa_pergunta_so_em_ordem_com_os_candidatos(tmp_path):
    horas = ["19:52:00", "19:52:10", "19:52:20", "19:52:30", "19:52:40", "19:52:50", "19:53:00"]
    pasta = montar_pasta(tmp_path, horas)
    cliente = Cliente()

    r, linhas = rodar(pasta, cliente, [pedido("19:50:00", "Numero 01"), pedido("19:51:00", "Trio 01  + Batata + Refri Lata")], quadros=4)

    [feito] = cliente.pedidos
    assert len(imagens(feito)) == 4
    assert r["perguntas"][0].recortes == ["r000.jpg", "r002.jpg", "r004.jpg", "r006.jpg"]
    texto = feito["messages"][0]["content"][-1]["text"]
    assert texto.startswith("As imagens vão de 19:52:00 a 19:53:00, em ordem. Os lanches pedidos pouco antes (Numero 01 ×2)")
    assert "- Numero 01 (o mesmo lanche vai em: TRIO 01): Carne 56gr (2 unidade)" in texto
    assert "Numero 02" not in texto, "lanche não pedido não é candidato"
    assert feito["tool_choice"] == {"type": "tool", "name": "responder"}
    assert feito["system"][0]["text"] == rp.INSTRUCOES
    assert r["perguntas"][0].produto_candidato is True
    assert "candidatos: Numero 01 ×2" in linhas[0]


def test_sequencia_sem_pedido_com_ficha_antes_nao_e_perguntada(tmp_path):
    pasta = montar_pasta(tmp_path, ["19:52:00", "19:58:00"])
    cliente = Cliente()

    r, _ = rodar(pasta, cliente, [pedido("19:57:00", "Numero 02"), pedido("19:51:00", "Batata Frita - Grande")])

    assert len(cliente.pedidos) == 1, "só a segunda sequência tinha pedido com ficha antes"
    assert r["semCandidato"] == 1
    assert r["perguntas"][0].sem_ficha == "Batata Frita - Grande ×1"


def test_resposta_que_nao_e_candidato_e_marcada(tmp_path):
    pasta = montar_pasta(tmp_path, ["19:52:00"])
    cliente = Cliente(respostas=[dict(RESPOSTA_PADRAO, produto="Numero 02")])

    r, linhas = rodar(pasta, cliente, [pedido("19:50:00", "Numero 01")])

    assert r["perguntas"][0].produto_candidato is False
    assert "(NÃO É CANDIDATO)" in linhas[0]
    assert "alface sobre a carne" not in linhas[0]


def test_a_imagem_da_sequencia_vai_no_lado_maior_de_ate_1568(tmp_path):
    pasta = montar_pasta(tmp_path, ["19:52:00"])
    cliente = Cliente()
    rodar(pasta, cliente, [pedido("19:50:00", "Numero 01")])
    assert imagens(cliente.pedidos[0])[0].shape[1] == 1568


# ───────────────────────────── o teto e os erros ─────────────────────────────


def test_o_teto_e_duro(tmp_path):
    horas = [f"19:5{i}:00" for i in range(6)]  # seis sequências, uma por minuto
    pasta = montar_pasta(tmp_path, horas)
    cliente = Cliente(uso=(10_000, 100))  # 0,567 centavo por pergunta

    r, _ = rodar(pasta, cliente, [pedido("19:49:00", "Numero 01")], teto=2.0)

    assert len(cliente.pedidos) == 3
    assert r["gastoCentavos"] <= 2.0
    assert "teto" in r["motivoDoFim"]


def test_chave_recusada_para_tudo(tmp_path):
    pasta = montar_pasta(tmp_path, ["19:51:00", "19:53:00"])
    cliente = Cliente(falhas=[type("AuthenticationError", (Exception,), {})("não")])

    r, _ = rodar(pasta, cliente, [pedido("19:49:00", "Numero 01")])

    assert len(cliente.pedidos) == 1
    assert "repetir não resolve" in r["motivoDoFim"]


def test_modelo_sem_preco_nao_roda(tmp_path):
    pasta = montar_pasta(tmp_path, ["19:52:00"])
    with pytest.raises(ValueError, match="sem preço"):
        rodar(pasta, Cliente(), [pedido("19:50:00", "Numero 01")], modelo="claude-que-nao-existe")


def test_o_resultado_e_gravado_na_loja(tmp_path):
    pasta = montar_pasta(tmp_path, ["19:52:00", "19:52:10"])
    cliente = Cliente()

    rodar(pasta, cliente, [pedido("19:50:00", "Numero 01")], saida=pasta / "respostas" / "r.csv")

    with (pasta / "respostas" / "r.csv").open(encoding="utf-8") as f:
        [linha] = list(csv.DictReader(f))
    assert linha["recortes"] == "r000.jpg|r001.jpg"
    assert linha["produto"] == "Numero 01"
    assert linha["motivo"] == "alface sobre a carne"


def test_os_pedidos_sao_lidos_do_arquivo(tmp_path):
    arquivo = tmp_path / "pedidos.csv"
    arquivo.write_text('hora,descricao,quantidade\n2026-10-12 19:53:14,Numero 02,1\n2026-10-12 19:53:44,"TRIO 02 ",2\n', encoding="utf-8")
    pedidos = rp.ler_pedidos(arquivo)
    assert [(p.hora.strftime("%H:%M:%S"), p.descricao, p.quantidade) for p in pedidos] == [("19:53:14", "Numero 02", 1), ("19:53:44", "TRIO 02", 2)]
