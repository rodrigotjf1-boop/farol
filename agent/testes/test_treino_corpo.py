"""O corpo do lanche de treino, para a conferência (A21, fatia T3c-4).

O que atravessa a fronteira está em `contratos/lanche-de-treino.json`, lido também por `api/testes/treino.test.ts`.
O que se protege aqui:

- o corpo tem as chaves do contrato, os lados do contrato e os limites do contrato;
- sem identificação, a etapa vai sem leitura: a primeira é o pão aberto, as outras de lado não sabido;
- os quadros sobem reduzidos e dentro do limite; a etapa que passa dos 40 quadros vai sem quadro;
- a etapa sobe no recorte da METADE em que entrou o ingrediente (centrada nela) — e, na dúvida, no recorte inteiro:
  as duas mudaram parecido, mudou pouco, o lanche no lugar novo, o lanche que já tinha saído, a metade que ainda não
  tinha chegado, a caixa pequena que não é metade, sem `metades.csv`; a luz que muda não é ingrediente;
- a hora com o fuso, e a etapa que passou da meia-noite no dia seguinte;
- o envio, com o destino de cada resposta, pela rota do contrato.
"""

from __future__ import annotations

import base64
import json
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np
import pytest

from farol_agent import treino_corpo as tc
from farol_agent.nuvem import ClienteNuvem, ErroDaNuvem
from farol_agent.treino import Gravacao

from .test_treino import _Servidor

CONTRATO = json.loads((Path(__file__).resolve().parents[2] / "contratos" / "lanche-de-treino.json").read_text(encoding="utf-8"))
EXEMPLO = CONTRATO["corpo"]

GRAVACAO = Gravacao(
    id="6f1c2a3b-4d5e-4f60-8a71-b2c3d4e5f607", chave="console-0b1c2d3e", ponto_id=None, canal=4,
    inicio=datetime(2026, 10, 15, 22, 30, tzinfo=timezone.utc), fim=datetime(2026, 10, 15, 23, 0, tzinfo=timezone.utc),
    origem="gravador", situacao="lendo",
)


def pasta_com_recortes(tmp_path: Path, nomes: list[str], lado=(240, 320)) -> Path:
    pasta = tmp_path / "lanche-03"
    pasta.mkdir()
    for i, nome in enumerate(nomes):
        img = np.full((*lado, 3), 60 + (i * 7) % 180, np.uint8)
        cv2.imencode(".jpg", img)[1].tofile(str(pasta / nome))
    return pasta


def resumo(etapas: list[str], inicio="2026-10-15 21:00:00", fim="2026-10-15 21:01:07") -> dict:
    return {"lanche": 3, "inicio": inicio, "fim": fim, "eLanche": True, "etapas": etapas}


# ───────────────────────────── o contrato ─────────────────────────────


def test_o_corpo_tem_as_chaves_os_lados_e_os_limites_do_contrato(tmp_path):
    nomes = ["21h00m00.jpg", "21h00m13.jpg", "21h00m30.jpg"]
    corpo = tc.corpo_do_lanche(GRAVACAO, resumo(nomes), pasta_com_recortes(tmp_path, nomes))
    assert sorted(corpo) == sorted(EXEMPLO)
    assert sorted(corpo["gravacao"]) == sorted(EXEMPLO["gravacao"])
    assert sorted(corpo["lanche"]) == sorted(EXEMPLO["lanche"])
    for e in corpo["lanche"]["etapas"]:
        assert sorted(e) == sorted(EXEMPLO["lanche"]["etapas"][0])
        assert e["lado"] in CONTRATO["lados"]
    assert sorted(corpo["quadros"][0]) == sorted(EXEMPLO["quadros"][0])
    assert corpo["gravacao"]["origem"] in CONTRATO["origens"]
    limites = CONTRATO["limites"]
    assert (tc.MAX_ETAPAS, tc.MAX_QUADROS, tc.MAX_BYTES_DO_QUADRO, tc.MAX_CANDIDATOS, list(tc.VEZES)) == (
        limites["etapas"], limites["quadros"], limites["bytesDoQuadro"], limites["candidatos"], limites["vezes"],
    )
    assert set(tc.LADOS) == set(CONTRATO["lados"])


