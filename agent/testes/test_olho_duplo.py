"""O OLHO DUPLO do juiz treinado (24/10/2026): o SigLIP2 ao lado do DINOv2, só para o NOME — `juizes.olho_extra`.

Sem os modelos de verdade: o olho de sempre é a cor média (como nos testes do juiz treinado) e o segundo olho, a cor
média em outra ordem de canais e com outro peso — dois vetores diferentes do mesmo recorte. O que se protege:

- o par tem norma 1 e cada olho pesa o mesmo;
- o classificador aprende sobre o par (a dimensão dos dois), e a guarda dos vetores do par é À PARTE e leva os dois
  modelos — a de um olho só não vale para o par, nem a do par para outro segundo olho;
- o "é comida?", o mais parecido, as notas: os do protótipo do olho de sempre (iguais com e sem o olho duplo); o nome
  vem do classificador do par;
- o juiz da loja: com a chave e o modelo, o olho duplo; com a chave e SEM o modelo, o olho de sempre (dito uma vez); sem
  o juiz treinado, a chave não liga nada; sem a chave, o segundo modelo nem é carregado;
- o modelo só entra conferido pelo sha256; o baixado que não confere não fica;
- a chave no ambiente.
"""

from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path

import cv2
import numpy as np
import pytest

from farol_agent import bancada_ao_vivo as bav
from farol_agent.base_da_loja import BaseDaLoja
from farol_agent.juizes import ingrediente as ji
from farol_agent.juizes import olho_extra as oe
from farol_agent.juizes import treinado as jt
from farol_agent.juizes.base import ErroDoJuiz

VERMELHO, VERDE, AMARELO = (30, 30, 220), (40, 200, 40), (20, 210, 230)


def olho_de_sempre(img: np.ndarray) -> np.ndarray:
    return ji.normalizar(img.reshape(-1, 3).mean(axis=0).astype(np.float32) + 1.0)


def segundo_olho(img: np.ndarray) -> np.ndarray:
    m = img.reshape(-1, 3).mean(axis=0).astype(np.float32)
    return ji.normalizar(np.array([m[2] * 2.0 + 1.0, m[0] + 3.0, m[1] * 0.5 + 1.0, 5.0], np.float32))


def chapa(cor, lado=40) -> np.ndarray:
    img = np.empty((lado, lado, 3), np.uint8)
    img[:] = cor
    return img


def sha(n: int) -> str:
    return f"{n:064x}"


def test_o_par_tem_norma_1_e_cada_olho_pesa_o_mesmo():
    a, b = olho_de_sempre(chapa(VERDE)), segundo_olho(chapa(VERDE))
    par = oe.juntar(a * 3.0, b * 0.5)
    assert par.shape == (3 + 4,) and par.dtype == np.float32
    assert np.linalg.norm(par) == pytest.approx(1.0, abs=1e-6)
    assert np.linalg.norm(par[:3]) == pytest.approx(np.linalg.norm(par[3:]), abs=1e-6)


def test_a_guarda_do_par_e_a_parte_e_leva_os_dois_modelos(tmp_path: Path):
    imagens = {sha(1): chapa(VERDE), sha(2): chapa(VERMELHO), sha(3): chapa(AMARELO)}
    abertos = []

    def abrir(s):
        abertos.append(s)
        return imagens.get(s)

    exemplos = [("Alface", sha(1)), ("Bacon", sha(2)), ("Queijo", sha(3))]
    prot = {n: olho_de_sempre(imagens[s]) for n, s in exemplos}
    guarda = tmp_path / "vetores-vistas-olho-duplo.npz"
    juiz, como = jt.montar(olho_de_sempre, prot, exemplos, abrir, guardados=guarda, vetor_extra=segundo_olho,
                           identidade_extra="siglip-de-mentira")
    assert isinstance(juiz, jt.JuizTreinado) and "OLHO DUPLO" in como
    assert juiz.classificador.W.shape == (3 + 4, 3), "o classificador aprende sobre o par"
    with np.load(guarda) as z:
        assert str(z["modelo"]) == f"{ji.MODELO_SHA256}+siglip-de-mentira" and z["vetores"].shape == (3, 8, 7)
    # de novo, com o mesmo par: o modelo não olha nada
    abertos.clear()
    jt.montar(olho_de_sempre, prot, exemplos, abrir, guardados=guarda, vetor_extra=segundo_olho,
              identidade_extra="siglip-de-mentira")
    assert abertos == []
    # outro segundo olho: a guarda não vale
    jt.montar(olho_de_sempre, prot, exemplos, abrir, guardados=guarda, vetor_extra=segundo_olho, identidade_extra="outro")
    assert sorted(abertos) == [sha(1), sha(2), sha(3)]
    # a guarda de um olho só (a de hoje) não vale para o par
    so_um = tmp_path / "vetores-vistas.npz"
    jt.vetores_das_vistas(olho_de_sempre, exemplos, abrir, guardados=so_um)
    abertos.clear()
    jt.montar(olho_de_sempre, prot, exemplos, abrir, guardados=so_um, vetor_extra=segundo_olho,
              identidade_extra="siglip-de-mentira")
    assert sorted(abertos) == [sha(1), sha(2), sha(3)]


