// A guarda de esquema: aplica as migrations na subida e, se o banco ficar
// atrás do código, recusa os pedidos dizendo o que falta.
//
// Em 07/10/2026 o serviço ficou três minutos recusando tudo, à espera de
// alguém rodar a migration à mão. Desde 08/10 quem aplica é a subida. O que
// tem de ficar provado:
//
//   - a migration é aplicada ANTES de qualquer pedido ser atendido;
//   - se ela falha, a porta fica fechada e a resposta diz qual arquivo;
//   - o que não muda sozinho (SQL que falhou) não é tentado de novo a cada
//     pedido; o que pode mudar (o banco não respondeu) é;
//   - banco que não respondeu na subida deixa de ser "tudo certo para
//     sempre": a guarda confere de novo e fecha a porta se precisar;
//   - `/saude` e `/` ficam de fora, para responder com a porta fechada.
//
// Sem banco: quem confere e quem aplica entram de fora, como funções.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import Fastify, { type FastifyInstance } from 'fastify';

import { instalarGuarda, type MigracaoNaSubida, type Subida } from '../src/guarda.js';
import type { Conferencia } from '../src/preflight.js';

const EM_DIA: Conferencia = { ok: true, aplicadas: 22, noCodigo: '022_x.sql' };
const INALCANCAVEL: Conferencia = { ok: true, aplicadas: 0, motivo: 'banco inalcançável na partida', noCodigo: '023_y.sql' };
const atras = (...pendentes: string[]): Conferencia => ({ ok: false, pendentes, mensagem: 'atrás', noCodigo: pendentes[pendentes.length - 1] ?? null });

/** Um serviço de mentira com a guarda instalada e tudo o que ela fez anotado. */
async function montar(o: {
  conferencias: Conferencia[];
  migracoes?: MigracaoNaSubida[] | null;
  intervaloMs?: number;
}) {
  const app: FastifyInstance = Fastify({ logger: false });
  app.get('/', async () => ({ servico: 'teste' }));
  app.get('/saude', async () => ({ ok: true }));
  app.get('/v1/coisa', async () => ({ coisa: 1 }));

  const visto = { conferiu: 0, migrou: 0, emDia: 0, relogio: 1_000_000 };
  const subida: Subida = { migracao: null };
  // a última resposta da lista vale para sempre
  const proxima = <T>(lista: T[], n: number): T => lista[Math.min(n, lista.length - 1)] as T;

  const { porta } = await instalarGuarda(app, {
    conferir: async () => proxima(o.conferencias, visto.conferiu++),
    migrar: o.migracoes ? async () => proxima(o.migracoes as MigracaoNaSubida[], visto.migrou++) : null,
    subida,
    aoFicarEmDia: () => { visto.emDia += 1; },
    agora: () => visto.relogio,
    intervaloMs: o.intervaloMs ?? 10_000,
  });
  await app.ready();
  const pedir = (url = '/v1/coisa') => app.inject({ method: 'GET', url });
  return { app, porta, subida, visto, pedir };
}

