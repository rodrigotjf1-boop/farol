# O transporte dos alertas — o contrato

Quem entrega os alertas do Farol (o n8n, o Regem) **puxa** os envios pendentes, entrega e devolve o **resultado**. O
Farol não empurra: uma lentidão do WhatsApp não pode virar lentidão na entrada dos eventos das lojas
(`api/src/rotas/alertas.ts`, nota do topo). O transporte é da **distribuição**, não do agente — o aviso de "o agente
caiu" não pode passar pelo agente (ERR-016).

## A credencial (desde 14/10/2026, migration 046)

Cada transporte tem um **token próprio**, emitido pela distribuição:

```
npm run provisionar -- transporte <nome> <tipos separados por vírgula>
    ex.: npm run provisionar -- transporte n8n whatsapp,email
npm run provisionar -- transportes                       (lista, sem o token)
npm run provisionar -- transporte-revogar <transporteId>  (revoga um; os outros seguem)
```

(no console do serviço `farol-api`, como os outros comandos de provisionar)

- O token começa com `fart_` e aparece **uma vez**, na emissão. O banco guarda só o resumo (SHA-256): ninguém o
  recupera depois. Perdeu, emite outro e revoga o antigo.
- Ele só faz duas coisas: **reivindicar** envios dos tipos dados na emissão (`whatsapp`, `email`, `kds`, `webhook`) e
  **devolver o resultado** dos envios que ele mesmo reivindicou. Não abre nenhuma outra rota.
- A credencial geral da distribuição (`x-farol-admin`) **não vale** nestas rotas: até 14/10/2026 valia, e quem
  entregasse os alertas carregaria a chave que emite agente e cadastra loja, de todas as lojas (pedido da sessão do
  Hub DMS, aprovado pelo dono).
- Token errado, inexistente, revogado ou sem o prefixo: **401**, sempre com a mesma mensagem.

## `POST /v1/envios/reivindicar`

```
Authorization: Bearer fart_…
{ "limite": 20, "tipos": ["whatsapp"] }      ← os dois são opcionais
```

- `limite`: de 1 a 100 (padrão 20).
- `tipos`: vale DENTRO dos tipos do transporte; sem ele, todos os do transporte. Pedir só tipo alheio é não levar nada.
- Leva envios `pendente` ou `falhou` (menos de 5 tentativas), o "agente caiu" antes de tudo, depois pela ordem de
  chegada. Dois trabalhadores juntos nunca levam o mesmo envio (`for update skip locked`).
- O envio levado passa a `enviado`, conta uma tentativa e anota **quem o levou** (`envio.transporte_id`).

Resposta: `{ "envios": [ { id, motivo, payload, tentativas, loja_id, evento_id, destino_tipo, destino_endereco,
segredo_ref } ] }`. O `segredo_ref` é o **nome** da variável, no ambiente do transporte, que guarda o segredo do
destino (o token do webhook, por exemplo) — nunca o valor.

### Os motivos e o `payload` de cada um

| `motivo` | O que é | `payload` |
|---|---|---|
| `evento` | um critério ficou fora do combinado | nulo — o envio aponta o `evento_id` |
| `agente_caiu` | o agente parou de bater: a loja não está sendo auditada | `{ agente, desde, consequencia }` |
| `computador` | o computador do agente **esquentando** ou **sobrecarregado** (desde 25/10/2026, migration 059) | `{ tipo, agente, loja, porque, desde, ate, consequencia, texto }` |

No `computador`: `tipo` é `esquentando` ou `sobrecarregado`; `porque` são as frases curtas do motivo (a mais grave
primeiro); `desde` e `ate`, o primeiro e o último minuto acima do limite (ISO, UTC); `texto` é a mensagem pronta, em
português, para o transporte que só repassa texto — por exemplo:

```
Farol · Matriz: o computador do agente está esquentando. A placa de vídeo passou de 83 °C em 12 minutos da última
hora (chegou a 87 °C às 21:14). Calor demais deixa a auditoria lenta e pode desligar o computador. No console:
Computador da loja › Saúde.
```

Sai no máximo um de cada tipo a cada 12 horas por computador (`api/src/aviso-da-maquina.ts`). Um transporte que não
conhece o motivo deve devolver `entregue: false` com o erro, nunca descartar calado.

## `POST /v1/envios/:id/resultado`

```
Authorization: Bearer fart_…
{ "entregue": true }                       ← ou { "entregue": false, "erro": "o motivo" }
```

- `entregue` é obrigatório (422 sem ele): "mandei" e "chegou" são fatos diferentes.
- Só vale para o envio que **este** transporte reivindicou; o de outro (ou id torto) é 404.
- `true` → `entregue` com a hora; `false` → `falhou` com o motivo, e o envio volta para a fila.

## O que aparece no console

**Loja → Alertas → "Chegou?"**: "na fila" (pendente), "mandado" (reivindicado), "chegou" (entregue), "falhou".
