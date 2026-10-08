"""O uso da máquina de análise: processador, memória, placa de vídeo e disco.

O dono pediu, olhando a primeira noite da loja: "incluir análise de uso do
servidor de análise, a máquina local". A pergunta por trás é de capacidade —
este computador está dando conta? cabe mais uma câmera, mais um critério?

## O que cada número é

- **processador** e **placa de vídeo**: a ocupação MÉDIA da máquina inteira
  desde a amostra anterior (uns trinta segundos), não um instante. O "pico"
  de uma hora é a maior dessas médias — um estouro de meio segundo não
  aparece, e é assim que tem de ser: quem decide comprar máquina olha carga
  sustentada.
- **memória**: quanto está em uso na hora da amostra.
- **do Farol**: quanto do processador da máquina ESTE processo usou, e a
  memória dele. O resto é do Windows e do que mais roda no computador.
- **disco**: o espaço livre onde ficam a fila e as imagens julgadas.

## Sem dependência nova

Nada de `psutil`: o pacote do agente é trocado na loja sem instalar nada
pela rede. No Windows os números vêm das mesmas chamadas que o Gerenciador
de Tarefas usa (`kernel32`, `psapi` e os contadores `GPU Engine` do PDH),
por `ctypes`. No Linux, de `/proc`. Em qualquer outro lugar — ou se uma
chamada falhar — o número daquela peça fica `None`, e `None` não entra em
média nenhuma: é "não medi", não "zero".

Medir nunca pode derrubar a auditoria: toda leitura é protegida, e uma peça
que falha três vezes seguidas para de ser tentada (com um aviso só).
"""

from __future__ import annotations

import ctypes
import logging
import os
import re
import shutil
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

_log = logging.getLogger(__name__)

# Depois disto, a peça é dada como "não dá para medir aqui" e não se tenta mais.
FALHAS_ATE_DESISTIR = 3


@dataclass(frozen=True)
class Amostra:
    """Uma medida. Porcentagens de 0 a 100; `None` = não deu para medir."""

    cpu: float | None = None
    memoria: float | None = None
    gpu: float | None = None
    processo_cpu: float | None = None
    processo_mem_mb: float | None = None
    disco_livre_gb: float | None = None
    disco_total_gb: float | None = None


def _prender(v: float) -> float:
    return max(0.0, min(100.0, v))


# ───────────────────────────── Windows ─────────────────────────────


class _FILETIME(ctypes.Structure):
    _fields_ = [("baixo", ctypes.c_uint32), ("alto", ctypes.c_uint32)]

    def valor(self) -> int:
        return (self.alto << 32) | self.baixo


class _MEMORYSTATUSEX(ctypes.Structure):
    _fields_ = [
        ("dwLength", ctypes.c_uint32),
        ("dwMemoryLoad", ctypes.c_uint32),
        ("ullTotalPhys", ctypes.c_uint64),
        ("ullAvailPhys", ctypes.c_uint64),
        ("ullTotalPageFile", ctypes.c_uint64),
        ("ullAvailPageFile", ctypes.c_uint64),
        ("ullTotalVirtual", ctypes.c_uint64),
        ("ullAvailVirtual", ctypes.c_uint64),
        ("ullAvailExtendedVirtual", ctypes.c_uint64),
    ]


class _PROCESS_MEMORY_COUNTERS(ctypes.Structure):
    _fields_ = [
        ("cb", ctypes.c_uint32),
        ("PageFaultCount", ctypes.c_uint32),
        ("PeakWorkingSetSize", ctypes.c_size_t),
        ("WorkingSetSize", ctypes.c_size_t),
        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
        ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
        ("PagefileUsage", ctypes.c_size_t),
        ("PeakPagefileUsage", ctypes.c_size_t),
    ]


class _PDH_VALOR(ctypes.Structure):
    # PDH_FMT_COUNTERVALUE: o estado e uma união de 8 bytes (aqui, o double).
    _fields_ = [("CStatus", ctypes.c_uint32), ("valor", ctypes.c_double)]


class _PDH_ITEM(ctypes.Structure):
    # PDH_FMT_COUNTERVALUE_ITEM_W
    _fields_ = [("nome", ctypes.c_wchar_p), ("leitura", _PDH_VALOR)]


