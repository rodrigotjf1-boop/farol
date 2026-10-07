"""O resumo por hora: o que o agente olhou, e no que deu.

Até aqui a nuvem só recebia o "não conforme" que virou alerta. Uma loja
calada no console podia ser cozinha em ordem ou sistema parado — coisas
opostas, com a mesma cara. O resumo é o que separa as duas.

O que se protege aqui:

- cada olhada cai em UM contador, na hora, no critério e no canal certos;
- o número que sobe é o acumulado, e uma soma que chega no meio da subida
  não se perde;
- o corpo que sobe é o de `contratos/resumo-do-agente.json`, lido também
  pelo teste da API;
- nada disso derruba a auditoria nem a subida de eventos.
"""

from __future__ import annotations

import json
import re
import sqlite3
from dataclasses import replace
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pytest

from farol_agent.auditoria import LIMITE_DE_RESUMOS, Auditoria
from farol_agent.configuracao import de_json
from farol_agent.contrato import resumo_para_nuvem
from farol_agent.fila import Fila, sem_segredo
from farol_agent.juizes.base import ErroDoJuiz
from farol_agent.modelos import EventoGatilho, Frame, Resultado, Veredito, Via, Zona
from farol_agent.motor import MotorDeRegras
from farol_agent.nuvem import ErroDaNuvem
from testes.conftest import BASE, JuizFixo

from .test_auditoria import FonteBoa, JuizDeTeste, NuvemDeTeste, dois_canais, montar
from .test_configuracao import resposta

CONTRATO = Path(__file__).resolve().parents[2] / "contratos" / "resumo-do-agente.json"

# Terça-feira ao meio-dia: dentro da janela da regra do dublê de configuração.
MEIO_DIA = datetime(2026, 10, 6, 12, 0, 0)


@pytest.fixture
def fila(tmp_path):
    f = Fila(tmp_path / "fila.db")
    yield f
    f.fechar()


def linha(fila, regra="r1", zona="z1", ts=BASE) -> dict:
    """A linha do resumo daquela hora, critério e canal — ou falha dizendo."""
    achadas = [
        l for l in fila._con.execute("select * from resumo_hora").fetchall()
        if l["hora"] == Fila.hora_de(ts) and l["regra_id"] == regra and l["zona_id"] == zona
    ]
    assert len(achadas) == 1, f"esperava uma linha para {regra}/{zona}, achei {len(achadas)}"
    return dict(achadas[0])


def veredito(resultado=Resultado.CONFORME, confianca=0.9, latencia=800, custo=1.0, motivo="ok"):
    return Veredito(
        resultado=resultado, confianca=confianca, motivo=motivo, via=Via.NUVEM,
        modelo="teste", custo_centavos=custo, latencia_ms=latencia,
    )


# ───────────────────────────── a fila ─────────────────────────────


def test_cada_soma_cai_na_hora_no_criterio_e_no_canal(fila):
    # Dois critérios, dois canais e duas horas: com um só de cada, uma
    # mistura entre eles passaria sem ninguém ver.
    fila.contar(BASE, "r1", "z1", capturas=1, enfileiradas=1)
    fila.contar(BASE + timedelta(minutes=20), "r1", "z1", capturas=1, repetidas=1)
    fila.contar(BASE, "r1", "z2", capturas=1, sem_cena=1)
    fila.contar(BASE, "r2", "z1", capturas=1, sem_juiz=1)
    fila.contar(BASE + timedelta(hours=1), "r1", "z1", capturas=1, em_silencio=1)

    a = linha(fila, "r1", "z1")
    assert (a["capturas"], a["enfileiradas"], a["repetidas"]) == (2, 1, 1)
    assert linha(fila, "r1", "z2")["sem_cena"] == 1
    assert linha(fila, "r2", "z1")["sem_juiz"] == 1
    depois = linha(fila, "r1", "z1", ts=BASE + timedelta(hours=1))
    assert (depois["capturas"], depois["em_silencio"]) == (1, 1)


