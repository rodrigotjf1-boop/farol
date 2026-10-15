/**
 * Cliente da API, do lado do navegador.
 *
 * Tudo sai para `/api/...` do próprio domínio; o Next repassa para a API
 * pela rede interna. `credentials: 'same-origin'` é o que leva o cookie
 * de sessão — e, por ser do mesmo domínio, não há CORS no caminho.
 */

import type { Planta } from '@/lib/planta';

export class ErroDaApi extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

async function pedir<T>(caminho: string, opcoes: RequestInit = {}): Promise<T> {
  let r: Response;
  try {
    // `content-type: application/json` SÓ quando há corpo. O cabeçalho é
    // uma promessa sobre o que vem; mandá-lo num pedido vazio faz o
    // Fastify recusar com 400 FST_ERR_CTP_EMPTY_JSON_BODY — "Body cannot
    // be empty when content-type is set to 'application/json'".
    //
    // E o 400 dele não tem o campo `mensagem`, então chegava à tela como
    // texto genérico. Em 06/10/2026 isso derrubou três chamadas de uma
    // vez — pedir preview, sair e desativar ponto —, e nenhuma dizia por
    // quê.
    const temCorpo = opcoes.body !== undefined && opcoes.body !== null;
    r = await fetch(`/api${caminho}`, {
      ...opcoes,
      credentials: 'same-origin',
      headers: {
        ...(temCorpo ? { 'content-type': 'application/json' } : {}),
        ...(opcoes.headers ?? {}),
      },
    });
  } catch {
    // Rede caída, servidor fora, DNS. A mensagem tem que distinguir isso
    // de "a senha está errada" — senão a pessoa troca a senha à toa.
    throw new ErroDaApi(0, 'sem_rede', 'não consegui falar com o servidor');
  }

  const texto = await r.text();
  let corpo: Record<string, unknown> = {};
  if (texto) {
    try {
      corpo = JSON.parse(texto);
    } catch {
      throw new ErroDaApi(r.status, 'resposta_invalida', 'o servidor respondeu algo inesperado');
    }
  }

  if (!r.ok) {
    // A API explica os erros dela em `mensagem`. Quando não há nenhuma, a
    // resposta veio de outro lugar — o Fastify no 500, o proxy, a borda —
    // e aí o código HTTP é a única pista que existe.
    //
    // Engolir isso num "não deu certo" deixa quem está na tela sem nada
    // para contar e sem nada para procurar. Aconteceu em 06/10/2026: um
    // 500 no pedido de preview virou três palavras na tela, e o
    // diagnóstico teve que começar do zero.
    //
    // `message` em inglês é o campo do Fastify; quando ele vier, vale
    // mais que o código sozinho.
    const daApi = corpo.mensagem ? String(corpo.mensagem) : null;
    const doFastify = corpo.message ? String(corpo.message) : null;
    const mensagem =
      daApi ??
      (doFastify
        ? `erro ${r.status}: ${doFastify}`
        : `o servidor respondeu ${r.status} sem explicar o motivo`);

    throw new ErroDaApi(r.status, String(corpo.erro ?? 'desconhecido'), mensagem);
  }
  return corpo as T;
}

export type Eu = {
  usuarioId: string;
  tenantId: string;
  nivel: 'presidente' | 'gerente' | 'supervisao' | 'execucao' | 'suporte';
  nome: string;
  email: string;
};

export const api = {
  entrar: (email: string, senha: string) =>
    pedir<Eu & { expiraEm: string }>('/sessao', {
      method: 'POST',
      body: JSON.stringify({ email, senha }),
    }),

  sair: () => pedir<{ ok: true }>('/sessao', { method: 'DELETE' }),

  eu: () => pedir<Eu>('/eu'),
};

export type Ponto = {
  id: string;
  nome: string;
  origem: 'dvr' | 'ip';
  fabricante: string | null;
  canal: number | null;
  host: string | null;
  porta: number | null;
  usuario: string | null;
  ativo: boolean;
  /** O quanto o canal importa para a loja. Ordena o orçamento. */
  importancia?: Importancia;
  /** A cena deste canal já foi escrita (o que a câmera vê e de onde olha). */
  tem_cena?: boolean;
  /** A imagem completa primeiro; depois os quadros, na ordem do número. */
  zonas: Zona[];
};

export type Importancia = 'critico' | 'normal' | 'baixo';

/** O que um quadro é. A mesma lista da API (`api/src/cena.ts`) e do banco. */
export type Papel = 'posto' | 'cuba' | 'montagem' | 'equipamento' | 'impressora' | 'caixa' | 'pia' | 'piso' | 'livre';

/**
 * Uma área do canal. `principal` é a IMAGEM COMPLETA — o canal inteiro,
 * onde moram os critérios gerais; marcar o canal na árvore de critérios é
 * marcar esta área. As outras são os QUADROS: recortes com nome, papel e o
 * número que a tela mostra (`numero`; nulo na imagem completa).
 */
export type Zona = { id: string; nome: string; principal?: boolean; papel?: Papel; numero?: number | null };

export type Setor = { id: string; nome: string; ordem: number; pontos: Ponto[] };

/** Quando a loja abre. `dias`: 1 = segunda … 7 = domingo. `hora_fim` menor
 *  ou igual a `hora_ini` quer dizer que fecha no dia seguinte. */
export type FaixaDeHorario = { dias: number[]; hora_ini: string; hora_fim: string };

/** Em que horário o critério é conferido, em relação ao horário DA LOJA. */
export type Quando = 'no_horario' | 'fora_do_horario' | 'sempre';

/** Quando vale a pena conferir. Quem responde é o detector, dentro da loja. */
export type Porteiro = 'sempre' | 'pessoa' | 'livre' | 'movimento';

export type Regra = {
  id: string;
  nome: string;
  tipo: 'estado' | 'acao' | 'presenca' | 'contagem' | 'comparacao';
  criterio: string;
  criterio_versao: number;
  prioridade: 'urgente' | 'intermediaria' | 'leve';
  severidade: 'info' | 'atencao' | 'critico' | 'emergencia';
  confianca_minima: string | number;
  cooldown_min: number;
  resolucao: string | null;
  acoes: string[];
  ativa: boolean;
  /** Onde o critério vale. Um cadastro, vários canais — ou nenhum, quando
   *  ele foi tirado do último. */
  alvos: AlvoDoCriterio[];
  /** O que o detector local procura, nos critérios de presença e de
   *  contagem. Vazio nos tipos que usam só o texto. */
  parametros: ParametrosDoDetector;
  /** Com a loja aberta, fechada ou sempre. */
  quando: Quando;
  /** A faixa de horas em que o critério é conferido. Vazia = sem faixa. */
  janelas: FaixaDeHorario[];
  /** Quando vale a pena conferir — só nos tipos que podem ir à nuvem. */
  porteiro: Porteiro;
  /** Em quantas olhadas seguidas fora do critério ele avisa. 1 = na primeira. */
  confirmar_em: number;
  /** Critério de estado: a foto padrão do canal vai junto à nuvem. */
  com_padrao: boolean;
  /** O que o critério LIGADO faz: só "valendo" avisa. */
  estado: EstadoDoCriterio;
  /** O que o critério pergunta. Só a família "estado" tem juiz hoje. */
  familia: Familia;
};

/** Observando só conta; em ensaio e medido julgam sem avisar; valendo avisa. */
export type EstadoDoCriterio = 'observando' | 'ensaio' | 'medido' | 'valendo';

/** O que o critério pergunta: como está, aconteceu, foi feito como manda, quanto. */
export type Familia = 'estado' | 'acontecimento' | 'processo' | 'medida';

// ───────────────────── o estudo do critério e o funil ─────────────────────

/** As seis partes do estudo, em texto. */
export type ParteDoEstudo = 'contexto' | 'gatilho' | 'janela' | 'acao' | 'desfecho' | 'fora';

/** Onde a condição é lida: no lugar do próprio critério, na imagem completa ou num quadro do mesmo canal. */
export type OndeDaCondicao = 'aqui' | 'canal' | 'quadro';

/** Uma condição do estudo: um sinal lido num lugar do canal. `a_cada` leva os minutos e não tem lugar. */
export type Condicao = { sinal: string; onde?: OndeDaCondicao; zonaId?: string; minutos?: number };

export type Estudo = {
  partes: Partial<Record<ParteDoEstudo, string>>;
  /** O que precisa estar acontecendo: TODAS têm de valer. */
  contexto: Condicao[];
  /** O que abre a análise: basta UM. Vazio = toda olhada. */
  gatilho: Condicao[];
  /** Só o estudo confirmado vale — e só ele desce para a loja. */
  confirmado: boolean;
  confirmadoEm?: string | null;
  atualizadoEm?: string;
};

/** O que a câmera — ou o Farol — não alcança, dito ao lado da parte do estudo a que se refere. */
export type AvisoDoEstudo = { parte: ParteDoEstudo; rotulo: string; motivo: string };

/**
 * As notas de um estudo. Não são guardadas: o servidor as tira do texto da
 * ação toda vez que a ficha é lida ou proposta — quem reescreve a ação para
 * o que a câmera vê deixa de ser avisado.
 */
export type NotasDoEstudo = { avisos: AvisoDoEstudo[]; sugestoes: string[] };

/** A proposta do sistema para o estudo: um rascunho, com o porquê de cada escolha. Nada é gravado ao pedir. */
export type EstudoProposto = NotasDoEstudo & {
  estudo: Pick<Estudo, 'partes' | 'contexto' | 'gatilho'>;
  /** O que o sistema leu no texto e o que ele supôs sobre a câmera. */
  porque: string[];
  usaContextoEGatilho: boolean;
};

