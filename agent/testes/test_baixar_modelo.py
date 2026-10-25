"""O download do modelo na instalação, retomando de onde parou (ERR-151, 25/10/2026).

Na loja, o download de 372 MB do olho duplo caiu sem nada aproveitar ("The read operation timed out"), e a internet de
lá cai a cada poucos minutos. O que fica provado:

- a queda no meio não perde o que chegou: a tentativa seguinte pede só o que falta (`Range`) e emenda;
- o servidor que ignora o pedaço (200) manda tudo de novo, e o arquivo é regravado do começo;
- a resposta cortada no meio (`IncompleteRead`) também é queda;
- acabaram as tentativas: o que chegou fica, e a instalação seguinte continua dele;
- 404 não se tenta de novo; 416 com o arquivo todo é "já chegou tudo";
- o arquivo só entra com o sha256 conferido, nos três instaladores (detector, DINOv2, SigLIP2).
"""

from __future__ import annotations

import hashlib
import http.client
import io
import urllib.error
from pathlib import Path

import pytest

from farol_agent.juizes import baixar
from farol_agent.juizes import detector
from farol_agent.juizes import ingrediente as ji
from farol_agent.juizes import olho_extra as oe
from farol_agent.juizes.base import ErroDoJuiz

CONTEUDO = bytes(range(256)) * 40  # 10.240 bytes
SHA = hashlib.sha256(CONTEUDO).hexdigest()
URL = "https://exemplo.invalido/modelo.onnx"
ERRADO = "não é o modelo medido (sha256 {}…)"


class Resposta:
    """Uma resposta HTTP de mentira: manda `dados` em blocos e, se pedido, cai depois de `cai_em` bytes."""

    def __init__(self, dados: bytes, *, status: int = 200, cai_em: int | None = None, queda: Exception | None = None):
        self.status = status
        self._buf = io.BytesIO(dados)
        self._cai_em = cai_em
        self._queda = queda or ConnectionResetError(10054, "a conexão caiu")
        self._lidos = 0

    def read(self, n: int) -> bytes:
        if self._cai_em is not None and self._lidos >= self._cai_em:
            raise self._queda
        limite = n if self._cai_em is None else min(n, self._cai_em - self._lidos)
        b = self._buf.read(limite)
        self._lidos += len(b)
        return b

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class Servidor:
    """Atende `urlopen` com a lista de comportamentos, um por pedido; guarda o cabeçalho `Range` de cada um."""

    def __init__(self, *comportamentos):
        self.comportamentos = list(comportamentos)
        self.ranges: list[str | None] = []

    def __call__(self, req, timeout):
        rng = req.get_header("Range")
        self.ranges.append(rng)
        inicio = int(rng.split("=")[1].rstrip("-")) if rng else 0
        c = self.comportamentos.pop(0)
        if isinstance(c, Exception):
            raise c
        return c(inicio)


def pedaco(cai_em: int | None = None, *, ignora_range: bool = False, queda: Exception | None = None):
    def responder(inicio: int) -> Resposta:
        if ignora_range or inicio == 0:
            return Resposta(CONTEUDO, status=200, cai_em=cai_em, queda=queda)
        return Resposta(CONTEUDO[inicio:], status=206, cai_em=cai_em, queda=queda)

    return responder


def http_erro(codigo: int) -> urllib.error.HTTPError:
    return urllib.error.HTTPError(URL, codigo, "erro", {}, None)


@pytest.fixture
def esperas():
    return []


def test_a_queda_no_meio_continua_de_onde_parou(tmp_path: Path, monkeypatch, esperas):
    s = Servidor(pedaco(cai_em=4000), pedaco(cai_em=3000), pedaco())
    monkeypatch.setattr("urllib.request.urlopen", s)
    destino = baixar.baixar_conferido(URL, tmp_path / "m.onnx", SHA, errado=ERRADO, esperar=esperas.append)
    assert destino.read_bytes() == CONTEUDO
    assert s.ranges == [None, "bytes=4000-", "bytes=7000-"], "cada tentativa pede só o que falta"
    assert esperas == [5.0, 10.0], "espera um pouco mais a cada queda"
    assert not (tmp_path / "m.baixando").exists()


def test_o_servidor_que_ignora_o_pedaco_manda_tudo_e_o_arquivo_recomeca(tmp_path: Path, monkeypatch, esperas):
    s = Servidor(pedaco(cai_em=5000), pedaco(ignora_range=True))
    monkeypatch.setattr("urllib.request.urlopen", s)
    destino = baixar.baixar_conferido(URL, tmp_path / "m.onnx", SHA, errado=ERRADO, esperar=esperas.append)
    assert destino.read_bytes() == CONTEUDO, "200 depois de pedir o pedaço: regrava do começo, não emenda"


