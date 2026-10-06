"""O motor ligado à configuração e à nuvem.

Até esta peça, as duas metades existiam separadas: o `servir` falava com
a nuvem; o motor rodava só contra material gravado. O agente conversava
e **não auditava nada**.

O que se testa aqui é o que mantém isso de pé por uma semana: remontar
quando a configuração muda, não derrubar o laço quando uma câmera cai, e
não perder evento quando a nuvem recusa.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import numpy as np

from farol_agent.auditoria import Auditoria
from farol_agent.configuracao import de_json
from farol_agent.modelos import Frame, Resultado, Veredito, Via
from farol_agent.nuvem import ErroDaNuvem

from .test_configuracao import resposta


class FonteBoa:
    def __init__(self, ponto_id="p1", semente=0):
        self.ponto_id = ponto_id
        self.semente = semente
        self.fechada = False

    def rajada(self, ts, quantidade=6, stream="main"):
        rng = np.random.default_rng(self.semente)
        return [
            Frame(
                rng.integers(0, 255, (480, 640, 3), dtype=np.uint8),
                ts + timedelta(milliseconds=100 * i),
                self.ponto_id,
            )
            for i in range(quantidade)
        ]

    def fechar(self):
        self.fechada = True


class FonteCaida:
    ponto_id = "p1"

    def rajada(self, *a, **k):
        raise OSError("camera nao responde")

    def fechar(self):
        pass


class JuizDeTeste:
    nome = "teste"

    def __init__(self, resultado=Resultado.NAO_CONFORME):
        self.resultado = resultado
        self.chamadas = 0

    def julgar(self, imagem, criterio, *, contexto=None, referencias=None):
        self.chamadas += 1
        return Veredito(
            resultado=self.resultado,
            confianca=0.95,
            motivo="duble",
            via=Via.NUVEM,
            modelo="teste",
            custo_centavos=1.07,
        )


class NuvemDeTeste:
    def __init__(self, erro=None):
        self.erro = erro
        self.enviados: list[dict] = []

    def _pedir(self, metodo, caminho, corpo=None):
        if self.erro:
            raise self.erro
        self.enviados.append({"caminho": caminho, "corpo": corpo})
        return {"ok": True}


def config_com_regra(versao=1, ativa=True):
    return de_json(resposta(versao=versao, com_regra=ativa))


def montar(tmp_path, *, nuvem=None, fonte=None, juiz=None, versao=1):
    a = Auditoria(
        nuvem or NuvemDeTeste(),
        str(tmp_path / "fila.db"),
        construir_fonte=lambda ponto: fonte or FonteBoa(ponto.id),
        construir_juiz=lambda cfg: juiz or JuizDeTeste(),
    )
    a.montar(config_com_regra(versao=versao))
    return a


# ──────────────────────────── montagem ────────────────────────────


def test_monta_motor_fonte_e_juiz_a_partir_da_configuracao(tmp_path):
    a = montar(tmp_path)

    assert a.motor is not None
    assert a.juiz is not None
    assert list(a.fontes) == ["p1"]
    assert a.versao_montada == 1


def test_remontar_com_a_MESMA_versao_nao_refaz_nada(tmp_path):
    # Remontar a cada batida fecharia e reabriria o RTSP de todos os
    # canais a cada poucos segundos — e o gravador tem poucos fluxos.
    a = montar(tmp_path)
    antes = a.fontes["p1"]

    a.montar(config_com_regra(versao=1))

    assert a.fontes["p1"] is antes


def test_versao_nova_remonta_e_PRESERVA_a_fonte_do_mesmo_ponto(tmp_path):
    # Regra ligada ou área redesenhada não pode custar a reabertura do
    # fluxo: o ponto é o mesmo.
    a = montar(tmp_path)
    antes = a.fontes["p1"]

    a.montar(config_com_regra(versao=2))

    assert a.versao_montada == 2
    assert a.fontes["p1"] is antes, "reabriu o canal à toa"


def test_ponto_sem_regra_nao_abre_camera(tmp_path):
    # Abrir câmera que ninguém audita é fluxo do gravador gasto à toa.
    a = Auditoria(
        NuvemDeTeste(),
        str(tmp_path / "fila.db"),
        construir_fonte=lambda ponto: FonteBoa(ponto.id),
        construir_juiz=lambda cfg: JuizDeTeste(),
    )
    a.montar(de_json(resposta(com_regra=False)))

    assert a.fontes == {}


def test_ponto_que_nao_abre_nao_impede_os_outros(tmp_path):
    def explodir(ponto):
        raise OSError("sem rota para o host")

    a = Auditoria(
        NuvemDeTeste(),
        str(tmp_path / "fila.db"),
        construir_fonte=explodir,
        construir_juiz=lambda cfg: JuizDeTeste(),
    )
    a.montar(config_com_regra())

    assert a.fontes == {}
    assert a.motor is not None, "o motor existe mesmo sem fonte"


# ───────────────────────── captura e julgamento ─────────────────────────


def test_o_ciclo_completo_enfileira_julga_e_sobe(tmp_path):
    nuvem = NuvemDeTeste()
    juiz = JuizDeTeste()
    a = montar(tmp_path, nuvem=nuvem, juiz=juiz)

    r = a.passo(datetime(2026, 10, 6, 12, 0, 0))

    assert r["enfileirados"] == 1
    assert juiz.chamadas == 1
    assert r["alertas"] == 1
    assert r["subidos"] == 1
    assert nuvem.enviados[0]["caminho"] == "/v1/eventos"


def test_o_evento_leva_a_chave_da_FILA_e_a_versao_do_criterio(tmp_path):
    """Chave inventada na subida anularia a proteção contra duplicata.

    E sem `criterio_versao` no evento, um veredito de ontem aponta para a
    redação de hoje.
    """
    nuvem = NuvemDeTeste()
    a = montar(tmp_path, nuvem=nuvem)
    a.passo(datetime(2026, 10, 6, 12, 0, 0))

    evento = nuvem.enviados[0]["corpo"]["eventos"][0]
    assert len(evento["idempotencia_key"]) >= 16, "é o hash da fila, não um id solto"
    assert evento["criterio_versao"] == 2
    assert evento["custo_centavos"] == 1.07


def test_camera_caida_nao_derruba_o_passo(tmp_path):
    # Uma câmera que cai de madrugada não pode parar a auditoria das
    # outras — e numa semana de operação isso acontece.
    a = montar(tmp_path, fonte=FonteCaida())

    r = a.passo()

    assert r["enfileirados"] == 0


def test_nuvem_fora_NAO_descarta_o_evento(tmp_path):
    """Evento perdido é auditoria perdida, e não se recupera: a cena já
    passou."""
    nuvem = NuvemDeTeste(erro=ErroDaNuvem("sem rede"))
    a = montar(tmp_path, nuvem=nuvem)

    r = a.passo(datetime(2026, 10, 6, 12, 0, 0))

    assert r["alertas"] == 1
    assert r["subidos"] == 0
    assert a.ultimo_erro is not None, "tem que registrar o motivo"


def test_sem_juiz_captura_mesmo_assim(tmp_path):
    def sem_juiz(cfg):
        raise RuntimeError("ANTHROPIC_API_KEY ausente")

    a = Auditoria(
        NuvemDeTeste(),
        str(tmp_path / "fila.db"),
        construir_fonte=lambda ponto: FonteBoa(ponto.id),
        construir_juiz=sem_juiz,
    )
    a.montar(config_com_regra())

    # Hora dentro da janela da regra (08:00-18:00). Sem isso o motor
    # recusa a captura — corretamente — e o teste mediria outra coisa.
    r = a.passo(datetime(2026, 10, 6, 12, 0, 0))

    assert a.juiz is None
    assert r["enfileirados"] == 1, "captura mesmo sem juiz: a fila guarda"
    assert r["alertas"] == 0
    assert "ANTHROPIC_API_KEY" in str(a.ultimo_erro)


def test_a_cena_repetida_nao_vira_analise_nova(tmp_path):
    """É o que torna a amostragem barata.

    Numa cozinha parada, mil capturas viram zero chamadas — e é por isso
    que dá para amostrar periodicamente em vez de depender do gatilho do
    gravador na primeira semana.
    """
    juiz = JuizDeTeste()
    a = montar(tmp_path, juiz=juiz)

    base = datetime(2026, 10, 6, 12, 0, 0)
    a.passo(base)
    a.passo(base + timedelta(seconds=30))

    assert juiz.chamadas == 1, "a segunda captura é a mesma cena"


def test_parar_fecha_as_fontes(tmp_path):
    # Fluxo RTSP deixado aberto é fluxo que o gravador não devolve.
    fonte = FonteBoa()
    a = montar(tmp_path, fonte=fonte)

    a.parar()

    assert fonte.fechada is True
    assert a.fontes == {}
