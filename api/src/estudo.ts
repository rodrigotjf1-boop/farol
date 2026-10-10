// =====================================================================
// O estudo do critério — quando vale a pena olhar, e o funil
// =====================================================================
// Pedido do dono (A19, 08/10/2026): os critérios têm de ser estudados
// para gerar gatilhos, sem julgamento desnecessário "sem movimento ou sem
// o contexto acontecendo". O exemplo é dele: para saber se o colaborador
// da chapa salga as carnes, é preciso haver carne na chapa e colaborador
// no posto — sem isso não se analisa.
//
// O estudo é a ficha de seis partes do critério (contexto, gatilho,
// janela, ação, desfecho, fora de contexto). Duas delas têm, além do
// texto, a forma que o agente entende — o que a loja confere SOZINHA:
//
//   contexto  o que precisa estar acontecendo. TODAS as condições valem.
//   gatilho   o que abre a análise. Basta UMA. Vazio = toda olhada.
//
// Cada condição lê um sinal (pessoa, movimento, foto padrão) num lugar do
// canal: o quadro do próprio critério ("aqui"), a imagem completa
// ("canal") ou outro quadro do mesmo canal ("quadro", com o id). Quem lê
// os sinais é o agente (`agent/farol_agent/sinais.py`); aqui só se guarda
// e se confere a forma. As listas são as de
// `contratos/estudo-do-criterio.json`.
//
// Só o estudo CONFIRMADO desce para o agente, e só para o agente que
// declara saber lidar com ele (`?sabe=estudo`). Sem estudo confirmado, o
// critério segue com o "quando vale a pena conferir" de sempre.
// =====================================================================

export const PARTES = ['contexto', 'gatilho', 'janela', 'acao', 'desfecho', 'fora'] as const;

export const SINAIS_DE_CONTEXTO = ['pessoa', 'sem_pessoa', 'movimento', 'parado', 'fora_do_padrao', 'no_padrao'] as const;
export const SINAIS_DE_GATILHO = [
  'toda_olhada', 'a_cada', 'entrou', 'saiu', 'mexeu', 'parou', 'saiu_do_padrao', 'voltou_ao_padrao',
] as const;
/** Os gatilhos que são do relógio, e não de um lugar. */
export const GATILHOS_SEM_LUGAR: readonly string[] = ['toda_olhada', 'a_cada'];
export const ONDES = ['aqui', 'canal', 'quadro'] as const;

/** Pares que nunca valem juntos no mesmo lugar. */
export const CONTRARIOS: readonly (readonly [string, string])[] = [
  ['pessoa', 'sem_pessoa'], ['movimento', 'parado'], ['fora_do_padrao', 'no_padrao'],
];

/**
 * Os tipos de critério que usam contexto e gatilho. Presença e contagem
 * são conferidas na loja em toda olhada — ali a olhada é a própria medida.
 */
export const TIPOS_QUE_USAM_ESTUDO: readonly string[] = ['estado', 'acao', 'comparacao'];

export const MINUTOS = { minimo: 1, maximo: 720 } as const;
export const MAX_POR_LISTA = 6;
export const MAX_TEXTO_DA_PARTE = 600;

/** O que o agente declara (`?sabe=estudo`) para receber o estudo. */
export const SABE_ESTUDO = 'estudo';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Condicao = { sinal: string; onde?: string; zonaId?: string; minutos?: number };

export type EstudoLido = {
  partes: Record<string, string>;
  contexto: Condicao[];
  gatilho: Condicao[];
  confirmado: boolean;
};

type Lido<T> = { ok: T } | { problema: string };

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** O lugar de uma condição, sem o que não é dela. */
function lerLugar(c: Record<string, unknown>, onde: string): Lido<{ onde: string; zonaId?: string }> {
  const lugar = c.onde ?? 'aqui';
  if (typeof lugar !== 'string' || !(ONDES as readonly string[]).includes(lugar)) {
    return { problema: `${onde}.onde: um de ${ONDES.join(', ')}` };
  }
  if (lugar === 'quadro') {
    if (typeof c.zonaId !== 'string' || !UUID.test(c.zonaId)) {
      return { problema: `${onde}.zonaId: diga qual quadro (o id dele)` };
    }
    return { ok: { onde: lugar, zonaId: c.zonaId.toLowerCase() } };
  }
  if (c.zonaId != null) return { problema: `${onde}.zonaId: só com onde = quadro` };
  return { ok: { onde: lugar } };
}

