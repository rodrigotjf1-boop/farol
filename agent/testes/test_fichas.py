"""A base de fichas da loja: a cópia que o agente baixa e guarda.

A nuvem guarda a base de fichas de cada loja (o que ela vende e do que cada
produto é feito). A configuração leva só a MARCA da base — a impressão do
documento —, ou nulo quando a loja não tem base. O que se protege aqui:

- o agente baixa o documento quando a marca anunciada não é a da cópia dele,
  e não baixa quando é;
- a cópia é trocada de uma vez: resposta cortada, torta ou num formato que
  o agente não conhece nunca vira cópia, e a de antes continua valendo;
- só a configuração apaga: "a loja não tem base" tira a cópia do disco;
  nuvem fora do ar, ou configuração que não fala de fichas, não tira nada;
- nada disso derruba a auditoria.

O que atravessa a fronteira está em `contratos/fichas-da-loja.json`, lido
também por `api/testes/fichas-no-agente.test.ts`.
"""

from __future__ import annotations

import json
import threading
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

from farol_agent import fichas as modulo
from farol_agent import nuvem as cliente_da_nuvem
from farol_agent.auditoria import NOVA_BUSCA_DE_FICHAS, Auditoria
from farol_agent.configuracao import de_json
from farol_agent.fichas import FORMATO, Fichas, FichasRef, ref_da_configuracao
from farol_agent.nuvem import ClienteNuvem, ErroDaNuvem

from .test_auditoria import FonteBoa, NuvemDeTeste
from .test_configuracao import resposta

CONTRATO = json.loads((Path(__file__).resolve().parents[2] / "contratos" / "fichas-da-loja.json").read_text(encoding="utf-8"))
DA_NUVEM = CONTRATO["resposta"]
ANUNCIADA = CONTRATO["configuracao"]["comBase"]["fichas"]
REF = FichasRef(impressao=ANUNCIADA["impressao"], produtos=ANUNCIADA["produtos"], com_ficha=ANUNCIADA["comFicha"])

MEIO_DIA = datetime(2026, 10, 6, 12, 0, 0)


def outra(letra: str = "b", produtos: list | None = None) -> dict:
    """Outra base, com outra impressão — como a nuvem a entregaria."""
    return {"impressao": letra * 64, "base": {"formato": FORMATO, "produtos": DA_NUVEM["base"]["produtos"][:1] if produtos is None else produtos}}


def ref_de(resposta_da_nuvem: dict) -> FichasRef:
    return FichasRef(impressao=resposta_da_nuvem["impressao"], produtos=len(resposta_da_nuvem["base"]["produtos"]))


class Nuvem:
    """Quem entrega a base. Conta os pedidos e sabe falhar sob encomenda."""

    def __init__(self, entrega=DA_NUVEM):
        self.entrega = entrega
        self.pedidos = 0

    def __call__(self):
        self.pedidos += 1
        if isinstance(self.entrega, Exception):
            raise self.entrega
        return self.entrega


def em_disco(arquivo: Path) -> dict:
    return json.loads(arquivo.read_text(encoding="utf-8"))


# ───────────────────────────── o contrato ─────────────────────────────


def test_o_agente_declara_que_sabe_guardar_as_fichas_e_o_exemplo_e_uma_base_que_ele_entende():
    assert CONTRATO["sabe"] in cliente_da_nuvem.SABE
    assert DA_NUVEM["base"]["formato"] == FORMATO
    assert DA_NUVEM["impressao"] == ANUNCIADA["impressao"]
    assert (len(DA_NUVEM["base"]["produtos"]), sum(1 for p in DA_NUVEM["base"]["produtos"] if p["ficha"])) == (
        ANUNCIADA["produtos"], ANUNCIADA["comFicha"],
    )


def test_a_configuracao_diz_qual_base_a_loja_tem_ou_que_nao_tem_ou_nao_diz_nada():
    com = de_json({**resposta(), **CONTRATO["configuracao"]["comBase"]})
    assert (com.diz_das_fichas, com.fichas) == (True, REF)

    sem = de_json({**resposta(), **CONTRATO["configuracao"]["semBase"]})
    assert (sem.diz_das_fichas, sem.fichas) == (True, None), "nulo = a loja não tem base"

    # Baixada antes de isto existir: não disse nada — que é diferente de "não tem".
    antiga = de_json(resposta())
    assert (antiga.diz_das_fichas, antiga.fichas) == (False, None)


