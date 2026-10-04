"""Conversa com o gravador.

`dahua` serve a linha Dahua e os OEM dela — que inclui a Intelbras MHDX,
o gravador do cliente-âncora. `descoberta` acha o aparelho na rede antes
de alguém precisar saber o IP.
"""

from farol_agent.dvr.dahua import ClienteDahua, ErroDoGravador, Evento

__all__ = ["ClienteDahua", "ErroDoGravador", "Evento"]
