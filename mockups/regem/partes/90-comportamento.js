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

  // a base de fichas da loja, como chega do Regem (sem preço e sem custo: o Regem não manda)
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

  var SITUACOES = ['nao', 'voltou', 'conectado', 'semfichas', 'problema', 'revogado', 'carregando', 'erro'];
  var est = { tela: 'fichas', situacao: 'conectado', perfil: 'diretoria', filtro: 'todos', busca: '', pares: {} };
  LOJAS_DO_REGEM.forEach(function (r) { est.pares[r.id] = r.sugestao; });

  function diretoria() { return est.perfil === 'diretoria'; }
  function conectada() { return ['conectado', 'semfichas', 'problema', 'revogado'].indexOf(est.situacao) >= 0; }
  // com o acesso tirado no Regem as fichas são apagadas (a mesma regra do desconectar): a loja fica sem fichas
  function temFichas() { return ['conectado', 'semfichas', 'problema'].indexOf(est.situacao) >= 0; }
  function produtos() {
    if (est.situacao !== 'semfichas') return PRODUTOS;
    return PRODUTOS.map(function (p) { var c = {}; for (var k in p) c[k] = p[k]; c.ficha = null; return c; });
  }
  function comFicha(lista) { return lista.filter(function (p) { return !!p.ficha; }).length; }

  /* ─────────── a situação da leitura, dita uma vez ─────────── */
  function chipDaLeitura() {
    if (est.situacao === 'problema') return '<span class="chip fora">a busca de hoje falhou</span>';
    return '<span class="chip ok">atualizado hoje, 04:10</span>';
  }
  function avisoDaLeitura() {
    if (est.situacao === 'problema') {
      return '<div class="aviso fora" role="status">' + ic('alerta') + '<div><b>O Farol não conseguiu ler o Regem na busca de hoje, às 04:10.</b> As fichas abaixo são as de ontem. Ele tenta de novo sozinho; para tentar já, use “Buscar agora”.</div></div>';
    }
    if (est.situacao === 'semfichas') {
      return '<div class="aviso facho" role="status">' + ic('info') + '<div><b>O Regem desta loja ainda não tem fichas técnicas.</b> Sem ficha, o Farol sabe o que foi pedido, mas não como o produto é montado. As fichas se cadastram no Regem, em <b>Estoque › Fichas técnicas</b>; depois, use “Buscar agora” para trazê-las.</div></div>';
    }
    return '';
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
  function telaFichas() {
    var s = '<div class="cab"><div><h1>Fichas</h1>';
    if (temFichas()) s += '<div class="sobre"><span class="chip mono">do Regem</span>' + chipDaLeitura() + '</div>';
    s += '<p class="suave" style="margin-top:8px;max-width:64ch">O que a loja vende e do que cada produto é feito. O Farol usa isto para conferir, pela câmera, se o pedido foi montado como a ficha manda.</p></div>';
    if (temFichas()) {
      s += '<div class="acoes"><button class="btn" type="button" data-buscar>' + ic('atualizar', 'p') + 'Buscar agora</button>';
      if (diretoria()) s += '<button class="btn so-largo" type="button" data-ir="conexoes">' + ic('tomada', 'p') + 'Conexões</button>';
      s += '</div>';
    }
    s += '</div>';

    if (est.situacao === 'nao') {
      return s + '<div class="vazio">' + ic('ficha', 'g') + '<h2>Esta loja ainda não tem fichas</h2><p>As fichas vêm do sistema onde a loja cadastra o cardápio. Com o Regem conectado, o Farol lê os produtos, as fichas técnicas e os adicionais — e passa a saber como cada lanche deve ser montado.</p>' +
        (diretoria() ? '<button class="btn cheio" type="button" data-ir="conexoes">' + ic('tomada', 'p') + 'Conectar ao Regem</button>' : '<p class="nota">Só a diretoria conecta o Regem.</p>') + '</div>';
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
    s += '<p class="nota">' + ic('cadeado', 'p') + ' Aqui não se edita: as fichas são do Regem. O Farol não recebe preço, custo, nem quem é o cliente.</p>';
    return s;
  }
  function folhaDoProduto(id) {
    var p = null;
    produtos().forEach(function (x) { if (x.id === id) p = x; });
    if (!p) return '';
    var s = '<aside class="folha estreita" role="dialog" aria-modal="true" aria-labelledby="folha-titulo"><div class="folha-cab"><div><h2 id="folha-titulo">' + esc(p.nome) + '</h2><p>' + esc(p.categoria) + (p.cozinha ? ' · vai para a cozinha' : ' · não passa pela cozinha') + '</p></div><button class="btn quadrado fantasma" type="button" data-fechar aria-label="Fechar" data-foco>' + ic('x') + '</button></div><div class="folha-corpo">';
    if (p.ficha) {
      s += '<div class="bloco"><h3>A ficha, na ordem em que foi cadastrada</h3><ol class="ingredientes">';
      p.ficha.ingredientes.forEach(function (i) {
        s += '<li><span>' + esc(i[0]) + (i[2] ? '<small>' + esc(i[2]) + '</small>' : '') + '</span><span class="q">' + esc(i[1]) + '</span></li>';
      });
      s += '</ol><p class="nota">A embalagem que só entra no pedido para viagem fica fora desta lista.</p></div>';
    } else if (p.combo) {
      s += '<div class="bloco"><h3>O que vem no combo</h3><ul class="escolhas">';
      p.combo.forEach(function (c) { s += '<li>' + ic('certo', 'p') + '<span>' + esc(c) + '</span></li>'; });
      s += '</ul><p class="nota">Cada produto do combo é conferido pela ficha dele.</p></div>';
    } else {
      s += '<div class="aviso">' + ic('info') + '<div><b>Este produto não tem ficha no Regem.</b> ' + (p.cozinha ? 'O Farol sabe quando ele foi pedido, mas não como é montado. A ficha se cadastra no Regem, em <b>Estoque › Fichas técnicas</b>.' : 'Para o que não passa pela cozinha, não faz falta.') + '</div></div>';
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
    s += '</div><div class="folha-pe"><p class="nota">Para mudar, mude no Regem. O Farol busca as fichas uma vez por dia; para trazer já, use “Buscar agora”.</p><button class="btn" type="button" data-fechar>Fechar</button></div></aside>';
    return s;
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
    s += '<section class="cartao" aria-labelledby="t-le"><header><h2 id="t-le">O que esta conexão lê</h2></header><div class="miolo">' + oQueLe() + '<p class="nota">O Farol busca as fichas quando a loja é ligada e, depois, uma vez por dia — ficha técnica não muda a toda hora. Para trazer uma mudança na hora, a tela Fichas tem o “Buscar agora”.</p><p class="nota">O acesso também pode ser tirado pelo Regem, em <b>Configurações → Aplicativos conectados</b>. Aqui ele aparece como “acesso tirado no Regem”, e as fichas daquela loja são apagadas.</p></div></section>';
    return s;
  }
  function telaConexoes() {
    var s = '<div class="cab"><div><h1>Conexões</h1><p class="suave" style="margin-top:8px;max-width:64ch">De onde o Farol lê o que as lojas vendem e produzem. Vale para a conta inteira; cada loja é ligada à loja dela.</p></div></div>';
    if (est.situacao === 'nao') return s + cartaoSemConexao();
    if (est.situacao === 'voltou') return s + cartaoLigar();
    return s + cartaoConectado();
  }
  function dialogoDesconectar(loja) {
    return '<div class="dialogo" role="alertdialog" aria-modal="true" aria-labelledby="dlg-t" aria-describedby="dlg-d"><div><h2 id="dlg-t">Desconectar a ' + esc(loja) + ' do Regem?</h2>' +
      '<p id="dlg-d">O Farol para de ler o Regem desta loja agora, devolve o acesso e <b>apaga as fichas que vieram de lá</b>. Os critérios que usam ficha param de conferir. Para ter as fichas de volta, é preciso autorizar outra vez no Regem.</p>' +
      '<div class="linha-acoes"><button class="btn" type="button" data-fechar data-foco>Manter</button><button class="btn perigo" type="button" data-confirmar-desconectar="' + esc(loja) + '">Desconectar</button></div></div></div>';
  }

  /* ─────────── pintar ─────────── */
  function pintarCaminho() {
    var el = document.getElementById('caminho');
    el.innerHTML = est.tela === 'conexoes' ? '<span>Sua conta</span>' + ic('seta', 'p') + '<b>Conexões</b>' : '<span>Loja Centro</span>' + ic('seta', 'p') + '<b>Fichas</b>';
    Array.prototype.forEach.call(document.querySelectorAll('a.ir'), function (a) {
      if (a.getAttribute('data-ir') === est.tela) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    var atalho = document.querySelector('button.ir-topo');
    if (atalho) atalho.hidden = est.tela === 'conexoes';
  }
  function pintar() {
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
  function fechar() {
    sobre.innerHTML = '';
    var alvo = voltarPara ? document.querySelector(voltarPara) : null;
    (alvo || tela).focus();
    voltarPara = null;
  }
  function abrir(html, quemAbriu) {
    voltarPara = quemAbriu || null;
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
    sobre.innerHTML = '';
    pintar();
    tela.focus();
  }
  function marcar(grupo, v) {
    Array.prototype.forEach.call(document.querySelectorAll('#' + grupo + ' button'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === v)); });
  }
  function aplicarSituacao(v) {
    if (SITUACOES.indexOf(v) < 0) return;
    est.situacao = v;
    marcar('proto-situacao', v);
    sobre.innerHTML = '';
    pintar();
  }
  function temaEscuro() {
    var t = raiz.getAttribute('data-theme');
    if (t) return t === 'dark';
    return !(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
  }
  function pintarTema() { document.getElementById('tema').setAttribute('aria-pressed', String(temaEscuro())); }

  /* ─────────── os cliques ─────────── */
  document.addEventListener('click', function (ev) {
    var t = ev.target, el;
    if (!(t instanceof Element)) return;
    if ((el = t.closest('[data-fechar]'))) { fechar(); return; }
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
      sobre.innerHTML = '';
      aplicarSituacao('nao');
      avisar('A ' + loja + ' foi desconectada do Regem. As fichas dela foram apagadas.');
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
    if ((el = t.closest('#proto-perfil button'))) { est.perfil = el.getAttribute('data-v'); marcar('proto-perfil', est.perfil); sobre.innerHTML = ''; pintar(); return; }
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
