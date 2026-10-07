(() => {
  'use strict';

  document.documentElement.lang = 'pt-BR';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const numero = new Intl.NumberFormat('pt-BR');
  const calmo = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const icone = (nome, extra = '') =>
    `<svg class="ic ${extra}" aria-hidden="true"><use href="#i-${nome}"/></svg>`;

  const app = $('#app');
  const entrar = $('#entrar');
  const palco = $('#conteudo');
  const TELAS = ['painel', 'analises', 'canais', 'area', 'criterios', 'alertas', 'orcamento', 'lojas'];

  // ═══════════════════════ dados de exemplo ═══════════════════════
  // Tudo aqui é inventado para o protótipo. As somas fecham: o total dos
  // cartões é a soma das linhas da tabela e das barras do gráfico.

  const PERIODOS = {
    '24h': {
      titulo: 'Hora a hora',
      unidade: 'por hora, em média',
      rotulos: Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}h`),
      mostrar: (i) => i % 3 === 0,
      total: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 24, 78, 132, 126, 96, 60, 54, 72, 118, 152, 148, 122, 78, 24],
      nc: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 6, 5, 2, 1, 1, 2, 4, 7, 6, 3, 2, 0],
      na: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 6, 10, 10, 8, 5, 4, 6, 9, 12, 12, 10, 6, 1],
      linhas: [
        ['Bancada limpa entre pedidos', 'Montagem 1', 196, 14, 2, '0,87', '1,9 s', '21:42'],
        ['Bancada limpa entre pedidos', 'Montagem 2', 187, 9, 2, '0,85', '1,9 s', '21:38'],
        ['Alguém na chapa no horário de pico', 'Chapa', 251, 11, 2, '0,93', '0,09 s', '21:44'],
        ['Fila no balcão', 'Balcão · Lado do cliente', 281, 5, 2, '0,90', '0,09 s', '21:45'],
        ['Uso de touca', 'Montagem 1', 44, 1, 51, '0,71', '2,1 s', '21:40', 'avalia pouco'],
        ['Uso de touca', 'Montagem 2', 49, 1, 38, '0,73', '2,0 s', '21:36', 'avalia pouco'],
        ['Uso de touca', 'Chapa', 86, 0, 4, '0,82', '2,0 s', '21:41'],
        ['Cesto fora do óleo com a fritadeira parada', 'Fritadeira', 48, 0, 0, '0,88', '1,8 s', '14:08', 'sem imagem'],
      ],
    },
    '7d': {
      titulo: 'Dia a dia',
      unidade: 'por dia, em média',
      rotulos: ['qui 01', 'sex 02', 'sáb 03', 'dom 04', 'seg 05', 'ter 06', 'qua 07'],
      mostrar: () => true,
      total: [1190, 1420, 1610, 1580, 1105, 1242, 1284],
      nc: [52, 61, 70, 66, 38, 44, 41],
      na: [118, 133, 150, 139, 96, 104, 101],
      linhas: [
        ['Bancada limpa entre pedidos', 'Montagem 1', 1432, 112, 16, '0,86', '1,9 s', 'hoje 21:42'],
        ['Bancada limpa entre pedidos', 'Montagem 2', 1352, 84, 14, '0,85', '1,9 s', 'hoje 21:38'],
        ['Alguém na chapa no horário de pico', 'Chapa', 1832, 94, 14, '0,92', '0,09 s', 'hoje 21:44'],
        ['Fila no balcão', 'Balcão · Lado do cliente', 2046, 50, 14, '0,90', '0,09 s', 'hoje 21:45'],
        ['Uso de touca', 'Montagem 1', 316, 14, 370, '0,70', '2,1 s', 'hoje 21:40', 'avalia pouco'],
        ['Uso de touca', 'Montagem 2', 356, 10, 282, '0,72', '2,0 s', 'hoje 21:36', 'avalia pouco'],
        ['Uso de touca', 'Chapa', 627, 8, 28, '0,82', '2,0 s', 'hoje 21:41'],
        ['Cesto fora do óleo com a fritadeira parada', 'Fritadeira', 257, 0, 103, '0,87', '1,8 s', 'hoje 14:08', 'sem imagem'],
      ],
    },
  };

  const CRITERIOS = {
    bancada: {
      nome: 'Bancada limpa entre pedidos', tipo: 'estado', gravidade: 'atenção', ligado: true, canais: 2,
      texto: 'A superfície de trabalho está livre de restos de alimento, embalagens descartadas e utensílios sujos.',
      meta: 'prioridade intermediária · confiança mínima 0,70 · silêncio de 15 min · versão 3',
    },
    touca: {
      nome: 'Uso de touca', tipo: 'estado', gravidade: 'crítico', grave: true, ligado: true, canais: 3,
      texto: 'Toda pessoa na área de preparo está com o cabelo coberto por touca ou boné.',
      meta: 'prioridade intermediária · confiança mínima 0,70 · silêncio de 30 min · versão 2',
    },
    produto: {
      nome: 'Produto na bancada', tipo: 'contagem', gravidade: 'informativo', ligado: false, canais: 1, falta: true,
      texto: 'Há produto montado esperando na bancada.',
      meta: 'prioridade leve · confiança mínima 0,70 · silêncio de 15 min · versão 1',
    },
    chapa: {
      nome: 'Alguém na chapa no horário de pico', tipo: 'presença', gravidade: 'crítico', grave: true, ligado: true, canais: 1,
      procura: 'pelo menos 1 × pessoa',
      texto: 'Entre 11h30 e 14h30 e entre 18h30 e 22h, há alguém operando a chapa.',
      meta: 'prioridade urgente · confiança mínima 0,80 · silêncio de 10 min · versão 1',
    },
    cesto: {
      nome: 'Cesto fora do óleo com a fritadeira parada', tipo: 'estado', gravidade: 'atenção', ligado: true, canais: 1,
      texto: 'Quando não há fritura em andamento, o cesto está pendurado fora do óleo.',
      meta: 'prioridade intermediária · confiança mínima 0,70 · silêncio de 20 min · versão 1',
    },
    fila: {
      nome: 'Fila no balcão', tipo: 'contagem', gravidade: 'atenção', ligado: true, canais: 1,
      procura: 'no máximo 6 × pessoa',
      texto: 'Há no máximo 6 pessoas esperando na área do balcão.',
      meta: 'prioridade urgente · confiança mínima 0,75 · silêncio de 10 min · versão 2',
    },
    vazio: {
      nome: 'Ninguém no caixa com a loja fechada', tipo: 'presença', gravidade: 'crítico', grave: true, ligado: true, canais: 1,
      quando: 'fora', procura: 'não deve haver × pessoa',
      texto: 'Com a loja fechada, não há ninguém na área do caixa.',
      meta: 'prioridade urgente · confiança mínima 0,80 · silêncio de 10 min · versão 1',
    },
    posto: {
      nome: 'Alguém no balcão', tipo: 'presença', gravidade: 'atenção', ligado: true, canais: 1,
      procura: 'pelo menos 1 × pessoa',
      texto: 'Há pelo menos um colaborador atrás do balcão de atendimento.',
      meta: 'prioridade intermediária · confiança mínima 0,70 · silêncio de 15 min · versão 1',
    },
  };

  const ICONE_DO_TIPO = {
    estado: 'scan-search', 'presença': 'user-round-check', contagem: 'hash',
    'comparação': 'layers', 'ação': 'list-ordered',
  };

  const ARVORE = [
    {
      setor: 'Cozinha',
      canais: [
        { nome: 'Montagem 1', num: '04', criterios: ['bancada', 'touca', 'produto'] },
        { nome: 'Montagem 2', num: '05', criterios: ['bancada', 'touca'] },
        { nome: 'Chapa', num: '03', criterios: ['chapa', 'touca'] },
        { nome: 'Fritadeira', num: '06', criterios: ['cesto'], semImagem: true },
      ],
    },
    {
      setor: 'Atendimento',
      canais: [
        // Um canal, duas áreas: cada critério vale só na sua.
        {
          nome: 'Balcão', num: '01', criterios: ['posto', 'fila'],
          areas: [
            { nome: 'Dentro do balcão', criterios: ['posto'] },
            { nome: 'Lado do cliente', criterios: ['fila'] },
          ],
        },
        { nome: 'Caixa', num: 'IP', criterios: ['vazio'] },
      ],
    },
    {
      setor: 'Estoque',
      canais: [
        { nome: 'Estoque seco', num: '08', criterios: [] },
        { nome: 'Recebimento', num: '07', criterios: [], pausado: true },
      ],
    },
  ];

  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  const soma = (lista) => lista.reduce((a, b) => a + b, 0);

  // ═══════════════════════ aviso flutuante ═══════════════════════
  function avisar(texto) {
    const caixa = $('[data-toasts]');
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `${icone('circle-check')}<span></span>`;
    t.lastElementChild.textContent = texto;
    caixa.append(t);
    setTimeout(() => {
      t.classList.add('some');
      setTimeout(() => t.remove(), calmo ? 0 : 240);
    }, 3800);
  }

  // ═══════════════════════ navegação ═══════════════════════
  function moverRealce() {
    for (const nav of $$('[data-nav]')) {
      const realce = $('.nav-realce', nav);
      const atual = $('a[aria-current="page"]', nav);
      if (!atual || atual.offsetParent === null) {
        realce.style.opacity = '0';
        continue;
      }
      realce.style.opacity = '1';
      if (nav.classList.contains('barra')) {
        realce.style.right = 'auto';
        realce.style.width = `${atual.offsetWidth}px`;
        realce.style.transform = `translateX(${atual.offsetLeft}px)`;
      } else {
        realce.style.height = `${atual.offsetHeight}px`;
        realce.style.transform = `translateY(${atual.offsetTop}px)`;
      }
    }
  }

  function ir(nome) {
    if (!TELAS.includes(nome)) nome = 'painel';
    fecharTudo();
    for (const t of $$('[data-tela]')) t.hidden = t.dataset.tela !== nome;
    const tela = $(`[data-tela="${nome}"]`);
    tela.classList.remove('entra');
    void tela.offsetWidth;
    tela.classList.add('entra');

    const secao = nome === 'area' ? 'canais' : nome;
    for (const a of $$('[data-nav] a')) {
      if (a.dataset.ir === secao) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    moverRealce();
    palco.scrollTop = 0;
    try { history.replaceState(null, '', `#${nome}`); } catch { /* sem histórico, sem problema */ }
    if (nome === 'painel') desenharPainel(false);
    if (nome === 'analises') desenharAnalises(false);
    if (nome === 'area') desenharArea();
  }

  document.addEventListener('click', (ev) => {
    const alvo = ev.target.closest('[data-ir]');
    if (!alvo) return;
    ev.preventDefault();
    ir(alvo.dataset.ir);
  });

  // ═══════════════════════ painel ═══════════════════════
  let periodo = '24h';

  function tetoRedondo(maior) {
    const grandeza = 10 ** Math.floor(Math.log10(Math.max(maior, 1)));
    const passo = grandeza / 5;
    return Math.ceil(maior / passo) * passo;
  }

  function contar(el, ate, animar) {
    if (!el) return;
    if (!animar || calmo) {
      el.textContent = numero.format(ate);
      return;
    }
    const inicio = performance.now();
    const passo = (agora) => {
      const p = Math.min(1, (agora - inicio) / 520);
      el.textContent = numero.format(Math.round(ate * (1 - (1 - p) ** 3)));
      if (p < 1) requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  }

  function desenharPainel(animar) {
    const d = PERIODOS[periodo];
    const total = soma(d.total);
    const nc = soma(d.nc);
    const na = soma(d.na);
    const ok = total - nc - na;
    const pct = (v) => Math.round((v / total) * 100);

    contar($('[data-kpi="total"]'), total, animar);
    contar($('[data-kpi="okp"]'), pct(ok), animar);
    contar($('[data-kpi="nc"]'), nc, animar);
    contar($('[data-kpi="nap"]'), pct(na), animar);
    $('[data-kpi-pe="total"]').textContent = `${numero.format(Math.floor(total / d.total.length))} ${d.unidade}`;
    $('[data-kpi-pe="ok"]').textContent = `${numero.format(ok)} análises`;
    $('[data-kpi-pe="nc"]').textContent = `${pct(nc)}% das análises`;
    $('[data-kpi-pe="na"]').textContent = `${numero.format(na)} análises`;

    // gráfico
    const teto = tetoRedondo(Math.max(...d.total));
    $('[data-grafico-titulo]').textContent = d.titulo;
    $('[data-eixo-y]').innerHTML = [teto, teto / 2, 0].map((v) => `<span>${numero.format(v)}</span>`).join('');
    const barras = $('[data-barras]');
    areaDasBarras.style.setProperty('--vao', d.total.length > 12 ? '3px' : 'clamp(8px, 3%, 28px)');
    barras.setAttribute(
      'aria-label',
      `${d.titulo}: ${numero.format(total)} análises, ${numero.format(nc)} fora do critério e ${numero.format(na)} que não deu para avaliar.`,
    );
    barras.innerHTML = d.total
      .map((t, i) => {
        const bom = t - d.nc[i] - d.na[i];
        const altura = (t / teto) * 100;
        return (
          `<div class="barra-col" data-i="${i}" style="height:${altura}%;animation-delay:${i * 14}ms">` +
          `<i class="cor-nc" style="flex:${d.nc[i]} 1 0"></i>` +
          `<i class="cor-na" style="flex:${d.na[i]} 1 0"></i>` +
          `<i class="cor-ok" style="flex:${bom} 1 0"></i></div>`
        );
      })
      .join('');
    $('[data-eixo-x]').innerHTML = d.rotulos
      .map((r, i) => `<span>${d.mostrar(i) ? r : ''}</span>`)
      .join('');

    // tabela, do que mais ficou fora do critério para o que menos ficou
    const linhas = [...d.linhas].sort((a, b) => b[3] - a[3] || b[4] - a[4]);
    $('[data-resultados]').innerHTML = linhas
      .map(([crit, canal, bom, fora, sem, conf, tempo, ultima, sinal]) => {
        const t = bom + fora + sem;
        const p = (v) => (v / t) * 100;
        const marca = sinal
          ? `<span class="chip ${sinal === 'sem imagem' ? 'critico' : 'atencao'}">${sinal}</span>`
          : '';
        return (
          `<tr><td class="inteira"><span class="crit">${crit}</span></td>` +
          `<td data-r="Canal"><span class="caminho"><span class="chip vazado">${icone('cctv')}${canal}</span>${marca}</span></td>` +
          `<td class="inteira" data-r="Conforme"><div class="prop"><span class="fita">` +
          `<i class="cor-nc" style="width:${p(fora)}%"></i><i class="cor-na" style="width:${p(sem)}%"></i><i class="cor-ok" style="width:${p(bom)}%"></i>` +
          `</span><b>${Math.round(p(bom))}%</b></div></td>` +
          `<td class="num-col" data-r="Análises">${numero.format(t)}</td>` +
          `<td class="num-col" data-r="Fora do critério">${numero.format(fora)}</td>` +
          `<td class="num-col" data-r="Não avaliou">${numero.format(sem)}</td>` +
          `<td class="num-col" data-r="Confiança média">${conf}</td>` +
          `<td class="num-col" data-r="Tempo médio">${tempo}</td>` +
          `<td class="num-col" data-r="Última análise">${ultima}</td></tr>`
        );
      })
      .join('');
  }

  for (const b of $$('[data-periodo]')) {
    b.addEventListener('click', () => {
      periodo = b.dataset.periodo;
      for (const o of $$('[data-periodo]')) o.setAttribute('aria-pressed', String(o === b));
      desenharPainel(true);
    });
  }

  // dica do gráfico
  const dica = $('[data-dica]');
  const areaDasBarras = $('.barras-area');
  areaDasBarras.addEventListener('pointermove', (ev) => {
    const col = ev.target.closest('.barra-col');
    if (!col) {
      dica.hidden = true;
      return;
    }
    const d = PERIODOS[periodo];
    const i = Number(col.dataset.i);
    const bom = d.total[i] - d.nc[i] - d.na[i];
    dica.innerHTML =
      `<b>${d.rotulos[i]}</b> · ${numero.format(d.total[i])} análises<br>` +
      `${numero.format(bom)} conforme · ${numero.format(d.nc[i])} fora · ${numero.format(d.na[i])} sem avaliar`;
    dica.hidden = false;
    const base = areaDasBarras.getBoundingClientRect();
    const c = col.getBoundingClientRect();
    const meio = c.left + c.width / 2 - base.left;
    const metade = dica.offsetWidth / 2;
    dica.style.left = `${Math.min(Math.max(meio, metade), base.width - metade)}px`;
    dica.style.top = `${c.top - base.top - 8}px`;
  });
  areaDasBarras.addEventListener('pointerleave', () => { dica.hidden = true; });

  // ═══════════════════════ análises ═══════════════════════
  // O Painel responde "está tudo bem?". Esta tela responde "o que foi
  // julgado, onde, por quem e quanto custou" — e deixa recortar por período,
  // hora, canal, critério e por onde a análise foi feita.
  //
  // Dados inventados, mas com a forma e a ordem de grandeza dos de verdade:
  // por critério, canal (e área) e hora — quantas análises, no que deram,
  // onde foram julgadas, quanto tempo levaram e quanto custaram. A partida é
  // uma loja real numa noite: ~110 análises por hora por critério julgado na
  // loja (0,09 s, sem custo) e ~45 por critério julgado na nuvem (2,1 s,
  // 1,3 centavo cada).

  const AN_HOJE = Date.UTC(2026, 9, 7); // quarta, 07/10/2026 — o "agora" do protótipo
  const AN_AGORA_MIN = 21 * 60 + 40;
  const AN_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

  const AN_CANAIS = [
    { id: 'bal', nome: 'Balcão', num: '01' },
    { id: 'cx', nome: 'Caixa', num: 'IP' },
    { id: 'chp', nome: 'Chapa', num: '03' },
    { id: 'm1', nome: 'Montagem 1', num: '04' },
    { id: 'm2', nome: 'Montagem 2', num: '05' },
    { id: 'fri', nome: 'Fritadeira', num: '06' },
  ];

  // `quando`: 'aberta' é conferido com a loja aberta; 'fechada', com ela
  // fechada. `ritmo` é quantas análises por hora cheia; `fora` e `na`, a
  // parte que fica fora do critério e a que não dá para avaliar.
  const AN_SERIES = [
    { crit: 'posto', canal: 'bal', area: 'Dentro do balcão', onde: 'loja', quando: 'aberta', ritmo: 112, fora: 0.07, na: 0 },
    { crit: 'fila', canal: 'bal', area: 'Lado do cliente', onde: 'loja', quando: 'aberta', ritmo: 112, fora: 0.03, na: 0 },
    { crit: 'vazio', canal: 'cx', onde: 'loja', quando: 'fechada', ritmo: 118, fora: 0.002, na: 0 },
    { crit: 'chapa', canal: 'chp', onde: 'loja', quando: 'aberta', ritmo: 110, fora: 0.05, na: 0 },
    { crit: 'touca', canal: 'chp', onde: 'nuvem', quando: 'aberta', ritmo: 44, fora: 0.01, na: 0.05 },
    { crit: 'touca', canal: 'm1', onde: 'nuvem', quando: 'aberta', ritmo: 46, fora: 0.02, na: 0.52 },
    { crit: 'touca', canal: 'm2', onde: 'nuvem', quando: 'aberta', ritmo: 45, fora: 0.02, na: 0.4 },
    { crit: 'bancada', canal: 'm1', onde: 'nuvem', quando: 'aberta', ritmo: 52, fora: 0.07, na: 0.01 },
    { crit: 'bancada', canal: 'm2', onde: 'nuvem', quando: 'aberta', ritmo: 50, fora: 0.05, na: 0.01 },
    // Hoje a Fritadeira está sem imagem (o Painel avisa): nada foi julgado.
    { crit: 'cesto', canal: 'fri', onde: 'nuvem', quando: 'aberta', ritmo: 30, fora: 0.01, na: 0.02, paradoHoje: true },
  ];

  const AN_MOTIVOS = {
    posto: ['Nenhuma pessoa atrás do balcão.', 'O balcão ficou sem atendente.'],
    fila: ['8 pessoas na área do balcão; o combinado é no máximo 6.', '7 pessoas esperando do lado do cliente.'],
    vazio: ['Uma pessoa na área do caixa com a loja fechada.'],
    chapa: ['Nenhuma pessoa na área da chapa.'],
    touca: ['Uma pessoa na área de preparo sem touca nem boné.', 'Cabelo descoberto na bancada.'],
    bancada: ['Restos de alimento e embalagem aberta no canto direito da bancada.', 'Utensílio sujo sobre a superfície de trabalho.'],
    cesto: ['Cesto dentro do óleo sem fritura em andamento.'],
  };

  const reais = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const reaisFinos = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const dinheiro = (centavos) => reais.format(centavos / 100);
  const hh = (h) => `${String(h).padStart(2, '0')}h`;

  // Um número entre 0 e 1 que depende só das entradas: o protótipo mostra
  // sempre os mesmos dados, e as somas fecham de uma tela para a outra.
  function sorte(a, b, c, d = 0) {
    let x = Math.imul(a + 1, 73856093) ^ Math.imul(b + 1, 19349663) ^ Math.imul(c + 1, 83492791) ^ Math.imul(d + 1, 2654435761);
    x = Math.imul(x ^ (x >>> 15), 2246822507);
    x = Math.imul(x ^ (x >>> 13), 3266489909);
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
  }

  const minutos = (texto) => Number(texto.slice(0, 2)) * 60 + Number(texto.slice(3, 5));
  /** O dia `d` (0 = hoje, 1 = ontem…) no índice do horário da loja (0 = segunda). */
  const diaDaSemana = (d) => (((2 - d) % 7) + 7) % 7;

  /** Quantos minutos da hora `h` do dia `d` a loja ficou aberta. */
  function minutosAberta(d, h) {
    let total = 0;
    const ini = h * 60;
    const fim = ini + 60;
    const dentro = (a, b) => Math.max(0, Math.min(fim, b) - Math.max(ini, a));
    const hoje = HORARIO[diaDaSemana(d)];
    if (hoje.abre) {
      const abre = minutos(hoje.ini);
      const fecha = minutos(hoje.fim);
      total += fecha > abre ? dentro(abre, fecha) : dentro(abre, 1440);
    }
    // a madrugada pertence ao dia em que a loja abriu
    const ontem = HORARIO[diaDaSemana(d + 1)];
    if (ontem.abre && minutos(ontem.fim) <= minutos(ontem.ini)) total += dentro(0, minutos(ontem.fim));
    return Math.min(60, total);
  }

  // O movimento pesa no que fica fora do critério: no pico erra-se mais.
  const pico = (h) => 0.55 + 0.9 * Math.exp(-(((h - 20.5) / 1.6) ** 2));

  const AN_DIAS = new Map();
  /** As células do dia `d`: uma por série e hora em que houve análise. */
  function celulasDoDia(d) {
    if (AN_DIAS.has(d)) return AN_DIAS.get(d);
    const celulas = [];
    AN_SERIES.forEach((s, si) => {
      if (d === 0 && s.paradoHoje) return;
      for (let h = 0; h < 24; h += 1) {
        // hoje só existe até agora
        const visto = d === 0 ? Math.max(0, Math.min(60, AN_AGORA_MIN - h * 60)) : 60;
        if (visto === 0) continue;
        const aberta = Math.min(minutosAberta(d, h), visto);
        const ativos = s.quando === 'aberta' ? aberta : visto - aberta;
        if (ativos <= 0) continue;
        const n = Math.round(s.ritmo * (ativos / 60) * (0.92 + 0.16 * sorte(d, si, h, 1)));
        if (n === 0) continue;
        const fora = Math.min(n, Math.round(n * s.fora * pico(h) * (0.5 + sorte(d, si, h, 2))));
        const na = Math.min(n - fora, Math.round(n * s.na * (0.85 + 0.3 * sorte(d, si, h, 3))));
        const nuvem = s.onde === 'nuvem';
        celulas.push({
          d, si, h, n, fora, na, ok: n - fora - na, ativos,
          // Na hora em que a loja fecha, a parte aberta vem primeiro: o
          // critério da loja fechada começa a valer depois dela.
          comeca: s.quando === 'fechada' ? aberta : 0,
          custo: nuvem ? n * (1.25 + 0.12 * sorte(d, si, h, 4)) : 0,
          ms: n * (nuvem ? 2000 + 250 * sorte(d, si, h, 5) : 88 + 10 * sorte(d, si, h, 5)),
        });
      }
    });
    AN_DIAS.set(d, celulas);
    return celulas;
  }

  const an = { periodo: 'hoje', dia: '2026-10-05', de: 0, ate: 24, canal: '', crit: '', onde: 'tudo', vista: 'resultado' };
  const AN_PADRAO = { ...an };

  function diasDoRecorte() {
    if (an.periodo === 'hoje') return [0];
    if (an.periodo === 'ontem') return [1];
    if (an.periodo === '7d') return [6, 5, 4, 3, 2, 1, 0];
    const [a, m, dd] = an.dia.split('-').map(Number);
    return [Math.max(0, Math.round((AN_HOJE - Date.UTC(a, m - 1, dd)) / 86400000))];
  }

  function rotuloDoDia(d, comMes = true) {
    const data = new Date(AN_HOJE - d * 86400000);
    const dia = String(data.getUTCDate()).padStart(2, '0');
    const mes = String(data.getUTCMonth() + 1).padStart(2, '0');
    return `${AN_SEMANA[data.getUTCDay()]} ${dia}${comMes ? `/${mes}` : ''}`;
  }

  /** As células do recorte. `menos` deixa de fora um filtro: o gráfico de
   *  horas mostra o dia inteiro, e a lista de canais mostra todos. */
  function celulasDoRecorte(menos = '') {
    return diasDoRecorte()
      .flatMap(celulasDoDia)
      .filter((c) => {
        const s = AN_SERIES[c.si];
        if (menos !== 'horas' && (c.h < an.de || c.h >= an.ate)) return false;
        if (menos !== 'canal' && an.canal && s.canal !== an.canal) return false;
        if (an.crit && s.crit !== an.crit) return false;
        if (an.onde !== 'tudo' && s.onde !== an.onde) return false;
        return true;
      });
  }

  function somar(celulas) {
    const t = { n: 0, ok: 0, fora: 0, na: 0, loja: 0, nuvem: 0, custo: 0, ms: 0 };
    for (const c of celulas) {
      t.n += c.n; t.ok += c.ok; t.fora += c.fora; t.na += c.na; t.custo += c.custo; t.ms += c.ms;
      if (AN_SERIES[c.si].onde === 'nuvem') t.nuvem += c.n;
      else t.loja += c.n;
    }
    return t;
  }

  const porcento = (parte, todo) => (todo ? Math.round((parte / todo) * 100) : 0);
  const segundos = (ms) => {
    const s = ms / 1000;
    return `${s < 1 ? s.toFixed(2) : s.toFixed(1)} s`.replace('.', ',');
  };

  /** Os pedaços de uma barra, de baixo para cima, conforme o que o gráfico mostra. */
  function pedacos(t) {
    if (an.vista === 'onde') return [['cor-loja', t.loja], ['cor-nuvem', t.nuvem]];
    if (an.vista === 'custo') return [['cor-nuvem', t.custo]];
    return [['cor-nc', t.fora], ['cor-na', t.na], ['cor-ok', t.ok]];
  }
  const tamanho = (t) => (an.vista === 'custo' ? t.custo : t.n);

  function fraseDoRecorte(total) {
    const dias = diasDoRecorte();
    const periodo =
      an.periodo === 'hoje' ? `Hoje, ${rotuloDoDia(0)}`
      : an.periodo === 'ontem' ? `Ontem, ${rotuloDoDia(1)}`
      : an.periodo === '7d' ? `Últimos 7 dias, de ${rotuloDoDia(6)} a ${rotuloDoDia(0)}`
      : rotuloDoDia(dias[0]);
    const horas = an.de === 0 && an.ate === 24 ? 'o dia inteiro' : `das ${hh(an.de)} às ${hh(an.ate)}`;
    const canal = an.canal ? AN_CANAIS.find((c) => c.id === an.canal).nome : 'todos os canais';
    const crit = an.crit ? `“${CRITERIOS[an.crit].nome}”` : 'todos os critérios';
    const onde = an.onde === 'loja' ? 'só o que foi julgado na loja' : an.onde === 'nuvem' ? 'só o que foi julgado na nuvem' : 'na loja e na nuvem';
    return `<b>${periodo}</b>, ${horas} · <b>${canal}</b> · ${crit} · ${onde} — ${plural(total, 'análise', 'análises').replace(String(total), numero.format(total))}`;
  }

  function desenharAnalises(animar) {
    const umDia = an.periodo !== '7d';
    const recorte = celulasDoRecorte();
    const t = somar(recorte);

    // ── os controles espelham o estado ──
    for (const b of $$('[data-an-periodo]')) b.setAttribute('aria-pressed', String(b.dataset.anPeriodo === an.periodo));
    for (const b of $$('[data-an-onde]')) b.setAttribute('aria-pressed', String(b.dataset.anOnde === an.onde));
    for (const b of $$('[data-an-vista]')) b.setAttribute('aria-pressed', String(b.dataset.anVista === an.vista));
    $('[data-an-campo-dia]').hidden = an.periodo !== 'dia';
    $('#an-dia').value = an.dia;
    $('#an-de').value = String(an.de);
    $('#an-ate').value = String(an.ate);
    $('#an-canal').value = an.canal;
    $('#an-criterio').value = an.crit;

    $('[data-an-recorte]').innerHTML = fraseDoRecorte(t.n);
    const mexeu = ['periodo', 'de', 'ate', 'canal', 'crit', 'onde'].some((k) => an[k] !== AN_PADRAO[k]);
    for (const b of $$('[data-an-limpar]')) b.hidden = !mexeu;

    // ── o gráfico de horas (ou de dias) aparece sempre: é por ele que se
    //    sai de um recorte vazio ──
    const oDiaInteiro = umDia ? celulasDoRecorte('horas') : [];
    const baldes = umDia
      ? Array.from({ length: 24 }, (_, h) => ({ rotulo: hh(h), mostra: h % 3 === 0, h, t: somar(oDiaInteiro.filter((c) => c.h === h)) }))
      : diasDoRecorte().map((d) => ({ rotulo: rotuloDoDia(d, false), mostra: true, d, t: somar(recorte.filter((c) => c.d === d)) }));
    const maior = Math.max(...baldes.map((b) => tamanho(b.t)), an.vista === 'custo' ? 100 : 10);
    const teto = tetoRedondo(maior);
    const eixo = (v) => (an.vista === 'custo' ? dinheiro(v) : numero.format(v));
    $('[data-an-grafico-titulo]').textContent = umDia ? 'Hora a hora' : 'Dia a dia';
    $('[data-an-eixo-y]').innerHTML = [teto, teto / 2, 0].map((v) => `<span>${eixo(v)}</span>`).join('');
    $('[data-an-legenda]').innerHTML =
      an.vista === 'onde' ? '<span><i class="cor-loja"></i>julgado na loja</span><span><i class="cor-nuvem"></i>julgado na nuvem</span>'
      : an.vista === 'custo' ? '<span><i class="cor-nuvem"></i>custo estimado das análises na nuvem</span>'
      : '<span><i class="cor-ok"></i>conforme</span><span><i class="cor-nc"></i>fora do critério</span><span><i class="cor-na"></i>não avaliou</span>';
    const area = $('[data-an-area]');
    area.style.setProperty('--vao', umDia ? '3px' : 'clamp(8px, 3%, 28px)');
    const umaHora = umDia && an.ate - an.de === 1;
    $('[data-an-barras]').innerHTML = baldes
      .map((b, i) => {
        const dentro = !umDia || (b.h >= an.de && b.h < an.ate);
        const marcada = umaHora && b.h === an.de;
        const altura = (tamanho(b.t) / teto) * 100;
        const leitura =
          `${b.rotulo}: ${plural(b.t.n, 'análise', 'análises')}, ${b.t.ok} conforme, ${b.t.fora} fora do critério, ${b.t.na} sem avaliar; ` +
          `${b.t.loja} na loja e ${b.t.nuvem} na nuvem; custo ${dinheiro(b.t.custo)}. ` +
          (umDia ? (marcada ? 'Hora selecionada: toque para voltar ao dia inteiro.' : 'Toque para ver só esta hora.') : 'Toque para abrir este dia.');
        return (
          `<button type="button" class="col${dentro ? '' : ' apagada'}${b.t.n ? '' : ' vazia'}" data-i="${i}" ` +
          `aria-pressed="${marcada}" aria-label="${leitura}">` +
          `<span class="barra-col" style="height:${altura}%;animation-delay:${i * 14}ms">` +
          pedacos(b.t).map(([cor, v]) => `<i class="${cor}" style="flex:${v} 1 0"></i>`).join('') +
          `</span></button>`
        );
      })
      .join('');
    $('[data-an-eixo-x]').innerHTML = baldes.map((b) => `<span>${b.mostra ? b.rotulo : ''}</span>`).join('');
    $('[data-an-grafico-nota]').textContent = umDia
      ? (umaHora ? `Mostrando só das ${hh(an.de)} às ${hh(an.ate)}. Toque na mesma barra para voltar ao dia inteiro.` : 'Toque numa barra para ver só aquela hora.')
      : 'Toque num dia para abri-lo hora a hora.';
    an.baldes = baldes;

    // ── com ou sem dado: os números, a tabela e as ocorrências somem; o
    //    gráfico e os canais ficam ──
    const semDado = t.n === 0;
    for (const el of $$('[data-an-so-com-dado]')) el.hidden = semDado;
    $('[data-an-sem-dado]').hidden = !semDado;

    // ── os números ──
    const horasComAnalise = new Set(recorte.map((c) => `${c.d}-${c.h}`)).size || 1;
    const horasComNuvem = new Set(recorte.filter((c) => c.custo > 0).map((c) => `${c.d}-${c.h}`)).size || 1;
    contar($('[data-an="total"]'), t.n, animar);
    contar($('[data-an="okp"]'), porcento(t.ok, t.n), animar);
    contar($('[data-an="nc"]'), t.fora, animar);
    contar($('[data-an="nap"]'), porcento(t.na, t.n), animar);
    $('[data-an="total-pe"]').textContent = `${numero.format(Math.round(t.n / horasComAnalise))} por hora, em média`;
    $('[data-an="ok-pe"]').textContent = `${numero.format(t.ok)} análises`;
    $('[data-an="nc-pe"]').textContent = `${porcento(t.fora, t.n)}% das análises`;
    $('[data-an="na-pe"]').textContent = `${numero.format(t.na)} análises`;
    const divide = $('[data-an="divide"]');
    divide.innerHTML = `<i class="cor-loja" style="flex:${t.loja} 1 0"></i><i class="cor-nuvem" style="flex:${t.nuvem} 1 0"></i>`;
    divide.setAttribute('aria-label', `${porcento(t.loja, t.n)}% na loja e ${porcento(t.nuvem, t.n)}% na nuvem`);
    $('[data-an="onde-pe"]').innerHTML =
      `<span><b>${numero.format(t.loja)}</b> na loja (${porcento(t.loja, t.n)}%)</span><span><b>${numero.format(t.nuvem)}</b> na nuvem (${porcento(t.nuvem, t.n)}%)</span>`;
    $('[data-an="custo"]').textContent = dinheiro(t.custo);
    $('[data-an="custo-pe"]').innerHTML = t.nuvem
      ? `<span>${reaisFinos.format(t.custo / t.nuvem / 100)} por análise</span><span>${dinheiro(t.custo / horasComNuvem)} por hora</span>`
      : 'nenhuma análise na nuvem neste recorte';

    // ── por canal: todos os canais, mesmo com um escolhido ──
    const semCanal = celulasDoRecorte('canal');
    const canais = AN_CANAIS.map((c) => ({ ...c, t: somar(semCanal.filter((x) => AN_SERIES[x.si].canal === c.id)) }));
    const maiorCanal = Math.max(...canais.map((c) => tamanho(c.t)), 1);
    $('[data-an-canais]').innerHTML = canais
      .map((c) => {
        const valor =
          an.vista === 'custo' ? dinheiro(c.t.custo)
          : an.vista === 'onde' ? `${numero.format(c.t.loja)} loja · ${numero.format(c.t.nuvem)} nuvem`
          : `${numero.format(c.t.n)} · ${numero.format(c.t.fora)} fora`;
        return (
          `<li><button type="button" class="canal-linha" data-an-canal-linha="${c.id}" aria-pressed="${an.canal === c.id}">` +
          `<span class="cl-nome"><span class="canal-num">${c.num}</span><span>${c.nome}</span></span>` +
          `<span class="cl-num">${c.t.n ? valor : 'sem análise'}</span>` +
          `<span class="trilho"><span class="fita" style="width:${(tamanho(c.t) / maiorCanal) * 100}%">` +
          pedacos(c.t).map(([cor, v]) => `<i class="${cor}" style="flex:${v} 1 0"></i>`).join('') +
          `</span></span></button></li>`
        );
      })
      .join('');

    // ── por critério e canal ──
    const grupos = new Map();
    for (const c of recorte) {
      if (!grupos.has(c.si)) grupos.set(c.si, []);
      grupos.get(c.si).push(c);
    }
    const linhas = [...grupos.entries()]
      .map(([si, cs]) => ({ s: AN_SERIES[si], t: somar(cs) }))
      .sort((a, b) => b.t.fora - a.t.fora || b.t.na - a.t.na || b.t.n - a.t.n);
    const fita = (x) =>
      `<div class="prop"><span class="fita"><i class="cor-nc" style="width:${(x.fora / x.n) * 100}%"></i>` +
      `<i class="cor-na" style="width:${(x.na / x.n) * 100}%"></i><i class="cor-ok" style="width:${(x.ok / x.n) * 100}%"></i></span>` +
      `<b>${porcento(x.ok, x.n)}%</b></div>`;
    $('[data-an-linhas]').innerHTML = linhas
      .map(({ s, t: x }) => {
        const canal = AN_CANAIS.find((c) => c.id === s.canal);
        const nuvem = s.onde === 'nuvem';
        return (
          `<tr><td class="inteira"><span class="crit">${CRITERIOS[s.crit].nome}</span></td>` +
          `<td class="inteira" data-r="Canal"><span class="chip vazado">${icone('cctv')}${canal.nome}${s.area ? ` · ${s.area}` : ''}</span></td>` +
          `<td class="inteira" data-r="Onde julga"><span class="chip ${nuvem ? 'atencao' : ''}">${icone(nuvem ? 'cloud' : 'cpu')}${nuvem ? 'na nuvem' : 'na loja'}</span></td>` +
          `<td class="inteira" data-r="Conforme">${fita(x)}</td>` +
          `<td class="num-col" data-r="Análises">${numero.format(x.n)}</td>` +
          `<td class="num-col" data-r="Fora do critério">${numero.format(x.fora)}</td>` +
          `<td class="num-col" data-r="Não avaliou">${numero.format(x.na)}</td>` +
          `<td class="num-col" data-r="Tempo médio">${segundos(x.ms / x.n)}</td>` +
          `<td class="num-col" data-r="Custo">${nuvem ? dinheiro(x.custo) : '—'}</td>` +
          `<td class="num-col" data-r="Custo por análise">${nuvem ? reaisFinos.format(x.custo / x.n / 100) : '—'}</td></tr>`
        );
      })
      .join('');
    $('[data-an-rodape]').innerHTML = semDado
      ? ''
      : `<tr><td class="inteira">Total do recorte</td><td></td><td></td>` +
        `<td class="inteira" data-r="Conforme">${fita(t)}</td>` +
        `<td class="num-col" data-r="Análises">${numero.format(t.n)}</td>` +
        `<td class="num-col" data-r="Fora do critério">${numero.format(t.fora)}</td>` +
        `<td class="num-col" data-r="Não avaliou">${numero.format(t.na)}</td>` +
        `<td class="num-col" data-r="Tempo médio">${segundos(t.ms / t.n)}</td>` +
        `<td class="num-col" data-r="Custo">${dinheiro(t.custo)}</td>` +
        `<td class="num-col" data-r="Custo por análise na nuvem">${t.nuvem ? reaisFinos.format(t.custo / t.nuvem / 100) : '—'}</td></tr>`;

    // ── as últimas vezes fora do critério, dentro do recorte ──
    const vezes = [];
    const dias = [...diasDoRecorte()].sort((a, b) => a - b); // do mais recente para trás
    busca: for (const d of dias) {
      for (let h = 23; h >= 0; h -= 1) {
        const daHora = [];
        for (const c of recorte) {
          if (c.d !== d || c.h !== h) continue;
          for (let j = 0; j < c.fora; j += 1) {
            daHora.push({ c, minuto: c.comeca + Math.floor(sorte(d, c.si, h, 20 + j) * c.ativos), j });
          }
        }
        daHora.sort((a, b) => b.minuto - a.minuto);
        for (const v of daHora) {
          vezes.push(v);
          if (vezes.length === 6) break busca;
        }
      }
    }
    $('[data-an-fora-conta]').textContent = numero.format(t.fora);
    $('[data-an-fora]').innerHTML = vezes.length
      ? vezes
          .map(({ c, minuto, j }) => {
            const s = AN_SERIES[c.si];
            const canal = AN_CANAIS.find((x) => x.id === s.canal);
            const frases = AN_MOTIVOS[s.crit];
            const hora = `${String(c.h).padStart(2, '0')}:${String(Math.min(59, minuto)).padStart(2, '0')}`;
            const r = sorte(c.d, c.si, c.h, 40 + j);
            const aviso =
              r < 0.6 ? `<span class="chip ok">${icone('check-check')}aviso chegou</span>`
              : r < 0.8 ? `<span class="chip atencao">${icone('send')}aviso mandado</span>`
              : `<span class="chip">${icone('bell-off')}em silêncio</span>`;
            const nuvem = s.onde === 'nuvem';
            return (
              `<li><time datetime="${hora}">${umDia ? '' : `${rotuloDoDia(c.d, false)} · `}${hora}</time>` +
              `<div><div class="o-titulo">${CRITERIOS[s.crit].nome} ` +
              `<span class="chip vazado">${icone('cctv')}${canal.nome}${s.area ? ` · ${s.area}` : ''}</span>` +
              `<span class="chip ${nuvem ? 'atencao' : ''}">${icone(nuvem ? 'cloud' : 'cpu')}${nuvem ? 'na nuvem' : 'na loja'}</span></div>` +
              `<p>${frases[Math.floor(sorte(c.d, c.si, c.h, 60 + j) * frases.length)]}</p></div>` +
              `<div class="o-fim">${aviso}<span class="mono suave">confiança ${(0.72 + 0.23 * sorte(c.d, c.si, c.h, 80 + j)).toFixed(2).replace('.', ',')}</span></div></li>`
            );
          })
          .join('') +
        (t.fora > vezes.length ? `<li class="mais"><span></span><p>e mais ${numero.format(t.fora - vezes.length)} neste recorte.</p><span></span></li>` : '')
      : '<li class="mais"><span></span><p>Nada ficou fora do critério neste recorte.</p><span></span></li>';
  }

  // os seletores de hora, canal e critério
  $('#an-de').innerHTML = Array.from({ length: 24 }, (_, h) => `<option value="${h}">${hh(h)}</option>`).join('');
  $('#an-ate').innerHTML = Array.from({ length: 24 }, (_, i) => `<option value="${i + 1}">${hh(i + 1)}</option>`).join('');
  $('#an-canal').innerHTML =
    '<option value="">Todos os canais</option>' + AN_CANAIS.map((c) => `<option value="${c.id}">${c.num} · ${c.nome}</option>`).join('');
  $('#an-criterio').innerHTML =
    '<option value="">Todos os critérios</option>' +
    [...new Set(AN_SERIES.map((s) => s.crit))].map((k) => `<option value="${k}">${CRITERIOS[k].nome}</option>`).join('');

  for (const b of $$('[data-an-periodo]')) b.addEventListener('click', () => { an.periodo = b.dataset.anPeriodo; desenharAnalises(true); });
  for (const b of $$('[data-an-onde]')) b.addEventListener('click', () => { an.onde = b.dataset.anOnde; desenharAnalises(true); });
  for (const b of $$('[data-an-vista]')) b.addEventListener('click', () => { an.vista = b.dataset.anVista; desenharAnalises(false); });
  $('#an-dia').addEventListener('change', (ev) => { if (ev.target.value) an.dia = ev.target.value; desenharAnalises(true); });
  // "das 20h às 18h" não existe: quem mexe numa ponta empurra a outra.
  $('#an-de').addEventListener('change', (ev) => {
    an.de = Number(ev.target.value);
    if (an.ate <= an.de) an.ate = an.de + 1;
    desenharAnalises(true);
  });
  $('#an-ate').addEventListener('change', (ev) => {
    an.ate = Number(ev.target.value);
    if (an.de >= an.ate) an.de = an.ate - 1;
    desenharAnalises(true);
  });
  $('#an-canal').addEventListener('change', (ev) => { an.canal = ev.target.value; desenharAnalises(true); });
  $('#an-criterio').addEventListener('change', (ev) => { an.crit = ev.target.value; desenharAnalises(true); });
  for (const b of $$('[data-an-limpar]')) {
    b.addEventListener('click', () => {
      Object.assign(an, AN_PADRAO, { vista: an.vista });
      desenharAnalises(true);
      avisar('Filtros limpos: hoje, o dia inteiro, todos os canais.');
    });
  }

  // O gráfico também é filtro: tocar numa hora mostra só ela; num dia, abre o dia.
  $('[data-an-barras]').addEventListener('click', (ev) => {
    const col = ev.target.closest('.col');
    if (!col) return;
    const b = an.baldes[Number(col.dataset.i)];
    if (b.h !== undefined) {
      const jaEra = an.de === b.h && an.ate === b.h + 1;
      an.de = jaEra ? 0 : b.h;
      an.ate = jaEra ? 24 : b.h + 1;
    } else if (b.d === 0) an.periodo = 'hoje';
    else if (b.d === 1) an.periodo = 'ontem';
    else {
      an.periodo = 'dia';
      an.dia = new Date(AN_HOJE - b.d * 86400000).toISOString().slice(0, 10);
    }
    desenharAnalises(true);
    // o desenho refaz as barras: o foco volta para a mesma coluna
    if (b.h !== undefined) $(`[data-an-barras] .col[data-i="${b.h}"]`)?.focus({ preventScroll: true });
  });
  $('[data-an-canais]').addEventListener('click', (ev) => {
    const linha = ev.target.closest('[data-an-canal-linha]');
    if (!linha) return;
    const id = linha.dataset.anCanalLinha;
    an.canal = an.canal === id ? '' : id;
    desenharAnalises(true);
    $(`[data-an-canal-linha="${id}"]`)?.focus({ preventScroll: true });
  });

  // a dica do gráfico, no ponteiro e no teclado
  const anDica = $('[data-an-dica]');
  const anArea = $('[data-an-area]');
  function mostrarDicaDaAnalise(col) {
    if (!col) {
      anDica.hidden = true;
      return;
    }
    const b = an.baldes[Number(col.dataset.i)];
    const t = b.t;
    anDica.innerHTML =
      `<b>${b.rotulo}</b> · ${plural(t.n, 'análise', 'análises').replace(String(t.n), numero.format(t.n))}<br>` +
      (an.vista === 'onde'
        ? `${numero.format(t.loja)} na loja · ${numero.format(t.nuvem)} na nuvem`
        : an.vista === 'custo'
          ? `${dinheiro(t.custo)} · ${numero.format(t.nuvem)} na nuvem${t.nuvem ? ` · ${reaisFinos.format(t.custo / t.nuvem / 100)} cada` : ''}`
          : `${numero.format(t.ok)} conforme · ${numero.format(t.fora)} fora · ${numero.format(t.na)} sem avaliar`);
    anDica.hidden = false;
    const base = anArea.getBoundingClientRect();
    const c = col.getBoundingClientRect();
    const barra = $('.barra-col', col).getBoundingClientRect();
    const meio = c.left + c.width / 2 - base.left;
    const metade = anDica.offsetWidth / 2;
    anDica.style.left = `${Math.min(Math.max(meio, metade), base.width - metade)}px`;
    anDica.style.top = `${Math.max(barra.top - base.top - 8, anDica.offsetHeight)}px`;
  }
  anArea.addEventListener('pointermove', (ev) => mostrarDicaDaAnalise(ev.target.closest('.col')));
  anArea.addEventListener('pointerleave', () => mostrarDicaDaAnalise(null));
  anArea.addEventListener('focusin', (ev) => mostrarDicaDaAnalise(ev.target.closest('.col')));
  anArea.addEventListener('focusout', () => mostrarDicaDaAnalise(null));

  // ═══════════════════════ critérios ═══════════════════════
  function cartaoDoCriterio(chave, canal) {
    const c = CRITERIOS[chave];
    const chips = [
      c.procura ? `<span class="chip ok" title="Julgado dentro da loja, sem internet">${c.procura}</span>` : '',
      c.falta ? `<span class="chip atencao">${icone('triangle-alert')}falta dizer o que procurar</span>` : '',
      `<span class="chip">${c.tipo}</span>`,
      `<span class="chip ${c.grave ? 'critico' : ''}">${c.gravidade}</span>`,
      c.canais > 1 ? `<span class="chip vazado" title="É um cadastro só: editar aqui muda em todos os canais">vale em ${c.canais} canais</span>` : '',
      // "No horário" é o comum e não leva etiqueta; o que foge dele, leva.
      c.quando === 'fora'
        ? `<span class="chip vazado" title="Só é conferido com a loja fechada">${icone('moon')}fora do horário</span>`
        : c.quando === 'sempre'
          ? `<span class="chip vazado" title="Conferido com a loja aberta ou fechada">${icone('clock')}sempre</span>`
          : '',
    ].join('');
    return (
      `<article class="criterio ${c.ligado ? '' : 'desligado'}" data-criterio="${chave}" data-nome="${c.nome}" data-canal="${canal}">` +
      `<span class="selo-ic">${icone(ICONE_DO_TIPO[c.tipo])}</span>` +
      `<div class="c-titulo"><b>${c.nome}</b>${chips}</div>` +
      `<div class="c-acoes">` +
      `<button class="liga" type="button" role="switch" aria-checked="${c.ligado}" data-liga-criterio="${chave}" aria-label="Critério ${c.nome}"><i></i><span>${c.ligado ? 'Ligado' : 'Desligado'}</span></button>` +
      `<button class="btn fantasma quadrado mini" type="button" data-menu="menu-criterio" data-so-config aria-haspopup="menu" aria-expanded="false" aria-label="Ações do critério ${c.nome}">${icone('ellipsis')}</button>` +
      `</div>` +
      `<p class="c-texto">${c.texto}</p><p class="c-meta">${c.meta}</p></article>`
    );
  }

  function desenharCriterios() {
    $('[data-arvore]').innerHTML = ARVORE.map((s, i) => {
      const distintos = new Set(s.canais.flatMap((c) => c.criterios));
      const canais = s.canais
        .map((c) => {
          const estado = c.pausado
            ? `<span class="chip atencao">pausado, não é verificado</span>`
            : c.semImagem
              ? `<span class="chip critico">${icone('video-off')}sem imagem</span>`
              : '';
          const corpo = c.areas
            ? c.areas
                .map(
                  (a) =>
                    `<div class="no-area"><div class="no-area-cab">${icone('crop', 'p')}<b>${a.nome}</b>` +
                    `<span>${a.criterios.length ? plural(a.criterios.length, 'critério', 'critérios') : 'sem critério'}</span>` +
                    `<button class="btn fantasma mini empurra" type="button" data-folha="folha-criterio" data-modo="novo" data-lugar="${c.nome}/${a.nome}" data-so-config>` +
                    `${icone('plus', 'p')}Critério<span class="so-leitor"> em ${a.nome}, ${c.nome}</span></button></div>` +
                    (a.criterios.length
                      ? a.criterios.map((k) => cartaoDoCriterio(k, c.nome)).join('')
                      : `<p class="vazio-linha">Nenhum critério nesta área. Nada é verificado nela.</p>`) +
                    `</div>`,
                )
                .join('')
            : c.criterios.length
              ? c.criterios.map((k) => cartaoDoCriterio(k, c.nome)).join('')
              : `<p class="vazio-linha">Nenhum critério neste canal. Nada é verificado aqui.</p>`;
          // Com áreas, o "+ Critério" fica em cada área: é ali que ele vai valer.
          const mais = c.pausado || c.areas
            ? ''
            : `<button class="btn fantasma mini empurra" type="button" data-folha="folha-criterio" data-modo="novo" data-so-config>${icone('plus', 'p')}Critério<span class="so-leitor"> em ${c.nome}</span></button>`;
          return (
            `<div class="no-canal"><div class="no-canal-cab"><span class="canal-num">${c.num}</span>` +
            `<b>${c.nome}</b><span>${c.areas ? `${plural(c.areas.length, 'área', 'áreas')} · ` : ''}${c.criterios.length ? plural(c.criterios.length, 'critério', 'critérios') : 'sem critério'}</span>${estado}${mais}</div>${corpo}</div>`
          );
        })
        .join('');
      return (
        `<section class="cartao"><button class="ramo-cab" type="button" data-dobra="ramo-${i}" aria-expanded="true">` +
        `${icone('chevron-right', 'seta')}${icone('folder')}<b>${s.setor}</b>` +
        `<span class="fim">${plural(s.canais.length, 'canal', 'canais')} · ${plural(distintos.size, 'critério', 'critérios')}</span></button>` +
        `<div class="dobra" id="ramo-${i}"><div><div class="ramo-corpo">${canais}</div></div></div></section>`
      );
    }).join('');
  }

  for (const b of $$('[data-filtro]')) {
    b.addEventListener('click', () => {
      for (const o of $$('[data-filtro]')) o.setAttribute('aria-pressed', String(o === b));
      const f = b.dataset.filtro;
      for (const c of $$('[data-tela="criterios"] .criterio')) {
        const ligado = !c.classList.contains('desligado');
        c.hidden = (f === 'ligados' && !ligado) || (f === 'desligados' && ligado);
      }
    });
  }

  // a árvore de "onde vale", dentro da gaveta do critério
  function desenharOndeVale(marcados = []) {
    const lista = $('[data-arv-canais]');
    lista.innerHTML = ARVORE.map((s, i) => {
      const filhos = s.canais
        .map((c, j) => {
          const id = `onde-${i}-${j}`;
          const pausado = c.pausado ? ' <span class="suave">· pausado, não é verificado</span>' : '';
          if (c.areas) {
            // Canal com mais de uma área: o critério vai para a ÁREA. Marcar
            // "o canal" não diria em qual delas ele vale.
            const areas = c.areas
              .map((a, k) => {
                const marcada = marcados.includes(`${c.nome}/${a.nome}`) ? 'checked' : '';
                return (
                  `<li><div class="linha"><input class="caixa" type="checkbox" id="${id}-${k}" data-area-caixa data-area="${a.nome}" ${marcada}>` +
                  `<label for="${id}-${k}">${a.nome}</label></div></li>`
                );
              })
              .join('');
            return (
              `<li data-canal-no data-canal="${c.nome}"><div class="linha"><span class="arv-canal-nome">${c.nome}${pausado}</span>` +
              `<span class="fim">${plural(c.areas.length, 'área', 'áreas')} · escolha onde</span></div><ul>${areas}</ul></li>`
            );
          }
          const marcado = marcados.includes(c.nome) ? 'checked' : '';
          return (
            `<li data-canal-no data-canal="${c.nome}"><div class="linha"><input class="caixa" type="checkbox" id="${id}" data-canal-caixa ${marcado}>` +
            `<label for="${id}">${c.nome}${pausado}</label></div></li>`
          );
        })
        .join('');
      return (
        `<li data-setor-no><div class="linha"><input class="caixa" type="checkbox" id="onde-${i}" data-setor-caixa>` +
        `<label for="onde-${i}"><b>${s.setor}</b></label><span class="fim" data-setor-conta></span></div><ul>${filhos}</ul></li>`
      );
    }).join('');
    atualizarOndeVale();
  }

  function atualizarOndeVale() {
    let total = 0;
    const emAreas = [];
    for (const no of $$('[data-setor-no]')) {
      const canais = $$('[data-canal-no]', no);
      let n = 0;
      for (const canal of canais) {
        const caixas = $$('input.caixa', canal);
        const marcadas = caixas.filter((c) => c.checked);
        if (marcadas.length) n += 1;
        const deArea = marcadas.filter((c) => c.matches('[data-area-caixa]'));
        if (deArea.length && deArea.length < caixas.length) {
          emAreas.push(`em ${canal.dataset.canal}, só ${deArea.map((c) => `“${c.dataset.area}”`).join(' e ')}`);
        }
      }
      total += n;
      const todas = $$('[data-canal-no] input.caixa', no);
      const marcadasNoSetor = todas.filter((c) => c.checked).length;
      const pai = $('[data-setor-caixa]', no);
      pai.checked = todas.length > 0 && marcadasNoSetor === todas.length;
      pai.indeterminate = marcadasNoSetor > 0 && marcadasNoSetor < todas.length;
      $('[data-setor-conta]', no).textContent = `${n} de ${canais.length}`;
    }
    const base = total === 1 ? 'Vale em 1 canal' : `Vale em ${total} canais`;
    $('[data-arv-conta]').textContent =
      total === 0 ? 'Nenhum canal marcado.' : `${base}${emAreas.length ? ` — ${emAreas.join('; ')}` : ''}.`;
  }

  $('[data-arv-canais]').addEventListener('change', (ev) => {
    if (ev.target.matches('[data-setor-caixa]')) {
      const no = ev.target.closest('[data-setor-no]');
      for (const c of $$('[data-canal-no] input.caixa', no)) c.checked = ev.target.checked;
    }
    atualizarOndeVale();
  });

  function ajustarTipo() {
    const tipo = $('input[name="fcr-tipo"]:checked').value;
    const peloDetector = tipo === 'presenca' || tipo === 'contagem';
    $('[data-detector]').hidden = !peloDetector;
    for (const e of $$('[data-so-presenca]')) e.hidden = tipo !== 'presenca';
    for (const e of $$('[data-so-contagem]')) e.hidden = tipo !== 'contagem';
    $('[data-ajuda-texto]').textContent = peloDetector
      ? 'Aqui o texto não é enviado a modelo nenhum: ele descreve a regra para quem ler o aviso. Quem decide são os campos acima.'
      : 'Este texto vai direto ao modelo como pergunta. Descreva o que se vê, não o rótulo: “a superfície tem restos no canto” funciona melhor que “sujeira”.';
  }
  for (const r of $$('input[name="fcr-tipo"]')) r.addEventListener('change', ajustarTipo);

  for (const r of $$('input[name="fca-origem"]')) {
    r.addEventListener('change', () => {
      for (const e of $$('[data-so-dvr]')) e.hidden = $('input[name="fca-origem"]:checked').value !== 'dvr';
    });
  }
  for (const r of $$('input[name="fde-canal"]')) {
    r.addEventListener('change', () => { $('#fde-end').placeholder = r.value; });
  }
  for (const r of $$('input[name="fre-acao"]')) {
    r.addEventListener('change', () => {
      $('[data-so-avisar]').hidden = $('input[name="fre-acao"]:checked').value !== 'sim';
    });
  }

  // ═══════════════════════ interruptores e dobras ═══════════════════════
  document.addEventListener('click', (ev) => {
    const chave = ev.target.closest('.liga');
    if (chave) {
      if (app.dataset.perfil === 'supervisao' && app.contains(chave)) return;
      const ligado = chave.getAttribute('aria-checked') !== 'true';
      if (chave.dataset.ligaCriterio) {
        const c = CRITERIOS[chave.dataset.ligaCriterio];
        c.ligado = ligado;
        for (const outro of $$(`[data-liga-criterio="${chave.dataset.ligaCriterio}"]`)) {
          outro.setAttribute('aria-checked', String(ligado));
          outro.lastElementChild.textContent = ligado ? 'Ligado' : 'Desligado';
          outro.closest('.criterio').classList.toggle('desligado', !ligado);
        }
        avisar(
          `“${c.nome}” ${ligado ? 'ligado' : 'desligado'}` +
            (c.canais > 1 ? ` nos ${c.canais} canais em que vale.` : '.'),
        );
        return;
      }
      chave.setAttribute('aria-checked', String(ligado));
      if (chave.dataset.ligaRotulo) {
        const [sim, nao] = chave.dataset.ligaRotulo.split('|');
        chave.lastElementChild.textContent = ligado ? sim : nao;
      }
      if (chave.dataset.liga) avisar(`“${chave.dataset.liga}” ${ligado ? 'volta a receber avisos' : 'deixa de receber avisos'}.`);
      return;
    }

    const dobra = ev.target.closest('[data-dobra]');
    if (dobra) {
      const alvo = document.getElementById(dobra.dataset.dobra);
      const abrir = alvo.classList.contains('fechada');
      alvo.classList.toggle('fechada', !abrir);
      dobra.setAttribute('aria-expanded', String(abrir));
      return;
    }

    const recado = ev.target.closest('[data-toast]');
    if (recado) avisar(recado.dataset.toast);
  });

  document.addEventListener('change', (ev) => {
    const s = ev.target.closest('[data-toast-muda]');
    if (s) avisar(`${s.dataset.toastMuda} ${s.value}.`);
  });

  // ═══════════════════════ abas ═══════════════════════
  const abas = $$('[role="tab"]');
  function escolherAba(aba, focar) {
    for (const a of abas) {
      const ativa = a === aba;
      a.setAttribute('aria-selected', String(ativa));
      a.tabIndex = ativa ? 0 : -1;
      const p = document.getElementById(a.getAttribute('aria-controls'));
      p.hidden = !ativa;
      if (ativa) {
        p.style.animation = 'none';
        void p.offsetWidth;
        p.style.animation = 'sobe var(--lento) var(--curva) both';
      }
    }
    if (focar) aba.focus();
  }
  for (const a of abas) {
    a.addEventListener('click', () => escolherAba(a, false));
    a.addEventListener('keydown', (ev) => {
      const i = abas.indexOf(a);
      if (ev.key === 'ArrowRight') escolherAba(abas[(i + 1) % abas.length], true);
      if (ev.key === 'ArrowLeft') escolherAba(abas[(i - 1 + abas.length) % abas.length], true);
    });
  }

  // ═══════════════════════ menus ═══════════════════════
  let menuAberto = null;
  let ultimoGatilho = null;
  let contexto = { nome: '', canal: '' };

  function fecharMenu(devolverFoco) {
    if (!menuAberto) return;
    menuAberto.menu.hidden = true;
    menuAberto.botao.setAttribute('aria-expanded', 'false');
    ultimoGatilho = menuAberto.botao;
    if (devolverFoco) menuAberto.botao.focus();
    menuAberto = null;
  }

  function abrirMenu(botao) {
    const menu = document.getElementById(botao.dataset.menu);
    const mesmo = menuAberto && menuAberto.botao === botao;
    fecharMenu(false);
    if (mesmo) return;

    const dono = botao.closest('.canal, .criterio');
    if (dono) {
      contexto = {
        nome: dono.dataset.nome || $('h3', dono)?.textContent || '',
        canal: dono.dataset.canal || '',
        criterio: dono.dataset.criterio || '',
      };
    }

    menu.hidden = false;
    const b = botao.getBoundingClientRect();
    const largura = menu.offsetWidth;
    const altura = menu.offsetHeight;
    let esquerda = b.left;
    if (esquerda + largura > innerWidth - 8) esquerda = b.right - largura;
    esquerda = Math.min(Math.max(8, esquerda), innerWidth - largura - 8);
    let topo = b.bottom + 6;
    if (topo + altura > innerHeight - 8) topo = Math.max(8, b.top - altura - 6);
    menu.style.left = `${esquerda}px`;
    menu.style.top = `${topo}px`;
    menu.style.transformOrigin = `${b.left + b.width / 2 - esquerda}px ${topo < b.top ? '100%' : '0'}`;
    botao.setAttribute('aria-expanded', 'true');
    menuAberto = { menu, botao };
    $('button, a', menu)?.focus({ preventScroll: true });
  }

  document.addEventListener('click', (ev) => {
    const botao = ev.target.closest('[data-menu]');
    if (botao) {
      abrirMenu(botao);
      return;
    }
    if (menuAberto && !ev.target.closest('.menu')) fecharMenu(false);
    else if (menuAberto && ev.target.closest('.menu button, .menu a')) fecharMenu(false);
  });
  palco.addEventListener('scroll', () => fecharMenu(false), { passive: true });
  addEventListener('resize', () => {
    fecharMenu(false);
    moverRealce();
  });

  // ═══════════════════════ gavetas e diálogo ═══════════════════════
  const veu = $('[data-veu]');
  let camada = null;
  let focoAntes = null;

  function abrirCamada(el, gatilho) {
    fecharMenu(false);
    if (camada) camada.hidden = true;
    focoAntes = gatilho && document.contains(gatilho) && gatilho.offsetParent ? gatilho : focoAntes;
    camada = el;
    veu.hidden = false;
    el.hidden = false;
    const primeiro = $('input:not([type="radio"]):not([type="checkbox"]), textarea, select, [data-fecha]', el);
    primeiro?.focus({ preventScroll: true });
  }

  function fecharTudo() {
    fecharMenu(false);
    if (!camada) return;
    camada.hidden = true;
    veu.hidden = true;
    camada = null;
    focoAntes?.focus?.({ preventScroll: true });
    focoAntes = null;
  }

  function abrirFolha(id, modo, gatilho) {
    const folha = document.getElementById(id);
    const editando = modo === 'editar';
    const titulo = $('[data-folha-titulo]', folha);
    if (titulo) titulo.textContent = editando ? `${titulo.dataset.editar} “${contexto.nome}”` : titulo.dataset.novo;
    for (const e of $$('[data-so-editar]', folha)) e.hidden = !editando;
    for (const e of $$('[data-so-novo]', folha)) e.hidden = editando;
    const botao = $('[data-rotulo-novo]', folha);
    if (botao) botao.textContent = editando ? botao.dataset.rotuloEditar : botao.dataset.rotuloNovo;
    const form = $('form', folha);
    form.dataset.modo = editando ? 'editar' : 'novo';
    const nome = $('[data-preenche="nome"]', folha);
    if (nome) nome.value = editando ? contexto.nome : '';

    if (id === 'folha-criterio') {
      const c = CRITERIOS[contexto.criterio];
      const marcados = editando && c
        ? ARVORE.flatMap((s) => s.canais).flatMap((k) =>
            // canal com áreas: o critério está marcado NA ÁREA em que vale
            k.areas
              ? k.areas.filter((a) => a.criterios.includes(contexto.criterio)).map((a) => `${k.nome}/${a.nome}`)
              : k.criterios.includes(contexto.criterio) ? [k.nome] : [],
          )
        : !editando && contexto.canalNovo ? [contexto.canalNovo] : [];
      desenharOndeVale(marcados);
      const tipo = { estado: 'estado', 'presença': 'presenca', contagem: 'contagem' }[editando && c ? c.tipo : 'estado'] || 'estado';
      $(`#fcr-t-${tipo}`).checked = true;
      $('#fcr-texto').value = editando && c ? c.texto : '';
      $(`#fcr-q-${editando && c && c.quando ? c.quando : 'no'}`).checked = true;
      ajustarTipo();
    }
    abrirCamada(folha, gatilho);
  }

  const DIALOGOS = {
    'excluir-canal': {
      titulo: (n) => `Excluir o canal “${n}”?`,
      corpo: () => [
        'O canal some desta tela e <b>deixa de ser verificado</b>. O histórico do que já foi registrado nele continua.',
        'Os critérios que só valem aqui são desligados e vão para “Sem canal”. Os que valem em outros canais continuam neles.',
        'Se a ideia é só parar por um tempo, use <b>Editar</b> e mude a situação para “pausado”.',
      ],
      confirmar: 'Excluir canal',
      depois: (n) => `Canal “${n}” excluído. O histórico dele continua guardado.`,
    },
    'excluir-criterio': {
      titulo: (n) => `Excluir o critério “${n}”?`,
      corpo: () => [
        'Ele <b>deixa de ser verificado</b> em todos os canais em que vale e some desta tela.',
        'O histórico do que ele já registrou continua guardado. Para tirar de um canal só, use <b>Tirar deste canal</b>.',
      ],
      confirmar: 'Excluir critério',
      depois: (n) => `“${n}” excluído. O histórico do que ele já registrou continua.`,
    },
    'tirar-do-canal': {
      titulo: (n) => `Tirar “${n}” deste canal?`,
      corpo: (c) => [
        `A análise deste critério <b>deixa de ser feita</b> em <b>${c.canal || 'este canal'}</b>.`,
        'Nos outros canais em que ele vale, nada muda. Se este for o último, o critério é desligado e fica em “Sem canal”.',
      ],
      confirmar: 'Tirar do canal',
      depois: (n, c) => `“${n}” saiu de ${c.canal || 'um canal'}.`,
    },
    'excluir-area': {
      titulo: (n) => `Excluir a área “${n}”?`,
      corpo: (c) => {
        const a = areas.find((x) => x.nome === c.nome);
        const nomes = a ? a.criterios.map((k) => `“${CRITERIOS[k].nome}”`) : [];
        const um = nomes.length === 1;
        return [
          nomes.length
            ? `${nomes.join(' e ')} <b>${um ? 'deixa' : 'deixam'} de ser ${um ? 'verificado' : 'verificados'} neste canal</b>. ` +
              `Se era o único lugar ${um ? 'dele' : 'deles'}, o critério é desligado e fica em “Sem canal”.`
            : 'Nenhum critério vale nesta área.',
          'O que já foi registrado nela continua no histórico. As outras áreas deste canal não mudam.',
        ];
      },
      confirmar: 'Excluir área',
      depois: (n) => {
        areas = areas.filter((x) => x.nome !== n);
        sel = 0;
        desenharArea();
        return `Área “${n}” excluída.`;
      },
    },
    'novo-setor': {
      titulo: () => 'Novo setor',
      corpo: () => [
        '<span class="campo"><label for="dlg-setor">Nome do setor</label><input class="entrada" id="dlg-setor" placeholder="Cozinha, Salão, Estoque…"></span>',
      ],
      confirmar: 'Criar setor',
      neutro: true,
      depois: () => 'Setor criado. Agora cadastre os canais dele.',
    },
  };

  function abrirDialogo(tipo, gatilho, nome) {
    const d = DIALOGOS[tipo];
    if (nome) contexto = { ...contexto, nome };
    const el = $('#dialogo');
    $('#dlg-titulo').textContent = d.titulo(contexto.nome);
    $('#dlg-corpo').innerHTML = d.corpo(contexto).map((p) => `<p>${p}</p>`).join('');
    const ok = $('[data-confirma]', el);
    ok.textContent = d.confirmar;
    ok.className = `btn ${d.neutro ? 'primario' : 'perigo'}`;
    ok.onclick = () => {
      const recado = d.depois(contexto.nome, contexto);
      fecharTudo();
      avisar(recado);
    };
    abrirCamada(el, gatilho);
    if (!d.neutro) $('[data-fecha]', el).focus({ preventScroll: true });
  }

  document.addEventListener('click', (ev) => {
    const folha = ev.target.closest('[data-folha]');
    if (folha) {
      const noCanal = folha.closest('.no-canal');
      // "+ Critério" de uma ÁREA já abre com ela marcada.
      contexto.canalNovo =
        folha.dataset.lugar ||
        (folha.dataset.criterioNaArea !== undefined ? `Balcão/${areas[sel].nome}` : noCanal ? $('b', noCanal).textContent : '');
      const dono = folha.closest('.criterio');
      if (dono && folha.dataset.nome) contexto = { ...contexto, nome: folha.dataset.nome, criterio: '' };
      abrirFolha(folha.dataset.folha, folha.dataset.modo || 'novo', folha.closest('.menu') ? ultimoGatilho : folha);
      return;
    }
    const dlg = ev.target.closest('[data-dialogo]');
    if (dlg) {
      abrirDialogo(dlg.dataset.dialogo, dlg.closest('.menu') ? ultimoGatilho : dlg, dlg.dataset.nome);
      return;
    }
    if (ev.target.closest('[data-fecha]') || ev.target === veu) fecharTudo();
  });

  for (const form of $$('.folha form')) {
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const recado = form.dataset.modo === 'editar' ? form.dataset.sucessoEditar : form.dataset.sucessoNovo;
      fecharTudo();
      avisar(recado || 'Salvo.');
    });
  }

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      if (menuAberto) fecharMenu(true);
      else fecharTudo();
      return;
    }
    if (ev.key !== 'Tab' || !camada) return;
    const focaveis = $$('button, a[href], input, select, textarea', camada).filter(
      (e) => !e.disabled && e.offsetParent !== null,
    );
    if (!focaveis.length) return;
    const primeiro = focaveis[0];
    const ultimo = focaveis[focaveis.length - 1];
    if (ev.shiftKey && document.activeElement === primeiro) {
      ev.preventDefault();
      ultimo.focus();
    } else if (!ev.shiftKey && document.activeElement === ultimo) {
      ev.preventDefault();
      primeiro.focus();
    }
  });

  // ═══════════════════════ horário de funcionamento ═══════════════════════
  // O horário é DA LOJA. Cada critério só diz se é conferido com ela aberta,
  // fechada ou sempre — mudou o horário, mudou para todos.
  const DIAS = [['seg', 'Segunda'], ['ter', 'Terça'], ['qua', 'Quarta'], ['qui', 'Quinta'], ['sex', 'Sexta'], ['sáb', 'Sábado'], ['dom', 'Domingo']];
  let HORARIO = [
    { abre: false, ini: '18:00', fim: '23:30' },
    { abre: true, ini: '18:00', fim: '23:30' },
    { abre: true, ini: '18:00', fim: '23:30' },
    { abre: true, ini: '18:00', fim: '23:30' },
    { abre: true, ini: '18:00', fim: '01:00' },
    { abre: true, ini: '18:00', fim: '01:00' },
    { abre: true, ini: '18:00', fim: '23:30' },
  ];
  // O relógio do protótipo: quarta-feira, 21:40 (o mesmo do quadro do canal).
  const AGORA = { dia: 2, hora: '21:40' };

  function juntarDias(indices) {
    // [1,2,3,6] → "ter a qui e dom"
    const grupos = [];
    for (const i of indices) {
      const ultimo = grupos[grupos.length - 1];
      if (ultimo && ultimo[1] === i - 1) ultimo[1] = i;
      else grupos.push([i, i]);
    }
    const nomes = grupos.map(([a, b]) => (a === b ? DIAS[a][0] : b === a + 1 ? `${DIAS[a][0]} e ${DIAS[b][0]}` : `${DIAS[a][0]} a ${DIAS[b][0]}`));
    return nomes.length > 1 ? `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}` : nomes[0];
  }

  function resumoDoHorario() {
    const abertos = HORARIO.map((h, i) => ({ ...h, i })).filter((h) => h.abre);
    if (!abertos.length) return 'não informado — a loja é tratada como sempre aberta';
    const porFaixa = new Map();
    for (const h of abertos) {
      const k = `${h.ini}|${h.fim}`;
      porFaixa.set(k, [...(porFaixa.get(k) ?? []), h.i]);
    }
    const partes = [...porFaixa].map(([k, dias]) => {
      const [ini, fim] = k.split('|');
      return `${juntarDias(dias)}, ${ini} às ${fim}`;
    });
    const fechados = HORARIO.map((h, i) => (h.abre ? -1 : i)).filter((i) => i >= 0);
    if (fechados.length) partes.push(`${juntarDias(fechados)} ${fechados.length === 1 ? 'fechada' : 'fechadas'}`);
    return partes.join(' · ');
  }

  function abertaAgora() {
    // Aberta se a hora cai na faixa de hoje, ou na de ontem quando ela
    // atravessa a meia-noite.
    const hoje = HORARIO[AGORA.dia];
    const ontem = HORARIO[(AGORA.dia + 6) % 7];
    const cruza = (h) => h.fim <= h.ini;
    if (hoje.abre && AGORA.hora >= hoje.ini && (cruza(hoje) || AGORA.hora < hoje.fim)) return hoje.fim;
    if (ontem.abre && cruza(ontem) && AGORA.hora < ontem.fim) return ontem.fim;
    return null;
  }

  function desenharHorario() {
    const resumo = resumoDoHorario();
    for (const e of $$('[data-horario-resumo]')) e.textContent = resumo;
    const chip = $('[data-horario-agora]');
    const informado = HORARIO.some((h) => h.abre);
    const ate = abertaAgora();
    chip.className = `chip ${!informado ? 'atencao' : ate ? 'ok' : ''}`;
    chip.innerHTML = !informado
      ? 'sem horário informado'
      : ate
        ? `<span class="ponto ok pulsa"></span>aberta agora · fecha às ${ate}`
        : `${icone('moon')}fechada agora`;

    $('[data-horario-dias]').innerHTML = HORARIO.map((h, i) => {
      const nota = !h.abre ? 'fechada' : h.fim <= h.ini ? 'fecha no dia seguinte' : '';
      return (
        `<li class="horario-dia${h.abre ? '' : ' fechada'}"><label><input class="caixa" type="checkbox" data-h-abre="${i}" ${h.abre ? 'checked' : ''}>${DIAS[i][1]}</label>` +
        `<input class="entrada mono" type="time" data-h-ini="${i}" value="${h.ini}" ${h.abre ? '' : 'disabled'} aria-label="${DIAS[i][1]}: abre às">` +
        `<span>às</span>` +
        `<input class="entrada mono" type="time" data-h-fim="${i}" value="${h.fim}" ${h.abre ? '' : 'disabled'} aria-label="${DIAS[i][1]}: fecha às">` +
        `${nota ? `<small>${nota}</small>` : ''}</li>`
      );
    }).join('');
  }

  $('[data-horario-dias]').addEventListener('change', (ev) => {
    const e = ev.target;
    if (e.dataset.hAbre !== undefined) HORARIO[Number(e.dataset.hAbre)].abre = e.checked;
    if (e.dataset.hIni !== undefined && e.value) HORARIO[Number(e.dataset.hIni)].ini = e.value;
    if (e.dataset.hFim !== undefined && e.value) HORARIO[Number(e.dataset.hFim)].fim = e.value;
    desenharHorario();
  });
  $('[data-horario-copiar]').addEventListener('click', () => {
    const molde = HORARIO.find((h) => h.abre);
    if (!molde) return avisar('Marque um dia e ponha as horas dele primeiro.');
    HORARIO = HORARIO.map(() => ({ ...molde }));
    desenharHorario();
    avisar('Horário copiado para os sete dias. Desmarque os dias em que a loja não abre.');
  });
  desenharHorario();

  // ═══════════════════════ áreas do canal ═══════════════════════
  // Um canal pode ter mais de uma área, e cada área tem os seus critérios:
  // presença se confere dentro do balcão; fila, do lado do cliente.
  const quadro = $('[data-quadro]');
  const rets = $('[data-rets]');
  const fora = $('[data-fora]');
  const coord = Object.fromEntries($$('[data-coord]').map((e) => [e.dataset.coord, e]));
  const prender = (v) => Math.min(1, Math.max(0, v));
  const limpo = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const CORES_DE_AREA = ['#F2B03C', '#5AA9FF', '#7FD08A', '#C792EA'];
  let areas = [
    { nome: 'Dentro do balcão', x1: 0.04, y1: 0.07, x2: 0.44, y2: 0.95, largura: 220, criterios: ['posto'] },
    { nome: 'Lado do cliente', x1: 0.56, y1: 0.07, x2: 0.93, y2: 0.95, largura: 260, criterios: ['fila'] },
  ];
  let sel = 0;
  let arraste = null;

  function desenharArea(escreverCampos = true) {
    if (sel >= areas.length) sel = areas.length - 1;
    const a = areas[sel];
    const { x1, y1, x2, y2 } = a;
    const pc = (v) => `${(v * 100).toFixed(2)}%`;
    const cor = (i) => CORES_DE_AREA[i % CORES_DE_AREA.length];

    // todas as áreas no quadro; a selecionada é a de borda cheia
    rets.innerHTML = areas
      .map(
        (r, i) =>
          `<div class="ret${i === sel ? '' : ' outra'}" data-ret-i="${i}" data-rotulo="${limpo(r.nome)}" ` +
          `style="left:${pc(r.x1)};top:${pc(r.y1)};width:${pc(r.x2 - r.x1)};height:${pc(r.y2 - r.y1)};--cor:${cor(i)}"></div>`,
      )
      .join('');
    fora.style.clipPath =
      `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${pc(x1)} ${pc(y1)}, ${pc(x1)} ${pc(y2)}, ` +
      `${pc(x2)} ${pc(y2)}, ${pc(x2)} ${pc(y1)}, ${pc(x1)} ${pc(y1)})`;
    if (escreverCampos) {
      for (const k of Object.keys(coord)) coord[k].value = a[k].toFixed(2);
      $('#area-nome').value = a.nome;
      $('#area-largura').value = a.largura || '';
    }

    // a lista de áreas do canal
    const unica = areas.length === 1;
    $('[data-areas]').innerHTML = areas
      .map((r, i) => {
        const n = r.criterios.length;
        const excluir = unica
          ? 'disabled title="O canal precisa de pelo menos uma área"'
          : `data-dialogo="excluir-area" data-nome="${limpo(r.nome)}"`;
        return (
          `<li><button type="button" class="area-item" aria-pressed="${i === sel}" data-area-item="${i}">` +
          `<i class="cor" style="--c:${cor(i)}"></i>` +
          `<span><b>${limpo(r.nome)}</b><small>${n ? plural(n, 'critério', 'critérios') : 'sem critério'}</small></span></button>` +
          `<button class="btn fantasma quadrado mini" type="button" data-so-config ${excluir} aria-label="Excluir a área ${limpo(r.nome)}">${icone('trash-2')}</button></li>`
        );
      })
      .join('');

    // os critérios da área selecionada
    $('[data-area-crit-titulo]').textContent = `Critérios em “${a.nome}”`;
    $('[data-area-criterios]').innerHTML = a.criterios.length
      ? a.criterios
          .map((k) => {
            const c = CRITERIOS[k];
            return (
              `<li><span class="selo-ic">${icone(ICONE_DO_TIPO[c.tipo])}</span>` +
              `<span><b>${c.nome}</b><small>${c.tipo}${c.procura ? ` · ${c.procura}` : ''}</small></span>` +
              `<span class="chip ${c.ligado ? 'ok' : ''}">${c.ligado ? 'ligado' : 'desligado'}</span></li>`
            );
          })
          .join('')
      : '<li class="vazio-linha">Nenhum critério nesta área. Nada é verificado nela.</li>';

    const largura = Number(a.largura);
    const fracao = Math.round((x2 - x1) * (y2 - y1) * 100);
    const linhas = [`<div><dt>do quadro</dt><dd><span class="mono">${fracao}%</span></dd></div>`, '<div><dt>imagem do canal</dt><dd><span class="mono">1920 px</span></dd></div>'];
    if (largura > 0) {
      for (const px of [384, 640, 1000, 1920]) {
        const v = px / largura;
        const [nome, corDoChip] =
          v >= 12.8 ? ['montagem', 'ok'] : v >= 3 ? ['estado', 'ok'] : v >= 1.5 ? ['presença', 'atencao'] : ['insuficiente', 'critico'];
        linhas.push(
          `<div><dt>envio de ${px} px</dt><dd><span class="mono">${v.toFixed(1).replace('.', ',')}</span> por cm <span class="chip ${corDoChip}">${nome}</span></dd></div>`,
        );
      }
    }
    $('[data-sustenta]').innerHTML = linhas.join('');
  }

  function posicao(ev) {
    const c = quadro.getBoundingClientRect();
    return { x: prender((ev.clientX - c.left) / c.width), y: prender((ev.clientY - c.top) / c.height) };
  }
  // CLIQUE seleciona, ARRASTO desenha — e o arrasto pode começar em cima de
  // outra área. Toda loja nova tem a área "Quadro inteiro" cobrindo a imagem
  // toda: se apertar sobre ela já trocasse a seleção, não sobrava onde
  // começar a desenhar a segunda.
  quadro.addEventListener('pointerdown', (ev) => {
    quadro.setPointerCapture?.(ev.pointerId);
    const a = areas[sel];
    arraste = {
      ...posicao(ev),
      telaX: ev.clientX,
      telaY: ev.clientY,
      antes: { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2 },
      desenhou: false,
    };
  });
  quadro.addEventListener('pointermove', (ev) => {
    if (!arraste) return;
    // mão que treme num clique não é arrasto
    if (!arraste.desenhou && Math.hypot(ev.clientX - arraste.telaX, ev.clientY - arraste.telaY) < 6) return;
    arraste.desenhou = true;
    const p = posicao(ev);
    Object.assign(areas[sel], {
      x1: Math.min(arraste.x, p.x), y1: Math.min(arraste.y, p.y),
      x2: Math.max(arraste.x, p.x), y2: Math.max(arraste.y, p.y),
    });
    desenharArea();
  });
  const soltar = (ev) => {
    if (!arraste) return;
    const gesto = arraste;
    arraste = null;
    if (gesto.desenhou) {
      // risco fino: volta a área como estava
      const a = areas[sel];
      if (a.x2 - a.x1 < 0.02 || a.y2 - a.y1 < 0.02) Object.assign(a, gesto.antes);
      desenharArea();
      return;
    }
    if (ev.type !== 'pointerup') return;
    // foi um clique: vale a MENOR área que contém o ponto
    let alvo = -1;
    let menor = Infinity;
    areas.forEach((r, i) => {
      if (gesto.x < r.x1 || gesto.x > r.x2 || gesto.y < r.y1 || gesto.y > r.y2) return;
      const tamanho = (r.x2 - r.x1) * (r.y2 - r.y1);
      if (tamanho < menor || (tamanho === menor && i === sel)) {
        menor = tamanho;
        alvo = i;
      }
    });
    if (alvo >= 0 && alvo !== sel) {
      sel = alvo;
      desenharArea();
    }
  };
  quadro.addEventListener('pointerup', soltar);
  quadro.addEventListener('pointercancel', soltar);
  for (const k of Object.keys(coord)) {
    coord[k].addEventListener('input', () => {
      areas[sel][k] = prender(Number(coord[k].value));
      desenharArea(false);
    });
  }
  $('#area-largura').addEventListener('input', () => {
    areas[sel].largura = Number($('#area-largura').value) || 0;
    desenharArea(false);
  });
  $('#area-nome').addEventListener('input', () => {
    areas[sel].nome = $('#area-nome').value.trim() || 'área';
    desenharArea(false);
  });
  $('[data-quadro-inteiro]').addEventListener('click', () => {
    Object.assign(areas[sel], { x1: 0, y1: 0, x2: 1, y2: 1 });
    desenharArea();
  });
  $('[data-areas]').addEventListener('click', (ev) => {
    const item = ev.target.closest('[data-area-item]');
    if (!item) return;
    sel = Number(item.dataset.areaItem);
    desenharArea();
  });
  $('[data-nova-area]').addEventListener('click', () => {
    let n = areas.length + 1;
    while (areas.some((x) => x.nome === `Área ${n}`)) n += 1;
    areas.push({ nome: `Área ${n}`, x1: 0.3, y1: 0.3, x2: 0.7, y2: 0.7, largura: 0, criterios: [] });
    sel = areas.length - 1;
    desenharArea();
    $('#area-nome').focus();
    $('#area-nome').select();
    avisar('Área criada. Arraste na imagem para posicionar, dê um nome e salve.');
  });
  for (const b of $$('[data-atualizar-quadro]')) {
    b.addEventListener('click', () => {
      const antes = b.innerHTML;
      b.disabled = true;
      b.innerHTML = `${icone('loader-circle', 'p gira')}Pedindo à loja…`;
      setTimeout(() => {
        b.disabled = false;
        b.innerHTML = antes;
        avisar('Quadro atualizado pelo agente da loja.');
      }, calmo ? 0 : 1300);
    });
  }

  // ═══════════════════════ loja, agente, perfil, tema ═══════════════════════
  function agente(estado) {
    const fora = estado === 'fora';
    app.dataset.agente = estado;
    for (const e of $$('[data-agente-titulo]')) e.textContent = fora ? 'Agente sem sinal' : 'Agente ativo';
    for (const e of $$('[data-agente-titulo-curto]')) e.textContent = fora ? 'Sem sinal' : 'Ativo';
    for (const e of $$('[data-agente-detalhe]')) e.textContent = fora ? 'última batida há 2 h' : 'bateu há 12 s · versão 0.9.4';
    for (const e of $$('[data-agente-ponto]')) {
      e.className = fora ? 'ponto critico' : 'ponto ok pulsa';
      if (e.hasAttribute('aria-label')) e.setAttribute('aria-label', fora ? 'Agente sem sinal' : 'Agente ativo');
    }
    for (const e of $$('[data-marca]')) {
      e.classList.toggle('vivo', !fora);
      e.classList.toggle('fora', fora);
    }
    $('[data-faixa-agente]').hidden = !fora;
    $('[data-saude-agente]').classList.toggle('ruim', fora);
    $('[data-agente-fora]').setAttribute('aria-current', String(fora));
  }

  document.addEventListener('click', (ev) => {
    const loja = ev.target.closest('[data-entrar-loja]');
    if (loja) {
      ev.preventDefault();
      for (const e of $$('[data-loja-nome]')) e.textContent = loja.dataset.entrarLoja;
      for (const e of $$('#menu-loja [data-entrar-loja]')) {
        e.setAttribute('aria-current', String(e.dataset.entrarLoja === loja.dataset.entrarLoja));
      }
      agente(loja.dataset.agenteLoja);
      ir('painel');
      avisar(`Você está em ${loja.dataset.entrarLoja}.`);
      return;
    }

    const sit = ev.target.closest('#menu-proto [data-situacao]');
    if (sit) {
      palco.dataset.situacao = sit.dataset.situacao;
      for (const e of $$('#menu-proto [data-situacao]')) e.setAttribute('aria-current', String(e === sit));
      return;
    }
    if (ev.target.closest('[data-agente-fora]')) {
      agente(app.dataset.agente === 'fora' ? 'ativo' : 'fora');
      return;
    }
    const perfil = ev.target.closest('#menu-proto [data-perfil]');
    if (perfil) {
      app.dataset.perfil = perfil.dataset.perfil;
      for (const e of $$('#menu-proto [data-perfil]')) e.setAttribute('aria-current', String(e === perfil));
      for (const e of $$('[data-perfil-nome]')) e.textContent = perfil.dataset.perfil === 'gerente' ? 'gerente' : 'supervisão';
      if (perfil.dataset.perfil !== 'gerente' && !$('[data-tela="orcamento"]').hidden) ir('painel');
      moverRealce();
      return;
    }
    if (ev.target.closest('[data-tema]')) {
      trocarTema();
      return;
    }
    if (ev.target.closest('[data-sair]')) {
      fecharTudo();
      app.hidden = true;
      entrar.hidden = false;
      $('#entrar-email').focus();
    }
  });

  const temaEscuro = () => {
    const t = document.documentElement.dataset.theme;
    return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  };
  function pintarTema() {
    const escuro = temaEscuro();
    for (const u of $$('[data-tema-icone]')) u.setAttribute('href', escuro ? '#i-sun' : '#i-moon');
    for (const r of $$('[data-tema-rotulo]')) r.textContent = escuro ? 'Usar o tema claro' : 'Usar o tema escuro';
  }
  function trocarTema() {
    document.documentElement.dataset.theme = temaEscuro() ? 'light' : 'dark';
    pintarTema();
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', pintarTema);

  // ═══════════════════════ entrar ═══════════════════════
  $('#ver-senha').addEventListener('click', (ev) => {
    const campo = $('#entrar-senha');
    const mostrar = campo.type === 'password';
    campo.type = mostrar ? 'text' : 'password';
    ev.currentTarget.setAttribute('aria-pressed', String(mostrar));
    ev.currentTarget.setAttribute('aria-label', mostrar ? 'Esconder a senha' : 'Mostrar a senha');
    $('use', ev.currentTarget).setAttribute('href', mostrar ? '#i-eye-off' : '#i-eye');
  });
  $('#f-entrar').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const erro = $('#entrar-erro');
    const botao = $('#entrar-botao');
    if (!$('#entrar-email').value.includes('@') || !$('#entrar-senha').value) {
      erro.hidden = false;
      return;
    }
    erro.hidden = true;
    botao.disabled = true;
    botao.innerHTML = `${icone('loader-circle', 'gira')}Entrando…`;
    setTimeout(() => {
      botao.disabled = false;
      botao.textContent = 'Entrar';
      entrar.hidden = true;
      app.hidden = false;
      ir('painel');
    }, calmo ? 0 : 700);
  });

  // ═══════════════════════ partida ═══════════════════════
  desenharCriterios();
  desenharOndeVale();
  ajustarTipo();
  desenharArea();
  pintarTema();

  // O endereço manda: #canais abre Canais, #entrar abre a entrada.
  function seguirEndereco() {
    const pedido = location.hash.replace('#', '');
    const naEntrada = pedido === 'entrar';
    app.hidden = naEntrada;
    entrar.hidden = !naEntrada;
    if (!naEntrada) ir(TELAS.includes(pedido) ? pedido : 'painel');
  }
  addEventListener('hashchange', seguirEndereco);
  seguirEndereco();
  // As fontes chegam depois do primeiro desenho e mudam a altura dos itens.
  document.fonts?.ready.then(moverRealce);
  if ('ResizeObserver' in window) new ResizeObserver(moverRealce).observe($('.lado'));
})();
