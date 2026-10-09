"""O estudo do critério: o contexto que precisa estar acontecendo e o gatilho que abre a análise (A19, onda 1).

Pedido do dono (08/10/2026): os critérios têm de ser estudados para gerar
gatilhos, sem julgamento desnecessário "sem movimento ou sem o contexto
acontecendo". O exemplo é dele: para saber se o colaborador da chapa salga as
carnes, é preciso haver carne na chapa e colaborador no posto.

O que se protege aqui:

- o vocabulário é o do contrato, e o estudo desce na configuração para o
  agente que declara saber lidar com ele;
- o que o agente não entende cai do lado que PERGUNTA: condição de contexto
  desconhecida sai, gatilho desconhecido vira "toda olhada";
- os três sinais (pessoa, movimento, foto padrão), os níveis e as bordas, e
  o "na dúvida, pergunta" de cada um;
- no motor: sem contexto, "nada a conferir"; com contexto e sem gatilho,
  "sem gatilho"; com os dois, a olhada segue — e a conta das olhadas fecha;
- o estudo substitui o porteiro; presença e contagem não usam estudo.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import replace
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np
import pytest

from farol_agent import nuvem as cliente_da_nuvem
from farol_agent.auditoria import Auditoria
from farol_agent.configuracao import de_json
from farol_agent.contrato import resumo_para_nuvem
from farol_agent.fila import CONTADORES_DO_RESUMO, Fila
from farol_agent.juizes.detector import OBJETOS
from farol_agent.modelos import (
    GATILHOS_SEM_LUGAR,
    ONDES,
    SINAIS_DE_CONTEXTO,
    SINAIS_DE_GATILHO,
    Condicao,
    Estudo,
    EventoGatilho,
    Frame,
    Resultado,
    TipoRegra,
    Zona,
)
from farol_agent.motor import MotorDeRegras
from farol_agent.porteiro import Porteiro
from farol_agent.sinais import VELHO, Lugar, Sinais
from testes.conftest import BASE, JuizFixo

from .test_auditoria import JuizDeTeste, NuvemDeTeste
from .test_configuracao import resposta
from .test_foto_padrao import LIMPA, MEIO_DIA, NOITE, NuvemComFotos
from .test_foto_padrao import cena as cozinha
from .test_foto_padrao import com_objeto
from .test_foto_padrao import configuracao as configuracao_com_fotos

CONTRATO = json.loads((Path(__file__).resolve().parents[2] / "contratos" / "estudo-do-criterio.json").read_text(encoding="utf-8"))
TERCA_MEIO_DIA = datetime(2026, 10, 6, 12, 0, 0)
MEIO_MINUTO = timedelta(seconds=30)

P = "p1"
CHAPA = Zona(id="zc", nome="Chapa", poligono=[(0.05, 0.10), (0.60, 0.10), (0.60, 0.65), (0.05, 0.65)], ponto_id=P, numero=1, papel="equipamento")
POSTO = Zona(id="zp", nome="Posto", poligono=[(0.05, 0.70), (0.60, 0.70), (0.60, 0.95), (0.05, 0.95)], ponto_id=P, numero=2, papel="posto")
DE_OUTRO_CANAL = Zona(id="zx", nome="Caixa", poligono=[(0.1, 0.1), (0.9, 0.1), (0.9, 0.9), (0.1, 0.9)], ponto_id="p2", numero=1)
ZONAS = {z.id: z for z in (CHAPA, POSTO, DE_OUTRO_CANAL)}

AQUI, NO_POSTO, NO_CANAL = f"{P}:zc", f"{P}:zp", f"{P}:canal"
NINGUEM, TALVEZ, ALGUEM = [0.05], [0.45], [0.92]


@pytest.fixture
def fila(tmp_path):
    f = Fila(tmp_path / "fila.db")
    yield f
    f.fechar()


class Pessoas:
    """Dublê do detector de pessoas: responde, por lugar, os pontos que o teste mandar. Anota em vez de afirmar."""

    def __init__(self, **por_lugar):
        self.por_lugar: dict[str, list[float] | None] = dict(por_lugar)
        self.chamadas: list[tuple[str, tuple[int, int]]] = []

    def __call__(self, imagem, lugar, ts):
        self.chamadas.append((lugar, tuple(imagem.shape[:2])))
        valor = self.por_lugar.get(lugar, self.por_lugar.get("*"))
        return None if valor is None else list(valor)


class Semelhanca:
    """Dublê da comparação com a foto padrão: por quadro, o número que o teste mandar."""

    def __init__(self, **por_zona):
        self.por_zona: dict[str, float | None] = dict(por_zona)
        self.chamadas: list[str] = []

    def __call__(self, imagem, zona):
        self.chamadas.append(zona.id)
        return self.por_zona.get(zona.id, self.por_zona.get("*"))


class FonteDeCena:
    """Entrega a imagem que o teste mandar — a mesma em toda a rajada."""

    def __init__(self, ponto_id=P, imagem=None):
        self.ponto_id = ponto_id
        self.imagem = cozinha(640, 360) if imagem is None else imagem

    def rajada(self, ts, quantidade=6, stream="main"):
        return [Frame(self.imagem.copy(), ts + timedelta(milliseconds=100 * i), self.ponto_id) for i in range(quantidade)]


def olhar(motor: MotorDeRegras, fonte, ts: datetime):
    return motor.preparar(EventoGatilho(ponto_id=fonte.ponto_id, ts=ts), fonte)


def a_linha(fila: Fila, regra_id: str = "r1") -> dict:
    (linha,) = [dict(l) for l in fila._con.execute("select * from resumo_hora where regra_id = ?", (regra_id,))]
    return linha


def o_funil(fila: Fila, regra_id: str = "r1") -> tuple[int, int, int, int, int]:
    """(olhadas, nada a conferir, sem gatilho, observadas, enfileiradas)."""
    l = a_linha(fila, regra_id)
    return l["capturas"], l["sem_condicao"], l["sem_gatilho"], l["observadas"], l["enfileiradas"]


def na_chapa(regra, estudo: Estudo, **mais):
    return replace(regra, zona=CHAPA, estudo=estudo, **mais)


def um_lugar(chave=AQUI, imagem=None, zona=CHAPA, nome="Quadro 1 — Chapa") -> Lugar:
    return Lugar(chave, cozinha(320, 180) if imagem is None else imagem, zona, nome)


def so(sinal: str, onde: str = "aqui", **mais) -> Condicao:
    return Condicao(sinal, onde, **mais)


# ══════════════════════════ o contrato ══════════════════════════


def test_o_vocabulario_e_o_do_contrato():
    # A API lê o MESMO arquivo (api/testes/estudo.test.ts).
    assert list(SINAIS_DE_CONTEXTO) == CONTRATO["contexto"]
    assert list(SINAIS_DE_GATILHO) == CONTRATO["gatilho"]
    assert list(GATILHOS_SEM_LUGAR) == CONTRATO["gatilhoSemLugar"]
    assert list(ONDES) == CONTRATO["onde"]
    assert CONTRATO["sabe"] in cliente_da_nuvem.SABE, "o agente diz à nuvem que sabe lidar com o estudo"
    # Cada par de contrários existe dos dois lados: é o que a API usa para recusar o contexto que nunca valeria.
    for a, b in CONTRATO["contrarios"]:
        assert a in SINAIS_DE_CONTEXTO and b in SINAIS_DE_CONTEXTO
    # Condição que não diz o lugar é no quadro do próprio critério.
    assert Condicao("pessoa") == Condicao("pessoa", "aqui") and Condicao("pessoa").zona_id is None


def com_estudo(estudo):
    corpo = resposta()
    regra = corpo["pontos"][0]["zonas"][0]["regras"][0]
    if estudo is not ...:
        regra["estudo"] = estudo
    return de_json(corpo).regras[0]


def test_o_estudo_desce_na_configuracao_como_o_contrato_mostra():
    regra = com_estudo(CONTRATO["configuracao"]["regra"]["estudo"])
    assert regra.estudo == Estudo(
        contexto=(
            Condicao("fora_do_padrao", "aqui"),
            Condicao("pessoa", "quadro", zona_id="00000000-0000-4000-8000-0000000000a2"),
            Condicao("sem_pessoa", "canal"),
        ),
        gatilho=(Condicao("saiu_do_padrao", "aqui"), Condicao("a_cada", minutos=10)),
    )


def test_nuvem_antiga_nao_manda_estudo_e_o_criterio_segue_com_o_porteiro():
    for nada in (..., None, "", [], "estudo"):
        assert com_estudo(nada).estudo is None
    # Estudo vazio é estudo: confere em toda olhada, e é ele que manda — não o porteiro.
    assert com_estudo({}).estudo == Estudo()
    assert com_estudo({"contexto": [], "gatilho": []}).estudo == Estudo()


def test_condicao_de_contexto_que_o_agente_nao_entende_sai_e_nao_segura_a_analise(caplog):
    with caplog.at_level("WARNING", logger="farol_agent.configuracao"):
        regra = com_estudo({
            "contexto": [
                {"sinal": "pessoa", "onde": "aqui"},
                {"sinal": "forno_quente", "onde": "aqui"},            # sinal que a nuvem ganhe depois
                {"sinal": "pessoa", "onde": "quadro"},                # falta dizer qual quadro
                {"sinal": "pessoa", "onde": "na_lua"},
                {"sinal": "toda_olhada"},                             # é gatilho, não contexto
                "pessoa",
                {"sinal": "parado"},                                  # sem `onde`: é "aqui"
            ],
        })
    assert regra.estudo.contexto == (Condicao("pessoa", "aqui"), Condicao("parado", "aqui"))
    assert caplog.text.count("desconhecida; ela não segura a análise") == 5


@pytest.mark.parametrize("torto", [
    {"sinal": "tocou_a_campainha", "onde": "aqui"},
    {"sinal": "a_cada"},
    {"sinal": "a_cada", "minutos": 0},
    {"sinal": "a_cada", "minutos": "10"},
    {"sinal": "a_cada", "minutos": True},
    {"sinal": "entrou", "onde": "quadro", "zonaId": ""},
    {"sinal": "pessoa", "onde": "aqui"},                              # é contexto, não gatilho
    7,
])
def test_gatilho_que_o_agente_nao_entende_faz_o_criterio_ser_conferido_em_toda_olhada(torto, caplog):
    # Tirar só o gatilho desconhecido deixaria o critério olhando MENOS do que o estudo pediu.
    with caplog.at_level("WARNING", logger="farol_agent.configuracao"):
        regra = com_estudo({"gatilho": [{"sinal": "a_cada", "minutos": 10}, torto, {"sinal": "parou", "onde": "aqui"}]})
    assert regra.estudo.gatilho == ()
    assert "desconhecido; o critério é conferido em toda olhada" in caplog.text


def test_toda_olhada_engole_os_outros_gatilhos():
    regra = com_estudo({"gatilho": [{"sinal": "parou", "onde": "aqui"}, {"sinal": "toda_olhada"}, {"sinal": "a_cada", "minutos": 5}]})
    assert regra.estudo.gatilho == ()


# ══════════════════════════ os sinais: pessoa ══════════════════════════


def test_pessoa_so_deixa_de_valer_sem_nem_um_talvez_e_sem_pessoa_so_com_certeza():
    def vale(sinal, pontos):
        s = Sinais(Pessoas(**{AQUI: pontos}))
        return s._nivel(so(sinal), um_lugar(), BASE)

    assert vale("pessoa", ALGUEM) == (True, None)
    assert vale("pessoa", TALVEZ) == (True, None), "na dúvida, pergunta"
    assert vale("pessoa", NINGUEM) == (False, "ninguém em Quadro 1 — Chapa")
    assert vale("pessoa", []) == (False, "ninguém em Quadro 1 — Chapa")

    assert vale("sem_pessoa", NINGUEM) == (True, None)
    assert vale("sem_pessoa", TALVEZ) == (True, None), "na dúvida, pergunta"
    assert vale("sem_pessoa", ALGUEM) == (False, "há gente em Quadro 1 — Chapa")

    # Os limiares são os que o construtor recebe (os do detector da loja).
    exigente = Sinais(Pessoas(**{AQUI: [0.5]}), certeza=0.45, duvida=0.2)
    assert exigente._nivel(so("sem_pessoa"), um_lugar(), BASE)[0] is False
    frouxo = Sinais(Pessoas(**{AQUI: [0.5]}), certeza=0.9, duvida=0.6)
    assert frouxo._nivel(so("pessoa"), um_lugar(), BASE)[0] is False


def test_sem_detector_ou_com_ele_falhando_nenhuma_condicao_de_pessoa_segura(caplog):
    def quebrado(imagem, lugar, ts):
        raise RuntimeError("modelo corrompido")

    for sinais in (Sinais(None), Sinais(Pessoas()), Sinais(quebrado)):
        for sinal in ("pessoa", "sem_pessoa"):
            assert sinais._nivel(so(sinal), um_lugar(), BASE) == (True, None)
        for borda in ("entrou", "saiu"):
            assert sinais._acontecimento(so(borda), um_lugar(), "r1@zc", BASE) is True, "sem saber, dispara"
    assert "não contaram pessoas" in caplog.text


def bordas_de_pessoa(sequencia, *, passo=MEIO_MINUTO):
    """Para cada olhada da sequência: (ocupado, entrou, saiu)."""
    pessoas = Pessoas()
    s = Sinais(pessoas)
    saida = []
    for i, pontos in enumerate(sequencia):
        pessoas.por_lugar[AQUI] = pontos
        ts = BASE + passo * i
        lugar = um_lugar()
        saida.append((
            s.presenca(lugar, ts).ocupado,
            s._acontecimento(so("entrou"), lugar, "r1@zc", ts),
            s._acontecimento(so("saiu"), lugar, "r1@zc", ts),
        ))
    return saida


def test_entrou_e_saiu_sao_bordas_e_a_primeira_olhada_dispara_porque_nao_se_sabe():
    assert bordas_de_pessoa([NINGUEM, NINGUEM, ALGUEM, ALGUEM, NINGUEM, NINGUEM]) == [
        (False, True, True),      # a primeira: não há anterior — na dúvida, dispara
        (False, False, False),
        (True, True, False),      # entrou
        (True, False, False),
        (False, False, True),     # saiu
        (False, False, False),
    ]


def test_a_borda_de_pessoa_tem_histerese_o_talvez_mantem_o_que_era():
    # Uma pessoa na beirada do quadro oscila entre "talvez" e "certeza": não entra e sai a cada olhada.
    assert bordas_de_pessoa([NINGUEM, TALVEZ, ALGUEM, TALVEZ, ALGUEM, TALVEZ, NINGUEM])[1:] == [
        (False, False, False),    # talvez, e antes não havia: continua livre
        (True, True, False),      # certeza: entrou
        (True, False, False),     # talvez, e antes havia: continua ocupado
        (True, False, False),
        (True, False, False),
        (False, False, True),     # nem um talvez: saiu
    ]
    # Sem saber o que era, o "talvez" conta como alguém: é o lado que pergunta.
    assert bordas_de_pessoa([TALVEZ])[0][0] is True


def test_olhada_anterior_velha_demais_nao_e_anterior():
    limite = bordas_de_pessoa([ALGUEM, ALGUEM], passo=VELHO)
    assert limite[1] == (True, False, False), "cinco minutos ainda é a anterior"
    velha = bordas_de_pessoa([ALGUEM, ALGUEM], passo=VELHO + timedelta(seconds=1))
    assert velha[1] == (True, True, True), "passou disso é outra cena: não se sabe, e dispara"
    # Relógio que andou para trás também não é "anterior".
    pessoas = Pessoas(**{AQUI: ALGUEM})
    s = Sinais(pessoas)
    s.presenca(um_lugar(), BASE)
    assert s.presenca(um_lugar(), BASE - MEIO_MINUTO).antes is None


def test_o_mesmo_lugar_e_lido_uma_vez_por_olhada_e_todos_veem_a_mesma_borda():
    pessoas = Pessoas(**{AQUI: NINGUEM})
    s = Sinais(pessoas)
    s.presenca(um_lugar(), BASE)
    pessoas.por_lugar[AQUI] = ALGUEM
    ts = BASE + MEIO_MINUTO
    # Dois critérios no mesmo quadro, na mesma olhada: os dois veem "entrou".
    assert s._acontecimento(so("entrou"), um_lugar(), "r1@zc", ts) is True
    assert s._acontecimento(so("entrou"), um_lugar(), "r2@zc", ts) is True
    assert s._nivel(so("pessoa"), um_lugar(), ts) == (True, None)
    assert len(pessoas.chamadas) == 2, "uma leitura por olhada, não importa quantos perguntem"
    # Outro lugar é outra leitura, com a sua própria memória.
    pessoas.por_lugar[NO_POSTO] = ALGUEM
    assert s.presenca(um_lugar(NO_POSTO, zona=POSTO), ts).antes is None
    assert len(pessoas.chamadas) == 3


# ══════════════════════════ os sinais: movimento ══════════════════════════


PARADA = cozinha(320, 180)
MEXIDA = com_objeto(PARADA, 0.3, 0.3, 0.05)


def bordas_de_movimento(imagens_da_sequencia, *, passo=MEIO_MINUTO):
    """Para cada olhada: (movimento vale, parado vale, mexeu, parou)."""
    s = Sinais()
    saida = []
    for i, img in enumerate(imagens_da_sequencia):
        ts, lugar = BASE + passo * i, um_lugar(imagem=img)
        saida.append((
            s._nivel(so("movimento"), lugar, ts)[0],
            s._nivel(so("parado"), lugar, ts)[0],
            s._acontecimento(so("mexeu"), lugar, "r1@zc", ts),
            s._acontecimento(so("parou"), lugar, "r1@zc", ts),
        ))
    return saida


def test_movimento_parado_mexeu_e_parou():
    assert bordas_de_movimento([PARADA, PARADA, MEXIDA, PARADA, PARADA, PARADA]) == [
        (True, True, True, True),        # a primeira: não há com o que comparar — nada segura, tudo dispara
        (False, True, False, True),      # parada; a anterior não sabia se mexia: "parou" dispara na dúvida
        (True, False, True, False),      # mexeu
        (True, False, True, False),      # o objeto saiu: mudou de novo
        (False, True, False, True),      # parou: mexia na anterior, e agora não
        (False, True, False, False),     # continua parada: não é borda
    ]


def test_o_motivo_do_movimento_diz_o_lugar():
    s = Sinais()
    s.movimento(um_lugar(imagem=PARADA), BASE)
    assert s._nivel(so("movimento"), um_lugar(imagem=PARADA), BASE + MEIO_MINUTO) == (False, "nada se mexeu em Quadro 1 — Chapa")
    assert s._nivel(so("parado"), um_lugar(imagem=MEXIDA), BASE + 2 * MEIO_MINUTO) == (False, "há movimento em Quadro 1 — Chapa")


def test_movimento_medido_contra_olhada_velha_nao_vale():
    velha = bordas_de_movimento([PARADA, MEXIDA], passo=VELHO + timedelta(seconds=1))
    assert velha[1] == (True, True, True, True), "de uma cena de seis minutos atrás não se tira movimento"
    # A medida é em tons de cinza: a mesma cena, colorida ou já em cinza, não é movimento.
    s = Sinais()
    s.movimento(um_lugar(imagem=PARADA), BASE)
    em_cinza = cv2.cvtColor(PARADA, cv2.COLOR_BGR2GRAY)
    assert s.movimento(um_lugar(imagem=em_cinza), BASE + MEIO_MINUTO).agora is False


# ══════════════════════════ os sinais: foto padrão ══════════════════════════


def bordas_do_padrao(sequencia, *, limiar=None):
    """Para cada olhada: (fora_do_padrao vale, no_padrao vale, saiu_do_padrao, voltou_ao_padrao)."""
    semelhanca = Semelhanca()
    s = Sinais(semelhanca=semelhanca) if limiar is None else Sinais(semelhanca=semelhanca, limiar_padrao=limiar)
    saida = []
    for i, valor in enumerate(sequencia):
        semelhanca.por_zona["zc"] = valor
        ts, lugar = BASE + MEIO_MINUTO * i, um_lugar()
        saida.append((
            s._nivel(so("fora_do_padrao"), lugar, ts)[0],
            s._nivel(so("no_padrao"), lugar, ts)[0],
            s._acontecimento(so("saiu_do_padrao"), lugar, "r1@zc", ts),
            s._acontecimento(so("voltou_ao_padrao"), lugar, "r1@zc", ts),
        ))
    return saida


def test_a_foto_padrao_diz_se_ha_algo_ali_e_quando_isso_comecou():
    # 0,90 é o limiar medido: a partir dele, a cena é a da foto padrão.
    assert bordas_do_padrao([0.97, 0.90, 0.89, 0.30, 0.95, 0.96]) == [
        (False, True, True, True),       # a primeira: no padrão; bordas não se sabe — disparam
        (False, True, False, False),     # 0,90 ainda é o padrão
        (True, False, True, False),      # saiu do padrão: algo foi posto
        (True, False, False, False),
        (False, True, False, True),      # voltou ao padrão: ficou vazio
        (False, True, False, False),
    ]
    assert bordas_do_padrao([0.80, 0.80], limiar=0.75)[1][:2] == (False, True), "o limiar é o que o construtor recebe"


def test_canal_sem_foto_padrao_nao_segura_nada(caplog):
    def quebrado(imagem, zona):
        raise OSError("foto ilegível")

    assert bordas_do_padrao([None, None]) == [(True, True, True, True)] * 2
    for s in (Sinais(), Sinais(semelhanca=quebrado)):
        assert s._nivel(so("fora_do_padrao"), um_lugar(), BASE) == (True, None)
        assert s._acontecimento(so("saiu_do_padrao"), um_lugar(), "r1@zc", BASE) is True
    assert "não compararam" in caplog.text
    # O motivo, quando segura, diz o lugar.
    s = Sinais(semelhanca=Semelhanca(zc=0.97))
    assert s._nivel(so("fora_do_padrao"), um_lugar(), BASE) == (False, "Quadro 1 — Chapa está como na foto padrão")
    s = Sinais(semelhanca=Semelhanca(zc=0.2))
    assert s._nivel(so("no_padrao"), um_lugar(), BASE) == (False, "Quadro 1 — Chapa não está como na foto padrão")


# ══════════════════════════ a conta do estudo ══════════════════════════


def aqui_mesmo(lugar=None):
    lugar = lugar or um_lugar()
    return lambda c: lugar


def test_estudo_vazio_confere_em_toda_olhada():
    p = Sinais().avaliar(Estudo(), criterio="r1@zc", ts=BASE, onde=aqui_mesmo())
    assert (p.falta, p.disparou) == (None, True)


def test_o_contexto_e_tudo_e_o_gatilho_e_qualquer_um():
    pessoas, semelhanca = Pessoas(**{AQUI: ALGUEM}), Semelhanca(zc=0.2)
    s = Sinais(pessoas, semelhanca=semelhanca)
    estudo = Estudo(
        contexto=(so("pessoa"), so("fora_do_padrao")),
        gatilho=(so("entrou"), so("saiu_do_padrao")),
    )

    def avaliar(i):
        return s.avaliar(estudo, criterio="r1@zc", ts=BASE + MEIO_MINUTO * i, onde=aqui_mesmo())

    assert avaliar(0).disparou is True                                  # a primeira: não se sabe
    assert (avaliar(1).falta, avaliar(1).disparou) == (None, False)     # tudo igual: contexto vale, nada abriu
    semelhanca.por_zona["zc"] = 0.97                                    # a chapa esvaziou
    p = avaliar(2)
    assert (p.falta, p.sinal_que_falta, p.disparou) == ("Quadro 1 — Chapa está como na foto padrão", "fora_do_padrao", False)
    semelhanca.por_zona["zc"] = 0.2                                     # carne de novo: UM dos gatilhos basta
    p = avaliar(3)
    assert (p.falta, p.disparou) == (None, True)
    pessoas.por_lugar[AQUI] = NINGUEM                                   # o chapeiro saiu: falta a PRIMEIRA condição
    p = avaliar(4)
    assert (p.falta, p.sinal_que_falta) == ("ninguém em Quadro 1 — Chapa", "pessoa")


def test_tudo_e_lido_mesmo_com_o_contexto_faltando_a_borda_de_depois_sai_desta_leitura():
    # Olhada 1: ninguém no posto (o contexto falta) e JÁ há carne na chapa. Olhada 2: o chapeiro chega.
    # A carne não "acabou de ser posta": se a chapa não fosse lida na olhada 1, a 2 dispararia na dúvida.
    pessoas, semelhanca = Pessoas(**{AQUI: NINGUEM}), Semelhanca(zc=0.2)
    s = Sinais(pessoas, semelhanca=semelhanca)
    estudo = Estudo(contexto=(so("pessoa"),), gatilho=(so("saiu_do_padrao"),))
    primeira = s.avaliar(estudo, criterio="r1@zc", ts=BASE, onde=aqui_mesmo())
    assert primeira.falta == "ninguém em Quadro 1 — Chapa"
    assert semelhanca.chamadas == ["zc"], "o gatilho foi lido mesmo com o contexto faltando"
    pessoas.por_lugar[AQUI] = ALGUEM
    segunda = s.avaliar(estudo, criterio="r1@zc", ts=BASE + MEIO_MINUTO, onde=aqui_mesmo())
    assert (segunda.falta, segunda.disparou) == (None, False)


def test_o_contexto_que_falta_nao_interrompe_a_leitura_dos_outros_e_o_motivo_e_o_do_primeiro():
    # Olhada 1: ninguém (falta a primeira condição). Olhada 2: chegou alguém, e a cena é a MESMA.
    # "Movimento" só sabe que nada mexeu se o quadro também foi lido na olhada 1.
    pessoas = Pessoas(**{AQUI: NINGUEM})
    s = Sinais(pessoas)
    estudo = Estudo(contexto=(so("pessoa"), so("movimento")))
    lugar = um_lugar(imagem=PARADA)
    assert s.avaliar(estudo, criterio="r1@zc", ts=BASE, onde=aqui_mesmo(lugar)).falta == "ninguém em Quadro 1 — Chapa"
    pessoas.por_lugar[AQUI] = ALGUEM
    segunda = s.avaliar(estudo, criterio="r1@zc", ts=BASE + MEIO_MINUTO, onde=aqui_mesmo(lugar))
    assert (segunda.falta, segunda.sinal_que_falta) == ("nada se mexeu em Quadro 1 — Chapa", "movimento")
    # Faltando as duas, o motivo dito é o da PRIMEIRA: é ela que decide o que fazer com a espera.
    pessoas.por_lugar[AQUI] = NINGUEM
    terceira = s.avaliar(estudo, criterio="r1@zc", ts=BASE + 2 * MEIO_MINUTO, onde=aqui_mesmo(lugar))
    assert (terceira.falta, terceira.sinal_que_falta) == ("ninguém em Quadro 1 — Chapa", "pessoa")


def test_a_cada_n_minutos_conta_desde_a_ultima_vez_que_a_analise_abriu():
    pessoas = Pessoas(**{AQUI: ALGUEM})
    s = Sinais(pessoas)
    estudo = Estudo(contexto=(so("pessoa"),), gatilho=(Condicao("a_cada", minutos=10),))

    def abriu(minuto, criterio="r1@zc"):
        p = s.avaliar(estudo, criterio=criterio, ts=BASE + timedelta(minutes=minuto), onde=aqui_mesmo())
        return p.falta is None and p.disparou

    assert abriu(0) is True, "a primeira abre"
    assert [abriu(m) for m in (1, 5, 9.5)] == [False, False, False]
    assert abriu(10) is True, "dez minutos: abre de novo"
    assert abriu(19.9) is False and abriu(20) is True
    # O relógio é do critério naquele quadro: outro critério tem o seu.
    assert abriu(20.5, criterio="r2@zc") is True
    # Com o contexto faltando a análise não abriu — e o relógio não recomeça.
    pessoas.por_lugar[AQUI] = NINGUEM
    assert abriu(31) is False
    pessoas.por_lugar[AQUI] = ALGUEM
    assert abriu(31.5) is True, "o contexto voltou e já passaram dez minutos desde a última análise"
    assert abriu(40) is False and abriu(41.5) is True


def test_a_cada_e_outro_gatilho_o_relogio_recomeca_quando_qualquer_um_abre():
    pessoas = Pessoas(**{AQUI: NINGUEM})
    s = Sinais(pessoas)
    estudo = Estudo(gatilho=(Condicao("a_cada", minutos=10), so("entrou")))

    def abriu(minuto):
        return s.avaliar(estudo, criterio="r1@zc", ts=BASE + timedelta(minutes=minuto), onde=aqui_mesmo()).disparou

    assert abriu(0) is True
    assert abriu(4) is False
    pessoas.por_lugar[AQUI] = ALGUEM
    assert abriu(4.5) is True, "alguém entrou"
    assert abriu(9) is False
    assert abriu(14) is False, "dez minutos contam da entrada, não da primeira olhada"
    assert abriu(14.5) is True


def test_lugar_que_nao_existe_no_canal_nao_segura_e_dispara():
    s = Sinais(Pessoas(**{"*": NINGUEM}))
    estudo = Estudo(contexto=(so("pessoa", "quadro", zona_id="sumiu"),), gatilho=(so("entrou", "quadro", zona_id="sumiu"),))
    for _ in range(3):
        p = s.avaliar(estudo, criterio="r1@zc", ts=BASE, onde=lambda c: None)
        assert (p.falta, p.disparou) == (None, True)


def test_esquecer_larga_a_memoria_do_que_saiu_da_configuracao():
    s = Sinais(Pessoas(**{"*": ALGUEM}), semelhanca=Semelhanca(**{"*": 0.5}))
    estudo = Estudo(contexto=(so("pessoa"), so("movimento"), so("fora_do_padrao")), gatilho=(Condicao("a_cada", minutos=10),))
    for criterio, lugar in (("r1@zc", um_lugar()), ("r2@zp", um_lugar(NO_POSTO, zona=POSTO))):
        s.avaliar(estudo, criterio=criterio, ts=BASE, onde=aqui_mesmo(lugar))
    s.esquecer({"r1@zc"}, {AQUI})
    assert set(s._ultimo_disparo) == {"r1@zc"}
    assert set(s._presenca) == set(s._movimento) == set(s._padrao) == {AQUI}


# ══════════════════════════ no motor: o funil ══════════════════════════


def o_motor(fila, regra, *, pessoas=None, semelhanca=None, **mais):
    return MotorDeRegras(fila, [regra], sinais=Sinais(pessoas, semelhanca=semelhanca), zonas=ZONAS, **mais)


def test_sem_contexto_e_nada_a_conferir_sem_gatilho_e_sem_gatilho_e_com_os_dois_a_olhada_segue(fila, regra):
    # O exemplo do dono: carne na chapa E colaborador no posto; abre quando a carne é posta.
    pessoas, semelhanca = Pessoas(**{NO_POSTO: NINGUEM}), Semelhanca(zc=0.97)
    estudo = Estudo(
        contexto=(so("fora_do_padrao"), so("pessoa", "quadro", zona_id="zp")),
        gatilho=(so("saiu_do_padrao"),),
    )
    motor = o_motor(fila, na_chapa(regra, estudo), pessoas=pessoas, semelhanca=semelhanca)
    fonte, juiz = FonteDeCena(), JuizFixo(Resultado.CONFORME)

    def passo(i):
        preparo = olhar(motor, fonte, BASE + MEIO_MINUTO * i)
        motor.processar(juiz, BASE + MEIO_MINUTO * i + timedelta(seconds=2), limite=50)
        return preparo

    p = passo(0)                                         # chapa vazia, ninguém
    assert (p.sem_condicao, p.sem_gatilho, p.enfileirados) == (["r1"], [], [])
    assert motor.sem_condicao["r1@zc"] == "Quadro 1 — Chapa está como na foto padrão"
    pessoas.por_lugar[NO_POSTO] = ALGUEM
    passo(1)                                             # o chapeiro chegou, chapa vazia: ainda sem contexto
    semelhanca.por_zona["zc"] = 0.3
    p = passo(2)                                         # pôs a carne: contexto vale e o gatilho abre
    assert (p.sem_condicao, p.sem_gatilho, p.enfileirados) == ([], [], ["r1"])
    p = passo(3)                                         # a carne continua lá: contexto vale, nada abriu
    assert (p.sem_condicao, p.sem_gatilho, p.enfileirados) == ([], ["r1"], [])
    passo(4)
    pessoas.por_lugar[NO_POSTO] = NINGUEM
    p = passo(5)                                         # o chapeiro saiu
    assert p.sem_condicao == ["r1"] and motor.sem_condicao["r1@zc"] == "ninguém em Quadro 2 — Posto"

    assert juiz.chamadas == 1, "seis olhadas, uma análise"
    assert o_funil(fila) == (6, 3, 2, 0, 1)
    assert sorted(p.name for p in fila.spool.glob("*.jpg")) != [] and len(list(fila.spool.glob("*.jpg"))) == 1


def test_em_observando_o_funil_ja_conta_o_contexto_e_o_gatilho_sem_julgar(fila, regra):
    # É o que o dono pediu: ver quantas vezes o gatilho acontece ANTES de mandar julgar.
    pessoas = Pessoas(**{AQUI: NINGUEM})
    estudo = Estudo(contexto=(so("pessoa"),), gatilho=(Condicao("a_cada", minutos=2),))
    motor = o_motor(fila, na_chapa(regra, estudo, estado="observando"), pessoas=pessoas)
    fonte, juiz = FonteDeCena(), JuizFixo(Resultado.NAO_CONFORME, confianca=0.99)

    for i in range(10):                                  # cinco minutos de olhadas
        pessoas.por_lugar[AQUI] = NINGUEM if i < 2 else ALGUEM
        olhar(motor, fonte, BASE + MEIO_MINUTO * i)
    motor.processar(juiz, BASE + timedelta(minutes=6), limite=50)

    # 10 olhadas · 2 sem ninguém · 8 com contexto, das quais 2 com gatilho (aos 60 s e aos 180 s)
    assert o_funil(fila) == (10, 2, 6, 2, 0)
    assert juiz.chamadas == 0 and list(fila.spool.glob("*.jpg")) == [] and fila.resumo() == {}


def test_o_estudo_decide_no_lugar_do_porteiro(fila, regra):
    class PorteiroQueSeguraTudo(Porteiro):
        consultas = 0

        def decidir(self, *a, **k):
            type(self).consultas += 1
            raise AssertionError("o critério com estudo não consulta o porteiro")

    # Com estudo, o "só com pessoa na área" guardado no critério não é consultado...
    com = MotorDeRegras(
        fila, [na_chapa(regra, Estudo(), porteiro="pessoa")],
        sinais=Sinais(Pessoas(**{"*": NINGUEM})), zonas=ZONAS, porteiro=PorteiroQueSeguraTudo(None),
    )
    assert olhar(com, FonteDeCena(), BASE).enfileirados == ["r1"]
    assert PorteiroQueSeguraTudo.consultas == 0

    # ...e sem estudo o porteiro continua valendo, como sempre.
    class Detector:
        def pontuar(self, imagem, classe):
            return [0.0]

    sem = MotorDeRegras(fila, [replace(regra, id="r2", zona=CHAPA, porteiro="pessoa")], sinais=Sinais(), zonas=ZONAS, porteiro=Porteiro(Detector()))
    assert olhar(sem, FonteDeCena(), BASE + MEIO_MINUTO).sem_condicao == ["r2"]


def test_sem_quem_leia_os_sinais_o_criterio_com_estudo_e_conferido_em_toda_olhada(fila, regra):
    # Modo de bancada, ou motor montado sem os sinais: o estudo não segura nada.
    estudo = Estudo(contexto=(so("pessoa"),), gatilho=(so("entrou"),))
    motor = MotorDeRegras(fila, [na_chapa(regra, estudo)])
    for i in range(3):
        assert olhar(motor, FonteDeCena(imagem=cozinha(640, 360, semente=i)), BASE + MEIO_MINUTO * i).enfileirados == ["r1"]


@pytest.mark.parametrize("tipo", [TipoRegra.PRESENCA, TipoRegra.CONTAGEM])
def test_presenca_e_contagem_nao_usam_estudo_toda_olhada_e_a_medida(fila, regra, tipo):
    pessoas = Pessoas(**{"*": NINGUEM})
    estudo = Estudo(contexto=(so("pessoa"),), gatilho=(Condicao("a_cada", minutos=60),))
    da_loja = na_chapa(regra, estudo, tipo=tipo, parametros={"objeto": "pessoa", "minimo": 1})
    motor = o_motor(fila, da_loja, pessoas=pessoas)
    for i in range(3):
        assert olhar(motor, FonteDeCena(), BASE + MEIO_MINUTO * i).enfileirados == ["r1"]
    assert pessoas.chamadas == [], "os sinais nem são lidos"
    assert o_funil(fila) == (3, 0, 0, 0, 3)


def test_cada_condicao_e_lida_no_seu_lugar_o_quadro_o_outro_quadro_e_a_imagem_completa(fila, regra):
    pessoas, semelhanca = Pessoas(**{"*": ALGUEM}), Semelhanca(**{"*": 0.2})
    estudo = Estudo(contexto=(
        so("pessoa"),                                    # aqui: o quadro do critério (a chapa)
        so("pessoa", "quadro", zona_id="zp"),            # o posto
        so("pessoa", "canal"),                           # a imagem completa
        so("fora_do_padrao", "quadro", zona_id="zp"),
        so("fora_do_padrao", "canal"),
    ))
    motor = o_motor(fila, na_chapa(regra, estudo), pessoas=pessoas, semelhanca=semelhanca)
    assert olhar(motor, FonteDeCena(imagem=cozinha(640, 360)), BASE).enfileirados == ["r1"]

    # 640×360: a chapa é 352×198, o posto 352×91 e a imagem completa 640×360.
    assert pessoas.chamadas == [(AQUI, (198, 352)), (NO_POSTO, (91, 352)), (NO_CANAL, (360, 640))]
    assert semelhanca.chamadas == ["zp", "canal"]


def test_tres_condicoes_no_mesmo_quadro_saem_de_um_recorte_e_de_uma_leitura(fila, regra):
    pessoas = Pessoas(**{"*": ALGUEM})
    estudo = Estudo(
        contexto=(so("pessoa", "quadro", zona_id="zp"), so("sem_pessoa", "canal")),
        gatilho=(so("entrou", "quadro", zona_id="zp"), so("saiu", "quadro", zona_id="zp")),
    )
    motor = o_motor(fila, na_chapa(regra, estudo), pessoas=pessoas)
    olhar(motor, FonteDeCena(), BASE)
    assert [lugar for lugar, _ in pessoas.chamadas] == [NO_POSTO, NO_CANAL]
    # Na olhada seguinte os recortes são feitos de novo: a memória do lugar é só da olhada.
    olhar(motor, FonteDeCena(), BASE + MEIO_MINUTO)
    assert [lugar for lugar, _ in pessoas.chamadas] == [NO_POSTO, NO_CANAL] * 2


def test_quadro_de_outro_canal_ou_que_nao_existe_mais_nao_segura_e_dispara(fila, regra):
    pessoas = Pessoas(**{"*": NINGUEM})
    for i, zona_id in enumerate(("zx", "apagado")):
        estudo = Estudo(contexto=(so("pessoa", "quadro", zona_id=zona_id),), gatilho=(so("entrou", "quadro", zona_id=zona_id),))
        motor = o_motor(fila, na_chapa(regra, estudo, id=f"r{i}"), pessoas=pessoas)
        for volta in range(2):
            fonte = FonteDeCena(imagem=cozinha(640, 360, semente=10 * i + volta))
            assert olhar(motor, fonte, BASE + MEIO_MINUTO * (2 * i + volta)).enfileirados == [f"r{i}"]
    assert pessoas.chamadas == [], "o detector nem é chamado para um lugar que não é deste canal"


def test_dois_criterios_no_mesmo_canal_cada_um_com_o_seu_estudo(fila, regra):
    # Um pede gente no posto; o outro, o posto livre. Na mesma olhada, um segue e o outro não.
    pessoas = Pessoas(**{NO_POSTO: ALGUEM})
    com_gente = na_chapa(regra, Estudo(contexto=(so("pessoa", "quadro", zona_id="zp"),)), id="com")
    livre = replace(regra, id="livre", zona=POSTO, estudo=Estudo(contexto=(so("sem_pessoa"),)))
    motor = MotorDeRegras(fila, [com_gente, livre], sinais=Sinais(pessoas), zonas=ZONAS)

    p = olhar(motor, FonteDeCena(), BASE)
    assert (p.enfileirados, p.sem_condicao) == (["com"], ["livre"])
    assert motor.sem_condicao["livre@zp"] == "há gente em Quadro 2 — Posto"
    assert len(pessoas.chamadas) == 1, "o posto foi lido uma vez para os dois critérios"

    pessoas.por_lugar[NO_POSTO] = NINGUEM
    p = olhar(motor, FonteDeCena(imagem=cozinha(640, 360, semente=5)), BASE + MEIO_MINUTO)
    assert (p.enfileirados, p.sem_condicao) == (["livre"], ["com"])


def test_o_relogio_dos_sinais_e_o_da_olhada_nao_o_do_quadro_escolhido(fila, regra):
    # Cada critério escolhe o quadro mais nítido da rajada, e cada quadro tem o seu instante. Com o
    # relógio do quadro, dois critérios na mesma olhada leriam o mesmo lugar duas vezes — e a segunda
    # leitura viraria a "olhada anterior" da primeira.
    vistos = []

    class Anota(Sinais):
        def avaliar(self, estudo, *, criterio, ts, onde):
            vistos.append(ts)
            return super().avaliar(estudo, criterio=criterio, ts=ts, onde=onde)

    sinais = Anota(Pessoas(**{"*": ALGUEM}))
    motor = MotorDeRegras(fila, [na_chapa(regra, Estudo(contexto=(so("pessoa"),)))], sinais=sinais, zonas=ZONAS)
    olhar(motor, FonteDeCena(), BASE)
    assert vistos == [BASE]


def test_camera_parada_continua_aparecendo_como_camera_parada(fila, regra):
    pessoas = Pessoas(**{"*": ALGUEM})
    motor = o_motor(fila, na_chapa(regra, Estudo(contexto=(so("pessoa"),))), pessoas=pessoas)
    preta = np.zeros((360, 640, 3), dtype=np.uint8)
    p = olhar(motor, FonteDeCena(imagem=preta), BASE)
    assert p.sem_cena == ["r1"] and p.sem_condicao == [] and pessoas.chamadas == []
    assert "r1@zc" in motor.sem_cena

    # A câmera voltou, e não há ninguém: é "nada a conferir", não defeito de câmera.
    pessoas.por_lugar["*"] = NINGUEM
    assert olhar(motor, FonteDeCena(), BASE + MEIO_MINUTO).sem_condicao == ["r1"]
    assert motor.sem_cena == {}


def test_a_camera_que_voltou_e_ficou_sem_gatilho_tambem_deixa_de_estar_parada(fila, regra):
    motor = o_motor(fila, na_chapa(regra, Estudo(gatilho=(Condicao("a_cada", minutos=10),))), pessoas=Pessoas())
    assert olhar(motor, FonteDeCena(), BASE).enfileirados == ["r1"]
    olhar(motor, FonteDeCena(imagem=np.zeros((360, 640, 3), dtype=np.uint8)), BASE + MEIO_MINUTO)
    assert "r1@zc" in motor.sem_cena
    assert olhar(motor, FonteDeCena(), BASE + 2 * MEIO_MINUTO).sem_gatilho == ["r1"]
    assert motor.sem_cena == {}


# ══════════════════════════ "avisar só se continuar" ══════════════════════════


def esperando_confirmar(fila, regra, estudo, pessoas, **da_regra):
    """Um critério valendo, com "avisar só se continuar", já com o primeiro fora do critério julgado."""
    motor = o_motor(fila, na_chapa(regra, estudo, confirmar_em=3, cooldown_min=0, **da_regra), pessoas=pessoas)
    juiz = JuizFixo(Resultado.NAO_CONFORME, confianca=0.99)
    assert olhar(motor, FonteDeCena(), BASE).enfileirados == ["r1"]
    assert motor.processar(juiz, BASE + timedelta(seconds=2), limite=50) == []
    assert motor._seguidas["r1@zc"].quantas == 1
    return motor


def test_sem_ninguem_o_que_esperava_confirmacao_numa_pessoa_recomeca_do_zero(fila, regra):
    pessoas = Pessoas(**{AQUI: ALGUEM})
    motor = esperando_confirmar(fila, regra, Estudo(contexto=(so("pessoa"),)), pessoas)
    pessoas.por_lugar[AQUI] = NINGUEM
    assert olhar(motor, FonteDeCena(), BASE + MEIO_MINUTO).sem_condicao == ["r1"]
    assert motor._seguidas == {}, "a pessoa saiu: o que estava fora do critério nela deixou de estar"


def test_com_gente_na_frente_a_espera_nem_anda_nem_zera(fila, regra):
    # O critério ainda guarda o "só com pessoa na área" de antes do estudo. Com estudo ele não é
    # consultado — nem para decidir o que fazer com a espera.
    pessoas = Pessoas(**{AQUI: NINGUEM})
    motor = esperando_confirmar(fila, regra, Estudo(contexto=(so("sem_pessoa"),)), pessoas, porteiro="pessoa")
    pessoas.por_lugar[AQUI] = ALGUEM
    assert olhar(motor, FonteDeCena(), BASE + MEIO_MINUTO).sem_condicao == ["r1"]
    assert motor._seguidas["r1@zc"].quantas == 1, "não se viu: nem continuou, nem deixou de estar"


def test_sem_gatilho_a_espera_nem_anda_nem_zera(fila, regra):
    pessoas = Pessoas(**{AQUI: ALGUEM})
    motor = esperando_confirmar(fila, regra, Estudo(gatilho=(Condicao("a_cada", minutos=10),)), pessoas)
    for i in (1, 2, 3):
        assert olhar(motor, FonteDeCena(), BASE + MEIO_MINUTO * i).sem_gatilho == ["r1"]
    assert motor._seguidas["r1@zc"].quantas == 1 and motor._confirmados == []


# ══════════════════════════ o resumo que sobe ══════════════════════════


def test_sem_gatilho_e_um_contador_do_resumo_e_a_conta_das_olhadas_fecha(fila, regra):
    assert "sem_gatilho" in CONTADORES_DO_RESUMO
    pessoas = Pessoas(**{AQUI: ALGUEM})
    motor = o_motor(fila, na_chapa(regra, Estudo(contexto=(so("pessoa"),), gatilho=(so("entrou"),)), estado="observando"), pessoas=pessoas)
    for i, pontos in enumerate([ALGUEM, ALGUEM, NINGUEM, ALGUEM, ALGUEM]):
        pessoas.por_lugar[AQUI] = pontos
        olhar(motor, FonteDeCena(), BASE + MEIO_MINUTO * i)

    (linha,) = fila.resumos_a_subir()
    corpo = resumo_para_nuvem(linha)
    assert (corpo["capturas"], corpo["semCondicao"], corpo["semGatilho"], corpo["observadas"]) == (5, 1, 2, 2)
    desfechos = ("semJuiz", "semQuadro", "semCena", "semCondicao", "semGatilho", "observadas", "emSilencio", "repetidas", "jaJulgadas", "enfileiradas")
    assert sum(corpo[d] for d in desfechos) == corpo["capturas"], "a conta das olhadas fecha com o desfecho novo"


def test_a_fila_de_uma_loja_que_ja_existe_ganha_a_coluna(tmp_path, regra):
    caminho = tmp_path / "fila.db"
    nova = Fila(caminho)
    nova.fechar()
    con = sqlite3.connect(caminho)
    con.execute("alter table resumo_hora drop column sem_gatilho")
    con.commit()
    assert "sem_gatilho" not in [l[1] for l in con.execute("pragma table_info(resumo_hora)")]
    con.close()

    fila = Fila(caminho)
    try:
        pessoas = Pessoas(**{AQUI: ALGUEM})
        motor = o_motor(fila, na_chapa(regra, Estudo(gatilho=(so("entrou"),))), pessoas=pessoas)
        olhar(motor, FonteDeCena(), BASE)
        olhar(motor, FonteDeCena(), BASE + MEIO_MINUTO)
        assert a_linha(fila)["sem_gatilho"] == 1
    finally:
        fila.fechar()


# ══════════════════════════ pela auditoria ══════════════════════════


class DetectorDaLoja:
    """O detector de pessoas da loja, de mentira: vê gente onde a imagem é clara."""

    def __init__(self):
        self.vistos: list[tuple[int, int]] = []
        self.classes: list[str] = []
        self.pontos = [0.9]

    def pontuar(self, imagem, classe):
        self.vistos.append(tuple(imagem.shape[:2]))
        self.classes.append(classe)
        return list(self.pontos)


def duas_areas(estudo, versao=7, **da_regra) -> dict:
    """O canal de teste com dois quadros (a chapa e o posto) e um critério na chapa, com estudo."""
    corpo = resposta(versao=versao)
    ponto = corpo["pontos"][0]
    base = {**ponto["zonas"][0]["regras"][0], "janelas": [], "quando": "sempre", **da_regra}
    ponto["zonas"] = [
        {"id": "zc", "nome": "Chapa", "poligono": [[0.05, 0.10], [0.60, 0.10], [0.60, 0.65], [0.05, 0.65]], "principal": True, "papel": "equipamento", "numero": 1,
         "regras": [{**base, "estudo": estudo}]},
        {"id": "zp", "nome": "Posto", "poligono": [[0.05, 0.70], [0.60, 0.70], [0.60, 0.95], [0.05, 0.95]], "principal": False, "papel": "posto", "numero": 2, "regras": []},
    ]
    return corpo


def a_auditoria(tmp_path, juiz, detector=None):
    a = Auditoria(
        NuvemDeTeste(), str(tmp_path / "fila.db"),
        construir_fonte=lambda ponto: FonteDeCena(ponto.id), construir_juiz=lambda cfg: juiz, medidor=None,
    )
    a._detector_do_porteiro = lambda: None if detector is None else SimpleNamespace(motor=detector)
    return a


def test_pela_auditoria_o_estudo_usa_o_detector_da_loja_e_os_quadros_do_canal(tmp_path):
    detector, juiz = DetectorDaLoja(), JuizDeTeste()
    a = a_auditoria(tmp_path, juiz, detector)
    estudo = {"contexto": [{"sinal": "pessoa", "onde": "quadro", "zonaId": "zp"}], "gatilho": [{"sinal": "entrou", "onde": "quadro", "zonaId": "zp"}]}
    # Em ensaio, de propósito: o juiz de teste responde "fora do critério", e valendo o critério
    # entraria no silêncio depois do primeiro aviso — a olhada seguinte nem chegaria ao estudo.
    a.montar(de_json(duas_areas(estudo, estado="ensaio")))

    r = a.passo(TERCA_MEIO_DIA)                          # a primeira: há gente no posto, e não se sabe se entrou
    assert (r["enfileirados"], juiz.chamadas) == (1, 1)
    assert detector.vistos == [(91, 352)], "o detector olhou o POSTO (352×91), não a chapa (352×198)"
    assert detector.classes == [OBJETOS["pessoa"]], "e procurou pessoa"

    r = a.passo(TERCA_MEIO_DIA + MEIO_MINUTO)            # continua lá: contexto vale, ninguém entrou
    assert (r["enfileirados"], juiz.chamadas) == (0, 1)
    detector.pontos = [0.0]
    a.passo(TERCA_MEIO_DIA + 2 * MEIO_MINUTO)            # saiu: sem contexto
    l = dict(a.fila._con.execute("select * from resumo_hora").fetchone())
    assert (l["capturas"], l["sem_condicao"], l["sem_gatilho"], l["enfileiradas"]) == (3, 1, 1, 1)
    a.parar()


def test_pela_auditoria_os_sinais_sobrevivem_a_mudanca_de_configuracao(tmp_path):
    detector, juiz = DetectorDaLoja(), JuizDeTeste()
    a = a_auditoria(tmp_path, juiz, detector)
    estudo = {"gatilho": [{"sinal": "entrou", "onde": "aqui"}]}
    a.montar(de_json(duas_areas(estudo, versao=7, estado="ensaio")))       # em ensaio: sem silêncio no caminho
    assert a.passo(TERCA_MEIO_DIA)["enfileirados"] == 1
    sinais = a._sinais
    assert sinais is not None

    # A configuração mudou (outro texto de critério): o motor é outro, a memória dos sinais é a mesma.
    motor_de_antes = a.motor
    a.montar(de_json(duas_areas(estudo, versao=8, estado="ensaio", criterio="a chapa está raspada")))
    assert a.motor is not motor_de_antes and a._sinais is sinais and a.motor._sinais is sinais
    r = a.passo(TERCA_MEIO_DIA + MEIO_MINUTO)
    assert r["enfileirados"] == 0, "a pessoa já estava lá antes da mudança: não 'entrou' de novo"
    assert dict(a.fila._con.execute("select * from resumo_hora").fetchone())["sem_gatilho"] == 1

    # O critério perdeu o estudo: a memória é largada.
    a.montar(de_json(duas_areas(None, versao=9)))
    assert a.motor._sinais is None and a._sinais is None

    # Presença e contagem não usam estudo: só por elas, os sinais nem são montados.
    a.montar(de_json(duas_areas(estudo, versao=10, tipo="presenca", parametros={"objeto": "pessoa", "minimo": 1})))
    assert a.motor._sinais is None and a._sinais is None
    a.parar()


def test_pela_auditoria_a_memoria_de_quem_saiu_da_configuracao_e_largada(tmp_path):
    detector, juiz = DetectorDaLoja(), JuizDeTeste()
    a = a_auditoria(tmp_path, juiz, detector)
    estudo = {"contexto": [{"sinal": "pessoa", "onde": "aqui"}], "gatilho": [{"sinal": "a_cada", "minutos": 10}]}
    corpo = duas_areas(estudo, versao=7, estado="ensaio")
    chapa, posto = corpo["pontos"][0]["zonas"]
    posto["regras"] = [{**chapa["regras"][0], "id": "r2", "nome": "no posto"}]
    a.montar(de_json(corpo))
    a.passo(TERCA_MEIO_DIA)
    assert set(a._sinais._ultimo_disparo) == {"r1@zc", "r2@zp"}
    assert set(a._sinais._presenca) == {"p1:zc", "p1:zp"}

    # O quadro do posto foi excluído, e o critério dele com ele.
    corpo = duas_areas(estudo, versao=8, estado="ensaio")
    corpo["pontos"][0]["zonas"] = corpo["pontos"][0]["zonas"][:1]
    a.montar(de_json(corpo))
    assert set(a._sinais._ultimo_disparo) == {"r1@zc"}
    assert set(a._sinais._presenca) == {"p1:zc"}
    a.parar()


def test_pela_auditoria_sem_detector_instalado_o_estudo_nao_segura_nada(tmp_path):
    juiz = JuizDeTeste()
    a = a_auditoria(tmp_path, juiz, detector=None)
    # O juiz de teste também não tem foto padrão: "está como na foto" é mais uma coisa que não se sabe.
    estudo = {
        "contexto": [{"sinal": "pessoa", "onde": "aqui"}, {"sinal": "no_padrao", "onde": "aqui"}],
        "gatilho": [{"sinal": "entrou", "onde": "aqui"}],
    }
    a.montar(de_json(duas_areas(estudo)))
    assert a.passo(TERCA_MEIO_DIA)["enfileirados"] == 1
    a.parar()


def test_pela_auditoria_a_foto_padrao_vem_do_juiz_de_agora(tmp_path):
    juiz = JuizDeTeste()
    comparacoes: list[str] = []

    def mais_parecida(imagem, zona):
        comparacoes.append(zona.id)
        return SimpleNamespace(semelhanca=0.4)

    juiz.seletor = SimpleNamespace(para=lambda regra: juiz, padrao=SimpleNamespace(mais_parecida=mais_parecida), nuvem=None)
    a = a_auditoria(tmp_path, juiz)
    a.montar(de_json(duas_areas({"contexto": [{"sinal": "no_padrao", "onde": "aqui"}]})))

    r = a.passo(TERCA_MEIO_DIA)
    assert (r["enfileirados"], comparacoes) == (0, ["zc"]), "há algo na chapa: nada a conferir"
    assert a.motor.sem_condicao["r1@zc"] == "Quadro 1 — Chapa não está como na foto padrão"

    # Canal sem foto (o juiz não achou nenhuma): não se sabe, e não segura.
    juiz.seletor.padrao.mais_parecida = lambda imagem, zona: None
    assert a.passo(TERCA_MEIO_DIA + MEIO_MINUTO)["enfileirados"] == 1
    a.parar()


def test_de_ponta_a_ponta_com_a_foto_padrao_de_verdade(tmp_path, monkeypatch):
    # Nenhum dublê entre o estudo e a foto: o canal tem uma foto padrão em disco, o juiz da foto
    # padrão é o de produção, e o critério só observa (não precisa de quem julgue).
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    perguntas = []
    fonte = FonteDeCena("p1", LIMPA)
    a = Auditoria(NuvemComFotos(n1=NOITE), str(tmp_path / "fila.db"), construir_fonte=lambda ponto: fonte, medidor=None)
    a._detector_do_porteiro = lambda: None
    a._perguntar_relogios = lambda ponto: perguntas.append(ponto.host) or {}
    comum = {"tipo": "estado", "estado": "observando", "quando": "sempre", "janelas": []}

    a.montar(de_json(configuracao_com_fotos(versao=1, estudo={"contexto": [{"sinal": "pessoa", "onde": "aqui"}]}, **comum)))
    assert perguntas == [], "estudo que não compara com a foto não incomoda o gravador"

    so_no_gatilho = {"gatilho": [{"sinal": "voltou_ao_padrao", "onde": "aqui"}]}
    a.montar(de_json(configuracao_com_fotos(versao=2, estudo=so_no_gatilho, **comum)))
    assert perguntas == ["192.168.1.108"], "o gatilho compara com a foto: o gravador diz onde escreve o relógio"

    estudo = {"contexto": [{"sinal": "fora_do_padrao", "onde": "aqui"}], "gatilho": [{"sinal": "saiu_do_padrao", "onde": "aqui"}]}
    a.montar(de_json(configuracao_com_fotos(versao=3, estudo=estudo, **comum)))
    assert perguntas == ["192.168.1.108"], "a resposta do gravador fica guardada"

    a.passo(MEIO_DIA)                                    # a bancada está como na foto: nada a conferir
    fonte.imagem = com_objeto(LIMPA, 0.4, 0.5, 0.03)
    a.passo(MEIO_DIA + MEIO_MINUTO)                      # algo foi posto: o contexto vale e o gatilho abre
    a.passo(MEIO_DIA + 2 * MEIO_MINUTO)                  # continua lá: nada abriu
    fonte.imagem = LIMPA
    a.passo(MEIO_DIA + 3 * MEIO_MINUTO)                  # tiraram: nada a conferir

    l = dict(a.fila._con.execute("select * from resumo_hora").fetchone())
    assert (l["capturas"], l["sem_condicao"], l["sem_gatilho"], l["observadas"]) == (4, 2, 1, 1)
    assert a.sem_juiz == [] and list(a.fila.spool.glob("*.jpg")) == []
    a.fila.fechar()
