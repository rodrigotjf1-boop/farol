"""O quadro de bancada: a imagem só sai quando as mãos saíram (A19, onda 1, fatia 1.4).

Na posição de montagem o borrão de rosto não serve (de cima não há rosto, e ele
apagava o pão) e o detector de pessoas também não (vê braço e mão, não gente —
15% de certeza numa hora em que o tampo mudava em 82% das olhadas). O que diz
"as mãos saíram" é o MOVIMENTO, medido de meio em meio segundo no fluxo menor:
quieto há um segundo e meio.

O que se protege aqui:

- a quietude: três amostras seguidas sem movimento, recentes, é quieto; uma
  que mexeu é "não"; o que falta saber é "não sei" — e "não sei" não é quieto;
- no motor: com mão na frente a olhada do quadro de bancada é "nada a
  conferir" e fica anotada; com o quadro quieto ela sai;
- sem o borrão de rosto só vai o quadro quieto em que o detector não vê
  NINGUÉM, nem um "talvez"; no resto — não se sabe se está quieto, há alguém
  à vista, não há detector — a imagem sai como sempre saiu, com o borrão;
- a porta vem antes do estudo: a olhada que não pode sair não gasta o gatilho;
- só o quadro com o papel "posição de montagem", e só o critério que manda
  imagem para julgar;
- a auditoria refaz a olhada quando o quadro para — só a daquele critério, e
  sem virar fila de aberturas do fluxo principal;
- o laço acorda de segundo em segundo enquanto há olhada esperando, e o vigia
  NÃO vai junto: ele continua com o passo dele.
"""

from __future__ import annotations

import threading
import time
from dataclasses import replace
from datetime import datetime, timedelta
from itertools import count
from types import SimpleNamespace

import cv2
import numpy as np
import pytest

from farol_agent import porteiro, quietude
from farol_agent.auditoria import ESPERA_DA_BANCADA, MAX_REFEITAS_POR_VOLTA, Auditoria
from farol_agent.configuracao import de_json
from farol_agent.contexto import PAPEIS
from farol_agent.fila import Fila
from farol_agent.juizes.detector import DUVIDA, OBJETOS
from farol_agent.modelos import Condicao, Estudo, EventoGatilho, Frame, Resultado, TipoRegra, Zona
from farol_agent.motor import PAPEL_DE_BANCADA, MotorDeRegras
from farol_agent.pipeline import recorte
from farol_agent.quietude import AMOSTRAS_QUIETAS, PASSO, VELHO, Quietude
from farol_agent.sinais import Sinais
from testes.conftest import BASE

from .test_auditoria import JuizDeTeste, NuvemDeTeste
from .test_configuracao import resposta
from .test_foto_padrao import cena as cozinha
from .test_foto_padrao import com_objeto

P = "p1"
MONTAGEM = Zona(id="zm", nome="Montagem", poligono=[(0.05, 0.30), (0.70, 0.30), (0.70, 0.85), (0.05, 0.85)], ponto_id=P, numero=2, papel="montagem")
CUBAS = Zona(id="zq", nome="Cubas", poligono=[(0.05, 0.05), (0.70, 0.05), (0.70, 0.25), (0.05, 0.25)], ponto_id=P, numero=1, papel="cuba")
# Uma bancada de canto: o desenho é um triângulo, e o retângulo em volta dele tem o que NÃO é dela.
CANTO = Zona(id="zt", nome="Canto", poligono=[(0.1, 0.1), (0.9, 0.1), (0.1, 0.9)], ponto_id=P, numero=3, papel="montagem")
MEIO_MINUTO = timedelta(seconds=30)
TERCA_MEIO_DIA = datetime(2026, 10, 6, 12, 0, 0)
NADA = {"enfileirados": 0, "alertas": 0, "subidos": 0, "refeitas": 0}

LIMPA = cozinha(352, 198)
# Uma "mão" em dois lugares do quadro de montagem, e um objeto fora dele (nas cubas).
MAO_A = com_objeto(LIMPA, 0.20, 0.45, 0.05)
MAO_B = com_objeto(LIMPA, 0.45, 0.60, 0.05)
NAS_CUBAS = com_objeto(LIMPA, 0.30, 0.08, 0.02)


class Relogio:
    def __init__(self, agora: datetime = TERCA_MEIO_DIA) -> None:
        self.agora = agora

    def __call__(self) -> datetime:
        return self.agora

    def passar(self, segundos: float) -> None:
        self.agora += timedelta(seconds=segundos)


class Tique:
    """Um relógio que anda sozinho: cada pergunta, um milésimo de segundo depois."""

    def __init__(self) -> None:
        self._n = count()

    def __call__(self) -> datetime:
        return TERCA_MEIO_DIA + timedelta(milliseconds=next(self._n))


class FonteDaBancada:
    """O fluxo principal (a rajada) e o menor (o último quadro), os dois nas mãos do teste."""

    def __init__(self, relogio, ponto_id: str = P) -> None:
        self.relogio = relogio
        self.ponto_id = ponto_id
        self.imagem = cozinha(640, 360)        # o que o fluxo principal entrega
        self.menor: np.ndarray | None = LIMPA   # o que o fluxo menor entrega
        self.parado = False                    # o fluxo menor parou de entregar quadro novo
        self.aberturas = 0
        self._ts: datetime | None = None

    def rajada(self, ts, quantidade=6, stream="main"):
        self.aberturas += 1
        return [Frame(self.imagem.copy(), ts + timedelta(milliseconds=100 * i), self.ponto_id) for i in range(quantidade)]

    def quadro_do_fluxo_menor(self):
        if self.menor is None:
            return None
        if not self.parado or self._ts is None:
            self._ts = self.relogio()
        return Frame(self.menor.copy(), self._ts, self.ponto_id, stream="sub")

    def fechar(self):
        pass


def bancada(*zonas: Zona, **da_quietude) -> tuple[Quietude, Relogio, FonteDaBancada]:
    relogio = Relogio()
    q = Quietude(relogio=relogio, **da_quietude)
    q.montar({P: list(zonas or (MONTAGEM,))})
    return q, relogio, FonteDaBancada(relogio)


