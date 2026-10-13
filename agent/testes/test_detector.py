"""O detector local: presença e contagem, dentro da loja.

Os limiares e as regras daqui não saíram de ficha técnica. Saíram de rodar
o modelo nas câmeras de uma loja de verdade, em 06/10/2026:

- três pessoas na linha de montagem: 0,89, 0,94 e 0,91 — certas;
- um casaco pendurado no corredor: "pessoa" com 0,41 — errado;
- um banquinho: "vaso sanitário" com 0,57 — errado;
- uma pessoa cortada no canto do quadro: não vista.

O que estes testes protegem é a consequência: **casaco não vira alerta**.
"""

from __future__ import annotations

import logging
import sys
from types import SimpleNamespace

import numpy as np
import pytest

from farol_agent import imagens
from farol_agent.juizes.base import ErroDoJuiz
from farol_agent.juizes.detector import (
    CERTEZA,
    DUVIDA,
    MODELO_SHA256,
    OBJETOS,
    REGUA_DA_PLACA,
    JuizDetector,
    MotorOnnx,
    Procura,
    cenas_de_prova,
    decidir,
    distancia_entre_respostas,
    interpretar_saida,
    provar_a_placa,
)
from farol_agent.juizes.seletor import JuizPorRegra, SeletorDeJuiz
from farol_agent.modelos import Resultado, TipoRegra, Via

ALGUEM = Procura("pessoa", minimo=1)                 # "tem que ter alguém no posto"
NINGUEM = Procura("pessoa", minimo=0, maximo=0)      # "ninguém na área restrita"
FILA_ATE_3 = Procura("pessoa", minimo=0, maximo=3)   # "no máximo 3 na fila"


# ─────────────────────── presença: tem que ter ───────────────────────


def test_pessoa_vista_com_certeza_e_conforme():
    r, conf, motivo = decidir([0.94, 0.05], ALGUEM)
    assert r is Resultado.CONFORME
    assert conf == 0.94
    assert "vi 1 pessoa" in motivo


def test_posto_vazio_e_nao_conforme_com_a_confianca_do_vazio():
    # A confiança de "não tem ninguém" é o quanto o modelo descarta o
    # melhor candidato: se o mais parecido com gente tem 0,06, é 0,94.
    r, conf, motivo = decidir([0.06, 0.03], ALGUEM)
    assert r is Resultado.NAO_CONFORME
    assert conf == 0.94
    assert "não vi nenhuma pessoa" in motivo


def test_o_CASACO_nao_vira_pessoa():
    """0,41 foi o casaco pendurado no corredor da loja.

    Sozinho, ele não pode provar que há alguém — e também não pode provar
    que não há. O veredito honesto é "não sei".
    """
    r, _, motivo = decidir([0.41], ALGUEM)
    assert r is Resultado.NAO_AVALIAVEL, "um talvez não é presença nem ausência"
    assert "dúvida" in motivo


def test_imagem_sem_candidato_nenhum_e_ausencia_certa():
    r, conf, _ = decidir([], ALGUEM)
    assert r is Resultado.NAO_CONFORME
    assert conf == 1.0


# ─────────────────────── ausência: não pode ter ───────────────────────


def test_area_restrita_vazia_e_conforme():
    r, conf, _ = decidir([0.04], NINGUEM)
    assert r is Resultado.CONFORME
    assert conf == 0.96


def test_alguem_na_area_restrita_e_nao_conforme():
    r, conf, motivo = decidir([0.91], NINGUEM)
    assert r is Resultado.NAO_CONFORME
    assert conf == 0.91
    assert "nenhuma pessoa" in motivo


def test_o_casaco_tambem_nao_ACUSA_ninguem_na_area_restrita():
    # O mesmo 0,41, na regra inversa. Aqui o erro custaria mais caro: um
    # alerta de "pessoa em área restrita" por causa de roupa pendurada.
    r, _, _ = decidir([0.41], NINGUEM)
    assert r is Resultado.NAO_AVALIAVEL


