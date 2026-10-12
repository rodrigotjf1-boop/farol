"""O que a loja julga sozinha sai logo depois de cada canal (A20, fatia 1.1b).

A volta abre os canais um a um, e cada um leva de um a dois segundos para
abrir. O julgamento vinha só no fim: a resposta do primeiro canal esperava a
captura de todos os outros. Medido na loja de teste, com dois canais, depois
da fatia 1.1: 2,9 s no critério do primeiro canal e 1,3 s no do último
(medianas; docs/decisoes.md, 12/10/2026). Com mais canais a espera do
primeiro cresce na mesma medida.

O que estes testes protegem:

1. o que o DETECTOR julga sai antes de o canal seguinte ser aberto — na
   rotina e na olhada extra do vigia;
2. o que vai à nuvem continua no fim da volta: uma chamada de segundos no
   meio da captura atrasaria os canais que faltam;
3. o aviso que nasce no meio da captura é devolvido pela volta, e sobe nela;
4. falhar ao julgar no meio não impede a captura dos outros canais;
5. sem nada julgado pelo detector, a volta é a de sempre.
"""

from __future__ import annotations

import copy
from datetime import timedelta

import numpy as np
import pytest

from farol_agent.auditoria import Auditoria
from farol_agent.configuracao import de_json
from farol_agent.juizes.seletor import JuizPorRegra, SeletorDeJuiz
from farol_agent.modelos import Frame, Resultado, Veredito, Via
from testes.conftest import BASE

from .test_auditoria import JuizDeTeste, NuvemDeTeste
from .test_configuracao import resposta

CANAIS = ("p1", "p2", "p3")


class Fonte:
    """Um canal que anota quando foi aberto."""

    def __init__(self, ponto_id: str, diario: list, semente: int) -> None:
        self.ponto_id = ponto_id
        self.diario = diario
        self.semente = semente
        self.aberturas = 0

    def rajada(self, ts, quantidade=6, stream="main"):
        self.diario.append(f"captura {self.ponto_id}")
        self.aberturas += 1
        # Uma cena por abertura: a memória de cena repetida não segura a olhada seguinte.
        rng = np.random.default_rng(1000 * self.semente + self.aberturas)
        return [
            Frame(rng.integers(0, 255, (480, 640, 3), dtype=np.uint8), ts + timedelta(milliseconds=100 * i), self.ponto_id)
            for i in range(quantidade)
        ]

    def fechar(self) -> None:
        pass


class Detector:
    nome = "detector"

    def __init__(self, diario: list, resultado: Resultado = Resultado.CONFORME, quebra_em: str | None = None) -> None:
        self.diario = diario
        self.resultado = resultado
        self.quebra_em = quebra_em

    def atende(self, parametros) -> None:
        pass

    def julgar(self, imagem, criterio, *, contexto=None, referencias=None) -> Veredito:
        self.diario.append(f"detector {contexto['regra_id']}")
        return Veredito(resultado=self.resultado, confianca=0.95, motivo="vi", via=Via.DETECTOR, modelo="d", medida=0.0)


class Nuvem:
    nome = "nuvem"

    def __init__(self, diario: list) -> None:
        self.diario = diario

    def julgar(self, imagem, criterio, *, contexto=None, referencias=None) -> Veredito:
        self.diario.append(f"nuvem {contexto['regra_id']}")
        return Veredito(resultado=Resultado.CONFORME, confianca=0.9, motivo="ok", via=Via.NUVEM, modelo="n", custo_centavos=1.0)


