"""Os canais no navegador do PC de análise.

Três promessas, e é delas que estes testes cuidam:

- a página só abre NESTE computador;
- o canal só fica aberto enquanto alguém olha;
- o que a página recebe é a imagem e o nome do canal — o endereço do
  gravador e o usuário não saem do agente.
"""

from __future__ import annotations

import http.client
import json
import socket
import time
from datetime import datetime

import cv2
import numpy as np
import pytest

from farol_agent.configuracao import ConfigDaLoja, PontoConfig
from farol_agent.visor import ENDERECO, PAGINA, Canais, Visor


class LeitorFalso:
    """Faz o papel do leitor RTSP: entrega sempre um quadro novo."""

    def __init__(self, imagem=None, mudo: bool = False):
        self.imagem = imagem if imagem is not None else _cena()
        self.mudo = mudo
        self.parado = False

    def ultimo(self, idade_maxima_seg: float = 5.0):
        return None if self.mudo else (datetime.now(), self.imagem)

    def parar(self):
        self.parado = True


def _cena(largura=704, altura=480, semente=1):
    rng = np.random.default_rng(semente)
    return rng.integers(0, 255, (altura, largura, 3), dtype=np.uint8)


def _config(*pontos: PontoConfig) -> ConfigDaLoja:
    return ConfigDaLoja(loja_id="l1", loja_nome="Matriz", versao=1, pontos=list(pontos))


def _ponto(pid: str, nome: str, canal: int) -> PontoConfig:
    return PontoConfig(
        id=pid, nome=nome, canal=canal, setor="Cozinha",
        host="192.168.1.118", usuario="admin", segredo_ref="dvr-cozinha",
    )


BANCADA = _ponto("p1", "Bancada", 1)
MONTAGEM = _ponto("p4", "montagem 1", 4)


@pytest.fixture
def abertos():
    """`abrir` que anota cada leitor criado."""
    criados: dict[str, LeitorFalso] = {}

    def abrir(ponto: PontoConfig) -> LeitorFalso:
        criados[ponto.id] = LeitorFalso()
        return criados[ponto.id]

    abrir.criados = criados   # type: ignore[attr-defined]
    return abrir


# ───────────────────── só abre enquanto alguém olha ─────────────────────


def test_nenhum_canal_e_aberto_antes_de_alguem_pedir(abertos):
    canais = Canais(lambda: _config(BANCADA, MONTAGEM), abrir=abertos)

    canais.lista()

    assert abertos.criados == {}, "listar os canais não pode abrir câmera"


def test_o_canal_abre_no_primeiro_pedido_e_reaproveita_nos_seguintes(abertos):
    canais = Canais(lambda: _config(BANCADA, MONTAGEM), abrir=abertos)

    jpeg, estado, _ = canais.quadro("p1")
    primeiro = abertos.criados["p1"]
    canais.quadro("p1")

    assert estado == "ok"
    assert jpeg[:2] == b"\xff\xd8", "tem que ser um JPEG"
    assert abertos.criados["p1"] is primeiro, "o segundo pedido não pode abrir outra conexão"
    assert canais.abertos() == ["p1"], "só o canal pedido fica aberto"


def test_sem_ninguem_olhando_o_canal_e_fechado(abertos):
    canais = Canais(lambda: _config(BANCADA), abrir=abertos, ocioso_seg=0.05)
    canais.quadro("p1")
    time.sleep(0.1)

    fechados = canais.aposentar_ociosos()

    assert fechados == 1
    assert abertos.criados["p1"].parado is True
    assert canais.abertos() == []


def test_canal_que_segue_sendo_pedido_NAO_e_fechado(abertos):
    canais = Canais(lambda: _config(BANCADA), abrir=abertos, ocioso_seg=5)
    canais.quadro("p1")

    assert canais.aposentar_ociosos() == 0
    assert abertos.criados["p1"].parado is False


