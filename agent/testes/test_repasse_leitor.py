"""O leitor do expediente guardado (R1 do repasse): a hora de cada quadro e as paradas da bancada.

Os vídeos aqui são sintéticos — um tampo parado e uma "mão" (um retângulo claro) que mexe dentro do quadro, e às
vezes fora dele —, gravados em AVI com o nome dos pedaços da cópia (`AAAA-MM-DD_HH-MM-SS.dav`). O que se confere:
a hora sai do nome do arquivo e da contagem dos quadros, as paradas são as da quietude do agente (importada, e não
copiada), o que mexe fora do quadro não conta, e um pedaço que não abre não derruba os outros.
"""

from __future__ import annotations

import csv
import json
from datetime import datetime, timedelta
from pathlib import Path

import cv2
import numpy as np
import pytest

from farol_agent import quietude as quietude_do_agente
from farol_agent.pipeline import recorte
from ferramentas.repasse import leitor

from .test_configuracao import resposta

FPS = 13
LARGURA, ALTURA = 320, 240
# O quadro da configuração de teste: x de 15% a 85%, y de 47% a 80% da imagem.
QUADRO = [[0.15, 0.47], [0.85, 0.47], [0.85, 0.8], [0.15, 0.8]]
COMECO = datetime(2026, 10, 12, 19, 30, 0)


def config(numero=1, papel="montagem", poligono=QUADRO, canal=4):
    c = resposta(versao=7)
    c["pontos"][0]["canal"] = canal
    z = c["pontos"][0]["zonas"][0]
    z["numero"] = numero
    z["papel"] = papel
    z["poligono"] = poligono
    return c


def fundo() -> np.ndarray:
    img = np.full((ALTURA, LARGURA, 3), 60, np.uint8)
    for x in range(0, LARGURA, 40):  # um tampo com desenho, que não muda
        cv2.line(img, (x, 0), (x, ALTURA - 1), (90, 90, 90), 2)
    return img


def gravar(arquivo: Path, segundos: float, mexe: list[tuple[float, float]], *, fora=False) -> int:
    """Grava `segundos` de vídeo; a mão anda nos intervalos de `mexe` e fica parada no resto. Devolve os quadros."""
    arquivo.parent.mkdir(parents=True, exist_ok=True)
    provisorio = arquivo.with_suffix(".avi")
    w = cv2.VideoWriter(str(provisorio), cv2.VideoWriter_fourcc(*"MJPG"), FPS, (LARGURA, ALTURA))
    assert w.isOpened()
    total = int(round(segundos * FPS))
    x = 60
    y = 20 if fora else 130  # fora: na faixa de cima, que não é do quadro
    for i in range(total):
        t = i / FPS
        if any(a <= t < b for a, b in mexe):
            x = 60 + int(((t * 140) % 160))
        img = fundo()
        cv2.rectangle(img, (x, y), (x + 50, y + 35), (235, 235, 235), -1)
        w.write(img)
    w.release()
    provisorio.replace(arquivo)
    return total


def pedaco_em(pasta: Path, comeco: datetime, canal=4) -> Path:
    return pasta / f"canal-{canal:02d}" / f"{comeco:%Y-%m-%d_%H-%M-%S}.dav"


def repassar(pasta, saida, **k):
    linhas = []
    k.setdefault("taxa_provisoria", FPS)
    r = leitor.repassar(pasta, 4, saida, config(), duracao_s=20.0, dizer=linhas.append, **k)
    return r, linhas


def paradas_do_csv(saida: Path) -> list[dict]:
    with (saida / "paradas.csv").open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


# ───────────────────────────── os pedaços e a hora ─────────────────────────────


def test_so_os_pedacos_inteiros_entram_e_na_ordem(tmp_path):
    canal = tmp_path / "canal-04"
    canal.mkdir()
    for nome in ("2026-10-12_19-35-00.dav", "2026-10-12_19-30-00.dav", "2026-10-12_19-30-00_20s.dav",
                 "2026-10-12_19-40-00.parte", "LEIA.txt", "2026-10-12_19-45-00.mp4"):
        (canal / nome).write_bytes(b"x")

    achados = leitor.pedacos(tmp_path, 4)

    assert [p.arquivo.name for p in achados] == ["2026-10-12_19-30-00.dav", "2026-10-12_19-35-00.dav"]
    assert achados[0].comeco == datetime(2026, 10, 12, 19, 30, 0)
    assert leitor.pedacos(tmp_path, 13) == []


