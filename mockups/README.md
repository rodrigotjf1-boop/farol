# Protótipos

Referência **visual e de comportamento** das telas. O protótipo mostra como a
tela deve ficar e reagir; não é o app, e os dados dentro dele são exemplo.

| arquivo | o que é | situação |
|---|---|---|
| `farol-console.html` | o console inteiro: entrada, painel "o que o Farol viu", canais, área do canal, critérios, alertas, orçamento e lojas | aprovado pelo dono em 07/10/2026 e portado para `web/` |
| `farol-console.html`, tela **Análises** | o que foi julgado, hora a hora: filtro por período, horas, canal, critério e onde foi julgado (na loja ou na nuvem); gráfico que também é filtro; custo total e médio da nuvem | aprovado pelo dono em 07/10/2026 e portado para `web/` |
| `farol-console.html`, bloco **Máquina de análise** (dentro de Análises) | uso do computador da loja: processador, memória, placa de vídeo e disco, hora a hora, seguindo o período e as horas do recorte | aprovado pelo dono em 07/10/2026 e portado para `web/` |
| `farol-console.html`, aba **Padrões** (dentro de Análises) | como a loja costuma funcionar e o que fugiu disso: o parecer, a semana típica, o que anda junto, as saídas do padrão com a revisão ("era esperado" / "é problema" → correção → critério), a tendência e as sugestões para os critérios | aprovado pelo dono em 08/10/2026 e portado para `web/` com a fase 5 do A16 (08/10/2026). As frases, que eram exemplos escritos à mão, passaram a ser as que o servidor monta, com os números do exemplo; o que a tela tem e o protótipo aprovado não tinha está em `docs/decisoes.md`, "O especialista" |
| `farol-console.html`, aba **Planta** (dentro de Canais) | os ambientes, os equipamentos e cada câmera no lugar, com o campo de visão; em perspectiva e de cima; situação agora e cobertura; edição por arrasto | aprovado pelo dono em 08/10/2026. **Em `web/`** desde 08/10 (Canais → Planta). O que a tela tem de diferente do aprovado foi levado ao protótipo — ligar o móvel a um equipamento do inventário, "Tirar da planta" para a câmera, o canal que ainda não está na planta e a frase do lugar — e está em `docs/decisoes.md` (08/10, "A planta da loja"). As portas do exemplo não existem na tela: o protótipo não tem ferramenta para desenhá-las |
| `farol-console.html`, aba **Inventário** (dentro de Canais) | os equipamentos por setor: até quatro fotos de cada um limpo, onde aparece, a descrição feita uma vez e o que vale conferir nele | aprovado pelo dono em 08/10/2026. **Em `web/`** desde 08/10 (Canais → Inventário): o cadastro, as fotos, onde aparece, a descrição e "Analisar as fotos e descrever" (a descrição feita uma vez, com o que vale conferir). O que a tela tem de diferente do aprovado foi levado ao protótipo e está em `docs/decisoes.md` (08/10, "O inventário") |
| `farol-console.html`, **foto padrão** (em "Quadro e área") e as opções novas da gaveta do critério | a foto do ambiente limpo e a comparação com o quadro de agora; no critério: "quando vale a pena conferir", a faixa de horas, "avisar só se continuar" e a comparação com a foto padrão | aprovado pelo dono em 08/10/2026. **Em `web/`:** tudo — "quando vale a pena conferir", a faixa de horas e "avisar só se continuar" (fase 1), e a foto padrão com a comparação (fase 2, 08/10). O que a tela da foto padrão tem de diferente do aprovado foi levado ao protótipo e está em `docs/decisoes.md` (08/10, "A foto padrão") |
| `farol-console.html`, linha **“nada a conferir”** (dentro de Análises) | quantas olhadas a loja segurou sem perguntar à nuvem, no recorte, por critério | entrou junto com a fase 1 (08/10/2026), **sem ter passado pela aprovação das telas**: é uma linha de texto, e está em `web/` |
| `farol-console.html`, **área por pontos** (em "Quadro e área") | o contorno da área feito de pontos: arrastar ponto, criar ponto pelo meio do lado, teclado, tirar, desfazer, números, aviso de contorno cruzado e de sobreposição | pedido do dono em 08/10/2026 ("a marcação tem que ser flexível"); entrou junto no protótipo e em `web/`, **sem ter passado pela aprovação das telas** |
| `farol-console-novo.html` — **a cara nova**, telas da onda 1 do A19 | o canal com a imagem completa, os quadros (com papel) e os critérios de cada um; a cena do canal e o tipo de negócio; a gaveta do critério com o estudo (contexto, gatilho, janela, ação, desfecho, fora de contexto), o funil em números e os quatro estados; a gaveta do quadro; "ir para" (Ctrl+K) | **aprovado pelo dono em 09/10/2026** (versão 3, com os dois recados dele: a cena é escrita por quem usa, sem "propor a partir da imagem", e o que sobe para a nuvem é lógica interna, fora da tela). No console entraram, com as peças de hoje, a tela do canal, a cena e a gaveta do quadro (`/pontos/:id`) e, em seguida, **a gaveta do critério** — as famílias, o estudo, o funil e os estados — e **o "ir para" (Ctrl K)**, com o botão no menu lateral; o "Propor o estudo" ainda não (no lugar da proposta, o estudo começa por um modelo ou do zero). Onde cada tela diverge do aprovado está em `docs/decisoes.md` (09/10, "A imagem completa de volta…", "A gaveta nova do critério…" e "O 'ir para' (Ctrl K)…"). Com o critério novo nascendo "observando", três frases de `farol-console.html` que diziam "nasce desligado" foram trocadas no mesmo PR (o aviso de critério criado e, em Padrões, a opção de "É problema" e a frase da revisão). Partes em `novo/partes/`; montar com `node mockups/novo/montar.mjs`. É a primeira peça do protótipo geral da cara nova (roadmap, A18, frente 7) |
| `farol-conexoes-e-fichas.html` — **as fichas de qualquer origem** (Regem, planilha, outro sistema) | **Conexões** (da conta): o que o Farol lê e o que não lê, conectar ao Regem, ligar cada loja de lá a uma loja daqui, autorizar outra loja e desconectar; o acesso para **outro sistema** (criar, o código que aparece uma vez, revogar) e o cartão da planilha. **Fichas** (da loja): os produtos com a ficha na ordem, as variações e o que o cliente pode pedir a mais ou tirar — só leitura; a loja sem fichas com os **três jeitos** de tê-las; **importar por planilha** em três passos (o modelo, enviar, conferir o que entra e o que fica de fora) e a lista do que ficou de fora. O **"Mais"** na barra de baixo do celular. Situações: sem fichas, planilha, planilha com produtos de fora, outro sistema (novo e enviando), voltou do Regem, conectado, Regem sem fichas, a busca falhou, acesso tirado no Regem, carregando, sem resposta; e os perfis (diretoria, gerente, supervisão) | **aprovado pelo dono em 11/10/2026** (a primeira versão, com o plano "Regem no Farol"; e a de "qualquer origem", à noite: "pode começar pela planilha", com "entra o que está certo e a tela lista o que ficou de fora"). **No console:** Conexões e Fichas pelo Regem (fatias 1 e 2), a planilha e a porta para outro sistema (servidor e tela de cada uma) e o "Mais" na barra do celular: **o protótipo está inteiro no console**. Onde a tela diverge do aprovado está em `docs/decisoes.md` (11/10, "as fichas por planilha — a tela" e "a porta para outro sistema — a tela"; 12/10, "o 'Mais' na barra do celular"). Partes em `regem/partes/`; montar com `node mockups/regem/montar.mjs` |

