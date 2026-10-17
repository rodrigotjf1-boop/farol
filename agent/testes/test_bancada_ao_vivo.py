"""A bancada ao vivo (A23.2): o lanche lido como vídeo, na loja, enquanto ele acontece.

A bancada é a desenhada da leitura do treino (`test_treino_lanches.cena`): um lanche de 0 a 54 s, com o braço por cima
aos 10–11 s e um ingrediente que fica depois; empurrado aos 30 s; e uma bandeja curta de 60 a 65 s. O fluxo do gravador
é de mentira (um quadro por pergunta) e o detector acha os discos pela cor. O que se protege:

- é a MESMA leitura da gravação de treino: o mesmo lanche, o mesmo começo e fim, o empurrão, as etapas;
- a linha do tempo do dia: o pão que aparece, a bancada que muda de estado (vazia / lanche), o lanche que termina, com
  a hora e o fuso; a bandeja curta não vira lanche;
- os quadros: ficam no disco enquanto algum lanche na bancada os usa, e saem depois;
- o fim da leitura (a loja fechou, o agente parou): o lanche que estava na bancada termina marcado como encerrado;
- o mesmo quadro não conta duas vezes; sem quadro, conta e segue;
- dois canais não se misturam;
- quais canais ligam (`FAROL_BANCADA_AO_VIVO`), a loja aberta (com a folga depois de fechar), a limpeza do disco;
- o serviço: as peças da configuração em disco, o motivo de não ler dito uma vez, a leitura que recomeça quando a área
  muda e para quando a loja fecha, o defeito num quadro que não para a leitura — e o agente, que só liga com a variável.
"""

from __future__ import annotations

import csv
import json
import logging
import time
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest

from farol_agent import bancada_ao_vivo as bav
from farol_agent import cli, treino_servico
from farol_agent import treino_lanches as tl
from farol_agent.modelos import Janela, Zona

from .test_repasse_leitor import config as config_de_teste
from .test_treino_lanches import PERFIL, T0, DetectorDaCor, cena, montar_densa, quadro
from .test_treino_servico import _ClienteDeMentira

TELA_INTEIRA = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
OUTRA_AREA = [(0.1, 0.0), (1.0, 0.0), (1.0, 1.0), (0.1, 1.0)]
ZONA = Zona(id="z4", nome="bancada", poligono=TELA_INTEIRA, papel="montagem", numero=1)


class FluxoDeMentira:
    """O fluxo do gravador de mentira: a cada pergunta, o próximo quadro da lista (`None` na lista = sem quadro)."""

    def __init__(self, quadros=()):
        self._quadros = list(quadros)
        self.perguntas = 0
        self.parado = False

    def ultimo(self, idade_maxima_seg=3.0):
        self.perguntas += 1
        return self._quadros.pop(0) if self._quadros else None

    def parar(self):
        self.parado = True


def leitura(tmp_path: Path, quadros, canal=4) -> bav.LeituraDoCanal:
    return bav.LeituraDoCanal(canal, ZONA, FluxoDeMentira(quadros), DetectorDaCor(), PERFIL, tmp_path / f"canal-{canal:02d}")


def linha_do_tempo(pasta: Path, dia: str = "2026-10-15") -> list[dict]:
    arquivo = pasta / f"{dia}.jsonl"
    return [json.loads(l) for l in arquivo.read_text(encoding="utf-8").splitlines()] if arquivo.exists() else []


def ler_tudo(le: bav.LeituraDoCanal, n: int) -> None:
    for _ in range(n):
        le.um_quadro()


def sem_fuso(texto: str) -> datetime:
    return datetime.fromisoformat(texto).replace(tzinfo=None)


# ───────────────────────────── a leitura ─────────────────────────────


