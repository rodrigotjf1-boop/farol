"""A atenção — os estados de cada quadro, contados (A20, fatia 1.2a).

O que estes testes protegem:

1. **A máquina de estados é a do plano:** o quadro acorda com duas leituras
   seguidas com movimento e assenta com cinco segundos MEDIDOS sem
   movimento, contados da última leitura que mexeu.
2. **O clarão não conta** — nem como movimento, nem como calma — e **não
   sei não é calma**: o buraco de leitura quebra a sequência e a calma.
3. **A conta é por quadro e por hora**, e a colheita recomeça do zero sem
   mexer no estado.
4. **Só conta.** Pela auditoria, o que a atenção vê vai para a linha do
   resumo de cada critério do quadro que valia naquela hora — e nada muda
   nas olhadas: nenhum fluxo é aberto e nenhuma análise é feita por causa
   dela.
"""

from __future__ import annotations

import sqlite3
import threading
import time
from datetime import datetime, timedelta

import pytest

from farol_agent import atencao as modulo
from farol_agent import fila as modulo_da_fila
from farol_agent.atencao import (
    CALMA_PARA_ASSENTAR_SEG,
    CONTADORES,
    LEITURAS_PARA_ACORDAR,
    PARTE_DO_CLARAO,
    Atencao,
)
from farol_agent.configuracao import de_json
from farol_agent.contrato import resumo_para_nuvem
from farol_agent.fila import Fila
from farol_agent.modelos import Zona
from farol_agent.porteiro import PARTE_QUE_MUDOU
from farol_agent.quietude import PASSO

from .test_bancada import (
    CUBAS,
    LIMPA,
    MAO_A,
    MAO_B,
    MONTAGEM,
    NAS_CUBAS,
    TERCA_MEIO_DIA,
    FonteDaBancada,
    P,
    Relogio,
    Tique,
    a_auditoria,
    com_bancada,
)

MEXEU, CALMA, CLARAO, NAO_SEI = PARTE_QUE_MUDOU, 0.0, 1.0, None


def atenta(*zonas: Zona, **da_atencao) -> tuple[Atencao, Relogio, FonteDaBancada]:
    relogio = Relogio()
    a = Atencao(relogio=relogio, **da_atencao)
    a.montar({P: list(zonas or (MONTAGEM,))})
    return a, relogio, FonteDaBancada(relogio)


def ler(a: Atencao, relogio: Relogio, fonte: FonteDaBancada, *imagens) -> None:
    """Uma leitura por imagem, de meio em meio segundo. `...` repete a imagem que estava."""
    for img in imagens:
        if img is not ...:
            fonte.menor = img
        relogio.passar(PASSO)
        a.amostrar({P: fonte})


@pytest.fixture
def roteiro(monkeypatch):
    """A atenção lendo um roteiro de medidas, uma por leitura, no lugar da imagem.

    Para os limites exatos — a parte dos pontos que faz o "mexeu", a que faz
    o clarão — a imagem não serve: quem dá a medida é o teste. `None` é o
    fluxo menor parado naquela leitura.
    """
    a, relogio, fonte = atenta()
    medidas: list[float] = []
    monkeypatch.setattr(modulo, "fracao_que_mudou", lambda antes, agora, salto: medidas.pop(0))
    ler(a, relogio, fonte, LIMPA)          # a primeira não tem com o que comparar

    def seguir(*fracoes: float | None) -> str:
        for fracao in fracoes:
            if fracao is None:
                # O fluxo parou nesta leitura — e a seguinte, sem com o que comparar, também não mede.
                fonte.parado = True
                ler(a, relogio, fonte, ...)
                fonte.parado = False
                ler(a, relogio, fonte, ...)
            else:
                medidas.append(fracao)
                ler(a, relogio, fonte, ...)
        assert medidas == [], "toda medida do roteiro foi lida"
        return a.estado(P, "zm")

    seguir.atencao, seguir.relogio = a, relogio
    return seguir


def contado(a: Atencao, zona_id: str = "zm") -> dict[str, int]:
    """O que a colheita traz para o quadro, somadas as horas (e a conta recomeça)."""
    soma = dict.fromkeys(CONTADORES, 0)
    for _, _, zona, somas in a.colher():
        if zona == zona_id:
            for nome, valor in somas.items():
                soma[nome] += valor
    return soma


# ═════════════════════════ os números de fábrica ═════════════════════════