describe('a guarda de esquema na subida', () => {
  it('aplica a migration ANTES de atender, e atende', async () => {
    const s = await montar({ conferencias: [EM_DIA], migracoes: [{ ok: true, aplicadas: ['023_y.sql'] }] });

    // tudo isto aconteceu antes do primeiro pedido
    assert.equal(s.visto.migrou, 1);
    assert.equal(s.visto.conferiu, 1);
    assert.equal(s.visto.emDia, 1, 'o catálogo é copiado quando o banco fica em dia');
    assert.deepEqual(s.subida.migracao, { ok: true, aplicadas: ['023_y.sql'] });
    assert.equal(s.porta.recusando, false);

    const r = await s.pedir();
    assert.equal(r.statusCode, 200);
    assert.equal(s.visto.conferiu, 1, 'com o banco em dia, pedido nenhum confere de novo');
    assert.equal(s.visto.migrou, 1);
    await s.app.close();
  });

  it('migration que falhou: porta fechada, e a resposta diz qual arquivo', async () => {
    const s = await montar({
      conferencias: [atras('023_y.sql', '024_z.sql')],
      migracoes: [{ ok: false, motivo: 'falhou', arquivo: '023_y.sql', codigo: '42P07' }],
    });
    assert.equal(s.porta.recusando, true);
    assert.equal(s.visto.emDia, 0, 'banco atrás do código não copia catálogo');

    const r = await s.pedir();
    assert.equal(r.statusCode, 503);
    const corpo = r.json();
    assert.equal(corpo.erro, 'esquema_desatualizado');
    assert.deepEqual(corpo.pendentes, ['023_y.sql', '024_z.sql']);
    assert.match(corpo.mensagem, /023_y\.sql não pôde ser aplicada na subida/);
    assert.match(corpo.mensagem, /npm run migrar/);
    await s.app.close();
  });

  it('a saúde e a raiz respondem com a porta fechada', async () => {
    const s = await montar({ conferencias: [atras('023_y.sql')], migracoes: [{ ok: false, motivo: 'falhou', arquivo: '023_y.sql' }] });
    assert.equal((await s.pedir('/saude')).statusCode, 200);
    assert.equal((await s.pedir('/')).statusCode, 200);
    assert.equal((await s.pedir('/v1/coisa')).statusCode, 503);
    await s.app.close();
  });

  it('SQL que falhou não é tentado de novo a cada pedido — só se confere', async () => {
    const s = await montar({
      conferencias: [atras('023_y.sql')],
      migracoes: [{ ok: false, motivo: 'falhou', arquivo: '023_y.sql', codigo: '42601' }],
    });
    for (let i = 0; i < 3; i += 1) {
      s.visto.relogio += 11_000;
      assert.equal((await s.pedir()).statusCode, 503);
    }
    assert.equal(s.visto.migrou, 1, 'a migration que falhou não foi reaplicada');
    assert.equal(s.visto.conferiu, 4, 'mas a conferência foi refeita a cada intervalo');
    await s.app.close();
  });

  it('arquivo aplicado que foi editado também não se tenta de novo', async () => {
    const s = await montar({ conferencias: [atras('023_y.sql')], migracoes: [{ ok: false, motivo: 'editada', arquivo: '019_h.sql' }] });
    s.visto.relogio += 11_000;
    await s.pedir();
    assert.equal(s.visto.migrou, 1);
    await s.app.close();
  });

  it('a porta abre sozinha quando alguém resolve: sem reiniciar', async () => {
    const s = await montar({
      conferencias: [atras('023_y.sql'), atras('023_y.sql'), EM_DIA],
      migracoes: [{ ok: false, motivo: 'falhou', arquivo: '023_y.sql' }],
    });
    const fechouEm = s.porta.aceitaDesde;
    assert.equal((await s.pedir()).statusCode, 503);

    s.visto.relogio += 60_000; // alguém rodou o `npm run migrar` nesse meio tempo
    const r = await s.pedir();
    assert.equal(r.statusCode, 200, 'o próprio pedido que conferiu já é atendido');
    assert.equal(s.porta.recusando, false);
    assert.equal(s.porta.aceitaDesde, fechouEm + 60_000, 'o vigia conta o silêncio a partir de quando a porta abriu');
    assert.equal(s.visto.emDia, 1, 'e o catálogo é copiado nessa hora');

    const depois = s.visto.conferiu;
    await s.pedir();
    assert.equal(s.visto.conferiu, depois, 'aberta a porta, ninguém confere de novo');
    await s.app.close();
  });

  it('com a porta fechada, confere no máximo uma vez por intervalo', async () => {
    const s = await montar({ conferencias: [atras('023_y.sql')], migracoes: null });
    for (let i = 0; i < 5; i += 1) await s.pedir();
    assert.equal(s.visto.conferiu, 2, 'a da subida e a do primeiro pedido — as outras quatro esperam o intervalo');
    s.visto.relogio += 10_000;
    await s.pedir();
    assert.equal(s.visto.conferiu, 3);
    await s.app.close();
  });

  it('pedidos que chegam juntos não disparam conferências em paralelo', async () => {
    const s = await montar({ conferencias: [atras('023_y.sql')], migracoes: null });
    const respostas = await Promise.all(Array.from({ length: 8 }, () => s.pedir()));
    assert.ok(respostas.every((r) => r.statusCode === 503));
    assert.equal(s.visto.conferiu, 2);
    await s.app.close();
  });
});

