// Importar os pontos de calibração de um arquivo (27/10/2026): a conta da tela (`web/lib/calibracao-importar.ts`),
// lida pelo caminho. O que tem de ficar provado:
//
//   - cada calibração entra no canal da loja com o mesmo número (ou pelo identificador); fica de fora, com o motivo, o
//     número sem canal, o repetido em dois gravadores, a segunda do mesmo canal e a de pontos de menos ou de mais;
//   - os três jeitos de escrever o arquivo (a lista em `calibracoes`, uma só com `pares`, a lista sozinha);
//   - o que a importação devolve a API aceita ao salvar (`lerCalibracao`);
//   - arquivo torto é recusado com a frase do que falta.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as importar from '../../web/lib/calibracao-importar.ts';
import { lerCalibracao } from '../src/calibracao.js';

const CANAIS: importar.CanalDaLoja[] = [
  { id: '11111111-1111-4111-8111-111111111111', canal: 1, nome: 'Visão geral montagem' },
  { id: '55555555-5555-4555-8555-555555555555', canal: 5, nome: 'Montagem delivery 1' },
  { id: '99999999-9999-4999-8999-999999999991', canal: 9, nome: 'Gravador A, canal 9' },
  { id: '99999999-9999-4999-8999-999999999992', canal: 9, nome: 'Gravador B, canal 9' },
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', canal: null, nome: 'Câmera IP' },
];

/** Pontos de um chão visto de cima por uma câmera simples: a imagem é o piso escalado (dá uma homografia exata). */
const pares = (n: number) =>
  Array.from({ length: n }, (_, i) => {
    const x = 8 + (i % 4) * 0.4, y = 1 + Math.floor(i / 4) * 0.2;
    return { img: [Math.round(((x - 7.8) / 2.2) * 1e5) / 1e5, Math.round(((y - 0.8) / 2.6) * 1e5) / 1e5], piso: [x, y] };
  });
const ler = (o: unknown) => importar.lerArquivoDePontos(JSON.stringify(o), CANAIS);

describe('importar os pontos de calibração', () => {
  it('cada calibração entra no canal com o mesmo número; as que não dá ficam de fora com o motivo', () => {
    const r = ler({
      sobre: 'anotação: fica de fora',
      calibracoes: [
        { canal: 1, pares: pares(12) },
        { canal: 7, pares: pares(8) },
        { canal: 9, pares: pares(8) },
        { canal: 1, pares: pares(9) },
        { canal: 5, pares: pares(3) },
        { pontoId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pares: pares(6) },
        { pares: pares(6) },
      ],
    });
    assert.ok(r.calibracoes, r.problema);
    assert.deepEqual(r.calibracoes!.map((c) => [c.rotulo, c.numero, c.ponto?.nome ?? null, c.motivo]), [
      ['canal 1', 1, 'Visão geral montagem', null],
      ['canal 7', 7, null, 'o canal 7 não está cadastrado no console'],
      ['canal 9', 9, null, 'há 2 canais com o número 9 (gravadores diferentes)'],
      ['canal 1', 1, null, 'o canal 1 já entrou por outra calibração do arquivo'],
      ['canal 5', 5, null, '3 ponto(s): a calibração precisa de 4 a 40'],
      ['calibração 6', null, 'Câmera IP', null],
      ['calibração 7', null, null, 'o arquivo não diz de que canal ela é'],
    ]);
    assert.equal(r.calibracoes![0]!.pares.length, 12);
    assert.deepEqual(Object.keys(r.calibracoes![0]!.pares[0]!).sort(), ['img', 'piso'], 'só os dois campos do ponto');
  });

  it('o ponto leva só a imagem e o piso (o resto do arquivo fica de fora)', () => {
    const comAnotacao = pares(6).map((p, i) => ({ ...p, erro: 0.01 * i, nome: `junta ${i}` }));
    const r = ler({ calibracoes: [{ canal: 1, pares: comAnotacao }] });
    assert.deepEqual(r.calibracoes![0]!.pares, pares(6));
  });

  it('os 41 pontos ficam de fora; os 40 entram', () => {
    const r = ler({ calibracoes: [{ canal: 1, pares: pares(41) }, { canal: 5, pares: pares(40) }] });
    assert.equal(r.calibracoes![0]!.motivo, '41 ponto(s): a calibração precisa de 4 a 40');
    assert.equal(r.calibracoes![1]!.ponto?.canal, 5);
  });

  it('os três jeitos de escrever o arquivo', () => {
    assert.equal(ler({ canal: 5, pares: pares(8) }).calibracoes!.length, 1);
    assert.equal(ler([{ canal: 1, pares: pares(8) }, { canal: 5, pares: pares(8) }]).calibracoes!.length, 2);
    assert.equal(ler({ calibracoes: [{ canal: 1, pares: pares(8) }] }).calibracoes![0]!.ponto?.canal, 1);
  });

  it('o que a importação devolve a API aceita ao salvar', () => {
    const r = ler({ calibracoes: [{ canal: 1, pares: pares(12) }] });
    const api = lerCalibracao({ pares: r.calibracoes![0]!.pares }, 200);
    assert.equal(api.problema, undefined);
    assert.ok(api.calibracao!.erros.medioM < 0.001, 'o chão escalado dá a conta exata');
  });

  it('arquivo torto é recusado com o que falta', () => {
    const casos: Array<[string, string]> = [
      ['não é JSON', 'o arquivo não é de pontos de calibração (não é um arquivo JSON)'],
      [JSON.stringify({ calibracoes: [] }), 'o arquivo não traz nenhuma calibração (calibracoes com canal e pares)'],
      [JSON.stringify({ planta: {} }), 'o arquivo não traz nenhuma calibração (calibracoes com canal e pares)'],
      [JSON.stringify({ calibracoes: [3] }), 'calibração 1: não é uma calibração'],
      [JSON.stringify({ calibracoes: [{ canal: 1 }] }), 'canal 1: faltam os pontos (pares)'],
      [JSON.stringify({ calibracoes: [{ canal: 1, pares: [{ img: [0.5], piso: [1, 2] }] }] }), 'canal 1, ponto 1: precisa de img [u, v] e piso [x, y]'],
      [JSON.stringify({ calibracoes: [{ canal: 1, pares: [{ img: [0.5, 0.5], piso: [1, '2'] }] }] }), 'canal 1, ponto 1: precisa de img [u, v] e piso [x, y]'],
      [JSON.stringify({ calibracoes: [{ canal: 1, pares: [{ img: [1.2, 0.5], piso: [1, 2] }] }] }), 'canal 1, ponto 1: img vai de 0 a 1 (fração da imagem)'],
      ['x'.repeat(importar.TAMANHO_MAXIMO_DO_ARQUIVO + 1), 'o arquivo é grande demais para pontos de calibração'],
    ];
    for (const [conteudo, esperado] of casos) {
      const r = importar.lerArquivoDePontos(conteudo, CANAIS);
      assert.equal(r.calibracoes, undefined, conteudo.slice(0, 60));
      assert.equal(r.problema, esperado);
    }
  });
});
