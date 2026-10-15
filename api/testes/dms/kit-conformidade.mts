// Kit de testes do Padrão DMS (Padrão §14): o que todo produto roda contra a PRÓPRIA porta antes de abri-la.
//
//   node kit-conformidade.mts caminho/da/config.json
//
// Roda só contra ambiente de TESTE: a parte de escrita grava registros. A config diz os caminhos e os NOMES das
// variáveis de ambiente que guardam as chaves de teste (as chaves nunca ficam na config nem no repositório).
//
// Chega aos produtos por cópia, como o pacote (ADR-002). Roda direto no Node 22.18 ou mais, sem compilar; fica fora
// da pasta que o produto compila (por exemplo `scripts/dms/`).

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Versões publicadas do pacote comum e o SHA-256 do arquivo (fim de linha LF). Atualizar a cada versão nova. */
export const VERSOES_DO_PACOTE: Readonly<Record<string, string>> = {
  '0.1.0': '0f42a0cb73ccea56a7d9ff04e5f3c92c17a0f20fe277660ce843cf1161eb50fc',
  '0.1.1': 'ad4e4169bfba2df17f4415e5487ddc710ce73605cdb1882db1704226a95f4d95',
};

type Pacote = typeof import('../pacote/integracao-dms.ts');

/** Carrega a cópia do pacote do PRÓPRIO produto (a mesma que o kit confere); sem ela, a do hub. */
async function carregarPacote(copia: string | undefined): Promise<Pacote> {
  const alvo = copia ? pathToFileURL(resolve(copia)).href : new URL('../pacote/integracao-dms.ts', import.meta.url).href;
  return (await import(alvo)) as Pacote;
}

export type ConfigKit = {
  produto: string;
  base: string;
  /**
   * Uma rota de leitura protegida. `permissao` = a que ela exige (sem isto, a porta não tem permissões separadas e a
   * conferência `sem-permissao` é pulada). `lista: false` = a rota não é lista paginada (as conferências de cursor
   * são puladas).
   */
  leitura: { caminho: string; permissao?: string; lista?: boolean };
  /** Caminho de um recurso da empresa A, com `{id}` no lugar do id. Sem isto: a loja ou a empresa vem só da chave. */
  recursoDaEmpresaA?: string;
  /**
   * `modo: 'chave'` (padrão) = escrita com `Idempotency-Key`; `modo: 'substituicao'` = o envio troca o conjunto
   * inteiro (como o PUT das fichas do Farol), idempotente por natureza (Padrão §5).
   */
  escrita?: { caminho: string; metodo?: 'POST' | 'PUT'; modo?: 'chave' | 'substituicao'; corpo: unknown; corpoDiferente?: unknown };
  /** Quantas chamadas seguidas fazer para ver o 429 (o limite da porta mais um). Sem isto, a conferência é pulada. */
  limite?: { chamadas: number };
  /** Caminho da cópia do pacote comum no produto, para conferir que ela bate com uma versão publicada. */
  copiaDoPacote?: string;
  /** NOMES das variáveis de ambiente com as credenciais de teste. As três primeiras são obrigatórias. */
  credenciais: { valida: string; outraEmpresa: string; revogada: string } & Partial<Record<NomeCredencial, string>>;
};

export type NomeCredencial = 'valida' | 'outraEmpresa' | 'revogada' | 'vencida' | 'suspensa' | 'semPermissao' | 'idRecursoA';
export type Valores = { valida: string; outraEmpresa: string; revogada: string } & Partial<Record<NomeCredencial, string>>;
export type Resultado = { nome: string; ok: boolean; pulado?: boolean; detalhe: string };

type Resposta = { status: number; tipoConteudo: string; corpo: any; cabecalhos: Headers };

/* eslint-disable @typescript-eslint/no-explicit-any */

/** O conteúdo do arquivo do pacote bate com uma versão publicada? (CRLF vira LF antes do resumo.) */
export function conferirCopiaDoPacote(conteudo: string): { ok: boolean; detalhe: string } {
  const versao = /export const VERSAO_PACOTE = '([^']+)'/.exec(conteudo)?.[1];
  if (!versao) return { ok: false, detalhe: 'A cópia não tem VERSAO_PACOTE.' };
  const esperado = VERSOES_DO_PACOTE[versao];
  if (!esperado) return { ok: false, detalhe: `A versão ${versao} não está entre as publicadas.` };
  const resumo = createHash('sha256').update(conteudo.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
  return resumo === esperado
    ? { ok: true, detalhe: `Cópia igual à versão ${versao}.` }
    : { ok: false, detalhe: `A cópia diz ${versao}, mas o conteúdo foi alterado. Copie de novo do hub.` };
}

