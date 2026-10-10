// A proposta do estudo: o sistema propõe as seis partes e liga cada condição
// a um sinal que a loja já dá; a pessoa confirma ou corrige.
//
// A19, onda 1, a última fatia (protótipo aprovado em 09/10/2026). O que tem
// de ficar provado aqui:
//
//   - toda proposta é uma ficha que a rota de gravar ACEITA, com o
//     vocabulário do contrato — e nunca sai confirmada nem gravada;
//   - o assunto sai do texto, e o sinal sai do lugar: de cima, movimento; em
//     posição de montagem, nada de "lugar livre" (a loja já espera as mãos);
//     gatilho da foto padrão só quando TODOS os canais têm foto;
//   - o texto de cada parte diz o que as condições fazem — nem mais;
//   - "a câmera não vê" só aparece para o que nenhuma câmera de loja vê, e
//     some quando a ação é reescrita;
//   - nenhuma chave interna (o assunto, o nome de um sinal) chega à tela;
//   - só quem configura pede a proposta, e o canal de outra conta é
//     indistinguível do que não existe.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { MAX_TEXTO_DA_PARTE, PARTES, estudoNaoCabeNoTipo, lerEstudo, quadrosCitados } from '../src/estudo.js';
import {
  MAX_CRITERIO_NA_PROPOSTA,
  MAX_NOME_NA_PROPOSTA,
  assuntoDoCriterio,
  caberNaParte,
  cenaDizDeCima,
  lerPedidoDeProposta,
  notasDoEstudo,
  proporEstudo,
  semAcento,
  type AreaDoCanal,
  type CanalDaProposta,
  type EntradaDaProposta,
} from '../src/proposta-do-estudo.js';

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-proposta-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-proposta';
const SENHA = 'uma senha longa o bastante';

const CONTRATO = JSON.parse(readFileSync(new URL('../../contratos/estudo-do-criterio.json', import.meta.url), 'utf8')) as {
  contexto: string[]; gatilho: string[];
};

// ───────────────────────── os lugares de exemplo ─────────────────────────

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// A imagem completa nunca tem papel (regra do banco): é a área sem número.
const inteira = (alvo: boolean, n = 1): AreaDoCanal => ({ id: ID(n), nome: 'Imagem completa', papel: 'livre', numero: null, alvo });
const quadro = (n: number, nome: string, papel: string, alvo: boolean, numero = n - 1): AreaDoCanal =>
  ({ id: ID(n), nome, papel, numero, alvo });

/** A cena que o console dá de exemplo a quem escreve (`cartao-da-cena.tsx`). */
const CENA_DE_CIMA = 'Bancada de montagem de lanches, vista de cima por uma câmera no teto. No alto ficam as cubas.';
/** A cena da chapa no protótipo aprovado: do alto, mas de lado. */
const CENA_DE_LADO = 'Chapa de hambúrguer vista de lado, da altura do teto. O chapeiro fica de frente para a chapa.';

function canal(parte: Partial<CanalDaProposta> & { areas: AreaDoCanal[] }): CanalDaProposta {
  return { pontoId: ID(900), nome: 'Canal', cena: '', temFotoPadrao: false, ...parte };
}

/** A conta nova: um canal só com a imagem completa, sem cena e sem foto. */
const NOVO = () => [canal({ areas: [inteira(true)] })];
/** A câmera olha de cima (está dito na cena), e o critério vale num quadro de cuba. */
const DE_CIMA = () => [canal({ cena: CENA_DE_CIMA, areas: [inteira(false), quadro(2, 'Cubas', 'cuba', true)] })];
/** O critério vale só em posição de montagem. */
const BANCADA = () => [canal({ cena: CENA_DE_CIMA, areas: [inteira(false), quadro(2, 'Montagem', 'montagem', true)] })];
/** A chapa vista de lado, com o posto do chapeiro ao lado: o critério vale na chapa. */
const COM_POSTO = () => [
  canal({
    cena: CENA_DE_LADO,
    areas: [inteira(false), quadro(2, 'Chapa', 'equipamento', true), quadro(3, 'Posto do chapeiro', 'posto', false)],
  }),
];

const entrada = (parte: Partial<EntradaDaProposta> = {}): EntradaDaProposta => ({
  nome: 'Critério',
  criterio: 'O balcão está como deve.',
  tipo: 'estado',
  familia: 'estado',
  canais: NOVO(),
  ...parte,
});

const AQUI = (sinal: string) => ({ sinal, onde: 'aqui' });
const A_CADA = (minutos: number) => ({ sinal: 'a_cada', minutos });

/** Tudo o que a proposta escreve para alguém ler. */
function textosDe(p: ReturnType<typeof proporEstudo>): string[] {
  return [...Object.values(p.partes), ...p.porque, ...p.avisos.flatMap((a) => [a.rotulo, a.motivo]), ...p.sugestoes];
}

// ───────────────────────── sem banco ─────────────────────────