def test_a_ordem_nao_depende_de_como_o_disco_lista(tmp_path, monkeypatch):
    canal = tmp_path / "canal-04"
    canal.mkdir()
    for nome in ("2026-10-12_19-30-00.dav", "2026-10-12_19-35-00.dav", "2026-10-12_19-40-00.dav"):
        (canal / nome).write_bytes(b"x")
    original = Path.glob
    monkeypatch.setattr(Path, "glob", lambda self, padrao: reversed(list(original(self, padrao))))

    assert [p.comeco.minute for p in leitor.pedacos(tmp_path, 4)] == [30, 35, 40]


def test_a_hora_do_quadro_sai_do_nome_e_da_contagem():
    assert leitor.instante(COMECO, 0, 3851) == COMECO
    assert leitor.instante(COMECO, 3851, 3851) == COMECO + timedelta(minutes=5)
    meio = leitor.instante(COMECO, 1925, 3850)
    assert abs((meio - COMECO).total_seconds() - 150.0) < 1e-6
    with pytest.raises(ValueError):
        leitor.instante(COMECO, 0, 0)


def test_um_pedaco_emenda_no_seguinte_a_um_quadro_de_distancia(tmp_path):
    """A prova da hora: o último quadro de um pedaço e o primeiro do seguinte ficam a um quadro um do outro."""
    gravar(pedaco_em(tmp_path, COMECO), 20, [])
    gravar(pedaco_em(tmp_path, COMECO + timedelta(seconds=20)), 20, [])

    # O relógio provisório da leitura é outro: a taxa que sai é a medida, e não ele.
    r, _ = repassar(tmp_path, tmp_path / "saida", taxa_provisoria=12.0)

    lidos = r["pedacos"]
    assert [p["quadros"] for p in lidos] == [260, 260]
    assert lidos[0]["taxa"] == 13.0
    assert lidos[1]["emendaS"] == pytest.approx(20 / 260, abs=1e-3)
    assert r["total"]["emendas"] == [lidos[1]["emendaS"]]


def test_os_dois_relogios_concordam_quando_a_taxa_e_constante():
    amostras = [(i, i * 1000 / 13) for i in range(0, 260, 6)]
    r = leitor.comparar_relogios(amostras, 260, 20.0)
    assert r == {"recuos": 0, "desvioMaxS": 0.0, "fimPeloDeDentroS": round(258 * 1000 / 13 / 1000, 3)}


def test_o_recuo_do_relogio_de_dentro_e_contado_e_consertado():
    # Volta um terço de segundo no meio (medido em 13/10/2026): conta, e não puxa a hora para trás.
    amostras = [(0, 0.0), (13, 1000.0), (26, 2000.0), (39, 2666.0), (52, 4000.0)]
    r = leitor.comparar_relogios(amostras, 65, 5.0)
    assert r["recuos"] == 0
    amostras[3] = (39, 1666.0)
    r = leitor.comparar_relogios(amostras, 65, 5.0)
    assert r["recuos"] == 1
    assert r["desvioMaxS"] == 1.0  # no quadro 39 vale o maior já visto (2,000 s) contra 3,000 s da contagem
    assert r["fimPeloDeDentroS"] == 4.0


def test_a_taxa_que_muda_dentro_do_pedaco_aparece_como_desvio():
    # Metade do pedaço a 15 quadros por s, metade a 10: a contagem supõe 12,5 do começo ao fim.
    amostras = [(i, i * 1000 / 15) for i in range(0, 150, 5)] + [(150 + i, 10000 + i * 100) for i in range(0, 100, 5)]
    r = leitor.comparar_relogios(amostras, 250, 20.0)
    assert r["recuos"] == 0
    assert 1.5 <= r["desvioMaxS"] <= 2.1, r
    # Ao contrário (devagar primeiro): agora o relógio de dentro vai À FRENTE da contagem — o desvio é o mesmo.
    amostras = [(i, i * 100) for i in range(0, 100, 5)] + [(100 + i, 10000 + i * 1000 / 15) for i in range(0, 150, 5)]
    r = leitor.comparar_relogios(amostras, 250, 20.0)
    assert 1.5 <= r["desvioMaxS"] <= 2.1, r