def amostrar(q: Quietude, relogio: Relogio, fonte: FonteDaBancada, *imagens) -> None:
    """Uma amostra por imagem, de meio em meio segundo. `...` repete a imagem que estava."""
    for img in imagens:
        if img is not ...:
            fonte.menor = img
        relogio.passar(PASSO)
        q.amostrar({P: fonte})


def quieta(q: Quietude, relogio: Relogio, fonte: FonteDaBancada, zona_id: str = "zm") -> None:
    """Deixa o quadro quieto: a cena limpa, pelo tempo que basta (dois segundos)."""
    amostrar(q, relogio, fonte, *([LIMPA] * (AMOSTRAS_QUIETAS + 1)))
    assert q.quieto(P, zona_id) is True


def mexendo(q: Quietude, relogio: Relogio, fonte: FonteDaBancada) -> None:
    """Põe a mão no quadro, mexendo (um segundo)."""
    amostrar(q, relogio, fonte, MAO_A, MAO_B)
    assert q.quieto(P, "zm") is False


@pytest.fixture
def fila(tmp_path):
    f = Fila(tmp_path / "fila.db")
    yield f
    f.fechar()


@pytest.fixture
def borroes(monkeypatch):
    """Conta quantas vezes o borrão de rosto foi chamado, sem borrar nada."""
    chamadas: list[tuple[int, int]] = []

    def falso(frame):
        chamadas.append(tuple(frame.imagem.shape[:2]))
        return frame, False

    monkeypatch.setattr(recorte, "borrar_rostos", falso)
    return chamadas


def olhar(motor: MotorDeRegras, fonte, ts: datetime):
    return motor.preparar(EventoGatilho(ponto_id=fonte.ponto_id, ts=ts), fonte)


def linhas(fila: Fila) -> dict[str, dict]:
    return {f"{l['regra_id']}@{l['zona_id']}": dict(l) for l in fila._con.execute("select * from resumo_hora")}


def na_montagem(regra, **mais):
    return replace(regra, zona=MONTAGEM, borrar_rosto=True, **mais)


def ninguem(imagem, lugar, ts) -> list[float]:
    """O detector de pessoas que olha e não vê ninguém."""
    return []


# ══════════════════════════ a quietude ══════════════════════════


def test_o_papel_do_quadro_de_bancada_e_a_posicao_de_montagem():
    assert PAPEL_DE_BANCADA == "montagem" and PAPEIS[PAPEL_DE_BANCADA] == "posição de montagem"
    assert (PASSO, AMOSTRAS_QUIETAS, VELHO) == (0.5, 3, timedelta(seconds=2)), "quieto é: nada mexeu em um segundo e meio"


def test_tres_amostras_seguidas_sem_movimento_e_quieto():
    q, relogio, fonte = bancada()
    estados = []
    for img in (LIMPA, LIMPA, LIMPA, LIMPA, MAO_A, MAO_B, LIMPA, LIMPA, LIMPA, LIMPA):
        amostrar(q, relogio, fonte, img)
        estados.append(q.quieto(P, "zm"))
    assert estados == [
        None, None, None,      # a primeira amostra não tem com o que comparar: são precisas mais três
        True,
        False, False,          # a mão entrou, e mudou de lugar
        False, False,          # saiu (o quadro mudou de novo), e ainda não deu um segundo e meio
        False,                 # nas três últimas, uma ainda é a da mão saindo
        True,                  # um segundo e meio sem mexer: as mãos saíram
    ]


def test_duas_amostras_paradas_ainda_nao_sao_um_segundo_e_meio():
    # Direto na memória do quadro: a regra das três não pode depender de a primeira amostra ser sempre "não sei".
    q, relogio, _ = bancada()
    amostras = q._quadros[P]["zm"].amostras
    amostras.extend([(relogio.agora, False), (relogio.agora, False)])
    assert q.quieto(P, "zm") is None
    amostras.append((relogio.agora, False))
    assert q.quieto(P, "zm") is True


def test_o_que_mexe_fora_do_quadro_nao_conta():
    q, relogio, fonte = bancada()
    quieta(q, relogio, fonte)
    amostrar(q, relogio, fonte, NAS_CUBAS, LIMPA, NAS_CUBAS)
    assert q.quieto(P, "zm") is True, "mexeram nas cubas, não na montagem"
    # ...e cada quadro tem a sua conta.
    dois, relogio, fonte = bancada(MONTAGEM, CUBAS)
    amostrar(dois, relogio, fonte, LIMPA, LIMPA, LIMPA, LIMPA, NAS_CUBAS)
    assert (dois.quieto(P, "zm"), dois.quieto(P, "zq")) == (True, False)


def test_no_quadro_desenhado_por_pontos_so_conta_o_que_esta_dentro_do_desenho():
    # O objeto fica no retângulo que envolve o triângulo, do lado de fora do desenho.
    fora = com_objeto(LIMPA, 0.70, 0.70, 0.02)
    dentro = com_objeto(LIMPA, 0.20, 0.20, 0.02)
    q, relogio, fonte = bancada(CANTO)
    quieta(q, relogio, fonte, "zt")
    amostrar(q, relogio, fonte, fora, LIMPA, fora)
    assert q.quieto(P, "zt") is True, "mexeram ao lado da bancada de canto"
    amostrar(q, relogio, fonte, dentro)
    assert q.quieto(P, "zt") is False


def test_nao_sei_nao_e_quieto():
    q, relogio, fonte = bancada()
    assert q.quieto(P, "zm") is None, "sem amostra nenhuma"
    assert q.quieto(P, "outro") is None and q.quieto("p9", "zm") is None, "quadro que ninguém acompanha"
    assert Quietude().quieto(P, "zm") is None

    # O fluxo menor parou de entregar quadro novo: a amostra existe, e não diz nada.
    quieta(q, relogio, fonte)
    fonte.parado = True
    amostrar(q, relogio, fonte, ...)
    assert q.quieto(P, "zm") is None
    # Voltou: a primeira amostra depois do buraco não tem com o que comparar.
    fonte.parado = False
    amostrar(q, relogio, fonte, ..., ..., ...)
    assert q.quieto(P, "zm") is None
    amostrar(q, relogio, fonte, ...)
    assert q.quieto(P, "zm") is True

    # Sem fluxo menor nenhum, e com fonte que nem tem fluxo menor.
    fonte.menor = None
    amostrar(q, relogio, fonte, ...)
    assert q.quieto(P, "zm") is None
    q.amostrar({P: object()})
    q.amostrar({})
    assert q.quieto(P, "zm") is None


