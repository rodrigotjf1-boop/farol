"""Os sensores da máquina (25/10/2026) — `sensores.py`, a soma da hora (`fila.somar_sensores`) e o corpo da nuvem.

Com as respostas DE VERDADE do PC da loja (lidas em 25/10: a linha do `nvidia-smi` com a RTX 5060 Ti parada, o XML do
evento 41 e do 6008 da queda de sábado — o nome do computador trocado por "*"). O que se protege:

- a placa: os campos do `nvidia-smi`, "[N/A]" vira nulo, a memória em %, os motivos de segurar a frequência;
- os contadores do Windows: a zona térmica em kelvin vira °C (a mais quente), o disco em MB/s, a ocupação presa a 100;
- o disco: a saúde e a temperatura do PowerShell; lido a cada 15 minutos, não a cada amostra;
- a queda: a hora exata do binário do 6008 (UTC), a hora da subida do 41, a causa (energia, tela azul, botão);
- cada peça protegida: falhou 3 vezes, desiste com um aviso só; o resto segue;
- a hora: soma, amostras e pico de cada campo; o pico de cada minuto; o que não é número não entra;
- o corpo de `POST /v1/uso` com os sensores, os minutos e a queda.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from farol_agent import sensores as se
from farol_agent.contrato import queda_para_nuvem, sensores_para_nuvem
from farol_agent.fila import somar_sensores
from farol_agent.uso import Amostra, Medidor

LINHA_DA_LOJA = "0, 269, 16311, 38.82, 6.51, 0, 210, 0x0000000000000400"
XML_41 = (
    "<Event xmlns='http://schemas.microsoft.com/win/2004/08/events/event'><System><Provider "
    "Name='Microsoft-Windows-Kernel-Power' Guid='{331c3b3a-2005-44c2-ac5e-77220c37d6b4}'/><EventID>41</EventID>"
    "<Version>8</Version><Level>1</Level><Task>63</Task><Opcode>0</Opcode><Keywords>0x8000400000000002</Keywords>"
    "<TimeCreated SystemTime='2026-10-25T07:44:08.8653939Z'/><EventRecordID>81160</EventRecordID><Correlation/>"
    "<Execution ProcessID='4' ThreadID='8'/><Channel>System</Channel><Computer>*</Computer><Security UserID='S-1-5-18'/>"
    "</System><EventData><Data Name='BugcheckCode'>0</Data><Data Name='BugcheckParameter1'>0x0</Data>"
    "<Data Name='BugcheckParameter2'>0x0</Data><Data Name='BugcheckParameter3'>0x0</Data>"
    "<Data Name='BugcheckParameter4'>0x0</Data><Data Name='SleepInProgress'>0</Data>"
    "<Data Name='PowerButtonTimestamp'>0</Data><Data Name='BootAppStatus'>0</Data><Data Name='Checkpoint'>0</Data>"
    "<Data Name='ConnectedStandbyInProgress'>false</Data><Data Name='SystemSleepTransitionsToOn'>0</Data>"
    "<Data Name='CsEntryScenarioInstanceId'>0</Data><Data Name='BugcheckInfoFromEFI'>false</Data>"
    "<Data Name='CheckpointStatus'>0</Data><Data Name='CsEntryScenarioInstanceIdV2'>0</Data>"
    "<Data Name='LongPowerButtonPressDetected'>false</Data></EventData></Event>"
)
XML_6008 = (
    "<Event xmlns='http://schemas.microsoft.com/win/2004/08/events/event'><System><Provider Name='EventLog'/>"
    "<EventID Qualifiers='32768'>6008</EventID><Version>0</Version><Level>2</Level><Task>0</Task><Opcode>0</Opcode>"
    "<Keywords>0x80000000000000</Keywords><TimeCreated SystemTime='2026-10-25T07:44:34.1795571Z'/>"
    "<EventRecordID>81146</EventRecordID><Correlation/><Execution ProcessID='0' ThreadID='0'/><Channel>System</Channel>"
    "<Computer>*</Computer><Security/></System><EventData><Data>08:49:19</Data><Data>24/10/2026</Data><Data></Data>"
    "<Data></Data><Data>198941</Data><Data></Data><Data></Data><Binary>EA070A0006001800080031001300F700EA070A0006001800"
    "0B0031001300F7003C0000003C000000000000000000000000000000000000000100000000000000</Binary></EventData></Event>"
)


def test_a_placa_pela_linha_do_nvidia_smi():
    p = se.ler_nvidia(LINHA_DA_LOJA)
    assert p["gpuMemMb"] == 269.0 and p["gpuMemPct"] == pytest.approx(1.65, abs=0.01)
    assert (p["gpuTempC"], p["gpuPotenciaW"], p["gpuVentoinhaPct"], p["gpuClockMhz"]) == (38.82, 6.51, 0.0, 210.0)
    assert p["gpuLimitaTemperatura"] is False and p["gpuLimitaEnergia"] is False, "0x400 não é temperatura nem energia"
    quente = se.ler_nvidia("98, 15000, 16311, 87, 179.5, 100, 2400, 0x0000000000000020")
    assert quente["gpuLimitaTemperatura"] is True and quente["gpuTempC"] == 87.0
    sem = se.ler_nvidia("0, 269, 16311, [N/A], [N/A], [N/A], 210, [N/A]")
    assert sem["gpuTempC"] is None and sem["gpuPotenciaW"] is None and "gpuLimitaTemperatura" not in sem
    assert se.ler_nvidia("") == {} and se.ler_nvidia("lixo") == {}
    assert se.ler_nvidia("0, 269, 16311, 500, 6, 0, 210, 0x0")["gpuTempC"] is None, "fora da faixa: descartado"


def test_os_contadores_do_windows_viram_numeros():
    assert se.converter_pdh("tempPlacaMaeC", [301.0, 290.0]) == pytest.approx(27.85, abs=0.01)
    assert se.converter_pdh("tempPlacaMaeC", [0.0]) is None
    assert se.converter_pdh("discoLeituraMbs", [254986.0]) == pytest.approx(0.25, abs=0.01)
    assert se.converter_pdh("discoOcupadoPct", [180.0]) == 100.0
    assert se.converter_pdh("cpuDesempenhoPct", [112.3]) == 112.3
    assert se.converter_pdh("cpuDesempenhoPct", []) is None


def test_a_saude_do_disco():
    d = se.ler_disco('{"saude":"Healthy","temp":29,"horas":3245,"desgaste":0}')
    assert d == {"discoTempC": 29.0, "discoSaude": "ok", "discoHorasLigado": 3245}
    assert se.ler_disco('{"saude":"Warning","temp":0,"horas":null}') == {"discoTempC": None, "discoSaude": "atencao", "discoHorasLigado": None}
    assert se.ler_disco("nao e json") == {}


def test_a_queda_de_sabado_pelo_registro_da_loja():
    q = se.ler_queda(XML_41, XML_6008)
    assert q is not None and q.causa == "energia" and q.bugcheck is None
    assert q.desligou == datetime(2026, 10, 24, 11, 49, 19, tzinfo=timezone.utc), "a hora UTC do binário (08:49:19 na loja)"
    assert q.ligou == datetime(2026, 10, 25, 7, 44, 8, tzinfo=timezone.utc)
    assert queda_para_nuvem(q) == {"desligou": "2026-10-24T11:49:19+00:00", "ligou": "2026-10-25T07:44:08+00:00",
                                   "causa": "energia", "bugcheck": None}
    azul = se.ler_queda(XML_41.replace("'BugcheckCode'>0<", "'BugcheckCode'>209<"), None)
    assert azul.causa == "tela-azul" and azul.bugcheck == "209" and azul.desligou is None
    botao = se.ler_queda(XML_41.replace("'LongPowerButtonPressDetected'>false<", "'LongPowerButtonPressDetected'>true<"), XML_6008)
    assert botao.causa == "botao"
    # um 6008 de outra queda (depois desta subida): não vale
    assert se.ler_queda(XML_41.replace("2026-10-25T07:44:08", "2026-10-20T07:44:08"), XML_6008).desligou is None
    assert se.ler_queda("<nao", None) is None and queda_para_nuvem(None) is None


class Rodou:
    def __init__(self, returncode=0, stdout=""):
        self.returncode, self.stdout = returncode, stdout


def test_cada_peca_protegida_e_o_disco_a_cada_15_minutos(caplog, monkeypatch):
    monkeypatch.setattr(se.sys, "platform", "win32")
    chamadas = {"smi": 0, "ps": 0}
    agora = {"s": 0.0}

    def rodar(cmd, **kw):
        if "nvidia" in cmd[0]:
            chamadas["smi"] += 1
            raise OSError("travou")
        chamadas["ps"] += 1
        return Rodou(0, '{"saude":"Healthy","temp":31,"horas":10}')

    contadores = SimpleNamespace(ler=lambda: {"cpuDesempenhoPct": 110.0}, fechar=lambda: None)
    s = se.Sensores(rodar=rodar, contadores=contadores, nvidia="nvidia-smi", relogio=lambda: agora["s"])
    with caplog.at_level(logging.WARNING):
        for _ in range(5):
            r = s.ler()
            agora["s"] += 30
    assert chamadas["smi"] == 3, "três falhas e desiste"
    assert sum("placa de vídeo" in m.message for m in caplog.records) == 1
    assert r["cpuDesempenhoPct"] == 110.0 and r["discoTempC"] == 31.0, "o resto segue"
    assert chamadas["ps"] == 1, "o disco não é lido a cada amostra"
    agora["s"] += se.DISCO_A_CADA_S
    s.ler()
    assert chamadas["ps"] == 2


def test_a_hora_soma_os_sensores_e_guarda_o_pico_de_cada_minuto():
    a1 = Amostra(cpu=20.0, memoria=50.0, gpu=10.0, sensores={"gpuTempC": 60.0, "tempPlacaMaeC": 30.0, "gpuLimitaTemperatura": False,
                                                            "discoSaude": "ok", "ligadoHaH": 1.5, "gpuPotenciaW": True})
    a2 = Amostra(cpu=80.0, memoria=55.0, gpu=None, sensores={"gpuTempC": 82.0, "gpuLimitaTemperatura": True, "ligadoHaH": 1.6})
    s, m = somar_sensores(None, None, 7, a1)
    s, m = somar_sensores(s, m, 7, a2)
    s, m = somar_sensores(s, m, 8, Amostra(cpu=5.0, sensores={}))
    sj, mj = json.loads(s), json.loads(m)
    assert sj["gpuTempC"] == [142.0, 2, 82.0] and sj["tempPlacaMaeC"] == [30.0, 1, 30.0]
    assert "gpuPotenciaW" not in sj, "verdadeiro/falso não é número de potência"
    assert sj["gpuLimitaTemperatura"] == 1 and sj["ligadoHaH"] == 1.6 and sj["discoSaude"] == "ok"
    assert mj["7"] == {"cpu": 80.0, "mem": 55.0, "gpu": 10.0, "gpuTempC": 82.0, "tempPlacaMaeC": 30.0}
    assert mj["8"] == {"cpu": 5.0}
    corpo = sensores_para_nuvem(s, m)
    assert corpo["sensores"]["gpuTempC"] == {"soma": 142.0, "amostras": 2, "max": 82.0}
    assert corpo["sensores"]["ligadoHaH"] == 1.6 and corpo["sensores"]["gpuLimitaTemperatura"] == 1
    assert corpo["minutos"][0] == [7, mj["7"]] and corpo["minutos"][1][0] == 8
    assert sensores_para_nuvem(None, None) == {} and sensores_para_nuvem("{}", "{}") == {}


def test_o_medidor_junta_os_sensores_e_o_defeito_nao_derruba(tmp_path):
    class Sistema:
        def cpu(self):
            return 10.0

        def memoria(self):
            return 40.0

        def gpu(self):
            return None

        def processo_mem_mb(self):
            return 100.0

        def fechar(self):
            pass

    bons = SimpleNamespace(ler=lambda: {"gpuTempC": 45.0}, fechar=lambda: None)
    assert Medidor(tmp_path, sistema=Sistema(), sensores=bons).amostra().sensores == {"gpuTempC": 45.0}

    def quebra():
        raise RuntimeError("sensor fora")

    ruins = SimpleNamespace(ler=quebra, fechar=lambda: None)
    a = Medidor(tmp_path, sistema=Sistema(), sensores=ruins).amostra()
    assert a.sensores == {} and a.cpu == 10.0
    assert Medidor(tmp_path, sistema=Sistema()).amostra().sensores == {}, "o teste que injeta o sistema não lê sensor"
