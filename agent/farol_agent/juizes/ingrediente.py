"""O juiz de INGREDIENTE (A23.3): o recorte de um passo é de um ingrediente cadastrado da loja, ou é "nada"?

O dono, 21/10/2026, vendo os recortes dos passos da primeira noite ao vivo: "tem momentos que não é eficaz, marca
quando não tem ingredientes, tem cortes sem nada na imagem"; "o recorte tem sempre que ser focado em ingredientes, de
preferência os cadastrados".

**Como.** O vetor do DINOv2-small (int8; o CLS) da janela INTEIRA da metade, comparado com o PROTÓTIPO de cada
ingrediente da base da loja: a média dos vetores dos exemplos que o dono marcou com UM nome só (a foto larga, com
vários nomes, puxaria todos para o meio). A nota é o cosseno com o protótipo mais parecido; comida = nota de
`COMIDA_MIN` para cima. A base é a da loja (`base_da_loja`): nada de outra loja, nada do piloto no motor.

**Medido** nos 112 passos da noite de 20 para 21/10 da loja piloto, contra a minha leitura de cada recorte (35 sem
ingrediente: inox, papel entre papéis, alumínio, a tampa da caixa, o pegador, a mão): com comida, notas de 0,50 a 0,74;
sem, de 0,21 a 0,55. Com 0,48: 110 de 112 certos e NENHUM passo com comida cortado (os 2 que passam têm um pedaço de
bacon na borda). O recorte da janela inteira ganhou do recorte só do que chegou (105 de 112) e do da máscara (59).
Tempo medido do modelo na loja: 61 ms por imagem no processador (A23.1, 17/10).

**O "não era ingrediente" da conferência NÃO entra na nota** (medido em 21/10, nos mesmos 112 passos, com os recortes sem
ingrediente de OUTROS lanches no papel dos exemplos de "nada"): o "nada" mais parecido ganhando da nota de ingrediente
cortaria 7 passos com comida e não salvaria nenhum dos 2 que passam — a janela inteira traz o fundo junto, e um recorte
com comida chega a se parecer mais com o inox de outro lanche (0,74) do que com o protótipo do ingrediente; com margem
(0,10 acima da nota) ou com um separador linear comida × nada, empata com o juiz de hoje (110 de 112). Os exemplos de
"nada" ficam na base da nuvem, à parte (`nada`), e se medem de novo quando houver os que o dono marcar.

O modelo é o `facebook/dinov2-small` (Apache-2.0), no ONNX do `onnx-community`, fixado no commit e conferido pelo
sha256. Como o detector, só se instala de propósito (`farol-agent ingredientes instalar`): o agente em serviço nunca
baixa modelo sozinho.
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import unicodedata
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable, Iterable

import cv2
import numpy as np

from farol_agent.juizes.base import ErroDoJuiz
from farol_agent.juizes.detector import sha256_de

if TYPE_CHECKING:
    from farol_agent.base_da_loja import BaseDaLoja

_log = logging.getLogger(__name__)

MODELO_NOME = "dinov2-small (int8)"
MODELO_ARQUIVO = "dinov2-small-int8.onnx"
MODELO_URL = (
    "https://huggingface.co/onnx-community/dinov2-small/resolve/8b1f705a3a7f6f062f6bdd21986c1583d3ef105d/onnx/model_int8.onnx"
)
MODELO_SHA256 = "dfce54a839b491f395c516350ebb4a78f947e9170a6beac0f2bc5638e0f09d61"
# A menor nota de ingrediente que é comida (ver o cabeçalho).
COMIDA_MIN = 0.48
# Quantas linhas do processador o modelo usa: o computador da loja é também o servidor do Regem e lê a bancada.
LINHAS = 2
_LADO = 224
_MEDIA = np.array([0.485, 0.456, 0.406], np.float32)
_DESVIO = np.array([0.229, 0.224, 0.225], np.float32)
VERSAO_DOS_VETORES = 1


def preparar(img: np.ndarray) -> np.ndarray:
    """Como no treino do DINOv2: o lado menor a 256, o miolo de 224 x 224, RGB normalizado — (1, 3, 224, 224)."""
    if img is None or img.ndim != 3 or img.shape[0] < 2 or img.shape[1] < 2:
        raise ValueError("imagem vazia")
    h, w = img.shape[:2]
    k = 256 / min(h, w)
    img = cv2.resize(img, (max(_LADO, round(w * k)), max(_LADO, round(h * k))), interpolation=cv2.INTER_CUBIC)
    h, w = img.shape[:2]
    y0, x0 = (h - _LADO) // 2, (w - _LADO) // 2
    rgb = cv2.cvtColor(img[y0:y0 + _LADO, x0:x0 + _LADO], cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    return np.transpose((rgb - _MEDIA) / _DESVIO, (2, 0, 1))[None].astype(np.float32)


def normalizar(v: np.ndarray) -> np.ndarray:
    n = float(np.linalg.norm(v))
    return (v / n).astype(np.float32) if n > 0 else v.astype(np.float32)


def instalar_modelo(pasta: str | Path) -> Path:
    """Baixa o modelo para `pasta` e só o aceita se o sha256 conferir (passo de INSTALAÇÃO, chamado de propósito)."""
    destino = Path(pasta) / MODELO_ARQUIVO
    if destino.is_file() and sha256_de(destino) == MODELO_SHA256:
        return destino
    destino.parent.mkdir(parents=True, exist_ok=True)
    provisorio = destino.with_suffix(".baixando")
    req = urllib.request.Request(MODELO_URL, headers={"user-agent": "farol-agent"})
    with urllib.request.urlopen(req, timeout=60) as r, open(provisorio, "wb") as f:
        for bloco in iter(lambda: r.read(1 << 20), b""):
            f.write(bloco)
    obtido = sha256_de(provisorio)
    if obtido != MODELO_SHA256:
        provisorio.unlink(missing_ok=True)
        raise ErroDoJuiz(f"o arquivo baixado não é o modelo medido (sha256 {obtido[:16]}…): não usei", recuperavel=False)
    provisorio.replace(destino)
    return destino


class MotorDino:
    """O DINOv2-small pelo ONNX Runtime, no processador, com `LINHAS` linhas. O modelo entra pelos BYTES: biblioteca
    nativa com acento na pasta é o ERR-111."""

    def __init__(self, caminho: str | Path, *, conferir_sha256: bool = True, linhas: int = LINHAS) -> None:
        self.caminho = Path(caminho)
        if not self.caminho.is_file():
            raise ErroDoJuiz(f"o modelo dos ingredientes não está em {self.caminho}", recuperavel=False)
        if conferir_sha256 and sha256_de(self.caminho) != MODELO_SHA256:
            raise ErroDoJuiz("o modelo dos ingredientes em disco não é o medido (sha256): não uso", recuperavel=False)
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
        v = r["pooler_output"][0] if "pooler_output" in r else r["last_hidden_state"][0, 0]
        return normalizar(np.asarray(v, np.float32))


def chave(nome: str) -> str:
    t = unicodedata.normalize("NFKD", nome.lower())
    return re.sub(r"\s+", " ", "".join(c for c in t if not unicodedata.combining(c))).strip()


def e_pao(nome: str | None) -> bool:
    """O ingrediente é um pão? Pelo nome das fichas ("Pão …"): o pão de um lanche sai das peças, não do nome."""
    return bool(nome) and chave(nome).startswith("pao")


@dataclass(frozen=True)
class Nota:
    """O que o juiz viu num recorte: o ingrediente mais parecido (pão incluído) e a nota dele; e o mais parecido que não
    é pão (o nome de um passo: o pão de um lanche sai das peças) e a nota dele."""

    nome: str | None
    nota: float
    ingrediente: str | None
    nota_ingrediente: float
    # a menor nota que é comida, a do juiz que deu a nota
    minimo: float = COMIDA_MIN

    def comida(self) -> bool:
        return self.nota >= self.minimo


class JuizDeIngrediente:
    """Compara um recorte com os protótipos dos ingredientes da loja."""

    def __init__(self, vetor: Callable[[np.ndarray], np.ndarray], prototipos: dict[str, np.ndarray], *,
                 comida_min: float = COMIDA_MIN) -> None:
        if not prototipos:
            raise ErroDoJuiz("a base da loja não tem exemplo de ingrediente nenhum", recuperavel=True)
        self._vetor = vetor
        self.nomes = sorted(prototipos)
        self._matriz = np.stack([normalizar(prototipos[n]) for n in self.nomes])
        self.comida_min = comida_min

    def julgar(self, img: np.ndarray) -> Nota:
        notas = self._matriz @ self._vetor(img)
        ordem = np.argsort(-notas)
        melhor = int(ordem[0])
        sem_pao = next((int(i) for i in ordem if not e_pao(self.nomes[int(i)])), None)
        return Nota(
            self.nomes[melhor], round(float(notas[melhor]), 3),
            self.nomes[sem_pao] if sem_pao is not None else None,
            round(float(notas[sem_pao]), 3) if sem_pao is not None else 0.0,
            self.comida_min,
        )

    def __call__(self, img: np.ndarray) -> Nota:
        return self.julgar(img)


def exemplos_de_um_nome(base: dict) -> list[tuple[str, str]]:
    """(nome, sha256) de cada exemplo marcado com UM nome só, dos ingredientes que se veem de cima."""
    nomes_de: dict[str, set[str]] = {}
    for item in base.get("itens") or []:
        if not isinstance(item, dict) or not item.get("nome") or item.get("visivel") is False:
            continue
        for q in item.get("quadros") or []:
            sha = (q or {}).get("sha256")
            if sha:
                nomes_de.setdefault(sha, set()).add(item["nome"])
    return sorted((next(iter(n)), sha) for sha, n in nomes_de.items() if len(n) == 1)


def prototipos(
    vetor: Callable[[np.ndarray], np.ndarray], exemplos: Iterable[tuple[str, str]], abrir: Callable[[str], np.ndarray | None],
    *, guardados: Path | None = None,
) -> dict[str, np.ndarray]:
    """O protótipo de cada ingrediente: a média dos vetores dos exemplos dele. `abrir(sha256)` dá a imagem; os vetores
    ficam guardados por sha256 em `guardados` (o modelo só olha o exemplo novo)."""
    cache: dict[str, list[float]] = {}
    if guardados is not None and guardados.is_file():
        try:
            bruto = json.loads(guardados.read_text(encoding="utf-8"))
            if bruto.get("modelo") == MODELO_SHA256 and bruto.get("versao") == VERSAO_DOS_VETORES:
                cache = {k: v for k, v in (bruto.get("vetores") or {}).items() if isinstance(v, list)}
        except (OSError, ValueError, AttributeError):
            cache = {}
    usados: dict[str, list[float]] = {}
    por_nome: dict[str, list[np.ndarray]] = {}
    for nome, sha in exemplos:
        if sha in cache:
            v = np.asarray(cache[sha], np.float32)
        else:
            img = abrir(sha)
            if img is None:
                continue
            v = vetor(img)
        usados[sha] = [round(float(x), 6) for x in v]
        por_nome.setdefault(nome, []).append(v)
    if guardados is not None and usados != cache:
        try:
            guardados.parent.mkdir(parents=True, exist_ok=True)
            temporario = guardados.with_name(guardados.name + ".novo")
            temporario.write_text(json.dumps({"modelo": MODELO_SHA256, "versao": VERSAO_DOS_VETORES, "vetores": usados}),
                                  encoding="utf-8")
            os.replace(temporario, guardados)
        except OSError as e:
            _log.warning("juiz de ingrediente: não guardei os vetores da base (%s)", e)
    return {nome: normalizar(np.mean(vs, axis=0)) for nome, vs in por_nome.items()}


class JuizDaLoja:
    """O juiz de ingrediente DESTA loja: montado na primeira vez que os passos pedem e refeito quando a base da loja muda
    (a impressão). Sem o modelo ou sem a base, nulo — os passos seguem sem o juiz — e o registro diz por quê, uma vez por
    motivo."""

    def __init__(self, pasta_modelos: str | Path, base: "BaseDaLoja", *,
                 motor_de: Callable[[Path], Any] = MotorDino) -> None:
        self.pasta_modelos = Path(pasta_modelos)
        self.base = base
        self._motor_de = motor_de
        self._motor: Any = None
        self._juiz: JuizDeIngrediente | None = None
        self._impressao: str | None = None
        self._motivo_dito: str | None = None
        self._trava = threading.Lock()

    def __call__(self) -> JuizDeIngrediente | None:
        with self._trava:
            lista = self.base.lista()
            if lista is None:
                return self._sem("a base da loja ainda não desceu (ela desce com a loja fechada)")
            impressao = lista.get("impressao")
            if self._juiz is not None and impressao == self._impressao:
                return self._juiz
            try:
                if self._motor is None:
                    self._motor = self._motor_de(self.pasta_modelos / MODELO_ARQUIVO)
                prot = prototipos(self._motor.vetor, exemplos_de_um_nome(lista), self.base.abrir,
                                  guardados=self.base.vetores)
                juiz = JuizDeIngrediente(self._motor.vetor, prot)
            except ErroDoJuiz as e:
                return self._sem(str(e))
            self._juiz, self._impressao, self._motivo_dito = juiz, impressao, None
            _log.info("juiz de ingrediente pronto: %d ingrediente(s) da base da loja", len(prot))
            return juiz

    def _sem(self, motivo: str) -> None:
        if motivo != self._motivo_dito:
            _log.info("juiz de ingrediente fora por enquanto — %s; os passos seguem sem ele", motivo)
            self._motivo_dito = motivo
        return None