const chaveDoLugar = (c: Condicao): string => (c.onde === 'quadro' ? `quadro:${c.zonaId}` : String(c.onde));

function lerContexto(bruto: unknown): Lido<Condicao[]> {
  if (bruto == null) return { ok: [] };
  if (!Array.isArray(bruto)) return { problema: 'contexto: uma lista de condições' };
  if (bruto.length > MAX_POR_LISTA) return { problema: `contexto: no máximo ${MAX_POR_LISTA} condições` };
  const saida: Condicao[] = [];
  for (const [i, item] of bruto.entries()) {
    const onde = `contexto[${i}]`;
    if (!ehObjeto(item)) return { problema: `${onde}: não é uma condição` };
    if (typeof item.sinal !== 'string' || !(SINAIS_DE_CONTEXTO as readonly string[]).includes(item.sinal)) {
      return { problema: `${onde}.sinal: um de ${SINAIS_DE_CONTEXTO.join(', ')}` };
    }
    if (item.minutos != null) return { problema: `${onde}.minutos: só no gatilho a_cada` };
    const lugar = lerLugar(item, onde);
    if ('problema' in lugar) return lugar;
    const c: Condicao = { sinal: item.sinal, ...lugar.ok };
    if (saida.some((o) => o.sinal === c.sinal && chaveDoLugar(o) === chaveDoLugar(c))) {
      return { problema: `${onde}: condição repetida` };
    }
    saida.push(c);
  }
  // Pedir uma coisa e o contrário dela no mesmo lugar é um contexto que
  // nunca vale: o critério ficaria ligado sem nunca ser conferido.
  for (const [a, b] of CONTRARIOS) {
    for (const c of saida.filter((o) => o.sinal === a)) {
      if (saida.some((o) => o.sinal === b && chaveDoLugar(o) === chaveDoLugar(c))) {
        return { problema: `contexto: "${a}" e "${b}" no mesmo lugar nunca valem juntos — o critério nunca seria conferido` };
      }
    }
  }
  return { ok: saida };
}

function lerGatilho(bruto: unknown): Lido<Condicao[]> {
  if (bruto == null) return { ok: [] };
  if (!Array.isArray(bruto)) return { problema: 'gatilho: uma lista de gatilhos' };
  if (bruto.length > MAX_POR_LISTA) return { problema: `gatilho: no máximo ${MAX_POR_LISTA} gatilhos` };
  const saida: Condicao[] = [];
  for (const [i, item] of bruto.entries()) {
    const onde = `gatilho[${i}]`;
    if (!ehObjeto(item)) return { problema: `${onde}: não é um gatilho` };
    if (typeof item.sinal !== 'string' || !(SINAIS_DE_GATILHO as readonly string[]).includes(item.sinal)) {
      return { problema: `${onde}.sinal: um de ${SINAIS_DE_GATILHO.join(', ')}` };
    }
    let g: Condicao;
    if (GATILHOS_SEM_LUGAR.includes(item.sinal)) {
      if (item.onde != null || item.zonaId != null) return { problema: `${onde}: "${item.sinal}" é do relógio, não tem lugar` };
      if (item.sinal === 'a_cada') {
        const m = item.minutos;
        if (typeof m !== 'number' || !Number.isInteger(m) || m < MINUTOS.minimo || m > MINUTOS.maximo) {
          return { problema: `${onde}.minutos: inteiro de ${MINUTOS.minimo} a ${MINUTOS.maximo}` };
        }
        g = { sinal: item.sinal, minutos: m };
      } else {
        if (item.minutos != null) return { problema: `${onde}.minutos: só no gatilho a_cada` };
        g = { sinal: item.sinal };
      }
    } else {
      if (item.minutos != null) return { problema: `${onde}.minutos: só no gatilho a_cada` };
      const lugar = lerLugar(item, onde);
      if ('problema' in lugar) return lugar;
      g = { sinal: item.sinal, ...lugar.ok };
    }
    // (Dois "a cada" também caem aqui: gatilho do relógio não tem lugar.)
    if (saida.some((o) => o.sinal === g.sinal && chaveDoLugar(o) === chaveDoLugar(g))) {
      return { problema: `${onde}: gatilho repetido` };
    }
    saida.push(g);
  }
  // "Toda olhada" já abre a análise sempre: ao lado de outro gatilho, um
  // dos dois está sobrando — e quem lê não sabe qual vale.
  if (saida.length > 1 && saida.some((g) => g.sinal === 'toda_olhada')) {
    return { problema: 'gatilho: "toda_olhada" já abre a análise em toda olhada — tire os outros, ou tire ele' };
  }
  return { ok: saida };
}

