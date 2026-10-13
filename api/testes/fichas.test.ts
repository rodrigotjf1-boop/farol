// A base de fichas no formato do Farol, e o adaptador que a monta do que o
// Regem responde. Sem banco.
//
// A entrada é uma resposta DE VERDADE do Regem
// (`contratos/regem-catalogo-e-fichas.json`, gravada de uma chamada ao
// servidor dele): se o contrato de lá mudar, é este arquivo que muda — e
// estes testes dizem o que o Farol deixou de entender.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { contarBase, impressaoDaBase, lerBase, resumoDoProduto, type Base, type Produto } from '../src/fichas.js';
import { ErroDoRegem } from '../src/regem.js';
import { baseDoRegem } from '../src/regem-fichas.js';

type Obj = Record<string, any>;
const real = JSON.parse(readFileSync(new URL('../../contratos/regem-catalogo-e-fichas.json', import.meta.url), 'utf8')) as {
  catalogo: Obj;
  fichas: Obj;
  catalogoSemMudanca: Obj;
};
/** Uma cópia da resposta de verdade, para o teste mexer sem estragar a dos outros. */
const copia = () => structuredClone({ catalogo: real.catalogo, fichas: real.fichas });
const base = () => baseDoRegem(real.catalogo, real.fichas);
const produto = (b: Base, nome: string): Produto => b.produtos.find((p) => p.nome === nome)!;
const deLa = (nome: string): Obj => real.catalogo.produtos.find((p: Obj) => p.nome === nome);
const fichaDeLa = (nome: string): Obj => real.fichas.fichas.find((f: Obj) => f.nome === nome);

