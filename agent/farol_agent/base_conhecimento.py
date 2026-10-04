"""Base de conhecimento — o que "certo" parece, nesta loja.

É a peça que torna o caso comum gratuito. Em vez de perguntar a um modelo
"esta bancada está limpa?" trezentas vezes por dia, guarda-se um punhado de
quadros do que é uma bancada limpa **naquela loja, naquela câmera, naquela
luz**, e compara-se por embedding. Bate com o conhecido, está conforme, e
não custou chamada nenhuma.

Isso só funciona porque o enquadramento é fixo. Uma câmera que se mexe
invalida a base inteira em silêncio — por isso varifocal manual, travada,
e por isso o desvio de enquadramento é coisa que a sonda tem que medir.

## A banda de incerteza

Comparação não devolve só sim ou não. São três faixas:

    similaridade >= limiar            → conforme, de graça
    limiar > sim > limiar - margem    → não sei: escala para o modelo
    sim <= limiar - margem            → destoa do conhecido

A faixa do meio é o que impede a comparação de virar um gerador de alarme
falso. Cena nova e legítima — caixa de insumo novo, luz de fim de tarde —
cai nela e vai para quem sabe julgar, em vez de ser acusada de irregular
por ser apenas diferente.

`tipo`:
  `item`   — o objeto em si (um picles, uma fatia de queijo). Alimenta
             presença e contagem.
  `padrao` — a cena inteira num estado (bancada limpa, passagem livre).
             Alimenta comparação de estado.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

import numpy as np


class Embedder(Protocol):
    """Quem transforma imagem em vetor comparável."""

    dim: int

    def embed(self, imagem: np.ndarray) -> np.ndarray:
        """Vetor L2-normalizado de `dim` dimensões."""
        ...


def normalizar(v: np.ndarray) -> np.ndarray:
    """L2. Com o vetor normalizado, cosseno vira produto escalar."""
    n = float(np.linalg.norm(v))
    if n == 0.0:
        return v.astype(np.float32)
    return (v / n).astype(np.float32)


@dataclass
class BaseConhecimento:
    id: str
    nome: str
    tipo: str = "padrao"              # item | padrao
    limiar: float = 0.85
    margem: float = 0.06
    referencias: list[np.ndarray] = field(default_factory=list)

    def __post_init__(self) -> None:
        if not 0.0 < self.limiar <= 1.0:
            raise ValueError(f"base {self.id}: limiar fora de 0..1: {self.limiar}")
        if self.margem < 0:
            raise ValueError(f"base {self.id}: margem negativa")
        self.referencias = [normalizar(r) for r in self.referencias]

    def adicionar(self, vetor: np.ndarray) -> None:
        self.referencias.append(normalizar(vetor))

    @property
    def pronta(self) -> bool:
        """Base com poucas referências mente com confiança.

        Três é o mínimo honesto: uma só captura uma iluminação e um ângulo
        de objeto, e tudo que diferir vira "não conforme".
        """
        return len(self.referencias) >= 3

    def similaridade(self, vetor: np.ndarray) -> float:
        """Cosseno contra a referência MAIS PARECIDA.

        Máximo, não média: a base guarda variações legítimas da mesma coisa
        (manhã, noite, com e sem tábua). Tirar média de variações legítimas
        produz um ponto que não corresponde a nenhuma cena real.
        """
        if not self.referencias:
            return 0.0
        v = normalizar(vetor)
        return float(max(float(np.dot(v, r)) for r in self.referencias))


class EmbedderSigLIP:
    """SigLIP 2 por ONNX Runtime.

    Importação e carga tardias: o agente roda em modo simulado e em modo
    nuvem sem nunca tocar neste caminho, e exigir onnxruntime para abrir o
    CLI tornaria o desenvolvimento dependente do hardware da loja.
    """

    dim = 768

    def __init__(self, modelo: str, *, tamanho: int = 224) -> None:
        self.caminho = modelo
        self.tamanho = tamanho
        self._sessao = None

    def _carregar(self):
        if self._sessao is not None:
            return self._sessao
        try:
            import onnxruntime as ort
        except ImportError as e:
            raise RuntimeError(
                "onnxruntime não instalado — necessário para o juiz de comparação"
            ) from e

        from pathlib import Path

        if not Path(self.caminho).is_file():
            raise RuntimeError(
                f"modelo SigLIP não encontrado em {self.caminho}. "
                "O juiz de comparação não roda sem ele."
            )
        # OpenVINO quando houver iGPU Intel; CPU como rede de segurança.
        self._sessao = ort.InferenceSession(
            self.caminho,
            providers=["OpenVINOExecutionProvider", "CPUExecutionProvider"],
        )
        return self._sessao

    def embed(self, imagem: np.ndarray) -> np.ndarray:
        import cv2

        sessao = self._carregar()
        img = cv2.resize(imagem, (self.tamanho, self.tamanho), interpolation=cv2.INTER_AREA)
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        # Normalização do SigLIP: média 0,5 e desvio 0,5 em cada canal.
        img = (img - 0.5) / 0.5
        lote = np.transpose(img, (2, 0, 1))[None, ...].astype(np.float32)

        entrada = sessao.get_inputs()[0].name
        saida = sessao.run(None, {entrada: lote})[0]
        return normalizar(np.asarray(saida).reshape(-1))
