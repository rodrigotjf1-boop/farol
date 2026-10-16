// O treinamento da bancada (A21, fatia T4; migration 049), de ponta a ponta na API:
//
//   - a loja manda o lanche lido (o corpo de `contratos/lanche-de-treino.json`): a gravação e o lanche entram uma
//     vez só, mandar de novo troca a leitura — menos depois de conferido; o canal tem de ser da loja do agente;
//   - o palpite da ficha é feito aqui, com as fichas de hoje; a fila começa pela dúvida;
//   - conferem diretoria, gerência e supervisão; outra conta nem sabe que o lanche existe;
//   - cada etapa conferida com nome das fichas vira exemplo na base de conhecimento, com a imagem copiada;
//     conferir de novo troca os exemplos; o acerto conta só o que alguém conferiu;
//   - o quadro do treino sai 30 dias depois da conferência; o exemplo fica.

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { criarApp } from '../src/app.js';
import { contarBase, impressaoDaBase, type Base } from '../src/fichas.js';
import { apagarQuadrosVencidos } from '../src/rotas/treino.js';
import {
  aprendizado,
  ensinoDasEtapas,
  exemplosDaConferencia,
  fotosDoLanche,
  lerConferencia,
  lerLancheDeTreino,
  MAX_BYTES_DO_QUADRO,
  motivoDoLanche,
  palpiteQueVale,
  palpitesDoLanche,
  semLeitura,
  vezesNaFicha,
  vistosDaConferencia,
  type ConferenciaPorFoto,
  type EtapaLida,
} from '../src/treino.js';

const CONTRATO = JSON.parse(readFileSync(new URL('../../contratos/lanche-de-treino.json', import.meta.url), 'utf8')) as {
  corpo: { gravacao: Record<string, unknown>; lanche: { chave: string; etapas: EtapaLida[] } & Record<string, unknown>; quadros: { imagemBase64: string }[] };
};
const BASE = (JSON.parse(readFileSync(new URL('../../contratos/fichas-da-loja.json', import.meta.url), 'utf8')) as { resposta: { base: Base } }).resposta.base;
const copia = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const CORPO = () => copia(CONTRATO.corpo);
const ETAPAS = CONTRATO.corpo.lanche.etapas;
const NOMES = ['Pão brioche', 'Blend da casa', 'Queijo prato', 'Cebola roxa', 'Sal', 'Bacon fatiado', 'Ovo frito'];