def test_o_veredito_soma_resultado_confianca_tempo_e_custo(fila):
    fila.contar_veredito(BASE, "r1", "z1", veredito(Resultado.CONFORME, 0.9, 800, 1.0), BASE)
    fila.contar_veredito(
        BASE, "r1", "z1",
        veredito(Resultado.NAO_CONFORME, 0.8, 1200, 1.5, motivo="restos na bancada"),
        BASE + timedelta(seconds=40), alerta=True,
    )
    fila.contar_veredito(BASE, "r1", "z1", veredito(Resultado.NAO_AVALIAVEL, None, None, 0), BASE)

    l = linha(fila)
    assert (l["conformes"], l["nao_conformes"], l["nao_avaliaveis"]) == (1, 1, 1)
    assert l["alertas"] == 1
    assert l["soma_confianca"] == pytest.approx(1.7)
    assert l["com_confianca"] == 2, "veredito sem confiança não entra na média"
    assert (l["soma_latencia_ms"], l["com_latencia"]) == (2000, 2)
    assert l["custo_centavos"] == pytest.approx(2.5)


def test_o_ultimo_resultado_e_o_ultimo_motivo_ficam_guardados(fila):
    fila.contar_veredito(BASE, "r1", "z1", veredito(Resultado.CONFORME, motivo="tudo limpo"), BASE)
    fila.contar_veredito(
        BASE, "r1", "z1", veredito(Resultado.NAO_CONFORME, motivo="restos na bancada"),
        BASE + timedelta(minutes=5),
    )

    l = linha(fila)
    assert l["ultimo_resultado"] == "nao_conforme"
    assert l["ultimo_motivo"] == "restos na bancada"
    assert l["ultima_em"] == (BASE + timedelta(minutes=5)).isoformat(timespec="seconds")


def test_a_soma_que_chega_durante_a_subida_NAO_se_perde(fila):
    """O que impede o resumo de encolher sozinho.

    A linha é lida, o pedido viaja, e nesse meio tempo o agente olha de
    novo. Se a volta do pedido marcasse "a nuvem tem", essa olhada nunca
    subiria — e a nuvem ficaria para sempre uma captura atrás.
    """
    fila.contar(BASE, "r1", "z1", capturas=1, enfileiradas=1)
    lidas = fila.resumos_a_subir()
    assert len(lidas) == 1

    fila.contar(BASE, "r1", "z1", capturas=1, repetidas=1)      # chegou no meio
    fila.marcar_resumos(lidas, estado=0)                        # a nuvem respondeu

    pendentes = fila.resumos_a_subir()
    assert len(pendentes) == 1, "a soma do meio do caminho foi dada como entregue"
    assert pendentes[0]["capturas"] == 2, "o que sobe é o acumulado"

    fila.marcar_resumos(pendentes, estado=0)
    assert fila.resumos_a_subir() == []
    assert fila.resumos_pendentes() == 0


def test_linha_recusada_nao_volta_mesmo_somando_de_novo(fila):
    # A nuvem disse que o critério não é mais desta loja. Somar de novo
    # não muda a resposta; a linha voltaria a cada subida, para sempre.
    fila.contar(BASE, "r1", "z1", capturas=1, enfileiradas=1)
    fila.marcar_resumos(fila.resumos_a_subir(), estado=2)

    fila.contar(BASE, "r1", "z1", capturas=1, repetidas=1)

    assert fila.resumos_a_subir() == []
    assert linha(fila)["capturas"] == 2, "a soma continua local, só não sobe"


def test_limpar_nao_apaga_o_que_ainda_falta_subir(fila):
    velho = BASE - timedelta(days=30)
    fila.contar(velho, "r1", "z1", capturas=1, enfileiradas=1)                    # falta subir
    fila.contar(velho, "r2", "z1", capturas=1, enfileiradas=1)
    fila.marcar_resumos([l for l in fila.resumos_a_subir() if l["regra_id"] == "r2"])
    fila.contar(BASE, "r3", "z1", capturas=1, enfileiradas=1)
    fila.marcar_resumos([l for l in fila.resumos_a_subir() if l["regra_id"] == "r3"])

    apagadas = fila.limpar_resumos(BASE - timedelta(days=15))

    assert apagadas == 1, "só o antigo que a nuvem já tem"
    restam = {(l["regra_id"]) for l in fila._con.execute("select regra_id from resumo_hora")}
    assert restam == {"r1", "r3"}


