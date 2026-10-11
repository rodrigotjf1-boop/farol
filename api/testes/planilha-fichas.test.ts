// Da planilha para a base de fichas: o leitor, sem banco.
//
// O que se protege:
//
//   • o modelo que a pessoa baixa é lido sem problema nenhum, e a base que
//     sai dele volta a ser a mesma planilha (ida e volta);
//   • "entra o que está certo": o produto com qualquer linha errada fica
//     INTEIRO de fora, com a linha e o motivo — e os outros entram como se
//     ele não existisse;
//   • o que impede tudo é só o que não deixa ler a planilha;
//   • nada de dinheiro: coluna que não é do modelo não entra na base.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { impressaoDaBase, type Base } from '../src/fichas.js';
import { COLUNAS, lerPlanilha, linhasDaBase, MAX_LINHAS, MAX_PROBLEMAS, MODELO, UNIDADES, type Leitura } from '../src/planilha-fichas.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Celula = string | number | boolean | null;
const F = [...COLUNAS.fichas];
/** Uma linha da aba Fichas: produto, ingrediente, quantidade, unidade (o resto em branco). */
const linha = (produto: Celula, ingrediente: Celula = '', quantidade: Celula = '', unidade: Celula = '', cozinha: Celula = ''): Celula[] => [produto, '', '', cozinha, ingrediente, quantidade, unidade];
const ler = (fichas: Celula[][], outras: Record<string, Celula[][]> = {}): Leitura => lerPlanilha({ fichas: [F, ...fichas], ...outras });
const nomes = (l: Leitura) => l.base.produtos.map((p) => p.nome);
const produto = (l: Leitura, nome: string) => l.base.produtos.find((p) => p.nome === nome)!;
/** Os problemas de um produto que ficou de fora, como "aba linha: texto". */
const motivos = (l: Leitura, nome: string) => (l.deFora.find((d) => d.produto === nome)?.problemas ?? []).map((p) => `${p.aba} ${p.linha}: ${p.texto}`);
const BOM: Celula[][] = [linha('Batata frita', 'Batata palito', 200, 'g'), linha('Batata frita', 'Sal', 1, 'pitada')];