def test_o_olho_duplo_muda_o_nome_e_mais_nada():
    prot = {"Pão de dois cortes": olho_de_sempre(chapa(AMARELO)), "Bacon": olho_de_sempre(chapa(VERMELHO)),
            "Alface": olho_de_sempre(chapa(VERDE))}
    # o classificador do par, treinado com os nomes TROCADOS (o vermelho é "Alface"): é ele que dá o nome
    vermelho = oe.juntar(olho_de_sempre(chapa(VERMELHO)), segundo_olho(chapa(VERMELHO)))
    verde = oe.juntar(olho_de_sempre(chapa(VERDE)), segundo_olho(chapa(VERDE)))
    clf = jt.treinar([("Alface", np.stack([vermelho] * 8)), ("Bacon", np.stack([verde] * 8))])
    de_um = ji.JuizDeIngrediente(olho_de_sempre, prot, comida_min=0.9)
    duplo = jt.JuizTreinado(olho_de_sempre, prot, clf, comida_min=0.9, vetor_extra=segundo_olho)
    antes, n = de_um(chapa(VERMELHO)), duplo(chapa(VERMELHO))
    assert antes.ingrediente == "Bacon" and n.ingrediente == "Alface"
    assert (n.nome, n.nota, n.comida(), n.minimo) == (antes.nome, antes.nota, antes.comida(), 0.9)
    assert n.nota_ingrediente == pytest.approx(float(prot["Alface"] @ olho_de_sempre(chapa(VERMELHO))), abs=1e-3)


@pytest.mark.parametrize("vistas,chamadas", [(1, 1), (8, 8)])
def test_cada_olho_uma_chamada_por_vista(vistas, chamadas):
    conta = {"sempre": 0, "extra": 0}

    def um(img):
        conta["sempre"] += 1
        return olho_de_sempre(img)

    def outro(img):
        conta["extra"] += 1
        return segundo_olho(img)

    prot = {"Bacon": olho_de_sempre(chapa(VERMELHO)), "Alface": olho_de_sempre(chapa(VERDE))}
    clf = jt.treinar([("Bacon", np.stack([oe.juntar(olho_de_sempre(chapa(VERMELHO)), segundo_olho(chapa(VERMELHO)))] * 8)),
                      ("Alface", np.stack([oe.juntar(olho_de_sempre(chapa(VERDE)), segundo_olho(chapa(VERDE)))] * 8))])
    jt.JuizTreinado(um, prot, clf, vistas_na_consulta=vistas, vetor_extra=outro)(chapa(VERMELHO))
    assert conta == {"sempre": chamadas, "extra": chamadas}


class MotorDeMentira:
    def __init__(self, caminho: Path) -> None:
        if not caminho.is_file():
            raise ErroDoJuiz(f"o modelo dos ingredientes não está em {caminho}", recuperavel=False)
        self.vetor = olho_de_sempre


class SegundoDeMentira:
    identidade = "siglip-de-mentira"
    carregados = 0

    def __init__(self, caminho: Path) -> None:
        if not caminho.is_file():
            raise ErroDoJuiz(f"o modelo do olho duplo não está em {caminho}", recuperavel=False)
        SegundoDeMentira.carregados += 1
        self.vetor = segundo_olho


