"""Os recortes da noite sobem para MARCAR (A24 F3, parte 3 de "Marcar ingredientes").

O dono, 23/10/2026: "para treinamento inicial, antes de associar com ficha, primeiro teríamos que treinar identificar
ingrediente como no teste de 112 [...] ali é um bom treinamento". O protótipo "Marcar ingredientes" foi aprovado em
24/10/2026; a nuvem (migration 055) e a tela entraram nos PRs #210 e #211.

Depois que a noite termina, com a loja FECHADA, na mesma volta que sobe os lanches da conferência
(`passos_na_nuvem.ConferenciaEmFundo`), sobe uma amostra dos RECORTES dos passos da noite (`POST
/v1/agentes/treino/recortes`; o contrato é `contratos/recorte-para-marcar.json`), na mesma gravação `ao-vivo`. Na tela,
a pessoa marca a pilha de cada recorte; o de cima vira exemplo da base da loja, que desce para o juiz (`base_da_loja`),
e o juiz treinado se refaz com ele (com a loja fechada: `BaseEmFundo(depois_de_mudar=...)`).

**A amostra** (`POR_NOITE` recortes por canal; `FAROL_MARCAR_POR_NOITE` muda, 0 desliga): só dos lanches lidos com o
juiz e que NÃO subiram para a conferência (esses já são conferidos inteiros). Os candidatos são os passos com recorte:
o começo da peça (o pão), o passo, o provisório e o vazio (o que o juiz tirou). Em três partes, como o lote que o dono
marcou em 23/10:

- **dúvida** (até 40%): o vazio, e o passo e o provisório com nota abaixo de `NOTA_DE_DUVIDA` — a regra da nuvem;
- **começo** (até 10%): o pão de cada peça (o juiz ainda não diz qual pão);
- **cobertura** (o resto): um pouco de CADA nome que o juiz deu, um nome de cada vez, até completar.

O que sobra de uma parte vai para as outras. Dentro de cada parte, espalhado pela noite (a hora), e sempre a mesma
escolha para os mesmos passos. A escolha da noite fica guardada (`recortes-para-marcar.json`, na pasta do canal): a
volta seguinte só manda o que falta, até 25 por envio.

**A resposta decide**, como os lanches: 409 (a gravação foi cancelada ou apagada no console) — a noite para (a mesma
lista de encerradas da conferência); 422 — aquele envio não sobe de novo (os recortes dele ficam como recusados); rede,
5xx, 401, 403 e 429 — de novo na volta seguinte, e a volta para ali.
"""

from __future__ import annotations

import base64
import logging
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Protocol

from farol_agent import imagens
from farol_agent.nuvem import ErroDaNuvem
from farol_agent.treino_corpo import LADO_DO_QUADRO, _com_fuso, reduzir

_log = logging.getLogger(__name__)

VARIAVEL_POR_NOITE = "FAROL_MARCAR_POR_NOITE"
# Os recortes de cada noite, por canal, que sobem para marcar (o protótipo: "uns 100 recortes").
POR_NOITE = 100
MAX_POR_NOITE = 300
# Os limites do contrato (`limites` em `contratos/recorte-para-marcar.json`).
POR_ENVIO = 25
MAX_CHAVE = 160
MAX_LANCHE = 120
MAX_PALPITE = 120
MAX_PECAS = 8
# As partes da amostra (o lote que o dono marcou em 23/10: 40 de dúvida, 12 começos, o resto de cobertura).
PARTE_DUVIDA = 0.40
PARTE_COMECO = 0.10
COM_RECORTE = ("comeco", "passo", "provisorio", "vazio")
ESTADO = "recortes-para-marcar.json"
# As noites guardadas no estado (as mais novas): a leitura guarda os passos por poucos dias.
GUARDA_NOITES = 30


class ClienteDosRecortes(Protocol):
    def recortes_para_marcar(self, corpo: dict[str, Any]) -> dict[str, Any]: ...


def por_noite(valor: str | None) -> int:
    """`FAROL_MARCAR_POR_NOITE`: quantos recortes de cada noite sobem (0 desliga). Sem ela, ou torta, `POR_NOITE`."""
    if valor is None or not valor.strip():
        return POR_NOITE
    try:
        n = int(valor.strip())
    except ValueError:
        _log.warning("marcar: %s=%r não é um número; fico com %d recortes por noite", VARIAVEL_POR_NOITE, valor, POR_NOITE)
        return POR_NOITE
    return min(MAX_POR_NOITE, max(0, n))


@dataclass(frozen=True)
class Candidato:
    """Um passo com recorte, de um lanche da noite."""

    pasta: Path
    arquivo: str
    hora: datetime
    metade: int | None
    tipo: str
    nome: str | None
    nota: float | None
    contorno: Any

    @property
    def chave(self) -> str:
        return f"{self.pasta.name}/{self.arquivo}"[:MAX_CHAVE]


def motivo(c: Candidato, nota_de_duvida: float) -> str:
    """A parte da amostra: o começo; a dúvida (o vazio, e o passo e o provisório com nota baixa); o resto, cobertura."""
    if c.tipo == "comeco":
        return "comeco"
    if c.tipo == "vazio" or (isinstance(c.nota, (int, float)) and c.nota < nota_de_duvida):
        return "duvida"
    return "cobertura"


def _espalhados(lista: list[Candidato], n: int) -> list[Candidato]:
    """`n` da lista (já na ordem da hora), espalhados por ela — sempre os mesmos."""
    if n <= 0:
        return []
    if n >= len(lista):
        return list(lista)
    passo = len(lista) / n
    return [lista[int(i * passo + passo / 2)] for i in range(n)]