/** A ficha de um critério, com os quadros que uma condição pode citar. */
export type EstudoDoCriterio = {
  regraId: string;
  tipo: Regra['tipo'];
  /** Presença e contagem são conferidas na loja em toda olhada: o estudo delas só tem os textos. */
  usaContextoEGatilho: boolean;
  estudo: Estudo | null;
  /** As notas da ficha guardada. `null` = sem estudo. (Ausente em resposta de API antiga.) */
  notas?: NotasDoEstudo | null;
  canais: Array<{
    pontoId: string;
    nome: string;
    canal: number | null;
    quadros: Array<{ id: string; nome: string; papel: Papel; numero: number | null }>;
  }>;
};

/** O funil: cada olhada termina num desfecho só, e as parcelas somam as olhadas. */
export type Funil = {
  olhadas: number;
  semJuiz: number;
  semImagem: number;
  emSilencio: number;
  semContexto: number;
  comContexto: number;
  semGatilho: number;
  comGatilho: number;
  julgadas: number;
  naLoja: number;
  naNuvem: number;
  foraDoCriterio: number;
  custoCentavos: number;
};

export type FunilDoCriterio = {
  regraId: string;
  nome: string;
  tipo: Regra['tipo'];
  estado: EstadoDoCriterio;
  /** Sem estudo confirmado, "com contexto" é o que o "quando vale a pena conferir" deixou passar. */
  temEstudo: boolean;
  dias: number;
  /** O dia de hoje no relógio da loja (AAAA-MM-DD). */
  hoje: string;
  total: Funil;
  porQuadro: Array<Funil & { zonaId: string; pontoId: string }>;
  porDia: Array<Funil & { dia: string }>;
  seLigado: {
    gatilhosPorDia: number;
    /** Quanto custa UMA análise na nuvem, medido. Nulo = ainda sem medida. */
    precoDoPedidoCentavos: number | null;
    deOndeVemOPreco: 'criterio' | 'loja' | null;
    /** O TETO por dia, se toda análise precisasse da nuvem. Nulo = sem preço medido. */
    tetoPorDiaCentavos: number | null;
    /** Conferido só no computador da loja: nunca custa nuvem. */
    soNaLoja: boolean;
    diasNaMedia: number;
    /** A média é de um dia que ainda não acabou. */
    parcial: boolean;
  };
};

/** Os números do funil de um critério NUM lugar, na linha dele na tela do canal. */
export type FunilNaLinha = { olhadas: number; comGatilho: number; julgadas: number; foraDoCriterio: number };

export type ParametrosDoDetector = {
  objeto?: string;
  minimo?: number;
  maximo?: number | null;
};

export type AlvoDoCriterio = {
  zona_id: string;
  zona_nome: string;
  principal: boolean;
  ponto_id: string;
  ponto_nome: string;
  canal: number | null;
  ponto_ativo: boolean;
  /** Quantas fotos padrão o canal tem. Sem nenhuma, critério de comparação
   *  não é conferido nele. */
  ponto_padroes: number;
  setor_id: string;
  setor_nome: string;
};

export type AgenteResumo = {
  id: string;
  nome: string;
  estado: 'novo' | 'ativo' | 'inativo' | 'bloqueado';
  versao: string | null;
  ultimo_heartbeat: string | null;
  /** Calculado no BANCO: o relógio do navegador erra e faria um agente
   *  saudável parecer caído, ou pior, o contrário. */
  segundos_sem_bater: number | null;
  /** O que o agente declarou saber fazer ao pedir a configuração pela última
   *  vez ("estados", "estudo", "bancada"). É por aqui que a tela diz se o que
   *  foi configurado já vale na loja. */
  sabe?: string[];
  /** Quando declarou. Nulo = ainda não pediu a configuração desde que isto é guardado. */
  sabe_em?: string | null;
};

export type LojaResumo = {
  id: string;
  nome: string;
  timezone: string;
  modo_julgamento: string;
  resolucao_padrao: string;
  ativa: boolean;
  setores: number;
  pontos: number;
  /** Critérios cadastrados (os excluídos não contam). */
  criterios: number;
  /** Quantos agentes a loja tem, e há quanto tempo o mais recente bateu. */
  agentes: number;
  segundos_sem_bater: number | null;
  /** O que foi julgado nas últimas 24 horas. Nulo para quem não vê
   *  resultados, e para loja que ainda não mandou nenhum. */
  resultado_24h: { conformes: number; naoConformes: number; naoAvaliaveis: number } | null;
  /** Quando a loja abre. Vazio = não informado, e ela vale como sempre aberta. */
  horario_funcionamento: FaixaDeHorario[];
  /** Pelo relógio do SERVIDOR, no fuso da loja. Nulo = sem horário informado. */
  aberta_agora: boolean | null;
  /** Até que horas fica aberta, quando está aberta agora. */
  fecha_as: string | null;
  /** Que negócio é ("hamburgueria"). Vale para a loja inteira. */
  tipo_negocio?: string;
};

export type Loja = Omit<LojaResumo, 'setores' | 'pontos'>;

export const consoleApi = {
  lojas: () => pedir<{ lojas: LojaResumo[] }>('/lojas'),

  loja: (id: string) =>
    pedir<{ loja: Loja; setores: Setor[]; agentes: AgenteResumo[] }>(`/lojas/${id}`),

  criarSetor: (lojaId: string, nome: string, ordem?: number) =>
    pedir<Setor>(`/lojas/${lojaId}/setores`, {
      method: 'POST',
      body: JSON.stringify({ nome, ordem }),
    }),

  criarPonto: (setorId: string, dados: Partial<Ponto>) =>
    pedir<Ponto>(`/setores/${setorId}/pontos`, {
      method: 'POST',
      body: JSON.stringify(dados),
    }),

  editarPonto: (id: string, dados: Partial<Ponto>) =>
    pedir<Ponto>(`/pontos/${id}`, { method: 'PATCH', body: JSON.stringify(dados) }),

  /** A cena do canal: o que a câmera vê e de onde olha. Texto vazio apaga. */
  salvarCena: (pontoId: string, cena: string) =>
    pedir<{ id: string; cena: string; cena_escrita_em: string | null }>(`/pontos/${pontoId}`, {
      method: 'PATCH',
      body: JSON.stringify({ cena }),
    }),

  /** O tipo de negócio vale para a loja inteira. */
  salvarTipoDeNegocio: (lojaId: string, tipoNegocio: string) =>
    pedir<{ id: string; tipo_negocio: string }>(`/lojas/${lojaId}`, {
      method: 'PATCH',
      body: JSON.stringify({ tipoNegocio }),
    }),

  /** O orçamento por uso da loja: carga de cada canal, opções por nível e três pacotes. */
  orcamento: (lojaId: string) => pedir<Orcamento>(`/lojas/${lojaId}/orcamento`),

  /** O horário inteiro da loja. Mandar de novo dá no mesmo. */
  salvarHorario: (lojaId: string, horario: FaixaDeHorario[]) =>
    pedir<{ horario_funcionamento: FaixaDeHorario[]; aberta_agora: boolean | null; fecha_as: string | null }>(
      `/lojas/${lojaId}/horario`,
      { method: 'PUT', body: JSON.stringify({ horario }) },
    ),

  /** Exclui o canal. Pausar é outra coisa: `editarPonto(id, { ativo: false })`. */
  excluirPonto: (id: string) =>
    pedir<{ excluido: boolean; criteriosTirados: number; criteriosDesligados: string[] }>(
      `/pontos/${id}`,
      { method: 'DELETE' },
    ),
};

// ───────────────────────── orçamento por uso ─────────────────────────

export type Nivel = 'basico' | 'intermediario' | 'avancado';
export type Carga = 'sem_uso' | 'leve' | 'moderada' | 'intensa';

export type FaixaDePreco = { min: number; max: number; confianca: string; cotadoEm: string };

/** Uma solução: o que o usuário precisa para escolher. O catálogo não vem. */
export type Opcao = {
  nivel: Nivel;
  fabricante: string;
  modelo: string;
  porque: string;
  recomendado: boolean;
  preco: FaixaDePreco | null;
};

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
  camera: {
    pxPorCm: number | null;
    situacao: 'sem_uso' | 'nao_medido' | 'atende' | 'nao_atende';
    mensagem: string;
  };
  opcoes: Opcao[];
};

export type ItemDoPacote = {
  papel: 'camera' | 'gravador' | 'computador' | 'placa_de_video';
  para: string;
  quantidade: number;
  opcao: Opcao | null;
  observacao: string | null;
};

type Soma = { min: number; max: number };

export type Pacote = {
  nivel: Nivel;
  itens: ItemDoPacote[];
  total: { cameras: Soma; infraestrutura: Soma; geral: Soma };
  semPreco: number;
};

