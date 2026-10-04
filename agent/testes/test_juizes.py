"""Os quatro caminhos de julgamento: comparação, binário e seleção.

O que se protege aqui:

- que a comparação **não acuse cena apenas diferente** de irregular;
- que o binário **não produza veredito agregado**, porque 0,95⁸ = 0,66;
- que `presenca`, `contagem` e `comparacao` **nunca** saiam da loja, e que
  regra `urgente` **nunca** dependa da internet — qualquer que seja o modo
  configurado.
"""

from __future__ import annotations

import numpy as np
import pytest

from farol_agent.base_conhecimento import BaseConhecimento, normalizar
from farol_agent.juizes.base import ErroDoJuiz
from farol_agent.juizes.binario import JuizBinario, Pergunta, perguntas_da_ficha
from farol_agent.juizes.comparacao import JuizComparacao
from farol_agent.juizes.seletor import JuizPorRegra, SeletorDeJuiz
from farol_agent.modelos import Prioridade, Resultado, TipoRegra
from testes.conftest import JuizFixo


# ───────────────────────── dublês ──────────────────────────────────────


class EmbedderFalso:
    """Devolve o vetor que mandarem, sem olhar a imagem."""

    dim = 4

    def __init__(self, vetor):
        self.vetor = np.asarray(vetor, dtype=np.float32)

    def embed(self, imagem):
        return self.vetor


class MotorBinarioFalso:
    nome_modelo = "falso-2b"

    def __init__(self, probabilidades):
        self.probabilidades = probabilidades
        self.chamadas = 0

    def perguntar(self, imagem, perguntas):
        self.chamadas += 1
        return self.probabilidades[: len(perguntas)]


@pytest.fixture
def imagem(tmp_path):
    from farol_agent import imagens

    p = tmp_path / "q.jpg"
    # `imagens.escrever`, não `cv2.imwrite`: o próprio tmp_path do pytest cai
    # embaixo de C:\Users\Usuário, e o cv2 não grava em caminho com acento.
    assert imagens.escrever(p, np.full((40, 40, 3), 127, dtype=np.uint8))
    return p


def _base(**kw):
    padrao = dict(
        id="b1",
        nome="bancada limpa",
        limiar=0.85,
        margem=0.06,
        referencias=[np.array([1.0, 0.0, 0.0, 0.0], dtype=np.float32)] * 3,
    )
    padrao.update(kw)
    return BaseConhecimento(**padrao)


# ────────────────────── base de conhecimento ───────────────────────────


def test_similaridade_usa_a_referencia_mais_parecida():
    """Máximo, não média: a base guarda variações legítimas da mesma coisa."""
    base = _base(
        referencias=[
            np.array([1.0, 0.0, 0.0, 0.0]),
            np.array([0.0, 1.0, 0.0, 0.0]),
            np.array([0.0, 0.0, 1.0, 0.0]),
        ]
    )
    assert base.similaridade(np.array([0.0, 1.0, 0.0, 0.0])) == pytest.approx(1.0)


def test_base_com_menos_de_tres_referencias_nao_esta_pronta():
    assert not _base(referencias=[np.array([1.0, 0, 0, 0])]).pronta
    assert _base().pronta


def test_limiar_invalido_estoura_no_carregamento():
    with pytest.raises(ValueError, match="limiar"):
        _base(limiar=1.5)


# ──────────────────────── juiz de comparação ───────────────────────────


def test_igual_ao_conhecido_e_conforme_de_graca(imagem):
    juiz = JuizComparacao(EmbedderFalso([1.0, 0, 0, 0]), {"b1": _base()})

    v = juiz.julgar(imagem, "bancada limpa", contexto={"base_id": "b1"})

    assert v.resultado is Resultado.CONFORME
    assert v.custo_centavos == 0.0


def test_muito_diferente_destoa(imagem):
    juiz = JuizComparacao(EmbedderFalso([0.0, 1.0, 0, 0]), {"b1": _base()})

    v = juiz.julgar(imagem, "bancada limpa", contexto={"base_id": "b1"})

    assert v.resultado is Resultado.NAO_CONFORME


