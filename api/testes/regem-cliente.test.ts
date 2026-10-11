// O cliente do Regem: o que o servidor do Farol manda e como lê o que volta.
// Sem banco — do outro lado está um servidor de verdade (`regem-falso.ts`),
// que recusa o que o Regem recusa.

import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

import {
  conexaoDisponivel,
  configDoRegem,
  devolverAcesso,
  ErroDoRegem,
  impressao,
  novoPedido,
  trocarCodigo,
  urlDeAutorizacao,
  type ConfigDoRegem,
} from '../src/regem.js';
import { subirRegemFalso, type RegemFalso } from './regem-falso.js';

// Os formatos que o REGEM aceita (`autorizacao-loja.ts`, lá).
const ESTADO_DE_LA = /^[\x21-\x7E]{16,200}$/;
const DESAFIO_DE_LA = /^[A-Za-z0-9_-]{43}$/;
const VERIFICADOR_DE_LA = /^[A-Za-z0-9\-._~]{43,128}$/;

describe('regem: o que o ambiente configura', () => {
  it('sem nada no ambiente: os endereços de produção, e a conexão indisponível', () => {
    const c = configDoRegem({});
    assert.equal(c.apiUrl, 'https://api.dmsregem.com/api/v1');
    assert.equal(c.appUrl, 'https://app.dmsregem.com');
    assert.equal(c.consoleUrl, 'https://app.monitorfarol.com.br');
    assert.equal(c.retornoUrl, 'https://app.monitorfarol.com.br/api/regem/retorno');
    assert.equal(c.segredo, null);
    assert.equal(c.chave, null);
    assert.equal(c.prazoMs, 10_000);
    assert.equal(conexaoDisponivel(c), false);
  });

  it('o ambiente troca os endereços; a barra do fim não conta; a volta acompanha o console', () => {
    const c = configDoRegem({
      REGEM_API_URL: 'http://127.0.0.1:3101/api/v1//',
      REGEM_APP_URL: 'http://127.0.0.1:3100/',
      FAROL_CONSOLE_URL: 'http://127.0.0.1:3200/',
    });
    assert.equal(c.apiUrl, 'http://127.0.0.1:3101/api/v1');
    assert.equal(c.appUrl, 'http://127.0.0.1:3100');
    assert.equal(c.consoleUrl, 'http://127.0.0.1:3200');
    assert.equal(c.retornoUrl, 'http://127.0.0.1:3200/api/regem/retorno');
    assert.equal(configDoRegem({ FAROL_CONSOLE_URL: 'http://a', REGEM_RETORNO_URL: 'http://b/volta' }).retornoUrl, 'http://b/volta');
  });

  it('o segredo curto é tratado como ausente — a mesma régua do Regem (32)', () => {
    assert.equal(configDoRegem({ REGEM_CLIENT_SECRET: 'x'.repeat(31) }).segredo, null);
    assert.equal(configDoRegem({ REGEM_CLIENT_SECRET: 'x'.repeat(32) }).segredo, 'x'.repeat(32));
    assert.equal(configDoRegem({ REGEM_CLIENT_SECRET: `  ${'x'.repeat(31)}  ` }).segredo, null, 'espaço em volta não completa o tamanho');
    assert.equal(configDoRegem({ REGEM_CLIENT_SECRET: ` ${'x'.repeat(40)}\n` }).segredo, 'x'.repeat(40));
  });

  it('só dá para conectar com as DUAS peças: o segredo e a chave', () => {
    const segredo = 's'.repeat(40);
    const chave = randomBytes(32).toString('base64');
    assert.equal(conexaoDisponivel(configDoRegem({ REGEM_CLIENT_SECRET: segredo })), false);
    assert.equal(conexaoDisponivel(configDoRegem({ FAROL_CHAVE_DOS_ACESSOS: chave })), false);
    assert.equal(conexaoDisponivel(configDoRegem({ REGEM_CLIENT_SECRET: segredo, FAROL_CHAVE_DOS_ACESSOS: 'curta' })), false);
    assert.equal(conexaoDisponivel(configDoRegem({ REGEM_CLIENT_SECRET: segredo, FAROL_CHAVE_DOS_ACESSOS: chave })), true);
  });

  it('o cliente se identifica com nome próprio e a versão', () => {
    assert.match(configDoRegem({}, '9.8.7').agente, /^farol-api\/9\.8\.7 /);
  });
});