def test_sem_identificacao_a_etapa_vai_sem_leitura(tmp_path):
    nomes = ["21h00m00.jpg", "21h00m13.jpg", "21h00m30.jpg"]
    corpo = tc.corpo_do_lanche(GRAVACAO, resumo(nomes), pasta_com_recortes(tmp_path, nomes))
    etapas = corpo["lanche"]["etapas"]
    assert [(e["lado"], e["inicio"]) for e in etapas] == [("pao", True), ("outro", False), ("outro", False)]
    assert all(e["leu"] is None and e["candidatos"] == [] and e["vezes"] == 1 for e in etapas)
    assert [e["quadro"] for e in etapas] == [0, 1, 2] and len(corpo["quadros"]) == 3
    assert corpo["lanche"]["chave"] == "lanche-03"
    assert corpo["gravacao"]["chave"] == GRAVACAO.chave and corpo["gravacao"]["inicio"] == "2026-10-15T22:30:00+00:00"


def test_a_hora_vai_com_o_fuso_e_a_etapa_depois_da_meia_noite_e_do_dia_seguinte(tmp_path):
    nomes = ["23h59m50.jpg", "00h00m20.jpg"]
    corpo = tc.corpo_do_lanche(GRAVACAO, resumo(nomes, "2026-10-15 23:59:50", "2026-10-16 00:01:00"), pasta_com_recortes(tmp_path, nomes))
    horas = [datetime.fromisoformat(e["hora"]) for e in corpo["lanche"]["etapas"]]
    assert all(h.tzinfo is not None for h in horas)
    assert horas[1] - horas[0] == datetime(2026, 10, 16, 0, 0, 20) - datetime(2026, 10, 15, 23, 59, 50)
    assert datetime.fromisoformat(corpo["lanche"]["abertoEm"]).tzinfo is not None
    assert corpo["lanche"]["fechouEm"].startswith("2026-10-16T00:01:00")


def test_o_lanche_ainda_aberto_vai_sem_hora_de_fechar(tmp_path):
    nomes = ["21h00m00.jpg"]
    corpo = tc.corpo_do_lanche(GRAVACAO, resumo(nomes, fim=None), pasta_com_recortes(tmp_path, nomes))
    assert corpo["lanche"]["fechouEm"] is None


# ───────────────────────────── os quadros e os limites ─────────────────────────────


def test_o_quadro_sobe_reduzido_e_dentro_do_limite(tmp_path):
    nomes = ["21h00m00.jpg"]
    corpo = tc.corpo_do_lanche(GRAVACAO, resumo(nomes), pasta_com_recortes(tmp_path, nomes, lado=(800, 1000)))
    bruto = base64.b64decode(corpo["quadros"][0]["imagemBase64"])
    img = cv2.imdecode(np.frombuffer(bruto, np.uint8), cv2.IMREAD_COLOR)
    assert max(img.shape[:2]) == tc.LADO_DO_QUADRO and len(bruto) <= tc.MAX_BYTES_DO_QUADRO
    pequeno = tc.reduzir(np.zeros((100, 120, 3), np.uint8))
    assert cv2.imdecode(np.frombuffer(pequeno, np.uint8), cv2.IMREAD_COLOR).shape[:2] == (100, 120), "o pequeno não aumenta"


