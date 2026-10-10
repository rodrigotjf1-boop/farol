"""O caminho de arquivo do gravador: pedir um trecho já gravado.

O gravador aqui é um servidor de verdade, na própria máquina, que pede a
senha como a família Dahua pede (desafio "Digest") e CONFERE a resposta — o
desafio é feito à mão no cliente, e um dublê que aceitasse qualquer
cabeçalho não provaria a conta.

O que tem de ficar provado:

- um pedido sem credencial e, no máximo, UM com ela; recusado, a porta fecha
  para aquela senha e nada mais sai — nem o desafio;
- "não há gravação" não é recusa, e não fecha porta nenhuma;
- um pedido por vez por GRAVADOR, mesmo com dois clientes;
- ou o trecho está inteiro no destino, ou o destino não existe;
- nada de usuário, senha ou "realm" em erro nem em registro.
"""

from __future__ import annotations

import hashlib
import logging
import secrets
import socket
import threading
import time
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import parse_http_list, parse_keqv_list

import pytest

from farol_agent.dvr import arquivo
from farol_agent.dvr.arquivo import (
    ClienteDeArquivo,
    GravadorOcupado,
    PedidoRecusado,
    PerfilDeArquivo,
    SemGravacao,
    inicio_do_bloco,
    pedido_que_cobre,
)
from farol_agent.dvr.dahua import ErroDoGravador

USUARIO = "admin"
SENHA = "segredo-de-teste-9f3a"
# O "realm" de verdade traz o número de série do aparelho: não pode aparecer em lugar nenhum.
REALM = "Login to SERIE0014446184"

T = datetime(2026, 10, 9, 19, 51, 20)


class _Estado:
    """O que o gravador de mentira faz, e o que ele viu."""

    def __init__(self) -> None:
        self.corpo = secrets.token_bytes(5000)
        self.hora = "2026-10-09 19:51:24"
        self.resposta_da_hora: bytes | None = None   # o corpo inteiro, no lugar de `result=<hora>`
        self.qop: str | None = "auth"
        self.algoritmo: str | None = None
        self.opaco: str | None = None
        self.desafio_cru: str | None = None   # um desafio escrito à mão, no lugar do Digest de sempre
        self.sem_senha = False
        self.lixo = False                     # responde algo que não é HTTP
        self.status_do_trecho = 200
        self.tipo = "application/http"
        self.declarar: int | None = -1        # -1 = o tamanho de verdade; None = não declara
        self.pausa = 0.0                      # antes de responder ao pedido com credencial
        self.pausa_no_desafio = 0.0           # antes de responder ao pedido SEM credencial
        self.status_sem_credencial: int | None = None   # o que responder, no lugar do desafio, a quem veio sem credencial
        self.desafios_a_mais: list[str] = []  # outros cabeçalhos de desafio, mandados ANTES do Digest
        self.gotejar = 0.0                    # entre um pedaço e outro do corpo
        self.pedidos: list[tuple[str, bool]] = []   # (caminho, veio com credencial)
        self.agentes: list[str | None] = []   # o User-Agent de cada pedido
        self.juntos = 0
        self.maximo_juntos = 0
        self.guarda = threading.Lock()

    def com_credencial(self, caminho: str | None = None) -> int:
        return sum(1 for c, cred in self.pedidos if cred and (caminho is None or c.startswith(caminho)))

    def sem_credencial(self) -> int:
        return sum(1 for _, cred in self.pedidos if not cred)


def _resumir(algoritmo: str | None, texto: str) -> str:
    return (hashlib.sha256 if (algoritmo or "MD5").upper() == "SHA-256" else hashlib.md5)(texto.encode()).hexdigest()