describe('fichas: a resposta de verdade do Regem vira a base do Farol', () => {
  it('a amostra é a que o contrato descreve', () => {
    assert.deepEqual(Object.keys(real.catalogo).sort(), ['atualizado', 'categorias', 'gerado_em', 'loja_id', 'produtos', 'setores', 'versao']);
    assert.deepEqual(Object.keys(real.fichas).sort(), ['atualizado', 'fichas', 'gerado_em', 'loja_id', 'versao']);
    assert.deepEqual(Object.keys(real.catalogoSemMudanca).sort(), ['atualizado', 'versao'], '"nada mudou" traz só a versão');
    assert.equal(real.catalogoSemMudanca.atualizado, false);
  });

  it('entram os produtos que a loja vende, na ordem do cardápio; o inativo fica de fora', () => {
    const b = base();
    assert.equal(b.formato, 1);
    // Burgers (ordem 2), Bebidas (ordem 3) e, por último, os sem categoria, pelo nome.
    assert.deepEqual(b.produtos.map((p) => p.nome), ['X-Burger', 'Refrigerante lata', 'Combo da casa', 'Só da matriz']);
    assert.ok(real.catalogo.produtos.some((p: Obj) => p.nome === 'X-Parado' && p.ativo === false), 'o inativo existe na resposta');
    assert.deepEqual(contarBase(b), { produtos: 4, comFicha: 1 });
  });

  it('o produto, campo a campo', () => {
    const xb = produto(base(), 'X-Burger');
    assert.deepEqual(
      { id: xb.id, nome: xb.nome, codigo: xb.codigo, categoria: xb.categoria, tipo: xb.tipo, cozinha: xb.cozinha, setor: xb.setor, preparoMin: xb.preparoMin },
      { id: deLa('X-Burger').id, nome: 'X-Burger', codigo: 'XB', categoria: 'Burgers', tipo: 'variavel', cozinha: true, setor: 'Montagem', preparoMin: 12 },
    );
    const refri = produto(base(), 'Refrigerante lata');
    assert.deepEqual([refri.cozinha, refri.categoria, refri.ficha, refri.setor, refri.preparoMin], [false, 'Bebidas', null, null, null]);
    assert.deepEqual(Object.keys(xb), ['id', 'nome', 'codigo', 'categoria', 'tipo', 'cozinha', 'setor', 'preparoMin', 'ficha', 'variacoes', 'combo', 'adicionais']);
  });

  it('a ficha vem na ordem em que foi cadastrada; o preparo da casa é UM ingrediente; a embalagem de viagem fica de fora', () => {
    const ficha = produto(base(), 'X-Burger').ficha!;
    assert.equal(ficha.id, fichaDeLa('X-Burger').id);
    assert.equal(ficha.nome, 'X-Burger');
    assert.deepEqual(
      ficha.ingredientes.map((i) => [i.nome, i.quantidade, i.unidade, i.preparo]),
      [
        ['Pão brioche', 1, 'unidade', false],
        ['Blend da casa', 0.12, 'kg', true],
        ['Queijo prato', 2, 'fatia', false],
        ['Cebola roxa', 0.01, 'kg', false],
        ['Sal', 2, 'g', false],
      ],
    );
    // A quantidade é a que a pessoa informou ("2 fatia"), não a do estoque (0,04 kg).
    assert.ok(fichaDeLa('X-Burger').ingredientes.some((i: Obj) => i.nome === 'Caixa de lanche' && i.so_delivery === true), 'a linha de viagem existe na resposta');
    const blend = ficha.ingredientes[1]!;
    assert.deepEqual([blend.fichaId, blend.insumoId], [fichaDeLa('Blend da casa').id, null], 'o preparo aponta para a ficha dele, sem desmontá-la');
    const sal = ficha.ingredientes[4]!;
    assert.deepEqual([sal.fichaId, sal.insumoId], [null, null], 'o que foi escrito à mão não tem id');
    assert.deepEqual(Object.keys(blend), ['nome', 'quantidade', 'unidade', 'preparo', 'insumoId', 'fichaId']);
  });

  it('a embalagem do balcão fica de fora, como a de viagem — com a chave da mesma embalagem ligada ou desligada', () => {
    // O Regem manda `so_balcao` em cada linha e `mesma_embalagem` no topo desde 12/10/2026;
    // a amostra é de antes. A chave só diz qual embalagem vale em cada venda: aqui nenhuma entra.
    const deAntes = impressaoDaBase(base());
    for (const mesma of [false, true]) {
      const c = copia();
      c.fichas.mesma_embalagem = mesma;
      const fx = c.fichas.fichas.find((f: Obj) => f.nome === 'X-Burger');
      for (const i of fx.ingredientes) i.so_balcao = false;
      fx.ingredientes.push({ ...fx.ingredientes[0], ordem: 99, nome: 'Bandeja do balcão', so_delivery: false, so_balcao: true });
      const b = baseDoRegem(c.catalogo, c.fichas);
      assert.deepEqual(
        produto(b, 'X-Burger').ficha!.ingredientes.map((i) => i.nome),
        ['Pão brioche', 'Blend da casa', 'Queijo prato', 'Cebola roxa', 'Sal'],
        `mesma_embalagem = ${mesma}: nem a bandeja do balcão nem a caixa de viagem`,
      );
      assert.equal(impressaoDaBase(b), deAntes, `mesma_embalagem = ${mesma}: campo novo e linha de embalagem não mudam a base`);
    }
  });

  it('linha de embalagem é só a que vem marcada com `true`', () => {
    const temQueijo = (c: ReturnType<typeof copia>) =>
      produto(baseDoRegem(c.catalogo, c.fichas), 'X-Burger').ficha!.ingredientes.some((i) => i.nome === 'Queijo prato');
    const marcar = (campo: 'so_balcao' | 'so_delivery', valor: unknown) => {
      const c = copia();
      c.fichas.fichas.find((f: Obj) => f.nome === 'X-Burger').ingredientes.find((i: Obj) => i.nome === 'Queijo prato')[campo] = valor;
      return c;
    };
    for (const campo of ['so_balcao', 'so_delivery'] as const) {
      for (const valor of [false, null, undefined, 'true', 1, 'sim']) {
        assert.ok(temQueijo(marcar(campo, valor)), `${campo} = ${String(valor)} não tira a linha`);
      }
      assert.ok(!temQueijo(marcar(campo, true)), `${campo} = true tira a linha`);
    }
  });

  it('as variações dizem quanto da ficha usam, da menor para a maior — e não levam o id que muda a cada salvamento', () => {
    const xb = produto(base(), 'X-Burger');
    assert.deepEqual(xb.variacoes, [
      { nome: 'Simples', codigo: 'XB-S', fator: 1 },
      { nome: 'Duplo', codigo: 'XB-D', fator: 2 },
    ]);
  });

  it('o combo diz o que vem nele, com o nome de cada produto', () => {
    const combo = produto(base(), 'Combo da casa');
    assert.equal(combo.tipo, 'combo');
    assert.deepEqual(combo.combo, [
      { produtoId: deLa('Refrigerante lata').id, nome: 'Refrigerante lata', quantidade: 2 },
      { produtoId: deLa('X-Burger').id, nome: 'X-Burger', quantidade: 1 },
    ]);
  });

  it('cada opção diz o que muda na montagem: insumo, preparo, produto, observação e o que se tira', () => {
    const xb = produto(base(), 'X-Burger');
    assert.deepEqual(xb.adicionais.map((g) => [g.nome, g.tipo, g.opcoes.map((o) => o.nome)]), [
      ['Adicionais', 'adicionar', ['Bacon', 'Ovo', 'Refrigerante', 'Ponto da carne']],
      ['Retirar', 'remover', ['Sem cebola']],
    ]);
    const [bacon, ovo, refri, ponto] = xb.adicionais[0]!.opcoes;
    const insumoDoBacon = deLa('X-Burger').adicionais[0].opcoes[0].acrescenta.insumo_id;
    assert.deepEqual(bacon!.efeito, { tipo: 'insumo', nome: 'Bacon fatiado', quantidade: 0.02, unidade: 'kg', insumoId: insumoDoBacon });
    // A ficha do "Ovo frito" está inativa lá — e continua sendo o que a opção acrescenta: o nome vem.
    assert.deepEqual(ovo!.efeito, { tipo: 'preparo', fichaId: fichaDeLa('Ovo frito').id, nome: 'Ovo frito' });
    assert.equal(fichaDeLa('Ovo frito').ativo, false);
    assert.deepEqual(refri!.efeito, { tipo: 'produto', produtoId: deLa('Refrigerante lata').id, nome: 'Refrigerante lata' });
    assert.deepEqual(ponto!.efeito, { tipo: 'observacao' });
    const semCebola = xb.adicionais[1]!.opcoes[0]!;
    const cebola = fichaDeLa('X-Burger').ingredientes.find((i: Obj) => i.nome === 'Cebola roxa');
    assert.deepEqual(semCebola.efeito, { tipo: 'retira', nome: 'Cebola roxa', insumoId: cebola.insumo_id, fichaId: null });
    // O que se tira casa com um ingrediente da ficha pelo mesmo id.
    assert.equal(xb.ficha!.ingredientes.find((i) => i.nome === 'Cebola roxa')!.insumoId, cebola.insumo_id);
    // O id da opção é o FIXO (o que a fila da cozinha manda), não o que muda a cada salvamento.
    assert.equal(bacon!.id, deLa('X-Burger').adicionais[0].opcoes[0].opcao_id);
    assert.notEqual(bacon!.id, deLa('X-Burger').adicionais[0].opcoes[0].id);
    assert.equal(semCebola.id, null, 'opção que não é reutilizável não tem id fixo');
    assert.deepEqual([bacon!.codigo, ponto!.codigo], ['AD-BAC', null]);
  });

  it('não há dinheiro na base — nem o nome de um campo', () => {
    const chaves = new Set<string>();
    const andar = (v: unknown): void => {
      if (Array.isArray(v)) return void v.forEach(andar);
      if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (chaves.add(k), andar(x));
    };
    andar(base());
    assert.ok(chaves.size > 20, 'a base foi mesmo percorrida');
    for (const k of chaves) assert.doesNotMatch(k, /pre[cç]o|custo|valor|margem|cmv|cliente|total|desconto/i, k);
    // E a mesma conta na resposta de lá: o Regem nem manda.
    const deLa2 = new Set<string>();
    const andarLa = (v: unknown): void => {
      if (Array.isArray(v)) return void v.forEach(andarLa);
      if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (deLa2.add(k), andarLa(x));
    };
    andarLa(real);
    for (const k of deLa2) assert.doesNotMatch(k, /pre[cç]o|custo|valor|margem|cmv|cliente/i, k);
  });
});