# ─────────────────────────── contagem ───────────────────────────


def test_fila_dentro_do_limite():
    r, conf, motivo = decidir([0.93, 0.90, 0.10], FILA_ATE_3)
    assert r is Resultado.CONFORME
    assert "vi 2 pessoas" in motivo
    assert conf == pytest.approx(1.0, abs=1e-6), "não há quarto candidato algum"


def test_fila_estourada_com_certeza():
    r, conf, motivo = decidir([0.95, 0.93, 0.90, 0.88], FILA_ATE_3)
    assert r is Resultado.NAO_CONFORME
    # A confiança é a da quarta pessoa — a que estoura o teto.
    assert conf == 0.88
    assert "no máximo 3 pessoas" in motivo


def test_fila_no_limite_com_um_TALVEZ_nao_se_afirma():
    # Três certos e um casaco: são três ou quatro? Depende do casaco.
    r, _, _ = decidir([0.95, 0.93, 0.90, 0.50], FILA_ATE_3)
    assert r is Resultado.NAO_AVALIAVEL


def test_talvez_que_NAO_muda_o_resultado_nao_atrapalha():
    # Um certo e um talvez, teto de três: no pior caso são dois. Conforme.
    r, _, motivo = decidir([0.95, 0.50], FILA_ATE_3)
    assert r is Resultado.CONFORME
    assert "1 em dúvida" in motivo


def test_exatamente_dois():
    dois = Procura("pessoa", minimo=2, maximo=2)
    assert decidir([0.9, 0.9], dois)[0] is Resultado.CONFORME
    assert decidir([0.9], dois)[0] is Resultado.NAO_CONFORME
    assert decidir([0.9, 0.9, 0.9], dois)[0] is Resultado.NAO_CONFORME
    assert decidir([0.9, 0.5], dois)[0] is Resultado.NAO_AVALIAVEL


def test_os_limiares_sao_os_medidos():
    # Se alguém mexer nestes dois números, tem que mexer sabendo de onde
    # eles vieram: 0,83 foi a pessoa mais fraca e 0,57 o erro mais forte.
    assert DUVIDA < 0.41 < 0.57 < CERTEZA <= 0.83


# ──────────────────── o que a regra manda procurar ────────────────────


def test_parametros_do_console_viram_procura():
    p = Procura.de_parametros({"objeto": "Pessoa", "minimo": 1, "maximo": None})
    assert p == Procura("pessoa", 1, None)
    assert p.pedido() == "pelo menos 1 pessoa"


@pytest.mark.parametrize(
    "parametros, trecho",
    [
        ({}, "não diz o que procurar"),
        (None, "não diz o que procurar"),
        ({"objeto": "espátula", "minimo": 1}, "não conhece"),
        ({"objeto": "pessoa"}, "não exige nada"),
        ({"objeto": "pessoa", "minimo": 3, "maximo": 1}, "menor que o mínimo"),
        ({"objeto": "pessoa", "minimo": -1}, "inteiro"),
        ({"objeto": "pessoa", "minimo": 1.5}, "inteiro"),
    ],
)
def test_parametros_ruins_sao_recusados_dizendo_o_que_falta(parametros, trecho):
    with pytest.raises(ErroDoJuiz, match=trecho) as e:
        Procura.de_parametros(parametros)
    # Não melhora repetindo: é cadastro errado, não rede caída.
    assert e.value.recuperavel is False


def test_zero_ou_mais_e_recusado_porque_nunca_reprovaria_nada():
    # A regra pareceria estar auditando e seria verdadeira em qualquer foto.
    with pytest.raises(ErroDoJuiz, match="não exige nada"):
        Procura.de_parametros({"objeto": "copo", "minimo": 0})


def test_todo_objeto_do_vocabulario_existe_no_modelo():
    from farol_agent.juizes.detector import _COCO91

    for nome, classe in OBJETOS.items():
        assert classe in _COCO91, f"{nome!r} aponta para classe que o modelo não tem"