def test_contador_inventado_e_recusado(fila):
    # O nome vira texto de SQL. Tem que estar na lista fechada.
    with pytest.raises(ValueError):
        fila.contar(BASE, "r1", "z1", coisa_nova=1)


def test_fila_de_versao_antiga_ganha_a_tabela_ao_abrir(tmp_path):
    # Loja em operação já tem fila.db. Atualizar o agente não pode quebrar
    # no primeiro `contar` com "no such table".
    from .test_fila import ESQUEMA_ANTIGO

    caminho = tmp_path / "fila.db"
    con = sqlite3.connect(caminho)
    con.executescript(ESQUEMA_ANTIGO)
    con.execute(
        "insert into alerta (regra_id, zona_id, ts) values ('r-velha','z1','2026-10-01T10:00:00')"
    )
    con.commit()
    con.close()

    f = Fila(caminho)
    f.contar(BASE, "r1", "z1", capturas=1, enfileiradas=1)

    assert f.resumos_pendentes() == 1
    assert f.ultimo_alerta("r-velha") is not None, "o que já estava na fila continua lá"
    f.fechar()


@pytest.mark.parametrize(
    "sujo, proibido",
    [
        ("não abri rtsp://admin:minhasenha123@192.168.0.50:554/cam", "minhasenha123"),
        ("401 da API com a chave sk-ant-EXEMPLOdeCHAVEfalsa0000", "EXEMPLOdeCHAVEfalsa0000"),
        ("falhou: password=segredo-de-teste no pedido", "segredo-de-teste"),
        ("cabeçalho Authorization: Bearer tokenfalso123456 recusado", "tokenfalso123456"),
        ("rtsp://192.168.0.50:554/user=monitor&password=senhadeteste&channel=1", "senhadeteste"),
    ],
)
def test_o_que_parece_segredo_nao_viaja_no_texto(sujo, proibido):
    limpo = sem_segredo(sujo)
    assert proibido not in limpo, f"sobrou segredo em: {limpo}"
    assert limpo, "o resto do texto continua lá: é ele que diz a causa"


def test_o_impedimento_e_gravado_SEM_o_segredo(fila):
    fila.contar(
        BASE, "r1", "z1", capturas=1, sem_quadro=1,
        impedimento="não abri rtsp://admin:minhasenha123@192.168.0.50:554/cam",
    )
    gravado = linha(fila)["ultimo_impedimento"]
    assert "minhasenha123" not in gravado
    assert "192.168.0.50" in gravado, "o endereço ajuda a achar a câmera; a senha não"


def test_texto_comprido_e_cortado():
    assert len(sem_segredo("x" * 5000)) == 300


# ─────────────────────────── o contrato ───────────────────────────


def linha_do_contrato() -> dict:
    """A linha da fila que, serializada, tem que dar exatamente o arquivo."""
    return {
        "hora": "2026-10-07T12:00:00-03:00",
        "regra_id": "00000000-0000-4000-8000-000000000001",
        "zona_id": "00000000-0000-4000-8000-000000000002",
        "capturas": 120,
        "sem_juiz": 0,
        "sem_quadro": 2,
        "sem_cena": 3,
        "em_silencio": 10,
        "repetidas": 80,
        "ja_julgadas": 1,
        "enfileiradas": 24,
        "conformes": 20,
        "nao_conformes": 2,
        "nao_avaliaveis": 1,
        "falhas": 1,
        "alertas": 1,
        "soma_confianca": 19.75,
        "com_confianca": 23,
        "soma_latencia_ms": 20976,
        "com_latencia": 23,
        "custo_centavos": 24.61,
        "julgadas_loja": 3,
        "julgadas_nuvem": 20,
        "ultimo_resultado": "nao_conforme",
        "ultimo_motivo": "há restos de alimento sobre a bancada",
        "ultimo_impedimento": "a câmera entregou a tela de sem sinal",
        "ultima_em": "2026-10-07T12:58:31-03:00",
        "versao": 7,
        "estado": 1,
    }