@pytest.mark.parametrize("torta", [
    "texto", 7, [], {}, {"impressao": None}, {"impressao": "abc"}, {"impressao": "G" * 64}, {"impressao": "A" * 64},
    {"impressao": "a" * 63}, {"impressao": "a" * 65}, {"impressao": ["a" * 64]}, {"produtos": 4, "comFicha": 1},
])
def test_entrada_torta_vale_como_nao_dita_nao_derruba_a_configuracao_nem_manda_apagar(torta, caplog):
    assert ref_da_configuracao(torta) is None
    with caplog.at_level("WARNING", logger="farol_agent.configuracao"):
        c = de_json({**resposta(), "fichas": torta})
    assert (c.diz_das_fichas, c.fichas) == (False, None)
    assert "base de fichas de um jeito que este agente não entende" in caplog.text
    assert len(c.pontos) == 1, "o resto da configuração vale"


@pytest.mark.parametrize("conta, esperado", [(4, 4), (0, 0), (-1, 0), (True, 0), ("4", 0), (None, 0), (2.5, 0)])
def test_a_conta_da_base_e_so_informacao_o_que_vem_torto_vira_zero(conta, esperado):
    r = ref_da_configuracao({"impressao": "a" * 64, "produtos": conta, "comFicha": conta})
    assert r == FichasRef(impressao="a" * 64, produtos=esperado, com_ficha=esperado)
    assert ref_da_configuracao({"impressao": "a" * 64}) == FichasRef(impressao="a" * 64)


class Resposta:
    def __init__(self, dados: bytes):
        self.dados = dados

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self):
        return self.dados


def test_o_agente_pede_a_base_no_endereco_do_contrato_com_o_token_dele(monkeypatch):
    pedidos = []

    def abrir(req, timeout=None):
        pedidos.append((req.get_method(), req.full_url, req.get_header("Accept"), req.get_header("Authorization"), req.data))
        return Resposta(json.dumps(DA_NUVEM).encode("utf-8"))

    monkeypatch.setattr("urllib.request.urlopen", abrir)
    assert ClienteNuvem("https://api.exemplo", "tok").baixar_fichas() == DA_NUVEM
    assert pedidos == [("GET", "https://api.exemplo" + CONTRATO["baixar"], "application/json", "Bearer tok", None)]


# ───────────────────────────── baixar e guardar ─────────────────────────────


def test_baixa_a_base_anunciada_guarda_e_entrega(tmp_path, caplog):
    nuvem = Nuvem()
    arquivo = tmp_path / "loja" / "fichas.json"
    f = Fichas(arquivo, baixar=nuvem)
    assert (f.base(), f.impressao_em_disco(), f.falta()) == (None, None, False), "sem nada anunciado, não há o que faltar"

    f.declarar(REF)
    assert f.falta() and nuvem.pedidos == 0, "declarar não baixa nada"

    with caplog.at_level("INFO", logger="farol_agent.fichas"):
        assert f.baixar_se_falta() is True
    assert "base de fichas em disco: 4 produto(s), 1 com ficha" in caplog.text
    assert (nuvem.pedidos, f.falta(), f.falha) == (1, False, None)
    assert f.impressao_em_disco() == REF.impressao
    assert f.base() == DA_NUVEM["base"], "o documento como a nuvem o entregou"

    guardado = em_disco(arquivo)
    assert list(guardado) == CONTRATO["guardado"]
    assert (guardado["impressao"], guardado["base"]) == (DA_NUVEM["impressao"], DA_NUVEM["base"])
    assert abs(datetime.fromisoformat(guardado["baixadaEm"]).timestamp() - datetime.now().timestamp()) < 60
    assert [a.name for a in arquivo.parent.iterdir()] == ["fichas.json"], "nenhum temporário sobra"

    # Com a cópia em dia, não pede mais nada.
    assert f.baixar_se_falta() is False and nuvem.pedidos == 1