_PDH_FMT_DOUBLE = 0x00000200
_PDH_MORE_DATA = 0x800007D2
# "…_engtype_3D", "…_engtype_VideoDecode", "…_engtype_Compute_0"
_MOTOR = re.compile(r"luid_(\w+?)_phys_(\d+)_eng_\d+_engtype_(.+)$")


def uso_da_placa(instancias: list[tuple[str, float]]) -> float | None:
    """A ocupação da placa de vídeo, a partir dos contadores `GPU Engine`.

    Cada instância é um processo num motor da placa (3D, decodificação de
    vídeo, cálculo…). O Gerenciador de Tarefas soma os processos de cada
    motor e mostra o MAIOR motor — somar motores diferentes passaria de
    100% numa placa que está fazendo duas coisas. Aqui é a mesma conta, e
    com mais de uma placa vale a mais ocupada.
    """
    por_motor: dict[tuple[str, str, str], float] = {}
    for nome, valor in instancias:
        m = _MOTOR.search(nome or "")
        if not m or valor is None or valor != valor:  # NaN
            continue
        chave = (m.group(1), m.group(2), m.group(3))
        por_motor[chave] = por_motor.get(chave, 0.0) + max(0.0, float(valor))
    if not por_motor:
        return None
    return _prender(max(por_motor.values()))


class _PlacaNoWindows:
    """Os contadores `\\GPU Engine(*)\\Utilization Percentage`, via PDH."""

    CAMINHO = r"\GPU Engine(*)\Utilization Percentage"

    def __init__(self) -> None:
        self._pdh = ctypes.WinDLL("pdh")
        self._consulta = ctypes.c_void_p()
        self._contador = ctypes.c_void_p()
        if self._pdh.PdhOpenQueryW(None, 0, ctypes.byref(self._consulta)) != 0:
            raise OSError("PdhOpenQuery falhou")
        # A versão "English" lê o nome do contador igual em qualquer idioma
        # do Windows; a outra pediria "Mecanismo de GPU" num PC em português.
        estado = self._pdh.PdhAddEnglishCounterW(
            self._consulta, self.CAMINHO, 0, ctypes.byref(self._contador)
        )
        if estado != 0:
            raise OSError(f"o contador de placa de vídeo não existe aqui (0x{estado & 0xFFFFFFFF:08X})")
        # É um contador de TAXA: precisa de duas coletas. Esta é a primeira.
        self._pdh.PdhCollectQueryData(self._consulta)

    def ler(self) -> float | None:
        if self._pdh.PdhCollectQueryData(self._consulta) != 0:
            return None
        tamanho = ctypes.c_uint32(0)
        quantos = ctypes.c_uint32(0)
        estado = self._pdh.PdhGetFormattedCounterArrayW(
            self._contador, _PDH_FMT_DOUBLE, ctypes.byref(tamanho), ctypes.byref(quantos), None
        )
        if (estado & 0xFFFFFFFF) != _PDH_MORE_DATA or tamanho.value == 0:
            # Nenhum processo usando a placa agora: é zero, não "não medi".
            return 0.0 if estado == 0 else None
        caixa = (ctypes.c_byte * tamanho.value)()
        estado = self._pdh.PdhGetFormattedCounterArrayW(
            self._contador, _PDH_FMT_DOUBLE, ctypes.byref(tamanho), ctypes.byref(quantos), caixa
        )
        if estado != 0:
            return None
        itens = ctypes.cast(caixa, ctypes.POINTER(_PDH_ITEM))
        lidos = [(itens[i].nome, itens[i].leitura.valor) for i in range(quantos.value) if itens[i].leitura.CStatus == 0]
        uso = uso_da_placa(lidos)
        return 0.0 if uso is None else uso

    def fechar(self) -> None:
        try:
            self._pdh.PdhCloseQuery(self._consulta)
        except Exception:  # noqa: BLE001
            pass