class _Gravador(BaseHTTPRequestHandler):
    estado: _Estado

    def _credencial_confere(self) -> bool:
        cab = self.headers.get("Authorization", "")
        if not cab.startswith("Digest "):
            return False
        c = parse_keqv_list(parse_http_list(cab[len("Digest "):]))
        e = self.estado
        if c.get("username") != USUARIO or c.get("realm") != REALM or c.get("uri") != self.path:
            return False
        ha1 = _resumir(e.algoritmo, f"{USUARIO}:{REALM}:{SENHA}")
        ha2 = _resumir(e.algoritmo, f"GET:{self.path}")
        if e.qop:
            esperado = _resumir(e.algoritmo, f"{ha1}:{c.get('nonce')}:{c.get('nc')}:{c.get('cnonce')}:auth:{ha2}")
            if c.get("qop") != "auth":
                return False
        else:
            esperado = _resumir(e.algoritmo, f"{ha1}:{c.get('nonce')}:{ha2}")
        if e.opaco is not None and c.get("opaque") != e.opaco:
            return False
        # O algoritmo pedido no desafio volta no cabeçalho, como veio.
        if e.algoritmo is not None and c.get("algorithm") != e.algoritmo:
            return False
        return secrets.compare_digest(c.get("response", ""), esperado)

    def _desafiar(self) -> None:
        e = self.estado
        if e.desafio_cru is not None:
            desafio = e.desafio_cru
        else:
            desafio = f'Digest realm="{REALM}", nonce="{secrets.token_hex(8)}"'
            if e.qop:
                desafio += f', qop="{e.qop}"'
            if e.algoritmo:
                desafio += f", algorithm={e.algoritmo}"
            if e.opaco:
                desafio += f', opaque="{e.opaco}"'
        self.send_response(401)
        for outro in e.desafios_a_mais:
            self.send_header("WWW-Authenticate", outro)
        self.send_header("WWW-Authenticate", desafio)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802 — nome exigido pela biblioteca
        e = self.estado
        veio_com = "Authorization" in self.headers
        with e.guarda:
            e.pedidos.append((self.path, veio_com))
            e.agentes.append(self.headers.get("User-Agent"))
        if e.lixo:
            self.wfile.write(b"ISTO NAO E HTTP\r\n\r\n")
            self.close_connection = True
            return
        if not veio_com:
            if e.pausa_no_desafio:
                time.sleep(e.pausa_no_desafio)
            if e.status_sem_credencial is not None:
                self._responder(e.status_sem_credencial, "text/plain", b"Error\r\n")
                return
        if not e.sem_senha and not self._credencial_confere():
            self._desafiar()
            return
        with e.guarda:
            e.juntos += 1
            e.maximo_juntos = max(e.maximo_juntos, e.juntos)
        try:
            if e.pausa:
                time.sleep(e.pausa)
            if self.path.startswith("/cgi-bin/global.cgi"):
                corpo = e.resposta_da_hora if e.resposta_da_hora is not None else f"result={e.hora}\r\n".encode()
                self._responder(200, "text/plain", corpo)
            elif self.path.startswith("/cgi-bin/loadfile.cgi"):
                if e.status_do_trecho != 200:
                    self._responder(e.status_do_trecho, "text/plain", b"Error\r\n")
                else:
                    self._responder(200, e.tipo, e.corpo, declarar=e.declarar, gotejar=e.gotejar)
            else:
                self._responder(404, "text/plain", b"Not Found\r\n")
        finally:
            with e.guarda:
                e.juntos -= 1

    def _responder(self, status: int, tipo: str, corpo: bytes, *, declarar: int | None = -1, gotejar: float = 0.0) -> None:
        self.send_response(status)
        self.send_header("Content-Type", tipo)
        if declarar is not None:
            self.send_header("Content-Length", str(len(corpo) if declarar == -1 else declarar))
        self.send_header("Connection", "close")
        self.end_headers()
        try:
            for i in range(0, len(corpo), 1000):
                self.wfile.write(corpo[i:i + 1000])
                self.wfile.flush()
                if gotejar:
                    time.sleep(gotejar)
        except OSError:
            pass   # o cliente desistiu no meio: é o que alguns testes provocam
        self.close_connection = True

    def log_message(self, *_: object) -> None:  # o teste não escreve no terminal
        return


@pytest.fixture
def gravador():
    """`(estado, porta)` de um gravador de mentira novo, com a memória do cliente zerada."""
    arquivo.esquecer_gravadores()
    estado = _Estado()
    classe = type("_GravadorDoTeste", (_Gravador,), {"estado": estado})
    servidor = ThreadingHTTPServer(("127.0.0.1", 0), classe)
    servidor.daemon_threads = True
    linha = threading.Thread(target=servidor.serve_forever, daemon=True)
    linha.start()
    try:
        yield estado, servidor.server_address[1]
    finally:
        servidor.shutdown()
        servidor.server_close()
        linha.join(timeout=5)
        arquivo.esquecer_gravadores()


def _cliente(porta: int, senha: str = SENHA, **mais) -> ClienteDeArquivo:
    return ClienteDeArquivo("127.0.0.1", USUARIO, lambda: senha, perfil=PerfilDeArquivo(bloco_s=2, atraso_s=8.0, porta=porta), **mais)


# ───────────────────────── a hora, em blocos ─────────────────────────


