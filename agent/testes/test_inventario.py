"""O inventário da loja no agente: o que se sabe do equipamento vai com a pergunta.

A loja cadastra os equipamentos (chapa, bancada, caixa) e descreve como cada
um fica limpo e no lugar. O agente recebe, por ÁREA, os que aparecem nela, e
manda a descrição junto com a pergunta feita a um modelo sobre aquela área.

O que se protege aqui:

- a descrição vai para a área CERTA — o mesmo critério vale em várias áreas,
  e cada uma tem os seus equipamentos;
- o detector (presença, contagem) não leva texto;
- o texto que vai é limitado: é pago a cada análise;
- o formato é o do contrato que a API também lê.
"""

from __future__ import annotations

import json
from dataclasses import replace
from datetime import datetime
from pathlib import Path

import pytest

from farol_agent.auditoria import Auditoria
from farol_agent.configuracao import de_json
from farol_agent.juizes import local as juiz_local
from farol_agent.juizes import nuvem as juiz_nuvem
from farol_agent.juizes.base import MAX_DESCRICAO_NO_PEDIDO, MAX_EQUIPAMENTOS_NO_PEDIDO, bloco_dos_equipamentos
from farol_agent.juizes.seletor import JuizPorRegra, SeletorDeJuiz
from farol_agent.modelos import EquipamentoDaArea, Resultado, TipoRegra, Veredito, Via, Zona

from .test_configuracao import resposta
from .test_foto_padrao import LIMPA, FonteFixa, recorte_de_agora

CHAPA = EquipamentoDaArea("Chapa", "chapa", "Chapa de inox com duas tampas. Limpa: sem resíduo escuro.")
BALCAO = EquipamentoDaArea("Balcão", "balcao", "Balcão comprido. Limpo: tampo livre de copos.")
CABECALHO = (
    "EQUIPAMENTOS NESTA ÁREA — como cada um é e como fica quando está limpo e no lugar "
    "(descrição guardada pela loja; serve para reconhecer o que aparece, não é o critério):"
)


def _contrato() -> dict:
    caminho = Path(__file__).resolve().parents[2] / "contratos" / "equipamentos-da-area.json"
    assert caminho.is_file(), f"contrato não encontrado em {caminho}"
    return json.loads(caminho.read_text(encoding="utf-8"))


# ───────────────────────── a configuração ─────────────────────────


def test_o_agente_le_os_equipamentos_da_area_como_no_contrato():
    """A API confere o MESMO arquivo (api/testes/inventario.test.ts)."""
    contrato = _contrato()["equipamentosDaZona"]
    corpo = resposta()
    corpo["pontos"][0]["zonas"][0]["equipamentos"] = contrato

    (zona,) = de_json(corpo).pontos[0].zonas

    assert zona.equipamentos == [EquipamentoDaArea(e["nome"], e["tipo"], e["descricao"]) for e in contrato]
    assert sorted(contrato[0]) == ["descricao", "nome", "tipo"], "campo novo no contrato: o agente tem de passar a ler"


def test_nuvem_antiga_nao_manda_e_entrada_torta_fica_de_fora():
    assert de_json(resposta()).pontos[0].zonas[0].equipamentos == []

    corpo = resposta()
    corpo["pontos"][0]["zonas"][0]["equipamentos"] = [
        {"nome": "Chapa", "tipo": "chapa", "descricao": "  de inox  "},
        {"nome": "Sem descrição", "tipo": "chapa", "descricao": "   "},
        {"nome": "", "descricao": "sem nome"},
        {"nome": "Sem tipo", "descricao": "vale assim mesmo"},
        "lixo",
        None,
    ]
    assert de_json(corpo).pontos[0].zonas[0].equipamentos == [
        EquipamentoDaArea("Chapa", "chapa", "de inox"),
        EquipamentoDaArea("Sem tipo", "outro", "vale assim mesmo"),
    ]


# ───────────────────────── o texto que vai ─────────────────────────


def test_sem_equipamento_nao_ha_o_que_dizer():
    for nada in (None, [], [{"nome": "Chapa", "descricao": ""}], [EquipamentoDaArea("", "chapa", "x")]):
        assert bloco_dos_equipamentos(nada) is None


