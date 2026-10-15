"""Uma volta da gravação de treino, do começo ao fim (A21, fatia T3d-1).

Junta as fatias da parte da loja da T3, na ordem:

    perguntar (T3a) → apagar o que a nuvem mandou → a próxima gravação →
    buscar o trecho no gravador (T3b) → a captura densa (T3c-1) →
    os lanches (T3c-2) → o corpo de cada um e o envio (T3c-4) → pronta

e conta o andamento à nuvem em faixas: a busca vai até 50%, a captura densa até
70%, os lanches até 85%, o envio até 99%; "pronta" diz 100.

**Cada parada tem destino.** Fora da hora, gravador ocupado, gravação que ainda
não assentou, disco cheio ou nuvem fora do ar: a volta para, e a seguinte
retoma de onde parou (cada fatia guarda o que fez). Senha recusada, gravação
sem canal, ou o gravador sem nada daquele horário: a gravação falha, com o
motivo que a tela mostra. A nuvem diz que alguém cancelou (409): a loja para e
apaga o que guardou dela. A nuvem não conhece a gravação (404): esquece.

**O lanche enviado não é enviado de novo** (`enviados.json` na pasta da
gravação), nem depois de o agente reiniciar.

As peças que dependem da loja entram de fora (`Pecas`): o cliente da nuvem, o
cliente de arquivo do gravador do canal, a área de montagem do canal, o
detector, o perfil da bancada e as duas perguntas "pode buscar?" e "pode ler?"
— a hora é decisão do dono. Ligar isto no serviço do agente é a T3d-2.

**Dorme:** nada no agente chama este módulo ainda.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from farol_agent import treino, treino_corpo, treino_lanches, treino_quadros, treino_trecho
from farol_agent.dvr.dahua import ErroDoGravador
from farol_agent.modelos import Zona

_log = logging.getLogger(__name__)

ENVIADOS = "enviados.json"
DENSA = "densa"
LANCHES = "lanches"
# As faixas do andamento (a porcentagem que cada parte leva até o fim dela).
FAIXAS = {"busca": (0, 50), "densa": (50, 70), "lanches": (70, 85), "envio": (85, 99)}

# O que a volta fez (para o registro e para quem chama decidir quando voltar).
SEM_NUVEM = "sem_nuvem"
NADA = "nada_a_ler"
DEPOIS = "depois"
PRONTA = "pronta"
FALHOU = "falhou"
PAROU = "parou"  # a nuvem mandou parar (409) ou esquecer (404), ou a credencial não vale


@dataclass
class Pecas:
    """O que a volta precisa da loja."""

    nuvem: Any  # ClienteNuvem: gravacoes_de_treino, andamento_da_gravacao, lanche_de_treino
    gravador_do_canal: Callable[[int], Any]  # o cliente de arquivo do gravador daquele canal
    zona_do_canal: Callable[[int], Zona]  # a área de montagem do canal (o quadro de papel "montagem")
    # Nulo = este computador não tem o detector instalado, ou a loja ainda não tem o perfil da bancada: a gravação é
    # buscada, e falha na leitura com o motivo (a tela mostra).
    detector: treino_lanches.Detector | None
    perfil: treino_lanches.PerfilDaBancada | None
    pode_buscar: Callable[[], bool]
    pode_ler: Callable[[], bool]
    agora: Callable[[], datetime] = lambda: datetime.now(timezone.utc)
    # A hora do computador (sem fuso) e a conversão do instante para ela — o computador da loja está no fuso dela.
    hora_do_computador: Callable[[], datetime] = datetime.now
    para_o_computador: Callable[[datetime], datetime] = treino_trecho._local


def _faixa(parte: str, fracao: float) -> float:
    de, ate = FAIXAS[parte]
    return de + (ate - de) * max(0.0, min(1.0, fracao))


def _ler_enviados(pasta: Path) -> set[str]:
    try:
        bruto = json.loads((pasta / ENVIADOS).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return set()
    return {c for c in bruto if isinstance(c, str)} if isinstance(bruto, list) else set()


def _gravar_enviados(pasta: Path, enviados: set[str]) -> None:
    temporario = pasta / (ENVIADOS + ".novo")
    temporario.write_text(json.dumps(sorted(enviados)), encoding="utf-8")
    os.replace(temporario, pasta / ENVIADOS)


class _Parar(Exception):
    """A nuvem mandou parar (ou esquecer), ou a credencial não vale: a volta acaba aqui."""

    def __init__(self, destino: str):
        super().__init__(destino)
        self.destino = destino


def _contar(andamento: treino.Andamento, porcentagem: float) -> None:
    destino = andamento.lendo(porcentagem)
    if destino in (treino.PARAR, treino.ESQUECER, treino.CREDENCIAL):
        raise _Parar(destino)


def _encerrar(destino: str, raiz: Path, g: treino.Gravacao) -> str:
    # Cancelada no console, ou a gravação não é desta loja: o que se guardou dela sai do disco.
    if destino in (treino.PARAR, treino.ESQUECER):
        treino.apagar_do_disco(raiz, [g.chave])
    return PAROU


def volta(pecas: Pecas, raiz: Path, *, folga_s: float = treino.FOLGA_PADRAO_S) -> str:
    """Uma volta: no máximo uma gravação, até onde der agora. Devolve o que aconteceu."""
    raiz = Path(raiz)
    perguntado = treino.perguntar(pecas.nuvem.gravacoes_de_treino)
    if perguntado is None:
        return SEM_NUVEM
    gravacoes, apagar = perguntado
    treino.apagar_do_disco(raiz, apagar)
    g = treino.proxima(gravacoes, pecas.agora(), folga_s)
    if g is None:
        return NADA
    pasta = treino.pasta_da_gravacao(raiz, g.chave)
    if pasta is None:
        return NADA
    andamento = treino.Andamento(g, pecas.nuvem.andamento_da_gravacao)

    def falhar(motivo: str) -> str:
        destino = andamento.falhou(motivo)
        if destino in (treino.PARAR, treino.ESQUECER):
            return _encerrar(destino, raiz, g)
        return FALHOU

    try:
        # 1. o trecho, do gravador
        if not g.canal:
            return falhar("a gravação não diz de que canal é")
        busca = treino_trecho.buscar_trecho(
            pecas.gravador_do_canal(g.canal), g.canal, g.inicio, g.fim, pasta,
            pode_buscar=pecas.pode_buscar, ao_andar=lambda b: _contar(andamento, _faixa("busca", b.fracao)),
            agora=pecas.hora_do_computador, para_o_computador=pecas.para_o_computador,
        )
        if busca.parou == treino_trecho.SENHA_RECUSADA:
            return falhar("o gravador recusou a senha do agente")
        if not busca.completa:
            _log.info("treino: a busca da gravação %s parou (%s); continua na volta seguinte", g.chave, busca.parou)
            return DEPOIS
        if busca.ok == 0:
            return falhar("o gravador não tinha mais esse horário")
        # 2. a captura densa — com o adianto que a busca mediu (ou, se não ficou anotado, o de agora)
        adianto = treino_trecho.adianto_do_gravador(pasta)
        if adianto is None:
            try:
                adianto = pecas.gravador_do_canal(g.canal).relogio().total_seconds()
            except ErroDoGravador:
                return DEPOIS
        densa = treino_quadros.densa_da_gravacao(
            treino_trecho.pedacos_baixados(pasta, g.canal), pecas.zona_do_canal(g.canal), pasta / DENSA,
            adianto_s=adianto, pode_seguir=pecas.pode_ler, ao_andar=lambda d: _contar(andamento, _faixa("densa", d.fracao)),
        )
        if not densa.completa:
            return DEPOIS
        # 3. os lanches (a leitura que já terminou não se repete: o detector em cada quadro pesa)
        resumo = treino_lanches.lanches_ja_lidos(pasta / LANCHES)
        if resumo is None:
            if pecas.detector is None:
                return falhar("o detector não está instalado neste computador (farol-agent detector instalar)")
            if pecas.perfil is None:
                return falhar("falta o perfil da bancada desta loja (os números da câmera, medidos na instalação)")
            if not pecas.pode_ler():
                return DEPOIS
            resumo = treino_lanches.lanches_da_densa(
                pasta / DENSA, pasta / LANCHES, pecas.detector, pecas.perfil, pode_seguir=pecas.pode_ler,
            )
            if resumo is None:
                return DEPOIS
        _contar(andamento, _faixa("lanches", 1.0))
        # 4. o corpo de cada lanche, e o envio
        lanches = [r for r in resumo if r.get("eLanche")]
        enviados = _ler_enviados(pasta)
        for i, r in enumerate(lanches, 1):
            chave = f"lanche-{int(r['lanche']):02d}"
            if chave in enviados:
                continue
            corpo = treino_corpo.corpo_do_lanche(g, r, pasta / LANCHES / r["pasta"])
            destino = treino_corpo.mandar(pecas.nuvem.lanche_de_treino, corpo)
            if destino == treino_corpo.ENCERRADA:
                return _encerrar(treino.PARAR, raiz, g)
            if destino == treino_corpo.DEPOIS:
                return DEPOIS
            # Enviado — ou recusado (422): não se repete.
            enviados.add(chave)
            _gravar_enviados(pasta, enviados)
            _contar(andamento, _faixa("envio", i / len(lanches)))
        destino = andamento.pronta()
        if destino in (treino.PARAR, treino.ESQUECER):
            return _encerrar(destino, raiz, g)
        if destino == treino.SEGUIR:
            return PRONTA
        return DEPOIS
    except _Parar as p:
        return _encerrar(p.destino, raiz, g)