describe('fichas: o que não entra, e o que não derruba', () => {
  it('ficha inativa: o produto fica sem ficha', () => {
    const c = copia();
    c.fichas.fichas.find((f: Obj) => f.nome === 'X-Burger').ativo = false;
    const xb = produto(baseDoRegem(c.catalogo, c.fichas), 'X-Burger');
    assert.equal(xb.ficha, null);
    assert.equal(xb.variacoes.length, 2, 'o resto do produto continua');
  });

  it('variação e opção inativas não entram; grupo que fica sem opção some', () => {
    const c = copia();
    const xb = c.catalogo.produtos.find((p: Obj) => p.nome === 'X-Burger');
    xb.variacoes[0].ativo = false;
    xb.adicionais[0].opcoes[0].ativo = false;
    xb.adicionais[1].opcoes[0].ativo = false;
    const p = produto(baseDoRegem(c.catalogo, c.fichas), 'X-Burger');
    assert.deepEqual(p.variacoes.map((v) => v.nome), ['Simples']);
    assert.deepEqual(p.adicionais.map((g) => [g.nome, g.opcoes.map((o) => o.nome)]), [['Adicionais', ['Ovo', 'Refrigerante', 'Ponto da carne']]]);
  });

  it('o que a resposta não traz vira "não sei", e não erro', () => {
    const c = copia();
    const xb = c.catalogo.produtos.find((p: Obj) => p.nome === 'X-Burger');
    xb.categoria_id = '00000000-0000-4000-8000-000000000000'; // categoria que não veio
    xb.setor_producao_id = '00000000-0000-4000-8000-000000000001'; // setor de outra loja
    xb.ficha_id = '00000000-0000-4000-8000-000000000002'; // ficha que não veio
    xb.adicionais[0].opcoes[1].acrescenta.ficha_id = '00000000-0000-4000-8000-000000000003';
    xb.adicionais[0].opcoes[2].acrescenta = null;
    xb.adicionais[0].opcoes[0].acrescenta = { tipo: 'coisa nova que o Farol ainda não conhece' };
    xb.adicionais[1].opcoes[0].retira = null;
    c.catalogo.produtos.find((p: Obj) => p.nome === 'Combo da casa').combo[0].produto_id = '00000000-0000-4000-8000-000000000004';
    const b = baseDoRegem(c.catalogo, c.fichas);
    const p = produto(b, 'X-Burger');
    assert.deepEqual([p.categoria, p.setor, p.ficha], [null, null, null]);
    assert.deepEqual(p.adicionais[0]!.opcoes.map((o) => o.efeito.tipo), ['nada', 'preparo', 'nada', 'observacao']);
    assert.equal((p.adicionais[0]!.opcoes[1]!.efeito as { nome: string | null }).nome, null);
    assert.deepEqual(p.adicionais[1]!.opcoes[0]!.efeito, { tipo: 'nada' });
    assert.equal(produto(b, 'Combo da casa').combo[0]!.nome, null);
    // Sem categoria, o X-Burger vai para o fim, com os outros sem categoria.
    assert.deepEqual(b.produtos.map((x) => x.nome), ['Refrigerante lata', 'Combo da casa', 'Só da matriz', 'X-Burger']);
  });

  it('loja sem ficha nenhuma é uma base válida: os produtos entram, todos sem ficha', () => {
    const b = baseDoRegem(real.catalogo, { ...real.fichas, fichas: [] });
    assert.deepEqual(contarBase(b), { produtos: 4, comFicha: 0 });
    // Sem a ficha na lista, o nome do preparo que a opção acrescenta não é conhecido.
    assert.deepEqual(produto(b, 'X-Burger').adicionais[0]!.opcoes[1]!.efeito, {
      tipo: 'preparo',
      fichaId: fichaDeLa('Ovo frito').id,
      nome: null,
    });
  });

  it('loja sem produto nenhum também: a base vem vazia', () => {
    assert.deepEqual(baseDoRegem({ ...real.catalogo, produtos: [] }, real.fichas), { formato: 1, produtos: [] });
  });

  it('resposta fora do contrato é recusada inteira — nunca meia base', () => {
    const tortas: Array<[string, (c: ReturnType<typeof copia>) => void]> = [
      ['sem a lista de produtos', (c) => void delete c.catalogo.produtos],
      ['produtos que não é lista', (c) => void (c.catalogo.produtos = 'muitos')],
      ['sem a lista de fichas', (c) => void delete c.fichas.fichas],
      ['produto que não é objeto', (c) => void c.catalogo.produtos.push('x')],
      // nulo e lista no lugar de um item: sem a conferência, viraria um erro de programa, e não "resposta torta"
      ['produto nulo', (c) => void c.catalogo.produtos.push(null)],
      ['ficha que é uma lista', (c) => void c.fichas.fichas.push([])],
      ['ingrediente nulo', (c) => void c.fichas.fichas.find((f: Obj) => f.nome === 'X-Burger').ingredientes.push(null)],
      ['produto sem nome', (c) => void (c.catalogo.produtos[0].nome = '  ')],
      ['produto sem id', (c) => void (c.catalogo.produtos[0].id = null)],
      ['ficha sem nome', (c) => void (c.fichas.fichas[0].nome = null)],
      ['ingrediente sem nome', (c) => void (c.fichas.fichas.find((f: Obj) => f.nome === 'X-Burger').ingredientes[0].nome = '')],
      ['variação sem nome', (c) => void (c.catalogo.produtos.find((p: Obj) => p.nome === 'X-Burger').variacoes[0].nome = null)],
      ['opção sem nome', (c) => void (c.catalogo.produtos.find((p: Obj) => p.nome === 'X-Burger').adicionais[0].opcoes[0].nome = null)],
      ['item de combo sem produto', (c) => void (c.catalogo.produtos.find((p: Obj) => p.nome === 'Combo da casa').combo[0].produto_id = null)],
      ['adicionais que não é lista', (c) => void (c.catalogo.produtos[0].adicionais = {})],
      ['produtos demais', (c) => void (c.catalogo.produtos = Array.from({ length: 5001 }, (_, i) => ({ id: `p${i}`, nome: `P ${i}` })))],
    ];
    for (const [nome, estragar] of tortas) {
      const c = copia();
      estragar(c);
      assert.throws(() => baseDoRegem(c.catalogo, c.fichas), (e) => e instanceof ErroDoRegem && e.motivo === 'resposta_torta', nome);
    }
    for (const [c, f] of [[null, real.fichas], [real.catalogo, null], ['texto', real.fichas], [real.catalogo, 7]] as const) {
      assert.throws(() => baseDoRegem(c, f), (e) => e instanceof ErroDoRegem && e.motivo === 'resposta_torta');
    }
  });

  it('cinco mil produtos ainda são uma loja', () => {
    const muitos = Array.from({ length: 5000 }, (_, i) => ({ id: `id-${i}`, nome: `Produto ${i}` }));
    assert.equal(baseDoRegem({ ...real.catalogo, produtos: muitos }, real.fichas).produtos.length, 5000);
  });
});

