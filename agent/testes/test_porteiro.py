"""O porteiro e o "avisar só se continuar" (fase 1 do "local primeiro").

No primeiro dia inteiro de operação, 94% do que a loja gastou com a nuvem
voltou sem veredito — e mais da metade das perguntas de um canal foi feita
sem ninguém na imagem. O porteiro é a loja conferindo, de graça, se a
pergunta faz sentido antes de fazê-la.

O que se protege aqui:

- o porteiro só segura quando tem CERTEZA; na dúvida, sem detector ou com o
  detector falhando, a pergunta é feita;
- a olhada segurada não entra na fila, não chega ao juiz, e é contada como
  "nada a conferir" — um desfecho próprio, que fecha a conta das capturas;
- presença e contagem não passam por ele;
- "avisar só se continuar" avisa na olhada certa, com cena nova ou parada, e
  um conforme no meio zera a espera.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta

import numpy as np
import pytest

from farol_agent.auditoria import Auditoria
from farol_agent.configuracao import de_json
from farol_agent.contrato import evento_para_nuvem, resumo_para_nuvem
from farol_agent.fila import Fila
from farol_agent.modelos import EventoGatilho, Frame, Resultado, TipoRegra, Veredito, Via, Zona
from farol_agent.motor import MotorDeRegras
from farol_agent.porteiro import PORTEIROS, Porteiro
from testes.conftest import BASE, JuizFixo

from .test_auditoria import FonteBoa, JuizDeTeste, NuvemDeTeste
from .test_configuracao import resposta

T0 = datetime(2026, 10, 8, 20, 0, 0)


class Detector:
    """Devolve as pontuações combinadas e anota como foi chamado."""

    def __init__(self, *pontos: float, erro: Exception | None = None):
        self.pontos = list(pontos)
        self.erro = erro
        self.chamadas: list[str] = []

    def pontuar(self, imagem_bgr, classe):
        self.chamadas.append(classe)
        if self.erro:
            raise self.erro
        return list(self.pontos)


def cena(valor: int = 90, lado=(480, 640)) -> np.ndarray:
    return np.full((*lado, 3), valor, dtype=np.uint8)


def decidir(p: Porteiro, modo: str, img=None, *, lugar="r1@z1", area="p1:z1", ts=T0):
    return p.decidir(modo, cena() if img is None else img, lugar=lugar, area=area, ts=ts)


# ───────────────────────── com pessoa / com a área livre ─────────────────────────


def test_os_modos_sao_os_do_banco():
    # A lista do agente e o `check` da migration 023 têm de ser a mesma.
    assert PORTEIROS == ("sempre", "pessoa", "livre", "movimento")


def test_sempre_nem_consulta_o_detector():
    d = Detector(0.9)
    assert decidir(Porteiro(d), "sempre").vale is True
    assert d.chamadas == []


@pytest.mark.parametrize(
    "pontos, vale",
    [
        ((), False),             # o detector não achou nada
        ((0.02, 0.34), False),   # só ruído, abaixo da dúvida
        ((0.35,), True),         # um "talvez": na dúvida, pergunta
        ((0.50,), True),
        ((0.10, 0.92), True),    # alguém, com certeza
    ],
)
def test_com_pessoa_so_segura_quando_nao_ha_nem_um_talvez(pontos, vale):
    d = Porteiro(Detector(*pontos))
    decisao = decidir(d, "pessoa")
    assert decisao.vale is vale
    assert decisao.motivo == (None if vale else "ninguém na área")


@pytest.mark.parametrize(
    "pontos, vale",
    [
        ((), True),              # área livre: é o que o critério quer ver
        ((0.34,), True),
        ((0.69,), True),         # um "talvez": na dúvida, pergunta
        ((0.70,), False),        # alguém, com certeza, na frente
        ((0.20, 0.95), False),
    ],
)
def test_area_livre_so_segura_quando_ha_gente_com_certeza(pontos, vale):
    decisao = decidir(Porteiro(Detector(*pontos)), "livre")
    assert decisao.vale is vale
    assert decisao.motivo == (None if vale else "há gente na frente")


def test_os_limiares_sao_os_que_o_porteiro_recebe():
    # Os do detector (0,70 e 0,35) entram pela auditoria; o porteiro não
    # pode ter os dele escritos por dentro.
    p = Porteiro(Detector(0.5), certeza=0.45, duvida=0.55)
    assert decidir(p, "livre").vale is False, "0,5 é certeza quando a certeza é 0,45"
    assert decidir(p, "pessoa", ts=T0 + timedelta(seconds=1)).vale is False, "0,5 não é nem dúvida quando a dúvida é 0,55"


def test_o_porteiro_procura_PESSOA():
    d = Detector(0.9)
    decidir(Porteiro(d, classe_pessoa="person"), "pessoa")
    assert d.chamadas == ["person"]


@pytest.mark.parametrize("modo", ["pessoa", "livre"])
def test_sem_detector_a_pergunta_e_feita(modo, caplog):
    p = Porteiro(None)
    with caplog.at_level("INFO"):
        assert decidir(p, modo).vale is True
        assert decidir(p, modo, ts=T0 + timedelta(seconds=30)).vale is True
    avisos = [r for r in caplog.records if "porteiro sem detector" in r.getMessage()]
    assert len(avisos) == 1, "avisa uma vez, não a cada olhada"


@pytest.mark.parametrize("modo", ["pessoa", "livre"])
def test_detector_que_falha_nao_cala_o_criterio(modo):
    p = Porteiro(Detector(erro=RuntimeError("sessão caiu")))
    assert decidir(p, modo).vale is True


def test_modo_que_o_agente_nao_conhece_pergunta():
    d = Detector()
    assert decidir(Porteiro(d), "outro").vale is True
    assert d.chamadas == []


def test_varios_criterios_na_mesma_area_contam_as_pessoas_uma_vez():
    d = Detector()
    p = Porteiro(d)
    decidir(p, "pessoa", lugar="r1@z1")
    decidir(p, "livre", lugar="r2@z1")
    decidir(p, "pessoa", lugar="r3@z1")
    assert len(d.chamadas) == 1, "três critérios da mesma área, na mesma olhada: o detector roda uma vez"

    decidir(p, "pessoa", lugar="r1@z1", ts=T0 + timedelta(seconds=30))
    assert len(d.chamadas) == 2, "outra olhada, outra conta"
    decidir(p, "pessoa", lugar="r1@z2", area="p1:z2", ts=T0 + timedelta(seconds=30))
    assert len(d.chamadas) == 3, "outra área, outra imagem, outra conta"


def test_a_conta_guardada_nao_vaza_de_uma_olhada_para_a_outra():
    d = Detector()               # ninguém
    p = Porteiro(d)
    assert decidir(p, "pessoa").vale is False
    d.pontos = [0.9]             # chegou alguém
    assert decidir(p, "pessoa", ts=T0 + timedelta(seconds=30)).vale is True


# ───────────────────────────── quando algo se mexe ─────────────────────────────


def com_bloco(base: np.ndarray, x: int, largura: int, valor: int = 220) -> np.ndarray:
    img = base.copy()
    img[100:300, x:x + largura] = valor
    return img


def test_movimento_a_primeira_olhada_pergunta():
    assert decidir(Porteiro(), "movimento").vale is True


def test_movimento_cena_parada_nao_pergunta():
    p = Porteiro()
    decidir(p, "movimento")
    d = decidir(p, "movimento")
    assert (d.vale, d.motivo) == (False, "nada se mexeu")


def test_movimento_ruido_de_camera_nao_e_movimento():
    p = Porteiro()
    base = cena(90)
    decidir(p, "movimento", base)
    rng = np.random.default_rng(7)
    ruido = np.clip(base.astype(np.int16) + rng.integers(-8, 9, base.shape), 0, 255).astype(np.uint8)
    assert decidir(p, "movimento", ruido).vale is False


def test_movimento_a_camera_clarear_um_pouco_nao_e_movimento():
    # A exposição automática sobe e desce o tom da imagem INTEIRA. Nada saiu do lugar.
    p = Porteiro()
    decidir(p, "movimento", cena(90))
    assert decidir(p, "movimento", cena(102)).vale is False


def test_movimento_algo_que_mudou_de_lugar_pergunta():
    p = Porteiro()
    decidir(p, "movimento", com_bloco(cena(), 100, 120))
    assert decidir(p, "movimento", com_bloco(cena(), 360, 120)).vale is True


def test_movimento_mudanca_pequena_demais_nao_pergunta():
    # Um ponto de 8 px num quadro de 640: some na redução.
    p = Porteiro()
    decidir(p, "movimento", cena())
    img = cena()
    img[200:208, 300:308] = 255
    assert decidir(p, "movimento", img).vale is False


def test_movimento_compara_com_a_olhada_ANTERIOR():
    # Mexeu, parou: a terceira olhada é igual à segunda, não à primeira.
    p = Porteiro()
    decidir(p, "movimento", com_bloco(cena(), 100, 120))
    assert decidir(p, "movimento", com_bloco(cena(), 360, 120)).vale is True
    assert decidir(p, "movimento", com_bloco(cena(), 360, 120)).vale is False
    # ...e voltar ao que era antes é movimento de novo.
    assert decidir(p, "movimento", com_bloco(cena(), 100, 120)).vale is True


def test_movimento_e_por_lugar():
    p = Porteiro()
    decidir(p, "movimento", cena(), lugar="r1@z1")
    assert decidir(p, "movimento", cena(), lugar="r1@z2").vale is True, "primeira olhada DESTE lugar"
    assert decidir(p, "movimento", cena(), lugar="r1@z1").vale is False


def test_movimento_nao_precisa_de_detector_e_aceita_imagem_cinza():
    p = Porteiro(None)
    cinza = np.full((480, 640), 90, dtype=np.uint8)
    assert decidir(p, "movimento", cinza).vale is True
    assert decidir(p, "movimento", cinza).vale is False


def test_esquecer_larga_o_criterio_que_saiu():
    p = Porteiro()
    decidir(p, "movimento", lugar="r1@z1")
    decidir(p, "movimento", lugar="r2@z1")
    p.esquecer({"r1@z1"})
    assert decidir(p, "movimento", lugar="r1@z1").vale is False, "o que ficou continua lembrado"
    assert decidir(p, "movimento", lugar="r2@z1").vale is True, "o que saiu recomeça do zero"


# ───────────────────────────── a configuração ─────────────────────────────


def _config(**campos):
    corpo = resposta()
    regra = corpo["pontos"][0]["zonas"][0]["regras"][0]
    regra.update(campos)
    return de_json(corpo).regras[0]


def test_a_configuracao_antiga_segue_como_era():
    r = _config()
    assert (r.porteiro, r.confirmar_em) == ("sempre", 1)


def test_a_configuracao_traz_o_porteiro_e_a_confirmacao():
    r = _config(porteiro="pessoa", confirmarEm=3)
    assert (r.porteiro, r.confirmar_em) == ("pessoa", 3)


def test_porteiro_desconhecido_volta_a_perguntar_sempre(caplog):
    with caplog.at_level("WARNING"):
        r = _config(porteiro="silhueta")
    assert r.porteiro == "sempre", "modo que este agente não conhece não pode calar o critério"
    assert any("silhueta" in m.getMessage() for m in caplog.records)


@pytest.mark.parametrize("bruto, esperado", [(None, 1), (0, 1), (-2, 1), ("3", 3), ("x", 1), (5, 5)])
def test_confirmacao_torta_vira_avisar_na_primeira(bruto, esperado):
    assert _config(confirmarEm=bruto).confirmar_em == esperado


# ───────────────────────────── a fila ─────────────────────────────


@pytest.fixture
def fila(tmp_path):
    f = Fila(tmp_path / "fila.db")
    yield f
    f.fechar()


def linha(fila, regra="r1", zona="z1", ts=BASE) -> dict:
    achadas = [
        l for l in fila._con.execute("select * from resumo_hora").fetchall()
        if l["hora"] == Fila.hora_de(ts) and l["regra_id"] == regra and l["zona_id"] == zona
    ]
    assert len(achadas) == 1, f"esperava uma linha para {regra}/{zona}, achei {len(achadas)}"
    return dict(achadas[0])


def test_fila_de_antes_ganha_a_coluna_sem_perder_o_que_tinha(tmp_path):
    caminho = tmp_path / "fila.db"
    f = Fila(caminho)
    f.contar(BASE, "r1", "z1", capturas=3, repetidas=3)
    f._con.execute("alter table resumo_hora drop column sem_condicao")
    f._con.commit()
    f.fechar()

    f = Fila(caminho)
    try:
        f.contar(BASE, "r1", "z1", capturas=1, sem_condicao=1)
        l = linha(f)
        assert (l["capturas"], l["repetidas"], l["sem_condicao"]) == (4, 3, 1)
    finally:
        f.fechar()


# ───────────────────────────── o motor ─────────────────────────────


def olhar(motor, fonte, ts):
    return motor.preparar(EventoGatilho(ponto_id=fonte.ponto_id, ts=ts), fonte)


def na_fila(fila) -> int:
    return fila._con.execute("select count(*) from analise").fetchone()[0]


def test_sem_ninguem_a_olhada_nao_vira_pergunta(fila, regra, fonte):
    regra = replace(regra, porteiro="pessoa")
    motor = MotorDeRegras(fila, [regra], porteiro=Porteiro(Detector()))
    juiz = JuizFixo(Resultado.NAO_CONFORME)

    p = olhar(motor, fonte, BASE)
    alertas = motor.processar(juiz, BASE + timedelta(seconds=2))

    assert (p.sem_condicao, p.enfileirados, p.repetidos) == (["r1"], [], [])
    assert na_fila(fila) == 0, "o que o porteiro segura não entra na fila"
    assert list(fila.spool.glob("*.jpg")) == [], "nem deixa imagem no disco"
    assert juiz.chamadas == 0 and alertas == []
    l = linha(fila)
    assert (l["capturas"], l["sem_condicao"], l["enfileiradas"]) == (1, 1, 0)
    assert l["ultimo_impedimento"] is None, "não é defeito de câmera"
    assert motor.sem_condicao["r1@z1"] == "ninguém na área"


def test_com_alguem_a_pergunta_e_feita(fila, regra, fonte):
    regra = replace(regra, porteiro="pessoa")
    motor = MotorDeRegras(fila, [regra], porteiro=Porteiro(Detector(0.9)))

    p = olhar(motor, fonte, BASE)

    assert (p.enfileirados, p.sem_condicao) == (["r1"], [])
    assert (linha(fila)["enfileiradas"], linha(fila)["sem_condicao"]) == (1, 0)


def test_area_livre_segura_com_gente_na_frente(fila, regra, fonte):
    regra = replace(regra, porteiro="livre")
    motor = MotorDeRegras(fila, [regra], porteiro=Porteiro(Detector(0.9)))

    assert olhar(motor, fonte, BASE).sem_condicao == ["r1"]
    assert motor.sem_condicao["r1@z1"] == "há gente na frente"


def test_criterio_de_sempre_nem_passa_pelo_porteiro(fila, regra, fonte):
    d = Detector()
    motor = MotorDeRegras(fila, [regra], porteiro=Porteiro(d))

    assert olhar(motor, fonte, BASE).enfileirados == ["r1"]
    assert d.chamadas == []


@pytest.mark.parametrize("tipo", [TipoRegra.PRESENCA, TipoRegra.CONTAGEM])
def test_presenca_e_contagem_nao_passam_pelo_porteiro(fila, regra, fonte, tipo):
    # A API não deixa gravar; mas se descer, o agente não pode parar de
    # medir o posto vazio porque "não há ninguém".
    d = Detector()
    regra = replace(regra, tipo=tipo, porteiro="pessoa")
    motor = MotorDeRegras(fila, [regra], porteiro=Porteiro(d))

    assert olhar(motor, fonte, BASE).enfileirados == ["r1"]
    assert d.chamadas == []


def test_motor_sem_porteiro_pergunta_em_toda_olhada(fila, regra, fonte):
    motor = MotorDeRegras(fila, [replace(regra, porteiro="pessoa")])
    assert olhar(motor, fonte, BASE).enfileirados == ["r1"]


def test_o_porteiro_vem_antes_da_memoria_de_cena_repetida(fila, regra):
    # A MESMA imagem duas vezes. Na primeira não havia ninguém; na segunda,
    # sim. Se a olhada segurada entrasse na memória de repetidas, a segunda
    # sairia como "repetida" e a pergunta nunca seria feita.
    d = Detector()
    regra = replace(regra, porteiro="pessoa")
    motor = MotorDeRegras(fila, [regra], porteiro=Porteiro(d))
    fonte = FonteBoa("ponto-teste")

    assert olhar(motor, fonte, BASE).sem_condicao == ["r1"]
    d.pontos = [0.9]
    assert olhar(motor, fonte, BASE + timedelta(seconds=10)).enfileirados == ["r1"]


def test_tela_de_sem_sinal_continua_sendo_defeito_de_camera(fila, regra):
    # Câmera sem sinal não é "ninguém na área": é câmera sem sinal.
    class TelaPreta:
        ponto_id = "ponto-teste"

        def rajada(self, ts, quantidade=6, stream="main"):
            return [
                Frame(np.zeros((480, 640, 3), dtype=np.uint8), ts + timedelta(milliseconds=200 * i), self.ponto_id)
                for i in range(quantidade)
            ]

    d = Detector()
    motor = MotorDeRegras(fila, [replace(regra, porteiro="pessoa")], porteiro=Porteiro(d))

    p = olhar(motor, TelaPreta(), BASE)

    assert (p.sem_cena, p.sem_condicao) == (["r1"], [])
    assert d.chamadas == []


def test_dois_criterios_na_mesma_area_rodam_o_detector_uma_vez(fila, regra, fonte):
    d = Detector(0.9)
    regras = [replace(regra, porteiro="pessoa"), replace(regra, id="r2", porteiro="pessoa")]
    motor = MotorDeRegras(fila, regras, porteiro=Porteiro(d))

    assert olhar(motor, fonte, BASE).enfileirados == ["r1", "r2"]
    assert len(d.chamadas) == 1


def test_a_olhada_segurada_fecha_a_conta_do_resumo(fila, regra, fonte):
    d = Detector()
    motor = MotorDeRegras(fila, [replace(regra, porteiro="pessoa")], porteiro=Porteiro(d))
    olhar(motor, fonte, BASE)                                 # ninguém
    d.pontos = [0.9]
    olhar(motor, fonte, BASE + timedelta(seconds=40))          # alguém

    corpo = resumo_para_nuvem(fila.resumos_a_subir()[0])

    assert (corpo["capturas"], corpo["semCondicao"], corpo["enfileiradas"]) == (2, 1, 1)
    desfechos = (
        "semJuiz", "semQuadro", "semCena", "semCondicao", "emSilencio", "repetidas", "jaJulgadas", "enfileiradas",
    )
    assert sum(corpo[x] for x in desfechos) == corpo["capturas"]


def test_movimento_no_motor_segura_a_cena_parada(fila, regra):
    regra = replace(regra, tipo=TipoRegra.ACAO, porteiro="movimento")
    motor = MotorDeRegras(fila, [regra], porteiro=Porteiro(None))
    fonte = FonteBoa("ponto-teste")

    assert olhar(motor, fonte, BASE).enfileirados == ["r1"], "primeira olhada: pergunta"
    p = olhar(motor, fonte, BASE + timedelta(seconds=40))
    assert p.sem_condicao == ["r1"], "nada se mexeu: é 'nada a conferir', não 'repetida'"
    assert motor.sem_condicao["r1@z1"] == "nada se mexeu"


# ───────────────────────── avisar só se continuar ─────────────────────────


class JuizDeRoteiro:
    """Devolve um veredito por chamada, na ordem dada."""

    nome = "roteiro"

    def __init__(self, *roteiro):
        self.roteiro = list(roteiro)
        self.chamadas = 0

    def julgar(self, imagem, criterio, *, contexto=None, referencias=None) -> Veredito:
        passo = self.roteiro[self.chamadas]
        self.chamadas += 1
        resultado, confianca = passo if isinstance(passo, tuple) else (passo, 0.95)
        return Veredito(
            resultado=resultado, confianca=confianca, motivo=f"olhada {self.chamadas}",
            via=Via.NUVEM, modelo="roteiro", custo_centavos=1.0,
        )


FORA, OK, SEI_LA = Resultado.NAO_CONFORME, Resultado.CONFORME, Resultado.NAO_AVALIAVEL


def rodar(motor, fonte, juiz, quantas, passo_seg=40, inicio=BASE):
    """`quantas` olhadas, cada uma seguida do julgamento. Devolve os avisos por olhada."""
    avisos = []
    for i in range(quantas):
        ts = inicio + timedelta(seconds=passo_seg * i)
        olhar(motor, fonte, ts)
        avisos.append(motor.processar(juiz, ts + timedelta(seconds=2)))
    return avisos


def test_avisar_na_primeira_continua_sendo_o_padrao(fila, regra, fonte):
    motor = MotorDeRegras(fila, [regra])
    avisos = rodar(motor, fonte, JuizDeRoteiro(FORA), 1)
    assert [len(a) for a in avisos] == [1]


def test_so_avisa_na_olhada_pedida(fila, regra, fonte):
    motor = MotorDeRegras(fila, [replace(regra, confirmar_em=3)])
    juiz = JuizDeRoteiro(FORA, FORA, FORA)

    avisos = rodar(motor, fonte, juiz, 3)

    assert [len(a) for a in avisos] == [0, 0, 1]
    assert avisos[2][0].motivo == "olhada 3", "o aviso sai com o julgamento que o confirmou"
    l = linha(fila)
    assert (l["nao_conformes"], l["alertas"]) == (3, 1)


def test_um_conforme_no_meio_zera_a_espera(fila, regra, fonte):
    motor = MotorDeRegras(fila, [replace(regra, confirmar_em=3)])
    juiz = JuizDeRoteiro(FORA, FORA, OK, FORA, FORA, FORA)

    avisos = rodar(motor, fonte, juiz, 6)

    assert [len(a) for a in avisos] == [0, 0, 0, 0, 0, 1]


def test_nao_deu_para_avaliar_nao_confirma_nem_desmente(fila, regra, fonte):
    motor = MotorDeRegras(fila, [replace(regra, confirmar_em=3)])
    juiz = JuizDeRoteiro(FORA, FORA, SEI_LA, FORA)

    avisos = rodar(motor, fonte, juiz, 4)

    assert [len(a) for a in avisos] == [0, 0, 0, 1]


def test_fora_do_criterio_com_pouca_confianca_nao_conta(fila, regra, fonte):
    motor = MotorDeRegras(fila, [replace(regra, confirmar_em=2)])
    juiz = JuizDeRoteiro(FORA, (FORA, 0.40), FORA)

    avisos = rodar(motor, fonte, juiz, 3)

    assert [len(a) for a in avisos] == [0, 0, 1]


def test_a_cena_que_nao_mudou_conta_como_continuar(fila, regra):
    # A bancada suja parada é a MESMA imagem: ela não é julgada de novo, e
    # é justamente o caso em que o aviso tem de sair.
    motor = MotorDeRegras(fila, [replace(regra, confirmar_em=3)], serializar=evento_para_nuvem)
    juiz = JuizDeRoteiro(FORA)
    fonte = FonteBoa("ponto-teste")

    avisos = rodar(motor, fonte, juiz, 3, passo_seg=10)
    # O aviso confirmado pela terceira olhada sai no despacho seguinte a ela.
    assert [len(a) for a in avisos] == [0, 0, 1]
    assert juiz.chamadas == 1, "a cena parada não é paga de novo"

    (aviso,) = avisos[2]
    assert aviso.motivo == "olhada 1", "sai com o julgamento que estava esperando"
    assert BASE <= aviso.ts < BASE + timedelta(seconds=1), (
        "o evento leva o instante da IMAGEM julgada, não o da olhada que confirmou"
    )

    l = linha(fila)
    assert (l["capturas"], l["enfileiradas"], l["repetidas"]) == (3, 1, 2)
    assert (l["nao_conformes"], l["alertas"]) == (1, 1)
    assert len(fila.eventos_a_subir()) == 1, "o aviso sobe para a nuvem como qualquer outro"


def test_o_silencio_conta_a_partir_da_olhada_que_confirmou(fila, regra):
    motor = MotorDeRegras(fila, [replace(regra, confirmar_em=3, cooldown_min=15)])
    fonte = FonteBoa("ponto-teste")
    rodar(motor, fonte, JuizDeRoteiro(FORA), 3, passo_seg=10)

    assert fila.ultimo_alerta("r1", "z1") == BASE + timedelta(seconds=20)

    p = olhar(motor, fonte, BASE + timedelta(minutes=1))
    assert p.em_silencio == ["r1"], "depois do aviso, o critério cala"


def test_o_aviso_confirmado_pela_cena_parada_sai_uma_vez_so(fila, regra):
    # Sem silêncio (cooldown 0), nada segura um segundo aviso — a não ser o
    # próprio motor largar a espera e a lista do que já confirmou.
    motor = MotorDeRegras(fila, [replace(regra, confirmar_em=2, cooldown_min=0)])
    avisos = rodar(motor, FonteBoa("ponto-teste"), JuizDeRoteiro(FORA), 4, passo_seg=5)
    assert [len(a) for a in avisos] == [0, 1, 0, 0]
    assert linha(fila)["alertas"] == 1


def test_sem_avisar_se_continuar_a_cena_parada_nao_gera_aviso_novo(fila, regra):
    motor = MotorDeRegras(fila, [replace(regra, cooldown_min=0)])
    avisos = rodar(motor, FonteBoa("ponto-teste"), JuizDeRoteiro(FORA), 3, passo_seg=10)
    assert [len(a) for a in avisos] == [1, 0, 0]


def test_cena_parada_depois_de_um_conforme_nao_conta(fila, regra):
    motor = MotorDeRegras(fila, [replace(regra, confirmar_em=2)])
    avisos = rodar(motor, FonteBoa("ponto-teste"), JuizDeRoteiro(OK), 4, passo_seg=10)
    assert [len(a) for a in avisos] == [0, 0, 0, 0]


def test_a_espera_e_por_canal(fila, regra, fonte):
    outra = Zona(id="z2", nome="outra área", poligono=[(0.2, 0.2), (0.8, 0.2), (0.8, 0.8), (0.2, 0.8)])
    r1 = replace(regra, confirmar_em=2)
    r2 = replace(r1, zona=outra)
    motor = MotorDeRegras(fila, [r1, r2])
    # Por olhada, as duas áreas são julgadas: z1 e z2, nesta ordem.
    juiz = JuizDeRoteiro(FORA, OK, FORA, FORA)

    avisos = rodar(motor, fonte, juiz, 2)

    assert [[a.zona_id for a in x] for x in avisos] == [[], ["z1"]], "z2 só tem um fora do critério"


def test_presenca_tambem_espera_continuar(fila, regra, fonte):
    motor = MotorDeRegras(fila, [replace(regra, tipo=TipoRegra.PRESENCA, confirmar_em=3)])
    avisos = rodar(motor, fonte, JuizDeRoteiro(FORA, FORA, FORA), 3)
    assert [len(a) for a in avisos] == [0, 0, 1]


def test_sem_ninguem_na_area_a_espera_recomeca(fila, regra, fonte):
    # Uniforme: fora do critério, a pessoa saiu, voltou outra. Não é "continuou".
    d = Detector(0.9)
    motor = MotorDeRegras(fila, [replace(regra, porteiro="pessoa", confirmar_em=2)], porteiro=Porteiro(d))
    juiz = JuizDeRoteiro(FORA, FORA, FORA)

    assert rodar(motor, fonte, juiz, 1) == [[]]
    d.pontos = []
    assert rodar(motor, fonte, juiz, 1, inicio=BASE + timedelta(seconds=40)) == [[]]
    d.pontos = [0.9]
    avisos = rodar(motor, fonte, juiz, 2, inicio=BASE + timedelta(seconds=80))

    assert [len(a) for a in avisos] == [0, 1], "recomeçou do zero: precisa de duas de novo"


def test_gente_na_frente_nao_zera_a_espera(fila, regra, fonte):
    # Limpeza: a sujeira não saiu porque alguém passou na frente.
    d = Detector()
    motor = MotorDeRegras(fila, [replace(regra, porteiro="livre", confirmar_em=2)], porteiro=Porteiro(d))
    juiz = JuizDeRoteiro(FORA, FORA)

    assert rodar(motor, fonte, juiz, 1) == [[]]
    d.pontos = [0.9]
    assert rodar(motor, fonte, juiz, 1, inicio=BASE + timedelta(seconds=40)) == [[]]
    d.pontos = []
    avisos = rodar(motor, fonte, juiz, 1, inicio=BASE + timedelta(seconds=80))

    assert [len(a) for a in avisos] == [1]


# ─────────────────────── a auditoria liga o porteiro ───────────────────────

# Terça-feira ao meio-dia: dentro da janela da regra do dublê de configuração.
MEIO_DIA = datetime(2026, 10, 6, 12, 0, 0)


class JuizDetectorDeMentira:
    """O que `_detector_local()` devolve: o juiz, com o motor dentro."""

    def __init__(self, motor):
        self.motor = motor


def auditoria(tmp_path, fabrica_do_detector, *, juiz=None, **campos_da_regra):
    corpo = resposta(versao=1)
    corpo["pontos"][0]["zonas"][0]["regras"][0].update(campos_da_regra)
    a = Auditoria(
        NuvemDeTeste(),
        str(tmp_path / "fila.db"),
        construir_fonte=lambda ponto: FonteBoa(ponto.id),
        construir_juiz=lambda cfg: juiz or JuizDeTeste(),
    )
    a._detector_do_porteiro = fabrica_do_detector
    a.montar(de_json(corpo))
    return a, corpo


def test_a_auditoria_entrega_ao_porteiro_o_detector_da_loja(tmp_path):
    from farol_agent.juizes.detector import CERTEZA, DUVIDA, OBJETOS

    d = Detector()                      # ninguém na imagem
    juiz = JuizDeTeste()
    a, _ = auditoria(tmp_path, lambda: JuizDetectorDeMentira(d), juiz=juiz, porteiro="pessoa")

    r = a.passo(MEIO_DIA)

    assert d.chamadas == [OBJETOS["pessoa"]], "o porteiro pergunta ao detector por PESSOA"
    assert (r["enfileirados"], juiz.chamadas) == (0, 0), "sem ninguém, a nuvem não é chamada"
    (l,) = a.fila._con.execute("select * from resumo_hora").fetchall()
    assert (l["capturas"], l["sem_condicao"]) == (1, 1)
    p = a.motor._porteiro
    assert (p.certeza, p.duvida) == (CERTEZA, DUVIDA), "os limiares são os do detector"
    a.fila.fechar()


def test_com_gente_a_pergunta_sobe_ate_o_juiz(tmp_path):
    juiz = JuizDeTeste()
    a, _ = auditoria(tmp_path, lambda: JuizDetectorDeMentira(Detector(0.9)), juiz=juiz, porteiro="pessoa")

    a.passo(MEIO_DIA)

    assert juiz.chamadas == 1
    a.fila.fechar()


def test_sem_detector_instalado_o_criterio_segue_perguntando(tmp_path):
    juiz = JuizDeTeste()
    a, _ = auditoria(tmp_path, lambda: None, juiz=juiz, porteiro="pessoa")

    a.passo(MEIO_DIA)

    assert juiz.chamadas == 1, "o porteiro não decide o que não consegue ver"
    a.fila.fechar()


def test_sem_criterio_que_peca_o_porteiro_nao_e_criado(tmp_path):
    chamadas = []

    def fabrica():
        chamadas.append(1)
        return None

    a, _ = auditoria(tmp_path, fabrica)

    assert a.motor._porteiro is None
    assert chamadas == [], "nem se mexe no detector à toa"
    a.fila.fechar()


def test_o_porteiro_e_o_mesmo_quando_a_configuracao_muda(tmp_path):
    # Ele guarda a cena anterior de cada lugar: recriá-lo a cada edição no
    # console faria "quando algo se mexe" perguntar de novo à toa.
    a, corpo = auditoria(tmp_path, lambda: None, tipo="acao", porteiro="movimento")
    antes = a.motor._porteiro
    a.passo(MEIO_DIA)
    assert antes._anterior, "a primeira olhada ficou guardada"

    corpo["versao"] = 2
    a.montar(de_json(corpo))

    assert a.motor._porteiro is antes
    assert "r1@z1" in antes._anterior, "a memória do lugar que continua não foi apagada"
    a.fila.fechar()


def test_criterio_que_saiu_e_esquecido_pelo_porteiro(tmp_path):
    a, corpo = auditoria(tmp_path, lambda: None, tipo="acao", porteiro="movimento")
    a.passo(MEIO_DIA)
    porteiro = a.motor._porteiro

    # O critério passa a valer só com outro id (o antigo saiu da loja).
    corpo["versao"] = 2
    corpo["pontos"][0]["zonas"][0]["regras"][0]["id"] = "r9"
    a.montar(de_json(corpo))

    assert list(porteiro._anterior) == []
    a.fila.fechar()
