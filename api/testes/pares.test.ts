// A sugestão de pares: qual loja do Farol é cada loja que veio de fora.
// Sem banco.
//
// A regra que se defende é uma só: sugerir apenas quando não há dúvida.
// Sugestão errada que passa despercebida liga as fichas de uma loja à
// cozinha de outra.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { palavras, sugerirPares, type Nomeada } from '../src/pares.js';

const loja = (id: string, nome: string): Nomeada => ({ id, nome });
const pares = (deLa: Nomeada[], daqui: Nomeada[]) => Object.fromEntries(sugerirPares(deLa, daqui));

describe('pares: as palavras que distinguem um nome', () => {
  it('sem acento, sem caixa, sem pontuação e sem repetir', () => {
    assert.deepEqual(palavras('Casa do Lanche · CENTRO — centro'), ['casa', 'lanche', 'centro']);
    assert.deepEqual(palavras('São João / Açaí-Bar'), ['sao', 'joao', 'acai', 'bar']);
  });

  it('o que toda loja tem no nome não conta', () => {
    assert.deepEqual(palavras('Loja da Unidade e Filial das Lojas'), []);
    assert.deepEqual(palavras('Loja 2'), [], 'uma letra ou um algarismo só não distingue');
    assert.deepEqual(palavras('Loja 12'), ['12']);
  });

  it('nome vazio ou ausente não quebra', () => {
    assert.deepEqual(palavras(''), []);
    assert.deepEqual(palavras(undefined as unknown as string), []);
  });
});

describe('pares: a sugestão', () => {
  it('uma loja de cada lado: é ela, com qualquer nome', () => {
    assert.deepEqual(pares([loja('r1', 'Mister Burguer')], [loja('f1', 'Matriz')]), { r1: 'f1' });
  });

  it('duas de cada lado: casa pelo nome, e não pela ordem', () => {
    const r = pares(
      [loja('r-centro', 'Casa do Lanche · Centro'), loja('r-barra', 'Casa do Lanche · Barra')],
      // a ordem daqui é a contrária de propósito
      [loja('f-barra', 'Loja Barra'), loja('f-centro', 'Loja Centro')],
    );
    assert.deepEqual(r, { 'r-centro': 'f-centro', 'r-barra': 'f-barra' });
  });

  it('nome sem nada em comum: não sugere', () => {
    const r = pares([loja('r1', 'Casa do Lanche · Centro'), loja('r2', 'Casa do Lanche · Barra')], [loja('f1', 'Matriz'), loja('f2', 'Shopping')]);
    assert.deepEqual(r, { r1: null, r2: null });
  });

  it('duas lojas daqui empatadas para a mesma de lá: não sugere', () => {
    const r = pares([loja('r1', 'Lanche Centro'), loja('r2', 'Outra')], [loja('f1', 'Centro Norte'), loja('f2', 'Centro Sul')]);
    assert.equal(r.r1, null);
  });

  it('duas lojas de lá querendo a mesma daqui com a mesma força: nenhuma leva', () => {
    const r = pares([loja('r1', 'Lanche Centro'), loja('r2', 'Pizza Centro')], [loja('f1', 'Centro'), loja('f2', 'Barra')]);
    assert.deepEqual(r, { r1: null, r2: null });
  });

  it('duas de lá querendo a mesma daqui: leva a de nome mais parecido, e a outra fica sem', () => {
    const r = pares(
      [loja('r1', 'Lanche Centro Histórico'), loja('r2', 'Pizza Centro')],
      [loja('f1', 'Centro Histórico'), loja('f2', 'Barra')],
    );
    assert.deepEqual(r, { r1: 'f1', r2: null });
  });

  it('a mais parecida ganha da que só tem uma palavra em comum', () => {
    const r = pares(
      [loja('r1', 'Burguer Centro Histórico'), loja('r2', 'Burguer Barra')],
      [loja('f1', 'Centro'), loja('f2', 'Centro Histórico'), loja('f3', 'Barra')],
    );
    assert.deepEqual(r, { r1: 'f2', r2: 'f3' });
  });

  it('sem loja livre daqui, ou sem loja de lá: nada a sugerir', () => {
    assert.deepEqual(pares([loja('r1', 'Centro')], []), { r1: null });
    assert.deepEqual(pares([], [loja('f1', 'Centro')]), {});
  });

  it('uma de lá e várias daqui: só sugere se o nome disser', () => {
    assert.deepEqual(pares([loja('r1', 'Mister Burguer')], [loja('f1', 'Matriz'), loja('f2', 'Filial')]), { r1: null });
    assert.deepEqual(pares([loja('r1', 'Burguer Barra')], [loja('f1', 'Centro'), loja('f2', 'Barra')]), { r1: 'f2' });
  });

  it('nunca sugere a mesma loja daqui para duas de lá', () => {
    const deLa = [loja('r1', 'A Centro'), loja('r2', 'B Centro'), loja('r3', 'C Centro Barra'), loja('r4', 'Barra')];
    const daqui = [loja('f1', 'Centro'), loja('f2', 'Barra'), loja('f3', 'Centro Barra')];
    const usados = [...sugerirPares(deLa, daqui).values()].filter(Boolean);
    assert.equal(new Set(usados).size, usados.length, JSON.stringify(usados));
  });
});