describe('fichas: a impressão da base', () => {
  it('a mesma resposta dá sempre a mesma impressão — em qualquer ordem que as listas cheguem', () => {
    const a = impressaoDaBase(base());
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.equal(impressaoDaBase(base()), a);
    const c = copia();
    c.catalogo.produtos.reverse();
    c.catalogo.categorias.reverse();
    c.fichas.fichas.reverse();
    c.catalogo.produtos.find((p: Obj) => p.nome === 'X-Burger').variacoes.reverse();
    for (const g of c.catalogo.produtos.find((p: Obj) => p.nome === 'X-Burger').adicionais) g.opcoes.reverse();
    c.catalogo.produtos.find((p: Obj) => p.nome === 'X-Burger').adicionais.reverse();
    c.fichas.fichas.find((f: Obj) => f.nome === 'X-Burger').ingredientes.reverse();
    assert.equal(impressaoDaBase(baseDoRegem(c.catalogo, c.fichas)), a);
  });

  it('o que o Regem troca a cada salvamento, e o que a base não guarda, NÃO muda a impressão', () => {
    const a = impressaoDaBase(base());
    const c = copia();
    const xb = c.catalogo.produtos.find((p: Obj) => p.nome === 'X-Burger');
    for (const v of xb.variacoes) v.id = `outro-${v.id}`;
    for (const g of xb.adicionais) {
      g.id = `outro-${g.id}`;
      for (const o of g.opcoes) o.id = `outro-${o.id}`;
    }
    xb.descricao = 'Outra descrição';
    c.catalogo.versao = 'f'.repeat(32);
    c.catalogo.gerado_em = '2030-01-01T00:00:00.000Z';
    const fx = c.fichas.fichas.find((f: Obj) => f.nome === 'X-Burger');
    fx.ingredientes.find((i: Obj) => i.nome === 'Queijo prato').quantidade_estoque = 0.05;
    fx.ingredientes.find((i: Obj) => i.nome === 'Caixa de lanche').quantidade = 3; // a linha de viagem não entra
    c.catalogo.produtos.find((p: Obj) => p.nome === 'X-Parado').nome = 'X-Parado de novo'; // o inativo não entra
    assert.equal(impressaoDaBase(baseDoRegem(c.catalogo, c.fichas)), a);
  });

  it('o que muda a montagem muda a impressão', () => {
    const a = impressaoDaBase(base());
    const mudancas: Array<[string, (c: ReturnType<typeof copia>) => void]> = [
      ['a quantidade de um ingrediente', (c) => void (c.fichas.fichas.find((f: Obj) => f.nome === 'X-Burger').ingredientes[2].quantidade = 3)],
      ['a ordem dos ingredientes', (c) => void (c.fichas.fichas.find((f: Obj) => f.nome === 'X-Burger').ingredientes[0].ordem = 9)],
      ['um ingrediente deixa de ser só de viagem', (c) => void (c.fichas.fichas.find((f: Obj) => f.nome === 'X-Burger').ingredientes[4].so_delivery = false)],
      ['um ingrediente passa a ser só do balcão', (c) => void (c.fichas.fichas.find((f: Obj) => f.nome === 'X-Burger').ingredientes[3].so_balcao = true)],
      ['o fator de uma variação', (c) => void (c.catalogo.produtos.find((p: Obj) => p.nome === 'X-Burger').variacoes[0].fator_ficha = 3)],
      ['o nome de um produto', (c) => void (c.catalogo.produtos.find((p: Obj) => p.nome === 'Só da matriz').nome = 'Só da matriz 2')],
      ['um produto que volta a ser vendido', (c) => void (c.catalogo.produtos.find((p: Obj) => p.nome === 'X-Parado').ativo = true)],
      ['um produto deixa de passar pela cozinha', (c) => void (c.catalogo.produtos.find((p: Obj) => p.nome === 'X-Burger').vai_para_producao = false)],
    ];
    const vistas = new Set([a]);
    for (const [nome, mudar] of mudancas) {
      const c = copia();
      mudar(c);
      const nova = impressaoDaBase(baseDoRegem(c.catalogo, c.fichas));
      assert.ok(!vistas.has(nova), nome);
      vistas.add(nova);
    }
  });
});

