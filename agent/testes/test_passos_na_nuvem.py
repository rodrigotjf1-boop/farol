"""A noite lida por passos sobe para a conferência (A23.3, parte 4) — `passos_na_nuvem`.

Com uma nuvem de mentira, pastas de lanche montadas aqui como a bancada ao vivo grava (`passos.json` e os recortes) e o
contrato `contratos/lanche-de-treino.json` (o `porPassos`). O que se protege:

- a noite do lanche: a madrugada é da noite em que a loja abriu, a folga depois de fechar conta, fora do horário não; os
  dias da janela valem; duas aberturas no dia levam a hora na chave; a janela de mais de 14 horas se divide;
- a amostra: primeiro os com dúvida (a regra da nuvem), mais dúvidas antes; depois os outros, espalhados; a mesma
  escolha sempre; 0 não escolhe nada;
- o corpo: as etapas na ordem da hora; o pão só pelas 3 peças com UM pão de dois cortes na base; o passo com o nome do
  juiz; o vazio com o "parece" e sem candidato; recorte só no que se confere, reduzido, com o contorno na escala dele;
  tudo dentro do contrato (as chaves, os tipos, os limites);
- a linha: com a loja aberta não manda; sem horário não manda (e diz uma vez); a noite que não terminou espera; só o
  lanche lido com o juiz sobe; o que subiu não sobe de novo, a não ser que a leitura mude; 409 para a noite; 422 não
  repete; rede para a volta e repete na seguinte, sem repetir a frase no registro.
"""

from __future__ import annotations

import base64
import json
import logging
from datetime import datetime, timedelta
from pathlib import Path

import cv2
import numpy as np
import pytest

from farol_agent import imagens
from farol_agent.modelos import Janela
from farol_agent.nuvem import ErroDaNuvem
from farol_agent.passos_na_nuvem import (
    ENCERRADAS, ENVIADO, ConferenciaEmFundo, LancheLido, Noite, amostra, corpo_do_lanche, duvidas, noite_do_lanche,
    pao_pelas_pecas, por_noite,
)

CONTRATO = json.loads((Path(__file__).resolve().parents[2] / "contratos" / "lanche-de-treino.json").read_text(encoding="utf-8"))
FOLGA = timedelta(minutes=30)
TODO_DIA = [Janela(dias=[], hora_ini="19:00", hora_fim="03:00")]
PONTO = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b"
CONFIG = {
    "loja": {"horarioFuncionamento": [{"dias": [1, 2, 3, 4, 5, 6, 7], "hora_ini": "19:00", "hora_fim": "03:00"}]},
    "pontos": [{"id": PONTO, "canal": 4}],
}
NOITE = Noite("ao-vivo-canal-04-2026-10-21", datetime(2026, 10, 21, 19, 0), datetime(2026, 10, 22, 3, 31))


def iso(t: datetime) -> str:
    """Como a bancada ao vivo grava a hora (`bancada_ao_vivo._iso`)."""
    return t.astimezone().isoformat(timespec="seconds")


def jpg(caminho: Path, largura: int = 720, altura: int = 480) -> None:
    img = np.zeros((altura, largura, 3), np.uint8)
    img[:, :, 1] = np.linspace(0, 255, largura, dtype=np.uint8)[None, :]
    img[:, :, 2] = np.linspace(0, 255, altura, dtype=np.uint8)[:, None]
    assert imagens.escrever(caminho, img, [cv2.IMWRITE_JPEG_QUALITY, 90])


def passo(t: datetime, metade: int, tipo: str, *, nome=None, nota=None, parte=0.3, recorte=True, contorno=None) -> dict:
    p = {"hora": iso(t), "metade": metade, "tipo": tipo, "parte": parte, "papel": 0.1,
         "recorte": f"{t:%Hh%Mm%S}-m{metade}-{tipo}.jpg" if recorte else None, "contorno": contorno or []}
    if nota is not None:
        p.update(nome=nome, nota=nota)
    return p


