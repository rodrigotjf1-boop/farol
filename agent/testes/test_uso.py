"""O uso da máquina de análise: medir, guardar por hora e mandar.

Pedido do dono em 07/10/2026: "incluir análise de uso do servidor de
análise, a máquina local". O que tem de ficar provado:

- "não medi" nunca vira zero: peça sem leitura não entra na média;
- medir não derruba a auditoria, nem com a máquina respondendo errado;
- a hora guarda soma, quantidade e pico de cada peça, e o disco é o da
  última leitura;
- o que sobe é o de `contratos/uso-da-maquina.json`, lido também pelo
  teste da API;
- a nuvem antiga, sem a rota, não custa um evento nem um resumo.
"""

from __future__ import annotations

import json
import sys
from datetime import timedelta
from pathlib import Path

import pytest

from farol_agent.auditoria import Auditoria
from farol_agent.contrato import maquina_para_nuvem, uso_para_nuvem
from farol_agent.fila import Fila
from farol_agent.nuvem import ErroDaNuvem
from farol_agent.uso import FALHAS_ATE_DESISTIR, Amostra, Medidor, uso_da_placa
from testes.conftest import BASE

from .test_auditoria import FonteBoa, JuizDeTeste, NuvemDeTeste, config_com_regra

CONTRATO = Path(__file__).resolve().parents[2] / "contratos" / "uso-da-maquina.json"


@pytest.fixture
def fila(tmp_path):
    f = Fila(tmp_path / "fila.db")
    yield f
    f.fechar()


# ───────────────────────── a placa de vídeo ─────────────────────────


def test_a_placa_e_o_MAIOR_motor_somando_os_processos_de_cada_um():
    # Dois processos no motor 3D e um decodificando vídeo: o Gerenciador de
    # Tarefas mostra 40 (o 3D), não 55 (a soma dos dois motores).
    lidas = [
        ("pid_100_luid_0x0_0xA_phys_0_eng_0_engtype_3D", 25.0),
        ("pid_200_luid_0x0_0xA_phys_0_eng_0_engtype_3D", 15.0),
        ("pid_100_luid_0x0_0xA_phys_0_eng_3_engtype_VideoDecode", 15.0),
    ]
    assert uso_da_placa(lidas) == pytest.approx(40.0)


def test_com_duas_placas_vale_a_mais_ocupada_e_nunca_passa_de_cem():
    lidas = [
        ("pid_1_luid_0x0_0xA_phys_0_eng_0_engtype_3D", 30.0),
        ("pid_1_luid_0x0_0xB_phys_0_eng_0_engtype_Compute_0", 70.0),
        ("pid_2_luid_0x0_0xB_phys_0_eng_0_engtype_Compute_0", 60.0),
    ]
    assert uso_da_placa(lidas) == 100.0


def test_sem_motor_reconhecido_a_placa_nao_foi_medida():
    assert uso_da_placa([]) is None
    assert uso_da_placa([("_Total", 12.0), (None, 5.0)]) is None
    # leitura estragada (NaN) não entra na conta
    assert uso_da_placa([("pid_1_luid_0x0_0xA_phys_0_eng_0_engtype_3D", float("nan"))]) is None


# ───────────────────────────── o medidor ─────────────────────────────


class MaquinaDeTeste:
    """O que a "máquina" responde. `quebra` faz uma peça falhar sempre."""

    def __init__(self, cpu=20.0, memoria=50.0, gpu=10.0, mem_mb=300.0, quebra=()):
        self.valores = {"cpu": cpu, "memoria": memoria, "gpu": gpu, "processo_mem_mb": mem_mb}
        self.quebra = set(quebra)
        self.chamadas = {k: 0 for k in self.valores}
        self.fechada = False

    def _ler(self, peca):
        self.chamadas[peca] += 1
        if peca in self.quebra:
            raise OSError(f"{peca} não responde")
        return self.valores[peca]

    def cpu(self):
        return self._ler("cpu")

    def memoria(self):
        return self._ler("memoria")

    def gpu(self):
        return self._ler("gpu")

    def processo_mem_mb(self):
        return self._ler("processo_mem_mb")

    def pecas(self):
        return {"processador": "Processador de Teste", "placa_de_video": "Placa de Teste"}

    def memoria_total_gb(self):
        return 15.9

    def fechar(self):
        self.fechada = True


