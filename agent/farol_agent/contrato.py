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


def _instante(texto: str | None) -> str | None:
    return instante_com_fuso(datetime.fromisoformat(texto)) if texto else None


def resumo_para_nuvem(linha: dict[str, Any]) -> dict[str, Any]:
    """O corpo de UMA linha em `POST /v1/resumos`.

    Recebe uma linha de `fila.resumos_a_subir()`. As chaves são as de
    `contratos/resumo-do-agente.json`, lido também pelo teste da API.

    Os números sobem ABSOLUTOS, não como diferença desde a última subida:
    a mesma linha pode subir dez vezes ao longo da hora, e um pedido
    repetido depois de uma queda de rede tem que dar no mesmo — somar
    diferenças dobraria a contagem a cada retentativa.
    """
    return {
        "regraId": linha["regra_id"],
        "zonaId": linha["zona_id"],
        # A hora cheia em que as cenas foram capturadas, com o fuso da loja.
        "hora": _instante(linha["hora"]),
        # Quantas vezes o critério foi olhado neste canal...
        "capturas": linha["capturas"],
        # ...e no que deu cada olhada. A soma destas oito é `capturas`.
        "semJuiz": linha["sem_juiz"],
        "semQuadro": linha["sem_quadro"],
        "semCena": linha["sem_cena"],
        # A olhada que o porteiro segurou: o critério pedia gente na área (ou
        # a área livre, ou movimento) e a condição não valia. Não foi à nuvem.
        "semCondicao": linha["sem_condicao"],
        # A olhada do critério que só observa: passou pelo contexto e não foi
        # julgada, de propósito.
        "observadas": linha["observadas"],
        "emSilencio": linha["em_silencio"],
        "repetidas": linha["repetidas"],
        "jaJulgadas": linha["ja_julgadas"],
        "enfileiradas": linha["enfileiradas"],
        # O que saiu do julgamento do que foi enfileirado.
        "conformes": linha["conformes"],
        "naoConformes": linha["nao_conformes"],
        "naoAvaliaveis": linha["nao_avaliaveis"],
        "falhas": linha["falhas"],
        "alertas": linha["alertas"],
        # Soma e quantidade, e não a média: média de média erra quando as
        # horas têm volumes diferentes, e quem soma as horas é a nuvem.
        "somaConfianca": round(float(linha["soma_confianca"]), 4),
        "comConfianca": linha["com_confianca"],
        "somaLatenciaMs": int(linha["soma_latencia_ms"]),
        "comLatencia": linha["com_latencia"],
        "custoCentavos": round(float(linha["custo_centavos"]), 4),
        # Onde foi julgado: no computador da loja ou na nuvem. A soma das
        # duas é conformes + naoConformes + naoAvaliaveis.
        "julgadasLoja": linha["julgadas_loja"],
        "julgadasNuvem": linha["julgadas_nuvem"],
        # O que foi MEDIDO nas cenas da hora (o detector: quantos objetos
        # viu): soma e quantidade, para a média, e o maior valor. É a
        # matéria-prima do padrão de funcionamento da loja.
        "somaMedida": round(float(linha["soma_medida"]), 2),
        "comMedida": linha["com_medida"],
        # O maior valor só sobe junto de uma média. A olhada extra do vigia
        # entra no maior valor e não na média: na hora em que a única
        # medida veio de uma extra, a fila tem pico e nenhuma medida — e a
        # nuvem recusa "pico sem medida". Ele espera a primeira olhada de
        # rotina da hora (a linha sobe de novo a cada soma) e vai com ela.
        "maxMedida": (
            None if linha["max_medida"] is None or not linha["com_medida"]
            else round(float(linha["max_medida"]), 2)
        ),
        # As olhadas extras do vigia, que já estão dentro dos resultados
        # acima: quantas foram e quantas deram fora do critério.
        "extras": linha["extras"],
        "extrasFora": linha["extras_fora"],
        "ultimoResultado": linha["ultimo_resultado"],
        "ultimoMotivo": linha["ultimo_motivo"],
        # Por que NÃO deu para julgar, na última vez em que não deu.
        "ultimoImpedimento": linha["ultimo_impedimento"],
        "ultimaEm": _instante(linha["ultima_em"]),
    }


def _arredondado(valor: Any, casas: int = 2) -> float | None:
    return None if valor is None else round(float(valor), casas)


def uso_para_nuvem(linha: dict[str, Any]) -> dict[str, Any]:
    """O corpo de UMA hora em `POST /v1/uso`.

    Recebe uma linha de `fila.usos_a_subir()`. As chaves são as de
    `contratos/uso-da-maquina.json` (campo `hora`), lido também pelo teste
    da API. Como no resumo, sobem números ABSOLUTOS da hora: a mesma hora
    sobe várias vezes, e a nuvem troca o valor antigo pelo novo.

    De cada peça vão a soma e a quantidade, não a média: quem junta várias
    horas é a nuvem, e média de média erra quando as horas têm quantidades
    de amostras diferentes. `…Max` é o pico; nulo = a peça não foi medida.
    """
    return {
        "hora": _instante(linha["hora"]),
        "amostras": linha["amostras"],
        # Processador e memória da máquina inteira, em porcentagem.
        "cpuSoma": _arredondado(linha["cpu_soma"]),
        "cpuAmostras": linha["cpu_n"],
        "cpuMax": _arredondado(linha["cpu_max"]),
        "memSoma": _arredondado(linha["mem_soma"]),
        "memAmostras": linha["mem_n"],
        "memMax": _arredondado(linha["mem_max"]),
        # A placa de vídeo, quando a máquina tem como medir.
        "gpuSoma": _arredondado(linha["gpu_soma"]),
        "gpuAmostras": linha["gpu_n"],
        "gpuMax": _arredondado(linha["gpu_max"]),
        # Quanto do processador da MÁQUINA o agente usou, e a memória dele.
        "processoCpuSoma": _arredondado(linha["proc_cpu_soma"]),
        "processoCpuAmostras": linha["proc_cpu_n"],
        "processoCpuMax": _arredondado(linha["proc_cpu_max"]),
        "processoMemMaxMb": _arredondado(linha["proc_mem_max_mb"], 1),
        # O disco onde ficam a fila e as imagens: a última leitura da hora.
        "discoLivreGb": _arredondado(linha["disco_livre_gb"]),
        "discoTotalGb": _arredondado(linha["disco_total_gb"]),
    }


def maquina_para_nuvem(pecas: dict[str, Any]) -> dict[str, Any]:
    """De que é feita a máquina, para a tela dizer do que está falando."""
    return {
        "processador": pecas.get("processador"),
        "nucleos": pecas.get("nucleos"),
        "memoriaGb": pecas.get("memoria_gb"),
        "placaDeVideo": pecas.get("placa_de_video"),
    }
