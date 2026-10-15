"""A gravação de treino, do lado da loja (A21, fatia T3a): o que ler, o andamento e o que apagar.

O que atravessa a fronteira está em `contratos/gravacao-de-treino.json`, lido
também por `api/testes/treino-gravacao.test.ts`. O que se protege aqui:

- a lista do contrato vira as gravações e o que apagar, com as mesmas chaves;
- os corpos do andamento são exatamente os do contrato;
- cada recusa do contrato tem o destino que ele diz;
- a próxima a ler: a que já estava lendo; depois a mais antiga que acabou e assentou;
- o disco só perde o que a nuvem mandou apagar, e só dentro da pasta do treino;
- tudo isto dorme: o agente ainda não declara "treino".
"""

from __future__ import annotations

import json
import threading
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

from farol_agent import nuvem as cliente_da_nuvem
from farol_agent import treino
from farol_agent.nuvem import ClienteNuvem, ErroDaNuvem

CONTRATO = json.loads((Path(__file__).resolve().parents[2] / "contratos" / "gravacao-de-treino.json").read_text(encoding="utf-8"))
LISTA = CONTRATO["lista"]["resposta"]
CORPOS = CONTRATO["andamento"]["corpos"]

AGORA = datetime(2026, 10, 15, 21, 0, 0, tzinfo=timezone.utc)


def gravacao(chave: str, inicio: str, fim: str, situacao: str = "fila") -> treino.Gravacao:
    return treino.Gravacao(
        id=f"id-{chave}",
        chave=chave,
        ponto_id=None,
        canal=4,
        inicio=datetime.fromisoformat(inicio),
        fim=datetime.fromisoformat(fim),
        origem="gravador",
        situacao=situacao,
    )


G = gravacao("console-1", "2026-10-15T19:30:00+00:00", "2026-10-15T20:00:00+00:00")


# ───────────────────────────── o contrato ─────────────────────────────


def test_a_lista_do_contrato_vira_as_gravacoes_e_o_que_apagar():
    gravacoes, apagar = treino.ler_lista(LISTA)
    exemplo = LISTA["gravacoes"][0]
    assert sorted(exemplo) == sorted(CONTRATO["lista"]["chaves"]), "o exemplo tem as chaves que o contrato lista"
    assert len(gravacoes) == len(LISTA["gravacoes"])
    g = gravacoes[0]
    assert (g.id, g.chave, g.ponto_id, g.canal, g.origem, g.situacao) == (
        exemplo["id"], exemplo["chave"], exemplo["pontoId"], exemplo["canal"], exemplo["origem"], exemplo["situacao"],
    )
    assert g.inicio == datetime(2026, 10, 15, 19, 30, tzinfo=timezone.utc)
    assert g.fim == datetime(2026, 10, 15, 20, 0, tzinfo=timezone.utc)
    assert apagar == LISTA["apagar"]


def test_as_situacoes_e_os_andamentos_sao_os_do_contrato():
    assert set(treino.ATIVAS) <= set(CONTRATO["situacoes"])
    assert {treino.LENDO, treino.PRONTA, treino.FALHOU} == set(CORPOS)
    assert treino.MAX_MOTIVO == 200


def test_os_corpos_do_andamento_sao_exatamente_os_do_contrato():
    mandados = []
    a = treino.Andamento(G, lambda gid, corpo: mandados.append((gid, corpo)))
    assert a.lendo(CORPOS["lendo"]["progresso"]) == treino.SEGUIR
    assert a.pronta() == treino.SEGUIR
    assert a.falhou(CORPOS["falhou"]["motivo"]) == treino.SEGUIR
    assert mandados == [(G.id, CORPOS["lendo"]), (G.id, CORPOS["pronta"]), (G.id, CORPOS["falhou"])]


# Cada recusa do contrato, pelo status, e o que a loja faz nela.
DESTINO_DA_RECUSA = {
    401: treino.CREDENCIAL,  # "para e avisa: o token não vale"
    404: treino.ESQUECER,  # "esquece a gravação"
    409: treino.PARAR,  # "para de ler e apaga o que guardou dela"
    422: treino.RECUSADO,  # "não repete: é erro de quem mandou"
}