describe('planilha: o modelo', () => {
  it('o modelo que a pessoa baixa é lido sem problema nenhum', () => {
    const l = lerPlanilha(MODELO);
    assert.equal(l.impede, null);
    assert.deepEqual([l.problemas, l.deFora, l.soltos], [0, [], []]);
    assert.deepEqual(l.contas, { produtos: 4, comFicha: 2, ingredientes: 7, variacoes: 2, adicionais: 3, combos: 1 });
    assert.deepEqual(nomes(l), ['X-Burger', 'Batata frita', 'Refrigerante lata', 'Combo da casa'], 'na ordem da planilha');
    assert.deepEqual(l.semFicha, ['Refrigerante lata'], 'o combo não conta como "sem ficha"');

    const x = produto(l, 'X-Burger');
    assert.deepEqual([x.codigo, x.categoria, x.tipo, x.cozinha, x.setor, x.preparoMin], ['1042', 'Burgers', 'variavel', true, null, null]);
    assert.deepEqual(x.ficha!.ingredientes.map((i) => [i.nome, i.quantidade, i.unidade]), [
      ['Pão brioche', 1, 'unidade'],
      ['Blend da casa', 120, 'g'],
      ['Queijo prato', 2, 'fatia'],
      ['Cebola roxa', 10, 'g'],
      ['Molho da casa', 15, 'g'],
    ]);
    assert.ok(x.ficha!.ingredientes.every((i) => i.preparo === false && i.insumoId === null && i.fichaId === null));
    assert.deepEqual(x.variacoes, [{ nome: 'Simples', codigo: null, fator: 1 }, { nome: 'Duplo', codigo: null, fator: 2 }]);
    assert.deepEqual(x.adicionais, [
      {
        nome: 'Adicionais',
        tipo: 'adicionar',
        opcoes: [
          { id: null, nome: 'Bacon', codigo: null, efeito: { tipo: 'insumo', nome: 'Bacon fatiado', quantidade: 20, unidade: 'g', insumoId: null } },
          { id: null, nome: 'Ponto da carne', codigo: null, efeito: { tipo: 'observacao' } },
        ],
      },
      { nome: 'Retirar', tipo: 'remover', opcoes: [{ id: null, nome: 'Sem cebola', codigo: null, efeito: { tipo: 'retira', nome: 'Cebola roxa', insumoId: null, fichaId: null } }] },
    ]);

    const refri = produto(l, 'Refrigerante lata');
    assert.deepEqual([refri.cozinha, refri.ficha, refri.tipo], [false, null, 'simples']);
    const combo = produto(l, 'Combo da casa');
    assert.equal(combo.tipo, 'combo');
    assert.deepEqual(combo.combo, [
      { produtoId: x.id, nome: 'X-Burger', quantidade: 1 },
      { produtoId: produto(l, 'Batata frita').id, nome: 'Batata frita', quantidade: 1 },
      { produtoId: refri.id, nome: 'Refrigerante lata', quantidade: 1 },
    ]);
  });

  it('os ids saem do nome: são os mesmos a cada leitura, um por produto, e têm cara de id', () => {
    const [a, b] = [lerPlanilha(MODELO), lerPlanilha(structuredClone(MODELO))];
    assert.deepEqual(a.base, b.base);
    assert.equal(impressaoDaBase(a.base), impressaoDaBase(b.base));
    const ids = a.base.produtos.flatMap((p) => [p.id, ...(p.ficha ? [p.ficha.id] : [])]);
    assert.equal(new Set(ids).size, ids.length, 'nenhum id repetido, nem entre o produto e a ficha dele');
    for (const id of ids) assert.match(id, UUID);
    // o mesmo nome, com outra caixa e sem acento, é o mesmo produto
    const outro = ler([linha('batata  FRITA', 'Batata palito', 200, 'g')]);
    assert.equal(outro.base.produtos[0]!.id, produto(a, 'Batata frita').id);
  });

  it('ida e volta: a base vira planilha, e a planilha vira a mesma base', () => {
    const base = lerPlanilha(MODELO).base;
    const abas = linhasDaBase(base);
    assert.deepEqual(abas, MODELO, 'o que sai é o próprio modelo');
    assert.deepEqual(lerPlanilha(abas).base, base);
    // uma base com quantidade quebrada e produto sem código nem categoria
    const outra = ler([linha('Suco', 'Polpa', '0,5', 'L'), linha('Suco', 'Água', 150, 'ml'), linha('Água sem gás', '', '', '', 'não')], {
      variacoes: [[...COLUNAS.variacoes], ['Suco', 'Meio', '0,5']],
    }).base;
    assert.deepEqual(lerPlanilha(linhasDaBase(outra)).base, outra);
    assert.deepEqual(linhasDaBase({ formato: 1, produtos: [] }), { fichas: [F], variacoes: [[...COLUNAS.variacoes]], adicionais: [[...COLUNAS.adicionais]], combos: [[...COLUNAS.combos]] });
  });
});

