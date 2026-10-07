// =====================================================================
// O que o Farol viu — a conta, sem banco
// =====================================================================
// A rota `GET /v1/lojas/:id/resultados` busca; este arquivo decide. Tudo
// aqui é função pura, para os limiares poderem ser testados com números
// escolhidos à mão.
//
// ## Os sinais
//
// A tela existe para separar duas coisas que tinham a mesma cara: loja em
// ordem e sistema parado. Os números respondem "como está a operação"; os
// sinais respondem "o sistema está conseguindo olhar?". Cada sinal aponta
// um defeito DO FAROL, não da cozinha:
//
//   sem_agente / agente_fora    ninguém está olhando a loja
//   canal_sem_imagem            a câmera parou de entregar cena
//   sem_juiz                    o critério está ligado e ninguém o julga
//   julgamento_falhando         o juiz existe e não responde
//   avalia_pouco                a câmera não mostra o bastante para decidir
//   falta_dizer_o_que_procurar  presença/contagem sem objeto escolhido
//   nunca_olhado                ligado, com canal, e nenhuma olhada
//
// "Não conforme" NÃO é sinal: é resultado, e aparece nos números.
// =====================================================================

/** Agente sem bater há mais que isto é agente fora. O mesmo do console. */
export const LIMITE_DO_AGENTE_SEG = 5 * 60;

/** Quanto do que foi olhado precisa vir sem imagem para o canal ser dado como parado. */
export const FRACAO_SEM_IMAGEM = 0.8;
/** Menos olhadas que isto não decidem nada: a hora acabou de começar. */
export const MINIMO_DE_OLHADAS = 4;
/** A janela que diz "agora": a hora corrente e a anterior. */
export const JANELA_RECENTE_H = 2;

export const FRACAO_AVALIA_POUCO = 0.5;
export const MINIMO_DE_JULGADAS = 10;
export const FRACAO_SEM_JUIZ = 0.8;
export const MINIMO_DE_FALHAS = 5;

export type AgenteVisto = { estado: string; segundos_sem_bater: number | null };

/** O acumulado do período para um critério num canal. */
export type Linha = {
  regraId: string;
  regraNome: string;
  tipo: string;
  regraLigada: boolean;
  regraExcluida: boolean;
  pontoId: string;
  pontoNome: string;
  canal: number | null;
  setor: string;
  pontoAtivo: boolean;
  pontoExcluido: boolean;
  /** A área (ou as áreas) do canal em que o critério foi olhado — só
   *  quando o canal tem mais de uma. Com uma só, dizer o nome dela seria
   *  repetir o canal. */
  areaNome?: string | null;
  capturas: number;
  semJuiz: number;
  semQuadro: number;
  semCena: number;
  emSilencio: number;
  repetidas: number;
  jaJulgadas: number;
  enfileiradas: number;
  conformes: number;
  naoConformes: number;
  naoAvaliaveis: number;
  falhas: number;
  alertas: number;
  somaConfianca: number;
  comConfianca: number;
  somaLatenciaMs: number;
  comLatencia: number;
  ultimaEm: string | null;
  ultimoImpedimento: string | null;
};

/** Uma hora de um canal, somando todos os critérios dele. A mais nova primeiro. */
export type HoraDoCanal = { pontoId: string; hora: string; capturas: number; semImagem: number };

export type CriterioDaLoja = {
  id: string;
  nome: string;
  tipo: string;
  ligado: boolean;
  /** Em quantos canais ATIVOS ele vale. */
  canais: number;
  /** Presença e contagem precisam dizer o que procurar. */
  temObjeto: boolean;
  /** Sem janela de horário: vale o dia inteiro. */
  valeSempre: boolean;
};

export type CanalDaLoja = { id: string; nome: string; canal: number | null; criteriosLigados: number };