class Relogio:
    """Relógio e tempo de processo que andam quando o teste manda."""

    def __init__(self):
        self.parede = 100.0
        self.processo = 5.0

    def andar(self, parede, processo):
        self.parede += parede
        self.processo += processo


def medidor(tmp_path, maquina, relogio=None, nucleos=4):
    r = relogio or Relogio()
    return Medidor(tmp_path, sistema=maquina, relogio=lambda: r.parede, tempo_do_processo=lambda: r.processo, nucleos=nucleos)


def test_a_amostra_traz_o_que_a_maquina_respondeu_e_o_disco(tmp_path):
    a = medidor(tmp_path, MaquinaDeTeste(cpu=37.5, memoria=61.0, gpu=12.0, mem_mb=355.0)).amostra()

    assert (a.cpu, a.memoria, a.gpu, a.processo_mem_mb) == (37.5, 61.0, 12.0, 355.0)
    assert a.disco_total_gb is not None and a.disco_livre_gb is not None
    assert 0 < a.disco_livre_gb <= a.disco_total_gb


def test_o_que_a_maquina_nao_mede_fica_sem_numero_nao_zero(tmp_path):
    # Máquina sem contador de placa de vídeo, e a primeira leitura do
    # processador (que não tem com o que comparar).
    a = medidor(tmp_path, MaquinaDeTeste(cpu=None, gpu=None)).amostra()

    assert a.cpu is None and a.gpu is None
    assert a.memoria == 50.0


def test_a_parte_do_farol_e_do_processador_da_MAQUINA_inteira(tmp_path):
    r = Relogio()
    m = medidor(tmp_path, MaquinaDeTeste(), r, nucleos=4)

    assert m.amostra().processo_cpu is None, "a primeira amostra não tem com o que comparar"
    # 30 s de relógio, 6 s de processador deste processo, 4 núcleos:
    # 6 / (30 × 4) = 5% da máquina (e não 20% "de um núcleo").
    r.andar(30.0, 6.0)
    assert m.amostra().processo_cpu == pytest.approx(5.0)
    # relógio que não andou não divide por zero
    assert m.amostra().processo_cpu is None


def test_peca_que_falha_tres_vezes_para_de_ser_tentada_e_as_outras_seguem(tmp_path, caplog):
    maquina = MaquinaDeTeste(quebra={"gpu"})
    m = medidor(tmp_path, maquina)

    with caplog.at_level("WARNING", logger="farol_agent.uso"):
        amostras = [m.amostra() for _ in range(FALHAS_ATE_DESISTIR + 4)]

    assert all(a.gpu is None for a in amostras)
    assert all(a.cpu == 20.0 and a.memoria == 50.0 for a in amostras), "uma peça quebrada levou as outras junto"
    assert maquina.chamadas["gpu"] == FALHAS_ATE_DESISTIR, "continuou tentando a peça que não responde"
    assert maquina.chamadas["cpu"] == FALHAS_ATE_DESISTIR + 4
    avisos = [r for r in caplog.records if "gpu" in r.getMessage()]
    assert len(avisos) == 1, "o aviso da peça que não mede tem de sair UMA vez"


def test_peca_que_volta_a_responder_zera_a_contagem_de_falhas(tmp_path):
    maquina = MaquinaDeTeste(quebra={"cpu"})
    m = medidor(tmp_path, maquina)
    m.amostra()
    m.amostra()
    maquina.quebra.clear()

    assert m.amostra().cpu == 20.0
    maquina.quebra.add("cpu")
    # duas falhas de novo ainda não desistem: a contagem recomeçou
    m.amostra()
    m.amostra()
    maquina.quebra.clear()
    assert m.amostra().cpu == 20.0


