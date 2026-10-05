"""Cliente do gravador Dahua/Intelbras.

A MHDX da Intelbras roda firmware OEM da Dahua, então fala a API CGI da
Dahua: `magicBox.cgi` para se identificar, `eventManager.cgi` para
transmitir eventos e `/cam/realmonitor` para o RTSP.

**É a peça de que todo o gatilho depende, e que nunca foi testada aqui.**
O desenho inteiro do Farol assume que o gravador consegue avisar, por
`eventManager`, que houve movimento num canal — porque a inteligência de
vídeo da MHDX roda em **um canal só**, e os dezesseis precisam de gatilho.
Se este caminho não funcionar, o agente tem que varrer quadros o tempo
todo, e a conta de processamento muda de patamar.

Dá para testar **sem câmera nenhuma**: sem sinal, o gravador dispara
`VideoLoss` em todos os canais. É evento de verdade, pelo mesmo mecanismo
— serve de prova de vida do caminho inteiro antes de a câmera chegar.

Só biblioteca padrão de propósito: este código roda no PC da loja, e
depender de pacote externo para falar com o gravador é dependência a mais
num lugar onde ninguém vai rodar `pip install`.
"""

from __future__ import annotations

import json
import logging
import re
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Iterator

_log = logging.getLogger(__name__)

TEMPO_LIMITE = 10.0


class ErroDoGravador(Exception):
    """Falha ao falar com o gravador, com a causa já traduzida."""

    def __init__(self, mensagem: str, *, dica: str | None = None) -> None:
        super().__init__(mensagem)
        self.dica = dica


@dataclass
class Evento:
    """Um evento vindo do `eventManager`."""

    codigo: str                      # VideoMotion, VideoLoss, SmartMotionHuman…
    acao: str                        # Start | Stop | Pulse
    indice: int                      # canal, base 0
    dados: dict[str, Any] = field(default_factory=dict)
    bruto: str = ""

    @property
    def canal(self) -> int:
        """Canal em base 1, como aparece na tela do gravador."""
        return self.indice + 1


# Code=VideoMotion;action=Start;index=0;data={...}
_PADRAO = re.compile(r"Code=(?P<codigo>[^;]+);action=(?P<acao>[^;]+);index=(?P<indice>\d+)")


