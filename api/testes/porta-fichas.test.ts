// O envio de outro sistema: a forma, e as regras — que são as da planilha.
//
// O que se protege:
//
//   • o envio é O MESMO MODELO da planilha, com outra forma: o mesmo cardápio
//     dá a MESMA base pelos dois caminhos;
//   • a forma errada recusa o envio inteiro, com o caminho do campo; o
//     conteúdo errado deixa aquele produto de fora, e os outros entram;
//   • o problema aponta para o que foi ENVIADO (`produtos[1].ingredientes[1]`),
//     e nenhuma frase fala em planilha, aba, linha ou coluna;
//   • dois produtos com o mesmo nome são dois produtos, mesmo seguidos — e não
//     um com os ingredientes somados;
//   • o campo que não é do modelo (preço, custo) não entra na base.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { impressaoDaBase } from '../src/fichas.js';
import { lerPlanilha, MODELO } from '../src/planilha-fichas.js';
import { lerEnvio, MAX_PRODUTOS_DO_ENVIO, type Envio } from '../src/porta-fichas.js';

type Obj = Record<string, unknown>;
const ing = (nome: unknown, quantidade: unknown = 1, unidade: unknown = 'g'): Obj => ({ nome, quantidade, unidade });
const BATATA: Obj = { nome: 'Batata frita', ingredientes: [ing('Batata palito', 200, 'g'), ing('Sal', 1, 'pitada')] };
const XB = (mais: Obj = {}): Obj => ({ nome: 'X-Burger', ingredientes: [ing('Pão', 1, 'unidade'), ing('Cebola roxa', 10, 'g')], ...mais });

/** O exemplo do modelo da planilha, escrito como um envio. */
const DO_MODELO = {
  produtos: [
    {
      nome: 'X-Burger',
      codigo: '1042',
      categoria: 'Burgers',
      cozinha: true,
      ingredientes: [ing('Pão brioche', 1, 'unidade'), ing('Blend da casa', 120, 'g'), ing('Queijo prato', 2, 'fatia'), ing('Cebola roxa', 10, 'g'), ing('Molho da casa', 15, 'g')],
      variacoes: [{ nome: 'Simples', fator: 1 }, { nome: 'Duplo', fator: 2 }],
      adicionais: [
        { nome: 'Bacon', faz: 'acrescenta', ingrediente: 'Bacon fatiado', quantidade: 20, unidade: 'g' },
        { nome: 'Ponto da carne', faz: 'observacao' },
        { nome: 'Sem cebola', faz: 'tira', ingrediente: 'Cebola roxa' },
      ],
    },
    { nome: 'Batata frita', codigo: '2010', categoria: 'Porções', cozinha: true, ingredientes: [ing('Batata palito', 200, 'g'), ing('Sal', 1, 'pitada')] },
    { nome: 'Refrigerante lata', codigo: '3001', categoria: 'Bebidas', cozinha: false },
    { nome: 'Combo da casa', codigo: '4001', categoria: 'Combos', cozinha: true, combo: [{ produto: 'X-Burger', quantidade: 1 }, { produto: 'Batata frita', quantidade: 1 }, { produto: 'Refrigerante lata', quantidade: 1 }] },
  ],
};

const nomes = (e: Envio) => e.base.produtos.map((p) => p.nome);
const motivos = (e: Envio, nome: string) => (e.deFora.find((d) => d.produto === nome)?.problemas ?? []).map((p) => `${p.onde}: ${p.texto}`);
const produto = (e: Envio, nome: string) => e.base.produtos.find((p) => p.nome === nome)!;