def amostra(candidatos: list[Candidato], n: int, nota_de_duvida: float) -> list[tuple[Candidato, str]]:
    """Os recortes da noite que sobem, com o motivo de cada um, na ordem da hora. Dúvida até 40%, começo até 10%, o
    resto um pouco de cada nome; o que falta numa parte, as outras completam. A mesma escolha para os mesmos passos."""
    if n <= 0 or not candidatos:
        return []
    por_hora = sorted(candidatos, key=lambda c: (c.hora, c.pasta.name, c.arquivo))
    partes: dict[str, list[Candidato]] = {"duvida": [], "comeco": [], "cobertura": []}
    for c in por_hora:
        partes[motivo(c, nota_de_duvida)].append(c)
    cotas = {"duvida": round(n * PARTE_DUVIDA), "comeco": round(n * PARTE_COMECO)}
    escolhidos: dict[str, list[Candidato]] = {
        "duvida": _espalhados(partes["duvida"], cotas["duvida"]),
        "comeco": _espalhados(partes["comeco"], cotas["comeco"]),
    }
    # a cobertura: um nome de cada vez (a ordem dos nomes é a do primeiro passo de cada um), espalhado pela noite
    vagas = n - len(escolhidos["duvida"]) - len(escolhidos["comeco"])
    por_nome: dict[str, list[Candidato]] = {}
    for c in partes["cobertura"]:
        por_nome.setdefault((c.nome or "").strip().lower(), []).append(c)
    quantos = {k: 0 for k in por_nome}
    while vagas > 0 and any(quantos[k] < len(v) for k, v in por_nome.items()):
        for k, v in por_nome.items():
            if vagas > 0 and quantos[k] < len(v):
                quantos[k] += 1
                vagas -= 1
    escolhidos["cobertura"] = [c for k, v in por_nome.items() for c in _espalhados(v, quantos[k])]
    # o que sobrou de vaga: mais dúvida, depois mais começo
    for parte in ("duvida", "comeco"):
        if vagas <= 0:
            break
        ja = {c.chave for c in escolhidos[parte]}
        resto = [c for c in partes[parte] if c.chave not in ja]
        mais = _espalhados(resto, min(vagas, len(resto)))
        escolhidos[parte] += mais
        vagas -= len(mais)
    saida = [(c, parte) for parte, lista in escolhidos.items() for c in lista]
    return sorted(saida, key=lambda x: (x[0].hora, x[0].pasta.name, x[0].arquivo))


def candidatos_do_lanche(pasta: Path, leitura: dict, hora_de: Any) -> list[Candidato]:
    """Os passos com recorte de um lanche lido por passos (`leitura` é o `passos.json` dele; `hora_de` lê a hora)."""
    saida = []
    for p in leitura.get("passos") or []:
        if not isinstance(p, dict) or p.get("tipo") not in COM_RECORTE:
            continue
        arquivo, hora = p.get("recorte"), hora_de(p.get("hora"))
        if not (isinstance(arquivo, str) and arquivo and Path(arquivo).name == arquivo) or hora is None:
            continue
        metade = p.get("metade")
        nota = p.get("nota")
        nome = p.get("nome")
        saida.append(Candidato(
            pasta=pasta, arquivo=arquivo, hora=hora,
            metade=metade if isinstance(metade, int) and not isinstance(metade, bool) and 1 <= metade <= MAX_PECAS else None,
            tipo=p["tipo"], nome=nome.strip() if isinstance(nome, str) and nome.strip() else None,
            nota=float(nota) if isinstance(nota, (int, float)) and not isinstance(nota, bool) else None,
            contorno=p.get("contorno"),
        ))
    return saida


def recorte(c: Candidato, parte: str, contorno_de: Any) -> dict | None:
    """Um recorte do corpo: a imagem reduzida, com o contorno na escala dela. Nulo se a imagem não abre."""
    img = imagens.ler(c.pasta / c.arquivo)
    dados = reduzir(img) if img is not None else None
    if dados is None:
        return None
    h, w = img.shape[:2]
    k = min(1.0, LADO_DO_QUADRO / max(h, w))
    contorno = contorno_de(c.contorno, k, max(1, round(w * k)), max(1, round(h * k))) or None
    # o vazio é o que o juiz TIROU: o "parece" dele não é o palpite (a nuvem conta o acerto pelo palpite)
    palpite = c.nome[:MAX_PALPITE] if c.nome and c.tipo in ("passo", "provisorio") else None
    nota = round(min(1.0, max(0.0, c.nota)), 3) if palpite and c.nota is not None else None
    return {
        "chave": c.chave, "lanche": c.pasta.name[:MAX_LANCHE], "hora": _com_fuso(c.hora), "peca": c.metade,
        "motivo": parte, "palpite": palpite, "nota": nota, "contorno": contorno,
        "imagemBase64": base64.b64encode(dados).decode("ascii"),
    }


def mandar(cliente: ClienteDosRecortes, corpo: dict) -> tuple[str, str | None]:
    """Manda um envio e diz o destino dele (`enviado`, `encerrada`, `recusado` ou `depois`), com o motivo."""
    try:
        cliente.recortes_para_marcar(corpo)
    except ErroDaNuvem as e:
        if e.status == 409:
            return "encerrada", str(e)
        if e.status in (0, 401, 403, 429) or e.status >= 500:
            return "depois", str(e)
        return "recusado", str(e)
    return "enviado", None
