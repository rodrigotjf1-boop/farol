// =====================================================================
// Orçamento por uso
// =====================================================================
// Pedido do dono (07/10/2026): classificar cada canal pela importância e
// pela quantidade de usos de análise — "umas com poucos usos, outras com
// usos frequentes" — e montar o orçamento de acordo com o uso lógico de
// cada um, com o equipamento classificado em básico, intermediário e
// avançado.
//
// Este arquivo é só a conta. Não lê banco e não conhece rota: recebe os
// canais da loja com os critérios de cada um, o requisito de cada uso e o
// catálogo, e devolve — por canal — o quanto ele é usado, o que ele precisa
// enxergar e as opções que servem; e, para a loja, três pacotes.
//
// ## O que sai daqui vai para o usuário. O catálogo, não.
//
// O catálogo de equipamentos é da distribuição. Ao usuário chegam
// **soluções e opções**: marca, modelo, nível, a razão do nível e a faixa de
// preço. Equipamento descartado, observação interna, fonte e medição de
// campo não saem — e é esta função que garante isso, escolhendo campo a
// campo o que devolve.
//
// ## Duas leituras de cada canal
//
//   - **quanto é usado** → a carga. Dimensiona computador e rede.
//   - **o que precisa enxergar** → o uso mais exigente entre os critérios
//     dele. Dimensiona a câmera.
//
// São perguntas diferentes. Um canal com dez critérios de presença é muito
// usado e serve com qualquer câmera; um canal com um único critério de
// leitura é pouco usado e precisa da melhor.
// =====================================================================

export type Nivel = 'basico' | 'intermediario' | 'avancado';
export const NIVEIS: readonly Nivel[] = ['basico', 'intermediario', 'avancado'];

export type Importancia = 'critico' | 'normal' | 'baixo';
export const IMPORTANCIAS: readonly Importancia[] = ['critico', 'normal', 'baixo'];

export type Carga = 'sem_uso' | 'leve' | 'moderada' | 'intensa';

/** O agente olha cada canal a cada 30 s: 120 capturas por hora. */
export const CAPTURAS_POR_HORA = 120;

// Onde a carga muda de nome. Em quadros julgados por hora, por canal:
//   até 120  = um critério simples                      → leve
//   até 480  = dois a quatro critérios simples          → moderada
//   acima    = cinco ou mais, ou um critério de ação    → intensa
// (um critério de ação julga 8 quadros por análise: sozinho já são 960.)
export const TETO_LEVE = 120;
export const TETO_MODERADA = 480;

// Até quantos canais em uso cada porte de computador e de gravador atende.
const CANAIS_DO_BASICO = 8;
const CANAIS_DO_INTERMEDIARIO = 16;

// Usos que só um modelo de visão julga. Se a imagem não pode sair da loja,
// esse modelo tem que rodar lá dentro — e isso é placa de vídeo.
const PEDEM_MODELO_DE_VISAO = new Set(['estado', 'acao']);

export type RequisitoDeUso = {
  id: string;
  descricao: string;
  pxPorCmMin: number | null;
  fpsMin: number | null;
  exigeCor: boolean;
  exigeWdrDb: number | null;
  exigeLocal: boolean;
  quadrosPorAnalise: number;
};

export type Preco = {
  preco?: number;
  preco_min?: number;
  preco_max?: number;
  confianca: string;
  cotado_em: string;
};

export type EquipamentoDoCatalogo = {
  categoria: string;
  fabricante: string;
  modelo: string;
  nivel: Nivel | null;
  nivelMotivo: string | null;
  status: string;
  servePara: string[];
  precos: Preco[];
};

export type CanalDeEntrada = {
  id: string;
  nome: string;
  canal: number | null;
  setor: string;
  ativo: boolean;
  importancia: Importancia;
  /** O que a câmera instalada entrega, quando a óptica foi informada. */
  pxPorCm: number | null;
  criterios: Array<{ tipo: string; ativa: boolean }>;
};