def test_a_resposta_cortada_e_o_tempo_esgotado_sao_queda(tmp_path: Path, monkeypatch, esperas):
    s = Servidor(pedaco(cai_em=2000, queda=http.client.IncompleteRead(b"")), TimeoutError("The read operation timed out"),
                 urllib.error.URLError(OSError(10060, "sem resposta")), http_erro(429), pedaco())
    monkeypatch.setattr("urllib.request.urlopen", s)
    destino = baixar.baixar_conferido(URL, tmp_path / "m.onnx", SHA, errado=ERRADO, esperar=esperas.append)
    assert destino.read_bytes() == CONTEUDO
    assert s.ranges[-1] == "bytes=2000-" and len(esperas) == 4


def test_acabaram_as_tentativas_o_que_chegou_fica_e_a_proxima_continua(tmp_path: Path, monkeypatch, esperas):
    monkeypatch.setattr("urllib.request.urlopen", Servidor(pedaco(cai_em=3000), pedaco(cai_em=1000)))
    with pytest.raises(ErroDoJuiz, match="2 tentativas") as e:
        baixar.baixar_conferido(URL, tmp_path / "m.onnx", SHA, errado=ERRADO, tentativas=2, esperar=esperas.append)
    assert e.value.recuperavel is True
    assert (tmp_path / "m.baixando").stat().st_size == 4000 and not (tmp_path / "m.onnx").exists()
    assert esperas == [5.0], "na última tentativa não espera à toa"

    s = Servidor(pedaco())
    monkeypatch.setattr("urllib.request.urlopen", s)
    assert baixar.baixar_conferido(URL, tmp_path / "m.onnx", SHA, errado=ERRADO, esperar=esperas.append).read_bytes() == CONTEUDO
    assert s.ranges == ["bytes=4000-"], "a instalação seguinte continua do que chegou"


def test_404_nao_se_tenta_de_novo_e_416_com_tudo_e_chegou(tmp_path: Path, monkeypatch, esperas):
    s = Servidor(http_erro(404))
    monkeypatch.setattr("urllib.request.urlopen", s)
    with pytest.raises(ErroDoJuiz, match="404") as e:
        baixar.baixar_conferido(URL, tmp_path / "m.onnx", SHA, errado=ERRADO, esperar=esperas.append)
    assert e.value.recuperavel is False and len(s.ranges) == 1 and esperas == []

    (tmp_path / "m.baixando").write_bytes(CONTEUDO)  # chegou tudo, mas a instalação parou antes de conferir
    monkeypatch.setattr("urllib.request.urlopen", Servidor(http_erro(416)))
    assert baixar.baixar_conferido(URL, tmp_path / "m.onnx", SHA, errado=ERRADO, esperar=esperas.append).read_bytes() == CONTEUDO


def test_o_que_nao_confere_nao_fica_nem_emendado(tmp_path: Path, monkeypatch, esperas):
    (tmp_path / "m.baixando").write_bytes(b"x" * 100)  # resto de OUTRO arquivo
    monkeypatch.setattr("urllib.request.urlopen", Servidor(pedaco()))
    with pytest.raises(ErroDoJuiz, match="não é o modelo medido") as e:
        baixar.baixar_conferido(URL, tmp_path / "m.onnx", SHA, errado=ERRADO, esperar=esperas.append)
    assert e.value.recuperavel is False
    assert list(tmp_path.iterdir()) == [], "o emendado errado é apagado: a próxima instalação começa do zero"


@pytest.mark.parametrize("instalar, nome, sha_attr", [
    (oe.instalar, oe.ARQUIVO, "SHA256"),
    (ji.instalar_modelo, ji.MODELO_ARQUIVO, "MODELO_SHA256"),
    (detector.instalar_modelo, detector.MODELO_ARQUIVO, "MODELO_SHA256"),
])
def test_os_tres_instaladores_retomam(tmp_path: Path, monkeypatch, instalar, nome, sha_attr):
    modulo = {oe.instalar: oe, ji.instalar_modelo: ji, detector.instalar_modelo: detector}[instalar]
    monkeypatch.setattr(modulo, sha_attr, SHA)
    monkeypatch.setattr(baixar.time, "sleep", lambda s: None)
    s = Servidor(pedaco(cai_em=6000), pedaco())
    monkeypatch.setattr("urllib.request.urlopen", s)
    destino = instalar(tmp_path)
    assert destino == tmp_path / nome and destino.read_bytes() == CONTEUDO
    assert s.ranges == [None, "bytes=6000-"]
    assert instalar(tmp_path) == destino and len(s.ranges) == 2, "já instalado e conferido: não baixa de novo"
