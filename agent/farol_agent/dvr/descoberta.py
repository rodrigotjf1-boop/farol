"""Acha o gravador na rede, sem precisar de senha.

Quem instala não sabe o IP do DVR, e descobrir isso é a primeira fricção
de toda instalação. Pior: é a fricção que acontece na loja, com alguém
esperando.

O truque é que **o 401 já identifica o aparelho**. Pedindo
`magicBox.cgi` sem credencial nenhuma, o gravador responde 401 com um
cabeçalho `WWW-Authenticate: Digest realm="Login to XXXXX"` — e o realm
costuma trazer o modelo. Dá para varrer a rede inteira e dizer "o DVR
está em 192.168.1.108" antes de alguém digitar qualquer senha.
"""

from __future__ import annotations

import ipaddress
import socket
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass


@dataclass
class Achado:
    host: str
    porta: int
    realm: str | None = None
    rtsp: bool = False

    @property
    def parece_gravador(self) -> bool:
        """Dahua e OEM põem 'Login to <modelo>' no realm do Digest."""
        return bool(self.realm) and "login to" in (self.realm or "").lower()


def _porta_aberta(host: str, porta: int, tempo_limite: float) -> bool:
    try:
        with socket.create_connection((host, porta), timeout=tempo_limite):
            return True
    except OSError:
        return False


def _realm(host: str, porta: int, tempo_limite: float) -> str | None:
    """Lê o realm do 401, sem mandar credencial nenhuma."""
    url = f"http://{host}:{porta}/cgi-bin/magicBox.cgi?action=getDeviceType"
    try:
        # Sem handler de autenticação de propósito: queremos o 401 cru.
        urllib.request.urlopen(url, timeout=tempo_limite)
    except urllib.error.HTTPError as e:
        if e.code == 401:
            cabecalho = e.headers.get("WWW-Authenticate", "") or ""
            for parte in cabecalho.split(","):
                if "realm=" in parte:
                    return parte.split("realm=", 1)[1].strip().strip('"')
            return cabecalho or "401 sem realm"
        return f"HTTP {e.code}"
    except (urllib.error.URLError, OSError):
        return None
    return "responde sem exigir senha"


def varrer(
    rede: str,
    *,
    portas: tuple[int, ...] = (80,),
    tempo_limite: float = 0.4,
    paralelas: int = 64,
) -> list[Achado]:
    """Varre uma rede (ex.: `192.168.1.0/24`) procurando gravador."""
    alvos = list(ipaddress.ip_network(rede, strict=False).hosts())
    if len(alvos) > 1024:
        raise ValueError(
            f"{rede} tem {len(alvos)} endereços. Use uma faixa /24 ou menor — "
            "varrer mais que isso demora e incomoda a rede da loja."
        )

    def examinar(ip) -> Achado | None:
        host = str(ip)
        for porta in portas:
            if not _porta_aberta(host, porta, tempo_limite):
                continue
            return Achado(
                host=host,
                porta=porta,
                realm=_realm(host, porta, tempo_limite * 4),
                rtsp=_porta_aberta(host, 554, tempo_limite),
            )
        return None

    with ThreadPoolExecutor(max_workers=paralelas) as piscina:
        resultados = [a for a in piscina.map(examinar, alvos) if a is not None]

    # Gravador primeiro; o resto da rede depois, para conferência.
    resultados.sort(key=lambda a: (not a.parece_gravador, not a.rtsp, a.host))
    return resultados


def rede_local() -> str | None:
    """Palpita a rede desta máquina, para não exigir que alguém digite.

    Abre um socket UDP para um endereço externo — sem mandar pacote
    nenhum — só para o sistema revelar qual interface ele usaria.
    """
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
    except OSError:
        return None
    return str(ipaddress.ip_network(f"{ip}/24", strict=False))