export type Sinal = {
  tipo:
    | 'sem_agente'
    | 'agente_fora'
    | 'canal_sem_imagem'
    | 'sem_juiz'
    | 'julgamento_falhando'
    | 'avalia_pouco'
    | 'falta_dizer_o_que_procurar'
    | 'nunca_olhado';
  gravidade: 'critico' | 'atencao';
  regraId?: string;
  regraNome?: string;
  pontoId?: string;
  pontoNome?: string;
  canal?: number | null;
  /** Em quantos canais (ou critérios) o sinal pega. */
  quantos?: number;
  /** De 0 a 100. */
  percentual?: number;
  segundosSemBater?: number | null;
  /** O início da hora em que o defeito começou, até onde o resumo alcança. */
  desde?: string | null;
  /** O que o agente disse sobre a causa. */
  impedimento?: string | null;
};

export type MarcaDaLinha = 'sem_imagem' | 'sem_juiz' | 'falhando' | 'avalia_pouco' | null;

const julgadas = (l: { conformes: number; naoConformes: number; naoAvaliaveis: number }) =>
  l.conformes + l.naoConformes + l.naoAvaliaveis;

/** Algum agente está de pé? */
export function agenteDePe(agentes: AgenteVisto[]): boolean {
  return agentes.some(
    (a) =>
      a.estado === 'ativo' &&
      a.segundos_sem_bater !== null &&
      a.segundos_sem_bater <= LIMITE_DO_AGENTE_SEG,
  );
}

/**
 * Os canais que estão sem imagem AGORA, e desde quando.
 *
 * "Agora" é a janela recente — a hora corrente mais a anterior. Só a hora
 * corrente não serve: às 14h01 ela tem duas olhadas, e duas olhadas não
 * decidem nada.
 */
export function canaisSemImagem(
  horas: HoraDoCanal[],
  agora: Date,
): Map<string, { desde: string | null }> {
  const porCanal = new Map<string, HoraDoCanal[]>();
  for (const h of horas) {
    const lista = porCanal.get(h.pontoId) ?? [];
    lista.push(h);
    porCanal.set(h.pontoId, lista);
  }

  const limite = agora.getTime() - JANELA_RECENTE_H * 3_600_000;
  const parados = new Map<string, { desde: string | null }>();

  for (const [pontoId, lista] of porCanal) {
    lista.sort((a, b) => Date.parse(b.hora) - Date.parse(a.hora));
    const recentes = lista.filter((h) => Date.parse(h.hora) >= limite);
    const olhadas = recentes.reduce((s, h) => s + h.capturas, 0);
    const semImagem = recentes.reduce((s, h) => s + h.semImagem, 0);
    if (olhadas < MINIMO_DE_OLHADAS || semImagem / olhadas < FRACAO_SEM_IMAGEM) continue;

    // Para trás, hora a hora, enquanto continuar parado.
    let desde: string | null = null;
    for (const h of lista) {
      if (h.capturas === 0) continue;
      if (h.semImagem / h.capturas < FRACAO_SEM_IMAGEM) break;
      desde = h.hora;
    }
    parados.set(pontoId, { desde });
  }
  return parados;
}

/** O que marcar na linha da tabela. O mais grave ganha. */
export function marcaDaLinha(l: Linha, semImagem: boolean): MarcaDaLinha {
  if (l.regraExcluida || l.pontoExcluido) return null;
  if (semImagem) return 'sem_imagem';
  if (l.capturas > 0 && l.semJuiz / l.capturas >= FRACAO_SEM_JUIZ) return 'sem_juiz';
  if (l.falhas >= MINIMO_DE_FALHAS && l.falhas > julgadas(l)) return 'falhando';
  const j = julgadas(l);
  if (j >= MINIMO_DE_JULGADAS && l.naoAvaliaveis / j >= FRACAO_AVALIA_POUCO) return 'avalia_pouco';
  return null;
}