def test_cada_recusa_do_contrato_tem_o_destino_que_ele_diz():
    assert {r["status"] for r in CONTRATO["recusas"]} == set(DESTINO_DA_RECUSA)
    for r in CONTRATO["recusas"]:
        def recusar(gid, corpo, status=r["status"]):
            raise ErroDaNuvem(f"{status} em /andamento", recuperavel=False, status=status)

        assert treino.Andamento(G, recusar).pronta() == DESTINO_DA_RECUSA[r["status"]], r["quando"]


@pytest.mark.parametrize("status", [0, 429, 500, 502, 503])
def test_rede_e_erro_do_servidor_sao_de_passagem(status):
    def falhar(gid, corpo):
        raise ErroDaNuvem("caiu", status=status)

    assert treino.Andamento(G, falhar).lendo(10) == treino.DEPOIS


def test_403_tambem_e_credencial():
    def recusar(gid, corpo):
        raise ErroDaNuvem("403", recuperavel=False, status=403)

    assert treino.Andamento(G, recusar).pronta() == treino.CREDENCIAL


# ───────────────────────────── o andamento ─────────────────────────────


def test_a_porcentagem_so_sobe_quando_anda_e_lendo_nunca_diz_100():
    mandados = []
    a = treino.Andamento(G, lambda gid, corpo: mandados.append(corpo["progresso"]))
    for p in (0, 3, 4.9, 5, 7, 9.99, 10, 150):
        a.lendo(p)
    assert mandados == [0, 5, 10, 99]
    a.lendo(-20)
    assert mandados == [0, 5, 10, 99], "voltar atrás não sobe"


def test_a_porcentagem_que_nao_entrou_e_mandada_de_novo():
    tentativas = []

    def contar(gid, corpo):
        tentativas.append(corpo["progresso"])
        if len(tentativas) == 1:
            raise ErroDaNuvem("caiu")

    a = treino.Andamento(G, contar)
    assert a.lendo(20) == treino.DEPOIS
    assert a.lendo(21) == treino.SEGUIR
    assert tentativas == [20, 21]


def test_o_motivo_da_falha_cabe_e_nunca_vai_vazio():
    mandados = []
    a = treino.Andamento(G, lambda gid, corpo: mandados.append(corpo["motivo"]))
    a.falhou("o gravador\n  não tinha    mais esse horário")
    a.falhou("x" * 500)
    a.falhou("   ")
    assert mandados[0] == "o gravador não tinha mais esse horário"
    assert len(mandados[1]) == treino.MAX_MOTIVO
    assert mandados[2]


# ───────────────────────────── a próxima ─────────────────────────────


def test_a_proxima_e_a_que_ja_estava_lendo():
    lista = [
        gravacao("velha", "2026-10-15T18:00:00+00:00", "2026-10-15T18:30:00+00:00", "fila"),
        gravacao("em-curso", "2026-10-15T19:00:00+00:00", "2026-10-15T19:30:00+00:00", "lendo"),
    ]
    assert treino.proxima(lista, AGORA).chave == "em-curso"


def test_depois_a_mais_antiga_que_acabou_e_assentou():
    lista = [
        gravacao("programada-pronta", "2026-10-15T20:00:00+00:00", "2026-10-15T20:30:00+00:00", "programada"),
        gravacao("fila-mais-antiga", "2026-10-15T19:00:00+00:00", "2026-10-15T19:30:00+00:00", "fila"),
        gravacao("ainda-vai-acontecer", "2026-10-15T21:30:00+00:00", "2026-10-15T22:00:00+00:00", "programada"),
    ]
    assert treino.proxima(lista, AGORA).chave == "fila-mais-antiga"
    assert treino.proxima(lista[:1] + lista[2:], AGORA).chave == "programada-pronta"


def test_a_que_acabou_agora_espera_a_gravacao_assentar():
    acabou_agora = gravacao("acabou-agora", "2026-10-15T20:30:00+00:00", "2026-10-15T20:58:30+00:00", "programada")
    assert treino.proxima([acabou_agora], AGORA) is None, "faltam 90 s para os 3 minutos de folga"
    assert treino.proxima([acabou_agora], AGORA + timedelta(seconds=90)).chave == "acabou-agora"
    assert treino.proxima([acabou_agora], AGORA, folga_s=60).chave == "acabou-agora", "a folga é a do perfil do gravador"
    assert treino.proxima([], AGORA) is None