def test_canal_que_saiu_da_configuracao_e_fechado_na_hora(abertos):
    atual = {"c": _config(BANCADA, MONTAGEM)}
    canais = Canais(lambda: atual["c"], abrir=abertos, ocioso_seg=60)
    canais.quadro("p1")
    canais.quadro("p4")

    atual["c"] = _config(MONTAGEM)   # a Bancada foi excluída no console
    canais.aposentar_ociosos()

    assert abertos.criados["p1"].parado is True
    assert abertos.criados["p4"].parado is False
    assert canais.quadro("p1") is None, "canal excluído não existe mais para a página"


def test_fechar_para_todos_os_leitores(abertos):
    canais = Canais(lambda: _config(BANCADA, MONTAGEM), abrir=abertos)
    canais.quadro("p1")
    canais.quadro("p4")

    canais.fechar()

    assert all(l.parado for l in abertos.criados.values())


# ───────────────── a auditoria já tem o canal: não abre outro ─────────────────


def test_usa_o_quadro_da_auditoria_em_vez_de_abrir_segunda_conexao(abertos):
    emprestado = lambda pid: (datetime.now(), _cena()) if pid == "p1" else None   # noqa: E731
    canais = Canais(lambda: _config(BANCADA, MONTAGEM), abrir=abertos, emprestado=emprestado)

    jpeg, estado, _ = canais.quadro("p1")
    canais.quadro("p4")

    assert estado == "ok" and jpeg
    assert "p1" not in abertos.criados, "a auditoria já tinha este canal aberto"
    assert "p4" in abertos.criados, "o que a auditoria não tem, a página abre"


def test_quando_a_auditoria_passa_a_ter_o_canal_a_conexao_propria_e_fechada(abertos):
    tem = {"agora": False}
    emprestado = lambda pid: (datetime.now(), _cena()) if tem["agora"] else None   # noqa: E731
    canais = Canais(lambda: _config(BANCADA), abrir=abertos, emprestado=emprestado)
    canais.quadro("p1")
    proprio = abertos.criados["p1"]

    tem["agora"] = True   # um critério foi ligado neste canal
    canais.quadro("p1")

    assert proprio.parado is True
    assert canais.abertos() == []


def test_quem_empresta_estourando_nao_derruba_a_pagina(abertos):
    def emprestado(_pid):
        raise RuntimeError("auditoria remontando")

    canais = Canais(lambda: _config(BANCADA), abrir=abertos, emprestado=emprestado)

    _, estado, _ = canais.quadro("p1")

    assert estado == "ok"


# ─────────────────────────── os estados ───────────────────────────


def test_canal_que_ainda_nao_entregou_quadro_diz_abrindo():
    canais = Canais(lambda: _config(BANCADA), abrir=lambda p: LeitorFalso(mudo=True))

    jpeg, estado, _ = canais.quadro("p1")

    assert jpeg is None
    assert estado == "abrindo"


def test_tela_preta_do_gravador_e_mostrada_COM_o_aviso_de_sem_sinal():
    preta = np.zeros((480, 704, 3), dtype=np.uint8)
    canais = Canais(lambda: _config(BANCADA), abrir=lambda p: LeitorFalso(imagem=preta))

    jpeg, estado, detalhe = canais.quadro("p1")

    assert jpeg, "a imagem vai mesmo assim: é o que o gravador está mandando"
    assert estado == "sem_sinal"
    assert "preto" in detalhe


def test_canal_que_nao_abre_devolve_o_motivo_sem_estourar():
    def abrir(_ponto):
        raise RuntimeError("senha da câmera não encontrada: defina FAROL_DVR_SENHA")

    canais = Canais(lambda: _config(BANCADA), abrir=abrir)

    jpeg, estado, detalhe = canais.quadro("p1")

    assert jpeg is None
    assert estado == "erro"
    assert "FAROL_DVR_SENHA" in detalhe


def test_canal_inexistente_e_None(abertos):
    canais = Canais(lambda: _config(BANCADA), abrir=abertos)

    assert canais.quadro("nao-existe") is None
    assert canais.quadro("../../etc/passwd") is None
    assert abertos.criados == {}