describe('o envio de outro sistema: o mesmo modelo da planilha', () => {
  it('o mesmo cardápio dá a MESMA base pelos dois caminhos — o envio e a planilha', () => {
    const e = lerEnvio(DO_MODELO);
    assert.equal(e.impede, null);
    assert.deepEqual([e.problemas, e.deFora, e.soltos], [0, [], []]);
    const daPlanilha = lerPlanilha(MODELO);
    assert.deepEqual(e.base, daPlanilha.base);
    assert.deepEqual([e.contas, e.semFicha], [daPlanilha.contas, daPlanilha.semFicha]);
    assert.equal(impressaoDaBase(e.base), impressaoDaBase(daPlanilha.base), 'a mesma impressão: o agente da loja não baixa de novo ao trocar de caminho');
  });

  it('o que não vem tem o valor de sempre: sem "cozinha" o produto vai para a cozinha; sem ingredientes entra sem ficha; sem fator a variação usa a ficha inteira', () => {
    const e = lerEnvio({ produtos: [{ nome: 'Suco', variacoes: [{ nome: 'Grande' }] }, { nome: 'Água', cozinha: false }, { nome: 'Vazio', ingredientes: [], variacoes: null, adicionais: null, combo: null }] });
    assert.deepEqual([e.impede, e.problemas, nomes(e)], [null, 0, ['Suco', 'Água', 'Vazio']]);
    assert.deepEqual([produto(e, 'Suco').cozinha, produto(e, 'Suco').ficha, produto(e, 'Suco').variacoes], [true, null, [{ nome: 'Grande', codigo: null, fator: 1 }]]);
    assert.equal(produto(e, 'Água').cozinha, false);
    assert.deepEqual(e.semFicha, ['Suco', 'Água', 'Vazio']);
  });

  it('número e texto servem onde a planilha aceita os dois: o código que é número, a quantidade escrita "0,5"', () => {
    const e = lerEnvio({ produtos: [{ nome: 'Suco', codigo: 3050, ingredientes: [ing('Polpa', '0,5', 'L'), ing('Água', '150', 'ml')] }] });
    assert.deepEqual([e.impede, e.problemas], [null, 0]);
    assert.deepEqual([produto(e, 'Suco').codigo, produto(e, 'Suco').ficha!.ingredientes.map((i) => [i.quantidade, i.unidade])], ['3050', [[0.5, 'l'], [150, 'ml']]]);
  });

  it('o campo que não é do modelo é ignorado, e não entra na base — dinheiro incluído', () => {
    const e = lerEnvio({ loja: 'x', produtos: [{ ...XB(), preco: 32.9, custo: 9.75, cliente: 'Fulano', ingredientes: [{ ...ing('Pão', 1, 'unidade'), custo: 1.11 }] }] });
    assert.deepEqual([e.impede, e.problemas, nomes(e)], [null, 0, ['X-Burger']]);
    const guardado = JSON.stringify(e.base);
    for (const proibido of ['preco', 'custo', 'cliente', '32.9', '9.75', '1.11', 'Fulano']) assert.ok(!guardado.includes(proibido), `"${proibido}" foi para a base`);
  });
});