def test_os_limites_valem_antes_de_valer_la(tmp_path):
    nomes = [f"21h{m:02d}m{s:02d}.jpg" for m in range(2) for s in range(0, 60, 2)][:50]
    pasta = pasta_com_recortes(tmp_path, nomes)
    lidas = [{
        "hora": datetime(2026, 10, 15, 21, 0, 0), "lado": "lado-errado" if i == 1 else "base", "inicio": False,
        "leu": "algo", "candidatos": [f"C{k}" for k in range(15)] + [" ", 7], "vezes": 9 if i == 2 else 0, "arquivo": n,
    } for i, n in enumerate(nomes)] * 2
    corpo = tc.corpo_do_lanche(GRAVACAO, resumo(nomes), pasta, etapas=lidas)
    etapas = corpo["lanche"]["etapas"]
    assert len(etapas) == tc.MAX_ETAPAS and len(corpo["quadros"]) == tc.MAX_QUADROS
    assert [e["quadro"] for e in etapas[38:42]] == [38, 39, None, None], "passou dos 40 quadros: a etapa vai sem quadro"
    assert etapas[1]["lado"] == "outro"
    assert len(etapas[0]["candidatos"]) == tc.MAX_CANDIDATOS and all(isinstance(c, str) for c in etapas[0]["candidatos"])
    assert (etapas[2]["vezes"], etapas[0]["vezes"]) == (6, 1)


def test_candidato_torto_e_vezes_abaixo_de_um_nao_passam(tmp_path):
    nomes = ["21h00m00.jpg"]
    lida = {"hora": datetime(2026, 10, 15, 21, 0, 0), "lado": "base", "inicio": False, "leu": "queijo",
            "candidatos": [" ", 7, None, "Queijo prato"], "vezes": -3, "arquivo": nomes[0]}
    [etapa] = tc.corpo_do_lanche(GRAVACAO, resumo(nomes), pasta_com_recortes(tmp_path, nomes), etapas=[lida])["lanche"]["etapas"]
    assert etapa["candidatos"] == ["Queijo prato"]
    assert etapa["vezes"] == 1


def test_o_recorte_que_sumiu_deixa_a_etapa_sem_quadro(tmp_path):
    nomes = ["21h00m00.jpg", "21h00m13.jpg"]
    pasta = pasta_com_recortes(tmp_path, nomes)
    (pasta / nomes[0]).unlink()
    corpo = tc.corpo_do_lanche(GRAVACAO, resumo(nomes), pasta)
    assert [e["quadro"] for e in corpo["lanche"]["etapas"]] == [None, 0]


# ───────────────────────────── o recorte da metade ─────────────────────────────
# O recorte do lanche desenhado (400 × 300): papel-alumínio cinza riscado (a textura que alinha a luz), as duas
# metades como discos de pão e os ingredientes como discos menores de outra cor, em cima delas.

ESQ, DIR = (120, 150), (280, 150)
R_PAO = 45
VERMELHO, VERDE = (40, 40, 200), (40, 170, 40)
# A metade da direita e 35% em volta, de cada lado, no recorte de 400 × 300.
FATIA_DIR = (slice(73, 226), slice(203, 356))
INTEIRO = (270, 360)


def caixa_de(centro, r=R_PAO):
    return (centro[0] - r, centro[1] - r, centro[0] + r, centro[1] + r)