def lanche(raiz: Path, inicio: datetime, n: int, passos: list[dict], *, metades: int = 2, canal: int = 4,
           juiz: bool = True) -> Path:
    """Uma pasta de lanche como a bancada ao vivo grava: `bancada/canal-NN/AAAA-MM-DD/passos-HHhMMmSS-N/`."""
    pasta = raiz / "bancada" / f"canal-{canal:02d}" / f"{inicio:%Y-%m-%d}" / f"passos-{inicio:%Hh%Mm%S}-{n}"
    pasta.mkdir(parents=True)
    for p in passos:
        if p.get("recorte"):
            jpg(pasta / p["recorte"])
    fim = max((datetime.fromisoformat(p["hora"]).astimezone().replace(tzinfo=None) for p in passos), default=inicio)
    leitura = {"lugar": n, "inicio": iso(inicio), "fim": iso(fim + timedelta(seconds=5)), "fechou": None,
               "metades": [{"k": k, "x": 100 * k, "y": 50, "d": 180, "desde": iso(inicio)} for k in range(1, metades + 1)],
               "passos": passos}
    if juiz:
        leitura["juiz"] = True
    (pasta / "passos.json").write_text(json.dumps(leitura, ensure_ascii=False, indent=1), encoding="utf-8")
    return pasta


def simples(raiz: Path, inicio: datetime, n: int, *, duvida: bool = False) -> Path:
    """Um lanche de duas peças: os começos e um passo — e, com `duvida`, um vazio."""
    passos = [passo(inicio + timedelta(seconds=2), 1, "comeco", nome="Pão brioche", nota=0.6, parte=1.0),
              passo(inicio + timedelta(seconds=3), 2, "comeco", nome="Pão brioche", nota=0.6, parte=1.0),
              passo(inicio + timedelta(seconds=40), 1, "passo", nome="Blend da casa", nota=0.66)]
    if duvida:
        passos.append(passo(inicio + timedelta(seconds=60), 2, "vazio", nome="Alface", nota=0.45))
    return lanche(raiz, inicio, n, passos)


# ───────────────────────────── a noite ─────────────────────────────


def test_a_madrugada_e_a_folga_sao_da_noite_em_que_a_loja_abriu():
    noite = noite_do_lanche(TODO_DIA, 4, datetime(2026, 10, 21, 21, 0), FOLGA)
    assert noite == NOITE
    assert noite_do_lanche(TODO_DIA, 4, datetime(2026, 10, 22, 1, 30), FOLGA) == noite
    assert noite_do_lanche(TODO_DIA, 4, datetime(2026, 10, 22, 3, 20), FOLGA) == noite  # na folga, depois de fechar
    assert noite_do_lanche(TODO_DIA, 4, datetime(2026, 10, 22, 15, 0), FOLGA) is None


def test_os_dias_da_janela_valem():
    # 21/10/2026 é uma quarta (3): a madrugada de quinta é da quarta; a noite de quinta não está no horário
    quarta = [Janela(dias=[3], hora_ini="19:00", hora_fim="03:00")]
    assert noite_do_lanche(quarta, 4, datetime(2026, 10, 22, 1, 30), FOLGA).chave == "ao-vivo-canal-04-2026-10-21"
    assert noite_do_lanche(quarta, 4, datetime(2026, 10, 22, 21, 0), FOLGA) is None


def test_duas_aberturas_no_dia_levam_a_hora_na_chave():
    almoco_e_jantar = [Janela(dias=[], hora_ini="11:00", hora_fim="15:00"), Janela(dias=[], hora_ini="19:00", hora_fim="23:00")]
    assert noite_do_lanche(almoco_e_jantar, 7, datetime(2026, 10, 21, 12, 0), FOLGA).chave == "ao-vivo-canal-07-2026-10-21"
    assert noite_do_lanche(almoco_e_jantar, 7, datetime(2026, 10, 21, 20, 0), FOLGA).chave == "ao-vivo-canal-07-2026-10-21-19h00"


def test_a_janela_de_mais_de_14_horas_se_divide():
    dia_inteiro = [Janela(dias=[], hora_ini="00:00", hora_fim="23:59")]
    a = noite_do_lanche(dia_inteiro, 4, datetime(2026, 10, 21, 10, 0), FOLGA)
    b = noite_do_lanche(dia_inteiro, 4, datetime(2026, 10, 21, 20, 0), FOLGA)
    assert a == Noite("ao-vivo-canal-04-2026-10-21", datetime(2026, 10, 21, 0, 0), datetime(2026, 10, 21, 14, 0))
    assert b == Noite("ao-vivo-canal-04-2026-10-21-2", datetime(2026, 10, 21, 14, 0), datetime(2026, 10, 22, 0, 30))


# ───────────────────────────── a amostra ─────────────────────────────


def _lanches(n: int, com_duvida: dict[int, int]) -> list[LancheLido]:
    return [LancheLido(Path(f"passos-{i:02d}"), datetime(2026, 10, 21, 19, 0) + timedelta(minutes=10 * i),
                       com_duvida.get(i, 0), "r") for i in range(n)]


