"""A conexão que cai NO MEIO da resposta não é erro inesperado (ERR-114).

Medido na loja em 13/10/2026: duas vezes no mesmo dia o nosso servidor
fechou a conexão sem responder, e o agente registrou "erro inesperado no
laço", com a pilha inteira. O `urllib` só embrulha em `URLError` o que
acontece ao ENVIAR o pedido; o que acontece ao LER a resposta — a conexão
fechada sem resposta, a resposta cortada, a rede que solta — sobe cru. E
quem chama só conhece o erro traduzido.

Na batida do coração o estrago era uma pilha no registro. Na subida dos
avisos seria pior: a passada da auditoria estourava ANTES de marcar a
próxima, e o laço rodava sem espera, uma olhada atrás da outra, enquanto
a nuvem continuasse fechando a porta.

O mesmo buraco existia em todo lugar do agente que lê uma resposta pela
rede; cada um tem o caso dele aqui.
"""

from __future__ import annotations

import http.client
import io
import logging
import ssl
import urllib.error
from datetime import datetime, timedelta

import pytest

from farol_agent import servico
from farol_agent.configuracao import Sincronizador, salvar
from farol_agent.dvr import descoberta
from farol_agent.dvr.dahua import ClienteDahua, ErroDoGravador
from farol_agent.juizes.base import ErroDoJuiz
from farol_agent.juizes.local import JuizLocal
from farol_agent.nuvem import ClienteNuvem, ErroDaNuvem

from .test_auditoria import JuizDeTeste, NuvemDeTeste, montar
from .test_configuracao import resposta
from .test_dvr import RespostaFalsa

TOKEN = "segredo-do-agente-123"

# O que sobe cru de `urlopen` e de `read()` quando a conexão abre e cai.
CRUAS = [
    pytest.param(lambda: http.client.RemoteDisconnected("Remote end closed connection without response"), id="fechou sem responder"),
    pytest.param(lambda: ConnectionResetError(10054, "Foi forçado o cancelamento de uma conexão existente pelo host remoto"), id="a rede soltou"),
    pytest.param(lambda: ConnectionAbortedError(10053, "conexão anulada pelo programa da máquina"), id="conexão anulada"),
    pytest.param(lambda: http.client.IncompleteRead(b'{"comandos":', 120), id="resposta cortada"),
    pytest.param(lambda: http.client.BadStatusLine("\x16\x03\x01"), id="resposta que não é HTTP"),
    pytest.param(lambda: ssl.SSLError("EOF occurred in violation of protocol"), id="a cifra caiu"),
]


def caindo_com(cria):
    def cair(*a, **k):
        raise cria()

    return cair


class RespostaQueCaiNaLeitura:
    """A conexão abriu, o cabeçalho veio — e o corpo não."""

    def __init__(self, erro: BaseException) -> None:
        self.erro = erro
        self.headers = {"Content-Type": "multipart/x-mixed-replace; boundary=b"}

    def read(self, *a):
        raise self.erro

    def readline(self, *a):
        raise self.erro

    def close(self) -> None:
        pass

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


# ─────────────────────────── o cliente da nuvem ───────────────────────────


@pytest.mark.parametrize("cria", CRUAS)
def test_o_que_cai_ao_abrir_a_resposta_vira_erro_da_nuvem_que_vale_tentar_de_novo(monkeypatch, cria):
    monkeypatch.setattr("urllib.request.urlopen", caindo_com(cria))

    with pytest.raises(ErroDaNuvem) as capturado:
        ClienteNuvem("https://api.exemplo", TOKEN).heartbeat("1")

    assert capturado.value.recuperavel is True, "a rede que oscila passa: tem de valer tentar de novo"
    assert capturado.value.status == 0
    assert "caiu no meio da resposta" in str(capturado.value)
    assert TOKEN not in str(capturado.value)


@pytest.mark.parametrize("cria", CRUAS)
def test_o_que_cai_durante_a_leitura_do_corpo_tambem(monkeypatch, cria):
    monkeypatch.setattr("urllib.request.urlopen", lambda *a, **k: RespostaQueCaiNaLeitura(cria()))

    with pytest.raises(ErroDaNuvem) as capturado:
        ClienteNuvem("https://api.exemplo", TOKEN).baixar_padrao("f1")

    assert capturado.value.recuperavel is True
    assert "caiu no meio da resposta" in str(capturado.value)


def test_a_mensagem_nao_muda_de_uma_queda_para_a_outra(monkeypatch):
    """Quem chama registra a causa UMA vez enquanto ela for a mesma (ERR-014).

    Mensagem que leva um número que muda — quantos bytes faltaram — viraria
    uma linha de registro a cada volta, durante a queda inteira.
    """
    mensagens = set()
    for faltaram in (10, 2000, 31337):
        monkeypatch.setattr(
            "urllib.request.urlopen",
            lambda *a, _f=faltaram, **k: RespostaQueCaiNaLeitura(http.client.IncompleteRead(b"x", _f)),
        )
        with pytest.raises(ErroDaNuvem) as capturado:
            ClienteNuvem("https://api.exemplo", TOKEN).heartbeat("1")
        mensagens.add(str(capturado.value))

    assert len(mensagens) == 1, mensagens


