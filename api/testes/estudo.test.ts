// O estudo do critério: o contexto que precisa estar acontecendo, o gatilho
// que abre a análise, e o funil em números.
//
// A19, onda 1, fatia 1.3. Pedido do dono (08/10/2026): os critérios têm de ser
// estudados para gerar gatilhos, sem julgamento desnecessário "sem movimento
// ou sem o contexto acontecendo". O que tem de ficar provado aqui:
//
//   - o vocabulário é o do contrato (o agente lê o mesmo arquivo), e a ficha
//     que não cabe é recusada dizendo por quê — nada é gravado pela metade;
//   - só quem configura grava e tira o estudo; outra conta nem sabe que o
//     critério existe; o quadro citado é de um canal do critério;
//   - só o estudo CONFIRMADO desce, e só para o agente que declara saber
//     lidar com ele; presença e contagem não levam contexto nem gatilho;
//   - mexer no que o agente usa faz a loja puxar a configuração; corrigir o
//     texto de uma parte, não;
//   - a olhada "sem gatilho" chega ao resumo por hora, e o funil fecha a
//     conta: toda olhada termina num desfecho só;
//   - "quanto custaria ligado" nunca usa preço inventado.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import {
  CONTRARIOS,
  GATILHOS_SEM_LUGAR,
  MAX_POR_LISTA,
  MAX_TEXTO_DA_PARTE,
  MINUTOS,
  ONDES,
  PARTES,
  SABE_ESTUDO,
  SINAIS_DE_CONTEXTO,
  SINAIS_DE_GATILHO,
  TIPOS_QUE_USAM_ESTUDO,
  estudoNaoCabeNoTipo,
  estudoParaOAgente,
  lerEstudo,
  mediaDeGatilhosPorDia,
  montarFunil,
  quadrosCitados,
  quantoCustariaLigado,
  type SomaDoFunil,
} from '../src/estudo.js';
import { validarResumo } from '../src/rotas/resumos.js';

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-estudo-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-estudo';
const SENHA = 'uma senha longa o bastante';

type Cond = { sinal: string; onde?: string; zonaId?: string; minutos?: number };
const CONTRATO = JSON.parse(readFileSync(new URL('../../contratos/estudo-do-criterio.json', import.meta.url), 'utf8')) as {
  partes: string[]; onde: string[]; contexto: string[]; gatilho: string[]; gatilhoSemLugar: string[];
  contrarios: [string, string][]; tiposQueUsam: string[]; minutos: { minimo: number; maximo: number };
  maximoPorLista: number; sabe: string;
  configuracao: { regra: { estudo: { contexto: Cond[]; gatilho: Cond[] } } };
};
const RESUMO = JSON.parse(readFileSync(new URL('../../contratos/resumo-do-agente.json', import.meta.url), 'utf8')) as Record<string, unknown>;

const Q = '00000000-0000-4000-8000-0000000000a2';
const problema = (corpo: unknown): string => {
  const r = lerEstudo(corpo);
  return 'problema' in r ? r.problema : '(aceito)';
};
const lido = (corpo: unknown) => {
  const r = lerEstudo(corpo);
  assert.ok('ok' in r, `devia ser aceito: ${JSON.stringify(r)}`);
  return r.ok;
};

// ───────────────────── as regras, sem banco ─────────────────────

