"""O pedido com contexto, caso a caso, contra `contratos/pedido-com-contexto.json` (o balcão, fatia 1b).

"A dúvida passa pelo nosso servidor": o servidor vai montar este pedido no lugar do agente. Para isso o que o
agente monta HOJE fica escrito num arquivo de contrato, e os dois lados leem o MESMO arquivo — aqui, o agente
prova que continua montando assim; em `api/testes/balcao-pedido.test.ts`, o servidor prova que monta igual, letra
por letra.

Cada caso traz a configuração como ela desce para a loja, o item da análise (canal, área, critério, e o que só a
loja sabe: se o cinza em volta foi apagado, se o mapa é esquema ou fotografia, que foto padrão foi escolhida) e o
`esperado`: o conteúdo do pedido — ou por que não há pedido.

O `esperado` e o cabeçalho do arquivo são GERADOS por este teste, com o código de verdade:

    FAROL_GRAVAR_CONTRATO=1 python -m pytest testes/test_pedido_do_contrato.py -o addopts="" -q -p no:cacheprovider

Sem a variável, o teste só confere. Mudou de propósito o texto do pedido? Grave de novo — e o teste do servidor
quebra até o porte acompanhar. É para isso que o arquivo existe.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from farol_agent import contexto as ctx_mod
from farol_agent.configuracao import de_json
from farol_agent.contexto import FALTA_A_CENA, cenas_da_loja
from farol_agent.juizes import base, nuvem
from farol_agent.juizes.base import ErroDoJuiz
from farol_agent.juizes.seletor import JuizPorRegra, SeletorDeJuiz
from farol_agent.modelos import Resultado, TipoRegra, Veredito, Via

from .test_nuvem_chamada import ApiComoMedida, Recusa, SemPermissao

CAMINHO = Path(__file__).resolve().parents[2] / "contratos" / "pedido-com-contexto.json"
GRAVAR = os.environ.get("FAROL_GRAVAR_CONTRATO") == "1"

# Letras que não se veem num editor: vão escritas pelo código (\\uXXXX), para o arquivo não mudar calado.
_INVISIVEIS = "\u0085      　﻿​" + "".join(chr(c) for c in range(0x2000, 0x200B))


def _ler() -> dict[str, Any]:
    assert CAMINHO.is_file(), f"contrato não encontrado em {CAMINHO}"
    return json.loads(CAMINHO.read_text(encoding="utf-8"))


_NUMERO = r"-?\d+(?:\.\d+)?"
_PAR = rf"\[\s*({_NUMERO}),\s*({_NUMERO})\s*\]"


def _escrever(documento: dict[str, Any]) -> None:
    texto = json.dumps(documento, ensure_ascii=False, indent=2)
    for c in _INVISIVEIS:
        texto = texto.replace(c, f"\\u{ord(c):04x}")
    # Lista de números numa linha só (o polígono, os brancos): um número por linha triplicava o arquivo.
    texto = re.sub(_PAR, r"[\1, \2]", texto)
    texto = re.sub(
        rf'\[\s*((?:\[{_NUMERO}, {_NUMERO}\],\s*)+\[{_NUMERO}, {_NUMERO}\])\s*\]',
        lambda m: "[" + ", ".join(re.findall(rf"\[{_NUMERO}, {_NUMERO}\]", m.group(1))) + "]",
        texto,
    )
    texto = re.sub(
        rf"\[\s*((?:{_NUMERO},\s*){{2,}}{_NUMERO})\s*\]",
        lambda m: "[" + ", ".join(m.group(1).replace(",", " ").split()) + "]",
        texto,
    )
    # A arrumação é só de espaços FORA dos textos: se um texto dos casos parecer lista de números, ela o estragaria.
    assert json.loads(texto) == documento, "a arrumação do arquivo mudou o conteúdo"
    CAMINHO.write_text(texto + "\n", encoding="utf-8", newline="\n")


CONTRATO = _ler()


# ───────────────────────── a loja de mentira ─────────────────────────


class _JuizDaLoja:
    """Um juiz que mora na loja (o detector): responde sem falar com ninguém de fora."""

    nome = "da-loja"

    def atende(self, *_a: Any, **_k: Any) -> None:
        return None

    def julgar(self, imagem: Any, criterio: str, *, contexto: Any = None, referencias: Any = None) -> Veredito:
        return Veredito(resultado=Resultado.CONFORME, confianca=1.0, motivo="julgado na loja", via=Via.DETECTOR)


class _FotoPadrao:
    """O juiz da foto padrão, só no que interessa ao pedido: QUAL foto vai junto, e o que ele faz com a
    comparação que não deu "igual" — entrega à nuvem com a foto ao lado, como `JuizDoPadrao.julgar`."""

    nome = "foto-padrao"

    def __init__(self, arquivo: Path | None, nome: str | None, nuvem_: Any) -> None:
        self._arquivo, self._nome, self._nuvem = arquivo, nome, nuvem_

    def atende(self, *_a: Any, **_k: Any) -> None:
        return None

    def referencia_para(self, imagem: Any, ctx: dict[str, Any]) -> Any:
        if self._arquivo is None:
            return None
        return self._arquivo, SimpleNamespace(ref=SimpleNamespace(nome=self._nome))

    def julgar(self, imagem: Any, criterio: str, *, contexto: Any = None, referencias: Any = None) -> Veredito:
        ctx = contexto or {}
        if self._nuvem is None or self._arquivo is None or ctx.get("sem_cena_escrita"):
            return Veredito(resultado=Resultado.NAO_AVALIAVEL, confianca=None, motivo="sem a quem perguntar", via=Via.COMPARACAO)
        return self._nuvem.julgar(imagem, criterio, contexto={**ctx, "foto_padrao": self._nome}, referencias=[self._arquivo])


def _o_juiz_de_nuvem(api: Any) -> nuvem.JuizNuvem:
    """O juiz de verdade com o cliente trocado: quem monta o pedido é o código; o dublê só anota e responde."""
    j = nuvem.JuizNuvem.__new__(nuvem.JuizNuvem)
    j._anthropic = SimpleNamespace(
        BadRequestError=Recusa, AuthenticationError=SemPermissao,
        PermissionDeniedError=SemPermissao, NotFoundError=SemPermissao,
    )
    j._cliente = api
    j.modelo = nuvem.MODELO_BARATO
    j.modelo_forte = nuvem.MODELO_FORTE
    j.modelo_com_contexto = nuvem.MODELO_COM_CONTEXTO
    j.exige_cena = True          # a loja pergunta com contexto
    j.escalar_abaixo_de = nuvem.JuizNuvem.__init__.__kwdefaults__["escalar_abaixo_de"]
    j.dolar = 5.40
    return j


def _responde(confianca: float) -> Any:
    bloco = SimpleNamespace(type="tool_use", name="responder", input={"resultado": "nao_conforme", "confianca": confianca, "motivo": "visto"})
    return SimpleNamespace(content=[bloco], usage=SimpleNamespace(input_tokens=100, output_tokens=20))


def _por_que_nao(e: ErroDoJuiz) -> str:
    """O motivo de não haver pedido, numa palavra que os dois lados usam."""
    texto = str(e)
    if texto == FALTA_A_CENA:
        return "falta_a_cena"
    if texto.startswith("o mapa deste canal ainda não foi desenhado"):
        return "falta_o_mapa"
    if texto.startswith("contexto sem regra_id utilizável"):
        return "criterio_fora_da_configuracao"
    if "precisa do juiz" in texto and "que não está configurado" in texto:
        # Urgente, ou loja em modo local: só um juiz da loja atenderia, e nada vai para fora.
        return "nao_vai_a_plataforma"
    raise AssertionError(f"recusa que o contrato não conhece: {texto}")


def pedidos_do_caso(caso: dict[str, Any], pasta: Path, *, confianca: float = 0.9) -> dict[str, Any]:
    """Roda o item do caso pelo caminho de verdade (a configuração → o seletor → o juiz de nuvem) e devolve o
    que saiu para a plataforma: `{"pedidos": [...]}` — ou `{"semPedido": motivo}`."""
    item = caso["item"]
    config = de_json(caso["configuracao"])
    imagens = CONTRATO["imagens"]

    def arquivo(nome: str, qual: str) -> Path:
        caminho = pasta / nome
        caminho.write_bytes(base64.standard_b64decode(imagens[qual]))
        return caminho

    api = ApiComoMedida(lambda pedido: _responde(confianca))
    da_nuvem = _o_juiz_de_nuvem(api)

    # O mapa do canal: a loja o tem em disco (esquema ou fotografia), ou ainda não.
    mapa = arquivo(f"mapa_{item['mapa']}.jpg", "mapa") if item["mapa"] else None
    mapas = SimpleNamespace(arquivo=lambda ponto_id, cena: mapa, e_esquema=lambda caminho: item["mapa"] == "esquema")

    # A foto padrão que a loja escolheu: o nome é o que a configuração diz daquela foto, naquele canal. Quando o
    # item não diz qual, a loja OFERECE a que tiver do canal — e quem decide se ela vai é o critério, no código.
    foto, nome_da_foto = None, None
    ponto = config.ponto(item["pontoId"])
    do_canal = {p.id: p for p in (ponto.padroes if ponto is not None else [])}
    if item["fotoPadrao"]:
        assert item["fotoPadrao"] in do_canal, "o item escolheu uma foto que o canal não tem"
    escolhida = do_canal.get(item["fotoPadrao"]) if item["fotoPadrao"] else next(iter(do_canal.values()), None)
    if escolhida is not None:
        foto, nome_da_foto = arquivo("padrao.jpg", "padrao"), escolhida.nome

    # Montado como a auditoria monta (`Auditoria._juiz_padrao`): nuvem, detector e foto padrão.
    em_modo_local = config.modo_julgamento == "local"
    seletor = SeletorDeJuiz(
        config.modo_julgamento, nuvem=da_nuvem, detector=_JuizDaLoja(),
        padrao=_FotoPadrao(foto, nome_da_foto, None if em_modo_local else da_nuvem),
    )
    por_regra = JuizPorRegra(
        seletor,
        {r.id: r for r in config.regras},
        equipamentos={z.id: z.equipamentos for p in config.pontos for z in p.zonas if z.equipamentos},
        lugares={p.id: p.lugar for p in config.pontos if p.lugar},
        cenas=cenas_da_loja(config),
        mapas=mapas,
    )

    # O contexto do item, como o motor o enfileira.
    ctx: dict[str, Any] = {"regra_id": item["regraId"], "zona_id": item["zonaId"], "ponto_id": item["pontoId"]}
    if item["foraDaArea"]:
        ctx["fora_da_area"] = "apagado"

    try:
        por_regra.julgar(arquivo("auditada.jpg", "auditada"), item["criterio"], contexto=ctx)
    except ErroDoJuiz as e:
        assert api.pedidos == [], "recusou, e mesmo assim algo saiu"
        return {"semPedido": _por_que_nao(e)}
    if not api.pedidos:
        # Julgado por um juiz da loja (presença, contagem): nada saiu.
        regra = next(r for r in config.regras if r.id == item["regraId"])
        assert regra.tipo in (TipoRegra.PRESENCA, TipoRegra.CONTAGEM), "só o detector responde sem perguntar"
        return {"semPedido": "nao_vai_a_plataforma"}
    return {"pedidos": api.pedidos}


def _cabecalho(pasta: Path) -> dict[str, Any]:
    """O que é igual em todo pedido: tirado de uma chamada de verdade (e da reconsulta dela), não das constantes."""
    caso = CONTRATO["casos"][0]
    # A primeira resposta vem insegura: o juiz reconsulta o modelo forte, com o mesmo pedido.
    rotina, forte = pedidos_do_caso(caso, pasta, confianca=0.5)["pedidos"]
    assert forte["system"] == rotina["system"] and forte["messages"] == rotina["messages"] and forte["tools"] == rotina["tools"]
    (sistema,) = rotina["system"]
    assert sistema == {"type": "text", "text": nuvem.INSTRUCOES_COM_CONTEXTO, "cache_control": {"type": "ephemeral"}}
    (ferramenta,) = rotina["tools"]

    def da_chamada(pedido: dict[str, Any]) -> dict[str, Any]:
        assert set(pedido) == {"model", "system", "tools", "messages", "max_tokens", "tool_choice"}, "nada além disto vai na chamada"
        return {"model": pedido["model"], "max_tokens": pedido["max_tokens"], "tool_choice": pedido["tool_choice"]}

    return {
        "instrucoes": {
            "sha256": hashlib.sha256(sistema["text"].encode("utf-8")).hexdigest(),
            "letras": len(sistema["text"]),
            "cache_control": sistema["cache_control"],
        },
        "ferramenta": ferramenta,
        # O que o Python conta como espaço em branco (`str.split()`, `strip()`): não é o `\s` do JavaScript.
        "brancos": [c for c in range(sys.maxunicode + 1) if chr(c).isspace()],
        "tetos": {
            "negocio": ctx_mod.MAX_TIPO_NO_PEDIDO, "nome": ctx_mod.MAX_NOME_NO_PEDIDO, "cena": ctx_mod.MAX_CENA_NO_PEDIDO,
            "lugar": base.MAX_LUGAR_NO_PEDIDO, "equipamentos": base.MAX_EQUIPAMENTOS_NO_PEDIDO, "descricao": base.MAX_DESCRICAO_NO_PEDIDO,
        },
        "chamadas": {
            "rotina": da_chamada(rotina),
            # A reconsulta: a mesma pergunta ao modelo forte, quando a primeira resposta vem com confiança abaixo disto.
            "reconsulta": {**da_chamada(forte), "abaixoDe": nuvem.JuizNuvem.__init__.__kwdefaults__["escalar_abaixo_de"]},
        },
    }


def _esperado(caso: dict[str, Any], pasta: Path, cabecalho: dict[str, Any]) -> dict[str, Any]:
    saida = pedidos_do_caso(caso, pasta)
    if "semPedido" in saida:
        return saida
    (pedido,) = saida["pedidos"]
    # O que não muda de um caso para o outro é o do cabeçalho; o caso guarda só o conteúdo.
    assert pedido["system"] == [{"type": "text", "text": nuvem.INSTRUCOES_COM_CONTEXTO, "cache_control": cabecalho["instrucoes"]["cache_control"]}]
    assert pedido["tools"] == [cabecalho["ferramenta"]]
    assert {k: pedido[k] for k in ("model", "max_tokens", "tool_choice")} == cabecalho["chamadas"]["rotina"]
    (mensagem,) = pedido["messages"]
    assert set(mensagem) == {"role", "content"} and mensagem["role"] == "user"
    return {"conteudo": mensagem["content"]}


# ───────────────────────── gravar, ou conferir ─────────────────────────


@pytest.fixture(autouse=True)
def _sem_memoria_de_recusa():
    nuvem._recusaram_a_escolha.clear()
    yield
    nuvem._recusaram_a_escolha.clear()


def test_gravar_o_contrato(tmp_path):
    """Só com `FAROL_GRAVAR_CONTRATO=1`: reescreve o cabeçalho e o `esperado` de cada caso."""
    if not GRAVAR:
        pytest.skip("só grava com FAROL_GRAVAR_CONTRATO=1")
    assert not os.environ.get("CI"), "o contrato não se grava no CI: grava-se na máquina, e o arquivo vai no commit"
    documento = _ler()
    cabecalho = _cabecalho(tmp_path)
    documento.update(cabecalho)
    for i, caso in enumerate(documento["casos"]):
        pasta = tmp_path / f"caso-{i}"
        pasta.mkdir()
        caso["esperado"] = _esperado(caso, pasta, cabecalho)
    _escrever(documento)


def test_o_cabecalho_do_contrato_e_o_que_o_agente_manda(tmp_path):
    if GRAVAR:
        pytest.skip("gravando")
    cabecalho = _cabecalho(tmp_path)
    for chave, valor in cabecalho.items():
        assert CONTRATO[chave] == valor, chave
    # As instruções são as do código, letra por letra: é pelo resumo que o servidor confere as dele.
    assert CONTRATO["instrucoes"]["sha256"] == hashlib.sha256(nuvem.INSTRUCOES_COM_CONTEXTO.encode("utf-8")).hexdigest()
    assert CONTRATO["chamadas"]["rotina"]["model"] == nuvem.MODELO_COM_CONTEXTO
    assert CONTRATO["chamadas"]["reconsulta"]["model"] == nuvem.MODELO_FORTE


@pytest.mark.parametrize("caso", CONTRATO["casos"], ids=[c["nome"] for c in CONTRATO["casos"]])
def test_o_agente_monta_o_pedido_do_contrato(caso, tmp_path):
    if GRAVAR:
        pytest.skip("gravando")
    assert caso["esperado"] is not None, "caso sem `esperado`: grave o contrato"
    assert _esperado(caso, tmp_path, CONTRATO) == caso["esperado"]


def test_os_casos_cobrem_as_formas_do_pedido():
    """O arquivo não encolhe calado: cada forma do pedido tem pelo menos um caso."""
    if GRAVAR:
        pytest.skip("gravando")
    casos = CONTRATO["casos"]
    assert len({c["nome"] for c in casos}) == len(casos), "nome de caso repetido"
    com_pedido = [c for c in casos if "conteudo" in c["esperado"]]
    motivos = {c["esperado"]["semPedido"] for c in casos if "semPedido" in c["esperado"]}
    assert motivos == {"falta_a_cena", "falta_o_mapa", "criterio_fora_da_configuracao", "nao_vai_a_plataforma"}

    def tem(texto: str) -> bool:
        return any(texto in b.get("text", "") for c in com_pedido for b in c["esperado"]["conteudo"])

    for trecho in (
        "é um esquema, sem a imagem da câmera", "é a câmera inteira, reduzida", "é a imagem completa desta câmera",
        "FOTO PADRÃO — ", "FIM DA FOTO PADRÃO.", "FIM DO MAPA.", "ONDE ESTA CÂMERA FICA — ", "COMO DEVE SER — ",
        "ÁREA DE ANÁLISE:", "EQUIPAMENTOS NESTA ÁREA — ", "…",
    ):
        assert tem(trecho), f"nenhum caso com: {trecho}"
    assert any(c["item"]["mapa"] is None and "conteudo" in c["esperado"] for c in casos)
    assert {c["configuracao"]["loja"].get("modoJulgamento") for c in casos} == {"nuvem", "hibrido", "local", None}