/**
 * Lê o estudo que chega do console. Devolve a forma guardada, ou o
 * problema — e nada é gravado pela metade.
 */
export function lerEstudo(bruto: unknown): Lido<EstudoLido> {
  if (!ehObjeto(bruto)) return { problema: 'esperado { partes, contexto, gatilho, confirmado }' };

  const partes: Record<string, string> = {};
  if (bruto.partes != null) {
    if (!ehObjeto(bruto.partes)) return { problema: 'partes: um texto por parte' };
    for (const [nome, texto] of Object.entries(bruto.partes)) {
      if (!(PARTES as readonly string[]).includes(nome)) {
        return { problema: `partes.${nome}: parte desconhecida. As partes são ${PARTES.join(', ')}` };
      }
      if (texto == null) continue;
      if (typeof texto !== 'string') return { problema: `partes.${nome}: texto` };
      const limpo = texto.trim();
      if (limpo.length > MAX_TEXTO_DA_PARTE) return { problema: `partes.${nome}: no máximo ${MAX_TEXTO_DA_PARTE} caracteres` };
      if (limpo) partes[nome] = limpo;
    }
  }

  const contexto = lerContexto(bruto.contexto);
  if ('problema' in contexto) return contexto;
  const gatilho = lerGatilho(bruto.gatilho);
  if ('problema' in gatilho) return gatilho;

  if (bruto.confirmado != null && typeof bruto.confirmado !== 'boolean') return { problema: 'confirmado: verdadeiro ou falso' };
  return { ok: { partes, contexto: contexto.ok, gatilho: gatilho.ok, confirmado: bruto.confirmado === true } };
}

/** O estudo cabe neste tipo de critério? Devolve o problema, ou `null`. */
export function estudoNaoCabeNoTipo(tipo: string, estudo: Pick<EstudoLido, 'contexto' | 'gatilho'>): string | null {
  if (TIPOS_QUE_USAM_ESTUDO.includes(tipo)) return null;
  if (estudo.contexto.length === 0 && estudo.gatilho.length === 0) return null;
  return 'presença e contagem são conferidas na loja em toda olhada: o estudo delas não leva contexto nem gatilho';
}

/** Os quadros que o estudo cita, sem repetir. */
export function quadrosCitados(estudo: Pick<EstudoLido, 'contexto' | 'gatilho'>): string[] {
  return [...new Set([...estudo.contexto, ...estudo.gatilho].filter((c) => c.onde === 'quadro').map((c) => String(c.zonaId)))];
}

/**
 * O que desce para o agente: só o contexto e o gatilho, e só de estudo
 * confirmado de critério que usa estudo. `null` = não desce nada, e o
 * agente segue com o "quando vale a pena conferir" de sempre.
 *
 * O quadro citado que não é do canal em que o critério está sendo
 * conferido desce como está: o agente não o acha entre os quadros daquele
 * canal e, na dúvida, pergunta.
 */
export function estudoParaOAgente(
  tipo: string,
  e: { contexto: unknown; gatilho: unknown; confirmado: boolean } | null | undefined,
): { contexto: Condicao[]; gatilho: Condicao[] } | null {
  if (!e || !e.confirmado || !TIPOS_QUE_USAM_ESTUDO.includes(tipo)) return null;
  return {
    contexto: Array.isArray(e.contexto) ? (e.contexto as Condicao[]) : [],
    gatilho: Array.isArray(e.gatilho) ? (e.gatilho as Condicao[]) : [],
  };
}

// ───────────────────────────── o funil ─────────────────────────────

/** O que o resumo por hora soma, na parte que o funil usa. */
export type SomaDoFunil = {
  capturas: number; semJuiz: number; semQuadro: number; semCena: number; semCondicao: number; semGatilho: number;
  observadas: number; emSilencio: number; repetidas: number; jaJulgadas: number; enfileiradas: number;
  conformes: number; naoConformes: number; naoAvaliaveis: number;
  julgadasLoja: number; julgadasNuvem: number; custoCentavos: number;
};

