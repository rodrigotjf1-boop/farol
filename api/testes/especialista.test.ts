// O especialista (A16, fase 5): o padrão de funcionamento da loja, tirado dos
// números guardados por hora.
//
// A primeira parte não usa banco: uma loja de mentira com quatro semanas de
// números, em que cada coisa fora do padrão foi posta de propósito — e o
// teste exige que o motor ache exatamente essas, e nenhuma outra.
//
//   - o dia é o da operação, e o padrão é dos 28 dias antes de hoje;
//   - a taxa é da ROTINA (a olhada extra do vigia não entra);
//   - a semana típica, o pico e a descrição de cada setor;
//   - a saída do padrão: muito diferente do normal daquele dia e hora, nos
//     dois sentidos para a medida e só para cima nas taxas;
//   - o que o responsável respondeu: "foi só desta vez" e "é problema" ficam
//     de fora da conta do padrão;
//   - o que anda junto, comparado dentro da mesma hora do dia;
//   - a tendência semana a semana, e hoje contra o normal;
//   - as sugestões sobre os próprios critérios.
//
// A segunda parte usa o Postgres: a rota, o dia da operação cortado no fuso
// da loja dentro do banco, quem vê e quem responde, e a resposta do
// responsável — uma por hora, mesmo com duas pessoas respondendo juntas.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { entradaDoEspecialista, sqlDaHora, sqlDoDiaDaOperacao } from '../src/rotas/especialista.js';

import {
  chaveDaSerie, DIA, DIAS_DO_PADRAO, diaDaSemana, hh, idDoIndicador, juntar, MINIMO_DE_DIAS, MINIMO_NA_HORA, montarPadroes, ordemDaHora, PISO,
  pluralDoObjeto, somaDias, textoDaRevisao, umaCasa, valorDaHora,
  type Anomalia, type Celula, type Entrada, type Frase, type Padroes, type Revisao, type Serie,
} from '../src/especialista.js';

// ───────────────────────── a loja de mentira ─────────────────────────

/** Quinta-feira. O padrão vai de 10/09 a 07/10. */
const HOJE = '2026-10-08';
const ONTEM = '2026-10-07';
const ABERTA = [18, 19, 20, 21, 22, 23, 0];
const SETORES = [
  { id: 's-atd', nome: 'Atendimento' },
  { id: 's-coz', nome: 'Cozinha' },
  { id: 's-est', nome: 'Estoque' },
];

const serie = (mais: Partial<Serie> & Pick<Serie, 'regraId' | 'zonaId' | 'regraNome' | 'tipo' | 'pontoNome' | 'setorId'>): Serie => ({
  ativa: true, objeto: null, minimo: null, maximo: null, porteiro: 'sempre', comPadrao: false, pontoId: `p-${mais.pontoNome}`, canal: 1,
  zonaNome: 'Quadro inteiro', variasAreas: false, areaDesenhada: false, fotosPadrao: 0, setorNome: SETORES.find((s) => s.id === mais.setorId)!.nome, ...mais,
});
const FILA = serie({ regraId: 'r-fila', zonaId: 'z-cliente', regraNome: 'Fila no balcão', tipo: 'contagem', objeto: 'pessoa', minimo: 0, maximo: 7, pontoNome: 'Balcão', zonaNome: 'Lado do cliente', variasAreas: true, areaDesenhada: true, setorId: 's-atd' });
const POSTO = serie({ regraId: 'r-posto', zonaId: 'z-dentro', regraNome: 'Alguém no balcão', tipo: 'presenca', objeto: 'pessoa', minimo: 1, pontoNome: 'Balcão', zonaNome: 'Dentro do balcão', variasAreas: true, areaDesenhada: true, setorId: 's-atd' });
const CHAPA = serie({ regraId: 'r-chapa', zonaId: 'z-chapa', regraNome: 'Chapa com gente', tipo: 'presenca', objeto: 'pessoa', minimo: 1, pontoNome: 'Chapa', setorId: 's-coz' });
const BANCADA = serie({ regraId: 'r-bancada', zonaId: 'z-m1', regraNome: 'Bancada limpa', tipo: 'estado', pontoNome: 'Montagem 1', zonaNome: 'Bancada', areaDesenhada: true, setorId: 's-coz' });
const UNIFORME = serie({ regraId: 'r-uniforme', zonaId: 'z-m1', regraNome: 'Uniforme completo', tipo: 'estado', pontoNome: 'Montagem 1', zonaNome: 'Bancada', areaDesenhada: true, setorId: 's-coz' });
const TOUCA = serie({ regraId: 'r-touca', zonaId: 'z-m2', regraNome: 'Uso de touca', tipo: 'estado', pontoNome: 'Montagem 2', setorId: 's-coz' });
const SERIES = [FILA, POSTO, CHAPA, BANCADA, UNIFORME, TOUCA];

type Plano = { fila: number; filaFora: number; posto: number; chapa: number; bancadaFora: number; uniformeNa: number; toucaNa: number };
/** O que é normal num dia da semana e numa hora. */
function normalDe(dow: number, hora: number): Plano {
  const pico = hora === 20 || hora === 21;
  const ombro = hora === 19 || hora === 22;
  return {
    // sexta enche mais, e sábado mais ainda
    fila: (hora === 21 ? 4.2 : hora === 20 ? 4 : ombro ? 2.5 : 1) * (dow === 5 ? 1.4 : dow === 4 ? 1.2 : 1),
    filaFora: pico ? 4 : 0,
    posto: pico || ombro ? 2 : 1,
    chapa: pico && dow === 5 ? 2 : 1,
    bancadaFora: pico ? 15 : 10,
    uniformeNa: 40,
    toucaNa: 55,
  };
}

type Loja = { dias?: number; horaAgora?: number; fora?: Record<string, Partial<Plano>>; revisoes?: Revisao[]; series?: Serie[]; comDisco?: boolean; crescendo?: boolean };
/** A loja com `dias` dias de história (fechada às segundas) e as horas de hoje até `horaAgora`. */
function loja({ dias = DIAS_DO_PADRAO, horaAgora = 21, fora = {}, revisoes = [], series = SERIES, comDisco = true, crescendo = true }: Loja = {}): Entrada {
  const celulas: Celula[] = [];
  // pela chave, e não pelo objeto: o teste troca um campo de uma série e ela continua sendo a mesma
  const tem = (s: Serie): boolean => series.some((x) => chaveDaSerie(x) === chaveDaSerie(s));
  for (let n = dias; n >= 0; n -= 1) {
    const dia = somaDias(HOJE, -n);
    const dow = diaDaSemana(dia);
    if (dow === 0) continue; // segunda: fechada
    // Dias iguais ficam a sete dias um do outro: a folga alterna +3% e −3%, sem virar tendência.
    const folga = n % 2 ? 1.03 : 0.97;
    // A fila do pico de sábado cresce semana a semana (é a tendência posta de propósito).
    const semana = Math.floor((n - 1) / 7); // 0 = a semana que acabou ontem
    for (const hora of ABERTA) {
      if (n === 0 && ordemDaHora(hora) > ordemDaHora(horaAgora)) continue;
      const p = { ...normalDe(dow, hora), ...(fora[`${dia}|${hora}`] ?? {}) };
      const mexida = fora[`${dia}|${hora}`] ?? {};
      const fila = mexida.fila ?? (crescendo && dow === 5 && (hora === 20 || hora === 21) ? p.fila * [1, 0.92, 0.84, 0.76][Math.min(semana, 3)]! : p.fila * folga);
      const detector = (s: Serie, medida: number, foraPc: number, extras = 0): void => {
        if (!tem(s)) return;
        const rotinaFora = Math.round((foraPc / 100) * 120);
        celulas.push({
          dia, hora, regraId: s.regraId, zonaId: s.zonaId, julgadas: 120 + extras, fora: rotinaFora + Math.ceil(extras / 2), na: 0, extras, extrasFora: Math.ceil(extras / 2),
          somaMedida: medida * 120, comMedida: 120, maxMedida: Math.ceil(medida + 1), alertas: foraPc >= 30 ? 2 : 0, emSilencio: 0, custoCentavos: 0,
        });
      };
      const nuvem = (s: Serie, foraPc: number, naPc: number): void => {
        if (!tem(s)) return;
        celulas.push({
          dia, hora, regraId: s.regraId, zonaId: s.zonaId, julgadas: 20, fora: Math.round(foraPc / 5), na: Math.round(naPc / 5), extras: 0, extrasFora: 0,
          somaMedida: 0, comMedida: 0, maxMedida: null, alertas: foraPc >= 30 ? 1 : 0, emSilencio: 0, custoCentavos: 12,
        });
      };
      // a fila tem olhadas extras do vigia, metade delas fora do critério: não podem entrar na taxa
      detector(FILA, fila, p.filaFora, 10);
      detector(POSTO, mexida.posto ?? p.posto * folga, 0);
      detector(CHAPA, mexida.chapa ?? p.chapa * folga, 0);
      nuvem(BANCADA, p.bancadaFora, 0);
      nuvem(UNIFORME, 0, p.uniformeNa);
      nuvem(TOUCA, 0, p.toucaNa);
    }
  }
  const disco = comDisco ? Array.from({ length: dias + 1 }, (_, i) => ({ dia: somaDias(HOJE, i - dias), livreGb: 100 - 0.8 * i, totalGb: 240 })) : [];
  return { hoje: HOJE, horaAgora, setores: SETORES, series, celulas, revisoes, disco };
}

const plana = (f: Frase): string => f.map((t) => (typeof t === 'string' ? t : t.forte)).join('');
const ind = (s: Serie, tipo: 'medida' | 'fora' | 'na'): string => idDoIndicador(s, tipo);
const revisao = (s: Serie, tipo: Revisao['tipo'], dia: string, hora: number, mais: Partial<Revisao> = {}): Revisao => ({
  regraId: s.regraId, zonaId: s.zonaId, tipo, dia, hora, estado: 'esperado', soDestaVez: false, texto: 'anotado', virou: null, quem: 'Ana Souza', em: HOJE, ...mais,
});

// ───────────────────────── as peças ─────────────────────────

describe('as peças do especialista (sem banco)', () => {
  it('o dia da semana começa na segunda, e os dias andam pelo calendário', () => {
    assert.equal(diaDaSemana(HOJE), 3, '08/10/2026 é quinta');
    assert.deepEqual(['2026-10-05', '2026-10-10', '2026-10-11'].map(diaDaSemana), [0, 5, 6]);
    assert.equal(DIA[diaDaSemana('2026-10-03')], 'sábado');
    assert.equal(somaDias('2026-10-01', -1), '2026-09-30');
    assert.equal(somaDias('2026-12-31', 1), '2027-01-01');
    assert.equal(somaDias('2028-02-28', 1), '2028-02-29', 'ano bissexto');
    assert.equal(somaDias(HOJE, -DIAS_DO_PADRAO), '2026-09-10');
  });

  it('o dia da operação começa às 6h: a madrugada vem depois da noite', () => {
    assert.deepEqual([6, 18, 23, 0, 5].map(ordemDaHora), [0, 12, 17, 18, 23]);
    assert.ok(ordemDaHora(0) > ordemDaHora(23), 'meia-noite é mais tarde que 23h');
    assert.deepEqual([0, 9, 23, 24, -1].map(hh), ['00h', '09h', '23h', '00h', '23h']);
  });

  it('a resposta do responsável, em uma frase', () => {
    const r = { estado: 'esperado' as const, soDestaVez: false, nota: '', oQueHouve: '', oQueFoiFeito: '', dia: '2026-10-03', hora: 22 };
    assert.equal(textoDaRevisao(r), 'Acontece sempre: o padrão dos sábados às 22h passa a contar com isso.');
    assert.equal(textoDaRevisao({ ...r, dia: '2026-10-02', hora: 9 }), 'Acontece sempre: o padrão das sextas às 09h passa a contar com isso.');
    assert.equal(textoDaRevisao({ ...r, soDestaVez: true, nota: ' Jogo na TV: reforcei o balcão. ' }), 'Jogo na TV: reforcei o balcão. Foi só desta vez: esta hora ficou de fora da conta do padrão.');
    assert.equal(textoDaRevisao({ ...r, estado: 'problema', oQueHouve: 'Um atendente faltou.', oQueFoiFeito: ' Remanejei uma pessoa do salão. ', nota: 'não entra' }), 'Um atendente faltou. Remanejei uma pessoa do salão.');
  });

  it('o plural do objeto do detector', () => {
    assert.deepEqual(['pessoa', 'celular', 'colher', 'micro-ondas', 'garrafa'].map(pluralDoObjeto), ['pessoas', 'celulares', 'colheres', 'micro-ondas', 'garrafas']);
    assert.equal(umaCasa(2), '2,0');
    assert.equal(umaCasa(1.96), '2,0');
  });

  const celula = (mais: Partial<Celula>): Celula => ({
    dia: HOJE, hora: 20, regraId: 'r', zonaId: 'z', julgadas: 0, fora: 0, na: 0, extras: 0, extrasFora: 0, somaMedida: 0, comMedida: 0, maxMedida: null, alertas: 0, custoCentavos: 0, ...mais,
  });

  it('a média da medida é soma sobre quantidade — e nula sem medida', () => {
    assert.equal(juntar('medida', [celula({ somaMedida: 30, comMedida: 10 }), celula({ somaMedida: 10, comMedida: 10 })]), 2);
    assert.equal(juntar('medida', [celula({ julgadas: 50 })]), null, '"não mediu" não é zero');
    assert.equal(juntar('medida', []), null);
  });

  it('a taxa de fora do critério é da ROTINA: a olhada extra do vigia não entra', () => {
    // 100 de rotina com 10 fora; mais 40 extras, 30 delas fora
    const c = celula({ julgadas: 140, fora: 40, extras: 40, extrasFora: 30 });
    assert.equal(juntar('fora', [c]), 10);
    assert.equal(juntar('fora', [celula({ julgadas: 40, fora: 30, extras: 40, extrasFora: 30 })]), null, 'hora só de extras: sem rotina não há taxa');
    assert.equal(juntar('fora', [celula({ julgadas: 100, fora: 10 }), celula({ julgadas: 300, fora: 10 })]), 5, 'somando as horas, e não tirando a média das taxas');
    // "sem avaliar" é sobre tudo o que foi julgado
    assert.equal(juntar('na', [celula({ julgadas: 50, na: 20 })]), 40);
    assert.equal(juntar('na', [celula({})]), null);
  });

  it('hora com amostra pequena não tem valor: seria acaso', () => {
    assert.deepEqual(MINIMO_NA_HORA, { medida: 3, taxa: 5 });
    assert.equal(valorDaHora('medida', celula({ somaMedida: 4, comMedida: 2 })), null);
    assert.equal(valorDaHora('medida', celula({ somaMedida: 6, comMedida: 3 })), 2);
    assert.equal(valorDaHora('fora', celula({ julgadas: 4, fora: 4 })), null);
    assert.equal(valorDaHora('fora', celula({ julgadas: 5, fora: 1 })), 20);
    assert.equal(valorDaHora('fora', celula({ julgadas: 9, fora: 5, extras: 5, extrasFora: 5 })), null, 'a amostra que conta é a da rotina');
    assert.equal(valorDaHora('na', celula({ julgadas: 5, na: 5 })), 100);
    assert.equal(valorDaHora('medida', undefined), null);
  });
});

// ───────────────────────── o padrão ─────────────────────────

