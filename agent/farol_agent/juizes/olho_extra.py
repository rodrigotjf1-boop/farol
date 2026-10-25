"""O OLHO DUPLO do juiz treinado (24/10/2026): um segundo modelo de visão ao lado do DINOv2, só para o NOME.

O dono, 24/10/2026: "pode ativar olho duplo". O juiz treinado (`juizes.treinado`) escolhe o nome do ingrediente por um
classificador sobre os vetores do DINOv2-small do agente. Aqui entra um SEGUNDO olho: cada vista vira os dois vetores lado
a lado (cada um com norma 1, e o par dividido por raiz de 2), e o classificador aprende sobre o par. O "é comida?", a
nota de cada ingrediente e o resto continuam pelo protótipo do DINOv2 — a mesma escala de sempre (`COMIDA_MIN`, a
dúvida, a certeza na conferência): o olho duplo muda o NOME, e mais nada.

**Medido no banco de provas** (as marcações do dono de 21 e 22/10, o ingrediente de cima pela família, a mesma cabeça):
DINOv2 sozinho, numa noite nova, 61% e 79%; com o SigLIP2 ao lado, 68% e 82%; juntas, 83/77% → 86/77%. O SigLIP2
compactado (int8) piora (59/63%): vai o arquivo cheio.

**O modelo** é o SigLIP2-base do Google (Apache-2.0), só a parte da imagem, em ONNX (onnx-community, revisão fixada) —
conferido pelo sha256, como o DINOv2. Ele não vem no pacote (372 MB): a instalação é um passo à parte, de propósito
(`farol-agent ingredientes instalar-olho-duplo`); o agente em serviço nunca baixa modelo sozinho. Sem o arquivo, o juiz
fica com o olho de sempre e o registro diz por quê, uma vez.

**Uma imagem por chamada**, como o DINOv2 (ERR-148), e pelos BYTES (ERR-111).
"""

from __future__ import annotations

import logging
from pathlib import Path

import cv2
import numpy as np

from farol_agent.juizes.base import ErroDoJuiz
from farol_agent.juizes.baixar import baixar_conferido
from farol_agent.juizes.detector import sha256_de
from farol_agent.juizes.ingrediente import LINHAS, normalizar

_log = logging.getLogger(__name__)

NOME = "siglip2-base-patch16-224 (imagem)"
ARQUIVO = "siglip2-base-imagem.onnx"
URL = ("https://huggingface.co/onnx-community/siglip2-base-patch16-224-ONNX/resolve/"
       "ba1f3b0843f24bc5417d38e19c37b287d719b2f4/onnx/vision_model.onnx")
SHA256 = "c0573e3f4140c3a7c4e9cc5912bd6b26a033b46a6a8e8af26cbea262b163bcad"
_LADO = 224


def preparar(img: np.ndarray) -> np.ndarray:
    """Como o SigLIP2 foi treinado (`preprocessor_config.json`): 224 x 224 direto, bilinear, RGB com média e desvio 0,5."""
    if img is None or img.ndim != 3 or img.shape[0] < 2 or img.shape[1] < 2:
        raise ValueError("imagem vazia")
    rgb = cv2.cvtColor(cv2.resize(img, (_LADO, _LADO), interpolation=cv2.INTER_LINEAR), cv2.COLOR_BGR2RGB)
    x = rgb.astype(np.float32) / 255.0
    return np.transpose((x - 0.5) / 0.5, (2, 0, 1))[None].astype(np.float32)


def instalar(pasta: str | Path) -> Path:
    """Baixa o modelo para `pasta` e só o aceita se o sha256 conferir (passo de INSTALAÇÃO, chamado de propósito)."""
    destino = Path(pasta) / ARQUIVO
    if destino.is_file() and sha256_de(destino) == SHA256:
        return destino
    # retomando de onde parou: na loja, 372 MB de uma vez não passam (ERR-151)
    return baixar_conferido(URL, destino, SHA256,
                            errado="o arquivo baixado não é o modelo do olho duplo medido (sha256 {}…): não usei")


class MotorSiglip:
    """O SigLIP2 pelo ONNX Runtime, no processador, com `LINHAS` linhas, pelos bytes (ERR-111)."""

    identidade = SHA256

    def __init__(self, caminho: str | Path, *, conferir_sha256: bool = True, linhas: int = LINHAS) -> None:
        self.caminho = Path(caminho)
        if not self.caminho.is_file():
            raise ErroDoJuiz(f"o modelo do olho duplo não está em {self.caminho} (farol-agent ingredientes "
                             "instalar-olho-duplo)", recuperavel=False)
        if conferir_sha256 and sha256_de(self.caminho) != SHA256:
            raise ErroDoJuiz("o modelo do olho duplo em disco não é o medido (sha256): não uso", recuperavel=False)
        try:
            import onnxruntime as ort
        except ImportError as e:  # pragma: no cover — depende do que está instalado
            raise ErroDoJuiz("falta o onnxruntime (pip install farol-agent[detector])", recuperavel=False) from e
        opcoes = ort.SessionOptions()
        opcoes.intra_op_num_threads = linhas
        opcoes.inter_op_num_threads = 1
        self._sessao = ort.InferenceSession(self.caminho.read_bytes(), opcoes, providers=["CPUExecutionProvider"])
        self._entrada = self._sessao.get_inputs()[0].name
        self._saidas = [o.name for o in self._sessao.get_outputs()]

    def vetor(self, img: np.ndarray) -> np.ndarray:
        r = dict(zip(self._saidas, self._sessao.run(None, {self._entrada: preparar(img)})))
        v = r["pooler_output"][0] if "pooler_output" in r else r[self._saidas[0]].reshape(-1)
        return normalizar(np.asarray(v, np.float32))


def juntar(principal: np.ndarray, extra: np.ndarray) -> np.ndarray:
    """O par lado a lado: cada vetor com norma 1, e o par com norma 1 (cada olho pesa o mesmo)."""
    return (np.concatenate([normalizar(principal), normalizar(extra)]) / np.sqrt(2.0)).astype(np.float32)