def test_o_agente_que_reinicia_acha_a_copia_em_disco_e_nao_baixa_de_novo(tmp_path):
    arquivo = tmp_path / "fichas.json"
    primeiro = Fichas(arquivo, baixar=Nuvem())
    primeiro.declarar(REF)
    primeiro.baixar_se_falta()

    nuvem = Nuvem()
    depois = Fichas(arquivo, baixar=nuvem)
    assert depois.base() == DA_NUVEM["base"], "a cópia vale antes mesmo de a configuração chegar"
    depois.declarar(REF)
    assert depois.falta() is False
    assert depois.baixar_se_falta() is False and nuvem.pedidos == 0


def test_a_base_mudou_na_nuvem_a_copia_e_trocada(tmp_path):
    arquivo = tmp_path / "fichas.json"
    nuvem = Nuvem()
    f = Fichas(arquivo, baixar=nuvem)
    f.declarar(REF)
    f.baixar_se_falta()

    nova = outra("b")
    nuvem.entrega = nova
    f.declarar(ref_de(nova))
    assert f.falta(), "a marca anunciada já não é a da cópia"
    assert f.base() == DA_NUVEM["base"], "até descer, vale a cópia que há"

    assert f.baixar_se_falta() is True and nuvem.pedidos == 2
    assert (f.impressao_em_disco(), f.base()) == (nova["impressao"], nova["base"])
    assert f.falta() is False


def test_o_arquivo_nao_e_relido_enquanto_nao_muda(tmp_path, monkeypatch):
    arquivo = tmp_path / "fichas.json"
    f = Fichas(arquivo, baixar=Nuvem())
    f.declarar(REF)
    f.baixar_se_falta()

    lidas = []
    de_verdade = modulo.json.loads
    monkeypatch.setattr(modulo.json, "loads", lambda texto: (lidas.append(1), de_verdade(texto))[1])
    for _ in range(3):
        assert f.impressao_em_disco() == REF.impressao and f.falta() is False and f.base() is not None
    assert len(lidas) == 1, "lido uma vez depois de gravado; daí em diante, só se o arquivo mudar"

    # Mudou por fora (outro tamanho): é lido de novo.
    arquivo.write_text(json.dumps({"impressao": "c" * 64, "baixadaEm": "x", "base": outra()["base"]}), encoding="utf-8")
    assert f.impressao_em_disco() == "c" * 64 and len(lidas) == 2


# ───────────────────────────── só a configuração apaga ─────────────────────────────


def test_a_configuracao_diz_que_a_loja_nao_tem_base_a_copia_sai_do_disco(tmp_path, caplog):
    arquivo = tmp_path / "fichas.json"
    nuvem = Nuvem()
    f = Fichas(arquivo, baixar=nuvem)
    f.declarar(REF)
    f.baixar_se_falta()
    # Um temporário que uma queda de luz deixou para trás também é ficha da loja.
    (tmp_path / "fichas.json.tmp").write_text("{", encoding="utf-8")
    f.falha = "uma falha de antes"

    with caplog.at_level("INFO", logger="farol_agent.fichas"):
        f.declarar(None)
    assert list(tmp_path.iterdir()) == [], "a cópia e o temporário saem"
    assert caplog.text.count("a loja não tem mais base de fichas: a cópia saiu do disco") == 1
    assert (f.base(), f.impressao_em_disco(), f.falta(), f.falha) == (None, None, False, None)
    assert f.baixar_se_falta() is False and nuvem.pedidos == 1, "sem base anunciada, não pede nada"

    # De novo, sem nada em disco: não quebra e não repete o aviso.
    caplog.clear()
    with caplog.at_level("INFO", logger="farol_agent.fichas"):
        f.declarar(None)
    assert "saiu do disco" not in caplog.text

    # E a loja conectada de novo volta a ter base.
    f.declarar(REF)
    assert f.baixar_se_falta() is True and f.base() == DA_NUVEM["base"]


def test_arquivo_que_nao_sai_do_disco_nao_derruba_o_agente(tmp_path, monkeypatch, caplog):
    arquivo = tmp_path / "fichas.json"
    f = Fichas(arquivo, baixar=Nuvem())
    f.declarar(REF)
    f.baixar_se_falta()

    def recusar(self, *a, **k):
        raise PermissionError("em uso por outro programa")

    monkeypatch.setattr(Path, "unlink", recusar)
    # No nível do aviso de "apagou" (INFO): é ele que não pode sair.
    with caplog.at_level("INFO", logger="farol_agent.fichas"):
        f.declarar(None)
    assert "não apaguei fichas.json" in caplog.text
    assert "saiu do disco" not in caplog.text, "não diz que apagou o que não apagou"


