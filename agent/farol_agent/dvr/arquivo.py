"""O caminho de ARQUIVO do gravador: pedir um trecho que já foi gravado.

Ao vivo, o agente vê o agora. Para olhar PARA TRÁS — os segundos antes de um
gatilho, ou o bloco do meio de um intervalo em dúvida — ele pede ao gravador
o trecho gravado, por HTTP (`loadfile.cgi`, nos gravadores da família
Dahua). Medido na loja em 09/10/2026: o bloco de 2 s chega em cerca de 1,9 s,
contra 11 a 13 s para 10 s "tocando" a gravação por RTSP.

Este módulo é só o pedido. Não escolhe quadro, não decide o que buscar e
**nada o chama ainda**: é a primeira fatia da onda 2 do A19.

## Quatro regras, e de onde vêm

1. **Um pedido por vez, por gravador.** O gravador atende um trecho de cada
   vez; dois juntos atrasam os dois e o ao vivo. A vez é do GRAVADOR (endereço
   e porta), não de quem pede: dois clientes para o mesmo aparelho dividem a
   mesma trava.
2. **Pedido recusado não se repete.** A conta é a mesma do ao vivo: o
   gravador trava a conta depois de algumas senhas erradas, e aí a loja inteira
   fica cega. Por isso este cliente faz o desafio à mão — um pedido sem
   credencial, para receber o desafio, e UM com ela. Recusou: fecha a porta
   para aquela senha e não fala mais com o gravador até a senha mudar (ou o
   agente reiniciar). O `urllib` do cliente ao vivo repete sozinho, e por isso
   não serve aqui.
3. **O que o gravador entrega é do PERFIL dele, não do motor.** O gravador
   da loja de teste entrega em blocos de 2 s (um quadro-chave a cada 2 s), a
   partir de segundo par, e arredonda as duas pontas do pedido para baixo; a
   gravação fica disponível alguns segundos depois do instante real. Outro
   gravador entrega outra coisa. Por isso nenhum número de aparelho mora
   aqui: eles entram por `PerfilDeArquivo`, medidos na instalação, e o que
   se mediu de cada modelo fica na base de equipamentos
   (`catalogo/equipamentos/gravador/`).
4. **O relógio é o do gravador.** O pedido vai na hora DELE (na loja, 24 a 30 s
   adiantado em relação ao computador). Quem chama converte, com a diferença
   medida por `relogio()`.

## Segredo

Nada daqui escreve em registro o usuário, a senha, o cabeçalho de
autorização nem o "realm" do desafio (que traz o número de série do
aparelho). Da senha recusada guarda-se só uma impressão, com sal do processo.

Só biblioteca padrão, como o resto de `dvr/`.
"""

from __future__ import annotations

import hashlib
import http.client
import logging
import math
import secrets
import socket
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable
from urllib.request import parse_http_list, parse_keqv_list

from farol_agent.dvr.dahua import ErroDoGravador

_log = logging.getLogger(__name__)

# Quanto um pedido espera a vez no gravador antes de desistir.
ESPERA_DA_VEZ = 20.0
# Abrir a conexão, e o maior silêncio aceito no meio da resposta.
TEMPO_DE_CONEXAO = 4.0
TEMPO_DE_SILENCIO = 15.0
# O pedido inteiro, e o tamanho que ele pode ter.
LIMITE_DO_PEDIDO = 45.0
TETO_DO_TRECHO = 24 * 1024 * 1024
# O trecho mais longo que se pede de uma vez. Olhar para trás é coisa de segundos.
MAIOR_TRECHO = timedelta(seconds=40)
# De quanto em quanto tempo a diferença de relógio é medida de novo.
IDADE_DO_RELOGIO = 300.0

_PEDACO = 65536
_HORA = "%Y-%m-%d %H:%M:%S"


class PedidoRecusado(ErroDoGravador):
    """O gravador recusou a credencial. Este cliente não pede de novo com ela."""


class GravadorOcupado(ErroDoGravador):
    """Outro pedido está na vez, e este esperou demais."""


class SemGravacao(ErroDoGravador):
    """O gravador não tem gravação naquele trecho (ou ainda não a tem)."""


@dataclass(frozen=True)
class PerfilDeArquivo:
    """O que ESTE gravador entrega pelo caminho de arquivo. Medido, não suposto.

    `bloco_s` nulo = não se sabe em que blocos ele entrega: o pedido vai como
    veio, e quem lê confere o que voltou.
    """

    # O tamanho do bloco, em segundos; os blocos começam em múltiplo dele.
    bloco_s: int | None = None
    # Quanto depois do instante real a gravação já pode ser pedida. Sem medida,
    # 10 s: é cautela, não número de aparelho.
    atraso_s: float = 10.0
    # A porta HTTP do gravador (a do ponto é a do RTSP).
    porta: int = 80