def test_banda_de_incerteza_escala_em_vez_de_acusar(imagem):
    """Cena nova e legítima não pode virar alerta só por ser nova."""
    # cos ≈ 0.83, entre 0.79 (limiar-margem) e 0.85 (limiar)
    quase = normalizar(np.array([0.83, 0.5577, 0.0, 0.0]))
    escalada = JuizFixo(Resultado.CONFORME, confianca=0.9)
    juiz = JuizComparacao(
        EmbedderFalso(quase), {"b1": _base()}, escalar_para=escalada
    )

    v = juiz.julgar(imagem, "bancada limpa", contexto={"base_id": "b1"})

    assert escalada.chamadas == 1
    assert v.resultado is Resultado.CONFORME
    assert "escalado" in (v.motivo or "")


def test_sem_escalada_a_banda_vira_nao_avaliavel(imagem):
    quase = normalizar(np.array([0.83, 0.5577, 0.0, 0.0]))
    juiz = JuizComparacao(EmbedderFalso(quase), {"b1": _base()})

    v = juiz.julgar(imagem, "c", contexto={"base_id": "b1"})

    assert v.resultado is Resultado.NAO_AVALIAVEL


def test_base_imatura_escala_em_vez_de_acusar(imagem):
    """Base com uma referência acusaria tudo que for diferente."""
    magra = _base(referencias=[np.array([1.0, 0, 0, 0])])
    escalada = JuizFixo(Resultado.CONFORME, confianca=0.9)
    juiz = JuizComparacao(
        EmbedderFalso([0.0, 1.0, 0, 0]), {"b1": magra}, escalar_para=escalada
    )

    juiz.julgar(imagem, "c", contexto={"base_id": "b1"})

    assert escalada.chamadas == 1, "base imatura tem que escalar, não acusar"


def test_regra_sem_base_escala(imagem):
    escalada = JuizFixo(Resultado.NAO_CONFORME, confianca=0.9)
    juiz = JuizComparacao(EmbedderFalso([1.0, 0, 0, 0]), {}, escalar_para=escalada)

    juiz.julgar(imagem, "c", contexto={})

    assert escalada.chamadas == 1


# ────────────────────────── juiz binário ───────────────────────────────


def test_responde_item_a_item_e_nao_o_conjunto(imagem):
    """0,95⁸ = 0,66. Veredito do conjunto não serviria para nada."""
    ficha = ["pao", "carne", "queijo", "picles", "alface", "tomate", "bacon", "molho"]
    perguntas = perguntas_da_ficha(ficha)
    # picles ausente, o resto presente
    probs = [0.99, 0.99, 0.98, 0.02, 0.97, 0.99, 0.96, 0.99]
    juiz = JuizBinario(MotorBinarioFalso(probs))

    respostas = juiz.julgar_itens(imagem, perguntas)

    assert len(respostas) == 8
    faltando = [r.pergunta.id for r in respostas if r.resultado is Resultado.NAO_CONFORME]
    assert faltando == ["picles"]
    assert not hasattr(juiz, "veredito_do_conjunto")


def test_probabilidade_no_meio_vira_nao_avaliavel(imagem):
    juiz = JuizBinario(MotorBinarioFalso([0.55]))

    r = juiz.julgar_itens(imagem, [Pergunta(id="x", texto="tem queijo?")])[0]

    assert r.resultado is Resultado.NAO_AVALIAVEL


def test_pergunta_com_esperado_falso_inverte(imagem):
    """"Há objeto obstruindo a passagem?" — o certo é NÃO."""
    juiz = JuizBinario(MotorBinarioFalso([0.02]))
    p = Pergunta(id="obstr", texto="há caixa no corredor?", esperado=False)

    r = juiz.julgar_itens(imagem, [p])[0]

    assert r.resultado is Resultado.CONFORME