def test_ao_vivo_e_a_mesma_leitura_da_gravacao_de_treino(tmp_path):
    le = leitura(tmp_path, cena())
    ler_tudo(le, 80)
    ao_vivo = [e for e in linha_do_tempo(le.pasta) if e["evento"] == "lanche"]
    gravado = tl.lanches_da_densa(montar_densa(tmp_path, cena()), tmp_path / "lanches", DetectorDaCor(), PERFIL)

    assert len(ao_vivo) == 1 and [r["eLanche"] for r in gravado] == [True, False]
    a, g = ao_vivo[0], gravado[0]
    assert sem_fuso(a["inicio"]) == datetime.fromisoformat(g["inicio"])
    assert sem_fuso(a["fim"]) == datetime.fromisoformat(g["fim"])
    assert (a["duracaoS"], a["quadros"], a["mudouDeLugar"]) == (g["duracaoS"], g["quadros"], g["mudouDeLugar"]) == (67.0, 67, 1)
    assert a["etapas"][0] == "21h00m00" and "21h00m30" in a["etapas"], "o pão aberto e o lanche no lugar novo"
    assert len([e for e in a["etapas"] if "21h00m12" <= e <= "21h00m14"]) == 1, "o ingrediente que ficou depois do braço"
    assert a["pasta"] == "2026-10-15/lanche-21h00m00-1"
    with (le.pasta / a["pasta"] / "metades.csv").open(encoding="utf-8", newline="") as f:
        assert len(list(csv.DictReader(f))) == 67, "a pasta do lanche é a da gravação de treino: o que a identificação lê"


def test_a_linha_do_tempo_conta_o_pao_o_estado_e_o_lanche_e_a_bandeja_curta_nao_vira_lanche(tmp_path):
    le = leitura(tmp_path, cena())
    ler_tudo(le, 80)

    eventos = linha_do_tempo(le.pasta)
    assert [(e["evento"], e.get("estado") or e.get("trilha")) for e in eventos] == [
        ("pao", 1), ("estado", "lanche"), ("pao", 2), ("lanche", 1), ("estado", "vazia"),
    ]
    assert sem_fuso(eventos[2]["t"]) == T0 + timedelta(seconds=60)
    assert sem_fuso(eventos[4]["t"]) == T0 + timedelta(seconds=78), (
        "a bandeja some aos 65 s e o perfil espera 12 s: a bancada fica vazia aos 78"
    )
    assert le.contas.curtas == 1 and le.contas.lanches == 1
    assert [p.name for p in (le.pasta / "2026-10-15").iterdir()] == ["lanche-21h00m00-1"]


def test_toda_hora_da_linha_do_tempo_tem_o_fuso(tmp_path):
    le = leitura(tmp_path, cena())
    ler_tudo(le, 80)
    le.encerrar("o agente parou")

    vistos = 0
    for e in linha_do_tempo(le.pasta):
        for campo in ("t", "inicio", "fim"):
            if campo in e:
                assert datetime.fromisoformat(e[campo]).tzinfo is not None, (campo, e)
                vistos += 1
    assert vistos >= 9


def test_a_bancada_vazia_desde_o_comeco_diz_vazia_e_nada_mais(tmp_path):
    le = leitura(tmp_path, [(T0 + timedelta(seconds=s), quadro()) for s in range(20)])
    ler_tudo(le, 20)

    assert [(e["evento"], e.get("estado")) for e in linha_do_tempo(le.pasta)] == [("estado", "vazia")]


def test_os_quadros_ficam_enquanto_um_lanche_na_bancada_usa_e_saem_depois(tmp_path):
    le = leitura(tmp_path, cena())

    ler_tudo(le, 41)
    assert len(list(le.quadros.iterdir())) == 41, "o lanche está na bancada desde o primeiro quadro"
    ler_tudo(le, 27)  # até o quadro dos 67 s: o lanche 1 terminou; a bandeja está desde os 60
    assert len(list(le.quadros.iterdir())) == 8
    ler_tudo(le, 12)  # até os 79 s: a bancada vazia desde os 78
    assert [f.name for f in le.quadros.iterdir()] == ["2026-10-15_21-01-19_000.jpg"], "só o quadro de agora"
    le.encerrar("o agente parou")
    assert list(le.quadros.iterdir()) == []


def test_os_quadros_de_uma_leitura_que_caiu_saem_ao_comecar_e_o_que_nao_e_dela_fica(tmp_path):
    quadros = tmp_path / "canal-04" / bav.QUADROS
    quadros.mkdir(parents=True)
    (quadros / "2026-10-15_20-59-00_000.jpg").write_bytes(b"de antes")
    (quadros / "anotacao.txt").write_text("de outra pessoa", encoding="utf-8")

    leitura(tmp_path, [])

    assert [f.name for f in quadros.iterdir()] == ["anotacao.txt"]