def test_frases_do_pedido_em_portugues():
    assert Procura("pessoa", 0, 0).pedido() == "nenhuma pessoa"
    assert Procura("copo", 0, 0).pedido() == "nenhum copo"
    assert Procura("colher", 0, 0).pedido() == "nenhuma colher"
    assert Procura("pessoa", 0, 3).pedido() == "no máximo 3 pessoas"
    assert Procura("pessoa", 2, 2).pedido() == "exatamente 2 pessoas"
    assert Procura("pessoa", 1, 4).pedido() == "de 1 a 4 pessoas"


# ───────────────────────── a saída do modelo ─────────────────────────


def test_a_saida_bruta_vira_a_lista_da_classe_pedida():
    from farol_agent.juizes.detector import _COCO91

    logits = np.full((1, 300, 91), -8.0, dtype=np.float32)   # tudo ~0
    logits[0, 0, _COCO91.index("person")] = 3.0              # ~0,95
    logits[0, 1, _COCO91.index("person")] = -0.4             # ~0,40
    logits[0, 2, _COCO91.index("cup")] = 4.0                 # não é pessoa

    pessoas = sorted(interpretar_saida(logits, "person"), reverse=True)

    assert len(pessoas) == 2, "o copo não pode entrar na conta de pessoas"
    assert pessoas[0] == pytest.approx(0.953, abs=0.01)
    assert pessoas[1] == pytest.approx(0.401, abs=0.01)


def test_saida_com_formato_estranho_e_erro_e_nao_lista_vazia():
    # Lista vazia seria lida como "não tem ninguém" — com confiança total.
    with pytest.raises(ErroDoJuiz, match="formato inesperado"):
        interpretar_saida(np.zeros((1, 300, 4), dtype=np.float32), "person")


# ───────────────────────────── o juiz ─────────────────────────────


class MotorFixo:
    nome = "fixo"

    def __init__(self, pontuacoes):
        self.pontuacoes = pontuacoes
        self.classes: list[str] = []

    def pontuar(self, imagem_bgr, classe):
        self.classes.append(classe)
        return list(self.pontuacoes)


@pytest.fixture
def foto(tmp_path):
    caminho = tmp_path / "quadro.jpg"
    imagens.escrever(str(caminho), np.full((48, 64, 3), 127, dtype=np.uint8))
    return caminho


def test_o_juiz_devolve_veredito_local_e_de_graca(foto):
    motor = MotorFixo([0.92])
    juiz = JuizDetector(motor)

    v = juiz.julgar(foto, "tem que ter alguém no posto",
                    contexto={"parametros": {"objeto": "pessoa", "minimo": 1}})

    assert v.resultado is Resultado.CONFORME
    assert v.via is Via.DETECTOR
    assert v.custo_centavos == 0.0
    assert v.modelo == "fixo"
    assert motor.classes == ["person"], "o vocabulário do Farol vira a classe do modelo"


def test_o_juiz_IGNORA_o_texto_e_decide_pelo_campo(foto):
    # O texto diz "copo", o campo diz "pessoa". Quem manda é o campo — e é
    # por isso que o campo existe.
    motor = MotorFixo([0.92])
    JuizDetector(motor).julgar(
        foto, "tem copo sujo na bancada",
        contexto={"parametros": {"objeto": "pessoa", "minimo": 1}},
    )
    assert motor.classes == ["person"]


def test_imagem_que_nao_abre_e_erro_e_nao_ausencia(tmp_path):
    with pytest.raises(ErroDoJuiz, match="não consegui ler"):
        JuizDetector(MotorFixo([])).julgar(
            tmp_path / "sumiu.jpg", "x",
            contexto={"parametros": {"objeto": "pessoa", "minimo": 1}},
        )


# ───────────────────── o modelo é o que foi medido ─────────────────────


def test_modelo_ausente_diz_como_instalar(tmp_path):
    with pytest.raises(ErroDoJuiz, match="detector instalar"):
        MotorOnnx(tmp_path / "nao-existe.onnx")


