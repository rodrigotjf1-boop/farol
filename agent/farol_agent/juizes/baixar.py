"""Baixar um modelo na INSTALAÇÃO, retomando de onde parou (ERR-151, 25/10/2026).

Na loja, a internet cai a cada poucos minutos (medido em 25/10: o Google levou 13 s para responder, o Hugging Face nem
conectou, e a cópia pelo Tailscale caiu a cada minuto). O instalador baixava os 372 MB do olho duplo de uma vez, sem
retomar: a primeira queda perdia tudo. Aqui, cada tentativa pede só o que falta (`Range: bytes=N-`); o servidor que
não atende o pedaço (responde 200) manda o arquivo inteiro de novo, e ele é regravado do começo. O que chegou fica em
`<arquivo>.baixando` mesmo quando acabam as tentativas: a próxima instalação continua dele.

O arquivo só entra no lugar com o sha256 conferido — o mesmo de sempre: o que não confere é apagado e não fica.
"""

from __future__ import annotations

import http.client
import logging
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable

from farol_agent.juizes.base import ErroDoJuiz

_log = logging.getLogger(__name__)

TENTATIVAS = 8
_BLOCO = 1 << 20
# 4xx que vale tentar de novo (o servidor pediu espera); o resto (404, 403…) não passa sozinho
_PASSA_SOZINHO = (408, 429)


def baixar_conferido(url: str, destino: str | Path, sha256: str, *, errado: str, tentativas: int = TENTATIVAS,
                     esperar: Callable[[float], None] = time.sleep) -> Path:
    """Baixa `url` para `destino` com até `tentativas`, retomando, e só o põe no lugar com o `sha256` conferido.

    `errado` é a frase do arquivo que chegou e não confere, com `{}` no lugar do começo do sha256 obtido.
    """
    from farol_agent.juizes.detector import sha256_de

    destino = Path(destino)
    destino.parent.mkdir(parents=True, exist_ok=True)
    provisorio = destino.with_suffix(".baixando")
    ultimo: Exception | None = None
    for tentativa in range(1, tentativas + 1):
        ja = provisorio.stat().st_size if provisorio.is_file() else 0
        cabecalhos = {"user-agent": "farol-agent"}
        if ja:
            cabecalhos["range"] = f"bytes={ja}-"
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=cabecalhos), timeout=60) as r:
                continua = ja > 0 and getattr(r, "status", 200) == 206
                with open(provisorio, "ab" if continua else "wb") as f:
                    for bloco in iter(lambda: r.read(_BLOCO), b""):
                        f.write(bloco)
            break
        except urllib.error.HTTPError as e:
            if e.code == 416 and ja:
                break  # não há o que mandar depois do que já chegou: a conferência diz se está inteiro
            if 400 <= e.code < 500 and e.code not in _PASSA_SOZINHO:
                raise ErroDoJuiz(f"o servidor recusou o modelo ({e.code} em {url})", recuperavel=False) from e
            ultimo = e
        except (OSError, http.client.HTTPException) as e:  # queda, tempo esgotado, resposta cortada no meio
            ultimo = e
        if tentativa < tentativas:
            chegou = provisorio.stat().st_size if provisorio.is_file() else 0
            _log.warning("a conexão caiu com %.0f MB baixados (%s; tentativa %d de %d): continuo de onde parou",
                         chegou / 1e6, ultimo, tentativa, tentativas)
            esperar(min(60.0, 5.0 * tentativa))
    else:
        raise ErroDoJuiz(f"não consegui baixar o modelo em {tentativas} tentativas ({ultimo}); o que chegou fica em "
                         f"{provisorio.name}, e a próxima instalação continua dele", recuperavel=True)
    obtido = sha256_de(provisorio)
    if obtido != sha256:
        provisorio.unlink(missing_ok=True)
        raise ErroDoJuiz(errado.format(obtido[:16]), recuperavel=False)
    provisorio.replace(destino)
    return destino
