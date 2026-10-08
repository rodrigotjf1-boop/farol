# Contratos entre o agente e a nuvem

Cada arquivo aqui é **um corpo de exemplo, completo e verdadeiro**, de uma
mensagem que atravessa a fronteira entre o agente (Python, na loja) e a API
(TypeScript, na nuvem).

Os dois lados têm um teste que lê o **mesmo** arquivo:

| arquivo | quem produz | quem consome |
|---|---|---|
| `evento-do-agente.json` | `agent/testes/test_contrato.py` exige que `evento_para_nuvem` gere exatamente este corpo | `api/testes/contrato-evento.test.ts` manda este corpo para `POST /v1/eventos` e confere coluna por coluna o que foi gravado |
| `resumo-do-agente.json` | `agent/testes/test_resumo.py` exige que `resumo_para_nuvem` gere exatamente este corpo | `api/testes/resumos.test.ts` manda este corpo para `POST /v1/resumos` e confere coluna por coluna o que foi gravado |
| `uso-da-maquina.json` | `agent/testes/test_uso.py` exige que `uso_para_nuvem` gere exatamente o campo `hora` e que `maquina_para_nuvem` tenha as chaves de `maquina` | `api/testes/uso.test.ts` manda este corpo para `POST /v1/uso` e confere coluna por coluna o que foi gravado |
| `foto-padrao.json` | três pedaços da foto padrão que atravessam a fronteira: o que a configuração leva de cada foto do canal (`padroesDoPonto`), a escolha do critério (`regra.comPadrao`) e o que o agente manda com o quadro (`quadro.pessoas`). `api/testes/padroes.test.ts` confere que `GET /v1/agentes/configuracao` devolve exatamente essas chaves e que a contagem mandada é gravada | `agent/testes/test_foto_padrao.py` confere que o agente lê essas chaves da configuração e que `capturar_quadro` manda a contagem com esse nome |
| `equipamentos-da-area.json` | o que a configuração leva de cada equipamento do inventário que aparece numa área (`equipamentosDaZona`: nome, tipo e descrição). `api/testes/inventario.test.ts` confere que `GET /v1/agentes/configuracao` devolve exatamente essas chaves | `agent/testes/test_inventario.py` confere que o agente lê essas chaves e que a descrição chega ao texto da pergunta feita à nuvem |
| `descrever-equipamento.json` | o comando `descrever_item` (o que desce ao agente na batida: o equipamento e as fotos a baixar) e a resposta dele (a descrição sugerida, o que vale conferir, o modelo e o custo). `api/testes/descricao.test.ts` confere que o comando desce com exatamente essas chaves e que a resposta do exemplo é guardada como sugestão | `agent/testes/test_descrever.py` confere que o agente atende o comando do exemplo e responde com exatamente as chaves da resposta |
| `planta.json` | não é uma mensagem: é a **planta de exemplo** (a do protótipo) e o que se tira dela — o que cada câmera vê, a frase do lugar de cada canal e a cobertura. `api/testes/planta.test.ts` confere a conta da API (`api/src/planta.ts`) **e** a do console (`web/lib/planta.ts`, importado pelo caminho), e que as duas concordam | `agent/testes/test_lugar.py` confere que o agente lê essas frases da configuração (`pontos[].lugar`) e como elas entram na pergunta feita a um modelo |
| `horario-de-funcionamento.json` | não é uma mensagem: são os **casos** de "a loja está aberta?" e "é hora de conferir?". `agent/testes/test_horario.py` confere a conta do agente (`modelos.py`), que é quem decide se confere | `api/testes/horario.test.ts` confere a conta da API (`horario.ts`), que é quem diz "aberta agora" na tela |

## Por que isto existe

Em 06/10/2026 descobrimos que o agente mandava `idempotencia_key` e a API
esperava `idempotenciaKey`. Toda subida de evento era recusada com 422. Os
testes dos dois lados passavam, porque cada lado era testado contra um dublê
de si mesmo — e o dublê concorda sempre.

## Regra

Mudou o formato de um lado? **Mude o arquivo.** O teste do outro lado quebra,
e é esse o objetivo: a quebra aparece no CI, antes de aparecer na loja.