def test_arquivo_que_NAO_e_o_modelo_medido_nao_carrega(tmp_path):
    """Um modelo trocado mudaria o comportamento de todas as regras de
    presença e contagem sem ninguém ter decidido isso."""
    falso = tmp_path / "rfdetr-nano.onnx"
    falso.write_bytes(b"isto nao e o modelo")
    with pytest.raises(ErroDoJuiz, match="não é o modelo medido"):
        MotorOnnx(falso)
    assert len(MODELO_SHA256) == 64


# ─────────────── a placa de vídeo só fica se passar na prova ───────────────
#
# Medido em 13/10/2026 (ERR-112): numa Intel UHD com driver de 2022, a sessão
# abre na placa sem erro e sem aviso, e o modelo responde LIXO — "ninguém" num
# vídeo com 3 a 7 pessoas por quadro, maior nota 0,04. Na RX 560 da loja do
# piloto, a placa responde igual ao processador. O agente confiava na placa
# sempre que a sessão abria.


class _Sessao:
    """Uma sessão de mentira: sabe onde roda e conta quantas vezes rodou."""

    def __init__(self, provedores, responder):
        self._provedores, self._responder, self.rodadas = list(provedores), responder, 0

    def get_providers(self):
        return list(self._provedores)

    def get_inputs(self):
        return [SimpleNamespace(name="pixel_values")]

    def get_outputs(self):
        return [SimpleNamespace(name="pred_boxes"), SimpleNamespace(name="logits")]

    def run(self, nomes, entradas):
        self.rodadas += 1
        assert nomes == ["logits"], nomes
        return [self._responder(entradas["pixel_values"])]


def _certa(tensor):
    """A resposta "de verdade" do modelo de mentira: 300 candidatos x 91
    classes, com números que dependem da entrada — cenas diferentes,
    respostas diferentes; a mesma cena, a mesma resposta."""
    semente = int(float(np.abs(tensor).sum()) * 1000) % (2**32)
    return np.random.default_rng(semente).normal(-4.0, 1.5, (1, 300, 91)).astype(np.float32)


def _lixo(tensor):
    """O caso medido: todo candidato com a mesma nota baixa (0,04), qualquer
    que seja a imagem."""
    return np.full((1, 300, 91), -3.16, np.float32)


def _que_levanta(tensor):
    raise RuntimeError("DmlFusedNode_0_0: status diferente de zero")


def _com_nan(tensor):
    resposta = _certa(tensor)
    resposta[0, 5, 9] = np.nan
    return resposta


def _de_outro_tamanho(tensor):
    return np.zeros((1, 300, 4), np.float32)


class _Ort:
    """O `onnxruntime` de mentira. `da_placa` é o que a placa de vídeo responde."""

    def __init__(
        self, *, provedores=("DmlExecutionProvider", "CPUExecutionProvider"), da_placa=_certa,
        a_placa_abre=True, o_processador_abre=True,
    ):
        self._provedores, self._da_placa = provedores, da_placa
        self._a_placa_abre, self._o_processador_abre = a_placa_abre, o_processador_abre
        self.abertas: list[_Sessao] = []

    def get_available_providers(self):
        return list(self._provedores)

    def InferenceSession(self, caminho, providers=None, **_):  # noqa: N802 — o nome é o da biblioteca
        if providers[0] == "DmlExecutionProvider":
            if not self._a_placa_abre:
                raise RuntimeError("a placa não abriu")
            sessao = _Sessao(["DmlExecutionProvider", "CPUExecutionProvider"], self._da_placa)
        else:
            if not self._o_processador_abre:
                raise RuntimeError("sem memória para a segunda sessão")
            sessao = _Sessao(["CPUExecutionProvider"], _certa)
        self.abertas.append(sessao)
        return sessao

    def de(self, provedor):
        return [s for s in self.abertas if s.get_providers()[0] == provedor]


