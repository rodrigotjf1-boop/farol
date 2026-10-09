# Teste lado a lado: o pedido à nuvem com e sem contexto — 08/10/2026

Pergunta do dono (A19): "o que sobe à nuvem? Se enviar um corte sem contexto, a análise vai
falhar e o custo vai ser em vão." O plano respondeu com uma regra — o recorte nunca sobe
sozinho — e este teste mede quanto ela vale. Autorizado pelo dono ("pode"), com teto de
R$ 5,00. **Gasto: R$ 2,91.**

## O que foi comparado

A MESMA cena, de três maneiras:

| maneira | a imagem | o texto | a resposta |
|---|---|---|---|
| **hoje** | o recorte do tampo reduzido a 640×155 | o pedido exatamente como o agente monta hoje (o texto do critério "Produto") | veredito e uma frase |
| **maior** | o recorte na resolução da câmera (1.630×397) | o mesmo de hoje | veredito e uma frase |
| **contexto** | a cena escrita + o mapa do canal (a câmera inteira, pequena, com o tampo marcado) + o recorte na resolução da câmera | "liste cada posição de montagem e os itens de cada uma" | **lista por posição**, com confiança |

"hoje" e "maior" foram no modelo que o agente usa (Haiku 4.5). "contexto" foi no Haiku 4.5,
no Haiku 5.5 e, em um a cada três momentos, no Sonnet 5.5.

**As imagens:** 40 momentos da gravação do canal 4 (bancada de montagem, câmera de cima),
das 21h37min05 às 21h49min45, um a cada 19,5 s, com a loja em operação. Cada um foi
preparado pelo mesmo caminho do agente: recorta a área, apaga o que fica fora, borra rosto.
As imagens ficaram no PC da loja só durante o teste e não estão neste repositório.

**O gabarito:** rótulos feitos por mim, olhando o recorte na resolução da câmera, **antes**
de ler as respostas — os alimentos que se veem com clareza em cada momento (pão, carne,
queijo, alface, molho, batata…): 89 no total, em 33 momentos; nos outros 7 não havia
alimento à vista. Leitura plausível que não é erro (o creme laranja chamado de queijo, a
cobertura escura chamada de cebola) não conta contra o modelo.

⚠️ **É gabarito provisório.** Vista de cima, a carne clara desta loja se parece com o pão
tostado — o estudo do lote ([estudo-do-lote-de-montagem.md](estudo-do-lote-de-montagem.md))
mostrou isso depois. Os números abaixo comparam as maneiras entre si com a mesma régua; não
são o acerto do sistema. O acerto se mede com os exemplos marcados pelo responsável.

Nas maneiras "hoje" e "maior" a resposta é uma frase: os alimentos foram tirados dela por
palavra. Quando a resposta foi "não deu para avaliar", conta como não respondeu.

## Resultado

Nos 40 momentos:

| maneira · modelo | respondeu | achou, dos 89 | inventou | momentos sem erro | inventou onde não havia alimento | custo por análise | tempo |
|---|---|---|---|---|---|---|---|
| hoje · Haiku 4.5 | 33 de 40 | 52 (58%) | 17 | 4 | 1 de 7 | 1,20 centavo | 2,0 s |
| maior · Haiku 4.5 | 33 de 40 | 52 (58%) | 16 | 4 | 0 de 7 | 1,56 centavo | 2,2 s |
| contexto · Haiku 4.5 | 40 de 40 | 59 (66%) | 25 | 8 | 3 de 7 | 2,45 centavos | 3,8 s |
| **contexto · Haiku 5.5** | **40 de 40** | **70 (79%)** | **15** | **17** | **0 de 7** | **0,14 centavo** | **1,7 s** |

Nos 14 momentos em que o Sonnet 5.5 também rodou (29 alimentos):

| maneira · modelo | achou, dos 29 | inventou | momentos sem erro | custo por análise | tempo |
|---|---|---|---|---|---|
| hoje · Haiku 4.5 | 16 (55%) | 6 | 0 | 1,22 centavo | 2,0 s |
| maior · Haiku 4.5 | 17 (59%) | 4 | 2 | 1,57 centavo | 2,2 s |
| contexto · Haiku 4.5 | 18 (62%) | 6 | 3 | 2,46 centavos | 3,8 s |
| contexto · Haiku 5.5 | 21 (72%) | 5 | 6 | 0,15 centavo | 1,8 s |
| contexto · Sonnet 5.5 | 23 (79%) | **0** | 8 | 5,45 centavos | 6,3 s |

O que cada uma mais errou:

| maneira · modelo | não viu | inventou |
|---|---|---|
| hoje · Haiku 4.5 | carne 16, molho 11, pão 6 | alface 6, queijo 5, carne 3 |
| maior · Haiku 4.5 | molho 15, carne 15, pão 6 | queijo 11, carne 3 |
| contexto · Haiku 4.5 | molho 17, carne 7, pão 6 | queijo 11, carne 7, batata 3 |
| contexto · Haiku 5.5 | molho 11, pão 7, carne 1 | carne 5, queijo 5, cebola 4 |
| contexto · Sonnet 5.5 (14) | carne 4, molho 2 | nada |

O veredito de "hoje": 33 "dentro" e 7 "não deu para avaliar" — o mesmo retrato das 190
análises da noite (118 e 72). "Dentro", ali, não informa nada.

## O que se lê disso

1. **A imagem maior, sozinha, não mudou nada** (58% → 58%). Mandar mais pixels sem dizer o
   que procurar é custo a mais (+30%) pelo mesmo resultado.
