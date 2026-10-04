"""O caminho de que todo o gatilho depende.

A inteligência de vídeo da MHDX roda em UM canal só, e os dezesseis
precisam de gatilho — então o desenho inteiro do Farol depende de o
`eventManager` conseguir avisar que houve movimento. Se a leitura dessa
transmissão estiver errada, o agente perde evento em silêncio, que é o
pior modo de falha possível: o painel fica calmo e a cozinha, não.

Aqui a transmissão é dublada byte a byte, no formato que o gravador
manda, para a leitura ser conferida sem depender de ter um DVR à mão.
"""

from __future__ import annotations

import pytest

from farol_agent.dvr.dahua import ClienteDahua, Evento, _json_completo, _montar


class RespostaFalsa:
    """Finge o `multipart/x-mixed-replace` do gravador, linha a linha."""

    def __init__(self, corpo: str) -> None:
        self._linhas = [(l + "\r\n").encode() for l in corpo.split("\n")]
        self._i = 0

    def readline(self) -> bytes:
        if self._i >= len(self._linhas):
            return b""
        linha = self._linhas[self._i]
        self._i += 1
        return linha

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


def cliente_com(corpo: str) -> ClienteDahua:
    c = ClienteDahua("10.0.0.9", "admin", "s3nha")
    c._abrir = lambda *a, **k: RespostaFalsa(corpo)  # type: ignore[method-assign]
    return c


# ──────────────────────── montagem do evento ────────────────────────


def test_evento_simples_sem_dados():
    e = _montar(["Code=VideoMotion;action=Start;index=0\r\n"])
    assert e is not None
    assert e.codigo == "VideoMotion"
    assert e.acao == "Start"
    assert e.indice == 0


def test_canal_e_base_1_como_na_tela_do_gravador():
    """`index` vem em base 0; ninguém na loja chama o primeiro de 'canal 0'."""
    assert Evento(codigo="X", acao="Start", indice=0).canal == 1
    assert Evento(codigo="X", acao="Start", indice=10).canal == 11


def test_evento_com_json_em_varias_linhas():
    linhas = [
        'Code=SmartMotionHuman;action=Start;index=3;data={\r\n',
        '   "Id" : 0,\r\n',
        '   "RegionName" : [ "Region1" ]\r\n',
        '}\r\n',
    ]
    e = _montar(linhas)
    assert e is not None
    assert e.codigo == "SmartMotionHuman"
    assert e.canal == 4
    assert e.dados["RegionName"] == ["Region1"]


def test_json_quebrado_nao_perde_o_evento():
    """Código e canal é o que o gatilho usa; o resto é enfeite."""
    e = _montar(["Code=VideoLoss;action=Start;index=2;data={isto nao e json\r\n"])
    assert e is not None
    assert e.codigo == "VideoLoss"
    assert e.canal == 3
    assert e.dados == {}


def test_heartbeat_nao_vira_evento():
    assert _montar(["Heartbeat\r\n"]) is None
    assert _montar(["\r\n"]) is None
    assert _montar([]) is None


def test_cabecalho_sozinho_nao_vira_evento():
    assert _montar(["Content-Type: text/plain\r\n", "Content-Length:36\r\n"]) is None


# ───────────────────── quando a parte está completa ─────────────────


def test_sem_data_a_linha_do_code_basta():
    assert _json_completo("Code=VideoMotion;action=Start;index=0")


def test_com_data_espera_as_chaves_fecharem():
    assert not _json_completo('Code=X;action=Start;index=0;data={')
    assert not _json_completo('Code=X;action=Start;index=0;data={\n "a":1,')
    assert _json_completo('Code=X;action=Start;index=0;data={\n "a":1\n}')


# ────────────────────────── a transmissão ──────────────────────────


def test_le_varios_eventos_separados_por_fronteira():
    corpo = (
        "--myboundary\n"
        "Content-Type: text/plain\n"
        "Content-Length:36\n"
        "\n"
        "Code=VideoLoss;action=Start;index=0\n"
        "--myboundary\n"
        "Content-Type: text/plain\n"
        "\n"
        "Code=VideoLoss;action=Start;index=1\n"
        "--myboundary\n"
    )
    eventos = list(cliente_com(corpo).eventos())

    assert [e.canal for e in eventos] == [1, 2]
    assert all(e.codigo == "VideoLoss" for e in eventos)


def test_heartbeat_entre_eventos_nao_atrapalha():
    """Sem câmera, o gravador manda muito heartbeat e pouco evento."""
    corpo = (
        "--myboundary\n"
        "\n"
        "Heartbeat\n"
        "--myboundary\n"
        "\n"
        "Heartbeat\n"
        "--myboundary\n"
        "\n"
        "Code=VideoMotion;action=Start;index=7\n"
        "--myboundary\n"
    )
    eventos = list(cliente_com(corpo).eventos())

    assert len(eventos) == 1
    assert eventos[0].canal == 8


def test_evento_sai_antes_da_proxima_fronteira():
    """Regra urgente tem dois segundos: não dá para segurar o evento
    esperando o próximo chegar para fechar a parte."""
    corpo = (
        "--myboundary\n"
        "\n"
        "Code=VideoMotion;action=Start;index=0\n"
    )
    eventos = list(cliente_com(corpo).eventos())
    assert len(eventos) == 1, "o evento tem que sair sem a fronteira seguinte"


def test_stop_e_start_sao_eventos_distintos():
    corpo = (
        "--b\n\nCode=VideoMotion;action=Start;index=0\n"
        "--b\n\nCode=VideoMotion;action=Stop;index=0\n--b\n"
    )
    eventos = list(cliente_com(corpo).eventos())
    assert [e.acao for e in eventos] == ["Start", "Stop"]


def test_transmissao_vazia_termina_sem_estourar():
    assert list(cliente_com("").eventos()) == []


# ──────────────────────────── URL RTSP ─────────────────────────────


def test_url_rtsp_usa_main_stream_por_padrao():
    """O protótipo puxava o sub sem saber: 352×240 não julga nada."""
    c = ClienteDahua("10.0.0.9", "admin", "s3nha")
    assert c.url_rtsp(11).endswith("/cam/realmonitor?channel=11&subtype=0")


def test_url_rtsp_sub_quando_pedido():
    c = ClienteDahua("10.0.0.9", "admin", "s3nha")
    assert c.url_rtsp(1, sub=True).endswith("subtype=1")


def test_senha_com_caractere_especial_e_escapada():
    """Senha com @ ou / quebraria a URL e o login falharia sem explicação."""
    c = ClienteDahua("10.0.0.9", "admin", "a@b/c:d")
    url = c.url_rtsp(1)
    assert "a%40b%2Fc%3Ad" in url
    assert url.count("@") == 1, "o único @ é o separador de credencial"


def test_url_para_log_nao_traz_a_senha():
    c = ClienteDahua("10.0.0.9", "admin", "s3nhaSecreta")
    assert "s3nhaSecreta" not in c.url_rtsp_sem_segredo(1)
    assert "***" in c.url_rtsp_sem_segredo(1)


def test_canal_zero_e_recusado():
    c = ClienteDahua("10.0.0.9", "admin", "x")
    with pytest.raises(ValueError, match="canal"):
        c.url_rtsp(0)
