// Marcar ingredientes (A24 F3; migration 055), de ponta a ponta na API:
//
//   - a loja manda os recortes da noite ao vivo (o corpo de `contratos/recorte-para-marcar.json`): entram uma vez só na
//     gravação `ao-vivo` da noite, mandar de novo troca o que ninguém marcou, e o marcado não muda por baixo;
//   - marcam diretoria, gerência e supervisão; outra conta nem sabe que o recorte existe;
//   - o de cima da pilha vira exemplo da base da loja (a mesma imagem uma vez só por item); "não é ingrediente" vira
//     exemplo do que não é comida; "não dá para ver" não ensina; marcar de novo troca o exemplo;
//   - o acerto compara o nome do juiz com o de cima (o outro nome conta como o das fichas);
//   - a imagem do marcado sai em 30 dias, e o recorte que ninguém marcou sai inteiro; o exemplo fica.

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { contarBase, impressaoDaBase, type Base } from '../src/fichas.js';
import { chaveDoIngrediente } from '../src/ingredientes.js';
import {
  acertouORecorte,
  deCima,
  lerMarcacao,
  lerRecortesParaMarcar,
  MAX_NA_PILHA,
  MAX_RECORTES_POR_ENVIO,
  MAX_RECORTES_POR_NOITE,
  nomesParaMarcar,
  type Marcacao,
} from '../src/marcar.js';
import { apagarRecortesVencidos } from '../src/rotas/marcar.js';
import { NOME_DO_NADA } from '../src/treino.js';

type Recorte = Record<string, unknown> & { chave: string; imagemBase64: string };
type Corpo = { gravacao: Record<string, unknown>; recortes: Recorte[] };
const CONTRATO = JSON.parse(readFileSync(new URL('../../contratos/recorte-para-marcar.json', import.meta.url), 'utf8')) as {
  corpo: Corpo;
  limites: { recortesPorEnvio: number; recortesPorNoite: number };
};
const BASE = (JSON.parse(readFileSync(new URL('../../contratos/fichas-da-loja.json', import.meta.url), 'utf8')) as { resposta: { base: Base } }).resposta.base;
const copia = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const CORPO = () => copia(CONTRATO.corpo);
const NOMES = ['Pão brioche', 'Blend da casa', 'Queijo prato', 'Cebola roxa', 'Sal', 'Bacon fatiado', 'Ovo frito'];
const SEM_OUTROS = new Map<string, string>();

/** Um JPEG com outros bytes (um comentário logo depois do começo): a mesma imagem para a API, outro sha256. */
function variante(base64: string, n: number): string {
  const b = Buffer.from(base64, 'base64');
  const texto = Buffer.from(`v${n}`);
  const com = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from([0, texto.length + 2]), texto]);
  return Buffer.concat([b.subarray(0, 2), com, b.subarray(2)]).toString('base64');
}
const sha = (base64: string) => createHash('sha256').update(Buffer.from(base64, 'base64')).digest('hex');
const pilha = (...nomes: Array<string | [string, number]>): Marcacao => ({
  estado: 'pilha',
  pilha: nomes.map((n) => (Array.isArray(n) ? { nome: n[0], vezes: n[1] } : { nome: n, vezes: 1 })),
  obs: null,
});