describe('regem: o pedido de conexão', () => {
  it('sai nos formatos que o Regem aceita, e o desafio é o S256 do verificador', () => {
    for (let i = 0; i < 20; i += 1) {
      const p = novoPedido();
      assert.match(p.state, ESTADO_DE_LA);
      assert.match(p.verificador, VERIFICADOR_DE_LA);
      assert.match(p.desafio, DESAFIO_DE_LA);
      assert.equal(p.desafio, createHash('sha256').update(p.verificador, 'ascii').digest('base64url'));
    }
  });

  it('nenhum pedido repete o state nem o verificador', () => {
    const muitos = Array.from({ length: 200 }, () => novoPedido());
    assert.equal(new Set(muitos.map((p) => p.state)).size, 200);
    assert.equal(new Set(muitos.map((p) => p.verificador)).size, 200);
  });

  it('a impressão é o sha256 em hexadecimal', () => {
    assert.equal(impressao('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('o endereço da autorização leva o que a página do Regem pede — e nada além', () => {
    const cfg = configDoRegem({ REGEM_APP_URL: 'https://regem.exemplo', FAROL_CONSOLE_URL: 'https://console.exemplo', REGEM_CLIENT_SECRET: 's'.repeat(40) });
    const p = novoPedido();
    const url = new URL(urlDeAutorizacao(cfg, p));
    assert.equal(url.origin + url.pathname, 'https://regem.exemplo/integracoes/autorizar');
    assert.deepEqual(
      Object.fromEntries(url.searchParams),
      {
        cliente: 'farol',
        redirect_uri: 'https://console.exemplo/api/regem/retorno',
        state: p.state,
        code_challenge: p.desafio,
        code_challenge_method: 'S256',
      },
    );
    assert.ok(!url.toString().includes(p.verificador), 'o verificador nunca vai no endereço');
    assert.ok(!url.toString().includes('s'.repeat(40)), 'o segredo nunca vai no endereço');
  });
});

describe('regem: as chamadas, contra um servidor de verdade', () => {
  let falso: RegemFalso;
  let cfg: ConfigDoRegem & { segredo: string; chave: Buffer };
  const RETORNO = 'https://console.exemplo/api/regem/retorno';

  before(async () => {
    falso = await subirRegemFalso();
    cfg = {
      apiUrl: falso.url,
      appUrl: 'https://regem.exemplo',
      retornoUrl: RETORNO,
      consoleUrl: 'https://console.exemplo',
      segredo: falso.segredo,
      chave: randomBytes(32),
      buscar: fetch,
      prazoMs: 400,
      agente: 'farol-api/teste (+https://monitorfarol.com.br)',
    };
  });
  after(async () => {
    await falso.fechar();
  });
  beforeEach(() => {
    falso.modo = 'normal';
    falso.chamadas.length = 0;
  });

  const duasLojas = () => [
    { id: randomUUID(), nome: 'Casa do Lanche · Centro' },
    { id: randomUUID(), nome: 'Casa do Lanche · Barra' },
  ];
  /** O presidente autorizou lá: o código e o verificador que o Farol guardou. */
  function autorizado(lojas = duasLojas(), redirectUri = RETORNO) {
    const p = novoPedido();
    return { lojas, p, codigo: falso.autorizar({ lojas, desafio: p.desafio, redirectUri, empresa: 'Casa do Lanche Ltda' }) };
  }
  async function motivoDe(promessa: Promise<unknown>): Promise<ErroDoRegem> {
    try {
      await promessa;
    } catch (e) {
      assert.ok(e instanceof ErroDoRegem, `esperava ErroDoRegem, veio ${String(e)}`);
      return e;
    }
    return assert.fail('devia ter falhado');
  }

  // ───────────────────────── a troca ─────────────────────────

  it('troca o código pelo acesso de cada loja, com os nomes de lá', async () => {
    const { lojas, p, codigo } = autorizado();
    const r = await trocarCodigo(cfg, { codigo, verificador: p.verificador });

    assert.deepEqual(
      r.map((l) => ({ regemLojaId: l.regemLojaId, nome: l.nome, empresa: l.empresa })),
      lojas.map((l) => ({ regemLojaId: l.id, nome: l.nome, empresa: 'Casa do Lanche Ltda' })),
    );
    for (const l of r) assert.ok(falso.vale(l.acesso), 'o acesso que voltou vale no Regem');
    assert.notEqual(r[0]!.acesso, r[1]!.acesso, 'cada loja tem o seu');
  });

  it('manda exatamente o que o contrato pede, e se identifica', async () => {
    const { p, codigo } = autorizado();
    await trocarCodigo(cfg, { codigo, verificador: p.verificador });

    assert.equal(falso.chamadas.length, 1);
    const c = falso.chamadas[0]!;
    assert.equal(c.caminho, '/integracao/autorizacao/token');
    assert.equal(c.agente, cfg.agente, 'sem nome próprio, a borda do Regem recusa');
    assert.match(String(c.tipo), /^application\/json/);
    assert.equal(c.comAcesso, false);
    assert.deepEqual(c.corpo, {
      code: codigo,
      code_verifier: p.verificador,
      redirect_uri: RETORNO,
      client_id: 'farol',
      client_secret: falso.segredo,
    });
  });

  it('o id da loja volta em minúsculas, venha como vier', async () => {
    const id = randomUUID().toUpperCase();
    const { p, codigo } = autorizado([{ id, nome: 'Loja' }]);
    const r = await trocarCodigo(cfg, { codigo, verificador: p.verificador });
    assert.equal(r[0]!.regemLojaId, id.toLowerCase());
  });

  it('segredo que não é o do Regem: cliente_invalido', async () => {
    const { p, codigo } = autorizado();
    const e = await motivoDe(trocarCodigo({ ...cfg, segredo: 'outro-segredo-com-mais-de-32-caracteres' }, { codigo, verificador: p.verificador }));
    assert.equal(e.motivo, 'cliente_invalido');
    assert.equal(e.status, 401);
  });

  it('o código vale UMA tentativa: usado de novo, é recusado', async () => {
    const { p, codigo } = autorizado();
    await trocarCodigo(cfg, { codigo, verificador: p.verificador });
    const e = await motivoDe(trocarCodigo(cfg, { codigo, verificador: p.verificador }));
    assert.equal(e.motivo, 'recusado');
    assert.equal(e.status, 400);
  });

  it('verificador que não é o do pedido: recusado — e o código foi gasto na tentativa', async () => {
    const { p, codigo } = autorizado();
    const e = await motivoDe(trocarCodigo(cfg, { codigo, verificador: novoPedido().verificador }));
    assert.equal(e.motivo, 'recusado');
    // É por isso que a rota gasta o pedido antes de trocar: não há segunda chance.
    assert.equal((await motivoDe(trocarCodigo(cfg, { codigo, verificador: p.verificador }))).motivo, 'recusado');
  });

  it('endereço de volta diferente do que foi autorizado: recusado', async () => {
    const { p, codigo } = autorizado(duasLojas(), 'https://outro.exemplo/volta');
    assert.equal((await motivoDe(trocarCodigo(cfg, { codigo, verificador: p.verificador }))).motivo, 'recusado');
  });

  it('código que o Regem não conhece, ou vencido: recusado', async () => {
    const p = novoPedido();
    assert.equal((await motivoDe(trocarCodigo(cfg, { codigo: `rgm_ac_${'a'.repeat(43)}`, verificador: p.verificador }))).motivo, 'recusado');
    const vencido = falso.autorizar({ lojas: duasLojas(), desafio: p.desafio, redirectUri: RETORNO, vencido: true });
    assert.equal((await motivoDe(trocarCodigo(cfg, { codigo: vencido, verificador: p.verificador }))).motivo, 'recusado');
  });

  it('Regem fora do ar, pedindo calma, mudo ou desviando: sem_resposta', async () => {
    for (const modo of ['fora', 'devagar', 'mudo', 'desvia'] as const) {
      falso.modo = modo;
      const { p, codigo } = autorizado();
      const comeco = Date.now();
      const e = await motivoDe(trocarCodigo(cfg, { codigo, verificador: p.verificador }));
      assert.equal(e.motivo, 'sem_resposta', modo);
      assert.ok(Date.now() - comeco < 3000, `${modo}: o prazo curto segurou (${Date.now() - comeco} ms)`);
    }
  });

  it('o desvio não é seguido: o segredo não vai parar em outro endereço', async () => {
    falso.modo = 'desvia';
    const { p, codigo } = autorizado();
    await motivoDe(trocarCodigo(cfg, { codigo, verificador: p.verificador }));
    assert.equal(falso.chamadas.length, 1, 'uma chamada, e nenhuma segunda para o destino do desvio');
  });

  it('endereço onde não há ninguém: sem_resposta', async () => {
    const e = await motivoDe(trocarCodigo({ ...cfg, apiUrl: 'http://127.0.0.1:9/api/v1' }, { codigo: 'x', verificador: 'y' }));
    assert.equal(e.motivo, 'sem_resposta');
    assert.equal(e.status, null);
  });

  it('resposta 200 fora do contrato: resposta_torta, e nenhuma loja pela metade', async () => {
    const tortas: Array<[string, (lojas: unknown[]) => unknown]> = [
      ['sem a lista', () => ({})],
      ['lista vazia', () => ({ lojas: [] })],
      ['lista que não é lista', () => ({ lojas: 'duas' })],
      ['nulo', () => null],
      ['loja sem acesso', (l) => ({ lojas: l.map((x) => ({ ...(x as object), token: undefined })) })],
      ['acesso vazio', (l) => ({ lojas: l.map((x) => ({ ...(x as object), token: '   ' })) })],
      ['acesso comprido demais', (l) => ({ lojas: l.map((x) => ({ ...(x as object), token: 'x'.repeat(401) })) })],
      ['loja sem nome', (l) => ({ lojas: l.map((x) => ({ ...(x as object), loja_nome: '' })) })],
      ['loja sem empresa', (l) => ({ lojas: l.map((x) => ({ ...(x as object), empresa_nome: null })) })],
      // um id diferente em cada loja: com o mesmo nas duas, quem recusaria seria a conferência de repetição
      ['id que não é uuid', (l) => ({ lojas: l.map((x, i) => ({ ...(x as object), loja_id: `loja-${i}` })) })],
      ['a mesma loja duas vezes', (l) => ({ lojas: [l[0], l[0]] })],
      ['item que não é objeto', () => ({ lojas: ['uma', 'duas'] })],
      ['lojas demais', (l) => ({ lojas: Array.from({ length: 201 }, () => ({ ...(l[0] as object), loja_id: randomUUID() })) })],
    ];
    for (const [nome, modo] of tortas) {
      falso.modo = modo;
      const { p, codigo } = autorizado();
      const e = await motivoDe(trocarCodigo(cfg, { codigo, verificador: p.verificador }));
      assert.equal(e.motivo, 'resposta_torta', nome);
    }
  });

  it('duzentas lojas ainda cabem', async () => {
    falso.modo = (l) => ({ lojas: Array.from({ length: 200 }, () => ({ ...(l[0] as object), loja_id: randomUUID() })) });
    const { p, codigo } = autorizado();
    assert.equal((await trocarCodigo(cfg, { codigo, verificador: p.verificador })).length, 200);
  });

  it('uma página no lugar do JSON (a borda respondeu, não o Regem): resposta_torta', async () => {
    falso.modo = 'pagina';
    const { p, codigo } = autorizado();
    assert.equal((await motivoDe(trocarCodigo(cfg, { codigo, verificador: p.verificador }))).motivo, 'resposta_torta');
  });

  it('o erro diz o motivo e nunca o conteúdo: nem código, nem verificador, nem segredo', async () => {
    for (const modo of ['normal', 'fora', 'mudo', 'pagina'] as const) {
      const { p, codigo } = autorizado();
      // no modo normal a recusa vem do verificador errado
      const verificador = modo === 'normal' ? novoPedido().verificador : p.verificador;
      falso.modo = modo;
      const e = await motivoDe(trocarCodigo(cfg, { codigo, verificador }));
      const tudo = [String(e), e.message, e.stack ?? '', JSON.stringify(e), JSON.stringify(Object.entries(e))].join('\n');
      for (const segredo of [codigo, verificador, cfg.segredo]) assert.ok(!tudo.includes(segredo), `${modo}: vazou no erro`);
    }
  });

  // ───────────────────────── a devolução ─────────────────────────

  async function umAcesso(): Promise<string> {
    const { p, codigo } = autorizado([{ id: randomUUID(), nome: 'Loja' }]);
    const r = await trocarCodigo(cfg, { codigo, verificador: p.verificador });
    falso.chamadas.length = 0;
    return r[0]!.acesso;
  }

  it('devolve o acesso: ele deixa de valer no Regem', async () => {
    const acesso = await umAcesso();
    await devolverAcesso(cfg, acesso);

    assert.equal(falso.vale(acesso), false);
    const c = falso.chamadas[0]!;
    assert.equal(c.caminho, '/integracao/autorizacao/revogar');
    assert.equal(c.comAcesso, true);
    assert.equal(c.agente, cfg.agente);
    // Sem corpo, não se anuncia corpo: o Regem (como a API daqui) recusa a promessa vazia.
    assert.equal(c.tipo, null);
    assert.equal(c.corpo, null);
  });

  it('acesso que já não valia lá conta como devolvido', async () => {
    const acesso = await umAcesso();
    falso.tirar(acesso);
    await devolverAcesso(cfg, acesso);
    await devolverAcesso(cfg, acesso);
  });

  it('o Regem recusa de outro jeito (403): recusado — não adianta tentar de novo', async () => {
    const acesso = await umAcesso();
    falso.modo = 'proibido';
    const e = await motivoDe(devolverAcesso(cfg, acesso));
    assert.equal(e.motivo, 'recusado');
    assert.equal(e.status, 403);
    assert.ok(!String(e).includes(acesso) && !JSON.stringify(e).includes(acesso), 'o acesso não vai no erro');
  });

  it('200 com uma página no lugar do JSON não conta como devolvido: resposta_torta', async () => {
    // A borda do Regem responde 200 com uma página de espera; tomar isso
    // por "devolvido" apagaria a ligação com o acesso ainda valendo lá.
    const acesso = await umAcesso();
    falso.modo = 'pagina';
    assert.equal((await motivoDe(devolverAcesso(cfg, acesso))).motivo, 'resposta_torta');
    assert.equal(falso.vale(acesso), true);
  });

  it('Regem fora do ar ou mudo: sem_resposta, e o acesso continua valendo lá', async () => {
    const acesso = await umAcesso();
    for (const modo of ['fora', 'devagar', 'mudo'] as const) {
      falso.modo = modo;
      assert.equal((await motivoDe(devolverAcesso(cfg, acesso))).motivo, 'sem_resposta', modo);
    }
    assert.equal(falso.vale(acesso), true);
    // …e, quando ele volta, a devolução passa: nada ficou pelo caminho.
    falso.modo = 'normal';
    await devolverAcesso(cfg, acesso);
    assert.equal(falso.vale(acesso), false);
  });
});