export type FaixaDePreco = { min: number; max: number; confianca: string; cotadoEm: string };

export type Opcao = {
  nivel: Nivel;
  fabricante: string;
  modelo: string;
  /** Por que este equipamento é deste nível — a frase do catálogo. */
  porque: string;
  recomendado: boolean;
  preco: FaixaDePreco | null;
};

export type SituacaoDaCamera = 'sem_uso' | 'nao_medido' | 'atende' | 'nao_atende';

export type CanalNoOrcamento = {
  id: string;
  nome: string;
  canal: number | null;
  setor: string;
  ativo: boolean;
  importancia: Importancia;
  uso: {
    criterios: number;
    ligados: number;
    tipos: string[];
    quadrosPorHora: number;
    carga: Carga;
    motivo: string;
  };
  exige: {
    usoMaisExigente: string | null;
    descricao: string | null;
    pxPorCmMin: number | null;
    cor: boolean;
    wdrDb: number | null;
    julgamentoNaLoja: boolean;
  };
  camera: { pxPorCm: number | null; situacao: SituacaoDaCamera; mensagem: string };
  /** Até três câmeras que servem a TODOS os usos do canal: uma por nível. */
  opcoes: Opcao[];
};

export type ItemDoPacote = {
  papel: 'camera' | 'gravador' | 'computador' | 'placa_de_video';
  para: string;
  quantidade: number;
  opcao: Opcao | null;
  observacao: string | null;
};

export type Pacote = {
  nivel: Nivel;
  itens: ItemDoPacote[];
  total: {
    cameras: { min: number; max: number };
    infraestrutura: { min: number; max: number };
    geral: { min: number; max: number };
  };
  /** Itens que entram no pacote e não têm preço no catálogo. */
  semPreco: number;
};

export type Orcamento = {
  resumo: {
    canais: number;
    emUso: number;
    porCarga: Record<Carga, number>;
    quadrosPorHora: number;
    cameraNaoAtende: number;
    cameraNaoMedida: number;
  };
  setores: Array<{ nome: string; canais: number; porCarga: Record<Carga, number> }>;
  canais: CanalNoOrcamento[];
  computador: { nivelExigido: Nivel; motivo: string; opcoes: Opcao[] };
  gravador: { canaisEmUso: number; nivelExigido: Nivel; motivo: string; opcoes: Opcao[] };
  pacotes: Pacote[];
  avisos: string[];
};

// ───────────────────────────── preço ─────────────────────────────

const PESO_DA_CONFIANCA: Record<string, number> = { confirmado: 3, indice: 2, estimado: 1 };

/** O melhor preço que o catálogo tem: o mais confiável, e entre iguais o mais recente. */
export function faixaDePreco(precos: Preco[]): FaixaDePreco | null {
  const validos = precos
    .map((p) => {
      const min = typeof p.preco === 'number' ? p.preco : p.preco_min;
      const max = typeof p.preco === 'number' ? p.preco : p.preco_max;
      return typeof min === 'number' && typeof max === 'number' && min > 0 && max >= min
        ? { min, max, confianca: p.confianca, cotadoEm: p.cotado_em }
        : null;
    })
    .filter((p): p is FaixaDePreco => p !== null);
  if (validos.length === 0) return null;
  validos.sort(
    (a, b) =>
      (PESO_DA_CONFIANCA[b.confianca] ?? 0) - (PESO_DA_CONFIANCA[a.confianca] ?? 0) ||
      b.cotadoEm.localeCompare(a.cotadoEm),
  );
  return validos[0]!;
}

// ───────────────────────────── o canal ─────────────────────────────

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** Quanto o canal é usado. Conta o uso PREVISTO — critério cadastrado e
 *  desligado entra, porque foi para usá-lo que a loja o cadastrou. */