describe('planilha: como as células são lidas', () => {
  it('os títulos valem em qualquer ordem, com ou sem acento e caixa; coluna que não é do modelo é ignorada — e dinheiro não entra', () => {
    const l = lerPlanilha({
      fichas: [
        ['UNIDADE', 'preço', 'quantidade', ' Ingrediente ', 'PRODUTO', 'Custo', 'codigo'],
        ['g', 39.9, 120, 'Blend', 'X-Burger', 11.5, 1042],
        ['fatia', 39.9, 2, 'Queijo', 'X-Burger', 11.5, 1042],
      ],
    });
    assert.equal(l.problemas, 0);
    const x = l.base.produtos[0]!;
    assert.deepEqual([x.nome, x.codigo, x.categoria, x.cozinha], ['X-Burger', '1042', null, true]);
    assert.deepEqual(x.ficha!.ingredientes.map((i) => [i.nome, i.quantidade, i.unidade]), [['Blend', 120, 'g'], ['Queijo', 2, 'fatia']]);
    const escrito = JSON.stringify(l.base);
    assert.ok(!escrito.includes('39.9') && !escrito.includes('11.5') && !/pre[cç]o|custo/i.test(escrito));
  });

  it('a quantidade: número, "0,5" ou "0.5"; a unidade: a da lista, como a pessoa costuma escrever', () => {
    const l = ler([
      linha('A', 'um', 120, 'gr'),
      linha('A', 'dois', '0,5', 'Litros'),
      linha('A', 'três', '0.25', 'KG'),
      linha('A', 'quatro', ' 2 ', 'fatias'),
      linha('A', 'cinco', 3, 'UN'),
      linha('A', 'seis', 1, 'colheres'),
    ]);
    assert.equal(l.problemas, 0);
    assert.deepEqual(l.base.produtos[0]!.ficha!.ingredientes.map((i) => [i.quantidade, i.unidade]), [[120, 'g'], [0.5, 'l'], [0.25, 'kg'], [2, 'fatia'], [3, 'unidade'], [1, 'colher']]);
    // toda unidade da lista é aceita pelo próprio nome
    for (const u of UNIDADES) assert.equal(ler([linha('A', 'x', 1, u)]).base.produtos[0]!.ficha!.ingredientes[0]!.unidade, u);
  });

  it('"Vai para a cozinha": sim, não ou em branco (que vale sim)', () => {
    const l = ler([
      linha('P1', 'x', 1, 'g'),
      linha('P2', 'x', 1, 'g', 'SIM'),
      linha('P3', 'x', 1, 'g', 's'),
      linha('P4', 'x', 1, 'g', true),
      linha('P5', '', '', '', 'Não'),
      linha('P6', '', '', '', 'nao'),
      linha('P7', '', '', '', 'N'),
      linha('P8', '', '', '', false),
    ]);
    assert.equal(l.problemas, 0);
    assert.deepEqual(l.base.produtos.map((p) => p.cozinha), [true, true, true, true, false, false, false, false]);
  });

  it('linha em branco não é nada, e a linha do problema é a linha da planilha (o título é a 1)', () => {
    const l = lerPlanilha({
      fichas: [F, [], linha(null, null, null, null), ...BOM, linha('', '', '', ''), linha('Ruim', 'Queijo', '', 'g')],
    });
    assert.deepEqual(nomes(l), ['Batata frita']);
    assert.deepEqual(motivos(l, 'Ruim'), ['Fichas 7: falta a quantidade.']);
  });

  it('produto com uma linha só e sem ingrediente entra sem ficha; nome comprido é cortado', () => {
    const l = ler([linha('Refrigerante lata'), linha('N'.repeat(300), 'x', 1, 'g')]);
    assert.equal(l.problemas, 0);
    assert.deepEqual([l.base.produtos[0]!.ficha, l.semFicha], [null, ['Refrigerante lata']]);
    assert.equal(l.base.produtos[1]!.nome.length, 200);
  });
});

