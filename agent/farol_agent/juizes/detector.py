"""Juiz detector — presença e contagem, dentro da loja.

Responde "tem alguém no posto?", "quantas pessoas na fila?", "tem copo na
bancada?" com um modelo de detecção de objetos rodando no PC da loja. Sem
internet, sem custo por análise, e sem imagem de cozinha saindo do prédio —
que é o motivo de `presenca` e `contagem` serem 100% locais por desenho.

## Por que o critério tem campos, e não só texto

O juiz de nuvem lê português: recebe o critério como pergunta. O detector
não lê nada — ele sabe achar oitenta tipos de objeto e contar. Adivinhar "o
que procurar" a partir de um texto livre seria o tipo de erro que não
aparece: o critério "copo sujo na bancada" viraria "há copo?", e ninguém
perceberia que a palavra "sujo" foi ignorada.

Então a regra de presença e de contagem traz, em `parametros`, o que
procurar e quantos. O texto continua lá, para a pessoa ler. Quem decide é
o campo.

## A faixa do "talvez"

Medido em 06/10/2026 nas câmeras de uma loja de verdade, substream 704×480:
pessoas de corpo inteiro saíram com 0,83 a 0,94. Um casaco pendurado saiu
como "pessoa" com 0,41, e um banquinho como "vaso sanitário" com 0,57.

Daí os dois limiares:

    p >= 0,70          → está lá
    0,35 <= p < 0,70   → talvez
    p < 0,35           → não conta

E a regra que vem deles: **quando os "talvez" podem mudar o resultado, o
veredito é `nao_avaliavel`**. Nunca um alerta. O que faz uma loja desligar
o sistema não é ele deixar de ver uma vez — é ele acusar um casaco.

## Licença

RF-DETR Nano, Apache 2.0, na conversão ONNX publicada pela onnx-community.
O YOLO da Ultralytics é AGPL-3.0 e não entra em produto revendido
(`docs/licencas.md`). O arquivo do modelo é conferido por sha256: o agente
só carrega exatamente o modelo que foi medido.
"""

from __future__ import annotations

import hashlib
import logging
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

import numpy as np

from farol_agent import imagens
from farol_agent.juizes.base import ErroDoJuiz
from farol_agent.modelos import Resultado, Veredito, Via

_log = logging.getLogger(__name__)

# A partir de quanto uma detecção conta como certeza, e a partir de quanto
# ela é um "talvez" que pode impedir o veredito.
CERTEZA = 0.70
DUVIDA = 0.35

# O vocabulário do FAROL, em português, e a classe do modelo que o atende.
# A regra guarda a chave ("pessoa"), não o nome do modelo: trocar de modelo
# um dia não pode obrigar a recadastrar critério.
OBJETOS: dict[str, str] = {
    "pessoa": "person",
    "copo": "cup",
    "garrafa": "bottle",
    "tigela": "bowl",
    "faca": "knife",
    "colher": "spoon",
    "garfo": "fork",
    "cadeira": "chair",
    "mesa": "dining table",
    "celular": "cell phone",
    "mochila": "backpack",
    "bolsa": "handbag",
    "notebook": "laptop",
    "micro-ondas": "microwave",
    "forno": "oven",
    "geladeira": "refrigerator",
    "pia": "sink",
}

# Singular e plural para a frase do motivo.
_PLURAL = {
    "pessoa": "pessoas", "copo": "copos", "garrafa": "garrafas", "tigela": "tigelas",
    "faca": "facas", "colher": "colheres", "garfo": "garfos", "cadeira": "cadeiras",
    "mesa": "mesas", "celular": "celulares", "mochila": "mochilas", "bolsa": "bolsas",
    "notebook": "notebooks", "micro-ondas": "micro-ondas", "forno": "fornos",
    "geladeira": "geladeiras", "pia": "pias",
}
_FEMININOS = {
    "pessoa", "garrafa", "tigela", "faca", "colher", "cadeira", "mesa", "mochila",
    "bolsa", "geladeira", "pia",
}


# ───────────────────────────── o que procurar ─────────────────────────────


