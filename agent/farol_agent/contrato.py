"""O formato do evento que sobe para a nuvem.

Este arquivo existe por causa de um defeito que ficou semanas invisível
(ERR-018): o agente montava o evento com `idempotencia_key`, `regra_id`,
`ocorrido_em`, e a API validava `idempotenciaKey`, `regraId`, `ocorridoEm`.
Toda subida era recusada com 422. Os testes dos dois lados passavam, porque
cada lado era testado contra um dublê de si mesmo.

A correção não é só trocar os nomes. É ter **um arquivo de contrato que os
dois lados leem**: `contratos/evento-do-agente.json`, na raiz do
repositório. O teste do agente exige que `evento_para_nuvem` produza
exatamente aquele corpo; o teste da API manda aquele mesmo corpo e confere
coluna por coluna o que foi gravado. Mudar o formato de um lado só quebra o
teste do outro — que é o que deveria ter acontecido na primeira vez.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any


def instante_com_fuso(ts: datetime) -> str:
    """ISO 8601 COM deslocamento, sempre.

    O agente trabalha com a hora local da máquina, sem fuso (`datetime.now()`
    e o relógio do gravador). Mandar "2026-10-06T05:13:12" para a nuvem faz
    o Postgres ler como UTC, e o evento aparece no console três horas
    deslocado — num produto de auditoria, onde "a que horas foi" é metade da
    resposta.

    `astimezone()` num instante sem fuso assume o fuso da máquina e o
    escreve. A máquina da loja sabe a própria hora; a nuvem não tem como
    adivinhar.
    """
    if ts.tzinfo is None:
        ts = ts.astimezone()
    # Instante que já tem fuso sobe como veio: converter para o fuso da
    # máquina não mudaria o instante, só o texto — e o contrato compara texto.
    return ts.isoformat(timespec="seconds")


def evento_para_nuvem(alerta: Any) -> dict[str, Any]:
    """O corpo de UM evento em `POST /v1/eventos`.

    Recebe um `motor.Alerta`. As chaves são as do contrato; qualquer mudança
    aqui tem que acompanhar `contratos/evento-do-agente.json`.
    """
    v = alerta.veredito
    return {
        # Vem da FILA. Inventar uma chave aqui anularia a proteção contra
        # duplicata na retentativa.
        "idempotenciaKey": alerta.chave,
        "regraId": alerta.regra_id,
        # Em qual canal o critério foi verificado. Um critério pode valer
        # em vários canais, e aí a regra sozinha não diz onde foi.
        "zonaId": alerta.zona_id,
        # Qual redação do critério produziu este veredito.
        "criterioVersao": alerta.criterio_versao,
        # Qual cena foi julgada. Sem isto não há como agrupar vereditos
        # sobre a mesma imagem nem perceber quando o modelo muda de ideia.
        "imagemHash": alerta.imagem_hash,
        "ocorridoEm": instante_com_fuso(alerta.ts),
        "veredito": v.resultado.value,
        "confianca": alerta.confianca,
        "motivo": alerta.motivo,
        "modelo": v.modelo,
        "via": v.via.value if v.via else None,
        "tokensEntrada": v.tokens_entrada,
        "tokensSaida": v.tokens_saida,
        "custoCentavos": v.custo_centavos,
        "latenciaMs": v.latencia_ms,
    }