def test_os_numeros_do_plano():
    assert (LEITURAS_PARA_ACORDAR, CALMA_PARA_ASSENTAR_SEG, PARTE_DO_CLARAO) == (2, 5.0, 0.60)
    assert CONTADORES == ("leituras", "com_movimento", "claroes", "acordou", "assentou")
    # Os nomes são colunas do resumo da hora: a soma os recusa se não forem.
    assert set(CONTADORES) <= set(modulo_da_fila.CONTADORES_DO_RESUMO)


# ═════════════════════════ acordar e assentar ═════════════════════════


def test_duas_leituras_seguidas_com_movimento_acordam_o_quadro(roteiro):
    assert roteiro(CALMA, MEXEU) == "repouso", "uma leitura só ainda não acorda"
    assert roteiro(MEXEU) == "em_atividade"
    assert contado(roteiro.atencao) == {"leituras": 3, "com_movimento": 2, "claroes": 0, "acordou": 1, "assentou": 0}


def test_movimento_que_nao_se_repete_na_leitura_seguinte_nao_acorda(roteiro):
    assert roteiro(MEXEU, CALMA, MEXEU, CALMA, MEXEU, CALMA) == "repouso"
    assert contado(roteiro.atencao)["acordou"] == 0


def test_o_quadro_assenta_cinco_segundos_depois_da_ultima_leitura_que_mexeu(roteiro):
    roteiro(MEXEU, MEXEU)                               # acordou; a calma conta desta leitura
    assert roteiro(*[CALMA] * 9) == "em_atividade", "4,5 s sem mexer ainda não são cinco"
    assert roteiro(CALMA) == "repouso"
    c = contado(roteiro.atencao)
    assert (c["acordou"], c["assentou"]) == (1, 1)
    assert (c["leituras"], c["com_movimento"]) == (12, 2)


def test_mexer_no_meio_recomeca_a_calma(roteiro):
    roteiro(MEXEU, MEXEU)
    assert roteiro(*[CALMA] * 9, MEXEU, *[CALMA] * 9) == "em_atividade"
    assert roteiro(CALMA) == "repouso"
    assert contado(roteiro.atencao)["assentou"] == 1


def test_o_quadro_que_assentou_precisa_acordar_de_novo(roteiro):
    roteiro(MEXEU, MEXEU, *[CALMA] * 10)                # acordou e assentou
    assert roteiro(MEXEU) == "repouso", "depois de assentar, uma leitura só não acorda"
    assert roteiro(MEXEU) == "em_atividade"
    c = contado(roteiro.atencao)
    assert (c["acordou"], c["assentou"]) == (2, 1)


def test_o_mexeu_e_a_medida_do_porteiro_e_o_limite_conta(roteiro):
    quase = PARTE_QUE_MUDOU - 0.0001
    assert roteiro(quase, quase, quase) == "repouso", "abaixo do limite não é movimento"
    assert roteiro(PARTE_QUE_MUDOU, PARTE_QUE_MUDOU) == "em_atividade", "no limite já é"
    assert contado(roteiro.atencao)["com_movimento"] == 2


# ═════════════════════════════ o clarão ═════════════════════════════


def test_o_clarao_nao_acorda_o_quadro(roteiro):
    """A luz acendeu e apagou: a área inteira mudou duas vezes seguidas, e ninguém mexeu em nada."""
    assert roteiro(CLARAO, CLARAO, CALMA, CLARAO, CLARAO) == "repouso"
    assert contado(roteiro.atencao) == {"leituras": 5, "com_movimento": 0, "claroes": 4, "acordou": 0, "assentou": 0}


def test_o_clarao_e_acima_de_sessenta_por_cento_dos_pontos(roteiro):
    assert roteiro(PARTE_DO_CLARAO, PARTE_DO_CLARAO) == "em_atividade", "60% cravado ainda é movimento"
    c = contado(roteiro.atencao)
    assert (c["com_movimento"], c["claroes"]) == (2, 0)
    roteiro(PARTE_DO_CLARAO + 0.0001)
    assert contado(roteiro.atencao)["claroes"] == 1


def test_o_clarao_nao_quebra_a_sequencia_de_movimento(roteiro):
    """Não conta: nem como movimento, nem como calma. As duas leituras com movimento em volta dele acordam."""
    assert roteiro(MEXEU, CLARAO, MEXEU) == "em_atividade"