describe('os recortes para marcar e a marcação (sem banco)', () => {
  it('o contrato segue os limites da API', () => {
    assert.equal(CONTRATO.limites.recortesPorEnvio, MAX_RECORTES_POR_ENVIO);
    assert.equal(CONTRATO.limites.recortesPorNoite, MAX_RECORTES_POR_NOITE);
  });

  it('lê o corpo do contrato: a noite ao vivo e os recortes, com a nota, o contorno e o tamanho da imagem', () => {
    const r = lerRecortesParaMarcar(CORPO());
    assert.ok(!('problema' in r), JSON.stringify(r));
    assert.equal(r.gravacao.origem, 'ao-vivo');
    assert.equal(r.recortes.length, 2);
    const [a, b] = r.recortes;
    assert.deepEqual([a!.chave, a!.lanche, a!.peca, a!.motivo, a!.palpite, a!.nota], ['passos-23h20m05-3/03', 'passos-23h20m05-3', 1, 'duvida', 'Blend da casa', 0.512]);
    assert.ok(a!.contorno && a!.contorno.length >= 1, 'o tracejado do que chegou');
    assert.ok(a!.largura > 0 && a!.altura > 0);
    assert.deepEqual([b!.motivo, b!.palpite, b!.nota, b!.contorno], ['comeco', null, null, null]);
  });

  it('recusa o corpo torto, dizendo o campo', () => {
    const casos: Array<[(c: Corpo) => void, RegExp]> = [
      [
        (c) => {
          c.gravacao.origem = 'gravador';
          c.gravacao.fim = '2026-10-22T20:00:00-03:00';
        },
        /são da noite ao vivo/,
      ],
      [(c) => (c.recortes = []), /de 1 a 25/],
      [(c) => (c.recortes = Array.from({ length: MAX_RECORTES_POR_ENVIO + 1 }, (_, i) => ({ ...c.recortes[0]!, chave: `k${i}` }))), /de 1 a 25/],
      [(c) => (c.recortes[1]!.chave = c.recortes[0]!.chave), /duas vezes/],
      [(c) => (c.recortes[0]!.nota = 1.2), /recortes\[0\]\.nota/],
      [(c) => (c.recortes[0]!.motivo = 'acaso'), /recortes\[0\]\.motivo/],
      [(c) => (c.recortes[0]!.peca = 9), /recortes\[0\]\.peca/],
      [(c) => (c.recortes[0]!.hora = 'ontem'), /recortes\[0\]\.hora/],
      [(c) => (c.recortes[0]!.contorno = [[[1, 2]]]), /recortes\[0\]\.contorno/],
      [(c) => (c.recortes[1]!.imagemBase64 = Buffer.from('não é jpeg').toString('base64')), /recortes\[1\]: não é um JPEG/],
      [(c) => (c.recortes[1]!.imagemBase64 = ''), /recortes\[1\]: faltou a imagem/],
      [(c) => (c.gravacao.chave = ''), /gravacao\.chave/],
    ];
    for (const [estragar, motivo] of casos) {
      const c = CORPO();
      estragar(c);
      const r = lerRecortesParaMarcar(c);
      assert.ok('problema' in r, `devia recusar: ${motivo}`);
      assert.match(r.problema, motivo);
    }
  });

  it('a marcação: os nomes viram os das fichas, o outro nome conta, a pilha pode repetir um nome mais abaixo', () => {
    const outros = new Map([[chaveDoIngrediente('Hambúrguer da casa'), 'Blend da casa']]);
    const m = lerMarcacao(
      { estado: 'pilha', pilha: [{ nome: 'queijo PRATO' }, { nome: 'Hambúrguer da casa', vezes: 2 }, { nome: 'Queijo prato' }, { nome: 'pao de brioche' }], obs: '  o corte pegou a borda  ' },
      NOMES,
      outros,
    );
    assert.ok(!('problema' in m), JSON.stringify(m));
    assert.deepEqual(m.pilha, [
      { nome: 'Queijo prato', vezes: 1 },
      { nome: 'Blend da casa', vezes: 2 },
      { nome: 'Queijo prato', vezes: 1 },
      { nome: 'Pão brioche', vezes: 1 },
    ]);
    assert.equal(m.obs, 'o corte pegou a borda');
    assert.equal(deCima(m), 'Queijo prato');
    const nada = lerMarcacao({ estado: 'nada', obs: '   ' }, NOMES, SEM_OUTROS);
    assert.deepEqual(nada, { estado: 'nada', pilha: [], obs: null });
    assert.equal(deCima(nada as Marcacao), null);
    assert.deepEqual(lerMarcacao({ estado: 'nao-da', pilha: [] }, NOMES, SEM_OUTROS), { estado: 'nao-da', pilha: [], obs: null });
  });

  it('recusa a marcação torta, dizendo o campo', () => {
    const casos: Array<[unknown, RegExp]> = [
      [{ estado: 'talvez' }, /estado/],
      [{ estado: 'pilha', pilha: [] }, /de 1 a 12/],
      [{ estado: 'pilha', pilha: Array.from({ length: MAX_NA_PILHA + 1 }, () => ({ nome: 'Sal' })) }, /de 1 a 12/],
      [{ estado: 'pilha', pilha: [{ nome: 'Picanha' }] }, /"Picanha" não está nas fichas/],
      [{ estado: 'pilha', pilha: [{ nome: 'Sal', vezes: 0 }] }, /pilha\[0\]\.vezes/],
      [{ estado: 'pilha', pilha: [{ nome: 'Sal', vezes: 1.5 }] }, /pilha\[0\]\.vezes/],
      [{ estado: 'pilha', pilha: [{ nome: '' }] }, /pilha\[0\]\.nome/],
      [{ estado: 'nada', pilha: [{ nome: 'Sal' }] }, /vazia quando o estado é "nada"/],
      [{ estado: 'pilha', pilha: [{ nome: 'Sal' }], obs: 'x'.repeat(301) }, /obs/],
      [{ estado: 'pilha', pilha: 'Sal' }, /pilha/],
    ];
    for (const [corpo, motivo] of casos) {
      const r = lerMarcacao(corpo, NOMES, SEM_OUTROS);
      assert.ok('problema' in r, `devia recusar: ${motivo}`);
      assert.match(r.problema, motivo);
    }
  });

  it('o acerto: o nome do juiz × o de cima, pela chave e pelo outro nome; sem pilha não conta', () => {
    const outros = new Map([[chaveDoIngrediente('Hambúrguer da casa'), 'Blend da casa']]);
    assert.equal(acertouORecorte('blend DA casa', pilha('Blend da casa', 'Pão brioche'), SEM_OUTROS), true);
    assert.equal(acertouORecorte('Hambúrguer da casa', pilha('Blend da casa'), outros), true);
    assert.equal(acertouORecorte('Pão brioche', pilha('Blend da casa', 'Pão brioche'), SEM_OUTROS), false, 'o de baixo não vale');
    assert.equal(acertouORecorte(null, pilha('Sal'), SEM_OUTROS), false, 'sem nome do juiz, não acertou');
    assert.equal(acertouORecorte('Sal', { estado: 'nada', pilha: [], obs: null }, SEM_OUTROS), null);
    assert.equal(acertouORecorte('Sal', { estado: 'nao-da', pilha: [], obs: null }, SEM_OUTROS), null);
  });

  it('os nomes para a pilha: em grupos, na ordem das fichas, com o "conta" pela unidade da ficha', () => {
    assert.deepEqual(nomesParaMarcar(BASE), [
      { grupo: 'Pães', nomes: [{ nome: 'Pão brioche', conta: false }] },
      { grupo: 'Carnes', nomes: [{ nome: 'Blend da casa', conta: true }] },
      { grupo: 'Queijos', nomes: [{ nome: 'Queijo prato', conta: true }] },
      {
        grupo: 'Outros',
        nomes: [
          { nome: 'Cebola roxa', conta: false },
          { nome: 'Sal', conta: false },
          { nome: 'Bacon fatiado', conta: false },
          { nome: 'Ovo frito', conta: false },
        ],
      },
    ]);
    assert.deepEqual(nomesParaMarcar(null), []);
    // o molho vem antes do queijo; a palavra no nome conta; a carne sempre conta
    const outra = copia(BASE);
    outra.produtos[0]!.ficha!.ingredientes.push(
      { nome: 'Molho cheddar', quantidade: 30, unidade: 'g', preparo: false, insumoId: null, fichaId: null },
      { nome: 'Cheddar cremoso', quantidade: 30, unidade: 'g', preparo: false, insumoId: null, fichaId: null },
      { nome: 'Anel de cebola empanada', quantidade: 3, unidade: null, preparo: false, insumoId: null, fichaId: null },
      { nome: 'Frango recheado', quantidade: 0.1, unidade: 'kg', preparo: false, insumoId: null, fichaId: null },
      { nome: 'Ovo', quantidade: 1, unidade: 'un.', preparo: false, insumoId: null, fichaId: null },
    );
    const grupos = Object.fromEntries(nomesParaMarcar(outra).map((g) => [g.grupo, g.nomes]));
    assert.deepEqual(grupos.Molhos, [{ nome: 'Molho cheddar', conta: false }]);
    assert.deepEqual(grupos.Queijos, [{ nome: 'Queijo prato', conta: true }, { nome: 'Cheddar cremoso', conta: false }]);
    assert.deepEqual(grupos.Carnes, [{ nome: 'Blend da casa', conta: true }, { nome: 'Frango recheado', conta: true }]);
    assert.ok(grupos.Outros!.some((n) => n.nome === 'Anel de cebola empanada' && n.conta));
    assert.ok(grupos.Outros!.some((n) => n.nome === 'Ovo' && n.conta), 'un. na ficha');
  });
});

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-marcar-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-marcar';
const SENHA = 'uma senha longa o bastante';

