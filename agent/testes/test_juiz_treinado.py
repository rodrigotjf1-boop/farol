"""O juiz treinado (23/10/2026): o nome do ingrediente por um classificador treinado nos exemplos da base da loja.

Sem o modelo de verdade: o vetor é o de mentira dos testes do juiz de ingrediente (a cor média, em três números). O que se
protege:

- as 8 vistas (4 giros, com e sem espelho; a primeira é a imagem como veio);
- o classificador: separa o separável, é determinístico, e as classes EQUILIBRADAS não deixam a classe rara sumir;
- os vetores das vistas guardados por sha256 (o modelo só olha o exemplo novo; a guarda de outro modelo não vale);
- menos de 2 nomes: não há o que treinar;
- na consulta: o NOME do ingrediente vem do classificador (o pão nunca), o "é comida?" e as notas vêm do protótipo;
  1 ou 8 chamadas ao modelo por recorte;
- o juiz da loja: com a chave, o treinado; sem ela, o de protótipo de sempre; sem o que treinar, o de protótipo;
- as chaves no ambiente.
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
from farol_agent.juizes import treinado as jt
from farol_agent.juizes.base import ErroDoJuiz

VERMELHO, VERDE, AMARELO, AZUL = (30, 30, 220), (40, 200, 40), (20, 210, 230), (200, 60, 30)


def vetor_de_mentira(img: np.ndarray) -> np.ndarray:
    return ji.normalizar(img.reshape(-1, 3).mean(axis=0).astype(np.float32) + 1.0)


def chapa(cor, lado=40) -> np.ndarray:
    img = np.empty((lado, lado, 3), np.uint8)
    img[:] = cor
    return img


def sha(n: int) -> str:
    return f"{n:064x}"


def test_as_8_vistas_giram_e_espelham():
    img = np.zeros((20, 40, 3), np.uint8)
    img[0, 0] = (255, 0, 0)  # uma marca no canto: ela anda a cada vista
    vs = jt.vistas(img)
    assert len(vs) == 8 and np.array_equal(vs[0], img)
    assert vs[1].shape == (40, 20, 3) and vs[2].shape == (20, 40, 3) and vs[3].shape == (40, 20, 3)
    assert np.array_equal(vs[4], cv2.flip(img, 1))
    assert len({(v.shape, v.tobytes()) for v in vs}) == 8


def _nuvens(n_por, centros, ruido, semente=0):
    rng = np.random.default_rng(semente)
    X, y = [], []
    for nome, (c, n) in centros.items():
        for _ in range(n):
            X.append(np.asarray(c, np.float32) + rng.normal(0, ruido, 3).astype(np.float32))
            y.append(nome)
    return np.stack(X).astype(np.float32), y


def test_o_classificador_separa_o_separavel_e_e_deterministico():
    X, y = _nuvens(20, {"Alface": ([1, 0, 0], 20), "Bacon": ([0, 1, 0], 20), "Queijo": ([0, 0, 1], 20)}, 0.1)
    a = jt.Classificador().ajustar(X, y)
    b = jt.Classificador().ajustar(X, y)
    assert a.classes == ["Alface", "Bacon", "Queijo"]
    p = a.probabilidades(X)
    assert np.allclose(p.sum(axis=1), 1.0, atol=1e-5)
    assert (np.array(a.classes)[p.argmax(axis=1)] == np.array(y)).all()
    assert np.array_equal(a.W, b.W) and np.array_equal(a.b, b.b)
    assert a.probabilidades(np.array([1, 0, 0], np.float32)).shape == (1, 3)


def test_as_classes_equilibradas_nao_deixam_a_rara_sumir():
    # 100 de Alface em volta de 0; 10 de Ovo em volta de 0,8, as duas nuvens se encostando. Sem o equilíbrio, quem está em
    # 0,9 sai Alface (a maioria puxa); com ele, sai Ovo.
    X, y = _nuvens(0, {"Alface": ([0.0, 0, 0], 100), "Ovo": ([0.8, 0, 0], 10)}, 0.6, semente=3)
    clf = jt.Classificador().ajustar(X, y)
    sonda = clf.probabilidades(np.array([0.9, 0, 0], np.float32))[0]
    assert clf.classes[int(sonda.argmax())] == "Ovo"


def test_os_vetores_das_vistas_ficam_guardados_e_o_modelo_so_olha_o_novo(tmp_path: Path):
    imagens = {sha(1): chapa(VERDE), sha(2): chapa(VERMELHO)}
    abertos = []

    def abrir(s):
        abertos.append(s)
        return imagens.get(s)

    chamadas = []

    def vetor(img):
        chamadas.append(1)
        return vetor_de_mentira(img)

    guardados = tmp_path / "vetores-vistas.npz"
    exemplos = [("Alface", sha(1)), ("Bacon", sha(2)), ("Queijo", sha(9))]
    vs = jt.vetores_das_vistas(vetor, exemplos, abrir, guardados=guardados)
    assert [n for n, _ in vs] == ["Alface", "Bacon"] and vs[0][1].shape == (8, 3)
    assert len(chamadas) == 16 and sorted(abertos) == [sha(1), sha(2), sha(9)]
    abertos.clear()
    chamadas.clear()
    de_novo = jt.vetores_das_vistas(vetor, exemplos, abrir, guardados=guardados)
    assert abertos == [sha(9)] and chamadas == []
    assert all(np.allclose(a[1], b[1]) for a, b in zip(vs, de_novo))
    # a guarda de outro modelo não vale: tudo de novo
    with np.load(guardados) as z:
        dados = {k: z[k] for k in z.files}
    dados["modelo"] = np.array("outro")
    np.savez(guardados, **dados)
    abertos.clear()
    jt.vetores_das_vistas(vetor, exemplos, abrir, guardados=guardados)
    assert sorted(abertos) == [sha(1), sha(2), sha(9)]


def test_com_menos_de_dois_nomes_nao_ha_o_que_treinar():
    v8 = np.stack([vetor_de_mentira(chapa(VERDE))] * 8)
    assert jt.treinar([("Alface", v8), ("Alface", v8)]) is None
    assert jt.treinar([]) is None


def _classificador_trocado():
    """Treinado com os nomes TROCADOS: o vermelho é "Alface" e o verde é "Bacon" (o protótipo diz o contrário)."""
    vermelho, verde = vetor_de_mentira(chapa(VERMELHO)), vetor_de_mentira(chapa(VERDE))
    return jt.treinar([("Alface", np.stack([vermelho] * 8)), ("Bacon", np.stack([verde] * 8))])


def test_o_nome_vem_do_classificador_e_o_e_comida_e_as_notas_do_prototipo():
    prot = {"Pão de dois cortes": vetor_de_mentira(chapa(AMARELO)), "Bacon": vetor_de_mentira(chapa(VERMELHO)),
            "Alface": vetor_de_mentira(chapa(VERDE))}
    de_prototipo = ji.JuizDeIngrediente(vetor_de_mentira, prot, comida_min=0.9)
    juiz = jt.JuizTreinado(vetor_de_mentira, prot, _classificador_trocado(), comida_min=0.9)
    antes, n = de_prototipo(chapa(VERMELHO)), juiz(chapa(VERMELHO))
    assert antes.ingrediente == "Bacon" and n.ingrediente == "Alface"
    # o mais parecido de todos, a nota e o "é comida?": os do protótipo
    assert (n.nome, n.nota, n.comida(), n.minimo) == (antes.nome, antes.nota, antes.comida(), 0.9)
    # a nota do ingrediente: a do protótipo DELE (a escala que os passos e a conferência usam)
    esperado = float(prot["Alface"] @ vetor_de_mentira(chapa(VERMELHO)))
    assert n.nota_ingrediente == pytest.approx(esperado, abs=1e-3)
    assert not juiz(chapa((128, 128, 128))).comida()


def test_o_pao_nunca_e_o_ingrediente():
    amarelo, verde = vetor_de_mentira(chapa(AMARELO)), vetor_de_mentira(chapa(VERDE))
    clf = jt.treinar([("Pão de dois cortes", np.stack([amarelo] * 8)), ("Alface", np.stack([verde] * 8))])
    prot = {"Pão de dois cortes": amarelo, "Alface": verde}
    n = jt.JuizTreinado(vetor_de_mentira, prot, clf)(chapa(AMARELO))
    assert n.nome == "Pão de dois cortes" and n.ingrediente == "Alface"


@pytest.mark.parametrize("vistas,chamadas", [(1, 1), (8, 8), (3, 1)])
def test_uma_ou_oito_chamadas_ao_modelo_por_recorte(vistas, chamadas):
    contagem = []

    def vetor(img):
        contagem.append(1)
        return vetor_de_mentira(img)

    prot = {"Bacon": vetor_de_mentira(chapa(VERMELHO)), "Alface": vetor_de_mentira(chapa(VERDE))}
    juiz = jt.JuizTreinado(vetor, prot, _classificador_trocado(), vistas_na_consulta=vistas)
    juiz(chapa(VERMELHO))
    assert len(contagem) == chamadas


class MotorDeMentira:
    def __init__(self, caminho: Path) -> None:
        if not caminho.is_file():
            raise ErroDoJuiz(f"o modelo dos ingredientes não está em {caminho}", recuperavel=False)
        self.vetor = vetor_de_mentira


def _base_em_disco(raiz: Path, impressao: str, itens) -> BaseDaLoja:
    base = BaseDaLoja(raiz)
    (raiz / "quadros").mkdir(parents=True, exist_ok=True)
    lista = {"impressao": impressao, "itens": []}
    for nome, cor, n in itens:
        ok, buf = cv2.imencode(".jpg", chapa(cor))
        dados = buf.tobytes()
        s = hashlib.sha256(dados).hexdigest()
        (raiz / "quadros" / f"{s}.jpg").write_bytes(dados)
        lista["itens"].append({"nome": nome, "visivel": True, "quadros": [{"id": f"q{n}", "sha256": s}]})
    (raiz / "base.json").write_text(json.dumps(lista), encoding="utf-8")
    return base


def _modelos(tmp_path: Path) -> Path:
    modelos = tmp_path / "modelos"
    modelos.mkdir()
    (modelos / ji.MODELO_ARQUIVO).write_bytes(b"x")
    return modelos


def test_o_juiz_da_loja_com_a_chave_e_o_treinado_e_sem_ela_o_de_sempre(tmp_path: Path, caplog):
    modelos = _modelos(tmp_path)
    base = _base_em_disco(tmp_path / "base", "um", [("Alface", VERDE, 1), ("Bacon", VERMELHO, 2), ("Queijo", AMARELO, 3)])
    with caplog.at_level(logging.INFO):
        juiz = ji.JuizDaLoja(modelos, base, motor_de=MotorDeMentira, treinado=True, vistas_na_consulta=8)()
    assert isinstance(juiz, jt.JuizTreinado) and juiz.vistas_na_consulta == 8
    assert juiz.classificador.classes == ["Alface", "Bacon", "Queijo"]
    assert (base.raiz / "vetores-vistas.npz").is_file()
    assert any("juiz TREINADO" in r.message for r in caplog.records)
    assert juiz(chapa(VERDE)).ingrediente == "Alface"
    de_sempre = ji.JuizDaLoja(modelos, base, motor_de=MotorDeMentira)()
    assert type(de_sempre) is ji.JuizDeIngrediente


def test_o_juiz_da_loja_sem_o_que_treinar_fica_no_de_prototipo(tmp_path: Path):
    modelos = _modelos(tmp_path)
    base = _base_em_disco(tmp_path / "base", "um", [("Alface", VERDE, 1)])
    juiz = ji.JuizDaLoja(modelos, base, motor_de=MotorDeMentira, treinado=True)()
    assert type(juiz) is ji.JuizDeIngrediente and juiz.nomes == ["Alface"]


def test_as_chaves_no_ambiente():
    assert bav.juiz_treinado_ligado("1") and bav.juiz_treinado_ligado(" Sim ")
    assert not bav.juiz_treinado_ligado(None) and not bav.juiz_treinado_ligado("0") and not bav.juiz_treinado_ligado("")
    assert jt.vistas_da_consulta("8") == 8
    assert jt.vistas_da_consulta(None) == 1 and jt.vistas_da_consulta("4") == 1 and jt.vistas_da_consulta(" 8 ") == 8
    assert bav.JUIZ_TREINADO == "FAROL_BANCADA_JUIZ_TREINADO"
