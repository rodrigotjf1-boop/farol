"""A grade de quadros numerados: uma sequência numa imagem só.

O que tem de ficar provado:

- os instantes são o meio de cada fatia igual da janela, na ordem do tempo;
- cada célula é o recorte do alvo, na ordem, da esquerda para a direita e de
  cima para baixo, com o número dela — e o número devolve o instante;
- a célula nunca é ampliada, e a que passa do teto é reduzida sem deformar;
- tirada de um trecho de vídeo de verdade, a grade traz os quadros dos
  instantes pedidos; trecho que não cobre a janela não vira grade com buraco.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path

import cv2
import numpy as np
import pytest

from farol_agent.sequencia import grade
from farol_agent.sequencia.bloco import QuadroGravado
from farol_agent.sequencia.grade import FIO, Grade, GradeIncompleta, grade_do_trecho, instantes_da_grade, montar

from .test_sequencia_bloco import gravar

DE = datetime(2026, 10, 9, 23, 50, 18)
LARGURA, ALTURA = 320, 180


def s(segundos: float) -> datetime:
    return DE + timedelta(seconds=segundos)


def liso(tom: int, largura: int = LARGURA, altura: int = ALTURA) -> np.ndarray:
    """Um quadro de uma cor só: o tom diz qual quadro é."""
    return np.full((altura, largura, 3), tom, dtype=np.uint8)


def quadros(tons: list[int], **tamanho) -> list[QuadroGravado]:
    return [QuadroGravado(indice=i, ts=s(i * 0.5), imagem=liso(t, **tamanho)) for i, t in enumerate(tons)]


def tom_da_celula(g: Grade, numero: int) -> int:
    """O tom do meio da célula de número `numero` (longe da placa do número)."""
    largura, altura = g.celula
    i = numero - 1
    x = (i % g.colunas) * (largura + FIO) + largura // 2
    y = (i // g.colunas) * (altura + FIO) + (altura * 3) // 4
    return int(g.imagem[y, x, 0])


# ───────────────────────── os instantes ─────────────────────────


def test_o_formato_de_fabrica_e_seis_quadros_tres_por_linha():
    assert (grade.QUADROS_DA_GRADE, grade.COLUNAS, grade.MAIOR_CELULA) == (6, 3, (960, 540))


def test_os_instantes_sao_o_meio_de_cada_fatia_igual_da_janela():
    # 6 s em 6 fatias de 1 s: os meios.
    assert instantes_da_grade(s(0), s(6)) == [s(0.5), s(1.5), s(2.5), s(3.5), s(4.5), s(5.5)]
    # A janela da mão da rodada 5 (um bloco de 2 s): um quadro a cada terço de segundo.
    dois = instantes_da_grade(s(0), s(2))
    assert dois[0] == s(1 / 6) and dois[-1] == s(2 - 1 / 6) and len(dois) == 6
    assert all(s(0) < t < s(2) for t in dois), "nenhum em cima das pontas"
    assert dois == sorted(dois)
    assert instantes_da_grade(s(0), s(3), 3) == [s(0.5), s(1.5), s(2.5)]
    assert instantes_da_grade(s(0), s(3), 1) == [s(1.5)]


@pytest.mark.parametrize("segundos", [2, 3, 7, 0.4])
@pytest.mark.parametrize("quantos", [1, 2, 3, 6, 7, 30])
def test_cada_instante_sai_da_janela_inteira_sem_somar_arredondamento(segundos, quantos):
    # O instante é guardado em microssegundos: cada um é o valor exato, arredondado UMA vez.
    total = round(segundos * 1_000_000)
    instantes = instantes_da_grade(s(0), s(segundos), quantos)
    assert instantes == [DE + timedelta(microseconds=round(total * (2 * i + 1) / (2 * quantos))) for i in range(quantos)]
    assert instantes == sorted(instantes) and s(0) < instantes[0] and instantes[-1] < s(segundos)
    # As fatias são iguais, a menos de um microssegundo.
    passos = {(b - a) // timedelta(microseconds=1) for a, b in zip(instantes, instantes[1:])}
    assert not passos or max(passos) - min(passos) <= 1


def test_janela_ao_contrario_ou_grade_sem_quadro_nao_existem():
    for ate in (s(0), s(-1)):
        with pytest.raises(ValueError, match="a janela termina depois de começar"):
            instantes_da_grade(s(0), ate)
    with pytest.raises(ValueError, match="pelo menos um quadro"):
        instantes_da_grade(s(0), s(2), 0)


# ───────────────────────── a montagem ─────────────────────────


def test_as_celulas_vao_na_ordem_do_tempo_da_esquerda_para_a_direita_e_de_cima_para_baixo():
    tons = [20, 60, 100, 140, 180, 220]
    g = montar(quadros(tons))

    assert g.colunas == 3 and g.celula == (LARGURA, ALTURA)
    assert g.imagem.shape == (2 * ALTURA + FIO, 3 * LARGURA + 2 * FIO, 3)
    assert [tom_da_celula(g, n) for n in range(1, 7)] == tons
    assert g.instantes == tuple(s(i * 0.5) for i in range(6))
    # O número devolve o instante: é assim que "aconteceu no quadro 4" vira uma hora.
    assert [g.instante_do(n) for n in (1, 4, 6)] == [s(0), s(1.5), s(2.5)]
    for fora in (0, 7, -1):
        with pytest.raises(ValueError, match="de 1 a 6"):
            g.instante_do(fora)


def test_entre_as_celulas_ha_um_fio_escuro():
    g = montar(quadros([200] * 6))
    assert FIO == 4
    # O fio de pé, entre a primeira e a segunda coluna; e o deitado, entre as duas linhas.
    assert int(g.imagem[ALTURA // 2, LARGURA:LARGURA + FIO].max()) == 0
    assert int(g.imagem[ALTURA:ALTURA + FIO, LARGURA // 2].max()) == 0
    # E logo antes e logo depois dele, a célula.
    assert int(g.imagem[ALTURA // 2, LARGURA - 1, 0]) == 200 and int(g.imagem[ALTURA // 2, LARGURA + FIO, 0]) == 200


def test_cada_celula_leva_o_numero_dela_no_canto_branco_sobre_escuro():
    g = montar(quadros([120] * 6))
    lado = max(18, round(min(ALTURA, LARGURA) * 0.16))
    desenhos = []
    for n in range(1, 7):
        i = n - 1
        x, y = (i % 3) * (LARGURA + FIO), (i // 3) * (ALTURA + FIO)
        placa = g.imagem[y:y + lado, x:x + lado, 0]
        assert int(placa[0, 0]) == 0, "a placa é escura"
        assert int(placa.max()) > 200, "e o número, claro"
        assert int(g.imagem[y + ALTURA - 1, x + LARGURA - 1, 0]) == 120, "fora da placa, a célula fica como veio"
        desenhos.append((placa > 128).tobytes())
    assert len(set(desenhos)) == 6, "seis números, seis desenhos diferentes"

    # E o desenho de cada célula é o do NÚMERO dela, a partir de 1 — conferido contra o algarismo escrito à parte.
    def algarismo(texto: str) -> np.ndarray:
        placa = np.zeros((lado, lado), dtype=np.uint8)
        tamanho, espessura = lado / 34.0, max(1, round(lado / 14))
        (w, h), _ = cv2.getTextSize(texto, cv2.FONT_HERSHEY_SIMPLEX, tamanho, espessura)
        cv2.putText(placa, texto, ((lado - w) // 2, (lado + h) // 2), cv2.FONT_HERSHEY_SIMPLEX, tamanho, 255, espessura, cv2.LINE_AA)
        return placa > 128

    for n in range(1, 7):
        i = n - 1
        x, y = (i % 3) * (LARGURA + FIO), (i // 3) * (ALTURA + FIO)
        assert np.array_equal(g.imagem[y:y + lado, x:x + lado, 0] > 128, algarismo(str(n))), f"a célula {n} mostra o {n}"


def test_a_placa_do_numero_cresce_com_a_celula_e_nao_some_numa_pequena():
    grande = montar(quadros([120] * 6, largura=960, altura=540))
    assert int(grande.imagem[80, 80, 0]) < 60 and int(grande.imagem[95, 95, 0]) == 120, "placa de 86 pontos"
    pequena = montar(quadros([120] * 6, largura=64, altura=48))
    assert int(pequena.imagem[0, 17, 0]) == 0 and int(pequena.imagem[0, 19, 0]) == 120, "nunca menor que 18 pontos"


def test_o_recorte_do_alvo_e_a_celula_e_o_resto_do_quadro_fica_de_fora():
    # Metade de cima clara, metade de baixo escura; o alvo é o quarto de baixo, à direita.
    def meio_a_meio(tom: int) -> np.ndarray:
        q = liso(250)
        q[ALTURA // 2:, :] = tom
        return q

    qs = [QuadroGravado(indice=i, ts=s(i), imagem=meio_a_meio(t)) for i, t in enumerate([10, 50, 90])]
    g = montar(qs, caixa=(0.5, 0.5, 1.0, 1.0))

    assert g.celula == (LARGURA // 2, ALTURA // 2)
    assert [tom_da_celula(g, n) for n in (1, 2, 3)] == [10, 50, 90]
    assert int(g.imagem[ALTURA // 4, LARGURA // 4 + 40, 0]) == 10, "nada da metade clara entrou"
    # Sem caixa, vai o quadro inteiro.
    assert montar(qs).celula == (LARGURA, ALTURA)


def test_a_celula_grande_e_reduzida_para_caber_sem_deformar_e_a_pequena_nunca_e_ampliada():
    # 1920 × 1080 cabe em 960 × 540 pela metade.
    g = montar(quadros([70] * 2, largura=1920, altura=1080))
    assert g.celula == (960, 540)
    # Mais larga que alta: quem manda é a largura, e a proporção fica.
    g = montar(quadros([70] * 2, largura=1920, altura=400))
    assert g.celula == (960, 200)
    # Mais alta que larga: quem manda é a altura.
    g = montar(quadros([70] * 2, largura=600, altura=1080))
    assert g.celula == (300, 540)
    # No teto exato, e abaixo dele: como veio.
    assert montar(quadros([70] * 2, largura=960, altura=540)).celula == (960, 540)
    assert montar(quadros([70] * 2, largura=300, altura=300)).celula == (300, 300)
    # O teto é de quem chama.
    assert montar(quadros([70] * 2), maior_celula=(160, 160)).celula == (160, 90)


def test_grade_que_nao_fecha_a_linha_fica_com_o_resto_escuro_e_as_colunas_sao_de_quem_chama():
    g = montar(quadros([200] * 4))
    assert g.imagem.shape == (2 * ALTURA + FIO, 3 * LARGURA + 2 * FIO, 3)
    assert tom_da_celula(g, 4) == 200
    assert int(g.imagem[ALTURA + FIO:, LARGURA + FIO:].max()) == 0, "os dois lugares vagos ficam escuros"

    duas = montar(quadros([40, 80, 120, 160]), colunas=2)
    assert duas.imagem.shape == (2 * ALTURA + FIO, 2 * LARGURA + FIO, 3)
    assert [tom_da_celula(duas, n) for n in range(1, 5)] == [40, 80, 120, 160]

    fila = montar(quadros([40, 80]), colunas=2)
    assert fila.imagem.shape == (ALTURA, 2 * LARGURA + FIO, 3)
    um = montar(quadros([40]), colunas=1)
    assert um.imagem.shape == (ALTURA, LARGURA, 3)


def test_a_grade_nao_mexe_nos_quadros_que_recebeu():
    qs = quadros([90] * 6)
    montar(qs)
    assert all(int(q.imagem.min()) == 90 and int(q.imagem.max()) == 90 for q in qs), "o número é desenhado numa cópia"


def test_o_que_nao_e_grade():
    with pytest.raises(ValueError, match="pelo menos um quadro"):
        montar([])
    with pytest.raises(ValueError, match="pelo menos uma coluna"):
        montar(quadros([10]), colunas=0)
    fora_de_ordem = [QuadroGravado(0, s(2), liso(10)), QuadroGravado(1, s(1), liso(20))]
    with pytest.raises(ValueError, match="na ordem do tempo"):
        montar(fora_de_ordem)
    # Dois quadros no mesmo instante valem (a janela é curta e a taxa, baixa): não é fora de ordem.
    assert montar([QuadroGravado(0, s(1), liso(10)), QuadroGravado(0, s(1), liso(10))]).instantes == (s(1), s(1))
    tamanhos = [QuadroGravado(0, s(0), liso(10)), QuadroGravado(1, s(1), liso(10, largura=200))]
    with pytest.raises(ValueError, match="o mesmo tamanho"):
        montar(tamanhos)


# ───────────────────────── de um trecho de vídeo ─────────────────────────


def degraus(n: int = 30) -> list[np.ndarray]:
    """`n` quadros, cada um de um tom: o tom diz o número do quadro (de 8 em 8)."""
    return [liso(8 * i) for i in range(n)]


def test_a_grade_de_um_trecho_traz_os_quadros_dos_instantes_da_janela(tmp_path: Path):
    # 2 s a 15 quadros por segundo; a janela é o trecho inteiro.
    trecho = gravar(tmp_path, degraus())
    g = grade_do_trecho(trecho, s(0), s(2), (s(0), s(2)), qps=15.0)

    # Os instantes pedidos (1/6, 1/2, 5/6… s) caem nos quadros 2, 7, 12, 17, 22 e 27.
    esperados = [2, 7, 12, 17, 22, 27]
    assert [round(tom_da_celula(g, n) / 8) for n in range(1, 7)] == esperados
    assert g.instantes == tuple(s(i / 15) for i in esperados), "o instante é o do quadro que veio, não o pedido"
    assert (g.colunas, g.celula) == (3, (LARGURA, ALTURA))


def test_a_janela_pode_ser_um_pedaco_do_trecho_e_a_grade_ter_outro_formato(tmp_path: Path):
    trecho = gravar(tmp_path, degraus())
    # Só o segundo de trás, em 3 quadros numa linha.
    g = grade_do_trecho(trecho, s(0), s(2), (s(1), s(2)), qps=15.0, quantos=3, colunas=3, caixa=(0.0, 0.0, 0.5, 0.5))
    assert [round(tom_da_celula(g, n) / 8) for n in (1, 2, 3)] == [17, 22, 27]
    assert g.celula == (LARGURA // 2, ALTURA // 2) and g.imagem.shape[0] == ALTURA // 2


def test_trecho_que_nao_cobre_a_janela_nao_vira_grade_com_buraco(tmp_path: Path):
    # Veio cortado: 17 quadros no lugar de 30. Os três últimos instantes não têm quadro.
    cortado = gravar(tmp_path, degraus(17))
    with pytest.raises(GradeIncompleta) as e:
        grade_do_trecho(cortado, s(0), s(2), (s(0), s(2)), qps=15.0)
    assert (e.value.faltam, e.value.de) == (3, 6)
    assert "faltaram 3 de 6 quadros" in str(e.value)

    # E a janela que passa do trecho, também.
    inteiro = gravar(tmp_path, degraus(), nome="inteiro.avi")
    with pytest.raises(GradeIncompleta) as e:
        grade_do_trecho(inteiro, s(0), s(2), (s(1), s(4)), qps=15.0)
    assert e.value.faltam == 4