describe('marcar ingredientes (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  let lojaId = '';
  let tenantId = '';
  let token = '';
  let cookie = '';
  let cookieSupervisao = '';
  let cookieExecucao = '';
  let cookieVizinho = '';
  let pontoVizinho = '';
  let gravacaoId = '';
  const ids: Record<string, string> = {};

  async function entrar(tenant: string, email: string, nivel: string) {
    await app.inject({ method: 'POST', url: '/v1/distribuicao/usuarios', headers: { 'x-farol-admin': ADMIN }, payload: { tenantId: tenant, nome: `Pessoa ${nivel}`, email, senha: SENHA, nivel } });
    const r = await app.inject({ method: 'POST', url: '/v1/sessao', payload: { email, senha: SENHA } });
    const b = r.headers['set-cookie'];
    return (Array.isArray(b) ? b[0]! : String(b)).split(';')[0]!;
  }
  async function novoAgente(loja: string, quem: string) {
    const a = (await app.inject({ method: 'POST', url: '/v1/distribuicao/agentes', headers: { 'x-farol-admin': ADMIN }, payload: { lojaId: loja, nome: `PC ${quem}` } })).json();
    const ativar = await app.inject({ method: 'POST', url: '/v1/agentes/ativar', headers: { authorization: `Bearer ${a.token}` }, payload: { fingerprint: `fp-${quem}-${randomUUID().slice(0, 6)}` } });
    assert.equal(ativar.statusCode, 200, ativar.body);
    return a.token as string;
  }
  const mandar = (corpo: unknown, comToken: string | null = token) =>
    app.inject({ method: 'POST', url: '/v1/agentes/treino/recortes', headers: comToken ? { authorization: `Bearer ${comToken}` } : {}, payload: corpo as object });
  const lista = (comCookie: string | null = cookie, loja = lojaId, query = '') =>
    app.inject({ method: 'GET', url: `/v1/lojas/${loja}/treino/recortes${query}`, headers: comCookie ? { cookie: comCookie } : {} });
  const marcar = (id: string, corpo: unknown, comCookie = cookie) =>
    app.inject({ method: 'POST', url: `/v1/treino/recortes/${id}/marcacao`, headers: { cookie: comCookie }, payload: corpo as object });
  const pular = (id: string, comCookie = cookie) => app.inject({ method: 'POST', url: `/v1/treino/recortes/${id}/pular`, headers: { cookie: comCookie } });
  const imagem = (id: string, comCookie = cookie) => app.inject({ method: 'GET', url: `/v1/treino/recortes/${id}/imagem`, headers: { cookie: comCookie } });
  const exemplosDo = async (recorte: string) =>
    (
      await pool.query<{ tipo: string; nome: string; origem: string; sha256: string }>(
        `select b.tipo, b.nome, f.origem, f.sha256 from base_frame f join base_conhecimento b on b.id = f.base_id where f.recorte_id = $1`,
        [recorte],
      )
    ).rows;

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    app = criarApp(pool, { logger: false });
    await app.ready();

    const conta = (await app.inject({ method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN }, payload: { tenant: { nome: marca }, loja: { nome: 'Matriz' }, setores: [{ nome: 'Cozinha' }] } })).json();
    lojaId = conta.loja.id;
    tenantId = conta.tenantId;
    cookie = await entrar(tenantId, `ger-${marca}@e.com`, 'gerente');
    cookieSupervisao = await entrar(tenantId, `sup-${marca}@e.com`, 'supervisao');
    cookieExecucao = await entrar(tenantId, `exe-${marca}@e.com`, 'execucao');
    token = await novoAgente(lojaId, marca);
    const { produtos, comFicha } = contarBase(BASE);
    await pool.query(
      `insert into fichas_da_loja (loja_id, tenant_id, fonte, conteudo, impressao, produtos, com_ficha) values ($1, $2, 'planilha', $3, $4, $5, $6)`,
      [lojaId, tenantId, JSON.stringify(BASE), impressaoDaBase(BASE), produtos, comFicha],
    );

    const vizinha = (await app.inject({ method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN }, payload: { tenant: { nome: `${marca}-vizinha` }, loja: { nome: 'Vizinha' }, setores: [{ nome: 'Cozinha' }] } })).json();
    cookieVizinho = await entrar(vizinha.tenantId, `ger-${marca}-viz@e.com`, 'gerente');
    const ponto = await app.inject({ method: 'POST', url: `/v1/setores/${vizinha.setores[0].id}/pontos`, headers: { cookie: cookieVizinho }, payload: { nome: 'Bancada', origem: 'dvr', canal: 4, host: '192.168.1.108' } });
    assert.equal(ponto.statusCode, 201, ponto.body);
    pontoVizinho = ponto.json().id;
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    // apagar a conta leva junto a gravação, os recortes e os exemplos
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    const sobrou = await pool?.query('select count(*)::int as n from treino_recorte where loja_id = $1', [lojaId]);
    assert.equal(sobrou?.rows[0].n, 0);
    await pool?.end();
  });

  it('a loja manda os recortes: entram na noite ao vivo, uma vez só', async () => {
    const r = await mandar(CORPO());
    assert.equal(r.statusCode, 200, r.body);
    gravacaoId = r.json().gravacaoId;
    const recebidos = r.json().recortes as Array<{ chave: string; id: string; situacao: string; novo: boolean }>;
    assert.deepEqual(recebidos.map((x) => [x.chave, x.situacao, x.novo]), [
      ['passos-23h20m05-3/03', 'marcar', true],
      ['passos-22h12m30-1/00', 'marcar', true],
    ]);
    for (const x of recebidos) ids[x.chave] = x.id;
    const g = (await pool.query('select origem, situacao, loja_id from treino_gravacao where id = $1', [gravacaoId])).rows[0];
    assert.deepEqual([g.origem, g.situacao, g.loja_id], ['ao-vivo', 'pronta', lojaId], 'a loja sai do token');
    const linha = (await pool.query('select sha256, nota, contorno, largura from treino_recorte where id = $1', [ids['passos-23h20m05-3/03']])).rows[0];
    assert.equal(linha.sha256, sha(CONTRATO.corpo.recortes[0]!.imagemBase64));
    assert.ok(Math.abs(linha.nota - 0.512) < 1e-6);
    assert.ok(Array.isArray(linha.contorno) && linha.largura > 0);

    // de novo, com outra imagem: o mesmo recorte, trocado (ninguém marcou)
    const outra = CORPO();
    outra.recortes[1]!.imagemBase64 = variante(outra.recortes[1]!.imagemBase64, 1);
    const deNovo = await mandar(outra);
    assert.equal(deNovo.statusCode, 200, deNovo.body);
    assert.deepEqual((deNovo.json().recortes as Array<{ id: string; novo: boolean }>).map((x) => [x.id, x.novo]), [
      [ids['passos-23h20m05-3/03'], false],
      [ids['passos-22h12m30-1/00'], false],
    ]);
    assert.equal(deNovo.json().gravacaoId, gravacaoId, 'a mesma noite');
    assert.equal((await pool.query('select sha256 from treino_recorte where id = $1', [ids['passos-22h12m30-1/00']])).rows[0].sha256, sha(outra.recortes[1]!.imagemBase64));
    assert.equal((await pool.query('select count(*)::int as n from treino_recorte where loja_id = $1', [lojaId])).rows[0].n, 2);
  });

  it('recusa sem token, com corpo torto, com o canal de outra loja, na noite cancelada e acima do máximo da noite', async () => {
    assert.equal((await mandar(CORPO(), null)).statusCode, 401);
    assert.equal((await mandar(CORPO(), 'farol_nao_existe')).statusCode, 401);
    const torto = CORPO();
    torto.recortes[0]!.motivo = 'acaso';
    const t = await mandar(torto);
    assert.equal(t.statusCode, 422);
    assert.match(t.json().mensagem, /recortes\[0\]\.motivo/);
    const alheio = CORPO();
    alheio.gravacao.pontoId = pontoVizinho;
    const a = await mandar(alheio);
    assert.equal(a.statusCode, 422);
    assert.match(a.json().mensagem, /não é desta loja/);

    // a noite cancelada no console: a loja para de mandar
    const cancelada = CORPO();
    cancelada.gravacao.chave = 'ao-vivo-canal-04-2026-10-20';
    cancelada.recortes = cancelada.recortes.map((x) => ({ ...x, chave: `c-${x.chave}` }));
    assert.equal((await mandar(cancelada)).statusCode, 200);
    await pool.query(`update treino_gravacao set situacao = 'cancelada' where loja_id = $1 and chave = $2`, [lojaId, cancelada.gravacao.chave]);
    const c = await mandar(cancelada);
    assert.equal(c.statusCode, 409);
    assert.equal(c.json().erro, 'gravacao_encerrada');
    await pool.query(`delete from treino_gravacao where loja_id = $1 and chave = $2`, [lojaId, cancelada.gravacao.chave]);

    // o máximo da noite: 299 já lá, chegam 2 novos
    const cheia = CORPO();
    cheia.gravacao.chave = 'ao-vivo-canal-04-2026-10-21';
    cheia.recortes = cheia.recortes.map((x) => ({ ...x, chave: `n-${x.chave}` }));
    const primeiro = await mandar({ ...cheia, recortes: [cheia.recortes[0]] });
    assert.equal(primeiro.statusCode, 200, primeiro.body);
    const noite = primeiro.json().gravacaoId as string;
    await pool.query(
      `insert into treino_recorte (gravacao_id, loja_id, chave, hora, motivo)
       select $1, $2, 'enchendo-' || g, now(), 'cobertura' from generate_series(1, $3) g`,
      [noite, lojaId, MAX_RECORTES_POR_NOITE - 2],
    );
    const passou = await mandar({ ...cheia, recortes: [cheia.recortes[0], cheia.recortes[1], { ...cheia.recortes[1]!, chave: 'n-um-a-mais' }] });
    assert.equal(passou.statusCode, 422);
    assert.match(passou.json().mensagem, /passaria de 300/);
    // mandar de novo os que já estão não conta como novo: cabe
    const cabe = await mandar({ ...cheia, recortes: [cheia.recortes[0], cheia.recortes[1]] });
    assert.equal(cabe.statusCode, 200, cabe.body);
    await pool.query('delete from treino_gravacao where id = $1', [noite]);
  });

  it('a lista: a noite que espera marcação, a dúvida primeiro, os nomes em grupos — e quem vê', async () => {
    const r = await lista();
    assert.equal(r.statusCode, 200, r.body);
    const l = r.json();
    assert.equal(l.noite, gravacaoId);
    assert.deepEqual(l.noites.map((n: { gravacaoId: string; total: number; marcar: number }) => [n.gravacaoId, n.total, n.marcar]), [[gravacaoId, 2, 2]]);
    assert.deepEqual(l.recortes.map((x: { id: string; motivo: string; situacao: string; temImagem: boolean }) => [x.id, x.motivo, x.situacao, x.temImagem]), [
      [ids['passos-23h20m05-3/03'], 'duvida', 'marcar', true],
      [ids['passos-22h12m30-1/00'], 'comeco', 'marcar', true],
    ]);
    assert.equal(l.recortes[0].palpite, 'Blend da casa');
    assert.deepEqual(l.nomes.map((g: { grupo: string }) => g.grupo), ['Pães', 'Carnes', 'Queijos', 'Outros']);
    assert.deepEqual(l.contas, { marcados: 0, comNome: 0, acertou: 0 });
    assert.equal(l.diasDasImagens, 30);
    assert.equal((await lista(cookieSupervisao)).statusCode, 200, 'a supervisão marca');
    assert.equal((await lista(cookieExecucao)).statusCode, 403);
    assert.equal((await lista(null)).statusCode, 401);
    assert.equal((await lista(cookieVizinho)).statusCode, 404, 'outra conta nem sabe que a loja existe');
    assert.equal((await lista(cookie, lojaId, '?gravacao=torto')).statusCode, 422);
  });

  it('a imagem do recorte: só para a conta da loja', async () => {
    const r = await imagem(ids['passos-23h20m05-3/03']!);
    assert.equal(r.statusCode, 200);
    assert.equal(r.headers['content-type'], 'image/jpeg');
    assert.equal(createHash('sha256').update(r.rawPayload).digest('hex'), sha(CONTRATO.corpo.recortes[0]!.imagemBase64));
    assert.equal((await imagem(ids['passos-23h20m05-3/03']!, cookieVizinho)).statusCode, 404);
    assert.equal((await imagem(randomUUID())).statusCode, 404);
  });

  it('marcar a pilha: o de cima vira exemplo da base; marcar de novo troca o exemplo', async () => {
    const id = ids['passos-23h20m05-3/03']!;
    const r = await marcar(id, { estado: 'pilha', pilha: [{ nome: 'blend da casa', vezes: 2 }, { nome: 'Pão brioche' }] }, cookieSupervisao);
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json(), { marcado: true, estado: 'pilha', cima: 'Blend da casa', acertou: true, exemplos: 1 });
    assert.deepEqual(await exemplosDo(id), [{ tipo: 'item', nome: 'Blend da casa', origem: 'bancada', sha256: sha(CONTRATO.corpo.recortes[0]!.imagemBase64) }]);
    const linha = (await pool.query('select situacao, cima, acertou, resposta, marcado_por from treino_recorte where id = $1', [id])).rows[0];
    assert.deepEqual([linha.situacao, linha.cima, linha.acertou], ['marcado', 'Blend da casa', true]);
    assert.deepEqual(linha.resposta.pilha, [{ nome: 'Blend da casa', vezes: 2 }, { nome: 'Pão brioche', vezes: 1 }], 'os nomes das fichas');
    assert.ok(linha.marcado_por);

    const deNovo = await marcar(id, { estado: 'pilha', pilha: [{ nome: 'Queijo prato' }, { nome: 'Blend da casa' }] });
    assert.equal(deNovo.statusCode, 200, deNovo.body);
    assert.deepEqual([deNovo.json().cima, deNovo.json().acertou, deNovo.json().exemplos], ['Queijo prato', false, 1]);
    assert.deepEqual((await exemplosDo(id)).map((e) => e.nome), ['Queijo prato'], 'o exemplo foi trocado, não somado');
  });

  it('a mesma imagem entra uma vez só por item; "não é ingrediente" ensina o que não é comida; "não dá para ver" não ensina', async () => {
    const id = ids['passos-22h12m30-1/00']!;
    // a mesma imagem do primeiro recorte (a do contrato), para o mesmo item que ele ensina agora
    await pool.query('update treino_recorte set sha256 = $2 where id = $1', [id, sha(CONTRATO.corpo.recortes[0]!.imagemBase64)]);
    const igual = await marcar(id, { estado: 'pilha', pilha: [{ nome: 'Queijo prato' }] });
    assert.equal(igual.statusCode, 200, igual.body);
    assert.equal(igual.json().exemplos, 0, 'a base já tem esta imagem para o Queijo prato');
    assert.equal(igual.json().acertou, false, 'o juiz não deu nome ao começo');

    const nada = await marcar(id, { estado: 'nada', obs: 'a tampa da caixa' });
    assert.equal(nada.statusCode, 200, nada.body);
    assert.deepEqual([nada.json().cima, nada.json().acertou, nada.json().exemplos], [null, null, 1]);
    assert.deepEqual((await exemplosDo(id)).map((e) => [e.tipo, e.nome]), [['nada', NOME_DO_NADA]]);

    const naoDa = await marcar(id, { estado: 'nao-da' });
    assert.equal(naoDa.statusCode, 200, naoDa.body);
    assert.equal(naoDa.json().exemplos, 0);
    assert.deepEqual(await exemplosDo(id), [], 'o exemplo de antes saiu');
  });

  it('recusa o nome fora das fichas e o recorte de outra conta, sem mudar nada', async () => {
    const id = ids['passos-23h20m05-3/03']!;
    const r = await marcar(id, { estado: 'pilha', pilha: [{ nome: 'Picanha' }] });
    assert.equal(r.statusCode, 422);
    assert.match(r.json().mensagem, /"Picanha" não está nas fichas/);
    assert.deepEqual((await exemplosDo(id)).map((e) => e.nome), ['Queijo prato'], 'nada mudou');
    assert.equal((await marcar(id, { estado: 'nada' }, cookieVizinho)).statusCode, 404);
    assert.equal((await marcar(id, { estado: 'nada' }, cookieExecucao)).statusCode, 403);
    assert.equal((await marcar(randomUUID(), { estado: 'nada' })).statusCode, 404);
  });

  it('o marcado não muda por baixo quando a loja manda de novo; pular só o que espera', async () => {
    const outra = CORPO();
    outra.recortes[0]!.imagemBase64 = variante(outra.recortes[0]!.imagemBase64, 7);
    outra.recortes[0]!.palpite = 'Sal';
    outra.recortes.push({ ...outra.recortes[1]!, chave: 'passos-23h00m00-2/01', motivo: 'cobertura', imagemBase64: variante(outra.recortes[1]!.imagemBase64, 9) });
    const r = await mandar(outra);
    assert.equal(r.statusCode, 200, r.body);
    const volta = r.json().recortes as Array<{ chave: string; id: string; situacao: string; novo: boolean }>;
    assert.deepEqual(volta.map((x) => [x.chave, x.situacao, x.novo]), [
      ['passos-23h20m05-3/03', 'marcado', false],
      ['passos-22h12m30-1/00', 'marcado', false],
      ['passos-23h00m00-2/01', 'marcar', true],
    ]);
    const marcado = (await pool.query('select sha256, palpite from treino_recorte where id = $1', [ids['passos-23h20m05-3/03']])).rows[0];
    assert.deepEqual([marcado.sha256, marcado.palpite], [sha(CONTRATO.corpo.recortes[0]!.imagemBase64), 'Blend da casa'], 'o que alguém marcou ficou');

    const novo = volta[2]!.id;
    assert.deepEqual((await pular(novo)).json(), { pulado: true });
    assert.deepEqual((await pular(novo)).json(), { pulado: true }, 'pular de novo não muda nada');
    const ja = await pular(ids['passos-23h20m05-3/03']!);
    assert.equal(ja.statusCode, 409);
    assert.equal(ja.json().erro, 'ja_marcado');
    assert.equal((await pular(novo, cookieVizinho)).statusCode, 404);
    // o pulado ainda se marca
    const depois = await marcar(novo, { estado: 'pilha', pilha: [{ nome: 'Sal' }] });
    assert.equal(depois.statusCode, 200, depois.body);
    assert.equal(depois.json().exemplos, 1);
    ids.terceiro = novo;
  });

  it('as contas: os marcados, os que têm ingrediente em cima e os que o juiz acertou', async () => {
    const l = (await lista()).json();
    // 1º: Queijo prato (o juiz disse Blend: errou) · 2º: não dá para ver (fora da conta) · 3º: Sal (o juiz não deu nome)
    assert.deepEqual(l.contas, { marcados: 3, comNome: 2, acertou: 0 });
    assert.deepEqual(l.noites.map((n: { marcar: number; marcados: number; pulados: number }) => [n.marcar, n.marcados, n.pulados]), [[0, 3, 0]]);
    assert.equal(l.noite, gravacaoId, 'sem nada para marcar, a noite mais nova');
  });

  it('30 dias depois: a imagem do marcado sai (o exemplo fica), e o recorte que ninguém marcou sai inteiro', async () => {
    const id = ids['passos-23h20m05-3/03']!;
    const pendente = CORPO();
    pendente.recortes = [{ ...pendente.recortes[1]!, chave: 'passos-02h00m00-1/00', imagemBase64: variante(pendente.recortes[1]!.imagemBase64, 11) }];
    const p = await mandar(pendente);
    assert.equal(p.statusCode, 200, p.body);
    const idPendente = p.json().recortes[0].id as string;
    await pool.query(`update treino_recorte set marcado_em = now() - interval '31 days' where id = $1`, [id]);
    await pool.query(`update treino_recorte set recebido_em = now() - interval '31 days' where id = $1`, [idPendente]);

    const n = await apagarRecortesVencidos(pool);
    assert.ok(n.imagens >= 1 && n.recortes >= 1, JSON.stringify(n));
    assert.equal((await pool.query('select imagem from treino_recorte where id = $1', [id])).rows[0].imagem, null);
    assert.equal((await pool.query('select count(*)::int as n from treino_recorte where id = $1', [idPendente])).rows[0].n, 0);
    assert.deepEqual((await exemplosDo(id)).map((e) => e.nome), ['Queijo prato'], 'o exemplo fica');
    const img = await imagem(id);
    assert.equal(img.statusCode, 404);
    assert.match(img.json().mensagem, /já saiu/);
    const m = await marcar(id, { estado: 'nada' });
    assert.equal(m.statusCode, 409);
    assert.equal(m.json().erro, 'imagem_vencida');
    assert.equal((await lista()).json().recortes.find((x: { id: string }) => x.id === id).temImagem, false);
    // o de agora não sai
    assert.equal((await pool.query('select imagem is not null as tem from treino_recorte where id = $1', [ids.terceiro])).rows[0].tem, true);
  });
});
