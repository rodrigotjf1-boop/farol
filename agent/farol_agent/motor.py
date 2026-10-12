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

   **A resposta vazia guardada.** A cena que a nuvem não conseguiu avaliar
   costuma voltar igual meio minuto depois, e pagar de novo é ouvir o
   mesmo "não deu para avaliar". Quando a cena desta olhada tem a
   impressão IDÊNTICA à de uma que voltou vazia há menos de duas horas, a
   olhada não é paga: é contada como "já julgada" (e, à parte, como "vazia
   guardada"). Só a resposta vazia é guardada — um "dentro" ou um "fora"
   nunca é repetido de memória, porque a impressão não vê detalhe pequeno
   —, e só depois de a nuvem ter devolvido vazio DUAS vezes seguidas para
   a mesma cena: perguntada duas vezes em seguida sobre a mesma
   impressão, ela já respondeu "não deu para avaliar" e depois "fora do
   critério" (a medida está em docs/decisoes.md, 12/10/2026, "A resposta
   vazia guardada"). A resposta mais nova é a que vale: uma resposta de
   verdade desfaz a guarda. A guarda vive na memória deste motor, que é
   montado de novo a cada mudança de configuração — mexeu no quadro, na
   resolução, na cena ou no modelo, e a próxima olhada pergunta outra
   vez. Presença e contagem não passam por ela.

3. **O veredito vira alerta?** Só `nao_conforme` **com confiança acima do
   mínimo da regra**, e **fora do silêncio** daquele critério naquele
   canal. Abaixo disso é registrado mas não toca a sineta: o que destrói a
   confiança da loja no sistema não é errar pouco, é berrar errado.
   `nao_avaliavel` nunca alerta — vira indicador de câmera.

   Quando o critério pede **"só avisar se continuar"** (`confirmar_em`
   maior que 1), o primeiro fora do critério não avisa: fica esperando
   as olhadas seguintes. Conta como "continua" tanto um novo veredito
   fora do critério quanto a cena que não mudou desde ele — a repetição
   DAQUELA cena, e não a de uma que ninguém conseguiu avaliar: "não deu
   para avaliar" não confirma nem desmente, e repeti-lo também não. Um
   conforme no meio zera a espera. A olhada extra do vigia não conta
   como "mais uma": ela vem segundos depois, e não meio minuto.

Entre a 1 e a 2 fica **o porteiro** (porteiro.py): para o que pode ir à
nuvem, a loja confere antes se a pergunta faz sentido — gente na área,
área livre, algo se mexeu. Quando não faz, a olhada é contada como "nada
a conferir" e nem entra na fila.

O critério que tem **estudo** (sinais.py) responde a isso pelo estudo, e o
porteiro não é consultado: o CONTEXTO tem de valer (senão, "nada a
conferir") e um GATILHO tem de abrir a análise (senão, a olhada é contada
como "sem gatilho"). É o funil: olhadas → com contexto → com gatilho →
julgadas.

No **quadro de bancada** (o que tem o papel "posição de montagem") há uma
porta a mais, antes de todas essas: a imagem só sai quando **as mãos
saíram** — o quadro quieto há um segundo e meio, medido no fluxo menor
(quietude.py). Com mão na frente a olhada é "nada a conferir", e é refeita
quando o quadro para. E a imagem do quadro quieto em que o detector não vê
**ninguém** vai sem o borrão de rosto: de cima não há rosto, e o borrão
apagava o pão. Com alguém à vista — ou sem ter como saber —, ela sai como
sempre saiu: com o borrão.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Callable, Iterable, Sequence

import cv2

from farol_agent.contexto import Cena
from farol_agent.fila import VALIDADE_PADRAO, Fila, ItemFila
from farol_agent.fontes.base import FonteVideo
from farol_agent import imagens
from farol_agent.juizes.base import ErroDoJuiz, Juiz
from farol_agent.mapas import Mapas
from farol_agent.modelos import (
    RESOLUCOES,
    Condicao,
    EventoGatilho,
    Regra,
    Resultado,
    Severidade,
    TipoRegra,
    Veredito,
    Via,
    Zona,
)
from farol_agent.pipeline import dedupe, qualidade, recorte
from farol_agent.porteiro import Porteiro
from farol_agent.quietude import Quietude
from farol_agent.sinais import Lugar, Sinais

_log = logging.getLogger(__name__)

# Tipos em que TODA olhada é julgada, mesmo no silêncio e mesmo com a cena
# igual à anterior: quem julga é o detector local (não há o que economizar)
# e a medida é o tempo — "em quantas olhadas o posto estava vazio".
# `comparacao` também é local, mas pode escalar para um modelo: fica fora.
CONTINUOS = (TipoRegra.PRESENCA, TipoRegra.CONTAGEM)

# Os tipos cuja imagem pode ir a um modelo de fora — e que, por isso, levam
# a cena do canal quando a loja pergunta com contexto. `comparacao` é
# decidida na loja; só o que não é igual à foto padrão sai.
COM_CENA = (TipoRegra.ESTADO, TipoRegra.ACAO, TipoRegra.COMPARACAO)

# No pedido com contexto o recorte vai como a câmera entrega: reduzir a
# 640 px joga fora o detalhe que se pagou na câmera (no tampo da montagem,
# 85% dos pontos). Nunca amplia: é teto, não alvo.
LADO_DA_CAMERA = RESOLUCOES["r1080"]

# O papel do quadro em que a imagem espera as mãos saírem.
PAPEL_DE_BANCADA = "montagem"

# ── A resposta vazia guardada ──
# Por quanto tempo vale o "não deu para avaliar" de uma cena, para a cena de
# impressão idêntica. Decisão do dono (12/10/2026): "só a resposta vazia,
# por 2 horas". Zero desliga a guarda.
GUARDA_DA_VAZIA_MIN = 120
# Quantas respostas vazias SEGUIDAS a mesma cena precisa ter antes de a
# guarda valer. Com uma só, a guarda teria segurado uma cena que, perguntada
# de novo, a nuvem respondeu "fora do critério" (a conta, com os números,
# está em docs/decisoes.md, 12/10/2026, "A resposta vazia guardada").
VAZIAS_PARA_GUARDAR = 2
# A pergunta que ficou sem resposta sai da memória depois da validade mais
# longa de uma análise: passado isso a fila já a descartou.
_ESPERA_MAIS_LONGA = max(VALIDADE_PADRAO.values())

# O que faz de duas olhadas A MESMA pergunta: o critério e a redação dele, o
# canal, o quadro e a impressão da imagem que sairia. O resto do que muda a
# pergunta (o desenho do quadro, a resolução, a cena escrita, o modelo) é
# configuração — e o motor é montado de novo quando ela muda.
_Pergunta = tuple[str, int, str, str, int]

# Em que contadores do resumo cada desfecho soma, quando não é só no dele.
_CONTADORES_DO_DESFECHO = {
    # A vazia guardada É uma "já julgada": conta nela, e à parte.
    "vazias_guardadas": ("ja_julgadas", "vazias_guardadas"),
}


@dataclass(frozen=True)
class ComContexto:
    """O que o motor precisa saber de uma loja que pergunta COM CONTEXTO.

    Quem monta é a auditoria, a cada versão de configuração. Sem isto
    (`None` no motor) nada muda: é a loja de sempre.
    """

    # Por canal, a cena escrita e os quadros — só dos canais que TÊM cena.
    cenas: dict[str, Cena]
    # Onde ficam os mapas dos canais. É o motor que os mantém: é ele que
    # tem o quadro inteiro da câmera na mão.
    mapas: Mapas
    # Os critérios cuja pergunta vai DIRETO a um modelo de fora (estado e
    # ação julgados na nuvem). Só para eles o recorte vai na resolução da
    # câmera: a comparação com a foto padrão continua como foi medida.
    direto: frozenset[str] = frozenset()
    # O modelo que responde: entra na chave da análise junto com a cena.
    modelo: str = ""


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
    # O contexto do estudo valia, e nenhum gatilho abriu a análise.
    sem_gatilho: list[str] = field(default_factory=list)
    # O critério só observa: a olhada foi contada, e não julgada.
    observadas: list[str] = field(default_factory=list)
    em_silencio: list[str] = field(default_factory=list)
    repetidos: list[str] = field(default_factory=list)
    # A cena era idêntica a uma que a nuvem não conseguiu avaliar há pouco:
    # a olhada não foi paga de novo.
    vazias_guardadas: list[str] = field(default_factory=list)
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
        contexto: ComContexto | None = None,
        sinais: Sinais | None = None,
        zonas: dict[str, Zona] | None = None,
        quietude: Quietude | None = None,
        pessoas: Callable[[Any, str, datetime], list[float] | None] | None = None,
        duvida: float = 0.35,
        guarda_da_vazia_min: int = GUARDA_DA_VAZIA_MIN,
        vazias_para_guardar: int = VAZIAS_PARA_GUARDAR,
    ) -> None:
        self.fila = fila
        self.regras: list[Regra] = list(regras)
        # A resposta vazia guardada: por quanto tempo vale, e depois de
        # quantas vazias seguidas. O que este motor PERGUNTOU e ainda espera
        # resposta (pela chave do item na fila), e as vazias que voltaram:
        # por pergunta, quantas seguidas e o instante da cena da última.
        self._guarda_da_vazia = timedelta(minutes=guarda_da_vazia_min)
        self._vazias_para_guardar = vazias_para_guardar
        self._perguntas: dict[str, tuple[_Pergunta, datetime]] = {}
        self._vazias: dict[_Pergunta, tuple[int, datetime]] = {}
        # De que item (a chave) é cada cena que passou há pouco, por lugar e
        # instante: a olhada que repete uma cena precisa saber QUAL — a que
        # foi dada como fora do critério, ou uma que ninguém avaliou.
        self._itens_das_cenas: dict[tuple[str, datetime], str] = {}
        # A loja pergunta com contexto? `None` = não: tudo como sempre.
        self._contexto = contexto
        # Quem lê os sinais do estudo de cada critério. Sem ele (modo de
        # bancada), o critério com estudo é conferido em toda olhada.
        self._sinais = sinais
        # Todos os quadros da loja, por id: a condição de um estudo pode
        # olhar OUTRO quadro do mesmo canal.
        self._zonas: dict[str, Zona] = dict(zonas or {})
        # O quadro de bancada: quem diz se ele está quieto (as mãos saíram)
        # e quem vê se há alguém nele — os pontos do detector de pessoas, e
        # a partir de quanto um ponto já é "talvez alguém". Sem a quietude
        # (modo de bancada, agente sem fluxo menor), o quadro de bancada é
        # tratado como qualquer outro — com o borrão de rosto.
        self._quietude = quietude
        self._pessoas = pessoas
        self._duvida = duvida
        # Por canal, os critérios (naquele quadro) cuja olhada foi segurada
        # por haver mão na frente: a auditoria refaz a olhada quando o
        # quadro para.
        self.esperando_as_maos: dict[str, set[str]] = {}
        # Os canais cujo mapa já foi cuidado NESTA olhada: três critérios
        # no mesmo canal saem do mesmo quadro, e o mapa é um só.
        self._mapa_cuidado: set[str] = set()
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
        somente: Callable[[Regra], bool] | None = None,
    ) -> Preparo:
        """Captura, recorta e enfileira uma análise por regra aplicável.

        `somente` restringe a olhada a alguns critérios do canal — a olhada
        extra do vigia só vale para presença e contagem, e não pode
        acordar o critério que vai à nuvem.
        """
        preparo = Preparo()
        self._mapa_cuidado = set()
        regras = [r for r in self.regras_aplicaveis(evento) if somente is None or somente(r)]
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
            # medida. O aviso é que fica calado, em `_avaliar`. E só quem
            # avisa tem silêncio: o critério em ensaio é julgado em toda
            # olhada, mesmo que tenha avisado minutos antes, quando valia.
            if regra.tipo not in CONTINUOS and regra.avisa and self._em_silencio(regra, evento.ts):
                preparo.em_silencio.append(regra.id)
                olhadas.append((regra, "em_silencio", None))
                continue

            chave, motivo = self._processar_e_enfileirar(
                regra, evento, quadros, contexto
            )
            if motivo == "ok":
                preparo.enfileirados.append(regra.id)
                olhadas.append((regra, "enfileiradas", None))
            elif motivo == "observada":
                preparo.observadas.append(regra.id)
                olhadas.append((regra, "observadas", None))
            elif motivo == "sem_condicao":
                preparo.sem_condicao.append(regra.id)
                olhadas.append((regra, "sem_condicao", None))
                # Sem ninguém na área, o que estava fora do critério numa
                # PESSOA deixou de estar: a espera recomeça do zero. (No
                # critério com estudo, quem decide isto é a condição que
                # faltou — ver `_o_estudo_deixa`.)
                if regra.estudo is None and regra.porteiro == "pessoa":
                    self._seguidas.pop(self._lugar(regra), None)
            elif motivo == "sem_gatilho":
                # O contexto valia e nada abriu a análise. Não é "a cena
                # continua igual" (isso é a cena repetida, mais abaixo): a
                # espera do "avisar só se continuar" nem anda, nem zera.
                preparo.sem_gatilho.append(regra.id)
                olhadas.append((regra, "sem_gatilho", None))
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
                self._continua(regra, evento.ts, chave)
            elif motivo == "vazia_guardada":
                # A cena é, na impressão, uma que a nuvem não conseguiu
                # avaliar há pouco: não se paga para ouvir o mesmo. Como o
                # "não deu para avaliar" de verdade, ela não confirma nem
                # desmente — a espera do "avisar só se continuar" nem anda,
                # nem zera (por isso não passa por `_continua`).
                preparo.vazias_guardadas.append(regra.id)
                olhadas.append((regra, "vazias_guardadas", None))
            else:
                preparo.repetidos.append(regra.id)
                olhadas.append((regra, "repetidas", None))
                self._continua(regra, evento.ts, chave)

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
                    (
                        ts, regra.id, regra.zona.id,
                        {"capturas": 1, **{c: 1 for c in _CONTADORES_DO_DESFECHO.get(desfecho, (desfecho,))}},
                        porque,
                    )
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

        A chave vem em dois casos: quando a olhada entrou na fila ("ok") —
        é a do item — e quando a cena é repetição de uma que já é um item
        ("repetido", "ja_julgado") — é a DAQUELE item, ou `None` se a cena
        repetida nunca chegou a ser um. É por ela que se sabe o que está se
        repetindo (`_continua`).
        """
        bbox = regra.zona.bbox(quadros[0].largura, quadros[0].altura)
        melhor = qualidade.melhor_quadro(
            list(quadros), descartar=self.descartar, zona_bbox=bbox
        )
        if melhor is None:
            return None, "sem_quadro"

        # A loja pergunta com contexto e este canal tem cena escrita: o
        # critério de quadro precisa do mapa do canal em disco antes de
        # qualquer pergunta. É aqui, e não mais adiante, porque a olhada que
        # o porteiro segura por não haver ninguém é justamente a que serve
        # para fotografar o lugar vazio.
        cena = self._cena_de(regra, evento.ponto_id)
        if cena is not None and cena.quadro(regra.zona.id) is not None:
            self._cuidar_do_mapa(evento.ponto_id, cena, melhor)
        # Estado e ação julgados na nuvem: a pergunta vai direto para fora.
        direto = cena is not None and self._contexto is not None and regra.id in self._contexto.direto

        # A ordem importa: recorta, apaga o que é de fora, borra, deduplica,
        # e só então reduz. Reduzir antes jogaria fora o detalhe que se
        # pagou na câmera.
        #
        # O recorte é EXATO: a área é o desenho de quem configurou a loja.
        # `dentro` é o que, do retângulo, pertence ao desenho.
        f, dentro = recorte.recortar_area(melhor, regra.zona)

        # Porta que não existia e custou descobrir: câmera sem sinal faz o
        # gravador transmitir uma tela preta com logotipo e relógio. Ela
        # atravessaria o pipeline inteiro e chegaria ao modelo, que seria
        # perguntado se a bancada está limpa a respeito de um retângulo
        # preto — custo real, resposta absurda, e um "não conforme" sobre
        # nada viraria alerta para a cozinha.
        #
        # Medida só no que é DA ÁREA: o que está fora do desenho não diz
        # se há cena nela.
        utilizavel, porque = qualidade.cena_utilizavel(recorte.miolo(f, dentro))
        if not utilizavel:
            _log.info("regra=%s sem cena para julgar: %s", regra.id, porque)
            self.sem_cena[self._lugar(regra)] = porque
            return None, "sem_cena"

        # Daqui em diante ninguém vê o que ficou fora do desenho: nem o
        # porteiro, nem a memória de cena repetida (movimento na área ao
        # lado não é cena nova desta), nem o juiz, nem o disco.
        f = recorte.apagar_fora(f, dentro)

        # Em presença e contagem, cena igual à anterior NÃO é atalho: o
        # posto vazio é a mesma imagem por meia hora, e é essa meia hora
        # que se quer medir. Cada olhada entra, com chave própria.
        continuo = regra.tipo in CONTINUOS

        # O QUADRO DE BANCADA: a imagem só sai quando as mãos saíram. Vem
        # antes do estudo de propósito — a olhada que não pode sair não
        # gasta o gatilho ("a cada dez minutos" contaria dela).
        quieta = False
        if not continuo and regra.zona.papel == PAPEL_DE_BANCADA and self._quietude is not None:
            segura, quieta = self._a_bancada(regra, evento.ponto_id)
            if segura is not None:
                # A câmera está entregando cena: não é defeito.
                self.sem_cena.pop(self._lugar(regra), None)
                self.sem_condicao[self._lugar(regra)] = segura
                return None, "sem_condicao"

        # O ESTUDO do critério, quando ele tem um: o contexto que precisa
        # estar acontecendo e o gatilho que abre a análise. É conferido no
        # lugar do porteiro — e, como ele, ANTES do borrão e da fila, e só
        # no que pode ir à nuvem.
        if not continuo and regra.estudo is not None and self._sinais is not None:
            segura = self._o_estudo_segura(regra, evento, melhor, f)
            if segura is not None:
                # A câmera está entregando cena: não é defeito.
                self.sem_cena.pop(self._lugar(regra), None)
                return None, segura

        # O porteiro, ANTES do borrão e da fila: a imagem ainda não saiu
        # de lugar nenhum, e o detector conta melhor no recorte inteiro.
        # Presença e contagem não passam por ele — já são da loja.
        elif not continuo and regra.porteiro != "sempre" and self._porteiro is not None:
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

        # O critério só OBSERVA: a câmera entrega cena e o contexto valia —
        # e a olhada para aqui, contada. A imagem não vai para o disco, nada
        # entra na fila, ninguém é perguntado. É o que mostra quanto o
        # critério trabalharia antes de alguém mandá-lo julgar. (O mapa do
        # canal, lá em cima, é cuidado do mesmo jeito: fica pronto para
        # quando o critério passar a ensaio.)
        if not regra.julga:
            self.sem_cena.pop(self._lugar(regra), None)
            return None, "observada"

        # No quadro de bancada quieto e sem ninguém à vista, o borrão não
        # entra: não há rosto para borrar, e ele apagava o que é redondo (o
        # pão). O detector só é perguntado aqui, na imagem que vai sair.
        if regra.borrar_rosto and not (quieta and self._ninguem_a_vista(regra, evento.ponto_id, f)):
            f, _ = recorte.borrar_rostos(f)

        chave_dedupe = f"{evento.ponto_id}:{regra.zona.id}:{regra.id}"
        if not continuo:
            repete = self._dedup.repeticao_de(chave_dedupe, f.imagem, f.ts)
            if repete is not None:
                # A cena voltou a ser julgavel: tirar daqui faz o painel parar
                # de acusar defeito quando a camera voltou.
                self.sem_cena.pop(self._lugar(regra), None)
                # De que item esta cena é repetição: é o que diz se o "fora"
                # continua. A cena que nunca foi a julgamento não tem item.
                return self._itens_das_cenas.get((chave_dedupe, repete)), "repetido"

        f = recorte.redimensionar(f, LADO_DA_CAMERA if direto else regra.lado_maior)
        ph = dedupe.phash(f.imagem)

        chave = Fila.chave_idempotente(
            regra.id, regra.criterio_versao, evento.ponto_id, ph, f.ts,
            por_olhada=continuo, zona_id=regra.zona.id,
            # Mudou a cena, um quadro ou o modelo: é outra pergunta.
            contexto=f"{cena.assinatura()}:{self._contexto.modelo}" if direto else None,
        )

        # Já julgamos esta cena exata? Então não paga de novo — mas o
        # veredito guardado ainda precisa passar pelas portas do alerta,
        # e isso acontece em `processar`.
        if not continuo and self.fila.veredito_de(chave) is not None:
            self.sem_cena.pop(self._lugar(regra), None)
            self._anotar_cena(chave_dedupe, f.ts, chave)
            return chave, "ja_julgado"

        # A resposta vazia guardada: a nuvem não conseguiu avaliar esta
        # mesma cena há pouco, mais de uma vez. Não se paga para ouvir de
        # novo — e a imagem nem vai para o disco. (Presença e contagem
        # nunca chegam a ter resposta guardada: a pergunta delas não é
        # anotada, lá embaixo.)
        pergunta: _Pergunta = (
            regra.id, regra.criterio_versao, str(evento.ponto_id), regra.zona.id, ph
        )
        if self._vazia_guardada(pergunta, f.ts):
            self.sem_cena.pop(self._lugar(regra), None)
            return None, "vazia_guardada"

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
        # A área e o canal: é por eles que o juiz da foto padrão sabe com
        # que recorte comparar. Não chegam ao modelo (ver `JuizPorRegra`).
        ctx["zona_id"] = regra.zona.id
        ctx["ponto_id"] = evento.ponto_id
        if regra.base_id:
            ctx["base_id"] = regra.base_id
        if dentro is not None:
            # O juiz precisa saber que o cinza em volta foi posto de
            # propósito — senão lê como defeito da imagem.
            ctx["fora_da_area"] = "apagado"

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
            if not continuo:
                # A cena é a de um item que ainda espera resposta: quem a
                # repetir depois saberá de qual item ela é.
                self._anotar_cena(chave_dedupe, f.ts, chave)
            # A resposta desse item ainda não veio (ou, em presença e
            # contagem, é a MESMA olhada entrando de novo): não há "fora"
            # conhecido para continuar.
            return None, "repetido"
        if not continuo:
            # Anotada para a volta: é pela chave do item que a resposta acha
            # a pergunta que ESTE motor fez.
            self._esquecer_o_que_venceu(f.ts)
            self._perguntas[chave] = (pergunta, f.ts)
            self._anotar_cena(chave_dedupe, f.ts, chave)
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
            if not regra.julga:
                # O critério desceu para "observando" com esta olhada ainda
                # na fila. Quem só observa não julga e não gasta: ela fica
                # de lado, como a da regra que não existe mais, e vence
                # sozinha. Se o critério voltar a ensaio antes disso, é
                # julgada.
                self.fila.adiar(item, "o critério só observa", agora)
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
            self._anotar_resposta(item, veredito)

            alerta = self._avaliar(regra, item, veredito)
            try:
                self.fila.contar_veredito(
                    item.capturado_em, item.regra_id, item.zona_id, veredito, agora,
                    alerta=alerta is not None,
                    # A olhada extra do vigia acontece justamente quando algo
                    # mudou: fica marcada, e fora da média da hora.
                    extra=bool((item.contexto or {}).get("olhada_extra")),
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
        # Só quem está VALENDO avisa. Em ensaio (e medido) o veredito é
        # contado e mostrado, e para aí: nem aviso, nem espera de
        # confirmação, nem silêncio. É a porta que vem antes de todas.
        if not regra.avisa:
            return None
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
            if (item.contexto or {}).get("olhada_extra"):
                # A olhada extra do vigia vem segundos depois da anterior.
                # Contada, "continuou por 3 olhadas" viraria "durou dez
                # segundos" — o contrário do que o critério pediu. Ela não
                # começa nem adianta a espera: quem conta é a rotina. (O
                # CONFORME de uma extra zera a espera, lá em cima: aí a
                # condição não continuou mesmo.)
                return None
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

    def _continua(self, regra: Regra, ts: datetime, repete: str | None) -> None:
        """A cena não mudou desde um fora do critério: é mais uma olhada em que ele continua.

        Sem isto, "avisar só se continuar" nunca avisaria justamente do
        que continua: a bancada suja parada é a MESMA imagem, e imagem
        repetida não é julgada de novo.

        `repete` é o item (a chave) de que a cena desta olhada é repetição.
        Só conta quando é o PRÓPRIO julgamento fora do critério que está
        esperando: repetir uma cena que ninguém conseguiu avaliar não diz
        que o fora continuou — e o aviso sairia de algo que ninguém viu.
        Quando não se sabe o que a cena repete (`None`), não conta.
        """
        lugar = self._lugar(regra)
        espera = self._seguidas.get(lugar)
        if espera is None or regra.confirmar_em <= 1:
            return
        if repete != espera.item.chave:
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

    def _anotar_cena(self, lugar_da_cena: str, ts: datetime, chave: str) -> None:
        """De que item é a cena desta olhada: quem a repetir sabe o que está repetindo.

        Guardado pelo tempo da memória de cena repetida — depois dele
        ninguém mais é dado como repetição desta.
        """
        self._itens_das_cenas = {
            cena: item for cena, item in self._itens_das_cenas.items()
            if ts - cena[1] <= self._dedup.memoria
        }
        self._itens_das_cenas[(lugar_da_cena, ts)] = chave

    def _vazia_guardada(self, pergunta: _Pergunta, ts: datetime) -> bool:
        """A cena desta olhada tem a resposta vazia guardada, e ainda valendo?

        Vale da cena da última vazia PAGA até a guarda vencer: a olhada
        segurada não renova o prazo.
        """
        guardada = self._vazias.get(pergunta)
        if guardada is None:
            return False
        quantas, ultima = guardada
        return quantas >= self._vazias_para_guardar and ts - ultima < self._guarda_da_vazia

    def _anotar_resposta(self, item: ItemFila, veredito: Veredito) -> None:
        """A resposta mais nova de uma pergunta é a que vale para a guarda.

        Só conta a pergunta que ESTE motor fez. A olhada que já esperava na
        fila quando a configuração mudou foi cortada e reduzida do jeito
        antigo: a resposta dela não diz nada sobre a pergunta de agora.

        Só a resposta vazia que veio DA NUVEM conta — é ela que se pagaria
        de novo. Qualquer outra resposta para a mesma pergunta desfaz o que
        estava guardado.
        """
        feita = self._perguntas.pop(item.chave, None)
        if feita is None:
            return
        pergunta, quando = feita
        if veredito.resultado is Resultado.NAO_AVALIAVEL and veredito.via is Via.NUVEM:
            # Mais uma vazia seguida. A que já tinha vencido saiu da memória
            # quando esta pergunta foi anotada (`_esquecer_o_que_venceu`):
            # depois de vencer, a contagem recomeça da primeira.
            quantas, _ = self._vazias.get(pergunta, (0, quando))
            self._vazias[pergunta] = (quantas + 1, quando)
        else:
            self._vazias.pop(pergunta, None)

    def _esquecer_o_que_venceu(self, agora: datetime) -> None:
        """Tira da memória a vazia que já venceu e a pergunta que ficou sem resposta.

        Roda a cada pergunta nova, que é quando a memória cresce: sem isto
        ela só cresceria, num programa que fica semanas ligado. E é o que
        faz a contagem das vazias seguidas recomeçar depois de a guarda
        vencer: a vazia vencida não está mais lá para ser contada.
        """
        self._vazias = {
            p: (quantas, t) for p, (quantas, t) in self._vazias.items()
            if agora - t < self._guarda_da_vazia
        }
        self._perguntas = {
            chave: (p, t) for chave, (p, t) in self._perguntas.items()
            if agora - t < _ESPERA_MAIS_LONGA
        }

    def _cena_de(self, regra: Regra, ponto_id: str) -> Cena | None:
        """A cena do canal, se a loja pergunta com contexto e este critério pode levar imagem para fora."""
        if self._contexto is None or regra.tipo not in COM_CENA:
            return None
        return self._contexto.cenas.get(ponto_id)

    def _cuidar_do_mapa(self, ponto_id: str, cena: Cena, quadro: Any) -> None:
        """Garante o mapa do canal, uma vez por olhada. Erro de disco sobe, como o do spool."""
        if self._contexto is None or ponto_id in self._mapa_cuidado:
            return
        self._mapa_cuidado.add(ponto_id)
        self._contexto.mapas.cuidar(ponto_id, cena, quadro, quadro.ts)

    def _o_estudo_segura(self, regra: Regra, evento: EventoGatilho, melhor: Any, f: Any) -> str | None:
        """O estudo deixa esta olhada seguir? Devolve o desfecho que a segura, ou `None`.

        `melhor` é o quadro inteiro da câmera; `f`, o recorte do quadro do
        critério, já com o que é de fora apagado.
        """
        assert regra.estudo is not None and self._sinais is not None
        lugar = self._lugar(regra)
        parecer = self._sinais.avaliar(
            regra.estudo, criterio=lugar, ts=evento.ts,
            onde=lambda c: self._lugar_de(c, regra, evento.ponto_id, melhor, f),
        )
        if parecer.falta is not None:
            self.sem_condicao[lugar] = parecer.falta
            if parecer.sinal_que_falta == "pessoa":
                # Sem ninguém ali, o que estava fora do critério numa PESSOA
                # deixou de estar: a espera recomeça do zero.
                self._seguidas.pop(lugar, None)
            return "sem_condicao"
        if not parecer.disparou:
            return "sem_gatilho"
        return None

    def _a_bancada(self, regra: Regra, ponto_id: str) -> tuple[str | None, bool]:
        """A olhada do quadro de bancada pode sair agora? Devolve `(o que a segura, o quadro está quieto)`.

        Só o MOVIMENTO segura (há mão na frente). A olhada segurada fica
        anotada: a auditoria a refaz quando o quadro parar — é esse o quadro
        de "as mãos saíram".

        Quando a quietude não sabe dizer (sem fluxo menor, fluxo parado),
        não segura — e também não afirma que o quadro está quieto: a olhada
        segue como sempre foi, com o borrão de rosto.
        """
        assert self._quietude is not None
        lugar = self._lugar(regra)
        esperando = self.esperando_as_maos.setdefault(str(ponto_id), set())
        esperando.discard(lugar)
        quieto = self._quietude.quieto(ponto_id, regra.zona.id)
        if quieto is None:
            return None, False
        if not quieto:
            esperando.add(lugar)
            return f"há movimento em {self._nome_do_quadro(regra.zona)}: a olhada espera as mãos saírem", False
        return None, True

    def _ninguem_a_vista(self, regra: Regra, ponto_id: str, f: Any) -> bool:
        """O detector olhou a imagem que vai sair e não viu ninguém — nem um "talvez"?

        É o que deixa a imagem do quadro de bancada sair sem o borrão de
        rosto. Por isso o que não se sabe conta como "pode haver alguém":
        sem detector, ou com ele falhando, a resposta é não.
        """
        if self._pessoas is None:
            return False
        try:
            pontos = self._pessoas(f.imagem, f"{ponto_id}:{regra.zona.id}", f.ts)
        except Exception as e:  # noqa: BLE001
            _log.warning(
                "o detector não olhou %s (%s): a imagem vai com o borrão de rosto", self._nome_do_quadro(regra.zona), e
            )
            return False
        return pontos is not None and not any(p >= self._duvida for p in pontos)

    @staticmethod
    def _nome_do_quadro(zona: Zona) -> str:
        return f"Quadro {zona.numero} — {zona.nome}" if zona.numero else zona.nome

    def _lugar_de(self, c: Condicao, regra: Regra, ponto_id: str, melhor: Any, f: Any) -> Lugar | None:
        """Onde uma condição do estudo é lida nesta olhada.

        `None` quando o quadro citado não existe neste canal (foi excluído,
        ou é de outro canal): a condição não segura e o gatilho dispara.
        """
        if c.onde == "canal":
            zona = None
        elif c.onde == "quadro":
            zona = self._zonas.get(str(c.zona_id))
            if zona is None or str(zona.ponto_id) != str(ponto_id):
                return None
        else:
            zona = regra.zona

        # A chave é do LUGAR (canal e quadro), não do critério: três
        # critérios que olham o mesmo quadro leem o sinal uma vez só.
        if zona is None:
            inteira = Zona(
                id="canal", nome="imagem completa", ponto_id=ponto_id,
                poligono=[(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)],
            )
            recortado, _ = recorte.recortar_area(melhor, inteira)
            return Lugar(f"{ponto_id}:canal", recortado.imagem, inteira, "a imagem completa")

        nome = self._nome_do_quadro(zona)
        if zona.id == regra.zona.id:
            imagem = f.imagem
        else:
            recortado, dentro = recorte.recortar_area(melhor, zona)
            imagem = recorte.apagar_fora(recortado, dentro).imagem
        return Lugar(f"{ponto_id}:{zona.id}", imagem, zona, nome)

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
