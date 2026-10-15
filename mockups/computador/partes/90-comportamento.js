(function () {
  'use strict';

  // O computador da loja dorme e acorda sozinho (pedido do dono, 15/10/2026, ~00h30: "uma forma do servidor ser
  // programado para desligar e ligar preenchendo um horário, a desligada e a ligada"). Medido no PC da loja, só
  // leitura: ele aceita a espera (S3) e os despertadores estão ligados na tomada. "Dormir" = entrar em espera; "acordar"
  // = uma tarefa agendada o liga no horário, sem ninguém na loja.

  var raiz = document.documentElement;
  var tela = document.getElementById('tela');
  var sobre = document.getElementById('sobre');

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function ic(nome, classe) {
    return '<svg class="ic' + (classe ? ' ' + classe : '') + '" aria-hidden="true"><use href="#i-' + nome + '"/></svg>';
  }

  /* ─────────── os dados de exemplo ─────────── */
  var DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  var DIAS_LONGOS = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
  // a loja: de terça a domingo, das 18:00 às 02:00 (da madrugada seguinte); fecha na segunda
  var LOJA = [null, ['18:00', '02:00'], ['18:00', '02:00'], ['18:00', '02:00'], ['18:00', '02:00'], ['18:00', '02:00'], ['18:00', '02:00']];
  // o horário programado do exemplo: dorme às 02:30 (depois de fechar), acorda às 17:30 (antes de abrir); na segunda
  // dorme e só acorda na terça
  function horarioDoExemplo() {
    return [
      { dorme: '02:30', acorda: '' },
      { dorme: '', acorda: '17:30' },
      { dorme: '02:30', acorda: '17:30' },
      { dorme: '02:30', acorda: '17:30' },
      { dorme: '02:30', acorda: '17:30' },
      { dorme: '02:30', acorda: '17:30' },
      { dorme: '02:30', acorda: '17:30' }
    ];
  }
  // "agora", em cada situação do protótipo (quinta, 15/10/2026): dia 3 (quinta) e minutos do dia
  var AGORA = { sem: 492, acordado: 1180, dormindo: 492, naoacordou: 1085, pacote: 492 };
  var HOJE = 3;

  var est = { situacao: 'dormindo', perfil: 'diretoria', ligado: true, horario: horarioDoExemplo(), rascunho: null, teste: null };
  function configura() { return est.perfil !== 'supervisao'; }
  function sabe() { return est.situacao !== 'pacote'; }
  function temHorario() { return est.situacao !== 'sem' && est.ligado; }

  /* ─────────── as contas da semana ─────────── */
  function min(h) { if (!h) return null; var p = h.split(':'); return Number(p[0]) * 60 + Number(p[1]); }
  function hora(m) { m = ((m % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
  function eventosDoDia(h) {
    var ev = [];
    if (h.dorme) ev.push({ t: min(h.dorme), tipo: 'dorme' });
    if (h.acorda) ev.push({ t: min(h.acorda), tipo: 'acorda' });
    return ev.sort(function (a, b) { return a.t - b.t; });
  }
  // os trechos dormindo de cada dia (minutos de 0 a 1440); o estado da meia-noite vem da semana inteira
  function dormindoNaSemana(horario) {
    var dormindo = false, comeco = [];
    for (var volta = 0; volta < 2; volta++) {
      for (var d = 0; d < 7; d++) {
        if (volta === 1) comeco[d] = dormindo;
        eventosDoDia(horario[d]).forEach(function (e) { dormindo = e.tipo === 'dorme'; });
      }
    }
    return horario.map(function (h, d) {
      // `inicio`: quando começou o trecho dormindo de agora (0 = já vinha dormindo da noite anterior)
      var trechos = [], dormindoAgora = comeco[d], inicio = 0;
      eventosDoDia(h).forEach(function (e) {
        if (e.tipo === 'dorme' && !dormindoAgora) { dormindoAgora = true; inicio = e.t; }
        else if (e.tipo === 'acorda' && dormindoAgora) { if (e.t > inicio) trechos.push([inicio, e.t]); dormindoAgora = false; }
      });
      if (dormindoAgora) trechos.push([inicio, 1440]);
      return trechos;
    });
  }
  // os trechos com a loja aberta, de cada dia (a madrugada de um dia é o fim da noite do anterior)
  function abertaNaSemana() {
    return LOJA.map(function (faixa, d) {
      var trechos = [], antes = LOJA[(d + 6) % 7];
      if (antes && min(antes[1]) < min(antes[0])) trechos.push([0, min(antes[1])]);
      if (faixa) trechos.push([min(faixa[0]), min(faixa[1]) > min(faixa[0]) ? min(faixa[1]) : 1440]);
      return trechos;
    });
  }
  function choques(dorme, aberta) {
    var saida = [];
    dorme.forEach(function (a) { aberta.forEach(function (b) { var i = Math.max(a[0], b[0]), f = Math.min(a[1], b[1]); if (f > i) saida.push([i, f]); }); });
    return saida;
  }
  // a sugestão pelo horário da loja: acorda 30 minutos antes de abrir; dorme 30 minutos depois de fechar
  function sugestao() {
    return LOJA.map(function (faixa, d) {
      var antes = LOJA[(d + 6) % 7], h = { dorme: '', acorda: '' };
      if (antes && min(antes[1]) < min(antes[0])) h.dorme = hora(min(antes[1]) + 30);
      if (faixa) h.acorda = hora(min(faixa[0]) - 30);
      if (faixa && min(faixa[1]) > min(faixa[0])) h.dorme = hora(min(faixa[1]) + 30);
      return h;
    });
  }
  function textoDoDia(h) {
    if (h.dorme && h.acorda) return 'dorme <strong>' + h.dorme + '</strong> · acorda <strong>' + h.acorda + '</strong>';
    if (h.dorme) return 'dorme <strong>' + h.dorme + '</strong> · não acorda';
    if (h.acorda) return 'acorda <strong>' + h.acorda + '</strong>';
    return 'sem troca';
  }

  /* ─────────── a semana desenhada ─────────── */
  function barra(dorme, aberta, choque, agora) {
    var s = '<span class="barra-dia" role="img" aria-label="' + esc(descricaoDaBarra(dorme, aberta, choque)) + '">';
    dorme.forEach(function (t) { s += '<i class="dorme" style="left:' + (t[0] / 14.4) + '%;width:' + ((t[1] - t[0]) / 14.4) + '%"></i>'; });
    choque.forEach(function (t) { s += '<i class="choque" style="left:' + (t[0] / 14.4) + '%;width:' + ((t[1] - t[0]) / 14.4) + '%"></i>'; });
    aberta.forEach(function (t) { s += '<i class="aberta" style="left:' + (t[0] / 14.4) + '%;width:' + ((t[1] - t[0]) / 14.4) + '%"></i>'; });
    if (agora != null) s += '<i class="agora" style="left:calc(' + (agora / 14.4) + '% - 1px)"></i>';
    return s + '</span>';
  }
  function descricaoDaBarra(dorme, aberta, choque) {
    var partes = [];
    partes.push(dorme.length ? 'dormindo ' + dorme.map(function (t) { return 'das ' + hora(t[0]) + ' às ' + (t[1] === 1440 ? '24:00' : hora(t[1])); }).join(' e ') : 'acordado o dia todo');
    if (aberta.length) partes.push('loja aberta ' + aberta.map(function (t) { return 'das ' + hora(t[0]) + ' às ' + (t[1] === 1440 ? '24:00' : hora(t[1])); }).join(' e '));
    if (choque.length) partes.push('dormindo com a loja aberta ' + choque.map(function (t) { return 'das ' + hora(t[0]) + ' às ' + hora(t[1]); }).join(' e '));
    return partes.join('; ');
  }
  function semana(horario, comAgora) {
    var dorme = dormindoNaSemana(horario), aberta = abertaNaSemana();
    var s = '<div class="semana" role="list" aria-label="A semana do computador">';
    s += '<div class="semana-cab" aria-hidden="true"><span></span><span class="horas"><span style="left:0">0h</span><span style="left:25%">6h</span><span style="left:50%">12h</span><span style="left:75%">18h</span><span style="left:100%">24h</span></span><span></span></div>';
    DIAS.forEach(function (dia, d) {
      var ch = choques(dorme[d], aberta[d]);
      s += '<div class="dia-linha" role="listitem" data-dia="' + d + '"><b>' + dia + '</b>' +
        barra(dorme[d], aberta[d], ch, comAgora && d === HOJE ? AGORA[est.situacao] : null) +
        '<span class="texto">' + textoDoDia(horario[d]) + (LOJA[d] ? '' : ' · loja fechada') +
        (ch.length ? '<span class="conflito">dormindo com a loja aberta ' + ch.map(function (t) { return 'das ' + hora(t[0]) + ' às ' + hora(t[1]); }).join(' e ') + '</span>' : '') +
        '</span></div>';
    });
    s += '</div><div class="legenda" aria-hidden="true"><span><i class="l-acordado"></i>acordado</span><span><i class="l-dorme"></i>dormindo</span><span><i class="l-aberta"></i>loja aberta</span><span><i class="l-choque"></i>dormindo com a loja aberta</span></div>';
    return s;
  }

  /* ─────────── o estado no pé da coluna e no topo da tela ─────────── */
  function estado() {
    if (est.teste === 'dormindo') return { ponto: 'dorme', titulo: 'Dormindo (teste)', detalhe: 'acorda às 08:15', chip: '' , texto: 'dormindo para o teste: acorda às 08:15' };
    switch (est.situacao) {
      case 'dormindo': return { ponto: 'dorme', titulo: 'Dormindo', detalhe: 'acorda às 17:30', chip: 'dado', texto: 'dormindo até 17:30, como programado' };
      case 'naoacordou': return { ponto: 'fora', titulo: 'Agente sem sinal', detalhe: 'não acordou às 17:30', chip: 'fora', texto: 'não acordou às 17:30' };
      default: return { ponto: '', titulo: 'Agente ativo', detalhe: 'bateu há 20 s', chip: 'ok', texto: 'acordado · bateu há 20 s' };
    }
  }
  function pintarAgente() {
    var e = estado();
    document.getElementById('agente-da-loja').innerHTML = '<span class="ponto' + (e.ponto ? ' ' + e.ponto : '') + '" aria-hidden="true"></span><b>' + esc(e.titulo) + '</b><small>' + esc(e.detalhe) + '</small>';
    document.getElementById('agente-da-loja').setAttribute('aria-current', 'page');
  }

  /* ─────────── a tela ─────────── */
  function telaComputador() {
    var e = estado();
    var s = '<div class="cab"><div><h1>Computador da loja</h1><div class="sobre"><span class="chip ' + e.chip + '">' + esc(e.texto) + '</span><span class="chip mono">agente 89ef553</span>' +
      (temHorario() ? '<span class="chip">dorme e acorda sozinho</span>' : '') + '</div>' +
      '<p class="suave" style="margin-top:8px;max-width:68ch">O computador que lê as câmeras desta loja. Aqui fica o horário em que ele dorme e acorda sozinho, fora do expediente.</p></div>';
    if (configura()) {
      s += '<div class="acoes">';
      if (temHorario() && sabe() && est.situacao !== 'naoacordou') s += '<button class="btn" type="button" data-testar id="testar">' + ic('relogio', 'p') + 'Testar: dormir 3 minutos</button>';
      s += '<button class="btn cheio" type="button" data-editar id="editar">' + ic(est.situacao === 'sem' ? 'energia' : 'editar', 'p') + (est.situacao === 'sem' ? 'Programar o horário' : 'Editar o horário') + '</button></div>';
    }
    s += '</div>';

    if (est.teste === 'dormindo') {
      s += '<div class="aviso" role="status">' + ic('lua') + '<div><b>Dormindo para o teste.</b> Ele acorda sozinho às 08:15. Nada é conferido nesses 3 minutos.</div></div>';
    } else if (est.situacao === 'dormindo') {
      s += '<div class="aviso" role="status">' + ic('lua') + '<div><b>Dormindo até 17:30, como programado.</b> A loja está fechada: nada é conferido até lá, e o Farol não avisa que o agente está sem sinal enquanto ele dorme no horário.</div></div>';
    } else if (est.situacao === 'naoacordou') {
      s += '<div class="aviso fora" role="alert">' + ic('alerta') + '<div><b>O computador não acordou às 17:30.</b> Ele está sem sinal desde 02:30, quando dormiu como programado, e a loja abre às 18:00. Pode ter faltado energia enquanto ele dormia: aí ele só volta quando alguém apertar o botão de ligar. O aviso de agente sem sinal voltou a ser enviado.</div></div>';
    } else if (est.situacao === 'pacote') {
      s += '<div class="aviso facho" role="status">' + ic('info') + '<div><b>O computador da loja ainda não sabe dormir e acordar sozinho.</b> O horário fica guardado e vale quando o pacote novo for instalado nele. Até lá, ele fica ligado o tempo todo.</div></div>';
    }

    s += '<section class="cartao" aria-labelledby="t-horario"><header><h2 id="t-horario">O horário</h2>' + (temHorario() ? '<span class="chip empurra">no relógio da loja</span>' : '') + '</header><div class="miolo">';
    if (!temHorario()) {
      s += '<div class="vazio">' + ic('energia', 'g') + '<h2>Sem horário: o computador fica ligado o tempo todo</h2><p>Fora do expediente ele pode dormir: gasta menos energia, esquenta menos e acorda sozinho antes de a loja abrir.</p>' +
        (configura() ? '<button class="btn cheio" type="button" data-editar id="editar-vazio">' + ic('energia', 'p') + 'Programar o horário</button>' : '<p class="nota">Quem configura a loja programa o horário.</p>') + '</div>';
    } else {
      s += semana(est.horario, true);
      s += '<p class="nota">Ele não desliga de vez: entra em espera e acorda sozinho no horário. A loja aberta (a faixa de cima) é a do horário de funcionamento, em Critérios.</p>';
    }
    s += '</div></section>';

    if (temHorario()) {
      s += '<section class="cartao" aria-labelledby="t-aconteceu"><header><h2 id="t-aconteceu">O que aconteceu</h2><span class="chip empurra">últimos 3 dias</span></header><div class="miolo"><div class="eventos" role="list" aria-label="O que aconteceu">';
      eventosRecentes().forEach(function (v) {
        s += '<div class="evento ' + v[0] + '" role="listitem">' + ic(v[1], 'p') + '<span>' + v[2] + '</span><small>' + v[3] + '</small></div>';
      });
      s += '</div></div></section>';
    }

    s += '<section class="cartao" aria-labelledby="t-cuidados"><header><h2 id="t-cuidados">Antes de programar</h2></header><div class="miolo"><div class="ajuda"><ul>' +
      '<li><b>Ele não desliga de vez:</b> entra em espera. Se a energia cair enquanto ele dorme, ele só volta quando alguém apertar o botão de ligar.</li>' +
      '<li><b>Outro sistema no mesmo computador dorme junto.</b> Se ele também atende o servidor do Regem ou o caixa, programe só fora do expediente.</li>' +
      '<li><b>Depois de acordar, o agente leva um pouco para voltar a conferir:</b> acorde antes de abrir. “Sugerir pelo horário da loja” deixa 30 minutos de folga.</li>' +
      '<li><b>Enquanto ele dorme no horário,</b> o console mostra “dormindo” e o Farol não manda o aviso de agente sem sinal. Se ele não acordar, o aviso volta.</li>' +
      '</ul></div></div></section>';
    return s;
  }
  function eventosRecentes() {
    var v = [];
    if (est.teste === 'feito') v.push(['bom', 'certo', 'Teste: dormiu 3 minutos e acordou sozinho em 38 s', 'hoje, 08:15']);
    if (est.situacao === 'naoacordou') v.push(['ruim', 'alerta', 'Não acordou no horário (17:30)', 'hoje, 17:30']);
    if (est.situacao === 'acordado') v.push(['bom', 'sol', 'Acordou sozinho, em 41 s', 'hoje, 17:30']);
    v.push(['', 'lua', 'Dormiu, como programado', 'hoje, 02:30']);
    v.push(['bom', 'sol', 'Acordou sozinho, em 39 s', 'ontem, 17:30']);
    v.push(['', 'lua', 'Dormiu, como programado', 'ontem, 02:30']);
    v.push(['bom', 'sol', 'Acordou sozinho, em 44 s', '13/10, 17:30']);
    return v;
  }

  /* ─────────── a gaveta do horário ─────────── */
  function folhaHorario() {
    var r = est.rascunho;
    var dorme = dormindoNaSemana(r.horario), aberta = abertaNaSemana();
    var ruins = 0;
    var s = '<aside class="folha" role="dialog" aria-modal="true" aria-labelledby="fh-t"><div class="folha-cab"><div><h2 id="fh-t">Horário do computador</h2><p>Quando ele dorme e quando acorda, no relógio da loja.</p></div><button class="btn quadrado fantasma" type="button" data-fechar aria-label="Fechar">' + ic('x') + '</button></div><div class="folha-corpo">';
    if (!sabe()) s += '<div class="aviso facho">' + ic('info') + '<div>O computador da loja ainda não sabe dormir e acordar sozinho: o horário fica guardado e vale quando o pacote novo for instalado nele.</div></div>';
    s += '<button class="alternar" type="button" data-alternar id="alternar" aria-pressed="' + r.ligado + '"><span class="chave" aria-hidden="true"></span><span><b>Dormir e acordar sozinho</b><small>' + (r.ligado ? 'Ele dorme e acorda nos horários abaixo.' : 'Desligado: o computador fica ligado o tempo todo.') + '</small></span></button>';
    if (r.ligado) {
      s += '<div class="linha-acoes"><button class="btn mini" type="button" data-sugerir id="sugerir">' + ic('relogio', 'p') + 'Sugerir pelo horário da loja</button></div>';
      s += '<div class="horas-da-semana" role="group" aria-label="Os horários de cada dia"><div class="horas-cab" aria-hidden="true"><span></span><span>Dorme às</span><span>Acorda às</span></div>';
      DIAS.forEach(function (dia, d) {
        var ch = choques(dorme[d], aberta[d]);
        if (ch.length) ruins += 1;
        s += '<div class="horas-dia' + (ch.length ? ' choque' : '') + '"><b id="dia-' + d + '">' + dia + '</b>' +
          '<input class="entrada" type="time" id="h-' + d + '-dorme" data-dia="' + d + '" data-campo="dorme" value="' + esc(r.horario[d].dorme) + '" aria-labelledby="dia-' + d + ' r-dorme"' + (ch.length ? ' aria-describedby="erro-' + d + '"' : '') + '>' +
          '<input class="entrada" type="time" id="h-' + d + '-acorda" data-dia="' + d + '" data-campo="acorda" value="' + esc(r.horario[d].acorda) + '" aria-labelledby="dia-' + d + ' r-acorda">' +
          (ch.length ? '<span class="erro-do-dia" id="erro-' + d + '">Dormiria com a loja aberta ' + ch.map(function (t) { return 'das ' + hora(t[0]) + ' às ' + hora(t[1]); }).join(' e ') + '.</span>' : '') +
          '</div>';
      });
      s += '<span class="sr" id="r-dorme">dorme às</span><span class="sr" id="r-acorda">acorda às</span></div>';
      s += '<p class="nota">Deixe em branco o que não acontece naquele dia: na segunda, com a loja fechada, ele dorme às 02:30 e só acorda na terça.</p>';
      s += '<div class="campo"><span class="rotulo">A semana, desenhada</span>' + semana(r.horario, false) + '</div>';
    }
    s += '</div><div class="folha-pe"><p class="nota pe-nota">' + (r.ligado && ruins ? 'Em ' + (ruins === 1 ? '1 dia' : ruins + ' dias') + ' ele dormiria com a loja aberta: ajuste para salvar.' : 'Ele recebe o horário na próxima batida (em até 30 segundos).') + '</p>' +
      '<button class="btn" type="button" data-fechar>Cancelar</button><button class="btn cheio" type="button" data-salvar id="salvar"' + (r.ligado && ruins ? ' disabled' : '') + '>Salvar o horário</button></div></aside>';
    return s;
  }
  function dialogoTeste() {
    return '<div class="dialogo" role="alertdialog" aria-modal="true" aria-labelledby="dt-t" aria-describedby="dt-d"><div><h2 id="dt-t">Dormir 3 minutos agora?</h2>' +
      '<p id="dt-d">O computador da loja dorme e acorda sozinho às 08:15. Nesses 3 minutos nada é conferido, e o que mais roda nele (o servidor do Regem, se for o caso) para junto. Faça com a loja fechada.</p>' +
      '<div class="linha-acoes"><button class="btn" type="button" data-fechar data-foco>Cancelar</button><button class="btn cheio" type="button" data-confirmar-teste>Dormir 3 minutos</button></div></div></div>';
  }

  /* ─────────── o pinta-tudo e as ajudas ─────────── */
  function pintar() {
    pintarAgente();
    tela.innerHTML = telaComputador();
  }
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
    est.rascunho = null;
    var alvo = voltarPara ? document.querySelector(voltarPara) : null;
    (alvo || tela).focus();
    voltarPara = null;
  }
  function abrir(html, quemAbriu) {
    if (quemAbriu !== undefined) voltarPara = quemAbriu;
    sobre.innerHTML = '<div class="veu" data-fechar></div>' + html;
    var alvo = sobre.querySelector('[data-foco]') || sobre.querySelector('button');
    if (alvo) alvo.focus();
  }
  function redesenhar(focoId) {
    var corpo = sobre.querySelector('.folha-corpo'), topo = corpo ? corpo.scrollTop : 0;
    sobre.innerHTML = '<div class="veu" data-fechar></div>' + folhaHorario();
    var folha = sobre.querySelector('.folha');
    if (folha) folha.classList.add('sem-entrada');
    var novo = sobre.querySelector('.folha-corpo');
    if (novo) novo.scrollTop = topo;
    var alvo = focoId ? document.getElementById(focoId) : null;
    if (alvo) { try { alvo.focus({ preventScroll: true }); } catch (e) { alvo.focus(); } }
  }
  function marcar(grupo, v) {
    Array.prototype.forEach.call(document.querySelectorAll('#' + grupo + ' button'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === v)); });
  }
  function temaEscuro() {
    var t = raiz.getAttribute('data-theme');
    if (t) return t === 'dark';
    return !(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
  }
  function pintarTema() { document.getElementById('tema').setAttribute('aria-pressed', String(temaEscuro())); }
  function copia(h) { return h.map(function (x) { return { dorme: x.dorme, acorda: x.acorda }; }); }

  /* ─────────── as reações ─────────── */
  document.addEventListener('click', function (ev) {
    var t = ev.target instanceof Element ? ev.target : null;
    if (!t) return;
    var el;
    if ((el = t.closest('a[data-ir]'))) {
      ev.preventDefault();
      if (el.getAttribute('data-ir') === 'fora') avisar('Tela de exemplo: neste protótipo só o Computador da loja abre.', true);
      else tela.focus();
      return;
    }
    if (t.closest('[data-fechar]')) { fechar(); return; }
    if ((el = t.closest('[data-editar]'))) {
      est.rascunho = { ligado: est.situacao === 'sem' ? true : est.ligado, horario: est.situacao === 'sem' ? sugestao() : copia(est.horario) };
      abrir(folhaHorario(), '#' + el.id);
      return;
    }
    if (t.closest('[data-alternar]')) { est.rascunho.ligado = !est.rascunho.ligado; redesenhar('alternar'); return; }
    if (t.closest('[data-sugerir]')) { est.rascunho.horario = sugestao(); redesenhar('sugerir'); avisar('Sugerido pelo horário da loja: acorda 30 minutos antes de abrir e dorme 30 minutos depois de fechar.'); return; }
    if (t.closest('[data-salvar]')) {
      est.ligado = est.rascunho.ligado;
      est.horario = copia(est.rascunho.horario);
      var eraSem = est.situacao === 'sem';
      if (eraSem) { est.situacao = 'acordado'; marcar('proto-situacao', 'acordado'); }
      fechar();
      pintar();
      avisar(!sabe() ? 'Horário salvo. Ele vale quando o pacote novo for instalado no computador da loja.' : est.ligado ? 'Horário salvo. O computador recebe na próxima batida.' : 'Horário desligado: o computador fica ligado o tempo todo.');
      return;
    }
    if ((el = t.closest('[data-testar]'))) { abrir(dialogoTeste(), '#' + el.id); return; }
    if (t.closest('[data-confirmar-teste]')) {
      fechar();
      est.teste = 'dormindo';
      pintar();
      window.setTimeout(function () {
        est.teste = 'feito';
        pintar();
        avisar('Teste feito: dormiu 3 minutos e acordou sozinho em 38 s.');
      }, 2600);
      return;
    }
    if (t.closest('#tema')) { raiz.setAttribute('data-theme', temaEscuro() ? 'light' : 'dark'); marcar('proto-tema', raiz.getAttribute('data-theme')); pintarTema(); return; }
    if (t.closest('#proto-abrir')) {
      var painel = document.getElementById('proto-painel'), abre = painel.hidden;
      painel.hidden = !abre;
      document.getElementById('proto-abrir').setAttribute('aria-expanded', String(abre));
      return;
    }
    if ((el = t.closest('#proto-situacao button'))) {
      est.situacao = el.getAttribute('data-v');
      est.teste = null;
      est.ligado = true;
      est.horario = horarioDoExemplo();
      marcar('proto-situacao', est.situacao);
      sobre.innerHTML = '';
      pintar();
      return;
    }
    if ((el = t.closest('#proto-perfil button'))) { est.perfil = el.getAttribute('data-v'); marcar('proto-perfil', est.perfil); sobre.innerHTML = ''; pintar(); return; }
    if ((el = t.closest('#proto-tema button'))) {
      var v = el.getAttribute('data-v');
      if (v) raiz.setAttribute('data-theme', v); else raiz.removeAttribute('data-theme');
      marcar('proto-tema', v);
      pintarTema();
    }
  });
  document.addEventListener('change', function (ev) {
    var t = ev.target instanceof Element ? ev.target : null;
    if (!t || !t.matches('input[data-campo]') || !est.rascunho) return;
    est.rascunho.horario[Number(t.getAttribute('data-dia'))][t.getAttribute('data-campo')] = t.value;
    redesenhar(t.id);
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && sobre.innerHTML) { ev.preventDefault(); fechar(); }
  });

  pintarTema();
  pintar();
})();