describe('o lanche lido e a conta da ficha (sem banco)', () => {
  it('o corpo do contrato entra como está', () => {
    const l = lerLancheDeTreino(CORPO());
    assert.ok(!('problema' in l), JSON.stringify(l));
    assert.equal(l.lanche.etapas.length, 6);
    assert.equal(l.quadros.length, 5);
    assert.deepEqual([l.quadros[0]!.largura, l.quadros[0]!.altura], [320, 320]);
  });

  it('recusa o que vem torto, dizendo onde', () => {
    const casos: Array<[string, (c: ReturnType<typeof CORPO>) => void, RegExp]> = [
      ['sem chave', (c) => delete c.gravacao.chave, /gravacao.chave/],
      ['canal que não é id', (c) => (c.gravacao.pontoId = 'canal-4'), /pontoId/],
      ['fim antes do começo', (c) => (c.gravacao.fim = '2026-10-14T21:00:00-03:00'), /fim depois/],
      ['mais de 2 horas', (c) => (c.gravacao.fim = '2026-10-15T00:00:00-03:00'), /2 horas/],
      ['origem desconhecida', (c) => (c.gravacao.origem = 'ao vivo'), /origem/],
      ['lanche sem chave', (c) => (c.lanche.chave = '  '), /lanche.chave/],
      ['sem etapas', (c) => (c.lanche.etapas = []), /etapas/],
      ['lado desconhecido', (c) => ((c.lanche.etapas[1] as Record<string, unknown>).lado = 'meio'), /etapas\[1\].lado/],
      ['inicio que não é verdadeiro ou falso', (c) => ((c.lanche.etapas[1] as Record<string, unknown>).inicio = 'sim'), /inicio/],
      ['vezes zero', (c) => ((c.lanche.etapas[1] as Record<string, unknown>).vezes = 0), /vezes/],
      ['candidatos demais', (c) => ((c.lanche.etapas[1] as Record<string, unknown>).candidatos = Array(13).fill('X')), /candidatos/],
      ['quadro que não veio', (c) => ((c.lanche.etapas[1] as Record<string, unknown>).quadro = 9), /quadro/],
      ['quadro que não é JPEG', (c) => (c.quadros[0]!.imagemBase64 = Buffer.from('não é imagem').toString('base64')), /JPEG/],
      ['quadro grande demais', (c) => (c.quadros[0]!.imagemBase64 = Buffer.alloc(MAX_BYTES_DO_QUADRO + 1, 0xff).toString('base64')), /kB/],
    ];
    for (const [nome, estragar, esperado] of casos) {
      const c = CORPO();
      estragar(c);
      const l = lerLancheDeTreino(c);
      assert.ok('problema' in l, nome);
      assert.match((l as { problema: string }).problema, esperado, nome);
    }
  });

  it('o palpite: a ficha que mais bate; o que "não se vê de cima" sai da conta', () => {
    const p = palpitesDoLanche(ETAPAS, BASE);
    assert.deepEqual([p[0]!.produto, p[0]!.batem, p[0]!.total, p[0]!.fora], ['X-Burger', 4, 5, 0], 'falta só o sal');
    const semSal = palpitesDoLanche(ETAPAS, BASE, new Set(['sal']));
    assert.deepEqual([semSal[0]!.batem, semSal[0]!.total], [4, 4]);
    assert.deepEqual(palpitesDoLanche(ETAPAS, null), [], 'sem fichas, sem palpite');
    // a etapa que não cabe na ficha nem é adicional pesa contra
    const comPicles = [...ETAPAS, { ...ETAPAS[1]!, candidatos: ['Picles'] }];
    const q = palpitesDoLanche(comPicles, BASE)[0]!;
    assert.equal(q.fora, 1);
    assert.ok(q.nota < p[0]!.nota);
    // o que é adicional do produto vem fora da ficha, mas não pesa
    const comOvo = [...ETAPAS, { ...ETAPAS[1]!, candidatos: ['Ovo frito'] }];
    const o = palpitesDoLanche(comOvo, BASE)[0]!;
    assert.deepEqual([o.fora, o.nota], [1, p[0]!.nota]);
    // o que a leitura viu sem achar nome nas fichas também vem fora, e pesa
    const comEstranho = [...ETAPAS, { ...ETAPAS[1]!, leu: 'molho verde', candidatos: [] }];
    const e = palpitesDoLanche(comEstranho, BASE)[0]!;
    assert.equal(e.fora, 1);
    assert.ok(e.nota < p[0]!.nota);
    // o produto que não passa pela cozinha não entra no palpite
    const semCozinha = copia(BASE);
    semCozinha.produtos.find((x) => x.nome === 'X-Burger')!.cozinha = false;
    assert.deepEqual(palpitesDoLanche(ETAPAS, semCozinha), []);
  });

  it('o motivo na fila: coberto, dúvida, diferença e "acha que acertou"', () => {
    const melhor = (e: EtapaLida[], inv = new Set<string>()) => palpitesDoLanche(e, BASE, inv)[0];
    assert.equal(motivoDoLanche(ETAPAS, melhor(ETAPAS)), 'coberto');
    const semCoberta = ETAPAS.slice(0, 5);
    assert.equal(motivoDoLanche(semCoberta, melhor(semCoberta)), 'duvida');
    const semGrupo = ETAPAS.slice(0, 4);
    assert.equal(motivoDoLanche(semGrupo, melhor(semGrupo)), 'diferenca', 'falta o sal');
    assert.equal(motivoDoLanche(semGrupo, melhor(semGrupo, new Set(['sal']))), 'certo');
    // viu algo sem nome nas fichas: não é "coberto" (viu), é diferença
    const estranho = [...semGrupo, { ...ETAPAS[1]!, leu: 'molho verde', candidatos: [] }];
    assert.equal(motivoDoLanche(estranho, melhor(estranho, new Set(['sal']))), 'diferenca');
  });

  it('a conferência: o produto das fichas, uma resposta por etapa, "certo" só onde a leitura disse um nome', () => {
    const certa = {
      produto: 'x-burger',
      etapas: [{ v: 'certo' }, { v: 'certo' }, { v: 'certo' }, { v: 'certo' }, { v: 'outro', nome: ' Bacon fatiado ' }, null],
      faltas: { Sal: 'cliente' },
      aMais: { 'Bacon fatiado': 'adicional' },
    };
    const c = lerConferencia(certa, ETAPAS, BASE);
    assert.ok(!('problema' in c), JSON.stringify(c));
    assert.equal(c.produto, 'X-Burger', 'o nome da ficha');
    assert.equal(c.etapas[4]!.nome, 'Bacon fatiado');
    assert.equal(lerConferencia({ ...certa, produto: null }, ETAPAS, BASE).produto === null, true, 'não era um lanche');

    const tortas: Array<[string, Record<string, unknown>, RegExp]> = [
      ['produto sem ficha', { ...certa, produto: 'Refrigerante lata' }, /produto/],
      ['uma resposta a menos', { ...certa, etapas: certa.etapas.slice(1) }, /uma resposta por etapa/],
      ['certo num grupo', { ...certa, etapas: [...certa.etapas.slice(0, 4), { v: 'certo' }, null] }, /diga qual era/],
      ['outro sem nome', { ...certa, etapas: [...certa.etapas.slice(0, 4), { v: 'outro' }, null] }, /nome/],
      ['resposta desconhecida', { ...certa, etapas: [{ v: 'talvez' }, ...certa.etapas.slice(1)] }, /etapas\[0\].v/],
      ['falta com escolha torta', { ...certa, faltas: { Sal: 'esqueceu' } }, /faltas.Sal/],
      ['a mais torto', { ...certa, aMais: ['Bacon'] }, /aMais/],
    ];
    for (const [nome, corpo, esperado] of tortas) {
      const r = lerConferencia(corpo, ETAPAS, BASE);
      assert.ok('problema' in r, nome);
      assert.match((r as { problema: string }).problema, esperado, nome);
    }
  });

  it('o que vira exemplo: confirmado ou corrigido, com quadro, e com nome das fichas', () => {
    const c = lerConferencia(
      {
        produto: 'X-Burger',
        etapas: [{ v: 'certo' }, { v: 'nada' }, { v: 'outro', nome: 'picles' }, { v: 'certo' }, { v: 'outro', nome: 'BACON FATIADO' }, { v: 'outro', nome: 'Ovo frito' }],
      },
      ETAPAS,
      BASE,
    );
    assert.ok(!('problema' in c));
    assert.deepEqual(exemplosDaConferencia(ETAPAS, c, NOMES), [
      { etapa: 0, nome: 'Pão brioche', quadro: 0 },
      { etapa: 3, nome: 'Queijo prato', quadro: 3 },
      { etapa: 4, nome: 'Bacon fatiado', quadro: 4 },
    ], '"nada" e "picles" (fora das fichas) não; o ovo da etapa sem quadro também não');
  });

  it('o aprendizado conta só o que foi conferido: presente e reconhecido antes da conferência', () => {
    const c1 = lerConferencia({ produto: 'X-Burger', etapas: [{ v: 'certo' }, { v: 'certo' }, { v: 'certo' }, { v: 'certo' }, { v: 'outro', nome: 'Bacon fatiado' }, null], faltas: { Sal: 'naoviu' } }, ETAPAS, BASE);
    const c2 = lerConferencia({ produto: 'X-Burger', etapas: [{ v: 'certo' }, { v: 'outro', nome: 'Blend da casa' }, null, null, null, null] }, ETAPAS, BASE);
    assert.ok(!('problema' in c1) && !('problema' in c2));
    const a = aprendizado([{ etapas: ETAPAS, conferencia: c1 }, { etapas: ETAPAS, conferencia: c2 }]);
    assert.deepEqual(a['Pão brioche'], { presente: 2, reconheceu: 2 });
    assert.deepEqual(a['Blend da casa'], { presente: 2, reconheceu: 1 }, 'no segundo, a leitura disse cebola e era carne');
    assert.deepEqual(a['Bacon fatiado'], { presente: 1, reconheceu: 0 });
    assert.deepEqual(a['Sal'], { presente: 1, reconheceu: 0 }, 'estava lá e a leitura não viu');
    assert.equal(a['Cebola roxa']?.presente, 1);
  });

  it('quantas vezes o ingrediente entra: o que se conta de cima', () => {
    assert.equal(vezesNaFicha(2, 'fatia'), 2);
    assert.equal(vezesNaFicha(2, 'unidades'), 2);
    assert.equal(vezesNaFicha(0.12, 'kg'), 1);
    assert.equal(vezesNaFicha(2, 'folhas'), 1, 'folha não se conta de cima com segurança');
    assert.equal(vezesNaFicha(null, null), 1);
  });
});