export type Orcamento = {
  loja: { id: string; nome: string; modoJulgamento: string };
  capturasPorHora: number;
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

export const regrasApi = {
  listar: (lojaId: string) =>
    pedir<{ regras: Regra[]; detector: { objetos: string[] } }>(`/lojas/${lojaId}/regras`),

  /** Um cadastro valendo em todos os canais de `zonaIds`. */
  criar: (lojaId: string, dados: Record<string, unknown> & { zonaIds: string[] }) =>
    pedir<Regra & { aviso: string; canais: number }>(`/lojas/${lojaId}/regras`, {
      method: 'POST',
      body: JSON.stringify(dados),
    }),

  /** `zonaIds` ausente mantém os canais; presente, SUBSTITUI a marcação. */
  editar: (id: string, dados: Record<string, unknown>) =>
    pedir<Regra & { canais: number; desligada: boolean }>(`/regras/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(dados),
    }),

  /** Tira o critério de UM canal. Ele continua nos outros. */
  tirarDoCanal: (id: string, zonaId: string) =>
    pedir<{ removido: boolean; restantes: number; desligada: boolean }>(
      `/regras/${id}/canais/${zonaId}`,
      { method: 'DELETE' },
    ),

  /** Exclui o critério de TODOS os canais. O histórico de vereditos fica. */
  excluir: (id: string) =>
    pedir<{ excluido: boolean; canais: number }>(`/regras/${id}`, { method: 'DELETE' }),

  /** A ficha do critério (ou nada) e os quadros que ela pode citar. */
  estudo: (id: string) => pedir<EstudoDoCriterio>(`/regras/${id}/estudo`),

  /** Grava a ficha inteira. Só a confirmada vale. */
  gravarEstudo: (id: string, estudo: Pick<Estudo, 'partes' | 'contexto' | 'gatilho' | 'confirmado'>) =>
    pedir<{ regraId: string; estudo: Estudo }>(`/regras/${id}/estudo`, { method: 'PUT', body: JSON.stringify(estudo) }),

  /** Tira o estudo: o critério volta a ser conferido como antes dele. */
  tirarEstudo: (id: string) => pedir<{ regraId: string; removido: boolean }>(`/regras/${id}/estudo`, { method: 'DELETE' }),

  /**
   * Pede a proposta do estudo para o critério como está na gaveta — salvo
   * ou ainda não. O servidor propõe por regras, a partir do texto e dos
   * lugares marcados, e não grava nada.
   */
  proporEstudo: (
    lojaId: string,
    criterio: { nome: string; criterio: string; tipo: Regra['tipo']; familia: Familia; zonaIds: string[] },
  ) => pedir<EstudoProposto>(`/lojas/${lojaId}/estudo-proposto`, { method: 'POST', body: JSON.stringify(criterio) }),

  /** O funil dos últimos dias (o servidor escolhe quantos, quando `dias` não vem). */
  funil: (id: string, dias?: number) => pedir<FunilDoCriterio>(`/regras/${id}/funil${dias ? `?dias=${dias}` : ''}`),
};

// ───────────────────── o canal: ver e demarcar ─────────────────────

export type EstadoDoPreview = {
  temPreview: boolean;
  capturadoEm: string | null;
  largura: number | null;
  altura: number | null;
  /** Quantas pessoas o detector da loja viu neste quadro. Nulo = não foi
   *  medido (agente antigo, ou loja sem detector): não é zero. */
  pessoas: number | null;
  pedido: {
    id: string;
    estado: 'pendente' | 'entregue' | 'concluido' | 'falhou' | 'expirado';
    erro: string | null;
    criadoEm: string;
    concluidoEm: string | null;
  } | null;
};

/** Um critério visto de dentro da área em que vale. */
export type CriterioDaArea = {
  id: string;
  nome: string;
  tipo: Regra['tipo'];
  ativa: boolean;
  /** O que o critério ligado faz: só "valendo" avisa. */
  estado: EstadoDoCriterio;
  quando: Quando;
  parametros: ParametrosDoDetector;
  /** Em quantos canais este critério vale — o cadastro é um só. */
  canais: number;
  /** Em quantos quadros (fora as imagens completas). */
  quadros: number;
  /** O critério depende de entender a imagem e, neste canal, não está sendo
   *  analisado porque falta descrever a cena. Quem diz é o servidor. */
  falta_a_cena: boolean;
  /** O que o critério pergunta. */
  familia: Familia;
  /** O estudo dele está confirmado (só o confirmado vale). */
  tem_estudo: boolean;
  /** Os números do funil NESTE lugar, nos últimos `funil_dias` do canal.
   *  Nulo = quem está vendo não tem acesso ao funil. */
  funil: FunilNaLinha | null;
};

export type ZonaCompleta = {
  id: string;
  ponto_id: string;
  nome: string;
  poligono: [number, number][];
  /** É a imagem completa do canal: fixa, sempre o canal inteiro. */
  principal: boolean;
  largura_cena_cm: string | number | null;
  /** O que o quadro é. Na imagem completa, sempre "livre". */
  papel: Papel;
  ordem: number;
  /** O número do quadro no canal. Nulo = é a imagem completa. */
  numero: number | null;
  /** Os critérios que valem NESTA área: na imagem completa, os gerais do
   *  canal; num quadro, os dele. */
  criterios: CriterioDaArea[];
};

export type PontoCompleto = {
  id: string;
  nome: string;
  canal: number | null;
  host: string | null;
  porta: number | null;
  usuario: string | null;
  fabricante: string | null;
  origem: 'dvr' | 'ip';
  ativo: boolean;
  /** MAC do gravador, lido pelo agente. IP muda (DHCP); MAC não. */
  mac: string | null;
  mac_visto_em: string | null;
  sensor_pol: string | null;
  focal_mm: string | number | null;
  distancia_cm: string | number | null;
  resolucao_h: number | null;
  largura_cena_cm: string | number | null;
  preview_largura: number | null;
  preview_altura: number | null;
  preview_em: string | null;
  tem_preview: boolean;
  /** O que esta câmera vê e de onde olha, escrito por quem configura. Vazio = em branco. */
  cena: string;
  cena_escrita_em: string | null;
  cena_escrita_por_nome: string | null;
  /** A cena está fazendo falta AGORA: critério deste canal que depende de
   *  entender a imagem não é analisado enquanto ela estiver em branco. */
  cena_em_falta: boolean;
  /** De quantos dias são os números do funil de cada critério. Nulo = quem
   *  está vendo não tem acesso ao funil. */
  funil_dias: number | null;
  /** Que negócio é a loja. Mostrado e editado junto com a cena. */
  loja_tipo_negocio: string;
  setor_id: string;
  setor_nome: string;
  loja_id: string;
};

export const previewApi = {
  ponto: (id: string) =>
    pedir<{ ponto: PontoCompleto; zonas: ZonaCompleta[] }>(`/pontos/${id}`),

  /**
   * A URL da imagem, com um selo de tempo para furar o cache do
   * navegador. Sem ele, clicar em atualizar mostraria a cena de antes e
   * pareceria que o botão não funciona.
   */
  url: (pontoId: string, selo?: string | null) =>
    `/api/pontos/${pontoId}/preview${selo ? `?t=${encodeURIComponent(selo)}` : ''}`,

  estado: (pontoId: string) =>
    pedir<EstadoDoPreview>(`/pontos/${pontoId}/preview/estado`),

  pedir: (pontoId: string) =>
    pedir<{ comandoId: string; jaPedido: boolean; expiraEm?: string }>(
      `/pontos/${pontoId}/preview`,
      { method: 'POST' },
    ),

  /**
   * Salva um quadro: nome, papel, ordem e contorno. Campo ausente fica como
   * está. Na IMAGEM COMPLETA só a largura real da cena muda — o servidor
   * recusa o resto (409 `imagem_completa_fixa`).
   */
  salvarArea: (zonaId: string, dados: {
    nome?: string;
    poligono?: [number, number][];
    larguraCenaCm?: number | null;
    papel?: Papel;
    ordem?: number;
  }) =>
    pedir<Omit<ZonaCompleta, 'criterios' | 'numero'>>(`/zonas/${zonaId}`, {
      method: 'PATCH',
      body: JSON.stringify(dados),
    }),

  /** Mais um quadro no canal. Sem desenho, nasce no meio da imagem. */
  criarArea: (pontoId: string, dados: { nome: string; poligono?: [number, number][]; papel?: Papel }) =>
    pedir<Omit<ZonaCompleta, 'numero'>>(`/pontos/${pontoId}/zonas`, { method: 'POST', body: JSON.stringify(dados) }),

  /** Exclui o quadro. Os critérios dele saem deste canal; o histórico fica. */
  excluirArea: (zonaId: string) =>
    pedir<{ excluida: boolean; criteriosTirados: number; criteriosDesligados: string[] }>(
      `/zonas/${zonaId}`,
      { method: 'DELETE' },
    ),
};

// ───────────────────── a foto padrão do canal ─────────────────────

/** O quadro do canal com o ambiente como deve ficar. A loja compara com ela. */
export type FotoPadrao = {
  id: string;
  pontoId: string;
  nome: string;
  largura: number | null;
  altura: number | null;
  /** Pessoas que o detector viu no quadro guardado. Nulo = não medido. */
  pessoas: number | null;
  /** Quando o quadro foi capturado na loja — não quando foi guardado. */
  capturadaEm: string;
  criadaEm: string;
  criadaPor: string | null;
};

export const padroesApi = {
  /** Da mais nova para a mais antiga. `maximo` = quantas o canal guarda. */
  listar: (pontoId: string) =>
    pedir<{ padroes: FotoPadrao[]; maximo: number }>(`/pontos/${pontoId}/padroes`),

  /** Guarda o quadro que o canal tem AGORA. Não há envio de imagem. */
  guardar: (pontoId: string, nome: string) =>
    pedir<FotoPadrao>(`/pontos/${pontoId}/padroes`, { method: 'POST', body: JSON.stringify({ nome }) }),

  /** A imagem de uma foto. O id nunca muda de imagem: o navegador guarda. */
  url: (id: string) => `/api/padroes/${id}/imagem`,

  excluir: (id: string) =>
    pedir<{ excluida: boolean; nome: string; restantes: number }>(`/padroes/${id}`, { method: 'DELETE' }),
};

// ───────────────────── o inventário de equipamentos ─────────────────────

export type TipoDeEquipamento =
  | 'chapa' | 'fritadeira' | 'bancada' | 'geladeira' | 'balcao' | 'caixa' | 'prateleira' | 'pia' | 'outro';

/** `canal` = o quadro do canal, com o desenho da área em `recorte`; `envio` = foto mandada pelo console. */
export type FotoDoEquipamento = {
  id: string;
  origem: 'canal' | 'envio';
  pontoId: string | null;
  zonaId: string | null;
  /** O desenho da área no instante da foto, em fração do quadro. */
  recorte: [number, number][] | null;
  largura: number | null;
  altura: number | null;
};

/** Onde o equipamento aparece: o canal e a área das fotos tiradas do quadro. */
export type LugarDoEquipamento = {
  pontoId: string;
  pontoNome: string;
  canal: number | null;
  zonaId: string;
  zonaNome: string;
  /** O canal tem mais de uma área: aí o nome da área diz alguma coisa. */
  variasAreas: boolean;
  /** Quantas fotos padrão o canal tem. */
  fotosPadrao: number;
};

export type Equipamento = {
  id: string;
  lojaId: string;
  setorId: string;
  setorNome: string;
  nome: string;
  tipo: TipoDeEquipamento;
  /** Como ele é e como fica limpo e no lugar. Vai junto com a pergunta à nuvem. */
  descricao: string;
  /** O que vale conferir nele. Cada frase pode virar um critério. */
  conferir: string[];
  descritoEm: string | null;
  descritoPor: string | null;
  atualizadoEm: string;
  fotos: FotoDoEquipamento[];
  aparece: LugarDoEquipamento[];
  /** Aparece num canal que tem foto padrão: comparação ali é julgada na loja. */
  comparaNaLoja: boolean;
};

export type CamposDoEquipamento = {
  nome: string;
  tipo: TipoDeEquipamento;
  setorId: string;
  descricao: string;
  conferir: string[];
  /** A descrição salva veio desta análise das fotos (o id do pedido). */
  daAnalise: string;
};

/** O pedido de análise das fotos, do jeito que a loja o deixou. */
export type PedidoDeDescricao = {
  id: string;
  estado: 'pendente' | 'entregue' | 'concluido' | 'falhou' | 'expirado';
  erro: string | null;
  criadoEm: string;
  concluidoEm: string | null;
};

/** O que a análise devolveu e ainda espera alguém ler e salvar. */
export type DescricaoSugerida = {
  comandoId: string;
  descricao: string;
  conferir: string[];
  modelo: string | null;
  custoCentavos: number | null;
  feitaEm: string;
};

export const inventarioApi = {
  listar: (lojaId: string) =>
    pedir<{ itens: Equipamento[]; tipos: TipoDeEquipamento[]; maximoDeFotos: number; maximoAConferir: number }>(
      `/lojas/${lojaId}/inventario`,
    ),

  criar: (lojaId: string, dados: Partial<CamposDoEquipamento> & { nome: string; setorId: string }) =>
    pedir<Equipamento>(`/lojas/${lojaId}/inventario`, { method: 'POST', body: JSON.stringify(dados) }),

  /** Campo ausente mantém o que está guardado. */
  editar: (id: string, dados: Partial<CamposDoEquipamento>) =>
    pedir<Equipamento>(`/inventario/${id}`, { method: 'PATCH', body: JSON.stringify(dados) }),

  /** Leva as fotos junto. */
  excluir: (id: string) => pedir<{ excluido: boolean; nome: string }>(`/inventario/${id}`, { method: 'DELETE' }),

  /** Copia o quadro que o canal tem agora, com o desenho da área. */
  fotoDoCanal: (id: string, zonaId: string) =>
    pedir<{ fotoId: string; item: Equipamento }>(`/inventario/${id}/fotos`, {
      method: 'POST',
      body: JSON.stringify({ origem: 'canal', zonaId }),
    }),

  /** Uma foto mandada daqui, já reduzida e em JPEG. */
  fotoEnviada: (id: string, imagemBase64: string) =>
    pedir<{ fotoId: string; item: Equipamento }>(`/inventario/${id}/fotos`, {
      method: 'POST',
      body: JSON.stringify({ origem: 'envio', imagemBase64 }),
    }),

  /** A imagem de uma foto. O id nunca muda de imagem: o navegador guarda. */
  urlDaFoto: (fotoId: string) => `/api/inventario/fotos/${fotoId}/imagem`,

  /** "Analisar as fotos e descrever": um pedido ao computador da loja. Repetir devolve o mesmo. */
  pedirDescricao: (id: string) =>
    pedir<{ comandoId: string; jaPedido: boolean; expiraEm?: string }>(`/inventario/${id}/descricao`, { method: 'POST' }),

  /** Em que pé está a análise, e a sugestão que ainda espera alguém ler. */
  descricao: (id: string) =>
    pedir<{ pedido: PedidoDeDescricao | null; sugestao: DescricaoSugerida | null }>(`/inventario/${id}/descricao`),

  tirarFoto: (fotoId: string) =>
    pedir<{ excluida: boolean; item: Equipamento }>(`/inventario/fotos/${fotoId}`, { method: 'DELETE' }),
};

// ───────────────── alertas: destinos, política, envios ─────────────────

export type Destino = {
  id: string;
  tipo: 'whatsapp' | 'email' | 'kds' | 'webhook';
  nome: string;
  endereco: string;
  papel: string | null;
  ativo: boolean;
  da_rede: boolean;
  tem_segredo: boolean;
};

export type Politica = {
  id: string;
  severidade: string | null;
  prioridade: string | null;
  enviar: boolean;
  destino_id: string | null;
  da_rede: boolean;
  destino_nome: string | null;
  destino_tipo: string | null;
};

export type Envio = {
  id: string;
  motivo: 'evento' | 'agente_caiu' | 'busca_concluida';
  estado: 'pendente' | 'enviado' | 'entregue' | 'falhou' | 'descartado';
  tentativas: number;
  erro: string | null;
  criado_em: string;
  despachado_em: string | null;
  confirmado_em: string | null;
  destino_tipo: string;
  destino_nome: string;
  ocorrido_em: string | null;
  regra_nome: string | null;
};

export const alertasApi = {
  destinos: (lojaId: string) =>
    pedir<{ destinos: Destino[] }>(`/lojas/${lojaId}/destinos`),

  criarDestino: (lojaId: string, dados: Record<string, unknown>) =>
    pedir<{ destino: Destino }>(`/lojas/${lojaId}/destinos`, {
      method: 'POST',
      body: JSON.stringify(dados),
    }),

  alternarDestino: (id: string, ativo: boolean) =>
    pedir<{ destino: Destino }>(`/destinos/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ativo }),
    }),

  politicas: (lojaId: string) =>
    pedir<{
      politicas: Politica[];
      escopo_vigente: 'loja' | 'rede';
      explicacao: string;
    }>(`/lojas/${lojaId}/politicas`),

  criarPolitica: (lojaId: string, dados: Record<string, unknown>) =>
    pedir<{ politica: Politica }>(`/lojas/${lojaId}/politicas`, {
      method: 'POST',
      body: JSON.stringify(dados),
    }),

  removerPolitica: (id: string) =>
    pedir<{ removida: boolean }>(`/politicas/${id}`, { method: 'DELETE' }),

  envios: (lojaId: string, estado?: string) =>
    pedir<{ envios: Envio[] }>(
      `/lojas/${lojaId}/envios${estado ? `?estado=${estado}` : ''}`,
    ),
};

