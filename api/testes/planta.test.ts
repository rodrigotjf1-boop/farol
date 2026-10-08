// A planta da loja (migration 028), de ponta a ponta na API:
//
//   - o que entra é conferido e limpo: medidas, nomes, um canal e um
//     equipamento num lugar só;
//   - o que a câmera vê e a frase do lugar saem da planta — e a conta do
//     console (web/lib/planta.ts) dá a MESMA resposta que a daqui;
//   - a planta é da loja de quem pede; supervisão vê e não mexe;
//   - salva inteira, com a versão que leu: quem chega depois não apaga o
//     desenho de quem chegou antes;
//   - o que ela aponta tem de ser desta loja, e o que deixa de existir sai
//     dela na leitura;
//   - o agente recebe a frase do lugar de cada canal, e só o que muda a
//     frase (ou a planta) sobe a versão da configuração.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

// A conta do console, importada pelo caminho: ela não importa nada, e é
// isto que mantém as duas cópias iguais.
import { cobre, JANELA_DO_AVISO_MS, situacaoDoCanal } from '../../web/componentes/planta/situacao.ts';
import * as web from '../../web/lib/planta.ts';
import { criarApp } from '../src/app.js';
import {
  ambienteEm, coneDaCamera, descricaoDoLugar, lerPlanta, LIMITES_DA_PLANTA, lugaresDaPlanta, MAX_NOMES_NO_LUGAR, moveisVistos,
  type Camera, type Movel, type Planta,
} from '../src/planta.js';

type Contrato = {
  canais: Record<string, string>;
  planta: Planta;
  nomeDoItem: Record<string, string>;
  esperado: {
    veem: Record<string, string[]>;
    lugares: Record<string, string>;
    cobertura: Record<string, number>;
    coberturaSemOBalcao: Record<string, number>;
  };
};
const CONTRATO = JSON.parse(readFileSync(new URL('../../contratos/planta.json', import.meta.url), 'utf8')) as Contrato;
const EXEMPLO = CONTRATO.planta;
const canal = (nome: string): string => Object.entries(CONTRATO.canais).find(([, n]) => n === nome)![0];
const camera = (nome: string): Camera => EXEMPLO.cameras.find((c) => c.pontoId === canal(nome))!;
const copia = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const u = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AMBIENTE = { id: 'a1', nome: 'Cozinha', setorId: null, x: 0, y: 0, w: 6, h: 4 };
const MOVEL = { id: 'm1', nome: 'Chapa', itemId: null, x: 1, y: 1, w: 1, h: 0.8, alt: 0.9 };
const CAMERA = { pontoId: u(1), x: 3, y: 3, alt: 2.6, dir: 270, abertura: 80, alcance: 3 };
const com = (mais: Partial<Record<keyof Planta, unknown[]>>) => ({ ambientes: [AMBIENTE], moveis: [MOVEL], cameras: [CAMERA], ...mais });
const problema = (corpo: unknown): string => lerPlanta(corpo).problema ?? '';

