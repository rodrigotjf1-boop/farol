"""O motor ligado à configuração que desceu e à nuvem.

Até aqui as duas metades existiam separadas: o `servir` falava com a
nuvem e capturava preview; o motor, a fila e o juiz rodavam só no `laco`,
contra material gravado com gatilho simulado. **O agente conversava e não
auditava nada.** Esta peça junta as duas.

## Por que amostragem, e não o gatilho do gravador

O desenho prevê gatilho em dois estágios: o DVR avisa movimento, o agente
classifica. Isso continua sendo o certo para escala, e o `GatilhoCGI` já
está provado contra o MHDX.

Mas para a primeira semana de operação de verdade — que é o que o dono
pediu, três canais por mais de sete dias — a amostragem periódica ganha,
por três motivos:

1. **O deduplicador torna a amostragem barata.** Cena que não mudou tem
   o mesmo pHash e é descartada antes de virar análise. Numa cozinha
   parada, mil capturas viram zero chamadas.
2. **Menos peças que podem quebrar calado.** Manter N transmissões de
   evento abertas por uma semana é exatamente o tipo de coisa que falha
   na terça de madrugada sem ninguém ver — e o MHDX já nos mostrou que
   fecha a transmissão a cada evento.
3. **Falha de uma câmera não derruba as outras.** Uma captura que falha
   é uma captura; uma transmissão que morre é um canal cego até alguém
   reiniciar.

O gatilho entra depois, quando houver semana de dados dizendo quanto ele
economiza de verdade.

## O que esta peça garante

- **A auditoria nunca atrasa o heartbeat.** Captura e julgamento rodam em
  thread própria; o laço da nuvem segue batendo mesmo com o modelo lento.
- **Configuração nova reconstrói tudo.** Regra ligada, área redesenhada
  ou ponto novo passam a valer sem reiniciar o agente.
- **Evento que não subiu não se perde.** Fica na fila local até a nuvem
  aceitar — é o mesmo princípio da configuração em disco.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from farol_agent.configuracao import ConfigDaLoja, PontoConfig
from farol_agent.contexto import FALTA_A_CENA, cenas_da_loja
from farol_agent.contrato import (
    evento_para_nuvem,
    maquina_para_nuvem,
    resumo_para_nuvem,
    uso_para_nuvem,
)
from farol_agent.fila import Fila
from farol_agent.mapas import Mapas
from farol_agent.modelos import EventoGatilho, TipoRegra
from farol_agent.motor import CONTINUOS, PAPEL_DE_BANCADA, ComContexto, MotorDeRegras
from farol_agent.nuvem import ErroDaNuvem
from farol_agent.padroes import Padroes
from farol_agent.quietude import Quietude
from farol_agent.vigia import INTERVALO_PADRAO as INTERVALO_DO_VIGIA
from farol_agent.vigia import VIGIADOS, Vigia
from farol_agent.uso import Medidor

_log = logging.getLogger(__name__)

INTERVALO_CAPTURA_PADRAO = 30.0
LIMITE_POR_PASSADA = 10
# Quantos eventos sobem por pedido. A API aceita 500; cem por vez drena uma
# fila de fim de semana em poucos minutos sem mandar um corpo gigante por
# uma internet que acabou de voltar.
LIMITE_DE_SUBIDA = 100
# Quanto esperar depois de a nuvem recusar o PEDIDO (4xx). Repetir a cada
# trinta segundos um pedido que está errado não conserta nada e enche o log
# com a mesma linha — só muda com agente novo ou nuvem nova.
PAUSA_APOS_RECUSA_MIN = 10
# O resumo por hora sobe de tempos em tempos, não a cada passada: a linha
# da hora corrente muda a cada captura, e mandá-la a cada trinta segundos
# seria cento e vinte pedidos por hora para dizer quase a mesma coisa.
INTERVALO_DE_RESUMO_MIN = 5
LIMITE_DE_RESUMOS = 200
# Por quanto tempo o resumo que a nuvem já tem fica guardado na loja.
GUARDA_DO_RESUMO_DIAS = 15
# Por quanto tempo a análise ENCERRADA (julgada, vencida ou falhada) e a
# imagem dela ficam no disco da loja. O que conta a história sobe no resumo
# e no evento; a imagem serve para conferir "por que ele disse isso?" nos
# dias seguintes. Sem prazo, o spool crescia para sempre (ERR-062).
GUARDA_DAS_ANALISES_DIAS = 15
# De quanto em quanto tempo a limpeza roda. É uma varredura da fila: de hora
# em hora basta.
INTERVALO_DA_LIMPEZA_MIN = 60


# O detector é carregado UMA vez por processo. O juiz é reconstruído a cada
# versão de configuração, e recarregar 108 MB de modelo sempre que alguém
# liga um critério no console travaria a batida por segundos, à toa.
_detector: Any = None
_detector_tentado = False


def _detector_local():
    """O juiz detector, se o modelo estiver instalado. `None` se não.

    Nunca baixa nada: instalar o modelo é passo de instalação
    (`farol-agent detector instalar`). Sem ele, critérios de presença e
    contagem ficam de fora — e o motivo é dito uma vez.
    """
    global _detector, _detector_tentado
    if _detector_tentado:
        return _detector
    _detector_tentado = True

    import os
    from pathlib import Path

    from farol_agent.juizes.detector import MODELO_ARQUIVO, JuizDetector, MotorOnnx

    caminho = Path(os.environ.get("FAROL_MODELOS") or "modelos") / MODELO_ARQUIVO
    if not caminho.is_file():
        _log.info(
            "detector local não instalado (%s não existe): critérios de "
            "presença e contagem ficam de fora. Rode: farol-agent detector instalar",
            caminho,
        )
        return None
    try:
        motor = MotorOnnx(caminho)
    except Exception as e:  # noqa: BLE001
        _log.warning("detector local indisponível: %s", e)
        return None
    _detector = JuizDetector(motor)
    _log.info("detector local pronto: %s em %s", motor.nome, motor.onde)
    return _detector


# O quadro de bancada: com uma olhada esperando as mãos saírem, o laço acorda
# de segundo em segundo para refazê-la assim que o quadro parar...
ESPERA_DA_BANCADA = 1.0
# ...e tenta no máximo isto por canal a cada volta de rotina: cada tentativa
# abre o fluxo principal, e mão que volta no meio do caminho não pode virar
# uma fila de aberturas. Duas, e não três: na conta feita sobre a série
# medida na loja (ver `docs/decisoes.md`), a imagem sai em 7 de cada 10
# voltas já na rotina, em 9 de cada 10 com até duas tentativas — e a
# terceira acrescentava 1 em 100.
MAX_REFEITAS_POR_VOLTA = 2


def _duvida_do_detector() -> float:
    """A partir de quanto um ponto do detector de pessoas já é "talvez alguém"."""
    from farol_agent.juizes.detector import DUVIDA

    return DUVIDA


def _usa_o_padrao(regra) -> bool:
    """O estudo deste critério compara algum lugar com a foto padrão do canal?"""
    estudo = getattr(regra, "estudo", None)
    if estudo is None:
        return False
    return any("padrao" in c.sinal for c in (*estudo.contexto, *estudo.gatilho))


# De quanto em quanto tempo o agente tenta de novo baixar a foto padrão que
# ainda não desceu (rede fora, nuvem reiniciando).
NOVA_BUSCA_DE_PADROES = timedelta(seconds=60)


def _relogios_do_gravador(ponto: PontoConfig) -> dict[int, tuple[float, float, float, float]]:
    """Pergunta ao gravador onde ele escreve o relógio, por canal.

    A senha sai do cofre local e não é registrada em lugar nenhum.
    """
    from farol_agent import cofre
    from farol_agent.dvr.dahua import ClienteDahua

    cliente = ClienteDahua(str(ponto.host), ponto.usuario or "admin", cofre.resolver(ponto.segredo_ref))
    return cliente.relogios()


class Auditoria:
    """Mantém o motor em dia com a configuração e roda o laço de análise."""

    def __init__(
        self,
        cliente,
        caminho_fila: str,
        *,
        intervalo_captura: float = INTERVALO_CAPTURA_PADRAO,
        intervalo_rapido: float = INTERVALO_DO_VIGIA,
        construir_fonte=None,
        construir_juiz=None,
        medidor="padrao",
        quietude: Quietude | None = None,
    ) -> None:
        self.cliente = cliente
        self.fila = Fila(caminho_fila)
        self.intervalo_captura = intervalo_captura
        # De quanto em quanto tempo o vigia olha o fluxo menor entre uma
        # olhada e outra. Zero desliga o vigia: fica só a rotina.
        self.intervalo_rapido = intervalo_rapido
        self.vigia: Vigia | None = None
        # Quem acompanha o movimento dos quadros de bancada no fluxo menor
        # (as mãos saíram?). Um só para a vida do processo: guarda as
        # últimas amostras de cada quadro. Injetável, para o teste dar o
        # relógio.
        self.quietude = quietude or Quietude()
        # Quantas olhadas de bancada já foram refeitas em cada canal desde
        # a última volta de rotina.
        self._refeitas: dict[str, int] = {}
        # Quando é a próxima olhada de rotina. Entre uma e outra, o laço
        # acorda para o vigia.
        self._proxima_rotina: datetime | None = None
        # Quando o vigia tem a vez dele de novo. Ele tem passo próprio: o
        # laço também acorda para a bancada (de segundo em segundo), e o
        # detector do vigia não pode ir junto.
        self._proximo_vigia: datetime | None = None

        # Injetáveis para o teste não precisar de câmera nem de API.
        self._construir_fonte = construir_fonte or self._fonte_rtsp
        self._construir_juiz = construir_juiz or self._juiz_padrao

        self.motor: MotorDeRegras | None = None
        self.juiz = None
        # Quem confere se vale perguntar à nuvem. Um só para a vida do
        # processo (ver `_o_porteiro`). O detector dele é injetável.
        self._porteiro = None
        self._detector_do_porteiro = _detector_local
        # Quem lê os sinais do estudo de cada critério (ver `_os_sinais`).
        # Um só para a vida do processo, como o porteiro: é ele que guarda
        # a olhada anterior de cada lugar.
        self._sinais = None
        # As fotos padrão dos canais, em disco, ao lado da fila. Quem
        # baixa é o cliente da nuvem; sem ele (teste, bancada), a loja
        # compara só com o que já tiver.
        self.padroes = Padroes(
            Path(self.fila.caminho).parent / "padroes", baixar=getattr(cliente, "baixar_padrao", None)
        )
        self._proxima_busca_de_padroes: datetime | None = None
        # Os mapas dos canais (a câmera inteira, pequena, com os quadros
        # numerados), ao lado da fila. Só existem em loja que pergunta com
        # contexto; quem os desenha é o motor.
        self.mapas = Mapas(Path(self.fila.caminho).parent / "mapas", sem_gente=self._sem_gente)
        # Os critérios cuja pergunta vai direto a um modelo de fora, e o
        # modelo que responde: o que `_com_juiz` apura para o motor.
        self._direto_a_nuvem: set[str] = set()
        self._modelo_com_contexto = ""
        # Onde cada gravador escreve o relógio, por canal. Perguntado uma
        # vez por gravador; injetável para o teste não precisar de um.
        self._perguntar_relogios = _relogios_do_gravador
        self._relogios_por_gravador: dict[str, dict[int, tuple[float, float, float, float]]] = {}
        self.fontes: dict[str, Any] = {}
        self.versao_montada: int | None = None
        # Com que declaração do agente a configuração montada foi pedida:
        # a mesma versão, pedida sabendo mais, pode trazer mais coisa.
        self._montada_sabendo: tuple[str, ...] | None = None
        self.ultimo_erro: str | None = None

        # Estado da subida. O texto do último erro serve para dizer a causa
        # UMA vez, e não a cada passada enquanto a internet estiver fora.
        self._erro_de_subida: str | None = None
        self._subida_suspensa_ate: datetime | None = None

        # Critérios ligados que ninguém aqui consegue julgar, com o motivo.
        # Não são capturados (ver `_com_juiz`), mas entram no resumo da
        # hora: é o que faz o console dizer "falta o juiz" em vez de
        # mostrar um critério ligado e mudo.
        self.sem_juiz: list[tuple[Any, str]] = []

        # O resumo tem estado de subida próprio. Um pedido de eventos
        # recusado não pode calar o resumo, nem o contrário.
        self._erro_de_resumo: str | None = None
        self._resumo_suspenso_ate: datetime | None = None
        self._proximo_resumo: datetime | None = None

        # O uso da máquina (processador, memória, placa de vídeo, disco). Uma
        # amostra por volta, somada por hora, com subida e estado próprios:
        # nuvem antiga, sem a rota, não pode custar um evento nem um resumo.
        # `medidor=None` desliga (o teste que não quer medir a máquina dele).
        self.medidor = Medidor(self.fila.spool) if medidor == "padrao" else medidor
        self._erro_de_uso: str | None = None
        self._uso_suspenso_ate: datetime | None = None
        self._proximo_uso: datetime | None = None

        # Quando a limpeza do disco roda de novo (ver `limpar`).
        self._proxima_limpeza: datetime | None = None

        self._parar = threading.Event()
        self._thread: threading.Thread | None = None

    # ─────────────────────────── montagem ───────────────────────────

    @staticmethod
    def _fonte_rtsp(ponto: PontoConfig):
        from farol_agent.fontes.rtsp import FonteRTSP
        from farol_agent.servico import url_do_ponto

        # `abrir_sub=True`: o leitor contínuo do sub mantém o quadro mais
        # recente em memória, e é dele que a amostragem bebe. Abrir o main
        # a cada captura gastaria um dos poucos fluxos simultâneos que o
        # gravador aceita — e esse fluxo faz falta ao preview.
        return FonteRTSP(
            ponto.id,
            url_do_ponto(ponto),
            url_sub=url_do_ponto(ponto, sub=True),
            abrir_sub=True,
            alcance=(ponto.host, int(ponto.porta or 554)) if ponto.host else None,
        )

    def _juiz_padrao(self, config: ConfigDaLoja):
        """O SELETOR, nunca um juiz direto.

        Ligar `JuizNuvem` aqui furaria a proteção que o desenho tem: a
        categoria da regra decide o juiz, e `presenca` e `contagem`
        **não podem sair da loja** — é promessa do produto, não
        preferência.

        `comparacao` é decidida na loja sempre que a cena é igual à foto
        padrão. Só o que NÃO é igual sai — com a foto padrão ao lado, e só
        em loja que usa a nuvem (decisão de 08/10/2026, no protótipo
        aprovado: "só vai à nuvem quando a loja ficar em dúvida"). Em loja
        de modo `local`, nada sai: a resposta é "não deu para avaliar".

        E não é só privacidade: a medição de 05/10 mostrou o modelo de
        nuvem lendo um mouse como controle remoto, duas vezes, com 95% de
        confiança. Identificação de objeto é trabalho de detector.

        O seletor levanta erro claro quando falta o juiz de uma
        categoria, em vez de desviar para o que estiver à mão.
        """
        from farol_agent.juizes.nuvem import JuizNuvem
        from farol_agent.juizes.seletor import JuizPorRegra, SeletorDeJuiz

        # A loja pergunta com contexto: a nuvem recusa o pedido que chegar
        # sem a cena, e o seletor entrega a de cada canal. Na loja que não
        # pergunta com contexto, o juiz é montado como sempre foi.
        cenas = cenas_da_loja(config) if config.pedido_com_contexto else None
        com_contexto = {"exige_cena": True} if config.pedido_com_contexto else {}

        nuvem = None
        try:
            nuvem = JuizNuvem(**com_contexto)
        except Exception as e:  # noqa: BLE001
            # Sem chave, o seletor ainda serve: regra local continua
            # atendida, e regra de nuvem falha dizendo o que falta.
            _log.warning("juiz de nuvem indisponível: %s", e)

        from farol_agent.juizes.padrao import JuizDoPadrao

        # O juiz da foto padrão compara na loja. O que não for igual ele
        # passa à nuvem com a foto ao lado — menos em loja de modo
        # `local`, de onde nada sai: ali a resposta é "não deu para
        # avaliar".
        padrao = JuizDoPadrao(
            self.padroes,
            {z.id: z for p in config.pontos for z in p.zonas},
            relogios=self._relogios(config),
            escalar_para=nuvem if config.modo_julgamento != "local" else None,
        )
        seletor = SeletorDeJuiz(
            config.modo_julgamento, nuvem=nuvem, detector=_detector_local(), padrao=padrao
        )
        return JuizPorRegra(
            seletor,
            {r.id: r for r in config.regras},
            equipamentos={z.id: z.equipamentos for p in config.pontos for z in p.zonas if z.equipamentos},
            lugares={p.id: p.lugar for p in config.pontos if p.lugar},
            cenas=cenas,
            mapas=self.mapas,
        )

    def _sem_gente(self, imagem) -> bool | None:
        """O quadro da câmera está sem ninguém? `None` quando não há como saber.

        É a pergunta que decide se o mapa do canal pode ser fotografia
        (`mapas.py`). Responde o detector de pessoas da loja, do lado
        conservador: um "talvez" já é alguém. Sem detector instalado, não
        se sabe — e o mapa fica no esquema.
        """
        motor = getattr(self._detector_do_porteiro(), "motor", None)
        if motor is None:
            return None
        from farol_agent.juizes.detector import DUVIDA, OBJETOS

        return not any(float(p) >= DUVIDA for p in motor.pontuar(imagem, OBJETOS["pessoa"]))

    def _relogios(self, config: ConfigDaLoja) -> dict[str, tuple[float, float, float, float]]:
        """Por canal, o retângulo em que o gravador escreve data e hora.

        Só pergunta quando alguém vai comparar com foto padrão, e só aos
        gravadores dos canais que têm foto. Gravador que não responde (ou
        que não é desta família) fica sem retângulo: a comparação segue,
        e área com o relógio dentro vai dar "diferente" — pergunta a
        mais, não veredito errado.
        """
        if not any(r.tipo is TipoRegra.COMPARACAO or r.com_padrao or _usa_o_padrao(r) for r in config.regras):
            return {}
        saida: dict[str, tuple[float, float, float, float]] = {}
        for ponto in config.pontos:
            if not (ponto.padroes and ponto.host and ponto.canal) or ponto.origem != "dvr":
                continue
            por_canal = self._relogios_por_gravador.get(ponto.host)
            if por_canal is None:
                try:
                    por_canal = self._perguntar_relogios(ponto)
                except Exception as e:  # noqa: BLE001
                    # Não fica guardado: a próxima montagem pergunta de novo.
                    _log.warning(
                        "o gravador %s não disse onde escreve o relógio (%s): área com o relógio "
                        "dentro vai dar diferente da foto padrão", ponto.host, e,
                    )
                    continue
                self._relogios_por_gravador[ponto.host] = por_canal
            retangulo = por_canal.get(int(ponto.canal))
            if retangulo is not None:
                saida[ponto.id] = retangulo
        return saida

    def _buscar_padroes(self, agora: datetime | None = None, *, ja: bool = False) -> None:
        """Baixa as fotos padrão que faltam. Rede fora não derruba nada."""
        agora = agora or datetime.now()
        if not ja and self._proxima_busca_de_padroes is not None and agora < self._proxima_busca_de_padroes:
            return
        self._proxima_busca_de_padroes = agora + NOVA_BUSCA_DE_PADROES
        try:
            if self.padroes.faltam():
                self.padroes.baixar_o_que_falta()
        except Exception:  # noqa: BLE001
            _log.exception("erro inesperado ao buscar as fotos padrão; a auditoria segue")

    def _montar_vigia(self, regras) -> None:
        """O vigia olha o fluxo menor entre uma olhada e outra (ver `vigia.py`).

        Precisa do detector e de pelo menos um critério de presença ou de
        contagem com o que procurar. É um só para a vida do processo: o
        freio não esquece a carga da máquina porque a configuração mudou.
        """
        if self.intervalo_rapido <= 0:
            self.vigia = None
            return
        if self.vigia is None:
            # Sem critério de presença ou de contagem não há o que vigiar:
            # nem se mexe no detector.
            if not any(r.tipo in VIGIADOS for r in regras):
                return
            detector = self._detector_do_porteiro()
            if detector is None:
                return
            from farol_agent.juizes.detector import CERTEZA, OBJETOS

            def contar(imagem, classe: str) -> int:
                return sum(1 for p in detector.motor.pontuar(imagem, classe) if p >= CERTEZA)

            self.vigia = Vigia(contar, classes=dict(OBJETOS))
        self.vigia.montar(regras)
        if self.vigia.canais:
            _log.info(
                "vigia: %d canal(is) com presença ou contagem, olhados a cada %gs pelo fluxo menor",
                len(self.vigia.canais), self.intervalo_rapido,
            )

    def _o_porteiro(self, regras):
        """O porteiro, se algum critério pede um — e sempre o MESMO.

        Ele guarda a cena anterior de cada lugar (para medir movimento):
        recriá-lo a cada mudança de configuração apagaria essa memória.
        Usa o motor do detector local quando há; sem detector, o porteiro
        deixa passar o que não consegue conferir.
        """
        if not any(getattr(r, "porteiro", "sempre") != "sempre" for r in regras):
            return None
        if self._porteiro is None:
            from farol_agent.juizes.detector import CERTEZA, DUVIDA, OBJETOS
            from farol_agent.porteiro import Porteiro

            detector = self._detector_do_porteiro()
            self._porteiro = Porteiro(
                getattr(detector, "motor", None),
                classe_pessoa=OBJETOS["pessoa"], certeza=CERTEZA, duvida=DUVIDA,
            )
        self._porteiro.esquecer({f"{r.id}@{r.zona.id}" for r in regras})
        return self._porteiro

    def _a_quietude(self, regras):
        """A quietude, se há quadro de bancada com critério — e o que ela passa a acompanhar.

        Quadro de bancada é o que tem o papel "posição de montagem". Só
        conta o critério que manda imagem para julgar: presença e contagem
        são conferidas em toda olhada, com mão ou sem.
        """
        # Por canal, os quadros — cada um uma vez, por mais critérios que tenha.
        quadros: dict[str, dict[str, Any]] = {}
        for r in regras:
            if r.tipo in CONTINUOS or r.zona.papel != PAPEL_DE_BANCADA:
                continue
            quadros.setdefault(str(r.zona.ponto_id), {})[r.zona.id] = r.zona
        # Sempre, mesmo sem nenhum: é o que larga o quadro que deixou de ser acompanhado.
        self.quietude.montar({ponto_id: list(do_canal.values()) for ponto_id, do_canal in quadros.items()})
        if not quadros:
            return None
        _log.info(
            "quadro de bancada: %d quadro(s) acompanhado(s) no fluxo menor — a olhada espera as mãos saírem",
            sum(len(do_canal) for do_canal in quadros.values()),
        )
        return self.quietude

    def _os_sinais(self, regras, config: ConfigDaLoja):
        """Os sinais da loja, se algum critério tem estudo — e sempre os MESMOS.

        Eles guardam a leitura anterior de cada lugar (é dela que sai
        "entrou", "parou", "saiu do padrão"): recriá-los a cada mudança de
        configuração apagaria essa memória. Presença e contagem não usam
        estudo — são julgadas na loja em toda olhada. Sem critério com
        estudo não há o que guardar, e a memória é largada.
        """
        com_estudo = [r for r in regras if r.estudo is not None and r.tipo not in CONTINUOS]
        if not com_estudo:
            self._sinais = None
            return None
        if self._sinais is None:
            from farol_agent.juizes.detector import CERTEZA, DUVIDA
            from farol_agent.sinais import Sinais

            self._sinais = Sinais(
                self._pontos_de_pessoa, semelhanca=self._semelhanca_com_o_padrao,
                certeza=CERTEZA, duvida=DUVIDA,
            )
        self._sinais.esquecer(
            {f"{r.id}@{r.zona.id}" for r in com_estudo},
            {f"{p.id}:{z.id}" for p in config.pontos for z in p.zonas} | {f"{p.id}:canal" for p in config.pontos},
        )
        return self._sinais

    def _pontos_de_pessoa(self, imagem, lugar: str, ts: datetime) -> list[float] | None:
        """Os pontos do detector de pessoas num recorte. `None` = sem detector: não se sabe."""
        motor = getattr(self._detector_do_porteiro(), "motor", None)
        if motor is None:
            return None
        from farol_agent.juizes.detector import OBJETOS

        return [float(p) for p in motor.pontuar(imagem, OBJETOS["pessoa"])]

    def _semelhanca_com_o_padrao(self, imagem, zona) -> float | None:
        """Quão igual à foto padrão do canal é este recorte. `None` = sem foto, ou sem medida.

        Quem compara é o juiz da foto padrão que a loja já tem — o de
        AGORA: ele é montado de novo a cada configuração.
        """
        mais_parecida = getattr(getattr(getattr(self.juiz, "seletor", None), "padrao", None), "mais_parecida", None)
        if mais_parecida is None:
            return None
        achado = mais_parecida(imagem, zona)
        return None if achado is None else achado.semelhanca

    def montar(self, config: ConfigDaLoja) -> None:
        """(Re)constrói motor, juiz e fontes a partir da configuração."""
        if config.versao == self.versao_montada and config.pedida_sabendo == self._montada_sabendo:
            return

        # As fotos padrão: o que cada canal tem de ter em disco, segundo a
        # configuração. Baixa já o que falta — a primeira olhada depois de
        # guardar uma foto já tem com o que comparar.
        self.padroes.declarar({p.id: p.padroes for p in config.pontos})
        self._buscar_padroes(ja=True)

        # O juiz vem primeiro: é ele que sabe dizer quais regras alguém
        # consegue julgar.
        if config.regras:
            try:
                self.juiz = self._construir_juiz(config)
            except Exception as e:  # noqa: BLE001
                self.ultimo_erro = str(e)
                _log.error("sem juiz: %s", e)

        regras = self._com_juiz(config)
        # A loja pergunta com contexto: o motor passa a cuidar do mapa de
        # cada canal e a guardar o recorte na resolução da câmera. Mapa de
        # canal ou de desenho que não existe mais sai do disco aqui — e
        # todos saem quando a chave é desligada.
        contexto = None
        cenas = cenas_da_loja(config) if config.pedido_com_contexto else {}
        self.mapas.largar(cenas)
        if config.pedido_com_contexto:
            contexto = ComContexto(
                cenas=cenas, mapas=self.mapas,
                direto=frozenset(self._direto_a_nuvem), modelo=self._modelo_com_contexto,
            )
        # Com o serializador, o motor grava o corpo do evento na mesma
        # linha do alerta: é o que faz o evento sobreviver a internet fora.
        self.motor = MotorDeRegras(
            self.fila, regras, serializar=evento_para_nuvem, porteiro=self._o_porteiro(regras),
            contexto=contexto,
            # O estudo de cada critério: quem lê os sinais, e os quadros de
            # cada canal (uma condição pode olhar outro quadro do mesmo canal).
            sinais=self._os_sinais(regras, config),
            zonas={z.id: z for p in config.pontos for z in p.zonas},
            # O quadro de bancada: a imagem espera as mãos saírem, e só vai
            # sem o borrão de rosto se o detector da loja não vir ninguém.
            quietude=self._a_quietude(regras),
            pessoas=self._pontos_de_pessoa,
            duvida=_duvida_do_detector(),
        )
        # O vigia olha mais vezes o que é JULGADO na loja: critério que só
        # observa não tem por que ganhar olhada extra.
        self._montar_vigia([r for r in regras if r.julga])

        # Fontes só para pontos que têm regra: abrir câmera que ninguém
        # audita é fluxo do gravador gasto à toa.
        com_regra = {r.zona.id for r in regras}
        novas: dict[str, Any] = {}
        for ponto in config.pontos:
            if not any(z.id in com_regra for z in ponto.zonas):
                continue
            if ponto.id in self.fontes:
                novas[ponto.id] = self.fontes.pop(ponto.id)
                continue
            try:
                novas[ponto.id] = self._construir_fonte(ponto)
            except Exception as e:  # noqa: BLE001
                # Um ponto mal configurado não pode impedir os outros de
                # serem auditados.
                _log.error("não abri o ponto %s: %s", ponto.nome, e)

        self._fechar(self.fontes.values())
        self.fontes = novas

        self.versao_montada = config.versao
        self._montada_sabendo = config.pedida_sabendo
        _log.info(
            "auditoria montada: v%s · %d regra(s) em %d ponto(s)",
            config.versao, len(regras), len(self.fontes),
        )

    def _com_juiz(self, config: ConfigDaLoja) -> list:
        """Só as regras que ALGUÉM pode julgar.

        Capturar para uma regra sem juiz é trabalho jogado fora com
        consequência: cada ciclo grava um JPEG, enfileira um item e
        produz uma linha de erro. Visto em produção em 06/10 — doze
        capturas, doze arquivos e doze avisos idênticos em seis minutos,
        todos dizendo a mesma coisa.

        O certo é descobrir uma vez, na montagem, e dizer uma vez. A
        regra continua ligada no console e volta a ser auditada no
        instante em que o juiz dela existir — o agente remonta sozinho
        quando a configuração muda.
        """
        self.sem_juiz = []
        self._direto_a_nuvem = set()
        self._modelo_com_contexto = ""
        if self.juiz is None:
            return list(config.regras)

        seletor = getattr(self.juiz, "seletor", None)
        if seletor is None:
            return list(config.regras)

        from farol_agent.juizes.base import ErroDoJuiz

        # A loja pergunta com contexto: o recorte nunca sai sozinho. O
        # critério julgado na nuvem, em canal SEM cena escrita, não é
        # capturado — e o console mostra "falta descrever a cena" no lugar
        # de uma análise que não foi feita. Decidido aqui, na montagem,
        # uma vez por versão de configuração.
        cenas = cenas_da_loja(config) if config.pedido_com_contexto else None
        nuvem = getattr(seletor, "nuvem", None)
        self._modelo_com_contexto = str(getattr(nuvem, "modelo_com_contexto", "") or "")

        servidas, orfas = [], []
        for r in config.regras:
            if not r.julga:
                # Critério que só observa não precisa de juiz: a olhada é
                # contada e para ali. O que faltar para julgá-lo (o
                # detector, a cena do canal) aparece quando ele passar a
                # ensaio.
                servidas.append(r)
                continue
            try:
                juiz = seletor.para(r)
            except ErroDoJuiz as e:
                orfas.append((r, str(e)))
                continue
            if cenas is not None and nuvem is not None and juiz is nuvem:
                self._direto_a_nuvem.add(r.id)
                if str(r.zona.ponto_id) not in cenas:
                    orfas.append((r, FALTA_A_CENA))
                    continue
            servidas.append(r)
        self.sem_juiz = orfas

        # Um critério que vale em três canais aparece três vezes na lista.
        # A causa é uma só, então o aviso também: uma linha por critério,
        # dizendo em quantos canais ele ficou de fora.
        por_criterio: dict[str, tuple] = {}
        for regra, motivo in orfas:
            anterior = por_criterio.get(regra.id)
            por_criterio[regra.id] = (regra, motivo, (anterior[2] if anterior else 0) + 1)
        for regra, motivo, canais in por_criterio.values():
            _log.warning(
                "regra %r (%s) não será capturada em %d canal(is): %s",
                regra.nome, regra.tipo.value, canais, motivo,
            )
        return servidas

    @staticmethod
    def _fechar(fontes) -> None:
        for f in fontes:
            fechar = getattr(f, "fechar", None)
            if callable(fechar):
                try:
                    fechar()
                except Exception:  # noqa: BLE001
                    pass

    # ──────────────────────────── o laço ────────────────────────────

    def capturar(self, agora: datetime | None = None) -> int:
        """Uma rodada de captura em todos os pontos. Devolve enfileirados."""
        if self.motor is None:
            return 0
        agora = agora or datetime.now()
        total = 0
        # Volta de rotina nova: a conta das olhadas de bancada refeitas recomeça.
        self._refeitas = {}

        for ponto_id, fonte in list(self.fontes.items()):
            evento = EventoGatilho(ponto_id=ponto_id, ts=agora, origem="amostragem")
            try:
                p = self.motor.preparar(evento, fonte)
            except Exception as e:  # noqa: BLE001
                # Câmera caída não pode derrubar o laço nem as outras.
                _log.warning("captura falhou no ponto %s: %s", ponto_id, e)
                continue
            total += len(p.enfileirados)
            if p.sem_cena:
                _log.warning("ponto %s sem cena: %s", ponto_id, p.sem_cena)
            # É com o instante DESTA olhada que o vigia compara depois.
            if self.vigia is not None:
                self.vigia.anotar_olhada(ponto_id, fonte, agora)

        self._contar_sem_juiz(agora)
        return total

    def _contar_sem_juiz(self, agora: datetime) -> None:
        """Marca no resumo da hora os critérios que valem agora e não têm juiz.

        Eles não são capturados, então não deixariam rastro nenhum. No
        console, "ligado e sem nenhuma olhada" e "ligado e sem ninguém que
        julgue" pedem providências diferentes — e só esta máquina sabe qual
        das duas é.
        """
        valendo = [(r, motivo) for r, motivo in self.sem_juiz if r.vale_agora(agora)]
        if not valendo:
            return
        try:
            self.fila.contar_lote(
                [
                    (agora, r.id, r.zona.id, {"capturas": 1, "sem_juiz": 1}, motivo)
                    for r, motivo in valendo
                ]
            )
        except Exception:  # noqa: BLE001
            _log.exception("não consegui somar os critérios sem juiz no resumo")

    def julgar(self, agora: datetime | None = None) -> list:
        """Drena a fila e devolve os alertas."""
        if self.motor is None or self.juiz is None:
            return []
        try:
            return self.motor.processar(
                self.juiz, agora or datetime.now(), limite=LIMITE_POR_PASSADA
            )
        except Exception as e:  # noqa: BLE001
            self.ultimo_erro = str(e)
            _log.exception("julgamento falhou")
            return []

    def subir(self, agora: datetime | None = None) -> int:
        """Manda para a nuvem o que ela ainda não recebeu.

        Sobe o que está GUARDADO na fila, não a lista que acabou de sair do
        julgamento. A primeira versão mandava só essa lista: se a nuvem
        estivesse fora naquele instante, a lista era jogada fora com a
        variável e o evento nunca mais subia (ERR-019). Evento perdido é
        auditoria perdida, e não se recupera — a cena já passou.

        Três respostas possíveis da nuvem, três destinos:

        - aceito ou repetido → marcado como entregue;
        - recusado (regra apagada, ou de outra loja) → marcado como
          recusado e NÃO volta: insistir não muda a resposta, e um evento
          impossível na frente da fila prenderia todos os de trás;
        - o pedido inteiro falhou → nada é marcado, tudo sobe de novo.

        Devolve quantos EVENTOS subiram. O resumo por hora sobe junto, com
        ritmo e estado próprios (`_subir_resumos`).
        """
        agora = agora or datetime.now()
        subidos = self._subir_eventos(agora)
        try:
            self._subir_resumos(agora)
        except Exception:  # noqa: BLE001
            # O resumo nunca pode custar um evento: se algo inesperado
            # acontecer aqui, o que já subiu continua contado.
            _log.exception("erro inesperado ao subir o resumo por hora")
        try:
            self._subir_uso(agora)
        except Exception:  # noqa: BLE001
            _log.exception("erro inesperado ao subir o uso da máquina")
        return subidos

    def _subir_eventos(self, agora: datetime) -> int:
        if self._subida_suspensa_ate is not None and agora < self._subida_suspensa_ate:
            return 0

        pendentes = self.fila.eventos_a_subir(LIMITE_DE_SUBIDA)
        if not pendentes:
            return 0

        try:
            resposta = self.cliente._pedir(
                "POST", "/v1/eventos", {"eventos": [corpo for _, corpo in pendentes]}
            )
        except ErroDaNuvem as e:
            self.ultimo_erro = str(e)
            if not e.recuperavel:
                self._subida_suspensa_ate = agora + timedelta(
                    minutes=PAUSA_APOS_RECUSA_MIN
                )
            # A causa uma vez, não uma linha a cada trinta segundos durante
            # um fim de semana sem internet (ERR-014).
            if str(e) != self._erro_de_subida:
                self._erro_de_subida = str(e)
                _log.error(
                    "não subi %d evento(s): %s — ficam guardados e sobem "
                    "quando a nuvem aceitar",
                    self.fila.a_subir(), e,
                )
            return 0

        if self._erro_de_subida is not None:
            _log.info("a nuvem voltou a aceitar eventos")
        self._erro_de_subida = None
        self._subida_suspensa_ate = None

        recusadas = set((resposta or {}).get("recusados") or [])
        entregues = [i for i, c in pendentes if c.get("idempotenciaKey") not in recusadas]
        devolvidos = [i for i, c in pendentes if c.get("idempotenciaKey") in recusadas]

        self.fila.marcar_enviados(entregues)
        if devolvidos:
            self.fila.marcar_enviados(devolvidos, estado=2)
            _log.warning(
                "%d evento(s) recusado(s) pela nuvem: o critério foi apagado "
                "ou não é desta loja. Não serão reenviados.",
                len(devolvidos),
            )
        return len(entregues)

    def _subir_resumos(self, agora: datetime) -> int:
        """Manda o resumo por hora que a nuvem ainda não tem.

        Mesmas três respostas da subida de eventos, pelas mesmas razões:
        aceito vira "a nuvem tem"; recusado (critério que não é mais desta
        loja) é marcado e não volta; pedido que falhou não marca nada.
        """
        if self._resumo_suspenso_ate is not None and agora < self._resumo_suspenso_ate:
            return 0
        if self._proximo_resumo is not None and agora < self._proximo_resumo:
            return 0

        linhas = self.fila.resumos_a_subir(LIMITE_DE_RESUMOS)
        if not linhas:
            return 0

        try:
            resposta = self.cliente._pedir(
                "POST", "/v1/resumos", {"resumos": [resumo_para_nuvem(l) for l in linhas]}
            )
        except ErroDaNuvem as e:
            if not e.recuperavel:
                self._resumo_suspenso_ate = agora + timedelta(
                    minutes=PAUSA_APOS_RECUSA_MIN
                )
            if str(e) != self._erro_de_resumo:
                self._erro_de_resumo = str(e)
                _log.error(
                    "o resumo por hora ficou sem subir (%d linha(s) esperando): "
                    "%s — fica guardado e sobe quando a nuvem aceitar",
                    self.fila.resumos_pendentes(), e,
                )
            return 0

        if self._erro_de_resumo is not None:
            _log.info("a nuvem voltou a aceitar o resumo por hora")
        self._erro_de_resumo = None
        self._resumo_suspenso_ate = None

        # A nuvem devolve a POSIÇÃO, na lista que subiu, do que ela recusou.
        recusadas = {int(i) for i in ((resposta or {}).get("recusados") or [])}
        aceitas = [l for i, l in enumerate(linhas) if i not in recusadas]
        devolvidas = [l for i, l in enumerate(linhas) if i in recusadas]

        self.fila.marcar_resumos(aceitas, estado=0)
        if devolvidas:
            self.fila.marcar_resumos(devolvidas, estado=2)
            _log.warning(
                "%d linha(s) de resumo recusada(s) pela nuvem: o critério ou "
                "o canal não é mais desta loja. Não serão reenviadas.",
                len(devolvidas),
            )

        # Veio lote cheio: ainda tem fila (a internet acabou de voltar), e a
        # próxima passada continua. Esvaziou: volta ao ritmo normal.
        if len(linhas) < LIMITE_DE_RESUMOS:
            self._proximo_resumo = agora + timedelta(minutes=INTERVALO_DE_RESUMO_MIN)
            self.fila.limpar_resumos(agora - timedelta(days=GUARDA_DO_RESUMO_DIAS))
        return len(aceitas)

    def medir(self, agora: datetime | None = None) -> None:
        """Uma amostra do uso da máquina, somada na hora corrente.

        Medir nunca pode atrapalhar a auditoria: qualquer falha aqui vira
        uma linha de log, e a volta segue.
        """
        if self.medidor is None:
            return
        try:
            amostra = self.medidor.amostra()
            self.fila.somar_uso(agora or datetime.now(), amostra)
        except Exception:  # noqa: BLE001
            _log.exception("não consegui medir o uso da máquina; seguindo")
            return
        # A mesma medida alimenta o freio do vigia: máquina ocupada por
        # minutos, ele para; folgou, ele volta.
        if self.vigia is not None and self.vigia.freio.alimentar(getattr(amostra, "cpu", None)):
            if self.vigia.freio.puxado:
                _log.warning(
                    "vigia parado: o processador está acima de %g%% há minutos. "
                    "A auditoria segue no ritmo de rotina.", self.vigia.freio.parar_acima_de,
                )
            else:
                _log.info("vigia de volta: o processador folgou")

    def _subir_uso(self, agora: datetime) -> int:
        """Manda as horas de uso que a nuvem ainda não tem.

        Tudo ou nada: a nuvem não recusa uma hora e aceita outra (não há
        critério nem canal envolvido). Pedido que falhou não marca nada.
        """
        if self.medidor is None:
            return 0
        if self._uso_suspenso_ate is not None and agora < self._uso_suspenso_ate:
            return 0
        if self._proximo_uso is not None and agora < self._proximo_uso:
            return 0

        linhas = self.fila.usos_a_subir(LIMITE_DE_RESUMOS)
        if not linhas:
            return 0
        try:
            self.cliente._pedir(
                "POST",
                "/v1/uso",
                {
                    "maquina": maquina_para_nuvem(self.medidor.pecas()),
                    "horas": [uso_para_nuvem(l) for l in linhas],
                },
            )
        except ErroDaNuvem as e:
            if not e.recuperavel:
                # Nuvem sem a rota (versão anterior) ou corpo recusado:
                # insistir a cada volta não muda a resposta.
                self._uso_suspenso_ate = agora + timedelta(minutes=PAUSA_APOS_RECUSA_MIN)
            if str(e) != self._erro_de_uso:
                self._erro_de_uso = str(e)
                _log.warning(
                    "o uso da máquina ficou sem subir: %s — fica guardado e sobe "
                    "quando a nuvem aceitar",
                    e,
                )
            return 0

        if self._erro_de_uso is not None:
            _log.info("a nuvem voltou a aceitar o uso da máquina")
        self._erro_de_uso = None
        self._uso_suspenso_ate = None
        self.fila.marcar_usos(linhas)
        if len(linhas) < LIMITE_DE_RESUMOS:
            self._proximo_uso = agora + timedelta(minutes=INTERVALO_DE_RESUMO_MIN)
            self.fila.limpar_usos(agora - timedelta(days=GUARDA_DO_RESUMO_DIAS))
        return len(linhas)

    def limpar(self, agora: datetime | None = None) -> int:
        """Tira do disco as análises encerradas há mais que a guarda, e as imagens delas.

        De hora em hora, no máximo. Limpar nunca pode atrapalhar a
        auditoria: qualquer falha aqui vira uma linha de log, e a volta
        segue — e a próxima tentativa fica para a hora seguinte, não para a
        volta seguinte.
        """
        agora = agora or datetime.now()
        if self._proxima_limpeza is not None and agora < self._proxima_limpeza:
            return 0
        self._proxima_limpeza = agora + timedelta(minutes=INTERVALO_DA_LIMPEZA_MIN)
        try:
            saiu = self.fila.limpar_encerrados(agora - timedelta(days=GUARDA_DAS_ANALISES_DIAS))
        except Exception:  # noqa: BLE001
            _log.exception("a limpeza do disco falhou; a auditoria segue")
            return 0
        if saiu:
            _log.info(
                "limpeza: %d análise(s) encerrada(s) há mais de %d dias saíram do disco",
                saiu, GUARDA_DAS_ANALISES_DIAS,
            )
        return saiu

    def passo(self, agora: datetime | None = None) -> dict[str, int]:
        """Uma volta completa: mede a máquina, captura, julga, sobe — e, de hora em hora, limpa o disco."""
        agora = agora or datetime.now()
        self._buscar_padroes(agora)
        self.medir(agora)
        enfileirados = self.capturar(agora)
        alertas = self.julgar(agora)
        subidos = self.subir(agora)
        self.limpar(agora)
        return {
            "enfileirados": enfileirados,
            "alertas": len(alertas),
            "subidos": subidos,
        }

    def vigiar(self, agora: datetime | None = None) -> dict[str, int]:
        """Entre uma olhada e outra: onde a contagem mudou, olha agora.

        A olhada extra é uma olhada de verdade — fluxo principal, juiz,
        resumo e aviso —, mas só dos critérios de presença e de contagem
        daquele canal. O que pode ir à nuvem não é acordado.
        """
        agora = agora or datetime.now()
        nada = {"enfileirados": 0, "alertas": 0, "subidos": 0, "extras": 0}
        if self.vigia is None or self.motor is None:
            return nada
        canais = self.vigia.olhar(self.fontes, agora)
        if not canais:
            return nada

        total = 0
        for ponto_id in canais:
            fonte = self.fontes.get(ponto_id)
            if fonte is None:
                continue
            evento = EventoGatilho(ponto_id=ponto_id, ts=agora, origem="vigia")
            try:
                p = self.motor.preparar(
                    evento, fonte, contexto={"olhada_extra": True},
                    somente=lambda r: r.tipo in VIGIADOS and r.julga,
                )
            except Exception as e:  # noqa: BLE001
                _log.warning("olhada extra falhou no ponto %s: %s", ponto_id, e)
                continue
            total += len(p.enfileirados)
            self.vigia.anotar_olhada(ponto_id, fonte, agora)
        alertas = self.julgar(agora)
        subidos = self.subir(agora)
        return {"enfileirados": total, "alertas": len(alertas), "subidos": subidos, "extras": len(canais)}

    def refazer_bancada(self, agora: datetime | None = None) -> dict[str, int]:
        """Refaz a olhada que as mãos atrapalharam, assim que o quadro de bancada para.

        A olhada de rotina que achou movimento no quadro não saiu: ficou
        anotada no motor. Aqui, entre uma rotina e outra, o quadro que
        parou ganha a olhada dele — é o quadro de "as mãos saíram". Só os
        critérios que esperavam, naquele quadro: o resto do canal não é
        acordado. No máximo `MAX_REFEITAS_POR_VOLTA` tentativas por canal a
        cada volta de rotina.

        Cada tentativa abre o fluxo principal e entra no resumo da hora
        como uma olhada a mais daquele critério (a que as mãos seguraram
        ficou contada como "nada a conferir").
        """
        agora = agora or datetime.now()
        nada = {"enfileirados": 0, "alertas": 0, "subidos": 0, "refeitas": 0}
        if self.motor is None:
            return nada
        total = refeitas = 0
        for ponto_id, esperando in list(self.motor.esperando_as_maos.items()):
            prontos = {l for l in esperando if self.quietude.quieto(ponto_id, l.split("@", 1)[1]) is True}
            if not prontos or self._refeitas.get(ponto_id, 0) >= MAX_REFEITAS_POR_VOLTA:
                continue
            # Tiveram a vez delas: se a mão voltar no meio do caminho, o
            # motor anota de novo.
            esperando -= prontos
            fonte = self.fontes.get(ponto_id)
            if fonte is None:
                continue
            self._refeitas[ponto_id] = self._refeitas.get(ponto_id, 0) + 1
            evento = EventoGatilho(ponto_id=ponto_id, ts=agora, origem="bancada")
            try:
                p = self.motor.preparar(evento, fonte, somente=lambda r: f"{r.id}@{r.zona.id}" in prontos)
            except Exception as e:  # noqa: BLE001
                _log.warning("a olhada da bancada não foi refeita no ponto %s: %s", ponto_id, e)
                continue
            total += len(p.enfileirados)
            refeitas += 1
        if not refeitas:
            return nada
        alertas = self.julgar(agora)
        subidos = self.subir(agora)
        return {"enfileirados": total, "alertas": len(alertas), "subidos": subidos, "refeitas": refeitas}

    def volta(self, agora: datetime | None = None) -> dict[str, int]:
        """Uma volta do laço: a olhada de rotina quando é hora dela; senão, o vigia (na vez dele) e a bancada."""
        do_relogio = agora is None
        agora = agora or datetime.now()
        if self._proxima_rotina is None or agora >= self._proxima_rotina:
            r = self.passo(agora)
            # Conta a partir do FIM da passada, como sempre foi: passada
            # demorada (nuvem lenta) não encavala na seguinte. Com a hora
            # dada por quem chama (teste), o fim é a própria hora dada.
            fim = datetime.now() if do_relogio else agora
            self._proxima_rotina = fim + timedelta(seconds=self.intervalo_captura)
            self._proximo_vigia = fim + timedelta(seconds=self.intervalo_rapido)
            return r
        # O vigia tem o passo dele. Com uma olhada de bancada esperando, o
        # laço acorda de segundo em segundo — e chamar o vigia a cada vez
        # seria rodar o detector dele dez vezes mais.
        r = {"enfileirados": 0, "alertas": 0, "subidos": 0, "extras": 0}
        if self._proximo_vigia is None or agora >= self._proximo_vigia:
            r = self.vigiar(agora)
            fim = datetime.now() if do_relogio else agora
            self._proximo_vigia = fim + timedelta(seconds=self.intervalo_rapido)
        b = self.refazer_bancada(agora)
        return {
            "enfileirados": r["enfileirados"] + b["enfileirados"],
            "alertas": r["alertas"] + b["alertas"],
            "subidos": r["subidos"] + b["subidos"],
            "extras": r["extras"],
            "refeitas": b["refeitas"],
        }

    def _espera(self, agora: datetime) -> float:
        """Quanto o laço dorme: até a próxima rotina, a próxima vez do vigia ou a da bancada — o que vier antes."""
        ate_a_rotina = self.intervalo_captura
        if self._proxima_rotina is not None:
            ate_a_rotina = max(0.0, (self._proxima_rotina - agora).total_seconds())
        espera = ate_a_rotina
        vigiando = self.vigia is not None and bool(self.vigia.canais) and not self.vigia.freio.puxado
        if vigiando and self.intervalo_rapido > 0:
            ate_o_vigia = self.intervalo_rapido
            # O laço acordou para a bancada no meio da espera do vigia: falta só o resto dela.
            if self._proximo_vigia is not None and self._proximo_vigia > agora:
                ate_o_vigia = (self._proximo_vigia - agora).total_seconds()
            espera = min(espera, ate_o_vigia)
        # Com uma olhada de bancada esperando as mãos saírem, acorda logo:
        # o quadro quieto dura segundos.
        if self.motor is not None and any(self.motor.esperando_as_maos.values()):
            espera = min(espera, ESPERA_DA_BANCADA)
        return espera

    # ───────────────────────── thread própria ─────────────────────────

    def iniciar(self) -> None:
        """Roda em thread própria para não atrasar o heartbeat.

        Um julgamento na nuvem leva segundos; numa loja com várias regras,
        uma passada inteira pode levar minutos. Se isso rodasse no mesmo
        laço do heartbeat, o console veria o agente como caído enquanto
        ele estava trabalhando — o pior diagnóstico possível.
        """
        if self._thread is not None:
            return
        self._parar.clear()
        # A quietude mede em thread própria, de meio em meio segundo: sem
        # quadro de bancada para acompanhar, cada volta dela não faz nada.
        self.quietude.iniciar(lambda: self.fontes)
        self._thread = threading.Thread(
            target=self._laco, name="farol-auditoria", daemon=True
        )
        self._thread.start()

    def _laco(self) -> None:
        while not self._parar.is_set():
            try:
                r = self.volta()
                if r["alertas"]:
                    _log.info(
                        "%d alerta(s), %d subido(s)", r["alertas"], r["subidos"]
                    )
            except Exception:  # noqa: BLE001
                _log.exception("erro inesperado na auditoria; seguindo")
            self._parar.wait(self._espera(datetime.now()))

    def parar(self) -> None:
        self._parar.set()
        self.quietude.parar()
        if self._thread is not None:
            self._thread.join(timeout=5)
        if self.medidor is not None:
            self.medidor.fechar()
            self._thread = None
        self._fechar(self.fontes.values())
        self.fontes = {}