def test_o_fim_da_leitura_termina_o_lanche_que_estava_na_bancada_marcado_como_encerrado(tmp_path):
    le = leitura(tmp_path, cena())
    ler_tudo(le, 50)
    le.encerrar("a loja está fechada")

    eventos = linha_do_tempo(le.pasta)
    assert [e["evento"] for e in eventos] == ["pao", "estado", "lanche", "estado", "resumo", "desligada"]
    lanche = eventos[2]
    assert lanche["encerrado"] == "a loja está fechada" and lanche["duracaoS"] == 49.0
    assert eventos[3]["estado"] == "vazia" and eventos[5]["motivo"] == "a loja está fechada"
    assert le.fluxo.parado and list(le.quadros.iterdir()) == []


def test_o_lanche_curto_que_estava_na_bancada_no_fim_nao_vira_lanche(tmp_path):
    le = leitura(tmp_path, cena())
    ler_tudo(le, 20)
    le.encerrar("o agente parou")

    assert "lanche" not in [e["evento"] for e in linha_do_tempo(le.pasta)]


def test_o_mesmo_quadro_nao_conta_duas_vezes_e_sem_quadro_segue(tmp_path):
    img = quadro()
    le = leitura(tmp_path, [(T0, img), (T0, img), None, (T0 + timedelta(seconds=1), img)])

    assert [le.um_quadro() for _ in range(4)] == [True, False, False, True]
    assert (le.contas.quadros, le.contas.repetidos, le.contas.sem_quadro) == (2, 1, 1)


def test_o_resumo_sai_de_dez_em_dez_minutos_com_as_contas(tmp_path):
    quadros = [(T0 + timedelta(seconds=s), quadro()) for s in range(0, 1300, 10)]
    le = leitura(tmp_path, quadros)
    ler_tudo(le, len(quadros))

    resumos = [e for e in linha_do_tempo(le.pasta) if e["evento"] == "resumo"]
    assert [sem_fuso(r["t"]) for r in resumos] == [T0 + timedelta(seconds=600), T0 + timedelta(seconds=1200)]
    assert resumos[0]["quadros"] == 61 and resumos[1]["quadros"] == 60
    assert resumos[0]["estado"] == "vazia" and isinstance(resumos[0]["msPorQuadro"], int)


def test_dois_canais_nao_se_misturam(tmp_path):
    quatro = leitura(tmp_path, cena(), canal=4)
    sete = leitura(tmp_path, [(T0 + timedelta(seconds=s), quadro()) for s in range(80)], canal=7)
    for _ in range(80):
        quatro.um_quadro()
        sete.um_quadro()

    assert quatro.pasta != sete.pasta
    assert {e["canal"] for e in linha_do_tempo(quatro.pasta)} == {4}
    assert [(e["canal"], e["evento"], e.get("estado")) for e in linha_do_tempo(sete.pasta)] == [(7, "estado", "vazia")]
    assert (quatro.pasta / "2026-10-15" / "lanche-21h00m00-1").is_dir()
    assert not (sete.pasta / "2026-10-15").exists()


# ───────────────────────────── quais canais, quando, e a limpeza ─────────────────────────────


@pytest.mark.parametrize(
    "valor, canais",
    [(None, []), ("", []), ("4", [4]), (" 4, 7 ,4", [4, 7]), ("4,x,0,-1", [4])],
)
def test_os_canais_da_variavel(valor, canais, caplog):
    with caplog.at_level(logging.WARNING):
        assert bav.canais_ligados(valor) == canais
    if valor == "4,x,0,-1":
        assert len(caplog.records) == 3 and all("não é número de canal" in r.getMessage() for r in caplog.records)


HORARIO_DA_NOITE = [Janela(dias=[1, 2, 3, 4, 5, 6, 7], hora_ini="19:00", hora_fim="05:50")]


@pytest.mark.parametrize(
    "hora, le",
    [("20:00", True), ("02:00", True), ("05:50", True), ("06:19", True), ("06:21", False), ("12:00", False), ("18:59", False)],
)
def test_le_com_a_loja_aberta_e_ate_meia_hora_depois_de_fechar(hora, le):
    h, m = (int(x) for x in hora.split(":"))
    assert bav.aberta(HORARIO_DA_NOITE, datetime(2026, 10, 17, h, m)) is le


def test_sem_horario_cadastrado_le_sempre():
    assert bav.aberta([], datetime(2026, 10, 17, 12, 0))


