"""Os SENSORES da máquina (25/10/2026): o monitoramento do PC do agente pedido pelo dono.

O dono, 25/10/2026, depois de o PC da loja apagar às 08:49 de sábado (falta de energia) e ficar 20 horas desligado:
"um monitoramento de funcionamento do pc servidor do agente com relatórios de usos por horários, picos de uso, % de uso
do processador, da memória e da placa, temperaturas, para verificar se o pc está sobrecarregado, se sobreaquece. o
máximo de dados possíveis."

O uso de processador, memória e placa já vinha de `uso.py`. Aqui entra o resto, cada peça pela fonte que o PC tem SEM
instalar nada (medido no PC da loja em 25/10):

- **a placa NVIDIA** pelo `nvidia-smi` (vem com o driver): uso, memória, temperatura, consumo, ventoinha, frequência e o
  motivo de a placa estar segurando a frequência (temperatura ou energia);
- **a frequência real do processador** (`% Processor Performance`: 112% = turbo), as **zonas térmicas da placa-mãe**
  (ACPI) e o **disco** (ocupado, leitura e escrita) pelos contadores do Windows (PDH, a versão "English" — o nome não
  muda com o idioma);
- **a saúde e a temperatura do disco** pelo PowerShell (`Get-StorageReliabilityCounter`), uma vez a cada 15 minutos;
- **há quanto tempo o PC está ligado** (`GetTickCount64`);
- **a última queda**: ao subir, o agente lê no registro do Windows o evento 41 (Kernel-Power) e o 6008 (desligamento
  inesperado) — a hora exata vem do binário do 6008 (não do texto, que muda com o idioma) e a causa dos campos do 41:
  tela azul (`BugcheckCode`), botão segurado (`PowerButtonTimestamp` ou `LongPowerButtonPressDetected`), ou sem nada
  disso — falta de energia (ou o PC travou de vez).

A temperatura de DENTRO do processador não está aqui: o Windows só a entrega com um programa de sensores instalado com
administrador (decisão do dono).

**Medir nunca derruba o agente**: cada peça é protegida; a que falha três vezes seguidas para de ser tentada (com um
aviso só); o que não deu para medir é `None` — "não medi", nunca zero.
"""

from __future__ import annotations

import ctypes
import json
import logging
import re
import shutil
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

_log = logging.getLogger(__name__)

FALHAS_ATE_DESISTIR = 3
# A saúde e a temperatura do disco mudam devagar e custam um PowerShell (~1 s): uma vez a cada 15 minutos.
DISCO_A_CADA_S = 15 * 60
TEMPO_MAXIMO_S = 8

# Os campos que os sensores devolvem, com a faixa que vale (fora dela, a leitura é descartada).
FAIXAS: dict[str, tuple[float, float]] = {
    "gpuMemPct": (0, 100),
    "gpuMemMb": (0, 1_000_000),
    "gpuTempC": (0, 130),
    "gpuPotenciaW": (0, 2_000),
    "gpuVentoinhaPct": (0, 100),
    "gpuClockMhz": (0, 10_000),
    "cpuDesempenhoPct": (0, 400),
    "tempPlacaMaeC": (0, 130),
    "discoOcupadoPct": (0, 100),
    "discoLeituraMbs": (0, 100_000),
    "discoEscritaMbs": (0, 100_000),
    "discoTempC": (0, 130),
}
# Os motivos do `nvidia-smi` (`clocks_throttle_reasons.active`, os bits do NVML) que importam aqui.
LIMITA_TEMPERATURA = 0x20 | 0x40 | 0x08  # SwThermalSlowdown, HwThermalSlowdown, HwSlowdown
LIMITA_ENERGIA = 0x04 | 0x80  # SwPowerCap, HwPowerBrakeSlowdown

_SEM_JANELA = 0x08000000 if sys.platform == "win32" else 0  # CREATE_NO_WINDOW


def _numero(texto: str) -> float | None:
    t = (texto or "").strip()
    if not t or t.startswith("[") or t.lower() in ("n/a", "not supported"):
        return None
    try:
        return float(t)
    except ValueError:
        return None


