"""Leitura e escrita de imagem que funcionam com acento no caminho.

`cv2.imread` e `cv2.imwrite` usam a API ANSI do Windows e **falham em
silêncio** quando o caminho tem caractere fora do cp1252: o `imread`
devolve `None` e o `imwrite` devolve `False`, sem exceção nenhuma.

Não é caso raro. O agente roda em PC de loja, e o nome da pasta do usuário
do Windows costuma ser o nome da pessoa — `C:\\Users\\João`,
`C:\\Users\\Usuário`. O spool e a base de conhecimento ficam embaixo dela.
Com `imread`, o agente simplesmente nunca julgaria nada, e o sintoma seria
"não aparece alerta", que não aponta para lugar nenhum.

A volta é ler o arquivo pelo Python, que é Unicode, e entregar os bytes
prontos ao OpenCV: `imdecode` e `imencode` não tocam no sistema de
arquivos. É o jeito padrão de resolver isto, e custa nada.

Ver ERR-001 do Farol.
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np


def ler(caminho: str | Path, flags: int = cv2.IMREAD_COLOR) -> np.ndarray | None:
    """Como `cv2.imread`, mas sobrevive a acento no caminho.

    Devolve None quando o arquivo não existe ou não é imagem decodificável —
    mesmo contrato do `imread`, para não mudar quem já chamava.
    """
    try:
        dados = np.fromfile(str(caminho), dtype=np.uint8)
    except OSError:
        return None
    if dados.size == 0:
        return None
    return cv2.imdecode(dados, flags)


def escrever(
    caminho: str | Path, imagem: np.ndarray, parametros: list[int] | None = None
) -> bool:
    """Como `cv2.imwrite`, mas sobrevive a acento no caminho."""
    p = Path(caminho)
    ok, buffer = cv2.imencode(p.suffix or ".jpg", imagem, parametros or [])
    if not ok:
        return False
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        buffer.tofile(str(p))
    except OSError:
        return False
    return True
