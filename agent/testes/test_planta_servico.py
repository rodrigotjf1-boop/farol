"""A planta viva no serviço do agente (A26, P2): só com canal calibrado e a loja aberta; de cada quadro, as pessoas no
chão; os minutos fechados sobem em lote e, se a nuvem não aceita, ficam guardados e sobem depois.

Os quadros e o detector são de mentira; a homografia é a do contrato (a câmera simulada), e as caixas das pessoas
caem onde a geometria diz.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

from farol_agent.nuvem import ErroDaNuvem
from farol_agent.planta_viva import calibracao as cal
from farol_agent.planta_viva import rastreio as rt
from farol_agent.planta_viva import servico as sv
from ferramentas.contrato_calibracao import imagem_de
from testes.test_configuracao import resposta

CONTRATO = json.loads((Path(__file__).resolve().parents[2] / "contratos" / "calibracao-da-camera.json").read_text(encoding="utf-8"))
H = cal.homografia(cal.pares_de(CONTRATO["pares"]))
L, A = 704, 396


class Fluxo:
    def __init__(self) -> None:
        self.parado = False

    def ultimo(self, idade):
        return datetime.now(), np.zeros((A, L, 3), np.uint8)

    def parar(self):
        self.parado = True


class Detector:
    """Acha as pessoas que estão nos lugares de `self.onde` (metros no chão)."""

    def __init__(self) -> None:
        self.onde: list[tuple[float, float]] = []

    def caixas(self, img, classe, limite):
        assert classe == "person"
        saida = []
        for x, y in self.onde:
            u, v = imagem_de(x, y)
            saida.append((u * L - 18, v * A - 120, u * L + 18, v * A, 0.9))
        return saida


class Relogio:
    def __init__(self, t: datetime) -> None:
        self.t = t

    def __call__(self) -> datetime:
        return self.t


def montar(tmp_path, *, calibrado=True, horario=None, planta=None, altura=None, homografia=None):
    """A planta viva com a configuração de teste na pasta `tmp_path` (o desvio aprendido das câmeras fica nela também:
    montar de novo na mesma pasta é o agente reiniciado)."""
    dados = resposta()
    if calibrado:
        dados["pontos"][0]["calibracao"] = {"homografia": homografia or H, "erroM": 0.03, "versao": 1, "alturaDaCamera": altura}
    if planta is not None:
        dados["plantaViva"] = planta
    dados["loja"]["horarioFuncionamento"] = horario or []  # vazio = sempre aberta
    caminho = tmp_path / "config.json"
    caminho.write_text(json.dumps(dados), encoding="utf-8")
    enviados: list[list[dict]] = []
    detector = Detector()
    relogio = Relogio(datetime(2026, 10, 25, 22, 10, 0, tzinfo=timezone.utc))
    fluxos: list[Fluxo] = []

    def abrir(ponto):
        f = Fluxo()
        fluxos.append(f)
        return f

    p = sv.PlantaViva(caminho, enviados.append, detector_de=lambda: detector, abrir_fluxo=abrir, relogio=relogio)
    return p, detector, relogio, enviados, fluxos


def test_le_o_canal_calibrado_e_sobe_os_minutos_fechados(tmp_path):
    p, detector, relogio, enviados, fluxos = montar(tmp_path)
    detector.onde = [(2.5, 4.4), (3.5, 6.0)]
    t = 0.0
    for _ in range(130):  # 65 s a 2 quadros por segundo
        p.passo(t)
        t += 0.5
        relogio.t += timedelta(seconds=0.5)
    assert len(fluxos) == 1, "um canal calibrado, um fluxo"
    p._subir_em = 0  # sobe agora
    p.passo(t)
    assert len(enviados) == 1
    (minuto,) = enviados[0]
    assert minuto["minuto"] == "2026-10-25T22:10:00+00:00" and minuto["pico"] == 2
    # 2 pessoas x 60 s, menos o primeiro quadro: a pessoa só aparece depois de vista duas vezes (o rastreio firme)
    assert sum(s for _, _, s in minuto["calor"]) == 119.0
    assert [n for n, _ in minuto["caminhos"]] == [1, 2] and len(minuto["caminhos"][0][1]) == 60
    assert p.pendentes == []
    numero, x, y, *_ = p.ao_vivo[1][0]
    assert numero == 1 and abs(x - 2.5) < 0.15 and abs(y - 4.4) < 0.15, "a tela ao vivo tem as pessoas do último quadro"


def test_a_planta_chega_ao_rastreio_e_o_desvio_aprendido_fica_em_disco(tmp_path):
    p, *_ = montar(tmp_path, planta={"moveis": [{"x": 3.0, "y": 5.0, "w": 1.0, "h": 0.6, "alt": 0.9}, {"x": "torto"}],
                                     "limites": [0, 0, 8, 10]}, altura=2.6)
    p.passo(0.0)
    assert p.rastreio.planta.moveis == (rt.Movel(3.0, 5.0, 1.0, 0.6, 0.9),), "o móvel torto fica de fora"
    assert p.rastreio.planta.limites == (0.0, 0.0, 8.0, 10.0)
    (canal,) = p.canais.values()
    assert canal.cam is not None and canal.confianca > 0.9, "a câmera do contrato está a 2,6 m, como a planta diz"
    # o desvio aprendido vai para o disco e volta com o agente reiniciado — da MESMA calibração
    p.rastreio.desvios.geral[canal.canal] = [0.3, -0.1, 40.0]
    p._guardar_desvios()
    assert (tmp_path / sv.ARQUIVO_DOS_DESVIOS).exists()
    p2, *_ = montar(tmp_path)
    p2.passo(0.0)
    assert p2.rastreio.desvios.geral[canal.canal] == [0.3, -0.1, 40.0]
    # calibrou de novo: o que se aprendeu daquela câmera não vale mais
    p3, *_ = montar(tmp_path, homografia=[v * 1.0001 for v in H])
    p3.passo(0.0)
    assert canal.canal not in p3.rastreio.desvios.geral
    # a planta diz 4 m e a calibração põe a câmera a 2,6 m: a conta da cabeça não bate com a medida — vale pouco
    p4, *_ = montar(tmp_path, altura=4.0)
    p4.passo(0.0)
    (outro,) = p4.canais.values()
    assert outro.confianca < 0.2, outro.confianca


def test_sem_canal_calibrado_ou_com_a_loja_fechada_nao_le(tmp_path, caplog):
    p, *_ , fluxos = montar(tmp_path, calibrado=False)
    with caplog.at_level("INFO"):
        p.passo(0.0)
    assert fluxos == [] and any("nenhum canal calibrado" in r.getMessage() for r in caplog.records)
    # a loja abre às 18h e fecha às 23h (horário local do computador da loja); agora são 03h de lá
    fechado = [{"dias": [1, 2, 3, 4, 5, 6, 7], "hora_ini": "18:00", "hora_fim": "23:00"}]
    p2, _, relogio, _, fluxos2 = montar(tmp_path, horario=fechado)
    relogio.t = datetime.now().replace(hour=3, minute=0, second=0, microsecond=0).astimezone().astimezone(timezone.utc)
    with caplog.at_level("INFO"):
        p2.passo(0.0)
    assert fluxos2 == [] and any("a loja está fechada" in r.getMessage() for r in caplog.records)
    relogio.t = datetime.now().replace(hour=19, minute=0, second=0, microsecond=0).astimezone().astimezone(timezone.utc)
    p2._conferir_em = 0
    p2.passo(1.0)
    assert len(fluxos2) == 1, "às 19h de lá, aberta: lê"


def test_a_nuvem_que_nao_aceita_guarda_e_a_antiga_espera(tmp_path):
    p, detector, relogio, _, _ = montar(tmp_path)
    tentativas = []

    def recusa(lote):
        tentativas.append(len(lote))
        raise ErroDaNuvem("404 em /v1/planta-viva/minutos", recuperavel=False, status=404)

    p._enviar = recusa
    detector.onde = [(2.5, 4.4)]
    p.pendentes = [{"minuto": f"2026-10-25T22:{m:02d}:00+00:00"} for m in range(3)]
    p._subir(100.0)
    assert tentativas == [3] and len(p.pendentes) == 3, "não aceitou: fica guardado"
    p._subir(200.0)
    assert tentativas == [3], "a nuvem sem a rota: espera a pausa"
    p._subir(100.0 + sv.PAUSA_APOS_RECUSA_S + 1)
    assert tentativas == [3, 3]
    p.pendentes = [{"minuto": str(i)} for i in range(sv.GUARDA_MINUTOS + 5)]
    p._pausa_ate = 10**9
    p._subir(0.0)
    assert len(p.pendentes) == sv.GUARDA_MINUTOS, "a memória tem teto: os mais velhos saem"


def test_a_chave_liga(tmp_path):
    assert sv.ligada("1") and sv.ligada("sim") and not sv.ligada(None) and not sv.ligada("0")