def _base(raiz: Path) -> BaseDaLoja:
    base = BaseDaLoja(raiz)
    (raiz / "quadros").mkdir(parents=True, exist_ok=True)
    lista = {"impressao": "um", "itens": []}
    for n, (nome, cor) in enumerate([("Alface", VERDE), ("Bacon", VERMELHO), ("Queijo", AMARELO)]):
        ok, buf = cv2.imencode(".jpg", chapa(cor))
        dados = buf.tobytes()
        s = hashlib.sha256(dados).hexdigest()
        (raiz / "quadros" / f"{s}.jpg").write_bytes(dados)
        lista["itens"].append({"nome": nome, "visivel": True, "quadros": [{"id": f"q{n}", "sha256": s}]})
    (raiz / "base.json").write_text(json.dumps(lista), encoding="utf-8")
    return base


def _modelos(tmp_path: Path, com_segundo: bool) -> Path:
    modelos = tmp_path / "modelos"
    modelos.mkdir()
    (modelos / ji.MODELO_ARQUIVO).write_bytes(b"x")
    if com_segundo:
        (modelos / oe.ARQUIVO).write_bytes(b"y")
    return modelos


def test_o_juiz_da_loja_com_a_chave_e_o_modelo_usa_o_olho_duplo(tmp_path: Path, caplog):
    base = _base(tmp_path / "base")
    with caplog.at_level(logging.INFO):
        juiz = ji.JuizDaLoja(_modelos(tmp_path, True), base, motor_de=MotorDeMentira, treinado=True, olho_duplo=True,
                             motor_extra_de=SegundoDeMentira)(pode_demorar=True)
    assert isinstance(juiz, jt.JuizTreinado) and juiz.classificador.W.shape[0] == 3 + 4
    assert (base.raiz / "vetores-vistas-olho-duplo.npz").is_file() and not (base.raiz / "vetores-vistas.npz").exists()
    assert any("OLHO DUPLO" in r.message for r in caplog.records)
    assert juiz(chapa(VERDE)).ingrediente == "Alface"


def test_com_a_loja_aberta_o_olho_duplo_nao_calcula_vetor_e_espera_a_loja_fechar(tmp_path: Path, caplog):
    base = _base(tmp_path / "base")
    modelos = _modelos(tmp_path, True)
    juiz_de = ji.JuizDaLoja(modelos, base, motor_de=MotorDeMentira, treinado=True, olho_duplo=True,
                            motor_extra_de=SegundoDeMentira)
    # o primeiro lanche, sem os vetores do par guardados: o olho de sempre, e o registro diz por quê
    with caplog.at_level(logging.INFO):
        um = juiz_de()
    assert isinstance(um, jt.JuizTreinado) and um.classificador.W.shape[0] == 3
    assert not (base.raiz / "vetores-vistas-olho-duplo.npz").exists()
    assert any("se calculam com a loja fechada" in r.message for r in caplog.records)
    assert juiz_de() is um, "o lanche seguinte não recalcula nada"
    # a loja fechou (a descida da base): o par se calcula, mesmo sem a base mudar
    duplo = juiz_de(pode_demorar=True)
    assert duplo is not um and duplo.classificador.W.shape[0] == 3 + 4
    assert juiz_de() is duplo
    # o agente que sobe de novo com a loja aberta: os vetores do par já estão guardados — o olho duplo direto
    de_novo = ji.JuizDaLoja(modelos, base, motor_de=MotorDeMentira, treinado=True, olho_duplo=True,
                            motor_extra_de=SegundoDeMentira)()
    assert de_novo.classificador.W.shape[0] == 3 + 4
    # chega um exemplo novo (a base muda) e o par guardado não o tem: com a loja aberta, volta ao olho de sempre
    lista = json.loads((base.raiz / "base.json").read_text(encoding="utf-8"))
    ok, buf = cv2.imencode(".jpg", chapa((90, 90, 90)))
    s = hashlib.sha256(buf.tobytes()).hexdigest()
    (base.raiz / "quadros" / f"{s}.jpg").write_bytes(buf.tobytes())
    lista["itens"].append({"nome": "Cebola", "visivel": True, "quadros": [{"id": "q9", "sha256": s}]})
    lista["impressao"] = "dois"
    (base.raiz / "base.json").write_text(json.dumps(lista), encoding="utf-8")
    novo = juiz_de()
    assert novo.classificador.W.shape[0] == 3 and "Cebola" in novo.classificador.classes
    assert juiz_de(pode_demorar=True).classificador.W.shape[0] == 3 + 4


