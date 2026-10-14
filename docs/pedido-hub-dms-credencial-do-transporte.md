# Pedido para a sessão do Farol — credencial própria para quem entrega os alertas

**De:** sessão do Hub DMS · **Em:** 14/10/2026 · **Base lida:** `origin/main` `606e773`
**É tarefa com plano antes do código:** apresente o plano ao dono e espere o "pode", como manda a regra do Farol.

## O que o dono decidiu

No plano do Hub DMS, o dono escolheu (D10, 14/10/2026) **abrir já os pedidos de correção das brechas que existem hoje
nos produtos**, sem esperar o hub. Esta é a do Farol, classificada como risco alto.

## O que achei

As rotas que o transporte externo (o Regem ou o n8n) usa para entregar os alertas aceitam a **credencial geral da
distribuição**, a mesma que administra o Farol inteiro:

- `api/src/rotas/alertas.ts:378` — `app.post('/v1/envios/reivindicar', …)`, que chama `exigirAdmin(req.headers['x-farol-admin'])` na linha 382.
- `api/src/rotas/alertas.ts:434` — a rota de resultado do envio, com o mesmo `exigirAdmin`.
- `api/src/auth.ts:113` — `exigirAdmin` compara o cabeçalho com `process.env.FAROL_ADMIN_TOKEN`.

## O risco

Quem faz a entrega carrega a chave mestra do Farol. Se ela vazar do n8n, de um log ou de uma variável copiada, vaza
tudo o que `x-farol-admin` abre (inclusive emitir agente por `POST /v1/distribuicao/agentes`), e não para cada loja:
para todas.

## A correção sugerida

1. Uma **credencial própria do transporte**, que só reivindica e devolve envios. Nada mais.
2. Guardada só em resumo (SHA-256), com prefixo reconhecível, como o token do agente.
3. De preferência uma por destino de transporte (Regem, n8n), para revogar uma sem derrubar a outra.
4. Período de transição: as duas credenciais valem; depois `x-farol-admin` deixa de valer nessas rotas.
5. Registro de cada reivindicação com o transporte que reivindicou.

## Como provar

- Teste: a credencial do transporte reivindica e devolve envio; recebe 401 ou 403 em qualquer outra rota de
  distribuição.
- Teste: `x-farol-admin` deixa de valer nas rotas de envio depois da transição.
- O transporte que está em uso hoje (se houver) continua entregando: conferir antes quem consome `/v1/envios/reivindicar`
  em produção. O levantamento do hub não conseguiu confirmar.

## Depois

Ao mesclar, informe o dono com o número do PR. A sessão do hub atualiza `C:\HubDMS\docs\trilha-paralela.md`.
