"""Os recortes da noite sobem para MARCAR (A24 F3, parte 3) — `recortes_na_nuvem` e a volta da conferência.

Com uma nuvem de mentira, pastas de lanche montadas como a bancada ao vivo grava e o contrato
`contratos/recorte-para-marcar.json`. O que se protege:

- a amostra: dúvida até 40%, começo até 10%, o resto um pouco de cada nome (um de cada vez); o que sobra numa parte vai
  para as outras; espalhado pela noite, na ordem da hora, sempre a mesma; 0 não escolhe;
- o recorte: as chaves do contrato; o vazio vai sem palpite; a imagem reduzida e o contorno na escala dela;
- a volta: só com a noite terminada e a loja fechada; só a noite mais nova na primeira vez (as de antes, o dono já
  marcou na página local); fora os lanches da conferência; até 25 por envio; o que subiu não sobe de novo; rede para
  e retoma do que falta; 422 não repete; 409 para a noite (os lanches dela também); a imagem que sumiu não sobe; 0
  desliga;
- a base que muda refaz o juiz com a loja fechada; o defeito no juiz não derruba a descida.
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
from farol_agent.base_da_loja import BaseEmFundo
from farol_agent.nuvem import ErroDaNuvem
from farol_agent.passos_na_nuvem import ENCERRADAS, NOTA_DE_DUVIDA, RECORTES_ESTADO, ConferenciaEmFundo, _contorno
from farol_agent.recortes_na_nuvem import (
    MAX_POR_NOITE, POR_ENVIO, POR_NOITE, Candidato, amostra, candidatos_do_lanche, motivo, por_noite, recorte,
)

CONTRATO = json.loads((Path(__file__).resolve().parents[2] / "contratos" / "recorte-para-marcar.json").read_text(encoding="utf-8"))
PONTO = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b"
CONFIG = {
    "loja": {"horarioFuncionamento": [{"dias": [1, 2, 3, 4, 5, 6, 7], "hora_ini": "19:00", "hora_fim": "03:00"}]},
    "pontos": [{"id": PONTO, "canal": 4}],
}
NOMES = ["Blend da casa", "Queijo prato", "Alface", "Bacon fatiado"]


def iso(t: datetime) -> str:
    return t.astimezone().isoformat(timespec="seconds")


def jpg(caminho: Path, largura: int = 720, altura: int = 480) -> None:
    img = np.zeros((altura, largura, 3), np.uint8)
    img[:, :, 1] = np.linspace(0, 255, largura, dtype=np.uint8)[None, :]
    assert imagens.escrever(caminho, img, [cv2.IMWRITE_JPEG_QUALITY, 90])


def passo(t: datetime, metade: int, tipo: str, *, nome=None, nota=None, contorno=None) -> dict:
    p = {"hora": iso(t), "metade": metade, "tipo": tipo, "parte": 0.3, "papel": 0.1,
         "recorte": f"{t:%Hh%Mm%S}-m{metade}-{tipo}.jpg", "contorno": contorno or []}
    if nota is not None:
        p.update(nome=nome, nota=nota)
    return p


def lanche(raiz: Path, inicio: datetime, n: int, *, duvida: bool = False) -> Path:
    """Um lanche de duas peças: os 2 começos, 4 passos (os 4 nomes) e, com `duvida`, um vazio — 6 ou 7 recortes."""
    pasta = raiz / "bancada" / "canal-04" / f"{inicio:%Y-%m-%d}" / f"passos-{inicio:%Hh%Mm%S}-{n}"
    pasta.mkdir(parents=True)
    passos = [passo(inicio + timedelta(seconds=2), 1, "comeco", nome="Pão brioche", nota=0.6),
              passo(inicio + timedelta(seconds=3), 2, "comeco", nome="Pão brioche", nota=0.6)]
    passos += [passo(inicio + timedelta(seconds=20 + 10 * k), 1 + k % 2, "passo", nome=nome, nota=0.7,
                     contorno=[[[100, 100], [400, 120], [380, 360], [120, 340]]]) for k, nome in enumerate(NOMES)]
    if duvida:
        passos.append(passo(inicio + timedelta(seconds=80), 2, "vazio", nome="Alface", nota=0.45))
    for p in passos:
        jpg(pasta / p["recorte"])
    leitura = {"lugar": n, "inicio": iso(inicio), "fim": iso(inicio + timedelta(seconds=90)), "juiz": True,
               "metades": [{"k": 1}, {"k": 2}], "passos": passos}
    (pasta / "passos.json").write_text(json.dumps(leitura, ensure_ascii=False), encoding="utf-8")
    return pasta


def cand(i: int, tipo: str = "passo", nome: str | None = "Carne", nota: float | None = 0.7) -> Candidato:
    return Candidato(Path(f"passos-{i:03d}"), f"r{i}.jpg", datetime(2026, 10, 21, 19, 0) + timedelta(minutes=i), 1, tipo,
                     nome, nota, None)


# ───────────────────────────── a amostra ─────────────────────────────


def test_por_noite_pelo_ambiente():
    assert por_noite(None) == POR_NOITE == 100 and por_noite("  ") == POR_NOITE
    assert por_noite("0") == 0 and por_noite("40") == 40 and por_noite("9999") == MAX_POR_NOITE
    assert por_noite("muitos") == POR_NOITE


def test_o_motivo_de_cada_passo():
    assert motivo(cand(1, "comeco", nota=0.2), NOTA_DE_DUVIDA) == "comeco"
    assert motivo(cand(1, "vazio", nota=0.9), NOTA_DE_DUVIDA) == "duvida"
    assert motivo(cand(1, "provisorio", nota=0.5), NOTA_DE_DUVIDA) == "duvida"
    assert motivo(cand(1, "passo", nota=0.6), NOTA_DE_DUVIDA) == "cobertura"
    assert motivo(cand(1, "passo", nota=None), NOTA_DE_DUVIDA) == "cobertura"


def test_duvida_comeco_e_um_pouco_de_cada_nome():
    lista, i = [], 0
    for tipo, nome, nota, n in [("passo", "x", 0.4, 30), ("comeco", None, None, 20), ("passo", "Carne", 0.7, 60),
                                ("passo", "Queijo", 0.7, 20), ("passo", "Alface", 0.7, 10), ("passo", "Bacon", 0.7, 5),
                                ("passo", "Ovo", 0.7, 5)]:
        for _ in range(n):
            lista.append(cand(i, tipo, nome, nota))
            i += 1
    escolha = amostra(lista, 100, NOTA_DE_DUVIDA)
    partes = [p for _, p in escolha]
    assert len(escolha) == 100 and partes.count("duvida") == 30 and partes.count("comeco") == 10
    # as 30 de dúvida não bastam para 40: a vaga vai para a cobertura (60), um nome de cada vez
    por_nome = {}
    for c, p in escolha:
        if p == "cobertura":
            por_nome[c.nome] = por_nome.get(c.nome, 0) + 1
    assert por_nome == {"Carne": 20, "Queijo": 20, "Alface": 10, "Bacon": 5, "Ovo": 5}
    assert [c.hora for c, _ in escolha] == sorted(c.hora for c, _ in escolha), "na ordem da hora"
    assert escolha == amostra(list(reversed(lista)), 100, NOTA_DE_DUVIDA), "sempre a mesma escolha"
    # as 60 carnes vão das 19:50 às 20:49: as 20 escolhidas cobrem a faixa inteira
    carnes = [c.hora for c, p in escolha if c.nome == "Carne"]
    assert carnes[0] <= datetime(2026, 10, 21, 19, 52) and carnes[-1] >= datetime(2026, 10, 21, 20, 47), "espalhado pela noite"
    assert amostra(lista, 0, NOTA_DE_DUVIDA) == [] and amostra([], 100, NOTA_DE_DUVIDA) == []


def test_a_duvida_para_em_40_e_o_comeco_em_10_quando_ha_de_tudo():
    lista = [cand(i, "passo", "x", 0.3) for i in range(80)] + [cand(100 + i, "comeco", None, None) for i in range(30)] \
        + [cand(200 + i, "passo", f"N{i % 4}", 0.8) for i in range(100)]
    partes = [p for _, p in amostra(lista, 100, NOTA_DE_DUVIDA)]
    assert (partes.count("duvida"), partes.count("comeco"), partes.count("cobertura")) == (40, 10, 50)


def test_o_que_sobra_vai_para_a_duvida_e_depois_para_o_comeco():
    lista = [cand(i, "passo", "x", 0.3) for i in range(60)] + [cand(100 + i, "comeco", None, None) for i in range(20)] \
        + [cand(200 + i, "passo", "Carne", 0.8) for i in range(5)]
    partes = [p for _, p in amostra(lista, 100, NOTA_DE_DUVIDA)]
    assert partes.count("cobertura") == 5 and partes.count("duvida") == 60 and partes.count("comeco") == 20


# ───────────────────────────── o recorte ─────────────────────────────


def test_o_recorte_segue_o_contrato(tmp_path: Path):
    pasta = lanche(tmp_path, datetime(2026, 10, 21, 21, 0), 1, duvida=True)
    cands = candidatos_do_lanche(pasta, json.loads((pasta / "passos.json").read_text(encoding="utf-8")), _local_de_teste)
    assert [c.tipo for c in cands] == ["comeco", "comeco", "passo", "passo", "passo", "passo", "vazio"]
    exemplo = CONTRATO["corpo"]["recortes"][0]
    passo_ = recorte(next(c for c in cands if c.tipo == "passo"), "cobertura", _contorno)
    assert set(passo_) == set(exemplo)
    assert passo_["chave"] == f"{pasta.name}/{cands[2].arquivo}" and passo_["lanche"] == pasta.name
    assert passo_["palpite"] == "Blend da casa" and passo_["nota"] == 0.7 and passo_["motivo"] in CONTRATO["motivos"]
    bruto = base64.b64decode(passo_["imagemBase64"])
    img = cv2.imdecode(np.frombuffer(bruto, np.uint8), cv2.IMREAD_COLOR)
    assert max(img.shape[:2]) <= 360
    assert passo_["contorno"] and all(0 <= x < img.shape[1] and 0 <= y < img.shape[0] for x, y in passo_["contorno"][0])
    vazio = recorte(cands[-1], "duvida", _contorno)
    assert vazio["palpite"] is None and vazio["nota"] is None, "o que o juiz tirou não é o palpite"
    comeco = recorte(cands[0], "comeco", _contorno)
    assert comeco["palpite"] is None and comeco["peca"] == 1
    limites = CONTRATO["limites"]
    assert len(passo_["chave"]) <= limites["chave"] and len(bruto) <= limites["bytesDoRecorte"]


def _local_de_teste(texto):
    return datetime.fromisoformat(texto).astimezone().replace(tzinfo=None) if isinstance(texto, str) else None


# ───────────────────────────── a volta ─────────────────────────────


class NuvemDeMentira:
    def __init__(self) -> None:
        self.lanches: list[dict] = []
        self.envios: list[dict] = []
        self.falhas: list[ErroDaNuvem] = []
        self.falhas_do_lanche: list[ErroDaNuvem] = []

    def lanche_de_treino(self, corpo: dict) -> dict:
        if self.falhas_do_lanche:
            raise self.falhas_do_lanche.pop(0)
        self.lanches.append(corpo)
        return {"lancheId": "x", "novo": True}

    def recortes_para_marcar(self, corpo: dict) -> dict:
        if self.falhas:
            raise self.falhas.pop(0)
        self.envios.append(corpo)
        return {"gravacaoId": "g", "recortes": []}

    @property
    def recortes(self) -> list[dict]:
        return [r for e in self.envios for r in e["recortes"]]


class Relogio:
    def __init__(self, quando: datetime) -> None:
        self.quando = quando

    def __call__(self) -> datetime:
        return self.quando


def montar(tmp_path: Path, *, marcar: int = 30, por_noite_conf: int = 1):
    tmp_path.mkdir(parents=True, exist_ok=True)
    caminho = tmp_path / "config.json"
    caminho.write_text(json.dumps(CONFIG), encoding="utf-8")
    base = tmp_path / "base-da-loja"
    base.mkdir()
    (base / "base.json").write_text(json.dumps({"impressao": "i", "itens": []}), encoding="utf-8")
    nuvem, relogio = NuvemDeMentira(), Relogio(datetime(2026, 10, 22, 4, 0))
    c = ConferenciaEmFundo(nuvem, caminho, [4], por_noite=por_noite_conf, relogio=relogio, marcar_por_noite=marcar)
    return nuvem, relogio, c


def noite_com_lanches(tmp_path: Path, dia: datetime, n: int = 6) -> list[Path]:
    """`n` lanches de 6 recortes na noite que começa em `dia` (o primeiro com dúvida: 7 recortes). O número do lanche
    leva o dia, como na loja (o contador não volta a 1 de uma noite para a outra)."""
    return [lanche(tmp_path, dia + timedelta(hours=1, minutes=20 * k), 100 * dia.day + k + 1, duvida=(k == 0))
            for k in range(n)]


def test_a_noite_mais_nova_sobe_em_envios_de_25_fora_da_conferencia(tmp_path: Path):
    nuvem, relogio, c = montar(tmp_path)
    velha = noite_com_lanches(tmp_path, datetime(2026, 10, 20, 19, 0))
    nova = noite_com_lanches(tmp_path, datetime(2026, 10, 21, 19, 0))

    relogio.quando = datetime(2026, 10, 22, 2, 0)  # aberta: nada
    assert c.volta() is None and nuvem.envios == []
    relogio.quando = datetime(2026, 10, 22, 4, 0)
    v = c.volta()
    assert v.parou is None and v.recortes == 30
    assert [len(e["recortes"]) for e in nuvem.envios] == [25, 5]
    assert all(e["gravacao"]["chave"] == "ao-vivo-canal-04-2026-10-21" and e["gravacao"]["pontoId"] == PONTO
               and e["gravacao"]["origem"] == "ao-vivo" for e in nuvem.envios)
    # fora o lanche que foi para a conferência (o com dúvida: o primeiro); e nada da noite de antes
    conferido = {x["lanche"]["chave"] for x in nuvem.lanches if x["gravacao"]["chave"] == "ao-vivo-canal-04-2026-10-21"}
    assert conferido == {nova[0].name}
    lanches_dos_recortes = {r["lanche"] for r in nuvem.recortes}
    assert lanches_dos_recortes <= {p.name for p in nova[1:]} and not lanches_dos_recortes & {p.name for p in velha}
    assert len({r["chave"] for r in nuvem.recortes}) == 30
    # os lanches da noite de antes ainda vão para a conferência, como antes
    assert any(x["gravacao"]["chave"] == "ao-vivo-canal-04-2026-10-20" for x in nuvem.lanches)
    estado = json.loads((tmp_path / "bancada" / "canal-04" / RECORTES_ESTADO).read_text(encoding="utf-8"))
    assert set(estado["noites"]) == {"ao-vivo-canal-04-2026-10-21"} and len(estado["noites"]["ao-vivo-canal-04-2026-10-21"]["feitos"]) == 30

    assert c.volta().recortes == 0 and len(nuvem.envios) == 2, "o que subiu não sobe de novo"
    # a noite seguinte, já com o arquivo: sobe também
    noite_com_lanches(tmp_path, datetime(2026, 10, 22, 19, 0), 3)
    relogio.quando = datetime(2026, 10, 23, 4, 0)
    assert c.volta().recortes > 0 and nuvem.envios[-1]["gravacao"]["chave"] == "ao-vivo-canal-04-2026-10-22"


def test_rede_para_e_a_volta_seguinte_manda_so_o_que_falta(tmp_path: Path, caplog: pytest.LogCaptureFixture):
    nuvem, _, c = montar(tmp_path)
    noite_com_lanches(tmp_path, datetime(2026, 10, 21, 19, 0))
    nuvem.falhas = [ErroDaNuvem("503 em /v1/agentes/treino/recortes", status=503)]
    with caplog.at_level(logging.INFO, logger="farol_agent.passos_na_nuvem"):
        v = c.volta()
    assert v.parou and v.recortes == 0 and nuvem.envios == []
    v = c.volta()
    assert v.recortes == 30 and [len(e["recortes"]) for e in nuvem.envios] == [25, 5]
    # agora a falha no segundo envio: o primeiro fica feito, e a volta seguinte manda só os 5
    nuvem2, relogio2, c2 = montar(tmp_path / "b")
    noite_com_lanches(tmp_path / "b", datetime(2026, 10, 21, 19, 0))
    nuvem2.falhas = []
    original = nuvem2.recortes_para_marcar
    chamadas = {"n": 0}

    def segundo_falha(corpo):
        chamadas["n"] += 1
        if chamadas["n"] == 2:
            raise ErroDaNuvem("rede: tempo esgotado")
        return original(corpo)

    nuvem2.recortes_para_marcar = segundo_falha
    v = c2.volta()
    assert v.parou == "rede: tempo esgotado" and v.recortes == 25
    v = c2.volta()
    assert v.recortes == 5 and len(nuvem2.recortes) == 30 and len({r["chave"] for r in nuvem2.recortes}) == 30


def test_422_nao_repete_e_409_para_a_noite(tmp_path: Path):
    nuvem, _, c = montar(tmp_path, marcar=10)
    noite_com_lanches(tmp_path, datetime(2026, 10, 21, 19, 0))
    nuvem.falhas = [ErroDaNuvem("422 em /v1/agentes/treino/recortes: recortes[0].motivo", status=422)]
    v = c.volta()
    assert v.recortes == 0 and nuvem.envios == []
    estado = json.loads((tmp_path / "bancada" / "canal-04" / RECORTES_ESTADO).read_text(encoding="utf-8"))
    assert len(estado["noites"]["ao-vivo-canal-04-2026-10-21"]["recusados"]) == 10
    assert c.volta().recortes == 0 and nuvem.envios == [], "o recusado não sobe de novo"

    nuvem3, _, c3 = montar(tmp_path / "c", marcar=10)
    noite_com_lanches(tmp_path / "c", datetime(2026, 10, 21, 19, 0))
    nuvem3.falhas = [ErroDaNuvem("409 em /v1/agentes/treino/recortes", recuperavel=False, status=409)]
    v = c3.volta()
    assert v.encerradas == 1 and nuvem3.envios == []
    assert json.loads((tmp_path / "c" / "bancada" / "canal-04" / ENCERRADAS).read_text(encoding="utf-8")) == ["ao-vivo-canal-04-2026-10-21"]
    antes = len(nuvem3.lanches)
    assert c3.volta().recortes == 0 and len(nuvem3.lanches) == antes and nuvem3.envios == []


def test_a_noite_que_a_conferencia_achou_encerrada_nao_manda_recortes(tmp_path: Path):
    nuvem, _, c = montar(tmp_path, marcar=10)
    noite_com_lanches(tmp_path, datetime(2026, 10, 21, 19, 0))
    nuvem.falhas_do_lanche = [ErroDaNuvem("409 em /v1/agentes/treino/lanches", recuperavel=False, status=409)]
    v = c.volta()
    assert v.encerradas == 1 and nuvem.envios == [] and v.recortes == 0, "a mesma volta não manda os recortes dela"


def test_a_imagem_que_sumiu_nao_sobe(tmp_path: Path):
    nuvem, _, c = montar(tmp_path, marcar=10)
    pastas = noite_com_lanches(tmp_path, datetime(2026, 10, 21, 19, 0))
    nuvem.falhas = [ErroDaNuvem("rede: caiu")]
    assert c.volta().parou  # escolheu e parou antes de mandar
    estado = json.loads((tmp_path / "bancada" / "canal-04" / RECORTES_ESTADO).read_text(encoding="utf-8"))
    escolhido = estado["noites"]["ao-vivo-canal-04-2026-10-21"]["escolhidos"][0]
    (tmp_path / "bancada" / "canal-04" / escolhido["pasta"] / escolhido["arquivo"]).unlink()
    v = c.volta()
    assert v.recortes == 9 and len(nuvem.recortes) == 9
    estado = json.loads((tmp_path / "bancada" / "canal-04" / RECORTES_ESTADO).read_text(encoding="utf-8"))
    assert estado["noites"]["ao-vivo-canal-04-2026-10-21"]["recusados"] == [f"{Path(escolhido['pasta']).name}/{escolhido['arquivo']}"]
    assert pastas


def test_zero_desliga_os_recortes(tmp_path: Path):
    nuvem, _, c = montar(tmp_path, marcar=0)
    noite_com_lanches(tmp_path, datetime(2026, 10, 21, 19, 0))
    v = c.volta()
    assert v.recortes == 0 and nuvem.envios == [] and len(nuvem.lanches) == 1
    assert not (tmp_path / "bancada" / "canal-04" / RECORTES_ESTADO).exists()


# ───────────────────────────── a base muda: o juiz se refaz com a loja fechada ─────────────────────────────


class NuvemDaBase:
    def __init__(self) -> None:
        self.impressao = "imp-1"

    def base_da_loja(self):
        return {"impressao": self.impressao, "itens": []}

    def quadro_da_base(self, quadro_id: str) -> bytes:
        raise AssertionError("sem quadros")


def test_a_base_que_muda_refaz_o_juiz_e_o_defeito_nao_derruba(tmp_path: Path, caplog: pytest.LogCaptureFixture):
    caminho = tmp_path / "configuracao.json"
    caminho.write_text(json.dumps(CONFIG), encoding="utf-8")
    chamadas = []
    nuvem, agora = NuvemDaBase(), {"s": 0.0}
    fundo = BaseEmFundo(nuvem, caminho, relogio=lambda: datetime(2026, 10, 22, 9, 0), agora=lambda: agora["s"],
                        a_cada_s=10.0, depois_de_mudar=lambda: chamadas.append(1))
    assert fundo.volta() is not None and chamadas == [1], "a primeira descida muda a base"
    agora["s"] += 11
    assert fundo.volta() is not None and chamadas == [1], "a mesma base não refaz o juiz"
    nuvem.impressao = "imp-2"
    agora["s"] += 11
    assert fundo.volta() is not None and chamadas == [1, 1]

    def quebra():
        raise RuntimeError("modelo fora")

    fundo.depois_de_mudar = quebra
    nuvem.impressao = "imp-3"
    agora["s"] += 11
    with caplog.at_level(logging.ERROR, logger="farol_agent.base_da_loja"):
        assert fundo.volta() is not None
    assert any("o juiz não se refez agora" in r.getMessage() for r in caplog.records)
    # com a loja aberta, nada desce (e o juiz não é chamado)
    aberta = BaseEmFundo(nuvem, caminho, relogio=lambda: datetime(2026, 10, 22, 21, 0), depois_de_mudar=lambda: chamadas.append(9))
    assert aberta.volta() is None and 9 not in chamadas
    # o agente que sobe de novo (a troca de pacote) com a base já no disco: a primeira descida não muda nada, e o juiz
    # se monta mesmo assim — uma vez
    subiu = []
    de_novo = BaseEmFundo(nuvem, caminho, relogio=lambda: datetime(2026, 10, 22, 9, 0), agora=lambda: agora["s"],
                          a_cada_s=10.0, depois_de_mudar=lambda: subiu.append(1))
    d = de_novo.volta()
    assert d is not None and not d.mudou and subiu == [1]
    agora["s"] += 11
    assert de_novo.volta() is not None and subiu == [1]