def test_o_pedido_cobre_o_intervalo_porque_o_gravador_arredonda_para_baixo():
    s = lambda segundos, micro=0: T.replace(second=0) + timedelta(seconds=segundos, microseconds=micro)  # noqa: E731
    # O exemplo medido: pedir de 20 a 33 devolve de 20 a 32. Para ter o 33, pede-se até 34.
    assert pedido_que_cobre(s(20), s(33), 2) == (s(20), s(34))
    assert pedido_que_cobre(s(21), s(33), 2) == (s(20), s(34))
    # Já em cima do bloco: nada a esticar.
    assert pedido_que_cobre(s(20), s(32), 2) == (s(20), s(32))
    # A fração de segundo conta: 32,1 já pede o bloco seguinte; 21,9 começa no 20.
    assert pedido_que_cobre(s(21, 900_000), s(32, 100_000), 2) == (s(20), s(34))
    assert pedido_que_cobre(s(20, 1), s(21), 2) == (s(20), s(22))
    # Bloco de 10 s, e a virada do minuto e da hora.
    assert pedido_que_cobre(s(57), s(63), 10) == (s(50), s(70))
    fim_da_hora = datetime(2026, 10, 9, 19, 59, 59)
    assert pedido_que_cobre(fim_da_hora, fim_da_hora + timedelta(seconds=2), 2) == (
        datetime(2026, 10, 9, 19, 59, 58), datetime(2026, 10, 9, 20, 0, 2),
    )
    # O bloco conta do começo do DIA, não do minuto: 19:51:20 é o segundo 71.480 do dia, e 71.480 = 7 × 10.211 + 3.
    assert inicio_do_bloco(T, 7) == datetime(2026, 10, 9, 19, 51, 17)
    assert inicio_do_bloco(datetime(2026, 10, 9, 0, 0, 6, 999_999), 7) == datetime(2026, 10, 9, 0, 0, 0)
    assert inicio_do_bloco(T.replace(microsecond=5), 1) == T


def test_sem_saber_o_bloco_so_sai_a_fracao_de_segundo():
    de, ate = T.replace(microsecond=400_000), T + timedelta(seconds=3, microseconds=200_000)
    assert pedido_que_cobre(de, ate, None) == (T, T + timedelta(seconds=4))
    assert pedido_que_cobre(T, T + timedelta(seconds=3), None) == (T, T + timedelta(seconds=3))


def test_trecho_que_nao_e_trecho_e_recusado_antes_de_qualquer_pedido(gravador, tmp_path: Path):
    estado, porta = gravador
    c = _cliente(porta)
    for de, ate in [(T, T), (T, T - timedelta(seconds=1))]:
        with pytest.raises(ValueError, match="termina depois de começar"):
            c.baixar(4, de, ate, tmp_path / "t.dav")
    with pytest.raises(ValueError, match="no máximo 40 segundos"):
        c.baixar(4, T, T + timedelta(seconds=41), tmp_path / "t.dav")
    # 40 s cabem — e 39,5 s que viram 40 depois de esticar, também.
    c.baixar(4, T, T + timedelta(seconds=40), tmp_path / "ok.dav")
    with pytest.raises(ValueError, match="canal começa em 1"):
        c.baixar(0, T, T + timedelta(seconds=2), tmp_path / "t.dav")
    with pytest.raises(ValueError, match="pelo menos 1 segundo"):
        inicio_do_bloco(T, 0)
    assert estado.com_credencial() == 1 and not (tmp_path / "t.dav").exists()


def test_sem_medida_nao_se_supoe_o_que_o_gravador_entrega():
    # Nenhum número de aparelho mora no motor: sem medida, não há bloco, e a espera é a de cautela.
    assert PerfilDeArquivo() == PerfilDeArquivo(bloco_s=None, atraso_s=10.0, porta=80)
    assert not [nome for nome in vars(arquivo) if nome.startswith("PERFIL_")]


def test_o_trecho_so_pode_ser_pedido_depois_do_atraso_do_gravador(gravador):
    _, porta = gravador
    c = _cliente(porta)
    ate = T + timedelta(seconds=2)
    assert c.ja_gravado(ate, ate + timedelta(seconds=8)) is True
    assert c.ja_gravado(ate, ate + timedelta(seconds=7, microseconds=999_999)) is False
    assert c.espera_ate_gravar(ate, ate + timedelta(seconds=8)) == 0.0
    assert c.espera_ate_gravar(ate, ate + timedelta(seconds=20)) == 0.0
    assert c.espera_ate_gravar(ate, ate) == 8.0
    # Faltam 2,51 s: a espera é arredondada PARA CIMA, em décimos — esperar de menos é pedir cedo demais.
    assert c.espera_ate_gravar(ate, ate + timedelta(seconds=5, milliseconds=490)) == 2.6


# ───────────────────────── baixar ─────────────────────────


