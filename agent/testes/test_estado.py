"""O estado do critério: observar → ensaiar → medir → avisar (A19, onda 1).

Pedido do dono (08/10/2026): "nada de aplicar alterações antes de o projeto
analisar de verdade os processos". Todo critério passa por quatro estados, e
só o último avisa. O que se protege aqui:

- **observando** conta a olhada e para: nada é gravado, ninguém é
  perguntado, nada é gasto — e não precisa de juiz. Nem o que já estava na
  fila quando o critério desceu é julgado;
- **em ensaio** (e **medido**) é julgado e contado, e NUNCA vira aviso: nem
  alerta, nem evento para a nuvem, nem silêncio;
- **valendo** é como todo critério sempre funcionou;
- o agente diz à nuvem que sabe lidar com isso — é o que impede um critério
  em ensaio de virar aviso num agente antigo;
- estado que o agente não conhece cai do lado em que ninguém é avisado.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import replace
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pytest

from farol_agent import nuvem as cliente_da_nuvem
from farol_agent.auditoria import Auditoria
from farol_agent.configuracao import de_json
from farol_agent.contrato import resumo_para_nuvem
from farol_agent.fila import CONTADORES_DO_RESUMO, Fila
from farol_agent.juizes.base import ErroDoJuiz
from farol_agent.modelos import ESTADO_DE_SEMPRE, ESTADOS, EventoGatilho, Frame, Regra, Resultado, TipoRegra
from farol_agent.motor import MotorDeRegras
from testes.conftest import BASE, JuizFixo

from .test_auditoria import FonteBoa, JuizDeTeste, NuvemDeTeste
from .test_configuracao import resposta

CONTRATO = json.loads((Path(__file__).resolve().parents[2] / "contratos" / "estado-do-criterio.json").read_text(encoding="utf-8"))
TERCA_MEIO_DIA = datetime(2026, 10, 6, 12, 0, 0)


@pytest.fixture
def fila(tmp_path):
    f = Fila(tmp_path / "fila.db")
    yield f
    f.fechar()


def olhar(motor: MotorDeRegras, fonte, ts: datetime):
    return motor.preparar(EventoGatilho(ponto_id=fonte.ponto_id, ts=ts), fonte)


def julgar(motor: MotorDeRegras, juiz, ts: datetime):
    return motor.processar(juiz, ts + timedelta(seconds=2), limite=50)


def a_linha(fila: Fila, regra_id: str = "r1") -> dict:
    (linha,) = [dict(l) for l in fila._con.execute("select * from resumo_hora where regra_id = ?", (regra_id,))]
    return linha


def no_spool(fila: Fila) -> list[str]:
    return sorted(p.name for p in fila.spool.glob("*.jpg"))


# ══════════════════════════ o contrato ══════════════════════════


def test_os_estados_sao_os_do_contrato(regra):
    # A API lê o MESMO arquivo (api/testes/estado.test.ts).
    assert list(ESTADOS) == CONTRATO["estados"] == ["observando", "ensaio", "medido", "valendo"]
    assert ESTADO_DE_SEMPRE == CONTRATO["deSempre"] == "valendo"
    assert [e for e in ESTADOS if replace(regra, estado=e).julga] == CONTRATO["julga"]
    assert [e for e in ESTADOS if replace(regra, estado=e).avisa] == CONTRATO["avisa"]
    assert Regra.__dataclass_fields__["estado"].default == "valendo", "regra montada sem dizer nada funciona como sempre"


def test_o_agente_diz_a_nuvem_que_sabe_lidar_com_estados(monkeypatch):
    assert CONTRATO["sabe"] in cliente_da_nuvem.SABE
    pedidos = []

    class Resposta:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b'{"versao": 7}'

    def abrir(req, timeout=None):
        pedidos.append(req.full_url)
        return Resposta()

    monkeypatch.setattr("urllib.request.urlopen", abrir)
    cliente_da_nuvem.ClienteNuvem("https://api.exemplo", "tok").configuracao()
    assert pedidos == ["https://api.exemplo/v1/agentes/configuracao?sabe=" + ",".join(cliente_da_nuvem.SABE)]
    assert pedidos[0].endswith("?sabe=estados")


def test_o_estado_desce_na_configuracao_e_o_que_nao_se_conhece_nao_avisa(caplog):
    def com(estado):
        corpo = resposta()
        regra = corpo["pontos"][0]["zonas"][0]["regras"][0]
        if estado is not ...:
            regra["estado"] = estado
        return de_json(corpo).regras[0]

    assert com(CONTRATO["configuracao"]["regra"]["estado"]).estado == "ensaio"
    for estado in ESTADOS:
        assert com(estado).estado == estado
    # Nuvem antiga não manda: vale como sempre valeu.
    for nada in (..., None, ""):
        assert com(nada).estado == "valendo"
    # Estado que a nuvem ganhe depois: a configuração não cai, e o critério não avisa nem gasta.
    with caplog.at_level("WARNING", logger="farol_agent.configuracao"):
        futuro = com("em_revisao")
    assert (futuro.estado, futuro.julga, futuro.avisa) == ("observando", False, False)
    assert "estado='em_revisao' desconhecido" in caplog.text


# ══════════════════════════ observando ══════════════════════════


def test_observando_conta_a_olhada_e_para_ali(fila, regra, fonte):
    motor = MotorDeRegras(fila, [replace(regra, estado="observando")])
    juiz = JuizFixo(Resultado.NAO_CONFORME, confianca=0.99)

    preparo = olhar(motor, fonte, BASE)
    alertas = julgar(motor, juiz, BASE)

    assert (preparo.observadas, preparo.enfileirados) == (["r1"], [])
    assert alertas == [] and juiz.chamadas == 0, "ninguém foi perguntado"
    assert no_spool(fila) == [], "nada foi gravado no disco"
    assert fila.resumo() == {}, "nada entrou na fila"
    linha = a_linha(fila)
    assert (linha["capturas"], linha["observadas"], linha["enfileiradas"]) == (1, 1, 0)
    assert sum(linha[c] for c in ("conformes", "nao_conformes", "nao_avaliaveis", "falhas", "alertas")) == 0
    assert linha["custo_centavos"] == 0

    # Toda olhada conta — a cena igual à anterior também: não há "repetida" para quem não julga.
    olhar(motor, fonte, BASE)
    olhar(motor, fonte, BASE + timedelta(seconds=30))
    assert (a_linha(fila)["capturas"], a_linha(fila)["observadas"], a_linha(fila)["repetidas"]) == (3, 3, 0)


def test_observando_o_contexto_continua_valendo(fila, regra, fonte):
    # O porteiro é o "o que precisa estar acontecendo": sem ele, a olhada não é observada, é "nada a conferir".
    from farol_agent.porteiro import Porteiro

    class Detector:
        pontos = [0.0]

        def pontuar(self, imagem, classe):
            return list(self.pontos)

    detector = Detector()
    com_gente = replace(regra, estado="observando", porteiro="pessoa")
    motor = MotorDeRegras(fila, [com_gente], porteiro=Porteiro(detector))

    olhar(motor, fonte, BASE)                                   # ninguém na área
    detector.pontos = [0.9]
    olhar(motor, fonte, BASE + timedelta(seconds=30))           # alguém

    linha = a_linha(fila)
    assert (linha["capturas"], linha["sem_condicao"], linha["observadas"]) == (2, 1, 1)


def test_observando_a_camera_parada_aparece_como_camera_parada(fila, regra):
    # Tela de sem sinal não é "observada": é defeito de câmera, e tem de aparecer como tal.
    class SemSinal:
        ponto_id = "ponto-teste"

        def rajada(self, ts, quantidade=6, stream="main"):
            return [Frame(np.zeros((480, 640, 3), dtype=np.uint8), ts, self.ponto_id) for _ in range(quantidade)]

    motor = MotorDeRegras(fila, [replace(regra, estado="observando")])
    preparo = olhar(motor, SemSinal(), BASE)
    assert preparo.sem_cena == ["r1"] and preparo.observadas == []
    assert (a_linha(fila)["sem_cena"], a_linha(fila)["observadas"]) == (1, 0)


@pytest.mark.parametrize("tipo", [TipoRegra.PRESENCA, TipoRegra.CONTAGEM])
def test_presenca_e_contagem_em_observando_tambem_nao_sao_julgadas(fila, regra, fonte, tipo):
    da_loja = replace(regra, tipo=tipo, estado="observando", parametros={"objeto": "pessoa", "minimo": 1})
    motor = MotorDeRegras(fila, [da_loja])
    juiz = JuizFixo(Resultado.CONFORME)
    for volta in range(3):
        olhar(motor, fonte, BASE + timedelta(seconds=30 * volta))
    julgar(motor, juiz, BASE + timedelta(seconds=90))
    assert juiz.chamadas == 0 and no_spool(fila) == []
    assert (a_linha(fila)["capturas"], a_linha(fila)["observadas"]) == (3, 3)


@pytest.mark.parametrize("antes", ["ensaio", "valendo"])
def test_o_que_ja_estava_na_fila_nao_e_julgado_depois_que_o_criterio_passa_a_observar(fila, regra, fonte, antes):
    # A olhada entrou na fila com o critério julgando; antes de chegar a vez dela, alguém o desceu para
    # "observando". Quem só observa não julga e não gasta — nem o que já estava esperando.
    juiz = JuizFixo(Resultado.NAO_CONFORME, confianca=0.99)
    julgando = MotorDeRegras(fila, [replace(regra, estado=antes)])
    assert olhar(julgando, fonte, BASE).enfileirados == ["r1"]

    observando = MotorDeRegras(fila, [replace(regra, estado="observando")])
    assert julgar(observando, juiz, BASE) == []
    assert juiz.chamadas == 0, "ninguém foi perguntado"
    linha = a_linha(fila)
    assert sum(linha[c] for c in ("conformes", "nao_conformes", "nao_avaliaveis", "falhas", "alertas")) == 0
    assert linha["custo_centavos"] == 0
    (item,) = [dict(l) for l in fila._con.execute("select estado, erro from analise")]
    assert item == {"estado": "pendente", "erro": "o critério só observa"}, "fica de lado, e diz por quê"

    # Voltou a ensaio antes de a olhada vencer: aí ela é julgada — e continua sem avisar.
    de_volta = MotorDeRegras(fila, [replace(regra, estado="ensaio")])
    assert julgar(de_volta, juiz, BASE + timedelta(minutes=1)) == []
    assert juiz.chamadas == 1
    assert (a_linha(fila)["nao_conformes"], a_linha(fila)["alertas"]) == (1, 0)


# ══════════════════════════ em ensaio e medido ══════════════════════════


@pytest.mark.parametrize("estado", ["ensaio", "medido"])
def test_em_ensaio_e_julgado_e_contado_e_nunca_vira_aviso(fila, regra, fonte, estado):
    serializados = []
    motor = MotorDeRegras(fila, [replace(regra, estado=estado)], serializar=lambda a: serializados.append(a) or {"k": a.chave})
    juiz = JuizFixo(Resultado.NAO_CONFORME, confianca=0.99)

    olhar(motor, fonte, BASE)
    alertas = julgar(motor, juiz, BASE)

    assert juiz.chamadas == 1, "foi julgado"
    assert alertas == [] and serializados == [], "e não avisou ninguém"
    assert fila.eventos_a_subir() == [], "nada para subir como evento"
    assert fila.ultimo_alerta("r1", "z1") is None, "nem silêncio foi registrado"
    linha = a_linha(fila)
    assert (linha["capturas"], linha["enfileiradas"], linha["nao_conformes"], linha["alertas"], linha["observadas"]) == (1, 1, 1, 0, 0)
    assert linha["ultimo_resultado"] == "nao_conforme", "o veredito aparece no resumo: é o 'julga e mostra'"


def test_em_ensaio_nao_ha_silencio_cada_cena_nova_e_julgada(fila, regra, fonte):
    # Valendo, o critério se cala por 15 minutos depois de avisar. Em ensaio não há aviso, e por
    # isso não há silêncio: é assim que se juntam os exemplos para medir.
    motor = MotorDeRegras(fila, [replace(regra, estado="ensaio", cooldown_min=15)])
    juiz = JuizFixo(Resultado.NAO_CONFORME, confianca=0.99)
    for minuto in (0, 1, 2):
        ts = BASE + timedelta(minutes=minuto)
        olhar(motor, fonte, ts)
        assert julgar(motor, juiz, ts) == []
    assert juiz.chamadas == 3
    assert (a_linha(fila)["nao_conformes"], a_linha(fila)["em_silencio"], a_linha(fila)["alertas"]) == (3, 0, 0)


def test_quem_avisou_valendo_e_passou_a_ensaio_nao_fica_calado(fila, regra, fonte):
    # O aviso de quando valia deixou um silêncio de 15 minutos na fila. Em ensaio ele não vale mais.
    juiz = JuizFixo(Resultado.NAO_CONFORME, confianca=0.99)
    valendo = MotorDeRegras(fila, [replace(regra, cooldown_min=15)])
    olhar(valendo, fonte, BASE)
    assert len(julgar(valendo, juiz, BASE)) == 1
    olhar(valendo, fonte, BASE + timedelta(minutes=1))
    assert a_linha(fila)["em_silencio"] == 1, "valendo, a olhada seguinte fica no silêncio"

    em_ensaio = MotorDeRegras(fila, [replace(regra, cooldown_min=15, estado="ensaio")])
    preparo = olhar(em_ensaio, fonte, BASE + timedelta(minutes=2))
    assert preparo.enfileirados == ["r1"] and preparo.em_silencio == []
    assert julgar(em_ensaio, juiz, BASE + timedelta(minutes=2)) == []
    assert juiz.chamadas == 2


def test_em_ensaio_o_avisar_so_se_continuar_nao_guarda_nada(fila, regra, fonte):
    motor = MotorDeRegras(fila, [replace(regra, estado="ensaio", confirmar_em=2, cooldown_min=0)])
    juiz = JuizFixo(Resultado.NAO_CONFORME, confianca=0.99)
    for minuto in (0, 1, 2, 3):
        ts = BASE + timedelta(minutes=minuto)
        olhar(motor, fonte, ts)
        assert julgar(motor, juiz, ts) == []
    assert motor._seguidas == {} and motor._confirmados == []


def test_valendo_continua_como_sempre(fila, regra, fonte):
    assert regra.estado == "valendo"
    serializados = []
    motor = MotorDeRegras(fila, [regra], serializar=lambda a: serializados.append(a) or {"idempotenciaKey": a.chave})
    juiz = JuizFixo(Resultado.NAO_CONFORME, confianca=0.99)
    olhar(motor, fonte, BASE)
    (alerta,) = julgar(motor, juiz, BASE)
    assert alerta.regra_id == "r1" and len(serializados) == 1
    assert len(fila.eventos_a_subir()) == 1
    assert (a_linha(fila)["nao_conformes"], a_linha(fila)["alertas"]) == (1, 1)


# ══════════════════════════ o resumo que sobe ══════════════════════════


def test_observadas_e_um_contador_do_resumo_e_sobe_com_ele(fila, regra, fonte):
    assert "observadas" in CONTADORES_DO_RESUMO
    motor = MotorDeRegras(fila, [replace(regra, estado="observando")])
    olhar(motor, fonte, BASE)
    olhar(motor, fonte, BASE + timedelta(seconds=30))

    (linha,) = fila.resumos_a_subir()
    corpo = resumo_para_nuvem(linha)
    assert (corpo["capturas"], corpo["observadas"]) == (2, 2)
    desfechos = ("semJuiz", "semQuadro", "semCena", "semCondicao", "observadas", "emSilencio", "repetidas", "jaJulgadas", "enfileiradas")
    assert sum(corpo[d] for d in desfechos) == corpo["capturas"], "a conta das olhadas fecha com o desfecho novo"
    # O pior caso para quem valida do outro lado: a hora em que o critério SÓ observou.
    assert (corpo["conformes"], corpo["naoConformes"], corpo["naoAvaliaveis"], corpo["falhas"], corpo["alertas"]) == (0, 0, 0, 0, 0)
    assert (corpo["somaConfianca"], corpo["comConfianca"], corpo["custoCentavos"]) == (0, 0, 0)
    assert (corpo["ultimoResultado"], corpo["ultimaEm"]) == (None, None)


def test_a_fila_de_uma_loja_que_ja_existe_ganha_a_coluna(tmp_path, regra, fonte):
    # A fila da loja foi criada antes deste contador: abrir com o agente novo tem de acrescentá-lo.
    caminho = tmp_path / "fila.db"
    nova = Fila(caminho)
    nova.fechar()
    con = sqlite3.connect(caminho)
    con.execute("alter table resumo_hora drop column observadas")
    con.commit()
    assert "observadas" not in [l[1] for l in con.execute("pragma table_info(resumo_hora)")]
    con.close()

    fila = Fila(caminho)
    try:
        motor = MotorDeRegras(fila, [replace(regra, estado="observando")])
        olhar(motor, fonte, BASE)
        assert a_linha(fila)["observadas"] == 1
    finally:
        fila.fechar()


# ══════════════════════════ pela auditoria ══════════════════════════


def tres_estados(versao=5) -> dict:
    """O canal de teste com três critérios iguais, um em cada estado que a loja pode ter hoje."""
    corpo = resposta(versao=versao)
    zona = corpo["pontos"][0]["zonas"][0]
    base = zona["regras"][0]
    zona["regras"] = [
        {**base, "id": "obs", "nome": "só observa", "estado": "observando"},
        {**base, "id": "ens", "nome": "em ensaio", "estado": "ensaio"},
        {**base, "id": "val", "nome": "valendo", "estado": "valendo"},
    ]
    return corpo


def test_tres_criterios_no_mesmo_canal_cada_um_faz_o_que_o_seu_estado_manda(tmp_path):
    nuvem, juiz = NuvemDeTeste(), JuizDeTeste()          # o juiz de teste responde sempre "fora do critério"
    a = Auditoria(
        nuvem, str(tmp_path / "fila.db"),
        construir_fonte=lambda ponto: FonteBoa(ponto.id), construir_juiz=lambda cfg: juiz, medidor=None,
    )
    a.montar(de_json(tres_estados()))

    r = a.passo(TERCA_MEIO_DIA)

    assert juiz.chamadas == 2, "o que observa não foi perguntado"
    assert (r["enfileirados"], r["alertas"], r["subidos"]) == (2, 1, 1), "só o que vale avisou"
    assert [e["regraId"] for e in nuvem.eventos] == ["val"]
    por_criterio = {l["regra_id"]: dict(l) for l in a.fila._con.execute("select * from resumo_hora")}
    assert {k: (l["observadas"], l["nao_conformes"], l["alertas"]) for k, l in por_criterio.items()} == {
        "obs": (1, 0, 0), "ens": (0, 1, 0), "val": (0, 1, 1),
    }
    (subido,) = nuvem.resumos_enviados
    assert {x["regraId"]: x["observadas"] for x in subido["resumos"]} == {"obs": 1, "ens": 0, "val": 0}
    assert len(no_spool(a.fila)) == 2
    a.parar()


def test_criterio_que_so_observa_nao_precisa_de_juiz(tmp_path, monkeypatch):
    # Sem a chave da nuvem, o critério de estado não tem quem o julgue: o que julga fica de fora
    # (e o console diz por quê); o que só observa segue contando.
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    corpo = tres_estados()
    a = Auditoria(NuvemDeTeste(), str(tmp_path / "fila.db"), construir_fonte=lambda ponto: FonteBoa(ponto.id), medidor=None)
    a.montar(de_json(corpo))

    assert sorted(r.id for r, _ in a.sem_juiz) == ["ens", "val"]
    assert [r.id for r in a.motor.regras] == ["obs"]
    assert list(a.fontes) == ["p1"], "a câmera é aberta para quem observa"

    a.passo(TERCA_MEIO_DIA)
    por_criterio = {l["regra_id"]: dict(l) for l in a.fila._con.execute("select * from resumo_hora")}
    assert (por_criterio["obs"]["observadas"], por_criterio["obs"]["sem_juiz"]) == (1, 0)
    assert (por_criterio["ens"]["sem_juiz"], por_criterio["val"]["sem_juiz"]) == (1, 1)
    a.parar()


def test_o_vigia_nao_da_olhada_extra_em_quem_so_observa(tmp_path):
    from farol_agent.juizes.detector import JuizDetector

    class MotorFixo:
        nome, onde = "fixo", "teste"

        def pontuar(self, imagem, classe):
            return [0.95]

    def com_presenca(estado: str) -> dict:
        corpo = resposta(versao=3 if estado == "observando" else 4)
        regra = corpo["pontos"][0]["zonas"][0]["regras"][0]
        regra.update({"tipo": "presenca", "parametros": {"objeto": "pessoa", "minimo": 1}, "estado": estado})
        return corpo

    a = Auditoria(
        NuvemDeTeste(), str(tmp_path / "fila.db"),
        construir_fonte=lambda ponto: FonteBoa(ponto.id), construir_juiz=lambda cfg: JuizDeTeste(Resultado.CONFORME),
        medidor=None,
    )
    a._detector_do_porteiro = lambda: JuizDetector(MotorFixo())

    a.montar(de_json(com_presenca("observando")))
    assert a.vigia is None or not a.vigia.canais, "sem critério julgado, não há o que vigiar"

    a.montar(de_json(com_presenca("ensaio")))
    assert a.vigia is not None and list(a.vigia.canais) == ["p1"], "em ensaio ele é julgado: o vigia volta a olhar"
    a.parar()


def test_a_olhada_extra_do_vigia_e_so_de_quem_e_julgado(tmp_path):
    # O mesmo canal com duas presenças: uma julgada (em ensaio), a outra só observando. O vigia olha
    # o canal por causa da primeira — e a olhada extra não pode contar para a segunda.
    from .test_vigia import MEIO_DIA, DetectorDeMentira, FonteComMenor, JuizQueMede, S, linhas

    corpo = resposta()
    base = corpo["pontos"][0]["zonas"][0]["regras"][0]
    presenca = {**base, "tipo": "presenca", "parametros": {"objeto": "pessoa", "minimo": 1}}
    corpo["pontos"][0]["zonas"][0]["regras"] = [
        {**presenca, "id": "julgada", "nome": "posto ocupado", "estado": "ensaio"},
        {**presenca, "id": "observada", "nome": "posto ocupado (novo)", "estado": "observando"},
    ]
    fonte, juiz = FonteComMenor(), JuizQueMede()
    a = Auditoria(
        NuvemDeTeste(), str(tmp_path / "fila.db"),
        construir_fonte=lambda ponto: fonte, construir_juiz=lambda cfg: juiz, medidor=None,
    )
    a._detector_do_porteiro = lambda: DetectorDeMentira()
    a.montar(de_json(corpo))
    assert a.vigia is not None and a.vigia.canais == ["p1"]

    a.volta(MEIO_DIA)                                        # a rotina: os dois são olhados
    fonte.pessoas = 0                                        # o posto esvaziou
    fonte.agora = MEIO_DIA + 10 * S
    r = a.volta(fonte.agora)

    assert (r["extras"], r["enfileirados"]) == (1, 1), "uma olhada extra, de um critério só"
    por_criterio = linhas(a.fila)
    assert (por_criterio["julgada"]["capturas"], por_criterio["julgada"]["conformes"]) == (2, 2)
    assert (por_criterio["observada"]["capturas"], por_criterio["observada"]["observadas"]) == (1, 1), "a extra não conta para quem só observa"
    a.fila.fechar()


def test_erro_do_juiz_em_ensaio_e_contado_como_falha_e_nao_como_aviso(fila, regra, fonte):
    motor = MotorDeRegras(fila, [replace(regra, estado="ensaio")])
    olhar(motor, fonte, BASE)
    assert julgar(motor, JuizFixo(erro=ErroDoJuiz("a nuvem caiu", recuperavel=True)), BASE) == []
    assert (a_linha(fila)["falhas"], a_linha(fila)["alertas"]) == (1, 0)
