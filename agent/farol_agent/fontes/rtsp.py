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
import threading
import time
from datetime import datetime
from typing import Iterator

import cv2

from farol_agent.modelos import Frame

_log = logging.getLogger(__name__)

# Tem que ser definido ANTES de o FFmpeg ser carregado pelo OpenCV.
os.environ.setdefault(
    "OPENCV_FFMPEG_CAPTURE_OPTIONS",
    "rtsp_transport;tcp|stimeout;5000000|max_delay;500000",
)


class ErroDaFonte(Exception):
    def __init__(self, mensagem: str, *, dica: str | None = None) -> None:
        super().__init__(mensagem)
        self.dica = dica


def _abrir(url: str) -> cv2.VideoCapture:
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

    def __init__(self, url: str, nome: str) -> None:
        self.url = url
        self.nome = nome
        self._cap: cv2.VideoCapture | None = None
        self._ultimo: tuple[datetime, object] | None = None
        self._trava = threading.Lock()
        self._parar = threading.Event()
        self._thread: threading.Thread | None = None
        self.reconexoes = 0

    def iniciar(self) -> None:
        if self._thread is not None:
            return
        self._thread = threading.Thread(
            target=self._laco, name=f"rtsp-{self.nome}", daemon=True
        )
        self._thread.start()

    def _laco(self) -> None:
        espera = 1.0
        while not self._parar.is_set():
            cap = _abrir(self.url)
            if not cap.isOpened():
                cap.release()
                _log.warning("%s: não abriu; tentando em %.0fs", self.nome, espera)
                self.reconexoes += 1
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
    ) -> None:
        self.ponto_id = ponto_id
        self.url_main = url_main
        self.url_sub = url_sub
        self._sub = _LeitorContinuo(url_sub, f"{ponto_id}-sub") if url_sub else None
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

        cap = _abrir(self.url_main)
        if not cap.isOpened():
            cap.release()
            raise ErroDaFonte(
                f"não abri o main-stream de {self.ponto_id}",
                dica="confira usuário, senha e canal; e se o gravador não está no "
                "limite de conexões simultâneas",
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