class _Windows:
    def __init__(self) -> None:
        self._k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        self._psapi = ctypes.WinDLL("psapi", use_last_error=True)
        self._k32.GetCurrentProcess.restype = ctypes.c_void_p
        self._psapi.GetProcessMemoryInfo.argtypes = [
            ctypes.c_void_p, ctypes.POINTER(_PROCESS_MEMORY_COUNTERS), ctypes.c_uint32,
        ]
        self._antes: tuple[int, int] | None = None
        self._placa: _PlacaNoWindows | None = None

    def cpu(self) -> float | None:
        parado, nucleo, usuario = _FILETIME(), _FILETIME(), _FILETIME()
        if not self._k32.GetSystemTimes(ctypes.byref(parado), ctypes.byref(nucleo), ctypes.byref(usuario)):
            raise OSError("GetSystemTimes falhou")
        # O tempo de núcleo já INCLUI o parado.
        total = nucleo.valor() + usuario.valor()
        agora = (parado.valor(), total)
        antes, self._antes = self._antes, agora
        if antes is None or total <= antes[1]:
            return None  # a primeira leitura não tem com o que comparar
        passou = total - antes[1]
        return _prender(100.0 * (1.0 - (agora[0] - antes[0]) / passou))

    def _memoria(self) -> _MEMORYSTATUSEX:
        m = _MEMORYSTATUSEX()
        m.dwLength = ctypes.sizeof(_MEMORYSTATUSEX)
        if not self._k32.GlobalMemoryStatusEx(ctypes.byref(m)):
            raise OSError("GlobalMemoryStatusEx falhou")
        return m

    def memoria(self) -> float | None:
        m = self._memoria()
        if not m.ullTotalPhys:
            return None
        return _prender(100.0 * (1.0 - m.ullAvailPhys / m.ullTotalPhys))

    def memoria_total_gb(self) -> float | None:
        return round(self._memoria().ullTotalPhys / 2**30, 1)

    def gpu(self) -> float | None:
        if self._placa is None:
            self._placa = _PlacaNoWindows()
            return None  # contador de taxa: a primeira coleta não diz nada
        return self._placa.ler()

    def processo_mem_mb(self) -> float | None:
        c = _PROCESS_MEMORY_COUNTERS()
        c.cb = ctypes.sizeof(_PROCESS_MEMORY_COUNTERS)
        if not self._psapi.GetProcessMemoryInfo(self._k32.GetCurrentProcess(), ctypes.byref(c), c.cb):
            raise OSError("GetProcessMemoryInfo falhou")
        return c.WorkingSetSize / 2**20

    def pecas(self) -> dict[str, Any]:
        import winreg

        def do_registro(chave: str, valor: str) -> str | None:
            try:
                with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, chave) as k:
                    return str(winreg.QueryValueEx(k, valor)[0]).strip() or None
            except OSError:
                return None

        placa = None
        classe = r"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}"
        for i in range(4):
            placa = do_registro(rf"{classe}\{i:04d}", "DriverDesc")
            # "Microsoft Basic Display Adapter" e afins não são a placa.
            if placa and "basic" not in placa.lower() and "remote" not in placa.lower():
                break
        return {
            "processador": do_registro(r"HARDWARE\DESCRIPTION\System\CentralProcessor\0", "ProcessorNameString"),
            "placa_de_video": placa,
        }

    def fechar(self) -> None:
        if self._placa is not None:
            self._placa.fechar()


# ────────────────────────────── Linux ──────────────────────────────


class _Linux:
    def __init__(self) -> None:
        self._antes: tuple[int, int] | None = None

    def cpu(self) -> float | None:
        campos = Path("/proc/stat").read_text(encoding="ascii").splitlines()[0].split()[1:]
        valores = [int(v) for v in campos]
        parado = valores[3] + (valores[4] if len(valores) > 4 else 0)  # idle + iowait
        agora = (parado, sum(valores))
        antes, self._antes = self._antes, agora
        if antes is None or agora[1] <= antes[1]:
            return None
        return _prender(100.0 * (1.0 - (agora[0] - antes[0]) / (agora[1] - antes[1])))

    @staticmethod
    def _meminfo() -> dict[str, int]:
        dados: dict[str, int] = {}
        for linha in Path("/proc/meminfo").read_text(encoding="ascii").splitlines():
            nome, _, resto = linha.partition(":")
            dados[nome] = int(resto.split()[0])
        return dados

    def memoria(self) -> float | None:
        m = self._meminfo()
        if not m.get("MemTotal"):
            return None
        return _prender(100.0 * (1.0 - m.get("MemAvailable", m.get("MemFree", 0)) / m["MemTotal"]))

    def memoria_total_gb(self) -> float | None:
        return round(self._meminfo()["MemTotal"] / 2**20, 1)

    def gpu(self) -> float | None:
        return None

    def processo_mem_mb(self) -> float | None:
        for linha in Path("/proc/self/status").read_text(encoding="ascii").splitlines():
            if linha.startswith("VmRSS:"):
                return int(linha.split()[1]) / 1024
        return None

    def pecas(self) -> dict[str, Any]:
        processador = None
        for linha in Path("/proc/cpuinfo").read_text(encoding="utf-8", errors="replace").splitlines():
            if linha.startswith("model name"):
                processador = linha.partition(":")[2].strip() or None
                break
        return {"processador": processador, "placa_de_video": None}

    def fechar(self) -> None:
        pass