describe('o que entra na planta (sem banco)', () => {
  it('o exemplo do contrato passa e sai igual', () => {
    assert.deepEqual(lerPlanta(EXEMPLO), { planta: EXEMPLO });
    assert.deepEqual(lerPlanta({ ambientes: [], moveis: [], cameras: [] }), { planta: { ambientes: [], moveis: [], cameras: [] } }, 'planta vazia vale');
  });

  it('o que não é da planta fica de fora, e as medidas saem com duas casas', () => {
    const lida = lerPlanta({
      ambientes: [{ ...AMBIENTE, w: 6.004, cor: 'vermelho' }],
      moveis: [{ ...MOVEL, x: 1.006, alt: 0.899, equip: 'chapa' }],
      cameras: [{ ...CAMERA, alcance: 3.14159, canal: 6 }],
      portas: [{ x1: 0, y1: 0, x2: 1, y2: 0 }],
    }).planta!;
    assert.deepEqual(lida, {
      ambientes: [{ ...AMBIENTE, w: 6 }],
      moveis: [{ ...MOVEL, x: 1.01, alt: 0.9 }],
      cameras: [{ ...CAMERA, alcance: 3.14 }],
    });
  });

  it('as três listas são obrigatórias, e têm tamanho máximo', () => {
    for (const ruim of [null, 'planta', [], 7]) assert.match(problema(ruim), /mande a planta/);
    assert.match(problema({ ambientes: [], moveis: [] }), /cameras: lista obrigatória/);
    assert.match(problema({ ambientes: {}, moveis: [], cameras: [] }), /ambientes: lista obrigatória/);
    assert.deepEqual([LIMITES_DA_PLANTA.ambientes, LIMITES_DA_PLANTA.moveis, LIMITES_DA_PLANTA.cameras], [30, 200, 64]);
    const varios = (n: number) => Array.from({ length: n }, (_, i) => ({ ...AMBIENTE, id: `a${i}` }));
    assert.equal(problema(com({ ambientes: varios(30) })), '');
    assert.match(problema(com({ ambientes: varios(31) })), /ambientes: no máximo 30/);
    assert.match(problema(com({ moveis: Array.from({ length: 201 }, (_, i) => ({ ...MOVEL, id: `m${i}` })) })), /moveis: no máximo 200/);
    assert.match(problema(com({ cameras: Array.from({ length: 65 }, (_, i) => ({ ...CAMERA, pontoId: u(i + 1) })) })), /cameras: no máximo 64/);
  });

  it('o nome vai numa linha só, e tem tamanho', () => {
    const lida = lerPlanta(com({ ambientes: [{ ...AMBIENTE, nome: '  Cozinha \n\n quente\t ' }] })).planta!;
    assert.equal(lida.ambientes[0]!.nome, 'Cozinha quente', 'quebra de linha não entra numa frase lida por um modelo');
    assert.equal(lerPlanta(com({ moveis: [{ ...MOVEL, nome: 'Cha\u0000pa\u0007 a\u001b gás\u007f' }] })).planta!.moveis[0]!.nome, 'Cha pa a gás', 'nem caractere de controle');
    assert.match(problema(com({ ambientes: [{ ...AMBIENTE, nome: '   ' }] })), /ambientes\[0\]\.nome: texto de 1 a 60/);
    assert.match(problema(com({ moveis: [{ ...MOVEL, nome: 'x'.repeat(61) }] })), /moveis\[0\]\.nome: texto de 1 a 60/);
    assert.equal(problema(com({ moveis: [{ ...MOVEL, nome: 'x'.repeat(60) }] })), '');
    assert.match(problema(com({ moveis: [{ ...MOVEL, nome: 7 }] })), /moveis\[0\]\.nome/);
  });

  it('cada medida tem a sua faixa', () => {
    const amb = (mais: object) => problema(com({ ambientes: [{ ...AMBIENTE, ...mais }] }));
    const mov = (mais: object) => problema(com({ moveis: [{ ...MOVEL, ...mais }] }));
    const cam = (mais: object) => problema(com({ cameras: [{ ...CAMERA, ...mais }] }));

    assert.match(amb({ w: 0.4 }), /ambientes\[0\]: largura e comprimento de 0,5 a 100/);
    assert.match(amb({ h: 100.5 }), /ambientes\[0\]: largura e comprimento/);
    assert.equal(amb({ w: 0.5, h: 100 }), '');
    assert.match(amb({ x: -0.1 }), /ambientes\[0\]: posição \(x, y\) em metros, de 0 a 200/);
    assert.match(amb({ x: 150, w: 60 }), /ambientes\[0\]: passa de 200 m/);
    assert.equal(amb({ x: 140, w: 60 }), '');
    assert.match(amb({ y: '2' }), /ambientes\[0\]: posição/);
    assert.match(amb({ w: Number.NaN }), /largura e comprimento/);

    assert.match(mov({ w: 0.1 }), /moveis\[0\]: largura e comprimento de 0,2 a 30/);
    assert.match(mov({ h: 31 }), /moveis\[0\]: largura e comprimento/);
    assert.match(mov({ alt: 0 }), /moveis\[0\]\.alt: altura de 0,1 a 5/);
    assert.match(mov({ alt: 5.1 }), /moveis\[0\]\.alt/);
    assert.match(mov({ y: 199.5, h: 1 }), /moveis\[0\]: passa de 200 m/);

    assert.match(cam({ x: 201 }), /cameras\[0\]: posição/);
    assert.match(cam({ alt: 0.4 }), /cameras\[0\]\.alt: altura de 0,5 a 10/);
    assert.match(cam({ alt: 10.1 }), /cameras\[0\]\.alt/);
    assert.match(cam({ abertura: 19 }), /cameras\[0\]\.abertura: de 20 a 180/);
    assert.match(cam({ abertura: 181 }), /cameras\[0\]\.abertura/);
    assert.match(cam({ alcance: 0.4 }), /cameras\[0\]\.alcance: de 0,5 a 30/);
    assert.match(cam({ alcance: 30.5 }), /cameras\[0\]\.alcance/);
    assert.match(cam({ dir: 'norte' }), /cameras\[0\]\.dir: direção em graus/);
    assert.match(cam({ dir: Number.POSITIVE_INFINITY }), /cameras\[0\]\.dir/);
  });

  it('a direção dá a volta: sempre de 0 a 359, inteira', () => {
    const dir = (v: number) => lerPlanta(com({ cameras: [{ ...CAMERA, dir: v }] })).planta!.cameras[0]!.dir;
    assert.deepEqual([dir(0), dir(359), dir(360), dir(-90), dir(725.4), dir(-0.4)], [0, 359, 0, 270, 5, 0]);
  });

  it('um canal e um equipamento estão num lugar só; identificador não se repete', () => {
    assert.match(problema(com({ cameras: [CAMERA, { ...CAMERA, x: 1 }] })), /cameras\[1\]\.pontoId: este canal já está na planta/);
    const comLetras = 'abcdef12-0000-4000-8000-00000000abcd';
    assert.match(problema(com({ cameras: [{ ...CAMERA, pontoId: comLetras }, { ...CAMERA, pontoId: comLetras.toUpperCase() }] })), /cameras\[1\]\.pontoId: este canal já está/, 'maiúscula não disfarça');
    assert.equal(lerPlanta(com({ cameras: [{ ...CAMERA, pontoId: comLetras.toUpperCase() }] })).planta!.cameras[0]!.pontoId, comLetras, 'guardado em minúsculas, como o banco devolve');
    assert.match(
      problema(com({ moveis: [{ ...MOVEL, itemId: u(7) }, { ...MOVEL, id: 'm2', itemId: u(7) }] })),
      /moveis\[1\]\.itemId: este equipamento já está na planta/,
    );
    assert.equal(problema(com({ moveis: [MOVEL, { ...MOVEL, id: 'm2' }] })), '', 'dois móveis sem equipamento: pode');
    assert.match(problema(com({ moveis: [MOVEL, MOVEL] })), /moveis\[1\]\.id: repetido/);
    assert.match(problema(com({ ambientes: [AMBIENTE, AMBIENTE] })), /ambientes\[1\]\.id: repetido/);
    assert.match(problema(com({ ambientes: [{ ...AMBIENTE, id: 'a b' }] })), /ambientes\[0\]\.id/);
    assert.match(problema(com({ moveis: [{ ...MOVEL, id: 'x'.repeat(41) }] })), /moveis\[0\]\.id/);
    assert.match(problema(com({ moveis: ['chapa'] })), /moveis\[0\]: não é um móvel/);
    assert.match(problema(com({ cameras: [null] })), /cameras\[0\]: não é uma câmera/);
    assert.match(problema(com({ ambientes: [[1, 2]] })), /ambientes\[0\]: não é um ambiente/);
  });

  it('o que a planta aponta é um identificador de verdade, ou nada', () => {
    assert.match(problema(com({ ambientes: [{ ...AMBIENTE, setorId: 'cozinha' }] })), /ambientes\[0\]\.setorId/);
    assert.match(problema(com({ moveis: [{ ...MOVEL, itemId: 12 }] })), /moveis\[0\]\.itemId/);
    assert.match(problema(com({ cameras: [{ ...CAMERA, pontoId: 'canal-6' }] })), /cameras\[0\]\.pontoId: o canal/);
    assert.match(problema(com({ cameras: [{ ...CAMERA, pontoId: undefined }] })), /cameras\[0\]\.pontoId/);
    const comLetras = 'abcdef12-0000-4000-8000-00000000abcd';
    const lida = lerPlanta(com({ ambientes: [{ ...AMBIENTE, setorId: comLetras.toUpperCase() }], moveis: [{ ...MOVEL, itemId: undefined }] })).planta!;
    assert.equal(lida.ambientes[0]!.setorId, comLetras, 'guardado em minúsculas, como o banco devolve');
    assert.equal(lerPlanta(com({ moveis: [{ ...MOVEL, itemId: comLetras.toUpperCase() }] })).planta!.moveis[0]!.itemId, comLetras);
    assert.equal(lida.moveis[0]!.itemId, null);
  });
});

