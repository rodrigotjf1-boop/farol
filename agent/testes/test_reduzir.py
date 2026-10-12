"""A redução do quadro para a medida de movimento — a mesma, mais barata.

`reduzir` é o que a quietude e a atenção fazem duas vezes por segundo em cada
quadro: recortar a área, apagar o que é de fora do desenho, passar para cinza
e reduzir. O desenho do quadro passou a ser guardado e o cinza a vir antes do
apagar. O que estes testes protegem é que **o resultado é o mesmo, ponto a
ponto** — a medida de movimento já foi calibrada com ele.
"""

from __future__ import annotations

from datetime import datetime

import cv2
import numpy as np
import pytest

from farol_agent import quietude
from farol_agent.modelos import Frame, Zona
from farol_agent.pipeline import recorte
from farol_agent.quietude import reduzir

QUANDO = datetime(2026, 10, 12, 20, 0, 0)

DESENHOS = {
    "a imagem completa": [(0, 0), (1, 0), (1, 1), (0, 1)],
    "um retângulo": [(0.05, 0.30), (0.70, 0.30), (0.70, 0.85), (0.05, 0.85)],
    "um triângulo grande": [(0.1, 0.1), (0.9, 0.1), (0.1, 0.9)],
    "um quadro por pontos": [(0.20, 0.15), (0.55, 0.10), (0.80, 0.40), (0.60, 0.90), (0.25, 0.70)],
    "um quadro pequeno": [(0.40, 0.40), (0.65, 0.40), (0.40, 0.65)],
    "encostado na borda": [(0.0, 0.0), (0.3, 0.0), (0.0, 0.5)],
    "passando da borda": [(0.6, 0.7), (1.0, 0.7), (1.0, 1.0)],
    "sem área nenhuma": [(0.5, 0.5), (0.5, 0.5), (0.5, 0.5)],
}


def do_jeito_de_antes(quadro: Frame, zona: Zona) -> np.ndarray:
    """A conta como era: é a referência de que a de agora não pode se afastar."""
    recortado, dentro = recorte.recortar_area(quadro, zona)
    imagem = recorte.apagar_fora(recortado, dentro).imagem
    cinza = cv2.cvtColor(imagem, cv2.COLOR_BGR2GRAY) if imagem.ndim == 3 else imagem
    return cv2.resize(cinza, (96, 54), interpolation=cv2.INTER_AREA).astype(np.int16)


def quadro(largura: int, altura: int, semente: int, *, colorido: bool = True) -> Frame:
    rng = np.random.default_rng(semente)
    forma = (altura, largura, 3) if colorido else (altura, largura)
    return Frame(rng.integers(0, 256, forma, dtype=np.uint8), QUANDO, "p1", stream="sub")


@pytest.mark.parametrize("nome", DESENHOS)
@pytest.mark.parametrize("tamanho", [(704, 480), (352, 198), (1920, 1080), (97, 55)])
def test_a_reducao_e_ponto_a_ponto_a_de_antes(nome, tamanho):
    zona = Zona(id="z", nome=nome, ponto_id="p1", poligono=DESENHOS[nome])
    for semente in range(3):
        q = quadro(*tamanho, semente)
        assert np.array_equal(reduzir(q, zona), do_jeito_de_antes(q, zona)), f"{nome} em {tamanho}, cena {semente}"


@pytest.mark.parametrize("nome", DESENHOS)
def test_tambem_na_imagem_que_ja_vem_em_cinza(nome):
    zona = Zona(id="z", nome=nome, ponto_id="p1", poligono=DESENHOS[nome])
    q = quadro(704, 480, 5, colorido=False)
    assert np.array_equal(reduzir(q, zona), do_jeito_de_antes(q, zona))


def test_a_imagem_da_fonte_nao_e_alterada():
    """O quadro vem do leitor do fluxo, que o entrega a outros: nada pode ser escrito nele."""
    for colorido in (True, False):
        q = quadro(704, 480, 9, colorido=colorido)
        antes = q.imagem.copy()
        for poligono in DESENHOS.values():
            reduzir(q, Zona(id="z", nome="z", ponto_id="p1", poligono=poligono))
        assert np.array_equal(q.imagem, antes), "colorido" if colorido else "em cinza"


def test_o_que_e_de_fora_do_desenho_nao_conta():
    """Duas cenas que só diferem FORA do triângulo dão a mesma redução; dentro dele, não."""
    zona = Zona(id="z", nome="canto", ponto_id="p1", poligono=DESENHOS["um triângulo grande"])
    a = quadro(704, 480, 1)
    fora, dentro = a.imagem.copy(), a.imagem.copy()
    fora[400:470, 560:690] = 255          # o canto de baixo, à direita: fora do triângulo
    dentro[80:150, 90:220] = 255          # perto do canto de cima, à esquerda: dentro
    assert np.array_equal(reduzir(Frame(fora, QUANDO, "p1"), zona), reduzir(a, zona))
    assert not np.array_equal(reduzir(Frame(dentro, QUANDO, "p1"), zona), reduzir(a, zona))


def test_o_desenho_guardado_e_de_cada_quadro_e_de_cada_tamanho_de_imagem():
    """O mesmo quadro em dois tamanhos de imagem, e dois quadros no mesmo tamanho: cada um com o seu desenho."""
    triangulo = Zona(id="z1", nome="t", ponto_id="p1", poligono=DESENHOS["um triângulo grande"])
    pontos = Zona(id="z2", nome="p", ponto_id="p1", poligono=DESENHOS["um quadro por pontos"])
    quietude._molde.cache_clear()
    # Intercalados, para o desenho de um nunca servir ao outro.
    for _ in range(2):
        for tamanho in ((704, 480), (352, 198)):
            for zona in (triangulo, pontos):
                q = quadro(*tamanho, 2)
                assert np.array_equal(reduzir(q, zona), do_jeito_de_antes(q, zona)), f"{zona.nome} em {tamanho}"
    info = quietude._molde.cache_info()
    assert (info.misses, info.hits) == (4, 4), "quatro desenhos (dois quadros, dois tamanhos), cada um feito uma vez"
    # O desenho guardado é de todas as leituras daquele quadro: ninguém pode escrever nele.
    *_, fora = quietude._molde(tuple(triangulo.poligono), 704, 480)
    assert fora is not None and not fora.flags.writeable


def test_o_desenho_em_lista_e_o_desenho_em_tupla_sao_o_mesmo():
    """A configuração entrega o polígono como listas; os testes, como tuplas. É o mesmo quadro."""
    em_tuplas = Zona(id="z", nome="z", ponto_id="p1", poligono=[(0.1, 0.1), (0.9, 0.1), (0.1, 0.9)])
    em_listas = Zona(id="z", nome="z", ponto_id="p1", poligono=[[0.1, 0.1], [0.9, 0.1], [0.1, 0.9]])
    q = quadro(704, 480, 4)
    quietude._molde.cache_clear()
    assert np.array_equal(reduzir(q, em_tuplas), reduzir(q, em_listas))
    assert quietude._molde.cache_info().misses == 1
