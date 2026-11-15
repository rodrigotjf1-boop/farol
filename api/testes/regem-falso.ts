// =====================================================================
// O Regem, para o teste — um servidor de verdade
// =====================================================================
// Não é um dublê de função: é um servidor HTTP que o cliente do Farol
// chama pela rede, como chama o Regem. O que ele recusa é o que o Regem
// recusa, na mesma ordem e com o mesmo formato (`application/problem+json`),
// copiado do serviço de lá (`autorizacao-loja.service.ts`, `trocar`, e
// `integracao-token.service.ts`, `revogarPelaIntegracao`):
//
//   • a troca confere PRIMEIRO o cliente e o segredo (401 cliente-invalido);
//   • depois o formato do código; depois GASTA o código — e só então confere
//     o endereço de volta e o PKCE. Tentativa que falha depois de gastar
//     também gasta (400 autorizacao-invalida, a mesma frase em todo caso);
//   • a loja que já tinha acesso deste cliente troca: o antigo deixa de valer;
//   • devolver um acesso que não vale é 401 token-invalido.
//
// O AVISO (`webhook-integracao.service.ts` e `webhook-integracao.ts`, de lá):
//
//   • `PUT /integracao/webhook` confere, nesta ordem: o acesso (401); o
//     corpo, só com "url" e "segredo" (400); se o cliente TEM aviso
//     habilitado (422); se o endereço está dentro da base permitida, com um
//     trecho só depois dela (422); o formato do segredo (400). Aceito: 200;
//   • o aviso sai assinado como lá: `v1,` + HMAC-SHA256 (base64) de
//     `id.timestamp.corpo`, com a chave que vem depois de `whsec_`;
//   • acesso devolvido ou trocado leva o registro junto.
//
// O CLIQUE do Padrão DMS (F6 do Hub DMS, 15/11/2026; `autorizacao-clique`
// de lá), com um DMS ID de mentira no mesmo servidor (`/dmsid/oidc/token`):
//
//   • o pedido empurrado e a troca conferem PRIMEIRO o token do DMS ID do
//     aplicativo (401 token-invalido); o pedido confere os campos (400) e
//     devolve o número (201); a troca devolve a LIGAÇÃO de cada loja;
//   • pela ligação, o token do DMS ID vem antes: recusado, 401
//     token-invalido; a ligação que não vale (tirada, trocada), 401
//     ligacao-invalida.
//
// Arquivo de apoio: não termina em `.test.ts`, então o corredor de testes
// não o trata como teste.
// =====================================================================

import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export type LojaDeLa = { id: string; nome: string };

type Autorizacao = {
  lojas: LojaDeLa[];
  empresa: string;
  desafio: string;
  redirectUri: string;
  usado: boolean;
  vencido: boolean;
  /** Por onde o código nasceu: a página de 01/10 ou o clique. Cada troca só aceita o seu. */
  via: 'chave' | 'clique';
};

export type Chamada = {
  caminho: string;
  agente: string;
  tipo: string | null;
  comAcesso: boolean;
  corpo: Record<string, unknown> | null;
};

