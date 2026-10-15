"""A gravação de treino no serviço do agente (A21, fatia T3d-2).

O que se protege aqui:

- as peças saem da configuração em disco: o gravador do ponto do canal (com o perfil medido, se houver, e a senha do
  cofre só na hora do pedido), a área de montagem, o detector e o perfil da bancada da loja;
- a hora: só com a loja FECHADA, pelo horário de funcionamento; loja sem horário não busca (e o registro diz, uma vez);
- sem configuração, a volta não faz nada;
- a linha de execução: dá voltas, espera pouco quando uma gravação termina e muito quando não há o que fazer, e para;
- o serviço liga o treino — e, com `--sem-treino`, nem liga nem declara.
"""

from __future__ import annotations

import json
import logging
import threading
from datetime import datetime
from pathlib import Path

import pytest

from farol_agent import cli, treino_laco, treino_servico
from farol_agent.dvr.arquivo import ClienteDeArquivo, PerfilDeArquivo
from farol_agent.modelos import Janela
from farol_agent.sequencia import perfil as perfis
from farol_agent.treino_lanches import PerfilDaBancada

from .test_repasse_leitor import config as config_de_teste

PERFIL = {"pao_px_min": 100, "pao_px_max": 260, "mexe": 6.0, "mudou": 10.0, "sumiu_s": 12, "parecido": 0.5, "duracao_minima_s": 40}
# A loja abre das 19:00 à 00:30, todo dia (a janela que cruza a meia-noite é do dia em que abriu).
HORARIO = [{"dias": [1, 2, 3, 4, 5, 6, 7], "hora_ini": "19:00", "hora_fim": "00:30"}]


def em_disco(tmp_path: Path, *, horario=HORARIO, perfil=PERFIL) -> Path:
    c = config_de_teste()
    c["pontos"][0]["host"] = "10.0.0.8"
    c["pontos"][0]["usuario"] = "leitor"
    c["pontos"][0]["segredoRef"] = "cofre://gravador"
    c["loja"]["horarioFuncionamento"] = horario
    caminho = tmp_path / "configuracao.json"
    caminho.write_text(json.dumps(c), encoding="utf-8")
    if perfil is not None:
        (tmp_path / treino_servico.PERFIL_DA_BANCADA).write_text(json.dumps(perfil), encoding="utf-8")
    return caminho


def servico(caminho: Path, *, agora=datetime(2026, 10, 15, 10, 0), detector="motor", **kw) -> treino_servico.TreinoEmFundo:
    return treino_servico.TreinoEmFundo(object(), caminho, detector_de=lambda: detector, relogio=lambda: agora, **kw)


# ───────────────────────────── as peças ─────────────────────────────


def test_as_pecas_saem_da_configuracao_em_disco(tmp_path, monkeypatch):
    caminho = em_disco(tmp_path)
    pedidas = []
    monkeypatch.setattr(treino_servico.cofre, "resolver", lambda ref: pedidas.append(ref) or "senha-do-cofre")
    pecas = servico(caminho).pecas()

    gravador = pecas.gravador_do_canal(4)
    assert isinstance(gravador, ClienteDeArquivo) and gravador.host == "10.0.0.8"
    assert gravador.perfil == PerfilDeArquivo(), "sem perfil medido: sem bloco, com a espera de cautela"
    assert pedidas == [], "a senha do cofre só é lida na hora do pedido"
    assert gravador._senha() == "senha-do-cofre" and pedidas == ["cofre://gravador"]
    assert pecas.zona_do_canal(4).papel == "montagem"
    assert pecas.detector == "motor"
    assert pecas.perfil == PerfilDaBancada.de_json(PERFIL)
    with pytest.raises(ValueError):
        pecas.gravador_do_canal(9)


def test_o_perfil_medido_do_gravador_e_usado(tmp_path):
    caminho = em_disco(tmp_path)
    medida = perfis.Medida(perfil=PerfilDeArquivo(bloco_s=2, desvio_s=1, qps=13.0), medido_em=datetime(2026, 10, 10, 3, 0),
                           canal=4, pedidos=6, relogio_s=25.0)
    perfis.guardar(perfis.arquivo_ao_lado(caminho), "10.0.0.8", medida)
    gravador = servico(caminho).pecas().gravador_do_canal(4)
    assert (gravador.perfil.bloco_s, gravador.perfil.desvio_s) == (2, 1)


