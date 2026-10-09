"""A análise única das fotos de um equipamento do inventário.

A loja cadastra o equipamento (a chapa, a bancada, o caixa) com até quatro
fotos dele limpo e no lugar. "Analisar as fotos e descrever" pergunta a um
modelo, UMA vez, o que ele é e o que vale conferir nele — e a resposta fica
guardada: daí em diante ela vai junto com cada pergunta sobre a área em que
o equipamento aparece, sem custar outra análise.

Quem faz a chamada é este computador, com a chave que já está aqui: a nuvem
do Farol não tem chave de modelo nenhum.

## O que volta é uma sugestão

O agente devolve a descrição e a lista; quem decide se elas viram o cadastro
é a pessoa, que lê e corrige na tela antes de salvar.

## O que se manda

Só as fotos do equipamento, reduzidas. A foto que veio do quadro de um canal
é recortada pela área — com o que fica fora do desenho apagado, como em toda
análise — e a foto enviada pelo console vai como veio.

## Loja em modo local

Nada sai da loja, nem para isto: o comando é recusado dizendo por quê.
"""

from __future__ import annotations

import base64
import hashlib
import logging
import os
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable

import cv2
import numpy as np

from farol_agent.juizes.nuvem import (
    AVISO_DA_AREA,
    FATOR_CACHE_ESCRITA,
    MODELO_FORTE,
    PRECO_USD_MTOK,
    criar_pedindo_a_ferramenta,
    fator_de_leitura,
)
from farol_agent.modelos import Frame, Zona
from farol_agent.pipeline import recorte

_log = logging.getLogger(__name__)

# Descrever é feito uma vez por equipamento: vale o modelo que enxerga
# melhor. Quatro fotos e uma resposta curta custam centavos.
MODELO = MODELO_FORTE
MAX_FOTOS = 4
LADO_DA_FOTO = 1000
MAX_DESCRICAO = 500
MAX_CONFERIR = 5
MAX_FRASE = 160
TEMPO_LIMITE_SEG = 60.0
# A resposta cabe em 700. O modelo que vai com a escolha livre da ferramenta
# escreve antes de chamá-la (ver `juizes/nuvem.py`) e precisa de folga.
MAX_TOKENS = 700
MAX_TOKENS_ESCOLHA_LIVRE = 3000

INSTRUCOES = """\
Você descreve UM equipamento de um estabelecimento alimentício a partir de \
fotos dele LIMPO e NO LUGAR. A descrição fica guardada e vai junto, depois, \
com cada análise de câmera da área em que ele aparece: serve para outro \
modelo reconhecer o equipamento e saber como ele fica quando está em ordem.

As fotos podem ser de dois tipos: o recorte da câmera do setor (de longe, \
muitas vezes de cima) e fotos tiradas de perto. Numa foto de câmera, área \
cinza lisa em volta é o que fica FORA da área marcada: não descreva.

Responda SEMPRE pela ferramenta `descrever`:

- `descricao`: de 2 a 4 frases, em português, até 450 caracteres. Diga o que \
ele é (material, formato, as partes que o distinguem), onde fica em relação \
ao que aparece em volta, e como ele fica limpo e no lugar — esta parte começa \
com "Limpo:" ou "Limpa:". Só o que SE VÊ nas fotos.

- `conferir`: de 2 a 5 frases curtas. Cada uma é um ponto que uma câmera \
fixa consegue conferir olhando para ele, escrita como o estado CERTO: \
"Tampas abaixadas quando a chapa não está em uso", "Nada apoiado em cima". \
Nada que dependa de cheiro, de temperatura ou de ver por dentro.

- `nao_deu`: só quando as fotos não mostram o equipamento com clareza \
bastante para descrever. Diga em uma frase o que faltou. Neste caso deixe \
`descricao` vazia.

Regras:

1. Não invente marca, modelo ou medida que não esteja legível na foto.
2. Não descreva nem identifique pessoas. Se houver alguém na foto, ignore.
3. O nome e o tipo informados dizem o que procurar; se as fotos mostram \
outra coisa, descreva o que as fotos mostram.
"""

FERRAMENTA: dict[str, Any] = {
    "name": "descrever",
    "description": "Devolve a descrição do equipamento e o que vale conferir nele.",
    "input_schema": {
        "type": "object",
        "properties": {
            "descricao": {"type": "string", "description": "2 a 4 frases, até 450 caracteres."},
            "conferir": {
                "type": "array",
                "items": {"type": "string"},
                "description": "2 a 5 pontos que uma câmera fixa consegue conferir, escritos como o estado certo.",
            },
            "nao_deu": {"type": "string", "description": "Só se as fotos não permitirem descrever: o que faltou."},
        },
        "required": ["descricao", "conferir"],
    },
}

NOMES_DOS_TIPOS = {
    "chapa": "chapa",
    "fritadeira": "fritadeira",
    "bancada": "bancada",
    "geladeira": "geladeira ou freezer",
    "balcao": "balcão",
    "caixa": "caixa",
    "prateleira": "prateleira",
    "pia": "pia",
}