# ───────────────────────────── o que falha no caminho ─────────────────────────────


def test_rede_fora_a_copia_de_antes_fica_e_a_base_e_pedida_de_novo_depois(tmp_path, caplog):
    arquivo = tmp_path / "fichas.json"
    nuvem = Nuvem()
    f = Fichas(arquivo, baixar=nuvem)
    f.declarar(REF)
    f.baixar_se_falta()

    nova = outra("b")
    f.declarar(ref_de(nova))
    nuvem.entrega = ErroDaNuvem("não cheguei na nuvem: sem internet")
    with caplog.at_level("WARNING", logger="farol_agent.fichas"):
        assert f.baixar_se_falta() is False
    assert "não baixei a base de fichas: não cheguei na nuvem: sem internet" in caplog.text
    assert f.falha == "não cheguei na nuvem: sem internet"
    assert f.base() == DA_NUVEM["base"] and f.falta(), "segue com a cópia que tem, e continua faltando"

    # A base apagada na nuvem entre a configuração e o pedido (404) também não apaga nada aqui.
    nuvem.entrega = ErroDaNuvem("404 em /v1/agentes/fichas — esta loja não tem base de fichas", recuperavel=False, status=404)
    assert f.baixar_se_falta() is False
    assert f.base() == DA_NUVEM["base"] and f.falta(), "só a configuração manda apagar"

    nuvem.entrega = nova
    assert f.baixar_se_falta() is True
    assert (nuvem.pedidos, f.falha, f.base()) == (4, None, nova["base"])


@pytest.mark.parametrize("torta", [
    None, "texto", [], {}, {"impressao": "b" * 64}, {"base": {"formato": FORMATO, "produtos": []}},
    {"impressao": "b" * 63, "base": {"formato": FORMATO, "produtos": []}},
    {"impressao": "B" * 64, "base": {"formato": FORMATO, "produtos": []}},
    {"impressao": 7, "base": {"formato": FORMATO, "produtos": []}},
    {"impressao": "b" * 64, "base": [{"formato": FORMATO, "produtos": []}]},
    {"impressao": "b" * 64, "base": {"formato": FORMATO}},
    {"impressao": "b" * 64, "base": {"formato": FORMATO, "produtos": {"a": 1}}},
])
def test_o_que_desce_torto_e_descartado_e_pedido_de_novo(tmp_path, torta):
    arquivo = tmp_path / "fichas.json"
    nuvem = Nuvem()
    f = Fichas(arquivo, baixar=nuvem)
    f.declarar(REF)
    f.baixar_se_falta()
    antes = arquivo.read_bytes()

    f.declarar(FichasRef(impressao="b" * 64))
    nuvem.entrega = torta
    assert f.baixar_se_falta() is False
    assert f.falha == "o que desceu não é a base de fichas"
    assert arquivo.read_bytes() == antes, "a cópia de antes não é tocada"
    assert f.falta(), "pode ter sido o caminho: vale pedir de novo"
    assert f.baixar_se_falta() is False and nuvem.pedidos == 3


