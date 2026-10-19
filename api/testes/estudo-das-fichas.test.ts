// O estudo das fichas (A21, ideia do dono em 15/10/2026): o que cada ingrediente diz sobre qual lanche é.
//
//   - a FAMÍLIA: a mesma ficha vista de cima é um lanche só para a bancada (o lanche e o combo dele); a quantidade de
//     contar separa (1 ou 2 carnes); o que "não se vê de cima" não separa; o que não passa pela cozinha fica de fora;
//   - o PESO: quanto mais raro, mais diz; as faixas raro, intermediário e comum;
//   - o PALPITE: o raro visto decide mesmo quando os comuns batem mais com outra ficha (a conta de antes errava aí);
//     o que o cliente mandou tirar não derruba; o adicional fora da ficha não muda o lanche; a quantidade desempata;
//     o grupo "pode ser A ou B" divide o peso; a leitura sem nome nas fichas tira de todas igual;
//   - as opções de "Qual lanche era?" são de famílias diferentes, e o acerto conta a família.
//
// O cardápio daqui é INVENTADO: nada de uma loja de verdade.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { estudarFichas, ESTRANHO, faixaDoIngrediente, mesmaFamilia, pesoDoIngrediente } from '../src/estudo-das-fichas.js';
import type { Base, Produto } from '../src/fichas.js';
import { chaveDoIngrediente } from '../src/ingredientes.js';
import { acertouOPalpite, palpitesDoLanche, PLAUSIVEL, umPorFamilia, type EtapaLida } from '../src/treino.js';

type Linha = [nome: string, quantidade: number | null, unidade: string | null];

let contador = 0;
function produto(nome: string, linhas: Linha[], extra: Partial<Produto> = {}): Produto {
  contador += 1;
  return {
    id: `00000000-0000-4000-8000-${String(contador).padStart(12, '0')}`,
    nome,
    codigo: null,
    categoria: 'Lanches',
    tipo: 'simples',
    cozinha: true,
    setor: 'Montagem',
    preparoMin: 10,
    ficha: {
      id: `ficha-${contador}`,
      nome,
      ingredientes: linhas.map(([n, quantidade, unidade]) => ({ nome: n, quantidade, unidade, preparo: false, insumoId: null, fichaId: null })),
    },
    variacoes: [],
    combo: [],
    adicionais: [],
    ...extra,
  };
}

const PAO: Linha = ['Pão de hambúrguer', 1, 'unidade'];
const carne = (v = 1): Linha => ['Carne', v, 'unidade'];
const queijo = (v = 1): Linha => ['Queijo', v, 'fatia'];
const ALFACE: Linha = ['Alface', 0.02, 'kg'];
const CEBOLA: Linha = ['Cebola caramelizada', 0.02, 'kg'];
const CLASSICO: Linha[] = [PAO, carne(), ['Cheddar cremoso', 0.03, 'kg'], CEBOLA];
const ONION: Linha[] = [PAO, carne(), ['Anel de cebola', 3, 'unidade'], ['Ovo', 1, 'unidade']];

/** 11 produtos, 8 famílias. Raros: cheddar cremoso, anel, ovo, tomate e batata (1 família); cebola caramelizada e bacon
 *  (2). Intermediário: alface (3). Comuns: pão e carne (7), queijo (5). */
function cardapio(): Base {
  contador = 0;
  return {
    formato: 1,
    produtos: [
      produto('Smash 1', [PAO, carne(), queijo(), ALFACE]),
      produto('Smash 2', [PAO, carne(2), queijo(2), CEBOLA]),
      produto('Clássico 7', CLASSICO),
      produto('Combo 7', CLASSICO),
      produto('Onion 3', ONION),
      produto('Combo 3', ONION),
      produto('Salada 4', [PAO, carne(), queijo(), ALFACE, ['Tomate', 2, 'fatia']]),
      produto('Bacon 5', [PAO, carne(), queijo(), ALFACE, ['Bacon', 2, 'fatia']]),
      produto('Bacon 6', [PAO, carne(2), queijo(2), ['Bacon', 2, 'fatia']]),
      produto('Batata', [['Batata', 0.15, 'kg']]),
      produto('Refrigerante', [['Lata', 1, 'unidade']], { cozinha: false }),
    ],
  };
}