describe('o que cada câmera vê, e a frase do lugar (sem banco)', () => {
  const nomes = new Map(Object.entries(CONTRATO.nomeDoItem));

  it('a API vê o que o contrato diz — e o console também', () => {
    assert.equal(EXEMPLO.cameras.length, 8);
    for (const cam of EXEMPLO.cameras) {
      const esperado = CONTRATO.esperado.veem[cam.pontoId];
      assert.deepEqual(moveisVistos(EXEMPLO, cam).map((m) => m.id), esperado, `API, canal ${CONTRATO.canais[cam.pontoId]}`);
      assert.deepEqual(web.moveisVistos(EXEMPLO, cam).map((m) => m.id), esperado, `console, canal ${CONTRATO.canais[cam.pontoId]}`);
    }
    assert.deepEqual(CONTRATO.esperado.veem[canal('balcao')], ['mesa1', 'mesa2', 'balcao', 'mesa3', 'caixa'], 'do mais perto ao mais longe');
    assert.deepEqual(CONTRATO.esperado.veem[canal('recebimento')], []);
  });

  it('a frase do lugar é a do contrato, com o nome do INVENTÁRIO', () => {
    assert.deepEqual(Object.fromEntries(lugaresDaPlanta(EXEMPLO, nomes)), CONTRATO.esperado.lugares);
    assert.equal(
      CONTRATO.esperado.lugares[canal('balcao')],
      'Câmera no ambiente Atendimento, a 2,7 m do chão. No campo de visão: mesa (3), balcão de atendimento e caixa.',
    );
    // sem o inventário (equipamento excluído), vale o nome escrito na planta
    assert.equal(
      lugaresDaPlanta(EXEMPLO).get(canal('montagem1')),
      'Câmera no ambiente Cozinha, a 2,6 m do chão. No campo de visão: montagem 1.',
    );
  });

  it('sem móvel na frente, a frase não afirma que não há equipamento', () => {
    assert.equal(CONTRATO.esperado.lugares[canal('recebimento')], 'Câmera no ambiente Recebimento, a 2,5 m do chão.');
  });

  it('câmera em cima da parede está no ambiente — o primeiro desenhado, na parede dividida', () => {
    // Câmera fica na parede: a borda tem de contar.
    assert.equal(ambienteEm(EXEMPLO, 0, 2)?.id, 'coz');
    assert.equal(ambienteEm(EXEMPLO, 3, 0)?.id, 'coz');
    assert.equal(ambienteEm(EXEMPLO, 14, 9)?.id, 'atd');
    assert.equal(ambienteEm(EXEMPLO, 7.5, 2)?.id, 'coz', 'na parede entre a cozinha e o atendimento');
    assert.equal(ambienteEm(EXEMPLO, 2, 5.5)?.id, 'coz', 'na parede entre a cozinha e o estoque');
    assert.equal(web.ambienteEm(EXEMPLO, 7.5, 2)?.id, 'coz', 'o console concorda');
    assert.equal(ambienteEm(EXEMPLO, 14.01, 2), undefined);
    assert.equal(ambienteEm(EXEMPLO, 2, -0.01), undefined);
    assert.match(descricaoDoLugar(EXEMPLO, { ...CAMERA, x: 0, y: 2, dir: 0 }), /^Câmera no ambiente Cozinha, a 2,6 m do chão\./);
  });

  it('câmera fora dos ambientes: a frase diz, e o cone não é cortado', () => {
    const fora: Camera = { pontoId: u(99), x: 20, y: 20, alt: 3, dir: 0, abertura: 60, alcance: 4 };
    assert.equal(ambienteEm(EXEMPLO, fora.x, fora.y), undefined);
    assert.equal(descricaoDoLugar(EXEMPLO, fora), 'Câmera fora dos ambientes desenhados, a 3 m do chão.');
    const cone = coneDaCamera(EXEMPLO, fora);
    assert.equal(cone.length, 1 + 10 + 1, 'o vértice e um ponto a cada 6° do arco');
    assert.ok(cone.slice(1).every(([x, y]) => Math.abs(Math.hypot(x - 20, y - 20) - 4) < 1e-9), 'todos no alcance');
  });

  it('o cone é cortado nas paredes do ambiente da câmera', () => {
    for (const cam of EXEMPLO.cameras) {
      const a = ambienteEm(EXEMPLO, cam.x, cam.y)!;
      for (const [x, y] of coneDaCamera(EXEMPLO, cam)) {
        assert.ok(x >= a.x - 1e-9 && x <= a.x + a.w + 1e-9 && y >= a.y - 1e-9 && y <= a.y + a.h + 1e-9, `canal ${CONTRATO.canais[cam.pontoId]}: (${x}, ${y}) fora de ${a.nome}`);
      }
    }
    // a câmera do balcão alcança 8,2 m, mas não atravessa a parede para a cozinha
    const chapa = EXEMPLO.moveis.find((m) => m.id === 'chapa')!;
    assert.ok(!moveisVistos(EXEMPLO, { ...camera('balcao'), dir: 180, alcance: 30 }).includes(chapa));
  });

  it('a frase tem limite: os mais próximos primeiro, e "mais N" no fim', () => {
    assert.equal(MAX_NOMES_NO_LUGAR, 8);
    const sala: Planta = {
      ambientes: [{ id: 's', nome: 'Salão', setorId: null, x: 0, y: 0, w: 30, h: 10 }],
      moveis: Array.from({ length: 11 }, (_, i) => ({ id: `m${i}`, nome: `Móvel ${i}`, itemId: null, x: 2 + i * 2, y: 4, w: 1, h: 1, alt: 1 })),
      cameras: [{ pontoId: u(1), x: 0.5, y: 4.5, alt: 2.5, dir: 0, abertura: 60, alcance: 30 }],
    };
    assert.equal(
      descricaoDoLugar(sala, sala.cameras[0]!),
      'Câmera no ambiente Salão, a 2,5 m do chão. No campo de visão: móvel 0, móvel 1, móvel 2, móvel 3, móvel 4, móvel 5, móvel 6, móvel 7 e mais 3.',
    );
    const dois: Planta = { ...sala, moveis: sala.moveis.slice(0, 2) };
    assert.match(descricaoDoLugar(dois, dois.cameras[0]!), /No campo de visão: móvel 0 e móvel 1\.$/);
    const iguais: Planta = { ...sala, moveis: sala.moveis.slice(0, 3).map((m) => ({ ...m, nome: 'Mesa' })) };
    assert.match(descricaoDoLugar(iguais, iguais.cameras[0]!), /No campo de visão: mesa \(3\)\.$/, 'o plural de um nome escrito por alguém não se adivinha');
  });

  it('a cobertura do console é a do contrato; canal que não cobre tira a parte dele', () => {
    const parte = (c: web.Cobertura[]) => Object.fromEntries(c.map((x) => [x.ambiente.id, Math.round(x.parte * 10000) / 10000]));
    assert.deepEqual(parte(web.coberturaDaPlanta(EXEMPLO)), CONTRATO.esperado.cobertura);
    assert.deepEqual(parte(web.coberturaDaPlanta(EXEMPLO, (c) => c.pontoId !== canal('balcao'))), CONTRATO.esperado.coberturaSemOBalcao);
    assert.ok(CONTRATO.esperado.coberturaSemOBalcao.atd! < 0.2 && CONTRATO.esperado.cobertura.atd! > 0.7);
    // as faixas são o que NENHUMA câmera vê: sem câmera, o ambiente inteiro
    const semNinguem = web.coberturaDaPlanta(EXEMPLO, () => false);
    for (const c of semNinguem) {
      assert.equal(c.parte, 0);
      const area = c.faixas.reduce((s, [x1, y1, x2, y2]) => s + (x2 - x1) * (y2 - y1), 0);
      assert.ok(Math.abs(area - c.ambiente.w * c.ambiente.h) < 1e-6, `${c.ambiente.nome}: as faixas cobrem ${area} de ${c.ambiente.w * c.ambiente.h} m²`);
    }
  });

  it('as duas cópias da conta dão a MESMA resposta em quatrocentas câmeras sorteadas', () => {
    // Sorteio com semente: o teste é o mesmo toda vez.
    let s = 20261008;
    const sorte = (): number => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const entre = (a: number, b: number): number => Math.round((a + (b - a) * sorte()) * 100) / 100;
    let comVisao = 0;
    for (let i = 0; i < 400; i += 1) {
      // um quarto delas fora de todo ambiente
      const cam: Camera = {
        pontoId: u(i + 1), x: entre(0, i % 4 === 0 ? 20 : 14), y: entre(0, i % 4 === 0 ? 14 : 9),
        alt: entre(2, 4), dir: Math.floor(sorte() * 360), abertura: entre(20, 180), alcance: entre(0.5, 12),
      };
      const [daApi, doConsole] = [coneDaCamera(EXEMPLO, cam), web.coneDaCamera(EXEMPLO, cam)];
      assert.deepEqual(doConsole, daApi, `cone diferente para ${JSON.stringify(cam)}`);
      const vistos = moveisVistos(EXEMPLO, cam).map((m: Movel) => m.id);
      assert.deepEqual(web.moveisVistos(EXEMPLO, cam).map((m) => m.id), vistos, `móveis diferentes para ${JSON.stringify(cam)}`);
      if (vistos.length) comVisao += 1;
    }
    assert.ok(comVisao > 100, `o sorteio tem de pôr móvel na frente de bastante câmera (${comVisao})`);
  });
});