def test_o_total_leva_o_maior_desvio_dos_pedacos(tmp_path, monkeypatch):
    gravar(pedaco_em(tmp_path, COMECO), 20, [])
    gravar(pedaco_em(tmp_path, COMECO + timedelta(seconds=20)), 20, [])
    desvios = iter([1.234, 0.5])
    monkeypatch.setattr(leitor, "comparar_relogios", lambda *a, **k: {"recuos": 0, "desvioMaxS": next(desvios), "fimPeloDeDentroS": 19.9})

    r, _ = repassar(tmp_path, tmp_path / "saida")

    assert r["total"]["desvioMaxS"] == 1.234


def test_o_pedaco_sai_com_a_comparacao_dos_relogios(tmp_path):
    gravar(pedaco_em(tmp_path, COMECO), 20, [])

    r, linhas = repassar(tmp_path, tmp_path / "saida")

    rel = r["pedacos"][0]["relogios"]
    assert rel["recuos"] == 0
    assert rel["desvioMaxS"] <= 0.1
    assert 19.0 <= rel["fimPeloDeDentroS"] <= 20.0
    assert r["total"]["desvioMaxS"] == rel["desvioMaxS"]
    assert "a contagem difere em até 0.0 s" in linhas[0]


def com_relogio_de_dentro(monkeypatch, relogio_ms):
    """A captura de verdade, com o relógio de dentro trocado pelo do teste (`relogio_ms(quadro) -> ms`)."""
    real = cv2.VideoCapture

    class Captura:
        def __init__(self, caminho, api):
            self._c = real(caminho, api)
            self._i = -1

        def isOpened(self):
            return self._c.isOpened()

        def read(self):
            ok, img = self._c.read()
            if ok:
                self._i += 1
            return ok, img

        def get(self, prop):
            return float(relogio_ms(self._i)) if prop == cv2.CAP_PROP_POS_MSEC else self._c.get(prop)

        def release(self):
            self._c.release()

    monkeypatch.setattr(leitor.cv2, "VideoCapture", Captura)


def segundos_das_paradas(saida: Path) -> list[float]:
    return [(datetime.fromisoformat(p["no_gravador"]) - COMECO).total_seconds() for p in paradas_do_csv(saida)]


def test_a_hora_vem_do_relogio_de_dentro_quando_a_taxa_muda_no_meio_do_pedaco(tmp_path, monkeypatch):
    """Medido na bancada em 14/10/2026: a taxa muda dentro do pedaço, e a contagem chegou a errar 29,6 s."""
    # Os primeiros 130 quadros a 10 por s (13 s), os 130 seguintes em 7 s: a contagem diria 13 por s o tempo todo.
    com_relogio_de_dentro(monkeypatch, lambda i: i * 100.0 if i < 130 else 13000.0 + (i - 130) * 7000.0 / 129)
    gravar(pedaco_em(tmp_path, COMECO), 20, [(2, 6)])  # a mão para no quadro 78

    r, linhas = repassar(tmp_path, tmp_path / "saida")

    pedaco = r["pedacos"][0]
    assert pedaco["hora_pela"] == "relógio de dentro"
    # Pelo relógio de dentro a mão parou aos 7,8 s, e a parada sai perto dos 9,5 s; pela contagem seria perto de 7,3.
    [s] = segundos_das_paradas(tmp_path / "saida")
    assert 8.5 <= s <= 10.5, s
    assert pedaco["relogios"]["desvioMaxS"] >= 2.0
    assert pedaco["ultimo"] == COMECO + timedelta(seconds=20)
    assert "hora pelo relógio de dentro" in linhas[0]


def test_o_relogio_de_dentro_parado_no_zero_e_a_hora_sai_da_contagem(tmp_path, monkeypatch):
    com_relogio_de_dentro(monkeypatch, lambda i: 0.0)
    gravar(pedaco_em(tmp_path, COMECO), 20, [(2, 6)])

    r, _ = repassar(tmp_path, tmp_path / "saida")

    assert r["pedacos"][0]["hora_pela"] == "contagem"
    assert r["total"]["horaPelaContagem"] == 1
    [s] = segundos_das_paradas(tmp_path / "saida")
    assert 6.5 <= s <= 8.5, s


def test_o_relogio_de_dentro_que_termina_longe_do_tamanho_do_pedaco_e_dado_como_estragado(tmp_path, monkeypatch):
    # Anda, mas o dobro do que devia: termina em 40 s num pedaço de 20.
    com_relogio_de_dentro(monkeypatch, lambda i: i * 2000.0 / 13)
    gravar(pedaco_em(tmp_path, COMECO), 20, [(2, 6)])

    r, _ = repassar(tmp_path, tmp_path / "saida")

    assert r["pedacos"][0]["hora_pela"] == "contagem"
    [s] = segundos_das_paradas(tmp_path / "saida")
    assert s < 10.0, "a hora da parada tem de sair da contagem, e não do relógio estragado"