def test_sem_configuracao_a_lista_vem_vazia_e_nada_estoura(abertos):
    canais = Canais(lambda: None, abrir=abertos)

    assert canais.lista() == {"loja": None, "canais": []}
    assert canais.quadro("p1") is None
    assert canais.aposentar_ociosos() == 0


# ───────────── o que sai do agente: imagem e nome, nada mais ─────────────


def test_a_lista_NAO_leva_endereco_usuario_nem_referencia_de_senha(abertos):
    canais = Canais(lambda: _config(MONTAGEM, BANCADA), abrir=abertos)

    lista = canais.lista()
    texto = json.dumps(lista)

    assert lista["loja"] == "Matriz"
    assert [c["canal"] for c in lista["canais"]] == [1, 4], "na ordem do gravador"
    assert set(lista["canais"][0]) == {"id", "nome", "canal", "setor", "criterios"}
    for proibido in ("192.168.1.118", "admin", "dvr-cozinha", "host", "usuario", "segredo"):
        assert proibido not in texto, f"a página não precisa de {proibido!r}"


def test_a_pagina_nao_busca_nada_fora_deste_computador():
    # PC de loja pode estar sem internet, e página local que carrega fonte ou
    # script de fora é página que vaza o fato de estar aberta.
    assert "http://" not in PAGINA
    assert "https://" not in PAGINA
    assert "<link" not in PAGINA and "src=\"//" not in PAGINA


# ─────────────────────────── o servidor ───────────────────────────


@pytest.fixture
def visor(abertos):
    v = Visor(lambda: _config(BANCADA, MONTAGEM), porta=0, abrir=abertos)
    assert v.iniciar()
    yield v
    v.parar()


def _pedir(visor: Visor, caminho: str, metodo: str = "GET", host: str | None = None):
    conexao = http.client.HTTPConnection(ENDERECO, visor.porta, timeout=5)
    try:
        conexao.putrequest(metodo, caminho, skip_host=True)
        conexao.putheader("Host", host or f"127.0.0.1:{visor.porta}")
        conexao.endheaders()
        r = conexao.getresponse()
        return r.status, dict(r.getheaders()), r.read()
    finally:
        conexao.close()


def test_o_servidor_escuta_SO_em_127_0_0_1(visor):
    assert visor._servidor.server_address[0] == "127.0.0.1"
    assert visor.endereco.startswith("http://127.0.0.1:")

    # E não há como pedir outra interface: o construtor não tem o parâmetro.
    import inspect

    assert "host" not in inspect.signature(Visor.__init__).parameters
    assert "endereco" not in inspect.signature(Visor.__init__).parameters


def test_a_pagina_abre_e_fala_portugues(visor):
    status, cabecalhos, corpo = _pedir(visor, "/")

    assert status == 200
    assert cabecalhos["Content-Type"].startswith("text/html")
    assert "canais desta loja" in corpo.decode("utf-8")


def test_a_pagina_so_executa_o_que_esta_NELA(visor):
    """No notebook de desenvolvimento o antivírus pendurava um script dele em
    toda página HTTP. A política manda o navegador recusar: só roda o script
    e o estilo cuja impressão digital é a desta página, e só fala com este
    endereço."""
    import base64
    import hashlib
    import re

    _, cabecalhos, corpo = _pedir(visor, "/")
    politica = cabecalhos["Content-Security-Policy"]
    html = corpo.decode("utf-8")

    assert "default-src 'none'" in politica
    assert "connect-src 'self'" in politica
    assert "unsafe-inline" not in politica and "unsafe-eval" not in politica
    for marca in ("script", "style"):
        (conteudo,) = re.findall(rf"<{marca}>(.*?)</{marca}>", html, flags=re.S)
        impressao = base64.b64encode(hashlib.sha256(conteudo.encode("utf-8")).digest()).decode()
        assert f"{marca}-src 'sha256-{impressao}'" in politica, f"a impressão do {marca} não bate"
    assert " style=" not in html, "estilo em atributo seria recusado pela política"


