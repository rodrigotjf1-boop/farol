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
  // o formato do Padrão DMS (dms_ap_farol_ + 43 + _ + 6 de conferência), com um corpo que não vale em lugar nenhum
  var CODIGO_DE_EXEMPLO = 'dms_ap_farol_exemplo-do-prototipo-nao-vale-em-lugar_000000';
  var DOCUMENTACAO = 'monitorfarol.com.br/integracao';

  // A parte 2 da porta (Padrão DMS §2.4, aprovado pelo dono em 14/10/2026): o código vale 12 meses, com aviso 15 dias
  // antes; renovar gera outro e o antigo vale mais 7 dias; 90 dias sem uso, fica suspenso até a diretoria reativar;
  // quem cria confirma a senha e aceita o termo (a versão fica guardada); os outros da diretoria são avisados; no
  // máximo 10 acessos valendo por conta. Hoje, no exemplo, é 15/10/2026.
  var QUEM_CRIOU = 'Marina Alves';
  var TERMO_VERSAO = 'versão 1, de 15/10/2026';
  var TERMO = [
    'O código deixa um sistema enviar as fichas da loja escolhida e consultar o que o Farol tem desse sistema. Ele não abre câmeras, alertas, análises nem outra loja.',
    'Quem tem o código envia em nome da loja. Entregue-o só a quem cuida do sistema e guarde-o como se guarda uma senha.',
    'O código vale 12 meses. Para antes se ficar 90 dias sem envio (fica suspenso até alguém da diretoria reativar) ou se for revogado.',
    'Desconfiou que o código vazou? Revogue na hora: o envio para, e as fichas que o sistema mandou são apagadas.',
    'O Farol registra quem criou, renovou, reativou e revogou cada acesso, e quando. Os outros da diretoria veem esses avisos no console.',
    'Pela porta, o Farol não recebe preço, custo, margem nem dado de cliente, e ignora o que não estiver na documentação.'
  ];
  var TETO_DE_ACESSOS = 10;
  // só para a situação "conta no teto": as outras lojas de uma rede que já tem 10 acessos
  var LOJAS_EXTRAS = ['Loja Méier', 'Loja Tijuca', 'Loja Recreio', 'Loja Niterói', 'Loja Botafogo', 'Loja Leblon', 'Loja Madureira', 'Loja Ipanema'];
  // em que pé está o acesso da Loja Centro, em cada situação do controle
  var ESTADO_DO_ACESSO = { 'sistema-novo': 'novo', sistema: 'valendo', 'sistema-vence': 'vence', 'sistema-vencido': 'vencido', 'sistema-suspenso': 'suspenso', 'sistema-renovado': 'renovado', 'sistema-teto': 'valendo' };
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
      // o 4º campo: o ingrediente que o adicional acrescenta ou tira (é o que a bancada pode mostrar a mais ou a menos)
      adicionais: [
        ['mais', 'Bacon', 'acrescenta 20 g de Bacon fatiado', 'Bacon fatiado'],
        ['mais', 'Ovo', 'acrescenta o preparo “Ovo frito”', 'Ovo frito'],
        ['mais', 'Refrigerante', 'acrescenta o produto “Refrigerante lata”'],
        ['info', 'Ponto da carne', 'só uma observação para a cozinha'],
        ['menos', 'Sem cebola', 'tira a Cebola roxa', 'Cebola roxa']
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
      adicionais: [['mais', 'Bacon', 'acrescenta 20 g de Bacon fatiado', 'Bacon fatiado'], ['menos', 'Sem tomate', 'tira o Tomate', 'Tomate']]
    },
    {
      id: 'bat', nome: 'Batata frita', categoria: 'Porções', cozinha: true,
      variacoes: [['Média', 'a ficha inteira'], ['Grande', 'uma vez e meia a ficha']],
      ficha: { nome: 'Batata frita', ingredientes: [['Batata palito', '200 g', ''], ['Sal', '3 g', '']] },
      adicionais: [['mais', 'Cheddar', 'acrescenta 40 g de Cheddar cremoso', 'Cheddar cremoso']]
    },
    {
      id: 'cmb', nome: 'Combo da casa', categoria: 'Combos', cozinha: true,
      variacoes: [], ficha: null, combo: ['1 X-Burger', '1 Batata frita', '1 Refrigerante lata'], adicionais: []
    },
    { id: 'mil', nome: 'Milk-shake', categoria: 'Sobremesas', cozinha: true, variacoes: [['300 ml', ''], ['500 ml', '']], ficha: null, adicionais: [] },
    { id: 'ref', nome: 'Refrigerante lata', categoria: 'Bebidas', cozinha: false, variacoes: [], ficha: null, adicionais: [] },
    { id: 'agu', nome: 'Água sem gás', categoria: 'Bebidas', cozinha: false, variacoes: [], ficha: null, adicionais: [] }
  ];

  // As FOTOS DE REFERÊNCIA de cada ingrediente (o dono, 15/10/2026: "já providencie a opção de agregar imagens nas
  // fichas em cada ingrediente"). Ficam presas ao NOME do ingrediente na loja — a ficha não tem número de ingrediente e
  // é trocada inteira a cada importação —, valem para todo produto que o usa e descem para o computador da loja, onde
  // o Farol reconhece o ingrediente sem nuvem. No protótipo, desenhos de exemplo: nunca imagem de loja.
  var LIMITE_FOTOS = 6;
  // `camadas`: o desenho de exemplo que faz as vezes da foto (ver `desenho`)
  var FOTOS = {
    'Blend da casa': [
      { id: 'f1', jeito: 'na chapa, antes de ir para o pão', quando: 'hoje, 10:12', camadas: ['carne'], fundo: 'chapa' },
      { id: 'f2', jeito: 'sobre o pão, de cima', quando: 'hoje, 10:13', camadas: ['pao', 'carne'] },
      { id: 'f3', jeito: 'com a fatia de queijo por cima', quando: 'hoje, 10:15', camadas: ['pao', 'carne', 'queijo'] }
    ],
    'Queijo prato': [
      { id: 'f4', jeito: 'a fatia inteira, de cima', quando: 'ontem, 18:40', camadas: ['queijo'] },
      { id: 'f5', jeito: 'duas fatias, uma sobre a outra', quando: 'ontem, 18:41', camadas: ['queijo2'] }
    ],
    'Molho da casa': [{ id: 'f6', jeito: 'espalhado no tampo', quando: 'ontem, 18:52', camadas: ['pao', 'molho'] }]
  };
  // fotos de um ingrediente que saiu das fichas (mudou de nome no Regem ou na planilha): esperam alguém dizer de qual
  // ingrediente são — ou serem apagadas
  var ORFAS = { 'Queijo mussarela': [{ id: 'f9', jeito: 'a fatia inteira, de cima', quando: '12/10, 17:20', camadas: ['queijo'] }] };

  /* ─────────── o TREINAMENTO da bancada ─────────── */
  // O dono, 15/10/2026: "o modo treinamento, com as fichas na mão, e imagens gravadas separadas: roda análises locais e
  // traz o resultado para o usuário corrigir ou confirmar acertos, aprimorando e aprendendo cada caso; dando sugestões
  // de nomes para mudar na ficha se for o caso". O que se grava para treinar fica no computador da loja, separado por
  // gravação; quem lê é o computador da loja (sem nuvem); a nuvem guarda o que a pessoa conferiu e os números.
  var BANCADA = 'Bancada 1';
  // como cada ingrediente aparece no desenho de exemplo (no console, aqui vai o recorte da câmera)
  var FORMA = {
    'Pão brioche': 'pao', 'Molho da casa': 'molho', 'Blend da casa': 'carne', 'Queijo prato': 'queijo', 'Cebola roxa': 'cebola',
    'Alface': 'alface', 'Tomate': 'tomate', 'Bacon fatiado': 'bacon', 'Ovo frito': 'ovo', 'Cheddar cremoso': 'molho', 'Batata palito': 'batata'
  };
  // as gravações de treino: um horário escolhido, gravado e lido no computador da loja
  var GRAVACOES = [
    { id: 'g4', quando: 'hoje, 19:30 às 20:00', como: 'programada', situacao: 'programada' },
    { id: 'g3', quando: 'hoje, 12:00 às 12:30', como: 'do gravador', situacao: 'lendo', feito: 40 },
    { id: 'g2', quando: 'ontem, 19:30 às 20:00', como: 'do gravador', situacao: 'pronta', lanches: 9 },
    { id: 'g1', quando: '13/10, 20:00 às 20:30', como: 'programada', situacao: 'conferida', lanches: 7, apaga: '12/11' }
  ];
  // os lanches que o computador da loja leu na gravação de ontem e ainda esperam conferência. Cada etapa é um momento
  // em que a metade ficou parada e algo novo apareceu nela; `leu` é o que a leitura da loja disse, com a certeza dela.
  var LANCHES = [
    { id: 'l1937', hora: '19:37', fechou: '19:38:30', grav: 'g2', motivo: 'duvida', etapas: [
      { hora: '19:37:02', lado: 'pão aberto', leu: 'Pão brioche', certeza: 'media', forma: 'pao' },
      { hora: '19:37:08', lado: 'tampo', leu: 'Molho da casa', certeza: 'alta', forma: 'molho' },
      { hora: '19:37:15', lado: 'tampo', leu: 'Cebola roxa', certeza: 'baixa', forma: 'tomate' },
      { hora: '19:37:40', lado: 'base', leu: 'Blend da casa', certeza: 'alta', forma: 'carne' },
      { hora: '19:37:52', lado: 'base', leu: 'Queijo prato', certeza: 'media', forma: 'queijo' }
    ] },
    { id: 'l1946', hora: '19:46', fechou: '19:47:05', grav: 'g2', motivo: 'coberto', etapas: [
      { hora: '19:46:00', lado: 'pão aberto', leu: 'Pão brioche', certeza: 'alta', forma: 'pao' },
      { hora: '19:46:02', lado: 'tampo', leu: 'Molho da casa', certeza: 'alta', forma: 'molho' },
      { hora: '19:46:09', lado: 'tampo', leu: 'Cebola roxa', certeza: 'media', forma: 'cebola' },
      { hora: '19:46:30', lado: 'base', leu: 'Blend da casa', certeza: 'alta', forma: 'carne' },
      { hora: '19:46:41', lado: 'base', leu: null, certeza: 'nenhuma', forma: 'mao' }
    ] },
    { id: 'l1944', hora: '19:44', fechou: '19:44:58', grav: 'g2', motivo: 'diferenca', etapas: [
      { hora: '19:43:55', lado: 'pão aberto', leu: 'Pão brioche', certeza: 'alta', forma: 'pao' },
      { hora: '19:44:00', lado: 'tampo', leu: 'Molho da casa', certeza: 'alta', forma: 'molho' },
      { hora: '19:44:20', lado: 'base', leu: 'Blend da casa', certeza: 'alta', forma: 'carne' },
      { hora: '19:44:31', lado: 'base', leu: 'Queijo prato', vezes: 2, certeza: 'alta', forma: 'queijo2' }
    ] },
    { id: 'l1941', hora: '19:41', fechou: '19:42:20', grav: 'g2', motivo: 'diferenca', etapas: [
      { hora: '19:41:00', lado: 'pão aberto', leu: 'Pão brioche', certeza: 'alta', forma: 'pao' },
      { hora: '19:41:05', lado: 'tampo', leu: 'Molho da casa', certeza: 'alta', forma: 'molho' },
      { hora: '19:41:12', lado: 'tampo', leu: 'Cebola roxa', certeza: 'alta', forma: 'cebola' },
      { hora: '19:41:33', lado: 'base', leu: 'Blend da casa', certeza: 'alta', forma: 'carne' },
      { hora: '19:41:44', lado: 'base', leu: 'Queijo prato', vezes: 2, certeza: 'alta', forma: 'queijo2' },
      { hora: '19:41:52', lado: 'base', leu: 'Bacon fatiado', certeza: 'media', forma: 'bacon' }
    ] },
    { id: 'l1934', hora: '19:34', fechou: '19:35:10', grav: 'g2', motivo: 'certo', etapas: [
      { hora: '19:34:04', lado: 'pão aberto', leu: 'Pão brioche', certeza: 'alta', forma: 'pao' },
      { hora: '19:34:10', lado: 'tampo', leu: 'Molho da casa', certeza: 'alta', forma: 'molho' },
      { hora: '19:34:16', lado: 'tampo', leu: 'Cebola roxa', certeza: 'alta', forma: 'cebola' },
      { hora: '19:34:40', lado: 'base', leu: 'Blend da casa', certeza: 'alta', forma: 'carne' },
      { hora: '19:34:50', lado: 'base', leu: 'Queijo prato', vezes: 2, certeza: 'alta', forma: 'queijo2' }
    ] }
  ];
  // os já conferidos (7 da gravação de 13/10 e 4 da de ontem): o que o Farol achou antes e o que a pessoa disse
  var CONFERIDOS = [
    { hora: '19:58', grav: 'g2', achou: 'X-Salada', era: 'X-Salada', por: 'Gil Prado' },
    { hora: '19:52', grav: 'g2', achou: 'X-Burger', era: 'X-Burger', por: 'Gil Prado' },
    { hora: '19:49', grav: 'g2', achou: 'X-Burger', era: 'X-Salada', por: 'Gil Prado' },
    { hora: '19:31', grav: 'g2', achou: 'X-Burger', era: 'X-Burger', por: 'Gil Prado' },
    { hora: '20:27', grav: 'g1', achou: 'X-Burger', era: 'X-Burger', por: 'Gil Prado' },
    { hora: '20:22', grav: 'g1', achou: 'X-Salada', era: 'X-Salada', por: 'Gil Prado' },
    { hora: '20:18', grav: 'g1', achou: 'X-Burger', era: 'X-Salada', por: 'Gil Prado' },
    { hora: '20:13', grav: 'g1', achou: 'X-Burger', era: 'X-Burger', por: 'Gil Prado' },
    { hora: '20:09', grav: 'g1', achou: 'X-Salada', era: 'X-Burger', por: 'Gil Prado' },
    { hora: '20:05', grav: 'g1', achou: 'X-Burger', era: 'X-Burger', por: 'Gil Prado' },
    { hora: '20:02', grav: 'g1', achou: 'X-Burger', era: 'X-Salada', por: 'Gil Prado' }
  ];
  // o que o Farol já aprendeu de cada ingrediente NESTA bancada, contado só nos lanches conferidos: em quantos o
  // ingrediente estava, em quantos a leitura da loja o reconheceu antes da conferência, e quantos exemplos guardou
  var APRENDIDO = {
    'Pão brioche': { presente: 11, reconheceu: 10, exemplos: 11 },
    'Molho da casa': { presente: 11, reconheceu: 10, exemplos: 11 },
    'Blend da casa': { presente: 11, reconheceu: 11, exemplos: 11 },
    'Queijo prato': { presente: 11, reconheceu: 6, exemplos: 6 },
    'Cebola roxa': { presente: 9, reconheceu: 7, exemplos: 7 },
    'Alface': { presente: 4, reconheceu: 2, exemplos: 3 },
    'Tomate': { presente: 4, reconheceu: 0, exemplos: 1 },
    'Bacon fatiado': { presente: 2, reconheceu: 1, exemplos: 2 },
    'Ovo frito': { presente: 0, reconheceu: 0, exemplos: 0 }
  };
  // o que não se vê de cima (quem configura marca no ingrediente): o Farol não espera ver
  var NAO_SE_VE = { 'Sal': true };
  // as sugestões para as fichas: só nascem do que alguém CONFERIU, nunca de uma leitura sem conferência
  var SUGESTOES = [
    { id: 's1', tipo: 'um nome para duas coisas', ingrediente: 'Molho da casa',
      titulo: '“Molho da casa” parece ser dois molhos',
      viu: 'Nos lanches conferidos, o Molho da casa apareceu de dois jeitos: laranja nos 7 X-Burger e branco nos 4 X-Salada.',
      propoe: 'Se são dois molhos, dê um nome a cada um nas fichas — por exemplo, “Molho da casa” no X-Burger e “Molho branco” no X-Salada. Com um nome só, o Farol aprende os dois como se fossem um.',
      ondeRegem: 'nas fichas do X-Burger e do X-Salada', sim: 'Vou dar nomes diferentes', nao: 'É o mesmo molho' },
    { id: 's2', tipo: 'ficha diferente da bancada', ingrediente: 'Queijo prato',
      titulo: 'X-Burger: a ficha diz 2 fatias de queijo; a bancada pôs 1',
      viu: 'Em 5 dos 7 X-Burger conferidos, entrou 1 fatia de Queijo prato.',
      propoe: 'Se o certo é 1 fatia, corrija a quantidade na ficha. Se são 2, a ficha está certa e o que muda é a montagem.',
      ondeRegem: 'na ficha do X-Burger', sim: 'Vou corrigir a ficha', nao: 'A ficha está certa' },
    { id: 's3', tipo: 'falta na ficha', ingrediente: 'Cebola roxa',
      titulo: 'X-Salada: entra Cebola roxa, que não está na ficha',
      viu: 'Em 3 dos 4 X-Salada conferidos, a bancada pôs Cebola roxa.',
      propoe: 'Se ela faz parte do X-Salada, inclua na ficha. Se foi pedido do cliente, deixe como está: com os pedidos do KDS, o Farol vai saber disso sozinho.',
      ondeRegem: 'na ficha do X-Salada', sim: 'Vou incluir na ficha', nao: 'Foi pedido do cliente' }
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
  // Decisão do dono (11/10/2026): "entra o que está certo e a tela lista o que ficou de fora".
  // O grão é o PRODUTO: o que tem uma linha errada fica inteiro de fora — e o combo que o leva, junto.
  var DE_FORA = [
    { produto: 'X-Burger', problemas: [
      ['Fichas', 4, 'falta a quantidade.', 'Preencha a coluna Quantidade.'],
      ['Adicionais', 3, 'o produto não tem “Tomate” na ficha, para tirar.', 'Escreva o ingrediente igual ao da aba Fichas.']
    ] },
    { produto: 'X-Salada', problemas: [['Fichas', 11, 'a unidade “fls” não está na lista.', 'Use uma destas: ' + UNIDADES + '.']] },
    { produto: 'Combo da casa', problemas: [['Combos', 2, 'o produto “X-Burger”, que vem neste combo, ficou de fora.', 'Corrija o produto “X-Burger” e envie de novo.']] }
  ];
  function nomesDeFora() { return DE_FORA.map(function (d) { return d.produto; }); }
  function quantosProblemas() { return DE_FORA.reduce(function (n, d) { return n + d.problemas.length; }, 0); }

  var SITUACOES = ['nao', 'planilha', 'planilha-parcial', 'sistema-novo', 'sistema', 'sistema-vence', 'sistema-vencido', 'sistema-suspenso', 'sistema-renovado', 'sistema-teto', 'voltou', 'conectado', 'semfichas', 'problema', 'revogado', 'carregando', 'erro'];
  var DO_REGEM = ['voltou', 'conectado', 'semfichas', 'problema', 'revogado'];
  var est = { tela: 'fichas', situacao: 'conectado', perfil: 'diretoria', filtro: 'todos', busca: '', pares: {}, acessos: [], imp: null, novo: null, renova: null, avisoVisto: false,
    // o treinamento: a situação (controle do protótipo), a aba, o filtro dos lanches, o que já foi respondido em cada
    // lanche (rascunho), os conferidos nesta visita, os pulados, as decisões das sugestões e o que está aberto
    treino: { situacao: 'conferir', aba: 'lanches', filtro: 'conferir', resp: {}, feitos: [], pulados: [], decisoes: {}, novas: [],
      aberto: null, ingrediente: null, deProduto: null, enviando: null, erroFoto: '', nova: null, foto: null } };
  LOJAS_DO_REGEM.forEach(function (r) { est.pares[r.id] = r.sugestao; });

  // "diretoria · outra pessoa": também é da diretoria, e é quem recebe o aviso do que a colega fez nos acessos
  function diretoria() { return est.perfil === 'diretoria' || est.perfil === 'diretoria-outra'; }
  function acessoDaCentro() { var a = null; est.acessos.forEach(function (x) { if (x.loja === 'centro') a = x; }); return a; }
  // quem configura a loja: importa a planilha e pede a busca. A supervisão só vê.
  function configura() { return est.perfil !== 'supervisao'; }
  function origem() {
    if (est.situacao === 'planilha' || est.situacao === 'planilha-parcial') return 'planilha';
    if (est.situacao.indexOf('sistema') === 0) return 'sistema';
    if (DO_REGEM.indexOf(est.situacao) >= 0) return 'regem';
    return 'nenhuma';
  }
  // ligada ao Regem (as duas lojas do exemplo): uma loja recebe as fichas de um lugar só
  function ligadaAoRegem() { return ['conectado', 'semfichas', 'problema', 'revogado'].indexOf(est.situacao) >= 0; }
  // com o acesso tirado no Regem as fichas são apagadas (a mesma regra do desconectar): a loja fica sem fichas.
  // Vencido ou suspenso NÃO é revogado: as fichas do último envio ficam e continuam valendo para a conferência.
  function temFichas() {
    if (est.situacao.indexOf('sistema') === 0) return est.situacao !== 'sistema-novo';
    return ['conectado', 'semfichas', 'problema', 'planilha', 'planilha-parcial'].indexOf(est.situacao) >= 0;
  }
  function produtos() {
    // a planilha que entrou em parte: só o que estava certo está na base
    if (est.situacao === 'planilha-parcial') return PRODUTOS.filter(function (p) { return nomesDeFora().indexOf(p.nome) < 0; });
    if (est.situacao !== 'semfichas') return PRODUTOS;
    return PRODUTOS.map(function (p) { var c = {}; for (var k in p) c[k] = p[k]; c.ficha = null; return c; });
  }
  function comFicha(lista) { return lista.filter(function (p) { return !!p.ficha; }).length; }
  function nomeDaLoja(id) { var n = ''; LOJAS_DO_FAROL.forEach(function (l) { if (l.id === id) n = l.nome; }); return n || (LOJAS_EXTRAS.indexOf(id) >= 0 ? id : ''); }
  // a frase só manda usar o botão para quem tem o botão
  function comOBotao(com, sem) { return configura() ? com : sem; }

  /* ─────────── de onde vieram, dito uma vez ─────────── */
  function chipsDaOrigem() {
    var o = origem();
    if (o === 'planilha') return '<span class="chip mono">da planilha</span><span class="chip ok">importada hoje, 14:02</span>';
    if (o === 'sistema') {
      var e = ESTADO_DO_ACESSO[est.situacao];
      var de = '<span class="chip mono">do ' + esc(SISTEMA) + '</span>';
      if (e === 'vencido') return de + '<span class="chip fora">o acesso venceu em 03/10</span>';
      if (e === 'suspenso') return de + '<span class="chip fora">o acesso está suspenso</span>';
      return de + '<span class="chip ok">recebido hoje, 14:02</span>' + (e === 'vence' ? '<span class="chip facho">o acesso vence em 12 dias</span>' : '');
    }
    if (est.situacao === 'problema') return '<span class="chip mono">do Regem</span><span class="chip fora">a busca de hoje falhou</span>';
    return '<span class="chip mono">do Regem</span><span class="chip ok">atualizado hoje, 04:10</span>';
  }
  function avisoDaLeitura() {
    // o acesso do outro sistema: só quem é da diretoria tem o botão; os outros ficam sabendo quem resolve
    var praConexoes = function (rotulo) {
      return diretoria() ? ' <button class="btn mini" type="button" data-ir="conexoes">' + ic('tomada', 'p') + rotulo + '</button>' : ' Quem resolve é a diretoria, em Conexões.';
    };
    if (est.situacao === 'sistema-vence') {
      return '<div class="aviso facho" role="status">' + ic('relogio') + '<div><b>O acesso do ' + esc(SISTEMA) + ' vence em 12 dias, em 27/10.</b> Depois disso, ele não consegue mais enviar, e as fichas param de se atualizar.' + praConexoes('Renovar em Conexões') + '</div></div>';
    }
    if (est.situacao === 'sistema-vencido') {
      return '<div class="aviso fora" role="status">' + ic('alerta') + '<div><b>O acesso do ' + esc(SISTEMA) + ' venceu em 03/10.</b> As fichas abaixo são as do último envio, de 02/10, e continuam valendo para a conferência; o que mudou no sistema depois disso não chegou.' + praConexoes('Renovar em Conexões') + '</div></div>';
    }
    if (est.situacao === 'sistema-suspenso') {
      return '<div class="aviso fora" role="status">' + ic('alerta') + '<div><b>O acesso do ' + esc(SISTEMA) + ' está suspenso:</b> ficou 90 dias sem enviar (o último envio foi em 14/07). As fichas abaixo são as daquele envio.' + praConexoes('Reativar em Conexões') + '</div></div>';
    }
    if (est.situacao === 'problema') {
      return '<div class="aviso fora" role="status">' + ic('alerta') + '<div><b>O Farol não conseguiu ler o Regem na busca de hoje, às 04:10.</b> As fichas abaixo são as de ontem. Ele tenta de novo sozinho' + comOBotao('; para tentar já, use “Buscar agora”.', '.') + '</div></div>';
    }
    if (est.situacao === 'planilha-parcial') {
      // o que ficou de fora continua à mão depois de importar — só para quem importa
      return '<div class="aviso facho" role="status">' + ic('info') + '<div><b>' + plural(DE_FORA.length, 'produto da planilha ficou', 'produtos da planilha ficaram') + ' de fora</b> na importação de hoje, às 14:02: ' + esc(nomesDeFora().join(', ')) + '.' +
        (configura() ? ' <button class="btn mini" type="button" data-ver-de-fora id="ver-de-fora">Ver o que ficou de fora</button>' : ' Quem importa a planilha vê o motivo de cada um.') + '</div></div>';
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
        s += '<li><span>' + esc(i[0]) + (i[2] ? '<small>' + esc(i[2]) + '</small>' : '') + '</span><span class="q">' + esc(i[1]) + '</span>' + botaoDasFotos(i[0], p.id) + '</li>';
      });
      s += '</ol><p class="nota">' + ic('foto', 'p') + ' Em cada ingrediente, as fotos de referência dele: o Farol usa para reconhecê-lo na bancada.</p>' +
        (o === 'regem' ? '<p class="nota">A embalagem que só entra no pedido para viagem fica fora desta lista.</p>' : '') + '</div>';
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
      p.adicionais.forEach(function (a) {
        // o adicional que acrescenta um ingrediente também leva às fotos dele
        s += '<li>' + ic(a[0], 'p') + '<span>' + esc(a[1]) + '<small>' + esc(a[2]) + '</small></span>' + (a[0] === 'mais' && a[3] ? botaoDasFotos(a[3], p.id) : '') + '</li>';
      });
      s += '</ul></div>';
    }
    var pe = o === 'planilha' ? 'Para mudar, corrija a planilha e importe de novo.'
      : o === 'sistema' ? 'Para mudar, mude no ' + esc(SISTEMA) + ': ele envia as fichas para cá.'
      : 'Para mudar, mude no Regem. O Farol busca as fichas uma vez por dia' + comOBotao('; para trazer já, use “Buscar agora”.', '.');
    s += '</div><div class="folha-pe"><p class="nota">' + pe + '</p><button class="btn" type="button" data-fechar>Fechar</button></div></aside>';
    return s;
  }

  /* ─────────── o treinamento: as contas ─────────── */
  function slug(s) { return semAcento(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function produtoPorNome(nome) { var r = null; PRODUTOS.forEach(function (p) { if (p.nome === nome) r = p; }); return r; }
  function gravacaoPorId(id) { var r = null; GRAVACOES.forEach(function (g) { if (g.id === id) r = g; }); return r; }
  function lanchePorId(id) { var r = null; LANCHES.forEach(function (l) { if (l.id === id) r = l; }); return r; }
  // as fichas que a loja tem de fato (Regem "sem fichas" não conta)
  function haFichas() { return temFichas() && comFicha(produtos()) > 0; }
  // os produtos que já passaram por esta bancada, nos lanches conferidos
  var DA_BANCADA = ['X-Burger', 'X-Salada'];
  // todos os ingredientes da loja — das fichas e dos adicionais —, com os produtos em que entram
  function ingredientesDaLoja() {
    var mapa = {}, ordem = [];
    function por(nome, onde) {
      if (!mapa[nome]) { mapa[nome] = []; ordem.push(nome); }
      if (mapa[nome].indexOf(onde) < 0) mapa[nome].push(onde);
    }
    produtos().forEach(function (p) {
      if (p.ficha) p.ficha.ingredientes.forEach(function (i) { por(i[0], p.nome); });
      p.adicionais.forEach(function (a) { if (a[0] === 'mais' && a[3]) por(a[3], p.nome + ' (adicional)'); });
    });
    return ordem.map(function (n) { return { nome: n, produtos: mapa[n] }; });
  }
  function ingredientesDaBancada() {
    return ingredientesDaLoja().filter(function (i) {
      return i.produtos.some(function (p) { return DA_BANCADA.indexOf(p.replace(' (adicional)', '')) >= 0; });
    });
  }
  function aprendido(nome) {
    var s = est.treino.situacao;
    if (s === 'novo' || s === 'lendo') return { presente: 0, reconheceu: 0, exemplos: 0 };
    return APRENDIDO[nome] || { presente: 0, reconheceu: 0, exemplos: 0 };
  }
  // quantas vezes o ingrediente entra na montagem: o número, quando a unidade se conta de cima (fatia, unidade);
  // peso, volume, folha e rodela contam como presença
  function vezesNaFicha(qtd) {
    var m = /^(\d+)\s+(fatias?|unidades?)$/.exec(qtd || '');
    return m ? Number(m[1]) : 1;
  }
  function respDe(l) {
    if (!est.treino.resp[l.id]) est.treino.resp[l.id] = { etapas: {}, produto: '', outroProduto: '', ficha: {}, fora: {} };
    return est.treino.resp[l.id];
  }
  function nomeDaResposta(re) {
    if (re.nome === '__novo') return re.novo ? re.novo.trim() : '';
    if (re.nome === '__naosei') return '';
    return re.nome || '';
  }
  // o que a etapa mostrou: a correção de quem conferiu, ou a leitura da loja
  function rotuloDaEtapa(l, i) {
    var re = respDe(l).etapas[i], e = l.etapas[i];
    if (re && re.v === 'nada') return null;
    if (re && re.v === 'outro') return nomeDaResposta(re) || null;
    return e.leu;
  }
  function vistos(l, soALeitura) {
    var conta = {};
    l.etapas.forEach(function (e, i) {
      var nome = soALeitura ? e.leu : rotuloDaEtapa(l, i);
      if (nome) conta[nome] = (conta[nome] || 0) + (e.vezes || 1);
    });
    return conta;
  }
  function ehAdicional(p, nome) { return p.adicionais.some(function (a) { return a[0] === 'mais' && a[3] === nome; }); }
  function adicionalQueTira(p, nome) { var r = ''; p.adicionais.forEach(function (a) { if (a[0] === 'menos' && a[3] === nome) r = a[1]; }); return r; }
  // a conta da ficha: o que bate, o que veio a menos, o que falta, o que não se vê e o que veio fora dela
  function compararComFicha(nomeDoProduto, conta) {
    var p = produtoPorNome(nomeDoProduto), r = { bate: [], menos: [], falta: [], naoSeVe: [], fora: [] };
    if (!p || !p.ficha) return r;
    var naFicha = {};
    p.ficha.ingredientes.forEach(function (i) {
      var nome = i[0], quer = vezesNaFicha(i[1]), viu = conta[nome] || 0;
      naFicha[nome] = true;
      if (NAO_SE_VE[nome]) r.naoSeVe.push({ nome: nome });
      else if (viu >= quer) r.bate.push({ nome: nome, viu: viu, quer: quer });
      else if (viu > 0) r.menos.push({ nome: nome, viu: viu, quer: quer });
      else r.falta.push({ nome: nome, viu: 0, quer: quer });
    });
    Object.keys(conta).forEach(function (nome) { if (!naFicha[nome]) r.fora.push({ nome: nome, adicional: ehAdicional(p, nome) }); });
    return r;
  }
  // o palpite da leitura da loja, ANTES de qualquer conferência: a ficha que mais bate com o que ela leu
  // (o que veio a mais e é adicional do produto não pesa contra)
  function palpites(l) {
    var conta = vistos(l, true);
    return produtos().filter(function (p) { return p.ficha && p.cozinha; }).map(function (p) {
      var c = compararComFicha(p.nome, conta), total = c.bate.length + c.menos.length + c.falta.length;
      var batem = c.bate.length + c.menos.length, estranhos = c.fora.filter(function (f) { return !f.adicional; }).length;
      return { nome: p.nome, batem: batem, total: total, fora: c.fora.length, nota: batem / Math.max(total, 1) - 0.2 * estranhos };
    }).sort(function (a, b) { return b.nota - a.nota; });
  }
  function produtoEscolhido(l, r, pal) {
    if (r.produto === '__nao') return '';
    if (r.produto === '__outro') return r.outroProduto || '';
    return r.produto || pal[0].nome;
  }
  // os conferidos nesta visita (e, no controle "tudo conferido", os que faltavam, respondidos pelo palpite)
  function feitos() {
    var f = est.treino.feitos.slice();
    if (est.treino.situacao === 'tudo') {
      LANCHES.forEach(function (l) {
        if (f.some(function (x) { return x.id === l.id; })) return;
        var achou = palpites(l)[0].nome;
        f.push({ id: l.id, hora: l.hora, grav: l.grav, achou: achou, era: l.id === 'l1937' ? 'X-Salada' : achou, por: 'Gil Prado' });
      });
    }
    return f;
  }
  function conferidos() {
    var s = est.treino.situacao;
    if (s === 'novo' || s === 'lendo') return est.treino.feitos.slice();
    return feitos().concat(CONFERIDOS);
  }
  function emFila() { var s = est.treino.situacao; return s === 'conferir' || s === 'semloja'; }
  function paraConferir() {
    if (!emFila()) return [];
    var ja = feitos().map(function (x) { return x.id; });
    return LANCHES.filter(function (l) { return ja.indexOf(l.id) < 0 && est.treino.pulados.indexOf(l.id) < 0; });
  }
  function pulados() {
    if (!emFila()) return [];
    var ja = feitos().map(function (x) { return x.id; });
    return LANCHES.filter(function (l) { return ja.indexOf(l.id) < 0 && est.treino.pulados.indexOf(l.id) >= 0; });
  }
  function gravacoes() {
    var s = est.treino.situacao;
    return GRAVACOES.filter(function (g) {
      if (g.cancelada) return false;
      if (g.criada) return true;
      if (s === 'novo') return false;
      if (s === 'lendo') return g.id === 'g3';
      return true;
    });
  }
  function situacaoDaGravacao(g) {
    if (g.situacao === 'pronta') {
      var faltam = paraConferir().concat(pulados()).filter(function (l) { return l.grav === g.id; }).length;
      if (!faltam) return 'conferida';
    }
    return g.situacao;
  }
  function contas() {
    var c = conferidos(), acertou = c.filter(function (x) { return x.achou === x.era; }).length;
    var ings = ingredientesDaBancada().filter(function (i) { return !NAO_SE_VE[i.nome]; });
    var comExemplo = ings.filter(function (i) { return aprendido(i.nome).exemplos > 0; }).length;
    return { conf: c.length, acertou: acertou, ings: ings.length, comExemplo: comExemplo };
  }
  function sugestoes() {
    var s = est.treino.situacao;
    if (s === 'novo' || s === 'lendo') return est.treino.novas.slice();
    return est.treino.novas.concat(SUGESTOES);
  }
  function sugestoesAbertas() { return sugestoes().filter(function (g) { return !est.treino.decisoes[g.id]; }); }
  // onde a ficha se muda, conforme de onde ela vem
  function ondeMudar(onde) {
    var o = origem();
    if (o === 'planilha') return 'Na planilha, ' + onde + ', e importe de novo.';
    if (o === 'sistema') return 'No ' + SISTEMA + ', ' + onde + '.';
    return 'No Regem, em Estoque › Fichas técnicas, ' + onde + '.';
  }

  /* ─────────── o desenho de exemplo (no console, aqui vai o recorte da câmera da bancada) ─────────── */
  var FORMAS = {
    pao: '<circle cx="50" cy="50" r="44" class="il-pao"/><circle cx="50" cy="50" r="37" class="il-miolo"/>',
    molho: '<path class="il-molho" d="M27 47c4-14 28-19 41-9 11 8 6 25-8 28-17 4-37-4-33-19z"/>',
    cebola: '<path class="il-cebola" d="M30 40q8-8 16 0M53 35q8-7 15 1M33 58q9-7 17 1M55 58q7-6 14 2M42 48q7-6 13 1"/>',
    alface: '<path class="il-alface" d="M22 50c3-11 11-7 15-13s12-4 16 0 13-2 16 6 9 11 3 17-8 10-17 8-12 4-18-2-16-6-15-16z"/>',
    tomate: '<circle cx="39" cy="46" r="12" class="il-tomate"/><circle cx="61" cy="55" r="12" class="il-tomate"/><circle cx="39" cy="46" r="6" class="il-semente"/><circle cx="61" cy="55" r="6" class="il-semente"/>',
    carne: '<circle cx="50" cy="50" r="35" class="il-carne"/><path class="il-marca" d="M30 41h40M27 50h46M30 59h40"/>',
    queijo: '<rect x="25" y="25" width="50" height="50" rx="2" transform="rotate(8 50 50)" class="il-queijo"/>',
    queijo2: '<rect x="23" y="27" width="50" height="50" rx="2" transform="rotate(-6 48 52)" class="il-queijo"/><rect x="28" y="22" width="50" height="50" rx="2" transform="rotate(14 53 47)" class="il-queijo il-sobre"/>',
    bacon: '<path class="il-bacon" d="M24 40c8-5 16 4 24 0s16 4 26 0M24 52c8-5 16 4 24 0s16 4 26 0M26 64c8-5 16 4 24 0s14 4 22 0"/>',
    ovo: '<path class="il-clara" d="M24 50c0-16 18-23 31-19s21 16 15 29-27 14-37 6-9-10-9-16z"/><circle cx="49" cy="49" r="10" class="il-gema"/>',
    batata: '<path class="il-batata" d="M28 34l30 6M30 46l34 2M26 58l32-4M36 68l28-6M44 30l2 34"/>',
    mao: '<rect x="48" y="40" width="44" height="74" rx="20" transform="rotate(-24 70 77)" class="il-mao"/>'
  };
  // `camadas`: as formas na ordem em que entraram; com `marcar`, a última — o que mudou nesta etapa — vem contornada
  function desenho(camadas, marcar, rotulo, fundo) {
    var s = '<svg viewBox="0 0 100 100"' + (rotulo ? ' role="img" aria-label="' + esc(rotulo) + '"' : ' aria-hidden="true"') + '><rect width="100" height="100" class="il-fundo' + (fundo === 'chapa' ? ' chapa' : '') + '"/>';
    camadas.forEach(function (c, i) { s += '<g' + (marcar && i === camadas.length - 1 ? ' class="nova"' : '') + '>' + (FORMAS[c] || '') + '</g>'; });
    return s + '</svg>';
  }
  // `semTarja`: nos quadros pequenos das etapas, o aviso de "desenho" vai uma vez só, no texto do bloco
  function quadro(camadas, marcar, rotulo, fundo, semTarja) {
    return '<div class="quadro">' + desenho(camadas, marcar, rotulo, fundo) + (semTarja ? '' : '<span class="tarja" aria-hidden="true">desenho de exemplo</span>') + '</div>';
  }
  // a metade como estava naquela etapa: o pão e o que já tinha entrado do mesmo lado
  function camadasAte(l, i) {
    var e = l.etapas[i], c = ['pao'];
    if (e.lado === 'pão aberto') return c;
    for (var k = 0; k <= i; k++) if (l.etapas[k].lado === e.lado) c.push(l.etapas[k].forma);
    return c;
  }
  // o recorte inteiro de uma etapa, como sobe da loja: a área do lanche, com as duas metades lado a lado (a miniatura
  // da lista mostra só o meio dele). O que mudou na etapa vem contornado, como na miniatura.
  function desenhoDoRecorte(l, i, rotulo) {
    var e = l.etapas[i], aberto = e.lado === 'pão aberto';
    var s = '<svg viewBox="0 0 230 120" role="img" aria-label="' + esc(rotulo) + '"><rect width="230" height="120" class="il-fundo"/>';
    [['tampo', 8], ['base', 122]].forEach(function (m) {
      var c = ['pao'], marcar = aberto || e.lado === m[0];
      if (!aberto) for (var k = 0; k <= i; k++) if (l.etapas[k].lado === m[0]) c.push(l.etapas[k].forma);
      s += '<g transform="translate(' + m[1] + ' 10)">';
      c.forEach(function (f, j) { s += '<g' + (marcar && j === c.length - 1 ? ' class="nova"' : '') + '>' + (FORMAS[f] || '') + '</g>'; });
      s += '</g>';
    });
    return s + '</svg>';
  }
  // a metade como ficou no fim (a mão já saiu)
  function camadasDoLado(l, lado) {
    var c = ['pao'];
    l.etapas.forEach(function (e) { if (e.lado === lado && e.forma !== 'mao') c.push(e.forma); });
    return c;
  }

  /* ─────────── as fotos de um ingrediente ─────────── */
  function botaoDasFotos(nome, deProduto) {
    var n = (FOTOS[nome] || []).length, nao = !!NAO_SE_VE[nome];
    var texto = nao ? 'não se vê' : n ? String(n) : 'sem foto';
    var rotulo = nao ? nome + ': não se vê de cima' : (n ? plural(n, 'foto', 'fotos') : 'sem foto') + ' de ' + nome;
    return '<button class="foto-chip' + (n || nao ? '' : ' sem') + '" type="button" data-ingrediente="' + esc(nome) + '"' + (deProduto ? ' data-de-produto="' + esc(deProduto) + '"' : '') +
      ' id="fc-' + slug(nome) + '" aria-label="' + esc(rotulo) + '">' + ic('foto', 'p') + '<span aria-hidden="true">' + esc(texto) + '</span></button>';
  }
  function ladrilhoDaFoto(nome, f, podeTirar) {
    var imagem = f.url ? '<div class="quadro"><img src="' + esc(f.url) + '" alt="A foto que você escolheu agora, de ' + esc(nome) + '"></div>' : quadro(f.camadas, false, 'Desenho de exemplo: ' + nome + ', ' + f.jeito, f.fundo);
    return '<figure class="foto">' + imagem + '<figcaption><span>' + esc(f.jeito) + '</span><small class="mono">' + esc(f.quando) + '</small></figcaption>' +
      (podeTirar ? '<button class="btn mini perigo" type="button" data-tirar-foto="' + f.id + '" id="tirar-' + f.id + '">Tirar</button>' : '') + '</figure>';
  }
  function folhaDoIngrediente(nome) {
    var info = null;
    ingredientesDaLoja().forEach(function (i) { if (i.nome === nome) info = i; });
    var orfa = !info && !!ORFAS[nome], fotos = (orfa ? ORFAS[nome] : FOTOS[nome]) || [], a = aprendido(nome), nao = !!NAO_SE_VE[nome];
    var s = '<aside class="folha estreita" role="dialog" aria-modal="true" aria-labelledby="ing-titulo"><div class="folha-cab"><div><h2 id="ing-titulo">' + esc(nome) + '</h2><p>' +
      (orfa ? 'saiu das fichas da loja' : 'entra em ' + esc(info ? info.produtos.join(', ') : '')) + '</p></div><button class="btn quadrado fantasma" type="button" data-fechar aria-label="Fechar">' + ic('x') + '</button></div><div class="folha-corpo">';
    if (orfa) {
      s += '<div class="aviso facho" role="status">' + ic('info') + '<div><b>Este ingrediente saiu das fichas.</b> As fotos dele esperam aqui: se ele só mudou de nome, diga qual é o nome novo e elas vão junto.</div></div>';
      if (configura()) {
        s += '<div class="campo"><label for="orfa-destino">É o mesmo ingrediente que</label><select class="entrada" id="orfa-destino"><option value="">Escolha na lista</option>';
        ingredientesDaLoja().forEach(function (i) { if (!NAO_SE_VE[i.nome]) s += '<option>' + esc(i.nome) + '</option>'; });
        s += '</select></div><div class="linha-acoes"><button class="btn cheio" type="button" data-ligar-orfa="' + esc(nome) + '">Juntar as fotos</button><button class="btn perigo" type="button" data-apagar-orfa="' + esc(nome) + '">Apagar as fotos</button></div>';
      } else {
        s += '<p class="nota">Quem configura a loja diz de qual ingrediente elas são.</p>';
      }
    } else {
      var estado = nao ? '<span class="chip">não se vê de cima</span>' : !a.exemplos ? '<span class="chip fora">a bancada ainda não deu exemplo</span>'
        : '<span class="chip ' + (a.reconheceu / Math.max(a.presente, 1) >= 0.85 && a.presente >= 5 ? 'ok' : 'facho') + '">reconheceu em ' + a.reconheceu + ' de ' + plural(a.presente, 'lanche', 'lanches') + '</span>';
      s += '<div class="contas"><span class="chip">' + (fotos.length ? plural(fotos.length, 'foto sua', 'fotos suas') : 'nenhuma foto sua') + '</span><span class="chip">' + plural(a.exemplos, 'exemplo da bancada', 'exemplos da bancada') + '</span>' + estado + '</div>';
    }
    // as fotos de referência
    s += '<section class="bloco" aria-labelledby="fr-t"><h3 id="fr-t">Fotos de referência</h3>';
    if (!orfa) s += '<p class="nota">Fotos suas, do ingrediente como ele entra no lanche. Valem para todos os produtos que o usam e vão para o computador da loja, onde o Farol o reconhece sem nuvem.</p>';
    s += '<div class="fotos">';
    fotos.forEach(function (f) { s += ladrilhoDaFoto(nome, f, configura() && !orfa); });
    if (!orfa && est.treino.enviando === nome) s += '<figure class="foto enviando" aria-live="polite"><div class="quadro"><span class="enviando-texto">enviando…</span></div><figcaption><span>a foto escolhida</span><small class="mono">reduzida no aparelho</small></figcaption></figure>';
    if (!orfa && fotos.length < LIMITE_FOTOS && est.treino.enviando !== nome) {
      s += '<div class="foto nova-foto"><input class="sr" type="file" id="foto-arquivo" accept="image/*" data-foto-de="' + esc(nome) + '"><label for="foto-arquivo">' + ic('foto', 'g') + '<span>Enviar foto</span><small>JPG ou PNG, do celular ou do computador</small></label></div>';
    }
    s += '</div>';
    if (est.treino.erroFoto) s += '<div class="aviso fora" role="alert">' + ic('alerta') + '<div>' + esc(est.treino.erroFoto) + '</div></div>';
    if (!orfa && fotos.length >= LIMITE_FOTOS) s += '<p class="nota">Chegou ao limite de ' + LIMITE_FOTOS + ' fotos por ingrediente. Para enviar outra, tire uma.</p>';
    if (!orfa) {
      s += '<p class="nota">A foto é reduzida no seu aparelho antes de ir (até 1.600 px), como as fotos do inventário.</p>';
      s += '<div class="so-proto"><span>só no protótipo</span><div class="linha-acoes"><button class="btn mini" type="button" data-simular-foto="nao-foto" id="sim-nao-foto">Simular um arquivo que não é foto</button><button class="btn mini" type="button" data-simular-foto="limite" id="sim-limite">Simular o limite de fotos</button></div></div>';
    }
    s += '</section>';
    if (!orfa) {
      s += '<section class="bloco" aria-labelledby="cf-dica"><h3 id="cf-dica">Como fotografar</h3><ul class="escolhas">' +
        '<li>' + ic('certo', 'p') + '<span>De cima, como a câmera da bancada vê.</span></li>' +
        '<li>' + ic('certo', 'p') + '<span>Na bancada ou sobre o pão, com a luz de sempre.</span></li>' +
        '<li>' + ic('certo', 'p') + '<span>Uma foto da porção inteira e outra de perto.</span></li>' +
        '<li>' + ic('certo', 'p') + '<span>Se ele muda no preparo (cru e grelhado, inteiro e em fatias), uma foto de cada jeito.</span></li>' +
        '<li>' + ic('certo', 'p') + '<span>Sem pessoas na foto: só o ingrediente.</span></li></ul></section>';
      // os exemplos da bancada: recortes dos lanches conferidos
      s += '<section class="bloco" aria-labelledby="ex-t"><h3 id="ex-t">Exemplos da bancada</h3>';
      if (nao) s += '<p class="nota">Marcado como “não se vê de cima”: o Farol não espera vê-lo na bancada.</p>';
      else if (!a.exemplos) s += '<p class="nota">Nenhum ainda. Os exemplos entram quando alguém confere um lanche com ' + esc(nome) + ', na tela Treinamento.</p>';
      else {
        s += '<p class="nota">O recorte do ' + esc(nome) + ' em cada lanche conferido. É com eles que a leitura da loja compara.</p><div class="exemplos">';
        for (var k = 0; k < Math.min(a.exemplos, 6); k++) s += desenho(['pao', FORMA[nome] || 'molho'], false, '');
        s += '</div>' + (a.exemplos > 6 ? '<p class="nota">e mais ' + (a.exemplos - 6) + '.</p>' : '');
      }
      s += '</section>';
      if (configura()) {
        s += '<section class="bloco" aria-labelledby="ve-t"><h3 id="ve-t">Na câmera</h3><button class="alternar" type="button" data-nao-se-ve="' + esc(nome) + '" id="nao-se-ve" aria-pressed="' + nao + '"><span class="chave" aria-hidden="true"></span><span><b>Não se vê de cima</b><small>Para sal, tempero e o que fica escondido. O Farol para de esperar vê-lo na bancada.</small></span></button></section>';
      }
    }
    s += '</div><div class="folha-pe">';
    var volta = est.treino.deProduto ? produtoPorId(est.treino.deProduto) : null;
    if (volta) s += '<button class="btn" type="button" data-voltar-produto="' + volta.id + '">' + ic('voltar', 'p') + 'Voltar ao ' + esc(volta.nome) + '</button>';
    return s + '<button class="btn" type="button" data-fechar>Fechar</button></div></aside>';
  }
  function produtoPorId(id) { var r = null; PRODUTOS.forEach(function (p) { if (p.id === id) r = p; }); return r; }
  function dialogoApagarOrfa(nome) {
    return '<div class="dialogo" role="alertdialog" aria-modal="true" aria-labelledby="dlg-t" aria-describedby="dlg-d"><div><h2 id="dlg-t">Apagar as fotos de “' + esc(nome) + '”?</h2>' +
      '<p id="dlg-d">' + plural((ORFAS[nome] || []).length, 'foto sai', 'fotos saem') + ' do Farol e do computador da loja. Se o ingrediente só mudou de nome, junte as fotos ao nome novo em vez de apagar.</p>' +
      '<div class="linha-acoes"><button class="btn" type="button" data-manter-foto data-foco>Manter</button><button class="btn perigo" type="button" data-confirmar-apagar-orfa="' + esc(nome) + '">Apagar as fotos</button></div></div></div>';
  }
  function dialogoTirarFoto(nome, id) {
    return '<div class="dialogo" role="alertdialog" aria-modal="true" aria-labelledby="dlg-t" aria-describedby="dlg-d"><div><h2 id="dlg-t">Tirar esta foto do ' + esc(nome) + '?</h2>' +
      '<p id="dlg-d">O Farol deixa de usá-la como referência. Os exemplos da bancada não mudam.</p>' +
      '<div class="linha-acoes"><button class="btn" type="button" data-manter-foto data-foco>Manter</button><button class="btn perigo" type="button" data-confirmar-tirar="' + id + '">Tirar</button></div></div></div>';
  }

  /* ─────────── a tela Treinamento ─────────── */
  var ABAS_TREINO = [['lanches', 'Lanches'], ['ingredientes', 'Ingredientes'], ['sugestoes', 'Sugestões para as fichas'], ['gravacoes', 'Gravações']];
  function telaTreinamento() {
    var t = est.treino;
    var s = '<div class="cab"><div><h1>Treinamento</h1><div class="sobre"><span class="chip mono">' + esc(BANCADA) + '</span><span class="chip dado">lido no computador da loja</span></div>' +
      '<p class="suave" style="margin-top:8px;max-width:68ch">O Farol lê os lanches de uma gravação de treino e mostra o que viu, etapa por etapa. Você confirma ou corrige; cada caso conferido vira exemplo para a próxima leitura.</p></div>';
    if (configura() && haFichas()) s += '<div class="acoes"><button class="btn cheio" type="button" data-nova-gravacao id="nova-gravacao">' + ic('mais', 'p') + 'Nova gravação de treino</button></div>';
    s += '</div>';
    if (!haFichas()) {
      return s + '<div class="vazio">' + ic('ficha', 'g') + '<h2>Primeiro, as fichas</h2><p>O treinamento compara o que a bancada montou com as fichas da loja. Sem elas, o Farol não sabe o que esperar de cada lanche.</p><button class="btn cheio" type="button" data-ir="fichas">Ir para Fichas</button></div>';
    }
    if (!gravacoes().length) return s + comecarTreino();
    if (t.situacao === 'semloja') {
      s += '<div class="aviso facho" role="status">' + ic('alerta') + '<div><b>O computador da loja não responde desde hoje, 03:10.</b> Dá para conferir normalmente: os quadros já subiram, e o que você ensinar chega à loja quando ele voltar. A gravação de hoje, 12:00 às 12:30, para de ser lida até lá.</div></div>';
    }
    s += numerosDoTreino();
    var n = { lanches: paraConferir().length, ingredientes: ingredientesDaBancada().length, sugestoes: sugestoesAbertas().length, gravacoes: gravacoes().length };
    s += '<div class="abas" role="tablist" aria-label="Partes do treinamento">';
    ABAS_TREINO.forEach(function (a) {
      var sel = t.aba === a[0];
      s += '<button type="button" role="tab" id="aba-' + a[0] + '" aria-controls="painel-treino" aria-selected="' + sel + '" tabindex="' + (sel ? '0' : '-1') + '" data-aba-treino="' + a[0] + '">' + a[1] + ' <span class="mono">' + n[a[0]] + '</span></button>';
    });
    s += '</div><div role="tabpanel" id="painel-treino" class="painel-treino" aria-labelledby="aba-' + t.aba + '" tabindex="0">';
    s += t.aba === 'ingredientes' ? painelIngredientes() : t.aba === 'sugestoes' ? painelSugestoes() : t.aba === 'gravacoes' ? painelGravacoes() : painelLanches();
    return s + '</div>';
  }
  function comecarTreino() {
    var s = '<div class="vazio">' + ic('treino', 'g') + '<h2>O Farol aprende com a sua bancada</h2><p>Escolha um horário de movimento. O Farol grava, lê os lanches no computador da loja e traz o que viu para você conferir.</p>' +
      '<ol class="passo-a-passo comeco"><li>Escolha o horário: do que o gravador já guardou, ou para gravar depois.</li><li>O computador da loja lê os lanches, devagar, sem atrapalhar o expediente.</li><li>Você confere: confirma o que está certo e corrige o que não está. Cada conferência ensina.</li></ol>';
    s += configura() ? '<button class="btn cheio" type="button" data-nova-gravacao id="nova-gravacao-vazio">' + ic('mais', 'p') + 'Nova gravação de treino</button>' : '<p class="nota">Quem configura a loja cria a gravação de treino.</p>';
    return s + '</div>';
  }
  function numerosDoTreino() {
    var c = contas();
    var s = '<div class="dados" role="group" aria-label="O que o Farol já sabe nesta bancada">' +
      '<div class="dado"><b>' + c.conf + '</b><span>' + (c.conf === 1 ? 'lanche conferido' : 'lanches conferidos') + '</span></div>' +
      '<div class="dado"><b>' + (c.conf ? c.acertou + ' de ' + c.conf : '—') + '</b><span>o lanche certo, antes da conferência</span></div>' +
      '<div class="dado"><b>' + c.comExemplo + ' de ' + c.ings + '</b><span>ingredientes da bancada com exemplo</span></div></div>';
    var linhas = gravacoes().slice().reverse().map(function (g) {
      var cs = conferidos().filter(function (x) { return x.grav === g.id; });
      return { g: g, total: cs.length, certo: cs.filter(function (x) { return x.achou === x.era; }).length };
    }).filter(function (x) { return x.total > 0; });
    if (!linhas.length) return s;
    s += '<section class="cartao" aria-labelledby="t-acerto"><header><h2 id="t-acerto">O lanche certo, gravação por gravação</h2><span class="chip empurra">meta proposta: 9 em 10</span></header><div class="miolo"><div class="funil">';
    linhas.forEach(function (x) {
      var pct = Math.round(100 * x.certo / x.total);
      s += '<div class="funil-linha"><span>' + esc(x.g.quando) + '</span><span class="trilha" role="img" aria-label="' + pct + '%"><i style="width:' + pct + '%"></i></span><span class="v">' + x.certo + ' de ' + x.total + '</span></div>';
    });
    return s + '</div><p class="nota">Contado só nos lanches que alguém conferiu: antes da conferência, o Farol não sabe se acertou. A meta ainda é proposta: o lanche certo em 9 de cada 10, com pelo menos 30 conferidos.</p></div></section>';
  }
  // a linha de um lanche na fila
  var MOTIVOS = { duvida: ['facho', 'leitura com pouca certeza'], coberto: ['facho', 'uma etapa ficou coberta'], diferenca: ['dado', 'diferente da ficha'], certo: ['', 'o Farol acha que acertou'] };
  function linhaDoLanche(l) {
    var p = palpites(l)[0], m = MOTIVOS[l.motivo];
    return '<button class="lanche" type="button" data-lanche="' + l.id + '" id="lanche-' + l.id + '">' +
      '<span class="miniaturas" aria-hidden="true">' + desenho(camadasDoLado(l, 'tampo'), false, '') + desenho(camadasDoLado(l, 'base'), false, '') + '</span>' +
      '<span class="oq"><b>Lanche das ' + l.hora + '</b><small>gravação de ' + esc(gravacaoPorId(l.grav).quando) + '</small></span>' +
      '<span class="marcas"><span class="chip">o Farol acha: ' + esc(p.nome) + '</span><span class="chip' + (m[0] ? ' ' + m[0] : '') + '">' + m[1] + '</span></span>' + ic('seta', 'p') + '</button>';
  }
  function linhaConferida(c) {
    var certo = c.achou === c.era;
    return '<div class="lanche feito" role="listitem"><span class="oq"><b>Lanche das ' + c.hora + ' · ' + esc(c.era || 'não era lanche') + '</b><small>gravação de ' + esc(gravacaoPorId(c.grav).quando) + ' · conferido por ' + esc(c.por) + '</small></span>' +
      '<span class="marcas">' + (certo ? '<span class="chip ok">o Farol acertou</span>' : '<span class="chip fora">o Farol achou ' + esc(c.achou) + '</span>') + '</span></div>';
  }
  function painelLanches() {
    var t = est.treino, fila = paraConferir(), feitos = conferidos(), pul = pulados();
    var s = '<div class="barra"><div class="seg" role="group" aria-label="Quais lanches">';
    [['conferir', 'Para conferir', fila.length], ['conferidos', 'Conferidos', feitos.length], ['pulados', 'Pulados', pul.length]].forEach(function (f) {
      s += '<button type="button" data-filtro-lanches="' + f[0] + '" aria-pressed="' + (t.filtro === f[0]) + '">' + f[1] + ' <span class="mono">' + f[2] + '</span></button>';
    });
    s += '</div></div>';
    if (t.filtro === 'conferidos') {
      if (!feitos.length) return s + '<div class="vazio"><h2>Nenhum lanche conferido ainda</h2><p>Os lanches que alguém conferir aparecem aqui, com o que o Farol tinha achado.</p></div>';
      s += '<div class="lista" role="list" aria-label="Lanches conferidos">';
      feitos.forEach(function (c) { s += linhaConferida(c); });
      return s + '</div>';
    }
    var lista = t.filtro === 'pulados' ? pul : fila;
    if (!lista.length) {
      if (t.filtro === 'pulados') return s + '<div class="vazio"><h2>Nenhum lanche pulado</h2><p>Quando você pular um lanche na conferência, ele espera aqui.</p></div>';
      var lendo = gravacoes().filter(function (g) { return situacaoDaGravacao(g) === 'lendo'; })[0];
      if (lendo) return s + '<div class="vazio" role="status">' + ic('relogio', 'g') + '<h2>Nada para conferir ainda</h2><p>A gravação de ' + esc(lendo.quando) + ' está sendo lida no computador da loja (' + lendo.feito + '%). Os lanches aparecem aqui quando a leitura terminar.</p></div>';
      return s + '<div class="vazio" role="status">' + ic('certo', 'g') + '<h2>Tudo conferido</h2><p>Não há lanche esperando conferência. Para o Farol aprender mais, grave outro horário de movimento.</p>' +
        (configura() ? '<button class="btn" type="button" data-nova-gravacao id="nova-gravacao-tudo">' + ic('mais', 'p') + 'Nova gravação de treino</button>' : '') + '</div>';
    }
    if (t.filtro === 'conferir') s += '<p class="nota">Primeiro os lanches em que o Farol tem mais dúvida: é onde a sua conferência ensina mais.</p>';
    s += '<div class="lista" role="list" aria-label="' + (t.filtro === 'pulados' ? 'Lanches pulados' : 'Lanches para conferir') + '">';
    lista.forEach(function (l) { s += '<div role="listitem">' + linhaDoLanche(l) + '</div>'; });
    return s + '</div>';
  }
  function linhaDoIngrediente(i) {
    var a = aprendido(i.nome), f = (FOTOS[i.nome] || []).length, estado;
    if (NAO_SE_VE[i.nome]) estado = '<span class="chip">não se vê de cima</span>';
    else if (!a.exemplos) estado = '<span class="chip fora">sem exemplo</span>';
    else if (a.reconheceu / Math.max(a.presente, 1) >= 0.85 && a.presente >= 5) estado = '<span class="chip ok">reconhece: ' + a.reconheceu + ' de ' + a.presente + '</span>';
    else estado = '<span class="chip facho">aprendendo: ' + a.reconheceu + ' de ' + a.presente + '</span>';
    return '<button class="linha ing" type="button" data-ingrediente="' + esc(i.nome) + '" id="ing-' + slug(i.nome) + '">' +
      '<span class="nome"><b>' + esc(i.nome) + '</b><small>' + esc(i.produtos.join(', ')) + '</small></span>' +
      '<span class="marcas"><span class="chip">' + (f ? plural(f, 'foto', 'fotos') : 'sem foto') + '</span><span class="chip">' + plural(a.exemplos, 'exemplo', 'exemplos') + '</span></span>' +
      '<span class="marcas">' + estado + '</span>' + ic('seta', 'p') + '</button>';
  }
  function painelIngredientes() {
    var t = est.treino, todos = ingredientesDaBancada(), s = '';
    var orfas = Object.keys(ORFAS);
    if (orfas.length) {
      s += '<div class="aviso facho" role="status">' + ic('info') + '<div><b>' + plural(orfas.length, 'ingrediente que saiu das fichas ainda tem fotos', 'ingredientes que saíram das fichas ainda têm fotos') + ':</b> ' + esc(orfas.join(', ')) + '.' +
        ' <button class="btn mini" type="button" data-ingrediente="' + esc(orfas[0]) + '" id="ver-orfa">Ver</button></div></div>';
    }
    var semEx = todos.filter(function (i) { return !NAO_SE_VE[i.nome] && !aprendido(i.nome).exemplos; });
    var semFoto = todos.filter(function (i) { return !NAO_SE_VE[i.nome] && !(FOTOS[i.nome] || []).length; });
    var filtro = t.filtroIng || 'todos';
    s += '<div class="barra"><div class="seg" role="group" aria-label="Quais ingredientes">';
    [['todos', 'Todos', todos.length], ['semex', 'Sem exemplo', semEx.length], ['semfoto', 'Sem foto', semFoto.length]].forEach(function (f) {
      s += '<button type="button" data-filtro-ing="' + f[0] + '" aria-pressed="' + (filtro === f[0]) + '">' + f[1] + ' <span class="mono">' + f[2] + '</span></button>';
    });
    s += '</div></div>';
    var lista = filtro === 'semex' ? semEx : filtro === 'semfoto' ? semFoto : todos;
    if (!lista.length) return s + '<div class="vazio"><h2>Nenhum ingrediente com esse filtro</h2><p>Volte a ver todos.</p><button class="btn" type="button" data-filtro-ing="todos">Ver todos</button></div>';
    s += '<div class="lista" role="list" aria-label="Ingredientes desta bancada"><div class="lista-cab" aria-hidden="true"><span>Ingrediente</span><span>Fotos e exemplos</span><span>O que o Farol sabe</span><span></span></div>';
    lista.forEach(function (i) { s += linhaDoIngrediente(i); });
    return s + '</div><p class="nota">Os ingredientes dos lanches que já passaram por esta bancada. Outro ingrediente da loja entra aqui quando um lanche que o leva for conferido nela.</p>';
  }
  function cartaoDaSugestao(g) {
    var d = est.treino.decisoes[g.id];
    var s = '<section class="cartao sugestao" aria-labelledby="sg-' + g.id + '"><header><span class="chip">' + esc(g.tipo) + '</span>' +
      (d ? '<span class="chip ' + (d === 'sim' ? 'facho' : 'ok') + ' empurra">' + (d === 'sim' ? 'a mudar na ficha' : 'fica como está') + '</span>' : '') + '</header><div class="miolo">' +
      '<h3 id="sg-' + g.id + '">' + esc(g.titulo) + '</h3><p><b>O que a bancada mostrou.</b> ' + esc(g.viu) + '</p><p><b>A sugestão.</b> ' + esc(g.propoe) + '</p><p class="nota">' + esc(ondeMudar(g.ondeRegem)) + '</p>';
    if (!d && configura()) s += '<div class="linha-acoes"><button class="btn cheio" type="button" data-sugestao="' + g.id + '" data-v="sim" id="sg-' + g.id + '-sim">' + esc(g.sim) + '</button><button class="btn" type="button" data-sugestao="' + g.id + '" data-v="nao" id="sg-' + g.id + '-nao">' + esc(g.nao) + '</button></div>';
    if (!d && !configura()) s += '<p class="nota">Quem configura a loja responde às sugestões.</p>';
    if (d === 'sim') s += '<p class="nota">Quando a ficha chegar com a mudança, o Farol leva junto as fotos e os exemplos do nome antigo.</p>';
    return s + '</div></section>';
  }
  function painelSugestoes() {
    var todas = sugestoes();
    var s = '<p class="nota">As sugestões nascem só do que alguém conferiu, nunca de uma leitura sem conferência. O Farol não muda a ficha: quem muda é você, onde ela é cadastrada.</p>';
    if (!todas.length) return s + '<div class="vazio">' + ic('ideia', 'g') + '<h2>Nenhuma sugestão por enquanto</h2><p>Elas aparecem quando os lanches conferidos mostram um nome que confunde ou uma ficha diferente do que a bancada faz.</p></div>';
    var abertas = todas.filter(function (g) { return !est.treino.decisoes[g.id]; }), feitas = todas.filter(function (g) { return est.treino.decisoes[g.id]; });
    s += '<div class="sugestoes">';
    abertas.concat(feitas).forEach(function (g) { s += cartaoDaSugestao(g); });
    return s + '</div>';
  }
  function linhaDaGravacao(g) {
    var sit = situacaoDaGravacao(g), estado, acoes = '';
    if (sit === 'programada') estado = '<span class="chip">programada</span><span class="suave">grava no horário e lê depois</span>';
    else if (sit === 'fila') estado = '<span class="chip">na fila</span><span class="suave">começa quando a de antes terminar</span>';
    else if (sit === 'lendo') {
      estado = est.treino.situacao === 'semloja' ? '<span class="chip fora">parada</span><span class="suave">o computador da loja não responde</span>'
        : '<span class="chip facho">lendo na loja</span><progress max="100" value="' + g.feito + '" aria-label="Leitura da gravação">' + g.feito + '%</progress><span class="suave mono">' + g.feito + '%</span>';
    } else if (sit === 'pronta') {
      var faltam = paraConferir().concat(pulados()).filter(function (l) { return l.grav === g.id; }).length;
      estado = '<span class="chip dado">' + faltam + ' para conferir</span><span class="suave mono">' + plural(g.lanches, 'lanche', 'lanches') + '</span>';
    } else if (sit === 'apagada') estado = '<span class="chip">imagens apagadas</span><span class="suave mono">' + plural(g.lanches, 'lanche', 'lanches') + ' · o aprendido ficou</span>';
    else estado = '<span class="chip ok">conferida</span><span class="suave mono">' + plural(g.lanches, 'lanche', 'lanches') + (g.apaga ? ' · imagens até ' + g.apaga : ' · imagens por 30 dias') + '</span>';
    if (sit === 'pronta') acoes += '<button class="btn mini" type="button" data-ir-lanches>Conferir</button>';
    if (configura()) {
      if (sit === 'programada' || sit === 'fila') acoes += '<button class="btn mini" type="button" data-cancelar-gravacao="' + g.id + '" id="cancelar-' + g.id + '">Cancelar</button>';
      if (sit === 'conferida') acoes += '<button class="btn mini perigo" type="button" data-apagar-gravacao="' + g.id + '" id="apagar-' + g.id + '">Apagar as imagens</button>';
    }
    return '<div class="gravacao" role="listitem"><div class="de"><b>' + esc(g.quando) + '</b><small>' + esc(g.como === 'programada' ? 'programada' : 'do que o gravador guardou') + ' · ' + esc(BANCADA) + '</small></div><div class="estado">' + estado + '</div><div class="acoes">' + acoes + '</div></div>';
  }
  function painelGravacoes() {
    var lista = gravacoes();
    var s = '<div class="lista" role="list" aria-label="Gravações de treino">';
    lista.forEach(function (g) { s += linhaDaGravacao(g); });
    return s + '</div><p class="nota">A gravação inteira fica no computador da loja, separada das outras, e sai 30 dias depois de conferida. Para você conferir de qualquer lugar, sobem só os quadros das etapas, reduzidos.</p>';
  }

  /* ─────────── conferir um lanche ─────────── */
  function botaoDaEtapa(i, v, texto, atual) {
    return '<button type="button" data-etapa="' + i + '" data-v="' + v + '" id="et-' + i + '-' + v + '" aria-pressed="' + (atual === v) + '">' + texto + '</button>';
  }
  function escolhaDoIngrediente(i, re) {
    var s = '<div class="campo"><label for="et-' + i + '-nome">O que era</label><select class="entrada" id="et-' + i + '-nome" data-etapa-nome="' + i + '"><option value="">Escolha o ingrediente</option>';
    ingredientesDaLoja().forEach(function (g) { if (!NAO_SE_VE[g.nome]) s += '<option' + (re.nome === g.nome ? ' selected' : '') + '>' + esc(g.nome) + '</option>'; });
    s += '<option value="__novo"' + (re.nome === '__novo' ? ' selected' : '') + '>Um ingrediente que não está nas fichas…</option><option value="__naosei"' + (re.nome === '__naosei' ? ' selected' : '') + '>Não sei o que era</option></select></div>';
    if (re.nome === '__novo') {
      s += '<div class="campo"><label for="et-' + i + '-novo">Nome do ingrediente</label><input class="entrada" id="et-' + i + '-novo" type="text" maxlength="40" autocomplete="off" data-etapa-novo="' + i + '" value="' + esc(re.novo || '') + '"><small>Vira uma sugestão para as fichas.</small></div>';
    }
    return s;
  }
  var CERTEZA = { alta: ['ok', 'certeza alta'], media: ['', 'certeza média'], baixa: ['facho', 'pouca certeza'], nenhuma: ['facho', 'sem leitura'] };
  function blocoQualLanche(r, pal) {
    var s = '<section class="bloco" aria-labelledby="ql-t"><h3 id="ql-t">Qual lanche era?</h3><div class="familias" role="radiogroup" aria-labelledby="ql-t">';
    pal.slice(0, 2).forEach(function (o, i) {
      s += '<div class="familia"><input type="radio" name="qual-lanche" id="ql-' + i + '" value="' + esc(o.nome) + '" data-qual-lanche' + (r.produto === o.nome ? ' checked' : '') + '><label for="ql-' + i + '"><b>' + esc(o.nome) + (i === 0 ? ' <span class="chip dado">o Farol acha</span>' : '') + '</b><small>confere ' + o.batem + ' de ' + o.total + (o.fora ? ' · ' + o.fora + ' fora da ficha' : '') + '</small></label></div>';
    });
    s += '<div class="familia"><input type="radio" name="qual-lanche" id="ql-outro" value="__outro" data-qual-lanche' + (r.produto === '__outro' ? ' checked' : '') + '><label for="ql-outro"><b>Outro produto</b><small>escolha na lista</small></label></div>';
    s += '<div class="familia"><input type="radio" name="qual-lanche" id="ql-nao" value="__nao" data-qual-lanche' + (r.produto === '__nao' ? ' checked' : '') + '><label for="ql-nao"><b>Não era um lanche</b><small>ou não dá para saber</small></label></div></div>';
    if (r.produto === '__outro') {
      s += '<div class="campo"><label for="ql-qual">Qual produto</label><select class="entrada" id="ql-qual" data-outro-produto><option value="">Escolha o produto</option>';
      produtos().forEach(function (p) { if (p.ficha && p.cozinha && !pal.slice(0, 2).some(function (o) { return o.nome === p.nome; })) s += '<option' + (r.outroProduto === p.nome ? ' selected' : '') + '>' + esc(p.nome) + '</option>'; });
      s += '</select></div>';
    }
    return s + '</section>';
  }
  function blocoEtapas(l, r, podeConferir) {
    var s = '<section class="bloco" aria-labelledby="et-t"><h3 id="et-t">O que o Farol viu, etapa por etapa</h3><p class="nota">Na ordem em que aconteceu. Em cada quadro, o que mudou vem contornado. (No protótipo, desenhos no lugar dos recortes da câmera.)</p>';
    // o atalho: depois de corrigir o que está errado, o resto se confirma de uma vez (cada etapa certa vira exemplo)
    var semResposta = l.etapas.filter(function (e, i) { return e.leu && !(r.etapas[i] && r.etapas[i].v); }).length;
    if (podeConferir && semResposta) s += '<div class="linha-acoes"><button class="btn mini" type="button" data-etapas-certas id="etapas-certas">' + ic('certo', 'p') + 'Marcar as outras ' + semResposta + ' como certas</button></div>';
    s += '<ol class="etapas">';
    l.etapas.forEach(function (e, i) {
      var re = r.etapas[i] || {}, c = CERTEZA[e.certeza];
      var lido = e.leu ? esc(e.leu) + (e.vezes > 1 ? ' <span class="mono">×' + e.vezes + '</span>' : '') : 'não deu para ver';
      var leitura = '<b>' + lido + '</b>';
      if (re.v === 'outro' && nomeDaResposta(re)) leitura = '<s>' + lido + '</s> <b>' + esc(nomeDaResposta(re)) + '</b>';
      else if (re.v === 'outro' && re.nome === '__naosei') leitura = '<s>' + lido + '</s> <b>não sei</b>';
      else if (re.v === 'nada') leitura = '<s>' + lido + '</s> <b>não era ingrediente</b>';
      // a miniatura abre o recorte inteiro, maior (o rótulo vai no botão: o desenho fica mudo)
      s += '<li class="etapa' + (e.certeza === 'baixa' || e.certeza === 'nenhuma' ? ' atencao' : '') + '"><button class="ver-foto" type="button" data-foto-etapa="' + i + '" id="vf-' + i + '" aria-label="Ver maior o quadro das ' + e.hora + ' (' + esc(e.lado) + ')">' +
        quadro(camadasAte(l, i), true, null, null, true) + '<span class="lupa" aria-hidden="true">' + ic('busca', 'p') + '</span></button>' +
        '<div class="leitura"><p class="quando">' + e.hora + ' · ' + esc(e.lado) + '</p><p class="leu">' + leitura + ' <span class="chip' + (c[0] ? ' ' + c[0] : '') + '">' + c[1] + '</span></p>';
      if (podeConferir) {
        s += '<div class="seg" role="group" aria-label="A leitura das ' + e.hora + '">' +
          (e.leu ? botaoDaEtapa(i, 'certo', 'Certo', re.v) + botaoDaEtapa(i, 'outro', 'Era outro', re.v) + botaoDaEtapa(i, 'nada', 'Não era ingrediente', re.v)
            : botaoDaEtapa(i, 'outro', 'Eu sei o que era', re.v)) + '</div>';
        if (re.v === 'outro') s += escolhaDoIngrediente(i, re);
      }
      s += '</div></li>';
    });
    return s + '</ol></section>';
  }
  function segDaDiferenca(nome, atual, opcoes) {
    var s = '<div class="seg" role="group" aria-label="' + esc(nome) + '">';
    opcoes.forEach(function (o) { s += '<button type="button" data-diferenca="' + esc(nome) + '" data-v="' + o[0] + '" id="df-' + slug(nome) + '-' + o[0] + '" aria-pressed="' + (atual === o[0]) + '">' + o[1] + '</button>'; });
    return s + '</div>';
  }
  function blocoComparo(l, r, pal, podeConferir) {
    var nomeP = produtoEscolhido(l, r, pal);
    if (!nomeP) return '';
    var p = produtoPorNome(nomeP), c = compararComFicha(nomeP, vistos(l, false));
    var s = '<section class="bloco" aria-labelledby="cp-t"><h3 id="cp-t">Comparado com a ficha do ' + esc(nomeP) + '</h3>' + (r.produto ? '' : '<p class="nota">Pelo palpite do Farol. Muda quando você escolher o lanche acima.</p>') + '<ul class="comparo">';
    c.bate.forEach(function (x) { s += '<li class="bate">' + ic('certo', 'p') + '<span><b>' + esc(x.nome) + '</b>' + (x.quer > 1 ? ' <span class="mono">' + x.viu + ' de ' + x.quer + '</span>' : '') + '<small>visto</small></span></li>'; });
    c.menos.concat(c.falta).forEach(function (x) {
      var tira = adicionalQueTira(p, x.nome);
      s += '<li class="falta">' + ic('alerta', 'p') + '<span><b>' + esc(x.nome) + '</b> <span class="mono">' + x.viu + ' de ' + x.quer + '</span><small>' + (x.viu ? 'veio menos do que a ficha diz' : 'não foi visto') + (tira ? ' · o ' + esc(nomeP) + ' tem o adicional “' + esc(tira) + '”' : '') + '</small>' +
        (podeConferir ? segDaDiferenca(x.nome, r.ficha[x.nome], [['cliente', 'O cliente pediu assim'], ['faltou', 'Faltou'], ['naoviu', 'Estava lá; o Farol não viu']]) : '') + '</span></li>';
    });
    c.fora.forEach(function (x) {
      s += '<li class="fora-da-ficha">' + ic('mais', 'p') + '<span><b>' + esc(x.nome) + '</b><small>' + (x.adicional ? 'fora da ficha, mas é adicional do ' + esc(nomeP) : 'fora da ficha') + '</small>' +
        (podeConferir ? segDaDiferenca(x.nome, r.fora[x.nome], [['adicional', 'Pedido do cliente'], ['amais', 'A mais, sem pedido']]) : '') + '</span></li>';
    });
    c.naoSeVe.forEach(function (x) { s += '<li class="nao-se-ve">' + ic('menos', 'p') + '<span><b>' + esc(x.nome) + '</b><small>não se vê de cima: o Farol não confere</small></span></li>'; });
    s += '</ul>';
    if (c.menos.length || c.falta.length) s += '<p class="nota">O que falta nem sempre é erro: o cliente pode ter pedido sem. Com os pedidos do KDS, o Farol vai saber isso sozinho.</p>';
    return s + '</section>';
  }
  function semDiferenca(l, pal) {
    var c = compararComFicha(pal[0].nome, vistos(l, true));
    return !c.menos.length && !c.falta.length && !c.fora.length && l.etapas.every(function (e) { return e.certeza === 'alta'; });
  }
  function folhaDoLanche(id) {
    var l = lanchePorId(id);
    if (!l) return '';
    var r = respDe(l), pal = palpites(l), g = gravacaoPorId(l.grav), fila = paraConferir(), pos = fila.indexOf(l);
    var s = '<aside class="folha" role="dialog" aria-modal="true" aria-labelledby="lanche-titulo"><div class="folha-cab"><div><h2 id="lanche-titulo">Lanche das ' + l.hora + '</h2><p>' + esc(BANCADA) + ' · gravação de ' + esc(g.quando) + ' · fechou às ' + l.fechou +
      (pos >= 0 ? ' · ' + (pos + 1) + ' de ' + fila.length + ' para conferir' : '') + '</p></div><button class="btn quadrado fantasma" type="button" data-fechar aria-label="Fechar">' + ic('x') + '</button></div><div class="folha-corpo">';
    if (l.motivo === 'duvida') s += '<div class="aviso facho">' + ic('info') + '<div><b>Uma leitura saiu com pouca certeza.</b> Confira com calma: é onde a sua resposta mais ensina.</div></div>';
    if (l.motivo === 'coberto') s += '<div class="aviso facho">' + ic('info') + '<div><b>Numa etapa, a mão cobriu a base.</b> O Farol não leu o que entrou ali. Se você souber, diga; se não souber, deixe sem resposta.</div></div>';
    s += blocoQualLanche(r, pal) + blocoEtapas(l, r, true) + blocoComparo(l, r, pal, true);
    s += '<p class="nota">' + ic('cadeado', 'p') + ' A gravação inteira fica no computador da loja. Os quadros das etapas sobem reduzidos, só para a conferência, e saem 30 dias depois dela.</p>';
    s += '</div><div class="folha-pe">';
    var conferidas = l.etapas.filter(function (e, i) { return r.etapas[i] && r.etapas[i].v; }).length;
    s += '<p class="nota pe-nota">' + (r.produto ? conferidas + ' de ' + plural(l.etapas.length, 'etapa conferida', 'etapas conferidas') + (conferidas ? ': cada uma vira exemplo.' : '.') : 'Escolha qual lanche era para salvar.') + '</p>';
    s += '<button class="btn" type="button" data-pular-lanche id="pular-lanche">Pular</button>';
    if (!r.produto && semDiferenca(l, pal)) s += '<button class="btn" type="button" data-tudo-certo id="tudo-certo">' + ic('certo', 'p') + 'Está tudo certo</button>';
    s += '<button class="btn cheio" type="button" data-salvar-lanche id="salvar-lanche"' + (r.produto ? '' : ' disabled') + '>Salvar e ir para o próximo</button>';
    return s + '</div></aside>';
  }
  // o que a conferência ensina: cada etapa confirmada vira exemplo; o lanche conta para o acerto
  function salvarLanche(l) {
    var r = respDe(l), pal = palpites(l), achou = pal[0].nome;
    var era = r.produto === '__outro' ? r.outroProduto : r.produto === '__nao' ? '' : r.produto;
    var novos = 0, presentes = {};
    function presente(nome, reconheceu) {
      var a = APRENDIDO[nome] || (APRENDIDO[nome] = { presente: 0, reconheceu: 0, exemplos: 0 });
      if (presentes[nome]) return a;
      presentes[nome] = true;
      a.presente++;
      if (reconheceu) a.reconheceu++;
      return a;
    }
    l.etapas.forEach(function (e, i) {
      var re = r.etapas[i];
      if (!re) return;
      var nome = re.v === 'certo' ? e.leu : re.v === 'outro' ? nomeDaResposta(re) : '';
      if (!nome) return;
      presente(nome, re.v === 'certo').exemplos++;
      novos++;
      if (re.nome === '__novo' && re.novo) novaSugestao(re.novo.trim(), l);
    });
    Object.keys(r.ficha).forEach(function (nome) { if (r.ficha[nome] === 'naoviu') presente(nome, false); });
    est.treino.feitos.unshift({ id: l.id, hora: l.hora, grav: l.grav, achou: achou, era: era, por: 'você' });
    est.treino.pulados = est.treino.pulados.filter(function (x) { return x !== l.id; });
    return novos;
  }
  function novaSugestao(nome, l) {
    if (est.treino.novas.some(function (g) { return g.ingrediente === nome; })) return;
    est.treino.novas.unshift({ id: 'n-' + slug(nome), tipo: 'nome fora das fichas', ingrediente: nome,
      titulo: '“' + nome + '” não está em nenhuma ficha',
      viu: 'Ao conferir o lanche das ' + l.hora + ', você chamou um ingrediente de “' + nome + '”.',
      propoe: 'Se ele entra em algum lanche, cadastre-o na ficha com este nome: assim o Farol junta os exemplos dele ao ingrediente certo.',
      ondeRegem: 'na ficha do lanche em que ele entra', sim: 'Vou cadastrar', nao: 'Foi engano meu' });
  }

  /* ─────────── nova gravação de treino ─────────── */
  function dataISO(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function novaGravacao() {
    var ontem = new Date(); ontem.setDate(ontem.getDate() - 1);
    return { de: 'gravador', dia: dataISO(ontem), das: '19:30', as: '20:00', erro: '' };
  }
  function folhaNovaGravacao() {
    var n = est.treino.nova;
    var s = '<aside class="folha estreita" role="dialog" aria-modal="true" aria-labelledby="ng-titulo"><div class="folha-cab"><div><h2 id="ng-titulo">Nova gravação de treino</h2><p>Um horário de movimento, para o Farol ler e você conferir.</p></div><button class="btn quadrado fantasma" type="button" data-fechar aria-label="Fechar">' + ic('x') + '</button></div><div class="folha-corpo">';
    s += '<div class="campo"><label for="ng-bancada">Bancada</label><select class="entrada" id="ng-bancada"><option>' + esc(BANCADA) + ' · câmera 4</option></select></div>';
    s += '<div class="campo"><span class="rotulo" id="ng-de-t">De onde</span><div class="familias" role="radiogroup" aria-labelledby="ng-de-t">' +
      '<div class="familia"><input type="radio" name="ng-de" id="ng-gravador" value="gravador" data-ng-de' + (n.de === 'gravador' ? ' checked' : '') + '><label for="ng-gravador"><b>Do que o gravador já guardou</b><small>um horário das últimas 18 horas</small></label></div>' +
      '<div class="familia"><input type="radio" name="ng-de" id="ng-programar" value="programar" data-ng-de' + (n.de === 'programar' ? ' checked' : '') + '><label for="ng-programar"><b>Programar</b><small>um horário que ainda vai acontecer</small></label></div></div></div>';
    s += '<div class="tres-campos"><div class="campo"><label for="ng-dia">Dia</label><input class="entrada" type="date" id="ng-dia" value="' + esc(n.dia) + '"' + (n.erro ? ' aria-describedby="ng-erro"' : '') + '></div>' +
      '<div class="campo"><label for="ng-das">Das</label><input class="entrada" type="time" id="ng-das" value="' + esc(n.das) + '"></div>' +
      '<div class="campo"><label for="ng-as">Às</label><input class="entrada" type="time" id="ng-as" value="' + esc(n.as) + '"></div></div>';
    if (n.erro) s += '<span class="erro-do-campo" id="ng-erro" role="alert">' + esc(n.erro) + '</span>';
    s += '<div class="ajuda"><b>Para o Farol aprender mais por minuto gravado</b><ul><li>Um horário de movimento: mais lanches, mais exemplos.</li><li>De 15 minutos a 1 hora por gravação.</li><li>Com a luz de sempre da bancada.</li></ul></div>';
    s += '<p class="nota">A leitura roda no computador da loja, devagar, para não atrapalhar o expediente: 30 minutos gravados levam perto de 1 hora para ler. O quanto o gravador guarda é medido nele; o desta loja guarda cerca de 18 horas.</p>';
    return s + '</div><div class="folha-pe"><button class="btn" type="button" data-fechar>Cancelar</button><button class="btn cheio" type="button" data-criar-gravacao>Criar gravação</button></div></aside>';
  }
  function quandoDaGravacao(dia, das, as) {
    var hoje = dataISO(new Date()), ontem = new Date(); ontem.setDate(ontem.getDate() - 1);
    var d = dia === hoje ? 'hoje' : dia === dataISO(ontem) ? 'ontem' : dia.slice(8, 10) + '/' + dia.slice(5, 7);
    return d + ', ' + das + ' às ' + as;
  }
  function conferirNovaGravacao(n) {
    if (!n.dia || !n.das || !n.as) return 'Preencha o dia e os dois horários.';
    var ini = new Date(n.dia + 'T' + n.das), fim = new Date(n.dia + 'T' + n.as), agora = new Date();
    var min = (fim - ini) / 60000;
    if (!(min > 0)) return 'O fim precisa ser depois do começo.';
    if (min < 15 || min > 60) return 'Uma gravação de treino vai de 15 minutos a 1 hora.';
    if (n.de === 'gravador') {
      if (fim > agora) return 'Este horário ainda não terminou: escolha “Programar”.';
      if (agora - ini > 18 * 3600000) return 'O gravador não guarda mais este horário: ele guarda cerca de 18 horas.';
    } else if (ini < agora) return 'Este horário já começou: escolha “Do que o gravador já guardou”.';
    return '';
  }
  function dialogoApagarGravacao(id) {
    var g = gravacaoPorId(id);
    return '<div class="dialogo" role="alertdialog" aria-modal="true" aria-labelledby="dlg-t" aria-describedby="dlg-d"><div><h2 id="dlg-t">Apagar as imagens da gravação de ' + esc(g.quando) + '?</h2>' +
      '<p id="dlg-d">A gravação sai do computador da loja e os quadros das etapas saem da nuvem. O que o Farol aprendeu fica: o recorte de cada ingrediente conferido e os números.</p>' +
      '<div class="linha-acoes"><button class="btn" type="button" data-fechar data-foco>Manter</button><button class="btn perigo" type="button" data-confirmar-apagar-gravacao="' + id + '">Apagar as imagens</button></div></div></div>';
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
      s += '<div class="soltar">' + ic('enviar', 'g') + '<p>Escolha a planilha preenchida. O Farol confere tudo antes de gravar, e mostra <b>o que entra e o que fica de fora</b>.</p><label class="sr" for="imp-arquivo">A planilha preenchida</label><input type="file" id="imp-arquivo" accept=".xlsx,.csv" data-foco><p class="nota">Aceita .xlsx e .csv, até 2 MB.</p></div>';
      s += '<div class="so-proto"><span>só no protótipo</span><div class="linha-acoes"><button class="btn mini" type="button" data-imp-simular="certa">Simular uma planilha certa</button><button class="btn mini" type="button" data-imp-simular="problemas">Simular uma com problemas</button><button class="btn mini" type="button" data-imp-simular="nada">Simular uma toda errada</button></div></div>';
      pe = '<button class="btn" type="button" data-imp-passo="1">Voltar ao modelo</button>';
    } else if (i.resultado === 'nada') {
      s += '<div class="aviso fora" role="alert">' + ic('alerta') + '<div><b>Nenhum produto da planilha está certo, e nada foi importado.</b> Corrija o que a lista aponta e envie de novo. As fichas que a loja tem continuam como estavam.</div></div>';
      s += listaDeFora();
      pe = '<button class="btn" type="button" data-imp-passo="1">Voltar ao modelo</button><button class="btn cheio" type="button" data-imp-passo="2" data-foco>Enviar a planilha corrigida</button>';
    } else if (i.resultado === 'problemas') {
      var entram = PRODUTOS.length - DE_FORA.length;
      s += '<div class="aviso facho" role="status">' + ic('info') + '<div><b>' + plural(DE_FORA.length, 'produto fica', 'produtos ficam') + ' de fora; os outros ' + entram + ' entram.</b> O produto com uma linha errada fica inteiro de fora, para o Farol não conferir a montagem contra meia ficha. Nada foi gravado ainda.</div></div>';
      s += '<div class="bloco"><h3>O que entra</h3><div class="contas"><span class="chip">' + entram + ' produtos</span><span class="chip ok">1 com ficha</span><span class="chip">2 ingredientes</span><span class="chip">4 variações</span><span class="chip">1 adicional</span></div></div>';
      s += '<div class="bloco"><h3>O que fica de fora, e por quê</h3>' + listaDeFora() + '<p class="nota">Esta lista continua à mão depois de importar, na tela Fichas.</p></div>';
      if (temFichas()) {
        s += '<div class="aviso">' + ic('info') + '<div><b>Importar troca todas as fichas da Loja Centro</b> — as da planilha importada hoje, às 14:02, saem e estas entram no lugar.</div></div>';
      }
      pe = '<button class="btn" type="button" data-imp-passo="2">Enviar outra planilha</button><button class="btn cheio" type="button" data-imp-gravar="parcial" data-foco>Importar os ' + entram + ' que estão certos</button>';
    } else {
      s += '<div class="aviso" role="status">' + ic('certo') + '<div><b>A planilha está certa.</b> Nada foi gravado ainda: confira os números e importe.</div></div>';
      s += '<div class="contas"><span class="chip">7 produtos</span><span class="chip ok">3 com ficha</span><span class="chip">14 ingredientes</span><span class="chip">4 variações</span><span class="chip">8 adicionais</span><span class="chip">1 combo</span></div>';
      s += '<div class="aviso">' + ic('info') + '<div><b>3 produtos entram sem ficha</b>, porque não têm ingrediente na planilha: Milk-shake, Refrigerante lata e Água sem gás. Para o que não passa pela cozinha, não faz falta.</div></div>';
      if (temFichas()) {
        s += '<div class="aviso facho">' + ic('info') + '<div><b>Importar troca todas as fichas da Loja Centro</b> — as da planilha importada hoje, às 14:02, saem e estas entram no lugar.</div></div>';
      }
      pe = '<button class="btn" type="button" data-imp-passo="2">Enviar outra planilha</button><button class="btn cheio" type="button" data-imp-gravar="tudo" data-foco>Importar</button>';
    }
    return s + '</div><div class="folha-pe">' + pe + '</div></aside>';
  }
  // o que ficou de fora, produto por produto, com a aba, a linha e o que fazer
  function listaDeFora() {
    var s = '<ul class="de-fora" aria-label="O que fica de fora">';
    DE_FORA.forEach(function (d) {
      s += '<li><b>' + esc(d.produto) + '</b><ul class="problemas">';
      d.problemas.forEach(function (p) { s += '<li><span class="onde">' + esc(p[0]) + ', linha ' + p[1] + '</span><span>' + esc(p[2]) + '<small>' + esc(p[3]) + '</small></span></li>'; });
      s += '</ul></li>';
    });
    return s + '</ul>';
  }
  // depois de importar: a mesma lista, para quem vai corrigir a planilha
  function folhaDeFora() {
    return '<aside class="folha estreita" role="dialog" aria-modal="true" aria-labelledby="fora-titulo"><div class="folha-cab"><div><h2 id="fora-titulo">O que ficou de fora</h2><p>fichas-da-loja.xlsx · importada hoje, 14:02, por Gil Prado</p></div><button class="btn quadrado fantasma" type="button" data-fechar aria-label="Fechar" data-foco>' + ic('x') + '</button></div><div class="folha-corpo">' +
      '<p>' + plural(DE_FORA.length, 'produto', 'produtos') + ' e ' + plural(quantosProblemas(), 'linha para corrigir', 'linhas para corrigir') + '. Os outros produtos da planilha entraram.</p>' + listaDeFora() +
      '</div><div class="folha-pe"><p class="nota">Corrija na planilha e importe de novo: a importação troca todas as fichas da loja.</p><button class="btn" type="button" data-fechar>Fechar</button></div></aside>';
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
  // cada acesso diz até quando vale e em que pé está (Padrão DMS §2.4)
  function estadoDoAcesso(a) {
    var e = a.situacao || 'valendo';
    if (e === 'novo') return '<span class="chip">ainda não enviou nada</span><span class="suave mono">criado hoje, 13:40 · vale até 15/10/2027</span>';
    if (e === 'vence') return '<span class="chip facho">vence em 12 dias</span><span class="suave mono">recebido hoje, 14:02 · vale até 27/10</span>';
    if (e === 'vencido') return '<span class="chip fora">venceu em 03/10</span><span class="suave mono">não recebe nada desde então · último envio em 02/10</span>';
    if (e === 'suspenso') return '<span class="chip fora">suspenso</span><span class="suave mono">90 dias sem envio · o último foi em 14/07</span>';
    if (e === 'renovado') return '<span class="chip ok">renovado hoje, 10:05</span><span class="suave mono">o antigo vale até 22/10 · o novo, até 15/10/2027</span>';
    // renovado depois de vencer: não há código antigo valendo, e o sistema ainda não enviou com o novo
    if (e === 'renovado-vencido') return '<span class="chip ok">renovado hoje, 10:05</span><span class="suave mono">esperando o primeiro envio com ele · vale até 15/10/2027</span>';
    return '<span class="chip ok">recebido hoje, 14:02</span><span class="suave mono">7 produtos · 3 com ficha · vale até 02/03/2027</span>';
  }
  function linhaDoAcesso(a, i) {
    var e = a.situacao || 'valendo';
    var s = '<div class="acesso"><div class="de"><b>' + esc(a.nome) + '</b><small>envia para a ' + esc(nomeDaLoja(a.loja)) + ' · criado por ' + esc(a.por || QUEM_CRIOU) + '</small></div><div class="estado">' + estadoDoAcesso(a) + '</div><div class="acoes">';
    if (a.enviou && a.loja === 'centro') s += '<button class="btn mini" type="button" data-ir="fichas">Ver fichas</button>';
    if (diretoria()) {
      // suspenso: reativar é um clique (o código é o mesmo); vencido ou perto de vencer: renovar (sai outro código)
      if (e === 'suspenso') s += '<button class="btn mini cheio" type="button" data-reativar="' + i + '" id="reativar-' + i + '">Reativar</button>';
      else if (e !== 'renovado' && e !== 'renovado-vencido') s += '<button class="btn mini' + (e === 'vence' || e === 'vencido' ? ' cheio' : '') + '" type="button" data-renovar="' + i + '" id="renovar-' + i + '">Renovar</button>';
      s += '<button class="btn mini perigo" type="button" data-revogar="' + i + '" id="revogar-' + i + '">Revogar</button>';
    }
    return s + '</div></div>';
  }
  // os outros da diretoria ficam sabendo do que uma pessoa fez nos acessos — aqui, no console (o Farol não manda e-mail)
  function avisoParaADiretoria() {
    if (est.perfil !== 'diretoria-outra' || est.avisoVisto) return '';
    var o = '';
    if (est.situacao === 'sistema-novo') o = esc(QUEM_CRIOU) + ' criou o acesso do ' + esc(SISTEMA) + ' para a Loja Centro hoje, às 13:40.';
    if (est.situacao === 'sistema-renovado') o = esc(QUEM_CRIOU) + ' renovou o acesso do ' + esc(SISTEMA) + ' hoje, às 10:05. O código antigo vale até 22/10.';
    if (!o) return '';
    return '<div class="aviso facho" role="status">' + ic('sino') + '<div><b>Mudou um acesso de outro sistema.</b> ' + o + ' Não foi você? Revogue o acesso e fale com quem o criou.<button class="btn mini" type="button" data-entendi>Entendi</button></div></div>';
  }
  function cartaoOutroSistema() {
    var n = est.acessos.length;
    var noTeto = n >= TETO_DE_ACESSOS;
    var s = '<section class="cartao" aria-labelledby="t-sistema"><header><h2 id="t-sistema">Outro sistema</h2><span class="chip' + (noTeto ? ' facho' : n ? ' ok' : '') + '">' + (n ? plural(n, 'acesso', 'acessos') + (noTeto ? ' · o máximo' : '') : 'nenhum acesso') + '</span>';
    if (diretoria() && !noTeto) s += '<button class="btn mini empurra" type="button" data-novo-acesso id="novo-acesso">' + ic('chave', 'p') + 'Criar acesso</button>';
    s += '</header>';
    if (n) {
      if (noTeto && diretoria()) s += '<div class="miolo"><div class="aviso facho">' + ic('info') + '<div><b>A conta chegou a ' + TETO_DE_ACESSOS + ' acessos, o máximo.</b> Para criar outro, revogue um que não se usa mais.</div></div></div>';
      s += '<div class="miolo sem-folga">';
      est.acessos.forEach(function (a, i) { s += linhaDoAcesso(a, i); });
      s += '</div><div class="miolo"><p class="nota">O código de acesso aparece uma vez, quando é criado ou renovado. Ele vale 12 meses, e 15 dias antes de vencer o Farol avisa aqui e na tela Fichas. Parado 90 dias, fica suspenso até alguém da diretoria reativar. Perdeu o código? Renove: sai um novo, e o antigo para em 7 dias. Desconfia que vazou? Revogue. A documentação para quem cuida do sistema fica em <span class="mono">' + DOCUMENTACAO + '</span>.</p></div>';
      return s + '</section>';
    }
    s += '<div class="miolo"><p>A loja usa outro sistema para o cardápio e as fichas? Ele pode enviá-las ao Farol. Você cria um acesso aqui e entrega a quem cuida desse sistema — com o endereço da documentação.</p>';
    s += oQueRecebe();
    s += '<div class="bloco"><h3>Como funciona</h3><ol class="passo-a-passo"><li>Você cria o acesso aqui e escolhe a loja.</li><li>Entrega o código e o endereço da documentação a quem cuida do sistema.</li><li>O sistema passa a enviar as fichas, e elas aparecem na tela Fichas da loja.</li></ol></div>';
    if (!diretoria()) s += '<div class="aviso">' + ic('cadeado') + '<div><b>Só a diretoria cria acesso para outro sistema.</b> Deixar outro sistema escrever aqui é decisão dela.</div></div>';
    return s + '</div></section>';
  }
  function cartaoPlanilha() {
    var s = '<section class="cartao" aria-labelledby="t-planilha"><header><h2 id="t-planilha">Planilha</h2>' + (origem() === 'planilha' ? '<span class="chip ok">Loja Centro · importada hoje, 14:02</span>' : '') + '</header><div class="miolo">';
    s += '<p>Sem sistema, ou com as fichas no Excel? Dá para importar por planilha, loja por loja, na tela Fichas de cada uma. O modelo já vem com as colunas.</p>';
    s += '<div class="linha-acoes"><button class="btn" type="button" data-ir="fichas">' + ic('ficha', 'p') + 'Ir para Fichas da Loja Centro</button><button class="btn" type="button" data-baixar="modelo">' + ic('baixar', 'p') + 'Baixar o modelo</button></div>';
    return s + '</div></section>';
  }
  function telaConexoes() {
    var s = '<div class="cab"><div><h1>Conexões</h1><p class="suave" style="margin-top:8px;max-width:64ch">De onde o Farol recebe o que as lojas vendem e produzem. Vale para a conta inteira; cada loja recebe as fichas de um lugar só.</p></div></div>';
    s += avisoParaADiretoria();
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
  // o termo de uso do acesso: o texto inteiro a um toque, e o aceite (a versão fica guardada junto do acesso)
  function blocoDoTermo(id, marcado, erro) {
    var s = '<div class="bloco termo"><h3>Termo de uso do acesso</h3><details><summary>Ler o termo (' + TERMO_VERSAO + ')</summary><ol class="termo-itens">';
    TERMO.forEach(function (t) { s += '<li>' + esc(t) + '</li>'; });
    s += '</ol></details><label class="marcar"><input type="checkbox" id="' + id + '"' + (marcado ? ' checked' : '') + (erro ? ' aria-invalid="true" aria-describedby="' + id + '-erro"' : '') + '><span>Li e aceito o termo de uso do acesso</span></label>';
    return s + (erro ? '<span class="erro-do-campo" id="' + id + '-erro" role="alert">' + esc(erro) + '</span>' : '') + '</div>';
  }
  // a senha de quem cria ou renova: confirma que é a própria pessoa, e não alguém com o console aberto
  function campoDaSenha(id, erro, fazendo) {
    return '<div class="campo"><label for="' + id + '">Sua senha</label><input class="entrada" id="' + id + '" type="password" autocomplete="current-password"' + (erro ? ' aria-invalid="true" aria-describedby="' + id + '-erro"' : '') + '><small>Para confirmar que é você quem está ' + fazendo + ' o acesso. No protótipo, qualquer senha serve — menos “errada”.</small>' + (erro ? '<span class="erro-do-campo" id="' + id + '-erro" role="alert">' + esc(erro) + '</span>' : '') + '</div>';
  }
  function erroDaSenha(valor) {
    if (!valor) return 'Digite a sua senha para confirmar.';
    if (valor === 'errada') return 'A senha não confere. Tente de novo.';
    return '';
  }
  // renovar: sai um código novo; o antigo vale mais 7 dias (se ainda não venceu)
  function folhaRenovar() {
    var r = est.renova, a = est.acessos[r.i], vencido = a.situacao === 'vencido', s, pe;
    s = '<aside class="folha estreita" role="dialog" aria-modal="true" aria-labelledby="renova-titulo"><div class="folha-cab"><div><h2 id="renova-titulo">' + (r.passo === 1 ? 'Renovar o acesso' : 'Código novo') + '</h2><p>' + esc(a.nome) + ' → ' + esc(nomeDaLoja(a.loja)) + '</p></div><button class="btn quadrado fantasma" type="button" data-fechar aria-label="Fechar">' + ic('x') + '</button></div><div class="folha-corpo">';
    if (r.passo === 1) {
      s += '<p>Sai um código novo, que vale 12 meses, até <b>15/10/2027</b>. É ele que vai para o sistema.</p>';
      s += vencido
        ? '<div class="aviso fora">' + ic('alerta') + '<div><b>O código de hoje já venceu, em 03/10.</b> O sistema volta a enviar assim que receber o novo.</div></div>'
        : '<div class="aviso facho">' + ic('relogio') + '<div><b>O código de hoje continua valendo por mais 7 dias, até 22/10,</b> para dar tempo de trocar no sistema. Depois, só o novo entra.</div></div>';
      s += '<p class="nota">' + ic('cadeado', 'p') + ' Termo de uso: ' + TERMO_VERSAO + ', aceito por ' + esc(a.por || QUEM_CRIOU) + ' ao criar o acesso. Se o texto mudar, a renovação pede o aceite de novo.</p>';
      s += campoDaSenha('renova-senha', r.erroSenha, 'renovando');
      s += '<p class="nota">' + ic('sino', 'p') + ' Os outros da diretoria veem um aviso de que você renovou este acesso.</p>';
      pe = '<button class="btn" type="button" data-fechar>Cancelar</button><button class="btn cheio" type="button" data-gerar-codigo>Gerar o código novo</button>';
    } else {
      s += '<div class="bloco"><h3>O código novo</h3><div class="codigo"><code id="codigo-de-acesso">' + CODIGO_DE_EXEMPLO + '</code><button class="btn mini" type="button" data-copiar data-foco>' + ic('copiar', 'p') + 'Copiar</button></div><p class="suave">Vale até <b>15/10/2027</b>.</p></div>';
      s += '<div class="aviso facho" role="status">' + ic('info') + '<div><b>Este código aparece só agora.</b> Depois de fechar, o Farol não o mostra de novo. Se perder, renove outra vez.</div></div>';
      s += '<div class="bloco"><h3>O que fazer agora</h3><ol class="entregar"><li><span>Entregue o código novo a quem cuida do sistema, para ele trocar' + (vencido ? '.' : ' antes de <b>22/10</b>, quando o antigo para.') + '</span></li><li><span>Para conferir, o sistema consulta a porta: a resposta traz o nome do sistema e a loja.</span></li><li><span>Mais nada: a documentação e as fichas não mudam.</span></li></ol></div>';
      pe = '<button class="btn cheio" type="button" data-concluir-renovar>Concluir</button>';
    }
    return s + '</div><div class="folha-pe">' + pe + '</div></aside>';
  }
  // criar o acesso: o nome e a loja; depois, o código — que aparece uma vez
  function comoEstaALoja(id) {
    if (ligadaAoRegem() || est.situacao === 'voltou') return 'regem';
    var tem = false;
    est.acessos.forEach(function (a) { if (a.loja === id) tem = true; });
    if (tem) return 'sistema';
    if (id === 'centro' && origem() === 'planilha') return 'planilha';
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
      s += '<div class="bloco"><h3>O que este acesso pode</h3><p class="suave">Enviar as fichas da loja escolhida e consultar o que o Farol tem desse sistema. Mais nada: nem câmeras, nem alertas, nem outra loja.</p><p class="suave">Vale 12 meses, até <b>15/10/2027</b>. Quinze dias antes de vencer, o Farol avisa aqui e na tela Fichas.</p></div>';
      s += blocoDoTermo('novo-termo', n.termo, n.erroTermo);
      s += campoDaSenha('novo-senha', n.erroSenha, 'criando');
      s += '<p class="nota">' + ic('sino', 'p') + ' Os outros da diretoria veem um aviso de que você criou este acesso.</p>';
      pe = '<button class="btn" type="button" data-fechar>Cancelar</button><button class="btn cheio" type="button" data-criar-acesso>Criar acesso</button>';
    } else {
      s += '<div class="bloco"><h3>O código de acesso</h3><div class="codigo"><code id="codigo-de-acesso">' + CODIGO_DE_EXEMPLO + '</code><button class="btn mini" type="button" data-copiar data-foco>' + ic('copiar', 'p') + 'Copiar</button></div><p class="suave">Vale até <b>15/10/2027</b>. Termo aceito: ' + TERMO_VERSAO + '.</p></div>';
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
    s += item('treinamento', 'treinamento', 'treino', 'Treinamento', 'a bancada aprende com o que você confere');
    if (configura()) {
      s += item('orcamento', 'fora', 'conta', 'Orçamento', 'o que falta para a loja ficar coberta');
      s += item('conexoes', 'conexoes', 'tomada', 'Conexões', 'de onde vêm as fichas das lojas');
    }
    return s + '<button class="btn fechar" type="button" data-fechar data-foco>Fechar</button></div>';
  }

  /* ─────────── pintar ─────────── */
  function pintarCaminho() {
    var el = document.getElementById('caminho');
    el.innerHTML = est.tela === 'conexoes' ? '<span>Sua conta</span>' + ic('seta', 'p') + '<b>Conexões</b>' : '<span>Loja Centro</span>' + ic('seta', 'p') + '<b>' + (est.tela === 'treinamento' ? 'Treinamento' : 'Fichas') + '</b>';
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
    tela.innerHTML = est.tela === 'conexoes' ? telaConexoes() : est.tela === 'treinamento' ? telaTreinamento() : telaFichas();
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
    est.treino.aberto = null;
    est.treino.ingrediente = null;
    est.treino.deProduto = null;
    est.treino.nova = null;
    est.treino.erroFoto = '';
    est.treino.foto = null;
    est.renova = null;
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
  // a MESMA gaveta, desenhada de novo depois de uma escolha dentro dela: sem a animação de entrada, na mesma rolagem,
  // e com o foco de volta em quem foi clicado
  function redesenhar(html, focoId) {
    var corpo = sobre.querySelector('.folha-corpo'), topo = corpo ? corpo.scrollTop : 0;
    sobre.innerHTML = '<div class="veu" data-fechar></div>' + html;
    var folha = sobre.querySelector('.folha');
    if (folha) folha.classList.add('sem-entrada');
    var novo = sobre.querySelector('.folha-corpo');
    if (novo) novo.scrollTop = topo;
    var alvo = focoId ? document.getElementById(focoId) : null;
    if (alvo) { try { alvo.focus({ preventScroll: true }); } catch (e) { alvo.focus(); } }
  }

  /* ─────────── o quadro de uma etapa, maior: por cima da gaveta do lanche, sem fechá-la ─────────── */
  var RESPOSTA = { certo: 'certo', outro: 'era outro', nada: 'não era ingrediente' };
  function corpoDaFoto(l, i) {
    var e = l.etapas[i], c = CERTEZA[e.certeza], re = respDe(l).etapas[i] || {}, n = l.etapas.length;
    var lido = e.leu ? esc(e.leu) + (e.vezes > 1 ? ' <span class="mono">×' + e.vezes + '</span>' : '') : 'nada: não deu para ver';
    var disse = re.v === 'outro' && nomeDaResposta(re) ? 'era ' + esc(nomeDaResposta(re)) : re.v ? RESPOSTA[re.v] : '';
    var s = '<div><div class="foto-cab"><div><h2 id="fe-t">Etapa das ' + e.hora + '</h2><p id="fe-d">' + esc(e.lado) + ' · o Farol leu <b>' + lido + '</b> <span class="chip' + (c[0] ? ' ' + c[0] : '') + '">' + c[1] + '</span>' +
      (disse ? ' <span class="chip dado">você disse: ' + disse + '</span>' : '') + '</p></div>' +
      '<button class="btn quadrado fantasma" type="button" data-fechar-foto id="fe-fechar" aria-label="Fechar o quadro">' + ic('x') + '</button></div>';
    s += '<div class="quadro inteiro">' + desenhoDoRecorte(l, i, 'Desenho de exemplo: o recorte inteiro das ' + e.hora) + '<span class="tarja" aria-hidden="true">desenho de exemplo</span></div>';
    s += '<div class="foto-nav"><button class="btn" type="button" data-foto-ir="' + (i - 1) + '" id="fe-antes"' + (i ? '' : ' disabled') + '>' + ic('voltar', 'p') + 'Anterior</button>' +
      '<span class="mono">' + (i + 1) + ' de ' + n + '</span>' +
      '<button class="btn" type="button" data-foto-ir="' + (i + 1) + '" id="fe-depois"' + (i < n - 1 ? '' : ' disabled') + '>Próxima' + ic('seta', 'p') + '</button></div>';
    s += '<p class="nota">O recorte inteiro, como subiu da loja: a miniatura mostra só o meio dele. Passe as etapas pelas setas ou arrastando o quadro para o lado.</p>';
    return s + '</div>';
  }
  // `focoId`: o botão que pediu a etapa (o clique nem sempre leva o foco ao botão: no Safari, não leva)
  function mostrarFoto(i, focoId) {
    var l = lanchePorId(est.treino.aberto);
    if (!l || !l.etapas[i]) return;
    var camada = sobre.querySelector('.camada-foto'), abrindo = !camada;
    if (abrindo) {
      camada = document.createElement('div');
      camada.className = 'camada-foto';
      camada.innerHTML = '<div class="veu" data-fechar-foto></div><div class="dialogo foto-cheia" role="dialog" aria-modal="true" aria-labelledby="fe-t" aria-describedby="fe-d" tabindex="-1"></div><p class="so-leitor" aria-live="polite" id="fe-anuncio"></p>';
      sobre.appendChild(camada);
      // a gaveta fica atrás, parada: nem o clique nem o Tab chegam nela até o quadro fechar
      var folha = sobre.querySelector('.folha');
      if (folha) folha.inert = true;
    }
    var antes = focoId || (document.activeElement && camada.contains(document.activeElement) ? document.activeElement.id : '');
    est.treino.foto = i;
    var dlg = camada.querySelector('.foto-cheia');
    dlg.innerHTML = corpoDaFoto(l, i);
    if (abrindo) { dlg.focus(); return; }
    // passou de etapa: o foco fica no mesmo botão (ou no outro, se este acabou a fila) e o leitor de tela ouve a etapa nova
    var e = l.etapas[i], alvo = antes ? document.getElementById(antes) : null;
    if (alvo && alvo.disabled) alvo = document.getElementById(antes === 'fe-antes' ? 'fe-depois' : 'fe-antes');
    (alvo || dlg).focus();
    camada.querySelector('#fe-anuncio').textContent = 'Etapa ' + (i + 1) + ' de ' + l.etapas.length + ', às ' + e.hora + ', ' + e.lado + ': o Farol leu ' + (e.leu || 'nada') + ', ' + CERTEZA[e.certeza][1] + '.';
  }
  function passarFoto(passo) {
    if (est.treino.foto === null || !sobre.querySelector('.camada-foto')) return;
    mostrarFoto(est.treino.foto + passo);
  }
  function fecharFoto() {
    var camada = sobre.querySelector('.camada-foto'), i = est.treino.foto;
    if (!camada) return;
    camada.parentNode.removeChild(camada);
    est.treino.foto = null;
    var folha = sobre.querySelector('.folha');
    if (folha) folha.inert = false;
    // o foco volta para a miniatura da etapa que estava à vista (não a que abriu): é ao lado dela que se responde
    var alvo = document.getElementById('vf-' + i);
    if (alvo) { alvo.scrollIntoView({ block: 'nearest' }); try { alvo.focus({ preventScroll: true }); } catch (e) { alvo.focus(); } }
  }

  /* ─────────── navegação ─────────── */
  function ir(qual) {
    if (qual !== 'fichas' && qual !== 'conexoes' && qual !== 'treinamento') {
      avisar('Tela de exemplo: neste protótipo só Fichas, Treinamento e Conexões abrem.', true);
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
  function focar(seletor) { var x = document.querySelector(seletor); if (x) x.focus(); }
  function trocarAba(qual) { est.treino.aba = qual; pintar(); focar('#aba-' + qual); }
  // depois de salvar ou pular um lanche: o próximo da fila, ou de volta à tela
  function seguirNaFila(texto) {
    var fila = paraConferir();
    pintar();
    if (fila.length) {
      est.treino.aberto = fila[0].id;
      voltarPara = '#aba-lanches';
      abrir(folhaDoLanche(fila[0].id));
    } else {
      limparSobre();
      voltarPara = null;
      tela.focus();
    }
    avisar(fila.length ? texto : texto + ' Não há mais lanche para conferir.');
  }
  function voltarAoIngrediente(focoId) {
    abrir(folhaDoIngrediente(est.treino.ingrediente));
    if (focoId) focar('#' + focoId);
  }
  function aplicarSituacao(v) {
    if (SITUACOES.indexOf(v) < 0) return;
    est.situacao = v;
    // os acessos de outro sistema acompanham a situação escolhida
    if (v.indexOf('sistema') === 0) {
      est.acessos = [{ nome: SISTEMA, loja: 'centro', enviou: v !== 'sistema-novo', situacao: ESTADO_DO_ACESSO[v], por: QUEM_CRIOU }];
      // a rede que chegou ao teto: a Barra e mais oito lojas, todas com acesso valendo
      if (v === 'sistema-teto') ['barra'].concat(LOJAS_EXTRAS).forEach(function (l) { est.acessos.push({ nome: SISTEMA, loja: l, enviou: true, situacao: 'valendo', por: QUEM_CRIOU }); });
    } else if (v !== 'carregando' && v !== 'erro') est.acessos = est.acessos.filter(function (a) { return a.loja !== 'centro' && DO_REGEM.indexOf(v) < 0; });
    est.avisoVisto = false;
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
    // o quadro de uma etapa, maior (fecha só ele: a gaveta do lanche continua aberta atrás)
    if ((el = t.closest('[data-foto-etapa]'))) { mostrarFoto(Number(el.getAttribute('data-foto-etapa'))); return; }
    if (t.closest('[data-fechar-foto]')) { fecharFoto(); return; }
    if ((el = t.closest('[data-foto-ir]'))) { mostrarFoto(Number(el.getAttribute('data-foto-ir')), el.id); return; }
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
    if ((el = t.closest('[data-imp-gravar]'))) {
      var parcial = el.getAttribute('data-imp-gravar') === 'parcial';
      limparSobre();
      voltarPara = null;
      aplicarSituacao(parcial ? 'planilha-parcial' : 'planilha');
      avisar(parcial ? 'Fichas importadas: ' + (PRODUTOS.length - DE_FORA.length) + ' produtos entraram e ' + DE_FORA.length + ' ficaram de fora.' : 'Fichas importadas: 7 produtos, 3 com ficha.');
      tela.focus();
      return;
    }
    if (t.closest('[data-ver-de-fora]')) { abrir(folhaDeFora(), '#ver-de-fora'); return; }
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
      est.novo = { passo: 1, nome: '', loja: primeira, erro: '', termo: false, erroTermo: '', erroSenha: '' };
      abrir(folhaNovoAcesso(), '#novo-acesso');
      return;
    }
    if (t.closest('[data-criar-acesso]')) {
      var nome = (document.getElementById('novo-nome').value || '').trim();
      est.novo.nome = nome;
      est.novo.loja = document.getElementById('novo-loja').value;
      est.novo.termo = document.getElementById('novo-termo').checked;
      est.novo.erro = nome ? '' : 'Dê um nome ao sistema, para ele aparecer na tela Fichas.';
      est.novo.erroTermo = est.novo.termo ? '' : 'Para criar o acesso, aceite o termo.';
      est.novo.erroSenha = erroDaSenha(document.getElementById('novo-senha').value);
      if (est.novo.erro || est.novo.erroTermo || est.novo.erroSenha) {
        abrir(folhaNovoAcesso());
        // o foco vai para o primeiro campo com problema
        var primeiro = sobre.querySelector('[aria-invalid="true"]');
        if (primeiro) primeiro.focus();
        return;
      }
      est.novo.passo = 2;
      abrir(folhaNovoAcesso());
      return;
    }
    // renovar: a senha, depois o código novo, que aparece uma vez
    if ((el = t.closest('[data-renovar]'))) {
      est.renova = { i: Number(el.getAttribute('data-renovar')), passo: 1, erroSenha: '' };
      abrir(folhaRenovar(), '#' + el.id);
      var senha = document.getElementById('renova-senha');
      if (senha) senha.focus();
      return;
    }
    if (t.closest('[data-gerar-codigo]')) {
      est.renova.erroSenha = erroDaSenha(document.getElementById('renova-senha').value);
      if (est.renova.erroSenha) { abrir(folhaRenovar()); document.getElementById('renova-senha').focus(); return; }
      est.renova.passo = 2;
      abrir(folhaRenovar());
      return;
    }
    if (t.closest('[data-concluir-renovar]')) {
      var renovado = est.acessos[est.renova.i], venceu = renovado.situacao === 'vencido';
      renovado.situacao = venceu ? 'renovado-vencido' : 'renovado';
      limparSobre();
      voltarPara = null;
      // a loja deixa de estar "vencida" ou "vencendo": o controle do protótipo acompanha, sem refazer os acessos
      if (renovado.loja === 'centro') { est.situacao = venceu ? 'sistema' : 'sistema-renovado'; marcar('proto-situacao', est.situacao); }
      pintar();
      avisar(venceu ? 'Código novo gerado. O ' + renovado.nome + ' volta a enviar assim que receber o novo.' : 'Código novo gerado. O antigo vale até 22/10.');
      tela.focus();
      return;
    }
    // reativar o suspenso: um clique, o mesmo código
    if ((el = t.closest('[data-reativar]'))) {
      var reativado = est.acessos[Number(el.getAttribute('data-reativar'))];
      reativado.situacao = 'valendo';
      if (reativado.loja === 'centro') { est.situacao = 'sistema'; marcar('proto-situacao', est.situacao); }
      pintar();
      avisar('Acesso reativado: o ' + reativado.nome + ' volta a conseguir enviar agora, com o mesmo código. Se ficar mais 90 dias sem enviar, é suspenso de novo.');
      tela.focus();
      return;
    }
    if (t.closest('[data-entendi]')) { est.avisoVisto = true; pintar(); tela.focus(); return; }
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
      var criado = { nome: est.novo.nome, loja: est.novo.loja, enviou: false, situacao: 'novo', por: QUEM_CRIOU };
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
    // o treinamento
    if ((el = t.closest('[data-aba-treino]'))) { trocarAba(el.getAttribute('data-aba-treino')); return; }
    if ((el = t.closest('[data-filtro-lanches]'))) { est.treino.filtro = el.getAttribute('data-filtro-lanches'); pintar(); focar('[data-filtro-lanches="' + est.treino.filtro + '"]'); return; }
    if ((el = t.closest('[data-filtro-ing]'))) { est.treino.filtroIng = el.getAttribute('data-filtro-ing'); pintar(); focar('[data-filtro-ing="' + est.treino.filtroIng + '"]'); return; }
    if (t.closest('[data-ir-lanches]')) { est.treino.aba = 'lanches'; est.treino.filtro = 'conferir'; pintar(); focar('#aba-lanches'); return; }
    if ((el = t.closest('[data-lanche]'))) { est.treino.aberto = el.getAttribute('data-lanche'); abrir(folhaDoLanche(est.treino.aberto), '#' + el.id); return; }
    if ((el = t.closest('[data-etapa]'))) {
      var lE = lanchePorId(est.treino.aberto), rE = respDe(lE), iE = Number(el.getAttribute('data-etapa')), vE = el.getAttribute('data-v'), antes = rE.etapas[iE] || {};
      // tocar de novo no que já está marcado desmarca
      rE.etapas[iE] = antes.v === vE ? {} : { v: vE, nome: vE === 'outro' ? (antes.nome || '') : '', novo: antes.novo || '' };
      redesenhar(folhaDoLanche(lE.id), rE.etapas[iE].v === 'outro' ? 'et-' + iE + '-nome' : el.id);
      return;
    }
    if ((el = t.closest('[data-diferenca]'))) {
      var rD = respDe(lanchePorId(est.treino.aberto)), nD = el.getAttribute('data-diferenca'), vD = el.getAttribute('data-v');
      var onde = vD === 'adicional' || vD === 'amais' ? rD.fora : rD.ficha;
      onde[nD] = onde[nD] === vD ? '' : vD;
      redesenhar(folhaDoLanche(est.treino.aberto), el.id);
      return;
    }
    if (t.closest('[data-etapas-certas]')) {
      var lC = lanchePorId(est.treino.aberto), rC = respDe(lC);
      lC.etapas.forEach(function (e, i) { if (e.leu && !(rC.etapas[i] && rC.etapas[i].v)) rC.etapas[i] = { v: 'certo' }; });
      redesenhar(folhaDoLanche(lC.id), 'salvar-lanche');
      return;
    }
    if (t.closest('[data-pular-lanche]')) {
      if (est.treino.pulados.indexOf(est.treino.aberto) < 0) est.treino.pulados.push(est.treino.aberto);
      seguirNaFila('Pulado: o lanche espera em “Pulados”.');
      return;
    }
    if (t.closest('[data-tudo-certo]')) {
      var lT = lanchePorId(est.treino.aberto), rT = respDe(lT);
      rT.produto = palpites(lT)[0].nome;
      lT.etapas.forEach(function (e, i) { if (e.leu) rT.etapas[i] = { v: 'certo' }; });
      seguirNaFila('Guardado: ' + plural(salvarLanche(lT), 'exemplo novo', 'exemplos novos') + ' para a ' + BANCADA + '.');
      return;
    }
    if (t.closest('[data-salvar-lanche]')) {
      var lS = lanchePorId(est.treino.aberto), rS = respDe(lS);
      if (rS.produto === '__outro' && !rS.outroProduto) { avisar('Escolha qual produto era.', true); focar('#ql-qual'); return; }
      var nS = salvarLanche(lS);
      seguirNaFila(nS ? 'Guardado: ' + plural(nS, 'exemplo novo', 'exemplos novos') + ' para a ' + BANCADA + '. O Farol relê os lanches que faltam com o que aprendeu.' : 'Guardado. Sem etapa confirmada, o lanche conta só para o acerto.');
      return;
    }
    // as fotos de um ingrediente
    if ((el = t.closest('[data-ingrediente]'))) {
      var deP = el.getAttribute('data-de-produto');
      est.treino.ingrediente = el.getAttribute('data-ingrediente');
      est.treino.deProduto = deP || null;
      est.treino.erroFoto = '';
      abrir(folhaDoIngrediente(est.treino.ingrediente), deP ? undefined : '#' + el.id);
      return;
    }
    if ((el = t.closest('[data-voltar-produto]'))) {
      var deI = est.treino.ingrediente;
      est.treino.ingrediente = null;
      est.treino.deProduto = null;
      abrir(folhaDoProduto(el.getAttribute('data-voltar-produto')));
      focar('#fc-' + slug(deI));
      return;
    }
    if ((el = t.closest('[data-tirar-foto]'))) { est.treino.tirar = el.getAttribute('data-tirar-foto'); abrir(dialogoTirarFoto(est.treino.ingrediente, est.treino.tirar)); return; }
    if (t.closest('[data-manter-foto]')) { voltarAoIngrediente(est.treino.tirar ? 'tirar-' + est.treino.tirar : 'ing-titulo'); return; }
    if ((el = t.closest('[data-confirmar-tirar]'))) {
      var idF = el.getAttribute('data-confirmar-tirar'), nomeF = est.treino.ingrediente;
      FOTOS[nomeF] = (FOTOS[nomeF] || []).filter(function (f) { return f.id !== idF; });
      est.treino.tirar = null;
      voltarAoIngrediente(null);
      if (est.tela === 'treinamento') pintar();
      avisar('Foto tirada do ' + nomeF + '.');
      return;
    }
    if ((el = t.closest('[data-simular-foto]'))) {
      var nomeSim = est.treino.ingrediente, simulado = el.getAttribute('data-simular-foto');
      if (simulado === 'nao-foto') est.treino.erroFoto = '“cardapio.pdf” não é uma foto. Envie um arquivo de imagem, como JPG ou PNG.';
      else {
        var cheia = FOTOS[nomeSim] = FOTOS[nomeSim] || [];
        while (cheia.length < LIMITE_FOTOS) cheia.push({ id: 'x' + cheia.length, jeito: 'de exemplo', quando: 'agora', camadas: ['pao', FORMA[nomeSim] || 'molho'] });
        est.treino.erroFoto = '';
      }
      redesenhar(folhaDoIngrediente(nomeSim), el.id);
      return;
    }
    if ((el = t.closest('[data-nao-se-ve]'))) {
      var nomeN = el.getAttribute('data-nao-se-ve');
      if (NAO_SE_VE[nomeN]) delete NAO_SE_VE[nomeN]; else NAO_SE_VE[nomeN] = true;
      redesenhar(folhaDoIngrediente(nomeN), 'nao-se-ve');
      if (est.tela === 'treinamento') pintar();
      avisar(NAO_SE_VE[nomeN] ? 'O Farol para de esperar ver ' + nomeN + ' na bancada.' : 'O Farol volta a esperar ver ' + nomeN + ' na bancada.');
      return;
    }
    if ((el = t.closest('[data-ligar-orfa]'))) {
      var deO = el.getAttribute('data-ligar-orfa'), paraO = document.getElementById('orfa-destino').value;
      if (!paraO) { avisar('Escolha de qual ingrediente são as fotos.', true); focar('#orfa-destino'); return; }
      var juntas = (FOTOS[paraO] || []).concat(ORFAS[deO]);
      FOTOS[paraO] = juntas.slice(0, LIMITE_FOTOS);
      delete ORFAS[deO];
      est.treino.ingrediente = paraO;
      abrir(folhaDoIngrediente(paraO));
      if (est.tela === 'treinamento') pintar();
      avisar('As fotos de “' + deO + '” agora são do ' + paraO + '.' + (juntas.length > LIMITE_FOTOS ? ' Ficaram as ' + LIMITE_FOTOS + ' primeiras: é o limite.' : ''));
      return;
    }
    if ((el = t.closest('[data-apagar-orfa]'))) { abrir(dialogoApagarOrfa(el.getAttribute('data-apagar-orfa'))); return; }
    if ((el = t.closest('[data-confirmar-apagar-orfa]'))) {
      var deA = el.getAttribute('data-confirmar-apagar-orfa');
      delete ORFAS[deA];
      limparSobre();
      voltarPara = null;
      pintar();
      tela.focus();
      avisar('As fotos de “' + deA + '” foram apagadas.');
      return;
    }
    // as sugestões para as fichas
    if ((el = t.closest('[data-sugestao]'))) {
      est.treino.decisoes[el.getAttribute('data-sugestao')] = el.getAttribute('data-v');
      pintar();
      focar('#aba-sugestoes');
      avisar(el.getAttribute('data-v') === 'sim' ? 'Anotado. Quando a ficha chegar com a mudança, o Farol leva junto as fotos e os exemplos.' : 'Anotado: fica como está. O Farol só volta ao assunto se lanches novos mostrarem outra coisa.');
      return;
    }
    // as gravações de treino
    if ((el = t.closest('[data-nova-gravacao]'))) { est.treino.nova = novaGravacao(); abrir(folhaNovaGravacao(), '#' + el.id); return; }
    if (t.closest('[data-criar-gravacao]')) {
      var n = est.treino.nova;
      n.dia = document.getElementById('ng-dia').value;
      n.das = document.getElementById('ng-das').value;
      n.as = document.getElementById('ng-as').value;
      n.erro = conferirNovaGravacao(n);
      if (n.erro) { redesenhar(folhaNovaGravacao(), 'ng-dia'); return; }
      GRAVACOES.unshift({ id: 'g' + Date.now(), quando: quandoDaGravacao(n.dia, n.das, n.as), como: n.de === 'gravador' ? 'do gravador' : 'programada', situacao: n.de === 'gravador' ? 'fila' : 'programada', criada: true });
      var doGravador = n.de === 'gravador';
      limparSobre();
      voltarPara = null;
      est.treino.aba = 'gravacoes';
      pintar();
      focar('#aba-gravacoes');
      avisar(doGravador ? 'Gravação criada: o computador da loja busca o trecho no gravador e lê quando chegar a vez dela.' : 'Gravação programada: o Farol grava no horário e lê depois.');
      return;
    }
    if ((el = t.closest('[data-cancelar-gravacao]'))) {
      var gC = gravacaoPorId(el.getAttribute('data-cancelar-gravacao'));
      gC.cancelada = true;
      pintar();
      focar('#aba-gravacoes');
      avisar('Gravação de ' + gC.quando + ' cancelada.');
      return;
    }
    if ((el = t.closest('[data-apagar-gravacao]'))) { abrir(dialogoApagarGravacao(el.getAttribute('data-apagar-gravacao')), '#' + el.id); return; }
    if ((el = t.closest('[data-confirmar-apagar-gravacao]'))) {
      var gA = gravacaoPorId(el.getAttribute('data-confirmar-apagar-gravacao'));
      gA.situacao = 'apagada';
      limparSobre();
      voltarPara = null;
      pintar();
      focar('#aba-gravacoes');
      avisar('Imagens da gravação de ' + gA.quando + ' apagadas. O que o Farol aprendeu ficou.');
      return;
    }
    if ((el = t.closest('#proto-treino button'))) {
      est.treino.situacao = el.getAttribute('data-v');
      est.treino.filtro = 'conferir';
      marcar('proto-treino', est.treino.situacao);
      limparSobre();
      pintar();
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
    // o nome de um ingrediente que não está nas fichas: guarda enquanto digita (vira sugestão ao salvar)
    if (t.hasAttribute('data-etapa-novo')) {
      var rN = respDe(lanchePorId(est.treino.aberto)).etapas[Number(t.getAttribute('data-etapa-novo'))];
      if (rN) rN.novo = t.value;
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
    // o treinamento: qual lanche era, o produto da lista, o ingrediente de uma etapa, de onde vem a gravação
    if (t.hasAttribute('data-qual-lanche')) { respDe(lanchePorId(est.treino.aberto)).produto = t.value; redesenhar(folhaDoLanche(est.treino.aberto), t.id); return; }
    if (t.hasAttribute('data-outro-produto')) { respDe(lanchePorId(est.treino.aberto)).outroProduto = t.value; redesenhar(folhaDoLanche(est.treino.aberto), 'ql-qual'); return; }
    if (t.hasAttribute('data-etapa-nome')) {
      var iN = Number(t.getAttribute('data-etapa-nome')), rEt = respDe(lanchePorId(est.treino.aberto)).etapas[iN];
      if (rEt) rEt.nome = t.value;
      redesenhar(folhaDoLanche(est.treino.aberto), t.value === '__novo' ? 'et-' + iN + '-novo' : t.id);
      return;
    }
    if (t.hasAttribute('data-ng-de') && est.treino.nova) {
      var nv = est.treino.nova;
      nv.de = t.value;
      nv.dia = document.getElementById('ng-dia').value;
      nv.das = document.getElementById('ng-das').value;
      nv.as = document.getElementById('ng-as').value;
      nv.erro = '';
      redesenhar(folhaNovaGravacao(), t.id);
      return;
    }
    // a foto de um ingrediente: o protótipo mostra a imagem escolhida só neste navegador — nada é enviado
    if (t.id === 'foto-arquivo' && t.files && t.files.length) {
      var arq = t.files[0], de = t.getAttribute('data-foto-de');
      if (!/^image\//.test(arq.type || '')) {
        est.treino.erroFoto = '“' + arq.name + '” não é uma foto. Envie um arquivo de imagem, como JPG ou PNG.';
        redesenhar(folhaDoIngrediente(de), 'foto-arquivo');
        return;
      }
      if ((FOTOS[de] || []).length >= LIMITE_FOTOS) return;
      est.treino.erroFoto = '';
      est.treino.enviando = de;
      redesenhar(folhaDoIngrediente(de));
      var url = '';
      try { url = URL.createObjectURL(arq); } catch (e) { url = ''; }
      window.setTimeout(function () {
        est.treino.enviando = null;
        (FOTOS[de] = FOTOS[de] || []).push({ id: 'n' + Date.now(), jeito: 'enviada agora', quando: 'agora', camadas: ['pao', FORMA[de] || 'molho'], url: url });
        if (est.treino.ingrediente === de && sobre.querySelector('#ing-titulo')) redesenhar(folhaDoIngrediente(de), FOTOS[de].length < LIMITE_FOTOS ? 'foto-arquivo' : null);
        if (est.tela === 'treinamento') pintar();
        avisar('Foto enviada. Ela vai para o computador da loja na próxima atualização dele.');
      }, 1200);
      return;
    }
    if (t.id === 'novo-loja' && est.novo) {
      est.novo.loja = t.value;
      est.novo.nome = document.getElementById('novo-nome').value;
      est.novo.termo = document.getElementById('novo-termo').checked;
      abrir(folhaNovoAcesso());
      var sel = document.getElementById('novo-loja');
      if (sel) sel.focus();
    }
  });
  document.addEventListener('keydown', function (ev) {
    // com o quadro aberto, Esc fecha só ele, e as setas passam as etapas
    if (sobre.querySelector('.camada-foto')) {
      if (ev.key === 'Escape') { ev.preventDefault(); fecharFoto(); return; }
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') { ev.preventDefault(); passarFoto(ev.key === 'ArrowRight' ? 1 : -1); return; }
    }
    if (ev.key === 'Escape' && sobre.innerHTML) { ev.preventDefault(); fechar(); return; }
    // as abas do treinamento: setas, Home e End trocam de aba (o padrão de abas do leitor de tela)
    var aba = ev.target instanceof Element ? ev.target.closest('[role="tab"][data-aba-treino]') : null;
    if (aba && ['ArrowRight', 'ArrowLeft', 'Home', 'End'].indexOf(ev.key) >= 0) {
      ev.preventDefault();
      var ids = ABAS_TREINO.map(function (a) { return a[0]; }), k = ids.indexOf(aba.getAttribute('data-aba-treino'));
      k = ev.key === 'Home' ? 0 : ev.key === 'End' ? ids.length - 1 : (k + (ev.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
      trocarAba(ids[k]);
    }
  });

  // arrastar o quadro para o lado passa as etapas (o dedo no celular, ou o mouse)
  var arrasto = null;
  document.addEventListener('pointerdown', function (ev) {
    arrasto = ev.target instanceof Element && ev.target.closest('.foto-cheia .quadro') ? { x: ev.clientX, y: ev.clientY } : null;
  });
  document.addEventListener('pointercancel', function () { arrasto = null; });
  document.addEventListener('pointerup', function (ev) {
    if (!arrasto) return;
    var dx = ev.clientX - arrasto.x, dy = ev.clientY - arrasto.y;
    arrasto = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) passarFoto(dx < 0 ? 1 : -1);
  });

  function lerEndereco() {
    var h = (window.location.hash || '').slice(1);
    est.tela = h === 'conexoes' || h === 'treinamento' ? h : 'fichas';
    pintar();
  }
  window.addEventListener('hashchange', lerEndereco);
  pintarTema();
  lerEndereco();
})();