describe('a guarda quando o banco não respondeu na subida', () => {
  it('atende, mas NÃO dá o esquema por certo: confere de novo e aplica quando o banco volta', async () => {
    const s = await montar({
      conferencias: [INALCANCAVEL, EM_DIA],
      migracoes: [{ ok: false, motivo: 'conexao' }, { ok: true, aplicadas: ['023_y.sql'] }],
    });
    assert.equal(s.porta.recusando, false);
    assert.equal(s.visto.emDia, 0, 'sem banco não há o que copiar');

    const r = await s.pedir();
    assert.equal(r.statusCode, 200);
    assert.equal(s.visto.migrou, 2, 'falha de conexão vale tentar de novo: a migration foi aplicada quando o banco voltou');
    assert.deepEqual(s.subida.migracao, { ok: true, aplicadas: ['023_y.sql'] });
    assert.equal(s.visto.emDia, 1, 'e só então o catálogo é copiado');

    await s.pedir();
    assert.equal(s.visto.conferiu, 2, 'com o banco em dia e certo, acabou a conferência');
    await s.app.close();
  });

  it('se o banco volta ATRÁS do código, a porta fecha', async () => {
    // Era o buraco: banco fora do ar na subida virava "esquema em dia" para
    // sempre, e cada pedido que tocasse a coluna nova morria com 500.
    const s = await montar({
      conferencias: [INALCANCAVEL, atras('023_y.sql')],
      migracoes: [{ ok: false, motivo: 'conexao' }, { ok: false, motivo: 'falhou', arquivo: '023_y.sql' }],
    });
    const r = await s.pedir();
    assert.equal(r.statusCode, 503);
    assert.equal(s.porta.recusando, true);
    assert.deepEqual(r.json().pendentes, ['023_y.sql']);
    await s.app.close();
  });

  it('enquanto o banco não volta, segue atendendo e conferindo — sem copiar catálogo a cada vez', async () => {
    const s = await montar({ conferencias: [INALCANCAVEL], migracoes: [{ ok: false, motivo: 'conexao' }] });
    for (let i = 0; i < 3; i += 1) {
      s.visto.relogio += 11_000;
      assert.equal((await s.pedir()).statusCode, 200);
    }
    assert.equal(s.visto.conferiu, 4);
    assert.equal(s.visto.emDia, 0);
    await s.app.close();
  });
});

describe('a guarda com a aplicação automática desligada', () => {
  it('só confere: banco atrás do código recusa, como era antes', async () => {
    const s = await montar({ conferencias: [atras('023_y.sql'), EM_DIA], migracoes: null });
    assert.equal(s.subida.migracao, null);
    const primeiro = await s.pedir();
    // a conferência do primeiro pedido já acha o banco em dia (alguém migrou à mão)
    assert.equal(primeiro.statusCode, 200);
    assert.equal(s.visto.migrou, 0);
    await s.app.close();
  });

  it('a mensagem não fala em subida que não houve', async () => {
    const s = await montar({ conferencias: [atras('023_y.sql')], migracoes: null });
    const corpo = (await s.pedir()).json();
    assert.doesNotMatch(corpo.mensagem, /na subida/);
    assert.match(corpo.mensagem, /npm run migrar/);
    await s.app.close();
  });

  it('banco novo, sem tabela de controle, sobe e copia o catálogo', async () => {
    const s = await montar({ conferencias: [{ ok: true, aplicadas: 0, motivo: 'banco novo, sem tabela de controle', noCodigo: '022_x.sql' }], migracoes: null });
    assert.equal((await s.pedir()).statusCode, 200);
    assert.equal(s.visto.emDia, 1);
    assert.equal(s.visto.conferiu, 1, 'não é dúvida: não fica conferindo');
    await s.app.close();
  });
});
