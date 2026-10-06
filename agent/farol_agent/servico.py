"""O laço do agente: bate na nuvem, atende comando, segue a vida.

É aqui que a descida da configuração e o canal de volta viram
comportamento. O laço é deliberadamente burro e previsível:

    bater → a configuração mudou? puxa. Veio comando? atende. Dorme.

**Nada aqui pode derrubar o agente.** Rede caída, token recusado, câmera
sem responder, comando desconhecido: tudo vira registro e o laço continua.
Um agente que morre por causa de um comando mal formado deixa a loja sem
auditoria até alguém notar — e ninguém nota um processo parado numa
máquina de cozinha.

**Todo comando responde, inclusive o que falhou.** Comando que fracassa
em silêncio deixa a tela do console girando, e quem está lá não consegue
distinguir "a câmera caiu" de "o agente nem recebeu".
"""

from __future__ import annotations

import logging
import time
from typing import Any

from farol_agent import cofre, perfis, preview
from farol_agent.configuracao import PontoConfig, Sincronizador
from farol_agent.nuvem import ErroDaNuvem

_log = logging.getLogger(__name__)

INTERVALO_PADRAO = 10.0


class ErroDoComando(Exception):
    """Falha ao atender um comando. Vira mensagem para o console."""


def url_do_ponto(ponto: PontoConfig, *, sub: bool = False) -> str:
    """A URL RTSP do canal, com a senha vinda do cofre LOCAL.

    A senha nunca desce da nuvem: a configuração traz `usuario` e
    `segredo_ref`, e o valor sai daqui. A URL montada **não** é registrada
    em lugar nenhum — ela contém a senha embutida.
    """
    senha = cofre.resolver(ponto.segredo_ref)

    perfil = perfis.achar(ponto.fabricante or "intelbras")
    if perfil is None:
        raise ErroDoComando(
            f"não conheço o fabricante {ponto.fabricante!r} e não há perfil genérico"
        )
    if not ponto.host or not ponto.canal:
        raise ErroDoComando(
            f"ponto {ponto.nome!r} sem host ou canal: complete o cadastro no console"
        )

    return perfil.url(
        host=ponto.host,
        usuario=ponto.usuario or "admin",
        senha=senha,
        canal=int(ponto.canal),
        porta=ponto.porta,
        sub=sub,
    )


def capturar_quadro(ponto: PontoConfig) -> dict[str, Any]:
    """Atende `capturar_quadro`: um quadro do canal, pronto para subir.

    Abre o **main-stream**, não o sub: este quadro informa `resolucao_h`
    à nuvem, e o sub faria o sistema acreditar que o canal entrega menos
    do que entrega — o motor de dimensionamento passaria a recusar regras
    que a câmera sustenta.

    Abre e fecha na hora. Manter o main aberto por causa de um preview
    ocupa um dos poucos fluxos simultâneos que o gravador aceita, e esse
    fluxo faz falta à análise.
    """
    from farol_agent.fontes.rtsp import ErroDaFonte, FonteRTSP

    fonte = FonteRTSP(ponto.id, url_do_ponto(ponto), abrir_sub=False)
    try:
        q = preview.capturar(fonte)
    except (preview.ErroDoPreview, ErroDaFonte) as e:
        raise ErroDoComando(str(e)) from None
    finally:
        fechar = getattr(fonte, "fechar", None)
        if callable(fechar):
            fechar()

    _log.info(
        "preview do ponto %s: %dx%d, %d kB, %d ms%s",
        ponto.nome, q.largura, q.altura, q.bytes // 1024, q.ms,
        ", rosto borrado" if q.rosto_borrado else "",
    )
    return {
        "imagemBase64": q.imagem_base64,
        "tipo": q.tipo,
        "largura": q.largura,
        "altura": q.altura,
    }


def atender(comando: dict[str, Any], sincronizador: Sincronizador) -> dict[str, Any]:
    """Executa um comando e devolve o corpo da resposta à nuvem."""
    tipo = comando.get("tipo")

    if tipo != "capturar_quadro":
        # Comando que esta versão não conhece: a nuvem é mais nova que o
        # agente. Responder o motivo é melhor que ignorar — ignorar deixa
        # o console esperando por algo que nunca virá.
        raise ErroDoComando(
            f"comando {tipo!r} desconhecido nesta versão do agente"
        )

    if sincronizador.config is None:
        raise ErroDoComando("o agente ainda não tem configuração da loja")

    ponto_id = comando.get("pontoId")
    ponto = sincronizador.config.ponto(str(ponto_id))
    if ponto is None:
        # A configuração local está atrás da nuvem — o ponto foi criado
        # agora. Puxar e tentar de novo custa uma requisição e resolve o
        # caso mais comum: cadastrar a câmera e pedir o preview em
        # seguida.
        sincronizador.puxar()
        ponto = (
            sincronizador.config.ponto(str(ponto_id))
            if sincronizador.config
            else None
        )
    if ponto is None:
        raise ErroDoComando(f"não tenho o ponto {ponto_id} na configuração")

    return capturar_quadro(ponto)


def passo(sincronizador: Sincronizador, cliente) -> int:
    """Uma volta do laço. Devolve quantos comandos foram atendidos."""
    comandos = sincronizador.bater()

    for comando in comandos:
        cid = str(comando.get("id"))
        try:
            resultado = atender(comando, sincronizador)
        except ErroDoComando as e:
            _log.warning("comando %s falhou: %s", cid, e)
            _responder(cliente, cid, erro=str(e))
            continue
        except Exception as e:  # noqa: BLE001
            # Rede do gravador, OpenCV, disco: o que for. O laço não pode
            # morrer por um comando, e o console precisa saber o motivo.
            _log.exception("comando %s estourou", cid)
            _responder(cliente, cid, erro=f"{type(e).__name__}: {e}")
            continue

        _responder(cliente, cid, resultado=resultado)

    return len(comandos)


def _responder(cliente, comando_id: str, *, resultado=None, erro=None) -> None:
    """Entrega o resultado. Falhar aqui não derruba o laço.

    Se a resposta se perder, a nuvem mantém o comando como `entregue` e o
    usuário vê o pedido parado — chato, mas recuperável clicando de novo.
    Derrubar o agente seria pior.
    """
    try:
        cliente.responder(comando_id, resultado=resultado, erro=erro)
    except ErroDaNuvem as e:
        _log.error("não consegui responder o comando %s: %s", comando_id, e)


def laco(
    sincronizador: Sincronizador,
    cliente,
    *,
    intervalo: float = INTERVALO_PADRAO,
    voltas: int | None = None,
) -> None:
    """Roda até pararem. `voltas` existe para o teste não rodar para sempre."""
    n = 0
    while voltas is None or n < voltas:
        try:
            passo(sincronizador, cliente)
        except Exception:  # noqa: BLE001
            # Último anteparo. Chegar aqui é defeito, mas um defeito não
            # pode deixar a loja sem auditoria até alguém reiniciar.
            _log.exception("erro inesperado no laço; seguindo")
        n += 1
        if voltas is None or n < voltas:
            time.sleep(intervalo)