def desenho(metades=(ESQ, DIR), ingredientes=(), luz=0, mao=None, pontinhos_em=None, folha=0):
    img = np.full((300, 400, 3), 150, np.uint8)
    for x in range(0, 400, 6):
        cv2.line(img, (x, 0), (x, 299), (110, 110, 110), 1)
    for y in range(0, 300, 9):
        cv2.line(img, (0, y), (399, y), (185, 185, 185), 1)
    for c in metades:
        cv2.circle(img, c, R_PAO, (70, 160, 225), -1)
    for c, cor, r in ingredientes:
        cv2.circle(img, c, r, cor, -1)
    if mao is not None:
        cv2.rectangle(img, (mao[0] - 50, mao[1] - 50), (mao[0] + 50, mao[1] + 50), (120, 150, 200), -1)
    if pontinhos_em is not None:  # o cintilar: pontinhos claros de 3 px, a cada 5 px, no miolo da metade
        cx, cy = pontinhos_em
        for y in range(cy - 40, cy + 40, 5):
            for x in range(cx - 40, cx + 40, 5):
                if (x - cx) ** 2 + (y - cy) ** 2 <= 38 ** 2:
                    img[y:y + 3, x:x + 3] = (250, 250, 250)
    for y0, y1 in ((0, folha), (300 - folha, 300)) if folha else ():  # uma folha listrada nova, em cima e embaixo
        for y in range(y0, y1):
            img[y, :] = (60, 60, 60) if (y // 3) % 2 else (230, 230, 230)
    if luz:
        img = np.clip(img.astype(np.int16) + luz, 0, 255).astype(np.uint8)
    return img


def segundos(de, ate, img, vistas=(ESQ, DIR), trecho=0):
    """Os quadros de `de` a `ate` (21:00:SS), iguais, com as metades que o detector viu (centros ou caixas)."""
    return [(f"21h00m{s:02d}.jpg", trecho, img, vistas) for s in range(de, ate + 1)]


def lanche_com_metades(tmp_path, quadros) -> Path:
    """Os recortes e o `metades.csv` como a leitura da bancada escreve (as caixas em pixels do recorte)."""
    pasta = tmp_path / "lanche-07"
    pasta.mkdir()
    linhas = ["quadro,hora,trecho,caixa,metades"]
    for nome, trecho, img, vistas in quadros:
        cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 95])[1].tofile(str(pasta / nome))
        caixas = [caixa_de(v) if len(v) == 2 else v for v in vistas]
        metades = ";".join(f"{x0}:{y0}:{x1}:{y1}:0.90" for x0, y0, x1, y1 in caixas)
        linhas.append(f"{nome},{nome[:2]}:{nome[3:5]}:{nome[6:8]},{trecho},0:0:400:300,{metades}")
    (pasta / "metades.csv").write_text("\n".join(linhas) + "\n", encoding="utf-8")
    return pasta


def quadro_da_etapa(corpo, k) -> np.ndarray:
    bruto = base64.b64decode(corpo["quadros"][corpo["lanche"]["etapas"][k]["quadro"]]["imagemBase64"])
    return cv2.imdecode(np.frombuffer(bruto, np.uint8), cv2.IMREAD_COLOR)


def na_direita(pasta: Path, nome: str, recorte: np.ndarray) -> bool:
    original = cv2.imdecode(np.fromfile(str(pasta / nome), np.uint8), cv2.IMREAD_COLOR)
    return recorte.shape[:2] == (153, 153) and float(np.abs(recorte.astype(int) - original[FATIA_DIR].astype(int)).mean()) < 8


def test_a_etapa_sobe_no_recorte_da_metade_em_que_entrou_o_ingrediente(tmp_path):
    com_molho = desenho(ingredientes=[(DIR, VERMELHO, 30)])
    pasta = lanche_com_metades(tmp_path, segundos(0, 5, desenho()) + segundos(6, 9, com_molho))
    corpo = tc.corpo_do_lanche(GRAVACAO, resumo(["21h00m00.jpg", "21h00m08.jpg"]), pasta)
    assert quadro_da_etapa(corpo, 0).shape[:2] == INTEIRO, "o pão aberto: o recorte inteiro, reduzido"
    assert na_direita(pasta, "21h00m08.jpg", quadro_da_etapa(corpo, 1)), "a metade da direita, centrada, com a folga"
    assert [e["lado"] for e in corpo["lanche"]["etapas"]] == ["pao", "outro"], "o lado continua não sabido"


def test_a_mudanca_de_um_sexto_da_metade_ja_vale(tmp_path):
    pasta = lanche_com_metades(tmp_path, segundos(0, 5, desenho()) + segundos(6, 9, desenho(ingredientes=[(DIR, VERMELHO, 15)])))
    corpo = tc.corpo_do_lanche(GRAVACAO, resumo(["21h00m00.jpg", "21h00m08.jpg"]), pasta)
    assert na_direita(pasta, "21h00m08.jpg", quadro_da_etapa(corpo, 1))


