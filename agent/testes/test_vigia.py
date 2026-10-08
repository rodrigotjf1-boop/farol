"""O vigia: entre uma olhada e outra, pede olhada extra quando a contagem muda (fase 3).

O que se protege aqui:

- o vigia não julga e não abre fluxo: só olha o último quadro do fluxo menor;
- a comparação é com o instante da ÚLTIMA OLHADA — sem olhada, não há extra;
- no máximo uma olhada extra por canal a cada vinte segundos;
- a olhada extra é só dos critérios de presença e de contagem daquele canal:
  o que vai à nuvem não é acordado;
- a olhada extra não entra na média da hora (entra no maior valor), é contada
  à parte no resumo e não adianta o "avisar só se continuar";
- o freio para o vigia com a máquina ocupada, e o solta quando ela folga.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta

import numpy as np
import pytest

from farol_agent import uso
from farol_agent.auditoria import Auditoria
from farol_agent.configuracao import de_json
from farol_agent.contrato import resumo_para_nuvem
from farol_agent.fila import Fila
from farol_agent.fontes import rtsp
from farol_agent.modelos import EventoGatilho, Frame, Resultado, TipoRegra, Veredito, Via
from farol_agent.motor import MotorDeRegras
from farol_agent.vigia import MINIMO_ENTRE_EXTRAS, QUADRO_VELHO, VIGIADOS, Freio, Vigia

from .test_auditoria import NuvemDeTeste
from .test_configuracao import resposta

# Terça-feira ao meio-dia: dentro da janela da regra do dublê de configuração.
MEIO_DIA = datetime(2026, 10, 6, 12, 0, 0)
S = timedelta(seconds=1)


# ───────────────────────── o freio ─────────────────────────


def test_o_freio_so_puxa_com_a_maquina_ocupada_por_quatro_medidas_seguidas():
    f = Freio()
    assert [f.alimentar(v) for v in (90, 90, 90)] == [False, False, False] and not f.puxado, "três medidas ainda não são 'há minutos'"
    assert f.alimentar(90) is True and f.puxado, "na quarta, puxa — e avisa que mudou"
    assert f.alimentar(95) is False and f.puxado, "continuar ocupada não é mudança"


def test_um_pico_no_meio_nao_puxa_o_freio():
    f = Freio()
    for v in (90, 90, 30, 90, 90, 90):
        f.alimentar(v)
    assert not f.puxado, "a medida baixa ainda está entre as quatro últimas"
    assert f.alimentar(90) is True and f.puxado


def test_o_freio_solta_abaixo_de_outra_marca_para_nao_ficar_ligando_e_desligando():
    f = Freio()
    for _ in range(4):
        f.alimentar(80)
    assert f.puxado
    for v in (55, 50, 58, 52):
        assert f.alimentar(v) is False
    assert f.puxado, "entre 45% e 60% fica como estava"
    assert [f.alimentar(v) for v in (40, 40, 40)] == [False, False, False] and f.puxado
    assert f.alimentar(40) is True and not f.puxado, "quatro medidas abaixo de 45%: solta"
    assert (f.parar_acima_de, f.voltar_abaixo_de) == (60.0, 45.0)


def test_sem_medida_o_freio_nao_muda():
    f = Freio()
    for _ in range(10):
        assert f.alimentar(None) is False
    assert not f.puxado
    for _ in range(4):
        f.alimentar(100)
    assert f.puxado
    for _ in range(6):
        assert f.alimentar(None) is False and f.puxado, "'não medi' não é zero: não solta"
    # exatamente no limite não é "acima"
    g = Freio()
    for _ in range(8):
        g.alimentar(60.0)
    assert not g.puxado


# ───────────────────────── os dublês ─────────────────────────


class FonteComMenor:
    """Um canal: o fluxo principal entrega a rajada; o menor, o último quadro.

    O valor de cada ponto da imagem é a contagem (× 10): é o que o "detector"
    de mentira lê.
    """

    def __init__(self, ponto_id="p1", pessoas=1, copos=0):
        self.ponto_id = ponto_id
        self.pessoas = pessoas
        self.copos = copos
        self.agora = MEIO_DIA
        self.idade = timedelta(0)
        self.rajadas: list[str] = []
        self.sem_quadro = False

    def _imagem(self):
        img = np.zeros((480, 704, 3), dtype=np.uint8)
        img[:, :, 0] = self.pessoas * 10
        img[:, :, 1] = self.copos * 10
        img[:, :, 2] = 77
        return img

    def quadro_do_fluxo_menor(self):
        if self.sem_quadro:
            return None
        return Frame(self._imagem(), self.agora - self.idade, self.ponto_id, stream="sub")

    def rajada(self, ts, quantidade=6, stream="main"):
        self.rajadas.append(stream)
        rng = np.random.default_rng(len(self.rajadas))
        return [Frame(rng.integers(0, 255, (480, 640, 3), dtype=np.uint8), ts + timedelta(milliseconds=100 * i), self.ponto_id) for i in range(quantidade)]


class Contador:
    """O detector de mentira: lê a contagem escrita na imagem."""

    def __init__(self):
        self.vistos: list[tuple[tuple[int, ...], str]] = []
        self.erro: Exception | None = None

    def __call__(self, imagem, classe: str) -> int:
        self.vistos.append((imagem.shape, classe))
        if self.erro:
            raise self.erro
        return int(imagem[0, 0, 0 if classe == "person" else 1]) // 10


CLASSES = {"pessoa": "person", "copo": "cup"}


def regras_de(*tipos_e_objetos, ponto="p1"):
    """Critérios do dublê de configuração, um por (tipo, objeto), todos na área do canal."""
    corpo = resposta()
    corpo["pontos"][0]["id"] = ponto
    base = corpo["pontos"][0]["zonas"][0]["regras"][0]
    corpo["pontos"][0]["zonas"][0]["id"] = f"z-{ponto}"
    corpo["pontos"][0]["zonas"][0]["regras"] = [
        {**base, "id": f"{ponto}-r{i}", "nome": f"{tipo} {objeto}", "tipo": tipo, "parametros": ({"objeto": objeto, "minimo": 1} if objeto else {})}
        for i, (tipo, objeto) in enumerate(tipos_e_objetos)
    ]
    return de_json(corpo).regras


def vigia_com(regras, contador=None):
    contador = contador or Contador()
    v = Vigia(contador, classes=CLASSES)
    v.montar(regras)
    return v, contador


def olhar(v, fontes, quando):
    """O vigia olha — com o relógio de cada fonte de mentira na hora da chamada."""
    for f in fontes.values():
        if hasattr(f, "agora"):
            f.agora = quando
    return v.olhar(fontes, quando)


def anotar(v, fonte, quando, ponto="p1"):
    """A auditoria acabou de olhar o canal, naquela hora."""
    fonte.agora = quando
    v.anotar_olhada(ponto, fonte, quando)


# ───────────────────────── o que ele vigia ─────────────────────────


def test_vigia_so_presenca_e_contagem_que_dizem_o_que_procurar():
    assert VIGIADOS == (TipoRegra.PRESENCA, TipoRegra.CONTAGEM)
    regras = regras_de(
        ("presenca", "pessoa"), ("contagem", "copo"), ("estado", None), ("presenca", None), ("contagem", "unicórnio"),
        ("comparacao", None), ("estado", "pessoa"),      # estado que cita um objeto continua sendo da nuvem
    )
    v, _ = vigia_com(regras)
    assert v.canais == ["p1"]
    assert [(a.regra.tipo.value, a.classe) for a in v._alvos["p1"]] == [("presenca", "person"), ("contagem", "cup")]

    sem_nada, _ = vigia_com(regras_de(("estado", None)))
    assert sem_nada.canais == [] and sem_nada.olhar({"p1": FonteComMenor()}, MEIO_DIA) == []


def test_sem_olhada_antes_nao_ha_com_o_que_comparar():
    v, contador = vigia_com(regras_de(("presenca", "pessoa")))
    fonte = FonteComMenor(pessoas=3)
    assert olhar(v, {"p1": fonte}, MEIO_DIA) == [], "a primeira olhada é a de rotina, não a do vigia"
    assert fonte.rajadas == [], "o vigia nunca abre o fluxo principal"
    assert len(contador.vistos) == 1


def test_a_contagem_mudou_desde_a_ultima_olhada_pede_olhada_agora():
    v, contador = vigia_com(regras_de(("presenca", "pessoa")))
    fonte = FonteComMenor(pessoas=1)
    anotar(v, fonte, MEIO_DIA)

    assert olhar(v, {"p1": fonte}, MEIO_DIA + 10 * S) == [], "igual à última olhada: nada a fazer"
    fonte.pessoas = 0
    assert olhar(v, {"p1": fonte}, MEIO_DIA + 20 * S) == ["p1"], "o posto esvaziou"
    assert fonte.rajadas == [], "quem olha pelo fluxo principal é a auditoria, não o vigia"
    # o que o detector recebe é o recorte da área do critério (33% da altura e 70% da largura de 704 × 480)
    assert contador.vistos[-1] == ((159, 493, 3), "person")


def test_no_maximo_uma_olhada_extra_por_canal_a_cada_vinte_segundos():
    assert MINIMO_ENTRE_EXTRAS == timedelta(seconds=20)
    v, _ = vigia_com(regras_de(("presenca", "pessoa")))
    fonte = FonteComMenor(pessoas=1)
    anotar(v, fonte, MEIO_DIA)

    fonte.pessoas = 0
    assert olhar(v, {"p1": fonte}, MEIO_DIA + 10 * S) == ["p1"]
    # a auditoria NÃO anotou a olhada (ou a contagem piscou de novo): o vigia espera
    assert olhar(v, {"p1": fonte}, MEIO_DIA + 20 * S) == [], "dez segundos depois da extra: ainda não"
    assert olhar(v, {"p1": fonte}, MEIO_DIA + 29 * S) == []
    assert olhar(v, {"p1": fonte}, MEIO_DIA + 30 * S) == ["p1"], "vinte segundos depois: pode de novo"


def test_depois_da_olhada_a_referencia_e_a_nova():
    v, _ = vigia_com(regras_de(("presenca", "pessoa")))
    fonte = FonteComMenor(pessoas=1)
    anotar(v, fonte, MEIO_DIA)
    fonte.pessoas = 0
    assert olhar(v, {"p1": fonte}, MEIO_DIA + 10 * S) == ["p1"]
    anotar(v, fonte, MEIO_DIA + 10 * S)

    assert olhar(v, {"p1": fonte}, MEIO_DIA + 40 * S) == [], "continua vazio: já foi olhado assim"
    fonte.pessoas = 2
    assert olhar(v, {"p1": fonte}, MEIO_DIA + 50 * S) == ["p1"]


def test_cada_canal_com_a_sua_contagem():
    regras = regras_de(("presenca", "pessoa"), ponto="p1") + regras_de(("presenca", "pessoa"), ponto="p2")
    v, _ = vigia_com(regras)
    a, b = FonteComMenor("p1", pessoas=1), FonteComMenor("p2", pessoas=4)
    fontes = {"p1": a, "p2": b}
    anotar(v, a, MEIO_DIA)
    anotar(v, b, MEIO_DIA, "p2")

    b.pessoas = 5
    assert olhar(v, fontes, MEIO_DIA + 10 * S) == ["p2"], "só o canal em que algo mudou"
    a.pessoas = 0
    assert olhar(v, fontes, MEIO_DIA + 20 * S) == ["p1"], "o p2 está no intervalo dele; o p1 não tem intervalo a cumprir"
    # canal que saiu da lista de fontes (pausado) não é olhado
    assert olhar(v, {"p2": b}, MEIO_DIA + 60 * S) == ["p2"]


def test_dois_criterios_no_canal_qualquer_um_que_mude_pede_a_olhada():
    v, contador = vigia_com(regras_de(("presenca", "pessoa"), ("contagem", "copo")))
    fonte = FonteComMenor(pessoas=1, copos=2)
    anotar(v, fonte, MEIO_DIA)
    assert olhar(v, {"p1": fonte}, MEIO_DIA + 10 * S) == []
    fonte.copos = 3
    assert olhar(v, {"p1": fonte}, MEIO_DIA + 20 * S) == ["p1"], "as pessoas não mudaram, os copos sim"
    assert {c for _, c in contador.vistos} == {"person", "cup"}


def test_quadro_parado_ou_ausente_nao_e_vigiado():
    assert QUADRO_VELHO == timedelta(seconds=5)
    v, _ = vigia_com(regras_de(("presenca", "pessoa")))
    fonte = FonteComMenor(pessoas=1)
    anotar(v, fonte, MEIO_DIA)
    fonte.pessoas = 0

    fonte.idade = timedelta(seconds=6)          # o fluxo menor travou há seis segundos
    assert olhar(v, {"p1": fonte}, MEIO_DIA + 10 * S) == [], "quadro velho não é 'agora'"
    fonte.idade = timedelta(seconds=4)
    assert olhar(v, {"p1": fonte}, MEIO_DIA + 10 * S) == ["p1"]

    fonte.sem_quadro = True
    assert olhar(v, {"p1": fonte}, MEIO_DIA + 60 * S) == []

    class SemFluxoMenor:
        ponto_id = "p1"
        aberturas: list = []

        def rajada(self, *a, **k):
            self.aberturas.append(a)
            return []

        quadro = rajada

    assert olhar(v, {"p1": SemFluxoMenor()}, MEIO_DIA + 90 * S) == [], "fonte sem fluxo menor fica só na rotina"
    assert SemFluxoMenor.aberturas == [], "e o vigia não vai buscar quadro no fluxo principal"


def test_olhada_sem_quadro_do_fluxo_menor_apaga_a_referencia():
    v, _ = vigia_com(regras_de(("presenca", "pessoa")))
    fonte = FonteComMenor(pessoas=1)
    anotar(v, fonte, MEIO_DIA)
    fonte.sem_quadro = True
    anotar(v, fonte, MEIO_DIA + 30 * S)      # olhou, mas o fluxo menor não tinha quadro
    fonte.sem_quadro = False
    fonte.pessoas = 0
    assert olhar(v, {"p1": fonte}, MEIO_DIA + 40 * S) == [], "comparar com a contagem de antes seria comparar com o que já era velho"


def test_fora_do_horario_do_criterio_nao_ha_o_que_vigiar():
    v, contador = vigia_com(regras_de(("presenca", "pessoa")))
    fonte = FonteComMenor(pessoas=1)
    noite = datetime(2026, 10, 6, 20, 0, 0)               # a janela do critério vai até as 18h
    fonte.agora = noite
    anotar(v, fonte, noite)
    fonte.pessoas = 0
    assert olhar(v, {"p1": fonte}, noite + 10 * S) == []
    assert contador.vistos == [], "nem roda o detector"


def test_com_o_freio_puxado_o_vigia_nao_olha():
    v, contador = vigia_com(regras_de(("presenca", "pessoa")))
    fonte = FonteComMenor(pessoas=1)
    anotar(v, fonte, MEIO_DIA)
    fonte.pessoas = 0
    for _ in range(4):
        v.freio.alimentar(95)
    antes = len(contador.vistos)
    assert olhar(v, {"p1": fonte}, MEIO_DIA + 10 * S) == [] and len(contador.vistos) == antes, "máquina ocupada: nem o detector roda"
    for _ in range(4):
        v.freio.alimentar(10)
    assert olhar(v, {"p1": fonte}, MEIO_DIA + 20 * S) == ["p1"]


def test_o_vigia_nunca_derruba_quem_o_chama():
    contador = Contador()
    v, _ = vigia_com(regras_de(("presenca", "pessoa")), contador)
    fonte = FonteComMenor(pessoas=1)
    anotar(v, fonte, MEIO_DIA)
    contador.erro = RuntimeError("o detector caiu")
    assert olhar(v, {"p1": fonte}, MEIO_DIA + 10 * S) == []
    anotar(v, fonte, MEIO_DIA + 10 * S)       # não levanta
    contador.erro = None
    fonte.pessoas = 0
    assert olhar(v, {"p1": fonte}, MEIO_DIA + 20 * S) == [], "a olhada que não leu a contagem deixou o vigia sem referência"


def test_remontar_zera_a_referencia_e_guarda_o_freio():
    v, _ = vigia_com(regras_de(("presenca", "pessoa")))
    fonte = FonteComMenor(pessoas=1)
    anotar(v, fonte, MEIO_DIA)
    for _ in range(4):
        v.freio.alimentar(95)
    v.montar(regras_de(("presenca", "pessoa")))
    assert v.freio.puxado, "a máquina continua ocupada, seja qual for a configuração"
    for _ in range(4):
        v.freio.alimentar(10)
    fonte.pessoas = 0
    assert olhar(v, {"p1": fonte}, MEIO_DIA + 10 * S) == [], "configuração nova: sem olhada desde então"


# ───────────────────────── o fluxo menor de verdade ─────────────────────────


def test_o_gravador_entrega_o_ultimo_quadro_do_fluxo_menor_sem_abrir_nada(monkeypatch):
    class Leitor:
        def __init__(self, quadro):
            self.quadro = quadro

        def ultimo(self):
            return self.quadro

    fonte = rtsp.FonteRTSP("p1", "rtsp://principal", "rtsp://menor", abrir_sub=False)
    monkeypatch.setattr(fonte, "rajada", lambda *a, **k: (_ for _ in ()).throw(AssertionError("abriu o fluxo principal")))
    img = np.zeros((480, 704, 3), dtype=np.uint8)

    fonte._sub = Leitor((MEIO_DIA, img))
    q = fonte.quadro_do_fluxo_menor()
    assert (q.ts, q.stream, q.ponto_id, q.imagem.shape) == (MEIO_DIA, "sub", "p1", (480, 704, 3))

    fonte._sub = Leitor(None)
    assert fonte.quadro_do_fluxo_menor() is None, "ainda sem quadro: nada, e não uma ida ao principal"
    fonte._sub = None
    assert fonte.quadro_do_fluxo_menor() is None, "canal sem fluxo menor: nada"


# ───────────────────────── o motor e o resumo ─────────────────────────


class JuizQueMede:
    """Responde conforme, medindo o que estiver combinado."""

    nome = "mede"

    def __init__(self, medida=1.0):
        self.medida = medida
        self.contextos: list[dict] = []

    def julgar(self, imagem, criterio, *, contexto=None, referencias=None):
        self.contextos.append(dict(contexto or {}))
        return Veredito(resultado=Resultado.CONFORME, confianca=0.9, via=Via.DETECTOR, modelo="teste", custo_centavos=0.0, medida=self.medida)


def linhas(fila):
    return {l["regra_id"]: dict(l) for l in fila._con.execute("select * from resumo_hora").fetchall()}


def test_a_olhada_extra_e_so_dos_criterios_pedidos(tmp_path):
    regras = regras_de(("presenca", "pessoa"), ("estado", None))
    fila = Fila(tmp_path / "fila.db")
    try:
        motor = MotorDeRegras(fila, regras)
        fonte = FonteComMenor()
        p = motor.preparar(EventoGatilho(ponto_id="p1", ts=MEIO_DIA), fonte, somente=lambda r: r.tipo in VIGIADOS)
        assert p.enfileirados == ["p1-r0"], "o critério de estado (que vai à nuvem) não é acordado"
        assert list(linhas(fila)) == ["p1-r0"], "nem conta como olhada dele"

        tudo = motor.preparar(EventoGatilho(ponto_id="p1", ts=MEIO_DIA + 30 * S), fonte)
        assert sorted(tudo.enfileirados) == ["p1-r0", "p1-r1"], "sem o filtro, como sempre foi"
    finally:
        fila.fechar()


def test_a_olhada_extra_nao_entra_na_media_da_hora_mas_entra_no_maior_valor(tmp_path):
    (regra,) = regras_de(("contagem", "pessoa"))
    fila = Fila(tmp_path / "fila.db")
    try:
        motor = MotorDeRegras(fila, [regra])
        fonte = FonteComMenor()
        juiz = JuizQueMede(2.0)

        motor.preparar(EventoGatilho(ponto_id="p1", ts=MEIO_DIA), fonte)
        motor.processar(juiz, MEIO_DIA)
        juiz.medida = 7.0                                   # o pico que a rotina não veria
        motor.preparar(EventoGatilho(ponto_id="p1", ts=MEIO_DIA + 10 * S, origem="vigia"), fonte, contexto={"olhada_extra": True})
        motor.processar(juiz, MEIO_DIA + 10 * S)
        juiz.medida = 3.0
        motor.preparar(EventoGatilho(ponto_id="p1", ts=MEIO_DIA + 30 * S), fonte)
        motor.processar(juiz, MEIO_DIA + 30 * S)

        l = linhas(fila)["p1-r0"]
        assert (l["capturas"], l["conformes"]) == (3, 3), "as três são olhadas, e as três foram julgadas"
        assert (l["com_medida"], l["soma_medida"]) == (2, 5.0), "a média é das duas de rotina: 2,5"
        assert l["max_medida"] == 7.0, "o maior valor é o da extra"
        assert (l["extras"], l["extras_fora"]) == (1, 0), "e fica marcada à parte: uma extra, que deu conforme"
    finally:
        fila.fechar()


def test_o_maior_valor_so_sobe_junto_de_uma_media(tmp_path):
    # A API recusa "pico sem medida". Hora em que a única medida veio de uma olhada extra
    # tem o pico guardado na fila, e ele só viaja quando a rotina trouxer a primeira medida.
    (regra,) = regras_de(("contagem", "pessoa"))
    fila = Fila(tmp_path / "fila.db")
    try:
        motor = MotorDeRegras(fila, [regra])
        fonte = FonteComMenor()
        juiz = JuizQueMede(7.0)
        motor.preparar(EventoGatilho(ponto_id="p1", ts=MEIO_DIA + 5 * S, origem="vigia"), fonte, contexto={"olhada_extra": True})
        motor.processar(juiz, MEIO_DIA + 5 * S)

        (linha,) = fila.resumos_a_subir()
        assert (linha["max_medida"], linha["com_medida"]) == (7.0, 0), "na fila o pico está guardado"
        corpo = resumo_para_nuvem(linha)
        assert (corpo["comMedida"], corpo["somaMedida"], corpo["maxMedida"]) == (0, 0.0, None)
        assert (corpo["extras"], corpo["extrasFora"], corpo["conformes"]) == (1, 0, 1)
        fila.marcar_resumos([linha])                        # a nuvem aceitou
        assert fila.resumos_a_subir() == []

        juiz.medida = 2.0
        motor.preparar(EventoGatilho(ponto_id="p1", ts=MEIO_DIA + 30 * S), fonte)
        motor.processar(juiz, MEIO_DIA + 30 * S)
        (linha,) = fila.resumos_a_subir()
        corpo = resumo_para_nuvem(linha)
        assert (corpo["comMedida"], corpo["somaMedida"], corpo["maxMedida"]) == (1, 2.0, 7.0), "com a rotina, o pico sobe"
        assert (corpo["extras"], corpo["conformes"]) == (1, 2)
    finally:
        fila.fechar()


def test_a_olhada_extra_fora_do_criterio_e_contada_como_tal(tmp_path):
    fila = Fila(tmp_path / "fila.db")
    try:
        fora = Veredito(resultado=Resultado.NAO_CONFORME, confianca=0.9, via=Via.DETECTOR, modelo="teste", custo_centavos=0.0, medida=0.0)
        em_ordem = replace(fora, resultado=Resultado.CONFORME, medida=1.0)
        fila.contar_veredito(MEIO_DIA, "r1", "z1", fora, MEIO_DIA)
        fila.contar_veredito(MEIO_DIA, "r1", "z1", fora, MEIO_DIA, extra=True)
        fila.contar_veredito(MEIO_DIA, "r1", "z1", em_ordem, MEIO_DIA, extra=True)
        l = linhas(fila)["r1"]
        assert (l["conformes"], l["nao_conformes"]) == (1, 2), "as extras são análises: entram nos resultados"
        assert (l["extras"], l["extras_fora"]) == (2, 1), "e são contadas à parte, para descontar"
        assert (l["com_medida"], l["max_medida"]) == (1, 1.0)
    finally:
        fila.fechar()


def test_a_fila_que_ja_esta_na_loja_ganha_as_colunas_das_olhadas_extras(tmp_path):
    import sqlite3

    caminho = tmp_path / "fila.db"
    Fila(caminho).fechar()
    con = sqlite3.connect(caminho)
    con.execute("alter table resumo_hora drop column extras")
    con.execute("alter table resumo_hora drop column extras_fora")
    con.commit()
    con.close()

    fila = Fila(caminho)                                    # o agente novo abre a fila de antes
    try:
        fora = Veredito(resultado=Resultado.NAO_CONFORME, confianca=0.9, via=Via.DETECTOR, modelo="teste", custo_centavos=0.0, medida=0.0)
        fila.contar_veredito(MEIO_DIA, "r1", "z1", fora, MEIO_DIA, extra=True)
        (l,) = fila.resumos_a_subir()
        assert (l["extras"], l["extras_fora"]) == (1, 1)
        assert resumo_para_nuvem(l)["extrasFora"] == 1
    finally:
        fila.fechar()


# ───────────────────────── "avisar só se continuar" ─────────────────────────


class JuizQueDiz:
    """Responde o que estiver combinado, com certeza alta."""

    nome = "diz"

    def __init__(self, resultado=Resultado.NAO_CONFORME):
        self.resultado = resultado

    def julgar(self, imagem, criterio, *, contexto=None, referencias=None):
        return Veredito(resultado=self.resultado, confianca=0.95, via=Via.DETECTOR, modelo="teste", custo_centavos=0.0, medida=0.0)


def motor_que_espera(tmp_path, confirmar_em):
    (regra,) = regras_de(("presenca", "pessoa"))
    fila = Fila(tmp_path / f"fila-{confirmar_em}.db")
    motor = MotorDeRegras(fila, [replace(regra, confirmar_em=confirmar_em)])
    fonte = FonteComMenor()
    juiz = JuizQueDiz()

    def olhada(segundos, extra=False):
        ts = MEIO_DIA + segundos * S
        motor.preparar(EventoGatilho(ponto_id="p1", ts=ts), fonte, contexto={"olhada_extra": True} if extra else None)
        return len(motor.processar(juiz, ts))

    return fila, juiz, olhada


def test_a_olhada_extra_nao_adianta_o_avisar_so_se_continuar(tmp_path):
    # "Por 2 olhadas seguidas" é meio minuto fora do critério. A olhada extra vem segundos depois
    # da anterior: se contasse, o aviso sairia de algo que durou dez segundos.
    fila, juiz, olhada = motor_que_espera(tmp_path, 2)
    try:
        assert olhada(0) == 0, "primeira fora do critério: espera continuar"
        assert olhada(10, extra=True) == 0, "a extra não é 'mais uma olhada em que continua'"
        assert olhada(30) == 1, "a segunda de ROTINA avisa"
    finally:
        fila.fechar()


def test_a_olhada_extra_tambem_nao_comeca_a_espera(tmp_path):
    fila, juiz, olhada = motor_que_espera(tmp_path, 2)
    try:
        assert olhada(0, extra=True) == 0
        assert olhada(5) == 0, "cinco segundos depois da extra: esta é a PRIMEIRA que conta"
        assert olhada(35) == 1
    finally:
        fila.fechar()


def test_a_olhada_extra_em_ordem_zera_a_espera(tmp_path):
    # Se entre duas olhadas de rotina o vigia viu o posto em ordem, a condição não continuou.
    fila, juiz, olhada = motor_que_espera(tmp_path, 2)
    try:
        assert olhada(0) == 0
        juiz.resultado = Resultado.CONFORME
        assert olhada(10, extra=True) == 0
        juiz.resultado = Resultado.NAO_CONFORME
        assert olhada(30) == 0, "recomeça do um"
        assert olhada(60) == 1
    finally:
        fila.fechar()


def test_sem_pedir_para_esperar_a_olhada_extra_avisa_na_hora(tmp_path):
    # É para isto que o vigia existe: o que dura segundos e a rotina não veria.
    fila, juiz, olhada = motor_que_espera(tmp_path, 1)
    try:
        assert olhada(0, extra=True) == 1
    finally:
        fila.fechar()


# ───────────────────────── a auditoria, de ponta a ponta ─────────────────────────


class DetectorDeMentira:
    """Tem o `motor.pontuar` que a auditoria usa para montar o contador do vigia."""

    class motor:  # noqa: N801
        @staticmethod
        def pontuar(imagem, classe):
            n = int(imagem[0, 0, 0 if classe == "person" else 1]) // 10
            # um "talvez" a mais, que não pode contar
            return [0.95] * n + [0.5]


class Medidor:
    def __init__(self, cpu=3.0):
        self.cpu = cpu

    def amostra(self):
        return uso.Amostra(cpu=self.cpu)

    def pecas(self):
        return {}

    def fechar(self):
        pass


def auditoria(tmp_path, *tipos_e_objetos, fonte=None, juiz=None, detector=DetectorDeMentira, medidor=None, **da_auditoria):
    corpo = resposta()
    base = corpo["pontos"][0]["zonas"][0]["regras"][0]
    corpo["pontos"][0]["zonas"][0]["regras"] = [
        {**base, "id": f"r{i}", "nome": f"{tipo} {objeto}", "tipo": tipo, "parametros": ({"objeto": objeto, "minimo": 1} if objeto else {})}
        for i, (tipo, objeto) in enumerate(tipos_e_objetos)
    ]
    fonte = fonte or FonteComMenor()
    juiz = juiz or JuizQueMede()
    a = Auditoria(
        NuvemDeTeste(), str(tmp_path / "fila.db"),
        construir_fonte=lambda ponto: fonte, construir_juiz=lambda cfg: juiz, medidor=medidor, **da_auditoria,
    )
    a._detector_do_porteiro = (lambda: detector()) if detector else (lambda: None)
    a.montar(de_json(corpo))
    return a, fonte, juiz


def test_a_volta_e_rotina_quando_e_hora_e_vigia_no_meio(tmp_path):
    a, fonte, juiz = auditoria(tmp_path, ("presenca", "pessoa"))
    assert a.vigia is not None and a.vigia.canais == ["p1"]

    def volta(segundos):
        fonte.agora = MEIO_DIA + segundos * S
        return a.volta(fonte.agora)

    r = volta(0)
    assert r["enfileirados"] == 1 and fonte.rajadas == ["main"], "a primeira volta é a olhada de rotina"
    assert volta(10)["extras"] == 0 and fonte.rajadas == ["main"], "nada mudou: o vigia não pede nada"

    fonte.pessoas = 0                                        # o posto esvaziou
    r = volta(20)
    assert (r["extras"], r["enfileirados"]) == (1, 1) and fonte.rajadas == ["main", "main"], "olhada extra, pelo fluxo principal"
    assert juiz.contextos[-1].get("olhada_extra") is True
    assert volta(25)["extras"] == 0, "já foi olhado assim"

    r = volta(30)
    assert "extras" not in r and len(fonte.rajadas) == 3, "trinta segundos depois da rotina: rotina de novo"
    assert juiz.contextos[-1].get("olhada_extra") is None

    (l,) = linhas(a.fila).values()
    assert (l["capturas"], l["conformes"], l["com_medida"]) == (3, 3, 2)
    a.fila.fechar()


def test_a_olhada_extra_vira_a_referencia_mesmo_com_a_rotina_longe(tmp_path):
    # Rotina de dois em dois minutos: quem diz "já foi olhado assim" é a olhada extra.
    a, fonte, _ = auditoria(tmp_path, ("presenca", "pessoa"), intervalo_captura=120.0)

    def volta(segundos):
        fonte.agora = MEIO_DIA + segundos * S
        return a.volta(fonte.agora)

    volta(0)
    fonte.pessoas = 0
    assert volta(10)["extras"] == 1
    assert volta(40)["extras"] == 0, "passou o intervalo, mas nada mudou desde a olhada extra"
    fonte.pessoas = 1
    assert volta(50)["extras"] == 1, "voltou gente: outra olhada"
    assert len(fonte.rajadas) == 3
    a.fila.fechar()


def test_o_vigia_conta_so_o_que_o_detector_ve_com_certeza(tmp_path):
    # O dublê devolve um "talvez" (0,5) além das pessoas: se contasse, a contagem nunca bateria com ela mesma.
    a, fonte, _ = auditoria(tmp_path, ("presenca", "pessoa"))
    a.volta(MEIO_DIA)
    assert a.vigia._alvos["p1"][0].na_ultima_olhada == 1
    a.fila.fechar()


def test_a_olhada_extra_nao_acorda_o_criterio_que_vai_a_nuvem(tmp_path):
    a, fonte, juiz = auditoria(tmp_path, ("presenca", "pessoa"), ("estado", None))

    a.volta(MEIO_DIA)
    assert len(juiz.contextos) == 2, "na rotina, os dois critérios"
    fonte.pessoas = 0
    fonte.agora = MEIO_DIA + 10 * S
    r = a.volta(fonte.agora)

    assert (r["extras"], r["enfileirados"]) == (1, 1)
    assert [c["regra_id"] for c in juiz.contextos[2:]] == ["r0"], "só a presença"
    l = linhas(a.fila)
    assert (l["r0"]["capturas"], l["r1"]["capturas"]) == (2, 1)
    a.fila.fechar()


def test_o_laco_dorme_ate_o_vigia_ou_ate_a_rotina_o_que_vier_antes(tmp_path):
    a, fonte, _ = auditoria(tmp_path, ("presenca", "pessoa"))
    assert a._espera(MEIO_DIA) == 10.0, "antes da primeira rotina, vale o intervalo do vigia"
    a.volta(MEIO_DIA)
    assert a._espera(MEIO_DIA) == 10.0
    assert a._espera(MEIO_DIA + 25 * S) == 5.0, "a rotina vem antes do vigia"
    assert a._espera(MEIO_DIA + 40 * S) == 0.0, "rotina atrasada: agora"

    for _ in range(4):
        a.vigia.freio.alimentar(95)
    assert a._espera(MEIO_DIA) == 30.0, "com o freio puxado, o laço volta a dormir até a rotina"
    a.fila.fechar()

    b, _, _ = auditoria(tmp_path / "b", ("estado", None))
    b.volta(MEIO_DIA)
    assert b.vigia is None and b._espera(MEIO_DIA + 5 * S) == 25.0, "sem presença nem contagem não há vigia"
    b.fila.fechar()


def test_o_uso_da_maquina_puxa_e_solta_o_freio(tmp_path, caplog):
    medidor = Medidor(cpu=95.0)
    a, fonte, _ = auditoria(tmp_path, ("presenca", "pessoa"), medidor=medidor)

    with caplog.at_level("INFO"):
        for i in range(4):
            fonte.agora = MEIO_DIA + (30 * i) * S
            a.volta(fonte.agora)
    assert a.vigia.freio.puxado
    assert sum("vigia parado" in m for m in caplog.messages) == 1, "diz uma vez, não a cada volta"

    fonte.pessoas = 0
    fonte.agora = MEIO_DIA + 100 * S
    assert a.volta(fonte.agora)["extras"] == 0, "máquina ocupada: o posto esvaziou e fica para a rotina"

    medidor.cpu = 5.0
    with caplog.at_level("INFO"):
        for i in range(4, 8):
            fonte.agora = MEIO_DIA + (30 * i) * S
            a.volta(fonte.agora)
    assert not a.vigia.freio.puxado and sum("vigia de volta" in m for m in caplog.messages) == 1
    a.fila.fechar()


def test_sem_detector_ou_com_o_intervalo_zerado_nao_ha_vigia(tmp_path):
    a, fonte, _ = auditoria(tmp_path, ("presenca", "pessoa"), detector=None)
    assert a.vigia is None
    assert a.vigiar(MEIO_DIA) == {"enfileirados": 0, "alertas": 0, "subidos": 0, "extras": 0}
    a.fila.fechar()

    b, _, _ = auditoria(tmp_path / "b", ("presenca", "pessoa"), intervalo_rapido=0)
    assert b.vigia is None and b._espera(MEIO_DIA) == 30.0
    b.fila.fechar()


def test_canal_que_falha_na_olhada_extra_nao_derruba_a_volta(tmp_path):
    a, fonte, _ = auditoria(tmp_path, ("presenca", "pessoa"))
    a.volta(MEIO_DIA)
    fonte.pessoas = 0
    fonte.agora = MEIO_DIA + 10 * S

    def cai(*args, **kwargs):
        raise OSError("o gravador não respondeu")

    fonte.rajada = cai
    r = a.volta(fonte.agora)
    assert (r["extras"], r["enfileirados"]) == (1, 0)
    (l,) = linhas(a.fila).values()
    assert l["sem_quadro"] == 1, "e fica contado como canal sem quadro"
    a.fila.fechar()


@pytest.mark.parametrize("chave", ["olhada_extra"])
def test_a_marca_de_olhada_extra_nao_vai_a_modelo_nenhum(chave):
    from farol_agent.juizes import local, nuvem
    from farol_agent.juizes.seletor import CHAVES_DE_ROTA

    assert chave in CHAVES_DE_ROTA
    assert nuvem._montar_pedido("c", {"regra_id": "r1", chave: True}) == "CRITÉRIO A AUDITAR:\nc\n\nCONTEXTO DA OPERAÇÃO:\n- regra_id: r1"
    assert local._pedido("c", {"regra_id": "r1", chave: True}) == "CRITÉRIO A AUDITAR:\nc\n\nCONTEXTO DA OPERAÇÃO:\n- regra_id: r1"
