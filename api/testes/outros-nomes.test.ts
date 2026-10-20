// O outro nome de um ingrediente das fichas (migration 053; protótipo aprovado pelo dono em 19/10/2026):
//
//   - o nome e a chave como contam: o outro nome vira o ingrediente das fichas; o resto fica como está;
//   - a conferência como conta: as marcas (sem repetir na mesma foto), o que faltou e o que veio a mais — e a guardada
//     não muda; a de antes (por etapa) também;
//   - o exemplo do nome escrito à mão que não está nas fichas: um por quadro, à parte.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { chaveQueConta, conferenciaQueConta, nomeQueConta } from '../src/outros-nomes.js';
import { exemplosForaDasFichas, type ConferenciaPorEtapa, type ConferenciaPorFoto, type EtapaLida } from '../src/treino.js';

const OUTROS = new Map([['hamburguer', 'Blend da casa']]);
const etapa = (quadro: number | null): EtapaLida => ({ hora: '2026-10-19T21:00:00-03:00', lado: 'base', inicio: false, leu: null, candidatos: [], vezes: 1, quadro });
const porFoto = (fotos: ConferenciaPorFoto['fotos'], faltas: ConferenciaPorFoto['faltas'] = {}, aMais: ConferenciaPorFoto['aMais'] = {}): ConferenciaPorFoto => ({
  versao: 2,
  produto: 'X-Burger',
  fotos,
  perguntas: {},
  obs: null,
  faltas,
  aMais,
});

describe('o outro nome (sem banco)', () => {
  it('o nome e a chave como contam', () => {
    assert.equal(nomeQueConta('Hambúrguer', OUTROS), 'Blend da casa');
    assert.equal(nomeQueConta('hamburguer ', OUTROS), 'Blend da casa', 'escrito de outro jeito, a mesma chave');
    assert.equal(nomeQueConta('Picles', OUTROS), 'Picles', 'o que não é outro nome fica como está');
    assert.equal(chaveQueConta('HAMBÚRGUER', OUTROS), 'blend casa');
  });

  it('a conferência por foto: as marcas trocadas, sem repetir na foto; o que faltou e o que veio a mais — e a guardada não muda', () => {
    const c = porFoto([{ etapas: [0], marcados: ['Hambúrguer', 'Blend da casa', 'Picles'], ruim: false, obs: null }], { Hambúrguer: 'faltou' }, { hamburguer: 'amais' });
    const q = conferenciaQueConta(c, OUTROS) as ConferenciaPorFoto;
    assert.deepEqual(q.fotos[0]!.marcados, ['Blend da casa', 'Picles']);
    assert.deepEqual(q.faltas, { 'Blend da casa': 'faltou' });
    assert.deepEqual(q.aMais, { 'Blend da casa': 'amais' });
    assert.deepEqual(c.fotos[0]!.marcados, ['Hambúrguer', 'Blend da casa', 'Picles'], 'a conferência guardada fica como a pessoa escreveu');
  });

  it('a conferência por etapa (a de antes de 15/10)', () => {
    const c: ConferenciaPorEtapa = { produto: 'X-Burger', etapas: [{ v: 'outro', nome: 'Hambúrguer' }, { v: 'certo', nome: null }, null], faltas: {}, aMais: {} };
    assert.deepEqual((conferenciaQueConta(c, OUTROS) as ConferenciaPorEtapa).etapas, [{ v: 'outro', nome: 'Blend da casa' }, { v: 'certo', nome: null }, null]);
  });

  it('sem outros nomes, a mesma conferência', () => {
    const c = porFoto([{ etapas: [0], marcados: ['Hambúrguer'], ruim: false, obs: null }]);
    assert.equal(conferenciaQueConta(c, new Map()), c);
  });

  it('o exemplo do nome escrito à mão fora das fichas: um por quadro, com o nome como foi escrito', () => {
    const etapas = [etapa(0), etapa(0), etapa(null), etapa(1)];
    const c = porFoto([
      { etapas: [0, 1], marcados: ['Picles', 'Blend da casa', 'picles '], ruim: false, obs: null },
      { etapas: [2], marcados: ['Jalapeño'], ruim: false, obs: null },
      { etapas: [3], marcados: ['Cebola caramelizada'], ruim: true, obs: 'borrada' },
    ]);
    assert.deepEqual(exemplosForaDasFichas(etapas, c, ['Blend da casa']), [{ etapa: 0, nome: 'Picles', quadro: 0 }], 'o da ficha, a etapa sem quadro e a foto ruim ficam de fora');
  });
});