def test_quem_ja_era_traduzido_continua_com_a_frase_dele(monkeypatch):
    """Os três ramos de antes são, todos, `OSError`: o ramo novo vem DEPOIS deles."""
    c = ClienteNuvem("https://api.exemplo", TOKEN)

    monkeypatch.setattr("urllib.request.urlopen", caindo_com(lambda: urllib.error.URLError(OSError(10054, "host remoto"))))
    with pytest.raises(ErroDaNuvem, match="não cheguei na nuvem"):
        c.heartbeat("1")

    monkeypatch.setattr("urllib.request.urlopen", caindo_com(lambda: TimeoutError("timed out")))
    with pytest.raises(ErroDaNuvem, match="não respondeu em 15s"):
        c.heartbeat("1")

    monkeypatch.setattr(
        "urllib.request.urlopen",
        caindo_com(lambda: urllib.error.HTTPError("https://api.exemplo/v1/agentes/heartbeat", 503, "fora", {}, io.BytesIO(b"{}"))),
    )
    with pytest.raises(ErroDaNuvem) as capturado:
        c.heartbeat("1")
    assert capturado.value.status == 503
    assert capturado.value.recuperavel is True

    monkeypatch.setattr(
        "urllib.request.urlopen",
        caindo_com(lambda: urllib.error.HTTPError("https://api.exemplo/v1/agentes/heartbeat", 401, "não", {}, io.BytesIO(b"{}"))),
    )
    with pytest.raises(ErroDaNuvem) as capturado:
        c.heartbeat("1")
    assert capturado.value.status == 401
    assert capturado.value.recuperavel is False, "token recusado não melhora repetindo"


def test_o_que_nao_e_rede_continua_sendo_defeito(monkeypatch):
    """O ramo novo não é um "pega tudo": endereço torto é defeito, e tem de aparecer como defeito."""
    monkeypatch.setattr("urllib.request.urlopen", caindo_com(lambda: ValueError("unknown url type: 'htp'")))

    with pytest.raises(ValueError):
        ClienteNuvem("https://api.exemplo", TOKEN).heartbeat("1")


# ───────────────── a batida do coração (o que a loja mostrou) ─────────────────


def test_a_batida_segue_com_a_configuracao_local_quando_a_nuvem_fecha_sem_responder(tmp_path, monkeypatch, caplog):
    destino = tmp_path / "c.json"
    salvar(destino, resposta(versao=4))
    monkeypatch.setattr("urllib.request.urlopen", caindo_com(CRUAS[0].values[0]))
    cliente = ClienteNuvem("https://api.exemplo", TOKEN)
    s = Sincronizador(cliente, destino)

    with caplog.at_level(logging.DEBUG):
        servico.laco(s, cliente, voltas=1)

    assert s.config is not None and s.config.versao == 4, "perdeu a configuração por causa da rede"
    assert "caiu no meio da resposta" in (s.ultimo_erro or ""), "tem que registrar o MOTIVO"
    inesperados = [r.getMessage() for r in caplog.records if "inesperado" in r.getMessage()]
    assert inesperados == [], "a nuvem fora do ar não é defeito do agente"
    avisos = [r for r in caplog.records if "heartbeat falhou" in r.getMessage()]
    assert len(avisos) == 1 and avisos[0].levelno == logging.WARNING
    assert not any(r.exc_info for r in caplog.records), "nada de pilha no registro por causa da rede"


# ──────────────── a auditoria: a passada que estoura e a seguinte ────────────────


def test_a_passada_que_estoura_nao_deixa_a_rotina_seguinte_para_ja(tmp_path):
    """Sem marcar a próxima, o laço rodava sem espera enquanto o defeito durasse.

    A passada marcava a rotina seguinte DEPOIS de terminar. Estourando no
    meio — na subida, por um erro que ninguém previu —, a marca ficava no
    passado: a espera do laço dava zero e a volta seguinte abria as câmeras
    de novo, na hora.
    """
    juiz = JuizDeTeste()
    a = montar(tmp_path, nuvem=NuvemDeTeste(erro=RuntimeError("defeito que ninguém previu")), juiz=juiz)
    agora = datetime(2026, 10, 6, 12, 0, 0)

    with pytest.raises(RuntimeError):
        a.volta(agora)

    assert juiz.chamadas == 1
    assert a._proxima_rotina == agora + timedelta(seconds=a.intervalo_captura)
    assert a._espera(agora) > 0, "o laço não pode rodar sem espera"
    assert a.fila.a_subir() == 1, "o aviso que não subiu continua guardado"

    # Um segundo depois ainda não é hora: a volta não olha de novo.
    a.volta(agora + timedelta(seconds=1))
    assert juiz.chamadas == 1, "a rotina saiu de novo antes da hora"

    # Na hora marcada, olha.
    with pytest.raises(RuntimeError):
        a.volta(agora + timedelta(seconds=a.intervalo_captura))
    assert a._proxima_rotina == agora + timedelta(seconds=2 * a.intervalo_captura)