def test_a_limpeza_apaga_so_o_velho_e_so_o_que_a_leitura_criou(tmp_path):
    hoje = date(2026, 10, 17)
    for dias in range(6):
        (tmp_path / f"{hoje - timedelta(days=dias):%Y-%m-%d}" / "lanche-x").mkdir(parents=True)
    for dias in (29, 30, 31):
        (tmp_path / f"{hoje - timedelta(days=dias):%Y-%m-%d}.jsonl").write_text("{}\n", encoding="utf-8")
    (tmp_path / "2026-13-45").mkdir()
    (tmp_path / "outra-coisa").mkdir()
    (tmp_path / "notas.txt").write_text("de outra pessoa", encoding="utf-8")

    assert bav.limpar(tmp_path, hoje) == 3

    assert sorted(p.name for p in tmp_path.iterdir()) == [
        "2026-09-17.jsonl", "2026-09-18.jsonl", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-13-45",
        "notas.txt", "outra-coisa",
    ]


# ───────────────────────────── o serviço ─────────────────────────────

PERFIL_JSON = {k: getattr(PERFIL, k) for k in tl.PerfilDaBancada.__dataclass_fields__}
NOITE = [{"dias": [1, 2, 3, 4, 5, 6, 7], "hora_ini": "19:00", "hora_fim": "05:50"}]
MANHA = [{"dias": [1, 2, 3, 4, 5, 6, 7], "hora_ini": "08:00", "hora_fim": "12:00"}]


def em_disco(tmp_path: Path, *, horario=None, perfil=True, poligono=TELA_INTEIRA, host="10.0.0.8") -> Path:
    c = config_de_teste(poligono=[list(p) for p in poligono], canal=4)
    c["pontos"][0]["host"] = host
    c["pontos"][0]["usuario"] = "leitor"
    c["pontos"][0]["segredoRef"] = "cofre://gravador"
    c["loja"]["horarioFuncionamento"] = horario or []
    caminho = tmp_path / "configuracao.json"
    caminho.write_text(json.dumps(c), encoding="utf-8")
    if perfil:
        (tmp_path / "perfil_da_bancada.json").write_text(json.dumps(PERFIL_JSON), encoding="utf-8")
    return caminho


class Servico:
    """O serviço com as peças de mentira: os fluxos que ele abre (um a um, da lista), o detector e o relógio."""

    def __init__(self, caminho: Path, *fluxos: FluxoDeMentira, detector="padrao", agora=T0, **kw):
        self.fluxos, self.abertos, self.agora = list(fluxos), [], agora
        self.s = bav.BancadaAoVivo(
            caminho, [4], detector_de=lambda: DetectorDaCor() if detector == "padrao" else detector,
            abrir_fluxo=self._abrir, relogio=lambda: self.agora, a_cada_s=0.0, **kw,
        )
        self.c = bav.CanalAoVivo(4)
        self.t = 0.0

    def _abrir(self, ponto):
        fluxo = self.fluxos.pop(0) if self.fluxos else FluxoDeMentira()
        self.abertos.append((ponto.canal, ponto.host, fluxo))
        return fluxo

    def passos(self, n: int, *, de_s: float = 1.0) -> None:
        for _ in range(n):
            self.s.passo(self.c, self.t)
            self.t += de_s

    @property
    def pasta(self) -> Path:
        return self.s.pasta_do_canal(4)


def test_as_pecas_saem_da_configuracao_em_disco(tmp_path):
    s = Servico(em_disco(tmp_path)).s

    chave, pecas = s.pecas(4)

    assert chave is not None and pecas["ponto"].canal == 4 and pecas["ponto"].host == "10.0.0.8"
    assert pecas["zona"].numero == 1 and pecas["perfil"] == PERFIL
    assert s.pasta_do_canal(4) == tmp_path / "bancada" / "canal-04"


@pytest.mark.parametrize(
    "monta, motivo",
    [
        (dict(perfil=False), "falta o perfil da bancada"),
        (dict(host=""), "o canal 4 não tem gravador"),
        (dict(horario=MANHA), "a loja está fechada"),
    ],
)
def test_sem_uma_peca_nao_le_e_diz_por_que(tmp_path, monta, motivo):
    chave, pecas = Servico(em_disco(tmp_path, **monta)).s.pecas(4)

    assert chave is None and motivo in pecas


