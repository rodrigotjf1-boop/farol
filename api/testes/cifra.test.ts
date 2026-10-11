// A cifra dos acessos guardados. Sem banco.
//
// O que se protege: o acesso de uma loja no Regem fica no banco de um
// jeito que só quem tem a chave do ambiente lê de volta — e que não serve
// colado em outra linha.

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';

import { cifrar, decifrar, lerChave } from '../src/cifra.js';

const chave = randomBytes(32);
const ACESSO = 'rgm_it_3pQm0Jc1b0oXl2vWn8yT5uKd7sZa9eRf4gHh6iLj1kM';

describe('cifra: o segredo que precisa ser lido de volta', () => {
  it('o que foi cifrado volta igual — com acento, vazio e comprido', () => {
    for (const claro of [ACESSO, 'ação — é ñ 日本', '', 'x'.repeat(5000)]) {
      assert.equal(decifrar(cifrar(claro, chave, 'c'), chave, 'c'), claro);
    }
  });

  it('o texto guardado não traz o texto claro, nem em base64', () => {
    const guardado = cifrar(ACESSO, chave, 'c');
    assert.ok(guardado.startsWith('v1.'), guardado.slice(0, 6));
    assert.ok(!guardado.includes(ACESSO));
    assert.ok(!guardado.includes(Buffer.from(ACESSO).toString('base64url')));
    assert.ok(!guardado.includes(Buffer.from(ACESSO).toString('base64')));
  });

  it('cifrar duas vezes o mesmo texto dá dois textos diferentes', () => {
    // Com GCM, repetir o número inicial com a mesma chave entrega o texto.
    const muitos = new Set(Array.from({ length: 50 }, () => cifrar(ACESSO, chave, 'c')));
    assert.equal(muitos.size, 50);
    const numeros = new Set([...muitos].map((g) => g.split('.')[1]));
    assert.equal(numeros.size, 50, 'o número inicial não se repete');
  });

  it('outra chave não lê', () => {
    assert.equal(decifrar(cifrar(ACESSO, chave, 'c'), randomBytes(32), 'c'), null);
  });

  it('outro contexto não lê: o acesso da loja A não serve na linha da loja B', () => {
    const guardado = cifrar(ACESSO, chave, 'acesso:conta-1:loja-a');
    assert.equal(decifrar(guardado, chave, 'acesso:conta-1:loja-b'), null);
    assert.equal(decifrar(guardado, chave, 'acesso:conta-2:loja-a'), null);
    assert.equal(decifrar(guardado, chave, ''), null);
    assert.equal(decifrar(guardado, chave, 'acesso:conta-1:loja-a'), ACESSO);
  });

  it('texto mexido não lê — em qualquer das partes', () => {
    const partes = cifrar(ACESSO, chave, 'c').split('.');
    for (let i = 1; i < partes.length; i += 1) {
      const p = partes[i]!;
      const trocada = [...partes];
      // Troca o PRIMEIRO caractere: o último de um base64 pode carregar
      // bits que não contam, e trocá-lo às vezes não muda byte nenhum.
      trocada[i] = (p[0] === 'A' ? 'B' : 'A') + p.slice(1);
      assert.equal(decifrar(trocada.join('.'), chave, 'c'), null, `parte ${i}`);
    }
  });

  it('formato desconhecido não lê, e não quebra', () => {
    const bom = cifrar(ACESSO, chave, 'c');
    const [, numero, marca, corpo] = bom.split('.');
    const casos: unknown[] = [
      '',
      'v1',
      'v1...',
      ACESSO,
      `v2.${numero}.${marca}.${corpo}`,
      `${numero}.${marca}.${corpo}`,
      `${bom}.sobra`,
      // marca curta: aceitar daria a quem forja 2^32 tentativas em vez de 2^128
      `v1.${numero}.${marca!.slice(0, 6)}.${corpo}`,
      `v1.${numero}..${corpo}`,
      `v1..${marca}.${corpo}`,
      null,
      undefined,
      42,
    ];
    for (const caso of casos) assert.equal(decifrar(caso as string, chave, 'c'), null, String(caso).slice(0, 12));
  });
});

describe('cifra: a chave do ambiente', () => {
  it('aceita 32 bytes em base64 (o que `openssl rand -base64 32` devolve), com ou sem o `=`', () => {
    const b64 = chave.toString('base64');
    assert.equal(b64.length, 44);
    assert.deepEqual(lerChave(b64), chave);
    assert.deepEqual(lerChave(b64.replace(/=$/, '')), chave);
    assert.deepEqual(lerChave(`  ${b64}\n`), chave, 'espaço e quebra de linha em volta não contam');
    assert.deepEqual(lerChave(chave.toString('base64url')), chave, 'a forma de endereço também vale');
  });

  it('recusa o que não é uma chave: ausente, curta, comprida, com outro texto', () => {
    const casos = [
      undefined,
      '',
      '   ',
      randomBytes(16).toString('base64'),
      randomBytes(31).toString('base64'),
      randomBytes(33).toString('base64'),
      randomBytes(64).toString('base64'),
      'uma senha qualquer que alguém digitou no painel',
      `${'a'.repeat(42)}!`,
      // 43 caracteres válidos e mais texto: não é "a chave e um resto"
      `${chave.toString('base64')}resto`,
    ];
    for (const caso of casos) assert.equal(lerChave(caso), null, String(caso).slice(0, 10));
  });

  it('a chave lida cifra e decifra', () => {
    const lida = lerChave(chave.toString('base64'))!;
    assert.equal(decifrar(cifrar(ACESSO, lida, 'c'), chave, 'c'), ACESSO);
  });
});
