"""A busca pelo meio e a grade, com o gravador: a hora dele, só o que assentou, e o trecho conferido.

O gravador aqui é de mentira, mas o VÍDEO é de verdade: para cada pedido ele
grava na hora um trecho da cena (o leitor é o mesmo do agente) e o entrega
como o da loja de teste entrega — os blocos que começam dentro do pedido. O
pedido de verdade (a senha, a vez, o tamanho declarado) é provado em
`test_dvr_arquivo.py`.

A cena é contada em segundos do relógio do COMPUTADOR; o gravador está 25 s
adiantado. O fundo diz o estado do alvo — escuro: como antes ("a tampa nua");
médio: o que se procura à vista ("o molho"); claro: como depois ("coberta") —
e a mão é um quadrado branco que anda.

O que tem de ficar provado:

- quem chama fala no relógio do computador; o pedido sai na hora do gravador;
  e tudo o que volta (o resultado, os passos, o que o juiz recebe, os
  instantes da grade) está no relógio do computador;
- antes de a gravação assentar, NENHUM pedido sai;
- bloco ou janela que volta com quadro faltando não é lido: volta depois;
- os arquivos de passagem não ficam no disco.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pytest

from farol_agent.dvr.arquivo import ClienteDeArquivo, PerfilDeArquivo, SemGravacao, Trecho, pedido_que_cobre
from farol_agent.dvr.dahua import ErroDoGravador
from farol_agent.sequencia import gravado
from farol_agent.sequencia.bloco import Regua
from farol_agent.sequencia.busca import ACHOU, APERTOU, MAO, Lado, Leitura
from farol_agent.sequencia.gravado import (
    ESPERA_DO_INCOMPLETO,
    AindaNaoAssentou,
    LeitorDeBlocos,
    SemPerfil,
    TrechoIncompleto,
    VoltarDepois,
    buscar_no_gravador,
    grade_do_gravador,
)
from farol_agent.sequencia.grade import FIO

from .test_sequencia_bloco import ALTURA, LARGURA, cena, gravar

B = datetime(2026, 10, 9, 19, 51, 0)
ADIANTADO = 25.0
ATRASO = 180.0
TONS = {"antes": 40, "achou": 120, "depois": 200}
CANAL = 4


def c(segundos: float) -> datetime:
    """Um instante, no relógio do computador."""
    return B + timedelta(seconds=segundos)


def la(segundos: float) -> datetime:
    """O mesmo instante, na hora do gravador."""
    return c(segundos + ADIANTADO)


class GravadorComCena:
    """Um cliente de arquivo de mentira que entrega vídeo de verdade de uma cena.

    `historia`: [(a partir de que segundo do computador, estado)], em ordem.
    Estados: "antes", "achou", "depois" e "mao" (a mão em cima: nada parado).
    """

    host = "gravador-de-mentira"
    ja_gravado = ClienteDeArquivo.ja_gravado
    espera_ate_gravar = ClienteDeArquivo.espera_ate_gravar

    def __init__(
        self, pasta_do_video: Path, historia: list[tuple[float, str]], *, bloco: int | None = 2, desvio: int = 0,
        qps: float | None = 15.0, cortar: dict[int, int] | None = None, sem_gravacao: tuple[int, ...] = (),
        desvio_de_verdade: int | None = None,
    ) -> None:
        self.pasta_do_video = pasta_do_video
        self.historia = historia
        self.perfil = PerfilDeArquivo(bloco_s=bloco, atraso_s=ATRASO, desvio_s=desvio, qps=qps)
        # Onde os blocos começam DE VERDADE, quando não é onde o perfil guardado diz (o perfil envelheceu).
        self.desvio_de_verdade = desvio_de_verdade
        self.taxa = qps or 15.0
        self.cortar = cortar or {}            # {número do pedido: quantos quadros vêm, no lugar do certo}
        self.sem_gravacao = sem_gravacao      # os pedidos (pelo número) em que o gravador não tem gravação
        self.pedidos: list[tuple[int, datetime, datetime]] = []
        self.relogios = 0

    def relogio(self, *, idade_maxima_s: float = 300.0) -> timedelta:
        self.relogios += 1
        return timedelta(seconds=ADIANTADO)

    def _quadro(self, t: datetime) -> np.ndarray:
        segundo = (t - B).total_seconds() - ADIANTADO
        estado = [e for desde, e in self.historia if desde <= segundo + 1e-9][-1]
        if estado == "mao":
            return cena(20 + (round(segundo * self.taxa) * 20) % 220, tom=TONS["antes"])
        return cena(tom=TONS[estado])

    def baixar(self, canal: int, de: datetime, ate: datetime, destino: Path) -> Trecho:
        pedido = pedido_que_cobre(de, ate, self.perfil.bloco_s, self.perfil.desvio_s)
        self.pedidos.append((canal, pedido.comeco, pedido.cobre_ate))
        numero = len(self.pedidos)
        if numero in self.sem_gravacao:
            raise SemGravacao("o gravador respondeu sem nenhum byte de gravação nesse trecho")
        comeco_do_video = pedido.comeco
        inteiros = round((pedido.cobre_ate - pedido.comeco).total_seconds() * self.taxa)
        if self.desvio_de_verdade is not None:
            # Como o gravador de verdade: voltam os blocos que COMEÇAM dentro do pedido — os dele, não os do perfil.
            bloco_s = self.perfil.bloco_s
            primeiro = pedido.comeco + timedelta(seconds=(self.desvio_de_verdade - self.perfil.desvio_s) % bloco_s)
            comecos = [primeiro + timedelta(seconds=bloco_s * i) for i in range(64) if primeiro + timedelta(seconds=bloco_s * i) < pedido.fim]
            if not comecos:
                raise SemGravacao("o gravador respondeu sem nenhum byte de gravação nesse trecho")
            comeco_do_video, inteiros = comecos[0], round(len(comecos) * bloco_s * self.taxa)
        quantos = self.cortar.get(numero, inteiros)
        if quantos == 0:
            Path(destino).write_bytes(b"isto nao e video")
        else:
            quadros = [self._quadro(comeco_do_video + timedelta(seconds=i / self.taxa)) for i in range(quantos)]
            video = gravar(self.pasta_do_video, quadros, nome=f"pedido-{numero}.avi", qps=self.taxa)
            os.replace(video, destino)
        return Trecho(
            canal=canal, de=pedido.comeco, ate=pedido.cobre_ate, blocos=pedido.blocos, caminho=Path(destino),
            tamanho=Path(destino).stat().st_size, declarado=Path(destino).stat().st_size, tipo="video/dav",
            ate_o_primeiro_byte_s=0.1, total_s=0.2,
        )


def juiz(leitura: Leitura) -> Lado:
    """Lê o estado do alvo pelo fundo, num canto em que a mão não passa."""
    tom = int(leitura.escolha.imagem[ALTURA - 5, LARGURA - 5, 0])
    return Lado.ANTES if tom < 80 else Lado.ACHOU if tom < 160 else Lado.DEPOIS


@pytest.fixture
def pastas(tmp_path: Path) -> tuple[Path, Path]:
    """(onde o gravador de mentira monta os vídeos, a pasta de passagem do agente)."""
    video, passagem = tmp_path / "gravador", tmp_path / "passagem"
    video.mkdir()
    passagem.mkdir()
    return video, passagem


# Molho posto e coberto: nua até :25, o molho à vista até :31, coberta depois (segundos do computador).
POSTO_E_COBERTO = [(0, "antes"), (25, "achou"), (31, "depois")]
# Sem molho: nua até :17, a mão em cima de :17 a :19, coberta depois.
SEM_MOLHO = [(0, "antes"), (17, "mao"), (19, "depois")]
# O último bloco da busca entre :20 e :36 vai até :37 (no computador); ele assenta 180 s depois.
ASSENTOU = c(37 + ATRASO)


# ───────────────────────── a busca ─────────────────────────


def test_a_busca_pede_na_hora_do_gravador_e_devolve_no_relogio_do_computador(pastas):
    video, passagem = pastas
    g = GravadorComCena(video, POSTO_E_COBERTO)
    recebidas: list[Leitura] = []

    def julgar(leitura: Leitura) -> Lado:
        recebidas.append(leitura)
        return juiz(leitura)

    r = buscar_no_gravador(g, CANAL, passagem, c(20), c(36), julgar, agora=lambda: ASSENTOU)

    # Um pedido só: o bloco do meio. No gravador ele é o das 19:51:52 (25 s adiante do :27 do computador).
    assert g.pedidos == [(CANAL, la(27), la(29))] and la(27) == datetime(2026, 10, 9, 19, 51, 52)
    assert g.relogios == 1, "a diferença de relógio é lida uma vez por busca"
    # O resultado, no relógio do computador.
    parado = c(27) + timedelta(seconds=14 / 15)
    assert (r.desfecho, r.de, r.ate, r.instante, r.janela) == (ACHOU, c(27), c(29), parado, None)
    assert [(p.de, p.ate, p.ts, p.parado, p.lado) for p in r.passos] == [(c(27), c(29), parado, True, Lado.ACHOU)]
    # E o juiz também recebe a leitura no relógio do computador.
    (leitura,) = recebidas
    assert (leitura.de, leitura.ate, leitura.escolha.ts) == (c(27), c(29), parado)
    assert leitura.escolha.inteiro is True and leitura.escolha.quadros == 30
    assert list(passagem.iterdir()) == [], "o bloco baixado não fica no disco"


def test_sem_o_que_achar_a_busca_para_na_janela_da_mao_e_a_grade_sai_dela(pastas):
    video, passagem = pastas
    g = GravadorComCena(video, SEM_MOLHO)

    r = buscar_no_gravador(g, CANAL, passagem, c(13), c(19), juiz, agora=lambda: ASSENTOU)

    assert g.pedidos == [(CANAL, la(15), la(17)), (CANAL, la(17), la(19))], "dois blocos, um de cada vez"
    assert r.desfecho == MAO and r.janela == (c(17), c(19))
    assert (r.de, r.ate) == (c(15) + timedelta(seconds=14 / 15), c(19))
    assert [(p.parado, p.lado) for p in r.passos] == [(True, Lado.ANTES), (False, None)]

    grade = grade_do_gravador(g, CANAL, passagem, r.janela, agora=lambda: ASSENTOU)

    assert g.pedidos[2:] == [(CANAL, la(17), la(19))], "um pedido só, com a janela inteira"
    assert grade.instantes == tuple(c(17) + timedelta(seconds=i / 15) for i in (2, 7, 12, 17, 22, 27))
    assert (grade.colunas, grade.celula) == (3, (LARGURA, ALTURA))
    assert grade.imagem.shape == (2 * ALTURA + FIO, 3 * LARGURA + 2 * FIO, 3)
    assert int(grade.imagem[60:120].max()) > 240, "a mão (o quadrado branco) aparece nas células"
    assert list(passagem.iterdir()) == []


def test_a_busca_respeita_o_alvo_a_regua_e_o_teto_de_passos_de_quem_chama(pastas):
    video, passagem = pastas
    # O alvo é o canto de baixo, à direita, onde a mão não passa: ali o bloco da mão está parado.
    g = GravadorComCena(video, SEM_MOLHO)
    r = buscar_no_gravador(g, CANAL, passagem, c(13), c(19), juiz, caixa=(0.8, 0.8, 1.0, 1.0), agora=lambda: ASSENTOU)
    assert r.desfecho == APERTOU and [p.parado for p in r.passos] == [True, True], "com o alvo fora do caminho da mão, tudo parado"

    # Uma régua que pede 5 s parados não acha trecho parado em bloco de 2 s: todo bloco é "a mão".
    g = GravadorComCena(video, POSTO_E_COBERTO)
    r = buscar_no_gravador(g, CANAL, passagem, c(20), c(36), juiz, regua=Regua(tempo_parado_s=5.0), agora=lambda: ASSENTOU)
    assert r.desfecho == MAO and len(g.pedidos) == 1

    # O teto de passos.
    g = GravadorComCena(video, [(0, "antes"), (999, "depois")])
    r = buscar_no_gravador(g, CANAL, passagem, c(0), c(36), juiz, max_passos=2, agora=lambda: ASSENTOU)
    assert len(g.pedidos) == 2 and len(r.passos) == 2


def test_os_blocos_sao_os_do_perfil_do_gravador(pastas):
    video, passagem = pastas
    # Blocos de 2 s que começam em segundo ímpar DO GRAVADOR (o :53 de lá é o :28 daqui).
    # Com eles, o último bloco antes da olhada de :36 acaba em :36 — e é só ele que tem de ter assentado.
    g = GravadorComCena(video, POSTO_E_COBERTO, desvio=1)
    r = buscar_no_gravador(g, CANAL, passagem, c(20), c(36), juiz, max_passos=1, agora=lambda: c(36 + ATRASO))
    assert g.pedidos == [(CANAL, la(28), la(30))] and r.passos[0].de == c(28)
    with pytest.raises(AindaNaoAssentou):
        buscar_no_gravador(g, CANAL, passagem, c(20), c(36), juiz, agora=lambda: c(36 + ATRASO - 0.5))


# ───────────────────────── só o que já assentou ─────────────────────────


def test_antes_de_a_gravacao_assentar_nenhum_pedido_sai(pastas):
    video, passagem = pastas
    g = GravadorComCena(video, POSTO_E_COBERTO)

    with pytest.raises(AindaNaoAssentou) as e:
        buscar_no_gravador(g, CANAL, passagem, c(20), c(36), juiz, agora=lambda: ASSENTOU - timedelta(seconds=0.1))
    assert g.pedidos == [], "nada foi pedido ao gravador"
    assert e.value.espera_s == pytest.approx(0.1) and isinstance(e.value, VoltarDepois)
    assert "ainda não assentou no gravador: faltam 0.1 s" in str(e.value)

    # Bem mais cedo: diz quanto falta.
    with pytest.raises(AindaNaoAssentou) as e:
        buscar_no_gravador(g, CANAL, passagem, c(20), c(36), juiz, agora=lambda: c(40))
    assert e.value.espera_s == pytest.approx(37 + ATRASO - 40) and g.pedidos == []

    # No instante exato, já pode.
    assert buscar_no_gravador(g, CANAL, passagem, c(20), c(36), juiz, agora=lambda: ASSENTOU).desfecho == ACHOU


def test_o_que_tem_de_assentar_e_o_ultimo_bloco_que_a_busca_pode_ler(pastas):
    video, passagem = pastas
    # A olhada de depois cai EXATAMENTE no começo de um bloco do gravador (:35 daqui = :00 de lá): o último
    # bloco que a busca pode ler é o anterior, que acaba ali — não o que começa ali.
    g = GravadorComCena(video, POSTO_E_COBERTO)
    assert buscar_no_gravador(g, CANAL, passagem, c(20), c(35), juiz, agora=lambda: c(35 + ATRASO)).desfecho == ACHOU
    with pytest.raises(AindaNaoAssentou):
        buscar_no_gravador(g, CANAL, passagem, c(20), c(35), juiz, agora=lambda: c(35 + ATRASO - 0.5))

    # Um fio depois do começo do bloco, o bloco inteiro tem de ter assentado (até :37).
    with pytest.raises(AindaNaoAssentou) as e:
        buscar_no_gravador(g, CANAL, passagem, c(20), c(35.001), juiz, agora=lambda: c(35 + ATRASO))
    assert e.value.espera_s == pytest.approx(2.0)


def test_gravador_que_nao_foi_medido_nao_tem_busca_nem_grade(pastas):
    video, passagem = pastas
    g = GravadorComCena(video, POSTO_E_COBERTO, bloco=None, qps=None)
    with pytest.raises(SemPerfil, match="ainda não foi medido") as e:
        buscar_no_gravador(g, CANAL, passagem, c(20), c(36), juiz, agora=lambda: ASSENTOU)
    assert isinstance(e.value, ErroDoGravador) and not isinstance(e.value, VoltarDepois)
    with pytest.raises(SemPerfil):
        grade_do_gravador(g, CANAL, passagem, (c(17), c(19)), agora=lambda: ASSENTOU)
    with pytest.raises(SemPerfil):
        LeitorDeBlocos(g, CANAL, passagem)(la(26))
    assert g.pedidos == [] and g.relogios == 0, "nem a hora foi perguntada"


@pytest.mark.parametrize("de, ate", [(36, 36), (36, 20)])
def test_as_pontas_tem_de_estar_na_ordem(pastas, de, ate):
    video, passagem = pastas
    g = GravadorComCena(video, POSTO_E_COBERTO)
    with pytest.raises(ValueError, match="a ponta de depois vem depois da de antes"):
        buscar_no_gravador(g, CANAL, passagem, c(de), c(ate), juiz, agora=lambda: ASSENTOU)
    with pytest.raises(ValueError, match="a janela termina depois de começar"):
        grade_do_gravador(g, CANAL, passagem, (c(de), c(ate)), agora=lambda: ASSENTOU)
    assert g.pedidos == [] and g.relogios == 0, "pedido que não faz sentido não ocupa o gravador nem com a hora"


# ───────────────────────── o trecho conferido pelos quadros ─────────────────────────


def test_bloco_que_volta_cortado_nao_e_lido_e_a_busca_volta_depois(pastas):
    video, passagem = pastas
    # O gravador entrega 17 quadros no lugar de 30, com tudo o mais batendo.
    g = GravadorComCena(video, POSTO_E_COBERTO, cortar={1: 17})
    julgados: list[Leitura] = []

    with pytest.raises(TrechoIncompleto) as e:
        buscar_no_gravador(g, CANAL, passagem, c(20), c(36), lambda l: julgados.append(l) or Lado.ACHOU, agora=lambda: ASSENTOU)

    assert "o bloco das 19:51:52 veio com 17 de 30 quadros" in str(e.value)
    assert e.value.espera_s == ESPERA_DO_INCOMPLETO == 60.0 and isinstance(e.value, VoltarDepois)
    assert julgados == [], "quadro de bloco cortado não vai a juízo"
    assert len(g.pedidos) == 1 and list(passagem.iterdir()) == []

    # Um quadro a menos é tolerado (é a folga da conta): o bloco vale.
    g = GravadorComCena(video, POSTO_E_COBERTO, cortar={1: 29})
    assert buscar_no_gravador(g, CANAL, passagem, c(20), c(36), juiz, agora=lambda: ASSENTOU).desfecho == ACHOU


def test_bloco_que_o_leitor_nao_abre_tambem_volta_depois(pastas):
    video, passagem = pastas
    g = GravadorComCena(video, POSTO_E_COBERTO, cortar={1: 0})
    with pytest.raises(TrechoIncompleto, match="o leitor de vídeo não abriu o bloco das 19:51:52") as e:
        buscar_no_gravador(g, CANAL, passagem, c(20), c(36), juiz, agora=lambda: ASSENTOU)
    assert e.value.espera_s == ESPERA_DO_INCOMPLETO and list(passagem.iterdir()) == []


def test_o_erro_do_gravador_sobe_como_esta_e_nada_fica_no_disco(pastas):
    video, passagem = pastas
    g = GravadorComCena(video, POSTO_E_COBERTO, sem_gravacao=(1,))
    with pytest.raises(SemGravacao):
        buscar_no_gravador(g, CANAL, passagem, c(20), c(36), juiz, agora=lambda: ASSENTOU)
    assert len(g.pedidos) == 1 and list(passagem.iterdir()) == []

    # No segundo passo: o primeiro bloco foi lido e apagado; o erro do segundo sobe.
    g = GravadorComCena(video, SEM_MOLHO, sem_gravacao=(2,))
    with pytest.raises(SemGravacao):
        buscar_no_gravador(g, CANAL, passagem, c(13), c(19), juiz, agora=lambda: ASSENTOU)
    assert len(g.pedidos) == 2 and list(passagem.iterdir()) == []


def test_com_o_perfil_velho_o_bloco_volta_sem_gravacao_e_a_janela_com_um_bloco_a_menos(pastas):
    # Medido na loja de teste: num dia os blocos começavam em segundo par; no outro, em ímpar. O perfil guardado
    # diz par (desvio 0) e o gravador entrega em ímpar: o bloco pedido cai entre dois blocos de verdade.
    video, passagem = pastas
    g = GravadorComCena(video, POSTO_E_COBERTO, desvio=0, desvio_de_verdade=1)

    with pytest.raises(SemGravacao):
        buscar_no_gravador(g, CANAL, passagem, c(20), c(36), juiz, agora=lambda: ASSENTOU)
    assert len(g.pedidos) == 1 and list(passagem.iterdir()) == []

    # Na janela de três blocos voltam dois: quem lê percebe pela conta dos quadros, e não usa o vídeo do segundo ao lado.
    with pytest.raises(TrechoIncompleto, match="veio com 60 de 90 quadros"):
        grade_do_gravador(g, CANAL, passagem, (c(16.5), c(19.5)), agora=lambda: ASSENTOU)
    assert list(passagem.iterdir()) == []

    # Com o perfil medido de novo (desvio 1), tudo volta a fechar.
    medido = GravadorComCena(video, POSTO_E_COBERTO, desvio=1, desvio_de_verdade=1)
    assert buscar_no_gravador(medido, CANAL, passagem, c(20), c(36), juiz, agora=lambda: ASSENTOU).desfecho == ACHOU


def test_o_leitor_de_blocos_fala_a_hora_do_gravador_e_nao_confere_se_assentou(pastas):
    video, passagem = pastas
    g = GravadorComCena(video, POSTO_E_COBERTO)
    leitor = LeitorDeBlocos(g, CANAL, passagem)

    leitura = leitor(la(27))

    assert (leitura.de, leitura.ate) == (la(27), la(29))
    assert leitura.escolha.ts == la(27) + timedelta(seconds=14 / 15) and leitura.escolha.parado
    assert juiz(leitura) is Lado.ACHOU
    assert g.pedidos == [(CANAL, la(27), la(29))] and g.relogios == 0, "quem converte a hora é quem começa a busca"
    assert list(passagem.iterdir()) == []


def test_sem_a_taxa_do_gravador_nao_da_para_dizer_que_veio_cortado_e_o_bloco_e_lido(pastas):
    video, passagem = pastas
    # Perfil com bloco e sem taxa (não é o que a medida produz, mas pode estar guardado assim).
    g = GravadorComCena(video, POSTO_E_COBERTO, qps=None, cortar={1: 17})
    r = buscar_no_gravador(g, CANAL, passagem, c(20), c(36), juiz, agora=lambda: ASSENTOU)
    assert r.desfecho == ACHOU and r.passos[0].parado


# ───────────────────────── a grade ─────────────────────────


def test_a_grade_respeita_o_alvo_e_o_formato_de_quem_chama(pastas):
    video, passagem = pastas
    g = GravadorComCena(video, SEM_MOLHO)
    grade = grade_do_gravador(
        g, CANAL, passagem, (c(17), c(19)), caixa=(0.0, 0.0, 0.5, 1.0), quantos=4, colunas=2, agora=lambda: ASSENTOU,
    )
    assert (len(grade.instantes), grade.colunas, grade.celula) == (4, 2, (LARGURA // 2, ALTURA))
    assert grade.instantes == tuple(c(17) + timedelta(seconds=i / 15) for i in (3, 11, 18, 26))
    assert g.relogios == 1


def test_a_janela_da_grade_pode_passar_de_um_bloco_e_tem_tamanho_maximo(pastas):
    video, passagem = pastas
    g = GravadorComCena(video, SEM_MOLHO)
    # De :16,5 a :19,5 daqui: três blocos do gravador (de :15 a :21), num pedido só.
    grade = grade_do_gravador(g, CANAL, passagem, (c(16.5), c(19.5)), agora=lambda: c(21 + ATRASO))
    assert g.pedidos == [(CANAL, la(15), la(21))]
    assert all(c(16.5) < t < c(19.5) for t in grade.instantes) and len(grade.instantes) == 6

    # 40 s de gravação é o maior trecho de um pedido: janela que pede mais não sai — e nada é pedido.
    g = GravadorComCena(video, SEM_MOLHO)
    with pytest.raises(ValueError, match="a janela da grade cabe em 40 segundos de gravação"):
        grade_do_gravador(g, CANAL, passagem, (c(17), c(57.5)), agora=lambda: c(999))
    assert g.pedidos == []
    # Quarenta segundos certos, cabem.
    grade_do_gravador(g, CANAL, passagem, (c(17), c(57)), agora=lambda: c(999))
    assert g.pedidos == [(CANAL, la(17), la(57))]


def test_a_grade_tambem_so_pede_o_que_ja_assentou(pastas):
    video, passagem = pastas
    g = GravadorComCena(video, SEM_MOLHO)
    with pytest.raises(AindaNaoAssentou) as e:
        grade_do_gravador(g, CANAL, passagem, (c(17), c(19)), agora=lambda: c(19 + ATRASO - 3))
    assert e.value.espera_s == pytest.approx(3.0) and g.pedidos == []
    # A janela que passa do começo de um bloco espera esse bloco INTEIRO assentar.
    with pytest.raises(AindaNaoAssentou) as e:
        grade_do_gravador(g, CANAL, passagem, (c(17), c(19.2)), agora=lambda: c(19 + ATRASO))
    assert e.value.espera_s == pytest.approx(2.0) and g.pedidos == []
    assert grade_do_gravador(g, CANAL, passagem, (c(17), c(19)), agora=lambda: c(19 + ATRASO)) is not None


def test_janela_que_volta_cortada_nao_vira_grade(pastas):
    video, passagem = pastas
    # Três blocos (90 quadros); vieram 60: faltam quadros, e não se sabe onde.
    g = GravadorComCena(video, SEM_MOLHO, cortar={1: 60})
    with pytest.raises(TrechoIncompleto) as e:
        grade_do_gravador(g, CANAL, passagem, (c(16.5), c(19.5)), agora=lambda: ASSENTOU)
    assert "a janela das 19:51:41 veio com 60 de 90 quadros" in str(e.value)
    assert e.value.espera_s == ESPERA_DO_INCOMPLETO and list(passagem.iterdir()) == []

    # Dois a menos já é cortada; um a menos é a folga.
    g = GravadorComCena(video, SEM_MOLHO, cortar={1: 88, 2: 89})
    with pytest.raises(TrechoIncompleto, match="88 de 90"):
        grade_do_gravador(g, CANAL, passagem, (c(16.5), c(19.5)), agora=lambda: ASSENTOU)
    assert grade_do_gravador(g, CANAL, passagem, (c(16.5), c(19.5)), agora=lambda: ASSENTOU) is not None

    # O arquivo que o leitor não abre.
    g = GravadorComCena(video, SEM_MOLHO, cortar={1: 0})
    with pytest.raises(TrechoIncompleto, match="o leitor de vídeo não abriu a janela das 19:51:42") as e:
        grade_do_gravador(g, CANAL, passagem, (c(17), c(19)), agora=lambda: ASSENTOU)
    assert e.value.espera_s == ESPERA_DO_INCOMPLETO and list(passagem.iterdir()) == []


def test_grade_que_ficaria_com_buraco_volta_depois(pastas):
    video, passagem = pastas
    # Falta UM quadro (dentro da folga da conta), mas a grade de 30 pede justamente o último.
    g = GravadorComCena(video, SEM_MOLHO, cortar={1: 29})
    with pytest.raises(TrechoIncompleto, match="faltaram 1 de 30 quadros da grade") as e:
        grade_do_gravador(g, CANAL, passagem, (c(17), c(19)), quantos=30, colunas=6, agora=lambda: ASSENTOU)
    assert e.value.espera_s == ESPERA_DO_INCOMPLETO and list(passagem.iterdir()) == []


def test_o_erro_do_gravador_na_grade_sobe_como_esta(pastas):
    video, passagem = pastas
    g = GravadorComCena(video, SEM_MOLHO, sem_gravacao=(1,))
    with pytest.raises(SemGravacao):
        grade_do_gravador(g, CANAL, passagem, (c(17), c(19)), agora=lambda: ASSENTOU)
    assert list(passagem.iterdir()) == []


def test_a_espera_do_trecho_cortado_e_a_do_agente_e_nao_numero_de_aparelho():
    assert gravado.ESPERA_DO_INCOMPLETO == 60.0