def test_a_amostra_comeca_pelas_duvidas_e_espalha_o_resto():
    lanches = _lanches(30, {3: 2, 17: 2, 5: 1, 9: 1, 25: 1})
    vinte = amostra(lanches, 20)
    assert len(vinte) == 20 and {3, 5, 9, 17, 25} <= {int(l.pasta.name[-2:]) for l in vinte}
    assert vinte == sorted(vinte, key=lambda l: l.inicio) and amostra(list(reversed(lanches)), 20) == vinte
    # sem vaga para todas as dúvidas: as maiores antes, e no empate a mais cedo
    assert [int(l.pasta.name[-2:]) for l in amostra(lanches, 3)] == [3, 5, 17]
    # as vagas que sobram, espalhadas pela noite (os 25 sem dúvida, de 5 em 5)
    sem = [l for l in lanches if not l.duvidas]
    assert [l for l in amostra(lanches, 10) if not l.duvidas] == [sem[2], sem[7], sem[12], sem[17], sem[22]]
    assert amostra(lanches, 0) == [] and len(amostra(lanches, 100)) == 30


def test_a_duvida_e_a_regra_da_nuvem():
    assert duvidas([{"tipo": "vazio"}, {"tipo": "passo", "nota": 0.54}, {"tipo": "provisorio", "nota": 0.5},
                    {"tipo": "passo", "nota": 0.55}, {"tipo": "passo"}, {"tipo": "saiu", "nota": 0.2},
                    {"tipo": "comeco", "nota": 0.3}]) == 3


def test_por_noite():
    assert por_noite(None) == 20 and por_noite("") == 20 and por_noite("abc") == 20
    assert por_noite(" 7 ") == 7 and por_noite("0") == 0 and por_noite("-3") == 0 and por_noite("500") == 200


# ───────────────────────────── o corpo ─────────────────────────────


def test_o_pao_so_pelas_3_pecas_com_um_pao_de_dois_cortes():
    paes = ["Pão brioche", "Pão de dois cortes"]
    assert pao_pelas_pecas(3, paes) == "Pão de dois cortes"
    assert pao_pelas_pecas(3, ["Pão australiano 2 cortes"]) == "Pão australiano 2 cortes"
    assert pao_pelas_pecas(2, paes) is None
    assert pao_pelas_pecas(3, ["Pão brioche"]) is None
    assert pao_pelas_pecas(3, ["Pão de dois cortes", "Pão australiano dois cortes"]) is None
    assert pao_pelas_pecas(3, ["Molho dois cortes"]) is None  # não é pão


def _etapas_do_contrato() -> tuple[set[str], set[str]]:
    exemplo = CONTRATO["porPassos"]["corpo"]["lanche"]["etapas"]
    return set().union(*(e.keys() for e in exemplo)), set(CONTRATO["porPassos"]["tipos"])