export function classificarUso(
  criterios: CanalDeEntrada['criterios'],
  requisitos: Map<string, RequisitoDeUso>,
): CanalNoOrcamento['uso'] {
  const tipos = [...new Set(criterios.map((c) => c.tipo))].sort();
  const quadrosPorHora = criterios.reduce(
    (soma, c) => soma + CAPTURAS_POR_HORA * (requisitos.get(c.tipo)?.quadrosPorAnalise ?? 1),
    0,
  );
  const ligados = criterios.filter((c) => c.ativa).length;

  let carga: Carga;
  if (criterios.length === 0) carga = 'sem_uso';
  else if (quadrosPorHora <= TETO_LEVE) carga = 'leve';
  else if (quadrosPorHora <= TETO_MODERADA) carga = 'moderada';
  else carga = 'intensa';

  const motivo =
    criterios.length === 0
      ? 'nenhum critério vale neste canal'
      : `${plural(criterios.length, 'critério', 'critérios')} · ${quadrosPorHora} quadros julgados por hora` +
        (ligados < criterios.length
          ? ` · ${plural(criterios.length - ligados, 'desligado', 'desligados')}`
          : '');

  return { criterios: criterios.length, ligados, tipos, quadrosPorHora, carga, motivo };
}

/** O que o canal precisa enxergar: o mais exigente entre os usos dele. */
export function exigenciaDoCanal(
  tipos: string[],
  requisitos: Map<string, RequisitoDeUso>,
): CanalNoOrcamento['exige'] {
  const dos = tipos.map((t) => requisitos.get(t)).filter((r): r is RequisitoDeUso => !!r);
  if (dos.length === 0) {
    return {
      usoMaisExigente: null, descricao: null, pxPorCmMin: null,
      cor: false, wdrDb: null, julgamentoNaLoja: false,
    };
  }
  const maisExigente = [...dos].sort((a, b) => (b.pxPorCmMin ?? 0) - (a.pxPorCmMin ?? 0))[0]!;
  const wdr = Math.max(...dos.map((r) => r.exigeWdrDb ?? 0));
  return {
    usoMaisExigente: maisExigente.id,
    descricao: maisExigente.descricao,
    pxPorCmMin: maisExigente.pxPorCmMin,
    cor: dos.some((r) => r.exigeCor),
    wdrDb: wdr > 0 ? wdr : null,
    julgamentoNaLoja: dos.some((r) => r.exigeLocal),
  };
}

function situacaoDaCamera(
  pxPorCm: number | null,
  exige: CanalNoOrcamento['exige'],
  temUso: boolean,
): CanalNoOrcamento['camera'] {
  if (!temUso) {
    return { pxPorCm, situacao: 'sem_uso', mensagem: 'sem critério, não há o que conferir' };
  }
  if (pxPorCm === null) {
    return {
      pxPorCm,
      situacao: 'nao_medido',
      mensagem:
        'a óptica deste canal não foi informada: não dá para dizer se a câmera atual serve. ' +
        'Pode ser que já sirva.',
    };
  }
  const minimo = exige.pxPorCmMin ?? 0;
  const tem = Number(pxPorCm.toFixed(1));
  if (pxPorCm >= minimo) {
    return { pxPorCm: tem, situacao: 'atende', mensagem: `a câmera atual entrega ${tem} px por cm; o uso pede ${minimo}` };
  }
  return {
    pxPorCm: tem,
    situacao: 'nao_atende',
    mensagem: `a câmera atual entrega ${tem} px por cm; o uso pede ${minimo}. Aproximar a câmera, fechar a lente ou trocar`,
  };
}

// ───────────────────────────── as opções ─────────────────────────────

function comoOpcao(e: EquipamentoDoCatalogo): Opcao {
  return {
    nivel: e.nivel!,
    fabricante: e.fabricante,
    modelo: e.modelo,
    porque: e.nivelMotivo ?? '',
    recomendado: e.status === 'recomendado',
    preco: faixaDePreco(e.precos),
  };
}