def test_em_atividade_o_clarao_nao_e_movimento_nem_calma(roteiro):
    roteiro(MEXEU, MEXEU)
    # Cinco segundos da última leitura que mexeu, com dois clarões no meio: assenta na hora certa —
    # o clarão não recomeçou a calma...
    assert roteiro(*[CALMA] * 5, CLARAO, CLARAO, CALMA, CALMA) == "em_atividade"
    assert roteiro(CALMA) == "repouso"


def test_o_clarao_sozinho_nao_faz_o_quadro_assentar(roteiro):
    # ...e também não é calma: cinco segundos depois, é preciso uma leitura calma para assentar.
    roteiro(MEXEU, MEXEU)
    assert roteiro(*[CALMA] * 9, CLARAO, CLARAO) == "em_atividade"
    assert roteiro(CALMA) == "repouso"


# ═══════════════════════ não sei não é calma ═══════════════════════


def test_o_buraco_de_leitura_quebra_a_sequencia_de_movimento(roteiro):
    assert roteiro(MEXEU, NAO_SEI, MEXEU) == "repouso", "entre as duas, o fluxo parou: não são seguidas"
    assert roteiro(MEXEU) == "em_atividade"


def test_o_buraco_de_leitura_recomeca_a_calma(roteiro):
    roteiro(MEXEU, MEXEU)
    # Oito leituras calmas, um buraco (duas leituras sem medida), e a calma recomeça da primeira leitura
    # depois dele: dali são precisos cinco segundos medidos.
    assert roteiro(*[CALMA] * 8, NAO_SEI, *[CALMA] * 10) == "em_atividade"
    assert roteiro(CALMA) == "repouso"
    c = contado(roteiro.atencao)
    assert c["leituras"] == 2 + 8 + 11, "a leitura sem medida não é leitura"
    assert c["assentou"] == 1


def test_sem_fluxo_menor_nao_ha_leitura_nem_estado_que_ande():
    a, relogio, fonte = atenta()
    fonte.menor = None
    ler(a, relogio, fonte, ..., ..., ...)
    assert a.estado(P, "zm") == "repouso" and a.colher() == []
    # E a fonte que nem tem fluxo menor (a de bancada, em arquivo): idem.
    a.amostrar({P: object()})
    a.amostrar({})
    assert a.colher() == []


def test_fonte_que_quebra_nao_derruba_a_leitura():
    class Quebrada:
        def quadro_do_fluxo_menor(self):
            raise OSError("fluxo caiu")

    a, relogio, _ = atenta()
    relogio.passar(PASSO)
    a.amostrar({P: Quebrada()})
    assert a.estado(P, "zm") == "repouso" and a.colher() == []


def test_medida_que_quebra_e_um_buraco_e_nao_derruba_a_leitura(monkeypatch):
    a, relogio, fonte = atenta()
    ler(a, relogio, fonte, LIMPA, MAO_A)
    monkeypatch.setattr(modulo, "reduzir", lambda quadro, zona: (_ for _ in ()).throw(ValueError("recorte vazio")))
    ler(a, relogio, fonte, LIMPA)                       # não mediu: quebra a sequência
    monkeypatch.undo()
    # A leitura seguinte não tem com o que comparar: a última cena medida ficou velha. (Se comparasse
    # com ela — a mão em A —, esta leitura e a próxima seriam duas com movimento, e o quadro acordaria.)
    ler(a, relogio, fonte, MAO_B)
    ler(a, relogio, fonte, MAO_A)                       # mexeu: é a primeira de novo
    assert a.estado(P, "zm") == "repouso"
    ler(a, relogio, fonte, MAO_B)
    assert a.estado(P, "zm") == "em_atividade"


# ═══════════════════════ com a imagem de verdade ═══════════════════════


def test_a_mao_que_entra_e_muda_de_lugar_acorda_e_o_quadro_parado_assenta():
    a, relogio, fonte = atenta()
    ler(a, relogio, fonte, LIMPA, LIMPA, MAO_A, MAO_B)
    assert a.estado(P, "zm") == "em_atividade"
    ler(a, relogio, fonte, LIMPA)                       # a mão saiu: o quadro mudou de novo
    ler(a, relogio, fonte, *[...] * 9)
    assert a.estado(P, "zm") == "em_atividade"
    ler(a, relogio, fonte, ...)
    assert a.estado(P, "zm") == "repouso"
    c = contado(a)
    assert (c["acordou"], c["assentou"], c["com_movimento"], c["claroes"]) == (1, 1, 3, 0)


