# Enviar as fichas ao Farol — para quem cuida do sistema da loja

Este documento é para quem programa o sistema que a loja usa para o cardápio e as fichas
técnicas (o PDV, o ERP, o sistema de estoque). Ele descreve a **porta** por onde esse sistema
envia ao Monitor Farol o que a loja vende e do que cada produto é feito.

O Farol usa as fichas para saber como cada produto deve ser montado. Ele **não recebe preço,
custo, margem nem dado de cliente** — e ignora qualquer campo que não esteja descrito aqui.

## Antes de começar: o código de acesso

Quem cria o acesso é a diretoria da conta, no console do Farol (em **Conexões**, no cartão
**Outro sistema**, botão **Criar acesso**). Ela escolhe a loja e recebe um **código de acesso**,
que começa por `farol_`.

- O código vale para **uma loja**. Para outra loja, é outro código.
- Ele aparece **uma vez**, na hora em que é criado. O Farol não o guarda: se for perdido, a
  diretoria revoga o acesso e cria outro.
- Trate o código como uma senha: guarde-o na configuração do seu sistema, fora do código-fonte,
  e não o escreva em registro (log).
- Quando a diretoria **revoga** o acesso, o código para de valer na hora, e as fichas que o
  seu sistema enviou são apagadas do Farol.

Você não precisa de usuário nem de senha do console.

## O endereço e a identificação

```
https://api.monitorfarol.com.br/v1/integracao/fichas
```

Toda chamada leva o código no cabeçalho:

```
Authorization: Bearer farol_...
Content-Type: application/json
```

A loja é a do código. Nada no corpo do envio escolhe a loja.

## Enviar as fichas — `PUT /v1/integracao/fichas`

O corpo é um objeto com a lista `produtos`. **O envio é o cardápio inteiro da loja**: ele
substitui o que o Farol tinha dessa loja. Para tirar um produto, envie a lista sem ele.

```json
{
  "produtos": [
    {
      "nome": "X-Burger",
      "codigo": "1042",
      "categoria": "Burgers",
      "cozinha": true,
      "ingredientes": [
        { "nome": "Pão brioche", "quantidade": 1, "unidade": "unidade" },
        { "nome": "Blend da casa", "quantidade": 120, "unidade": "g" },
        { "nome": "Queijo prato", "quantidade": 2, "unidade": "fatia" },
        { "nome": "Cebola roxa", "quantidade": 10, "unidade": "g" }
      ],
      "variacoes": [
        { "nome": "Simples", "fator": 1 },
        { "nome": "Duplo", "fator": 2 }
      ],
      "adicionais": [
        { "nome": "Bacon", "faz": "acrescenta", "ingrediente": "Bacon fatiado", "quantidade": 20, "unidade": "g" },
        { "nome": "Sem cebola", "faz": "tira", "ingrediente": "Cebola roxa" },
        { "nome": "Ponto da carne", "faz": "observacao" }
      ]
    },
    {
      "nome": "Batata frita",
      "ingredientes": [
        { "nome": "Batata palito", "quantidade": 200, "unidade": "g" },
        { "nome": "Sal", "quantidade": 1, "unidade": "pitada" }
      ]
    },
    { "nome": "Refrigerante lata", "cozinha": false },
    {
      "nome": "Combo da casa",
      "combo": [
        { "produto": "X-Burger", "quantidade": 1 },
        { "produto": "Batata frita", "quantidade": 1 },
        { "produto": "Refrigerante lata", "quantidade": 1 }
      ]
    }
  ]
}
```

### O produto

| Campo | Preencher | O que é |
|---|---|---|
| `nome` | sempre | O nome como aparece no pedido. **É a identidade do produto:** não pode repetir no envio (maiúscula, minúscula e acento não fazem diferença). |
| `codigo` | se quiser | O código do produto no seu sistema. Texto ou número. |
| `categoria` | se quiser | Só para achar o produto na lista. |
| `cozinha` | se quiser | `false` para o que sai pronto, como a bebida em lata. Sem o campo, vale `true`. |
| `ingredientes` | se o produto tem ficha | A ficha, **na ordem em que o produto é montado**. Sem ingredientes, o produto entra sem ficha. |
| `variacoes` | se o produto tem tamanhos | Ver abaixo. |
| `adicionais` | se o cliente pode pedir a mais ou tirar | Ver abaixo. |
| `combo` | se o produto é feito de outros | Ver abaixo. |

### O ingrediente (`ingredientes[]`)

| Campo | Preencher | O que é |
|---|---|---|
| `nome` | sempre | O nome do ingrediente. |
| `quantidade` | sempre | Um número maior que zero. Aceita também o texto do número (`"0,5"` ou `"0.5"`). |
| `unidade` | sempre | Uma da lista: `g`, `kg`, `ml`, `l`, `unidade`, `fatia`, `folha`, `rodela`, `colher`, `pitada`. |

A unidade pode vir do jeito que se costuma escrever (`gr`, `gramas`, `quilo`, `litros`, `un`,
`unidades`, `fatias`, `folhas`, `rodelas`, `colheres`, `pitadas`). O que não é da lista —
`pct`, `cx`, `fls` — deixa o produto de fora.

Um preparo da casa (um molho, um blend) entra como **um ingrediente**, com o nome dele. A ficha
do preparo não é desmontada dentro do produto.

### A variação (`variacoes[]`)

| Campo | Preencher | O que é |
|---|---|---|
| `nome` | sempre | "Simples", "Duplo", "Grande". Não pode repetir no mesmo produto. |
| `fator` | se quiser | Quanto da ficha a variação usa: o Duplo usa `2`; a meia porção, `0.5`. Sem o campo, vale `1`. |