def test_o_relogio_de_dentro_que_comeca_fora_do_zero_conta_do_primeiro_quadro(tmp_path, monkeypatch):
    com_relogio_de_dentro(monkeypatch, lambda i: 5000.0 + i * 1000.0 / 13)
    gravar(pedaco_em(tmp_path, COMECO), 20, [(2, 6)])

    r, _ = repassar(tmp_path, tmp_path / "saida")

    assert r["pedacos"][0]["hora_pela"] == "relógio de dentro"
    [s] = segundos_das_paradas(tmp_path / "saida")
    assert 6.5 <= s <= 8.5, s


def test_o_recuo_do_relogio_de_dentro_nao_puxa_a_hora_para_tras(tmp_path, monkeypatch):
    # No último quadro o relógio volta um terço de segundo; o de dentro consertado não volta: o pedaço termina
    # na hora do quadro anterior, e não 0,33 s antes.
    com_relogio_de_dentro(monkeypatch, lambda i: i * 1000.0 / 13 - (334.0 if i == 259 else 0.0))
    gravar(pedaco_em(tmp_path, COMECO), 20, [])

    r, _ = repassar(tmp_path, tmp_path / "saida")

    ultimo = (r["pedacos"][0]["ultimo"] - COMECO).total_seconds()
    assert ultimo == pytest.approx(258 / 13, abs=0.002)


def test_depois_de_um_salto_do_relogio_as_amostras_nao_saem_uma_atras_da_outra(tmp_path, monkeypatch):
    """Quadros que o gravador não guardou: o relógio salta 1,5 s. A próxima amostra é meio segundo depois, como ao vivo."""
    com_relogio_de_dentro(monkeypatch, lambda i: i * 1000.0 / 13 + (1500.0 if i >= 100 else 0.0))
    vistos = []
    original = quietude_do_agente.Quietude.amostrar

    def espiar(self, fontes):
        vistos.extend(f.quadro_do_fluxo_menor().ts for f in fontes.values())
        return original(self, fontes)

    monkeypatch.setattr(quietude_do_agente.Quietude, "amostrar", espiar)
    gravar(pedaco_em(tmp_path, COMECO), 20, [])

    repassar(tmp_path, tmp_path / "saida")

    passos = [(b - a).total_seconds() for a, b in zip(vistos, vistos[1:])]
    assert min(passos) >= 0.45, passos
    assert max(passos) >= 1.5, "o salto aparece como um intervalo grande, uma vez"


# ───────────────────────────── as paradas ─────────────────────────────


def test_a_bancada_que_mexe_e_para_da_uma_parada_por_vez_que_parou(tmp_path):
    gravar(pedaco_em(tmp_path, COMECO), 20, [(2, 6), (12, 15)])

    r, linhas = repassar(tmp_path, tmp_path / "saida")
    paradas = paradas_do_csv(tmp_path / "saida")

    assert r["total"]["paradas"] == 2
    segundos = [(datetime.fromisoformat(p["no_gravador"]) - COMECO).total_seconds() for p in paradas]
    # A quietude do agente: três amostras paradas, de meio em meio segundo, depois de a mão parar.
    assert 6.5 <= segundos[0] <= 8.5, segundos
    assert 15.5 <= segundos[1] <= 17.5, segundos
    assert float(paradas[0]["mexeu_por_s"]) >= 3.0
    assert "paradas 2" in linhas[0]
    # A mão anda 7 dos 20 s: a parte das amostras "mexendo" fica perto disso.
    assert 0.2 <= r["total"]["mexendo"] / r["total"]["amostras"] <= 0.6


def test_a_hora_na_loja_desconta_o_adianto_do_gravador(tmp_path):
    gravar(pedaco_em(tmp_path, COMECO), 20, [(2, 6)])

    repassar(tmp_path, tmp_path / "saida", adianto_s=21.0)
    p = paradas_do_csv(tmp_path / "saida")[0]

    gravador = datetime.fromisoformat(p["no_gravador"])
    loja = datetime.fromisoformat(p["na_loja"])
    assert (gravador - loja).total_seconds() == pytest.approx(21.0, abs=1e-3)


def test_o_que_mexe_fora_do_quadro_nao_conta(tmp_path):
    gravar(pedaco_em(tmp_path, COMECO), 20, [(2, 6), (12, 15)], fora=True)

    r, _ = repassar(tmp_path, tmp_path / "saida")

    assert r["total"]["paradas"] == 0
    assert r["total"]["mexendo"] == 0