def test_o_que_mexe_fora_do_quadro_nao_acorda():
    dois, relogio, fonte = atenta(MONTAGEM, CUBAS)
    ler(dois, relogio, fonte, LIMPA, NAS_CUBAS, LIMPA, NAS_CUBAS)
    assert (dois.estado(P, "zm"), dois.estado(P, "zq")) == ("repouso", "em_atividade"), "mexeram nas cubas, não na montagem"
    colhido = {zona: somas for _, _, zona, somas in dois.colher()}
    assert colhido["zq"].get("acordou") == 1 and "acordou" not in colhido["zm"]


def test_a_luz_que_muda_a_cena_inteira_e_clarao_e_nao_movimento():
    import numpy as np

    clara = np.clip(LIMPA.astype(np.int16) + 90, 0, 255).astype(np.uint8)
    a, relogio, fonte = atenta()
    ler(a, relogio, fonte, LIMPA, clara, LIMPA, clara)
    assert a.estado(P, "zm") == "repouso"
    c = contado(a)
    assert (c["claroes"], c["com_movimento"]) == (3, 0)


def test_depois_de_o_fluxo_parar_a_primeira_leitura_nao_tem_com_o_que_comparar():
    """O fluxo menor travou com a mão num lugar e voltou com ela em outro: não se sabe o que houve no meio."""
    a, relogio, fonte = atenta()
    ler(a, relogio, fonte, LIMPA, MAO_A)                # mexeu: 1
    fonte.parado = True
    ler(a, relogio, fonte, ...)                         # o fluxo parou: não sei
    fonte.parado = False
    ler(a, relogio, fonte, MAO_B)                       # voltou: sem com o que comparar
    ler(a, relogio, fonte, MAO_A)                       # mexeu: é a primeira de novo
    assert a.estado(P, "zm") == "repouso"
    assert contado(a) == {"leituras": 2, "com_movimento": 2, "claroes": 0, "acordou": 0, "assentou": 0}


def test_a_atencao_nunca_abre_fluxo():
    a, relogio, fonte = atenta()
    ler(a, relogio, fonte, LIMPA, MAO_A, MAO_B, LIMPA)
    assert fonte.aberturas == 0


# ═══════════════════════ a conta: por quadro e por hora ═══════════════════════


def test_a_conta_e_por_hora_e_a_colheita_diz_o_instante_da_ultima_leitura(roteiro):
    a, relogio = roteiro.atencao, roteiro.relogio
    a.colher()
    relogio.agora = TERCA_MEIO_DIA.replace(minute=59, second=58, microsecond=0)
    roteiro(MEXEU, MEXEU, CALMA)                        # 12:59:58,5 · 12:59:59 (acordou) · 12:59:59,5
    roteiro(CALMA, MEXEU)                               # 13:00:00 · 13:00:00,5

    colhido = a.colher()

    assert [(quando.hour, zona) for quando, _, zona, _ in colhido] == [(12, "zm"), (13, "zm")]
    (ultima_das_12, _, _, das_12), (ultima_das_13, _, _, das_13) = colhido
    assert das_12 == {"leituras": 3, "com_movimento": 2, "acordou": 1}
    assert das_13 == {"leituras": 2, "com_movimento": 1}
    assert ultima_das_12 == TERCA_MEIO_DIA.replace(minute=59, second=59, microsecond=500_000)
    assert ultima_das_13 == TERCA_MEIO_DIA.replace(hour=13, minute=0, second=0, microsecond=500_000)


def test_a_colheita_recomeca_a_conta_e_nao_mexe_no_estado(roteiro):
    roteiro(MEXEU, MEXEU)
    assert contado(roteiro.atencao)["acordou"] == 1
    assert roteiro.atencao.colher() == [], "colhido uma vez, não vem de novo"
    assert roteiro.atencao.estado(P, "zm") == "em_atividade", "o quadro continua acordado"
    roteiro(*[CALMA] * 10)
    assert contado(roteiro.atencao) == {"leituras": 10, "com_movimento": 0, "claroes": 0, "acordou": 0, "assentou": 1}