const etapa = (candidatos: string[], vezes = 1, leu: string | null = candidatos[0] ?? null): EtapaLida => ({
  hora: '2026-10-15T19:00:00-03:00',
  lado: 'base',
  inicio: false,
  leu,
  candidatos,
  vezes,
  quadro: null,
});
const leitura = (...nomes: string[]): EtapaLida[] => nomes.map((n) => etapa([n]));
/** O primeiro palpite e a família dele. */
const melhor = (etapas: EtapaLida[], base = cardapio()) => {
  const p = palpitesDoLanche(etapas, base)[0]!;
  return { ...p, todos: [p.produto, ...p.familia] };
};

describe('o estudo das fichas', () => {
  it('a família: a mesma ficha vista de cima é um lanche só; a quantidade separa; o que não vai à cozinha fica de fora', () => {
    const e = estudarFichas(cardapio());
    assert.equal(e.familias.length, 8);
    assert.ok(mesmaFamilia(e, 'Clássico 7', 'combo 7'), 'o lanche e o combo dele');
    assert.ok(!mesmaFamilia(e, 'Bacon 5', 'Bacon 6'), '1 ou 2 carnes: lanches diferentes');
    assert.ok(!mesmaFamilia(e, 'Refrigerante', 'Batata'));
    assert.ok(mesmaFamilia(e, 'Refrigerante', 'refrigerante'), 'sem ficha: pelo nome');
    assert.ok(!mesmaFamilia(e, 'Refrigerante', 'Produto que não existe'), 'dois sem família não são a mesma');
    assert.equal(e.familiaDoProduto.has('refrigerante'), false, 'o que não passa pela cozinha não tem família');

    // a mesma carne em duas linhas da ficha é a ficha de 2 carnes
    const duasLinhas = cardapio();
    duasLinhas.produtos.find((p) => p.nome === 'Bacon 5')!.ficha!.ingredientes = [PAO, carne(), carne(), queijo(2), ['Bacon', 2, 'fatia']].map(
      ([nome, quantidade, unidade]) => ({ nome, quantidade, unidade, preparo: false, insumoId: null, fichaId: null }),
    );
    assert.ok(mesmaFamilia(estudarFichas(duasLinhas), 'Bacon 5', 'Bacon 6'), 'as vezes das linhas somam');

    // o sal que só uma ficha tem: separa — até ser marcado "não se vê de cima"
    const comSal = cardapio();
    comSal.produtos.find((p) => p.nome === 'Combo 7')!.ficha!.ingredientes.push({ nome: 'Sal', quantidade: 0.001, unidade: 'kg', preparo: false, insumoId: null, fichaId: null });
    assert.ok(!mesmaFamilia(estudarFichas(comSal), 'Clássico 7', 'Combo 7'));
    assert.ok(mesmaFamilia(estudarFichas(comSal, new Set(['sal'])), 'Clássico 7', 'Combo 7'));
  });

  it('os mesmos ingredientes em quantidades diferentes são lanches diferentes', () => {
    contador = 0;
    const base: Base = {
      formato: 1,
      produtos: [produto('Bacon 5', [PAO, carne(), queijo(), ['Bacon', 2, 'fatia']]), produto('Bacon 6', [PAO, carne(2), queijo(2), ['Bacon', 2, 'fatia']])],
    };
    const e = estudarFichas(base);
    assert.equal(e.familias.length, 2);
    assert.ok(!mesmaFamilia(e, 'Bacon 5', 'Bacon 6'));
  });

  it('o que a ficha tem e não foi visto pesa: ganha a ficha que a leitura cobre inteira', () => {
    contador = 0;
    const base: Base = {
      formato: 1,
      produtos: [produto('Bacon 5', [PAO, carne(), queijo(), ['Bacon', 2, 'fatia']]), produto('Smash 1', [PAO, carne(), queijo(), ALFACE]), produto('Xis 10', [PAO, carne(), queijo()])],
    };
    // pão, carne e queijo estão nas três; só o Xis 10 não tem nada que a leitura não viu
    assert.equal(palpitesDoLanche(leitura('Pão de hambúrguer', 'Carne', 'Queijo'), base)[0]!.produto, 'Xis 10');
  });

  it('o peso: quanto mais raro, mais diz; as faixas raro, intermediário e comum', () => {
    const e = estudarFichas(cardapio());
    const peso = (n: string) => pesoDoIngrediente(e, chaveDoIngrediente(n));
    assert.ok(peso('Cheddar cremoso') > peso('Cebola caramelizada'));
    assert.ok(peso('Cebola caramelizada') > peso('Alface'));
    assert.ok(peso('Alface') > peso('Queijo'));
    assert.ok(peso('Queijo') > peso('Pão de hambúrguer'));
    assert.equal(peso('Picles'), peso('Cheddar cremoso'), 'o que nenhuma ficha usa pesa como o mais raro');
    const faixa = (n: string) => faixaDoIngrediente(e, chaveDoIngrediente(n));
    assert.deepEqual(
      ['Cheddar cremoso', 'Bacon', 'Alface', 'Queijo', 'Pão de hambúrguer'].map(faixa),
      ['raro', 'raro', 'intermediario', 'comum', 'comum'],
    );
  });

  it('o raro visto decide, mesmo com os comuns batendo mais com outra ficha', () => {
    // pão, carne, queijo e alface batem inteiros com o Smash 1 — a conta de antes dizia Smash 1 (4 de 4). Mas o cheddar
    // cremoso só existe no Clássico 7 (e no combo dele).
    const p = melhor(leitura('Pão de hambúrguer', 'Carne', 'Queijo', 'Alface', 'Cheddar cremoso'));
    assert.ok(p.todos.includes('Clássico 7'), `o palpite foi ${p.produto}`);
    assert.deepEqual(p.raros, [{ nome: 'Cheddar cremoso', certo: true, de: null, tambemEm: [] }], 'o porquê: o raro visto');
    assert.deepEqual([p.batem, p.total, p.fora], [3, 4, 2], 'os números da tela seguem os mesmos');
  });

  it('o que o cliente mandou tirar não derruba; o adicional fora da ficha não muda o lanche', () => {
    assert.ok(melhor(leitura('Pão de hambúrguer', 'Carne', 'Cheddar cremoso')).todos.includes('Clássico 7'), 'sem a cebola');
    // o "Clássico 7 + ovo": o ovo é raro e é do Onion 3, mas o cheddar e a cebola dizem mais
    const comOvo = leitura('Pão de hambúrguer', 'Carne', 'Cheddar cremoso', 'Cebola caramelizada', 'Ovo');
    const p = melhor(comOvo);
    assert.ok(p.todos.includes('Clássico 7'), `o palpite foi ${p.produto}`);
    assert.equal(p.fora, 1, 'o ovo vem fora da ficha');
    // com o ovo cadastrado como adicional do Clássico 7, ele não pesa nada
    const comAdicional = cardapio();
    for (const x of comAdicional.produtos.filter((y) => y.nome === 'Clássico 7')) {
      x.adicionais = [{ nome: 'Extras', tipo: 'adicionar', opcoes: [{ id: null, nome: 'Ovo', codigo: null, efeito: { tipo: 'insumo', nome: 'Ovo', quantidade: 1, unidade: 'unidade', insumoId: null } }] }];
    }
    const semOvo = palpitesDoLanche(comOvo.slice(0, 4), comAdicional).find((x) => x.produto === 'Clássico 7')!;
    const comOvoAdicional = palpitesDoLanche(comOvo, comAdicional).find((x) => x.produto === 'Clássico 7')!;
    assert.equal(comOvoAdicional.nota, semOvo.nota, 'o adicional do produto não pesa contra');
    assert.equal(comOvoAdicional.fora, 1, 'mas vem fora da ficha');
  });

  it('a quantidade de contar desempata: 2 carnes e 2 fatias de queijo é o Bacon 6', () => {
    const p = melhor([etapa(['Pão de hambúrguer']), etapa(['Carne'], 2), etapa(['Queijo'], 2), etapa(['Bacon'], 2)]);
    assert.equal(p.produto, 'Bacon 6');
    const um = melhor([etapa(['Pão de hambúrguer']), etapa(['Carne'], 1), etapa(['Queijo'], 1), etapa(['Bacon'], 2)]);
    assert.equal(um.produto, 'Bacon 5');
  });

  it('o que vai por peso não se conta: a cebola vista duas vezes vale o mesmo que uma', () => {
    const uma = palpitesDoLanche(leitura('Pão de hambúrguer', 'Carne', 'Cebola caramelizada'), cardapio()).find((x) => x.produto === 'Smash 2')!;
    const duas = palpitesDoLanche([...leitura('Pão de hambúrguer', 'Carne'), etapa(['Cebola caramelizada'], 2)], cardapio()).find((x) => x.produto === 'Smash 2')!;
    assert.equal(duas.nota, uma.nota);
  });

  it('o grupo "pode ser A ou B" divide o peso entre os nomes', () => {
    const e = estudarFichas(cardapio());
    const so = palpitesDoLanche(leitura('Pão de hambúrguer', 'Carne', 'Anel de cebola'), cardapio()).find((x) => x.produto === 'Onion 3')!;
    const grupo = palpitesDoLanche([...leitura('Pão de hambúrguer', 'Carne'), etapa(['Anel de cebola', 'Cebola caramelizada'], 1, 'cebola')], cardapio()).find(
      (x) => x.produto === 'Onion 3',
    )!;
    const anel = pesoDoIngrediente(e, 'anel de cebola');
    // sozinho, o anel visto 1 vez contra 3 da ficha também tira um quarto; no grupo a quantidade não se conta
    assert.ok(Math.abs(grupo.nota - (so.nota + anel / 4 - anel / 2)) < 1e-9, `${grupo.nota} × ${so.nota}`);
  });

  it('a leitura sem nome nas fichas tira de todas igual: a ordem não muda', () => {
    const base = leitura('Pão de hambúrguer', 'Carne', 'Cheddar cremoso');
    const antes = palpitesDoLanche(base, cardapio());
    const depois = palpitesDoLanche([...base, etapa([], 1, 'molho verde')], cardapio());
    assert.deepEqual(depois.map((p) => p.produto), antes.map((p) => p.produto));
    for (const [i, p] of depois.entries()) {
      assert.ok(Math.abs(p.nota - (antes[i]!.nota - ESTRANHO)) < 1e-9);
      assert.equal(p.fora, antes[i]!.fora + 1, 'e vem fora');
    }
  });

  it('as opções de "Qual lanche era?" são de famílias diferentes; o irmão vem junto', () => {
    const todos = palpitesDoLanche(leitura('Pão de hambúrguer', 'Carne', 'Cheddar cremoso'), cardapio());
    assert.deepEqual(todos.slice(0, 2).map((p) => p.produto).sort(), ['Clássico 7', 'Combo 7'], 'os dois primeiros são irmãos');
    const opcoes = umPorFamilia(todos);
    assert.equal(opcoes[0]!.produto, 'Clássico 7');
    assert.deepEqual(opcoes[0]!.familia, ['Combo 7']);
    assert.ok(!['Clássico 7', 'Combo 7'].includes(opcoes[1]!.produto), 'a segunda opção é outro lanche');
    assert.equal(new Set(opcoes.map((p) => p.produto)).size, opcoes.length);
    assert.equal(opcoes.length, 8, 'uma por família');
  });

  it('o acerto conta a família: o produto escolhido ou o irmão; outra família, não', () => {
    const e = estudarFichas(cardapio());
    assert.equal(acertouOPalpite(e, 'Combo 7', 'Clássico 7'), true);
    assert.equal(acertouOPalpite(e, 'clássico 7', 'Clássico 7'), true);
    assert.equal(acertouOPalpite(e, 'Bacon 5', 'Bacon 6'), false);
    assert.equal(acertouOPalpite(e, null, 'Clássico 7'), false, 'não era um lanche');
    assert.equal(acertouOPalpite(e, 'Clássico 7', null), false, 'sem palpite');
  });

  it('sem fichas, sem palpite', () => {
    assert.deepEqual(palpitesDoLanche(leitura('Carne'), null), []);
    assert.equal(estudarFichas(null).familias.length, 0);
  });

  // ───── o que a conferência nova mostra (protótipo aprovado em 15/10/2026) ─────

  it('o porquê: o raro que veio num grupo diz o que a leitura leu; o raro de outra família diz qual', () => {
    const p = melhor([...leitura('Pão de hambúrguer', 'Carne'), etapa(['Cheddar cremoso', 'Alface'], 1, 'creme claro'), etapa(['Cebola caramelizada'])]);
    assert.ok(p.todos.includes('Clássico 7'), `o palpite foi ${p.produto}`);
    assert.deepEqual(p.raros, [
      { nome: 'Cheddar cremoso', certo: false, de: 'creme claro', tambemEm: [] },
      { nome: 'Cebola caramelizada', certo: true, de: null, tambemEm: ['Smash 2'] },
    ], 'o mais raro primeiro');
  });

  it('o palpite traz a ficha com a raridade de cada ingrediente, o que o cliente pode pedir a mais e o que pode tirar', () => {
    const base = cardapio();
    base.produtos.find((p) => p.nome === 'Clássico 7')!.adicionais = [
      { nome: 'Extras', tipo: 'adicionar', opcoes: [{ id: null, nome: 'Ovo', codigo: null, efeito: { tipo: 'insumo', nome: 'Ovo', quantidade: 1, unidade: 'unidade', insumoId: null } }] },
      { nome: 'Tirar', tipo: 'remover', opcoes: [{ id: null, nome: 'Sem cebola', codigo: null, efeito: { tipo: 'retira', nome: 'Cebola caramelizada', insumoId: null, fichaId: null } }] },
    ];
    // o irmão (o combo) leva o que o lanche oferece: é a mesma ficha para a bancada
    const p = palpitesDoLanche(leitura('Pão de hambúrguer', 'Carne', 'Cheddar cremoso'), base).find((x) => x.produto === 'Combo 7')!;
    assert.deepEqual(p.ingredientes, [
      { nome: 'Pão de hambúrguer', usos: 7 },
      { nome: 'Carne', usos: 7 },
      { nome: 'Cheddar cremoso', usos: 1 },
      { nome: 'Cebola caramelizada', usos: 2 },
    ]);
    assert.deepEqual([p.adicionais, p.tira], [['Ovo'], ['Cebola caramelizada']]);
    const smash = palpitesDoLanche(leitura('Carne'), base).find((x) => x.produto === 'Smash 1')!;
    assert.deepEqual([smash.adicionais, smash.tira], [[], []], 'quem não oferece nada');
  });

  it('as plausíveis das perguntas: as famílias perto do melhor, no mínimo 2 e no máximo 4, na ordem; o irmão acompanha', () => {
    for (const lido of [
      leitura('Pão de hambúrguer', 'Carne', 'Cheddar cremoso'),
      leitura('Pão de hambúrguer', 'Carne', 'Cheddar cremoso', 'Cebola caramelizada'),
      leitura('Pão de hambúrguer', 'Carne', 'Queijo'),
    ]) {
      const todos = palpitesDoLanche(lido, cardapio());
      const familias = umPorFamilia(todos);
      const dentro = familias.filter((p) => p.nota >= familias[0]!.nota - PLAUSIVEL.distancia).length;
      const n = Math.max(PLAUSIVEL.minimo, Math.min(PLAUSIVEL.maximo, dentro));
      assert.deepEqual(familias.map((p) => p.plausivel), familias.map((_, i) => i < n), lido.map((e) => e.leu).join('+'));
      for (const p of todos) {
        const irmao = familias.find((f) => f.produto === p.produto || f.familia.includes(p.produto))!;
        assert.equal(p.plausivel, irmao.plausivel, `${p.produto} acompanha a família`);
      }
    }
  });
});