def test_a_passada_que_da_certo_marca_a_seguinte_como_sempre(tmp_path):
    a = montar(tmp_path)
    agora = datetime(2026, 10, 6, 12, 0, 0)

    r = a.volta(agora)

    assert r["alertas"] == 1 and r["subidos"] == 1
    assert a._proxima_rotina == agora + timedelta(seconds=a.intervalo_captura)
    assert a._proximo_vigia == agora + timedelta(seconds=a.intervalo_rapido)


# ───────────────────────────── o juiz local ─────────────────────────────


@pytest.mark.parametrize("cria", CRUAS)
def test_o_servidor_local_que_cai_no_meio_e_falha_que_vale_tentar_de_novo(monkeypatch, cria):
    monkeypatch.setattr("urllib.request.urlopen", caindo_com(cria))
    juiz = JuizLocal(url="http://127.0.0.1:9/v1/chat/completions")

    with pytest.raises(ErroDoJuiz) as capturado:
        juiz._postar({"model": "x"})

    assert capturado.value.recuperavel is True
    assert "caiu no meio da resposta" in str(capturado.value)


def test_no_juiz_local_os_ramos_de_antes_continuam_com_a_frase_deles(monkeypatch):
    juiz = JuizLocal(url="http://127.0.0.1:9/v1/chat/completions")

    monkeypatch.setattr("urllib.request.urlopen", caindo_com(lambda: urllib.error.URLError(OSError("recusada"))))
    with pytest.raises(ErroDoJuiz, match="inacessível"):
        juiz._postar({"model": "x"})

    monkeypatch.setattr("urllib.request.urlopen", caindo_com(lambda: TimeoutError("timed out")))
    with pytest.raises(ErroDoJuiz, match="não respondeu em"):
        juiz._postar({"model": "x"})

    monkeypatch.setattr("urllib.request.urlopen", caindo_com(lambda: ValueError("pedido torto")))
    with pytest.raises(ValueError):
        juiz._postar({"model": "x"})


# ─────────────────────────── o gravador, pela CGI ───────────────────────────


class AbridorQueCai:
    handlers: list = []

    def __init__(self, cria) -> None:
        self.cria = cria

    def open(self, *a, **k):
        raise self.cria()


@pytest.mark.parametrize("cria", CRUAS)
def test_o_gravador_que_cai_ao_responder_vira_erro_do_gravador(cria):
    c = ClienteDahua("10.0.0.9", "admin", "s3nha")
    c._abridor = AbridorQueCai(cria)  # type: ignore[assignment]

    with pytest.raises(ErroDoGravador) as capturado:
        c._abrir("/cgi-bin/magicBox.cgi?action=getDeviceType")

    assert "caiu no meio da resposta" in str(capturado.value)
    assert "s3nha" not in str(capturado.value)
    assert "rede" in (capturado.value.dica or ""), "quem instala precisa saber onde olhar"


@pytest.mark.parametrize("cria", CRUAS)
def test_o_texto_do_gravador_que_vem_cortado_tambem(cria):
    c = ClienteDahua("10.0.0.9", "admin", "s3nha")
    c._abrir = lambda *a, **k: RespostaQueCaiNaLeitura(cria())  # type: ignore[method-assign]

    with pytest.raises(ErroDoGravador, match="caiu no meio da resposta"):
        c._texto("/cgi-bin/configManager.cgi?action=getConfig&name=ChannelTitle")


def test_o_texto_do_gravador_que_para_no_meio_diz_que_parou():
    """`TimeoutError` é `OSError`: tem ramo próprio, antes, com a frase dele."""
    c = ClienteDahua("10.0.0.9", "admin", "s3nha")
    c._abrir = lambda *a, **k: RespostaQueCaiNaLeitura(TimeoutError("timed out"))  # type: ignore[method-assign]

    with pytest.raises(ErroDoGravador, match="parou de responder no meio da resposta"):
        c._texto("/cgi-bin/magicBox.cgi?action=getDeviceType")