def _motor(monkeypatch, tmp_path, ort):
    monkeypatch.setitem(sys.modules, "onnxruntime", ort)
    arquivo = tmp_path / "rfdetr-nano.onnx"
    arquivo.write_bytes(b"modelo de mentira")
    return MotorOnnx(arquivo, conferir_sha256=False)


_QUADRO = np.full((480, 704, 3), 77, np.uint8)
# O que o modelo de mentira responde para esse quadro, depois do preparo do agente.
_DO_QUADRO = interpretar_saida(_certa(np.full((1, 3, 384, 384), 77, np.float32) / 255.0), "person")


def test_a_placa_que_responde_igual_ao_processador_fica(monkeypatch, tmp_path, caplog):
    # Igual a menos do arredondamento e da ORDEM das linhas: o modelo escolhe os
    # trezentos candidatos lá dentro, e a placa pode devolvê-los em outra ordem.
    ort = _Ort(da_placa=lambda t: np.roll(_certa(t), 7, axis=1) + np.float32(1e-4))
    with caplog.at_level(logging.WARNING):
        motor = _motor(monkeypatch, tmp_path, ort)

    assert motor.onde == "DmlExecutionProvider"
    assert motor.placa_reprovada is None
    assert caplog.records == []
    (placa,), (processador,) = ort.de("DmlExecutionProvider"), ort.de("CPUExecutionProvider")
    assert (placa.rodadas, processador.rodadas) == (3, 3), "a prova são as três cenas, nas duas"
    motor.pontuar(_QUADRO, "person")
    assert (placa.rodadas, processador.rodadas) == (4, 3), "aprovada, é a placa que roda o detector"


def test_a_placa_que_responde_LIXO_perde_o_detector_para_o_processador(monkeypatch, tmp_path, caplog):
    ort = _Ort(da_placa=_lixo)
    with caplog.at_level(logging.WARNING):
        motor = _motor(monkeypatch, tmp_path, ort)

    assert motor.onde == "CPUExecutionProvider"
    assert "respondeu diferente do processador" in motor.placa_reprovada
    avisos = [r.getMessage() for r in caplog.records]
    assert len(avisos) == 1 and "placa de vídeo" in avisos[0] and "vai rodar no processador" in avisos[0]
    assert motor.placa_reprovada in avisos[0]

    (placa,), (processador,) = ort.de("DmlExecutionProvider"), ort.de("CPUExecutionProvider")
    notas = motor.pontuar(_QUADRO, "person")
    assert (placa.rodadas, processador.rodadas) == (3, 4), "reprovada, a placa não roda mais nada"
    assert notas == _DO_QUADRO and len(notas) > 0, "e a resposta é a do processador"


@pytest.mark.parametrize(
    "da_placa, trecho",
    [
        (_que_levanta, "não conseguiu rodar a prova (RuntimeError)"),
        (_de_outro_tamanho, "não conseguiu rodar a prova (ValueError)"),
        (_com_nan, "respondeu diferente do processador (diferença nan"),
    ],
)
def test_a_placa_que_nao_roda_a_prova_ou_responde_NaN_tambem_perde(monkeypatch, tmp_path, da_placa, trecho):
    motor = _motor(monkeypatch, tmp_path, _Ort(da_placa=da_placa))

    assert motor.onde == "CPUExecutionProvider"
    assert trecho in motor.placa_reprovada
    assert motor.pontuar(_QUADRO, "person") == _DO_QUADRO


@pytest.mark.parametrize("qual", [0, 1, 2])
def test_basta_UMA_cena_errada_para_reprovar(monkeypatch, tmp_path, qual):
    vez = iter(range(3))

    def so_erra_numa(tensor):
        return _lixo(tensor) if next(vez) == qual else _certa(tensor)

    motor = _motor(monkeypatch, tmp_path, _Ort(da_placa=so_erra_numa))

    assert motor.onde == "CPUExecutionProvider", f"errou só na cena {qual + 1} e ficou"