def test_em_sistema_que_nao_se_sabe_medir_so_o_disco_e_o_processo_saem(tmp_path):
    r = Relogio()
    m = medidor(tmp_path, None, r)
    m.amostra()
    r.andar(10.0, 1.0)
    a = m.amostra()

    assert (a.cpu, a.memoria, a.gpu, a.processo_mem_mb) == (None, None, None, None)
    assert a.processo_cpu == pytest.approx(2.5)
    assert a.disco_livre_gb is not None
    assert m.pecas() == {"processador": None, "placa_de_video": None, "memoria_gb": None, "nucleos": 4}


def test_as_pecas_dizem_de_que_e_feita_a_maquina(tmp_path):
    m = medidor(tmp_path, MaquinaDeTeste(), nucleos=16)

    assert m.pecas() == {"processador": "Processador de Teste", "placa_de_video": "Placa de Teste", "memoria_gb": 15.9, "nucleos": 16}
    assert maquina_para_nuvem(m.pecas()) == {
        "processador": "Processador de Teste", "nucleos": 16, "memoriaGb": 15.9, "placaDeVideo": "Placa de Teste",
    }


@pytest.mark.skipif(not sys.platform.startswith(("win32", "linux")), reason="só Windows e Linux têm leitura de verdade")
def test_NESTA_maquina_a_leitura_de_verdade_devolve_numeros_que_fazem_sentido(tmp_path):
    """Sem dublê: as chamadas de sistema desta máquina, duas amostras."""
    m = Medidor(tmp_path)
    try:
        m.amostra()
        sum(i * i for i in range(300_000))  # um pouco de trabalho entre as duas
        a = m.amostra()
    finally:
        m.fechar()

    assert a.memoria is not None and 1 < a.memoria < 100
    assert a.cpu is None or 0 <= a.cpu <= 100
    assert a.gpu is None or 0 <= a.gpu <= 100
    assert a.processo_mem_mb is not None and a.processo_mem_mb > 1
    assert a.processo_cpu is not None and 0 <= a.processo_cpu <= 100
    pecas = m.pecas()
    assert pecas["nucleos"] >= 1 and pecas["memoria_gb"] and pecas["memoria_gb"] > 0.2


# ─────────────────────────── a fila, por hora ───────────────────────────


def _hora(fila, ts=BASE) -> dict:
    achadas = [dict(l) for l in fila._con.execute("select * from uso_hora") if l["hora"] == Fila.hora_de(ts)]
    assert len(achadas) == 1, f"esperava uma linha de uso para {Fila.hora_de(ts)}, achei {len(achadas)}"
    return achadas[0]


def test_a_hora_guarda_soma_quantidade_e_pico_de_cada_peca(fila):
    fila.somar_uso(BASE, Amostra(cpu=10, memoria=50, gpu=5, processo_cpu=2, processo_mem_mb=300, disco_livre_gb=64.5, disco_total_gb=223))
    fila.somar_uso(BASE + timedelta(seconds=30), Amostra(cpu=70, memoria=54, gpu=60, processo_cpu=6, processo_mem_mb=355, disco_livre_gb=64.4, disco_total_gb=223))
    fila.somar_uso(BASE + timedelta(seconds=60), Amostra(cpu=22, memoria=52, gpu=7, processo_cpu=3, processo_mem_mb=340, disco_livre_gb=64.3, disco_total_gb=223))

    l = _hora(fila)
    assert l["amostras"] == 3
    assert (l["cpu_soma"], l["cpu_n"], l["cpu_max"]) == (102, 3, 70)
    assert (l["mem_soma"], l["mem_n"], l["mem_max"]) == (156, 3, 54)
    assert (l["gpu_soma"], l["gpu_n"], l["gpu_max"]) == (72, 3, 60)
    assert (l["proc_cpu_soma"], l["proc_cpu_n"], l["proc_cpu_max"]) == (11, 3, 6)
    assert l["proc_mem_max_mb"] == 355
    # o disco é uma posição: vale a última leitura, não a média
    assert (l["disco_livre_gb"], l["disco_total_gb"]) == (64.3, 223)


