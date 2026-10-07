// O orçamento por uso — a conta, sem banco.
//
// Usa o catálogo DE VERDADE (`catalogo/`): o que se prova aqui é o que um
// cliente veria hoje, não o comportamento contra um catálogo de brinquedo.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { acharCatalogo, lerCatalogo } from '../src/catalogo.js';
import {
  classificarUso,
  exigenciaDoCanal,
  faixaDePreco,
  montarOrcamento,
  opcoesDeCamera,
  type CanalDeEntrada,
  type EquipamentoDoCatalogo,
  type RequisitoDeUso,
} from '../src/orcamento.js';

const bruto = lerCatalogo(acharCatalogo()!);

const catalogo: EquipamentoDoCatalogo[] = bruto.equipamentos.map((e) => ({
  categoria: e.categoria,
  fabricante: e.fabricante,
  modelo: e.modelo,
  nivel: e.nivel as EquipamentoDoCatalogo['nivel'],
  nivelMotivo: e.nivel_motivo,
  status: e.status,
  servePara: e.serve_para ?? [],
  precos: e.precos as EquipamentoDoCatalogo['precos'],
}));

const requisitos: RequisitoDeUso[] = bruto.usos.map((u) => ({
  id: u.id,
  descricao: u.descricao,
  pxPorCmMin: u.px_por_cm_min,
  fpsMin: u.fps_min,
  exigeCor: u.exige_cor,
  exigeWdrDb: u.exige_wdr_db,
  exigeLocal: u.exige_local,
  quadrosPorAnalise: u.quadros_por_analise,
}));
const mapa = new Map(requisitos.map((r) => [r.id, r]));

let n = 0;
function canal(nome: string, tipos: string[], extra: Partial<CanalDeEntrada> = {}): CanalDeEntrada {
  n += 1;
  return {
    id: `p${n}`, nome, canal: n, setor: 'Cozinha', ativo: true, importancia: 'normal',
    pxPorCm: null,
    criterios: tipos.map((tipo) => ({ tipo, ativa: true })),
    ...extra,
  };
}

const orcar = (canais: CanalDeEntrada[], modoJulgamento = 'nuvem') =>
  montarOrcamento({ modoJulgamento, canais, requisitos, catalogo });

// ───────────────────────────── preço ─────────────────────────────

describe('o melhor preço que o catálogo tem', () => {
  it('preço confirmado vence estimado, mesmo mais antigo', () => {
    const f = faixaDePreco([
      { preco_min: 900, preco_max: 1200, confianca: 'estimado', cotado_em: '2026-10-01' },
      { preco: 1000, confianca: 'confirmado', cotado_em: '2026-08-01' },
    ]);
    assert.deepEqual(f, { min: 1000, max: 1000, confianca: 'confirmado', cotadoEm: '2026-08-01' });
  });

  it('entre confianças iguais, vale o mais recente', () => {
    const f = faixaDePreco([
      { preco: 500, confianca: 'indice', cotado_em: '2026-08-01' },
      { preco: 560, confianca: 'indice', cotado_em: '2026-10-03' },
    ]);
    assert.equal(f?.min, 560);
  });

  it('sem preço, ou com preço sem sentido, é nulo — nunca zero', () => {
    assert.equal(faixaDePreco([]), null);
    assert.equal(faixaDePreco([{ preco: 0, confianca: 'indice', cotado_em: '2026-10-03' }]), null);
    assert.equal(
      faixaDePreco([{ preco_min: 900, preco_max: 100, confianca: 'indice', cotado_em: '2026-10-03' }]),
      null,
    );
  });
});

// ─────────────────────── quanto o canal é usado ───────────────────────

describe('a carga do canal sai da quantidade de usos', () => {
  const cr = (...tipos: string[]) => tipos.map((tipo) => ({ tipo, ativa: true }));

  it('sem critério é sem uso', () => {
    assert.equal(classificarUso([], mapa).carga, 'sem_uso');
  });

  it('um critério simples é carga leve', () => {
    const u = classificarUso(cr('presenca'), mapa);
    assert.equal(u.quadrosPorHora, 120);
    assert.equal(u.carga, 'leve');
  });

  it('três critérios simples é moderada; cinco é intensa', () => {
    assert.equal(classificarUso(cr('presenca', 'contagem', 'estado'), mapa).carga, 'moderada');
    assert.equal(classificarUso(cr('presenca', 'contagem', 'estado', 'estado', 'comparacao'), mapa).carga, 'intensa');
  });

  it('UM critério de ação já é intensa: são 8 quadros por análise', () => {
    const u = classificarUso(cr('acao'), mapa);
    assert.equal(u.quadrosPorHora, 960);
    assert.equal(u.carga, 'intensa');
  });

  it('critério desligado conta no uso previsto, e o motivo diz que está desligado', () => {
    const u = classificarUso([{ tipo: 'estado', ativa: false }, { tipo: 'presenca', ativa: true }], mapa);
    assert.equal(u.criterios, 2);
    assert.equal(u.ligados, 1);
    assert.equal(u.carga, 'moderada');
    assert.match(u.motivo, /1 desligado/);
  });
});