export function montarSinais(entrada: {
  agentes: AgenteVisto[];
  linhas: Linha[];
  horas: HoraDoCanal[];
  criterios: CriterioDaLoja[];
  canais: CanalDaLoja[];
  agora: Date;
}): Sinal[] {
  const { agentes, linhas, criterios, canais, agora } = entrada;
  const sinais: Sinal[] = [];

  // ── ninguém olhando ──
  const dePe = agenteDePe(agentes);
  if (agentes.length === 0) {
    sinais.push({ tipo: 'sem_agente', gravidade: 'critico' });
  } else if (!dePe) {
    const menor = agentes
      .map((a) => a.segundos_sem_bater)
      .filter((s): s is number => s !== null)
      .sort((a, b) => a - b)[0];
    sinais.push({ tipo: 'agente_fora', gravidade: 'critico', segundosSemBater: menor ?? null });
  }

  // ── câmera sem cena ──
  // Com o agente fora, "sem imagem" é consequência e não causa: dizer as
  // duas coisas manda a pessoa olhar a câmera quando o problema é o PC.
  const parados = dePe ? canaisSemImagem(entrada.horas, agora) : new Map<string, { desde: string | null }>();
  for (const c of canais) {
    const p = parados.get(c.id);
    if (!p) continue;
    const doCanal = linhas.filter((l) => l.pontoId === c.id && l.ultimoImpedimento);
    sinais.push({
      tipo: 'canal_sem_imagem',
      gravidade: 'critico',
      pontoId: c.id,
      pontoNome: c.nome,
      canal: c.canal,
      quantos: c.criteriosLigados,
      desde: p.desde,
      impedimento: doCanal[0]?.ultimoImpedimento ?? null,
    });
  }

  // ── por critério: uma causa, um sinal ──
  // O mesmo critério sem juiz em três canais é UM problema. Três linhas
  // iguais na tela ensinam a pessoa a parar de ler.
  const vivas = linhas.filter((l) => !l.regraExcluida && !l.pontoExcluido && l.pontoAtivo);
  const porCriterio = new Map<string, Linha[]>();
  for (const l of vivas) {
    const lista = porCriterio.get(l.regraId) ?? [];
    lista.push(l);
    porCriterio.set(l.regraId, lista);
  }

  // Presença ou contagem sem objeto escolhido. O agente conta essas
  // olhadas como "sem juiz" — e está certo, ninguém julga aquilo —, mas a
  // causa tem nome próprio e providência própria. O diagnóstico específico
  // ganha do genérico: dois sinais para o mesmo defeito mandam a pessoa
  // procurar dois problemas.
  const semObjeto = new Set(
    criterios
      .filter((c) => c.canais > 0 && (c.tipo === 'presenca' || c.tipo === 'contagem') && !c.temObjeto)
      .map((c) => c.id),
  );

  for (const [regraId, lista] of porCriterio) {
    if (semObjeto.has(regraId)) continue;
    const nome = lista[0]!.regraNome;
    const semJuiz = lista.filter((l) => l.capturas > 0 && l.semJuiz / l.capturas >= FRACAO_SEM_JUIZ);
    if (semJuiz.length > 0) {
      sinais.push({
        tipo: 'sem_juiz',
        gravidade: 'atencao',
        regraId,
        regraNome: nome,
        quantos: semJuiz.length,
        impedimento: semJuiz.find((l) => l.ultimoImpedimento)?.ultimoImpedimento ?? null,
      });
      continue;
    }

    const falhas = lista.reduce((s, l) => s + l.falhas, 0);
    const jul = lista.reduce((s, l) => s + julgadas(l), 0);
    if (falhas >= MINIMO_DE_FALHAS && falhas > jul) {
      sinais.push({
        tipo: 'julgamento_falhando',
        gravidade: 'atencao',
        regraId,
        regraNome: nome,
        quantos: falhas,
        impedimento: lista.find((l) => l.ultimoImpedimento)?.ultimoImpedimento ?? null,
      });
      continue;
    }

    // Avaliar pouco é por CANAL: a mesma pergunta pode ser respondível de
    // uma câmera e não de outra, e a providência é naquela câmera.
    for (const l of lista) {
      if (parados.has(l.pontoId)) continue;
      const j = julgadas(l);
      if (j >= MINIMO_DE_JULGADAS && l.naoAvaliaveis / j >= FRACAO_AVALIA_POUCO) {
        sinais.push({
          tipo: 'avalia_pouco',
          gravidade: 'atencao',
          regraId,
          regraNome: nome,
          pontoId: l.pontoId,
          pontoNome: l.pontoNome,
          canal: l.canal,
          percentual: Math.round((l.naoAvaliaveis / j) * 100),
        });
      }
    }
  }

  // ── critérios que não deixaram rastro nenhum ──
  const comRastro = new Set(vivas.filter((l) => l.capturas > 0).map((l) => l.regraId));
  for (const c of criterios) {
    if (c.canais === 0) continue;
    if (semObjeto.has(c.id)) {
      // Vale ligado ou desligado: do jeito que está, ele não tem como ser
      // julgado, e ligar não muda isso.
      sinais.push({ tipo: 'falta_dizer_o_que_procurar', gravidade: 'atencao', regraId: c.id, regraNome: c.nome });
      continue;
    }
    // Só com o agente de pé e sem janela de horário: critério de fim de
    // semana numa quarta-feira não foi olhado, e está certo não ter sido.
    if (c.ligado && c.valeSempre && dePe && !comRastro.has(c.id)) {
      sinais.push({ tipo: 'nunca_olhado', gravidade: 'atencao', regraId: c.id, regraNome: c.nome, quantos: c.canais });
    }
  }

  const peso = { critico: 0, atencao: 1 } as const;
  return sinais.sort((a, b) => peso[a.gravidade] - peso[b.gravidade]);
}

