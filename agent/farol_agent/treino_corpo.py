"""O corpo do lanche de treino, para a conferência (A21, fatia T3c-4).

Cada lanche que a leitura da bancada achou (`treino_lanches`) vira o corpo de
`POST /v1/agentes/treino/lanches` (o contrato é `contratos/lanche-de-treino.json`):
a gravação, o lanche (quando abriu, quando fechou, as etapas) e os quadros das
etapas, REDUZIDOS (decisão 1 do dono, 15/10/2026: os quadros das etapas sobem
reduzidos, para conferir, e saem 30 dias depois da conferência; a gravação
inteira fica na loja).

**Sem identificação, a etapa vai sem leitura.** Enquanto a identificação dos
ingredientes (T3c-3) não entra, a etapa sai com `leu` nulo e sem candidatos —
a conferência pergunta à pessoa o que era, e a resposta vira exemplo da base
(T4). Quem tem a identificação passa as etapas lidas (`etapas`).

**Os limites do contrato** valem aqui antes de valer lá: até 60 etapas, até 40
quadros de até 300 kB, até 12 candidatos, "vezes" de 1 a 6. A etapa que passa
dos 40 quadros vai sem quadro.

E o envio, com o destino de cada resposta: 409 (a gravação foi encerrada no
console) para de mandar os lanches dela; 422 não se repete (é erro de quem
mandou); rede e 5xx, de novo depois.

**Dorme:** nada no agente chama este módulo ainda (a T3d liga).
"""

from __future__ import annotations

import base64
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Callable

import cv2
import numpy as np

from farol_agent.nuvem import ErroDaNuvem
from farol_agent.treino import Gravacao

_log = logging.getLogger(__name__)

MAX_ETAPAS = 60
MAX_QUADROS = 40
MAX_BYTES_DO_QUADRO = 300_000
MAX_CANDIDATOS = 12
VEZES = (1, 6)
LADOS = ("pao", "tampo", "base", "outro")
# O lado maior do quadro reduzido (a carga de 14/10 subiu com até 360 px).
LADO_DO_QUADRO = 360

ENVIADO, ENCERRADA, RECUSADO, DEPOIS = "enviado", "encerrada", "recusado", "depois"


def _com_fuso(t: datetime) -> str:
    """A hora da loja com o fuso dela (o computador da loja está no fuso dela)."""
    return (t if t.tzinfo is not None else t.astimezone()).isoformat(timespec="seconds")


def hora_do_recorte(nome: str, inicio: datetime) -> datetime:
    """A hora de um recorte do lanche ("21h00m12.jpg"), no dia do lanche — e no dia seguinte, se passou da meia-noite."""
    t = datetime.strptime(Path(nome).stem, "%Hh%Mm%S")
    hora = inicio.replace(hour=t.hour, minute=t.minute, second=t.second, microsecond=0)
    return hora + timedelta(days=1) if hora < inicio.replace(microsecond=0) else hora


def reduzir(imagem: np.ndarray, lado: int = LADO_DO_QUADRO) -> bytes | None:
    """O quadro reduzido (lado maior até `lado`), em JPEG, dentro do limite do contrato."""
    h, w = imagem.shape[:2]
    k = lado / max(h, w)
    if k < 1.0:  # o pequeno não aumenta
        imagem = cv2.resize(imagem, (max(1, round(w * k)), max(1, round(h * k))), interpolation=cv2.INTER_AREA)
    for qualidade in (85, 70, 55):
        ok, dados = cv2.imencode(".jpg", imagem, [cv2.IMWRITE_JPEG_QUALITY, qualidade])
        if ok and len(dados) <= MAX_BYTES_DO_QUADRO:
            return dados.tobytes()
    return None


def _ler(caminho: Path) -> np.ndarray | None:
    try:
        return cv2.imdecode(np.fromfile(str(caminho), np.uint8), cv2.IMREAD_COLOR)
    except OSError:
        return None