def test_quadro_que_nao_deu_para_medir_e_um_buraco_e_nao_derruba_a_medida():
    q, relogio, fonte = bancada()
    quieta(q, relogio, fonte)
    amostrar(q, relogio, fonte, np.zeros(7, dtype=np.uint8))       # um quadro rasgado
    assert q.quieto(P, "zm") is None
    # Como depois do fluxo parado: a primeira amostra boa não tem com o que comparar.
    amostrar(q, relogio, fonte, LIMPA, LIMPA, LIMPA)
    assert q.quieto(P, "zm") is None
    amostrar(q, relogio, fonte, LIMPA)
    assert q.quieto(P, "zm") is True


def test_mas_uma_amostra_que_mexeu_basta_para_dizer_que_nao():
    # Mexeu, e logo depois o fluxo parou: não se sabe se continua mexendo — mas quieto não está.
    q, relogio, fonte = bancada()
    quieta(q, relogio, fonte)
    amostrar(q, relogio, fonte, MAO_A)
    fonte.parado = True
    amostrar(q, relogio, fonte, ...)
    assert q.quieto(P, "zm") is False


def test_amostra_velha_nao_diz_como_o_quadro_esta_agora():
    q, relogio, fonte = bancada()
    quieta(q, relogio, fonte)
    relogio.passar(VELHO.total_seconds())
    assert q.quieto(P, "zm") is True, "dois segundos ainda vale"
    relogio.passar(0.1)
    assert q.quieto(P, "zm") is None, "passou disso a medida parou: não se sabe"
    # Relógio que andou para trás também não é "agora".
    relogio.passar(-60)
    assert q.quieto(P, "zm") is None


def test_a_medida_do_movimento_e_a_do_porteiro():
    q = Quietude()
    assert (q.salto, q.parte) == (porteiro.SALTO_DO_PONTO, porteiro.PARTE_QUE_MUDOU)
    assert quietude._LADO == porteiro._MOVIMENTO_LADO

    def com(imagens, **limiares):
        q, relogio, fonte = bancada(**limiares)
        amostrar(q, relogio, fonte, *imagens)
        return q.quieto(P, "zm")

    # Os limiares são os que o construtor recebe: com um que nada alcança, a mão não é movimento...
    assert com([LIMPA, MAO_A, MAO_B, MAO_A]) is False
    assert com([LIMPA, MAO_A, MAO_B, MAO_A], parte=0.99) is True
    assert com([LIMPA, MAO_A, MAO_B, MAO_A], salto=255) is True
    # ...e "mudou" é a parte chegar ao limiar (com zero, até o quadro parado chega)...
    assert com([LIMPA] * 4, parte=0.0) is False
    # ...de pontos que saltaram MAIS que o salto (com zero, o ponto igual não saltou).
    assert com([LIMPA] * 4, salto=0) is True


def test_o_movimento_e_medido_no_claro_e_escuro_e_nao_na_cor():
    # A mesma mancha em duas cores de mesmo cinza: para a medida, nada mudou.
    def mancha(cor):
        img = LIMPA.copy()
        cv2.rectangle(img, (70, 80), (140, 118), cor, -1)
        return img

    azul, vermelha = mancha((100, 0, 0)), mancha((0, 0, 38))
    assert int(cv2.cvtColor(azul, cv2.COLOR_BGR2GRAY)[90, 100]) == int(cv2.cvtColor(vermelha, cv2.COLOR_BGR2GRAY)[90, 100])
    q, relogio, fonte = bancada()
    amostrar(q, relogio, fonte, azul, azul, vermelha, azul)
    assert q.quieto(P, "zm") is True

    # E câmera que entrega em tons de cinza é medida do mesmo jeito.
    def cinza(img):
        return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    q, relogio, fonte = bancada()
    amostrar(q, relogio, fonte, *[cinza(LIMPA)] * 4)
    assert q.quieto(P, "zm") is True
    amostrar(q, relogio, fonte, cinza(MAO_A))
    assert q.quieto(P, "zm") is False


def test_remontar_guarda_a_memoria_do_quadro_que_continua_e_larga_a_do_que_mudou():
    q, relogio, fonte = bancada(MONTAGEM, CUBAS)
    amostrar(q, relogio, fonte, LIMPA, LIMPA, LIMPA, LIMPA)
    assert (q.quieto(P, "zm"), q.quieto(P, "zq")) == (True, True) and q.canais == [P]

    # A configuração mudou: a montagem é a mesma (outro nome), as cubas foram redesenhadas.
    redesenhada = replace(CUBAS, poligono=[(0.05, 0.05), (0.60, 0.05), (0.60, 0.25), (0.05, 0.25)])
    q.montar({P: [replace(MONTAGEM, nome="Montagem 1"), redesenhada]})
    assert q.quieto(P, "zm") is True, "o mesmo quadro: a memória continua"
    assert q.quieto(P, "zq") is None, "outro recorte: a memória não vale"

    # Canal sem quadro nenhum não é acompanhado; e, saindo o canal, nada mais é medido ali.
    q.montar({P: []})
    assert q.canais == [] and q.quieto(P, "zm") is None
    q.montar({})
    assert q.canais == []
    q.amostrar({P: fonte})          # e amostrar sem nada a acompanhar não faz nada


def test_a_quietude_nunca_abre_fluxo():
    q, relogio, fonte = bancada()
    amostrar(q, relogio, fonte, LIMPA, MAO_A, LIMPA, LIMPA)
    assert fonte.aberturas == 0


def test_fonte_que_quebra_nao_derruba_a_medida():
    class Quebrada:
        def quadro_do_fluxo_menor(self):
            raise OSError("fluxo caiu")

    q, relogio, _ = bancada()
    relogio.passar(PASSO)
    q.amostrar({P: Quebrada()})
    assert q.quieto(P, "zm") is None


def espera_ficar_quieto(q: Quietude, limite: float = 1.5) -> bool:
    fim = time.monotonic() + limite
    while q.quieto(P, "zm") is not True and time.monotonic() < fim:
        time.sleep(0.005)
    return q.quieto(P, "zm") is True