def _na_faixa(campo: str, valor: float | None) -> float | None:
    if valor is None or valor != valor:  # NaN
        return None
    lo, hi = FAIXAS[campo]
    return round(float(valor), 2) if lo <= valor <= hi else None


# ───────────────────────────── a placa NVIDIA ─────────────────────────────

CONSULTA_NVIDIA = (
    "utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,fan.speed,clocks.sm,"
    "clocks_throttle_reasons.active"
)


def ler_nvidia(saida: str) -> dict[str, Any]:
    """A primeira linha do `nvidia-smi --query-gpu=CONSULTA_NVIDIA --format=csv,noheader,nounits` em campos."""
    linha = next((l for l in (saida or "").splitlines() if l.strip()), "")
    partes = [p.strip() for p in linha.split(",")]
    if len(partes) < 8:
        return {}
    _uso, usada, total, temp, potencia, ventoinha, clock, motivos = partes[:8]
    mem_usada, mem_total = _numero(usada), _numero(total)
    out: dict[str, Any] = {
        "gpuMemMb": _na_faixa("gpuMemMb", mem_usada),
        "gpuMemPct": _na_faixa("gpuMemPct", 100.0 * mem_usada / mem_total) if mem_usada is not None and mem_total else None,
        "gpuTempC": _na_faixa("gpuTempC", _numero(temp)),
        "gpuPotenciaW": _na_faixa("gpuPotenciaW", _numero(potencia)),
        "gpuVentoinhaPct": _na_faixa("gpuVentoinhaPct", _numero(ventoinha)),
        "gpuClockMhz": _na_faixa("gpuClockMhz", _numero(clock)),
    }
    try:
        bits = int(motivos, 16) if motivos.lower().startswith("0x") else None
    except ValueError:
        bits = None
    if bits is not None:
        out["gpuLimitaTemperatura"] = bool(bits & LIMITA_TEMPERATURA)
        out["gpuLimitaEnergia"] = bool(bits & LIMITA_ENERGIA)
    return out


def achar_nvidia_smi() -> str | None:
    achado = shutil.which("nvidia-smi")
    if achado:
        return achado
    padrao = Path(r"C:\Windows\System32\nvidia-smi.exe")
    return str(padrao) if sys.platform == "win32" and padrao.is_file() else None


# ───────────────────────────── os contadores do Windows (PDH) ─────────────────────────────


class _PDH_VALOR(ctypes.Structure):
    _fields_ = [("CStatus", ctypes.c_uint32), ("valor", ctypes.c_double)]


class _PDH_ITEM(ctypes.Structure):
    _fields_ = [("nome", ctypes.c_wchar_p), ("leitura", _PDH_VALOR)]


_PDH_FMT_DOUBLE = 0x00000200
_PDH_FMT_NOCAP100 = 0x00008000
_PDH_MORE_DATA = 0x800007D2

CONTADORES = {
    "tempPlacaMaeC": r"\Thermal Zone Information(*)\Temperature",
    "cpuDesempenhoPct": r"\Processor Information(_Total)\% Processor Performance",
    "discoOcupadoPct": r"\PhysicalDisk(_Total)\% Disk Time",
    "discoLeituraMbs": r"\PhysicalDisk(_Total)\Disk Read Bytes/sec",
    "discoEscritaMbs": r"\PhysicalDisk(_Total)\Disk Write Bytes/sec",
}


def converter_pdh(campo: str, valores: list[float]) -> float | None:
    """O número do campo a partir das instâncias lidas: a zona térmica mais quente (em kelvin → °C), o disco em MB/s,
    a ocupação do disco presa a 100."""
    vs = [v for v in valores if v is not None and v == v]
    if not vs:
        return None
    if campo == "tempPlacaMaeC":
        # o contador vem em kelvin (301 = 28 °C); zona que diz 0 não está ligada
        cs = [v - 273.15 if v > 200 else v for v in vs if v > 0]
        return _na_faixa(campo, max(cs)) if cs else None
    v = max(vs)
    if campo in ("discoLeituraMbs", "discoEscritaMbs"):
        return _na_faixa(campo, v / 1_000_000)
    if campo == "discoOcupadoPct":
        return _na_faixa(campo, min(100.0, v))
    return _na_faixa(campo, v)


