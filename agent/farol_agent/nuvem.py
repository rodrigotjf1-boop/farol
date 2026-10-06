"""Conversa do agente com a nuvem — só biblioteca padrão.

Três chamadas, todas de dentro para fora:

    heartbeat()      → sinal de vida, versão da config e comandos pendentes
    configuracao()   → a configuração da loja, quando a versão mudou
    responder()      → o resultado de um comando

Nenhuma delas exige porta aberta na loja, e é de propósito: o produto
promete não pedir mudança de rede. O caminho "de volta" da nuvem para o
agente é a **resposta do heartbeat**, não uma conexão nova.

Sem `requests`: o agente roda em PC de loja, e cada dependência a mais é
uma coisa a mais para quebrar numa instalação que ninguém vai depurar
presencialmente.
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from typing import Any

_log = logging.getLogger(__name__)

TIMEOUT_PADRAO = 15.0


class ErroDaNuvem(Exception):
    """Falha ao falar com a nuvem.

    `recuperavel` separa o que vale tentar de novo (rede caiu, 5xx) do
    que não vale (token recusado, loja apagada). Sem a distinção, o
    agente ou martela para sempre um 401 que nunca vai passar, ou desiste
    de uma oscilação de rede que passaria em trinta segundos.
    """

    def __init__(self, mensagem: str, *, recuperavel: bool = True, status: int = 0):
        super().__init__(mensagem)
        self.recuperavel = recuperavel
        self.status = status


class ClienteNuvem:
    def __init__(self, base_url: str, token: str, *, timeout: float = TIMEOUT_PADRAO):
        if not base_url:
            raise ErroDaNuvem("endereço da nuvem não configurado", recuperavel=False)
        if not token:
            raise ErroDaNuvem("token do agente não configurado", recuperavel=False)
        self.base_url = base_url.rstrip("/")
        self._token = token
        self.timeout = timeout

    # ───────────────────────────── público ─────────────────────────────

    def heartbeat(self, versao: str | None = None) -> dict[str, Any]:
        """Sinal de vida. Devolve `configVersao` e os comandos pendentes."""
        return self._pedir("POST", "/v1/agentes/heartbeat", {"versao": versao})

    def configuracao(self) -> dict[str, Any]:
        return self._pedir("GET", "/v1/agentes/configuracao")

    def responder(
        self, comando_id: str, *, url: str | None = None, erro: str | None = None
    ) -> dict[str, Any]:
        """Conta à nuvem o que aconteceu com um comando.

        **Falha também se responde.** Comando que fracassa em silêncio
        deixa a tela do console girando para sempre, e quem está lá não
        tem como saber se a câmera caiu ou se o agente nem recebeu.
        """
        return self._pedir(
            "POST", f"/v1/agentes/comandos/{comando_id}/resultado",
            {"url": url, "erro": erro},
        )

    # ───────────────────────────── interno ─────────────────────────────

    def _pedir(self, metodo: str, caminho: str, corpo: Any = None) -> dict[str, Any]:
        dados = json.dumps(corpo).encode("utf-8") if corpo is not None else None
        req = urllib.request.Request(
            f"{self.base_url}{caminho}",
            data=dados,
            method=metodo,
            headers={
                "authorization": f"Bearer {self._token}",
                "content-type": "application/json",
                "accept": "application/json",
            },
        )

        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                bruto = r.read()
        except urllib.error.HTTPError as e:
            # 401/403 não melhoram repetindo: token errado, agente
            # desativado ou ligado a outra máquina. 4xx em geral é pedido
            # malformado — repetir só gasta.
            recuperavel = e.code >= 500 or e.code == 429
            detalhe = self._detalhe(e)
            raise ErroDaNuvem(
                f"{e.code} em {caminho}{detalhe}", recuperavel=recuperavel, status=e.code
            ) from None
        except urllib.error.URLError as e:
            # Rede caída, DNS fora, nuvem reiniciando. Passa.
            raise ErroDaNuvem(f"não cheguei na nuvem: {e.reason}") from None
        except TimeoutError:
            raise ErroDaNuvem(f"a nuvem não respondeu em {self.timeout:g}s") from None

        if not bruto:
            return {}
        try:
            return json.loads(bruto)
        except json.JSONDecodeError as e:
            # Resposta que não é JSON quase sempre é portal de rede ou
            # proxy devolvendo HTML. Tratar como "deu certo e veio vazio"
            # esconderia isso (ERR-002).
            raise ErroDaNuvem(f"resposta de {caminho} não é JSON: {e}") from None

    @staticmethod
    def _detalhe(e: urllib.error.HTTPError) -> str:
        """A mensagem da API, quando houver. Sem ela, 401 é só um número."""
        try:
            corpo = json.loads(e.read())
        except Exception:
            return ""
        msg = corpo.get("mensagem") or corpo.get("erro")
        return f" — {msg}" if msg else ""
