"""Medir o que o gravador entrega pelo caminho de arquivo, e guardar na máquina.

O gravador aqui é de mentira e sem rede: o que se prova é a CONTA da medida
— dado um gravador que entrega em blocos de um certo jeito, o perfil que sai
é o dele? O pedido de verdade (a senha, a vez, o tamanho declarado) é provado
em `test_dvr_arquivo.py`.

O gravador de mentira segue o que foi medido no da loja de teste em
10/10/2026: da gravação assentada, devolve os blocos que COMEÇAM dentro do
pedido. Há também os que entregam de outro jeito, para provar que a medida
não os engole.

O que tem de ficar provado:

- o bloco, onde ele começa e a taxa saem do gravador, não do motor;
- a medida usa gravação de dez minutos atrás, na hora do GRAVADOR;
- gravador que entrega de outro jeito sai SEM bloco, e isso é dito;
- credencial recusada no meio acaba a medida: nenhum pedido a mais;
- os trechos da medida não ficam no disco;
- o perfil guardado é o que se lê de volta, e número impossível não é usado.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path

import pytest

from farol_agent.dvr.arquivo import ATRASO_DE_CAUTELA, PedidoRecusado, PerfilDeArquivo, SemGravacao, pedido_que_cobre
from farol_agent.sequencia import perfil
from farol_agent.sequencia.perfil import Medida, MedidaIncompleta, arquivo_ao_lado, guardar, ler, medir, quando_foi_medido

COMECO = datetime(2026, 10, 10, 19, 0, 7, 300000)
# 19:00:07,3 no computador + 27 s de adiantamento − 10 min = 18:50:34,3 no gravador → o minuto é o das 18:50
BASE = datetime(2026, 10, 10, 18, 50, 0)


def s(segundos: int) -> datetime:
    return BASE + timedelta(seconds=segundos)


class GravadorDeMentira:
    """Entrega a gravação em blocos. `regra` diz quais blocos voltam para um pedido."""

    def __init__(
        self, *, bloco: int = 2, desvio: int = 0, qps: float = 15.0, regra: str = "comecam", adiantado: float = 27.0,
        tamanhos: tuple[int, ...] = (), gravando_desde: datetime | None = None, cortados: dict[int, int] | None = None,
        recusa_no_pedido: int = 0, perfil_do_cliente: PerfilDeArquivo | None = None, leva: float = 1.5,
    ) -> None:
        self.bloco, self.desvio, self.qps, self.regra = bloco, desvio, qps, regra
        self.adiantado = timedelta(seconds=adiantado)
        self.tamanhos = tamanhos                   # blocos de tamanho que varia, em ciclo (a partir da BASE)
        self.gravando_desde = gravando_desde       # antes disto o canal não tem gravação
        self.cortados = cortados or {}             # {número do pedido: quantos quadros vêm, no lugar do certo}
        self.recusa_no_pedido = recusa_no_pedido
        self.perfil = perfil_do_cliente if perfil_do_cliente is not None else PerfilDeArquivo()
        self.leva = timedelta(seconds=leva)
        self.agora = COMECO                        # o relógio do COMPUTADOR
        self.pedidos: list[tuple[datetime, datetime]] = []
        self.canais: set[int] = set()
        self.relogios: list[float] = []

    def hora(self) -> datetime:
        return self.agora

    def relogio(self, *, idade_maxima_s: float = 300.0) -> timedelta:
        self.relogios.append(idade_maxima_s)
        return self.adiantado

    def _blocos(self, de: datetime, ate: datetime) -> list[tuple[datetime, datetime]]:
        """Os blocos (começo, fim) que existem em volta do pedido."""
        if self.tamanhos:
            blocos, t, i = [], BASE - timedelta(seconds=sum(self.tamanhos) * 4), 0
            while t < ate:
                fim = t + timedelta(seconds=self.tamanhos[i % len(self.tamanhos)])
                blocos.append((t, fim))
                t, i = fim, i + 1
            return blocos
        segundo = de.hour * 3600 + de.minute * 60 + de.second
        t = de.replace(microsecond=0) - timedelta(seconds=(segundo - self.desvio) % self.bloco)
        blocos = []
        while t < ate:
            blocos.append((t, t + timedelta(seconds=self.bloco)))
            t += timedelta(seconds=self.bloco)
        return blocos

    def baixar(self, canal: int, de: datetime, ate: datetime, destino: Path):
        self.pedidos.append((de, ate))
        self.canais.add(canal)
        self.agora += self.leva
        if self.recusa_no_pedido == len(self.pedidos):
            raise PedidoRecusado("usuário ou senha recusados pelo gravador")
        if self.gravando_desde is not None and de < self.gravando_desde:
            raise SemGravacao("o gravador não tem gravação nesse trecho")
        if self.regra == "tempo":                  # devolve o tempo pedido, sem bloco nenhum
            segundos = (ate - de).total_seconds()
        elif self.regra == "cobrem":               # devolve todo bloco que encosta no pedido
            segundos = sum((f - c).total_seconds() for c, f in self._blocos(de, ate) if f > de and c < ate)
        else:                                      # o medido: os blocos que COMEÇAM dentro do pedido
            segundos = sum((f - c).total_seconds() for c, f in self._blocos(de, ate) if de <= c < ate)
        quadros = self.cortados.get(len(self.pedidos), int(segundos * self.qps))
        if quadros <= 0:
            raise SemGravacao("o gravador não tem gravação nesse trecho")
        destino.write_text(str(quadros), encoding="ascii")
        return None


def contar(arquivo: Path) -> int:
    return int(arquivo.read_text(encoding="ascii"))


def medir_com(g: GravadorDeMentira, pasta: Path, canal: int = 4) -> Medida:
    return medir(g, canal, pasta, contar=contar, agora=g.hora)   # type: ignore[arg-type]


def um_segundo(desde: int, ate: int) -> list[tuple[datetime, datetime]]:
    return [(s(i), s(i + 1)) for i in range(desde, ate)]


# ───────────────────────── a medida ─────────────────────────


def test_o_gravador_da_loja_de_teste_blocos_de_2_s_em_segundo_par(tmp_path: Path):
    g = GravadorDeMentira()

    m = medir_com(g, tmp_path)

    # o atraso NÃO é medido: fica o de cautela, e quem pede confere se veio inteiro
    assert m.perfil == PerfilDeArquivo(bloco_s=2, atraso_s=ATRASO_DE_CAUTELA, porta=80, desvio_s=0, qps=15.0)
    assert m.notas == ()
    assert (m.canal, m.relogio_s, g.canais) == (4, 27.0, {4})
    # o relógio é medido na hora, não o guardado
    assert g.relogios == [0]
    # a sonda: 1 s por vez, a partir do começo do minuto de DEZ MINUTOS ATRÁS no relógio do gravador;
    # para no terceiro começo de bloco (os segundos 0, 2 e 4)
    assert g.pedidos[:5] == um_segundo(0, 5)
    assert m.leituras == ((0, 30), (1, 0), (2, 30), (3, 0), (4, 30))
    # a conferência: os dois primeiros blocos num pedido só, que termina 1 s depois do começo do segundo
    assert g.pedidos[5:] == [(s(0), s(3))]
    assert (m.pedidos, len(g.pedidos)) == (6, 6)
    # seis pedidos de 1,5 s: a medida acaba às 19:00:16,3 — dita sem a fração
    assert m.medido_em == datetime(2026, 10, 10, 19, 0, 16)
    # nada da medida fica no disco
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize(
    ("bloco", "desvio", "sondas"),
    # quantos segundos a sonda anda até o TERCEIRO começo de bloco
    [(1, 0, 3), (2, 1, 6), (3, 0, 7), (4, 0, 9), (4, 3, 12), (6, 0, 13), (10, 0, 21)],
)
def test_o_bloco_e_onde_ele_comeca_saem_do_gravador(tmp_path: Path, bloco: int, desvio: int, sondas: int):
    g = GravadorDeMentira(bloco=bloco, desvio=desvio)

    m = medir_com(g, tmp_path)

    assert (m.perfil.bloco_s, m.perfil.desvio_s, m.perfil.qps) == (bloco, desvio, 15.0)
    assert m.notas == ()
    assert g.pedidos[:sondas] == um_segundo(0, sondas)
    comecos = [segundo for segundo, quadros in m.leituras if quadros]
    assert comecos == [desvio, desvio + bloco, desvio + 2 * bloco]
    # a conferência parte do primeiro começo e termina 1 s depois do começo do segundo bloco
    assert g.pedidos[sondas:] == [(s(desvio), s(desvio + bloco + 1))]


def test_bloco_que_nao_divide_o_minuto_o_desvio_conta_da_meia_noite(tmp_path: Path):
    # Blocos de 7 s: 18:50:00 é o segundo 67.800 do dia, e 67.800 = 7 × 9.685 + 5. O começo do minuto é começo
    # de bloco, mas o desvio NÃO é zero — ele conta da meia-noite, como o `dvr.arquivo` conta.
    g = GravadorDeMentira(bloco=7, desvio=5)

    m = medir_com(g, tmp_path)

    assert [segundo for segundo, quadros in m.leituras if quadros] == [0, 7, 14]
    assert (m.perfil.bloco_s, m.perfil.desvio_s, m.perfil.qps, m.notas) == (7, 5, 15.0, ())
    assert g.pedidos[-1] == (s(0), s(8))
    # e o pedido feito com esse perfil cai em cima dos blocos de verdade
    p = pedido_que_cobre(s(3), s(9), m.perfil.bloco_s, m.perfil.desvio_s)
    assert (p.comeco, p.fim, p.cobre_ate, p.blocos) == (s(0), s(8), s(14), 2)


def test_outra_taxa_de_quadros(tmp_path: Path):
    assert medir_com(GravadorDeMentira(qps=12.5), tmp_path).perfil.qps == 12.5
    m = medir_com(GravadorDeMentira(qps=30.0, bloco=1), tmp_path)
    assert (m.perfil.qps, m.perfil.bloco_s) == (30.0, 1)
    # 29 quadros num bloco e 30 no outro: a taxa sai do maior, e um quadro de diferença não é corte
    m = medir_com(GravadorDeMentira(cortados={3: 29}), tmp_path)
    assert (m.perfil.bloco_s, m.perfil.qps, m.notas) == (2, 15.0, ())


def test_a_medida_usa_gravacao_de_dez_minutos_atras_no_relogio_do_gravador(tmp_path: Path):
    # gravador 90 s ATRASADO: 19:00:07,3 − 90 s − 10 min = 18:48:37,3 → o minuto das 18:48
    g = GravadorDeMentira(adiantado=-90.0)
    m = medir_com(g, tmp_path)
    assert (m.perfil.bloco_s, m.relogio_s) == (2, -90.0)
    assert g.pedidos[0] == (datetime(2026, 10, 10, 18, 48, 0), datetime(2026, 10, 10, 18, 48, 1))
    assert perfil.IDADE_DA_MEDIDA == timedelta(minutes=10)


def test_bloco_grande_demais_para_a_sonda_sai_sem_bloco_e_isso_e_dito(tmp_path: Path):
    # blocos de 12 s: em 24 s de sonda só aparecem dois começos (0 e 12)
    g = GravadorDeMentira(bloco=12)

    m = medir_com(g, tmp_path)

    assert (m.perfil.bloco_s, m.perfil.desvio_s, m.perfil.qps) == (None, 0, None)
    assert m.notas == ("em 24 s de gravação achei só 2 começo(s) de bloco",)
    # as 24 sondas, e nenhuma conferência
    assert g.pedidos == um_segundo(0, 24)


def test_blocos_de_tamanho_que_varia_saem_sem_bloco_e_isso_e_dito(tmp_path: Path):
    g = GravadorDeMentira(tamanhos=(2, 3))

    m = medir_com(g, tmp_path)

    assert (m.perfil.bloco_s, m.perfil.qps) == (None, None)
    assert m.notas == ("os blocos não têm tamanho fixo: começam nos segundos 0, 2, 5",)
    assert len(g.pedidos) == 6


def test_bloco_que_veio_cortado_na_sonda_sai_sem_bloco_e_isso_e_dito(tmp_path: Path):
    # o terceiro pedido (o segundo começo de bloco) volta com 12 quadros no lugar de 30
    g = GravadorDeMentira(cortados={3: 12})

    m = medir_com(g, tmp_path)

    assert (m.perfil.bloco_s, m.perfil.qps) == (None, None)
    assert m.notas == ("os blocos vieram com 30, 12, 30 quadros: a gravação pode ter vindo cortada",)
    # um quadro de diferença não é corte (provado em "outra taxa de quadros"); dois, já é
    assert medir_com(GravadorDeMentira(cortados={3: 28}), tmp_path).perfil.bloco_s is None


def test_gravador_que_devolve_todo_bloco_que_encosta_no_pedido_sai_sem_bloco(tmp_path: Path):
    # cada segundo devolve o bloco de 2 s em que ele cai: pareceria bloco de 1 s, a 30 quadros por segundo
    g = GravadorDeMentira(regra="cobrem")

    m = medir_com(g, tmp_path)

    # a conferência pega: dois "blocos de 1 s" num pedido só deviam dar 60 quadros, e voltam os mesmos 30 de um bloco só
    assert (m.perfil.bloco_s, m.perfil.desvio_s, m.perfil.qps) == (None, 0, None)
    assert m.notas == (
        "um pedido para dois blocos seguidos devolveu 30 quadros, e não 60: "
        "este gravador não entrega os blocos que começam dentro do pedido",
    )
    assert g.pedidos == um_segundo(0, 3) + [(s(0), s(2))]


def test_a_conferencia_tolera_um_quadro(tmp_path: Path):
    # o pedido da conferência (o sexto) volta com 59 quadros, e não 60
    assert medir_com(GravadorDeMentira(cortados={6: 59}), tmp_path).perfil.bloco_s == 2
    m = medir_com(GravadorDeMentira(cortados={6: 58}), tmp_path)
    assert m.perfil.bloco_s is None and "devolveu 58 quadros, e não 60" in m.notas[0]


def test_a_conferencia_que_falha_nao_deixa_resto_do_que_se_tinha_medido(tmp_path: Path):
    # blocos em segundo ímpar (desvio 1): a sonda acha tudo, e a conferência (o sétimo pedido) volta cortada
    g = GravadorDeMentira(desvio=1, cortados={7: 5})

    m = medir_com(g, tmp_path)

    # sem bloco não há desvio nem taxa: o perfil que sai é o de quem não mediu, inteiro
    assert m.perfil == PerfilDeArquivo(bloco_s=None, atraso_s=ATRASO_DE_CAUTELA, porta=80, desvio_s=0, qps=None)
    assert "devolveu 5 quadros, e não 60" in m.notas[0]
    # as leituras da sonda continuam na medida: é com elas que se entende o que o gravador fez
    assert [segundo for segundo, quadros in m.leituras if quadros] == [1, 3, 5]


def test_gravador_que_devolve_o_tempo_pedido_e_lido_como_bloco_de_1_s(tmp_path: Path):
    m = medir_com(GravadorDeMentira(regra="tempo"), tmp_path)
    assert (m.perfil.bloco_s, m.perfil.desvio_s, m.perfil.qps, m.notas) == (1, 0, 15.0, ())


def test_canal_sem_gravacao_naquele_horario_e_dito_e_a_sonda_para_cedo(tmp_path: Path):
    g = GravadorDeMentira(gravando_desde=datetime(2026, 10, 10, 18, 55, 0))
    with pytest.raises(MedidaIncompleta, match=r"não devolveu gravação do canal 4 a partir de 18:50:00 \(na hora dele\)"):
        medir_com(g, tmp_path)
    # 12 sondas sem nada, e para: não gasta as 24
    assert g.pedidos == um_segundo(0, 12)
    assert list(tmp_path.iterdir()) == []


def test_gravacao_que_comeca_no_meio_da_sonda_ainda_e_medida(tmp_path: Path):
    # o canal só tem gravação a partir das 18:50:08: os começos achados são 8, 10 e 12
    g = GravadorDeMentira(gravando_desde=s(8))
    m = medir_com(g, tmp_path)
    assert (m.perfil.bloco_s, m.perfil.desvio_s) == (2, 0)
    assert [segundo for segundo, quadros in m.leituras if quadros] == [8, 10, 12]
    assert g.pedidos[-1] == (s(8), s(11))


def test_credencial_recusada_no_meio_acaba_a_medida(tmp_path: Path):
    g = GravadorDeMentira(recusa_no_pedido=3)
    with pytest.raises(PedidoRecusado):
        medir_com(g, tmp_path)
    assert len(g.pedidos) == 3            # nenhum pedido depois da recusa
    assert list(tmp_path.iterdir()) == []


def test_a_medida_pede_um_cliente_sem_bloco_no_perfil(tmp_path: Path):
    g = GravadorDeMentira(perfil_do_cliente=PerfilDeArquivo(bloco_s=2))
    with pytest.raises(ValueError, match="sem bloco no perfil"):
        medir_com(g, tmp_path)
    assert g.relogios == [] and g.pedidos == []


def test_a_porta_do_perfil_e_a_do_cliente(tmp_path: Path):
    g = GravadorDeMentira(perfil_do_cliente=PerfilDeArquivo(porta=8080))
    assert medir_com(g, tmp_path).perfil.porta == 8080


def test_a_medida_e_feita_pelo_canal_pedido(tmp_path: Path):
    g = GravadorDeMentira()
    m = medir_com(g, tmp_path, canal=7)
    assert (m.canal, g.canais) == (7, {7})


# ───────────────────────── guardar e ler ─────────────────────────


def medida(**mudancas) -> Medida:
    base = dict(bloco_s=2, atraso_s=180.0, porta=80, desvio_s=0, qps=15.0)
    base.update(mudancas)
    return Medida(
        perfil=PerfilDeArquivo(**base), medido_em=datetime(2026, 10, 10, 19, 0, 16), canal=4, pedidos=6, relogio_s=27.0,
        notas=("uma nota",), leituras=((0, 30), (1, 0), (2, 30)),
    )


def test_o_perfil_guardado_e_o_que_se_le_de_volta(tmp_path: Path):
    arquivo = tmp_path / "pasta nova" / perfil.NOME_PADRAO
    assert ler(arquivo, "192.168.1.50") is None and quando_foi_medido(arquivo, "192.168.1.50") is None

    guardar(arquivo, "192.168.1.50", medida())

    assert ler(arquivo, "192.168.1.50") == PerfilDeArquivo(bloco_s=2, atraso_s=180.0, porta=80, desvio_s=0, qps=15.0)
    assert quando_foi_medido(arquivo, "192.168.1.50") == datetime(2026, 10, 10, 19, 0, 16)
    guardado = json.loads(arquivo.read_text(encoding="utf-8"))
    assert guardado == {"192.168.1.50:80": {
        "bloco_s": 2, "desvio_s": 0, "qps": 15.0, "atraso_s": 180.0, "medido_em": "2026-10-10T19:00:16",
        "canal": 4, "pedidos": 6, "relogio_s": 27.0, "notas": ["uma nota"], "leituras": [[0, 30], [1, 0], [2, 30]],
    }}
    # o arquivo temporário não fica
    assert [p.name for p in arquivo.parent.iterdir()] == [perfil.NOME_PADRAO]


def test_cada_gravador_tem_o_seu_perfil_e_a_porta_faz_parte_do_nome(tmp_path: Path):
    arquivo = tmp_path / perfil.NOME_PADRAO
    guardar(arquivo, "192.168.1.50", medida())
    guardar(arquivo, "192.168.1.51", medida(bloco_s=None, qps=None))
    guardar(arquivo, "192.168.1.50", medida(porta=8080, bloco_s=4, desvio_s=3))

    assert ler(arquivo, "192.168.1.50").bloco_s == 2
    assert ler(arquivo, "192.168.1.51") == PerfilDeArquivo(bloco_s=None, atraso_s=180.0, porta=80, desvio_s=0, qps=None)
    assert ler(arquivo, "192.168.1.50", 8080) == PerfilDeArquivo(bloco_s=4, atraso_s=180.0, porta=8080, desvio_s=3, qps=15.0)
    assert ler(arquivo, "192.168.1.52") is None
    # medir de novo troca só o dele
    guardar(arquivo, "192.168.1.50", medida(atraso_s=240.0))
    assert ler(arquivo, "192.168.1.50").atraso_s == 240.0 and ler(arquivo, "192.168.1.51") is not None


def test_arquivo_estragado_nao_derruba_e_e_refeito(tmp_path: Path):
    arquivo = tmp_path / perfil.NOME_PADRAO
    arquivo.write_text("{ isto não é json", encoding="utf-8")
    assert ler(arquivo, "192.168.1.50") is None
    arquivo.write_text("[1, 2, 3]", encoding="utf-8")
    assert ler(arquivo, "192.168.1.50") is None and quando_foi_medido(arquivo, "192.168.1.50") is None
    guardar(arquivo, "192.168.1.50", medida())
    assert ler(arquivo, "192.168.1.50").bloco_s == 2


@pytest.mark.parametrize(
    "estragado",
    [
        {"bloco_s": 0}, {"bloco_s": -2}, {"atraso_s": -1}, {"qps": 0}, {"qps": -15},
        {"desvio_s": 2}, {"desvio_s": -1}, {"bloco_s": "dois"}, {"atraso_s": None}, {"atraso_s": "já"},
    ],
)
def test_perfil_com_numero_impossivel_nao_e_usado(tmp_path: Path, estragado: dict):
    arquivo = tmp_path / perfil.NOME_PADRAO
    guardar(arquivo, "192.168.1.50", medida())
    dados = json.loads(arquivo.read_text(encoding="utf-8"))
    dados["192.168.1.50:80"].update(estragado)
    arquivo.write_text(json.dumps(dados), encoding="utf-8")
    assert ler(arquivo, "192.168.1.50") is None


def test_perfil_sem_o_atraso_ou_que_nao_e_um_registro_nao_e_usado(tmp_path: Path):
    arquivo = tmp_path / perfil.NOME_PADRAO
    arquivo.write_text(json.dumps({"a:80": {"bloco_s": 2}, "b:80": "texto", "c:80": {"atraso_s": 4, "medido_em": "ontem"}}), encoding="utf-8")
    assert ler(arquivo, "a") is None and ler(arquivo, "b") is None
    # sem bloco, sem taxa e sem desvio, mas com o atraso: vale (é o perfil de quem não se sabe o bloco)
    assert ler(arquivo, "c") == PerfilDeArquivo(bloco_s=None, atraso_s=4.0, porta=80, desvio_s=0, qps=None)
    assert quando_foi_medido(arquivo, "c") is None and quando_foi_medido(arquivo, "b") is None


def test_o_arquivo_dos_gravadores_mora_ao_lado_da_configuracao(tmp_path: Path):
    assert arquivo_ao_lado(tmp_path / "configuracao.json") == tmp_path / "gravadores.json"
    assert perfil.NOME_PADRAO == "gravadores.json"