class ClienteDahua:
    def __init__(
        self,
        host: str,
        usuario: str,
        senha: str,
        *,
        porta: int = 80,
        porta_rtsp: int = 554,
    ) -> None:
        self.host = host
        self.porta = porta
        self.porta_rtsp = porta_rtsp
        self.usuario = usuario
        self._senha = senha

        base = f"http://{host}:{porta}"
        gerenciador = urllib.request.HTTPPasswordMgrWithDefaultRealm()
        gerenciador.add_password(None, base, usuario, senha)
        # Digest primeiro: é o que a Dahua exige. O Basic fica como
        # segunda tentativa porque firmware antigo de alguns OEM aceita só
        # ele, e descobrir isso na loja custa uma viagem.
        self._abridor = urllib.request.build_opener(
            urllib.request.HTTPDigestAuthHandler(gerenciador),
            urllib.request.HTTPBasicAuthHandler(gerenciador),
        )
        self.base = base

    # ────────────────────────── requisições ──────────────────────────

    def _abrir(self, caminho: str, *, tempo_limite: float = TEMPO_LIMITE):
        url = f"{self.base}{caminho}"
        try:
            return self._abridor.open(url, timeout=tempo_limite)
        except urllib.error.HTTPError as e:
            if e.code == 401:
                raise ErroDoGravador(
                    "usuário ou senha recusados pelo gravador",
                    dica="confira o usuário admin e a senha definida na primeira "
                    "inicialização do DVR",
                ) from e
            if e.code == 404:
                raise ErroDoGravador(
                    f"o gravador não conhece {caminho}",
                    dica="firmware sem a API CGI da Dahua, ou modelo diferente do esperado",
                ) from e
            raise ErroDoGravador(f"HTTP {e.code} em {caminho}") from e
        except urllib.error.URLError as e:
            raise ErroDoGravador(
                f"não alcancei {self.base}: {e.reason}",
                dica="o DVR está ligado e na mesma rede? a porta HTTP é 80 mesmo?",
            ) from e
        except (TimeoutError, socket.timeout) as e:
            raise ErroDoGravador(f"{self.base} não respondeu em {tempo_limite}s") from e

    def _texto(self, caminho: str) -> str:
        with self._abrir(caminho) as r:
            return r.read().decode("utf-8", "replace")

    @staticmethod
    def _pares(texto: str) -> dict[str, str]:
        """A CGI da Dahua responde `chave=valor` por linha."""
        saida: dict[str, str] = {}
        for linha in texto.splitlines():
            if "=" in linha:
                k, _, v = linha.partition("=")
                saida[k.strip()] = v.strip()
        return saida

    # ────────────────────────── identificação ──────────────────────────

    def info(self) -> dict[str, Any]:
        """Identifica o gravador. É a primeira coisa a rodar.

        Também é o que alimenta o catálogo `perfil_gravador`: modelo,
        firmware e número de canais saem daqui, medidos, em vez de
        digitados por alguém lendo a caixa.
        """
        dados: dict[str, Any] = {"host": self.host, "porta": self.porta}

        for chave, caminho in (
            ("tipo", "/cgi-bin/magicBox.cgi?action=getDeviceType"),
            ("serie", "/cgi-bin/magicBox.cgi?action=getSerialNo"),
            ("versao", "/cgi-bin/magicBox.cgi?action=getSoftwareVersion"),
            ("fabricante", "/cgi-bin/magicBox.cgi?action=getVendor"),
        ):
            try:
                dados[chave] = self._pares(self._texto(caminho))
            except ErroDoGravador as e:
                # Um `getVendor` ausente não invalida o resto. Registrar o
                # motivo e seguir é melhor que derrubar a sondagem inteira.
                _log.info("%s indisponível: %s", chave, e)
                dados[chave] = {"erro": str(e)}

        dados["canais"] = self.quantidade_de_canais()
        return dados

    def quantidade_de_canais(self) -> int | None:
        """Quantos canais de vídeo o gravador tem.

        Três caminhos, porque nenhum funciona em todo firmware. O MHDX
        3116-C (build 2025-12) ignora os dois primeiros e só responde pelo
        terceiro — contar os títulos de canal, que existem desde sempre
        porque é o que aparece na tela.
        """
        # 1 · a definição de produto, quando o firmware a expõe
        for nome in ("VideoInChannel", "VideoInChannels"):
            try:
                pares = self._pares(
                    self._texto(
                        f"/cgi-bin/magicBox.cgi?action=getProductDefinition&name={nome}"
                    )
                )
            except ErroDoGravador:
                continue
            for v in pares.values():
                if v.strip().isdigit():
                    return int(v)

        # 2 · a coleção de entradas de vídeo
        try:
            pares = self._pares(self._texto("/cgi-bin/devVideoInput.cgi?action=getCollect"))
            indices = {
                k.split("[", 1)[1].split("]", 1)[0]
                for k in pares
                if "[" in k and "]" in k
            }
            if indices:
                return len(indices)
        except (ErroDoGravador, IndexError):
            pass

        # 3 · contar os títulos de canal. É o que sobra, e é confiável:
        # todo gravador tem nome para cada canal, porque mostra na tela.
        try:
            pares = self._pares(
                self._texto("/cgi-bin/configManager.cgi?action=getConfig&name=ChannelTitle")
            )
            indices = {
                k.split("[", 1)[1].split("]", 1)[0]
                for k in pares
                if k.startswith("table.ChannelTitle[") and "]" in k
            }
            if indices:
                return len(indices)
        except (ErroDoGravador, IndexError):
            pass

        return None

    # ──────────────────────────── eventos ────────────────────────────

    def eventos(
        self,
        codigos: str = "All",
        *,
        keepalive: int = 20,
        tempo_limite: float = 120.0,
        reconectar: bool = True,
        ao_religar=None,
    ) -> Iterator[Evento]:
        """Eventos do gravador, religando sozinho quando a conexão cair.

        O MHDX 3116-C **fecha a transmissão depois de entregar um evento**
        — medido neste projeto, com firmware 4.001.00IB000.0.T. Um laço
        que só lesse uma conexão receberia o primeiro alerta do dia e
        ficaria mudo para sempre, sem erro nenhum.

        Por isso a religação é o padrão, e não uma opção. O agente precisa
        ficar ouvindo por turnos inteiros; conexão é detalhe de transporte,
        e detalhe de transporte não pode virar alerta perdido.

        A espera entre tentativas cresce até 15 s para não martelar um
        gravador que esteja reiniciando.
        """
        espera = 1.0
        while True:
            houve_evento = False
            try:
                for e in self._eventos_de_uma_conexao(codigos, keepalive, tempo_limite):
                    houve_evento = True
                    espera = 1.0
                    yield e
            except ErroDoGravador as erro:
                if not reconectar:
                    raise
                _log.warning("transmissão caiu (%s); religando em %.0fs", erro, espera)

            if not reconectar:
                return

            if ao_religar is not None:
                ao_religar(espera, houve_evento)
            time.sleep(espera)
            espera = min(espera * 2, 15.0)

    def _eventos_de_uma_conexao(
        self,
        codigos: str,
        keepalive: int,
        tempo_limite: float,
    ) -> Iterator[Evento]:
        """Uma conexão só, do `attach` até ela fechar.

        A resposta é `multipart/x-mixed-replace`: o gravador mantém a
        conexão aberta e vai empurrando partes. Entre eventos ele manda
        `Heartbeat`, que é como se sabe que a conexão está viva e não
        apenas silenciosa — distinção que importa quando o alerta que não
        chegou pode ser "ninguém se mexeu" ou "o caminho caiu".
        """
        caminho = (
            f"/cgi-bin/eventManager.cgi?action=attach"
            f"&codes=[{codigos}]&keepalive={keepalive}"
        )
        resposta = self._abrir(caminho, tempo_limite=tempo_limite)

        # Confere que é mesmo a transmissão de eventos antes de ler.
        # Sem isto, apontar para o aparelho errado (ou para um nome que o
        # DNS do roteador sequestra para uma página de busca) faz o laço
        # ler HTML calado e terminar com "0 eventos" — e "0 eventos" é
        # indistinguível de "ninguém se mexeu". Silêncio no lugar de erro
        # é o modo de falha que este projeto não pode ter.
        tipo = (resposta.headers.get("Content-Type") or "").lower()
        if "multipart" not in tipo:
            resposta.close()
            raise ErroDoGravador(
                f"{self.host} respondeu '{tipo or 'sem Content-Type'}' em vez de "
                "multipart/x-mixed-replace",
                dica="este endereço não é o gravador, ou o firmware não tem eventManager",
            )

        with resposta:
            parte: list[str] = []
            while True:
                try:
                    linha = resposta.readline()
                except (TimeoutError, socket.timeout) as e:
                    raise ErroDoGravador(
                        f"a transmissão parou por mais de {tempo_limite}s sem nem heartbeat",
                        dica="keepalive não está chegando: o caminho caiu",
                    ) from e

                if not linha:
                    return   # o gravador fechou

                texto = linha.decode("utf-8", "replace")

                if texto.startswith("--"):          # fronteira entre partes
                    evento = _montar(parte)
                    parte = []
                    if evento is not None:
                        yield evento
                    continue

                parte.append(texto)

                # Fecha a parte assim que o JSON de `data` termina, sem
                # esperar a próxima fronteira: alerta urgente tem dois
                # segundos de orçamento e não pode ficar preso num buffer
                # esperando o evento seguinte.
                juntado = "".join(parte)
                if "Code=" in juntado and _json_completo(juntado):
                    evento = _montar(parte)
                    parte = []
                    if evento is not None:
                        yield evento

    # ───────────────────────────── RTSP ──────────────────────────────

    def url_rtsp(self, canal: int, *, sub: bool = False) -> str:
        """URL do fluxo. `canal` em base 1, como na tela do gravador.

        `subtype=0` é o main-stream; `1` é o sub. O protótipo puxava o sub
        sem saber, e foi a causa de todos os `indeterminado` do histórico:
        352×240 não sustenta julgamento nenhum.
        """
        if canal < 1:
            raise ValueError("canal começa em 1")
        usuario = urllib.parse.quote(self.usuario, safe="")
        senha = urllib.parse.quote(self._senha, safe="")
        subtipo = 1 if sub else 0
        return (
            f"rtsp://{usuario}:{senha}@{self.host}:{self.porta_rtsp}"
            f"/cam/realmonitor?channel={canal}&subtype={subtipo}"
        )

    def url_rtsp_sem_segredo(self, canal: int, *, sub: bool = False) -> str:
        """Mesma URL, com a senha mascarada. É esta que vai para log."""
        bruta = self.url_rtsp(canal, sub=sub)
        return bruta.replace(urllib.parse.quote(self._senha, safe=""), "***")


