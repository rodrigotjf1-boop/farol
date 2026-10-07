// A cópia do catálogo de equipamentos para o banco.
//
// A fonte da verdade são os arquivos de `catalogo/`. O banco guarda uma
// cópia, refeita a cada subida da API. O que se prova aqui:
//
//   - o que está nos arquivos chega ao banco, inteiro;
//   - copiar duas vezes não muda nada;
//   - mudar um arquivo muda UMA linha;
//   - a cópia nunca apaga, e catálogo com defeito não grava pela metade;
//   - nenhuma rota entrega o catálogo — ele é da distribuição.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { acharCatalogo, carregarCatalogo, lerCatalogo } from '../src/catalogo.js';

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-catalogo-${randomUUID().slice(0, 8)}`;

describe('catálogo: dos arquivos para o banco (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  const pasta = acharCatalogo()!;
  const temporarias: string[] = [];

  /** Uma cópia do catálogo que o teste pode estragar à vontade. */
  function copia(): string {
    const destino = mkdtempSync(join(tmpdir(), 'farol-catalogo-'));
    cpSync(pasta, destino, { recursive: true });
    temporarias.push(destino);
    return destino;
  }

  const linha = async (fabricante: string, modelo: string) =>
    (await pool.query(
      `select slug, categoria, status, observacao, nivel, nivel_motivo, serve_para, specs,
              medido, precos, fontes, atualizado_em
         from equipamento where fabricante = $1 and modelo = $2`,
      [fabricante, modelo],
    )).rows[0];

  before(async () => {
    assert.ok(pasta, 'não achei a pasta catalogo/');
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    app = criarApp(pool, { logger: false });
    await app.ready();
    const r = await carregarCatalogo(pool);
    assert.ok(r.ok, `a carga inicial falhou: ${!r.ok && r.motivo}`);
  });

  after(async () => {
    // Devolve o banco ao que os arquivos dizem, e limpa o que o teste criou.
    await carregarCatalogo(pool);
    await pool.query('delete from equipamento where fabricante = $1', [marca]);
    for (const t of temporarias) rmSync(t, { recursive: true, force: true });
    await app?.close();
    await pool?.end();
  });

  it('todo modelo dos arquivos está no banco, com o que o arquivo diz', async () => {
    const { equipamentos } = lerCatalogo(pasta);
    assert.ok(equipamentos.length >= 30);

    const { rows } = await pool.query('select slug from equipamento where slug is not null');
    const noBanco = new Set(rows.map((r) => r.slug));
    for (const e of equipamentos) assert.ok(noBanco.has(e.id), `falta no banco: ${e.id}`);

    // Um modelo conferido campo a campo: "entrou" não basta, o VALOR tem
    // que ser o do arquivo.
    const e = equipamentos.find((x) => x.id === 'intelbras--mhdx-3116-c')!;
    const l = await linha('Intelbras', 'MHDX 3116-C');
    assert.equal(l.slug, e.id);
    assert.equal(l.nivel, 'intermediario');
    assert.equal(l.nivel_motivo, e.nivel_motivo);
    assert.equal(l.status, e.status);
    assert.deepEqual(l.specs, e.specs);
    assert.deepEqual(l.medido, e.medido);
    assert.ok(l.medido.length >= 5, 'as medições de campo têm que ter vindo junto');
    assert.deepEqual(l.precos, e.precos);
    assert.deepEqual(l.fontes, e.fontes);
  });

  it('câmera leva para o banco os usos que sustenta; nobreak fica sem nível', async () => {
    const camera = await linha('Intelbras', 'VIP 3260 Z IA');
    assert.ok(camera.serve_para.includes('acao:montagem'));
    assert.equal(camera.nivel, 'avancado');

    const nobreak = await linha('TS Shara', 'XPro 1500VA 4538');
    assert.equal(nobreak.nivel, null);
    assert.deepEqual(nobreak.serve_para, []);
  });

  it('copiar de novo não muda nada — nem a data da última alteração', async () => {
    const antes = await linha('Intelbras', 'MHDX 3116-C');

    const r = await carregarCatalogo(pool);

    assert.ok(r.ok);
    assert.deepEqual(
      { novos: r.equipamentos.novos, alterados: r.equipamentos.alterados },
      { novos: 0, alterados: 0 },
    );
    assert.deepEqual({ novos: r.usos.novos, alterados: r.usos.alterados }, { novos: 0, alterados: 0 });
    const depois = await linha('Intelbras', 'MHDX 3116-C');
    assert.equal(depois.atualizado_em.getTime(), antes.atualizado_em.getTime());
  });

  it('mudar UM arquivo muda uma linha, e só ela', async () => {
    const outra = copia();
    const arquivo = join(outra, 'equipamentos', 'gravador', 'intelbras--mhdx-1204-c.json');
    const item = JSON.parse(readFileSync(arquivo, 'utf8'));
    item.observacao = `mexido pelo teste ${marca}`;
    item.medido = [{ em: '2026-10-07', onde: 'bancada', metrica: 'teste', valor: 1 }];
    writeFileSync(arquivo, JSON.stringify(item));

    const r = await carregarCatalogo(pool, outra);

    assert.ok(r.ok);
    assert.deepEqual(
      { novos: r.equipamentos.novos, alterados: r.equipamentos.alterados },
      { novos: 0, alterados: 1 },
    );
    const l = await linha('Intelbras', 'MHDX 1204-C');
    assert.equal(l.observacao, `mexido pelo teste ${marca}`);
    assert.equal(l.medido.length, 1);
  });

  it('corrigir a grafia do nome atualiza a MESMA linha, não cria outra', async () => {
    const antes = await pool.query(
      "select id from equipamento where slug = 'intelbras--mhdx-3108-c'",
    );
    const total = (await pool.query('select count(*)::int as n from equipamento')).rows[0].n;
    const outra = copia();
    const arquivo = join(outra, 'equipamentos', 'gravador', 'intelbras--mhdx-3108-c.json');
    const item = JSON.parse(readFileSync(arquivo, 'utf8'));
    item.modelo = 'MHDX 3108 C';   // o mesmo arquivo, o nome escrito de outro jeito
    writeFileSync(arquivo, JSON.stringify(item));

    const r = await carregarCatalogo(pool, outra);

    assert.ok(r.ok, String(!r.ok && r.motivo));
    assert.equal(r.equipamentos.novos, 0);
    const depois = await pool.query(
      "select id, modelo from equipamento where slug = 'intelbras--mhdx-3108-c'",
    );
    assert.equal(depois.rows[0].id, antes.rows[0].id, 'levantamento e diagnóstico apontam para este id');
    assert.equal(depois.rows[0].modelo, 'MHDX 3108 C');
    assert.equal((await pool.query('select count(*)::int as n from equipamento')).rows[0].n, total);
  });

  it('banco recém-criado: a linha que a migration semeou é ADOTADA, não duplicada', async () => {
    // A migration 002 semeia sem `slug`, e com a grafia antiga do nome.
    const id = (await pool.query(
      "select id from equipamento where slug = 'intel--i7-10a-geracao-com-uhd-630'",
    )).rows[0].id;
    await pool.query(
      "update equipamento set slug = null, modelo = 'i7 10a geracao com UHD 630', nivel = null where id = $1",
      [id],
    );
    const total = (await pool.query('select count(*)::int as n from equipamento')).rows[0].n;

    const r = await carregarCatalogo(pool);

    assert.ok(r.ok, String(!r.ok && r.motivo));
    assert.equal(r.equipamentos.novos, 0, 'inserir aqui seria duplicar o modelo');
    const l = (await pool.query('select slug, modelo, nivel from equipamento where id = $1', [id])).rows[0];
    assert.equal(l.slug, 'intel--i7-10a-geracao-com-uhd-630');
    assert.equal(l.modelo, 'i7 10ª geração com UHD 630', 'e ganha a grafia do catálogo');
    assert.equal(l.nivel, 'intermediario');
    assert.equal((await pool.query('select count(*)::int as n from equipamento')).rows[0].n, total);
  });

  it('modelo novo é arquivo novo: entra sem migration', async () => {
    const outra = copia();
    const novo = {
      id: `${marca}--camera-de-teste`,
      categoria: 'camera_ip', fabricante: marca, modelo: 'Camera de teste',
      nivel: 'basico', nivel_motivo: 'só existe neste teste',
      status: 'aceitavel', observacao: 'criado pelo teste',
      serve_para: ['presenca'], specs: { mp: 2 }, medido: [], precos: [], fontes: ['teste'],
    };
    writeFileSync(join(outra, 'equipamentos', 'camera', `${novo.id}.json`), JSON.stringify(novo));

    const r = await carregarCatalogo(pool, outra);

    assert.ok(r.ok);
    assert.equal(r.equipamentos.novos, 1);
    const l = await linha(marca, 'Camera de teste');
    assert.equal(l.slug, novo.id);
    assert.deepEqual(l.serve_para, ['presenca']);
  });

  it('a cópia NUNCA apaga: o que saiu do catálogo fica no banco, e é contado', async () => {
    // A câmera do teste anterior não está nos arquivos de verdade.
    const r = await carregarCatalogo(pool);

    assert.ok(r.ok);
    assert.ok(r.foraDoCatalogo >= 1, 'a linha órfã tinha que ser contada');
    const l = await linha(marca, 'Camera de teste');
    assert.ok(l, 'levantamento e diagnóstico apontam para a linha: ela não pode sumir');
  });

  it('arquivo quebrado não grava nada — nem os arquivos bons', async () => {
    const outra = copia();
    const bom = join(outra, 'equipamentos', 'gravador', 'intelbras--mhdx-1308.json');
    const item = JSON.parse(readFileSync(bom, 'utf8'));
    item.observacao = `não pode entrar ${marca}`;
    writeFileSync(bom, JSON.stringify(item));
    writeFileSync(join(outra, 'equipamentos', 'camera', 'quebrado.json'), '{ "id": "x", ');

    const r = await carregarCatalogo(pool, outra);

    assert.equal(r.ok, false);
    assert.match(String(!r.ok && r.motivo), /quebrado\.json/);
    const l = await linha('Intelbras', 'MHDX 1308');
    assert.notEqual(l.observacao, `não pode entrar ${marca}`, 'o arquivo bom não podia ter entrado sozinho');
  });

  it('pasta sem modelo nenhum é erro, não "carreguei zero"', async () => {
    const vazia = mkdtempSync(join(tmpdir(), 'farol-catalogo-vazio-'));
    temporarias.push(vazia);
    cpSync(join(pasta, 'niveis.json'), join(vazia, 'niveis.json'));
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(vazia, 'equipamentos'));

    const r = await carregarCatalogo(pool, vazia);

    assert.equal(r.ok, false);
    assert.match(String(!r.ok && r.motivo), /nenhum modelo/);
  });

  it('o requisito de cada uso no banco é o que o arquivo diz', async () => {
    const { usos } = lerCatalogo(pasta);
    assert.equal(usos.length, 8);
    const { rows } = await pool.query(
      `select tipo_regra, variante, px_por_cm_min::float8 as px, fps_min::float8 as fps,
              exige_cor, exige_wdr_db, exige_local, quadros_por_analise
         from requisito_uso`,
    );
    for (const u of usos) {
      const l = rows.find((r) => r.tipo_regra === u.tipo_regra && (r.variante ?? null) === u.variante);
      assert.ok(l, `uso sem linha no banco: ${u.id}`);
      assert.equal(l.px, u.px_por_cm_min, `${u.id}: px por cm`);
      assert.equal(l.fps, u.fps_min, `${u.id}: quadros por segundo`);
      assert.equal(l.exige_cor, u.exige_cor, `${u.id}: cor`);
      assert.equal(l.exige_wdr_db, u.exige_wdr_db, `${u.id}: WDR`);
      assert.equal(l.exige_local, u.exige_local, `${u.id}: local`);
      assert.equal(l.quadros_por_analise, u.quadros_por_analise, `${u.id}: quadros por análise`);
    }
    assert.equal(rows.length, usos.length, 'não pode haver uso duplicado no banco');
  });

  it('a saúde diz QUANTOS modelos há — e só isso', async () => {
    const r = await app.inject({ method: 'GET', url: '/saude' });

    assert.equal(r.statusCode, 200);
    const corpo = r.json();
    assert.ok(corpo.catalogoModelos >= lerCatalogo(pasta).equipamentos.length);
    assert.ok(!JSON.stringify(corpo).includes('MHDX'), 'a saúde não pode trazer o catálogo');
  });

  it('nenhuma rota entrega o catálogo: ele é da distribuição', () => {
    // O dono foi explícito (07/10/2026): a base é de uso do projeto, não do
    // usuário; ao usuário chegam soluções e opções. Se um dia alguém
    // registrar /v1/catalogo ou /v1/equipamentos, este teste pede a conversa.
    const rotas = app.printRoutes({ commonPrefix: false });
    assert.doesNotMatch(rotas, /catalogo|equipamento/i);
  });
});