// ───────────────────── resultados: o que o Farol viu ─────────────────────

export type Periodo = '24h' | '7d';

export type TipoDeSinal =
  | 'sem_agente'
  | 'agente_fora'
  | 'canal_sem_imagem'
  | 'sem_juiz'
  | 'julgamento_falhando'
  | 'avalia_pouco'
  | 'falta_dizer_o_que_procurar'
  | 'nunca_olhado';

/** Um defeito DO FAROL (não da cozinha): o sistema não está conseguindo olhar. */
export type Sinal = {
  tipo: TipoDeSinal;
  gravidade: 'critico' | 'atencao';
  regraId?: string;
  regraNome?: string;
  pontoId?: string;
  pontoNome?: string;
  canal?: number | null;
  quantos?: number;
  percentual?: number;
  segundosSemBater?: number | null;
  desde?: string | null;
  impedimento?: string | null;
};

export type LinhaDeResultado = {
  regraId: string;
  regraNome: string;
  tipo: string;
  pontoId: string;
  pontoNome: string;
  canal: number | null;
  setor: string;
  /** Em que área do canal — nulo quando o canal tem uma área só. */
  areaNome: string | null;
  /** Critério ou canal excluído depois: a linha é só histórico. */
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
  marca: 'sem_imagem' | 'sem_juiz' | 'falhando' | 'avalia_pouco' | null;
};

export type Ocorrencia = {
  id: string;
  ocorridoEm: string;
  regraNome: string | null;
  /** Em que canal foi. Nulo quando o canal já não existe. */
  pontoId: string | null;
  pontoNome: string | null;
  canal: number | null;
  /** Em que área do canal — nulo quando o canal tem uma área só. */
  areaNome: string | null;
  motivo: string | null;
  confianca: number | null;
  /** O que houve com o aviso desta ocorrência; nulo = não gerou aviso. */
  aviso: 'entregue' | 'enviado' | 'pendente' | 'falhou' | null;
};

