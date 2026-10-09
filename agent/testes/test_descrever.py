"""A análise única das fotos de um equipamento (o comando `descrever_item`).

O que se protege aqui:

- loja em modo local não manda nada, nem para isto — e nem baixa as fotos;
- a foto que desce é conferida pelo resumo antes de ir ao modelo;
- a foto de canal vai recortada pela área, com o entorno apagado e o aviso;
- a resposta do modelo é limpa e limitada; sem descrição, é erro com a frase
  do que faltou — não um cadastro vazio;
- o erro que vai para a tela do console não carrega o texto do provedor;
- o que desce e o que sobe têm a forma do contrato que a API também lê.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import cv2
import numpy as np
import pytest

from farol_agent import descrever, servico
from farol_agent.configuracao import de_json
from farol_agent.descrever import ErroAoDescrever
from farol_agent.juizes import nuvem as juiz_nuvem
from farol_agent.nuvem import ClienteNuvem, ErroDaNuvem
from farol_agent.pipeline import recorte

from .test_configuracao import resposta
from .test_foto_padrao import LIMPA, em_bytes

QUADRO = em_bytes(LIMPA)                                   # 1280 × 720
DE_PERTO = em_bytes(cv2.resize(LIMPA, (2000, 1500)))       # "foto de celular"
RETANGULO = [[0.1, 0.2], [0.6, 0.2], [0.6, 0.8], [0.1, 0.8]]
TRIANGULO = [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9]]


def _contrato() -> dict:
    caminho = Path(__file__).resolve().parents[2] / "contratos" / "descrever-equipamento.json"
    assert caminho.is_file(), f"contrato não encontrado em {caminho}"
    return json.loads(caminho.read_text(encoding="utf-8"))


def aberta(foto: descrever.FotoPronta) -> np.ndarray:
    import base64

    img = cv2.imdecode(np.frombuffer(base64.standard_b64decode(foto.b64), dtype=np.uint8), cv2.IMREAD_COLOR)
    assert img is not None
    return img


# ───────────────────────── o modelo de mentira ─────────────────────────


class Bloco:
    type = "tool_use"
    name = "descrever"

    def __init__(self, entrada: dict):
        self.input = entrada


class Uso:
    input_tokens = 7000
    output_tokens = 400
    cache_creation_input_tokens = 0
    cache_read_input_tokens = 0


class Resposta:
    stop_reason = "tool_use"

    def __init__(self, entrada: dict | None, uso=Uso):
        self.content = [Bloco(entrada)] if entrada is not None else []
        self.usage = uso() if uso else None


BOA = {
    "descricao": "Chapa elétrica de inox, com duas tampas.  Limpa: superfície clara,\nsem resíduo escuro.",
    "conferir": ["Tampas abaixadas quando a chapa não está em uso.", "Nada apoiado em cima"],
}


class Modelo:
    """Guarda o que foi pedido e responde o combinado."""

    def __init__(self, entrada: dict | None = BOA, erro: Exception | None = None):
        self.entrada = entrada
        self.erro = erro
        self.pedidos: list[dict] = []
        self.messages = self

    def create(self, **pedido):
        self.pedidos.append(pedido)
        if self.erro:
            raise self.erro
        return Resposta(self.entrada)


class Fotos:
    """As imagens que a nuvem entregaria, por id."""

    def __init__(self, **por_id: bytes):
        self.por_id = por_id
        self.pedidas: list[str] = []

    def baixar(self, foto_id: str) -> bytes:
        self.pedidas.append(foto_id)
        return self.por_id[foto_id]


def foto(foto_id: str, dados: bytes, origem="envio", area=None) -> dict:
    return {"id": foto_id, "origem": origem, "recorte": area, "sha256": hashlib.sha256(dados).hexdigest()}


def comando(*fotos: dict, nome="Chapa", tipo="chapa", setor="Cozinha") -> dict:
    return {"itemId": "i1", "nome": nome, "tipo": tipo, "setor": setor, "fotos": list(fotos)}


# ───────────────────────── preparar as fotos ─────────────────────────


def test_a_foto_do_canal_vai_recortada_pela_area():
    f = descrever.preparar_foto(QUADRO, "canal", RETANGULO)
    assert (f.origem, f.apagado) == ("canal", False), "área retangular não tem o que apagar"
    assert aberta(f).shape[:2] == (432, 640), "metade da largura e 60% da altura do quadro de 1280 × 720"


def test_area_desenhada_por_pontos_vai_com_o_de_fora_apagado():
    f = descrever.preparar_foto(QUADRO, "canal", TRIANGULO)
    img = aberta(f)
    assert f.apagado is True
    h, w = img.shape[:2]
    de_fora = img[int(h * 0.85):, int(w * 0.85):].astype(int)
    assert np.abs(de_fora - recorte.COR_DE_FORA[0]).max() <= 6, "o canto oposto ao do triângulo é cinza liso"
    assert img[: h // 4, : w // 4].std() > 10, "e dentro continua sendo a cena"


def test_a_foto_enviada_vai_inteira_e_reduzida():
    f = descrever.preparar_foto(DE_PERTO, "envio", None)
    assert (f.origem, f.apagado) == ("envio", False)
    assert aberta(f).shape[:2] == (750, 1000), "o lado maior desce a 1000"
    # o desenho de área não vale para foto enviada, mesmo que venha
    assert aberta(descrever.preparar_foto(QUADRO, "envio", RETANGULO)).shape[:2] == (562, 1000)


@pytest.mark.parametrize("torto", [None, [], [[0.1, 0.1], [0.5, 0.9]], [[0.1, 0.1], [1.4, 0.1], [0.1, 0.9]], [["a", 0], [1, 0], [0, 1]], "lixo"])
def test_desenho_torto_nao_recorta_e_nao_derruba(torto):
    assert aberta(descrever.preparar_foto(QUADRO, "canal", torto)).shape[:2] == (562, 1000), "vai o quadro inteiro"


def test_o_que_nao_abre_como_imagem_e_erro_com_frase():
    with pytest.raises(ErroAoDescrever, match="não abre como imagem"):
        descrever.preparar_foto(b"isto nao e imagem", "envio", None)


def test_so_a_foto_enviada_passa_pelo_borrao_de_rosto(monkeypatch):
    # A do canal já foi borrada na captura do quadro; a enviada não passou pelo agente.
    vistos = []
    monkeypatch.setattr(recorte, "borrar_rostos", lambda f: (vistos.append(f.imagem.shape[:2]), (f, False))[1])
    descrever.preparar_foto(QUADRO, "canal", RETANGULO)
    assert vistos == []
    descrever.preparar_foto(DE_PERTO, "envio", None)
    assert vistos == [(1500, 2000)], "antes de reduzir: rosto pequeno some do detector"


def test_baixa_na_ordem_confere_o_resumo_e_para_em_quatro():
    fotos = Fotos(a=QUADRO, b=DE_PERTO, c=QUADRO, d=DE_PERTO, e=QUADRO)
    prontas = descrever.baixar_fotos(
        comando(foto("a", QUADRO, "canal", RETANGULO), foto("b", DE_PERTO), foto("c", QUADRO), foto("d", DE_PERTO), foto("e", QUADRO)),
        fotos.baixar,
    )
    assert fotos.pedidas == ["a", "b", "c", "d"], "no máximo quatro, na ordem do cadastro"
    assert [p.origem for p in prontas] == ["canal", "envio", "envio", "envio"]


def test_foto_que_desce_diferente_do_resumo_nao_vai_ao_modelo():
    fotos = Fotos(a=QUADRO, b=DE_PERTO[:-50])
    with pytest.raises(ErroAoDescrever, match="a foto 2 desceu diferente"):
        descrever.baixar_fotos(comando(foto("a", QUADRO), foto("b", DE_PERTO)), fotos.baixar)


def test_sem_foto_nao_ha_o_que_descrever():
    for vazio in ({}, {"fotos": []}, {"fotos": ["lixo", {"origem": "envio"}]}):
        with pytest.raises(ErroAoDescrever, match="não tem foto"):
            descrever.baixar_fotos(vazio, Fotos().baixar)


# ───────────────────────── a pergunta ─────────────────────────


def test_a_pergunta_diz_o_que_e_e_rotula_cada_foto():
    prontas = [descrever.preparar_foto(QUADRO, "canal", TRIANGULO), descrever.preparar_foto(DE_PERTO, "envio", None)]
    conteudo = descrever.montar_pedido("  Geladeira da cozinha ", "geladeira", " Cozinha ", prontas)

    assert [b["type"] for b in conteudo] == ["text", "text", "image", "text", "image", "text"]
    assert conteudo[0]["text"] == "EQUIPAMENTO: Geladeira da cozinha\nTIPO: geladeira ou freezer\nSETOR: Cozinha\nFOTOS: 2"
    assert conteudo[1]["text"] == f"FOTO 1 — recorte da câmera do setor\n{juiz_nuvem.AVISO_DA_AREA}", "foto com entorno apagado leva o aviso"
    assert conteudo[3]["text"] == "FOTO 2 — foto tirada de perto"
    assert conteudo[2]["source"] == {"type": "base64", "media_type": "image/jpeg", "data": prontas[0].b64}
    assert conteudo[5]["text"] == "Descreva o equipamento e diga o que vale conferir nele."


def test_tipo_outro_e_sem_setor_nao_viram_linha():
    (cabecalho, *_resto) = descrever.montar_pedido("Coifa", "outro", "", [descrever.preparar_foto(QUADRO, "envio", None)])
    assert cabecalho["text"] == "EQUIPAMENTO: Coifa\nFOTOS: 1"


# ───────────────────────── a resposta ─────────────────────────


def test_a_resposta_sai_limpa():
    assert descrever.ler_resposta(Resposta(BOA)) == {
        "descricao": "Chapa elétrica de inox, com duas tampas. Limpa: superfície clara, sem resíduo escuro.",
        "conferir": ["Tampas abaixadas quando a chapa não está em uso", "Nada apoiado em cima"],
    }


def test_a_resposta_e_limitada():
    muito = {
        "descricao": "d" * 900,
        "conferir": ["Ponto repetido", "Ponto repetido.", "", "   ", *[f"Ponto {i}" for i in range(9)], "x" * 300],
    }
    lida = descrever.ler_resposta(Resposta(muito))
    assert len(lida["descricao"]) == 500 and lida["descricao"].endswith("…")
    assert lida["conferir"] == ["Ponto repetido", "Ponto 0", "Ponto 1", "Ponto 2", "Ponto 3"], "sem repetir, sem vazio, até cinco"
    assert descrever.ler_resposta(Resposta({"descricao": "ok", "conferir": ["x" * 300]}))["conferir"] == ["x" * 160]
    assert descrever.ler_resposta(Resposta({"descricao": "ok", "conferir": "não é lista"}))["conferir"] == []
    assert descrever.ler_resposta(Resposta({"descricao": "ok"}))["conferir"] == []


def test_sem_descricao_e_erro_com_o_que_faltou():
    with pytest.raises(ErroAoDescrever, match="não mostram o equipamento com clareza bastante para descrever: a chapa está coberta"):
        descrever.ler_resposta(Resposta({"descricao": "  ", "conferir": [], "nao_deu": "a chapa está coberta"}))
    with pytest.raises(ErroAoDescrever, match="Ponha uma foto mais de perto"):
        descrever.ler_resposta(Resposta({"descricao": "", "conferir": ["x"]}))
    with pytest.raises(ErroAoDescrever, match="não devolveu a descrição"):
        descrever.ler_resposta(Resposta(None))


def test_o_custo_e_a_conta_do_juiz_de_nuvem():
    # 7.000 de entrada a US$ 2 e 400 de saída a US$ 10 por milhão, com o dólar a 5,40
    assert descrever.custo_em_centavos(Uso(), juiz_nuvem.MODELO_FORTE, 5.40) == pytest.approx(9.72)
    assert descrever.custo_em_centavos(Uso(), "modelo-sem-preco", 5.40) is None, "sem preço na tabela não é de graça"
    assert descrever.custo_em_centavos(None, juiz_nuvem.MODELO_FORTE, 5.40) is None


# ───────────────────────── o comando inteiro ─────────────────────────


def test_descreve_e_devolve_o_que_a_nuvem_guarda(monkeypatch):
    monkeypatch.setenv("FAROL_DOLAR", "5.40")
    modelo, fotos = Modelo(), Fotos(a=QUADRO, b=DE_PERTO)

    saida = descrever.descrever_item(
        comando(foto("a", QUADRO, "canal", RETANGULO), foto("b", DE_PERTO)), baixar=fotos.baixar, cliente=modelo,
    )

    assert saida == {
        "descricao": "Chapa elétrica de inox, com duas tampas. Limpa: superfície clara, sem resíduo escuro.",
        "conferir": ["Tampas abaixadas quando a chapa não está em uso", "Nada apoiado em cima"],
        "modelo": juiz_nuvem.MODELO_FORTE,
        "custoCentavos": pytest.approx(9.72),
    }
    (pedido,) = modelo.pedidos
    assert pedido["model"] == juiz_nuvem.MODELO_FORTE, "é feito uma vez: vale o modelo que enxerga melhor"
    assert pedido["system"] == descrever.INSTRUCOES
    # O modelo forte RECUSA a escolha forçada da ferramenta (medido em 08/10/2026):
    # este teste conferia `{"type": "tool"}`, o pedido que a API de verdade recusa.
    assert pedido["tool_choice"] == {"type": "auto"} and pedido["tools"] == [descrever.FERRAMENTA]
    assert pedido["max_tokens"] == descrever.MAX_TOKENS_ESCOLHA_LIVRE
    assert [b["type"] for b in pedido["messages"][0]["content"]].count("image") == 2


def test_loja_em_modo_local_nao_baixa_nem_pergunta():
    modelo, fotos = Modelo(), Fotos(a=QUADRO)
    with pytest.raises(ErroAoDescrever, match="nenhuma imagem sai"):
        descrever.descrever_item(comando(foto("a", QUADRO)), baixar=fotos.baixar, modo_julgamento="local", cliente=modelo)
    assert fotos.pedidas == [] and modelo.pedidos == []


def test_sem_nome_nao_ha_o_que_perguntar():
    modelo, fotos = Modelo(), Fotos(a=QUADRO)
    with pytest.raises(ErroAoDescrever, match="sem o nome"):
        descrever.descrever_item(comando(foto("a", QUADRO), nome="  "), baixar=fotos.baixar, cliente=modelo)
    assert fotos.pedidas == [] and modelo.pedidos == []


def test_sem_a_chave_neste_computador_o_erro_ensina(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(ErroAoDescrever, match="não tem a chave da nuvem.+escrita à mão"):
        descrever.descrever_item(comando(foto("a", QUADRO)), baixar=Fotos(a=QUADRO).baixar)


def test_o_erro_do_provedor_nao_vai_para_a_tela():
    class AuthenticationError(Exception):
        pass

    modelo = Modelo(erro=AuthenticationError("invalid x-api-key: sk-ant-segredo"))
    with pytest.raises(ErroAoDescrever) as e:
        descrever.descrever_item(comando(foto("a", QUADRO)), baixar=Fotos(a=QUADRO).baixar, cliente=modelo)
    assert str(e.value) == "a nuvem não respondeu à análise das fotos (AuthenticationError). Tente de novo."
    assert "sk-ant" not in str(e.value)


def test_modelo_sem_preco_devolve_sem_custo(monkeypatch):
    saida = descrever.descrever_item(comando(foto("a", QUADRO)), baixar=Fotos(a=QUADRO).baixar, cliente=Modelo(), modelo="modelo-novo")
    assert saida["modelo"] == "modelo-novo" and "custoCentavos" not in saida


# ───────────────────────── o contrato com a nuvem ─────────────────────────


def test_o_agente_entende_o_comando_e_responde_como_no_contrato(monkeypatch):
    """A API confere o MESMO arquivo (api/testes/descricao.test.ts)."""
    monkeypatch.setenv("FAROL_DOLAR", "5.40")
    contrato = _contrato()
    parametros = json.loads(json.dumps(contrato["comando"]["parametros"]))
    # as imagens são as do teste: o resumo de cada foto do contrato é trocado pelo delas
    imagens = {f["id"]: (QUADRO if f["origem"] == "canal" else DE_PERTO) for f in parametros["fotos"]}
    for f in parametros["fotos"]:
        f["sha256"] = hashlib.sha256(imagens[f["id"]]).hexdigest()
    fotos = Fotos(**imagens)
    modelo = Modelo({"descricao": contrato["resposta"]["descricao"], "conferir": contrato["resposta"]["conferir"]})

    saida = descrever.descrever_item(parametros, baixar=fotos.baixar, cliente=modelo)

    assert fotos.pedidas == [f["id"] for f in contrato["comando"]["parametros"]["fotos"]]
    assert sorted(saida) == sorted(contrato["resposta"]), "as mesmas chaves que a API espera"
    assert saida == {**contrato["resposta"], "custoCentavos": pytest.approx(contrato["resposta"]["custoCentavos"])}
    assert modelo.pedidos[0]["messages"][0]["content"][0]["text"].startswith("EQUIPAMENTO: Chapa\nTIPO: chapa\nSETOR: Cozinha")
    assert sorted(contrato["comando"]["parametros"]) == ["fotos", "itemId", "nome", "setor", "tipo"], "campo novo: o agente tem de passar a ler"
    assert sorted(contrato["comando"]["parametros"]["fotos"][0]) == ["id", "origem", "recorte", "sha256"]


# ───────────────────────── o serviço ─────────────────────────


class Sincronizador:
    def __init__(self, modo="hibrido"):
        corpo = resposta()
        corpo["loja"]["modoJulgamento"] = modo
        self.config = de_json(corpo)


class ClienteDaNuvem:
    def __init__(self, **fotos: bytes):
        self.fotos = fotos
        self.erro: Exception | None = None

    def baixar_foto_do_inventario(self, foto_id: str) -> bytes:
        if self.erro:
            raise self.erro
        return self.fotos[foto_id]


def test_o_servico_atende_o_comando_com_o_cliente_e_o_modo_da_loja(monkeypatch):
    chamadas = []

    def falso(parametros, *, baixar, modo_julgamento):
        chamadas.append((parametros["nome"], modo_julgamento, baixar("a")))
        return {"descricao": "ok", "conferir": []}

    monkeypatch.setattr(descrever, "descrever_item", falso)
    cmd = {"id": "c1", "tipo": "descrever_item", "parametros": comando(foto("a", QUADRO))}

    assert servico.atender(cmd, Sincronizador("nuvem"), ClienteDaNuvem(a=QUADRO)) == {"descricao": "ok", "conferir": []}
    assert chamadas == [("Chapa", "nuvem", QUADRO)]


def test_o_que_nao_deu_vira_mensagem_para_o_console(monkeypatch):
    cmd = {"id": "c1", "tipo": "descrever_item", "parametros": comando(foto("a", QUADRO))}

    with pytest.raises(servico.ErroDoComando, match="nenhuma imagem sai"):
        servico.atender(cmd, Sincronizador("local"), ClienteDaNuvem(a=QUADRO))

    with pytest.raises(servico.ErroDoComando, match="não tem como baixar as fotos"):
        servico.atender(cmd, Sincronizador(), None)

    fora = ClienteDaNuvem(a=QUADRO)
    fora.erro = ErroDaNuvem("sem rede", recuperavel=True)
    with pytest.raises(servico.ErroDoComando, match="não consegui baixar as fotos do equipamento: sem rede"):
        servico.atender(cmd, Sincronizador(), fora)

    with pytest.raises(servico.ErroDoComando, match="desconhecido nesta versão"):
        servico.atender({"id": "c2", "tipo": "regar_as_plantas"}, Sincronizador(), fora)


def test_o_laco_entrega_o_cliente_a_quem_atende(monkeypatch):
    recebidos = []
    monkeypatch.setattr(servico, "atender", lambda cmd, sinc, cliente=None: recebidos.append(cliente) or {"descricao": "ok"})

    class Sinc:
        config = None

        def bater(self):
            return [{"id": "c1", "tipo": "descrever_item"}]

    class Cliente:
        def __init__(self):
            self.respostas = []

        def responder(self, comando_id, *, resultado=None, erro=None):
            self.respostas.append((comando_id, resultado, erro))

    cliente = Cliente()
    assert servico.passo(Sinc(), cliente) == 1
    assert recebidos == [cliente], "sem o cliente não há como baixar as fotos"
    assert cliente.respostas == [("c1", {"descricao": "ok"}, None)]


def test_o_agente_baixa_a_foto_do_inventario_em_bytes(monkeypatch):
    pedidos = []

    class Corpo:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return QUADRO

    def abrir(req, timeout=None):
        pedidos.append((req.get_method(), req.full_url, req.get_header("Accept"), req.get_header("Authorization")))
        return Corpo()

    monkeypatch.setattr("urllib.request.urlopen", abrir)
    assert ClienteNuvem("https://api.exemplo", "tok").baixar_foto_do_inventario("f1") == QUADRO
    assert pedidos == [("GET", "https://api.exemplo/v1/agentes/inventario/fotos/f1", "image/*", "Bearer tok")]
