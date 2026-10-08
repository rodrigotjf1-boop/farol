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
  const TELAS = ['painel', 'analises', 'padroes', 'canais', 'ambiente', 'inventario', 'area', 'criterios', 'alertas', 'orcamento', 'lojas'];

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
    // comparação num canal que ainda não tem foto padrão: cadastrado, e não conferido ali
    arrumada: {
      nome: 'Área da fritadeira como no padrão', tipo: 'comparação', gravidade: 'atenção', ligado: true, canais: 1, faltaFoto: true,
      texto: 'A área da fritadeira está como na foto padrão: sem caixas no chão e sem utensílios fora do lugar.',
      meta: 'prioridade leve · confiança mínima 0,70 · silêncio de 30 min · versão 1',
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
        { nome: 'Fritadeira', num: '06', criterios: ['cesto', 'arrumada'], semImagem: true },
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

    // as abas de dentro de uma seção acendem a seção
    const secao = { area: 'canais', ambiente: 'canais', inventario: 'canais', padroes: 'analises' }[nome] ?? nome;
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
    if (nome === 'padroes') desenharPadroes();
    if (nome === 'ambiente') desenharAmbiente();
    if (nome === 'inventario') desenharInventario();
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

  // ── a MEDIDA de cada olhada ──
  // O detector diz quantas pessoas viu. Guardada por hora (a soma, em quantas
  // olhadas mediu e o maior valor), é dela que sai o padrão da loja:
  // "conforme" não diz se havia uma pessoa ou quatro. Só mede quem é julgado
  // na loja; a nuvem não mede.
  const SI = Object.fromEntries(AN_SERIES.map((s, i) => [`${s.crit}-${s.canal}`, i]));
  /** O dia da semana (0 = segunda) a que a hora pertence: a madrugada é da noite anterior. */
  const diaDaOperacao = (d, h) => diaDaSemana(h < 6 ? d + 1 : d);
  /** Há quantas semanas foi o dia `d`: 0 = a semana que terminou ontem. */
  const semanasAtras = (d) => Math.floor((Math.max(1, d) - 1) / 7);
  const MOVIMENTO_DO_DIA = [0, 0.8, 0.9, 1, 1.25, 1.06, 1.1]; // segunda (fechada) … domingo

  // O que foge do padrão, plantado de propósito: é o que a lente de anomalias
  // mostra. A chave é dia|série|hora.
  const PLANTADAS = {
    [`1|${SI['posto-bal']}|20`]: { media: 1.1 }, // ontem, 20h: balcão com uma pessoa no pico
    [`5|${SI['fila-bal']}|18`]: { media: 4.8 }, // sexta 02/10, 18h: fila logo na abertura
    [`3|${SI['bancada-m2']}|21`]: { fora: 0.31 }, // domingo 04/10, 21h: bancada da Montagem 2
    [`0|${SI['touca-m1']}|19`]: { na: 0.91 }, // hoje, 19h: a touca deixou de ser avaliada em Montagem 1
    [`11|${SI['posto-bal']}|22`]: { media: 4 }, // sábado 26/09, 22h: balcão cheio (evento)
    [`12|${SI['bancada-m1']}|21`]: { fora: 0.28 }, // sexta 25/09, 21h: bancada da Montagem 1
  };

  /** Quantas pessoas, em média, o detector viu na série `si`, na hora `h` do dia `d`. null = não mede. */
  function medidaDaHora(si, d, h) {
    const s = AN_SERIES[si];
    if (s.onde !== 'loja') return null;
    const plantada = PLANTADAS[`${d}|${si}|${h}`];
    if (plantada?.media !== undefined) return plantada.media;
    const dia = diaDaOperacao(d, h);
    const forma = (pico(h) - 0.55) / 0.9; // 0 = calmo, 1 = o pico do jantar
    const r = sorte(d, si, h, 9) - 0.5;
    const fimDeSemana = dia === 4 || dia === 5;
    if (s.crit === 'fila') {
      // a fila do pico de sábado cresce semana a semana: é a tendência do protótipo
      const sobe = dia === 5 ? 0.43 * (3 - Math.min(3, semanasAtras(d))) : 0;
      return Math.max(0, (0.25 + 3 * forma) * MOVIMENTO_DO_DIA[dia] + sobe * forma + 0.3 * r);
    }
    if (s.crit === 'posto') {
      const base = forma < 0.2 ? 1.1 : forma < 0.6 ? 1.9 : fimDeSemana ? 2.6 : 2.1;
      // de vez em quando falta gente no balcão, e é aí que a fila estoura
      const falta = forma >= 0.2 && sorte(d, si, h, 10) < 0.17 ? 0.9 : 0;
      return Math.max(0.3, base - falta + 0.25 * r);
    }
    if (s.crit === 'chapa') return Math.max(0.4, 0.95 + (fimDeSemana ? 0.85 : 0.25) * forma + 0.2 * r);
    return Math.max(0, 0.02 * (r + 0.5)); // o caixa com a loja fechada: ninguém
  }

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
        const plantada = PLANTADAS[`${d}|${si}|${h}`];
        let taxaFora = s.fora * pico(h) * (0.5 + sorte(d, si, h, 2));
        let taxaNa = s.na * (0.85 + 0.3 * sorte(d, si, h, 3));
        // O que anda junto: com menos de duas pessoas atrás do balcão no
        // movimento, a fila passa do combinado bem mais vezes; e com a
        // cozinha cheia a bancada fica mais tempo fora do critério — cada
        // semana um pouco menos.
        if (s.crit === 'fila') taxaFora *= pico(h) > 0.9 && medidaDaHora(SI['posto-bal'], d, h) < 1.5 ? 3.2 : 0.8;
        if (s.crit === 'bancada') taxaFora *= (medidaDaHora(SI['chapa-chp'], d, h) >= 1.5 ? 1.8 : 0.9) * (1 + 0.22 * semanasAtras(d));
        if (plantada?.fora !== undefined) taxaFora = plantada.fora;
        if (plantada?.na !== undefined) taxaNa = plantada.na;
        const fora = Math.min(n, Math.round(n * taxaFora));
        const na = Math.min(n - fora, Math.round(n * taxaNa));
        const medida = medidaDaHora(si, d, h);
        const nuvem = s.onde === 'nuvem';
        celulas.push({
          d, si, h, n, fora, na, ok: n - fora - na, ativos,
          // a medida: em quantas olhadas o juiz mediu, a soma e o maior valor
          com: medida === null ? 0 : n,
          soma: medida === null ? 0 : medida * n,
          maior: medida === null ? null : Math.ceil(medida * (1.4 + 0.5 * sorte(d, si, h, 11)) + (medida > 0.3 ? 0.6 : 0)),
          // Fora do critério é contado a cada olhada; AVISO é a primeira de
          // cada período de silêncio (uns quinze minutos).
          avisos: Math.min(fora, Math.ceil(ativos / 15)),
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

  const an = { periodo: 'hoje', dia: '2026-10-05', de: 0, ate: 24, canal: '', crit: '', onde: 'tudo', vista: 'resultado', uso: 'cpu' };
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
        if (menos !== 'onde' && an.onde !== 'tudo' && s.onde !== an.onde) return false;
        return true;
      });
  }

  function somar(celulas) {
    const t = { n: 0, ok: 0, fora: 0, na: 0, loja: 0, nuvem: 0, custo: 0, ms: 0, avisos: 0 };
    for (const c of celulas) {
      t.n += c.n; t.ok += c.ok; t.fora += c.fora; t.na += c.na; t.custo += c.custo; t.ms += c.ms; t.avisos += c.avisos;
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
    desenharMaquina(recorte);

    // ── com ou sem dado: os números, a tabela e as ocorrências somem; o
    //    gráfico e os canais ficam ──
    const semDado = t.n === 0;
    for (const el of $$('[data-an-so-com-dado]')) el.hidden = semDado;
    $('[data-an-sem-dado]').hidden = !semDado;

    // ── nada a conferir: as olhadas que a loja segurou. Só existem em
    //    critério com "quando vale a pena conferir"; não são análise, e
    //    "onde foi julgado" não se aplica a elas ──
    const seguradas = new Map();
    for (const c of celulasDoRecorte('onde')) {
      const crit = AN_SERIES[c.si].crit;
      if (!CRITERIOS[crit]?.porteiro) continue;
      seguradas.set(crit, (seguradas.get(crit) ?? 0) + Math.round(c.n * 1.4));
    }
    const totalSeguradas = [...seguradas.values()].reduce((a, v) => a + v, 0);
    $('[data-an-nada]').hidden = totalSeguradas === 0;
    $('[data-an-nada-texto]').innerHTML =
      `<b>${numero.format(totalSeguradas)} ${totalSeguradas === 1 ? 'olhada ficou' : 'olhadas ficaram'} em “nada a conferir”</b> neste recorte: ` +
      'a loja viu que a condição do critério não valia — ninguém na área, gente na frente ou nada se mexeu — e não perguntou à nuvem. Não entram nas análises.' +
      (seguradas.size > 1
        ? '<br>' + [...seguradas.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${CRITERIOS[k].nome} <b class="mono">${numero.format(v)}</b>`).join(' · ')
        : '');

    // ── os números ──
    const horasComAnalise = new Set(recorte.map((c) => `${c.d}-${c.h}`)).size || 1;
    const horasComNuvem = new Set(recorte.filter((c) => c.custo > 0).map((c) => `${c.d}-${c.h}`)).size || 1;
    contar($('[data-an="total"]'), t.n, animar);
    contar($('[data-an="okp"]'), porcento(t.ok, t.n), animar);
    contar($('[data-an="nc"]'), t.fora, animar);
    contar($('[data-an="nap"]'), porcento(t.na, t.n), animar);
    $('[data-an="total-pe"]').textContent = `${numero.format(Math.round(t.n / horasComAnalise))} por hora, em média`;
    $('[data-an="ok-pe"]').textContent = `${numero.format(t.ok)} análises`;
    $('[data-an="nc-pe"]').textContent = `${porcento(t.fora, t.n)}% das análises · ${plural(t.avisos, 'aviso', 'avisos')}`;
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

    // ── os últimos AVISOS dentro do recorte ──
    const vezes = [];
    const dias = [...diasDoRecorte()].sort((a, b) => a - b); // do mais recente para trás
    busca: for (const d of dias) {
      for (let h = 23; h >= 0; h -= 1) {
        const daHora = [];
        for (const c of recorte) {
          if (c.d !== d || c.h !== h) continue;
          for (let j = 0; j < c.avisos; j += 1) {
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
    $('[data-an-fora-conta]').textContent = numero.format(t.avisos);
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
              : `<span class="chip">${icone('hourglass')}aviso na fila</span>`;
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
        (t.avisos > vezes.length ? `<li class="mais"><span></span><p>e mais ${plural(t.avisos - vezes.length, 'aviso', 'avisos')} neste recorte.</p><span></span></li>` : '')
      : '<li class="mais"><span></span><p>Nenhum aviso neste recorte.</p><span></span></li>';
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
      Object.assign(an, AN_PADRAO, { vista: an.vista, uso: an.uso });
      desenharAnalises(true);
      avisar('Filtros limpos: hoje, o dia inteiro, todos os canais.');
    });
  }

  // O gráfico também é filtro: tocar numa hora mostra só ela; num dia, abre o dia.
  function escolherBalde(b) {
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
  }
  $('[data-an-barras]').addEventListener('click', (ev) => {
    const col = ev.target.closest('.col');
    if (!col) return;
    const b = an.baldes[Number(col.dataset.i)];
    escolherBalde(b);
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

  // ── a máquina de análise: o computador da loja, que é quem julga ──
  // Processador, memória e placa de vídeo são da máquina INTEIRA: seguem o
  // período e as horas do recorte, não o canal nem o critério. O que muda
  // com o canal e o critério é o TEMPO que a máquina passou julgando —
  // esse sai das próprias análises.
  const AN_MAQUINA = {
    nome: 'PC da loja', processador: 'Intel Core i7-10700F', memoriaGb: 16, placa: 'Radeon RX 560',
    discoGb: 223, discoLivreHojeGb: 64, discoPorDiaGb: 0.6,
  };
  const AN_USOS = {
    cpu: { nome: 'processador', media: 'cpu', pico: 'cpuPico' },
    mem: { nome: 'memória', media: 'mem', pico: 'memPico' },
    gpu: { nome: 'placa de vídeo', media: 'gpu', pico: 'gpuPico' },
  };

  /** O uso na hora `h` do dia `d`: média e pico de cada peça, e a parte do Farol. */
  function usoDaHora(d, h) {
    const visto = d === 0 ? Math.max(0, Math.min(60, AN_AGORA_MIN - h * 60)) : 60;
    if (visto === 0) return null;
    const aberta = Math.min(minutosAberta(d, h), visto) / visto;
    const movimento = (pico(h) - 0.55) / 0.9; // 0 = calmo, 1 = pico do jantar
    const r = (k) => sorte(d, 97, h, k);
    const cpu = 4 + 2 * r(1) + aberta * (11 + 9 * movimento);
    const mem = 44 + 2 * r(2) + aberta * 6;
    const gpu = 1 + r(3) + aberta * (5 + 5 * movimento);
    return {
      visto,
      cpu, cpuPico: Math.min(98, cpu + 10 + aberta * (28 + 22 * r(4))),
      mem, memPico: mem + 2 + 3 * r(5),
      gpu, gpuPico: aberta > 0 ? 36 + 24 * r(6) : 5 + 4 * r(6),
      farol: 0.8 + aberta * (1.6 + r(7)),
    };
  }

  /** Junta várias horas: a média pesa pelo tempo visto; o pico é o maior. */
  function juntarUso(horas) {
    const vistas = horas.filter(Boolean);
    const tempo = vistas.reduce((a, u) => a + u.visto, 0);
    if (!tempo) return null;
    const media = (k) => vistas.reduce((a, u) => a + u[k] * u.visto, 0) / tempo;
    const maior = (k) => Math.max(...vistas.map((u) => u[k]));
    return {
      cpu: media('cpu'), cpuPico: maior('cpuPico'), mem: media('mem'), memPico: maior('memPico'),
      gpu: media('gpu'), gpuPico: maior('gpuPico'), farol: media('farol'),
    };
  }

  const duracao = (ms) => {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s} s`;
    if (s < 3600) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
    return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')} min`;
  };

  function desenharMaquina(recorte) {
    const umDia = an.periodo !== '7d';
    const dias = diasDoRecorte();
    const horasDoRecorte = (d) => Array.from({ length: an.ate - an.de }, (_, i) => usoDaHora(d, an.de + i));
    const total = juntarUso(dias.flatMap(horasDoRecorte));

    $('[data-an-maq-nome]').textContent =
      `${AN_MAQUINA.nome} · ${AN_MAQUINA.processador} · ${AN_MAQUINA.memoriaGb} GB de memória · ${AN_MAQUINA.placa}`;
    for (const [chave, u] of Object.entries(AN_USOS)) {
      $(`[data-an-uso="${chave}"]`).setAttribute('aria-pressed', String(an.uso === chave));
      $(`[data-an-uso-num="${chave}"]`).textContent = total ? String(Math.round(total[u.media])) : '—';
      $(`[data-an-uso-pe="${chave}"]`).textContent = total ? `em média · pico de ${Math.round(total[u.pico])}%` : 'sem medida neste recorte';
    }
    // o disco é o do dia mais recente do recorte: é uma posição, não uma média
    const recente = Math.min(...dias);
    $('[data-an-uso-num="disco"]').textContent = numero.format(Math.round(AN_MAQUINA.discoLivreHojeGb + AN_MAQUINA.discoPorDiaGb * recente));
    $('[data-an-uso-pe="disco"]').textContent =
      `de ${AN_MAQUINA.discoGb} GB · ${String(AN_MAQUINA.discoPorDiaGb).replace('.', ',')} GB a menos por dia`;

    // o gráfico: as mesmas colunas do gráfico de cima (horas do dia, ou dias)
    const u = AN_USOS[an.uso];
    const colunas = an.baldes.map((b) => (b.h !== undefined ? usoDaHora(dias[0], b.h) && juntarUso([usoDaHora(dias[0], b.h)]) : juntarUso(horasDoRecorte(b.d))));
    const umaHora = umDia && an.ate - an.de === 1;
    $('[data-an-uso-area]').style.setProperty('--vao', umDia ? '3px' : 'clamp(8px, 3%, 28px)');
    $('[data-an-uso-barras]').innerHTML = an.baldes
      .map((b, i) => {
        const c = colunas[i];
        const dentro = !umDia || (b.h >= an.de && b.h < an.ate);
        const marcada = umaHora && b.h === an.de;
        const leitura = c
          ? `${b.rotulo}: ${u.nome} em ${Math.round(c[u.media])}% na média, pico de ${Math.round(c[u.pico])}%.`
          : `${b.rotulo}: sem medida.`;
        return (
          `<button type="button" class="col${dentro ? '' : ' apagada'}${c ? '' : ' vazia'}" data-i="${i}" aria-pressed="${marcada}" aria-label="${leitura}">` +
          (c
            ? `<span class="barra-col" style="height:${c[u.media]}%;animation-delay:${i * 14}ms"><i class="cor-loja" style="flex:1 1 0"></i></span>` +
              `<span class="pico" style="bottom:${Math.min(98.5, c[u.pico])}%"></span>`
            : '') +
          `</button>`
        );
      })
      .join('');
    $('[data-an-uso-eixo-x]').innerHTML = an.baldes.map((b) => `<span>${b.mostra ? b.rotulo : ''}</span>`).join('');
    an.usos = colunas;

    // o que muda com o canal e o critério: o tempo que a máquina passou julgando
    const naLoja = recorte.filter((c) => AN_SERIES[c.si].onde === 'loja');
    const julgando = naLoja.reduce((a, c) => a + c.ms, 0);
    const analises = naLoja.reduce((a, c) => a + c.n, 0);
    const partes = [];
    if (total) partes.push(`O Farol ocupou, em média, ${total.farol.toFixed(1).replace('.', ',')}% do processador desta máquina neste recorte.`);
    partes.push(
      analises
        ? `Tempo julgando na loja: ${duracao(julgando)}, em ${numero.format(analises)} análises — este número acompanha os filtros de canal e de critério.`
        : 'Nenhuma análise foi julgada na loja neste recorte.',
    );
    partes.push('Processador, memória e placa de vídeo são da máquina inteira: seguem o período e as horas, não o canal nem o critério.');
    $('[data-an-uso-nota]').textContent = partes.join(' ');
  }

  for (const b of $$('[data-an-uso]')) b.addEventListener('click', () => { an.uso = b.dataset.anUso; desenharAnalises(false); });

  // o gráfico da máquina também escolhe a hora (ou abre o dia), como o de cima
  $('[data-an-uso-barras]').addEventListener('click', (ev) => {
    const col = ev.target.closest('.col');
    if (!col) return;
    const b = an.baldes[Number(col.dataset.i)];
    escolherBalde(b);
    if (b.h !== undefined) $(`[data-an-uso-barras] .col[data-i="${b.h}"]`)?.focus({ preventScroll: true });
  });

  const anUsoDica = $('[data-an-uso-dica]');
  const anUsoArea = $('[data-an-uso-area]');
  function mostrarDicaDoUso(col) {
    const c = col ? an.usos[Number(col.dataset.i)] : null;
    if (!c) {
      anUsoDica.hidden = true;
      return;
    }
    const b = an.baldes[Number(col.dataset.i)];
    const p = (v) => `${Math.round(v)}%`;
    anUsoDica.innerHTML =
      `<b>${b.rotulo}</b> · média e pico<br>` +
      `processador ${p(c.cpu)} · ${p(c.cpuPico)}<br>memória ${p(c.mem)} · ${p(c.memPico)}<br>placa de vídeo ${p(c.gpu)} · ${p(c.gpuPico)}`;
    anUsoDica.hidden = false;
    const base = anUsoArea.getBoundingClientRect();
    const caixa = col.getBoundingClientRect();
    const meio = caixa.left + caixa.width / 2 - base.left;
    const metade = anUsoDica.offsetWidth / 2;
    anUsoDica.style.left = `${Math.min(Math.max(meio, metade), base.width - metade)}px`;
    anUsoDica.style.top = `${anUsoDica.offsetHeight + 4}px`;
  }
  anUsoArea.addEventListener('pointermove', (ev) => mostrarDicaDoUso(ev.target.closest('.col')));
  anUsoArea.addEventListener('pointerleave', () => mostrarDicaDoUso(null));
  anUsoArea.addEventListener('focusin', (ev) => mostrarDicaDoUso(ev.target.closest('.col')));
  anUsoArea.addEventListener('focusout', () => mostrarDicaDoUso(null));

  // ═══════════════════════ critérios ═══════════════════════
  function cartaoDoCriterio(chave, canal) {
    const c = CRITERIOS[chave];
    const chips = [
      c.procura ? `<span class="chip ok" title="Julgado dentro da loja, sem internet">${c.procura}</span>` : '',
      c.falta ? `<span class="chip atencao">${icone('triangle-alert')}falta dizer o que procurar</span>` : '',
      c.faltaFoto ? `<span class="chip atencao" title="Guarde a foto padrão em Canais, na tela “Quadro e área” deste canal">${icone('triangle-alert')}falta a foto padrão</span>` : '',
      `<span class="chip">${c.tipo}</span>`,
      `<span class="chip ${c.grave ? 'critico' : ''}">${c.gravidade}</span>`,
      c.canais > 1 ? `<span class="chip vazado" title="É um cadastro só: editar aqui muda em todos os canais">vale em ${c.canais} canais</span>` : '',
      // "No horário" é o comum e não leva etiqueta; o que foge dele, leva.
      c.quando === 'fora'
        ? `<span class="chip vazado" title="Só é conferido com a loja fechada">${icone('moon')}fora do horário</span>`
        : c.quando === 'sempre'
          ? `<span class="chip vazado" title="Conferido com a loja aberta ou fechada">${icone('clock')}sempre</span>`
          : '',
      // o que a loja decide antes de perguntar à nuvem
      c.porteiro ? `<span class="chip vazado" title="Fora disso a olhada conta como nada a conferir e não vai à nuvem">${icone('user-round-check')}${ROTULO_DO_PORTEIRO[c.porteiro]}</span>` : '',
      c.janela ? `<span class="chip vazado">${icone('clock')}das ${c.janela[0]} às ${c.janela[1]}</span>` : '',
      c.comPadrao ? `<span class="chip vazado">${icone('image')}com a foto padrão</span>` : '',
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
      : tipo === 'comparacao'
        ? 'Quando a cena não é igual à foto padrão, este texto vai ao modelo como pergunta, com a foto ao lado. Descreva o que se vê, não o rótulo: “a superfície tem restos no canto” funciona melhor que “sujeira”.'
      : 'Este texto vai direto ao modelo como pergunta. Descreva o que se vê, não o rótulo: “a superfície tem restos no canto” funciona melhor que “sujeira”.';
    ajustarCamposNovos();
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
      const tipo = { estado: 'estado', 'presença': 'presenca', contagem: 'contagem', 'comparação': 'comparacao', 'ação': 'acao' }[editando && c ? c.tipo : 'estado'] || 'estado';
      $(`#fcr-t-${tipo}`).checked = true;
      $('#fcr-texto').value = editando && c ? c.texto : '';
      $(`#fcr-q-${editando && c && c.quando ? c.quando : 'no'}`).checked = true;
      ajustarTipo();
      prepararCamposNovos(c, editando);
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
    'excluir-padrao': {
      titulo: (n) => `Excluir a foto padrão “${n}”?`,
      corpo: () => {
        const sobram = PADROES_DO_CANAL.length - 1;
        return [
          sobram <= 0
            ? 'É a única foto padrão deste canal. <b>Sem ela, critério de comparação deixa de ser conferido aqui</b> e fica marcado com “falta a foto padrão”. Critério de estado que manda a foto junto passa a perguntar sem ela.'
            : `O canal continua com ${plural(sobram, 'foto padrão', 'fotos padrão')}: a loja compara com a que mais se parecer com a cena.`,
          'A imagem é apagada da nuvem e, na próxima batida do agente, do computador da loja.',
        ];
      },
      confirmar: 'Excluir foto',
      depois: (n) => {
        PADROES_DO_CANAL = PADROES_DO_CANAL.filter((f) => f.nome !== n);
        // sem foto não há o que mostrar ao lado: o quadro volta ao de agora
        if (!PADROES_DO_CANAL.length) padrao.vista = 'agora';
        padrao.foto = 0;
        desenharPadrao();
        return `Foto padrão “${n}” excluída.`;
      },
    },
    'excluir-equip': {
      titulo: (n) => `Excluir o equipamento “${n}”?`,
      corpo: () => {
        const e = EQUIPAMENTOS[feq.id];
        const n = e?.fotos.length ?? 0;
        return [
          n ? `${n === 1 ? 'A foto dele é apagada' : `As ${n} fotos dele são apagadas`}, junto com o cadastro.` : 'O cadastro é apagado. Ele ainda não tem foto.',
          ...(e?.descricao && e.aparece.length
            ? [`<b>A descrição dele deixa de ir junto</b> com as perguntas feitas à nuvem sobre ${e.aparece.map(([c]) => canalDe(c).nome).join(' e ')}.`]
            : []),
          'Os critérios que já existem continuam como estão.',
        ];
      },
      confirmar: 'Excluir equipamento',
      depois: (n) => {
        delete EQUIPAMENTOS[feq.id];
        desenharInventario();
        if (!$('[data-tela="ambiente"]').hidden) desenharAmbiente();
        return `“${n}” excluído do inventário.`;
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
  const prender = (v) => Math.min(1, Math.max(0, v));
  const limpo = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const CORES_DE_AREA = ['#F2B03C', '#5AA9FF', '#7FD08A', '#C792EA'];
  // A área é um CONTORNO de pontos, em fração do quadro (0 a 1). O agente
  // recorta esse desenho e apaga o que fica fora dele antes de analisar — é
  // o que impede uma área de invadir a outra.
  const ret = (x1, y1, x2, y2) => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
  const MAX_PONTOS = 24;
  let areas = [
    { nome: 'Dentro do balcão', pts: ret(0.04, 0.07, 0.44, 0.95), largura: 220, criterios: ['posto'] },
    { nome: 'Lado do cliente', pts: ret(0.56, 0.07, 0.93, 0.95), largura: 260, criterios: ['fila'] },
  ];
  let sel = 0;
  let arraste = null;
  let ativo = null;      // o ponto em que se está mexendo
  let historia = [];     // os desenhos de antes de cada gesto, para o "desfazer"
  let recusado = false;  // tentou salvar com o desenho torto
  let desenhada = null;  // a área que estava na tela: trocou, o "desfazer" recomeça

  // ── a conta do desenho: a mesma do console e do servidor ──
  const caixaDe = (pts) => {
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
  };
  const areaDe = (pts) => {
    let soma = 0;
    pts.forEach(([x1, y1], i) => {
      const [x2, y2] = pts[(i + 1) % pts.length];
      soma += x1 * y2 - x2 * y1;
    });
    return Math.abs(soma) / 2;
  };
  const contem = (pts, x, y) => {
    let dentro = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
    }
    return dentro;
  };
  const ladoDe = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const atravessam = (a, b, c, d) => {
    const d1 = ladoDe(a, b, c);
    const d2 = ladoDe(a, b, d);
    const d3 = ladoDe(c, d, a);
    const d4 = ladoDe(c, d, b);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  };
  const seCruza = (pts) => {
    const n = pts.length;
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        if (atravessam(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
      }
    }
    return false;
  };
  const problemaDoDesenho = (pts) =>
    seCruza(pts) ? 'O contorno passa por cima dele mesmo. Arraste os pontos até as linhas não se cruzarem.'
    : areaDe(pts) < 0.0001 ? 'A área ficou sem tamanho: os pontos estão em linha, ou em cima uns dos outros.'
    : null;
  const meioDoLado = (pts, i) => {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    return [(x1 + x2) / 2, (y1 + y2) / 2];
  };
  /** Quanto de `a` também está dentro de `b`, de 0 a 1, por amostragem. */
  const sobreposicao = (a, b, grade = 40) => {
    const c = caixaDe(a);
    let dentroDeA = 0;
    let nosDois = 0;
    for (let i = 0; i < grade; i += 1) {
      for (let j = 0; j < grade; j += 1) {
        const x = c.x1 + ((i + 0.5) / grade) * (c.x2 - c.x1);
        const y = c.y1 + ((j + 0.5) / grade) * (c.y2 - c.y1);
        if (!contem(a, x, y)) continue;
        dentroDeA += 1;
        if (contem(b, x, y)) nosDois += 1;
      }
    }
    return dentroDeA ? nosDois / dentroDeA : 0;
  };

  const guardar = () => {
    historia.push(areas[sel].pts.map((p) => [...p]));
    if (historia.length > 40) historia.shift();
  };
  const mudar = (pts) => {
    guardar();
    areas[sel].pts = pts;
    ativo = null;
    desenharArea();
  };
  const focarPonto = (i) => $(`[data-ar-ponto="${i}"]`)?.focus();

  function desenharArea(escreverCampos = true) {
    if (sel >= areas.length) sel = areas.length - 1;
    const a = areas[sel];
    if (a !== desenhada) {
      desenhada = a;
      historia = [];
      ativo = null;
      recusado = false;
    }
    const n = a.pts.length;
    const pc = (v) => `${(v * 100).toFixed(2)}%`;
    const cor = (i) => CORES_DE_AREA[i % CORES_DE_AREA.length];
    const noSvg = (pts) => pts.map(([x, y]) => `${(x * 100).toFixed(2)},${(y * 100).toFixed(2)}`).join(' ');
    const problema = problemaDoDesenho(a.pts);
    const traco = problema ? '#FF5A5F' : cor(sel);

    // As caixas carregam a etiqueta com o nome e o clique; o contorno de
    // cada área é desenhado no svg. A selecionada é a de traço cheio; as
    // outras ficam tracejadas, cada uma na sua cor.
    rets.innerHTML = areas
      .map((r, i) => {
        const c = caixaDe(r.pts);
        return (
          `<div class="ret${i === sel ? '' : ' outra'}" data-ret-i="${i}" data-rotulo="${limpo(r.nome)}" ` +
          `style="left:${pc(c.x1)};top:${pc(c.y1)};width:${pc(c.x2 - c.x1)};height:${pc(c.y2 - c.y1)};--cor:${cor(i)}"></div>`
        );
      })
      .join('');
    $('[data-ar-desenho]').innerHTML =
      areas
        .map((r, i) =>
          i === sel ? '' : `<polygon data-ar-outra="${i}" points="${noSvg(r.pts)}" fill="${cor(i)}" fill-opacity="0.18" stroke="${cor(i)}" stroke-width="2" stroke-dasharray="6 4"/>`,
        )
        .join('') +
      `<polygon points="${noSvg(a.pts)}" fill="none" stroke="rgba(4,8,14,.55)" stroke-width="4"/>` +
      `<polygon data-ar-sel points="${noSvg(a.pts)}" fill="none" stroke="${traco}" stroke-width="2" stroke-linejoin="round"/>`;
    // o que está FORA do contorno escurece: é o que o agente apaga
    fora.style.clipPath =
      `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ` +
      `${a.pts.map(([x, y]) => `${pc(x)} ${pc(y)}`).join(', ')}, ${pc(a.pts[0][0])} ${pc(a.pts[0][1])})`;

    // os pontos do contorno e, no meio de cada lado, o ponto que cria outro
    $('[data-ar-alcas]').innerHTML =
      (n < MAX_PONTOS
        ? a.pts
            .map((p, i) => {
              const q = a.pts[(i + 1) % n];
              if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.07) return '';
              const m = meioDoLado(a.pts, i);
              return (
                `<button type="button" class="ar-meio" data-ar-meio="${i}" style="left:${pc(m[0])};top:${pc(m[1])}" ` +
                `title="Arraste para criar um ponto aqui" aria-label="Criar um ponto entre o ${i + 1} e o ${((i + 1) % n) + 1}"></button>`
              );
            })
            .join('')
        : '') +
      a.pts
        .map(
          ([x, y], i) =>
            `<button type="button" class="ar-ponto" data-ar-ponto="${i}" aria-pressed="${ativo === i}" ` +
            `style="left:${pc(x)};top:${pc(y)};--cor:${traco}" ` +
            `aria-label="Ponto ${i + 1} de ${n}: a ${Math.round(x * 100)}% da esquerda e ${Math.round(y * 100)}% do topo. As setas movem${n > 3 ? '; Delete tira' : ''}."></button>`,
        )
        .join('');

    // a barra do desenho e os avisos
    $('[data-ar-conta]').textContent = ativo !== null && ativo < n ? `ponto ${ativo + 1} de ${n}` : `${n} pontos`;
    $('[data-ar-acrescentar]').disabled = n >= MAX_PONTOS;
    $('[data-ar-tirar]').disabled = ativo === null || ativo >= n || n <= 3;
    $('[data-ar-desfazer]').disabled = historia.length === 0;
    $('[data-ar-problema]').hidden = !problema;
    $('span', $('[data-ar-problema]')).textContent = problema || '';
    $('[data-ar-recusa]').hidden = !(recusado && problema);
    $('[data-ar-recusa]').textContent = problema ? `Não salvei. ${problema}` : '';
    // O que desta área também está dentro de OUTRA que tem critério: ali os
    // critérios da outra enxergam a mesma coisa. Dito, não proibido.
    $('[data-ar-invasoes]').innerHTML = problema
      ? ''
      : areas
          .map((r, i) => {
            if (i === sel || r.criterios.length === 0) return '';
            const parte = sobreposicao(a.pts, r.pts);
            if (parte < 0.03) return '';
            return (
              `<p class="aviso">${icone('triangle-alert')}<span>${Math.round(parte * 100)}% desta área também está dentro de “${limpo(r.nome)}”, ` +
              `que tem ${plural(r.criterios.length, 'critério', 'critérios')}: o que acontecer ali também é visto por ` +
              `${r.criterios.length === 1 ? 'ele' : 'eles'}. Para separar, ajuste o contorno de uma das duas.</span></p>`
            );
          })
          .join('');

    $('[data-ar-n]').textContent = String(n);
    if (escreverCampos) {
      $('#area-nome').value = a.nome;
      $('#area-largura').value = a.largura || '';
      $('[data-ar-lista]').innerHTML = a.pts
        .map(
          (p, i) =>
            `<li><span>${i + 1}</span>` +
            p
              .map(
                (v, eixo) =>
                  `<input class="entrada mono" type="number" min="0" max="100" step="0.5" value="${Math.round(v * 1000) / 10}" ` +
                  `data-ar-num="${i}" data-eixo="${eixo}" aria-label="Ponto ${i + 1}: % ${eixo === 0 ? 'da esquerda' : 'do topo'}">`,
              )
              .join('') +
            `<button class="btn fantasma quadrado mini" type="button" data-so-config data-ar-tirar-num="${i}" ${n <= 3 ? 'disabled' : ''} ` +
            `aria-label="Tirar o ponto ${i + 1}">${icone('trash-2')}</button></li>`,
        )
        .join('');
    }

    // a lista de áreas do canal
    const unica = areas.length === 1;
    $('[data-areas]').innerHTML = areas
      .map((r, i) => {
        const quantos = r.criterios.length;
        const excluir = unica
          ? 'disabled title="O canal precisa de pelo menos uma área"'
          : `data-dialogo="excluir-area" data-nome="${limpo(r.nome)}"`;
        return (
          `<li><button type="button" class="area-item" aria-pressed="${i === sel}" data-area-item="${i}">` +
          `<i class="cor" style="--c:${cor(i)}"></i>` +
          `<span><b>${limpo(r.nome)}</b><small>${quantos ? plural(quantos, 'critério', 'critérios') : 'sem critério'}</small></span></button>` +
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
    const fracao = Math.round(areaDe(a.pts) * 100);
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
  // Três gestos: arrastar um PONTO ajusta o contorno; arrastar o ponto do
  // MEIO de um lado cria um ponto novo; arrastar sobre a IMAGEM redesenha a
  // área como um retângulo. CLIQUE (sem arrastar) seleciona — e o arrasto
  // pode começar em cima de outra área: toda loja nova tem a área "Quadro
  // inteiro" cobrindo a imagem toda, e se apertar sobre ela já trocasse a
  // seleção, não sobrava onde começar a desenhar a segunda.
  quadro.addEventListener('pointerdown', (ev) => {
    // as áreas se desenham no quadro de agora, não na foto padrão
    if (quadro.dataset.vista !== 'agora') return;
    const soLe = app.dataset.perfil === 'supervisao';
    const noPonto = soLe ? null : ev.target.closest('[data-ar-ponto]');
    const noMeio = soLe ? null : ev.target.closest('[data-ar-meio]');
    quadro.setPointerCapture?.(ev.pointerId);
    const base = { ...posicao(ev), telaX: ev.clientX, telaY: ev.clientY, soLe };
    if (noPonto) {
      ativo = Number(noPonto.dataset.arPonto);
      arraste = { ...base, tipo: 'ponto', i: ativo, mexeu: false };
      desenharArea();
      return;
    }
    if (noMeio) {
      // apertar o ponto do meio já cria o ponto, e o mesmo gesto o arrasta
      const i = Number(noMeio.dataset.arMeio);
      guardar();
      areas[sel].pts.splice(i + 1, 0, meioDoLado(areas[sel].pts, i));
      ativo = i + 1;
      arraste = { ...base, tipo: 'ponto', i: ativo, mexeu: true };
      desenharArea();
      return;
    }
    arraste = { ...base, tipo: 'desenho', mexeu: false };
  });
  quadro.addEventListener('pointermove', (ev) => {
    if (!arraste) return;
    // mão que treme num clique não é arrasto
    if (!arraste.mexeu && Math.hypot(ev.clientX - arraste.telaX, ev.clientY - arraste.telaY) < 6) return;
    if (arraste.soLe) {
      // quem só vê não desenha — e o arrasto dele também não é um clique
      arraste.mexeu = true;
      return;
    }
    if (!arraste.mexeu) {
      arraste.mexeu = true;
      guardar();
    }
    const p = posicao(ev);
    if (arraste.tipo === 'ponto') {
      areas[sel].pts[arraste.i] = [p.x, p.y];
    } else {
      ativo = null;
      areas[sel].pts = ret(Math.min(arraste.x, p.x), Math.min(arraste.y, p.y), Math.max(arraste.x, p.x), Math.max(arraste.y, p.y));
    }
    desenharArea();
  });
  const soltar = (ev) => {
    if (!arraste) return;
    const gesto = arraste;
    arraste = null;
    if (gesto.tipo === 'ponto') {
      if (gesto.mexeu) focarPonto(gesto.i);
      return;
    }
    if (gesto.mexeu) {
      if (gesto.soLe) return;
      // risco fino: volta a área como estava, e esquece o "desfazer" dele
      const c = caixaDe(areas[sel].pts);
      if (c.x2 - c.x1 < 0.02 || c.y2 - c.y1 < 0.02) areas[sel].pts = historia.pop();
      desenharArea();
      return;
    }
    if (ev.type !== 'pointerup') return;
    // foi um clique: vale a MENOR área cujo contorno contém o ponto
    let alvo = -1;
    let menor = Infinity;
    areas.forEach((r, i) => {
      if (!contem(r.pts, gesto.x, gesto.y)) return;
      const tamanho = areaDe(r.pts);
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

  // o teclado: as setas movem o ponto em foco (Shift anda mais); Delete tira
  $('[data-ar-alcas]').addEventListener('keydown', (ev) => {
    const ponto = ev.target.closest('[data-ar-ponto]');
    if (!ponto) return;
    const i = Number(ponto.dataset.arPonto);
    const a = areas[sel];
    const passo = ev.shiftKey ? 0.02 : 0.005;
    const [x, y] = a.pts[i];
    const para = { ArrowLeft: [x - passo, y], ArrowRight: [x + passo, y], ArrowUp: [x, y - passo], ArrowDown: [x, y + passo] }[ev.key];
    if (para) {
      ev.preventDefault();
      guardar();
      a.pts[i] = [prender(para[0]), prender(para[1])];
      ativo = i;
      desenharArea();
      focarPonto(i);
      return;
    }
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && a.pts.length > 3) {
      ev.preventDefault();
      guardar();
      a.pts.splice(i, 1);
      ativo = Math.max(0, i - 1);
      desenharArea();
      focarPonto(ativo);
    }
  });
  $('[data-ar-alcas]').addEventListener('focusin', (ev) => {
    const ponto = ev.target.closest('[data-ar-ponto]');
    if (!ponto || arraste) return;
    const i = Number(ponto.dataset.arPonto);
    if (ativo === i) return;
    ativo = i;
    desenharArea();
    focarPonto(i);
  });
  // Enter no ponto do meio (teclado) cria o ponto ali
  $('[data-ar-alcas]').addEventListener('click', (ev) => {
    const meio = ev.target.closest('[data-ar-meio]');
    if (!meio || ev.detail !== 0 || areas[sel].pts.length >= MAX_PONTOS) return;
    const i = Number(meio.dataset.arMeio);
    guardar();
    areas[sel].pts.splice(i + 1, 0, meioDoLado(areas[sel].pts, i));
    ativo = i + 1;
    desenharArea();
    focarPonto(ativo);
  });

  const tirarPonto = (i) => {
    if (areas[sel].pts.length <= 3) return;
    guardar();
    areas[sel].pts.splice(i, 1);
    ativo = null;
    desenharArea();
  };
  $('[data-ar-acrescentar]').addEventListener('click', () => {
    const a = areas[sel];
    if (a.pts.length >= MAX_PONTOS) return;
    // no meio do lado mais comprido: é onde um ponto novo faz mais falta
    let i = 0;
    let maior = -1;
    a.pts.forEach((p, k) => {
      const q = a.pts[(k + 1) % a.pts.length];
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d > maior) {
        maior = d;
        i = k;
      }
    });
    guardar();
    a.pts.splice(i + 1, 0, meioDoLado(a.pts, i));
    ativo = i + 1;
    desenharArea();
  });
  $('[data-ar-tirar]').addEventListener('click', () => {
    if (ativo !== null) tirarPonto(ativo);
  });
  $('[data-ar-desfazer]').addEventListener('click', () => {
    const antes = historia.pop();
    if (!antes) return;
    areas[sel].pts = antes;
    ativo = null;
    desenharArea();
  });
  $('[data-ar-lista]').addEventListener('input', (ev) => {
    const campo = ev.target.closest('[data-ar-num]');
    if (!campo) return;
    const v = Number(campo.value) / 100;
    if (!Number.isFinite(v)) return;
    const i = Number(campo.dataset.arNum);
    guardar();
    areas[sel].pts[i][Number(campo.dataset.eixo)] = prender(v);
    ativo = i;
    desenharArea(false);
  });
  $('[data-ar-lista]').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-ar-tirar-num]');
    if (b) tirarPonto(Number(b.dataset.arTirarNum));
  });
  $('[data-ar-retangulo]').addEventListener('click', () => {
    const c = caixaDe(areas[sel].pts);
    mudar(ret(c.x1, c.y1, c.x2, c.y2));
  });
  $('[data-ar-salvar]').addEventListener('click', () => {
    // as mesmas recusas do servidor, ditas ao lado do botão
    recusado = problemaDoDesenho(areas[sel].pts) !== null;
    desenharArea(false);
    if (!recusado) avisar('Área salva. O agente usa a nova na próxima batida.');
  });
  $('#area-largura').addEventListener('input', () => {
    areas[sel].largura = Number($('#area-largura').value) || 0;
    desenharArea(false);
  });
  $('#area-nome').addEventListener('input', () => {
    areas[sel].nome = $('#area-nome').value.trim() || 'área';
    desenharArea(false);
  });
  $('[data-quadro-inteiro]').addEventListener('click', () => mudar(ret(0, 0, 1, 1)));
  $('[data-areas]').addEventListener('click', (ev) => {
    const item = ev.target.closest('[data-area-item]');
    if (!item) return;
    sel = Number(item.dataset.areaItem);
    desenharArea();
  });
  $('[data-nova-area]').addEventListener('click', () => {
    let n = areas.length + 1;
    while (areas.some((x) => x.nome === `Área ${n}`)) n += 1;
    areas.push({ nome: `Área ${n}`, pts: ret(0.3, 0.3, 0.7, 0.7), largura: 0, criterios: [] });
    sel = areas.length - 1;
    desenharArea();
    $('#area-nome').focus();
    $('#area-nome').select();
    avisar('Área criada. Arraste os pontos para marcar o contorno, dê um nome e salve.');
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

  // ═══════════════════════ foto padrão do canal ═══════════════════════
  // O ambiente limpo, organizado e sem ninguém na frente, guardado como
  // referência. A loja compara o quadro de agora com ela antes de perguntar
  // à nuvem; e, quando pergunta, a foto padrão vai junto. No protótipo a
  // "foto" é a mesma ilustração do quadro, sem as pessoas.
  //
  // Nenhuma é "a que vale": a loja compara com a que mais se parecer com a
  // cena. Clicar numa foto só escolhe qual aparece no quadro.
  const MAX_PADROES = 4;
  let PADROES_DO_CANAL = [
    { nome: 'Noite, loja aberta', quando: '02/10 · 22:10', quem: 'Ana Souza' },
    { nome: 'Antes de abrir', quando: '02/10 · 17:20', quem: 'Ana Souza', pessoas: 1 },
  ];
  const padrao = { vista: 'agora', corte: 50, foto: 0 };
  const cenaDoQuadro = $('svg', quadro);
  const cenaLimpa = cenaDoQuadro.cloneNode(true);
  for (const pessoa of $$('circle', cenaLimpa)) pessoa.remove();
  cenaLimpa.classList.add('padrao-camada');
  // desenho (svg) não tem a propriedade `hidden`: é pelo atributo
  cenaLimpa.setAttribute('hidden', '');
  cenaDoQuadro.after(cenaLimpa);
  const cortina = $('[data-cortina]');

  function desenharPadrao() {
    const tem = PADROES_DO_CANAL.length > 0;
    if (!tem) padrao.vista = 'agora';
    if (padrao.foto >= PADROES_DO_CANAL.length) padrao.foto = 0;
    const noQuadro = PADROES_DO_CANAL[padrao.foto];
    const v = padrao.vista;
    quadro.dataset.vista = v;
    for (const b of $$('[data-quadro-vista]')) {
      b.setAttribute('aria-pressed', String(b.dataset.quadroVista === v));
      b.disabled = !tem && b.dataset.quadroVista !== 'agora';
    }
    cenaLimpa.toggleAttribute('hidden', v === 'agora');
    cortina.hidden = v !== 'comparar';
    $('[data-rotulo-agora]').hidden = v !== 'comparar';
    $('[data-rotulo-padrao]').hidden = v !== 'comparar';
    quadro.style.setProperty('--corte', v === 'comparar' ? `${padrao.corte}%` : '0%');
    cortina.setAttribute('aria-valuenow', String(Math.round(padrao.corte)));
    $('[data-quadro-qual]').textContent = !tem
      ? 'Este canal ainda não tem foto padrão.'
      : v === 'agora' ? '' : `Foto padrão: ${noQuadro.nome}, guardada em ${noQuadro.quando}.`;
    $('[data-quadro-nota]').innerHTML =
      v === 'agora'
        ? '<span data-so-config>Arraste um ponto para ajustar o contorno. O ponto menor, no meio de cada lado, cria um ponto novo. ' +
          'Arrastar sobre a imagem redesenha a área como um retângulo. </span>' +
          'O que fica escuro está fora da área: o agente apaga antes de analisar. Clique em outra área, sem arrastar, para passar a mexer nela.'
      : v === 'padrao' ? 'É com esta imagem que a loja compara. As áreas se desenham no quadro de agora.'
      : 'Arraste o divisor: à esquerda, o quadro de agora; à direita, a foto padrão.';
    $('[data-padroes]').innerHTML = tem
      ? PADROES_DO_CANAL.map(
          (f, i) =>
            `<li><button class="padrao-ver" type="button" data-padrao-ver="${i}" aria-pressed="${v !== 'agora' && i === padrao.foto}" title="Ver esta foto no quadro">` +
            `<span class="retrato">${cenaLimpa.outerHTML.replace('class="padrao-camada"', '').replace(' hidden=""', '')}</span>` +
            // foto guardada com gente na frente compara pior: fica dito
            `<span><b>${limpo(f.nome)}</b><small>${f.quando} · ${f.quem}${f.pessoas ? ` · ${plural(f.pessoas, 'pessoa', 'pessoas')} no quadro` : ''}</small></span></button>` +
            `<button class="btn fantasma quadrado mini" type="button" data-dialogo="excluir-padrao" data-nome="${limpo(f.nome)}" data-so-config aria-label="Excluir a foto padrão ${limpo(f.nome)}">${icone('trash-2')}</button></li>`,
        ).join('')
      : '<li class="vazio-linha">Nenhuma foto padrão. Sem ela, critério de comparação não é conferido neste canal.</li>';
    // o canal guarda poucas: com o limite cheio, não há como guardar outra
    const cheio = PADROES_DO_CANAL.length >= MAX_PADROES;
    const guardar = $('[data-folha="folha-padrao"]');
    guardar.disabled = cheio;
    guardar.title = cheio ? `O canal já tem ${MAX_PADROES} fotos padrão: exclua uma para guardar outra` : '';
    $('[data-padroes-limite]').hidden = !cheio;
  }

  document.addEventListener('click', (ev) => {
    const vista = ev.target.closest('[data-quadro-vista]');
    if (vista && !vista.disabled) {
      padrao.vista = vista.dataset.quadroVista;
      desenharPadrao();
      return;
    }
    const ver = ev.target.closest('[data-padrao-ver]');
    if (ver) {
      padrao.foto = Number(ver.dataset.padraoVer);
      if (padrao.vista === 'agora') padrao.vista = 'padrao';
      desenharPadrao();
    }
  });

  // o divisor da comparação: arrasto e setas
  let puxando = false;
  const moverCortina = (clientX) => {
    const c = quadro.getBoundingClientRect();
    padrao.corte = Math.min(96, Math.max(4, ((clientX - c.left) / c.width) * 100));
    desenharPadrao();
  };
  cortina.addEventListener('pointerdown', (ev) => {
    puxando = true;
    cortina.setPointerCapture?.(ev.pointerId);
    ev.stopPropagation();
  });
  cortina.addEventListener('pointermove', (ev) => { if (puxando) moverCortina(ev.clientX); });
  cortina.addEventListener('pointerup', () => { puxando = false; });
  cortina.addEventListener('pointercancel', () => { puxando = false; });
  cortina.addEventListener('keydown', (ev) => {
    if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
    ev.preventDefault();
    padrao.corte = Math.min(96, Math.max(4, padrao.corte + (ev.key === 'ArrowLeft' ? -4 : 4)));
    desenharPadrao();
  });

  $('#f-padrao').addEventListener('submit', () => {
    PADROES_DO_CANAL.unshift({ nome: $('#fpa-nome').value.trim(), quando: '07/10 · 21:40', quem: 'Ana Souza', pessoas: 4 });
    padrao.foto = 0;
    desenharPadrao();
  }, { capture: true });
  document.addEventListener('click', (ev) => {
    // a gaveta de guardar abre sempre em branco
    if (ev.target.closest('[data-folha="folha-padrao"]')) {
      $('#fpa-nome').value = '';
      for (const c of $$('#f-padrao .caixa')) c.checked = false;
    }
  }, { capture: true });

  // ═══════════════════════ o critério: quando vale conferir ═══════════════════════
  // Três coisas novas na gaveta do critério, todas para a loja decidir antes
  // de perguntar à nuvem: comparar com a foto padrão, só conferir quando a
  // pergunta faz sentido (o "porteiro") e a faixa de horas.
  const ROTULO_DO_PORTEIRO = { pessoa: 'só com pessoa na área', livre: 'só com a área livre', movimento: 'só quando algo se mexe' };

  /** Os campos novos, postos no estado certo a cada vez que a gaveta abre. */
  function prepararCamposNovos(c, editando) {
    $(`#fcr-p-${editando && c?.porteiro ? c.porteiro : 'sempre'}`).checked = true;
    $('#fcr-ref').checked = Boolean(editando && c?.comPadrao);
    const janela = editando ? c?.janela : null;
    $('#fcr-janela').checked = Boolean(janela);
    $('[data-janela]').hidden = !janela;
    if (janela) [$('#fcr-j-de').value, $('#fcr-j-ate').value] = janela;
    $('#fcr-continua').selectedIndex = 0;
    ajustarCamposNovos();
  }

  function ajustarCamposNovos() {
    const tipo = $('input[name="fcr-tipo"]:checked').value;
    const pelaNuvem = tipo === 'estado' || tipo === 'acao';
    $('[data-comparacao]').hidden = tipo !== 'comparacao';
    // o porteiro vale para o que pode ir à nuvem; presença e contagem já são da loja
    $('[data-porteiro]').hidden = !pelaNuvem && tipo !== 'comparacao';
    $('[data-so-estado]').hidden = tipo !== 'estado';
    $('[data-so-acao]').hidden = tipo !== 'acao';
    if (tipo !== 'acao' && $('#fcr-p-movimento').checked) $('#fcr-p-sempre').checked = true;
  }
  $('#fcr-janela').addEventListener('change', (ev) => { $('[data-janela]').hidden = !ev.target.checked; });

  // Salvar um critério que já existe guarda as escolhas novas: é o que faz a
  // etiqueta aparecer na lista de critérios.
  $('#f-criterio').addEventListener('submit', () => {
    const c = CRITERIOS[contexto.criterio];
    if ($('#f-criterio').dataset.modo !== 'editar' || !c) return;
    const porteiro = $('input[name="fcr-porteiro"]:checked').value;
    c.porteiro = porteiro === 'sempre' || $('[data-porteiro]').hidden ? '' : porteiro;
    c.comPadrao = $('#fcr-ref').checked && !$('[data-so-estado]').hidden;
    c.janela = $('#fcr-janela').checked ? [$('#fcr-j-de').value, $('#fcr-j-ate').value] : null;
    desenharCriterios();
  }, { capture: true });

  // ═══════════════════════ padrões ═══════════════════════
  // O "especialista": com as análises guardadas por hora, diz como a loja
  // costuma funcionar (frequência), o que fugiu disso (anomalia), para onde
  // os números apontam (tendência) e o que fazer com os critérios
  // (sugestões). Tudo é conta sobre número guardado — a medida de cada
  // olhada, o que ficou fora do critério, o que não deu para avaliar.
  // Nenhuma imagem entra aqui.
  const PD_DIAS = 28; // o padrão é feito dos 28 dias antes de hoje
  const PD_HORAS = [18, 19, 20, 21, 22, 23, 0];
  const PD_DIA = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
  const PD_DIAS_PLURAL = ['segundas', 'terças', 'quartas', 'quintas', 'sextas', 'sábados', 'domingos'];
  const PD_ARTIGO = ['das', 'das', 'das', 'das', 'das', 'dos', 'dos'];
  const umaCasa = (v) => v.toFixed(1).replace('.', ',');
  const pessoas = (v) => `${umaCasa(v)} ${v >= 1.95 || v < 0.05 ? 'pessoas' : 'pessoa'}`;

  // O que dá para olhar: a medida (pessoas por olhada) ou a parte das
  // olhadas que ficou fora do critério / sem avaliar.
  const PD_INDICADORES = {
    // `nome` é o que o seletor da semana típica mostra; `rotulo`, o nome do critério
    fila: { nome: 'Fila no balcão: pessoas', rotulo: 'Fila no balcão', curto: 'pessoas', setor: 'Atendimento', series: [SI['fila-bal']], tipo: 'medida' },
    posto: { nome: 'Alguém no balcão: pessoas', rotulo: 'Alguém no balcão', curto: 'pessoas', setor: 'Atendimento', series: [SI['posto-bal']], tipo: 'medida' },
    chapa: { nome: 'Alguém na chapa no horário de pico: pessoas', rotulo: 'Alguém na chapa no horário de pico', curto: 'pessoas', setor: 'Cozinha', series: [SI['chapa-chp']], tipo: 'medida' },
    // a taxa é de cada canal: o critério que vale em dois canais aparece duas vezes, com o canal no nome
    bancada1: { nome: 'Bancada limpa entre pedidos fora do critério · Montagem 1', curto: 'fora do critério', setor: 'Cozinha', series: [SI['bancada-m1']], tipo: 'fora' },
    bancada2: { nome: 'Bancada limpa entre pedidos fora do critério · Montagem 2', curto: 'fora do critério', setor: 'Cozinha', series: [SI['bancada-m2']], tipo: 'fora' },
    toucaM1: { nome: 'Uso de touca sem conseguir avaliar · Montagem 1', curto: 'sem avaliar', setor: 'Cozinha', series: [SI['touca-m1']], tipo: 'na' },
    // usados nas contas (a tendência junta os canais do critério); não entram no seletor
    bancada: { setor: 'Cozinha', series: [SI['bancada-m1'], SI['bancada-m2']], tipo: 'fora' },
    filaFora: { setor: 'Atendimento', series: [SI['fila-bal']], tipo: 'fora' },
  };
  const PD_NO_SELETOR = ['fila', 'posto', 'chapa', 'bancada1', 'bancada2', 'toucaM1'];

  const pd = { setor: 'todos', lente: 'frequencia', indicador: 'fila', celula: '', filtro: 'rever', hoje: 'fila', alvo: null };

  /** As células da hora `h` do dia `d` que contam para o indicador. */
  const pdCelulas = (ind, d, h) => celulasDoDia(d).filter((c) => c.h === h && ind.series.includes(c.si));

  /** Junta células num valor: média de pessoas, ou % das olhadas. null = nada medido. */
  function pdJuntar(ind, cs) {
    if (!cs.length) return null;
    if (ind.tipo === 'medida') {
      const com = soma(cs.map((c) => c.com));
      return com ? soma(cs.map((c) => c.soma)) / com : null;
    }
    const n = soma(cs.map((c) => c.n));
    return n ? (soma(cs.map((c) => c[ind.tipo])) / n) * 100 : null;
  }
  const pdValor = (ind, d, h) => pdJuntar(ind, pdCelulas(ind, d, h));
  const pdTexto = (ind, v) => (v === null ? '—' : ind.tipo === 'medida' ? umaCasa(v) : `${Math.round(v)}%`);

  /** Hora que o responsável marcou como "foi só desta vez": fica de fora da conta. */
  const pdForaDaConta = (ind, d, h) =>
    PD_ANOMALIAS.some((a) => a.soDestaVez && a.d === d && a.h === h && PD_INDICADORES[a.ind].series.join() === ind.series.join());

  /**
   * O normal de um dia da semana e uma hora. Com `antesDe` (há quantos dias foi a hora que se está
   * comparando), é o que era costume ANTES dela: com os dias de depois na conta, o passado mudaria de cara.
   */
  function pdNormal(ind, dia, h, antesDe = -1) {
    const valores = [];
    for (let d = 1; d <= PD_DIAS; d += 1) {
      if ((antesDe >= 0 && d <= antesDe) || diaDaOperacao(d, h) !== dia || pdForaDaConta(ind, d, h)) continue;
      const v = pdValor(ind, d, h);
      if (v !== null) valores.push(v);
    }
    if (!valores.length) return null;
    const ordem = [...valores].sort((a, b) => a - b);
    const meio = ordem.length % 2 ? ordem[(ordem.length - 1) / 2] : (ordem[ordem.length / 2 - 1] + ordem[ordem.length / 2]) / 2;
    return { n: valores.length, media: soma(valores) / valores.length, mediana: meio, min: ordem[0], max: ordem[ordem.length - 1] };
  }

  /** Todas as células dos 28 dias que passam no filtro. */
  function pdPeriodo(filtro) {
    const saida = [];
    for (let d = 1; d <= PD_DIAS; d += 1) for (const c of celulasDoDia(d)) if (filtro(c)) saida.push(c);
    return saida;
  }
  const pdDoSetor = (item) => pd.setor === 'todos' || item.setor === pd.setor || item.setor === 'loja';

  // ── as saídas do padrão ──
  // A lista é a do protótipo; os números de cada uma (o que foi visto, o
  // normal, a faixa) saem dos mesmos dados da tela Análises.
  const PD_ANOMALIAS = [
    {
      id: 'balcao-1', d: 1, h: 20, ind: 'posto', onde: 'Balcão · Dentro do balcão', setor: 'Atendimento', grave: true, estado: 'rever',
      titulo: '“Alguém no balcão”: menos pessoas do que o normal',
      // as 20h são do pico, e às 21h o costume pede o mesmo: o critério proposto vale para o pico inteiro
      criterio: {
        nome: 'Pelo menos 2 em Balcão · Dentro do balcão no pico', tipo: 'contagem', minimo: 2, lugar: 'Balcão/Dentro do balcão', janela: ['20:00', '22:00'],
        regra: 'pelo menos 2 × pessoa', texto: 'Das 20h às 22h há pelo menos 2 pessoas em Balcão · Dentro do balcão.',
      },
    },
    {
      id: 'fila-abertura', d: 5, h: 18, ind: 'fila', onde: 'Balcão · Lado do cliente', setor: 'Atendimento', estado: 'rever',
      titulo: '“Fila no balcão”: mais pessoas do que o normal',
      // fora do pico, o critério proposto é só daquela hora
      criterio: {
        nome: 'No máximo 3 em Balcão · Lado do cliente às 18h', tipo: 'contagem', maximo: 3, lugar: 'Balcão/Lado do cliente', janela: ['18:00', '19:00'],
        regra: 'no máximo 3 × pessoa', texto: 'Das 18h às 19h há no máximo 3 pessoas em Balcão · Lado do cliente.',
      },
    },
    { id: 'bancada-m2', d: 3, h: 21, ind: 'bancada2', onde: 'Montagem 2', setor: 'Cozinha', estado: 'rever', titulo: '“Bancada limpa entre pedidos” fora do critério por muito mais tempo', ajustar: 'bancada' },
    { id: 'touca-m1', d: 0, h: 19, ind: 'toucaM1', onde: 'Montagem 1', setor: 'Cozinha', estado: 'rever', camera: true, titulo: '“Uso de touca” quase parou de conseguir avaliar', ajustar: 'touca' },
    {
      id: 'balcao-cheio', d: 11, h: 22, ind: 'posto', onde: 'Balcão · Dentro do balcão', setor: 'Atendimento', estado: 'esperado', soDestaVez: true,
      titulo: '“Alguém no balcão”: mais pessoas do que o normal',
      revisao: { quem: 'Ana Souza', quando: '27/09', texto: 'Jogo na TV: reforcei o balcão. Foi só desta vez: esta hora ficou de fora da conta do padrão.' },
    },
    {
      id: 'bancada-m1', d: 12, h: 21, ind: 'bancada1', onde: 'Montagem 1', setor: 'Cozinha', estado: 'problema',
      titulo: '“Bancada limpa entre pedidos” fora do critério por muito mais tempo',
      revisao: {
        quem: 'Ana Souza', quando: '26/09', texto: 'Estávamos com um a menos na montagem. Passei a escalar três às sextas.',
        virou: 'Abriu “Bancada limpa entre pedidos” para ajuste.',
      },
    },
  ];

  const pdQuando = (d) => (d === 0 ? 'hoje' : d === 1 ? 'ontem' : rotuloDoDia(d));
  const pdHoras = (h) => `${hh(h)} às ${hh((h + 1) % 24)}`;

  /** Os números de uma saída do padrão: o que foi visto, o normal e a frase da conta. */
  function pdMedir(a) {
    const ind = PD_INDICADORES[a.ind];
    const dia = diaDaOperacao(a.d, a.h);
    const visto = pdValor(ind, a.d, a.h);
    const normal = pdNormal(ind, dia, a.h, a.d);
    const nome = `${PD_ARTIGO[dia]} ${PD_DIAS_PLURAL[dia]} às ${hh(a.h)}`;
    const masculino = PD_ARTIGO[dia] === 'dos';
    const anteriores = normal.n === 1 ? `n${masculino ? 'o' : 'a'} ${PD_DIA[dia]} anterior` : `n${masculino ? 'os' : 'as'} ${normal.n} ${PD_DIAS_PLURAL[dia]} anteriores`;
    const faixa = `de ${pdTexto(ind, normal.min)} a ${pdTexto(ind, normal.max)} ${anteriores}`;
    const conta =
      ind.tipo === 'medida'
        ? `Visto: <b>${pessoas(visto)}</b> em média. Normal ${nome}: <b>${umaCasa(normal.mediana)}</b> (${faixa}).`
        : ind.tipo === 'fora'
          ? `Fora do critério em <b>${Math.round(visto)}%</b> das olhadas. Normal ${nome}: <b>${Math.round(normal.mediana)}%</b> (${faixa}).`
          : `Sem conseguir avaliar em <b>${Math.round(visto)}%</b> das olhadas. Normal ${nome}: <b>${Math.round(normal.mediana)}%</b> (${faixa}).`;
    const curto =
      ind.tipo === 'medida'
        ? `${pessoas(visto)} em média; o normal ${nome} é ${umaCasa(normal.mediana)}`
        : `${Math.round(visto)}% das olhadas; o normal ${nome} é ${Math.round(normal.mediana)}%`;
    return { ind, dia, visto, normal, conta, curto };
  }

  /** O que mais dá para dizer daquela hora, tirado dos mesmos números. */
  function pdMais(a) {
    const ind = PD_INDICADORES[a.ind];
    const [c] = pdCelulas(ind, a.d, a.h);
    if (ind.tipo === 'medida') {
      // O critério olha o limite dele, e não o costume: é por isso que a hora fugiu do padrão sem (ou quase
      // sem) aviso. A frase só entra quando o que foi visto não passou do limite.
      const limite = { 'balcao-1': ' Ele só pede 1, não o que é costume nessa hora.', 'fila-abertura': ' Ele olha o limite de 6, não o que é costume nessa hora.' }[a.id] ?? '';
      return `Na mesma hora, o critério ficou fora em ${Math.round((c.fora / c.n) * 100)}% das olhadas e avisou ${plural(c.avisos, 'vez', 'vezes')}.${limite}`;
    }
    if (ind.tipo === 'fora') {
      // Depois de avisar, o critério fica o período de silêncio sem olhar: a taxa é só da parte da hora que
      // foi olhada. Quando o silêncio tirou um quarto das olhadas, ou mais, a frase diz.
      const emSilencio = a.id === 'bancada-m2' ? Math.round(c.n * 0.4) : 0;
      const oSilencio = emSilencio ? ` Depois de avisar, ele ficou em silêncio em ${emSilencio} das ${c.n + emSilencio} olhadas da hora: a taxa é só das que ele fez.` : '';
      return `Foram ${c.fora} olhadas fora do critério em ${c.n}; o critério avisou ${plural(c.avisos, 'vez', 'vezes')} — uma por período de silêncio.${oSilencio}`;
    }
    return 'Quando é a avaliação que some de uma hora para outra, costuma ser a câmera: mexeram nela ou algo ficou na frente.';
  }

  const pdARever = () => PD_ANOMALIAS.filter((a) => a.estado === 'rever');

  function pdContarRever() {
    const n = pdARever().length;
    for (const e of $$('[data-pd-rever]')) {
      e.hidden = n === 0;
      e.innerHTML = `<span class="so-leitor">saídas do padrão para rever: </span>${n}`;
    }
  }

  // ── frequência ──
  /** A semana típica do indicador: uma média por dia da semana e hora. */
  function pdSemana(ind) {
    const grade = new Map();
    for (let dia = 0; dia < 7; dia += 1) {
      for (const h of PD_HORAS) {
        const normal = pdNormal(ind, dia, h);
        if (normal) grade.set(`${dia}|${h}`, normal);
      }
    }
    return grade;
  }

  /** O que se repete num setor, dito em frases feitas dos números. */
  /** As horas seguidas, em volta da mais alta, que ficam perto dela: é o pico (a mesma conta do servidor). */
  function pdPico(grade) {
    const porHora = new Map();
    for (const [chave, v] of grade) {
      const h = Number(chave.split('|')[1]);
      porHora.set(h, [...(porHora.get(h) ?? []), v.media]);
    }
    const ordem = (h) => (h - 6 + 24) % 24; // o dia da operação vira às 6h
    const perfil = [...porHora].map(([h, vs]) => [h, soma(vs) / vs.length]).sort((a, b) => ordem(a[0]) - ordem(b[0]));
    if (perfil.length < 3) return null;
    const topo = perfil.reduce((a, b) => (b[1] > a[1] ? b : a));
    const i = perfil.indexOf(topo);
    let [de, ate] = [i, i];
    const perto = (k) => perfil[k][1] >= topo[1] * 0.75;
    while (de > 0 && perto(de - 1)) de -= 1;
    while (ate < perfil.length - 1 && perto(ate + 1)) ate += 1;
    // pico que é o dia inteiro não é pico
    if (ate - de + 1 > perfil.length * 0.6) return null;
    const doPico = perfil.slice(de, ate + 1);
    return { de: doPico[0][0], ate: doPico[doPico.length - 1][0], horas: new Set(doPico.map((x) => x[0])), media: soma(doPico.map((x) => x[1])) / doPico.length };
  }

  /**
   * Cada setor em frases, montadas dos números: o movimento (a medida), as duas maiores taxas "fora do
   * critério" (por critério, juntando os canais do setor) e os dois canais que menos conseguem avaliar.
   */
  function pdSetores() {
    const celulasDe = (series) => pdPeriodo((c) => series.includes(c.si));
    const taxa = (cs, campo) => (soma(cs.map((c) => c[campo])) / Math.max(1, soma(cs.map((c) => c.n)))) * 100;
    const descrever = ({ setor, medidas, foras, nas }) => {
      const frases = [];
      const fatos = [];
      let pico = null;
      medidas.forEach(({ k, onde }, n) => {
        const ind = PD_INDICADORES[k];
        const grade = pdSemana(ind);
        const p = pdPico(grade);
        if (n === 0) pico = p;
        if (p) {
          frases.push(`Em ${onde}, o movimento tem pico das ${hh(p.de)} às ${hh((p.ate + 1) % 24)}: ${pessoas(p.media)}, em média.`);
          if (n === 0) fatos.push(['Pico', `${hh(p.de)} às ${hh((p.ate + 1) % 24)}`]);
        } else {
          frases.push(`Em ${onde} há ${pessoas(pdJuntar(ind, celulasDe(ind.series)))}, em média, sem hora de pico marcada.`);
        }
        const [chave, topo] = [...grade].reduce((a, b) => (b[1].media > a[1].media ? b : a));
        const [dia, h] = chave.split('|').map(Number);
        fatos.push([n === 0 ? 'Hora mais cheia' : `Hora mais cheia · ${onde}`, `${PD_DIA[dia]} às ${hh(h)}, ${pessoas(topo.media)}`]);
      });
      foras
        .map((f) => {
          const cs = celulasDe(f.series);
          return { ...f, geral: taxa(cs, 'fora'), noPico: pico ? taxa(cs.filter((c) => pico.horas.has(c.h)), 'fora') : null };
        })
        .filter((f) => f.geral >= 1)
        .sort((a, b) => b.geral - a.geral)
        .slice(0, 2)
        .forEach((f) => {
          const comPico = f.noPico !== null && Math.abs(f.noPico - f.geral) >= 2;
          frases.push(`“${f.nome}”${f.onde ? ` (${f.onde})` : ''} fica fora do critério em ${Math.round(f.geral)}% das olhadas${comPico ? ` — ${Math.round(f.noPico)}% no pico.` : '.'}`);
          if (fatos.length < 4) fatos.push([`${f.nome} fora do critério`, comPico ? `${Math.round(f.geral)}% · ${Math.round(f.noPico)}% no pico` : `${Math.round(f.geral)}%`]);
        });
      nas
        .map((x) => ({ ...x, geral: taxa(celulasDe(x.series), 'na') }))
        .filter((x) => x.geral >= 30)
        .sort((a, b) => b.geral - a.geral)
        .slice(0, 2)
        .forEach((x) => {
          frases.push(`Em ${x.onde}, “${x.nome}” não dá para avaliar em ${Math.round(x.geral)}% das olhadas.`);
          if (fatos.length < 4) fatos.push([`${x.nome} sem avaliar (${x.onde})`, `${Math.round(x.geral)}% das olhadas`]);
        });
      return { setor, texto: frases.join(' '), fatos };
    };

    return [
      descrever({
        setor: 'Atendimento',
        medidas: [{ k: 'fila', onde: 'Balcão · Lado do cliente' }, { k: 'posto', onde: 'Balcão · Dentro do balcão' }],
        // num canal só, e numa área que tem nome, a frase diz onde
        foras: [
          { nome: 'Fila no balcão', onde: 'Balcão · Lado do cliente', series: [SI['fila-bal']] },
          { nome: 'Alguém no balcão', onde: 'Balcão · Dentro do balcão', series: [SI['posto-bal']] },
        ],
        nas: [],
      }),
      descrever({
        setor: 'Cozinha',
        medidas: [{ k: 'chapa', onde: 'Chapa' }],
        foras: [
          { nome: 'Bancada limpa entre pedidos', series: [SI['bancada-m1'], SI['bancada-m2']] },
          { nome: 'Alguém na chapa no horário de pico', series: [SI['chapa-chp']] },
          { nome: 'Uso de touca', series: [SI['touca-chp'], SI['touca-m1'], SI['touca-m2']] },
          { nome: 'Cesto fora do óleo com a fritadeira parada', series: [SI['cesto-fri']] },
        ],
        nas: [
          { nome: 'Uso de touca', onde: 'Chapa', series: [SI['touca-chp']] },
          { nome: 'Uso de touca', onde: 'Montagem 1', series: [SI['touca-m1']] },
          { nome: 'Uso de touca', onde: 'Montagem 2', series: [SI['touca-m2']] },
        ],
      }),
      { setor: 'Estoque', vazio: 'Nenhum critério mede este setor: não há do que fazer um padrão. Um critério de presença ou de contagem já basta para começar.' },
    ];
  }

  /** As relações: a mesma taxa, medida em duas situações. */
  function pdRelacoes() {
    const taxaEm = (cs, campo) => {
      const n = soma(cs.map((c) => c.n));
      return n ? (soma(cs.map((c) => c[campo])) / n) * 100 : 0;
    };
    const forca = (a, b) => {
      const maior = Math.max(a, b);
      const menor = Math.max(Math.min(a, b), 0.01);
      return maior / menor >= 2 ? 'forte' : maior / menor >= 1.3 ? 'moderada' : 'nenhuma';
    };
    const noPico = (c) => c.h >= 19 && c.h <= 22;

    // 1 · gente atrás do balcão × fila acima do combinado, só nas horas de movimento
    const fila = pdPeriodo((c) => c.si === SI['fila-bal'] && noPico(c));
    const pouca = fila.filter((c) => medidaDaHora(SI['posto-bal'], c.d, c.h) < 1.5);
    const bastante = fila.filter((c) => medidaDaHora(SI['posto-bal'], c.d, c.h) >= 1.5);
    const r1 = [taxaEm(pouca, 'fora'), taxaEm(bastante, 'fora')];

    // 2 · gente na chapa × bancada fora do critério em Montagem 1 (a relação é de cada canal)
    const bancada = pdPeriodo((c) => c.si === SI['bancada-m1'] && noPico(c));
    const cheia = bancada.filter((c) => medidaDaHora(SI['chapa-chp'], c.d, c.h) >= 1.5);
    const normal = bancada.filter((c) => medidaDaHora(SI['chapa-chp'], c.d, c.h) < 1.5);
    const r2 = [taxaEm(cheia, 'fora'), taxaEm(normal, 'fora')];

    // 3 · movimento × "não deu para avaliar" da touca: não anda junto
    const touca = pdPeriodo((c) => c.si === SI['touca-m1']);
    const comMovimento = touca.filter(noPico);
    const semMovimento = touca.filter((c) => !noPico(c));
    const r3 = [taxaEm(comMovimento, 'na'), taxaEm(semMovimento, 'na')];

    const horas = (cs) => new Set(cs.map((c) => `${c.d}|${c.h}`)).size;
    const mesmasHoras = 'comparando as mesmas horas do dia (19h, 20h, 21h, 22h)';
    // relação que não é relação: as duas barras calmas
    const calma = (r, i) => forca(...r) === 'nenhuma' || r[i] <= r[1 - i];
    return [
      {
        setor: 'Atendimento', pergunta: 'Pessoas em Balcão · Dentro do balcão × “Fila no balcão”', forca: forca(...r1),
        titulo: 'Com menos de 2 em Balcão · Dentro do balcão, “Fila no balcão” fica mais tempo fora do critério',
        linhas: [['Com menos de 2 em Balcão · Dentro do balcão', r1[0], calma(r1, 0)], ['Com 2 ou mais', r1[1], calma(r1, 1)]],
        pe: `${plural(horas(pouca), 'hora', 'horas')} com menos de 2 · ${horas(bastante)} com 2 ou mais · ${mesmasHoras}`, sufixo: 'das olhadas de “Fila no balcão” fora do critério',
      },
      {
        setor: 'Cozinha', pergunta: 'Pessoas em Chapa × “Bancada limpa entre pedidos” em Montagem 1', forca: forca(...r2),
        titulo: 'Com 2 ou mais em Chapa, “Bancada limpa entre pedidos” em Montagem 1 fica mais tempo fora do critério',
        linhas: [['Com menos de 2 em Chapa', r2[1], calma(r2, 1)], ['Com 2 ou mais', r2[0], calma(r2, 0)]],
        pe: `${plural(horas(normal), 'hora', 'horas')} com menos de 2 · ${horas(cheia)} com 2 ou mais · ${mesmasHoras}`, sufixo: 'das olhadas de “Bancada limpa entre pedidos” em Montagem 1 fora do critério',
      },
      {
        setor: 'Cozinha', pergunta: 'Movimento × “Uso de touca” sem avaliar em Montagem 1', forca: forca(...r3),
        titulo: '“Uso de touca” em Montagem 1 fica sem avaliar com a loja cheia ou vazia: não é o movimento',
        linhas: [['Das 19h às 23h', r3[0], calma(r3, 0)], ['Nas outras horas', r3[1], calma(r3, 1)]],
        pe: 'Quando a taxa não muda com a hora, o problema é o que a câmera mostra — veja a sugestão de marcar a área.', sufixo: 'das olhadas sem conseguir avaliar',
      },
    ];
  }

  // ── tendência ──
  /** A inclinação por semana (mínimos quadrados) e há quantas semanas anda no mesmo sentido. */
  function pdRumo(serie) {
    const n = serie.length;
    const mx = (n - 1) / 2;
    const my = soma(serie) / n;
    const inclina = soma(serie.map((v, i) => (i - mx) * (v - my))) / soma(serie.map((_, i) => (i - mx) ** 2));
    let seguidas = 0;
    for (let i = n - 1; i > 0; i -= 1) {
      if (Math.sign(serie[i] - serie[i - 1]) !== Math.sign(inclina) || serie[i] === serie[i - 1]) break;
      seguidas += 1;
    }
    const muda = Math.abs(serie[n - 1] - serie[0]) / Math.max(Math.abs(my), 0.001);
    return { inclina, seguidas, sentido: muda < 0.06 ? 'estável' : inclina > 0 ? 'sobe' : 'cai' };
  }

  function pdTendencias() {
    const semanas = [3, 2, 1, 0]; // da mais antiga para a mais recente
    const diasDa = (w) => Array.from({ length: 7 }, (_, i) => w * 7 + 1 + i);
    const dataDe = (dias) => {
      const t = new Date(AN_HOJE + dias * 86400000);
      return `${String(t.getUTCDate()).padStart(2, '0')}/${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
    };

    // 1 · a fila no pico de sábado
    const sabados = [25, 18, 11, 4].map((d) => pdValor(PD_INDICADORES.fila, d, 20));
    const rFila = pdRumo(sabados);
    const faltam = rFila.inclina > 0 ? Math.round((6 - sabados[3]) / rFila.inclina) : 0;

    // 2 · a bancada fora do critério, semana a semana
    const bancada = semanas.map((w) => pdJuntar(PD_INDICADORES.bancada, diasDa(w).flatMap((d) => celulasDoDia(d).filter((c) => PD_INDICADORES.bancada.series.includes(c.si)))));
    const rBancada = pdRumo(bancada);

    // 3 · o gasto com a nuvem, por dia
    const custo = semanas.map((w) => soma(diasDa(w).flatMap((d) => celulasDoDia(d).map((c) => c.custo))) / 6); // seis dias abertos por semana
    const rCusto = pdRumo(custo);

    // 4 · o disco da máquina de análise
    const disco = [21, 14, 7, 0].map((d) => AN_MAQUINA.discoLivreHojeGb + AN_MAQUINA.discoPorDiaGb * d);
    const diasAteEncher = Math.round(AN_MAQUINA.discoLivreHojeGb / AN_MAQUINA.discoPorDiaGb);

    const setas = (serie, f) => serie.map(f).join(' → ');
    return [
      {
        setor: 'Atendimento', titulo: 'Fila no balcão no pico de sábado', serie: sabados, rumo: rFila, limite: 6, ruim: 'sobe',
        valor: `${umaCasa(sabados[3])}<small> pessoas, sábado às 20h</small>`,
        texto:
          `<b>${setas(sabados, umaCasa)}</b> nos últimos quatro sábados. ` +
          (rFila.sentido === 'sobe' && faltam > 0
            ? `No mesmo ritmo, a média da hora encosta no limite de 6 em cerca de ${plural(faltam, 'semana', 'semanas')}.`
            : 'Sem mudança que peça ação.'),
      },
      {
        setor: 'Cozinha', titulo: 'Bancada limpa entre pedidos fora do critério', serie: bancada, rumo: rBancada, ruim: 'sobe',
        valor: `${Math.round(bancada[3])}%<small> das olhadas, na última semana</small>`,
        texto: `<b>${setas(bancada, (v) => `${Math.round(v)}%`)}</b> nas últimas quatro semanas, em Montagem 1 e Montagem 2. Há uma correção registrada em 26/09, em Montagem 1.`,
      },
      {
        setor: 'loja', titulo: 'Gasto com a nuvem', serie: custo, rumo: rCusto, ruim: 'sobe',
        valor: `${dinheiro(custo[3])}<small> por dia com análise</small>`,
        texto: `<b>${setas(custo, dinheiro)}</b> por dia, semana a semana. ${rCusto.sentido === 'estável' ? 'Não mudou: o gasto acompanha o número de critérios que vão à nuvem, não o movimento.' : ''}`,
      },
      {
        setor: 'loja', titulo: 'Disco da máquina de análise', serie: disco, rumo: pdRumo(disco), ruim: 'cai',
        valor: `${Math.round(disco[3])}<small> GB livres de ${AN_MAQUINA.discoGb}</small>`,
        texto: `<b>${String(AN_MAQUINA.discoPorDiaGb).replace('.', ',')} GB a menos por dia.</b> Nesse ritmo o disco enche em cerca de ${diasAteEncher} dias, por volta de ${dataDe(diasAteEncher)}.`,
      },
    ];
  }

  /** O fio de uma tendência: quatro pontos, o último em destaque. */
  function pdFio(serie, limite) {
    const L = 132;
    const A = 44;
    let maior = Math.max(...serie, limite ?? -Infinity);
    let menor = Math.min(...serie, limite ?? Infinity);
    // variação pequena não pode parecer um vale: a régua tem pelo menos um
    // terço do valor de altura
    const minimo = (Math.abs(soma(serie)) / serie.length) * 0.34;
    if (maior - menor < minimo) {
      const meio = (maior + menor) / 2;
      maior = meio + minimo / 2;
      menor = meio - minimo / 2;
    }
    const folga = (maior - menor || 1) * 0.18;
    const x = (i) => 6 + (i * (L - 12)) / (serie.length - 1);
    const y = (v) => A - 6 - ((v - (menor - folga)) / (maior - menor + 2 * folga)) * (A - 12);
    const pts = serie.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    return (
      `<svg class="fio" viewBox="0 0 ${L} ${A}" aria-hidden="true">` +
      (limite !== undefined ? `<line class="limite" x1="0" x2="${L}" y1="${y(limite).toFixed(1)}" y2="${y(limite).toFixed(1)}"/>` : '') +
      `<polyline points="${pts}"/>` +
      serie.map((v, i) => `<circle${i === serie.length - 1 ? ' class="ultimo"' : ''} cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${i === serie.length - 1 ? 4.5 : 3}"/>`).join('') +
      `</svg>`
    );
  }

  /** Hoje contra o normal do mesmo dia da semana, hora a hora. */
  function pdHoje() {
    const ind = PD_INDICADORES[pd.hoje];
    const dia = diaDaSemana(0);
    const horas = PD_HORAS.filter((h) => h >= 6 && pdNormal(ind, dia, h));
    const normais = horas.map((h) => pdNormal(ind, dia, h));
    const hoje = horas.map((h) => pdValor(ind, 0, h));
    const teto = Math.max(1, Math.ceil(Math.max(...normais.map((n) => n.max), ...hoje.filter((v) => v !== null)) * 1.15));

    // desenhado no tamanho em que aparece: a letra não cresce no computador
    // nem some no celular
    const L = Math.max(280, Math.round($('[data-pd-hoje]').clientWidth) || 640);
    const A = L < 480 ? 190 : 230;
    const m = { e: 30, d: 10, c: 14, b: 26 };
    const passo = (L - m.e - m.d) / horas.length;
    const x = (i) => m.e + passo * (i + 0.5);
    const y = (v) => m.c + (1 - v / teto) * (A - m.c - m.b);
    const agoraX = m.e + passo * (AN_AGORA_MIN / 60 - horas[0]);
    const banda =
      normais.map((n, i) => `${x(i).toFixed(1)},${y(n.max).toFixed(1)}`).join(' ') + ' ' +
      [...normais].reverse().map((n, i) => `${x(normais.length - 1 - i).toFixed(1)},${y(n.min).toFixed(1)}`).join(' ');
    const linhaNormal = normais.map((n, i) => `${x(i).toFixed(1)},${y(n.media).toFixed(1)}`).join(' ');
    const vistos = hoje.map((v, i) => (v === null ? null : [x(i), y(v)])).filter(Boolean);

    $('[data-pd-hoje-titulo]').textContent = `Hoje contra o normal ${PD_ARTIGO[dia]} ${PD_DIAS_PLURAL[dia]}`;
    $('[data-pd-hoje]').innerHTML =
      `<svg class="hn" viewBox="0 0 ${L} ${A}" width="${L}" height="${A}" role="img" aria-label="${ind.rotulo}: hoje até agora, comparado com a faixa do normal ${PD_ARTIGO[dia]} ${PD_DIAS_PLURAL[dia]}.">` +
      [teto, teto / 2].map((v) => `<line class="grade" x1="${m.e}" x2="${L - m.d}" y1="${y(v)}" y2="${y(v)}"/><text x="${m.e - 6}" y="${y(v) + 4}" text-anchor="end">${String(v).replace('.', ',')}</text>`).join('') +
      `<line class="base" x1="${m.e}" x2="${L - m.d}" y1="${y(0)}" y2="${y(0)}"/><text x="${m.e - 6}" y="${y(0) + 4}" text-anchor="end">0</text>` +
      `<rect class="depois" x="${agoraX.toFixed(1)}" y="${m.c}" width="${(L - m.d - agoraX).toFixed(1)}" height="${A - m.c - m.b}"/>` +
      `<polygon class="banda" points="${banda}"/>` +
      `<polyline class="normal" points="${linhaNormal}"/>` +
      `<polyline class="hoje" points="${vistos.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ')}"/>` +
      vistos.map(([cx, cy]) => `<circle class="hoje-pt" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4.5"/>`).join('') +
      `<line class="agora" x1="${agoraX.toFixed(1)}" x2="${agoraX.toFixed(1)}" y1="${m.c}" y2="${y(0)}"/>` +
      `<text class="agora-txt" x="${(agoraX + 5).toFixed(1)}" y="${m.c + 10}">agora</text>` +
      horas.map((h, i) => `<text x="${x(i).toFixed(1)}" y="${A - 8}" text-anchor="middle">${hh(h)}</text>`).join('') +
      `</svg>`;

    // a frase: o que já saiu da faixa e o que se espera daqui em diante
    const fora = horas.filter((h, i) => hoje[i] !== null && h * 60 + 60 <= AN_AGORA_MIN && (hoje[i] > normais[i].max * 1.15 || hoje[i] < normais[i].min * 0.85));
    const frente = horas.map((h, i) => [h, normais[i]]).filter(([h]) => h * 60 >= AN_AGORA_MIN);
    $('[data-pd-hoje-nota]').textContent =
      (fora.length ? `Fora da faixa do normal: ${fora.map(hh).join(', ')}. ` : 'Até agora, o dia está dentro do normal. ') +
      (frente.length
        ? `O esperado daqui em diante: ${frente.map(([h, n]) => `${pdTexto(ind, n.media)} às ${hh(h)}`).join(', ')}.`
        : 'Não há mais hora com padrão hoje.') +
      ' A hora corrente ainda está incompleta.';
    // as opções levam o nome do critério; com uma só não há o que escolher
    const doSetor = ['fila', 'posto', 'chapa'].filter((k) => pdDoSetor(PD_INDICADORES[k]));
    $('[data-pd-hoje-seg]').hidden = doSetor.length < 2;
    $('[data-pd-hoje-seg]').innerHTML = doSetor
      .map((k) => `<button type="button" data-pd-hoje-ind="${k}" aria-pressed="${pd.hoje === k}">${PD_INDICADORES[k].rotulo}</button>`)
      .join('');
  }

  // ── sugestões ──
  function pdSugestoes() {
    const taxa = (cs, campo) => (soma(cs.map((c) => c[campo])) / Math.max(1, soma(cs.map((c) => c.n)))) * 100;
    const semResposta = (cs) => soma(cs.map((c) => (c.custo * c.na) / c.n));
    const toucaM1 = pdPeriodo((c) => c.si === SI['touca-m1']);
    const toucaM2 = pdPeriodo((c) => c.si === SI['touca-m2']);
    const descoberto = pdPeriodo((c) => c.si === SI['posto-bal'] && (c.h === 20 || c.h === 21) && medidaDaHora(c.si, c.d, c.h) < 1.5).length;
    const [r1] = pdRelacoes();
    const balcao = PD_ANOMALIAS.find((a) => a.id === 'balcao-1');
    // a foto padrão é de cada canal: o critério que vale em dois dá duas sugestões, com o canal no título
    const fotoPadrao = (canal, si) => {
      const cs = pdPeriodo((c) => c.si === si);
      return {
        setor: 'Cozinha', icone: 'image', titulo: `Use a foto padrão em “Bancada limpa entre pedidos” (${canal})`,
        texto: `Hoje cada olhada de ${canal} vai à nuvem: <b>${numero.format(soma(cs.map((c) => c.n)))} análises e ${dinheiro(soma(cs.map((c) => c.custo)))}</b> em 28 dias. Com a foto padrão do canal guardada, a loja compara sozinha e só pergunta à nuvem quando a cena está diferente.`,
        acao: { rotulo: 'Ver a foto padrão', ir: 'area' },
      };
    };

    // O critério ligado que, no período, nunca ficou fora nem avisou — e que consegue avaliar. Só os dois de
    // mais olhadas: numa loja nova seriam quase todos, e a lista viraria só isso.
    const olhadas = (cs) => soma(cs.map((c) => c.n));
    const duvidas = AN_SERIES.map((s, si) => ({ s, cs: pdPeriodo((c) => c.si === si) }))
      .filter(({ cs }) => olhadas(cs) >= 500 && soma(cs.map((c) => c.fora)) === 0 && soma(cs.map((c) => c.avisos)) === 0 && taxa(cs, 'na') < 30)
      .sort((a, b) => olhadas(b.cs) - olhadas(a.cs))
      .slice(0, 2)
      .map(({ s, cs }) => {
        const canal = AN_CANAIS.find((c) => c.id === s.canal).nome;
        return {
          setor: ARVORE.find((g) => g.canais.some((c) => c.nome === canal)).setor, icone: 'circle-help',
          titulo: `“${CRITERIOS[s.crit].nome}” nunca ficou fora do critério: vale manter?`,
          texto: `Em 28 dias foram <b>${numero.format(olhadas(cs))} olhadas</b> em ${canal} e nenhuma fora do critério. Se o limite está folgado demais, ele não avisa do que importa; se está certo, é só a confirmação de que vai bem.`,
          acao: { rotulo: 'Ver o critério', editar: s.crit },
        };
      });
    const duvidasDe = (setor) => duvidas.filter((d) => d.setor === setor);

    // na ordem dos setores; dentro de cada um, pelo título, com a dúvida por último — como o servidor entrega
    return [
      {
        setor: 'Atendimento', icone: 'hash', titulo: `Crie o critério “${balcao.criterio.nome}”`,
        texto: `Em 28 dias, Balcão · Dentro do balcão ficou com menos de 2 em <b>${plural(descoberto, 'hora', 'horas')}</b>. Nessas horas “Fila no balcão” fica fora do critério em <b>${Math.round(r1.linhas[0][1])}% das olhadas</b>; com 2 ou mais, em ${Math.round(r1.linhas[1][1])}%. Hoje “Alguém no balcão” só pede 1.`,
        acao: { rotulo: 'Criar critério', criterio: balcao.criterio },
      },
      ...duvidasDe('Atendimento'),
      {
        setor: 'Cozinha', icone: 'crop', titulo: 'Marque a área em Montagem 1',
        texto: `“Uso de touca” não consegue avaliar em <b>${Math.round(taxa(toucaM1, 'na'))}% das olhadas</b> neste canal. Em 28 dias, <b>${dinheiro(semResposta(toucaM1))}</b> foram gastos em perguntas que voltaram sem resposta. A pergunta é feita sobre o quadro inteiro; com a área marcada, a imagem que sobe é só o que importa.`,
        acao: { rotulo: 'Abrir quadro e área', ir: 'area' },
      },
      {
        setor: 'Cozinha', icone: 'user-round-check', titulo: 'Só confira “Uso de touca” com alguém na área',
        texto: `Em Montagem 2, ele não dá para avaliar em <b>${Math.round(taxa(toucaM2, 'na'))}% das olhadas</b> — cerca de <b>${dinheiro(semResposta(toucaM2))}</b> em 28 dias. Se ele depende de gente na imagem, ligue “Com pessoa na área”: a loja confere antes, sem custo, e só pergunta quando há alguém.`,
        acao: { rotulo: 'Ajustar o critério', porteiro: 'touca' },
      },
      fotoPadrao('Montagem 1', SI['bancada-m1']),
      fotoPadrao('Montagem 2', SI['bancada-m2']),
      ...duvidasDe('Cozinha'),
    ];
  }

  // ── o desenho ──
  function desenharPadroes() {
    pdContarRever();
    const dataDe = (d) => rotuloDoDia(d).split(' ')[1];
    $('[data-pd-base]').textContent = `Padrão feito de ${PD_DIAS} dias de análises, de ${dataDe(PD_DIAS)} a ${dataDe(1)}`;
    $('[data-pd-base-nota]').textContent = 'Já há três de cada dia da semana · refeito cada vez que esta tela abre · o dia vira às 6h, e hoje não entra na conta';
    for (const b of $$('[data-pd-setor]')) b.setAttribute('aria-pressed', String(b.dataset.pdSetor === pd.setor));
    for (const b of $$('[data-pd-lente]')) b.setAttribute('aria-pressed', String(b.dataset.pdLente === pd.lente));
    for (const p of $$('[data-pd-painel]')) p.hidden = p.dataset.pdPainel !== pd.lente;
    for (const b of $$('[data-pd-filtro]')) b.setAttribute('aria-pressed', String(b.dataset.pdFiltro === pd.filtro));

    const anomalias = PD_ANOMALIAS.filter(pdDoSetor);
    const doSetorARever = anomalias.filter((a) => a.estado === 'rever').length;
    $('[data-pd-rever-setor]').hidden = doSetorARever === 0;
    $('[data-pd-rever-setor]').textContent = String(doSetorARever);
    const tendencias = pdTendencias().filter(pdDoSetor);
    const sugestoes = pdSugestoes().filter(pdDoSetor);
    $('[data-pd-sugestoes-conta]').hidden = sugestoes.length === 0;
    $('[data-pd-sugestoes-conta]').textContent = String(sugestoes.length);

    // ── o parecer: uma frase por lente ──
    const setores = pdSetores().filter(pdDoSetor);
    const aRever = anomalias.filter((a) => a.estado === 'rever');
    const forte = aRever.find((a) => a.grave) ?? aRever[0];
    const sobe = tendencias.find((t) => t.rumo.sentido === t.ruim) ?? tendencias[0];
    const frases = [
      [
        'frequencia', 'repeat', 'Frequência',
        // o começo da descrição do primeiro setor que tem número; setor sem critério não tem o que dizer
        `${(setores.find((s) => !s.vazio)?.texto.split('. ').slice(0, 2).join('. ') ?? 'Ainda não há medida que conte o movimento de um setor').replace(/\.$/, '')}.`,
        'Ver a semana típica',
      ],
      [
        'anomalias', 'triangle-alert', 'Anomalias',
        aRever.length
          ? `<b>${plural(aRever.length, 'saída do padrão espera', 'saídas do padrão esperam')} a sua revisão.</b> A mais forte: ${pdQuando(forte.d)}, das ${pdHoras(forte.h)}, em ${forte.onde} — ${pdMedir(forte).curto}.`
          : 'Nada fugiu do padrão que ainda precise de revisão.',
        aRever.length ? 'Rever agora' : 'Ver as revistas',
      ],
      [
        'tendencia', 'trending-up', 'Tendência',
        `<b>${sobe.titulo}: ${sobe.rumo.sentido}${sobe.rumo.seguidas > 1 ? ` há ${sobe.rumo.seguidas} semanas` : ''}.</b> ${sobe.texto.replace(/<\/?b>/g, '')}`,
        'Ver para onde vai',
      ],
    ];
    $('[data-pd-parecer]').innerHTML = frases
      .map(
        ([lente, ic, nome, texto, elo]) =>
          `<article class="pd-frase"><span class="rot">${icone(ic, 'p')}${nome}</span><p>${texto}</p>` +
          `<button class="elo" type="button" data-pd-lente-elo="${lente}">${elo}${icone('arrow-right', 'p')}</button></article>`,
      )
      .join('');

    // ── frequência: os setores ──
    $('[data-pd-setores]').innerHTML = setores
      .map((s) =>
        s.vazio
          ? `<article class="cartao setor-cartao sem"><h3>${icone('folder')}${s.setor}</h3><p>${s.vazio}</p></article>`
          : `<article class="cartao setor-cartao"><h3>${icone('folder')}${s.setor}</h3><p>${s.texto}</p>` +
            `<dl class="lista-dl">${s.fatos.map(([dt, dd]) => `<div><dt>${dt}</dt><dd>${dd}</dd></div>`).join('')}</dl></article>`,
      )
      .join('');

    // ── frequência: a semana típica ──
    const opcoes = PD_NO_SELETOR.filter((k) => pdDoSetor(PD_INDICADORES[k]));
    $('[data-pd-calor-vazio]').hidden = opcoes.length > 0;
    for (const e of $$('[data-pd-com-indicador]')) e.hidden = opcoes.length === 0;
    if (opcoes.length) {
      if (!opcoes.includes(pd.indicador)) { pd.indicador = opcoes[0]; pd.celula = ''; }
      $('#pd-indicador').innerHTML = opcoes.map((k) => `<option value="${k}">${PD_INDICADORES[k].nome}</option>`).join('');
      $('#pd-indicador').value = pd.indicador;
      const ind = PD_INDICADORES[pd.indicador];
      const grade = pdSemana(ind);
      const medias = [...grade.values()].map((v) => v.media);
      const maior = Math.max(...medias);
      const menor = Math.min(...medias);
      const [chaveMaior] = [...grade].find(([, v]) => v.media === maior);
      const [chaveMenor] = [...grade].find(([, v]) => v.media === menor);
      if (!grade.has(pd.celula)) pd.celula = chaveMaior;
      const calor = $('[data-pd-calor]');
      calor.style.setProperty('--n', String(PD_HORAS.length));
      calor.classList.toggle('ruim', ind.tipo !== 'medida');
      calor.innerHTML =
        `<span></span>${PD_HORAS.map((h) => `<span class="eixo">${hh(h)}</span>`).join('')}` +
        PD_DIA.map((nomeDoDia, dia) => {
          const rotulo = `<span class="dia">${nomeDoDia.slice(0, 3)}</span>`;
          if (!HORARIO[dia].abre) return `${rotulo}<span class="sem fechada">sem análise</span>`;
          return (
            rotulo +
            PD_HORAS.map((h) => {
              const v = grade.get(`${dia}|${h}`);
              if (!v) return `<span class="sem" title="sem análise nesta hora">—</span>`;
              const f = maior > menor ? (v.media - menor) / (maior - menor) : 0;
              const chave = `${dia}|${h}`;
              return (
                `<button type="button" class="calor-cel${f > 0.55 ? ' forte' : ''}${chave === chaveMaior ? ' maior' : ''}" style="--f:${f.toFixed(3)}" ` +
                `data-pd-cel="${chave}" aria-pressed="${pd.celula === chave}" ` +
                `aria-label="${nomeDoDia}, ${pdHoras(h)}: ${pdTexto(ind, v.media)} ${ind.curto}, média de ${plural(v.n, 'dia', 'dias')}">${pdTexto(ind, v.media)}</button>`
              );
            }).join('')
          );
        }).join('');
      $('[data-pd-escala]').innerHTML = `${pdTexto(ind, menor)}<i style="--rampa:var(${ind.tipo === 'medida' ? '--marca' : '--critico'})"></i>${pdTexto(ind, maior)}`;
      const nomeDaChave = (chave) => {
        const [dia, h] = chave.split('|').map(Number);
        return `${PD_DIA[dia]} às ${hh(h)}`;
      };
      $('[data-pd-calor-resumo]').textContent = `Mais alto: ${nomeDaChave(chaveMaior)} (${pdTexto(ind, maior)}). Mais baixo: ${nomeDaChave(chaveMenor)} (${pdTexto(ind, menor)}).`;
      const sel = grade.get(pd.celula);
      const [diaSel, horaSel] = pd.celula.split('|').map(Number);
      $('[data-pd-calor-detalhe]').innerHTML =
        `<b>${PD_DIA[diaSel][0].toUpperCase()}${PD_DIA[diaSel].slice(1)}, das ${pdHoras(horaSel)}:</b> ${pdTexto(ind, sel.media)} ${ind.curto}, em média — ` +
        `de ${pdTexto(ind, sel.min)} a ${pdTexto(ind, sel.max)} ${sel.n === 1 ? 'no único dia medido' : `nos ${sel.n} dias medidos`}.` +
        (sel.n < 3 ? ' Poucos dias: ainda não é padrão firme.' : '');
    }

    // ── frequência: o que anda junto ──
    $('[data-pd-relacoes]').innerHTML = pdRelacoes()
      .filter(pdDoSetor)
      .map((r) => {
        const teto = Math.max(...r.linhas.map((l) => l[1]), 1);
        const chip = r.forca === 'nenhuma' ? '<span class="chip">sem relação</span>' : `<span class="chip ${r.forca === 'forte' ? 'atencao' : ''}">relação ${r.forca}</span>`;
        return (
          `<article class="cartao relacao"><span class="pergunta">${r.pergunta}</span><h3>${r.titulo}</h3>` +
          r.linhas
            .map(([nome, v, calma]) => `<div class="rel-linha${calma ? ' calma' : ''}"><span>${nome}</span><b>${umaCasa(v)}%</b><span class="trilho"><i style="width:${(v / teto) * 100}%"></i></span></div>`)
            .join('') +
          `<span class="nota">${r.sufixo}</span><div class="pe">${chip}<span>${r.pe}</span></div></article>`
        );
      })
      .join('') ||
      '<p class="nota" style="grid-column:1 / -1">Ainda não há relação para mostrar. Ela aparece quando, na mesma hora do dia, houve dias com mais e dias com menos gente — e um critério do mesmo setor para comparar.</p>';

    // ── anomalias ──
    const mostradas = anomalias.filter((a) => pd.filtro === 'todas' || (pd.filtro === 'rever' ? a.estado === 'rever' : a.estado !== 'rever'));
    $('[data-pd-anomalias]').innerHTML = mostradas.length
      ? mostradas
          .map((a) => {
            const { ind: i, visto, normal, conta } = pdMedir(a);
            const fundo = i.tipo === 'medida' ? Math.max(visto, normal.max) * 1.25 : Math.min(100, Math.max(visto, normal.max) * 1.25);
            const pc = (v) => `${Math.min(100, (v / fundo) * 100).toFixed(1)}%`;
            const mais = pdMais(a);
            const estado =
              a.estado === 'rever' ? `<span class="chip ${a.grave ? 'critico' : 'atencao'}">${a.grave ? 'muito fora do normal' : 'fora do normal'}</span>`
              : a.estado === 'esperado' ? `<span class="chip ok">${icone('check')}esperado</span>`
              : `<span class="chip ok">${icone('wrench')}corrigido</span>`;
            const acoes =
              a.estado === 'rever'
                ? `<div class="a-acoes" data-so-config>` +
                  `<button class="btn secundario mini" type="button" data-pd-esperado="${a.id}">${icone('check', 'p')}Era esperado</button>` +
                  `<button class="btn primario mini" type="button" data-pd-problema="${a.id}">${icone('flag', 'p')}É problema</button>` +
                  (a.camera ? `<a class="elo" href="#area" data-ir="area" style="align-self:center">Ver o quadro do canal${icone('arrow-right', 'p')}</a>` : '') +
                  `</div>`
                : `<div class="a-revisao">${icone(a.estado === 'esperado' ? 'check' : 'wrench')}<div><b>${a.revisao.quem} · ${a.revisao.quando}</b>` +
                  `<span>${a.revisao.texto}</span>${a.revisao.virou ? `<span>${a.revisao.virou}</span>` : ''}</div></div>`;
            return (
              `<li class="anomalia" data-anomalia="${a.id}"><div class="quando"><b>${pdQuando(a.d)}</b><span>${a.d > 1 ? '' : rotuloDoDia(a.d)}</span><span>${pdHoras(a.h)}</span></div>` +
              `<div class="a-corpo"><h3>${a.titulo}<span class="chip vazado">${icone('cctv')}${a.onde}</span>${estado}</h3>` +
              `<p class="a-conta">${conta}</p>` +
              `<div class="regua${a.grave ? ' critico' : ''}" role="img" aria-label="A faixa do normal vai de ${pdTexto(i, normal.min)} a ${pdTexto(i, normal.max)}; o que foi visto é ${pdTexto(i, visto)}.">` +
              `<span class="trilho"></span><span class="banda" style="left:${pc(normal.min)};width:calc(${pc(normal.max)} - ${pc(normal.min)})"></span>` +
              `<span class="mediana" style="left:${pc(normal.mediana)}"></span><span class="visto" style="left:${pc(visto)}"></span></div>` +
              (mais ? `<p class="a-mais">${mais}</p>` : '') +
              acoes +
              `</div></li>`
            );
          })
          .join('')
      : `<li class="anomalia"><div class="quando"></div><div class="a-corpo"><p class="a-mais">${pd.filtro === 'rever' ? 'Nada para rever. O que fugir do padrão aparece aqui.' : pd.filtro === 'revistas' ? 'Nenhuma saída do padrão revista ainda.' : 'Nenhuma saída do padrão neste período.'}</p></div></li>`;

    // ── tendência ──
    // o setor sem critério de presença ou de contagem não tem "hoje contra o normal"
    const comMedida = ['fila', 'posto', 'chapa'].filter((k) => pdDoSetor(PD_INDICADORES[k]));
    if (!comMedida.includes(pd.hoje)) [pd.hoje] = comMedida;
    for (const e of $$('[data-pd-com-medida]')) e.hidden = comMedida.length === 0;
    if (comMedida.length) pdHoje();
    else {
      $('[data-pd-hoje-titulo]').textContent = 'Hoje contra o normal';
      $('[data-pd-hoje-nota]').textContent = 'Aparece quando um critério de presença ou de contagem deste setor tem padrão para o dia da semana de hoje.';
    }
    $('[data-pd-tendencias]').innerHTML = tendencias
      .map((t) => {
        const ruim = t.rumo.sentido === t.ruim;
        const chip =
          t.rumo.sentido === 'estável'
            ? `<span class="chip">${icone('minus')}estável</span>`
            : `<span class="chip ${ruim ? 'atencao' : 'ok'}">${icone(t.rumo.sentido === 'sobe' ? 'trending-up' : 'trending-down')}${t.rumo.sentido}${t.rumo.seguidas > 1 ? ` há ${t.rumo.seguidas} semanas` : ''}</span>`;
        return `<article class="cartao tend"><h3>${t.titulo}${chip}</h3><div class="valor"><span class="num">${t.valor}</span>${pdFio(t.serie, t.limite)}</div><p>${t.texto}</p></article>`;
      })
      .join('');

    // ── sugestões ──
    $('[data-pd-sugestoes]').innerHTML = sugestoes
      .map(
        (s, i) =>
          `<li class="sugestao"><span class="selo-ic">${icone(s.icone)}</span><h3>${s.titulo}</h3><p>${s.texto}</p>` +
          `<button class="btn secundario mini" type="button" data-pd-sugestao="${i}" ${s.acao.ir ? '' : 'data-so-config'}>${s.acao.rotulo}${icone('arrow-right', 'p')}</button></li>`,
      )
      .join('') || '<li class="sugestao"><p style="grid-column:1 / -1">Nenhuma sugestão agora: os números não apontam ajuste nos critérios.</p></li>';
    pd.sugestoes = sugestoes;
  }

  /** Abre a gaveta do critério já preenchida com o que a correção ou a sugestão propõe. */
  function abrirCriterioProposto(c, gatilho) {
    contexto = { ...contexto, nome: '', criterio: '', canalNovo: c.lugar };
    abrirFolha('folha-criterio', 'novo', gatilho);
    $('#fcr-nome').value = c.nome;
    $(`#fcr-t-${c.tipo}`).checked = true;
    ajustarTipo();
    $('#fcr-objeto').value = 'pessoa';
    $('#fcr-min').value = c.minimo ?? 0;
    $('#fcr-max').value = c.maximo ?? '';
    $('#fcr-texto').value = c.texto;
    $('#fcr-janela').checked = Boolean(c.janela);
    $('[data-janela]').hidden = !c.janela;
    if (c.janela) [$('#fcr-j-de').value, $('#fcr-j-ate').value] = c.janela;
    $('#fcr-nome').focus({ preventScroll: true });
  }

  const pdResumo = (a) => `<b>${a.titulo}</b><span>${pdQuando(a.d)}, das ${pdHoras(a.h)} · ${a.onde} — ${pdMedir(a).curto}.</span>`;

  document.addEventListener('click', (ev) => {
    const tela = ev.target.closest('[data-tela="padroes"]');
    if (!tela) return;
    const setor = ev.target.closest('[data-pd-setor]');
    if (setor) { pd.setor = setor.dataset.pdSetor; desenharPadroes(); return; }
    const lente = ev.target.closest('[data-pd-lente], [data-pd-lente-elo]');
    if (lente) {
      pd.lente = lente.dataset.pdLente ?? lente.dataset.pdLenteElo;
      if (pd.lente === 'anomalias' && lente.dataset.pdLenteElo) pd.filtro = pdARever().length ? 'rever' : 'revistas';
      desenharPadroes();
      if (lente.dataset.pdLenteElo) {
        const alvo = $('.pd-lentes');
        palco.scrollTop += alvo.getBoundingClientRect().top - palco.getBoundingClientRect().top - 16;
        $(`[data-pd-lente="${pd.lente}"]`).focus({ preventScroll: true });
      }
      return;
    }
    const cel = ev.target.closest('[data-pd-cel]');
    if (cel) {
      pd.celula = cel.dataset.pdCel;
      desenharPadroes();
      $(`[data-pd-cel="${pd.celula}"]`)?.focus({ preventScroll: true });
      return;
    }
    const filtro = ev.target.closest('[data-pd-filtro]');
    if (filtro) { pd.filtro = filtro.dataset.pdFiltro; desenharPadroes(); return; }
    const hojeInd = ev.target.closest('[data-pd-hoje-ind]');
    if (hojeInd) {
      pd.hoje = hojeInd.dataset.pdHojeInd;
      desenharPadroes();
      $(`[data-pd-hoje-ind="${pd.hoje}"]`)?.focus({ preventScroll: true });
      return;
    }
    const esperado = ev.target.closest('[data-pd-esperado]');
    if (esperado) {
      pd.alvo = PD_ANOMALIAS.find((a) => a.id === esperado.dataset.pdEsperado);
      $('[data-fes-resumo]').innerHTML = pdResumo(pd.alvo);
      $('#fes-sempre').checked = true;
      $('#fes-nota').value = '';
      abrirFolha('folha-esperado', 'novo', esperado);
      return;
    }
    const problema = ev.target.closest('[data-pd-problema]');
    if (problema) {
      const a = PD_ANOMALIAS.find((x) => x.id === problema.dataset.pdProblema);
      pd.alvo = a;
      $('[data-fco-resumo]').innerHTML = pdResumo(a);
      $('#fco-houve').value = '';
      $('#fco-feito').value = '';
      // cada saída do padrão oferece o que faz sentido para ela
      $('[data-fco-opcao="criar"]').hidden = !a.criterio;
      $('[data-fco-opcao="ajustar"]').hidden = !a.ajustar;
      $(a.criterio ? '#fco-criar' : a.ajustar ? '#fco-ajustar' : '#fco-nada').checked = true;
      pdPrevia();
      abrirFolha('folha-correcao', 'novo', problema);
      return;
    }
    const sugestao = ev.target.closest('[data-pd-sugestao]');
    if (sugestao) {
      const { acao } = pd.sugestoes[Number(sugestao.dataset.pdSugestao)];
      if (acao.ir) ir(acao.ir);
      else if (acao.criterio) abrirCriterioProposto(acao.criterio, sugestao);
      else if (acao.porteiro) {
        contexto = { ...contexto, nome: CRITERIOS[acao.porteiro].nome, criterio: acao.porteiro, canal: '' };
        abrirFolha('folha-criterio', 'editar', sugestao);
        $('#fcr-p-pessoa').checked = true;
      } else if (acao.editar) {
        // "ver o critério": abre o que existe, sem mudar nada
        contexto = { ...contexto, nome: CRITERIOS[acao.editar].nome, criterio: acao.editar, canal: '' };
        abrirFolha('folha-criterio', 'editar', sugestao);
      }
    }
  });
  $('#pd-indicador').addEventListener('change', (ev) => { pd.indicador = ev.target.value; pd.celula = ''; desenharPadroes(); });

  /** O que a correção vai fazer depois de registrada, mostrado antes de salvar. */
  function pdPrevia() {
    const a = pd.alvo;
    const escolha = $('input[name="fco-depois"]:checked').value;
    const previa = $('[data-fco-previa]');
    previa.hidden = escolha === 'nada';
    if (escolha === 'criar' && a.criterio) {
      const c = a.criterio;
      previa.innerHTML =
        `<span class="suave">Critério que vai ser proposto</span><b>${c.nome}</b>` +
        `<div class="o-chips"><span class="chip ok">${c.regra}</span><span class="chip">${c.tipo}</span>` +
        `<span class="chip vazado">${icone('cctv')}${c.lugar.replace('/', ' · ')}</span><span class="chip vazado">${icone('clock')}das ${c.janela[0]} às ${c.janela[1]}</span></div>` +
        `<span class="suave">${c.texto} Julgado na loja, sem custo por análise.</span>`;
    } else if (escolha === 'ajustar' && a.ajustar) {
      previa.innerHTML = `<span class="suave">Depois de registrar, abre para você ajustar</span><b>${CRITERIOS[a.ajustar].nome}</b><span class="suave">${CRITERIOS[a.ajustar].meta}</span>`;
    }
  }
  for (const r of $$('input[name="fco-depois"]')) r.addEventListener('change', pdPrevia);

  // As duas gavetas da revisão. O ouvinte roda antes do que fecha a gaveta
  // (o de todas as gavetas): é aqui que a saída do padrão muda de estado.
  $('#f-esperado').addEventListener('submit', () => {
    const a = pd.alvo;
    const sempre = $('#fes-sempre').checked;
    const nota = $('#fes-nota').value.trim();
    const { dia } = pdMedir(a);
    a.estado = 'esperado';
    a.soDestaVez = !sempre;
    a.revisao = {
      quem: 'Ana Souza', quando: 'hoje',
      texto: (nota ? `${nota} ` : '') + (sempre ? `Acontece sempre: o padrão ${PD_ARTIGO[dia]} ${PD_DIAS_PLURAL[dia]} às ${hh(a.h)} passa a contar com isso.` : 'Foi só desta vez: esta hora ficou de fora da conta do padrão.'),
    };
    $('#f-esperado').dataset.sucessoNovo = sempre ? 'Marcado como esperado. O padrão passa a contar com isso.' : 'Marcado como esperado. Esta hora ficou de fora do padrão.';
    desenharPadroes();
  }, { capture: true });

  $('#f-correcao').addEventListener('submit', () => {
    const a = pd.alvo;
    const escolha = $('input[name="fco-depois"]:checked').value;
    a.estado = 'problema';
    a.revisao = {
      quem: 'Ana Souza', quando: 'hoje',
      texto: `${$('#fco-houve').value.trim()} ${$('#fco-feito').value.trim()}`,
      virou: escolha === 'criar' && a.criterio ? `Propôs o critério “${a.criterio.nome}”, que nasce desligado.` : escolha === 'ajustar' && a.ajustar ? `Abriu “${CRITERIOS[a.ajustar].nome}” para ajuste.` : '',
    };
    $('#f-correcao').dataset.sucessoNovo = 'Correção registrada.';
    desenharPadroes();
    // depois que a gaveta da correção fechar, abre a do critério
    if (escolha === 'nada') return;
    setTimeout(() => {
      if (escolha === 'criar' && a.criterio) abrirCriterioProposto(a.criterio, null);
      else if (a.ajustar) {
        contexto = { ...contexto, nome: CRITERIOS[a.ajustar].nome, criterio: a.ajustar, canal: '' };
        abrirFolha('folha-criterio', 'editar', null);
      }
    }, 0);
  }, { capture: true });

  // ═══════════════════════ inventário e planta ═══════════════════════
  // O inventário são os equipamentos de cada setor, como ficam limpos e no
  // lugar. A planta é o ambiente desenhado em retângulos (medidas em
  // metros), com cada equipamento e cada câmera na sua posição. Por ser
  // feita de retângulos — e não de uma imagem — dá para calcular o que cada
  // câmera cobre e escrever a descrição do lugar de cada canal.
  const AMB_CANAIS = [...AN_CANAIS, { id: 'est', nome: 'Estoque seco', num: '08' }, { id: 'rec', nome: 'Recebimento', num: '07' }].map((c) => {
    const setor = ARVORE.find((s) => s.canais.some((k) => k.nome === c.nome));
    return { ...c, setor: setor.setor, ...setor.canais.find((k) => k.nome === c.nome), id: c.id };
  });

  const EQUIPAMENTOS = {
    chapa: {
      nome: 'Chapa', tipo: 'chapa', setor: 'Cozinha', fotos: ['canal', 'canal', 'celular', 'celular'], aparece: [['chp', 'quadro inteiro']],
      descricao: 'Chapa elétrica de inox, com duas tampas, encostada na parede do fundo, à esquerda da fritadeira. Limpa: superfície clara, sem resíduo escuro nem gordura acumulada nas bordas; tampas abaixadas quando não está em uso; nada apoiado em cima.',
      conferir: ['Superfície sem resíduo escuro entre os usos', 'Tampas abaixadas quando a chapa não está em uso', 'Nada apoiado em cima da chapa'],
    },
    fritadeira: {
      nome: 'Fritadeira', tipo: 'fritadeira', setor: 'Cozinha', fotos: ['canal', 'celular'], aparece: [['fri', 'quadro inteiro']],
      descricao: 'Fritadeira de duas cubas, com dois cestos, à direita da chapa. Limpa: laterais sem escorrido de óleo, cestos pendurados fora do óleo quando não há fritura.',
      conferir: ['Cestos pendurados fora do óleo quando não há fritura', 'Laterais sem escorrido de óleo'],
    },
    montagem1: {
      nome: 'Bancada de montagem 1', tipo: 'bancada', setor: 'Cozinha', fotos: ['canal', 'canal', 'celular', 'celular'], aparece: [['m1', 'quadro inteiro']],
      descricao: 'Bancada de inox no centro da cozinha, com cubas de ingredientes ao fundo e tábua de corte à frente. Limpa: superfície livre de restos de alimento e de embalagens; utensílios no suporte; cubas tampadas.',
      conferir: ['Superfície livre de restos e de embalagens', 'Utensílios no suporte, não sobre a bancada'],
    },
    montagem2: { nome: 'Bancada de montagem 2', tipo: 'bancada', setor: 'Cozinha', fotos: ['celular'], aparece: [['m2', 'quadro inteiro']], descricao: '', conferir: [] },
    geladeira: { nome: 'Geladeira', tipo: 'geladeira ou freezer', setor: 'Cozinha', fotos: [], aparece: [], descricao: '', conferir: [] },
    balcao: {
      nome: 'Balcão de atendimento', tipo: 'balcão', setor: 'Atendimento', fotos: ['canal', 'canal', 'celular'], aparece: [['bal', 'Dentro do balcão']],
      descricao: 'Balcão comprido que separa o atendimento do salão, com a máquina de café numa ponta. Limpo: tampo livre, sem copos nem bandejas esquecidos; nada no chão do lado de dentro.',
      conferir: ['Tampo livre de copos e bandejas', 'Nada no chão do lado de dentro'],
    },
    caixa: {
      nome: 'Caixa', tipo: 'caixa', setor: 'Atendimento', fotos: ['canal', 'canal', 'celular', 'celular'], aparece: [['cx', 'quadro inteiro']],
      descricao: 'Balcão do caixa, com o terminal em cima e a gaveta de dinheiro embaixo, à esquerda de quem atende. No lugar: gaveta fechada, terminal ligado, nada cobrindo a gaveta.',
      conferir: ['Gaveta fechada quando não há atendimento', 'Nada cobrindo a gaveta ou o terminal'],
    },
    prateleira: { nome: 'Prateleiras do estoque seco', tipo: 'prateleira', setor: 'Estoque', fotos: [], aparece: [['est', 'quadro inteiro']], descricao: '', conferir: [] },
  };

  let PLANTA = {
    ambientes: [
      { id: 'coz', nome: 'Cozinha', setor: 'Cozinha', x: 0, y: 0, w: 7.5, h: 5.5 },
      { id: 'est', nome: 'Estoque', setor: 'Estoque', x: 0, y: 5.5, w: 4.5, h: 3.5 },
      { id: 'rec', nome: 'Recebimento', setor: 'Estoque', x: 4.5, y: 5.5, w: 3, h: 3.5 },
      { id: 'atd', nome: 'Atendimento', setor: 'Atendimento', x: 7.5, y: 0, w: 6.5, h: 9 },
    ],
    moveis: [
      { id: 'chapa', equip: 'chapa', nome: 'Chapa', x: 0.5, y: 0.3, w: 1.8, h: 0.8, alt: 0.9 },
      { id: 'fritadeira', equip: 'fritadeira', nome: 'Fritadeira', x: 2.7, y: 0.3, w: 1, h: 0.8, alt: 0.9 },
      { id: 'geladeira', equip: 'geladeira', nome: 'Geladeira', x: 6.3, y: 0.3, w: 0.9, h: 0.8, alt: 1.9 },
      { id: 'montagem1', equip: 'montagem1', nome: 'Montagem 1', x: 1, y: 2.7, w: 2.3, h: 0.8, alt: 0.9 },
      { id: 'montagem2', equip: 'montagem2', nome: 'Montagem 2', x: 4, y: 2.7, w: 2.3, h: 0.8, alt: 0.9 },
      { id: 'prateleira', equip: 'prateleira', nome: 'Prateleiras', x: 0.3, y: 6, w: 0.6, h: 2.6, alt: 1.8 },
      { id: 'balcao', equip: 'balcao', nome: 'Balcão', x: 9.4, y: 0.8, w: 0.7, h: 5.4, alt: 1.1 },
      { id: 'caixa', equip: 'caixa', nome: 'Caixa', x: 9.4, y: 6.8, w: 0.7, h: 1.2, alt: 1.1 },
      { id: 'mesa1', nome: 'Mesa', x: 11.6, y: 1.2, w: 1, h: 1, alt: 0.75 },
      { id: 'mesa2', nome: 'Mesa', x: 11.6, y: 3.6, w: 1, h: 1, alt: 0.75 },
      { id: 'mesa3', nome: 'Mesa', x: 11.6, y: 6, w: 1, h: 1, alt: 0.75 },
    ],
    portas: [{ x1: 14, y1: 7.5, x2: 14, y2: 8.6 }, { x1: 5.3, y1: 9, x2: 6.5, y2: 9 }],
    // direção em graus: 0 = para a direita da planta, 90 = para baixo
    cameras: [
      { canal: 'chp', x: 1.4, y: 2.2, alt: 2.6, dir: 270, abertura: 80, alcance: 2.6 },
      { canal: 'fri', x: 3.2, y: 2.2, alt: 2.6, dir: 270, abertura: 70, alcance: 2.4 },
      { canal: 'm1', x: 2.15, y: 5.1, alt: 2.6, dir: 270, abertura: 80, alcance: 3 },
      { canal: 'm2', x: 5.15, y: 5.1, alt: 2.6, dir: 270, abertura: 80, alcance: 3 },
      { canal: 'bal', x: 13.6, y: 0.4, alt: 2.7, dir: 142, abertura: 92, alcance: 8.2 },
      { canal: 'cx', x: 7.9, y: 8.6, alt: 2.6, dir: 322, abertura: 70, alcance: 3.6 },
      { canal: 'est', x: 4.2, y: 5.8, alt: 2.5, dir: 135, abertura: 88, alcance: 4.6 },
      { canal: 'rec', x: 7.2, y: 5.8, alt: 2.5, dir: 125, abertura: 80, alcance: 3.6 },
    ],
  };

  const amb = { t: 1, vista: 'perspectiva', camada: 'situacao', sel: { tipo: 'camera', id: 'bal' }, editando: false, ferramenta: '', antes: null, gesto: null, proj: null, estreou: false, vistaAntes: 'perspectiva' };
  const PL = { L: 800, A: 550, margem: 30, parede: 0.5 };
  // A câmera fica no teto, mas o marcador dela fica perto do chão: com oito
  // câmeras a 2,6 m, as cabeças se embaralham longe de onde cada uma está.
  const pinoDa = (cam) => Math.min(cam.alt, 1.3);
  const rad = (g) => (g * Math.PI) / 180;
  const canalDe = (id) => AMB_CANAIS.find((c) => c.id === id);
  // Os canais que têm foto padrão guardada (dados de exemplo). É o que decide
  // "compara na loja": critério de comparação é julgado na loja quando o
  // CANAL tem foto padrão — não por o equipamento ter foto própria.
  const CANAIS_COM_FOTO_PADRAO = new Set(['chp', 'm1', 'cx', 'bal']);
  const ambienteEm = (x, y) => PLANTA.ambientes.find((a) => x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h);
  const centro = (r) => [r.x + r.w / 2, r.y + r.h / 2];

  /** A situação de um canal agora: é o que pinta a câmera e o cone. */
  function situacaoDoCanal(c) {
    if (c.pausado) return { chave: 'pausado', texto: 'pausado', chip: 'atencao' };
    if (c.semImagem) return { chave: 'semimagem', texto: 'sem imagem desde as 14h', chip: 'critico' };
    if (!c.criterios.length) return { chave: 'semcrit', texto: 'sem critério', chip: '' };
    const aberta = Boolean(abertaAgora());
    const valendo = c.criterios.filter((k) => CRITERIOS[k].ligado && (CRITERIOS[k].quando === 'sempre' || (CRITERIOS[k].quando === 'fora') !== aberta));
    if (!valendo.length) return { chave: 'semcrit', texto: aberta ? 'só confere com a loja fechada' : 'só confere com a loja aberta', chip: '' };
    // aviso nos últimos dez minutos: os mesmos avisos da tela Análises
    const hora = Math.floor(AN_AGORA_MIN / 60);
    const recente = celulasDoDia(0).some((cel) => {
      if (cel.h !== hora || AN_SERIES[cel.si].canal !== c.id) return false;
      for (let j = 0; j < cel.avisos; j += 1) {
        const minuto = cel.comeca + Math.floor(sorte(0, cel.si, hora, 20 + j) * cel.ativos);
        if (hora * 60 + minuto >= AN_AGORA_MIN - 10) return true;
      }
      return false;
    });
    return recente ? { chave: 'alerta', texto: 'aviso nos últimos 10 min', chip: 'critico' } : { chave: 'ok', texto: 'conferindo', chip: 'ok' };
  }

  // ── a geometria, no chão (metros) ──
  /** O que a câmera alcança no chão: um setor, cortado nas paredes do ambiente em que ela está. */
  function coneDaCamera(cam) {
    const pontos = [[cam.x, cam.y]];
    const de = cam.dir - cam.abertura / 2;
    const passos = Math.max(6, Math.round(cam.abertura / 6));
    for (let i = 0; i <= passos; i += 1) {
      const a = rad(de + (cam.abertura * i) / passos);
      pontos.push([cam.x + Math.cos(a) * cam.alcance, cam.y + Math.sin(a) * cam.alcance]);
    }
    const a = ambienteEm(cam.x, cam.y);
    if (!a) return pontos;
    // recorte de polígono por retângulo, um lado de cada vez
    const lados = [
      [(p) => p[0] >= a.x, (p, q) => [a.x, p[1] + ((q[1] - p[1]) * (a.x - p[0])) / (q[0] - p[0])]],
      [(p) => p[0] <= a.x + a.w, (p, q) => [a.x + a.w, p[1] + ((q[1] - p[1]) * (a.x + a.w - p[0])) / (q[0] - p[0])]],
      [(p) => p[1] >= a.y, (p, q) => [p[0] + ((q[0] - p[0]) * (a.y - p[1])) / (q[1] - p[1]), a.y]],
      [(p) => p[1] <= a.y + a.h, (p, q) => [p[0] + ((q[0] - p[0]) * (a.y + a.h - p[1])) / (q[1] - p[1]), a.y + a.h]],
    ];
    let poligono = pontos;
    for (const [dentro, corte] of lados) {
      const novo = [];
      poligono.forEach((p, i) => {
        const q = poligono[(i + 1) % poligono.length];
        if (dentro(p)) novo.push(p);
        if (dentro(p) !== dentro(q)) novo.push(corte(p, q));
      });
      poligono = novo;
    }
    return poligono;
  }

  function dentroDoPoligono(pt, poligono) {
    let dentro = false;
    for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i, i += 1) {
      const [xi, yi] = poligono[i];
      const [xj, yj] = poligono[j];
      if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) dentro = !dentro;
    }
    return dentro;
  }

  /** Quem cobre: só canal que está entregando imagem. */
  const camerasQueCobrem = () =>
    PLANTA.cameras.filter((cam) => !['semimagem', 'pausado'].includes(situacaoDoCanal(canalDe(cam.canal)).chave)).map((cam) => coneDaCamera(cam));

  /** A cobertura de cada ambiente, em quadros de meio metro: o que nenhuma câmera vê. */
  function coberturaDaPlanta() {
    const cones = camerasQueCobrem();
    const passo = 0.5;
    return PLANTA.ambientes.map((a) => {
      const faixas = [];
      let total = 0;
      let cobertos = 0;
      for (let y = a.y; y < a.y + a.h - 0.01; y += passo) {
        let inicio = null;
        for (let x = a.x; x < a.x + a.w - 0.01; x += passo) {
          total += 1;
          const visto = cones.some((c) => dentroDoPoligono([x + passo / 2, y + passo / 2], c));
          if (visto) cobertos += 1;
          if (!visto && inicio === null) inicio = x;
          if ((visto || x + passo >= a.x + a.w - 0.01) && inicio !== null) {
            faixas.push([inicio, y, visto ? x : Math.min(x + passo, a.x + a.w), Math.min(y + passo, a.y + a.h)]);
            inicio = null;
          }
        }
      }
      return { ambiente: a, parte: total ? cobertos / total : 0, faixas };
    });
  }

  /** O que a câmera vê e onde está, em uma frase: é o que vai junto com cada análise do canal. */
  function descricaoDoLugar(cam) {
    const a = ambienteEm(cam.x, cam.y);
    const cone = coneDaCamera(cam);
    const vistos = PLANTA.moveis.filter((m) => dentroDoPoligono(centro(m), cone));
    const nomes = [...new Set(vistos.map((m) => (EQUIPAMENTOS[m.equip]?.nome ?? m.nome).toLowerCase()))];
    const contagem = nomes.map((n) => {
      const quantos = vistos.filter((m) => (EQUIPAMENTOS[m.equip]?.nome ?? m.nome).toLowerCase() === n).length;
      // "mesa (3)", e não "3 mesas": o plural de um nome escrito por alguém não se adivinha
      return quantos > 1 ? `${n} (${quantos})` : n;
    });
    const lista = contagem.length > 1 ? `${contagem.slice(0, -1).join(', ')} e ${contagem[contagem.length - 1]}` : contagem[0];
    return (
      // sem móvel na frente a frase não diz "não há equipamento": a imagem pode mostrar um que ninguém desenhou
      `Câmera ${a ? `no ambiente ${a.nome}` : 'fora dos ambientes desenhados'}, a ${String(cam.alt).replace('.', ',')} m do chão.` +
      (lista ? ` No campo de visão: ${lista}.` : '')
    );
  }

  /** Onde o nome do ambiente cabe: o ponto do chão mais longe de câmera e de equipamento.
   *  `meia` é meia largura do nome e `alto` a altura dele, em metros na escala de agora. */
  function lugarDoNome(a, meia, alto) {
    const folgaX = Math.min(meia + 0.15, a.w / 2);
    const folgaY = Math.min(alto, a.h / 2);
    let melhor = [a.x + a.w / 2, a.y + a.h / 2];
    let nota = -1;
    for (let y = a.y + folgaY; y <= a.y + a.h - folgaY + 0.01; y += 0.25) {
      for (let x = a.x + folgaX; x <= a.x + a.w - folgaX + 0.01; x += 0.25) {
        // o nome é mais largo do que alto: a distância na horizontal pesa menos
        const ate = (ox, oy) => Math.max(Math.abs(x - ox) / (meia + 0.3), Math.abs(y - oy) / alto);
        const cameras = PLANTA.cameras.map((c) => ate(c.x, c.y));
        const moveis = PLANTA.moveis.map((m) => ate(noLimite(x, m.x, m.x + m.w), noLimite(y, m.y, m.y + m.h)));
        const livre = Math.min(...cameras, ...moveis, 99);
        if (livre > nota + 0.001) {
          nota = livre;
          melhor = [x, y];
        }
      }
    }
    return melhor;
  }

  const camerasQueVeem = (m) => PLANTA.cameras.filter((cam) => dentroDoPoligono(centro(m), coneDaCamera(cam))).map((cam) => canalDe(cam.canal));

  // ── do chão para a tela ──
  /** `t` vai de 0 (vista de cima) a 1 (em perspectiva): gira 45° e deita a planta. */
  function projetor(t) {
    const giro = rad(45 * t);
    const queda = rad(90 - 48 * t); // 90° = de cima; 42° = em perspectiva
    const xs = PLANTA.ambientes.flatMap((a) => [a.x, a.x + a.w]);
    const ys = PLANTA.ambientes.flatMap((a) => [a.y, a.y + a.h]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const cru = (x, y, z = 0) => {
      const dx = x - cx;
      const dy = y - cy;
      const xr = dx * Math.cos(giro) - dy * Math.sin(giro);
      const yr = dx * Math.sin(giro) + dy * Math.cos(giro);
      return [xr, yr * Math.sin(queda) - z * Math.cos(queda), yr];
    };
    // tudo o que existe tem de caber: os cantos do chão e a cabeça das câmeras
    const marcos = [
      ...PLANTA.ambientes.flatMap((a) => [[a.x, a.y, 0], [a.x + a.w, a.y, 0], [a.x, a.y + a.h, 0], [a.x + a.w, a.y + a.h, 0], [a.x, a.y, PL.parede]]),
      ...PLANTA.cameras.map((c) => [c.x, c.y, pinoDa(c) + 0.5]),
    ].map(([x, y, z]) => cru(x, y, z * t));
    const minX = Math.min(...marcos.map((p) => p[0]));
    const maxX = Math.max(...marcos.map((p) => p[0]));
    const minY = Math.min(...marcos.map((p) => p[1]));
    const maxY = Math.max(...marcos.map((p) => p[1]));
    const escala = Math.min((PL.L - 2 * PL.margem) / (maxX - minX), (PL.A - 2 * PL.margem) / (maxY - minY));
    const ox = (PL.L - (maxX + minX) * escala) / 2;
    const oy = (PL.A - (maxY + minY) * escala) / 2;
    return {
      t, escala,
      p: (x, y, z = 0) => {
        const [a, b, fundo] = cru(x, y, z * t);
        return [a * escala + ox, b * escala + oy, fundo];
      },
      // só vale de cima (t = 0), que é como se edita
      chao: (sx, sy) => [(sx - ox) / escala + cx, (sy - oy) / escala + cy],
    };
  }

  const pontos = (lista) => lista.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

  function desenharPlanta() {
    // A planta é desenhada no tamanho em que aparece: a câmera e as letras
    // ficam do mesmo tamanho no computador e no celular; quem encolhe é o chão.
    const caixa = $('[data-planta]').getBoundingClientRect();
    if (caixa.width > 0) {
      PL.L = Math.round(caixa.width);
      PL.A = Math.round(caixa.height);
    }
    plantaSvg.setAttribute('viewBox', `0 0 ${PL.L} ${PL.A}`);
    const proj = projetor(amb.t);
    amb.proj = proj;
    const { p } = proj;
    const emPe = amb.t > 0.04;
    const chao = (lista) => pontos(lista.map(([x, y]) => p(x, y, 0)));
    const sel = amb.sel;
    let svg = '';

    // 1 · o chão de cada ambiente, do fundo para a frente
    const ambientes = [...PLANTA.ambientes].sort((a, b) => p(...centro(a))[2] - p(...centro(b))[2]);
    for (const a of ambientes) {
      const marcado = amb.editando && sel?.tipo === 'ambiente' && sel.id === a.id;
      svg += `<polygon class="pl-piso${marcado ? ' sel' : ''}" data-ambiente="${a.id}" points="${chao([[a.x, a.y], [a.x + a.w, a.y], [a.x + a.w, a.y + a.h], [a.x, a.y + a.h]])}"/>`;
    }
    // 2 · o que nenhuma câmera vê
    if (amb.camada === 'cobertura' && !amb.editando) {
      for (const { faixas } of coberturaDaPlanta()) {
        for (const [x1, y1, x2, y2] of faixas) svg += `<polygon class="pl-cego" points="${chao([[x1, y1], [x2, y1], [x2, y2], [x1, y2]])}"/>`;
      }
    }
    // 3 · as portas e os nomes dos ambientes, no chão
    for (const porta of PLANTA.portas) {
      const [a, b] = [p(porta.x1, porta.y1), p(porta.x2, porta.y2)];
      svg += `<line class="pl-porta" x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}"/>`;
    }
    // 4 · o campo de visão de cada câmera, pintado no chão
    for (const cam of PLANTA.cameras) {
      const s = situacaoDoCanal(canalDe(cam.canal));
      const marcada = sel?.tipo === 'camera' && sel.id === cam.canal;
      const apagado = sel?.tipo === 'camera' && !marcada && !amb.editando;
      const classe = amb.camada === 'cobertura' && !amb.editando ? (['semimagem', 'pausado'].includes(s.chave) ? s.chave : 'ok') : s.chave;
      svg += `<polygon class="pl-cone ${classe}${marcada ? ' sel' : ''}${apagado ? ' apagado' : ''}" points="${chao(coneDaCamera(cam))}"/>`;
    }
    // 5 · paredes do fundo e equipamentos. Cada um é cortado em pedaços de
    //     até um metro, e os pedaços são desenhados do mais distante para o
    //     mais próximo: é o que faz um balcão comprido passar por trás de uma
    //     mesa e pela frente de outra, sem regra especial para ninguém.
    const volumes = [];
    const fundoDe = (x, y) => p(x, y)[2];
    const fatias = (tamanho) => {
      const n = Math.max(1, Math.ceil(tamanho));
      return Array.from({ length: n }, (_, i) => [(tamanho * i) / n, (tamanho * (i + 1)) / n]);
    };
    if (emPe) {
      // Só as paredes de FORA, e só as do fundo: parede entre dois ambientes
      // esconderia o que está atrás dela. A divisão interna é o risco no chão.
      const alto = PL.parede;
      const deFora = (x, y) => !ambienteEm(x, y);
      for (const a of PLANTA.ambientes) {
        for (const [de, ate] of fatias(a.w)) {
          const [x1, x2] = [a.x + de, a.x + ate];
          if (!deFora((x1 + x2) / 2, a.y - 0.05)) continue;
          volumes.push({
            fundo: fundoDe((x1 + x2) / 2, a.y) - 0.02,
            svg: `<polygon class="pl-parede" points="${pontos([p(x1, a.y, 0), p(x2, a.y, 0), p(x2, a.y, alto), p(x1, a.y, alto)])}"/>` +
              `<polyline class="pl-contorno" points="${pontos([p(x1, a.y, alto), p(x2, a.y, alto)])}"/>`,
          });
        }
        for (const [de, ate] of fatias(a.h)) {
          const [y1, y2] = [a.y + de, a.y + ate];
          if (!deFora(a.x - 0.05, (y1 + y2) / 2)) continue;
          volumes.push({
            fundo: fundoDe(a.x, (y1 + y2) / 2) - 0.02,
            svg: `<polygon class="pl-parede flanco" points="${pontos([p(a.x, y1, 0), p(a.x, y2, 0), p(a.x, y2, alto), p(a.x, y1, alto)])}"/>` +
              `<polyline class="pl-contorno" points="${pontos([p(a.x, y1, alto), p(a.x, y2, alto)])}"/>`,
          });
        }
      }
    }
    for (const m of PLANTA.moveis) {
      const marcado = sel?.tipo === 'movel' && sel.id === m.id;
      const toca = EQUIPAMENTOS[m.equip] || amb.editando ? ' style="cursor:pointer"' : '';
      const z = m.alt;
      const fx = fatias(m.w);
      const fy = fatias(m.h);
      fx.forEach(([xa, xb], i) => fy.forEach(([ya, yb], j) => {
        const [x1, x2, y1, y2] = [m.x + xa, m.x + xb, m.y + ya, m.y + yb];
        const ultimoX = i === fx.length - 1;
        const ultimoY = j === fy.length - 1;
        let s = '';
        if (emPe && ultimoY) s += `<polygon class="pl-movel frente" data-movel="${m.id}"${toca} points="${pontos([p(x1, y2, 0), p(x2, y2, 0), p(x2, y2, z), p(x1, y2, z)])}"/>`;
        if (emPe && ultimoX) s += `<polygon class="pl-movel flanco" data-movel="${m.id}"${toca} points="${pontos([p(x2, y1, 0), p(x2, y2, 0), p(x2, y2, z), p(x2, y1, z)])}"/>`;
        s += `<polygon class="pl-movel tampo" data-movel="${m.id}"${toca} points="${pontos([p(x1, y1, z), p(x2, y1, z), p(x2, y2, z), p(x1, y2, z)])}"/>`;
        if (ultimoX && ultimoY) {
          // o contorno do equipamento inteiro vai com o pedaço mais próximo
          const [X1, X2, Y1, Y2] = [m.x, m.x + m.w, m.y, m.y + m.h];
          const cl = `pl-contorno${marcado ? ' sel' : ''}`;
          s += emPe
            ? `<polygon class="${cl}" points="${pontos([p(X1, Y1, z), p(X2, Y1, z), p(X2, Y1, 0), p(X2, Y2, 0), p(X1, Y2, 0), p(X1, Y2, z)])}"/>` +
              `<polyline class="${cl}" points="${pontos([p(X1, Y2, z), p(X2, Y2, z), p(X2, Y1, z)])}"/>` +
              `<polyline class="${cl}" points="${pontos([p(X2, Y2, z), p(X2, Y2, 0)])}"/>`
            : `<polygon class="${cl}" points="${pontos([p(X1, Y1), p(X2, Y1), p(X2, Y2), p(X1, Y2)])}"/>`;
          // o nome cabe? só nos maiores, para não virar sopa de letras
          const [tx, ty] = p(m.x + m.w / 2, m.y + m.h / 2, z);
          const cabe = (m.w * Math.cos(rad(45 * amb.t)) + m.h * Math.sin(rad(45 * amb.t))) * proj.escala >= m.nome.length * 5.8 + 6;
          if (cabe && m.equip) s += `<text class="pl-movel-nome" x="${tx.toFixed(1)}" y="${(ty + 3).toFixed(1)}">${limpo(m.nome)}</text>`;
        }
        volumes.push({ fundo: fundoDe((x1 + x2) / 2, (y1 + y2) / 2), svg: s });
      }));
    }
    svg += volumes.sort((a, b) => a.fundo - b.fundo).map((v) => v.svg).join('');
    // o nome do ambiente, onde houver espaço — e só se couber na largura dele
    const letra = PL.L < 520 ? 6.6 : 8.4; // largura média de uma letra do nome, em pontos da tela
    const naTela = (r) => (r.w * Math.cos(rad(45 * amb.t)) + r.h * Math.sin(rad(45 * amb.t))) * proj.escala;
    for (const a of PLANTA.ambientes) {
      const largo = a.nome.length * letra;
      if (largo > naTela(a) - 8) continue;
      const [tx, ty] = p(...lugarDoNome(a, largo / 2 / proj.escala, 15 / proj.escala), 0);
      svg += `<text class="pl-nome" x="${tx.toFixed(1)}" y="${(ty + 4).toFixed(1)}">${limpo(a.nome)}</text>`;
    }
    // 6 · as câmeras, por cima de tudo: têm de dar para tocar
    for (const cam of PLANTA.cameras) {
      const c = canalDe(cam.canal);
      const s = situacaoDoCanal(c);
      const marcada = sel?.tipo === 'camera' && sel.id === cam.canal;
      const [bx, by] = p(cam.x, cam.y, 0);
      const [hx, hy] = p(cam.x, cam.y, pinoDa(cam));
      const raio = PL.L < 520 ? 10 : 12.5;
      svg +=
        (emPe ? `<line class="pl-poste" x1="${bx.toFixed(1)}" y1="${by.toFixed(1)}" x2="${hx.toFixed(1)}" y2="${hy.toFixed(1)}"/><circle class="pl-chao" cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="2.5"/>` : '') +
        `<g class="pl-cam ${s.chave}${marcada ? ' sel' : ''}${raio < 12 ? ' pq' : ''}" data-cam="${cam.canal}" role="button" tabindex="0" aria-pressed="${marcada}" ` +
        `aria-label="Câmera ${c.nome}, ${c.num === 'IP' ? 'câmera IP' : `canal ${c.num}`}: ${s.texto}">` +
        `<circle class="toque" cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="${raio + 8.5}"/>` +
        `<circle class="anel" cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="${raio + 4.5}"/>` +
        `<circle class="miolo" cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="${raio}"/>` +
        `<text x="${hx.toFixed(1)}" y="${hy.toFixed(1)}">${c.num}</text></g>`;
    }
    // 7 · na edição: a mira da câmera escolhida e o retângulo que está sendo desenhado
    if (amb.editando && sel?.tipo === 'camera') {
      const cam = PLANTA.cameras.find((x) => x.canal === sel.id);
      const [ax, ay] = p(cam.x, cam.y);
      const [mx, my] = p(cam.x + Math.cos(rad(cam.dir)) * 1.5, cam.y + Math.sin(rad(cam.dir)) * 1.5);
      svg += `<line class="pl-mira" x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${mx.toFixed(1)}" y2="${my.toFixed(1)}"/><circle class="pl-alca" data-alca cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="9"/>`;
    }
    if (amb.gesto?.modo === 'desenhar' && amb.gesto.ret) {
      const r = amb.gesto.ret;
      svg += `<polygon class="pl-rascunho" points="${chao([[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]])}"/>`;
    }
    plantaSvg.innerHTML = svg;
  }

  function desenharAmbiente() {
    // Em tela estreita a planta começa vista de cima: em perspectiva as oito
    // câmeras ficam umas sobre as outras. Vale só na primeira vez: depois
    // disso, quem escolhe a vista é quem está olhando.
    if (!amb.estreou && $('[data-planta]').clientWidth > 0) {
      amb.estreou = true;
      const estreita = $('[data-planta]').clientWidth < 520;
      amb.vista = estreita ? 'cima' : 'perspectiva';
      amb.t = estreita ? 0 : 1;
    }
    for (const b of $$('[data-amb-vista]')) b.setAttribute('aria-pressed', String(b.dataset.ambVista === amb.vista));
    for (const b of $$('[data-amb-camada]')) b.setAttribute('aria-pressed', String(b.dataset.ambCamada === amb.camada));
    for (const b of $$('[data-amb-ferramenta]')) b.setAttribute('aria-pressed', String(b.dataset.ambFerramenta === amb.ferramenta));
    $('[data-amb-so-leitura]').hidden = amb.editando;
    $('[data-amb-so-edicao]').hidden = !amb.editando;
    $('[data-amb-descartar]').hidden = !amb.editando;
    $('[data-amb-editar] span').textContent = amb.editando ? 'Concluir edição' : 'Editar planta';
    $('[data-amb-editar]').className = `btn ${amb.editando ? 'primario' : 'secundario'}`;
    $('[data-amb-editar] use').setAttribute('href', amb.editando ? '#i-check' : '#i-pencil');
    $('[data-planta]').classList.toggle('editando', amb.editando);
    for (const b of $$('[data-amb-vista]')) b.disabled = amb.editando;
    desenharPlanta();

    const cobertura = amb.camada === 'cobertura' && !amb.editando;
    $('[data-amb-legenda]').innerHTML = amb.editando
      ? '<span>Arraste uma câmera para movê-la; a bolinha âmbar gira a direção. Arraste um equipamento ou um ambiente para mudá-lo de lugar.</span>'
      : cobertura
        ? '<span><i class="ok"></i>o que as câmeras alcançam</span><span><i class="cego"></i>nenhuma câmera vê</span><span><i class="traco"></i>canal sem imagem ou pausado: não cobre</span>'
        : '<span><i class="ok"></i>conferindo</span><span><i class="alerta"></i>aviso nos últimos 10 min</span><span><i></i>sem conferência agora</span><span><i class="traco"></i>sem imagem ou pausado</span>';
    $('[data-amb-nota]').textContent = amb.editando
      ? amb.ferramenta
        ? `Arraste na planta para desenhar ${amb.ferramenta === 'ambiente' ? 'o ambiente' : 'o equipamento'}. Não precisa de medida exata: dá para corrigir os números ao lado.`
        : 'A planta é editada de cima. As medidas são em metros.'
      : 'Toque numa câmera para ver o canal; num equipamento, para ver o que o inventário sabe dele.';

    // a lista de câmeras: o mesmo que a planta mostra, para quem não usa o mouse
    $('[data-amb-cams]').innerHTML = ARVORE.map((s) => {
      const doSetor = AMB_CANAIS.filter((c) => c.setor === s.setor);
      return (
        `<li class="setor-nome">${s.setor}</li>` +
        doSetor
          .map((c) => {
            const sit = situacaoDoCanal(c);
            // canal que ainda não está na planta: na edição, tocar nele o põe; fora dela, não há o que mostrar
            const posta = PLANTA.cameras.some((x) => x.canal === c.id);
            return (
              `<li><button type="button" class="area-item" data-amb-cam="${c.id}" aria-pressed="${amb.sel?.tipo === 'camera' && amb.sel.id === c.id}"${posta || amb.editando ? '' : ' disabled title="Este canal ainda não está na planta."'}>` +
              `<span class="canal-num">${c.num}</span><span><b>${c.nome}</b></span>` +
              (posta ? `<span class="chip ${sit.chip}">${sit.texto}</span>` : `<span class="chip vazado">${amb.editando ? 'pôr na planta' : 'fora da planta'}</span>`) +
              `</button></li>`
            );
          })
          .join('')
      );
    }).join('');

    // a cobertura por ambiente
    $('[data-amb-cobertura]').hidden = !cobertura;
    if (cobertura) {
      $('[data-amb-cobertura-lista]').innerHTML = coberturaDaPlanta()
        .map(({ ambiente, parte }) => `<li><span>${ambiente.nome}</span><b>${Math.round(parte * 100)}%</b><span class="trilho"><i style="width:${parte * 100}%"></i></span></li>`)
        .join('');
    }
    desenharPainelDaPlanta();
  }

  const numeroDoCampo = (id, rotulo, valor, passo = 0.1) =>
    `<div class="campo"><label for="${id}">${rotulo}</label><input class="entrada mono" id="${id}" type="number" min="0.2" step="${passo}" value="${valor}" data-amb-campo="${id.replace('amb-', '')}"></div>`;

  function desenharPainelDaPlanta() {
    const painel = $('[data-amb-painel]');
    const sel = amb.sel;
    if (sel?.tipo === 'camera') {
      const cam = PLANTA.cameras.find((x) => x.canal === sel.id);
      const c = canalDe(sel.id);
      const sit = situacaoDoCanal(c);
      const criterios = c.criterios.length
        ? `<ul class="area-criterios">${c.criterios
            .map((k) => `<li><span class="selo-ic">${icone(ICONE_DO_TIPO[CRITERIOS[k].tipo])}</span><span><b>${CRITERIOS[k].nome}</b><small>${CRITERIOS[k].tipo}${CRITERIOS[k].quando === 'fora' ? ' · só com a loja fechada' : ''}</small></span>` +
              `<span class="chip ${CRITERIOS[k].ligado ? 'ok' : ''}">${CRITERIOS[k].ligado ? 'ligado' : 'desligado'}</span></li>`)
            .join('')}</ul>`
        : '<p class="vazio-linha">Nenhum critério neste canal. Nada é verificado aqui.</p>';
      const faixa = (campo, rotulo, min, max, passo, unidade) =>
        `<div class="faixa-campo"><label for="amb-${campo}">${rotulo}</label><output for="amb-${campo}">${String(cam[campo]).replace('.', ',')}${unidade}</output>` +
        `<input type="range" id="amb-${campo}" min="${min}" max="${max}" step="${passo}" value="${cam[campo]}" data-amb-faixa="${campo}" data-unidade="${unidade}"></div>`;
      painel.innerHTML =
        `<div class="cam-topo"><span class="canal-num">${c.num}</span><div><h3>${c.nome}</h3><p>${c.setor} · ${ambienteEm(cam.x, cam.y)?.nome ?? 'fora dos ambientes'}</p></div></div>` +
        `<div class="canal-chips"><span class="chip ${sit.chip}">${sit.texto}</span>${c.areas ? `<span class="chip vazado">${icone('crop')}${plural(c.areas.length, 'área', 'áreas')}</span>` : ''}</div>` +
        (amb.editando
          ? faixa('dir', 'Direção', 0, 359, 1, '°') + faixa('abertura', 'Abertura', 40, 120, 1, '°') + faixa('alcance', 'Alcance', 1, 12, 0.1, ' m') + faixa('alt', 'Altura', 2, 4, 0.1, ' m') +
            '<p class="nota">A abertura é a da lente: uma lente de 2,8 mm abre perto de 100°; uma de 3,6 mm, perto de 80°.</p>' +
            `<button class="btn perigo-leve mini" type="button" data-amb-excluir style="align-self:flex-start">${icone('trash-2', 'p')}Tirar da planta</button>`
          : `<h2>O que confere</h2>${criterios}` +
            `<div class="cam-descricao">${descricaoDoLugar(cam)}<small>Escrita a partir da planta. Vai junto com a imagem em cada análise deste canal que sobe à nuvem.</small></div>` +
            `<div class="cam-elos"><a class="elo" href="#area" data-ir="area">Quadro e área${icone('arrow-right', 'p')}</a>` +
            (AN_CANAIS.some((x) => x.id === c.id) ? `<button class="elo" type="button" data-amb-analises="${c.id}">Análises deste canal${icone('arrow-right', 'p')}</button>` : '') +
            `</div>`);
      return;
    }
    if (sel?.tipo === 'movel') {
      const m = PLANTA.moveis.find((x) => x.id === sel.id);
      const e = EQUIPAMENTOS[m.equip];
      const veem = camerasQueVeem(m);
      painel.innerHTML =
        `<div class="cam-topo"><span class="canal-num">${icone('package')}</span><div><h3>${limpo(e?.nome ?? m.nome)}</h3><p>${e ? `${e.tipo} · ${e.setor}` : 'móvel, sem cadastro no inventário'}</p></div></div>` +
        (amb.editando
          ? `<div class="campo"><label for="amb-nome">Nome</label><input class="entrada" id="amb-nome" value="${limpo(m.nome)}" data-amb-campo="nome"></div>` +
            // um equipamento está num lugar só: os que já estão em outro móvel não entram na lista
            `<div class="campo"><label for="amb-equip">Equipamento do inventário</label><select class="entrada" id="amb-equip" data-amb-campo="equip"><option value="">nenhum — é só um móvel</option>` +
            Object.entries(EQUIPAMENTOS)
              .filter(([id]) => id === m.equip || !PLANTA.moveis.some((x) => x.equip === id))
              .map(([id, eq]) => `<option value="${id}"${id === m.equip ? ' selected' : ''}>${eq.nome} · ${eq.setor}</option>`)
              .join('') +
            `</select><small>Ligado a um equipamento, o nome dele vai na descrição do lugar da câmera que o vê.</small></div>` +
            `<div class="pares">${numeroDoCampo('amb-w', 'Largura, em m', m.w)}${numeroDoCampo('amb-h', 'Comprimento, em m', m.h)}${numeroDoCampo('amb-alt', 'Altura, em m', m.alt)}</div>` +
            `<button class="btn perigo-leve mini" type="button" data-amb-excluir style="align-self:flex-start">${icone('trash-2', 'p')}Tirar da planta</button>`
          : (e
              ? `<div class="canal-chips"><span class="chip ${e.fotos.length ? 'ok' : 'atencao'}">${e.fotos.length ? plural(e.fotos.length, 'foto', 'fotos') : 'sem foto'}</span>` +
                `<span class="chip ${e.descricao ? 'ok' : ''}">${e.descricao ? 'descrito' : 'sem descrição'}</span></div>`
              : '') +
            `<dl class="lista-dl"><div><dt>Visto por</dt><dd>${veem.length ? veem.map((c) => `${c.nome} (${c.num})`).join(', ') : 'nenhuma câmera'}</dd></div>` +
            `<div><dt>Medidas</dt><dd>${String(m.w).replace('.', ',')} × ${String(m.h).replace('.', ',')} m · ${String(m.alt).replace('.', ',')} m de altura</dd></div></dl>` +
            (e?.descricao ? `<div class="cam-descricao">${e.descricao}</div>` : '') +
            (e ? `<div class="cam-elos"><button class="elo" type="button" data-equip-abrir="${m.equip}">Abrir no inventário${icone('arrow-right', 'p')}</button></div>` : ''));
      return;
    }
    if (sel?.tipo === 'ambiente' && amb.editando) {
      const a = PLANTA.ambientes.find((x) => x.id === sel.id);
      painel.innerHTML =
        `<h2>Ambiente</h2><div class="campo"><label for="amb-nome">Nome</label><input class="entrada" id="amb-nome" value="${limpo(a.nome)}" data-amb-campo="nome"></div>` +
        `<div class="campo"><label for="amb-setor">Setor</label><select class="entrada" id="amb-setor" data-amb-campo="setor">${ARVORE.map((s) => `<option${s.setor === a.setor ? ' selected' : ''}>${s.setor}</option>`).join('')}</select></div>` +
        `<div class="pares">${numeroDoCampo('amb-w', 'Largura, em m', a.w, 0.5)}${numeroDoCampo('amb-h', 'Comprimento, em m', a.h, 0.5)}</div>` +
        `<button class="btn perigo-leve mini" type="button" data-amb-excluir style="align-self:flex-start">${icone('trash-2', 'p')}Excluir o ambiente</button>`;
      return;
    }
    painel.innerHTML = `<h2>Nada selecionado</h2><p class="nota">${amb.editando ? 'Toque numa câmera, num equipamento ou num ambiente para mexer nele. Use os botões acima da planta para desenhar um novo.' : 'Toque numa câmera ou num equipamento da planta.'}</p>`;
  }

  /** Vai de uma vista para a outra girando a planta. */
  function girarPlanta(para) {
    amb.vista = para === 1 ? 'perspectiva' : 'cima';
    const de = amb.t;
    if (calmo || de === para) {
      amb.t = para;
      desenharAmbiente();
      return;
    }
    const inicio = performance.now();
    const passo = (agora) => {
      const k = Math.min(1, (agora - inicio) / 520);
      amb.t = de + (para - de) * (1 - (1 - k) ** 3);
      desenharPlanta();
      if (k < 1) requestAnimationFrame(passo);
      else desenharAmbiente();
    };
    desenharAmbiente();
    requestAnimationFrame(passo);
  }

  function selecionarNaPlanta(tipo, id) {
    amb.sel = tipo ? { tipo, id } : null;
    desenharAmbiente();
  }

  // cliques fora da planta: os controles, a lista e o painel
  document.addEventListener('click', (ev) => {
    const tela = ev.target.closest('[data-tela="ambiente"]');
    if (!tela) return;
    const vista = ev.target.closest('[data-amb-vista]');
    if (vista) { girarPlanta(vista.dataset.ambVista === 'perspectiva' ? 1 : 0); return; }
    const camada = ev.target.closest('[data-amb-camada]');
    if (camada) { amb.camada = camada.dataset.ambCamada; desenharAmbiente(); return; }
    const daLista = ev.target.closest('[data-amb-cam]');
    if (daLista) {
      if (!PLANTA.cameras.some((x) => x.canal === daLista.dataset.ambCam)) {
        if (!amb.editando) return;
        // entra no meio do primeiro ambiente, no teto, com uma lente comum
        const [x, y] = PLANTA.ambientes[0] ? centro(PLANTA.ambientes[0]) : [7, 4.5];
        PLANTA.cameras.push({ canal: daLista.dataset.ambCam, x, y, alt: 2.6, dir: 90, abertura: 80, alcance: 3 });
        avisar('Câmera posta na planta. Arraste para o lugar dela e gire a bolinha âmbar para onde ela olha.');
      }
      selecionarNaPlanta('camera', daLista.dataset.ambCam);
      $(`[data-amb-cam="${daLista.dataset.ambCam}"]`)?.focus({ preventScroll: true });
      return;
    }
    const analises = ev.target.closest('[data-amb-analises]');
    if (analises) { Object.assign(an, AN_PADRAO, { canal: analises.dataset.ambAnalises }); ir('analises'); return; }
    const ferramenta = ev.target.closest('[data-amb-ferramenta]');
    if (ferramenta) {
      amb.ferramenta = amb.ferramenta === ferramenta.dataset.ambFerramenta ? '' : ferramenta.dataset.ambFerramenta;
      desenharAmbiente();
      return;
    }
    if (ev.target.closest('[data-amb-editar]')) {
      if (!amb.editando) {
        amb.antes = JSON.stringify(PLANTA);
        amb.vistaAntes = amb.vista;
        amb.editando = true;
        amb.ferramenta = '';
        girarPlanta(0);
      } else {
        amb.editando = false;
        amb.ferramenta = '';
        amb.antes = null;
        girarPlanta(amb.vistaAntes === 'perspectiva' ? 1 : 0);
        avisar('Planta salva. A descrição do lugar de cada canal foi refeita.');
      }
      return;
    }
    if (ev.target.closest('[data-amb-descartar]')) {
      PLANTA = JSON.parse(amb.antes);
      amb.editando = false;
      amb.ferramenta = '';
      amb.sel = null;
      girarPlanta(amb.vistaAntes === 'perspectiva' ? 1 : 0);
      avisar('Mudanças descartadas. A planta voltou a como estava.');
      return;
    }
    if (ev.target.closest('[data-amb-excluir]')) {
      const { tipo, id } = amb.sel;
      if (tipo === 'camera') PLANTA.cameras = PLANTA.cameras.filter((c) => c.canal !== id);
      else if (tipo === 'movel') PLANTA.moveis = PLANTA.moveis.filter((m) => m.id !== id);
      else PLANTA.ambientes = PLANTA.ambientes.filter((a) => a.id !== id);
      avisar(tipo === 'camera' ? 'Câmera tirada da planta. O canal continua cadastrado.' : tipo === 'movel' ? 'Tirado da planta. O cadastro no inventário continua.' : 'Ambiente excluído.');
      selecionarNaPlanta('', '');
    }
  });

  // os campos do painel, na edição
  $('[data-amb-painel]').addEventListener('input', (ev) => {
    const sel = amb.sel;
    const faixa = ev.target.dataset.ambFaixa;
    if (faixa && sel?.tipo === 'camera') {
      const cam = PLANTA.cameras.find((x) => x.canal === sel.id);
      cam[faixa] = Number(ev.target.value);
      ev.target.previousElementSibling.textContent = `${String(cam[faixa]).replace('.', ',')}${ev.target.dataset.unidade}`;
      desenharPlanta();
      return;
    }
    const campo = ev.target.dataset.ambCampo;
    if (!campo || !sel) return;
    const item = (sel.tipo === 'movel' ? PLANTA.moveis : PLANTA.ambientes).find((x) => x.id === sel.id);
    if (campo === 'equip') {
      item.equip = ev.target.value || undefined;
      // ligar a um equipamento dá ao móvel o nome dele, se o móvel ainda não tinha um
      if (item.equip && item.nome === 'Equipamento') item.nome = EQUIPAMENTOS[item.equip].nome;
      desenharAmbiente();
      return;
    }
    if (campo === 'nome' || campo === 'setor') item[campo] = ev.target.value.trim() || item[campo];
    else if (Number(ev.target.value) > 0) item[campo] = Number(ev.target.value);
    desenharPlanta();
  });

  // a planta: toque, teclado e arrasto
  const plantaSvg = $('[data-planta-svg]');
  /** Onde o ponteiro está, em metros no chão (só vale de cima). */
  function noChao(ev) {
    const pt = plantaSvg.createSVGPoint();
    pt.x = ev.clientX;
    pt.y = ev.clientY;
    const q = pt.matrixTransform(plantaSvg.getScreenCTM().inverse());
    return amb.proj.chao(q.x, q.y);
  }
  const noLimite = (v, min, max) => Math.min(max, Math.max(min, v));
  const grade = (v, passo) => Math.round(v / passo) * passo;
  const limites = () => {
    const xs = PLANTA.ambientes.flatMap((a) => [a.x, a.x + a.w]);
    const ys = PLANTA.ambientes.flatMap((a) => [a.y, a.y + a.h]);
    return [Math.min(0, ...xs), Math.min(0, ...ys), Math.max(14, ...xs), Math.max(9, ...ys)];
  };

  plantaSvg.addEventListener('click', (ev) => {
    if (amb.editando) return; // na edição quem manda é o arrasto
    const cam = ev.target.closest('[data-cam]');
    if (cam) {
      selecionarNaPlanta('camera', cam.dataset.cam);
      $(`[data-cam="${cam.dataset.cam}"]`)?.focus({ preventScroll: true });
      return;
    }
    const movel = ev.target.closest('[data-movel]');
    if (movel && PLANTA.moveis.find((m) => m.id === movel.dataset.movel)?.equip) selecionarNaPlanta('movel', movel.dataset.movel);
  });
  plantaSvg.addEventListener('keydown', (ev) => {
    const cam = ev.target.closest('[data-cam]');
    if (!cam || (ev.key !== 'Enter' && ev.key !== ' ')) return;
    ev.preventDefault();
    selecionarNaPlanta('camera', cam.dataset.cam);
    $(`[data-cam="${cam.dataset.cam}"]`)?.focus({ preventScroll: true });
  });

  plantaSvg.addEventListener('pointerdown', (ev) => {
    if (!amb.editando || amb.t > 0.02) return;
    plantaSvg.setPointerCapture?.(ev.pointerId);
    const [x, y] = noChao(ev);
    if (ev.target.closest('[data-alca]')) { amb.gesto = { modo: 'girar' }; return; }
    const cam = ev.target.closest('[data-cam]');
    if (cam) {
      amb.sel = { tipo: 'camera', id: cam.dataset.cam };
      amb.gesto = { modo: 'camera' };
      desenharAmbiente();
      return;
    }
    if (amb.ferramenta) { amb.gesto = { modo: 'desenhar', x, y, ret: null }; return; }
    // o menor retângulo que contém o ponto: equipamento antes de ambiente
    const contem = (r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    const movel = PLANTA.moveis.filter(contem).sort((a, b) => a.w * a.h - b.w * b.h)[0];
    const ambiente = PLANTA.ambientes.filter(contem).sort((a, b) => a.w * a.h - b.w * b.h)[0];
    const alvo = movel ?? ambiente;
    if (!alvo) { selecionarNaPlanta('', ''); return; }
    amb.sel = { tipo: movel ? 'movel' : 'ambiente', id: alvo.id };
    amb.gesto = { modo: 'mover', dx: x - alvo.x, dy: y - alvo.y, x0: alvo.x, y0: alvo.y, mexeu: false };
    desenharAmbiente();
  });
  plantaSvg.addEventListener('pointermove', (ev) => {
    const g = amb.gesto;
    if (!g) return;
    const [x, y] = noChao(ev);
    const [minX, minY, maxX, maxY] = limites();
    if (g.modo === 'camera' || g.modo === 'girar') {
      const cam = PLANTA.cameras.find((c) => c.canal === amb.sel.id);
      if (g.modo === 'camera') {
        cam.x = noLimite(grade(x, 0.1), minX, maxX);
        cam.y = noLimite(grade(y, 0.1), minY, maxY);
      } else {
        cam.dir = (Math.round((Math.atan2(y - cam.y, x - cam.x) * 180) / Math.PI) + 360) % 360;
      }
      desenharPlanta();
      return;
    }
    if (g.modo === 'desenhar') {
      const x1 = grade(Math.min(g.x, x), 0.25);
      const y1 = grade(Math.min(g.y, y), 0.25);
      g.ret = { x: x1, y: y1, w: grade(Math.abs(x - g.x), 0.25), h: grade(Math.abs(y - g.y), 0.25) };
      desenharPlanta();
      return;
    }
    const item = (amb.sel.tipo === 'movel' ? PLANTA.moveis : PLANTA.ambientes).find((i) => i.id === amb.sel.id);
    const passo = amb.sel.tipo === 'movel' ? 0.1 : 0.5;
    const nx = noLimite(grade(x - g.dx, passo), minX, maxX - item.w);
    const ny = noLimite(grade(y - g.dy, passo), minY, maxY - item.h);
    if (nx !== item.x || ny !== item.y) g.mexeu = true;
    // quem mora dentro do ambiente vai junto com ele
    if (amb.sel.tipo === 'ambiente') {
      const [mx, my] = [nx - item.x, ny - item.y];
      const dentro = (px, py) => px >= item.x && px <= item.x + item.w && py >= item.y && py <= item.y + item.h;
      for (const m of PLANTA.moveis) if (dentro(...centro(m))) { m.x += mx; m.y += my; }
      for (const c of PLANTA.cameras) if (dentro(c.x, c.y)) { c.x += mx; c.y += my; }
    }
    item.x = nx;
    item.y = ny;
    desenharPlanta();
  });
  const soltarNaPlanta = () => {
    const g = amb.gesto;
    if (!g) return;
    amb.gesto = null;
    if (g.modo === 'desenhar') {
      const r = g.ret;
      if (r && r.w >= 0.5 && r.h >= 0.5) {
        const id = `novo-${Date.now().toString(36)}`;
        if (amb.ferramenta === 'ambiente') PLANTA.ambientes.push({ id, nome: `Ambiente ${PLANTA.ambientes.length + 1}`, setor: ARVORE[0].setor, ...r });
        else PLANTA.moveis.push({ id, nome: 'Equipamento', alt: 0.9, ...r });
        amb.sel = { tipo: amb.ferramenta === 'ambiente' ? 'ambiente' : 'movel', id };
        avisar(amb.ferramenta === 'ambiente' ? 'Ambiente criado. Dê um nome e escolha o setor.' : 'Equipamento posto na planta. Dê um nome; o cadastro completo fica no inventário.');
        amb.ferramenta = '';
      }
    }
    desenharAmbiente();
    if (g.modo === 'desenhar') $('#amb-nome')?.select();
  };
  plantaSvg.addEventListener('pointerup', soltarNaPlanta);
  plantaSvg.addEventListener('pointercancel', soltarNaPlanta);

  // ── o inventário ──
  /** O retrato do equipamento: no protótipo, um desenho; no console, a foto. */
  function miniDoEquip(tipo, origem = 'canal') {
    const fundo = origem === 'canal' ? '#B9C2CE' : '#D8CFC2';
    const formas = {
      chapa: '<rect x="14" y="16" width="100" height="40" rx="4" fill="#5F6B7A"/><rect x="20" y="21" width="42" height="30" rx="2" fill="#8D99A8"/><rect x="66" y="21" width="42" height="30" rx="2" fill="#8D99A8"/>',
      fritadeira: '<rect x="30" y="12" width="68" height="48" rx="4" fill="#5F6B7A"/><rect x="36" y="18" width="26" height="36" rx="2" fill="#E2B94B"/><rect x="66" y="18" width="26" height="36" rx="2" fill="#E2B94B"/>',
      bancada: '<rect x="8" y="20" width="112" height="34" rx="3" fill="#8D99A8"/><rect x="12" y="23" width="20" height="12" rx="2" fill="#5F7A6B"/><rect x="36" y="23" width="20" height="12" rx="2" fill="#C99A6B"/><rect x="60" y="23" width="20" height="12" rx="2" fill="#BE5B5B"/><rect x="88" y="38" width="28" height="12" rx="2" fill="#E7D9A8"/>',
      'geladeira ou freezer': '<rect x="42" y="6" width="44" height="60" rx="4" fill="#DDE5EE"/><rect x="42" y="30" width="44" height="2" fill="#8D99A8"/><rect x="80" y="12" width="2" height="12" fill="#5F6B7A"/><rect x="80" y="38" width="2" height="16" fill="#5F6B7A"/>',
      'balcão': '<rect x="6" y="28" width="116" height="20" rx="3" fill="#2A3442"/><rect x="12" y="32" width="18" height="12" rx="2" fill="#586474"/><rect x="92" y="32" width="24" height="12" rx="2" fill="#8D99A8"/>',
      caixa: '<rect x="26" y="26" width="76" height="26" rx="3" fill="#2A3442"/><rect x="48" y="10" width="32" height="20" rx="2" fill="#586474"/><rect x="34" y="40" width="60" height="8" rx="2" fill="#8D99A8"/>',
      prateleira: '<rect x="18" y="8" width="92" height="56" rx="2" fill="#7F8B9A"/><rect x="18" y="24" width="92" height="3" fill="#2A3442"/><rect x="18" y="42" width="92" height="3" fill="#2A3442"/><rect x="26" y="12" width="14" height="12" fill="#E2B94B"/><rect x="50" y="30" width="18" height="12" fill="#C99A6B"/>',
    };
    return `<svg viewBox="0 0 128 72" aria-hidden="true"><rect width="128" height="72" fill="${fundo}"/>${formas[tipo] ?? formas.bancada}</svg>`;
  }

  function desenharInventario() {
    const lugar = ([canal, area]) => `${canalDe(canal).nome} (${canalDe(canal).num})${area === 'quadro inteiro' ? '' : ` · ${area}`}`;
    $('[data-inventario]').innerHTML = ARVORE.map((s, i) => {
      const doSetor = Object.entries(EQUIPAMENTOS).filter(([, e]) => e.setor === s.setor);
      const cartoes = doSetor
        .map(([id, e]) => {
          const pronta = e.aparece.some(([c]) => CANAIS_COM_FOTO_PADRAO.has(c));
          return (
            `<article class="equip cartao"><div class="equip-foto">${e.fotos.length ? miniDoEquip(e.tipo, e.fotos[0]) : `<span>${icone('image', 'g')}</span>`}</div>` +
            `<div class="equip-corpo"><h3>${e.nome}</h3><p>${e.tipo}${e.aparece.length ? ` · ${e.aparece.map(lugar).join(', ')}` : ' · nenhuma câmera marcada'}</p>` +
            `<div class="canal-chips"><span class="chip ${e.fotos.length ? 'ok' : 'atencao'}">${e.fotos.length ? `${plural(e.fotos.length, 'foto', 'fotos')} de 4` : 'sem foto'}</span>` +
            `<span class="chip ${e.descricao ? 'ok' : ''}">${e.descricao ? 'descrito' : 'sem descrição'}</span>` +
            (pronta ? `<span class="chip vazado" title="O canal em que ele aparece tem foto padrão: critério de comparação nessa área é julgado na loja, sem custo">${icone('cpu')}compara na loja</span>` : '') +
            `</div></div>` +
            `<div class="canal-pe"><span>${e.conferir.length ? `${plural(e.conferir.length, 'ponto', 'pontos')} a conferir` : 'nada a conferir ainda'}</span>` +
            `<button class="elo" type="button" data-equip-abrir="${id}">Abrir${icone('arrow-right', 'p')}</button></div></article>`
          );
        })
        .join('');
      return (
        `<section class="secao" aria-labelledby="inv-${i}"><div class="setor-cab">${icone('folder')}<h2 id="inv-${i}">${s.setor}</h2>` +
        `<span class="suave">${doSetor.length ? plural(doSetor.length, 'equipamento', 'equipamentos') : 'nenhum equipamento'}</span></div>` +
        (cartoes ? `<div class="equips">${cartoes}</div>` : '<p class="vazio-linha">Nenhum equipamento cadastrado neste setor.</p>') +
        `</section>`
      );
    }).join('');
  }

  const feq = { id: '', fotos: [], conferir: [], aparece: [] };
  const setorDoEquip = () => {
    const v = $('#feq-setor').value;
    return v.startsWith('＋') ? $('#feq-setor-nome').value.trim() : v;
  };
  function desenharOndeAparece() {
    $('[data-feq-aparece]').innerHTML = feq.aparece.length
      ? feq.aparece
          .map(([canal, area]) => `<li><span class="selo-ic">${icone('cctv')}</span><span><b>${canalDe(canal).nome}</b><small>canal ${canalDe(canal).num} · ${area}${CANAIS_COM_FOTO_PADRAO.has(canal) ? ' · com foto padrão' : ''}</small></span><a class="elo" href="#area" data-ir="area">Ver</a></li>`)
          .join('')
      : '<li class="vazio-linha">Nenhuma câmera marcada. Use “Usar o quadro de um canal” para dizer onde ele aparece.</li>';
  }
  /** O cadastro como está na tela vai para a lista — é o que "guardar na hora" quer dizer. */
  function guardarEquip() {
    const antes = EQUIPAMENTOS[feq.id];
    EQUIPAMENTOS[feq.id] = {
      ...(antes ?? { descricao: '', conferir: [] }),
      nome: antes?.nome ?? $('#feq-nome').value.trim(),
      setor: antes?.setor ?? (setorDoEquip() || 'Cozinha'),
      tipo: antes?.tipo ?? $('#feq-tipo').value,
      fotos: [...feq.fotos],
      aparece: feq.aparece.map((x) => [...x]),
    };
    $('[data-feq-titulo]').textContent = EQUIPAMENTOS[feq.id].nome;
    $('[data-feq-excluir]').hidden = false;
    desenharInventario();
  }
  /** As fotos são guardadas NA HORA: num equipamento novo, a primeira já cria o cadastro. */
  function porFotoNoEquip(origem, canal) {
    if (!$('#feq-nome').value.trim()) {
      avisar('Dê um nome ao equipamento antes de pôr a foto.');
      $('#feq-nome').focus({ preventScroll: true });
      return false;
    }
    if (!feq.id) feq.id = `equip-${Date.now().toString(36)}`;
    feq.fotos.push(origem);
    if (origem === 'canal' && !feq.aparece.some(([c]) => c === canal)) feq.aparece.push([canal, 'quadro inteiro']);
    guardarEquip();
    desenharFotosDoEquip();
    desenharOndeAparece();
    avisar(origem === 'canal' ? 'Quadro do canal guardado como foto.' : 'Foto enviada.');
    return true;
  }
  function desenharFotosDoEquip() {
    const tipo = $('#feq-tipo').value;
    $('[data-feq-conta]').textContent = `· ${feq.fotos.length} de 4`;
    $('[data-feq-fotos]').innerHTML = Array.from({ length: 4 }, (_, i) => {
      const origem = feq.fotos[i];
      return origem
        ? `<li class="foto">${miniDoEquip(tipo, origem)}<span>${origem === 'canal' ? 'do quadro do canal' : 'foto enviada'}</span>` +
          `<button class="btn fantasma quadrado mini" type="button" data-feq-tirar="${i}" data-so-config aria-label="Tirar a foto ${i + 1}">${icone('x')}</button></li>`
        : `<li class="foto vazia"><span>${i === feq.fotos.length ? 'próxima foto' : ''}</span></li>`;
    }).join('');
    for (const b of $$('[data-feq-foto]')) b.disabled = feq.fotos.length >= 4;
  }
  function desenharConferirDoEquip() {
    $('[data-feq-conferir]').hidden = feq.conferir.length === 0;
    $('[data-feq-conferir-lista]').innerHTML = feq.conferir
      .map(
        (texto, i) =>
          `<li><span class="selo-ic">${icone('scan-search')}</span><span><b>${texto}</b></span>` +
          `<button class="btn secundario mini" type="button" data-feq-criterio="${i}" data-so-config>Criar critério</button></li>`,
      )
      .join('');
  }

  function abrirEquipamento(id, gatilho) {
    const e = EQUIPAMENTOS[id];
    feq.id = id;
    feq.fotos = e ? [...e.fotos] : [];
    feq.conferir = e ? [...e.conferir] : [];
    feq.aparece = e ? e.aparece.map((x) => [...x]) : [];
    contexto = { ...contexto, nome: e?.nome ?? '' };
    abrirFolha('folha-equip', e ? 'editar' : 'novo', gatilho);
    $('[data-feq-titulo]').textContent = e ? e.nome : 'Novo equipamento';
    $('#feq-nome').value = e?.nome ?? '';
    $('#feq-setor').value = e?.setor ?? 'Cozinha';
    $('#feq-tipo').value = e?.tipo ?? 'chapa';
    // sugestão da análise que ainda não foi salva: volta aos campos
    $('#feq-desc').value = e?.sugestao?.descricao ?? e?.descricao ?? '';
    if (e?.sugestao) feq.conferir = [...e.sugestao.conferir];
    $('[data-feq-sugestao]').hidden = !e?.sugestao;
    desenharOndeAparece();
    // a escolha do canal abre fechada, com os canais da loja; o setor novo, sem o campo do nome
    $('[data-feq-escolher]').hidden = true;
    $('#feq-quadro').innerHTML = AMB_CANAIS.map((c) => `<option value="${c.id}">${c.nome} (${c.num})</option>`).join('');
    $('[data-feq-setor-novo]').hidden = true;
    $('#feq-setor-nome').value = '';
    $('[data-feq-excluir]').hidden = !e;
    // Quem só vê abre o cadastro para LER: a gaveta fica fora do console,
    // então a regra que esconde os botões de quem configura não chega nela.
    const soLe = app.dataset.perfil === 'supervisao';
    $('#folha-equip').dataset.leitura = String(soLe);
    for (const campo of $$('#f-equip input, #f-equip select, #f-equip textarea')) campo.disabled = soLe;
    desenharFotosDoEquip();
    desenharConferirDoEquip();
    if (!e) $('#feq-nome').focus({ preventScroll: true });
  }

  document.addEventListener('click', (ev) => {
    const abrir = ev.target.closest('[data-equip-abrir]');
    if (abrir) { abrirEquipamento(abrir.dataset.equipAbrir, abrir); return; }
    const foto = ev.target.closest('[data-feq-foto]');
    if (foto) {
      // o quadro de QUAL canal: a escolha abre embaixo dos botões
      if (foto.dataset.feqFoto === 'canal') $('[data-feq-escolher]').hidden = !$('[data-feq-escolher]').hidden;
      else porFotoNoEquip('celular');
      return;
    }
    if (ev.target.closest('[data-feq-desistir]')) { $('[data-feq-escolher]').hidden = true; return; }
    if (ev.target.closest('[data-feq-usar]')) {
      if (porFotoNoEquip('canal', $('#feq-quadro').value)) $('[data-feq-escolher]').hidden = true;
      return;
    }
    const tirar = ev.target.closest('[data-feq-tirar]');
    if (tirar) {
      feq.fotos.splice(Number(tirar.dataset.feqTirar), 1);
      // sem foto tirada de canal, não há mais como dizer onde ele aparece
      if (!feq.fotos.includes('canal')) feq.aparece = [];
      if (EQUIPAMENTOS[feq.id]) guardarEquip();
      desenharFotosDoEquip();
      desenharOndeAparece();
      avisar('Foto tirada.');
      return;
    }
    if (ev.target.closest('[data-feq-manter]')) {
      // a sugestão é deixada de lado: os campos voltam ao que está salvo
      const e = EQUIPAMENTOS[feq.id];
      if (e) delete e.sugestao;
      $('#feq-desc').value = e?.descricao ?? '';
      feq.conferir = e ? [...e.conferir] : [];
      $('[data-feq-sugestao]').hidden = true;
      desenharConferirDoEquip();
      return;
    }
    const excluirEquip = ev.target.closest('[data-feq-excluir]');
    if (excluirEquip) {
      const nome = EQUIPAMENTOS[feq.id]?.nome ?? '';
      fecharTudo();
      abrirDialogo('excluir-equip', null, nome);
      return;
    }
    const analisar = ev.target.closest('[data-feq-analisar]');
    if (analisar) {
      if (!feq.fotos.length) { avisar('Ponha pelo menos uma foto: é dela que a descrição sai.'); return; }
      const antes = analisar.innerHTML;
      analisar.disabled = true;
      analisar.innerHTML = `${icone('loader-circle', 'gira')}Analisando ${plural(feq.fotos.length, 'foto', 'fotos')}…`;
      setTimeout(() => {
        analisar.disabled = false;
        analisar.innerHTML = antes;
        const modelo = Object.values(EQUIPAMENTOS).find((e) => e.tipo === $('#feq-tipo').value && e.descricao) ?? EQUIPAMENTOS.montagem1;
        // A resposta é uma SUGESTÃO: fica guardada no cadastro até alguém
        // salvar — fechar a gaveta não a perde.
        if (EQUIPAMENTOS[feq.id]) EQUIPAMENTOS[feq.id].sugestao = { descricao: modelo.descricao, conferir: [...modelo.conferir] };
        $('#feq-desc').value = modelo.descricao;
        feq.conferir = [...modelo.conferir];
        $('[data-feq-sugestao]').hidden = false;
        desenharConferirDoEquip();
        avisar('Descrição pronta. Leia e corrija o que não bater antes de salvar.');
      }, calmo ? 0 : 1500);
      return;
    }
    const criterio = ev.target.closest('[data-feq-criterio]');
    if (criterio) {
      const texto = feq.conferir[Number(criterio.dataset.feqCriterio)];
      const e = EQUIPAMENTOS[feq.id];
      const [canal, area] = e?.aparece[0] ?? [];
      const nomeDoCanal = canal ? canalDe(canal).nome : '';
      contexto = { ...contexto, nome: '', criterio: '', canalNovo: canal ? (area === 'quadro inteiro' ? nomeDoCanal : `${nomeDoCanal}/${area}`) : '' };
      abrirFolha('folha-criterio', 'novo', null);
      $('#fcr-nome').value = texto;
      $('#fcr-texto').value = `${texto}.`;
      $('#fcr-p-livre').checked = true;
      $('#fcr-ref').checked = true;
    }
  });
  $('#feq-tipo').addEventListener('change', desenharFotosDoEquip);
  $('#feq-setor').addEventListener('change', () => {
    $('[data-feq-setor-novo]').hidden = !$('#feq-setor').value.startsWith('＋');
    if (!$('[data-feq-setor-novo]').hidden) $('#feq-setor-nome').focus({ preventScroll: true });
  });
  $('#f-equip').addEventListener('submit', (ev) => {
    const nome = $('#feq-nome').value.trim();
    const setor = setorDoEquip();
    if (!setor) {
      // "cadastrar novo setor" sem o nome: não salva, e diz por quê
      ev.preventDefault();
      ev.stopImmediatePropagation();
      avisar('Diga o nome do setor novo.');
      $('#feq-setor-nome').focus({ preventScroll: true });
      return;
    }
    if (!ARVORE.some((s) => s.setor === setor)) {
      ARVORE.push({ setor, canais: [] });
      const opcao = document.createElement('option');
      opcao.textContent = setor;
      $('#feq-setor').lastElementChild.before(opcao);
    }
    const id = feq.id || `equip-${Date.now().toString(36)}`;
    EQUIPAMENTOS[id] = {
      ...(EQUIPAMENTOS[id] ?? {}),
      nome, setor, tipo: $('#feq-tipo').value,
      fotos: [...feq.fotos], aparece: feq.aparece.map((x) => [...x]), descricao: $('#feq-desc').value.trim(), conferir: [...feq.conferir],
    };
    // salvar é decidir qual é a descrição: a sugestão fica resolvida
    delete EQUIPAMENTOS[id].sugestao;
    $('#f-equip').dataset.sucessoNovo = $('#f-equip').dataset.sucessoEditar = `“${nome}” salvo no inventário.`;
    desenharInventario();
    if (!$('[data-tela="ambiente"]').hidden) desenharAmbiente();
  }, { capture: true });

  // ═══════════════════════ partida ═══════════════════════
  desenharCriterios();
  desenharOndeVale();
  ajustarTipo();
  desenharArea();
  desenharPadrao();
  desenharInventario();
  pdContarRever();
  pintarTema();
  // a planta é desenhada no tamanho em que aparece: mudou a janela, redesenha
  if ('ResizeObserver' in window) {
    new ResizeObserver(() => { if (!$('[data-tela="ambiente"]').hidden) desenharPlanta(); }).observe($('[data-planta]'));
    new ResizeObserver(() => { if ($('[data-pd-hoje]').clientWidth > 0 && pd.hoje) pdHoje(); }).observe($('[data-pd-hoje]'));
  }

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