/** Quantos dias o funil mostra sem ninguém pedir — na gaveta do critério e na linha dele, na tela do canal. */
export const DIAS_DO_FUNIL = 7;

/** As colunas de `resumo_hora` (apelido `h`) que o funil soma. */
export const SQL_SOMAS_DO_FUNIL = `sum(h.capturas)::integer as capturas,
               sum(h.sem_juiz)::integer as sem_juiz,
               sum(h.sem_quadro)::integer as sem_quadro,
               sum(h.sem_cena)::integer as sem_cena,
               sum(h.sem_condicao)::integer as sem_condicao,
               sum(h.sem_gatilho)::integer as sem_gatilho,
               sum(h.observadas)::integer as observadas,
               sum(h.em_silencio)::integer as em_silencio,
               sum(h.repetidas)::integer as repetidas,
               sum(h.ja_julgadas)::integer as ja_julgadas,
               sum(h.enfileiradas)::integer as enfileiradas,
               sum(h.conformes)::integer as conformes,
               sum(h.nao_conformes)::integer as nao_conformes,
               sum(h.nao_avaliaveis)::integer as nao_avaliaveis,
               sum(h.julgadas_loja)::integer as julgadas_loja,
               sum(h.julgadas_nuvem)::integer as julgadas_nuvem,
               sum(h.custo_centavos)::float8 as custo_centavos`;

export const SOMA_ZERO: SomaDoFunil = {
  capturas: 0, semJuiz: 0, semQuadro: 0, semCena: 0, semCondicao: 0, semGatilho: 0, observadas: 0, emSilencio: 0,
  repetidas: 0, jaJulgadas: 0, enfileiradas: 0, conformes: 0, naoConformes: 0, naoAvaliaveis: 0,
  julgadasLoja: 0, julgadasNuvem: 0, custoCentavos: 0,
};

/** Soma uma linha de `SQL_SOMAS_DO_FUNIL` ao que já havia. */
export function somarAoFunil(a: SomaDoFunil, l: Record<string, unknown>): SomaDoFunil {
  return {
    capturas: a.capturas + Number(l.capturas),
    semJuiz: a.semJuiz + Number(l.sem_juiz),
    semQuadro: a.semQuadro + Number(l.sem_quadro),
    semCena: a.semCena + Number(l.sem_cena),
    semCondicao: a.semCondicao + Number(l.sem_condicao),
    semGatilho: a.semGatilho + Number(l.sem_gatilho),
    observadas: a.observadas + Number(l.observadas),
    emSilencio: a.emSilencio + Number(l.em_silencio),
    repetidas: a.repetidas + Number(l.repetidas),
    jaJulgadas: a.jaJulgadas + Number(l.ja_julgadas),
    enfileiradas: a.enfileiradas + Number(l.enfileiradas),
    conformes: a.conformes + Number(l.conformes),
    naoConformes: a.naoConformes + Number(l.nao_conformes),
    naoAvaliaveis: a.naoAvaliaveis + Number(l.nao_avaliaveis),
    julgadasLoja: a.julgadasLoja + Number(l.julgadas_loja),
    julgadasNuvem: a.julgadasNuvem + Number(l.julgadas_nuvem),
    custoCentavos: a.custoCentavos + Number(l.custo_centavos),
  };
}

export type Funil = {
  olhadas: number;
  /** Não chegaram a ser consideradas: critério sem quem julgue, câmera sem imagem, silêncio depois de um aviso. */
  semJuiz: number; semImagem: number; emSilencio: number;
  /** O contexto não valia: "nada a conferir". */
  semContexto: number;
  comContexto: number;
  /** O contexto valia e nada abriu a análise. */
  semGatilho: number;
  comGatilho: number;
  julgadas: number; naLoja: number; naNuvem: number;
  foraDoCriterio: number;
  custoCentavos: number;
};

/**
 * O funil de um critério: olhadas → com contexto → com gatilho → julgadas
 * → fora do critério. Cada olhada termina num desfecho só, então as
 * parcelas somam as olhadas:
 *
 *   olhadas = semJuiz + semImagem + emSilencio + semContexto + semGatilho + comGatilho
 *
 * "Com gatilho" é a olhada que passou pelas duas portas — a que foi (ou
 * iria) para julgamento: a observada, a enfileirada, a de cena repetida e
 * a que já tinha veredito. `ondeFoi` reparte o julgado entre a loja e a
 * nuvem (o agente antigo não dizia).
 */