@pytest.mark.parametrize("formato", [2, 0, "1", None, True])
def test_formato_que_o_agente_nao_conhece_nao_vira_copia_e_nao_e_pedido_todo_minuto(tmp_path, formato, caplog):
    arquivo = tmp_path / "fichas.json"
    nuvem = Nuvem()
    f = Fichas(arquivo, baixar=nuvem)
    f.declarar(REF)
    f.baixar_se_falta()
    antes = arquivo.read_bytes()

    de_amanha = {"impressao": "b" * 64, "base": {"formato": formato, "produtos": []}}
    nuvem.entrega = de_amanha
    f.declarar(ref_de(de_amanha))
    with caplog.at_level("WARNING", logger="farol_agent.fichas"):
        assert f.baixar_se_falta() is False
    assert f.falha == f"a base de fichas veio num formato que este agente não conhece ({formato!r})"
    assert "a base de fichas que desceu foi descartada" in caplog.text
    assert arquivo.read_bytes() == antes and f.base() == DA_NUVEM["base"]

    # Pedir de novo traria o mesmo documento: só volta a pedir quando a configuração anunciar outra base…
    assert f.falta() is False
    for _ in range(3):
        assert f.baixar_se_falta() is False
    assert nuvem.pedidos == 2
    f.declarar(ref_de(de_amanha))
    assert f.falta() is False, "a mesma base anunciada de novo não reabre o pedido"

    # …ou quando o agente for outro (o pacote novo sobe e pergunta uma vez).
    reiniciado = Fichas(arquivo, baixar=nuvem)
    reiniciado.declarar(ref_de(de_amanha))
    assert reiniciado.falta() and reiniciado.baixar_se_falta() is False and nuvem.pedidos == 3

    nova = outra("c")
    nuvem.entrega = nova
    f.declarar(ref_de(nova))
    assert f.falta() and f.baixar_se_falta() is True and f.falha is None
    assert f.base() == nova["base"]


def test_a_nuvem_entrega_a_base_de_agora_mesmo_que_a_configuracao_ainda_anuncie_a_de_antes(tmp_path):
    # A base mudou depois que a configuração desceu. A nuvem entrega a que tem.
    arquivo = tmp_path / "fichas.json"
    mais_nova = outra("b")
    nuvem = Nuvem(mais_nova)
    f = Fichas(arquivo, baixar=nuvem)
    f.declarar(REF)

    assert f.baixar_se_falta() is True
    assert (f.impressao_em_disco(), f.base(), f.falha) == (mais_nova["impressao"], mais_nova["base"], None), "a cópia nova fica"
    # Não é a anunciada — mas pedir de novo traria a mesma: espera a configuração dizer.
    assert f.falta() is False
    assert f.baixar_se_falta() is False and nuvem.pedidos == 1

    f.declarar(ref_de(mais_nova))
    assert f.falta() is False and f.baixar_se_falta() is False and nuvem.pedidos == 1, "a configuração confirmou: nada a baixar"

    # E se a configuração anunciar ainda outra, pede.
    terceira = outra("c")
    nuvem.entrega = terceira
    f.declarar(ref_de(terceira))
    assert f.baixar_se_falta() is True and f.impressao_em_disco() == terceira["impressao"]


@pytest.mark.parametrize("estrago", [
    b"", b"{", b"[]", b'"texto"', b"\xff\xfe\x00",
    json.dumps({"impressao": "a" * 64, "base": {"formato": 99, "produtos": []}}).encode(),
    json.dumps({"impressao": "curta", "base": {"formato": FORMATO, "produtos": []}}).encode(),
])
def test_copia_estragada_em_disco_e_tratada_como_ausente_e_baixada_de_novo(tmp_path, estrago):
    arquivo = tmp_path / "fichas.json"
    arquivo.write_bytes(estrago)
    nuvem = Nuvem()
    f = Fichas(arquivo, baixar=nuvem)
    assert (f.base(), f.impressao_em_disco()) == (None, None), "não entrega o que não consegue ler"

    f.declarar(REF)
    assert f.falta()
    assert f.baixar_se_falta() is True and f.base() == DA_NUVEM["base"]


def test_sem_quem_baixe_a_loja_fica_com_o_que_tem(tmp_path):
    arquivo = tmp_path / "fichas.json"
    Fichas(arquivo, baixar=Nuvem()).declarar(REF)
    f = Fichas(arquivo)
    f.declarar(REF)
    assert f.falta() and f.baixar_se_falta() is False and f.base() is None
    assert f.falha is None, "não ter quem baixe não é falha de ninguém"


def test_copia_que_sumiu_do_disco_e_baixada_de_novo(tmp_path):
    # Alguém apagou o arquivo à mão (ou o disco foi trocado): a configuração continua anunciando a base.
    arquivo = tmp_path / "fichas.json"
    nuvem = Nuvem()
    f = Fichas(arquivo, baixar=nuvem)
    f.declarar(REF)
    f.baixar_se_falta()
    assert f.base() is not None

    arquivo.unlink()
    assert (f.base(), f.falta()) == (None, True)
    assert f.baixar_se_falta() is True and nuvem.pedidos == 2
    assert f.base() == DA_NUVEM["base"]