/** O melhor de cada nível: recomendado antes de aceitável, depois o mais barato. */
function melhorPorNivel(candidatos: EquipamentoDoCatalogo[]): Opcao[] {
  const opcoes: Opcao[] = [];
  for (const nivel of NIVEIS) {
    const doNivel = candidatos.filter((e) => e.nivel === nivel).map(comoOpcao);
    doNivel.sort(
      (a, b) =>
        Number(b.recomendado) - Number(a.recomendado) ||
        (a.preco?.min ?? Number.POSITIVE_INFINITY) - (b.preco?.min ?? Number.POSITIVE_INFINITY) ||
        `${a.fabricante} ${a.modelo}`.localeCompare(`${b.fabricante} ${b.modelo}`),
    );
    if (doNivel[0]) opcoes.push(doNivel[0]);
  }
  return opcoes;
}

const naProposta = (e: EquipamentoDoCatalogo) => e.status !== 'descartado' && e.nivel !== null;

/** Câmeras que servem a TODOS os usos do canal — uma por nível. */
export function opcoesDeCamera(tipos: string[], catalogo: EquipamentoDoCatalogo[]): Opcao[] {
  if (tipos.length === 0) return [];
  return melhorPorNivel(
    catalogo.filter(
      (e) =>
        e.categoria.startsWith('camera_') &&
        naProposta(e) &&
        tipos.every((t) => e.servePara.includes(t)),
    ),
  );
}

const ORDEM: Record<Nivel, number> = { basico: 0, intermediario: 1, avancado: 2 };

/** A opção do pacote: a do nível pedido; sem ela, a mais próxima — primeiro para cima. */
function escolher(opcoes: Opcao[], pedido: Nivel, minimo: Nivel = 'basico'): Opcao | null {
  const alvo = Math.max(ORDEM[pedido], ORDEM[minimo]);
  const servem = opcoes.filter((o) => ORDEM[o.nivel] >= ORDEM[minimo]);
  const acima = servem.filter((o) => ORDEM[o.nivel] >= alvo).sort((a, b) => ORDEM[a.nivel] - ORDEM[b.nivel]);
  if (acima[0]) return acima[0];
  const abaixo = servem.sort((a, b) => ORDEM[b.nivel] - ORDEM[a.nivel]);
  return abaixo[0] ?? null;
}

// ───────────────────────────── a loja ─────────────────────────────

export type Entrada = {
  /** `nuvem`, `local` ou `hibrido`: se a imagem pode sair da loja. */
  modoJulgamento: string;
  canais: CanalDeEntrada[];
  requisitos: RequisitoDeUso[];
  catalogo: EquipamentoDoCatalogo[];
};

const zeroPorCarga = (): Record<Carga, number> => ({ sem_uso: 0, leve: 0, moderada: 0, intensa: 0 });