// ───────── a conferência nova: uma resposta por FOTO (protótipo aprovado pelo dono em 15/10/2026) ─────────

/** As etapas do contrato, com a 4 (o bacon) no MESMO quadro da 3 (o queijo): uma foto com duas leituras. */
const ETAPAS_DUPLA = (() => {
  const e = copia(ETAPAS);
  e[4]!.quadro = 3;
  return e;
})();
/** A conferência nova certa para `ETAPAS_DUPLA` (5 fotos: [0], [1], [2], [3, 4], [5]). */
const POR_FOTO = () => ({
  versao: 2,
  produto: 'X-Burger',
  fotos: [
    { marcados: ['Pão brioche'], ruim: false, obs: null },
    { marcados: ['Cebola roxa'], ruim: false, obs: null },
    { marcados: ['Blend da casa', ' blend da casa '], ruim: false, obs: null },
    { marcados: ['Queijo prato', 'Bacon fatiado'], ruim: false, obs: null },
    { marcados: [], ruim: true, obs: ' só a mão por cima ' },
  ],
  perguntas: { 'Cebola roxa': 'sim' },
  obs: ' o bacon foi pedido ',
  faltas: { Sal: 'cliente' },
  aMais: { 'Bacon fatiado': 'adicional' },
});
const lerPorFoto = (corpo: unknown, etapas = ETAPAS_DUPLA) => {
  const c = lerConferencia(corpo, etapas, BASE, fotosDoLanche(etapas));
  assert.ok(!('problema' in c), JSON.stringify(c));
  return c as ConferenciaPorFoto;
};

