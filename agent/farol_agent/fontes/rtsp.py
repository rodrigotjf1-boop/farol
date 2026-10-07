"""Fonte RTSP — o gravador e as câmeras IP de verdade.

Dois fluxos, com papéis diferentes:

  **sub, contínuo** — resolução baixa, aberto o tempo todo. É o que
  responde rápido quando o gatilho dispara, porque já está conectado.
  Abrir um RTSP leva de um a três segundos (conexão, negociação, esperar
  o quadro-chave), e regra urgente tem dois segundos **no total**.

  **main, sob demanda** — resolução cheia, aberto só quando vale julgar.
  Manter dezesseis main-streams abertos consumiria a banda do gravador
  inteiro (o MHDX tem 96 Mbps de throughput) para quase nada.

## O buffer é a armadilha

`cv2.VideoCapture` **acumula** quadros. Quem abre e lê de vez em quando
recebe o quadro que estava na fila, não o de agora — e num alerta de
cozinha isso significa julgar uma cena que já passou. O quadro parece
bom, o veredito parece razoável, e está errado por trinta segundos.

Por isso o fluxo contínuo tem um leitor próprio, drenando sempre e
guardando **só o último**. Quem pede um quadro recebe o mais recente, com
o instante em que ele foi lido.

## Transporte em TCP

O padrão do FFmpeg é UDP, que perde pacote e produz quadro rasgado —
justo o que estraga julgamento por imagem. Na rede local de uma loja o
custo do TCP é irrelevante perto do estrago de um quadro corrompido.
"""

from __future__ import annotations

import logging
import os
import socket
import threading
import time
from datetime import datetime
from typing import Iterator

import cv2

from farol_agent.modelos import Frame

_log = logging.getLogger(__name__)

# Tem que ser definido ANTES de o FFmpeg ser carregado pelo OpenCV.
#
# `timeout` E `stimeout` os dois, de propósito: o nome mudou no FFmpeg 5 e
# o antigo virou obsoleto. Qual deles vale depende da build que veio junto
# com o OpenCV instalado, e opção desconhecida é ignorada — então mandar
# os dois custa nada e cobre as duas gerações.
#
# Medido em 06/10/2026: com só `stimeout`, uma câmera desligada levou
# **30 segundos** para falhar (o padrão do FFmpeg), não os 5 configurados.
# Trinta segundos é tempo demais: o usuário desiste da tela antes, e numa
# loja com várias câmeras fora do ar o agente fica preso numa fila de
# esperas em vez de atender o resto.
os.environ.setdefault(
    "OPENCV_FFMPEG_CAPTURE_OPTIONS",
    "rtsp_transport;tcp|timeout;5000000|stimeout;5000000|max_delay;500000",
)


class ErroDaFonte(Exception):
    def __init__(self, mensagem: str, *, dica: str | None = None) -> None:
        super().__init__(mensagem)
        self.dica = dica


# ─────────────── canal que não responde não segura os outros ───────────────
# Medido na loja em 07/10/2026: um canal cadastrado com o endereço antigo do
# gravador levava **30 segundos** para desistir, a cada tentativa — e, nesse
# tempo, NENHUM outro canal abria. O OpenCV abre um fluxo de cada vez (é uma
# trava dele, global), então quem espera uma resposta que não vem prende a
# fila inteira. As opções de `timeout` do FFmpeg, acima, não seguraram: quem
# cortou em 30 s foi o limite do próprio OpenCV.
#
# Duas defesas, e a primeira é a que resolve:
#
#  1. Antes de chamar o OpenCV, perguntar à rede se alguém atende naquele
#     endereço. É uma conexão TCP comum, fora da trava, com 1,5 s de limite.
#     Não atendeu, nem se tenta abrir.
#  2. Dizer ao OpenCV para desistir em 5 s, não em 30 — para o caso de o
#     gravador atender e depois calar.
ALCANCE_SEG = 1.5
ABRIR_MS = 5000
LER_MS = 5000


def alcanca(host: str, porta: int, limite: float = ALCANCE_SEG) -> bool:
    """Alguém atende em `host:porta`? Pergunta barata, fora do OpenCV."""
    try:
        with socket.create_connection((host, porta), timeout=limite):
            return True
    except OSError:
        return False