export function montarOrcamento(entrada: Entrada): Orcamento {
  const requisitos = new Map(entrada.requisitos.map((r) => [r.id, r]));
  const avisos: string[] = [];

  // ─── cada canal ───
  const canais: CanalNoOrcamento[] = entrada.canais.map((c) => {
    const uso = classificarUso(c.criterios, requisitos);
    const exige = exigenciaDoCanal(uso.tipos, requisitos);
    return {
      id: c.id, nome: c.nome, canal: c.canal, setor: c.setor, ativo: c.ativo,
      importancia: c.importancia,
      uso,
      exige,
      camera: situacaoDaCamera(c.pxPorCm, exige, uso.criterios > 0),
      opcoes: opcoesDeCamera(uso.tipos, entrada.catalogo),
    };
  });

  // Crítico primeiro, depois o mais usado: é a ordem em que o dinheiro
  // resolve as coisas quando não dá para tudo.
  const peso: Record<Importancia, number> = { critico: 0, normal: 1, baixo: 2 };
  canais.sort(
    (a, b) =>
      peso[a.importancia] - peso[b.importancia] ||
      b.uso.quadrosPorHora - a.uso.quadrosPorHora ||
      (a.canal ?? 999) - (b.canal ?? 999) ||
      a.nome.localeCompare(b.nome),
  );

  const emUso = canais.filter((c) => c.ativo && c.uso.criterios > 0);
  const porCarga = zeroPorCarga();
  for (const c of canais) porCarga[c.uso.carga] += 1;

  const setores = [...new Set(canais.map((c) => c.setor))].sort().map((nome) => {
    const doSetor = canais.filter((c) => c.setor === nome);
    const cargas = zeroPorCarga();
    for (const c of doSetor) cargas[c.uso.carga] += 1;
    return { nome, canais: doSetor.length, porCarga: cargas };
  });

  // ─── computador ───
  const imagemNaoSai = entrada.modoJulgamento === 'local';
  const usosDaLoja = new Set(emUso.flatMap((c) => c.uso.tipos));
  const precisaDeModeloNaLoja =
    emUso.some((c) => c.exige.julgamentoNaLoja && c.uso.tipos.some((t) => PEDEM_MODELO_DE_VISAO.has(t))) ||
    (imagemNaoSai && [...usosDaLoja].some((t) => PEDEM_MODELO_DE_VISAO.has(t)));

  let nivelDoComputador: Nivel;
  let motivoDoComputador: string;
  if (precisaDeModeloNaLoja) {
    nivelDoComputador = 'avancado';
    motivoDoComputador =
      'há critério que só um modelo de visão julga, e ele tem que rodar dentro da loja — ' +
      'isso pede placa de vídeo de 16 GB ou mais';
  } else if (emUso.length > CANAIS_DO_BASICO || emUso.some((c) => c.uso.carga === 'intensa')) {
    nivelDoComputador = 'intermediario';
    motivoDoComputador =
      emUso.length > CANAIS_DO_BASICO
        ? `${emUso.length} canais em uso: passa do que um computador básico acompanha (${CANAIS_DO_BASICO})`
        : 'há canal de carga intensa';
  } else {
    nivelDoComputador = 'basico';
    motivoDoComputador =
      emUso.length === 0
        ? 'nenhum canal em uso ainda'
        : `${plural(emUso.length, 'canal em uso', 'canais em uso')}, sem carga intensa: o detector local dá conta`;
  }
  const computadores = melhorPorNivel(
    entrada.catalogo.filter((e) => e.categoria === 'computador' && naProposta(e)),
  );
  const placas = melhorPorNivel(entrada.catalogo.filter((e) => e.categoria === 'gpu' && naProposta(e)));

  // ─── gravador ───
  const nivelDoGravador: Nivel = emUso.length > CANAIS_DO_BASICO ? 'intermediario' : 'basico';
  const motivoDoGravador =
    emUso.length > CANAIS_DO_INTERMEDIARIO
      ? `${emUso.length} canais em uso: passa de um gravador de 16 canais — são dois`
      : emUso.length > CANAIS_DO_BASICO
        ? `${emUso.length} canais em uso: pede gravador de 16 canais`
        : `${plural(emUso.length, 'canal em uso', 'canais em uso')}: um gravador de 8 canais comporta`;
  const gravadores = melhorPorNivel(
    entrada.catalogo.filter((e) => e.categoria.startsWith('gravador_') && naProposta(e)),
  );
  const quantosGravadores = Math.max(1, Math.ceil(emUso.length / CANAIS_DO_INTERMEDIARIO));

  // ─── os três pacotes ───
  // Câmera só entra para canal em uso cuja câmera atual NÃO se sabe que
  // atende. O que já atende não se compra de novo.
  const precisamDeCamera = emUso.filter((c) => c.camera.situacao !== 'atende');

  const pacotes: Pacote[] = NIVEIS.map((nivel) => {
    const itens: ItemDoPacote[] = [];

    for (const c of precisamDeCamera) {
      const opcao = escolher(c.opcoes, nivel);
      itens.push({
        papel: 'camera',
        para: (c.canal ? `Canal ${c.canal} · ` : '') + c.nome,
        quantidade: 1,
        opcao,
        observacao:
          opcao === null
            ? 'nenhuma câmera do catálogo serve a todos os usos deste canal'
            : opcao.nivel !== nivel
              ? `não há opção ${rotuloDoNivel(nivel)} que sirva a este uso`
              : c.camera.situacao === 'nao_medido'
                ? 'a câmera atual não foi medida: pode já servir'
                : null,
      });
    }

    if (emUso.length > 0) {
      itens.push({
        papel: 'gravador',
        para: 'a loja',
        quantidade: quantosGravadores,
        opcao: escolher(gravadores, nivel, nivelDoGravador),
        observacao: 'se a loja já tem um gravador que atende, este item sai',
      });
      itens.push({
        papel: 'computador',
        para: 'a loja',
        quantidade: 1,
        opcao: escolher(computadores, nivel, nivelDoComputador === 'avancado' ? 'intermediario' : nivelDoComputador),
        observacao: 'se a loja já tem um computador que atende, este item sai',
      });
      if (nivelDoComputador === 'avancado') {
        itens.push({
          papel: 'placa_de_video',
          para: 'o computador',
          quantidade: 1,
          opcao: escolher(placas, nivel, 'intermediario'),
          observacao: 'para o modelo de visão rodar dentro da loja',
        });
      }
    }

    const soma = (papeis: ItemDoPacote['papel'][]) =>
      itens
        .filter((i) => papeis.includes(i.papel) && i.opcao?.preco)
        .reduce(
          (t, i) => ({
            min: t.min + i.opcao!.preco!.min * i.quantidade,
            max: t.max + i.opcao!.preco!.max * i.quantidade,
          }),
          { min: 0, max: 0 },
        );
    const cameras = soma(['camera']);
    const infraestrutura = soma(['gravador', 'computador', 'placa_de_video']);
    return {
      nivel,
      itens,
      total: {
        cameras,
        infraestrutura,
        geral: { min: cameras.min + infraestrutura.min, max: cameras.max + infraestrutura.max },
      },
      semPreco: itens.filter((i) => !i.opcao?.preco).length,
    };
  });

  // ─── avisos: o que a pessoa precisa saber antes de confiar no número ───
  const naoMedidas = emUso.filter((c) => c.camera.situacao === 'nao_medido').length;
  if (naoMedidas > 0) {
    avisos.push(
      `${plural(naoMedidas, 'canal em uso não tem', 'canais em uso não têm')} a óptica informada. ` +
        'A câmera atual pode já servir; o orçamento conta como se fosse trocar.',
    );
  }
  const semOpcao = emUso.filter((c) => c.opcoes.length === 0).length;
  if (semOpcao > 0) {
    avisos.push(
      `${plural(semOpcao, 'canal combina', 'canais combinam')} usos que nenhuma câmera do catálogo sustenta junta. ` +
        'Vale dividir os critérios em dois canais.',
    );
  }
  if (canais.some((c) => !c.ativo && c.uso.criterios > 0)) {
    avisos.push('Canal pausado fica de fora dos pacotes.');
  }

  return {
    resumo: {
      canais: canais.length,
      emUso: emUso.length,
      porCarga,
      quadrosPorHora: emUso.reduce((t, c) => t + c.uso.quadrosPorHora, 0),
      cameraNaoAtende: emUso.filter((c) => c.camera.situacao === 'nao_atende').length,
      cameraNaoMedida: naoMedidas,
    },
    setores,
    canais,
    computador: { nivelExigido: nivelDoComputador, motivo: motivoDoComputador, opcoes: computadores },
    gravador: {
      canaisEmUso: emUso.length,
      nivelExigido: nivelDoGravador,
      motivo: motivoDoGravador,
      opcoes: gravadores,
    },
    pacotes,
    avisos,
  };
}

export function rotuloDoNivel(n: Nivel): string {
  return n === 'basico' ? 'básica' : n === 'intermediario' ? 'intermediária' : 'avançada';
}