describe('a proposta do estudo: as regras', () => {
  // Os textos de cada assunto, e o que se espera deles nos três jeitos de olhar.
  const ASSUNTOS: ReadonlyArray<{
    assunto: string; parte: Partial<EntradaDaProposta>;
    pessoa: [unknown[], unknown[]]; movimento: [unknown[], unknown[]]; bancada: [unknown[], unknown[]];
  }> = [
    {
      assunto: 'pessoa', parte: { criterio: 'Todos na cozinha usam touca.' },
      pessoa: [[AQUI('pessoa')], [AQUI('entrou'), A_CADA(5)]],
      movimento: [[AQUI('movimento')], [A_CADA(5)]],
      bancada: [[AQUI('movimento')], [A_CADA(5)]],
    },
    {
      assunto: 'limpeza', parte: { criterio: 'A bancada fica sem restos de alimento entre um lote e outro.' },
      pessoa: [[AQUI('sem_pessoa')], [AQUI('saiu'), A_CADA(10)]],
      movimento: [[AQUI('parado')], [AQUI('parou'), A_CADA(10)]],
      bancada: [[], [A_CADA(10)]],
    },
    {
      assunto: 'equipamento', parte: { criterio: 'A geladeira de bebidas fica fechada.' },
      pessoa: [[AQUI('sem_pessoa')], [AQUI('saiu'), A_CADA(10)]],
      movimento: [[AQUI('parado')], [AQUI('parou'), A_CADA(10)]],
      bancada: [[], [A_CADA(10)]],
    },
    {
      assunto: 'abastecimento', parte: { criterio: 'As cubas estão abastecidas.' },
      pessoa: [[AQUI('sem_pessoa')], [A_CADA(15)]],
      movimento: [[AQUI('parado')], [A_CADA(15)]],
      bancada: [[], [A_CADA(15)]],
    },
    {
      assunto: 'geral', parte: { criterio: 'O balcão está como deve.' },
      pessoa: [[AQUI('sem_pessoa')], [AQUI('parou'), A_CADA(10)]],
      movimento: [[AQUI('parado')], [AQUI('parou'), A_CADA(10)]],
      bancada: [[], [A_CADA(10)]],
    },
    {
      assunto: 'acontece', parte: { tipo: 'acao', familia: 'acontecimento', criterio: 'Toda carne posta na chapa é virada uma vez.' },
      pessoa: [[AQUI('pessoa')], [AQUI('mexeu')]],
      movimento: [[], [AQUI('mexeu')]],
      bancada: [[], [AQUI('mexeu')]],
    },
    {
      // Comparação em canal SEM foto padrão: o caminho geral, sem o gatilho da foto.
      assunto: 'foto', parte: { tipo: 'comparacao', criterio: 'A vitrine está como na foto.' },
      pessoa: [[AQUI('sem_pessoa')], [AQUI('parou'), A_CADA(10)]],
      movimento: [[AQUI('parado')], [AQUI('parou'), A_CADA(10)]],
      bancada: [[], [A_CADA(10)]],
    },
  ];

  it('o assunto sai do texto, e o sinal sai do lugar: a tabela inteira', () => {
    for (const a of ASSUNTOS) {
      const casos: [string, CanalDaProposta[], [unknown[], unknown[]]][] = [
        ['detector de pessoas', NOVO(), a.pessoa],
        ['de cima', DE_CIMA(), a.movimento],
        ['posição de montagem', BANCADA(), a.bancada],
      ];
      for (const [qual, canais, [contexto, gatilho]] of casos) {
        const p = proporEstudo(entrada({ ...a.parte, canais }));
        assert.equal(p.assunto, a.assunto, `${a.assunto} · ${qual}`);
        assert.deepEqual(p.contexto, contexto, `contexto de ${a.assunto} · ${qual}`);
        assert.deepEqual(p.gatilho, gatilho, `gatilho de ${a.assunto} · ${qual}`);
      }
    }
  });

  it('presença e contagem: só os textos — nem contexto, nem gatilho, nem regra de lugar', () => {
    for (const tipo of ['presenca', 'contagem']) {
      for (const canais of [NOVO(), DE_CIMA(), BANCADA()]) {
        const p = proporEstudo(entrada({ tipo, criterio: 'Há alguém no caixa, de touca, com a loja aberta.', canais }));
        assert.equal(p.assunto, 'detector');
        assert.deepEqual(p.contexto, []);
        assert.deepEqual(p.gatilho, []);
        assert.equal(p.partes.gatilho, 'Toda olhada.');
        assert.equal(p.partes.janela, 'A própria olhada.');
        assert.match(p.partes.contexto, /quem confere é o detector, no computador da loja/);
        assert.match(p.partes.fora, /^Não há fora de contexto/);
        assert.equal(p.porque.length, 1);
        assert.match(p.porque[0]!, /propus só os textos/);
        // "touca" no texto e montagem no lugar: a sugestão de lugar não é para o detector.
        assert.deepEqual(p.sugestoes, []);
      }
    }
    assert.match(proporEstudo(entrada({ tipo: 'presenca' })).partes.desfecho, /^O detector achou o que o critério pede: dentro\./);
    assert.match(proporEstudo(entrada({ tipo: 'contagem' })).partes.desfecho, /^A contagem ficou dentro do pedido: dentro\./);
  });

  it('toda proposta é uma ficha que a rota de gravar aceita, no vocabulário do contrato', () => {
    const lugares = [NOVO(), DE_CIMA(), BANCADA(), COM_POSTO(), [...NOVO(), ...DE_CIMA()]];
    const tipos: Partial<EntradaDaProposta>[] = [
      ...ASSUNTOS.map((a) => a.parte),
      { tipo: 'acao', familia: 'processo' }, { tipo: 'acao', familia: 'medida' },
      { tipo: 'presenca' }, { tipo: 'contagem' },
      { tipo: 'comparacao' }, { tipo: 'estado', criterio: `Limpa ${'e organizada '.repeat(80)}sempre.` },
    ];
    let conferidas = 0;
    for (const parte of tipos) {
      for (const canais of lugares) {
        for (const comFoto of [false, true]) {
          const e = entrada({ ...parte, canais: canais.map((c) => ({ ...c, temFotoPadrao: comFoto })) });
          const p = proporEstudo(e);
          const ficha = { partes: p.partes, contexto: p.contexto, gatilho: p.gatilho, confirmado: false };
          const lida = lerEstudo(ficha);
          assert.ok('ok' in lida, `${e.tipo}/${e.familia}: ${'problema' in lida ? lida.problema : ''}`);
          // O que foi proposto é o que fica guardado: nada é aparado nem trocado na leitura.
          assert.deepEqual(lida.ok, ficha);
          assert.equal(estudoNaoCabeNoTipo(e.tipo, lida.ok), null);
          for (const nome of PARTES) {
            assert.ok(p.partes[nome].length > 0, `parte ${nome} vazia`);
            assert.ok(p.partes[nome].length <= MAX_TEXTO_DA_PARTE, `parte ${nome} longa demais`);
          }
          for (const c of p.contexto) assert.ok(CONTRATO.contexto.includes(c.sinal), c.sinal);
          for (const g of p.gatilho) assert.ok(CONTRATO.gatilho.includes(g.sinal), g.sinal);
          // Quem usa o estudo sai sempre com ao menos um gatilho: a proposta nunca é "em toda olhada".
          assert.equal(p.gatilho.length > 0, !['presenca', 'contagem'].includes(e.tipo), `${e.tipo}/${e.familia}`);
          // O quadro citado é de um canal do critério — e só se o critério está num canal só.
          const ids = canais.flatMap((c) => c.areas.filter((a) => a.numero !== null).map((a) => a.id));
          for (const z of quadrosCitados(lida.ok)) {
            assert.equal(canais.length, 1);
            assert.ok(ids.includes(z));
          }
          // A mesma entrada, a mesma proposta.
          assert.deepEqual(proporEstudo(e), p);
          conferidas += 1;
        }
      }
    }
    assert.equal(conferidas, tipos.length * lugares.length * 2);
  });

  it('nenhuma chave interna chega a quem lê: nem o nome de um sinal, nem o assunto', () => {
    const internas = [...new Set([...CONTRATO.contexto, ...CONTRATO.gatilho])].filter((s) => s.includes('_'));
    assert.ok(internas.length >= 6, 'o contrato mudou de forma');
    for (const a of ASSUNTOS) {
      for (const canais of [NOVO(), DE_CIMA(), BANCADA(), COM_POSTO()]) {
        for (const comFoto of [false, true]) {
          const p = proporEstudo(entrada({ ...a.parte, canais: canais.map((c) => ({ ...c, temFotoPadrao: comFoto })) }));
          for (const texto of textosDe(p)) {
            for (const chave of internas) assert.ok(!texto.includes(chave), `"${chave}" em: ${texto}`);
            assert.doesNotMatch(texto, /undefined|null|\[object/);
          }
        }
      }
    }
  });

  // ─────────────────────── o assunto ───────────────────────

  it('a palavra que decidiu o assunto é citada como a pessoa escreveu', () => {
    const casos: [Partial<EntradaDaProposta>, string, string | null][] = [
      [{ criterio: 'Todos na cozinha usam touca.' }, 'pessoa', 'touca'],
      // "Uniforme limpo" é sobre o uniforme: o que alguém usa vem primeiro.
      [{ criterio: 'Uniforme limpo e completo.' }, 'pessoa', 'Uniforme'],
      [{ criterio: 'Quem monta lava as mãos antes.' }, 'pessoa', 'mãos'],
      [{ criterio: 'Ninguém usa o celular no posto.' }, 'pessoa', 'usa o celular'],
      [{ criterio: 'Organização das cubas.' }, 'limpeza', 'Organização'],
      [{ criterio: 'O piso está seco, sem poças.' }, 'limpeza', 'poças'],
      // A palavra citada é a primeira do texto que diz o assunto.
      [{ criterio: 'A porta da câmara fria fica fechada.' }, 'equipamento', 'porta'],
      [{ criterio: 'A câmara fria fica fechada.' }, 'equipamento', 'fechada'],
      [{ criterio: 'A estufa fica LIGADA durante o turno.' }, 'equipamento', 'LIGADA'],
      [{ criterio: 'Não falta guardanapo no balcão.' }, 'abastecimento', 'falta'],
      // O nome também conta — depois da explicação: havendo palavra nos dois, cita-se a da explicação.
      [{ nome: 'Uso de luvas', criterio: 'Quem monta está protegido.' }, 'pessoa', 'luvas'],
      [{ nome: 'Touca', criterio: 'Todos usam uniforme.' }, 'pessoa', 'uniforme'],
      [{ criterio: 'O balcão está como deve.' }, 'geral', null],
    ];
    for (const [parte, assunto, palavra] of casos) {
      const e = entrada(parte);
      assert.deepEqual(assuntoDoCriterio(e), { assunto, palavra }, e.criterio);
      if (palavra) assert.ok(proporEstudo(e).porque[0]!.startsWith(`Li “${palavra}” no seu texto: `), e.criterio);
    }
  });

  it('palavra parecida não engana o vocabulário', () => {
    const naoSao: [string, string][] = [
      ['Os anéis de cebola saem crocantes.', 'pessoa'],
      ['Os utensílios ficam à mão.', 'pessoa'],
      ['O molho descansa em repouso por dez minutos.', 'abastecimento'],
      ['A portaria recebe o entregador.', 'equipamento'],
      ['O sujeito da frase é o cliente.', 'geral'],
    ];
    for (const [criterio, assunto] of naoSao) {
      assert.notEqual(assuntoDoCriterio(entrada({ criterio })).assunto, assunto === 'geral' ? 'pessoa' : assunto, criterio);
    }
    assert.equal(assuntoDoCriterio(entrada({ criterio: 'Os anéis de cebola saem crocantes.' })).assunto, 'geral');
    assert.equal(assuntoDoCriterio(entrada({ criterio: 'Os utensílios ficam à mão.' })).assunto, 'geral');
    assert.equal(assuntoDoCriterio(entrada({ criterio: 'O molho descansa em repouso por dez minutos.' })).assunto, 'geral');
    assert.equal(assuntoDoCriterio(entrada({ criterio: 'A portaria recebe o entregador.' })).assunto, 'geral');
  });

  it('o vocabulário, palavra por palavra: cada uma leva ao seu assunto', () => {
    const PALAVRAS: Record<string, string[]> = {
      pessoa: [
        'touca', 'toucas', 'uniforme', 'uniformizado', 'avental', 'aventais', 'luva', 'máscara', 'EPI', 'EPIs', 'crachá', 'jaleco',
        'boné', 'cabelo', 'barba', 'adorno', 'brinco', 'pulseira', 'mãos', 'lave a mão', 'uso de celular', 'usando o celular',
        'usar celular', 'falando ao celular', 'mexendo no celular',
      ],
      limpeza: [
        'limpo', 'sujeira', 'organizado', 'desorganizada', 'arrumada', 'bagunça', 'resto', 'respingo', 'migalhas', 'farelo', 'resíduo',
        'higienizada', 'higiene', 'gordura', 'mancha', 'poeira', 'lixo', 'derramado', 'lavada', 'varrido', 'molhado', 'poça', 'escorregadio',
      ],
      equipamento: [
        'aberta', 'fechado', 'tampada', 'destampado', 'trancada', 'destrancado', 'ligada', 'desligado', 'acesa', 'apagada', 'porta',
        'tampa', 'gaveta', 'cadeado',
      ],
      abastecimento: [
        'abastecida', 'reabastecer', 'reposto', 'reposição', 'repor', 'vazia', 'cheio', 'nível', 'níveis', 'faltando', 'estoque',
        'pela metade', 'acabando', 'acabou',
      ],
    };
    for (const [assunto, palavras] of Object.entries(PALAVRAS)) {
      for (const palavra of palavras) {
        const lido = assuntoDoCriterio(entrada({ criterio: `A regra da casa: ${palavra}.` }));
        assert.equal(lido.assunto, assunto, palavra);
        // A palavra citada é a do texto (ou um pedaço dela: "falando ao celular" cita "ao celular").
        assert.ok(lido.palavra !== null && palavra.includes(lido.palavra), `${palavra}: citou "${lido.palavra}"`);
      }
    }
  });

  it('a família e o tipo vêm antes do vocabulário', () => {
    const comTouca = 'Todos usam touca e a bancada está limpa.';
    assert.equal(assuntoDoCriterio(entrada({ criterio: comTouca, tipo: 'comparacao' })).assunto, 'foto');
    assert.equal(assuntoDoCriterio(entrada({ criterio: comTouca, tipo: 'presenca' })).assunto, 'detector');
    assert.equal(assuntoDoCriterio(entrada({ criterio: comTouca, tipo: 'contagem' })).assunto, 'detector');
    for (const familia of ['acontecimento', 'processo', 'medida']) {
      assert.deepEqual(assuntoDoCriterio(entrada({ criterio: comTouca, tipo: 'acao', familia })), { assunto: 'acontece', palavra: null });
    }
    // Um critério de ação cuja família é "estado" não existe (o banco recusa); o de estado segue o vocabulário.
    assert.equal(assuntoDoCriterio(entrada({ criterio: comTouca })).assunto, 'pessoa');
  });

  it('o texto sem acento tem o comprimento do original, letra por letra', () => {
    assert.equal(semAcento('Ação, Órgão e CAFÉ'), 'acao, orgao e cafe');
    // O acento solto no começo (não há letra para ele) e a letra que se desfaz em três: viram espaço, do mesmo tamanho.
    for (const texto of ['Organização 😀 das cubas', 'İstanbul', 'ﬁla de pão', 'á solto', '́solto', '한글 da loja', '']) {
      assert.equal(semAcento(texto.normalize('NFC')).length, texto.normalize('NFC').length, texto);
    }
    assert.equal(semAcento('́solto'), ' solto');
    assert.deepEqual(assuntoDoCriterio(entrada({ criterio: '한글: bancada limpa' })), { assunto: 'limpeza', palavra: 'limpa' });
    // Um emoji antes da palavra não desloca o achado.
    assert.deepEqual(assuntoDoCriterio(entrada({ criterio: '😀😀 Organização das cubas' })), { assunto: 'limpeza', palavra: 'Organização' });
    // Texto decomposto (a + acento solto) é lido como o composto.
    assert.deepEqual(
      assuntoDoCriterio(entrada({ criterio: 'Organização das cubas' })),
      { assunto: 'limpeza', palavra: 'Organização' },
    );
  });

  // ─────────────────────── o lugar ───────────────────────

  it('a cena diz de onde a câmera olha — e "do teto, de lado" não é de cima', () => {
    assert.equal(cenaDizDeCima(CENA_DE_CIMA), true);
    assert.equal(cenaDizDeCima('CAIXA VISTO DE CIMA'), true);
    assert.equal(cenaDizDeCima('Câmera zenital sobre o caixa.'), true);
    assert.equal(cenaDizDeCima('Balcão visto do teto.'), true);
    assert.equal(cenaDizDeCima('A câmera fica no teto.'), true);
    assert.equal(cenaDizDeCima('A câmera aponta para baixo, sobre o caixa.'), true);
    assert.equal(cenaDizDeCima(CENA_DE_LADO), false);
    // Cada jeito de dizer que NÃO é de cima, ao lado de um que diria que é.
    for (const deLado of ['de lado', 'de frente', 'lateral', 'de canto', 'inclinada', 'inclinado', 'na diagonal', 'em diagonal']) {
      assert.equal(cenaDizDeCima(`Câmera no teto, ${deLado}, pegando o salão.`), false, deLado);
    }
    assert.equal(cenaDizDeCima('Salão visto de frente.'), false);
    assert.equal(cenaDizDeCima('Em cima da bancada ficam as cubas.'), false);
    assert.equal(cenaDizDeCima(''), false);
  });

  it('de cima em UM dos canais já troca o detector de pessoas pelo movimento em todos', () => {
    const p = proporEstudo(entrada({ criterio: 'Bancada limpa.', canais: [...NOVO(), ...DE_CIMA()] }));
    assert.deepEqual(p.contexto, [AQUI('parado')]);
    assert.ok(p.porque.some((f) => f.startsWith('A cena de um dos canais diz que a câmera olha de cima.')));
    assert.ok(!p.porque.some((f) => f.includes('Usei o detector de pessoas')));

    const um = proporEstudo(entrada({ criterio: 'Bancada limpa.', canais: DE_CIMA() }));
    assert.ok(um.porque.some((f) => f.startsWith('A cena deste canal diz que a câmera olha de cima.')));
  });

  it('montagem misturada com outro lugar: movimento — o "nada" da bancada só vale se TODO lugar é montagem', () => {
    const misto = [
      canal({ cena: CENA_DE_LADO, areas: [inteira(true), quadro(2, 'Montagem', 'montagem', true)] }),
    ];
    const p = proporEstudo(entrada({ criterio: 'Bancada limpa.', canais: misto }));
    assert.deepEqual(p.contexto, [AQUI('parado')]);
    assert.deepEqual(p.gatilho, [AQUI('parou'), A_CADA(10)]);
    assert.ok(p.porque.some((f) => f.startsWith('Um dos lugares é posição de montagem')));
    // Sem lugar marcado não há "todo lugar é montagem".
    const semAlvo = [canal({ areas: [inteira(false), quadro(2, 'Montagem', 'montagem', false)] })];
    assert.deepEqual(proporEstudo(entrada({ criterio: 'Bancada limpa.', canais: semAlvo })).contexto, [AQUI('sem_pessoa')]);
  });

  it('a explicação diz o que foi suposto sobre a câmera — e pede a cena quando ela falta', () => {
    const novo = proporEstudo(entrada({ criterio: 'Bancada limpa.' }));
    assert.deepEqual(novo.porque.slice(1), [
      'Usei o detector de pessoas. Se a câmera olha de cima, troque por movimento: de cima ele vê mão e braço, não gente.',
      'A cena deste canal ainda não foi descrita: é nela que eu leio de onde a câmera olha.',
    ]);
    // Com a cena escrita (de lado), a segunda frase some.
    const deLado = proporEstudo(entrada({ criterio: 'Bancada limpa.', canais: [canal({ cena: CENA_DE_LADO, areas: [inteira(true)] })] }));
    assert.equal(deLado.porque.length, 2);
    assert.match(deLado.porque[1]!, /^Usei o detector de pessoas\./);
    // A cena só de espaços não é cena escrita.
    const emBranco = proporEstudo(entrada({ criterio: 'Bancada limpa.', canais: [canal({ cena: '   ', areas: [inteira(true)] })] }));
    assert.equal(emBranco.porque[2], 'A cena deste canal ainda não foi descrita: é nela que eu leio de onde a câmera olha.');
    // Dois canais, um sem cena: dito no plural.
    const dois = proporEstudo(entrada({
      criterio: 'Bancada limpa.',
      canais: [canal({ cena: CENA_DE_LADO, areas: [inteira(true)] }), canal({ pontoId: ID(901), areas: [inteira(true, 5)] })],
    }));
    assert.equal(dois.porque[2], 'A cena de um dos canais ainda não foi descrita: é nela que eu leio de onde a câmera olha.');

    const bancada = (parte: Partial<EntradaDaProposta>) => proporEstudo(entrada({ ...parte, canais: BANCADA() })).porque[1]!;
    assert.match(bancada({ criterio: 'Bancada limpa.' }), /a loja já espera as mãos saírem antes de conferir, e por isso não pus condição de lugar livre\.$/);
    assert.match(bancada({ criterio: 'Quem monta usa luvas.' }), /usei o movimento no lugar do detector de pessoas\.$/);
    assert.match(bancada({ tipo: 'acao', familia: 'processo' }), /o gatilho é o lugar ter mudado desde a olhada anterior\.$/);
  });

  it('o posto de trabalho do canal: é para ele que "há alguém" olha, num acontecimento', () => {
    const acontecimento = { tipo: 'acao', familia: 'acontecimento', criterio: 'Toda carne posta na chapa é virada uma vez.' };
    const p = proporEstudo(entrada({ ...acontecimento, canais: COM_POSTO() }));
    assert.deepEqual(p.contexto, [{ sinal: 'pessoa', onde: 'quadro', zonaId: ID(3) }]);
    assert.deepEqual(p.gatilho, [AQUI('mexeu')]);
    assert.equal(p.partes.contexto, 'Há alguém no Quadro 2 · Posto do chapeiro.');
    assert.ok(p.porque.includes('O canal tem um quadro de posto de trabalho (Quadro 2 · Posto do chapeiro): a condição “há alguém” olha para ele.'));

    const aqui = (canais: CanalDaProposta[]) => {
      const q = proporEstudo(entrada({ ...acontecimento, canais }));
      assert.deepEqual(q.contexto, [AQUI('pessoa')]);
      assert.equal(q.partes.contexto, 'Há alguém neste lugar.');
      assert.ok(!q.porque.some((f) => f.includes('posto de trabalho')));
    };
    // Dois postos: não se adivinha qual.
    aqui([canal({ cena: CENA_DE_LADO, areas: [inteira(false), quadro(2, 'Chapa', 'equipamento', true), quadro(3, 'Posto A', 'posto', false), quadro(4, 'Posto B', 'posto', false)] })]);
    // O critério já vale no posto.
    aqui([canal({ cena: CENA_DE_LADO, areas: [inteira(false), quadro(3, 'Posto do chapeiro', 'posto', true)] })]);
    // Dois canais: o quadro de um não existe no outro.
    aqui([...COM_POSTO(), canal({ pontoId: ID(901), cena: CENA_DE_LADO, areas: [inteira(true, 9)] })]);

    // De cima o detector não serve: nem com o posto.
    const deCima = proporEstudo(entrada({ ...acontecimento, canais: COM_POSTO().map((c) => ({ ...c, cena: CENA_DE_CIMA })) }));
    assert.deepEqual(deCima.contexto, []);
    // E o posto só entra no acontecimento: limpeza olha o próprio lugar, e a explicação não fala dele.
    const limpeza = proporEstudo(entrada({ criterio: 'Chapa limpa.', canais: COM_POSTO() }));
    assert.deepEqual(limpeza.contexto, [AQUI('sem_pessoa')]);
    assert.ok(!limpeza.porque.some((f) => f.includes('posto de trabalho')));
  });

  it('a foto padrão: gatilho só na comparação, e só com foto em TODOS os canais', () => {
    const comparacao = { tipo: 'comparacao', criterio: 'A vitrine está como na foto.' };
    const com = (canais: CanalDaProposta[]) => canais.map((c) => ({ ...c, temFotoPadrao: true }));

    const p = proporEstudo(entrada({ ...comparacao, canais: com(NOVO()) }));
    assert.deepEqual(p.contexto, [AQUI('sem_pessoa')]);
    assert.deepEqual(p.gatilho, [AQUI('saiu_do_padrao'), A_CADA(15)]);
    assert.equal(p.partes.gatilho, 'Este lugar deixou de estar como na foto padrão, ou passaram 15 minutos desde a última análise.');
    assert.equal(p.partes.desfecho, 'Igual à foto padrão: dentro. Diferente dela: fora. Tapado ou escuro: não deu para ver.');
    assert.equal(p.porque[1], 'O canal tem foto padrão: o gatilho é a imagem deixar de estar como nela.');
    assert.deepEqual(proporEstudo(entrada({ ...comparacao, canais: com(DE_CIMA()) })).contexto, [AQUI('parado')]);
    assert.deepEqual(proporEstudo(entrada({ ...comparacao, canais: com(BANCADA()) })).contexto, []);

    // Um canal com foto e outro sem: na loja, o que não se sabe ler não segura — o gatilho abriria em toda olhada.
    const umSem = [...com(NOVO()), canal({ pontoId: ID(901), areas: [inteira(true, 7)] })];
    const q = proporEstudo(entrada({ ...comparacao, canais: umSem }));
    assert.deepEqual(q.gatilho, [AQUI('parou'), A_CADA(10)]);
    assert.equal(q.porque[1], 'Há canal sem foto padrão: não pus o gatilho da foto. Sem ela, ele abriria a análise em toda olhada.');
    assert.equal(proporEstudo(entrada({ ...comparacao, canais: com(umSem) })).porque[1], 'Todos os canais têm foto padrão: o gatilho é a imagem deixar de estar como nela.');
    assert.equal(proporEstudo(entrada(comparacao)).porque[1], 'O canal ainda não tem foto padrão: não pus o gatilho da foto. Sem ela, ele abriria a análise em toda olhada.');
    // Sem canal nenhum não há "todos têm foto".
    assert.deepEqual(proporEstudo(entrada({ ...comparacao, canais: [] })).gatilho, [AQUI('parou'), A_CADA(10)]);

    // Fora da comparação a foto não entra, mesmo existindo.
    for (const parte of [{ criterio: 'Bancada limpa.' }, { criterio: 'A geladeira fica fechada.' }, { tipo: 'acao', familia: 'acontecimento' }]) {
      const r = proporEstudo(entrada({ ...parte, canais: com(NOVO()) }));
      assert.ok(![...r.contexto, ...r.gatilho].some((c) => c.sinal.includes('padrao')), JSON.stringify(parte));
    }
  });

  // ─────────────────────── os textos ───────────────────────

  it('o texto do contexto e o do gatilho dizem o que as condições fazem', () => {
    const limpeza = proporEstudo(entrada({ criterio: 'Bancada limpa.' }));
    assert.equal(limpeza.partes.contexto, 'Não há ninguém neste lugar.');
    assert.equal(limpeza.partes.gatilho, 'Este lugar ficou sem ninguém, ou passaram 10 minutos desde a última análise.');
    assert.equal(limpeza.partes.janela, 'A própria olhada: um quadro, o melhor dela.');
    assert.equal(limpeza.partes.desfecho, 'Como o texto descreve: dentro. Diferente: fora. Tapado ou escuro: não deu para ver.');
    assert.equal(limpeza.partes.fora, 'Sem o contexto não se julga, não se paga e não conta como análise.');

    const deCima = proporEstudo(entrada({ criterio: 'Bancada limpa.', canais: DE_CIMA() }));
    assert.equal(deCima.partes.contexto, 'Está tudo parado neste lugar.');
    assert.equal(deCima.partes.gatilho, 'Este lugar parou de se mexer, ou passaram 10 minutos desde a última análise.');

    const bancada = proporEstudo(entrada({ criterio: 'Bancada limpa.', canais: BANCADA() }));
    assert.equal(bancada.partes.contexto, 'Sem condição: vale sempre que o critério está no horário.');
    assert.equal(bancada.partes.gatilho, 'Passaram 10 minutos desde a última análise.');
    assert.equal(bancada.partes.fora, 'Enquanto nada abrir a análise, a olhada conta como “sem gatilho”: não se julga e não se paga.');

    const touca = proporEstudo(entrada({ criterio: 'Todos usam touca.' }));
    assert.equal(touca.partes.contexto, 'Há alguém neste lugar.');
    assert.equal(touca.partes.gatilho, 'Alguém chegou a este lugar, ou passaram 5 minutos desde a última análise.');
    assert.equal(proporEstudo(entrada({ criterio: 'Todos usam touca.', canais: DE_CIMA() })).partes.contexto, 'Algo se mexe neste lugar.');

    const acontece = proporEstudo(entrada({ tipo: 'acao', familia: 'acontecimento', criterio: 'A carne é virada.' }));
    assert.equal(acontece.partes.gatilho, 'Algo se mexeu neste lugar desde a olhada anterior.');
    assert.equal(acontece.partes.janela, 'Do gatilho até o lugar parar de novo.');
    assert.match(acontece.partes.desfecho, /^Aconteceu como o texto descreve: dentro\. A janela fechou sem acontecer: fora\./);
    assert.match(acontece.porque[0]!, /^Este critério pergunta por um acontecimento: /);
    const processo = proporEstudo(entrada({ tipo: 'acao', familia: 'processo' }));
    assert.match(processo.partes.desfecho, /^Todas as etapas, como o texto descreve: dentro\. Faltou ou sobrou etapa: fora\./);
    assert.match(processo.porque[0]!, /^Este critério pergunta por um processo: /);
    const medida = proporEstudo(entrada({ tipo: 'acao', familia: 'medida' }));
    assert.match(medida.partes.desfecho, /^Dentro do que o texto pede: dentro\. Passou do limite: fora\./);
    assert.match(medida.porque[0]!, /^Este critério pergunta por uma medida: /);

    assert.match(proporEstudo(entrada()).porque[0]!, /^Não achei no seu texto uma palavra que eu conheça\./);
  });

  it('a ação é a explicação do critério — e o que não cabe é cortado numa palavra', () => {
    assert.equal(proporEstudo(entrada({ criterio: '  A bancada\n fica   limpa.  ' })).partes.acao, 'A bancada fica limpa.');
    assert.equal(caberNaParte('x'.repeat(MAX_TEXTO_DA_PARTE)), 'x'.repeat(MAX_TEXTO_DA_PARTE));

    // 66 palavras de nove letras cabem; a 67ª ficaria pela metade ("palav"), e por isso sai inteira.
    const longo = `${'palavras '.repeat(100)}fim`;
    const cortado = caberNaParte(longo);
    assert.equal(cortado, `${'palavras '.repeat(65)}palavras…`);
    assert.ok(cortado.length <= MAX_TEXTO_DA_PARTE);
    // Uma palavra só, maior que o limite: corta no limite.
    const semEspaco = caberNaParte('y'.repeat(MAX_TEXTO_DA_PARTE + 50));
    assert.equal(semEspaco, `${'y'.repeat(MAX_TEXTO_DA_PARTE - 1)}…`);
    assert.equal(semEspaco.length, MAX_TEXTO_DA_PARTE);
    assert.equal(proporEstudo(entrada({ criterio: longo })).partes.acao, cortado);
  });

  // ─────────────────────── as notas ───────────────────────

  const notas = (acao: string, parte: Partial<Parameters<typeof notasDoEstudo>[0]> = {}) =>
    notasDoEstudo({ nome: 'Critério', acao, tipo: 'estado', familia: 'estado', canais: NOVO(), ...parte });

  it('"a câmera não vê": só o que nenhuma câmera de loja vê, com o motivo e a sugestão', () => {
    const casos: [string, string, RegExp, RegExp][] = [
      ['Toda carne posta na chapa é salgada antes de ser virada.', 'a câmera não vê', /^O sal e o tempero em pó não aparecem/, /lugar marcado para o saleiro/],
      ['O chapeiro põe sal na carne.', 'a câmera não vê', /^O sal e o tempero/, /saleiro/],
      ['A batata é temperada ao sair.', 'a câmera não vê', /^O sal e o tempero/, /saleiro/],
      ['O freezer está na temperatura certa.', 'a câmera não vê', /^A temperatura não aparece/, /a porta fechada, a tampa no lugar/],
      ['O óleo fica a 180° na fritadeira.', 'a câmera não vê', /^A temperatura não aparece/, /porta fechada/],
      ['Nenhum pote está com a validade vencida.', 'a câmera não lê', /a data de uma etiqueta não dá para ler\.$/, /se a etiqueta está lá/],
      ['A lixeira não deixa mau cheiro.', 'a câmera não vê', /^Cheiro não aparece/, /a cor, o aspecto, a fumaça/],
      ['Cada porção de batata tem 120 g.', 'a câmera não vê', /^O peso não aparece/, /a balança, a concha, o dosador/],
      ['A carne é pesada antes de ir para a chapa.', 'a câmera não vê', /^O peso não aparece/, /balança/],
      ['O atendente cumprimenta o cliente.', 'o Farol não ouve', /^O Farol analisa a imagem, não o som/, /o gesto que acompanha a fala/],
      ['Saber qual funcionário deixou a porta aberta.', 'o Farol não diz quem', /^O Farol não identifica pessoas/, /pelo horário do aviso e pela escala/],
      ['Identificar o colaborador sem touca.', 'o Farol não diz quem', /^O Farol não identifica pessoas/, /escala/],
    ];
    for (const [acao, rotulo, motivo, sugestao] of casos) {
      const n = notas(acao);
      assert.equal(n.avisos.length, 1, acao);
      assert.equal(n.avisos[0]!.parte, 'acao');
      assert.equal(n.avisos[0]!.rotulo, rotulo, acao);
      assert.match(n.avisos[0]!.motivo, motivo, acao);
      assert.ok(n.sugestoes.some((s) => sugestao.test(s)), acao);
    }
    // Palavra por palavra: cada jeito de dizer leva ao seu aviso.
    const JEITOS: Record<string, string[]> = {
      'O sal e o tempero em pó não aparecem na imagem.': [
        'salga', 'salgar', 'salgam', 'salgou', 'salgando', 'salgada', 'salgadas', 'tempera', 'temperam', 'temperar', 'temperou',
        'temperando', 'temperado', 'temperada', 'põe sal', 'pôr sal', 'coloca o sal', 'joga sal', 'passa sal',
      ],
      'A temperatura não aparece na imagem.': ['temperatura', 'temperaturas', 'graus', '180°', '4 °'],
      'Na distância de uma câmera de loja, a data de uma etiqueta não dá para ler.': [
        'validade', 'validades', 'vencido', 'vencida', 'vencidos', 'vencimento', 'vencimentos', 'data de fabricação',
      ],
      'Cheiro não aparece na imagem.': ['cheiro', 'cheiros', 'odor', 'odores', 'fedor'],
      'O peso não aparece na imagem.': [
        'peso', 'pesos', 'pesar', 'pesa', 'pesam', 'pesado', 'pesada', 'pesagem', 'grama', 'gramas', 'gramatura', 'quilo', 'quilos',
        'kg', '120 g', '50g',
      ],
      'O Farol analisa a imagem, não o som: o que foi dito ou ouvido não aparece.': [
        'cumprimenta', 'fala', 'falar', 'falam', 'falando', 'agradece', 'bom dia', 'boa tarde', 'boa noite', 'barulho', 'apito', 'grita',
      ],
      'O Farol não identifica pessoas: ele diz o que aconteceu e onde, não quem.': [
        'identificar o funcionário', 'reconhecer cada colaborador', 'identifica clientes', 'reconhece a pessoa', 'identificar atendentes',
        'qual funcionário', 'que colaborador', 'qual atendente', 'nome do atendente', 'nome da funcionária', 'nome do cliente',
        'nome do colaborador', 'quem foi', 'quem fez', 'quem estava', 'quem deixou', 'quem esqueceu',
      ],
    };
    for (const [motivo, jeitos] of Object.entries(JEITOS)) {
      for (const jeito of jeitos) {
        assert.deepEqual(notas(`Na cozinha: ${jeito}.`).avisos.map((a) => a.motivo), [motivo], jeito);
      }
    }

    // Dois de uma vez: um aviso de cada, sem repetir.
    const dois = notas('A carne é salgada e pesada.');
    assert.deepEqual(dois.avisos.map((a) => a.motivo), ['O sal e o tempero em pó não aparecem na imagem.', 'O peso não aparece na imagem.']);
    assert.equal(new Set(dois.sugestoes).size, dois.sugestoes.length);
    assert.equal(dois.sugestoes.length, 2);
  });

  it('o que APARECE na imagem não ganha aviso: o saleiro, os salgados, o cachorro-quente', () => {
    for (const acao of [
      'O saleiro fica no lugar marcado.',
      'O pote de tempero fica tampado.',
      'Os salgados ficam na estufa por até duas horas.',
      'O cachorro-quente sai montado na caixa.',
      'O chá gelado fica na geladeira.',
      'A câmara fria fica fechada.',
      'O fatiador de frios fica limpo.',
      'A pizza do sabor certo vai na caixa certa.',
      'Os 5 garfos ficam no suporte.',
      'A bancada fica sem restos entre um lote e outro.',
      'Quem monta o lanche usa luvas.',
      'O pedido é entregue ao cliente no balcão.',
    ]) {
      assert.deepEqual(notas(acao).avisos, [], acao);
    }
  });

  it('o aviso sai SÓ do texto da ação: quem reescreve para o que a câmera vê deixa de ser avisado', () => {
    // O nome ainda fala em salgar; a ação já fala do rastro.
    const n = notas('O saleiro saiu do lugar marcado e voltou.', { nome: 'O chapeiro salga as carnes' });
    assert.deepEqual(n, { avisos: [], sugestoes: [] });
    // Na proposta, a ação é a explicação do critério.
    const p = proporEstudo(entrada({ tipo: 'acao', familia: 'acontecimento', nome: 'Sal', criterio: 'Toda carne posta na chapa é salgada.' }));
    assert.equal(p.avisos.length, 1);
    assert.deepEqual(p.sugestoes, ['Dê à ação um rastro que a câmera veja: um lugar marcado para o saleiro, num quadro. O saleiro saiu do lugar e voltou = temperou.']);
    // A explicação longa: a ação é o pedaço que coube, e é dele que as notas saem — como na ficha guardada.
    const longa = proporEstudo(entrada({ criterio: `${'A chapa fica limpa e raspada. '.repeat(25)}A carne é salgada.` }));
    assert.ok(!longa.partes.acao.includes('salgada'));
    assert.deepEqual(longa.avisos, []);
  });

  it('o que alguém usa, em posição de montagem: a sugestão é mudar de lugar', () => {
    const sugere = /^Em posição de montagem o critério só é conferido com as mãos fora.*Marque este critério na imagem completa do canal ou num quadro de posto de trabalho\.$/;
    assert.match(notas('Quem monta usa luvas.', { canais: BANCADA() }).sugestoes[0]!, sugere);
    // O nome também diz que é sobre uma pessoa.
    assert.match(notas('Quem monta está protegido.', { nome: 'Uso de luvas', canais: BANCADA() }).sugestoes[0]!, sugere);
    // Basta UM dos lugares ser montagem.
    const misto = [canal({ areas: [inteira(true), quadro(2, 'Montagem', 'montagem', true)] })];
    assert.equal(notas('Quem monta usa luvas.', { canais: misto }).sugestoes.length, 1);

    // Não é sobre uma pessoa; não é montagem; a montagem existe mas o critério não vale nela; é do detector; é acontecimento.
    assert.deepEqual(notas('Bancada limpa.', { canais: BANCADA() }).sugestoes, []);
    assert.deepEqual(notas('Quem monta usa luvas.', { canais: DE_CIMA() }).sugestoes, []);
    const aoLado = [canal({ areas: [inteira(true), quadro(2, 'Montagem', 'montagem', false)] })];
    assert.deepEqual(notas('Quem monta usa luvas.', { canais: aoLado }).sugestoes, []);
    assert.deepEqual(notas('Quem monta usa luvas.', { tipo: 'presenca', canais: BANCADA() }).sugestoes, []);
    assert.deepEqual(notas('Quem monta usa luvas.', { tipo: 'acao', familia: 'processo', canais: BANCADA() }).sugestoes, []);
  });

  it('lavar as mãos: aparece onde a pia aparece', () => {
    const lavar = 'Quem chega lava as mãos antes de montar.';
    assert.deepEqual(notas(lavar).sugestoes, [
      'Lavar as mãos só aparece onde a pia aparece, e nenhum quadro daqui está marcado como pia. ' +
        'Se ela aparece na imagem, desenhe o quadro dela, com o papel “pia”, e marque este critério nele.',
    ]);
    const comPia = (alvo: boolean) => [canal({ areas: [inteira(!alvo), quadro(2, 'Chapa', 'equipamento', false), quadro(3, 'Pia da cozinha', 'pia', alvo)] })];
    assert.deepEqual(notas(lavar, { canais: comPia(false) }).sugestoes, [
      'Lavar as mãos aparece onde a pia aparece, e o canal tem um quadro de pia (Quadro 2 · Pia da cozinha): marque este critério nele.',
    ]);
    // O critério já vale na pia: nada a sugerir.
    assert.deepEqual(notas(lavar, { canais: comPia(true) }).sugestoes, []);
    for (const texto of ['Higienizar as mãos ao entrar.', 'Lavagem das mãos a cada troca de tarefa.', 'Todos de mãos lavadas.', 'Lave a mão antes.']) {
      assert.equal(notas(texto).sugestoes.length, 1, texto);
    }
    // Lavar outra coisa não é isto; e o detector não tem regra de lugar.
    assert.deepEqual(notas('A louça é lavada no fim do turno.').sugestoes, []);
    assert.deepEqual(notas(lavar, { tipo: 'contagem' }).sugestoes, []);
  });

  // ─────────────────────── o pedido ───────────────────────

  it('o pedido: o que falta ou não cabe é dito com o nome do campo', () => {
    const bom = { nome: ' Bancada ', criterio: ' Limpa. ', tipo: 'estado', zonaIds: [ID(1)] };
    assert.deepEqual(lerPedidoDeProposta(bom), { ok: { nome: 'Bancada', criterio: 'Limpa.', tipo: 'estado', familia: 'estado' } });
    // Sem nome ainda (o critério novo) e sem família (a natural do tipo).
    assert.deepEqual(lerPedidoDeProposta({ criterio: 'Vira a carne.', tipo: 'acao' }), {
      ok: { nome: '', criterio: 'Vira a carne.', tipo: 'acao', familia: 'acontecimento' },
    });
    assert.deepEqual(lerPedidoDeProposta({ ...bom, nome: null, tipo: 'acao', familia: 'medida' }), {
      ok: { nome: '', criterio: 'Limpa.', tipo: 'acao', familia: 'medida' },
    });

    const recusa = (corpo: unknown, padrao: RegExp) => {
      const r = lerPedidoDeProposta(corpo);
      assert.ok('problema' in r, JSON.stringify(corpo));
      assert.match(r.problema, padrao);
    };
    for (const torto of [null, undefined, 'texto', 7, [bom]]) recusa(torto, /^esperado \{ nome, criterio, tipo, familia, zonaIds \}$/);
    for (const criterio of [undefined, null, '', '   ', 7, ['x']]) recusa({ ...bom, criterio }, /^criterio: escreva antes como você explicaria/);
    recusa({ ...bom, criterio: 'x'.repeat(MAX_CRITERIO_NA_PROPOSTA + 1) }, /^criterio: no máximo 4000 caracteres/);
    assert.ok('ok' in lerPedidoDeProposta({ ...bom, criterio: 'x'.repeat(MAX_CRITERIO_NA_PROPOSTA) }));
    recusa({ ...bom, nome: 7 }, /^nome: texto$/);
    recusa({ ...bom, nome: 'x'.repeat(MAX_NOME_NA_PROPOSTA + 1) }, /^nome: no máximo 200 caracteres$/);
    assert.ok('ok' in lerPedidoDeProposta({ ...bom, nome: 'x'.repeat(MAX_NOME_NA_PROPOSTA) }));
    for (const tipo of [undefined, null, '', 'processo', 7]) recusa({ ...bom, tipo }, /^tipo: um de estado, acao, comparacao, presenca, contagem$/);
    recusa({ ...bom, familia: 'processo' }, /^familia: "processo" ainda não tem juiz/);
    recusa({ ...bom, tipo: 'acao', familia: 'estado' }, /^familia: um critério de estado/);
    recusa({ ...bom, familia: 'outra' }, /^familia: um de estado, acontecimento, processo, medida$/);
  });
});

// ───────────────────────── com o banco ─────────────────────────

describe('a proposta do estudo: a rota (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  let lojaId = '';
  let lojaDoVizinho = '';
  let cookie = '';
  let cookieVizinho = '';
  const outros: Record<string, string> = {};
  // O canal novo: só a imagem completa.
  let novoPontoId = '';
  let novaInteira = '';
  // A chapa: imagem completa, a chapa, o posto e um quadro que foi excluído.
  let chapaPonto = '';
  let chapaInteira = '';
  let chapa = '';
  let posto = '';
  let postoExcluido = '';
  // A montagem, vista de cima.
  let montagemPonto = '';
  let montagem = '';
  let zonaDoVizinho = '';
  // A área (não excluída) de um canal que foi excluído.
  let zonaDeCanalExcluido = '';

  async function entrar(tenant: string, email: string, nivel: string) {
    await app.inject({
      method: 'POST', url: '/v1/distribuicao/usuarios', headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId: tenant, nome: 'X', email, senha: SENHA, nivel },
    });
    const r = await app.inject({ method: 'POST', url: '/v1/sessao', payload: { email, senha: SENHA } });
    const b = r.headers['set-cookie'];
    return (Array.isArray(b) ? b[0]! : String(b)).split(';')[0]!;
  }

  const propor = (corpo: unknown, comCookie: string | null = cookie, loja = lojaId) =>
    app.inject({
      method: 'POST', url: `/v1/lojas/${loja}/estudo-proposto`,
      headers: comCookie ? { cookie: comCookie } : {}, payload: corpo as object,
    });
  const pedido = (zonaIds: string[], parte: Record<string, unknown> = {}) =>
    ({ nome: 'Critério', criterio: 'O balcão está como deve.', tipo: 'estado', familia: 'estado', zonaIds, ...parte });

  async function criterio(zonas: string[], corpo: Record<string, unknown> = {}): Promise<string> {
    const r = await app.inject({
      method: 'POST', url: `/v1/lojas/${lojaId}/regras`, headers: { cookie },
      payload: { nome: `Critério ${marca} ${randomUUID().slice(0, 6)}`, tipo: 'estado', criterio: 'O balcão está como deve.', zonaIds: zonas, quando: 'sempre', estado: 'observando', ...corpo },
    });
    assert.equal(r.statusCode, 201, r.body);
    return r.json().id as string;
  }
  const ler = (id: string) => app.inject({ method: 'GET', url: `/v1/regras/${id}/estudo`, headers: { cookie } });
  const gravar = (id: string, corpo: unknown) =>
    app.inject({ method: 'PUT', url: `/v1/regras/${id}/estudo`, headers: { cookie }, payload: corpo as object });
  const guardaFoto = (pontoId: string) =>
    pool.query(
      `insert into foto_padrao (ponto_id, nome, imagem, sha256, capturada_em) values ($1, 'Padrão', '\\x00'::bytea, repeat('a', 64), now())`,
      [pontoId],
    );
  const tiraFotos = (pontoId: string) => pool.query('delete from foto_padrao where ponto_id = $1', [pontoId]);

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    app = criarApp(pool, { logger: false });
    await app.ready();

    const conta = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome: marca }, loja: { nome: 'Matriz' }, setores: [{ nome: 'Cozinha' }] },
    })).json();
    lojaId = conta.loja.id;
    cookie = await entrar(conta.tenantId, `ger-${marca}@e.com`, 'gerente');
    for (const nivel of ['presidente', 'supervisao', 'execucao']) {
      outros[nivel] = await entrar(conta.tenantId, `${nivel}-${marca}@e.com`, nivel);
    }

    const novoPonto = async (nome: string, canal: number) =>
      (await app.inject({
        method: 'POST', url: `/v1/setores/${conta.setores[0].id}/pontos`, headers: { cookie },
        payload: { nome, origem: 'dvr', canal, host: '192.168.1.108' },
      })).json();
    const novaArea = async (ponto: string, nome: string, poligono: number[][], papel: string) => {
      const r = await app.inject({ method: 'POST', url: `/v1/pontos/${ponto}/zonas`, headers: { cookie }, payload: { nome, poligono, papel } });
      assert.equal(r.statusCode, 201, r.body);
      return r.json().id as string;
    };
    const cena = async (ponto: string, texto: string) => {
      const r = await app.inject({ method: 'PATCH', url: `/v1/pontos/${ponto}`, headers: { cookie }, payload: { cena: texto } });
      assert.equal(r.statusCode, 200, r.body);
    };

    const doNovo = await novoPonto('Balcão', 1);
    novoPontoId = doNovo.id;
    novaInteira = doNovo.zonas[0].id;

    const daChapa = await novoPonto('Chapa', 6);
    chapaPonto = daChapa.id;
    chapaInteira = daChapa.zonas[0].id;
    await cena(chapaPonto, CENA_DE_LADO);
    // A ordem de criação DISCORDA da ordem pedida: o posto é criado por último e vem primeiro.
    chapa = await novaArea(chapaPonto, 'Chapa', [[0.05, 0.1], [0.6, 0.1], [0.6, 0.65], [0.05, 0.65]], 'equipamento');
    postoExcluido = await novaArea(chapaPonto, 'Posto antigo', [[0.7, 0.1], [0.9, 0.1], [0.9, 0.3], [0.7, 0.3]], 'posto');
    posto = await novaArea(chapaPonto, 'Posto do chapeiro', [[0.05, 0.7], [0.6, 0.7], [0.6, 0.95], [0.05, 0.95]], 'posto');
    assert.equal((await app.inject({ method: 'PATCH', url: `/v1/zonas/${chapa}`, headers: { cookie }, payload: { ordem: 5 } })).statusCode, 200);
    assert.equal((await app.inject({ method: 'DELETE', url: `/v1/zonas/${postoExcluido}`, headers: { cookie } })).statusCode, 200);

    const daMontagem = await novoPonto('Montagem', 4);
    montagemPonto = daMontagem.id;
    await cena(montagemPonto, CENA_DE_CIMA);
    montagem = await novaArea(montagemPonto, 'Montagem', [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]], 'montagem');

    const doEstoque = await novoPonto('Estoque', 9);
    zonaDeCanalExcluido = doEstoque.zonas[0].id;
    assert.equal((await app.inject({ method: 'DELETE', url: `/v1/pontos/${doEstoque.id}`, headers: { cookie } })).statusCode, 200);
    const sobrou = await pool.query('select excluida_em from zona where id = $1', [zonaDeCanalExcluido]);
    assert.equal(sobrou.rows[0]?.excluida_em ?? null, null, 'o caso do teste: a área fica, o canal é que foi excluído');

    const vizinha = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome: `${marca}-vizinha` }, loja: { nome: 'Vizinha' }, setores: [{ nome: 'Cozinha' }] },
    })).json();
    lojaDoVizinho = vizinha.loja.id;
    cookieVizinho = await entrar(vizinha.tenantId, `ger-${marca}-viz@e.com`, 'gerente');
    const pontoDoVizinho = (await app.inject({
      method: 'POST', url: `/v1/setores/${vizinha.setores[0].id}/pontos`, headers: { cookie: cookieVizinho },
      payload: { nome: 'Chapa', origem: 'dvr', canal: 6, host: '192.168.1.108' },
    })).json();
    zonaDoVizinho = pontoDoVizinho.zonas[0].id;
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  it('a conta nova (um canal, só a imagem completa): propõe, explica o que supôs e não grava nada', async () => {
    // Só desta loja: os outros arquivos de teste gravam no mesmo banco ao mesmo tempo.
    const oQueHa = () =>
      pool.query(
        `select (select count(*)::int from regra_estudo e join regra r on r.id = e.regra_id where r.loja_id = $1) as estudos,
                (select count(*)::int from regra where loja_id = $1) as criterios,
                (select config_versao from loja where id = $1) as versao`,
        [lojaId],
      );
    const antes = await oQueHa();
    const r = await propor(pedido([novaInteira], { criterio: 'A bancada fica sem restos de alimento.' }));
    assert.equal(r.statusCode, 200, r.body);
    const b = r.json();
    assert.deepEqual(Object.keys(b).sort(), ['avisos', 'estudo', 'porque', 'sugestoes', 'usaContextoEGatilho']);
    assert.deepEqual(Object.keys(b.estudo).sort(), ['contexto', 'gatilho', 'partes']);
    assert.equal(b.usaContextoEGatilho, true);
    assert.deepEqual(b.estudo.contexto, [AQUI('sem_pessoa')]);
    assert.deepEqual(b.estudo.gatilho, [AQUI('saiu'), A_CADA(10)]);
    assert.equal(b.estudo.partes.acao, 'A bancada fica sem restos de alimento.');
    assert.deepEqual(b.porque, [
      'Li “restos” no seu texto: é sobre limpeza e organização. Gente na frente esconde, e por isso vale olhar com o lugar livre.',
      'Usei o detector de pessoas. Se a câmera olha de cima, troque por movimento: de cima ele vê mão e braço, não gente.',
      'A cena deste canal ainda não foi descrita: é nela que eu leio de onde a câmera olha.',
    ]);
    assert.deepEqual(b.avisos, []);
    assert.deepEqual(b.sugestoes, []);
    // A chave interna do assunto não sai.
    assert.doesNotMatch(r.body, /"assunto"|limpeza"/);

    const depois = await oQueHa();
    assert.deepEqual(depois.rows[0], antes.rows[0], 'a proposta não grava nem mexe na configuração da loja');
  });

  it('presença e contagem: a proposta diz que o estudo delas não leva contexto nem gatilho', async () => {
    const r = await propor(pedido([novaInteira], { tipo: 'presenca', criterio: 'Há alguém no caixa.' }));
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().usaContextoEGatilho, false);
    assert.deepEqual(r.json().estudo.contexto, []);
    assert.deepEqual(r.json().estudo.gatilho, []);
  });

  it('quem pede: só quem configura; sem sessão, 401', async () => {
    const corpo = pedido([novaInteira]);
    assert.equal((await propor(corpo, null)).statusCode, 401);
    assert.equal((await propor(corpo, outros.supervisao!)).statusCode, 403);
    assert.equal((await propor(corpo, outros.execucao!)).statusCode, 403);
    assert.equal((await propor(corpo, outros.presidente!)).statusCode, 200);
    // A permissão vem antes da leitura do corpo: quem não configura não fica sabendo o que faltou.
    assert.equal((await propor({}, outros.supervisao!)).statusCode, 403);
  });

  it('o lugar de outra conta, de outra loja, excluído ou inexistente é indistinguível do que não existe', async () => {
    const nada = async (r: Awaited<ReturnType<typeof propor>>) => {
      assert.equal(r.statusCode, 404, r.body);
      assert.deepEqual(r.json(), { erro: 'nao_encontrada', mensagem: 'loja ou canal não encontrado' });
    };
    // A minha loja pedida por outra conta; a loja do vizinho pedida por mim; e a zona dele na minha loja.
    await nada(await propor(pedido([novaInteira]), cookieVizinho));
    await nada(await propor(pedido([zonaDoVizinho]), cookie, lojaDoVizinho));
    await nada(await propor(pedido([zonaDoVizinho])));
    // No meio de uma lista boa, a zona que não é daqui não é ignorada calada.
    await nada(await propor(pedido([novaInteira, zonaDoVizinho])));
    await nada(await propor(pedido([novaInteira, randomUUID()])));
    await nada(await propor(pedido([postoExcluido])));
    await nada(await propor(pedido([zonaDeCanalExcluido])));
    await nada(await propor(pedido([novaInteira]), cookie, 'nao-e-uuid'));
    await nada(await propor(pedido([novaInteira]), cookie, randomUUID()));
    // A zona é minha, mas de OUTRA loja que não a do endereço: a do vizinho com a sessão dele, na loja errada.
    await nada(await propor(pedido([zonaDoVizinho]), cookieVizinho, lojaId));
    // Repetir a mesma zona não é "duas zonas": passa, como na criação do critério.
    assert.equal((await propor(pedido([novaInteira, novaInteira.toUpperCase()]))).statusCode, 200);
  });

  it('o pedido que não cabe é recusado com o motivo', async () => {
    const recusa = async (corpo: unknown, padrao: RegExp) => {
      const r = await propor(corpo);
      assert.equal(r.statusCode, 422, r.body);
      assert.equal(r.json().erro, 'validacao');
      assert.match(r.json().mensagem, padrao);
    };
    await recusa(pedido([novaInteira], { criterio: '  ' }), /^criterio: escreva antes/);
    await recusa(pedido([novaInteira], { tipo: 'outro' }), /^tipo: um de /);
    await recusa(pedido([novaInteira], { familia: 'processo' }), /^familia: "processo" ainda não tem juiz/);
    await recusa(pedido([]), /^marque ao menos um canal: a proposta lê o canal e os quadros/);
    await recusa({ ...pedido([]), zonaIds: undefined }, /^marque ao menos um canal/);
    await recusa({ ...pedido([]), zonaIds: 'x' }, /^zonaIds: lista de canais$/);
    await recusa(pedido(['nao-e-uuid']), /^zonaIds: cada item é um uuid$/);
  });

  it('o posto do canal entra na condição, com o número que a tela mostra — e a ficha proposta é aceita pela rota de gravar', async () => {
    const acontecimento = { tipo: 'acao', familia: 'acontecimento', criterio: 'Toda carne posta na chapa é salgada antes de ser virada.' };
    const r = await propor(pedido([chapa], acontecimento));
    assert.equal(r.statusCode, 200, r.body);
    const b = r.json();
    // O posto excluído não conta: sobra UM posto, e é ele. Criado por último, vem primeiro (a chapa tem ordem 5).
    assert.deepEqual(b.estudo.contexto, [{ sinal: 'pessoa', onde: 'quadro', zonaId: posto }]);
    assert.equal(b.estudo.partes.contexto, 'Há alguém no Quadro 1 · Posto do chapeiro.');
    assert.deepEqual(b.avisos, [{ parte: 'acao', rotulo: 'a câmera não vê', motivo: 'O sal e o tempero em pó não aparecem na imagem.' }]);
    assert.equal(b.sugestoes.length, 1);

    // A ida e a volta: o que foi proposto é gravado como rascunho, sem mudar uma letra.
    const id = await criterio([chapa], acontecimento);
    const g = await gravar(id, { ...b.estudo, confirmado: false });
    assert.equal(g.statusCode, 200, g.body);
    const lido = (await ler(id)).json();
    assert.deepEqual(lido.estudo.partes, b.estudo.partes);
    assert.deepEqual(lido.estudo.contexto, b.estudo.contexto);
    assert.deepEqual(lido.estudo.gatilho, b.estudo.gatilho);
    assert.equal(lido.estudo.confirmado, false);
    // As notas saem de novo do texto guardado.
    assert.deepEqual(lido.notas, { avisos: b.avisos, sugestoes: b.sugestoes });

    // Quem segue a sugestão e reescreve a ação deixa de ser avisado.
    const novo = await gravar(id, { ...b.estudo, partes: { ...b.estudo.partes, acao: 'O saleiro saiu do lugar marcado e voltou.' }, confirmado: false });
    assert.equal(novo.statusCode, 200, novo.body);
    assert.deepEqual((await ler(id)).json().notas, { avisos: [], sugestoes: [] });
    // Com a ação em branco, as notas saem da explicação do critério.
    const semAcao = { ...b.estudo.partes };
    delete semAcao.acao;
    assert.equal((await gravar(id, { ...b.estudo, partes: semAcao, confirmado: false })).statusCode, 200);
    assert.deepEqual((await ler(id)).json().notas, { avisos: b.avisos, sugestoes: b.sugestoes });
  });

  it('critério sem estudo não tem notas; e a ficha lida continua com os quadros que pode citar', async () => {
    const id = await criterio([chapa], { tipo: 'acao', familia: 'acontecimento', criterio: 'Toda carne posta na chapa é salgada.' });
    const b = (await ler(id)).json();
    assert.equal(b.estudo, null);
    assert.equal(b.notas, null);
    assert.equal(b.canais.length, 1);
    assert.deepEqual(
      b.canais[0].quadros.map((q: { nome: string; numero: number | null }) => [q.nome, q.numero]),
      [['Imagem completa', null], ['Posto do chapeiro', 1], ['Chapa', 2]],
    );
    assert.deepEqual(Object.keys(b.canais[0].quadros[0]).sort(), ['id', 'nome', 'numero', 'papel']);
  });

  it('as notas da ficha lida olham o lugar em que o critério vale', async () => {
    const id = await criterio([montagem], { nome: `Luvas ${marca}`, criterio: 'Quem monta usa luvas.' });
    assert.equal((await gravar(id, { partes: { acao: 'Quem monta usa luvas.' }, confirmado: false })).statusCode, 200);
    const n = (await ler(id)).json().notas;
    assert.deepEqual(n.avisos, []);
    assert.equal(n.sugestoes.length, 1);
    assert.match(n.sugestoes[0], /^Em posição de montagem o critério só é conferido com as mãos fora/);

    // O mesmo critério na imagem completa do mesmo canal: a montagem existe, mas ele não vale nela.
    const inteiraDaMontagem = (await pool.query('select id from zona where ponto_id = $1 and principal', [montagemPonto])).rows[0].id as string;
    const outro = await criterio([inteiraDaMontagem], { nome: `Luvas ${marca} 2`, criterio: 'Quem monta usa luvas.' });
    assert.equal((await gravar(outro, { partes: { acao: 'Quem monta usa luvas.' }, confirmado: false })).statusCode, 200);
    assert.deepEqual((await ler(outro)).json().notas, { avisos: [], sugestoes: [] });
  });

  it('as notas da ficha lida dependem do que o critério É: o nome, o tipo e a família guardados', async () => {
    const notasDe = async (zonas: string[], corpo: Record<string, unknown>, partes: Record<string, string>) => {
      const id = await criterio(zonas, corpo);
      assert.equal((await gravar(id, { partes, confirmado: false })).statusCode, 200);
      return (await ler(id)).json().notas as { avisos: unknown[]; sugestoes: string[] };
    };
    const luvas = { acao: 'Quem monta usa luvas.' };
    // O nome diz que é sobre uma pessoa, a ação não: a sugestão de lugar vem do nome guardado.
    const peloNome = await notasDe([montagem], { nome: `Uso de luvas ${marca}`, criterio: 'Quem monta está protegido.' }, { acao: 'Quem monta está protegido.' });
    assert.equal(peloNome.sugestoes.length, 1);
    assert.match(peloNome.sugestoes[0]!, /^Em posição de montagem/);
    // Presença: sem regra de lugar.
    assert.deepEqual(
      await notasDe([montagem], { tipo: 'presenca', parametros: { objeto: 'pessoa', minimo: 1, maximo: null }, criterio: luvas.acao }, luvas),
      { avisos: [], sugestoes: [] },
    );
    // Processo: quem decide é a família guardada, não o vocabulário.
    assert.deepEqual(await notasDe([montagem], { tipo: 'acao', familia: 'processo', criterio: luvas.acao }, luvas), { avisos: [], sugestoes: [] });
    // Sem a ação escrita, as notas saem da explicação — do pedaço dela que caberia na ação.
    const longa = `${'A chapa fica limpa e raspada. '.repeat(25)}A carne é salgada.`;
    assert.deepEqual(await notasDe([chapa], { criterio: longa }, { janela: 'A própria olhada.' }), { avisos: [], sugestoes: [] });
    const curta = await notasDe([chapa], { criterio: 'A carne é salgada.' }, { janela: 'A própria olhada.' });
    assert.equal(curta.avisos.length, 1);
  });

  it('de cima, e em posição de montagem: a cena e o papel do quadro decidem o sinal', async () => {
    const inteiraDaMontagem = (await pool.query('select id from zona where ponto_id = $1 and principal', [montagemPonto])).rows[0].id as string;
    const limpa = { criterio: 'A bancada fica limpa entre um lote e outro.' };

    const naBancada = (await propor(pedido([montagem], limpa))).json();
    assert.deepEqual(naBancada.estudo.contexto, []);
    assert.deepEqual(naBancada.estudo.gatilho, [A_CADA(10)]);
    assert.match(naBancada.porque[1], /^O critério vale em posição de montagem: ali a loja já espera as mãos saírem/);

    const naImagem = (await propor(pedido([inteiraDaMontagem], limpa))).json();
    assert.deepEqual(naImagem.estudo.contexto, [AQUI('parado')]);
    assert.deepEqual(naImagem.estudo.gatilho, [AQUI('parou'), A_CADA(10)]);
    assert.match(naImagem.porque[1], /^A cena deste canal diz que a câmera olha de cima\./);

    // A chapa é vista de lado: detector de pessoas.
    assert.deepEqual((await propor(pedido([chapa], limpa))).json().estudo.contexto, [AQUI('sem_pessoa')]);
    // Dois canais, um deles de cima: movimento nos dois, e a frase no plural.
    const dois = (await propor(pedido([chapa, inteiraDaMontagem], limpa))).json();
    assert.deepEqual(dois.estudo.contexto, [AQUI('parado')]);
    assert.match(dois.porque[1], /^A cena de um dos canais diz que a câmera olha de cima\./);
  });

  it('dois canais: a condição nunca cita o quadro de um deles', async () => {
    const acontecimento = { tipo: 'acao', familia: 'acontecimento', criterio: 'A carne é virada uma vez.' };
    const r = (await propor(pedido([chapa, novaInteira], acontecimento))).json();
    assert.deepEqual(r.estudo.contexto, [AQUI('pessoa')]);
    assert.equal(r.estudo.partes.contexto, 'Há alguém neste lugar.');
    // E a ficha vale para o critério que está nos dois canais.
    const id = await criterio([chapa, novaInteira], acontecimento);
    assert.equal((await gravar(id, { ...r.estudo, confirmado: false })).statusCode, 200);
  });

  it('a foto padrão: o gatilho dela só entra com foto em todos os canais do critério', async () => {
    const comparacao = { tipo: 'comparacao', criterio: 'A vitrine está como na foto.' };
    const gatilho = async (zonas: string[]) => (await propor(pedido(zonas, comparacao))).json().estudo.gatilho;
    try {
      assert.deepEqual(await gatilho([novaInteira]), [AQUI('parou'), A_CADA(10)]);
      await guardaFoto(novoPontoId);
      assert.deepEqual(await gatilho([novaInteira]), [AQUI('saiu_do_padrao'), A_CADA(15)]);
      // A chapa ainda não tem foto: nos dois canais juntos, o gatilho da foto não entra.
      assert.deepEqual(await gatilho([novaInteira, chapaInteira]), [AQUI('parou'), A_CADA(10)]);
      await guardaFoto(chapaPonto);
      assert.deepEqual(await gatilho([novaInteira, chapaInteira]), [AQUI('saiu_do_padrao'), A_CADA(15)]);
      // A foto de um canal em que o critério NÃO vale não conta.
      await tiraFotos(novoPontoId);
      assert.deepEqual(await gatilho([novaInteira]), [AQUI('parou'), A_CADA(10)]);
    } finally {
      await tiraFotos(novoPontoId);
      await tiraFotos(chapaPonto);
    }
  });
});
