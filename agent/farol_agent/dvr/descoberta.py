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
    portas: tuple[int, ...] = ()
    realm: str | None = None
    mac: str | None = None

    @property
    def rtsp(self) -> bool:
        return 554 in self.portas

    @property
    def mac_local(self) -> bool:
        """MAC com o bit de "administrado localmente" ligado.

        Celular e notebook modernos sorteiam um MAC por rede, para não
        serem rastreados, e é assim que se reconhece.

        ⚠️ **Mas não é só celular, e eu não tenho como saber de cor quem
        usa.** A versão anterior afirmava "gravador não sorteia MAC" e
        removia esses aparelhos da lista — suposição minha, nunca
        verificada, apresentada como fato. Ver ERR-003.

        Serve para ORDENAR a lista, nunca para eliminar ninguém dela.
        """
        if not self.mac:
            return False
        try:
            primeiro = int(self.mac.split(":")[0], 16)
        except (ValueError, IndexError):
            return False
        return bool(primeiro & 0b10)

    @property
    def candidato(self) -> bool:
        """Todo aparelho é candidato.

        Existe para deixar explícito que **nada se elimina**: o que a
        descoberta faz é ordenar por probabilidade e deixar quem olha
        decidir. Heurística que elimina candidato esconde a resposta.
        """
        return True

    @property
    def parece_gravador(self) -> bool:
        """Três sinais, qualquer um já levanta suspeita.

        O realm do Digest é o mais forte — Dahua e OEM põem
        'Login to <modelo>' nele. Mas um gravador novo pode ter o HTTP
        ainda fechado, e aí 554 (RTSP) ou 37777 (porta de serviço da
        Dahua) são o que sobra.
        """
        if self.realm and "login to" in self.realm.lower():
            return True
        return 554 in self.portas or 37777 in self.portas


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


def limpar_arp() -> bool:
    """Esvazia o cache ARP do sistema. Exige administrador.

    Sem isto, o teste de "tira o cabo e varre de novo" **não funciona**:
    o Windows guarda a entrada por vários minutos depois de o aparelho
    sumir, então ele continua na lista como se nada tivesse acontecido.
    Foi exatamente o que aconteceu no primeiro teste em campo.
    """
    import subprocess

    for cmd in (
        ["netsh", "interface", "ip", "delete", "arpcache"],
        ["arp", "-d", "*"],
        ["ip", "-s", "-s", "neigh", "flush", "all"],
    ):
        try:
            r = subprocess.run(
                cmd, capture_output=True, text=True, timeout=15, check=False
            )
            if r.returncode == 0:
                return True
        except (OSError, subprocess.SubprocessError):
            continue
    return False


def tabela_arp() -> dict[str, str]:
    """IPs que responderam a ARP, com o MAC de cada um.

    Vale mais que a varredura de portas quando o aparelho é novo: um DVR
    recém-ligado, ainda sem inicializar, pode estar com **todas as portas
    fechadas** e ainda assim responder a ARP. Ele aparece aqui e em mais
    lugar nenhum.

    E o MAC identifica: o da etiqueta do gravador bate com o da lista.

    A própria varredura TCP já popula esta tabela de graça — falar com um
    IP da rede local exige resolver o MAC antes, mesmo que a conexão seja
    recusada depois.
    """
    import re
    import subprocess

    comandos = (["arp", "-a"], ["ip", "neigh"])
    saida = ""
    for cmd in comandos:
        try:
            saida = subprocess.run(
                cmd, capture_output=True, text=True, timeout=8, check=False
            ).stdout
            if saida.strip():
                break
        except (OSError, subprocess.SubprocessError):
            continue

    achados: dict[str, str] = {}
    ip_re = re.compile(r"\b(\d{1,3}(?:\.\d{1,3}){3})\b")
    mac_re = re.compile(r"\b([0-9a-fA-F]{2}(?:[:-][0-9a-fA-F]{2}){5})\b")
    for linha in saida.splitlines():
        ip = ip_re.search(linha)
        mac = mac_re.search(linha)
        if ip and mac:
            m = mac.group(1).lower().replace("-", ":")
            # Multicast e broadcast não são aparelho.
            if m.startswith(("01:00:5e", "ff:ff:ff", "33:33")):
                continue
            achados[ip.group(1)] = m
    return achados


def varrer(
    rede: str,
    *,
    # 37777 é a porta de serviço da Dahua: o gravador costuma atendê-la
    # mesmo quando o HTTP está em outra porta ou desligado.
    portas: tuple[int, ...] = (80, 554, 37777),
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
        abertas = tuple(p for p in portas if _porta_aberta(host, p, tempo_limite))
        if not abertas:
            return None
        # O realm só faz sentido na porta HTTP.
        realm = _realm(host, 80, tempo_limite * 4) if 80 in abertas else None
        return Achado(host=host, portas=abertas, realm=realm)

    with ThreadPoolExecutor(max_workers=paralelas) as piscina:
        resultados = [a for a in piscina.map(examinar, alvos) if a is not None]

    # A varredura acima já resolveu o MAC de quem respondeu a ARP, mesmo
    # dos que recusaram todas as portas. Esses não entraram na lista — e
    # um gravador recém-ligado pode ser exatamente um deles.
    arp = tabela_arp()
    conhecidos = {a.host for a in resultados}
    for a in resultados:
        a.mac = arp.get(a.host)
    for ip, mac in arp.items():
        if ip not in conhecidos and ipaddress.ip_address(ip) in ipaddress.ip_network(
            rede, strict=False
        ):
            resultados.append(Achado(host=ip, portas=(), mac=mac))

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


def mac_de(host: str, *, tempo_limite: float = 2.0) -> str | None:
    """O MAC deste host, se a máquina souber.

    Endereço IP muda — o MHDX está em DHCP. MAC não. Guardar o MAC do
    gravador é o que permite reencontrá-lo quando o endereço mudar, e é
    também o que distingue "mudou de IP" de "é outro equipamento".

    **Cutuca antes de perguntar.** A tabela ARP só conhece quem foi
    conversado recentemente; num host que o sistema nunca tocou, ela vem
    vazia. Uma conexão TCP de dois segundos resolve isso — e não importa
    se ela é recusada: recusa também preenche a ARP, porque o pacote foi
    e voltou.
    """
    import socket

    s = socket.socket()
    s.settimeout(tempo_limite)
    try:
        s.connect((host, 80))
    except OSError:
        pass   # recusado, filtrado, fechado — a ARP aprendeu do mesmo jeito
    finally:
        s.close()

    return tabela_arp().get(host)
