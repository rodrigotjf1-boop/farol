"""Carrega zonas e regras de um YAML.

No produto final a configuração desce do console; este carregador é o que
permite trabalhar antes de o console existir — e continua útil depois, como
o jeito de rodar uma loja em modo offline ou de reproduzir um cenário.

O arquivo é a fonte da verdade do que o agente vai auditar, então erro aqui
tem que estourar **no carregamento**, com o nome do campo e da regra. Erro
de configuração descoberto às três da tarde, dentro do laço, é erro que
ninguém liga ao arquivo que foi editado de manhã.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from farol_agent.modelos import (
    RESOLUCOES,
    Janela,
    Prioridade,
    Regra,
    Severidade,
    TipoRegra,
    Zona,
)


class ErroDeConfig(Exception):
    pass


def _exigir(dados: dict[str, Any], campo: str, onde: str) -> Any:
    if campo not in dados or dados[campo] in (None, ""):
        raise ErroDeConfig(f"{onde}: campo obrigatório ausente: {campo}")
    return dados[campo]


def _enum(valor: Any, tipo: type, onde: str, campo: str):
    try:
        return tipo(valor)
    except ValueError:
        validos = ", ".join(m.value for m in tipo)  # type: ignore[attr-defined]
        raise ErroDeConfig(
            f"{onde}: {campo}={valor!r} inválido. Válidos: {validos}"
        ) from None


def carregar_zonas(dados: dict[str, Any]) -> dict[str, Zona]:
    zonas: dict[str, Zona] = {}
    for zid, z in (dados.get("zonas") or {}).items():
        poligono = _exigir(z, "poligono", f"zona {zid}")
        if len(poligono) < 3:
            raise ErroDeConfig(f"zona {zid}: polígono precisa de ao menos 3 pontos")
        pontos = []
        for p in poligono:
            x, y = float(p[0]), float(p[1])
            if not (0.0 <= x <= 1.0 and 0.0 <= y <= 1.0):
                # Coordenada em pixel num campo normalizado é o engano mais
                # comum, e silencioso: o recorte sai do quadro inteiro e
                # ninguém entende por que o modelo não vê a bancada.
                raise ErroDeConfig(
                    f"zona {zid}: ponto ({x}, {y}) fora de 0..1 — "
                    "o polígono é normalizado, não em pixels"
                )
            pontos.append((x, y))
        zonas[zid] = Zona(id=zid, nome=z.get("nome", zid), poligono=pontos)
    return zonas


def carregar_regras(dados: dict[str, Any], zonas: dict[str, Zona]) -> list[Regra]:
    regras: list[Regra] = []
    vistos: set[str] = set()

    for r in dados.get("regras") or []:
        rid = str(_exigir(r, "id", "regra sem id"))
        onde = f"regra {rid}"

        if rid in vistos:
            raise ErroDeConfig(f"{onde}: id repetido")
        vistos.add(rid)

        zid = str(_exigir(r, "zona", onde))
        if zid not in zonas:
            raise ErroDeConfig(
                f"{onde}: zona {zid!r} não existe. Definidas: {', '.join(zonas) or '(nenhuma)'}"
            )

        resolucao = str(r.get("resolucao", "r640"))
        if resolucao not in RESOLUCOES:
            raise ErroDeConfig(
                f"{onde}: resolucao={resolucao!r} inválida. "
                f"Válidas: {', '.join(RESOLUCOES)}"
            )

        janelas = []
        for j in r.get("janelas") or []:
            janelas.append(
                Janela(
                    dias=[int(d) for d in (j.get("dias") or [])],
                    hora_ini=str(j.get("hora_ini", "00:00")),
                    hora_fim=str(j.get("hora_fim", "23:59")),
                )
            )

        regras.append(
            Regra(
                id=rid,
                zona=zonas[zid],
                nome=str(r.get("nome", rid)),
                tipo=_enum(_exigir(r, "tipo", onde), TipoRegra, onde, "tipo"),
                criterio=str(_exigir(r, "criterio", onde)),
                criterio_versao=int(r.get("criterio_versao", 1)),
                processo_descricao=r.get("processo_descricao"),
                prioridade=_enum(
                    r.get("prioridade", "intermediaria"), Prioridade, onde, "prioridade"
                ),
                severidade=_enum(
                    r.get("severidade", "atencao"), Severidade, onde, "severidade"
                ),
                confianca_minima=float(r.get("confianca_minima", 0.70)),
                cooldown_min=int(r.get("cooldown_min", 15)),
                resolucao=resolucao,
                janelas=janelas,
                acoes=[str(a) for a in (r.get("acoes") or ["registro"])],
                base_id=r.get("base_id"),
                # Regra nasce DESLIGADA. Ligar exige acurácia medida contra
                # o conjunto de avaliação — e o default do carregador não
                # pode ser o que fura essa regra.
                ativa=bool(r.get("ativa", False)),
                borrar_rosto=bool(r.get("borrar_rosto", True)),
            )
        )

    return regras


def carregar(caminho: str | Path) -> tuple[str, list[Regra]]:
    """Lê o YAML e devolve `(ponto_id, regras)`."""
    p = Path(caminho)
    try:
        dados = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    except FileNotFoundError:
        raise ErroDeConfig(f"configuração não encontrada: {p}") from None
    except yaml.YAMLError as e:
        raise ErroDeConfig(f"YAML inválido em {p}: {e}") from None

    ponto_id = str(dados.get("ponto_id") or "ponto")
    zonas = carregar_zonas(dados)
    regras = carregar_regras(dados, zonas)
    return ponto_id, regras
