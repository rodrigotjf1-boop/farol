"""A chamada ao modelo de nuvem, do jeito que ela sai — e a reconsulta.

Medido na loja em 08/10/2026: o Sonnet 5.5 recusa a escolha forçada da
ferramenta (`tool_choice: type "tool" and "any" are not supported for this
model`), e era assim que o agente o chamava. A reconsulta do juiz falhava
SEMPRE — levando junto o veredito que o modelo barato já tinha dado — e a
descrição de equipamento também.

Os testes que existiam não viam: ou trocavam o `_chamar` por um dublê, ou o
dublê do cliente aceitava qualquer pedido. Aqui o dublê é o CLIENTE e ele
se comporta como a API se comportou na medição: recusa, com a mesma frase, a
escolha forçada para o modelo que a recusa.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from farol_agent import descrever, ensaio
from farol_agent.juizes import nuvem
from farol_agent.juizes.base import ErroDoJuiz
from farol_agent.modelos import Resultado

RECUSA_DA_ESCOLHA = 'tool_choice: type "tool" and "any" are not supported for this model.'

# O que a medição mostrou, modelo a modelo. Modelo novo entra aqui DEPOIS de
# medido — a lista do código (`SEM_ESCOLHA_FORCADA`) tem de dizer o mesmo.
RECUSAM_NA_API = {"claude-sonnet-5-5"}


class Recusa(Exception):
    """O 400 da API (na biblioteca: `BadRequestError`, com `status_code` 400)."""

    status_code = 400


class SemPermissao(Exception):
    status_code = 403


@pytest.fixture(autouse=True)
def _sem_memoria_de_recusa():
    nuvem._recusaram_a_escolha.clear()
    yield
    nuvem._recusaram_a_escolha.clear()


def _resposta(resultado: str = "conforme", confianca: float = 0.9):
    bloco = SimpleNamespace(
        type="tool_use", name="responder",
        input={"resultado": resultado, "confianca": confianca, "motivo": "visto"},
    )
    return SimpleNamespace(content=[bloco], usage=SimpleNamespace(input_tokens=100, output_tokens=20))


class ApiComoMedida:
    """Cliente de mentira que recusa o que a API de verdade recusou."""

    def __init__(self, responder=None, recusam=RECUSAM_NA_API):
        self.pedidos: list[dict] = []
        self.messages = self
        self._responder = responder or (lambda pedido: _resposta())
        self._recusam = set(recusam)

    def create(self, **pedido):
        self.pedidos.append(pedido)
        if pedido["model"] in self._recusam and pedido["tool_choice"]["type"] in ("tool", "any"):
            raise Recusa(RECUSA_DA_ESCOLHA)
        return self._responder(pedido)


def _juiz(cliente, *, forte: str | None = nuvem.MODELO_FORTE) -> nuvem.JuizNuvem:
    """O juiz sem a biblioteca de verdade: só o cliente é de mentira."""
    j = nuvem.JuizNuvem.__new__(nuvem.JuizNuvem)
    j._anthropic = SimpleNamespace(
        BadRequestError=Recusa, AuthenticationError=SemPermissao,
        PermissionDeniedError=SemPermissao, NotFoundError=SemPermissao,
    )
    j._cliente = cliente
    j.modelo = nuvem.MODELO_BARATO
    j.modelo_forte = forte
    j.escalar_abaixo_de = 0.75
    j.dolar = 5.40
    return j


# ───────────────────────── a forma do pedido ─────────────────────────


def test_o_modelo_barato_vai_com_a_ferramenta_forcada():
    api = ApiComoMedida()
    v = _juiz(api)._chamar(nuvem.MODELO_BARATO, "ZmFsc28=", "image/jpeg", "CRITÉRIO")
    assert v.resultado is Resultado.CONFORME
    (pedido,) = api.pedidos
    assert pedido["tool_choice"] == {"type": "tool", "name": "responder"}
    assert pedido["max_tokens"] == nuvem.MAX_TOKENS


def test_o_modelo_forte_vai_com_a_escolha_livre_e_na_primeira():
    # Sem pagar a recusa antes: o pedido já sai do jeito que a API aceita.
    api = ApiComoMedida()
    v = _juiz(api)._chamar(nuvem.MODELO_FORTE, "ZmFsc28=", "image/jpeg", "CRITÉRIO")
    assert v.resultado is Resultado.CONFORME
    (pedido,) = api.pedidos
    assert pedido["tool_choice"] == {"type": "auto"}
    assert pedido["max_tokens"] == nuvem.MAX_TOKENS_ESCOLHA_LIVRE


def test_todo_modelo_que_o_agente_chama_sai_do_jeito_que_a_api_aceita():
    # Os lugares em que um modelo é escolhido: a cascata do juiz, a descrição
    # de equipamento e os nomes curtos da linha de comando.
    chamados = {nuvem.MODELO_BARATO, nuvem.MODELO_FORTE, descrever.MODELO, *ensaio.MODELOS.values()}
    for modelo in sorted(chamados):
        api = ApiComoMedida()
        _juiz(api)._chamar(modelo, "ZmFsc28=", "image/jpeg", "CRITÉRIO")
        assert len(api.pedidos) == 1, f"{modelo}: o primeiro pedido foi recusado"
    assert RECUSAM_NA_API <= nuvem.SEM_ESCOLHA_FORCADA, "modelo medido que recusa tem de estar na lista do código"


def test_modelo_novo_que_recusa_e_chamado_de_novo_e_fica_lembrado():
    api = ApiComoMedida(recusam={"modelo-de-amanha"})
    j = _juiz(api)
    v = j._chamar("modelo-de-amanha", "ZmFsc28=", "image/jpeg", "CRITÉRIO")
    assert v.resultado is Resultado.CONFORME
    assert [p["tool_choice"]["type"] for p in api.pedidos] == ["tool", "auto"], "uma recusa, e depois a escolha livre"
    assert api.pedidos[1]["max_tokens"] == nuvem.MAX_TOKENS_ESCOLHA_LIVRE

    # Na análise seguinte ele já sai livre: a recusa não se repete.
    j._chamar("modelo-de-amanha", "ZmFsc28=", "image/jpeg", "CRITÉRIO")
    assert [p["tool_choice"]["type"] for p in api.pedidos] == ["tool", "auto", "auto"]


def test_outro_erro_400_nao_vira_escolha_livre():
    def falhar(pedido):
        raise Recusa("image exceeds the maximum size")

    api = ApiComoMedida(responder=falhar)
    with pytest.raises(ErroDoJuiz) as e:
        _juiz(api)._chamar(nuvem.MODELO_BARATO, "ZmFsc28=", "image/jpeg", "CRITÉRIO")
    assert e.value.recuperavel is False
    assert [p["tool_choice"]["type"] for p in api.pedidos] == ["tool"], "não era recusa da escolha: não se tenta de novo"
    assert not nuvem.vai_com_escolha_livre(nuvem.MODELO_BARATO)


def test_resposta_sem_a_ferramenta_e_erro_e_nao_veredito():
    # Com a escolha livre o modelo PODE responder em texto, ou ser cortado
    # antes da ferramenta. Isso não é veredito: é erro.
    def em_texto(pedido):
        return SimpleNamespace(
            content=[SimpleNamespace(type="text", text="Parece em ordem.")],
            stop_reason="end_turn", usage=SimpleNamespace(input_tokens=100, output_tokens=20),
        )

    with pytest.raises(ErroDoJuiz, match="sem o bloco `responder`"):
        _juiz(ApiComoMedida(responder=em_texto))._chamar(nuvem.MODELO_FORTE, "ZmFsc28=", "image/jpeg", "CRITÉRIO")


def test_ferramenta_sem_resultado_valido_e_erro_do_juiz():
    # A saída cortada no meio da ferramenta chega assim: o bloco existe, o
    # campo não. Tem de ser o erro que quem chama sabe tratar.
    for entrada in ({"confianca": 0.9}, {"resultado": "talvez", "confianca": 0.9, "motivo": "x"}):
        def pela_metade(pedido, entrada=entrada):
            bloco = SimpleNamespace(type="tool_use", name="responder", input=entrada)
            return SimpleNamespace(content=[bloco], stop_reason="max_tokens", usage=None)

        with pytest.raises(ErroDoJuiz, match="sem um `resultado` válido") as e:
            _juiz(ApiComoMedida(responder=pela_metade))._chamar(nuvem.MODELO_BARATO, "ZmFsc28=", "image/jpeg", "CRITÉRIO")
        assert e.value.recuperavel is True


# ───────────────────────────── a reconsulta ─────────────────────────────


def _por_modelo(barato, forte):
    def responder(pedido):
        return forte(pedido) if pedido["model"] == nuvem.MODELO_FORTE else barato(pedido)

    return responder


def test_a_reconsulta_chega_ao_modelo_forte_e_vale(tmp_path, monkeypatch):
    # Era o que falhava sempre: o pedido ao modelo forte era recusado.
    monkeypatch.setattr(nuvem, "_ler_imagem", lambda p: ("ZmFsc28=", "image/jpeg"))
    api = ApiComoMedida(responder=_por_modelo(
        barato=lambda p: _resposta("nao_conforme", 0.60),  # confiança baixa: é o que faz reconsultar
        forte=lambda p: _resposta("conforme", 0.95),
    ))

    v = _juiz(api).julgar(tmp_path / "x.jpg", "critério")
    assert [p["model"] for p in api.pedidos] == [nuvem.MODELO_BARATO, nuvem.MODELO_FORTE]
    assert v.resultado is Resultado.CONFORME and v.modelo == nuvem.MODELO_FORTE
    # O custo é a soma das duas chamadas, cada uma no seu preço.
    so_barato = _juiz(ApiComoMedida(), forte=None).julgar(tmp_path / "x.jpg", "critério")
    assert v.custo_centavos > so_barato.custo_centavos > 0


def test_a_reconsulta_que_falha_nao_perde_a_resposta_que_ja_existia(tmp_path, monkeypatch):
    monkeypatch.setattr(nuvem, "_ler_imagem", lambda p: ("ZmFsc28=", "image/jpeg"))

    def sem_o_modelo(pedido):
        raise SemPermissao("a conta não tem este modelo")

    api = ApiComoMedida(responder=_por_modelo(barato=lambda p: _resposta("nao_conforme", 0.60), forte=sem_o_modelo))

    v = _juiz(api).julgar(tmp_path / "x.jpg", "critério")
    assert [p["model"] for p in api.pedidos] == [nuvem.MODELO_BARATO, nuvem.MODELO_FORTE], "tinha de ter reconsultado"
    assert v.resultado is Resultado.NAO_CONFORME
    assert v.confianca == pytest.approx(0.60)
    assert v.modelo == nuvem.MODELO_BARATO, "ficou o veredito do modelo barato"


def test_a_reconsulta_cortada_no_meio_tambem_nao_perde_a_resposta(tmp_path, monkeypatch):
    monkeypatch.setattr(nuvem, "_ler_imagem", lambda p: ("ZmFsc28=", "image/jpeg"))

    def cortada(pedido):
        bloco = SimpleNamespace(type="tool_use", name="responder", input={})
        return SimpleNamespace(content=[bloco], stop_reason="max_tokens", usage=None)

    api = ApiComoMedida(responder=_por_modelo(barato=lambda p: _resposta("conforme", 0.55), forte=cortada))
    v = _juiz(api).julgar(tmp_path / "x.jpg", "critério")
    assert len(api.pedidos) == 2
    assert v.resultado is Resultado.CONFORME and v.confianca == pytest.approx(0.55)
    assert v.modelo == nuvem.MODELO_BARATO


def test_a_falha_do_modelo_barato_continua_sendo_falha(tmp_path, monkeypatch):
    # Só a reconsulta é reforço. Sem a primeira resposta não há o que guardar.
    monkeypatch.setattr(nuvem, "_ler_imagem", lambda p: ("ZmFsc28=", "image/jpeg"))

    def fora_do_ar(pedido):
        raise RuntimeError("529")

    with pytest.raises(ErroDoJuiz) as e:
        _juiz(ApiComoMedida(responder=fora_do_ar)).julgar(tmp_path / "x.jpg", "critério")
    assert e.value.recuperavel is True


# ───────────────────────────── o preço ─────────────────────────────


def test_o_preco_do_modelo_forte_e_a_leitura_de_cache_dele():
    j = _juiz(ApiComoMedida())
    uso = SimpleNamespace(input_tokens=1_000_000, output_tokens=0, cache_read_input_tokens=0, cache_creation_input_tokens=0)
    # US$ 2 por milhão de entrada, com o dólar a 5,40 → 1.080 centavos.
    assert j._custo(nuvem.MODELO_FORTE, uso) == pytest.approx(1080.0)
    lido = SimpleNamespace(input_tokens=0, output_tokens=0, cache_read_input_tokens=1_000_000, cache_creation_input_tokens=0)
    assert j._custo(nuvem.MODELO_FORTE, lido) == pytest.approx(1080.0 * 0.05)
    assert j._custo(nuvem.MODELO_BARATO, lido) == pytest.approx(540.0 * 0.10)


# ─────────────────────── a descrição de equipamento ───────────────────────


def test_a_descricao_de_equipamento_tambem_sai_do_jeito_que_a_api_aceita(monkeypatch):
    # O mesmo modelo, o mesmo defeito: o botão "Analisar as fotos e descrever"
    # pedia a ferramenta forçada ao modelo que a recusa.
    def descrito(pedido):
        bloco = SimpleNamespace(type="tool_use", name="descrever", input={"descricao": "Chapa de inox. Limpa: clara.", "conferir": ["Nada em cima"]})
        return SimpleNamespace(content=[bloco], usage=SimpleNamespace(input_tokens=7000, output_tokens=400))

    monkeypatch.setattr(descrever, "baixar_fotos", lambda parametros, baixar: [descrever.FotoPronta(b64="ZmFsc28=", origem="envio", apagado=False)])
    api = ApiComoMedida(responder=descrito)

    saida = descrever.descrever_item({"nome": "Chapa", "tipo": "chapa", "setor": "Cozinha"}, baixar=lambda i: b"", cliente=api)
    assert saida["descricao"].startswith("Chapa de inox") and saida["modelo"] == descrever.MODELO
    (pedido,) = api.pedidos
    assert pedido["tool_choice"] == {"type": "auto"}
    assert pedido["max_tokens"] == descrever.MAX_TOKENS_ESCOLHA_LIVRE