describe('o estudo do critério — o que cabe', () => {
  it('o vocabulário é o do contrato, e o agente lê o mesmo arquivo', () => {
    assert.deepEqual([...PARTES], CONTRATO.partes);
    assert.deepEqual([...ONDES], CONTRATO.onde);
    assert.deepEqual([...SINAIS_DE_CONTEXTO], CONTRATO.contexto);
    assert.deepEqual([...SINAIS_DE_GATILHO], CONTRATO.gatilho);
    assert.deepEqual([...GATILHOS_SEM_LUGAR], CONTRATO.gatilhoSemLugar);
    assert.deepEqual(CONTRARIOS.map((p) => [...p]), CONTRATO.contrarios);
    assert.deepEqual([...TIPOS_QUE_USAM_ESTUDO], CONTRATO.tiposQueUsam);
    assert.deepEqual({ ...MINUTOS }, CONTRATO.minutos);
    assert.equal(MAX_POR_LISTA, CONTRATO.maximoPorLista);
    assert.equal(SABE_ESTUDO, CONTRATO.sabe);
  });

  it('o exemplo do contrato é aceito, e sai como entrou', () => {
    const exemplo = CONTRATO.configuracao.regra.estudo;
    const e = lido({ ...exemplo, confirmado: true });
    assert.deepEqual(e.contexto, exemplo.contexto);
    assert.deepEqual(e.gatilho, exemplo.gatilho);
    assert.equal(e.confirmado, true);
    assert.deepEqual(quadrosCitados(e), [Q]);
    const duasVezes = lido({ contexto: [{ sinal: 'pessoa', onde: 'quadro', zonaId: Q }], gatilho: [{ sinal: 'entrou', onde: 'quadro', zonaId: Q }, { sinal: 'parou' }] });
    assert.deepEqual(quadrosCitados(duasVezes), [Q], 'o mesmo quadro no contexto e no gatilho é um só');
    assert.deepEqual(quadrosCitados(lido({ gatilho: [{ sinal: 'entrou', onde: 'quadro', zonaId: Q }] })), [Q], 'o do gatilho também conta');
    assert.deepEqual(quadrosCitados(lido({ contexto: [{ sinal: 'pessoa' }, { sinal: 'parado', onde: 'canal' }] })), []);
  });

  it('a ficha vazia é aceita: confere em toda olhada, e nasce sem confirmar', () => {
    assert.deepEqual(lido({}), { partes: {}, contexto: [], gatilho: [], confirmado: false });
    assert.deepEqual(lido({ partes: null, contexto: null, gatilho: null, confirmado: null }), { partes: {}, contexto: [], gatilho: [], confirmado: false });
  });

  it('os textos das partes são aparados; o vazio some; parte que não existe é recusada', () => {
    const e = lido({ partes: { contexto: '  Há carne na chapa.  ', gatilho: '   ', janela: null, fora: 'Sem carne não se julga.' } });
    assert.deepEqual(e.partes, { contexto: 'Há carne na chapa.', fora: 'Sem carne não se julga.' });
    assert.match(problema({ partes: { resumo: 'x' } }), /partes\.resumo: parte desconhecida\. As partes são contexto, gatilho, janela, acao, desfecho, fora/);
    assert.match(problema({ partes: { acao: 7 } }), /partes\.acao: texto/);
    assert.match(problema({ partes: ['x'] }), /partes: um texto por parte/);
    assert.equal(problema({ partes: { acao: 'x'.repeat(MAX_TEXTO_DA_PARTE) } }), '(aceito)');
    assert.match(problema({ partes: { acao: 'x'.repeat(MAX_TEXTO_DA_PARTE + 1) } }), /partes\.acao: no máximo 600 caracteres/);
  });

  it('o que não é ficha é recusado', () => {
    for (const torto of [null, undefined, 'estudo', 7, [], [{}]]) {
      assert.match(problema(torto), /esperado \{ partes, contexto, gatilho, confirmado \}/, String(torto));
    }
    assert.match(problema({ confirmado: 'sim' }), /confirmado: verdadeiro ou falso/);
  });

  it('condição de contexto: o sinal, o lugar e mais nada', () => {
    assert.deepEqual(lido({ contexto: [{ sinal: 'pessoa' }] }).contexto, [{ sinal: 'pessoa', onde: 'aqui' }], 'sem lugar dito, é no quadro do critério');
    assert.deepEqual(lido({ contexto: [{ sinal: 'parado', onde: 'canal' }] }).contexto, [{ sinal: 'parado', onde: 'canal' }]);
    assert.deepEqual(
      lido({ contexto: [{ sinal: 'pessoa', onde: 'quadro', zonaId: Q.toUpperCase(), sobra: 1 }] }).contexto,
      [{ sinal: 'pessoa', onde: 'quadro', zonaId: Q }],
      'o id vai em minúsculas e o que sobra não é guardado',
    );

    assert.match(problema({ contexto: 'pessoa' }), /contexto: uma lista de condições/);
    assert.match(problema({ contexto: ['pessoa'] }), /contexto\[0\]: não é uma condição/);
    assert.match(problema({ contexto: [{ sinal: 'forno_quente' }] }), /contexto\[0\]\.sinal: um de pessoa, sem_pessoa, movimento, parado, fora_do_padrao, no_padrao/);
    assert.match(problema({ contexto: [{ sinal: 'entrou' }] }), /contexto\[0\]\.sinal/, 'gatilho não é contexto');
    assert.match(problema({ contexto: [{ sinal: 'pessoa' }, { sinal: 'pessoa', onde: 'na_lua' }] }), /contexto\[1\]\.onde: um de aqui, canal, quadro/);
    assert.match(problema({ contexto: [{ sinal: 'pessoa', onde: 7 }] }), /contexto\[0\]\.onde/);
    assert.match(problema({ contexto: [{ sinal: 'pessoa', onde: 'quadro' }] }), /contexto\[0\]\.zonaId: diga qual quadro/);
    assert.match(problema({ contexto: [{ sinal: 'pessoa', onde: 'quadro', zonaId: 'o-posto' }] }), /contexto\[0\]\.zonaId: diga qual quadro/);
    assert.match(problema({ contexto: [{ sinal: 'pessoa', onde: 'aqui', zonaId: Q }] }), /contexto\[0\]\.zonaId: só com onde = quadro/);
    assert.match(problema({ contexto: [{ sinal: 'pessoa', minutos: 5 }] }), /contexto\[0\]\.minutos: só no gatilho a_cada/);
  });

  it('contexto: sem repetir, sem contradizer e com teto', () => {
    assert.match(problema({ contexto: [{ sinal: 'pessoa' }, { sinal: 'pessoa', onde: 'aqui' }] }), /contexto\[1\]: condição repetida/);
    // O mesmo sinal em lugares diferentes não é repetição.
    assert.equal(lido({ contexto: [{ sinal: 'pessoa' }, { sinal: 'pessoa', onde: 'canal' }, { sinal: 'pessoa', onde: 'quadro', zonaId: Q }] }).contexto.length, 3);

    for (const [a, b] of CONTRATO.contrarios) {
      assert.match(
        problema({ contexto: [{ sinal: a, onde: 'canal' }, { sinal: b, onde: 'canal' }] }),
        new RegExp(`contexto: "${a}" e "${b}" no mesmo lugar nunca valem juntos`),
      );
      assert.match(problema({ contexto: [{ sinal: b, onde: 'quadro', zonaId: Q }, { sinal: a, onde: 'quadro', zonaId: Q }] }), /nunca valem juntos/);
      // Em lugares diferentes é o estudo de verdade: "gente no posto E ninguém na frente da chapa".
      assert.equal(problema({ contexto: [{ sinal: a, onde: 'canal' }, { sinal: b, onde: 'aqui' }] }), '(aceito)');
    }

    const muitas = [...SINAIS_DE_CONTEXTO, ...SINAIS_DE_CONTEXTO].map((sinal, i) => ({ sinal, onde: i < 6 ? 'aqui' : 'canal' }));
    assert.match(problema({ contexto: muitas.slice(0, MAX_POR_LISTA + 1) }), /contexto: no máximo 6 condições/);
  });

  it('gatilho: os do relógio não têm lugar, os outros têm', () => {
    assert.deepEqual(lido({ gatilho: [{ sinal: 'toda_olhada' }] }).gatilho, [{ sinal: 'toda_olhada' }]);
    assert.deepEqual(lido({ gatilho: [{ sinal: 'a_cada', minutos: 10 }] }).gatilho, [{ sinal: 'a_cada', minutos: 10 }]);
    assert.deepEqual(
      lido({ gatilho: [{ sinal: 'entrou' }, { sinal: 'parou', onde: 'quadro', zonaId: Q }, { sinal: 'saiu_do_padrao', onde: 'canal' }] }).gatilho,
      [{ sinal: 'entrou', onde: 'aqui' }, { sinal: 'parou', onde: 'quadro', zonaId: Q }, { sinal: 'saiu_do_padrao', onde: 'canal' }],
    );

    assert.match(problema({ gatilho: 'entrou' }), /gatilho: uma lista de gatilhos/);
    assert.match(problema({ gatilho: [7] }), /gatilho\[0\]: não é um gatilho/);
    assert.match(problema({ gatilho: [{ sinal: 'tocou_a_campainha' }] }), /gatilho\[0\]\.sinal: um de toda_olhada, a_cada, entrou, saiu, mexeu, parou, saiu_do_padrao, voltou_ao_padrao/);
    assert.match(problema({ gatilho: [{ sinal: 'pessoa' }] }), /gatilho\[0\]\.sinal/, 'contexto não é gatilho');
    for (const sinal of CONTRATO.gatilhoSemLugar) {
      const base = sinal === 'a_cada' ? { sinal, minutos: 5 } : { sinal };
      assert.match(problema({ gatilho: [{ ...base, onde: 'aqui' }] }), new RegExp(`gatilho\\[0\\]: "${sinal}" é do relógio, não tem lugar`));
      assert.match(problema({ gatilho: [{ ...base, zonaId: Q }] }), /é do relógio, não tem lugar/);
    }
    assert.match(problema({ gatilho: [{ sinal: 'toda_olhada', minutos: 5 }] }), /gatilho\[0\]\.minutos: só no gatilho a_cada/);
    assert.match(problema({ gatilho: [{ sinal: 'entrou', minutos: 5 }] }), /gatilho\[0\]\.minutos: só no gatilho a_cada/);
    assert.match(problema({ gatilho: [{ sinal: 'entrou', onde: 'quadro' }] }), /gatilho\[0\]\.zonaId: diga qual quadro/);
    assert.match(problema({ gatilho: [{ sinal: 'entrou', onde: 'teto' }] }), /gatilho\[0\]\.onde: um de aqui, canal, quadro/);
  });

  it('gatilho a_cada: minutos inteiros, de 1 a 720', () => {
    for (const bom of [CONTRATO.minutos.minimo, 10, CONTRATO.minutos.maximo]) {
      assert.deepEqual(lido({ gatilho: [{ sinal: 'a_cada', minutos: bom }] }).gatilho, [{ sinal: 'a_cada', minutos: bom }]);
    }
    for (const ruim of [0, -5, 721, 1.5, '10', null, undefined, true]) {
      assert.match(problema({ gatilho: [{ sinal: 'a_cada', minutos: ruim }] }), /gatilho\[0\]\.minutos: inteiro de 1 a 720/, String(ruim));
    }
  });

  it('gatilho: sem repetir, com teto, e "toda olhada" sozinho', () => {
    assert.match(problema({ gatilho: [{ sinal: 'entrou' }, { sinal: 'entrou', onde: 'aqui' }] }), /gatilho\[1\]: gatilho repetido/);
    assert.match(problema({ gatilho: [{ sinal: 'a_cada', minutos: 5 }, { sinal: 'a_cada', minutos: 10 }] }), /gatilho\[1\]: gatilho repetido/, 'dois relógios é um só');
    assert.equal(problema({ gatilho: [{ sinal: 'entrou' }, { sinal: 'entrou', onde: 'canal' }] }), '(aceito)');
    assert.match(problema({ gatilho: [{ sinal: 'toda_olhada' }, { sinal: 'entrou' }] }), /"toda_olhada" já abre a análise em toda olhada/);
    assert.match(problema({ gatilho: [{ sinal: 'a_cada', minutos: 5 }, { sinal: 'toda_olhada' }] }), /"toda_olhada" já abre/);
    const muitos = SINAIS_DE_GATILHO.filter((g) => !GATILHOS_SEM_LUGAR.includes(g)).flatMap((sinal) => [{ sinal }, { sinal, onde: 'canal' }]);
    assert.equal(problema({ gatilho: muitos.slice(0, MAX_POR_LISTA) }), '(aceito)');
    assert.match(problema({ gatilho: muitos.slice(0, MAX_POR_LISTA + 1) }), /gatilho: no máximo 6 gatilhos/);
  });

  it('presença e contagem não levam contexto nem gatilho; os textos, sim', () => {
    const com = lido({ contexto: [{ sinal: 'pessoa' }] });
    const comGatilho = lido({ gatilho: [{ sinal: 'a_cada', minutos: 5 }] });
    const soTexto = lido({ partes: { contexto: 'A loja está aberta.' }, confirmado: true });
    for (const tipo of ['presenca', 'contagem']) {
      assert.match(String(estudoNaoCabeNoTipo(tipo, com)), /presença e contagem são conferidas na loja em toda olhada/);
      assert.match(String(estudoNaoCabeNoTipo(tipo, comGatilho)), /não leva contexto nem gatilho/);
      assert.equal(estudoNaoCabeNoTipo(tipo, soTexto), null);
    }
    for (const tipo of CONTRATO.tiposQueUsam) {
      assert.equal(estudoNaoCabeNoTipo(tipo, com), null);
      assert.equal(estudoNaoCabeNoTipo(tipo, comGatilho), null);
    }
  });

  it('para o agente só desce o estudo confirmado, de critério que usa estudo', () => {
    const e = { contexto: [{ sinal: 'pessoa', onde: 'aqui' }], gatilho: [{ sinal: 'a_cada', minutos: 5 }] };
    assert.deepEqual(estudoParaOAgente('estado', { ...e, confirmado: true }), e);
    assert.equal(estudoParaOAgente('estado', { ...e, confirmado: false }), null, 'proposto e não confirmado não muda o que a loja faz');
    assert.equal(estudoParaOAgente('estado', null), null);
    assert.equal(estudoParaOAgente('estado', undefined), null);
    for (const tipo of ['presenca', 'contagem']) assert.equal(estudoParaOAgente(tipo, { ...e, confirmado: true }), null);
    for (const tipo of CONTRATO.tiposQueUsam) assert.deepEqual(estudoParaOAgente(tipo, { ...e, confirmado: true }), e);
    // Estudo confirmado e vazio DESCE: é "confere em toda olhada", e manda no lugar do porteiro.
    assert.deepEqual(estudoParaOAgente('acao', { contexto: [], gatilho: [], confirmado: true }), { contexto: [], gatilho: [] });
    assert.deepEqual(estudoParaOAgente('acao', { contexto: null, gatilho: 'x', confirmado: true }), { contexto: [], gatilho: [] });
  });
});