def test_motor_que_devolve_menos_respostas_estoura(imagem):
    juiz = JuizBinario(MotorBinarioFalso([0.9]))

    with pytest.raises(ErroDoJuiz, match="probabilidades"):
        juiz.julgar_itens(
            imagem,
            [Pergunta(id="a", texto="a?"), Pergunta(id="b", texto="b?")],
        )


def test_um_passe_so_para_todas_as_perguntas(imagem):
    motor = MotorBinarioFalso([0.99] * 8)
    juiz = JuizBinario(motor)

    juiz.julgar_itens(imagem, perguntas_da_ficha(["a", "b", "c", "d", "e", "f", "g", "h"]))

    assert motor.chamadas == 1, "oito perguntas não podem virar oito passes"


# ──────────────────────────── seletor ──────────────────────────────────


def _regra(regra, tipo, prioridade=Prioridade.INTERMEDIARIA):
    regra.tipo = tipo
    regra.prioridade = prioridade
    return regra


@pytest.mark.parametrize("tipo", [TipoRegra.PRESENCA, TipoRegra.CONTAGEM])
def test_categorias_locais_nunca_vao_para_a_nuvem(regra, tipo):
    nuvem, local = JuizFixo(), JuizFixo()
    sel = SeletorDeJuiz("nuvem", nuvem=nuvem, local=local)

    assert sel.para(_regra(regra, tipo)) is local


def test_comparacao_usa_o_juiz_de_comparacao(regra):
    comp, nuvem = JuizFixo(), JuizFixo()
    sel = SeletorDeJuiz("nuvem", nuvem=nuvem, comparacao=comp)

    assert sel.para(_regra(regra, TipoRegra.COMPARACAO)) is comp


def test_urgente_nunca_depende_da_internet(regra):
    """Dois segundos não cabem numa ida e volta à nuvem."""
    nuvem, binario = JuizFixo(), JuizFixo()
    sel = SeletorDeJuiz("nuvem", nuvem=nuvem, binario=binario)

    escolhido = sel.para(_regra(regra, TipoRegra.ESTADO, Prioridade.URGENTE))

    assert escolhido is binario


def test_modo_local_nao_usa_a_nuvem_nem_se_houver(regra):
    nuvem, local = JuizFixo(), JuizFixo()
    sel = SeletorDeJuiz("local", nuvem=nuvem, local=local)

    assert sel.para(_regra(regra, TipoRegra.ESTADO)) is local


def test_modo_nuvem_manda_estado_para_a_nuvem(regra):
    nuvem, local = JuizFixo(), JuizFixo()
    sel = SeletorDeJuiz("nuvem", nuvem=nuvem, local=local)

    assert sel.para(_regra(regra, TipoRegra.ESTADO)) is nuvem


def test_hibrido_prefere_local(regra):
    nuvem, local = JuizFixo(), JuizFixo()
    sel = SeletorDeJuiz("hibrido", nuvem=nuvem, local=local)

    assert sel.para(_regra(regra, TipoRegra.ESTADO)) is local


def test_juiz_faltando_diz_exatamente_o_que_configurar(regra):
    sel = SeletorDeJuiz("local")

    with pytest.raises(ErroDoJuiz, match="precisa do juiz"):
        sel.para(_regra(regra, TipoRegra.ESTADO))


def test_modo_invalido_estoura_cedo():
    with pytest.raises(ValueError, match="modo_julgamento"):
        SeletorDeJuiz("qualquer")


def test_por_regra_encaminha_pelo_contexto(regra, imagem):
    local = JuizFixo(Resultado.NAO_CONFORME, confianca=0.9)
    sel = SeletorDeJuiz("local", local=local)
    porta = JuizPorRegra(sel, {regra.id: regra})

    v = porta.julgar(imagem, "c", contexto={"regra_id": regra.id})

    assert v.resultado is Resultado.NAO_CONFORME
    assert local.chamadas == 1


def test_por_regra_sem_regra_id_estoura(imagem):
    porta = JuizPorRegra(SeletorDeJuiz("local", local=JuizFixo()), {})

    with pytest.raises(ErroDoJuiz, match="regra_id"):
        porta.julgar(imagem, "c", contexto={})