def test_baixa_o_trecho_com_um_desafio_e_um_pedido_com_credencial(gravador, tmp_path: Path):
    estado, porta = gravador
    destino = tmp_path / "trecho.dav"
    t = _cliente(porta).baixar(4, T + timedelta(seconds=1, milliseconds=400), T + timedelta(seconds=5, milliseconds=200), destino)

    assert destino.read_bytes() == estado.corpo
    assert (t.canal, t.de, t.ate) == (4, T, T + timedelta(seconds=6))
    assert (t.tamanho, t.declarado, t.tipo, t.caminho) == (5000, 5000, "application/http", destino)
    assert 0 <= t.ate_o_primeiro_byte_s <= t.total_s < 10
    # O pedido, na forma medida no gravador de verdade — e só dois: o do desafio e UM com a credencial.
    caminho = "/cgi-bin/loadfile.cgi?action=startLoad&channel=4&startTime=2026-10-09%2019:51:20&endTime=2026-10-09%2019:51:26&subtype=0"
    assert estado.pedidos == [(caminho, False), (caminho, True)]
    # Com nome próprio: o do `urllib` é assinatura de robô para qualquer filtro no caminho.
    assert estado.agentes == ["farol-agent", "farol-agent"]


@pytest.mark.parametrize(
    "qop, algoritmo, opaco",
    [
        ("auth", None, None), ("auth", "MD5", None), ("auth", "md5", None), (None, None, None), (None, "MD5", "xyz"),
        ("auth", "SHA-256", None), ("auth", None, "abc-123"), ("auth,auth-int", None, None), ("minusculas", None, None),
        ("dois", None, None),
    ],
)
def test_o_desafio_e_respondido_certo_em_cada_jeito_de_pedir(gravador, tmp_path: Path, qop, algoritmo, opaco):
    estado, porta = gravador
    estado.qop, estado.algoritmo, estado.opaco = qop, algoritmo, opaco
    if qop == "auth,auth-int":
        estado.qop = "auth"            # o que o servidor confere…
        estado.desafio_cru = f'Digest realm="{REALM}", nonce="{secrets.token_hex(8)}", qop="{qop}"'   # …e o que ele oferece
    elif qop == "minusculas":          # o nome do esquema em minúsculas
        estado.qop = "auth"
        estado.desafio_cru = f'digest realm="{REALM}", nonce="{secrets.token_hex(8)}", qop="auth"'
    elif qop == "dois":                # dois desafios: o que o cliente não sabe vem antes
        estado.qop = "auth"
        estado.desafios_a_mais = ['Basic realm="gravador"']
    t = _cliente(porta).baixar(1, T, T + timedelta(seconds=2), tmp_path / "t.dav")
    assert t.tamanho == 5000
    assert estado.com_credencial() == 1


def test_senha_recusada_fecha_a_porta_e_o_pedido_nao_se_repete(gravador, tmp_path: Path):
    estado, porta = gravador
    errado = _cliente(porta, senha="senha-errada")
    with pytest.raises(PedidoRecusado, match="recusados pelo gravador"):
        errado.baixar(4, T, T + timedelta(seconds=2), tmp_path / "t.dav")
    assert (estado.sem_credencial(), estado.com_credencial()) == (1, 1)

    # Daqui em diante, com a MESMA senha, nada sai da máquina — nem o desafio, nem pelo relógio,
    # nem por outro cliente para o mesmo gravador.
    for pedir in (
        lambda: errado.baixar(4, T, T + timedelta(seconds=2), tmp_path / "t.dav"),
        lambda: errado.relogio(),
        lambda: _cliente(porta, senha="senha-errada").baixar(2, T, T + timedelta(seconds=2), tmp_path / "u.dav"),
    ):
        with pytest.raises(PedidoRecusado, match="não é repetido"):
            pedir()
    assert len(estado.pedidos) == 2
    assert not (tmp_path / "t.dav").exists() and not (tmp_path / "u.dav").exists()


def test_com_a_senha_nova_o_cliente_volta_a_pedir(gravador, tmp_path: Path):
    estado, porta = gravador
    atual = {"senha": "senha-errada"}
    c = ClienteDeArquivo("127.0.0.1", USUARIO, lambda: atual["senha"], perfil=PerfilDeArquivo(bloco_s=2, porta=porta))
    with pytest.raises(PedidoRecusado):
        c.baixar(4, T, T + timedelta(seconds=2), tmp_path / "t.dav")
    # A senha foi corrigida no cofre: o mesmo cliente volta a falar com o gravador.
    atual["senha"] = SENHA
    assert c.baixar(4, T, T + timedelta(seconds=2), tmp_path / "t.dav").tamanho == 5000
    # E a recusa antiga não volta a valer para a senha antiga… que é recusada de novo, uma vez.
    atual["senha"] = "senha-errada"
    antes = estado.com_credencial()
    with pytest.raises(PedidoRecusado, match="recusados pelo gravador"):
        c.baixar(4, T, T + timedelta(seconds=2), tmp_path / "v.dav")
    assert estado.com_credencial() == antes + 1


