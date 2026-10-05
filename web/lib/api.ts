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