// ─────────────────── o que o canal precisa enxergar ───────────────────

describe('a exigência é a do uso mais exigente', () => {
  it('presença e estado no mesmo canal: quem manda é o estado', () => {
    const e = exigenciaDoCanal(['estado', 'presenca'], mapa);
    assert.equal(e.usoMaisExigente, 'estado');
    assert.equal(e.pxPorCmMin, 3);
    assert.equal(e.wdrDb, 90);
  });

  it('só presença pede pouco', () => {
    assert.equal(exigenciaDoCanal(['presenca'], mapa).pxPorCmMin, 1.5);
  });

  it('uso que o catálogo não conhece não inventa exigência', () => {
    const e = exigenciaDoCanal(['telepatia'], mapa);
    assert.equal(e.usoMaisExigente, null);
    assert.equal(e.pxPorCmMin, null);
  });
});

// ───────────────────────── as opções de câmera ─────────────────────────

describe('as câmeras oferecidas servem ao uso — todas elas', () => {
  it('para presença há opção nos três níveis', () => {
    const o = opcoesDeCamera(['presenca'], catalogo);
    assert.deepEqual(o.map((x) => x.nivel), ['basico', 'intermediario', 'avancado']);
  });

  it('para estado NÃO se oferece câmera básica: ela não fecha o quadro', () => {
    const o = opcoesDeCamera(['estado'], catalogo);
    assert.ok(o.length >= 1);
    assert.ok(!o.some((x) => x.nivel === 'basico'));
  });

  it('para ação só serve a que foi cadastrada como servindo a ação', () => {
    const o = opcoesDeCamera(['acao'], catalogo);
    assert.ok(o.length >= 1);
    for (const x of o) {
      const e = catalogo.find((c) => c.modelo === x.modelo)!;
      assert.ok(e.servePara.includes('acao'), `${x.modelo} não serve a ação`);
    }
  });

  it('com vários usos no canal, a câmera tem que servir a TODOS', () => {
    for (const x of opcoesDeCamera(['presenca', 'estado', 'comparacao'], catalogo)) {
      const e = catalogo.find((c) => c.modelo === x.modelo)!;
      for (const uso of ['presenca', 'estado', 'comparacao']) assert.ok(e.servePara.includes(uso));
    }
  });

  it('equipamento descartado NUNCA é oferecido', () => {
    const descartados = catalogo.filter((e) => e.status === 'descartado').map((e) => e.modelo);
    assert.ok(descartados.length > 0);
    for (const tipos of [['presenca'], ['estado'], ['contagem', 'presenca']]) {
      for (const x of opcoesDeCamera(tipos, catalogo)) assert.ok(!descartados.includes(x.modelo));
    }
  });

  it('dentro do nível, o recomendado vem antes do aceitável', () => {
    const o = opcoesDeCamera(['estado'], catalogo).find((x) => x.nivel === 'intermediario')!;
    assert.equal(o.recomendado, true);
  });

  it('canal sem uso não recebe opção nenhuma', () => {
    assert.deepEqual(opcoesDeCamera([], catalogo), []);
  });
});

// ───────────────────────────── a loja ─────────────────────────────