def test_403_tambem_e_recusa(gravador, tmp_path: Path):
    estado, porta = gravador
    estado.status_do_trecho = 403
    c = _cliente(porta)
    with pytest.raises(PedidoRecusado):
        c.baixar(4, T, T + timedelta(seconds=2), tmp_path / "t.dav")
    with pytest.raises(PedidoRecusado, match="não é repetido"):
        c.baixar(4, T, T + timedelta(seconds=2), tmp_path / "t.dav")
    assert estado.com_credencial() == 1


def test_nao_ha_gravacao_nao_e_recusa_e_nao_fecha_porta(gravador, tmp_path: Path):
    estado, porta = gravador
    c = _cliente(porta)
    estado.status_do_trecho = 400
    # Dez seguidas: o cliente ao vivo, com o `urllib`, virava "senha recusada" na sexta (ERR-053).
    for _ in range(10):
        with pytest.raises(SemGravacao, match="não tem gravação nesse trecho"):
            c.baixar(4, T, T + timedelta(seconds=2), tmp_path / "t.dav")
    assert not (tmp_path / "t.dav").exists()
    estado.status_do_trecho = 200
    assert c.baixar(4, T, T + timedelta(seconds=2), tmp_path / "t.dav").tamanho == 5000
    assert estado.com_credencial() == 11


def test_outros_erros_do_gravador_sao_ditos_sem_a_linha_do_pedido(gravador, tmp_path: Path):
    estado, porta = gravador
    c = _cliente(porta)
    estado.status_do_trecho = 404
    with pytest.raises(ErroDoGravador) as e:
        c.baixar(4, T, T + timedelta(seconds=2), tmp_path / "t.dav")
    assert str(e.value) == "o gravador não conhece /cgi-bin/loadfile.cgi" and not isinstance(e.value, (SemGravacao, PedidoRecusado))
    estado.status_do_trecho = 500
    with pytest.raises(ErroDoGravador) as e:
        c.baixar(4, T, T + timedelta(seconds=2), tmp_path / "t.dav")
    assert str(e.value) == "HTTP 500 em /cgi-bin/loadfile.cgi"
    # O 400 de OUTRO recurso não é "sem gravação".
    assert not isinstance(c._erro_http(400, "/cgi-bin/global.cgi?action=getCurrentTime"), SemGravacao)


def test_erro_antes_do_desafio_nao_leva_a_credencial(gravador, tmp_path: Path):
    estado, porta = gravador
    c = _cliente(porta)
    for status, frase in [(404, "o gravador não conhece /cgi-bin/loadfile.cgi"), (500, "HTTP 500 em /cgi-bin/loadfile.cgi")]:
        estado.status_sem_credencial = status
        with pytest.raises(ErroDoGravador) as e:
            c.baixar(4, T, T + timedelta(seconds=2), tmp_path / "t.dav")
        assert str(e.value) == frase and not isinstance(e.value, PedidoRecusado)
    # Nenhum pedido levou a credencial, e a porta não fechou.
    assert estado.com_credencial() == 0
    estado.status_sem_credencial = None
    assert c.baixar(4, T, T + timedelta(seconds=2), tmp_path / "t.dav").tamanho == 5000


def test_gravador_mudo_e_abandonado(gravador, tmp_path: Path, monkeypatch):
    estado, porta = gravador
    monkeypatch.setattr(arquivo, "TEMPO_DE_CONEXAO", 0.3)
    estado.pausa_no_desafio = 1.5
    comeco = time.monotonic()
    with pytest.raises(ErroDoGravador, match="parou de responder no meio do pedido") as e:
        _cliente(porta).baixar(4, T, T + timedelta(seconds=2), tmp_path / "t.dav")
    assert time.monotonic() - comeco < 1.4 and not isinstance(e.value, PedidoRecusado)
    assert estado.com_credencial() == 0
    # O mesmo no pedido com credencial: o silêncio não é recusa, e a porta não fecha.
    estado.pausa_no_desafio = 0.0
    estado.pausa = 1.5
    monkeypatch.setattr(arquivo, "TEMPO_DE_SILENCIO", 0.3)
    c = _cliente(porta)
    with pytest.raises(ErroDoGravador, match="parou de responder no meio do pedido") as e:
        c.baixar(4, T, T + timedelta(seconds=2), tmp_path / "t.dav")
    assert not isinstance(e.value, PedidoRecusado)
    estado.pausa = 0.0
    assert c.baixar(4, T, T + timedelta(seconds=2), tmp_path / "t.dav").tamanho == 5000


def test_gravador_que_nao_pede_senha_e_atendido_num_pedido_so(gravador, tmp_path: Path):
    estado, porta = gravador
    estado.sem_senha = True
    assert _cliente(porta).baixar(4, T, T + timedelta(seconds=2), tmp_path / "t.dav").tamanho == 5000
    assert len(estado.pedidos) == 1 and estado.pedidos[0][1] is False


