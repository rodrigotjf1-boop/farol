"""A busca pelo meio: a conta, sem gravador e sem juiz de verdade.

Quem lê o bloco e quem julga o quadro são de mentira: o que se prova é o
CAMINHO da busca — que bloco ela pede, para que lado anda, quando para e o
que devolve. Os dois primeiros casos são os lotes da rodada 5 do teste das
fichas (`docs/teste-das-fichas.md`, "A busca pelo meio, nos lotes").

O que tem de ficar provado:

- o primeiro bloco pedido é o do meio, e cada resposta corta a dúvida;
- achou → para ali; a mão em cima → o quadro NÃO vai a juízo, e o bloco é a
  janela da grade; bloco já lido → apertou; juiz que não sabe → a busca não
  chuta; passos contados;
- quadro de fora das pontas não alarga a dúvida;
- o que o leitor ou o juiz levantam sobe como está.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import numpy as np
import pytest

from farol_agent.sequencia import busca
from farol_agent.sequencia.bloco import Escolha
from farol_agent.sequencia.busca import ACHOU, APERTOU, LIMITE, MAO, NAO_SEI, Lado, Leitura, Passo, buscar

BASE = datetime(2026, 10, 9, 19, 51, 0)
PRETO = np.zeros((2, 2, 3), dtype=np.uint8)


def s(segundos: float) -> datetime:
    return BASE + timedelta(seconds=segundos)


class Cena:
    """Um gravador e um juiz de mentira, em cima de uma história contada em segundos a partir da BASE.

    Até `muda_em` a cena está como ANTES; depois, como DEPOIS. Entre `visto_de`
    e `visto_ate` o que se procura está à vista. Nos blocos de `mao`, o alvo
    está coberto pela mão (não há quadro parado). O quadro escolhido de cada
    bloco fica `no_bloco` segundos depois do começo dele.
    """

    def __init__(
        self, *, muda_em: float, visto: tuple[float, float] | None = None, mao: tuple[float, ...] = (),
        bloco_s: int = 2, no_bloco: float = 1.0, respostas: dict[float, object] | None = None,
    ) -> None:
        self.muda_em, self.visto, self.mao = muda_em, visto, mao
        self.bloco_s, self.no_bloco = bloco_s, no_bloco
        self.respostas = respostas or {}
        self.lidos: list[float] = []
        self.julgados: list[float] = []

    def ler(self, comeco: datetime) -> Leitura:
        segundo = (comeco - BASE).total_seconds()
        self.lidos.append(segundo)
        parado = 0 if segundo in self.mao else 8
        escolha = Escolha(indice=15, quadros=30, ts=comeco + timedelta(seconds=self.no_bloco), parado_quadros=parado,
                          movimento=0.0, imagem=PRETO, esperados=30)
        return Leitura(de=comeco, ate=comeco + timedelta(seconds=self.bloco_s), escolha=escolha)

    def julgar(self, leitura: Leitura):
        segundo = (leitura.de - BASE).total_seconds()
        self.julgados.append(segundo)
        if segundo in self.respostas:
            return self.respostas[segundo]
        t = (leitura.escolha.ts - BASE).total_seconds()
        if self.visto and self.visto[0] <= t < self.visto[1]:
            return Lado.ACHOU
        return Lado.ANTES if t < self.muda_em else Lado.DEPOIS

    def buscar(self, de: float, ate: float, **mais):
        return buscar(self.ler, self.julgar, s(de), s(ate), bloco_s=self.bloco_s, **mais)


# ───────────────────────── os lotes da rodada 5 ─────────────────────────


def test_o_que_se_procura_ficou_a_vista_um_passo_basta():
    # D1: nua às 19:51:20, coberta às 19:51:36; o molho ficou à vista de :25 a :31.
    cena = Cena(muda_em=31, visto=(25, 31))

    r = cena.buscar(20, 36)

    assert cena.lidos == [28], "o bloco do meio, e só ele"
    assert (r.desfecho, r.achou) == (ACHOU, True)
    assert (r.de, r.ate) == (s(28), s(30)), "achou: o que se devolve é o bloco em que foi achado"
    assert r.instante == s(29) and r.janela is None, "não há mais o que perguntar"
    assert r.passos == (Passo(de=s(28), ate=s(30), ts=s(29), parado=True, lado=Lado.ACHOU),)


def test_nao_houve_a_busca_aperta_ate_a_janela_da_mao():
    # A: nua às 23:50:14, coberta às 23:50:20, sem molho; em :18 a mão está em cima da tampa.
    cena = Cena(muda_em=19.5, mao=(18,))

    r = cena.buscar(14, 20)

    assert cena.lidos == [16, 18], "dois blocos"
    assert cena.julgados == [16], "a mão em cima NÃO vai a juízo"
    assert (r.desfecho, r.achou) == (MAO, False)
    assert r.janela == (s(18), s(20)), "a janela da grade é o bloco da mão"
    assert (r.de, r.ate) == (s(17), s(20)), "a dúvida que sobra: do último quadro nu até a ponta coberta"
    assert r.instante == s(19)
    assert r.passos == (
        Passo(de=s(16), ate=s(18), ts=s(17), parado=True, lado=Lado.ANTES),
        Passo(de=s(18), ate=s(20), ts=s(19), parado=False, lado=None),
    )


# ───────────────────────── para que lado anda, e quando para ─────────────────────────


def test_sem_achar_e_sem_mao_a_busca_aperta_ate_nao_haver_quadro_novo():
    # A cena muda em :18,5 de uma vez: nenhum quadro mostra o meio.
    cena = Cena(muda_em=18.5)

    r = cena.buscar(14, 20)

    assert cena.lidos == [16, 18], "nua em :17 → anda para a frente; coberta em :19 → o meio cai num bloco já lido"
    assert r.desfecho == APERTOU
    assert (r.de, r.ate) == (s(17), s(19)) and r.janela == (s(17), s(19)), "sobra a dúvida, do tamanho de um bloco"
    assert r.instante == s(19), "o último quadro julgado"
    assert [p.lado for p in r.passos] == [Lado.ANTES, Lado.DEPOIS]


def test_ja_estava_como_depois_a_busca_anda_para_tras():
    cena = Cena(muda_em=3)

    r = cena.buscar(0, 32, max_passos=3)

    # 16 → coberta em :17 → depois = 17; 8,5 → bloco 8, coberta em :9; 4,5 → bloco 4, coberta em :5
    assert cena.lidos == [16, 8, 4]
    assert r.desfecho == LIMITE and (r.de, r.ate) == (s(0), s(5))


def test_cada_passo_corta_a_duvida_pela_metade_e_os_passos_tem_teto():
    assert busca.MAX_PASSOS == 6
    cena = Cena(muda_em=127.5)

    r = cena.buscar(0, 128)

    assert cena.lidos == [64, 96, 112, 120, 124, 126], "sempre nua: a busca vai para a frente, metade de cada vez"
    assert r.desfecho == LIMITE and len(r.passos) == 6
    assert (r.de, r.ate) == (s(127), s(128)) and r.janela == (s(127), s(128))
    assert r.instante == s(127)

    curta = Cena(muda_em=127.5)
    r = curta.buscar(0, 128, max_passos=2)
    assert curta.lidos == [64, 96] and r.desfecho == LIMITE and (r.de, r.ate) == (s(97), s(128))

    um = Cena(muda_em=127.5)
    assert um.buscar(0, 128, max_passos=1).passos == (Passo(s(64), s(66), s(65), True, Lado.ANTES),)


def test_o_juiz_que_nao_sabe_para_a_busca_e_ela_nao_chuta_um_lado():
    cena = Cena(muda_em=30, respostas={16: Lado.NAO_SEI})

    r = cena.buscar(0, 32)

    assert cena.lidos == [16]
    assert r.desfecho == NAO_SEI and r.instante == s(17)
    assert (r.de, r.ate) == (s(0), s(32)) and r.janela == (s(0), s(32)), "as pontas ficam onde estavam"
    assert r.passos[0].lado is Lado.NAO_SEI


@pytest.mark.parametrize("estranha", ["talvez", "", None, 7, "ANTES", object()])
def test_resposta_que_nao_e_nenhum_dos_lados_vale_como_nao_sei(estranha):
    cena = Cena(muda_em=30, respostas={16: estranha})
    r = cena.buscar(0, 32)
    assert (r.desfecho, r.passos[0].lado, cena.lidos) == (NAO_SEI, Lado.NAO_SEI, [16])


def test_o_juiz_pode_responder_com_a_palavra_do_lado():
    # Quem julga pode devolver o texto ("antes", "depois", "achou"): é o mesmo lado.
    cena = Cena(muda_em=30, respostas={16: "antes", 24: "depois", 20: "achou"})
    r = cena.buscar(0, 32)
    assert cena.lidos == [16, 24, 20]
    assert [p.lado for p in r.passos] == [Lado.ANTES, Lado.DEPOIS, Lado.ACHOU] and r.achou


# ───────────────────────── o quadro de fora das pontas ─────────────────────────


def test_quadro_de_antes_da_ponta_nao_alarga_a_duvida():
    # As duas olhadas caem no mesmo bloco, e o quadro parado dele é de ANTES da primeira.
    cena = Cena(muda_em=1.5, no_bloco=1.0)

    r = cena.buscar(1.2, 1.8)

    assert cena.lidos == [0], "o bloco é lido uma vez só"
    assert r.desfecho == APERTOU
    assert (r.de, r.ate) == (s(1.2), s(1.8)), "o quadro de :01,0 é de antes da ponta: não diz nada de novo"


def test_quadro_de_depois_da_ponta_tambem_nao():
    cena = Cena(muda_em=0.5, no_bloco=1.9)
    r = cena.buscar(1.2, 1.8)
    assert cena.lidos == [0] and r.desfecho == APERTOU and (r.de, r.ate) == (s(1.2), s(1.8))


def test_resposta_que_contradiz_a_ponta_nao_inverte_a_duvida():
    # O quadro é de DEPOIS da ponta de depois, e o juiz diz "antes": a busca não troca as pontas de lugar.
    cena = Cena(muda_em=99, no_bloco=1.9)
    r = cena.buscar(1.2, 1.8)
    assert r.desfecho == APERTOU and (r.de, r.ate) == (s(1.2), s(1.8)) and r.de < r.ate
    assert r.passos[0].lado is Lado.ANTES

    # E o contrário: quadro de antes da ponta de antes, dito "depois".
    cena = Cena(muda_em=-5, no_bloco=1.0)
    r = cena.buscar(1.2, 1.8)
    assert r.desfecho == APERTOU and (r.de, r.ate) == (s(1.2), s(1.8))


def test_quadro_em_cima_da_ponta_nao_conta_como_de_dentro():
    # O quadro escolhido é exatamente o instante da olhada de antes: nada de novo.
    cena = Cena(muda_em=99, no_bloco=1.0)
    r = cena.buscar(1.0, 1.8)
    assert r.desfecho == APERTOU and (r.de, r.ate) == (s(1.0), s(1.8))

    # Nem o que cai exatamente na olhada de depois — mesmo dito "antes", a dúvida não vira um ponto.
    cena = Cena(muda_em=99, no_bloco=1.9)
    r = cena.buscar(1.2, 1.9)
    assert r.desfecho == APERTOU and (r.de, r.ate) == (s(1.2), s(1.9))

    # E o da olhada de antes, dito "depois": também não.
    cena = Cena(muda_em=-5, no_bloco=1.0)
    r = cena.buscar(1.0, 1.8)
    assert r.desfecho == APERTOU and (r.de, r.ate) == (s(1.0), s(1.8))


# ───────────────────────── os blocos do gravador ─────────────────────────


def test_os_blocos_sao_os_do_gravador_com_o_tamanho_e_o_desvio_dele():
    # Blocos de 2 s que começam em segundo ímpar.
    cena = Cena(muda_em=99)
    r = buscar(cena.ler, cena.julgar, s(20), s(36), bloco_s=2, desvio_s=1, max_passos=1)
    assert cena.lidos == [27] and r.passos[0].de == s(27), "o meio (:28) cai no bloco que começa em :27"

    # Blocos de 5 s.
    cena = Cena(muda_em=99, bloco_s=5)
    r = cena.buscar(20, 36, max_passos=1)
    assert cena.lidos == [25] and (r.passos[0].de, r.passos[0].ate) == (s(25), s(30))


@pytest.mark.parametrize("de, ate", [(20, 20), (20, 19.999)])
def test_as_pontas_tem_de_estar_na_ordem(de, ate):
    cena = Cena(muda_em=0)
    with pytest.raises(ValueError, match="a ponta de depois vem depois da de antes"):
        cena.buscar(de, ate)
    assert cena.lidos == []


def test_passo_nenhum_e_bloco_sem_tamanho_nao_sao_busca():
    cena = Cena(muda_em=0)
    with pytest.raises(ValueError, match="pelo menos um passo"):
        cena.buscar(0, 10, max_passos=0)
    with pytest.raises(ValueError, match="o bloco tem pelo menos 1 segundo"):
        buscar(cena.ler, cena.julgar, s(0), s(10), bloco_s=0)
    assert cena.lidos == []


# ───────────────────────── o que sobe como está ─────────────────────────


class Cedo(Exception):
    pass


def test_o_que_o_leitor_levanta_sobe_como_esta_e_o_juiz_nem_e_chamado():
    cena = Cena(muda_em=30)

    def ler(comeco):
        if comeco == s(24):
            raise Cedo("a gravação ainda não assentou")
        return cena.ler(comeco)

    with pytest.raises(Cedo):
        buscar(ler, cena.julgar, s(0), s(32), bloco_s=2)
    assert cena.julgados == [16], "o primeiro bloco foi julgado; o segundo não chegou"


def test_o_que_o_juiz_levanta_sobe_como_esta():
    cena = Cena(muda_em=30)

    def julgar(leitura):
        raise Cedo("o juiz está fora")

    with pytest.raises(Cedo):
        buscar(cena.ler, julgar, s(0), s(32), bloco_s=2)
    assert cena.lidos == [16]
