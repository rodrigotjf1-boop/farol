"""Juiz de nuvem — API da Anthropic.

Três decisões moram aqui, e as três são de custo:

**1 · O prompt fixo é separado do critério.** As instruções de como julgar
não mudam entre regras nem entre lojas, então vão no `system` com
`cache_control` e passam a custar 0,1× na leitura. O que muda — o critério
daquela regra, na versão daquela regra — vai na mensagem do usuário. Juntar
os dois num prompt só joga o cache fora a cada regra diferente.

**2 · Saída por ferramenta, não por JSON em texto.** Pedir "responda em
JSON" funciona até o dia em que o modelo embrulha a resposta em markdown e
o parser quebra em produção, no meio do almoço. Com `tool_choice` forçado,
a resposta já chega estruturada e validada.

**3 · Cascata.** Modelo barato primeiro; só escala para o caro quando a
confiança vem baixa. A maioria das cenas de cozinha é óbvia — bancada
visivelmente limpa, touca visivelmente na cabeça — e pagar modelo grande
para o óbvio é onde a conta de uma rede de lojas estoura.

**`nao_avaliavel` é resposta de primeira classe.** O modelo é instruído a
usá-la em vez de chutar. Um "não dá para ver" honesto vira, no painel, a
lista de quais câmeras precisam de ajuste ou de dinheiro — enquanto um
chute vira alerta falso, e alerta falso faz a loja desligar o sistema.
"""

from __future__ import annotations

import base64
import os
import time
from pathlib import Path
from typing import Any

from farol_agent.juizes.base import ErroDoJuiz
from farol_agent.modelos import Resultado, Veredito, Via


# ─────────────────────────── prompt fixo ───────────────────────────────
# Fica aqui, inteiro e constante, porque é o que vai em cache. Mudar este
# texto invalida o cache de TODAS as lojas — então mudança aqui é mudança
# de versão de produto, não ajuste de ocasião.

INSTRUCOES = """\
Você audita processo operacional de estabelecimento alimentício a partir de \
um recorte de câmera. Não é vigilância de pessoas: você julga se o PROCESSO \
está conforme o critério recebido, não quem está na imagem.

Responda SEMPRE pela ferramenta `responder`, com três campos:

- `resultado`:
  - `conforme` — o critério está atendido na imagem.
  - `nao_conforme` — o critério está claramente violado.
  - `nao_avaliavel` — a imagem não permite decidir.

- `confianca`: 0.0 a 1.0, quanto você confia no próprio resultado.

- `motivo`: uma frase curta, em português, dizendo o que você VIU que levou \
ao resultado. Descreva a evidência, não a conclusão. Bom: "a superfície tem \
restos de alimento no canto direito". Ruim: "a bancada está suja".

Regras de julgamento:

1. Julgue APENAS o critério recebido. Outra irregularidade visível não é da \
sua conta nesta chamada.

2. Use `nao_avaliavel` sem hesitar quando a imagem não sustentar a decisão: \
área fora do enquadramento, foco ruim, escuro demais, contraluz, objeto \
ocluído, ou a cena simplesmente não contém o que o critério pergunta. \
`nao_avaliavel` NÃO é erro seu — é informação útil sobre a câmera. Chutar é \
que é erro.

3. Na dúvida entre `conforme` e `nao_conforme`, prefira a confiança baixa à \
certeza inventada. Quem lê isto decide com base na confiança.

4. Não descreva nem identifique pessoas: nem rosto, nem gênero, nem idade, \
nem etnia. Quando a presença de alguém importar para o critério, trate como \
"uma pessoa". Quem estava no setor é informação que vem da escala, não da \
imagem.
"""

FERRAMENTA: dict[str, Any] = {
    "name": "responder",
    "description": "Devolve o veredito sobre o critério auditado.",
    "input_schema": {
        "type": "object",
        "properties": {
            "resultado": {
                "type": "string",
                "enum": ["conforme", "nao_conforme", "nao_avaliavel"],
            },
            "confianca": {
                "type": "number",
                "description": "0.0 a 1.0",
            },
            "motivo": {
                "type": "string",
                "description": "Uma frase curta descrevendo a evidência vista.",
            },
        },
        "required": ["resultado", "confianca", "motivo"],
    },
}


# ──────────────────────────── modelos ──────────────────────────────────

MODELO_BARATO = "claude-haiku-4-5-20251001"
MODELO_FORTE = "claude-sonnet-5-5"