def tres_canais(*, presenca: bool = True, estado: bool = True, versao: int = 5) -> dict:
    """Três canais; em cada um, um critério de presença (`pre-pN`) e um de estado (`est-pN`), valendo sempre."""
    corpo = resposta(versao=versao)
    modelo = corpo["pontos"][0]
    base = {**modelo["zonas"][0]["regras"][0], "janelas": [], "quando": "sempre", "cooldownMin": 0}
    pontos = []
    for n, ponto_id in enumerate(CANAIS, start=1):
        p = copy.deepcopy(modelo)
        p.update(id=ponto_id, nome=f"canal {n}", canal=n)
        regras = []
        if presenca:
            regras.append({
                **base, "id": f"pre-{ponto_id}", "nome": f"presença {n}", "tipo": "presenca",
                "parametros": {"objeto": "pessoa", "minimo": 1},
            })
        if estado:
            regras.append({**base, "id": f"est-{ponto_id}", "nome": f"estado {n}"})
        p["zonas"][0].update(id=f"z-{ponto_id}", regras=regras)
        pontos.append(p)
    corpo["pontos"] = pontos
    return corpo


def auditoria(tmp_path, corpo: dict, *, detector_diz: Resultado = Resultado.CONFORME, juiz=None):
    diario: list[str] = []
    nuvem_do_farol = NuvemDeTeste()
    detector = Detector(diario, detector_diz)
    a = Auditoria(
        nuvem_do_farol, str(tmp_path / "fila.db"),
        construir_fonte=lambda ponto: Fonte(ponto.id, diario, CANAIS.index(ponto.id)),
        construir_juiz=(lambda cfg: juiz) if juiz is not None else (
            lambda cfg: JuizPorRegra(
                SeletorDeJuiz("nuvem", nuvem=Nuvem(diario), detector=detector), {r.id: r for r in cfg.regras}
            )
        ),
        medidor=None,
    )
    a.montar(de_json(corpo))
    return a, diario, nuvem_do_farol


def test_o_que_o_detector_julga_sai_antes_de_o_canal_seguinte_ser_aberto(tmp_path):
    a, diario, _ = auditoria(tmp_path, tres_canais(estado=False))

    a.passo(BASE)

    assert diario == [
        "captura p1", "detector pre-p1",
        "captura p2", "detector pre-p2",
        "captura p3", "detector pre-p3",
    ]
    a.fila.fechar()


def test_o_que_vai_a_nuvem_continua_no_fim_da_volta(tmp_path):
    a, diario, _ = auditoria(tmp_path, tres_canais())

    a.passo(BASE)

    capturas = [i for i, linha in enumerate(diario) if linha.startswith("captura")]
    da_nuvem = [i for i, linha in enumerate(diario) if linha.startswith("nuvem")]
    assert len(capturas) == 3 and len(da_nuvem) == 3
    assert min(da_nuvem) > max(capturas), f"a nuvem foi chamada no meio da captura: {diario}"
    # E o detector, cada um logo depois do seu canal.
    for ponto_id in CANAIS:
        assert diario.index(f"detector pre-{ponto_id}") == diario.index(f"captura {ponto_id}") + 1, diario
    a.fila.fechar()


def test_o_aviso_que_nasce_no_meio_da_captura_e_devolvido_pela_volta_e_sobe_nela(tmp_path):
    a, _, nuvem_do_farol = auditoria(tmp_path, tres_canais(estado=False), detector_diz=Resultado.NAO_CONFORME)

    r = a.passo(BASE)

    assert r["alertas"] == 3, "um por canal, todos nascidos no meio da captura"
    assert sorted(e["regraId"] for e in nuvem_do_farol.eventos) == [f"pre-{p}" for p in CANAIS]
    assert r["subidos"] >= 3
    # A volta seguinte não devolve os mesmos de novo.
    assert a.julgar(BASE + timedelta(seconds=5)) == []
    a.fila.fechar()