describe('o padrão da loja (sem banco)', () => {
  it('com menos de sete dias medidos não há padrão para mostrar', () => {
    assert.equal(MINIMO_DE_DIAS, 7);
    // 7 dias de calendário antes de hoje, um deles segunda: 6 dias medidos
    const pouco = montarPadroes(loja({ dias: 7 }));
    assert.deepEqual([pouco.suficiente, pouco.base.dias], [false, 6]);
    assert.deepEqual([pouco.indicadores, pouco.anomalias, pouco.sugestoes, pouco.tendencias], [[], [], [], []]);
    assert.deepEqual(pouco.setores, SETORES, 'os setores vão mesmo assim: a tela monta o filtro');
    const justo = montarPadroes(loja({ dias: 8 }));
    assert.deepEqual([justo.suficiente, justo.base.dias, justo.base.firme], [true, 7, false]);
    assert.equal(montarPadroes(loja({ dias: 0 })).base.de, null, 'só hoje: hoje não entra na conta');
  });

  it('a base é dos 28 dias antes de hoje; hoje fica de fora', () => {
    const p = montarPadroes(loja());
    assert.deepEqual(p.base, { dias: 24, de: '2026-09-10', ate: ONTEM, firme: true }, '28 dias menos quatro segundas');
    assert.equal(p.hoje, HOJE);
    // dia mais velho que o período não entra
    const comVelho = loja();
    comVelho.celulas.push({ ...comVelho.celulas[0]!, dia: '2026-09-09' });
    assert.equal(montarPadroes(comVelho).base.de, '2026-09-10');
  });

  it('os indicadores: a medida do detector, a taxa de fora e a de sem avaliar', () => {
    const p = montarPadroes(loja());
    const de = (id: string) => p.indicadores.find((i) => i.id === id);
    assert.deepEqual(
      [de(ind(FILA, 'medida'))?.nome, de(ind(FILA, 'medida'))?.curto, de(ind(FILA, 'medida'))?.onde],
      ['Fila no balcão: pessoas', 'pessoas', 'Balcão · Lado do cliente'],
    );
    assert.equal(de(ind(CHAPA, 'medida'))?.onde, 'Chapa', 'canal de uma área só: sem o nome da área');
    assert.equal(de(ind(BANCADA, 'fora'))?.nome, 'Bancada limpa fora do critério');
    assert.equal(de(ind(BANCADA, 'medida')), undefined, 'critério da nuvem não mede');
    assert.deepEqual([de(ind(TOUCA, 'na'))?.noSeletor, de(ind(BANCADA, 'na'))?.noSeletor], [true, false], '"sem avaliar" só entra no seletor quando acontece');
    assert.equal(de(ind(FILA, 'fora'))?.setorId, 's-atd');
    // critério que saiu da loja: as horas dele não viram indicador
    const sem = montarPadroes(loja({ series: SERIES.filter((s) => s !== TOUCA) }));
    assert.ok(!sem.indicadores.some((i) => i.regraId === TOUCA.regraId));
    assert.equal(chaveDaSerie(TOUCA), 'r-touca|z-m2');
  });

  it('o mesmo critério em duas áreas: cada indicador diz de qual é', () => {
    const emDuas = [...SERIES, { ...POSTO, zonaId: 'z-caixa', pontoNome: 'Caixa', pontoId: 'p-Caixa', variasAreas: false, zonaNome: 'Quadro inteiro' }];
    const entrada = loja({ series: emDuas });
    entrada.celulas.push(...entrada.celulas.filter((c) => c.zonaId === POSTO.zonaId).map((c) => ({ ...c, zonaId: 'z-caixa' })));
    const nomes = montarPadroes(entrada).indicadores.filter((i) => i.regraId === POSTO.regraId && i.tipo === 'medida').map((i) => i.nome);
    assert.deepEqual(nomes, ['Alguém no balcão: pessoas · Balcão · Dentro do balcão', 'Alguém no balcão: pessoas · Caixa']);
  });

  it('a semana típica: uma média por dia da semana e hora, e a loja fechada não aparece', () => {
    const p = montarPadroes(loja());
    const grade = p.semana[ind(FILA, 'medida')]!;
    assert.equal(grade.length, 6 * 7, 'seis dias abertos, sete horas');
    assert.ok(!grade.some((c) => c.diaDaSemana === 0), 'segunda: fechada');
    const quinta20 = grade.find((c) => c.diaDaSemana === 3 && c.hora === 20)!;
    assert.equal(quinta20.n, 4);
    assert.ok(Math.abs(quinta20.media - 4) < 1e-9 && Math.abs(quinta20.min - 3.88) < 1e-9 && Math.abs(quinta20.max - 4.12) < 1e-9, JSON.stringify(quinta20));
    // um dia atípico é contado, mas não vira o costume: a terça às 20h continua em 4, e não vira a hora mais cheia
    const comPico = montarPadroes(loja({ fora: { ['2026-10-06|20']: { fila: 12 } } })).semana[ind(FILA, 'medida')]!;
    const terca20 = comPico.find((c) => c.diaDaSemana === 1 && c.hora === 20)!;
    assert.deepEqual([terca20.n, terca20.noMiolo], [4, 3]);
    assert.ok(Math.abs(terca20.media - 4) < 0.05 && terca20.max < 4.2, JSON.stringify(terca20));
    const topo = comPico.reduce((a, b) => (b.media > a.media ? b : a));
    assert.deepEqual([topo.diaDaSemana, topo.hora], [5, 21]);
    // na ordem do dia da operação: a meia-noite vem depois das 23h
    assert.deepEqual(grade.filter((c) => c.diaDaSemana === 1).map((c) => c.hora), ABERTA);
    const maior = grade.reduce((a, b) => (b.media > a.media ? b : a));
    assert.deepEqual([maior.diaDaSemana, maior.hora], [5, 21], 'sábado às 21h: 5,88 na última semana, 5,17 na média das quatro (a sexta fica em 5,04)');
    assert.ok(Math.abs(maior.media - 5.88 * 0.88) < 1e-9 && maior.n === 4, JSON.stringify(maior));
    // a taxa também tem semana típica — e é a da rotina
    const fora = p.semana[ind(FILA, 'fora')]!.find((c) => c.diaDaSemana === 3 && c.hora === 20)!;
    assert.ok(Math.abs(fora.media - (5 / 120) * 100) < 1e-9, `4% de 120 dá 5 olhadas: ${fora.media}`);
  });

  it('como cada setor funciona: frases montadas dos números, e o setor sem critério diz que não tem', () => {
    const p = montarPadroes(loja());
    assert.deepEqual(p.descricoes.map((d) => d.setor), ['Atendimento', 'Cozinha', 'Estoque']);
    const [atd, coz, est] = p.descricoes;
    assert.deepEqual(est, { setorId: 's-est', setor: 'Estoque', texto: null, fatos: [] });
    // às 20h: (4 × 4 + 4,8 + 4,93) / 6 = 4,29; às 21h: (4,2 × 4 + 5,04 + 5,17) / 6 = 4,50; o pico é a média das duas
    assert.ok(atd!.texto!.startsWith('Em Balcão · Lado do cliente, o movimento tem pico das 20h às 22h: 4,4 pessoas, em média.'), atd!.texto!);
    assert.deepEqual(atd!.fatos[0], ['Pico', '20h às 22h']);
    assert.deepEqual(atd!.fatos[1], ['Hora mais cheia', 'sábado às 21h, 5,2 pessoas']);
    assert.match(atd!.texto!, /“Fila no balcão” \(Balcão · Lado do cliente\) fica fora do critério em 1% das olhadas — 4% no pico\./);
    assert.match(coz!.texto!, /“Bancada limpa” fica fora do critério em 11% das olhadas/);
    assert.match(coz!.texto!, /Em Montagem 2, “Uso de touca” não dá para avaliar em 55% das olhadas\./);
    assert.match(coz!.texto!, /Em Montagem 1, “Uniforme completo” não dá para avaliar em 40% das olhadas\./);
    // "sem avaliar": o canal que menos consegue vem primeiro
    assert.ok(coz!.texto!.indexOf('“Uso de touca” não dá para avaliar em 55%') < coz!.texto!.indexOf('“Uniforme completo” não dá para avaliar em 40%'));
    assert.deepEqual(coz!.fatos, [
      ['Hora mais cheia', 'sábado às 20h, 2,0 pessoas'],
      ['Bancada limpa fora do critério', '11%'],
      ['Uso de touca sem avaliar (Montagem 2)', '55% das olhadas'],
      ['Uniforme completo sem avaliar (Montagem 1)', '40% das olhadas'],
    ]);
    // a chapa tem uma pessoa o tempo todo: não há pico para contar
    assert.ok(coz!.texto!.startsWith('Em Chapa há 1,0 pessoa, em média, sem hora de pico marcada.'), coz!.texto!);
    assert.ok(atd!.fatos.length <= 4 && coz!.fatos.length <= 4);
  });

  it('a descrição do setor é curta: a taxa por critério (juntando os canais), e só as duas maiores de cada tipo', () => {
    // a bancada em três canais, a touca em três, e mais um critério que quase nunca fica fora
    const m = (s: Serie, n: number): Serie => ({ ...s, zonaId: `${s.zonaId}-${n}`, pontoNome: `Montagem ${n}`, pontoId: `p-Montagem ${n}` });
    const series = [...SERIES, m(BANCADA, 3), m(BANCADA, 4), m(TOUCA, 3), m(TOUCA, 4)];
    const e = loja({ series });
    const copia = (s: Serie, n: number, mais: Partial<Celula> = {}) =>
      e.celulas.filter((c) => c.regraId === s.regraId && c.zonaId === s.zonaId).map((c) => ({ ...c, zonaId: `${s.zonaId}-${n}`, ...mais }));
    // a bancada fica fora em 11% em Montagem 1, 50% em Montagem 3 e 0% em Montagem 4: juntas, (11 + 50 + 0) / 3
    // a touca não avalia em 55% (Montagem 2), 90% (Montagem 3) e 70% (Montagem 4)
    e.celulas.push(...copia(BANCADA, 3, { fora: 10 }), ...copia(BANCADA, 4, { fora: 0 }), ...copia(TOUCA, 3, { na: 18 }), ...copia(TOUCA, 4, { na: 14 }));
    // o uniforme passa a ficar fora do critério em 30% (a maior taxa do setor), e a touca em 5% (a terceira: fica de fora)
    for (const c of e.celulas) {
      if (c.regraId === UNIFORME.regraId) c.fora = 6;
      if (c.regraId === TOUCA.regraId) c.fora = 1;
    }
    const coz = montarPadroes(e).descricoes.find((d) => d.setorId === 's-coz')!;
    assert.equal(
      coz.texto,
      'Em Chapa há 1,0 pessoa, em média, sem hora de pico marcada. ' +
        '“Uniforme completo” fica fora do critério em 30% das olhadas. “Bancada limpa” fica fora do critério em 20% das olhadas. ' +
        'Em Montagem 3, “Uso de touca” não dá para avaliar em 90% das olhadas. Em Montagem 4, “Uso de touca” não dá para avaliar em 70% das olhadas.',
    );
    assert.deepEqual(coz.fatos, [
      ['Hora mais cheia', 'sábado às 20h, 2,0 pessoas'],
      ['Uniforme completo fora do critério', '30%'],
      ['Bancada limpa fora do critério', '20%'],
      ['Uso de touca sem avaliar (Montagem 3)', '90% das olhadas'],
    ]);
    // "não dá para avaliar" só entra na descrição a partir de 30%: com o uniforme em 10%, fica só a touca
    const pouco = loja();
    for (const c of pouco.celulas) if (c.regraId === UNIFORME.regraId) c.na = 2;
    const texto = montarPadroes(pouco).descricoes.find((d) => d.setorId === 's-coz')!.texto!;
    assert.deepEqual(texto.match(/Em [^,]+, “[^”]+” não dá para avaliar/g), ['Em Montagem 2, “Uso de touca” não dá para avaliar']);
  });
});

// ───────────────────────── as saídas do padrão ─────────────────────────

