// O aplicador de migrations, contra Postgres de verdade.
//
// É o mesmo código para o `npm run migrar` e para a subida do serviço — e
// desde 08/10/2026 é a subida que aplica. Então ele não pode mais imprimir
// e sair: tem de DEVOLVER o que houve, e nunca derrubar quem chamou.
//
// O que tem de ficar provado:
//
//   - aplica em ordem, uma vez só, e a segunda rodada não faz nada;
//   - migration que falha volta atrás INTEIRA, as anteriores continuam
//     valendo, e as seguintes não são tentadas;
//   - arquivo aplicado que foi editado é recusado (mas trocar o fim de
//     linha não é editar);
//   - duas subidas ao mesmo tempo não aplicam a mesma migration duas vezes;
//   - banco fora do ar, pasta ausente, nome fora do padrão: volta dito,
//     não vira exceção.
//
// Cada teste roda num esquema só dele: a tabela de controle de verdade e as
// tabelas do banco de teste não são tocadas.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';

import pg from 'pg';

type Resultado = {
  ok: boolean; motivo?: string; mensagem?: string; arquivo?: string; codigo?: string;
  aplicadas: string[]; pendentes?: string[]; total?: number; jaAplicadas?: number; ultima?: { nome: string } | null;
};
type Opcoes = { url?: string; pasta?: string; soConferir?: boolean; dizer?: (e: { tipo: string }) => void; opcoesDoCliente?: object };
const { migrar, checksum } = (await import('../scripts/migrador.mjs')) as {
  migrar: (o?: Opcoes) => Promise<Resultado>;
  checksum: (sql: string) => string;
};

const URL_DO_BANCO = process.env.DATABASE_URL;