# ─────────────────────────── utilidades ────────────────────────────


def _json_completo(texto: str) -> bool:
    """A parte já pode ser entregue como evento?

    Sem `data=`, a linha do `Code=` basta. Com `data=`, só quando as
    chaves fecharem — o JSON da Dahua vem formatado em várias linhas, e
    entregar no meio daria um evento com os dados pela metade.
    """
    if "data=" not in texto:
        return "Code=" in texto
    trecho = texto.split("data=", 1)[1]
    abertas = trecho.count("{")
    return abertas > 0 and abertas == trecho.count("}")


def _montar(linhas: list[str]) -> Evento | None:
    bruto = "".join(linhas).strip()
    if not bruto or "Code=" not in bruto:
        return None

    m = _PADRAO.search(bruto)
    if not m:
        return None

    dados: dict[str, Any] = {}
    pos = bruto.find("data=")
    if pos >= 0:
        trecho = bruto[pos + 5 :].strip()
        try:
            dados = json.loads(trecho)
        except json.JSONDecodeError:
            # JSON truncado não pode derrubar a transmissão: o evento ainda
            # vale pelo código e pelo canal, que é o que o gatilho usa.
            _log.debug("data= não era JSON válido: %.120s", trecho)

    return Evento(
        codigo=m.group("codigo"),
        acao=m.group("acao"),
        indice=int(m.group("indice")),
        dados=dados,
        bruto=bruto,
    )