@dataclass(frozen=True)
class Procura:
    """O que a regra manda procurar, e quantos são aceitáveis."""

    objeto: str
    minimo: int = 0
    maximo: int | None = None

    @classmethod
    def de_parametros(cls, parametros: dict[str, Any] | None) -> "Procura":
        """Lê `regra.parametros`. Levanta dizendo o que falta — em português
        de quem cadastra, porque a mensagem vai parar no log da loja."""
        p = parametros or {}
        objeto = str(p.get("objeto") or "").strip().lower()
        if not objeto:
            raise ErroDoJuiz(
                "o critério não diz o que procurar — edite-o no console e "
                "escolha o objeto",
                recuperavel=False,
            )
        if objeto not in OBJETOS:
            raise ErroDoJuiz(
                f"o detector local não conhece {objeto!r}. Conhece: "
                f"{', '.join(sorted(OBJETOS))}",
                recuperavel=False,
            )

        def inteiro(chave: str) -> int | None:
            v = p.get(chave)
            if v is None or v == "":
                return None
            if isinstance(v, bool) or not isinstance(v, (int, float)) or int(v) != v or v < 0:
                raise ErroDoJuiz(
                    f"{chave} tem que ser um número inteiro, zero ou mais (veio {v!r})",
                    recuperavel=False,
                )
            return int(v)

        minimo = inteiro("minimo") or 0
        maximo = inteiro("maximo")
        if maximo is not None and maximo < minimo:
            raise ErroDoJuiz(
                f"o máximo ({maximo}) é menor que o mínimo ({minimo})", recuperavel=False
            )
        if minimo == 0 and maximo is None:
            # "Zero ou mais" é verdade em qualquer imagem: a regra nunca
            # reprovaria nada, e pareceria estar auditando.
            raise ErroDoJuiz(
                "o critério não exige nada: diga pelo menos quantos, ou no máximo quantos",
                recuperavel=False,
            )
        return cls(objeto=objeto, minimo=minimo, maximo=maximo)

    def nome(self, quantidade: int) -> str:
        return self.objeto if quantidade == 1 else _PLURAL.get(self.objeto, self.objeto)

    def nenhum(self) -> str:
        return f"nenhuma {self.objeto}" if self.objeto in _FEMININOS else f"nenhum {self.objeto}"

    def pedido(self) -> str:
        """O que a regra pede, em uma frase."""
        if self.maximo == 0:
            return self.nenhum()
        if self.maximo is None:
            return f"pelo menos {self.minimo} {self.nome(self.minimo)}"
        if self.minimo == 0:
            return f"no máximo {self.maximo} {self.nome(self.maximo)}"
        if self.minimo == self.maximo:
            return f"exatamente {self.minimo} {self.nome(self.minimo)}"
        return f"de {self.minimo} a {self.maximo} {self.nome(self.maximo)}"


# ───────────────────────────── a decisão ─────────────────────────────


def decidir(
    pontuacoes: list[float],
    procura: Procura,
    *,
    certeza: float = CERTEZA,
    duvida: float = DUVIDA,
) -> tuple[Resultado, float, str]:
    """Do que o modelo viu para o veredito. Devolve `(resultado, confiança, motivo)`.

    `pontuacoes` são as probabilidades de cada candidato do objeto
    procurado, em qualquer ordem — inclusive as baixas, que é delas que sai
    a confiança de que algo NÃO está lá.

    O raciocínio é de intervalo: com `c` detecções certas e `t` "talvez", a
    quantidade real está entre `c` e `c + t`. Se o intervalo inteiro cabe no
    que a regra pede, está conforme. Se fica inteiro fora, não está. Se
    atravessa a fronteira, **não dá para dizer** — e é isso que se diz.
    """
    ps = sorted((float(p) for p in pontuacoes), reverse=True)
    certos = sum(1 for p in ps if p >= certeza)
    talvez = sum(1 for p in ps if duvida <= p < certeza)
    lo, hi = procura.minimo, procura.maximo
    menor, maior = certos, certos + talvez

    def k_esima(k: int) -> float:
        """A k-ésima maior pontuação (1 = a maior); 0 se não houver."""
        return ps[k - 1] if 0 < k <= len(ps) else 0.0

    viu = f"vi {certos} {procura.nome(certos)}" if certos else f"não vi {procura.nenhum()}"
    if talvez:
        viu += f", e {talvez} em dúvida"
    pede = procura.pedido()

    if hi is not None and menor > hi:
        # Sobra, com certeza: a confiança é a da detecção que estoura o teto.
        return (
            Resultado.NAO_CONFORME,
            round(k_esima(hi + 1), 3),
            f"{viu}; o critério pede {pede}",
        )
    if maior < lo:
        # Falta, mesmo contando os duvidosos. A confiança de que falta é o
        # quanto o modelo descarta o candidato que completaria o mínimo.
        return (
            Resultado.NAO_CONFORME,
            round(1.0 - k_esima(lo), 3),
            f"{viu}; o critério pede {pede}",
        )
    if menor >= lo and (hi is None or maior <= hi):
        partes = []
        if lo > 0:
            partes.append(k_esima(lo))                 # o mais fraco dos necessários
        if hi is not None:
            partes.append(1.0 - k_esima(hi + 1))       # ninguém além do teto
        confianca = min(partes) if partes else 1.0
        return Resultado.CONFORME, round(confianca, 3), f"{viu}; o critério pede {pede}"

    # O intervalo atravessa a fronteira: depende de um "talvez".
    return (
        Resultado.NAO_AVALIAVEL,
        round(max((p for p in ps if p < certeza), default=0.0), 3),
        f"{viu}; o critério pede {pede} e a dúvida decide — não afirmo",
    )