@pytest.mark.parametrize(
    "desafio",
    [
        'Basic realm="gravador"',
        f'Digest realm="{REALM}", nonce="abc", qop="auth-int"',
        f'Digest realm="{REALM}", nonce="abc", qop="auth", algorithm=SHA-512-256',
        f'Digest realm="{REALM}", qop="auth"',
        'Digest nonce="abc", qop="auth"',
        'Digest isto nao e um desafio',
    ],
)
def test_desafio_que_o_cliente_nao_responde_nao_gasta_tentativa_nem_fecha_a_porta(gravador, tmp_path: Path, desafio):
    estado, porta = gravador
    estado.desafio_cru = desafio
    c = _cliente(porta)
    with pytest.raises(ErroDoGravador, match="pede a senha de um jeito que este cliente não responde") as e:
        c.baixar(4, T, T + timedelta(seconds=2), tmp_path / "t.dav")
    assert not isinstance(e.value, PedidoRecusado)
    assert estado.com_credencial() == 0
    # Com o desafio de sempre de volta, o mesmo cliente é atendido.
    estado.desafio_cru = None
    assert c.baixar(4, T, T + timedelta(seconds=2), tmp_path / "t.dav").tamanho == 5000


# ───────────────────────── um por vez ─────────────────────────


def test_um_pedido_por_vez_por_gravador_mesmo_com_dois_clientes(gravador, tmp_path: Path):
    estado, porta = gravador
    estado.pausa = 0.25
    saidas: list[object] = []

    def baixar(n: int) -> None:
        try:
            saidas.append(_cliente(porta).baixar(n, T, T + timedelta(seconds=2), tmp_path / f"t{n}.dav").tamanho)
        except Exception as e:  # noqa: BLE001 — o teste confere o que saiu
            saidas.append(e)

    linhas = [threading.Thread(target=baixar, args=(n,)) for n in (1, 2, 3)]
    for linha in linhas:
        linha.start()
    for linha in linhas:
        linha.join(timeout=20)
    assert saidas == [5000, 5000, 5000]
    assert estado.maximo_juntos == 1, "o gravador atendeu dois pedidos ao mesmo tempo"


def test_dois_gravadores_nao_esperam_um_pelo_outro(gravador, tmp_path: Path, monkeypatch):
    estado, porta = gravador
    # O "outro gravador" está com a vez tomada; este não tem nada com isso.
    outro = arquivo._porta_de("127.0.0.1", porta + 1)
    assert outro.vez.acquire(timeout=1)
    try:
        monkeypatch.setattr(arquivo, "ESPERA_DA_VEZ", 0.2)
        assert _cliente(porta).baixar(4, T, T + timedelta(seconds=2), tmp_path / "t.dav").tamanho == 5000
    finally:
        outro.vez.release()
    # E a mesma porta devolve a mesma vez.
    assert arquivo._porta_de("127.0.0.1", porta) is arquivo._porta_de("127.0.0.1", porta)
    assert arquivo._porta_de("127.0.0.1", porta) is not outro


def test_quem_espera_demais_pela_vez_desiste_sem_falar_com_o_gravador(gravador, tmp_path: Path, monkeypatch):
    estado, porta = gravador
    monkeypatch.setattr(arquivo, "ESPERA_DA_VEZ", 0.15)
    vez = arquivo._porta_de("127.0.0.1", porta).vez
    assert vez.acquire(timeout=1)
    try:
        with pytest.raises(GravadorOcupado, match="atendendo outro pedido"):
            _cliente(porta).baixar(4, T, T + timedelta(seconds=2), tmp_path / "t.dav")
    finally:
        vez.release()
    assert estado.pedidos == []
    # A vez foi devolvida por quem a tinha — e quem desistiu não a levou embora.
    assert _cliente(porta).baixar(4, T, T + timedelta(seconds=2), tmp_path / "t.dav").tamanho == 5000


def test_a_vez_e_devolvida_mesmo_quando_o_pedido_falha(gravador, tmp_path: Path, monkeypatch):
    estado, porta = gravador
    monkeypatch.setattr(arquivo, "ESPERA_DA_VEZ", 0.3)
    c = _cliente(porta)
    estado.status_do_trecho = 500
    with pytest.raises(ErroDoGravador):
        c.baixar(4, T, T + timedelta(seconds=2), tmp_path / "t.dav")
    estado.status_do_trecho = 200
    assert c.baixar(4, T, T + timedelta(seconds=2), tmp_path / "t.dav").tamanho == 5000


# ───────────────────────── ou inteiro, ou nada ─────────────────────────


def test_trecho_cortado_nao_fica_no_disco(gravador, tmp_path: Path):
    estado, porta = gravador
    estado.declarar = 9000      # diz 9000 e manda 5000
    destino = tmp_path / "t.dav"
    with pytest.raises(ErroDoGravador, match="veio cortado: 5000 de 9000 bytes"):
        _cliente(porta).baixar(4, T, T + timedelta(seconds=2), destino)
    assert not destino.exists()