def test_o_arquivo_de_contrato_existe():
    assert CONTRATO.is_file(), f"contrato não encontrado em {CONTRATO}"


def test_o_resumo_sai_EXATAMENTE_como_o_contrato():
    esperado = json.loads(CONTRATO.read_text(encoding="utf-8"))
    assert resumo_para_nuvem(linha_do_contrato()) == esperado


def test_o_exemplo_do_contrato_fecha_a_conta():
    # O arquivo é exemplo "completo e verdadeiro": os sete desfechos de uma
    # olhada têm que somar as capturas, senão ele ensina a conta errada.
    c = json.loads(CONTRATO.read_text(encoding="utf-8"))
    desfechos = ["semJuiz", "semQuadro", "semCena", "emSilencio", "repetidas", "jaJulgadas", "enfileiradas"]
    assert sum(c[d] for d in desfechos) == c["capturas"]
    assert c["conformes"] + c["naoConformes"] + c["naoAvaliaveis"] + c["falhas"] == c["enfileiradas"]
    # Cada julgamento concluído foi feito em um dos dois lugares.
    assert c["julgadasLoja"] + c["julgadasNuvem"] == c["conformes"] + c["naoConformes"] + c["naoAvaliaveis"]


def test_nenhuma_chave_do_resumo_em_snake_case():
    com_sublinhado = [k for k in resumo_para_nuvem(linha_do_contrato()) if "_" in k]
    assert com_sublinhado == [], f"a API lê camelCase: {com_sublinhado}"


def test_controle_interno_nao_sobe():
    corpo = resumo_para_nuvem(linha_do_contrato())
    assert "versao" not in corpo and "estado" not in corpo


def test_a_linha_que_sai_da_FILA_de_verdade_tem_tudo_o_que_o_contrato_pede(fila):
    """As três pontas: a tabela, a leitura e o corpo.

    A linha do contrato acima é montada à mão. Se a tabela perdesse uma
    coluna, aquele teste continuaria verde e a subida quebraria na loja.
    """
    fila.contar(BASE, "r1", "z1", capturas=1, sem_cena=1, impedimento="tela preta")
    fila.contar_veredito(BASE, "r1", "z1", veredito(Resultado.NAO_CONFORME, 0.8, 900, 1.2), BASE)

    corpo = resumo_para_nuvem(fila.resumos_a_subir()[0])

    assert set(corpo) == set(json.loads(CONTRATO.read_text(encoding="utf-8")))
    assert corpo["semCena"] == 1 and corpo["naoConformes"] == 1
    assert corpo["ultimoImpedimento"] == "tela preta"
    json.dumps(corpo)   # tem que ser serializável: fica na fila até a nuvem aceitar


def test_a_hora_sobe_COM_o_fuso_e_cheia(fila):
    # O agente trabalha com a hora da máquina, sem fuso. A nuvem recusa
    # instante sem fuso — supor UTC gravaria três horas fora do lugar.
    fila.contar(BASE + timedelta(minutes=37, seconds=12), "r1", "z1", capturas=1, enfileiradas=1)

    hora = resumo_para_nuvem(fila.resumos_a_subir()[0])["hora"]

    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:00:00[+-]\d\d:\d\d", hora), hora


# ───────────────────────────── o motor ────────────────────────────


class FonteVazia:
    ponto_id = "ponto-teste"

    def rajada(self, ts, quantidade=6, stream="main"):
        return []


class FonteQueCai:
    ponto_id = "ponto-teste"

    def rajada(self, ts, quantidade=6, stream="main"):
        raise OSError("não abri rtsp://admin:minhasenha123@192.168.0.50:554/cam")


class FonteDeTelaPreta:
    ponto_id = "ponto-teste"

    def rajada(self, ts, quantidade=6, stream="main"):
        return [
            Frame(
                imagem=np.zeros((480, 640, 3), dtype=np.uint8),
                ts=ts + timedelta(milliseconds=200 * i),
                ponto_id=self.ponto_id,
            )
            for i in range(quantidade)
        ]