export type RegemFalso = {
  /** O que vai em `apiUrl`: já com o prefixo, como o de verdade. */
  url: string;
  segredo: string;
  /** O que a página de lá faz quando o presidente autoriza: devolve o código de uso único. */
  autorizar(p: { lojas: LojaDeLa[]; empresa?: string; desafio: string; redirectUri: string; vencido?: boolean }): string;
  /** O acesso ainda vale lá? */
  vale(acesso: string): boolean;
  /** Tira um acesso por lá — o presidente em "Aplicativos conectados". */
  tirar(acesso: string): void;
  /** O mesmo, por loja: tira todo acesso que aquela loja de lá tiver. */
  tirarDaLoja(lojaId: string): void;
  /** Todo acesso que já saiu daqui, valendo ou não: para o teste procurar onde ele NÃO pode estar. */
  emitidos: string[];
  chamadas: Chamada[];
  /**
   * normal    responde como o Regem;
   * fora      503 em tudo;
   * mudo      aceita a conexão e não responde (para o prazo do cliente);
   * devagar   429 em tudo;
   * proibido  403 em tudo (uma recusa que não é "o acesso não vale");
   * desvia    302 para outro caminho deste mesmo servidor;
   * pagina    200 com uma página, não com JSON;
   * ou uma função que monta a resposta da TROCA (para o que foge do contrato).
   */
  modo: 'normal' | 'fora' | 'mudo' | 'devagar' | 'proibido' | 'desvia' | 'pagina' | ((lojas: unknown[]) => unknown);
  /**
   * O cardápio e as fichas que uma loja de lá responde nas LEITURAS. Sem
   * nada definido, toda loja responde a amostra de verdade
   * (`contratos/regem-catalogo-e-fichas.json`).
   */
  cardapio(lojaId: string, c: Cardapio): void;
  /** A amostra de verdade, para o teste montar variações dela. */
  amostra: Cardapio;
  /** Estraga a resposta de uma leitura (para o que foge do contrato). Nulo = responde certo. */
  leituraTorta: null | ((qual: 'catalogo' | 'fichas' | 'producao', corpo: Record<string, unknown>) => unknown);
  /**
   * A fila da cozinha que uma loja de lá responde em `GET /integracao/producao`:
   * os pedidos, no formato de lá. Sem nada definido, a fila está vazia.
   */
  fila(lojaId: string, pedidos: unknown[]): void;
  /** A autorização não inclui a fila (o escopo `producao.ler`): a fila responde 403, e o cardápio e as fichas seguem. */
  filaSemEscopo: boolean;
  /** Segura as respostas das leituras até `soltar()`: o teste mexe no meio de uma leitura. */
  segurar(): void;
  soltar(): void;
  /** Quantas leituras estão paradas esperando o `soltar()`. */
  seguradas(): number;
  /**
   * O aviso. `base`: o endereço dentro do qual o Farol pode pedir aviso —
   * `null` = o Regem ainda não aceita aviso para o Farol (422), que é como
   * todo teste começa. `pedidos`: o que chegou em `/integracao/webhook`
   * (fica FORA de `chamadas`, para os testes de antes contarem o que já
   * contavam).
   */
  avisos: {
    base: string | null;
    pedidos: Array<{ metodo: string; comAcesso: boolean; corpo: Record<string, unknown> | null; status: number }>;
    /** O registro que a loja de lá tem agora (o do acesso que vale), ou `null`. */
    registroDe(lojaId: string): { url: string; segredo: string } | null;
    /**
     * O aviso que o Regem mandaria agora a essa loja: o endereço, os
     * cabeçalhos e o corpo, assinados como lá. `null` se não há registro.
     */
    montar(lojaId: string, opcoes?: { tipo?: string; agora?: Date; segredo?: string }): { url: string; cabecalhos: Record<string, string>; corpo: string } | null;
  };
  /** O DMS ID de mentira (o aplicativo do Farol). `recusarTokens`: o Regem recusa todo token dele, mesmo o pedido de novo. */
  dmsId: { emissor: string; aplicativo: string; segredo: string; recusarTokens: boolean };
  /** Os pedidos empurrados pelo clique, com o número que o Regem deu. */
  pedidosDoClique: Array<{ numero: string; corpo: Record<string, unknown> }>;
  /** O que a página de lá faz no clique: o presidente autoriza o pedido `numero`. Devolve o código de uso único. */
  autorizarPeloClique(p: { numero: string; lojas: LojaDeLa[]; empresa?: string }): string;
  /** Os caminhos chamados pela ligação (o token do DMS ID e a ligação valendo), na ordem. */
  pelaLigacao: string[];
  fechar(): Promise<void>;
};

/** A assinatura, como o Regem faz (`assinarAviso` e `chaveDoSegredo`, de lá). */
export function assinarComoORegem(segredo: string, id: string, timestampSeg: number, corpo: string): string {
  const chave = Buffer.from(segredo.slice('whsec_'.length), 'base64');
  return `v1,${createHmac('sha256', chave).update(`${id}.${timestampSeg}.${corpo}`).digest('base64')}`;
}

/** O que uma loja responde em `GET /integracao/catalogo` e `GET /integracao/fichas`, sem a versão. */
export type Cardapio = {
  categorias: unknown[];
  setores: unknown[];
  produtos: unknown[];
  fichas: unknown[];
};

const FORMATO_CODIGO = /^rgm_ac_[A-Za-z0-9_-]{43}$/;
const FORMATO_VERIFICADOR = /^[A-Za-z0-9\-._~]{43,128}$/;
const BASE = 'https://api.dmsregem.com/problemas/';