def test_cada_canal_tem_a_sua_conta():
    outro = Zona(id="zo", nome="Chapa", poligono=MONTAGEM.poligono, ponto_id="p2", numero=1)
    relogio = Relogio()
    a = Atencao(relogio=relogio)
    a.montar({P: [MONTAGEM], "p2": [outro]})
    aqui, la = FonteDaBancada(relogio), FonteDaBancada(relogio, "p2")
    for mao in (LIMPA, MAO_A, MAO_B):
        aqui.menor = mao
        relogio.passar(PASSO)
        a.amostrar({P: aqui, "p2": la})             # o outro canal continua parado

    assert (a.estado(P, "zm"), a.estado("p2", "zo")) == ("em_atividade", "repouso")
    assert sorted(a.canais) == ["p1", "p2"]
    colhido = {(canal, zona): somas for _, canal, zona, somas in a.colher()}
    assert colhido[(P, "zm")] == {"leituras": 2, "com_movimento": 2, "acordou": 1}
    assert colhido[("p2", "zo")] == {"leituras": 2}


def test_remontar_guarda_o_estado_do_quadro_que_continua_e_larga_o_do_que_mudou():
    a, relogio, fonte = atenta(MONTAGEM, CUBAS)
    ler(a, relogio, fonte, LIMPA, MAO_A, MAO_B)
    assert a.estado(P, "zm") == "em_atividade"

    redesenhada = Zona(id="zq", nome="Cubas", poligono=[(0.1, 0.1), (0.6, 0.1), (0.6, 0.2), (0.1, 0.2)], ponto_id=P, numero=1)
    a.montar({P: [MONTAGEM, redesenhada]})
    assert a.estado(P, "zm") == "em_atividade", "o quadro que continua guarda o estado"
    assert a._quadros[P]["zq"].anterior is None, "quadro redesenhado é outro recorte: recomeça"

    a.montar({P: [redesenhada]})
    assert a.estado(P, "zm") is None, "o quadro que saiu não é mais acompanhado"
    a.montar({})
    assert a.canais == []
    a.amostrar({P: fonte})                              # e ler sem nada a acompanhar não faz nada


# ═════════════════════════ a thread própria ═════════════════════════


def test_em_thread_propria_a_atencao_le_sozinha_no_passo_dela_e_para_quando_mandam():
    fonte = FonteDaBancada(Tique())
    a = Atencao(passo=0.01)
    a.montar({P: [MONTAGEM]})
    a.iniciar(lambda: {P: fonte})
    a.iniciar(lambda: {})                               # chamar de novo não cria outra thread
    try:
        assert sum(t.name == "farol-atencao" for t in threading.enumerate()) == 1
        fim = time.monotonic() + 1.5
        while not a._contado and time.monotonic() < fim:
            time.sleep(0.005)
        assert a._contado, "leu sozinha"
    finally:
        a.parar()
    assert a._thread is None and all(t.name != "farol-atencao" for t in threading.enumerate())
    a.colher()
    time.sleep(0.05)
    assert a.colher() == [], "parada, não lê mais"


def test_erro_numa_leitura_nao_mata_a_thread():
    vezes = {"n": 0}
    fonte = FonteDaBancada(Tique())

    def fontes():
        vezes["n"] += 1
        if vezes["n"] <= 2:
            raise RuntimeError("configuração trocando")
        return {P: fonte}

    a = Atencao(passo=0.01)
    a.montar({P: [MONTAGEM]})
    a.iniciar(fontes)
    try:
        fim = time.monotonic() + 1.5
        while not a._contado and time.monotonic() < fim:
            time.sleep(0.005)
        assert a._contado
    finally:
        a.parar()


# ══════════════════════════ pela auditoria ══════════════════════════


def linhas(fila: Fila) -> dict[tuple[str, str], dict]:
    """As linhas do resumo, direto da tabela — tenham ou não subido."""
    con = sqlite3.connect(fila.caminho)
    con.row_factory = sqlite3.Row
    try:
        return {(l["regra_id"], l["zona_id"]): dict(l) for l in con.execute("select * from resumo_hora")}
    finally:
        con.close()


def da_atencao(linha: dict) -> tuple[int, ...]:
    return tuple(linha[nome] for nome in CONTADORES)


def auditoria_atenta(tmp_path, corpo=None, **mais):
    relogio = Relogio()
    a, fonte, relogio = a_auditoria(tmp_path, corpo=corpo, relogio=relogio, atencao=Atencao(relogio=relogio), **mais)
    return a, fonte, relogio


