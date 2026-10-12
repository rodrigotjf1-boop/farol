"""A resposta vazia guardada (A20, fatia 1.3).

A cena que a nuvem não conseguiu avaliar costuma voltar igual meio minuto
depois, e pagar de novo é ouvir o mesmo. O dono decidiu (12/10/2026): da
cena de impressão idêntica guarda-se **só a resposta vazia, por 2 horas**.

O que estes testes protegem, na ordem do que custa mais caro errar:

1. **Nenhum "fora do critério" some.** Só a resposta vazia é guardada, só
   depois de vir vazia DUAS vezes seguidas, e uma resposta de verdade
   desfaz a guarda. A olhada segurada não anda nem zera a espera do
   "avisar só se continuar".
2. **A guarda não vaza.** É da pergunta inteira: o critério e a redação
   dele, o canal, o quadro e a impressão da cena. E é deste motor: troca de
   configuração e programa reiniciado perguntam de novo.
3. **Ela vence** em duas horas, e a memória não cresce para sempre.
4. **O resumo conta a verdade:** a olhada segurada é uma "já julgada", e
   fica contada à parte como "vazia guardada".
"""

from __future__ import annotations

import sqlite3
from dataclasses import replace
from datetime import datetime, timedelta

import numpy as np
import pytest

from farol_agent import fila as modulo_da_fila
from farol_agent import motor as modulo_do_motor
from farol_agent.contrato import resumo_para_nuvem
from farol_agent.fila import Fila
from farol_agent.modelos import (
    EventoGatilho,
    Frame,
    Resultado,
    TipoRegra,
    Veredito,
    Via,
    Zona,
)
from farol_agent.motor import GUARDA_DA_VAZIA_MIN, VAZIAS_PARA_GUARDAR, MotorDeRegras
from testes.conftest import BASE

MINUTO = timedelta(minutes=1)
GUARDA = timedelta(minutes=GUARDA_DA_VAZIA_MIN)


