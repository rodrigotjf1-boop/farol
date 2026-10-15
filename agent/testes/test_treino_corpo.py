"""O corpo do lanche de treino, para a conferência (A21, fatia T3c-4).

O que atravessa a fronteira está em `contratos/lanche-de-treino.json`, lido também por `api/testes/treino.test.ts`.
O que se protege aqui:

- o corpo tem as chaves do contrato, os lados do contrato e os limites do contrato;
- sem identificação, a etapa vai sem leitura: a primeira é o pão aberto, as outras de lado não sabido;
- os quadros sobem reduzidos e dentro do limite; a etapa que passa dos 40 quadros vai sem quadro;
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