def test_sem_detector_ou_sem_perfil_da_bancada_a_peca_vem_vazia(tmp_path):
    caminho = em_disco(tmp_path, perfil=None)
    pecas = servico(caminho, detector=None).pecas()
    assert pecas.detector is None and pecas.perfil is None
    # Perfil torto não vale, de nenhum jeito: faltando número, JSON quebrado, lista no lugar do objeto, número que é texto.
    for torto in ('{"pao_px_min": 1}', "{", "[1, 2]", json.dumps({**PERFIL, "mexe": "muito"})):
        (tmp_path / treino_servico.PERFIL_DA_BANCADA).write_text(torto, encoding="utf-8")
        assert treino_servico.perfil_da_bancada(caminho) is None, torto


def test_o_canal_sem_o_endereco_do_gravador_nao_vira_gravador(tmp_path):
    caminho = em_disco(tmp_path)
    c = json.loads(caminho.read_text(encoding="utf-8"))
    c["pontos"][0]["host"] = ""
    caminho.write_text(json.dumps(c), encoding="utf-8")
    with pytest.raises(ValueError, match="não tem gravador"):
        servico(caminho).pecas().gravador_do_canal(4)


def test_sem_configuracao_a_volta_nao_faz_nada(tmp_path):
    s = servico(tmp_path / "configuracao.json")
    assert s.pecas() is None
    assert s.uma_volta() == treino_laco.NADA


# ───────────────────────────── a hora ─────────────────────────────


@pytest.mark.parametrize("agora,pode", [
    (datetime(2026, 10, 15, 10, 0), True),     # de manhã: fechada
    (datetime(2026, 10, 15, 18, 59), True),
    (datetime(2026, 10, 15, 19, 0), False),    # abriu
    (datetime(2026, 10, 15, 23, 30), False),
    (datetime(2026, 10, 16, 0, 20), False),    # a madrugada é do dia em que abriu
    (datetime(2026, 10, 16, 0, 31), True),     # fechou
])
def test_so_busca_e_le_com_a_loja_fechada(tmp_path, agora, pode):
    pecas = servico(em_disco(tmp_path), agora=agora).pecas()
    assert pecas.pode_buscar() is pode and pecas.pode_ler() is pode


def test_loja_sem_horario_nao_busca_e_o_registro_diz_uma_vez(tmp_path, caplog):
    pecas = servico(em_disco(tmp_path, horario=[])).pecas()
    with caplog.at_level(logging.INFO, logger="farol_agent.treino_servico"):
        assert pecas.pode_buscar() is False and pecas.pode_ler() is False
    assert sum("horário de funcionamento" in r.getMessage() for r in caplog.records) == 1


def test_a_conta_da_loja_fechada():
    janelas = [Janela(dias=[], hora_ini="19:00", hora_fim="23:00")]
    assert treino_servico.loja_fechada(janelas, datetime(2026, 10, 15, 20, 0)) is False
    assert treino_servico.loja_fechada(janelas, datetime(2026, 10, 15, 9, 0)) is True
    assert treino_servico.loja_fechada([], datetime(2026, 10, 15, 9, 0)) is None


# ───────────────────────────── a volta e a linha de execução ─────────────────────────────


def test_a_volta_usa_as_pecas_da_configuracao(tmp_path, monkeypatch):
    recebidas = []
    monkeypatch.setattr(treino_laco, "volta", lambda pecas, raiz: recebidas.append((pecas, raiz)) or treino_laco.PRONTA)
    s = servico(em_disco(tmp_path))
    assert s.uma_volta() == treino_laco.PRONTA
    pecas, raiz = recebidas[0]
    assert raiz == tmp_path / "treino", "a pasta do treino fica ao lado da configuração"
    assert pecas.zona_do_canal(4).papel == "montagem"