describe('a situação de cada câmera na planta (sem banco)', () => {
  // O mínimo de um canal, de um critério e do que o console sabe: a regra só olha estes campos.
  type Sabe = Parameters<typeof situacaoDoCanal>[1];
  const P = 'ponto-1';
  const ponto = (mais: object = {}) => ({ id: P, nome: 'Chapa', canal: 3, ativo: true, zonas: [], ...mais }) as unknown as Parameters<typeof situacaoDoCanal>[0];
  const regra = (mais: object = {}) => ({ id: 'r', nome: 'Posto ocupado', ativa: true, quando: 'no_horario', alvos: [{ ponto_id: P }], ...mais });
  const AGORA = '2026-10-08T23:00:00.000Z';
  const ha = (minutos: number): string => new Date(Date.parse(AGORA) - minutos * 60_000).toISOString();
  const sabe = (mais: object = {}): Sabe =>
    ({ regras: [regra()], sinais: [], ocorrencias: [], agora: AGORA, fuso: 'America/Sao_Paulo', abertaAgora: true, agenteAtivo: true, ...mais }) as unknown as Sabe;
  const de = (p = ponto(), s = sabe()) => situacaoDoCanal(p, s);

  it('conferindo: canal ativo, critério ligado que vale agora, computador batendo e nenhum aviso recente', () => {
    assert.deepEqual(de(), { chave: 'ok', texto: 'conferindo', tom: 'ok' });
  });

  it('pausado ganha de tudo', () => {
    const tudo = sabe({ sinais: [{ tipo: 'canal_sem_imagem', pontoId: P, desde: ha(60) }], ocorrencias: [{ pontoId: P, ocorridoEm: ha(1) }] });
    assert.deepEqual(de(ponto({ ativo: false }), tudo), { chave: 'pausado', texto: 'pausado', tom: 'atencao' });
  });

  it('sem imagem: diz desde quando, na hora da loja — e só com o computador batendo', () => {
    const sinal = { tipo: 'canal_sem_imagem', pontoId: P, desde: '2026-10-08T17:20:00.000Z' };
    assert.deepEqual(de(ponto(), sabe({ sinais: [sinal] })), { chave: 'semimagem', texto: 'sem imagem desde as 14h', tom: 'critico' });
    assert.equal(de(ponto(), sabe({ sinais: [{ ...sinal, desde: null }] })).texto, 'sem imagem');
    assert.equal(de(ponto(), sabe({ sinais: [{ ...sinal, pontoId: 'outro' }] })).chave, 'ok', 'o sinal é de outro canal');
    assert.equal(de(ponto(), sabe({ sinais: [{ ...sinal, tipo: 'agente_parado' }] })).chave, 'ok', 'outro tipo de sinal');
    assert.equal(de(ponto(), sabe({ sinais: [sinal], agenteAtivo: false })).texto, 'computador da loja sem sinal', 'sinal velho de computador parado não é afirmado');
    assert.deepEqual(de(ponto(), sabe({ sinais: null })), { chave: 'ok', texto: 'ativo', tom: 'ok' }, 'perfil que não vê sinais: a planta não acusa, e também não afirma que há imagem');
  });

  it('sem critério, ou com todos desligados: sem conferência agora', () => {
    assert.deepEqual(de(ponto(), sabe({ regras: [] })), { chave: 'semcrit', texto: 'sem critério', tom: 'neutro' });
    assert.equal(de(ponto(), sabe({ regras: [regra({ alvos: [{ ponto_id: 'outro' }] })] })).texto, 'sem critério', 'critério de outro canal não conta');
    assert.equal(de(ponto(), sabe({ regras: [regra({ ativa: false })] })).texto, 'nenhum critério ligado');
    assert.equal(de(ponto(), sabe({ regras: [regra({ ativa: false }), regra()] })).chave, 'ok', 'um ligado basta');
  });

  it('critério que só vale com a loja fechada (ou só aberta) não confere agora', () => {
    const fechada = regra({ quando: 'fora_do_horario' });
    assert.deepEqual(de(ponto(), sabe({ regras: [fechada] })), { chave: 'semcrit', texto: 'só confere com a loja fechada', tom: 'neutro' });
    assert.equal(de(ponto(), sabe({ regras: [fechada], abertaAgora: false })).chave, 'ok', 'com a loja fechada, ele vale');
    assert.equal(de(ponto(), sabe({ abertaAgora: false })).texto, 'só confere com a loja aberta');
    // loja sem horário informado é tratada como sempre aberta
    assert.equal(de(ponto(), sabe({ abertaAgora: null })).chave, 'ok');
    assert.equal(de(ponto(), sabe({ regras: [fechada], abertaAgora: null })).texto, 'só confere com a loja fechada');
    // "sempre" vale nos dois
    for (const abertaAgora of [true, false, null]) assert.equal(de(ponto(), sabe({ regras: [regra({ quando: 'sempre' })], abertaAgora })).chave, 'ok');
    assert.equal(de(ponto(), sabe({ regras: [fechada, regra({ quando: 'sempre' })] })).chave, 'ok', 'um que vale agora basta');
  });

  it('com o computador da loja sem bater, nenhuma câmera aparece conferindo', () => {
    assert.deepEqual(de(ponto(), sabe({ agenteAtivo: false })), { chave: 'semcrit', texto: 'computador da loja sem sinal', tom: 'neutro' });
    assert.equal(de(ponto(), sabe({ agenteAtivo: false, ocorrencias: [{ pontoId: P, ocorridoEm: ha(1) }] })).chave, 'semcrit', 'nem acusando aviso');
    assert.equal(de(ponto(), sabe({ agenteAtivo: false, regras: [] })).texto, 'sem critério', 'o motivo mais perto do canal vem primeiro');
  });

  it('aviso nos últimos dez minutos acende a câmera — a deste canal', () => {
    assert.equal(JANELA_DO_AVISO_MS, 600_000);
    const com = (ocorrencias: object[] | null, mais: object = {}) => de(ponto(), sabe({ ocorrencias, ...mais }));
    assert.deepEqual(com([{ pontoId: P, ocorridoEm: ha(9) }]), { chave: 'alerta', texto: 'aviso nos últimos 10 min', tom: 'critico' });
    assert.equal(com([{ pontoId: P, ocorridoEm: ha(10) }]).chave, 'alerta', 'dez minutos exatos ainda contam');
    assert.equal(com([{ pontoId: P, ocorridoEm: ha(11) }]).chave, 'ok');
    assert.equal(com([{ pontoId: 'outro', ocorridoEm: ha(1) }]).chave, 'ok', 'aviso de outro canal');
    assert.equal(com([{ pontoId: null, ocorridoEm: ha(1) }]).chave, 'ok', 'ocorrência de canal que já não existe');
    assert.equal(com(null).chave, 'ok', 'perfil que não vê ocorrências');
    assert.equal(com([{ pontoId: P, ocorridoEm: ha(1) }], { agora: null }).chave, 'ok', 'sem o relógio do servidor não há "últimos dez minutos"');
    assert.equal(com([{ pontoId: P, ocorridoEm: ha(30) }, { pontoId: P, ocorridoEm: ha(2) }]).chave, 'alerta', 'basta um recente');
  });

  it('na cobertura, canal sem imagem ou pausado não cobre nada', () => {
    assert.equal(cobre(de(ponto({ ativo: false }))), false);
    assert.equal(cobre(de(ponto(), sabe({ sinais: [{ tipo: 'canal_sem_imagem', pontoId: P, desde: null }] }))), false);
    assert.equal(cobre(de()), true);
    assert.equal(cobre(de(ponto(), sabe({ regras: [] }))), true, 'sem critério a câmera continua vendo');
    assert.equal(cobre(undefined), true, 'canal que a tela não conhece: não se desconta o que não se sabe');
  });
});