describe('as saídas do padrão (sem banco)', () => {
  // O que foi posto fora do padrão, de propósito.
  const FORA = {
    [`${ONTEM}|20`]: { posto: 1.1 }, // quarta: o balcão com uma pessoa no pico
    ['2026-10-03|18']: { fila: 4 }, // sábado: fila logo na abertura
    ['2026-10-02|21']: { bancadaFora: 45 }, // sexta: a bancada fora por muito mais tempo
    [`${HOJE}|19`]: { toucaNa: 90 }, // hoje: a touca quase parou de avaliar
    ['2026-10-01|20']: { fila: 9, filaFora: 60 }, // quinta passada: fila enorme, e o critério estourou junto
  };
  const padroes = (mais: Loja = {}) => montarPadroes(loja({ fora: FORA, ...mais }));
  const achar = (p: ReturnType<typeof montarPadroes>, s: Serie, tipo: 'medida' | 'fora' | 'na', dia: string, hora: number) =>
    p.anomalias.find((a) => a.id === `${ind(s, tipo)}|${dia}|${hora}`);

  it('acha exatamente o que foi posto fora do padrão — e nada mais', () => {
    const p = padroes();
    assert.deepEqual(
      p.anomalias.map((a) => `${a.dia} ${hh(a.hora)} ${a.tipo} ${a.regraId}`),
      [
        `${HOJE} 19h na r-touca`,
        `${ONTEM} 20h medida r-posto`,
        '2026-10-03 18h medida r-fila',
        '2026-10-02 21h fora r-bancada',
        '2026-10-01 20h medida r-fila',
      ],
      'da mais nova para a mais velha',
    );
    assert.equal(p.aRever, 5);
    assert.equal(montarPadroes(loja()).anomalias.length, 0, 'sem nada posto, a loja de mentira não tem saída do padrão');
  });

  it('a medida abaixo do normal: o balcão com uma pessoa no pico', () => {
    const a = achar(padroes(), POSTO, 'medida', ONTEM, 20)!;
    assert.equal(a.titulo, '“Alguém no balcão”: menos pessoas do que o normal');
    assert.equal(a.onde, 'Balcão · Dentro do balcão');
    assert.equal(a.estado, 'rever');
    assert.equal(a.grave, false, '1,1 não é metade de 2,0');
    assert.deepEqual([a.normal.n, a.normal.noMiolo, a.normal.base], [3, 3, 'dia'], 'as três quartas de antes');
    assert.equal(plana(a.conta), 'Visto: 1,1 pessoa em média. Normal das quartas às 20h: 1,9 (de 1,9 a 2,1 nas 3 quartas anteriores).');
    assert.equal(a.curto, '1,1 pessoa em média; o normal das quartas às 20h é 1,9');
    // o critério pede uma pessoa, e havia uma: ele não tinha por que avisar — e a frase diz isso
    assert.equal(a.mais, 'Na mesma hora, o critério ficou fora em 0% das olhadas e avisou 0 vezes. Ele só pede 1, não o que é costume nessa hora.');
    assert.equal(a.camera, false);
    assert.equal(a.ajustar, null);
    // a correção pode propor o costume como limite — e, como as 20h são do pico (20h às 22h) e às 21h o
    // costume também é de duas pessoas, o critério proposto vale para o pico inteiro
    assert.deepEqual(a.criterio, {
      nome: 'Pelo menos 2 em Balcão · Dentro do balcão no pico', tipo: 'contagem', objeto: 'pessoa', minimo: 2, maximo: null, zonaId: 'z-dentro',
      lugar: 'Balcão · Dentro do balcão', janela: ['20:00', '22:00'], regra: 'pelo menos 2 × pessoa',
      texto: 'Das 20h às 22h há pelo menos 2 pessoas em Balcão · Dentro do balcão.',
    });
    // fora do pico (às 19h o costume também é de duas), o critério é só daquela hora
    const as19 = achar(padroes({ fora: { [`${ONTEM}|19`]: { posto: 1.1 } } }), POSTO, 'medida', ONTEM, 19)!;
    assert.deepEqual([as19.criterio?.nome, as19.criterio?.janela, as19.criterio?.texto], [
      'Pelo menos 2 em Balcão · Dentro do balcão às 19h', ['19:00', '20:00'], 'Das 19h às 20h há pelo menos 2 pessoas em Balcão · Dentro do balcão.',
    ]);
    // hora do pico em que a OUTRA hora do pico pede outro limite: um limite só não serve às duas
    // (nos três sábados de antes a fila foi a 4,3, 4,7 e 5,2 às 20h, e a 4,5, 4,9 e 5,4 às 21h: o teto é 6 nas
    // duas horas. Com 7,5 às 21h naqueles sábados, o teto das 21h seria 8 — e o critério fica só nas 20h.)
    const outroCostume: Record<string, Partial<Plano>> = { ['2026-10-03|20']: { fila: 12 } };
    for (const d of ['2026-09-12', '2026-09-19', '2026-09-26']) outroCostume[`${d}|21`] = { fila: 7.5 };
    const noPico = achar(montarPadroes(loja({ fora: { ['2026-10-03|20']: { fila: 12 } } })), FILA, 'medida', '2026-10-03', 20)!;
    assert.deepEqual([noPico.criterio?.nome, noPico.criterio?.maximo, noPico.criterio?.janela], ['No máximo 6 em Balcão · Lado do cliente no pico', 6, ['20:00', '22:00']]);
    assert.equal(noPico.criterio?.texto, 'Das 20h às 22h há no máximo 6 pessoas em Balcão · Lado do cliente.');
    const semPico = achar(montarPadroes(loja({ fora: outroCostume })), FILA, 'medida', '2026-10-03', 20)!;
    assert.deepEqual([semPico.criterio?.nome, semPico.criterio?.maximo, semPico.criterio?.janela], ['No máximo 6 em Balcão · Lado do cliente às 20h', 6, ['20:00', '21:00']]);
  });

  it('muito fora do normal: metade ou o dobro', () => {
    const metade = achar(padroes({ fora: { [`${ONTEM}|20`]: { posto: 0.9 } } }), POSTO, 'medida', ONTEM, 20)!;
    assert.equal(metade.grave, true, '0,9 é menos da metade de 1,94');
    assert.equal(achar(padroes({ fora: { [`${ONTEM}|20`]: { posto: 1 } } }), POSTO, 'medida', ONTEM, 20)!.grave, false, '1,0 ainda não é a metade');
    const dobro = achar(padroes(), FILA, 'medida', '2026-10-03', 18)!;
    assert.equal(dobro.grave, true, '4,0 contra 1,36');
    assert.equal(dobro.titulo, '“Fila no balcão”: mais pessoas do que o normal');
    assert.equal(dobro.criterio?.nome, 'No máximo 2 em Balcão · Lado do cliente às 18h', 'o critério de fila aceita 7; o costume da abertura é bem menos');
    assert.equal(plana(dobro.conta), 'Visto: 4,0 pessoas em média. Normal dos sábados às 18h: 1,4 (de 1,4 a 1,4 nos 3 sábados anteriores).');
    assert.deepEqual([dobro.criterio?.minimo, dobro.criterio?.maximo, dobro.criterio?.janela], [0, 2, ['18:00', '19:00']]);
    // quatro na fila não passa do limite de 7: o critério não avisou, e a frase diz por quê
    assert.equal(dobro.mais, 'Na mesma hora, o critério ficou fora em 0% das olhadas e avisou 0 vezes. Ele olha o limite de 7, não o que é costume nessa hora.');
  });

  it('a taxa acima do normal: a bancada fora do critério por muito mais tempo', () => {
    const a = achar(padroes(), BANCADA, 'fora', '2026-10-02', 21)!;
    assert.equal(a.titulo, '“Bancada limpa” fora do critério por muito mais tempo');
    assert.equal(plana(a.conta), 'Fora do critério em 45% das olhadas. Normal das sextas às 21h: 15% (de 15% a 15% nas 3 sextas anteriores).');
    assert.equal(a.mais, 'Foram 9 olhadas fora do critério em 20; o critério avisou 1 vez — uma por período de silêncio.');
    assert.equal(a.grave, false);
    assert.deepEqual(a.ajustar, { regraId: 'r-bancada', nome: 'Bancada limpa' });
    assert.equal(a.criterio, null, 'taxa não vira critério de contagem: ajusta-se o que já existe');
  });

  it('o silêncio depois do aviso: a taxa é da parte olhada, e a frase diz quando ele tirou um quarto da hora', () => {
    const com = (emSilencio: number) => {
      const e = loja({ fora: FORA });
      e.celulas.find((c) => c.regraId === BANCADA.regraId && c.dia === '2026-10-02' && c.hora === 21)!.emSilencio = emSilencio;
      return achar(montarPadroes(e), BANCADA, 'fora', '2026-10-02', 21)!;
    };
    const frase = 'Foram 9 olhadas fora do critério em 20; o critério avisou 1 vez — uma por período de silêncio.';
    // 10 em silêncio e 20 feitas: um terço da hora ninguém olhou
    assert.equal(com(10).mais, `${frase} Depois de avisar, ele ficou em silêncio em 10 das 30 olhadas da hora: a taxa é só das que ele fez.`);
    assert.equal(plana(com(10).conta), 'Fora do critério em 45% das olhadas. Normal das sextas às 21h: 15% (de 15% a 15% nas 3 sextas anteriores).', 'a taxa não muda: é das olhadas feitas');
    // 7 de 27 é um quarto e pouco: diz; 6 de 26, menos de um quarto: não diz
    assert.match(com(7).mais!, / ele ficou em silêncio em 7 das 27 olhadas da hora/);
    assert.equal(com(6).mais, frase);
    assert.equal(com(0).mais, frase);
  });

  it('“sem conseguir avaliar” de uma hora para outra: costuma ser a câmera', () => {
    const a = achar(padroes(), TOUCA, 'na', HOJE, 19)!;
    assert.equal(a.titulo, '“Uso de touca” quase parou de conseguir avaliar');
    assert.equal(a.camera, true);
    assert.match(a.mais!, /costuma ser a câmera/);
    assert.equal(a.pontoId, 'p-Montagem 2');
    assert.deepEqual([a.normal.n, a.normal.base], [4, 'dia'], 'hoje não está no padrão: as quatro quintas');
    const menos = achar(padroes({ fora: { [`${HOJE}|19`]: { toucaNa: 75 } } }), TOUCA, 'na', HOJE, 19)!;
    assert.equal(menos.titulo, '“Uso de touca” ficou mais tempo sem conseguir avaliar');
  });

  it('medida e taxa do mesmo critério na mesma hora: uma saída só, a da medida', () => {
    const p = padroes();
    const a = achar(p, FILA, 'medida', '2026-10-01', 20)!;
    assert.equal(a.mais, 'Na mesma hora, o critério ficou fora em 60% das olhadas e avisou 2 vezes.', 'nove passa do limite de 7: aí o critério avisou, e não há o que explicar');
    assert.equal(achar(p, FILA, 'fora', '2026-10-01', 20), undefined, 'a taxa é consequência da medida');
    // sem a medida fora do normal, a taxa aparece sozinha
    const so = padroes({ fora: { ['2026-10-01|20']: { filaFora: 60 } } });
    assert.ok(achar(so, FILA, 'fora', '2026-10-01', 20));
  });

  it('o que NÃO é saída do padrão', () => {
    const quieta = (fora: Record<string, Partial<Plano>>, mais: Loja = {}) => montarPadroes(loja({ fora, ...mais })).anomalias;
    assert.deepEqual(PISO, { medida: { faixa: 0.5, desvio: 0.6 }, taxa: { faixa: 10, desvio: 15 } });
    assert.deepEqual(quieta({ [`${ONTEM}|20`]: { posto: 1.6 } }), [], 'um pouco menos de gente não é fora do padrão');
    assert.deepEqual(quieta({ [`${ONTEM}|20`]: { posto: 2.5 } }), []);
    assert.deepEqual(quieta({ ['2026-10-02|21']: { bancadaFora: 0 } }), [], 'taxa MENOR que o normal é boa notícia');
    assert.deepEqual(quieta({ ['2026-10-02|21']: { bancadaFora: 25 } }), [], 'dez pontos a mais ainda é ruído');
    assert.deepEqual(quieta({ [`${ONTEM}|20`]: { toucaNa: 0 } }), []);
    // a hora de agora ainda está incompleta
    assert.deepEqual(quieta({ [`${HOJE}|21`]: { posto: 0 } }), []);
    assert.equal(quieta({ [`${HOJE}|21`]: { posto: 0 } }, { horaAgora: 22 }).length, 1, 'uma hora depois, ela conta');
    // a madrugada de hoje vem depois das 23h: à meia-noite, as 23h já fecharam
    assert.equal(quieta({ [`${HOJE}|23`]: { posto: 0 } }, { horaAgora: 0 }).length, 1);
    assert.deepEqual(quieta({ [`${HOJE}|0`]: { posto: 4 } }, { horaAgora: 0 }), []);
  });

  it('com menos de três dias iguais, o normal é o daquela hora em qualquer dia — e sem cinco, não há normal', () => {
    // 15 dias: duas quartas antes de ontem
    const a = achar(montarPadroes(loja({ dias: 15, fora: { [`${ONTEM}|20`]: { posto: 1 } } })), POSTO, 'medida', ONTEM, 20)!;
    assert.deepEqual([a.normal.base, a.normal.n], ['hora', 12], 'os doze dias abertos de antes, às 20h');
    assert.equal(plana(a.conta), 'Visto: 1,0 pessoa em média. Normal às 20h: 2,0 (de 1,9 a 2,1 nos 12 dias anteriores).');
    assert.equal(a.curto, '1,0 pessoa em média; o normal às 20h é 2,0');
    // em loja nova, sexta mais cheia que a semana é apontada — até alguém dizer que acontece sempre
    const nova = montarPadroes(loja({ dias: 15 }));
    assert.ok(nova.base.dias < 21 && !nova.base.firme);
    assert.ok(nova.anomalias.some((x) => x.regraId === FILA.regraId && diaDaSemana(x.dia) === 5 && x.normal.base === 'hora'), JSON.stringify(nova.anomalias.map((x) => [x.dia, x.hora, x.regraId])));
    // com o padrão firme, nenhum dia é comparado com "qualquer dia": a loja de sempre não aponta nada
    assert.deepEqual(montarPadroes(loja()).anomalias, []);
    // critério que só tem quatro dias de história: ainda não dá para dizer o que é normal
    const curta = loja({ fora: { [`${ONTEM}|20`]: { posto: 1 } } });
    curta.celulas = curta.celulas.filter((c) => c.regraId !== POSTO.regraId || c.dia >= '2026-10-03');
    assert.equal(achar(montarPadroes(curta), POSTO, 'medida', ONTEM, 20), undefined);
  });

  it('“foi só desta vez” e “é problema” ficam de fora da conta do padrão; “acontece sempre” ensina', () => {
    // dois sábados com o balcão cheio às 22h: 26/09 e 03/10
    const cheios = { ['2026-09-26|22']: { posto: 4 }, ['2026-10-03|22']: { posto: 4 } };
    const sem = montarPadroes(loja({ fora: cheios }));
    // O sábado de 26/09 já tinha fugido do costume: ele é olhado, mas não alarga a faixa — a segunda vez não é escondida pela primeira.
    assert.deepEqual(sem.anomalias.map((a) => a.dia), ['2026-10-03']);
    assert.deepEqual([sem.anomalias[0]!.normal.n, sem.anomalias[0]!.normal.noMiolo], [3, 2]);
    assert.equal(plana(sem.anomalias[0]!.conta), 'Visto: 4,0 pessoas em média. Normal dos sábados às 22h: 2,1 (de 1,9 a 2,1 em 2 dos 3 sábados anteriores).');

    for (const [nome, r] of [
      ['foi só desta vez', revisao(POSTO, 'medida', '2026-09-26', 22, { soDestaVez: true, texto: 'Jogo na TV.' })],
      ['é problema', revisao(POSTO, 'medida', '2026-09-26', 22, { estado: 'problema', texto: 'Faltou gente no salão.', virou: 'Abriu “Alguém no balcão” para ajuste.' })],
    ] as const) {
      const p = montarPadroes(loja({ fora: cheios, revisoes: [r] }));
      const [nova, revista] = [p.anomalias.find((a) => a.dia === '2026-10-03')!, p.anomalias.find((a) => a.dia === '2026-09-26')!];
      assert.equal(revista.estado, r.estado, nome);
      assert.deepEqual(revista.revisao, { quem: 'Ana Souza', em: HOJE, texto: r.texto, virou: r.virou, soDestaVez: r.soDestaVez }, nome);
      assert.equal(nova.estado, 'rever', `${nome}: o sábado seguinte continua apontado`);
      assert.deepEqual([nova.normal.n, nova.normal.base], [2, 'dia'], `${nome}: a hora revista saiu da conta do normal, e o sábado continua tendo o seu`);
      assert.equal(revista.normal.base, 'hora', `${nome}: a hora revista aparece mesmo sem três sábados antes dela`);
      assert.ok(nova.normal.max < 2.2, `${nome}: e não alargou a faixa (${nova.normal.max})`);
      assert.equal(p.aRever, 1, nome);
    }

    // "acontece sempre": a hora continua na conta, a faixa alarga, e o sábado seguinte deixa de ser apontado
    const sempre = montarPadroes(loja({ fora: cheios, revisoes: [revisao(POSTO, 'medida', '2026-09-26', 22)] }));
    assert.deepEqual(sempre.anomalias.map((a) => [a.dia, a.estado]), [['2026-09-26', 'esperado']], 'só a que foi revista; a seguinte cabe na faixa nova');
    assert.equal(sempre.aRever, 0);
    // a revisão é daquele indicador: a de outro critério na mesma hora não muda nada
    const deOutro = montarPadroes(loja({ fora: cheios, revisoes: [revisao(CHAPA, 'medida', '2026-09-26', 22, { soDestaVez: true })] }));
    assert.deepEqual(deOutro.anomalias.map((a) => [a.dia, a.estado]), [['2026-10-03', 'rever']], 'igual a não ter revisão nenhuma');
  });

  it('a lista tem teto, e o parecer aponta a mais forte', () => {
    const p = padroes();
    assert.equal(plana(p.parecer.anomalias), '5 saídas do padrão esperam a sua revisão. A mais forte: sábado, 03/10, das 18h às 19h, em Balcão · Lado do cliente — 4,0 pessoas em média; o normal dos sábados às 18h é 1,4.');
    const uma = montarPadroes(loja({ fora: { [`${ONTEM}|20`]: { posto: 1.1 } } }));
    assert.match(plana(uma.parecer.anomalias), /^1 saída do padrão espera a sua revisão\. A mais forte: ontem, das 20h às 21h, em Balcão · Dentro do balcão/);
    assert.equal(plana(montarPadroes(loja()).parecer.anomalias), 'Nada fugiu do padrão que ainda precise de revisão.');
    const hoje = montarPadroes(loja({ fora: { [`${HOJE}|19`]: { toucaNa: 90 } } }));
    assert.match(plana(hoje.parecer.anomalias), /A mais forte: hoje, das 19h às 20h, em Montagem 2/);
    // muitas saídas: ficam as sessenta mais novas
    // Loja nova (20 dias), com um pico a cada quatro dias em cada hora de três critérios: mais que sessenta.
    const muitas: Record<string, Partial<Plano>> = {};
    for (let n = 1; n <= 20; n += 1) {
      for (const h of ABERTA) {
        if ((n + h) % 4 === 0) muitas[`${somaDias(HOJE, -n)}|${h}`] = { chapa: 6 };
        if ((n + h) % 4 === 1) muitas[`${somaDias(HOJE, -n)}|${h}`] = { posto: 7 };
        if ((n + h) % 4 === 2) muitas[`${somaDias(HOJE, -n)}|${h}`] = { fila: 15 };
      }
    }
    const cheia = montarPadroes(loja({ dias: 20, fora: muitas }));
    assert.equal(cheia.anomalias.length, 60);
    assert.equal(cheia.anomalias[0]!.dia, ONTEM);
    assert.ok(cheia.anomalias.every((a, i) => i === 0 || a.dia <= cheia.anomalias[i - 1]!.dia), 'da mais nova para a mais velha');
  });
});

// ───────────────────────── o que anda junto ─────────────────────────

describe('o que anda junto (sem banco)', () => {
  // Às terças e quartas o balcão fica com uma pessoa no pico, e a fila estoura mais.
  const comUmNoPico = (): Record<string, Partial<Plano>> => {
    const f: Record<string, Partial<Plano>> = {};
    for (let n = 1; n <= DIAS_DO_PADRAO; n += 1) {
      const dia = somaDias(HOJE, -n);
      if (diaDaSemana(dia) === 1 || diaDaSemana(dia) === 2) for (const h of [20, 21]) f[`${dia}|${h}`] = { posto: 1, filaFora: 20 };
    }
    return f;
  };

  it('compara a mesma hora do dia nas duas situações, e diz a força', () => {
    const p = montarPadroes(loja({ fora: comUmNoPico() }));
    const r = p.relacoes.find((x) => x.pergunta === 'Pessoas em Balcão · Dentro do balcão × “Fila no balcão”')!;
    assert.ok(r, JSON.stringify(p.relacoes.map((x) => x.pergunta)));
    assert.equal(r.forca, 'forte');
    assert.equal(r.titulo, 'Com menos de 2 em Balcão · Dentro do balcão, “Fila no balcão” fica mais tempo fora do critério');
    assert.deepEqual(r.linhas.map((l) => [l[0], Math.round(l[1]), l[2]]), [
      ['Com menos de 2 em Balcão · Dentro do balcão', 20, false],
      ['Com 2 ou mais', 4, true],
    ]);
    assert.equal(r.sufixo, 'das olhadas de “Fila no balcão” fora do critério');
    assert.equal(r.pe, '16 horas com menos de 2 · 32 com 2 ou mais · comparando as mesmas horas do dia (20h, 21h)', 'as horas vazias, em que o balcão tem sempre um, não entram');
    assert.equal(r.setorId, 's-atd');
  });

  it('sem os dois casos na mesma hora do dia, não há o que comparar', () => {
    // a loja de sempre: no pico há sempre dois, fora dele sempre um
    const p = montarPadroes(loja());
    assert.ok(!p.relacoes.some((x) => x.pergunta.includes('“Fila no balcão”')), JSON.stringify(p.relacoes.map((x) => x.pergunta)));
  });

  it('a medida e a taxa do MESMO critério não são descoberta; e relação é dentro do setor', () => {
    const p = montarPadroes(loja({ fora: comUmNoPico() }));
    assert.ok(!p.relacoes.some((x) => x.pergunta.startsWith('Pessoas em Balcão · Lado do cliente × “Fila no balcão”')));
    assert.ok(!p.relacoes.some((x) => x.pergunta.includes('Balcão') && x.pergunta.includes('Bancada limpa')), 'balcão é atendimento, bancada é cozinha');
  });

  it('taxa que não muda com a medida: sem relação', () => {
    // a chapa com duas pessoas em metade dos dias, no pico; a bancada igual nos dois casos
    const f: Record<string, Partial<Plano>> = {};
    for (let n = 1; n <= DIAS_DO_PADRAO; n += 1) if (n % 2) for (const h of [20, 21]) f[`${somaDias(HOJE, -n)}|${h}`] = { chapa: 2 };
    const r = montarPadroes(loja({ fora: f })).relacoes.find((x) => x.pergunta === 'Pessoas em Chapa × “Bancada limpa”')!;
    assert.equal(r.forca, 'nenhuma');
    assert.equal(r.titulo, '“Bancada limpa” não muda com o número de pessoas em Chapa');
    assert.deepEqual(r.linhas.map((l) => Math.round(l[1])), [15, 15]);
    // a touca e o uniforme nunca ficam fora do critério, com muita ou com pouca gente: não há o que mostrar
    const todas = montarPadroes(loja({ fora: f })).relacoes;
    const deMedida = todas.filter((x) => x.pergunta.startsWith('Pessoas em '));
    assert.ok(!deMedida.some((x) => x.pergunta.includes('Uso de touca') || x.pergunta.includes('Uniforme')), JSON.stringify(todas.map((x) => x.pergunta)));
    // relação que não é relação: as duas barras calmas
    assert.deepEqual(r.linhas.map((l) => l[2]), [true, true]);
    // o critério que vale em dois canais é dito com o canal
    const emDois = [...SERIES, { ...BANCADA, zonaId: 'z-m3', pontoNome: 'Montagem 3', pontoId: 'p-Montagem 3' }];
    const entrada = loja({ fora: f, series: emDois });
    entrada.celulas.push(...entrada.celulas.filter((c) => c.regraId === BANCADA.regraId).map((c) => ({ ...c, zonaId: 'z-m3' })));
    assert.deepEqual(
      montarPadroes(entrada).relacoes.filter((x) => x.pergunta.startsWith('Pessoas em ')).map((x) => x.titulo).sort(),
      ['“Bancada limpa” em Montagem 1 não muda com o número de pessoas em Chapa', '“Bancada limpa” em Montagem 3 não muda com o número de pessoas em Chapa'],
    );
  });
});