def test_em_thread_propria_a_quietude_mede_sozinha_no_passo_dela_e_para_quando_mandam():
    fonte = FonteDaBancada(Tique())
    q = Quietude(passo=0.01)
    q.montar({P: [MONTAGEM]})
    q.iniciar(lambda: {P: fonte})
    q.iniciar(lambda: {})           # chamar de novo não cria outra thread
    try:
        assert sum(t.name == "farol-quietude" for t in threading.enumerate()) == 1
        # Quatro amostras a um centésimo de segundo: no passo de fábrica (meio segundo) não daria tempo.
        assert espera_ficar_quieto(q), "mediu sozinha, e o quadro parado ficou quieto"
    finally:
        q.parar()
    assert q._thread is None and all(t.name != "farol-quietude" for t in threading.enumerate())
    antes = list(q._quadros[P]["zm"].amostras)
    time.sleep(0.05)
    assert list(q._quadros[P]["zm"].amostras) == antes, "parada, não mede mais"

    # E volta a medir quando mandam de novo (o agente que para e recomeça a auditoria).
    fonte.menor = MAO_A
    q.iniciar(lambda: {P: fonte})
    try:
        fim = time.monotonic() + 1.5
        while q.quieto(P, "zm") is not False and time.monotonic() < fim:
            time.sleep(0.005)
        assert q.quieto(P, "zm") is False, "a mão entrou depois de a medida recomeçar"
    finally:
        q.parar()


def test_erro_numa_amostra_nao_mata_a_thread():
    vezes = {"n": 0}
    fonte = FonteDaBancada(Tique())

    def fontes():
        vezes["n"] += 1
        if vezes["n"] <= 2:
            raise RuntimeError("configuração trocando")
        return {P: fonte}

    q = Quietude(passo=0.01)
    q.montar({P: [MONTAGEM]})
    q.iniciar(fontes)
    try:
        assert espera_ficar_quieto(q)
    finally:
        q.parar()


# ══════════════════════════ no motor ══════════════════════════


def o_motor(fila, regra, q, **mais):
    return MotorDeRegras(fila, [regra], quietude=q, zonas={z.id: z for z in (MONTAGEM, CUBAS)}, **mais)


def test_com_mao_na_frente_a_olhada_da_bancada_e_nada_a_conferir_e_fica_anotada(fila, regra, borroes):
    q, relogio, fonte = bancada()
    mexendo(q, relogio, fonte)
    motor = o_motor(fila, na_montagem(regra), q)

    p = olhar(motor, fonte, BASE)

    assert (p.sem_condicao, p.enfileirados) == (["r1"], [])
    assert motor.sem_condicao["r1@zm"] == "há movimento em Quadro 2 — Montagem: a olhada espera as mãos saírem"
    assert motor.esperando_as_maos == {P: {"r1@zm"}}
    assert list(fila.spool.glob("*.jpg")) == [] and borroes == [], "nada saiu, e nada foi borrado"
    l = linhas(fila)["r1@zm"]
    assert (l["capturas"], l["sem_condicao"], l["enfileiradas"]) == (1, 1, 0)

    # Quadro sem número (a nuvem antiga não manda): o nome vai sozinho.
    sem_numero = o_motor(fila, replace(na_montagem(regra, id="r2"), zona=replace(MONTAGEM, numero=None)), q)
    olhar(sem_numero, fonte, BASE)
    assert sem_numero.sem_condicao["r2@zm"] == "há movimento em Montagem: a olhada espera as mãos saírem"


def test_com_o_quadro_quieto_e_ninguem_a_vista_a_imagem_sai_sem_o_borrao_de_rosto(fila, regra, borroes):
    q, relogio, fonte = bancada()
    mexendo(q, relogio, fonte)
    motor = o_motor(fila, na_montagem(regra), q, pessoas=ninguem)
    olhar(motor, fonte, BASE)
    assert motor.esperando_as_maos == {P: {"r1@zm"}}

    quieta(q, relogio, fonte)
    p = olhar(motor, fonte, BASE + MEIO_MINUTO)

    assert p.enfileirados == ["r1"]
    assert borroes == [], "de cima não há rosto, e o borrão apagava o pão"
    assert motor.esperando_as_maos == {P: set()}, "a olhada saiu: não espera mais"
    assert len(list(fila.spool.glob("*.jpg"))) == 1


def test_sem_saber_se_esta_quieto_a_olhada_sai_como_sempre_com_o_borrao(fila, regra, borroes):
    q, _, fonte = bancada()                  # nenhuma amostra: não se sabe
    perguntas = []
    motor = o_motor(fila, na_montagem(regra), q, pessoas=lambda *a: perguntas.append(a) or [])
    p = olhar(motor, fonte, BASE)
    assert p.enfileirados == ["r1"] and len(borroes) == 1
    assert motor.esperando_as_maos == {P: set()}
    assert perguntas == [], "o detector só é perguntado com o quadro quieto"


def test_so_o_quadro_com_o_papel_de_montagem_espera_as_maos(fila, regra, borroes):
    q, relogio, fonte = bancada(MONTAGEM, CUBAS)
    amostrar(q, relogio, fonte, LIMPA, NAS_CUBAS, LIMPA, NAS_CUBAS)
    assert q.quieto(P, "zq") is False

    # Nas cubas há movimento, e o critério de lá é conferido como sempre — com o borrão.
    motor = o_motor(fila, replace(regra, zona=CUBAS, borrar_rosto=True), q, pessoas=ninguem)
    p = olhar(motor, fonte, BASE)
    assert p.enfileirados == ["r1"] and len(borroes) == 1
    assert motor.esperando_as_maos == {}


@pytest.mark.parametrize("tipo", [TipoRegra.PRESENCA, TipoRegra.CONTAGEM])
def test_presenca_e_contagem_na_bancada_nao_esperam_as_maos(fila, regra, tipo):
    q, relogio, fonte = bancada()
    mexendo(q, relogio, fonte)
    da_loja = na_montagem(regra, tipo=tipo, parametros={"objeto": "pessoa", "minimo": 1})
    motor = o_motor(fila, da_loja, q)
    assert olhar(motor, fonte, BASE).enfileirados == ["r1"]
    assert motor.esperando_as_maos == {}