def test_peca_sem_leitura_nao_entra_na_media_dela(fila):
    """Três amostras, a placa medida em uma só: a média dela é de UMA."""
    fila.somar_uso(BASE, Amostra(cpu=None, memoria=50, gpu=None))
    fila.somar_uso(BASE, Amostra(cpu=30, memoria=50, gpu=40))
    fila.somar_uso(BASE, Amostra(cpu=50, memoria=50, gpu=None))

    l = _hora(fila)
    assert l["amostras"] == 3
    assert (l["cpu_soma"], l["cpu_n"]) == (80, 2)
    assert (l["gpu_soma"], l["gpu_n"], l["gpu_max"]) == (40, 1, 40)
    assert (l["proc_cpu_n"], l["proc_cpu_max"], l["proc_mem_max_mb"], l["disco_livre_gb"]) == (0, None, None, None)


def test_cada_hora_tem_a_sua_linha(fila):
    fila.somar_uso(BASE, Amostra(cpu=10, memoria=40))
    fila.somar_uso(BASE + timedelta(hours=1), Amostra(cpu=90, memoria=60))

    assert _hora(fila)["cpu_max"] == 10
    assert _hora(fila, BASE + timedelta(hours=1))["cpu_max"] == 90
    assert [l["hora"] for l in fila.usos_a_subir()] == [Fila.hora_de(BASE), Fila.hora_de(BASE + timedelta(hours=1))]


def test_a_hora_so_fica_entregue_na_versao_que_subiu(fila):
    fila.somar_uso(BASE, Amostra(cpu=10, memoria=40))
    lidas = fila.usos_a_subir()
    # enquanto o pedido viajava, mais uma amostra entrou na mesma hora
    fila.somar_uso(BASE + timedelta(seconds=30), Amostra(cpu=20, memoria=40))

    fila.marcar_usos(lidas)

    pendentes = fila.usos_a_subir()
    assert len(pendentes) == 1 and pendentes[0]["amostras"] == 2, "a amostra que chegou no meio se perdeu"
    fila.marcar_usos(pendentes)
    assert fila.usos_a_subir() == []


def test_limpar_apaga_so_o_que_a_nuvem_ja_tem(fila):
    fila.somar_uso(BASE - timedelta(days=30), Amostra(cpu=10, memoria=40))
    fila.somar_uso(BASE - timedelta(days=29), Amostra(cpu=10, memoria=40))
    fila.marcar_usos([l for l in fila.usos_a_subir() if l["hora"] == Fila.hora_de(BASE - timedelta(days=30))])

    assert fila.limpar_usos(BASE - timedelta(days=15)) == 1
    restou = [l["hora"] for l in fila._con.execute("select hora from uso_hora")]
    assert restou == [Fila.hora_de(BASE - timedelta(days=29))], "apagou uma hora que ainda não tinha subido"


# ───────────────────────────── o contrato ─────────────────────────────


def linha_do_contrato() -> dict:
    """A linha da fila que, serializada, tem de dar exatamente o arquivo."""
    return {
        "hora": "2026-10-07T20:00:00-03:00",
        "amostras": 96,
        "cpu_soma": 1728.5, "cpu_n": 96, "cpu_max": 64.25,
        "mem_soma": 4896.0, "mem_n": 96, "mem_max": 55.1,
        "gpu_soma": 768.0, "gpu_n": 95, "gpu_max": 57.3,
        "proc_cpu_soma": 220.8, "proc_cpu_n": 95, "proc_cpu_max": 6.4,
        "proc_mem_max_mb": 355.2,
        "disco_livre_gb": 64.12, "disco_total_gb": 223.0,
        "versao": 96, "estado": 1,
    }


def test_a_hora_sai_EXATAMENTE_como_o_contrato():
    esperado = json.loads(CONTRATO.read_text(encoding="utf-8"))
    assert uso_para_nuvem(linha_do_contrato()) == esperado["hora"]
    assert set(maquina_para_nuvem({})) == set(esperado["maquina"])