export async function rodarKit(config: ConfigKit, valores: Valores): Promise<Resultado[]> {
  const { ehProduto, gerarChave } = await carregarPacote(config.copiaDoPacote);
  if (!ehProduto(config.produto)) throw new Error(`Produto desconhecido na config: ${config.produto}`);
  const resultados: Resultado[] = [];
  const errosVistos: { onde: string; r: Resposta }[] = [];
  const registrar = (nome: string, ok: boolean, detalhe: string) => resultados.push({ nome, ok, detalhe });
  const pular = (nome: string, detalhe: string) => resultados.push({ nome, ok: true, pulado: true, detalhe });

  async function pedir(
    caminho: string,
    o: { metodo?: string; chave?: string; corpo?: unknown; cabecalhos?: Record<string, string>; onde?: string } = {},
  ): Promise<Resposta> {
    const cabecalhos: Record<string, string> = { accept: 'application/json', ...(o.cabecalhos ?? {}) };
    if (o.chave !== undefined) cabecalhos.authorization = `Bearer ${o.chave}`;
    if (o.corpo !== undefined) cabecalhos['content-type'] = 'application/json';
    const res = await fetch(new URL(caminho, config.base), {
      method: o.metodo ?? 'GET',
      headers: cabecalhos,
      body: o.corpo === undefined ? undefined : JSON.stringify(o.corpo),
    });
    const texto = await res.text();
    let corpo: any = null;
    try {
      corpo = texto ? JSON.parse(texto) : null;
    } catch {
      corpo = texto;
    }
    const r: Resposta = { status: res.status, tipoConteudo: res.headers.get('content-type') ?? '', corpo, cabecalhos: res.headers };
    if (r.status >= 400) errosVistos.push({ onde: o.onde ?? caminho, r });
    return r;
  }

  const tipoDe = (r: Resposta): string => (typeof r.corpo?.type === 'string' ? r.corpo.type.replace(/^.*\//, '') : '');
  const resumo = (r: Resposta): string => `${r.status} ${tipoDe(r) || r.tipoConteudo}`;
  const leitura = config.leitura.caminho;

  // 1. A cópia do pacote
  if (config.copiaDoPacote) {
    try {
      const c = conferirCopiaDoPacote(readFileSync(config.copiaDoPacote, 'utf8'));
      registrar('copia-do-pacote', c.ok, c.detalhe);
    } catch (e) {
      registrar('copia-do-pacote', false, `Não consegui ler ${config.copiaDoPacote}: ${(e as Error).message}`);
    }
  } else {
    pular('copia-do-pacote', 'A config não diz onde está a cópia do pacote.');
  }

  // 2. Credenciais recusadas
  const semCredencial = await pedir(leitura, { onde: 'sem credencial' });
  registrar(
    'sem-credencial',
    semCredencial.status === 401 && tipoDe(semCredencial) === 'token-invalido' && /^Bearer\b/.test(semCredencial.cabecalhos.get('www-authenticate') ?? ''),
    `Esperado 401 token-invalido com WWW-Authenticate; veio ${resumo(semCredencial)}.`,
  );

  const torta = await pedir(leitura, { chave: 'abc', onde: 'credencial torta' });
  registrar('credencial-torta', torta.status === 401, `Esperado 401; veio ${resumo(torta)}.`);

  const valida = valores.valida;
  const prefixo = /^dms_(?:ap|lg)_[a-z]+_/.exec(valida)?.[0] ?? '';
  const i = prefixo.length + 10;
  const trocada = valida.slice(0, i) + (valida[i] === 'A' ? 'B' : 'A') + valida.slice(i + 1);
  const conferenciaErrada = await pedir(leitura, { chave: trocada, onde: 'dígito de conferência errado' });
  registrar('conferencia-errada', conferenciaErrada.status === 401, `Chave com um caractere trocado: esperado 401; veio ${resumo(conferenciaErrada)}.`);

  const inexistente = await pedir(leitura, { chave: gerarChave('ap', config.produto).chave, onde: 'chave inexistente' });
  registrar('chave-inexistente', inexistente.status === 401 && tipoDe(inexistente) === 'token-invalido', `Esperado 401 token-invalido; veio ${resumo(inexistente)}.`);

  // "A mesma resposta" é a resposta INTEIRA (tirando o código de rastreio), não só o status: um campo `erro` de
  // extensão diferente já conta a quem tem o código que ele existiu.
  const semRastreio = (c: any): string => {
    if (!c || typeof c !== 'object') return JSON.stringify(c);
    const { request_id: _a, requestId: _b, ...resto } = c;
    return JSON.stringify(resto);
  };
  const revogada = await pedir(leitura, { chave: valores.revogada, onde: 'chave revogada' });
  registrar(
    'revogada-igual-inexistente',
    revogada.status === inexistente.status && revogada.tipoConteudo === inexistente.tipoConteudo && semRastreio(revogada.corpo) === semRastreio(inexistente.corpo),
    `Revogada tem de responder igual a inexistente: ${resumo(inexistente)} ${semRastreio(inexistente.corpo)}; veio ${resumo(revogada)} ${semRastreio(revogada.corpo)}.`,
  );

  // Vencida e suspensa são regras do Padrão (§2.4): sem chave para testar, a conferência FALHA (não conferido = não
  // conforme), em vez de ser pulada.
  if (valores.vencida) {
    const vencida = await pedir(leitura, { chave: valores.vencida, onde: 'chave vencida' });
    registrar('vencida', vencida.status === 401 && tipoDe(vencida) === 'chave-vencida', `Esperado 401 chave-vencida; veio ${resumo(vencida)}.`);
  } else {
    registrar('vencida', false, 'Sem chave vencida para testar. O Padrão pede validade de 12 meses na chave (§2.4).');
  }

  if (valores.suspensa) {
    const suspensa = await pedir(leitura, { chave: valores.suspensa, onde: 'chave suspensa' });
    registrar('suspensa', suspensa.status === 403 && tipoDe(suspensa) === 'chave-suspensa', `Esperado 403 chave-suspensa; veio ${resumo(suspensa)}.`);
  } else {
    registrar('suspensa', false, 'Sem chave suspensa para testar. O Padrão pede a suspensão depois de 90 dias sem uso (§2.4).');
  }

  if (valores.semPermissao && config.leitura.permissao) {
    const semPermissao = await pedir(leitura, { chave: valores.semPermissao, onde: 'chave sem a permissão' });
    const desafio = semPermissao.cabecalhos.get('www-authenticate') ?? '';
    registrar(
      'sem-permissao',
      semPermissao.status === 403 && tipoDe(semPermissao) === 'escopo-insuficiente' && desafio.includes(config.leitura.permissao),
      `Esperado 403 escopo-insuficiente com a permissão ${config.leitura.permissao} no WWW-Authenticate; veio ${resumo(semPermissao)} (${desafio || 'sem desafio'}).`,
    );
  } else {
    pular('sem-permissao', 'A chave desta porta tem um uso só, sem permissões separadas.');
  }

  // 3. Leitura e isolamento entre empresas
  const ehLista = config.leitura.lista !== false;
  const lista = await pedir(ehLista ? `${leitura}${leitura.includes('?') ? '&' : '?'}limite=1` : leitura, { chave: valida, onde: 'leitura válida' });
  registrar(
    'valida-le',
    lista.status === 200 && lista.corpo !== null && typeof lista.corpo === 'object' && (!ehLista || 'proximo_cursor' in lista.corpo),
    ehLista ? `Esperado 200 com proximo_cursor; veio ${resumo(lista)}.` : `Esperado 200 com um objeto JSON; veio ${resumo(lista)}.`,
  );

  if (config.recursoDaEmpresaA && valores.idRecursoA) {
    const recurso = config.recursoDaEmpresaA.replace('{id}', encodeURIComponent(valores.idRecursoA));
    const daMesma = await pedir(recurso, { chave: valida, onde: 'recurso da própria empresa' });
    registrar('mesma-empresa-ve', daMesma.status === 200, `A empresa A lê o próprio recurso: esperado 200; veio ${resumo(daMesma)}.`);

    const daOutra = await pedir(recurso, { chave: valores.outraEmpresa, onde: 'recurso de outra empresa' });
    registrar(
      'outra-empresa-nao-ve',
      daOutra.status === 403 || daOutra.status === 404,
      `A empresa B não pode ler o recurso da A: esperado 403 ou 404; veio ${resumo(daOutra)}.`,
    );
  } else {
    const motivo = 'A porta não recebe id de recurso: a loja ou a empresa vem só da chave.';
    pular('mesma-empresa-ve', motivo);
    pular('outra-empresa-nao-ve', motivo);
  }

  // 4. Cursor
  if (!ehLista) {
    pular('cursor-invalido', 'A leitura não é lista paginada.');
    pular('cursor-de-outra-empresa', 'A leitura não é lista paginada.');
  } else {
    const lixo = await pedir(`${leitura}${leitura.includes('?') ? '&' : '?'}cursor=nao-e-cursor`, { chave: valida, onde: 'cursor torto' });
    const deOutraRota = Buffer.from(JSON.stringify({ k: 'outra-rota', l: 'x', t: null, i: null })).toString('base64url');
    const outraRota = await pedir(`${leitura}${leitura.includes('?') ? '&' : '?'}cursor=${deOutraRota}`, { chave: valida, onde: 'cursor de outra rota' });
    registrar(
      'cursor-invalido',
      lixo.status === 400 && tipoDe(lixo) === 'cursor-invalido' && outraRota.status === 400 && tipoDe(outraRota) === 'cursor-invalido',
      `Cursor torto e cursor de outra rota: esperado 400 cursor-invalido; vieram ${resumo(lixo)} e ${resumo(outraRota)}.`,
    );

    const proximo = lista.corpo?.proximo_cursor;
    if (typeof proximo === 'string' && proximo) {
      const usadoPorOutra = await pedir(`${leitura}${leitura.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(proximo)}`, {
        chave: valores.outraEmpresa,
        onde: 'cursor de outra empresa',
      });
      registrar(
        'cursor-de-outra-empresa',
        usadoPorOutra.status === 400 && tipoDe(usadoPorOutra) === 'cursor-invalido',
        `O cursor da empresa A usado pela B: esperado 400 cursor-invalido; veio ${resumo(usadoPorOutra)}.`,
      );
    } else {
      pular('cursor-de-outra-empresa', 'A empresa A precisa de ao menos dois registros na leitura para haver próxima página.');
    }
  }

  // 5. Escrita e idempotência
  if (config.escrita) {
    const { caminho, corpo, corpoDiferente } = config.escrita;
    const modo = config.escrita.modo ?? 'chave';
    const metodo = config.escrita.metodo ?? (modo === 'substituicao' ? 'PUT' : 'POST');
    if (modo === 'substituicao') {
      const motivo = 'O envio troca o conjunto inteiro: é idempotente por natureza e dispensa a Idempotency-Key (Padrão §5).';
      pular('escrita-sem-idempotencia', motivo);
      pular('idempotencia-outro-corpo', motivo);
      const primeira = await pedir(caminho, { metodo, chave: valida, corpo, onde: 'substituição' });
      const segunda = await pedir(caminho, { metodo, chave: valida, corpo, onde: 'substituição repetida' });
      registrar(
        'idempotencia-repete',
        primeira.status >= 200 && primeira.status < 300 && segunda.status === primeira.status,
        `Repetir o mesmo envio dá o mesmo resultado: vieram ${resumo(primeira)} e ${resumo(segunda)}.`,
      );
    } else {
      const semChave = await pedir(caminho, { metodo, chave: valida, corpo, onde: 'escrita sem Idempotency-Key' });
      registrar('escrita-sem-idempotencia', semChave.status === 400, `Escrita sem Idempotency-Key: esperado 400; veio ${resumo(semChave)}.`);

      const chaveIdem = `kit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const primeira = await pedir(caminho, { metodo, chave: valida, corpo, cabecalhos: { 'idempotency-key': chaveIdem }, onde: 'escrita' });
      const segunda = await pedir(caminho, { metodo, chave: valida, corpo, cabecalhos: { 'idempotency-key': chaveIdem }, onde: 'escrita repetida' });
      registrar(
        'idempotencia-repete',
        primeira.status >= 200 && primeira.status < 300 && segunda.status === primeira.status && JSON.stringify(segunda.corpo) === JSON.stringify(primeira.corpo),
        `A mesma chave com o mesmo pedido devolve a mesma resposta: vieram ${resumo(primeira)} e ${resumo(segunda)}.`,
      );

      const outroCorpo = await pedir(caminho, { metodo, chave: valida, corpo: corpoDiferente ?? { kit: 'outro corpo' }, cabecalhos: { 'idempotency-key': chaveIdem }, onde: 'escrita com outro corpo' });
      registrar(
        'idempotencia-outro-corpo',
        outroCorpo.status === 422 && tipoDe(outroCorpo) === 'chave-reutilizada',
        `A mesma chave com outro pedido: esperado 422 chave-reutilizada; veio ${resumo(outroCorpo)}.`,
      );
    }

    // Só validar: responde 2xx E não muda nada. O kit lê a leitura antes e depois, com um corpo diferente, porque uma
    // porta que ignora o parâmetro também responde 2xx (e grava).
    const corpoDoTeste = corpoDiferente ?? corpo;
    if (modo === 'substituicao' && corpoDiferente === undefined) {
      registrar('somente-validar', false, 'Para provar que "só validar" não grava, a config precisa de escrita.corpoDiferente.');
    } else {
      const antes = await pedir(leitura, { chave: valida, onde: 'leitura antes de só validar' });
      const validar = await pedir(`${caminho}${caminho.includes('?') ? '&' : '?'}somente_validar=true`, { metodo, chave: valida, corpo: corpoDoTeste, onde: 'só validar' });
      const depois = await pedir(leitura, { chave: valida, onde: 'leitura depois de só validar' });
      const igual = JSON.stringify(antes.corpo) === JSON.stringify(depois.corpo);
      registrar(
        'somente-validar',
        validar.status >= 200 && validar.status < 300 && igual,
        igual
          ? `Só validar: esperado 2xx sem mudar nada; veio ${resumo(validar)}.`
          : `Só validar respondeu ${resumo(validar)}, mas a leitura mudou depois: a porta gravou.`,
      );
    }
  } else {
    pular('escrita', 'A config não tem escrita.');
  }

  // 6. Toda resposta de erro em problem+json
  const foraDoFormato = errosVistos.filter(({ r }) => {
    const c = r.corpo;
    return !(
      r.tipoConteudo.startsWith('application/problem+json') &&
      c && typeof c === 'object' &&
      typeof c.type === 'string' && typeof c.title === 'string' && typeof c.detail === 'string' && c.status === r.status
    );
  });
  registrar(
    'erros-em-problem-json',
    errosVistos.length > 0 && foraDoFormato.length === 0,
    foraDoFormato.length
      ? `Fora do formato RFC 9457: ${foraDoFormato.map((e) => `${e.onde} (${e.r.status} ${e.r.tipoConteudo})`).join('; ')}.`
      : `${errosVistos.length} respostas de erro, todas em application/problem+json.`,
  );

  // 7. Limite (por último: esgota a cota da empresa A)
  if (config.limite) {
    let viu: Resposta | null = null;
    for (let n = 0; n < config.limite.chamadas && !viu; n += 1) {
      const r = await pedir(leitura, { chave: valida, onde: 'limite' });
      if (r.status === 429) viu = r;
    }
    const retry = Number(viu?.cabecalhos.get('retry-after'));
    registrar(
      'limite',
      !!viu && tipoDe(viu) === 'limite-de-chamadas' && retry >= 1,
      viu ? `429 com Retry-After ${viu.cabecalhos.get('retry-after') ?? 'ausente'}.` : `Nenhum 429 em ${config.limite.chamadas} chamadas.`,
    );
  } else {
    pular('limite', 'A config não diz o limite da porta.');
  }

  return resultados;
}

// Linha de comando: node kit-conformidade.mts config.json
if (process.argv[1] && /kit-conformidade\.m?ts$/.test(process.argv[1])) {
  const caminhoConfig = process.argv[2];
  if (!caminhoConfig) {
    console.error('Uso: node kit-conformidade.mts caminho/da/config.json');
    process.exit(2);
  }
  const config = JSON.parse(readFileSync(caminhoConfig, 'utf8')) as ConfigKit;
  const valores = {} as Valores;
  const faltando: string[] = [];
  for (const [nome, variavel] of Object.entries(config.credenciais) as [NomeCredencial, string][]) {
    if (!variavel) continue;
    const v = process.env[variavel];
    if (!v) faltando.push(variavel);
    valores[nome] = v ?? '';
  }
  for (const obrigatoria of ['valida', 'outraEmpresa', 'revogada'] as const) {
    if (!config.credenciais[obrigatoria]) faltando.push(`(config sem credenciais.${obrigatoria})`);
  }
  if (faltando.length) {
    console.error(`Faltam as variáveis de ambiente: ${faltando.join(', ')}`);
    process.exit(2);
  }
  rodarKit(config, valores).then(
    (resultados) => {
      for (const r of resultados) console.log(`${r.pulado ? '–' : r.ok ? '✔' : '✘'} ${r.nome}: ${r.detalhe}`);
      const falhas = resultados.filter((r) => !r.ok);
      console.log(falhas.length ? `\n${falhas.length} conferência(s) falharam. A porta não abre.` : '\nTudo certo.');
      process.exit(falhas.length ? 1 : 0);
    },
    (e) => {
      console.error(e);
      process.exit(2);
    },
  );
}
