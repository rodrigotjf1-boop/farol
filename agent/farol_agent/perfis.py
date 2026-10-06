"""Catálogo de perfis de gravador, do lado do agente.

A fonte da verdade é a tabela `perfil_gravador` no banco. Esta cópia
existe porque **o agente tem que subir sem internet**: o PC da loja liga
antes do roteador, a nuvem cai, o console está em manutenção — e nada
disso pode impedir a loja de ser auditada. O console atualiza esta cópia
quando houver rede; sem ela, o agente usa o que sabe.

`verificado` repete aqui a distinção que a migration 004 criou no banco:
perfil medido num aparelho real vale mais que perfil lido em manual, e
quem recomenda equipamento ao cliente precisa saber de qual se trata.
"""

from __future__ import annotations

import urllib.parse
from dataclasses import dataclass


@dataclass(frozen=True)
class PerfilGravador:
    fabricante: str
    modelo: str | None
    url_main_tpl: str
    url_sub_tpl: str
    porta_padrao: int = 554
    evento_tipo: str = "nenhum"
    evento_religa: bool = False
    canais: int | None = None
    verificado: bool = False
    observacoes: str = ""

    def url(
        self,
        *,
        host: str,
        usuario: str,
        senha: str,
        canal: int,
        porta: int | None = None,
        sub: bool = False,
    ) -> str:
        if canal < 1:
            raise ValueError("canal começa em 1, como na tela do gravador")
        tpl = self.url_sub_tpl if sub else self.url_main_tpl
        return tpl.format(
            host=host,
            porta=porta or self.porta_padrao,
            canal=canal,
            # Escapar não é detalhe: senha com @ ou / quebra a URL e o
            # login falha sem mensagem que ajude.
            usuario=urllib.parse.quote(usuario, safe=""),
            senha=urllib.parse.quote(senha, safe=""),
        )


_DAHUA_MAIN = "rtsp://{usuario}:{senha}@{host}:{porta}/cam/realmonitor?channel={canal}&subtype=0"
_DAHUA_SUB = "rtsp://{usuario}:{senha}@{host}:{porta}/cam/realmonitor?channel={canal}&subtype=1"

CATALOGO: tuple[PerfilGravador, ...] = (
    PerfilGravador(
        fabricante="intelbras",
        modelo="MHDX 3116-C",
        url_main_tpl=_DAHUA_MAIN,
        url_sub_tpl=_DAHUA_SUB,
        evento_tipo="dahua_cgi",
        # Medido em 05/10/2026, unidade DTP0014446184, firmware
        # 4.001.00IB000.0.T: a transmissão fecha a cada evento.
        evento_religa=True,
        canais=16,
        verificado=True,
        observacoes=(
            "Dahua OEM. Inteligência de vídeo em 1 canal apenas; movimento em todos. "
            "Trunca a lista de codes em ~100 caracteres: usar [All] e filtrar no agente. "
            "Contagem de canais só por table.ChannelTitle neste firmware."
        ),
    ),
    # Genérico da linha Dahua e OEM. Não verificado: serve de ponto de
    # partida, e o console deve marcar como medido quando alguém sondar.
    PerfilGravador(
        fabricante="dahua",
        modelo=None,
        url_main_tpl=_DAHUA_MAIN,
        url_sub_tpl=_DAHUA_SUB,
        evento_tipo="dahua_cgi",
        observacoes="Perfil genérico da linha Dahua e OEM (Intelbras, Amcrest).",
    ),
    # Genérico Intelbras. A linha é OEM da Dahua e fala o mesmo dialeto —
    # a ficha da MHDX acima registra isso. Sem este perfil,
    # `achar("intelbras")` devolvia None para qualquer modelo fora da
    # lista, e um Intelbras comum não abria canal nenhum: a instalação
    # travaria por não ter o modelo cadastrado, que é exatamente o que o
    # genérico existe para evitar.
    PerfilGravador(
        fabricante="intelbras",
        modelo=None,
        url_main_tpl=_DAHUA_MAIN,
        url_sub_tpl=_DAHUA_SUB,
        evento_tipo="dahua_cgi",
        observacoes=(
            "Genérico Intelbras, OEM da Dahua. Não verificado: ponto de partida, "
            "e o console deve marcar como medido quando alguém sondar o aparelho."
        ),
    ),
    PerfilGravador(
        fabricante="hikvision",
        modelo=None,
        url_main_tpl="rtsp://{usuario}:{senha}@{host}:{porta}/Streaming/Channels/{canal}01",
        url_sub_tpl="rtsp://{usuario}:{senha}@{host}:{porta}/Streaming/Channels/{canal}02",
        evento_tipo="isapi",
        observacoes="ISAPI. O sufixo 01/02 é main/sub, não o número do canal.",
    ),
)


def achar(fabricante: str, modelo: str | None = None) -> PerfilGravador | None:
    """Perfil do modelo exato; sem ele, o genérico do fabricante.

    Devolver o genérico em vez de nada é deliberado: um gravador Dahua
    desconhecido quase sempre fala o dialeto Dahua, e recusar atendimento
    por não ter o modelo na lista travaria instalação por nada. Quem usa
    o genérico sabe, porque `verificado` é falso.
    """
    f = fabricante.strip().lower()
    m = (modelo or "").strip().lower()

    if m:
        for p in CATALOGO:
            if p.fabricante == f and (p.modelo or "").lower() == m:
                return p

    for p in CATALOGO:
        if p.fabricante == f and p.modelo is None:
            return p
    return None
