"""A gravação de treino vira um quadro por segundo da bancada (A21, fatia T3c-1).

Os vídeos são os sintéticos dos testes do leitor do repasse (um tampo parado e uma "mão" clara), gravados em AVI
com o nome dos pedaços (`AAAA-MM-DD_HH-MM-SS.dav`). O que se protege aqui:

- um recorte por segundo da área de montagem, com a hora do gravador e a da loja (menos o adianto);
- o relógio de dentro quando ele vale; a contagem quando ele não anda ou termina longe do tamanho do pedaço;
- depois de um salto do relógio, a amostra seguinte é um passo depois — não uma atrás da outra;
- a retomada: o pedaço lido não é lido de novo; o que não abre fica anotado e não se repete;
- o `paradas.csv` no formato que a leitura da bancada lê, refeito de uma vez;
- e que ela consome o que a busca (T3b) trouxe, pelo manifesto.
"""

from __future__ import annotations

import csv
import json
from datetime import datetime, timedelta
from pathlib import Path

import cv2
import numpy as np
import pytest

from farol_agent import gravacao_lida
from farol_agent import treino_quadros as tq
from farol_agent import treino_trecho as tt

from .test_repasse_leitor import ALTURA, FPS, LARGURA, config, gravar, pedaco_em

DE = datetime(2026, 10, 15, 19, 30, 24)
ADIANTO = 25.0


def zona():
    return gravacao_lida.quadro_do_canal(config(), 4)[1]