@pytest.mark.parametrize("depois,motivo", [
    (desenho(ingredientes=[(ESQ, VERDE, 30), (DIR, VERMELHO, 28)]), "as duas metades mudaram parecido"),
    (desenho(ingredientes=[(DIR, VERMELHO, 10)]), "mudou menos de um décimo da metade"),
    (desenho(luz=40), "só a luz mudou"),
])
def test_na_duvida_sobe_o_recorte_inteiro(tmp_path, depois, motivo):
    pasta = lanche_com_metades(tmp_path, segundos(0, 5, desenho()) + segundos(6, 9, depois))
    corpo = tc.corpo_do_lanche(GRAVACAO, resumo(["21h00m00.jpg", "21h00m08.jpg"]), pasta)
    assert quadro_da_etapa(corpo, 1).shape[:2] == INTEIRO, motivo


def test_a_luz_que_muda_junto_nao_esconde_o_ingrediente(tmp_path):
    depois = desenho(ingredientes=[(DIR, VERMELHO, 30)], luz=40)
    pasta = lanche_com_metades(tmp_path, segundos(0, 5, desenho()) + segundos(6, 9, depois))
    corpo = tc.corpo_do_lanche(GRAVACAO, resumo(["21h00m00.jpg", "21h00m08.jpg"]), pasta)
    assert quadro_da_etapa(corpo, 1).shape[:2] == (153, 153), "com a luz alinhada, só a direita mudou"


def test_o_lanche_no_lugar_novo_sobe_inteiro(tmp_path):
    novo = desenho(ingredientes=[(DIR, VERMELHO, 30)])
    pasta = lanche_com_metades(tmp_path, segundos(0, 5, desenho()) + segundos(6, 9, novo, trecho=1))
    corpo = tc.corpo_do_lanche(GRAVACAO, resumo(["21h00m00.jpg", "21h00m06.jpg"]), pasta)
    assert quadro_da_etapa(corpo, 1).shape[:2] == INTEIRO, "a etapa de outro trecho não se compara (outra caixa fixa)"


def test_o_lanche_que_ja_tinha_saido_sobe_inteiro(tmp_path):
    vazio = desenho(metades=())
    pasta = lanche_com_metades(tmp_path, segundos(0, 5, desenho()) + segundos(6, 11, vazio, vistas=())
                               + segundos(12, 13, desenho(metades=(), mao=DIR), vistas=()))
    corpo = tc.corpo_do_lanche(GRAVACAO, resumo(["21h00m00.jpg", "21h00m08.jpg", "21h00m12.jpg"]), pasta)
    assert quadro_da_etapa(corpo, 2).shape[:2] == INTEIRO, "a mão no lugar vazio, 7 s depois da última metade vista"


def test_a_metade_que_ainda_nao_tinha_chegado_nao_conta(tmp_path):
    so_esq, chegou = desenho(metades=(ESQ,)), desenho()
    pasta = lanche_com_metades(tmp_path, segundos(0, 5, so_esq, vistas=(ESQ,)) + segundos(6, 6, chegou, vistas=(ESQ,))
                               + segundos(7, 9, chegou))
    corpo = tc.corpo_do_lanche(GRAVACAO, resumo(["21h00m00.jpg", "21h00m06.jpg"]), pasta)
    assert quadro_da_etapa(corpo, 1).shape[:2] == INTEIRO, "o detector só viu a direita depois da etapa"


def test_a_caixa_pequena_repetida_nao_e_metade(tmp_path):
    miudo = (190, 140, 210, 160)
    antes = segundos(0, 2, desenho(), vistas=(miudo,)) + segundos(3, 5, desenho(), vistas=(ESQ, DIR, miudo))
    depois = segundos(6, 9, desenho(ingredientes=[((200, 150), VERMELHO, 9)]), vistas=(ESQ, DIR, miudo))
    pasta = lanche_com_metades(tmp_path, antes + depois)
    corpo = tc.corpo_do_lanche(GRAVACAO, resumo(["21h00m00.jpg", "21h00m08.jpg"]), pasta)
    assert quadro_da_etapa(corpo, 1).shape[:2] == INTEIRO, "o grão entre as metades não vira recorte"