@pytest.mark.parametrize("fator, fica", [(0.9, True), (1.1, False)])
def test_a_regua_e_a_medida(monkeypatch, tmp_path, fator, fica):
    """Placa certa: 0,00001. Placa com lixo: de 1,25 a 2,18. A régua fica no
    meio, longe das duas — e é com ela que a placa é julgada."""
    assert REGUA_DA_PLACA == 0.05
    desvio = np.float32(REGUA_DA_PLACA * fator)

    motor = _motor(monkeypatch, tmp_path, _Ort(da_placa=lambda t: _certa(t) + desvio))

    assert (motor.onde == "DmlExecutionProvider") is fica
    assert (motor.placa_reprovada is None) is fica


def test_sem_placa_nao_tem_prova_nem_segunda_sessao(monkeypatch, tmp_path, caplog):
    ort = _Ort(provedores=("CPUExecutionProvider",))
    with caplog.at_level(logging.WARNING):
        motor = _motor(monkeypatch, tmp_path, ort)

    assert motor.onde == "CPUExecutionProvider" and motor.placa_reprovada is None
    assert len(ort.abertas) == 1 and ort.abertas[0].rodadas == 0
    assert caplog.records == []


def test_a_placa_que_nem_abre_cai_no_processador_como_sempre(monkeypatch, tmp_path, caplog):
    ort = _Ort(a_placa_abre=False)
    with caplog.at_level(logging.WARNING):
        motor = _motor(monkeypatch, tmp_path, ort)

    assert motor.onde == "CPUExecutionProvider"
    # Não abriu é outra história, e já era tratada: não é "reprovada na prova".
    assert motor.placa_reprovada is None
    assert len(ort.abertas) == 1 and ort.abertas[0].rodadas == 0
    assert ["não abriu na placa de vídeo" in r.getMessage() for r in caplog.records] == [True]


def test_sem_o_processador_para_comparar_a_placa_fica_e_o_registro_diz(monkeypatch, tmp_path, caplog):
    ort = _Ort(da_placa=_lixo, o_processador_abre=False)
    with caplog.at_level(logging.WARNING):
        motor = _motor(monkeypatch, tmp_path, ort)

    assert motor.onde == "DmlExecutionProvider" and motor.placa_reprovada is None
    assert ["sem a prova" in r.getMessage() for r in caplog.records] == [True]


def test_as_cenas_de_prova_sao_tres_sempre_as_mesmas_no_formato_do_modelo():
    primeira, segunda = cenas_de_prova(), cenas_de_prova()

    assert len(primeira) == 3
    for a, b in zip(primeira, segunda):
        assert a.shape == (1, 3, 384, 384) and a.dtype == np.float32
        assert 0.0 <= float(a.min()) and float(a.max()) <= 1.0
        assert np.array_equal(a, b)
    ruido, blocos, liso = primeira
    assert float(liso.std()) == 0.0 and float(ruido.std()) > 0.1 and float(blocos.std()) > 0.1
    assert not np.array_equal(ruido, blocos)


def test_a_distancia_nao_liga_para_a_ordem_das_linhas_e_acusa_o_lixo():
    certa = _certa(cenas_de_prova()[0])

    assert distancia_entre_respostas(np.roll(certa, 11, axis=1), certa) == 0.0
    assert distancia_entre_respostas(certa + np.float32(0.25), certa) == pytest.approx(0.25, abs=1e-4)
    assert distancia_entre_respostas(_lixo(None), certa) > 1.0
    # É a MÉDIA, e não o pior número: um candidato fora, entre 27.300, não reprova ninguém.
    com_um_fora = certa.copy()
    com_um_fora[0, 0, 0] += 10.0
    assert distancia_entre_respostas(com_um_fora, certa) < 0.001
    assert np.isnan(distancia_entre_respostas(_com_nan(cenas_de_prova()[0]), certa))
    with pytest.raises(ValueError):
        distancia_entre_respostas(certa[:, :10], certa)
    with pytest.raises(ValueError):
        distancia_entre_respostas(np.zeros(0), np.zeros(0))