def test_o_bloco_apresenta_cada_equipamento_numa_linha():
    assert bloco_dos_equipamentos([CHAPA, BALCAO]) == (
        f"{CABECALHO}\n"
        "- Chapa: Chapa de inox com duas tampas. Limpa: sem resíduo escuro.\n"
        "- Balcão: Balcão comprido. Limpo: tampo livre de copos."
    )
    # o contexto atravessa a fila em JSON: dicionário vale igual
    assert bloco_dos_equipamentos([{"nome": "Chapa", "tipo": "chapa", "descricao": CHAPA.descricao}]) == f"{CABECALHO}\n- Chapa: {CHAPA.descricao}"


def test_o_texto_e_limitado_porque_e_pago_a_cada_analise():
    assert (MAX_EQUIPAMENTOS_NO_PEDIDO, MAX_DESCRICAO_NO_PEDIDO) == (4, 500)
    muitos = [EquipamentoDaArea(f"Equipamento {i}", "outro", "d" * 800) for i in range(7)]

    bloco = bloco_dos_equipamentos(muitos)

    linhas = bloco.split("\n")[1:]
    assert [l.split(":")[0] for l in linhas] == [f"- Equipamento {i}" for i in range(4)], "só os quatro primeiros"
    for l in linhas:
        descricao = l.split(": ", 1)[1]
        assert len(descricao) == 500 and descricao.endswith("…"), "a descrição comprida é cortada, e o corte é dito"
    assert bloco_dos_equipamentos([EquipamentoDaArea("Curta", "outro", "d" * 500)]).endswith("d" * 500), "no limite, vai inteira"


def test_na_nuvem_o_bloco_vem_depois_do_criterio_e_antes_do_contexto():
    pedido = juiz_nuvem._montar_pedido(
        "A chapa está limpa.",
        {"regra_id": "r1", "zona_id": "z1", "fora_da_area": "apagado", "equipamentos": [CHAPA], "pedido": "X-burger"},
    )
    partes = pedido.split("\n\n")

    assert partes[0] == "CRITÉRIO A AUDITAR:\nA chapa está limpa."
    assert partes[1] == juiz_nuvem.AVISO_DA_AREA
    assert partes[2] == f"{CABECALHO}\n- Chapa: {CHAPA.descricao}"
    assert partes[3] == "CONTEXTO DA OPERAÇÃO:\n- regra_id: r1\n- pedido: X-burger", "e não aparece de novo como linha do contexto"
    assert len(partes) == 4


def test_as_instrucoes_fixas_nao_mudaram():
    # O que fica em cache é o texto fixo: a descrição vai no pedido, senão
    # cada equipamento novo invalidaria o cache de todas as lojas.
    assert "EQUIPAMENTOS" not in juiz_nuvem.INSTRUCOES


def test_o_modelo_da_loja_recebe_o_mesmo_bloco():
    pedido = juiz_local._pedido("A chapa está limpa.", {"regra_id": "r1", "equipamentos": [CHAPA], "pedido": "X-burger"})
    assert pedido == (
        "CRITÉRIO A AUDITAR:\nA chapa está limpa.\n\n"
        f"{CABECALHO}\n- Chapa: {CHAPA.descricao}\n\n"
        "CONTEXTO DA OPERAÇÃO:\n- regra_id: r1\n- pedido: X-burger"
    )
    assert juiz_local._pedido("c", {"regra_id": "r1"}) == "CRITÉRIO A AUDITAR:\nc\n\nCONTEXTO DA OPERAÇÃO:\n- regra_id: r1"


# ───────────────────────── para a área certa ─────────────────────────


class Anota:
    """Um juiz que guarda como foi chamado."""

    nome = "anota"

    def __init__(self):
        self.chamadas: list[dict] = []

    def atende(self, parametros):
        return None

    def julgar(self, imagem, criterio, *, contexto=None, referencias=None):
        self.chamadas.append(dict(contexto or {}))
        return Veredito(resultado=Resultado.CONFORME, confianca=0.9, via=Via.NUVEM, custo_centavos=1.0)


COZINHA = Zona(id="z1", nome="Chapa", poligono=[(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)], ponto_id="p1")
SALAO = Zona(id="z2", nome="Balcão", poligono=[(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)], ponto_id="p2")
DE_CADA_AREA = {"z1": [CHAPA], "z2": [BALCAO]}


