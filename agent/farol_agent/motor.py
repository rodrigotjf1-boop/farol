"""Motor de regras — o que analisar, o que alertar, o que calar.

Fica entre o gatilho e o juiz, e é onde o produto acontece: o gatilho só
diz "mexeu aqui" e o juiz só diz "conforme ou não". Quem decide **qual
regra vale agora**, **se vale pagar para julgar** e **se o resultado vira
alerta** é este arquivo.

## As três portas, em ordem

1. **A regra vale agora?** Ativa, do ponto certo, dentro da janela de
   horário. Regra nasce desligada — ligar exige acurácia medida.

2. **Vale pagar para julgar?** Se a mesma regra já alertou há menos que o
   cooldown, **nem se analisa**. A condição continua lá e a loja já sabe;
   pagar o modelo de cinco em cinco minutos para reconfirmar "ainda está
   suja" é dinheiro queimado. O alerta registra o cooldown, então o console
   consegue dizer "a condição persistiu por ao menos X minutos" sem ter
   pago por isso. *(Medir duração de verdade é trabalho do juiz de
   comparação, que roda local e não custa chamada — vem no A2.4.)*

3. **O veredito vira alerta?** Só `nao_conforme` **com confiança acima do
   mínimo da regra**. Abaixo disso é registrado mas não toca a sineta: o
   que destrói a confiança da loja no sistema não é errar pouco, é berrar
   errado. `nao_avaliavel` nunca alerta — vira indicador de câmera.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Iterable, Sequence

import cv2

from farol_agent.fila import Fila, ItemFila
from farol_agent.fontes.base import FonteVideo
from farol_agent.juizes.base import ErroDoJuiz, Juiz
from farol_agent.modelos import (
    EventoGatilho,
    Regra,
    Resultado,
    Severidade,
    Veredito,
)
from farol_agent.pipeline import dedupe, qualidade, recorte

_log = logging.getLogger(__name__)


@dataclass
class Alerta:
    """O que sai do motor quando algo precisa chegar a uma pessoa."""

    regra_id: str
    regra_nome: str
    ponto_id: str
    zona_id: str | None
    ts: datetime
    severidade: Severidade
    motivo: str | None
    confianca: float | None
    acoes: list[str]
    imagem_caminho: str
    cooldown_min: int
    veredito: Veredito


@dataclass
class Preparo:
    """Resultado de preparar um gatilho: o que foi enfileirado e o que não."""

    enfileirados: list[str] = field(default_factory=list)
    em_silencio: list[str] = field(default_factory=list)
    repetidos: list[str] = field(default_factory=list)
    sem_quadro: list[str] = field(default_factory=list)


class MotorDeRegras:
    def __init__(
        self,
        fila: Fila,
        regras: Iterable[Regra],
        *,
        rajada: int = 6,
        descartar: int = 2,
        jpeg: int = 85,
        limiar_dedupe: int = 6,
        memoria_dedupe_seg: int = 30,
    ) -> None:
        self.fila = fila
        self.regras: list[Regra] = list(regras)
        self.rajada = rajada
        self.descartar = descartar
        self.jpeg = jpeg
        self._dedup = dedupe.Deduplicador(
            limiar=limiar_dedupe, memoria_seg=memoria_dedupe_seg
        )

    # ──────────────────────── seleção de regras ────────────────────────

    def regras_aplicaveis(self, evento: EventoGatilho) -> list[Regra]:
        """Regras do ponto que valem no instante do gatilho.

        Quando o gatilho traz zona, filtra por ela: movimento na fritadeira
        não precisa acordar a regra da bancada de montagem.
        """
        saida = []
        for r in self.regras:
            if not r.vale_agora(evento.ts):
                continue
            if evento.zona_id and r.zona.id != evento.zona_id:
                continue
            saida.append(r)
        return saida

    # ──────────────────────────── preparo ──────────────────────────────

    def preparar(
        self,
        evento: EventoGatilho,
        fonte: FonteVideo,
        *,
        contexto: dict[str, Any] | None = None,
    ) -> Preparo:
        """Captura, recorta e enfileira uma análise por regra aplicável."""
        preparo = Preparo()
        regras = self.regras_aplicaveis(evento)
        if not regras:
            return preparo

        quadros = fonte.rajada(evento.ts, quantidade=self.rajada)
        if not quadros:
            preparo.sem_quadro = [r.id for r in regras]
            return preparo

        for regra in regras:
            if self._em_silencio(regra, evento.ts):
                preparo.em_silencio.append(regra.id)
                continue

            chave = self._processar_e_enfileirar(regra, evento, quadros, contexto)
            if chave is None:
                preparo.repetidos.append(regra.id)
            else:
                preparo.enfileirados.append(regra.id)

        return preparo

    def _processar_e_enfileirar(
        self,
        regra: Regra,
        evento: EventoGatilho,
        quadros: Sequence[Any],
        contexto: dict[str, Any] | None,
    ) -> str | None:
        bbox = regra.zona.bbox(quadros[0].largura, quadros[0].altura)
        melhor = qualidade.melhor_quadro(
            list(quadros), descartar=self.descartar, zona_bbox=bbox
        )
        if melhor is None:
            return None

        # A ordem importa: recorta, borra, deduplica, e só então reduz.
        # Reduzir antes jogaria fora o detalhe que se pagou na câmera.
        f = recorte.recortar_zona(melhor, regra.zona)
        if regra.borrar_rosto:
            f, _ = recorte.borrar_rostos(f)

        chave_dedupe = f"{evento.ponto_id}:{regra.zona.id}:{regra.id}"
        if self._dedup.repetido(chave_dedupe, f.imagem, f.ts):
            return None

        f = recorte.redimensionar(f, regra.lado_maior)
        ph = dedupe.phash(f.imagem)

        chave = Fila.chave_idempotente(
            regra.id, regra.criterio_versao, evento.ponto_id, ph, f.ts
        )

        # Já julgamos esta cena exata? Então não paga de novo — mas o
        # veredito guardado ainda precisa passar pelas portas do alerta,
        # e isso acontece em `processar`.
        if self.fila.veredito_de(chave) is not None:
            return None

        destino = (
            self.fila.spool
            / f"{f.ts:%Y%m%d_%H%M%S}_{evento.ponto_id}_{regra.id}.jpg"
        )
        cv2.imwrite(str(destino), f.imagem, [cv2.IMWRITE_JPEG_QUALITY, self.jpeg])

        novo = self.fila.enfileirar(
            chave=chave,
            regra_id=regra.id,
            ponto_id=evento.ponto_id,
            zona_id=regra.zona.id,
            prioridade=regra.prioridade.value,
            criterio=regra.criterio,
            criterio_versao=regra.criterio_versao,
            imagem_caminho=destino,
            capturado_em=f.ts,
            contexto=contexto,
        )
        if not novo:
            # Chave repetida que ainda não concluiu: a imagem recém-escrita
            # não serve para nada e viraria lixo permanente no spool.
            destino.unlink(missing_ok=True)
            return None
        return chave

    # ─────────────────────────── despacho ──────────────────────────────

    def processar(
        self, juiz: Juiz, agora: datetime, *, limite: int = 10
    ) -> list[Alerta]:
        """Drena a fila: julga o que está pronto e devolve os alertas."""
        alertas: list[Alerta] = []

        for item in self.fila.proximos(agora, limite=limite):
            regra = self._regra(item.regra_id)
            if regra is None:
                # Regra apagada ou desativada enquanto o item esperava.
                # Descartar é certo: o critério não existe mais.
                self.fila.adiar(item, "regra não existe mais", agora)
                continue

            try:
                veredito = juiz.julgar(
                    Path(item.imagem_caminho), item.criterio, contexto=item.contexto
                )
            except ErroDoJuiz as e:
                # Loga o MOTIVO, não só "falhou": erro sem causa vira caça
                # ao fantasma na manhã seguinte.
                _log.warning(
                    "julgamento falhou (regra=%s tentativa=%d recuperavel=%s): %s",
                    item.regra_id, item.tentativas, e.recuperavel, e,
                )
                if e.recuperavel:
                    self.fila.adiar(item, str(e), agora)
                else:
                    self.fila.adiar(item, str(e), agora + timedelta(days=365))
                continue
            except Exception as e:  # noqa: BLE001
                _log.exception("erro inesperado ao julgar regra=%s", item.regra_id)
                self.fila.adiar(item, f"inesperado: {e}", agora)
                continue

            self.fila.concluir(item.id, veredito, agora)

            alerta = self._avaliar(regra, item, veredito)
            if alerta is not None:
                self.fila.registrar_alerta(
                    regra_id=regra.id, zona_id=item.zona_id, ts=item.capturado_em
                )
                alertas.append(alerta)

        return alertas

    def _avaliar(
        self, regra: Regra, item: ItemFila, veredito: Veredito
    ) -> Alerta | None:
        """A terceira porta: este veredito merece acordar alguém?"""
        if veredito.resultado is not Resultado.NAO_CONFORME:
            return None

        confianca = veredito.confianca or 0.0
        if confianca < regra.confianca_minima:
            # Fica registrado na fila para afinar o limiar depois. Berrar
            # com confiança baixa é o que faz a loja desligar o sistema.
            _log.info(
                "regra=%s nao_conforme com confiança %.2f < %.2f: não alerta",
                regra.id, confianca, regra.confianca_minima,
            )
            return None

        return Alerta(
            regra_id=regra.id,
            regra_nome=regra.nome,
            ponto_id=item.ponto_id,
            zona_id=item.zona_id,
            ts=item.capturado_em,
            severidade=regra.severidade,
            motivo=veredito.motivo,
            confianca=veredito.confianca,
            acoes=list(regra.acoes),
            imagem_caminho=item.imagem_caminho,
            cooldown_min=regra.cooldown_min,
            veredito=veredito,
        )

    # ──────────────────────────── interno ──────────────────────────────

    def _regra(self, regra_id: str) -> Regra | None:
        for r in self.regras:
            if r.id == regra_id:
                return r
        return None

    def _em_silencio(self, regra: Regra, ts: datetime) -> bool:
        if regra.cooldown_min <= 0:
            return False
        ultimo = self.fila.ultimo_alerta(regra.id)
        if ultimo is None:
            return False
        return ts - ultimo < timedelta(minutes=regra.cooldown_min)
