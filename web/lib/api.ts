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
    r = await fetch(`/api${caminho}`, {
      ...opcoes,
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', ...(opcoes.headers ?? {}) },
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
    throw new ErroDaApi(
      r.status,
      String(corpo.erro ?? 'desconhecido'),
      String(corpo.mensagem ?? 'não deu certo'),
    );
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
  zonas: Zona[];
};

export type Zona = { id: string; nome: string };

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
  zona_id: string;
  zona_nome: string;
  ponto_id: string;
  ponto_nome: string;
  canal: number | null;
  setor_nome: string;
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

  loja: (id: string) => pedir<{ loja: Loja; setores: Setor[] }>(`/lojas/${id}`),

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

  desativarPonto: (id: string) =>
    pedir<{ id: string; ativo: boolean }>(`/pontos/${id}`, { method: 'DELETE' }),
};

export const regrasApi = {
  listar: (lojaId: string) => pedir<{ regras: Regra[] }>(`/lojas/${lojaId}/regras`),

  criar: (zonaId: string, dados: Record<string, unknown>) =>
    pedir<Regra & { aviso: string }>(`/zonas/${zonaId}/regras`, {
      method: 'POST',
      body: JSON.stringify(dados),
    }),

  editar: (id: string, dados: Record<string, unknown>) =>
    pedir<Regra>(`/regras/${id}`, { method: 'PATCH', body: JSON.stringify(dados) }),
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
  fabricante: string | null;
  ativo: boolean;
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