@dataclass(frozen=True)
class Trecho:
    """Um trecho baixado. As horas são as do PEDIDO, no relógio do gravador."""

    canal: int
    de: datetime
    ate: datetime
    caminho: Path
    tamanho: int
    # O que o gravador disse que mandaria. `None` = não disse.
    declarado: int | None
    tipo: str
    ate_o_primeiro_byte_s: float
    total_s: float


@dataclass
class _Porta:
    """O que é do gravador, e não de quem pede: a vez, a recusa e o relógio."""

    vez: threading.Lock
    # A impressão da senha que ele recusou. Com a mesma senha, ninguém pede.
    recusada: str | None = None
    # (medida em, gravador − computador)
    relogio: tuple[float, timedelta] | None = None


_PORTAS: dict[tuple[str, int], _Porta] = {}
_GUARDA_DAS_PORTAS = threading.Lock()
# O sal da impressão da senha recusada: muda a cada vez que o processo sobe.
_SAL = secrets.token_bytes(16)


def _porta_de(host: str, porta: int) -> _Porta:
    with _GUARDA_DAS_PORTAS:
        chave = (host, porta)
        if chave not in _PORTAS:
            _PORTAS[chave] = _Porta(vez=threading.Lock())
        return _PORTAS[chave]


def esquecer_gravadores() -> None:
    """Zera o que se guardou de cada gravador (a vez, a recusa, o relógio). Para os testes."""
    with _GUARDA_DAS_PORTAS:
        _PORTAS.clear()


def _impressao(senha: str) -> str:
    return hashlib.sha256(_SAL + senha.encode("utf-8")).hexdigest()


# ───────────────────────── a hora, em blocos ─────────────────────────


def _segundo_do_dia(t: datetime) -> int:
    return t.hour * 3600 + t.minute * 60 + t.second


def inicio_do_bloco(t: datetime, bloco_s: int) -> datetime:
    """O começo do bloco em que `t` cai."""
    if bloco_s < 1:
        raise ValueError("o bloco tem pelo menos 1 segundo")
    sem_fracao = t.replace(microsecond=0)
    return sem_fracao - timedelta(seconds=_segundo_do_dia(sem_fracao) % bloco_s)


def pedido_que_cobre(de: datetime, ate: datetime, bloco_s: int | None) -> tuple[datetime, datetime]:
    """As duas pontas a PEDIR para o que volta conter de `de` até `ate`.

    O gravador arredonda as duas pontas para baixo, para o começo do bloco:
    pedir de 20 a 33 s devolve de 20 a 32. Para ter o segundo 33 é preciso
    pedir até 34. Sem saber o bloco, só se tira a fração de segundo — para
    cima no fim, para o trecho pedido não ficar menor que o desejado.
    """
    if ate <= de:
        raise ValueError("o trecho termina depois de começar")
    if bloco_s is None:
        fim = ate.replace(microsecond=0)
        return de.replace(microsecond=0), fim if fim == ate else fim + timedelta(seconds=1)
    comeco = inicio_do_bloco(de, bloco_s)
    fim = inicio_do_bloco(ate, bloco_s)
    if fim < ate:
        fim += timedelta(seconds=bloco_s)
    return comeco, fim


# ───────────────────────── o desafio de senha ─────────────────────────

_RESUMOS: dict[str, Callable[..., "hashlib._Hash"]] = {"MD5": hashlib.md5, "SHA-256": hashlib.sha256}