# Preço por milhão de tokens, em dólar. ⚠️ VALOR DE REFERÊNCIA: serve para a
# estimativa que aparece no painel, não para fechar conta. Conferir na
# tabela oficial antes de usar em cobrança.
PRECO_USD_MTOK: dict[str, tuple[float, float]] = {
    #  modelo:              (entrada, saída)
    MODELO_BARATO: (1.00, 5.00),
    MODELO_FORTE: (3.00, 15.00),
}

# Leitura de cache custa 0,1× a entrada — é o que paga separar o prompt fixo.
FATOR_CACHE_LEITURA = 0.10
FATOR_CACHE_ESCRITA = 1.25


class JuizNuvem:
    """Julga pela API da Anthropic, com cache de prompt e cascata."""

    nome = "nuvem"

    def __init__(
        self,
        *,
        chave: str | None = None,
        modelo: str = MODELO_BARATO,
        # None desliga a cascata: todo veredito sai do modelo barato, com o
        # custo previsível que uma rede de lojas precisa para orçar.
        modelo_forte: str | None = MODELO_FORTE,
        escalar_abaixo_de: float = 0.75,
        dolar: float | None = None,
        timeout_seg: float = 30.0,
    ) -> None:
        chave = chave or os.environ.get("ANTHROPIC_API_KEY")
        if not chave:
            raise ErroDoJuiz("ANTHROPIC_API_KEY ausente", recuperavel=False)

        try:
            import anthropic
        except ImportError as e:  # pragma: no cover
            raise ErroDoJuiz(
                "pacote `anthropic` não instalado: pip install anthropic",
                recuperavel=False,
            ) from e

        self._anthropic = anthropic
        # max_retries=0: quem decide retentar é a Fila, que persiste em disco
        # e sobrevive ao processo. Retry do SDK é em memória e se perde.
        self._cliente = anthropic.Anthropic(
            api_key=chave, max_retries=0, timeout=timeout_seg
        )
        self.modelo = modelo
        self.modelo_forte = modelo_forte
        self.escalar_abaixo_de = escalar_abaixo_de
        self.dolar = dolar or float(os.environ.get("FAROL_DOLAR", "5.40"))

    # ───────────────────────────── público ─────────────────────────────

    def julgar(
        self,
        imagem: Path,
        criterio: str,
        *,
        contexto: dict[str, Any] | None = None,
        referencias: list[Path] | None = None,
    ) -> Veredito:
        b64, tipo = _ler_imagem(imagem)
        texto = _montar_pedido(criterio, contexto)
        refs = [_ler_imagem(r) for r in (referencias or [])]
        # A referência é a foto padrão da área (e não um objeto a
        # reconhecer): o modelo é avisado com outras palavras.
        padrao = (contexto or {}).get("foto_padrao")
        # Só vai quando há foto: quem chama sem ela chama como sempre chamou.
        com_padrao = {"padrao": str(padrao)} if padrao else {}

        inicio = time.monotonic()
        veredito = self._chamar(self.modelo, b64, tipo, texto, refs, **com_padrao)

        # Cascata: só escala o que veio inseguro, e nunca escala um
        # `nao_avaliavel` — se o barato não conseguiu ver, o caro também
        # não vai, porque o problema está na imagem, não no modelo.
        if (
            self.modelo_forte
            and veredito.resultado is not Resultado.NAO_AVALIAVEL
            and (veredito.confianca or 0.0) < self.escalar_abaixo_de
        ):
            forte = self._chamar(self.modelo_forte, b64, tipo, texto, refs, **com_padrao)
            forte.custo_centavos = (veredito.custo_centavos or 0.0) + (
                forte.custo_centavos or 0.0
            )
            veredito = forte

        veredito.latencia_ms = int((time.monotonic() - inicio) * 1000)
        return veredito

    # ───────────────────────────── interno ─────────────────────────────

    def _chamar(
        self,
        modelo: str,
        b64: str,
        tipo: str,
        texto: str,
        refs: list[tuple[str, str]] | None = None,
        padrao: str | None = None,
    ) -> Veredito:
        try:
            r = self._cliente.messages.create(
                model=modelo,
                max_tokens=300,
                system=[
                    {
                        "type": "text",
                        "text": INSTRUCOES,
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                tools=[FERRAMENTA],
                tool_choice={"type": "tool", "name": "responder"},
                messages=[
                    {"role": "user", "content": _conteudo(b64, tipo, texto, refs, padrao)}
                ],
            )
        except Exception as e:
            raise self._traduzir(e) from e

        dados = _extrair_resposta(r)
        uso = getattr(r, "usage", None)

        return Veredito(
            resultado=Resultado(dados["resultado"]),
            confianca=_confianca(dados.get("confianca")),
            motivo=str(dados.get("motivo") or "").strip() or None,
            via=Via.NUVEM,
            modelo=modelo,
            tokens_entrada=getattr(uso, "input_tokens", None),
            tokens_saida=getattr(uso, "output_tokens", None),
            custo_centavos=self._custo(modelo, uso),
        )

    def _traduzir(self, e: Exception) -> ErroDoJuiz:
        """Separa o que vale retentar do que não vale.

        Sem isto a fila martela para sempre uma chave inválida, ou desiste
        de um 529 que passaria na tentativa seguinte.
        """
        a = self._anthropic
        definitivos = (
            getattr(a, "AuthenticationError", ()),
            getattr(a, "PermissionDeniedError", ()),
            getattr(a, "BadRequestError", ()),
            getattr(a, "NotFoundError", ()),
        )
        definitivos = tuple(t for t in definitivos if isinstance(t, type))
        if definitivos and isinstance(e, definitivos):
            return ErroDoJuiz(f"{type(e).__name__}: {e}", recuperavel=False)
        return ErroDoJuiz(f"{type(e).__name__}: {e}", recuperavel=True)

    def _custo(self, modelo: str, uso: Any) -> float | None:
        if uso is None:
            return None
        preco = PRECO_USD_MTOK.get(modelo)
        if preco is None:
            # Modelo sem preço na tabela: devolver 0 seria dizer "de graça",
            # e custo falso é pior que custo ausente — some do relatório em
            # vez de mentir nele.
            return None
        entrada_usd, saida_usd = preco

        normais = getattr(uso, "input_tokens", 0) or 0
        escrita = getattr(uso, "cache_creation_input_tokens", 0) or 0
        leitura = getattr(uso, "cache_read_input_tokens", 0) or 0
        saida = getattr(uso, "output_tokens", 0) or 0

        usd = (
            normais * entrada_usd
            + escrita * entrada_usd * FATOR_CACHE_ESCRITA
            + leitura * entrada_usd * FATOR_CACHE_LEITURA
            + saida * saida_usd
        ) / 1_000_000
        return usd * self.dolar * 100


# ─────────────────────────── utilidades ────────────────────────────────


def _ler_imagem(caminho: Path) -> tuple[str, str]:
    p = Path(caminho)
    try:
        dados = p.read_bytes()
    except OSError as e:
        # Imagem some do spool quando alguém limpa a pasta ou o disco enche.
        # Não é recuperável: retentar não traz o arquivo de volta.
        raise ErroDoJuiz(f"não li a imagem {p}: {e}", recuperavel=False) from e

    tipos = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
             ".webp": "image/webp", ".gif": "image/gif"}
    tipo = tipos.get(p.suffix.lower())
    if tipo is None:
        raise ErroDoJuiz(f"formato não suportado: {p.suffix}", recuperavel=False)
    return base64.standard_b64encode(dados).decode("ascii"), tipo


def _imagem_bloco(b64: str, tipo: str) -> dict[str, Any]:
    return {
        "type": "image",
        "source": {"type": "base64", "media_type": tipo, "data": b64},
    }


def _conteudo(
    b64: str, tipo: str, texto: str, refs: list[tuple[str, str]] | None, padrao: str | None = None
) -> list[dict[str, Any]]:
    """Monta o conteúdo do pedido: referências, depois o quadro ao vivo.

    As fotos de referência são o que a loja ensinou ao sistema sobre o
    objeto — a espátula DAQUELA cozinha, de vários ângulos. Sem isso o
    modelo decide pela aparência genérica, e aparência genérica confunde
    objeto parecido: em 05/10/2026 ele leu um mouse como controle remoto
    duas vezes, a 85% e 95% de confiança.

    **A ordem importa.** As referências vêm primeiro e o quadro ao vivo
    por último, com rótulos explícitos, para que o modelo não confunda
    uma referência com a cena a julgar — o erro seria silencioso e daria
    veredito confiante sobre a foto errada.

    **O bloco de referência leva `cache_control`.** Ele é fixo por regra e
    repetido em toda análise daquela regra, então é exatamente o tipo de
    prefixo grande e estável que torna o cache de prompt vantajoso:
    leitura de cache custa 0,1× a entrada. É também o que faltava para o
    cache valer a pena — sem referências o prefixo fixo é pequeno demais
    para o piso mínimo, e por isso não houve acerto de cache na medição.
    """
    conteudo: list[dict[str, Any]] = []

    if refs and padrao:
        # A foto padrão não é um objeto a reconhecer: é a MESMA área,
        # como ela fica quando está em ordem.
        conteudo.append({"type": "text", "text": aviso_da_foto_padrao(padrao)})
        conteudo += [_imagem_bloco(rb, rt) for rb, rt in refs]
        conteudo.append(
            {"type": "text", "text": "FIM DA FOTO PADRÃO.", "cache_control": {"type": "ephemeral"}}
        )
        conteudo.append({"type": "text", "text": "AGORA A CENA A AUDITAR:"})
    elif refs:
        conteudo.append(
            {
                "type": "text",
                "text": (
                    f"REFERÊNCIA — as {len(refs)} imagens a seguir mostram o "
                    "objeto/padrão correto desta loja, de ângulos diferentes. "
                    "Use-as para reconhecer o objeto. NÃO as julgue: elas não "
                    "são a cena auditada."
                ),
            }
        )
        conteudo += [_imagem_bloco(rb, rt) for rb, rt in refs]
        # O marcador do fim do bloco fixo. Tudo acima é igual em toda
        # análise desta regra e pode ser lido do cache.
        conteudo.append(
            {
                "type": "text",
                "text": "FIM DAS REFERÊNCIAS.",
                "cache_control": {"type": "ephemeral"},
            }
        )
        conteudo.append({"type": "text", "text": "AGORA A CENA A AUDITAR:"})

    conteudo.append(_imagem_bloco(b64, tipo))
    conteudo.append({"type": "text", "text": texto})
    return conteudo


# Quando a área marcada não é um retângulo, o agente apaga o que fica fora
# dela (cinza liso). Vai aqui, e não nas instruções, porque as instruções
# são o que fica em cache: mexer nelas invalida o cache de todas as lojas.
AVISO_DA_AREA = (
    "ÁREA DE ANÁLISE:\n"
    "O cinza liso em volta está FORA da área e foi apagado de propósito. "
    "Julgue só o que aparece. O cinza não é defeito da imagem nem motivo "
    "para `nao_avaliavel`."
)


def aviso_da_foto_padrao(nome: str) -> str:
    """O que o modelo lê antes da foto padrão."""
    return (
        f"FOTO PADRÃO — a imagem a seguir é esta MESMA área (“{nome}”), guardada pela loja "
        "como exemplo de quando ela está em ordem. Compare a cena a auditar com ela: "
        "o que estiver diferente é o que interessa ao critério. NÃO a julgue: ela não "
        "é a cena auditada."
    )


def _montar_pedido(criterio: str, contexto: dict[str, Any] | None) -> str:
    partes = [f"CRITÉRIO A AUDITAR:\n{criterio.strip()}"]

    contexto = dict(contexto or {})
    # Endereço do agente e marca de "vai com a foto padrão": não são
    # contexto da operação.
    for chave in ("zona_id", "ponto_id", "foto_padrao"):
        contexto.pop(chave, None)
    if contexto.pop("fora_da_area", None):
        partes.append(AVISO_DA_AREA)

    # O contexto é o que o Regem sabe e a imagem não mostra: qual pedido está
    # em produção, qual a ficha técnica, que horas são na operação. É ele que
    # transforma classificação aberta em verificação binária — e é por isso
    # que a acurácia por item sobe de ~95% para mais de 99%.
    if contexto:
        linhas = [f"- {k}: {v}" for k, v in contexto.items() if v not in (None, "")]
        if linhas:
            partes.append("CONTEXTO DA OPERAÇÃO:\n" + "\n".join(linhas))

    return "\n\n".join(partes)


def _extrair_resposta(r: Any) -> dict[str, Any]:
    for bloco in getattr(r, "content", []) or []:
        if getattr(bloco, "type", None) == "tool_use" and bloco.name == "responder":
            return dict(bloco.input)
    # Com tool_choice forçado isto não deveria acontecer; se acontecer, é
    # mudança de comportamento da API e tem que aparecer, não ser engolida.
    raise ErroDoJuiz(
        f"resposta sem o bloco `responder` (stop_reason={getattr(r, 'stop_reason', '?')})",
        recuperavel=True,
    )


def _confianca(v: Any) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return max(0.0, min(1.0, f))