describe('a conta do console: do chão para a tela, e mexer na planta (sem banco)', () => {
  const perto = (a: number[], b: number[], folga = 1e-6): boolean => a.every((v, i) => Math.abs(v - b[i]!) <= folga);

  it('a tela volta ao chão em qualquer vista: `chao` é `p` ao contrário', () => {
    const moldura = web.molduraDoQueExiste(EXEMPLO);
    assert.deepEqual(moldura, [0, 0, 14, 9]);
    for (const t of [0, 0.3, 1]) {
      const proj = web.projetor(EXEMPLO, moldura, t, 800, 550);
      for (const [x, y] of [[0, 0], [14, 9], [3.2, 2.2], [13.6, 0.4]] as const) {
        const [sx, sy] = proj.p(x, y, 0);
        assert.ok(perto(proj.chao(sx, sy), [x, y]), `t=${t}: (${x}, ${y}) voltou como ${proj.chao(sx, sy)}`);
        assert.ok(sx >= 29 && sx <= 771 && sy >= 29 && sy <= 521, `t=${t}: (${x}, ${y}) cabe na tela com a margem: ${sx}, ${sy}`);
      }
    }
    // de cima a planta não gira: a direita do chão é a direita da tela
    const deCima = web.projetor(EXEMPLO, moldura, 0, 800, 550);
    assert.ok(deCima.p(14, 0)[0] > deCima.p(0, 0)[0] && Math.abs(deCima.p(14, 0)[1] - deCima.p(0, 0)[1]) < 1e-9);
    // em perspectiva o que é alto sobe na tela, e o que está mais à frente tem profundidade maior
    const emPe = web.projetor(EXEMPLO, moldura, 1, 800, 550);
    assert.ok(emPe.p(5, 5, 2)[1] < emPe.p(5, 5, 0)[1]);
    assert.ok(emPe.p(14, 9)[2] > emPe.p(0, 0)[2]);
    assert.equal(deCima.p(5, 5, 2)[1], deCima.p(5, 5, 0)[1], 'de cima a altura não aparece');
  });

  it('a moldura de edição tem espaço para desenhar: 14 × 9 m no mínimo, e dois metros além do que existe', () => {
    assert.deepEqual(web.molduraDeEdicao(web.PLANTA_VAZIA), [0, 0, 14, 9]);
    assert.deepEqual(web.molduraDeEdicao(EXEMPLO), [0, 0, 16, 11]);
    const grande: Planta = { ...web.PLANTA_VAZIA, ambientes: [{ id: 'a', nome: 'Galpão', setorId: null, x: 100, y: 0, w: 100, h: 3 }] };
    assert.deepEqual(web.molduraDeEdicao(grande), [0, 0, 200, 9], 'nunca além do limite da planta');
    assert.deepEqual(web.molduraDoQueExiste(web.PLANTA_VAZIA), [0, 0, 14, 9], 'sem nada, a moldura de sempre');
    assert.deepEqual(web.molduraDoQueExiste({ ...web.PLANTA_VAZIA, cameras: [{ ...CAMERA, x: 20, y: 12 }], moveis: [{ ...MOVEL, x: 2, y: 3 }] }), [2, 3, 20, 12], 'câmera e móvel soltos também contam');
  });

  it('mover um ambiente leva junto quem mora nele — e só quem mora nele', () => {
    const depois = web.moverAmbiente(EXEMPLO, 'coz', 1, 0.5);
    const antes = (id: string) => EXEMPLO.moveis.find((m) => m.id === id)!;
    const agora = (id: string) => depois.moveis.find((m) => m.id === id)!;
    assert.deepEqual([depois.ambientes[0]!.x, depois.ambientes[0]!.y], [1, 0.5]);
    assert.deepEqual([agora('chapa').x, agora('chapa').y], [antes('chapa').x + 1, antes('chapa').y + 0.5]);
    assert.deepEqual(agora('balcao'), antes('balcao'), 'o balcão é do atendimento: fica');
    assert.deepEqual(agora('prateleira'), antes('prateleira'));
    const cam = (nome: string, p: Planta) => p.cameras.find((c) => c.pontoId === canal(nome))!;
    assert.deepEqual([cam('chapa', depois).x, cam('chapa', depois).y], [2.4, 2.7]);
    assert.deepEqual(cam('balcao', depois), cam('balcao', EXEMPLO));
    assert.equal(EXEMPLO.ambientes[0]!.x, 0, 'a planta de antes não é mexida: é ela que o "descartar" devolve');
    assert.equal(web.moverAmbiente(EXEMPLO, 'coz', 0, 0), EXEMPLO, 'sem andar, é a mesma planta');
    assert.equal(web.moverAmbiente(EXEMPLO, 'nao-existe', 3, 3), EXEMPLO);
  });

  it('o toque escolhe o menor retângulo: móvel antes de ambiente', () => {
    assert.deepEqual(web.alvoNoChao(EXEMPLO, 1, 0.5), { tipo: 'movel', id: 'chapa' });
    assert.deepEqual(web.alvoNoChao(EXEMPLO, 5, 4), { tipo: 'ambiente', id: 'coz' });
    assert.equal(web.alvoNoChao(EXEMPLO, 30, 30), null);
    // um móvel pequeno em cima de um grande: vence o pequeno
    const empilhada: Planta = { ...EXEMPLO, moveis: [...EXEMPLO.moveis, { id: 'pote', nome: 'Pote', itemId: null, x: 0.9, y: 0.4, w: 0.3, h: 0.3, alt: 1 }] };
    assert.deepEqual(web.alvoNoChao(empilhada, 1, 0.5), { tipo: 'movel', id: 'pote' });
  });

  it('a grade não deixa lixo de ponto flutuante, e as fatias somam o tamanho', () => {
    assert.equal(web.grade(0.1 + 0.2, 0.1), 0.3);
    assert.equal(web.grade(2.26, 0.25), 2.25);
    assert.equal(web.grade(5.74, 0.5), 5.5);
    assert.deepEqual(web.fatias(0.8), [[0, 0.8]]);
    assert.equal(web.fatias(5.4).length, 6);
    assert.ok(perto([web.fatias(5.4).at(-1)![1]], [5.4]));
    assert.equal(web.mesmaPlanta(EXEMPLO, copia(EXEMPLO)), true);
    assert.equal(web.mesmaPlanta(EXEMPLO, web.moverAmbiente(EXEMPLO, 'coz', 1, 0)), false);
  });

  it('o nome do ambiente foge de câmera, de móvel e do que mais for pedido', () => {
    const coz = EXEMPLO.ambientes[0]!;
    const [x, y] = web.lugarDoNome(EXEMPLO, coz, 0.8, 0.3);
    assert.ok(x > coz.x && x < coz.x + coz.w && y > coz.y && y < coz.y + coz.h, 'dentro do ambiente');
    const livre = (px: number, py: number): boolean =>
      EXEMPLO.moveis.every((m) => px < m.x - 0.3 || px > m.x + m.w + 0.3 || py < m.y - 0.2 || py > m.y + m.h + 0.2);
    assert.ok(livre(x, y), `(${x}, ${y}) está em cima de um móvel`);
    const desviado = web.lugarDoNome(EXEMPLO, coz, 0.8, 0.3, [[x, y]]);
    assert.ok(Math.hypot(desviado[0] - x, desviado[1] - y) > 0.5, 'com um ponto a evitar ali, o nome vai para outro lugar');
  });
});

