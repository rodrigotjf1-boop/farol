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
    acontecimento: ['Acontecimento', 'Aconteceu? Alguém fez?', 'Uma sequência curta de quadros.', 'chega com a sequência'],
    processo: ['Processo', 'Foi feito como manda?', 'Etapas ao longo do tempo.', 'chega depois da sequência'],
    medida: ['Medida', 'Quanto? Por quanto tempo?', 'Conta ou cronometra. Devolve número.', 'chega depois da sequência']
  };
  var ESTADOS = [
    ['observando', 'Observando', 'Só colhe números do que acontece. Não julga e não gasta.', 'Sai daqui quando há dados de alguns dias de operação.'],
    ['ensaio', 'Em ensaio', 'Julga e mostra. Não avisa ninguém.', 'Sai daqui quando você marcou “acertou” ou “errou” num número mínimo de exemplos.'],
    ['medido', 'Medido', 'O acerto, o alarme falso e o “não deu para ver” ficam à vista no critério.', 'Sai daqui quando passa da meta: no máximo 1 alarme falso em 10 avisos.'],
    ['valendo', 'Valendo', 'Avisa.', 'Volta a “em ensaio” se o texto, o quadro ou o modelo mudar.']
  ];
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
          funil: { olhadas: 2880, contexto: 380, gatilho: 150, julgadas: 0, nuvem: 0, fora: 0 }, confirmada: false }
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
        { id: 'k1', nome: 'O chapeiro salga as carnes', onde: 'q1', familia: 'acontecimento', estado: 'observando', pedeCena: true, depois: 'chega com a sequência',
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
  var negocio = 'hamburgueria';
  var guardado = JSON.stringify(CANAIS);

  var est = { tela: 'canal', canal: 'montagem', sel: 'inteira', situacao: 'operacao', perfil: 'configura', crit: null, aba: 'ficha' };

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
  function semCena(c) { return c.cena.estado === 'vazia'; }

  /* ─────────── a ilustração que faz as vezes do quadro da câmera ─────────── */
  function cenaDesenhada(id) {
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
      for (var j = 0; j < 4; j++) {
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
      for (var a = 0; a < 2; a++) for (var b = 0; b < 4; b++) {
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
    return num(f.julgadas) + ' julgadas de ' + num(f.olhadas) + ' olhadas · ' + num(f.fora) + ' fora';
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
    el.innerHTML = est.tela === 'canais' ? '<b>Canais</b>' : '<a href="#canais" data-ir="canais">Canais</a>' + ic('seta', 'p') + '<span>' + esc(c.setor) + '</span>' + ic('seta', 'p') + '<b>' + esc(c.nome) + '</b>';
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
    tela.innerHTML = est.tela === 'canais' ? telaDosCanais() : telaDoCanal();
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
  function fechar() {
    var c = canalAtual();
    c.criterios = c.criterios.filter(function (k) { return !k.novo; }); // critério novo que não foi criado some
    sobre.innerHTML = '';
    pintar();
    devolverFoco();
  }
  function fecharSalvo(mensagem) {
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
    if (k.antigo) s += '<p class="aviso">' + ic('info') + '<span>Este critério já avisava antes desta mudança: <b>continua valendo</b>. A medida dele entra na primeira rodada do banco de provas.</span></p>';
    if (podeMexer()) {
      s += '<div class="linha-acoes">';
      if (k.estado === 'observando') s += '<button class="btn cheio" type="button" data-estado="ensaio"' + (k.depois ? ' disabled' : '') + '>Passar para em ensaio</button>' + (k.depois ? '<span class="nota">O julgamento desta família ' + esc(k.depois) + '. Até lá, ele observa.</span>' : '');
      if (k.estado === 'ensaio') s += '<button class="btn" type="button" data-estado="observando">Voltar a só observar</button><button class="btn" type="button" disabled>Medir</button><span class="nota">“Medido” depende do banco de provas, que chega na onda seguinte.</span>';
      if (k.estado === 'valendo') s += '<button class="btn" type="button" data-estado="ensaio">Parar de avisar (voltar a em ensaio)</button>';
      s += '</div>';
    }
    return s + '<p class="nota">Só “valendo” avisa. Nenhum critério chega lá sem o acerto medido.</p>';
  }
  function abaAviso() {
    return '<p class="nota">Como hoje: nada muda nesta parte.</p><div class="ficha">' +
      '<div class="ficha-linha"><div class="parte">Prioridade</div><div class="valor"><p>intermediária — até 30 s</p></div></div>' +
      '<div class="ficha-linha"><div class="parte">Gravidade</div><div class="valor"><p>atenção</p></div></div>' +
      '<div class="ficha-linha"><div class="parte">Confiança mínima</div><div class="valor"><p class="mono">70%</p></div></div>' +
      '<div class="ficha-linha"><div class="parte">Silêncio entre avisos</div><div class="valor"><p class="mono">15 min</p></div></div>' +
      '<div class="ficha-linha"><div class="parte">Avisar só se continuar</div><div class="valor"><p>na primeira olhada fora do critério</p></div></div></div>';
  }
  var ABAS = [['ficha', 'O critério'], ['funil', 'O funil'], ['estado', 'Estado'], ['aviso', 'Aviso']];
  function folhaDoCriterio() {
    var c = canalAtual(), k = criterioDe(c, est.crit);
    if (!k) return fechar();
    var s = '<section class="folha" role="dialog" aria-modal="true" aria-labelledby="fk-titulo"><header class="folha-cab"><div><h2 id="fk-titulo">' + (k.novo ? 'Novo critério' : esc(k.nome)) + '</h2><p>' + esc(c.nome) + ' · ' + esc(nomeDoNo(c, k.onde)) + ' · ' + NOME_DO_ESTADO[k.estado] + '</p></div><button class="btn fantasma quadrado" type="button" data-fechar data-foco aria-label="Fechar">' + ic('x') + '</button></header>';
    s += '<div class="folha-corpo"><div class="abas" role="tablist" aria-label="Partes do critério">';
    ABAS.forEach(function (a) { s += '<button type="button" role="tab" aria-selected="' + (est.aba === a[0]) + '" data-aba="' + a[0] + '">' + a[1] + '</button>'; });
    s += '</div><div role="tabpanel">';
    s += '<div class="pilha">' + (est.aba === 'funil' ? abaFunil(c, k) : est.aba === 'estado' ? abaEstado(c, k) : est.aba === 'aviso' ? abaAviso() : abaFicha(c, k)) + '</div>';
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
    });
    return itens;
  }
  function abrirPaleta() {
    voltarPara = '#abrir-paleta';
    var itens = itensDaPaleta();
    sobre.innerHTML = '<div class="veu" data-fechar></div><div class="paleta" role="dialog" aria-modal="true" aria-label="Ir para"><input type="text" id="paleta-busca" placeholder="Canal, critério…" aria-label="Buscar canal ou critério" autocomplete="off"><ul id="paleta-lista"></ul></div>';
    var busca = document.getElementById('paleta-busca'), lista = document.getElementById('paleta-lista'), pos = 0, visiveis = [];
    function listar() {
      var termo = semAcento(busca.value);
      visiveis = itens.filter(function (i) { return !termo || semAcento(i.t + ' ' + i.d).indexOf(termo) >= 0; });
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
  function aplicarSituacao(v) {
    est.situacao = v;
    CANAIS = JSON.parse(guardado);
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
      var ke = criterioDe(c, est.crit); ke.estado = el.getAttribute('data-estado');
      if (ke.estado === 'ensaio' && !ke.funil.julgadas) { ke.funil.julgadas = ke.funil.gatilho; ke.funil.nuvem = ke.soLoja ? 0 : Math.round(ke.funil.gatilho * 0.1); ke.funil.fora = Math.round(ke.funil.gatilho * 0.05); }
      folhaDoCriterio(); pintar();
      avisar(ke.estado === 'ensaio' ? 'Em ensaio: passa a julgar e a mostrar. Não avisa ninguém.' : ke.estado === 'observando' ? 'Voltou a só observar: conta, sem julgar.' : 'Estado mudado.');
      return;
    }
    if (alvo.closest('[data-salvar-crit]')) {
      guardarCampos();
      var ks = criterioDe(c, est.crit);
      if (!ks.nome) { est.aba = 'ficha'; folhaDoCriterio(); var cn = document.getElementById('k-nome'); if (cn) cn.focus(); return; }
      var eraNovo = ks.novo; ks.novo = false;
      voltarPara = '.crit[data-crit="' + ks.id + '"]';
      fecharSalvo(eraNovo ? 'Critério criado. Ele nasce observando: conta o contexto e o gatilho, sem julgar.' : 'Critério salvo.');
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
    pintar();
  }
  window.addEventListener('hashchange', lerEndereco);
  pintarTema();
  lerEndereco();
})();