export type Resultados = {
  loja: { id: string; nome: string; timezone: string };
  periodo: Periodo;
  desde: string;
  agora: string;
  /** Já chegou resumo desta loja alguma vez? */
  temHistorico: boolean;
  agentes: AgenteResumo[];
  canais: { verificados: number; comImagem: number };
  /** `observando`: dos ligados, os que só observam (contam, sem julgar nem avisar). */
  criterios: { total: number; ligados: number; observando?: number };
  totais: {
    capturas: number;
    analises: number;
    conformes: number;
    naoConformes: number;
    naoAvaliaveis: number;
    falhas: number;
    alertas: number;
  };
  serie: {
    passo: 'hora' | 'dia';
    /** `inicio` é o relógio DA LOJA, sem fuso: "2026-10-07T12:00:00". */
    pontos: Array<{ inicio: string; conformes: number; naoConformes: number; naoAvaliaveis: number }>;
  };
  linhas: LinhaDeResultado[];
  sinais: Sinal[];
  ocorrencias: Ocorrencia[];
};

// A moldura quer só a contagem de sinais, o painel quer tudo, e a tela de
// canais quer saber qual câmera está sem imagem — três lugares pedindo a
// mesma resposta. Um pedido serve aos três: o que está em voo é
// compartilhado, e a resposta vale por meio minuto.
const VALIDADE_MS = 30_000;
const guardados = new Map<string, { em: number; promessa: Promise<Resultados> }>();

export const resultadosApi = {
  obter(lojaId: string, periodo: Periodo = '24h', forcar = false): Promise<Resultados> {
    const chave = `${lojaId}:${periodo}`;
    const tem = guardados.get(chave);
    if (!forcar && tem && Date.now() - tem.em < VALIDADE_MS) return tem.promessa;

    const promessa = pedir<Resultados>(`/lojas/${lojaId}/resultados?periodo=${periodo}`);
    guardados.set(chave, { em: Date.now(), promessa });
    // Pedido que falhou não fica guardado: a próxima tela tenta de novo.
    promessa.catch(() => {
      if (guardados.get(chave)?.promessa === promessa) guardados.delete(chave);
    });
    return promessa;
  },

  /** Depois de mexer em canal ou critério, o que estava guardado envelheceu. */
  esquecer(lojaId: string): void {
    for (const chave of [...guardados.keys()]) {
      if (chave.startsWith(`${lojaId}:`)) guardados.delete(chave);
    }
  },
};

// ───────────────────────── padrões ─────────────────────────
// O especialista: o padrão de funcionamento da loja, tirado dos números
// guardados por hora. A conta é toda do servidor (`api/src/especialista.ts`);
// a tela só desenha o que chega.

/** Um pedaço de frase: texto corrido, ou um trecho em destaque. */
export type Trecho = string | { forte: string };
export type Frase = Trecho[];

export type TipoDeIndicador = 'medida' | 'fora' | 'na';

export type IndicadorDoPadrao = {
  id: string;
  tipo: TipoDeIndicador;
  regraId: string;
  zonaId: string;
  setorId: string;
  nome: string;
  /** O que o número conta: "pessoas", "fora do critério". */
  curto: string;
  onde: string;
  noSeletor: boolean;
};

export type NormalDaHora = { n: number; noMiolo: number; media: number; mediana: number; min: number; max: number; base: 'dia' | 'hora' };
export type CelulaDaSemana = { diaDaSemana: number; hora: number; n: number; media: number; min: number; max: number };
export type DescricaoDoSetor = { setorId: string; setor: string; texto: string | null; fatos: Array<[string, string]> };
export type RelacaoDoPadrao = {
  setorId: string;
  pergunta: string;
  titulo: string;
  forca: 'forte' | 'moderada' | 'nenhuma';
  /** [rótulo, taxa em %, é o lado calmo?] */
  linhas: Array<[string, number, boolean]>;
  sufixo: string;
  pe: string;
};

/** Um critério de contagem que o especialista propõe: o costume de uma hora virando limite. */
export type CriterioProposto = {
  nome: string;
  tipo: 'contagem';
  objeto: string;
  minimo: number;
  maximo: number | null;
  zonaId: string;
  lugar: string;
  janela: [string, string];
  regra: string;
  texto: string;
};

export type SaidaDoPadrao = {
  id: string;
  indicadorId: string;
  tipo: TipoDeIndicador;
  regraId: string;
  zonaId: string;
  pontoId: string;
  setorId: string;
  /** O dia da operação (a madrugada pertence à noite anterior), AAAA-MM-DD. */
  dia: string;
  hora: number;
  onde: string;
  titulo: string;
  grave: boolean;
  estado: 'rever' | 'esperado' | 'problema';
  visto: number;
  normal: NormalDaHora;
  conta: Frase;
  curto: string;
  mais: string | null;
  camera: boolean;
  criterio: CriterioProposto | null;
  ajustar: { regraId: string; nome: string } | null;
  revisao: { quem: string | null; em: string; texto: string; virou: string | null; soDestaVez: boolean } | null;
};

export type HojeContraONormal = {
  indicadorId: string;
  /** O nome do critério — com o canal, quando ele vale em mais de um. */
  rotulo: string;
  diaDaSemana: number;
  horas: Array<{ hora: number; min: number; max: number; media: number; visto: number | null; completa: boolean }>;
  nota: string;
};

export type TendenciaDoPadrao = {
  setorId: string;
  titulo: string;
  serie: number[];
  sentido: 'sobe' | 'cai' | 'estável';
  seguidas: number;
  ruim: 'sobe' | 'cai';
  limite: number | null;
  valor: string;
  legenda: string;
  texto: Frase;
};

export type SugestaoDoPadrao = {
  setorId: string;
  icone: 'area' | 'pessoa' | 'foto' | 'criterio' | 'duvida';
  titulo: string;
  texto: Frase;
  acao:
    | { tipo: 'area'; rotulo: string; pontoId: string }
    | { tipo: 'criterio'; rotulo: string; regraId: string; porteiro?: 'pessoa' }
    | { tipo: 'criar'; rotulo: string; criterio: CriterioProposto };
};

export type Padroes = {
  loja: { id: string; nome: string; timezone: string };
  /** O dia da operação de agora, no relógio da loja. */
  hoje: string;
  base: { dias: number; de: string | null; ate: string | null; firme: boolean };
  /** Menos de sete dias medidos: não há padrão para mostrar. */
  suficiente: boolean;
  setores: Array<{ id: string; nome: string }>;
  indicadores: IndicadorDoPadrao[];
  descricoes: DescricaoDoSetor[];
  semana: Record<string, CelulaDaSemana[]>;
  relacoes: RelacaoDoPadrao[];
  anomalias: SaidaDoPadrao[];
  aRever: number;
  hojeContraONormal: HojeContraONormal[];
  tendencias: TendenciaDoPadrao[];
  sugestoes: SugestaoDoPadrao[];
  parecer: { frequencia: string | null; anomalias: Frase; tendencia: Frase | null };
};

/** O que o responsável responde a uma saída do padrão. */
export type RespostaAoPadrao =
  | { anomaliaId: string; estado: 'esperado'; soDestaVez: boolean; nota: string }
  | { anomaliaId: string; estado: 'problema'; oQueHouve: string; oQueFoiFeito: string; depois: 'criar' | 'ajustar' | 'nada' };

// A aba "Padrões" mostra quantas saídas esperam revisão também na tela de
// análises: um pedido serve às duas, e vale por meio minuto.
const padroesGuardados = new Map<string, { em: number; promessa: Promise<Padroes> }>();

export const especialistaApi = {
  obter(lojaId: string, forcar = false): Promise<Padroes> {
    const tem = padroesGuardados.get(lojaId);
    if (!forcar && tem && Date.now() - tem.em < VALIDADE_MS) return tem.promessa;
    const promessa = pedir<Padroes>(`/lojas/${lojaId}/especialista`);
    padroesGuardados.set(lojaId, { em: Date.now(), promessa });
    promessa.catch(() => {
      if (padroesGuardados.get(lojaId)?.promessa === promessa) padroesGuardados.delete(lojaId);
    });
    return promessa;
  },

  /** Guarda a resposta e devolve a tela inteira de novo, já com ela. */
  async responder(lojaId: string, resposta: RespostaAoPadrao): Promise<Padroes> {
    const novo = await pedir<Padroes>(`/lojas/${lojaId}/especialista/revisoes`, { method: 'POST', body: JSON.stringify(resposta) });
    padroesGuardados.set(lojaId, { em: Date.now(), promessa: Promise.resolve(novo) });
    return novo;
  },

  /** Depois de mexer em critério, área ou foto padrão, o que estava guardado envelheceu. */
  esquecer(lojaId: string): void {
    padroesGuardados.delete(lojaId);
  },
};

// ───────────────────────── a planta ─────────────────────────
// Os ambientes, os móveis e cada câmera no seu lugar, em metros. A conta
// (o que cada câmera alcança, a perspectiva) mora em `lib/planta.ts`.

export type PlantaDaLoja = {
  /** Nulo = a loja ainda não tem planta. */
  planta: Planta | null;
  /** A versão que foi lida: volta no salvar, e é o que impede um apagar o desenho do outro. */
  versao: number | null;
  atualizadaEm: string | null;
  /** A frase do lugar de cada câmera, pelo canal — a mesma que vai junto com a análise. */
  lugares: Record<string, string>;
};