def test_o_texto_do_gravador_que_chega_inteiro_e_lido_como_sempre():
    class Inteira(RespostaQueCaiNaLeitura):
        def read(self, *a):
            return "table.ChannelTitle[0].Name=Caixa\r\n".encode()

    c = ClienteDahua("10.0.0.9", "admin", "s3nha")
    c._abrir = lambda *a, **k: Inteira(OSError("não usado"))  # type: ignore[method-assign]

    assert c._pares(c._texto("/x")) == {"table.ChannelTitle[0].Name": "Caixa"}


def test_no_gravador_os_ramos_de_antes_continuam_com_a_frase_deles():
    c = ClienteDahua("10.0.0.9", "admin", "s3nha")

    c._abridor = AbridorQueCai(lambda: urllib.error.URLError(OSError("sem rota")))  # type: ignore[assignment]
    with pytest.raises(ErroDoGravador, match="não alcancei"):
        c._abrir("/x")

    c._abridor = AbridorQueCai(lambda: TimeoutError("timed out"))  # type: ignore[assignment]
    with pytest.raises(ErroDoGravador, match="não respondeu em"):
        c._abrir("/x")

    c._abridor = AbridorQueCai(  # type: ignore[assignment]
        lambda: urllib.error.HTTPError("http://10.0.0.9/x", 401, "não", {}, io.BytesIO(b""))
    )
    with pytest.raises(ErroDoGravador, match="recusados pelo gravador"):
        c._abrir("/x")

    c._abridor = AbridorQueCai(lambda: ValueError("endereço torto"))  # type: ignore[assignment]
    with pytest.raises(ValueError):
        c._abrir("/x")


class TransmissaoQueSolta(RespostaFalsa):
    """Entrega o que tem e, em vez de fechar direito, solta a conexão."""

    def __init__(self, corpo: str, erro: BaseException) -> None:
        super().__init__(corpo)
        self.erro = erro

    def readline(self) -> bytes:
        linha = super().readline()
        if not linha:
            raise self.erro
        return linha


@pytest.mark.parametrize("cria", CRUAS)
def test_a_transmissao_de_eventos_que_solta_e_religada(monkeypatch, cria):
    """Quem ouve os eventos só religa quando o erro é o do gravador.

    Conexão solta no meio da leitura subia crua e matava o ouvinte: o
    primeiro aviso do turno chegava, e os seguintes, nunca.
    """
    monkeypatch.setattr("farol_agent.dvr.dahua.time.sleep", lambda s: None)
    corpo = "--b\n\nCode=VideoMotion;action=Start;index=0\n"
    c = ClienteDahua("10.0.0.9", "admin", "s3nha")
    c._abrir = lambda *a, **k: TransmissaoQueSolta(corpo, cria())  # type: ignore[method-assign]

    colhidos = []
    for e in c.eventos(reconectar=True):
        colhidos.append(e)
        if len(colhidos) == 3:
            break

    assert len(colhidos) == 3, "tem que continuar ouvindo depois de a conexão soltar"


def test_sem_religar_a_transmissao_que_solta_diz_que_soltou():
    corpo = "--b\n\nCode=VideoMotion;action=Start;index=0\n"
    c = ClienteDahua("10.0.0.9", "admin", "s3nha")
    c._abrir = lambda *a, **k: TransmissaoQueSolta(corpo, ConnectionResetError(10054, "soltou"))  # type: ignore[method-assign]

    with pytest.raises(ErroDoGravador, match="caiu no meio"):
        list(c.eventos(reconectar=False))


def test_a_transmissao_parada_continua_dizendo_que_parou():
    """`TimeoutError` também é `OSError`: o ramo dele vem antes e a frase é a dele."""
    c = ClienteDahua("10.0.0.9", "admin", "s3nha")
    c._abrir = lambda *a, **k: TransmissaoQueSolta("", TimeoutError("timed out"))  # type: ignore[method-assign]

    with pytest.raises(ErroDoGravador, match="sem nem heartbeat"):
        list(c.eventos(reconectar=False))


# ───────────────────────── a procura do gravador na rede ─────────────────────────


@pytest.mark.parametrize("cria", CRUAS)
def test_aparelho_que_responde_lixo_na_porta_nao_derruba_a_procura(monkeypatch, cria):
    """Na varredura da rede há de tudo atrás de uma porta aberta: impressora, relógio de ponto, outro serviço."""
    monkeypatch.setattr("urllib.request.urlopen", caindo_com(cria))

    assert descoberta._realm("10.0.0.50", 80, 0.2) is None


def test_na_procura_o_401_continua_dizendo_quem_e(monkeypatch):
    cabecalho = {"WWW-Authenticate": 'Digest realm="Login to 0A1B2C3D", nonce="x"'}
    monkeypatch.setattr(
        "urllib.request.urlopen",
        caindo_com(lambda: urllib.error.HTTPError("http://10.0.0.50/x", 401, "não", cabecalho, io.BytesIO(b""))),
    )

    assert descoberta._realm("10.0.0.50", 80, 0.2) == "Login to 0A1B2C3D"