def test_so_uma_metade_conhecida_e_ela_mudou(tmp_path):
    pasta = lanche_com_metades(tmp_path, segundos(0, 5, desenho(), vistas=(DIR,))
                               + segundos(6, 9, desenho(ingredientes=[(DIR, VERMELHO, 30)]), vistas=(DIR,)))
    corpo = tc.corpo_do_lanche(GRAVACAO, resumo(["21h00m00.jpg", "21h00m08.jpg"]), pasta)
    assert na_direita(pasta, "21h00m08.jpg", quadro_da_etapa(corpo, 1))


def test_as_metades_sao_as_de_perto_da_etapa(tmp_path):
    longe = ((60, 150), (220, 150))  # 60 px: mais que meia metade, outros grupos
    antes = segundos(0, 29, desenho(metades=longe), vistas=longe)
    perto = segundos(30, 44, desenho(), vistas=(ESQ, DIR))
    depois = segundos(45, 49, desenho(ingredientes=[(DIR, VERMELHO, 30)]), vistas=(ESQ, DIR))
    pasta = lanche_com_metades(tmp_path, antes + perto + depois)
    corpo = tc.corpo_do_lanche(GRAVACAO, resumo(["21h00m00.jpg", "21h00m40.jpg", "21h00m47.jpg"]), pasta)
    assert na_direita(pasta, "21h00m47.jpg", quadro_da_etapa(corpo, 2)), "o lugar de agora, não o de 30 s atrás"


def test_o_tom_do_pao_que_escurece_um_pouco_nao_e_ingrediente(tmp_path):
    tostou = desenho(ingredientes=[(DIR, (58, 148, 213), R_PAO)])  # ΔE 11 do pão desenhado
    pasta = lanche_com_metades(tmp_path, segundos(0, 5, desenho()) + segundos(6, 9, tostou))
    corpo = tc.corpo_do_lanche(GRAVACAO, resumo(["21h00m00.jpg", "21h00m08.jpg"]), pasta)
    assert quadro_da_etapa(corpo, 1).shape[:2] == INTEIRO


def test_a_carne_parecida_com_o_pao_ainda_e_ingrediente(tmp_path):
    carne = desenho(ingredientes=[(DIR, (50, 110, 160), 30)])  # ΔE 53 do pão desenhado
    pasta = lanche_com_metades(tmp_path, segundos(0, 5, desenho()) + segundos(6, 9, carne))
    corpo = tc.corpo_do_lanche(GRAVACAO, resumo(["21h00m00.jpg", "21h00m08.jpg"]), pasta)
    assert na_direita(pasta, "21h00m08.jpg", quadro_da_etapa(corpo, 1))


def test_a_outra_metade_mudou_bem_menos_vale_a_que_mudou_mais(tmp_path):
    depois = desenho(ingredientes=[(DIR, VERMELHO, 30), (ESQ, VERDE, 19)])  # 63% × 25% do disco
    pasta = lanche_com_metades(tmp_path, segundos(0, 5, desenho()) + segundos(6, 9, depois))
    corpo = tc.corpo_do_lanche(GRAVACAO, resumo(["21h00m00.jpg", "21h00m08.jpg"]), pasta)
    assert na_direita(pasta, "21h00m08.jpg", quadro_da_etapa(corpo, 1))


def test_a_metade_coberta_some_do_detector_e_continua_valendo(tmp_path):
    coberta = desenho(ingredientes=[(DIR, VERMELHO, 30)])
    pasta = lanche_com_metades(tmp_path, segundos(0, 5, desenho()) + segundos(6, 19, coberta, vistas=(ESQ,)))
    corpo = tc.corpo_do_lanche(GRAVACAO, resumo(["21h00m00.jpg", "21h00m05.jpg", "21h00m19.jpg"]), pasta)
    assert na_direita(pasta, "21h00m19.jpg", quadro_da_etapa(corpo, 2)), "a direita, vista pela última vez 14 s antes"