export const plantaApi = {
  obter: (lojaId: string) => pedir<PlantaDaLoja>(`/lojas/${lojaId}/planta`),

  /** Salva a planta INTEIRA. `versao` é a que veio no `obter` (nula na primeira vez). */
  salvar: (lojaId: string, planta: Planta, versao: number | null) =>
    pedir<PlantaDaLoja>(`/lojas/${lojaId}/planta`, { method: 'PUT', body: JSON.stringify({ versao, planta }) }),
};

// ───────────────────────── análises ─────────────────────────
// O miúdo do que foi julgado: uma célula por dia, hora, critério e área. A
// tela recorta e soma aqui no navegador — trocar um filtro não volta ao
// servidor; só trocar o período volta.

export type CelulaDeAnalise = {
  /** Dia e hora no relógio DA LOJA. */
  dia: string;
  hora: number;
  regraId: string;
  pontoId: string;
  zonaId: string;
  /** A área do canal — nulo quando o canal tem uma área só. */
  areaNome: string | null;
  capturas: number;
  /** Olhadas que a loja segurou: a condição do critério não valia e a
   *  pergunta não foi feita. Não são análise. */
  semCondicao: number;
  /** Olhadas dentro do silêncio depois de um aviso. Não são análise. */
  emSilencio: number;
  /** O que terminou em veredito: conformes + naoConformes + naoAvaliaveis. */
  analises: number;
  conformes: number;
  naoConformes: number;
  naoAvaliaveis: number;
  falhas: number;
  alertas: number;
  /** Onde foi julgado. `naLoja + naNuvem` é sempre `analises`. */
  naLoja: number;
  naNuvem: number;
  /** Estimativa: preço de tabela do modelo, com o dólar fixo do agente. */
  custoCentavos: number;
  somaLatenciaMs: number;
  comLatencia: number;
  somaConfianca: number;
  comConfianca: number;
};

export type AvisoDaAnalise = {
  id: string;
  ocorridoEm: string;
  dia: string;
  hora: number;
  /** "19:45", no relógio da loja. */
  horaMinuto: string;
  regraId: string | null;
  pontoId: string | null;
  zonaId: string | null;
  areaNome: string | null;
  motivo: string | null;
  confianca: number | null;
  onde: 'loja' | 'nuvem' | null;
  aviso: 'entregue' | 'enviado' | 'pendente' | 'falhou' | null;
};

/** O uso da máquina de análise (o computador da loja) numa hora. De cada
 *  peça vêm a soma e a quantidade de amostras — para a tela juntar várias
 *  horas sem errar a média — e o pico. Zero amostras = a peça não foi medida. */
export type HoraDeUso = {
  agenteId: string;
  /** Dia e hora no relógio DA LOJA. */
  dia: string;
  hora: number;
  amostras: number;
  cpuSoma: number;
  cpuAmostras: number;
  cpuMax: number | null;
  memSoma: number;
  memAmostras: number;
  memMax: number | null;
  gpuSoma: number;
  gpuAmostras: number;
  gpuMax: number | null;
  /** A parte do Farol (o processo do agente) no processador da máquina. */
  farolCpuSoma: number;
  farolCpuAmostras: number;
  farolCpuMax: number | null;
  farolMemMaxMb: number | null;
  discoLivreGb: number | null;
  discoTotalGb: number | null;
};

export type MaquinaDaLoja = {
  id: string;
  nome: string;
  processador: string | null;
  nucleos: number | null;
  memoriaGb: number | null;
  placaDeVideo: string | null;
};

export type Analises = {
  loja: { id: string; nome: string; timezone: string; horario_funcionamento: FaixaDeHorario[] };
  /** O intervalo devolvido, em dias do calendário da loja. */
  de: string;
  ate: string;
  /** Hoje e a hora corrente, na loja. */
  hoje: string;
  horaAgora: number;
  agora: string;
  canais: Array<{ id: string; nome: string; canal: number | null; setor: string; ativo: boolean; excluido: boolean }>;
  criterios: Array<{ id: string; nome: string; tipo: string; ligado: boolean; excluido: boolean }>;
  celulas: CelulaDeAnalise[];
  /** As máquinas da loja e o uso delas nas mesmas horas. */
  maquina?: { agentes: MaquinaDaLoja[]; horas: HoraDeUso[] };
  /** Quantos avisos o intervalo teve; `avisos` traz os mais recentes. */
  totalDeAvisos: number;
  avisos: AvisoDaAnalise[];
};

const analisesGuardadas = new Map<string, { em: number; promessa: Promise<Analises> }>();

export const analisesApi = {
  /** Sem `de` e `ate`, é o dia de hoje na loja. */
  obter(lojaId: string, intervalo: { de: string; ate: string } | null, forcar = false): Promise<Analises> {
    const consulta = intervalo ? `?de=${intervalo.de}&ate=${intervalo.ate}` : '';
    const chave = `${lojaId}${consulta}`;
    const tem = analisesGuardadas.get(chave);
    if (!forcar && tem && Date.now() - tem.em < VALIDADE_MS) return tem.promessa;

    const promessa = pedir<Analises>(`/lojas/${lojaId}/analises${consulta}`);
    analisesGuardadas.set(chave, { em: Date.now(), promessa });
    promessa.catch(() => {
      if (analisesGuardadas.get(chave)?.promessa === promessa) analisesGuardadas.delete(chave);
    });
    return promessa;
  },
};

// ───────────────────────── a conexão com o Regem ─────────────────────────

/** Uma loja autorizada no Regem que ainda espera alguém dizer qual loja do Farol ela é. */
export type LojaDoRegemEsperando = {
  id: string;
  regemLojaNome: string;
  regemEmpresaNome: string;
  autorizadaEm: string;
  /** O par que o servidor sugere pelo nome. Nulo = sem sugestão: a pessoa escolhe. */
  sugestaoLojaId: string | null;
};

/** Em que pé está a leitura das fichas de uma loja ligada. */
export type LeituraDasFichas = {
  /** A última busca que deu certo. Nulo = ainda não conseguiu ler. */
  lidaEm: string | null;
  /** A última tentativa falhou: o que a loja tem é o da última busca boa. */
  falhou: boolean;
  /** Há uma busca em curso agora. */
  lendo: boolean;
  /** O Regem tirou o acesso desta loja: as fichas dela foram apagadas. */
  acessoTiradoEm: string | null;
};

export type LojaDoRegemLigada = {
  id: string;
  lojaId: string;
  lojaNome: string;
  regemLojaNome: string;
  regemEmpresaNome: string;
  ligadaEm: string;
  /** O relógio da loja: é nele que a tela diz "hoje, 04:10". */
  fuso: string;
  leitura: LeituraDasFichas;
  /** O que a base da loja tem. Nulo = ainda não há base (nunca leu, ou foi apagada). */
  produtos: number | null;
  comFicha: number | null;
};

export type ConexaoComORegem = {
  /** A conexão pode ser feita aqui. Falso: o botão de conectar não aparece. */
  disponivel: boolean;
  /** Só a diretoria conecta, liga e desconecta. Quem decide é a API; isto só esconde o botão. */
  podeConectar: boolean;
  /** As lojas do Farol que ainda não têm par. */
  lojasLivres: Array<{ id: string; nome: string }>;
  esperando: LojaDoRegemEsperando[];
  ligadas: LojaDoRegemLigada[];
};

/** Como terminou a volta do Regem. Chega no endereço: `/conexoes?regem=…`. */
export type VoltaDoRegem = 'autorizado' | 'cancelado' | 'vencido' | 'outra_conta' | 'sem_sessao' | 'sem_permissao' | 'invalido' | 'falhou';

export const regemApi = {
  obter: () => pedir<ConexaoComORegem>('/regem'),

  /** Devolve o endereço da página de autorização do Regem: a tela leva a pessoa para lá. */
  conectar: () => pedir<{ url: string }>('/regem/conectar', { method: 'POST' }),

  /** `lojaId` nulo = não usar esta loja: o acesso dela é devolvido ao Regem. */
  ligar: (pares: Array<{ id: string; lojaId: string | null }>) =>
    pedir<{ ligadas: number; descartadas: number; naoDescartadas: Array<{ id: string; regemLojaNome: string }> }>('/regem/lojas', {
      method: 'PUT',
      body: JSON.stringify({ pares }),
    }),

  desconectar: (id: string) =>
    pedir<{ desconectada: true; devolvido: boolean; fichasApagadas: boolean; lojaNome: string | null; regemLojaNome: string }>(
      `/regem/lojas/${id}/desconectar`,
      { method: 'POST' },
    ),
};

// ───────────────────────── as fichas da loja ─────────────────────────

/** A linha da lista: o que o Farol sabe do produto, sem o detalhe. */
export type ProdutoNaLista = {
  id: string;
  nome: string;
  categoria: string | null;
  /** Passa pela cozinha. */
  cozinha: boolean;
  /** Quantos ingredientes a ficha tem. Nulo = sem ficha. */
  ingredientes: number | null;
  /** Quantos produtos o combo junta. Nulo = não é combo. */
  combo: number | null;
  variacoes: number;
  /** Quantas opções o cliente pode pedir a mais ou tirar. */
  adicionais: number;
};

/** O que uma opção muda na montagem. */
export type EfeitoDaOpcao =
  | { tipo: 'observacao' }
  | { tipo: 'insumo'; nome: string; quantidade: number | null; unidade: string | null }
  | { tipo: 'preparo'; nome: string | null }
  | { tipo: 'produto'; nome: string | null }
  | { tipo: 'retira'; nome: string }
  | { tipo: 'nada' };

