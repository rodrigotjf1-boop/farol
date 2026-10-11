"""Olhar para trás NO GRAVADOR: a busca pelo meio e a grade, com o que ele gravou.

`busca.py` e `grade.py` são contas: não sabem de gravador. Aqui elas ganham
o gravador da loja — e as três regras que ele impõe:

1. **A hora é a dele.** Quem chama fala no relógio do computador (é nele que
   as olhadas são marcadas); o pedido vai na hora do gravador, e o que volta
   é devolvido no relógio do computador. A diferença é a que o cliente de
   arquivo mede.
2. **Só se pede o que já assentou.** A gravação recente vem cortada, com o
   tamanho declarado batendo (medido em 10/10/2026: `docs/teste-das-fichas.md`,
   "O que o gravador entrega, medido de novo"). Antes de o último bloco de
   que a busca pode precisar ter a idade do perfil (`atraso_s`), nenhum
   pedido sai: sobe `AindaNaoAssentou`, com quanto falta.
3. **O que voltou é conferido pelos quadros.** Trecho com menos quadros do
   que o gravador grava naquele tempo não é lido: sobe `TrechoIncompleto`,
   e quem chama pede de novo mais tarde.

As duas são `VoltarDepois`: não são erro do gravador, são "ainda não". Quem
chama guarda o que queria olhar e tenta de novo depois de `espera_s`.

Um pedido por vez por gravador, e pedido recusado não se repete: isso é do
cliente de arquivo (`dvr.arquivo`), e vale aqui sem nada a mais.

## O perfil envelhece

No gravador da loja de teste, o começo dos blocos mudou de um dia para o
outro (medido em 10/10/2026: segundo par; em 11/10: ímpar — o porquê não foi
conferido). Com o perfil velho, o bloco pedido cai entre dois blocos de
verdade: o gravador responde sem gravação (`SemGravacao`), e uma janela de
vários blocos volta com um bloco a menos (`TrechoIncompleto`). **Trecho que
já assentou e volta assim é sinal de medir o gravador de novo**
(`perfil.medir`) antes de concluir que não há gravação. Essa decisão é de
quem chama — que ainda não existe.

**Tudo isto dorme:** nada no agente chama este módulo ainda.
"""

from __future__ import annotations

import uuid
from dataclasses import replace
from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable

from farol_agent.dvr.arquivo import MAIOR_TRECHO, ClienteDeArquivo, inicio_do_bloco, pedido_que_cobre
from farol_agent.dvr.dahua import ErroDoGravador
from farol_agent.sequencia import bloco
from farol_agent.sequencia.bloco import REGUA_DE_FABRICA, Caixa, Regua, TrechoIlegivel
from farol_agent.sequencia.busca import MAX_PASSOS, Lado, Leitura, Resultado, buscar
from farol_agent.sequencia.grade import COLUNAS, QUADROS_DA_GRADE, Grade, GradeIncompleta, grade_do_trecho
from farol_agent.sequencia.perfil import _apagar

# Quanto esperar antes de pedir de novo o trecho que veio cortado. É a mesma
# espera das outras coisas que o agente tenta de novo (um minuto), não medida
# de aparelho: quem diz se já dá é a conta dos quadros, na tentativa seguinte.
ESPERA_DO_INCOMPLETO = 60.0


class VoltarDepois(Exception):
    """Ainda não dá para olhar. Não é erro: é para tentar de novo depois de `espera_s`."""

    def __init__(self, mensagem: str, espera_s: float) -> None:
        super().__init__(mensagem)
        self.espera_s = espera_s


class AindaNaoAssentou(VoltarDepois):
    """A gravação do trecho ainda não tem a idade em que o gravador a entrega inteira. Nenhum pedido foi feito."""


class TrechoIncompleto(VoltarDepois):
    """O trecho voltou com menos quadros do que devia (ou o leitor nem o abriu)."""


class SemPerfil(ErroDoGravador):
    """O gravador ainda não foi medido: sem o tamanho do bloco dele, não há como buscar pelo meio."""


def _exigir_perfil(cliente: ClienteDeArquivo) -> int:
    bloco_s = cliente.perfil.bloco_s
    if bloco_s is None:
        raise SemPerfil(
            f"o gravador {cliente.host} ainda não foi medido: não sei em que blocos ele entrega a gravação",
            dica="a medida do gravador (sequencia.perfil.medir) roda uma vez por aparelho",
        )
    return bloco_s


