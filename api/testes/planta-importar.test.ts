// Importar a planta de um arquivo (27/10/2026): a conta da tela (`web/lib/planta-importar.ts`), lida pelo caminho como
// `web/lib/planta.ts` em `planta.test.ts`. O que tem de ficar provado:
//
//   - a câmera que vem pelo NÚMERO do canal entra no canal da loja com esse número; a que não tem canal cadastrado, a
//     de número repetido em dois gravadores e a segunda do mesmo canal ficam de fora, cada uma com o motivo;
//   - o setor e o equipamento só ficam se forem DESTA loja;
//   - o que a importação devolve é o que a API aceita ao salvar (`lerPlanta`) — a régua de verdade é a dela;
//   - arquivo torto é recusado com a frase do que falta, sem tocar em nada.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as importar from '../../web/lib/planta-importar.ts';
import { lerPlanta } from '../src/planta.js';

const CANAIS: importar.CanalDaLoja[] = [
  { id: '11111111-1111-4111-8111-111111111111', canal: 1, nome: 'Visão geral montagem' },
  { id: '44444444-4444-4444-8444-444444444444', canal: 4, nome: 'Montagem 1' },
  { id: '66666666-6666-4666-8666-666666666666', canal: 6, nome: 'Visão da chapa' },
  // dois gravadores com um canal 9 cada
  { id: '99999999-9999-4999-8999-999999999991', canal: 9, nome: 'Gravador A, canal 9' },
  { id: '99999999-9999-4999-8999-999999999992', canal: 9, nome: 'Gravador B, canal 9' },
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', canal: null, nome: 'Câmera IP' },
];
const SETOR = '5e70a000-0000-4000-8000-000000000001';
const ITEM = '17e40000-0000-4000-8000-000000000001';

