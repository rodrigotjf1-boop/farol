"""Buscar no gravador o trecho de uma gravação de treino (A21, fatia T3b).

O gravador aqui é de mentira, mas faz a MESMA conta do cliente de verdade
(`pedido_que_cobre`) e recusa, como ele, o pedido que cobre mais de 40 s. O
pedido de verdade (a senha, a vez, o tamanho declarado) é provado em
`test_dvr_arquivo.py`. O que se protege aqui:

- os pedaços cobrem a gravação inteira, alinhados aos blocos, cada um num pedido aceito;
- a hora: o instante da nuvem vira a hora do computador e, com a diferença medida, a do gravador;
- só o que assentou é pedido; fora da hora, a busca para;
- a busca retoma de onde parou — também depois de o agente reiniciar — e não pede de novo o que veio;
- cada erro do gravador tem o seu destino;
- o disco com pouco espaço para a busca.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from farol_agent import treino_trecho as tt
from farol_agent.dvr.arquivo import (
    MAIOR_TRECHO,
    ClienteDeArquivo,
    GravadorOcupado,
    PedidoRecusado,
    PerfilDeArquivo,
    SemGravacao,
    Trecho,
    pedido_que_cobre,
)
from farol_agent.dvr.dahua import ErroDoGravador

# A gravação: 19:30:00 a 19:32:00 de 15/10 na hora do computador (-03:00), que a nuvem manda em UTC.
INICIO = datetime(2026, 10, 15, 22, 30, 0, tzinfo=timezone.utc)
FIM = datetime(2026, 10, 15, 22, 32, 0, tzinfo=timezone.utc)
BRASILIA = timezone(timedelta(hours=-3))


def no_computador(t: datetime) -> datetime:
    return t.astimezone(BRASILIA).replace(tzinfo=None)


ADIANTADO = timedelta(seconds=25)
# O gravador começa o trecho às 19:30:25 da hora dele.
LA = datetime(2026, 10, 15, 19, 30, 25)
# Bem depois de a gravação assentar (hora do computador).
DEPOIS = datetime(2026, 10, 15, 20, 0, 0)


class GravadorDeMentira:
    host = "gravador-de-mentira"
    ja_gravado = ClienteDeArquivo.ja_gravado
    espera_ate_gravar = ClienteDeArquivo.espera_ate_gravar

    def __init__(self, *, bloco: int | None = 2, desvio: int = 0, sem: tuple[datetime, ...] = (), falhas: dict | None = None):
        self.perfil = PerfilDeArquivo(bloco_s=bloco, atraso_s=180.0, desvio_s=desvio)
        self.sem = set(sem)
        self.falhas = dict(falhas or {})
        self.recusa = False
        self.ocupado = False
        self.relogio_falha: Exception | None = None
        self.pedidos: list[tuple[int, datetime, datetime]] = []

    def relogio(self) -> timedelta:
        if self.relogio_falha is not None:
            raise self.relogio_falha
        return ADIANTADO

    def baixar(self, canal: int, de: datetime, ate: datetime, destino: Path) -> Trecho:
        pedido = pedido_que_cobre(de, ate, self.perfil.bloco_s, self.perfil.desvio_s)
        if pedido.cobre_ate - pedido.comeco > MAIOR_TRECHO:
            raise ValueError("trecho de no máximo 40 segundos por pedido")
        if self.recusa:
            raise PedidoRecusado("o gravador recusou a credencial")
        if self.ocupado:
            raise GravadorOcupado("outro pedido está na vez")
        self.pedidos.append((canal, de, ate))
        if de in self.sem:
            raise SemGravacao("o gravador respondeu sem nenhum byte de gravação nesse trecho")
        if self.falhas.get(de, 0) > 0:
            self.falhas[de] -= 1
            raise ErroDoGravador("o trecho veio cortado: 10 de 20 bytes")
        destino.write_bytes(b"\x00dav" * 8)
        return Trecho(
            canal=canal, de=pedido.comeco, ate=pedido.cobre_ate, blocos=pedido.blocos, caminho=destino, tamanho=32,
            declarado=32, tipo="application/octet-stream", ate_o_primeiro_byte_s=0.1, total_s=0.2,
        )


def buscar(gravador, pasta, **kw):
    kw.setdefault("pode_buscar", lambda: True)
    kw.setdefault("agora", lambda: DEPOIS)
    kw.setdefault("para_o_computador", no_computador)
    kw.setdefault("disco_minimo", 0)
    return tt.buscar_trecho(gravador, kw.pop("canal", 4), INICIO, FIM, pasta, **kw)


# ───────────────────────────── os pedaços ─────────────────────────────


def test_os_pedacos_cobrem_a_gravacao_inteira_alinhados_e_cada_um_cabe_num_pedido():
    de, ate = datetime(2026, 10, 15, 19, 30, 25), datetime(2026, 10, 15, 20, 0, 25)
    lista = tt.pedacos(de, ate, 2)
    assert lista[0][0] == datetime(2026, 10, 15, 19, 30, 24), "o primeiro começa no bloco em que a gravação começa"
    assert lista[-1][1] == ate
    assert all(a == b for (_, a), (b, _) in zip(lista, lista[1:])), "sem buraco nem sobra entre os pedaços"
    for p_de, p_ate in lista:
        pedido = pedido_que_cobre(p_de, p_ate, 2)
        assert pedido.cobre_ate - pedido.comeco <= MAIOR_TRECHO
    assert len(lista) == 46  # 30 min e 1 s desde o bloco, em pedaços de 40 s


@pytest.mark.parametrize("bloco,desvio", [(2, 0), (2, 1), (3, 0), (5, 2), (None, 0)])
def test_qualquer_perfil_de_gravador_da_pedidos_aceitos(bloco, desvio):
    de, ate = datetime(2026, 10, 15, 19, 30, 25, 400000), datetime(2026, 10, 15, 19, 47, 13, 900000)
    lista = tt.pedacos(de, ate, bloco, desvio)
    assert lista[0][0] <= de and lista[-1][1] == ate
    for p_de, p_ate in lista:
        pedido = pedido_que_cobre(p_de, p_ate, bloco, desvio)
        assert pedido.cobre_ate - pedido.comeco <= MAIOR_TRECHO, (bloco, desvio, p_de)


def test_o_passo_e_o_maior_multiplo_do_bloco_que_cabe():
    assert tt.passo_do_pedaco(2) == timedelta(seconds=40)
    assert tt.passo_do_pedaco(3) == timedelta(seconds=39)
    assert tt.passo_do_pedaco(None) == MAIOR_TRECHO
    assert tt.pedacos(LA, LA, 2) == []


# ───────────────────────────── a busca ─────────────────────────────


def test_a_busca_pede_na_hora_do_gravador_e_guarda_cada_pedaco(tmp_path):
    g = GravadorDeMentira()
    andou = []
    b = buscar(g, tmp_path, ao_andar=lambda busca: andou.append(busca.fracao))
    assert b.completa and b.ok == b.total == 4 and b.fracao == 1.0
    assert g.pedidos[0] == (4, datetime(2026, 10, 15, 19, 30, 24), datetime(2026, 10, 15, 19, 31, 4))
    assert g.pedidos[-1][2] == LA + timedelta(minutes=2), "termina no fim da gravação, na hora do gravador"
    assert sorted(p.name for p in tmp_path.glob("*.dav")) == [f"{de:%Y%m%dT%H%M%S}.dav" for _, de, _ in g.pedidos]
    assert andou == [0.25, 0.5, 0.75, 1.0]


def test_a_busca_retoma_de_onde_parou_mesmo_depois_de_reiniciar(tmp_path):
    g = GravadorDeMentira()
    vezes = iter([True, True, False])
    b = buscar(g, tmp_path, pode_buscar=lambda: next(vezes, False))
    assert (b.parou, b.ok) == (tt.FORA_DA_HORA, 2)

    outro = GravadorDeMentira()  # o agente reiniciou: só o manifesto em disco sabe o que veio
    b = buscar(outro, tmp_path)
    assert b.completa and b.ok == 4
    assert len(outro.pedidos) == 2, "os dois que já tinham vindo não são pedidos de novo"


def test_o_pedaco_que_sumiu_do_disco_e_pedido_de_novo(tmp_path):
    buscar(GravadorDeMentira(), tmp_path)
    primeiro = sorted(tmp_path.glob("*.dav"))[0]
    primeiro.unlink()
    g = GravadorDeMentira()
    assert buscar(g, tmp_path).ok == 4
    assert [f"{de:%Y%m%dT%H%M%S}.dav" for _, de, _ in g.pedidos] == [primeiro.name]


def test_so_o_que_assentou_e_pedido(tmp_path):
    # Às 19:34:00 daqui são 19:34:25 no gravador: com 180 s para assentar, só o pedaço que termina até 19:31:25
    # (o primeiro, até 19:31:04). O último termina às 19:32:25 do gravador: só às 19:35:25 dele (19:35:00 aqui).
    g = GravadorDeMentira()
    b = buscar(g, tmp_path, agora=lambda: datetime(2026, 10, 15, 19, 34, 0))
    assert (b.parou, b.ok) == (tt.AINDA_NAO_ASSENTOU, 1)
    assert buscar(g, tmp_path, agora=lambda: datetime(2026, 10, 15, 19, 34, 59)).ok == 3
    assert buscar(g, tmp_path, agora=lambda: datetime(2026, 10, 15, 19, 35, 0)).completa


def test_fora_da_hora_nada_e_pedido(tmp_path):
    g = GravadorDeMentira()
    b = buscar(g, tmp_path, pode_buscar=lambda: False)
    assert (b.parou, b.ok, g.pedidos) == (tt.FORA_DA_HORA, 0, [])


def test_o_pedaco_sem_gravacao_e_anotado_e_a_busca_segue(tmp_path):
    g = GravadorDeMentira(sem=(datetime(2026, 10, 15, 19, 31, 4),))
    b = buscar(g, tmp_path)
    assert b.completa and (b.ok, b.sem_gravacao) == (3, 1)
    nova = GravadorDeMentira()
    buscar(nova, tmp_path)
    assert nova.pedidos == [], "o pedaço sem gravação não é pedido de novo: o gravador não o tem"


def test_o_erro_de_passagem_tenta_de_novo_e_na_terceira_o_pedaco_fica_de_fora(tmp_path):
    cortado = datetime(2026, 10, 15, 19, 31, 4)
    g = GravadorDeMentira(falhas={cortado: 5})
    b = buscar(g, tmp_path)
    assert (b.parou, b.ok) == (tt.GRAVADOR, 1) and "cortado" in b.detalhe
    assert buscar(g, tmp_path).parou == tt.GRAVADOR
    b = buscar(g, tmp_path)
    assert b.completa and (b.ok, b.falhos) == (3, 1)
    assert [de for _, de, _ in g.pedidos].count(cortado) == tt.TENTATIVAS_POR_PEDACO


def test_o_gravador_ocupado_para_sem_contar_tentativa(tmp_path):
    g = GravadorDeMentira()
    g.ocupado = True
    assert buscar(g, tmp_path).parou == tt.GRAVADOR_OCUPADO
    g.ocupado = False
    assert buscar(g, tmp_path).completa


def test_a_senha_recusada_para_tudo(tmp_path):
    g = GravadorDeMentira()
    g.recusa = True
    b = buscar(g, tmp_path)
    assert (b.parou, b.ok) == (tt.SENHA_RECUSADA, 0)
    g2 = GravadorDeMentira()
    g2.relogio_falha = PedidoRecusado("recusou")
    assert buscar(g2, tmp_path).parou == tt.SENHA_RECUSADA


def test_sem_a_hora_do_gravador_a_busca_espera(tmp_path):
    g = GravadorDeMentira()
    g.relogio_falha = ErroDoGravador("não alcancei o gravador")
    b = buscar(g, tmp_path)
    assert (b.parou, g.pedidos) == (tt.GRAVADOR, [])


def test_sem_canal_nao_ha_o_que_buscar(tmp_path):
    for canal in (None, 0):
        b = buscar(GravadorDeMentira(), tmp_path, canal=canal)
        assert b.parou == tt.SEM_CANAL


def test_com_pouco_disco_a_busca_para(tmp_path):
    g = GravadorDeMentira()
    b = buscar(g, tmp_path, disco_minimo=10**18)
    assert (b.parou, g.pedidos) == (tt.DISCO, [])


def test_o_manifesto_torto_e_lido_como_vazio(tmp_path):
    (tmp_path / tt.MANIFESTO).write_text("{isto não é json", encoding="utf-8")
    assert buscar(GravadorDeMentira(), tmp_path).ok == 4
    dados = json.loads((tmp_path / tt.MANIFESTO).read_text(encoding="utf-8"))
    assert dados["formato"] == tt.FORMATO_DO_MANIFESTO and len(dados["pedacos"]) == 4
    assert not list(tmp_path.glob("*.novo")), "a troca do manifesto não deixa o arquivo de passagem"


def test_o_manifesto_de_outro_formato_nao_vale(tmp_path):
    buscar(GravadorDeMentira(), tmp_path)
    dados = json.loads((tmp_path / tt.MANIFESTO).read_text(encoding="utf-8"))
    (tmp_path / tt.MANIFESTO).write_text(json.dumps({**dados, "formato": 99}), encoding="utf-8")
    g = GravadorDeMentira()
    assert buscar(g, tmp_path).ok == 4
    assert len(g.pedidos) == 4, "o manifesto que este agente não sabe ler não diz o que já veio"


def test_a_hora_do_computador_padrao_e_a_do_fuso_da_maquina():
    t = datetime(2026, 10, 15, 22, 30, tzinfo=timezone.utc)
    assert tt._local(t) == t.astimezone().replace(tzinfo=None)
    assert tt._local(datetime(2026, 10, 15, 19, 30)) == datetime(2026, 10, 15, 19, 30)