def test_disco_que_nao_grava_nao_derruba_nada_e_a_copia_de_antes_fica(tmp_path, monkeypatch, caplog):
    arquivo = tmp_path / "fichas.json"
    nuvem = Nuvem()
    f = Fichas(arquivo, baixar=nuvem)
    f.declarar(REF)
    f.baixar_se_falta()

    nova = outra("b")
    nuvem.entrega = nova
    f.declarar(ref_de(nova))

    def recusar(*a, **k):
        raise OSError("disco cheio")

    monkeypatch.setattr(modulo.os, "replace", recusar)
    with caplog.at_level("WARNING", logger="farol_agent.fichas"):
        assert f.baixar_se_falta() is False
    assert f.falha == "não consegui gravar a base de fichas: disco cheio" and f.falha in caplog.text
    assert f.base() == DA_NUVEM["base"] and f.falta(), "segue com a de antes, e tenta de novo depois"
    assert [a.name for a in tmp_path.iterdir()] == ["fichas.json"], "o temporário que não virou cópia não fica para trás"

    monkeypatch.undo()
    assert f.baixar_se_falta() is True and f.base() == nova["base"]


def test_duas_voltas_ao_mesmo_tempo_baixam_uma_vez_so(tmp_path):
    # O laço da nuvem (que monta) e o da auditoria (que busca) rodam em linhas diferentes.
    arquivo = tmp_path / "fichas.json"
    dentro, soltar = threading.Event(), threading.Event()

    class NuvemLenta(Nuvem):
        def __call__(self):
            dentro.set()
            assert soltar.wait(5)
            return super().__call__()

    nuvem = NuvemLenta()
    f = Fichas(arquivo, baixar=nuvem)
    f.declarar(REF)
    resultados: list[bool] = []
    linhas = [threading.Thread(target=lambda: resultados.append(f.baixar_se_falta())) for _ in range(2)]
    linhas[0].start()
    assert dentro.wait(5)
    linhas[1].start()
    soltar.set()
    for l in linhas:
        l.join(5)
    assert sorted(resultados) == [False, True] and nuvem.pedidos == 1
    assert f.base() == DA_NUVEM["base"]


# ───────────────────────── com um servidor de verdade ─────────────────────────