def olhar(motor, fonte, ts):
    return motor.preparar(EventoGatilho(ponto_id=fonte.ponto_id, ts=ts), fonte)


def test_olhada_enfileirada_e_veredito_vao_para_a_mesma_linha(fila, regra, fonte):
    motor = MotorDeRegras(fila, [regra])

    olhar(motor, fonte, BASE)
    motor.processar(JuizFixo(Resultado.CONFORME, confianca=0.9), BASE + timedelta(seconds=2))

    l = linha(fila)
    assert (l["capturas"], l["enfileiradas"]) == (1, 1)
    assert (l["conformes"], l["nao_conformes"], l["alertas"]) == (1, 0, 0)
    assert l["ultimo_resultado"] == "conforme"


def test_cena_repetida_conta_como_repetida(fila, regra):
    # A mesma imagem duas vezes: a segunda não vira análise, mas foi olhada.
    motor = MotorDeRegras(fila, [regra])
    fonte = FonteBoa("ponto-teste")

    olhar(motor, fonte, BASE)
    olhar(motor, fonte, BASE + timedelta(seconds=10))

    l = linha(fila)
    assert (l["capturas"], l["enfileiradas"], l["repetidas"]) == (2, 1, 1)


def test_olhada_em_silencio_conta_como_silencio(fila, regra, fonte):
    motor = MotorDeRegras(fila, [regra])
    olhar(motor, fonte, BASE)
    motor.processar(JuizFixo(Resultado.NAO_CONFORME, confianca=0.95), BASE + timedelta(seconds=2))

    olhar(motor, fonte, BASE + timedelta(minutes=1))     # dentro dos 15 min de silêncio

    l = linha(fila)
    assert (l["capturas"], l["enfileiradas"], l["em_silencio"]) == (2, 1, 1)
    assert (l["nao_conformes"], l["alertas"]) == (1, 1)


def test_nao_conforme_abaixo_da_confianca_conta_mas_NAO_e_alerta(fila, regra, fonte):
    motor = MotorDeRegras(fila, [regra])
    olhar(motor, fonte, BASE)
    motor.processar(JuizFixo(Resultado.NAO_CONFORME, confianca=0.5), BASE + timedelta(seconds=2))

    l = linha(fila)
    assert (l["nao_conformes"], l["alertas"]) == (1, 0)


def test_tela_de_sem_sinal_conta_como_sem_cena_e_diz_por_que(fila, regra):
    motor = MotorDeRegras(fila, [regra])

    olhar(motor, FonteDeTelaPreta(), BASE)

    l = linha(fila)
    assert (l["capturas"], l["sem_cena"], l["enfileiradas"]) == (1, 1, 0)
    assert l["ultimo_impedimento"], "sem o motivo, o console só sabe que 'não deu'"


def test_fonte_que_nao_entrega_quadro_conta_como_sem_quadro(fila, regra):
    motor = MotorDeRegras(fila, [regra])

    olhar(motor, FonteVazia(), BASE)

    l = linha(fila)
    assert (l["capturas"], l["sem_quadro"]) == (1, 1)


def test_camera_que_NAO_RESPONDE_e_contada_e_o_erro_continua_subindo(fila, regra):
    """O canal morto tem que deixar rastro.

    Antes, a exceção saía do motor sem contar nada: no console, uma câmera
    desligada ficava com zero olhadas — igual a um canal sem critério.
    """
    motor = MotorDeRegras(fila, [regra])

    with pytest.raises(OSError):
        olhar(motor, FonteQueCai(), BASE)

    l = linha(fila)
    assert (l["capturas"], l["sem_quadro"]) == (1, 1)
    assert "minhasenha123" not in l["ultimo_impedimento"]
    assert "192.168.0.50" in l["ultimo_impedimento"]