def _abrir(url: str) -> cv2.VideoCapture:
    parametros: list[int] = []
    for nome, valor in (("CAP_PROP_OPEN_TIMEOUT_MSEC", ABRIR_MS), ("CAP_PROP_READ_TIMEOUT_MSEC", LER_MS)):
        prop = getattr(cv2, nome, None)
        if prop is not None:
            parametros += [int(prop), valor]
    try:
        cap = (
            cv2.VideoCapture(url, cv2.CAP_FFMPEG, parametros)
            if parametros
            else cv2.VideoCapture(url, cv2.CAP_FFMPEG)
        )
    except (TypeError, cv2.error):
        # OpenCV antigo, sem a forma com parâmetros: abre como sempre abriu.
        cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
    # Buffer de 1: pede ao backend para não acumular. Nem todo backend
    # respeita — por isso o leitor contínuo drena mesmo assim.
    try:
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    except cv2.error:
        pass
    return cap


class _LeitorContinuo:
    """Drena o fluxo numa thread e guarda só o quadro mais recente."""

    def __init__(self, url: str, nome: str, alcance: tuple[str, int] | None = None) -> None:
        self.url = url
        self.nome = nome
        # `(host, porta)` do gravador, quando se sabe. É o que permite
        # perguntar à rede antes de prender a fila do OpenCV.
        self.alcance = alcance
        self._cap: cv2.VideoCapture | None = None
        self._ultimo: tuple[datetime, object] | None = None
        self._trava = threading.Lock()
        self._parar = threading.Event()
        self._thread: threading.Thread | None = None
        self.reconexoes = 0
        # Por que não há imagem, em português, sem endereço nem senha.
        # `None` enquanto está tudo bem. É o que a página dos canais mostra.
        self.ultimo_erro: str | None = None
        self._avisou = False

    def iniciar(self) -> None:
        if self._thread is not None:
            return
        self._thread = threading.Thread(
            target=self._laco, name=f"rtsp-{self.nome}", daemon=True
        )
        self._thread.start()

    def _falhou(self, motivo: str, detalhe: str = "") -> None:
        """Registra a falha UMA vez por sequência. Canal fora do ar tenta de
        novo para sempre; um aviso a cada tentativa afogaria o log e
        esconderia a falha seguinte (a lição do ERR-014)."""
        self.ultimo_erro = motivo
        self.reconexoes += 1
        if not self._avisou:
            self._avisou = True
            _log.warning(
                "%s: %s%s. Sigo tentando, sem repetir este aviso.",
                self.nome, motivo, f" ({detalhe})" if detalhe else "",
            )

    def _laco(self) -> None:
        espera = 1.0
        while not self._parar.is_set():
            if self.alcance is not None and not alcanca(*self.alcance):
                self._falhou("o gravador não respondeu na rede", "%s:%s" % self.alcance)
                if self._parar.wait(espera):
                    return
                espera = min(espera * 2, 15.0)
                continue

            cap = _abrir(self.url)
            if not cap.isOpened():
                cap.release()
                self._falhou("o canal não abriu (usuário, senha ou número do canal?)")
                if self._parar.wait(espera):
                    return
                espera = min(espera * 2, 15.0)
                continue

            espera = 1.0
            self._cap = cap
            while not self._parar.is_set():
                ok, quadro = cap.read()
                if not ok:
                    # Fluxo caiu. Na loja isso acontece: gravador reinicia,
                    # cabo balança, câmera troca para infravermelho.
                    _log.info("%s: fluxo interrompido, religando", self.nome)
                    self.reconexoes += 1
                    break
                if self._avisou:
                    _log.info("%s: voltou depois de %d tentativa(s)", self.nome, self.reconexoes)
                    self._avisou = False
                self.ultimo_erro = None
                with self._trava:
                    self._ultimo = (datetime.now(), quadro)
            cap.release()
            self._cap = None

    def ultimo(self, idade_maxima_seg: float = 5.0) -> tuple[datetime, object] | None:
        """O quadro mais recente, se não for velho demais.

        A idade importa: quadro de dez segundos atrás, entregue como se
        fosse de agora, produz veredito sobre cena que já passou.
        """
        with self._trava:
            atual = self._ultimo
        if atual is None:
            return None
        if (datetime.now() - atual[0]).total_seconds() > idade_maxima_seg:
            return None
        return atual

    def parar(self) -> None:
        self._parar.set()
        if self._thread is not None:
            self._thread.join(timeout=3)
            self._thread = None


