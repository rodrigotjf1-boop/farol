"""A identidade desta instalação do agente.

A nuvem amarra o token a uma máquina na primeira ativação: a partir daí,
o mesmo token em outro lugar é recusado com 409. É o que impede que um
token copiado de uma loja vire um segundo agente mandando evento em nome
dela.

Para isso funcionar, a impressão precisa ser **estável entre execuções**.
Se mudar, o agente não sobe mais — a nuvem o trata como máquina diferente
e recusa, e o diagnóstico é confuso justamente porque "não mudei nada".

Daí a escolha: um identificador sorteado na primeira execução e **gravado
em disco**, em vez de derivado do hardware.

MAC e número de série parecem mais "verdadeiros", mas não são estáveis na
prática: `uuid.getnode()` sorteia um valor quando não encontra placa,
notebook troca de MAC entre dock e Wi-Fi, e VPN cria adaptador novo. Cada
um desses viraria um agente travado numa segunda-feira de manhã.

⚠️ Isto identifica a **instalação**, não o equipamento. Copiar a pasta
inteira para outra máquina leva a impressão junto — mas quem copia a
pasta leva o token junto também, e aí a trava já foi. Amarração ao
hardware de verdade depende do que o sistema operacional oferece, e é
trabalho de outra etapa.
"""

from __future__ import annotations

import json
import logging
import os
import platform
import uuid
from pathlib import Path

_log = logging.getLogger(__name__)

NOME_PADRAO = "maquina.json"


def arquivo_ao_lado(caminho_config: str | Path) -> Path:
    """O arquivo de identidade mora junto da configuração.

    Ficam juntos de propósito: quem faz backup de um leva o outro, e quem
    apaga a pasta para "começar do zero" entende por que precisou de token
    novo.
    """
    return Path(caminho_config).parent / NOME_PADRAO


def fingerprint(caminho: str | Path) -> str:
    """Lê a impressão desta instalação, criando-a na primeira vez."""
    p = Path(caminho)

    if p.is_file():
        try:
            dados = json.loads(p.read_text(encoding="utf-8"))
            valor = str(dados.get("fingerprint") or "")
            if valor:
                return valor
            _log.warning("%s existe mas não tem fingerprint; gerando outra", p)
        except (OSError, json.JSONDecodeError) as e:
            # Arquivo corrompido. Gerar outra impressão fará a nuvem
            # recusar a ativação com 409 — o que é o certo: é uma pessoa
            # que decide se isto é troca legítima de máquina ou um clone.
            _log.error("identidade da máquina ilegível (%s); vou gerar outra", e)

    valor = uuid.uuid4().hex
    p.parent.mkdir(parents=True, exist_ok=True)
    temporario = p.with_suffix(p.suffix + ".tmp")
    temporario.write_text(
        json.dumps(
            {
                "fingerprint": valor,
                # Só para quem for ler o arquivo entender de onde veio.
                # Nada aqui é usado para autenticar.
                "host": platform.node(),
                "sistema": platform.platform(),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    os.replace(temporario, p)
    _log.info("identidade desta instalação criada em %s", p)
    return valor