def test_falha_do_juiz_conta_e_guarda_a_causa(fila, regra, fonte):
    motor = MotorDeRegras(fila, [regra])
    olhar(motor, fonte, BASE)
    falho = JuizFixo(erro=ErroDoJuiz("o modelo não respondeu em 30 s"))

    motor.processar(falho, BASE + timedelta(seconds=2))

    l = linha(fila)
    assert l["falhas"] == 1
    assert (l["conformes"], l["nao_conformes"], l["nao_avaliaveis"]) == (0, 0, 0)
    assert "não respondeu" in l["ultimo_impedimento"]


def test_o_mesmo_criterio_em_dois_canais_tem_uma_linha_por_canal(fila, regra):
    no_1 = replace(regra, zona=Zona(id="z1", nome="z1", poligono=regra.zona.poligono, ponto_id="canal-1"))
    no_2 = replace(regra, zona=Zona(id="z2", nome="z2", poligono=regra.zona.poligono, ponto_id="canal-2"))
    motor = MotorDeRegras(fila, [no_1, no_2])

    olhar(motor, FonteBoa("canal-1"), BASE)
    olhar(motor, FonteDeTelaPretaEm("canal-2"), BASE)

    assert linha(fila, "r1", "z1")["enfileiradas"] == 1
    do_2 = linha(fila, "r1", "z2")
    assert (do_2["sem_cena"], do_2["enfileiradas"]) == (1, 0), "o canal 2 herdou a conta do 1"


class FonteDeTelaPretaEm(FonteDeTelaPreta):
    def __init__(self, ponto_id):
        self.ponto_id = ponto_id


def test_o_veredito_conta_na_hora_da_CENA_nao_na_do_julgamento(fila, regra, fonte):
    # Capturado às 16h59, julgado às 17h05 (a internet demorou): pertence
    # às 16h, que é quando aconteceu.
    motor = MotorDeRegras(fila, [regra])
    capturado = BASE + timedelta(minutes=59)
    olhar(motor, fonte, capturado)

    motor.processar(JuizFixo(Resultado.CONFORME), BASE + timedelta(minutes=65))

    assert linha(fila, ts=capturado)["conformes"] == 1
    das_17 = [l for l in fila._con.execute("select * from resumo_hora") if l["hora"] == Fila.hora_de(BASE + timedelta(hours=1))]
    assert das_17 == [], "o julgamento atrasado abriu linha na hora errada"


def test_resumo_que_falha_NAO_derruba_a_auditoria(fila, regra, fonte, monkeypatch):
    """A estatística não pode custar a auditoria.

    Disco cheio ou banco travado na hora de somar: o agente segue olhando
    a cozinha, enfileirando e julgando.
    """
    motor = MotorDeRegras(fila, [regra])

    def estourar(*a, **k):
        raise sqlite3.OperationalError("database or disk is full")

    monkeypatch.setattr(fila, "contar_lote", estourar)
    monkeypatch.setattr(fila, "contar_veredito", estourar)

    p = olhar(motor, fonte, BASE)
    alertas = motor.processar(JuizFixo(Resultado.NAO_CONFORME, confianca=0.95), BASE + timedelta(seconds=2))

    assert p.enfileirados == [regra.id]
    assert len(alertas) == 1, "o alerta deixou de sair porque o resumo falhou"


# ────────────────────────── a subida ──────────────────────────


def test_o_resumo_sobe_e_NAO_sobe_de_novo_sem_ter_mudado(tmp_path):
    nuvem = NuvemDeTeste()
    a = montar(tmp_path, nuvem=nuvem)

    a.passo(MEIO_DIA)

    assert len(nuvem.resumos_enviados) == 1
    (r,) = nuvem.resumos_enviados[0]["resumos"]
    assert (r["regraId"], r["zonaId"]) == ("r1", "z1")
    assert (r["capturas"], r["enfileiradas"], r["naoConformes"], r["alertas"]) == (1, 1, 1, 1)
    assert a.fila.resumos_pendentes() == 0

    a.subir(MEIO_DIA + timedelta(hours=1))
    assert len(nuvem.resumos_enviados) == 1, "subiu de novo a mesma coisa"