def _resposta_ao_desafio(desafio: str, *, metodo: str, caminho: str, usuario: str, senha: str) -> str | None:
    """O cabeçalho de autorização para um desafio "Digest", ou `None` se este cliente não sabe respondê-lo."""
    try:
        campos = parse_keqv_list(parse_http_list(desafio.strip()[len("Digest"):].strip()))
    except ValueError:
        return None
    algoritmo = (campos.get("algorithm") or "MD5").upper()
    qops = [q.strip().lower() for q in (campos.get("qop") or "").split(",") if q.strip()]
    resumir = _RESUMOS.get(algoritmo)
    nonce = campos.get("nonce")
    realm = campos.get("realm")
    if resumir is None or not nonce or realm is None or (qops and "auth" not in qops):
        return None

    def h(texto: str) -> str:
        return resumir(texto.encode("utf-8")).hexdigest()

    ha1 = h(f"{usuario}:{realm}:{senha}")
    ha2 = h(f"{metodo}:{caminho}")
    if qops:
        nc, cnonce = "00000001", secrets.token_hex(8)
        resposta = h(f"{ha1}:{nonce}:{nc}:{cnonce}:auth:{ha2}")
    else:
        resposta = h(f"{ha1}:{nonce}:{ha2}")
    partes = [
        f'username="{usuario}"', f'realm="{realm}"', f'nonce="{nonce}"', f'uri="{caminho}"', f'response="{resposta}"',
    ]
    if campos.get("opaque") is not None:
        partes.append(f'opaque="{campos["opaque"]}"')
    if qops:
        partes += ["qop=auth", f"nc={nc}", f'cnonce="{cnonce}"']
    if "algorithm" in campos:
        partes.append(f'algorithm={campos["algorithm"]}')
    return "Digest " + ", ".join(partes)


# ───────────────────────── o cliente ─────────────────────────


