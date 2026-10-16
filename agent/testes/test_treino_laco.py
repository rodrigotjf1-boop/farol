"""Uma volta da gravação de treino, do começo ao fim (A21, fatia T3d-1).

De ponta a ponta, sem nada de mentira no meio: o gravador de mentira grava VÍDEO DE VERDADE (AVI) da cena pedida —
a bancada desenhada, com as metades do pão como discos —; a captura densa decodifica, recorta a área de montagem e
dá a hora; a leitura acha o lanche; o corpo segue o contrato. De mentira só as pontas: o gravador, a nuvem e o
detector (que acha os discos pela cor). O que se protege:

- o caminho inteiro termina em "pronta", com o andamento em faixas e um lanche enviado pela rota do contrato;
- a volta que para (fora da hora, loja aberta) retoma na seguinte sem baixar de novo nem reenviar;
- cada parada tem destino: senha recusada e gravador sem o horário falham com o motivo; cancelada no console (409)
  para e apaga o que se guardou; nuvem fora, nada muda;
- o lanche recusado (422) não se repete.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import cv2
import numpy as np
import pytest

from farol_agent import gravacao_lida, treino, treino_laco, treino_lanches
from farol_agent.dvr.arquivo import ClienteDeArquivo, PedidoRecusado, PerfilDeArquivo, SemGravacao, Trecho, pedido_que_cobre
from farol_agent.nuvem import ErroDaNuvem

from .test_repasse_leitor import config

BRASILIA = timezone(timedelta(hours=-3))
ADIANTADO = timedelta(seconds=25)
FPS = 4
LARGURA, ALTURA = 960, 540
LARANJA = (0, 140, 255)
# A gravação: 19:30:00 a 19:32:00 (hora da loja), que a nuvem manda em UTC.
GRAVACAO = {
    "id": "6f1c2a3b-4d5e-4f60-8a71-b2c3d4e5f607", "chave": "console-0b1c2d3e", "pontoId": None, "canal": 4,
    "inicio": "2026-10-15T22:30:00.000Z", "fim": "2026-10-15T22:32:00.000Z", "origem": "gravador", "situacao": "fila",
}
PERFIL = treino_lanches.PerfilDaBancada(pao_px_min=50, pao_px_max=120, mexe=6.0, mudou=6.0, sumiu_s=12, parecido=0.5, duracao_minima_s=40)


def cena(no_gravador: datetime) -> np.ndarray:
    """A bancada na hora do gravador: o lanche (duas metades) de 19:30:30 a 19:31:40, e um ingrediente aos 19:31:00."""
    img = np.full((ALTURA, LARGURA, 3), 90, np.uint8)
    s = (no_gravador - datetime(2026, 10, 15, 19, 30, 0)).total_seconds()
    if 30 <= s < 100:
        for cx in (400, 490):
            cv2.circle(img, (cx, 343), 40, LARANJA, -1)
        if s >= 60:
            cv2.circle(img, (490, 343), 26, (30, 30, 30), -1)
    return img


class Gravador:
    """O cliente de arquivo de mentira: o mesmo pedido e a mesma conta de blocos do de verdade, e vídeo de verdade."""

    host = "gravador-de-mentira"
    ja_gravado = ClienteDeArquivo.ja_gravado
    espera_ate_gravar = ClienteDeArquivo.espera_ate_gravar

    def __init__(self, *, sem_gravacao=False, recusa=False):
        self.perfil = PerfilDeArquivo(bloco_s=2, atraso_s=180.0)
        self.sem_gravacao, self.recusa = sem_gravacao, recusa
        self.pedidos = 0

    def relogio(self):
        return ADIANTADO

    def baixar(self, canal, de, ate, destino):
        if self.recusa:
            raise PedidoRecusado("o gravador recusou a credencial")
        self.pedidos += 1
        if self.sem_gravacao:
            raise SemGravacao("o gravador respondeu sem nenhum byte de gravação nesse trecho")
        pedido = pedido_que_cobre(de, ate, 2)
        provisorio = Path(destino).with_suffix(".avi")
        w = cv2.VideoWriter(str(provisorio), cv2.VideoWriter_fourcc(*"MJPG"), FPS, (LARGURA, ALTURA))
        total = int(round((pedido.cobre_ate - pedido.comeco).total_seconds() * FPS))
        for i in range(total):
            w.write(cena(pedido.comeco + timedelta(seconds=i / FPS)))
        w.release()
        provisorio.replace(destino)
        return Trecho(canal=canal, de=pedido.comeco, ate=pedido.cobre_ate, blocos=pedido.blocos, caminho=Path(destino),
                      tamanho=Path(destino).stat().st_size, declarado=None, tipo="video/x-msvideo",
                      ate_o_primeiro_byte_s=0.1, total_s=0.2)


class Nuvem:
    def __init__(self):
        self.ativa = dict(GRAVACAO)
        self.andamentos: list[dict] = []
        self.lanches: list[dict] = []
        self.fora = False
        self.status_do_andamento: int | None = None
        self.status_do_lanche: int | None = None

    def gravacoes_de_treino(self):
        if self.fora:
            raise ErroDaNuvem("não cheguei na nuvem")
        return {"gravacoes": [self.ativa] if self.ativa else [], "apagar": []}

    def andamento_da_gravacao(self, gid, corpo):
        if self.status_do_andamento:
            raise ErroDaNuvem(f"{self.status_do_andamento}", status=self.status_do_andamento)
        self.andamentos.append(corpo)
        if corpo["situacao"] in ("pronta", "falhou"):
            self.ativa = None
        elif self.ativa:
            self.ativa = {**self.ativa, "situacao": "lendo"}
        return {"situacao": corpo["situacao"]}

    def lanche_de_treino(self, corpo):
        if self.status_do_lanche:
            raise ErroDaNuvem(f"{self.status_do_lanche}", status=self.status_do_lanche)
        self.lanches.append(corpo)
        return {"situacao": "conferir"}


class Detector:
    def __init__(self):
        self.chamadas = 0

    def caixas(self, imagem, classe, limite):
        self.chamadas += 1
        mascara = cv2.inRange(imagem, (0, 110, 215), (45, 175, 255))
        n, _, stats, _ = cv2.connectedComponentsWithStats(mascara)
        return [(float(x), float(y), float(x + w), float(y + h), 0.9) for x, y, w, h, area in stats[1:] if area >= 200]


def pecas(nuvem, gravador, **kw) -> treino_laco.Pecas:
    zona = gravacao_lida.quadro_do_canal(config(), 4)[1]
    base = dict(
        nuvem=nuvem, gravador_do_canal=lambda canal: gravador, zona_do_canal=lambda canal: zona, detector=Detector(),
        perfil=PERFIL, pode_buscar=lambda: True, pode_ler=lambda: True,
        agora=lambda: datetime(2026, 10, 15, 23, 0, tzinfo=timezone.utc),
        hora_do_computador=lambda: datetime(2026, 10, 15, 20, 0, 0),
        para_o_computador=lambda t: t.astimezone(BRASILIA).replace(tzinfo=None),
    )
    base.update(kw)
    return treino_laco.Pecas(**base)


# ───────────────────────────── o caminho inteiro ─────────────────────────────


def test_o_caminho_inteiro_termina_em_pronta_com_um_lanche_pela_rota_do_contrato(tmp_path):
    nuvem, gravador = Nuvem(), Gravador()
    assert treino_laco.volta(pecas(nuvem, gravador), tmp_path) == treino_laco.PRONTA

    [lanche] = nuvem.lanches
    assert lanche["gravacao"]["chave"] == GRAVACAO["chave"] and lanche["lanche"]["chave"] == "lanche-01"
    etapas = lanche["lanche"]["etapas"]
    assert etapas[0]["lado"] == "pao" and etapas[0]["inicio"] is True
    assert etapas[0]["hora"].startswith("2026-10-15T19:30:05"), "a hora da loja: o gravador estava 25 s adiantado"
    assert len(etapas) >= 2 and all(e["leu"] is None for e in etapas), "sem identificação, a etapa vai sem leitura"
    assert len(lanche["quadros"]) == len(etapas)

    situacoes = [a["situacao"] for a in nuvem.andamentos]
    assert situacoes[-1] == "pronta" and set(situacoes[:-1]) == {"lendo"}
    progressos = [a["progresso"] for a in nuvem.andamentos[:-1]]
    assert progressos == sorted(progressos) and progressos[-1] >= 85, "o andamento só anda para a frente, em faixas"
    assert progressos[0] <= 50 and any(50 < p <= 70 for p in progressos), "a busca até 50%; a captura densa até 70%"
    assert treino_laco.volta(pecas(nuvem, gravador), tmp_path) == treino_laco.NADA, "pronta: a nuvem não lista mais"


def test_a_volta_que_para_retoma_sem_baixar_de_novo_nem_reenviar(tmp_path):
    nuvem, gravador = Nuvem(), Gravador()
    # A loja abre durante a captura densa e fecha logo depois: só a primeira pergunta diz "não".
    respostas = iter([False])
    assert treino_laco.volta(pecas(nuvem, gravador, pode_ler=lambda: next(respostas, True)), tmp_path) == treino_laco.DEPOIS
    baixados = gravador.pedidos
    assert baixados == 4 and nuvem.lanches == [], "a busca terminou; a leitura esperou a hora"
    assert treino_laco.volta(pecas(nuvem, gravador), tmp_path) == treino_laco.PRONTA
    assert gravador.pedidos == baixados, "o trecho que veio não é pedido de novo"
    assert len(nuvem.lanches) == 1


def test_a_loja_que_abre_no_meio_da_leitura_dos_lanches_para_e_a_leitura_recomeca(tmp_path):
    nuvem, gravador = Nuvem(), Gravador()
    perguntas = []

    def pode_ler():
        perguntas.append(1)
        # 4 pedaços da captura densa e a pergunta antes dos lanches dizem "sim"; a do quadro 30 da leitura, "não".
        return len(perguntas) <= 5

    assert treino_laco.volta(pecas(nuvem, gravador, pode_ler=pode_ler), tmp_path) == treino_laco.DEPOIS
    assert nuvem.lanches == [] and treino_lanches.lanches_ja_lidos(tmp_path / GRAVACAO["chave"] / "lanches") is None
    fechada = pecas(nuvem, gravador, pode_ler=lambda: False)
    assert treino_laco.volta(fechada, tmp_path) == treino_laco.DEPOIS
    assert fechada.detector.chamadas == 0, "com a loja aberta, a leitura dos lanches nem começa"
    assert treino_laco.volta(pecas(nuvem, gravador), tmp_path) == treino_laco.PRONTA
    assert len(nuvem.lanches) == 1


def test_a_leitura_que_terminou_nao_chama_o_detector_de_novo(tmp_path):
    nuvem, gravador = Nuvem(), Gravador()
    nuvem.status_do_lanche = 503
    assert treino_laco.volta(pecas(nuvem, gravador), tmp_path) == treino_laco.DEPOIS
    nuvem.status_do_lanche = None
    outra = pecas(nuvem, gravador)
    assert treino_laco.volta(outra, tmp_path) == treino_laco.PRONTA
    assert outra.detector.chamadas == 0, "os lanches já lidos vêm do lanches.json"


def test_o_pronta_que_nao_entra_fica_para_a_volta_seguinte(tmp_path):
    nuvem = Nuvem()
    nuvem.status_do_andamento = 503
    assert treino_laco.volta(pecas(nuvem, Gravador()), tmp_path) == treino_laco.DEPOIS
    assert len(nuvem.lanches) == 1, "o andamento que não entra não para a leitura"


def test_sem_o_adianto_anotado_a_volta_mede_de_novo_e_nao_fica_presa(tmp_path):
    nuvem, gravador = Nuvem(), Gravador()
    assert treino_laco.volta(pecas(nuvem, gravador, pode_ler=lambda: False), tmp_path) == treino_laco.DEPOIS
    manifesto = tmp_path / GRAVACAO["chave"] / "trecho.json"
    dados = manifesto.read_text(encoding="utf-8").replace('"adiantoS"', '"outra"')
    manifesto.write_text(dados, encoding="utf-8")
    assert treino_laco.volta(pecas(nuvem, gravador), tmp_path) == treino_laco.PRONTA
    assert nuvem.lanches[0]["lanche"]["etapas"][0]["hora"].startswith("2026-10-15T19:30:05")


def test_o_envio_que_falha_de_passagem_nao_reenvia_o_que_ja_foi(tmp_path):
    nuvem, gravador = Nuvem(), Gravador()
    nuvem.status_do_andamento = None
    nuvem.status_do_lanche = 503
    assert treino_laco.volta(pecas(nuvem, gravador), tmp_path) == treino_laco.DEPOIS
    nuvem.status_do_lanche = None
    assert treino_laco.volta(pecas(nuvem, gravador), tmp_path) == treino_laco.PRONTA
    assert len(nuvem.lanches) == 1
    nuvem.ativa = dict(GRAVACAO, situacao="lendo")  # a nuvem perdeu o "pronta": a volta seguinte não reenvia
    assert treino_laco.volta(pecas(nuvem, gravador), tmp_path) == treino_laco.PRONTA
    assert len(nuvem.lanches) == 1


def test_o_lanche_recusado_nao_se_repete(tmp_path):
    nuvem, gravador = Nuvem(), Gravador()
    nuvem.status_do_lanche = 422
    assert treino_laco.volta(pecas(nuvem, gravador), tmp_path) == treino_laco.PRONTA
    nuvem.status_do_lanche = None
    nuvem.ativa = dict(GRAVACAO, situacao="lendo")
    treino_laco.volta(pecas(nuvem, gravador), tmp_path)
    assert nuvem.lanches == [], "o que a nuvem recusou por estar torto não vai de novo"


# ───────────────────────────── cada parada ─────────────────────────────


def test_fora_da_hora_nada_e_baixado(tmp_path):
    nuvem, gravador = Nuvem(), Gravador()
    assert treino_laco.volta(pecas(nuvem, gravador, pode_buscar=lambda: False), tmp_path) == treino_laco.DEPOIS
    assert gravador.pedidos == 0 and nuvem.andamentos == []


def test_senha_recusada_falha_com_o_motivo(tmp_path):
    nuvem = Nuvem()
    assert treino_laco.volta(pecas(nuvem, Gravador(recusa=True)), tmp_path) == treino_laco.FALHOU
    assert nuvem.andamentos[-1] == {"situacao": "falhou", "motivo": "o gravador recusou a senha do agente"}


def test_o_gravador_sem_o_horario_falha_com_o_motivo(tmp_path):
    nuvem = Nuvem()
    assert treino_laco.volta(pecas(nuvem, Gravador(sem_gravacao=True)), tmp_path) == treino_laco.FALHOU
    assert nuvem.andamentos[-1] == {"situacao": "falhou", "motivo": "o gravador não tinha mais esse horário"}


def test_sem_o_detector_ou_sem_o_perfil_da_bancada_a_gravacao_falha_na_leitura_com_o_motivo(tmp_path):
    # T3d-2: o computador sem o detector instalado, ou a loja ainda sem o perfil da bancada. O trecho é buscado e a
    # captura densa feita; a gravação falha na leitura dos lanches, com o motivo que a tela mostra — não fica presa.
    nuvem, gravador = Nuvem(), Gravador()
    assert treino_laco.volta(pecas(nuvem, gravador, detector=None), tmp_path / "sem-detector") == treino_laco.FALHOU
    assert gravador.pedidos > 0, "a busca aconteceu"
    assert nuvem.andamentos[-1] == {
        "situacao": "falhou", "motivo": "o detector não está instalado neste computador (farol-agent detector instalar)",
    }
    nuvem = Nuvem()
    assert treino_laco.volta(pecas(nuvem, Gravador(), perfil=None), tmp_path / "sem-perfil") == treino_laco.FALHOU
    assert nuvem.andamentos[-1] == {
        "situacao": "falhou", "motivo": "falta o perfil da bancada desta loja (os números da câmera, medidos na instalação)",
    }
    assert nuvem.lanches == []


def test_sem_canal_falha_com_o_motivo(tmp_path):
    nuvem = Nuvem()
    nuvem.ativa = dict(GRAVACAO, canal=None)
    assert treino_laco.volta(pecas(nuvem, Gravador()), tmp_path) == treino_laco.FALHOU
    assert nuvem.andamentos[-1]["motivo"] == "a gravação não diz de que canal é"


@pytest.mark.parametrize("do_canal,motivo", [
    (dict(numero=None), "o canal 4 não tem quadro desenhado"),
    (dict(canal=1), "o canal 4 não está na configuração"),
])
def test_o_canal_sem_o_quadro_da_bancada_falha_com_o_motivo_sem_buscar_no_gravador(tmp_path, do_canal, motivo):
    # 16/10/2026: a gravação no canal 1, sem quadro, virava um erro inesperado a cada volta (e a troca de pacote o via
    # na subida). Agora falha com o motivo que a tela mostra, antes de pedir o trecho ao gravador.
    c = config(**do_canal)
    nuvem, gravador = Nuvem(), Gravador()
    zona_do_canal = lambda canal: gravacao_lida.quadro_do_canal(c, canal)[1]  # noqa: E731 — como o serviço monta
    assert treino_laco.volta(pecas(nuvem, gravador, zona_do_canal=zona_do_canal), tmp_path) == treino_laco.FALHOU
    assert gravador.pedidos == 0, "sem o quadro, nada é pedido ao gravador"
    assert nuvem.andamentos == [{
        "situacao": "falhou",
        "motivo": f"{motivo}: a gravação de treino precisa do canal com o quadro da bancada (a área da montagem)",
    }]
    assert len(nuvem.andamentos[0]["motivo"]) <= treino.MAX_MOTIVO, "o motivo inteiro chega à tela"


def test_cancelada_no_console_para_e_apaga_o_que_guardou(tmp_path):
    nuvem, gravador = Nuvem(), Gravador()
    assert treino_laco.volta(pecas(nuvem, gravador, pode_ler=lambda: False), tmp_path) == treino_laco.DEPOIS
    assert (tmp_path / GRAVACAO["chave"]).is_dir()
    nuvem.status_do_andamento = 409
    assert treino_laco.volta(pecas(nuvem, gravador), tmp_path) == treino_laco.PAROU
    assert not (tmp_path / GRAVACAO["chave"]).exists()
    assert nuvem.lanches == [], "cancelada: nenhum lanche dela sai depois"


def test_a_gravacao_que_nao_e_desta_loja_e_esquecida_e_a_credencial_que_nao_vale_nao_apaga_nada(tmp_path):
    nuvem, gravador = Nuvem(), Gravador()
    assert treino_laco.volta(pecas(nuvem, gravador, pode_ler=lambda: False), tmp_path) == treino_laco.DEPOIS
    nuvem.status_do_andamento = 401
    assert treino_laco.volta(pecas(nuvem, gravador), tmp_path) == treino_laco.PAROU
    assert (tmp_path / GRAVACAO["chave"]).is_dir(), "o token que não vale não apaga o que a loja guardou"
    nuvem.status_do_andamento = 404
    assert treino_laco.volta(pecas(nuvem, gravador), tmp_path) == treino_laco.PAROU
    assert not (tmp_path / GRAVACAO["chave"]).exists()


def test_o_lanche_da_gravacao_encerrada_para_e_apaga(tmp_path):
    nuvem, gravador = Nuvem(), Gravador()
    nuvem.status_do_lanche = 409
    assert treino_laco.volta(pecas(nuvem, gravador), tmp_path) == treino_laco.PAROU
    assert not (tmp_path / GRAVACAO["chave"]).exists()


def test_a_nuvem_fora_nao_muda_nada(tmp_path):
    nuvem = Nuvem()
    nuvem.fora = True
    assert treino_laco.volta(pecas(nuvem, Gravador()), tmp_path) == treino_laco.SEM_NUVEM
    assert list(tmp_path.iterdir()) == []


def test_o_que_a_nuvem_manda_apagar_sai_antes_de_tudo(tmp_path):
    (tmp_path / "carga-velha").mkdir()
    nuvem = Nuvem()
    nuvem.ativa = None
    nuvem.gravacoes_de_treino = lambda: {"gravacoes": [], "apagar": ["carga-velha"]}
    assert treino_laco.volta(pecas(nuvem, Gravador()), tmp_path) == treino_laco.NADA
    assert not (tmp_path / "carga-velha").exists()