class FonteRTSP:
    """Fonte de quadros de um ponto, com sub contínuo e main sob demanda."""

    def __init__(
        self,
        ponto_id: str,
        url_main: str,
        url_sub: str | None = None,
        *,
        abrir_sub: bool = True,
        alcance: tuple[str, int] | None = None,
    ) -> None:
        self.ponto_id = ponto_id
        self.url_main = url_main
        self.url_sub = url_sub
        # `(host, porta)` do gravador: ver "canal que não responde não segura
        # os outros", no topo deste arquivo.
        self.alcance = alcance
        self._sub = _LeitorContinuo(url_sub, f"{ponto_id}-sub", alcance) if url_sub else None
        if self._sub is not None and abrir_sub:
            self._sub.iniciar()

    # ───────────────────────── contrato ─────────────────────────

    def quadro(self, ts: datetime, stream: str = "main") -> Frame | None:
        """Um quadro agora. `ts` é ignorado: RTSP não tem passado.

        A assinatura é a mesma do sandbox de propósito — o pipeline roda
        idêntico nos dois, e o que foi calibrado lá vale aqui.
        """
        if stream == "sub" and self._sub is not None:
            atual = self._sub.ultimo()
            if atual is None:
                return None
            quando, imagem = atual
            return Frame(imagem=imagem, ts=quando, ponto_id=self.ponto_id, stream="sub")

        quadros = self.rajada(ts, quantidade=1, stream=stream)
        return quadros[0] if quadros else None

    def rajada(
        self, ts: datetime, quantidade: int = 6, stream: str = "main"
    ) -> list[Frame]:
        """Vários quadros seguidos, para o pipeline escolher o mais nítido.

        Os primeiros quadros depois de abrir um RTSP costumam vir do
        buffer e trazer artefato — é por isso que o pipeline descarta os
        primeiros em vez de confiar no primeiro que chega.
        """
        if stream == "sub" and self._sub is not None:
            saida = []
            for _ in range(quantidade):
                atual = self._sub.ultimo()
                if atual is None:
                    break
                quando, imagem = atual
                saida.append(
                    Frame(imagem=imagem, ts=quando, ponto_id=self.ponto_id, stream="sub")
                )
                time.sleep(0.12)
            return saida

        if self.alcance is not None and not alcanca(*self.alcance):
            # Nem chama o OpenCV: ele esperaria, com a fila dos outros
            # canais presa atrás.
            raise ErroDaFonte(
                "o gravador não respondeu na rede (%s:%s)" % self.alcance,
                dica="o gravador está ligado e neste endereço? Confira o endereço "
                "do canal no console",
            )

        cap = _abrir(self.url_main)
        if not cap.isOpened():
            cap.release()
            raise ErroDaFonte(
                f"não abri o main-stream de {self.ponto_id}",
                # A ordem é a da frequência real, não a da gravidade: o
                # cabo solto e o gravador desligado respondem por quase
                # tudo, e sugerir "confira a senha" primeiro manda a
                # pessoa mexer no que estava certo.
                dica="o gravador está ligado e na rede? Depois disso: usuário, "
                "senha e número do canal; e se o gravador não está no limite "
                "de conexões simultâneas",
            )
        try:
            saida = []
            for _ in range(quantidade):
                ok, imagem = cap.read()
                if not ok:
                    break
                saida.append(
                    Frame(
                        imagem=imagem,
                        ts=datetime.now(),
                        ponto_id=self.ponto_id,
                        stream="main",
                    )
                )
            return saida
        finally:
            cap.release()

    def intervalo(
        self, ini: datetime, fim: datetime, fps: float = 2.0, stream: str = "sub"
    ) -> Iterator[Frame]:
        """Sequência ao vivo até `fim`. Alimenta regra de `acao`."""
        passo = 1.0 / fps if fps > 0 else 1.0
        while datetime.now() < fim:
            f = self.quadro(datetime.now(), stream=stream)
            if f is not None:
                yield f
            time.sleep(passo)

    def fechar(self) -> None:
        if self._sub is not None:
            self._sub.parar()