describe('a conferência por foto (sem banco)', () => {
  it('as fotos: o mesmo quadro, ou a mesma imagem, é uma foto só; a etapa sem quadro fica sozinha', () => {
    assert.deepEqual(fotosDoLanche(ETAPAS).map((f) => f.etapas), [[0], [1], [2], [3], [4], [5]], 'cada etapa com o seu quadro');
    assert.deepEqual(fotosDoLanche(ETAPAS)[5], { etapas: [5], quadro: null });
    assert.deepEqual(fotosDoLanche(ETAPAS_DUPLA).map((f) => f.etapas), [[0], [1], [2], [3, 4], [5]], 'o mesmo quadro');
    // o computador da loja manda um quadro por etapa: quadros diferentes com os MESMOS bytes são a mesma foto
    const sha = new Map<number, string | null>([[0, 'a'], [1, 'b'], [2, 'c'], [3, 'd'], [4, 'd']]);
    assert.deepEqual(fotosDoLanche(ETAPAS, sha).map((f) => f.etapas), [[0], [1], [2], [3, 4], [5]], 'a mesma imagem');
    assert.equal(fotosDoLanche(ETAPAS, sha)[3]!.quadro, 3, 'o quadro da foto é o da primeira etapa');
    // sem a imagem guardada (quadro já apagado), vale o índice
    assert.deepEqual(fotosDoLanche(ETAPAS, new Map([[3, null], [4, null]])).length, 6);
  });

  it('a resposta: uma por foto; o agrupamento é o da API; o nome repetido e o espaço saem', () => {
    const corpo = POR_FOTO() as Record<string, unknown> & { fotos: Array<Record<string, unknown>> };
    // o corpo não escolhe o agrupamento: as etapas que ele diz numa foto não contam
    corpo.fotos[0]!.etapas = [3, 4, 5];
    const c = lerPorFoto(corpo);
    assert.equal(c.versao, 2);
    assert.equal(c.produto, 'X-Burger');
    assert.deepEqual(c.fotos.map((f) => f.etapas), [[0], [1], [2], [3, 4], [5]]);
    assert.deepEqual(c.fotos[2]!.marcados, ['Blend da casa'], 'o mesmo nome com outra caixa é uma marca só');
    assert.deepEqual(c.fotos[4], { etapas: [5], marcados: [], ruim: true, obs: 'só a mão por cima' });
    assert.equal(c.fotos[0]!.obs, null);
    assert.deepEqual(c.perguntas, { 'Cebola roxa': 'sim' });
    assert.equal(c.obs, 'o bacon foi pedido');
    assert.deepEqual([c.faltas, c.aMais], [{ Sal: 'cliente' }, { 'Bacon fatiado': 'adicional' }]);
    // a observação em branco é nula; sem `versao`, `fotos` já diz que é a nova
    const semVersao = POR_FOTO() as Record<string, unknown>;
    delete semVersao.versao;
    semVersao.obs = '   ';
    assert.equal(lerPorFoto(semVersao).obs, null);
  });

  it('recusa a resposta por foto torta, dizendo onde', () => {
    const tortas: Array<[string, (c: ReturnType<typeof POR_FOTO>) => void, RegExp]> = [
      ['uma foto a menos', (c) => c.fotos.pop(), /uma resposta por foto \(5\)/],
      ['marcas que não são lista', (c) => ((c.fotos[0] as Record<string, unknown>).marcados = 'Pão brioche'), /fotos\[0\].marcados/],
      ['marcas demais', (c) => (c.fotos[1]!.marcados = Array.from({ length: 13 }, (_, i) => `Nome ${i}`)), /fotos\[1\].marcados: até 12/],
      ['marca em branco', (c) => (c.fotos[1]!.marcados = ['  ']), /fotos\[1\].marcados/],
      ['ruim que não é verdadeiro ou falso', (c) => ((c.fotos[2] as Record<string, unknown>).ruim = 'sim'), /fotos\[2\].ruim/],
      ['o que houve comprido demais', (c) => (c.fotos[4]!.obs = 'x'.repeat(121)), /fotos\[4\].obs/],
      ['pergunta com resposta torta', (c) => ((c.perguntas as Record<string, string>)['Cebola roxa'] = 'talvez'), /perguntas/],
      ['observação do lanche comprida demais', (c) => (c.obs = 'x'.repeat(301)), /obs: até 300/],
      ['produto sem ficha', (c) => (c.produto = 'Refrigerante lata'), /produto/],
    ];
    for (const [nome, estragar, esperado] of tortas) {
      const c = POR_FOTO();
      estragar(c);
      const r = lerConferencia(c, ETAPAS_DUPLA, BASE, fotosDoLanche(ETAPAS_DUPLA));
      assert.ok('problema' in r, nome);
      assert.match((r as { problema: string }).problema, esperado, nome);
    }
  });

  it('o que cada etapa ensina: tudo o que foi marcado na foto; a leitura de cada uma; a foto ruim, nada', () => {
    const e = ensinoDasEtapas(ETAPAS_DUPLA, lerPorFoto(POR_FOTO()));
    assert.deepEqual(e[3], { nomes: ['Queijo prato', 'Bacon fatiado'], daLeitura: 'Queijo prato', reconheceu: true });
    // a leitura da etapa 4 ficou entre bacon e cebola: a marca da foto que está entre os candidatos dela é o bacon
    assert.deepEqual(e[4], { nomes: ['Queijo prato', 'Bacon fatiado'], daLeitura: 'Bacon fatiado', reconheceu: false });
    assert.deepEqual(e[5], { nomes: [], daLeitura: null, reconheceu: false }, 'a foto ruim não ensina');
    // na resposta por etapa (a antiga), o mesmo de sempre
    const antiga = lerConferencia({ produto: 'X-Burger', etapas: [{ v: 'certo' }, { v: 'nada' }, { v: 'outro', nome: 'Blend da casa' }, null, null, null] }, ETAPAS, BASE);
    assert.ok(!('problema' in antiga));
    const a = ensinoDasEtapas(ETAPAS, antiga);
    assert.deepEqual([a[0], a[1], a[2], a[3]], [
      { nomes: ['Pão brioche'], daLeitura: 'Pão brioche', reconheceu: true },
      { nomes: [], daLeitura: null, reconheceu: false },
      { nomes: ['Blend da casa'], daLeitura: 'Blend da casa', reconheceu: false },
      { nomes: [], daLeitura: null, reconheceu: false },
    ], 'na antiga, só o "Certo" é reconhecido (o "Era outro" com o mesmo nome também é correção)');
  });

  it('os exemplos: cada marca com o quadro da etapa; a mesma imagem com o mesmo nome entra uma vez; a foto ruim, não', () => {
    const corpo = POR_FOTO();
    corpo.fotos[1] = { marcados: ['Cebola roxa'], ruim: true, obs: null };
    corpo.fotos[3]!.marcados.push('Picles');
    assert.deepEqual(exemplosDaConferencia(ETAPAS_DUPLA, lerPorFoto(corpo), NOMES), [
      { etapa: 0, nome: 'Pão brioche', quadro: 0 },
      { etapa: 2, nome: 'Blend da casa', quadro: 2 },
      { etapa: 3, nome: 'Queijo prato', quadro: 3 },
      { etapa: 3, nome: 'Bacon fatiado', quadro: 3 },
    ], 'a cebola ficou na foto ruim; o picles não está nas fichas; a etapa 4 é o mesmo quadro da 3');
  });

  it('o aprendizado e a conta da ficha pela resposta por foto: a marca é presença, e as fatias vêm da leitura', () => {
    const a = aprendizado([{ etapas: ETAPAS_DUPLA, conferencia: lerPorFoto(POR_FOTO()) }]);
    assert.deepEqual(a['Queijo prato'], { presente: 1, reconheceu: 1 });
    assert.deepEqual(a['Bacon fatiado'], { presente: 1, reconheceu: 0 }, 'a leitura ficou entre bacon e cebola');
    assert.deepEqual(a['Cebola roxa'], { presente: 1, reconheceu: 1 });
    assert.equal(a['Sal'], undefined, 'o sal faltou porque o cliente pediu: não estava lá');
    // a carne marcada também na foto do queijo (ela continua à vista) conta uma vez; o queijo, as 2 fatias da leitura
    const corpo = POR_FOTO();
    corpo.fotos[3]!.marcados.push('Blend da casa');
    const v = vistosDaConferencia(ETAPAS_DUPLA, lerPorFoto(corpo));
    assert.deepEqual(v.get('blend da casa'), { nome: 'Blend da casa', vezes: 1 });
    assert.deepEqual(v.get('queijo prato'), { nome: 'Queijo prato', vezes: 2 });
    assert.equal(v.has('ovo frito'), false);
  });

  it('sem nada visto da ficha, o Farol não tem palpite; sem leitura nenhuma, a tela diz', () => {
    const nada = ETAPAS.map((e) => ({ ...e, leu: null, candidatos: [] }));
    assert.equal(semLeitura(nada), true);
    assert.equal(palpiteQueVale(palpitesDoLanche(nada, BASE)), null, 'a ficha com menos ingredientes não é palpite');
    assert.equal(semLeitura(ETAPAS), false);
    assert.equal(palpiteQueVale(palpitesDoLanche(ETAPAS, BASE))?.produto, 'X-Burger');
    // viu só o que nenhuma ficha tem: também sem palpite
    const estranho = nada.map((e, i) => (i === 1 ? { ...e, leu: 'molho verde' } : e));
    assert.equal(semLeitura(estranho), false);
    assert.equal(palpiteQueVale(palpitesDoLanche(estranho, BASE)), null);
  });
});

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-treino-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-treino';
const SENHA = 'uma senha longa o bastante';