class _ContadoresDoWindows:
    """Os `CONTADORES` numa consulta PDH só. Os de TAXA precisam de duas coletas: a primeira é no começo."""

    def __init__(self) -> None:
        self._pdh = ctypes.WinDLL("pdh")
        self._consulta = ctypes.c_void_p()
        if self._pdh.PdhOpenQueryW(None, 0, ctypes.byref(self._consulta)) != 0:
            raise OSError("PdhOpenQuery falhou")
        self._contadores: dict[str, ctypes.c_void_p] = {}
        for campo, caminho in CONTADORES.items():
            h = ctypes.c_void_p()
            if self._pdh.PdhAddEnglishCounterW(self._consulta, caminho, 0, ctypes.byref(h)) == 0:
                self._contadores[campo] = h
        if not self._contadores:
            raise OSError("nenhum contador de sensor existe aqui")
        self._pdh.PdhCollectQueryData(self._consulta)

    def _valores(self, h: ctypes.c_void_p) -> list[float]:
        tamanho, quantos = ctypes.c_uint32(0), ctypes.c_uint32(0)
        fmt = _PDH_FMT_DOUBLE | _PDH_FMT_NOCAP100
        estado = self._pdh.PdhGetFormattedCounterArrayW(h, fmt, ctypes.byref(tamanho), ctypes.byref(quantos), None)
        if (estado & 0xFFFFFFFF) != _PDH_MORE_DATA or tamanho.value == 0:
            return []
        caixa = (ctypes.c_byte * tamanho.value)()
        if self._pdh.PdhGetFormattedCounterArrayW(h, fmt, ctypes.byref(tamanho), ctypes.byref(quantos), caixa) != 0:
            return []
        itens = ctypes.cast(caixa, ctypes.POINTER(_PDH_ITEM))
        return [itens[i].leitura.valor for i in range(quantos.value) if itens[i].leitura.CStatus == 0]

    def ler(self) -> dict[str, float | None]:
        if self._pdh.PdhCollectQueryData(self._consulta) != 0:
            return {}
        return {campo: converter_pdh(campo, self._valores(h)) for campo, h in self._contadores.items()}

    def fechar(self) -> None:
        try:
            self._pdh.PdhCloseQuery(self._consulta)
        except Exception:  # noqa: BLE001
            pass


# ───────────────────────────── o disco (saúde e temperatura) ─────────────────────────────

SCRIPT_DO_DISCO = (
    "$d = Get-PhysicalDisk | Select-Object -First 1; "
    "$r = $d | Get-StorageReliabilityCounter; "
    "[pscustomobject]@{ saude = [string]$d.HealthStatus; temp = $r.Temperature; horas = $r.PowerOnHours; "
    "desgaste = $r.Wear } | ConvertTo-Json -Compress"
)


def ler_disco(saida: str) -> dict[str, Any]:
    """O JSON do `SCRIPT_DO_DISCO`: a saúde ("Healthy", "Warning", "Unhealthy"), a temperatura, as horas ligado."""
    try:
        d = json.loads(saida or "")
    except ValueError:
        return {}
    if not isinstance(d, dict):
        return {}
    saude = str(d.get("saude") or "").strip()
    return {
        "discoTempC": _na_faixa("discoTempC", d.get("temp") if isinstance(d.get("temp"), (int, float)) and d.get("temp") > 0 else None),
        "discoSaude": {"healthy": "ok", "warning": "atencao", "unhealthy": "ruim"}.get(saude.lower()) if saude else None,
        "discoHorasLigado": int(d["horas"]) if isinstance(d.get("horas"), (int, float)) and d["horas"] >= 0 else None,
    }


# ───────────────────────────── a última queda ─────────────────────────────

_NS = {"e": "http://schemas.microsoft.com/win/2004/08/events/event"}
_HORA_DO_REGISTRO = re.compile(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})")


