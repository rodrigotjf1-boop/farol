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
  function num(n) { return Number(n).toLocaleString('pt-BR'); }
  function reais(v) { return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function semAcento(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

  /* ─────────── o vocabulário ─────────── */
  var PAPEIS = {
    posto: ['posto de trabalho', 'Onde alguém trabalha. Serve para presença, permanência e para saber se havia alguém no posto.'],
    cuba: ['cuba de ingrediente', 'Uma cuba, ou uma fileira delas. A leitura da bancada usa para saber de onde a mão pegou.'],
    montagem: ['posição de montagem', 'Onde o lanche é montado. O Farol olha cada posição quando as mãos saem dela.'],
    equipamento: ['equipamento', 'Chapa, fritadeira, forno. Liga ao inventário e à foto padrão.'],
    impressora: ['impressora e comanda', 'Onde a comanda sai. Marca o instante em que o pedido chega à bancada.'],
    caixa: ['caixa e gaveta', 'Gaveta de dinheiro, maquininha, balcão do cliente.'],
    pia: ['pia', 'Lavagem das mãos e dos utensílios: quanto tempo alguém ficou.'],
    piso: ['piso', 'O chão: limpeza, objeto caído, passagem livre.'],
    livre: ['sem papel definido', 'Um recorte como os de hoje: só delimita onde o critério vale.']
  };
  var ORDEM_DOS_PAPEIS = ['posto', 'cuba', 'montagem', 'equipamento', 'impressora', 'caixa', 'pia', 'piso', 'livre'];
  var FAMILIAS = {
    estado: ['Estado', 'Como está?', 'Um quadro, o melhor.', ''],
    acontecimento: ['Acontecimento', 'Aconteceu? Alguém fez?', 'Uma sequência de 6 quadros.', ''],
    processo: ['Processo', 'Foi feito como manda?', 'Etapas ao longo do tempo.', 'chega depois da sequência'],
    medida: ['Medida', 'Quanto? Por quanto tempo?', 'Conta ou cronometra. Devolve número.', 'chega depois da sequência']
  };
  // A meta para um critério valer: no máximo 1 alarme falso em 10 avisos, medido em 40 exemplos marcados, 10 deles "fora".
  var META = { exemplos: 40, fora: 10, emCada: 10 };
  var ESTADOS = [
    ['observando', 'Observando', 'Só colhe números do que acontece. Não julga e não gasta.', 'Sai daqui quando há dados de alguns dias de operação.'],
    ['ensaio', 'Em ensaio', 'Julga e mostra. Não avisa ninguém. Cada julgamento vira um exemplo para marcar.', 'Sai daqui sozinho, quando há ' + META.exemplos + ' exemplos marcados, ' + META.fora + ' deles “fora”.'],
    ['medido', 'Medido', 'O acerto, o alarme falso e o “não deu para ver” ficam à vista no critério.', 'Sai daqui quando você manda valer. Só dá para mandar com a meta batida: no máximo 1 alarme falso em ' + META.emCada + ' avisos.'],
    ['valendo', 'Valendo', 'Avisa.', 'Volta a “em ensaio” se o texto, o quadro ou o modelo mudar.']
  ];
  var VEREDITO = { dentro: ['dentro do critério', 'ok'], fora: ['fora do critério', 'fora'], naodeu: ['não deu para ver', ''] };
  var NOME_DO_ESTADO = { observando: 'observando', ensaio: 'em ensaio', medido: 'medido', valendo: 'valendo' };
  var CHIP_DO_ESTADO = { observando: '', ensaio: 'facho', medido: 'dado', valendo: 'ok' };
  var PARTES = [
    ['contexto', 'Contexto', 'O que precisa estar acontecendo?'],
    ['gatilho', 'Gatilho', 'O que abre a análise?'],
    ['janela', 'Janela', 'Até quando observar?'],
    ['acao', 'Ação', 'O que se procura na janela?'],
    ['desfecho', 'Desfecho', 'Como termina?'],
    ['fora', 'Fora de contexto', 'E quando o contexto não vale?']
  ];

  /* ─────────── os dados de exemplo ─────────── */
  // cada parte do estudo: [texto, 'naove' quando a câmera não vê aquilo, o sinal que a loja usa para conferir]
  // `pedeCena`: o critério depende de entender a imagem — sem a cena descrita, não é analisado.
  // `soLoja`: conferido só por sinal da loja (o detector de pessoas); nunca custa nuvem.
  var CANAIS = {
    montagem: {
      id: 'montagem', nome: 'Montagem 1', setor: 'Cozinha', canal: 4, olhada: 30,
      cena: { texto: 'Bancada de montagem de lanches, vista de cima por uma câmera no teto. No alto ficam as cubas de ingredientes; no meio, a área onde os lanches são montados, sobre folhas de papel alumínio ou dentro de caixas brancas; à direita, a impressora de comandas e, abaixo dela, a área de embalagem. Quem monta fica de pé na parte de baixo da imagem. O inox e o papel alumínio brilham: brilho não é alimento.', estado: 'descrita', por: 'você', em: '09/10' },
      quadros: [
        { id: 'q1', nome: 'Cubas', papel: 'cuba', r: [6, 7, 76, 29] },
        { id: 'q2', nome: 'Montagem', papel: 'montagem', r: [6, 34, 70, 80] },
        { id: 'q3', nome: 'Impressora', papel: 'impressora', r: [80, 9, 96, 36] },
        { id: 'q4', nome: 'Embalagem', papel: 'livre', r: [62, 44, 96, 82] }
      ],
      criterios: [
        { id: 'c1', nome: 'Presença na montagem', onde: 'inteira', familia: 'estado', estado: 'valendo', soLoja: true, antigo: true,
          texto: 'Há pelo menos uma pessoa na montagem enquanto a loja está aberta.',
          ficha: {
            contexto: ['A loja está aberta.', '', 'o horário da loja'],
            gatilho: ['Toda olhada, a cada 30 s.', '', 'o relógio'],
            janela: ['A própria olhada.', '', ''],
            acao: ['Contar as pessoas na imagem completa.', '', 'o detector de pessoas'],
            desfecho: ['Uma pessoa ou mais: dentro. Ninguém: fora. Imagem ruim: não deu para ver.', '', ''],
            fora: ['Com a loja fechada não se confere.', '', '']
          },
          funil: { olhadas: 2880, contexto: 1440, gatilho: 1440, julgadas: 1440, nuvem: 0, fora: 212 }, confirmada: true },
        { id: 'c2', nome: 'Uniforme e touca', onde: 'inteira', familia: 'estado', estado: 'ensaio', pedeCena: true,
          texto: 'Quem está na bancada usa uniforme e touca.',
          ficha: {
            contexto: ['Há pessoa na imagem.', '', 'o detector de pessoas'],
            gatilho: ['Uma pessoa entrou, ou passaram 10 min com a mesma pessoa.', '', 'o detector de pessoas e o relógio'],
            janela: ['O quadro mais nítido dos 5 s seguintes.', '', ''],
            acao: ['Conferir uniforme e touca em quem aparece na imagem completa.', '', ''],
            desfecho: ['Com uniforme e touca: dentro. Sem um dos dois: fora. De costas ou tapado: não deu para ver.', '', ''],
            fora: ['Sem ninguém na imagem não se julga, não se paga e não conta como análise.', '', '']
          },
          funil: { olhadas: 2880, contexto: 1310, gatilho: 96, julgadas: 96, nuvem: 96, fora: 4 }, confirmada: true },
        { id: 'c3', nome: 'Cuba abastecida', onde: 'q1', familia: 'estado', estado: 'observando',
          texto: 'Nenhuma cuba da fileira fica vazia durante o serviço.',
          ficha: {
            contexto: ['A loja está aberta e ninguém está na frente das cubas.', '', 'presença no Quadro 1'],
            gatilho: ['A cada 10 min, ou quando a mão sai de uma cuba.', '', 'movimento no Quadro 1'],
            janela: ['O primeiro quadro parado.', '', ''],
            acao: ['Comparar cada cuba com a foto padrão da cuba cheia.', '', 'a foto padrão'],
            desfecho: ['Parecida com a cheia: dentro. Fundo à vista: fora. Mão na frente: não deu para ver.', '', ''],
            fora: ['Com alguém na frente das cubas não se confere.', '', '']
          },
          funil: { olhadas: 2880, contexto: 1020, gatilho: 132, julgadas: 0, nuvem: 0, fora: 0 }, confirmada: false },
        { id: 'c4', nome: 'Bancada limpa entre pedidos', onde: 'q2', familia: 'estado', estado: 'ensaio',
          texto: 'Entre um lote e outro, a área de montagem fica sem restos de alimento, embalagem ou utensílio sujo.',
          ficha: {
            contexto: ['A área de montagem está livre: ninguém na frente e nenhuma posição aberta.', '', 'presença e mudança no Quadro 2'],
            gatilho: ['A bancada acabou de ficar livre.', '', 'o Quadro 2 parou'],
            janela: ['O primeiro quadro parado depois disso.', '', ''],
            acao: ['Comparar com a foto padrão da bancada limpa.', '', 'a foto padrão'],
            desfecho: ['Igual ao padrão: dentro. Restos, embalagem ou utensílio sujo: fora. Alguém entrou na frente: não deu para ver.', '', ''],
            fora: ['Com gente montando não se julga, não se paga e não conta como análise.', '', '']
          },
          funil: { olhadas: 2880, contexto: 610, gatilho: 88, julgadas: 88, nuvem: 8, fora: 6 }, confirmada: true },
        { id: 'c5', nome: 'Montagem conforme a ficha', onde: 'q2', familia: 'processo', estado: 'observando', pedeCena: true, depois: 'chega com a leitura da bancada',
          texto: 'Cada lanche leva todos os ingredientes da ficha. A ordem não importa.',
          ficha: {
            contexto: ['Há uma posição aberta na bancada: uma folha ou uma caixa.', '', 'mudança no Quadro 2'],
            gatilho: ['Algo foi posto numa posição e as mãos saíram.', '', 'a posição parou'],
            janela: ['Da abertura da posição até o lanche fechar.', '', ''],
            acao: ['Ler o que entrou em cada posição e comparar com a ficha do pedido.', '', 'a leitura da bancada e a ficha do produto'],
            desfecho: ['Todos os itens: dentro. Falta ou sobra: fora, dizendo o item. Coberto antes de ser visto: não deu para ver.', '', ''],
            fora: ['Sem posição aberta não se julga.', '', '']
          },
          funil: { olhadas: 2880, contexto: 940, gatilho: 410, julgadas: 0, nuvem: 0, fora: 0 }, confirmada: false },
        { id: 'c6', nome: 'Pedido completo na sacola', onde: 'q4', familia: 'processo', estado: 'observando', pedeCena: true, depois: 'chega depois da sequência',
          texto: 'Tudo o que o pedido tem entra na sacola antes de ela sair.',
          ficha: {
            contexto: ['Há uma sacola ou caixa aberta na embalagem.', '', 'mudança no Quadro 4'],
            gatilho: ['Um item foi posto na sacola.', '', 'a posição parou'],
            janela: ['Até a sacola sair do quadro.', '', ''],
            acao: ['Contar os itens postos e comparar com o pedido.', '', 'precisa do pedido: vem do Regem'],
            desfecho: ['Bate com o pedido: dentro. Falta item: fora, dizendo qual. Sacola fechada antes de ser vista: não deu para ver.', '', ''],
            fora: ['Sem sacola aberta não se julga.', '', '']
          },
          funil: { olhadas: 2880, contexto: 380, gatilho: 150, julgadas: 0, nuvem: 0, fora: 0 }, confirmada: false },
        { id: 'c7', nome: 'O molho vai na tampa antes da alface', onde: 'q2', familia: 'acontecimento', estado: 'ensaio', pedeCena: true,
          texto: 'Em todo lanche, o molho é posto primeiro, na tampa do pão, antes da alface.',
          ficha: {
            contexto: ['Há uma posição aberta na bancada, com a tampa do pão à vista.', '', 'mudança no Quadro 2'],
            gatilho: ['A tampa acabou de ser coberta.', '', 'a posição parou, depois de mudar'],
            janela: ['Dos 20 s antes de a tampa ser coberta até ela: 6 quadros.', '', 'a gravação do canal'],
            acao: ['O molho posto na tampa antes de qualquer outro ingrediente.', '', ''],
            desfecho: ['Molho antes da alface: dentro. Alface sobre a tampa nua: fora. A mão cobriu a tampa: não deu para ver.', '', ''],
            fora: ['Sem posição aberta não se julga, não se paga e não conta como análise.', '', '']
          },
          funil: { olhadas: 2880, contexto: 940, gatilho: 164, julgadas: 164, nuvem: 164, fora: 9 }, confirmada: true }
      ]
    },
    chapa: {
      id: 'chapa', nome: 'Chapa', setor: 'Cozinha', canal: 6, olhada: 30,
      cena: { texto: 'Chapa de hambúrguer vista de lado, da altura do teto. O chapeiro fica de frente para a chapa; o saleiro tem lugar marcado na bancada ao lado.', estado: 'descrita', por: 'você', em: '09/10' },
      quadros: [
        { id: 'q1', nome: 'Chapa', papel: 'equipamento', r: [6, 10, 62, 66] },
        { id: 'q2', nome: 'Posto do chapeiro', papel: 'posto', r: [6, 68, 62, 94] },
        { id: 'q3', nome: 'Lugar do saleiro', papel: 'livre', r: [70, 14, 84, 34] }
      ],
      criterios: [
        { id: 'k1', nome: 'O chapeiro salga as carnes', onde: 'q1', familia: 'acontecimento', estado: 'observando', pedeCena: true,
          texto: 'Toda carne posta na chapa é salgada antes de ser virada.',
          ficha: {
            contexto: ['Há carne na chapa e há colaborador no posto.', '', 'a chapa difere da chapa vazia; presença no Quadro 2'],
            gatilho: ['Uma carne acabou de ser posta.', '', 'algo foi posto no Quadro 1'],
            janela: ['Até a carne ser virada ou tirada.', '', ''],
            acao: ['O gesto de salgar sobre a carne.', 'naove', 'o sal não aparece na imagem'],
            desfecho: ['Salgou: dentro. A janela fechou sem salgar: fora. A mão tapou: não deu para ver.', '', ''],
            fora: ['Sem carne na chapa, ou sem ninguém no posto, não se julga, não se paga e não conta como análise.', '', '']
          },
          sugestao: 'A câmera não vê o sal. Dê à ação um rastro que ela veja: o lugar marcado do saleiro (Quadro 3). O saleiro saiu do lugar e voltou dentro da janela = salgou.',
          funil: { olhadas: 2880, contexto: 1050, gatilho: 310, julgadas: 0, nuvem: 0, fora: 0 }, confirmada: false },
        { id: 'k2', nome: 'Chapa limpa no fim do turno', onde: 'q1', familia: 'estado', estado: 'ensaio',
          texto: 'No fechamento, a chapa fica raspada e sem restos.',
          ficha: {
            contexto: ['A loja acabou de fechar e não há carne na chapa.', '', 'o horário da loja; a chapa parecida com a vazia'],
            gatilho: ['Dez minutos depois da última carne.', '', 'o relógio'],
            janela: ['O primeiro quadro sem ninguém na frente.', '', 'presença no Quadro 2'],
            acao: ['Comparar com a foto padrão da chapa limpa.', '', 'a foto padrão'],
            desfecho: ['Igual ao padrão: dentro. Crosta ou restos: fora. Alguém na frente: não deu para ver.', '', ''],
            fora: ['Durante o serviço não se confere.', '', '']
          },
          funil: { olhadas: 2880, contexto: 40, gatilho: 2, julgadas: 2, nuvem: 0, fora: 0 }, confirmada: true }
      ]
    }
  };
  var OUTROS_CANAIS = [
    { nome: 'Balcão', canal: 1, setor: 'Atendimento', quadros: 1, criterios: 1, cena: 'vazia' },
    { nome: 'Estoque seco', canal: 8, setor: 'Estoque', quadros: 0, criterios: 0, cena: 'vazia' }
  ];
  /* ─────────── onda 2: os exemplos de cada critério (dados de exemplo) ─────────── */
  // cada desenho: [o que o juiz disse, o motivo que ele deu]
  var CENAS_DO_EXEMPLO = {
    limpa: ['dentro', 'A área de montagem está livre e sem restos.'],
    migalha: ['dentro', 'A área de montagem está livre e sem restos.'],
    restos: ['fora', 'Restos de alface e de pão no meio da área de montagem.'],
    papel: ['fora', 'Uma folha de papel usada ficou sobre a bancada.'],
    molho: ['fora', 'Mancha de molho e uma espátula suja sobre a bancada.'],
    brilho: ['fora', 'Mancha clara no lado direito da bancada.'],
    tapada: ['naodeu', 'Alguém entrou na frente da bancada.'],
    com: ['dentro', 'Uma pessoa na montagem.'],
    sem: ['fora', 'Ninguém na montagem.'],
    touca: ['dentro', 'Uma pessoa na bancada, de uniforme e touca.'],
    semtouca: ['fora', 'Uma pessoa na bancada, sem touca.'],
    costas: ['naodeu', 'A pessoa está debaixo da coifa: não dá para ver a cabeça.'],
    chapalimpa: ['dentro', 'A chapa está raspada e sem restos.'],
    crosta: ['fora', 'Crosta escura no lado esquerdo da chapa.']
  };
  function doisDigitos(n) { return (n < 10 ? '0' : '') + n; }
  function horaDoExemplo(i, passo) {
    var min = 21 * 60 + 40 - i * passo, dia = 10;
    while (min < 0) { min += 24 * 60; dia--; }
    return doisDigitos(dia) + '/10 · ' + doisDigitos(Math.floor(min / 60)) + ':' + doisDigitos(min % 60);
  }
  // lista de [desenho, confiança, marca ('a' acertou, 'e' errou, '' por marcar), o que era, quando errou]
  function montarExemplos(lista, passo) {
    return lista.map(function (x, i) {
      var cena = CENAS_DO_EXEMPLO[x[0]];
      return { id: 'e' + (i + 1), hora: horaDoExemplo(i, passo), desenho: x[0], juiz: cena[0], motivo: cena[1], conf: x[1], marca: x[2] === 'a' ? 'acertou' : x[2] === 'e' ? 'errou' : null, era: x[3] || null };
    });
  }
  // Bancada limpa entre pedidos: 6 por marcar (os mais novos) e 36 marcados — 9 deles "fora", um dos quais era o brilho do inox.
  var LETRA = { L: ['limpa', 0.94, 'a'], R: ['restos', 0.87, 'a'], P: ['papel', 0.9, 'a'], M: ['molho', 0.88, 'a'], T: ['tapada', 0.55, 'a'], B: ['brilho', 0.72, 'e', 'dentro'], m: ['migalha', 0.81, 'e', 'fora'] };
  var listaDaBancada = [['limpa', 0.93, ''], ['restos', 0.88, ''], ['limpa', 0.95, ''], ['brilho', 0.74, ''], ['tapada', 0.6, ''], ['limpa', 0.91, '']]
    .concat('L L R L L P L L M L T L L R L L B L L L R L m L P L L M L L T L R L L L'.split(' ').map(function (l) { return LETRA[l]; }));
  criterioDeCanal('montagem', 'c4').exemplos = montarExemplos(listaDaBancada, 13);
  criterioDeCanal('montagem', 'c4').versao = 3;
  criterioDeCanal('montagem', 'c1').exemplos = montarExemplos([['com', 0.97, ''], ['com', 0.95, ''], ['sem', 0.91, ''], ['com', 0.96, ''], ['sem', 0.89, ''], ['com', 0.97, '']], 30);
  criterioDeCanal('montagem', 'c1').versao = 1;
  criterioDeCanal('montagem', 'c2').exemplos = montarExemplos([['touca', 0.9, ''], ['semtouca', 0.82, ''], ['costas', 0.52, ''], ['touca', 0.91, ''], ['touca', 0.93, 'a'], ['semtouca', 0.8, 'a']], 41);
  criterioDeCanal('montagem', 'c2').versao = 2;
  criterioDeCanal('chapa', 'k2').exemplos = montarExemplos([['chapalimpa', 0.92, ''], ['crosta', 0.85, '']], 1440);
  criterioDeCanal('chapa', 'k2').versao = 1;
  // O molho na tampa: a sequência de 6 quadros. Cada exemplo: [os seis desenhos, o que o juiz disse, o quadro que ele apontou, confiança, o motivo, a marca]
  var SEQUENCIAS = [
    [['nua', 'bisnaga', 'molho', 'alface', 'carne', 'fechado'], 'dentro', 3, 0.9, 'O molho foi posto na tampa no quadro 3, antes da alface, no quadro 4.', ''],
    [['nua', 'nua', 'alface', 'carne', 'queijo', 'fechado'], 'fora', 3, 0.84, 'A alface foi posta direto sobre a tampa nua, no quadro 3. Não há molho antes.', ''],
    [['nua', 'mao', 'mao', 'alface', 'carne', 'fechado'], 'naodeu', 0, 0.5, 'A mão cobriu a tampa nos quadros 2 e 3.', ''],
    [['nua', 'bisnaga', 'molhoclaro', 'alface', 'carne', 'fechado'], 'fora', 4, 0.66, 'Não vi molho na tampa antes da alface, no quadro 4.', ''],
    [['nua', 'bisnaga', 'molho', 'alface', 'carne', 'fechado'], 'dentro', 3, 0.92, 'O molho foi posto na tampa no quadro 3, antes da alface, no quadro 4.', 'a'],
    [['nua', 'nua', 'bisnaga', 'molho', 'alface', 'fechado'], 'dentro', 4, 0.88, 'O molho foi posto na tampa no quadro 4, antes da alface, no quadro 5.', 'a'],
    [['nua', 'nua', 'alface', 'carne', 'queijo', 'fechado'], 'fora', 3, 0.86, 'A alface foi posta direto sobre a tampa nua, no quadro 3. Não há molho antes.', 'a'],
    [['nua', 'bisnaga', 'molho', 'alface', 'carne', 'fechado'], 'dentro', 3, 0.91, 'O molho foi posto na tampa no quadro 3, antes da alface, no quadro 4.', 'a'],
    [['nua', 'mao', 'mao', 'alface', 'carne', 'fechado'], 'naodeu', 0, 0.48, 'A mão cobriu a tampa nos quadros 2 e 3.', 'a']
  ];
  criterioDeCanal('montagem', 'c7').exemplos = SEQUENCIAS.map(function (x, i) {
    var comeco = 19 * 3600 + 51 * 60 + 20 - i * 7 * 60;
    return {
      id: 'e' + (i + 1), hora: horaDoExemplo(i, 7), juiz: x[1], instante: x[2], conf: x[3], motivo: x[4], marca: x[5] === 'a' ? 'acertou' : null, era: null,
      seq: x[0].map(function (d, n) { var s = comeco + n * 4; return { desenho: d, hora: doisDigitos(Math.floor(s / 3600)) + ':' + doisDigitos(Math.floor(s / 60) % 60) + ':' + doisDigitos(s % 60) }; })
    };
  });
  criterioDeCanal('montagem', 'c7').versao = 1;
  function criterioDeCanal(canal, id) {
    var ks = CANAIS[canal].criterios;
    for (var i = 0; i < ks.length; i++) if (ks[i].id === id) return ks[i];
    return null;
  }

  var negocio = 'hamburgueria';
  var guardado = JSON.stringify(CANAIS);

  // `perfil`: 'configura' (gerência: mexe em tudo), 'marca' (supervisão: marca exemplos, não mexe no critério) ou 've' (só vê).
  // `ex` e `filtro`: o exemplo aberto e o recorte da lista, na tela dos exemplos.
  var est = { tela: 'canal', canal: 'montagem', sel: 'inteira', situacao: 'operacao', perfil: 'configura', crit: null, aba: 'ficha', ex: null, filtro: 'pormarcar', preso: null };

  function canalAtual() { return CANAIS[est.canal]; }
  function quadroDe(c, id) { for (var i = 0; i < c.quadros.length; i++) if (c.quadros[i].id === id) return c.quadros[i]; return null; }
  function numeroDe(c, id) { for (var i = 0; i < c.quadros.length; i++) if (c.quadros[i].id === id) return i + 1; return 0; }
  function criterioDe(c, id) { for (var i = 0; i < c.criterios.length; i++) if (c.criterios[i].id === id) return c.criterios[i]; return null; }
  function criteriosEm(c, onde) { return c.criterios.filter(function (k) { return k.onde === onde; }); }
  function nomeDoNo(c, onde) {
    if (onde === 'inteira') return 'Imagem completa';
    var q = quadroDe(c, onde);
    return q ? 'Quadro ' + numeroDe(c, onde) + ' · ' + q.nome : '';
  }
  function podeMexer() { return est.perfil === 'configura'; }
  function podeMarcar() { return est.perfil === 'configura' || est.perfil === 'marca'; }
  function semCena(c) { return c.cena.estado === 'vazia'; }

  /* ─────────── onda 2: as contas do acerto ─────────── */
  // Só o exemplo MARCADO entra na conta. "Alarme falso" = o juiz disse "fora" e estava dentro: é o aviso que sairia errado.
  function contas(k) {
    var m = { total: 0, marcados: 0, porMarcar: 0, pulados: 0, fora: 0, foraErrados: 0, dentro: 0, dentroErrados: 0, naoDeu: 0, naoDeuNoTotal: 0 };
    (k.exemplos || []).forEach(function (e) {
      m.total++;
      if (e.juiz === 'naodeu') m.naoDeuNoTotal++;
      if (!e.marca) { if (e.pulou) m.pulados++; else m.porMarcar++; return; }
      m.marcados++;
      if (e.juiz === 'fora') { m.fora++; if (e.marca === 'errou') m.foraErrados++; }
      else if (e.juiz === 'dentro') { m.dentro++; if (e.marca === 'errou') m.dentroErrados++; }
      else m.naoDeu++;
    });
    m.comVeredito = m.fora + m.dentro;
    m.acertos = m.comVeredito - m.foraErrados - m.dentroErrados;
    m.acerto = m.comVeredito ? Math.round(m.acertos / m.comVeredito * 100) : null;
    m.faltam = Math.max(0, META.exemplos - m.marcados);
    m.faltamFora = Math.max(0, META.fora - m.fora);
    m.bastante = !m.faltam && !m.faltamFora;
    m.naMeta = m.bastante && m.foraErrados * META.emCada <= m.fora;
    return m;
  }
  function plural(n, um, varios) { return num(n) + ' ' + (n === 1 ? um : varios); }
  // "faltam 4 exemplos, 1 deles fora" — o que falta marcar para o acerto ficar medido
  function oQueFalta(m) {
    function faltam(n, resto) { return (n === 1 ? 'Falta 1 exemplo' : 'Faltam ' + num(n) + ' exemplos') + resto + '.'; }
    if (m.bastante) return '';
    if (m.faltamFora >= m.faltam) return faltam(m.faltamFora, ' em que o juiz disse “fora”');
    if (!m.faltamFora) return faltam(m.faltam, '');
    return faltam(m.faltam, ', ' + num(m.faltamFora) + ' deles “fora”');
  }
  // O critério em ensaio com exemplos bastantes passa a "medido" sozinho; desmarcou, volta.
  function acertarEstadoPelaMedida(k) {
    var m = contas(k);
    if (k.estado === 'ensaio' && m.bastante) { k.estado = 'medido'; return 'medido'; }
    if (k.estado === 'medido' && !m.bastante) { k.estado = 'ensaio'; return 'ensaio'; }
    return '';
  }

  /* ─────────── a ilustração que faz as vezes do quadro da câmera ─────────── */
  // `vazia`: a bancada sem o lote em andamento, ou a chapa sem as carnes — para os exemplos da onda 2
  function cenaDesenhada(id, vazia) {
    var s = '';
    if (id === 'montagem') {
      s += '<rect width="960" height="540" fill="var(--il-inox)"/>';
      s += '<rect y="468" width="960" height="72" fill="var(--il-piso)"/>';
      s += '<rect x="48" y="30" width="700" height="136" rx="8" fill="var(--il-inox-2)"/>';
      var cores = ['var(--il-pao)', 'var(--il-carne)', 'var(--il-queijo)', 'var(--il-alface)', 'var(--il-molho)', 'var(--il-escuro)'];
      for (var i = 0; i < 6; i++) {
        s += '<rect x="' + (66 + i * 113) + '" y="46" width="98" height="104" rx="6" fill="var(--il-cuba)"/>';
        s += '<rect x="' + (76 + i * 113) + '" y="56" width="78" height="84" rx="4" fill="' + cores[i] + '"/>';
      }
      for (var j = 0; j < (vazia ? 0 : 4); j++) {
        var x = 78 + j * 142;
        s += '<rect x="' + x + '" y="206" width="124" height="208" rx="3" fill="var(--il-folha)"/>';
        s += '<circle cx="' + (x + 62) + '" cy="250" r="30" fill="var(--il-pao)"/>';
        s += '<circle cx="' + (x + 44) + '" cy="318" r="30" fill="var(--il-pao)"/><circle cx="' + (x + 44) + '" cy="318" r="24" fill="var(--il-carne)"/>';
        s += '<circle cx="' + (x + 78) + '" cy="376" r="30" fill="var(--il-pao)"/><circle cx="' + (x + 78) + '" cy="376" r="24" fill="var(--il-carne)"/>';
      }
      s += '<rect x="660" y="232" width="190" height="196" rx="10" fill="#f4f6f8"/>';
      s += '<circle cx="716" cy="292" r="30" fill="var(--il-pao)"/><circle cx="790" cy="356" r="30" fill="var(--il-pao)"/><rect x="766" y="332" width="48" height="48" rx="3" fill="var(--il-queijo)" transform="rotate(9 790 356)"/>';
      s += '<rect x="786" y="58" width="128" height="118" rx="8" fill="var(--il-escuro)"/><rect x="812" y="34" width="76" height="62" rx="2" fill="#ffffff"/><rect x="822" y="46" width="56" height="4" fill="#9aa4b0"/><rect x="822" y="58" width="42" height="4" fill="#9aa4b0"/><rect x="822" y="70" width="50" height="4" fill="#9aa4b0"/>';
    } else {
      s += '<rect width="960" height="540" fill="var(--il-piso)"/>';
      s += '<rect x="40" y="40" width="580" height="330" rx="10" fill="var(--il-chapa)"/>';
      s += '<rect x="62" y="62" width="536" height="286" rx="6" fill="#4b5563"/>';
      for (var a = 0; a < (vazia ? 0 : 2); a++) for (var b = 0; b < 4; b++) {
        s += '<circle cx="' + (140 + b * 124) + '" cy="' + (138 + a * 124) + '" r="38" fill="var(--il-carne)"/>';
      }
      s += '<rect x="650" y="40" width="270" height="330" rx="10" fill="var(--il-inox)"/>';
      s += '<circle cx="740" cy="130" r="40" fill="none" stroke="var(--il-escuro)" stroke-width="4" stroke-dasharray="8 7"/><circle cx="740" cy="130" r="20" fill="#f4f6f8"/><circle cx="740" cy="130" r="8" fill="var(--il-cuba)"/>';
      s += '<rect x="800" y="210" width="90" height="120" rx="6" fill="var(--il-inox-2)"/>';
      s += '<rect x="40" y="392" width="580" height="120" rx="6" fill="#6b7684"/>';
    }
    return s;
  }
  function retangulo(q) { return { x: q.r[0] * 9.6, y: q.r[1] * 5.4, w: (q.r[2] - q.r[0]) * 9.6, h: (q.r[3] - q.r[1]) * 5.4 }; }
  function pixels(q) { return q ? [Math.round((q.r[2] - q.r[0]) * 19.2), Math.round((q.r[3] - q.r[1]) * 10.8)] : [1920, 1080]; }
  function sobreposicoes(c) {
    var saida = [];
    for (var i = 0; i < c.quadros.length; i++) for (var j = i + 1; j < c.quadros.length; j++) {
      var a = c.quadros[i].r, b = c.quadros[j].r;
      var x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]), x2 = Math.min(a[2], b[2]), y2 = Math.min(a[3], b[3]);
      if (x2 > x1 && y2 > y1) saida.push({ a: i + 1, b: j + 1, r: [x1, y1, x2, y2] });
    }
    return saida;
  }
  function imagemDoCanal(c) {
    var s = '<svg viewBox="0 0 960 540" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Ilustração do quadro do canal ' + esc(c.nome) + ', com ' + c.quadros.length + ' quadros marcados.">';
    s += '<defs><pattern id="hachura" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="10" height="10" fill="rgba(255,255,255,0.18)"/><rect width="4" height="10" fill="rgba(16,22,31,0.55)"/></pattern></defs>';
    s += cenaDesenhada(c.id);
    s += '<rect class="inteira' + (est.sel === 'inteira' ? ' aqui' : '') + '" x="3" y="3" width="954" height="534" rx="4"/>';
    sobreposicoes(c).forEach(function (o) {
      s += '<rect x="' + o.r[0] * 9.6 + '" y="' + o.r[1] * 5.4 + '" width="' + (o.r[2] - o.r[0]) * 9.6 + '" height="' + (o.r[3] - o.r[1]) * 5.4 + '" fill="url(#hachura)" pointer-events="none"/>';
    });
    c.quadros.forEach(function (q, i) {
      var r = retangulo(q), aqui = est.sel === q.id;
      s += '<g class="qd' + (aqui ? ' aqui' : '') + '" data-sel="' + q.id + '">';
      s += '<rect x="' + r.x + '" y="' + r.y + '" width="' + r.w + '" height="' + r.h + '" rx="3"/>';
      s += '<circle cx="' + (r.x + 22) + '" cy="' + (r.y + 22) + '" r="17"/><text x="' + (r.x + 22) + '" y="' + (r.y + 30) + '" text-anchor="middle">' + (i + 1) + '</text>';
      s += '</g>';
    });
    return s + '</svg>';
  }

  /* ─────────── onda 2: a ilustração que faz as vezes da imagem que o juiz viu ─────────── */
  // O que muda de um exemplo para outro, desenhado por cima da bancada vazia (ou da imagem completa, ou da chapa).
  function extrasDoExemplo(desenho) {
    var s = '';
    if (desenho === 'restos') s += '<circle cx="300" cy="300" r="7" fill="var(--il-alface)"/><circle cx="318" cy="312" r="5" fill="var(--il-alface)"/><circle cx="290" cy="318" r="4" fill="var(--il-alface)"/><circle cx="340" cy="296" r="6" fill="var(--il-pao)"/><circle cx="352" cy="310" r="4" fill="var(--il-pao)"/><circle cx="326" cy="330" r="5" fill="var(--il-carne)"/>';
    if (desenho === 'migalha') s += '<circle cx="410" cy="350" r="3" fill="var(--il-pao)"/><circle cx="422" cy="356" r="2.5" fill="var(--il-alface)"/>';
    if (desenho === 'papel') s += '<polygon points="420,262 470,250 494,284 476,320 430,324 406,292" fill="var(--il-folha)"/><path d="M430 270l36 44M468 258l-40 58" stroke="#b6c0cc" stroke-width="2" fill="none"/>';
    if (desenho === 'molho') s += '<ellipse cx="250" cy="332" rx="36" ry="14" fill="var(--il-molho)"/><g transform="rotate(-24 330 290)"><rect x="322" y="236" width="16" height="64" rx="3" fill="var(--il-escuro)"/><rect x="312" y="296" width="36" height="44" rx="4" fill="var(--il-cuba)"/></g>';
    if (desenho === 'brilho') s += '<polygon points="526,184 604,184 566,432 500,432" fill="#ffffff" opacity="0.6"/>';
    if (desenho === 'tapada') s += '<ellipse cx="360" cy="446" rx="170" ry="96" fill="#33415a"/><circle cx="360" cy="372" r="46" fill="#f1f4f8"/>';
    if (desenho === 'com' || desenho === 'touca' || desenho === 'semtouca' || desenho === 'costas') {
      s += '<ellipse cx="400" cy="530" rx="124" ry="62" fill="#33415a"/><circle cx="400" cy="468" r="40" fill="' + (desenho === 'semtouca' ? '#3b2a20' : '#f1f4f8') + '"/>';
      if (desenho === 'costas') s += '<rect x="300" y="404" width="200" height="96" rx="8" fill="var(--il-escuro)"/>';
    }
    if (desenho === 'crosta') s += '<ellipse cx="170" cy="150" rx="62" ry="26" fill="#1e2329"/><ellipse cx="140" cy="232" rx="40" ry="18" fill="#1e2329"/><ellipse cx="236" cy="206" rx="22" ry="10" fill="#1e2329"/>';
    return s;
  }
  // a bancada de montagem vazia, de cima: a borda das cubas no alto, as emendas do tampo, o rolo de papel, a beirada e o piso
  function bancadaVazia() {
    return '<rect width="614" height="248" fill="var(--il-inox)"/><rect width="614" height="16" fill="var(--il-inox-2)"/>' +
      '<path d="M205 16V224M410 16V224" stroke="var(--il-inox-2)" stroke-width="2" fill="none"/>' +
      '<rect x="536" y="34" width="62" height="26" rx="6" fill="var(--il-folha)"/><rect x="536" y="43" width="62" height="8" fill="#cfd6de"/><rect x="528" y="38" width="10" height="18" rx="2" fill="var(--il-cuba)"/>' +
      '<rect y="224" width="614" height="6" fill="var(--il-cuba)"/><rect y="230" width="614" height="18" fill="var(--il-piso)"/>';
  }
  // a imagem de um exemplo de um quadro só: o recorte do quadro do critério, como o juiz recebeu
  function imagemDoExemplo(c, k, e) {
    var rotulo = ' role="img" aria-label="Ilustração da imagem que o juiz viu neste exemplo.">';
    // os desenhos da bancada foram feitos nas coordenadas da imagem do canal: o Quadro 2 começa em (58, 184)
    if (c.id === 'montagem' && k.onde === 'q2') return '<svg viewBox="0 0 614 248" preserveAspectRatio="xMidYMid slice"' + rotulo + bancadaVazia() + '<g transform="translate(-58 -184)">' + extrasDoExemplo(e.desenho) + '</g></svg>';
    var q = k.onde === 'inteira' ? null : quadroDe(c, k.onde), r = q ? retangulo(q) : { x: 0, y: 0, w: 960, h: 540 };
    return '<svg viewBox="' + r.x + ' ' + r.y + ' ' + r.w + ' ' + r.h + '" preserveAspectRatio="xMidYMid slice"' + rotulo + cenaDesenhada(c.id, !!q) + extrasDoExemplo(e.desenho) + '</svg>';
  }
  // um quadro da sequência: uma posição da bancada, com a tampa do pão
  function quadroDaSequencia(desenho, rotulo) {
    var s = '<svg viewBox="0 0 160 120" role="img" aria-label="' + esc(rotulo) + '"><rect width="160" height="120" fill="var(--il-inox)"/><rect x="20" y="8" width="120" height="104" rx="3" fill="var(--il-folha)"/>';
    if (desenho === 'fechado') {
      s += '<circle cx="80" cy="60" r="37" fill="#c98f43"/><ellipse cx="68" cy="48" rx="4" ry="2" fill="#f3e6c8"/><ellipse cx="88" cy="44" rx="4" ry="2" fill="#f3e6c8"/><ellipse cx="96" cy="62" rx="4" ry="2" fill="#f3e6c8"/><ellipse cx="74" cy="70" rx="4" ry="2" fill="#f3e6c8"/><ellipse cx="60" cy="62" rx="4" ry="2" fill="#f3e6c8"/>';
      return s + '</svg>';
    }
    s += '<circle cx="80" cy="60" r="35" fill="var(--il-pao)"/><circle cx="80" cy="60" r="29" fill="#e6bb74"/>';
    if (desenho === 'bisnaga') s += '<circle cx="82" cy="56" r="5" fill="var(--il-molho)"/><g transform="rotate(32 112 30)"><rect x="101" y="0" width="22" height="50" rx="9" fill="#e9c33f"/><rect x="108" y="46" width="8" height="12" rx="2" fill="#b8941f"/></g>';
    if (desenho === 'molho' || desenho === 'molhoclaro') { var cor = desenho === 'molho' ? 'var(--il-molho)' : '#ead9a8'; s += '<circle cx="74" cy="55" r="12" fill="' + cor + '"/><circle cx="88" cy="62" r="12" fill="' + cor + '"/><circle cx="77" cy="69" r="10" fill="' + cor + '"/>'; }
    if (desenho === 'mao') s += '<g transform="rotate(-16 80 60)"><rect x="44" y="34" width="150" height="50" rx="24" fill="#4f7fc4"/></g>';
    if (desenho === 'alface' || desenho === 'carne' || desenho === 'queijo') s += '<circle cx="80" cy="60" r="30" fill="var(--il-alface)"/><circle cx="70" cy="50" r="9" fill="#79c466"/><circle cx="92" cy="66" r="10" fill="#79c466"/>';
    if (desenho === 'carne' || desenho === 'queijo') s += '<circle cx="80" cy="60" r="25" fill="var(--il-carne)"/>';
    if (desenho === 'queijo') s += '<rect x="59" y="39" width="42" height="42" rx="3" fill="var(--il-queijo)" transform="rotate(12 80 60)"/>';
    return s + '</svg>';
  }

  /* ─────────── quanto custa uma análise que precise da nuvem (para o teto e o custo do funil) ─────────── */
  function custoDoPedido(c, k) {
    var px = pixels(k.onde === 'inteira' ? null : quadroDe(c, k.onde));
    var entrada = Math.min(4800, Math.round(px[0] * px[1] / 750)); // unidades de imagem
    var usd = (entrada * 0.10 + 180 * 0.50) / 1e6;                // Haiku 5.5: entrada e saída por milhão
    return usd * 5.40;
  }

  /* ─────────── a tela do canal ─────────── */
  function chipDoEstado(k) { return '<span class="chip ' + CHIP_DO_ESTADO[k.estado] + '">' + NOME_DO_ESTADO[k.estado] + '</span>'; }
  function linhaDoFunil(k) {
    var f = k.funil;
    if (!f.olhadas) return 'ainda sem dados';
    if (k.estado === 'observando') return num(f.gatilho) + ' gatilhos em ' + num(f.olhadas) + ' olhadas · ainda não julga';
    // com exemplos, a linha troca "de N olhadas" (que está no funil) pelo acerto: cabe numa linha só
    var acerto = linhaDoAcerto(k);
    return num(f.julgadas) + ' julgadas' + (acerto ? '' : ' de ' + num(f.olhadas) + ' olhadas') + ' · ' + num(f.fora) + ' fora' + acerto;
  }
  // o que a linha do critério diz do acerto: quanto já foi marcado, ou quanto ele acerta
  function linhaDoAcerto(k) {
    var m = contas(k);
    if (!m.total) return '';
    if (m.bastante) return ' · acerta ' + m.acerto + '% em ' + num(m.marcados) + ' exemplos';
    if (k.estado === 'valendo') return ' · ainda sem medida';
    return ' · ' + num(m.marcados) + ' de ' + META.exemplos + ' exemplos marcados';
  }
  function noDaArvore(c, onde) {
    var q = onde === 'inteira' ? null : quadroDe(c, onde), ks = criteriosEm(c, onde), aqui = est.sel === onde;
    var s = '<div class="no' + (aqui ? ' aqui' : '') + '" data-no="' + onde + '">';
    s += '<div class="no-cab"><button class="sel" type="button" data-sel="' + onde + '" aria-pressed="' + aqui + '">';
    s += '<span class="no-num">' + (q ? numeroDe(c, onde) : ic('recorte', 'p')) + '</span>';
    s += '<span class="no-nome"><b>' + (q ? esc(q.nome) : 'Imagem completa') + '</b><small>' + (q ? esc(PAPEIS[q.papel][0]) : 'critérios gerais do canal') + ' · ' + (ks.length === 1 ? '1 critério' : ks.length + ' critérios') + '</small></span>';
    s += '</button>';
    if (q && podeMexer()) s += '<button class="btn fantasma quadrado mini" type="button" data-menu-quadro="' + q.id + '" aria-haspopup="menu" aria-expanded="false" aria-label="Ações do Quadro ' + numeroDe(c, onde) + ', ' + esc(q.nome) + '">' + ic('pontos') + '</button>';
    else s += '<span></span>';
    s += '</div>';
    if (ks.length) {
      s += '<ul class="criterios">';
      ks.forEach(function (k) {
        var falta = semCena(c) && k.pedeCena;
        s += '<li><button class="crit" type="button" data-crit="' + k.id + '"><b>' + esc(k.nome) + '</b>' + (falta ? '<span class="chip fora">falta descrever a cena</span>' : chipDoEstado(k));
        s += '<span class="linha2">' + FAMILIAS[k.familia][0].toLowerCase() + ' · ' + (falta ? 'não é analisado enquanto a cena estiver em branco' : linhaDoFunil(k)) + '</span></button></li>';
      });
      s += '</ul>';
    }
    s += '<div class="no-pe">';
    if (!ks.length) s += '<span>' + (q ? 'Nenhum critério neste quadro.' : 'Nenhum critério geral.') + '</span>';
    if (podeMexer()) s += '<button class="elo" type="button" data-novo-crit="' + onde + '">+ critério' + (q ? '' : ' geral') + '</button>';
    s += '</div></div>';
    return s;
  }
  function cartaoDaCena(c) {
    // A cena é escrita por quem configura o canal, com detalhes (decisão do dono, 09/10/2026).
    // O que o Farol faz com ela — e o que ele manda para onde — é lógica interna: não aparece aqui.
    var descrita = c.cena.estado === 'descrita', s = '<section class="cartao o3" aria-labelledby="t-cena"><header><h2 id="t-cena">A cena deste canal</h2>';
    if (descrita) s += '<span class="chip ok">descrita por ' + esc(c.cena.por || 'você') + ' em ' + esc(c.cena.em || '09/10') + '</span>';
    else s += '<span class="chip fora">em branco</span>';
    s += '</header><div class="miolo">';
    if (!descrita) {
      s += '<p class="aviso fora">' + ic('alerta') + '<span><b>Falta descrever a cena.</b> Sem ela, os critérios deste canal que dependem de entender a imagem não são analisados: aparecem como “falta descrever a cena”, e não como análise feita.</span></p>';
    }
    s += '<div class="campo"><label for="negocio">Tipo de negócio <span class="suave">— vale para a loja inteira</span></label><input class="entrada" id="negocio" value="' + esc(negocio) + '"' + (podeMexer() ? '' : ' disabled') + '></div>';
    s += '<div class="campo"><label for="cena">O que esta câmera vê, e de onde olha</label><textarea class="entrada" id="cena" rows="6" aria-describedby="cena-ajuda" placeholder="Bancada de montagem de lanches, vista de cima por uma câmera no teto. No alto ficam as cubas; no meio, a área onde os lanches são montados…"' + (podeMexer() ? '' : ' disabled') + '>' + esc(c.cena.texto) + '</textarea>';
    s += '<div class="ajuda" id="cena-ajuda"><p><b>Escreva com detalhes.</b> É com este texto que o Farol entende a imagem deste canal. Vale dizer:</p><ul>';
    s += '<li>que posto é este e o que se faz nele;</li>';
    s += '<li>de onde a câmera olha — do teto, de lado, de frente;</li>';
    s += '<li>o que aparece sempre, e em que parte da imagem — bancada, cubas, equipamentos, impressora;</li>';
    s += '<li>o que engana na imagem — brilho do inox, reflexo, vapor.</li>';
    s += '</ul></div></div>';
    if (podeMexer()) s += '<div class="linha-acoes"><button class="btn cheio" type="button" data-cena="salvar">Salvar a cena</button></div>';
    return s + '</div></section>';
  }
  function telaDoCanal() {
    var c = canalAtual();
    var gerais = criteriosEm(c, 'inteira').length, total = c.criterios.length;
    var s = '<div class="cab"><div><h1>' + esc(c.nome) + '</h1><div class="sobre"><span class="chip mono">canal ' + c.canal + ' · gravador</span><span class="chip ok">com imagem</span><span class="chip facho"><span class="facho-vivo" aria-hidden="true"></span>olhando agora</span></div></div>';
    s += '<div class="acoes"><button class="btn" type="button" data-toast="Quadro pedido ao agente da loja. Ele responde na próxima batida.">' + ic('atualizar', 'p') + 'Atualizar quadro</button></div></div>';
    s += '<div class="canal-grade"><div class="coluna">';
    s += '<section class="cartao o1" aria-labelledby="t-quadro"><header><h2 id="t-quadro">O canal e os quadros</h2><span class="suave mono empurra">09/10 · 21:40</span></header><div class="miolo">';
    s += '<div class="quadro-cam">' + imagemDoCanal(c) + '<span class="tarja">ilustração · no console aparece o quadro real da câmera</span></div>';
    s += '<div class="barra-quadro"><span class="nota">' + (c.quadros.length === 1 ? '1 quadro' : c.quadros.length + ' quadros') + ' · ' + (total === 1 ? '1 critério' : total + ' critérios') + ' — ' + gerais + (gerais === 1 ? ' geral' : ' gerais') + ', ' + (total - gerais) + ' em quadros</span>';
    if (podeMexer()) s += '<button class="btn mini empurra" type="button" data-novo-quadro>' + ic('mais', 'p') + 'Quadro</button>';
    s += '</div>';
    var so = sobreposicoes(c);
    if (so.length) s += '<p class="nota">' + ic('info', 'p') + ' Os quadros ' + so.map(function (o) { return o.a + ' e ' + o.b; }).join('; ') + ' se sobrepõem (a faixa riscada). Cada critério vale só no quadro em que foi posto.</p>';
    s += '</div></section>';
    var arvore = '<section class="cartao o2" aria-labelledby="t-arvore"><header><h2 id="t-arvore">Onde cada critério vale</h2></header><div class="miolo"><div class="arvore">';
    arvore += noDaArvore(c, 'inteira');
    c.quadros.forEach(function (q) { arvore += noDaArvore(c, q.id); });
    if (!c.quadros.length) arvore += '<div class="vazio"><h2>Nenhum quadro marcado</h2><p>O canal já tem a imagem completa, para os critérios gerais. Marque um quadro quando um critério valer só numa parte da imagem: as cubas, a área de montagem, a impressora.</p>' + (podeMexer() ? '<button class="btn cheio" type="button" data-novo-quadro>' + ic('mais', 'p') + 'Marcar o primeiro quadro</button>' : '') + '</div>';
    arvore += '</div></div></section>';
    s += cartaoDaCena(c) + '</div><div class="coluna">' + arvore + '</div></div>';
    return s;
  }
  function telaDosCanais() {
    var s = '<div class="cab"><div><h1>Canais</h1><p class="suave" style="margin-top:6px">As câmeras desta loja. Em cada canal: a imagem completa, os quadros e os critérios de cada um.</p></div></div><div class="canais">';
    Object.keys(CANAIS).forEach(function (id) {
      var c = CANAIS[id];
      s += '<a class="cartao canal" href="#canal/' + id + '" data-abrir-canal="' + id + '"><span class="num">canal ' + c.canal + ' · ' + esc(c.setor) + '</span><h3>' + esc(c.nome) + '</h3><span class="linha"><span class="chip">' + c.quadros.length + ' quadros</span><span class="chip">' + c.criterios.length + ' critérios</span>' + (c.cena.estado === 'descrita' ? '<span class="chip ok">cena descrita</span>' : '<span class="chip fora">falta a cena</span>') + '</span></a>';
    });
    OUTROS_CANAIS.forEach(function (o) {
      s += '<button class="cartao canal" type="button" style="text-align:left;cursor:pointer" data-toast="Canal de exemplo: neste protótipo só Montagem 1 e Chapa abrem."><span class="num">canal ' + o.canal + ' · ' + esc(o.setor) + '</span><h3>' + esc(o.nome) + '</h3><span class="linha"><span class="chip">' + (o.quadros === 1 ? '1 quadro' : o.quadros + ' quadros') + '</span><span class="chip">' + (o.criterios === 1 ? '1 critério' : o.criterios + ' critérios') + '</span><span class="chip fora">falta a cena</span></span></button>';
    });
    return s + '</div>';
  }
  function pintarCaminho() {
    var c = canalAtual(), el = document.getElementById('caminho');
    if (est.tela === 'canais') el.innerHTML = '<b>Canais</b>';
    else if (est.tela === 'exemplos') el.innerHTML = '<a href="#canais" data-ir="canais">Canais</a>' + ic('seta', 'p') + '<a href="#canal/' + c.id + '" data-abrir-canal="' + c.id + '">' + esc(c.nome) + '</a>' + ic('seta', 'p') + '<b>Exemplos</b>';
    else el.innerHTML = '<a href="#canais" data-ir="canais">Canais</a>' + ic('seta', 'p') + '<span>' + esc(c.setor) + '</span>' + ic('seta', 'p') + '<b>' + esc(c.nome) + '</b>';
    Array.prototype.forEach.call(document.querySelectorAll('.trilho a.ir'), function (a) {
      if (a.getAttribute('data-ir') === 'canais') a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }
  function pintar() {
    pintarCaminho();
    document.getElementById('loja-negocio').textContent = negocio;
    if (est.situacao === 'carregando') {
      tela.innerHTML = '<div class="ossos" aria-hidden="true"><div class="osso" style="height:34px;width:220px"></div><div class="canal-grade"><div class="osso" style="height:360px"></div><div class="osso" style="height:360px"></div></div></div><p class="sr" role="status">Carregando o canal.</p>';
      return;
    }
    if (est.situacao === 'erro') {
      tela.innerHTML = '<div class="vazio" role="alert">' + ic('alerta', 'g') + '<h2>O console não respondeu</h2><p>Não deu para carregar este canal. Nada foi perdido: os quadros e os critérios continuam valendo na loja.</p><button class="btn cheio" type="button" data-tentar>Tentar de novo</button></div>';
      return;
    }
    tela.innerHTML = est.tela === 'canais' ? telaDosCanais() : est.tela === 'exemplos' ? telaDosExemplos() : telaDoCanal();
  }

  /* ─────────── onda 2: a tela dos exemplos — marcar "acertou" ou "errou" ─────────── */
  var FILTROS = [['pormarcar', 'Por marcar'], ['marcados', 'Marcados'], ['fora', 'O juiz disse “fora”'], ['todos', 'Todos']];
  function noFiltro(e, filtro) {
    if (filtro === 'pormarcar') return !e.marca && !e.pulou;
    if (filtro === 'marcados') return !!e.marca;
    if (filtro === 'fora') return e.juiz === 'fora';
    return true;
  }
  // `est.preso`: o exemplo que acabou de mudar e sairia do recorte (marcado "errou" no recorte "por marcar", por
  // exemplo) continua na lista até a pessoa seguir adiante — senão ele some antes de ela dizer o que era.
  function exemplosVisiveis(k) { return (k.exemplos || []).filter(function (e) { return noFiltro(e, est.filtro) || e.id === est.preso; }); }
  function exemploDe(k, id) { var l = k.exemplos || []; for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; }
  function chipDoVeredito(juiz) { return '<span class="chip ' + VEREDITO[juiz][1] + '">' + VEREDITO[juiz][0] + '</span>'; }
  function marcaDoExemplo(e) {
    if (e.marca === 'acertou') return '<span class="marca-ex certo">' + ic('certo', 'p') + 'acertou</span>';
    if (e.marca === 'errou') return '<span class="marca-ex errado">' + ic('x', 'p') + 'errou</span>';
    return '<span class="marca-ex">' + (e.pulou ? 'pulado' : 'por marcar') + '</span>';
  }
  function miniaturaDoExemplo(c, k, e) {
    if (e.seq) return quadroDaSequencia(e.seq[Math.max(0, (e.instante || 3) - 1)].desenho, 'Ilustração de um quadro da sequência deste exemplo.');
    return imagemDoExemplo(c, k, e);
  }
  function medidor(feito, total, rotulo) {
    var parte = Math.min(100, Math.round(feito / total * 100));
    return '<div class="medidor' + (feito >= total ? ' cheio' : '') + '" role="img" aria-label="' + esc(rotulo) + ': ' + num(Math.min(feito, total)) + ' de ' + num(total) + '"><i style="width:' + parte + '%"></i></div>';
  }
  function progressoDaMedida(k) {
    var m = contas(k);
    // passou do mínimo: diz quantos são e qual era o mínimo ("41 de 40" não se lê)
    function linha(feito, minimo, texto, rotulo) {
      return '<div class="progresso-linha"><span><b class="mono">' + num(feito) + '</b> ' + (feito > minimo ? texto + ' <span class="suave">· o mínimo é ' + minimo + '</span>' : 'de ' + minimo + ' ' + texto) + '</span>' + medidor(feito, minimo, rotulo) + '</div>';
    }
    return '<div class="progresso">' + linha(m.marcados, META.exemplos, 'exemplos marcados', 'Exemplos marcados') + linha(m.fora, META.fora, 'em que o juiz disse “fora”', 'Exemplos em que o juiz disse fora') + '</div>';
  }
  function gradeDaSequencia(e, podeApontar) {
    var s = '<div class="seq" role="group" aria-label="A sequência de 6 quadros que o juiz viu">';
    e.seq.forEach(function (q, i) {
      var n = i + 1, doJuiz = e.instante === n, certo = e.quadroCerto === n;
      var rotulo = 'Quadro ' + n + ' de 6, às ' + q.hora + (doJuiz ? ', o que o juiz apontou' : '') + (certo ? ', o que você apontou' : '');
      var miolo = '<span class="n">' + n + '</span>' + quadroDaSequencia(q.desenho, 'Ilustração do quadro ' + n + ' de 6.') + '<span class="seq-pe"><span class="mono">' + q.hora + '</span>' + (doJuiz ? '<span class="chip facho">o juiz apontou</span>' : '') + (certo ? '<span class="chip ok">você apontou</span>' : '') + '</span>';
      s += podeApontar
        ? '<button type="button" class="seq-quadro' + (doJuiz ? ' do-juiz' : '') + (certo ? ' certo' : '') + '" data-quadro-certo="' + n + '" aria-pressed="' + certo + '" aria-label="' + esc(rotulo) + '">' + miolo + '</button>'
        : '<div class="seq-quadro' + (doJuiz ? ' do-juiz' : '') + (certo ? ' certo' : '') + '">' + miolo + '</div>';
    });
    return s + '</div>';
  }
  function oQueEra(k, e) {
    var s = '<div class="oquera" role="group" aria-labelledby="oquera-t"><b id="oquera-t">O que era, então?</b><div class="opcoes">';
    ['dentro', 'fora', 'naodeu'].forEach(function (v) {
      if (v === e.juiz) return;
      var rotulo = v === 'dentro' ? 'Estava dentro do critério' : v === 'fora' ? 'Estava fora do critério' : 'Não dava para ver';
      s += '<button class="btn" type="button" data-era="' + v + '" aria-pressed="' + (e.era === v) + '">' + rotulo + '</button>';
    });
    s += '</div>';
    if (e.seq && e.era && e.era !== 'naodeu') s += '<p class="nota">Se quiser, toque no quadro em que isso se vê: ajuda o juiz a aprender o instante.</p>';
    return s + '</div>';
  }
  function detalheDoExemplo(c, k, e, posicao, quantos) {
    var s = '<section class="cartao ex-detalhe" aria-labelledby="ex-titulo"><header><h2 id="ex-titulo">Exemplo de ' + esc(e.hora) + '</h2><span class="suave mono empurra">' + posicao + ' de ' + quantos + '</span></header><div class="miolo">';
    if (e.seq) s += gradeDaSequencia(e, podeMarcar() && e.marca === 'errou' && !!e.era && e.era !== 'naodeu');
    else s += '<div class="ex-imagem">' + imagemDoExemplo(c, k, e) + '</div>';
    s += '<p class="nota">Ilustração: no console aparece ' + (e.seq ? 'a sequência' : 'a imagem') + ' que o juiz viu.</p>';
    s += '<div class="veredito"><div class="veredito-cab"><span class="rotulo">O juiz disse</span>' + chipDoVeredito(e.juiz) + '<span class="suave mono">confiança ' + Math.round(e.conf * 100) + '%</span></div><p>' + esc(e.motivo) + '</p></div>';
    if (podeMarcar()) {
      s += '<div class="marcar" role="group" aria-label="O juiz acertou?">';
      s += '<button class="btn acertou" type="button" data-marca="acertou" aria-pressed="' + (e.marca === 'acertou') + '">' + ic('certo') + 'Acertou<kbd class="tecla" aria-hidden="true">A</kbd></button>';
      s += '<button class="btn errou" type="button" data-marca="errou" aria-pressed="' + (e.marca === 'errou') + '">' + ic('x') + 'Errou<kbd class="tecla" aria-hidden="true">E</kbd></button></div>';
      if (e.marca === 'errou') s += oQueEra(k, e);
      s += '<div class="linha-acoes ex-rodape"><button class="btn mini" type="button" data-passo="-1"' + (posicao <= 1 ? ' disabled' : '') + '>' + ic('volta', 'p') + 'Anterior</button><button class="btn mini" type="button" data-passo="1"' + (posicao >= quantos ? ' disabled' : '') + '>Próximo' + ic('seta', 'p') + '</button>';
      if (!e.marca) s += '<button class="elo empurra" type="button" data-pular>' + (e.pulou ? 'Voltar para a fila' : 'Não dá para dizer: pular') + '</button>';
      else s += '<button class="elo empurra" type="button" data-desmarcar>Tirar a marca</button>';
      s += '</div>';
    } else {
      s += '<p class="aviso">' + ic('info') + '<span>Marcar “acertou” ou “errou” é com a supervisão, a gerência ou a diretoria.</span></p>';
      s += '<div class="linha-acoes ex-rodape"><button class="btn mini" type="button" data-passo="-1"' + (posicao <= 1 ? ' disabled' : '') + '>' + ic('volta', 'p') + 'Anterior</button><button class="btn mini" type="button" data-passo="1"' + (posicao >= quantos ? ' disabled' : '') + '>Próximo' + ic('seta', 'p') + '</button></div>';
    }
    return s + '</div></section>';
  }
  function telaDosExemplos() {
    var c = canalAtual(), k = criterioDe(c, est.crit);
    if (!k) { est.tela = 'canal'; return telaDoCanal(); }
    var m = contas(k), todos = k.exemplos || [], visiveis = exemplosVisiveis(k);
    var s = '<div class="cab"><div><h1>Exemplos</h1><div class="sobre"><span class="chip">' + esc(k.nome) + '</span>' + chipDoEstado(k) + '<span class="chip mono">versão ' + (k.versao || 1) + ' do critério</span></div></div>';
    s += '<div class="acoes"><button class="btn" type="button" data-abrir-acerto>' + ic('grafico', 'p') + 'Ver o acerto</button><a class="btn" href="#canal/' + c.id + '" data-voltar-ao-canal>' + ic('volta', 'p') + 'Voltar ao canal</a></div></div>';
    if (!todos.length) {
      return s + '<div class="vazio">' + ic('lista', 'g') + '<h2>Ainda sem exemplos</h2><p>' + (k.estado === 'observando' ? 'Este critério só observa: conta o contexto e o gatilho, sem julgar. Os exemplos começam a chegar quando ele passar para “em ensaio”.' : 'Os exemplos chegam a cada julgamento, no máximo 20 por dia. Volte depois de algumas horas de loja aberta.') + '</p></div>';
    }
    s += '<section class="cartao" aria-labelledby="ex-medida"><div class="miolo"><h2 class="sr" id="ex-medida">Quanto falta para medir</h2>' + progressoDaMedida(k);
    if (m.bastante) s += '<p class="aviso' + (m.naMeta ? '' : ' fora') + '">' + ic(m.naMeta ? 'certo' : 'alerta') + '<span><b>Medido em ' + num(m.marcados) + ' exemplos: acerta ' + m.acerto + '%.</b> Alarme falso: ' + m.foraErrados + ' em ' + m.fora + ' avisos. ' + (m.naMeta ? 'Está dentro da meta: já pode valer.' : 'Fora da meta de 1 em ' + META.emCada + ': ainda não pode valer.') + '</span></p>';
    else s += '<p class="nota">' + oQueFalta(m) + ' Com isso o acerto deste critério fica medido.</p>';
    s += '<div class="filtros" role="group" aria-label="Quais exemplos mostrar">';
    FILTROS.forEach(function (f) {
      var n = todos.filter(function (e) { return noFiltro(e, f[0]); }).length;
      s += '<button type="button" data-filtro="' + f[0] + '" aria-pressed="' + (est.filtro === f[0]) + '">' + f[1] + ' <span class="mono">' + n + '</span></button>';
    });
    s += '</div></div></section>';
    if (!visiveis.length) {
      var nada = est.filtro === 'pormarcar' ? ['Nada por marcar', 'Você marcou tudo o que chegou' + (m.pulados ? ' (' + plural(m.pulados, 'pulado', 'pulados') + ')' : '') + '. Novos exemplos chegam com a loja aberta, no máximo 20 por dia.'] : est.filtro === 'marcados' ? ['Nenhum exemplo marcado', 'Comece pelos que estão por marcar.'] : ['Nenhum exemplo aqui', 'Neste recorte não há exemplos.'];
      return s + '<div class="vazio">' + ic('certo', 'g') + '<h2>' + nada[0] + '</h2><p>' + nada[1] + '</p>' + (est.filtro !== 'todos' ? '<button class="btn" type="button" data-filtro="todos">Ver todos</button>' : '') + '</div>';
    }
    var atual = exemploDe(k, est.ex);
    if (!atual || visiveis.indexOf(atual) < 0) { atual = visiveis[0]; est.ex = atual.id; }
    var pos = visiveis.indexOf(atual) + 1;
    s += '<div class="ex-grade"><div class="ex-coluna-detalhe">' + detalheDoExemplo(c, k, atual, pos, visiveis.length) + '</div>';
    s += '<nav class="ex-coluna-lista" aria-label="Exemplos deste recorte"><ul class="ex-lista">';
    visiveis.forEach(function (e) {
      s += '<li><button class="ex-item" type="button" data-ex="' + e.id + '"' + (e === atual ? ' aria-current="true"' : '') + '><span class="mini">' + miniaturaDoExemplo(c, k, e) + '</span><span class="ex-item-texto"><span class="mono">' + esc(e.hora) + '</span>' + marcaDoExemplo(e) + chipDoVeredito(e.juiz) + '</span></button></li>';
    });
    s += '</ul></nav></div>';
    s += '<p class="nota">A imagem de um exemplo que ninguém marcou sai em 15 dias. A do exemplo marcado fica enquanto o critério não mudar: se o texto, o quadro ou o modelo mudar, a medida recomeça.</p>';
    s += '<p class="sr" role="status" id="ex-status"></p>';
    return s;
  }

  /* ─────────── avisos ─────────── */
  // `pede`: o aviso pede ou informa algo (não confirma uma ação feita) — sem o "certo" verde
  function avisar(texto, pede) {
    var a = document.createElement('div');
    a.className = 'aviso-topo' + (pede ? ' pede' : '');
    a.innerHTML = ic(pede ? 'info' : 'certo') + '<span>' + esc(texto) + '</span>';
    document.getElementById('avisos').appendChild(a);
    window.setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); }, 4200);
  }

  /* ─────────── as folhas (gavetas) ─────────── */
  // quem abriu, como seletor: a tela é repintada ao fechar, e o elemento de antes já não existe
  var voltarPara = null;
  function devolverFoco() {
    var alvo = voltarPara ? document.querySelector(voltarPara) : null;
    (alvo || tela).focus();
    voltarPara = null;
  }
  // o texto do critério quando a gaveta abriu: fechar sem salvar devolve, e salvar compara (mudou → a medida recomeça)
  var textoAoAbrir = null;
  function fechar() {
    var c = canalAtual(), aberto = est.crit && sobre.querySelector('#fk-titulo') ? criterioDe(c, est.crit) : null;
    if (aberto && !aberto.novo && textoAoAbrir !== null) aberto.texto = textoAoAbrir;
    textoAoAbrir = null;
    c.criterios = c.criterios.filter(function (k) { return !k.novo; }); // critério novo que não foi criado some
    sobre.innerHTML = '';
    pintar();
    devolverFoco();
  }
  function fecharSalvo(mensagem) {
    textoAoAbrir = null;
    sobre.innerHTML = '';
    pintar();
    devolverFoco();
    avisar(mensagem);
  }
  function abrir(html) {
    sobre.innerHTML = '<div class="veu" data-fechar></div>' + html;
    var f = sobre.querySelector('.folha, .paleta');
    if (f) { var alvo = f.querySelector('[data-foco]') || f.querySelector('button, input, textarea, select'); if (alvo) alvo.focus(); }
  }
  function partesDaFicha(k) {
    var s = '<div class="ficha">';
    PARTES.forEach(function (p) {
      var v = k.ficha[p[0]] || ['', '', ''];
      s += '<div class="ficha-linha' + (p[0] === 'fora' ? ' fora-ctx' : '') + '"><div class="parte">' + p[1] + '<small>' + p[2] + '</small></div><div class="valor">';
      s += '<p' + (podeMexer() ? ' contenteditable="true" role="textbox" aria-label="' + p[1] + '" data-parte="' + p[0] + '"' : '') + '>' + esc(v[0]) + '</p>';
      if (v[1] === 'naove' || v[2]) {
        s += '<div class="como">';
        if (v[1] === 'naove') s += '<span class="chip fora">a câmera não vê</span>';
        if (v[2]) s += '<span>' + (v[1] === 'naove' ? '' : 'pelo sinal: ') + esc(v[2]) + '</span>';
        s += '</div>';
      }
      s += '</div></div>';
    });
    return s + '</div>';
  }
  function abaFicha(c, k) {
    var s = '<div class="campo"><label for="k-nome">Nome do critério</label><input class="entrada" id="k-nome" value="' + esc(k.nome) + '"' + (podeMexer() ? '' : ' disabled') + ' placeholder="Bancada limpa entre pedidos"></div>';
    s += '<div class="campo"><label for="k-texto">Como você explicaria a um funcionário novo</label><textarea class="entrada" id="k-texto" rows="3"' + (podeMexer() ? '' : ' disabled') + ' placeholder="Entre um lote e outro, a área de montagem fica sem restos de alimento.">' + esc(k.texto) + '</textarea><small>Descreva o que se vê, não o rótulo.</small></div>';
    s += '<div class="campo"><span class="rotulo" id="k-fam">O que este critério pergunta</span><div class="familias" role="radiogroup" aria-labelledby="k-fam">';
    Object.keys(FAMILIAS).forEach(function (f) {
      var F = FAMILIAS[f];
      s += '<div class="familia"><input type="radio" name="k-familia" id="k-f-' + f + '" value="' + f + '"' + (k.familia === f ? ' checked' : '') + (podeMexer() ? '' : ' disabled') + '><label for="k-f-' + f + '"><b>' + F[0] + (F[3] ? '<span class="chip">' + F[3] + '</span>' : '') + '</b><small>' + F[1] + ' ' + F[2] + '</small></label></div>';
    });
    s += '</div></div>';
    s += '<div class="campo"><span class="rotulo">O estudo deste critério — quando vale a pena olhar</span>';
    if (k.semFicha) {
      s += '<div class="vazio"><h2>Ainda sem estudo</h2><p>A partir do seu texto, deste canal e destes quadros, o sistema propõe as seis partes e liga cada condição a um sinal que a loja já dá. Você confirma ou corrige.</p>' + (podeMexer() ? '<button class="btn cheio" type="button" data-propor-ficha>' + ic('brilho', 'p') + 'Propor o estudo</button>' : '') + '</div>';
    } else {
      s += '<p class="aviso ' + (k.confirmada ? '' : 'facho') + '">' + ic(k.confirmada ? 'certo' : 'brilho') + '<span>' + (k.confirmada ? 'Estudo confirmado por você. Toque num texto para corrigir.' : '<b>Proposto pelo sistema</b>, a partir do seu texto, deste canal e destes quadros. Confirme ou corrija: toque num texto para mudar.') + '</span></p>';
      s += partesDaFicha(k);
      if (k.sugestao) s += '<p class="aviso facho">' + ic('info') + '<span><b>Sugestão.</b> ' + esc(k.sugestao) + '</span></p>';
      if (podeMexer()) s += '<div class="linha-acoes"><button class="btn" type="button" data-propor-ficha>' + ic('brilho', 'p') + 'Propor de novo</button>' + (k.confirmada ? '' : '<button class="btn" type="button" data-confirmar-ficha>' + ic('certo', 'p') + 'Confirmar o estudo</button>') + '</div>';
    }
    s += '</div>';
    return s;
  }
  function abaFunil(c, k) {
    var f = k.funil, max = Math.max(1, f.olhadas), obs = k.estado === 'observando';
    if (!f.olhadas) return '<div class="vazio"><h2>Ainda sem dados</h2><p>O critério começa a contar na próxima batida do agente da loja: primeiro as olhadas, o contexto e o gatilho — sem julgar.</p></div>';
    function linha(rot, v, classe, texto) {
      return '<div class="funil-linha ' + (classe || '') + '"><span>' + rot + '</span><div class="trilha"><i style="width:' + (v ? Math.max(1.5, Math.sqrt(v / max) * 100) : 0) + '%"></i></div><span class="v">' + (texto || num(v)) + '</span></div>';
    }
    var s = '<p class="nota">Últimas 24 horas — números de exemplo. Uma olhada a cada ' + c.olhada + ' s.</p><div class="funil" role="img" aria-label="Funil: ' + num(f.olhadas) + ' olhadas, ' + num(f.contexto) + ' com contexto, ' + num(f.gatilho) + ' com gatilho, ' + (obs ? 'ainda sem julgar' : num(f.julgadas) + ' julgadas, ' + num(f.fora) + ' fora do critério') + '.">';
    s += linha('Olhadas', f.olhadas) + linha('Com contexto', f.contexto) + linha('Com gatilho', f.gatilho);
    s += obs ? linha('Julgadas', 0, 'espera', '—') + linha('Fora do critério', 0, 'espera', '—') : linha('Julgadas', f.julgadas) + linha('Fora do critério', f.fora, 'fim');
    s += '</div>';
    var semCtx = f.olhadas - f.contexto, custoDia = f.nuvem * custoDoPedido(c, k);
    // Antes de ligar não se sabe quantas análises a loja resolve sozinha: o que dá para dizer é o teto.
    var teto = k.soLoja ? 0 : f.gatilho * (k.familia === 'acontecimento' ? 0.003 : custoDoPedido(c, k));
    s += '<div class="dados"><div class="dado"><b>' + Math.round(semCtx / f.olhadas * 100) + '%</b><span>das olhadas sem contexto: não julgadas, não pagas, fora da conta.</span></div>';
    s += '<div class="dado"><b>' + num(f.gatilho) + '</b><span>vezes por dia o gatilho acontece.</span></div>';
    s += '<div class="dado"><b>' + reais(obs ? teto : custoDia) + '</b><span>' + (obs ? (teto ? 'por dia, no máximo, quando ligado — se toda análise precisasse da nuvem.' : 'por dia, quando ligado: é conferido só no computador da loja.') : 'por dia de nuvem' + (f.nuvem ? ' — ' + (f.nuvem === 1 ? '1 análise precisou' : num(f.nuvem) + ' análises precisaram') + ' dela.' : ': tudo foi analisado no computador da loja.')) + '</span></div></div>';
    if (obs) s += '<p class="aviso">' + ic('info') + '<span><b>Observando.</b> O critério já conta o contexto e o gatilho, sem julgar. É o que mostra quanto ele trabalharia — e quanto custaria — antes de ser ligado.' + (k.depois ? ' O julgamento desta família ' + esc(k.depois) + '.' : '') + '</span></p>';
    return s;
  }
  function abaEstado(c, k) {
    var i = ESTADOS.map(function (e) { return e[0]; }).indexOf(k.estado), s = '<ol class="passos">';
    ESTADOS.forEach(function (e, j) {
      s += '<li class="passo' + (j < i ? ' feito' : j === i ? ' agora' : '') + '"><span class="bola">' + (j < i ? ic('certo', 'p') : j + 1) + '</span><div><h3>' + e[1] + (j === i ? ' <span class="chip facho">é onde está</span>' : '') + '</h3><p>' + e[2] + '</p><p>' + e[3] + '</p></div></li>';
    });
    s += '</ol>';
    var m = contas(k);
    if (k.antigo && !m.bastante) s += '<p class="aviso">' + ic('info') + '<span>Este critério já avisava antes de existir a medida: <b>continua valendo</b>. Marque os exemplos dele para saber quanto ele acerta.</span></p>';
    if (k.estado === 'ensaio') s += '<p class="aviso">' + ic('info') + '<span><b>' + num(m.marcados) + ' de ' + META.exemplos + ' exemplos marcados.</b> ' + oQueFalta(m) + ' Quando chegar lá, o critério passa a “medido” sozinho.</span></p>';
    if (k.estado === 'medido') s += '<p class="aviso' + (m.naMeta ? '' : ' fora') + '">' + ic(m.naMeta ? 'certo' : 'alerta') + '<span><b>Acerta ' + m.acerto + '% em ' + num(m.marcados) + ' exemplos.</b> Alarme falso: ' + m.foraErrados + ' em ' + m.fora + ' avisos. ' + (m.naMeta ? 'Está dentro da meta: já pode valer.' : 'Fora da meta de 1 em ' + META.emCada + '. Ajuste o texto ou o quadro: a medida recomeça com a versão nova.') + '</span></p>';
    s += '<div class="linha-acoes">';
    if (podeMexer()) {
      if (k.estado === 'observando') s += '<button class="btn cheio" type="button" data-estado="ensaio"' + (k.depois ? ' disabled' : '') + '>Passar para em ensaio</button>' + (k.depois ? '<span class="nota">O julgamento desta família ' + esc(k.depois) + '. Até lá, ele observa.</span>' : '');
      if (k.estado === 'ensaio') s += '<button class="btn" type="button" data-estado="observando">Voltar a só observar</button>';
      if (k.estado === 'medido') s += '<button class="btn cheio" type="button" data-estado="valendo"' + (m.naMeta ? '' : ' disabled') + '>Passar a valer</button><button class="btn" type="button" data-estado="observando">Voltar a só observar</button>';
      if (k.estado === 'valendo') s += '<button class="btn" type="button" data-estado="ensaio">Parar de avisar</button>';
    }
    if (m.total && k.estado !== 'observando') s += '<button class="btn" type="button" data-ver-exemplos>' + (m.porMarcar && podeMarcar() ? 'Marcar exemplos (' + num(m.porMarcar) + ')' : 'Ver os exemplos') + '</button>';
    s += '</div>';
    return s + '<p class="nota">Só “valendo” avisa. Nenhum critério novo chega lá sem o acerto medido e a meta batida: no máximo 1 alarme falso em ' + META.emCada + ' avisos.</p>';
  }
  function abaAcerto(c, k) {
    var m = contas(k);
    if (k.estado === 'observando' || !m.total) {
      return '<div class="vazio"><h2>Ainda sem medida</h2><p>' + (k.estado === 'observando' ? 'O acerto começa a ser medido quando o critério passa para “em ensaio”: cada julgamento vira um exemplo, e alguém marca se o juiz acertou.' : 'Os exemplos chegam a cada julgamento, no máximo 20 por dia.') + '</p></div>';
    }
    var s = progressoDaMedida(k);
    if (!m.bastante) s += '<p class="nota">' + oQueFalta(m) + ' Até lá, os números abaixo são parciais.</p>';
    s += '<div class="dados">';
    s += '<div class="dado"><b>' + (m.acerto === null ? '—' : m.acerto + '%') + '</b><span>de acerto: o juiz acertou ' + num(m.acertos) + ' de ' + num(m.comVeredito) + '.' + (m.dentroErrados ? ' Deixou passar ' + num(m.dentroErrados) + '.' : '') + '</span></div>';
    s += '<div class="dado"><b>' + (m.fora ? m.foraErrados + ' em ' + m.fora : '—') + '</b><span>alarme falso: avisos que sairiam errados.</span></div>';
    s += '<div class="dado"><b>' + num(m.naoDeuNoTotal) + ' de ' + num(m.total) + '</b><span>vezes em que não deu para ver.</span></div></div>';
    if (m.bastante) s += '<p class="aviso' + (m.naMeta ? '' : ' fora') + '">' + ic(m.naMeta ? 'certo' : 'alerta') + '<span><b>' + (m.naMeta ? 'Dentro da meta.' : 'Fora da meta.') + '</b> Para valer: no máximo 1 alarme falso em ' + META.emCada + ' avisos. ' + (m.naMeta ? (k.estado === 'valendo' ? 'O critério está valendo.' : 'Em “Estado”, o critério já pode passar a valer.') : 'Ajuste o texto ou o quadro e meça de novo.') + '</span></p>';
    else s += '<p class="nota">A meta para valer: no máximo 1 alarme falso em ' + META.emCada + ' avisos, medido em ' + META.exemplos + ' exemplos marcados, ' + META.fora + ' deles “fora”.</p>';
    s += '<div class="linha-acoes"><button class="btn' + (m.porMarcar && podeMarcar() ? ' cheio' : '') + '" type="button" data-ver-exemplos>' + (m.porMarcar && podeMarcar() ? 'Marcar exemplos (' + num(m.porMarcar) + ')' : 'Ver os exemplos') + '</button></div>';
    s += '<p class="nota">Vale para a versão ' + (k.versao || 1) + ' deste critério. Se o texto, o quadro ou o modelo mudar, a medida recomeça. Marcam: a supervisão, a gerência e a diretoria.</p>';
    return s;
  }
  function abaAviso() {
    return '<p class="nota">Como hoje: nada muda nesta parte.</p><div class="ficha">' +
      '<div class="ficha-linha"><div class="parte">Prioridade</div><div class="valor"><p>intermediária — até 30 s</p></div></div>' +
      '<div class="ficha-linha"><div class="parte">Gravidade</div><div class="valor"><p>atenção</p></div></div>' +
      '<div class="ficha-linha"><div class="parte">Confiança mínima</div><div class="valor"><p class="mono">70%</p></div></div>' +
      '<div class="ficha-linha"><div class="parte">Silêncio entre avisos</div><div class="valor"><p class="mono">15 min</p></div></div>' +
      '<div class="ficha-linha"><div class="parte">Avisar só se continuar</div><div class="valor"><p>na primeira olhada fora do critério</p></div></div></div>';
  }
  var ABAS = [['ficha', 'O critério'], ['funil', 'O funil'], ['acerto', 'O acerto'], ['estado', 'Estado'], ['aviso', 'Aviso']];
  function folhaDoCriterio() {
    var c = canalAtual(), k = criterioDe(c, est.crit);
    if (!k) return fechar();
    if (textoAoAbrir === null) textoAoAbrir = k.texto;
    var s = '<section class="folha" role="dialog" aria-modal="true" aria-labelledby="fk-titulo"><header class="folha-cab"><div><h2 id="fk-titulo">' + (k.novo ? 'Novo critério' : esc(k.nome)) + '</h2><p>' + esc(c.nome) + ' · ' + esc(nomeDoNo(c, k.onde)) + ' · ' + NOME_DO_ESTADO[k.estado] + '</p></div><button class="btn fantasma quadrado" type="button" data-fechar data-foco aria-label="Fechar">' + ic('x') + '</button></header>';
    s += '<div class="folha-corpo"><div class="abas" role="tablist" aria-label="Partes do critério">';
    ABAS.forEach(function (a) { s += '<button type="button" role="tab" aria-selected="' + (est.aba === a[0]) + '" data-aba="' + a[0] + '">' + a[1] + '</button>'; });
    s += '</div><div role="tabpanel">';
    s += '<div class="pilha">' + (est.aba === 'funil' ? abaFunil(c, k) : est.aba === 'acerto' ? abaAcerto(c, k) : est.aba === 'estado' ? abaEstado(c, k) : est.aba === 'aviso' ? abaAviso() : abaFicha(c, k)) + '</div>';
    s += '</div></div><footer class="folha-pe">';
    if (podeMexer()) s += '<button class="btn cheio" type="button" data-salvar-crit>' + (k.novo ? 'Criar critério' : 'Salvar critério') + '</button>';
    s += '<button class="btn" type="button" data-fechar>' + (podeMexer() ? 'Cancelar' : 'Fechar') + '</button>';
    if (k.novo) s += '<span class="nota">Nasce <b>observando</b>: conta o contexto e o gatilho, sem julgar.</span>';
    s += '</footer></section>';
    abrir(s);
  }
  function folhaDoQuadro(id) {
    var c = canalAtual(), q = quadroDe(c, id), n = numeroDe(c, id), px = pixels(q);
    var s = '<section class="folha estreita" role="dialog" aria-modal="true" aria-labelledby="fq-titulo"><header class="folha-cab"><div><h2 id="fq-titulo">Quadro ' + n + '</h2><p>' + esc(c.nome) + ' · <span class="mono">' + num(px[0]) + ' × ' + num(px[1]) + ' px</span> na câmera</p></div><button class="btn fantasma quadrado" type="button" data-fechar data-foco aria-label="Fechar">' + ic('x') + '</button></header><div class="folha-corpo">';
    s += '<div class="campo"><label for="q-nome">Nome do quadro</label><input class="entrada" id="q-nome" value="' + esc(q.nome) + '"></div>';
    s += '<div class="campo"><label for="q-papel">Papel — o que este quadro é</label><select class="entrada" id="q-papel">';
    ORDEM_DOS_PAPEIS.forEach(function (p) { s += '<option value="' + p + '"' + (q.papel === p ? ' selected' : '') + '>' + PAPEIS[p][0] + '</option>'; });
    s += '</select><small id="q-papel-nota">' + esc(PAPEIS[q.papel][1]) + '</small></div>';
    s += '<p class="aviso">' + ic('info') + '<span>O papel diz ao Farol o que há neste quadro: é por ele que a análise sabe o que está olhando.</span></p>';
    s += '<div class="linha-acoes"><button class="btn" type="button" data-toast="No console abre o desenho por pontos, como hoje.">' + ic('lapis', 'p') + 'Redesenhar o contorno</button></div>';
    s += '<div class="campo" id="q-excluir-area"><button class="btn perigo" type="button" data-excluir-quadro="' + id + '">' + ic('lixo', 'p') + 'Excluir este quadro</button></div>';
    s += '</div><footer class="folha-pe"><button class="btn cheio" type="button" data-salvar-quadro="' + id + '">Salvar quadro</button><button class="btn" type="button" data-fechar>Cancelar</button></footer></section>';
    abrir(s);
  }

  /* ─────────── menu do quadro e paleta ─────────── */
  function abrirMenu(botao) {
    var id = botao.getAttribute('data-menu-quadro'), r = botao.getBoundingClientRect();
    voltarPara = '[data-menu-quadro="' + id + '"]';
    botao.setAttribute('aria-expanded', 'true');
    sobre.innerHTML = '<div class="veu" data-fechar style="background:transparent"></div><div class="menu" role="menu" style="top:' + Math.round(r.bottom + 6) + 'px;left:' + Math.round(Math.max(8, Math.min(window.innerWidth - 208, r.right - 190))) + 'px"><button type="button" role="menuitem" data-editar-quadro="' + id + '" data-foco>' + ic('lapis', 'p') + 'Editar o quadro</button><button type="button" role="menuitem" data-novo-crit="' + id + '">' + ic('mais', 'p') + 'Critério neste quadro</button><button type="button" role="menuitem" data-editar-quadro="' + id + '" data-ir-excluir="1">' + ic('lixo', 'p') + 'Excluir o quadro</button></div>';
    sobre.querySelector('[data-foco]').focus();
  }
  function itensDaPaleta() {
    var itens = [{ t: 'Canais', d: 'lista', ir: function () { ir('canais'); } }];
    Object.keys(CANAIS).forEach(function (id) {
      var c = CANAIS[id];
      itens.push({ t: c.nome, d: 'canal ' + c.canal, ir: function () { ir('canal', id); } });
      c.criterios.forEach(function (k) { itens.push({ t: k.nome, d: 'critério · ' + c.nome, ir: function () { ir('canal', id); est.sel = k.onde; est.crit = k.id; est.aba = 'ficha'; pintar(); folhaDoCriterio(); } }); });
      c.criterios.forEach(function (k) { if ((k.exemplos || []).length) itens.push({ t: 'Exemplos · ' + k.nome, d: 'marcar · ' + c.nome, ir: function () { irParaExemplos(id, k.id); } }); });
    });
    return itens;
  }
  function abrirPaleta() {
    voltarPara = '#abrir-paleta';
    var itens = itensDaPaleta();
    sobre.innerHTML = '<div class="veu" data-fechar></div><div class="paleta" role="dialog" aria-modal="true" aria-label="Ir para"><input type="text" id="paleta-busca" placeholder="Canal, critério…" aria-label="Buscar canal ou critério" autocomplete="off"><ul id="paleta-lista"></ul></div>';
    var busca = document.getElementById('paleta-busca'), lista = document.getElementById('paleta-lista'), pos = 0, visiveis = [];
    function listar() {
      // cada palavra digitada tem de aparecer, em qualquer ordem: "exemplos molho" acha "Exemplos · O molho vai na tampa…"
      var palavras = semAcento(busca.value).split(/\s+/).filter(Boolean);
      visiveis = itens.filter(function (i) { var alvo = semAcento(i.t + ' ' + i.d); return palavras.every(function (p) { return alvo.indexOf(p) >= 0; }); });
      if (pos >= visiveis.length) pos = 0;
      lista.innerHTML = visiveis.length ? visiveis.map(function (i, n) { return '<li><button type="button" data-n="' + n + '"' + (n === pos ? ' class="aqui"' : '') + '><span>' + esc(i.t) + '</span><small>' + esc(i.d) + '</small></button></li>'; }).join('') : '<li><button type="button" disabled><span class="suave">Nada com esse nome.</span></button></li>';
    }
    busca.addEventListener('input', function () { pos = 0; listar(); });
    busca.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { pos = Math.min(visiveis.length - 1, pos + 1); listar(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { pos = Math.max(0, pos - 1); listar(); e.preventDefault(); }
      else if (e.key === 'Enter' && visiveis[pos]) { var alvo = visiveis[pos]; voltarPara = null; sobre.innerHTML = ''; alvo.ir(); }
    });
    lista.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-n]');
      if (b) { var alvo = visiveis[Number(b.getAttribute('data-n'))]; voltarPara = null; sobre.innerHTML = ''; alvo.ir(); }
    });
    listar();
    busca.focus();
  }

  /* ─────────── navegação ─────────── */
  function ir(qual, canal) {
    est.tela = qual === 'canais' ? 'canais' : 'canal';
    if (canal && CANAIS[canal]) { est.canal = canal; est.sel = 'inteira'; est.crit = null; }
    var alvo = est.tela === 'canais' ? '#canais' : '#canal/' + est.canal;
    if (window.location.hash !== alvo) { try { window.history.replaceState(null, '', alvo); } catch (e) { /* sem histórico: segue */ } }
    pintar();
    tela.focus();
    window.scrollTo(0, 0);
  }
  /* ─────────── onda 2: andar pelos exemplos e marcar ─────────── */
  function irParaExemplos(canal, crit) {
    if (canal && CANAIS[canal]) est.canal = canal;
    est.tela = 'exemplos'; est.crit = crit; est.ex = null; est.preso = null; est.filtro = 'pormarcar';
    var k = criterioDe(canalAtual(), crit);
    if (k && !exemplosVisiveis(k).length) est.filtro = 'todos';
    var alvo = '#exemplos/' + est.canal + '/' + crit;
    if (window.location.hash !== alvo) { try { window.history.replaceState(null, '', alvo); } catch (e) { /* sem histórico: segue */ } }
    sobre.innerHTML = '';
    pintar();
    tela.focus();
    window.scrollTo(0, 0);
  }
  function focarNoExemplo(dizer) {
    var alvo = tela.querySelector('[data-marca="acertou"]') || tela.querySelector('[data-passo="1"]:not([disabled])') || tela.querySelector('[data-filtro]');
    if (alvo) alvo.focus();
    var status = document.getElementById('ex-status');
    if (status && dizer) status.textContent = dizer;
  }
  function exemploAberto() {
    var k = criterioDe(canalAtual(), est.crit);
    return k ? { k: k, e: exemploDe(k, est.ex), visiveis: exemplosVisiveis(k) } : null;
  }
  function andar(passo) {
    var a = exemploAberto();
    if (!a || !a.e) return;
    var i = a.visiveis.indexOf(a.e) + passo;
    if (i < 0 || i >= a.visiveis.length) return;
    est.ex = a.visiveis[i].id; est.preso = null;
    pintar();
    focarNoExemplo('Exemplo ' + (i + 1) + ' de ' + a.visiveis.length + '.');
  }
  // depois de marcar: vai para o seguinte do recorte (o marcado pode ter saído dele) e acerta o estado pela medida
  function depoisDeMarcar(a, dizer, fica) {
    // `a.visiveis` é o recorte de ANTES da marca
    var i = a.visiveis.indexOf(a.e), seguinte = a.visiveis[i + 1] || null, anterior = a.visiveis[i - 1] || null;
    var mudou = acertarEstadoPelaMedida(a.k);
    if (!fica) {
      if (seguinte) est.ex = seguinte.id;
      else if (!noFiltro(a.e, est.filtro) && anterior) est.ex = anterior.id; // era o último e saiu do recorte
    }
    pintar();
    focarNoExemplo(dizer);
    var m = contas(a.k);
    if (mudou === 'medido') avisar('Medido em ' + num(m.marcados) + ' exemplos: acerta ' + m.acerto + '%. ' + (m.naMeta ? 'Dentro da meta: já pode valer.' : 'Fora da meta: ainda não pode valer.'), !m.naMeta);
    if (mudou === 'ensaio') avisar('Voltou a “em ensaio”: ' + oQueFalta(m).replace(/\.$/, '') + ' para medir.', true);
  }
  function marcarExemplo(marca) {
    var a = exemploAberto();
    if (!a || !a.e || !podeMarcar()) return;
    a.e.marca = marca; a.e.pulou = false;
    if (marca === 'acertou') { a.e.era = null; a.e.quadroCerto = null; est.preso = null; depoisDeMarcar(a, 'Marcado: o juiz acertou.'); return; }
    // errou: fica no exemplo, para dizer o que era
    est.preso = a.e.id;
    depoisDeMarcar(a, 'Marcado: o juiz errou. Diga o que era.', true);
    var primeira = tela.querySelector('[data-era]'); if (primeira) primeira.focus();
  }
  function dizerOQueEra(v) {
    var a = exemploAberto();
    if (!a || !a.e || a.e.marca !== 'errou') return;
    a.e.era = v;
    if (v === 'naodeu') a.e.quadroCerto = null;
    // na sequência, quem marcou pode ainda apontar o quadro: fica; no exemplo de um quadro só, segue
    var fica = !!a.e.seq && v !== 'naodeu';
    if (!fica) est.preso = null;
    depoisDeMarcar(a, 'Anotado.', fica);
    if (a.e.seq && v !== 'naodeu') { var q = tela.querySelector('[data-quadro-certo]'); if (q) q.focus(); }
  }
  function apontarQuadro(n) {
    var a = exemploAberto();
    if (!a || !a.e || !a.e.seq) return;
    a.e.quadroCerto = a.e.quadroCerto === n ? null : n;
    pintar();
    var b = tela.querySelector('[data-quadro-certo="' + n + '"]'); if (b) b.focus();
  }
  function pularExemplo() {
    var a = exemploAberto();
    if (!a || !a.e || a.e.marca) return;
    a.e.pulou = !a.e.pulou; est.preso = null;
    depoisDeMarcar(a, a.e.pulou ? 'Pulado: não conta na medida.' : 'Voltou para a fila.');
  }
  function desmarcarExemplo() {
    var a = exemploAberto();
    if (!a || !a.e) return;
    a.e.marca = null; a.e.era = null; a.e.quadroCerto = null; est.preso = a.e.id;
    depoisDeMarcar(a, 'Marca tirada.', true);
  }
  // os quatro retratos do critério "Bancada limpa entre pedidos", para ver cada estado sem marcar um a um
  function aplicarAcerto(v) {
    var k = criterioDeCanal('montagem', 'c4'), antes = criterioDe(JSON.parse(guardado).montagem, 'c4');
    if (!k) return; // na situação "canal novo" o critério não existe
    k.exemplos = antes.exemplos; k.estado = 'ensaio';
    if (v !== 'ensaio') {
      k.exemplos.forEach(function (e) {
        if (e.marca) return;
        if (e.desenho === 'limpa' || e.desenho === 'restos') e.marca = 'acertou';
        if (e.desenho === 'brilho' && v === 'forameta') { e.marca = 'errou'; e.era = 'dentro'; }
      });
      // o estado sai das marcas, pela mesma regra da tela: só fica medido com exemplos bastantes, e só vale na meta
      acertarEstadoPelaMedida(k);
      if (v === 'valendo' && contas(k).naMeta) k.estado = 'valendo';
    }
    sobre.innerHTML = ''; textoAoAbrir = null;
    est.ex = null; est.preso = null;
    pintar();
  }

  function aplicarSituacao(v) {
    est.situacao = v;
    CANAIS = JSON.parse(guardado);
    marcar(document.getElementById('proto-acerto'), 'ensaio');
    if (v === 'semcena') { CANAIS.montagem.cena = { texto: '', estado: 'vazia' }; CANAIS.chapa.cena = { texto: '', estado: 'vazia' }; }
    if (v === 'novo') { est.canal = 'montagem'; CANAIS.montagem.quadros = []; CANAIS.montagem.criterios = []; CANAIS.montagem.cena = { texto: '', estado: 'vazia' }; }
    est.sel = 'inteira'; est.crit = null;
    pintar();
  }
  function marcar(grupo, v) {
    Array.prototype.forEach.call(grupo.querySelectorAll('button'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === v)); });
  }
  function temaEscuro() {
    var t = raiz.getAttribute('data-theme');
    return t ? t === 'dark' : !window.matchMedia('(prefers-color-scheme: light)').matches;
  }
  function pintarTema() {
    var b = document.getElementById('tema'), escuro = temaEscuro();
    b.innerHTML = ic(escuro ? 'sol' : 'lua');
    b.setAttribute('aria-pressed', String(!escuro));
    b.setAttribute('aria-label', escuro ? 'Passar para o tema claro' : 'Passar para o tema escuro');
  }

  /* ─────────── os cliques ─────────── */
  document.addEventListener('click', function (e) {
    var alvo = e.target, c = canalAtual(), el;
    if ((el = alvo.closest('[data-fechar]'))) { fechar(); return; }
    if ((el = alvo.closest('[data-ir]'))) {
      e.preventDefault();
      if (el.getAttribute('data-ir') === 'canais') ir('canais'); else avisar('Esta parte não muda nesta onda: continua como no console de hoje.', true);
      return;
    }
    if ((el = alvo.closest('[data-abrir-canal]'))) { e.preventDefault(); ir('canal', el.getAttribute('data-abrir-canal')); return; }
    if ((el = alvo.closest('[data-toast]'))) { avisar(el.getAttribute('data-toast')); return; }
    if (alvo.closest('[data-tentar]')) { document.querySelector('#proto-situacao [data-v="operacao"]').click(); return; }
    // onda 2: os exemplos
    if (alvo.closest('[data-ver-exemplos]')) { guardarCampos(); textoAoAbrir = null; voltarPara = null; irParaExemplos(est.canal, est.crit); return; }
    if (alvo.closest('[data-abrir-acerto]')) { est.aba = 'acerto'; voltarPara = '[data-abrir-acerto]'; folhaDoCriterio(); return; }
    if ((el = alvo.closest('[data-voltar-ao-canal]'))) {
      e.preventDefault();
      var kv = criterioDe(c, est.crit);
      ir('canal'); if (kv) { est.sel = kv.onde; pintar(); var linha = tela.querySelector('.crit[data-crit="' + kv.id + '"]'); if (linha) linha.focus(); }
      return;
    }
    if ((el = alvo.closest('[data-filtro]'))) {
      est.filtro = el.getAttribute('data-filtro'); est.ex = null; est.preso = null; pintar();
      var bf = tela.querySelector('[data-filtro="' + est.filtro + '"]'); if (bf) bf.focus();
      return;
    }
    if ((el = alvo.closest('[data-ex]'))) { est.ex = el.getAttribute('data-ex'); est.preso = null; pintar(); focarNoExemplo(); return; }
    if ((el = alvo.closest('[data-passo]'))) { andar(Number(el.getAttribute('data-passo'))); return; }
    if ((el = alvo.closest('[data-marca]'))) { marcarExemplo(el.getAttribute('data-marca')); return; }
    if ((el = alvo.closest('[data-era]'))) { dizerOQueEra(el.getAttribute('data-era')); return; }
    if ((el = alvo.closest('[data-quadro-certo]'))) { apontarQuadro(Number(el.getAttribute('data-quadro-certo'))); return; }
    if (alvo.closest('[data-pular]')) { pularExemplo(); return; }
    if (alvo.closest('[data-desmarcar]')) { desmarcarExemplo(); return; }
    if ((el = alvo.closest('[data-menu-quadro]'))) { abrirMenu(el); return; }
    if ((el = alvo.closest('[data-editar-quadro]'))) {
      var idq = el.getAttribute('data-editar-quadro'), excluir = el.hasAttribute('data-ir-excluir');
      sobre.innerHTML = ''; est.sel = idq; pintar(); folhaDoQuadro(idq);
      if (excluir) { var bx = sobre.querySelector('[data-excluir-quadro]'); if (bx) bx.focus(); }
      return;
    }
    if ((el = alvo.closest('[data-excluir-quadro]'))) {
      var idx = el.getAttribute('data-excluir-quadro'), qx = quadroDe(c, idx), n = criteriosEm(c, idx).length;
      if (!el.hasAttribute('data-certeza')) {
        el.setAttribute('data-certeza', '1');
        el.innerHTML = ic('lixo', 'p') + 'Excluir mesmo o Quadro ' + numeroDe(c, idx) + ' · ' + esc(qx.nome);
        var nota = document.createElement('small');
        nota.textContent = n ? (n === 1 ? 'O critério dele deixa' : 'Os ' + n + ' critérios dele deixam') + ' de valer aqui. O histórico fica.' : 'Nenhum critério depende dele.';
        el.parentNode.appendChild(nota);
        return;
      }
      c.quadros = c.quadros.filter(function (o) { return o.id !== idx; });
      c.criterios = c.criterios.filter(function (o) { return o.onde !== idx; });
      est.sel = 'inteira'; voltarPara = '.sel[data-sel="inteira"]';
      fecharSalvo('Quadro excluído. Os outros foram renumerados.');
      return;
    }
    if ((el = alvo.closest('[data-salvar-quadro]'))) {
      var idSalvo = el.getAttribute('data-salvar-quadro'), qs = quadroDe(c, idSalvo), nome = document.getElementById('q-nome').value.trim();
      if (!nome) { document.getElementById('q-nome').focus(); return; }
      qs.nome = nome; qs.papel = document.getElementById('q-papel').value;
      voltarPara = '.sel[data-sel="' + idSalvo + '"]';
      fecharSalvo('Quadro salvo. O agente usa o papel novo na próxima batida.');
      return;
    }
    if (alvo.closest('[data-novo-quadro]')) {
      var novoId = 'q' + Date.now();
      c.quadros.push({ id: novoId, nome: 'Quadro novo', papel: 'livre', r: [34, 40, 58, 66] });
      est.sel = novoId; voltarPara = '.sel[data-sel="' + novoId + '"]'; pintar(); folhaDoQuadro(novoId);
      avisar('Quadro criado no meio da imagem. No console você ajusta o contorno por pontos.');
      return;
    }
    if ((el = alvo.closest('[data-novo-crit]'))) {
      var onde = el.getAttribute('data-novo-crit'), kid = 'k' + Date.now();
      sobre.innerHTML = '';
      c.criterios.push({ id: kid, novo: true, semFicha: true, nome: '', onde: onde, familia: 'estado', estado: 'observando', pedeCena: true, texto: '', ficha: {}, funil: { olhadas: 0, contexto: 0, gatilho: 0, julgadas: 0, nuvem: 0, fora: 0 }, confirmada: false });
      est.sel = onde; est.crit = kid; est.aba = 'ficha'; voltarPara = '.elo[data-novo-crit="' + onde + '"]'; pintar(); folhaDoCriterio();
      return;
    }
    if ((el = alvo.closest('[data-crit]'))) {
      est.crit = el.getAttribute('data-crit'); est.sel = criterioDe(c, est.crit).onde; est.aba = 'ficha';
      voltarPara = '.crit[data-crit="' + est.crit + '"]';
      folhaDoCriterio();
      return;
    }
    if ((el = alvo.closest('[data-aba]'))) { guardarCampos(); est.aba = el.getAttribute('data-aba'); folhaDoCriterio(); return; }
    if (alvo.closest('[data-propor-ficha]')) {
      guardarCampos();
      var kp = criterioDe(c, est.crit), q2 = kp.onde === 'inteira' ? 'a imagem completa' : nomeDoNo(c, kp.onde);
      kp.semFicha = false; kp.confirmada = false;
      if (!kp.ficha.contexto) {
        kp.ficha = {
          contexto: ['A loja está aberta e não há ninguém na frente de ' + q2 + '.', '', 'presença em ' + q2],
          gatilho: ['A cada 10 min, ou quando ' + q2 + ' fica parado depois de um movimento.', '', 'movimento em ' + q2],
          janela: ['O primeiro quadro parado.', '', ''],
          acao: [(kp.texto || 'O que o seu texto descreve') + ' — conferido em ' + q2 + '.', '', ''],
          desfecho: ['Como o texto descreve: dentro. Diferente: fora. Tapado ou escuro: não deu para ver.', '', ''],
          fora: ['Sem o contexto não se julga, não se paga e não conta como análise.', '', '']
        };
      }
      folhaDoCriterio();
      avisar('Estudo proposto. Confira cada parte antes de confirmar.');
      return;
    }
    if (alvo.closest('[data-confirmar-ficha]')) { guardarCampos(); criterioDe(c, est.crit).confirmada = true; folhaDoCriterio(); avisar('Estudo confirmado.'); return; }
    if ((el = alvo.closest('[data-estado]'))) {
      var ke = criterioDe(c, est.crit), avisava = ke.estado === 'valendo'; ke.estado = el.getAttribute('data-estado');
      if (ke.estado === 'ensaio' && !ke.funil.julgadas) { ke.funil.julgadas = ke.funil.gatilho; ke.funil.nuvem = ke.soLoja ? 0 : Math.round(ke.funil.gatilho * 0.1); ke.funil.fora = Math.round(ke.funil.gatilho * 0.05); }
      if (ke.estado === 'ensaio') acertarEstadoPelaMedida(ke); // com os exemplos já marcados, quem para de avisar continua medido
      folhaDoCriterio(); pintar();
      avisar(avisava ? 'Parou de avisar.' + (ke.estado === 'medido' ? ' A medida continua: ele volta a avisar quando você mandar.' : ' Voltou a “em ensaio”.')
        : ke.estado === 'ensaio' ? 'Em ensaio: passa a julgar e a mostrar. Não avisa ninguém.' : ke.estado === 'observando' ? 'Voltou a só observar: conta, sem julgar.' : ke.estado === 'valendo' ? 'Valendo: a partir de agora este critério avisa.' : 'Estado mudado.');
      return;
    }
    if ((el = alvo.closest('[data-salvar-crit]'))) {
      guardarCampos();
      var ks = criterioDe(c, est.crit);
      if (!ks.nome) { est.aba = 'ficha'; folhaDoCriterio(); var cn = document.getElementById('k-nome'); if (cn) cn.focus(); return; }
      // onda 2: mudar o texto de um critério com exemplos marcados recomeça a medida — a consequência é dita antes de salvar
      var ms = contas(ks), recomeca = !ks.novo && textoAoAbrir !== null && ks.texto !== textoAoAbrir && ms.marcados > 0;
      if (recomeca && !el.hasAttribute('data-certeza')) {
        el.setAttribute('data-certeza', '1');
        el.textContent = 'Salvar e recomeçar a medida';
        var notaDaMedida = document.createElement('span');
        notaDaMedida.className = 'nota'; notaDaMedida.setAttribute('role', 'alert');
        notaDaMedida.textContent = 'O texto mudou: o critério ' + (ks.estado === 'valendo' ? 'para de avisar, ' : '') + 'volta a “em ensaio” e a medida recomeça. ' + (ms.marcados === 1 ? 'O exemplo marcado fica guardado' : 'Os ' + num(ms.marcados) + ' exemplos marcados ficam guardados') + ', sem contar.';
        el.parentNode.appendChild(notaDaMedida);
        return;
      }
      if (recomeca) { ks.versao = (ks.versao || 1) + 1; ks.exemplos = []; if (ks.estado !== 'observando') ks.estado = 'ensaio'; }
      var eraNovo = ks.novo; ks.novo = false;
      voltarPara = est.tela === 'exemplos' ? '[data-abrir-acerto]' : '.crit[data-crit="' + ks.id + '"]';
      fecharSalvo(eraNovo ? 'Critério criado. Ele nasce observando: conta o contexto e o gatilho, sem julgar.' : recomeca ? 'Critério salvo na versão ' + ks.versao + '. A medida recomeça.' : 'Critério salvo.');
      return;
    }
    if (alvo.closest('[data-cena]')) {
      var texto = document.getElementById('cena').value.trim(), tipo = document.getElementById('negocio').value.trim();
      if (!texto) { document.getElementById('cena').focus(); avisar('Escreva o que esta câmera vê e de onde ela olha.', true); return; }
      if (tipo) negocio = tipo;
      c.cena = { texto: texto, estado: 'descrita', por: 'você', em: 'hoje' };
      pintar();
      var salvar = tela.querySelector('[data-cena]'); if (salvar) salvar.focus();
      avisar('Cena salva. O Farol passa a usar este texto para entender a imagem deste canal.');
      return;
    }
    if ((el = alvo.closest('[data-sel]'))) { est.sel = el.getAttribute('data-sel'); est.crit = null; pintar(); var b = tela.querySelector('.sel[data-sel="' + est.sel + '"]'); if (b && alvo.closest('.sel')) b.focus(); return; }
  });
  function guardarCampos() {
    var c = canalAtual(), k = criterioDe(c, est.crit);
    if (!k || !sobre.querySelector('.folha')) return;
    var nome = document.getElementById('k-nome'), texto = document.getElementById('k-texto'), fam = sobre.querySelector('input[name="k-familia"]:checked');
    if (nome) k.nome = nome.value.trim();
    if (texto) k.texto = texto.value.trim();
    if (fam) k.familia = fam.value;
    Array.prototype.forEach.call(sobre.querySelectorAll('[data-parte]'), function (p) {
      var parte = p.getAttribute('data-parte');
      if (k.ficha[parte]) k.ficha[parte][0] = p.textContent.trim();
    });
  }
  document.addEventListener('change', function (e) {
    if (e.target.id === 'q-papel') document.getElementById('q-papel-nota').textContent = PAPEIS[e.target.value][1];
    if (e.target.name === 'k-familia') { guardarCampos(); var k = criterioDe(canalAtual(), est.crit); if (FAMILIAS[k.familia][3] && k.estado !== 'observando') avisar('O julgamento desta família ' + FAMILIAS[k.familia][3] + '. Até lá, o critério observa.', true); }
  });
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); abrirPaleta(); return; }
    if (e.key === 'Escape' && sobre.innerHTML) { fechar(); return; }
    // onda 2: os atalhos de marcar valem só com o foco dentro do cartão do exemplo (atalho de uma tecla solta não pode valer na página inteira)
    if (est.tela === 'exemplos' && !sobre.innerHTML && !e.ctrlKey && !e.metaKey && !e.altKey && e.target.closest && e.target.closest('.ex-detalhe')) {
      if (e.key === 'a' || e.key === 'A') { e.preventDefault(); marcarExemplo('acertou'); return; }
      if (e.key === 'e' || e.key === 'E') { e.preventDefault(); marcarExemplo('errou'); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); andar(1); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); andar(-1); return; }
    }
    if (e.key === 'Tab') {
      var f = sobre.querySelector('.folha, .paleta, .menu');
      if (!f) return;
      var focaveis = Array.prototype.filter.call(f.querySelectorAll('button, input, textarea, select, [contenteditable="true"], a[href]'), function (x) { return !x.disabled && x.offsetParent !== null; });
      if (!focaveis.length) return;
      var primeiro = focaveis[0], ultimo = focaveis[focaveis.length - 1];
      if (e.shiftKey && document.activeElement === primeiro) { ultimo.focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { primeiro.focus(); e.preventDefault(); }
    }
  });
  document.getElementById('abrir-paleta').addEventListener('click', abrirPaleta);
  document.getElementById('tema').addEventListener('click', function () {
    var novo = temaEscuro() ? 'light' : 'dark';
    raiz.setAttribute('data-theme', novo);
    marcar(document.getElementById('proto-tema'), novo);
    pintarTema();
  });
  document.getElementById('proto-abrir').addEventListener('click', function () {
    var p = document.getElementById('proto-painel');
    p.hidden = !p.hidden;
    this.setAttribute('aria-expanded', String(!p.hidden));
  });
  document.getElementById('proto-situacao').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    marcar(this, b.getAttribute('data-v')); aplicarSituacao(b.getAttribute('data-v'));
  });
  document.getElementById('proto-perfil').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    marcar(this, b.getAttribute('data-v')); est.perfil = b.getAttribute('data-v'); pintar();
  });
  document.getElementById('proto-acerto').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    marcar(this, b.getAttribute('data-v')); aplicarAcerto(b.getAttribute('data-v'));
  });
  document.getElementById('proto-tema').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var v = b.getAttribute('data-v');
    marcar(this, v);
    if (v) raiz.setAttribute('data-theme', v); else raiz.removeAttribute('data-theme');
    pintarTema();
  });
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', pintarTema);

  function lerEndereco() {
    var h = (window.location.hash || '').slice(1);
    if (h === 'canais') { est.tela = 'canais'; }
    else if (h.indexOf('canal/') === 0 && CANAIS[h.slice(6)]) { est.tela = 'canal'; est.canal = h.slice(6); }
    else if (h === 'chapa' || h === 'montagem') { est.tela = 'canal'; est.canal = h; }
    else if (h.indexOf('exemplos/') === 0) {
      var partes = h.split('/');
      if (CANAIS[partes[1]] && criterioDe(CANAIS[partes[1]], partes[2])) { irParaExemplos(partes[1], partes[2]); return; }
    }
    // endereços de uma palavra só, para abrir o protótipo direto numa tela da onda 2
    // (a página publicada só recebe âncora simples; `data-entrada` vale quando não vem âncora nenhuma)
    var entrada = h || (document.querySelector('.app').getAttribute('data-entrada') || '');
    if (entrada === 'exemplos') { irParaExemplos('montagem', 'c4'); return; }
    if (entrada === 'sequencia') { irParaExemplos('montagem', 'c7'); return; }
    if (entrada === 'acerto') { est.tela = 'canal'; est.canal = 'montagem'; est.sel = 'q2'; est.crit = 'c4'; est.aba = 'acerto'; pintar(); voltarPara = '.crit[data-crit="c4"]'; folhaDoCriterio(); return; }
    pintar();
  }
  window.addEventListener('hashchange', lerEndereco);
  pintarTema();
  lerEndereco();
})();