2. **O contexto e a lista ajudam, e ajudam mais no modelo novo.** No Haiku 4.5: de 58% para
   66%, mas inventando mais. No Haiku 5.5: 79%, inventando menos que todos os do Haiku 4.5,
   sem inventar nada onde não havia alimento, e respondendo aos 40.
3. **O Haiku 5.5 com contexto custa 8 vezes menos que a análise de hoje** (0,14 contra 1,20
   centavo) e é mais rápido. Parte do preço baixo é o cache: a cena, o mapa e as instruções
   foram lidos do cache em 39 das 40 chamadas. No Haiku 4.5 o cache **nunca** entrou — o
   trecho fixo fica abaixo do mínimo que esse modelo exige.
4. **O Sonnet 5.5 não inventou nada** nos 14 momentos, e achou o mesmo tanto que o Haiku
   5.5. Custa 39 vezes mais e leva 6 s. Serve de desempate e de conferência por amostragem,
   não de leitura de rotina.
5. **Ninguém vê bem o molho** num quadro só (o melhor deixou de ver 11 dos 17), e a carne
   clara se confunde com o pão. É o que o plano já dizia: o que fica embaixo, o que é fino e
   o que é parecido não se resolve com uma foto — resolve-se acompanhando a montagem (as
   três provas da leitura da bancada).
6. **79% por quadro não sustenta um aviso de "faltou algo".** Sustenta a leitura que
   alimenta a contagem, a rotulagem dos exemplos e a conferência por amostragem. O aviso só
   depois do banco de provas.

## O que o teste achou sem procurar

- **A reconsulta ao modelo forte falhava sempre.** O Sonnet 5.5 recusa a forma de chamada
  que o agente usava (ferramenta forçada), e o erro levava junto a resposta do modelo
  barato. O botão "Analisar as fotos e descrever" tinha o mesmo defeito. Corrigido no PR #69.
- **O borrão de rosto apagou pão em 12 dos 40 momentos** (um quadrado liso em cima do
  alimento) e não pegou a cabeça de quem se debruçou sobre a bancada — de cima não há rosto
  para achar. No quadro de bancada ele atrapalha a leitura e não protege.
- **O preço do Sonnet 5.5 no agente estava 50% acima** do da tabela oficial (corrigido no
  mesmo PR).

## O deslize do roteiro

Na primeira rodada, a maneira "contexto" no Haiku 4.5 falhou nas 40 chamadas, sem custo: o
roteiro guardava o modo de chamada por modelo e levou o nome da ferramenta errada. E eu já
tinha apagado as imagens da loja antes de conferir se todas as maneiras tinham resposta.
Refiz essa maneira com os mesmos recortes (R$ 0,98) e passei a conferir antes de apagar.

## O pedido da maneira "contexto"

É a semente do pedido da onda 1. Instruções (fixas, em cache):

```
Você lê o que há sobre uma bancada de um estabelecimento alimentício, a partir de imagens
de câmera. Não é vigilância de pessoas: você descreve ALIMENTOS e embalagens, nunca quem aparece.

Responda SEMPRE pela ferramenta `listar`.

Regras:
1. Liste só o que você VÊ no RECORTE. Não suponha ingrediente escondido embaixo de outro.
2. Na dúvida sobre um item, deixe-o de fora ou use confiança baixa. Chutar é erro.
3. Se o recorte não mostra nenhum alimento sendo montado ou embalado, devolva `posicoes` vazia
   e `bancada_vazia` verdadeiro.
4. Não descreva nem identifique pessoas. Mãos e braços podem aparecer: ignore-os. Se taparem
   uma posição, marque o estado dela como `tapada`.
```

A cena (fixa por canal, em cache, seguida do mapa):

```
Hamburgueria. Bancada de montagem de lanches, vista de CIMA por uma câmera no teto. Os lanches
são montados sobre folhas de papel alumínio ou dentro de caixas brancas; cada folha ou caixa
com lanche é uma POSIÇÃO de montagem. Porções de batata frita também passam pela bancada. No
alto da bancada, fora do recorte, ficam as cubas de ingredientes; à direita, a impressora de
comandas. O inox e o papel alumínio brilham: brilho não é alimento.

MAPA DO CANAL — a imagem a seguir é a câmera inteira, reduzida. O contorno amarelo marcado com
A é o tampo da bancada: é dele o recorte que você vai ler. NÃO leia o mapa: ele só situa o recorte.
```

A pergunta (com o recorte): "Liste cada posição de montagem visível no recorte, da esquerda
para a direita, com os itens que aparecem nela, vistos de cima."

A resposta, por posição: onde (esquerda, centro, direita), a base (papel alumínio, caixa,
papel, direto na bancada), o estado (aberto, fechado ou embrulhado, tapada), os itens (pão,
carne, queijo, alface, tomate, cebola, bacon, ovo, molho branco, molho laranja, batata
frita, outro) e a confiança.

O que o estudo do lote manda mudar neste pedido: a posição tem **vários discos** (a tampa
e um disco por carne), há **duas carnes de cor diferente** e um **molho vermelho**; e a
pergunta rende mais feita **uma vez por fase**, quando as mãos saem.

## O que não foi medido

- O acerto com gabarito do responsável (este é meu, e provisório).
- Sequências de quadros — aqui foi um quadro por vez.
- O pico de sábado, outra bancada, outra luz.
- O Haiku 5.5 no pedido de hoje (sem contexto): não dá para separar quanto do ganho é do
  modelo e quanto é do contexto.
- A forma nova de chamar o Sonnet 5.5 com a ferramenta do agente (`responder`). O que está
  medido: forçada, a API recusa; livre, ele respondeu pela ferramenta em 14 de 14.