### O adicional (`adicionais[]`)

| Campo | Preencher | O que é |
|---|---|---|
| `nome` | sempre | "Bacon", "Sem cebola", "Ponto da carne". |
| `faz` | sempre | `acrescenta`, `tira` ou `observacao`. |
| `ingrediente` | com `acrescenta` e `tira` | O que entra, ou o que sai. No `tira`, tem de ser um ingrediente **da ficha deste produto**, escrito igual. |
| `quantidade` e `unidade` | se quiser, com `acrescenta` | Quanto entra. Os dois juntos, ou nenhum. |

`observacao` é o que a cozinha lê e não põe nem tira nada ("ponto da carne").

### O combo (`combo[]`)

| Campo | Preencher | O que é |
|---|---|---|
| `produto` | sempre | O `nome` de outro produto **deste mesmo envio**. |
| `quantidade` | se quiser | Quantos vêm no combo. Sem o campo, vale `1`. |

## O que o Farol responde

### Recebido — `200`

```json
{
  "resultado": "atualizada",
  "produtos": 4,
  "comFicha": 2,
  "semFicha": ["Refrigerante lata"],
  "deFora": [],
  "soltos": [],
  "problemas": 0
}
```

- `resultado`: `atualizada` quando as fichas da loja mudaram; `nada_mudou` quando o envio traz
  o que a loja já tinha. Enviar de novo a mesma coisa não custa nada, e não muda nada.
- `produtos` e `comFicha`: quantos produtos entraram, e quantos deles com ficha.
- `semFicha`: os produtos que entraram sem ingredientes. Não é erro.
- `deFora`: os produtos que **não entraram**, com o motivo de cada um.

### Entra o que está certo

Um produto com qualquer problema fica **inteiro de fora**, e os outros entram. O Farol não
guarda meia ficha: ele conferiria a montagem contra uma ficha com um ingrediente a menos. O
combo que leva um produto que ficou de fora fica de fora junto.

A resposta continua sendo `200`, e diz o que ficou de fora e onde está o problema, no que foi
enviado:

```json
{
  "resultado": "atualizada",
  "produtos": 3,
  "comFicha": 1,
  "semFicha": ["Refrigerante lata"],
  "deFora": [
    {
      "produto": "X-Burger",
      "problemas": [
        { "onde": "produtos[0].ingredientes[2]", "texto": "falta a quantidade." },
        { "onde": "produtos[0].adicionais[1]", "texto": "o produto não tem “Tomate” na ficha, para tirar." }
      ]
    },
    {
      "produto": "Combo da casa",
      "problemas": [
        { "onde": "produtos[3].combo[0]", "texto": "o produto “X-Burger”, que vem neste combo, ficou de fora." }
      ]
    }
  ],
  "soltos": [],
  "problemas": 3
}
```

Quem cuida da loja vê a mesma lista no console, na tela **Fichas**.

**Confira `deFora` a cada envio.** Um produto que ficou de fora não tem ficha no Farol até o
envio seguinte trazê-lo certo.

### O que recusa o envio inteiro

| Resposta | `erro` | Quando |
|---|---|---|
| `401` | `sem_credencial` | Faltou o cabeçalho `Authorization: Bearer <código>`. |
| `401` | `credencial_invalida` | O código não existe. Confira se foi copiado inteiro. |
| `401` | `acesso_revogado` | O acesso foi revogado pela diretoria. Peça outro. |
| `413` | — | O envio passa de 8 MB. |
| `422` | `envio_invalido` | A **forma** do envio não serve. A `mensagem` diz o caminho do campo. |
| `422` | `nada_a_receber` | Nenhum produto do envio está certo. A resposta traz `deFora`, como acima. |

Quando o envio é recusado, as fichas que a loja tinha continuam como estavam.

A forma errada é erro de programação, e por isso recusa tudo, em vez de deixar um produto de
fora:

```json
{ "erro": "envio_invalido", "mensagem": "produtos[1].cozinha: era para ser verdadeiro ou falso (true ou false)" }
```

São erros de forma: `produtos` não ser uma lista (ou vir vazia); um produto, ingrediente,
variação, adicional ou item de combo que não é um objeto; faltar o `nome`; vir texto onde vai
`true`/`false`; vir um objeto ou uma lista onde vai um texto ou um número.

## Conferir o código e o último envio — `GET /v1/integracao/fichas`

Com o mesmo cabeçalho. Serve para testar o código antes do primeiro envio e para ver o que o
Farol tem do seu sistema:

```json
{
  "sistema": "PDV da Casa",
  "loja": "Loja Centro",
  "recebidoEm": "2026-10-11T17:02:11.000Z",
  "produtos": 4,
  "comFicha": 2
}
```

`recebidoEm`, `produtos` e `comFicha` vêm vazios (`null`) enquanto o sistema não enviou nada.

## Limites

- Até 5.000 produtos por envio, e 300 ingredientes por produto.
- Até 8 MB por envio.
- Nomes com até 200 letras (o que passar é cortado).

## Quando enviar

Quando o cardápio ou uma ficha mudar — ou uma vez por dia, se for mais simples. Ficha técnica
não muda a toda hora: não é preciso enviar a cada pedido.

## O que o Farol faz com o que recebe

- Guarda o cardápio e as fichas da loja, no formato dele, e mostra na tela **Fichas**.
- Envia uma cópia ao computador do Farol que fica na loja.
- **Não** guarda nem repassa preço, custo ou dado de cliente: esses campos nem são lidos.
- Uma loja recebe as fichas de um lugar só. Se a loja tinha fichas importadas por planilha,
  elas ficam até o primeiro envio do seu sistema; aí as do sistema entram no lugar.
