"""Uma análise completa, do canal ao veredito.

Captura, escolhe o melhor quadro, recorta a área, redimensiona, manda ao
juiz e devolve tudo que aconteceu — inclusive **a imagem exata que o
modelo viu**.

Mostrar o que foi enviado não é detalhe de conforto. Quando um veredito
vem errado, a primeira pergunta é sempre "o que ele estava olhando?" — e
sem a imagem enviada em mãos a resposta é chute. Com ela, em dois
segundos se vê que a zona estava torta, que o quadro saiu borrado ou que
o enquadramento não continha o que a regra pergunta.

É também o que torna a área de análise uma decisão informada em vez de
uma linha desenhada no escuro: dá para ver o recorte, medir o px/cm que
sobrou e saber se a pergunta ainda cabe ali.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from farol_agent import imagens
from farol_agent.fontes.base import FonteVideo
from farol_agent.juizes.base import ErroDoJuiz, Juiz
from farol_agent.modelos import RESOLUCOES, Frame, Veredito, Zona
from farol_agent.pipeline import qualidade, recorte


@dataclass
class Analise:
    """Tudo que uma análise produziu — para auditar, não só para alertar."""

    veredito: Veredito | None = None
    erro: str | None = None
    # Falha que não adianta repetir — chave recusada, crédito acabado,
    # imagem corrompida. Sem isto, quem chama em laço martela a mesma
    # parede N vezes e enterra a causa no meio das repetições.
    recuperavel: bool = True

    # A imagem como o modelo a viu
    enviado_largura: int = 0
    enviado_altura: int = 0
    enviado_bytes: int = 0
    caminho_enviado: str | None = None

    # Qualidade do que foi capturado
    quadros_capturados: int = 0
    nitidez: float | None = None
    detalhe: float | None = None
    saturacao: float | None = None
    estourado: float | None = None
    cena_utilizavel: bool = True
    porque_inutilizavel: str | None = None

    # Óptica, quando se sabe a largura real da zona
    px_por_cm: float | None = None

    ms_captura: int = 0
    ms_total: int = 0
    avisos: list[str] = field(default_factory=list)


def analisar(
    fonte: FonteVideo,
    juiz: Juiz,
    criterio: str,
    *,
    zona: Zona | None = None,
    margem: float = 0.05,
    envio: str = "r640",
    rajada: int = 6,
    descartar: int = 2,
    jpeg: int = 85,
    borrar_rosto: bool = True,
    largura_zona_cm: float | None = None,
    contexto: dict[str, Any] | None = None,
    salvar_em: str | Path | None = None,
) -> Analise:
    """Roda a cadeia inteira e devolve o que deu."""
    inicio = time.monotonic()
    r = Analise()

    t0 = time.monotonic()
    quadros = fonte.rajada(datetime.now(), quantidade=rajada)
    r.ms_captura = int((time.monotonic() - t0) * 1000)
    r.quadros_capturados = len(quadros)

    if not quadros:
        r.erro = "nenhum quadro veio do canal"
        r.ms_total = int((time.monotonic() - inicio) * 1000)
        return r

    bbox = None
    if zona is not None:
        bbox = zona.bbox(quadros[0].largura, quadros[0].altura, margem)

    # A nitidez é medida DENTRO da área: o que importa é a bancada estar
    # focada, não o fundo. Um fundo nítido com a zona borrada escolheria o
    # quadro errado.
    melhor = qualidade.melhor_quadro(
        quadros, descartar=min(descartar, len(quadros) - 1), zona_bbox=bbox
    )
    if melhor is None:
        r.erro = "não consegui escolher um quadro"
        r.ms_total = int((time.monotonic() - inicio) * 1000)
        return r
    r.nitidez = melhor.nitidez

    f: Frame = (
        recorte.recortar_zona(melhor, zona, margem=margem) if zona is not None else melhor
    )

    # A porta que impede o modelo de ser perguntado sobre um retângulo
    # preto. Vale aqui também: no teste manual é ainda mais fácil mirar
    # num canal sem câmera e achar que o modelo é que errou.
    r.cena_utilizavel, r.porque_inutilizavel = qualidade.cena_utilizavel(f.imagem)

    if borrar_rosto:
        f, borrou = recorte.borrar_rostos(f)
        if borrou:
            r.avisos.append("rosto borrado antes do envio")

    f = recorte.redimensionar(f, RESOLUCOES.get(envio, 640))

    r.enviado_largura, r.enviado_altura = f.largura, f.altura
    r.detalhe = qualidade.detalhe_real(f.imagem)
    r.saturacao = qualidade.saturacao_media(f.imagem)
    r.estourado, _ = qualidade.faixa_dinamica(f.imagem)

    if largura_zona_cm:
        # px/cm do que o MODELO viu — não o da câmera. É esse que decide
        # se a pergunta tinha como ser respondida.
        r.px_por_cm = round(f.largura / largura_zona_cm, 2)

    destino = Path(salvar_em) if salvar_em else None
    if destino is not None:
        if imagens.escrever(destino, f.imagem, [1, jpeg]):
            r.caminho_enviado = str(destino)
            r.enviado_bytes = destino.stat().st_size

    if not r.cena_utilizavel:
        # Não paga para julgar o que não é cena. O resultado honesto é
        # "não avaliável", e ele sai de graça.
        r.erro = f"sem cena para julgar: {r.porque_inutilizavel}"
        r.ms_total = int((time.monotonic() - inicio) * 1000)
        return r

    if destino is None:
        # O juiz lê de arquivo; sem destino escolhido, usa um temporário.
        import tempfile

        temporario = Path(tempfile.gettempdir()) / f"farol-{int(time.time())}.jpg"
        imagens.escrever(temporario, f.imagem, [1, jpeg])
        destino = temporario
        r.enviado_bytes = temporario.stat().st_size

    try:
        r.veredito = juiz.julgar(destino, criterio, contexto=contexto)
    except ErroDoJuiz as e:
        r.erro = str(e)
        r.recuperavel = e.recuperavel

    r.ms_total = int((time.monotonic() - inicio) * 1000)
    return r