export function montarFunil(s: SomaDoFunil, ondeFoi: { naLoja: number; naNuvem: number }): Funil {
  const comGatilho = s.observadas + s.repetidas + s.jaJulgadas + s.enfileiradas;
  return {
    olhadas: s.capturas,
    semJuiz: s.semJuiz,
    semImagem: s.semQuadro + s.semCena,
    emSilencio: s.emSilencio,
    semContexto: s.semCondicao,
    comContexto: s.semGatilho + comGatilho,
    semGatilho: s.semGatilho,
    comGatilho,
    julgadas: s.conformes + s.naoConformes + s.naoAvaliaveis,
    naLoja: ondeFoi.naLoja,
    naNuvem: ondeFoi.naNuvem,
    foraDoCriterio: s.naoConformes,
    custoCentavos: s.custoCentavos,
  };
}

/**
 * Quantas vezes por dia o gatilho acontece: a média dos dias em que houve
 * olhada. Hoje ainda não acabou, e por isso só entra na conta quando é o
 * único dia que há — aí a média é `parcial`, e quem mostra o número diz.
 */
export function mediaDeGatilhosPorDia(
  dias: readonly { dia: string; olhadas: number; comGatilho: number }[],
  hoje: string,
): { gatilhosPorDia: number; diasNaMedia: number; parcial: boolean } {
  const comOlhada = dias.filter((d) => d.olhadas > 0);
  const inteiros = comOlhada.filter((d) => d.dia !== hoje);
  const base = inteiros.length > 0 ? inteiros : comOlhada;
  if (base.length === 0) return { gatilhosPorDia: 0, diasNaMedia: 0, parcial: false };
  return {
    gatilhosPorDia: base.reduce((soma, d) => soma + d.comGatilho, 0) / base.length,
    diasNaMedia: base.length,
    parcial: inteiros.length === 0,
  };
}

export type SeLigado = {
  /** Quantas vezes por dia o gatilho acontece, nos dias em que houve olhada. */
  gatilhosPorDia: number;
  /** Quanto custa UMA análise na nuvem, medido. `null` = ainda sem medida. */
  precoDoPedidoCentavos: number | null;
  /** De onde vem o preço: deste critério, da loja inteira, ou de lugar nenhum. */
  deOndeVemOPreco: 'criterio' | 'loja' | null;
  /** O TETO por dia: se toda análise precisasse da nuvem. `null` = sem preço medido. */
  tetoPorDiaCentavos: number | null;
  /** Conferido só no computador da loja: nunca custa nuvem. */
  soNaLoja: boolean;
};

/**
 * "Quanto custaria ligado": gatilhos por dia × o preço MEDIDO de uma
 * análise na nuvem. É o teto — antes de ligar não se sabe quantas
 * análises a loja resolve sozinha.
 *
 * O preço nunca é inventado: vem do que este critério já pagou; sem isso,
 * do que a loja pagou por análise; sem isso, não há preço, e o teto é
 * "ainda sem medida".
 */
export function quantoCustariaLigado(e: {
  gatilhosPorDia: number;
  soNaLoja: boolean;
  doCriterio: { custoCentavos: number; naNuvem: number };
  daLoja: { custoCentavos: number; naNuvem: number };
}): SeLigado {
  const { gatilhosPorDia } = e;
  if (e.soNaLoja) {
    return { gatilhosPorDia, precoDoPedidoCentavos: 0, deOndeVemOPreco: null, tetoPorDiaCentavos: 0, soNaLoja: true };
  }
  let preco: number | null = null;
  let deOnde: SeLigado['deOndeVemOPreco'] = null;
  if (e.doCriterio.naNuvem > 0) {
    preco = e.doCriterio.custoCentavos / e.doCriterio.naNuvem;
    deOnde = 'criterio';
  } else if (e.daLoja.naNuvem > 0) {
    preco = e.daLoja.custoCentavos / e.daLoja.naNuvem;
    deOnde = 'loja';
  }
  return {
    gatilhosPorDia,
    precoDoPedidoCentavos: preco,
    deOndeVemOPreco: deOnde,
    tetoPorDiaCentavos: preco === null ? null : gatilhosPorDia * preco,
    soNaLoja: false,
  };
}