class ErroAoDescrever(Exception):
    """Não deu para descrever. A mensagem é a que a tela do console mostra."""


@dataclass
class FotoPronta:
    """Uma foto do equipamento, já no ponto de ir ao modelo."""

    b64: str
    origem: str          # canal | envio
    apagado: bool        # tem cinza em volta (área desenhada por pontos)


# ───────────────────────── preparar as fotos ─────────────────────────


def preparar_foto(dados: bytes, origem: str, recorte_da_area: Any) -> FotoPronta:
    """Abre a imagem, recorta pela área (se for de canal), reduz e regrava."""
    img = cv2.imdecode(np.frombuffer(dados, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ErroAoDescrever("uma das fotos não abre como imagem")

    quadro = Frame(imagem=img, ts=datetime.now(), ponto_id="")
    apagado = False
    pontos = _poligono(recorte_da_area) if origem == "canal" else None
    if pontos:
        # A mesma conta de toda análise: o retângulo em volta do desenho, sem
        # folga, com o que fica fora dele apagado.
        zona = Zona(id="", nome="", poligono=pontos)
        quadro, dentro = recorte.recortar_area(quadro, zona)
        if dentro is not None:
            quadro = recorte.apagar_fora(quadro, dentro)
            apagado = True

    if origem != "canal":
        # A foto do canal já foi borrada na captura; a enviada pelo console
        # não passou pelo agente. É mitigação, não garantia (ver `borrar_rostos`).
        quadro, _ = recorte.borrar_rostos(quadro)

    quadro = recorte.redimensionar(quadro, LADO_DA_FOTO)
    ok, buffer = cv2.imencode(".jpg", quadro.imagem, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
    if not ok:
        raise ErroAoDescrever("falhei ao preparar uma das fotos")
    return FotoPronta(b64=base64.standard_b64encode(buffer.tobytes()).decode("ascii"), origem=origem, apagado=apagado)


def _poligono(bruto: Any) -> list[tuple[float, float]] | None:
    """O desenho da área, se vier inteiro: três pontos ou mais, em fração do quadro."""
    if not isinstance(bruto, list) or len(bruto) < 3:
        return None
    pontos: list[tuple[float, float]] = []
    for p in bruto:
        try:
            x, y = float(p[0]), float(p[1])
        except (TypeError, ValueError, IndexError):
            return None
        if not (0.0 <= x <= 1.0 and 0.0 <= y <= 1.0):
            return None
        pontos.append((x, y))
    return pontos


def baixar_fotos(parametros: dict[str, Any], baixar: Callable[[str], bytes]) -> list[FotoPronta]:
    """Baixa as fotos do comando, conferindo cada uma pelo resumo."""
    lista = [f for f in (parametros.get("fotos") or []) if isinstance(f, dict) and f.get("id")][:MAX_FOTOS]
    if not lista:
        raise ErroAoDescrever("o equipamento não tem foto: é dela que a descrição sai")

    prontas: list[FotoPronta] = []
    for n, f in enumerate(lista, 1):
        dados = baixar(str(f["id"]))
        esperado = str(f.get("sha256") or "")
        if esperado and hashlib.sha256(dados).hexdigest() != esperado:
            # Imagem cortada no caminho: descrever meia foto é descrever errado.
            raise ErroAoDescrever(f"a foto {n} desceu diferente do que a nuvem descreveu. Tente de novo.")
        prontas.append(preparar_foto(dados, str(f.get("origem") or "envio"), f.get("recorte")))
    return prontas


# ───────────────────────── perguntar ao modelo ─────────────────────────


def montar_pedido(nome: str, tipo: str, setor: str, fotos: list[FotoPronta]) -> list[dict[str, Any]]:
    """O conteúdo da pergunta: o que é o equipamento, e as fotos, cada uma com o seu rótulo."""
    oque = NOMES_DOS_TIPOS.get(tipo)
    linhas = [f"EQUIPAMENTO: {nome.strip()}"]
    if oque:
        linhas.append(f"TIPO: {oque}")
    if setor.strip():
        linhas.append(f"SETOR: {setor.strip()}")
    linhas.append(f"FOTOS: {len(fotos)}")

    conteudo: list[dict[str, Any]] = [{"type": "text", "text": "\n".join(linhas)}]
    for n, f in enumerate(fotos, 1):
        rotulo = f"FOTO {n} — " + ("recorte da câmera do setor" if f.origem == "canal" else "foto tirada de perto")
        conteudo.append({"type": "text", "text": rotulo + (f"\n{AVISO_DA_AREA}" if f.apagado else "")})
        conteudo.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": f.b64}})
    conteudo.append({"type": "text", "text": "Descreva o equipamento e diga o que vale conferir nele."})
    return conteudo


def ler_resposta(r: Any) -> dict[str, Any]:
    """A descrição e a lista, limpas — ou erro com a frase do que faltou."""
    dados: dict[str, Any] | None = None
    for bloco in getattr(r, "content", []) or []:
        if getattr(bloco, "type", None) == "tool_use" and getattr(bloco, "name", None) == "descrever":
            dados = dict(bloco.input)
            break
    if dados is None:
        raise ErroAoDescrever("o modelo não devolveu a descrição. Tente de novo.")

    descricao = " ".join(str(dados.get("descricao") or "").split())
    if not descricao:
        faltou = " ".join(str(dados.get("nao_deu") or "").split())
        raise ErroAoDescrever(
            "as fotos não mostram o equipamento com clareza bastante para descrever"
            + (f": {faltou[:200]}" if faltou else ". Ponha uma foto mais de perto, sem ninguém na frente.")
        )
    if len(descricao) > MAX_DESCRICAO:
        descricao = descricao[: MAX_DESCRICAO - 1].rstrip() + "…"

    conferir: list[str] = []
    bruto = dados.get("conferir")
    for frase in bruto if isinstance(bruto, list) else []:
        limpa = " ".join(str(frase or "").split()).rstrip(".")
        if limpa and limpa[:MAX_FRASE] not in conferir and len(conferir) < MAX_CONFERIR:
            conferir.append(limpa[:MAX_FRASE])
    return {"descricao": descricao, "conferir": conferir}


def custo_em_centavos(uso: Any, modelo: str, dolar: float) -> float | None:
    """A mesma conta do juiz de nuvem. Modelo sem preço na tabela: sem custo, e não zero."""
    preco = PRECO_USD_MTOK.get(modelo)
    if uso is None or preco is None:
        return None
    entrada_usd, saida_usd = preco
    usd = (
        (getattr(uso, "input_tokens", 0) or 0) * entrada_usd
        + (getattr(uso, "cache_creation_input_tokens", 0) or 0) * entrada_usd * FATOR_CACHE_ESCRITA
        + (getattr(uso, "cache_read_input_tokens", 0) or 0) * entrada_usd * fator_de_leitura(modelo)
        + (getattr(uso, "output_tokens", 0) or 0) * saida_usd
    ) / 1_000_000
    return round(usd * dolar * 100, 3)


def _cliente_do_modelo():
    chave = os.environ.get("ANTHROPIC_API_KEY")
    if not chave:
        raise ErroAoDescrever(
            "este computador não tem a chave da nuvem: sem ela não há como analisar as fotos. "
            "A descrição pode ser escrita à mão."
        )
    try:
        import anthropic
    except ImportError as e:  # pragma: no cover
        raise ErroAoDescrever("o agente desta loja não tem o pacote de acesso à nuvem instalado") from e
    # Sem nova tentativa: o console espera um minuto, e quem decide tentar de
    # novo é a pessoa, clicando.
    return anthropic.Anthropic(api_key=chave, max_retries=0, timeout=TEMPO_LIMITE_SEG)


def descrever_item(
    parametros: dict[str, Any],
    *,
    baixar: Callable[[str], bytes],
    modo_julgamento: str = "hibrido",
    cliente: Any = None,
    modelo: str = MODELO,
) -> dict[str, Any]:
    """Atende o comando `descrever_item`. Devolve o corpo da resposta à nuvem."""
    if modo_julgamento == "local":
        raise ErroAoDescrever(
            "esta loja julga tudo dentro dela: nenhuma imagem sai, nem para descrever um equipamento"
        )
    nome = str(parametros.get("nome") or "").strip()
    if not nome:
        raise ErroAoDescrever("o comando veio sem o nome do equipamento")

    fotos = baixar_fotos(parametros, baixar)
    cliente = cliente or _cliente_do_modelo()
    try:
        r = criar_pedindo_a_ferramenta(
            cliente,
            ferramenta="descrever",
            max_tokens=MAX_TOKENS,
            max_tokens_livre=MAX_TOKENS_ESCOLHA_LIVRE,
            model=modelo,
            system=INSTRUCOES,
            tools=[FERRAMENTA],
            messages=[{
                "role": "user",
                "content": montar_pedido(nome, str(parametros.get("tipo") or ""), str(parametros.get("setor") or ""), fotos),
            }],
        )
    except ErroAoDescrever:
        raise
    except Exception as e:  # noqa: BLE001
        # A mensagem vai para a tela do console: o tipo do erro basta para
        # quem está lá saber se é chave, limite ou rede — o texto do provedor
        # fica no log daqui.
        _log.warning("a análise das fotos de “%s” falhou: %s: %s", nome, type(e).__name__, e)
        raise ErroAoDescrever(f"a nuvem não respondeu à análise das fotos ({type(e).__name__}). Tente de novo.") from e

    lido = ler_resposta(r)
    dolar = float(os.environ.get("FAROL_DOLAR", "5.40"))
    custo = custo_em_centavos(getattr(r, "usage", None), modelo, dolar)
    _log.info(
        "equipamento “%s” descrito a partir de %d foto(s): %d caracteres, %d ponto(s) a conferir%s",
        nome, len(fotos), len(lido["descricao"]), len(lido["conferir"]),
        f", {custo:.2f} centavos" if custo is not None else "",
    )
    saida: dict[str, Any] = {**lido, "modelo": modelo}
    if custo is not None:
        saida["custoCentavos"] = custo
    return saida
