"""O laço do agente: atende comando, responde sempre, nunca morre.

O que se testa aqui é o comportamento sob falha. Um agente que morre por
causa de um comando mal formado deixa a loja sem auditoria até alguém
notar — e ninguém nota um processo parado numa máquina de cozinha.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import numpy as np
import pytest

from farol_agent import cofre, servico
from farol_agent.configuracao import PontoConfig, Sincronizador
from farol_agent.modelos import Frame
from farol_agent.nuvem import ErroDaNuvem
from farol_agent.preview import ErroDoPreview, capturar

from .test_configuracao import NuvemFalsa, resposta


class FonteDePreview:
    """Fonte com tamanho sob medida, para o preview se testar sem câmera."""

    def __init__(self, largura=1920, altura=1080, preta=False, vazia=False):
        self.largura_q, self.altura_q = largura, altura
        self.preta, self.vazia = preta, vazia
        self.fechada = False

    def rajada(self, ts, quantidade=4, stream="main"):
        if self.vazia:
            return []
        quadros = []
        for i in range(quantidade):
            if self.preta:
                img = np.zeros((self.altura_q, self.largura_q, 3), dtype=np.uint8)
            else:
                rng = np.random.default_rng(i)
                img = rng.integers(
                    0, 255, (self.altura_q, self.largura_q, 3), dtype=np.uint8
                )
            quadros.append(Frame(img, ts + timedelta(milliseconds=100 * i), "p"))
        return quadros

    def fechar(self):
        self.fechada = True


# ───────────────────────────── o preview ─────────────────────────────


def test_o_preview_relata_a_dimensao_ORIGINAL_nao_a_transportada():
    """Quem decide `resolucao_h` é o sensor, não a banda.

    A imagem é reduzida para viajar, mas relatar 1280 porque foi o que
    trafegou seria mentir sobre a câmera por causa de uma escolha de
    transporte — e o motor de dimensionamento passaria a recusar regras
    que a câmera sustenta.
    """
    q = capturar(FonteDePreview(1920, 1080), lado_maior=1280, borrar_rosto=False)

    assert (q.largura, q.altura) == (1920, 1080)
    assert q.bytes > 0
    assert q.tipo == "image/jpeg"


def test_o_jpeg_transportado_e_menor_que_o_capturado():
    import base64

    import cv2

    q = capturar(FonteDePreview(1920, 1080), lado_maior=640, borrar_rosto=False)
    dados = base64.b64decode(q.imagem_base64)
    img = cv2.imdecode(np.frombuffer(dados, np.uint8), cv2.IMREAD_COLOR)

    assert img.shape[1] == 640, "não reduziu para o transporte"
    assert q.largura == 1920, "mas continua relatando a resolução real"


def test_canal_sem_quadro_vira_erro_com_motivo():
    with pytest.raises(ErroDoPreview, match="não entregou quadro"):
        capturar(FonteDePreview(vazia=True))


def test_tela_de_sem_sinal_nao_vira_preview():
    # Subir a tela preta do gravador faria o usuário desenhar uma área
    # sobre um retângulo preto, e a regra nasceria mirando o nada.
    with pytest.raises(ErroDoPreview, match="não entregou cena"):
        capturar(FonteDePreview(preta=True))


# ───────────────────────────── o cofre ─────────────────────────────


def test_a_referencia_especifica_vence_a_geral(monkeypatch):
    # Numa loja com dois gravadores, a específica tem que vencer — senão
    # os dois usariam a mesma senha sem ninguém notar até uma ser trocada.
    monkeypatch.setenv("FAROL_DVR_SENHA", "a-geral")
    monkeypatch.setenv("FAROL_SEGREDO_CAM1", "a-da-camera-1")

    assert cofre.resolver("cofre://cam1") == "a-da-camera-1"
    assert cofre.resolver("cofre://cam2") == "a-geral"
    assert cofre.resolver(None) == "a-geral"


def test_sem_senha_nenhuma_levanta_em_vez_de_devolver_vazio(monkeypatch):
    """Senha vazia faz o RTSP responder 401.

    E aí o erro aparece como "canal não abriu", mandando quem for
    diagnosticar olhar cabo, rede e gravador antes de desconfiar da
    configuração.
    """
    monkeypatch.delenv("FAROL_DVR_SENHA", raising=False)
    monkeypatch.delenv("FAROL_SEGREDO_CAM1", raising=False)

    with pytest.raises(cofre.ErroDoCofre, match="FAROL_SEGREDO_CAM1"):
        cofre.resolver("cofre://cam1")


def test_referencia_malformada_e_recusada():
    for ruim in ["cofre://../../etc/passwd", "cofre://nome com espaço", "cofre://"]:
        with pytest.raises(cofre.ErroDoCofre):
            cofre.variavel_de(ruim)


def test_nome_da_variavel():
    assert cofre.variavel_de("cofre://cam1") == "FAROL_SEGREDO_CAM1"
    assert cofre.variavel_de("cofre://bancada-2") == "FAROL_SEGREDO_BANCADA_2"


# ──────────────────────────── a URL do canal ────────────────────────────


def ponto(**extra) -> PontoConfig:
    base = dict(
        id="p1", nome="bancada", fabricante="intelbras", canal=1,
        host="192.168.1.108", porta=554, usuario="admin", segredo_ref="cofre://cam1",
    )
    base.update(extra)
    return PontoConfig(**base)


def test_a_senha_vem_do_cofre_local_e_entra_escapada(monkeypatch):
    # Senha com @ ou / quebraria a URL e o login falharia sem mensagem
    # que ajude.
    monkeypatch.setenv("FAROL_SEGREDO_CAM1", "se/nha@123")

    url = servico.url_do_ponto(ponto())

    assert "se%2Fnha%40123" in url
    assert "se/nha@123" not in url
    assert "192.168.1.108:554" in url
    assert "channel=1" in url


def test_sub_stream_pede_subtype_1(monkeypatch):
    monkeypatch.setenv("FAROL_SEGREDO_CAM1", "x")
    assert "subtype=1" in servico.url_do_ponto(ponto(), sub=True)
    assert "subtype=0" in servico.url_do_ponto(ponto(), sub=False)


def test_ponto_sem_host_ou_canal_diz_o_que_falta(monkeypatch):
    monkeypatch.setenv("FAROL_SEGREDO_CAM1", "x")

    with pytest.raises(servico.ErroDoComando, match="host ou canal"):
        servico.url_do_ponto(ponto(host=None))
    with pytest.raises(servico.ErroDoComando, match="host ou canal"):
        servico.url_do_ponto(ponto(canal=None))


# ──────────────────────────── o laço ────────────────────────────


class ClienteDeTeste(NuvemFalsa):
    """NuvemFalsa que também guarda o que foi respondido."""

    def __init__(self, **kw):
        super().__init__(**kw)
        self.respostas: list[dict] = []
        self.erro_responder = None

    def responder(self, comando_id, *, resultado=None, erro=None):
        if self.erro_responder:
            raise self.erro_responder
        self.respostas.append({"id": comando_id, "resultado": resultado, "erro": erro})
        return {"ok": True}


def comando(tipo="capturar_quadro", ponto_id="p1", cid="c1"):
    return {"id": cid, "tipo": tipo, "pontoId": ponto_id, "parametros": {}}


def test_comando_desconhecido_responde_o_motivo(tmp_path):
    # A nuvem é mais nova que o agente. Ignorar deixaria o console
    # esperando por algo que nunca viria.
    cliente = ClienteDeTeste(comandos=[comando(tipo="dancar")])
    s = Sincronizador(cliente, tmp_path / "c.json")

    servico.passo(s, cliente)

    assert len(cliente.respostas) == 1
    assert "desconhecido" in cliente.respostas[0]["erro"]
    assert cliente.respostas[0]["resultado"] is None


def test_ponto_que_nao_existe_responde_em_vez_de_calar(tmp_path):
    cliente = ClienteDeTeste(comandos=[comando(ponto_id="fantasma")])
    s = Sincronizador(cliente, tmp_path / "c.json")

    servico.passo(s, cliente)

    assert "fantasma" in cliente.respostas[0]["erro"]


def test_ponto_novo_dispara_uma_puxada_antes_de_desistir(tmp_path):
    """Cadastrar a câmera e pedir o preview em seguida é o caso comum.

    A configuração local fica um instante atrás da nuvem; puxar de novo
    custa uma requisição e resolve.
    """
    cliente = ClienteDeTeste(comandos=[comando(ponto_id="p1")])
    s = Sincronizador(cliente, tmp_path / "c.json")
    s.config = None  # como se ainda não tivesse nada

    servico.passo(s, cliente)

    assert cliente.puxadas >= 1


def test_falha_da_captura_vira_resposta_de_erro(tmp_path, monkeypatch):
    # Comando que fracassa em silêncio deixa a tela girando, e quem está
    # lá não distingue "a câmera caiu" de "o agente nem recebeu".
    cliente = ClienteDeTeste(comandos=[comando()])
    s = Sincronizador(cliente, tmp_path / "c.json")

    def explodir(ponto):
        raise servico.ErroDoComando("canal 1 não abriu: timeout no RTSP")

    monkeypatch.setattr(servico, "capturar_quadro", explodir)
    servico.passo(s, cliente)

    assert "timeout no RTSP" in cliente.respostas[0]["erro"]


def test_excecao_inesperada_tambem_vira_resposta_e_nao_derruba(tmp_path, monkeypatch):
    cliente = ClienteDeTeste(comandos=[comando()])
    s = Sincronizador(cliente, tmp_path / "c.json")

    def explodir(ponto):
        raise RuntimeError("algo que ninguém previu")

    monkeypatch.setattr(servico, "capturar_quadro", explodir)
    servico.passo(s, cliente)

    assert "RuntimeError" in cliente.respostas[0]["erro"]
    assert "ninguém previu" in cliente.respostas[0]["erro"]


def test_captura_boa_responde_com_a_imagem(tmp_path, monkeypatch):
    cliente = ClienteDeTeste(comandos=[comando()])
    s = Sincronizador(cliente, tmp_path / "c.json")

    monkeypatch.setattr(
        servico, "capturar_quadro",
        lambda ponto: {"imagemBase64": "abc", "largura": 1920, "altura": 1080},
    )
    servico.passo(s, cliente)

    r = cliente.respostas[0]
    assert r["erro"] is None
    assert r["resultado"]["largura"] == 1920


def test_falhar_ao_responder_nao_derruba_o_laco(tmp_path, monkeypatch):
    # Se a resposta se perde, o usuário vê o pedido parado — chato, mas
    # recuperável clicando de novo. Derrubar o agente seria pior.
    cliente = ClienteDeTeste(comandos=[comando()])
    cliente.erro_responder = ErroDaNuvem("rede caiu na hora de responder")
    s = Sincronizador(cliente, tmp_path / "c.json")

    monkeypatch.setattr(servico, "capturar_quadro", lambda ponto: {"imagemBase64": "x"})

    servico.passo(s, cliente)  # não pode levantar


def test_nuvem_fora_nao_impede_o_laco_de_rodar(tmp_path):
    cliente = ClienteDeTeste(erro_heartbeat=ErroDaNuvem("sem rede"))
    s = Sincronizador(cliente, tmp_path / "c.json")

    assert servico.passo(s, cliente) == 0
    assert cliente.respostas == []


def test_o_laco_sobrevive_a_defeito_interno(tmp_path, monkeypatch):
    """Último anteparo: chegar aqui é defeito, mas defeito não pode
    deixar a loja sem auditoria até alguém reiniciar."""
    s = Sincronizador(ClienteDeTeste(), tmp_path / "c.json")

    def explodir(*a, **k):
        raise RuntimeError("defeito no próprio passo")

    monkeypatch.setattr(servico, "passo", explodir)
    servico.laco(s, ClienteDeTeste(), intervalo=0, voltas=3)  # não pode levantar
