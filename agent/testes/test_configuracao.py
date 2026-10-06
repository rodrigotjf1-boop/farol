"""A configuração que desce da nuvem, e a cópia que segura a loja de pé.

O que estes testes protegem é o comportamento quando dá errado. Com tudo
funcionando, qualquer implementação passa; o produto se decide no link
que oscila, no token que expira e no JSON que chega malformado.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from farol_agent.configuracao import (
    ConfigDaLoja,
    ErroDeConfiguracao,
    Sincronizador,
    de_json,
    ler_do_disco,
    salvar,
)
from farol_agent.modelos import Prioridade, Severidade, TipoRegra
from farol_agent.nuvem import ClienteNuvem, ErroDaNuvem


def resposta(versao=3, com_regra=True, principal=True):
    """O formato que `/v1/agentes/configuracao` devolve."""
    regras = []
    if com_regra:
        regras = [{
            "id": "r1",
            "nome": "bancada limpa",
            "tipo": "estado",
            "criterio": "a bancada está livre e limpa",
            "criterioVersao": 2,
            "prioridade": "intermediaria",
            "severidade": "atencao",
            "confiancaMinima": 0.8,
            "cooldownMin": 20,
            "resolucao": "r640",
            "janelas": [{"dias": [1, 2, 3], "hora_ini": "08:00", "hora_fim": "18:00"}],
            "acoes": ["registro"],
            "baseId": None,
        }]
    return {
        "loja": {"id": "loja-1", "nome": "Loja de teste"},
        "versao": versao,
        "pontos": [{
            "id": "p1",
            "nome": "bancada",
            "setor": "cozinha",
            "origem": "dvr",
            "canal": 1,
            "host": "192.168.1.108",
            "usuario": "admin",
            "segredoRef": "cofre://cam1",
            "optica": {"sensorPol": "1/2.7", "focalMm": 2.8},
            "zonas": [{
                "id": "z1",
                "nome": "área da montagem",
                "poligono": [[0.15, 0.47], [0.85, 0.47], [0.85, 0.8], [0.15, 0.8]],
                "principal": principal,
                "larguraCenaCm": 40,
                "regras": regras,
            }],
        }],
    }


class NuvemFalsa:
    """Dublê do cliente. Conta chamadas e sabe falhar sob encomenda."""

    def __init__(self, config=None, versao_remota=3, erro_heartbeat=None,
                 erro_config=None, comandos=None):
        self.config_resposta = config if config is not None else resposta(versao_remota)
        self.versao_remota = versao_remota
        self.erro_heartbeat = erro_heartbeat
        self.erro_config = erro_config
        self.comandos = comandos or []
        self.batidas = 0
        self.puxadas = 0

    def heartbeat(self, versao=None):
        self.batidas += 1
        if self.erro_heartbeat:
            raise self.erro_heartbeat
        return {
            "ok": True,
            "configVersao": self.versao_remota,
            "comandos": self.comandos,
        }

    def configuracao(self):
        self.puxadas += 1
        if self.erro_config:
            raise self.erro_config
        return self.config_resposta


# ─────────────────────────────── conversão ───────────────────────────────


def test_converte_ponto_zona_e_regra():
    c = de_json(resposta())

    assert c.loja_id == "loja-1"
    assert c.versao == 3
    assert len(c.pontos) == 1

    p = c.pontos[0]
    assert p.canal == 1
    assert p.segredo_ref == "cofre://cam1"
    assert len(p.regras) == 1

    r = p.regras[0]
    assert r.tipo is TipoRegra.ESTADO
    assert r.prioridade is Prioridade.INTERMEDIARIA
    assert r.severidade is Severidade.ATENCAO
    assert r.confianca_minima == 0.8
    assert r.criterio_versao == 2
    assert r.janelas[0].dias == [1, 2, 3]


def test_a_zona_principal_e_o_corte_do_canal():
    # É o recorte que vale para toda análise que não mire uma zona
    # específica. Sem a marca, o agente teria que escolher entre as zonas.
    p = de_json(resposta()).pontos[0]

    assert p.zona_principal is not None
    assert p.zona_principal.id == "z1"
    assert p.zona_principal.poligono[0] == (0.15, 0.47)


def test_sem_marca_de_principal_usa_a_primeira_em_vez_de_ficar_sem_corte():
    # Configuração malformada não pode deixar o agente sem recorte: ficar
    # sem corte significa mandar o quadro inteiro ao modelo, pagando mais e
    # entregando menos px/cm — o oposto do que a área marcada existe para
    # fazer.
    p = de_json(resposta(principal=False)).pontos[0]
    assert p.zona_principal is not None


def test_tipo_invalido_estoura_em_vez_de_passar_calado():
    # Configuração errada que passa calada vira auditoria errada, e ninguém
    # liga o alerta estranho de terça ao campo salvo na segunda.
    dados = resposta()
    dados["pontos"][0]["zonas"][0]["regras"][0]["tipo"] = "adivinhar"

    with pytest.raises(ErroDeConfiguracao, match="tipo"):
        de_json(dados)


def test_resolucao_invalida_estoura():
    dados = resposta()
    dados["pontos"][0]["zonas"][0]["regras"][0]["resolucao"] = "r9999"

    with pytest.raises(ErroDeConfiguracao, match="resolucao"):
        de_json(dados)


def test_poligono_degenerado_estoura():
    dados = resposta()
    dados["pontos"][0]["zonas"][0]["poligono"] = [[0, 0], [1, 1]]

    with pytest.raises(ErroDeConfiguracao, match="3 pontos"):
        de_json(dados)


def test_resposta_que_nao_e_configuracao_estoura():
    with pytest.raises(ErroDeConfiguracao):
        de_json({"qualquer": "coisa"})


# ──────────────────────────────── disco ────────────────────────────────


def test_grava_e_le_de_volta(tmp_path):
    destino = tmp_path / "config.json"
    salvar(destino, resposta(versao=7))

    lido = ler_do_disco(destino)
    assert lido["versao"] == 7
    assert de_json(lido).versao == 7


def test_grava_o_json_CRU_nao_o_convertido(tmp_path):
    # Uma versão futura do agente que entenda campos novos precisa
    # encontrá-los aqui, em vez de terem sido podados por esta.
    destino = tmp_path / "config.json"
    bruto = resposta()
    bruto["campoQueEstaVersaoNaoConhece"] = {"algo": 1}
    salvar(destino, bruto)

    assert "campoQueEstaVersaoNaoConhece" in ler_do_disco(destino)


def test_a_gravacao_nao_deixa_arquivo_pela_metade(tmp_path):
    # Troca atômica: nada de `.tmp` sobrando e o arquivo final sempre
    # inteiro. Queda de luz no meio da escrita não pode deixar um JSON
    # truncado que o agente não lê no próximo boot.
    destino = tmp_path / "config.json"
    salvar(destino, resposta())
    salvar(destino, resposta(versao=9))

    assert ler_do_disco(destino)["versao"] == 9
    assert list(tmp_path.glob("*.tmp")) == []


def test_arquivo_corrompido_nao_derruba_a_leitura(tmp_path):
    destino = tmp_path / "config.json"
    destino.write_text("{isto não é json", encoding="utf-8")
    assert ler_do_disco(destino) is None


def test_sem_arquivo_devolve_nada(tmp_path):
    assert ler_do_disco(tmp_path / "nao-existe.json") is None


# ───────────────────────────── sincronização ─────────────────────────────


def test_puxa_quando_a_versao_difere(tmp_path):
    nuvem = NuvemFalsa(versao_remota=5)
    s = Sincronizador(nuvem, tmp_path / "c.json")

    s.bater()

    assert nuvem.puxadas == 1
    assert s.config.versao == 5
    assert (tmp_path / "c.json").is_file()


def test_nao_puxa_quando_a_versao_e_a_mesma(tmp_path):
    # É o que permite bater de 2 em 2 segundos sem trafegar a configuração
    # inteira a cada batida.
    nuvem = NuvemFalsa(versao_remota=5)
    s = Sincronizador(nuvem, tmp_path / "c.json")

    s.bater()
    s.bater()
    s.bater()

    assert nuvem.batidas == 3
    assert nuvem.puxadas == 1, "puxou de novo sem a versão ter mudado"


def test_versao_nova_na_nuvem_dispara_nova_puxada(tmp_path):
    nuvem = NuvemFalsa(versao_remota=5)
    s = Sincronizador(nuvem, tmp_path / "c.json")
    s.bater()

    nuvem.versao_remota = 6
    nuvem.config_resposta = resposta(versao=6)
    s.bater()

    assert nuvem.puxadas == 2
    assert s.config.versao == 6


def test_nuvem_fora_do_ar_nao_derruba_nem_apaga(tmp_path):
    """A loja continua auditando com o que tem.

    Auditoria que para quando o link oscila seria desligada na primeira
    semana, com razão.
    """
    destino = tmp_path / "c.json"
    salvar(destino, resposta(versao=4))

    nuvem = NuvemFalsa(erro_heartbeat=ErroDaNuvem("não cheguei na nuvem: timeout"))
    s = Sincronizador(nuvem, destino)

    comandos = s.bater()

    assert comandos == []
    assert s.config is not None, "perdeu a configuração por causa da rede"
    assert s.config.versao == 4
    assert s.ultimo_erro is not None, "tem que registrar o MOTIVO"
    assert destino.is_file()


def test_token_recusado_tambem_nao_derruba(tmp_path):
    salvar(tmp_path / "c.json", resposta(versao=4))
    nuvem = NuvemFalsa(
        erro_heartbeat=ErroDaNuvem("401 — token recusado", recuperavel=False, status=401)
    )
    s = Sincronizador(nuvem, tmp_path / "c.json")

    s.bater()

    assert s.config.versao == 4
    assert "401" in s.ultimo_erro


def test_configuracao_malformada_nao_sobrescreve_a_boa(tmp_path):
    """Converte ANTES de gravar.

    Gravar primeiro e descobrir o erro depois deixaria o agente sem nada
    ao reiniciar: uma falha de rede vira uma loja parada no dia seguinte.
    """
    destino = tmp_path / "c.json"
    salvar(destino, resposta(versao=4))

    quebrada = resposta(versao=5)
    quebrada["pontos"][0]["zonas"][0]["regras"][0]["tipo"] = "invalido"
    nuvem = NuvemFalsa(config=quebrada, versao_remota=5)

    s = Sincronizador(nuvem, destino)
    s.bater()

    assert ler_do_disco(destino)["versao"] == 4, "a boa foi sobrescrita pela quebrada"
    assert s.config.versao == 4
    assert s.ultimo_erro is not None


def test_carrega_do_disco_ao_nascer(tmp_path):
    # O agente reinicia e já sai auditando, sem esperar a nuvem.
    destino = tmp_path / "c.json"
    salvar(destino, resposta(versao=8))

    s = Sincronizador(NuvemFalsa(erro_heartbeat=ErroDaNuvem("sem rede")), destino)

    assert s.config is not None
    assert s.config.versao == 8
    assert len(s.config.regras) == 1


def test_sem_disco_e_sem_nuvem_segue_sem_configuracao(tmp_path):
    # Instalação nova com a internet fora: não há o que auditar ainda, e
    # isso não é falha — é estado. Não pode estourar.
    s = Sincronizador(NuvemFalsa(erro_heartbeat=ErroDaNuvem("sem rede")),
                      tmp_path / "c.json")

    assert s.config is None
    assert s.bater() == []


def test_comandos_vem_do_heartbeat(tmp_path):
    nuvem = NuvemFalsa(comandos=[
        {"id": "c1", "tipo": "capturar_quadro", "pontoId": "p1", "parametros": {}},
    ])
    s = Sincronizador(nuvem, tmp_path / "c.json")

    comandos = s.bater()

    assert len(comandos) == 1
    assert comandos[0]["tipo"] == "capturar_quadro"


def test_ponto_por_id(tmp_path):
    s = Sincronizador(NuvemFalsa(), tmp_path / "c.json")
    s.bater()

    assert s.config.ponto("p1").nome == "bancada"
    assert s.config.ponto("nao-existe") is None


# ────────────────────────── o cliente da nuvem ──────────────────────────


def test_cliente_recusa_nascer_sem_endereco_ou_token():
    with pytest.raises(ErroDaNuvem, match="endereço"):
        ClienteNuvem("", "token")
    with pytest.raises(ErroDaNuvem, match="token"):
        ClienteNuvem("https://api.exemplo", "")


def test_erro_da_nuvem_separa_o_que_vale_retentar():
    assert ErroDaNuvem("500").recuperavel is True
    assert ErroDaNuvem("401", recuperavel=False).recuperavel is False


def test_o_token_nao_aparece_em_repr_nem_em_str():
    # O log do agente vai para disco numa máquina de loja. Token em linha
    # de log é token vazado.
    c = ClienteNuvem("https://api.exemplo", "sk-super-secreto-123")

    assert "sk-super-secreto-123" not in repr(c)
    assert "sk-super-secreto-123" not in str(c.__dict__.get("base_url", ""))
