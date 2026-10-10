"""O trecho baixado do gravador: ler os quadros e escolher o quadro parado.

Os trechos aqui são vídeos de verdade, gravados na hora pelo próprio teste
(o leitor é o mesmo do agente): um quadrado branco que anda é "a mão", e o
quadro que se repete é "a cena parada".

O que tem de ficar provado:

- o quadro escolhido é o do MEIO do trecho parado mais longo, e o instante
  dele sai das pontas do trecho;
- trecho parado curto demais não conta — e o mínimo é dito em tempo, não em
  quadros;
- sem trecho parado, o que volta vem marcado como NÃO parado;
- o movimento fora do alvo não atrapalha;
- o arquivo não fica preso depois da leitura, e pasta com acento não derruba.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta
from pathlib import Path

import cv2
import numpy as np
import pytest

from farol_agent.sequencia import bloco
from farol_agent.sequencia.bloco import (
    Escolha,
    Regua,
    TrechoIlegivel,
    contar_quadros,
    escolher_quadro_parado,
    ler_quadros,
    medir_movimento,
    quadros_dos_instantes,
    quadros_que_bastam,
    trecho_mais_parado,
)

DE = datetime(2026, 10, 9, 19, 51, 26)
LARGURA, ALTURA = 320, 180
# o limite de "parado" da régua de fábrica
PARTE_PARADA = bloco.REGUA_DE_FABRICA.parte_parada


def cena(x: int | None = None, *, y: int = 60, tom: int = 0) -> np.ndarray:
    """Um quadro: fundo liso e, se `x` vier, um quadrado branco de 60 pontos com o canto em (x, y)."""
    q = np.full((ALTURA, LARGURA, 3), tom, dtype=np.uint8)
    if x is not None:
        q[y:y + 60, x:x + 60] = 255
    return q


def gravar(pasta: Path, quadros: list[np.ndarray], *, nome: str = "trecho.avi", qps: float = 15.0) -> Path:
    """Grava os quadros num vídeo. O gravador de vídeo também tropeça em acento: escreve-se pelo nome curto da pasta."""
    caminho = Path(bloco._caminho_que_o_leitor_abre(pasta)) / nome
    saida = cv2.VideoWriter(str(caminho), cv2.VideoWriter_fourcc(*"MJPG"), qps, (LARGURA, ALTURA))
    assert saida.isOpened(), "o teste não conseguiu gravar o vídeo de exemplo"
    try:
        for q in quadros:
            saida.write(q)
    finally:
        saida.release()
    return pasta / nome


def andando(n: int, *, desde: int = 0) -> list[np.ndarray]:
    """`n` quadros com o quadrado andando 20 pontos por quadro (vai e volta para não sair da imagem)."""
    return [cena(20 + ((desde + i) * 20) % 220) for i in range(n)]


# ───────────────────────── a conta, sem vídeo ─────────────────────────


def test_o_trecho_parado_mais_longo_e_o_primeiro_no_empate():
    P, M = 0.0, 0.5   # parado, mexeu
    # o quadro ANTERIOR ao primeiro parado entra no trecho: é a outra ponta da comparação
    assert trecho_mais_parado([1.0, M, P, P, P, M, M]) == (1, 4)
    assert trecho_mais_parado([1.0, P, P, M, P, P, P, P, M]) == (3, 7)
    # empate: fica o primeiro
    assert trecho_mais_parado([1.0, P, P, M, P, P]) == (0, 2)
    # o trecho que vai até o fim também conta
    assert trecho_mais_parado([1.0, M, M, P, P]) == (2, 4)
    assert trecho_mais_parado([1.0, M, M, M]) is None
    assert trecho_mais_parado([1.0]) is None
    assert trecho_mais_parado([]) is None


def test_o_limite_de_parado_e_menos_que_a_parte_e_nao_igual():
    assert trecho_mais_parado([1.0, PARTE_PARADA - 0.0001]) == (0, 1)
    assert trecho_mais_parado([1.0, PARTE_PARADA]) is None


def test_o_minimo_do_trecho_parado_e_dito_em_tempo():
    assert quadros_que_bastam(15) == 4       # o medido: 4 quadros a 15 por segundo
    assert quadros_que_bastam(30) == 8       # a 30 por segundo, o dobro
    assert quadros_que_bastam(12.5) == 4     # 3,125 sobe para 4
    assert quadros_que_bastam(8) == 2        # exatos 2: não sobe para 3
    assert quadros_que_bastam(2) == 2        # nunca menos que dois: parado é uma comparação
    assert quadros_que_bastam(0) == 2 and quadros_que_bastam(-1) == 2


def test_a_regua_de_fabrica_e_a_medida_na_rodada_5_e_outra_camera_pode_ter_a_sua(tmp_path: Path):
    # a de fábrica: o que foi medido numa câmera, numa noite — ponto de partida, não regra do motor
    assert bloco.REGUA_DE_FABRICA == Regua(largura=96, salto=16, parte_parada=0.012, tempo_parado_s=0.25)
    assert Regua() == bloco.REGUA_DE_FABRICA

    # a conta segue a régua de quem chama
    assert quadros_que_bastam(15, Regua(tempo_parado_s=0.2)) == 3
    assert quadros_que_bastam(15, Regua(tempo_parado_s=1.0)) == 15
    assert trecho_mais_parado([1.0, 0.3, 0.3, 0.6], Regua(parte_parada=0.5)) == (0, 2)
    assert trecho_mais_parado([1.0, 0.3, 0.3, 0.6]) is None

    # e a escolha também: 3 quadros parados não bastam na régua de fábrica, e bastam na de quem aceita 0,2 s
    curto = gravar(tmp_path, andando(12) + [cena(100)] * 3 + andando(15, desde=5))
    ate = DE + timedelta(seconds=2)
    assert escolher_quadro_parado(curto, DE, ate).parado_quadros == 0
    assert escolher_quadro_parado(curto, DE, ate, regua=Regua(tempo_parado_s=0.2)).parado_quadros == 3
    # régua que aceita metade do alvo mudando: a mão andando conta como parada
    assert escolher_quadro_parado(curto, DE, ate, regua=Regua(parte_parada=0.5)).parado_quadros == 30
    # régua que não vê salto nenhum: tudo parado, o quadro do meio
    cega = escolher_quadro_parado(curto, DE, ate, regua=Regua(salto=255))
    assert (cega.parado_quadros, cega.indice) == (30, 14)
    # régua que mede mais fino (192 de largura) continua vendo a mão andar
    assert escolher_quadro_parado(curto, DE, ate, regua=Regua(largura=192)).parado_quadros == 0
    assert medir_movimento(curto, None, Regua(salto=255))[1:] == [0.0] * 29


# ───────────────────────── com vídeo de verdade ─────────────────────────


def test_o_quadro_escolhido_e_o_do_meio_do_trecho_parado(tmp_path: Path):
    # 10 quadros com a mão, 12 parados, 8 com a mão: 30 quadros, 2 s
    quadros = andando(10) + [cena(100)] * 12 + andando(8, desde=3)
    trecho = gravar(tmp_path, quadros)

    e = escolher_quadro_parado(trecho, DE, DE + timedelta(seconds=2))

    assert isinstance(e, Escolha)
    assert e.quadros == 30
    # o trecho parado vai do quadro 10 ao 21; o do meio é o 15
    assert (e.indice, e.parado_quadros, e.parado) == (15, 12, True)
    assert e.ts == DE + timedelta(seconds=1)
    assert e.movimento < PARTE_PARADA
    assert e.imagem.shape == (ALTURA, LARGURA, 3)
    # e é mesmo o quadro parado: o quadrado está onde a cena parada o deixou
    assert e.imagem[90, 130].min() > 200 and e.imagem[90, 40].max() < 60
    # sem a taxa do gravador, não dá para dizer se o trecho veio inteiro
    assert (e.esperados, e.inteiro) == (None, None)


def test_com_a_taxa_do_gravador_sabe_se_o_trecho_veio_inteiro(tmp_path: Path):
    quadros = andando(10) + [cena(100)] * 12 + andando(8, desde=3)
    ate = DE + timedelta(seconds=2)

    inteiro = escolher_quadro_parado(gravar(tmp_path, quadros, nome="inteiro.avi"), DE, ate, qps=15.0)
    assert (inteiro.quadros, inteiro.esperados, inteiro.inteiro) == (30, 30, True)
    assert (inteiro.indice, inteiro.ts) == (15, DE + timedelta(seconds=1))

    # o gravador mandou só os 20 primeiros quadros (o tamanho declarado bate): o que conta é quantos eram para vir
    cortado = escolher_quadro_parado(gravar(tmp_path, quadros[:20], nome="cortado.avi"), DE, ate, qps=15.0)
    assert (cortado.quadros, cortado.esperados, cortado.inteiro) == (20, 30, False)
    # o trecho parado vai do quadro 10 ao 19; o do meio é o 14 — e o instante sai da TAXA, não das pontas:
    # 14 quadros a 15 por segundo (esticado pelas pontas daria 1,4 s, e estaria errado)
    assert (cortado.indice, cortado.parado_quadros) == (14, 10)
    assert cortado.ts == DE + timedelta(seconds=14 / 15)

    # um quadro a menos é tolerado; dois, não
    assert escolher_quadro_parado(gravar(tmp_path, quadros[:29], nome="quase.avi"), DE, ate, qps=15.0).inteiro is True
    assert escolher_quadro_parado(gravar(tmp_path, quadros[:28], nome="menos.avi"), DE, ate, qps=15.0).inteiro is False
    # taxa que não é taxa vale como não medida
    assert escolher_quadro_parado(gravar(tmp_path, quadros, nome="zero.avi"), DE, ate, qps=0.0).inteiro is None
    # a taxa medida vem com casas (14,99): eram para vir 29,98 quadros — 30, e não 29
    quebrada = escolher_quadro_parado(tmp_path / "inteiro.avi", DE, ate, qps=14.99)
    assert (quebrada.esperados, quebrada.inteiro) == (30, True)


def test_sem_trecho_parado_volta_o_de_menor_movimento_marcado_como_nao_parado(tmp_path: Path):
    quadros = andando(30)
    quadros[17] = quadros[16].copy()   # um quadro só repetido: 2 quadros não fazem um trecho parado
    trecho = gravar(tmp_path, quadros)

    e = escolher_quadro_parado(trecho, DE, DE + timedelta(seconds=2))

    assert (e.indice, e.parado_quadros, e.parado, e.quadros) == (17, 0, False, 30)
    assert e.ts == DE + timedelta(seconds=2) * 17 / 30


def test_trecho_parado_curto_demais_nao_conta_e_o_minimo_segue_a_taxa(tmp_path: Path):
    # 3 quadros parados a 15 por segundo: 0,2 s, abaixo do quarto de segundo
    curto = gravar(tmp_path, andando(12) + [cena(100)] * 3 + andando(15, desde=5), nome="curto.avi")
    assert escolher_quadro_parado(curto, DE, DE + timedelta(seconds=2)).parado_quadros == 0
    # 4 quadros: conta
    justo = gravar(tmp_path, andando(12) + [cena(100)] * 4 + andando(14, desde=5), nome="justo.avi")
    e = escolher_quadro_parado(justo, DE, DE + timedelta(seconds=2))
    assert (e.parado_quadros, e.indice) == (4, 13)
    # os MESMOS 4 quadros parados, num trecho de 1 s (30 quadros por segundo): 0,13 s — não conta
    assert escolher_quadro_parado(justo, DE, DE + timedelta(seconds=1)).parado_quadros == 0
    # e a taxa medida manda mais que as pontas: a 30 por segundo, 4 quadros não bastam
    assert escolher_quadro_parado(justo, DE, DE + timedelta(seconds=2), qps=30.0).parado_quadros == 0
    assert escolher_quadro_parado(justo, DE, DE + timedelta(seconds=2), qps=15.0).parado_quadros == 4


def test_o_movimento_fora_do_alvo_nao_atrapalha(tmp_path: Path):
    # a mão anda na metade de cima (y de 10 a 70); o alvo é a metade de baixo
    quadros = [cena(20 + (i * 20) % 220, y=10) for i in range(30)]
    trecho = gravar(tmp_path, quadros)
    ate = DE + timedelta(seconds=2)

    assert escolher_quadro_parado(trecho, DE, ate).parado_quadros == 0
    no_alvo = escolher_quadro_parado(trecho, DE, ate, caixa=(0.0, 0.5, 1.0, 1.0))
    # no alvo nada mexe: o trecho parado é o bloco inteiro, e o quadro é o do meio
    assert (no_alvo.parado_quadros, no_alvo.indice) == (30, 14)
    # a imagem devolvida é o quadro INTEIRO, não o recorte
    assert no_alvo.imagem.shape == (ALTURA, LARGURA, 3)
    # caixa que não pega ponto nenhum: mede o quadro inteiro, em vez de estourar
    assert escolher_quadro_parado(trecho, DE, ate, caixa=(0.5, 0.5, 0.5, 0.5)).parado_quadros == 0


def test_a_medida_do_movimento_tem_um_numero_por_quadro(tmp_path: Path):
    trecho = gravar(tmp_path, [cena(100)] * 3 + andando(3))
    medidas = medir_movimento(trecho)
    assert len(medidas) == 6
    assert medidas[0] == 1.0                      # o primeiro não tem anterior
    assert medidas[1] == 0.0 and medidas[2] == 0.0
    assert all(m >= PARTE_PARADA for m in medidas[3:])


def test_ponto_solto_que_pisca_nao_e_movimento(monkeypatch: pytest.MonkeyPatch):
    # O chuvisco da câmera: pontos soltos que mudam de lugar a cada quadro, numa cena parada. Reduzir pela média
    # da área e suavizar é o que os apaga; sem uma das duas coisas, cada ponto contaria como mudança.
    # O quadro tem 288 × 162: a redução para 96 de largura junta exatamente 3 × 3 pontos em um.
    def chuvisco(k: int) -> np.ndarray:
        q = np.zeros((162, 288, 3), dtype=np.uint8)
        # 72 pontos brancos, um por célula de 3 × 3, longe uns dos outros — e em outras células a cada quadro
        for a in range(k % 4, 96, 8):
            for b in range((3 * k) % 6, 54, 9):
                q[3 * b, 3 * a] = 255
        return q

    monkeypatch.setattr(bloco, "ler_quadros", lambda caminho, **_: iter([chuvisco(k) for k in range(8)]))

    medidas = medir_movimento(Path("nao-importa.dav"))

    assert medidas == [1.0] + [0.0] * 7
    assert trecho_mais_parado(medidas) == (0, 7)
    # a mesma cena medida sem reduzir (régua de 288 de largura): cada ponto volta a contar — quem decide é a régua
    fino = medir_movimento(Path("nao-importa.dav"), None, Regua(largura=288))
    assert all(m > PARTE_PARADA for m in fino[1:])


def test_os_quadros_dos_instantes_pedidos(tmp_path: Path):
    # cada quadro tem um tom: o quadro i é o cinza 10 + 8·i
    trecho = gravar(tmp_path, [cena(tom=10 + 8 * i) for i in range(30)])
    ate = DE + timedelta(seconds=2)

    def tom(q) -> int:
        return round((float(q.imagem.mean()) - 10) / 8)

    pedidos = [DE, DE + timedelta(seconds=1), DE + timedelta(seconds=1.99), DE + timedelta(seconds=0.5), DE + timedelta(seconds=1)]
    achados = quadros_dos_instantes(trecho, DE, ate, pedidos)

    assert [q.indice for q in achados] == [0, 15, 29, 7, 15]          # na ordem pedida; o repetido volta duas vezes
    assert [tom(q) for q in achados] == [0, 15, 29, 7, 15]             # e a imagem é a do quadro dito
    assert achados[1].ts == DE + timedelta(seconds=1) and achados[3].ts == DE + timedelta(seconds=2) * 7 / 30
    # instante que o trecho não cobre volta sem quadro: antes do começo, no fim (que já é do trecho seguinte) e depois
    fora = quadros_dos_instantes(trecho, DE, ate, [DE - timedelta(microseconds=1), ate, ate + timedelta(seconds=5), DE])
    assert [q is None for q in fora] == [True, True, True, False]
    assert quadros_dos_instantes(trecho, DE, ate, []) == []


def test_instante_depois_do_que_veio_volta_sem_quadro(tmp_path: Path):
    # o trecho devia ter 2 s (30 quadros), e o gravador mandou só os 20 primeiros
    trecho = gravar(tmp_path, [cena(tom=10 + 8 * i) for i in range(20)])
    ate = DE + timedelta(seconds=2)
    pedidos = [DE + timedelta(seconds=1.2), DE + timedelta(seconds=1.5), DE + timedelta(seconds=19 / 15)]

    com_taxa = quadros_dos_instantes(trecho, DE, ate, pedidos, qps=15.0)
    # 1,2 s é o quadro 18; 1,5 s seria o 22, que não veio; o último que veio (o 19) cobre de 1,267 s em diante
    assert [None if q is None else q.indice for q in com_taxa] == [18, None, 19]
    assert com_taxa[0].ts == DE + timedelta(seconds=1.2)
    # sem a taxa, não há como saber que faltou: os 20 quadros são esticados pelas duas pontas (e o instante sai errado)
    sem_taxa = quadros_dos_instantes(trecho, DE, ate, pedidos)
    assert [q.indice for q in sem_taxa] == [12, 15, 12]


def test_o_instante_que_o_modulo_deu_a_um_quadro_volta_nesse_quadro(tmp_path: Path):
    # O instante é guardado em microssegundos: 2/15 s vira 0,133333 s, um fio ANTES do quadro 2. Sem folga, a
    # conta de volta cairia no quadro 1 — e quem pedisse "o quadro escolhido" receberia o vizinho.
    trecho = gravar(tmp_path, [cena(tom=10 + 8 * i) for i in range(30)])
    ate = DE + timedelta(seconds=2)

    achados = quadros_dos_instantes(trecho, DE, ate, [DE + timedelta(seconds=i / 15) for i in range(30)], qps=15.0)
    assert [q.indice for q in achados] == list(range(30))
    de_volta = quadros_dos_instantes(trecho, DE, ate, [q.ts for q in achados], qps=15.0)
    assert [q.indice for q in de_volta] == list(range(30))
    # sem a taxa medida (ela sai das pontas), a mesma coisa
    assert [q.indice for q in quadros_dos_instantes(trecho, DE, ate, [q.ts for q in achados])] == list(range(30))
    # a folga é menor que um microssegundo: um microssegundo antes do quadro 2 ainda é o quadro 1
    antes_do_2 = achados[2].ts - timedelta(microseconds=1)
    assert quadros_dos_instantes(trecho, DE, ate, [antes_do_2], qps=15.0)[0].indice == 1
    assert bloco.FOLGA_DO_INSTANTE == 0.75e-6


def test_trecho_que_muda_entre_uma_leitura_e_a_outra_e_dito(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    # O trecho é lido duas vezes (a medida, e depois o quadro). Se o arquivo encolhe no meio, isso é dito —
    # em vez de devolver quadro nenhum, ou o quadro errado.
    trecho = gravar(tmp_path, [cena(100)] * 8)
    de_verdade = bloco.ler_quadros
    leituras: list[int] = []

    def encolhe(caminho: Path, *, maximo: int = bloco.MAX_QUADROS):
        leituras.append(maximo)
        # a primeira leitura vê os 8 quadros; da segunda em diante, só 2
        yield from de_verdade(caminho, maximo=maximo if len(leituras) == 1 else min(maximo, 2))

    monkeypatch.setattr(bloco, "ler_quadros", encolhe)

    with pytest.raises(TrechoIlegivel, match="mudou entre uma leitura e a outra"):
        escolher_quadro_parado(trecho, DE, DE + timedelta(seconds=1))
    # a segunda leitura vai só até o quadro escolhido (o 3, no meio dos 8 parados): não lê o trecho inteiro de novo
    assert leituras == [bloco.MAX_QUADROS, 4]

    leituras.clear()
    with pytest.raises(TrechoIlegivel, match="mudou entre uma leitura e a outra"):
        quadros_dos_instantes(trecho, DE, DE + timedelta(seconds=1), [DE + timedelta(seconds=0.5)])
    assert leituras == [bloco.MAX_QUADROS, 5]


def test_contar_e_ler_soltam_o_arquivo(tmp_path: Path):
    trecho = gravar(tmp_path, andando(9))
    assert contar_quadros(trecho) == 9
    assert len(list(ler_quadros(trecho, maximo=4))) == 4
    # quem para no meio também solta: o gerador fecha o leitor
    leitura = ler_quadros(trecho)
    next(leitura)
    leitura.close()
    escolher_quadro_parado(trecho, DE, DE + timedelta(seconds=1))
    trecho.unlink()               # no Windows, arquivo preso não se apaga
    assert not trecho.exists()


def test_o_leitor_de_video_e_fechado_sempre(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    # O arquivo preso é o que impede apagar o trecho. Aqui conta-se o fechamento em si: no fim da leitura,
    # quando quem lê para no meio, e quando quem lê estoura.
    trecho = gravar(tmp_path, andando(6))
    de_verdade = cv2.VideoCapture
    fechados: list[int] = []

    class Leitor:
        def __init__(self, *a, **k) -> None:
            self._leitor = de_verdade(*a, **k)

        def read(self):
            return self._leitor.read()

        def release(self) -> None:
            fechados.append(1)
            self._leitor.release()

    monkeypatch.setattr(bloco.cv2, "VideoCapture", Leitor)

    assert contar_quadros(trecho) == 6
    assert len(fechados) == 1
    leitura = ler_quadros(trecho)
    next(leitura)
    leitura.close()
    assert len(fechados) == 2
    with pytest.raises(RuntimeError, match="quem lê estourou"):
        for _ in ler_quadros(trecho):
            raise RuntimeError("quem lê estourou")
    assert len(fechados) == 3


def test_pasta_com_acento_nao_derruba_a_leitura(tmp_path: Path):
    pasta = tmp_path / "loja do João · balcão"
    pasta.mkdir()
    trecho = gravar(pasta, [cena(100)] * 6)
    assert contar_quadros(trecho) == 6
    assert escolher_quadro_parado(trecho, DE, DE + timedelta(seconds=1)).parado_quadros == 6


@pytest.mark.skipif(os.name != "nt", reason="o nome curto é do Windows")
def test_no_windows_o_leitor_recebe_um_caminho_sem_acento_que_aponta_para_o_mesmo_arquivo(tmp_path: Path):
    pasta = tmp_path / "loja do João"
    pasta.mkdir()
    arquivo = pasta / "trecho.dav"
    arquivo.write_bytes(b"o mesmo arquivo")

    curto = bloco._caminho_que_o_leitor_abre(arquivo)

    assert curto.isascii(), "o caminho entregue ao leitor de vídeo ainda tem acento"
    assert Path(curto).read_bytes() == b"o mesmo arquivo"
    # caminho que já não tem acento vai como está
    assert bloco._caminho_que_o_leitor_abre(Path("C:/Farol/agent/trecho.dav")) == str(Path("C:/Farol/agent/trecho.dav"))


def test_arquivo_que_nao_e_video_e_dito_como_ilegivel(tmp_path: Path):
    lixo = tmp_path / "lixo.dav"
    lixo.write_bytes(b"isto nao e video " * 200)
    with pytest.raises(TrechoIlegivel, match="quadro nenhum"):
        escolher_quadro_parado(lixo, DE, DE + timedelta(seconds=2))
    with pytest.raises(TrechoIlegivel, match="quadro nenhum"):
        quadros_dos_instantes(lixo, DE, DE + timedelta(seconds=2), [DE])
    assert contar_quadros(lixo) == 0
    assert contar_quadros(tmp_path / "nao-existe.dav") == 0


def test_trecho_que_termina_antes_de_comecar_e_recusado(tmp_path: Path):
    trecho = gravar(tmp_path, andando(4))
    with pytest.raises(ValueError, match="termina depois de começar"):
        escolher_quadro_parado(trecho, DE, DE)
    with pytest.raises(ValueError, match="termina depois de começar"):
        escolher_quadro_parado(trecho, DE, DE - timedelta(seconds=1))
    for ate in (DE, DE - timedelta(seconds=1)):
        with pytest.raises(ValueError, match="termina depois de começar"):
            quadros_dos_instantes(trecho, DE, ate, [DE])


def test_trecho_de_um_quadro_so(tmp_path: Path):
    trecho = gravar(tmp_path, [cena(100)])
    e = escolher_quadro_parado(trecho, DE, DE + timedelta(seconds=2))
    assert (e.indice, e.quadros, e.parado_quadros, e.ts) == (0, 1, 0, DE)