def test_sem_a_quietude_o_quadro_de_bancada_e_tratado_como_qualquer_outro(fila, regra, borroes):
    motor = MotorDeRegras(fila, [na_montagem(regra)], pessoas=ninguem)
    assert olhar(motor, FonteDaBancada(Relogio()), BASE).enfileirados == ["r1"]
    assert len(borroes) == 1 and motor.esperando_as_maos == {}


def test_criterio_que_dispensa_o_borrao_continua_sem_ele(fila, regra, borroes):
    q, relogio, fonte = bancada()
    perguntas = []
    sem_borrao = replace(na_montagem(regra), borrar_rosto=False)
    motor = o_motor(fila, sem_borrao, q, pessoas=lambda *a: perguntas.append(a) or [0.9])
    assert olhar(motor, fonte, BASE).enfileirados == ["r1"]          # sem saber se está quieto
    quieta(q, relogio, fonte)
    fonte.imagem = cozinha(640, 360, semente=4)
    assert olhar(motor, fonte, BASE + MEIO_MINUTO).enfileirados == ["r1"]   # quieto, e com alguém à vista
    assert borroes == []
    assert perguntas == [], "a resposta do detector não mudaria nada: ele nem é perguntado"


def test_sem_o_borrao_so_vai_o_quadro_quieto_em_que_o_detector_nao_ve_ninguem(fila, regra, borroes):
    q, relogio, fonte = bancada()
    vistos: list[tuple[str, tuple[int, int]]] = []
    pontos = {"valor": []}

    def pessoas(imagem, lugar, ts):
        vistos.append((lugar, tuple(imagem.shape[:2])))
        return None if pontos["valor"] is None else list(pontos["valor"])

    motor = o_motor(fila, na_montagem(regra), q, pessoas=pessoas)
    casos = [
        ([], 0),                # o detector olhou e não viu ninguém
        ([0.34], 0),            # nem um "talvez"
        ([0.35], 1),            # bem no limiar já é "talvez alguém"
        ([0.10, 0.92], 1),      # alguém, com certeza — e não precisa ser o primeiro ponto
        (None, 1),              # o detector não respondeu: não se sabe
    ]
    for i, (valor, borrou) in enumerate(casos):
        pontos["valor"] = valor
        borroes.clear()
        quieta(q, relogio, fonte)
        fonte.imagem = cozinha(640, 360, semente=10 + i)
        p = olhar(motor, fonte, BASE + MEIO_MINUTO * i)
        assert p.enfileirados == ["r1"], f"{valor}: com alguém à vista a olhada NÃO é segurada — sai como sempre"
        assert len(borroes) == borrou, valor
    assert vistos[0] == (f"{P}:zm", (198, 416)), "o detector olhou o recorte do quadro de montagem"
    assert motor.esperando_as_maos == {P: set()}

    # O limiar é o que o construtor recebe (o do detector da loja).
    borroes.clear()
    exigente = o_motor(fila, na_montagem(regra, id="r2"), q, pessoas=lambda *a: [0.2], duvida=0.15)
    assert olhar(exigente, fonte, BASE + timedelta(minutes=5)).enfileirados == ["r2"] and len(borroes) == 1

    # E sem detector não há como dizer que não há ninguém: vai com o borrão.
    borroes.clear()
    sem_detector = o_motor(fila, na_montagem(regra, id="r3"), q)
    assert olhar(sem_detector, fonte, BASE + timedelta(minutes=5)).enfileirados == ["r3"] and len(borroes) == 1


def test_detector_que_quebra_nao_segura_a_olhada_e_a_imagem_vai_com_o_borrao(fila, regra, borroes, caplog):
    q, relogio, fonte = bancada()
    quieta(q, relogio, fonte)

    def quebrado(imagem, lugar, ts):
        raise RuntimeError("modelo corrompido")

    motor = o_motor(fila, na_montagem(regra), q, pessoas=quebrado)
    assert olhar(motor, fonte, BASE).enfileirados == ["r1"]
    assert len(borroes) == 1
    assert "o detector não olhou Quadro 2 — Montagem" in caplog.text


def test_com_movimento_o_detector_nem_e_chamado(fila, regra):
    q, relogio, fonte = bancada()
    mexendo(q, relogio, fonte)
    chamadas = []
    motor = o_motor(fila, na_montagem(regra), q, pessoas=lambda *a: chamadas.append(a) or [])
    assert olhar(motor, fonte, BASE).sem_condicao == ["r1"]
    assert chamadas == []


def test_a_olhada_que_nao_pode_sair_nao_gasta_o_gatilho_do_estudo(fila, regra):
    # "A cada dez minutos": se a porta da bancada viesse depois do estudo, a olhada segurada pela
    # mão contaria como a análise dos dez minutos — e a de verdade só viria dez minutos depois.
    q, relogio, fonte = bancada()
    com_estudo = na_montagem(regra, estudo=Estudo(gatilho=(Condicao("a_cada", minutos=10),)))
    motor = o_motor(fila, com_estudo, q, sinais=Sinais())

    mexendo(q, relogio, fonte)
    assert olhar(motor, fonte, BASE).sem_condicao == ["r1"]
    quieta(q, relogio, fonte)
    assert olhar(motor, fonte, BASE + MEIO_MINUTO).enfileirados == ["r1"], "o gatilho ainda estava inteiro"
    # ...e daí em diante o estudo manda: dez minutos até a próxima.
    fonte.imagem = cozinha(640, 360, semente=3)
    quieta(q, relogio, fonte)
    assert olhar(motor, fonte, BASE + 2 * MEIO_MINUTO).sem_gatilho == ["r1"]


def test_criterio_que_so_observa_tambem_espera_as_maos_o_funil_nao_conta_a_olhada_que_nao_sairia(fila, regra):
    q, relogio, fonte = bancada()
    perguntas = []
    motor = o_motor(fila, na_montagem(regra, estado="observando"), q, pessoas=lambda *a: perguntas.append(a) or [])

    mexendo(q, relogio, fonte)
    assert olhar(motor, fonte, BASE).sem_condicao == ["r1"]
    quieta(q, relogio, fonte)
    assert olhar(motor, fonte, BASE + MEIO_MINUTO).observadas == ["r1"]
    l = linhas(fila)["r1@zm"]
    assert (l["capturas"], l["sem_condicao"], l["observadas"]) == (2, 1, 1)
    assert perguntas == [], "a olhada que só é contada não manda imagem: o detector nem é perguntado"