def test_o_mesmo_criterio_em_duas_areas_leva_os_equipamentos_de_cada_uma(regra, tmp_path):
    # A regra do dicionário é UMA (a da área z1), mas o critério vale também
    # em z2: quem diz a área é o item da fila, não a regra.
    nuvem = Anota()
    juiz = JuizPorRegra(SeletorDeJuiz("nuvem", nuvem=nuvem), {"r1": replace(regra, zona=COZINHA)}, equipamentos=DE_CADA_AREA)
    agora = recorte_de_agora(tmp_path, LIMPA)

    juiz.julgar(agora, "c", contexto={"regra_id": "r1", "zona_id": "z2", "ponto_id": "p2"})
    juiz.julgar(agora, "c", contexto={"regra_id": "r1", "zona_id": "z1", "ponto_id": "p1"})
    juiz.julgar(agora, "c", contexto={"regra_id": "r1", "zona_id": "z9", "ponto_id": "p9"})

    assert nuvem.chamadas == [
        {"regra_id": "r1", "equipamentos": [BALCAO]},
        {"regra_id": "r1", "equipamentos": [CHAPA]},
        {"regra_id": "r1"},
    ], "cada área com os seus; área sem equipamento, sem a chave; e o endereço do agente não vai"


@pytest.mark.parametrize("tipo, leva", [(TipoRegra.ESTADO, True), (TipoRegra.ACAO, True), (TipoRegra.PRESENCA, False), (TipoRegra.CONTAGEM, False)])
def test_so_quem_le_texto_leva_a_descricao(regra, tmp_path, tipo, leva):
    juiz_unico = Anota()
    seletor = SeletorDeJuiz("nuvem", nuvem=juiz_unico, detector=juiz_unico)
    da_regra = replace(regra, tipo=tipo, zona=COZINHA, parametros={"objeto": "pessoa", "minimo": 1})
    juiz = JuizPorRegra(seletor, {"r1": da_regra}, equipamentos=DE_CADA_AREA)

    juiz.julgar(recorte_de_agora(tmp_path, LIMPA), "c", contexto={"regra_id": "r1", "zona_id": "z1", "ponto_id": "p1"})

    assert ("equipamentos" in juiz_unico.chamadas[0]) is leva


def test_sem_inventario_o_juiz_chama_como_sempre(regra, tmp_path):
    nuvem = Anota()
    juiz = JuizPorRegra(SeletorDeJuiz("nuvem", nuvem=nuvem), {"r1": replace(regra, zona=COZINHA)})
    juiz.julgar(recorte_de_agora(tmp_path, LIMPA), "c", contexto={"regra_id": "r1", "zona_id": "z1", "ponto_id": "p1"})
    assert nuvem.chamadas == [{"regra_id": "r1"}]


# ───────────────────────── de ponta a ponta ─────────────────────────

# Terça-feira ao meio-dia: dentro da janela da regra do dublê de configuração.
MEIO_DIA = datetime(2026, 10, 6, 12, 0, 0)


def test_da_configuracao_ao_texto_que_a_nuvem_le(tmp_path, monkeypatch):
    from .test_auditoria import NuvemDeTeste

    textos: list[str] = []

    def falso_chamar(self, modelo, b64, tipo, texto, refs=None, padrao=None):
        textos.append(texto)
        return Veredito(resultado=Resultado.CONFORME, confianca=0.99, via=Via.NUVEM, custo_centavos=1.0)

    monkeypatch.setenv("ANTHROPIC_API_KEY", "chave-de-teste")
    monkeypatch.setattr(juiz_nuvem.JuizNuvem, "_chamar", falso_chamar)

    corpo = resposta()
    corpo["pontos"][0]["zonas"][0]["equipamentos"] = _contrato()["equipamentosDaZona"]
    a = Auditoria(NuvemDeTeste(), str(tmp_path / "fila.db"), construir_fonte=lambda ponto: FonteFixa(LIMPA), medidor=None)
    a.montar(de_json(corpo))

    a.passo(MEIO_DIA)

    (texto,) = textos
    descricao = _contrato()["equipamentosDaZona"][0]["descricao"]
    assert f"{CABECALHO}\n- Chapa: {descricao}" in texto
    assert texto.startswith("CRITÉRIO A AUDITAR:\na bancada está livre e limpa")
    a.fila.fechar()