def test_o_corpo_do_lanche_cabe_no_contrato(tmp_path: Path):
    t = datetime(2026, 10, 21, 21, 0, 0)
    contorno = [[[10, 10], [700, 20], [400, 470]], [[0, 0], [1, 1]]]
    passos = [
        passo(t + timedelta(seconds=40), 1, "passo", nome="Blend da casa", nota=0.66, parte=0.24, contorno=contorno),
        passo(t + timedelta(seconds=5), 1, "comeco", nome="Pão brioche", nota=0.6, parte=1.0),
        passo(t + timedelta(seconds=6), 2, "comeco", nome="Queijo cheddar", nota=0.42, parte=1.0),
        passo(t + timedelta(seconds=7), 3, "comeco", nome="Pão brioche", nota=0.6, parte=1.0),
        passo(t + timedelta(seconds=70), 2, "vazio", nome="Alface", nota=0.45, parte=0.2),
        passo(t + timedelta(seconds=80), 1, "transitorio", parte=0.4),
        passo(t + timedelta(seconds=90), 2, "saiu", nome="Alface", nota=0.26, parte=0.84),
        passo(t + timedelta(seconds=99), 1, "fechou", parte=0.8, recorte=False),
        passo(t + timedelta(seconds=95), 2, "outra-coisa"),
        passo(t + timedelta(seconds=96), 9, "passo", nome="Bacon", nota=0.7),
    ]
    pasta = lanche(tmp_path, t, 1, passos, metades=3)
    leitura = json.loads((pasta / "passos.json").read_text(encoding="utf-8"))
    corpo = corpo_do_lanche(NOITE, PONTO, pasta, leitura, ["Pão brioche", "Pão de dois cortes"])

    g, l = corpo["gravacao"], corpo["lanche"]
    assert g["chave"] == "ao-vivo-canal-04-2026-10-21" and g["origem"] == "ao-vivo" and g["pontoId"] == PONTO
    assert datetime.fromisoformat(g["inicio"]).tzinfo is not None and datetime.fromisoformat(g["fim"]).tzinfo is not None
    assert l["chave"] == pasta.name and l["pecas"] == 3
    etapas = l["etapas"]
    assert [e["tipo"] for e in etapas] == ["comeco", "comeco", "comeco", "passo", "vazio", "transitorio", "saiu", "fechou"]
    assert [datetime.fromisoformat(e["hora"]) for e in etapas] == sorted(datetime.fromisoformat(e["hora"]) for e in etapas)
    # o pão: o de dois cortes, pelas 3 peças — nunca o nome que o juiz deu ao começo
    for e in etapas[:3]:
        assert (e["lado"], e["inicio"], e["leu"], e["candidatos"]) == ("pao", True, "Pão de dois cortes", ["Pão de dois cortes"])
        assert e["quadro"] is not None
    p, vazio = etapas[3], etapas[4]
    assert (p["lado"], p["inicio"], p["leu"], p["candidatos"], p["nota"], p["parte"]) == (
        "outro", False, "Blend da casa", ["Blend da casa"], 0.66, 0.24)
    assert (vazio["leu"], vazio["candidatos"], vazio["nota"]) == ("Alface", [], 0.45) and vazio["quadro"] is not None
    for e in etapas[5:]:
        assert e["quadro"] is None and e["leu"] is None and e["candidatos"] == []
    # o recorte que sobe: 360 px no lado maior (720 x 480 → 360 x 240), e o contorno na mesma escala
    assert len(corpo["quadros"]) == 5
    img = cv2.imdecode(np.frombuffer(base64.b64decode(corpo["quadros"][p["quadro"]]["imagemBase64"]), np.uint8), cv2.IMREAD_COLOR)
    assert img.shape[:2] == (240, 360)
    assert p["contorno"] == [[[5, 5], [350, 10], [200, 235]]]

    chaves, tipos = _etapas_do_contrato()
    limites = CONTRATO["limites"]
    assert all(set(e) <= chaves for e in etapas) and {e["tipo"] for e in etapas} <= tipos
    assert g["origem"] in CONTRATO["origens"] and set(g) == set(CONTRATO["porPassos"]["corpo"]["gravacao"])
    assert set(l) == set(CONTRATO["porPassos"]["corpo"]["lanche"])
    assert len(etapas) <= limites["etapas"] and len(corpo["quadros"]) <= limites["quadros"]
    assert limites["pecas"][0] <= l["pecas"] <= limites["pecas"][1]
    for q in corpo["quadros"]:
        assert len(base64.b64decode(q["imagemBase64"])) <= limites["bytesDoQuadro"]
    for e in etapas:
        assert 1 <= e["metade"] <= limites["pecas"][1] and limites["vezes"][0] <= e["vezes"] <= limites["vezes"][1]
        for pedaco in e.get("contorno", []):
            assert limites["contorno"]["pontosPorPedaco"][0] <= len(pedaco) <= limites["contorno"]["pontosPorPedaco"][1]
            assert all(0 <= c <= limites["contorno"]["coordenadaMaxima"] for ponto in pedaco for c in ponto)


def test_sem_as_3_pecas_o_pao_vai_sem_leitura(tmp_path: Path):
    pasta = simples(tmp_path, datetime(2026, 10, 21, 21, 0), 1)
    leitura = json.loads((pasta / "passos.json").read_text(encoding="utf-8"))
    corpo = corpo_do_lanche(NOITE, None, pasta, leitura, ["Pão de dois cortes"])
    comecos = [e for e in corpo["lanche"]["etapas"] if e["tipo"] == "comeco"]
    assert len(comecos) == 2 and all(e["leu"] is None and e["candidatos"] == [] for e in comecos)
    assert corpo["lanche"]["pecas"] == 2 and corpo["gravacao"]["pontoId"] is None


