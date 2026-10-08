"""Juiz local — VLM servido na própria loja.

Fala o dialeto OpenAI de `chat/completions`, que é o que vLLM, Ollama e
llama.cpp expõem. Trocar de servidor passa a ser trocar uma URL.

Usa só a biblioteca padrão de propósito. Este é o caminho que precisa
funcionar quando a internet caiu — e é exatamente nessa hora que descobrir
que falta um pacote seria pior.

**Raciocínio desligado.** Para "sim ou não, e com que confiança", cadeia de
pensamento é token gasto e latência somada sem ganho de acerto. Em regra de
prioridade urgente, com orçamento de dois segundos, é a diferença entre
atender e não atender.
"""

from __future__ import annotations

import base64
import json
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from farol_agent.juizes.base import ErroDoJuiz, bloco_dos_equipamentos
from farol_agent.juizes.nuvem import INSTRUCOES
from farol_agent.modelos import Resultado, Veredito, Via


# O modelo local não tem a ferramenta forçada da API da Anthropic, então o
# formato sai por instrução explícita + `response_format` JSON. Reaproveita
# as mesmas INSTRUCOES para que local e nuvem julguem pelo mesmo critério —
# se divergirem, a loja recebe vereditos diferentes conforme a internet, e
# isso é impossível de explicar a um gerente.
_FORMATO = """

Responda APENAS com um objeto JSON, sem markdown e sem texto em volta:

{"resultado": "conforme" | "nao_conforme" | "nao_avaliavel",
 "confianca": 0.0 a 1.0,
 "motivo": "uma frase curta descrevendo a evidência vista"}
"""


class JuizLocal:
    nome = "local"

    def __init__(
        self,
        *,
        url: str = "http://127.0.0.1:8000/v1/chat/completions",
        modelo: str = "qwen3.5-9b-instruct",
        timeout_seg: float = 20.0,
        chave: str | None = None,
    ) -> None:
        self.url = url
        self.modelo = modelo
        self.timeout = timeout_seg
        self.chave = chave

    def julgar(
        self,
        imagem: Path,
        criterio: str,
        *,
        contexto: dict[str, Any] | None = None,
        referencias: list[Path] | None = None,
    ) -> Veredito:
        inicio = time.monotonic()
        try:
            dados = Path(imagem).read_bytes()
        except OSError as e:
            raise ErroDoJuiz(f"não li a imagem {imagem}: {e}", recuperavel=False) from e

        b64 = base64.standard_b64encode(dados).decode("ascii")
        pedido = {
            "model": self.modelo,
            "temperature": 0,
            "max_tokens": 300,
            "response_format": {"type": "json_object"},
            # vLLM repassa isto ao template do Qwen3: desliga o raciocínio.
            # Servidor que não conhece a chave simplesmente ignora.
            "chat_template_kwargs": {"enable_thinking": False},
            "messages": [
                {"role": "system", "content": INSTRUCOES + _FORMATO},
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
                        },
                        {"type": "text", "text": _pedido(criterio, contexto)},
                    ],
                },
            ],
        }

        corpo = self._postar(pedido)
        texto = _conteudo(corpo)
        dados_resp = _ler_json(texto)

        return Veredito(
            resultado=_resultado(dados_resp.get("resultado")),
            confianca=_confianca(dados_resp.get("confianca")),
            motivo=str(dados_resp.get("motivo") or "").strip() or None,
            via=Via.LOCAL,
            modelo=self.modelo,
            # Modelo local não tem custo por token: o custo é o hardware,
            # que já foi pago. Zero aqui é verdade, não omissão.
            custo_centavos=0.0,
            latencia_ms=int((time.monotonic() - inicio) * 1000),
        )

    def _postar(self, pedido: dict[str, Any]) -> dict[str, Any]:
        cabecalhos = {"Content-Type": "application/json"}
        if self.chave:
            cabecalhos["Authorization"] = f"Bearer {self.chave}"

        req = urllib.request.Request(
            self.url,
            data=json.dumps(pedido).encode("utf-8"),
            headers=cabecalhos,
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detalhe = e.read().decode("utf-8", "replace")[:300]
            # 4xx é configuração errada (modelo inexistente, payload torto) e
            # não melhora com insistência; 5xx é o servidor engasgando.
            raise ErroDoJuiz(
                f"HTTP {e.code} do servidor local: {detalhe}",
                recuperavel=e.code >= 500,
            ) from e
        except urllib.error.URLError as e:
            raise ErroDoJuiz(
                f"servidor local inacessível em {self.url}: {e.reason}",
                recuperavel=True,
            ) from e
        except TimeoutError as e:
            raise ErroDoJuiz(f"servidor local não respondeu em {self.timeout}s",
                             recuperavel=True) from e


# ─────────────────────────── utilidades ────────────────────────────────


def _pedido(criterio: str, contexto: dict[str, Any] | None) -> str:
    partes = [f"CRITÉRIO A AUDITAR:\n{criterio.strip()}"]
    equipamentos = bloco_dos_equipamentos((contexto or {}).get("equipamentos"))
    if equipamentos:
        partes.append(equipamentos)
    if contexto:
        linhas = [
            f"- {k}: {v}"
            for k, v in contexto.items()
            # Endereço e marcas do agente não são contexto da operação.
            if v not in (None, "") and k not in ("base_id", "zona_id", "ponto_id", "foto_padrao", "fora_da_area", "equipamentos", "olhada_extra")
        ]
        if linhas:
            partes.append("CONTEXTO DA OPERAÇÃO:\n" + "\n".join(linhas))
    return "\n\n".join(partes)


def _conteudo(corpo: dict[str, Any]) -> str:
    try:
        return corpo["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as e:
        raise ErroDoJuiz(f"resposta local em formato inesperado: {corpo}",
                         recuperavel=True) from e


def _ler_json(texto: str) -> dict[str, Any]:
    """Tolera a cerca de markdown que alguns modelos locais insistem em pôr."""
    t = (texto or "").strip()
    if t.startswith("```"):
        t = t.split("```")[1] if "```" in t[3:] else t[3:]
        if t.lstrip().lower().startswith("json"):
            t = t.lstrip()[4:]
    try:
        dados = json.loads(t.strip())
    except json.JSONDecodeError as e:
        raise ErroDoJuiz(f"resposta local não é JSON: {texto[:200]!r}",
                         recuperavel=True) from e
    if not isinstance(dados, dict):
        raise ErroDoJuiz(f"resposta local não é objeto: {texto[:200]!r}",
                         recuperavel=True)
    return dados


def _resultado(v: Any) -> Resultado:
    try:
        return Resultado(str(v))
    except ValueError:
        # Modelo pequeno às vezes inventa rótulo. Rótulo desconhecido é
        # "não sei", nunca "conforme" — errar para o lado do silêncio aqui
        # esconderia irregularidade de verdade.
        raise ErroDoJuiz(f"resultado desconhecido do modelo local: {v!r}",
                         recuperavel=True) from None


def _confianca(v: Any) -> float | None:
    try:
        return max(0.0, min(1.0, float(v)))
    except (TypeError, ValueError):
        return None