// ───────────────── com banco ─────────────────

const URL_DO_BANCO = process.env.DATABASE_URL;
const marca = `teste-planta-${randomUUID().slice(0, 8)}`;
const ADMIN = 'admin-de-teste-planta';
const SENHA = 'uma senha longa o bastante';

describe('a planta da loja (Postgres real)', { skip: !URL_DO_BANCO && 'sem DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let adminAntes: string | undefined;
  let lojaId = '';
  let setorId = '';
  let lojaVizinha = '';
  let setorVizinho = '';
  let cookie = '';
  let cookieSupervisao = '';
  let cookieVizinho = '';
  let token = '';
  let canais = 0;

  type Resposta = { planta: Planta | null; versao: number | null; atualizadaEm: string | null; lugares: Record<string, string> };

  async function entrar(tenantId: string, email: string, nivel: string) {
    await app.inject({
      method: 'POST', url: '/v1/distribuicao/usuarios', headers: { 'x-farol-admin': ADMIN },
      payload: { tenantId, nome: 'X', email, senha: SENHA, nivel },
    });
    const r = await app.inject({ method: 'POST', url: '/v1/sessao', payload: { email, senha: SENHA } });
    const b = r.headers['set-cookie'];
    return (Array.isArray(b) ? b[0]! : String(b)).split(';')[0]!;
  }
  async function canalNovo(nome: string, noSetor = setorId, comCookie = cookie) {
    canais += 1;
    const r = await app.inject({
      method: 'POST', url: `/v1/setores/${noSetor}/pontos`, headers: { cookie: comCookie },
      payload: { nome, origem: 'dvr', canal: canais, host: '192.168.1.108' },
    });
    assert.equal(r.statusCode, 201, r.body);
    return r.json().id as string;
  }
  async function equipamento(nome: string, mais: Record<string, unknown> = {}, loja = lojaId, setor = setorId, comCookie = cookie) {
    const r = await app.inject({ method: 'POST', url: `/v1/lojas/${loja}/inventario`, headers: { cookie: comCookie }, payload: { nome, setorId: setor, ...mais } });
    assert.equal(r.statusCode, 201, r.body);
    return r.json().id as string;
  }
  const ler = (comCookie: string | null = cookie, loja = lojaId) =>
    app.inject({ method: 'GET', url: `/v1/lojas/${loja}/planta`, headers: comCookie ? { cookie: comCookie } : {} });
  const salvar = (planta: unknown, versao: unknown, comCookie = cookie, loja = lojaId) =>
    app.inject({ method: 'PUT', url: `/v1/lojas/${loja}/planta`, headers: { cookie: comCookie }, payload: { versao, planta } });
  /** Salva por cima do que estiver guardado, e devolve o que ficou. */
  async function gravar(planta: Planta): Promise<Resposta> {
    const atual = (await ler()).json() as Resposta;
    const r = await salvar(planta, atual.versao);
    assert.equal(r.statusCode, 200, r.body);
    return r.json() as Resposta;
  }
  const versaoDaConfig = async () => (await pool.query('select config_versao from loja where id = $1', [lojaId])).rows[0].config_versao as number;
  const configuracao = async () =>
    (await app.inject({ method: 'GET', url: '/v1/agentes/configuracao', headers: { authorization: `Bearer ${token}` } })).json() as {
      versao: number; pontos: { id: string; lugar: string | null }[];
    };

  const sala = (mais: Partial<Planta> = {}): Planta => ({
    ambientes: [{ id: 'coz', nome: 'Cozinha', setorId, x: 0, y: 0, w: 6, h: 4 }],
    moveis: [],
    cameras: [],
    ...mais,
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
    setorId = conta.setores[0].id;
    cookie = await entrar(conta.tenantId, `dono-${marca}@e.com`, 'presidente');
    cookieSupervisao = await entrar(conta.tenantId, `sup-${marca}@e.com`, 'supervisao');

    const vizinha = (await app.inject({
      method: 'POST', url: '/v1/distribuicao/lojas', headers: { 'x-farol-admin': ADMIN },
      payload: { tenant: { nome: `${marca}-vizinha` }, loja: { nome: 'Outra' }, setores: [{ nome: 'Salão' }] },
    })).json();
    lojaVizinha = vizinha.loja.id;
    setorVizinho = vizinha.setores[0].id;
    cookieVizinho = await entrar(vizinha.tenantId, `dono-${marca}-v@e.com`, 'presidente');

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

  it('a loja começa sem planta; sem sessão não lê, e outra conta nem sabe que a loja existe', async () => {
    const r = await ler();
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json(), { planta: null, versao: null, atualizadaEm: null, lugares: {} });
    assert.equal((await ler(null)).statusCode, 401);
    assert.equal((await ler(cookieVizinho)).statusCode, 404);
    assert.equal((await ler(cookie, 'nao-e-uuid')).statusCode, 404);
    assert.equal((await salvar(sala(), null, cookieVizinho)).statusCode, 404);
    assert.equal((await pool.query('select 1 from planta where loja_id = $1', [lojaId])).rowCount, 0, 'e nada foi gravado');
  });

  it('supervisão vê a planta e não mexe', async () => {
    const r = await salvar(sala(), null, cookieSupervisao);
    assert.equal(r.statusCode, 403, r.body);
    assert.equal((await ler(cookieSupervisao)).statusCode, 200);
    assert.equal(((await ler()).json() as Resposta).planta, null);
  });

  it('salvar pela primeira vez cria a versão 1, e a leitura devolve o que foi salvo', async () => {
    const r = await salvar(sala(), null);
    assert.equal(r.statusCode, 200, r.body);
    const salva = r.json() as Resposta;
    assert.equal(salva.versao, 1);
    assert.deepEqual(salva.planta, sala());
    assert.ok(salva.atualizadaEm);
    assert.deepEqual((await ler()).json(), salva);
    assert.deepEqual((await ler(cookieSupervisao)).json(), salva);
    const quem = await pool.query('select u.email from planta p join usuario u on u.id = p.atualizado_por where p.loja_id = $1', [lojaId]);
    assert.equal(quem.rows[0].email, `dono-${marca}@e.com`, 'fica dito quem salvou');
  });

  it('quem salva diz a versão que leu: quem chega depois não apaga o desenho do outro', async () => {
    // "Não tem planta" já não é verdade
    const deNovo = await salvar(sala({ ambientes: [] }), null);
    assert.equal(deNovo.statusCode, 409, deNovo.body);
    assert.match(deNovo.json().mensagem, /alterada em outro lugar/);

    const ok = await salvar(sala({ ambientes: [{ id: 'coz', nome: 'Cozinha quente', setorId, x: 0, y: 0, w: 6, h: 4 }] }), 1);
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(ok.json().versao, 2);
    // a outra aba ainda tem a versão 1 na mão
    const atrasada = await salvar(sala(), 1);
    assert.equal(atrasada.statusCode, 409, atrasada.body);
    assert.equal(atrasada.json().erro, 'conflito');
    const agora = (await ler()).json() as Resposta;
    assert.equal(agora.versao, 2);
    assert.equal(agora.planta!.ambientes[0]!.nome, 'Cozinha quente', 'o que estava salvo continua');
    // versão que nunca existiu também não passa
    assert.equal((await salvar(sala(), 99)).statusCode, 409);
  });

  it('dois salvamentos ao mesmo tempo com a mesma versão: só um entra', async () => {
    for (let rodada = 0; rodada < 6; rodada += 1) {
      const antes = ((await ler()).json() as Resposta).versao!;
      const nomes = [`rodada ${rodada} A`, `rodada ${rodada} B`];
      const respostas = await Promise.all(
        nomes.map((nome) => salvar(sala({ ambientes: [{ id: 'coz', nome, setorId, x: 0, y: 0, w: 6, h: 4 }] }), antes)),
      );
      assert.deepEqual(respostas.map((r) => r.statusCode).sort(), [200, 409], `rodada ${rodada}`);
      const ficou = (await ler()).json() as Resposta;
      assert.equal(ficou.versao, antes + 1);
      const venceu = nomes[respostas.findIndex((r) => r.statusCode === 200)];
      assert.equal(ficou.planta!.ambientes[0]!.nome, venceu, 'o que ficou é o de quem recebeu 200');
    }
  });

  it('o que não passa na conferência não é gravado, e a resposta diz onde está o erro', async () => {
    const antes = (await ler()).json() as Resposta;
    const r = await salvar(sala({ cameras: [{ pontoId: randomUUID(), x: 1, y: 1, alt: 2.6, dir: 0, abertura: 400, alcance: 3 }] }), antes.versao);
    assert.equal(r.statusCode, 422, r.body);
    assert.match(r.json().mensagem, /cameras\[0\]\.abertura/);
    for (const versao of ['1', 0, 1.5, -1]) {
      const v = await salvar(sala(), versao);
      assert.equal(v.statusCode, 422, `versao ${JSON.stringify(versao)}: ${v.body}`);
      assert.match(v.json().mensagem, /versao/);
    }
    assert.equal((await salvar(undefined, antes.versao)).statusCode, 422);
    assert.deepEqual((await ler()).json(), antes);
  });

  it('o que a planta aponta tem de ser DESTA loja', async () => {
    const antes = (await ler()).json() as Resposta;
    const canalDaVizinha = await canalNovo('Salão', setorVizinho, cookieVizinho);
    const itemDaVizinha = await equipamento('Mesa da vizinha', {}, lojaVizinha, setorVizinho, cookieVizinho);
    const cam = { x: 1, y: 1, alt: 2.6, dir: 0, abertura: 80, alcance: 3 };
    const movel = { id: 'm1', nome: 'Chapa', x: 1, y: 1, w: 1, h: 1, alt: 0.9 };

    const setor = await salvar(sala({ ambientes: [{ id: 'coz', nome: 'Cozinha', setorId: setorVizinho, x: 0, y: 0, w: 6, h: 4 }] }), antes.versao);
    assert.equal(setor.statusCode, 422, setor.body);
    assert.match(setor.json().mensagem, /ambientes\[0\]\.setorId: este setor não é desta loja/);

    const ponto = await salvar(sala({ cameras: [{ pontoId: canalDaVizinha, ...cam }] }), antes.versao);
    assert.equal(ponto.statusCode, 422, ponto.body);
    assert.match(ponto.json().mensagem, /cameras\[0\]\.pontoId: este canal não é desta loja/);

    const item = await salvar(sala({ moveis: [{ ...movel, itemId: itemDaVizinha }] }), antes.versao);
    assert.equal(item.statusCode, 422, item.body);
    assert.match(item.json().mensagem, /moveis\[0\]\.itemId: este equipamento não está no inventário desta loja/);

    // canal que nunca existiu, e canal excluído
    assert.equal((await salvar(sala({ cameras: [{ pontoId: randomUUID(), ...cam }] }), antes.versao)).statusCode, 422);
    const excluido = await canalNovo('Vai sair');
    assert.equal((await app.inject({ method: 'DELETE', url: `/v1/pontos/${excluido}`, headers: { cookie } })).statusCode, 200);
    const morto = await salvar(sala({ cameras: [{ pontoId: excluido, ...cam }] }), antes.versao);
    assert.equal(morto.statusCode, 422, morto.body);
    assert.match(morto.json().mensagem, /foi excluído/);

    assert.deepEqual((await ler()).json(), antes, 'nada disso foi gravado');
    // ambiente sem setor e móvel sem equipamento: pode
    const solta = await salvar(sala({ ambientes: [{ id: 'coz', nome: 'Cozinha', setorId: null, x: 0, y: 0, w: 6, h: 4 }], moveis: [{ ...movel, itemId: null }] }), antes.versao);
    assert.equal(solta.statusCode, 200, solta.body);
  });

  it('a frase do lugar usa o nome do inventário, e é a que desce ao agente', async () => {
    const chapaCanal = await canalNovo('Chapa');
    const foraDaPlanta = await canalNovo('Depósito');
    const chapa = await equipamento('Chapa a gás');
    const salva = await gravar(sala({
      moveis: [
        { id: 'chapa', nome: 'Chapa', itemId: chapa, x: 2.5, y: 0.2, w: 1.5, h: 0.8, alt: 0.9 },
        // ao lado da câmera, fora do que ela alcança
        { id: 'pia', nome: 'Pia', itemId: null, x: 0.2, y: 2.8, w: 1, h: 0.6, alt: 0.9 },
      ],
      cameras: [{ pontoId: chapaCanal, x: 3.2, y: 3.5, alt: 2.6, dir: 270, abertura: 80, alcance: 4 }],
    }));
    const frase = 'Câmera no ambiente Cozinha, a 2,6 m do chão. No campo de visão: chapa a gás.';
    assert.deepEqual(salva.lugares, { [chapaCanal]: frase });

    const c = await configuracao();
    assert.equal(c.pontos.find((p) => p.id === chapaCanal)!.lugar, frase, 'a mesma frase que a tela mostra');
    assert.equal(c.pontos.find((p) => p.id === foraDaPlanta)!.lugar, null, 'canal fora da planta: nulo');
  });

  it('só o que muda a planta ou a frase sobe a versão da configuração', async () => {
    const atual = (await ler()).json() as Resposta;
    const chapaId = atual.planta!.moveis.find((m) => m.id === 'chapa')!.itemId!;

    let v = await versaoDaConfig();
    // salvar a MESMA planta: a versão da planta anda, a da configuração não
    const igual = await gravar(atual.planta!);
    assert.equal(igual.versao, atual.versao! + 1);
    assert.equal(await versaoDaConfig(), v, 'documento igual não acorda o agente');

    // mexer na planta acorda
    const mexida = copia(atual.planta!);
    mexida.cameras[0]!.alcance = 5;
    await gravar(mexida);
    assert.equal(await versaoDaConfig(), v + 1);
    v += 1;

    // o equipamento ligado muda de nome: a frase muda, mesmo sem descrição no inventário
    const renomear = await app.inject({ method: 'PATCH', url: `/v1/inventario/${chapaId}`, headers: { cookie }, payload: { nome: 'Chapa elétrica' } });
    assert.equal(renomear.statusCode, 200, renomear.body);
    assert.equal(await versaoDaConfig(), v + 1, 'o nome dele está na frase do lugar');
    v += 1;
    const pontoId = mexida.cameras[0]!.pontoId;
    assert.match((await configuracao()).pontos.find((p) => p.id === pontoId)!.lugar!, /chapa elétrica\.$/);

    // equipamento sem descrição e FORA da planta: mudar o nome não acorda ninguém
    const solto = await equipamento('Freezer');
    assert.equal(await versaoDaConfig(), v);
    await app.inject({ method: 'PATCH', url: `/v1/inventario/${solto}`, headers: { cookie }, payload: { nome: 'Freezer horizontal' } });
    assert.equal(await versaoDaConfig(), v, 'ele não está em frase nenhuma');
    assert.equal((await app.inject({ method: 'DELETE', url: `/v1/inventario/${solto}`, headers: { cookie } })).statusCode, 200);
    assert.equal(await versaoDaConfig(), v);
  });

  it('equipamento excluído do inventário: o móvel fica, solto, com o nome que tinha na planta', async () => {
    const antes = (await ler()).json() as Resposta;
    const chapa = antes.planta!.moveis.find((m) => m.id === 'chapa')!;
    const v = await versaoDaConfig();

    assert.equal((await app.inject({ method: 'DELETE', url: `/v1/inventario/${chapa.itemId}`, headers: { cookie } })).statusCode, 200);

    assert.equal(await versaoDaConfig(), v + 1, 'a frase mudou: o agente tem de saber');
    const depois = (await ler()).json() as Resposta;
    assert.deepEqual(depois.planta!.moveis.find((m) => m.id === 'chapa'), { ...chapa, itemId: null });
    assert.equal(depois.versao, antes.versao, 'a planta guardada não foi reescrita');
    assert.match(Object.values(depois.lugares)[0]!, /No campo de visão: chapa\.$/);
    // e dá para salvar de novo o que a leitura devolveu
    assert.equal((await salvar(depois.planta, depois.versao)).statusCode, 200);
  });

  it('canal excluído sai da planta na leitura', async () => {
    const antes = (await ler()).json() as Resposta;
    const pontoId = antes.planta!.cameras[0]!.pontoId;

    assert.equal((await app.inject({ method: 'DELETE', url: `/v1/pontos/${pontoId}`, headers: { cookie } })).statusCode, 200);

    const depois = (await ler()).json() as Resposta;
    assert.deepEqual(depois.planta!.cameras, []);
    assert.deepEqual(depois.lugares, {});
    assert.deepEqual(depois.planta!.moveis, antes.planta!.moveis, 'o resto fica');
    assert.equal((await salvar(depois.planta, depois.versao)).statusCode, 200, 'e a planta lida pode ser salva');
  });

  it('setor excluído: o ambiente fica, sem setor', async () => {
    const novoSetor = (await pool.query(
      `insert into setor (loja_id, nome, ordem) values ($1, 'Provisório', 9) returning id`, [lojaId],
    )).rows[0].id as string;
    const salva = await gravar(sala({ ambientes: [
      { id: 'coz', nome: 'Cozinha', setorId, x: 0, y: 0, w: 6, h: 4 },
      { id: 'prov', nome: 'Provisório', setorId: novoSetor, x: 6, y: 0, w: 3, h: 4 },
    ] }));
    assert.equal(salva.planta!.ambientes[1]!.setorId, novoSetor);

    await pool.query('delete from setor where id = $1', [novoSetor]);

    const depois = (await ler()).json() as Resposta;
    assert.deepEqual(depois.planta!.ambientes.map((a) => a.setorId), [setorId, null]);
  });

  it('documento guardado que deixou de passar na conferência vira planta vazia, e não erro', async () => {
    const antes = (await ler()).json() as Resposta;
    await pool.query(`update planta set documento = '{"ambientes": "torto"}'::jsonb where loja_id = $1`, [lojaId]);
    const r = await ler();
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual((r.json() as Resposta).planta, { ambientes: [], moveis: [], cameras: [] });
    assert.equal((await app.inject({ method: 'GET', url: '/v1/agentes/configuracao', headers: { authorization: `Bearer ${token}` } })).statusCode, 200, 'e o agente continua recebendo a configuração');
    assert.equal((await salvar(antes.planta, antes.versao)).statusCode, 200, 'salvar de novo conserta');
  });
});