def test_a_bancada_parada_nao_da_parada(tmp_path):
    """Parada é "parou DEPOIS de mexer": o quadro quieto o tempo todo não vira candidato a olhar."""
    gravar(pedaco_em(tmp_path, COMECO), 20, [])

    r, _ = repassar(tmp_path, tmp_path / "saida")

    assert r["total"]["paradas"] == 0
    assert r["total"]["amostras"] >= 39


def test_o_recorte_da_parada_e_o_quadro_no_tamanho_da_camera_com_o_de_fora_apagado(tmp_path):
    triangulo = [[0.15, 0.47], [0.85, 0.47], [0.15, 0.8]]
    gravar(pedaco_em(tmp_path, COMECO), 20, [(2, 6)])

    leitor.repassar(tmp_path, 4, tmp_path / "saida", config(poligono=triangulo), duracao_s=20.0, taxa_provisoria=FPS, dizer=lambda s: None)
    p = paradas_do_csv(tmp_path / "saida")[0]
    img = cv2.imdecode(np.fromfile(str(tmp_path / "saida" / "recortes" / p["recorte"]), np.uint8), cv2.IMREAD_COLOR)

    x1, y1, x2, y2 = int(0.15 * LARGURA), int(0.47 * ALTURA), int(0.85 * LARGURA), int(0.8 * ALTURA)
    assert img.shape[:2] == (y2 - y1, x2 - x1), "no tamanho da câmera, e não no do fluxo menor"
    # O canto de baixo à direita é de fora do triângulo: apagado com a cor do agente (o JPEG mexe um pouco).
    assert np.abs(img[-3, -3].astype(int) - np.array(recorte.COR_DE_FORA)).max() <= 6


def test_a_quietude_e_a_do_agente_importada_e_nao_copiada():
    assert leitor.Quietude is quietude_do_agente.Quietude
    assert leitor.PASSO == quietude_do_agente.PASSO


def test_a_quietude_mede_no_tamanho_do_fluxo_menor_e_de_meio_em_meio_segundo(tmp_path, monkeypatch):
    """Ao vivo ela lê o fluxo menor (704×480); a gravação é do principal, e é reduzida antes, como ao vivo."""
    vistos = []
    original = quietude_do_agente.Quietude.amostrar

    def espiar(self, fontes):
        for f in fontes.values():
            q = f.quadro_do_fluxo_menor()
            vistos.append((q.largura, q.altura, q.ts, q.stream))
            assert self._relogio() == q.ts, "o relógio da quietude é o da gravação, e anda com ela"
        return original(self, fontes)

    monkeypatch.setattr(quietude_do_agente.Quietude, "amostrar", espiar)
    gravar(pedaco_em(tmp_path, COMECO), 20, [])

    repassar(tmp_path, tmp_path / "saida")

    assert {(l, a, s) for l, a, _, s in vistos} == {(704, 480, "sub")}
    passos = {round((b[2] - a[2]).total_seconds(), 3) for a, b in zip(vistos, vistos[1:])}
    assert passos <= {0.462, 0.538, 0.5}, passos  # 0,5 s, no passo dos quadros (1/13 s)
    assert len(vistos) == 40


# ───────────────────────────── o que dá errado ─────────────────────────────


def test_o_pedaco_que_nao_abre_e_anotado_e_os_outros_seguem(tmp_path):
    ruim = pedaco_em(tmp_path, COMECO)
    ruim.parent.mkdir(parents=True)
    ruim.write_bytes(b"isto nao e video")
    gravar(pedaco_em(tmp_path, COMECO + timedelta(seconds=20)), 20, [(2, 6)])

    r, _ = repassar(tmp_path, tmp_path / "saida")

    assert r["pedacos"][0]["erro"] in ("não abriu", "sem quadro")
    assert r["pedacos"][1]["erro"] == ""
    assert r["total"]["lidos"] == 1
    assert r["total"]["paradas"] == 1
    assert "emendaS" not in r["pedacos"][1], "não há emenda com um pedaço que não foi lido"


