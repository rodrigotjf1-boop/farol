// Guarda os scripts `.mjs` contra erro de sintaxe.
//
// Eles não são importados por teste nenhum — rodam só dentro do contêiner,
// à mão. Já quebrei dois hoje escrevendo-os por script gerador, e o erro
// só apareceu quando o comando foi executado em produção. `node --check`
// custa milissegundos e fecha essa porta.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PASTA = path.join(AQUI, '..', 'scripts');

const scripts = readdirSync(PASTA).filter((n) => n.endsWith('.mjs'));

describe('scripts do contêiner', () => {
  it('existe pelo menos um', () => {
    assert.ok(scripts.length > 0, 'se a pasta esvaziou, este teste perdeu o sentido');
  });

  for (const nome of scripts) {
    it(`${nome} tem sintaxe válida`, () => {
      // `--check` analisa sem executar: não toca no banco nem na rede.
      execFileSync(process.execPath, ['--check', path.join(PASTA, nome)], {
        stdio: 'pipe',
      });
    });
  }
});