def acordar_a_montagem(a, fonte, relogio) -> None:
    """Quatro leituras: a primeira sem com o que comparar, uma calma, e a mão entrando e mudando de lugar."""
    for img in (LIMPA, LIMPA, MAO_A, MAO_B):
        fonte.menor = img
        relogio.passar(PASSO)
        a.atencao.amostrar(a.fontes)


def test_a_auditoria_acompanha_todo_quadro_que_tem_criterio_de_qualquer_tipo(tmp_path):
    a, _, _ = auditoria_atenta(tmp_path)
    assert a.atencao.canais == ["p1"] and list(a.atencao._quadros["p1"]) == ["zm"]

    # Presença no quadro (que a quietude não acompanha) e um critério nas cubas: os dois quadros.
    presenca = {"tipo": "presenca", "parametros": {"objeto": "pessoa", "minimo": 1}}
    a.montar(de_json(com_bancada(versao=8, nas_cubas=[{"id": "rq"}], **presenca)))
    assert sorted(a.atencao._quadros["p1"]) == ["zm", "zq"]
    assert a.quietude.canais == [], "a quietude continua só com o quadro de bancada que manda imagem"

    # O critério que só observa também tem o quadro acompanhado.
    a.montar(de_json(com_bancada(versao=9, estado="observando")))
    assert list(a.atencao._quadros["p1"]) == ["zm"]

    # Sem critério nenhum, nada a acompanhar.
    sem = com_bancada(versao=10)
    sem["pontos"][0]["zonas"][1]["regras"] = []
    a.montar(de_json(sem))
    assert a.atencao.canais == []
    a.fila.fechar()


def test_o_que_a_atencao_conta_vai_para_a_linha_de_cada_criterio_do_quadro(tmp_path):
    corpo = com_bancada(nas_cubas=[{"id": "rq"}])
    corpo["pontos"][0]["zonas"][1]["regras"].append({**corpo["pontos"][0]["zonas"][1]["regras"][0], "id": "r3"})
    a, fonte, relogio = auditoria_atenta(tmp_path, corpo=corpo)
    acordar_a_montagem(a, fonte, relogio)

    a.volta(relogio.agora)

    l = linhas(a.fila)
    # Os dois critérios do quadro de montagem levam a MESMA conta: o quadro é um só.
    assert da_atencao(l[("r1", "zm")]) == da_atencao(l[("r3", "zm")]) == (3, 2, 0, 1, 0)
    # O das cubas leva a do quadro dele: três leituras, e nada mexeu ali.
    assert da_atencao(l[("rq", "zq")]) == (3, 0, 0, 0, 0)
    # E o que foi colhido não é somado de novo na volta seguinte.
    relogio.passar(10)
    a.volta(relogio.agora)
    assert da_atencao(linhas(a.fila)[("r1", "zm")]) == (3, 2, 0, 1, 0)
    a.fila.fechar()


def test_o_criterio_fora_do_horario_dele_nao_leva_a_conta_do_quadro(tmp_path):
    """Dois critérios no mesmo quadro; um só vale de madrugada. É meio-dia: a conta vai só para o outro."""
    corpo = com_bancada()
    de_madrugada = {
        **corpo["pontos"][0]["zonas"][1]["regras"][0], "id": "r3",
        "janelas": [{"dias": [], "hora_ini": "02:00", "hora_fim": "04:00"}],
    }
    corpo["pontos"][0]["zonas"][1]["regras"].append(de_madrugada)
    a, fonte, relogio = auditoria_atenta(tmp_path, corpo=corpo)
    assert sorted(r.id for r in a.motor.regras) == ["r1", "r3"], "a premissa: os dois critérios estão montados"
    acordar_a_montagem(a, fonte, relogio)

    a.volta(relogio.agora)

    l = linhas(a.fila)
    assert da_atencao(l[("r1", "zm")]) == (3, 2, 0, 1, 0)
    assert ("r3", "zm") not in l, "fora do horário do critério não há linha a engordar"
    a.fila.fechar()


