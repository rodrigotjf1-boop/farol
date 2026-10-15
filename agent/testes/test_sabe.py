"""O que o agente declara que sabe — e o que acontece quando ele passa a saber mais.

A nuvem só manda certas coisas para o agente que declara saber lidar com elas
(`?sabe=estados,estudo,…`): o critério que não está valendo, o estudo do critério.
Para o agente antigo, elas não existem. E ela GUARDA a declaração: é como o
console sabe o que já vale na loja (`contratos/o-que-o-agente-sabe.json`).

O defeito que isto guarda: o agente só puxava a configuração quando a VERSÃO
mudava. Trocado o pacote na loja, o agente novo subia com a configuração que o
antigo baixou — sem o que a nuvem escondia dele — e, com a versão em dia, nunca
pedia de novo. O critério criado em "observando" antes da troca ficaria sem
contar nada, sem erro nenhum.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from farol_agent import nuvem as cliente_da_nuvem
from farol_agent.auditoria import Auditoria
from farol_agent.configuracao import MARCA_DO_AGENTE, Sincronizador, de_json, ler_do_disco, salvar
from farol_agent.nuvem import ErroDaNuvem

from .test_auditoria import FonteBoa, JuizDeTeste, NuvemDeTeste
from .test_configuracao import NuvemFalsa, resposta

TERCA_MEIO_DIA = datetime(2026, 10, 6, 12, 0, 0)
SABE = list(cliente_da_nuvem.SABE)
CONTRATO = json.loads((Path(__file__).resolve().parents[2] / "contratos" / "o-que-o-agente-sabe.json").read_text(encoding="utf-8"))


def test_o_agente_declara_o_que_o_contrato_lista_e_pede_a_configuracao_como_ele_diz(monkeypatch):
    assert sorted(SABE) == sorted(CONTRATO["saberes"]) and len(SABE) == len(set(SABE))
    assert set(CONTRATO["mudamOQueDesce"]) <= set(SABE)
    assert sorted(SABE) == CONTRATO["guardado"], "a nuvem guarda a declaração em ordem"
    pedidos = []

    class Resposta:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b'{"versao": 7}'

    def abrir(req, timeout=None):
        pedidos.append(req.full_url)
        return Resposta()

    monkeypatch.setattr("urllib.request.urlopen", abrir)
    cliente_da_nuvem.ClienteNuvem("https://api.exemplo", "tok").configuracao()
    assert pedidos == ["https://api.exemplo" + CONTRATO["pedido"]]
    # O serviço sem a gravação de treino (`--sem-treino`) declara menos — e pede a configuração com o que declara.
    cliente_da_nuvem.ClienteNuvem("https://api.exemplo", "tok", sabe=("estados", "fichas")).configuracao()
    assert pedidos[-1] == "https://api.exemplo/v1/agentes/configuracao?sabe=estados,fichas"


def com_criterio_escondido(versao=5) -> dict:
    """A configuração como a nuvem a entrega a quem SABE: o critério de sempre e um em observação."""
    corpo = resposta(versao=versao)
    zona = corpo["pontos"][0]["zonas"][0]
    base = {**zona["regras"][0], "janelas": [], "quando": "sempre"}
    zona["regras"] = [{**base, "id": "val", "estado": "valendo"}, {**base, "id": "obs", "nome": "só observa", "estado": "observando"}]
    return corpo


def como_o_agente_antigo_guardou(caminho, versao=5) -> None:
    """Em disco, a configuração que o agente de ANTES baixou: só o que estava valendo, e sem anotação."""
    corpo = com_criterio_escondido(versao)
    zona = corpo["pontos"][0]["zonas"][0]
    zona["regras"] = [r for r in zona["regras"] if r["estado"] == "valendo"]
    salvar(caminho, corpo)


def test_a_configuracao_guardada_anota_o_que_o_agente_declarou_ao_pedir(tmp_path):
    nuvem = NuvemFalsa(versao_remota=5)
    original = json.loads(json.dumps(nuvem.config_resposta))
    s = Sincronizador(nuvem, tmp_path / "c.json")
    s.bater()

    em_disco = ler_do_disco(tmp_path / "c.json")
    assert em_disco[MARCA_DO_AGENTE] == {"sabe": SABE}
    assert s.config.pedida_sabendo == tuple(SABE)
    # O resto fica como veio da nuvem — e a resposta dela não é mexida.
    assert {k: v for k, v in em_disco.items() if k != MARCA_DO_AGENTE} == original
    assert nuvem.config_resposta == original


def test_a_anotacao_torta_ou_ausente_e_lida_como_nada_declarado():
    for marca in (..., None, "estados", ["estados"], {}, {"sabe": "estados"}, {"sabe": None}, {"outra": ["estados"]}):
        corpo = resposta()
        if marca is not ...:
            corpo[MARCA_DO_AGENTE] = marca
        assert de_json(corpo).pedida_sabendo == ()
    corpo = resposta()
    corpo[MARCA_DO_AGENTE] = {"sabe": ["estados", "estudo"]}
    assert de_json(corpo).pedida_sabendo == ("estados", "estudo")


def test_o_agente_atualizado_puxa_de_novo_mesmo_com_a_versao_igual(tmp_path, caplog):
    caminho = tmp_path / "c.json"
    como_o_agente_antigo_guardou(caminho, versao=5)
    nuvem = NuvemFalsa(config=com_criterio_escondido(5), versao_remota=5)

    s = Sincronizador(nuvem, caminho)
    assert [r.id for r in s.config.regras] == ["val"] and s.config.pedida_sabendo == ()

    with caplog.at_level("INFO", logger="farol_agent.configuracao"):
        s.bater()
    assert nuvem.puxadas == 1, "a versão é a mesma, mas o agente passou a saber mais"
    o_que_falta = ", ".join(sorted(SABE))       # o agente antigo não declarava nada: falta tudo
    assert f"o agente sabe mais do que sabia quando a configuração desceu ({o_que_falta})" in caplog.text
    assert [r.id for r in s.config.regras] == ["val", "obs"], "o critério que a nuvem escondia chegou"
    assert s.config.versao == 5

    # Uma vez só: daí em diante, versão igual é configuração igual.
    for _ in range(3):
        s.bater()
    assert (nuvem.batidas, nuvem.puxadas) == (4, 1)

    # E o agente que reinicia acha, em disco, a configuração já pedida sabendo tudo.
    outro = Sincronizador(nuvem, caminho)
    outro.bater()
    assert nuvem.puxadas == 1 and [r.id for r in outro.config.regras] == ["val", "obs"]


def test_saber_so_uma_parte_do_que_se_sabe_hoje_tambem_faz_puxar(tmp_path):
    # A configuração foi baixada por um agente que já sabia de estados, mas ainda não do estudo.
    caminho = tmp_path / "c.json"
    salvar(caminho, {**resposta(versao=5), MARCA_DO_AGENTE: {"sabe": ["estados"]}})
    nuvem = NuvemFalsa(versao_remota=5)
    s = Sincronizador(nuvem, caminho)
    s.bater()
    assert nuvem.puxadas == 1 and s.config.pedida_sabendo == tuple(SABE)

    # O contrário não puxa: configuração pedida sabendo MAIS do que este agente sabe serve
    # (o que ele não entende, ele ignora ou trata do lado seguro).
    salvar(caminho, {**resposta(versao=5), MARCA_DO_AGENTE: {"sabe": [*SABE, "coisa_de_amanha"]}})
    nuvem = NuvemFalsa(versao_remota=5)
    s = Sincronizador(nuvem, caminho)
    s.bater()
    assert nuvem.puxadas == 0


def test_o_servico_sem_treino_anota_o_que_declarou_e_nao_puxa_a_cada_batida(tmp_path):
    # `--sem-treino` (T3d-2): o cliente declara tudo menos "treino". A configuração guardada anota o que ESTE agente
    # declarou; e as batidas seguintes não acham que falta "treino" — contra a lista geral, ele puxaria a configuração
    # de novo a cada batida, para sempre.
    sem_treino = tuple(x for x in SABE if x != "treino")
    nuvem = NuvemFalsa(versao_remota=5)
    nuvem.sabe = sem_treino
    s = Sincronizador(nuvem, tmp_path / "c.json")
    s.bater()
    assert ler_do_disco(tmp_path / "c.json")[MARCA_DO_AGENTE] == {"sabe": list(sem_treino)}
    assert s.config.pedida_sabendo == sem_treino
    for _ in range(3):
        s.bater()
    assert (nuvem.batidas, nuvem.puxadas) == (4, 1)


def test_se_a_puxada_falha_o_agente_segue_com_o_que_tem_e_tenta_na_proxima_batida(tmp_path):
    caminho = tmp_path / "c.json"
    como_o_agente_antigo_guardou(caminho, versao=5)
    nuvem = NuvemFalsa(config=com_criterio_escondido(5), versao_remota=5, erro_config=ErroDaNuvem("nuvem fora", recuperavel=True))
    s = Sincronizador(nuvem, caminho)

    s.bater()
    s.bater()
    assert nuvem.puxadas == 2 and [r.id for r in s.config.regras] == ["val"], "segue com a configuração que tem"
    assert ler_do_disco(caminho).get(MARCA_DO_AGENTE) is None, "nada foi gravado por cima"

    nuvem.erro_config = None
    s.bater()
    assert nuvem.puxadas == 3 and [r.id for r in s.config.regras] == ["val", "obs"]
    s.bater()
    assert nuvem.puxadas == 3


def test_resposta_que_nao_e_configuracao_nao_derruba_o_agente(tmp_path):
    caminho = tmp_path / "c.json"
    como_o_agente_antigo_guardou(caminho, versao=5)
    for torta in (["não", "é", "objeto"], "texto", None, {"sem": "loja"}):
        nuvem = NuvemFalsa(versao_remota=5)
        nuvem.config_resposta = torta
        s = Sincronizador(nuvem, caminho)
        s.bater()
        assert nuvem.puxadas == 1 and [r.id for r in s.config.regras] == ["val"]
        assert "não parece configuração" in str(s.ultimo_erro)


def test_a_auditoria_remonta_quando_a_mesma_versao_chega_pedida_sabendo_mais(tmp_path):
    # A versão não mudou; o que mudou é que o agente declarou saber mais, e a nuvem mandou mais.
    juiz = JuizDeTeste()
    a = Auditoria(
        NuvemDeTeste(), str(tmp_path / "fila.db"),
        construir_fonte=lambda ponto: FonteBoa(ponto.id), construir_juiz=lambda cfg: juiz, medidor=None,
    )
    antiga = com_criterio_escondido(5)
    antiga["pontos"][0]["zonas"][0]["regras"] = antiga["pontos"][0]["zonas"][0]["regras"][:1]
    a.montar(de_json(antiga))
    motor_de_antes = a.motor
    assert [r.id for r in a.motor.regras] == ["val"]

    # A mesma configuração de novo (nada mudou): não remonta.
    a.montar(de_json(antiga))
    assert a.motor is motor_de_antes

    nova = {**com_criterio_escondido(5), MARCA_DO_AGENTE: {"sabe": SABE}}
    a.montar(de_json(nova))
    assert a.motor is not motor_de_antes
    assert [r.id for r in a.motor.regras] == ["val", "obs"]

    r = a.passo(TERCA_MEIO_DIA)
    por_criterio = {l["regra_id"]: dict(l) for l in a.fila._con.execute("select * from resumo_hora")}
    assert (por_criterio["obs"]["observadas"], por_criterio["val"]["enfileiradas"], r["enfileirados"]) == (1, 1, 1)

    # E de novo a mesma, pedida sabendo o mesmo: não remonta.
    motor_novo = a.motor
    a.montar(de_json(nova))
    assert a.motor is motor_novo
    a.parar()