def test_resposta_que_nao_e_http_e_dita_como_tal(gravador, tmp_path: Path):
    estado, porta = gravador
    estado.lixo = True
    destino = tmp_path / "t.dav"
    with pytest.raises(ErroDoGravador, match="respondeu fora do protocolo") as e:
        _cliente(porta).baixar(4, T, T + timedelta(seconds=2), destino)
    assert not isinstance(e.value, PedidoRecusado) and not destino.exists()


def test_o_teto_vale_pelo_tamanho_declarado_e_pelo_que_chega(gravador, tmp_path: Path):
    estado, porta = gravador
    destino = tmp_path / "t.dav"
    c = _cliente(porta)
    # Declarado acima do teto: recusa antes de criar o arquivo.
    with pytest.raises(ErroDoGravador, match="acima do teto de 4999"):
        c.baixar(4, T, T + timedelta(seconds=2), destino, teto=4999)
    assert not destino.exists()
    # No teto exato, passa.
    assert c.baixar(4, T, T + timedelta(seconds=2), destino, teto=5000).tamanho == 5000
    destino.unlink()
    # Sem tamanho declarado, o teto corta no meio — e o pedaço que já tinha sido gravado sai do disco.
    estado.declarar = None
    with pytest.raises(ErroDoGravador, match="passou do teto de 2500"):
        c.baixar(4, T, T + timedelta(seconds=2), destino, teto=2500)
    assert not destino.exists()
    # No teto exato passa; e, sem tamanho declarado, o tamanho do trecho é o que chegou.
    sem_declarar = c.baixar(4, T, T + timedelta(seconds=2), destino, teto=5000)
    assert (sem_declarar.declarado, sem_declarar.tamanho) == (None, 5000)


def test_trecho_que_nao_chega_no_prazo_e_abandonado(gravador, tmp_path: Path):
    estado, porta = gravador
    estado.gotejar = 0.15       # 5 pedaços de 1000 bytes, um a cada 150 ms
    destino = tmp_path / "t.dav"
    with pytest.raises(ErroDoGravador, match="não chegou inteiro em 0s"):
        _cliente(porta).baixar(4, T, T + timedelta(seconds=2), destino, limite_s=0.3)
    assert not destino.exists()


def test_resposta_vazia_e_sem_gravacao(gravador, tmp_path: Path):
    estado, porta = gravador
    estado.corpo = b""
    destino = tmp_path / "t.dav"
    with pytest.raises(SemGravacao, match="sem nenhum byte"):
        _cliente(porta).baixar(4, T, T + timedelta(seconds=2), destino)
    assert not destino.exists()


def test_pagina_de_erro_com_codigo_200_nao_e_trecho(gravador, tmp_path: Path):
    estado, porta = gravador
    estado.tipo = "Text/HTML; charset=utf-8"
    estado.corpo = b"<html>pagina do roteador</html>"
    destino = tmp_path / "t.dav"
    with pytest.raises(ErroDoGravador, match="respondeu 'text/html; charset=utf-8' no lugar do trecho"):
        _cliente(porta).baixar(4, T, T + timedelta(seconds=2), destino)
    assert not destino.exists()


def test_destino_que_nao_da_para_criar_e_dito_como_disco(gravador, tmp_path: Path):
    estado, porta = gravador
    with pytest.raises(ErroDoGravador, match="não consegui criar o arquivo do trecho") as e:
        _cliente(porta).baixar(4, T, T + timedelta(seconds=2), tmp_path / "pasta-que-nao-existe" / "t.dav")
    assert "alcancei" not in str(e.value)


def test_gravador_fora_do_ar_e_dito_sem_demora(tmp_path: Path):
    arquivo.esquecer_gravadores()
    with socket.socket() as s:      # uma porta que acabou de ser liberada: ninguém ouve nela
        s.bind(("127.0.0.1", 0))
        porta = s.getsockname()[1]
    comeco = time.monotonic()
    with pytest.raises(ErroDoGravador, match=f"não alcancei o gravador 127.0.0.1 na porta {porta}"):
        _cliente(porta).baixar(4, T, T + timedelta(seconds=2), tmp_path / "t.dav")
    assert time.monotonic() - comeco < arquivo.TEMPO_DE_CONEXAO + 3
    arquivo.esquecer_gravadores()


# ───────────────────────── o relógio ─────────────────────────