def csv_de(saida: Path) -> list[dict]:
    with (saida / tq.PARADAS).open(encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def imagem(i: int = 0) -> np.ndarray:
    return np.full((ALTURA, LARGURA, 3), 40 + i % 200, np.uint8)


class LeitorDeMentira:
    """Entrega quadros com os segundos que o teste manda, e conta os pedaços lidos."""

    def __init__(self, segundos_por_pedaco: dict[str, list[tuple[float, bool]]]):
        self.por_pedaco = segundos_por_pedaco
        self.lidos: list[str] = []

    def __call__(self, arquivo: Path):
        self.lidos.append(arquivo.name)
        for i, (s, do_relogio) in enumerate(self.por_pedaco.get(arquivo.name, [])):
            yield i, s, do_relogio, imagem(i)


def pedaco(tmp_path: Path, comeco: datetime, segundos: float = 40.0) -> tuple[Path, datetime, datetime]:
    arquivo = pedaco_em(tmp_path, comeco)
    arquivo.parent.mkdir(parents=True, exist_ok=True)
    arquivo.write_bytes(b"x")
    return arquivo, comeco, comeco + timedelta(seconds=segundos)


# ───────────────────────────── com vídeo de verdade ─────────────────────────────


def test_um_recorte_por_segundo_com_a_hora_do_gravador_e_a_da_loja(tmp_path):
    a = pedaco_em(tmp_path, DE)
    b = pedaco_em(tmp_path, DE + timedelta(seconds=6))
    gravar(a, 6.0, [])
    gravar(b, 6.0, [(1.0, 3.0)])
    pedacos = [(a, DE, DE + timedelta(seconds=6)), (b, DE + timedelta(seconds=6), DE + timedelta(seconds=12))]
    saida = tmp_path / "densa"

    d = tq.densa_da_gravacao(pedacos, zona(), saida, adianto_s=ADIANTO)

    assert d.completa and (d.pedacos, d.lidos, d.erros) == (2, 2, 0)
    linhas = csv_de(saida)
    assert list(linhas[0]) == tq.CABECALHO
    assert len(linhas) == d.quadros == 12, "um por segundo, seis segundos cada pedaço"
    horas = [datetime.strptime(l["no_gravador"], "%Y-%m-%d %H:%M:%S.%f") for l in linhas]
    assert horas == sorted(horas)
    assert horas[0] == DE and horas[6] == DE + timedelta(seconds=6)
    for i in range(1, 6):
        assert abs((horas[i] - horas[i - 1]).total_seconds() - 1.0) < 1 / FPS + 1e-6, "um por segundo, pelo relógio de dentro"
    loja = [datetime.strptime(l["na_loja"], "%Y-%m-%d %H:%M:%S.%f") for l in linhas]
    assert all(g - l == timedelta(seconds=ADIANTO) for g, l in zip(horas, loja))
    anotado = json.loads((saida / tq.DENSA).read_text(encoding="utf-8"))
    assert {p["hora_pela"] for p in anotado["pedacos"].values()} == {"relógio de dentro"}
    recorte = cv2.imdecode(np.fromfile(str(saida / tq.RECORTES / linhas[0]["recorte"]), np.uint8), cv2.IMREAD_COLOR)
    assert recorte is not None and recorte.shape[0] < ALTURA, "o recorte é o da área de montagem, não o quadro inteiro"
    assert all((saida / tq.RECORTES / l["recorte"]).is_file() for l in linhas)
    assert [l["na_loja"][11:19] for l in tq.linhas_da_densa(saida)][:2] == ["19:29:59", "19:30:00"], "a hora como a bancada lê"


def test_consome_o_que_a_busca_trouxe_pelo_manifesto(tmp_path):
    pasta = tmp_path / "console-1"
    a = pedaco_em(pasta, DE)
    gravar(a, 4.0, [])
    (pasta / tt.MANIFESTO).write_text(json.dumps({"formato": tt.FORMATO_DO_MANIFESTO, "pedacos": {
        a.name: {"situacao": "ok", "tamanho": 1, "de": DE.isoformat(), "ate": (DE + timedelta(seconds=3)).isoformat(),
                 "cobre_ate": (DE + timedelta(seconds=4)).isoformat()},
        "2026-10-15_19-30-28.dav": {"situacao": "sem_gravacao", "de": "2026-10-15T19:30:28", "ate": "2026-10-15T19:31:08"},
    }}), encoding="utf-8")
    d = tq.densa_da_gravacao(tt.pedacos_baixados(pasta, 4), zona(), pasta / "densa", adianto_s=ADIANTO)
    assert (d.pedacos, d.quadros) == (1, 4)


# ───────────────────────────── a hora ─────────────────────────────


def test_com_o_relogio_de_dentro_parado_a_hora_sai_da_contagem(tmp_path):
    # 26 quadros sem relógio de dentro, num pedaço de 2 s: a contagem provisória (12,9 por s) termina em 1,94 s — perto
    # do tamanho do pedaço, mas não é relógio de dentro: a hora sai da contagem NO PEDAÇO (26 quadros em 2 s).
    a = pedaco(tmp_path, DE, 2.0)
    leitor = LeitorDeMentira({a[0].name: [(i / 12.9, False) for i in range(26)]})
    tq.densa_da_gravacao([a], zona(), tmp_path / "d", adianto_s=0, ler=leitor)
    horas = [datetime.strptime(l["no_gravador"], "%Y-%m-%d %H:%M:%S.%f") for l in csv_de(tmp_path / "d")]
    indices = [int(l["indice"]) for l in csv_de(tmp_path / "d")]
    assert indices == [0, 13]
    assert horas == [gravacao_lida.instante(DE, i, 26, 2.0) for i in indices]
    assert json.loads((tmp_path / "d" / tq.DENSA).read_text(encoding="utf-8"))["pedacos"][a[0].name]["hora_pela"] == "contagem"


def test_o_relogio_de_dentro_que_termina_longe_do_tamanho_do_pedaco_nao_vale(tmp_path):
    a = pedaco(tmp_path, DE, 40.0)
    leitor = LeitorDeMentira({a[0].name: [(float(s), True) for s in range(0, 20)]})  # termina em 19 s num pedaço de 40
    tq.densa_da_gravacao([a], zona(), tmp_path / "d", adianto_s=0, ler=leitor)
    anotado = json.loads((tmp_path / "d" / tq.DENSA).read_text(encoding="utf-8"))["pedacos"][a[0].name]
    assert anotado["hora_pela"] == "contagem"
    assert anotado["linhas"][1][2] == f"{gravacao_lida.instante(DE, 1, 20, 40.0):%Y-%m-%d %H:%M:%S.%f}"[:-3]


def test_depois_de_um_salto_a_amostra_seguinte_e_um_passo_depois(tmp_path):
    a = pedaco(tmp_path, DE, 20.0)
    segundos = [0.0, 0.5, 1.0, 1.5, 9.0, 9.2, 9.6, 10.0, 10.4, 11.0, 19.9]
    leitor = LeitorDeMentira({a[0].name: [(s, True) for s in segundos]})
    tq.densa_da_gravacao([a], zona(), tmp_path / "d", adianto_s=0, ler=leitor)
    amostrados = [segundos[int(l["indice"])] for l in csv_de(tmp_path / "d")]
    assert amostrados == [0.0, 1.0, 9.0, 10.0, 11.0, 19.9]


class CapturaDeMentira:
    """Faz as vezes do `cv2.VideoCapture`: quadros com o relógio de dentro que o teste manda."""

    def __init__(self, milissegundos: list[float] | None):
        self.ms = milissegundos
        self.i = -1

    def isOpened(self):  # noqa: N802
        return self.ms is not None

    def read(self):
        self.i += 1
        if self.ms is None or self.i >= len(self.ms):
            return False, None
        return True, imagem(self.i)

    def get(self, _prop):
        return self.ms[self.i]

    def release(self):
        pass


def test_o_relogio_de_dentro_vale_ate_10_por_cento_do_tamanho_do_pedaco():
    # O medido no leitor do repasse: 300,2 s num pedaço de 300. A folga é de 10%, para os dois lados.
    assert gravacao_lida.relogio_de_dentro_vale(36.0, 40.0) and gravacao_lida.relogio_de_dentro_vale(44.0, 40.0)
    assert not gravacao_lida.relogio_de_dentro_vale(35.9, 40.0)
    assert not gravacao_lida.relogio_de_dentro_vale(44.1, 40.0)


def test_o_relogio_de_dentro_que_recua_e_consertado(monkeypatch):
    monkeypatch.setattr(gravacao_lida.cv2, "VideoCapture", lambda *a: CapturaDeMentira([1000.0, 1077.0, 1154.0, 1120.0, 1231.0]))
    saiu = [(i, round(s, 3), r) for i, s, r, _ in gravacao_lida.quadros_com_hora(Path("x.dav"))]
    assert saiu == [(0, 0.0, False), (1, 0.077, True), (2, 0.154, True), (3, 0.154, True), (4, 0.231, True)]


def test_sem_relogio_de_dentro_vale_a_contagem_e_o_pedaco_que_nao_abre_nao_da_quadro(monkeypatch):
    monkeypatch.setattr(gravacao_lida.cv2, "VideoCapture", lambda *a: CapturaDeMentira([0.0, 0.0, 0.0]))
    saiu = [(i, s, r) for i, s, r, _ in gravacao_lida.quadros_com_hora(Path("x.dav"), taxa_provisoria=10.0)]
    assert saiu == [(0, 0.0, False), (1, 0.1, False), (2, 0.2, False)]
    monkeypatch.setattr(gravacao_lida.cv2, "VideoCapture", lambda *a: CapturaDeMentira(None))
    assert list(gravacao_lida.quadros_com_hora(Path("x.dav"))) == []


def test_os_pedacos_fora_de_ordem_saem_em_ordem_no_csv(tmp_path):
    a, b = pedaco(tmp_path, DE), pedaco(tmp_path, DE + timedelta(seconds=40))
    leitor = LeitorDeMentira({x[0].name: [(float(s), True) for s in range(40)] for x in (a, b)})
    tq.densa_da_gravacao([b, a], zona(), tmp_path / "d", adianto_s=0, ler=leitor)
    horas = [l["no_gravador"] for l in csv_de(tmp_path / "d")]
    assert horas == sorted(horas) and horas[0].startswith("2026-10-15 19:30:24")


# ───────────────────────────── a retomada ─────────────────────────────


def test_retoma_sem_ler_de_novo_o_que_ja_leu(tmp_path):
    a, b = pedaco(tmp_path, DE), pedaco(tmp_path, DE + timedelta(seconds=40))
    leitor = LeitorDeMentira({x[0].name: [(float(s), True) for s in range(40)] for x in (a, b)})
    vezes = iter([True, False])
    andou = []
    d = tq.densa_da_gravacao([a, b], zona(), tmp_path / "d", adianto_s=ADIANTO, ler=leitor,
                             pode_seguir=lambda: next(vezes, False), ao_andar=lambda x: andou.append(x.fracao))
    assert (d.parou, d.lidos, d.quadros) == ("pode_seguir", 1, 40)
    assert andou == [0.5]
    d = tq.densa_da_gravacao([a, b], zona(), tmp_path / "d", adianto_s=ADIANTO, ler=leitor)
    assert d.completa and (d.lidos, d.quadros) == (2, 80)
    assert leitor.lidos == [a[0].name, b[0].name], "cada pedaço, uma vez"
    assert len(csv_de(tmp_path / "d")) == 80
    assert not list((tmp_path / "d").glob("*.novo"))


def test_o_pedaco_que_nao_abre_fica_anotado_e_nao_se_repete(tmp_path):
    a, b = pedaco(tmp_path, DE), pedaco(tmp_path, DE + timedelta(seconds=40))
    leitor = LeitorDeMentira({b[0].name: [(float(s), True) for s in range(40)]})
    d = tq.densa_da_gravacao([a, b], zona(), tmp_path / "d", adianto_s=0, ler=leitor)
    assert d.completa and (d.lidos, d.erros, d.quadros) == (2, 1, 40)
    tq.densa_da_gravacao([a, b], zona(), tmp_path / "d", adianto_s=0, ler=leitor)
    assert leitor.lidos.count(a[0].name) == 1


@pytest.mark.parametrize("mudou", [{"a_cada_s": 2.0}, {"adianto_s": 21.0}])
def test_anotacao_de_outro_passo_ou_outro_adianto_nao_vale(tmp_path, mudou):
    a = pedaco(tmp_path, DE)
    leitor = LeitorDeMentira({a[0].name: [(float(s), True) for s in range(40)]})
    tq.densa_da_gravacao([a], zona(), tmp_path / "d", adianto_s=ADIANTO, ler=leitor)
    opcoes = {"adianto_s": ADIANTO, **mudou}
    tq.densa_da_gravacao([a], zona(), tmp_path / "d", ler=leitor, **opcoes)
    assert leitor.lidos == [a[0].name, a[0].name]


def test_anotacao_torta_vale_como_vazia(tmp_path):
    a = pedaco(tmp_path, DE)
    (tmp_path / "d").mkdir()
    (tmp_path / "d" / tq.DENSA).write_text("{não é json", encoding="utf-8")
    leitor = LeitorDeMentira({a[0].name: [(0.0, True), (1.0, True)]})
    assert tq.densa_da_gravacao([a], zona(), tmp_path / "d", adianto_s=0, ler=leitor).lidos == 1


def test_sem_pedaco_sai_o_csv_vazio_com_o_cabecalho(tmp_path):
    d = tq.densa_da_gravacao([], zona(), tmp_path / "d", adianto_s=0)
    assert d.completa and d.fracao == 1.0
    with (tmp_path / "d" / tq.PARADAS).open(encoding="utf-8", newline="") as f:
        assert next(csv.reader(f)) == tq.CABECALHO
