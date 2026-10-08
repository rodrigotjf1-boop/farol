"""Erro do gravador não pode virar "senha recusada".

Medido na loja em 08/10/2026: depois de seis respostas de erro seguidas
(o gravador responde 400 para dizer "não há gravação nessa hora"), o
cliente passou a dizer "usuário ou senha recusados" para tudo — sem falar
com o gravador. A conta de tentativas do `urllib` só zera quando o pedido
repetido dá certo.

Aqui o gravador é um servidor de verdade, na própria máquina, que pede
senha do jeito da Dahua (digest) em todo pedido. O dublê de resposta não
serve: o defeito mora dentro do `urllib`, entre o desafio e a repetição.
"""

from __future__ import annotations

import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from farol_agent.dvr.dahua import ClienteDahua, ErroDoGravador


class _Gravador(BaseHTTPRequestHandler):
    """Pede senha em todo pedido; com ela, responde conforme o caminho."""

    pedidos: list[str] = []

    def do_GET(self) -> None:  # noqa: N802 — nome exigido pela biblioteca
        autorizacao = self.headers.get("Authorization", "")
        com_senha = autorizacao.startswith("Digest ") and 'username="admin"' in autorizacao
        if not com_senha or self.path == "/recusa":
            self.send_response(401)
            self.send_header("WWW-Authenticate", 'Digest realm="gravador", nonce="abc123", qop="auth"')
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        type(self).pedidos.append(self.path)
        corpo = b"result=ok\n" if self.path == "/bom" else b"Error\n"
        self.send_response(200 if self.path == "/bom" else 400)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    def log_message(self, *_: object) -> None:  # o teste não escreve no terminal
        return


@pytest.fixture
def gravador():
    _Gravador.pedidos = []
    servidor = ThreadingHTTPServer(("127.0.0.1", 0), _Gravador)
    linha = threading.Thread(target=servidor.serve_forever, daemon=True)
    linha.start()
    try:
        yield ClienteDahua("127.0.0.1", "admin", "segredo-de-teste", porta=servidor.server_address[1])
    finally:
        servidor.shutdown()
        servidor.server_close()
        linha.join(timeout=5)


def test_erro_do_gravador_nao_vira_senha_recusada(gravador: ClienteDahua):
    # Dez respostas de erro seguidas: todas têm de chegar como o erro que são.
    for _ in range(10):
        with pytest.raises(ErroDoGravador) as e:
            gravador._texto("/ruim")
        assert "HTTP 400" in str(e.value), str(e.value)
    # E o pedido bom, depois delas, é atendido PELO GRAVADOR.
    assert gravador._texto("/bom").strip() == "result=ok"
    assert _Gravador.pedidos == ["/ruim"] * 10 + ["/bom"]


def test_senha_recusada_de_verdade_continua_sendo_dita(gravador: ClienteDahua):
    with pytest.raises(ErroDoGravador) as e:
        gravador._texto("/recusa")
    assert "senha" in str(e.value)
    # A recusa de um pedido não contamina o seguinte.
    assert gravador._texto("/bom").strip() == "result=ok"
