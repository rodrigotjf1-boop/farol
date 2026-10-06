"""A configuração que desce da nuvem, e a cópia que fica em disco.

A configuração é feita no app e desce para o agente usar. Aqui ela vira
objeto do domínio (`Zona`, `Regra`) e **fica gravada em disco**.

O disco não é cache de desempenho — é o que mantém a loja auditando
quando a internet cai. Uma cozinha não para porque o link oscilou, e um
agente que precisasse da nuvem para funcionar seria desligado na primeira
semana, com razão.

Daí as três regras que o módulo guarda:

1. **Converte ANTES de gravar.** Configuração que não se entende não
   sobrescreve a boa que já está lá. Gravar primeiro e descobrir o erro
   depois deixaria o agente sem nada ao reiniciar.
2. **Grava de forma atômica.** Arquivo temporário e troca. Queda de luz
   no meio da escrita não pode deixar um JSON pela metade que o agente
   não consegue ler no próximo boot.
3. **Nuvem fora do ar não apaga nada.** Sem resposta, vale o que está em
   disco.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from farol_agent.modelos import (
    RESOLUCOES,
    Janela,
    Prioridade,
    Regra,
    Severidade,
    TipoRegra,
    Zona,
)

_log = logging.getLogger(__name__)


class ErroDeConfiguracao(Exception):
    pass


@dataclass
class PontoConfig:
    """Um canal, com o recorte do canal e o que se audita nele."""

    id: str
    nome: str
    setor: str = ""
    origem: str = "dvr"
    fabricante: str | None = None
    canal: int | None = None
    host: str | None = None
    porta: int | None = None
    usuario: str | None = None
    # Referência ao cofre LOCAL. Nunca é o segredo: ele não existe na
    # nuvem e não chega aqui.
    segredo_ref: str | None = None
    url_main: str | None = None
    url_sub: str | None = None
    zonas: list[Zona] = field(default_factory=list)
    regras: list[Regra] = field(default_factory=list)
    optica: dict[str, Any] = field(default_factory=dict)
    zona_principal_id: str | None = None

    @property
    def zona_principal(self) -> Zona | None:
        """O corte DO CANAL — o que vale para análise que não mire zona.

        Na falta de desenho do usuário, o console cria "Quadro inteiro"
        como principal, então isto só é `None` em configuração malformada.
        """
        for z in self.zonas:
            if z.id == self.zona_principal_id:
                return z
        return self.zonas[0] if self.zonas else None


@dataclass
class ConfigDaLoja:
    loja_id: str
    loja_nome: str
    versao: int
    # Decide qual juiz atende cada regra. `hibrido` é o padrão seguro:
    # tenta local e cai para a nuvem só no que o desenho permite sair.
    modo_julgamento: str = "hibrido"
    resolucao_padrao: str = "r640"
    pontos: list[PontoConfig] = field(default_factory=list)

    def ponto(self, ponto_id: str) -> PontoConfig | None:
        return next((p for p in self.pontos if p.id == ponto_id), None)

    @property
    def regras(self) -> list[Regra]:
        return [r for p in self.pontos for r in p.regras]


# ───────────────────────────── conversão ─────────────────────────────


def _enum(valor: Any, tipo: type, onde: str, campo: str):
    try:
        return tipo(valor)
    except ValueError:
        validos = ", ".join(m.value for m in tipo)  # type: ignore[attr-defined]
        raise ErroDeConfiguracao(
            f"{onde}: {campo}={valor!r} inválido. Válidos: {validos}"
        ) from None


def _zona(dados: dict[str, Any], onde: str) -> Zona:
    poligono = dados.get("poligono") or []
    if len(poligono) < 3:
        raise ErroDeConfiguracao(f"{onde}: polígono precisa de 3 pontos ou mais")
    return Zona(
        id=str(dados["id"]),
        nome=str(dados.get("nome") or "zona"),
        poligono=[(float(p[0]), float(p[1])) for p in poligono],
    )


def _regra(dados: dict[str, Any], zona: Zona) -> Regra:
    onde = f"regra {dados.get('id')}"

    resolucao = str(dados.get("resolucao") or "r640")
    if resolucao not in RESOLUCOES:
        raise ErroDeConfiguracao(
            f"{onde}: resolucao={resolucao!r} inválida. Válidas: {', '.join(RESOLUCOES)}"
        )

    janelas = [
        Janela(
            dias=[int(d) for d in (j.get("dias") or [])],
            hora_ini=str(j.get("hora_ini", "00:00")),
            hora_fim=str(j.get("hora_fim", "23:59")),
        )
        for j in (dados.get("janelas") or [])
    ]

    return Regra(
        id=str(dados["id"]),
        zona=zona,
        nome=str(dados.get("nome") or dados["id"]),
        tipo=_enum(dados.get("tipo"), TipoRegra, onde, "tipo"),
        criterio=str(dados.get("criterio") or ""),
        # Entra na chave de idempotência da fila: critério mudou, veredito
        # antigo não vale e a análise refaz.
        criterio_versao=int(dados.get("criterioVersao") or 1),
        processo_descricao=dados.get("processoDescricao"),
        prioridade=_enum(
            dados.get("prioridade") or "intermediaria", Prioridade, onde, "prioridade"
        ),
        severidade=_enum(
            dados.get("severidade") or "atencao", Severidade, onde, "severidade"
        ),
        confianca_minima=float(dados.get("confiancaMinima") or 0.70),
        cooldown_min=int(dados.get("cooldownMin") or 15),
        resolucao=resolucao,
        janelas=janelas,
        acoes=[str(a) for a in (dados.get("acoes") or ["registro"])],
        base_id=dados.get("baseId"),
        # A nuvem só manda regra ligada: a rota filtra por `ativa`. Se um
        # dia mandar desligada, aqui ela continua desligada — o agente não
        # liga regra por conta própria.
        ativa=True,
        borrar_rosto=True,
    )


def de_json(dados: dict[str, Any]) -> ConfigDaLoja:
    """Converte a resposta de `/v1/agentes/configuracao` em domínio.

    Levanta em vez de ignorar campo inválido: configuração errada que
    passa calada vira auditoria errada, e ninguém liga o alerta estranho
    de terça ao campo que foi salvo na segunda.
    """
    if not isinstance(dados, dict) or "loja" not in dados:
        raise ErroDeConfiguracao("resposta não parece configuração da loja")

    pontos: list[PontoConfig] = []
    for p in dados.get("pontos") or []:
        onde = f"ponto {p.get('nome') or p.get('id')}"
        zonas: list[Zona] = []
        regras: list[Regra] = []
        principal_id: str | None = None

        for z in p.get("zonas") or []:
            zona = _zona(z, f"{onde} / zona {z.get('nome')}")
            zonas.append(zona)
            if z.get("principal"):
                principal_id = zona.id
            for r in z.get("regras") or []:
                regras.append(_regra(r, zona))

        pontos.append(
            PontoConfig(
                id=str(p["id"]),
                nome=str(p.get("nome") or ""),
                setor=str(p.get("setor") or ""),
                origem=str(p.get("origem") or "dvr"),
                fabricante=p.get("fabricante"),
                canal=p.get("canal"),
                host=p.get("host"),
                porta=p.get("porta"),
                usuario=p.get("usuario"),
                segredo_ref=p.get("segredoRef"),
                url_main=p.get("urlMain"),
                url_sub=p.get("urlSub"),
                zonas=zonas,
                regras=regras,
                optica=p.get("optica") or {},
                zona_principal_id=principal_id,
            )
        )

    return ConfigDaLoja(
        loja_id=str(dados["loja"]["id"]),
        loja_nome=str(dados["loja"].get("nome") or ""),
        versao=int(dados.get("versao") or 0),
        modo_julgamento=str(dados["loja"].get("modoJulgamento") or "hibrido"),
        resolucao_padrao=str(dados["loja"].get("resolucaoPadrao") or "r640"),
        pontos=pontos,
    )


# ───────────────────────────── disco ─────────────────────────────


def salvar(caminho: str | Path, bruto: dict[str, Any]) -> None:
    """Grava a configuração CRUA, de forma atômica.

    Grava o JSON como veio, não o objeto convertido: assim uma versão
    futura do agente que entenda campos novos os encontra aqui, em vez de
    ter sido silenciosamente podado por esta.
    """
    p = Path(caminho)
    p.parent.mkdir(parents=True, exist_ok=True)
    temporario = p.with_suffix(p.suffix + ".tmp")
    temporario.write_text(
        json.dumps(bruto, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    # Troca atômica: queda de luz no meio não deixa JSON pela metade que o
    # agente não consegue ler no próximo boot.
    os.replace(temporario, p)


def ler_do_disco(caminho: str | Path) -> dict[str, Any] | None:
    """A última configuração conhecida. `None` quando não há nenhuma."""
    p = Path(caminho)
    if not p.is_file():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        _log.warning("configuração em disco ilegível (%s): seguindo sem ela", e)
        return None


# ──────────────────────────── sincronização ────────────────────────────


class Sincronizador:
    """Mantém a configuração local em dia com a nuvem.

    O heartbeat devolve `configVersao` — um inteiro. Igual ao que está em
    memória, não faz nada; diferente, puxa a configuração inteira. É o que
    permite bater de dois em dois segundos sem trafegar a configuração a
    cada batida.

    **Nada aqui derruba o agente.** Nuvem fora, token recusado,
    configuração malformada: o agente segue com o que tem em disco e
    registra o motivo. Auditoria que para quando o link oscila não serve a
    uma cozinha — e o motivo registrado é o que evita o diagnóstico "não
    sei, parou".
    """

    def __init__(
        self,
        cliente,
        caminho: str | Path,
        *,
        versao_app: str | None = None,
    ) -> None:
        self.cliente = cliente
        self.caminho = Path(caminho)
        self.versao_app = versao_app
        self.config: ConfigDaLoja | None = None
        self.ultimo_erro: str | None = None
        self.carregar_do_disco()

    def carregar_do_disco(self) -> ConfigDaLoja | None:
        """O que o agente usa enquanto a nuvem não responde."""
        bruto = ler_do_disco(self.caminho)
        if bruto is None:
            return None
        try:
            self.config = de_json(bruto)
        except ErroDeConfiguracao as e:
            # Configuração gravada que não se entende mais: provavelmente
            # de uma versão anterior. Não dá para usar, mas não se apaga —
            # apagar tiraria a chance de alguém olhar o arquivo e entender.
            _log.error("configuração em disco não pôde ser lida: %s", e)
            self.ultimo_erro = str(e)
        return self.config

    def bater(self) -> list[dict[str, Any]]:
        """Um heartbeat. Devolve os comandos pendentes.

        Puxa a configuração sozinho quando a versão da nuvem difere da que
        está em memória.
        """
        from farol_agent.nuvem import ErroDaNuvem

        try:
            resposta = self.cliente.heartbeat(self.versao_app)
        except ErroDaNuvem as e:
            self.ultimo_erro = str(e)
            # Recuperável ou não, o agente não para: ele segue auditando
            # com a configuração que tem. O que muda é só o que se registra.
            _log.warning(
                "heartbeat falhou (%s): seguindo com a configuração local", e
            )
            return []

        self.ultimo_erro = None
        remota = resposta.get("configVersao")
        local = self.config.versao if self.config else None
        if remota is not None and remota != local:
            _log.info("configuração mudou na nuvem (%s → %s)", local, remota)
            self.puxar()

        comandos = list(resposta.get("comandos") or [])
        if comandos:
            _log.info("%d comando(s) para atender", len(comandos))
        return comandos

    def puxar(self) -> ConfigDaLoja | None:
        """Busca a configuração e grava. Converte ANTES de gravar.

        Se a conversão falhar, a configuração boa que está em disco
        permanece. Gravar primeiro e descobrir o erro depois deixaria o
        agente sem nada ao reiniciar — uma falha de rede vira uma loja
        parada no dia seguinte.
        """
        from farol_agent.nuvem import ErroDaNuvem

        try:
            bruto = self.cliente.configuracao()
            nova = de_json(bruto)
        except (ErroDaNuvem, ErroDeConfiguracao) as e:
            self.ultimo_erro = str(e)
            _log.error("não consegui atualizar a configuração: %s", e)
            return self.config

        salvar(self.caminho, bruto)
        self.config = nova
        _log.info(
            "configuração v%s: %d ponto(s), %d regra(s) ativa(s)",
            nova.versao,
            len(nova.pontos),
            len(nova.regras),
        )
        return self.config