class _Servidor:
    """Um servidor HTTP de verdade, que responde o que o teste mandar — inclusive cortado."""

    def __init__(self):
        self.status = 200
        self.corpo = json.dumps(DA_NUVEM).encode("utf-8")
        # Quantos bytes do corpo saem de fato. `None` = todos.
        self.sai = None
        self.pedidos: list[tuple[str, str | None, str | None]] = []
        dono = self

        class Tratador(BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802
                dono.pedidos.append((self.path, self.headers.get("authorization"), self.headers.get("user-agent")))
                self.send_response(dono.status)
                self.send_header("content-type", "application/json; charset=utf-8")
                self.send_header("content-length", str(len(dono.corpo)))
                self.end_headers()
                self.wfile.write(dono.corpo if dono.sai is None else dono.corpo[: dono.sai])
                self.wfile.flush()
                self.close_connection = True

            def log_message(self, *a):
                pass

        self._http = HTTPServer(("127.0.0.1", 0), Tratador)
        self.url = f"http://127.0.0.1:{self._http.server_address[1]}"
        self._linha = threading.Thread(target=self._http.serve_forever, daemon=True)
        self._linha.start()

    def fechar(self):
        self._http.shutdown()
        self._http.server_close()
        self._linha.join(5)


@pytest.fixture
def servidor():
    s = _Servidor()
    yield s
    s.fechar()


def test_pela_rede_de_verdade_a_base_desce_inteira_e_o_pedido_vai_como_o_contrato_diz(tmp_path, servidor):
    cliente = ClienteNuvem(servidor.url, "token-da-loja", versao="9.9")
    f = Fichas(tmp_path / "fichas.json", baixar=cliente.baixar_fichas)
    f.declarar(REF)

    assert f.baixar_se_falta() is True
    assert f.base() == DA_NUVEM["base"]
    assert servidor.pedidos == [(CONTRATO["baixar"], "Bearer token-da-loja", "farol-agent/9.9 (+https://monitorfarol.com.br)")]


@pytest.mark.parametrize("sai", [0, 1, 200, -1])
def test_resposta_cortada_no_caminho_nunca_vira_copia(tmp_path, servidor, sai):
    # O servidor anuncia o tamanho inteiro e a conexão cai antes: meio documento não é documento.
    arquivo = tmp_path / "fichas.json"
    cliente = ClienteNuvem(servidor.url, "tok")
    f = Fichas(arquivo, baixar=cliente.baixar_fichas)
    f.declarar(REF)
    f.baixar_se_falta()
    antes = arquivo.read_bytes()

    nova = outra("b")
    servidor.corpo = json.dumps(nova).encode("utf-8")
    servidor.sai = sai
    f.declarar(ref_de(nova))
    assert f.baixar_se_falta() is False
    assert f.falha, "o motivo fica dito"
    assert arquivo.read_bytes() == antes and f.base() == DA_NUVEM["base"]
    assert [a.name for a in tmp_path.iterdir()] == ["fichas.json"], "nem temporário pela metade"

    servidor.sai = None
    assert f.baixar_se_falta() is True and f.base() == nova["base"]


def test_a_nuvem_diz_que_a_loja_nao_tem_base_e_o_agente_nao_apaga_por_conta_propria(tmp_path, servidor):
    arquivo = tmp_path / "fichas.json"
    cliente = ClienteNuvem(servidor.url, "tok")
    f = Fichas(arquivo, baixar=cliente.baixar_fichas)
    f.declarar(REF)
    f.baixar_se_falta()

    sem = CONTRATO["semBaseNaNuvem"]
    servidor.status = sem["status"]
    servidor.corpo = json.dumps({"erro": sem["erro"], "mensagem": "esta loja não tem base de fichas"}).encode("utf-8")
    f.declarar(FichasRef(impressao="b" * 64))
    assert f.baixar_se_falta() is False
    assert f.falha == f"404 em {CONTRATO['baixar']} — esta loja não tem base de fichas"
    assert f.base() == DA_NUVEM["base"], "quem manda apagar é a configuração, que vem logo atrás"

    f.declarar(None)
    assert f.base() is None and not arquivo.exists()


# ───────────────────────────── na auditoria ─────────────────────────────


class NuvemComFichas(NuvemDeTeste):
    def __init__(self, entrega=DA_NUVEM):
        super().__init__()
        self.entrega = entrega
        self.pedidos_de_fichas = 0

    def baixar_fichas(self):
        self.pedidos_de_fichas += 1
        if isinstance(self.entrega, Exception):
            raise self.entrega
        return self.entrega


def configuracao(versao=1, **mais) -> dict:
    return {**resposta(versao=versao), **mais}


def auditoria(tmp_path, nuvem) -> Auditoria:
    return Auditoria(
        nuvem, str(tmp_path / "fila.db"),
        construir_fonte=lambda ponto: FonteBoa(ponto.id), construir_juiz=lambda cfg: None, medidor=None,
    )


def test_a_base_desce_na_montagem_fica_ao_lado_da_fila_e_sai_quando_a_loja_deixa_de_ter(tmp_path):
    nuvem = NuvemComFichas()
    a = auditoria(tmp_path, nuvem)
    a.montar(de_json(configuracao(1, **CONTRATO["configuracao"]["comBase"])))

    assert nuvem.pedidos_de_fichas == 1, "desce já, sem esperar o minuto"
    assert a.fichas.arquivo == tmp_path / "fichas.json"
    assert em_disco(tmp_path / "fichas.json")["base"] == DA_NUVEM["base"] == a.fichas.base()

    # A mesma configuração de novo: não remonta e não pede nada.
    a.montar(de_json(configuracao(1, **CONTRATO["configuracao"]["comBase"])))
    assert nuvem.pedidos_de_fichas == 1

    # A base mudou: a versão da configuração sobe e a marca é outra.
    nova = outra("b")
    nuvem.entrega = nova
    a.montar(de_json(configuracao(2, fichas={"impressao": nova["impressao"], "produtos": 1, "comFicha": 1})))
    assert nuvem.pedidos_de_fichas == 2 and a.fichas.base() == nova["base"]

    # A loja foi desconectada: a configuração diz que não há base, e a cópia sai.
    a.montar(de_json(configuracao(3, **CONTRATO["configuracao"]["semBase"])))
    assert not (tmp_path / "fichas.json").exists() and a.fichas.base() is None
    assert nuvem.pedidos_de_fichas == 2
    a.fila.fechar()


def test_configuracao_que_nao_fala_de_fichas_nao_apaga_a_copia_nem_baixa_nada(tmp_path):
    nuvem = NuvemComFichas()
    a = auditoria(tmp_path, nuvem)
    a.montar(de_json(configuracao(1, **CONTRATO["configuracao"]["comBase"])))

    # A mesma loja, com a configuração como um agente de antes a guardou (sem a entrada),
    # e outra com a entrada torta: "não sei" não é "não tem".
    a.montar(de_json(configuracao(2)))
    a.montar(de_json(configuracao(3, fichas={"impressao": "torta"})))
    assert a.fichas.base() == DA_NUVEM["base"] and (tmp_path / "fichas.json").is_file()
    assert nuvem.pedidos_de_fichas == 1
    a.fila.fechar()


def test_base_que_nao_desceu_e_pedida_de_novo_mas_nao_a_cada_volta(tmp_path):
    nuvem = NuvemComFichas(ErroDaNuvem("não cheguei na nuvem: sem internet"))
    a = auditoria(tmp_path, nuvem)
    a.montar(de_json(configuracao(1, **CONTRATO["configuracao"]["comBase"])))
    assert nuvem.pedidos_de_fichas == 1 and a.fichas.falha
    # A montagem marca a próxima tentativa pelo relógio da máquina; o teste
    # anda pelo dele: é como se a montagem tivesse sido um minuto antes.
    assert a._proxima_busca_de_fichas is not None
    a._proxima_busca_de_fichas = MEIO_DIA

    a.passo(MEIO_DIA)
    a.passo(MEIO_DIA + timedelta(seconds=30))
    assert nuvem.pedidos_de_fichas == 2, "tenta de novo, mas não a cada meio minuto"
    a.passo(MEIO_DIA + NOVA_BUSCA_DE_FICHAS - timedelta(seconds=1))
    assert nuvem.pedidos_de_fichas == 2
    a.passo(MEIO_DIA + NOVA_BUSCA_DE_FICHAS)
    assert nuvem.pedidos_de_fichas == 3, "no minuto exato, já é hora"

    nuvem.entrega = DA_NUVEM
    a.passo(MEIO_DIA + 2 * NOVA_BUSCA_DE_FICHAS + timedelta(seconds=1))
    assert nuvem.pedidos_de_fichas == 4 and a.fichas.base() == DA_NUVEM["base"] and a.fichas.falha is None

    a.passo(MEIO_DIA + 5 * NOVA_BUSCA_DE_FICHAS)
    assert nuvem.pedidos_de_fichas == 4, "com a cópia em dia, não pede mais nada"
    a.fila.fechar()


def test_o_minuto_de_espera_e_um_minuto():
    assert NOVA_BUSCA_DE_FICHAS == timedelta(seconds=60)


def test_cliente_sem_como_baixar_e_erro_inesperado_nao_derrubam_a_auditoria(tmp_path, caplog):
    # O cliente de teste que não sabe baixar fichas (ou um agente de bancada, sem nuvem).
    a = auditoria(tmp_path, NuvemDeTeste())
    a.montar(de_json(configuracao(1, **CONTRATO["configuracao"]["comBase"])))
    assert a.fichas.base() is None and a.motor is not None

    # E se a busca estourar de um jeito que ninguém previu, a volta segue.
    def estourar():
        raise RuntimeError("estouro que ninguém previu")

    a.fichas.baixar_se_falta = estourar
    a._proxima_busca_de_fichas = None
    with caplog.at_level("ERROR", logger="farol_agent.auditoria"):
        r = a.passo(MEIO_DIA + timedelta(days=1))
    assert "erro inesperado ao buscar a base de fichas; a auditoria segue" in caplog.text
    assert set(r) == {"enfileirados", "alertas", "subidos"}
    a.fila.fechar()