def test_falhar_ao_julgar_no_meio_nao_impede_a_captura_dos_outros_canais(tmp_path, caplog, monkeypatch):
    a, diario, _ = auditoria(tmp_path, tres_canais(estado=False))
    de_verdade = a.motor.processar
    vezes = {"n": 0}

    def quebra_na_primeira(*args, **kwargs):
        vezes["n"] += 1
        if vezes["n"] == 1:
            raise RuntimeError("fila travada")
        return de_verdade(*args, **kwargs)

    monkeypatch.setattr(a.motor, "processar", quebra_na_primeira)

    with caplog.at_level("ERROR", logger="farol_agent.auditoria"):
        r = a.passo(BASE)

    assert [linha for linha in diario if linha.startswith("captura")] == [f"captura {p}" for p in CANAIS]
    assert "julgamento falhou" in caplog.text
    # O do primeiro canal ficou na fila e saiu na tentativa seguinte, ainda nesta volta.
    assert sorted(linha for linha in diario if linha.startswith("detector")) == [f"detector pre-{p}" for p in CANAIS]
    assert r["enfileirados"] == 3
    a.fila.fechar()


def test_se_o_julgamento_do_fim_da_volta_falhar_os_avisos_do_meio_nao_se_perdem(tmp_path, monkeypatch):
    a, _, nuvem_do_farol = auditoria(tmp_path, tres_canais(estado=False), detector_diz=Resultado.NAO_CONFORME)
    de_verdade = a.motor.processar
    vezes = {"n": 0}

    def quebra_na_do_fim(*args, **kwargs):
        vezes["n"] += 1
        if vezes["n"] == 4:                 # três no meio da captura, e a do fim da volta
            raise RuntimeError("fila travada")
        return de_verdade(*args, **kwargs)

    monkeypatch.setattr(a.motor, "processar", quebra_na_do_fim)

    r = a.passo(BASE)

    assert r["alertas"] == 3, "os três avisos já tinham saído, e a volta os devolve mesmo assim"
    assert len(nuvem_do_farol.eventos) == 3
    a.fila.fechar()


def test_sem_nada_julgado_pelo_detector_a_volta_e_a_de_sempre(tmp_path):
    """O juiz sem seletor (o de bancada, o de teste): tudo é julgado no fim, como era."""

    class Anota(JuizDeTeste):
        def __init__(self, diario):
            super().__init__(Resultado.CONFORME)
            self.diario = diario

        def julgar(self, imagem, criterio, *, contexto=None, referencias=None):
            self.diario.append(f"juiz {contexto['regra_id']}")
            return super().julgar(imagem, criterio, contexto=contexto, referencias=referencias)

    diario_do_juiz: list[str] = []
    a, diario, _ = auditoria(tmp_path, tres_canais(estado=False), juiz=Anota(diario_do_juiz))
    assert a._julgados_pelo_detector == set()

    a.passo(BASE)

    assert diario == [f"captura {p}" for p in CANAIS], "nenhum julgamento entre as capturas"
    assert len(diario_do_juiz) == 3
    a.fila.fechar()


def test_so_com_critério_que_vai_a_nuvem_nada_e_julgado_no_meio(tmp_path):
    a, diario, _ = auditoria(tmp_path, tres_canais(presenca=False))

    a.passo(BASE)

    assert diario[:3] == [f"captura {p}" for p in CANAIS]
    assert sorted(diario[3:]) == [f"nuvem est-{p}" for p in CANAIS]
    a.fila.fechar()


def test_a_olhada_extra_do_vigia_tambem_e_julgada_canal_a_canal(tmp_path, monkeypatch):
    a, diario, _ = auditoria(tmp_path, tres_canais(estado=False))
    a.passo(BASE)
    diario.clear()

    class VigiaQueViuMudar:
        """Dois canais mudaram ao mesmo tempo: os dois ganham olhada extra."""

        canais = ["p1", "p3"]

        def olhar(self, fontes, agora):
            return ["p1", "p3"]

        def anotar_olhada(self, ponto_id, fonte, agora):
            pass

    a.vigia = VigiaQueViuMudar()

    r = a.vigiar(BASE + timedelta(seconds=10))

    assert diario == ["captura p1", "detector pre-p1", "captura p3", "detector pre-p3"]
    assert r["extras"] == 2 and r["enfileirados"] == 2
    a.fila.fechar()