describe('o envio de outro sistema: o conteúdo errado deixa o produto de fora, e os outros entram', () => {
  it('cada defeito aponta para o que foi ENVIADO, e o vizinho entra', () => {
    const casos: Array<[string, Obj, string[]]> = [
      ['sem quantidade', XB({ ingredientes: [ing('Pão', 1, 'unidade'), ing('Queijo', '', 'fatia')] }), ['produtos[1].ingredientes[1]: falta a quantidade.']],
      ['quantidade que não é número', XB({ ingredientes: [ing('Queijo', 'duas', 'fatia')] }), ['produtos[1].ingredientes[0]: a quantidade “duas” não é um número.']],
      ['quantidade zero', XB({ ingredientes: [ing('Queijo', 0, 'fatia')] }), ['produtos[1].ingredientes[0]: a quantidade tem de ser maior que zero.']],
      ['sem unidade', XB({ ingredientes: [{ nome: 'Queijo', quantidade: 2 }] }), ['produtos[1].ingredientes[0]: falta a unidade.']],
      ['unidade fora da lista', XB({ ingredientes: [ing('Alface', 2, 'fls')] }), ['produtos[1].ingredientes[0]: a unidade “fls” não está na lista.']],
      ['variação com fator que não serve', XB({ variacoes: [{ nome: 'Simples', fator: 1 }, { nome: 'Duplo', fator: 'dobro' }] }), ['produtos[1].variacoes[1]: “fator” está como “dobro”.']],
      ['variação repetida', XB({ variacoes: [{ nome: 'Duplo', fator: 2 }, { nome: 'DUPLO', fator: 3 }] }), ['produtos[1].variacoes[1]: a variação “DUPLO” aparece duas vezes neste produto.']],
      ['adicional sem dizer o que faz', XB({ adicionais: [{ nome: 'Bacon', ingrediente: 'Bacon' }] }), ['produtos[1].adicionais[0]: falta dizer o que o adicional faz.']],
      ['adicional que faz outra coisa', XB({ adicionais: [{ nome: 'Bacon', faz: 'troca', ingrediente: 'Bacon' }] }), ['produtos[1].adicionais[0]: “faz” está como “troca”.']],
      ['adicional que acrescenta sem dizer o quê', XB({ adicionais: [{ nome: 'Bacon', faz: 'acrescenta' }] }), ['produtos[1].adicionais[0]: falta o ingrediente que o adicional acrescenta.']],
      ['adicional que tira o que não está na ficha', XB({ adicionais: [{ nome: 'Sem tomate', faz: 'tira', ingrediente: 'Tomate' }] }), ['produtos[1].adicionais[0]: o produto não tem “Tomate” na ficha, para tirar.']],
      ['adicional com quantidade e sem unidade', XB({ adicionais: [{ nome: 'Bacon', faz: 'acrescenta', ingrediente: 'Bacon', quantidade: 20 }] }), ['produtos[1].adicionais[0]: falta a unidade.']],
      ['combo com produto que não foi enviado', XB({ ingredientes: [], combo: [{ produto: 'Suco' }] }), ['produtos[1].combo[0]: o produto “Suco”, que vem no combo, não está no envio.']],
      ['combo dentro dele mesmo', XB({ ingredientes: [], combo: [{ produto: 'x-burger' }] }), ['produtos[1].combo[0]: o combo não pode vir dentro dele mesmo.']],
      ['combo com o mesmo produto duas vezes', XB({ ingredientes: [], combo: [{ produto: 'Batata frita' }, { produto: 'batata frita' }] }), ['produtos[1].combo[1]: o produto “Batata frita” aparece duas vezes neste combo.']],
      ['combo com quantidade que não serve', XB({ ingredientes: [], combo: [{ produto: 'Batata frita', quantidade: 'dois' }] }), ['produtos[1].combo[0]: a quantidade está como “dois”.']],
    ];
    for (const [oQue, ruim, esperado] of casos) {
      const e = lerEnvio({ produtos: [BATATA, ruim] });
      assert.equal(e.impede, null, oQue);
      assert.deepEqual([nomes(e), motivos(e, 'X-Burger'), e.problemas], [['Batata frita'], esperado, esperado.length], oQue);
    }
  });

  it('os problemas de um produto saem na ordem do envio: os ingredientes, as variações, os adicionais, o combo', () => {
    const e = lerEnvio({
      produtos: [
        BATATA,
        {
          nome: 'X-Burger',
          ingredientes: [ing('Pão', 1, 'unidade'), ing('Queijo', '', 'fatia')],
          variacoes: [{ nome: 'Duplo', fator: 0 }],
          adicionais: [{ nome: 'Bacon', faz: 'troca' }],
          combo: [{ produto: 'Suco' }],
        },
      ],
    });
    assert.deepEqual(motivos(e, 'X-Burger'), [
      'produtos[1].ingredientes[1]: falta a quantidade.',
      'produtos[1].variacoes[0]: “fator” está como “0”.',
      'produtos[1].adicionais[0]: “faz” está como “troca”.',
      'produtos[1].combo[0]: o produto “Suco”, que vem no combo, não está no envio.',
    ]);
  });

  it('o combo que leva um produto que ficou de fora fica de fora junto', () => {
    const e = lerEnvio({ produtos: [XB({ ingredientes: [ing('Pão', '', 'unidade')] }), BATATA, { nome: 'Combo', combo: [{ produto: 'Batata frita' }, { produto: 'X-Burger' }] }] });
    assert.deepEqual(nomes(e), ['Batata frita']);
    assert.deepEqual(motivos(e, 'Combo'), ['produtos[2].combo[1]: o produto “X-Burger”, que vem neste combo, ficou de fora.']);
  });

  it('dois produtos com o mesmo nome são dois produtos — seguidos ou não —, e ficam de fora; o resto entra', () => {
    const seguidos = lerEnvio({ produtos: [BATATA, XB(), { nome: 'x-burger', ingredientes: [ing('Queijo', 2, 'fatia')] }] });
    assert.deepEqual([seguidos.impede, nomes(seguidos)], [null, ['Batata frita']]);
    assert.deepEqual(motivos(seguidos, 'X-Burger'), ['produtos[2]: há outro produto com o mesmo nome no envio.'], 'aponta para o produto, e não para o primeiro ingrediente dele');
    assert.equal(seguidos.deFora.length, 1, 'o nome aparece uma vez na lista dos que ficaram de fora');

    const separados = lerEnvio({ produtos: [XB(), BATATA, { nome: 'X-Burger' }] });
    assert.deepEqual([nomes(separados), motivos(separados, 'X-Burger')], [['Batata frita'], ['produtos[2]: há outro produto com o mesmo nome no envio.']]);

    // o que o segundo traz não se soma ao primeiro: nem ingrediente, nem variação, nem adicional
    const comMais = lerEnvio({ produtos: [BATATA, XB({ variacoes: [{ nome: 'Duplo', fator: 2 }] }), XB({ variacoes: [{ nome: 'Duplo', fator: 3 }], adicionais: [{ nome: 'Bacon' }] })] });
    assert.deepEqual(motivos(comMais, 'X-Burger'), ['produtos[2]: há outro produto com o mesmo nome no envio.'], 'um problema só: o nome');
  });

  it('o produto com ingredientes demais fica de fora, e a frase aponta para ele', () => {
    const e = lerEnvio({ produtos: [BATATA, { nome: 'Enorme', ingredientes: Array.from({ length: 301 }, (_, i) => ing(`Ingrediente ${i}`)) }] });
    assert.deepEqual([nomes(e), motivos(e, 'Enorme')], [['Batata frita'], ['produtos[1]: o produto tem mais de 300 ingredientes.']]);
  });

  it('nenhuma frase da porta fala em planilha, aba, linha ou coluna', () => {
    const e = lerEnvio({
      produtos: [
        { nome: 'A', ingredientes: [ing('x', '', ''), ing('y', 'duas', 'pct'), ing('z', -1, 'g')], variacoes: [{ nome: 'V', fator: 'x' }, { nome: 'v' }], adicionais: [{ nome: 'B' }, { nome: 'C', faz: 'troca' }, { nome: 'D', faz: 'tira', ingrediente: 'nada' }, { nome: 'E', faz: 'acrescenta' }] },
        { nome: 'a' },
        { nome: 'Combo', combo: [{ produto: 'Nenhum' }, { produto: 'Combo' }, { produto: 'A' }, { produto: 'A', quantidade: 'x' }] },
        { nome: 'Enorme', ingredientes: Array.from({ length: 301 }, (_, i) => ing(`i${i}`)) },
      ],
    });
    const frases = [...e.deFora.flatMap((d) => d.problemas), ...e.soltos].map((p) => p.texto);
    assert.ok(frases.length >= 12, `são ${frases.length} frases`);
    for (const f of frases) assert.ok(!/planilha|\baba\b|linha|coluna/i.test(f), f);
    for (const p of [...e.deFora.flatMap((d) => d.problemas), ...e.soltos]) assert.match(p.onde, /^produtos\[\d+\](\.(ingredientes|variacoes|adicionais|combo)\[\d+\])?$/);
  });

  it('nenhum produto certo: a base sai vazia, e a lista diz tudo', () => {
    const e = lerEnvio({ produtos: [{ nome: 'A', ingredientes: [ing('x', '', 'g')] }, { nome: 'B', ingredientes: [ing('y', 1, 'pct')] }] });
    assert.deepEqual([e.impede, e.base.produtos, e.contas.produtos, e.problemas, e.deFora.map((d) => d.produto)], [null, [], 0, 2, ['A', 'B']]);
  });
});