describe('o movimento e o que não deu para avaliar (sem banco)', () => {
  // a chapa com duas pessoas das 20h às 22h, todos os dias: a cozinha passa a ter pico
  const comPico = (mais: Partial<Plano> = {}): Record<string, Partial<Plano>> => {
    const f: Record<string, Partial<Plano>> = {};
    for (let n = 1; n <= DIAS_DO_PADRAO; n += 1) for (const h of [20, 21]) f[`${somaDias(HOJE, -n)}|${h}`] = { chapa: 2, ...mais };
    return f;
  };

  it('sem avaliar no pico e fora dele, do mesmo jeito: não é o movimento', () => {
    const p = montarPadroes(loja({ fora: comPico() }));
    const touca = p.relacoes.find((x) => x.pergunta === 'Movimento × “Uso de touca” sem avaliar em Montagem 2')!;
    assert.ok(touca, JSON.stringify(p.relacoes.map((x) => x.pergunta)));
    assert.deepEqual([touca.forca, touca.titulo, touca.setorId], ['nenhuma', '“Uso de touca” fica sem avaliar com a loja cheia ou vazia: não é o movimento', 's-coz']);
    assert.deepEqual(touca.linhas.map((l) => [l[0], Math.round(l[1]), l[2]]), [['Das 20h às 22h', 55, true], ['Nas outras horas', 55, true]]);
    assert.equal(touca.sufixo, 'das olhadas sem conseguir avaliar');
    // quadro inteiro e mais da metade sem avaliar: a frase aponta para a sugestão que existe
    assert.equal(touca.pe, 'Quando a taxa não muda com a hora, o problema é o que a câmera mostra — veja a sugestão de marcar um quadro.');
    assert.ok(p.sugestoes.some((s) => s.titulo === 'Marque um quadro em Montagem 2'));
    // com a área já marcada (o uniforme), a frase não promete uma sugestão que não vem
    const uniforme = p.relacoes.find((x) => x.pergunta === 'Movimento × “Uniforme completo” sem avaliar em Montagem 1')!;
    assert.equal(uniforme.pe, 'Quando a taxa não muda com a hora, o problema é o que a câmera mostra, e não o movimento.');
    assert.ok(!p.sugestoes.some((s) => s.titulo === 'Marque um quadro em Montagem 1'));
    // o mesmo com a touca abaixo da metade: a sugestão de área não existe, a frase não a cita
    const menos = comPico();
    for (let n = 1; n <= DIAS_DO_PADRAO; n += 1) for (const h of ABERTA) menos[`${somaDias(HOJE, -n)}|${h}`] = { ...(menos[`${somaDias(HOJE, -n)}|${h}`] ?? {}), toucaNa: 45 };
    const p2 = montarPadroes(loja({ fora: menos }));
    assert.equal(p2.relacoes.find((x) => x.pergunta.includes('Uso de touca'))!.pe, 'Quando a taxa não muda com a hora, o problema é o que a câmera mostra, e não o movimento.');
    assert.ok(!p2.sugestoes.some((s) => s.titulo === 'Marque um quadro em Montagem 2'));
  });

  it('quando muda com o movimento, a relação diz para que lado', () => {
    const noPico = montarPadroes(loja({ fora: comPico({ uniformeNa: 80 }) })).relacoes.find((x) => x.pergunta.includes('Uniforme completo'))!;
    assert.deepEqual([noPico.forca, noPico.titulo], ['forte', '“Uniforme completo” fica mais tempo sem avaliar no pico']);
    assert.deepEqual(noPico.linhas.map((l) => [l[0], Math.round(l[1]), l[2]]), [['Das 20h às 22h', 80, false], ['Nas outras horas', 40, true]]);
    // 24 dias abertos: duas horas de pico e cinco fora dele em cada um
    assert.equal(noPico.pe, '48 horas no pico · 120 fora dele');
    const foraDoPico = montarPadroes(loja({ fora: comPico({ uniformeNa: 10 }) })).relacoes.find((x) => x.pergunta.includes('Uniforme completo'))!;
    assert.deepEqual([foraDoPico.forca, foraDoPico.titulo], ['forte', '“Uniforme completo” fica mais tempo sem avaliar fora do pico']);
    assert.deepEqual(foraDoPico.linhas.map((l) => [Math.round(l[1]), l[2]]), [[10, true], [40, false]]);
    // diferença pequena não é relação — e aí as duas barras são calmas, mesmo com uma um pouco maior
    const quase = montarPadroes(loja({ fora: comPico({ uniformeNa: 45 }) })).relacoes.find((x) => x.pergunta.includes('Uniforme completo'))!;
    assert.deepEqual([quase.forca, quase.linhas.map((l) => [Math.round(l[1]), l[2]])], ['nenhuma', [[45, true], [40, true]]]);
    // a relação forte vem antes das que não são relação
    const todas = montarPadroes(loja({ fora: comPico({ uniformeNa: 80 }) })).relacoes;
    assert.equal(todas[0]!.pergunta, 'Movimento × “Uniforme completo” sem avaliar em Montagem 1');
  });

  it('sem pico no setor, ou com o critério que quase sempre avalia, não há o que comparar', () => {
    // a loja de sempre: a chapa tem uma pessoa o dia todo — a cozinha não tem pico
    assert.ok(!montarPadroes(loja()).relacoes.some((x) => x.pergunta.startsWith('Movimento ×')));
    const p = montarPadroes(loja({ fora: comPico() }));
    // a bancada avalia sempre; a fila e o balcão são do detector, que não fica sem avaliar
    assert.deepEqual(
      p.relacoes.filter((x) => x.pergunta.startsWith('Movimento ×')).map((x) => x.pergunta).sort(),
      ['Movimento × “Uniforme completo” sem avaliar em Montagem 1', 'Movimento × “Uso de touca” sem avaliar em Montagem 2'],
    );
    // o mesmo critério em dois canais: o título diz o canal
    const series = [...SERIES, { ...TOUCA, zonaId: 'z-m3', pontoNome: 'Montagem 3', pontoId: 'p-Montagem 3' }];
    const entrada = loja({ fora: comPico(), series });
    entrada.celulas.push(...entrada.celulas.filter((c) => c.regraId === TOUCA.regraId).map((c) => ({ ...c, zonaId: 'z-m3' })));
    assert.deepEqual(
      montarPadroes(entrada).relacoes.filter((x) => x.pergunta.includes('Uso de touca')).map((x) => x.titulo).sort(),
      [
        '“Uso de touca” em Montagem 2 fica sem avaliar com a loja cheia ou vazia: não é o movimento',
        '“Uso de touca” em Montagem 3 fica sem avaliar com a loja cheia ou vazia: não é o movimento',
      ],
    );
  });
});

// ───────────────────────── tendência ─────────────────────────

describe('para onde os números apontam (sem banco)', () => {
  it('hoje contra o normal do mesmo dia da semana, hora a hora', () => {
    const p = montarPadroes(loja({ fora: { [`${HOJE}|19`]: { fila: 6 } } }));
    const h = p.hojeContraONormal.find((x) => x.indicadorId === ind(FILA, 'medida'))!;
    assert.deepEqual([h.rotulo, h.diaDaSemana], ['Fila no balcão', 3]);
    assert.deepEqual(h.horas.map((x) => x.hora), ABERTA, 'as horas em que a quinta tem padrão, na ordem do dia');
    assert.deepEqual(h.horas.map((x) => x.completa), [true, true, true, false, false, false, false], 'são 21h: as três primeiras fecharam');
    assert.deepEqual(h.horas.map((x) => (x.visto === null ? null : Math.round(x.visto * 10) / 10)), [1, 6, 3.9, 4.1, null, null, null], 'a de agora já tem número, mas está incompleta');
    assert.ok(Math.abs(h.horas[2]!.media - 4) < 1e-9 && Math.abs(h.horas[2]!.min - 3.88) < 1e-9 && Math.abs(h.horas[2]!.max - 4.12) < 1e-9);
    assert.equal(h.nota, 'Fora da faixa do normal: 19h. O esperado daqui em diante: 2,5 às 22h, 1,0 às 23h, 1,0 às 00h. A hora corrente ainda está incompleta.');
    const calmo = montarPadroes(loja()).hojeContraONormal.find((x) => x.indicadorId === ind(FILA, 'medida'))!;
    assert.match(calmo.nota, /^Até agora, o dia está dentro do normal\. /);
    const cedo = montarPadroes(loja({ horaAgora: 18 })).hojeContraONormal.find((x) => x.indicadorId === ind(FILA, 'medida'))!;
    assert.match(cedo.nota, /^Hoje ainda não há hora inteira medida\. O esperado daqui em diante: 2,5 às 19h/);
    // antes de a loja abrir não há "hora corrente": a frase só fala dela quando ela é uma das que têm padrão
    const fechada = montarPadroes(loja({ horaAgora: 14 })).hojeContraONormal.find((x) => x.indicadorId === ind(FILA, 'medida'))!;
    assert.equal(fechada.nota, 'Hoje ainda não há hora inteira medida. O esperado daqui em diante: 1,0 às 18h, 2,5 às 19h, 4,0 às 20h, 4,2 às 21h, 2,5 às 22h, 1,0 às 23h, 1,0 às 00h.');
    assert.ok(cedo.nota.endsWith(' A hora corrente ainda está incompleta.'), cedo.nota);
    // só a medida tem este gráfico
    assert.deepEqual(p.hojeContraONormal.map((x) => x.rotulo), ['Fila no balcão', 'Alguém no balcão', 'Chapa com gente']);
    // o mesmo critério em dois canais: cada opção diz o canal — duas opções nunca têm o mesmo nome
    const emDois = loja({ series: [...SERIES, { ...CHAPA, zonaId: 'z-ch2', pontoNome: 'Chapa 2', pontoId: 'p-Chapa 2' }] });
    emDois.celulas.push(...emDois.celulas.filter((c) => c.regraId === CHAPA.regraId).map((c) => ({ ...c, zonaId: 'z-ch2' })));
    assert.deepEqual(
      montarPadroes(emDois).hojeContraONormal.map((x) => x.rotulo),
      ['Fila no balcão', 'Alguém no balcão', 'Chapa com gente · Chapa', 'Chapa com gente · Chapa 2'],
    );
  });

  it('a hora mais cheia, nas últimas quatro vezes em que aquele dia aconteceu', () => {
    const p = montarPadroes(loja());
    const t = p.tendencias.find((x) => x.titulo === 'Chapa com gente no pico de sábado')!;
    assert.ok(t, JSON.stringify(p.tendencias.map((x) => x.titulo)));
    assert.equal(t.sentido, 'estável');
    assert.equal(t.ruim, 'cai', 'critério que pede gente: o ruim é cair');
    assert.equal(t.limite, null);
    assert.equal(plana(t.texto), '1,9 → 2,1 → 1,9 → 2,1 nos últimos quatro sábados. Sem mudança que peça ação.', 'série que só oscila não é queda nem subida');
  });

  it('a fila do sábado crescendo: quantas semanas até encostar no limite', () => {
    // sábado às 21h: 5,88 × (0,76 · 0,84 · 0,92 · 1,00) — 0,47 a mais por semana
    const t = montarPadroes(loja()).tendencias.find((x) => x.titulo === 'Fila no balcão no pico de sábado')!;
    assert.deepEqual(t.serie.map((v) => Math.round(v * 100) / 100), [4.47, 4.94, 5.41, 5.88]);
    assert.deepEqual([t.sentido, t.seguidas, t.ruim, t.limite], ['sobe', 3, 'sobe', 7], 'critério com limite máximo: o ruim é subir');
    assert.deepEqual([t.valor, t.legenda, t.setorId], ['5,9', 'pessoas, sábado às 21h', 's-atd']);
    assert.equal(plana(t.texto), '4,5 → 4,9 → 5,4 → 5,9 nos últimos quatro sábados. No mesmo ritmo, a média da hora encosta no limite de 7 em cerca de 2 semanas.', '(7 − 5,88) / 0,47 = 2,4 semanas');
    // sem crescer, a mesma hora fica estável e não fala de limite
    const parada = montarPadroes(loja({ crescendo: false })).tendencias.find((x) => x.titulo === 'Fila no balcão no pico de sábado')!;
    assert.equal(parada.sentido, 'estável');
    assert.match(plana(parada.texto), /nos últimos quatro sábados\. Sem mudança que peça ação\.$/);
    // dia da semana no feminino
    const f: Record<string, Partial<Plano>> = {};
    for (let n = 1; n <= DIAS_DO_PADRAO; n += 1) if (diaDaSemana(somaDias(HOJE, -n)) === 4) f[`${somaDias(HOJE, -n)}|21`] = { fila: 8 };
    const sexta = montarPadroes(loja({ fora: f })).tendencias.find((x) => x.titulo === 'Fila no balcão no pico de sexta')!;
    assert.equal(plana(sexta.texto), '8,0 → 8,0 → 8,0 → 8,0 nas últimas quatro sextas. Sem mudança que peça ação.');
  });

  it('a taxa semana a semana, com a correção registrada', () => {
    const r = revisao(BANCADA, 'fora', '2026-09-26', 21, { estado: 'problema', em: '2026-09-27' });
    const t = montarPadroes(loja({ revisoes: [r] })).tendencias.find((x) => x.titulo === 'Bancada limpa fora do critério')!;
    assert.deepEqual(t.serie.map(Math.round), [11, 11, 11, 11]);
    assert.deepEqual([t.sentido, t.ruim, t.valor, t.legenda], ['estável', 'sobe', '11%', 'das olhadas, na última semana']);
    assert.equal(plana(t.texto), '11% → 11% → 11% → 11% nas últimas quatro semanas, em Montagem 1. Há uma correção registrada em 27/09.');
    assert.equal(plana(montarPadroes(loja()).tendencias.find((x) => x.titulo === 'Bancada limpa fora do critério')!.texto), '11% → 11% → 11% → 11% nas últimas quatro semanas, em Montagem 1.');
    // um ponto percentual a mais na última semana não é "sobe"; dobrar é
    const umPouco: Record<string, Partial<Plano>> = {};
    const muito: Record<string, Partial<Plano>> = {};
    for (let n = 1; n <= 7; n += 1) {
      if (n <= 3) umPouco[`${somaDias(HOJE, -n)}|19`] = { bancadaFora: 30 };
      for (const h of ABERTA) muito[`${somaDias(HOJE, -n)}|${h}`] = { bancadaFora: 25 };
    }
    const quase = montarPadroes(loja({ fora: umPouco })).tendencias.find((x) => x.titulo === 'Bancada limpa fora do critério')!;
    assert.deepEqual([quase.serie.map(Math.round), quase.sentido], [[11, 11, 11, 12], 'estável']);
    const dobrou = montarPadroes(loja({ fora: muito })).tendencias.find((x) => x.titulo === 'Bancada limpa fora do critério')!;
    assert.deepEqual([dobrou.serie.map(Math.round), dobrou.sentido, dobrou.seguidas], [[11, 11, 11, 25], 'sobe', 1]);
    // taxa que quase nunca acontece não vira cartão de tendência
    assert.ok(!montarPadroes(loja()).tendencias.some((x) => x.titulo === 'Fila no balcão fora do critério'));
  });

  it('o gasto com a nuvem e o disco da máquina de análise', () => {
    const p = montarPadroes(loja());
    const gasto = p.tendencias.find((x) => x.titulo === 'Gasto com a nuvem')!;
    assert.deepEqual([gasto.setorId, gasto.sentido, gasto.valor, gasto.legenda], ['loja', 'estável', 'R$ 2,52', 'por dia com análise'], 'três critérios × sete horas × 12 centavos');
    assert.match(plana(gasto.texto), /^R\$ 2,52 → R\$ 2,52 → R\$ 2,52 → R\$ 2,52 por dia, semana a semana\. Não mudou:/);
    const disco = p.tendencias.find((x) => x.titulo === 'Disco da máquina de análise')!;
    assert.deepEqual([disco.setorId, disco.sentido, disco.ruim, disco.valor, disco.legenda], ['loja', 'cai', 'cai', '78', 'GB livres de 240']);
    assert.equal(plana(disco.texto), '0,8 GB a menos por dia. Nesse ritmo o disco enche em cerca de 97 dias, por volta de 13/01.');
    // sem leitura do disco, ou com ele parado, não há o que dizer
    assert.ok(!montarPadroes(loja({ comDisco: false })).tendencias.some((x) => x.titulo.startsWith('Disco')));
    const parado = loja();
    parado.disco = parado.disco.map((d) => ({ ...d, livreGb: 80 }));
    assert.equal(plana(montarPadroes(parado).tendencias.find((x) => x.titulo.startsWith('Disco'))!.texto), 'O espaço livre não está caindo.');
    // loja sem critério na nuvem não tem gasto para mostrar
    assert.ok(!montarPadroes(loja({ series: [FILA, POSTO, CHAPA] })).tendencias.some((x) => x.titulo === 'Gasto com a nuvem'));
  });

  it('o parecer da tendência: a que anda no sentido ruim primeiro', () => {
    assert.match(plana(montarPadroes(loja()).parecer.tendencia!), /^Fila no balcão no pico de sábado: sobe há 3 semanas\. 4,5 → 4,9 → 5,4 → 5,9 nos últimos quatro sábados\. No mesmo ritmo/);
    assert.match(plana(montarPadroes(loja({ crescendo: false })).parecer.tendencia!), /^Disco da máquina de análise: cai há 3 semanas\. 0,8 GB a menos por dia\./);
    assert.match(plana(montarPadroes(loja({ crescendo: false, comDisco: false })).parecer.tendencia!), /: estável\. /, 'sem nada no sentido ruim, a primeira da lista');
    assert.equal(montarPadroes(loja({ dias: 8, comDisco: false })).parecer.tendencia, null, 'uma semana não faz tendência');
  });
});