describe('o orçamento da loja', () => {
  it('a loja de teste de hoje: um canal com contagem, outro sem critério', () => {
    const o = orcar([canal('Bancada', []), canal('montagem 1', ['contagem'])]);

    assert.equal(o.resumo.canais, 2);
    assert.equal(o.resumo.emUso, 1);
    assert.deepEqual(o.resumo.porCarga, { sem_uso: 1, leve: 1, moderada: 0, intensa: 0 });
    assert.equal(o.computador.nivelExigido, 'basico');
    assert.equal(o.gravador.nivelExigido, 'basico');

    const basico = o.pacotes[0]!;
    assert.equal(basico.nivel, 'basico');
    assert.deepEqual(basico.itens.map((i) => i.papel), ['camera', 'gravador', 'computador']);
    assert.match(basico.itens[0]!.para, /montagem 1/);
    assert.ok(o.avisos.some((a) => /óptica/.test(a)), 'tem que avisar que a câmera atual não foi medida');
  });

  it('os três pacotes custam, nesta ordem, cada vez mais', () => {
    const o = orcar([canal('Salão', ['presenca']), canal('Caixa', ['presenca', 'contagem'])]);
    const [b, i, a] = o.pacotes.map((p) => p.total.geral.min);
    assert.ok(b! > 0, 'o pacote básico tem que ter preço');
    assert.ok(b! <= i! && i! <= a!, `básico ${b}, intermediário ${i}, avançado ${a}`);
  });

  it('o total é a soma dos itens com preço, e o que não tem preço é contado à parte', () => {
    const o = orcar([canal('Salão', ['presenca'])]);
    for (const p of o.pacotes) {
      const comPreco = p.itens.filter((i) => i.opcao?.preco);
      const min = comPreco.reduce((t, i) => t + i.opcao!.preco!.min * i.quantidade, 0);
      const max = comPreco.reduce((t, i) => t + i.opcao!.preco!.max * i.quantidade, 0);
      assert.deepEqual(p.total.geral, { min, max });
      assert.equal(p.semPreco, p.itens.length - comPreco.length);
      assert.equal(p.total.cameras.min + p.total.infraestrutura.min, p.total.geral.min);
    }
  });

  it('o pacote básico não empurra câmera que não serve: sobe de nível e diz por quê', () => {
    const o = orcar([canal('Chapa', ['estado'])]);
    const camera = o.pacotes[0]!.itens.find((i) => i.papel === 'camera')!;

    assert.notEqual(camera.opcao!.nivel, 'basico');
    assert.match(String(camera.observacao), /não há opção básica/);
  });

  it('câmera que JÁ atende não entra no pacote', () => {
    const o = orcar([canal('Chapa', ['estado'], { pxPorCm: 8 }), canal('Salão', ['presenca'])]);

    const chapa = o.canais.find((c) => c.nome === 'Chapa')!;
    assert.equal(chapa.camera.situacao, 'atende');
    const cameras = o.pacotes[0]!.itens.filter((i) => i.papel === 'camera');
    assert.equal(cameras.length, 1);
    assert.match(cameras[0]!.para, /Salão/);
  });

  it('câmera medida que não alcança o uso é dita com os dois números', () => {
    const o = orcar([canal('Chapa', ['estado'], { pxPorCm: 2 })]);
    const c = o.canais[0]!;
    assert.equal(c.camera.situacao, 'nao_atende');
    assert.match(c.camera.mensagem, /2 pontos por cm/);
    assert.match(c.camera.mensagem, /pede 3/);
    assert.equal(o.resumo.cameraNaoAtende, 1);
  });

  it('a medida é dita como se escreve aqui: com vírgula', () => {
    // A mensagem vai para a tela como está. "12.8" é número de programa.
    const o = orcar([canal('Chapa', ['estado'], { pxPorCm: 12.84 })]);
    const c = o.canais[0]!;
    assert.equal(c.camera.situacao, 'atende');
    assert.equal(c.camera.pxPorCm, 12.8, 'o número continua número para quem calcula');
    assert.match(c.camera.mensagem, /entrega 12,8 pontos por cm/);
  });

  it('canal pausado aparece na lista, mas fica fora dos pacotes — e isso é avisado', () => {
    const o = orcar([canal('Estoque', ['presenca'], { ativo: false }), canal('Salão', ['presenca'])]);

    assert.equal(o.canais.length, 2);
    assert.equal(o.resumo.emUso, 1);
    assert.equal(o.pacotes[0]!.itens.filter((i) => i.papel === 'camera').length, 1);
    assert.ok(o.avisos.some((a) => /pausado/.test(a)));
  });

  it('crítico vem primeiro; depois, o mais usado', () => {
    const o = orcar([
      canal('Corredor', ['presenca'], { importancia: 'baixo' }),
      canal('Salão', ['presenca']),
      canal('Chapa', ['presenca', 'estado', 'contagem']),
      canal('Fritadeira', ['presenca'], { importancia: 'critico' }),
    ]);
    assert.deepEqual(o.canais.map((c) => c.nome), ['Fritadeira', 'Chapa', 'Salão', 'Corredor']);
  });

  it('mais de 8 canais em uso pede computador e gravador intermediários', () => {
    const o = orcar(Array.from({ length: 9 }, (_, i) => canal(`Canal ${i}`, ['presenca'])));
    assert.equal(o.computador.nivelExigido, 'intermediario');
    assert.equal(o.gravador.nivelExigido, 'intermediario');
    const gravador = o.pacotes[0]!.itens.find((i) => i.papel === 'gravador')!;
    assert.notEqual(gravador.opcao!.nivel, 'basico', 'nem no pacote básico cabe gravador de 8 canais');
  });

  it('mais de 16 canais em uso são dois gravadores', () => {
    const o = orcar(Array.from({ length: 17 }, (_, i) => canal(`Canal ${i}`, ['presenca'])));
    assert.equal(o.pacotes[0]!.itens.find((i) => i.papel === 'gravador')!.quantidade, 2);
    assert.match(o.gravador.motivo, /dois/);
  });

  it('se a imagem não pode sair da loja e há critério de estado, entra a placa de vídeo', () => {
    const o = orcar([canal('Chapa', ['estado'])], 'local');

    assert.equal(o.computador.nivelExigido, 'avancado');
    for (const p of o.pacotes) {
      const placa = p.itens.find((i) => i.papel === 'placa_de_video');
      assert.ok(placa?.opcao, `o pacote ${p.nivel} tem que ter placa de vídeo`);
      assert.notEqual(placa.opcao.nivel, 'basico', 'placa básica não roda modelo de visão');
    }
  });

  it('com a imagem podendo ir à nuvem, estado NÃO pede placa de vídeo', () => {
    const o = orcar([canal('Chapa', ['estado'])], 'nuvem');
    assert.notEqual(o.computador.nivelExigido, 'avancado');
    assert.ok(!o.pacotes[0]!.itens.some((i) => i.papel === 'placa_de_video'));
  });

  it('presença e contagem nunca pedem placa de vídeo, nem com a imagem presa na loja', () => {
    const o = orcar([canal('Salão', ['presenca', 'contagem'])], 'local');
    assert.equal(o.computador.nivelExigido, 'basico');
  });

  it('loja sem nenhum canal em uso não orça infraestrutura', () => {
    const o = orcar([canal('Bancada', [])]);
    for (const p of o.pacotes) {
      assert.deepEqual(p.itens, []);
      assert.deepEqual(p.total.geral, { min: 0, max: 0 });
    }
  });

  it('os setores somam os canais por carga', () => {
    const o = orcar([
      canal('Chapa', ['presenca'], { setor: 'Cozinha' }),
      canal('Fritadeira', [], { setor: 'Cozinha' }),
      canal('Caixa', ['acao'], { setor: 'Salão' }),
    ]);
    assert.deepEqual(o.setores, [
      { nome: 'Cozinha', canais: 2, porCarga: { sem_uso: 1, leve: 1, moderada: 0, intensa: 0 } },
      { nome: 'Salão', canais: 1, porCarga: { sem_uso: 0, leve: 0, moderada: 0, intensa: 1 } },
    ]);
  });
});

