"""O JUIZ TREINADO (23/10/2026): o nome do ingrediente de cada passo por um classificador TREINADO nos exemplos da loja.

O dono, 23/10/2026: "vamos treinar o juiz logo sem demora" e "sempre com opção de aprendizado no que vai se
descobrindo". O juiz de hoje (`juizes.ingrediente`) compara o recorte com a MÉDIA das fotos de cada ingrediente (o
protótipo) e não aprende nada além dela. Aqui, sobre os MESMOS vetores do DINOv2 do agente:

- cada exemplo de UM nome da base da loja (os que o dono marcou nas fichas e os que a conferência por passo devolve)
  entra nas 8 VISTAS (0, 90, 180 e 270 graus, com e sem espelho): a bancada é vista de cima, e girar o lanche não muda
  o ingrediente;
- uma regressão logística (softmax com L2, classes equilibradas) aprende a separar os nomes — só numpy, sem pacote
  novo; refeita quando a base muda (a conferência acrescenta exemplos: o juiz aprende com o que o dono confere);
- na consulta, o nome do ingrediente é o mais provável que não é pão; o "é comida?" e as notas continuam pelo protótipo
  (a mesma escala que os passos e a conferência usam — `COMIDA_MIN`, o "já estava no começo").

**Medido no banco de provas** (111 recortes marcados pelo dono na noite de 21/10, o ingrediente de cima, pela família,
cada lanche testado SEM as marcações dele; o modelo int8 do agente): protótipo de hoje 50%; o exemplo mais parecido 67%;
treinado 83% (81% pelo nome); treinado só nas marcações e testado nas fotos da base (outra noite) 73%. Só com a base da
loja (sem as marcações): 57%. O que mais pesa são exemplos que são recortes de passo de verdade — os que a conferência
traz. O classificador só com numpy dá o mesmo do scikit-learn (83%).

**Uma imagem por chamada** ao modelo: o int8 dinâmico devolve outro vetor em lote (ERR-148); os vetores guardados das
vistas levam o modelo e a versão.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Callable, Iterable

import cv2
import numpy as np

from farol_agent.juizes.ingrediente import (
    COMIDA_MIN,
    MODELO_SHA256,
    JuizDeIngrediente,
    Nota,
    e_pao,
    normalizar,
)

_log = logging.getLogger(__name__)

# As vistas de cada exemplo no treino (as 8) e o que entra na guarda dos vetores.
VISTAS = 8
VERSAO_DAS_VISTAS = 1
# A regressão: o inverso da força do L2 (como o C do scikit-learn) e as voltas do Adam — medidos no banco de provas
# (C de 0,5 a 8 dá 81 a 83%; 200 voltas = 400 voltas).
C_PADRAO = 2.0
VOLTAS = 200
PASSO = 0.05
# Menos que isto de nomes, não há o que separar: fica o juiz de protótipo.
NOMES_MINIMO = 2


def vistas(img: np.ndarray) -> list[np.ndarray]:
    """As 8 vistas: 0, 90, 180 e 270 graus, sem e com espelho (a primeira é a imagem como veio)."""
    out = []
    for espelho in (False, True):
        base = cv2.flip(img, 1) if espelho else img
        for giro in (None, cv2.ROTATE_90_CLOCKWISE, cv2.ROTATE_180, cv2.ROTATE_90_COUNTERCLOCKWISE):
            out.append(base if giro is None else cv2.rotate(base, giro))
    return out


class Classificador:
    """Regressão logística multinomial em numpy: a perda é a entropia cruzada com as classes EQUILIBRADAS (peso
    n / (k · n_classe), como o `class_weight="balanced"`) mais ||W||² / (2·C·n); Adam a partir de zero (determinístico)."""

    def __init__(self, c: float = C_PADRAO, voltas: int = VOLTAS, passo: float = PASSO) -> None:
        self.c, self.voltas, self.passo = c, voltas, passo
        self.classes: list[str] = []
        self.W = np.zeros((0, 0), np.float32)
        self.b = np.zeros(0, np.float32)

    def ajustar(self, X: np.ndarray, y: list[str]) -> "Classificador":
        self.classes = sorted(set(y))
        indice = {c: i for i, c in enumerate(self.classes)}
        t = np.array([indice[c] for c in y])
        n, d = X.shape
        k = len(self.classes)
        peso = (n / (k * np.bincount(t, minlength=k)))[t].astype(np.float32)
        Y = np.zeros((n, k), np.float32)
        Y[np.arange(n), t] = 1.0
        W = np.zeros((d, k), np.float32)
        b = np.zeros(k, np.float32)
        m = [np.zeros_like(W), np.zeros_like(b)]
        v = [np.zeros_like(W), np.zeros_like(b)]
        for volta in range(1, self.voltas + 1):
            P = self._softmax(X @ W + b)
            G = (P - Y) * peso[:, None] / n
            grad = (X.T @ G + W / (self.c * n), G.sum(axis=0))
            for i, g in enumerate(grad):
                m[i] = 0.9 * m[i] + 0.1 * g
                v[i] = 0.999 * v[i] + 0.001 * g * g
                passo = self.passo * (m[i] / (1 - 0.9 ** volta)) / (np.sqrt(v[i] / (1 - 0.999 ** volta)) + 1e-8)
                if i == 0:
                    W -= passo
                else:
                    b -= passo
        self.W, self.b = W, b
        return self

    @staticmethod
    def _softmax(Z: np.ndarray) -> np.ndarray:
        Z = Z - Z.max(axis=1, keepdims=True)
        P = np.exp(Z)
        return P / P.sum(axis=1, keepdims=True)

    def probabilidades(self, X: np.ndarray) -> np.ndarray:
        return self._softmax(np.atleast_2d(X) @ self.W + self.b)


def vetores_das_vistas(
    vetor: Callable[[np.ndarray], np.ndarray], exemplos: Iterable[tuple[str, str]],
    abrir: Callable[[str], np.ndarray | None], *, guardados: Path | None = None,
) -> list[tuple[str, np.ndarray]]:
    """(nome, vetores das 8 vistas) de cada exemplo que abre. Os vetores ficam guardados por sha256 em `guardados` (um
    .npz com o modelo e a versão): o modelo só olha o exemplo novo, uma vista por chamada."""
    guarda: dict[str, np.ndarray] = {}
    if guardados is not None and guardados.is_file():
        try:
            with np.load(guardados, allow_pickle=False) as z:
                if str(z["modelo"]) == MODELO_SHA256 and int(z["versao"]) == VERSAO_DAS_VISTAS:
                    guarda = {str(s): v for s, v in zip(z["shas"], z["vetores"])}
        except (OSError, ValueError, KeyError):
            guarda = {}
    usados: dict[str, np.ndarray] = {}
    saida = []
    for nome, sha in exemplos:
        v8 = guarda.get(sha)
        if v8 is None:
            img = abrir(sha)
            if img is None:
                continue
            v8 = np.stack([vetor(x) for x in vistas(img)]).astype(np.float32)
        usados[sha] = v8
        saida.append((nome, v8))
    if guardados is not None and set(usados) != set(guarda):
        try:
            guardados.parent.mkdir(parents=True, exist_ok=True)
            temporario = guardados.with_name(guardados.name + ".novo.npz")
            shas = sorted(usados)
            np.savez(temporario, modelo=MODELO_SHA256, versao=VERSAO_DAS_VISTAS, shas=np.array(shas),
                     vetores=np.stack([usados[s] for s in shas]) if shas else np.zeros((0, VISTAS, 1), np.float32))
            os.replace(temporario, guardados)
        except OSError as e:
            _log.warning("juiz treinado: não guardei os vetores das vistas (%s)", e)
    return saida


def treinar(vetores: list[tuple[str, np.ndarray]], *, c: float = C_PADRAO) -> Classificador | None:
    """O classificador dos exemplos (cada vista é um exemplo); nulo com menos de `NOMES_MINIMO` nomes."""
    if len({n for n, _ in vetores}) < NOMES_MINIMO:
        return None
    X = np.concatenate([v8 for _, v8 in vetores]).astype(np.float32)
    y = [n for n, v8 in vetores for _ in range(len(v8))]
    return Classificador(c=c).ajustar(X, y)


class JuizTreinado(JuizDeIngrediente):
    """O juiz de protótipo com o NOME do ingrediente vindo do classificador treinado. O mais parecido de todos (o "é
    comida?") e as notas seguem pelo protótipo; `vistas_na_consulta` = 1 (o custo de hoje) ou 8 (8 chamadas por recorte)."""

    def __init__(self, vetor: Callable[[np.ndarray], np.ndarray], prototipos: dict[str, np.ndarray],
                 classificador: Classificador, *, vistas_na_consulta: int = 1, comida_min: float = COMIDA_MIN) -> None:
        super().__init__(vetor, prototipos, comida_min=comida_min)
        self.classificador = classificador
        self.vistas_na_consulta = 8 if vistas_na_consulta == 8 else 1

    def julgar(self, img: np.ndarray) -> Nota:
        v0 = self._vetor(img)
        notas = self._matriz @ v0
        ordem = np.argsort(-notas)
        melhor = int(ordem[0])
        vs = [v0] + ([self._vetor(x) for x in vistas(img)[1:]] if self.vistas_na_consulta == 8 else [])
        p = self.classificador.probabilidades(np.stack(vs)).mean(axis=0)
        nome_ing = next((self.classificador.classes[int(i)] for i in np.argsort(-p)
                         if not e_pao(self.classificador.classes[int(i)])), None)
        if nome_ing is None:
            sem_pao = next((int(i) for i in ordem if not e_pao(self.nomes[int(i)])), None)
            nome_ing = self.nomes[sem_pao] if sem_pao is not None else None
        nota_ing = float(notas[self.nomes.index(nome_ing)]) if nome_ing in self.nomes else 0.0
        return Nota(self.nomes[melhor], round(float(notas[melhor]), 3), nome_ing, round(nota_ing, 3), self.comida_min)


def montar(vetor: Callable[[np.ndarray], np.ndarray], prototipos: dict[str, np.ndarray],
           exemplos: list[tuple[str, str]], abrir: Callable[[str], np.ndarray | None], *,
           guardados: Path | None = None, vistas_na_consulta: int = 1) -> tuple[JuizDeIngrediente, str]:
    """O juiz treinado da base, ou o de protótipo (com o motivo) quando não há o que treinar."""
    vetores = vetores_das_vistas(vetor, exemplos, abrir, guardados=guardados)
    clf = treinar(vetores)
    if clf is None:
        return JuizDeIngrediente(vetor, prototipos), "menos de 2 ingredientes com exemplo: fica o juiz de protótipo"
    juiz = JuizTreinado(vetor, prototipos, clf, vistas_na_consulta=vistas_na_consulta)
    return juiz, f"juiz TREINADO: {len(clf.classes)} ingredientes, {len(vetores)} exemplos x {VISTAS} vistas"


def vistas_da_consulta(valor: str | None) -> int:
    """`FAROL_BANCADA_JUIZ_TREINADO_VISTAS`: "8" consulta as 8 vistas; o resto, só a imagem (1)."""
    return 8 if (valor or "").strip() == "8" else 1
