"""De onde o agente tira a senha da câmera.

A nuvem guarda `usuario` e `segredo_ref` — uma referência. O segredo em
si **nunca esteve no banco da nuvem** e não desce na configuração: ele
vive aqui, na máquina da loja.

Hoje o único depósito é o ambiente. Isso é pouco, e é de propósito: um
cofre de verdade (DPAPI no Windows, chaveiro do SO, arquivo cifrado) é
trabalho que só se justifica quando houver mais de uma câmera por
instalação e um instalador que saiba preenchê-lo. O que importa agora é
que **a resolução passe por um só lugar**, para que trocar o depósito
seja mudar este módulo e nada mais.

Nunca registre o valor devolvido. Senha em linha de log é senha vazada, e
o log do agente vai para disco numa máquina de loja.
"""

from __future__ import annotations

import logging
import os
import re

_log = logging.getLogger(__name__)

PREFIXO = "cofre://"
_NOME_VALIDO = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

# O depósito único de hoje: uma senha para o gravador da loja. Cobre a
# instalação com um DVR, que é a que existe.
ENV_PADRAO = "FAROL_DVR_SENHA"


class ErroDoCofre(Exception):
    pass


def variavel_de(ref: str) -> str:
    """`cofre://cam1` → `FAROL_SEGREDO_CAM1`."""
    nome = ref[len(PREFIXO):] if ref.startswith(PREFIXO) else ref
    if not _NOME_VALIDO.match(nome):
        raise ErroDoCofre(
            f"referência de segredo inválida: {ref!r}. "
            "Use cofre://nome, com letras, números, hífen ou sublinhado"
        )
    return f"FAROL_SEGREDO_{nome.upper().replace('-', '_')}"


def resolver(ref: str | None) -> str:
    """A senha para esta referência.

    Procura primeiro a variável específica da referência e cai na geral.
    A ordem importa: numa loja com dois gravadores, a específica tem que
    vencer, senão os dois usariam a mesma senha sem ninguém notar até uma
    delas ser trocada.

    Levanta quando não acha — **nunca devolve vazio**. Senha vazia faz o
    RTSP responder 401 e o erro aparece como "canal não abriu", mandando
    quem for diagnosticar olhar cabo, rede e gravador antes de desconfiar
    da configuração.
    """
    if ref:
        especifica = variavel_de(ref)
        valor = os.environ.get(especifica)
        if valor:
            return valor
    else:
        especifica = None

    geral = os.environ.get(ENV_PADRAO)
    if geral:
        return geral

    onde = f"{especifica} nem {ENV_PADRAO}" if especifica else ENV_PADRAO
    raise ErroDoCofre(
        f"senha da câmera não encontrada: defina {onde} no ambiente do agente"
    )


def tem(ref: str | None) -> bool:
    """Se há senha, sem revelá-la. Serve a diagnóstico e a tela de estado."""
    try:
        resolver(ref)
        return True
    except ErroDoCofre:
        return False