# ───────────────────────────── a lista, tolerante ─────────────────────────────


def test_a_lista_torta_fica_de_fora_sem_derrubar_a_boa():
    boa = LISTA["gravacoes"][0]
    corpo = {
        "gravacoes": [
            boa,
            "texto",
            {**boa, "id": ""},
            {**boa, "chave": "../fora"},
            {**boa, "chave": "a/b"},
            {**boa, "inicio": "ontem"},
            {**boa, "inicio": "2026-10-15T19:30:00"},
            {**boa, "fim": boa["inicio"]},
            {**boa, "situacao": "pronta"},
            {**boa, "canal": True},
            {**boa, "canal": "4"},
        ],
        "apagar": ["carga-1", "..", "../fora", "a/b", "", None, 7, "console-0b1c"],
    }
    gravacoes, apagar = treino.ler_lista(corpo)
    assert [g.chave for g in gravacoes] == [boa["chave"]]
    assert apagar == ["carga-1", "console-0b1c"]
    assert treino.ler_lista("nada") == ([], [])
    assert treino.ler_lista({}) == ([], [])


def test_sem_ponto_e_sem_canal_a_gravacao_ainda_vale():
    boa = {**LISTA["gravacoes"][0], "pontoId": None, "canal": None}
    [g], _ = treino.ler_lista({"gravacoes": [boa], "apagar": []})
    assert (g.ponto_id, g.canal) == (None, None)


def test_perguntar_sem_nuvem_nao_muda_nada():
    def fora():
        raise ErroDaNuvem("não cheguei na nuvem")

    assert treino.perguntar(fora) is None
    assert treino.perguntar(lambda: LISTA)[1] == LISTA["apagar"]


# ───────────────────────────── o disco ─────────────────────────────


def test_o_disco_so_perde_o_que_a_nuvem_mandou_e_so_dentro_da_pasta_do_treino(tmp_path):
    raiz = tmp_path / "treino"
    for chave in ("carga-1", "console-2", "fica"):
        (raiz / chave).mkdir(parents=True)
        (raiz / chave / "quadro.jpg").write_bytes(b"x")
    fora = tmp_path / "fora"
    fora.mkdir()
    (fora / "importante.txt").write_text("não pode sair")
    (raiz / "um-arquivo").write_text("não é pasta")

    saiu = treino.apagar_do_disco(raiz, ["carga-1", "..", "../fora", "a/b", "", "nao-existe", "um-arquivo", "console-2"])
    assert saiu == ["carga-1", "console-2"]
    assert sorted(p.name for p in raiz.iterdir()) == ["fica", "um-arquivo"]
    assert (fora / "importante.txt").read_text() == "não pode sair"
    assert treino.apagar_do_disco(raiz, ["carga-1"]) == [], "apagar o que não existe não é erro"


def test_a_pasta_da_gravacao_fica_dentro_da_raiz(tmp_path):
    assert treino.pasta_da_gravacao(tmp_path, "console-1") == (tmp_path / "console-1").resolve()
    assert treino.pasta_da_gravacao(tmp_path, "a..b") == (tmp_path / "a..b").resolve(), "dois pontos no meio do nome não saem da pasta"
    for torta in ("..", "../x", "a/b", "a\\b", "", ".escondida", "x" * 101, None, 7):
        assert treino.pasta_da_gravacao(tmp_path, torta) is None, torta


def test_atalho_para_fora_da_pasta_do_treino_nao_e_seguido(tmp_path):
    raiz = tmp_path / "treino"
    raiz.mkdir()
    fora = tmp_path / "fora"
    fora.mkdir()
    (fora / "importante.txt").write_text("não pode sair")
    try:
        (raiz / "console-1").symlink_to(fora, target_is_directory=True)
    except OSError:
        # No Windows sem o modo de desenvolvedor, o atalho de pasta que não pede permissão é a junção.
        try:
            import _winapi

            _winapi.CreateJunction(str(fora), str(raiz / "console-1"))
        except (ImportError, OSError):
            pytest.skip("esta máquina não deixa criar atalho de pasta")
    assert treino.pasta_da_gravacao(raiz, "console-1") is None
    assert treino.apagar_do_disco(raiz, ["console-1"]) == []
    assert (fora / "importante.txt").read_text() == "não pode sair"