def _esperar_assentar(cliente: ClienteDeArquivo, fim_no_gravador: datetime, agora_no_gravador: datetime) -> None:
    if not cliente.ja_gravado(fim_no_gravador, agora_no_gravador):
        falta = cliente.espera_ate_gravar(fim_no_gravador, agora_no_gravador)
        raise AindaNaoAssentou(f"a gravação desse trecho ainda não assentou no gravador: faltam {falta:g} s", falta)


def _esperados(de: datetime, ate: datetime, qps: float | None) -> int | None:
    return None if qps is None or qps <= 0 else round((ate - de).total_seconds() * qps)


class LeitorDeBlocos:
    """Lê um bloco do gravador e escolhe o quadro parado dele. É o `ler` da busca pelo meio.

    Fala no relógio do GRAVADOR, e não confere se a gravação assentou: isso é
    de quem começa a busca (`buscar_no_gravador`). O arquivo do bloco passa
    por `pasta` e é apagado, dê certo ou não.
    """

    def __init__(
        self, cliente: ClienteDeArquivo, canal: int, pasta: Path, *, caixa: Caixa | None = None,
        regua: Regua = REGUA_DE_FABRICA,
    ) -> None:
        self.cliente, self.canal, self.pasta, self.caixa, self.regua = cliente, canal, Path(pasta), caixa, regua

    def __call__(self, comeco: datetime) -> Leitura:
        perfil = self.cliente.perfil
        fim = comeco + timedelta(seconds=_exigir_perfil(self.cliente))
        destino = self.pasta / f"busca-{self.canal}-{uuid.uuid4().hex[:8]}.dav"
        try:
            trecho = self.cliente.baixar(self.canal, comeco, fim, destino)
            try:
                escolha = bloco.escolher_quadro_parado(
                    trecho.caminho, trecho.de, trecho.ate, qps=perfil.qps, caixa=self.caixa, regua=self.regua,
                )
            except TrechoIlegivel:
                raise TrechoIncompleto(
                    f"o leitor de vídeo não abriu o bloco das {comeco:%H:%M:%S}", ESPERA_DO_INCOMPLETO,
                ) from None
        finally:
            _apagar(destino)
        if escolha.inteiro is False:
            raise TrechoIncompleto(
                f"o bloco das {comeco:%H:%M:%S} veio com {escolha.quadros} de {escolha.esperados} quadros",
                ESPERA_DO_INCOMPLETO,
            )
        return Leitura(de=trecho.de, ate=trecho.ate, escolha=escolha)


def buscar_no_gravador(
    cliente: ClienteDeArquivo,
    canal: int,
    pasta: Path,
    de: datetime,
    ate: datetime,
    julgar: Callable[[Leitura], Lado],
    *,
    caixa: Caixa | None = None,
    regua: Regua = REGUA_DE_FABRICA,
    max_passos: int = MAX_PASSOS,
    agora: Callable[[], datetime] = datetime.now,
) -> Resultado:
    """A busca pelo meio entre duas olhadas, no que o gravador gravou do canal.

    `de` e `ate` são os instantes das duas olhadas, **no relógio do
    computador**; o resultado volta no mesmo relógio, e é nele que `julgar`
    recebe cada leitura. `caixa` é o alvo (onde medir o movimento); `regua`,
    a da câmera.

    Levanta `SemPerfil` (gravador não medido), `AindaNaoAssentou` (cedo
    demais: nada foi pedido) e `TrechoIncompleto` (um bloco voltou cortado).
    Erro do gravador sobe como está.
    """
    bloco_s = _exigir_perfil(cliente)
    if ate <= de:
        raise ValueError("a ponta de depois vem depois da de antes")
    desvio_s = cliente.perfil.desvio_s
    diferenca = cliente.relogio()
    de_la, ate_la = de + diferenca, ate + diferenca
    # O último bloco que a busca pode ler é o do último instante antes de `ate`.
    ultimo = inicio_do_bloco(ate_la - timedelta(microseconds=1), bloco_s, desvio_s) + timedelta(seconds=bloco_s)
    _esperar_assentar(cliente, ultimo, agora() + diferenca)

    def julgar_no_relogio_daqui(leitura: Leitura) -> Lado:
        return julgar(_leitura_daqui(leitura, diferenca))

    leitor = LeitorDeBlocos(cliente, canal, pasta, caixa=caixa, regua=regua)
    r = buscar(leitor, julgar_no_relogio_daqui, de_la, ate_la, bloco_s=bloco_s, desvio_s=desvio_s, max_passos=max_passos)
    return replace(
        r,
        de=r.de - diferenca,
        ate=r.ate - diferenca,
        instante=None if r.instante is None else r.instante - diferenca,
        janela=None if r.janela is None else (r.janela[0] - diferenca, r.janela[1] - diferenca),
        passos=tuple(replace(p, de=p.de - diferenca, ate=p.ate - diferenca, ts=p.ts - diferenca) for p in r.passos),
    )