@dataclass(frozen=True)
class Queda:
    """O desligamento inesperado mais novo: quando apagou, quando ligou de novo e por quê."""

    desligou: datetime | None  # com fuso (UTC), do binário do 6008
    ligou: datetime  # com fuso (UTC), a hora do evento 41 (escrito na subida seguinte)
    causa: str  # "energia" | "tela-azul" | "botao" | "suspensao"
    bugcheck: str | None


def _systemtime(dados: bytes, inicio: int) -> datetime | None:
    if len(dados) < inicio + 16:
        return None
    ano, mes, _sem, dia, hora, minuto, segundo, _ms = (int.from_bytes(dados[inicio + 2 * i: inicio + 2 * i + 2], "little")
                                                      for i in range(8))
    try:
        return datetime(ano, mes, dia, hora, minuto, segundo, tzinfo=timezone.utc)
    except ValueError:
        return None


def ler_queda(xml_41: str, xml_6008: str | None) -> Queda | None:
    """A queda a partir do XML do evento 41 (Kernel-Power) e do 6008 (desligamento inesperado), do `wevtutil`. O 6008
    traz no binário duas horas (SYSTEMTIME): a local e a UTC — vale a UTC (a 2ª). Nulo se não há 41."""
    try:
        ev = ET.fromstring(xml_41)
    except ET.ParseError:
        return None
    criado = ev.find("e:System/e:TimeCreated", _NS)
    # "2026-10-25T07:44:08.8653939Z": a hora do registro é sempre UTC; a fração (7 casas) não importa
    m = _HORA_DO_REGISTRO.match((criado.get("SystemTime") or "") if criado is not None else "")
    if not m:
        return None
    try:
        ligou = datetime(*(int(x) for x in m.groups()), tzinfo=timezone.utc)
    except ValueError:
        return None
    dados = {d.get("Name"): (d.text or "").strip() for d in ev.findall("e:EventData/e:Data", _NS)}
    bug = dados.get("BugcheckCode", "0")
    if bug not in ("", "0", "0x0"):
        causa = "tela-azul"
    elif dados.get("PowerButtonTimestamp", "0") not in ("", "0") or dados.get("LongPowerButtonPressDetected", "").lower() == "true":
        causa = "botao"
    elif dados.get("SleepInProgress", "0") not in ("", "0"):
        causa = "suspensao"
    else:
        causa = "energia"
    desligou = None
    if xml_6008:
        try:
            ev6 = ET.fromstring(xml_6008)
            binario = ev6.findtext("e:EventData/e:Binary", default="", namespaces=_NS) or ""
            desligou = _systemtime(bytes.fromhex(binario), 16)
        except (ET.ParseError, ValueError):
            desligou = None
        # o 6008 de OUTRA queda (mais velha que a subida anterior) não vale para esta
        if desligou is not None and (desligou > ligou or ligou - desligou > timedelta(days=60)):
            desligou = None
    return Queda(desligou=desligou, ligou=ligou, causa=causa, bugcheck=None if causa != "tela-azul" else bug[:20])


def _wevtutil(consulta: str) -> str | None:
    r = subprocess.run(["wevtutil", "qe", "System", f"/q:{consulta}", "/c:1", "/rd:true", "/f:xml"],
                       capture_output=True, text=True, timeout=TEMPO_MAXIMO_S, creationflags=_SEM_JANELA)
    return r.stdout.strip() or None if r.returncode == 0 else None


def ultima_queda() -> Queda | None:
    """A queda mais nova do registro do Windows (fora do Windows, nada)."""
    if sys.platform != "win32":
        return None
    try:
        x41 = _wevtutil("*[System[Provider[@Name='Microsoft-Windows-Kernel-Power'] and (EventID=41)]]")
        if not x41:
            return None
        return ler_queda(x41, _wevtutil("*[System[(EventID=6008)]]"))
    except (OSError, subprocess.SubprocessError) as e:
        _log.info("não li o registro de quedas do Windows (%s)", e)
        return None


# ───────────────────────────── o conjunto ─────────────────────────────