def test_o_arquivo_solto_com_nome_de_chave_nao_e_apagado_nem_vira_aviso(tmp_path, caplog):
    raiz = tmp_path / "treino"
    raiz.mkdir()
    (raiz / "console-1").write_text("um arquivo, não uma pasta")
    with caplog.at_level("WARNING", logger="farol_agent.treino"):
        assert treino.apagar_do_disco(raiz, ["console-1"]) == []
    assert (raiz / "console-1").exists()
    assert not caplog.records


# ───────────────────────────── pela rede de verdade ─────────────────────────────


class _Servidor:
    """A nuvem de mentira: responde a lista do contrato e o andamento com o status pedido."""

    def __init__(self):
        self.pedidos: list[tuple[str, str, dict | None, str | None]] = []
        self.status_do_andamento = 200
        dono = self

        class Tratador(BaseHTTPRequestHandler):
            def _responder(self, status: int, corpo: dict):
                bruto = json.dumps(corpo).encode("utf-8")
                self.send_response(status)
                self.send_header("content-type", "application/json; charset=utf-8")
                self.send_header("content-length", str(len(bruto)))
                self.end_headers()
                self.wfile.write(bruto)
                self.close_connection = True

            def do_GET(self):  # noqa: N802
                dono.pedidos.append(("GET", self.path, None, self.headers.get("authorization")))
                self._responder(200, LISTA)

            def do_POST(self):  # noqa: N802
                tamanho = int(self.headers.get("content-length") or 0)
                corpo = json.loads(self.rfile.read(tamanho) or b"null")
                dono.pedidos.append(("POST", self.path, corpo, self.headers.get("authorization")))
                if dono.status_do_andamento == 200:
                    self._responder(200, {"situacao": corpo.get("situacao")})
                else:
                    self._responder(dono.status_do_andamento, {"erro": "encerrada", "mensagem": "a gravação já foi encerrada"})

            def log_message(self, *a):
                pass

        self._http = HTTPServer(("127.0.0.1", 0), Tratador)
        self.url = f"http://127.0.0.1:{self._http.server_address[1]}"
        self._linha = threading.Thread(target=self._http.serve_forever, daemon=True)
        self._linha.start()

    def fechar(self):
        self._http.shutdown()
        self._http.server_close()
        self._linha.join(5)


@pytest.fixture
def servidor():
    s = _Servidor()
    yield s
    s.fechar()


def test_pela_rede_a_lista_e_o_andamento_vao_pelas_rotas_do_contrato(servidor):
    cliente = ClienteNuvem(servidor.url, "token-da-loja")
    gravacoes, apagar = treino.perguntar(cliente.gravacoes_de_treino)
    assert apagar == LISTA["apagar"]
    a = treino.Andamento(gravacoes[0], cliente.andamento_da_gravacao)
    assert a.lendo(40) == treino.SEGUIR
    assert a.pronta() == treino.SEGUIR

    rota_do_andamento = CONTRATO["andamento"]["rota"].split(" ", 1)[1].replace(":id", gravacoes[0].id)
    assert servidor.pedidos == [
        ("GET", CONTRATO["lista"]["rota"].split(" ", 1)[1], None, "Bearer token-da-loja"),
        ("POST", rota_do_andamento, CORPOS["lendo"], "Bearer token-da-loja"),
        ("POST", rota_do_andamento, CORPOS["pronta"], "Bearer token-da-loja"),
    ]


def test_pela_rede_o_409_manda_parar(servidor):
    cliente = ClienteNuvem(servidor.url, "tok")
    servidor.status_do_andamento = 409
    assert treino.Andamento(G, cliente.andamento_da_gravacao).lendo(10) == treino.PARAR


# ───────────────────────────── dormindo ─────────────────────────────


def test_tudo_isto_dorme_o_agente_ainda_nao_declara_treino():
    # Quando a leitura da bancada (T3c) entrar, o agente passa a declarar "treino" — e a tela deixa de avisar.
    assert "treino" not in cliente_da_nuvem.SABE