def test_a_prova_devolve_a_MAIOR_distancia_e_o_NaN_nao_some():
    processador = _Sessao(["CPUExecutionProvider"], _certa)
    desvios = iter([0.01, 0.30, 0.02])
    placa = _Sessao(["DmlExecutionProvider"], lambda t: _certa(t) + np.float32(next(desvios)))
    assert provar_a_placa(placa, processador) == pytest.approx(0.30, abs=1e-4)

    # NaN só na SEGUNDA cena, e as outras certas: num `max` ingênuo ele sumiria
    # (o `max` só fica com o NaN quando ele é o primeiro da lista).
    vez = iter([False, True, False])
    placa = _Sessao(["DmlExecutionProvider"], lambda t: _com_nan(t) if next(vez) else _certa(t))
    assert np.isnan(provar_a_placa(placa, processador))


@pytest.mark.parametrize("da_placa, reprovada", [(_lixo, True), (_certa, False)])
def test_cli_instalar_diz_quando_a_placa_foi_reprovada(monkeypatch, tmp_path, capsys, da_placa, reprovada):
    # Dito na instalação, que é quando tem alguém olhando a tela.
    from farol_agent.cli import main
    from farol_agent.juizes import detector

    arquivo = tmp_path / "rfdetr-nano.onnx"
    arquivo.write_bytes(b"modelo de mentira")
    monkeypatch.setattr(detector, "instalar_modelo", lambda pasta: arquivo)
    monkeypatch.setattr(detector, "MODELO_SHA256", detector.sha256_de(arquivo))
    monkeypatch.setitem(sys.modules, "onnxruntime", _Ort(da_placa=da_placa))

    assert main(["detector", "instalar", "--pasta", str(tmp_path)]) == 0

    saida = capsys.readouterr().out
    assert ("roda em CPUExecutionProvider" in saida) is reprovada
    assert ("roda em DmlExecutionProvider" in saida) is not reprovada
    assert ("a placa de vídeo desta máquina respondeu diferente do processador" in saida) is reprovada
    assert ("o detector roda no processador" in saida) is reprovada


# ─────────────────── quem julga presença e contagem ───────────────────


def _regra(regra, tipo, parametros):
    from dataclasses import replace

    return replace(regra, tipo=tipo, parametros=parametros)


def test_presenca_com_os_campos_vai_para_o_detector(regra):
    detector = JuizDetector(MotorFixo([0.9]))
    seletor = SeletorDeJuiz("hibrido", detector=detector)
    r = _regra(regra, TipoRegra.PRESENCA, {"objeto": "pessoa", "minimo": 1})

    assert seletor.para(r) is detector


def test_presenca_SEM_os_campos_e_recusada_na_escolha_do_juiz(regra):
    """Na MONTAGEM, não na hora de julgar.

    Se o detector aceitasse a regra e só falhasse ao julgar, o agente
    capturaria, gravaria e falharia a cada trinta segundos (ERR-014).
    """
    seletor = SeletorDeJuiz("hibrido", detector=JuizDetector(MotorFixo([])))
    r = _regra(regra, TipoRegra.PRESENCA, {})

    with pytest.raises(ErroDoJuiz, match="não diz o que procurar"):
        seletor.para(r)


def test_presenca_NAO_vai_para_a_nuvem_nem_com_o_detector_ausente(regra):
    class Nuvem:
        nome = "nuvem"

    seletor = SeletorDeJuiz("nuvem", nuvem=Nuvem())
    r = _regra(regra, TipoRegra.CONTAGEM, {"objeto": "pessoa", "maximo": 3})

    with pytest.raises(ErroDoJuiz, match="detector, binario ou local"):
        seletor.para(r)


def test_os_campos_que_valem_sao_os_da_regra_de_AGORA(regra, foto):
    # A análise ficou na fila com o contexto antigo; o dono corrigiu "o que
    # procurar" no console. O julgamento usa a correção.
    motor = MotorFixo([0.9])
    r = _regra(regra, TipoRegra.PRESENCA, {"objeto": "copo", "minimo": 1})
    juiz = JuizPorRegra(SeletorDeJuiz("hibrido", detector=JuizDetector(motor)), {r.id: r})

    juiz.julgar(foto, "x", contexto={"regra_id": r.id, "parametros": {"objeto": "pessoa", "minimo": 1}})

    assert motor.classes == ["cup"]