def _do_sistema():
    if sys.platform == "win32":
        return _Windows()
    if sys.platform.startswith("linux"):
        return _Linux()
    return None


# ───────────────────────────── o medidor ─────────────────────────────


class Medidor:
    """Tira uma amostra do uso da máquina a cada chamada de `amostra()`.

    `sistema` é injetável para o teste dizer o que a máquina "respondeu".
    """

    PECAS = ("cpu", "memoria", "gpu", "processo_mem_mb")

    def __init__(
        self,
        pasta_do_disco: str | Path,
        *,
        sistema: Any = "detectar",
        relogio: Callable[[], float] = time.monotonic,
        tempo_do_processo: Callable[[], float] = time.process_time,
        nucleos: int | None = None,
    ) -> None:
        self.pasta = Path(pasta_do_disco)
        self._relogio = relogio
        self._tempo_do_processo = tempo_do_processo
        self.nucleos = nucleos or os.cpu_count() or 1
        self._falhas: dict[str, int] = {}
        self._antes: tuple[float, float] | None = None
        try:
            self._sistema = _do_sistema() if sistema == "detectar" else sistema
        except Exception as e:  # noqa: BLE001
            _log.warning("não vou medir o uso desta máquina: %s", e)
            self._sistema = None

    def _ler(self, peca: str) -> float | None:
        """Uma peça, protegida: falhou três vezes seguidas, não tenta mais."""
        if self._sistema is None or self._falhas.get(peca, 0) >= FALHAS_ATE_DESISTIR:
            return None
        try:
            valor = getattr(self._sistema, peca)()
        except Exception as e:  # noqa: BLE001
            self._falhas[peca] = self._falhas.get(peca, 0) + 1
            if self._falhas[peca] == FALHAS_ATE_DESISTIR:
                _log.warning("não consigo medir %s nesta máquina (%s): sigo sem esse número", peca, e)
            return None
        self._falhas[peca] = 0
        return None if valor is None else float(valor)

    def _processo_cpu(self) -> float | None:
        """Quanto do processador da MÁQUINA este processo usou desde a última amostra."""
        agora = (self._relogio(), self._tempo_do_processo())
        antes, self._antes = self._antes, agora
        if antes is None or agora[0] <= antes[0]:
            return None
        return _prender(100.0 * (agora[1] - antes[1]) / ((agora[0] - antes[0]) * self.nucleos))

    def _disco(self) -> tuple[float | None, float | None]:
        try:
            d = shutil.disk_usage(self.pasta)
        except OSError:
            return None, None
        return round(d.free / 2**30, 2), round(d.total / 2**30, 2)

    def amostra(self) -> Amostra:
        livre, total = self._disco()
        return Amostra(
            cpu=self._ler("cpu"),
            memoria=self._ler("memoria"),
            gpu=self._ler("gpu"),
            processo_cpu=self._processo_cpu(),
            processo_mem_mb=self._ler("processo_mem_mb"),
            disco_livre_gb=livre,
            disco_total_gb=total,
        )

    def pecas(self) -> dict[str, Any]:
        """De que é feita a máquina, para a tela dizer do que está falando."""
        base: dict[str, Any] = {"processador": None, "placa_de_video": None, "memoria_gb": None}
        if self._sistema is not None:
            try:
                base.update(self._sistema.pecas())
                base["memoria_gb"] = self._sistema.memoria_total_gb()
            except Exception as e:  # noqa: BLE001
                _log.debug("não consegui ler as peças da máquina: %s", e)
        base["nucleos"] = self.nucleos
        return base

    def fechar(self) -> None:
        if self._sistema is not None:
            try:
                self._sistema.fechar()
            except Exception:  # noqa: BLE001
                pass