# ───────────────────────────── o modelo ─────────────────────────────


class MotorDeDeteccao(Protocol):
    """Quem sabe olhar a imagem e pontuar candidatos de uma classe."""

    nome: str

    def pontuar(self, imagem_bgr: np.ndarray, classe: str) -> list[float]:
        """Probabilidade de cada candidato da classe. Inclui as baixas."""
        ...


# As 91 posições de saída do modelo (COCO original, com buracos).
_COCO91 = (
    "N/A", "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat",
    "traffic light", "fire hydrant", "N/A", "stop sign", "parking meter", "bench", "bird", "cat", "dog",
    "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe", "N/A", "backpack", "umbrella", "N/A",
    "N/A", "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball", "kite",
    "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket", "bottle", "N/A",
    "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple", "sandwich", "orange",
    "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch", "potted plant", "bed",
    "N/A", "dining table", "N/A", "N/A", "toilet", "N/A", "tv", "laptop", "mouse", "remote", "keyboard",
    "cell phone", "microwave", "oven", "toaster", "sink", "refrigerator", "N/A", "book", "clock", "vase",
    "scissors", "teddy bear", "hair drier", "toothbrush",
)

MODELO_NOME = "rfdetr-nano"
MODELO_ARQUIVO = "rfdetr-nano.onnx"
MODELO_URL = (
    "https://huggingface.co/onnx-community/rfdetr_nano-ONNX/resolve/eae21cee06/onnx/model.onnx"
)
MODELO_SHA256 = "9cbac6b11ce34a03034e4d5a24cfac5f18632fd6761d1311dd640232088d7fee"
_LADO = 384
# Abaixo disto o candidato nem entra na lista: são trezentos por imagem e
# quase todos são ruído perto de zero.
_PISO = 0.02


def sha256_de(caminho: Path) -> str:
    h = hashlib.sha256()
    with open(caminho, "rb") as f:
        for bloco in iter(lambda: f.read(1 << 20), b""):
            h.update(bloco)
    return h.hexdigest()


def instalar_modelo(pasta: str | Path) -> Path:
    """Baixa o modelo para `pasta` e só o aceita se o sha256 conferir.

    É passo de INSTALAÇÃO, chamado de propósito (`farol-agent detector
    instalar`). O agente em serviço nunca baixa nada sozinho: 108 MB no meio
    de uma batida atrasariam o sinal de vida, e um modelo trocado no caminho
    mudaria o comportamento de todas as regras sem ninguém decidir isso.
    """
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
        raise ErroDoJuiz(
            f"o arquivo baixado não é o modelo medido (sha256 {obtido[:16]}…): não usei",
            recuperavel=False,
        )
    provisorio.replace(destino)
    return destino


def interpretar_saida(logits: np.ndarray, classe: str) -> list[float]:
    """Das 300×91 pontuações brutas para a lista da classe pedida.

    Separado do motor para ser testável sem o arquivo do modelo.
    """
    if classe not in _COCO91:
        raise ErroDoJuiz(f"o modelo não tem a classe {classe!r}", recuperavel=False)
    indice = _COCO91.index(classe)
    bruto = np.asarray(logits, dtype=np.float32)
    if bruto.ndim == 3:
        bruto = bruto[0]
    # Exatamente 91 colunas, não "pelo menos o índice": as caixas do modelo
    # têm 4 colunas e passariam num teste frouxo, virando pontuação de
    # mentira — que seria lida como "não tem ninguém aqui".
    if bruto.ndim != 2 or bruto.shape[1] != len(_COCO91):
        raise ErroDoJuiz(
            f"saída do modelo com formato inesperado {tuple(bruto.shape)}", recuperavel=False
        )
    prob = 1.0 / (1.0 + np.exp(-bruto[:, indice]))
    return [float(p) for p in prob if p >= _PISO]


