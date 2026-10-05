import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { conferirSenha, gerarHash, gerarTokenSessao } from '../src/senha.js';

describe('hash de senha', () => {
  it('confere a senha certa', async () => {
    const h = await gerarHash('uma senha longa o bastante');
    assert.equal(await conferirSenha('uma senha longa o bastante', h), true);
  });

  it('recusa a senha errada', async () => {
    const h = await gerarHash('uma senha longa o bastante');
    assert.equal(await conferirSenha('outra senha qualquer', h), false);
  });

  it('o mesmo texto gera hashes diferentes', async () => {
    // Sal por senha: sem ele, duas pessoas com a mesma senha teriam o
    // mesmo hash, e uma tabela pronta quebraria as duas de uma vez.
    const a = await gerarHash('uma senha longa o bastante');
    const b = await gerarHash('uma senha longa o bastante');
    assert.notEqual(a, b);
  });

  it('guarda os parâmetros dentro do hash', async () => {
    // É o que permite subir o custo no futuro sem invalidar as senhas já
    // guardadas: cada uma se verifica com os parâmetros com que nasceu.
    const h = await gerarHash('uma senha longa o bastante');
    const [alg, n, r, p] = h.split('$');
    assert.equal(alg, 'scrypt');
    assert.equal(Number(n), 2 ** 17);
    assert.equal(Number(r), 8);
    assert.equal(Number(p), 1);
  });

  it('recusa senha curta no SERVIDOR', async () => {
    // Front é sugestão; servidor é garantia.
    await assert.rejects(gerarHash('curta'), /10 caracteres/);
  });

  it('recusa senha vazia', async () => {
    await assert.rejects(gerarHash(''), /10 caracteres/);
  });

  it('acentos iguais escritos de formas diferentes são a mesma senha', async () => {
    // "ação" pode vir composto ou decomposto conforme o teclado e o
    // sistema. Sem normalizar, a pessoa digita a mesma senha no celular
    // e no PC e uma das duas não entra.
    const composto = 'ação com força';
    const decomposto = 'ação com força';
    const h = await gerarHash(composto);
    assert.equal(await conferirSenha(decomposto, h), true);
  });

  it('hash malformado devolve false em vez de estourar', async () => {
    for (const lixo of ['', 'qualquer-coisa', 'scrypt$x$y$z$a$b', 'bcrypt$1$2$3$4$5']) {
      assert.equal(await conferirSenha('uma senha longa o bastante', lixo), false);
    }
  });

  it('o token de sessão tem entropia de sobra', () => {
    const t = gerarTokenSessao();
    assert.ok(t.length >= 40);
    assert.notEqual(t, gerarTokenSessao());
  });
});