@pytest.mark.parametrize("vistas_por_segundo,etapa", [
    ([(ESQ, DIR)] * 6 + [()] * 4, 7),  # a última vista, 2 s antes da etapa
    ([(ESQ, DIR)] * 4 + [()] * 3 + [(ESQ, DIR)] * 3, 6),  # a mais perto, 1 s DEPOIS da etapa
])
def test_o_detector_nao_viu_as_metades_na_hora_da_etapa_mas_viu_perto(tmp_path, vistas_por_segundo, etapa):
    quadros = []
    for s, vistas in enumerate(vistas_por_segundo):
        img = desenho(ingredientes=[(DIR, VERMELHO, 30)]) if s >= 4 else desenho()
        quadros += segundos(s, s, img, vistas=vistas)
    pasta = lanche_com_metades(tmp_path, quadros)
    nome = f"21h00m{etapa:02d}.jpg"
    corpo = tc.corpo_do_lanche(GRAVACAO, resumo(["21h00m00.jpg", nome]), pasta)
    assert na_direita(pasta, nome, quadro_da_etapa(corpo, 1))


def test_o_cintilar_em_pontinhos_nao_rouba_a_metade(tmp_path):
    depois = desenho(ingredientes=[(DIR, VERMELHO, 30)], pontinhos_em=ESQ)  # sem a abertura, 46% da esquerda "muda"
    pasta = lanche_com_metades(tmp_path, segundos(0, 5, desenho()) + segundos(6, 9, depois))
    corpo = tc.corpo_do_lanche(GRAVACAO, resumo(["21h00m00.jpg", "21h00m08.jpg"]), pasta)
    assert na_direita(pasta, "21h00m08.jpg", quadro_da_etapa(corpo, 1))


def test_um_pao_visto_uma_vez_so_nao_e_metade(tmp_path):
    reflexo = caixa_de((200, 50))
    quadros = segundos(0, 2, desenho(), vistas=(DIR,)) + segundos(3, 3, desenho(), vistas=(DIR, reflexo))
    quadros += segundos(4, 5, desenho(), vistas=(DIR,))
    quadros += segundos(6, 9, desenho(ingredientes=[(DIR, VERMELHO, 15)], mao=(200, 50)), vistas=(DIR,))
    pasta = lanche_com_metades(tmp_path, quadros)
    corpo = tc.corpo_do_lanche(GRAVACAO, resumo(["21h00m00.jpg", "21h00m08.jpg"]), pasta)
    assert na_direita(pasta, "21h00m08.jpg", quadro_da_etapa(corpo, 1)), "a mão no lugar do reflexo não vira a metade"


def test_a_luz_e_uma_folha_nova_juntas_nao_enganam_o_alinhamento(tmp_path):
    depois = desenho(ingredientes=[(DIR, VERMELHO, 30)], luz=40, folha=90)  # 60% do recorte muda de desenho
    pasta = lanche_com_metades(tmp_path, segundos(0, 5, desenho()) + segundos(6, 9, depois))
    corpo = tc.corpo_do_lanche(GRAVACAO, resumo(["21h00m00.jpg", "21h00m08.jpg"]), pasta)
    assert quadro_da_etapa(corpo, 1).shape[:2] == (153, 153), "a luz pelo papel que não mudou de desenho"


def test_a_metade_um_pouco_menor_tambem_e_metade(tmp_path):
    vistas = (caixa_de(ESQ, 38), DIR)
    pasta = lanche_com_metades(tmp_path, segundos(0, 5, desenho(), vistas=vistas)
                               + segundos(6, 9, desenho(ingredientes=[(ESQ, VERMELHO, 30)]), vistas=vistas))
    corpo = tc.corpo_do_lanche(GRAVACAO, resumo(["21h00m00.jpg", "21h00m08.jpg"]), pasta)
    assert quadro_da_etapa(corpo, 1).shape[:2] == (129, 129), "a esquerda (caixa de 76 px), com a folga"


