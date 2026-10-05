"""Guarda o ERR-001: acento no caminho.

O `cv2.imread` e o `cv2.imwrite` usam a API ANSI do Windows e falham em
SILÊNCIO quando o caminho tem caractere fora do cp1252 — `None` e `False`,
sem exceção. O agente roda em PC de loja, onde a pasta do usuário costuma
ser o nome da pessoa (`C:\\Users\\João`), e o spool fica embaixo dela.

O sintoma seria "não aparece alerta nenhum", que não aponta para lugar
nenhum. Este teste existe para que isso nunca mais passe despercebido.
"""

from __future__ import annotations

import cv2
import numpy as np
import pytest

from farol_agent import imagens


@pytest.fixture
def pasta_com_acento(tmp_path):
    p = tmp_path / "João" / "Usuário" / "ação"
    p.mkdir(parents=True)
    return p


def test_grava_e_le_em_caminho_com_acento(pasta_com_acento):
    alvo = pasta_com_acento / "quadro.jpg"
    original = np.full((32, 48, 3), 90, dtype=np.uint8)

    assert imagens.escrever(alvo, original) is True
    assert alvo.is_file()

    lida = imagens.ler(alvo)
    assert lida is not None
    assert lida.shape == original.shape


def test_opencv_cru_falha_no_mesmo_caminho(pasta_com_acento):
    """Documenta POR QUE o módulo existe.

    Se um dia o OpenCV passar a lidar com Unicode no Windows, este teste
    falha — e aí a descoberta é boa notícia, não defeito.
    """
    alvo = pasta_com_acento / "cru.jpg"
    imagem = np.full((16, 16, 3), 200, dtype=np.uint8)

    gravou = cv2.imwrite(str(alvo), imagem)
    if gravou and alvo.is_file():
        pytest.skip("este OpenCV já grava em caminho Unicode — ERR-001 superado")

    assert not alvo.is_file(), "falhou em silêncio, sem exceção: é esse o perigo"


def test_arquivo_inexistente_devolve_none(tmp_path):
    assert imagens.ler(tmp_path / "não-existe.jpg") is None


def test_arquivo_vazio_devolve_none(tmp_path):
    vazio = tmp_path / "vazio.jpg"
    vazio.write_bytes(b"")
    assert imagens.ler(vazio) is None


def test_arquivo_que_nao_e_imagem_devolve_none(tmp_path):
    lixo = tmp_path / "lixo.jpg"
    lixo.write_bytes(b"isto nao e um jpeg")
    assert imagens.ler(lixo) is None


def test_cria_a_pasta_ao_gravar(tmp_path):
    """O spool nasce vazio; gravar não pode exigir que alguém crie a pasta."""
    alvo = tmp_path / "nova" / "mais funda" / "q.jpg"

    assert imagens.escrever(alvo, np.zeros((8, 8, 3), dtype=np.uint8)) is True
    assert alvo.is_file()


def test_qualidade_jpeg_e_respeitada(tmp_path):
    ruido = np.random.default_rng(1).integers(0, 255, (120, 120, 3), dtype=np.uint8)
    alta = tmp_path / "alta.jpg"
    baixa = tmp_path / "baixa.jpg"

    imagens.escrever(alta, ruido, [cv2.IMWRITE_JPEG_QUALITY, 95])
    imagens.escrever(baixa, ruido, [cv2.IMWRITE_JPEG_QUALITY, 30])

    assert baixa.stat().st_size < alta.stat().st_size


# ───── a tela real do MHDX, capturada em 05/10/2026 (canal sem câmera) ─────


def test_a_tela_de_sem_sinal_do_mhdx_e_recusada():
    """Amostra real, não sintética: `testes/amostras/mhdx-sem-sinal.jpg`
    saiu do canal 1 do gravador deste projeto, sem câmera ligada.

    99,5% dos pixels em preto absoluto, saturação zero. É exatamente esse
    quadro que chegaria ao modelo se uma câmera perdesse sinal em produção.
    """
    from pathlib import Path

    from farol_agent.pipeline import qualidade

    amostra = Path(__file__).parent / "amostras" / "mhdx-sem-sinal.jpg"
    img = imagens.ler(amostra)
    assert img is not None, "a amostra tem que estar no repo"

    utilizavel, motivo = qualidade.cena_utilizavel(img)

    assert not utilizavel
    assert "preto" in motivo


def test_detalhe_real_sozinho_NAO_pega_a_tela_de_sem_sinal():
    """Documenta por que `cena_utilizavel` existe separada.

    A tela de sem-sinal marcou detalhe 0,661 — MAIS ALTO que cena real,
    porque o relógio e o logotipo sobre preto chapado são pura alta
    frequência. Medida boa para uma coisa pode mentir para outra.
    """
    from pathlib import Path

    from farol_agent.pipeline import qualidade

    img = imagens.ler(Path(__file__).parent / "amostras" / "mhdx-sem-sinal.jpg")

    assert qualidade.detalhe_real(img) > 0.3, (
        "se isto cair, a lição mudou e vale reavaliar o limiar de detalhe"
    )
