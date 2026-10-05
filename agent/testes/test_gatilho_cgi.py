"""O primeiro estágio do gatilho: o gravador diz que mexeu.

O que se protege aqui é dinheiro e confiança. Cada evento que passa vira
uma análise; cada evento que não devia passar vira uma análise paga à
toa. E cada evento que devia passar e não passou vira alerta que a loja
nunca recebeu.
"""

from __future__ import annotations

import pytest

from farol_agent.dvr.dahua import Evento
from farol_agent.gatilhos.cgi import GatilhoCGI


class ClienteFalso:
    def __init__(self, eventos):
        self._eventos = eventos

    def eventos(self, codigos="All", **kw):
        self.codigos_pedidos = codigos
        return iter(self._eventos)


def gatilho(eventos, **kw):
    mapa = kw.pop("canal_para_ponto", {1: "cozinha", 5: "chapa", 11: "montagem"})
    return GatilhoCGI(ClienteFalso(eventos), canal_para_ponto=mapa, **kw)


def ev(codigo, acao="Start", indice=0, **dados):
    return Evento(codigo=codigo, acao=acao, indice=indice, dados=dados)


# ───────────────────────── o que vira gatilho ─────────────────────────


def test_movimento_vira_evento_no_ponto_certo():
    g = gatilho([ev("VideoMotion", indice=10)])   # canal 11

    saida = list(g.eventos())

    assert len(saida) == 1
    assert saida[0].ponto_id == "montagem"
    assert saida[0].origem == "dvr_cgi"
    assert saida[0].bruto["canal"] == 11


def test_classe_vem_preenchida_quando_o_gravador_classifica():
    """A MHDX classifica em UM canal; nos outros chega movimento puro.

    É exatamente por isso que o gatilho tem dois estágios: onde a classe
    vem vazia, quem decide 'é pessoa?' é o detector local.
    """
    g = gatilho([ev("SmartMotionHuman", indice=0), ev("VideoMotion", indice=0)])

    classes = [e.classe for e in g.eventos()]

    assert classes == ["pessoa", None]


def test_stop_nao_dispara_segunda_analise():
    """Analisar no início e no fim dobraria o custo pela mesma cena."""
    g = gatilho([ev("VideoMotion", acao="Start"), ev("VideoMotion", acao="Stop")])

    assert len(list(g.eventos())) == 1


def test_pulse_dispara():
    g = gatilho([ev("CrossLineDetection", acao="Pulse")])
    assert len(list(g.eventos())) == 1


def test_stop_passa_quando_a_regra_quiser_os_dois():
    g = gatilho([ev("VideoMotion", acao="Stop")], so_inicio=False)
    assert len(list(g.eventos())) == 1


# ─────────────────────── o que NÃO pode virar gatilho ──────────────────


def test_video_loss_nao_vira_analise():
    """Sem sinal não há o que julgar — pagar modelo por isso é desperdício."""
    g = gatilho([ev("VideoLoss")])

    assert list(g.eventos()) == []
    assert g.descartados["VideoLoss"] == 1


def test_ruido_do_gravador_e_descartado_e_contado():
    """Login, disco e configuração não são auditoria de processo.

    Contar em vez de só ignorar: se um código desconhecido aparecer aos
    milhares, isso tem que ser visível, não silencioso.
    """
    g = gatilho([ev("AlarmUserLogin"), ev("StorageLowSpace"), ev("AlarmUserLogin")])

    assert list(g.eventos()) == []
    assert g.descartados["AlarmUserLogin"] == 2
    assert g.descartados["StorageLowSpace"] == 1


def test_canal_sem_ponto_cadastrado_nao_estoura():
    """Gravador de 16 com 4 câmeras é o caso normal, não erro."""
    g = gatilho([ev("VideoMotion", indice=14)])   # canal 15, não cadastrado

    assert list(g.eventos()) == []
    assert g.descartados["canal_15_sem_ponto"] == 1


# ──────────────────────────── a assinatura ─────────────────────────────


def test_assina_tudo_e_filtra_aqui():
    """O firmware trunca a lista de codes por volta de 100 caracteres.

    Lista grande chega cortada e o gravador assina um conjunto diferente
    do pedido, SEM avisar. Assinar [All] e descartar do lado de cá é o
    único jeito de saber o que foi descartado.
    """
    cliente = ClienteFalso([ev("VideoMotion")])
    g = GatilhoCGI(cliente, canal_para_ponto={1: "p"})

    list(g.eventos())

    assert cliente.codigos_pedidos == "All"


def test_fechar_interrompe():
    g = gatilho([ev("VideoMotion"), ev("VideoMotion"), ev("VideoMotion")])
    saida = []
    for e in g.eventos():
        saida.append(e)
        g.fechar()
    assert len(saida) == 1