class Sensores:
    """Lê tudo o que dá a cada `ler()`; cada peça protegida (três falhas seguidas, desiste com um aviso)."""

    def __init__(self, *, rodar: Callable[..., Any] = subprocess.run, contadores: Any = "detectar",
                 nvidia: str | None | bool = True, relogio: Callable[[], float] = time.monotonic) -> None:
        self._rodar = rodar
        self._relogio = relogio
        self._falhas: dict[str, int] = {}
        self._nvidia = achar_nvidia_smi() if nvidia is True else (nvidia or None)
        self._contadores = None
        if contadores == "detectar":
            if sys.platform == "win32":
                try:
                    self._contadores = _ContadoresDoWindows()
                except OSError as e:
                    _log.info("sem os contadores de sensor do Windows (%s)", e)
        else:
            self._contadores = contadores
        self._disco: dict[str, Any] = {}
        self._disco_em: float | None = None

    def _protegido(self, peca: str, f: Callable[[], dict[str, Any]]) -> dict[str, Any]:
        if self._falhas.get(peca, 0) >= FALHAS_ATE_DESISTIR:
            return {}
        try:
            r = f()
        except Exception as e:  # noqa: BLE001 — medir nunca derruba o agente
            self._falhas[peca] = self._falhas.get(peca, 0) + 1
            if self._falhas[peca] == FALHAS_ATE_DESISTIR:
                _log.warning("não consigo ler %s nesta máquina (%s): sigo sem esses números", peca, e)
            return {}
        self._falhas[peca] = 0
        return r

    def _placa(self) -> dict[str, Any]:
        if not self._nvidia:
            return {}
        r = self._rodar([self._nvidia, f"--query-gpu={CONSULTA_NVIDIA}", "--format=csv,noheader,nounits"],
                        capture_output=True, text=True, timeout=TEMPO_MAXIMO_S, creationflags=_SEM_JANELA)
        if r.returncode != 0:
            raise OSError(f"nvidia-smi saiu com {r.returncode}")
        return ler_nvidia(r.stdout)

    def _do_disco(self) -> dict[str, Any]:
        agora = self._relogio()
        if self._disco_em is not None and agora - self._disco_em < DISCO_A_CADA_S:
            return self._disco
        self._disco_em = agora
        if sys.platform != "win32":
            return {}
        r = self._rodar(["powershell", "-NoProfile", "-NonInteractive", "-Command", SCRIPT_DO_DISCO],
                        capture_output=True, text=True, timeout=TEMPO_MAXIMO_S * 3, creationflags=_SEM_JANELA)
        self._disco = ler_disco(r.stdout) if r.returncode == 0 else {}
        return self._disco

    def ler(self) -> dict[str, Any]:
        out: dict[str, Any] = {}
        out.update(self._protegido("a placa de vídeo (nvidia-smi)", self._placa))
        if self._contadores is not None:
            out.update(self._protegido("os contadores de sensor do Windows", self._contadores.ler))
        out.update(self._protegido("a saúde do disco", self._do_disco))
        out["ligadoHaH"] = self._ligado_ha_h()
        return out

    @staticmethod
    def _ligado_ha_h() -> float | None:
        if sys.platform == "win32":
            try:
                k32 = ctypes.WinDLL("kernel32")
                k32.GetTickCount64.restype = ctypes.c_uint64
                return round(k32.GetTickCount64() / 3_600_000, 2)
            except (OSError, AttributeError):
                return None
        try:
            return round(float(Path("/proc/uptime").read_text(encoding="ascii").split()[0]) / 3600, 2)
        except (OSError, ValueError, IndexError):
            return None

    def fechar(self) -> None:
        if self._contadores is not None and hasattr(self._contadores, "fechar"):
            self._contadores.fechar()


# Os campos que se somam na hora (média e pico): os de `FAIXAS`. Os outros (saúde, horas, limitação, ligado) vão à parte.
SOMADOS = tuple(FAIXAS)
# O que entra no pico de cada minuto (o relatório por minuto), além do processador, da memória e da placa do `uso.py`.
NO_MINUTO = ("gpuTempC", "gpuPotenciaW", "tempPlacaMaeC", "discoOcupadoPct")