def test_a_camera_parada_continua_aparecendo_como_camera_parada(fila, regra):
    q, relogio, fonte = bancada()
    mexendo(q, relogio, fonte)
    motor = o_motor(fila, na_montagem(regra), q)
    fonte.imagem = np.zeros((360, 640, 3), dtype=np.uint8)
    p = olhar(motor, fonte, BASE)
    assert p.sem_cena == ["r1"] and p.sem_condicao == [] and motor.esperando_as_maos == {}
    # A câmera voltou, com mão na frente: é "nada a conferir", não defeito.
    fonte.imagem = cozinha(640, 360)
    assert olhar(motor, fonte, BASE + MEIO_MINUTO).sem_condicao == ["r1"]
    assert motor.sem_cena == {}


def test_o_mesmo_criterio_em_dois_quadros_de_bancada_cada_um_espera_as_suas_maos(fila, regra, borroes):
    outra = replace(MONTAGEM, id="zn", nome="Montagem 2", numero=3, poligono=[(0.72, 0.30), (0.98, 0.30), (0.98, 0.85), (0.72, 0.85)])
    q, relogio, fonte = bancada(MONTAGEM, outra)
    # A mão está só na primeira montagem.
    amostrar(q, relogio, fonte, LIMPA, LIMPA, MAO_A, MAO_B)
    assert (q.quieto(P, "zm"), q.quieto(P, "zn")) == (False, True)

    motor = MotorDeRegras(fila, [na_montagem(regra), replace(na_montagem(regra), zona=outra)], quietude=q)
    olhar(motor, fonte, BASE)
    l = linhas(fila)
    assert (l["r1@zm"]["sem_condicao"], l["r1@zn"]["enfileiradas"]) == (1, 1)
    assert motor.esperando_as_maos == {P: {"r1@zm"}}


# ══════════════════════════ pela auditoria ══════════════════════════


class NinguemNoPosto:
    """O detector da loja de teste: olha e não vê ninguém, nunca."""

    class motor:  # noqa: N801
        @staticmethod
        def pontuar(imagem, classe):
            return []


def com_bancada(versao=7, nas_cubas=(), **da_regra) -> dict:
    """O canal de teste com dois quadros — as cubas e a montagem — e um critério na montagem.

    `nas_cubas` são critérios a mais, no quadro das cubas (que não é de bancada).
    """
    corpo = resposta(versao=versao)
    ponto = corpo["pontos"][0]
    base = {**ponto["zonas"][0]["regras"][0], "janelas": [], "quando": "sempre", "estado": "ensaio"}
    ponto["zonas"] = [
        {
            "id": "zq", "nome": "Cubas", "poligono": [list(p) for p in CUBAS.poligono], "principal": True, "papel": "cuba", "numero": 1,
            "regras": [{**base, **r} for r in nas_cubas],
        },
        {
            "id": "zm", "nome": "Montagem", "poligono": [list(p) for p in MONTAGEM.poligono], "principal": False, "papel": "montagem", "numero": 2,
            "regras": [{**base, **da_regra}],
        },
    ]
    return corpo


def a_auditoria(tmp_path, juiz=None, *, detector=NinguemNoPosto, corpo=None, relogio=None, q=None, **da_auditoria):
    relogio = relogio or Relogio()
    fonte = FonteDaBancada(relogio)
    juiz = juiz or JuizDeTeste(Resultado.CONFORME)
    q = q or Quietude(relogio=relogio)
    a = Auditoria(
        NuvemDeTeste(), str(tmp_path / "fila.db"),
        construir_fonte=lambda ponto: fonte, construir_juiz=lambda cfg: juiz, medidor=None, quietude=q, **da_auditoria,
    )
    assert a.quietude is q, "a quietude é a que foi entregue"
    a._detector_do_porteiro = lambda: detector
    a.montar(de_json(corpo or com_bancada()))
    return a, fonte, relogio


def volta(a: Auditoria, relogio: Relogio) -> dict:
    return a.volta(relogio.agora)


def test_as_medidas_da_auditoria_para_a_bancada():
    # Uma tentativa abre o fluxo principal. Duas por volta de rotina: na série medida na loja, a
    # terceira acrescentava 1 em 100 (ver docs/decisoes.md).
    assert (ESPERA_DA_BANCADA, MAX_REFEITAS_POR_VOLTA) == (1.0, 2)


def test_a_auditoria_acompanha_so_o_quadro_de_bancada_com_criterio_que_manda_imagem(tmp_path, caplog):
    with caplog.at_level("INFO", logger="farol_agent.auditoria"):
        # Dois critérios no mesmo quadro de bancada: o quadro é um só.
        a, _, _ = a_auditoria(tmp_path, corpo=com_bancada())
        corpo = com_bancada(versao=8)
        corpo["pontos"][0]["zonas"][1]["regras"].append({**corpo["pontos"][0]["zonas"][1]["regras"][0], "id": "r3"})
        a.montar(de_json(corpo))
    assert a.quietude.canais == ["p1"] and list(a.quietude._quadros["p1"]) == ["zm"]
    assert a.motor._quietude is a.quietude
    assert caplog.text.count("quadro de bancada: 1 quadro(s) acompanhado(s) no fluxo menor") == 2

    # Presença na bancada não espera mão nenhuma: nada a acompanhar.
    a.montar(de_json(com_bancada(versao=9, tipo="presenca", parametros={"objeto": "pessoa", "minimo": 1})))
    assert a.quietude.canais == [] and a.motor._quietude is None

    # Critério em quadro que não é de bancada: idem.
    a.montar(de_json(com_bancada(versao=10)))
    assert a.quietude.canais == ["p1"]
    corpo = com_bancada(versao=11)
    corpo["pontos"][0]["zonas"][1]["papel"] = "livre"
    a.montar(de_json(corpo))
    assert a.quietude.canais == [] and a.motor._quietude is None
    a.fila.fechar()