export async function subirRegemFalso(): Promise<RegemFalso> {
  const segredo = randomBytes(32).toString('base64url');
  const codigos = new Map<string, Autorizacao>();
  /** Os tokens que o DMS ID de mentira deu ao aplicativo do Farol. */
  const tokensDoDmsId = new Set<string>();
  /** número do pedido empurrado → o que ele pediu */
  const pedidosEmpurrados = new Map<string, { desafio: string; redirectUri: string }>();
  /** acesso → loja de lá */
  const acessos = new Map<string, string>();
  const chamadas: Chamada[] = [];
  const emitidos: string[] = [];
  const presos = new Set<http.ServerResponse>();

  // A resposta DE VERDADE do Regem (gravada de uma chamada ao servidor dele),
  // sem a versão e a hora: é o que toda loja responde até o teste dizer outra coisa.
  const real = JSON.parse(readFileSync(new URL('../../contratos/regem-catalogo-e-fichas.json', import.meta.url), 'utf8')) as {
    catalogo: Cardapio;
    fichas: { fichas: unknown[] };
  };
  const amostra: Cardapio = {
    categorias: real.catalogo.categorias,
    setores: real.catalogo.setores,
    produtos: real.catalogo.produtos,
    fichas: real.fichas.fichas,
  };
  const cardapios = new Map<string, Cardapio>();
  const filas = new Map<string, unknown[]>();
  let segurando = false;
  const esperando: Array<() => void> = [];
  /** acesso → o registro do aviso dele */
  const registros = new Map<string, { url: string; segredo: string }>();
  /** O formato do segredo, como lá: `whsec_` + base64 de 24 a 64 bytes, sem lixo no meio. */
  const segredoServe = (v: unknown): v is string => {
    if (typeof v !== 'string' || !v.startsWith('whsec_') || v.length > 200) return false;
    const b64 = v.slice('whsec_'.length);
    const chave = Buffer.from(b64, 'base64');
    const semEnchimento = (t: string) => t.replace(/=+$/, '');
    return semEnchimento(chave.toString('base64')) === semEnchimento(b64) && chave.length >= 24 && chave.length <= 64;
  };
  /** O endereço está DENTRO da base, com um trecho só depois dela — como `enderecoPermitido`, de lá. */
  const enderecoServe = (v: unknown, base: string): v is string => {
    if (typeof v !== 'string' || !v.length || v.length > 500) return false;
    let u: URL;
    try {
      u = new URL(v);
    } catch {
      return false;
    }
    const b = new URL(base);
    if (u.username || u.password || u.search || u.hash) return false;
    if (u.protocol !== b.protocol || u.host !== b.host || !u.pathname.startsWith(b.pathname)) return false;
    return /^[A-Za-z0-9_-]{1,64}$/.test(u.pathname.slice(b.pathname.length));
  };

  const problema = (r: http.ServerResponse, status: number, tipo: string, titulo: string, detalhe: string) => {
    r.writeHead(status, { 'content-type': 'application/problem+json; charset=utf-8' });
    r.end(JSON.stringify({ type: BASE + tipo, title: titulo, status, detail: detalhe, request_id: randomUUID() }));
  };
  const json = (r: http.ServerResponse, status: number, corpo: unknown) => {
    r.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    r.end(JSON.stringify(corpo));
  };

  const falso: RegemFalso = {
    url: '',
    segredo,
    chamadas,
    emitidos,
    modo: 'normal',
    autorizar(p) {
      const codigo = `rgm_ac_${randomBytes(32).toString('base64url')}`;
      codigos.set(codigo, {
        lojas: p.lojas,
        empresa: p.empresa ?? 'Casa do Lanche Alimentação Ltda',
        desafio: p.desafio,
        redirectUri: p.redirectUri,
        usado: false,
        vencido: p.vencido === true,
        via: 'chave',
      });
      return codigo;
    },
    dmsId: { emissor: '', aplicativo: 'aplicativo-farol-de-teste', segredo: 'valor-do-aplicativo-farol-1234567890', recusarTokens: false },
    pedidosDoClique: [],
    pelaLigacao: [],
    autorizarPeloClique(p) {
      const pedido = pedidosEmpurrados.get(p.numero);
      if (!pedido) throw new Error('regem-falso: este pedido não foi empurrado');
      const codigo = `rgm_ac_${randomBytes(32).toString('base64url')}`;
      codigos.set(codigo, {
        lojas: p.lojas,
        empresa: p.empresa ?? 'Casa do Lanche Alimentação Ltda',
        desafio: pedido.desafio,
        redirectUri: pedido.redirectUri,
        usado: false,
        vencido: false,
        via: 'clique',
      });
      return codigo;
    },
    vale: (acesso) => acessos.has(acesso),
    tirar: (acesso) => {
      acessos.delete(acesso);
      registros.delete(acesso);
    },
    tirarDaLoja: (lojaId) => {
      for (const [acesso, loja] of acessos) {
        if (loja.toLowerCase() !== lojaId.toLowerCase()) continue;
        acessos.delete(acesso);
        registros.delete(acesso);
      }
    },
    avisos: {
      base: null,
      pedidos: [],
      registroDe: (lojaId) => {
        for (const [acesso, loja] of acessos) if (loja.toLowerCase() === lojaId.toLowerCase()) return registros.get(acesso) ?? null;
        return null;
      },
      montar: (lojaId, opcoes = {}) => {
        const registro = falso.avisos.registroDe(lojaId);
        if (!registro) return null;
        const corpo = JSON.stringify({ tipo: opcoes.tipo ?? 'fichas.alterado', loja_id: lojaId });
        const id = randomUUID();
        const ts = Math.floor((opcoes.agora ?? new Date()).getTime() / 1000);
        return {
          url: registro.url,
          cabecalhos: {
            'content-type': 'application/json',
            'user-agent': 'Regem-Integracao/1',
            'webhook-id': id,
            'webhook-timestamp': String(ts),
            'webhook-signature': assinarComoORegem(opcoes.segredo ?? registro.segredo, id, ts, corpo),
          },
          corpo,
        };
      },
    },
    cardapio: (lojaId, c) => void cardapios.set(lojaId.toLowerCase(), c),
    amostra,
    leituraTorta: null,
    fila: (lojaId, pedidos) => void filas.set(lojaId.toLowerCase(), pedidos),
    filaSemEscopo: false,
    segurar: () => void (segurando = true),
    soltar: () => {
      segurando = false;
      for (const seguir of esperando.splice(0)) seguir();
    },
    seguradas: () => esperando.length,
    fechar: () =>
      new Promise((ok) => {
        for (const r of presos) r.destroy();
        servidor.close(() => ok());
        servidor.closeAllConnections();
      }),
  };

  const servidor = http.createServer((req, res) => {
    const pedacos: Buffer[] = [];
    req.on('data', (p: Buffer) => pedacos.push(p));
    req.on('end', () => {
      const texto = Buffer.concat(pedacos).toString('utf8');
      let corpo: Record<string, unknown> | null = null;
      try {
        corpo = texto ? (JSON.parse(texto) as Record<string, unknown>) : null;
      } catch {
        corpo = null;
      }
      // ── o DMS ID de mentira: o token do aplicativo do Farol (client credentials) ──
      if ((req.url ?? '').startsWith('/dmsid/oidc/token')) {
        const d = falso.dmsId;
        const esperado = `Basic ${Buffer.from(`${encodeURIComponent(d.aplicativo)}:${encodeURIComponent(d.segredo)}`).toString('base64')}`;
        const form = new URLSearchParams(texto);
        if (req.method !== 'POST' || req.headers.authorization !== esperado || form.get('grant_type') !== 'client_credentials') {
          return json(res, 401, { error: 'invalid_client' });
        }
        const token = `tok-${randomUUID()}`;
        tokensDoDmsId.add(token);
        return json(res, 200, { access_token: token, token_type: 'Bearer', expires_in: 3600 });
      }

      const caminho = (req.url ?? '').replace(/^\/api\/v1/, '');
      const autorizacao = String(req.headers.authorization ?? '');
      const bearer = /^Bearer (.+)$/.exec(autorizacao)?.[1] ?? '';
      // A via do clique: o token do DMS ID vem antes (recusado = 401 token-invalido), a ligação depois.
      const ligacaoDoPedido = String(req.headers['dms-ligacao'] ?? '');
      const tokenDoDmsIdVale = tokensDoDmsId.has(bearer) && !falso.dmsId.recusarTokens;
      /** O acesso que o pedido apresenta: o `rgm_it_` no Bearer, ou a ligação (com o token do DMS ID na frente). */
      const acessoDoPedido = ligacaoDoPedido ? (tokenDoDmsIdVale ? ligacaoDoPedido : '') : bearer;
      /** A recusa do acesso que não vale, como lá: pela ligação com o token certo, é a ligação que não vale. */
      const recusaDoAcesso = (): [string, string, string] =>
        ligacaoDoPedido && tokenDoDmsIdVale
          ? ['ligacao-invalida', 'Ligação inválida', 'A ligação não vale: revogada, trocada ou de outro aplicativo.']
          : ['token-invalido', 'Token inválido', 'Token ausente, inválido ou revogado.'];
      // O pedido de aviso é anotado à parte (`avisos.pedidos`), com o que foi respondido.
      const ehAviso = caminho === '/integracao/webhook';
      const doAviso = { metodo: req.method ?? '', comAcesso: autorizacao.length > 0, corpo, status: 0 };
      if (ehAviso) falso.avisos.pedidos.push(doAviso);
      else {
        chamadas.push({
          caminho,
          agente: String(req.headers['user-agent'] ?? ''),
          tipo: req.headers['content-type'] ? String(req.headers['content-type']) : null,
          comAcesso: autorizacao.length > 0,
          corpo,
        });
      }

      const modo = falso.modo;
      if (modo === 'mudo') return void presos.add(res);
      if (modo === 'fora') return void ((doAviso.status = 503), problema(res, 503, 'erro-interno', 'Erro interno', 'Serviço indisponível.'));
      if (modo === 'devagar') return void ((doAviso.status = 429), problema(res, 429, 'limite-de-chamadas', 'Limite de chamadas', 'Muitas chamadas.'));
      if (modo === 'proibido') return void ((doAviso.status = 403), problema(res, 403, 'escopo-insuficiente', 'Escopo insuficiente', 'Não pode.'));
      if (modo === 'desvia') {
        // Para ESTE servidor, noutro caminho: se o cliente seguir o
        // desvio, a segunda chamada fica anotada em `chamadas`.
        if (caminho === '/outro-lugar') return problema(res, 404, 'nao-encontrado', 'Não encontrado', 'Rota inexistente.');
        res.writeHead(302, { location: `${falso.url}/outro-lugar` });
        return void res.end();
      }
      if (modo === 'pagina') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return void res.end('<!doctype html><title>Um momento…</title>');
      }
      // ── o aviso: registrar (PUT) e parar de avisar (DELETE) ──
      if (ehAviso) {
        const acesso = acessoDoPedido;
        const recusar = (status: number, tipo: string, titulo: string, detalhe: string) => {
          doAviso.status = status;
          return problema(res, status, tipo, titulo, detalhe);
        };
        if (!acessos.has(acesso)) return recusar(401, ...recusaDoAcesso());
        if (ligacaoDoPedido) falso.pelaLigacao.push(caminho);
        if (req.method === 'DELETE') {
          registros.delete(acesso);
          doAviso.status = 204;
          res.writeHead(204);
          return void res.end();
        }
        if (req.method !== 'PUT') return recusar(404, 'nao-encontrado', 'Não encontrado', 'Rota inexistente.');
        if (!corpo || Array.isArray(corpo)) return recusar(400, 'parametro-invalido', 'Parâmetro inválido', 'Envie um JSON com "url" e "segredo".');
        const estranhos = Object.keys(corpo).filter((k) => k !== 'url' && k !== 'segredo');
        if (estranhos.length) return recusar(400, 'parametro-invalido', 'Parâmetro inválido', `Campo desconhecido: ${estranhos.join(', ')}.`);
        const base = falso.avisos.base;
        if (base === null) return recusar(422, 'endereco-nao-permitido', 'Endereço não permitido', 'Esta integração não tem aviso habilitado no Regem.');
        if (!enderecoServe(corpo.url, base)) {
          return recusar(422, 'endereco-nao-permitido', 'Endereço não permitido', '"url" precisa ser um endereço da própria integração, registrado no Regem pela distribuição.');
        }
        if (!segredoServe(corpo.segredo)) {
          return recusar(400, 'parametro-invalido', 'Parâmetro inválido', '"segredo" precisa estar no formato Standard Webhooks: "whsec_" + base64 de 24 a 64 bytes.');
        }
        registros.set(acesso, { url: new URL(corpo.url).href, segredo: corpo.segredo });
        doAviso.status = 200;
        return json(res, 200, { url: new URL(corpo.url).href, pausado: false, registrado_em: new Date().toISOString(), falhas_seguidas: 0 });
      }

      // ── as leituras: o cardápio, as fichas e a fila da cozinha da loja do acesso ──
      const leitura = /^\/integracao\/(catalogo|fichas|producao)(?:\?versao=([0-9a-f]*))?$/.exec(caminho);
      if (req.method === 'GET' && leitura) {
        const qual = leitura[1] as 'catalogo' | 'fichas' | 'producao';
        const acesso = acessoDoPedido;
        const responder = () => {
          // O acesso é conferido NA HORA de responder: tirado enquanto a leitura esperava, é 401.
          const lojaId = acessos.get(acesso);
          if (!lojaId) return problema(res, 401, ...recusaDoAcesso());
          if (ligacaoDoPedido) falso.pelaLigacao.push(caminho.replace(/\?.*$/, ''));
          // Depois do acesso, o escopo da rota — como lá.
          if (qual === 'producao' && falso.filaSemEscopo) {
            return problema(res, 403, 'escopo-insuficiente', 'Escopo insuficiente', 'Este token não tem o escopo producao.ler.');
          }
          const c = cardapios.get(lojaId.toLowerCase()) ?? amostra;
          const retrato =
            qual === 'catalogo'
              ? { categorias: c.categorias, setores: c.setores, produtos: c.produtos }
              : qual === 'fichas'
                ? { fichas: c.fichas }
                : { pedidos: filas.get(lojaId.toLowerCase()) ?? [] };
          // A versão é a impressão do conteúdo, como lá: muda quando o retrato muda.
          const versao = createHash('md5').update(JSON.stringify(retrato)).digest('hex');
          const corpo: Record<string, unknown> =
            leitura[2] === versao
              ? { versao, atualizado: false }
              : { versao, atualizado: true, gerado_em: new Date().toISOString(), loja_id: lojaId, ...retrato };
          return json(res, 200, falso.leituraTorta ? falso.leituraTorta(qual, corpo) : corpo);
        };
        if (segurando) return void esperando.push(responder);
        return responder();
      }

      if (req.method !== 'POST') return problema(res, 404, 'nao-encontrado', 'Não encontrado', 'Rota inexistente.');

      // ── o pedido empurrado do clique (RFC 9126) ──
      if (caminho === '/integracao/autorizacao/pedido') {
        if (!tokenDoDmsIdVale) return problema(res, 401, 'token-invalido', 'Token inválido', 'Token ausente, inválido ou revogado.');
        const c = corpo ?? {};
        const campo = (k: string) => (typeof c[k] === 'string' ? (c[k] as string) : '');
        const escopos = campo('scope').split(' ').filter(Boolean);
        const permitidas = ['catalogo.ler', 'fichas.ler', 'producao.ler'];
        const torto =
          campo('response_type') !== 'code' ||
          !campo('redirect_uri') ||
          !escopos.length ||
          escopos.some((e) => !permitidas.includes(e)) ||
          campo('state').length < 16 ||
          !/^[A-Za-z0-9_-]{43}$/.test(campo('code_challenge')) ||
          campo('code_challenge_method') !== 'S256' ||
          !campo('conta_nome') ||
          campo('conta_nome').length > 120 ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(campo('conta_email'));
        if (torto) return problema(res, 400, 'parametro-invalido', 'Parâmetro inválido', 'O pedido não está no formato.');
        const numero = `urn:ietf:params:oauth:request_uri:rgm_${randomBytes(32).toString('base64url')}`;
        pedidosEmpurrados.set(numero, { desafio: campo('code_challenge'), redirectUri: campo('redirect_uri') });
        falso.pedidosDoClique.push({ numero, corpo: c });
        return json(res, 201, { request_uri: numero, expires_in: 600 });
      }

      // ── a troca do código ──
      // Pelo clique (o token do DMS ID, sem segredo no corpo): a ligação de cada loja.
      if (caminho === '/integracao/autorizacao/token' && bearer && corpo?.client_secret === undefined) {
        if (!tokenDoDmsIdVale) return problema(res, 401, 'token-invalido', 'Token inválido', 'Token ausente, inválido ou revogado.');
        const recusar = () => problema(res, 400, 'autorizacao-invalida', 'Autorização inválida', 'Código de autorização inválido, vencido ou já usado.');
        const codigo = corpo?.code;
        if (corpo?.grant_type !== 'authorization_code' || typeof codigo !== 'string' || !FORMATO_CODIGO.test(codigo)) return recusar();
        const a = codigos.get(codigo);
        if (!a || a.usado || a.vencido || a.via !== 'clique') return recusar();
        a.usado = true;
        if (corpo?.redirect_uri !== a.redirectUri) return recusar();
        const v = corpo?.code_verifier;
        if (typeof v !== 'string' || !FORMATO_VERIFICADOR.test(v)) return recusar();
        if (createHash('sha256').update(v, 'ascii').digest('base64url') !== a.desafio) return recusar();
        const lojas = a.lojas.map((l) => {
          // A loja que já tinha acesso deste cliente (chave ou ligação) troca: o antigo para de valer.
          for (const [antigo, loja] of acessos) {
            if (loja !== l.id) continue;
            acessos.delete(antigo);
            registros.delete(antigo);
          }
          const ligacao = `dms_lg_regem_${randomBytes(32).toString('base64url')}_${randomBytes(6).toString('base64url').slice(0, 6)}`;
          acessos.set(ligacao, l.id);
          emitidos.push(ligacao);
          return {
            loja_id: l.id,
            loja_nome: l.nome,
            empresa_nome: a.empresa,
            fuso: 'America/Sao_Paulo',
            moeda: 'BRL',
            cardapio_url: null,
            ligacao,
            prefixo: ligacao.slice(0, 18),
            permissoes: ['catalogo.ler', 'fichas.ler', 'producao.ler'],
            segredo_em: new Date().toISOString(),
          };
        });
        return json(res, 200, typeof modo === 'function' ? modo(lojas) : { lojas });
      }
      if (caminho === '/integracao/autorizacao/token') {
        if (corpo?.client_id !== 'farol' || corpo?.client_secret !== segredo) {
          return problema(res, 401, 'cliente-invalido', 'Cliente inválido', 'Cliente ou segredo de cliente inválido.');
        }
        const recusar = () =>
          problema(res, 400, 'autorizacao-invalida', 'Autorização inválida', 'Código de autorização inválido, vencido ou já usado.');
        const codigo = corpo?.code;
        if (typeof codigo !== 'string' || !FORMATO_CODIGO.test(codigo)) return recusar();
        const a = codigos.get(codigo);
        if (!a || a.usado || a.vencido || a.via !== 'chave') return recusar();
        a.usado = true; // gasto ANTES das conferências seguintes, como lá
        if (corpo?.redirect_uri !== a.redirectUri) return recusar();
        const v = corpo?.code_verifier;
        if (typeof v !== 'string' || !FORMATO_VERIFICADOR.test(v)) return recusar();
        if (createHash('sha256').update(v, 'ascii').digest('base64url') !== a.desafio) return recusar();

        const lojas = a.lojas.map((l) => {
          // A loja que já tinha acesso troca: o antigo para de valer.
          for (const [antigo, loja] of acessos) {
            if (loja !== l.id) continue;
            acessos.delete(antigo);
            registros.delete(antigo); // o registro é do acesso: vai junto
          }
          const token = `rgm_it_${randomBytes(32).toString('base64url')}`;
          acessos.set(token, l.id);
          emitidos.push(token);
          return {
            loja_id: l.id,
            loja_nome: l.nome,
            empresa_nome: a.empresa,
            fuso: 'America/Sao_Paulo',
            moeda: 'BRL',
            escopos: ['catalogo.ler', 'fichas.ler', 'producao.ler'],
            cardapio_url: null,
            token,
          };
        });
        return json(res, 200, typeof modo === 'function' ? modo(lojas) : { lojas });
      }

      // ── a integração devolve o próprio acesso ──
      if (caminho === '/integracao/autorizacao/revogar') {
        const acesso = acessoDoPedido;
        if (!acessos.has(acesso)) return problema(res, 401, ...recusaDoAcesso());
        if (ligacaoDoPedido) falso.pelaLigacao.push(caminho);
        acessos.delete(acesso);
        registros.delete(acesso);
        return json(res, 200, { revogado: true, revogado_em: new Date().toISOString() });
      }

      return problema(res, 404, 'nao-encontrado', 'Não encontrado', 'Rota inexistente.');
    });
  });

  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  falso.url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/api/v1`;
  falso.dmsId.emissor = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/dmsid/oidc`;
  return falso;
}