// ───────────────────────── sugestões ─────────────────────────

describe('o que os números mostram sobre os próprios critérios (sem banco)', () => {
  const titulos = (e: Entrada) => montarPadroes(e).sugestoes.map((s) => s.titulo);

  it('cada sugestão sai de um número, e leva à ação certa', () => {
    const p = montarPadroes(loja());
    assert.deepEqual(p.sugestoes.map((s) => [s.setorId, s.icone, s.titulo]), [
      ['s-atd', 'duvida', '“Alguém no balcão” nunca ficou fora do critério: vale manter?'],
      ['s-coz', 'area', 'Marque um quadro em Montagem 2'],
      ['s-coz', 'pessoa', 'Só confira “Uniforme completo” com alguém na área'],
      ['s-coz', 'foto', 'Use a foto padrão em “Bancada limpa”'],
      ['s-coz', 'duvida', '“Chapa com gente” nunca ficou fora do critério: vale manter?'],
    ], 'na ordem dos setores; dentro de cada um, pelo título, com a dúvida por último');
    const [, area, pessoa, foto, duvida] = p.sugestoes;
    assert.equal(plana(area!.texto), '“Uso de touca” não consegue avaliar em 55% das olhadas neste canal. Em 24 dias, R$ 11,09 foram gastos em perguntas que voltaram sem resposta. A pergunta é feita sobre a imagem completa; com o critério num quadro marcado, a imagem que sobe é só o que importa.');
    assert.deepEqual(area!.acao, { tipo: 'area', rotulo: 'Abrir o canal', pontoId: 'p-Montagem 2' });
    assert.match(plana(pessoa!.texto), /^Em Montagem 1, ele não dá para avaliar em 40% das olhadas — cerca de R\$ 8,06 em 24 dias\. /);
    assert.deepEqual(pessoa!.acao, { tipo: 'criterio', rotulo: 'Ajustar o critério', regraId: 'r-uniforme', porteiro: 'pessoa' });
    assert.match(plana(foto!.texto), /^Hoje cada olhada de Montagem 1 vai à nuvem: 3\.360 análises e R\$ 20,16 em 24 dias\./);
    // o uniforme também é de estado e também custa, mas quase não consegue avaliar: a foto não resolve isso
    assert.ok(!p.sugestoes.some((s) => s.titulo === 'Use a foto padrão em “Uniforme completo”'));
    assert.deepEqual(foto!.acao, { tipo: 'area', rotulo: 'Ver a foto padrão', pontoId: 'p-Montagem 1' });
    assert.equal(plana(duvida!.texto), 'Em 24 dias foram 20.160 olhadas em Chapa e nenhuma fora do critério. Se o limite está folgado demais, ele não avisa do que importa; se está certo, é só a confirmação de que vai bem.');
    assert.deepEqual(duvida!.acao, { tipo: 'criterio', rotulo: 'Ver o critério', regraId: 'r-chapa' });
  });

  it('critério em vários canais: uma sugestão por critério ou por canal, e o título diz o canal', () => {
    // a touca vale em Montagem 2 (quadro inteiro) e em Montagem 3 (área marcada), e não avalia em nenhuma das duas;
    // a bancada vale em Montagem 1 e em Montagem 3
    const series = [
      ...SERIES,
      { ...TOUCA, zonaId: 'z-m3', pontoNome: 'Montagem 3', pontoId: 'p-Montagem 3', areaDesenhada: true },
      { ...BANCADA, zonaId: 'z-m3', pontoNome: 'Montagem 3', pontoId: 'p-Montagem 3' },
    ];
    const entrada = loja({ series });
    entrada.celulas.push(...entrada.celulas.filter((c) => c.regraId === TOUCA.regraId || c.regraId === BANCADA.regraId).map((c) => ({ ...c, zonaId: 'z-m3' })));
    const p = montarPadroes(entrada);
    const doSetor = p.sugestoes.filter((s) => s.setorId === 's-coz').map((s) => s.titulo);
    assert.deepEqual(doSetor, [
      'Marque um quadro em Montagem 2',
      'Só confira “Uniforme completo” com alguém na área',
      'Só confira “Uso de touca” com alguém na área',
      'Use a foto padrão em “Bancada limpa” (Montagem 1)',
      'Use a foto padrão em “Bancada limpa” (Montagem 3)',
      '“Chapa com gente” nunca ficou fora do critério: vale manter?',
    ]);
    assert.equal(new Set(p.sugestoes.map((s) => s.titulo)).size, p.sugestoes.length, 'nenhum título repetido');
    // a tendência da taxa é UM cartão por critério, juntando os canais do setor — e o texto diz quais
    const daBancada = p.tendencias.filter((x) => x.titulo.startsWith('Bancada limpa fora do critério'));
    assert.deepEqual(daBancada.map((x) => [x.titulo, plana(x.texto)]), [['Bancada limpa fora do critério', '11% → 11% → 11% → 11% nas últimas quatro semanas, em Montagem 1 e Montagem 3.']]);
    // a correção registrada num dos canais é dita com o canal
    const corrigida = montarPadroes({ ...entrada, revisoes: [revisao({ ...BANCADA, zonaId: 'z-m3' }, 'fora', '2026-09-26', 21, { estado: 'problema', em: '2026-09-27' })] });
    assert.equal(
      plana(corrigida.tendencias.find((x) => x.titulo === 'Bancada limpa fora do critério')!.texto),
      '11% → 11% → 11% → 11% nas últimas quatro semanas, em Montagem 1 e Montagem 3. Há uma correção registrada em 27/09, em Montagem 3.',
    );
    // os números são os dos dois canais juntos: com o segundo canal sempre fora do critério em 50%, a taxa é a média
    const metade = loja({ series });
    metade.celulas.push(...metade.celulas.filter((c) => c.regraId === BANCADA.regraId).map((c) => ({ ...c, zonaId: 'z-m3', fora: 10 })));
    assert.deepEqual(montarPadroes(metade).tendencias.find((x) => x.titulo === 'Bancada limpa fora do critério')!.serie.map(Math.round), [31, 31, 31, 31]);
    // o mesmo critério num canal de OUTRO setor tem o cartão dele, e o título diz de qual setor é cada um
    const doisSetores = loja({ series: [...SERIES, { ...BANCADA, zonaId: 'z-bal', pontoNome: 'Balcão', pontoId: 'p-Balcão', setorId: 's-atd', setorNome: 'Atendimento' }] });
    doisSetores.celulas.push(...doisSetores.celulas.filter((c) => c.regraId === BANCADA.regraId).map((c) => ({ ...c, zonaId: 'z-bal' })));
    assert.deepEqual(
      montarPadroes(doisSetores).tendencias.filter((x) => x.titulo.startsWith('Bancada limpa')).map((x) => [x.setorId, x.titulo]).sort(),
      [['s-atd', 'Bancada limpa fora do critério · Atendimento'], ['s-coz', 'Bancada limpa fora do critério · Cozinha']],
    );
    assert.equal(new Set(p.tendencias.map((x) => x.titulo)).size, p.tendencias.length, 'nenhum cartão de tendência com o título de outro');
    assert.equal(new Set(p.relacoes.map((x) => x.pergunta)).size, p.relacoes.length, 'nem relação');
    for (const d of p.descricoes) assert.equal(new Set(d.fatos.map((f) => f[0])).size, d.fatos.length, `nem fato em ${d.setor}`);
    assert.equal(new Set(p.indicadores.map((i) => i.nome)).size, p.indicadores.length, 'nem indicador');
    // dois critérios sem avaliar no MESMO canal de quadro inteiro: uma sugestão de marcar a área, e a do segundo é a da pessoa
    // (os números são gerados primeiro e a série mudada depois: mudando antes, o gerador não a reconhece e ela fica sem número)
    const noMesmo = loja();
    noMesmo.series = noMesmo.series.map((x) => (x.regraId === UNIFORME.regraId ? { ...x, zonaId: 'z-m2', pontoNome: 'Montagem 2', pontoId: 'p-Montagem 2', zonaNome: 'Quadro inteiro', areaDesenhada: false } : x));
    for (const c of noMesmo.celulas) if (c.regraId === UNIFORME.regraId) Object.assign(c, { zonaId: 'z-m2', na: 12 });
    assert.ok(montarPadroes(noMesmo).indicadores.some((i) => i.regraId === UNIFORME.regraId && i.onde === 'Montagem 2'), 'o uniforme está mesmo em Montagem 2, com números');
    const t2 = titulos(noMesmo);
    assert.equal(t2.filter((x) => x === 'Marque um quadro em Montagem 2').length, 1, JSON.stringify(t2));
    assert.ok(t2.includes('Só confira “Uso de touca” com alguém na área'), 'o segundo critério do canal fica com a outra sugestão');
    // nos fatos do setor a taxa é do critério, juntando os canais: uma linha só
    const fatos = p.descricoes.find((d) => d.setorId === 's-coz')!.fatos.map((f) => f[0]);
    assert.deepEqual(fatos.filter((f) => f.startsWith('Bancada limpa')), ['Bancada limpa fora do critério'], JSON.stringify(fatos));
  });

  it('a foto padrão é sugerida para o critério que de fato varia', () => {
    // a touca em Montagem 2 com a área marcada e avaliando quase sempre: custa, é de estado, mas nunca fica fora — a foto do lugar vazio não é o que ela precisa
    const avalia = loja({ series: SERIES.map((x) => (x === TOUCA ? { ...x, areaDesenhada: true } : x)) });
    for (const c of avalia.celulas) if (c.regraId === TOUCA.regraId) c.na = 1;
    const t3 = titulos(avalia);
    assert.ok(!t3.some((x) => x.includes('foto padrão em “Uso de touca”')), JSON.stringify(t3));
    assert.ok(t3.includes('Use a foto padrão em “Bancada limpa”'));
  });

  it('o que desliga cada sugestão', () => {
    const com = (s: Serie, mais: Partial<Serie>) => loja({ series: SERIES.map((x) => (x === s ? { ...x, ...mais } : x)) });
    // a área já está marcada: o problema não é o quadro inteiro
    assert.ok(!titulos(com(TOUCA, { areaDesenhada: true })).includes('Marque um quadro em Montagem 2'));
    assert.ok(titulos(com(TOUCA, { areaDesenhada: true })).includes('Só confira “Uso de touca” com alguém na área'), 'aí vale a outra');
    // o porteiro já confere se há gente
    assert.ok(!titulos(com(UNIFORME, { porteiro: 'pessoa' })).includes('Só confira “Uniforme completo” com alguém na área'));
    // o canal já tem foto padrão, ou o critério já a manda junto
    assert.ok(!titulos(com(BANCADA, { fotosPadrao: 1 })).some((t) => t.startsWith('Use a foto padrão')));
    assert.ok(!titulos(com(BANCADA, { comPadrao: true })).some((t) => t.startsWith('Use a foto padrão')));
    // critério desligado, ou com pouco tempo de história, não é "nunca ficou fora"
    assert.ok(!titulos(com(CHAPA, { ativa: false })).some((t) => t.startsWith('“Chapa com gente” nunca')));
    assert.ok(titulos(com(CHAPA, { ativa: false })).some((t) => t.startsWith('“Alguém no balcão” nunca')), 'o outro critério continua ligado');
    assert.ok(!titulos(loja({ dias: 10 })).some((t) => t.includes('nunca ficou fora')), 'com menos de duas semanas é cedo');
    // o balcão nunca ficou fora, mas o da fila ficou: só o primeiro é dúvida
    assert.deepEqual(titulos(loja({ series: [FILA, POSTO] })), ['“Alguém no balcão” nunca ficou fora do critério: vale manter?']);
    // o que não consegue avaliar tem outro problema antes: não é dúvida — mesmo sendo o único candidato
    assert.deepEqual(titulos(loja({ series: [FILA, UNIFORME] })), ['Só confira “Uniforme completo” com alguém na área']);
  });

  it('a dúvida vale para poucos de cada vez: os dois critérios de mais olhadas', () => {
    // a chapa em três canais, todos sem nunca ficar fora — e no terceiro ela é olhada o dobro de vezes
    const outra = (n: number): Serie => ({ ...CHAPA, zonaId: `z-chapa-${n}`, pontoNome: `Chapa ${n}`, pontoId: `p-Chapa ${n}` });
    const e = loja({ series: [...SERIES, outra(2), outra(3)] });
    const daChapa = e.celulas.filter((c) => c.regraId === CHAPA.regraId);
    e.celulas.push(...daChapa.map((c) => ({ ...c, zonaId: 'z-chapa-2' })), ...daChapa.map((c) => ({ ...c, zonaId: 'z-chapa-3', julgadas: 240, comMedida: 240, somaMedida: c.somaMedida * 2 })));
    const duvidas = montarPadroes(e).sugestoes.filter((s) => s.icone === 'duvida').map((s) => s.titulo);
    // quatro candidatos (o balcão e a chapa em três canais): ficam o de 40.320 olhadas e o primeiro dos de 20.160
    assert.deepEqual(duvidas, ['“Alguém no balcão” nunca ficou fora do critério: vale manter?', '“Chapa com gente” (Chapa 3) nunca ficou fora do critério: vale manter?']);
  });

  it('da relação forte nasce o critério que ninguém pensou em cadastrar', () => {
    const f: Record<string, Partial<Plano>> = {};
    for (let n = 1; n <= DIAS_DO_PADRAO; n += 1) {
      const dia = somaDias(HOJE, -n);
      if (diaDaSemana(dia) === 1 || diaDaSemana(dia) === 2) for (const h of [20, 21]) f[`${dia}|${h}`] = { posto: 1, filaFora: 20 };
    }
    const p = montarPadroes(loja({ fora: f }));
    const s = p.sugestoes.find((x) => x.icone === 'criterio')!;
    // a relação foi medida às 20h e às 21h, que são o pico do setor: é nessas horas que o critério vale
    assert.equal(s.titulo, 'Crie o critério “Pelo menos 2 em Balcão · Dentro do balcão no pico”');
    assert.equal(s.setorId, 's-atd');
    assert.equal(plana(s.texto), 'Em 24 dias, Balcão · Dentro do balcão ficou com menos de 2 em 16 horas. Nessas horas “Fila no balcão” fica fora do critério em 20% das olhadas; com 2 ou mais, em 4%. Hoje “Alguém no balcão” só pede 1.');
    assert.equal(s.acao.tipo, 'criar');
    assert.deepEqual(s.acao.tipo === 'criar' && [s.acao.criterio.minimo, s.acao.criterio.zonaId, s.acao.criterio.objeto], [2, 'z-dentro', 'pessoa']);
    assert.deepEqual(
      s.acao.tipo === 'criar' && [s.acao.criterio.janela, s.acao.criterio.texto],
      [['20:00', '22:00'], 'Das 20h às 22h há pelo menos 2 pessoas em Balcão · Dentro do balcão.'],
      'sem a faixa de horas ele avisaria o dia todo: antes das 19h e depois das 23h o balcão tem uma pessoa mesmo',
    );
    // horas que não são o pico do setor: a faixa é dita pelas horas (às 19h o balcão também costuma ter dois)
    const nasHoras = (hs: number[]) => {
      const g: Record<string, Partial<Plano>> = {};
      for (let n = 1; n <= DIAS_DO_PADRAO; n += 1) {
        const dia = somaDias(HOJE, -n);
        if (diaDaSemana(dia) === 1 || diaDaSemana(dia) === 2) for (const h of hs) g[`${dia}|${h}`] = { posto: 1, filaFora: 20 };
      }
      const sg = montarPadroes(loja({ fora: g })).sugestoes.find((x) => x.icone === 'criterio')!;
      return sg.acao.tipo === 'criar' ? [sg.acao.criterio.nome, sg.acao.criterio.janela] : null;
    };
    assert.deepEqual(nasHoras([19, 20]), ['Pelo menos 2 em Balcão · Dentro do balcão das 19h às 21h', ['19:00', '21:00']]);
    // horas separadas (19h e 21h) não cabem numa faixa só: fica o primeiro trecho, e não o dia inteiro
    assert.deepEqual(nasHoras([19, 21]), ['Pelo menos 2 em Balcão · Dentro do balcão das 19h às 20h', ['19:00', '20:00']]);
    // uma hora separada e duas seguidas: fica o trecho maior
    assert.deepEqual(nasHoras([19, 21, 22]), ['Pelo menos 2 em Balcão · Dentro do balcão das 21h às 23h', ['21:00', '23:00']]);
    assert.ok(p.sugestoes.indexOf(s) < p.sugestoes.findIndex((x) => x.setorId === 's-coz'), 'na ordem dos setores: atendimento primeiro');
    // o critério do balcão já pede dois: não há o que criar
    const jaPede = montarPadroes(loja({ fora: f, series: SERIES.map((x) => (x === POSTO ? { ...x, minimo: 2 } : x)) }));
    assert.ok(!jaPede.sugestoes.some((x) => x.icone === 'criterio'));
  });

  it('o parecer de frequência é o começo da descrição do primeiro setor com número', () => {
    assert.equal(
      montarPadroes(loja()).parecer.frequencia,
      'Em Balcão · Lado do cliente, o movimento tem pico das 20h às 22h: 4,4 pessoas, em média. Em Balcão · Dentro do balcão, o movimento tem pico das 19h às 23h: 2,0 pessoas, em média.',
    );
  });
});