def test_a_atencao_so_conta_nenhuma_olhada_a_mais_e_nenhuma_analise(tmp_path):
    """O que a loja faz não muda: com o quadro acordando e assentando, as olhadas são as da rotina."""
    quieto, fonte_q, relogio_q = auditoria_atenta(tmp_path / "quieto")
    agitado, fonte_a, relogio_a = auditoria_atenta(tmp_path / "agitado")

    for a, fonte, relogio, imagens in (
        (quieto, fonte_q, relogio_q, [LIMPA] * 8),
        (agitado, fonte_a, relogio_a, [LIMPA, MAO_A, MAO_B, MAO_A, MAO_B, LIMPA, LIMPA, LIMPA]),
    ):
        a.volta(relogio.agora)                          # a rotina
        for img in imagens:
            fonte.menor = img
            relogio.passar(PASSO)
            a.atencao.amostrar(a.fontes)
        relogio.passar(10)
        a.volta(relogio.agora)                          # entre uma rotina e outra

    assert fonte_a.aberturas == fonte_q.aberturas, "a atenção não abre o fluxo principal"
    olhadas = lambda a: {k: (l["capturas"], l["enfileiradas"]) for k, l in linhas(a.fila).items()}  # noqa: E731
    assert olhadas(agitado) == olhadas(quieto)
    assert da_atencao(linhas(agitado.fila)[("r1", "zm")])[3] == 1, "e o quadro agitado acordou, sim"
    quieto.fila.fechar()
    agitado.fila.fechar()


def test_a_conta_da_atencao_sobe_no_resumo_da_hora(tmp_path):
    a, fonte, relogio = auditoria_atenta(tmp_path)
    acordar_a_montagem(a, fonte, relogio)

    a.volta(relogio.agora)

    subidos = [r for pedido in a.cliente.resumos_enviados for r in pedido["resumos"] if r["regraId"] == "r1"]
    assert subidos, "o resumo do critério subiu nesta volta"
    corpo = subidos[-1]
    assert (corpo["leituras"], corpo["comMovimento"], corpo["claroes"], corpo["acordou"], corpo["assentou"]) == (3, 2, 0, 1, 0)
    a.fila.fechar()


def test_falha_ao_somar_a_atencao_nao_derruba_a_volta(tmp_path, caplog, monkeypatch):
    a, fonte, relogio = auditoria_atenta(tmp_path)
    acordar_a_montagem(a, fonte, relogio)
    monkeypatch.setattr(a.atencao, "colher", lambda: (_ for _ in ()).throw(RuntimeError("memória torta")))

    with caplog.at_level("ERROR", logger="farol_agent.auditoria"):
        r = a.volta(relogio.agora)

    assert "não consegui somar a atenção" in caplog.text
    assert r["enfileirados"] == 1, "a rotina seguiu: a olhada do critério foi feita"
    a.fila.fechar()


def test_iniciar_e_parar_a_auditoria_levam_a_atencao_junto(tmp_path):
    a, _, _ = auditoria_atenta(tmp_path)
    a.iniciar()
    try:
        assert sum(t.name == "farol-atencao" for t in threading.enumerate()) == 1
    finally:
        a.parar()
    assert all(t.name != "farol-atencao" for t in threading.enumerate())


# ═══════════════════════ a fila de antes ═══════════════════════


def test_a_fila_de_antes_ganha_as_colunas_da_atencao(tmp_path):
    """A loja em operação tem a tabela do resumo SEM as colunas: trocar o pacote não pode quebrar a soma."""
    de_antes = modulo_da_fila._ESQUEMA
    for nome in CONTADORES:
        linha = f"  {nome:<18} integer not null default 0,\n"
        assert linha in de_antes, f"o esquema mudou de forma: {nome}"
        de_antes = de_antes.replace(linha, "")
    caminho = tmp_path / "fila.db"
    con = sqlite3.connect(caminho)
    con.executescript(de_antes)
    con.execute(
        "insert into resumo_hora (hora, regra_id, zona_id, capturas) values (?, 'r1', 'z1', 3)",
        (Fila.hora_de(TERCA_MEIO_DIA),),
    )
    con.commit()
    assert not set(CONTADORES) & {l[1] for l in con.execute("pragma table_info(resumo_hora)")}
    con.close()

    fila = Fila(caminho)
    try:
        fila.contar_lote([(TERCA_MEIO_DIA, "r1", "z1", {"leituras": 7, "com_movimento": 2, "acordou": 1}, None)])
        linha = fila.resumos_a_subir()[0]
        assert (linha["capturas"], *da_atencao(linha)) == (3, 7, 2, 0, 1, 0)
        corpo = resumo_para_nuvem(linha)
        assert (corpo["leituras"], corpo["comMovimento"], corpo["claroes"], corpo["acordou"], corpo["assentou"]) == (7, 2, 0, 1, 0)
    finally:
        fila.fechar()