const camera = (extra: Record<string, unknown>) => ({ x: 2, y: 1, alt: 2.7, dir: 90, abertura: 90, alcance: 5, incl: 35, ...extra });
const ARQUIVO = {
  sobre: 'campo que não é da planta: fica de fora',
  ambientes: [
    { id: 'cozinha', nome: 'Cozinha', setorId: SETOR, x: 0, y: 0, w: 6.004, h: 5.9 },
    { id: 'delivery', nome: 'Área do delivery', setorId: 'setor-de-outra-loja', x: 6, y: 0, w: 1, h: 2 },
  ],
  moveis: [
    { id: 'ilha', nome: 'Ilha de montagem', itemId: ITEM, x: 2, y: 0, w: 1, h: 4.08, alt: 0.9 },
    { id: 'chapa', nome: 'Chapa', itemId: 'item-de-outra-loja', x: 4, y: 1, w: 0.66, h: 0.97, alt: 0.9 },
  ],
  cameras: [
    camera({ canal: 1, onde: 'teto do corredor' }),
    camera({ canal: 5 }),
    camera({ canal: 9 }),
    camera({ canal: 4, x: 2.5 }),
    camera({ canal: 4, x: 3 }),
    camera({ pontoId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', incl: undefined }),
    camera({}),
  ],
};
const ler = (o: unknown) => importar.lerArquivoDaPlanta(JSON.stringify(o), CANAIS, [SETOR], [ITEM]);

describe('importar a planta de um arquivo', () => {
  it('a câmera entra pelo número do canal; as que não dá ficam de fora com o motivo', () => {
    const r = ler(ARQUIVO);
    assert.ok(r.importacao, r.problema);
    const { planta, cameras } = r.importacao!;
    assert.deepEqual(cameras.map((c) => [c.rotulo, c.ponto?.nome ?? null, c.motivo]), [
      ['canal 1', 'Visão geral montagem', null],
      ['canal 5', null, 'o canal 5 não está cadastrado no console'],
      ['canal 9', null, 'há 2 canais com o número 9 (gravadores diferentes): ponha à mão na edição'],
      ['canal 4', 'Montagem 1', null],
      ['canal 4', null, 'o canal 4 já entrou por outra câmera do arquivo'],
      ['câmera 6', 'Câmera IP', null],
      ['câmera 7', null, 'o arquivo não diz de que canal ela é'],
    ]);
    assert.deepEqual(cameras.map((c) => c.numero), [1, 5, 9, 4, 4, null, null], 'o número de cada uma, para a tela ordenar');
    assert.deepEqual(planta.cameras.map((c) => c.pontoId), [CANAIS[0]!.id, CANAIS[1]!.id, CANAIS[5]!.id]);
    assert.equal(planta.cameras[1]!.x, 2.5, 'a primeira câmera do canal 4 é a que vale');
    assert.equal(planta.cameras[0]!.incl, 35);
    assert.equal('incl' in planta.cameras[2]!, false, 'sem inclinação no arquivo, sem inclinação na planta');
    assert.equal('onde' in planta.cameras[0]!, false, 'o que não é da planta fica de fora');
  });

  it('o setor e o equipamento só ficam se forem desta loja; os números vão ao centímetro', () => {
    const { planta } = ler(ARQUIVO).importacao!;
    assert.deepEqual(planta.ambientes.map((a) => a.setorId), [SETOR, null]);
    assert.deepEqual(planta.moveis.map((m) => m.itemId), [ITEM, null]);
    assert.equal(planta.ambientes[0]!.w, 6);
  });

  it('que lugar é e que equipamento é vão como vieram; quem confere é a API, ao salvar (29/10/2026)', () => {
    const arquivo = {
      ...ARQUIVO,
      ambientes: [{ ...ARQUIVO.ambientes[0]!, tipo: 'cozinha' }, ARQUIVO.ambientes[1]!],
      moveis: [{ ...ARQUIVO.moveis[0]!, tipo: 'bancada' }, { ...ARQUIVO.moveis[1]!, tipo: 'forno' }],
    };
    const { planta } = ler(arquivo).importacao!;
    assert.deepEqual(planta.ambientes.map((a) => a.tipo), ['cozinha', undefined]);
    assert.equal('tipo' in planta.ambientes[1]!, false, 'sem tipo no arquivo, sem tipo na planta');
    assert.deepEqual(planta.moveis.map((m) => m.tipo), ['bancada', 'forno']);
    assert.match(lerPlanta(planta).problema ?? '', /moveis\[1\]\.tipo: chapa, fritadeira/, 'o tipo que não existe a API recusa com a frase dela');
  });

  it('o que a importação devolve a API aceita ao salvar', () => {
    const { planta } = ler(ARQUIVO).importacao!;
    const r = lerPlanta(planta);
    assert.equal(r.problema, undefined);
    assert.deepEqual(r.planta, planta, 'nada muda na conferência da API');
  });

  it('as áreas de medida do arquivo entram como a API guarda; o arquivo sem elas não apaga as da planta', () => {
    const fila = { id: 'fila', nome: 'Fila do balcão', tipo: 'espera', x: 1.234, y: 2, w: 3, h: 1.4 };
    const com = ler({ ...ARQUIVO, areas: [fila, { ...fila, id: 'porta', nome: 'Porta', tipo: 'porta' }] }).importacao!;
    assert.equal(com.trouxeAreas, true);
    assert.deepEqual(com.planta.areas, [{ ...fila, x: 1.23 }, { ...fila, x: 1.23, id: 'porta', nome: 'Porta', tipo: 'porta' }]);
    assert.deepEqual(lerPlanta(com.planta).planta, com.planta, 'a API aceita igual');
    const sem = ler(ARQUIVO).importacao!;
    assert.equal(sem.trouxeAreas, false, 'sem a lista: a tela mantém as que a planta tem');
    assert.deepEqual(sem.planta.areas, []);
    assert.match(ler({ ...ARQUIVO, areas: [{ ...fila, tipo: 'janela' }] }).problema ?? '', /área de medida 1 \(Fila do balcão\): o tipo é espera ou porta/);
    assert.match(ler({ ...ARQUIVO, areas: [fila, fila] }).problema ?? '', /o id "fila" se repete/);
    assert.match(ler({ ...ARQUIVO, areas: 'fila' }).problema ?? '', /não são uma lista/);
  });

  it('aceita a resposta da API inteira ({ planta }) e a planta sem câmeras', () => {
    const r = ler({ planta: { ambientes: ARQUIVO.ambientes, moveis: [] }, versao: 3 });
    assert.ok(r.importacao, r.problema);
    assert.equal(r.importacao!.planta.ambientes.length, 2);
    assert.deepEqual(r.importacao!.planta.cameras, []);
  });

  it('arquivo torto é recusado com o que falta', () => {
    const casos: Array<[string, string | unknown]> = [
      ['não é JSON', 'o arquivo não é uma planta (não é um arquivo JSON)'],
      [JSON.stringify([1, 2]), 'o arquivo não é uma planta: faltam os ambientes e os equipamentos'],
      [JSON.stringify({ ambientes: [] }), 'o arquivo não é uma planta: faltam os ambientes e os equipamentos'],
      [JSON.stringify({ ambientes: [], moveis: [], cameras: {} }), 'as câmeras do arquivo não são uma lista'],
      [JSON.stringify({ ambientes: [{ id: 'a', nome: 'Cozinha', x: 0, y: 0, w: 5 }], moveis: [] }), 'ambiente 1 (Cozinha): falta o tamanho (h) em metros'],
      [JSON.stringify({ ambientes: [{ id: 'a', x: 0, y: 0, w: 5, h: 5 }], moveis: [] }), 'ambiente 1: falta o id ou o nome'],
      [JSON.stringify({ ambientes: [], moveis: [{ id: 'm', nome: 'Chapa', x: 0, y: 0, w: 1, h: 1 }] }), 'equipamento 1 (Chapa): falta a altura (alt) em metros'],
      [JSON.stringify({ ambientes: [{ id: 'x', nome: 'A', x: 0, y: 0, w: 1, h: 1 }], moveis: [{ id: 'x', nome: 'B', x: 0, y: 0, w: 1, h: 1, alt: 1 }] }), 'equipamento 1: o id "x" se repete no arquivo'],
      [JSON.stringify({ ambientes: [], moveis: [], cameras: [{ canal: 1, x: 1, y: 1, alt: 2.7, dir: 90, abertura: 90 }] }), 'canal 1: falta alcance'],
      ['x'.repeat(importar.TAMANHO_MAXIMO_DO_ARQUIVO + 1), 'o arquivo é grande demais para ser uma planta'],
    ];
    for (const [conteudo, esperado] of casos) {
      const r = importar.lerArquivoDaPlanta(conteudo as string, CANAIS);
      assert.equal(r.importacao, undefined, String(conteudo).slice(0, 60));
      assert.equal(r.problema, esperado);
    }
  });
});
