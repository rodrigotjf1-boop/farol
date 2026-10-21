"""O juiz de ingrediente (A23.3): a janela de um passo comparada com os protótipos dos ingredientes da base da loja.

Sem o modelo de verdade (24 MB, fora do repositório): o vetor aqui é de mentira — a cor média da imagem, em três números —
e o que se protege é o que vem em volta dele:

- o preparo da imagem (o lado menor a 256, o miolo de 224) e a normalização;
- os exemplos que fazem o protótipo: só os de UM nome, só dos ingredientes que se veem de cima;
- o protótipo é a média dos vetores; os vetores ficam guardados por sha256 e o modelo só olha o exemplo novo; a guarda
  de outro modelo (ou de outra versão) não vale;
- a nota: o mais parecido de todos (pão incluído) e o mais parecido que não é pão; comida pela nota mínima do juiz;
- o juiz da loja: sem a base, sem o modelo ou sem exemplo, nulo (e o motivo dito uma vez); montado uma vez e refeito
  quando a impressão da base muda; o motor carregado uma vez só;
- o modelo só entra conferido pelo sha256, e o baixado que não confere não fica.
"""

from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path

import cv2
import numpy as np
import pytest

from farol_agent.base_da_loja import BaseDaLoja
from farol_agent.juizes import ingrediente as ji
from farol_agent.juizes.base import ErroDoJuiz

VERMELHO, VERDE, AMARELO, MARROM = (30, 30, 220), (40, 200, 40), (20, 210, 230), (40, 80, 130)


def vetor_de_mentira(img: np.ndarray) -> np.ndarray:
    return ji.normalizar(img.reshape(-1, 3).mean(axis=0).astype(np.float32) + 1.0)


def chapa(cor, lado=60) -> np.ndarray:
    img = np.empty((lado, lado, 3), np.uint8)
    img[:] = cor
    return img


def sha(n: int) -> str:
    return f"{n:064x}"


def test_o_preparo_e_o_miolo_de_224_em_rgb_normalizado():
    largo = np.zeros((300, 900, 3), np.uint8)
    largo[:, 300:600] = (0, 0, 255)  # o miolo vermelho; as pontas pretas
    x = ji.preparar(largo)
    assert x.shape == (1, 3, 224, 224) and x.dtype == np.float32
    # RGB: o canal 0 é o vermelho; o lado menor vai a 256 (o maior, a 768), e o miolo de 224 cai inteiro na faixa vermelha
    assert x[0, 0].min() > 2.0 and x[0, 1].max() < -1.9
    with pytest.raises(ValueError):
        ji.preparar(np.zeros((1, 5, 3), np.uint8))


def test_os_exemplos_do_prototipo_sao_os_de_um_nome_so_dos_ingredientes_que_se_veem():
    base = {"itens": [
        {"nome": "Alface", "visivel": True, "quadros": [{"id": "a", "sha256": sha(1)}, {"id": "b", "sha256": sha(2)}]},
        {"nome": "Bacon", "visivel": True, "quadros": [{"id": "c", "sha256": sha(2)}, {"id": "d", "sha256": sha(3)}]},
        {"nome": "Sal", "visivel": False, "quadros": [{"id": "e", "sha256": sha(4)}]},
        {"nome": "Queijo", "visivel": True, "quadros": [{"id": "f", "sha256": None}, {"id": "g"}]},
        "lixo",
    ]}
    # o sha(2) tem dois nomes (a foto larga): fica de fora; o Sal não se vê de cima
    assert ji.exemplos_de_um_nome(base) == [("Alface", sha(1)), ("Bacon", sha(3))]


def test_o_prototipo_e_a_media_e_os_vetores_ficam_guardados(tmp_path: Path):
    imagens = {sha(1): chapa(VERDE), sha(2): chapa((60, 180, 60)), sha(3): chapa(VERMELHO)}
    abertos = []

    def abrir(s):
        abertos.append(s)
        return imagens.get(s)

    guardados = tmp_path / "vetores.json"
    exemplos = [("Alface", sha(1)), ("Alface", sha(2)), ("Tomate", sha(3)), ("Tomate", sha(9))]
    prot = ji.prototipos(vetor_de_mentira, exemplos, abrir, guardados=guardados)
    assert sorted(prot) == ["Alface", "Tomate"]
    esperado = ji.normalizar(vetor_de_mentira(imagens[sha(1)]) + vetor_de_mentira(imagens[sha(2)]))
    assert np.allclose(prot["Alface"], esperado, atol=1e-5)
    assert sorted(abertos) == [sha(1), sha(2), sha(3), sha(9)]
    # a segunda vez, o modelo não olha nada (o sha(9) não abriu e não fica guardado)
    abertos.clear()
    de_novo = ji.prototipos(vetor_de_mentira, exemplos, abrir, guardados=guardados)
    assert abertos == [sha(9)]
    assert all(np.allclose(de_novo[n], prot[n], atol=1e-5) for n in prot)
    # a guarda de outro modelo não vale
    bruto = json.loads(guardados.read_text(encoding="utf-8"))
    bruto["modelo"] = "outro"
    guardados.write_text(json.dumps(bruto), encoding="utf-8")
    abertos.clear()
    ji.prototipos(vetor_de_mentira, exemplos, abrir, guardados=guardados)
    assert sorted(abertos) == [sha(1), sha(2), sha(3), sha(9)]