def etapas_sem_leitura(resumo: dict) -> list[dict]:
    """As etapas da leitura da bancada (T3c-2), sem identificação: a primeira é o pão aberto; as outras, de lado ainda
    não sabido. Cada uma com o recorte dela (`arquivo`)."""
    inicio = datetime.strptime(resumo["inicio"], "%Y-%m-%d %H:%M:%S")
    saida = []
    for i, nome in enumerate(resumo.get("etapas") or []):
        saida.append({
            "hora": hora_do_recorte(nome, inicio), "lado": "pao" if i == 0 else "outro", "inicio": i == 0,
            "leu": None, "candidatos": [], "vezes": 1, "arquivo": nome,
        })
    return saida


def corpo_do_lanche(gravacao: Gravacao, resumo: dict, pasta_do_lanche: Path, etapas: list[dict] | None = None) -> dict:
    """O corpo de `POST /v1/agentes/treino/lanches` para um lanche (`resumo` é a linha dele em `lanches.json`).

    `etapas`: as etapas lidas (com `hora`, `lado`, `inicio`, `leu`, `candidatos`, `vezes` e o `arquivo` do recorte);
    sem elas, as da leitura da bancada, sem leitura.
    """
    etapas = list(etapas if etapas is not None else etapas_sem_leitura(resumo))
    if len(etapas) > MAX_ETAPAS:
        _log.warning("treino: o lanche %s teve %d etapas; vão as %d primeiras", resumo["lanche"], len(etapas), MAX_ETAPAS)
        etapas = etapas[:MAX_ETAPAS]
    quadros: list[dict] = []
    saida_etapas = []
    for e in etapas:
        indice = None
        if e.get("arquivo") and len(quadros) < MAX_QUADROS:
            imagem = _ler(Path(pasta_do_lanche) / e["arquivo"])
            dados = reduzir(imagem) if imagem is not None else None
            if dados is not None:
                indice = len(quadros)
                quadros.append({"imagemBase64": base64.b64encode(dados).decode("ascii")})
        candidatos = [c for c in (e.get("candidatos") or []) if isinstance(c, str) and c.strip()][:MAX_CANDIDATOS]
        saida_etapas.append({
            "hora": _com_fuso(e["hora"]),
            "lado": e["lado"] if e.get("lado") in LADOS else "outro",
            "inicio": bool(e.get("inicio")),
            "leu": e.get("leu") or None,
            "candidatos": candidatos,
            "vezes": min(VEZES[1], max(VEZES[0], int(e.get("vezes") or 1))),
            "quadro": indice,
        })
    aberto = datetime.strptime(resumo["inicio"], "%Y-%m-%d %H:%M:%S")
    fechou = datetime.strptime(resumo["fim"], "%Y-%m-%d %H:%M:%S") if resumo.get("fim") else None
    return {
        "gravacao": {
            "chave": gravacao.chave, "pontoId": gravacao.ponto_id, "inicio": gravacao.inicio.isoformat(),
            "fim": gravacao.fim.isoformat(), "origem": gravacao.origem,
        },
        "lanche": {
            "chave": f"lanche-{int(resumo['lanche']):02d}", "abertoEm": _com_fuso(aberto),
            "fechouEm": _com_fuso(fechou) if fechou else None, "etapas": saida_etapas,
        },
        "quadros": quadros,
    }


def mandar(enviar: Callable[[dict], Any], corpo: dict) -> str:
    """Manda o corpo (`ClienteNuvem.lanche_de_treino`) e diz o que a loja faz depois."""
    try:
        enviar(corpo)
    except ErroDaNuvem as e:
        if e.status == 409:
            return ENCERRADA
        if e.status in (401, 403) or e.status == 429 or e.status >= 500 or e.status == 0:
            _log.info("treino: o lanche %s não entrou agora (%s); vai de novo depois", corpo["lanche"]["chave"], e)
            return DEPOIS
        _log.warning("treino: a nuvem recusou o lanche %s (%s); não repito", corpo["lanche"]["chave"], e)
        return RECUSADO
    return ENVIADO