Abre com dois cliques. No canto de baixo, o botão **Protótipo** troca a
situação da loja (em operação, loja nova, carregando, agente fora do ar), o
perfil de quem olha e o tema.

O que o app faz diferente do protótipo está listado em `docs/roadmap.md`,
seção A14 — incluindo duas coisas que o protótipo mostra e o app ainda não
faz, à espera de decisão ("pacote indicado" e "pontos de atenção" na lista de
lojas).

## Como usar

- Antes de implementar ou ajustar uma tela, abra o protótipo dela e replique
  disposição, textos, estados vazios e reações.
- Ao terminar, compare com o protótipo e liste o que ficou diferente.
- Mudou a tela de propósito? Mude o protótipo no mesmo PR.

## Como alterar

As partes ficam em `console/partes/` e entram em ordem de nome:

| parte | conteúdo |
|---|---|
| `00-sprite.html` | os ícones (gerado por `icones.mjs`) |
| `01-estilo.css`, `02-ajustes.css` | cores, tipografia e componentes |
| `10-moldura-abre.html` | a entrada e a navegação |
| `20-` a `60-` | uma tela por arquivo |
| `80-moldura-fecha.html` | menus, gavetas, diálogo e os controles do protótipo |
| `90-comportamento.js` | navegação, dados de exemplo e reações |

Depois de mexer:

```
node mockups/console/montar.mjs
```

O protótipo das telas que usam o Regem fica em `regem/partes/` e usa o estilo de base da cara nova
(`novo/partes/01-estilo.css`), acrescentando só o que é dele (`20-regem.css`):

```
node mockups/regem/montar.mjs
```

## De onde vêm as peças

- **Cores e logotipo:** kit de marca do Farol. As letras do logotipo estão em
  `console/letras.html`, copiadas do kit sem redesenho.
- **Ícones:** [Lucide](https://lucide.dev), licença ISC.
- **Fontes:** Bricolage Grotesque (títulos), Figtree (texto) e JetBrains Mono
  (números e endereços), do Google Fonts.