@pytest.mark.parametrize("conteudo", [None, "quadro,hora\n21h00m00.jpg,21:00:00\n", "quadro,hora,trecho,caixa,metades\nx,y,um,z,w\n"])
def test_sem_metades_csv_ou_torto_sobe_inteiro(tmp_path, conteudo):
    pasta = lanche_com_metades(tmp_path, segundos(0, 5, desenho()) + segundos(6, 9, desenho(ingredientes=[(DIR, VERMELHO, 30)])))
    if conteudo is None:
        (pasta / "metades.csv").unlink()
    else:
        (pasta / "metades.csv").write_text(conteudo, encoding="utf-8")
    assert tc.ler_metades(pasta) == []
    corpo = tc.corpo_do_lanche(GRAVACAO, resumo(["21h00m00.jpg", "21h00m08.jpg"]), pasta)
    assert quadro_da_etapa(corpo, 1).shape[:2] == INTEIRO


def test_o_metades_csv_e_lido_como_a_leitura_da_bancada_escreve(tmp_path):
    pasta = tmp_path / "l"
    pasta.mkdir()
    (pasta / "metades.csv").write_text(
        "quadro,hora,trecho,caixa,metades\n21h00m00.jpg,21:00:00,0,1:2:300:400,10:20:110:120:0.91;200:20:290:110:0.55\n"
        "21h00m01.jpg,21:00:01,1,1:2:300:400,\n", encoding="utf-8")
    assert tc.ler_metades(pasta) == [
        ("21h00m00.jpg", 0, [(10.0, 20.0, 110.0, 120.0), (200.0, 20.0, 290.0, 110.0)]), ("21h00m01.jpg", 1, []),
    ]


def test_o_recorte_da_metade_fica_dentro_do_recorte_do_lanche():
    img = np.zeros((300, 400, 3), np.uint8)
    assert tc.recorte_da_metade(img, (0, 0, 90, 90)).shape[:2] == (121, 121), "cortado na borda, não fora dela"
    assert tc.recorte_da_metade(img, (500, 400, 590, 490)) is None, "a caixa fora do recorte"


# ───────────────────────────── o envio ─────────────────────────────


@pytest.mark.parametrize("status,destino", [(409, tc.ENCERRADA), (422, tc.RECUSADO), (413, tc.RECUSADO),
                                            (500, tc.DEPOIS), (0, tc.DEPOIS), (429, tc.DEPOIS), (401, tc.DEPOIS)])
def test_cada_resposta_do_envio_tem_destino(status, destino):
    def enviar(corpo):
        raise ErroDaNuvem(f"{status}", status=status)

    assert tc.mandar(enviar, {"lanche": {"chave": "lanche-01"}}) == destino
    assert tc.mandar(lambda corpo: {"situacao": "conferir"}, {"lanche": {"chave": "lanche-01"}}) == tc.ENVIADO


def test_pela_rede_o_lanche_vai_pela_rota_do_contrato(tmp_path):
    servidor = _Servidor()
    try:
        nomes = ["21h00m00.jpg"]
        corpo = tc.corpo_do_lanche(GRAVACAO, resumo(nomes), pasta_com_recortes(tmp_path, nomes))
        assert tc.mandar(ClienteNuvem(servidor.url, "tok").lanche_de_treino, corpo) == tc.ENVIADO
        metodo, caminho, recebido, _ = servidor.pedidos[-1]
        assert (metodo, caminho) == ("POST", CONTRATO["rota"].split(" ", 1)[1]) and recebido == corpo
        servidor.status_do_andamento = 409
        assert tc.mandar(ClienteNuvem(servidor.url, "tok").lanche_de_treino, corpo) == tc.ENCERRADA
    finally:
        servidor.fechar()