# ───────────────────────── a linha de comando ─────────────────────────


def test_cli_lista_o_vocabulario(capsys):
    from farol_agent.cli import main

    assert main(["detector", "objetos"]) == 0
    saida = capsys.readouterr().out
    assert "pessoa" in saida and "copo" in saida


def test_cli_sem_modelo_instalado_diz_o_comando_que_resolve(tmp_path, capsys):
    # A mensagem aponta um comando. O comando tem que existir — já apontei
    # uma vez para uma variável de ambiente que não existia.
    from farol_agent.cli import main

    codigo = main(["detector", "olhar", "--pasta", str(tmp_path), "--imagem", "x.jpg"])

    assert codigo == 1
    assert "farol-agent detector instalar" in capsys.readouterr().err


def test_cli_NAO_julga_a_tela_de_sem_sinal(tmp_path, capsys):
    """Na loja, em 06/10/2026, `detector olhar` respondeu `nao_conforme`
    com 0,96 para a tela preta do gravador: "não vi nenhuma pessoa".

    Em serviço o motor barra esse quadro antes do juiz. O diagnóstico
    pulava a porta — e mostrava um alerta que o agente não daria.

    A pasta do modelo está VAZIA: se o comando consultasse o detector,
    sairia com erro de modelo ausente. Sair com `nao_avaliavel` prova que
    o quadro foi barrado antes.
    """
    from pathlib import Path

    from farol_agent.cli import main

    amostra = Path(__file__).parent / "amostras" / "mhdx-sem-sinal.jpg"
    codigo = main(["detector", "olhar", "--pasta", str(tmp_path), "--imagem", str(amostra)])

    saida = capsys.readouterr()
    assert codigo == 0
    assert "nao_avaliavel" in saida.out
    assert "preto" in saida.out
    assert "nao_conforme" not in saida.out
    assert saida.err == ""


def test_cli_recusa_objeto_desconhecido_antes_de_olhar_a_imagem(tmp_path, capsys):
    # A ordem importa: sem isto, a tela de sem-sinal responderia
    # "nao_avaliavel" para um objeto que o detector nem conhece.
    from pathlib import Path

    from farol_agent.cli import main

    amostra = Path(__file__).parent / "amostras" / "mhdx-sem-sinal.jpg"
    codigo = main(
        ["detector", "olhar", "--pasta", str(tmp_path), "--imagem", str(amostra),
         "--objeto", "espatula"]
    )

    saida = capsys.readouterr()
    assert codigo == 1
    assert "espatula" in saida.err
    assert "nao_avaliavel" not in saida.out


# ─────────── o contrato com a nuvem: o mesmo arquivo que a API lê ───────────


def _contrato():
    import json
    from pathlib import Path

    caminho = Path(__file__).resolve().parents[2] / "contratos" / "objetos-do-detector.json"
    assert caminho.is_file(), f"contrato não encontrado em {caminho}"
    return json.loads(caminho.read_text(encoding="utf-8"))


def test_o_vocabulario_do_agente_e_o_do_contrato():
    """A API valida o cadastro com esta mesma lista (api/testes/detector.test.ts).

    Se as duas divergirem, o console aceita um critério que o agente recusa
    — e só o log do PC da loja fica sabendo (a forma do ERR-018).
    """
    assert sorted(OBJETOS) == sorted(_contrato()["objetos"])


def test_todo_exemplo_do_contrato_e_aceito_pelo_agente():
    for exemplo in _contrato()["exemplos"]:
        Procura.de_parametros(exemplo)


def test_todo_recusado_do_contrato_e_recusado_pelo_agente():
    for ruim in _contrato()["recusados"]:
        with pytest.raises(ErroDoJuiz):
            Procura.de_parametros(ruim)