def test_o_exemplo_do_contrato_e_possivel():
    # O arquivo ensina a conta: nenhuma média passa de 100 nem do pico.
    h = json.loads(CONTRATO.read_text(encoding="utf-8"))["hora"]
    for peca in ("cpu", "mem", "gpu", "processoCpu"):
        n = h[f"{peca}Amostras"]
        assert 0 < n <= h["amostras"]
        assert h[f"{peca}Soma"] / n <= h[f"{peca}Max"] <= 100
    assert h["discoLivreGb"] <= h["discoTotalGb"]


def test_a_linha_que_sai_da_FILA_de_verdade_tem_tudo_o_que_o_contrato_pede(fila):
    fila.somar_uso(BASE, Amostra(cpu=10, memoria=40, gpu=3, processo_cpu=1, processo_mem_mb=300, disco_livre_gb=64, disco_total_gb=223))

    corpo = uso_para_nuvem(fila.usos_a_subir()[0])

    assert set(corpo) == set(json.loads(CONTRATO.read_text(encoding="utf-8"))["hora"])
    assert not [k for k in corpo if "_" in k], "a API lê camelCase"
    assert "versao" not in corpo and "estado" not in corpo
    # a hora sobe com o fuso da loja, como no resumo
    assert corpo["hora"].endswith(("-03:00", "+00:00", "Z")) or corpo["hora"][-6] in "+-"


def test_peca_nunca_medida_sobe_como_nulo_no_pico(fila):
    fila.somar_uso(BASE, Amostra(cpu=10, memoria=40))

    corpo = uso_para_nuvem(fila.usos_a_subir()[0])

    assert (corpo["gpuAmostras"], corpo["gpuMax"], corpo["gpuSoma"]) == (0, None, 0.0)
    assert corpo["discoLivreGb"] is None


# ─────────────────────────── a volta da auditoria ───────────────────────────


class MedidorFixo:
    """Sempre a mesma amostra — ou uma exceção, sob encomenda."""

    def __init__(self, amostra=None, erro=None):
        self._amostra = amostra or Amostra(cpu=25.0, memoria=50.0, gpu=8.0, processo_cpu=2.0, processo_mem_mb=350.0, disco_livre_gb=64.0, disco_total_gb=223.0)
        self.erro = erro
        self.fechado = False

    def amostra(self):
        if self.erro:
            raise self.erro
        return self._amostra

    def pecas(self):
        return {"processador": "Processador de Teste", "placa_de_video": "Placa de Teste", "memoria_gb": 15.9, "nucleos": 16}

    def fechar(self):
        self.fechado = True


def montar(tmp_path, nuvem, medidor="um"):
    a = Auditoria(
        nuvem, str(tmp_path / "fila.db"),
        construir_fonte=lambda ponto: FonteBoa(ponto.id),
        construir_juiz=lambda cfg: JuizDeTeste(),
        medidor=MedidorFixo() if medidor == "um" else medidor,
    )
    a.montar(config_com_regra())
    return a


# Terça-feira ao meio-dia: dentro da janela da regra do dublê de configuração.
MEIO_DIA = BASE.replace(year=2026, month=10, day=6, hour=12, minute=0)


def test_cada_volta_mede_e_a_hora_sobe_com_a_maquina(tmp_path):
    nuvem = NuvemDeTeste()
    a = montar(tmp_path, nuvem)

    a.passo(MEIO_DIA)

    assert len(nuvem.usos_enviados) == 1
    corpo = nuvem.usos_enviados[0]
    assert corpo["maquina"] == {"processador": "Processador de Teste", "nucleos": 16, "memoriaGb": 15.9, "placaDeVideo": "Placa de Teste"}
    assert len(corpo["horas"]) == 1
    h = corpo["horas"][0]
    assert (h["amostras"], h["cpuSoma"], h["cpuMax"], h["gpuMax"], h["discoLivreGb"]) == (1, 25.0, 25.0, 8.0, 64.0)
    assert a.fila.usos_a_subir() == [], "a hora que subiu continuou marcada como pendente"