export type ProdutoDaFicha = {
  id: string;
  nome: string;
  categoria: string | null;
  tipo: 'simples' | 'variavel' | 'combo';
  cozinha: boolean;
  setor: string | null;
  preparoMin: number | null;
  ficha: null | {
    id: string;
    nome: string;
    /** Na ordem em que foi cadastrada; `preparo` = um preparo da casa, que entra como um ingrediente só. */
    ingredientes: Array<{ nome: string; quantidade: number | null; unidade: string | null; preparo: boolean }>;
  };
  /** `fator`: quanto da ficha a variação usa. */
  variacoes: Array<{ nome: string; codigo: string | null; fator: number }>;
  combo: Array<{ produtoId: string; nome: string | null; quantidade: number }>;
  adicionais: Array<{ nome: string; tipo: 'adicionar' | 'remover'; opcoes: Array<{ id: string | null; nome: string; efeito: EfeitoDaOpcao }> }>;
};

export type FichasDaLoja = {
  /** `sem_conexao`, `falta_ligar` (o Regem autorizou, falta dizer qual loja é esta), `acesso_tirado` ou `ligada`. */
  situacao: 'sem_conexao' | 'falta_ligar' | 'acesso_tirado' | 'ligada';
  /** Só a diretoria conecta e liga. Quem decide é a API; isto só escolhe entre o botão e a frase. */
  podeConectar: boolean;
  /** Quem configura a loja pede a busca na hora; a supervisão só vê. Quem decide é a API. */
  podeBuscar: boolean;
  /** Quem configura importa planilha — na loja que não recebe as fichas de outro lugar (uma origem por loja). */
  podeImportar: boolean;
  /** De onde as fichas vieram. Nulo = a loja não tem fichas guardadas. */
  fonte: 'regem' | 'planilha' | 'sistema' | null;
  /** O sistema que tem acesso para enviar as fichas desta loja (pode ainda não ter enviado nada). Nulo = nenhum. */
  sistema: {
    nome: string;
    criadoEm: string;
    recebidoEm: string | null;
    /** Vencido e suspenso não apagam as fichas: a tela avisa, e as do último envio continuam valendo. */
    situacao: SituacaoDoAcesso;
    venceEm: string;
    ultimoUsoEm: string | null;
  } | null;
  /**
   * A última importação por planilha — ou o último envio do outro sistema (aí `arquivo` vem vazio e `por` é o
   * nome do sistema). Só quando a origem é `planilha` ou `sistema`.
   */
  importacao: { arquivo: string; em: string; por: string; deFora: number; quais: string[]; problemas: number } | null;
  regemLojaNome: string | null;
  leitura: LeituraDasFichas | null;
  totais: { produtos: number; comFicha: number } | null;
  produtos: ProdutoNaLista[];
};

// ───────────────────────── as fichas por planilha ─────────────────────────

/** Um problema da planilha: onde está e o que fazer. */
export type ProblemaDaPlanilha = { aba: string; linha: number; texto: string; corrigir: string };
/** Um problema do envio de outro sistema: onde está, no que foi enviado (`produtos[1].ingredientes[2]`). */
export type ProblemaDoEnvio = { onde: string; texto: string };
/** Um produto que ficou de fora, com o motivo de cada linha (da planilha) ou de cada item (do envio). */
export type ProdutoDeFora<P = ProblemaDaPlanilha> = { produto: string; problemas: P[] };

/** O registro do que ficou de fora na última importação (planilha) ou no último envio (outro sistema). */
export type RegistroDoQueFicouDeFora = { arquivo: string; em: string; por: string; problemas: number } & (
  | { origem: 'planilha'; deFora: ProdutoDeFora[]; soltos: ProblemaDaPlanilha[] }
  | { origem: 'sistema'; deFora: Array<ProdutoDeFora<ProblemaDoEnvio>>; soltos: ProblemaDoEnvio[] }
);

/** O que a conferência (ou a importação) diz da planilha. */
export type RelatorioDaPlanilha = {
  contas: { produtos: number; comFicha: number; ingredientes: number; variacoes: number; adicionais: number; combos: number };
  /** Os produtos que entram sem ficha (não é problema). */
  semFicha: string[];
  deFora: ProdutoDeFora[];
  /** Os problemas que não são de um produto. */
  soltos: ProblemaDaPlanilha[];
  /** Quantos problemas ao todo (a lista pode vir cortada). */
  problemas: number;
};

export type ConferenciaDaPlanilha = RelatorioDaPlanilha & {
  gravado: boolean;
  resultado?: 'atualizada' | 'nada_mudou';
  /** O que a loja tem hoje e seria trocado. Nulo = não tem nada. */
  troca: { produtos: number; comFicha: number } | null;
};

/** O modelo, como o servidor o lê: as abas com os títulos e um exemplo. */
export type ModeloDaPlanilha = {
  abas: Record<'fichas' | 'variacoes' | 'adicionais' | 'combos', Array<Array<string | number>>>;
  nomes: Record<'fichas' | 'variacoes' | 'adicionais' | 'combos', string>;
  colunas: Record<'fichas' | 'variacoes' | 'adicionais' | 'combos', string[]>;
  unidades: string[];
};

export const fichasApi = {
  obter: (lojaId: string) => pedir<FichasDaLoja>(`/lojas/${lojaId}/fichas`),

  produto: (lojaId: string, produtoId: string) => pedir<ProdutoDaFicha>(`/lojas/${lojaId}/fichas/produtos/${produtoId}`),

  /** Pede uma leitura na hora. `nada_mudou`: o que a loja tinha continua valendo. */
  buscar: (lojaId: string) =>
    pedir<{ resultado: 'atualizada' | 'nada_mudou'; produtos: number; comFicha: number }>(`/lojas/${lojaId}/fichas/buscar`, { method: 'POST' }),

  /** O modelo da planilha (as abas, os títulos, as unidades e um exemplo). */
  modelo: () => pedir<ModeloDaPlanilha>('/fichas/modelo'),

  /** Confere a planilha sem gravar: o que entraria e o que ficaria de fora. */
  conferir: (lojaId: string, arquivo: string, abas: unknown) =>
    pedir<ConferenciaDaPlanilha>(`/lojas/${lojaId}/fichas/importar`, { method: 'POST', body: JSON.stringify({ arquivo, abas }) }),

  /** Importa o que está certo: a base da loja é trocada inteira. */
  importar: (lojaId: string, arquivo: string, abas: unknown) =>
    pedir<ConferenciaDaPlanilha>(`/lojas/${lojaId}/fichas/importar`, { method: 'POST', body: JSON.stringify({ arquivo, abas, gravar: true }) }),

  /** O registro da última importação (ou do último envio de outro sistema), com a lista do que ficou de fora. */
  importacao: (lojaId: string) => pedir<RegistroDoQueFicouDeFora>(`/lojas/${lojaId}/fichas/importacao`),

  /** As fichas da loja de volta em planilha, no modelo. */
  planilha: (lojaId: string) => pedir<Pick<ModeloDaPlanilha, 'abas' | 'nomes'>>(`/lojas/${lojaId}/fichas/planilha`),
};

// ───────────────── os ingredientes e as fotos de referência (A21) ─────────────────

export type FotoDoIngrediente = { id: string; largura: number | null; altura: number | null; legenda: string | null; criadoEm: string };

export type IngredienteDaLoja = {
  nome: string;
  /** Onde ele entra: pela ficha, ou por um adicional do produto. */
  produtos: Array<{ produtoId: string; produto: string; adicional: boolean }>;
  /** Nulo = nada guardado ainda (nem foto, nem "não se vê de cima"). */
  itemId: string | null;
  /** Falso = "não se vê de cima": o Farol não espera vê-lo na bancada. */
  visivel: boolean;
  fotos: FotoDoIngrediente[];
  /** Os recortes que a conferência do treinamento guarda (fatias T4 e T5). */
  exemplos: number;
};

export type IngredientesDaLoja = {
  limiteDeFotos: number;
  /** Tirar foto, "não se vê", juntar e apagar. Quem decide é a API; isto só escolhe entre o botão e a frase. */
  podeConfigurar: boolean;
  ingredientes: IngredienteDaLoja[];
  /** Os que saíram das fichas e ainda têm foto: esperam alguém juntar ao nome novo, ou apagar. */
  orfaos: Array<{ itemId: string; nome: string; fotos: FotoDoIngrediente[]; exemplos: number }>;
};

export const ingredientesApi = {
  listar: (lojaId: string) => pedir<IngredientesDaLoja>(`/lojas/${lojaId}/ingredientes`),

  /** Uma foto mandada daqui, já reduzida e em JPEG. O nome que fica é o da ficha. */
  mandarFoto: (lojaId: string, nome: string, imagemBase64: string) =>
    pedir<{ fotoId: string; itemId: string; nome: string }>(`/lojas/${lojaId}/ingredientes/fotos`, {
      method: 'POST',
      body: JSON.stringify({ nome, imagemBase64 }),
    }),

  /** A imagem de uma foto. O id nunca muda de imagem: o navegador guarda. */
  urlDaFoto: (fotoId: string) => `/api/base/fotos/${fotoId}/imagem`,

  tirarFoto: (fotoId: string) => pedir<{ excluida: true; itemId: string }>(`/base/fotos/${fotoId}`, { method: 'DELETE' }),

  /** "Não se vê de cima" (falso) ou de volta (verdadeiro). */
  visivel: (lojaId: string, nome: string, visivel: boolean) =>
    pedir<{ nome: string; itemId: string; visivel: boolean }>(`/lojas/${lojaId}/ingredientes/visivel`, {
      method: 'PUT',
      body: JSON.stringify({ nome, visivel }),
    }),

  /** As fotos do órfão passam para um ingrediente das fichas. Passando do máximo, a API recusa e diz quantas tirar. */
  juntar: (itemId: string, para: string) =>
    pedir<{ itemId: string; nome: string; de: string; movidas: number }>(`/base/itens/${itemId}/juntar`, {
      method: 'POST',
      body: JSON.stringify({ para }),
    }),

  /** O órfão e as fotos dele saem de vez. */
  apagar: (itemId: string) => pedir<{ excluido: true; nome: string; quadros: number }>(`/base/itens/${itemId}`, { method: 'DELETE' }),
};