def test_a_nota_e_o_mais_parecido_e_o_mais_parecido_que_nao_e_pao():
    prot = {"Pão de dois cortes": vetor_de_mentira(chapa(AMARELO)), "Bacon": vetor_de_mentira(chapa(VERMELHO)),
            "Alface": vetor_de_mentira(chapa(VERDE))}
    juiz = ji.JuizDeIngrediente(vetor_de_mentira, prot, comida_min=0.9)
    n = juiz(chapa(AMARELO))
    assert n.nome == "Pão de dois cortes" and n.nota == pytest.approx(1.0, abs=1e-3)
    assert n.ingrediente in ("Bacon", "Alface") and n.nota_ingrediente < n.nota
    assert n.comida() and n.minimo == 0.9
    n = juiz(chapa(VERMELHO))
    assert (n.nome, n.ingrediente) == ("Bacon", "Bacon")
    # o que não parece nada da base: abaixo da nota mínima
    assert not juiz(chapa((128, 128, 128))).comida()
    with pytest.raises(ErroDoJuiz):
        ji.JuizDeIngrediente(vetor_de_mentira, {})


def test_o_pao_pelo_nome_das_fichas():
    assert ji.e_pao("Pão de dois cortes") and ji.e_pao("  PAO Brioche com gergelim") and ji.e_pao("pão")
    assert not ji.e_pao("Alface") and not ji.e_pao("Queijo pão de queijo") and not ji.e_pao(None)


class MotorDeMentira:
    criados = 0

    def __init__(self, caminho: Path) -> None:
        if not caminho.is_file():
            raise ErroDoJuiz(f"o modelo dos ingredientes não está em {caminho}", recuperavel=False)
        MotorDeMentira.criados += 1
        self.vetor = vetor_de_mentira


def _base_em_disco(raiz: Path, impressao: str, itens: list[tuple[str, tuple[int, int, int], int]]) -> BaseDaLoja:
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


def test_o_juiz_da_loja_se_monta_da_base_e_se_refaz_quando_ela_muda(tmp_path: Path, caplog):
    modelos = tmp_path / "modelos"
    base = BaseDaLoja(tmp_path / "base-da-loja")
    MotorDeMentira.criados = 0
    juiz_da_loja = ji.JuizDaLoja(modelos, base, motor_de=MotorDeMentira)
    with caplog.at_level(logging.INFO):
        assert juiz_da_loja() is None and juiz_da_loja() is None
    assert sum("a base da loja ainda não desceu" in r.message for r in caplog.records) == 1
    _base_em_disco(base.raiz, "um", [("Alface", VERDE, 1), ("Bacon", VERMELHO, 2)])
    caplog.clear()
    with caplog.at_level(logging.INFO):
        assert juiz_da_loja() is None  # sem o modelo
    assert any("o modelo dos ingredientes não está" in r.message for r in caplog.records)
    modelos.mkdir()
    (modelos / ji.MODELO_ARQUIVO).write_bytes(b"x")
    juiz = juiz_da_loja()
    assert juiz is not None and juiz.nomes == ["Alface", "Bacon"]
    assert juiz_da_loja() is juiz  # a mesma base: o mesmo juiz
    assert base.vetores.is_file()
    _base_em_disco(base.raiz, "dois", [("Alface", VERDE, 1), ("Bacon", VERMELHO, 2), ("Queijo", AMARELO, 3)])
    novo = juiz_da_loja()
    assert novo is not juiz and novo.nomes == ["Alface", "Bacon", "Queijo"]
    assert MotorDeMentira.criados == 1


def test_o_juiz_da_loja_sem_exemplo_nenhum_fica_de_fora(tmp_path: Path):
    modelos = tmp_path / "modelos"
    modelos.mkdir()
    (modelos / ji.MODELO_ARQUIVO).write_bytes(b"x")
    base = BaseDaLoja(tmp_path / "b")
    base.raiz.mkdir()
    (base.raiz / "base.json").write_text(json.dumps({"impressao": "x", "itens": [{"nome": "Sal", "visivel": False, "quadros": []}]}),
                                         encoding="utf-8")
    assert ji.JuizDaLoja(modelos, base, motor_de=MotorDeMentira)() is None


def test_o_motor_so_entra_conferido_pelo_sha256(tmp_path: Path):
    with pytest.raises(ErroDoJuiz, match="não está"):
        ji.MotorDino(tmp_path / "nao-existe.onnx")
    falso = tmp_path / ji.MODELO_ARQUIVO
    falso.write_bytes(b"nao e o modelo")
    with pytest.raises(ErroDoJuiz, match="sha256"):
        ji.MotorDino(falso)


def test_o_modelo_baixado_que_nao_confere_nao_fica(tmp_path: Path, monkeypatch):
    class Resposta:
        def __init__(self) -> None:
            self.partes = [b"outro arquivo", b""]

        def read(self, _n):
            return self.partes.pop(0)

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(ji.urllib.request, "urlopen", lambda req, timeout: Resposta())
    with pytest.raises(ErroDoJuiz, match="não é o modelo medido"):
        ji.instalar_modelo(tmp_path)
    assert list(tmp_path.iterdir()) == []
