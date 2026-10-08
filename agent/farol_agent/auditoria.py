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
from farol_agent.contrato import (
    evento_para_nuvem,
    maquina_para_nuvem,
    resumo_para_nuvem,
    uso_para_nuvem,
)
from farol_agent.fila import Fila
from farol_agent.modelos import EventoGatilho, TipoRegra
from farol_agent.motor import MotorDeRegras
from farol_agent.nuvem import ErroDaNuvem
from farol_agent.padroes import Padroes
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
        construir_fonte=None,
        construir_juiz=None,
        medidor="padrao",
    ) -> None:
        self.cliente = cliente
        self.fila = Fila(caminho_fila)
        self.intervalo_captura = intervalo_captura

        # Injetáveis para o teste não precisar de câmera nem de API.
        self._construir_fonte = construir_fonte or self._fonte_rtsp
        self._construir_juiz = construir_juiz or self._juiz_padrao

        self.motor: MotorDeRegras | None = None
        self.juiz = None
        # Quem confere se vale perguntar à nuvem. Um só para a vida do
        # processo (ver `_o_porteiro`). O detector dele é injetável.
        self._porteiro = None
        self._detector_do_porteiro = _detector_local
        # As fotos padrão dos canais, em disco, ao lado da fila. Quem
        # baixa é o cliente da nuvem; sem ele (teste, bancada), a loja
        # compara só com o que já tiver.
        self.padroes = Padroes(
            Path(self.fila.caminho).parent / "padroes", baixar=getattr(cliente, "baixar_padrao", None)
        )
        self._proxima_busca_de_padroes: datetime | None = None
        # Onde cada gravador escreve o relógio, por canal. Perguntado uma
        # vez por gravador; injetável para o teste não precisar de um.
        self._perguntar_relogios = _relogios_do_gravador
        self._relogios_por_gravador: dict[str, dict[int, tuple[float, float, float, float]]] = {}
        self.fontes: dict[str, Any] = {}
        self.versao_montada: int | None = None
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

        nuvem = None
        try:
            nuvem = JuizNuvem()
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
        return JuizPorRegra(seletor, {r.id: r for r in config.regras})

    def _relogios(self, config: ConfigDaLoja) -> dict[str, tuple[float, float, float, float]]:
        """Por canal, o retângulo em que o gravador escreve data e hora.

        Só pergunta quando alguém vai comparar com foto padrão, e só aos
        gravadores dos canais que têm foto. Gravador que não responde (ou
        que não é desta família) fica sem retângulo: a comparação segue,
        e área com o relógio dentro vai dar "diferente" — pergunta a
        mais, não veredito errado.
        """
        if not any(r.tipo is TipoRegra.COMPARACAO or r.com_padrao for r in config.regras):
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

    def montar(self, config: ConfigDaLoja) -> None:
        """(Re)constrói motor, juiz e fontes a partir da configuração."""
        if config.versao == self.versao_montada:
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
        # Com o serializador, o motor grava o corpo do evento na mesma
        # linha do alerta: é o que faz o evento sobreviver a internet fora.
        self.motor = MotorDeRegras(
            self.fila, regras, serializar=evento_para_nuvem, porteiro=self._o_porteiro(regras),
        )

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
        if self.juiz is None:
            return list(config.regras)

        seletor = getattr(self.juiz, "seletor", None)
        if seletor is None:
            return list(config.regras)

        from farol_agent.juizes.base import ErroDoJuiz

        servidas, orfas = [], []
        for r in config.regras:
            try:
                seletor.para(r)
                servidas.append(r)
            except ErroDoJuiz as e:
                orfas.append((r, str(e)))
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
            self.fila.somar_uso(agora or datetime.now(), self.medidor.amostra())
        except Exception:  # noqa: BLE001
            _log.exception("não consegui medir o uso da máquina; seguindo")

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

    def passo(self, agora: datetime | None = None) -> dict[str, int]:
        """Uma volta completa: mede a máquina, captura, julga, sobe."""
        agora = agora or datetime.now()
        self._buscar_padroes(agora)
        self.medir(agora)
        enfileirados = self.capturar(agora)
        alertas = self.julgar(agora)
        subidos = self.subir(agora)
        return {
            "enfileirados": enfileirados,
            "alertas": len(alertas),
            "subidos": subidos,
        }

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
        self._thread = threading.Thread(
            target=self._laco, name="farol-auditoria", daemon=True
        )
        self._thread.start()

    def _laco(self) -> None:
        while not self._parar.is_set():
            try:
                r = self.passo()
                if r["alertas"]:
                    _log.info(
                        "%d alerta(s), %d subido(s)", r["alertas"], r["subidos"]
                    )
            except Exception:  # noqa: BLE001
                _log.exception("erro inesperado na auditoria; seguindo")
            self._parar.wait(self.intervalo_captura)

    def parar(self) -> None:
        self._parar.set()
        if self._thread is not None:
            self._thread.join(timeout=5)
        if self.medidor is not None:
            self.medidor.fechar()
            self._thread = None
        self._fechar(self.fontes.values())
        self.fontes = {}
