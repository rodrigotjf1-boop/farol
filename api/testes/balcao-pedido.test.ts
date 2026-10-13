// O balcão — a montagem do pedido com contexto, do lado do servidor (A20, fatia 1b).
//
// "A dúvida passa pelo nosso servidor": o servidor vai montar o pedido no
// lugar do agente. O que tem de ficar provado aqui é uma coisa só — ele
// monta IGUAL, letra por letra, ao que o agente monta hoje.
//
// A prova é `contratos/pedido-com-contexto.json`: cada caso traz a
// configuração como ela desce para a loja, o item da análise e o conteúdo
// do pedido — e esse `esperado` é gerado pelo código do agente
// (`agent/testes/test_pedido_do_contrato.py`). Os dois lados leem o mesmo
// arquivo: se o texto mudar de um lado, o teste do outro quebra.
//
// Depois dos casos do contrato vêm os que só o servidor confere: ele não
// confia que o item chegou coerente com a configuração.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { AVISO_DA_AREA, FERRAMENTA, INSTRUCOES_COM_CONTEXTO } from '../src/balcao/instrucoes.js';
import {
  CHAMADAS, NOME_DO_PAPEL, TETOS, conteudoDoPedido, pedidoParaAPlataforma,
  type Bloco, type ConfiguracaoDaLoja, type ImagensDaDuvida, type ItemDaDuvida,
} from '../src/balcao/pedido.js';
import { BRANCOS, aparar, apararOFim, comTeto, numaLinha, texto, umaLinha } from '../src/balcao/texto.js';
import { PAPEIS } from '../src/cena.js';

type Caso = {
  nome: string;
  configuracao: ConfiguracaoDaLoja;
  item: ItemDaDuvida;
  esperado: { conteudo: Bloco[] } | { semPedido: string };
};