def test_sem_o_detector_nao_le_e_diz_por_que(tmp_path):
    s = Servico(em_disco(tmp_path), detector=None).s
    assert s.pecas(4) == (None, "o detector não está instalado neste computador (farol-agent detector instalar)")


def test_sem_configuracao_nao_le(tmp_path):
    assert Servico(tmp_path / "configuracao.json").s.pecas(4) == (None, "sem configuração em disco")


def test_com_a_loja_aberta_pelo_horario_le(tmp_path):
    chave, _ = Servico(em_disco(tmp_path, horario=NOITE), agora=datetime(2026, 10, 15, 21, 0)).s.pecas(4)
    assert chave is not None


def test_a_chave_muda_quando_muda_o_desenho_da_area(tmp_path):
    antes, _ = Servico(em_disco(tmp_path)).s.pecas(4)
    depois, _ = Servico(em_disco(tmp_path, poligono=OUTRA_AREA)).s.pecas(4)
    assert antes is not None and depois is not None and antes != depois


def test_o_laco_abre_o_fluxo_le_a_bancada_e_ao_fechar_encerra(tmp_path):
    fluxo = FluxoDeMentira(cena())
    sv = Servico(em_disco(tmp_path), fluxo)

    sv.passos(81)
    sv.s.fechar(sv.c, "o agente parou")

    assert [(c, h) for c, h, _ in sv.abertos] == [(4, "10.0.0.8")], "um fluxo, aberto uma vez"
    eventos = linha_do_tempo(sv.pasta)
    assert eventos[0]["evento"] == "ligada" and [e["trilha"] for e in eventos if e["evento"] == "lanche"] == [1]
    assert (eventos[-1]["evento"], eventos[-1]["motivo"]) == ("desligada", "o agente parou")
    assert fluxo.parado and sv.c.leitura is None


def test_o_laco_confere_a_configuracao_so_de_tempos_em_tempos(tmp_path):
    sv = Servico(em_disco(tmp_path), config_a_cada_s=300.0)
    pedidas = []
    original = sv.s.pecas
    sv.s.pecas = lambda canal: pedidas.append(canal) or original(canal)

    sv.passos(301)

    assert pedidas == [4, 4], "na primeira volta e 300 s depois"


def test_o_motivo_de_nao_ler_e_dito_uma_vez_e_o_fluxo_nem_abre(tmp_path, caplog):
    sv = Servico(em_disco(tmp_path, perfil=False), config_a_cada_s=0.0)

    with caplog.at_level(logging.INFO, logger="farol_agent.bancada_ao_vivo"):
        sv.passos(20)

    ditos = [r.getMessage() for r in caplog.records if "não leio agora" in r.getMessage()]
    assert len(ditos) == 1 and "falta o perfil da bancada" in ditos[0]
    assert sv.abertos == [] and not sv.pasta.exists()


def test_a_leitura_recomeca_quando_a_area_muda(tmp_path):
    primeiro, segundo = FluxoDeMentira(cena()[:10]), FluxoDeMentira()
    sv = Servico(em_disco(tmp_path), primeiro, segundo, config_a_cada_s=0.0)

    sv.passos(5)
    em_disco(tmp_path, poligono=OUTRA_AREA)
    sv.passos(5)
    sv.s.fechar(sv.c, "o agente parou")

    assert primeiro.parado and segundo.parado and len(sv.abertos) == 2
    motivos = [e.get("motivo") for e in linha_do_tempo(sv.pasta) if e["evento"] == "desligada"]
    assert motivos == ["a configuração do canal mudou", "o agente parou"]


def test_a_loja_que_fecha_para_a_leitura_e_fecha_o_fluxo(tmp_path):
    fluxo = FluxoDeMentira(cena())
    sv = Servico(em_disco(tmp_path, horario=NOITE), fluxo, agora=datetime(2026, 10, 15, 21, 0), config_a_cada_s=0.0)

    sv.passos(50)
    sv.agora = datetime(2026, 10, 16, 6, 30)
    sv.passos(1)

    assert fluxo.parado and sv.c.leitura is None
    eventos = linha_do_tempo(sv.pasta)
    lanche = next(e for e in eventos if e["evento"] == "lanche")
    assert lanche["encerrado"] == "a loja está fechada"
    assert (eventos[-1]["evento"], eventos[-1]["motivo"]) == ("desligada", "a loja está fechada")