describe('fichas: o que a tela recebe', () => {
  it('a linha da lista diz o que o Farol sabe do produto, sem o detalhe', () => {
    const b = base();
    assert.deepEqual(resumoDoProduto(produto(b, 'X-Burger')), {
      id: deLa('X-Burger').id,
      nome: 'X-Burger',
      categoria: 'Burgers',
      cozinha: true,
      ingredientes: 5,
      combo: null,
      variacoes: 2,
      adicionais: 5,
    });
    assert.deepEqual(
      [resumoDoProduto(produto(b, 'Combo da casa')), resumoDoProduto(produto(b, 'Refrigerante lata'))].map((r) => [r.ingredientes, r.combo, r.variacoes, r.adicionais, r.cozinha]),
      [
        [null, 2, 0, 0, true],
        [null, null, 0, 0, false],
      ],
    );
  });

  it('o que está guardado só é lido se tiver a forma desta versão', () => {
    const b = base();
    assert.deepEqual(lerBase(JSON.parse(JSON.stringify(b))), b);
    for (const ruim of [null, undefined, 'texto', 7, [], {}, { formato: 2, produtos: [] }, { formato: 1 }, { formato: 1, produtos: 'x' }]) {
      assert.equal(lerBase(ruim), null, JSON.stringify(ruim));
    }
  });
});
