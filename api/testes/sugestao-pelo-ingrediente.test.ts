// A sugestão pelo ingrediente que só um lanche tem (o protótipo aprovado pelo dono em 06/11/2026) e o adicional pelo
// NOME (a opção de adicional sem ligação ao insumo cujo nome é o de um ingrediente das fichas). A regra da sugestão mora
// no console (web/componentes/treino/sugestao-pelo-ingrediente.ts) e é testada aqui, como a da planta; os dados dela vêm
// da API (`lanchesDoIngrediente` de `ingredientesDaBase` e `familias` do estudo das fichas). Sem banco.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { estudarFichas } from '../src/estudo-das-fichas.js';
import { FORMATO_DA_BASE, type Base, type Efeito, type Produto } from '../src/fichas.js';
import { ingredientesDaBase, valePeloNome } from '../src/ingredientes.js';
import { ingredienteUnico, nomeDaFamilia, sugestaoPeloIngrediente } from '../../web/componentes/treino/sugestao-pelo-ingrediente.ts';

const ing = (nome: string) => ({ nome, quantidade: 1, unidade: 'un', preparo: false, insumoId: null, fichaId: null });
function produto(id: string, nome: string, ingredientes: string[], adicionais: Array<[string, Efeito]> = [], cozinha = true): Produto {
  return {
    id, nome, codigo: null, categoria: null, tipo: 'simples', cozinha, setor: null, preparoMin: null,
    ficha: { id: `f-${id}`, nome, ingredientes: ingredientes.map(ing) }, variacoes: [], combo: [],
    adicionais: adicionais.length ? [{ nome: 'Adicionais', tipo: 'adicionar', opcoes: adicionais.map(([n, efeito]) => ({ id: null, nome: n, codigo: null, efeito })) }] : [],
  };
}
const NADA: Efeito = { tipo: 'nada' };
/** O cardápio de teste: o Nº 08 e o Trio 08 (a mesma ficha, com o anel de cebola), o Nº 16 (cheddar cremoso), o X-Bacon
 * (o OVO como adicional SEM ligação; o anel de cebola como adicional LIGADO) e a Porção (sem cozinha: não é da bancada). */
const BASE: Base = {
  formato: FORMATO_DA_BASE,
  produtos: [
    produto('n08', 'Numero 08', ['Pão brioche', 'Carne 120gr', 'Anel de cebola', 'Ovo']),
    produto('t08', 'TRIO 08', ['Pão brioche', 'Carne 120gr', 'Anel de cebola', 'Ovo']),
    produto('n16', 'Numero 16', ['Pão brioche', 'Carne 120gr', 'Cheddar cremoso', 'Cebola crispy']),
    produto('xb', 'X-Bacon', ['Pão brioche', 'Carne 120gr', 'Bacon'], [
      ['Ovo', NADA],
      ['Cebola crispy', NADA],
      ['Anel extra', { tipo: 'insumo', nome: 'Anel de cebola', quantidade: 1, unidade: 'un', insumoId: null }],
      ['Batata palha', NADA],
      ['Refri lata', { tipo: 'produto', produtoId: 'lata', nome: 'Refri lata' }],
    ]),
    produto('px', 'Porção de bacon', ['Bacon'], [], false),
  ],
};

describe('o adicional pelo nome (a opção sem ligação ao insumo)', () => {
  it('a opção "nada" com o nome de um ingrediente conhecido vira adicional; a que não bate e a que põe produto, não', () => {
    const daBase = ingredientesDaBase(BASE);
    const onde = (n: string) => daBase.find((i) => i.nome === n)!.produtos.map((p) => `${p.produto}${p.adicional ? ' (adicional)' : ''}`);
    assert.deepEqual(onde('Ovo'), ['Numero 08', 'TRIO 08', 'X-Bacon (adicional)'], 'o "Ovo" sem ligação, pelo nome');
    assert.deepEqual(onde('Anel de cebola'), ['Numero 08', 'TRIO 08', 'X-Bacon (adicional)'], 'o ligado, como sempre');
    assert.ok(!daBase.some((i) => i.nome === 'Batata palha'), 'a opção que não é ingrediente de ficha nenhuma não cria ingrediente');
    assert.ok(!daBase.some((i) => i.nome === 'Refri lata'), 'a bebida (outro produto) não vira ingrediente');
    assert.equal(valePeloNome({ tipo: 'nada' }), true);
    assert.equal(valePeloNome(null), true);
    for (const tipo of ['insumo', 'preparo', 'produto', 'observacao', 'retira']) assert.equal(valePeloNome({ tipo }), false, tipo);
  });

  it('no estudo das fichas também: o ovo é adicional do X-Bacon (e a família do Nº 08 tem o Número e o Trio)', () => {
    const e = estudarFichas(BASE);
    const xb = e.familiaDoProduto.get('x bacon')!;
    assert.deepEqual([...xb.adicionais.keys()].sort(), ['anel cebola', 'cebola crispy', 'ovo']);
    assert.deepEqual(e.familias.map((f) => f.produtos.map((p) => p.nome)), [['Numero 08', 'TRIO 08'], ['Numero 16'], ['X-Bacon']], 'a porção sem cozinha fica fora');
    // a ficha que tem o ovo NA FICHA não o ganha como adicional dela
    assert.ok(!e.familiaDoProduto.get('numero 08')!.adicionais.has('ovo'));
  });
});