def test_o_buraco_entre_pedacos_zera_a_memoria(tmp_path):
    """Depois de um pedaço que faltou, a primeira amostra não tem com o que comparar — como ao vivo, depois de o fluxo parar."""
    gravar(pedaco_em(tmp_path, COMECO), 20, [(15, 20)])  # termina mexendo
    gravar(pedaco_em(tmp_path, COMECO + timedelta(seconds=60)), 20, [])  # 40 s depois, tudo parado

    r, _ = repassar(tmp_path, tmp_path / "saida")

    assert r["total"]["paradas"] == 0, "parada inventada por cima de um buraco na gravação"


def test_sem_buraco_a_parada_que_atravessa_os_pedacos_aparece(tmp_path):
    gravar(pedaco_em(tmp_path, COMECO), 20, [(15, 20)])
    gravar(pedaco_em(tmp_path, COMECO + timedelta(seconds=20)), 20, [])

    r, _ = repassar(tmp_path, tmp_path / "saida")

    assert r["total"]["paradas"] == 1
    p = paradas_do_csv(tmp_path / "saida")[0]
    assert p["pedaco"] == "2026-10-12_19-30-20.dav"


# ───────────────────────────── a janela e o quadro ─────────────────────────────


@pytest.mark.parametrize(
    ("comeco", "de", "ate", "entra"),
    [
        (datetime(2026, 10, 12, 19, 50), "19:50", "20:05", True),
        (datetime(2026, 10, 12, 19, 45), "19:50", "20:05", False),
        (datetime(2026, 10, 12, 19, 46), "19:50", "20:05", True),  # termina dentro
        (datetime(2026, 10, 12, 20, 5), "19:50", "20:05", False),
        (datetime(2026, 10, 12, 23, 55), "23:50", "00:10", True),  # passa da meia-noite: a mesma noite
        (datetime(2026, 10, 13, 0, 5), "23:50", "00:10", True),
        (datetime(2026, 10, 13, 0, 10), "23:50", "00:10", False),
        (datetime(2026, 10, 12, 21, 0), None, None, True),
    ],
)
def test_a_janela_pedida(comeco, de, ate, entra):
    p = leitor.Pedaco(Path("x.dav"), comeco)
    assert leitor.na_janela(p, leitor._hora(de), leitor._hora(ate)) is entra


def test_o_quadro_de_montagem_e_o_escolhido_e_o_numero_manda_quando_dado():
    c = config(numero=2, papel="montagem")
    c["pontos"][0]["zonas"].insert(0, {**c["pontos"][0]["zonas"][0], "id": "z0", "numero": 1, "papel": "livre", "regras": []})

    assert leitor.quadro_do_canal(c, 4)[1].id == "z1"
    assert leitor.quadro_do_canal(c, 4, numero=1)[1].id == "z0"
    with pytest.raises(ValueError, match="não tem o quadro 9"):
        leitor.quadro_do_canal(c, 4, numero=9)
    with pytest.raises(ValueError, match="canal 7"):
        leitor.quadro_do_canal(c, 7)


def test_sem_quadro_de_montagem_vale_o_primeiro():
    c = config(numero=3, papel="livre")
    assert leitor.quadro_do_canal(c, 4)[1].id == "z1"


def test_canal_sem_quadro_desenhado_e_recusado():
    c = config()
    del c["pontos"][0]["zonas"][0]["numero"]
    with pytest.raises(ValueError, match="não tem quadro desenhado"):
        leitor.quadro_do_canal(c, 4)


def test_pela_linha_de_comando(tmp_path, capsys):
    gravar(pedaco_em(tmp_path, COMECO), 300, [(2, 6)])
    arquivo = tmp_path / "configuracao.json"
    arquivo.write_text(json.dumps(config()), encoding="utf-8")

    codigo = leitor.main([str(tmp_path), "4", str(tmp_path / "saida"), "--configuracao", str(arquivo), "--de", "19:30", "--ate", "19:35"])

    saida = capsys.readouterr().out
    assert codigo == 0
    assert "FIM: 1 de 1 pedaços · 1 paradas" in saida
    assert (tmp_path / "saida" / "paradas.csv").is_file()


def test_o_resumo_e_gravado_com_o_quadro_e_o_adianto(tmp_path):
    gravar(pedaco_em(tmp_path, COMECO), 20, [(2, 6)])

    repassar(tmp_path, tmp_path / "saida", adianto_s=21.0)
    resumo = json.loads((tmp_path / "saida" / "resumo.json").read_text(encoding="utf-8"))

    assert resumo["canal"] == 4
    assert resumo["quadro"] == {"numero": 1, "nome": "área da montagem", "papel": "montagem"}
    assert resumo["adiantoDoGravadorS"] == 21.0
    assert resumo["total"]["paradas"] == 1
