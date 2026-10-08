/**
 * Cliente da API, do lado do navegador.
 *
 * Tudo sai para `/api/...` do próprio domínio; o Next repassa para a API
 * pela rede interna. `credentials: 'same-origin'` é o que leva o cookie
 * de sessão — e, por ser do mesmo domínio, não há CORS no caminho.
 */

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
  zonas: Zona[];
};

export type Importancia = 'critico' | 'normal' | 'baixo';

/** Uma área dentro do canal. `principal` é o corte DO CANAL: marcar o
 *  canal na árvore de critérios é marcar esta área. */
export type Zona = { id: string; nome: string; principal?: boolean };

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
};

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
  quando: Quando;
  parametros: ParametrosDoDetector;
};

export type ZonaCompleta = {
  id: string;
  ponto_id: string;
  nome: string;
  poligono: [number, number][];
  principal: boolean;
  largura_cena_cm: string | number | null;
  /** Os critérios que valem NESTA área. Um canal pode ter mais de uma, e
   *  cada uma tem os seus. */
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

  salvarArea: (zonaId: string, dados: Partial<ZonaCompleta> & {
    poligono?: [number, number][];
    larguraCenaCm?: number | null;
    principal?: boolean;
  }) =>
    pedir<Omit<ZonaCompleta, 'criterios'>>(`/zonas/${zonaId}`, {
      method: 'PATCH',
      body: JSON.stringify(dados),
    }),

  /** Mais uma área no mesmo canal. Sem desenho, nasce no meio do quadro. */
  criarArea: (pontoId: string, dados: { nome: string; poligono?: [number, number][] }) =>
    pedir<ZonaCompleta>(`/pontos/${pontoId}/zonas`, { method: 'POST', body: JSON.stringify(dados) }),

  /** Exclui a área. Os critérios dela saem deste canal; o histórico fica. */
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
  criterios: { total: number; ligados: number };
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
