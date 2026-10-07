# Contratos entre o agente e a nuvem

Cada arquivo aqui é **um corpo de exemplo, completo e verdadeiro**, de uma
mensagem que atravessa a fronteira entre o agente (Python, na loja) e a API
(TypeScript, na nuvem).

Os dois lados têm um teste que lê o **mesmo** arquivo:

| arquivo | quem produz | quem consome |
|---|---|---|
| `evento-do-agente.json` | `agent/testes/test_contrato.py` exige que `evento_para_nuvem` gere exatamente este corpo | `api/testes/contrato-evento.test.ts` manda este corpo para `POST /v1/eventos` e confere coluna por coluna o que foi gravado |
| `resumo-do-agente.json` | `agent/testes/test_resumo.py` exige que `resumo_para_nuvem` gere exatamente este corpo | `api/testes/resumos.test.ts` manda este corpo para `POST /v1/resumos` e confere coluna por coluna o que foi gravado |

## Por que isto existe

Em 06/10/2026 descobrimos que o agente mandava `idempotencia_key` e a API
esperava `idempotenciaKey`. Toda subida de evento era recusada com 422. Os
testes dos dois lados passavam, porque cada lado era testado contra um dublê
de si mesmo — e o dublê concorda sempre.

## Regra

Mudou o formato de um lado? **Mude o arquivo.** O teste do outro lado quebra,
e é esse o objetivo: a quebra aparece no CI, antes de aparecer na loja.
