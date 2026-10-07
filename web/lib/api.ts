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
  pedido: {
    id: string;
    estado: 'pendente' | 'entregue' | 'concluido' | 'falhou' | 'expirado';
    erro: string | null;
    criadoEm: string;
    concluidoEm: string | null;
  } | null;
};

export type ZonaCompleta = {
  id: string;
  ponto_id: string;
  nome: string;
  poligono: [number, number][];
  principal: boolean;
  largura_cena_cm: string | number | null;
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
    pedir<ZonaCompleta>(`/zonas/${zonaId}`, {
      method: 'PATCH',
      body: JSON.stringify(dados),
    }),
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