describe('planilha: entra o que está certo, e o que ficou de fora diz por quê', () => {
  it('cada defeito de uma linha deixa o produto INTEIRO de fora, e o vizinho entra', () => {
    const casos: Array<[string, Celula[][], string[]]> = [
      ['sem quantidade', [linha('Ruim', 'Pão', 1, 'unidade'), linha('Ruim', 'Queijo', '', 'fatia')], ['Fichas 5: falta a quantidade.']],
      ['quantidade que não é número', [linha('Ruim', 'Queijo', 'duas', 'fatia')], ['Fichas 4: a quantidade “duas” não é um número.']],
      ['quantidade com milhar', [linha('Ruim', 'Queijo', '1.200,5', 'g')], ['Fichas 4: a quantidade “1.200,5” não é um número.']],
      ['quantidade zero', [linha('Ruim', 'Queijo', 0, 'fatia')], ['Fichas 4: a quantidade tem de ser maior que zero.']],
      ['quantidade negativa', [linha('Ruim', 'Queijo', -2, 'fatia')], ['Fichas 4: a quantidade tem de ser maior que zero.']],
      ['sem unidade', [linha('Ruim', 'Queijo', 2, '')], ['Fichas 4: falta a unidade.']],
      ['unidade fora da lista', [linha('Ruim', 'Alface', 2, 'fls')], ['Fichas 4: a unidade “fls” não está na lista.']],
      ['quantidade e unidade erradas na mesma linha', [linha('Ruim', 'Alface', 'x', 'pct')], ['Fichas 4: a quantidade “x” não é um número.', 'Fichas 4: a unidade “pct” não está na lista.']],
      ['ingrediente sem quantidade nem unidade', [linha('Ruim', 'Pão', 1, 'unidade'), linha('Ruim', 'Queijo')], ['Fichas 5: falta a quantidade.', 'Fichas 5: falta a unidade.']],
      ['linha do produto sem ingrediente', [linha('Ruim', 'Pão', 1, 'unidade'), linha('Ruim')], ['Fichas 5: falta o ingrediente.']],
      ['a PRIMEIRA linha do produto sem ingrediente', [linha('Ruim'), linha('Ruim', 'Pão', 1, 'unidade')], ['Fichas 4: falta o ingrediente.']],
      ['quantidade sem ingrediente', [linha('Ruim', '', 2, 'fatia')], ['Fichas 4: a linha tem quantidade ou unidade, mas não tem o ingrediente.']],
      ['"vai para a cozinha" que não é sim nem não', [linha('Ruim', 'Pão', 1, 'unidade', 'talvez')], ['Fichas 4: “Vai para a cozinha” está como “talvez”.']],
      [
        '"vai para a cozinha" que muda no mesmo produto',
        [linha('Ruim', 'Pão', 1, 'unidade', 'sim'), linha('Ruim', 'Queijo', 1, 'fatia', 'não')],
        ['Fichas 4: “Vai para a cozinha” muda de uma linha para outra do mesmo produto.'],
      ],
      ['linha sem o nome do produto, embaixo dele', [linha('Ruim', 'Pão', 1, 'unidade'), linha('', 'Queijo', 1, 'fatia')], ['Fichas 5: a linha está preenchida, mas não tem o nome do produto.']],
    ];
    for (const [oQue, linhas, esperado] of casos) {
      const l = ler([...BOM, ...linhas]);
      assert.equal(l.impede, null, oQue);
      assert.deepEqual(nomes(l), ['Batata frita'], `${oQue}: só o certo entra`);
      assert.deepEqual(motivos(l, 'Ruim'), esperado, oQue);
      assert.equal(l.problemas, esperado.length, oQue);
      assert.ok(l.deFora[0]!.problemas.every((p) => p.corrigir.length > 10), `${oQue}: todo problema diz como corrigir`);
      assert.deepEqual(l.contas, { produtos: 1, comFicha: 1, ingredientes: 2, variacoes: 0, adicionais: 0, combos: 0 }, `${oQue}: a conta é só do que entra`);
    }
    // a unidade fora da lista diz quais valem
    assert.ok(ler([linha('Ruim', 'Alface', 2, 'fls')]).deFora[0]!.problemas[0]!.corrigir.includes(UNIDADES.join(', ')));
  });

  it('a ficha tem teto de linhas: trezentas entram, trezentas e uma deixam o produto de fora', () => {
    const com = (n: number) => ler([...BOM, ...Array.from({ length: n }, (_, i) => linha('Enorme', `Ingrediente ${i}`, 1, 'g'))]);
    assert.deepEqual([nomes(com(300)), com(300).problemas], [['Batata frita', 'Enorme'], 0]);
    assert.equal(produto(com(300), 'Enorme').ficha!.ingredientes.length, 300);
    assert.deepEqual([nomes(com(301)), motivos(com(301), 'Enorme')], [['Batata frita'], ['Fichas 4: o produto tem mais de 300 linhas.']]);
  });

  it('o mesmo produto em dois blocos de linhas fica de fora — ele ia entrar com a ficha embaralhada', () => {
    const l = ler([linha('X-Burger', 'Pão', 1, 'unidade'), ...BOM, linha('x-burger', 'Queijo', 2, 'fatia'), linha('Suco', 'Polpa', 100, 'g')]);
    assert.deepEqual(nomes(l), ['Batata frita', 'Suco']);
    assert.deepEqual(motivos(l, 'X-Burger'), ['Fichas 5: o produto aparece em dois blocos de linhas, separados por outro produto.']);
  });

  it('a linha sem nome no começo da planilha não é de produto nenhum: fica na lista dos soltos', () => {
    const l = ler([linha('', 'Queijo', 1, 'fatia'), ...BOM]);
    assert.deepEqual(nomes(l), ['Batata frita']);
    assert.deepEqual([l.deFora, l.problemas], [[], 1]);
    assert.deepEqual(l.soltos.map((p) => `${p.aba} ${p.linha}: ${p.texto}`), ['Fichas 2: a linha está preenchida, mas não tem o nome do produto.']);
  });

  it('nenhum produto certo: a base sai vazia, e a lista diz tudo', () => {
    const l = ler([linha('A', 'x', '', 'g'), linha('B', 'y', 1, '')]);
    assert.equal(l.impede, null);
    assert.deepEqual([l.base.produtos, l.contas.produtos, l.problemas, l.deFora.map((d) => d.produto)], [[], 0, 2, ['A', 'B']]);
  });

  it('a lista de problemas tem teto; a conta, não', () => {
    const muitos: Celula[][] = [];
    for (let i = 0; i < MAX_PROBLEMAS + 100; i += 1) muitos.push(linha(`Ruim ${i}`, 'x', '', 'g'));
    const l = ler([...BOM, ...muitos]);
    assert.equal(l.problemas, MAX_PROBLEMAS + 100);
    assert.equal(l.deFora.reduce((n, d) => n + d.problemas.length, 0), MAX_PROBLEMAS);
    assert.equal(l.deFora.length, MAX_PROBLEMAS + 100, 'todo produto que ficou de fora é nomeado');
    assert.deepEqual(nomes(l), ['Batata frita']);
  });
});