def test_sem_o_modelo_fica_o_olho_de_sempre_e_diz_uma_vez(tmp_path: Path, caplog):
    base = _base(tmp_path / "base")
    juiz_de = ji.JuizDaLoja(_modelos(tmp_path, False), base, motor_de=MotorDeMentira, treinado=True, olho_duplo=True,
                            motor_extra_de=SegundoDeMentira)
    with caplog.at_level(logging.INFO):
        juiz = juiz_de()
    assert isinstance(juiz, jt.JuizTreinado) and juiz.classificador.W.shape[0] == 3
    assert (base.raiz / "vetores-vistas.npz").is_file()
    ditos = [r.message for r in caplog.records if "olho duplo fora" in r.message]
    assert len(ditos) == 1 and "não está" in ditos[0]


def test_sem_o_juiz_treinado_ou_sem_a_chave_o_segundo_modelo_nem_carrega(tmp_path: Path):
    SegundoDeMentira.carregados = 0
    base = _base(tmp_path / "base")
    modelos = _modelos(tmp_path, True)
    de_prototipo = ji.JuizDaLoja(modelos, base, motor_de=MotorDeMentira, olho_duplo=True, motor_extra_de=SegundoDeMentira)()
    assert type(de_prototipo) is ji.JuizDeIngrediente
    treinado = ji.JuizDaLoja(modelos, base, motor_de=MotorDeMentira, treinado=True, motor_extra_de=SegundoDeMentira)()
    assert isinstance(treinado, jt.JuizTreinado) and treinado.classificador.W.shape[0] == 3
    assert SegundoDeMentira.carregados == 0


def test_o_modelo_so_entra_conferido_e_o_baixado_errado_nao_fica(tmp_path: Path, monkeypatch):
    with pytest.raises(ErroDoJuiz, match="não está"):
        oe.MotorSiglip(tmp_path / "nao-existe.onnx")
    falso = tmp_path / oe.ARQUIVO
    falso.write_bytes(b"nao e o modelo")
    with pytest.raises(ErroDoJuiz, match="sha256"):
        oe.MotorSiglip(falso)
    falso.unlink()

    class Resposta:
        def __init__(self) -> None:
            self.partes = [b"outro arquivo", b""]

        def read(self, _n):
            return self.partes.pop(0)

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    pedidos = []

    def abrir(req, timeout):
        pedidos.append(req.full_url)
        return Resposta()

    monkeypatch.setattr(oe.urllib.request, "urlopen", abrir)
    with pytest.raises(ErroDoJuiz, match="não é o modelo do olho duplo medido"):
        oe.instalar(tmp_path)
    assert list(tmp_path.iterdir()) == []
    assert pedidos == [oe.URL] and "/resolve/ba1f3b08" in oe.URL, "a revisão do modelo é fixa"


def test_o_preparo_do_siglip():
    img = np.zeros((30, 50, 3), np.uint8)
    img[:] = (0, 128, 255)  # BGR
    x = oe.preparar(img)
    assert x.shape == (1, 3, 224, 224) and x.dtype == np.float32
    # RGB, com média e desvio 0,5: 255 → 1, 128 → ~0, 0 → -1
    assert x[0, 0].mean() == pytest.approx(1.0, abs=1e-3) and x[0, 2].mean() == pytest.approx(-1.0, abs=1e-3)
    assert abs(float(x[0, 1].mean())) < 0.01
    with pytest.raises(ValueError):
        oe.preparar(np.zeros((1, 1, 3), np.uint8))


def test_a_chave_no_ambiente():
    assert bav.OLHO_DUPLO == "FAROL_BANCADA_OLHO_DUPLO"
    assert bav.olho_duplo_ligado("1") and bav.olho_duplo_ligado(" sim ")
    assert not bav.olho_duplo_ligado(None) and not bav.olho_duplo_ligado("0") and not bav.olho_duplo_ligado("")