describe('a sugestão pelo ingrediente (a regra do console)', () => {
  const onde = Object.fromEntries(
    ingredientesDaBase(BASE).map((i) => [i.nome, { fichas: i.produtos.filter((p) => !p.adicional).map((p) => p.produto), adicional: i.produtos.filter((p) => p.adicional).map((p) => p.produto) }]),
  );
  const familias = estudarFichas(BASE).familias.map((f) => f.produtos.map((p) => p.nome));

  it('o ingrediente de uma família só: o Número e o Trio contam como um; o produto sem cozinha não conta', () => {
    const anel = ingredienteUnico('anel de cebola', onde, familias)!;
    assert.deepEqual([anel.ingrediente, anel.familia, anel.adicionalEm], ['Anel de cebola', ['Numero 08', 'TRIO 08'], ['X-Bacon']], 'pela chave do nome');
    assert.deepEqual(ingredienteUnico('Cheddar cremoso', onde, familias)!.adicionalEm, []);
    assert.equal(ingredienteUnico('Carne 120gr', onde, familias), null, 'a carne de três lanches não é única');
    // o bacon: na ficha do X-Bacon e na da Porção (sem cozinha, sem família) — para a bancada, só o X-Bacon
    assert.deepEqual(ingredienteUnico('Bacon', onde, familias)!.familia, ['X-Bacon']);
    assert.equal(ingredienteUnico('Molho que não existe', onde, familias), null);
  });

  it('nada único: nenhuma; um único exclusivo: o lanche, sem aviso', () => {
    assert.deepEqual(sugestaoPeloIngrediente(['Pão brioche', 'Carne 120gr'], onde, familias), { tipo: 'nenhuma' });
    const s = sugestaoPeloIngrediente(['Carne 120gr', 'Cheddar cremoso'], onde, familias);
    assert.equal(s.tipo, 'lanche');
    if (s.tipo !== 'lanche') return;
    assert.deepEqual([s.familia, s.adicional, s.deixados], [['Numero 16'], false, []]);
  });

  it('o detalhe do dono: o único que também é adicional SUGERE, com o aviso (é a exceção)', () => {
    const s = sugestaoPeloIngrediente(['Anel de cebola'], onde, familias);
    assert.equal(s.tipo, 'lanche');
    if (s.tipo !== 'lanche') return;
    assert.deepEqual([s.familia, s.adicional], [['Numero 08', 'TRIO 08'], true]);
    // dois únicos do MESMO lanche, os dois também adicionais (o anel e o ovo, do X-Bacon): continua com o aviso
    const osDois = sugestaoPeloIngrediente(['Anel de cebola', 'Ovo'], onde, familias);
    assert.ok(osDois.tipo === 'lanche' && osDois.adicional && osDois.pelos.length === 2);
    // com um único do mesmo lanche que NÃO é adicional em lugar nenhum (o cheddar cremoso), o aviso sai: esse já basta
    const comExclusivo = sugestaoPeloIngrediente(['Cebola crispy', 'Cheddar cremoso'], onde, familias);
    assert.ok(comExclusivo.tipo === 'lanche' && !comExclusivo.adicional && comExclusivo.familia[0] === 'Numero 16');
  });

  it('dois únicos de lanches diferentes: vale o que não é adicional; os dois exclusivos, a tela mostra e não escolhe', () => {
    // o caso medido (o Nº 16 com ovo pedido): o cheddar cremoso é exclusivo; o ovo, adicional do X-Bacon
    const s = sugestaoPeloIngrediente(['Cheddar cremoso', 'Ovo'], onde, familias);
    assert.equal(s.tipo, 'lanche');
    if (s.tipo !== 'lanche') return;
    assert.deepEqual([s.familia, s.pelos.map((u) => u.ingrediente), s.deixados.map((u) => u.ingrediente)], [['Numero 16'], ['Cheddar cremoso'], ['Ovo']]);
    const dois = sugestaoPeloIngrediente(['Cheddar cremoso', 'Bacon'], onde, familias);
    assert.equal(dois.tipo, 'varios');
    if (dois.tipo === 'varios') assert.deepEqual(dois.opcoes.map((u) => u.familia[0]), ['Numero 16', 'X-Bacon']);
    // três lanches, dois com um único exclusivo (o bacon e o cheddar cremoso): também não escolhe
    const tres = sugestaoPeloIngrediente(['Anel de cebola', 'Bacon', 'Cheddar cremoso'], onde, familias);
    assert.equal(tres.tipo, 'varios');
  });

  it('o mesmo ingrediente confirmado duas vezes conta uma; o nome da família diz o Trio', () => {
    const s = sugestaoPeloIngrediente(['Anel de cebola', 'anel de cebola'], onde, familias);
    assert.ok(s.tipo === 'lanche' && s.pelos.length === 1);
    assert.equal(nomeDaFamilia(['Numero 08', 'TRIO 08']), 'Numero 08 (e no TRIO 08, que tem a mesma ficha)');
    assert.equal(nomeDaFamilia(['Numero 08', 'TRIO 08', 'Combo 08']), 'Numero 08 (e no TRIO 08, no Combo 08, que têm a mesma ficha)');
    assert.equal(nomeDaFamilia(['Numero 16']), 'Numero 16');
  });
});