def test_a_olhada_que_as_maos_atrapalharam_e_refeita_quando_o_quadro_para(tmp_path, borroes):
    juiz = JuizDeTeste(Resultado.CONFORME)
    a, fonte, relogio = a_auditoria(tmp_path, juiz)
    drenagens = []
    julgar = a.julgar
    a.julgar = lambda agora=None: drenagens.append(agora) or julgar(agora)

    mexendo(a.quietude, relogio, fonte)
    r = volta(a, relogio)                                      # a rotina: há mão na frente
    assert (r["enfileirados"], juiz.chamadas) == (0, 0)
    assert a.motor.esperando_as_maos == {"p1": {"r1@zm"}}
    assert a._espera(relogio.agora) == ESPERA_DA_BANCADA, "com olhada esperando, o laço acorda de segundo em segundo"
    perto = a._proxima_rotina - timedelta(seconds=0.4)
    assert a._espera(perto) == pytest.approx(0.4), "a rotina que vem antes disso continua valendo"

    mexendo(a.quietude, relogio, fonte)
    r = volta(a, relogio)                                      # ainda mexendo: nada a refazer
    assert (r["refeitas"], r["extras"], fonte.aberturas) == (0, 0, 1)
    assert len(drenagens) == 1, "sem olhada refeita, a fila não é drenada de novo"

    quieta(a.quietude, relogio, fonte)                         # as mãos saíram
    r = volta(a, relogio)
    assert (r["refeitas"], r["enfileirados"], juiz.chamadas) == (1, 1, 1), "a olhada saiu agora, e foi julgada"
    assert a.motor.esperando_as_maos == {"p1": set()} and borroes == []
    assert a._espera(relogio.agora) == (a._proxima_rotina - relogio.agora).total_seconds() > ESPERA_DA_BANCADA

    quieta(a.quietude, relogio, fonte)
    r = volta(a, relogio)                                      # uma por olhada segurada, e não uma a cada volta
    assert (r["refeitas"], fonte.aberturas) == (0, 2)

    l = linhas(a.fila)["r1@zm"]
    assert (l["capturas"], l["sem_condicao"], l["enfileiradas"], l["conformes"]) == (2, 1, 1, 1)
    a.fila.fechar()


def test_refazer_a_olhada_da_bancada_nao_acorda_o_resto_do_canal(tmp_path):
    juiz = JuizDeTeste(Resultado.CONFORME)
    a, fonte, relogio = a_auditoria(tmp_path, juiz, corpo=com_bancada(nas_cubas=[{"id": "r2", "nome": "cubas cheias"}]))
    mexendo(a.quietude, relogio, fonte)
    assert volta(a, relogio)["enfileirados"] == 1, "na rotina, o critério das cubas é conferido; o da bancada espera"

    quieta(a.quietude, relogio, fonte)
    assert volta(a, relogio)["enfileirados"] == 1
    l = linhas(a.fila)
    assert (l["r1@zm"]["capturas"], l["r2@zq"]["capturas"]) == (2, 1), "só o critério que esperava foi olhado de novo"
    a.fila.fechar()


def test_sem_saber_se_o_quadro_parou_a_olhada_nao_e_refeita(tmp_path):
    a, fonte, relogio = a_auditoria(tmp_path)
    mexendo(a.quietude, relogio, fonte)
    volta(a, relogio)
    relogio.passar(3)                                          # a medida parou: as amostras ficaram velhas
    assert a.quietude.quieto("p1", "zm") is None
    r = volta(a, relogio)
    assert (r["refeitas"], fonte.aberturas) == (0, 1)
    assert a.motor.esperando_as_maos == {"p1": {"r1@zm"}}, "continua esperando a medida voltar"
    a.fila.fechar()


def test_mao_que_volta_no_meio_do_caminho_nao_vira_fila_de_aberturas(tmp_path):
    a, fonte, relogio = a_auditoria(tmp_path)
    mexendo(a.quietude, relogio, fonte)
    volta(a, relogio)
    assert fonte.aberturas == 1

    # A cada tentativa o quadro parece quieto, e a mão volta enquanto o fluxo principal abre.
    original = fonte.rajada

    def a_mao_volta(ts, quantidade=6, stream="main"):
        quadros = original(ts, quantidade, stream)
        amostrar(a.quietude, relogio, fonte, MAO_A, MAO_B)
        return quadros

    fonte.rajada = a_mao_volta
    for _ in range(5):
        quieta(a.quietude, relogio, fonte)
        volta(a, relogio)
    assert fonte.aberturas == 1 + 2, "duas tentativas por volta de rotina, e não uma por segundo"
    assert a.motor.esperando_as_maos == {"p1": {"r1@zm"}}, "continua esperando"

    # A rotina seguinte devolve as tentativas.
    relogio.passar(30)
    quieta(a.quietude, relogio, fonte)
    assert relogio.agora >= a._proxima_rotina
    volta(a, relogio)                                          # a rotina, e a mão volta de novo
    assert fonte.aberturas == 4 and a.motor.esperando_as_maos == {"p1": {"r1@zm"}}
    quieta(a.quietude, relogio, fonte)
    assert volta(a, relogio)["refeitas"] == 1 and fonte.aberturas == 5
    fonte.rajada = original                                    # e, quando a mão sai de vez, a olhada sai
    quieta(a.quietude, relogio, fonte)
    r = volta(a, relogio)
    assert (r["refeitas"], r["enfileirados"], fonte.aberturas) == (1, 1, 6)
    a.fila.fechar()


def test_olhada_esperando_de_criterio_que_ja_nao_vale_e_largada(tmp_path):
    # O critério saiu do horário com a olhada esperando: quando o quadro para, não há o que refazer
    # — e a espera não fica acordando o laço de segundo em segundo para sempre.
    corpo = com_bancada(janelas=[{"dias": [2], "hora_ini": "11:00", "hora_fim": "12:05"}])
    a, fonte, relogio = a_auditoria(tmp_path, corpo=corpo, intervalo_captura=3600.0)
    mexendo(a.quietude, relogio, fonte)
    volta(a, relogio)
    assert a.motor.esperando_as_maos == {"p1": {"r1@zm"}}

    relogio.passar(600)                                        # 12h10: fora da janela do critério
    quieta(a.quietude, relogio, fonte)
    r = volta(a, relogio)
    assert (r["refeitas"], r["enfileirados"], fonte.aberturas) == (1, 0, 1), "nada foi aberto: o critério não vale agora"
    assert a.motor.esperando_as_maos == {"p1": set()}
    assert a._espera(relogio.agora) > ESPERA_DA_BANCADA
    a.fila.fechar()