// ───────────────────────── os limites, um a um ─────────────────────────
// Cada caso aqui existe porque uma troca de uma linha no motor passou sem que nenhum teste acusasse.

describe('os limites de amostra (sem banco)', () => {
  const doBalcao = (p: Padroes, dia: string, hora: number) => p.anomalias.find((a) => a.regraId === POSTO.regraId && a.tipo === 'medida' && a.dia === dia && a.hora === hora);

  it('número de critério que não existe mais não entra em nada', () => {
    const e = loja();
    // uma segunda (a loja fecha às segundas) com números de um critério que foi excluído
    const segunda = '2026-10-05';
    assert.equal(diaDaSemana(segunda), 0);
    e.celulas.push({
      dia: segunda, hora: 20, regraId: 'r-apagada', zonaId: 'z-apagada', julgadas: 120, fora: 60, na: 0, extras: 0, extrasFora: 0,
      somaMedida: 600, comMedida: 120, maxMedida: 9, alertas: 4, emSilencio: 0, custoCentavos: 50,
    });
    const p = montarPadroes(e);
    assert.equal(p.base.dias, 24, 'a segunda continua sem análise');
    assert.deepEqual(p, montarPadroes(loja()), 'e nada muda');
  });

  it('com uma amostra só daquele dia da semana não há "normal das quartas"', () => {
    const fora = { [`${ONTEM}|20`]: { posto: 1.1 } };
    // das três quartas de antes, duas foram marcadas como "foi só desta vez": sobra uma
    const tiradas = ['2026-09-30', '2026-09-23'].map((d) => revisao(POSTO, 'medida', d, 20, { soDestaVez: true }));
    assert.equal(doBalcao(montarPadroes(loja({ fora, revisoes: tiradas })), ONTEM, 20), undefined, 'uma quarta só não é costume');
    // com uma só tirada sobram duas: aí há normal, e a hora é apontada
    const a = doBalcao(montarPadroes(loja({ fora, revisoes: tiradas.slice(0, 1) })), ONTEM, 20)!;
    assert.deepEqual([a.normal.n, a.normal.base], [2, 'dia']);
  });

  it('loja nova: hora com menos de cinco dias medidos ainda não tem normal', () => {
    const fora = { [`${ONTEM}|0`]: { posto: 3 } };
    const e = loja({ dias: 9, fora });
    // a meia-noite só passou a ser medida nos últimos três dias
    e.celulas = e.celulas.filter((c) => !(c.regraId === POSTO.regraId && c.hora === 0 && c.dia < somaDias(HOJE, -3)));
    const p = montarPadroes(e);
    assert.deepEqual([p.suficiente, p.base.firme], [true, false]);
    assert.equal(doBalcao(p, ONTEM, 0), undefined, 'um dia de antes não é normal');
    // com a semana inteira medida, a mesma hora é apontada
    assert.ok(doBalcao(montarPadroes(loja({ dias: 9, fora })), ONTEM, 0));
  });

  it('série do detector que não mediu (agente antigo) não tem indicador de medida', () => {
    const e = loja();
    for (const c of e.celulas) if (c.regraId === CHAPA.regraId) Object.assign(c, { comMedida: 0, somaMedida: 0, maxMedida: null });
    const p = montarPadroes(e);
    assert.ok(!p.indicadores.some((i) => i.id === ind(CHAPA, 'medida')));
    assert.ok(p.indicadores.some((i) => i.id === ind(CHAPA, 'fora')), 'a taxa continua');
  });

  it('critério com poucas olhadas no período não tem taxa a mostrar', () => {
    const e = loja();
    // o uniforme só foi olhado em duas horas: 40 olhadas
    let deixadas = 0;
    e.celulas = e.celulas.filter((c) => c.regraId !== UNIFORME.regraId || (deixadas += 1) <= 2);
    assert.ok(!montarPadroes(e).indicadores.some((i) => i.regraId === UNIFORME.regraId));
  });

  it('hoje contra o normal precisa de duas horas com padrão', () => {
    const e = loja();
    e.celulas = e.celulas.filter((c) => c.regraId !== POSTO.regraId || c.hora === 20);
    const p = montarPadroes(e);
    assert.ok(p.indicadores.some((i) => i.id === ind(POSTO, 'medida')), 'o indicador existe');
    assert.ok(!p.hojeContraONormal.some((h) => h.indicadorId === ind(POSTO, 'medida')), 'mas uma hora só não faz gráfico');
  });
});

describe('os limites das saídas do padrão (sem banco)', () => {
  const saidas = (fora: Record<string, Partial<Plano>>, mais: Loja = {}) => montarPadroes(loja({ fora, ...mais })).anomalias;

  it('passar da faixa por um triz, a meio passo do meio, ainda é ruído', () => {
    // terça 06/10 às 20h: nas três terças de antes o balcão teve 2,06, 1,94 e 2,06 — o meio e o teto são 2,06
    assert.deepEqual(saidas({ ['2026-10-06|20']: { posto: 2.6 } }), [], '2,6 passa do teto mais a folga (2,56), mas fica a 0,54 do meio');
    assert.equal(saidas({ ['2026-10-06|20']: { posto: 2.7 } }).length, 1, 'com 2,7 já é saída do padrão');
  });

  it('taxa muito fora do normal: quarenta pontos ou mais acima', () => {
    const [a] = saidas({ ['2026-10-02|21']: { bancadaFora: 60 } });
    assert.deepEqual([a!.tipo, a!.grave, Math.round(a!.visto), Math.round(a!.normal.mediana)], ['fora', true, 60, 15]);
  });

  it('a correção não propõe o que o critério já pede', () => {
    // o balcão já pede duas pessoas: com uma, o critério já avisa — não há limite novo a propor
    const pedeDois = SERIES.map((x) => (x.regraId === POSTO.regraId ? { ...x, minimo: 2 } : x));
    const [menos] = saidas({ [`${ONTEM}|20`]: { posto: 1.1 } }, { series: pedeDois });
    assert.deepEqual([menos!.titulo, menos!.criterio], ['“Alguém no balcão”: menos pessoas do que o normal', null]);
    // a fila já tem limite de 2, que é o costume da abertura
    const limiteDois = SERIES.map((x) => (x.regraId === FILA.regraId ? { ...x, maximo: 2 } : x));
    const [mais] = saidas({ ['2026-10-03|18']: { fila: 4 } }, { series: limiteDois });
    assert.deepEqual([mais!.titulo, mais!.criterio], ['“Fila no balcão”: mais pessoas do que o normal', null]);
  });

  it('"ele só pede 1" só quando o que foi visto cumpriu o pedido', () => {
    // 0,9 pessoa em média: o critério pede uma e não havia — ele mesmo ficou fora, não há o que explicar
    const [a] = saidas({ [`${ONTEM}|20`]: { posto: 0.9 } });
    assert.equal(a!.mais, 'Na mesma hora, o critério ficou fora em 0% das olhadas e avisou 0 vezes.');
  });
});

describe('os limites do que anda junto (sem banco)', () => {
  const tercasEQuartas = (plano: (hora: number) => Partial<Plano>, horas = [20, 21], outros?: (hora: number) => Partial<Plano>): Record<string, Partial<Plano>> => {
    const f: Record<string, Partial<Plano>> = {};
    for (let n = 1; n <= DIAS_DO_PADRAO; n += 1) {
      const dia = somaDias(HOJE, -n);
      const fraco = diaDaSemana(dia) === 1 || diaDaSemana(dia) === 2;
      for (const h of horas) {
        if (fraco) f[`${dia}|${h}`] = plano(h);
        else if (outros) f[`${dia}|${h}`] = outros(h);
      }
    }
    return f;
  };
  const doBalcao = (p: Padroes) => p.relacoes.find((x) => x.pergunta === 'Pessoas em Balcão · Dentro do balcão × “Fila no balcão”');

  it('relação moderada é dita como moderada — e não vira critério sugerido', () => {
    // com uma pessoa no balcão a fila passa do limite em 6% das olhadas; com duas, em 4%
    const p = montarPadroes(loja({ fora: tercasEQuartas(() => ({ posto: 1, filaFora: 6 })) }));
    const r = doBalcao(p)!;
    assert.deepEqual([r.forca, r.linhas.map((l) => Math.round(l[1]))], ['moderada', [6, 4]]);
    assert.ok(!p.sugestoes.some((s) => s.icone === 'criterio'), 'só a relação forte sugere critério');
  });

  it('relação só se diz com amostra: dois dias não bastam', () => {
    const f: Record<string, Partial<Plano>> = {};
    for (const dia of ['2026-10-06', '2026-09-29']) for (const h of [20, 21]) f[`${dia}|${h}`] = { posto: 1, filaFora: 20 };
    assert.equal(doBalcao(montarPadroes(loja({ fora: f }))), undefined, 'quatro horas com o balcão vazio é pouco para dizer');
  });

  it('a medida e a taxa do MESMO critério não viram relação, mesmo havendo os dois casos', () => {
    // terças e quartas com a fila pela metade no pico (e sem passar do limite): "com menos gente na fila, a
    // fila passa menos do limite" é a definição do critério, não uma descoberta
    // (às 19h e às 22h a fila fica em 2 todo dia: só o pico tem os dois casos)
    const noPico = (h: number): boolean => h === 20 || h === 21;
    const fora = tercasEQuartas((h) => (noPico(h) ? { fila: 2, filaFora: 0 } : { fila: 2 }), [19, 20, 21, 22], (h) => (noPico(h) ? {} : { fila: 2 }));
    const p = montarPadroes(loja({ fora }));
    assert.deepEqual(p.relacoes.filter((x) => x.pergunta.includes('“Fila no balcão”')).map((x) => x.pergunta), []);
    // os dois casos existem mesmo: a mesma fila, comparada com OUTRO critério do setor, dá relação
    const e = loja({ fora });
    for (const c of e.celulas) if (c.regraId === POSTO.regraId) c.fora = diaDaSemana(c.dia) === 1 || diaDaSemana(c.dia) === 2 ? 0 : 12;
    const outra = montarPadroes(e).relacoes.find((x) => x.pergunta === 'Pessoas em Balcão · Lado do cliente × “Alguém no balcão”')!;
    assert.deepEqual([outra.titulo, outra.linhas.map((l) => Math.round(l[1]))], ['Com 4 ou mais em Balcão · Lado do cliente, “Alguém no balcão” fica mais tempo fora do critério', [0, 10]]);
    assert.match(outra.pe, /comparando as mesmas horas do dia \(20h, 21h\)$/);
  });

  it('dividir os dias por ruído não é comparar duas situações', () => {
    // no pico o balcão fica em volta de 2,5 todo dia (2,4 num dia, 2,6 no outro): "menos de 3" e "3 ou mais"
    // separariam os dias pelo acaso — e a tela diria que a fila "não muda com o número de pessoas no balcão"
    const f: Record<string, Partial<Plano>> = {};
    for (let n = 1; n <= DIAS_DO_PADRAO; n += 1) for (const h of [20, 21]) f[`${somaDias(HOJE, -n)}|${h}`] = { posto: n % 2 ? 2.575 : 2.425 };
    assert.equal(doBalcao(montarPadroes(loja({ fora: f }))), undefined);
    // com meio objeto de distância entre os dois grupos já são dois casos (2,2 num dia, 2,8 no outro)
    const g: Record<string, Partial<Plano>> = {};
    for (let n = 1; n <= DIAS_DO_PADRAO; n += 1) for (const h of [20, 21]) g[`${somaDias(HOJE, -n)}|${h}`] = { posto: n % 2 ? 2.8 : 2.2 };
    assert.equal(doBalcao(montarPadroes(loja({ fora: g })))?.forca, 'nenhuma', 'a fila passa do limite do mesmo jeito nos dois: aí sim, "não muda"');
  });

  it('a relação forte vem antes da que não é relação, mesmo com diferença menor', () => {
    const f: Record<string, Partial<Plano>> = {};
    for (let n = 1; n <= DIAS_DO_PADRAO; n += 1) {
      // o uniforme: 30% no pico e 15% fora dele (o dobro: relação forte, 15 pontos de diferença);
      // a touca: 90% e 70% (não chega a 1,3 vez: sem relação, mas com 20 pontos de diferença)
      for (const h of ABERTA) f[`${somaDias(HOJE, -n)}|${h}`] = h === 20 || h === 21 ? { chapa: 2, uniformeNa: 30, toucaNa: 90 } : { uniformeNa: 15, toucaNa: 70 };
    }
    const rs = montarPadroes(loja({ fora: f })).relacoes.filter((x) => x.pergunta.startsWith('Movimento ×'));
    assert.deepEqual(rs.map((x) => [x.forca, x.pergunta, x.linhas.map((l) => Math.round(l[1]))]), [
      ['forte', 'Movimento × “Uniforme completo” sem avaliar em Montagem 1', [30, 15]],
      ['nenhuma', 'Movimento × “Uso de touca” sem avaliar em Montagem 2', [90, 70]],
    ]);
  });

  it('sem relação, as duas barras são calmas — seja qual for a maior', () => {
    // com a chapa: 20% com uma pessoa, 25% com duas (não chega a 1,3 vez)
    const f: Record<string, Partial<Plano>> = {};
    for (let n = 1; n <= DIAS_DO_PADRAO; n += 1) for (const h of [20, 21]) f[`${somaDias(HOJE, -n)}|${h}`] = n % 2 ? { chapa: 2, bancadaFora: 25 } : { chapa: 1, bancadaFora: 20 };
    const r = montarPadroes(loja({ fora: f })).relacoes.find((x) => x.pergunta === 'Pessoas em Chapa × “Bancada limpa”')!;
    assert.deepEqual([r.forca, r.linhas.map((l) => [l[0], Math.round(l[1]), l[2]])], ['nenhuma', [['Com menos de 2 em Chapa', 20, true], ['Com 2 ou mais', 25, true]]]);
    // com o movimento: 35% no pico, 40% fora dele
    const g: Record<string, Partial<Plano>> = {};
    for (let n = 1; n <= DIAS_DO_PADRAO; n += 1) for (const h of [20, 21]) g[`${somaDias(HOJE, -n)}|${h}`] = { chapa: 2, uniformeNa: 35 };
    const m = montarPadroes(loja({ fora: g })).relacoes.find((x) => x.pergunta.includes('Uniforme completo'))!;
    assert.deepEqual([m.forca, m.linhas.map((l) => [Math.round(l[1]), l[2]])], ['nenhuma', [[35, true], [40, true]]]);
  });

  it('o limiar da frase é o mais comum entre as horas comparadas', () => {
    // às 20h e às 21h o balcão costuma ter três pessoas; às 19h, duas. Às terças e quartas, uma nas três horas.
    const f = tercasEQuartas(() => ({ posto: 1, filaFora: 20 }), [19, 20, 21], (h) => (h === 19 ? {} : { posto: 3 }));
    const r = doBalcao(montarPadroes(loja({ fora: f })))!;
    assert.equal(r.titulo, 'Com menos de 3 em Balcão · Dentro do balcão, “Fila no balcão” fica mais tempo fora do critério');
    assert.match(r.pe, /comparando as mesmas horas do dia \(20h, 21h\)$/, 'a hora em que o costume é outro fica de fora');
  });

  it('no máximo seis relações', () => {
    // a touca em oito canais, todos sem avaliar do mesmo jeito: oito relações com o movimento, mais a do uniforme
    const outras = [3, 4, 5, 6, 7, 8, 9].map((n): Serie => ({ ...TOUCA, zonaId: `z-m${n}`, pontoNome: `Montagem ${n}`, pontoId: `p-Montagem ${n}` }));
    const f: Record<string, Partial<Plano>> = {};
    for (let n = 1; n <= DIAS_DO_PADRAO; n += 1) for (const h of [20, 21]) f[`${somaDias(HOJE, -n)}|${h}`] = { chapa: 2 };
    const e = loja({ fora: f, series: [...SERIES, ...outras] });
    const daTouca = e.celulas.filter((c) => c.regraId === TOUCA.regraId);
    for (const s of outras) e.celulas.push(...daTouca.map((c) => ({ ...c, zonaId: s.zonaId })));
    assert.equal(montarPadroes(e).relacoes.length, 6);
  });
});