describe('o aplicador de migrations (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let esquema = '';
  let pasta = '';

  const arquivo = (nome: string, sql: string) => writeFileSync(join(pasta, nome), sql, 'utf8');
  const rodar = (mais: Opcoes = {}) => migrar({ url: URL_DO_BANCO, pasta, opcoesDoCliente: { options: `-c search_path=${esquema}` }, ...mais });
  const tabelas = async () =>
    (await pool.query(`select table_name from information_schema.tables where table_schema = $1 order by 1`, [esquema])).rows.map((r) => r.table_name);
  const aplicadasNoBanco = async () =>
    (await pool.query(`select nome from ${esquema}.farol_migracao order by nome`)).rows.map((r) => r.nome);

  before(() => {
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
  });
  after(async () => {
    await pool?.end().catch(() => {});
  });
  beforeEach(async () => {
    esquema = `teste_migrador_${randomUUID().slice(0, 8)}`;
    pasta = mkdtempSync(join(tmpdir(), 'farol-migrador-'));
    await pool.query(`create schema ${esquema}`);
    arquivo('001_a.sql', 'create table um (id int);\n');
    arquivo('002_b.sql', 'create table dois (id int);\n');
  });
  afterEach(async () => {
    await pool.query(`drop schema if exists ${esquema} cascade`);
    rmSync(pasta, { recursive: true, force: true });
  });

  it('aplica em ordem e diz o que aplicou', async () => {
    const eventos: string[] = [];
    const r = await rodar({ dizer: (e) => eventos.push(e.tipo) });

    assert.equal(r.ok, true);
    assert.deepEqual(r.aplicadas, ['001_a.sql', '002_b.sql']);
    assert.equal(r.total, 2);
    assert.equal(r.jaAplicadas, 0);
    assert.equal(r.ultima?.nome, '002_b.sql');
    assert.deepEqual(await aplicadasNoBanco(), ['001_a.sql', '002_b.sql']);
    assert.deepEqual(await tabelas(), ['dois', 'farol_migracao', 'um']);
    assert.deepEqual(eventos, ['inicio', 'aplicando', 'aplicada', 'aplicando', 'aplicada', 'fim', 'ultima']);
  });

  it('a ordem é a do NÚMERO, não a do alfabeto', async () => {
    arquivo('010_dez.sql', 'create table dez (id int);\n');
    arquivo('9_nove.sql', 'create table nove (id int);\n');
    const r = await rodar();
    assert.deepEqual(r.aplicadas, ['001_a.sql', '002_b.sql', '9_nove.sql', '010_dez.sql']);
  });

  it('rodar de novo não aplica nada', async () => {
    await rodar();
    const eventos: string[] = [];
    const r = await rodar({ dizer: (e) => eventos.push(e.tipo) });
    assert.equal(r.ok, true);
    assert.deepEqual(r.aplicadas, []);
    assert.equal(r.jaAplicadas, 2);
    assert.deepEqual(eventos, ['inicio', 'nada', 'ultima']);
  });

  it('só conferir lista o que falta e não aplica', async () => {
    await rodar();
    arquivo('003_c.sql', 'create table tres (id int);\n');
    const r = await rodar({ soConferir: true });
    assert.equal(r.ok, true);
    assert.deepEqual(r.pendentes, ['003_c.sql']);
    assert.deepEqual(r.aplicadas, []);
    assert.deepEqual(await aplicadasNoBanco(), ['001_a.sql', '002_b.sql']);
    assert.ok(!(await tabelas()).includes('tres'));
  });

  it('migration que falha volta atrás inteira; a anterior vale e a seguinte nem é tentada', async () => {
    arquivo('003_c.sql', 'create table tres (id int);\n');
    // cria uma tabela e DEPOIS falha: a tabela não pode ficar
    arquivo('004_d.sql', 'create table quatro (id int);\ncreate table um (id int);\n');
    arquivo('005_e.sql', 'create table cinco (id int);\n');

    const r = await rodar();
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'falhou');
    assert.equal(r.arquivo, '004_d.sql');
    assert.equal(r.codigo, '42P07', 'o código do banco, que não muda com o idioma do servidor');
    assert.match(String(r.mensagem), /004_d\.sql/);
    assert.deepEqual(r.aplicadas, ['001_a.sql', '002_b.sql', '003_c.sql'], 'o que entrou antes da falha continua valendo');
    assert.deepEqual(await aplicadasNoBanco(), ['001_a.sql', '002_b.sql', '003_c.sql']);
    const t = await tabelas();
    assert.ok(t.includes('tres'));
    assert.ok(!t.includes('quatro'), 'nada da migration que falhou ficou no banco');
    assert.ok(!t.includes('cinco'), 'a seguinte não foi tentada');
  });

  it('aplicar e registrar são uma coisa só: se o registro falha, a migration volta atrás', async () => {
    // Um arquivo de várias instruções o Postgres já desfaz sozinho quando
    // uma delas falha. O que só a transação explícita garante é o par
    // "apliquei" + "anotei que apliquei": sem ela, a migration ficaria
    // aplicada e SEM registro — e seria aplicada de novo na próxima subida.
    await rodar();
    // esta migration passa inteira, mas deixa a tabela de controle recusando linha nova
    arquivo('003_c.sql', 'create table tres (id int);\nalter table farol_migracao add constraint nada_entra check (false) not valid;\n');
    const r = await rodar();
    assert.equal(r.ok, false);
    assert.equal(r.arquivo, '003_c.sql');
    assert.equal(r.codigo, '23514', 'quem falhou foi o registro, não o SQL da migration');
    assert.ok(!(await tabelas()).includes('tres'), 'sem registro, a migration não pode ter ficado aplicada');
    assert.deepEqual(await aplicadasNoBanco(), ['001_a.sql', '002_b.sql']);
  });

  it('migration que falhou nunca foi aplicada: consertada, a rodada seguinte continua de onde parou', async () => {
    arquivo('003_c.sql', 'create table um (id int);\n'); // falha: já existe
    assert.equal((await rodar()).ok, false);
    arquivo('003_c.sql', 'create table tres (id int);\n'); // ainda não tinha sido aplicada: pode mudar
    const r = await rodar();
    assert.equal(r.ok, true);
    assert.deepEqual(r.aplicadas, ['003_c.sql']);
  });

  it('arquivo aplicado que foi EDITADO é recusado, e nada é aplicado', async () => {
    await rodar();
    arquivo('001_a.sql', 'create table um (id int, nome text);\n');
    arquivo('003_c.sql', 'create table tres (id int);\n');
    const r = await rodar();
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'editada');
    assert.equal(r.arquivo, '001_a.sql');
    assert.deepEqual(r.aplicadas, []);
    assert.ok(!(await tabelas()).includes('tres'));
  });

  it('trocar o fim de linha não é editar', async () => {
    await rodar();
    arquivo('001_a.sql', 'create table um (id int);\r\n'); // o git do Windows entrega assim
    const r = await rodar();
    assert.equal(r.ok, true);
    assert.equal(checksum('a\r\nb\r\n'), checksum('a\nb\n'));
    assert.notEqual(checksum('a\nb\n'), checksum('a\nc\n'));
  });

  it('duas subidas ao mesmo tempo: cada migration entra uma vez só', async () => {
    arquivo('003_c.sql', 'create table tres (id int);\n');
    const [a, b] = await Promise.all([rodar(), rodar()]);
    assert.equal(a.ok, true, a.mensagem);
    assert.equal(b.ok, true, b.mensagem);
    const juntas = [...a.aplicadas, ...b.aplicadas].sort();
    assert.deepEqual(juntas, ['001_a.sql', '002_b.sql', '003_c.sql'], 'somando as duas, cada uma aparece uma vez');
    assert.deepEqual(await aplicadasNoBanco(), ['001_a.sql', '002_b.sql', '003_c.sql']);
  });

  it('nome fora do padrão é recusado antes de tocar no banco', async () => {
    arquivo('sem-numero.sql', 'create table x (id int);\n');
    const r = await rodar();
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'fora_do_padrao');
    assert.equal(r.arquivo, 'sem-numero.sql');
    assert.ok(!(await tabelas()).includes('um'));
  });

  it('pasta que não existe volta dito, não vira exceção', async () => {
    const r = await rodar({ pasta: join(pasta, 'nao-existe') });
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'sem_pasta');
  });
});

describe('o aplicador sem banco', () => {
  it('sem endereço do banco, diz isso', async () => {
    const r = await migrar({ url: undefined });
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'sem_url');
    assert.match(String(r.mensagem), /DATABASE_URL/);
  });

  it('banco fora do ar: volta "conexao", que é o que a subida tenta de novo', async () => {
    const pasta = mkdtempSync(join(tmpdir(), 'farol-migrador-'));
    writeFileSync(join(pasta, '001_a.sql'), 'select 1;\n');
    const r = await migrar({ url: 'postgres://ninguem@127.0.0.1:1/nada', pasta });
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'conexao');
    assert.deepEqual(r.aplicadas, []);
    rmSync(pasta, { recursive: true, force: true });
  });
});
