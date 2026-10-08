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
   pago por isso.

   **Menos em presença e contagem** (`CONTINUOS`). Ali julgar não custa
   chamada — é o detector, na loja — e o que a loja quer saber é
   justamente **por quanto tempo**: quanto o posto ficou vazio, quanto a
   fila ficou grande. Com o silêncio pulando a olhada, quinze minutos
   depois de cada aviso ninguém media nada (na loja, 07/10/2026: 14 de 16
   olhadas puladas). Nesses tipos toda olhada é julgada e conta; o
   silêncio segura só o aviso, na porta 3.

3. **O veredito vira alerta?** Só `nao_conforme` **com confiança acima do
   mínimo da regra**, e **fora do silêncio** daquele critério naquele
   canal. Abaixo disso é registrado mas não toca a sineta: o que destrói a
   confiança da loja no sistema não é errar pouco, é berrar errado.
   `nao_avaliavel` nunca alerta — vira indicador de câmera.

   Quando o critério pede **"só avisar se continuar"** (`confirmar_em`
   maior que 1), o primeiro fora do critério não avisa: fica esperando
   as olhadas seguintes. Conta como "continua" tanto um novo veredito
   fora do critério quanto a cena que não mudou desde o último. Um
   conforme no meio zera a espera.

Entre a 1 e a 2 fica **o porteiro** (porteiro.py): para o que pode ir à
nuvem, a loja confere antes se a pergunta faz sentido — gente na área,
área livre, algo se mexeu. Quando não faz, a olhada é contada como "nada
a conferir" e nem entra na fila.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Callable, Iterable, Sequence

import cv2

from farol_agent.fila import Fila, ItemFila
from farol_agent.fontes.base import FonteVideo
from farol_agent import imagens
from farol_agent.juizes.base import ErroDoJuiz, Juiz
from farol_agent.modelos import (
    EventoGatilho,
    Regra,
    Resultado,
    Severidade,
    TipoRegra,
    Veredito,
)
from farol_agent.pipeline import dedupe, qualidade, recorte
from farol_agent.porteiro import Porteiro

_log = logging.getLogger(__name__)

# Tipos em que TODA olhada é julgada, mesmo no silêncio e mesmo com a cena
# igual à anterior: quem julga é o detector local (não há o que economizar)
# e a medida é o tempo — "em quantas olhadas o posto estava vazio".
# `comparacao` também é local, mas pode escalar para um modelo: fica fora.
CONTINUOS = (TipoRegra.PRESENCA, TipoRegra.CONTAGEM)


@dataclass
class Alerta:
    """O que sai do motor quando algo precisa chegar a uma pessoa."""

    regra_id: str
    regra_nome: str
    ponto_id: str
    zona_id: str | None
    ts: datetime
    # A chave de idempotência vem da FILA, não se inventa aqui: é ela que
    # impede o mesmo evento de entrar duas vezes quando a subida falha e
    # é retentada. Gerar outra na subida anularia a proteção.
    chave: str
    # Qual redação do critério produziu este veredito. A regra é mutável;
    # sem isto, um evento de ontem aponta para a redação de hoje.
    criterio_versao: int
    severidade: Severidade
    motivo: str | None
    confianca: float | None
    acoes: list[str]
    imagem_caminho: str
    cooldown_min: int
    veredito: Veredito
    # pHash do quadro julgado. Sobe com o evento.
    imagem_hash: str | None = None


@dataclass
class _EmConfirmacao:
    """Um fora do critério esperando continuar para virar aviso."""

    quantas: int
    # O último julgamento fora do critério: é com ele que o aviso sai.
    item: ItemFila
    veredito: Veredito


