// Testes que não precisam de banco: validação da entrada e o tratamento
// do token. Os que tocam SQL ficam em `integracao.test.ts` e só rodam com
// um Postgres de verdade — SQL em string não se confere lendo.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { hashDoToken, hashesIguais } from '../src/auth.js';
import { validarEvento } from '../src/rotas/eventos.js';

const UUID_OK = '11111111-2222-3333-4444-555555555555';

function evento(extra: Record<string, unknown> = {}) {
  return {
    idempotenciaKey: 'abc123',
    regraId: UUID_OK,
    ocorridoEm: '2026-10-04T12:00:00.000Z',
    veredito: 'nao_conforme',
    ...extra,
  };
}

describe('validarEvento', () => {
  it('aceita o mínimo', () => {
    assert.equal(validarEvento(evento(), 0), null);
  });

  it('aceita o completo', () => {
    const e = evento({
      confianca: 0.93,
      motivo: 'restos no canto direito',
      midiaUrl: 'https://exemplo/1.jpg',
      modelo: 'claude-haiku-4-5-20251001',
      via: 'nuvem',
      tokensEntrada: 1200,
      tokensSaida: 80,
      custoCentavos: 0.42,
      latenciaMs: 1310,
      prioridade: 'intermediaria',
      emLote: false,
      embedding: Array.from({ length: 768 }, () => 0.1),
    });
    assert.equal(validarEvento(e, 0), null);
  });

  it('exige a chave de idempotência', () => {
    const p = validarEvento(evento({ idempotenciaKey: '  ' }), 3);
    assert.match(String(p), /eventos\[3\]\.idempotenciaKey/);
  });

  it('exige uuid na regra', () => {
    assert.match(String(validarEvento(evento({ regraId: 'r1' }), 0)), /regraId/);
  });

  it('recusa veredito fora do domínio do banco', () => {
    // O CHECK da migration recusaria com 23514; melhor dizer antes, e com
    // a lista de opções, do que devolver erro de banco ao agente.
    const p = validarEvento(evento({ veredito: 'talvez' }), 0);
    assert.match(String(p), /veredito/);
    assert.match(String(p), /nao_avaliavel/);
  });

  it('recusa confiança fora de 0..1', () => {
    assert.match(String(validarEvento(evento({ confianca: 1.5 }), 0)), /confianca/);
    assert.match(String(validarEvento(evento({ confianca: -0.1 }), 0)), /confianca/);
  });

  it('aceita confiança nos extremos', () => {
    assert.equal(validarEvento(evento({ confianca: 0 }), 0), null);
    assert.equal(validarEvento(evento({ confianca: 1 }), 0), null);
  });

  it('recusa data que não é data', () => {
    assert.match(String(validarEvento(evento({ ocorridoEm: 'ontem' }), 0)), /ocorridoEm/);
  });

  it('recusa embedding de dimensão errada', () => {
    // Trocar o modelo de embedding sem perceber é exatamente o tipo de
    // mudança que passa calada e estraga a busca inteira.
    const p = validarEvento(evento({ embedding: Array(512).fill(0.1) }), 0);
    assert.match(String(p), /768/);
  });

  it('recusa embedding com valor não finito', () => {
    const v = Array(768).fill(0.1);
    v[10] = Number.NaN;
    assert.match(String(validarEvento(evento({ embedding: v }), 0)), /finitos/);
  });

  it('recusa via desconhecida', () => {
    assert.match(String(validarEvento(evento({ via: 'telepatia' }), 0)), /via/);
  });

  it('aceita nulos onde o campo é opcional', () => {
    const e = evento({ confianca: null, via: null, embedding: null });
    assert.equal(validarEvento(e, 0), null);
  });

  it('recusa o que não é objeto', () => {
    assert.match(String(validarEvento(null, 0)), /não é objeto/);
    assert.match(String(validarEvento('x', 1)), /não é objeto/);
  });
});

describe('token do agente', () => {
  it('hash é estável e não devolve o token', () => {
    const h = hashDoToken('segredo-qualquer');
    assert.equal(h, hashDoToken('segredo-qualquer'));
    assert.equal(h.length, 64);
    assert.ok(!h.includes('segredo'));
  });

  it('tokens diferentes dão hashes diferentes', () => {
    assert.notEqual(hashDoToken('a'), hashDoToken('b'));
  });

  it('comparação não estoura com tamanhos diferentes', () => {
    // timingSafeEqual lança quando os buffers têm tamanhos diferentes; sem
    // a guarda, um token curto derrubaria a requisição com 500 em vez de
    // devolver 401.
    assert.equal(hashesIguais('abc', 'abcdef'), false);
    assert.equal(hashesIguais('', 'x'), false);
  });

  it('comparação reconhece iguais', () => {
    const h = hashDoToken('t');
    assert.equal(hashesIguais(h, h), true);
  });
});