describe('os limites da tendência e das sugestões (sem banco)', () => {
  const titulos = (e: Entrada) => montarPadroes(e).sugestoes.map((s) => s.titulo);
  const emMaisCanais = (s: Serie, ns: number[], mais: Partial<Serie> = {}): { series: Serie[]; copiar: (e: Entrada) => void } => {
    const novas = ns.map((n): Serie => ({ ...s, zonaId: `${s.zonaId}-${n}`, pontoNome: `Montagem ${n}`, pontoId: `p-Montagem ${n}`, ...mais }));
    return {
      series: novas,
      copiar: (e) => {
        const daSerie = e.celulas.filter((c) => c.regraId === s.regraId && c.zonaId === s.zonaId);
        for (const nova of novas) e.celulas.push(...daSerie.map((c) => ({ ...c, zonaId: nova.zonaId })));
      },
    };
  };

  it('o disco que quase não mexe não "enche em tantos dias"', () => {
    const e = loja();
    // 20 MB a menos por dia: em três semanas não chega a meio giga
    e.disco = e.disco.map((d, i) => ({ ...d, livreGb: 100 - 0.02 * i }));
    const disco = montarPadroes(e).tendencias.find((t) => t.titulo.startsWith('Disco'))!;
    assert.deepEqual([disco.sentido, plana(disco.texto)], ['estável', 'O espaço livre não está caindo.']);
  });

  it('a medida do mesmo critério em dois canais: um cartão de pico por canal, com o canal no título', () => {
    const e = loja({ series: [...SERIES, { ...CHAPA, zonaId: 'z-ch2', pontoNome: 'Chapa 2', pontoId: 'p-Chapa 2' }] });
    e.celulas.push(...e.celulas.filter((c) => c.regraId === CHAPA.regraId).map((c) => ({ ...c, zonaId: 'z-ch2' })));
    assert.deepEqual(
      montarPadroes(e).tendencias.filter((t) => t.titulo.startsWith('Chapa com gente')).map((t) => t.titulo),
      ['Chapa com gente no pico de sábado · Chapa', 'Chapa com gente no pico de sábado · Chapa 2'],
    );
  });

  it('"marque a área" é para o critério que lê a imagem: o do detector não ganha a sugestão', () => {
    const e = loja();
    // a chapa (presença, quadro inteiro) sem conseguir avaliar em mais da metade das olhadas
    for (const c of e.celulas) if (c.regraId === CHAPA.regraId) c.na = 70;
    assert.ok(!titulos(e).includes('Marque um quadro em Chapa'), JSON.stringify(titulos(e)));
  });

  it('o mesmo critério sem avaliar em dois canais com a área marcada: uma sugestão de "com pessoa na área"', () => {
    const { series, copiar } = emMaisCanais(TOUCA, [3, 4], { areaDesenhada: true });
    const e = loja({ series: [...SERIES, ...series] });
    copiar(e);
    const t = titulos(e);
    assert.equal(t.filter((x) => x === 'Só confira “Uso de touca” com alguém na área').length, 1, JSON.stringify(t));
    assert.ok(t.includes('Marque um quadro em Montagem 2'), 'e o canal de quadro inteiro continua com a dele');
  });

  it('relação forte em que o problema é gente DEMAIS não sugere "pelo menos N"', () => {
    const f: Record<string, Partial<Plano>> = {};
    for (let n = 1; n <= DIAS_DO_PADRAO; n += 1) for (const h of [20, 21]) f[`${somaDias(HOJE, -n)}|${h}`] = n % 2 ? { chapa: 2, bancadaFora: 40 } : { chapa: 1, bancadaFora: 15 };
    const p = montarPadroes(loja({ fora: f }));
    const r = p.relacoes.find((x) => x.pergunta === 'Pessoas em Chapa × “Bancada limpa”')!;
    assert.deepEqual([r.forca, r.titulo], ['forte', 'Com 2 ou mais em Chapa, “Bancada limpa” fica mais tempo fora do critério']);
    assert.ok(!p.sugestoes.some((s) => s.icone === 'criterio'));
  });

  it('no máximo oito sugestões', () => {
    // a bancada em dez canais: dez sugestões de foto padrão, fora as outras
    const { series, copiar } = emMaisCanais(BANCADA, [3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const e = loja({ series: [...SERIES, ...series] });
    copiar(e);
    assert.equal(montarPadroes(e).sugestoes.length, 8);
  });
});

// ───────────────────────── com banco ─────────────────────────

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-especialista-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-especialista';
const SENHA = 'uma senha longa o bastante';

describe('o especialista (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  let lojaId = '';
  let lojaSemNada = '';
  let regraId = '';
  let zonaId = '';
  let cookie = '';
  let cookieSupervisao = '';
  let cookieExecucao = '';
  let cookieVizinho = '';
  let token = '';
  /** O dia da operação de agora, no relógio da loja — dito pelo servidor. */
  let hoje = '';

  type Resposta = Padroes & { loja: { id: string; nome: string; timezone: string } };

  async function entrar(tenantId: string, email: string, nivel: string, nome = 'X') {
    await app.inject({
      method: 'POST', url: '/v1/distribuicao/usuarios', headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId, nome, email, senha: SENHA, nivel },
    });
    const r = await app.inject({ method: 'POST', url: '/v1/sessao', payload: { email, senha: SENHA } });
    const b = r.headers['set-cookie'];
    return (Array.isArray(b) ? b[0]! : String(b)).split(';')[0]!;
  }
  const ver = (comCookie: string | null = cookie, loja = lojaId) =>
    app.inject({ method: 'GET', url: `/v1/lojas/${loja}/especialista`, headers: comCookie ? { cookie: comCookie } : {} });
  const padroes = async () => (await ver()).json() as Resposta;
  const responder = (corpo: Record<string, unknown>, comCookie = cookie, loja = lojaId) =>
    app.inject({ method: 'POST', url: `/v1/lojas/${loja}/especialista/revisoes`, headers: { cookie: comCookie }, payload: corpo });

  /** Uma hora do critério de presença: 120 olhadas, `medida` pessoas em média. Meio-dia em -03:00 é a hora 12 da loja. */
  const hora = (dia: string, h: number, medida: number, mais: Record<string, unknown> = {}) => ({
    regraId, zonaId, hora: `${h < 24 ? dia : somaDias(dia, 1)}T${String(h % 24).padStart(2, '0')}:00:00-03:00`,
    capturas: 120, semJuiz: 0, semQuadro: 0, semCena: 0, semCondicao: 0, emSilencio: 0, repetidas: 0, jaJulgadas: 0, enfileiradas: 120,
    conformes: 120, naoConformes: 0, naoAvaliaveis: 0, falhas: 0, alertas: 0, somaConfianca: 108, comConfianca: 120, somaLatenciaMs: 10800, comLatencia: 120,
    custoCentavos: 0, julgadasLoja: 120, julgadasNuvem: 0, somaMedida: Math.round(medida * 120 * 100) / 100, comMedida: 120, maxMedida: Math.ceil(medida) + 1,
    extras: 0, extrasFora: 0, ultimoResultado: 'conforme', ultimoMotivo: null, ultimoImpedimento: null, ultimaEm: null, ...mais,
  });
  async function subir(resumos: unknown[]) {
    const r = await app.inject({ method: 'POST', url: '/v1/resumos', headers: { authorization: `Bearer ${token}` }, payload: { resumos } });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json().recusados, [], r.body);
  }
  const achar = (p: Padroes, dia: string, h: number): Anomalia | undefined => p.anomalias.find((a) => a.dia === dia && a.hora === h);

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    app = criarApp(pool, { logger: false });
    await app.ready();

    const conta = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome: marca }, loja: { nome: 'Matriz' }, setores: [{ nome: 'Atendimento' }, { nome: 'Estoque' }] },
    })).json();
    lojaId = conta.loja.id;
    cookie = await entrar(conta.tenantId, `gerente-${marca}@e.com`, 'gerente', 'Ana Souza');
    cookieSupervisao = await entrar(conta.tenantId, `sup-${marca}@e.com`, 'supervisao');
    cookieExecucao = await entrar(conta.tenantId, `exec-${marca}@e.com`, 'execucao');

    const outra = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome: `${marca}-vizinha` }, loja: { nome: 'Outra' }, setores: [{ nome: 'Salão' }] },
    })).json();
    lojaSemNada = outra.loja.id;
    cookieVizinho = await entrar(outra.tenantId, `dono-${marca}-v@e.com`, 'presidente');

    const ponto = await app.inject({
      method: 'POST', url: `/v1/setores/${conta.setores[0].id}/pontos`, headers: { cookie },
      payload: { nome: 'Balcão', origem: 'dvr', canal: 1, host: '192.168.1.108' },
    });
    assert.equal(ponto.statusCode, 201, ponto.body);
    zonaId = ponto.json().zonas[0].id;
    const regra = await app.inject({
      method: 'POST', url: `/v1/lojas/${lojaId}/regras`, headers: { cookie },
      payload: { nome: 'Alguém no balcão', tipo: 'presenca', criterio: 'Há alguém atrás do balcão.', zonaIds: [zonaId], parametros: { objeto: 'pessoa', minimo: 1 } },
    });
    assert.equal(regra.statusCode, 201, regra.body);
    regraId = regra.json().id;

    const a = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/agentes', headers: { 'x-farol-admin': ADMIN }, payload: { lojaId, nome: 'PC da loja' },
    })).json();
    const ativar = await app.inject({
      method: 'POST', url: '/v1/agentes/ativar', headers: { authorization: `Bearer ${a.token}` }, payload: { fingerprint: `fp-${marca}` },
    });
    assert.equal(ativar.statusCode, 200, ativar.body);
    token = a.token;
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    await pool?.end();
  });

  it('quem vê: supervisão para cima; outra conta nem sabe que a loja existe', async () => {
    assert.equal((await ver(null)).statusCode, 401);
    const exec = await ver(cookieExecucao);
    assert.equal(exec.statusCode, 403, exec.body);
    assert.match(exec.json().mensagem, /supervisão/);
    assert.equal((await ver(cookieSupervisao)).statusCode, 200);
    assert.equal((await ver(cookieVizinho)).statusCode, 404);
    assert.equal((await ver(cookie, 'nao-e-uuid')).statusCode, 404);
  });

  it('loja sem análise nenhuma: sem padrão, e com os setores para a tela montar o vazio', async () => {
    const r = await ver();
    assert.equal(r.statusCode, 200, r.body);
    const p = r.json() as Resposta;
    assert.deepEqual([p.suficiente, p.base.dias, p.anomalias.length], [false, 0, 0]);
    assert.deepEqual(p.loja, { id: lojaId, nome: 'Matriz', timezone: 'America/Sao_Paulo' });
    assert.deepEqual(p.setores.map((s) => s.nome), ['Atendimento', 'Estoque']);
    assert.match(p.hoje, /^\d{4}-\d\d-\d\d$/);
    hoje = p.hoje;
  });

  it('com dez dias de números: o padrão, o indicador e as horas que fugiram dele', async () => {
    const resumos = [];
    for (let n = 10; n >= 1; n -= 1) {
      const dia = somaDias(hoje, -n);
      for (const h of [12, 13, 14]) {
        // ontem às 13h, anteontem às 12h e há três dias às 14h: o balcão com uma pessoa
        const vazio = (n === 1 && h === 13) || (n === 2 && h === 12) || (n === 3 && h === 14);
        resumos.push(hora(dia, h, vazio ? 1 : n % 2 ? 2.06 : 1.94));
      }
    }
    // Uma hora da MADRUGADA: 2h do dia seguinte ao de três dias atrás — pertence à noite de três dias atrás.
    resumos.push(hora(somaDias(hoje, -3), 26, 2));
    await subir(resumos);

    const p = await padroes();
    assert.deepEqual([p.suficiente, p.base.dias, p.base.de, p.base.ate, p.base.firme], [true, 10, somaDias(hoje, -10), somaDias(hoje, -1), false]);
    assert.deepEqual(p.indicadores.map((i) => [i.tipo, i.nome, i.onde]), [
      ['medida', 'Alguém no balcão: pessoas', 'Balcão'],
      ['fora', 'Alguém no balcão fora do critério', 'Balcão'],
      ['na', 'Alguém no balcão sem conseguir avaliar', 'Balcão'],
    ]);
    assert.deepEqual(p.anomalias.map((a) => [a.dia, a.hora, a.estado, a.tipo]), [
      [somaDias(hoje, -1), 13, 'rever', 'medida'],
      [somaDias(hoje, -2), 12, 'rever', 'medida'],
      [somaDias(hoje, -3), 14, 'rever', 'medida'],
    ]);
    assert.equal(p.aRever, 3);
    const a = achar(p, somaDias(hoje, -1), 13)!;
    assert.deepEqual([a.regraId, a.zonaId, a.onde, a.normal.base], [regraId, zonaId, 'Balcão', 'hora']);
    assert.equal(a.titulo, '“Alguém no balcão”: menos pessoas do que o normal');
    assert.equal(a.criterio?.nome, 'Pelo menos 2 em Balcão às 13h');
    assert.equal(a.criterio?.zonaId, zonaId);
    // o setor sem critério diz que não tem
    assert.deepEqual(p.descricoes.map((d) => [d.setor, d.texto === null]), [['Atendimento', false], ['Estoque', true]]);
  });

  it('o silêncio depois do aviso e o que não deu para avaliar chegam à conta, somados por hora', async () => {
    const quando = `${somaDias(hoje, -5)}T12:00:00-03:00`;
    // das 120 olhadas daquela hora, 7 não deram para avaliar; e outras 37 caíram no silêncio
    const antes = await pool.query(
      'update resumo_hora set em_silencio = 37, conformes = conformes - 7, nao_avaliaveis = 7 where loja_id = $1 and hora = $2::timestamptz returning id',
      [lojaId, quando],
    );
    assert.equal(antes.rowCount, 1);
    const entrada = await entradaDoEspecialista(pool, { id: lojaId, nome: 'Matriz', timezone: 'America/Sao_Paulo', hoje, hora_agora: 12 });
    const daHora = entrada.celulas.filter((c) => c.dia === somaDias(hoje, -5) && c.hora === 12);
    assert.deepEqual(daHora.map((c) => [c.emSilencio, c.julgadas, c.na]), [[37, 120, 7]], 'julgada é a olhada que teve resposta — inclusive "não deu para avaliar"');
    assert.ok(entrada.celulas.filter((c) => c !== daHora[0]).every((c) => c.emSilencio === 0 && c.na === 0));
    await pool.query('update resumo_hora set em_silencio = 0, conformes = conformes + 7, nao_avaliaveis = 0 where id = $1', [antes.rows[0].id]);
  });

  it('o dia vira às 6h e a hora é a do relógio da loja — seja qual for o relógio do banco', async () => {
    const em = async (instante: string, fuso: string) =>
      (await pool.query(`select ${sqlDoDiaDaOperacao('$1::timestamptz', '$2::text')} as dia, ${sqlDaHora('$1::timestamptz', '$2::text')} as hora`, [instante, fuso])).rows[0];
    assert.deepEqual({ ...(await em('2026-10-08T05:59:00-03:00', 'America/Sao_Paulo')) }, { dia: '2026-10-07', hora: 5 }, 'antes das 6h ainda é a noite de ontem');
    assert.deepEqual({ ...(await em('2026-10-08T06:00:00-03:00', 'America/Sao_Paulo')) }, { dia: '2026-10-08', hora: 6 });
    assert.deepEqual({ ...(await em('2026-10-08T00:30:00-03:00', 'America/Sao_Paulo')) }, { dia: '2026-10-07', hora: 0 });
    // o mesmo instante, em Manaus, é uma hora antes — e ainda é a noite de ontem
    assert.deepEqual({ ...(await em('2026-10-08T06:30:00-03:00', 'America/Manaus')) }, { dia: '2026-10-07', hora: 5 });
    // a mesma loja lida noutro fuso: os números guardados caem uma hora antes (e a madrugada continua na noite dela)
    const emManaus = await entradaDoEspecialista(pool, { id: lojaId, nome: 'Matriz', timezone: 'America/Manaus', hoje, hora_agora: 12 });
    assert.deepEqual([...new Set(emManaus.celulas.map((c) => c.hora))].sort((x, y) => x - y), [1, 11, 12, 13]);
    assert.deepEqual(emManaus.celulas.filter((c) => c.hora === 1).map((c) => c.dia), [somaDias(hoje, -3)]);
  });

  it('o critério num quadro desenhado, o canal com mais de uma área e o que foi excluído', async () => {
    const serie = async () => (await entradaDoEspecialista(pool, { id: lojaId, nome: 'Matriz', timezone: 'America/Sao_Paulo', hoje, hora_agora: 12 })).series;
    assert.deepEqual(
      (await serie()).map((s) => [s.regraNome, s.pontoNome, s.areaDesenhada, s.variasAreas]),
      [['Alguém no balcão', 'Balcão', false, false]],
      'a área que nasce com o canal é a imagem completa',
    );
    // o critério passa a valer num QUADRO desenhado (a imagem completa do canal não se redesenha)
    const pontoId = (await pool.query('select ponto_id from zona where id = $1', [zonaId])).rows[0].ponto_id;
    const quadro = (await pool.query(
      `insert into zona (ponto_id, nome, poligono) values ($1, 'Dentro do balcão', $2::jsonb) returning id`,
      [pontoId, JSON.stringify([[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]])],
    )).rows[0].id;
    await pool.query('update regra_alvo set zona_id = $2 where regra_id = $1', [regraId, quadro]);
    assert.deepEqual((await serie()).map((s) => [s.areaDesenhada, s.variasAreas]), [[true, true]]);
    // critério, quadro ou canal marcados como excluídos saem do padrão — mesmo com o critério ainda ligado àquele quadro
    for (const [tabela, id, coluna] of [['regra', regraId, 'excluida_em'], ['zona', quadro, 'excluida_em'], ['ponto', pontoId, 'excluido_em']] as const) {
      await pool.query(`update ${tabela} set ${coluna} = now() where id = $1`, [id]);
      assert.deepEqual(await serie(), [], `${tabela} marcada como excluída`);
      await pool.query(`update ${tabela} set ${coluna} = null where id = $1`, [id]);
    }
    assert.equal((await serie()).length, 1);
    // de volta à imagem completa: com o quadro ali o canal tem mais de uma área — e, excluído, ele deixa de contar
    await pool.query('update regra_alvo set zona_id = $2 where regra_id = $1', [regraId, zonaId]);
    assert.deepEqual((await serie()).map((s) => [s.areaDesenhada, s.variasAreas]), [[false, true]]);
    await pool.query('update zona set excluida_em = now() where id = $1', [quadro]);
    assert.equal((await serie())[0]!.variasAreas, false);
    await pool.query('delete from zona where id = $1', [quadro]);
    assert.equal((await serie()).length, 1);
  });

  it('o disco da máquina: a última leitura de cada dia', async () => {
    const { tenant_id: tenantId } = (await pool.query('select tenant_id from loja where id = $1', [lojaId])).rows[0];
    const agente = (await pool.query('select id from agente where loja_id = $1', [lojaId])).rows[0].id;
    const dia = somaDias(hoje, -2);
    await pool.query(
      `insert into uso_hora (tenant_id, loja_id, agente_id, hora, amostras, disco_livre_gb, disco_total_gb)
       values ($1, $2, $3, $4::timestamptz, 6, 50, 240), ($1, $2, $3, $5::timestamptz, 6, 40, 240)`,
      [tenantId, lojaId, agente, `${dia}T12:00:00-03:00`, `${dia}T15:00:00-03:00`],
    );
    const entrada = await entradaDoEspecialista(pool, { id: lojaId, nome: 'Matriz', timezone: 'America/Sao_Paulo', hoje, hora_agora: 12 });
    assert.deepEqual(entrada.disco, [{ dia, livreGb: 40, totalGb: 240 }], 'das duas leituras do dia, vale a das 15h');
    await pool.query('delete from uso_hora where loja_id = $1', [lojaId]);
  });

  it('o dia é o da operação: a madrugada pertence à noite anterior, cortada no fuso da loja', async () => {
    const p = await padroes();
    const medida = p.indicadores.find((i) => i.tipo === 'medida')!;
    const grade = p.semana[medida.id]!;
    const madrugada = grade.filter((c) => c.hora === 2);
    assert.equal(madrugada.length, 1, JSON.stringify(grade.map((c) => [c.diaDaSemana, c.hora])));
    assert.equal(madrugada[0]!.diaDaSemana, diaDaSemana(somaDias(hoje, -3)), 'a hora 2 do dia seguinte entra no dia em que a noite começou');
    assert.equal(madrugada[0]!.n, 1);
    // e o meio-dia mandado em -03:00 é a hora 12 da loja, não a 15
    assert.deepEqual([...new Set(grade.map((c) => c.hora))].sort((x, y) => x - y), [2, 12, 13, 14]);
  });

  it('quem responde é quem configura; e a resposta é conferida', async () => {
    const p = await padroes();
    const alvo = achar(p, somaDias(hoje, -1), 13)!;
    const sup = await responder({ anomaliaId: alvo.id, estado: 'esperado' }, cookieSupervisao);
    assert.equal(sup.statusCode, 403, sup.body);
    assert.equal((await responder({ anomaliaId: alvo.id, estado: 'esperado' }, cookieVizinho)).statusCode, 404);
    assert.equal((await responder({ anomaliaId: alvo.id, estado: 'esperado' }, cookieVizinho, lojaSemNada)).statusCode, 404, 'na loja dela, esta hora não existe');

    const ruim = async (corpo: Record<string, unknown>, padrao: RegExp) => {
      const r = await responder({ anomaliaId: alvo.id, ...corpo });
      assert.equal(r.statusCode, 422, `${JSON.stringify(corpo)}: ${r.body}`);
      assert.match(r.json().mensagem, padrao);
    };
    await ruim({ estado: 'talvez' }, /estado/);
    await ruim({}, /estado/);
    await ruim({ estado: 'problema', oQueHouve: 'Faltou gente.' }, /o que aconteceu e o que foi feito/);
    await ruim({ estado: 'problema', oQueHouve: '   ', oQueFoiFeito: 'Remanejei.' }, /o que aconteceu/);
    await ruim({ estado: 'esperado', soDestaVez: 'false' }, /soDestaVez/);
    await ruim({ estado: 'esperado', soDestaVez: 0 }, /soDestaVez/);
    await ruim({ estado: 'esperado', nota: 'x'.repeat(1001) }, /1000/);
    await ruim({ estado: 'esperado', nota: 7 }, /1000/);
    await ruim({ estado: 'esperado', depois: 'criar' }, /só a correção/);
    await ruim({ estado: 'problema', oQueHouve: 'a', oQueFoiFeito: 'b', depois: 'apagar' }, /depois/);
    await ruim({ estado: 'problema', oQueHouve: 'a', oQueFoiFeito: 'b', depois: 'ajustar' }, /não tem critério a ajustar/);
    const semAlvo = await responder({ estado: 'esperado' });
    assert.equal(semAlvo.statusCode, 422, semAlvo.body);
    const inexistente = await responder({ anomaliaId: alvo.id.replace(/\|13$/, '|15'), estado: 'esperado' });
    assert.equal(inexistente.statusCode, 404, inexistente.body);
    assert.match(inexistente.json().mensagem, /não está mais entre as saídas do padrão/);

    assert.equal((await pool.query('select 1 from padrao_revisao where loja_id = $1', [lojaId])).rowCount, 0, 'nada disso foi gravado');
    assert.equal((await padroes()).aRever, 3);
  });

  it('“foi só desta vez”: a hora muda de estado, com quem respondeu e a frase', async () => {
    const alvo = achar(await padroes(), somaDias(hoje, -1), 13)!;
    const r = await responder({ anomaliaId: alvo.id, estado: 'esperado', soDestaVez: true, nota: ' Chuva forte: a loja ficou vazia. ' });
    assert.equal(r.statusCode, 201, r.body);
    const p = r.json() as Resposta;
    const revista = achar(p, somaDias(hoje, -1), 13)!;
    assert.equal(revista.estado, 'esperado');
    assert.deepEqual(revista.revisao, {
      quem: 'Ana Souza', em: revista.revisao!.em, virou: null, soDestaVez: true,
      texto: 'Chuva forte: a loja ficou vazia. Foi só desta vez: esta hora ficou de fora da conta do padrão.',
    });
    assert.match(revista.revisao!.em, /^\d{4}-\d\d-\d\d$/);
    assert.equal(p.aRever, 2);
    assert.deepEqual(p.loja.id, lojaId, 'a resposta já traz a tela inteira de novo');
    assert.deepEqual(await padroes(), p, 'e é o que a leitura devolve');

    const linha = (await pool.query(
      `select v.estado, v.so_desta_vez, v.nota, v.indicador, to_char(v.dia, 'YYYY-MM-DD') as dia, v.hora, u.email
         from padrao_revisao v join usuario u on u.id = v.criado_por where v.loja_id = $1`, [lojaId],
    )).rows;
    assert.deepEqual(linha, [{ estado: 'esperado', so_desta_vez: true, nota: 'Chuva forte: a loja ficou vazia.', indicador: 'medida', dia: somaDias(hoje, -1), hora: 13, email: `gerente-${marca}@e.com` }]);

    // a mesma hora de novo: já foi revista
    const deNovo = await responder({ anomaliaId: alvo.id, estado: 'problema', oQueHouve: 'a', oQueFoiFeito: 'b' });
    assert.equal(deNovo.statusCode, 409, deNovo.body);
    assert.equal(deNovo.json().erro, 'ja_revista');
    assert.equal(achar(await padroes(), somaDias(hoje, -1), 13)!.estado, 'esperado', 'e a primeira resposta continua valendo');
  });

  it('“é problema” com critério a propor: a correção diz no que deu', async () => {
    const alvo = achar(await padroes(), somaDias(hoje, -2), 12)!;
    const r = await responder({
      anomaliaId: alvo.id, estado: 'problema', oQueHouve: 'Um atendente faltou.', oQueFoiFeito: 'Remanejei uma pessoa do salão.', depois: 'criar',
      // o que vier a mais no pedido não escolhe a hora nem o critério
      regraId: randomUUID(), dia: '2020-01-01', hora: 3, soDestaVez: true,
    });
    assert.equal(r.statusCode, 201, r.body);
    const revista = achar(r.json() as Resposta, somaDias(hoje, -2), 12)!;
    assert.equal(revista.estado, 'problema');
    assert.equal(revista.revisao!.texto, 'Um atendente faltou. Remanejei uma pessoa do salão.');
    assert.equal(revista.revisao!.virou, 'Propôs o critério “Pelo menos 2 em Balcão às 12h”, que nasce desligado.');
    assert.equal(revista.revisao!.soDestaVez, false, '"foi só desta vez" é um jeito de ser esperado, não de ser problema');
    const linha = (await pool.query(`select to_char(dia, 'YYYY-MM-DD') as dia, hora, regra_id from padrao_revisao where loja_id = $1 and estado = 'problema'`, [lojaId])).rows[0];
    assert.deepEqual(linha, { dia: somaDias(hoje, -2), hora: 12, regra_id: regraId });
  });

  it('duas pessoas respondendo à mesma hora: uma resposta só', async () => {
    const alvo = achar(await padroes(), somaDias(hoje, -3), 14)!;
    assert.equal(alvo.estado, 'rever');
    const [a, b] = await Promise.all([
      responder({ anomaliaId: alvo.id, estado: 'esperado', nota: 'da primeira aba' }),
      responder({ anomaliaId: alvo.id, estado: 'esperado', nota: 'da segunda aba' }),
    ]);
    assert.deepEqual([a.statusCode, b.statusCode].sort(), [201, 409], `${a.body.slice(0, 120)} | ${b.body.slice(0, 120)}`);
    const guardadas = (await pool.query(`select nota from padrao_revisao where loja_id = $1 and hora = 14`, [lojaId])).rows;
    assert.equal(guardadas.length, 1);
    assert.equal(guardadas[0].nota, a.statusCode === 201 ? 'da primeira aba' : 'da segunda aba', 'ficou a de quem recebeu 201');
    assert.equal((await padroes()).aRever, 0);
  });

  it('saída do padrão de uma taxa: não há critério a propor, abre-se o que existe — e anotação não é de correção', async () => {
    // às 16h o balcão tem sempre duas pessoas; ontem, o critério ficou fora em metade das olhadas
    const resumos = [];
    for (let n = 10; n >= 1; n -= 1) {
      resumos.push(hora(somaDias(hoje, -n), 16, n % 2 ? 2.06 : 1.94, n === 1 ? { conformes: 60, naoConformes: 60, alertas: 2, ultimoResultado: 'nao_conforme' } : {}));
    }
    await subir(resumos);
    const alvo = achar(await padroes(), somaDias(hoje, -1), 16)!;
    assert.deepEqual([alvo.tipo, alvo.criterio, alvo.ajustar], ['fora', null, { regraId, nome: 'Alguém no balcão' }]);
    const semCriterio = await responder({ anomaliaId: alvo.id, estado: 'problema', oQueHouve: 'a', oQueFoiFeito: 'b', depois: 'criar' });
    assert.equal(semCriterio.statusCode, 422, semCriterio.body);
    assert.match(semCriterio.json().mensagem, /não tem critério a propor/);
    const r = await responder({
      anomaliaId: alvo.id, estado: 'problema', oQueHouve: 'Ficou sem ninguém.', oQueFoiFeito: 'Cobri o balcão.', depois: 'ajustar', nota: 'isto é de "era esperado"',
    });
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(achar(r.json() as Resposta, somaDias(hoje, -1), 16)!.revisao!.virou, 'Abriu “Alguém no balcão” para ajuste.');
    const linha = (await pool.query('select nota, o_que_houve, virou from padrao_revisao where loja_id = $1 and hora = 16', [lojaId])).rows[0];
    assert.deepEqual({ ...linha }, { nota: '', o_que_houve: 'Ficou sem ninguém.', virou: 'Abriu “Alguém no balcão” para ajuste.' });
  });

  it('critério excluído leva as respostas dele, e some do padrão', async () => {
    assert.equal((await pool.query('select count(*)::int as n from padrao_revisao where loja_id = $1', [lojaId])).rows[0].n, 4);
    const excluir = await app.inject({ method: 'DELETE', url: `/v1/regras/${regraId}`, headers: { cookie } });
    assert.ok(excluir.statusCode < 300, excluir.body);
    const p = await padroes();
    assert.deepEqual([p.indicadores.length, p.anomalias.length], [0, 0], 'o que saiu não tem o que ajustar');
    // a exclusão do console é "sair de cena" (o histórico fica); apagada de verdade, as respostas vão junto
    await pool.query('delete from regra where id = $1', [regraId]);
    assert.equal((await pool.query('select count(*)::int as n from padrao_revisao where loja_id = $1', [lojaId])).rows[0].n, 0);
  });
});
