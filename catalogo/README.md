# Catálogo de equipamentos do Monitor Farol

Tudo o que o projeto já pesquisou ou mediu sobre equipamento — gravador,
câmera, computador, placa de vídeo, nobreak, rede — com a especificação da
ficha **e a entrega real**, quando foi medida.

## De quem é

**Do Monitor Farol, não do usuário.** É dado da distribuição: serve para o
sistema montar soluções e orçamento. O usuário nunca vê nem edita o catálogo —
a ele chegam só as **soluções e opções** montadas a partir daqui.

Nenhuma rota do console devolve estes arquivos, e nenhuma deve devolver.

## Por que arquivo, e não só tabela

Um arquivo JSON por modelo, neste repositório, é a **fonte da verdade**:

- é leve — um modelo novo é um arquivo novo, sem migration;
- tem história: quem mudou o quê, quando e por quê fica no git;
- passa por revisão como qualquer mudança;
- é conferido por teste a cada envio (`api/testes/catalogo.test.ts`).

O banco guarda uma **cópia** (tabela `equipamento`, da migration 002), porque o
orçamento cruza equipamento com loja, levantamento e diagnóstico. A carga da
cópia a partir dos arquivos é o próximo passo — até lá a tabela tem só os 21
modelos da migration 002, e este catálogo já tem todos eles e mais.

## Onde fica cada coisa

```
catalogo/
  niveis.json                      os níveis, os usos e o critério de cada um
  equipamentos/
    gravador/    camera/    computador/    gpu/
    acelerador/  nobreak/   rede/          disco/
      <fabricante>--<modelo>.json  um arquivo por modelo
```

## O que um arquivo diz

| campo | o que é |
|---|---|
| `id` | fabricante e modelo em minúsculas, sem acento: é o nome do arquivo |
| `categoria` | uma das categorias da tabela `equipamento` |
| `fabricante`, `modelo` | como no mercado. O par não se repete |
| `nivel` | `basico`, `intermediario` ou `avancado` — ou `null` onde não se aplica (nobreak, rede, disco, acelerador) |
| `nivel_motivo` | uma frase: **por que** este nível |
| `status` | `recomendado` entra na proposta · `aceitavel` funciona, com ressalva · `descartado` não propor |
| `observacao` | o que só a pesquisa ou a bancada ensinam — principalmente as armadilhas |
| `serve_para` | câmera: os usos de análise que ela sustenta (lista em `niveis.json`) |
| `specs` | o que a **ficha** promete |
| `medido` | o que o equipamento **entregou**, medido: data, onde, o que, valor, em que condição |
| `precos` | preço ou faixa, **sempre com data, fonte e confiança** |
| `fontes` | de onde veio cada informação |

### Medido vence declarado

A ficha do i7 de 10ª geração dizia "nunca a versão F: sem vídeo integrado não
há decodificação". O PC da loja de teste é um i7-10700**F**, e decodifica 14
canais no fluxo reduzido mais 4 em 1080p usando 10% da máquina. A ressalva
vale para dezenas de fluxos em alta — não para o porte de uma loja.

É para isso que `medido` existe, separado de `specs`: quando os dois
discordam, o orçamento usa o medido, e a observação explica a diferença.

### Preço tem data

Preço muda toda semana. Um número sem data é um número errado esperando a
hora. `confianca` diz quanto ele vale:

- `confirmado` — a página foi aberta e lida;
- `indice` — veio de busca; conferir antes de propor;
- `estimado` — faixa de mercado, ou valor de um item parecido.

## Os níveis

O critério de cada nível, por tipo de equipamento, está em `niveis.json`.
Em resumo:

| | básico | intermediário | avançado |
|---|---|---|---|
| **câmera** | vê quem está e quantos são | fecha o quadro para julgar estado | leitura, cor à noite, montagem |
| **gravador** | até 8 canais | 16 canais em 1080p real | 4K real ou IA embarcada |
| **computador** | poucos fluxos e detector | os 16 canais e o detector | modelo de visão dentro da loja |
| **placa de vídeo** | acelera o detector | 16 GB | 24 GB ou mais |

`nivel` é o porte do equipamento. `serve_para` é o casamento com o uso. O
orçamento usa os dois: entre as câmeras que **servem** ao que o canal vai
analisar, oferece até três opções — uma por nível.

## Como cadastrar um modelo

1. Copie um arquivo parecido da mesma pasta.
2. Preencha só o que você **sabe**. Campo que não se sabe fica de fora — nunca
   um palpite com cara de ficha.
3. Mediu alguma coisa em campo? Entra em `medido`, com a data e a condição.
4. `npm test` na pasta `api` confere o arquivo.

## O que ainda não está aqui

- **O requisito de cada uso** (px por cm, quadros por segundo, cor, WDR) segue
  na tabela `requisito_uso`. Vem para cá junto com a carga no banco.
- **A classe de cada canal** pelo uso que se faz dele, e o **orçamento**
  montado em cima disso: próximos passos.
