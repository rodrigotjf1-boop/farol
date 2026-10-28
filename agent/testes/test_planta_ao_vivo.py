"""As pessoas do instante para a tela "Ao vivo" (A26, P6): o corpo é o do contrato (`contratos/planta-viva-agora.json`,
o mesmo que a API confere), só o mais novo sai, o ritmo segue a resposta (alguém olhando ou não) e a nuvem que recusa
não faz o agente insistir."""

from __future__ import annotations

import json
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

from farol_agent.nuvem import ErroDaNuvem
from farol_agent.planta_viva import ao_vivo as av
from testes.test_planta_servico import montar

CONTRATO = json.loads((Path(__file__).resolve().parents[2] / "contratos" / "planta-viva-agora.json").read_text(encoding="utf-8"))


class Relogio:
    def __init__(self) -> None:
        self.t = 100.0

    def __call__(self) -> float:
        return self.t


def test_o_corpo_e_o_do_contrato():
    agora = CONTRATO["agora"]
    pessoas = [(p["n"], p["x"], p["y"], p["vx"], p["vy"], tuple(p["canais"])) for p in agora["pessoas"]]
    quando = datetime(2026, 10, 28, 22, 10, 0, 500000, tzinfo=timezone.utc)
    dados = av.dados_do_instante(quando, pessoas, agora["canais"])
    assert dados == agora
    assert list(dados) == CONTRATO["chavesDoInstante"]
    assert all(list(p) == CONTRATO["chavesDaPessoa"] for p in dados["pessoas"])
    assert av.dados_do_instante(quando, [], [])["pessoas"] == [], "ninguém na cozinha também vai"


def test_so_o_mais_novo_sai_e_o_ritmo_segue_quem_olha():
    enviados: list[dict] = []
    resposta = {"olhando": False}
    relogio = Relogio()
    e = av.EnvioAoVivo(lambda d: (enviados.append(d), resposta)[1], relogio=relogio)
    e.publicar({"i": 1})
    e.publicar({"i": 2})  # o anterior ainda não saiu: é trocado
    assert e.enviar_pendente() and enviados == [{"i": 2}]
    assert not e.enviar_pendente(), "nada pendente, nada sai"
    # ninguém olhando: o próximo só depois de A_CADA_SEM_OLHAR_S
    relogio.t += av.A_CADA_SEM_OLHAR_S - 0.1
    e.publicar({"i": 3})
    assert not e.enviar_pendente()
    relogio.t += 0.2
    resposta["olhando"] = True
    e.publicar({"i": 4})
    assert e.enviar_pendente() and enviados[-1] == {"i": 4} and e.olhando
    # alguém olhando: a cada meio segundo
    relogio.t += av.A_CADA_OLHANDO_S + 0.01
    e.publicar({"i": 5})
    assert e.enviar_pendente() and enviados[-1] == {"i": 5}


def test_a_nuvem_que_falha_espera_e_a_antiga_espera_mais():
    relogio = Relogio()
    erro = {"agora": ErroDaNuvem("a nuvem caiu", recuperavel=True)}

    def enviar(d):
        raise erro["agora"]

    e = av.EnvioAoVivo(enviar, relogio=relogio)
    e.publicar({"i": 1})
    assert not e.enviar_pendente()
    relogio.t += av.ESPERA_APOS_FALHA_S - 0.1
    e.publicar({"i": 2})
    assert not e.enviar_pendente(), "falhou: espera um pouco"
    relogio.t += 0.2
    erro["agora"] = ErroDaNuvem("404 em /v1/planta-viva/agora", recuperavel=False, status=404)
    e.publicar({"i": 3})
    assert not e.enviar_pendente()
    relogio.t += av.ESPERA_APOS_FALHA_S + 1
    e.publicar({"i": 4})
    assert not e.enviar_pendente(), "a nuvem sem a rota: espera a pausa longa"
    relogio.t += av.PAUSA_APOS_RECUSA_S
    erro["agora"] = None
    e._enviar = lambda d: {"olhando": False}
    e.publicar({"i": 5})
    assert e.enviar_pendente() and e.enviados == 1


def test_a_linha_propria_manda_e_para():
    chegou = threading.Event()
    e = av.EnvioAoVivo(lambda d: (chegou.set(), {"olhando": False})[1])
    e.iniciar()
    try:
        e.publicar({"i": 1})
        assert chegou.wait(5.0), "a linha própria mandou"
    finally:
        e.parar()
    assert e._linha is None


def test_o_servico_publica_as_pessoas_do_instante(tmp_path):
    p, detector, relogio, _, _ = montar(tmp_path)
    enviados: list[dict] = []
    p.envio_ao_vivo = av.EnvioAoVivo(lambda d: (enviados.append(d), {"olhando": True})[1])
    detector.onde = [(2.5, 4.4), (3.5, 6.0)]
    t = 0.0
    for _ in range(4):
        p.passo(t)
        p.envio_ao_vivo.enviar_pendente()
        p.envio_ao_vivo._proximo = 0.0  # o ritmo é do teste acima; aqui, todo instante
        t += 0.5
        relogio.t += timedelta(seconds=0.5)
    ultimo = enviados[-1]
    (canal,) = p.canais
    assert ultimo["canais"] == [canal] and [q["n"] for q in ultimo["pessoas"]] == [1, 2]
    assert all(q["canais"] == [canal] for q in ultimo["pessoas"])
    assert abs(ultimo["pessoas"][0]["x"] - 2.5) < 0.15 and abs(ultimo["pessoas"][0]["y"] - 4.4) < 0.15
    assert enviados[0]["pessoas"] == [], "no primeiro quadro ainda ninguém foi confirmado"