const ler = (nome: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../contratos/${nome}`, import.meta.url)), 'utf8'));
const contrato = ler('pedido-com-contexto.json') as {
  instrucoes: { sha256: string; letras: number; cache_control: { type: string } };
  ferramenta: unknown;
  brancos: number[];
  tetos: Record<string, number>;
  chamadas: Record<'rotina' | 'reconsulta', Record<string, unknown>>;
  imagens: Record<'auditada' | 'mapa' | 'padrao', string>;
  casos: Caso[];
};

const JPEG = 'image/jpeg';
/** As imagens que a loja mandaria com o item: só as que ele diz ter. */
const imagensDo = (item: ItemDaDuvida): ImagensDaDuvida => ({
  auditada: { tipo: JPEG, dados: contrato.imagens.auditada },
  mapa: item.mapa ? { tipo: JPEG, dados: contrato.imagens.mapa } : null,
  padrao: item.fotoPadrao ? { tipo: JPEG, dados: contrato.imagens.padrao } : null,
});
const montar = (caso: Pick<Caso, 'configuracao' | 'item'>, imagens = imagensDo(caso.item)) =>
  conteudoDoPedido(caso.configuracao, caso.item, imagens);
const oCaso = (nome: string): Caso => {
  const achado = contrato.casos.find((c) => c.nome === nome);
  assert.ok(achado, `o contrato não tem o caso “${nome}”`);
  return structuredClone(achado);
};
const textos = (conteudo: Bloco[]) => conteudo.map((b) => (b.type === 'text' ? b.text : '<imagem>'));

// ───────────────────── o que é igual em todo pedido ─────────────────────

describe('o balcão: o que é fixo no pedido é o do agente', () => {
  it('as instruções, letra por letra', () => {
    assert.equal(createHash('sha256').update(INSTRUCOES_COM_CONTEXTO, 'utf8').digest('hex'), contrato.instrucoes.sha256);
    assert.equal(Array.from(INSTRUCOES_COM_CONTEXTO).length, contrato.instrucoes.letras);
    assert.ok(!INSTRUCOES_COM_CONTEXTO.includes('\r'), 'só quebra de linha simples');
  });

  it('a ferramenta, com as chaves na mesma ordem', () => {
    assert.equal(JSON.stringify(FERRAMENTA), JSON.stringify(contrato.ferramenta));
  });

  it('as duas chamadas: o modelo, o teto de saída e a escolha da ferramenta', () => {
    assert.deepEqual(CHAMADAS, contrato.chamadas);
  });

  it('os tetos de cada texto e o nome de cada papel de quadro', () => {
    assert.deepEqual(TETOS, contrato.tetos);
    const daCena = ler('cena-do-canal.json') as { papeis: Record<string, string> };
    assert.equal(JSON.stringify(NOME_DO_PAPEL), JSON.stringify(daCena.papeis));
    assert.deepEqual(Object.keys(NOME_DO_PAPEL), [...PAPEIS], 'os mesmos papéis que o cadastro aceita');
  });

  it('o pedido inteiro, como vai para a plataforma: a de rotina e a reconsulta', () => {
    const { conteudo } = oCaso('tudo junto').esperado as { conteudo: Bloco[] };
    const fixo = {
      system: [{ type: 'text', text: INSTRUCOES_COM_CONTEXTO, cache_control: contrato.instrucoes.cache_control }],
      tools: [contrato.ferramenta],
      messages: [{ role: 'user', content: conteudo }],
    };
    assert.deepEqual(pedidoParaAPlataforma(conteudo), { ...contrato.chamadas.rotina, ...fixo });
    assert.deepEqual(pedidoParaAPlataforma(conteudo, 'rotina'), { ...contrato.chamadas.rotina, ...fixo });
    // A reconsulta é a MESMA pergunta ao modelo forte; "abaixo de quanto reconsultar" não vai no corpo.
    const { abaixoDe, ...daReconsulta } = contrato.chamadas.reconsulta;
    assert.equal(abaixoDe, 0.75);
    assert.deepEqual(pedidoParaAPlataforma(conteudo, 'reconsulta'), { ...daReconsulta, ...fixo });
    assert.deepEqual(Object.keys(pedidoParaAPlataforma(conteudo)).sort(), ['max_tokens', 'messages', 'model', 'system', 'tool_choice', 'tools']);
  });
});

// ───────────────────── o texto, do jeito do Python ─────────────────────

describe('o balcão: o texto é contado e aparado como o agente conta e apara', () => {
  it('os espaços em branco são os do Python, nem um a mais nem um a menos', () => {
    assert.deepEqual([...BRANCOS], contrato.brancos);
    for (const c of contrato.brancos) {
      const branco = String.fromCodePoint(c);
      assert.equal(numaLinha(`a${branco}b`), 'a b', `U+${c.toString(16)} separa palavras`);
      assert.equal(aparar(`${branco}a${branco}`), 'a', `U+${c.toString(16)} é aparado`);
      assert.equal(apararOFim(`${branco}a${branco}`), `${branco}a`, `U+${c.toString(16)} é aparado só no fim`);
    }
    // O que o `\s` e o `trim()` do JavaScript tratam como espaço, e o Python não: fica onde está.
    for (const naoEh of ['﻿', '​', '᠎', '⁠']) {
      assert.equal(numaLinha(`a${naoEh}b`), `a${naoEh}b`);
      assert.equal(aparar(`${naoEh}a${naoEh}`), `${naoEh}a${naoEh}`);
      assert.equal(apararOFim(`a${naoEh}`), `a${naoEh}`);
    }
  });

  it('numa linha só: um espaço entre as palavras, nada nas pontas', () => {
    assert.equal(numaLinha('  um \n\t dois\r\ntrês  '), 'um dois três');
    assert.equal(numaLinha('   '), '');
    assert.equal(numaLinha(''), '');
    assert.equal(aparar('  um \n dois  '), 'um \n dois', 'aparar não mexe no meio');
  });

  it('o que não é texto vale vazio', () => {
    for (const bruto of [null, undefined, 7, 0, true, false, ['a'], { a: 1 }]) {
      assert.equal(texto(bruto), '');
      assert.equal(numaLinha(bruto), '');
      assert.equal(aparar(bruto), '');
      assert.equal(umaLinha(bruto, 10), '');
    }
    assert.equal(texto(' a '), ' a ', 'o texto passa como veio');
  });

  it('o teto conta letras: no teto exato não corta; uma a mais, corta uma antes e diz que cortou', () => {
    assert.equal(comTeto('abcde', 5), 'abcde');
    assert.equal(comTeto('abcdef', 5), 'abcd…');
    assert.equal(comTeto('abc  def', 5), 'abc…', 'o espaço que sobra no fim do corte sai');
    assert.equal(comTeto('ab\u0085\u001f def', 5), 'ab…', 'os espaços do Python também saem');
    // Letra fora do plano básico conta UMA (o `length` do JavaScript contaria duas).
    assert.equal(comTeto('🍔🍔🍔🍔🍔', 5), '🍔🍔🍔🍔🍔');
    assert.equal(comTeto('🍔🍔🍔🍔🍔🍔', 5), '🍔🍔🍔🍔…');
    assert.equal(umaLinha('  um\n dois   três ', 7), 'um doi…');
    assert.equal(umaLinha('  um\n dois ', 7), 'um dois');
  });
});

// ───────────────────── os casos do contrato ─────────────────────

describe('o balcão: o servidor monta o pedido que o agente monta', () => {
  it('o contrato tem casos com pedido e casos sem, e cada um tem o esperado', () => {
    assert.ok(contrato.casos.length >= 25);
    assert.ok(contrato.casos.every((c) => c.esperado && ('conteudo' in c.esperado || 'semPedido' in c.esperado)));
    assert.equal(new Set(contrato.casos.map((c) => c.nome)).size, contrato.casos.length);
  });

  for (const caso of contrato.casos) {
    it(`caso: ${caso.nome}`, () => {
      const montado = montar(caso);
      assert.deepEqual(montado, caso.esperado);
      // Igual também na ORDEM das chaves de cada bloco: é o corpo que vai para a plataforma.
      assert.equal(JSON.stringify(montado), JSON.stringify(caso.esperado));
    });
  }

  it('o aviso da área que vai na pergunta é o do agente', () => {
    const { conteudo } = oCaso('como deve ser e o aviso da área').esperado as { conteudo: Bloco[] };
    const pergunta = textos(conteudo).at(-1)!;
    assert.ok(pergunta.split('\n\n').includes(AVISO_DA_AREA));
  });
});

// ───────────────────── o que só o servidor confere ─────────────────────

describe('o balcão: o servidor não confia que o item chegou coerente', () => {
  const base = () => oCaso('dois canais: o pedido é do canal do item');
  const semPedido = (caso: Pick<Caso, 'configuracao' | 'item'>, imagens?: ImagensDaDuvida) => montar(caso, imagens).semPedido;

  it('o caso de partida monta (para as recusas abaixo valerem alguma coisa)', () => {
    assert.ok(montar(base()).conteudo);
  });

  it('critério, área e canal têm de bater: o critério é daquela área daquele canal', () => {
    for (const troca of [{ pontoId: 'p1' }, { pontoId: 'p9' }, { zonaId: 'p2-z0' }, { zonaId: 'p1-z2' }, { zonaId: 'z9' }, { regraId: 'r1' }]) {
      const caso = base();
      Object.assign(caso.item, troca);
      assert.equal(semPedido(caso), 'criterio_fora_da_configuracao', JSON.stringify(troca));
    }
    // Sem canal nenhum na configuração, idem — e não estoura.
    assert.equal(semPedido({ configuracao: { loja: {} }, item: base().item }), 'criterio_fora_da_configuracao');
  });

  it('a foto padrão tem de ser daquele canal, e a imagem dela tem de ter vindo', () => {
    const deOutroCanal = base();
    deOutroCanal.item.fotoPadrao = 'f1';
    assert.equal(semPedido(deOutroCanal), 'foto_padrao_fora_da_configuracao', 'a foto do OUTRO canal não serve');

    const queNaoExiste = base();
    queNaoExiste.item.fotoPadrao = 'f9';
    assert.equal(semPedido(queNaoExiste), 'foto_padrao_fora_da_configuracao');

    const semAImagem = base();
    assert.equal(semPedido(semAImagem, { ...imagensDo(semAImagem.item), padrao: null }), 'foto_padrao_fora_da_configuracao');
  });

  it('critério que não pede a foto padrão não leva a foto, mesmo que ela venha', () => {
    const semPedir = oCaso('critério que não pede a foto padrão');
    const esperado = (semPedir.esperado as { conteudo: Bloco[] }).conteudo;
    semPedir.item.fotoPadrao = 'f1';
    assert.deepEqual(montar(semPedir).conteudo, esperado, 'o pedido é o mesmo de quem não mandou foto');
    assert.ok(!textos(esperado).some((t) => t.startsWith('FOTO PADRÃO')));
    // `comPadrao` só vale `true`: valor parecido com verdade não manda foto de ninguém para fora.
    for (const parecido of [1, 'true', 'sim', {}, []]) {
      const caso = oCaso('quadro, com a foto padrão');
      (caso.configuracao.pontos![0]!.zonas![2]!.regras![0] as { comPadrao: unknown }).comPadrao = parecido;
      assert.ok(!textos(montar(caso).conteudo!).some((t) => t.startsWith('FOTO PADRÃO')), String(parecido));
    }
  });

  it('comparação sem a foto padrão não pergunta: sem a foto ela nem foi comparada', () => {
    const caso = oCaso('comparação que não deu igual à foto padrão');
    caso.item.fotoPadrao = null;
    assert.equal(semPedido(caso), 'nao_vai_a_plataforma');
  });

  it('quadro precisa do mapa inteiro: a imagem dele E se é esquema ou fotografia', () => {
    const semDizerQual = oCaso('quadro, com o mapa em esquema');
    const comOMapa = imagensDo(semDizerQual.item);
    semDizerQual.item.mapa = null;
    assert.equal(semPedido(semDizerQual, comOMapa), 'falta_o_mapa', 'a imagem veio, mas não se sabe o que ela é');

    const semAImagem = oCaso('quadro, com o mapa em esquema');
    assert.equal(semPedido(semAImagem, { ...imagensDo(semAImagem.item), mapa: null }), 'falta_o_mapa');
  });

  it('critério geral não leva mapa, mesmo que ele venha: a imagem completa já é o canal', () => {
    const caso = oCaso('imagem completa, sem mapa');
    const esperado = (caso.esperado as { conteudo: Bloco[] }).conteudo;
    caso.item.mapa = 'foto';
    assert.deepEqual(montar(caso).conteudo, esperado);
  });

  it('a ordem das recusas: primeiro o que não está na configuração, depois o que nunca sai, depois a cena, depois o mapa', () => {
    // Loja em modo local, canal sem cena, quadro sem mapa, critério que não existe: tudo de uma vez.
    const caso = oCaso('quadro sem o mapa');
    caso.configuracao.loja.modoJulgamento = 'local';
    caso.configuracao.pontos![0]!.cena = '';
    caso.item.regraId = 'r9';
    assert.equal(semPedido(caso), 'criterio_fora_da_configuracao');
    caso.item.regraId = 'r1';
    assert.equal(semPedido(caso), 'nao_vai_a_plataforma');
    caso.configuracao.loja.modoJulgamento = 'nuvem';
    assert.equal(semPedido(caso), 'falta_a_cena');
    caso.configuracao.pontos![0]!.cena = 'Bancada vista de cima.';
    assert.equal(semPedido(caso), 'falta_o_mapa');
  });

  it('modo que este lado não conhece não manda nada para fora', () => {
    for (const modo of ['Nuvem', 'NUVEM', 'remoto', ' nuvem']) {
      const caso = oCaso('quadro, com o mapa em esquema');
      caso.configuracao.loja.modoJulgamento = modo;
      assert.equal(semPedido(caso), 'nao_vai_a_plataforma', modo);
    }
  });

  it('as imagens vão como vieram: o tipo e os bytes, sem tocar', () => {
    const caso = oCaso('tudo junto');
    const montado = montar(caso, {
      auditada: { tipo: 'image/png', dados: 'QQ==' },
      mapa: { tipo: 'image/webp', dados: 'Qg==' },
      padrao: { tipo: 'image/jpeg', dados: 'Qw==' },
    }).conteudo!;
    assert.deepEqual(
      montado.filter((b) => b.type === 'image').map((b) => (b.type === 'image' ? b.source : null)),
      [
        { type: 'base64', media_type: 'image/webp', data: 'Qg==' },
        { type: 'base64', media_type: 'image/jpeg', data: 'Qw==' },
        { type: 'base64', media_type: 'image/png', data: 'QQ==' },
      ],
      'o mapa, a foto padrão e, por último, a imagem a auditar',
    );
  });

  it('montar não mexe na configuração nem no item que recebeu', () => {
    const caso = oCaso('tudo junto');
    const antes = JSON.stringify(caso);
    montar(caso);
    montar(caso);
    assert.equal(JSON.stringify(caso), antes);
    assert.deepEqual(montar(caso), montar(caso), 'e a segunda montagem é igual à primeira');
  });
});
