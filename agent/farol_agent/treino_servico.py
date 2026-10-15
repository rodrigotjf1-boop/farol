"""A gravação de treino no serviço do agente (A21, fatia T3d-2).

Liga a volta (`treino_laco.volta`) numa linha de execução própria, como a
auditoria: uma volta, e outra logo depois enquanto há gravação a terminar; sem
nada a fazer (ou fora da hora), espera alguns minutos. As peças saem da
configuração em disco, a cada volta (a configuração muda com o console):

- **o gravador do canal**: o endereço e o usuário do ponto do canal, e a senha
  do cofre na hora do pedido (nunca guardada no objeto); o perfil de arquivo
  que a loja mediu daquele gravador (`sequencia.perfil`) — sem perfil medido,
  o pedido vai sem bloco e com a espera de cautela;
- **a área de montagem do canal** (o quadro de papel "montagem");
- **o detector da auditoria** — o mesmo, carregado uma vez por processo;
- **o perfil da bancada da loja** (`perfil_da_bancada.json`, ao lado da
  configuração): os números da câmera, medidos na instalação;
- **a hora de buscar e de ler: com a loja FECHADA**, pelo horário de
  funcionamento que vem na configuração. A placa da loja de teste é de
  10 Mbit/s e o computador é também o servidor local do Regem: nada disso
  disputa o expediente. **A hora é decisão do dono.** Loja sem horário
  cadastrado não busca (e o registro diz por quê, uma vez).

Sem o detector ou sem o perfil da bancada, a gravação não fica presa: falha na
leitura, com o motivo que a tela mostra.
"""

from __future__ import annotations

import json
import logging
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from farol_agent import cofre, treino_laco
from farol_agent.configuracao import _janelas, ler_do_disco
from farol_agent.dvr.arquivo import ClienteDeArquivo, PerfilDeArquivo
from farol_agent.gravacao_lida import quadro_do_canal
from farol_agent.modelos import Janela
from farol_agent.sequencia import perfil as perfis
from farol_agent.treino_lanches import PerfilDaBancada

_log = logging.getLogger(__name__)

PERFIL_DA_BANCADA = "perfil_da_bancada.json"
# Sem nada a fazer (ou fora da hora): a volta seguinte, em 5 minutos.
PAUSA_S = 300.0
# Com gravação terminando (pronta, falhou, parou): a seguinte logo depois.
CURTA_S = 5.0


def perfil_da_bancada(caminho_config: str | Path) -> PerfilDaBancada | None:
    """O perfil da bancada da loja, ao lado da configuração. Nulo se não há (ou se está torto)."""
    arquivo = Path(caminho_config).parent / PERFIL_DA_BANCADA
    if not arquivo.is_file():
        return None
    try:
        return PerfilDaBancada.de_json(json.loads(arquivo.read_text(encoding="utf-8")))
    except (ValueError, KeyError, TypeError) as e:
        _log.warning("treino: o perfil da bancada em %s está torto (%s); a leitura espera ele", arquivo.name, type(e).__name__)
        return None


def janelas_da_loja(config_json: dict[str, Any]) -> list[Janela]:
    return _janelas((config_json.get("loja") or {}).get("horarioFuncionamento"))


def loja_fechada(janelas: list[Janela], agora: datetime) -> bool | None:
    """A loja está fechada agora? Nulo quando ela não tem horário cadastrado (não se sabe)."""
    if not janelas:
        return None
    return not any(j.contem(agora) for j in janelas)


def _detector_da_auditoria():
    from farol_agent import auditoria

    juiz = auditoria._detector_local()
    return getattr(juiz, "motor", None) if juiz is not None else None


class TreinoEmFundo:
    """A gravação de treino numa linha de execução própria do serviço."""

    def __init__(
        self,
        cliente,
        caminho_config: str | Path,
        *,
        raiz: str | Path | None = None,
        detector_de: Callable[[], Any] = _detector_da_auditoria,
        relogio: Callable[[], datetime] = datetime.now,
        pausa_s: float = PAUSA_S,
        curta_s: float = CURTA_S,
    ) -> None:
        self.cliente = cliente
        self.caminho_config = Path(caminho_config)
        self.raiz = Path(raiz) if raiz is not None else self.caminho_config.parent / "treino"
        self._detector_de = detector_de
        self._relogio = relogio
        self.pausa_s, self.curta_s = pausa_s, curta_s
        self._parar = threading.Event()
        self._linha: threading.Thread | None = None
        self._avisou_sem_horario = False

    # ───────────────────────────── as peças ─────────────────────────────

    def _gravador(self, config_json: dict[str, Any], canal: int) -> ClienteDeArquivo:
        ponto = next((p for p in config_json.get("pontos") or [] if p.get("canal") == canal), None)
        if ponto is None or not ponto.get("host"):
            raise ValueError(f"o canal {canal} não tem gravador na configuração")
        medido = perfis.ler(perfis.arquivo_ao_lado(self.caminho_config), ponto["host"])
        ref = ponto.get("segredoRef")
        return ClienteDeArquivo(
            ponto["host"], ponto.get("usuario") or "", lambda: cofre.resolver(ref), perfil=medido or PerfilDeArquivo(),
        )

    def pode(self, janelas: list[Janela]) -> bool:
        fechada = loja_fechada(janelas, self._relogio())
        if fechada is None:
            if not self._avisou_sem_horario:
                _log.info("treino: a loja não tem horário de funcionamento cadastrado; a busca no gravador espera ele")
                self._avisou_sem_horario = True
            return False
        return fechada

    def pecas(self) -> treino_laco.Pecas | None:
        """As peças da volta, da configuração em disco. Nulo sem configuração."""
        config_json = ler_do_disco(self.caminho_config)
        if not config_json:
            return None
        janelas = janelas_da_loja(config_json)
        return treino_laco.Pecas(
            nuvem=self.cliente,
            gravador_do_canal=lambda canal: self._gravador(config_json, canal),
            zona_do_canal=lambda canal: quadro_do_canal(config_json, canal)[1],
            detector=self._detector_de(),
            perfil=perfil_da_bancada(self.caminho_config),
            pode_buscar=lambda: self.pode(janelas),
            pode_ler=lambda: self.pode(janelas),
        )

    # ───────────────────────────── a volta ─────────────────────────────

    def uma_volta(self) -> str:
        pecas = self.pecas()
        if pecas is None:
            return treino_laco.NADA
        return treino_laco.volta(pecas, self.raiz)

    def _rodar(self) -> None:
        while not self._parar.is_set():
            try:
                r = self.uma_volta()
            except Exception:  # noqa: BLE001 — um defeito numa volta não pode parar o treino até alguém reiniciar
                _log.exception("treino: erro inesperado na volta; sigo")
                r = "erro"
            if r not in (treino_laco.NADA, treino_laco.SEM_NUVEM):
                _log.info("treino: volta — %s", r)
            espera = self.curta_s if r in (treino_laco.PRONTA, treino_laco.FALHOU, treino_laco.PAROU) else self.pausa_s
            self._parar.wait(espera)

    def iniciar(self) -> None:
        if self._linha is not None:
            return
        self._parar.clear()
        self._linha = threading.Thread(target=self._rodar, name="farol-treino", daemon=True)
        self._linha.start()

    def parar(self, espera_s: float = 10.0) -> None:
        self._parar.set()
        if self._linha is not None:
            self._linha.join(espera_s)
            self._linha = None