class MotorOnnx:
    """RF-DETR Nano pelo ONNX Runtime. Usa a placa de vídeo quando há."""

    nome = MODELO_NOME

    def __init__(self, caminho: str | Path, *, conferir_sha256: bool = True) -> None:
        self.caminho = Path(caminho)
        if not self.caminho.is_file():
            raise ErroDoJuiz(
                f"modelo do detector não encontrado em {self.caminho}. "
                "Rode: farol-agent detector instalar",
                recuperavel=False,
            )
        if conferir_sha256 and sha256_de(self.caminho) != MODELO_SHA256:
            raise ErroDoJuiz(
                f"{self.caminho} não é o modelo medido (sha256 diferente): não carreguei",
                recuperavel=False,
            )
        try:
            import onnxruntime as ort
        except ImportError:
            raise ErroDoJuiz(
                "falta o motor de inferência. Rode: pip install onnxruntime "
                "(ou onnxruntime-directml, para usar a placa de vídeo no Windows)",
                recuperavel=False,
            ) from None

        disponiveis = ort.get_available_providers()
        ordem = [p for p in ("DmlExecutionProvider", "CPUExecutionProvider") if p in disponiveis]
        try:
            self._sessao = ort.InferenceSession(str(self.caminho), providers=ordem)
        except Exception as e:  # noqa: BLE001
            # Placa de vídeo com driver antigo derruba o DirectML na carga.
            # O processador sozinho dá conta (medido: 113 ms por quadro).
            _log.warning("detector não abriu na placa de vídeo (%s); usando o processador", e)
            self._sessao = ort.InferenceSession(
                str(self.caminho), providers=["CPUExecutionProvider"]
            )
        self.onde = self._sessao.get_providers()[0]
        self._entrada = self._sessao.get_inputs()[0].name
        saidas = [o.name for o in self._sessao.get_outputs()]
        if "logits" not in saidas:
            raise ErroDoJuiz(f"o modelo não tem a saída 'logits' (tem {saidas})", recuperavel=False)

    def pontuar(self, imagem_bgr: np.ndarray, classe: str) -> list[float]:
        import cv2

        rgb = cv2.cvtColor(imagem_bgr, cv2.COLOR_BGR2RGB)
        r = cv2.resize(rgb, (_LADO, _LADO), interpolation=cv2.INTER_LINEAR)
        tensor = np.transpose(r.astype(np.float32) / 255.0, (2, 0, 1))[None]
        (logits,) = self._sessao.run(["logits"], {self._entrada: tensor})
        return interpretar_saida(logits, classe)


# ───────────────────────────── o juiz ─────────────────────────────


class JuizDetector:
    """Julga presença e contagem pelo que o detector encontra.

    ⚠️ Para este juiz, "não vi" é um VEREDITO — ausência, com confiança
    alta. Ele supõe que a imagem é uma cena. Quem chama garante isso com
    `qualidade.cena_utilizavel` no QUADRO INTEIRO, como o motor faz: a tela
    preta de "sem sinal" do gravador, entregue direto, sai daqui como
    "não há ninguém" com 0,96.

    A porta não mora aqui dentro de propósito: o juiz recebe o RECORTE da
    área, e um recorte liso (um trecho de piso vazio) é cena legítima — é
    justamente o "vazio" que a regra precisa enxergar.
    """

    nome = "detector"

    def __init__(
        self,
        motor: MotorDeDeteccao,
        *,
        certeza: float = CERTEZA,
        duvida: float = DUVIDA,
    ) -> None:
        self.motor = motor
        self.certeza = certeza
        self.duvida = duvida

    @staticmethod
    def atende(parametros: dict[str, Any] | None) -> None:
        """Levanta se esta regra não é julgável pelo detector.

        Chamado na MONTAGEM, pelo seletor: descobrir que falta "o que
        procurar" só na hora de julgar faria o agente capturar, gravar e
        falhar a cada ciclo (ERR-014).
        """
        Procura.de_parametros(parametros)

    def julgar(
        self,
        imagem: Path,
        criterio: str,
        *,
        contexto: dict[str, Any] | None = None,
        referencias: list[Path] | None = None,
    ) -> Veredito:
        inicio = time.monotonic()
        procura = Procura.de_parametros((contexto or {}).get("parametros"))

        bgr = imagens.ler(str(imagem))
        if bgr is None:
            raise ErroDoJuiz(f"não consegui ler a imagem {imagem}", recuperavel=False)

        pontuacoes = self.motor.pontuar(bgr, OBJETOS[procura.objeto])
        resultado, confianca, motivo = decidir(
            pontuacoes, procura, certeza=self.certeza, duvida=self.duvida
        )
        return Veredito(
            resultado=resultado,
            confianca=confianca,
            motivo=motivo,
            via=Via.DETECTOR,
            modelo=self.motor.nome,
            custo_centavos=0.0,
            latencia_ms=int((time.monotonic() - inicio) * 1000),
        )