class FonteDeCenas:
    """Uma câmera que mostra a cena que o teste mandar.

    A MESMA cena dá a mesma imagem, ponto a ponto — é o caso da bancada
    parada. O quadro é carimbado na hora pedida, sem atraso: os testes de
    "vence em duas horas" contam o segundo.
    """

    def __init__(self, ponto_id: str = "ponto-teste", cena: str = "A", largura: int = 640, altura: int = 480):
        self.ponto_id = ponto_id
        self.cena = cena
        self.largura = largura
        self.altura = altura

    def imagem(self, cena: str | None = None) -> np.ndarray:
        """Ruído fino por cima de blocos grandes, os dois saídos do nome da cena.

        As duas METADES são iguais: dois quadros, um em cada metade, recortam
        a mesma imagem — é o que o teste de dois quadros precisa.
        """
        rng = np.random.default_rng(sum(ord(c) * 31**i for i, c in enumerate(cena or self.cena)) % 2**31)
        meia = self.largura // 2
        blocos = rng.integers(0, 255, (6, 4, 3), dtype=np.uint8)
        grande = np.kron(blocos, np.ones((self.altura // 6, meia // 4, 1), dtype=np.uint8))
        ruido = rng.integers(0, 60, grande.shape, dtype=np.uint8)
        metade = np.clip(grande.astype(np.int16) + ruido - 30, 0, 255).astype(np.uint8)
        return np.hstack([metade, metade])

    def rajada(self, ts: datetime, quantidade: int = 6, stream: str = "main") -> list[Frame]:
        return [Frame(imagem=self.imagem(), ts=ts, ponto_id=self.ponto_id) for _ in range(quantidade)]

    def fechar(self) -> None:
        pass


class Nuvem:
    """A nuvem de mentira: responde `via nuvem`, com custo.

    Responde pelo CONTEÚDO do item (o critério e o quadro), nunca pela ordem
    de chegada: a fila ordena pelo instante do quadro, e isso muda entre o
    Windows e o CI (V50). O que não tem resposta própria leva a padrão.
    """

    nome = "nuvem-de-mentira"

    def __init__(self, resultado: Resultado = Resultado.NAO_AVALIAVEL, *, via: Via = Via.NUVEM) -> None:
        self.resultado = resultado
        self.via = via
        self.por_lugar: dict[tuple[str, str], Resultado] = {}
        self.por_canal: dict[str, Resultado] = {}
        self.chamadas: list[tuple[str, str]] = []
        self.canais: list[str] = []

    def julgar(self, imagem, criterio, *, contexto=None, referencias=None) -> Veredito:
        lugar = (contexto["regra_id"], contexto["zona_id"])
        self.chamadas.append(lugar)
        self.canais.append(contexto["ponto_id"])
        return Veredito(
            resultado=self.por_canal.get(contexto["ponto_id"], self.por_lugar.get(lugar, self.resultado)),
            confianca=0.9,
            motivo="dublê",
            via=self.via,
            modelo="de-mentira",
            custo_centavos=1.3,
        )


@pytest.fixture
def fila(tmp_path):
    f = Fila(tmp_path / "fila.db")
    yield f
    f.fechar()


@pytest.fixture
def fonte() -> FonteDeCenas:
    return FonteDeCenas()


@pytest.fixture
def criterio(regra):
    """Um critério que vai à nuvem, valendo, sem silêncio entre avisos.

    Sem o silêncio de propósito: ele é uma porta ANTES da guarda, e com ele
    um "fora" calaria as olhadas seguintes — o teste passaria a provar o
    silêncio, e não a guarda (V72).
    """
    return replace(regra, cooldown_min=0)


def olhar(motor, fonte, juiz, ts, cena: str | None = None):
    """Uma olhada de rotina em `ts` e, logo depois, o julgamento do que entrou."""
    if cena is not None:
        fonte.cena = cena
    preparo = motor.preparar(EventoGatilho(ponto_id=fonte.ponto_id, ts=ts), fonte)
    alertas = motor.processar(juiz, ts + timedelta(seconds=2), limite=50)
    return preparo, alertas


def do_resumo(fila: Fila, regra_id: str = "r1", zona_id: str | None = None) -> dict[str, int]:
    """Os contadores do critério (e do quadro, se pedido), somadas as horas."""
    soma: dict[str, int] = {}
    for linha in fila.resumos_a_subir():
        if linha["regra_id"] != regra_id or (zona_id is not None and linha["zona_id"] != zona_id):
            continue
        for nome in modulo_da_fila.CONTADORES_DO_RESUMO:
            soma[nome] = soma.get(nome, 0) + linha[nome]
    return soma


def imagens_no_disco(fila: Fila) -> int:
    return sum(1 for a in fila.spool.iterdir() if a.is_file())


def duas_vazias(motor, fonte, juiz, cena: str = "A", inicio: datetime = BASE) -> datetime:
    """A nuvem devolve vazio duas vezes seguidas para a cena. Devolve o instante da segunda."""
    assert juiz.resultado is Resultado.NAO_AVALIAVEL
    antes = len(juiz.chamadas)
    olhar(motor, fonte, juiz, inicio, cena)
    olhar(motor, fonte, juiz, inicio + MINUTO, cena)
    assert len(juiz.chamadas) == antes + 2, "as duas primeiras têm de ser perguntadas"
    return inicio + MINUTO


# ───────────────────── a guarda: o que ela segura ─────────────────────


def test_a_cena_identica_a_duas_vazias_seguidas_nao_e_paga_de_novo(fila, criterio, fonte):
    motor = MotorDeRegras(fila, [criterio])
    juiz = Nuvem()
    duas_vazias(motor, fonte, juiz)
    no_disco = imagens_no_disco(fila)

    preparo, alertas = olhar(motor, fonte, juiz, BASE + 2 * MINUTO)

    assert preparo.vazias_guardadas == ["r1"]
    assert preparo.enfileirados == [] and preparo.repetidos == []
    assert len(juiz.chamadas) == 2, "a terceira olhada não pode ir à nuvem"
    assert alertas == []
    # Nem a imagem vai para o disco: não há o que julgar.
    assert imagens_no_disco(fila) == no_disco
    assert fila.resumo() == {"concluido": 2}


def test_a_olhada_segurada_conta_como_ja_julgada_e_a_parte_como_vazia_guardada(fila, criterio, fonte):
    motor = MotorDeRegras(fila, [criterio])
    juiz = Nuvem()
    duas_vazias(motor, fonte, juiz)

    olhar(motor, fonte, juiz, BASE + 2 * MINUTO)
    olhar(motor, fonte, juiz, BASE + 3 * MINUTO)

    r = do_resumo(fila)
    assert r["capturas"] == 4
    assert r["enfileiradas"] == 2 and r["nao_avaliaveis"] == 2
    assert r["ja_julgadas"] == 2 and r["vazias_guardadas"] == 2
    # Cada olhada termina em UM desfecho: a vazia guardada não é um a mais.
    desfechos = (
        "sem_juiz", "sem_quadro", "sem_cena", "sem_condicao", "sem_gatilho", "observadas",
        "em_silencio", "repetidas", "ja_julgadas", "enfileiradas",
    )
    assert sum(r[d] for d in desfechos) == r["capturas"]


def test_uma_vazia_so_nao_guarda(fila, criterio, fonte):
    """É o caso medido: a mesma impressão recebeu "não deu para avaliar" e, em seguida, "fora"."""
    motor = MotorDeRegras(fila, [criterio])
    juiz = Nuvem()
    olhar(motor, fonte, juiz, BASE)

    juiz.resultado = Resultado.NAO_CONFORME
    preparo, alertas = olhar(motor, fonte, juiz, BASE + MINUTO)

    assert preparo.enfileirados == ["r1"] and preparo.vazias_guardadas == []
    assert len(juiz.chamadas) == 2
    assert len(alertas) == 1, 'o "fora" que veio na segunda pergunta tem de virar aviso'


def test_com_uma_vazia_bastando_a_segunda_olhada_ja_e_segurada(fila, criterio, fonte):
    """A forma simples da regra, a uma constante de distância."""
    motor = MotorDeRegras(fila, [criterio], vazias_para_guardar=1)
    juiz = Nuvem()
    olhar(motor, fonte, juiz, BASE)

    preparo, _ = olhar(motor, fonte, juiz, BASE + MINUTO)

    assert preparo.vazias_guardadas == ["r1"]
    assert len(juiz.chamadas) == 1


@pytest.mark.parametrize("resultado", [Resultado.CONFORME, Resultado.NAO_CONFORME])
def test_dentro_e_fora_nunca_sao_repetidos_de_memoria(fila, criterio, fonte, resultado):
    motor = MotorDeRegras(fila, [criterio])
    juiz = Nuvem(resultado)

    for i in range(4):
        preparo, _ = olhar(motor, fonte, juiz, BASE + i * MINUTO)
        assert preparo.enfileirados == ["r1"], f"olhada {i}"

    assert len(juiz.chamadas) == 4
    assert do_resumo(fila)["vazias_guardadas"] == 0


def test_a_vazia_de_quem_julga_na_loja_nao_e_guardada(fila, criterio, fonte):
    """A guarda existe para não PAGAR de novo. O que a loja julga sozinha continua olhando."""
    motor = MotorDeRegras(fila, [criterio])
    juiz = Nuvem(via=Via.LOCAL)

    for i in range(4):
        olhar(motor, fonte, juiz, BASE + i * MINUTO)

    assert len(juiz.chamadas) == 4


def test_a_resposta_de_verdade_desfaz_a_guarda(fila, criterio, fonte):
    """A resposta mais nova é a que vale: depois de um "dentro", a contagem das vazias recomeça."""
    motor = MotorDeRegras(fila, [criterio])
    juiz = Nuvem()
    olhar(motor, fonte, juiz, BASE)                    # vazia (1)
    juiz.resultado = Resultado.CONFORME
    olhar(motor, fonte, juiz, BASE + MINUTO)           # dentro: zera
    juiz.resultado = Resultado.NAO_AVALIAVEL
    olhar(motor, fonte, juiz, BASE + 2 * MINUTO)       # vazia (1 de novo)

    preparo, _ = olhar(motor, fonte, juiz, BASE + 3 * MINUTO)

    assert preparo.enfileirados == ["r1"], "uma vazia depois de um dentro ainda não guarda"
    assert len(juiz.chamadas) == 4
    # A segunda vazia seguida, agora sim.
    assert olhar(motor, fonte, juiz, BASE + 4 * MINUTO)[0].vazias_guardadas == ["r1"]


# ───────────────── a guarda não esconde o que continua ─────────────────


def test_a_olhada_segurada_nao_anda_nem_zera_o_avisar_so_se_continuar(fila, criterio, fonte):
    """ "Não deu para avaliar" não confirma nem desmente — a guardada também não.

    Se a olhada segurada contasse como "continua fora", o aviso sairia de
    uma cena que ninguém conseguiu avaliar. Se zerasse a espera, o aviso do
    que continua fora nunca sairia.
    """
    motor = MotorDeRegras(fila, [replace(criterio, confirmar_em=2)])
    juiz = Nuvem()
    duas_vazias(motor, fonte, juiz, "vazia")

    juiz.resultado = Resultado.NAO_CONFORME
    _, alertas = olhar(motor, fonte, juiz, BASE + 2 * MINUTO, "suja")
    assert alertas == [], "o primeiro fora espera continuar"

    # A cena volta a ser a que a nuvem não avalia: segurada, sem aviso.
    preparo, alertas = olhar(motor, fonte, juiz, BASE + 3 * MINUTO, "vazia")
    assert preparo.vazias_guardadas == ["r1"]
    assert alertas == []
    # Nem na drenagem seguinte: nada ficou esperando para virar aviso.
    assert motor.processar(juiz, BASE + 3 * MINUTO + timedelta(seconds=30), limite=50) == []

    # E a espera não zerou: o segundo fora avisa.
    _, alertas = olhar(motor, fonte, juiz, BASE + 4 * MINUTO, "suja de outro jeito")
    assert len(alertas) == 1


# ─────────────────────── a guarda não vaza ───────────────────────


def test_outra_cena_e_perguntada(fila, criterio, fonte):
    motor = MotorDeRegras(fila, [criterio])
    juiz = Nuvem()
    duas_vazias(motor, fonte, juiz, "A")

    preparo, _ = olhar(motor, fonte, juiz, BASE + 2 * MINUTO, "B")

    assert preparo.enfileirados == ["r1"]
    assert len(juiz.chamadas) == 3
    # E a de antes continua guardada.
    assert olhar(motor, fonte, juiz, BASE + 3 * MINUTO, "A")[0].vazias_guardadas == ["r1"]


def _metades(ponto_id: str = "ponto-teste") -> tuple[Zona, Zona]:
    """Dois quadros do mesmo canal, um em cada metade — que a `FonteDeCenas` faz iguais."""
    esquerda = Zona(id="z-esq", nome="esquerda", ponto_id=ponto_id, poligono=[(0, 0), (0.5, 0), (0.5, 1), (0, 1)])
    direita = Zona(id="z-dir", nome="direita", ponto_id=ponto_id, poligono=[(0.5, 0), (1, 0), (1, 1), (0.5, 1)])
    return esquerda, direita


def _impressoes(fila: Fila) -> dict[str, set[str]]:
    """Por quadro, as impressões das imagens que entraram na fila."""
    con = sqlite3.connect(fila.caminho)
    try:
        saida: dict[str, set[str]] = {}
        for zona, impressao in con.execute("select zona_id, phash from analise"):
            saida.setdefault(zona, set()).add(impressao)
        return saida
    finally:
        con.close()


def test_a_guarda_de_um_quadro_nao_segura_o_outro_quadro_do_mesmo_canal(fila, criterio, fonte):
    """Dois quadros com a MESMA imagem: a vazia de um não responde pelo outro."""
    esquerda, direita = _metades()
    motor = MotorDeRegras(fila, [replace(criterio, zona=esquerda), replace(criterio, zona=direita)])
    juiz = Nuvem()
    juiz.por_lugar[("r1", "z-dir")] = Resultado.CONFORME

    for i in range(4):
        olhar(motor, fonte, juiz, BASE + i * MINUTO)

    # A premissa do teste: os dois recortes têm a mesma impressão.
    impressoes = _impressoes(fila)
    assert impressoes["z-esq"] == impressoes["z-dir"] and len(impressoes["z-esq"]) == 1
    assert juiz.chamadas.count(("r1", "z-esq")) == 2, "o da esquerda: duas vazias, e a guarda"
    assert juiz.chamadas.count(("r1", "z-dir")) == 4, "o da direita responde: é perguntado sempre"
    assert do_resumo(fila, zona_id="z-esq")["vazias_guardadas"] == 2
    assert do_resumo(fila, zona_id="z-dir")["vazias_guardadas"] == 0


def test_a_guarda_de_um_criterio_nao_segura_outro_no_mesmo_quadro(fila, criterio, fonte):
    outro = replace(criterio, id="r2", nome="outro critério", criterio="os potes estão tampados")
    motor = MotorDeRegras(fila, [criterio, outro])
    juiz = Nuvem()
    juiz.por_lugar[("r2", "z1")] = Resultado.CONFORME

    for i in range(4):
        olhar(motor, fonte, juiz, BASE + i * MINUTO)

    assert juiz.chamadas.count(("r1", "z1")) == 2
    assert juiz.chamadas.count(("r2", "z1")) == 4


def test_a_guarda_de_um_canal_nao_segura_o_outro_canal(fila, criterio):
    """O mesmo critério, no mesmo quadro, em dois canais que mostram a mesma imagem.

    É o modo de bancada: o quadro não diz de que canal é, e vale em qualquer
    um. O que separa as duas perguntas é só o canal.
    """
    assert criterio.zona.ponto_id is None
    canal_a, canal_b = FonteDeCenas("canal-a"), FonteDeCenas("canal-b")
    motor = MotorDeRegras(fila, [criterio])
    juiz = Nuvem()
    juiz.por_canal["canal-b"] = Resultado.CONFORME

    for i in range(4):
        olhar(motor, canal_a, juiz, BASE + i * MINUTO)
        olhar(motor, canal_b, juiz, BASE + i * MINUTO)

    assert len(_impressoes(fila)["z1"]) == 1, "a premissa: os dois canais dão a mesma impressão"
    assert juiz.canais.count("canal-a") == 2, "o canal A: duas vazias, e a guarda"
    assert juiz.canais.count("canal-b") == 4, "o canal B responde: é perguntado sempre"


def test_redacao_nova_do_criterio_e_outra_pergunta(fila, criterio, fonte):
    motor = MotorDeRegras(fila, [criterio])
    juiz = Nuvem()
    duas_vazias(motor, fonte, juiz)

    motor.regras = [replace(criterio, criterio_versao=criterio.criterio_versao + 1)]
    preparo, _ = olhar(motor, fonte, juiz, BASE + 2 * MINUTO)

    assert preparo.enfileirados == ["r1"]
    assert len(juiz.chamadas) == 3


@pytest.mark.parametrize("tipo", [TipoRegra.PRESENCA, TipoRegra.CONTAGEM])
def test_presenca_e_contagem_nao_passam_pela_guarda(fila, criterio, fonte, tipo):
    """Ali cada olhada É a medida — e mesmo que alguém as julgasse pela nuvem, nada seria segurado."""
    motor = MotorDeRegras(fila, [replace(criterio, tipo=tipo, parametros={"objeto": "pessoa", "minimo": 1})])
    juiz = Nuvem()

    for i in range(4):
        preparo, _ = olhar(motor, fonte, juiz, BASE + i * MINUTO)
        assert preparo.enfileirados == ["r1"], f"olhada {i}"

    assert len(juiz.chamadas) == 4
    assert motor._perguntas == {} and motor._vazias == {}


# ──────────────── a guarda é DESTE motor, e vence ────────────────


def test_motor_novo_pergunta_de_novo(fila, criterio, fonte):
    """Mudou a configuração (ou o programa reiniciou): o motor é outro, e a guarda não passa."""
    juiz = Nuvem()
    antigo = MotorDeRegras(fila, [criterio])
    duas_vazias(antigo, fonte, juiz)
    assert olhar(antigo, fonte, juiz, BASE + 2 * MINUTO)[0].vazias_guardadas == ["r1"]

    novo = MotorDeRegras(fila, [criterio])
    preparo, _ = olhar(novo, fonte, juiz, BASE + 3 * MINUTO)

    assert preparo.enfileirados == ["r1"]
    assert len(juiz.chamadas) == 3


def test_a_resposta_do_que_ja_esperava_na_fila_nao_conta_para_o_motor_novo(fila, criterio, fonte):
    """A olhada enfileirada pelo motor de antes foi cortada do jeito antigo: a resposta dela não é desta pergunta."""
    juiz = Nuvem()
    antigo = MotorDeRegras(fila, [criterio])
    antigo.preparar(EventoGatilho(ponto_id=fonte.ponto_id, ts=BASE), fonte)   # entra na fila, e a configuração muda

    novo = MotorDeRegras(fila, [criterio])
    novo.processar(juiz, BASE + timedelta(seconds=2), limite=50)             # vazia — do motor de antes
    olhar(novo, fonte, juiz, BASE + MINUTO)                                   # vazia (a primeira DESTE motor)

    preparo, _ = olhar(novo, fonte, juiz, BASE + 2 * MINUTO)

    assert preparo.enfileirados == ["r1"], "a vazia herdada não pode contar como a primeira"
    assert len(juiz.chamadas) == 3
    assert olhar(novo, fonte, juiz, BASE + 3 * MINUTO)[0].vazias_guardadas == ["r1"]


@pytest.mark.parametrize(
    "quanto_antes_de_vencer, segurada",
    [(timedelta(seconds=1), True), (timedelta(0), False), (timedelta(seconds=-1), False)],
)
def test_a_guarda_vence_em_duas_horas_contadas_da_ultima_vazia(fila, criterio, fonte, quanto_antes_de_vencer, segurada):
    """Um segundo antes de vencer ainda segura; na hora em que vence, pergunta de novo.

    Cada lado da fronteira no seu motor: duas olhadas com um segundo de
    diferença cairiam na memória curta da cena repetida, que vem antes.
    """
    assert GUARDA == timedelta(hours=2), "a decisão do dono: por 2 horas"
    motor = MotorDeRegras(fila, [criterio])
    juiz = Nuvem()
    ultima = duas_vazias(motor, fonte, juiz)

    preparo, _ = olhar(motor, fonte, juiz, ultima + GUARDA - quanto_antes_de_vencer)

    assert preparo.vazias_guardadas == (["r1"] if segurada else [])
    assert preparo.enfileirados == ([] if segurada else ["r1"])
    assert len(juiz.chamadas) == (2 if segurada else 3)


def test_a_olhada_segurada_nao_estica_a_guarda(fila, criterio, fonte):
    """A guarda conta da última resposta PAGA: segurar não renova o prazo."""
    motor = MotorDeRegras(fila, [criterio])
    juiz = Nuvem()
    ultima = duas_vazias(motor, fonte, juiz)

    for minutos in (30, 60, 90, 119):
        assert olhar(motor, fonte, juiz, ultima + timedelta(minutes=minutos))[0].vazias_guardadas == ["r1"]

    assert olhar(motor, fonte, juiz, ultima + GUARDA)[0].enfileirados == ["r1"]


def test_depois_de_vencer_a_guarda_recomeca_da_primeira_vazia(fila, criterio, fonte):
    motor = MotorDeRegras(fila, [criterio])
    juiz = Nuvem()
    ultima = duas_vazias(motor, fonte, juiz)

    depois = ultima + GUARDA
    assert olhar(motor, fonte, juiz, depois)[0].enfileirados == ["r1"]               # vazia: a primeira de novo
    assert olhar(motor, fonte, juiz, depois + MINUTO)[0].enfileirados == ["r1"]      # a segunda
    assert olhar(motor, fonte, juiz, depois + 2 * MINUTO)[0].vazias_guardadas == ["r1"]
    assert len(juiz.chamadas) == 4


def test_guarda_de_zero_minutos_desliga(fila, criterio, fonte):
    motor = MotorDeRegras(fila, [criterio], guarda_da_vazia_min=0)
    juiz = Nuvem()

    for i in range(4):
        assert olhar(motor, fonte, juiz, BASE + i * MINUTO)[0].enfileirados == ["r1"]

    assert len(juiz.chamadas) == 4


def test_o_padrao_e_a_decisao_do_dono_com_a_confirmacao():
    assert GUARDA_DA_VAZIA_MIN == 120
    assert VAZIAS_PARA_GUARDAR == 2


# ───────────────────── a memória não cresce para sempre ─────────────────────


def test_a_vazia_vencida_sai_da_memoria(fila, criterio, fonte):
    motor = MotorDeRegras(fila, [criterio])
    juiz = Nuvem()
    for i, cena in enumerate("ABCDE"):
        duas_vazias(motor, fonte, juiz, cena, BASE + i * 5 * MINUTO)
    assert len(motor._vazias) == 5

    # Uma pergunta nova, depois de todas terem vencido, faz a limpeza.
    olhar(motor, fonte, juiz, BASE + 5 * 5 * MINUTO + GUARDA, "F")

    assert len(motor._vazias) == 1


def test_a_pergunta_que_ficou_sem_resposta_sai_da_memoria(fila, criterio, fonte):
    motor = MotorDeRegras(fila, [criterio])
    for i, cena in enumerate("ABC"):
        fonte.cena = cena
        motor.preparar(EventoGatilho(ponto_id=fonte.ponto_id, ts=BASE + i * MINUTO), fonte)
    assert len(motor._perguntas) == 3

    # Passada a validade mais longa de uma análise, a fila já as descartou.
    fonte.cena = "D"
    motor.preparar(EventoGatilho(ponto_id=fonte.ponto_id, ts=BASE + modulo_do_motor._ESPERA_MAIS_LONGA + 3 * MINUTO), fonte)

    assert len(motor._perguntas) == 1


def test_a_pergunta_respondida_sai_da_lista_de_espera(fila, criterio, fonte):
    motor = MotorDeRegras(fila, [criterio])
    juiz = Nuvem(Resultado.CONFORME)

    olhar(motor, fonte, juiz, BASE)

    assert motor._perguntas == {}


# ───────────────────────── o resumo e o contrato ─────────────────────────


def test_a_vazia_guardada_sobe_no_resumo_da_hora(fila, criterio, fonte):
    motor = MotorDeRegras(fila, [criterio])
    juiz = Nuvem()
    duas_vazias(motor, fonte, juiz)
    olhar(motor, fonte, juiz, BASE + 2 * MINUTO)

    corpo = resumo_para_nuvem(fila.resumos_a_subir()[0])

    assert corpo["jaJulgadas"] == 1 and corpo["vaziasGuardadas"] == 1
    assert corpo["naoAvaliaveis"] == 2 and corpo["julgadasNuvem"] == 2


def test_a_fila_de_antes_ganha_a_coluna_da_vazia_guardada(tmp_path):
    """A loja em operação tem a tabela do resumo SEM a coluna: trocar o pacote não pode quebrar a soma."""
    de_antes = modulo_da_fila._ESQUEMA.replace("  vazias_guardadas   integer not null default 0,\n", "")
    assert de_antes != modulo_da_fila._ESQUEMA, "o esquema mudou de forma: o teste não está tirando a coluna"
    caminho = tmp_path / "fila.db"
    con = sqlite3.connect(caminho)
    con.executescript(de_antes)
    con.execute(
        "insert into resumo_hora (hora, regra_id, zona_id, capturas, ja_julgadas) values (?, 'r1', 'z1', 3, 1)",
        (Fila.hora_de(BASE),),
    )
    con.commit()
    assert "vazias_guardadas" not in {l[1] for l in con.execute("pragma table_info(resumo_hora)")}
    con.close()

    fila = Fila(caminho)
    try:
        fila.contar(BASE, "r1", "z1", capturas=1, ja_julgadas=1, vazias_guardadas=1)
        linha = fila.resumos_a_subir()[0]
        assert (linha["capturas"], linha["ja_julgadas"], linha["vazias_guardadas"]) == (4, 2, 1)
        assert resumo_para_nuvem(linha)["vaziasGuardadas"] == 1
    finally:
        fila.fechar()
