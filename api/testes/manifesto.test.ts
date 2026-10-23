// O manifesto da porta das fichas (Padrão DMS §13; Hub DMS, F4 parte A): montado do código, servido sem credencial,
// fora da guarda de partida, e o kit do Padrão no modo do manifesto, pela porta e pelo arquivo. Sem banco: a rota não
// usa o banco. O arquivo do repositório (`docs/dms-manifesto.json`) é o que o código monta; com `ATUALIZAR_MANIFESTO=1`,
// este teste o regrava.

import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

import Fastify, { type FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { CAMINHO_MANIFESTO, VERSAO_PACOTE, conferirManifesto } from '../src/dms/integracao-dms.js';
import { instalarGuarda } from '../src/guarda.js';
import { manifestoDaPorta, rotaDoManifesto } from '../src/manifesto.js';
import {
  LIMITE_DE_CONSULTAS_DA_CONTA_POR_MINUTO,
  LIMITE_DE_CONSULTAS_POR_MINUTO,
  LIMITE_DE_ENVIOS_DA_CONTA_POR_HORA,
  LIMITE_DE_ENVIOS_POR_HORA,
} from '../src/rotas/acessos.js';
import { rodarKitManifesto } from './dms/kit-conformidade.mts';

const ARQUIVO = fileURLToPath(new URL('../../docs/dms-manifesto.json', import.meta.url));
const COPIA_DO_PACOTE = fileURLToPath(new URL('../src/dms/integracao-dms.ts', import.meta.url));
const textoDoManifesto = () => `${JSON.stringify(manifestoDaPorta(), null, 2)}\n`;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const manifesto = (): any => manifestoDaPorta();

describe('o manifesto da porta das fichas (Padrão DMS §13)', () => {
  let pool: pg.Pool;
  let app: FastifyInstance;

  before(async () => {
    // a rota não usa o banco: um que não responde basta
    pool = new pg.Pool({ connectionString: 'postgres://ninguem@127.0.0.1:1/nada' });
    app = criarApp(pool, { logger: false });
    await app.ready();
  });

  after(async () => {
    await app?.close();
    await pool?.end().catch(() => {});
  });

  it('passa na conferência do pacote', () => {
    assert.deepEqual(conferirManifesto(manifestoDaPorta()), []);
  });

  it('o arquivo do repositório é o que o código monta (ATUALIZAR_MANIFESTO=1 regrava)', () => {
    if (process.env.ATUALIZAR_MANIFESTO === '1') writeFileSync(ARQUIVO, textoDoManifesto());
    assert.equal(existsSync(ARQUIVO), true, 'falta docs/dms-manifesto.json: rode este teste com ATUALIZAR_MANIFESTO=1');
    assert.equal(readFileSync(ARQUIVO, 'utf8').replace(/\r\n/g, '\n'), textoDoManifesto());
  });

  it('as duas rotas da porta, o envio por substituição e os limites tirados das constantes da própria porta', () => {
    const m = manifesto();
    assert.deepEqual(Object.keys(m.paths), ['/v1/integracao/fichas']);
    const { put, get } = m.paths['/v1/integracao/fichas'];
    assert.equal(put['x-dms-escrita'], 'substituicao');
    assert.equal(put['x-dms-permissao'], null);
    assert.equal(get['x-dms-permissao'], null);
    assert.deepEqual(put['x-dms-limite'], [
      { porHora: LIMITE_DE_ENVIOS_POR_HORA, por: 'chave' },
      { porHora: LIMITE_DE_ENVIOS_DA_CONTA_POR_HORA, por: 'empresa' },
    ]);
    assert.deepEqual(m['x-dms-limite'], [
      { porMinuto: LIMITE_DE_CONSULTAS_POR_MINUTO, por: 'chave' },
      { porMinuto: LIMITE_DE_CONSULTAS_DA_CONTA_POR_MINUTO, por: 'empresa' },
    ]);
    assert.match(put.summary, /somente_validar=true/);
  });

  it('a credencial é só o acesso próprio; sem permissões nomeadas, ferramentas nem avisos', () => {
    const m = manifesto();
    assert.deepEqual(m.security, [{ acessoProprio: [] }]);
    assert.deepEqual(Object.keys(m.components.securitySchemes), ['acessoProprio']);
    assert.deepEqual(m['x-dms-permissoes'], {});
    assert.deepEqual(m['x-dms-ferramentas'], []);
    assert.deepEqual(m['x-dms-avisos'], []);
    assert.equal('x-dms-mcp' in m, false);
  });

  it('o produto, a versão do contrato, a da cópia do pacote e o endereço público', () => {
    const m = manifesto();
    assert.equal(m.info['x-dms-produto'], 'farol');
    assert.equal(m.info.version, '1.0.0');
    assert.equal(m.info['x-dms-pacote'], VERSAO_PACOTE);
    assert.deepEqual(m.servers, [{ url: 'https://api.monitorfarol.com.br' }]);
  });

  it('a rota responde sem credencial, em JSON, com o cache de 5 minutos, o mesmo que o código monta', async () => {
    const r = await app.inject({ method: 'GET', url: CAMINHO_MANIFESTO });
    assert.equal(r.statusCode, 200);
    assert.match(String(r.headers['content-type']), /application\/json/);
    assert.equal(r.headers['cache-control'], 'public, max-age=300');
    assert.deepEqual(r.json(), JSON.parse(JSON.stringify(manifestoDaPorta())));
    assert.equal(manifestoDaPorta(), manifestoDaPorta(), 'montado uma vez');
  });

  it('com a guarda recusando (o banco atrás do código), o manifesto segue no ar e o resto leva 503', async () => {
    const servico = Fastify({ logger: false });
    rotaDoManifesto(servico);
    servico.get('/v1/coisa', async () => ({ coisa: 1 }));
    await instalarGuarda(servico, {
      conferir: async () => ({ ok: false, pendentes: ['050_x.sql'], mensagem: 'atrás', noCodigo: '050_x.sql' }),
      migrar: null,
      agora: () => 1_000_000,
    });
    await servico.ready();
    try {
      assert.equal((await servico.inject({ method: 'GET', url: CAMINHO_MANIFESTO })).statusCode, 200);
      assert.equal((await servico.inject({ method: 'GET', url: '/v1/coisa' })).statusCode, 503);
    } finally {
      await servico.close();
    }
  });

  it('o kit do Padrão, no modo do manifesto, passa pela porta (sem credencial) e pelo arquivo do repositório', async () => {
    const servico = criarApp(pool, { logger: false });
    const base = await servico.listen({ port: 0, host: '127.0.0.1' });
    try {
      for (const fonte of [{ base }, { arquivo: ARQUIVO }]) {
        const resultados = await rodarKitManifesto({ modo: 'manifesto', produto: 'farol', ...fonte, copiaDoPacote: COPIA_DO_PACOTE });
        const resumo = resultados.map((r) => `${r.ok ? (r.pulado ? '·' : '✓') : '✗'} ${r.nome}: ${r.detalhe}`).join('\n');
        assert.deepEqual(resultados.filter((r) => !r.ok).map((r) => r.nome), [], resumo);
        assert.deepEqual(resultados.map((r) => r.nome), ['copia-do-pacote', 'manifesto-chega', 'manifesto-formato', 'manifesto-do-produto'], resumo);
      }
    } finally {
      await servico.close();
    }
  });
});