def _leitura_daqui(leitura: Leitura, diferenca: timedelta) -> Leitura:
    return Leitura(
        de=leitura.de - diferenca, ate=leitura.ate - diferenca,
        escolha=replace(leitura.escolha, ts=leitura.escolha.ts - diferenca),
    )


def grade_do_gravador(
    cliente: ClienteDeArquivo,
    canal: int,
    pasta: Path,
    janela: tuple[datetime, datetime],
    *,
    caixa: Caixa | None = None,
    quantos: int = QUADROS_DA_GRADE,
    colunas: int = COLUNAS,
    agora: Callable[[], datetime] = datetime.now,
) -> Grade:
    """A grade de quadros numerados da `janela` (no relógio do computador), tirada do que o gravador gravou.

    Um pedido só ao gravador, com a janela inteira — que tem de caber no
    maior trecho que o cliente pede de uma vez. Os instantes da grade voltam
    no relógio do computador.

    Levanta o mesmo que a busca: `SemPerfil`, `AindaNaoAssentou` e
    `TrechoIncompleto`.
    """
    bloco_s = _exigir_perfil(cliente)
    de, ate = janela
    if ate <= de:
        raise ValueError("a janela termina depois de começar")
    perfil = cliente.perfil
    diferenca = cliente.relogio()
    de_la, ate_la = de + diferenca, ate + diferenca
    pedido = pedido_que_cobre(de_la, ate_la, bloco_s, perfil.desvio_s)
    if pedido.cobre_ate - pedido.comeco > MAIOR_TRECHO:
        raise ValueError(f"a janela da grade cabe em {MAIOR_TRECHO.total_seconds():.0f} segundos de gravação")
    _esperar_assentar(cliente, pedido.cobre_ate, agora() + diferenca)

    destino = Path(pasta) / f"grade-{canal}-{uuid.uuid4().hex[:8]}.dav"
    try:
        trecho = cliente.baixar(canal, de_la, ate_la, destino)
        try:
            # O trecho inteiro primeiro: com quadro faltando no meio, o instante de cada quadro sairia errado.
            esperados = _esperados(trecho.de, trecho.ate, perfil.qps)
            vieram = bloco.contar_quadros(trecho.caminho)
            if vieram == 0:
                raise TrechoIlegivel("o leitor de vídeo não tirou quadro nenhum do trecho")
            if esperados is not None and vieram < esperados - 1:
                raise TrechoIncompleto(
                    f"a janela das {de_la:%H:%M:%S} veio com {vieram} de {esperados} quadros", ESPERA_DO_INCOMPLETO,
                )
            g = grade_do_trecho(
                trecho.caminho, trecho.de, trecho.ate, (de_la, ate_la), qps=perfil.qps, caixa=caixa,
                quantos=quantos, colunas=colunas,
            )
        except TrechoIlegivel:
            raise TrechoIncompleto(
                f"o leitor de vídeo não abriu a janela das {de_la:%H:%M:%S}", ESPERA_DO_INCOMPLETO,
            ) from None
        except GradeIncompleta as e:
            raise TrechoIncompleto(f"a janela das {de_la:%H:%M:%S}: {e}", ESPERA_DO_INCOMPLETO) from None
    finally:
        _apagar(destino)
    return replace(g, instantes=tuple(t - diferenca for t in g.instantes))