def test_o_pedido_do_icone_nao_vira_404(visor):
    assert _pedir(visor, "/favicon.ico")[0] == 204


def test_a_lista_de_canais_vem_em_json(visor):
    status, _, corpo = _pedir(visor, "/canais.json")

    assert status == 200
    d = json.loads(corpo)
    assert [c["nome"] for c in d["canais"]] == ["Bancada", "montagem 1"]


def test_o_quadro_vem_como_jpeg_do_tamanho_do_canal_e_sem_cache(visor):
    status, cabecalhos, corpo = _pedir(visor, "/canal/p1.jpg")

    assert status == 200
    assert cabecalhos["Content-Type"] == "image/jpeg"
    assert cabecalhos["Cache-Control"] == "no-store"
    assert cabecalhos["X-Farol-Estado"] == "ok"
    img = cv2.imdecode(np.frombuffer(corpo, np.uint8), cv2.IMREAD_COLOR)
    assert img.shape[:2] == (480, 704)


def test_canal_que_nao_existe_e_404_e_caminho_estranho_tambem(visor):
    assert _pedir(visor, "/canal/nao-existe.jpg")[0] == 404
    assert _pedir(visor, "/canal/..%2F..%2Fconfiguracao.json.jpg")[0] == 404
    assert _pedir(visor, "/configuracao.json")[0] == 404
    assert _pedir(visor, "/maquina.json")[0] == 404


def test_pedido_com_nome_de_outro_site_e_recusado(visor, abertos):
    # Uma página da internet pode apontar um nome dela para 127.0.0.1 e
    # fazer o navegador pedir aqui. O nome chega no cabeçalho Host.
    status, _, corpo = _pedir(visor, "/canal/p1.jpg", host=f"site-de-fora.com:{visor.porta}")

    assert status == 403
    assert b"\xff\xd8" not in corpo
    assert abertos.criados == {}, "e a câmera nem é aberta"


def test_localhost_tambem_vale(visor):
    assert _pedir(visor, "/", host=f"localhost:{visor.porta}")[0] == 200


def test_so_leitura_nada_de_POST(visor):
    assert _pedir(visor, "/canais.json", metodo="POST")[0] == 501
    assert _pedir(visor, "/canal/p1.jpg", metodo="DELETE")[0] == 501


def test_dezesseis_canais_ao_mesmo_tempo(abertos):
    # O motivo de não ser MJPEG: o navegador revezaria seis conexões entre
    # dezesseis fluxos contínuos. Aqui dezesseis pedidos curtos têm que passar.
    import threading

    pontos = [_ponto(f"p{i}", f"Canal {i}", i) for i in range(1, 17)]
    v = Visor(lambda: _config(*pontos), porta=0, abrir=abertos)
    assert v.iniciar()
    try:
        resultados: list[int] = []

        def um(i: int):
            for _ in range(5):
                resultados.append(_pedir(v, f"/canal/p{i}.jpg")[0])

        linhas = [threading.Thread(target=um, args=(i,)) for i in range(1, 17)]
        for t in linhas:
            t.start()
        for t in linhas:
            t.join(timeout=20)

        assert resultados.count(200) == 80, resultados
        assert len(abertos.criados) == 16, "um leitor por canal, não um por pedido"
    finally:
        v.parar()


def test_porta_ocupada_nao_derruba_o_agente(abertos):
    ocupada = socket.socket()
    ocupada.bind((ENDERECO, 0))
    ocupada.listen(1)
    try:
        v = Visor(lambda: _config(BANCADA), porta=ocupada.getsockname()[1], abrir=abertos)

        assert v.iniciar() is False
        v.parar()   # parar o que não subiu também não pode estourar
    finally:
        ocupada.close()


def test_parar_fecha_os_canais_abertos(abertos):
    v = Visor(lambda: _config(BANCADA), porta=0, abrir=abertos)
    assert v.iniciar()
    _pedir(v, "/canal/p1.jpg")

    v.parar()

    assert abertos.criados["p1"].parado is True