describe('o funil — a conta', () => {
  const doContrato: SomaDoFunil = {
    capturas: RESUMO.capturas as number, semJuiz: RESUMO.semJuiz as number, semQuadro: RESUMO.semQuadro as number,
    semCena: RESUMO.semCena as number, semCondicao: RESUMO.semCondicao as number, semGatilho: RESUMO.semGatilho as number,
    observadas: RESUMO.observadas as number, emSilencio: RESUMO.emSilencio as number, repetidas: RESUMO.repetidas as number,
    jaJulgadas: RESUMO.jaJulgadas as number, enfileiradas: RESUMO.enfileiradas as number,
    conformes: RESUMO.conformes as number, naoConformes: RESUMO.naoConformes as number, naoAvaliaveis: RESUMO.naoAvaliaveis as number,
    julgadasLoja: RESUMO.julgadasLoja as number, julgadasNuvem: RESUMO.julgadasNuvem as number, custoCentavos: RESUMO.custoCentavos as number,
  };

  it('o contrato do resumo traz semGatilho, e agente antigo continua aceito', () => {
    assert.equal(RESUMO.semGatilho, 4);
    assert.equal(validarResumo(RESUMO, 0), null);
    const { semGatilho: _, ...antigo } = RESUMO;
    assert.equal(validarResumo(antigo, 0), null);
    for (const ruim of [-1, 1.5, '4', 100_001]) {
      assert.match(String(validarResumo({ ...RESUMO, semGatilho: ruim }, 0)), /resumos\[0\]\.semGatilho: inteiro de 0 a 100000/, String(ruim));
    }
  });

  it('toda olhada termina num desfecho só: as parcelas somam as olhadas', () => {
    const f = montarFunil(doContrato, { naLoja: 3, naNuvem: 20 });
    assert.deepEqual(f, {
      olhadas: 126, semJuiz: 0, semImagem: 5, emSilencio: 10, semContexto: 6,
      comContexto: 105, semGatilho: 4, comGatilho: 101,
      julgadas: 23, naLoja: 3, naNuvem: 20, foraDoCriterio: 2, custoCentavos: 24.61,
    });
    assert.equal(f.semJuiz + f.semImagem + f.emSilencio + f.semContexto + f.semGatilho + f.comGatilho, f.olhadas);
    assert.equal(f.comContexto, f.semGatilho + f.comGatilho);
    assert.equal(f.naLoja + f.naNuvem, f.julgadas);
    assert.ok(f.olhadas >= f.comContexto && f.comContexto >= f.comGatilho, 'é um funil: cada degrau cabe no anterior');
  });

  it('cada parcela vem do seu contador', () => {
    const so = (campo: keyof SomaDoFunil) => montarFunil({ ...zerado(), [campo]: 7 }, { naLoja: 0, naNuvem: 0 });
    const zerado = (): SomaDoFunil => Object.fromEntries(Object.keys(doContrato).map((k) => [k, 0])) as SomaDoFunil;
    assert.equal(so('capturas').olhadas, 7);
    assert.equal(so('semJuiz').semJuiz, 7);
    assert.equal(so('semQuadro').semImagem, 7);
    assert.equal(so('semCena').semImagem, 7);
    assert.equal(so('emSilencio').emSilencio, 7);
    assert.equal(so('semCondicao').semContexto, 7);
    assert.deepEqual([so('semGatilho').semGatilho, so('semGatilho').comContexto, so('semGatilho').comGatilho], [7, 7, 0]);
    for (const campo of ['observadas', 'repetidas', 'jaJulgadas', 'enfileiradas'] as const) {
      assert.deepEqual([so(campo).comGatilho, so(campo).comContexto, so(campo).semGatilho], [7, 7, 0], campo);
    }
    for (const campo of ['conformes', 'naoConformes', 'naoAvaliaveis'] as const) assert.equal(so(campo).julgadas, 7, campo);
    assert.deepEqual([so('naoConformes').foraDoCriterio, so('conformes').foraDoCriterio], [7, 0]);
    assert.equal(so('custoCentavos').custoCentavos, 7);
    // Só o que não chegou a ser considerado fica fora de "com contexto".
    for (const campo of ['semJuiz', 'semQuadro', 'semCena', 'emSilencio', 'semCondicao'] as const) assert.equal(so(campo).comContexto, 0, campo);
  });

  it('os gatilhos por dia são a média dos dias inteiros; hoje só entra quando é o único', () => {
    const dias = [
      { dia: '2026-10-07', olhadas: 2880, comGatilho: 100 },
      { dia: '2026-10-08', olhadas: 2880, comGatilho: 140 },
      { dia: '2026-10-09', olhadas: 300, comGatilho: 9 },
    ];
    assert.deepEqual(mediaDeGatilhosPorDia(dias, '2026-10-09'), { gatilhosPorDia: 120, diasNaMedia: 2, parcial: false });
    assert.deepEqual(mediaDeGatilhosPorDia(dias.slice(2), '2026-10-09'), { gatilhosPorDia: 9, diasNaMedia: 1, parcial: true });
    assert.deepEqual(mediaDeGatilhosPorDia(dias, '2026-10-10'), { gatilhosPorDia: 83, diasNaMedia: 3, parcial: false });
    // Dia sem olhada (a loja fechou, o agente parou) não puxa a média para baixo.
    const comBuraco = [dias[0]!, { dia: '2026-10-08', olhadas: 0, comGatilho: 0 }, dias[2]!];
    assert.deepEqual(mediaDeGatilhosPorDia(comBuraco, '2026-10-09'), { gatilhosPorDia: 100, diasNaMedia: 1, parcial: false });
    assert.deepEqual(mediaDeGatilhosPorDia([], '2026-10-09'), { gatilhosPorDia: 0, diasNaMedia: 0, parcial: false });
    assert.deepEqual(mediaDeGatilhosPorDia([{ dia: '2026-10-09', olhadas: 0, comGatilho: 0 }], '2026-10-09'), { gatilhosPorDia: 0, diasNaMedia: 0, parcial: false });
  });

  it('quanto custaria ligado: o preço é o MEDIDO — do critério, senão da loja, senão não há', () => {
    const base = { gatilhosPorDia: 200, soNaLoja: false };
    assert.deepEqual(
      quantoCustariaLigado({ ...base, doCriterio: { custoCentavos: 30, naNuvem: 100 }, daLoja: { custoCentavos: 900, naNuvem: 1000 } }),
      { gatilhosPorDia: 200, precoDoPedidoCentavos: 0.3, deOndeVemOPreco: 'criterio', tetoPorDiaCentavos: 60, soNaLoja: false },
    );
    assert.deepEqual(
      quantoCustariaLigado({ ...base, doCriterio: { custoCentavos: 0, naNuvem: 0 }, daLoja: { custoCentavos: 900, naNuvem: 1000 } }),
      { gatilhosPorDia: 200, precoDoPedidoCentavos: 0.9, deOndeVemOPreco: 'loja', tetoPorDiaCentavos: 180, soNaLoja: false },
    );
    assert.deepEqual(
      quantoCustariaLigado({ ...base, doCriterio: { custoCentavos: 0, naNuvem: 0 }, daLoja: { custoCentavos: 0, naNuvem: 0 } }),
      { gatilhosPorDia: 200, precoDoPedidoCentavos: null, deOndeVemOPreco: null, tetoPorDiaCentavos: null, soNaLoja: false },
      'sem medida não há preço: nada de número inventado',
    );
    // Conferido só no computador da loja: nunca custa nuvem, tenha a loja o preço que tiver.
    assert.deepEqual(
      quantoCustariaLigado({ gatilhosPorDia: 200, soNaLoja: true, doCriterio: { custoCentavos: 30, naNuvem: 100 }, daLoja: { custoCentavos: 900, naNuvem: 1000 } }),
      { gatilhosPorDia: 200, precoDoPedidoCentavos: 0, deOndeVemOPreco: null, tetoPorDiaCentavos: 0, soNaLoja: true },
    );
  });
});