// ───────────── o que chega ao usuário: solução, não catálogo ─────────────

describe('o orçamento não leva o catálogo para fora', () => {
  const o = orcar([
    canal('Chapa', ['estado', 'presenca']),
    canal('Caixa', ['acao']),
    canal('Salão', ['presenca', 'contagem']),
  ], 'local');
  const texto = JSON.stringify(o);

  it('nenhum equipamento descartado aparece', () => {
    for (const e of catalogo.filter((x) => x.status === 'descartado')) {
      assert.ok(!texto.includes(e.modelo), `descartado no orçamento: ${e.modelo}`);
    }
  });

  it('observação interna, fonte e medição de campo não aparecem', () => {
    // Confere pelo CONTEÚDO do catálogo, modelo a modelo: o texto da
    // observação, cada fonte e cada medição. (Pelo nome do campo não serve —
    // o próprio orçamento tem um "observacao", que é dele.)
    let conferidos = 0;
    for (const e of bruto.equipamentos) {
      const internos = [
        e.observacao,
        ...e.fontes,
        ...(e.medido as Array<{ condicao?: string; onde?: string }>).flatMap((m) => [m.condicao, m.onde]),
      ].filter((s): s is string => typeof s === 'string' && s.length > 8);
      for (const s of internos) {
        conferidos += 1;
        assert.ok(!texto.includes(s), `saiu dado interno de ${e.modelo}: ${s.slice(0, 60)}`);
      }
    }
    assert.ok(conferidos > 80, `só conferi ${conferidos} textos internos`);
  });

  it('cada opção leva só o que o usuário precisa para escolher', () => {
    const opcao = o.canais.find((c) => c.opcoes.length > 0)!.opcoes[0]!;
    assert.deepEqual(
      Object.keys(opcao).sort(),
      ['fabricante', 'modelo', 'nivel', 'porque', 'preco', 'recomendado'],
    );
    assert.ok(opcao.porque.length > 10, 'a opção tem que dizer por que é deste nível');
  });
});