export type LinhaDaTela = {
  regraId: string;
  regraNome: string;
  tipo: string;
  pontoId: string;
  pontoNome: string;
  canal: number | null;
  setor: string;
  /** Em que área do canal — nulo quando o canal tem uma área só. */
  areaNome: string | null;
  /** O critério ou o canal foi excluído depois: a linha é só histórico. */
  historico: boolean;
  capturas: number;
  analises: number;
  conformes: number;
  naoConformes: number;
  naoAvaliaveis: number;
  semImagem: number;
  semJuiz: number;
  falhas: number;
  alertas: number;
  confiancaMedia: number | null;
  latenciaMediaMs: number | null;
  ultimaEm: string | null;
  marca: MarcaDaLinha;
};

export function montarLinhas(linhas: Linha[], parados: ReadonlySet<string>): LinhaDaTela[] {
  return linhas
    .map((l) => ({
      regraId: l.regraId,
      regraNome: l.regraNome,
      tipo: l.tipo,
      pontoId: l.pontoId,
      pontoNome: l.pontoNome,
      canal: l.canal,
      setor: l.setor,
      areaNome: l.areaNome ?? null,
      historico: l.regraExcluida || l.pontoExcluido,
      capturas: l.capturas,
      analises: julgadas(l),
      conformes: l.conformes,
      naoConformes: l.naoConformes,
      naoAvaliaveis: l.naoAvaliaveis,
      semImagem: l.semQuadro + l.semCena,
      semJuiz: l.semJuiz,
      falhas: l.falhas,
      alertas: l.alertas,
      confiancaMedia: l.comConfianca > 0 ? Number((l.somaConfianca / l.comConfianca).toFixed(3)) : null,
      latenciaMediaMs: l.comLatencia > 0 ? Math.round(l.somaLatenciaMs / l.comLatencia) : null,
      ultimaEm: l.ultimaEm,
      marca: marcaDaLinha(l, parados.has(l.pontoId)),
    }))
    // Do que mais ficou fora do critério para o que menos ficou.
    .sort(
      (a, b) =>
        b.naoConformes - a.naoConformes ||
        b.naoAvaliaveis - a.naoAvaliaveis ||
        a.regraNome.localeCompare(b.regraNome, 'pt-BR') ||
        a.pontoNome.localeCompare(b.pontoNome, 'pt-BR'),
    );
}

export type Totais = {
  capturas: number;
  analises: number;
  conformes: number;
  naoConformes: number;
  naoAvaliaveis: number;
  falhas: number;
  alertas: number;
};

export function somarTotais(linhas: Linha[]): Totais {
  const t: Totais = { capturas: 0, analises: 0, conformes: 0, naoConformes: 0, naoAvaliaveis: 0, falhas: 0, alertas: 0 };
  for (const l of linhas) {
    t.capturas += l.capturas;
    t.conformes += l.conformes;
    t.naoConformes += l.naoConformes;
    t.naoAvaliaveis += l.naoAvaliaveis;
    t.falhas += l.falhas;
    t.alertas += l.alertas;
  }
  t.analises = t.conformes + t.naoConformes + t.naoAvaliaveis;
  return t;
}
