"""O que conta como "continua fora" no "avisar só se continuar" (ERR-110).

Com `confirmar_em` maior que 1, o primeiro fora do critério espera as
olhadas seguintes. A cena que não mudou conta como "continua" sem ser paga
de novo — é o caso da bancada suja parada. Mas a cena repetida só diz que o
fora continua quando ela repete **a cena que foi dada como fora**.

O defeito: qualquer cena repetida contava. Um "fora", depois a câmera
passou a mostrar algo que a nuvem não conseguia avaliar, e as olhadas
repetidas DESSA cena adiantavam a espera — o aviso de "continua fora" saía
dois minutos depois, sem ninguém ter visto o fora de novo.

A rotina olha a cada 30 s e a memória de cena repetida guarda 30 s: a cena
parada alterna "vai a julgamento" e "repetida". Os testes andam nesse passo.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import timedelta

import pytest

from farol_agent.fila import Fila
from farol_agent.modelos import EventoGatilho, Resultado, TipoRegra
from farol_agent.motor import MotorDeRegras
from testes.conftest import BASE
from testes.test_vazia_guardada import FonteDeCenas, Nuvem, _metades, olhar

FORA, DENTRO, VAZIA = Resultado.NAO_CONFORME, Resultado.CONFORME, Resultado.NAO_AVALIAVEL
SEG = timedelta(seconds=1)


@pytest.fixture
def fila(tmp_path):
    f = Fila(tmp_path / "fila.db")
    yield f
    f.fechar()


@pytest.fixture
def criterio(regra):
    """Avisa na terceira olhada seguida fora do critério, sem silêncio entre avisos."""
    return replace(regra, cooldown_min=0, confirmar_em=3)


class Roteiro:
    """Anda a loja no tempo: cada passo é uma olhada com a cena e a resposta que a nuvem daria."""

    def __init__(self, motor: MotorDeRegras, fonte: FonteDeCenas | None = None, juiz: Nuvem | None = None):
        self.motor = motor
        self.fonte = fonte or FonteDeCenas()
        self.juiz = juiz or Nuvem()
        self.desfechos: list[str] = []
        self.avisos: list[int] = []

    def passo(self, segundos: int, cena: str, resposta: Resultado) -> list:
        self.juiz.resultado = resposta
        preparo, alertas = olhar(self.motor, self.fonte, self.juiz, BASE + segundos * SEG, cena)
        self.desfechos.append(
            next((nome for nome in ("enfileirados", "repetidos", "vazias_guardadas") if getattr(preparo, nome)), "?")
        )
        self.avisos.append(len(alertas))
        return alertas


# ─────────────────────────── o defeito ───────────────────────────


@pytest.mark.parametrize("vazias_para_guardar", [2, 99], ids=["com a resposta vazia guardada", "sem ela"])
def test_repetir_a_cena_que_ninguem_avaliou_nao_conta_como_continua_fora(fila, criterio, vazias_para_guardar):
    r = Roteiro(MotorDeRegras(fila, [criterio], vazias_para_guardar=vazias_para_guardar))

    r.passo(0, "suja", FORA)                    # fora: 1 de 3
    for i in range(1, 13):                      # seis minutos só da cena que a nuvem não avalia
        r.passo(30 * i, "tampada", VAZIA)

    assert "repetidos" in r.desfechos[1:], "a premissa: a cena tampada foi dada como repetida"
    assert sum(r.avisos) == 0, f"saiu aviso sem ninguém ter visto o fora de novo: {list(zip(r.desfechos, r.avisos))}"


def test_e_o_fora_que_volta_depois_ainda_e_o_segundo(fila, criterio):
    """A cena que ninguém avaliou não anda a espera — e também não a zera."""
    r = Roteiro(MotorDeRegras(fila, [criterio]))

    r.passo(0, "suja", FORA)                    # 1 de 3
    for i in range(1, 5):
        r.passo(30 * i, "tampada", VAZIA)
    r.passo(150, "suja de novo", FORA)          # 2 de 3
    assert sum(r.avisos) == 0
    avisos = r.passo(180, "suja outra vez", FORA)   # 3 de 3

    assert len(avisos) == 1


# ───────────────── o que continua contando ─────────────────


def test_a_cena_fora_do_criterio_que_nao_mudou_continua_contando(fila, criterio):
    """A bancada suja parada: uma análise paga, e o aviso sai na terceira olhada."""
    r = Roteiro(MotorDeRegras(fila, [criterio]))

    for segundos in (0, 10, 20):
        r.passo(segundos, "suja", FORA)

    assert r.desfechos == ["enfileirados", "repetidos", "repetidos"]
    assert r.avisos == [0, 0, 1]
    assert len(r.juiz.chamadas) == 1


def test_a_cena_fora_que_volta_depois_de_outra_cena_conta(fila, criterio):
    """Fora, uma cena que ninguém avaliou no meio, e a cena fora de novo: é ela que se repete."""
    r = Roteiro(MotorDeRegras(fila, [criterio]))

    r.passo(0, "suja", FORA)                    # 1 de 3
    r.passo(10, "mão na frente", VAZIA)         # não anda nem zera
    r.passo(20, "suja", FORA)                   # repetida DA SUJA: 2 de 3
    r.passo(30, "suja", FORA)                   # repetida da suja: 3 de 3

    assert r.desfechos == ["enfileirados", "enfileirados", "repetidos", "repetidos"]
    assert r.avisos == [0, 0, 0, 1]


def test_a_repeticao_da_cena_do_meio_nao_conta(fila, criterio):
    """O espelho do teste de cima: o que se repete é a cena que ninguém avaliou."""
    r = Roteiro(MotorDeRegras(fila, [criterio]))

    r.passo(0, "suja", FORA)                    # 1 de 3
    r.passo(10, "mão na frente", VAZIA)
    r.passo(20, "mão na frente", VAZIA)         # repetida da mão
    r.passo(30, "mão na frente", VAZIA)         # repetida da mão

    assert r.desfechos == ["enfileirados", "enfileirados", "repetidos", "repetidos"]
    assert r.avisos == [0, 0, 0, 0]


# ────────── a cena já julgada no mesmo minuto ("já julgada") ──────────


def _ja_julgadas(fila: Fila) -> int:
    return sum(linha["ja_julgadas"] for linha in fila.resumos_a_subir())


def test_a_cena_fora_ja_julgada_no_mesmo_minuto_conta(fila, regra):
    r = Roteiro(MotorDeRegras(fila, [replace(regra, cooldown_min=0, confirmar_em=2)]))

    r.passo(5, "suja", FORA)                    # 1 de 2
    avisos = r.passo(45, "suja", FORA)          # 40 s depois, no mesmo minuto: já julgada — e é a suja

    assert _ja_julgadas(fila) == 1, "a premissa: a segunda olhada foi dada como já julgada"
    assert len(r.juiz.chamadas) == 1
    assert len(avisos) == 1


def test_a_repeticao_de_uma_cena_ja_julgada_sabe_de_que_item_ela_e(fila, criterio):
    """Fora, a mesma cena "já julgada" 40 s depois, e 10 s depois dela a cena repetida: três seguidas."""
    r = Roteiro(MotorDeRegras(fila, [criterio]))

    r.passo(5, "suja", FORA)                    # 1 de 3
    r.passo(45, "suja", FORA)                   # já julgada, e é a suja: 2 de 3
    avisos = r.passo(55, "suja", FORA)          # repetida da olhada de 45 s: 3 de 3

    assert _ja_julgadas(fila) == 1
    assert r.avisos == [0, 0, 1] and len(avisos) == 1
    assert len(r.juiz.chamadas) == 1


def test_a_cena_que_ninguem_avaliou_ja_julgada_no_mesmo_minuto_nao_conta(fila, regra):
    r = Roteiro(MotorDeRegras(fila, [replace(regra, cooldown_min=0, confirmar_em=2)], vazias_para_guardar=99))

    r.passo(2, "suja", FORA)                    # 1 de 2
    r.passo(12, "tampada", VAZIA)
    r.passo(50, "tampada", VAZIA)               # 38 s depois, no mesmo minuto: já julgada — e é a tampada

    assert _ja_julgadas(fila) == 1, "a premissa: a terceira olhada foi dada como já julgada"
    assert sum(r.avisos) == 0


# ───────────── a resposta vazia guardada, e depois a repetição dela ─────────────


def test_repetir_a_cena_segurada_pela_resposta_vazia_guardada_nao_conta(fila, regra):
    r = Roteiro(MotorDeRegras(fila, [replace(regra, cooldown_min=0, confirmar_em=2)]))

    r.passo(0, "tampada", VAZIA)
    r.passo(60, "tampada", VAZIA)               # duas vazias seguidas: a guarda vale
    r.passo(120, "suja", FORA)                  # 1 de 2
    r.passo(180, "tampada", VAZIA)              # segurada pela guarda
    r.passo(200, "tampada", VAZIA)              # 20 s depois: repetida DA SEGURADA

    assert r.desfechos[-2:] == ["vazias_guardadas", "repetidos"]
    assert sum(r.avisos) == 0


# ───────────────── a cena de um item que ainda espera resposta ─────────────────


def test_a_cena_cuja_resposta_demorou_conta_depois_que_o_fora_chega(fila, regra):
    """A nuvem demorou: a cena entrou na fila, voltou igual, e só então veio o "fora"."""
    motor = MotorDeRegras(fila, [replace(regra, cooldown_min=0, confirmar_em=2)])
    fonte, juiz = FonteDeCenas(cena="suja"), Nuvem(FORA)
    olha = lambda segundos: motor.preparar(  # noqa: E731
        EventoGatilho(ponto_id=fonte.ponto_id, ts=BASE + segundos * SEG), fonte
    )

    assert olha(5).enfileirados == ["r1"]       # entra na fila; a resposta não vem
    assert olha(45).repetidos == ["r1"]         # a mesma cena, no mesmo minuto: o item ainda espera
    assert motor.processar(juiz, BASE + 46 * SEG, limite=50) == []     # agora sim: fora, 1 de 2
    assert olha(55).repetidos == ["r1"]         # repetida da olhada de 45 s — que é a do item fora

    assert len(motor.processar(juiz, BASE + 56 * SEG, limite=50)) == 1
    assert len(juiz.chamadas) == 1


@pytest.mark.parametrize("tipo", [TipoRegra.PRESENCA, TipoRegra.CONTAGEM])
def test_em_presenca_a_mesma_olhada_entrando_de_novo_nao_e_mais_uma(fila, regra, tipo):
    """Ali cada olhada é a medida: a olhada que entra duas vezes no mesmo segundo é UMA."""
    motor = MotorDeRegras(
        fila, [replace(regra, tipo=tipo, cooldown_min=0, confirmar_em=2, parametros={"objeto": "pessoa", "minimo": 1})]
    )
    fonte, juiz = FonteDeCenas(), Nuvem(FORA)

    olhar(motor, fonte, juiz, BASE)             # fora: 1 de 2
    preparo, alertas = olhar(motor, fonte, juiz, BASE)

    assert preparo.repetidos == ["r1"]
    assert alertas == []
    assert motor.processar(juiz, BASE + 10 * SEG, limite=50) == []


# ─────────────────────── por lugar, e sem crescer ───────────────────────


def test_dois_quadros_com_a_mesma_imagem_nao_se_misturam(fila, regra):
    """A esquerda fica fora e parada; a direita, igual, a nuvem não avalia. Só a esquerda avisa."""
    esquerda, direita = _metades()
    base = replace(regra, cooldown_min=0, confirmar_em=2)
    motor = MotorDeRegras(fila, [replace(base, zona=esquerda), replace(base, zona=direita)])
    juiz = Nuvem(FORA)
    juiz.por_lugar[("r1", "z-dir")] = VAZIA
    r = Roteiro(motor, juiz=juiz)

    r.passo(0, "suja", FORA)
    avisos = r.passo(10, "suja", FORA)          # as duas repetidas; só a da esquerda repete um fora

    assert [a.zona_id for a in avisos] == ["z-esq"]
    assert sorted(juiz.chamadas) == [("r1", "z-dir"), ("r1", "z-esq")], "uma análise paga por quadro"


def test_a_lembranca_de_que_item_e_cada_cena_nao_cresce(fila, criterio):
    r = Roteiro(MotorDeRegras(fila, [criterio]))

    for i in range(20):
        r.passo(60 * i, f"cena {i}", DENTRO)

    assert len(r.motor._itens_das_cenas) == 1, "só a cena que ainda pode ser dada como repetida"


# ───────────────── a memória de cena repetida diz DE QUAL ─────────────────


def test_a_memoria_diz_de_que_cena_esta_e_repeticao_e_prefere_a_mais_recente(monkeypatch):
    """Duas cenas diferentes na memória, e a de agora parecida com as duas: ela continua a mais nova."""
    from farol_agent.pipeline import dedupe

    impressoes = iter([0x000, 0xFFF, 0x03F, 0x03F])      # a 1ª e a 2ª diferem em 12 pontos; a 3ª, em 6 de cada
    monkeypatch.setattr(dedupe, "phash", lambda imagem: next(impressoes))
    memoria = dedupe.Deduplicador(limiar=6, memoria_seg=30)

    assert memoria.repeticao_de("lugar", None, BASE) is None, "cena nova: passa a ser lembrada"
    assert memoria.repeticao_de("lugar", None, BASE + 10 * SEG) is None, "outra cena nova"
    assert memoria.repeticao_de("lugar", None, BASE + 20 * SEG) == BASE + 10 * SEG
    # A repetida não é lembrada, e o jeito de sempre de perguntar continua valendo.
    assert memoria.repetido("lugar", None, BASE + 25 * SEG) is True
    assert [quando for quando, _ in memoria._visto["lugar"]] == [BASE, BASE + 10 * SEG]


def test_a_cena_nova_nao_e_repeticao_de_nada():
    from farol_agent.pipeline.dedupe import Deduplicador

    memoria = Deduplicador()
    assert memoria.repetido("lugar", FonteDeCenas(cena="A").imagem(), BASE) is False
    assert memoria.repetido("outro lugar", FonteDeCenas(cena="A").imagem(), BASE + SEG) is False, "a memória é por lugar"
    assert memoria.repetido("lugar", FonteDeCenas(cena="A").imagem(), BASE + 2 * SEG) is True