def test_o_resumo_respeita_o_intervalo_e_sobe_o_ACUMULADO(tmp_path):
    nuvem = NuvemDeTeste()
    a = montar(tmp_path, nuvem=nuvem)

    a.passo(MEIO_DIA)
    a.passo(MEIO_DIA + timedelta(seconds=30))
    a.passo(MEIO_DIA + timedelta(seconds=60))
    assert len(nuvem.resumos_enviados) == 1, "a linha da hora corrente subiu a cada passada"
    assert a.fila.resumos_pendentes() == 1, "as olhadas novas esperam o próximo envio"

    a.passo(MEIO_DIA + timedelta(minutes=5, seconds=30))

    assert len(nuvem.resumos_enviados) == 2
    (r,) = nuvem.resumos_enviados[1]["resumos"]
    assert r["capturas"] == 4, "o que sobe é o total da hora, não a diferença"
    assert r["emSilencio"] == 3
    assert r["capturas"] == sum(
        r[d] for d in ("semJuiz", "semQuadro", "semCena", "emSilencio", "repetidas", "jaJulgadas", "enfileiradas")
    )


def test_nuvem_fora_o_resumo_fica_guardado_e_SOBE_quando_ela_volta(tmp_path):
    nuvem = NuvemDeTeste(erro=ErroDaNuvem("sem rede"))
    a = montar(tmp_path, nuvem=nuvem)

    a.passo(MEIO_DIA)
    assert a.fila.resumos_pendentes() == 1, "o resumo tem que estar guardado"

    nuvem.erro = None
    a.passo(MEIO_DIA + timedelta(seconds=30))

    assert len(nuvem.resumos_enviados) == 1, "voltou a rede e o resumo não subiu"
    assert nuvem.resumos_enviados[0]["resumos"][0]["capturas"] == 2
    assert a.fila.resumos_pendentes() == 0


def test_o_resumo_sobrevive_ao_agente_REINICIAR(tmp_path):
    fora = NuvemDeTeste(erro=ErroDaNuvem("sem rede"))
    a = montar(tmp_path, nuvem=fora)
    a.passo(MEIO_DIA)
    a.fila.fechar()

    de_volta = NuvemDeTeste()
    b = Auditoria(
        de_volta, str(tmp_path / "fila.db"),
        construir_fonte=lambda ponto: FonteBoa(ponto.id),
        construir_juiz=lambda cfg: JuizDeTeste(),
    )
    b.subir(MEIO_DIA + timedelta(hours=1))

    assert de_volta.resumos_enviados[0]["resumos"][0]["naoConformes"] == 1


class NuvemSemARotaDeResumo(NuvemDeTeste):
    """A API ainda não foi atualizada: evento entra, resumo dá 404."""

    def _pedir(self, metodo, caminho, corpo=None):
        if caminho == "/v1/resumos":
            self.tentativas_de_resumo += 1
            raise ErroDaNuvem("404 em /v1/resumos", recuperavel=False, status=404)
        return super()._pedir(metodo, caminho, corpo)


def test_nuvem_sem_a_rota_pausa_o_resumo_diz_UMA_vez_e_o_evento_sobe(tmp_path, caplog):
    # A ordem de implantação não é garantida: o agente novo pode chegar
    # antes da API nova. Não pode martelar, nem levar o evento junto.
    nuvem = NuvemSemARotaDeResumo()
    a = montar(tmp_path, nuvem=nuvem)

    with caplog.at_level("ERROR", logger="farol_agent.auditoria"):
        r = a.passo(MEIO_DIA)
        for minuto in range(1, 6):
            a.subir(MEIO_DIA + timedelta(minutes=minuto))

    assert r["subidos"] == 1, "o evento deixou de subir por causa do resumo"
    assert nuvem.tentativas_de_resumo == 1, "insistiu num pedido que a nuvem recusou"
    linhas = [x for x in caplog.records if "resumo por hora ficou sem subir" in x.getMessage()]
    assert len(linhas) == 1
    assert a.fila.resumos_pendentes() == 1, "recusa do PEDIDO não joga o resumo fora"

    a.subir(MEIO_DIA + timedelta(minutes=11))
    assert nuvem.tentativas_de_resumo == 2, "passada a pausa, tenta de novo"