describe('planilha: as outras abas', () => {
  const V = [...COLUNAS.variacoes];
  const A = [...COLUNAS.adicionais];
  const C = [...COLUNAS.combos];
  const XB: Celula[][] = [linha('X-Burger', 'Pão', 1, 'unidade'), linha('X-Burger', 'Cebola Roxa', 10, 'g')];

  it('variações: em branco vale a ficha inteira; o que não serve deixa o produto de fora', () => {
    const bom = ler([...XB], { variacoes: [V, ['x-burger', 'Simples', ''], ['X-Burger', 'Duplo', 2], ['X-Burger', 'Meio', '0,5']] });
    assert.equal(bom.problemas, 0);
    assert.deepEqual(produto(bom, 'X-Burger').variacoes.map((v) => [v.nome, v.fator]), [['Simples', 1], ['Duplo', 2], ['Meio', 0.5]]);
    assert.equal(produto(bom, 'X-Burger').tipo, 'variavel');

    const casos: Array<[Celula[], string]> = [
      [['X-Burger', '', 2], 'Variações 2: falta o nome da variação.'],
      [['X-Burger', 'Duplo', 'dobro'], 'Variações 2: “Quanto da ficha” está como “dobro”.'],
      [['X-Burger', 'Duplo', 0], 'Variações 2: “Quanto da ficha” está como “0”.'],
    ];
    for (const [l, esperado] of casos) {
      const r = ler([...XB, ...BOM], { variacoes: [V, l] });
      assert.deepEqual([nomes(r), motivos(r, 'X-Burger')], [['Batata frita'], [esperado]]);
    }
    const repetida = ler([...XB], { variacoes: [V, ['X-Burger', 'Duplo', 2], ['X-Burger', 'DUPLO', 3]] });
    assert.deepEqual(motivos(repetida, 'X-Burger'), ['Variações 3: a variação “DUPLO” aparece duas vezes neste produto.']);
  });

  it('adicionais: acrescenta (com ou sem medida), tira (só o que está na ficha) e observação', () => {
    const bom = ler([...XB], {
      adicionais: [A, ['X-Burger', 'Bacon', 'Acrescenta', 'Bacon fatiado', 20, 'g'], ['X-Burger', 'Molho extra', 'adicionar', 'Molho', '', ''], ['X-Burger', 'Sem cebola', 'TIRA', 'cebola roxa', '', ''], ['X-Burger', 'Ponto', 'Só observação', '', '', '']],
    });
    assert.equal(bom.problemas, 0);
    const grupos = produto(bom, 'X-Burger').adicionais;
    assert.deepEqual(grupos.map((g) => [g.nome, g.tipo, g.opcoes.map((o) => o.nome)]), [['Adicionais', 'adicionar', ['Bacon', 'Molho extra', 'Ponto']], ['Retirar', 'remover', ['Sem cebola']]]);
    assert.deepEqual(grupos[0]!.opcoes[1]!.efeito, { tipo: 'insumo', nome: 'Molho', quantidade: null, unidade: null, insumoId: null });
    assert.deepEqual(grupos[1]!.opcoes[0]!.efeito, { tipo: 'retira', nome: 'Cebola Roxa', insumoId: null, fichaId: null }, 'com a grafia da ficha');
    assert.equal(bom.contas.adicionais, 4);

    const casos: Array<[Celula[], string]> = [
      [['X-Burger', '', 'acrescenta', 'Bacon', 20, 'g'], 'Adicionais 2: falta o nome do adicional.'],
      [['X-Burger', 'Bacon', '', 'Bacon', 20, 'g'], 'Adicionais 2: falta dizer o que o adicional faz.'],
      [['X-Burger', 'Bacon', 'troca', 'Bacon', 20, 'g'], 'Adicionais 2: “O que faz” está como “troca”.'],
      [['X-Burger', 'Bacon', 'acrescenta', '', '', ''], 'Adicionais 2: falta o ingrediente que o adicional acrescenta.'],
      [['X-Burger', 'Sem tomate', 'tira', '', '', ''], 'Adicionais 2: falta o ingrediente que o adicional tira.'],
      [['X-Burger', 'Sem tomate', 'tira', 'Tomate', '', ''], 'Adicionais 2: o produto não tem “Tomate” na ficha, para tirar.'],
      [['X-Burger', 'Bacon', 'acrescenta', 'Bacon', 20, ''], 'Adicionais 2: falta a unidade.'],
      [['X-Burger', 'Bacon', 'acrescenta', 'Bacon', '', 'g'], 'Adicionais 2: falta a quantidade.'],
      [['X-Burger', 'Bacon', 'acrescenta', 'Bacon', 20, 'tiras'], 'Adicionais 2: a unidade “tiras” não está na lista.'],
    ];
    for (const [l, esperado] of casos) {
      const r = ler([...XB, ...BOM], { adicionais: [A, l] });
      assert.deepEqual([nomes(r), motivos(r, 'X-Burger')], [['Batata frita'], [esperado]]);
    }
  });

  it('combos: o produto que vem nele tem de existir, e a quantidade em branco vale 1', () => {
    const combo: Celula[][] = [...XB, ...BOM, linha('Combo')];
    const bom = ler(combo, { combos: [C, ['Combo', 'X-Burger', ''], ['combo', 'batata frita', 2]] });
    assert.equal(bom.problemas, 0);
    assert.deepEqual(produto(bom, 'Combo').combo.map((c) => [c.nome, c.quantidade]), [['X-Burger', 1], ['Batata frita', 2]]);
    assert.deepEqual([produto(bom, 'Combo').tipo, bom.contas.combos, bom.semFicha], ['combo', 1, []]);

    const casos: Array<[Celula[], string]> = [
      [['Combo', '', 1], 'Combos 2: falta o produto que vem no combo.'],
      [['Combo', 'Suco', 1], 'Combos 2: o produto “Suco”, que vem no combo, não está na aba Fichas.'],
      [['Combo', 'Combo', 1], 'Combos 2: o combo não pode vir dentro dele mesmo.'],
      [['Combo', 'X-Burger', 'dois'], 'Combos 2: a quantidade está como “dois”.'],
      [['Combo', 'X-Burger', 0], 'Combos 2: a quantidade está como “0”.'],
    ];
    for (const [l, esperado] of casos) {
      const r = ler(combo, { combos: [C, l] });
      assert.deepEqual([nomes(r), motivos(r, 'Combo')], [['X-Burger', 'Batata frita'], [esperado]]);
    }
    const repetido = ler(combo, { combos: [C, ['Combo', 'X-Burger', 1], ['Combo', 'x-burger', 1]] });
    assert.deepEqual(motivos(repetido, 'Combo'), ['Combos 3: o produto “X-Burger” aparece duas vezes neste combo.']);
  });

  it('o combo que leva um produto que ficou de fora fica de fora junto — e o combo que leva esse combo, também', () => {
    // o "Combo família" vem ANTES do combo de que ele depende: a conta tem de dar a volta até não mudar mais
    const l = ler([linha('X-Burger', 'Pão', '', 'unidade'), ...BOM, linha('Combo família'), linha('Combo'), linha('Combo de batata')], {
      combos: [C, ['Combo', 'Batata frita', 1], ['Combo', 'X-Burger', 1], ['Combo família', 'Combo', 2], ['Combo de batata', 'Batata frita', 3]],
    });
    assert.deepEqual(nomes(l), ['Batata frita', 'Combo de batata']);
    assert.deepEqual(l.deFora.map((d) => d.produto), ['X-Burger', 'Combo família', 'Combo'], 'na ordem da planilha');
    assert.deepEqual(motivos(l, 'Combo'), ['Combos 3: o produto “X-Burger”, que vem neste combo, ficou de fora.']);
    assert.deepEqual(motivos(l, 'Combo família'), ['Combos 4: o produto “Combo”, que vem neste combo, ficou de fora.']);
    assert.equal(l.problemas, 3);
  });

  it('a linha das outras abas que fala de um produto que não está na aba Fichas fica solta — e não derruba ninguém', () => {
    const l = ler([...XB], {
      variacoes: [V, ['Suco', 'Grande', 2], ['', 'Grande', 2]],
      adicionais: [A, ['Suco', 'Gelo', 'observação', '', '', '']],
      combos: [C, ['Combo', 'X-Burger', 1]],
    });
    assert.deepEqual([nomes(l), l.deFora, l.problemas], [['X-Burger'], [], 4]);
    assert.deepEqual(
      l.soltos.map((p) => `${p.aba} ${p.linha}: ${p.texto}`).sort(),
      [
        'Adicionais 2: o produto “Suco” não está na aba Fichas.',
        'Combos 2: o produto “Combo” não está na aba Fichas.',
        'Variações 2: o produto “Suco” não está na aba Fichas.',
        'Variações 3: a linha está preenchida, mas a coluna “Produto” está em branco.',
      ],
    );
  });
});