describe('o envio de outro sistema: a forma errada recusa o envio inteiro', () => {
  it('cada defeito de forma diz o caminho do campo, e nada entra', () => {
    const casos: Array<[unknown, string]> = [
      [null, 'o envio era para ser um objeto com a lista “produtos”'],
      [[BATATA], 'o envio era para ser um objeto com a lista “produtos”'],
      ['produtos', 'o envio era para ser um objeto com a lista “produtos”'],
      [{}, 'produtos: falta a lista de produtos'],
      [{ produtos: null }, 'produtos: falta a lista de produtos'],
      [{ produtos: { nome: 'A' } }, 'produtos: era para ser uma lista'],
      [{ produtos: [] }, 'produtos: a lista está vazia'],
      [{ produtos: [BATATA, 'X-Burger'] }, 'produtos[1]: era para ser um objeto, com os campos entre chaves'],
      [{ produtos: [BATATA, [XB()]] }, 'produtos[1]: era para ser um objeto, com os campos entre chaves'],
      [{ produtos: [{ ingredientes: [] }] }, 'produtos[0].nome: falta preencher'],
      [{ produtos: [{ nome: '   ' }] }, 'produtos[0].nome: falta preencher'],
      [{ produtos: [{ nome: true }] }, 'produtos[0].nome: era para ser um texto'],
      [{ produtos: [{ nome: { pt: 'A' } }] }, 'produtos[0].nome: era para ser um texto'],
      [{ produtos: [{ nome: 'A', codigo: ['1'] }] }, 'produtos[0].codigo: era para ser um texto'],
      [{ produtos: [{ nome: 'A', categoria: false }] }, 'produtos[0].categoria: era para ser um texto'],
      [{ produtos: [{ nome: 'A', cozinha: 'sim' }] }, 'produtos[0].cozinha: era para ser verdadeiro ou falso (true ou false)'],
      [{ produtos: [{ nome: 'A', cozinha: 1 }] }, 'produtos[0].cozinha: era para ser verdadeiro ou falso (true ou false)'],
      [{ produtos: [{ nome: 'A', ingredientes: 'Pão' }] }, 'produtos[0].ingredientes: era para ser uma lista'],
      [{ produtos: [{ nome: 'A', ingredientes: ['Pão'] }] }, 'produtos[0].ingredientes[0]: era para ser um objeto, com os campos entre chaves'],
      [{ produtos: [{ nome: 'A', ingredientes: [ing('Pão'), { quantidade: 1, unidade: 'g' }] }] }, 'produtos[0].ingredientes[1].nome: falta preencher'],
      [{ produtos: [{ nome: 'A', ingredientes: [ing('Pão', true)] }] }, 'produtos[0].ingredientes[0].quantidade: era para ser um número'],
      [{ produtos: [{ nome: 'A', ingredientes: [ing('Pão', { valor: 1 })] }] }, 'produtos[0].ingredientes[0].quantidade: era para ser um número'],
      [{ produtos: [{ nome: 'A', ingredientes: [ing('Pão', 1, ['g'])] }] }, 'produtos[0].ingredientes[0].unidade: era para ser um texto'],
      [{ produtos: [{ nome: 'A', variacoes: {} }] }, 'produtos[0].variacoes: era para ser uma lista'],
      [{ produtos: [{ nome: 'A', variacoes: [{ fator: 2 }] }] }, 'produtos[0].variacoes[0].nome: falta preencher'],
      [{ produtos: [{ nome: 'A', variacoes: [{ nome: 'Duplo', fator: true }] }] }, 'produtos[0].variacoes[0].fator: era para ser um número'],
      [{ produtos: [{ nome: 'A', adicionais: 'Bacon' }] }, 'produtos[0].adicionais: era para ser uma lista'],
      [{ produtos: [{ nome: 'A', adicionais: [{ faz: 'acrescenta' }] }] }, 'produtos[0].adicionais[0].nome: falta preencher'],
      [{ produtos: [{ nome: 'A', adicionais: [{ nome: 'Bacon', faz: true }] }] }, 'produtos[0].adicionais[0].faz: era para ser um texto'],
      [{ produtos: [{ nome: 'A', adicionais: [{ nome: 'Bacon', faz: 'acrescenta', ingrediente: {} }] }] }, 'produtos[0].adicionais[0].ingrediente: era para ser um texto'],
      [{ produtos: [{ nome: 'A', adicionais: [{ nome: 'Bacon', faz: 'acrescenta', ingrediente: 'Bacon', quantidade: [] }] }] }, 'produtos[0].adicionais[0].quantidade: era para ser um número'],
      [{ produtos: [{ nome: 'A', adicionais: [{ nome: 'Bacon', faz: 'acrescenta', ingrediente: 'Bacon', quantidade: 1, unidade: 5n }] }] }, 'produtos[0].adicionais[0].unidade: era para ser um texto'],
      [{ produtos: [{ nome: 'A', combo: 'B' }] }, 'produtos[0].combo: era para ser uma lista'],
      [{ produtos: [{ nome: 'A', combo: [{ quantidade: 1 }] }] }, 'produtos[0].combo[0].produto: falta preencher'],
      [{ produtos: [{ nome: 'A', combo: [{ produto: 'B', quantidade: false }] }] }, 'produtos[0].combo[0].quantidade: era para ser um número'],
      [{ produtos: [{ nome: 'A', ingredientes: [ing('Pão', Number.NaN)] }] }, 'produtos[0].ingredientes[0].quantidade: era para ser um número'],
      [{ produtos: [{ nome: Number.POSITIVE_INFINITY }] }, 'produtos[0].nome: era para ser um texto'],
    ];
    for (const [corpo, motivo] of casos) {
      const e = lerEnvio(corpo);
      assert.equal(e.impede, motivo);
      assert.deepEqual([e.base.produtos, e.contas.produtos, e.deFora, e.problemas], [[], 0, [], 0], motivo);
    }
  });

  it('o produto certo que vem ANTES do campo de forma errada também não entra: a forma recusa o envio inteiro', () => {
    const e = lerEnvio({ produtos: [BATATA, XB(), { nome: 'Suco', cozinha: 'sim' }] });
    assert.deepEqual([e.impede, e.base.produtos.length], ['produtos[2].cozinha: era para ser verdadeiro ou falso (true ou false)', 0]);
  });

  it('o envio tem teto: cinco mil produtos passam, cinco mil e um não; e vinte mil ingredientes passam, vinte mil e um não', () => {
    const com = (n: number) => lerEnvio({ produtos: Array.from({ length: n }, (_, i) => ({ nome: `Produto ${i}` })) });
    assert.equal(com(MAX_PRODUTOS_DO_ENVIO).impede, null);
    assert.equal(com(MAX_PRODUTOS_DO_ENVIO).contas.produtos, MAX_PRODUTOS_DO_ENVIO);
    assert.equal(com(MAX_PRODUTOS_DO_ENVIO + 1).impede, 'produtos: a lista tem mais de 5.000 produtos. Um envio é de uma loja só');

    // 100 produtos de 200 ingredientes = 20.000; um ingrediente a mais passa do teto
    const cheio = Array.from({ length: 100 }, (_, i) => ({ nome: `Produto ${i}`, ingredientes: Array.from({ length: 200 }, (_, j) => ing(`Ingrediente ${j}`)) }));
    const noTeto = lerEnvio({ produtos: cheio });
    assert.deepEqual([noTeto.impede, noTeto.contas.produtos, noTeto.contas.ingredientes], [null, 100, 20_000]);
    const acima = lerEnvio({ produtos: [...cheio, { nome: 'Mais um', ingredientes: [ing('x')] }] });
    assert.equal(acima.impede, 'produtos: o envio é grande demais (mais de 20.000 itens numa lista). Um envio é de uma loja só');
  });
});