class ClienteDeArquivo:
    """Pede trechos gravados a UM gravador.

    `senha` é uma função: a senha é lida do cofre na hora do pedido e não
    fica guardada no objeto.
    """

    def __init__(
        self,
        host: str,
        usuario: str,
        senha: Callable[[], str],
        *,
        perfil: PerfilDeArquivo = PerfilDeArquivo(),
        agora: Callable[[], float] = time.monotonic,
        hora_do_computador: Callable[[], datetime] = datetime.now,
    ) -> None:
        self.host = host
        self.perfil = perfil
        self._usuario = usuario
        self._senha = senha
        self._agora = agora
        self._hora_do_computador = hora_do_computador
        self._porta = _porta_de(host, perfil.porta)

    # ────────────────────────── o pedido ──────────────────────────

    def _conectar(self, tempo: float) -> http.client.HTTPConnection:
        return http.client.HTTPConnection(self.host, self.perfil.porta, timeout=tempo)

    def _pedir(self, caminho: str, ao_responder: Callable[[http.client.HTTPResponse, float], object]) -> object:
        """Um GET com o desafio feito à mão: um pedido sem credencial e, no máximo, UM com ela.

        `ao_responder` recebe a resposta 200 e o instante em que o pedido com
        credencial saiu; o que ela devolver é o que este método devolve.
        """
        if not self._porta.vez.acquire(timeout=ESPERA_DA_VEZ):
            raise GravadorOcupado(
                f"o gravador {self.host} está atendendo outro pedido há mais de {ESPERA_DA_VEZ:.0f}s",
            )
        try:
            senha = self._senha()
            if self._porta.recusada is not None:
                if self._porta.recusada == _impressao(senha):
                    raise PedidoRecusado(
                        "o gravador recusou esta credencial, e o pedido não é repetido com ela",
                        dica="corrija o usuário ou a senha do gravador; com a senha nova o agente volta a pedir",
                    )
                # A senha mudou: a recusa era da outra.
                self._porta.recusada = None

            try:
                desafio = self._desafio(caminho, ao_responder)
                if not isinstance(desafio, _Desafio):
                    return desafio   # o gravador atendeu sem pedir senha
                cabecalho = _resposta_ao_desafio(
                    desafio.texto, metodo="GET", caminho=caminho, usuario=self._usuario, senha=senha,
                )
                if cabecalho is None:
                    raise ErroDoGravador(
                        f"o gravador {self.host} pede a senha de um jeito que este cliente não responde",
                        dica="o caminho de arquivo foi medido com desafio Digest (MD5, qop=auth)",
                    )
                return self._com_credencial(caminho, cabecalho, senha, ao_responder)
            except (TimeoutError, socket.timeout) as e:
                raise ErroDoGravador(f"o gravador {self.host} parou de responder no meio do pedido") from e
            except OSError as e:
                raise ErroDoGravador(
                    f"não alcancei o gravador {self.host} na porta {self.perfil.porta} ({type(e).__name__})",
                    dica="o gravador está ligado e na mesma rede? a porta HTTP é esta mesmo?",
                ) from e
            except http.client.HTTPException as e:
                raise ErroDoGravador(f"o gravador {self.host} respondeu fora do protocolo ({type(e).__name__})") from e
        finally:
            self._porta.vez.release()

    def _desafio(self, caminho: str, ao_responder: Callable[[http.client.HTTPResponse, float], object]) -> object:
        """O pedido SEM credencial. Devolve o desafio — ou a própria resposta, se o gravador não pede senha."""
        con = self._conectar(TEMPO_DE_CONEXAO)
        try:
            saiu = self._agora()
            con.request("GET", caminho, headers={"Connection": "close", "User-Agent": "farol-agent"})
            r = con.getresponse()
            if r.status == 200:
                return ao_responder(r, saiu)
            desafios = r.headers.get_all("WWW-Authenticate") or []
            r.read(4096)
            if r.status != 401:
                raise self._erro_http(r.status, caminho)
        finally:
            con.close()
        digest = next((d for d in desafios if d.strip().lower().startswith("digest")), None)
        if digest is None:
            raise ErroDoGravador(
                f"o gravador {self.host} pede a senha de um jeito que este cliente não responde",
                dica="o caminho de arquivo foi medido com desafio Digest (MD5, qop=auth)",
            )
        return _Desafio(digest)

    def _com_credencial(
        self,
        caminho: str,
        cabecalho: str,
        senha: str,
        ao_responder: Callable[[http.client.HTTPResponse, float], object],
    ) -> object:
        """O pedido COM credencial. Uma vez só: recusou, a porta fecha para esta senha."""
        con = self._conectar(TEMPO_DE_SILENCIO)
        try:
            saiu = self._agora()
            con.request(
                "GET", caminho,
                headers={"Authorization": cabecalho, "Connection": "close", "User-Agent": "farol-agent"},
            )
            r = con.getresponse()
            if r.status == 200:
                return ao_responder(r, saiu)
            r.read(4096)
            if r.status in (401, 403):
                self._porta.recusada = _impressao(senha)
                _log.error(
                    "o gravador %s recusou a credencial num pedido de arquivo: não peço de novo com ela", self.host,
                )
                raise PedidoRecusado(
                    "usuário ou senha recusados pelo gravador",
                    dica="confira o usuário e a senha do gravador. O pedido não será repetido com esta senha",
                )
            raise self._erro_http(r.status, caminho)
        finally:
            con.close()

    def _erro_http(self, status: int, caminho: str) -> ErroDoGravador:
        # Só o nome do recurso: a linha do pedido leva a hora e o canal, e não precisa ir para o registro.
        recurso = caminho.split("?", 1)[0]
        if status == 400 and "loadfile.cgi" in recurso:
            return SemGravacao(
                "o gravador não tem gravação nesse trecho",
                dica="o trecho pode ser mais novo do que o que já foi gravado, ou mais antigo do que o disco guarda",
            )
        if status == 404:
            return ErroDoGravador(
                f"o gravador não conhece {recurso}",
                dica="firmware sem o caminho de arquivo da família Dahua, ou modelo diferente do esperado",
            )
        return ErroDoGravador(f"HTTP {status} em {recurso}")

    # ────────────────────────── o relógio ──────────────────────────

    def relogio(self, *, idade_maxima_s: float = IDADE_DO_RELOGIO) -> timedelta:
        """Quanto o relógio do gravador está ADIANTADO em relação ao do computador.

        Negativo = atrasado. A medida é guardada por gravador e refeita depois
        de `idade_maxima_s`. O erro dela é de até um segundo (o gravador responde
        em segundos inteiros) mais metade do tempo do pedido.
        """
        guardado = self._porta.relogio
        if guardado is not None and self._agora() - guardado[0] <= idade_maxima_s:
            return guardado[1]

        def ler(r: http.client.HTTPResponse, saiu: float) -> timedelta:
            texto = r.read(4096).decode("utf-8", "replace")
            # O instante do computador que corresponde à leitura: o meio do pedido.
            meio = self._hora_do_computador() - timedelta(seconds=(self._agora() - saiu) / 2)
            for linha in texto.splitlines():
                chave, _, valor = linha.partition("=")
                if chave.strip() == "result":
                    try:
                        return datetime.strptime(valor.strip(), _HORA) - meio
                    except ValueError:
                        break
            raise ErroDoGravador(
                f"o gravador {self.host} não disse a hora no formato esperado",
                dica="esperado: result=AAAA-MM-DD HH:MM:SS",
            )

        diferenca = self._pedir("/cgi-bin/global.cgi?action=getCurrentTime", ler)
        assert isinstance(diferenca, timedelta)
        self._porta.relogio = (self._agora(), diferenca)
        return diferenca

    # ────────────────────────── o trecho ──────────────────────────

    def baixar(
        self,
        canal: int,
        de: datetime,
        ate: datetime,
        destino: Path,
        *,
        teto: int = TETO_DO_TRECHO,
        limite_s: float = LIMITE_DO_PEDIDO,
    ) -> Trecho:
        """Baixa o trecho gravado do canal, de `de` até `ate` (no relógio do gravador), para `destino`.

        As pontas são ajustadas aos blocos do perfil, para o que volta conter
        o intervalo pedido. O arquivo que não chegou inteiro é apagado: ou o
        trecho está todo em `destino`, ou `destino` não existe.
        """
        if canal < 1:
            raise ValueError("canal começa em 1, como na tela do gravador")
        comeco, fim = pedido_que_cobre(de, ate, self.perfil.bloco_s)
        if fim - comeco > MAIOR_TRECHO:
            raise ValueError(f"trecho de no máximo {MAIOR_TRECHO.total_seconds():.0f} segundos por pedido")
        caminho = (
            f"/cgi-bin/loadfile.cgi?action=startLoad&channel={canal}"
            f"&startTime={comeco:%Y-%m-%d}%20{comeco:%H:%M:%S}&endTime={fim:%Y-%m-%d}%20{fim:%H:%M:%S}&subtype=0"
        )

        def gravar(r: http.client.HTTPResponse, saiu: float) -> Trecho:
            tipo = (r.getheader("Content-Type") or "").strip().lower()
            # Uma página de erro com código 200 não é vídeo: dizer isso, em vez de entregar um arquivo que não abre.
            if tipo.startswith("text/"):
                raise ErroDoGravador(
                    f"o gravador {self.host} respondeu '{tipo}' no lugar do trecho",
                    dica="este endereço é mesmo o gravador? o firmware tem o caminho de arquivo?",
                )
            declarado_bruto = r.getheader("Content-Length")
            declarado = int(declarado_bruto) if declarado_bruto and declarado_bruto.isdigit() else None
            if declarado is not None and declarado > teto:
                raise ErroDoGravador(f"o trecho tem {declarado} bytes, acima do teto de {teto}")
            total = 0
            primeiro: float | None = None
            # O disco que falha é dito como disco: sem isto, "disco cheio" sairia como "não alcancei o gravador".
            try:
                arquivo = open(destino, "wb")
            except OSError as e:
                raise ErroDoGravador(f"não consegui criar o arquivo do trecho ({type(e).__name__})") from e
            try:
                with arquivo:
                    while True:
                        if self._agora() - saiu > limite_s:
                            raise ErroDoGravador(f"o trecho não chegou inteiro em {limite_s:.0f}s")
                        pedaco = r.read(_PEDACO)
                        if not pedaco:
                            break
                        if primeiro is None:
                            primeiro = self._agora() - saiu
                        total += len(pedaco)
                        if total > teto:
                            raise ErroDoGravador(f"o trecho passou do teto de {teto} bytes")
                        try:
                            arquivo.write(pedaco)
                        except OSError as e:
                            raise ErroDoGravador(f"não consegui gravar o trecho no disco ({type(e).__name__})") from e
                if total == 0:
                    raise SemGravacao("o gravador respondeu sem nenhum byte de gravação nesse trecho")
                # A biblioteca NÃO acusa a resposta que fecha antes do tamanho declarado (lendo em pedaços,
                # ela devolve vazio e pronto): quem confere é este cliente.
                if declarado is not None and total != declarado:
                    raise ErroDoGravador(f"o trecho veio cortado: {total} de {declarado} bytes")
            except BaseException:
                # Arquivo pela metade não fica: quem lê depois não distingue de trecho bom.
                try:
                    destino.unlink(missing_ok=True)
                except OSError:
                    pass
                raise
            return Trecho(
                canal=canal, de=comeco, ate=fim, caminho=destino, tamanho=total, declarado=declarado, tipo=tipo,
                ate_o_primeiro_byte_s=primeiro if primeiro is not None else 0.0, total_s=self._agora() - saiu,
            )

        trecho = self._pedir(caminho, gravar)
        assert isinstance(trecho, Trecho)
        return trecho

    def ja_gravado(self, ate: datetime, agora_no_gravador: datetime) -> bool:
        """O trecho que termina em `ate` já pode ser pedido? (As duas horas, no relógio do gravador.)"""
        return ate + timedelta(seconds=self.perfil.atraso_s) <= agora_no_gravador

    def espera_ate_gravar(self, ate: datetime, agora_no_gravador: datetime) -> float:
        """Quantos segundos faltam para o trecho que termina em `ate` poder ser pedido. Zero = já pode."""
        falta = (ate + timedelta(seconds=self.perfil.atraso_s) - agora_no_gravador).total_seconds()
        return max(0.0, math.ceil(falta * 10) / 10)


@dataclass(frozen=True)
class _Desafio:
    texto: str