describe('o treinamento da bancada (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  let lojaId = '';
  let tenantId = '';
  let token = '';
  let tokenVizinho = '';
  let pontoVizinho = '';
  let cookie = '';
  let cookieSupervisao = '';
  let cookieExecucao = '';
  let cookieVizinho = '';
  let lancheId = '';

  async function entrar(tenant: string, email: string, nivel: string) {
    await app.inject({ method: 'POST', url: '/v1/distribuicao/usuarios', headers: { 'x-farol-admin': ADMIN }, payload: { tenantId: tenant, nome: `Pessoa ${nivel}`, email, senha: SENHA, nivel } });
    const r = await app.inject({ method: 'POST', url: '/v1/sessao', payload: { email, senha: SENHA } });
    const b = r.headers['set-cookie'];
    return (Array.isArray(b) ? b[0]! : String(b)).split(';')[0]!;
  }
  async function novoAgente(loja: string, quem: string) {
    const a = (await app.inject({ method: 'POST', url: '/v1/distribuicao/agentes', headers: { 'x-farol-admin': ADMIN }, payload: { lojaId: loja, nome: `PC ${quem}` } })).json();
    const ativar = await app.inject({ method: 'POST', url: '/v1/agentes/ativar', headers: { authorization: `Bearer ${a.token}` }, payload: { fingerprint: `fp-${quem}-${randomUUID().slice(0, 6)}` } });
    assert.equal(ativar.statusCode, 200, ativar.body);
    return a.token as string;
  }
  const mandar = (corpo: unknown, comToken: string | null = token) =>
    app.inject({ method: 'POST', url: '/v1/agentes/treino/lanches', headers: comToken ? { authorization: `Bearer ${comToken}` } : {}, payload: corpo as object });
  const lista = (comCookie: string | null = cookie, loja = lojaId) =>
    app.inject({ method: 'GET', url: `/v1/lojas/${loja}/treino`, headers: comCookie ? { cookie: comCookie } : {} });
  const umLanche = (id: string, comCookie = cookie) => app.inject({ method: 'GET', url: `/v1/treino/lanches/${id}`, headers: { cookie: comCookie } });
  const conferir = (id: string, corpo: unknown, comCookie = cookie) =>
    app.inject({ method: 'POST', url: `/v1/treino/lanches/${id}/conferencia`, headers: { cookie: comCookie }, payload: corpo as object });
  const pular = (id: string, comCookie = cookie) => app.inject({ method: 'POST', url: `/v1/treino/lanches/${id}/pular`, headers: { cookie: comCookie } });
  const CONFERENCIA = {
    produto: 'X-Burger',
    etapas: [{ v: 'certo' }, { v: 'certo' }, { v: 'certo' }, { v: 'certo' }, { v: 'outro', nome: 'Bacon fatiado' }, null],
    faltas: { Sal: 'cliente' },
    aMais: { 'Bacon fatiado': 'adicional' },
  };

  before(async () => {
    adminAntes = process.env.FAROL_ADMIN_TOKEN;
    process.env.FAROL_ADMIN_TOKEN = ADMIN;
    pool = new pg.Pool({ connectionString: URL_DO_BANCO });
    app = criarApp(pool, { logger: false });
    await app.ready();

    const conta = (await app.inject({ method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN }, payload: { tenant: { nome: marca }, loja: { nome: 'Matriz' }, setores: [{ nome: 'Cozinha' }] } })).json();
    lojaId = conta.loja.id;
    tenantId = conta.tenantId;
    cookie = await entrar(tenantId, `ger-${marca}@e.com`, 'gerente');
    cookieSupervisao = await entrar(tenantId, `sup-${marca}@e.com`, 'supervisao');
    cookieExecucao = await entrar(tenantId, `exe-${marca}@e.com`, 'execucao');
    token = await novoAgente(lojaId, marca);
    const { produtos, comFicha } = contarBase(BASE);
    await pool.query(
      `insert into fichas_da_loja (loja_id, tenant_id, fonte, conteudo, impressao, produtos, com_ficha) values ($1, $2, 'planilha', $3, $4, $5, $6)`,
      [lojaId, tenantId, JSON.stringify(BASE), impressaoDaBase(BASE), produtos, comFicha],
    );

    const vizinha = (await app.inject({ method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN }, payload: { tenant: { nome: `${marca}-vizinha` }, loja: { nome: 'Vizinha' }, setores: [{ nome: 'Cozinha' }] } })).json();
    cookieVizinho = await entrar(vizinha.tenantId, `ger-${marca}-viz@e.com`, 'gerente');
    tokenVizinho = await novoAgente(vizinha.loja.id, `${marca}-viz`);
    const ponto = await app.inject({ method: 'POST', url: `/v1/setores/${vizinha.setores[0].id}/pontos`, headers: { cookie: cookieVizinho }, payload: { nome: 'Bancada', origem: 'dvr', canal: 4, host: '192.168.1.108' } });
    assert.equal(ponto.statusCode, 201, ponto.body);
    pontoVizinho = ponto.json().id;
  });

  after(async () => {
    if (adminAntes === undefined) delete process.env.FAROL_ADMIN_TOKEN;
    else process.env.FAROL_ADMIN_TOKEN = adminAntes;
    await app?.close();
    // Apagar a conta leva junto as gravações, os lanches, os quadros e os exemplos.
    await pool?.query('delete from tenant where nome like $1', [`${marca}%`]);
    const sobrou = await pool?.query('select count(*)::int as n from treino_gravacao where loja_id = $1', [lojaId]);
    assert.equal(sobrou?.rows[0].n, 0);
    await pool?.end();
  });

  it('a loja manda o lanche lido: a gravação e o lanche entram, com os quadros', async () => {
    const r = await mandar(CORPO());
    assert.equal(r.statusCode, 201, r.body);
    assert.deepEqual([r.json().novo, r.json().conferido, r.json().quadros], [true, false, 5]);
    lancheId = r.json().lancheId;
    const g = (await pool.query('select origem, situacao, loja_id from treino_gravacao where id = $1', [r.json().gravacaoId])).rows[0];
    assert.deepEqual([g.origem, g.situacao, g.loja_id], ['carga', 'pronta', lojaId], 'a loja sai do token');
    const q = await pool.query('select n, sha256, imagem from treino_quadro where lanche_id = $1 order by n', [lancheId]);
    assert.equal(q.rowCount, 5);
    const bytes0 = Buffer.from(CONTRATO.corpo.quadros[0]!.imagemBase64, 'base64');
    assert.equal(q.rows[0].sha256, createHash('sha256').update(bytes0).digest('hex'));

    const deNovo = await mandar(CORPO());
    assert.equal(deNovo.statusCode, 200, deNovo.body);
    assert.deepEqual([deNovo.json().novo, deNovo.json().lancheId, deNovo.json().gravacaoId], [false, lancheId, r.json().gravacaoId], 'a mesma gravação e o mesmo lanche');
    assert.equal((await pool.query('select count(*)::int as n from treino_quadro where lanche_id = $1', [lancheId])).rows[0].n, 5, 'os quadros foram trocados, não somados');
    assert.equal((await pool.query('select count(*)::int as n from treino_gravacao where loja_id = $1', [lojaId])).rows[0].n, 1);
  });

  it('recusa sem token, com corpo torto e com o canal de outra loja', async () => {
    assert.equal((await mandar(CORPO(), null)).statusCode, 401);
    assert.equal((await mandar(CORPO(), 'farol_nao_existe')).statusCode, 401);
    const torto = CORPO();
    (torto.lanche.etapas[2] as Record<string, unknown>).lado = 'meio';
    const r = await mandar(torto);
    assert.equal(r.statusCode, 422);
    assert.match(r.json().mensagem, /etapas\[2\].lado/);
    const alheio = CORPO();
    alheio.gravacao.pontoId = pontoVizinho;
    alheio.lanche.chave = 'lanche-alheio';
    const a = await mandar(alheio);
    assert.equal(a.statusCode, 422);
    assert.match(a.json().mensagem, /não é desta loja/);
    assert.equal((await pool.query(`select count(*)::int as n from treino_lanche where chave = 'lanche-alheio'`)).rows[0].n, 0, 'nada entrou');
  });

  it('a lista: o palpite com as fichas de hoje, a dúvida primeiro, as miniaturas — e quem vê', async () => {
    const r = await lista();
    assert.equal(r.statusCode, 200, r.body);
    const l = r.json();
    assert.equal(l.podeConfigurar, true);
    assert.deepEqual(l.meta, { acerto: 0.9, minimo: 30 });
    assert.equal(l.gravacoes.length, 1);
    assert.deepEqual([l.gravacoes[0].origem, l.gravacoes[0].lanches, l.gravacoes[0].conferidos], ['carga', 1, 0]);
    const x = l.lanches.find((y: { id: string }) => y.id === lancheId);
    assert.equal(x.motivo, 'coberto', 'uma etapa ficou sem leitura');
    assert.deepEqual([x.palpite.produto, x.palpite.batem, x.palpite.total], ['X-Burger', 4, 5]);
    const quadros = (await pool.query('select id, n from treino_quadro where lanche_id = $1', [lancheId])).rows;
    const idDo = (n: number) => quadros.find((q) => q.n === n)!.id;
    assert.deepEqual(x.miniaturas, { tampo: idDo(1), base: idDo(4) }, 'o último quadro de cada metade');
    assert.deepEqual(l.contas, { conferidos: 0, acertou: 0 });

    const sup = await lista(cookieSupervisao);
    assert.equal(sup.statusCode, 200);
    assert.equal(sup.json().podeConfigurar, false);
    assert.equal((await lista(cookieExecucao)).statusCode, 403);
    assert.equal((await lista(null)).statusCode, 401);
    assert.equal((await lista(cookieVizinho)).statusCode, 404);
  });

  it('um lanche: as etapas com o quadro, os palpites, os produtos e os ingredientes das fichas', async () => {
    const r = await umLanche(lancheId);
    assert.equal(r.statusCode, 200, r.body);
    const d = r.json();
    assert.equal(d.etapas.length, 6);
    assert.ok(d.etapas[0].quadroId && d.etapas[5].quadroId === null);
    assert.equal(d.palpites[0].produto, 'X-Burger');
    assert.deepEqual(d.produtos.map((p: { nome: string }) => p.nome), ['X-Burger'], 'só o que tem ficha e vai para a cozinha');
    assert.deepEqual(d.ingredientes, NOMES);
    assert.equal((await umLanche(lancheId, cookieVizinho)).statusCode, 404);

    const img = await app.inject({ method: 'GET', url: `/v1/treino/quadros/${d.etapas[0].quadroId}/imagem`, headers: { cookie } });
    assert.equal(img.statusCode, 200);
    assert.ok(img.rawPayload.equals(Buffer.from(CONTRATO.corpo.quadros[0]!.imagemBase64, 'base64')));
    assert.equal((await app.inject({ method: 'GET', url: `/v1/treino/quadros/${d.etapas[0].quadroId}/imagem`, headers: { cookie: cookieVizinho } })).statusCode, 404);
  });

  it('conferir: a supervisão confere; o acerto e os exemplos com a imagem copiada', async () => {
    assert.equal((await conferir(lancheId, CONFERENCIA, cookieExecucao)).statusCode, 403);
    assert.equal((await conferir(lancheId, CONFERENCIA, cookieVizinho)).statusCode, 404);
    const torta = await conferir(lancheId, { ...CONFERENCIA, etapas: CONFERENCIA.etapas.slice(1) }, cookieSupervisao);
    assert.equal(torta.statusCode, 422);
    assert.equal((await pool.query('select situacao from treino_lanche where id = $1', [lancheId])).rows[0].situacao, 'conferir', 'a recusa não mexeu em nada');

    const r = await conferir(lancheId, CONFERENCIA, cookieSupervisao);
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual([r.json().produto, r.json().palpite, r.json().acertou, r.json().exemplos], ['X-Burger', 'X-Burger', true, 5]);
    const l = (await pool.query('select situacao, produto, acertou, conferido_por, resposta from treino_lanche where id = $1', [lancheId])).rows[0];
    assert.deepEqual([l.situacao, l.produto, l.acertou], ['conferido', 'X-Burger', true]);
    assert.ok(l.conferido_por);
    assert.equal(l.resposta.faltas.Sal, 'cliente');

    const ex = await pool.query(
      `select b.nome, f.etapa, f.imagem, f.origem from base_frame f join base_conhecimento b on b.id = f.base_id where f.lanche_id = $1 order by f.etapa`,
      [lancheId],
    );
    assert.deepEqual(ex.rows.map((e) => [e.nome, e.etapa]), [['Pão brioche', 0], ['Cebola roxa', 1], ['Blend da casa', 2], ['Queijo prato', 3], ['Bacon fatiado', 4]]);
    assert.ok(ex.rows[0].imagem.equals(Buffer.from(CONTRATO.corpo.quadros[0]!.imagemBase64, 'base64')), 'a imagem do quadro, copiada');
    // a T1 enxerga os exemplos
    const ing = (await app.inject({ method: 'GET', url: `/v1/lojas/${lojaId}/ingredientes`, headers: { cookie } })).json();
    assert.equal(ing.ingredientes.find((i: { nome: string }) => i.nome === 'Queijo prato').exemplos, 1);

    const depois = (await lista()).json();
    assert.deepEqual(depois.contas, { conferidos: 1, acertou: 1 });
    assert.deepEqual(depois.aprendizado['Bacon fatiado'], { presente: 1, reconheceu: 0 });
    assert.deepEqual(depois.aprendizado['Pão brioche'], { presente: 1, reconheceu: 1 });
  });

  it('conferir de novo troca os exemplos; mandar de novo o lanche conferido não muda nada', async () => {
    const r = await conferir(lancheId, { ...CONFERENCIA, etapas: [{ v: 'certo' }, { v: 'nada' }, { v: 'certo' }, { v: 'certo' }, { v: 'nada' }, null] });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().exemplos, 3);
    assert.equal((await pool.query(`select count(*)::int as n from base_frame where lanche_id = $1`, [lancheId])).rows[0].n, 3, 'trocados, não somados');

    const leituraAntes = (await pool.query('select leitura from treino_lanche where id = $1', [lancheId])).rows[0].leitura;
    const outra = CORPO();
    outra.lanche.etapas[2]!.candidatos = ['Ovo frito'];
    const m = await mandar(outra);
    assert.equal(m.statusCode, 200);
    assert.deepEqual([m.json().conferido, m.json().quadros], [true, 0]);
    assert.deepEqual((await pool.query('select leitura from treino_lanche where id = $1', [lancheId])).rows[0].leitura, leituraAntes, 'o que alguém conferiu não muda por baixo');
  });

  it('pular: fica em "pulado", pode ser conferido depois; o conferido não se pula', async () => {
    const outro = CORPO();
    outro.lanche.chave = 'lanche-15';
    const novo = (await mandar(outro)).json().lancheId as string;
    const p = await pular(novo, cookieSupervisao);
    assert.equal(p.statusCode, 200, p.body);
    assert.equal((await pular(novo)).json().pulado, true, 'pular de novo não é erro');
    assert.equal((await lista()).json().lanches.find((l: { id: string }) => l.id === novo).situacao, 'pulado');
    // "não era um lanche": o palpite errou, e a conta diz
    const naoEra = await conferir(novo, { ...CONFERENCIA, produto: null });
    assert.equal(naoEra.statusCode, 200, 'o pulado se confere depois');
    assert.deepEqual([naoEra.json().produto, naoEra.json().acertou], [null, false]);
    assert.deepEqual((await lista()).json().contas, { conferidos: 2, acertou: 1 });
    const j = await pular(novo);
    assert.equal(j.statusCode, 409);
    assert.equal(j.json().erro, 'ja_conferido');
    assert.equal((await pular(novo, cookieVizinho)).statusCode, 404);
  });

  it('o quadro sai 30 dias depois da conferência; o exemplo fica', async () => {
    const quadroAntigo = (await pool.query('select id from treino_quadro where lanche_id = $1 and n = 0', [lancheId])).rows[0].id;
    await pool.query(`update treino_lanche set conferido_em = now() - interval '31 days' where id = $1`, [lancheId]);
    const apagados = await apagarQuadrosVencidos(pool);
    assert.ok(apagados >= 5, `apagou ${apagados}`);
    assert.equal((await pool.query('select count(*)::int as n from treino_quadro where lanche_id = $1', [lancheId])).rows[0].n, 0);
    assert.equal((await app.inject({ method: 'GET', url: `/v1/treino/quadros/${quadroAntigo}/imagem`, headers: { cookie } })).statusCode, 404);
    assert.equal((await pool.query(`select count(*)::int as n from base_frame where lanche_id = $1 and imagem is not null`, [lancheId])).rows[0].n, 3, 'os exemplos ficaram');
    const recente = (await pool.query(`select l.id from treino_lanche l where l.loja_id = $1 and l.chave = 'lanche-15'`, [lojaId])).rows[0].id;
    assert.equal((await pool.query('select count(*)::int as n from treino_quadro where lanche_id = $1', [recente])).rows[0].n, 5, 'o conferido hoje fica');
  });

  it('a família (o estudo das fichas): o combo com a mesma ficha não é a segunda opção, e escolhê-lo não é erro', async () => {
    // a loja passa a ter o "X-Burger Trio", com a ficha do X-Burger: para a bancada, o mesmo lanche
    const comTrio = copia(BASE);
    const xb = comTrio.produtos.find((p) => p.nome === 'X-Burger')!;
    comTrio.produtos.push({ ...copia(xb), id: randomUUID(), nome: 'X-Burger Trio', codigo: 'XBT' });
    const { produtos, comFicha } = contarBase(comTrio);
    await pool.query(`update fichas_da_loja set conteudo = $2, impressao = $3, produtos = $4, com_ficha = $5 where loja_id = $1`, [
      lojaId,
      JSON.stringify(comTrio),
      impressaoDaBase(comTrio),
      produtos,
      comFicha,
    ]);
    const outro = CORPO();
    outro.lanche.chave = 'lanche-trio';
    const novo = (await mandar(outro)).json().lancheId as string;
    const d = (await umLanche(novo)).json();
    assert.equal(d.palpites[0].produto, 'X-Burger');
    assert.deepEqual(d.palpites[0].familia, ['X-Burger Trio']);
    assert.ok(!d.palpites.some((p: { produto: string }) => p.produto === 'X-Burger Trio'), 'o irmão não é a segunda opção');
    assert.ok(d.produtos.some((p: { nome: string }) => p.nome === 'X-Burger Trio'), 'ele segue em "Outro produto"');
    const r = await conferir(novo, { ...CONFERENCIA, produto: 'X-Burger Trio' });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual([r.json().produto, r.json().palpite, r.json().acertou], ['X-Burger Trio', 'X-Burger', true], 'a bancada não separa o trio');
  });

  it('a conferência nova: as fotos (a mesma imagem junta), os dados das perguntas, a resposta por foto, os exemplos sem repetir', async () => {
    // as etapas 3 e 4 com quadros de MESMOS bytes (o computador da loja manda um quadro por etapa)
    const corpo = CORPO();
    corpo.lanche.chave = 'lanche-por-foto';
    corpo.quadros[4] = { ...corpo.quadros[3]! };
    const m = await mandar(corpo);
    assert.equal(m.statusCode, 201, m.body);
    const id = m.json().lancheId as string;
    const d = (await umLanche(id)).json();
    assert.deepEqual(d.fotos.map((f: { etapas: number[] }) => f.etapas), [[0], [1], [2], [3, 4], [5]]);
    assert.equal(d.fotos[3].quadroId, d.etapas[3].quadroId, 'a foto mostra o quadro da primeira etapa dela');
    assert.equal(d.fotos[4].quadroId, null, 'a etapa sem quadro');
    assert.equal(d.semPalpite, false);
    const p0 = d.palpites[0];
    assert.equal(p0.produto, 'X-Burger');
    assert.equal(p0.plausivel, true);
    assert.ok(p0.ingredientes.length > 0 && p0.ingredientes.every((i: { nome: string; usos: number }) => typeof i.usos === 'number' && i.nome));
    assert.ok(Array.isArray(p0.adicionais) && Array.isArray(p0.tira) && Array.isArray(p0.raros));

    const antes = (await lista()).json().aprendizado['Bacon fatiado']?.presente ?? 0;
    const torta = await conferir(id, { versao: 2, produto: 'X-Burger', fotos: [] }, cookieSupervisao);
    assert.equal(torta.statusCode, 422);
    assert.match(torta.json().mensagem, /uma resposta por foto \(5\)/);
    const r = await conferir(
      id,
      {
        versao: 2,
        produto: 'X-Burger',
        fotos: [
          { marcados: ['Pão brioche'], ruim: false, obs: null },
          { marcados: ['Cebola roxa'], ruim: true, obs: 'borrada' },
          { marcados: ['Blend da casa'], ruim: false, obs: null },
          { marcados: ['Queijo prato', 'Bacon fatiado'], ruim: false, obs: null },
          { marcados: [], ruim: false, obs: null },
        ],
        perguntas: { 'Cebola roxa': 'nao' },
        obs: 'o bacon foi pedido',
        faltas: {},
        aMais: { 'Bacon fatiado': 'adicional' },
      },
      cookieSupervisao,
    );
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual([r.json().palpite, r.json().acertou, r.json().exemplos], ['X-Burger', true, 4], 'a cebola ficou na foto ruim; a etapa 4 é a mesma imagem da 3');
    const ex = await pool.query(`select b.nome, f.etapa from base_frame f join base_conhecimento b on b.id = f.base_id where f.lanche_id = $1 order by f.etapa, b.nome`, [id]);
    assert.deepEqual(ex.rows.map((e) => [e.nome, e.etapa]), [['Pão brioche', 0], ['Blend da casa', 2], ['Bacon fatiado', 3], ['Queijo prato', 3]]);
    const guardada = (await pool.query('select resposta from treino_lanche where id = $1', [id])).rows[0].resposta;
    assert.deepEqual([guardada.versao, guardada.fotos[3].etapas, guardada.fotos[1].obs, guardada.obs], [2, [3, 4], 'borrada', 'o bacon foi pedido']);
    // a gaveta devolve a resposta nova; a lista conta o aprendizado dela
    assert.equal((await umLanche(id)).json().resposta.versao, 2);
    assert.equal((await lista()).json().aprendizado['Bacon fatiado'].presente, antes + 1);
  });

  it('o lanche sem leitura: sem palpite na lista e na gaveta; conferido, conta como não acertado', async () => {
    const corpo = CORPO();
    corpo.lanche.chave = 'lanche-sem-leitura';
    for (const e of corpo.lanche.etapas) {
      e.leu = null;
      e.candidatos = [];
    }
    const id = (await mandar(corpo)).json().lancheId as string;
    const x = (await lista()).json().lanches.find((y: { id: string }) => y.id === id);
    assert.deepEqual([x.semLeitura, x.palpite], [true, null]);
    const d = (await umLanche(id)).json();
    assert.equal(d.semPalpite, true);
    const r = await conferir(id, { versao: 2, produto: 'X-Burger', fotos: d.fotos.map(() => ({ marcados: [], ruim: false, obs: null })) });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual([r.json().palpite, r.json().acertou, r.json().exemplos], [null, false, 0]);
  });
});