// ───────────────────────── com o banco ─────────────────────────

describe('o estudo do critério (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  let lojaId = '';
  let pontoId = '';
  let chapa = '';
  let posto = '';
  let outroPonto = '';
  let caixa = '';
  let zonaDoVizinho = '';
  let cookie = '';
  let cookiePresidente = '';
  let cookieSupervisao = '';
  let cookieExecucao = '';
  let cookieVizinho = '';
  let token = '';

  async function entrar(tenant: string, email: string, nivel: string) {
    await app.inject({
      method: 'POST', url: '/v1/distribuicao/usuarios', headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId: tenant, nome: 'X', email, senha: SENHA, nivel },
    });
    const r = await app.inject({ method: 'POST', url: '/v1/sessao', payload: { email, senha: SENHA } });
    const b = r.headers['set-cookie'];
    return (Array.isArray(b) ? b[0]! : String(b)).split(';')[0]!;
  }

  /** Um critério LIGADO nos quadros dados (o primeiro é a chapa). */
  async function criterio(nome: string, corpo: Record<string, unknown> = {}, zonas: string[] = [chapa]): Promise<string> {
    const r = await app.inject({
      method: 'POST', url: `/v1/lojas/${lojaId}/regras`, headers: { cookie },
      payload: { nome: `${nome} ${marca}`, tipo: 'estado', criterio: 'Toda carne posta na chapa é salgada.', zonaIds: zonas, quando: 'sempre', ...corpo },
    });
    assert.equal(r.statusCode, 201, r.body);
    const id = r.json().id as string;
    const ligar = await app.inject({ method: 'PATCH', url: `/v1/regras/${id}`, headers: { cookie }, payload: { ativa: true } });
    assert.equal(ligar.statusCode, 200, ligar.body);
    return id;
  }

  const ler = (id: string, comCookie = cookie) =>
    app.inject({ method: 'GET', url: `/v1/regras/${id}/estudo`, headers: { cookie: comCookie } });
  const gravar = (id: string, corpo: unknown, comCookie = cookie) =>
    app.inject({ method: 'PUT', url: `/v1/regras/${id}/estudo`, headers: { cookie: comCookie }, payload: corpo as object });
  const tirar = (id: string, comCookie = cookie) =>
    app.inject({ method: 'DELETE', url: `/v1/regras/${id}/estudo`, headers: { cookie: comCookie } });
  const funil = (id: string, dias?: string, comCookie = cookieSupervisao) =>
    app.inject({ method: 'GET', url: `/v1/regras/${id}/funil${dias === undefined ? '' : `?dias=${dias}`}`, headers: { cookie: comCookie } });
  const versao = async () => (await pool.query(`select config_versao from loja where id = $1`, [lojaId])).rows[0].config_versao as number;
  const noBanco = async (id: string) => (await pool.query(`select * from regra_estudo where regra_id = $1`, [id])).rows;

  const doAgente = (metodo: 'GET' | 'POST', url: string, payload?: unknown) =>
    app.inject({ method: metodo, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });
  /** O critério como o agente recebe, debaixo de um quadro. `sabe` é o que ele declara. */
  async function noAgente(id: string, sabe: string | undefined, zona = chapa): Promise<Record<string, unknown> | undefined> {
    const r = await doAgente('GET', `/v1/agentes/configuracao${sabe === undefined ? '' : `?sabe=${sabe}`}`);
    assert.equal(r.statusCode, 200, r.body);
    for (const p of r.json().pontos) {
      const z = p.zonas.find((x: { id: string }) => x.id === zona);
      if (z) return z.regras.find((x: { id: string }) => x.id === id);
    }
    return undefined;
  }

  /** O estudo do exemplo do dono: carne na chapa E colaborador no posto; abre quando a carne é posta. */
  const doDono = () => ({
    partes: {
      contexto: 'Há carne na chapa e há colaborador no posto.',
      gatilho: 'Uma carne acabou de ser posta.',
      janela: 'Até a carne ser virada ou tirada.',
      acao: 'O gesto de salgar sobre a carne.',
      desfecho: 'Salgou: dentro. A janela fechou sem salgar: fora. A mão tapou: não deu para ver.',
      fora: 'Sem carne na chapa, ou sem ninguém no posto, não se julga, não se paga e não conta como análise.',
    },
    contexto: [{ sinal: 'fora_do_padrao', onde: 'aqui' }, { sinal: 'pessoa', onde: 'quadro', zonaId: posto }],
    gatilho: [{ sinal: 'saiu_do_padrao', onde: 'aqui' }, { sinal: 'a_cada', minutos: 10 }],
    confirmado: true,
  });

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
    cookiePresidente = await entrar(conta.tenantId, `pre-${marca}@e.com`, 'presidente');
    cookieSupervisao = await entrar(conta.tenantId, `sup-${marca}@e.com`, 'supervisao');
    cookieExecucao = await entrar(conta.tenantId, `exe-${marca}@e.com`, 'execucao');

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

    // O canal da chapa, com dois quadros além da imagem completa...
    const daChapa = await novoPonto('Chapa', 6);
    pontoId = daChapa.id;
    chapa = await novaArea(pontoId, 'Chapa', [[0.05, 0.1], [0.6, 0.1], [0.6, 0.65], [0.05, 0.65]], 'equipamento');
    posto = await novaArea(pontoId, 'Posto do chapeiro', [[0.05, 0.7], [0.6, 0.7], [0.6, 0.95], [0.05, 0.95]], 'posto');
    // ...e outro canal da mesma loja, em que o critério NÃO vale.
    const doCaixa = await novoPonto('Caixa', 2);
    outroPonto = doCaixa.id;
    caixa = await novaArea(outroPonto, 'Gaveta', [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]], 'caixa');

    const vizinha = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome: `${marca}-vizinha` }, loja: { nome: 'Vizinha' }, setores: [{ nome: 'Cozinha' }] },
    })).json();
    cookieVizinho = await entrar(vizinha.tenantId, `ger-${marca}-viz@e.com`, 'gerente');
    const pontoDoVizinho = (await app.inject({
      method: 'POST', url: `/v1/setores/${vizinha.setores[0].id}/pontos`, headers: { cookie: cookieVizinho },
      payload: { nome: 'Chapa', origem: 'dvr', canal: 6, host: '192.168.1.108' },
    })).json();
    zonaDoVizinho = pontoDoVizinho.zonas[0].id;

    const agente = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/agentes', headers: { 'x-farol-admin': ADMIN },
      payload: { lojaId, nome: 'PC da loja' },
    })).json();
    token = agente.token;
    await doAgente('POST', '/v1/agentes/ativar', { fingerprint: `fp-${marca}` });
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  // ─────────────────────── ler e gravar ───────────────────────

  it('critério sem estudo: a ficha vem vazia, com os quadros dos canais em que ele vale', async () => {
    const id = await criterio('Sem estudo');
    const r = await ler(id);
    assert.equal(r.statusCode, 200, r.body);
    const corpo = r.json();
    assert.deepEqual([corpo.regraId, corpo.tipo, corpo.usaContextoEGatilho, corpo.estudo], [id, 'estado', true, null]);
    assert.equal(corpo.canais.length, 1, 'só o canal da chapa: no do caixa o critério não vale');
    assert.deepEqual([corpo.canais[0].pontoId, corpo.canais[0].nome, corpo.canais[0].canal], [pontoId, 'Chapa', 6]);
    // A imagem completa (sem número) e os dois quadros, numerados como a tela mostra.
    assert.deepEqual(
      corpo.canais[0].quadros.map((q: { nome: string; numero: number | null; papel: string }) => [q.nome, q.numero, q.papel]),
      [['Quadro inteiro', null, 'livre'], ['Chapa', 1, 'equipamento'], ['Posto do chapeiro', 2, 'posto']],
    );
    assert.deepEqual(corpo.canais[0].quadros.slice(1).map((q: { id: string }) => q.id), [chapa, posto]);
    assert.deepEqual(await noBanco(id), [], 'ler não cria nada');
  });

  it('o estudo do exemplo do dono é gravado inteiro, com quem confirmou', async () => {
    const id = await criterio('Salga as carnes');
    const r = await gravar(id, doDono());
    assert.equal(r.statusCode, 200, r.body);
    const e = r.json().estudo;
    assert.deepEqual([e.partes, e.contexto, e.gatilho, e.confirmado], [doDono().partes, doDono().contexto, doDono().gatilho, true]);
    assert.ok(e.confirmadoEm && e.atualizadoEm);

    const [linha] = await noBanco(id);
    assert.deepEqual([linha.partes, linha.contexto, linha.gatilho], [doDono().partes, doDono().contexto, doDono().gatilho]);
    const autor = (await pool.query(`select email from usuario where id = $1`, [linha.confirmado_por])).rows[0].email;
    assert.equal(autor, `ger-${marca}@e.com`);

    const relido = (await ler(id)).json();
    assert.deepEqual(relido.estudo, e, 'ler devolve o que gravar devolveu');
  });

  it('gravar de novo o mesmo estudo não muda quem confirmou; mudar o gatilho, sim; desconfirmar apaga', async () => {
    const id = await criterio('Confirmação');
    await gravar(id, doDono());
    const [primeira] = await noBanco(id);

    // A presidente salva sem mexer (a tela manda a ficha inteira): a confirmação continua a do gerente.
    assert.equal((await gravar(id, doDono(), cookiePresidente)).statusCode, 200);
    const [igual] = await noBanco(id);
    assert.deepEqual([igual.confirmado_por, igual.confirmado_em], [primeira.confirmado_por, primeira.confirmado_em]);

    // Corrigir só um TEXTO também não é confirmar de novo.
    await gravar(id, { ...doDono(), partes: { ...doDono().partes, acao: 'O saleiro sai do lugar e volta.' } }, cookiePresidente);
    const [comTexto] = await noBanco(id);
    assert.equal(comTexto.partes.acao, 'O saleiro sai do lugar e volta.');
    assert.deepEqual([comTexto.confirmado_por, comTexto.confirmado_em], [primeira.confirmado_por, primeira.confirmado_em]);

    // Mudou o que foi confirmado: a confirmação é de quem mudou, e de agora.
    await gravar(id, { ...doDono(), gatilho: [{ sinal: 'a_cada', minutos: 5 }] }, cookiePresidente);
    const [outra] = await noBanco(id);
    assert.notEqual(outra.confirmado_por, primeira.confirmado_por);
    assert.ok(outra.confirmado_em > primeira.confirmado_em);

    // O contexto também é "o que foi confirmado".
    await gravar(id, { ...doDono(), gatilho: [{ sinal: 'a_cada', minutos: 5 }], contexto: [{ sinal: 'pessoa', onde: 'canal' }] });
    const [maisUma] = await noBanco(id);
    assert.notEqual(maisUma.confirmado_por, outra.confirmado_por);

    const semConfirmar = await gravar(id, { ...doDono(), confirmado: false });
    assert.deepEqual([semConfirmar.json().estudo.confirmado, semConfirmar.json().estudo.confirmadoEm], [false, null]);
    const [aberta] = await noBanco(id);
    assert.deepEqual([aberta.confirmado_em, aberta.confirmado_por], [null, null]);

    // E confirmar depois de desconfirmar é confirmação nova, mesmo com o conteúdo igual.
    await gravar(id, doDono(), cookiePresidente);
    const [deVolta] = await noBanco(id);
    assert.ok(deVolta.confirmado_em !== null && deVolta.confirmado_por !== primeira.confirmado_por);
  });

  it('ficha que não cabe é recusada dizendo por quê, e nada muda', async () => {
    const id = await criterio('Recusas');
    await gravar(id, doDono());
    const [antes] = await noBanco(id);
    const v = await versao();

    const recusas: [unknown, RegExp][] = [
      [{ ...doDono(), contexto: [{ sinal: 'forno_quente' }] }, /contexto\[0\]\.sinal/],
      [{ ...doDono(), gatilho: [{ sinal: 'a_cada', minutos: 0 }] }, /minutos: inteiro de 1 a 720/],
      [{ ...doDono(), contexto: [{ sinal: 'pessoa' }, { sinal: 'sem_pessoa' }] }, /nunca valem juntos/],
      [{ ...doDono(), partes: { resumo: 'x' } }, /parte desconhecida/],
      // Quadro de outro canal da MESMA loja: o critério não vale lá, não há como conferir na mesma olhada.
      [{ ...doDono(), contexto: [{ sinal: 'pessoa', onde: 'quadro', zonaId: caixa }] }, /há quadro citado que não é de um canal deste critério/],
      [{ ...doDono(), gatilho: [{ sinal: 'entrou', onde: 'quadro', zonaId: caixa }] }, /não é de um canal deste critério/],
      // Quadro de outra conta, e quadro que não existe.
      [{ ...doDono(), contexto: [{ sinal: 'pessoa', onde: 'quadro', zonaId: zonaDoVizinho }] }, /não é de um canal deste critério/],
      [{ ...doDono(), contexto: [{ sinal: 'pessoa', onde: 'quadro', zonaId: randomUUID() }] }, /não é de um canal deste critério/],
    ];
    for (const [corpo, motivo] of recusas) {
      const r = await gravar(id, corpo);
      assert.equal(r.statusCode, 422, r.body);
      assert.equal(r.json().erro, 'validacao');
      assert.match(r.json().mensagem, motivo);
    }
    assert.deepEqual((await noBanco(id))[0], antes, 'nenhuma recusa mudou a ficha');
    assert.equal(await versao(), v, 'nem a versão da configuração');

    // Quadro excluído deixa de poder ser citado.
    const some = (await app.inject({
      method: 'POST', url: `/v1/pontos/${pontoId}/zonas`, headers: { cookie },
      payload: { nome: 'Vai sumir', poligono: [[0.7, 0.1], [0.9, 0.1], [0.9, 0.3], [0.7, 0.3]] },
    })).json().id as string;
    const citaDuasVezes = { ...doDono(), contexto: [{ sinal: 'pessoa', onde: 'quadro', zonaId: some }], gatilho: [{ sinal: 'entrou', onde: 'quadro', zonaId: some }] };
    assert.equal((await gravar(id, citaDuasVezes)).statusCode, 200, 'o mesmo quadro no contexto e no gatilho');
    const nomes = async () => (await ler(id)).json().canais[0].quadros.map((q: { nome: string }) => q.nome);
    assert.ok((await nomes()).includes('Vai sumir'));
    assert.equal((await app.inject({ method: 'DELETE', url: `/v1/zonas/${some}`, headers: { cookie } })).statusCode < 300, true);
    assert.equal((await nomes()).includes('Vai sumir'), false, 'quadro excluído não é oferecido');
    assert.equal((await gravar(id, { ...doDono(), contexto: [{ sinal: 'pessoa', onde: 'quadro', zonaId: some }] })).statusCode, 422);
  });

  it('presença e contagem guardam os textos, e recusam contexto e gatilho', async () => {
    const id = await criterio('Presença na montagem', { tipo: 'presenca', criterio: 'Há alguém no posto.', parametros: { objeto: 'pessoa', minimo: 1 } }, [posto]);
    const comCondicao = await gravar(id, { contexto: [{ sinal: 'pessoa' }], confirmado: true });
    assert.equal(comCondicao.statusCode, 422, comCondicao.body);
    assert.match(comCondicao.json().mensagem, /presença e contagem são conferidas na loja em toda olhada/);
    assert.deepEqual(await noBanco(id), []);

    const soTexto = await gravar(id, { partes: { contexto: 'A loja está aberta.', acao: 'Contar as pessoas no posto.' }, confirmado: true });
    assert.equal(soTexto.statusCode, 200, soTexto.body);
    assert.equal((await ler(id)).json().usaContextoEGatilho, false);
    // Confirmado, mas não há o que o agente conferir: não desce.
    assert.equal((await noAgente(id, 'estados,estudo', posto))!.estudo, undefined);
  });

  it('critério em dois canais: os quadros dos dois podem ser citados', async () => {
    const id = await criterio('Nos dois canais', {}, [chapa, caixa]);
    const corpo = (await ler(id)).json();
    assert.deepEqual(corpo.canais.map((c: { pontoId: string }) => c.pontoId).sort(), [pontoId, outroPonto].sort());
    const estudo = { contexto: [{ sinal: 'pessoa', onde: 'quadro', zonaId: posto }, { sinal: 'sem_pessoa', onde: 'quadro', zonaId: caixa }], confirmado: true };
    assert.equal((await gravar(id, estudo)).statusCode, 200);
    // O estudo desce igual debaixo dos dois quadros: o agente, em cada canal, não acha o quadro do
    // outro e por isso não o deixa segurar a análise.
    const naChapa = await noAgente(id, 'estados,estudo', chapa);
    const noCaixa = await noAgente(id, 'estados,estudo', caixa);
    assert.deepEqual(naChapa!.estudo, { contexto: estudo.contexto, gatilho: [] });
    assert.deepEqual(noCaixa!.estudo, naChapa!.estudo);
  });

  // ─────────────────────── quem pode ───────────────────────

  it('só quem configura grava e tira; outra conta nem sabe que o critério existe', async () => {
    const id = await criterio('Quem pode');
    for (const [quem, comCookie] of [['supervisão', cookieSupervisao], ['execução', cookieExecucao]] as const) {
      assert.equal((await gravar(id, doDono(), comCookie)).statusCode, 403, quem);
      assert.equal((await tirar(id, comCookie)).statusCode, 403, quem);
      assert.equal((await ler(id, comCookie)).statusCode, 200, `${quem} lê a ficha, como lê o critério`);
    }
    assert.deepEqual(await noBanco(id), []);
    assert.equal((await gravar(id, doDono(), cookiePresidente)).statusCode, 200);

    for (const pedido of [ler(id, cookieVizinho), gravar(id, doDono(), cookieVizinho), tirar(id, cookieVizinho), funil(id, undefined, cookieVizinho)]) {
      const r = await pedido;
      assert.equal(r.statusCode, 404, r.body);
      assert.equal(r.json().erro, 'nao_encontrada');
    }
    assert.equal((await noBanco(id)).length, 1, 'o vizinho não tirou nada');

    for (const pedido of [ler(id, ''), gravar(id, doDono(), ''), tirar(id, ''), funil(id, undefined, '')]) {
      assert.equal((await pedido).statusCode, 401);
    }
    for (const torto of ['nao-e-uuid', randomUUID()]) {
      assert.equal((await ler(torto)).statusCode, 404);
      assert.equal((await gravar(torto, doDono())).statusCode, 404);
      assert.equal((await tirar(torto)).statusCode, 404);
      assert.equal((await funil(torto)).statusCode, 404);
    }

    // O funil é como as análises: supervisão para cima.
    assert.equal((await funil(id, undefined, cookieExecucao)).statusCode, 403);
    for (const comCookie of [cookieSupervisao, cookie, cookiePresidente]) assert.equal((await funil(id, undefined, comCookie)).statusCode, 200);
  });

  // ─────────────────────── o que desce para o agente ───────────────────────

  it('o estudo confirmado desce para o agente que declara saber; para os outros, nem o campo', async () => {
    const id = await criterio('Desce');
    assert.equal((await noAgente(id, 'estados,estudo'))!.estudo, undefined, 'sem estudo, sem campo');

    await gravar(id, { ...doDono(), confirmado: false });
    assert.equal((await noAgente(id, 'estados,estudo'))!.estudo, undefined, 'proposto e não confirmado não muda o que a loja faz');

    await gravar(id, doDono());
    const comEstudo = await noAgente(id, 'estados,estudo');
    assert.deepEqual(comEstudo!.estudo, { contexto: doDono().contexto, gatilho: doDono().gatilho }, 'só o que o agente confere: os textos ficam na nuvem');
    assert.deepEqual(Object.keys(comEstudo!.estudo as object).sort(), Object.keys(CONTRATO.configuracao.regra.estudo).sort());
    assert.deepEqual((await noAgente(id, `outra,${CONTRATO.sabe}`))!.estudo, comEstudo!.estudo);

    // O agente de antes: recebe o critério como sempre, com o porteiro, e sem o campo novo.
    for (const sabe of [undefined, '', 'estados', 'ESTUDO', 'estudos']) {
      const antigo = await noAgente(id, sabe);
      assert.ok(antigo, `o critério desce (${sabe})`);
      assert.equal('estudo' in antigo!, false, `sabe=${sabe}`);
      assert.equal(antigo!.porteiro, 'sempre');
    }

    // Tirar o estudo: volta o "quando vale a pena conferir" de sempre.
    const tirado = await tirar(id);
    assert.deepEqual([tirado.statusCode, tirado.json()], [200, { regraId: id, removido: true }]);
    assert.equal((await noAgente(id, 'estados,estudo'))!.estudo, undefined);
    assert.deepEqual((await tirar(id)).json(), { regraId: id, removido: false }, 'tirar de novo não é erro');
    assert.equal((await ler(id)).json().estudo, null);
  });

  it('mexer no que o agente usa faz a loja puxar a configuração; corrigir um texto, não', async () => {
    const id = await criterio('Versão');
    let v = await versao();
    const subiu = async (oQue: string) => {
      const agora = await versao();
      assert.ok(agora > v, `${oQue}: a versão tem de subir`);
      v = agora;
    };
    const ficou = async (oQue: string) => assert.equal(await versao(), v, `${oQue}: a versão não pode subir`);

    await gravar(id, doDono());
    await subiu('estudo novo, confirmado');
    await gravar(id, doDono());
    await ficou('salvar sem mexer');
    await gravar(id, { ...doDono(), partes: { ...doDono().partes, acao: 'Outro texto.' } });
    await ficou('corrigir o texto de uma parte');
    await gravar(id, { ...doDono(), gatilho: [{ sinal: 'a_cada', minutos: 15 }] });
    await subiu('mudar o gatilho');
    await gravar(id, { ...doDono(), gatilho: [{ sinal: 'a_cada', minutos: 15 }], contexto: [] });
    await subiu('mudar o contexto');
    await gravar(id, { ...doDono(), gatilho: [{ sinal: 'a_cada', minutos: 15 }], contexto: [], confirmado: false });
    await subiu('desconfirmar');
    await tirar(id);
    await subiu('tirar o estudo');
    await tirar(id);
    await ficou('tirar o que não existe');
  });

  it('critério excluído não tem ficha nem funil', async () => {
    const id = await criterio('Vai ser excluído');
    assert.equal((await gravar(id, doDono())).statusCode, 200);
    assert.equal((await app.inject({ method: 'DELETE', url: `/v1/regras/${id}`, headers: { cookie } })).statusCode, 200);
    for (const pedido of [ler(id), gravar(id, doDono()), tirar(id), funil(id)]) {
      const r = await pedido;
      assert.equal(r.statusCode, 404, r.body);
    }
    assert.equal((await noBanco(id)).length, 1, 'a ficha fica guardada com o histórico; só não é mais alcançada');
  });

  it('apagar o critério leva o estudo junto', async () => {
    const id = await criterio('Vai embora');
    await gravar(id, doDono());
    assert.equal((await noBanco(id)).length, 1);
    await pool.query('delete from regra where id = $1', [id]);
    assert.deepEqual(await noBanco(id), []);
  });

  // ─────────────────────── o resumo e o funil ───────────────────────

  const zeros = {
    capturas: 0, semJuiz: 0, semQuadro: 0, semCena: 0, semCondicao: 0, semGatilho: 0, observadas: 0, emSilencio: 0, repetidas: 0,
    jaJulgadas: 0, enfileiradas: 0, conformes: 0, naoConformes: 0, naoAvaliaveis: 0, falhas: 0, alertas: 0,
    somaConfianca: 0, comConfianca: 0, somaLatenciaMs: 0, comLatencia: 0, custoCentavos: 0,
    julgadasLoja: 0, julgadasNuvem: 0, somaMedida: 0, comMedida: 0, maxMedida: null, extras: 0, extrasFora: 0,
    ultimoResultado: null, ultimoMotivo: null, ultimoImpedimento: null, ultimaEm: null,
  };
  const mandar = (linhas: Record<string, unknown>[]) => doAgente('POST', '/v1/resumos', { resumos: linhas });
  /** Uma hora cheia, no relógio da loja: `dia` conta de hoje para trás. */
  async function hora(dia: number, h: number): Promise<{ hora: string; dia: string }> {
    const { rows } = await pool.query(
      `select to_char(d, 'YYYY-MM-DD') as dia,
              to_char(((d + make_interval(hours => $3)) at time zone l.timezone) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"') as hora
         from loja l, lateral (select (now() at time zone l.timezone)::date - $2::integer as d) x
        where l.id = $1`,
      [lojaId, dia, h],
    );
    return rows[0];
  }

  it('a olhada sem gatilho chega ao resumo e às análises com o número do agente', async () => {
    const id = await criterio('Resumo');
    const agora = await hora(0, 0);
    const linha = { ...zeros, regraId: id, zonaId: chapa, hora: agora.hora, capturas: 120, semCondicao: 30, semGatilho: 70, observadas: 20 };
    const r = await mandar([linha]);
    assert.deepEqual([r.statusCode, r.json()], [200, { aceitos: 1, recusados: [] }], r.body);
    const gravada = async () => (await pool.query(`select capturas, sem_condicao, sem_gatilho, observadas from resumo_hora where regra_id = $1`, [id])).rows[0];
    assert.deepEqual(await gravada(), { capturas: 120, sem_condicao: 30, sem_gatilho: 70, observadas: 20 });

    // A mesma linha de novo, com o acumulado maior: substitui, não soma.
    await mandar([{ ...linha, capturas: 124, semGatilho: 73, observadas: 21 }]);
    assert.deepEqual(await gravada(), { capturas: 124, sem_condicao: 30, sem_gatilho: 73, observadas: 21 });

    // Agente antigo não manda o campo: entra como zero.
    const outro = await criterio('Resumo antigo');
    const { semGatilho: _, ...semOCampo } = { ...linha, regraId: outro };
    assert.equal((await mandar([semOCampo])).statusCode, 200);
    assert.equal((await pool.query(`select sem_gatilho from resumo_hora where regra_id = $1`, [outro])).rows[0].sem_gatilho, 0);

    const analises = (await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}/analises`, headers: { cookie: cookiePresidente } })).json();
    const celula = analises.celulas.find((c: { regraId: string }) => c.regraId === id);
    assert.deepEqual([celula.capturas, celula.semCondicao, celula.semGatilho, celula.observadas], [124, 30, 73, 21]);
  });

  it('o funil de um critério que só observa: os números, por dia e por quadro, e quanto custaria ligado', async () => {
    // Um critério observando nos DOIS quadros do canal, com estudo confirmado.
    const id = await criterio('Funil', { estado: 'observando' }, [chapa, posto]);
    await gravar(id, { contexto: [{ sinal: 'pessoa', onde: 'aqui' }], gatilho: [{ sinal: 'a_cada', minutos: 10 }], confirmado: true });

    // 22h no relógio da loja já é o dia seguinte em UTC: o dia do funil tem de ser o DELA.
    const [anteontem, ontem, hoje] = [await hora(2, 22), await hora(1, 22), await hora(0, 0)];
    const linha = (zona: string, quando: { hora: string }, n: Partial<typeof zeros>) => ({ ...zeros, regraId: id, zonaId: zona, hora: quando.hora, ...n });
    const r = await mandar([
      linha(chapa, anteontem, { capturas: 100, semCena: 2, semQuadro: 1, semCondicao: 37, semGatilho: 50, observadas: 10 }),
      linha(chapa, ontem, { capturas: 120, semCondicao: 40, semGatilho: 60, observadas: 20 }),
      linha(posto, ontem, { capturas: 120, semCondicao: 90, semGatilho: 24, observadas: 6 }),
      linha(chapa, hoje, { capturas: 30, semCondicao: 10, semGatilho: 17, observadas: 3 }),
    ]);
    assert.deepEqual(r.json(), { aceitos: 4, recusados: [] }, r.body);

    const f = (await funil(id)).json();
    assert.deepEqual([f.regraId, f.tipo, f.estado, f.temEstudo, f.dias, f.hoje], [id, 'estado', 'observando', true, 7, hoje.dia]);
    assert.equal(f.nome, `Funil ${marca}`);
    assert.deepEqual(f.total, {
      olhadas: 370, semJuiz: 0, semImagem: 3, emSilencio: 0, semContexto: 177, comContexto: 190, semGatilho: 151, comGatilho: 39,
      julgadas: 0, naLoja: 0, naNuvem: 0, foraDoCriterio: 0, custoCentavos: 0,
    });
    assert.equal(f.total.semJuiz + f.total.semImagem + f.total.emSilencio + f.total.semContexto + f.total.semGatilho + f.total.comGatilho, f.total.olhadas);

    const porQuadro = Object.fromEntries(f.porQuadro.map((q: { zonaId: string; pontoId: string; olhadas: number; comGatilho: number }) => [q.zonaId, [q.pontoId, q.olhadas, q.comGatilho]]));
    assert.deepEqual(porQuadro, { [chapa]: [pontoId, 250, 33], [posto]: [pontoId, 120, 6] });
    assert.deepEqual(
      f.porDia.map((d: { dia: string; olhadas: number; comContexto: number; comGatilho: number }) => [d.dia, d.olhadas, d.comContexto, d.comGatilho]),
      [[anteontem.dia, 100, 60, 10], [ontem.dia, 240, 110, 26], [hoje.dia, 30, 20, 3]],
    );

    // Gatilhos por dia: a média dos dois dias inteiros (10 e 26). Hoje ainda não acabou.
    // A loja nunca pagou uma análise: não há preço, e o teto não é inventado.
    assert.deepEqual(f.seLigado, {
      gatilhosPorDia: 18, precoDoPedidoCentavos: null, deOndeVemOPreco: null, tetoPorDiaCentavos: null, soNaLoja: false,
      diasNaMedia: 2, parcial: false,
    });

    // Só hoje: a média é do dia que ainda não acabou, e o funil diz isso.
    const soHoje = (await funil(id, '1')).json();
    assert.deepEqual([soHoje.dias, soHoje.total.olhadas, soHoje.porDia.length], [1, 30, 1]);
    assert.deepEqual([soHoje.seLigado.gatilhosPorDia, soHoje.seLigado.diasNaMedia, soHoje.seLigado.parcial], [3, 1, true]);
    // Dois dias: ontem e hoje.
    assert.equal((await funil(id, '2')).json().total.olhadas, 270);

    // Outro critério da loja pagou 50 análises na nuvem a 0,4 centavo: é o preço MEDIDO da loja.
    const pago = await criterio('Já paga');
    assert.equal((await mandar([{
      ...zeros, regraId: pago, zonaId: chapa, hora: ontem.hora, capturas: 50, enfileiradas: 50, conformes: 50,
      julgadasNuvem: 50, comConfianca: 50, somaConfianca: 45, custoCentavos: 20,
    }])).statusCode, 200);
    const comPreco = (await funil(id)).json().seLigado;
    assert.deepEqual([comPreco.precoDoPedidoCentavos, comPreco.deOndeVemOPreco], [0.4, 'loja']);
    assert.ok(Math.abs(comPreco.tetoPorDiaCentavos - 7.2) < 1e-9, 'teto: 18 gatilhos por dia × 0,4 centavo');

    // O critério que já pagou usa o preço DELE, e o funil dele mostra o que foi julgado e onde.
    const doPago = (await funil(pago)).json();
    assert.deepEqual([doPago.temEstudo, doPago.total.comGatilho, doPago.total.julgadas, doPago.total.naNuvem, doPago.total.naLoja], [false, 50, 50, 50, 0]);
    assert.deepEqual([doPago.seLigado.precoDoPedidoCentavos, doPago.seLigado.deOndeVemOPreco], [0.4, 'criterio']);
  });

  it('estudo ainda não confirmado: o funil diz que o critério segue sem estudo', async () => {
    const id = await criterio('Proposto');
    assert.equal((await funil(id)).json().temEstudo, false);
    await gravar(id, { ...doDono(), confirmado: false });
    assert.equal((await funil(id)).json().temEstudo, false);
    await gravar(id, doDono());
    assert.equal((await funil(id)).json().temEstudo, true);
  });

  it('o preço medido é o dos últimos 30 dias — do critério e da loja', async () => {
    // Este critério pagou caro, mas há 40 dias: não é mais o preço dele, nem entra no da loja.
    // (O da loja é o 0,4 centavo do critério "Já paga", do teste acima.)
    const id = await criterio('Pagou faz tempo');
    const faz40 = await hora(40, 12);
    assert.equal((await mandar([{
      ...zeros, regraId: id, zonaId: chapa, hora: faz40.hora, capturas: 10, enfileiradas: 10, conformes: 10,
      julgadasNuvem: 10, comConfianca: 10, somaConfianca: 9, custoCentavos: 100,
    }])).statusCode, 200);
    const s = (await funil(id)).json().seLigado;
    assert.deepEqual([s.precoDoPedidoCentavos, s.deOndeVemOPreco], [0.4, 'loja']);
  });

  it('contagem nunca custa nuvem; e em loja de modo local, nada custa', async () => {
    const contagem = await criterio('Fila no caixa', { tipo: 'contagem', criterio: 'No máximo três na fila.', parametros: { objeto: 'pessoa', maximo: 3 } }, [posto]);
    assert.deepEqual([(await funil(contagem)).json().seLigado.soNaLoja, (await funil(contagem)).json().seLigado.tetoPorDiaCentavos], [true, 0]);

    const estado = await criterio('De estado');
    assert.equal((await funil(estado)).json().seLigado.soNaLoja, false);
    await pool.query(`update loja set modo_julgamento = 'local' where id = $1`, [lojaId]);
    try {
      const s = (await funil(estado)).json().seLigado;
      assert.deepEqual([s.soNaLoja, s.tetoPorDiaCentavos], [true, 0], 'de loja em modo local nada sai');
    } finally {
      await pool.query(`update loja set modo_julgamento = 'nuvem' where id = $1`, [lojaId]);
    }
  });

  it('presença nunca custa nuvem; e o intervalo pedido é conferido', async () => {
    const id = await criterio('Presença', { tipo: 'presenca', criterio: 'Há alguém no posto.', parametros: { objeto: 'pessoa', minimo: 1 } }, [posto]);
    const f = (await funil(id)).json();
    assert.deepEqual(f.total.olhadas, 0, 'critério sem olhada: funil zerado, não erro');
    assert.deepEqual([f.seLigado.soNaLoja, f.seLigado.tetoPorDiaCentavos, f.seLigado.gatilhosPorDia, f.seLigado.diasNaMedia], [true, 0, 0, 0]);
    assert.deepEqual([f.porDia, f.porQuadro], [[], []]);

    for (const torto of ['0', '32', '-1', 'sete', '1.5', '', '007']) {
      const r = await funil(id, torto);
      assert.equal(r.statusCode, 400, `dias=${torto}: ${r.body}`);
      assert.equal(r.json().erro, 'intervalo_invalido');
    }
    for (const bom of ['1', '31', '07']) assert.equal((await funil(id, bom)).statusCode, 200, bom);
  });
});
