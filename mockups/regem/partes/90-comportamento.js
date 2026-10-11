(function () {
  'use strict';

  var raiz = document.documentElement;
  var tela = document.getElementById('tela');
  var sobre = document.getElementById('sobre');

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function ic(nome, classe) {
    return '<svg class="ic' + (classe ? ' ' + classe : '') + '" aria-hidden="true"><use href="#i-' + nome + '"/></svg>';
  }
  function semAcento(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function plural(n, um, varios) { return n + ' ' + (n === 1 ? um : varios); }

  /* ─────────── os dados de exemplo ─────────── */
  var LOJAS_DO_FAROL = [
    { id: 'centro', nome: 'Loja Centro' },
    { id: 'barra', nome: 'Loja Barra' }
  ];
  // o que o Regem devolve depois de autorizado: as lojas que a diretoria marcou lá
  var LOJAS_DO_REGEM = [
    { id: 'r-centro', nome: 'Casa do Lanche · Centro', sugestao: 'centro' },
    { id: 'r-barra', nome: 'Casa do Lanche · Barra', sugestao: 'barra' }
  ];
  var EMPRESA_NO_REGEM = 'Casa do Lanche Alimentação Ltda';
  // o outro sistema, com o nome que a diretoria deu ao criar o acesso
  var SISTEMA = 'ERP da rede';
  var CODIGO_DE_EXEMPLO = 'FAROL-EXEMPLO-7K2M-QX4D-9TBN';
  var DOCUMENTACAO = 'monitorfarol.com.br/integracao';
  var UNIDADES = 'g, kg, ml, l, unidade, fatia, folha, rodela, colher, pitada';

  // a base de fichas da loja (sem preço e sem custo: o Farol não recebe nem pede)
  var PRODUTOS = [
    {
      id: 'xb', nome: 'X-Burger', categoria: 'Burgers', cozinha: true,
      variacoes: [['Simples', 'a ficha inteira'], ['Duplo', 'duas vezes a ficha']],
      ficha: { nome: 'X-Burger', ingredientes: [
        ['Pão brioche', '1 unidade', ''],
        ['Blend da casa', '120 g', 'preparo da casa — entra como um ingrediente só'],
        ['Queijo prato', '2 fatias', ''],
        ['Cebola roxa', '10 g', ''],
        ['Molho da casa', '15 g', 'preparo da casa — entra como um ingrediente só'],
        ['Sal', '2 g', '']
      ] },
      adicionais: [
        ['mais', 'Bacon', 'acrescenta 20 g de Bacon fatiado'],
        ['mais', 'Ovo', 'acrescenta o preparo “Ovo frito”'],
        ['mais', 'Refrigerante', 'acrescenta o produto “Refrigerante lata”'],
        ['info', 'Ponto da carne', 'só uma observação para a cozinha'],
        ['menos', 'Sem cebola', 'tira a Cebola roxa']
      ]
    },
    {
      id: 'xs', nome: 'X-Salada', categoria: 'Burgers', cozinha: true,
      variacoes: [],
      ficha: { nome: 'X-Salada', ingredientes: [
        ['Pão brioche', '1 unidade', ''],
        ['Molho da casa', '15 g', 'preparo da casa — entra como um ingrediente só'],
        ['Alface', '2 folhas', ''],
        ['Tomate', '2 rodelas', ''],
        ['Blend da casa', '120 g', 'preparo da casa — entra como um ingrediente só'],
        ['Queijo prato', '1 fatia', '']
      ] },
      adicionais: [['mais', 'Bacon', 'acrescenta 20 g de Bacon fatiado'], ['menos', 'Sem tomate', 'tira o Tomate']]
    },
    {
      id: 'bat', nome: 'Batata frita', categoria: 'Porções', cozinha: true,
      variacoes: [['Média', 'a ficha inteira'], ['Grande', 'uma vez e meia a ficha']],
      ficha: { nome: 'Batata frita', ingredientes: [['Batata palito', '200 g', ''], ['Sal', '3 g', '']] },
      adicionais: [['mais', 'Cheddar', 'acrescenta 40 g de Cheddar cremoso']]
    },
    {
      id: 'cmb', nome: 'Combo da casa', categoria: 'Combos', cozinha: true,
      variacoes: [], ficha: null, combo: ['1 X-Burger', '1 Batata frita', '1 Refrigerante lata'], adicionais: []
    },
    { id: 'mil', nome: 'Milk-shake', categoria: 'Sobremesas', cozinha: true, variacoes: [['300 ml', ''], ['500 ml', '']], ficha: null, adicionais: [] },
    { id: 'ref', nome: 'Refrigerante lata', categoria: 'Bebidas', cozinha: false, variacoes: [], ficha: null, adicionais: [] },
    { id: 'agu', nome: 'Água sem gás', categoria: 'Bebidas', cozinha: false, variacoes: [], ficha: null, adicionais: [] }
  ];

  // o modelo da planilha: a aba "Fichas", uma linha por ingrediente
  var COLUNAS = [
    ['Produto', 'sempre', 'X-Burger', 'O nome como aparece no pedido. Repete em cada linha do produto.'],
    ['Código', 'se quiser', '1042', 'O código do produto no sistema da loja, se houver.'],
    ['Categoria', 'se quiser', 'Burgers', 'Só para achar o produto na lista.'],
    ['Vai para a cozinha', 'se quiser', 'sim', '“não” para o que sai pronto, como bebida em lata. Em branco vale “sim”.'],
    ['Ingrediente', 'sempre', 'Pão brioche', 'Um por linha, na ordem da montagem. Em branco: o produto entra sem ficha.'],
    ['Quantidade', 'com ingrediente', '120', 'Só o número. Vírgula para decimal.'],
    ['Unidade', 'com ingrediente', 'g', 'Uma da lista: ' + UNIDADES + '.']
  ];
  var OUTRAS_ABAS = [
    ['Variações', 'quando o mesmo produto sai em tamanhos', 'Produto · Variação · Quanto da ficha (1 = inteira, 2 = o dobro, 0,5 = metade)'],
    ['Adicionais', 'o que o cliente pode pedir a mais ou tirar', 'Produto · Adicional · O que faz (acrescenta, tira ou só observação) · Ingrediente · Quantidade · Unidade'],
    ['Combos', 'produto feito de outros produtos', 'Combo · Produto que vem nele · Quantidade']
  ];
  var PROBLEMAS = [
    ['linha 6', 'X-Burger · Queijo prato: falta a quantidade.', 'Preencha a coluna Quantidade.'],
    ['linha 11', 'X-Salada · Alface: a unidade “fls” não está na lista.', 'Use uma destas: ' + UNIDADES + '.'],
    ['linha 19', 'Batata frita: o produto aparece em dois blocos de linhas, separados por outro produto.', 'Junte as linhas do produto, uma embaixo da outra, na ordem da montagem.']
  ];

  var SITUACOES = ['nao', 'planilha', 'sistema-novo', 'sistema', 'voltou', 'conectado', 'semfichas', 'problema', 'revogado', 'carregando', 'erro'];
  var DO_REGEM = ['voltou', 'conectado', 'semfichas', 'problema', 'revogado'];
  var est = { tela: 'fichas', situacao: 'conectado', perfil: 'diretoria', filtro: 'todos', busca: '', pares: {}, acessos: [], imp: null, novo: null };
  LOJAS_DO_REGEM.forEach(function (r) { est.pares[r.id] = r.sugestao; });

  function diretoria() { return est.perfil === 'diretoria'; }
  // quem configura a loja: importa a planilha e pede a busca. A supervisão só vê.
  function configura() { return est.perfil !== 'supervisao'; }
  function origem() {
    if (est.situacao === 'planilha') return 'planilha';
    if (est.situacao === 'sistema' || est.situacao === 'sistema-novo') return 'sistema';
    if (DO_REGEM.indexOf(est.situacao) >= 0) return 'regem';
    return 'nenhuma';
  }
  // ligada ao Regem (as duas lojas do exemplo): uma loja recebe as fichas de um lugar só
  function ligadaAoRegem() { return ['conectado', 'semfichas', 'problema', 'revogado'].indexOf(est.situacao) >= 0; }
  // com o acesso tirado no Regem as fichas são apagadas (a mesma regra do desconectar): a loja fica sem fichas
  function temFichas() { return ['conectado', 'semfichas', 'problema', 'planilha', 'sistema'].indexOf(est.situacao) >= 0; }
  function produtos() {
    if (est.situacao !== 'semfichas') return PRODUTOS;
    return PRODUTOS.map(function (p) { var c = {}; for (var k in p) c[k] = p[k]; c.ficha = null; return c; });
  }
  function comFicha(lista) { return lista.filter(function (p) { return !!p.ficha; }).length; }
  function nomeDaLoja(id) { var n = ''; LOJAS_DO_FAROL.forEach(function (l) { if (l.id === id) n = l.nome; }); return n; }
  // a frase só manda usar o botão para quem tem o botão
  function comOBotao(com, sem) { return configura() ? com : sem; }

  /* ─────────── de onde vieram, dito uma vez ─────────── */
  function chipsDaOrigem() {
    var o = origem();
    if (o === 'planilha') return '<span class="chip mono">da planilha</span><span class="chip ok">importada hoje, 14:02</span>';
    if (o === 'sistema') return '<span class="chip mono">do ' + esc(SISTEMA) + '</span><span class="chip ok">recebido hoje, 14:02</span>';
    if (est.situacao === 'problema') return '<span class="chip mono">do Regem</span><span class="chip fora">a busca de hoje falhou</span>';
    return '<span class="chip mono">do Regem</span><span class="chip ok">atualizado hoje, 04:10</span>';
  }
  function avisoDaLeitura() {
    if (est.situacao === 'problema') {
      return '<div class="aviso fora" role="status">' + ic('alerta') + '<div><b>O Farol não conseguiu ler o Regem na busca de hoje, às 04:10.</b> As fichas abaixo são as de ontem. Ele tenta de novo sozinho' + comOBotao('; para tentar já, use “Buscar agora”.', '.') + '</div></div>';
    }
    if (est.situacao === 'semfichas') {
      return '<div class="aviso facho" role="status">' + ic('info') + '<div><b>O Regem desta loja ainda não tem fichas técnicas.</b> Sem ficha, o Farol sabe o que foi pedido, mas não como o produto é montado. As fichas se cadastram no Regem, em <b>Estoque › Fichas técnicas</b>' + comOBotao('; depois, use “Buscar agora” para trazê-las.', '; depois, elas chegam aqui na busca do dia seguinte.') + '</div></div>';
    }
    return '';
  }
  function notaDaLista() {
    var o = origem();
    if (o === 'planilha') return 'Aqui não se edita: para mudar, corrija a planilha e importe de novo. A importação troca todas as fichas da loja.';
    if (o === 'sistema') return 'Aqui não se edita: as fichas são do ' + esc(SISTEMA) + ', que as envia quando mudam. O Farol não recebe preço, custo, nem quem é o cliente.';
    return 'Aqui não se edita: as fichas são do Regem. O Farol não recebe preço, custo, nem quem é o cliente.';
  }

  /* ─────────── a tela Fichas (da loja) ─────────── */
  function linhaDoProduto(p) {
    var marcas = '';
    marcas += p.ficha ? '<span class="chip ok">' + plural(p.ficha.ingredientes.length, 'ingrediente', 'ingredientes') + '</span>' : (p.combo ? '<span class="chip">combo de ' + p.combo.length + '</span>' : '<span class="chip">sem ficha</span>');
    if (p.variacoes.length) marcas += '<span class="chip">' + plural(p.variacoes.length, 'variação', 'variações') + '</span>';
    if (p.adicionais.length) marcas += '<span class="chip">' + plural(p.adicionais.length, 'adicional', 'adicionais') + '</span>';
    return '<button class="linha" type="button" data-produto="' + p.id + '" id="linha-' + p.id + '">' +
      '<span class="nome"><b>' + esc(p.nome) + '</b><small>' + esc(p.categoria) + '</small></span>' +
      '<span>' + (p.cozinha ? '<span class="chip facho">vai para a cozinha</span>' : '<span class="suave">não passa pela cozinha</span>') + '</span>' +
      '<span class="marcas">' + marcas + '</span>' + ic('seta', 'p') + '</button>';
  }
  // os três jeitos de a loja ter fichas — o Regem é um deles, não o único
  function tresJeitos() {
    var s = '<div class="abre-vias"><h2>Esta loja ainda não tem fichas</h2><p>Com as fichas, o Farol passa a saber como cada produto deve ser montado. Elas vêm de onde a loja já cadastra o cardápio — escolha um dos três jeitos. Uma loja recebe as fichas de um lugar só.</p></div><div class="vias">';
    s += '<section class="via" aria-labelledby="via-regem">' + ic('tomada', 'g') + '<div><p class="para">para quem usa o Regem</p><h3 id="via-regem">Conectar ao Regem</h3></div><p>Você autoriza no Regem, com a sua conta de lá, e as fichas chegam sozinhas — e se atualizam sozinhas.</p>' +
      (diretoria() ? '<button class="btn cheio" type="button" data-ir="conexoes">' + ic('tomada', 'p') + 'Conectar ao Regem</button>' : '<p class="nota">Só a diretoria conecta o Regem.</p>') + '</section>';
    s += '<section class="via" aria-labelledby="via-planilha">' + ic('planilha', 'g') + '<div><p class="para">para quem tem as fichas no Excel</p><h3 id="via-planilha">Importar planilha</h3></div><p>Baixe o modelo, preencha uma linha por ingrediente e envie. Para mudar depois, é importar de novo.</p>' +
      (configura() ? '<button class="btn cheio" type="button" data-importar id="abrir-importar">' + ic('enviar', 'p') + 'Importar planilha</button>' : '<p class="nota">Quem importa é quem configura a loja.</p>') + '</section>';
    s += '<section class="via" aria-labelledby="via-sistema">' + ic('sistema', 'g') + '<div><p class="para">para quem usa outro sistema</p><h3 id="via-sistema">Receber de outro sistema</h3></div><p>O sistema da loja envia as fichas para o Farol. Você cria o acesso e entrega a quem cuida dele, com a documentação.</p>' +
      (diretoria() ? '<button class="btn cheio" type="button" data-ir="conexoes">' + ic('chave', 'p') + 'Criar acesso em Conexões</button>' : '<p class="nota">Só a diretoria cria o acesso.</p>') + '</section>';
    return s + '</div>';
  }
  function telaFichas() {
    var o = origem();
    var s = '<div class="cab"><div><h1>Fichas</h1>';
    if (temFichas()) s += '<div class="sobre">' + chipsDaOrigem() + '</div>';
    s += '<p class="suave" style="margin-top:8px;max-width:64ch">O que a loja vende e do que cada produto é feito.</p></div>';
    if (temFichas()) {
      var acoes = '';
      if (o === 'regem' && configura()) acoes += '<button class="btn" type="button" data-buscar>' + ic('atualizar', 'p') + 'Buscar agora</button>';
      if (o === 'planilha' && configura()) acoes += '<button class="btn" type="button" data-importar id="abrir-importar">' + ic('enviar', 'p') + 'Importar de novo</button><button class="btn" type="button" data-baixar="planilha">' + ic('baixar', 'p') + 'Baixar a planilha</button>';
      if (o !== 'planilha' && diretoria()) acoes += '<button class="btn so-largo" type="button" data-ir="conexoes">' + ic('tomada', 'p') + 'Conexões</button>';
      if (acoes) s += '<div class="acoes">' + acoes + '</div>';
    }
    s += '</div>';

    if (est.situacao === 'nao') return s + tresJeitos();
    if (est.situacao === 'sistema-novo') {
      return s + '<div class="vazio" role="status">' + ic('sistema', 'g') + '<h2>O ' + esc(SISTEMA) + ' ainda não enviou as fichas</h2><p>O acesso dele a esta loja foi criado hoje, às 13:40. Assim que o sistema enviar, as fichas aparecem aqui — sem ninguém precisar fazer nada no Farol.</p>' +
        (diretoria() ? '<button class="btn" type="button" data-ir="conexoes">' + ic('tomada', 'p') + 'Ver o acesso em Conexões</button>' : '') + '</div>';
    }
    if (est.situacao === 'voltou') {
      return s + '<div class="vazio">' + ic('tomada', 'g') + '<h2>Falta ligar esta loja ao Regem</h2><p>O Regem já autorizou. Falta dizer qual loja de lá é a Loja Centro; feito isso, o Farol busca as fichas na hora.</p>' +
        (diretoria() ? '<button class="btn cheio" type="button" data-ir="conexoes">Ligar as lojas</button>' : '<p class="nota">Quem liga as lojas é a diretoria.</p>') + '</div>';
    }
    if (est.situacao === 'revogado') {
      return s + '<div class="vazio" role="status">' + ic('alerta', 'g') + '<h2>O acesso desta loja foi tirado no Regem</h2><p>Foi hoje, às 09:12. Sem o acesso, o Farol apagou as fichas que tinha de lá, e os critérios que usam ficha pararam de conferir. Para tê-las de volta, é conectar de novo.</p>' +
        (diretoria() ? '<button class="btn cheio" type="button" data-ir="conexoes">' + ic('tomada', 'p') + 'Conectar de novo</button>' : '<p class="nota">Só a diretoria conecta o Regem.</p>') + '</div>';
    }

    var todos = produtos(), n = todos.length, cf = comFicha(todos);
    var b = semAcento(est.busca.trim());
    var lista = todos.filter(function (p) {
      if (est.filtro === 'com' && !p.ficha) return false;
      if (est.filtro === 'sem' && p.ficha) return false;
      return !b || semAcento(p.nome + ' ' + p.categoria).indexOf(b) >= 0;
    });
    s += avisoDaLeitura();
    s += '<div class="barra"><label class="sr" for="busca-fichas">Buscar produto</label><input class="entrada" id="busca-fichas" type="search" placeholder="Buscar produto ou categoria" value="' + esc(est.busca) + '" autocomplete="off">';
    s += '<div class="seg" role="group" aria-label="Quais produtos">';
    [['todos', 'Todos', n], ['com', 'Com ficha', cf], ['sem', 'Sem ficha', n - cf]].forEach(function (f) {
      s += '<button type="button" data-filtro="' + f[0] + '" aria-pressed="' + (est.filtro === f[0]) + '">' + f[1] + ' <span class="mono">' + f[2] + '</span></button>';
    });
    s += '</div></div>';
    if (!lista.length) {
      return s + '<div class="vazio"><h2>Nenhum produto com esse filtro</h2><p>Mude a busca ou volte a ver todos.</p><button class="btn" type="button" data-limpar>Ver todos</button></div>';
    }
    s += '<div class="lista" role="list" aria-label="Produtos da loja"><div class="lista-cab" aria-hidden="true"><span>Produto</span><span>Cozinha</span><span>O que o Farol sabe dele</span><span></span></div>';
    lista.forEach(function (p) { s += linhaDoProduto(p); });
    s += '</div>';
    s += '<p class="nota">' + ic('cadeado', 'p') + ' ' + notaDaLista() + '</p>';
    return s;
  }
  function folhaDoProduto(id) {
    var p = null, o = origem();
    produtos().forEach(function (x) { if (x.id === id) p = x; });
    if (!p) return '';
    var onde = o === 'planilha' ? 'na planilha' : o === 'sistema' ? 'no que o ' + esc(SISTEMA) + ' enviou' : 'no Regem';
    var comoPor = o === 'planilha' ? 'Para ele ter ficha, preencha os ingredientes na planilha e importe de novo.' : o === 'sistema' ? 'A ficha se cadastra no ' + esc(SISTEMA) + '.' : 'A ficha se cadastra no Regem, em <b>Estoque › Fichas técnicas</b>.';
    var s = '<aside class="folha estreita" role="dialog" aria-modal="true" aria-labelledby="folha-titulo"><div class="folha-cab"><div><h2 id="folha-titulo">' + esc(p.nome) + '</h2><p>' + esc(p.categoria) + (p.cozinha ? ' · vai para a cozinha' : ' · não passa pela cozinha') + '</p></div><button class="btn quadrado fantasma" type="button" data-fechar aria-label="Fechar" data-foco>' + ic('x') + '</button></div><div class="folha-corpo">';
    if (p.ficha) {
      s += '<div class="bloco"><h3>A ficha, na ordem em que foi cadastrada</h3><ol class="ingredientes">';
      p.ficha.ingredientes.forEach(function (i) {
        s += '<li><span>' + esc(i[0]) + (i[2] ? '<small>' + esc(i[2]) + '</small>' : '') + '</span><span class="q">' + esc(i[1]) + '</span></li>';
      });
      s += '</ol>' + (o === 'regem' ? '<p class="nota">A embalagem que só entra no pedido para viagem fica fora desta lista.</p>' : '') + '</div>';
    } else if (p.combo) {
      s += '<div class="bloco"><h3>O que vem no combo</h3><ul class="escolhas">';
      p.combo.forEach(function (c) { s += '<li>' + ic('certo', 'p') + '<span>' + esc(c) + '</span></li>'; });
      s += '</ul><p class="nota">Cada produto do combo é conferido pela ficha dele.</p></div>';
    } else {
      s += '<div class="aviso">' + ic('info') + '<div><b>Este produto não tem ficha ' + onde + '.</b> ' + (p.cozinha ? 'O Farol sabe que a loja o vende, mas não como é montado. ' + comoPor : 'Para o que não passa pela cozinha, não faz falta.') + '</div></div>';
    }
    if (p.variacoes.length) {
      s += '<div class="bloco"><h3>Variações</h3><div class="variacoes">';
      p.variacoes.forEach(function (v) { s += '<span class="chip">' + esc(v[0]) + (v[1] ? ' · ' + esc(v[1]) : '') + '</span>'; });
      s += '</div></div>';
    }
    if (p.adicionais.length) {
      s += '<div class="bloco"><h3>O que o cliente pode pedir a mais ou tirar</h3><ul class="escolhas">';
      p.adicionais.forEach(function (a) { s += '<li>' + ic(a[0], 'p') + '<span>' + esc(a[1]) + '<small>' + esc(a[2]) + '</small></span></li>'; });
      s += '</ul></div>';
    }
    var pe = o === 'planilha' ? 'Para mudar, corrija a planilha e importe de novo.'
      : o === 'sistema' ? 'Para mudar, mude no ' + esc(SISTEMA) + ': ele envia as fichas para cá.'
      : 'Para mudar, mude no Regem. O Farol busca as fichas uma vez por dia' + comOBotao('; para trazer já, use “Buscar agora”.', '.');
    s += '</div><div class="folha-pe"><p class="nota">' + pe + '</p><button class="btn" type="button" data-fechar>Fechar</button></div></aside>';
    return s;
  }

  /* ─────────── importar por planilha: o modelo, o envio, a conferência ─────────── */
  function passosDaImportacao(atual) {
    var s = '<ol class="passos" aria-label="Passos da importação">';
    ['O modelo', 'Enviar', 'Conferir'].forEach(function (nome, i) {
      var n = i + 1;
      s += '<li' + (n === atual ? ' aria-current="step"' : n < atual ? ' class="feito"' : '') + '>' + nome + '</li>';
    });
    return s + '</ol>';
  }
  function folhaImportar() {
    var i = est.imp, s, pe;
    s = '<aside class="folha" role="dialog" aria-modal="true" aria-labelledby="imp-titulo"><div class="folha-cab"><div><h2 id="imp-titulo">Importar fichas por planilha</h2><p>Loja Centro</p></div><button class="btn quadrado fantasma" type="button" data-fechar aria-label="Fechar">' + ic('x') + '</button></div><div class="folha-corpo">';
    s += passosDaImportacao(i.passo);
    if (i.passo === 1) {
      s += '<p>A planilha tem <b>uma linha por ingrediente</b>, na ordem em que o produto é montado. O nome do produto se repete nas linhas dele.</p>';
      s += '<div class="bloco"><h3>A aba “Fichas” — a única obrigatória</h3><div class="colunas" role="table" aria-label="As colunas da aba Fichas"><div class="cab-col" role="row"><span role="columnheader">Coluna</span><span role="columnheader">Preencher</span><span role="columnheader">Exemplo</span><span role="columnheader">O que é</span></div>';
      COLUNAS.forEach(function (c) {
        s += '<div class="col" role="row"><b role="cell">' + esc(c[0]) + '</b><span role="cell"><span class="rot">preencher</span>' + esc(c[1]) + '</span><span role="cell"><span class="rot">exemplo</span><span class="ex">' + esc(c[2]) + '</span></span><span class="oq" role="cell">' + esc(c[3]) + '</span></div>';
      });
      s += '</div></div>';
      s += '<div class="bloco"><h3>As outras abas — só se a loja usar</h3><ul class="abas-do-modelo">';
      OUTRAS_ABAS.forEach(function (a) { s += '<li><span><b>' + esc(a[0]) + '</b> — ' + esc(a[1]) + '</span><small class="mono">' + esc(a[2]) + '</small></li>'; });
      s += '</ul></div>';
      s += '<p class="nota">O modelo já vem com as abas, os títulos das colunas e duas fichas de exemplo para apagar. Coluna que não é do modelo é ignorada. Preço e custo não são pedidos: o Farol não usa.</p>';
      pe = '<button class="btn" type="button" data-baixar="modelo" data-foco>' + ic('baixar', 'p') + 'Baixar o modelo</button><button class="btn cheio" type="button" data-imp-passo="2">Já tenho a planilha preenchida</button>';
    } else if (i.passo === 2) {
      s += '<div class="soltar">' + ic('enviar', 'g') + '<p>Escolha a planilha preenchida. O Farol confere tudo antes de gravar: <b>nada entra pela metade</b>.</p><label class="sr" for="imp-arquivo">A planilha preenchida</label><input type="file" id="imp-arquivo" accept=".xlsx,.csv" data-foco><p class="nota">Aceita .xlsx e .csv, até 2 MB.</p></div>';
      s += '<div class="so-proto"><span>só no protótipo</span><div class="linha-acoes"><button class="btn mini" type="button" data-imp-simular="certa">Simular uma planilha certa</button><button class="btn mini" type="button" data-imp-simular="problemas">Simular uma planilha com problemas</button></div></div>';
      pe = '<button class="btn" type="button" data-imp-passo="1">Voltar ao modelo</button>';
    } else if (i.resultado === 'problemas') {
      s += '<div class="aviso fora" role="alert">' + ic('alerta') + '<div><b>A planilha tem ' + plural(PROBLEMAS.length, 'problema', 'problemas') + ', e nada foi importado.</b> Corrija na planilha e envie de novo. As fichas que a loja tem continuam como estavam.</div></div>';
      s += '<ul class="problemas" aria-label="O que corrigir">';
      PROBLEMAS.forEach(function (p) { s += '<li><span class="onde">' + esc(p[0]) + '</span><span>' + esc(p[1]) + '<small>' + esc(p[2]) + '</small></span></li>'; });
      s += '</ul>';
      pe = '<button class="btn" type="button" data-imp-passo="1">Voltar ao modelo</button><button class="btn cheio" type="button" data-imp-passo="2" data-foco>Enviar a planilha corrigida</button>';
    } else {
      s += '<div class="aviso" role="status">' + ic('certo') + '<div><b>A planilha está certa.</b> Nada foi gravado ainda: confira os números e importe.</div></div>';
      s += '<div class="contas"><span class="chip">7 produtos</span><span class="chip ok">3 com ficha</span><span class="chip">14 ingredientes</span><span class="chip">4 variações</span><span class="chip">8 adicionais</span><span class="chip">1 combo</span></div>';
      s += '<div class="aviso">' + ic('info') + '<div><b>3 produtos entram sem ficha</b>, porque não têm ingrediente na planilha: Milk-shake, Refrigerante lata e Água sem gás. Para o que não passa pela cozinha, não faz falta.</div></div>';
      if (est.situacao === 'planilha') {
        s += '<div class="aviso facho">' + ic('info') + '<div><b>Importar troca todas as fichas da Loja Centro</b> — as da planilha importada hoje, às 14:02, saem e estas entram no lugar.</div></div>';
      }
      pe = '<button class="btn" type="button" data-imp-passo="2">Enviar outra planilha</button><button class="btn cheio" type="button" data-imp-gravar data-foco>Importar</button>';
    }
    return s + '</div><div class="folha-pe">' + pe + '</div></aside>';
  }

  /* ─────────── a tela Conexões (da conta) ─────────── */
  function oQueLe() {
    return '<div class="duas"><div class="le"><h3>O que o Farol lê de cada loja</h3><ul>' +
      '<li>' + ic('certo', 'p') + '<span><b>O cardápio</b> — produtos, variações e adicionais</span></li>' +
      '<li>' + ic('certo', 'p') + '<span><b>As fichas técnicas</b> — os ingredientes de cada uma, na ordem</span></li>' +
      '<li>' + ic('certo', 'p') + '<span><b>A fila da cozinha</b> — o que foi pedido, com a observação</span></li>' +
      '</ul></div><div class="nao"><h3>O que ele não lê</h3><ul>' +
      '<li>' + ic('cadeado', 'p') + '<span>Preço, custo e margem</span></li>' +
      '<li>' + ic('cadeado', 'p') + '<span>Quem é o cliente</span></li>' +
      '<li>' + ic('cadeado', 'p') + '<span>Vendas, caixa, estoque e equipe</span></li>' +
      '</ul></div></div>';
  }
  function oQueRecebe() {
    return '<div class="duas"><div class="le"><h3>O que o outro sistema envia</h3><ul>' +
      '<li>' + ic('certo', 'p') + '<span><b>O cardápio</b> — produtos, variações e adicionais</span></li>' +
      '<li>' + ic('certo', 'p') + '<span><b>As fichas técnicas</b> — os ingredientes de cada uma, na ordem</span></li>' +
      '</ul></div><div class="nao"><h3>O que o Farol não recebe</h3><ul>' +
      '<li>' + ic('cadeado', 'p') + '<span>Preço, custo e margem</span></li>' +
      '<li>' + ic('cadeado', 'p') + '<span>Quem é o cliente</span></li>' +
      '<li>' + ic('cadeado', 'p') + '<span>Vendas, caixa, estoque e equipe</span></li>' +
      '</ul></div></div>';
  }
  function cartaoSemConexao() {
    var s = '<section class="cartao" aria-labelledby="t-regem"><header><h2 id="t-regem">Regem</h2><span class="chip empurra">não conectado</span></header><div class="miolo">';
    s += '<p>O Regem é onde a loja cadastra o cardápio e as fichas técnicas. Conectado, o Farol passa a saber como cada produto deve ser montado — e confere pela câmera.</p>';
    s += oQueLe();
    s += '<div class="bloco"><h3>Como funciona</h3><ol class="passo-a-passo"><li>Você vai para o Regem, já com a sua conta de lá.</li><li>Marca as lojas e autoriza.</li><li>Volta para cá e diz qual loja do Farol é cada uma.</li></ol></div>';
    if (diretoria()) {
      s += '<div class="linha-acoes"><button class="btn cheio" type="button" data-conectar>' + ic('fora', 'p') + 'Conectar ao Regem</button></div><p class="nota">Nenhuma senha é digitada aqui. Quem autoriza, no Regem, é o presidente da empresa.</p>';
    } else {
      s += '<div class="aviso">' + ic('cadeado') + '<div><b>Só a diretoria conecta o Regem.</b> Deixar outro sistema ser lido é decisão dela.</div></div>';
    }
    return s + '</div></section>';
  }
  function cartaoLigar() {
    var usados = {}, repetida = false;
    LOJAS_DO_REGEM.forEach(function (r) { var v = est.pares[r.id]; if (v) { if (usados[v]) repetida = true; usados[v] = true; } });
    var s = '<section class="cartao" aria-labelledby="t-ligar"><header><h2 id="t-ligar">Ligar as lojas</h2><span class="chip ok empurra">autorizado no Regem</span></header><div class="miolo">';
    s += '<p><b>' + esc(EMPRESA_NO_REGEM) + '</b> autorizou ' + plural(LOJAS_DO_REGEM.length, 'loja', 'lojas') + '. Diga qual loja do Farol é cada uma.</p><div class="pares">';
    LOJAS_DO_REGEM.forEach(function (r) {
      var v = est.pares[r.id], dup = v && LOJAS_DO_REGEM.filter(function (o) { return est.pares[o.id] === v; }).length > 1;
      s += '<div class="par' + (dup ? ' erro' : '') + '"><div class="de"><b>' + esc(r.nome) + '</b><small>no Regem</small></div>' + ic('seta', 'p') + '<div class="campo"><label for="par-' + r.id + '">No Farol</label><select class="entrada" id="par-' + r.id + '" data-par="' + r.id + '"' + (diretoria() ? '' : ' disabled') + '>';
      LOJAS_DO_FAROL.forEach(function (l) { s += '<option value="' + l.id + '"' + (v === l.id ? ' selected' : '') + '>' + esc(l.nome) + '</option>'; });
      s += '<option value=""' + (!v ? ' selected' : '') + '>Não usar esta loja agora</option></select>' + (dup ? '<small role="alert" style="color:var(--fora)">Duas lojas do Regem na mesma loja do Farol. Escolha outra.</small>' : '') + '</div></div>';
    });
    s += '</div><p class="nota">O Farol sugeriu os pares pelo nome: confira antes de salvar. A loja que ficar sem par não é lida, e o acesso dela é devolvido ao Regem.</p>';
    if (diretoria()) s += '<div class="linha-acoes"><button class="btn cheio" type="button" data-salvar-pares' + (repetida ? ' disabled' : '') + '>Salvar</button></div>';
    return s + '</div></section>';
  }
  function linhaDaConexao(farol, regem, i) {
    var estado, numeros;
    var tirado = est.situacao === 'revogado' && i === 0;
    if (est.situacao === 'problema' && i === 0) estado = '<span class="linha-de-estado"><span class="chip fora">a busca de hoje falhou</span><span class="suave">tenta de novo sozinho</span></span>';
    else if (tirado) estado = '<span class="linha-de-estado"><span class="chip fora">acesso tirado no Regem</span><span class="suave">hoje, 09:12</span></span>';
    else estado = '<span class="linha-de-estado"><span class="chip ok">atualizado hoje, ' + (i === 0 ? '04:10' : '04:12') + '</span></span>';
    numeros = tirado ? 'as fichas foram apagadas' : est.situacao === 'semfichas' ? '7 produtos · nenhuma ficha' : (i === 0 ? '7 produtos · 3 com ficha' : '9 produtos · 5 com ficha');
    var s = '<div class="conexao"><div class="de"><b>' + esc(farol) + '</b><small>' + esc(regem) + ', no Regem</small></div><div class="estado">' + estado + '<span class="suave mono">' + numeros + '</span></div><div class="acoes">';
    if (i === 0 && !tirado) s += '<button class="btn mini" type="button" data-ir="fichas">Ver fichas</button>';
    if (diretoria()) {
      if (est.situacao === 'revogado' && i === 0) s += '<button class="btn mini" type="button" data-conectar>' + ic('fora', 'p') + 'Conectar de novo</button>';
      else s += '<button class="btn mini perigo" type="button" data-desconectar="' + esc(farol) + '">Desconectar</button>';
    }
    return s + '</div></div>';
  }
  function cartaoConectado() {
    var s = '<section class="cartao" aria-labelledby="t-regem"><header><h2 id="t-regem">Regem</h2><span class="chip ok">conectado</span><span class="suave">' + esc(EMPRESA_NO_REGEM) + '</span>';
    if (diretoria()) s += '<button class="btn mini empurra" type="button" data-conectar>' + ic('mais', 'p') + 'Autorizar outra loja</button>';
    s += '</header><div class="miolo sem-folga">';
    s += linhaDaConexao('Loja Centro', 'Casa do Lanche · Centro', 0) + linhaDaConexao('Loja Barra', 'Casa do Lanche · Barra', 1);
    s += '</div></section>';
    s += '<section class="cartao" aria-labelledby="t-le"><header><h2 id="t-le">O que a conexão com o Regem lê</h2></header><div class="miolo">' + oQueLe() + '<p class="nota">O Farol busca as fichas quando a loja é ligada e, depois, uma vez por dia — ficha técnica não muda a toda hora. Para trazer uma mudança na hora, a tela Fichas tem o “Buscar agora”.</p><p class="nota">O acesso também pode ser tirado pelo Regem, em <b>Configurações → Aplicativos conectados</b>. Aqui ele aparece como “acesso tirado no Regem”, e as fichas daquela loja são apagadas.</p></div></section>';
    return s;
  }
  // outro sistema: o acesso é criado AQUI, por quem é da conta — ninguém da distribuição cola credencial
  function linhaDoAcesso(a, i) {
    var estado = a.enviou
      ? '<span class="chip ok">recebido hoje, 14:02</span><span class="suave mono">7 produtos · 3 com ficha</span>'
      : '<span class="chip">ainda não enviou nada</span><span class="suave mono">criado hoje, 13:40</span>';
    var s = '<div class="acesso"><div class="de"><b>' + esc(a.nome) + '</b><small>envia para a ' + esc(nomeDaLoja(a.loja)) + '</small></div><div class="estado">' + estado + '</div><div class="acoes">';
    if (a.enviou && a.loja === 'centro') s += '<button class="btn mini" type="button" data-ir="fichas">Ver fichas</button>';
    if (diretoria()) s += '<button class="btn mini perigo" type="button" data-revogar="' + i + '" id="revogar-' + i + '">Revogar</button>';
    return s + '</div></div>';
  }
  function cartaoOutroSistema() {
    var n = est.acessos.length;
    var s = '<section class="cartao" aria-labelledby="t-sistema"><header><h2 id="t-sistema">Outro sistema</h2><span class="chip' + (n ? ' ok' : '') + '">' + (n ? plural(n, 'acesso', 'acessos') : 'nenhum acesso') + '</span>';
    if (diretoria()) s += '<button class="btn mini empurra" type="button" data-novo-acesso id="novo-acesso">' + ic('chave', 'p') + 'Criar acesso</button>';
    s += '</header>';
    if (n) {
      s += '<div class="miolo sem-folga">';
      est.acessos.forEach(function (a, i) { s += linhaDoAcesso(a, i); });
      s += '</div><div class="miolo"><p class="nota">O código de acesso aparece uma vez, quando é criado. Perdeu? Revogue e crie outro. A documentação para quem cuida do sistema fica em <span class="mono">' + DOCUMENTACAO + '</span>.</p></div>';
      return s + '</section>';
    }
    s += '<div class="miolo"><p>A loja usa outro sistema para o cardápio e as fichas? Ele pode enviá-las ao Farol. Você cria um acesso aqui e entrega a quem cuida desse sistema — com o endereço da documentação.</p>';
    s += oQueRecebe();
    s += '<div class="bloco"><h3>Como funciona</h3><ol class="passo-a-passo"><li>Você cria o acesso aqui e escolhe a loja.</li><li>Entrega o código e o endereço da documentação a quem cuida do sistema.</li><li>O sistema passa a enviar as fichas, e elas aparecem na tela Fichas da loja.</li></ol></div>';
    if (!diretoria()) s += '<div class="aviso">' + ic('cadeado') + '<div><b>Só a diretoria cria acesso para outro sistema.</b> Deixar outro sistema escrever aqui é decisão dela.</div></div>';
    return s + '</div></section>';
  }
  function cartaoPlanilha() {
    var s = '<section class="cartao" aria-labelledby="t-planilha"><header><h2 id="t-planilha">Planilha</h2>' + (est.situacao === 'planilha' ? '<span class="chip ok">Loja Centro · importada hoje, 14:02</span>' : '') + '</header><div class="miolo">';
    s += '<p>Sem sistema, ou com as fichas no Excel? Dá para importar por planilha, loja por loja, na tela Fichas de cada uma. O modelo já vem com as colunas.</p>';
    s += '<div class="linha-acoes"><button class="btn" type="button" data-ir="fichas">' + ic('ficha', 'p') + 'Ir para Fichas da Loja Centro</button><button class="btn" type="button" data-baixar="modelo">' + ic('baixar', 'p') + 'Baixar o modelo</button></div>';
    return s + '</div></section>';
  }
  function telaConexoes() {
    var s = '<div class="cab"><div><h1>Conexões</h1><p class="suave" style="margin-top:8px;max-width:64ch">De onde o Farol recebe o que as lojas vendem e produzem. Vale para a conta inteira; cada loja recebe as fichas de um lugar só.</p></div></div>';
    if (est.situacao === 'voltou') s += cartaoLigar();
    else if (ligadaAoRegem()) s += cartaoConectado();
    else s += cartaoSemConexao();
    return s + cartaoOutroSistema() + cartaoPlanilha();
  }
  function dialogoDesconectar(loja) {
    return '<div class="dialogo" role="alertdialog" aria-modal="true" aria-labelledby="dlg-t" aria-describedby="dlg-d"><div><h2 id="dlg-t">Desconectar a ' + esc(loja) + ' do Regem?</h2>' +
      '<p id="dlg-d">O Farol para de ler o Regem desta loja agora, devolve o acesso e <b>apaga as fichas que vieram de lá</b>. Os critérios que usam ficha param de conferir. Para ter as fichas de volta, é preciso autorizar outra vez no Regem.</p>' +
      '<div class="linha-acoes"><button class="btn" type="button" data-fechar data-foco>Manter</button><button class="btn perigo" type="button" data-confirmar-desconectar="' + esc(loja) + '">Desconectar</button></div></div></div>';
  }
  function dialogoRevogar(i) {
    var a = est.acessos[i];
    return '<div class="dialogo" role="alertdialog" aria-modal="true" aria-labelledby="dlg-t" aria-describedby="dlg-d"><div><h2 id="dlg-t">Revogar o acesso do ' + esc(a.nome) + '?</h2>' +
      '<p id="dlg-d">O sistema deixa de conseguir enviar na hora' + (a.enviou ? ', e o Farol <b>apaga as fichas que ele mandou</b> para a ' + esc(nomeDaLoja(a.loja)) : '') + '. Para voltar, é criar outro acesso e entregar o código novo.</p>' +
      '<div class="linha-acoes"><button class="btn" type="button" data-fechar data-foco>Manter</button><button class="btn perigo" type="button" data-confirmar-revogar="' + i + '">Revogar</button></div></div></div>';
  }
  // criar o acesso: o nome e a loja; depois, o código — que aparece uma vez
  function comoEstaALoja(id) {
    if (ligadaAoRegem() || est.situacao === 'voltou') return 'regem';
    var tem = false;
    est.acessos.forEach(function (a) { if (a.loja === id) tem = true; });
    if (tem) return 'sistema';
    if (id === 'centro' && est.situacao === 'planilha') return 'planilha';
    return 'livre';
  }
  function folhaNovoAcesso() {
    var n = est.novo, s, pe;
    s = '<aside class="folha estreita" role="dialog" aria-modal="true" aria-labelledby="novo-titulo"><div class="folha-cab"><div><h2 id="novo-titulo">' + (n.passo === 1 ? 'Criar acesso para outro sistema' : 'Acesso criado') + '</h2><p>' + (n.passo === 1 ? 'O acesso deixa um sistema enviar as fichas de uma loja.' : esc(n.nome) + ' → ' + esc(nomeDaLoja(n.loja))) + '</p></div><button class="btn quadrado fantasma" type="button" data-fechar aria-label="Fechar">' + ic('x') + '</button></div><div class="folha-corpo">';
    if (n.passo === 1) {
      var livres = LOJAS_DO_FAROL.filter(function (l) { var c = comoEstaALoja(l.id); return c === 'livre' || c === 'planilha'; });
      if (!livres.length) {
        s += '<div class="aviso">' + ic('info') + '<div><b>Todas as lojas já recebem as fichas de outro lugar.</b> Uma loja recebe de um lugar só: para outro sistema enviar, desconecte a loja de onde ela recebe hoje.</div></div>';
        return s + '</div><div class="folha-pe"><button class="btn" type="button" data-fechar data-foco>Fechar</button></div></aside>';
      }
      s += '<div class="campo"><label for="novo-nome">Nome do sistema</label><input class="entrada" id="novo-nome" type="text" maxlength="40" autocomplete="off" value="' + esc(n.nome) + '" data-foco' + (n.erro ? ' aria-invalid="true" aria-describedby="novo-erro"' : '') + '><small>Como vocês o chamam. É o nome que aparece na tela Fichas: “do ' + esc(SISTEMA) + '”.</small>' + (n.erro ? '<span class="erro-do-campo" id="novo-erro" role="alert">' + esc(n.erro) + '</span>' : '') + '</div>';
      s += '<div class="campo"><label for="novo-loja">Loja que vai receber</label><select class="entrada" id="novo-loja">';
      LOJAS_DO_FAROL.forEach(function (l) {
        var c = comoEstaALoja(l.id);
        var rot = c === 'regem' ? ' — já recebe do Regem' : c === 'sistema' ? ' — já tem um acesso' : c === 'planilha' ? ' — hoje com fichas de planilha' : '';
        s += '<option value="' + l.id + '"' + (c === 'regem' || c === 'sistema' ? ' disabled' : '') + (n.loja === l.id ? ' selected' : '') + '>' + esc(l.nome + rot) + '</option>';
      });
      s += '</select><small>O acesso vale para uma loja. Para outra loja, crie outro.</small></div>';
      if (comoEstaALoja(n.loja) === 'planilha') s += '<div class="aviso facho">' + ic('info') + '<div>A ' + esc(nomeDaLoja(n.loja)) + ' tem fichas de planilha. Elas ficam até o sistema enviar as dele; aí as do sistema entram no lugar.</div></div>';
      pe = '<button class="btn" type="button" data-fechar>Cancelar</button><button class="btn cheio" type="button" data-criar-acesso>Criar acesso</button>';
    } else {
      s += '<div class="bloco"><h3>O código de acesso</h3><div class="codigo"><code id="codigo-de-acesso">' + CODIGO_DE_EXEMPLO + '</code><button class="btn mini" type="button" data-copiar data-foco>' + ic('copiar', 'p') + 'Copiar</button></div></div>';
      s += '<div class="aviso facho" role="status">' + ic('info') + '<div><b>Este código aparece só agora.</b> Depois de fechar, o Farol não o mostra de novo. Se perder, revogue este acesso e crie outro.</div></div>';
      s += '<div class="bloco"><h3>O que entregar a quem cuida do sistema</h3><ol class="entregar"><li><span>O código de acesso acima.</span></li><li><span>O endereço da documentação: <span class="mono">' + DOCUMENTACAO + '</span></span></li><li><span>Mais nada: nenhuma senha sua e nenhuma entrada no console.</span></li></ol></div>';
      pe = '<button class="btn cheio" type="button" data-concluir-acesso>Concluir</button>';
    }
    return s + '</div><div class="folha-pe">' + pe + '</div></aside>';
  }

  /* ─────────── o "Mais" da barra do celular ─────────── */
  function folhaMais() {
    function item(href, ir, icone, nome, sub) {
      return '<a href="#' + href + '" data-ir="' + ir + '"' + (est.tela === ir ? ' aria-current="page"' : '') + '>' + ic(icone) + '<span>' + nome + '<small>' + sub + '</small></span>' + ic('seta', 'p') + '</a>';
    }
    var s = '<div class="mais-folha" role="dialog" aria-modal="true" aria-labelledby="mais-t"><h2 id="mais-t">Mais</h2>';
    s += item('fichas', 'fichas', 'ficha', 'Fichas', 'o que a loja vende e do que é feito');
    if (configura()) {
      s += item('orcamento', 'fora', 'conta', 'Orçamento', 'o que falta para a loja ficar coberta');
      s += item('conexoes', 'conexoes', 'tomada', 'Conexões', 'de onde vêm as fichas das lojas');
    }
    return s + '<button class="btn fechar" type="button" data-fechar data-foco>Fechar</button></div>';
  }

  /* ─────────── pintar ─────────── */
  function pintarCaminho() {
    var el = document.getElementById('caminho');
    el.innerHTML = est.tela === 'conexoes' ? '<span>Sua conta</span>' + ic('seta', 'p') + '<b>Conexões</b>' : '<span>Loja Centro</span>' + ic('seta', 'p') + '<b>Fichas</b>';
    Array.prototype.forEach.call(document.querySelectorAll('a.ir'), function (a) {
      if (a.getAttribute('data-ir') === est.tela) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
      // Orçamento e Conexões são de quem configura: a supervisão não vê o item
      if (a.getAttribute('data-quem') === 'configura') a.hidden = !configura();
    });
    // no celular, Fichas e Conexões moram dentro do "Mais": é ele que fica marcado
    var mais = document.getElementById('mais');
    mais.setAttribute('aria-current', 'page');
    mais.setAttribute('aria-expanded', String(!!sobre.querySelector('.mais-folha')));
  }
  function pintar() {
    // a supervisão não entra em Conexões: volta para Fichas
    if (est.tela === 'conexoes' && !configura()) est.tela = 'fichas';
    pintarCaminho();
    if (est.situacao === 'carregando') {
      tela.innerHTML = '<div class="ossos" aria-hidden="true"><div class="osso" style="height:34px;width:200px"></div><div class="osso" style="height:44px"></div><div class="osso" style="height:300px"></div></div><p class="sr" role="status">Carregando.</p>';
      return;
    }
    if (est.situacao === 'erro') {
      tela.innerHTML = '<div class="vazio" role="alert">' + ic('alerta', 'g') + '<h2>O console não respondeu</h2><p>Não deu para carregar esta tela. Nada foi perdido: as fichas que a loja já tem continuam valendo lá.</p><button class="btn cheio" type="button" data-tentar>Tentar de novo</button></div>';
      return;
    }
    tela.innerHTML = est.tela === 'conexoes' ? telaConexoes() : telaFichas();
  }

  /* ─────────── avisos, gaveta e diálogo ─────────── */
  function avisar(texto, pede) {
    var a = document.createElement('div');
    a.className = 'aviso-topo' + (pede ? ' pede' : '');
    a.innerHTML = ic(pede ? 'info' : 'certo') + '<span>' + esc(texto) + '</span>';
    document.getElementById('avisos').appendChild(a);
    window.setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); }, 4600);
  }
  var voltarPara = null;
  function limparSobre() {
    sobre.innerHTML = '';
    est.imp = null;
    est.novo = null;
    document.getElementById('mais').setAttribute('aria-expanded', 'false');
  }
  function fechar() {
    limparSobre();
    var alvo = voltarPara ? document.querySelector(voltarPara) : null;
    (alvo || tela).focus();
    voltarPara = null;
  }
  // `quemAbriu` indefinido = a mesma gaveta, noutro passo: quem a abriu continua o mesmo
  function abrir(html, quemAbriu) {
    if (quemAbriu !== undefined) voltarPara = quemAbriu;
    sobre.innerHTML = '<div class="veu" data-fechar></div>' + html;
    var alvo = sobre.querySelector('[data-foco]') || sobre.querySelector('button');
    if (alvo) alvo.focus();
  }

  /* ─────────── navegação ─────────── */
  function ir(qual) {
    if (qual !== 'fichas' && qual !== 'conexoes') {
      avisar('Tela de exemplo: neste protótipo só Fichas e Conexões abrem.', true);
      return;
    }
    est.tela = qual;
    var alvo = '#' + qual;
    if (window.location.hash !== alvo) { try { window.history.replaceState(null, '', alvo); } catch (e) { /* sem histórico: segue */ } }
    limparSobre();
    pintar();
    tela.focus();
  }
  function marcar(grupo, v) {
    Array.prototype.forEach.call(document.querySelectorAll('#' + grupo + ' button'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === v)); });
  }
  function aplicarSituacao(v) {
    if (SITUACOES.indexOf(v) < 0) return;
    est.situacao = v;
    // os acessos de outro sistema acompanham a situação escolhida
    if (v === 'sistema-novo' || v === 'sistema') est.acessos = [{ nome: SISTEMA, loja: 'centro', enviou: v === 'sistema' }];
    else if (v !== 'carregando' && v !== 'erro') est.acessos = est.acessos.filter(function (a) { return a.loja !== 'centro' && DO_REGEM.indexOf(v) < 0; });
    marcar('proto-situacao', v);
    limparSobre();
    pintar();
  }
  function temaEscuro() {
    var t = raiz.getAttribute('data-theme');
    if (t) return t === 'dark';
    return !(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
  }
  function pintarTema() { document.getElementById('tema').setAttribute('aria-pressed', String(temaEscuro())); }
  function passoDaImportacao(passo, resultado) {
    est.imp = { passo: passo, resultado: resultado || null };
    abrir(folhaImportar());
  }

  /* ─────────── os cliques ─────────── */
  document.addEventListener('click', function (ev) {
    var t = ev.target, el;
    if (!(t instanceof Element)) return;
    if ((el = t.closest('[data-fechar]'))) { fechar(); return; }
    if (t.closest('#mais')) {
      if (sobre.querySelector('.mais-folha')) { fechar(); return; }
      abrir(folhaMais(), '#mais');
      document.getElementById('mais').setAttribute('aria-expanded', 'true');
      return;
    }
    if ((el = t.closest('[data-ir]'))) { ev.preventDefault(); ir(el.getAttribute('data-ir')); return; }
    if ((el = t.closest('[data-produto]'))) { abrir(folhaDoProduto(el.getAttribute('data-produto')), '#' + el.id); return; }
    if ((el = t.closest('[data-filtro]'))) { est.filtro = el.getAttribute('data-filtro'); pintar(); var b = document.querySelector('[data-filtro="' + est.filtro + '"]'); if (b) b.focus(); return; }
    if (t.closest('[data-limpar]')) { est.filtro = 'todos'; est.busca = ''; pintar(); return; }
    if (t.closest('[data-tentar]')) { aplicarSituacao('conectado'); return; }
    if (t.closest('[data-buscar]')) {
      if (est.situacao === 'semfichas') { avisar('Busquei agora: o Regem desta loja continua sem fichas técnicas.', true); return; }
      if (est.situacao === 'problema') { aplicarSituacao('conectado'); avisar('Fichas atualizadas agora.'); return; }
      avisar('Busquei agora: nada mudou desde a busca de hoje.');
      return;
    }
    // a planilha
    if ((el = t.closest('[data-baixar]'))) {
      avisar(el.getAttribute('data-baixar') === 'modelo' ? 'No console, aqui baixa o modelo (.xlsx), com as colunas e duas fichas de exemplo.' : 'No console, aqui baixa as fichas da loja no formato do modelo, para corrigir e importar de novo.', true);
      return;
    }
    if (t.closest('[data-importar]')) { est.imp = { passo: 1, resultado: null }; abrir(folhaImportar(), '#abrir-importar'); return; }
    if ((el = t.closest('[data-imp-passo]'))) { passoDaImportacao(Number(el.getAttribute('data-imp-passo'))); return; }
    if ((el = t.closest('[data-imp-simular]'))) { passoDaImportacao(3, el.getAttribute('data-imp-simular')); return; }
    if (t.closest('[data-imp-gravar]')) {
      limparSobre();
      voltarPara = null;
      aplicarSituacao('planilha');
      avisar('Fichas importadas: 7 produtos, 3 com ficha.');
      tela.focus();
      return;
    }
    // o Regem
    if (t.closest('[data-conectar]')) {
      avisar('No console, aqui você vai para o Regem e autoriza. O protótipo já simula a volta.', true);
      est.tela = 'conexoes';
      aplicarSituacao('voltou');
      return;
    }
    if (t.closest('[data-salvar-pares]')) {
      var ligadas = LOJAS_DO_REGEM.filter(function (r) { return est.pares[r.id]; }).length;
      if (!ligadas) { avisar('Nenhuma loja foi ligada: o acesso foi devolvido ao Regem.', true); aplicarSituacao('nao'); return; }
      aplicarSituacao('conectado');
      avisar(plural(ligadas, 'loja ligada', 'lojas ligadas') + '. O Farol está buscando as fichas agora.');
      return;
    }
    if ((el = t.closest('[data-desconectar]'))) { abrir(dialogoDesconectar(el.getAttribute('data-desconectar')), '[data-desconectar="' + el.getAttribute('data-desconectar') + '"]'); return; }
    if ((el = t.closest('[data-confirmar-desconectar]'))) {
      var loja = el.getAttribute('data-confirmar-desconectar');
      aplicarSituacao('nao');
      avisar('A ' + loja + ' foi desconectada do Regem. As fichas dela foram apagadas.');
      return;
    }
    // outro sistema
    if (t.closest('[data-novo-acesso]')) {
      var primeira = '';
      LOJAS_DO_FAROL.forEach(function (l) { var c = comoEstaALoja(l.id); if (!primeira && (c === 'livre' || c === 'planilha')) primeira = l.id; });
      est.novo = { passo: 1, nome: '', loja: primeira, erro: '' };
      abrir(folhaNovoAcesso(), '#novo-acesso');
      return;
    }
    if (t.closest('[data-criar-acesso]')) {
      var nome = (document.getElementById('novo-nome').value || '').trim();
      est.novo.nome = nome;
      est.novo.loja = document.getElementById('novo-loja').value;
      if (!nome) { est.novo.erro = 'Dê um nome ao sistema, para ele aparecer na tela Fichas.'; abrir(folhaNovoAcesso()); return; }
      est.novo.erro = '';
      est.novo.passo = 2;
      abrir(folhaNovoAcesso());
      return;
    }
    if (t.closest('[data-copiar]')) {
      var copiou = function () { avisar('Código copiado.'); };
      var naoCopiou = function () { avisar('Não deu para copiar sozinho: selecione o código e copie.', true); };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(CODIGO_DE_EXEMPLO).then(copiou, naoCopiou);
        else naoCopiou();
      } catch (e) { naoCopiou(); }
      return;
    }
    if (t.closest('[data-concluir-acesso]')) {
      var criado = { nome: est.novo.nome, loja: est.novo.loja, enviou: false };
      limparSobre();
      voltarPara = null;
      if (criado.loja === 'centro') { SISTEMA = criado.nome; aplicarSituacao('sistema-novo'); }
      else { est.acessos.push(criado); pintar(); }
      avisar('Acesso criado. Assim que o ' + criado.nome + ' enviar, as fichas aparecem na tela Fichas da ' + nomeDaLoja(criado.loja) + '.');
      tela.focus();
      return;
    }
    if ((el = t.closest('[data-revogar]'))) { abrir(dialogoRevogar(Number(el.getAttribute('data-revogar'))), '#' + el.id); return; }
    if ((el = t.closest('[data-confirmar-revogar]'))) {
      var saiu = est.acessos[Number(el.getAttribute('data-confirmar-revogar'))];
      est.acessos = est.acessos.filter(function (a) { return a !== saiu; });
      limparSobre();
      voltarPara = null;
      if (saiu.loja === 'centro' && origem() === 'sistema') aplicarSituacao('nao'); else pintar();
      avisar('O acesso do ' + saiu.nome + ' foi revogado.' + (saiu.enviou ? ' As fichas da ' + nomeDaLoja(saiu.loja) + ' foram apagadas.' : ''));
      tela.focus();
      return;
    }
    if (t.closest('#tema')) { raiz.setAttribute('data-theme', temaEscuro() ? 'light' : 'dark'); marcar('proto-tema', raiz.getAttribute('data-theme')); pintarTema(); return; }
    if (t.closest('#proto-abrir')) {
      var painel = document.getElementById('proto-painel'), abre = painel.hidden;
      painel.hidden = !abre;
      document.getElementById('proto-abrir').setAttribute('aria-expanded', String(abre));
      return;
    }
    if ((el = t.closest('#proto-situacao button'))) { aplicarSituacao(el.getAttribute('data-v')); return; }
    if ((el = t.closest('#proto-perfil button'))) { est.perfil = el.getAttribute('data-v'); marcar('proto-perfil', est.perfil); limparSobre(); pintar(); return; }
    if ((el = t.closest('#proto-tema button'))) {
      var v = el.getAttribute('data-v');
      if (v) raiz.setAttribute('data-theme', v); else raiz.removeAttribute('data-theme');
      marcar('proto-tema', v);
      pintarTema();
    }
  });
  document.addEventListener('input', function (ev) {
    var t = ev.target;
    if (!(t instanceof Element)) return;
    if (t.id === 'busca-fichas') {
      est.busca = t.value;
      var pos = t.selectionStart;
      pintar();
      var campo = document.getElementById('busca-fichas');
      if (campo) { campo.focus(); try { campo.setSelectionRange(pos, pos); } catch (e) { /* tipo sem seleção: segue */ } }
    }
  });
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (!(t instanceof Element)) return;
    var par = t.getAttribute('data-par');
    if (par) {
      est.pares[par] = t.value;
      pintar();
      var campo = document.getElementById('par-' + par);
      if (campo) campo.focus();
      return;
    }
    // escolheu um arquivo: o protótipo não o lê — segue como se a planilha estivesse certa
    if (t.id === 'imp-arquivo' && t.files && t.files.length) { passoDaImportacao(3, 'certa'); return; }
    if (t.id === 'novo-loja' && est.novo) {
      est.novo.loja = t.value;
      est.novo.nome = document.getElementById('novo-nome').value;
      abrir(folhaNovoAcesso());
      var sel = document.getElementById('novo-loja');
      if (sel) sel.focus();
    }
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && sobre.innerHTML) { ev.preventDefault(); fechar(); }
  });

  function lerEndereco() {
    var h = (window.location.hash || '').slice(1);
    est.tela = h === 'conexoes' ? 'conexoes' : 'fichas';
    pintar();
  }
  window.addEventListener('hashchange', lerEndereco);
  pintarTema();
  lerEndereco();
})();