def test_linha_que_a_nuvem_recusa_nao_e_reenviada(tmp_path):
    nuvem = NuvemDeTeste(recusar_resumos=lambda corpo: [0])
    a = montar(tmp_path, nuvem=nuvem)

    a.passo(MEIO_DIA)
    a.subir(MEIO_DIA + timedelta(minutes=30))

    assert nuvem.tentativas_de_resumo == 1
    assert a.fila.resumos_pendentes() == 0


def test_com_dois_canais_cada_linha_sobe_com_o_seu(tmp_path):
    nuvem = NuvemDeTeste()
    a = Auditoria(
        nuvem, str(tmp_path / "fila.db"),
        construir_fonte=lambda ponto: FonteBoa(ponto.id, semente=hash(ponto.id) % 1000),
        construir_juiz=lambda cfg: JuizDeTeste(),
    )
    a.montar(dois_canais(mesmo_criterio=True))

    a.passo(MEIO_DIA)

    linhas = nuvem.resumos_enviados[0]["resumos"]
    assert sorted((l["regraId"], l["zonaId"]) for l in linhas) == [("r1", "z1"), ("r1", "z2")]
    assert all(l["capturas"] == 1 for l in linhas)


def test_criterio_SEM_JUIZ_aparece_no_resumo_com_o_motivo(tmp_path, monkeypatch):
    """Ligado e mudo, ou ligado e sem quem julgue?

    O critério sem juiz não é capturado — de propósito. Mas sem rastro
    nenhum, o console mostraria um critério ligado com zero olhadas e
    ninguém saberia que falta instalar o detector.
    """
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-" + "a" * 60)
    d = resposta()
    d["pontos"][0]["zonas"][0]["regras"][0]["tipo"] = "presenca"
    nuvem = NuvemDeTeste()
    a = Auditoria(nuvem, str(tmp_path / "fila.db"), construir_fonte=lambda p: FonteBoa(p.id))
    a.montar(de_json(d))

    a.passo(MEIO_DIA)
    a.passo(MEIO_DIA + timedelta(seconds=30))

    l = linha(a.fila, ts=MEIO_DIA)
    assert (l["capturas"], l["sem_juiz"], l["enfileiradas"]) == (2, 2, 0)
    assert l["ultimo_impedimento"], "o motivo de não haver juiz tem que subir"
    assert nuvem.resumos_enviados[0]["resumos"][0]["semJuiz"] == 1


def test_criterio_sem_juiz_FORA_do_horario_nao_e_contado(tmp_path, monkeypatch):
    # A janela da regra do dublê é de segunda a quarta, das 8h às 18h.
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-" + "a" * 60)
    d = resposta()
    d["pontos"][0]["zonas"][0]["regras"][0]["tipo"] = "presenca"
    a = Auditoria(NuvemDeTeste(), str(tmp_path / "fila.db"), construir_fonte=lambda p: FonteBoa(p.id))
    a.montar(de_json(d))

    a.passo(datetime(2026, 10, 6, 23, 0, 0))

    assert a.fila.resumos_pendentes() == 0


def test_fila_de_resumo_cheia_drena_em_passadas_seguidas(tmp_path):
    # A internet voltou depois do fim de semana: não dá para esperar cinco
    # minutos entre um lote e outro.
    nuvem = NuvemDeTeste()
    a = montar(tmp_path, nuvem=nuvem)
    for h in range(LIMITE_DE_RESUMOS + 50):
        a.fila.contar(MEIO_DIA - timedelta(hours=h + 1), "r1", "z1", capturas=1, enfileiradas=1)

    a.subir(MEIO_DIA)
    a.subir(MEIO_DIA + timedelta(seconds=30))

    assert [len(p["resumos"]) for p in nuvem.resumos_enviados] == [LIMITE_DE_RESUMOS, 50]
    assert a.fila.resumos_pendentes() == 0
    # A hora mais antiga sobe primeiro.
    horas = [l["hora"] for l in nuvem.resumos_enviados[0]["resumos"]]
    assert horas == sorted(horas)