describe('planilha: o que impede tudo', () => {
  const impede = (abas: unknown) => {
    const l = lerPlanilha(abas);
    // pelo tamanho, e não pela lista: quando falha com milhares de produtos, a diferença escrita seria enorme
    assert.deepEqual([l.base.produtos.length, l.contas.produtos, l.problemas], [0, 0, 0]);
    return l.impede;
  };

  it('sem a aba Fichas, sem linha, sem coluna obrigatória, grande demais — e o motivo é dito', () => {
    assert.match(impede(null)!, /Não deu para ler a planilha/);
    assert.match(impede('planilha')!, /Não deu para ler a planilha/);
    assert.match(impede([])!, /Não deu para ler a planilha/);
    assert.match(impede({})!, /não tem a aba “Fichas”/);
    assert.match(impede({ fichas: null })!, /não tem a aba “Fichas”/);
    assert.match(impede({ fichas: 'texto' })!, /Não deu para ler a aba “Fichas”/);
    assert.match(impede({ fichas: [F, 'linha'] })!, /Não deu para ler a aba “Fichas”/);
    assert.match(impede({ fichas: [] })!, /A aba “Fichas” está vazia/);
    assert.match(impede({ fichas: [F] })!, /não tem nenhuma linha preenchida/);
    assert.match(impede({ fichas: [F, [], ['', '']] })!, /não tem nenhuma linha preenchida/);
    for (const falta of ['Produto', 'Ingrediente', 'Quantidade', 'Unidade']) {
      const titulos = F.filter((t) => t !== falta);
      assert.equal(impede({ fichas: [titulos, ['x', 'y', 1, 'g']] }), `A aba “Fichas” não tem a coluna “${falta}”. Baixe o modelo e use os mesmos títulos.`);
    }
    // as que podem faltar, faltando, não impedem
    assert.equal(lerPlanilha({ fichas: [['Produto', 'Ingrediente', 'Quantidade', 'Unidade'], ['A', 'x', 1, 'g']] }).impede, null);
    const grande = [F, ...Array.from({ length: MAX_LINHAS + 1 }, () => linha('A', 'x', 1, 'g'))];
    assert.match(impede({ fichas: grande })!, /tem mais de 20\.000 linhas/);
    assert.equal(lerPlanilha({ fichas: grande.slice(0, MAX_LINHAS + 1) }).impede, null, 'no teto ainda lê');
  });

  it('a aba que pode faltar, quando vem torta, também impede — meia planilha lida seria pior', () => {
    const fichas = [F, linha('A', 'x', 1, 'g')];
    assert.equal(lerPlanilha({ fichas, variacoes: null, adicionais: undefined, combos: [] }).impede, null, 'ausente ou vazia: tudo bem');
    assert.match(impede({ fichas, variacoes: 'x' })!, /Não deu para ler a aba “Variações”/);
    assert.equal(impede({ fichas, variacoes: [['Produto', 'Quanto da ficha'], ['A', 2]] }), 'A aba “Variações” não tem a coluna “Variação”. Baixe o modelo e use os mesmos títulos.');
    assert.equal(impede({ fichas, adicionais: [['Produto', 'Adicional'], ['A', 'Bacon']] }), 'A aba “Adicionais” não tem a coluna “O que faz”. Baixe o modelo e use os mesmos títulos.');
    assert.equal(impede({ fichas, combos: [['Combo'], ['A']] }), 'A aba “Combos” não tem a coluna “Produto que vem nele”. Baixe o modelo e use os mesmos títulos.');
  });

  it('produtos demais não é a planilha de uma loja', () => {
    const muitos = [F, ...Array.from({ length: 5001 }, (_, i) => linha(`P${i}`))];
    assert.match(impede({ fichas: muitos })!, /mais de 5\.000 produtos/);
    assert.equal(lerPlanilha({ fichas: muitos.slice(0, 5001) }).contas.produtos, 5000);
  });
});

describe('planilha: o que a base não leva', () => {
  it('a base tem só o formato do Farol — nada da planilha além do que o modelo pede', () => {
    const base: Base = lerPlanilha(MODELO).base;
    assert.equal(base.formato, 1);
    const chaves = new Set<string>();
    const andar = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(andar);
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (chaves.add(k), andar(x));
    };
    andar(base);
    assert.deepEqual(
      [...chaves].sort(),
      ['adicionais', 'categoria', 'codigo', 'combo', 'cozinha', 'efeito', 'fator', 'ficha', 'fichaId', 'formato', 'id', 'ingredientes', 'insumoId', 'nome', 'opcoes', 'preparo', 'preparoMin', 'produtoId', 'produtos', 'quantidade', 'setor', 'tipo', 'unidade', 'variacoes'],
    );
  });
});
