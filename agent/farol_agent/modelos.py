"""Modelos de dados do agente.

Estes tipos atravessam todo o pipeline e são o contrato entre as três
abstrações — FonteVideo, Gatilho e Juiz. Mudança aqui é mudança de contrato:
mexer com cuidado.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any

import numpy as np


# ───────────────────────────── enumerações ─────────────────────────────
# Espelham os CHECK da migration 001. Divergência aqui causa 23514 no insert.


class TipoRegra(str, Enum):
    ESTADO = "estado"
    ACAO = "acao"
    PRESENCA = "presenca"
    CONTAGEM = "contagem"
    COMPARACAO = "comparacao"


class Prioridade(str, Enum):
    URGENTE = "urgente"          # < 2 s — só modelo local alcança
    INTERMEDIARIA = "intermediaria"
    LEVE = "leve"                # tolera horas — vai em lote, metade do preço


class Severidade(str, Enum):
    INFO = "info"
    ATENCAO = "atencao"
    CRITICO = "critico"
    EMERGENCIA = "emergencia"


class Resultado(str, Enum):
    CONFORME = "conforme"
    NAO_CONFORME = "nao_conforme"
    # Não é erro: é o indicador que diz qual câmera precisa de dinheiro.
    NAO_AVALIAVEL = "nao_avaliavel"


class Via(str, Enum):
    NUVEM = "nuvem"
    LOCAL = "local"
    COMPARACAO = "comparacao"
    DETECTOR = "detector"


# Resoluções de envio ao modelo. O número é o lado maior em pixels.
# A escolha é o maior fator isolado de custo: 1080p custa ~2,7× o de 640×480
# na Claude. Abaixo de 384 px a Gemini não fica mais barata — tem piso de
# 1.032 tokens por imagem.
RESOLUCOES: dict[str, int] = {
    "r384": 384,
    "r640": 640,
    "r1mp": 1000,
    "r1080": 1920,
}


# ─────────────────────────────── quadro ────────────────────────────────


@dataclass
class Frame:
    """Um quadro, com a proveniência que permite auditar depois."""

    imagem: np.ndarray           # BGR, como o OpenCV entrega
    ts: datetime                 # quando foi capturado (simulado no sandbox)
    ponto_id: str
    stream: str = "main"         # main | sub
    # Preenchido pelo pipeline conforme avança
    nitidez: float | None = None
    phash: int | None = None

    @property
    def largura(self) -> int:
        return int(self.imagem.shape[1])

    @property
    def altura(self) -> int:
        return int(self.imagem.shape[0])

    def copia_com(self, imagem: np.ndarray) -> "Frame":
        """Novo Frame com outra imagem, preservando a proveniência."""
        return Frame(
            imagem=imagem,
            ts=self.ts,
            ponto_id=self.ponto_id,
            stream=self.stream,
            nitidez=None,   # a métrica não vale mais após transformar
            phash=None,
        )


# ──────────────────────────── configuração ─────────────────────────────


@dataclass
class Zona:
    """Polígono dentro do quadro, normalizado 0..1.

    Recortar a zona antes de enviar é o que faz câmera boa valer a pena: o
    modelo redimensiona para ~1024 px de qualquer jeito, então mandar o quadro
    inteiro joga fora justamente o detalhe que se pagou para ter.
    """

    id: str
    nome: str
    poligono: list[tuple[float, float]]
    # De qual canal é esta zona. O polígono é normalizado 0..1, então ele
    # "cabe" em qualquer quadro — e é por isso que o dono precisa estar
    # escrito: sem ele, a zona da bancada recorta o quadro da fritadeira
    # sem reclamar. `None` só no modo de bancada (YAML, um canal só).
    ponto_id: str | None = None

    def bbox(self, largura: int, altura: int, margem: float = 0.05) -> tuple[int, int, int, int]:
        """Retângulo que contém o polígono, com margem relativa.

        Retorna (x1, y1, x2, y2) em pixels, já preso às bordas do quadro.
        """
        xs = [p[0] for p in self.poligono]
        ys = [p[1] for p in self.poligono]
        mx = (max(xs) - min(xs)) * margem
        my = (max(ys) - min(ys)) * margem
        x1 = max(0.0, min(xs) - mx)
        y1 = max(0.0, min(ys) - my)
        x2 = min(1.0, max(xs) + mx)
        y2 = min(1.0, max(ys) + my)
        return (
            int(x1 * largura),
            int(y1 * altura),
            int(x2 * largura),
            int(y2 * altura),
        )


@dataclass
class Janela:
    """Faixa de horário em que a regra vale. Vazio = sempre."""

    dias: list[int]      # 1 = segunda … 7 = domingo
    hora_ini: str        # "HH:MM"
    hora_fim: str

    def contem(self, ts: datetime) -> bool:
        hoje = ts.isoweekday()
        hhmm = ts.strftime("%H:%M")
        if self.hora_ini <= self.hora_fim:
            if self.dias and hoje not in self.dias:
                return False
            return self.hora_ini <= hhmm <= self.hora_fim
        # Janela que cruza a meia-noite: "23:00-01:00".
        # O protótipo errava isto e por isso usava "23:00-23:59" como contorno.
        #
        # A madrugada pertence ao dia em que a janela ABRIU. "Sexta, das 18h
        # à 1h" cobre o sábado à 0h30 — e não a sexta à 0h30, que é o resto
        # da quinta. Conferindo só o dia de hoje, a loja que fecha à 1h
        # "fechava" à meia-noite de sábado e "abria" na madrugada de sexta.
        if hhmm >= self.hora_ini:
            return not self.dias or hoje in self.dias
        if hhmm <= self.hora_fim:
            ontem = 7 if hoje == 1 else hoje - 1
            return not self.dias or ontem in self.dias
        return False


@dataclass
class Regra:
    id: str
    zona: Zona
    nome: str
    tipo: TipoRegra
    criterio: str
    criterio_versao: int = 1
    processo_descricao: str | None = None
    prioridade: Prioridade = Prioridade.INTERMEDIARIA
    severidade: Severidade = Severidade.ATENCAO
    confianca_minima: float = 0.70
    cooldown_min: int = 15
    resolucao: str = "r640"
    janelas: list[Janela] = field(default_factory=list)
    acoes: list[str] = field(default_factory=lambda: ["registro"])
    base_id: str | None = None
    ativa: bool = False          # nasce desligada até ter acurácia medida
    borrar_rosto: bool = True
    # O que os juízes que não leem português precisam saber. Para presença
    # e contagem: {"objeto": "pessoa", "minimo": 1, "maximo": None}.
    parametros: dict[str, Any] = field(default_factory=dict)
    # Em que horário conferir, em relação ao horário DA LOJA: "no_horario"
    # (com ela aberta), "fora_do_horario" (fechada) ou "sempre". O horário é
    # o mesmo para todos os critérios da loja e desce junto com cada um —
    # assim a pergunta "vale agora?" se responde aqui, sem a regra precisar
    # saber de que loja é.
    quando: str = "no_horario"
    horario_da_loja: list[Janela] = field(default_factory=list)
    # Quando vale a pena perguntar (ver porteiro.py): "sempre", "pessoa"
    # (só com gente na área), "livre" (só com a área livre) ou "movimento"
    # (só quando algo mudou). Só conta para o que pode ir à nuvem: presença
    # e contagem são julgadas na loja em toda olhada.
    porteiro: str = "sempre"
    # Em quantas olhadas SEGUIDAS o critério tem de ficar fora para virar
    # aviso. 1 = avisa na primeira, como sempre foi.
    confirmar_em: int = 1

    def vale_agora(self, ts: datetime) -> bool:
        if not self.ativa:
            return False
        if self.janelas and not any(j.contem(ts) for j in self.janelas):
            return False
        return self._na_hora_da_loja(ts)

    def _na_hora_da_loja(self, ts: datetime) -> bool:
        if self.quando == "sempre":
            return True
        # Loja que não informou horário é tratada como sempre aberta: é como
        # funcionava antes de o horário existir, e é o que impede uma loja
        # de ficar sem auditoria por falta de um cadastro.
        aberta = not self.horario_da_loja or any(j.contem(ts) for j in self.horario_da_loja)
        return not aberta if self.quando == "fora_do_horario" else aberta

    @property
    def lado_maior(self) -> int:
        return RESOLUCOES.get(self.resolucao, 640)


# ───────────────────────────── eventos ─────────────────────────────────


@dataclass
class EventoGatilho:
    """O que uma fonte de gatilho emite.

    `classe` vem preenchida quando a fonte já classifica — câmera AcuSense
    manda `human` no payload. Quando vem vazia, o agente classifica: a
    inteligência do MHDX roda em 1 canal só, então o gatilho do gravador é
    movimento puro e a classificação acontece aqui.
    """

    ponto_id: str
    ts: datetime
    zona_id: str | None = None
    classe: str | None = None
    origem: str = "desconhecida"
    bruto: dict[str, Any] = field(default_factory=dict)


@dataclass
class Veredito:
    resultado: Resultado
    confianca: float | None = None
    motivo: str | None = None
    via: Via = Via.NUVEM
    modelo: str | None = None
    tokens_entrada: int | None = None
    tokens_saida: int | None = None
    custo_centavos: float | None = None
    latencia_ms: int | None = None
    # O que foi MEDIDO na cena, quando o juiz mede: o detector diz quantos
    # objetos viu com certeza. É número, não veredito — "havia 2 pessoas"
    # vale o mesmo com a regra pedindo uma ou cinco, e é dele que sai o
    # padrão de funcionamento da loja. `None` = este juiz não mede.
    medida: float | None = None
