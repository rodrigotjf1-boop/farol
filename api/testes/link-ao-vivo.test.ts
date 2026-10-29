// O link só do ao vivo (29/10/2026; migration 061): quem configura a loja cria um link que abre SÓ o movimento ao vivo,
// sem login. O código aparece uma vez; o banco guarda a impressão; o link abre a planta sem câmeras e as pessoas sem os
// canais; desligado, vencido, de loja ou conta desativada e o que nunca existiu respondem igual; o código não abre
// nenhuma outra porta (V116); os limites de leitura.

import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { CABECALHO_DO_LINK, gerarCodigoDoLink, LINK_AO_VIVO } from '../src/rotas/link-ao-vivo.js';

const AGORA = JSON.parse(readFileSync(new URL('../../contratos/planta-viva-agora.json', import.meta.url), 'utf8')) as {
  agora: { quando: string; pessoas: Array<{ n: number; x: number; y: number; vx: number; vy: number; canais: string[] }>; canais: string[] };
};
const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');
const DIA_MS = 86_400_000;

describe('o link só do ao vivo (sem banco)', () => {
  it('o código: 32 bytes em base64url (43 letras), um diferente do outro', () => {
    const a = gerarCodigoDoLink();
    const b = gerarCodigoDoLink();
    assert.match(a, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(a, b);
  });
  it('os prazos da tela: 1, 7 e 30 dias (e até desligar)', () => {
    assert.deepEqual([...LINK_AO_VIVO.prazosEmDias], [1, 7, 30]);
  });
});

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-link-ao-vivo-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-link-ao-vivo';
const SENHA = 'uma senha longa o bastante';

describe('o link só do ao vivo (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  let tenantId = '';
  let lojaId = '';
  let lojaB = '';
  let setorId = '';
  let canalId = '';
  let cookie = '';
  let cookieGerente = '';
  let cookieSupervisao = '';
  let cookieVizinho = '';
  let tokenA = '';
  let tokenB = '';
  /** O relógio da memória (a conferência do código, os limites, o ao vivo). */
  let agoraMs = Date.UTC(2026, 9, 29, 12, 0, 0);

  async function entrar(tenant: string, email: string, nivel: string, nome: string) {
    const u = await app.inject({
      method: 'POST', url: '/v1/distribuicao/usuarios', headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId: tenant, nome, email, senha: SENHA, nivel },
    });
    assert.equal(u.statusCode, 201, u.body);
    const r = await app.inject({ method: 'POST', url: '/v1/sessao', payload: { email, senha: SENHA } });
    const b = r.headers['set-cookie'];
    return (Array.isArray(b) ? b[0]! : String(b)).split(';')[0]!;
  }
  async function agenteDa(loja: string, nome: string) {
    const a = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/agentes', headers: { 'x-farol-admin': ADMIN }, payload: { lojaId: loja, nome },
    })).json();
    const ativar = await app.inject({
      method: 'POST', url: '/v1/agentes/ativar', headers: { authorization: `Bearer ${a.token}` }, payload: { fingerprint: `fp-${nome}-${marca}` },
    });
    assert.equal(ativar.statusCode, 200, ativar.body);
    return a.token as string;
  }
  const criar = (payload: object, comCookie = cookie, loja = lojaId) =>
    app.inject({ method: 'POST', url: `/v1/lojas/${loja}/links-ao-vivo`, headers: comCookie ? { cookie: comCookie } : {}, payload });
  const lista = (comCookie = cookie, loja = lojaId) =>
    app.inject({ method: 'GET', url: `/v1/lojas/${loja}/links-ao-vivo`, headers: comCookie ? { cookie: comCookie } : {} });
  const desligar = (link: string, comCookie = cookie, loja = lojaId) =>
    app.inject({ method: 'POST', url: `/v1/lojas/${loja}/links-ao-vivo/${link}/desligar`, headers: comCookie ? { cookie: comCookie } : {} });
  const ver = (codigo: string | null, caminho: '' | '/agora' = '') =>
    app.inject({ method: 'GET', url: `/v1/ver${caminho}`, headers: codigo === null ? {} : { [CABECALHO_DO_LINK]: codigo } });
  const mandarAgora = (token: string, corpo: unknown) =>
    app.inject({ method: 'POST', url: '/v1/planta-viva/agora', headers: { authorization: `Bearer ${token}` }, payload: corpo as object });
  /** Cria um link e devolve o código e o id (201 conferido). */
  async function novo(nome: string, dias: number | null = 30, loja = lojaId, comCookie = cookie) {
    const r = await criar({ nome, dias }, comCookie, loja);
    assert.equal(r.statusCode, 201, r.body);
    const b = r.json();
    return { codigo: b.codigo as string, id: b.link.id as string, link: b.link };
  }
  /** Passa da memória da conferência: a próxima leitura vai ao banco. */
  const esquecer = () => {
    agoraMs += LINK_AO_VIVO.memoriaMs + 1;
  };

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    app = criarApp(pool, { logger: false, relogio: () => agoraMs });
    await app.ready();
    const conta = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome: marca }, loja: { nome: 'Matriz' }, setores: [{ nome: 'Cozinha' }] },
    })).json();
    tenantId = conta.tenantId;
    lojaId = conta.loja.id;
    setorId = conta.setores[0].id;
    const filial = await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId, loja: { nome: 'Filial' }, setores: [{ nome: 'Salão' }] },
    });
    assert.equal(filial.statusCode, 201, filial.body);
    lojaB = filial.json().loja.id;
    cookie = await entrar(tenantId, `dono-${marca}@e.com`, 'presidente', 'Dona da loja');
    cookieGerente = await entrar(tenantId, `ger-${marca}@e.com`, 'gerente', 'Gerente da loja');
    cookieSupervisao = await entrar(tenantId, `sup-${marca}@e.com`, 'supervisao', 'Supervisão');
    const vizinha = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome: `${marca}-vizinha` }, loja: { nome: 'Outra' }, setores: [{ nome: 'Salão' }] },
    })).json();
    cookieVizinho = await entrar(vizinha.tenantId, `dono-${marca}-v@e.com`, 'presidente', 'Vizinho');
    tokenA = await agenteDa(lojaId, 'pc-matriz');
    tokenB = await agenteDa(lojaB, 'pc-filial');
    const canal = await app.inject({
      method: 'POST', url: `/v1/setores/${setorId}/pontos`, headers: { cookie },
      payload: { nome: 'Chapa', origem: 'dvr', canal: 1, host: '192.168.1.108' },
    });
    assert.equal(canal.statusCode, 201, canal.body);
    canalId = canal.json().id;
    const planta = await app.inject({
      method: 'PUT', url: `/v1/lojas/${lojaId}/planta`, headers: { cookie },
      payload: {
        versao: null,
        planta: {
          ambientes: [
            { id: 'coz', nome: 'Cozinha', setorId, x: 0, y: 0, w: 8, h: 6, tipo: 'cozinha' },
            { id: 'sal', nome: 'Salão', setorId: null, x: 0, y: 6, w: 8, h: 4 },
          ],
          moveis: [
            { id: 'chapa', nome: 'Chapa', itemId: null, x: 0.5, y: 0.3, w: 1.8, h: 0.8, alt: 0.9, tipo: 'chapa' },
            { id: 'mesa', nome: 'Mesa 1', itemId: null, x: 2, y: 7, w: 1, h: 1, alt: 0.75 },
          ],
          cameras: [{ pontoId: canalId, x: 0.2, y: 2, alt: 2.2, dir: 0, abertura: 90, alcance: 6 }],
          areas: [{ id: 'fila', nome: 'Fila do balcão', tipo: 'espera', x: 1, y: 6.5, w: 3, h: 1 }],
        },
      },
    });
    assert.equal(planta.statusCode, 200, planta.body);
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  it('quem configura cria; o código aparece uma vez e o banco guarda só a impressão', async () => {
    const r = await criar({ nome: '  Celular do gerente  ', dias: 30 });
    assert.equal(r.statusCode, 201, r.body);
    const { codigo, link } = r.json();
    assert.match(codigo, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(link.nome, 'Celular do gerente', 'o nome sem os espaços das pontas');
    assert.equal(link.situacao, 'valendo');
    assert.equal(link.criadoPor, 'Dona da loja');
    assert.equal(Date.parse(link.venceEm) - Date.parse(link.criadoEm), 30 * DIA_MS, '30 dias desde a criação');
    assert.equal(link.ultimoUsoEm, null);
    assert.equal(link.desligadoEm, null);
    const guardado = (await pool.query('select token_hash, row_to_json(k)::text as tudo from link_ao_vivo k where id = $1', [link.id])).rows[0];
    assert.equal(guardado.token_hash, sha(codigo), 'a impressão do código');
    assert.ok(!guardado.tudo.includes(codigo), 'o código não fica em coluna nenhuma');
    const l = await lista();
    assert.equal(l.statusCode, 200, l.body);
    assert.ok(!l.body.includes(codigo) && !l.body.includes(sha(codigo)), 'a lista não traz o código nem a impressão');
    assert.deepEqual(Object.keys(l.json().links[0]).sort(), ['criadoEm', 'criadoPor', 'desligadoEm', 'desligadoPor', 'id', 'nome', 'situacao', 'ultimoUsoEm', 'venceEm']);
    assert.equal(l.json().maximoValendo, LINK_AO_VIVO.maximoValendoPorLoja);

    // até desligar; 7 dias; o gerente também cria
    assert.equal((await novo('Tablet do escritório', null)).link.venceEm, null);
    const sete = (await novo('Celular do turno', 7, lojaId, cookieGerente)).link;
    assert.equal(Date.parse(sete.venceEm) - Date.parse(sete.criadoEm), 7 * DIA_MS);
    assert.equal(sete.criadoPor, 'Gerente da loja');

    // quem não pode: supervisão, sem sessão, outra conta, loja que não existe
    assert.equal((await criar({ nome: 'x', dias: 30 }, cookieSupervisao)).statusCode, 403);
    assert.equal((await lista(cookieSupervisao)).statusCode, 403);
    assert.equal((await criar({ nome: 'x', dias: 30 }, '')).statusCode, 401);
    assert.equal((await criar({ nome: 'x', dias: 30 }, cookieVizinho)).statusCode, 404);
    assert.equal((await lista(cookieVizinho)).statusCode, 404);
    assert.equal((await criar({ nome: 'x', dias: 30 }, cookie, 'nao-e-uuid')).statusCode, 404);

    // o que não entra
    const recusa = async (payload: object, codigoHttp: number, motivo: RegExp) => {
      const x = await criar(payload);
      assert.equal(x.statusCode, codigoHttp, `${JSON.stringify(payload)} → ${x.body}`);
      assert.match(x.json().mensagem, motivo);
    };
    await recusa({ nome: '', dias: 30 }, 422, /para quem é/);
    await recusa({ nome: '   ', dias: 30 }, 422, /para quem é/);
    await recusa({ nome: 'x'.repeat(41), dias: 30 }, 422, /de 1 a 40/);
    await recusa({ nome: 'x', dias: 2 }, 422, /vale por/);
    await recusa({ nome: 'x', dias: '30' }, 422, /vale por/);
    await recusa({ nome: 'x' }, 422, /vale por/);
    await recusa({ nome: 'x', dias: 30, codigo: 'meu-codigo' }, 400, /gerado pelo servidor/);
    await recusa({ nome: 'x', dias: 30, token: 'meu-codigo' }, 400, /gerado pelo servidor/);
  });

  it('o link abre só o desenho: sem câmera, área de medida, setor da loja nem equipamento do inventário', async () => {
    const { codigo } = await novo('Celular para ver a planta');
    const r = await ver(codigo);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal(r.headers['x-robots-tag'], 'noindex, nofollow');
    const b = r.json();
    assert.deepEqual(Object.keys(b).sort(), ['loja', 'planta', 'venceEm']);
    assert.deepEqual(b.loja, { nome: 'Matriz', fuso: 'America/Sao_Paulo' });
    assert.deepEqual(b.planta, {
      ambientes: [
        { id: 'coz', nome: 'Cozinha', x: 0, y: 0, w: 8, h: 6, tipo: 'cozinha' },
        { id: 'sal', nome: 'Salão', x: 0, y: 6, w: 8, h: 4 },
      ],
      moveis: [
        { id: 'chapa', nome: 'Chapa', x: 0.5, y: 0.3, w: 1.8, h: 0.8, alt: 0.9, tipo: 'chapa' },
        { id: 'mesa', nome: 'Mesa 1', x: 2, y: 7, w: 1, h: 1, alt: 0.75 },
      ],
    });
    for (const nada of [canalId, setorId, 'Fila do balcão', lojaId, tenantId]) assert.ok(!r.body.includes(nada), `não sai: ${nada}`);
  });

  it('as pessoas agora, sem os canais; ler pelo link conta como alguém olhando; cada link vê a SUA loja', async () => {
    const a = await novo('Matriz ao vivo');
    const b = await novo('Filial ao vivo', 30, lojaB);
    assert.deepEqual((await mandarAgora(tokenA, AGORA.agora)).json(), { olhando: false }, 'ninguém olhando ainda');
    const doisNaFilial = {
      quando: AGORA.agora.quando,
      pessoas: [{ n: 9, x: 1, y: 1, vx: 0, vy: 0, canais: [] }],
      canais: [],
    };
    assert.equal((await mandarAgora(tokenB, doisNaFilial)).statusCode, 200);

    const lido = await ver(a.codigo, '/agora');
    assert.equal(lido.statusCode, 200, lido.body);
    assert.equal(lido.headers['cache-control'], 'no-store');
    assert.deepEqual(lido.json(), {
      situacao: 'ao_vivo',
      idadeS: 0,
      quando: AGORA.agora.quando,
      pessoas: AGORA.agora.pessoas.map(({ n, x, y, vx, vy }) => ({ n, x, y, vx, vy })),
    });
    for (const c of AGORA.agora.canais) assert.ok(!lido.body.includes(c), 'o canal que viu a pessoa não sai');
    assert.deepEqual((await mandarAgora(tokenA, AGORA.agora)).json(), { olhando: true }, 'quem lê pelo link olha: o agente manda rápido');
    // V27: o link da filial vê a filial, e só ela
    assert.deepEqual((await ver(b.codigo, '/agora')).json().pessoas, [{ n: 9, x: 1, y: 1, vx: 0, vy: 0 }]);
    assert.equal((await ver(b.codigo)).json().loja.nome, 'Filial');
    // sem sinal: a última posição passou de 30 s
    agoraMs += 31_000;
    assert.deepEqual((await ver(a.codigo, '/agora')).json(), { situacao: 'sem_sinal', idadeS: null, quando: null, pessoas: [] });
  });

  it('desligado, vencido, de loja ou conta desativada, apagada ou que nunca existiu: a mesma resposta, sem dizer de que loja', async () => {
    const naoVale = async (codigo: string | null, porque: string) => {
      for (const caminho of ['', '/agora'] as const) {
        const r = await ver(codigo, caminho);
        assert.equal(r.statusCode, 404, `${porque} (${caminho || 'planta'}): ${r.body}`);
        assert.deepEqual(r.json(), {
          erro: 'link_nao_vale',
          mensagem: 'este link não vale mais: foi desligado, passou do prazo, ou foi copiado pela metade',
        });
      }
    };
    await naoVale(null, 'sem código');
    await naoVale('abc', 'código curto');
    await naoVale(randomBytes(32).toString('base64url'), 'código que nunca existiu');

    // desligado: para NA HORA, mesmo com a conferência na memória (V70: o que está no meio)
    const d = await novo('Vai ser desligado');
    assert.equal((await ver(d.codigo, '/agora')).statusCode, 200);
    const des = await desligar(d.id);
    assert.equal(des.statusCode, 200, des.body);
    assert.equal(des.json().link.situacao, 'desligado');
    assert.equal(des.json().link.desligadoPor, 'Dona da loja');
    await naoVale(d.codigo, 'desligado');
    // desligar de novo (por outra pessoa) não muda a hora nem quem desligou
    const de2 = await desligar(d.id, cookieGerente);
    assert.equal(de2.statusCode, 200);
    assert.equal(de2.json().link.desligadoEm, des.json().link.desligadoEm);
    assert.equal(de2.json().link.desligadoPor, 'Dona da loja');
    // quem não pode desligar
    assert.equal((await desligar(d.id, cookieSupervisao)).statusCode, 403);
    assert.equal((await desligar(d.id, cookieVizinho)).statusCode, 404);
    assert.equal((await desligar(d.id, cookie, lojaB)).statusCode, 404, 'o link é de outra loja');
    assert.equal((await desligar(randomUUID())).statusCode, 404);
    assert.equal((await desligar('nao-e-uuid')).statusCode, 404);

    // vencido: o prazo passou (o banco diz); depois da memória curta, não abre
    const v = await novo('Vai vencer', 1);
    assert.equal((await ver(v.codigo)).statusCode, 200);
    await pool.query(`update link_ao_vivo set criado_em = now() - interval '2 days', vence_em = now() - interval '1 second' where id = $1`, [v.id]);
    esquecer();
    await naoVale(v.codigo, 'vencido');
    assert.equal((await lista()).json().links.find((l: { id: string }) => l.id === v.id).situacao, 'vencido');
    // o prazo vence COM a conferência ainda na memória: vale o relógio de verdade, não espera a memória passar
    const quase = await novo('Vence em segundos', 1);
    await pool.query(`update link_ao_vivo set vence_em = now() + interval '1500 milliseconds' where id = $1`, [quase.id]);
    esquecer();
    assert.equal((await ver(quase.codigo)).statusCode, 200, 'ainda no prazo (e agora na memória)');
    await new Promise((r) => setTimeout(r, 1700));
    await naoVale(quase.codigo, 'venceu com a conferência na memória');

    // loja desativada e conta desativada; voltam a valer quando reativadas
    const f = await novo('Da filial', 30, lojaB);
    await pool.query('update loja set ativa = false where id = $1', [lojaB]);
    esquecer();
    await naoVale(f.codigo, 'loja desativada');
    await pool.query('update loja set ativa = true where id = $1', [lojaB]);
    esquecer();
    assert.equal((await ver(f.codigo)).statusCode, 200);
    await pool.query('update tenant set ativo = false where id = $1', [tenantId]);
    esquecer();
    await naoVale(f.codigo, 'conta desativada');
    await pool.query('update tenant set ativo = true where id = $1', [tenantId]);
    esquecer();
    assert.equal((await ver(f.codigo)).statusCode, 200);

    // loja apagada: o link vai junto
    const c = await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId, loja: { nome: 'Vai fechar' }, setores: [{ nome: 'Cozinha' }] },
    });
    const lojaC = c.json().loja.id as string;
    const lc = await novo('Da loja que fecha', 30, lojaC);
    assert.equal((await ver(lc.codigo)).statusCode, 200);
    await pool.query('delete from loja where id = $1', [lojaC]);
    esquecer();
    await naoVale(lc.codigo, 'loja apagada');
    assert.equal((await pool.query('select 1 from link_ao_vivo where id = $1', [lc.id])).rowCount, 0);
  });

  it('V116: o código do link não abre nenhuma outra porta, e nenhuma outra credencial abre o link', async () => {
    const { codigo } = await novo('Só o ao vivo');
    assert.equal((await ver(codigo)).statusCode, 200);
    const comoSessao = { cookie: `farol_sessao=${codigo}` };
    for (const url of ['/v1/eu', `/v1/lojas/${lojaId}/planta-viva/agora`, `/v1/lojas/${lojaId}/planta`, `/v1/lojas/${lojaId}/links-ao-vivo`, `/v1/lojas/${lojaId}/planta-viva`]) {
      const r = await app.inject({ method: 'GET', url, headers: comoSessao });
      assert.equal(r.statusCode, 401, `como sessão, ${url}: ${r.body}`);
    }
    const comoAgente = { authorization: `Bearer ${codigo}` };
    assert.equal((await app.inject({ method: 'GET', url: '/v1/agentes/configuracao', headers: comoAgente })).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url: '/v1/planta-viva/agora', headers: comoAgente, payload: AGORA.agora })).statusCode, 401);
    const comoAdmin = await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': codigo },
      payload: { tenant: { nome: `${marca}-nao` }, loja: { nome: 'x' }, setores: [{ nome: 'x' }] },
    });
    assert.ok([401, 403].includes(comoAdmin.statusCode), `como chave da distribuição: ${comoAdmin.statusCode}`);
    // o caminho de volta: sessão, agente e distribuição não abrem o link
    const sessao = decodeURIComponent(cookie.split('=').slice(1).join('='));
    for (const outra of [sessao, tokenA, ADMIN]) {
      assert.equal((await ver(outra)).statusCode, 404);
      assert.equal((await ver(outra, '/agora')).statusCode, 404);
    }
    // e o código no endereço (em vez do cabeçalho) não abre: ele não pode ir parar no registro de acesso
    assert.equal((await app.inject({ method: 'GET', url: `/v1/ver?codigo=${codigo}` })).statusCode, 404);
  });

  it('a lista: os que valem primeiro (V80: mesmo os mais velhos), depois os mais novos que pararam; o último uso', async () => {
    // numa loja só para isto, para a conta ser só do que o teste criou (V93)
    const c = await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId, loja: { nome: 'Da lista' }, setores: [{ nome: 'Cozinha' }] },
    });
    const loja = c.json().loja.id as string;
    const velho = await novo('Velho valendo', 30, loja);
    const parado = await novo('Novo desligado', 30, loja);
    const vencido = await novo('Novo vencido', 1, loja);
    // a ordem de criação DISCORDA da pedida: o que vale é o mais velho
    await pool.query(`update link_ao_vivo set criado_em = now() - interval '10 days' where id = $1`, [velho.id]);
    await pool.query(`update link_ao_vivo set criado_em = now() - interval '2 days', vence_em = now() - interval '1 day' where id = $1`, [vencido.id]);
    await pool.query(`update link_ao_vivo set criado_em = now() - interval '1 day' where id = $1`, [parado.id]);
    assert.equal((await desligar(parado.id, cookie, loja)).statusCode, 200);
    const l = (await lista(cookie, loja)).json().links as Array<{ id: string; situacao: string; ultimoUsoEm: string | null }>;
    assert.deepEqual(l.map((x) => [x.id, x.situacao]), [[velho.id, 'valendo'], [parado.id, 'desligado'], [vencido.id, 'vencido']]);
    // o último uso: nulo até alguém abrir; anotado na primeira leitura
    assert.equal(l[0]!.ultimoUsoEm, null);
    assert.equal((await ver(velho.codigo)).statusCode, 200);
    const depois = (await lista(cookie, loja)).json().links[0];
    assert.ok(depois.ultimoUsoEm, 'anotado');
    assert.ok(Math.abs(Date.parse(depois.ultimoUsoEm) - Date.now()) < 60_000);
  });

  it(`no máximo ${LINK_AO_VIVO.maximoValendoPorLoja} valendo por loja; o desligado e o vencido não contam; dois ao mesmo tempo não passam do máximo`, async () => {
    const c = await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId, loja: { nome: 'Do máximo' }, setores: [{ nome: 'Cozinha' }] },
    });
    const loja = c.json().loja.id as string;
    const M = LINK_AO_VIVO.maximoValendoPorLoja;
    const ids: string[] = [];
    for (let i = 0; i < M - 3; i += 1) ids.push((await novo(`Celular ${i}`, 30, loja)).id);
    // Seis pedidos ao mesmo tempo para as três vagas que faltam. O cruzamento é FORÇADO (V30, V124): o teste prende a
    // GRAVAÇÃO na tabela (o modo SHARE deixa contar e não deixa inserir) e só solta depois de os seis estarem presos
    // atrás dele — direto, ou atrás de quem está preso nele. Com a trava da loja, um conta e espera a gravação e os
    // outros esperam a loja: passam um de cada vez, e só três. Sem ela, os seis contam 17 antes de qualquer gravação.
    const trava = await pool.connect();
    let juntos;
    try {
      await trava.query('begin');
      await trava.query('lock table link_ao_vivo in share mode');
      const pidDaTrava = (await trava.query<{ p: number }>('select pg_backend_pid() as p')).rows[0]!.p;
      const pedidos = Array.from({ length: 6 }, (_, i) => criar({ nome: `Junto ${i}`, dias: 30 }, cookie, loja));
      const presos = async () =>
        (await pool.query<{ n: number }>(
          `with recursive presas(pid) as (
             select a.pid from pg_stat_activity a where $1 = any(pg_blocking_pids(a.pid))
             union
             select a.pid from pg_stat_activity a join presas p on p.pid = any(pg_blocking_pids(a.pid))
           ) select count(*)::int as n from presas`,
          [pidDaTrava],
        )).rows[0]!.n;
      const t0 = Date.now();
      let n = 0;
      while ((n = await presos()) < 6 && Date.now() - t0 < 15_000) await new Promise((r) => setTimeout(r, 50));
      assert.equal(n, 6, 'os seis pedidos presos atrás da trava do teste');
      await trava.query('commit');
      juntos = await Promise.all(pedidos);
    } finally {
      await trava.query('rollback').catch(() => {});
      trava.release();
    }
    assert.deepEqual(juntos.map((r) => r.statusCode).sort(), [201, 201, 201, 409, 409, 409], 'a trava da loja segura a conta');
    const passou = await criar({ nome: 'Um a mais', dias: 30 }, cookie, loja);
    assert.equal(passou.statusCode, 409);
    assert.match(passou.json().mensagem, new RegExp(`já tem ${M} links valendo`));
    const valendo = (await pool.query(
      `select count(*)::int as n from link_ao_vivo where loja_id = $1 and desligado_em is null and (vence_em is null or vence_em > now())`,
      [loja],
    )).rows[0].n;
    assert.equal(valendo, M);
    // desligado deixa a vaga; vencido também
    assert.equal((await desligar(ids[0]!, cookie, loja)).statusCode, 200);
    assert.equal((await criar({ nome: 'No lugar do desligado', dias: 30 }, cookie, loja)).statusCode, 201);
    await pool.query(`update link_ao_vivo set criado_em = now() - interval '2 days', vence_em = now() - interval '1 day' where id = $1`, [ids[1]]);
    assert.equal((await criar({ nome: 'No lugar do vencido', dias: 30 }, cookie, loja)).statusCode, 201);
  });

  it('leituras demais por um link: 429 com Retry-After; os outros links seguem; a janela vira e volta', async () => {
    const um = await novo('Lê demais');
    const outro = await novo('Lê pouco');
    for (let i = 0; i < LINK_AO_VIVO.leiturasPorMinuto; i += 1) {
      const r = await ver(um.codigo, '/agora');
      assert.equal(r.statusCode, 200, `leitura ${i + 1}: ${r.body}`);
    }
    const demais = await ver(um.codigo, '/agora');
    assert.equal(demais.statusCode, 429);
    assert.ok(Number(demais.headers['retry-after']) >= 1);
    assert.equal(demais.json().erro, 'devagar');
    assert.equal((await ver(outro.codigo, '/agora')).statusCode, 200, 'o limite é de cada link');
    agoraMs += 60_000;
    assert.equal((await ver(um.codigo, '/agora')).statusCode, 200);
  });

  it('códigos errados demais na API inteira: o desconhecido espera a janela; o link já conferido segue', async () => {
    const bom = await novo('Já conferido');
    assert.equal((await ver(bom.codigo)).statusCode, 200);
    agoraMs += 60_000; // a janela dos errados começa limpa
    assert.equal((await ver(bom.codigo)).statusCode, 200, 'conferido de novo, na memória');
    for (let i = 0; i < LINK_AO_VIVO.codigosErradosPorMinuto; i += 1) {
      assert.equal((await ver(randomBytes(32).toString('base64url'))).statusCode, 404);
    }
    const esperou = await ver(randomBytes(32).toString('base64url'));
    assert.equal(esperou.statusCode, 429);
    assert.ok(Number(esperou.headers['retry-after']) >= 1);
    assert.equal((await ver(bom.codigo, '/agora')).statusCode, 200, 'quem já está na memória não para');
    agoraMs += 60_000;
    assert.equal((await ver(randomBytes(32).toString('base64url'))).statusCode, 404, 'a janela virou');
  });
});