def test_o_uso_sobe_de_tempos_em_tempos_e_nao_a_cada_volta(tmp_path):
    nuvem = NuvemDeTeste()
    a = montar(tmp_path, nuvem)

    a.passo(MEIO_DIA)
    for s in (30, 60, 90):
        a.passo(MEIO_DIA + timedelta(seconds=s))
    assert len(nuvem.usos_enviados) == 1, "subiu a cada volta"

    a.passo(MEIO_DIA + timedelta(minutes=6))
    assert len(nuvem.usos_enviados) == 2
    # a mesma hora, agora com as cinco amostras: a nuvem troca o valor
    assert nuvem.usos_enviados[1]["horas"][0]["amostras"] == 5


def test_nuvem_fora_o_uso_fica_guardado_e_sobe_depois(tmp_path):
    nuvem = NuvemDeTeste(erro=ErroDaNuvem("sem rede", recuperavel=True))
    a = montar(tmp_path, nuvem)

    a.passo(MEIO_DIA)
    assert nuvem.usos_enviados == [] and len(a.fila.usos_a_subir()) == 1

    nuvem.erro = None
    a.passo(MEIO_DIA + timedelta(seconds=30))
    assert len(nuvem.usos_enviados) == 1
    assert nuvem.usos_enviados[0]["horas"][0]["amostras"] == 2


class NuvemSemARotaDeUso(NuvemDeTeste):
    """A API ainda não foi atualizada: evento e resumo entram, uso dá 404."""

    def _pedir(self, metodo, caminho, corpo=None):
        if caminho == "/v1/uso":
            self.tentativas_de_uso += 1
            raise ErroDaNuvem("404 em /v1/uso", recuperavel=False, status=404)
        return super()._pedir(metodo, caminho, corpo)


def test_nuvem_sem_a_rota_pausa_o_uso_diz_UMA_vez_e_o_resto_sobe(tmp_path, caplog):
    # O agente novo pode chegar antes da API nova: não pode martelar, nem
    # levar o evento ou o resumo junto.
    nuvem = NuvemSemARotaDeUso()
    a = montar(tmp_path, nuvem)

    with caplog.at_level("WARNING", logger="farol_agent.auditoria"):
        a.passo(MEIO_DIA)
        for minuto in range(1, 6):
            a.passo(MEIO_DIA + timedelta(minutes=minuto))

        assert nuvem.tentativas_de_uso == 1, "martelou a rota que não existe"
        assert len(nuvem.resumos_enviados) >= 1, "o uso recusado calou o resumo"
        assert len(a.fila.usos_a_subir()) == 1, "a hora recusada foi dada como entregue"

        # dez minutos depois tenta de novo (a nuvem pode ter sido atualizada)…
        a.passo(MEIO_DIA + timedelta(minutes=11))
        assert nuvem.tentativas_de_uso == 2

    # …e a MESMA causa não é dita de novo: uma linha, não uma a cada dez
    # minutos durante o mês em que a nuvem não foi atualizada.
    avisos = [r for r in caplog.records if "uso da máquina" in r.getMessage()]
    assert len(avisos) == 1


def test_medidor_que_estoura_nao_derruba_a_volta(tmp_path, caplog):
    nuvem = NuvemDeTeste()
    a = montar(tmp_path, nuvem, medidor=MedidorFixo(erro=RuntimeError("contador sumiu")))

    with caplog.at_level("ERROR", logger="farol_agent.auditoria"):
        r = a.passo(MEIO_DIA)

    assert r["enfileirados"] >= 1, "a volta parou por causa da medida"
    assert nuvem.usos_enviados == []


def test_sem_medidor_nada_e_medido_nem_mandado(tmp_path):
    nuvem = NuvemDeTeste()
    a = montar(tmp_path, nuvem, medidor=None)

    a.passo(MEIO_DIA)

    assert nuvem.tentativas_de_uso == 0
    assert a.fila._con.execute("select count(*) n from uso_hora").fetchone()["n"] == 0


def test_parar_fecha_o_medidor(tmp_path):
    m = MedidorFixo()
    a = montar(tmp_path, NuvemDeTeste(), medidor=m)

    a.parar()

    assert m.fechado
