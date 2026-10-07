# Protótipos

Referência **visual e de comportamento** das telas. O protótipo mostra como a
tela deve ficar e reagir; não é o app, e os dados dentro dele são exemplo.

| arquivo | o que é | situação |
|---|---|---|
| `farol-console.html` | o console inteiro: entrada, painel "o que o Farol viu", canais, área do canal, critérios, alertas, orçamento e lojas | aprovado pelo dono em 07/10/2026 e portado para `web/` |
| `farol-console.html`, tela **Análises** | o que foi julgado, hora a hora: filtro por período, horas, canal, critério e onde foi julgado (na loja ou na nuvem); gráfico que também é filtro; custo total e médio da nuvem | **em aprovação** (07/10/2026); ainda não está em `web/` |

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

## De onde vêm as peças

- **Cores e logotipo:** kit de marca do Farol. As letras do logotipo estão em
  `console/letras.html`, copiadas do kit sem redesenho.
- **Ícones:** [Lucide](https://lucide.dev), licença ISC.
- **Fontes:** Bricolage Grotesque (títulos), Figtree (texto) e JetBrains Mono
  (números e endereços), do Google Fonts.