@pytest.mark.parametrize("resultado,espera", [
    (treino_laco.PRONTA, "curta"), (treino_laco.FALHOU, "curta"), (treino_laco.PAROU, "curta"),
    (treino_laco.NADA, "longa"), (treino_laco.DEPOIS, "longa"), (treino_laco.SEM_NUVEM, "longa"),
])
def test_a_linha_espera_pouco_quando_uma_gravacao_termina_e_muito_quando_nao_ha_o_que_fazer(tmp_path, resultado, espera):
    s = servico(em_disco(tmp_path), pausa_s=60.0, curta_s=0.01)
    voltas = []
    pronto = threading.Event()

    def uma_volta():
        voltas.append(1)
        if len(voltas) >= 2:
            pronto.set()
        return resultado

    s.uma_volta = uma_volta
    s.iniciar()
    deu = pronto.wait(1.0)
    s.parar(espera_s=2.0)
    assert deu is (espera == "curta"), f"{resultado}: a segunda volta {'vem logo' if espera == 'curta' else 'espera a pausa'}"


def test_o_erro_numa_volta_nao_para_a_linha(tmp_path, caplog):
    s = servico(em_disco(tmp_path), pausa_s=0.01, curta_s=0.01)
    voltas = []
    pronto = threading.Event()

    def uma_volta():
        voltas.append(1)
        if len(voltas) == 1:
            raise RuntimeError("defeito numa volta")
        pronto.set()
        return treino_laco.NADA

    s.uma_volta = uma_volta
    with caplog.at_level(logging.ERROR, logger="farol_agent.treino_servico"):
        s.iniciar()
        assert pronto.wait(2.0), "depois do erro, a linha segue"
        s.parar(espera_s=2.0)
    assert any("erro inesperado" in r.getMessage() for r in caplog.records)
    assert s._linha is None


def test_parar_espera_a_volta_em_curso_terminar(tmp_path):
    # O serviço que para (Ctrl+C, reinício) espera a volta em curso: buscar e ler gravam no disco.
    s = servico(em_disco(tmp_path), pausa_s=60.0, curta_s=60.0)
    comecou = threading.Event()

    def uma_volta():
        comecou.set()
        threading.Event().wait(0.3)  # a volta em curso leva um tempo
        return treino_laco.NADA

    s.uma_volta = uma_volta
    s.iniciar()
    assert comecou.wait(2.0)
    linha = s._linha
    s.parar(espera_s=2.0)
    assert not linha.is_alive(), "parar espera a volta em curso terminar"
    assert s._linha is None


# ───────────────────────────── o serviço ─────────────────────────────


class _ClienteDeMentira:
    criados: list["_ClienteDeMentira"] = []

    def __init__(self, base_url, token, *, versao="0", sabe=()):
        self.sabe = tuple(sabe)
        _ClienteDeMentira.criados.append(self)

    def ativar(self, fingerprint, versao=None):
        return {"jaEstavaAtivo": True}


class _TreinoDeMentira:
    vistos: list[str] = []

    def __init__(self, cliente, caminho_config):
        _TreinoDeMentira.vistos.append(f"criado:{Path(caminho_config).name}")

    def iniciar(self):
        _TreinoDeMentira.vistos.append("iniciado")

    def parar(self):
        _TreinoDeMentira.vistos.append("parado")


@pytest.mark.parametrize("sem_treino", [False, True])
def test_o_servico_liga_o_treino_e_com_sem_treino_nem_liga_nem_declara(tmp_path, monkeypatch, sem_treino):
    from farol_agent import nuvem

    _ClienteDeMentira.criados.clear()
    _TreinoDeMentira.vistos.clear()
    monkeypatch.setenv("FAROL_AGENTE_TOKEN", "token-de-teste")
    monkeypatch.setattr(nuvem, "ClienteNuvem", _ClienteDeMentira)
    monkeypatch.setattr(treino_servico, "TreinoEmFundo", _TreinoDeMentira)
    argv = ["servir", "--nuvem", "https://api.exemplo", "--config", str(tmp_path / "configuracao.json"),
            "--fila", str(tmp_path / "fila.db"), "--sem-auditoria", "--voltas", "0"]
    assert cli.main(argv + (["--sem-treino"] if sem_treino else [])) == 0
    [cliente] = _ClienteDeMentira.criados
    assert ("treino" in cliente.sabe) is (not sem_treino)
    assert _TreinoDeMentira.vistos == ([] if sem_treino else ["criado:configuracao.json", "iniciado", "parado"])