def test_o_contorno_grande_cabe_no_contrato(tmp_path: Path):
    t = datetime(2026, 10, 21, 21, 0)
    circulo = [[int(360 + 300 * np.cos(a)), int(240 + 200 * np.sin(a))] for a in np.linspace(0, 6.28, 200)]
    pedacos = [circulo] + [[[i, 0], [i + 5, 5], [i, 10]] for i in range(0, 100, 10)]
    pasta = lanche(tmp_path, t, 1, [passo(t, 1, "passo", nome="Bacon", nota=0.7, contorno=pedacos)])
    leitura = json.loads((pasta / "passos.json").read_text(encoding="utf-8"))
    e = corpo_do_lanche(NOITE, None, pasta, leitura, [])["lanche"]["etapas"][0]
    assert len(e["contorno"]) == 8 and len(e["contorno"][0]) == 64
    assert all(0 <= x < 360 and 0 <= y < 240 for pedaco in e["contorno"] for x, y in pedaco)


def test_sem_etapa_valida_nao_ha_corpo(tmp_path: Path):
    t = datetime(2026, 10, 21, 21, 0)
    pasta = lanche(tmp_path, t, 1, [passo(t, 9, "passo", nome="Bacon", nota=0.7)])
    leitura = json.loads((pasta / "passos.json").read_text(encoding="utf-8"))
    assert corpo_do_lanche(NOITE, None, pasta, leitura, []) is None


# ───────────────────────────── a linha ─────────────────────────────


class NuvemDeMentira:
    def __init__(self) -> None:
        self.corpos: list[dict] = []
        self.falhas: list[ErroDaNuvem] = []

    def lanche_de_treino(self, corpo: dict) -> dict:
        if self.falhas:
            raise self.falhas.pop(0)
        self.corpos.append(corpo)
        return {"lancheId": "x", "novo": True}


class Relogio:
    def __init__(self, quando: datetime) -> None:
        self.quando = quando

    def __call__(self) -> datetime:
        return self.quando


def montar(tmp_path: Path, *, config: dict = CONFIG, por_noite: int = 2):
    caminho = tmp_path / "config.json"
    caminho.write_text(json.dumps(config), encoding="utf-8")
    base = tmp_path / "base-da-loja"
    base.mkdir()
    (base / "base.json").write_text(json.dumps({"impressao": "i", "itens": [
        {"nome": "Pão de dois cortes", "visivel": True, "quadros": []}]}), encoding="utf-8")
    nuvem, relogio = NuvemDeMentira(), Relogio(datetime(2026, 10, 22, 4, 0))
    return nuvem, relogio, ConferenciaEmFundo(nuvem, caminho, [4], por_noite=por_noite, relogio=relogio)


def test_a_noite_sobe_com_a_loja_fechada_e_nao_sobe_de_novo(tmp_path: Path):
    nuvem, relogio, c = montar(tmp_path)
    a = simples(tmp_path, datetime(2026, 10, 21, 20, 0), 1)
    b = simples(tmp_path, datetime(2026, 10, 21, 22, 0), 2, duvida=True)
    madrugada = simples(tmp_path, datetime(2026, 10, 22, 0, 30), 3)

    relogio.quando = datetime(2026, 10, 22, 2, 0)  # aberta
    assert c.volta() is None and nuvem.corpos == []
    relogio.quando = datetime(2026, 10, 22, 3, 20)  # fechada, mas a leitura da noite ainda não terminou (a folga)
    assert c.volta().subiram == 0 and nuvem.corpos == []

    relogio.quando = datetime(2026, 10, 22, 4, 0)
    v = c.volta()
    assert v.subiram == 2 and v.parou is None
    # a amostra de 2: o lanche com dúvida e, dos outros dois, o do meio da conta (a madrugada é da mesma noite)
    assert [x["lanche"]["chave"] for x in nuvem.corpos] == [b.name, madrugada.name] and not (a / ENVIADO).exists()
    assert all(x["gravacao"]["chave"] == "ao-vivo-canal-04-2026-10-21" and x["gravacao"]["pontoId"] == PONTO for x in nuvem.corpos)
    marca = json.loads((b / ENVIADO).read_text(encoding="utf-8"))
    assert marca["destino"] == "enviado" and marca["gravacao"] == "ao-vivo-canal-04-2026-10-21"

    assert c.volta().subiram == 0 and len(nuvem.corpos) == 2

    # a leitura refeita sobe de novo (a nuvem troca a leitura do lanche)
    leitura = json.loads((b / "passos.json").read_text(encoding="utf-8"))
    leitura["passos"][-1]["nota"] = 0.44
    (b / "passos.json").write_text(json.dumps(leitura), encoding="utf-8")
    assert c.volta().subiram == 1 and nuvem.corpos[-1]["lanche"]["chave"] == b.name


