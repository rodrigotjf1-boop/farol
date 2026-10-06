"""O corpo do evento que sobe — conferido contra o arquivo que a API também lê.

Este teste existe porque o agente mandava `idempotencia_key` e a API
esperava `idempotenciaKey` (ERR-018). Toda subida era recusada com 422, e
ninguém via: cada lado era testado contra um dublê de si mesmo.

O arquivo `contratos/evento-do-agente.json` é lido aqui e em
`api/testes/contrato-evento.test.ts`. Se este teste quebrar, **não ajuste o
teste**: ou o agente voltou ao formato errado, ou o formato mudou de
propósito e o arquivo precisa mudar junto — e aí é o teste da API que diz se
ela acompanhou.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from farol_agent.contrato import evento_para_nuvem, instante_com_fuso
from farol_agent.modelos import Resultado, Severidade, Veredito, Via
from farol_agent.motor import Alerta

CONTRATO = Path(__file__).resolve().parents[2] / "contratos" / "evento-do-agente.json"


def alerta_do_contrato() -> Alerta:
    """O alerta que, serializado, tem que dar exatamente o arquivo."""
    return Alerta(
        regra_id="00000000-0000-4000-8000-000000000001",
        regra_nome="bancada limpa",
        ponto_id="ponto-1",
        zona_id="00000000-0000-4000-8000-000000000002",
        ts=datetime(2026, 10, 6, 12, 0, 0, tzinfo=timezone(timedelta(hours=-3))),
        chave="0123456789abcdef0123456789abcdef",
        criterio_versao=3,
        severidade=Severidade.CRITICO,
        motivo="há restos de alimento sobre a bancada",
        confianca=0.93,
        acoes=["registro"],
        imagem_caminho="spool/x.jpg",
        cooldown_min=15,
        veredito=Veredito(
            resultado=Resultado.NAO_CONFORME,
            confianca=0.93,
            motivo="há restos de alimento sobre a bancada",
            via=Via.NUVEM,
            modelo="claude-haiku-4-5-20251001",
            tokens_entrada=1459,
            tokens_saida=103,
            custo_centavos=1.07,
            latencia_ms=912,
        ),
        imagem_hash="c3a1f0e2b4d59687",
    )


def test_o_arquivo_de_contrato_existe():
    # Se alguém mover a pasta, os dois testes de contrato passariam a não
    # testar nada. Melhor quebrar aqui, dizendo o que sumiu.
    assert CONTRATO.is_file(), f"contrato não encontrado em {CONTRATO}"


def test_o_evento_sai_EXATAMENTE_como_o_contrato():
    esperado = json.loads(CONTRATO.read_text(encoding="utf-8"))
    assert evento_para_nuvem(alerta_do_contrato()) == esperado


def test_nenhuma_chave_em_snake_case():
    """A forma do defeito original, para ele não voltar por outro campo."""
    corpo = evento_para_nuvem(alerta_do_contrato())
    com_sublinhado = [k for k in corpo if "_" in k]
    assert com_sublinhado == [], f"a API lê camelCase: {com_sublinhado}"


def test_o_corpo_sobrevive_a_ida_e_volta_em_json():
    # O corpo fica guardado na fila como texto até a nuvem aceitar. Se algum
    # valor não fosse serializável, o erro apareceria só no dia em que a
    # internet caísse.
    corpo = evento_para_nuvem(alerta_do_contrato())
    assert json.loads(json.dumps(corpo, ensure_ascii=False)) == corpo


# ───────────────────────── a hora do evento ─────────────────────────


def test_hora_SEM_fuso_sobe_COM_fuso():
    """O agente trabalha com a hora local, sem fuso.

    Mandar "2026-10-06T05:13:12" faz o Postgres ler como UTC, e o evento
    aparece no console três horas deslocado. Num produto de auditoria, "a
    que horas foi" é metade da resposta.
    """
    texto = instante_com_fuso(datetime(2026, 10, 6, 5, 13, 12))

    lido = datetime.fromisoformat(texto)
    assert lido.tzinfo is not None, f"saiu sem fuso: {texto}"
    # O relógio de parede não muda: só ganha o deslocamento da máquina.
    assert lido.replace(tzinfo=None) == datetime(2026, 10, 6, 5, 13, 12)


def test_hora_que_ja_tem_fuso_nao_e_convertida():
    com_fuso = datetime(2026, 10, 6, 12, 0, 0, tzinfo=timezone(timedelta(hours=-3)))
    assert instante_com_fuso(com_fuso) == "2026-10-06T12:00:00-03:00"