def test_um_defeito_num_quadro_nao_para_a_leitura_e_e_dito_uma_vez(tmp_path, caplog):
    class DetectorQueQuebra(DetectorDaCor):
        def caixas(self, imagem, classe, limite):
            raise RuntimeError("o detector caiu")

    fluxo = FluxoDeMentira([(T0 + timedelta(seconds=s), quadro()) for s in range(10)])
    sv = Servico(em_disco(tmp_path), fluxo, detector=DetectorQueQuebra())

    with caplog.at_level(logging.ERROR, logger="farol_agent.bancada_ao_vivo"):
        sv.passos(12)
    sv.s.fechar(sv.c, "o agente parou")

    assert fluxo.perguntas == 12, "seguiu perguntando depois do defeito"
    assert len([r for r in caplog.records if "o detector caiu" in r.getMessage()]) == 1
    resumo = next(e for e in linha_do_tempo(sv.pasta) if e["evento"] == "resumo")
    assert resumo["erros"] == 10


def test_o_mesmo_defeito_volta_ao_registro_depois_de_uma_hora(tmp_path, caplog):
    class DetectorQueQuebra(DetectorDaCor):
        def caixas(self, imagem, classe, limite):
            raise RuntimeError("o detector caiu")

    fluxo = FluxoDeMentira([(T0 + timedelta(seconds=s), quadro()) for s in range(3)])
    sv = Servico(em_disco(tmp_path), fluxo, detector=DetectorQueQuebra())

    with caplog.at_level(logging.ERROR, logger="farol_agent.bancada_ao_vivo"):
        for t in (0.0, bav.REPETE_AVISO_S - 1, bav.REPETE_AVISO_S):
            sv.s.passo(sv.c, t)

    assert len([r for r in caplog.records if "o detector caiu" in r.getMessage()]) == 2, "na primeira vez e uma hora depois"


def test_a_linha_de_execucao_le_e_para(tmp_path):
    fluxo = FluxoDeMentira(cena())
    sv = Servico(em_disco(tmp_path), fluxo)

    sv.s.iniciar()
    try:
        limite = time.monotonic() + 30
        while fluxo.perguntas < 81:
            assert time.monotonic() < limite, "a linha de execução não leu a tempo"
            time.sleep(0.02)
    finally:
        sv.s.parar()

    assert fluxo.parado
    eventos = linha_do_tempo(sv.pasta)
    assert [e["trilha"] for e in eventos if e["evento"] == "lanche"] == [1]
    assert (eventos[-1]["evento"], eventos[-1]["motivo"]) == ("desligada", "o agente parou")


# ───────────────────────────── o agente liga pela variável ─────────────────────────────


class _BancadaDeMentira:
    vistos: list[str] = []

    def __init__(self, caminho_config, canais):
        _BancadaDeMentira.vistos.append(f"criada:{Path(caminho_config).name}:{canais}")

    def iniciar(self):
        _BancadaDeMentira.vistos.append("iniciada")

    def parar(self):
        _BancadaDeMentira.vistos.append("parada")


@pytest.mark.parametrize("valor, vistos", [(None, []), ("4", ["criada:configuracao.json:[4]", "iniciada", "parada"])])
def test_o_agente_so_liga_a_bancada_ao_vivo_com_a_variavel(tmp_path, monkeypatch, capsys, valor, vistos):
    from farol_agent import nuvem

    _BancadaDeMentira.vistos.clear()
    monkeypatch.setenv("FAROL_AGENTE_TOKEN", "token-de-teste")
    if valor is None:
        monkeypatch.delenv(bav.VARIAVEL, raising=False)
    else:
        monkeypatch.setenv(bav.VARIAVEL, valor)
    monkeypatch.setattr(nuvem, "ClienteNuvem", _ClienteDeMentira)
    monkeypatch.setattr(bav, "BancadaAoVivo", _BancadaDeMentira)
    monkeypatch.setattr(treino_servico, "TreinoEmFundo", lambda *a, **k: None)
    argv = ["servir", "--nuvem", "https://api.exemplo", "--config", str(tmp_path / "configuracao.json"),
            "--fila", str(tmp_path / "fila.db"), "--sem-auditoria", "--sem-treino", "--voltas", "0"]

    assert cli.main(argv) == 0

    assert _BancadaDeMentira.vistos == vistos
    assert ("bancada ao vivo LIGADA (FAROL_BANCADA_AO_VIVO): canal 4" in capsys.readouterr().out) is bool(vistos)