def test_o_relogio_diz_quanto_o_gravador_esta_adiantado(gravador):
    estado, porta = gravador
    estado.hora = "2026-10-09 19:51:24"
    tique = {"t": 100.0}
    # O pedido com credencial sai em 100,0 e a resposta é lida em 100,6: o instante da leitura é o meio, 100,3.
    def agora() -> float:
        tique["t"] += 0.3
        return tique["t"]

    c = _cliente(porta, agora=agora, hora_do_computador=lambda: datetime(2026, 10, 9, 19, 50, 57))
    diferenca = c.relogio()
    # O `agora` anda 0,3 a cada leitura; entre a saída do pedido e a leitura do corpo houve UMA leitura: meio = 0,15 s.
    assert diferenca == datetime(2026, 10, 9, 19, 51, 24) - (datetime(2026, 10, 9, 19, 50, 57) - timedelta(seconds=0.15))
    assert timedelta(seconds=27) < diferenca < timedelta(seconds=27.5)
    assert estado.com_credencial("/cgi-bin/global.cgi?action=getCurrentTime") == 1

    # Guardado por gravador: dentro do prazo, não pergunta de novo — nem por outro cliente.
    assert c.relogio() == diferenca
    assert _cliente(porta, agora=agora).relogio() == diferenca
    assert estado.com_credencial() == 1
    # Vencido o prazo, mede de novo.
    estado.hora = "2026-10-09 19:50:00"
    tique["t"] += 400
    nova = c.relogio()
    assert nova < timedelta(0) and estado.com_credencial() == 2
    # E `idade_maxima_s=0` mede sempre.
    c.relogio(idade_maxima_s=0)
    assert estado.com_credencial() == 3


@pytest.mark.parametrize(
    "resposta",
    [b"OK\r\n", b"result=ontem\r\n", b"result=2026-13-45 99:99:99\r\n", b"", b"hora=2026-10-09 19:51:24\r\n", b"result=2026-10-09 19:51:24x\r\n"],
)
def test_hora_fora_do_formato_e_erro_e_nao_vira_medida(gravador, resposta):
    estado, porta = gravador
    estado.resposta_da_hora = resposta
    c = _cliente(porta)
    with pytest.raises(ErroDoGravador, match="não disse a hora no formato esperado"):
        c.relogio()
    assert arquivo._porta_de("127.0.0.1", porta).relogio is None
    # A hora boa, em qualquer linha da resposta e com espaço em volta, é lida.
    estado.resposta_da_hora = b"outra=coisa\r\n result = 2026-10-09 19:51:24 \r\n"
    assert isinstance(c.relogio(), timedelta)


# ───────────────────────── o segredo ─────────────────────────


def test_nada_de_usuario_senha_nem_realm_em_erro_ou_registro(gravador, tmp_path: Path, caplog):
    estado, porta = gravador
    caplog.set_level(logging.DEBUG)
    ditos: list[str] = []

    def anotar(e: BaseException) -> None:
        ditos.extend([str(e), repr(e), str(getattr(e, "dica", "")), str(e.__cause__), str(e.__context__)])

    bom = _cliente(porta)
    bom.baixar(4, T, T + timedelta(seconds=2), tmp_path / "t.dav")
    bom.relogio()
    for status in (400, 404, 500):
        estado.status_do_trecho = status
        with pytest.raises(ErroDoGravador) as e:
            bom.baixar(4, T, T + timedelta(seconds=2), tmp_path / "t.dav")
        anotar(e.value)
    estado.status_do_trecho = 200
    estado.desafio_cru = 'Basic realm="' + REALM + '"'
    with pytest.raises(ErroDoGravador) as e:
        bom.baixar(4, T, T + timedelta(seconds=2), tmp_path / "t.dav")
    anotar(e.value)
    estado.desafio_cru = None
    ruim = _cliente(porta, senha="outra-senha-secreta-77")
    for _ in range(2):
        with pytest.raises(PedidoRecusado) as e:
            ruim.baixar(4, T, T + timedelta(seconds=2), tmp_path / "t.dav")
        anotar(e.value)

    tudo = "\n".join(ditos + [r.getMessage() for r in caplog.records])
    assert "recusou a credencial" in tudo, "a recusa tem de ficar no registro"
    # A senha, o "realm" (com o número de série) e qualquer pedaço do cabeçalho de autorização.
    for proibido in (SENHA, "outra-senha-secreta-77", REALM, "SERIE0014446184", "username=", "realm=", "nonce=", "response=", "Authorization"):
        assert proibido not in tudo, f"vazou: {proibido!r}"
    # O usuário do gravador também não aparece (a palavra "admin" só existe aqui como o usuário).
    assert USUARIO not in tudo
    # Nem a linha do pedido (que leva o canal e a hora).
    assert "startTime" not in tudo and "channel=" not in tudo
    # A impressão guardada da senha recusada não é a senha, e muda com o sal do processo.
    guardada = arquivo._porta_de("127.0.0.1", porta).recusada
    assert guardada is not None and "outra-senha" not in guardada and len(guardada) == 64
    assert guardada != hashlib.sha256(b"outra-senha-secreta-77").hexdigest()