@dataclass
class Preparo:
    """Resultado de preparar um gatilho: o que foi enfileirado e o que não."""

    enfileirados: list[str] = field(default_factory=list)
    # O porteiro segurou: a pergunta não fazia sentido nesta olhada.
    sem_condicao: list[str] = field(default_factory=list)
    em_silencio: list[str] = field(default_factory=list)
    repetidos: list[str] = field(default_factory=list)
    sem_quadro: list[str] = field(default_factory=list)
    # Veio quadro, mas nao havia CENA nele (tela de sem-sinal, camera
    # tampada, fluxo parado). Separado de `repetidos` de proposito: um
    # diz "nada mudou", o outro diz "a camera parou de funcionar".
    sem_cena: list[str] = field(default_factory=list)


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
        serializar: Callable[["Alerta"], dict[str, Any]] | None = None,
        porteiro: Porteiro | None = None,
    ) -> None:
        self.fila = fila
        self.regras: list[Regra] = list(regras)
        # Quem confere se vale perguntar. Sem porteiro (modo de bancada, ou
        # agente sem detector), todo critério pergunta em toda olhada.
        self._porteiro = porteiro
        # Por que o porteiro segurou, na última vez, em cada lugar.
        self.sem_condicao: dict[str, str | None] = {}
        # "Só avisar se continuar": o que está esperando, por lugar, e o
        # que já continuou o bastante e vai virar aviso no próximo despacho.
        self._seguidas: dict[str, _EmConfirmacao] = {}
        self._confirmados: list[tuple[Regra, ItemFila, Veredito, datetime]] = []
        # Transforma o alerta no corpo que sobe para a nuvem. O motor não
        # conhece o formato — só sabe que ele tem que ser gravado na MESMA
        # linha do alerta, para o evento sobreviver a queda de internet e a
        # PC desligado. Sem serializador (modo de bancada) nada sobe.
        self._serializar = serializar
        self.rajada = rajada
        self.descartar = descartar
        self.jpeg = jpeg
        self._dedup = dedupe.Deduplicador(
            limiar=limiar_dedupe, memoria_seg=memoria_dedupe_seg
        )
        # Ultimo motivo por regra EM CADA CANAL (chave de `_lugar`). O
        # mesmo criterio pode valer em varios canais, e o que se quer
        # saber e QUAL camera parou: indexado so pelo criterio, o canal que
        # voltou apagaria o aviso do que continua sem sinal.
        self.sem_cena: dict[str, str] = {}

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
            # O critério só vale no canal da zona dele. Esta linha não
            # existia, e com um canal só ninguém notava: com dois, o
            # critério da bancada era recortado do quadro da fritadeira,
            # julgado e PAGO — o polígono é normalizado e "cabe" em
            # qualquer imagem (ERR-020). `None` é o modo de bancada, que
            # tem um canal só por construção.
            if r.zona.ponto_id is not None and r.zona.ponto_id != evento.ponto_id:
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

        try:
            quadros = fonte.rajada(evento.ts, quantidade=self.rajada)
        except Exception as e:  # noqa: BLE001
            # Câmera que não responde é o caso mais importante de contar:
            # sem isto o canal morto aparece no console com zero olhadas,
            # igual a um canal que ninguém mandou verificar.
            self._contar(evento.ts, [(r, "sem_quadro", str(e)) for r in regras])
            raise
        if not quadros:
            preparo.sem_quadro = [r.id for r in regras]
            self._contar(evento.ts, [(r, "sem_quadro", None) for r in regras])
            return preparo

        # No que deu cada olhada, para o resumo por hora. Uma por regra.
        olhadas: list[tuple[Regra, str, str | None]] = []
        for regra in regras:
            # Presença e contagem não param no silêncio: a olhada é a
            # medida. O aviso é que fica calado, em `_avaliar`.
            if regra.tipo not in CONTINUOS and self._em_silencio(regra, evento.ts):
                preparo.em_silencio.append(regra.id)
                olhadas.append((regra, "em_silencio", None))
                continue

            chave, motivo = self._processar_e_enfileirar(
                regra, evento, quadros, contexto
            )
            if chave is not None:
                preparo.enfileirados.append(regra.id)
                olhadas.append((regra, "enfileiradas", None))
            elif motivo == "sem_condicao":
                preparo.sem_condicao.append(regra.id)
                olhadas.append((regra, "sem_condicao", None))
                # Sem ninguém na área, o que estava fora do critério numa
                # PESSOA deixou de estar: a espera recomeça do zero.
                if regra.porteiro == "pessoa":
                    self._seguidas.pop(self._lugar(regra), None)
            elif motivo == "sem_cena":
                preparo.sem_cena.append(regra.id)
                olhadas.append(
                    (regra, "sem_cena", self.sem_cena.get(self._lugar(regra)))
                )
            elif motivo == "sem_quadro":
                preparo.sem_quadro.append(regra.id)
                olhadas.append((regra, "sem_quadro", None))
            elif motivo == "ja_julgado":
                preparo.repetidos.append(regra.id)
                olhadas.append((regra, "ja_julgadas", None))
                self._continua(regra, evento.ts)
            else:
                preparo.repetidos.append(regra.id)
                olhadas.append((regra, "repetidas", None))
                self._continua(regra, evento.ts)

        self._contar(evento.ts, olhadas)
        return preparo

    def _contar(
        self, ts: datetime, olhadas: Sequence[tuple[Regra, str, str | None]]
    ) -> None:
        """Soma as olhadas no resumo da hora. Nunca derruba a auditoria.

        O resumo é o que conta a história; a auditoria é o que a história
        conta. Disco cheio ou banco travado não podem fazer o agente parar
        de olhar a cozinha por causa de uma estatística.
        """
        try:
            self.fila.contar_lote(
                [
                    (ts, regra.id, regra.zona.id, {"capturas": 1, desfecho: 1}, porque)
                    for regra, desfecho, porque in olhadas
                ]
            )
        except Exception:  # noqa: BLE001
            _log.exception("não consegui somar no resumo da hora; a auditoria segue")

    def _processar_e_enfileirar(
        self,
        regra: Regra,
        evento: EventoGatilho,
        quadros: Sequence[Any],
        contexto: dict[str, Any] | None,
    ) -> tuple[str | None, str]:
        """Devolve `(chave, motivo)`.

        O motivo vem de dentro porque só aqui se sabe a diferença entre
        "a cena não mudou" e "a câmera parou de funcionar" — e confundir
        as duas faz o painel mostrar calmaria quando devia mostrar defeito.
        """
        bbox = regra.zona.bbox(quadros[0].largura, quadros[0].altura)
        melhor = qualidade.melhor_quadro(
            list(quadros), descartar=self.descartar, zona_bbox=bbox
        )
        if melhor is None:
            return None, "sem_quadro"

        # A ordem importa: recorta, borra, deduplica, e só então reduz.
        # Reduzir antes jogaria fora o detalhe que se pagou na câmera.
        f = recorte.recortar_zona(melhor, regra.zona)

        # Porta que não existia e custou descobrir: câmera sem sinal faz o
        # gravador transmitir uma tela preta com logotipo e relógio. Ela
        # atravessaria o pipeline inteiro e chegaria ao modelo, que seria
        # perguntado se a bancada está limpa a respeito de um retângulo
        # preto — custo real, resposta absurda, e um "não conforme" sobre
        # nada viraria alerta para a cozinha.
        utilizavel, porque = qualidade.cena_utilizavel(f.imagem)
        if not utilizavel:
            _log.info("regra=%s sem cena para julgar: %s", regra.id, porque)
            self.sem_cena[self._lugar(regra)] = porque
            return None, "sem_cena"

        # Em presença e contagem, cena igual à anterior NÃO é atalho: o
        # posto vazio é a mesma imagem por meia hora, e é essa meia hora
        # que se quer medir. Cada olhada entra, com chave própria.
        continuo = regra.tipo in CONTINUOS

        # O porteiro, ANTES do borrão e da fila: a imagem ainda não saiu
        # de lugar nenhum, e o detector conta melhor no recorte inteiro.
        # Presença e contagem não passam por ele — já são da loja.
        if not continuo and regra.porteiro != "sempre" and self._porteiro is not None:
            decisao = self._porteiro.decidir(
                regra.porteiro, f.imagem,
                lugar=self._lugar(regra), area=f"{evento.ponto_id}:{regra.zona.id}", ts=f.ts,
            )
            if not decisao.vale:
                # A câmera está entregando cena: não é defeito, é só que
                # não havia o que perguntar.
                self.sem_cena.pop(self._lugar(regra), None)
                self.sem_condicao[self._lugar(regra)] = decisao.motivo
                return None, "sem_condicao"

        if regra.borrar_rosto:
            f, _ = recorte.borrar_rostos(f)

        chave_dedupe = f"{evento.ponto_id}:{regra.zona.id}:{regra.id}"
        if not continuo and self._dedup.repetido(chave_dedupe, f.imagem, f.ts):
            # A cena voltou a ser julgavel: tirar daqui faz o painel parar
            # de acusar defeito quando a camera voltou.
            self.sem_cena.pop(self._lugar(regra), None)
            return None, "repetido"

        f = recorte.redimensionar(f, regra.lado_maior)
        ph = dedupe.phash(f.imagem)

        chave = Fila.chave_idempotente(
            regra.id, regra.criterio_versao, evento.ponto_id, ph, f.ts,
            por_olhada=continuo, zona_id=regra.zona.id,
        )

        # Já julgamos esta cena exata? Então não paga de novo — mas o
        # veredito guardado ainda precisa passar pelas portas do alerta,
        # e isso acontece em `processar`.
        if not continuo and self.fila.veredito_de(chave) is not None:
            self.sem_cena.pop(self._lugar(regra), None)
            return None, "ja_julgado"

        # A ÁREA entra no nome: o mesmo critério pode valer em duas áreas do
        # mesmo canal, e as duas saem da mesma olhada, no mesmo segundo. Com
        # canal + critério só, o segundo recorte gravava por cima do primeiro
        # antes de ele ser julgado — e a área A era julgada com a imagem da B.
        destino = (
            self.fila.spool
            / f"{f.ts:%Y%m%d_%H%M%S}_{evento.ponto_id}_{regra.zona.id}_{regra.id}.jpg"
        )
        imagens.escrever(str(destino), f.imagem, [cv2.IMWRITE_JPEG_QUALITY, self.jpeg])

        # A regra viaja no contexto porque é por ele que o seletor escolhe o
        # juiz e que a comparação acha a base. O contexto da operação (o que
        # o Regem sabe) vem por cima, mas não pode sobrescrever estes dois.
        ctx: dict[str, Any] = dict(contexto or {})
        ctx["regra_id"] = regra.id
        if regra.base_id:
            ctx["base_id"] = regra.base_id

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
            contexto=ctx,
            phash=f"{ph:016x}",
        )
        if not novo:
            # Chave repetida que ainda não concluiu: a imagem recém-escrita
            # não serve para nada e viraria lixo permanente no spool.
            destino.unlink(missing_ok=True)
            return None, "repetido"
        self.sem_cena.pop(self._lugar(regra), None)
        return chave, "ok"

    # ─────────────────────────── despacho ──────────────────────────────

    def processar(
        self, juiz: Juiz, agora: datetime, *, limite: int = 10
    ) -> list[Alerta]:
        """Drena a fila: julga o que está pronto e devolve os alertas."""
        alertas: list[Alerta] = []

        # O que continuou fora do critério sem novo julgamento (a cena não
        # mudou) e chegou à quantidade pedida: vira aviso aqui, com o
        # julgamento que estava esperando.
        confirmados, self._confirmados = self._confirmados, []
        for regra, item, veredito, quando in confirmados:
            alerta = self._alerta(regra, item, veredito)
            try:
                self.fila.contar(item.capturado_em, item.regra_id, item.zona_id, alertas=1)
            except Exception:  # noqa: BLE001
                _log.exception("não consegui somar o aviso no resumo da hora")
            # O silêncio conta a partir da olhada que CONFIRMOU, não da
            # que foi julgada: entre uma e outra podem ter passado
            # minutos, e o aviso acabou de sair. O evento em si leva o
            # instante da imagem, que é o que ele mostra.
            self.fila.registrar_alerta(
                regra_id=regra.id,
                zona_id=item.zona_id,
                ts=quando,
                chave=item.chave,
                evento=self._serializar(alerta) if self._serializar else None,
            )
            alertas.append(alerta)

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
                self._contar_falha(item, str(e))
                continue
            except Exception as e:  # noqa: BLE001
                _log.exception("erro inesperado ao julgar regra=%s", item.regra_id)
                self.fila.adiar(item, f"inesperado: {e}", agora)
                self._contar_falha(item, f"inesperado: {e}")
                continue

            self.fila.concluir(item.id, veredito, agora)

            alerta = self._avaliar(regra, item, veredito)
            try:
                self.fila.contar_veredito(
                    item.capturado_em, item.regra_id, item.zona_id, veredito, agora,
                    alerta=alerta is not None,
                )
            except Exception:  # noqa: BLE001
                _log.exception("não consegui somar o veredito no resumo da hora")
            if alerta is not None:
                self.fila.registrar_alerta(
                    regra_id=regra.id,
                    zona_id=item.zona_id,
                    ts=item.capturado_em,
                    chave=item.chave,
                    evento=self._serializar(alerta) if self._serializar else None,
                )
                alertas.append(alerta)

        return alertas

    def _avaliar(
        self, regra: Regra, item: ItemFila, veredito: Veredito
    ) -> Alerta | None:
        """A terceira porta: este veredito merece acordar alguém?"""
        lugar = f"{regra.id}@{item.zona_id}"
        if veredito.resultado is Resultado.CONFORME:
            # Voltou a ficar em ordem: o que esperava confirmação não continua.
            self._seguidas.pop(lugar, None)
            return None
        if veredito.resultado is not Resultado.NAO_CONFORME:
            # "Não deu para avaliar" não confirma nem desmente.
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

        # O silêncio, aqui, e pelo canal DO ITEM (a regra achada pelo id
        # pode ser a de outro canal). É o que cala presença e contagem,
        # que são julgadas a cada olhada — e é o que impede dois avisos
        # quando duas olhadas entraram na fila antes do primeiro veredito.
        if self._calado(regra, item.zona_id, item.capturado_em):
            _log.debug(
                "regra=%s nao_conforme dentro do silêncio de %d min: conta, não avisa",
                regra.id, regra.cooldown_min,
            )
            return None

        # "Só avisar se continuar": este fora do critério é o primeiro, ou
        # mais um de uma sequência? Avisa só ao chegar na quantidade pedida.
        if regra.confirmar_em > 1:
            espera = self._seguidas.get(lugar)
            quantas = (espera.quantas if espera else 0) + 1
            if quantas < regra.confirmar_em:
                self._seguidas[lugar] = _EmConfirmacao(quantas, item, veredito)
                _log.info(
                    "regra=%s fora do critério %d de %d: espera continuar para avisar",
                    regra.id, quantas, regra.confirmar_em,
                )
                return None
            self._seguidas.pop(lugar, None)

        return self._alerta(regra, item, veredito)

    def _continua(self, regra: Regra, ts: datetime) -> None:
        """A cena não mudou desde um fora do critério: é mais uma olhada em que ele continua.

        Sem isto, "avisar só se continuar" nunca avisaria justamente do
        que continua: a bancada suja parada é a MESMA imagem, e imagem
        repetida não é julgada de novo.
        """
        lugar = self._lugar(regra)
        espera = self._seguidas.get(lugar)
        if espera is None or regra.confirmar_em <= 1:
            return
        if self._calado(regra, regra.zona.id, ts):
            return
        espera.quantas += 1
        if espera.quantas >= regra.confirmar_em:
            del self._seguidas[lugar]
            self._confirmados.append((regra, espera.item, espera.veredito, ts))

    @staticmethod
    def _alerta(regra: Regra, item: ItemFila, veredito: Veredito) -> Alerta:
        return Alerta(
            regra_id=regra.id,
            regra_nome=regra.nome,
            ponto_id=item.ponto_id,
            zona_id=item.zona_id,
            ts=item.capturado_em,
            chave=item.chave,
            criterio_versao=item.criterio_versao,
            severidade=regra.severidade,
            motivo=veredito.motivo,
            confianca=veredito.confianca,
            acoes=list(regra.acoes),
            imagem_caminho=item.imagem_caminho,
            cooldown_min=regra.cooldown_min,
            veredito=veredito,
            imagem_hash=item.phash,
        )

    # ──────────────────────────── interno ──────────────────────────────

    def _contar_falha(self, item: ItemFila, porque: str) -> None:
        """Uma tentativa de julgar que não deu em veredito."""
        try:
            self.fila.contar(
                item.capturado_em, item.regra_id, item.zona_id,
                falhas=1, impedimento=porque,
            )
        except Exception:  # noqa: BLE001
            _log.exception("não consegui somar a falha no resumo da hora")

    def _regra(self, regra_id: str) -> Regra | None:
        for r in self.regras:
            if r.id == regra_id:
                return r
        return None

    @staticmethod
    def _lugar(regra: Regra) -> str:
        """O critério NAQUELE canal — a unidade do que é "por lugar"."""
        return f"{regra.id}@{regra.zona.id}"

    def _em_silencio(self, regra: Regra, ts: datetime) -> bool:
        return self._calado(regra, regra.zona.id, ts)

    def _calado(self, regra: Regra, zona_id: str | None, ts: datetime) -> bool:
        """O critério já avisou NESTE canal há menos que o silêncio dele?"""
        if regra.cooldown_min <= 0:
            return False
        # Por canal: a bancada suja do canal 1 não pode calar a do canal 2.
        ultimo = self.fila.ultimo_alerta(regra.id, zona_id)
        if ultimo is None:
            return False
        return ts - ultimo < timedelta(minutes=regra.cooldown_min)