def test_sem_horario_nao_sobe_e_diz_uma_vez(tmp_path: Path, caplog: pytest.LogCaptureFixture):
    nuvem, _, c = montar(tmp_path, config={"loja": {}, "pontos": []})
    simples(tmp_path, datetime(2026, 10, 21, 20, 0), 1)
    with caplog.at_level(logging.INFO, logger="farol_agent.passos_na_nuvem"):
        assert c.volta() is None and c.volta() is None
    assert nuvem.corpos == [] and sum("horário" in r.getMessage() for r in caplog.records) == 1


def test_por_noite_zero_nao_manda(tmp_path: Path):
    nuvem, _, c = montar(tmp_path, por_noite=0)
    simples(tmp_path, datetime(2026, 10, 21, 20, 0), 1)
    assert c.volta() is None and nuvem.corpos == []


def test_409_para_a_noite(tmp_path: Path):
    nuvem, _, c = montar(tmp_path)
    simples(tmp_path, datetime(2026, 10, 21, 20, 0), 1)
    simples(tmp_path, datetime(2026, 10, 21, 21, 0), 2)
    nuvem.falhas = [ErroDaNuvem("409 em /v1/agentes/treino/lanches", recuperavel=False, status=409)]
    v = c.volta()
    assert v.encerradas == 1 and v.subiram == 0 and nuvem.corpos == []
    assert json.loads((tmp_path / "bancada" / "canal-04" / ENCERRADAS).read_text(encoding="utf-8")) == ["ao-vivo-canal-04-2026-10-21"]
    assert c.volta().subiram == 0 and nuvem.corpos == []


def test_422_nao_repete(tmp_path: Path):
    nuvem, _, c = montar(tmp_path, por_noite=1)
    a = simples(tmp_path, datetime(2026, 10, 21, 20, 0), 1)
    nuvem.falhas = [ErroDaNuvem("422 em /v1/agentes/treino/lanches: etapas[0].lado", recuperavel=False, status=422)]
    assert c.volta().recusados == 1
    marca = json.loads((a / ENVIADO).read_text(encoding="utf-8"))
    assert marca["destino"] == "recusado" and "etapas[0].lado" in marca["motivo"]
    assert c.volta().recusados == 0 and nuvem.corpos == []


def test_rede_para_a_volta_e_repete_na_seguinte(tmp_path: Path, caplog: pytest.LogCaptureFixture):
    nuvem, _, c = montar(tmp_path)
    a = simples(tmp_path, datetime(2026, 10, 21, 20, 0), 1)
    simples(tmp_path, datetime(2026, 10, 21, 21, 0), 2)
    falha = ErroDaNuvem("rede: tempo esgotado")
    nuvem.falhas = [falha, falha]
    with caplog.at_level(logging.INFO, logger="farol_agent.passos_na_nuvem"):
        assert c.volta().parou == "rede: tempo esgotado"
        assert c.volta().parou == "rede: tempo esgotado"
    assert nuvem.corpos == [] and not (a / ENVIADO).exists()
    assert sum("não subiram agora" in r.getMessage() for r in caplog.records) == 1
    assert c.volta().subiram == 2


def test_so_o_lanche_lido_com_o_juiz_sobe(tmp_path: Path):
    nuvem, _, c = montar(tmp_path, por_noite=5)
    t = datetime(2026, 10, 21, 20, 0)
    sem_juiz = lanche(tmp_path, t, 1, [passo(t, 1, "comeco", parte=1.0), passo(t + timedelta(seconds=30), 1, "passo")],
                      juiz=False)
    com_juiz = simples(tmp_path, t + timedelta(minutes=5), 2)
    assert c.volta().subiram == 1 and [x["lanche"]["chave"] for x in nuvem.corpos] == [com_juiz.name]
    assert not (sem_juiz / ENVIADO).exists()


def test_o_lanche_sem_etapa_nao_sobe_e_fica_marcado(tmp_path: Path):
    nuvem, _, c = montar(tmp_path, por_noite=5)
    t = datetime(2026, 10, 21, 20, 0)
    torto = lanche(tmp_path, t, 1, [passo(t, 9, "passo", nome="Bacon", nota=0.7)])
    assert c.volta().subiram == 0 and nuvem.corpos == []
    assert json.loads((torto / ENVIADO).read_text(encoding="utf-8"))["destino"] == "recusado"