def test_falha_ao_refazer_nao_derruba_a_volta(tmp_path, caplog):
    a, fonte, relogio = a_auditoria(tmp_path)
    mexendo(a.quietude, relogio, fonte)
    volta(a, relogio)

    def caiu(ts, quantidade=6, stream="main"):
        raise OSError("gravador fora da rede")

    fonte.rajada = caiu
    quieta(a.quietude, relogio, fonte)
    r = volta(a, relogio)
    assert r["refeitas"] == 0 and "a olhada da bancada não foi refeita no ponto p1" in caplog.text
    a.fila.fechar()


def test_canal_que_ficou_sem_fonte_larga_a_olhada_que_esperava(tmp_path, caplog):
    a, fonte, relogio = a_auditoria(tmp_path)
    mexendo(a.quietude, relogio, fonte)
    volta(a, relogio)
    quieta(a.quietude, relogio, fonte)
    a.fontes = {}
    assert volta(a, relogio)["refeitas"] == 0
    assert a.motor.esperando_as_maos == {"p1": set()} and "não foi refeita" not in caplog.text
    a.fila.fechar()


def test_auditoria_sem_configuracao_nao_tem_bancada_a_refazer(tmp_path):
    a = Auditoria(NuvemDeTeste(), str(tmp_path / "fila.db"), medidor=None)
    assert a.refazer_bancada(TERCA_MEIO_DIA) == NADA
    assert a._espera(TERCA_MEIO_DIA) == 30.0
    a.fila.fechar()


def test_e_o_detector_da_loja_que_diz_se_ha_alguem_no_quadro_quieto(tmp_path, borroes):
    vistos: list[str] = []
    pontos = {"valor": [DUVIDA]}

    class Motor:
        def pontuar(self, imagem, classe):
            vistos.append(classe)
            return list(pontos["valor"])

    a, fonte, relogio = a_auditoria(tmp_path, detector=SimpleNamespace(motor=Motor()))
    quieta(a.quietude, relogio, fonte)
    assert volta(a, relogio)["enfileirados"] == 1
    assert vistos == [OBJETOS["pessoa"]] and len(borroes) == 1, "talvez alguém: a imagem sai com o borrão"

    pontos["valor"] = [DUVIDA - 0.01]
    borroes.clear()
    relogio.passar(30)
    fonte.imagem = cozinha(640, 360, semente=5)
    quieta(a.quietude, relogio, fonte)
    assert volta(a, relogio)["enfileirados"] == 1 and borroes == [], "ninguém à vista: sem o borrão"
    a.fila.fechar()


def test_em_loja_sem_detector_a_bancada_espera_as_maos_e_o_borrao_continua(tmp_path, borroes):
    a, fonte, relogio = a_auditoria(tmp_path, detector=None)
    mexendo(a.quietude, relogio, fonte)
    assert volta(a, relogio)["enfileirados"] == 0
    quieta(a.quietude, relogio, fonte)
    assert volta(a, relogio)["enfileirados"] == 1 and len(borroes) == 1
    a.fila.fechar()


# ───────────────────── o vigia continua com o passo dele ─────────────────────


def com_vigia(tmp_path):
    """A loja com um critério de presença (nas cubas) e o da bancada: o vigia e a bancada no mesmo laço."""
    presenca = {"id": "r9", "nome": "alguém no posto", "tipo": "presenca", "parametros": {"objeto": "pessoa", "minimo": 1}}
    a, fonte, relogio = a_auditoria(tmp_path, corpo=com_bancada(nas_cubas=[presenca]))
    assert a.vigia is not None and a.vigia.canais == ["p1"]
    vezes: list[float] = []
    olhar_do_vigia = a.vigia.olhar

    def olhar(fontes, agora):
        vezes.append((agora - TERCA_MEIO_DIA).total_seconds())
        return olhar_do_vigia(fontes, agora)

    a.vigia.olhar = olhar
    return a, fonte, relogio, vezes


def test_com_a_bancada_esperando_o_laco_acorda_a_cada_segundo_e_o_vigia_segue_no_passo_dele(tmp_path):
    a, fonte, relogio, vezes = com_vigia(tmp_path)
    mexendo(a.quietude, relogio, fonte)
    volta(a, relogio)                                          # 12h00min01: a rotina; a bancada fica esperando
    assert a._espera(relogio.agora) == ESPERA_DA_BANCADA

    for _ in range(11):                                        # de segundo em segundo, com a mão no quadro
        mexendo(a.quietude, relogio, fonte)
        r = volta(a, relogio)
        assert (r["extras"], r["refeitas"]) == (0, 0)
    assert vezes == [11.0], "em onze voltas o vigia olhou uma vez: dez segundos depois da rotina"

    # As mãos saíram: a olhada sai, e o laço volta a dormir — só o que FALTA para a vez do vigia.
    quieta(a.quietude, relogio, fonte)                         # 12h00min14
    assert volta(a, relogio)["refeitas"] == 1
    assert vezes == [11.0]
    assert a._espera(relogio.agora) == 7.0, "o vigia olhou aos 11 s: a próxima vez dele é aos 21 s"
    relogio.passar(7)
    volta(a, relogio)
    assert vezes == [11.0, 21.0]
    a.fila.fechar()


def test_a_volta_soma_o_que_o_vigia_e_a_bancada_fizeram(tmp_path):
    a, fonte, relogio, _ = com_vigia(tmp_path)
    volta(a, relogio)
    a.vigiar = lambda agora: {"enfileirados": 2, "alertas": 1, "subidos": 3, "extras": 1}
    a.refazer_bancada = lambda agora: {"enfileirados": 10, "alertas": 20, "subidos": 30, "refeitas": 4}
    relogio.passar(10)
    assert volta(a, relogio) == {"enfileirados": 12, "alertas": 21, "subidos": 33, "extras": 1, "refeitas": 4}
    a.fila.fechar()


def test_iniciar_poe_a_quietude_para_medir_e_parar_a_encerra(tmp_path):
    a, _, _ = a_auditoria(tmp_path, relogio=Tique(), q=Quietude(passo=0.01), intervalo_captura=3600.0)
    a.iniciar()
    try:
        assert espera_ficar_quieto(a.quietude, limite=5.0), "a quietude mede sozinha, pelas fontes da auditoria"
    finally:
        a.parar()
    assert a.quietude._thread is None
    a.fila.fechar()