// ───────────────── o treinamento da bancada (A21, fatia T4) ─────────────────

export type LadoDaEtapa = 'pao' | 'tampo' | 'base' | 'outro';
export type MotivoNaFila = 'coberto' | 'duvida' | 'diferenca' | 'certo';

export type EtapaDoLanche = {
  hora: string;
  lado: LadoDaEtapa;
  /** O que a metade já tinha quando apareceu. */
  inicio: boolean;
  /** O que a leitura da loja disse ("molho laranja"). Nulo = não deu para ver. */
  leu: string | null;
  /** Os nomes das fichas que a leitura acha possíveis: um = específico; vários = um grupo; nenhum = não sei. */
  candidatos: string[];
  vezes: number;
  quadro: number | null;
  quadroId: string | null;
};

export type PalpiteDaFicha = { produtoId: string; produto: string; batem: number; total: number; fora: number };

export type LancheNaFila = {
  id: string;
  gravacaoId: string;
  abertoEm: string | null;
  fechouEm: string | null;
  situacao: 'conferir' | 'conferido' | 'pulado';
  motivo: MotivoNaFila;
  palpite: PalpiteDaFicha | null;
  produto: string | null;
  acertou: boolean | null;
  conferidoEm: string | null;
  conferidoPor: string | null;
  miniaturas: { tampo: string | null; base: string | null };
  etapas: number;
};

export type GravacaoDeTreino = {
  id: string;
  chave: string;
  inicio: string;
  fim: string;
  origem: 'gravador' | 'programada' | 'carga';
  situacao: 'programada' | 'fila' | 'lendo' | 'pronta' | 'apagada' | 'cancelada' | 'falhou';
  progresso: number | null;
  apagadaEm: string | null;
  canal: { nome: string; numero: number | null } | null;
  lanches: number;
  conferidos: number;
  pulados: number;
  acertou: number;
};

export type TreinoDaLoja = {
  podeConfigurar: boolean;
  /** A meta aprovada: o lanche certo em `acerto` (0,9) dos conferidos, com pelo menos `minimo` (30). */
  meta: { acerto: number; minimo: number };
  diasDosQuadros: number;
  gravacoes: GravacaoDeTreino[];
  lanches: LancheNaFila[];
  /** Sobre TODOS os conferidos (a lista traz os mais novos). */
  contas: { conferidos: number; acertou: number };
  /** Por ingrediente, nos conferidos: em quantos estava, e em quantos a leitura o reconheceu antes da conferência. */
  aprendizado: Record<string, { presente: number; reconheceu: number }>;
};

/** Nulo = sem resposta (a etapa não ensina). `nome`: o que era, no "outro"; a API devolve nulo nos demais. */
export type RespostaDaEtapa = { v: 'certo' | 'outro' | 'nada'; nome?: string | null } | null;
export type ConferenciaDoLanche = {
  produto: string | null;
  etapas: RespostaDaEtapa[];
  faltas: Record<string, 'cliente' | 'faltou' | 'naoviu'>;
  aMais: Record<string, 'adicional' | 'amais'>;
};

export type LancheParaConferir = Omit<LancheNaFila, 'etapas'> & {
  gravacao: { id: string; inicio: string; fim: string; origem: GravacaoDeTreino['origem'] };
  etapas: EtapaDoLanche[];
  palpites: PalpiteDaFicha[];
  resposta: ConferenciaDoLanche | null;
  produtos: Array<{ id: string; nome: string }>;
  ingredientes: string[];
  /** As chaves (nome sem maiúscula) do que "não se vê de cima". */
  naoSeVe: string[];
};

export const treinoApi = {
  daLoja: (lojaId: string) => pedir<TreinoDaLoja>(`/lojas/${lojaId}/treino`),

  lanche: (id: string) => pedir<LancheParaConferir>(`/treino/lanches/${id}`),

  /** O quadro de uma etapa. O id nunca muda de imagem: o navegador guarda. */
  urlDoQuadro: (quadroId: string) => `/api/treino/quadros/${quadroId}/imagem`,

  conferir: (id: string, conferencia: ConferenciaDoLanche) =>
    pedir<{ conferido: true; produto: string | null; palpite: string | null; acertou: boolean; exemplos: number }>(`/treino/lanches/${id}/conferencia`, {
      method: 'POST',
      body: JSON.stringify(conferencia),
    }),

  pular: (id: string) => pedir<{ pulado: true }>(`/treino/lanches/${id}/pular`, { method: 'POST' }),
};

// ───────────────────────── o acesso de outro sistema ─────────────────────────

/** De onde uma loja recebe as fichas: só a livre e a de planilha podem ganhar um acesso. */
export type OrigemDaLoja = 'livre' | 'planilha' | 'regem' | 'sistema';

/** O acesso que deixa um sistema enviar as fichas de UMA loja. O código dele não vem aqui: aparece só ao criar. */
export type AcessoDeOutroSistema = {
  id: string;
  /** Como a conta chama o sistema. */
  nome: string;
  lojaId: string;
  lojaNome: string;
  /** O relógio da loja: é nele que a tela diz "hoje, 14:02". */
  fuso: string | null;
  criadoEm: string;
  /** O último envio que o Farol aceitou. Nulo = o sistema ainda não enviou nada. */
  recebidoEm: string | null;
  /** O que a loja tem DESTE sistema. Nulo = ainda nada. */
  produtos: number | null;
  comFicha: number | null;
  /** Quem criou (o nome de agora; nulo se a pessoa foi apagada). */
  criadoPor: string | null;
  /** `vence` = nos 15 dias antes de vencer; `suspenso` = 90 dias sem uso. Vencido e suspenso não apagam as fichas. */
  situacao: SituacaoDoAcesso;
  /** Até quando o código de agora vale. */
  venceEm: string;
  /** A última chamada aceita na porta. */
  ultimoUsoEm: string | null;
  renovadoEm: string | null;
  /** Renovado há pouco: até quando o código de antes ainda vale. Nulo = não há código antigo valendo. */
  anteriorValeAte: string | null;
};

export type SituacaoDoAcesso = 'valendo' | 'vence' | 'vencido' | 'suspenso';

/** O que os outros da diretoria fizeram nos acessos e quem olha ainda não viu. */
export type AvisoDeAcesso = { acao: 'criou' | 'renovou' | 'reativou' | 'revogou'; em: string; por: string; sistema: string; loja: string; anteriorValeAte: string | null };

export type AcessosDaConta = {
  /** Só a diretoria cria, renova, reativa e revoga. Quem decide é a API; isto só escolhe entre o botão e a frase. */
  podeCriar: boolean;
  /** No máximo 10 acessos valendo por conta: no teto, a tela troca o botão pelo aviso. */
  teto: { maximo: number; ativos: number };
  /** O termo de uso que quem cria aceita: o texto e a versão vêm da API. */
  termo: { versao: string; de: string; itens: string[] };
  avisos: AvisoDeAcesso[];
  acessos: AcessoDeOutroSistema[];
  lojas: Array<{ id: string; nome: string; origem: OrigemDaLoja }>;
};

/** A resposta de quem criou: é a ÚNICA vez em que o código aparece. */
export type AcessoCriado = { id: string; nome: string; lojaId: string; lojaNome: string; criadoEm: string; venceEm: string; codigo: string; temPlanilha: boolean };

/** A resposta de quem renovou: o código novo aparece aqui, uma vez. `anteriorValeAte` nulo = o antigo já tinha vencido. */
export type AcessoRenovado = { id: string; nome: string; lojaNome: string; codigo: string; venceEm: string; anteriorValeAte: string | null };

export const acessosApi = {
  obter: () => pedir<AcessosDaConta>('/acessos'),

  /** Pede a senha de quem cria e o aceite do termo, na versão que a tela mostrou. */
  criar: (nome: string, lojaId: string, senha: string, termoVersao: string) =>
    pedir<AcessoCriado>('/acessos', { method: 'POST', body: JSON.stringify({ nome, lojaId, senha, termoVersao }) }),

  /** Sai um código novo; o de antes vale mais 7 dias (se ainda não venceu). */
  renovar: (id: string, senha: string) => pedir<AcessoRenovado>(`/acessos/${id}/renovar`, { method: 'POST', body: JSON.stringify({ senha }) }),

  /** O suspenso volta a valer com o mesmo código. */
  reativar: (id: string) => pedir<{ reativado: true }>(`/acessos/${id}/reativar`, { method: 'POST' }),

  /** "Entendi" no aviso do que os outros da diretoria fizeram. */
  avisosVistos: () => pedir<{ visto: true }>('/acessos/avisos/vistos', { method: 'POST' }),

  /** Vale na hora: o sistema deixa de conseguir enviar, e as fichas que ele mandou são apagadas. */
  revogar: (id: string) => pedir<{ revogado: true; fichasApagadas: boolean }>(`/acessos/${id}`, { method: 'DELETE' }),
};
