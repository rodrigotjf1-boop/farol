"""Quem julga o quê.

Duas coisas decidem, e nenhuma delas é preferência:

**1 · A categoria da regra.** `presenca`, `contagem` e `comparacao` são
100% locais por desenho — não porque seria caro mandá-las para fora, mas
porque mandar imagem de cozinha para fora o dia inteiro é exatamente o que
o produto promete não fazer. `estado` e `acao` podem usar a nuvem.

**2 · A prioridade.** `urgente` tem orçamento de dois segundos. Ida e volta
à internet não cabe nisso, nem com a melhor conexão da rua — então regra
urgente é local, sempre, qualquer que seja o modo da loja.

`loja.modo_julgamento` só decide o que sobra: o que poderia ir para a
nuvem, vai?

    nuvem    — `estado` e `acao` não urgentes vão para a API
    local    — nada sai da loja
    hibrido  — tenta local e cai para a nuvem quando o local não responde

O modo **não** consegue mandar `presenca` para a nuvem, nem mandar uma
regra urgente para fora. Isso é limite de desenho, não configuração — se
fosse configurável, um dia alguém configuraria errado.
"""

from __future__ import annotations

from pathlib import Path

import logging
from typing import Any

from farol_agent.juizes.base import ErroDoJuiz, Juiz
from farol_agent.modelos import Prioridade, Regra, TipoRegra, Veredito

_log = logging.getLogger(__name__)

MODOS = ("nuvem", "local", "hibrido")

# As que nunca saem da loja.
SEMPRE_LOCAIS = (TipoRegra.PRESENCA, TipoRegra.CONTAGEM, TipoRegra.COMPARACAO)


class SeletorDeJuiz:
    def __init__(
        self,
        modo: str = "hibrido",
        *,
        nuvem: Juiz | None = None,
        local: Juiz | None = None,
        comparacao: Juiz | None = None,
        binario: Juiz | None = None,
        detector: Juiz | None = None,
    ) -> None:
        if modo not in MODOS:
            raise ValueError(f"modo_julgamento inválido: {modo!r}. Válidos: {MODOS}")
        self.modo = modo
        self.nuvem = nuvem
        self.local = local
        self.comparacao = comparacao
        self.binario = binario
        self.detector = detector

    def para(self, regra: Regra) -> Juiz:
        """O juiz desta regra, ou erro dizendo o que falta configurar."""
        if regra.tipo is TipoRegra.COMPARACAO:
            return self._exigir(self.comparacao, "comparacao", regra)

        if regra.tipo in SEMPRE_LOCAIS:
            # Presença e contagem têm um juiz feito para elas: o detector.
            # Ele não lê o texto do critério — precisa dos campos da regra.
            # A pergunta "esta regra tem os campos?" é feita AQUI, na
            # montagem, e não na hora de julgar: senão o agente capturaria,
            # gravaria e falharia a cada ciclo (ERR-014).
            reserva = self.binario or self.local
            if self.detector is not None:
                try:
                    self.detector.atende(regra.parametros)
                    return self.detector
                except ErroDoJuiz as e:
                    if reserva is None:
                        raise ErroDoJuiz(str(e), recuperavel=False) from None
            return self._exigir(reserva, "detector, binario ou local", regra)

        # Daqui para baixo é `estado` ou `acao`.
        if regra.prioridade is Prioridade.URGENTE:
            juiz = self.binario or self.local
            return self._exigir(juiz, "binario ou local (regra urgente)", regra)

        if self.modo == "local":
            return self._exigir(self.local, "local (loja em modo local)", regra)

        if self.modo == "nuvem":
            return self._exigir(self.nuvem, "nuvem (loja em modo nuvem)", regra)

        # Híbrido: local na frente, nuvem como rede de segurança.
        juiz = self.local or self.nuvem
        return self._exigir(juiz, "local ou nuvem", regra)

    @staticmethod
    def _exigir(juiz: Juiz | None, qual: str, regra: Regra) -> Juiz:
        if juiz is None:
            raise ErroDoJuiz(
                f"regra {regra.id} ({regra.tipo.value}/{regra.prioridade.value}) "
                f"precisa do juiz {qual}, que não está configurado",
                recuperavel=False,
            )
        return juiz


class JuizPorRegra:
    """Adapta o seletor ao contrato `Juiz`, para o motor não mudar.

    O motor chama `juiz.julgar(imagem, criterio, contexto)` e não precisa
    saber que há quatro juízes atrás. A regra viaja pelo contexto porque é
    o único canal que o contrato já oferece — mexer no contrato só por
    isso espalharia a mudança por tudo.
    """

    nome = "por-regra"

    def __init__(self, seletor: SeletorDeJuiz, regras: dict[str, Regra]) -> None:
        self.seletor = seletor
        self.regras = regras

    def julgar(
        self,
        imagem,
        criterio: str,
        *,
        contexto: dict[str, Any] | None = None,
        referencias: list[Path] | None = None,
    ) -> Veredito:
        ctx = contexto or {}
        regra_id = ctx.get("regra_id")
        regra = self.regras.get(str(regra_id)) if regra_id else None
        if regra is None:
            raise ErroDoJuiz(
                f"contexto sem regra_id utilizável ({regra_id!r}): "
                "não dá para escolher o juiz",
                recuperavel=False,
            )
        juiz = self.seletor.para(regra)
        _log.debug("regra %s julgada por %s", regra.id, juiz.nome)
        # Os campos da regra viajam pelo contexto, como o `regra_id`: é o
        # canal que o contrato do juiz já tem. Sempre os da regra de AGORA,
        # nunca os que foram enfileirados — se o dono corrigiu "o que
        # procurar", a análise que estava na fila já usa a correção.
        if regra.parametros:
            ctx = {**ctx, "parametros": regra.parametros}
        return juiz.julgar(imagem, criterio, contexto=ctx)
